// The week-config first-pull gate (setup-rebuild-spec S0h, scoring#3). The
// games/days catalog syncs on its own node as a whole-object last-write-wins,
// and a phone that edits it BEFORE its first config snapshot would see the edit
// silently replaced by that snapshot (or, worse, push its stale catalog over
// everyone's). So until the first snapshot lands: nothing is pushed (the
// null-seed aside) and the games/days builder is read-only. Driven against the
// in-memory Realtime Database in tests/fake-rtdb.js, with the app's real
// listener (attachConfigListener).

const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');
const CONFIG_PATH = 'campScoreboard/config';
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 5));

// Sync configured (so the gate applies), a fake database, the real listener.
function gateSetup(opts) {
  freshState();
  setMemberRole('editor');
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  configReady = false;
  syncDenied = false;
  pendingConfigWrites = 0;
  const db = makeFakeRtdb(Object.assign({ manualFirstSnapshot: true }, opts));
  fbConfigRef = db.ref(CONFIG_PATH);
  attachConfigListener();
  return db;
}

function gateTeardown() {
  delete window.FIREBASE_CONFIG;
  fbConfigRef = null;
  configReady = false;
  syncDenied = false;
  pendingConfigWrites = 0;
  configFirstHeld = false;
  pendingRemoteConfig = null;
  dataEditPending = false;
  clearTimeout(pushConfigTimer);
  pushConfigTimer = null;
  setMemberRole(null);
}

// A card that records what the builder wrote into it.
function builderCard() {
  return { innerHTML: '', __view: undefined, querySelectorAll: () => [], querySelector: () => null };
}

function withToasts(fn) {
  const real = showToast;
  const toasts = [];
  showToast = (msg) => { toasts.push(msg); };
  try { return fn(toasts); } finally { showToast = real; }
}

test('before the first config snapshot nothing is pushed, even when flushed', () => {
  const db = gateSetup();
  try {
    assert.equal(configReady, false);
    state.config.games[0].name += ' (edited too early)';
    saveConfig();
    flushPendingPush(); // what pagehide does
    pushConfig();
    assert.equal(db.log.length, 0, 'no write of any kind reached the database: ' + JSON.stringify(db.log));
    assert.equal(pendingConfigWrites, 0);
  } finally { gateTeardown(); }
});

test('the games and days tabs are read-only placeholders until the first snapshot', () => {
  gateSetup();
  try {
    assert.equal(configEditable(), false);
    ['games', 'days'].forEach((key) => {
      const card = builderCard();
      renderSettingsSection(key, card);
      assert.ok(card.innerHTML.includes('Loading the games list'), key + ': ' + card.innerHTML);
      ['add-day-btn', 'game-row-main', 'reorder-btn', 'day-delete-btn', 'gd-save-btn', 'quick-game'].forEach((hook) =>
        assert.notOk(card.innerHTML.includes(hook), key + ' has no ' + hook));
    });
    // Even with the editor open from before the reload (state.ui persists), the
    // games tab shows the placeholder, and no draft is built behind it.
    state.ui.editGameId = state.config.games[0].id;
    gameDraft = null; gameDraftFor = null;
    const card = builderCard();
    renderSettingsSection('games', card);
    assert.ok(card.innerHTML.includes('Loading the games list'));
    assert.equal(gameDraft, null, 'no draft is built while loading');
    // The other tabs are state, not config, and are not gated.
    const teams = builderCard();
    renderSettingsSection('teams', teams);
    assert.notOk(teams.innerHTML.includes('Loading the games list'));
  } finally { state.ui.editGameId = null; gateTeardown(); }
});

test('no builder edit is possible before the first snapshot', () => {
  gateSetup();
  try {
    withToasts((toasts) => {
      // A day with no games, so deleteDay can only be refused by the gate itself
      // (a day with games refuses on its own and would hide a missing guard).
      state.config.days.push({ id: 'd-empty', name: 'Empty day', dow: 6, note: '' });
      const before = JSON.stringify({ c: state.config, r: state.results, b: state.brackets });
      const id = state.config.games[0].id;
      state.ui.editGameId = id;
      ensureGameDraft();
      gameDraft.name = 'Changed';
      saveGameDraft();
      duplicateGame();
      deleteGame(id);
      deleteDay('d-empty');
      restoreDefaults();
      tryImport(JSON.stringify({ config: defaultConfig() }));
      state.ui.editGameId = null;
      startQuickGame();
      assert.equal(JSON.stringify({ c: state.config, r: state.results, b: state.brackets }), before, 'nothing changed');
      assert.equal(state.ui.editGameId, null, 'the ⚡ quick game did not open an editor');
      assert.ok(state.config.days.some((d) => d.id === 'd-empty'), 'the empty day survived deleteDay');
      assert.ok(toasts.length >= 5 && toasts.every((t) => /still loading/.test(t)), toasts.join(' | '));
    });
  } finally { state.ui.editGameId = null; gameDraft = null; gameDraftFor = null; gateTeardown(); }
});

test('the first snapshot opens the gate, adopts the server catalog, and refreshes an open builder', () => {
  const db = gateSetup();
  const real = renderAll;
  let renders = 0;
  renderAll = () => { renders += 1; };
  const wasStarted = appStarted;
  appStarted = true;
  try {
    const remote = JSON.parse(JSON.stringify(state.config));
    remote.games = remote.games.slice(0, 3);
    remote.updatedAt = '2026-12-01T00:00:00.000Z';
    db.serverSet(CONFIG_PATH, remote);
    state.ui.view = 'settings';
    db.deliverFirstSnapshots();
    assert.equal(configReady, true);
    assert.equal(configEditable(), true);
    assert.equal(state.config.games.length, 3, 'the server\'s catalog was adopted');
    assert.ok(renders >= 1, 'the builder is repainted so the placeholder goes away');
  } finally { renderAll = real; appStarted = wasStarted; state.ui.view = 'home'; gateTeardown(); }
});

test('a FIRST snapshot parked mid-entry keeps the builder shut until it is applied', () => {
  const db = gateSetup();
  const real = renderAll;
  renderAll = () => {};
  const wasStarted = appStarted;
  appStarted = true;
  try {
    const remote = JSON.parse(JSON.stringify(state.config));
    remote.games = remote.games.slice(0, 3);
    remote.updatedAt = '2026-12-01T00:00:00.000Z';
    db.serverSet(CONFIG_PATH, remote);
    dataEditPending = true; // a score edit is queued: the snapshot is held, like a focused field
    db.deliverFirstSnapshots();
    assert.equal(configReady, true);
    assert.ok(pendingRemoteConfig, 'the snapshot is parked');
    assert.notOk(state.config.games.length === 3, 'state.config is still the stale cached catalog');
    assert.equal(configEditable(), false, 'a Save now would whole-set that stale catalog over the server\'s');
    const card = builderCard();
    renderSettingsSection('games', card);
    assert.ok(card.innerHTML.includes('Loading the games list'));
    dataEditPending = false;
    flushPendingRemoteConfig();
    assert.equal(state.config.games.length, 3, 'the parked snapshot is applied');
    assert.equal(configEditable(), true);
    assert.equal(pendingRemoteConfig, null);
  } finally { renderAll = real; appStarted = wasStarted; gateTeardown(); }
});

test('a LATER snapshot parked mid-entry never shuts an open builder', () => {
  const db = gateSetup();
  const real = renderAll;
  renderAll = () => {};
  try {
    db.serverSet(CONFIG_PATH, state.config);
    db.deliverFirstSnapshots();
    assert.equal(configEditable(), true);
    dataEditPending = true;
    const later = JSON.parse(JSON.stringify(state.config));
    later.updatedAt = '2027-01-01T00:00:00.000Z';
    later.games = later.games.slice(0, 2);
    db.serverSet(CONFIG_PATH, later);
    assert.ok(pendingRemoteConfig, 'held, as before');
    assert.equal(configEditable(), true, 'an open game editor must not be swapped for "Loading"');
  } finally { renderAll = real; gateTeardown(); }
});

test('an identical first snapshot still repaints the builder (applyRemoteConfig alone would not)', () => {
  const db = gateSetup();
  const real = renderAll;
  let renders = 0;
  renderAll = () => { renders += 1; };
  const wasStarted = appStarted;
  appStarted = true;
  try {
    db.serverSet(CONFIG_PATH, state.config);
    state.ui.view = 'settings';
    db.deliverFirstSnapshots();
    assert.ok(renders >= 1);
  } finally { renderAll = real; appStarted = wasStarted; state.ui.view = 'home'; gateTeardown(); }
});

test('after the first snapshot an edit goes up as a whole-config set, and is counted until acknowledged', async () => {
  const db = gateSetup();
  try {
    db.serverSet(CONFIG_PATH, state.config);
    db.deliverFirstSnapshots();
    db.goOffline(); // a write now stays pending, like the real SDK's offline queue
    state.config.games[0].name = 'Renamed offline';
    saveConfig();
    await wait(450); // the 400 ms debounce
    assert.equal(pendingConfigWrites, 1, 'one config write is in flight');
    assert.equal(pendingWritesTotal(), 1);
    assert.equal(pendingWrites, 0, 'the state counter is untouched');
    assert.ok(reloadBlocked(), 'an auto-reload now would throw the in-memory queue away');
    assert.ok(hasUnsyncedWork(), 'so would a camp switch');
    assert.ok(hasUnconfirmedLocalWork(), 'or a sign-out');
    assert.ok(canAdoptRemote(), 'but a scores snapshot is still safe to adopt (state only)');
    db.goOnline();
    await wait(20);
    assert.equal(pendingConfigWrites, 0);
    assert.notOk(reloadBlocked());
    assert.equal(db.serverGet(CONFIG_PATH).games[0].name, 'Renamed offline');
  } finally { gateTeardown(); }
});

test('a refused config write is surfaced, not swallowed, and does not wedge the counter', async () => {
  const db = gateSetup();
  const real = showToast;
  const realWarn = console.warn;
  console.warn = () => {}; // the app logs the refusal too
  const toasts = [];
  showToast = (msg) => { toasts.push(msg); };
  try {
    db.serverSet(CONFIG_PATH, state.config);
    db.deliverFirstSnapshots();
    db.refuse(CONFIG_PATH);
    state.config.games[0].name = 'Refused edit';
    saveConfig();
    flushPendingPush();
    assert.equal(pendingConfigWrites, 1);
    await wait(30);
    assert.equal(pendingConfigWrites, 0, 'settled on failure too');
    assert.ok(toasts.some((t) => /Couldn't save the week setup/.test(t)), toasts.join(' | '));
  } finally { showToast = real; console.warn = realWarn; gateTeardown(); }
});

test('an empty config node is seeded by a transaction, once, and never over an existing node', async () => {
  const db = gateSetup();
  try {
    db.deliverFirstSnapshots(); // the node is empty
    await wait(20);
    assert.equal(configReady, true);
    assert.ok(db.log.some((l) => l.kind === 'transaction'), 'seeded through a transaction: ' + JSON.stringify(db.log));
    assert.notOk(db.log.some((l) => l.kind === 'set'), 'never a whole-node set');
    assert.equal(db.serverGet(CONFIG_PATH).games.length, state.config.games.length, 'the catalog is now on the server');
    assert.equal(pendingConfigWrites, 0);
  } finally { gateTeardown(); }
});

test('two phones seeding at once: the loser aborts instead of overwriting the winner', async () => {
  const db = gateSetup();
  try {
    const winner = { version: 99, updatedAt: '2026-12-01T00:00:00.000Z', sessions: ['Morning'], days: [{ id: 'd1', name: 'Mon', dow: 1 }], games: [] };
    db.contend(CONFIG_PATH, (d) => d.serverSet(CONFIG_PATH, winner)); // the other phone seeds mid-transaction
    db.deliverFirstSnapshots();
    await wait(30);
    assert.equal(db.serverGet(CONFIG_PATH).version, 99, 'the first seed stands');
    assert.equal(pendingConfigWrites, 0);
  } finally { gateTeardown(); }
});

test('offline from the start: the first snapshot never comes, and the builder stays shut', () => {
  const db = gateSetup();
  try {
    db.goOffline();
    assert.equal(configReady, false);
    assert.equal(configEditable(), false);
    const card = builderCard();
    renderSettingsSection('games', card);
    assert.ok(card.innerHTML.includes('Loading the games list'));
  } finally { gateTeardown(); }
});

test('local-only mode (no sync configured) is never gated', () => {
  freshState();
  setMemberRole('editor');
  assert.ok(!window.FIREBASE_CONFIG);
  assert.equal(configEditable(), true);
  const card = builderCard();
  renderSettingsSection('days', card);
  assert.notOk(card.innerHTML.includes('Loading the games list'));
  assert.equal(pendingConfigWrites, 0);
  setMemberRole(null);
});

test('a refused config read (access revoked) opens the builder rather than leaving "Loading" forever', async () => {
  const db = gateSetup();
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    db.revokeRead(CONFIG_PATH);
    await wait(10);
    assert.equal(syncDenied, true);
    assert.equal(configEditable(), true, 'no snapshot is coming; the app is already kicking this device out');
    assert.equal(fbConfigRef, null);
  } finally { console.warn = realWarn; gateTeardown(); }
});

test('the SDK being down (read-only copy) does not leave the builder on "Loading"', () => {
  freshState();
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  configReady = false;
  const was = sdkLoadFailed;
  sdkLoadFailed = true;
  try { assert.equal(configEditable(), true); } finally { sdkLoadFailed = was; delete window.FIREBASE_CONFIG; }
});
