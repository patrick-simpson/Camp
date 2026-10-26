// Merge-safety regressions found by the 2026-10-26 reliability audit. Each was
// reproduced against the real app.js before it was fixed (see
// docs/build-notes/verify/RESULTS-G1.md and RESULTS-G2.md). Like
// sync.test.js, a failure here is a regression, not a test bug.

function fakeRef(serverValue) {
  const ref = {
    writes: [],
    serverValue: serverValue || null,
    update(updates) { ref.writes.push(updates); return Promise.resolve(); },
    set(value) { ref.writes.push({ __whole: value }); return Promise.resolve(); },
    once() { return Promise.resolve({ val: () => ref.serverValue }); },
  };
  return ref;
}

function useFakeRef() {
  const ref = fakeRef();
  fbRef = ref;
  remoteReady = true;
  lastSyncedTree = null;
  pendingWrites = 0;
  dataEditPending = false;
  pushTimer = null;
  pushConfigTimer = null;
  document.activeElement = null;
  return ref;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// ── sync#1: the first snapshot must not push the whole stale tree ──

test('first snapshot: defending offline work sends ONLY this device\'s edits', () => {
  freshState();
  state.results = { a: { medals: { gold: 't0' } }, b: { medals: { gold: 't1' } } };
  state.meta.lastDataChangeAt = '2026-07-24T09:00:00Z';
  bootSyncedTree = syncedSnapshot();              // what this phone had cached at load
  const ref = useFakeRef();
  remoteReady = false;
  dirtySinceLoad = true;
  // Offline, before the first snapshot: one verse score.
  state.bonuses = { mine: { teamId: 't2', category: 'verse', points: 3, day: 1 } };
  state.meta.lastDataChangeAt = '2026-07-24T12:00:00Z';

  // Meanwhile other devices saved results d, e and a bonus x (older stamp than ours).
  const server = clone(syncedSnapshot());
  server.results = { a: server.results.a, b: server.results.b, d: { medals: { gold: 't3' } }, e: { medals: { gold: 't4' } } };
  server.bonuses = { x: { teamId: 't5', category: 'bonus', points: 2 } };
  server.meta = { lastDataChangeAt: '2026-07-24T11:00:00Z' };
  handleRemoteSnapshot(server);

  assert.equal(ref.writes.length, 1, 'our offline work is defended (pushed)');
  const keys = Object.keys(ref.writes[0]).sort();
  assert.deepEqual(keys, ['bonuses/mine', 'meta/lastDataChangeAt'],
    'only our own paths — never results/bonuses as a whole, which would erase d, e and x');
});

// ── sync#7: adopting the first snapshot clears the pending-edit flag ──

test('first snapshot: when the server wins, the device does not stay stuck "mid-edit"', () => {
  freshState();
  bootSyncedTree = syncedSnapshot();
  useFakeRef();
  remoteReady = false;
  dirtySinceLoad = true;
  dataEditPending = true;                         // a pre-sync touchData
  state.meta.lastDataChangeAt = '2026-07-24T10:00:00Z';
  handleRemoteSnapshot({ teams: state.teams, meta: { lastDataChangeAt: '2026-07-24T11:00:00Z' } });
  assert.equal(dataEditPending, false, 'otherwise canAdoptRemote() stays false until the next save');
  assert.ok(canAdoptRemote(), 'later snapshots are adopted again');
});

// ── sync#3: an identical echo must not detach open views ──

test('an identical snapshot keeps the live objects, so open tally/bracket views stay attached', () => {
  freshState();
  useFakeRef();
  state.drafts = { g: { scores: { t0: '1' }, medals: {} } };
  normalizeSyncedState();
  const draftRef = state.drafts.g;
  const resultsRef = state.results;
  applyRemoteState(clone(syncedSnapshot()));      // the idle re-fetch of our own write
  assert.ok(state.drafts.g === draftRef, 'a render-time closure over the draft must still be the real one');
  assert.ok(state.results === resultsRef);
  // …and a genuine change is still adopted.
  const changed = clone(syncedSnapshot());
  changed.drafts.g.scores.t0 = '2';
  applyRemoteState(changed);
  assert.equal(state.drafts.g.scores.t0, '2');
});

// ── sync#4: drafts are diffed per leaf ──

test('a tally draft is diffed per score, so two scorers keep both entries', () => {
  freshState();
  const prev = { drafts: { g: { scores: { t0: '5', t1: '3' }, medals: {} } } };
  const cur = { drafts: { g: { scores: { t0: '5', t1: '4' }, medals: {} } } };
  assert.deepEqual(Object.keys(computeSyncUpdates(prev, cur)), ['drafts/g/scores/t1']);
});

test('a NEW draft is written per leaf too (the other scorer may have one already)', () => {
  freshState();
  const up = computeSyncUpdates({ drafts: {} }, { drafts: { g: { scores: { t0: '12' }, medals: {} } } });
  assert.deepEqual(Object.keys(up), ['drafts/g/scores/t0'],
    'writing drafts/g whole here is exactly how editor B wiped editor A');
});

test('a cleared score and a deleted draft are explicit nulls', () => {
  freshState();
  const up1 = computeSyncUpdates({ drafts: { g: { scores: { t0: '1', t1: '2' }, medals: {} } } },
    { drafts: { g: { scores: { t0: '1' }, medals: {} } } });
  assert.deepEqual(up1, { 'drafts/g/scores/t1': null });
  const up2 = computeSyncUpdates({ drafts: { g: { scores: { t0: '1' }, medals: {} } } }, { drafts: {} });
  assert.deepEqual(up2, { 'drafts/g': null });
});

// ── sync#6: meta is diffed per field / per card ──

test('a score save sends only meta/lastDataChangeAt — never another editor\'s card hides', () => {
  freshState();
  const prev = { meta: { lastDataChangeAt: 'a', hiddenCards: { standings: true } } };
  const cur = { meta: { lastDataChangeAt: 'b', hiddenCards: {} } };   // this device never saw the hide
  const up = computeSyncUpdates(prev, { meta: { lastDataChangeAt: 'b', hiddenCards: { standings: true } } });
  assert.deepEqual(Object.keys(up), ['meta/lastDataChangeAt']);
  // Hiding/unhiding is per card.
  assert.deepEqual(computeSyncUpdates(prev, cur), { 'meta/lastDataChangeAt': 'b', 'meta/hiddenCards/standings': null });
  assert.deepEqual(Object.keys(computeSyncUpdates({ meta: { hiddenCards: {} } }, { meta: { hiddenCards: { chat: true } } })),
    ['meta/hiddenCards/chat']);
});

// ── sync#8: healing RTDB pruning is not a reason to re-push the config ──

test('a remote config that only lost empty fields to RTDB is not pushed back by every editor', () => {
  freshState();
  setMemberRole('editor');
  const savedRef = fbConfigRef;
  fbConfigRef = { set: () => Promise.resolve() };
  pushConfigTimer = null;
  try {
    const remote = clone(state.config);
    remote.games = remote.games.map((g) => { const c = Object.assign({}, g); delete c.rules; return c; }); // pruned []
    applyRemoteConfig(remote);
    assert.equal(pushConfigTimer, null, 'no whole-config set() from every open editor device');
  } finally {
    clearTimeout(pushConfigTimer); pushConfigTimer = null;
    fbConfigRef = savedRef;
    setMemberRole(null);
  }
});

// ── scoring#4: verse/cleanup points have one deterministic slot ──

test('two devices setting the same team\'s verse points write the SAME slot', () => {
  freshState();
  setMemberRole('editor');
  try {
    setVersePoints('t2', 1, 3);
    const first = Object.keys(state.bonuses);
    setVersePoints('t2', 1, 5);
    assert.deepEqual(Object.keys(state.bonuses), first, 'same id, so a second device overwrites instead of adding');
    assert.equal(state.bonuses[first[0]].points, 5);
    assert.equal(medalCounts().t2.verse, 5);
    setCleanupPoints('t1', 2, 'Supper', 2);
    assert.ok(Object.keys(state.bonuses).includes('cleanup-t1-2-Supper'));
  } finally { setMemberRole(null); }
});

// ── sync#2: only real form controls count as "typing" ──

test('a focused card header or button does NOT freeze live updates', () => {
  freshState();
  useFakeRef();
  const el = (tagName) => ({ tagName, closest: () => null, isContentEditable: false });
  document.activeElement = el('JELLY-COLLAPSIBLE');
  assert.ok(canAdoptRemote(), 'tapping a card header on Android left it focused and froze sync');
  document.activeElement = el('JELLY-BUTTON');
  assert.ok(canAdoptRemote());
  document.activeElement = el('JELLY-INPUT');
  assert.notOk(canAdoptRemote(), 'a focused Jelly text field IS mid-entry');
  document.activeElement = el('JELLY-TEXTAREA');
  assert.notOk(canAdoptRemote());
  document.activeElement = null;
});

// ── sync#5 / time#3 / time#6: what a deploy reload must wait for ──

test('the deploy auto-reload waits for unconfirmed writes, a running lap and a message in progress', () => {
  freshState();
  useFakeRef();
  assert.notOk(reloadBlocked(), 'idle viewer: reload away');
  pendingWrites = 1;
  assert.ok(reloadBlocked(), 'the SDK queue is in memory — a reload loses the score');
  pendingWrites = 0;
  liveWatches.pic = { running: true, startAt: Date.now() - 40000 };
  assert.ok(reloadBlocked(), 'a running Pictionary lap lives only in this page');
  delete liveWatches.pic;
  chatSendsInFlight = 1;
  assert.ok(reloadBlocked(), 'a chat message still sending');
  chatSendsInFlight = 0;
  assert.notOk(reloadBlocked());
});

// ── auth#3: camp switch asks before throwing away an unconfirmed score ──

test('switching camps with an unconfirmed score asks first, and "no" keeps you here', () => {
  freshState();
  useFakeRef();
  pendingWrites = 1;
  const before = sandboxReloads();
  const realConfirm = confirm;
  confirm = () => false;
  try {
    switchCamp('senior');
    assert.equal(sandboxReloads(), before, 'declined ⇒ no reload');
    assert.notOk(localStorage.getItem('campScoreboardActiveCamp') === 'senior', 'and the camp key is untouched');
  } finally { confirm = realConfirm; pendingWrites = 0; }
  assert.notOk(hasUnsyncedWork());
});

function sandboxReloads() { return globalThis.__reloads || 0; }

// ── sync#5(b): unconfirmed offline work survives a force-quit / reload ──

test('the server-confirmed baseline is persisted on adopt and advanced only when a push is acknowledged', async () => {
  freshState();
  const ref = useFakeRef();
  applyRemoteState(clone(syncedSnapshot()));
  const cached = () => JSON.parse(localStorage.getItem(STORAGE_KEY))._syncBase;
  assert.ok(cached(), 'adopting a snapshot records what the server holds — in the SAME write as the scores');
  state.results = Object.assign({}, state.results, { g9: { medals: { gold: 't1' } } });
  saveState();
  pushState();
  assert.notOk(cached().results && cached().results.g9, 'not before the server confirms it');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(cached().results.g9.medals.gold, 't1', 'and yes once it has');
  assert.equal(ref.writes.length, 1);
  assert.notOk(SYNC_KEYS.includes('_syncBase'), 'never synced');
  assert.notOk('_syncBase' in JSON.parse(backupJSON()), 'never in a backup');
});

test('a score saved offline in an EARLIER session is pushed on the next launch, not overwritten', () => {
  freshState();
  bootSyncedTree = syncedSnapshot();                 // the persisted, server-confirmed baseline
  state.results = Object.assign({}, state.results, { offline: { medals: { gold: 't3' } } }); // cached, never uploaded
  const ref = useFakeRef();
  remoteReady = false;
  dirtySinceLoad = false;                            // a NEW page load — nothing edited this session
  const server = clone(bootSyncedTree);
  server.results = Object.assign({}, server.results, { newer: { medals: { gold: 't4' } } });
  handleRemoteSnapshot(server);
  assert.ok(state.results.offline && state.results.newer, 'both the offline score and the newer server score are here');
  assert.deepEqual(Object.keys(ref.writes[0] || {}), ['results/offline'], 'only the unconfirmed score goes up');
});

test('a write that reached the server before the app was killed is not pushed twice or reported as a conflict', () => {
  freshState();
  bootSyncedTree = syncedSnapshot();
  state.results = Object.assign({}, state.results, { g: { medals: { gold: 't1' } } });
  const ref = useFakeRef();
  remoteReady = false;
  const server = clone(syncedSnapshot());            // the server already has g (ack was never recorded)
  let toasts = 0;
  const realToast = showToast;
  showToast = () => { toasts += 1; };
  try { handleRemoteSnapshot(server); } finally { showToast = realToast; }
  assert.equal(ref.writes.length, 0);
  assert.equal(toasts, 0);
});

