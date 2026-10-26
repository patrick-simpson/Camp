// Offline-merge regressions from the adversarial sync review (2026-10-26).
// Each scenario below was a reproduction against the real app.js; the server
// side is modelled the way RTDB really behaves — empty values pruned (prune)
// and object keys returned sorted — which is exactly what the first version of
// the three-way merge got wrong (it compared the normalized cache with the RAW
// snapshot, so pruned empties looked like someone else's edit).

function prune(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const a = v.map(prune).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => { const p = prune(v[k]); if (p !== undefined) o[k] = p; });
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}

// ── reviewer scenario t1 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
function fakeRef() {
  const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return Promise.resolve(); }, set(v) { ref.writes.push({ __whole: v }); return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } };
  return ref;
}
let toasts = [];
showToast = (m) => { toasts.push(m); };

function boot(serverRaw) {
  // Device adopted serverRaw last session, then "reload": bootSyncedTree from persisted base.
  const ref = fakeRef();
  fbRef = ref; remoteReady = true; pendingWrites = 0; dataEditPending = false; pushTimer = null; pushConfigTimer = null;
  document.activeElement = null;
  applyRemoteState(clone(serverRaw));
  // simulate reload: re-read persisted state
  state = JSON.parse(localStorage.getItem(STORAGE_KEY));
  normalizeSyncedState();
  bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  remoteReady = false; lastSyncedTree = null; dirtySinceLoad = false;
  return ref;
}

test('offline bracket match recorded, nobody else touched anything -> should be pushed', () => {
  freshState();
  setMemberRole('editor');
  state.brackets.g1 = freshBracket();
  const serverRaw = prune(syncedSnapshot());
  const ref = boot(serverRaw);
  toasts = [];
  // offline: record a round-1 match
  const b = state.brackets.g1;
  const [a, c] = [b.pool[0], b.pool[1]];
  b.matches.push({ a, b: c, winner: a, loser: c });
  b.pool = b.pool.filter((id) => id !== a && id !== c);
  touchData(); saveState();
  // first snapshot: server unchanged
  handleRemoteSnapshot(clone(serverRaw));



  assert.ok(state.brackets.g1.matches.length === 1, 'offline bracket match must survive');
});

test('offline first live tap (hr empty on server) -> should be pushed', () => {
  freshState();
  setMemberRole('editor');
  state.live.g2 = { key: 't0|t1', inning: 1, outs: 0, half: 0, hr: {} };
  const serverRaw = prune(syncedSnapshot());
  const ref = boot(serverRaw);
  toasts = [];
  state.live.g2.hr = { t0: 1 };
  touchData(); saveState();
  handleRemoteSnapshot(clone(serverRaw));


  assert.equal(state.live.g2.hr.t0, 1, 'offline live tap must survive');
});

test('offline pictionary lap on a fresh round -> should be pushed', () => {
  freshState();
  setMemberRole('editor');
  state.picRounds = { t0: { laps: [], done: false } };
  const serverRaw = prune(syncedSnapshot());
  const ref = boot(serverRaw);
  toasts = [];
  state.picRounds.t0.laps.push({ ms: 30000, photo: false });
  touchData(); saveState();
  handleRemoteSnapshot(clone(serverRaw));


  assert.equal((state.picRounds.t0.laps || []).length, 1, 'offline lap must survive');
});

test('offline notice edit -> should be pushed', () => {
  freshState();
  setMemberRole('editor');
  const serverRaw = prune(syncedSnapshot());
  const ref = boot(serverRaw);
  toasts = [];
  state.notice.title = 'Changed offline';
  saveState();
  handleRemoteSnapshot(clone(serverRaw));


  assert.equal(state.notice.title, 'Changed offline');
});

test('offline result edit (plain) -> pushed (control)', () => {
  freshState();
  setMemberRole('editor');
  const serverRaw = prune(syncedSnapshot());
  const ref = boot(serverRaw);
  toasts = [];
  state.results.gX = { medals: { gold: 't1', silver: 't2', bronze: 't3' }, savedAt: 'x' };
  touchData(); saveState();
  handleRemoteSnapshot(clone(serverRaw));


  assert.ok(state.results.gX);
});

}

// ── reviewer scenario t2 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
let toasts = [];
showToast = (m) => { toasts.push(m); };
function hangingRef() {
  // update() never settles: wifi dropped again right after the first snapshot.
  const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return new Promise(() => {}); }, set() { return new Promise(() => {}); }, once() { return new Promise(() => {}); } };
  return ref;
}
function reload() {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY));
  normalizeSyncedState();
  confirmedTree = null;
  bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  remoteReady = false; lastSyncedTree = null; dirtySinceLoad = false; pendingWrites = 0; dataEditPending = false; pushTimer = null;
}

test('offline score, reconnect just long enough for the first snapshot, wifi drops, app killed -> score lost?', () => {
  freshState();
  setMemberRole('editor');
  fbRef = hangingRef(); remoteReady = true; pendingWrites = 0; pushTimer = null; pushConfigTimer = null; document.activeElement = null;
  const serverRaw = prune(syncedSnapshot());
  applyRemoteState(clone(serverRaw));      // session 1: synced
  reload();                                 // session 2 starts offline
  state.results.offline1 = { medals: { gold: 't2', silver: 't0', bronze: 't4' }, savedAt: 'x' };
  touchData(); saveState();
  // brief reconnect: first snapshot arrives, merge pushes results/offline1, but the ack never comes
  const ref = hangingRef(); fbRef = ref;
  handleRemoteSnapshot(clone(serverRaw));


  // iOS evicts the PWA / user force-quits. Next launch, online: server never got it.
  reload();
  const ref3 = hangingRef(); fbRef = ref3;
  handleRemoteSnapshot(clone(serverRaw));

  assert.ok(state.results.offline1, 'the offline score must still be here and be re-pushed');
});

}

// ── reviewer scenario t3 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
let toasts = [];
showToast = (m) => { toasts.push(m); };
function fakeRef() {
  const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return Promise.resolve(); }, set() { return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } };
  return ref;
}
function reload() {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY));
  normalizeSyncedState();
  confirmedTree = null;
  bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  remoteReady = false; lastSyncedTree = null; dirtySinceLoad = false; pendingWrites = 0; dataEditPending = false; pushTimer = null;
}
test('ref types custom Pictionary words while offline, then the first snapshot arrives', () => {
  freshState();
  setMemberRole('editor');
  fbRef = fakeRef(); remoteReady = true; pendingWrites = 0; pushTimer = null; pushConfigTimer = null; document.activeElement = null;
  const serverRaw = prune(syncedSnapshot());
  applyRemoteState(clone(serverRaw));
  reload();
  state.picSetup.pic1 = { source: 'own', words: ['giraffe', 'canoe', 'campfire'] };
  saveState();
  const ref = fakeRef(); fbRef = ref;
  handleRemoteSnapshot(clone(serverRaw));


  assert.deepEqual(state.picSetup.pic1 && state.picSetup.pic1.words, ['giraffe', 'canoe', 'campfire'], 'the ref\'s secret words must survive');
});
test('same, but picSetup existed (numbered) on server and ref switches to own offline', () => {
  freshState();
  setMemberRole('editor');
  fbRef = fakeRef(); remoteReady = true; pendingWrites = 0; pushTimer = null; pushConfigTimer = null; document.activeElement = null;
  state.picSetup.pic1 = { source: 'numbered', words: [] };
  const serverRaw = prune(syncedSnapshot());
  applyRemoteState(clone(serverRaw));
  reload();
  state.picSetup.pic1 = { source: 'own', words: ['giraffe', 'canoe'] };
  saveState();
  const ref = fakeRef(); fbRef = ref;
  handleRemoteSnapshot(clone(serverRaw));


  assert.deepEqual(state.picSetup.pic1.words, ['giraffe', 'canoe']);
});

}

// ── reviewer scenario t5 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
let toasts = [];
showToast = (m) => { toasts.push(m); };
playAlarm = () => {};
function fakeRef() {
  const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return Promise.resolve(); }, set() { return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } };
  return ref;
}
test('fast-clock editor reopens mid-game: pre-sign-in "settle" stops everyone\'s running clock', () => {
  freshState();
  window.FIREBASE_CONFIG = { apiKey: 'prod' };   // a production device
  const g = state.config.games.find((x) => x.timer);

  const SKEW = 3 * 60 * 1000;                 // this phone's clock runs 3 min fast
  const serverRealNow = Date.now() - SKEW;
  // A 10-min clock started by the head ref, 2 minutes left in real (server) time.
  state.clocks[g.id] = { running: true, endAt: serverRealNow + 120000, remaining: 600000, duration: 600000, round: 1 };
  // Last session this phone adopted that exact server state.
  fbRef = fakeRef(); remoteReady = true; pendingWrites = 0; pushTimer = null; document.activeElement = null;
  const serverRaw = prune(syncedSnapshot());
  applyRemoteState(clone(serverRaw));
  // --- relaunch: hint-painted editor, sign-in still resolving (fbRef null) ---
  state = JSON.parse(localStorage.getItem(STORAGE_KEY)); normalizeSyncedState();
  confirmedTree = null; bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  fbRef = null; remoteReady = false; lastSyncedTree = null; serverTimeOffset = 0;
  setMemberRole('editor');                    // from campScoreboardAuthHint
  settleExpiredClocks();                      // what tickBoardClocks runs every tick

  // --- sign-in resolves, initSync attaches, first snapshot (server unchanged) ---
  const ref = fakeRef(); fbRef = ref;
  handleRemoteSnapshot(clone(serverRaw));

  assert.ok(!ref.writes.some((w) => Object.keys(w).some((k) => k.startsWith('clocks/'))), 'must not stop a clock with 2 real minutes left');
});

}

// ── reviewer scenario t6 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
let toasts = [];
showToast = (m) => { toasts.push(m); };
function rtdb(v) { // RTDB storage + read-back: prune empties, keys come back sorted
  const p = prune(v);
  const sort = (x) => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') { const o = {}; Object.keys(x).sort().forEach((k) => { o[k] = sort(x[k]); }); return o; }
    return x;
  };
  return sort(p);
}
let server = null;
function serverRef(hangAck) {
  const ref = { writes: [], update(u) { ref.writes.push(clone(u)); server = rtdb(applySyncPaths(server || {}, u)) || {}; return hangAck ? new Promise(() => {}) : Promise.resolve(); }, set() { return Promise.resolve(); }, once() { return Promise.resolve({ val: () => clone(server) }); } };
  return ref;
}
function reload() {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY)); normalizeSyncedState();
  confirmedTree = null; bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  remoteReady = false; lastSyncedTree = null; dirtySinceLoad = false; pendingWrites = 0; dataEditPending = false; pushTimer = null;
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('result saved online (ack recorded, echo not yet re-read), app killed; next day corrected offline', async () => {
  freshState(); setMemberRole('editor');
  document.activeElement = null; pushConfigTimer = null;
  let ref = serverRef(); fbRef = ref; remoteReady = true; lastSyncedTree = null; server = null;
  handleRemoteSnapshot(null); await flush();             // seed
  handleRemoteSnapshot(clone(server)); await flush();    // adopt (sorted)
  // Online: save a placement result. Ack lands; the deferred echo re-read hasn't run yet (editor still on the screen).
  state.results.gX = { medals: { gold: 't1', silver: 't2', bronze: 't3' }, savedAt: '2026-07-24T10:00:00Z' };
  touchData(); saveState(); pushState(); await flush();
  reload();                                              // iOS evicts the backgrounded PWA
  // Offline next session: fix the bronze.
  state.results.gX = { medals: { gold: 't1', silver: 't2', bronze: 't4' }, savedAt: '2026-07-24T11:00:00Z' };
  touchData(); saveState();
  toasts = [];
  ref = serverRef(); fbRef = ref;
  handleRemoteSnapshot(clone(server)); await flush();   // nobody else touched gX

  assert.equal(state.results.gX.medals.bronze, 't4', 'the correction must stick');
});

test('force-quit mid-upload: the write landed, ack never recorded — spurious conflict toast?', async () => {
  freshState(); setMemberRole('editor');
  let ref = serverRef(); fbRef = ref; remoteReady = true; lastSyncedTree = null; server = null;
  handleRemoteSnapshot(null); await flush();
  handleRemoteSnapshot(clone(server)); await flush();
  reload();
  state.results.gY = { medals: { gold: 't1', silver: 't2', bronze: 't3' }, savedAt: 'z' };
  touchData(); saveState();
  ref = serverRef(true); fbRef = ref;                    // reaches server, ack lost (killed)
  remoteReady = true; lastSyncedTree = clone(syncedSnapshot()); delete lastSyncedTree.results.gY;
  pushState();
  reload();
  toasts = [];
  ref = serverRef(); fbRef = ref;
  handleRemoteSnapshot(clone(server)); await flush();

  assert.equal(toasts.length, 0, 'no conflict toast for our own landed write');
});

}

// ── reviewer scenario t7 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
let toasts = [];
showToast = (m) => { toasts.push(m); };
celebrate = () => {};
function fakeRef() { const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return Promise.resolve(); }, set() { return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } }; return ref; }
function reload() {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY)); normalizeSyncedState();
  confirmedTree = null; bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  remoteReady = false; lastSyncedTree = null; dirtySinceLoad = false; pendingWrites = 0; dataEditPending = false; pushTimer = null;
}
test('final saved at the far field (offline), app reopened later: bracket stays "Live now"?', () => {
  freshState(); setMemberRole('editor');
  const g = state.config.games.find((x) => x.format === 'tournament');
  // bracket in the championship phase, synced
  const b = freshBracket();
  b.matches = [{ a: 't0', b: 't1', winner: 't0', loser: 't1' }, { a: 't2', b: 't3', winner: 't2', loser: 't3' }, { a: 't4', b: 't5', winner: 't4', loser: 't5' }];
  b.pool = []; b.byeTeamId = 't0'; b.semifinal = { a: 't2', b: 't4', winner: 't2', loser: 't4' }; b.phase = 'championship';
  state.brackets[g.id] = b;
  fbRef = fakeRef(); remoteReady = true; document.activeElement = null; pushConfigTimer = null;
  const serverRaw = prune(syncedSnapshot());
  applyRemoteState(clone(serverRaw));
  reload();
  // offline: save the final (what save-bracket-btn does)
  state.results[g.id] = { medals: { gold: 't0', silver: 't2', bronze: 't4' }, savedAt: new Date().toISOString() };
  delete state.brackets[g.id];
  touchData(); saveState();
  const ref = fakeRef(); fbRef = ref; toasts = [];
  handleRemoteSnapshot(clone(serverRaw));     // nobody else touched anything


  assert.notOk(state.brackets[g.id], 'the finished bracket must be gone');
});

}

// ── reviewer scenario t8 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
let toasts = [];
showToast = (m) => { toasts.push(m); };
function fakeRef() { const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return Promise.resolve(); }, set() { return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } }; return ref; }
function reload() {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY)); normalizeSyncedState();
  confirmedTree = null; bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  remoteReady = false; lastSyncedTree = null; dirtySinceLoad = false; pendingWrites = 0; dataEditPending = false; pushTimer = null;
}
test('notice with no zones yet: offline edit to it', () => {
  freshState(); setMemberRole('editor');

  state.notice.zones = [];
  fbRef = fakeRef(); remoteReady = true; document.activeElement = null; pushConfigTimer = null;
  const serverRaw = prune(syncedSnapshot());
  applyRemoteState(clone(serverRaw));
  reload();
  state.notice.title = 'Cleanup at 9!'; state.notice.status = 'posted';
  saveState();
  const ref = fakeRef(); fbRef = ref; toasts = [];
  handleRemoteSnapshot(clone(serverRaw));

  assert.equal(state.notice.status, 'posted');
});

}

// ── reviewer scenario t9 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
function fakeRef() { const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return Promise.resolve(); }, set() { return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } }; return ref; }
test('yesterday\'s unuploaded scores: does sign-out warn before wiping them?', () => {
  freshState(); setMemberRole('editor');
  fbRef = fakeRef(); remoteReady = true; document.activeElement = null; pushConfigTimer = null; pushTimer = null;
  applyRemoteState(clone(prune(syncedSnapshot())));
  // offline edit, app killed before upload
  state.results.gZ = { medals: { gold: 't1', silver: 't2', bronze: 't3' }, savedAt: 'x' };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  // next day: app opened (offline, or sign-in still resolving)
  state = JSON.parse(localStorage.getItem(STORAGE_KEY)); normalizeSyncedState();
  confirmedTree = null; bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  fbRef = null; remoteReady = false; pendingWrites = 0; dataEditPending = false; pushTimer = null; pushConfigTimer = null;
  const unconfirmed = Object.keys(computeSyncUpdates(bootSyncedTree, syncedSnapshot()));


  assert.ok(hasUnconfirmedLocalWork(), 'sign-out must know about persisted unconfirmed work');
  assert.notOk(hasUnsyncedWork(), 'but a camp switch (per-camp storage keeps it) is not nagged');
});

}

// ── reviewer scenario t10 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
showToast = () => {};
celebrate = () => {}; joyCelebrate = () => {};
const logged = [];
firebase = { database: () => ({ ref: (p) => ({ push: (v) => { logged.push({ p, v }); return Promise.resolve(); } }) }) };
function fakeRef() { const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return Promise.resolve(); }, set() { return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } }; return ref; }
test('scores entered in an offline session reach the server but never the changelog', () => {
  freshState(); setMemberRole('editor');
  authUser = { email: 'ref@example.com' };
  appStarted = true;
  fbRef = fakeRef(); remoteReady = true; document.activeElement = null; pushConfigTimer = null; pushTimer = null;
  const serverRaw = prune(syncedSnapshot());
  applyRemoteState(clone(serverRaw));
  renderStandings();                                  // baseline
  // App opened OFFLINE: member read can't resolve, so initSync never ran (fbRef null).
  fbRef = null; remoteReady = false; lastSyncedTree = null;
  bootSyncedTree = readConfirmedTree();
  const g = state.config.games[0];
  state.results[g.id] = { medals: { gold: 't1', silver: 't2', bronze: 't3' }, savedAt: 'x' };
  touchData(); saveState(); renderAll();              // what the Save button does

  // Connection returns: member read resolves, initSync, first snapshot.
  const ref = fakeRef(); fbRef = ref;
  handleRemoteSnapshot(clone(serverRaw));


  assert.ok(logged.length > 0, 'the points change must be in the audit log');
});

}

// ── reviewer scenario t11 ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
showToast = () => {};
function fakeRef() { const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return Promise.resolve(); }, set() { return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } }; return ref; }
test('director wipes state/ for a fresh session; first stale device to open re-seeds last week', () => {
  freshState(); setMemberRole('editor');
  state.results.oldWeek = { medals: { gold: 't1', silver: 't2', bronze: 't3' }, savedAt: 'last week' };
  fbRef = fakeRef(); remoteReady = true; document.activeElement = null; pushConfigTimer = null; pushTimer = null;
  applyRemoteState(clone(prune(syncedSnapshot())));   // this device last saw last week's data, confirmed
  state = JSON.parse(localStorage.getItem(STORAGE_KEY)); normalizeSyncedState();
  confirmedTree = null; bootSyncedTree = readConfirmedTree();
  remoteReady = false; lastSyncedTree = null;
  const ref = fakeRef(); fbRef = ref;
  bootHadConfirmedBase = true;
  handleRemoteSnapshot(null);                          // state node is empty now

  assert.ok(!(ref.writes[0] && ref.writes[0].results && ref.writes[0].results.oldWeek), 'a confirmed-but-deleted result must not be resurrected');
});

}

// ── reviewer scenario t12 ──
{
test('chat: a backward device-clock correction stalls every later send by the size of the jump', async () => {
  const calls = [];
  firebase = { database: () => ({ ref: () => ({ update: (u) => { calls.push(Date.now()); return Promise.resolve(); } }) }) };
  firebase.database.ServerValue = { TIMESTAMP: {} };
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    skew = 3000;                                   // phone clock 3 s fast…
    await chatAtomicSend({ 'chat/general/a': { text: 'one' } }, 'chatRate/x');
    skew = 0;                                      // …NTP pulls it back
    const t0 = realNow();
    await chatAtomicSend({ 'chat/general/b': { text: 'two' } }, 'chatRate/x');
    const waited = realNow() - t0;

    assert.ok(waited < CHAT_MIN_SEND_MS + 300, 'the spacing should never exceed CHAT_MIN_SEND_MS');
  } finally { Date.now = realNow; }
});

}

// ── very old unsent work asks first ──
{
const clone = (v) => JSON.parse(JSON.stringify(v));
function fakeRef() { const ref = { writes: [], update(u) { ref.writes.push(clone(u)); return Promise.resolve(); }, set() { return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } }; return ref; }
function oldOfflineWork(answer) {
  freshState(); setMemberRole('editor');
  bootSyncedTree = syncedSnapshot();
  state._syncBaseAt = Date.now() - 3 * 24 * 60 * 60 * 1000; // confirmed three days ago
  state.results.stale = { medals: { gold: 't1' } };
  const ref = fakeRef(); fbRef = ref; remoteReady = false; lastSyncedTree = null; pendingWrites = 0;
  let asked = 0;
  const realConfirm = confirm;
  confirm = () => { asked += 1; return answer; };
  try { handleRemoteSnapshot(clone(prune(bootSyncedTree)) || {}); } finally { confirm = realConfirm; setMemberRole(null); }
  return { ref, asked };
}
test('changes that waited more than a day and a half are sent only if the person says yes', () => {
  const no = oldOfflineWork(false);
  assert.equal(no.asked, 1, 'asked once');
  assert.equal(no.ref.writes.length, 0, 'declined ⇒ nothing old slips into a reset week');
  assert.notOk(state.results.stale, 'and the server copy is adopted');
  const yes = oldOfflineWork(true);
  assert.equal(yes.ref.writes.length, 1);
  assert.ok(Object.keys(yes.ref.writes[0]).includes('results/stale'));
});
}
