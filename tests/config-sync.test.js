// Config engine v2 (setup-rebuild-spec §6.3, build step 9 / "S3"): the week catalog
// (campScoreboard/config) is no longer written whole. An edit is a set of id-keyed
// field ops measured against a persisted confirmed baseline (state._cfgBase), pushed
// as a TRANSACTION onto the server's current value, and a snapshot is rebased
// (server + my unconfirmed ops) instead of replacing the catalog. Driven against the
// in-memory Realtime Database (tests/fake-rtdb.js) with the app's real listener,
// pushConfig and merge. The first-pull gate itself is tests/config-gate.test.js; the
// undo entries are tests/undo.test.js. Run under the senior profile too
// (config-sync.senior.test.js evals this file).

const vm = nodeRequire('vm');
const { makeContext } = nodeRequire('./harness.js');
const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');

const CS_PATH = dbPath('config');
const csWait = (ms) => new Promise((r) => setTimeout(r, ms || 5)); // a few ms: one hop. Waiting for a push / its acknowledgement / what it sets off is waitQuiet() (tests/harness.js), never a longer guess.
const csClone = (v) => JSON.parse(JSON.stringify(v));

// A signed-in editor whose first config snapshot has landed: a baseline, configReady, a
// live listener on the fake database (which is also what lets a transaction see the
// cached server value, exactly as the real SDK does).
async function csSetup() {
  freshState();
  setMemberRole('editor');
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  configReady = false;
  cfgFirstPending = null;
  remoteReady = true;
  syncDenied = false;
  pendingConfigWrites = 0;
  configPushOwed = false;
  delete state._cfgBase;
  delete state._cfgNotes;
  undoClear();
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  db.serverSet(CS_PATH, state.config);
  fbConfigRef = db.ref(CS_PATH);
  attachConfigListener();
  db.deliverFirstSnapshots();
  await waitUntil(() => configReady, 'the first config snapshot to be processed');
  await csWait(5);
  assert.equal(configReady, true, 'the first snapshot was processed');
  assert.ok(cfgBaseTree(), 'and left a confirmed baseline');
  return db;
}

function csTeardown() {
  delete window.FIREBASE_CONFIG;
  fbConfigRef = null;
  configReady = false;
  cfgFirstPending = null;
  remoteReady = false;
  pendingConfigWrites = 0;
  configPushOwed = false;
  dataEditPending = false;
  delete state._cfgBase;
  delete state._cfgNotes;
  clearTimeout(pushConfigTimer);
  pushConfigTimer = null;
  undoClear();
  setMemberRole(null);
}

// Another device's edit, as the server stores it.
function csServer(db, fn) {
  const cur = db.serverGet(CS_PATH);
  fn(cur);
  db.serverSet(CS_PATH, cur);
}

function csToasts(fn) {
  const real = showToast;
  const toasts = [];
  showToast = (msg, opts) => { toasts.push({ msg, opts }); };
  const done = () => { showToast = real; };
  let out;
  try { out = fn(toasts); } catch (e) { done(); throw e; }
  if (out && typeof out.then === 'function') return out.then((v) => { done(); return v; }, (e) => { done(); throw e; });
  done();
  return out;
}

const csGame = (db, id) => (db.serverGet(CS_PATH).games || []).find((g) => g.id === id);

// ── The pure helpers ─────────────────────────────────────────────────

test('treeDiff recurses to the spec\'s depth, writes creates whole and deletes as null, and compares canonically', () => {
  const spec = { games: 3, version: 1 };
  const prev = { version: 5, games: { a: { name: 'A', rules: [1, 2], loc: null }, b: { name: 'B' } } };
  const cur = { version: 5, games: { a: { rules: [1, 2], name: 'A2' }, c: { name: 'C' } } };
  assert.deepEqual(treeDiff(prev, cur, spec), { 'games/a/name': 'A2', 'games/b': null, 'games/c': { name: 'C' } },
    'a changed field, a deleted record (null) and a created one (whole); the pruned null and the key order are no change');
  assert.deepEqual(treeDiff(cur, cur, spec), {});
  assert.deepEqual(treeDiff({ games: { a: { rules: [1, 2] } } }, { games: { a: { rules: [1, 2, 3] } } }, spec), { 'games/a/rules': [1, 2, 3] }, 'an array is one leaf');
  assert.deepEqual(treeDiff(null, { version: 3 }, spec), { version: 3 });
  assert.deepEqual(treeDiff({ version: 3 }, undefined, spec), { version: null });
  // A function spec for the odd shape: here a leaf one level in.
  assert.deepEqual(treeDiff({ m: { x: { y: 1 } } }, { m: { x: { y: 2 } } }, { m: (parts) => parts.length >= 2 }), { 'm/x': { y: 2 } });
});

test('applyOpsSafe applies ops but drops a field op whose record is gone', () => {
  const tree = { games: { a: { name: 'A' } } };
  const anchors = { games: 2 };
  const r = applyOpsSafe(tree, { 'games/a/name': 'A2', 'games/b/name': 'B2', 'games/b/_o': 1, 'games/c': { name: 'C' }, 'games/b/loc': null }, anchors);
  assert.deepEqual(r.tree, { games: { a: { name: 'A2' }, c: { name: 'C' } } }, 'the live record and a whole-record create applied');
  assert.deepEqual(r.dropped.map((d) => d.path).sort(), ['games/b/_o', 'games/b/name'], 'two field ops into a vanished record are reported (a field delete into nothing is not news)');
  assert.ok(r.dropped.every((d) => d.record === 'games/b'));
  assert.deepEqual(applyOpsSafe(tree, { 'games/a': null }, anchors).tree, {}, 'a record delete always applies');
  assert.deepEqual(tree, { games: { a: { name: 'A' } } }, 'the input is untouched');
});

test('the canonical id-space round-trips every catalog and keeps order, ids and object identity', () => {
  [CAMP.defaultConfig(), CAMPS.junior.defaultConfig(), CAMPS.senior.defaultConfig()].forEach((cfg) => {
    const back = cfgFromCanon(cfgCanon(cfg), cfg.updatedAt);
    assert.deepEqual(back.games.map((g) => g.id), cfg.games.map((g) => g.id), 'games keep their order');
    assert.deepEqual(back.days.map((d) => d.id), cfg.days.map((d) => d.id), 'days keep their order');
    assert.equal(JSON.stringify(cfgCanon(back)), JSON.stringify(cfgCanon(cfg)), 'canon of the round trip is canon of the original');
    assert.deepEqual(back.sessions, cfg.sessions);
  });
  const cfg = csClone(CAMP.defaultConfig());
  const again = cfgFromCanon(cfgCanon(cfg), cfg.updatedAt, cfg);
  assert.ok(again.games.every((g, i) => g === cfg.games[i]), 'a record whose canonical form is unchanged keeps its object');
  // Reorder = the _o field; an insert in the middle; RTDB's index-keyed map for a sparse list.
  const swapped = csClone(cfg);
  swapped.games.splice(0, 2, swapped.games[1], swapped.games[0]);
  const ops = treeDiff(cfgCanon(cfg), cfgCanon(swapped), CFG_DEPTHS);
  assert.deepEqual(Object.keys(ops).sort(), ['games/' + cfg.games[0].id + '/_o', 'games/' + cfg.games[1].id + '/_o'].sort(), 'a swap is two order ops');
  const sparse = cfgCanon({ days: { 0: { id: 'x', name: 'X' }, 2: { id: 'z', name: 'Z' } }, games: [null, { id: 'g', name: 'G', rules: [] }] });
  assert.deepEqual(Object.keys(sparse.days), ['x', 'z']);
  assert.deepEqual(Object.keys(sparse.games), ['g']);
  assert.equal(sparse.games.g.rules, undefined, 'the canonical form prunes an empty array, as the database does');
  const slash = cfgCanon({ games: [{ id: 'a/b', name: 'S' }, { id: 'a/b', name: 'S2' }] });
  assert.equal(Object.keys(slash.games).length, 2, 'a slash or a duplicate id never merges two records');
  assert.equal(cfgFromCanon(slash).games.length, 2);
});

test('fuzz: base + diff(base, edited) is edited, for random inserts, deletes, reorders and field edits (both catalogs)', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const fields = ['name', 'location', 'headline', 'emoji', 'format', 'session'];
  [CAMPS.junior.defaultConfig(), CAMPS.senior.defaultConfig()].forEach((base) => {
    for (let round = 0; round < 60; round += 1) {
      const edited = csClone(base);
      for (let k = 0; k < 1 + rnd(6); k += 1) {
        const games = edited.games;
        const pick = rnd(6);
        if (pick === 0 && games.length > 3) games.splice(rnd(games.length), 1);
        else if (pick === 1) games.splice(rnd(games.length + 1), 0, { id: 'new-' + round + '-' + k, name: 'N' + k, dayId: edited.days[0].id, session: 'Morning', format: 'placement', rules: [{ h: 'H', items: ['a'] }] });
        else if (pick === 2 && games.length > 1) { const i = rnd(games.length - 1); const t = games[i]; games[i] = games[i + 1]; games[i + 1] = t; }
        else if (pick === 3) { const d = edited.days[rnd(edited.days.length)]; d.name = 'D' + rnd(100); if (rnd(2)) d.dow = null; }
        else if (pick === 4 && edited.days.length > 1) edited.days.splice(rnd(edited.days.length), 1);
        else games[rnd(games.length)][fields[rnd(fields.length)]] = 'v' + rnd(1000);
      }
      const a = cfgCanon(base);
      const b = cfgCanon(edited);
      const ops = treeDiff(a, b, CFG_DEPTHS);
      const r = applyOpsSafe(a, ops, CFG_ANCHORS);
      assert.equal(JSON.stringify(r.tree), JSON.stringify(b), 'round ' + round + ': the ops rebuild the edit exactly');
      assert.equal(r.dropped.length, 0, 'and none of them is dropped on the tree they were measured against');
      const back = cfgCanon(cfgFromCanon(r.tree, '', base));
      assert.equal(JSON.stringify(back), JSON.stringify(b), 'round ' + round + ': and survives the list round trip');
    }
  });
});

test('healing what RTDB prunes is not an unconfirmed edit', async () => {
  const db = await csSetup();
  try {
    const remote = db.serverGet(CS_PATH);
    remote.games.forEach((g) => { delete g.rules; }); // a pruned []
    applyRemoteConfig(remote);
    assert.ok(state.config.games.every((g) => Array.isArray(g.rules)), 'migrateState healed the rules');
    assert.deepEqual(cfgUnconfirmed(), {}, 'and the healing is not a diff against the baseline');
  } finally { csTeardown(); }
});

// ── Receiving: rebase, never replace ─────────────────────────────────

test('a remote snapshot is REBASED: their field lands, my unconfirmed field stays, only mine is unconfirmed', async () => {
  const db = await csSetup();
  try {
    const [a, b] = [state.config.games[0].id, state.config.games[1].id];
    state.config.games[0].name = 'Mine';
    assert.deepEqual(Object.keys(cfgUnconfirmed()), ['games/' + a + '/name']);
    csServer(db, (c) => { c.games.find((g) => g.id === b).location = 'Theirs'; });
    assert.equal(gameById(a).name, 'Mine', 'my edit was laid back over their snapshot');
    assert.equal(gameById(b).location, 'Theirs', 'their edit landed');
    assert.deepEqual(Object.keys(cfgUnconfirmed()), ['games/' + a + '/name'], 'the baseline moved to what they sent; only mine is unconfirmed');
  } finally { csTeardown(); }
});

test('an identical snapshot keeps every record object (open views stay attached)', async () => {
  const db = await csSetup();
  try {
    const refs = state.config.games.slice();
    const remote = db.serverGet(CS_PATH);
    applyRemoteConfig(remote);
    assert.ok(state.config.games.every((g, i) => g === refs[i]), 'same objects after the echo');
    csServer(db, (c) => { c.games[2].location = 'Elsewhere'; });
    assert.ok(state.config.games.every((g, i) => i === 2 || g === refs[i]), 'only the changed record is a new object');
  } finally { csTeardown(); }
});

test('canonical comparison: key order and RTDB pruning in the snapshot are not somebody else\'s edit', async () => {
  const db = await csSetup();
  try {
    state.config.days.push({ id: 'd-new', name: 'New day', dow: null, note: '' }); // dow: null is pruned by the server
    saveConfig();
    flushPendingPush();
    await waitQuiet();
    assert.deepEqual(cfgUnconfirmed(), {}, 'the echo of my own write (key-sorted, null dropped) leaves nothing unconfirmed');
    assert.equal(pendingConfigWrites, 0);
  } finally { csTeardown(); }
});

test('the render is deferred, not the data: a snapshot that moves the catalog while a field has focus', async () => {
  const db = await csSetup();
  const real = renderAll;
  let renders = 0;
  renderAll = () => { renders += 1; };
  const wasStarted = appStarted;
  appStarted = true;
  try {
    document.activeElement = { tagName: 'INPUT' };
    csServer(db, (c) => { c.games[0].location = 'Gym'; });
    assert.equal(state.config.games[0].location, 'Gym', 'applied at once');
    assert.equal(renders, 0, 'nothing repainted under the focused field');
    assert.equal(renderOwed, true);
  } finally { document.activeElement = null; renderOwed = false; renderAll = real; appStarted = wasStarted; csTeardown(); }
});

// ── Sending: one transaction of field ops ────────────────────────────

test('two devices edit two fields of ONE game at once: both are kept, on the server and on both phones', async () => {
  const db = await csSetup();
  try {
    const id = state.config.games[0].id;
    state.config.games[0].location = 'Gym';
    saveConfig();
    // Mid-transaction another device changes a different field of the same game.
    db.contend(CS_PATH, (d) => csServer(d, (c) => { c.games.find((g) => g.id === id).headline = 'Their tagline'; }));
    flushPendingPush();
    await waitQuiet();
    const g = csGame(db, id);
    assert.equal(g.location, 'Gym', 'mine landed on the server');
    assert.equal(g.headline, 'Their tagline', 'and so did theirs (the transaction re-ran on the new value)');
    assert.equal(gameById(id).location, 'Gym');
    assert.equal(gameById(id).headline, 'Their tagline', 'my phone has their field too (rebased on the commit)');
    assert.deepEqual(cfgUnconfirmed(), {}, 'nothing left unconfirmed');
    assert.equal(pendingConfigWrites, 0);
  } finally { csTeardown(); }
});

test('the SAME field edited on both sides: the last to commit wins', async () => {
  const db = await csSetup();
  try {
    const id = state.config.games[0].id;
    state.config.games[0].location = 'Gym';
    saveConfig();
    db.contend(CS_PATH, (d) => csServer(d, (c) => { c.games.find((g) => g.id === id).location = 'Field 2'; }));
    flushPendingPush();
    await waitQuiet();
    assert.equal(csGame(db, id).location, 'Gym', 'mine committed last');
    assert.equal(gameById(id).location, 'Gym');
  } finally { csTeardown(); }
});

test('only the changed fields travel: a push never carries another record, and an old build\'s whole set() landing mid-flight is built upon', async () => {
  const db = await csSetup();
  try {
    const id = state.config.games[0].id;
    const other = state.config.games[3].id;
    state.config.games[0].location = 'Gym';
    saveConfig();
    const seen = [];
    const realTxn = fbConfigRef.transaction.bind(fbConfigRef);
    // An old build's whole set() of an older catalog lands between our read and our commit.
    db.contend(CS_PATH, (d) => { const old = d.serverGet(CS_PATH); old.games = old.games.filter((g) => g.id !== other); d.serverSet(CS_PATH, old); });
    fbConfigRef.transaction = (fn, a, b) => realTxn((cur) => { const r = fn(cur); seen.push(r); return r; }, a, b);
    flushPendingPush();
    await waitQuiet();
    assert.ok(seen.length >= 1);
    assert.equal(csGame(db, id).location, 'Gym', 'my op applied on top of the value the old build left');
    assert.equal(csGame(db, other), undefined, 'and I did not resurrect what the old build\'s set() removed (I never touched it)');
  } finally { csTeardown(); }
});

test('a snapshot that lands while my push is in flight is rebased, and never reverts a colleague\'s later edit', async () => {
  const db = await csSetup();
  try {
    const [a, b] = [state.config.games[0].id, state.config.games[1].id];
    state.config.games[0].location = 'Gym';
    saveConfig();
    flushPendingPush();                                  // the transaction is now in flight
    assert.equal(pendingConfigWrites, 1);
    // Their change lands on the server, and reaches this phone, BEFORE our commit is acknowledged.
    csServer(db, (c) => { c.games.find((g) => g.id === b).location = 'Theirs'; });
    assert.equal(gameById(b).location, 'Theirs');
    assert.equal(gameById(a).location, 'Gym', 'mine is still laid over it');
    await waitQuiet();
    assert.equal(gameById(a).location, 'Gym');
    assert.equal(gameById(b).location, 'Theirs', 'their field survived my commit\'s rebase');
    assert.equal(csGame(db, a).location, 'Gym');
    assert.deepEqual(cfgUnconfirmed(), {});
  } finally { csTeardown(); }
});

test('an edit made while the push is in flight is kept (and sent next), not overwritten by the commit', async () => {
  const db = await csSetup();
  try {
    const id = state.config.games[0].id;
    state.config.games[0].location = 'Gym';
    saveConfig();
    flushPendingPush();
    state.config.games[0].location = 'Back to the field'; // typed while the first is unacknowledged
    saveConfig();
    flushPendingPush();                                  // one transaction at a time: this one is owed
    assert.equal(configPushOwed, true);
    await waitQuiet();
    assert.equal(pendingConfigWrites, 0);
    assert.equal(configPushOwed, false);
    assert.equal(gameById(id).location, 'Back to the field');
    assert.equal(csGame(db, id).location, 'Back to the field', 'the later edit went up after the first was acknowledged');
  } finally { csTeardown(); }
});

test('a push the server cannot take (the node is gone) aborts without writing, and the edit stays unconfirmed', async () => {
  freshState();
  setMemberRole('editor');
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb();
  fbConfigRef = db.ref(CS_PATH); // no listener: the SDK has nothing cached, so the first run sees null
  configReady = true;
  remoteReady = true;
  state._cfgBase = cfgCanon(state.config);
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    state.config.games[0].name = 'Never lands';
    pushConfig();
    await waitQuiet();
    assert.equal(db.serverGet(CS_PATH), null, 'nothing was written into the empty node');
    assert.equal(pendingConfigWrites, 0);
    assert.deepEqual(Object.keys(cfgUnconfirmed()), ['games/' + state.config.games[0].id + '/name'], 'the edit is still unconfirmed');
  } finally { console.warn = realWarn; csTeardown(); }
});

test('a node emptied on the server is re-seeded from this phone, edits included, and becomes the baseline', async () => {
  const db = await csSetup();
  try {
    state.config.games[0].name = 'Survives a wipe';
    saveConfig();
    db.serverSet(CS_PATH, null);
    await waitQuiet();
    assert.equal(csGame(db, state.config.games[0].id).name, 'Survives a wipe');
    assert.deepEqual(cfgUnconfirmed(), {});
    assert.equal(pendingConfigWrites, 0);
  } finally { csTeardown(); }
});

test('the server value carries only the five config keys, and a stray already in the node is pruned', async () => {
  const db = await csSetup();
  try {
    csServer(db, (c) => { c.stray = { junk: true }; });
    state.config.games[0].name = 'Edited';
    saveConfig();
    flushPendingPush();
    await waitQuiet();
    assert.deepEqual(Object.keys(db.serverGet(CS_PATH)).sort(), CONFIG_KEYS.slice().sort());
    assert.deepEqual(Object.keys(configForSync({ version: 1, stray: 1, games: [] })).sort(), ['games', 'version']);
  } finally { csTeardown(); }
});

test('a real catalog migration (the version moved) is pushed by an editor; plain healing is not', async () => {
  const db = await csSetup();
  try {
    const old = db.serverGet(CS_PATH);
    old.version = 2; // an old week on the server
    db.serverSet(CS_PATH, old);
    await csWait(10);
    assert.equal(state.config.version, 5, 'migrated locally on receipt');
    flushPendingPush();
    clearTimeout(pushConfigTimer);
    pushConfigTimer = null;
    pushConfig();
    await waitQuiet();
    assert.equal(db.serverGet(CS_PATH).version, 5, 'and the migration went up as ops');
  } finally { csTeardown(); }
});

test('a viewer has no edits to keep: it adopts, pushes nothing, and counts no unconfirmed work', async () => {
  const db = await csSetup();
  try {
    setMemberRole('viewer');
    state.config.games[0].name = 'Not mine to send';
    csServer(db, (c) => { c.games[1].location = 'Theirs'; });
    assert.equal(state.config.games[0].name, db.serverGet(CS_PATH).games[0].name, 'the server\'s catalog, not the local scribble');
    pushConfig();
    assert.equal(db.log.filter((l) => l.kind === 'transaction').length, 0);
    assert.notOk(hasUnconfirmedLocalWork());
  } finally { csTeardown(); }
});

// ── Delete vs edit: dropped, and put back ────────────────────────────

test('delete vs edit (received first): my edit to a record somebody deleted becomes a Put-it-back note, and Put it back restores it with my change', async () => {
  const db = await csSetup();
  try {
    await csToasts(async (toasts) => {
      const id = state.config.games[0].id;
      const name = state.config.games[0].name;
      state.config.games[0].location = 'My new spot';
      csServer(db, (c) => { c.games = c.games.filter((g) => g.id !== id); }); // somebody deletes it
      assert.equal(gameById(id), undefined, 'the server wins: the game is gone here too');
      const notes = cfgNotes();
      assert.equal(notes.length, 1);
      assert.equal(notes[0].kind, 'putback');
      assert.equal(notes[0].name, name);
      assert.equal(notes[0].record.location, 'My new spot', 'the note holds my edit');
      assert.ok(toasts.some((t) => /was removed while you were editing/.test(t.msg)), toasts.map((t) => t.msg).join(' | '));
      assert.deepEqual(cfgUnconfirmed(), {}, 'nothing is pushed into a refusal');
      // Put it back.
      assert.equal(cfgPutBack(notes[0].id), true);
      assert.equal(gameById(id).location, 'My new spot', 'back, with my change');
      assert.equal(state.config.games[0].id, id, 'in its old place');
      assert.equal(cfgNotes().length, 0);
      flushPendingPush();
      await waitQuiet();
      assert.equal(csGame(db, id).location, 'My new spot', 'and re-created on the server');
    });
  } finally { csTeardown(); }
});

test('delete vs edit (found at commit): the transaction drops my op and the note appears; a bare reorder is not worth a question', async () => {
  const db = await csSetup();
  try {
    await csToasts(async () => {
      const id = state.config.games[0].id;
      state.config.games[0].location = 'Mine';
      saveConfig();
      db.contend(CS_PATH, (d) => csServer(d, (c) => { c.games = c.games.filter((g) => g.id !== id); }));
      flushPendingPush();
      await waitQuiet();
      assert.equal(csGame(db, id), undefined, 'nothing resurrected it half-built');
      assert.equal(cfgNotes().filter((n) => n.kind === 'putback').length, 1);
      assert.equal(gameById(id), undefined);
    });
  } finally { csTeardown(); }
});

test('a reorder of a game that was deleted meanwhile is dropped silently', async () => {
  const db = await csSetup();
  try {
    const [a, b] = [state.config.games[0].id, state.config.games[1].id];
    const t = state.config.games[0]; state.config.games[0] = state.config.games[1]; state.config.games[1] = t; // swap: order ops only
    csServer(db, (c) => { c.games = c.games.filter((g) => g.id !== a); });
    assert.equal(cfgNotes().length, 0, 'no question about a bare reorder');
    assert.equal(gameById(a), undefined);
    assert.ok(gameById(b));
  } finally { csTeardown(); }
});

// ── First snapshot: three-way merge ──────────────────────────────────

test('offline edit -> reload -> reconnect: the first-snapshot merge keeps the edit and sends it, beside a colleague\'s change', async () => {
  const db = await csSetup();
  try {
    const id = state.config.games[0].id;
    db.goOffline();
    state.config.games[0].location = 'Edited offline';
    saveConfig();
    const blob = localStorage.getItem(STORAGE_KEY);
    assert.ok(blob && JSON.parse(blob)._cfgBase, 'the baseline was persisted in the same write as the edit');
    // While this phone was dead, a colleague changed a different field.
    const server = db.serverGet(CS_PATH);
    server.games.find((g) => g.id === id).headline = 'Their tagline';
    const db2 = makeFakeRtdb({ manualFirstSnapshot: true });
    db2.serverSet(CS_PATH, server);
    // "Reload": a fresh page over the cache.
    const { ctx, sandbox } = makeContext({ camp: CAMP.id, storage: { [STORAGE_KEY]: blob } });
    const run = (code) => vm.runInContext(code, ctx);
    sandbox.__db = db2;
    sandbox.FIREBASE_CONFIG = { apiKey: 'test' };
    run("setMemberRole('editor'); remoteReady = true; fbConfigRef = __db.ref(dbPath('config')); attachConfigListener();");
    assert.equal(run('configEditable()'), true, 'a baseline lets it edit before the first snapshot');
    db2.deliverFirstSnapshots();
    await waitQuiet();
    const g = db2.serverGet(CS_PATH).games.find((x) => x.id === id);
    assert.equal(g.location, 'Edited offline', 'the offline edit reached the server');
    assert.equal(g.headline, 'Their tagline', 'beside the colleague\'s');
    assert.equal(run('gameById(' + JSON.stringify(id) + ').headline'), 'Their tagline');
    assert.equal(run('Object.keys(cfgUnconfirmed()).length'), 0);
    assert.equal(run('pendingConfigWrites'), 0);
  } finally { csTeardown(); }
});

// "Just booted": the listener is attached, an edit sits unconfirmed in the cache, and the
// FIRST snapshot is about to arrive (configReady is the only thing a reload resets).
function csJustBooted() {
  configReady = false;
  cfgFirstPending = null;
}

test('first-snapshot merge: the same field changed on both sides keeps the SERVER\'s, lists mine, and Use mine writes it', async () => {
  const db = await csSetup();
  try {
    await csToasts(async (toasts) => {
      const id = state.config.games[0].id;
      state.config.games[0].location = 'Field 2'; // made offline, never sent
      saveConfig();
      clearTimeout(pushConfigTimer); pushConfigTimer = null;
      csJustBooted();
      csServer(db, (c) => {
        c.games.find((g) => g.id === id).location = 'Gym';
        c.games[1].headline = 'Also theirs';
      });
      await waitQuiet();
      assert.equal(configReady, true);
      assert.equal(gameById(id).location, 'Gym', 'the server\'s value won');
      assert.equal(gameById(state.config.games[1].id).headline, 'Also theirs', 'and their other edit landed');
      const clash = cfgNotes().find((n) => n.kind === 'clash');
      assert.ok(clash, 'the lost edit is listed');
      assert.equal(clash.mine, 'Field 2');
      assert.equal(clash.theirs, 'Gym');
      assert.ok(/location/.test(clash.what));
      assert.ok(toasts.some((t) => /clashed with someone else/.test(t.msg)));
      assert.ok(undoRecent().some((e) => /Bring back your offline change/.test(e.label)), 'with a synthetic undo entry (mine as before, theirs as after)');
      assert.equal(cfgUseMine(clash.id), true);
      assert.equal(gameById(id).location, 'Field 2', 'Use mine is a normal commit');
      flushPendingPush();
      await waitQuiet();
      assert.equal(csGame(db, id).location, 'Field 2');
      assert.equal(cfgNotes().length, 0);
    });
  } finally { csTeardown(); }
});

test('first-snapshot merge: an edit inside a record the server deleted goes to Put it back, never into a refusal', async () => {
  const db = await csSetup();
  try {
    await csToasts(async () => {
      const id = state.config.games[0].id;
      state.config.games[0].location = 'Offline spot';
      saveConfig();
      clearTimeout(pushConfigTimer); pushConfigTimer = null;
      csJustBooted();
      csServer(db, (c) => { c.games = c.games.filter((g) => g.id !== id); });
      await waitQuiet();
      assert.equal(gameById(id), undefined, 'the server\'s catalog');
      assert.equal(cfgNotes().filter((n) => n.kind === 'putback' && n.key === id).length, 1);
      assert.equal(csGame(db, id), undefined, 'nothing was pushed for it');
      assert.equal(pendingConfigWrites, 0);
    });
  } finally { csTeardown(); }
});

test('first-snapshot merge: nothing outstanding is a plain adopt; a viewer never merges', async () => {
  const db = await csSetup();
  try {
    const remote = db.serverGet(CS_PATH);
    assert.equal(firstConfigMerge(remote), false, 'no unconfirmed edit: the caller adopts');
    state.config.games[0].name = 'Edited';
    setMemberRole('viewer');
    assert.equal(firstConfigMerge(remote), false, 'a viewer has nothing of its own to keep');
  } finally { csTeardown(); }
});

test('first-snapshot merge: work unconfirmed for more than 36 hours asks before it is sent', async () => {
  const db = await csSetup();
  const realConfirm = confirm;
  const asked = [];
  try {
    state.config.games[0].location = 'Old work';
    state._cfgBaseAt = Date.now() - 40 * 60 * 60 * 1000;
    confirm = (m) => { asked.push(m); return false; };
    assert.equal(firstConfigMerge(db.serverGet(CS_PATH)), true);
    await waitQuiet();
    assert.equal(asked.length, 1, 'asked once');
    assert.ok(/never reached the server/.test(asked[0]));
    assert.ok(csGame(db, state.config.games[0].id).location !== 'Old work', 'declined: not sent');
    assert.ok(state.config.games[0].location !== 'Old work', 'and the phone shows the server\'s catalog');
  } finally { confirm = realConfirm; csTeardown(); }
});

// ── The epoch ────────────────────────────────────────────────────────

test('a new camp year strands the offline edits instead of merging them (first snapshot)', async () => {
  const db = await csSetup();
  try {
    await csToasts(async (toasts) => {
      const before = strandedCount();
      state.config.games[0].location = 'Last year\'s edit';
      state._cfgBaseEpoch = 'w20260801';          // the epoch the server last confirmed to this phone
      state.meta.epoch = 'w20270801';             // the epoch the state engine has just adopted
      assert.equal(firstConfigMerge(db.serverGet(CS_PATH)), true);
      await waitQuiet();
      assert.equal(strandedCount(), before + 1, 'set aside as downloadable work');
      const entry = readStranded()[readStranded().length - 1];
      assert.ok(entry.changes[0].path.startsWith('config/games/'));
      assert.ok(state.config.games[0].location !== 'Last year\'s edit', 'not applied');
      assert.ok(csGame(db, state.config.games[0].id).location !== 'Last year\'s edit', 'and never pushed');
      assert.equal(state._cfgBaseEpoch, 'w20270801', 'the baseline took the new epoch');
      assert.ok(toasts.some((t) => /from last camp week that never synced/.test(t.msg)));
    });
  } finally { strandedList = []; state.meta.epoch = undefined; delete state.meta.epoch; csTeardown(); }
});

test('the config baseline follows the state engine\'s epoch: nothing unconfirmed just updates it; unconfirmed work is stranded then', async () => {
  const db = await csSetup();
  try {
    await csToasts(async () => {
      state.meta.epoch = 'w20270801';
      cfgFollowStateEpoch();
      assert.equal(state._cfgBaseEpoch, 'w20270801', 'a device with nothing unconfirmed follows silently');
      assert.equal(strandedCount(), 0);
      // Now an offline edit made in the NEW year survives (its base epoch matches) ...
      state.config.games[0].location = 'This year';
      cfgFollowStateEpoch();
      assert.equal(state.config.games[0].location, 'This year', 'same epoch: untouched');
      // ... but an edit still unconfirmed when a THIRD epoch arrives is last year's.
      state.meta.epoch = 'w20280801';
      cfgFollowStateEpoch();
      assert.equal(strandedCount(), 1);
      assert.ok(state.config.games[0].location !== 'This year');
      assert.equal(state._cfgBaseEpoch, 'w20280801');
    });
  } finally { strandedList = []; delete state.meta.epoch; csTeardown(); }
});

test('a legacy week (no epoch anywhere) is untouched by all of it', async () => {
  const db = await csSetup();
  try {
    state.config.games[0].location = 'Legacy edit';
    cfgFollowStateEpoch();
    assert.equal(state.config.games[0].location, 'Legacy edit');
    assert.equal(strandedCount(), 0);
    assert.equal(state._cfgBaseEpoch, '');
  } finally { csTeardown(); }
});

// ── Accounting ───────────────────────────────────────────────────────

test('an unconfirmed edit is counted by every guard until the server acknowledges it', async () => {
  const db = await csSetup();
  try {
    assert.notOk(hasUnconfirmedLocalWork());
    state.config.games[0].name = 'Not yet sent';
    assert.ok(hasUnconfirmedLocalWork(), 'a sign-out would lose it, even with no write in flight (the persisted baseline says so)');
    saveConfig();
    db.goOffline();
    flushPendingPush();
    assert.equal(pendingConfigWrites, 1);
    assert.ok(reloadBlocked());
    assert.ok(hasUnsyncedWork());
    assert.ok(canAdoptRemote(), 'state adoption is unaffected');
    db.goOnline();
    await waitQuiet();
    assert.equal(pendingConfigWrites, 0);
    assert.notOk(hasUnconfirmedLocalWork());
    assert.notOk(reloadBlocked());
  } finally { csTeardown(); }
});

test('a failed push is retried by the next builder change and reported, not lost', async () => {
  const db = await csSetup();
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    await csToasts(async (toasts) => {
      db.refuse(CS_PATH);
      state.config.games[0].name = 'Refused';
      saveConfig();
      flushPendingPush();
      await waitQuiet();
      assert.ok(toasts.some((t) => /Couldn't save the week setup/.test(t.msg)));
      assert.equal(pendingConfigWrites, 0, 'the counter did not wedge');
      assert.ok(Object.keys(cfgUnconfirmed()).length, 'the edit is still on this phone, unconfirmed');
    });
  } finally { console.warn = realWarn; csTeardown(); }
});

test('Put it back / Use mine refuse while the catalog cannot be edited', async () => {
  const db = await csSetup();
  try {
    csToasts((toasts) => {
      cfgSetNotes([{ id: 'n1', kind: 'putback', section: 'games', key: 'zzz', name: 'Zzz', record: { id: 'zzz', name: 'Zzz', _o: 0 }, at: '' }]);
      setMemberRole('viewer');
      assert.equal(cfgPutBack('n1'), false);
      assert.equal(gameById('zzz'), undefined);
      assert.ok(toasts.length >= 1);
    });
  } finally { csTeardown(); }
});

// ── Review fixes: positions never clash, ids never overwrite, a new year forgets ──

const csIds = (c) => (c.games || []).map((g) => g.id);

// A phone that edited offline, then reloaded: configReady false, the cache holds the edit,
// the server (and then its colleague) moves on, and the first snapshot lands.
async function csOffline(db, edit, server) {
  edit();
  saveConfig();
  clearTimeout(pushConfigTimer); pushConfigTimer = null;
  csJustBooted();
  csServer(db, server);
  await waitQuiet();
  assert.equal(configReady, true);
}

test('first-snapshot merge: an offline delete beside a colleague\'s EARLIER delete or insert is kept — a renumbering is not a clash', async () => {
  for (const colleague of ['delete', 'insert', 'swap-head']) {
    const db = await csSetup();
    try {
      await csToasts(async (toasts) => {
        const ids = csIds(state.config);
        const victim = ids[10];
        await csOffline(db, () => { state.config.games.splice(10, 1); }, (c) => {
          if (colleague === 'delete') c.games.splice(2, 1);
          else if (colleague === 'insert') c.games.unshift({ id: 'their-new', name: 'Their new', dayId: c.days[0].id, session: 'Morning', format: 'placement', rules: [] });
          else { const t = c.games[0]; c.games[0] = c.games[1]; c.games[1] = t; }
        });
        const server = db.serverGet(CS_PATH);
        assert.equal(csGame(db, victim), undefined, colleague + ': my delete reached the server');
        assert.equal(gameById(victim), undefined, 'and this phone');
        assert.deepEqual(cfgNotes(), [], colleague + ': no clash note');
        assert.notOk(toasts.some((t) => /clashed/.test(t.msg)), 'and no toast');
        const expect = csIds(db.serverGet(CS_PATH)).filter((x) => x !== victim);
        assert.deepEqual(csIds(server), expect, 'the colleague\'s order, minus my delete');
        assert.deepEqual(state.config.games.map((g) => g.id), expect, 'this phone agrees');
        assert.deepEqual(cfgUnconfirmed(), {});
      });
    } finally { csTeardown(); }
  }
});

test('first-snapshot merge: my reorder survives a colleague\'s earlier delete or insert (relative order, not stale numbers)', async () => {
  const db = await csSetup();
  try {
    await csToasts(async () => {
      const ids = csIds(state.config);
      const [a, b] = ids.slice(-2);
      await csOffline(db, () => {
        const g = state.config.games;
        const t = g[g.length - 1]; g[g.length - 1] = g[g.length - 2]; g[g.length - 2] = t; // swap the last two
      }, (c) => { c.games.splice(0, 1); });
      const server = csIds(db.serverGet(CS_PATH));
      assert.equal(server.indexOf(b) < server.indexOf(a), true, 'the swap landed on the server');
      assert.deepEqual(server.slice(0, -2), ids.slice(1, -2), 'the colleague\'s delete too, everything else in order');
      assert.deepEqual(state.config.games.map((g) => g.id), server);
    });
  } finally { csTeardown(); }
});

test('first-snapshot merge: a reorder both of us made keeps the SERVER\'s order, quietly', async () => {
  const db = await csSetup();
  try {
    await csToasts(async (toasts) => {
      const ids = csIds(state.config);
      await csOffline(db, () => { const g = state.config.games; [g[0], g[1]] = [g[1], g[0]]; }, (c) => {
        const g = c.games; [g[1], g[2]] = [g[2], g[1]];
      });
      const server = csIds(db.serverGet(CS_PATH));
      assert.deepEqual(server.slice(0, 3), [ids[0], ids[2], ids[1]], 'theirs stands');
      assert.deepEqual(cfgNotes(), [], 'a lost reorder is not worth a question');
      assert.equal(toasts.length, 0);
    });
  } finally { csTeardown(); }
});

test('first-snapshot merge: a delete that LOSES (the colleague edited that game) leaves every neighbour where it was', async () => {
  for (const at of [3, 8, 14]) {
    const db = await csSetup();
    try {
      await csToasts(async () => {
        const ids = csIds(state.config);
        const victim = ids[at];
        await csOffline(db, () => { state.config.games.splice(at, 1); }, (c) => { c.games[at].headline = 'Their tagline'; });
        assert.deepEqual(csIds(db.serverGet(CS_PATH)), ids, 'at ' + at + ': the order on the server is the one it had (no tie-break swap)');
        assert.deepEqual(state.config.games.map((g) => g.id), ids);
        const note = cfgNotes()[0];
        assert.equal(note.kind, 'clash');
        assert.equal(note.path, 'games/' + victim);
        assert.equal(note.mine, null);
        assert.ok(/game “/.test(note.what), 'named in words: ' + note.what);
      });
    } finally { csTeardown(); }
  }
});

test('first-snapshot merge: a create that already reached the server is not a clash, even when a colleague moved things since', async () => {
  const db = await csSetup();
  try {
    await csToasts(async (toasts) => {
      const mineGame = { id: 'brand-new-a1b2', name: 'Brand new', dayId: state.config.days[0].id, session: 'Morning', format: 'placement', rules: [] };
      await csOffline(db, () => { state.config.games.push(Object.assign({}, mineGame)); }, (c) => {
        // The transaction DID commit (the page reloaded before the ack), and a colleague then inserted at the top.
        c.games.push(Object.assign({}, mineGame));
        c.games.unshift({ id: 'their-new', name: 'Their new', dayId: c.days[0].id, session: 'Morning', format: 'placement', rules: [] });
      });
      assert.deepEqual(cfgNotes(), []);
      assert.equal(toasts.length, 0, 'no false "clashed" toast');
      assert.equal(csIds(db.serverGet(CS_PATH)).filter((x) => x === mineGame.id).length, 1, 'one copy');
      assert.equal(state.config.games.filter((g) => g.id === mineGame.id).length, 1);
      assert.equal(undoRecent().length, 0, 'and no synthetic undo entry');
    });
  } finally { csTeardown(); }
});

test('first-snapshot merge: a new game of mine under an id a colleague also minted is set aside (never overwriting theirs), and Add mine as a new one re-keys it', async () => {
  const db = await csSetup();
  try {
    await csToasts(async (toasts) => {
      const day = state.config.days[0].id;
      await csOffline(db,
        () => { state.config.games.push({ id: 'rain-bowling', name: 'Rain bowling by A', dayId: day, session: 'Morning', format: 'placement', rules: [] }); },
        (c) => { c.games.push({ id: 'rain-bowling', name: 'Rain bowling by B', dayId: day, session: 'Morning', format: 'tally', rules: [] }); });
      assert.equal(csGame(db, 'rain-bowling').name, 'Rain bowling by B', 'the colleague\'s game stands on the server');
      assert.equal(gameById('rain-bowling').name, 'Rain bowling by B', 'and on this phone');
      const note = cfgNotes().find((n) => n.kind === 'putback');
      assert.ok(note && note.collide && note.name === 'Rain bowling by A');
      assert.ok(toasts.some((t) => /couldn’t be added/.test(t.msg)));
      assert.equal(cfgPutBack(note.id), true);
      flushPendingPush();
      await waitQuiet();
      const names = (db.serverGet(CS_PATH).games || []).map((g) => g.name);
      assert.ok(names.includes('Rain bowling by A') && names.includes('Rain bowling by B'), 'both games exist now');
      const mineNow = state.config.games.find((g) => g.name === 'Rain bowling by A');
      assert.ok(/^rain-bowling-[a-z0-9]{4}$/.test(mineNow.id), 'under a fresh id: ' + mineNow.id);
      assert.equal(gameById('rain-bowling').name, 'Rain bowling by B', 'theirs untouched');
      assert.deepEqual(cfgNotes(), []);
    });
  } finally { csTeardown(); }
});

test('the engine never overwrites a different record with a create: in my push\'s transaction, and on a snapshot that lands first', async () => {
  const day = () => state.config.days[0].id;
  const mk = (name) => ({ id: 'rain-bowling', name, dayId: day(), session: 'Morning', format: 'placement', rules: [] });
  // (1) found at commit
  let db = await csSetup();
  try {
    await csToasts(async (toasts) => {
      state.config.games.push(mk('Rain bowling by A'));
      saveConfig();
      db.contend(CS_PATH, (d) => csServer(d, (c) => { c.games.push(mk('Rain bowling by B')); }));
      flushPendingPush();
      await waitQuiet();
      assert.equal(csGame(db, 'rain-bowling').name, 'Rain bowling by B', 'the established game was not replaced');
      assert.equal(gameById('rain-bowling').name, 'Rain bowling by B', 'this phone follows the server');
      assert.ok(cfgNotes().some((n) => n.collide && n.name === 'Rain bowling by A'), 'mine is a note, not a loss ');
      assert.equal(cfgNotes().length, 1, 'once, not once per path that noticed');
      assert.equal(toasts.filter((t) => /couldn’t be added/.test(t.msg)).length, 1);
      assert.ok(toasts.some((t) => /couldn’t be added/.test(t.msg)), 'and I was told');
      assert.deepEqual(cfgUnconfirmed(), {}, 'nothing stays unconfirmed');
    });
  } finally { csTeardown(); }
  // (2) the colleague's game arrives as a snapshot while mine is still unsent
  db = await csSetup();
  try {
    await csToasts(async () => {
      state.config.games.push(mk('Rain bowling by A'));
      saveConfig();
      clearTimeout(pushConfigTimer); pushConfigTimer = null;
      csServer(db, (c) => { c.games.push(mk('Rain bowling by B')); });
      await waitQuiet();
      assert.equal(gameById('rain-bowling').name, 'Rain bowling by B');
      assert.ok(cfgNotes().some((n) => n.collide), 'listed');
    });
  } finally { csTeardown(); }
});

test('applyOpsSafe: a create over an identical record is skipped (the server keeps its position), over a different one is dropped as a collision, and a deliberate overwrite applies', () => {
  const anchors = { games: 2 };
  const tree = { games: { x: { id: 'x', name: 'Theirs', _o: 0 } } };
  let r = applyOpsSafe(tree, { 'games/x': { id: 'x', name: 'Theirs', _o: 5 } }, anchors);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.tree.games.x._o, 0, 'identical content: its position is the server\'s');
  r = applyOpsSafe(tree, { 'games/x': { id: 'x', name: 'Mine', _o: 1 } }, anchors);
  assert.equal(r.tree.games.x.name, 'Theirs');
  assert.deepEqual(r.dropped.map((d) => [d.path, d.record, d.collide]), [['games/x', 'games/x', true]]);
  r = applyOpsSafe(tree, { 'games/x': { id: 'x', name: 'Mine', _o: 1 } }, anchors, { overwrite: true });
  assert.equal(r.tree.games.x.name, 'Mine');
  r = applyOpsSafe(tree, { 'games/y': { id: 'y', name: 'New', _o: 1 } }, anchors);
  assert.ok(r.tree.games.y && r.dropped.length === 0, 'a create into free space is a create');
});

test('Put it back heals what the canonical form prunes, like every other apply (an empty rules[] comes back an array)', async () => {
  const db = await csSetup();
  try {
    csToasts(() => {
      const rec = { id: 'quick-1', name: 'Quick', dayId: state.config.days[0].id, session: 'Morning', format: 'placement', _o: 3 };
      cfgSetNotes([{ id: 'n1', kind: 'putback', section: 'games', key: 'quick-1', name: 'Quick', record: rec, at: '' }]);
      assert.equal(cfgPutBack('n1'), true);
      assert.ok(Array.isArray(gameById('quick-1').rules), 'rules is [] again, not undefined');
      assert.equal(state.config.games.findIndex((g) => g.id === 'quick-1'), 3, 'at its old place');
    });
  } finally { csTeardown(); }
});

test('Use mine keeps its note when nothing could be written: the record is gone, or removing it would throw away scores', async () => {
  const db = await csSetup();
  try {
    csToasts((toasts) => {
      const gone = { id: 'n1', kind: 'clash', path: 'games/vanished/location', mine: 'Gym', theirs: 'Field', what: 'game “Vanished” · location', at: '' };
      cfgSetNotes([gone]);
      assert.equal(cfgUseMine('n1'), false);
      assert.equal(cfgNotes().length, 1, 'the note stays so the person can still Dismiss it knowingly');
      assert.ok(/removed since/.test(toasts[toasts.length - 1].msg));
      // "Delete it anyway" on a game that has a saved result is the builder's confirm, not a side door.
      const g = state.config.games[0];
      state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
      cfgSetNotes([{ id: 'n2', kind: 'clash', path: 'games/' + g.id, mine: null, theirs: syncCanon(g), what: 'game “' + g.name + '”', at: '' }]);
      assert.equal(cfgUseMine('n2'), false);
      assert.ok(gameById(g.id), 'still there');
      assert.ok(/saved result/.test(toasts[toasts.length - 1].msg), toasts[toasts.length - 1].msg);
      delete state.results[g.id];
      assert.equal(cfgUseMine('n2'), true, 'with nothing recorded it is an ordinary delete');
      assert.equal(gameById(g.id), undefined);
    });
  } finally { csTeardown(); }
});

test('a phone back from a new camp year forgets last year\'s notes and undo history — even with nothing unconfirmed', async () => {
  const db = await csSetup();
  try {
    await csToasts(async () => {
      cfgSetNotes([{ id: 'n1', kind: 'putback', section: 'games', key: 'old', name: 'Old', record: { id: 'old', name: 'Old', _o: 0 }, at: '' }]);
      configEdit('Last year\'s edit', () => { state.config.games[0].location = 'Somewhere'; });
      const remote = db.serverGet(CS_PATH);
      remote.games[0].location = 'Somewhere'; // the server holds it (confirmed) — nothing of mine is outstanding
      db.serverSet(CS_PATH, remote);
      await waitQuiet();
      assert.equal(cfgNotes().length, 1);
      assert.ok(undoRecent().length >= 1);
      // The "reload": new epoch from the state engine, the baseline still carries the old one.
      csJustBooted();
      state.meta.epoch = 'w20270606';
      state._cfgBaseEpoch = '';
      processFirstConfig(db.serverGet(CS_PATH));
      assert.deepEqual(cfgNotes(), [], 'Put it back can no longer carry last year\'s game into this year');
      assert.deepEqual(undoRecent(), []);
      assert.equal(state._cfgBaseEpoch, 'w20270606');
    });
  } finally { delete state.meta.epoch; strandedList = []; csTeardown(); }
});

test('the stranded download names id-keyed paths a person can read', () => {
  const j = JSON.parse(strandedDownloadJson());
  assert.ok(/config\/games\/<game id>\/<field>/.test(j.note));
});

test('fuzz: the first-snapshot merge converges, loses no foreign edit, applies every untouched delete and never duplicates (inserts, deletes, swaps, field edits on both sides)', async () => {
  let seed = 20261102;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (n) => Math.floor(rnd() * n);
  for (let round = 0; round < 30; round++) {
    const db = await csSetup();
    try {
      await csToasts(async () => {
        const base = csIds(state.config);
        const day = state.config.days[0].id;
        const myDel = new Set(); const theirDel = new Set(); const theirEdit = {}; const myEdit = {};
        const mkNew = (tag) => ({ id: tag + '-' + round, name: tag + ' ' + round, dayId: day, session: 'Morning', format: 'placement', rules: [] });
        const mineOps = () => {
          const g = state.config.games;
          for (let k = pick(3); k > 0; k--) { const i = pick(g.length); myDel.add(g[i].id); g.splice(i, 1); }
          if (rnd() < 0.5) g.splice(pick(g.length + 1), 0, mkNew('mine'));
          if (rnd() < 0.5 && g.length > 1) { const i = pick(g.length - 1); [g[i], g[i + 1]] = [g[i + 1], g[i]]; }
          if (rnd() < 0.7) { const x = g[pick(g.length)]; myEdit[x.id] = 'mine-loc-' + round; x.location = myEdit[x.id]; }
        };
        const theirOps = (c) => {
          for (let k = pick(3); k > 0; k--) { const i = pick(c.games.length); theirDel.add(c.games[i].id); c.games.splice(i, 1); }
          if (rnd() < 0.5) c.games.splice(pick(c.games.length + 1), 0, mkNew('their'));
          if (rnd() < 0.5 && c.games.length > 1) { const i = pick(c.games.length - 1); [c.games[i], c.games[i + 1]] = [c.games[i + 1], c.games[i]]; }
          for (let k = 1 + pick(3); k > 0; k--) { const x = c.games[pick(c.games.length)]; theirEdit[x.id] = 'their-tag-' + round + '-' + k; x.headline = theirEdit[x.id]; }
        };
        await csOffline(db, mineOps, theirOps);
        flushPendingPush();
        await waitQuiet();
        const server = db.serverGet(CS_PATH);
        const sIds = csIds(server);
        const where = ' (round ' + round + ')';
        assert.equal(new Set(sIds).size, sIds.length, 'no duplicate ids' + where);
        assert.deepEqual(state.config.games.map((g) => g.id), sIds, 'the phone and the server agree on the list and its order' + where);
        assert.deepEqual(cfgUnconfirmed(), {}, 'nothing left unconfirmed' + where);
        base.forEach((id) => {
          const touchedByThem = theirDel.has(id) || theirEdit[id] !== undefined;
          if (theirDel.has(id)) assert.ok(!sIds.includes(id), id + ' stays deleted (colleague)' + where);
          else if (myDel.has(id) && !touchedByThem) assert.ok(!sIds.includes(id), id + ': my delete of an untouched game applied' + where);
          else if (myDel.has(id)) assert.ok(sIds.includes(id), id + ': their edit beats my delete' + where);
          else assert.ok(sIds.includes(id), id + ' untouched survives' + where);
          const sg = server.games.find((g) => g.id === id);
          if (sg && theirEdit[id] !== undefined) assert.equal(sg.headline, theirEdit[id], 'their edit of ' + id + ' kept' + where);
          if (sg && myEdit[id] !== undefined) assert.equal(sg.location, myEdit[id], 'my edit of ' + id + ' kept' + where);
        });
        assert.ok(!server.games.some((g) => g.name === 'their ' + round) || sIds.includes('their-' + round), 'their insert survives' + where);
        assert.ok(!state.config.games.some((g) => g.name === 'mine ' + round) || sIds.includes('mine-' + round), 'my insert reached the server' + where);
      });
    } finally { csTeardown(); }
  }
});
