// The week-config first-pull gate (setup-rebuild-spec S0h, scoring#3), as the
// config engine v2 (step 9, tests/config-sync.test.js) leaves it. Nothing is pushed
// before the first config snapshot has been PROCESSED (the null-seed aside), and a
// device with no confirmed baseline (_cfgBase — its first run of the engine) keeps the
// games/days builder read-only until then, because nothing could tell its edit apart
// from the cached copy the snapshot replaces. A device WITH a baseline may edit
// meanwhile: tests/config-sync.test.js covers the merge. Driven against the in-memory
// Realtime Database in tests/fake-rtdb.js, with the app's real listener
// (attachConfigListener).

const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');
const CONFIG_PATH = 'campScoreboard/config';
// (Waits are for the app, not the clock: waitUntil / waitQuiet in tests/harness.js.)

// Sync configured (so the gate applies), a fake database, the real listener. The
// state engine's first pull has landed (remoteReady) unless a case says otherwise: the
// first config snapshot waits for it (its epoch lives in state/meta).
function gateSetup(opts) {
  freshState();
  setMemberRole('editor');
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  configReady = false;
  cfgFirstPending = null;
  remoteReady = !(opts && opts.stateFirst === false);
  syncDenied = false;
  pendingConfigWrites = 0;
  delete state._cfgBase;
  const db = makeFakeRtdb(Object.assign({ manualFirstSnapshot: true }, opts));
  fbConfigRef = db.ref(CONFIG_PATH);
  attachConfigListener();
  return db;
}

function gateTeardown() {
  delete window.FIREBASE_CONFIG;
  fbConfigRef = null;
  configReady = false;
  cfgFirstPending = null;
  remoteReady = false;
  syncDenied = false;
  pendingConfigWrites = 0;
  configPushOwed = false;
  delete state._cfgBase;
  delete state._cfgNotes;
  dataEditPending = false;
  document.activeElement = null;
  clearTimeout(pushConfigTimer);
  pushConfigTimer = null;
  setMemberRole(null);
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

test('no catalog edit is possible before the first snapshot', () => {
  gateSetup();
  try {
    withToasts((toasts) => {
      const before = JSON.stringify({ c: state.config, r: state.results, b: state.brackets });
      assert.equal(configEditable(), false);
      assert.equal(configLocked(), true, 'the guard every catalog writer asks says no, and says why');
      tryImport(JSON.stringify({ config: defaultConfig() }));
      startQuickGame();
      assert.equal(typeof gmOpenQuick === 'function' && gmUi.open, null, 'the ⚡ quick game did not open a sheet');
      assert.equal(JSON.stringify({ c: state.config, r: state.results, b: state.brackets }), before, 'nothing changed');
      assert.ok(toasts.length >= 3 && toasts.every((t) => /still loading/.test(t)), toasts.join(' | '));
    });
  } finally { gateTeardown(); }
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
    state.ui.builderScreen = 'games';
    db.deliverFirstSnapshots();
    assert.equal(configReady, true);
    assert.equal(configEditable(), true);
    assert.equal(state.config.games.length, 3, 'the server\'s catalog was adopted');
    assert.ok(renders >= 1, 'the builder is repainted so the placeholder goes away');
  } finally { renderAll = real; appStarted = wasStarted; state.ui.view = 'home'; gateTeardown(); }
});

test('a FIRST snapshot arriving mid-entry is applied AT ONCE; only the repaint waits for the focused field', () => {
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
    dataEditPending = true; // a score edit is queued...
    document.activeElement = { tagName: 'INPUT' }; // ...and a field has the keyboard
    db.deliverFirstSnapshots();
    assert.equal(configReady, true);
    assert.equal(state.config.games.length, 3, 'the data is in state.config straight away (no parked snapshot, no stale catalog)');
    assert.equal(configEditable(), true, 'so the builder is never shut by a focused field');
    assert.equal(renders, 0, 'but nothing repaints under the focused field');
    assert.equal(renderOwed, true, 'the repaint is owed to the idle tick');
    document.activeElement = null;
    idleRetryTick();
    assert.ok(renders >= 1, 'and is paid once focus has left');
  } finally { renderAll = real; appStarted = wasStarted; renderOwed = false; gateTeardown(); }
});

test('a LATER snapshot mid-entry is applied at once too, and never shuts an open builder', () => {
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
    assert.equal(state.config.games.length, 2, 'applied (rebased), not parked');
    assert.equal(configEditable(), true, 'an open game editor must not be swapped for "Loading"');
  } finally { renderAll = real; renderOwed = false; gateTeardown(); }
});

test('the first snapshot waits for the state engine\'s first pull (its epoch is in state/meta)', () => {
  const db = gateSetup({ stateFirst: false });
  try {
    const remote = JSON.parse(JSON.stringify(state.config));
    remote.games = remote.games.slice(0, 3);
    db.serverSet(CONFIG_PATH, remote);
    db.deliverFirstSnapshots();
    assert.equal(configReady, false, 'not processed yet: the epoch to compare against is unknown');
    assert.ok(cfgFirstPending, 'the snapshot is held');
    assert.equal(configEditable(), false, 'a device with no baseline stays read-only meanwhile');
    pushConfig();
    assert.equal(db.log.filter((l) => l.kind === 'transaction').length, 0, 'and nothing is pushed');
    // The state engine's first pull lands: its handler hands the config snapshot back.
    handleRemoteSnapshot(syncedSnapshot());
    assert.equal(remoteReady, true);
    assert.equal(configReady, true);
    assert.equal(cfgFirstPending, null);
    assert.equal(state.config.games.length, 3, 'and it was adopted');
    assert.equal(configEditable(), true);
  } finally { gateTeardown(); fbRef = null; }
});

test('a device with a confirmed baseline may edit before the first snapshot; the merge keeps the edit', async () => {
  const db = gateSetup();
  try {
    const server = JSON.parse(JSON.stringify(state.config));
    db.serverSet(CONFIG_PATH, server);
    state._cfgBase = cfgCanon(state.config); // what a returning phone has cached
    assert.equal(configEditable(), true, 'a baseline can merge an edit made before the snapshot');
    const id = state.config.games[0].id;
    const renamed = withToasts(() => {
      state.config.games[0].name = 'Edited before the snapshot';
      saveConfig();
      assert.equal(db.log.filter((l) => l.kind === 'transaction').length, 0, 'still nothing pushed before the first pull');
      return true;
    });
    assert.ok(renamed);
    db.deliverFirstSnapshots();
    await waitQuiet();
    assert.equal(gameById(id).name, 'Edited before the snapshot', 'the edit survived the first snapshot');
    assert.equal(db.serverGet(CONFIG_PATH).games[0].name, 'Edited before the snapshot', 'and went up');
  } finally { gateTeardown(); }
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
    state.ui.builderScreen = 'games';
    db.deliverFirstSnapshots();
    assert.ok(renders >= 1);
  } finally { renderAll = real; appStarted = wasStarted; state.ui.view = 'home'; gateTeardown(); }
});

test('after the first snapshot an edit goes up as a transaction of field ops, and is counted until acknowledged', async () => {
  const db = gateSetup();
  try {
    db.serverSet(CONFIG_PATH, state.config);
    db.deliverFirstSnapshots();
    db.goOffline(); // a write now stays pending, like the real SDK's offline queue
    state.config.games[0].name = 'Renamed offline';
    saveConfig();
    await waitQuiet(); // the 400 ms debounce fires and the (offline) write is queued
    assert.equal(pendingConfigWrites, 1, 'one config write is in flight');
    assert.equal(pendingWritesTotal(), 1);
    assert.equal(pendingWrites, 0, 'the state counter is untouched');
    assert.ok(reloadBlocked(), 'an auto-reload now would throw the in-memory queue away');
    assert.ok(hasUnsyncedWork(), 'so would a camp switch');
    assert.ok(hasUnconfirmedLocalWork(), 'or a sign-out');
    assert.ok(canAdoptRemote(), 'but a scores snapshot is still safe to adopt (state only)');
    db.goOnline();
    await waitQuiet();
    assert.equal(pendingConfigWrites, 0);
    assert.notOk(reloadBlocked());
    assert.equal(db.serverGet(CONFIG_PATH).games[0].name, 'Renamed offline');
    assert.ok(db.log.some((l) => l.kind === 'transaction'), 'sent as a transaction');
    assert.notOk(db.log.some((l) => l.kind === 'set'), 'never a whole-node set()');
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
    await waitQuiet();
    assert.equal(pendingConfigWrites, 0, 'settled on failure too');
    assert.ok(toasts.some((t) => /Couldn't save the week setup/.test(t)), toasts.join(' | '));
  } finally { showToast = real; console.warn = realWarn; gateTeardown(); }
});

test('an empty config node is seeded by a transaction, once, and never over an existing node', async () => {
  const db = gateSetup();
  try {
    db.deliverFirstSnapshots(); // the node is empty
    await waitQuiet();
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
    await waitQuiet();
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
    assert.equal(configLocked(), true, 'every catalog writer is shut');
  } finally { gateTeardown(); }
});

test('local-only mode (no sync configured) is never gated', () => {
  freshState();
  setMemberRole('editor');
  assert.ok(!window.FIREBASE_CONFIG);
  assert.equal(configEditable(), true);
  assert.equal(configLocked(), false);
  assert.equal(pendingConfigWrites, 0);
  setMemberRole(null);
});

test('a refused config read (access revoked) opens the builder rather than leaving "Loading" forever', async () => {
  const db = gateSetup();
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    db.revokeRead(CONFIG_PATH);
    await waitUntil(() => syncDenied, 'the refused read to be reported');
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
