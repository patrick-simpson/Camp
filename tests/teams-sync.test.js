// S2b — team names and counselors sync per FIELD (setup-rebuild-spec §6.2 #2).
//
// `teams` used to be a singleton written whole: renaming ONE team re-sent the
// whole roster, so a second director's rename of a DIFFERENT team (or of the same
// team's counselor) was silently reverted by whichever phone saved last. Now a
// change goes up as `teams/<i>/<field>` while the roster lines up by position
// (same length, same id at every index); a reorder or any roster that doesn't
// line up is structural and goes up whole. These tests cover the diff itself,
// then drive the app's real writers and merge against the in-memory database in
// tests/fake-rtdb.js, with a second "device" writing straight into it.
//
// Team counts differ per camp (6 junior, 4 senior), so nothing here hard-codes
// one: the senior twin (teams-sync.senior.test.js) evals this file.

const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');
const STATE_PATH = dbPath('state');
const serverState = (db) => db.serverTree()[CAMP.dbRoot].state;
const wait = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 5 : ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const paths = (u) => Object.keys(u).sort();
// touchData() stamps meta/lastDataChangeAt into a batch; never what a test is about.
const content = (u) => paths(u).filter((p) => p !== 'meta/lastDataChangeAt');
const settled = async () => { for (let i = 0; i < 40 && (pendingWrites > 0 || stateBisecting); i++) await wait(2); await wait(2); };
const roster = () => state.teams.map((t) => clone(t));
const LAST = () => state.teams.length - 1;

let toasts = [];
showToast = (m) => { toasts.push(m); };

// ── the diff ─────────────────────────────────────────────────────

test('a rename is ONE path, a counselor change is another, both at once is both', () => {
  freshState();
  const prev = { teams: roster() };
  const cur = { teams: roster() };
  cur.teams[1].name = 'Eagles';
  assert.deepEqual(computeSyncUpdates(prev, cur), { 'teams/1/name': 'Eagles' });
  cur.teams[1].counselor = 'Pat';
  cur.teams[LAST()].name = 'Owls';
  assert.deepEqual(computeSyncUpdates(prev, cur), {
    'teams/1/name': 'Eagles', 'teams/1/counselor': 'Pat', ['teams/' + LAST() + '/name']: 'Owls',
  });
});

test('a cleared counselor is an explicit empty string; a removed field is null', () => {
  freshState();
  const prev = { teams: [{ id: 't0', name: 'A', counselor: 'Pat' }, { id: 't1', name: 'B', counselor: 'Sam' }] };
  const cur = { teams: [{ id: 't0', name: 'A', counselor: '' }, { id: 't1', name: 'B' }] };
  assert.deepEqual(computeSyncUpdates(prev, cur), { 'teams/0/counselor': '', 'teams/1/counselor': null });
});

test('an unchanged roster sends nothing, on either side being the raw or the canonical form', () => {
  freshState();
  const a = { teams: roster() };
  assert.deepEqual(computeSyncUpdates(a, { teams: roster() }), {});
  assert.deepEqual(computeSyncUpdates(syncCanonTree(a), syncCanonTree({ teams: roster() })), {});
  // and the per-field diff is the same on the canonical form the merge compares
  const b = { teams: roster() };
  b.teams[0].name = 'Zed';
  assert.deepEqual(computeSyncUpdates(syncCanonTree(a), syncCanonTree(b)), { 'teams/0/name': 'Zed' });
});

test('a reorder, a different size, no roster, or a record with no id is written WHOLE', () => {
  freshState();
  const base = roster();
  const swapped = [base[1], base[0]].concat(base.slice(2));
  assert.deepEqual(computeSyncUpdates({ teams: base }, { teams: swapped }), { teams: swapped },
    'a reorder moves ids between positions: per-field paths would rename the wrong teams');
  assert.deepEqual(Object.keys(computeSyncUpdates({ teams: base }, { teams: base.slice(0, -1) })), ['teams'], 'size changed');
  assert.deepEqual(Object.keys(computeSyncUpdates({ teams: base }, { teams: base.concat([{ id: 'tX', name: 'X' }]) })), ['teams'], 'size changed');
  assert.deepEqual(Object.keys(computeSyncUpdates({ teams: null }, { teams: base })), ['teams'], 'the first write of a roster (a wiped node)');
  assert.deepEqual(Object.keys(computeSyncUpdates({}, { teams: base })), ['teams'], 'no roster on the other side');
  assert.deepEqual(computeSyncUpdates({ teams: base }, {}), { teams: null }, 'a vanished roster is a delete, as before');
  const noId = [{ name: 'A' }, { name: 'B' }];
  assert.deepEqual(Object.keys(computeSyncUpdates({ teams: noId }, { teams: [{ name: 'A2' }, { name: 'B' }] })), ['teams'], 'no id to line up on');
});

test('teams are no longer a singleton, and the notice still is', () => {
  assert.deepEqual(SYNC_SINGLETONS, ['notice']);
  assert.ok(SYNC_KEYS.includes('teams'), 'they still sync');
});

test('rosterAligned says what it means', () => {
  assert.equal(rosterAligned([{ id: 'a' }], [{ id: 'a', name: 'x' }]), true);
  assert.equal(rosterAligned([{ id: 'a' }], [{ id: 'b' }]), false);
  assert.equal(rosterAligned([], []), false, 'an empty roster has nothing to line up');
  assert.equal(rosterAligned([{ id: 'a' }], null), false);
});

// ── against the database ─────────────────────────────────────────

// A fake database holding the current (fresh) week, adopted as this device's
// confirmed baseline: an editor on a connected phone.
async function boot() {
  freshState();
  setMemberRole('editor');
  toasts = [];
  const db = makeFakeRtdb();
  const ref = db.ref(STATE_PATH);
  await ref.set(syncedSnapshot());
  const snap = await ref.once('value');
  fbRef = ref;
  remoteReady = true;
  pendingWrites = 0;
  dataEditPending = false;
  pushTimer = null;
  pushConfigTimer = null;
  applyingRemote = false;
  document.activeElement = null;
  stateQuarantine = {};
  stateBisecting = false;
  stateBisectQueue = [];
  stateBisectHeld = false;
  delete state._quarantine;
  applyRemoteState(snap.val());
  // Adopting a first snapshot seeds the secrecy defaults (one debounced write):
  // send it now so each test starts with nothing owed.
  clearTimeout(pushTimer);
  pushTimer = null;
  pushState();
  await settled();
  db.log.length = 0;
  return db;
}

function teardown() {
  fbRef = null;
  remoteReady = false;
  pendingWrites = 0;
  dataEditPending = false;
  stateQuarantine = {};
  stateBisecting = false;
  stateBisectQueue = [];
  stateBisectHeld = false;
  delete state._quarantine;
  setMemberRole(null);
}

// Record every payload handed to update() while a test pushes.
function spy() {
  const real = fbRef;
  const sent = [];
  fbRef = Object.assign({}, real, { update(u) { sent.push(clone(u)); return real.update(u); } });
  return { sent, stop() { fbRef = real; } };
}

// What the Teams tab does on a commit: edit the live record, save, push.
async function rename(i, name) {
  state.teams[i].name = name;
  touchData();
  clearTimeout(pushTimer); pushTimer = null;
  pushState();
  await settled();
}

test('a rename writes exactly one team path, and the others keep what the server holds', async () => {
  const db = await boot();
  try {
    const before = serverState(db).teams;
    const s = spy();
    await rename(1, 'Eagles');
    s.stop();
    assert.equal(s.sent.length, 1, 'one push went out');
    assert.deepEqual(content(s.sent[0]), ['teams/1/name'], 'one team field and nothing else');
    const after = serverState(db).teams;
    assert.equal(after[1].name, 'Eagles');
    after.forEach((t, i) => { if (i !== 1) assert.deepEqual(t, before[i], 'team ' + i + ' untouched'); });
    assert.equal(after.length, before.length, 'still a whole roster');
  } finally { teardown(); }
});

test('two directors renaming DIFFERENT teams keep BOTH renames (the whole-roster write used to revert one)', async () => {
  const db = await boot();
  try {
    // Another device renames the last team; this phone has not heard yet, so its
    // baseline still holds the old roster when it saves its own rename.
    await db.ref(STATE_PATH).update({ ['teams/' + LAST() + '/name']: 'Their Owls' });
    await rename(1, 'Our Eagles');
    const srv = serverState(db).teams;
    assert.equal(srv[1].name, 'Our Eagles');
    assert.equal(srv[LAST()].name, 'Their Owls', 'the other director\'s rename was not reverted');
    // Hearing about it afterwards leaves this phone with both.
    const snap = await db.ref(STATE_PATH).once('value');
    handleRemoteSnapshot(snap.val());
    assert.equal(state.teams[1].name, 'Our Eagles');
    assert.equal(state.teams[LAST()].name, 'Their Owls');
  } finally { teardown(); }
});

test('a name and a counselor on the SAME team, from two devices, both survive', async () => {
  const db = await boot();
  try {
    await db.ref(STATE_PATH).update({ 'teams/0/counselor': 'Their Counselor' });
    await rename(0, 'Our Name');
    const srv = serverState(db).teams[0];
    assert.equal(srv.name, 'Our Name');
    assert.equal(srv.counselor, 'Their Counselor');
    assert.equal(srv.id, 't0');
  } finally { teardown(); }
});

test('the acknowledged push advances the confirmed baseline by that field only, roster still an array', async () => {
  const db = await boot();
  try {
    await rename(1, 'Eagles');
    assert.ok(Array.isArray(confirmedTree.teams), 'the baseline roster is still a list');
    assert.equal(confirmedTree.teams.length, state.teams.length);
    assert.equal(confirmedTree.teams[1].name, 'Eagles');
    assert.deepEqual(confirmedTree.teams.map((t) => t.id), state.teams.map((t) => t.id));
    assert.deepEqual(computeSyncUpdates(lastSyncedTree, syncedSnapshot()), {}, 'nothing left owed');
    assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY))._syncBase.teams[1].name, 'Eagles', 'and the persisted pair agrees');
  } finally { teardown(); }
});

test('a reorder goes up as the WHOLE roster, in the new order', async () => {
  const db = await boot();
  try {
    const ids = state.teams.map((t) => t.id);
    moveItem(state.teams, 0, 1); // the Teams tab's ↓ on the first row
    touchData();
    clearTimeout(pushTimer); pushTimer = null;
    const s = spy();
    pushState();
    await settled();
    s.stop();
    assert.deepEqual(content(s.sent[0]), ['teams']);
    assert.deepEqual(serverState(db).teams.map((t) => t.id), [ids[1], ids[0]].concat(ids.slice(2)));
  } finally { teardown(); }
});

test('an OLD client\'s whole-roster write is adopted, and the next edit is per field again', async () => {
  const db = await boot();
  try {
    const old = roster();
    old[2].name = 'Written By An Old Build';
    old[2].counselor = 'Old Counselor';
    await db.ref(STATE_PATH).update({ teams: old }); // exactly what a pre-S2b phone sends
    const snap = await db.ref(STATE_PATH).once('value');
    handleRemoteSnapshot(snap.val());
    assert.equal(state.teams[2].name, 'Written By An Old Build');
    assert.equal(state.teams[2].counselor, 'Old Counselor');
    assert.deepEqual(computeSyncUpdates(lastSyncedTree, syncedSnapshot()), {}, 'adopted into the baseline: nothing to re-send');
    db.log.length = 0;
    await rename(2, 'New Name');
    assert.equal(serverState(db).teams[2].name, 'New Name');
    assert.equal(serverState(db).teams[2].counselor, 'Old Counselor');
  } finally { teardown(); }
});

// ── offline edits across a reload (the three-way merge) ──────────

// This phone adopted the server's tree last session; it then reloads with that
// as its confirmed baseline, and its first snapshot of the new session is pending.
function reload(db) {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY));
  normalizeSyncedState();
  bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  remoteReady = false;
  lastSyncedTree = null;
  dirtySinceLoad = false;
  pendingWrites = 0;
  dataEditPending = false;
  toasts = [];
  fbRef = db.ref(STATE_PATH);
}

test('offline rename of one team + another device\'s rename of a different team: both kept, only ours is sent', async () => {
  const db = await boot();
  try {
    state.teams[1].name = 'Offline Eagles'; touchData(); saveState(); clearTimeout(pushTimer); pushTimer = null; // saved with no network
    await db.ref(STATE_PATH).update({ ['teams/' + LAST() + '/name']: 'Server Owls' });
    reload(db);
    const snap = await db.ref(STATE_PATH).once('value');
    db.log.length = 0;
    handleRemoteSnapshot(snap.val());
    await settled();
    assert.equal(state.teams[1].name, 'Offline Eagles', 'the offline rename survived the first pull');
    assert.equal(state.teams[LAST()].name, 'Server Owls', 'and so did theirs');
    assert.equal(toasts.filter((t) => /changed by someone else/.test(t)).length, 0, 'no conflict: different teams are different paths');
    assert.equal(serverState(db).teams[1].name, 'Offline Eagles', 'it reached the server');
    assert.equal(serverState(db).teams[LAST()].name, 'Server Owls');
  } finally { teardown(); }
});

test('offline edit of a name + another device\'s counselor change on the SAME team: both kept', async () => {
  const db = await boot();
  try {
    state.teams[0].name = 'Offline Name'; touchData(); saveState(); clearTimeout(pushTimer); pushTimer = null;
    await db.ref(STATE_PATH).update({ 'teams/0/counselor': 'Server Counselor' });
    reload(db);
    const snap = await db.ref(STATE_PATH).once('value');
    handleRemoteSnapshot(snap.val());
    await settled();
    assert.equal(state.teams[0].name, 'Offline Name');
    assert.equal(state.teams[0].counselor, 'Server Counselor');
    assert.equal(toasts.filter((t) => /changed by someone else/.test(t)).length, 0);
    assert.equal(serverState(db).teams[0].name, 'Offline Name');
    assert.equal(serverState(db).teams[0].counselor, 'Server Counselor');
  } finally { teardown(); }
});

test('the SAME field changed on both sides keeps the server\'s value and says so', async () => {
  const db = await boot();
  try {
    state.teams[1].name = 'Offline Eagles'; touchData(); saveState(); clearTimeout(pushTimer); pushTimer = null;
    await db.ref(STATE_PATH).update({ 'teams/1/name': 'Server Hawks' });
    reload(db);
    const snap = await db.ref(STATE_PATH).once('value');
    handleRemoteSnapshot(snap.val());
    await settled();
    assert.equal(state.teams[1].name, 'Server Hawks');
    assert.equal(serverState(db).teams[1].name, 'Server Hawks');
    assert.equal(toasts.filter((t) => /changed by someone else/.test(t)).length, 1);
  } finally { teardown(); }
});

test('an offline rename against a server that REORDERED is a conflict: theirs wins, nobody renames the wrong team', async () => {
  const db = await boot();
  try {
    const ids = state.teams.map((t) => t.id);
    state.teams[0].name = 'Offline Name'; touchData(); saveState(); clearTimeout(pushTimer); pushTimer = null;
    const swapped = roster();
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    swapped[0] = Object.assign({}, swapped[0]); // a reorder by another director: a whole-roster write
    await db.ref(STATE_PATH).update({ teams: swapped });
    reload(db);
    const snap = await db.ref(STATE_PATH).once('value');
    handleRemoteSnapshot(snap.val());
    await settled();
    assert.deepEqual(state.teams.map((t) => t.id).slice(0, 2), [ids[1], ids[0]], 'the new order stands');
    assert.deepEqual(serverState(db).teams.map((t) => t.id).slice(0, 2), [ids[1], ids[0]]);
    assert.ok(serverState(db).teams[0].name !== 'Offline Name', 'the offline rename did not land on the team that moved into slot 0');
  } finally { teardown(); }
});

// ── a refused team field is quarantined like any other path ───────

test('a refused team field is parked as "Team names", the rest of its batch lands, and Discard restores it', async () => {
  const db = await boot();
  const realConfirm = confirm;
  try {
    db.refuse(STATE_PATH + '/teams/1/name');
    const before = state.teams[1].name;
    state.teams[1].name = 'Refused';
    state.teams[0].counselor = 'Lands';
    touchData(); clearTimeout(pushTimer); pushTimer = null;
    pushState();
    await settled();
    assert.deepEqual(Object.keys(stateQuarantine), ['teams/1/name']);
    assert.equal(quarantineLabel('teams/1/name'), 'Team names');
    assert.equal(serverState(db).teams[0].counselor, 'Lands', 'the good path was not held hostage');
    assert.equal(serverState(db).teams[1].name, before);
    confirm = () => true;
    discardQuarantined();
    assert.equal(state.teams[1].name, before, 'Discard puts the confirmed name back into the live roster');
    assert.ok(Array.isArray(state.teams) && state.teams.length === confirmedTree.teams.length);
    assert.deepEqual(stateQuarantine, {});
  } finally { confirm = realConfirm; teardown(); }
});
