// S2d — a phone's unsent work from a PREVIOUS camp year is stranded, never applied
// (setup-rebuild-spec §6.2 #3, §6.11).
//
// The new-year wizard (Step 28, not built yet) stamps `state/meta/epoch`. A phone that
// was away across it comes back holding edits made against last year's tree. The
// first-snapshot three-way merge would re-apply every path "nobody touched" — and the
// wizard's clear touched them all, so nobody did. Now, when the epoch the server last
// confirmed to this phone (the cached base's) differs from the one the server holds, NONE
// of this phone's paths are kept: they go to lsKey('campScoreboardStranded') as
// downloadable JSON, the server's tree is adopted, nothing is pushed, and a bar offers
// Download / Dismiss. Until an epoch exists both sides read '' and nothing changes — the
// first half of this file pins that (the legacy week, every camp today).
// Driven against the in-memory database in tests/fake-rtdb.js through the app's real
// fbRef, with a "second device" (the wizard, the console) writing straight into it.

const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');
const STATE_PATH = dbPath('state'); // the active camp's root, so the senior twin runs the same file
const serverState = (db) => db.serverTree()[CAMP.dbRoot].state;
const wait = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 5 : ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const res = (n) => ({ medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'v' + n });
// Every state write acknowledged (and any refusal bisected) — waited for, not guessed at: a bounded poll of ~80 ms gave up
// early when the process stalled and the next assertion saw a write still in flight.
const settled = async () => { await waitUntil(() => pendingWrites === 0 && !stateBisecting, 'every state write to be acknowledged'); await wait(2); };
const STRANDED = () => lsKey('campScoreboardStranded');
const storedStranded = () => JSON.parse(localStorage.getItem(STRANDED()) || '[]');
const bar = () => document.getElementById('sync-alert');

let toasts = [];
let serverRoster = null; // the roster the server holds, as of boot (a rename made offline must not leak into it)
showToast = (m) => { toasts.push(m); };

// A fake database holding `serverMeta` (the epoch the server is on), adopted as this
// editor's confirmed baseline — a phone that was connected last session.
async function boot(serverMeta) {
  freshState();
  setMemberRole('editor');
  toasts = [];
  strandedList = null;
  localStorage.removeItem(STRANDED());
  if (serverMeta) state.meta = Object.assign({}, state.meta, serverMeta);
  serverRoster = clone(syncedSnapshot().teams);
  const db = makeFakeRtdb();
  const ref = db.ref(STATE_PATH);
  await ref.set(syncedSnapshot());
  const snap = await ref.once('value');
  fbRef = ref;
  remoteReady = true; pendingWrites = 0; dataEditPending = false; clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  applyingRemote = false; document.activeElement = null;
  stateQuarantine = {}; stateBisecting = false; stateBisectQueue = []; stateBisectHeld = false;
  delete state._quarantine;
  applyRemoteState(snap.val());
  clearTimeout(pushTimer); pushTimer = null;
  pushState();
  await settled();
  db.log.length = 0;
  return db;
}

function teardown() {
  // A debounced push left pending would fire into the NEXT test's database (the app's timer outlives the case).
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  fbRef = null; remoteReady = false; pendingWrites = 0; dataEditPending = false;
  stateQuarantine = {}; stateBisecting = false; stateBisectQueue = []; stateBisectHeld = false;
  delete state._quarantine;
  strandedList = null;
  localStorage.removeItem(STRANDED());
  setMemberRole(null);
}

// Saved on the phone with no network: written to the cache, never sent.
function saveOffline(fn) {
  fn();
  touchData(); saveState();
  clearTimeout(pushTimer); pushTimer = null;
}

// The phone reloads; its first snapshot of the new session is pending.
function reload(db) {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY));
  normalizeSyncedState();
  bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  strandedList = null; // a new page: the stranded store is read afresh
  remoteReady = false; lastSyncedTree = null; dirtySinceLoad = false; pendingWrites = 0; dataEditPending = false;
  toasts = [];
  fbRef = db.ref(STATE_PATH);
}

// What the new-year wizard's atomic commit leaves: a whole roster, no scores, the new epoch.
async function newYear(db, epoch) {
  const teams = clone(serverRoster);
  await db.ref(STATE_PATH).set({ teams, meta: { epoch, epochAt: 1790000000000, lastDataChangeAt: '2027-07-18T12:00:00.000Z' } });
}

async function firstPull(db) {
  const snap = await db.ref(STATE_PATH).once('value');
  db.log.length = 0;
  handleRemoteSnapshot(snap.val());
  await settled();
}

// ── the legacy week: a no-op ─────────────────────────────────────

test('no epoch on either side: offline work is still re-applied and sent, nothing is stranded', async () => {
  const db = await boot();
  try {
    saveOffline(() => { state.results.gA = res(1); });
    await db.ref(STATE_PATH).update({ 'results/gB': res(2) }); // someone else scored a different game
    reload(db);
    await firstPull(db);
    assert.ok(state.results.gA && state.results.gB, 'both survive the merge');
    assert.ok(serverState(db).results.gA, 'ours reached the server');
    assert.equal(strandedCount(), 0);
    assert.equal(localStorage.getItem(STRANDED()), null, 'nothing was written');
    assert.equal(toasts.filter((t) => /last camp week/.test(t)).length, 0);
    updateSyncIndicator();
    assert.equal(bar().hidden, true);
  } finally { teardown(); }
});

test('the same epoch on both sides is an ordinary merge too', async () => {
  const db = await boot({ epoch: 'w20270718', epochAt: 1790000000000 });
  try {
    saveOffline(() => { state.results.gA = res(1); });
    reload(db);
    assert.equal(epochOfTree(bootSyncedTree), 'w20270718', 'the confirmed base carries the epoch the server is on');
    await firstPull(db);
    assert.ok(serverState(db).results.gA, 'this year\'s offline score is sent');
    assert.equal(strandedCount(), 0);
  } finally { teardown(); }
});

test('epochOfTree: a string, else the legacy week', () => {
  assert.equal(epochOfTree({ meta: { epoch: 'w20270718' } }), 'w20270718');
  assert.equal(epochOfTree({ meta: {} }), '');
  assert.equal(epochOfTree({ meta: { epoch: 7 } }), '');
  assert.equal(epochOfTree({}), '');
  assert.equal(epochOfTree(null), '');
});

// ── a new epoch: strand, adopt, push nothing ─────────────────────

test('work saved before the new year is stranded: not applied, never pushed, the server tree adopted', async () => {
  const db = await boot();
  try {
    saveOffline(() => { state.results.gA = res(1); state.results.gB = res(2); });
    await newYear(db, 'w20270718'); // the wizard cleared everything while this phone was away
    reload(db);
    await firstPull(db);
    assert.equal(state.results.gA, undefined, 'last year\'s result is not in this year');
    assert.equal(state.results.gB, undefined);
    assert.equal(state.meta.epoch, 'w20270718', 'the server\'s tree was adopted');
    assert.equal(serverState(db).results, undefined, 'and nothing was written into the new year');
    assert.equal(db.log.length, 0, 'not one write of any kind');
    assert.equal(epochOfTree(confirmedTree), 'w20270718', 'the confirmed base follows, so the next reload has nothing outstanding');
    const kept = storedStranded();
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0].changes.map((c) => c.path).sort(), ['results/gA', 'results/gB']);
    assert.equal(kept[0].from, 'legacy');
    assert.equal(kept[0].to, 'w20270718');
    assert.deepEqual(kept[0].changes.find((c) => c.path === 'results/gA').value, syncCanon(res(1)), 'in the canonical form the merge compares');
    assert.ok(kept[0].lastSyncedAt, 'when this phone last heard from the server');
    assert.equal(strandedCount(), 2, 'the activity stamp is not a change the person made');
  } finally { teardown(); }
});

test('the toast counts the changes and says where the Download is', async () => {
  const db = await boot();
  try {
    saveOffline(() => { state.results.gA = res(1); });
    await newYear(db, 'w20270718');
    reload(db);
    await firstPull(db);
    const t = toasts.filter((m) => /last camp week/.test(m));
    assert.equal(t.length, 1);
    assert.ok(/1 change from last camp week that never synced/.test(t[0]), t[0]);
    assert.ok(/It wasn’t added to this week/.test(t[0]) && /Download it/.test(t[0]), t[0]);
    toasts = [];
    const db2 = await boot();
    saveOffline(() => { state.results.gA = res(1); state.results.gB = res(2); state.results.gC = res(3); });
    await newYear(db2, 'w20270718');
    reload(db2);
    await firstPull(db2);
    assert.ok(/3 changes from last camp week/.test(toasts.filter((m) => /last camp week/.test(m))[0]));
  } finally { teardown(); }
});

test('a later epoch than the last one this phone saw, and an epoch going back to the legacy week, both strand', async () => {
  const db = await boot({ epoch: 'w20270718', epochAt: 1790000000000 });
  try {
    saveOffline(() => { state.results.gA = res(1); });
    await newYear(db, 'w20280716');
    reload(db);
    await firstPull(db);
    assert.equal(state.results.gA, undefined);
    assert.equal(storedStranded()[0].from, 'w20270718');
    assert.equal(storedStranded()[0].to, 'w20280716');
  } finally { teardown(); }
  const db2 = await boot({ epoch: 'w20270718', epochAt: 1790000000000 });
  try {
    saveOffline(() => { state.results.gB = res(2); });
    // "Undo the new-year setup": the epoch keys are deleted, the rest of meta stays.
    await db2.ref(STATE_PATH).set({ teams: clone(serverRoster), meta: { lastDataChangeAt: '2027-07-18T12:00:00.000Z' } });
    reload(db2);
    await firstPull(db2);
    assert.equal(state.results.gB, undefined);
    assert.equal(state.meta.epoch, undefined);
    assert.equal(storedStranded()[0].to, 'legacy', 'the legacy week is named, never an empty string');
    assert.equal(db2.log.length, 0);
  } finally { teardown(); }
});

test('every kind of path is stranded together: a team rename and a deletion as well as scores', async () => {
  const db = await boot();
  try {
    await db.ref(STATE_PATH).update({ 'results/gOld': res(0) });
    const snap = await db.ref(STATE_PATH).once('value');
    applyRemoteState(snap.val()); // last year's server copy had a result, now confirmed here
    saveOffline(() => {
      state.teams[0].name = 'Offline Eagles';
      delete state.results.gOld;
      state.results.gA = res(1);
    });
    await newYear(db, 'w20270718');
    reload(db);
    await firstPull(db);
    const paths = storedStranded()[0].changes.map((c) => c.path).sort();
    assert.ok(paths.includes('teams/0/name'), paths.join());
    assert.ok(paths.includes('results/gA'));
    assert.ok(paths.includes('results/gOld'), 'a deletion is work too');
    assert.equal(storedStranded()[0].changes.find((c) => c.path === 'results/gOld').value, null);
    assert.ok(state.teams[0].name !== 'Offline Eagles', 'the new year\'s roster stands');
  } finally { teardown(); }
});

test('only the activity stamp outstanding: a plain adopt, nothing stranded, no toast', async () => {
  const db = await boot();
  try {
    saveOffline(() => {}); // touchData stamps meta/lastDataChangeAt and nothing else
    await newYear(db, 'w20270718');
    reload(db);
    await firstPull(db);
    assert.equal(state.meta.epoch, 'w20270718', 'the server\'s tree is adopted');
    assert.equal(strandedCount(), 0);
    assert.equal(toasts.filter((m) => /last camp week/.test(m)).length, 0);
    assert.equal(db.log.length, 0);
  } finally { teardown(); }
});

test('an EMPTY node says nothing about an epoch: the console-wipe rule is unchanged', async () => {
  const db = await boot({ epoch: 'w20270718', epochAt: 1790000000000 });
  try {
    saveOffline(() => { state.results.gA = res(1); });
    await db.ref(STATE_PATH).remove(); // a fresh session started from the console
    reload(db);
    bootHadConfirmedBase = true;
    handleRemoteSnapshot(null);
    await settled();
    assert.equal(strandedCount(), 0, 'not stranded: there is no epoch to compare');
    assert.ok(serverState(db) && serverState(db).results && serverState(db).results.gA, 'our own edit is pushed back, as before');
  } finally { teardown(); }
});

test('a result the phone never confirmed is stranded even when the new year left the same game id', async () => {
  const db = await boot();
  try {
    saveOffline(() => { state.results.gA = res(1); });
    await newYear(db, 'w20270718');
    await db.ref(STATE_PATH).update({ 'results/gA': res(9) }); // this year's real result for the same game
    reload(db);
    await firstPull(db);
    assert.equal(state.results.gA.savedAt, 'v9', 'this year\'s value stands, with no "changed by someone else" toast');
    assert.equal(toasts.filter((m) => /changed by someone else/.test(m)).length, 0);
    assert.deepEqual(storedStranded()[0].changes[0].value, syncCanon(res(1)), 'and last year\'s is kept in the download');
  } finally { teardown(); }
});

test('a refused edit parked from last year goes with the rest: no red bar over a new year', async () => {
  const db = await boot();
  try {
    saveOffline(() => { state.results.gA = res(1); });
    stateQuarantine = { 'results/gA': res(1) };
    state._quarantine = stateQuarantine;
    saveState();
    await newYear(db, 'w20270718');
    reload(db);
    stateQuarantine = readQuarantine(); // what a reload reads back
    assert.equal(Object.keys(stateQuarantine).length, 1);
    await firstPull(db);
    assert.deepEqual(stateQuarantine, {}, 'parked set cleared');
    assert.equal(state._quarantine, undefined);
    assert.equal(state.results.gA, undefined, 'and not laid back over the server\'s tree');
    assert.equal(storedStranded()[0].changes[0].path, 'results/gA');
    assert.equal(db.log.length, 0);
  } finally { teardown(); }
});

// ── it survives, and says so ─────────────────────────────────────

test('stranded work survives a reload and the same work is never kept twice', async () => {
  const db = await boot();
  try {
    saveOffline(() => { state.results.gA = res(1); });
    await newYear(db, 'w20270718');
    reload(db);
    await firstPull(db);
    assert.equal(storedStranded().length, 1);
    strandedList = null; // another page load
    assert.equal(strandedCount(), 1, 'read back from storage');
    // Two tabs (or a crash between the set-aside and the adopt) strand identical work: one entry.
    addStranded(clone(storedStranded()[0]));
    assert.equal(storedStranded().length, 1);
    // A different set of changes is a second entry, and only the newest ten are kept.
    for (let i = 0; i < STRANDED_MAX_ENTRIES + 3; i++) {
      addStranded({ at: 'x', from: 'legacy', to: 'w20270718', lastSyncedAt: null, changes: [{ path: 'results/g' + i, what: 'x', value: null }] });
    }
    assert.equal(storedStranded().length, STRANDED_MAX_ENTRIES);
    assert.equal(storedStranded()[STRANDED_MAX_ENTRIES - 1].changes[0].path, 'results/g' + (STRANDED_MAX_ENTRIES + 2));
  } finally { teardown(); }
});

test('the strand is stored per camp and sign-out wipes both camps\' copies', () => {
  assert.equal(STRANDED(), 'campScoreboardStranded' + CAMP.storageSuffix);
  Object.keys(CAMPS).forEach((cid) => localStorage.setItem('campScoreboardStranded' + CAMPS[cid].storageSuffix, '[]'));
  clearLocalData();
  Object.keys(CAMPS).forEach((cid) => assert.equal(localStorage.getItem('campScoreboardStranded' + CAMPS[cid].storageSuffix), null, cid));
});

test('unreadable or blocked storage reads as nothing stranded, and a failed write is told truthfully', async () => {
  strandedList = null;
  localStorage.setItem(STRANDED(), 'not json');
  assert.equal(strandedCount(), 0);
  localStorage.setItem(STRANDED(), '{"a":1}');
  strandedList = null;
  assert.equal(strandedCount(), 0, 'wrong shape ignored');
  localStorage.setItem(STRANDED(), JSON.stringify([{ nope: 1 }, { changes: [{ path: 'results/g', value: 1 }] }]));
  strandedList = null;
  assert.equal(strandedCount(), 1, 'a malformed entry is skipped, a good one kept');
  localStorage.removeItem(STRANDED());
  strandedList = null;
  const db = await boot();
  const realSet = localStorage.setItem;
  try {
    saveOffline(() => { state.results.gA = res(1); });
    await newYear(db, 'w20270718');
    reload(db);
    localStorage.setItem = (k, v) => { if (k === STRANDED()) throw new Error('quota'); return realSet.call(localStorage, k, v); };
    await firstPull(db);
    assert.equal(strandedCount(), 1, 'still held in memory for this page');
    assert.ok(/out of room/.test(toasts.filter((m) => /last camp week/.test(m))[0]), 'the toast says to download now');
  } finally { localStorage.setItem = realSet; teardown(); }
});

// ── the bar: Download / Dismiss ──────────────────────────────────

async function strandOne() {
  const db = await boot();
  saveOffline(() => { state.results.gA = res(1); });
  await newYear(db, 'w20270718');
  reload(db);
  await firstPull(db);
  return db;
}

// The stub's classList.toggle is a no-op: record what the strip was asked to look like.
let calmLook = null;
function watchLook() { bar().classList.toggle = (name, force) => { if (name === 'sync-alert-tab') calmLook = force; }; }

test('the bar names the count, offers Download and Dismiss, and is calm (not the red error look)', async () => {
  await strandOne();
  try {
    fbConnKnown = true; fbConnected = true;
    watchLook();
    updateSyncIndicator();
    assert.equal(bar().hidden, false);
    assert.ok(/1 change from \d{4} wasn’t added/.test(bar().innerHTML), bar().innerHTML);
    assert.ok(bar().innerHTML.includes('data-stranded="download"') && bar().innerHTML.includes('data-stranded="dismiss"'));
    assert.equal(calmLook, true, 'the neutral news look');
    assert.notOk(bar().innerHTML.includes('gold') || bar().innerHTML.includes('results/gA'), 'a count only, no scores');
  } finally { fbConnKnown = false; fbConnected = false; teardown(); }
});

test('this week\'s refused edit and the view-only tab outrank it; it returns when they are gone', async () => {
  await strandOne();
  try {
    fbConnKnown = true; fbConnected = true;
    watchLook();
    stateQuarantine = { 'results/gB': res(2) };
    updateSyncIndicator();
    assert.ok(bar().innerHTML.includes('unsaved') && !bar().innerHTML.includes('data-stranded'), 'the refused score first');
    assert.equal(calmLook, false, 'and in the red look');
    stateQuarantine = {};
    updateSyncIndicator();
    assert.ok(bar().innerHTML.includes('data-stranded="download"'), 'then the stranded work');
    assert.equal(calmLook, true);
    const wasWriter = tabWriter;
    try {
      tabWriter = false; // a director's second tab
      updateSyncIndicator();
      assert.ok(/another tab/i.test(bar().innerHTML) && !bar().innerHTML.includes('data-stranded'), 'the view-only tab is the news there');
    } finally { tabWriter = wasWriter; }
  } finally { fbConnKnown = false; fbConnected = false; teardown(); }
});

test('nothing stranded, no bar; a counselor\'s phone shows it too (it is that phone\'s own work to take)', async () => {
  await strandOne();
  try {
    setMemberRole('viewer');
    updateSyncIndicator();
    assert.equal(bar().hidden, false);
    strandedList = []; writeStranded();
    updateSyncIndicator();
    assert.equal(bar().hidden, true);
  } finally { teardown(); }
});

test('Download hands over one JSON file with the camp, the epochs and every change; the entry stays until Dismissed', async () => {
  await strandOne();
  const realBlob = globalThis.Blob;
  const realDownload = downloadBlob;
  const got = [];
  try {
    globalThis.Blob = function (parts, opts) { this.text = parts.join(''); this.type = opts && opts.type; };
    downloadBlob = (blob, name) => { got.push({ blob, name }); };
    onSyncStatusClick({ target: { closest: (sel) => (sel === '[data-stranded]' ? { dataset: { stranded: 'download' } } : null) } });
    assert.equal(got.length, 1);
    assert.equal(got[0].blob.type, 'application/json');
    assert.ok(new RegExp('^camp-unsynced-changes-' + CAMP.id + '-\\d{4}-\\d{2}-\\d{2}\\.json$').test(got[0].name), got[0].name);
    const out = JSON.parse(got[0].blob.text);
    assert.equal(out.camp, CAMP.id);
    assert.equal(out.entries.length, 1);
    assert.equal(out.entries[0].from, 'legacy');
    assert.equal(out.entries[0].to, 'w20270718');
    assert.deepEqual(out.entries[0].changes[0].value, syncCanon(res(1)));
    assert.ok(/NOT added/.test(out.note));
    assert.equal(strandedCount(), 1, 'downloading does not delete the only copy');
    assert.ok(toasts.some((m) => /Saved to your downloads/.test(m)));
  } finally { globalThis.Blob = realBlob; downloadBlob = realDownload; teardown(); }
});

test('Dismiss asks first; No keeps it, Yes deletes it from the phone and drops the bar', async () => {
  await strandOne();
  const realConfirm = confirm;
  let asked = '';
  try {
    confirm = (m) => { asked = m; return false; };
    onSyncStatusClick({ target: { closest: (sel) => (sel === '[data-stranded]' ? { dataset: { stranded: 'dismiss' } } : null) } });
    await waitQuiet();
    assert.ok(/Delete this change from this phone/.test(asked), asked);
    assert.equal(strandedCount(), 1);
    assert.equal(storedStranded().length, 1);
    confirm = (m) => { asked = m; return true; };
    onSyncStatusClick({ target: { closest: (sel) => (sel === '[data-stranded]' ? { dataset: { stranded: 'dismiss' } } : null) } });
    await waitUntil(() => strandedCount() === 0, 'the dismissal to go through');
    assert.equal(strandedCount(), 0);
    assert.equal(localStorage.getItem(STRANDED()), null);
    assert.equal(bar().hidden, true);
  } finally { confirm = realConfirm; teardown(); }
});

test('signing out warns when stranded work is still on the phone', async () => {
  await strandOne();
  const realConfirm = confirm;
  const realFlush = flushPendingPush;
  let asked = '';
  try {
    flushPendingPush = () => {};
    confirm = (m) => { asked = m; return false; }; // decline: nothing is torn down
    signOutAndClear();
    assert.ok(/1 change from last camp week that never synced/.test(asked) && /Download it/.test(asked), asked);
    strandedList = []; writeStranded();
    signOutAndClear();
    assert.ok(!/last camp week/.test(asked), 'no mention once there is nothing stranded: ' + asked);
  } finally { confirm = realConfirm; flushPendingPush = realFlush; teardown(); }
});

// ── pins on the source ───────────────────────────────────────────

test('the epoch check sits before the merge decides anything, and the stranded store never touches the network or SYNC_KEYS', () => {
  const src = readFixture('../app.js');
  const merge = src.slice(src.indexOf('function firstSnapshotMerge('), src.indexOf('function applyRemoteState('));
  assert.ok(merge.indexOf('strandOldEpochWork(') !== -1 && merge.indexOf('strandOldEpochWork(') < merge.indexOf('const theirs ='), 'before the three-way compare');
  const strand = src.slice(src.indexOf('function strandOldEpochWork('), src.indexOf('// Returns true when it handled the snapshot'));
  assert.ok(!/pushState\(|schedulePush\(|fbRef\.|\.update\(|\.set\(/.test(strand), 'stranding writes nothing to the database');
  assert.equal(SYNC_KEYS.indexOf('stranded'), -1);
  assert.ok(!/campScoreboardStranded/.test(backupJSON()), 'not in backups');
});
