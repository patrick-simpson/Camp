// The Firebase sync invariants. Every case here corresponds to something that
// broke live at least once (see CLAUDE.md → "Firebase Realtime Database
// gotcha" and "History"), so treat a failure as a regression, not a test bug.

// ── Fake RTDB ref ────────────────────────────────────────────────
// Records what would have been written, and lets a test hand back whatever the
// server "currently" holds for the idle re-fetch path.
function fakeRef(serverValue) {
  const ref = {
    writes: [],
    onceCalls: 0,
    serverValue: serverValue || null,
    update(updates) { ref.writes.push(updates); return Promise.resolve(); },
    set(value) { ref.writes.push({ __whole: value }); return Promise.resolve(); },
    once() { ref.onceCalls++; return Promise.resolve({ val: () => ref.serverValue }); },
  };
  return ref;
}

function useFakeRef(serverValue) {
  const ref = fakeRef(serverValue);
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

// ── RTDB prunes empties: normalizeSyncedState must heal every shape ──

test('normalizeSyncedState heals a bracket stripped of its empty arrays', () => {
  freshState();
  // What RTDB actually hands back for freshBracket(): pool survives, but
  // matches/selectedPair (empty arrays) and the null fields are gone.
  state.brackets = { g: { phase: 'round1', pool: ['t0', 't1'] } };
  normalizeSyncedState();
  const b = state.brackets.g;
  assert.deepEqual(b.matches, [], 'renderTournament maps over matches');
  assert.deepEqual(b.selectedPair, []);
  assert.equal(b.byeTeamId, null);
  assert.equal(b.semifinal, null);
  assert.equal(b.championship, null);
});

test('normalizeSyncedState heals a bracket with no fields at all', () => {
  freshState();
  state.brackets = { g: {} };
  assert.doesNotThrow(() => normalizeSyncedState());
  assert.equal(state.brackets.g.phase, 'round1');
  assert.deepEqual(state.brackets.g.pool, []);
});

test('normalizeSyncedState heals a Pictionary round with no laps', () => {
  freshState();
  state.picRounds = { t0: { done: false } };
  normalizeSyncedState();
  assert.deepEqual(state.picRounds.t0.laps, []);
  assert.equal(picLapsSum(state.picRounds.t0), 0);
});

test('normalizeSyncedState heals a half-empty score draft', () => {
  freshState();
  state.drafts = { g1: { scores: { t0: 5 } }, g2: { medals: { gold: 't0' } }, g3: {} };
  normalizeSyncedState();
  assert.deepEqual(state.drafts.g1.medals, {});
  assert.deepEqual(state.drafts.g2.scores, {});
  assert.deepEqual(state.drafts.g3, { scores: {}, medals: {} });
});

test('normalizeSyncedState re-arrays a Pictionary word list that came back as an object', () => {
  freshState();
  // A sparse array round-trips through RTDB as { "0": …, "2": … }.
  state.picSetup = { g: { source: 'own', words: { 0: 'apple', 2: 'tractor' } } };
  normalizeSyncedState();
  assert.ok(Array.isArray(state.picSetup.g.words), 'promptLabel indexes words[]');
  assert.equal(state.picSetup.g.words[0], 'apple');
  assert.equal(state.picSetup.g.words[2], 'tractor');
});

test('normalizeSyncedState restores every whole map RTDB can prune away', () => {
  freshState();
  ['bonuses', 'picSetup', 'live', 'clocks', 'announcements', 'meta'].forEach((k) => { delete state[k]; });
  normalizeSyncedState();
  ['bonuses', 'picSetup', 'live', 'clocks', 'announcements'].forEach((k) => {
    assert.deepEqual(state[k], {}, `${k} must come back as an empty map`);
  });
  assert.deepEqual(state.meta, { hiddenCards: {} },
    'meta comes back with its own pruned child healed too — un-hiding every card empties hiddenCards');
});

test('normalizeSyncedState heals a live kickball tally and a ladder match', () => {
  freshState();
  state.live = { g1: { key: 't0|t1' }, g2: { mode: 'ladder', key: 't0|t1' } };
  normalizeSyncedState();
  assert.deepEqual(state.live.g1.hr, {});
  assert.equal(state.live.g1.inning, 1, 'inning 1 is pruned as a default');
  assert.equal(state.live.g1.outs, 0);
  assert.equal(state.live.g1.half, 0);
  assert.equal(state.live.g2.a, 0);
  assert.deepEqual(state.live.g2.log, []);
});

test('every card key that can be hidden is a real card', () => {
  freshState();
  HIDEABLE_CARDS.forEach((k) => {
    state.meta.hiddenCards = {};
    state.meta.hiddenCards[k] = true;
    assert.ok(cardHiddenFromViewers(k), `${k} should read back as hidden`);
  });
  assert.notOk(cardHiddenFromViewers('not-a-card'));
});

test('the legacy standingsHidden flag is still honored', () => {
  freshState();
  state.meta = { standingsHidden: true };
  assert.ok(cardHiddenFromViewers('standings'));
});

// ── Adopting a snapshot ──────────────────────────────────────────

test('a key missing from the snapshot means EMPTY, not keep-mine', () => {
  freshState();
  useFakeRef();
  state.results = { g1: { medals: { gold: 't0' } } };
  state.bonuses = { b1: { teamId: 't0', points: 3 } };
  // What "New week (reset)" looks like on the wire: the pruned keys are simply
  // absent. Treating that as keep-local made the reset silently fail to travel.
  applyRemoteState({ teams: state.teams });
  assert.deepEqual(state.results, {}, 'results must be cleared');
  assert.deepEqual(state.bonuses, {}, 'bonuses must be cleared');
});

test('a snapshot with no roster leaves teams alone', () => {
  freshState();
  useFakeRef();
  const mine = state.teams;
  applyRemoteState({ results: {} });
  assert.equal(state.teams, mine, 'a snapshot without teams is malformed, not empty');
});

test('adopting a snapshot keeps this device Pictionary words off the wire', () => {
  freshState();
  useFakeRef();
  state.picSetup = { g: { source: 'own', words: ['secret', 'words'] } };
  // The snapshot carries the MODE only — words are never synced.
  applyRemoteState({ teams: state.teams, picSetup: { g: { source: 'own' } } });
  assert.deepEqual(state.picSetup.g.words, ['secret', 'words'], 'the ref keeps their own list');
  assert.notOk(JSON.stringify(syncedSnapshot()).includes('secret'), 'and it never gets pushed back up');
});

test('adopting a snapshot normalizes it before anything can render', () => {
  freshState();
  useFakeRef();
  applyRemoteState({ teams: state.teams, brackets: { g: { phase: 'round1' } } });
  assert.deepEqual(state.brackets.g.matches, []);
});

test('adopting a snapshot makes it the diff baseline', () => {
  freshState();
  const ref = useFakeRef();
  applyRemoteState({ teams: state.teams, results: { g1: { medals: { gold: 't0' } } } });
  pushState();
  assert.equal(ref.writes.length, 0, 'nothing changed locally, so nothing should be re-sent');
});

// ── Deferring a snapshot while an edit is in flight ───────────────

test('a snapshot is deferred while a score field is focused', () => {
  freshState();
  useFakeRef();
  state.results = { mine: { medals: { gold: 't0' } } };
  document.activeElement = { tagName: 'INPUT' };
  handleRemoteSnapshot({ teams: state.teams, results: {} });
  assert.deepEqual(state.results, { mine: { medals: { gold: 't0' } } },
    'a reconnect snapshot must not revert the score being typed');
  assert.ok(remoteRefetchPending, 'but we must remember we owe ourselves a read');
});

test('a snapshot is deferred while a local write is unconfirmed', () => {
  freshState();
  useFakeRef();
  pendingWrites = 1; // e.g. a result saved offline, still queued in the SDK
  state.results = { mine: { medals: { gold: 't0' } } };
  handleRemoteSnapshot({ teams: state.teams, results: {} });
  assert.deepEqual(state.results, { mine: { medals: { gold: 't0' } } });
  assert.ok(remoteRefetchPending);
});

test('a deferred snapshot is re-fetched — not replayed — once the device is idle', async () => {
  freshState();
  const ref = useFakeRef();
  document.activeElement = { tagName: 'INPUT' };
  handleRemoteSnapshot({ teams: state.teams, results: { stale: { medals: { gold: 't0' } } } });
  assert.ok(remoteRefetchPending);

  // By the time we go idle the server has moved on again. Re-reading (rather
  // than replaying the stashed payload) is what stops us adopting stale truth:
  // RTDB only fires `value` on a CHANGE, so a dropped snapshot never comes back
  // on its own and a replayed one can already be superseded.
  ref.serverValue = { teams: state.teams, results: { current: { medals: { gold: 't1' } } } };
  document.activeElement = null;
  idleRetryTick();
  await Promise.resolve(); await Promise.resolve();

  assert.equal(ref.onceCalls, 1, 'exactly one re-read');
  assert.deepEqual(Object.keys(state.results), ['current'], 'we land on the server latest');
  assert.notOk(remoteRefetchPending, 'and the debt is settled');
});

test('the idle retry keeps waiting while the editor is still typing', () => {
  freshState();
  const ref = useFakeRef();
  document.activeElement = { tagName: 'INPUT' };
  handleRemoteSnapshot({ teams: state.teams, results: {} });
  idleRetryTick();
  assert.equal(ref.onceCalls, 0, 'no read while a field is focused');
  assert.ok(remoteRefetchPending, 'the debt is still owed');
});

test('a queued-but-unsent data edit also defers adoption', () => {
  freshState();
  useFakeRef();
  dataEditPending = true; // touchData() ran; the 400ms push has not fired yet
  assert.notOk(canAdoptRemote());
  dataEditPending = false;
  assert.ok(canAdoptRemote());
});

test('a view-only save (day tab, theme) is not treated as scoreboard activity', () => {
  freshState();
  useFakeRef();
  state.ui.day = state.config.days[1] ? state.config.days[1].id : state.ui.day;
  saveState(); // no touchData — switching days is not scoreboard activity
  assert.notOk(dataEditPending, 'so it never counts as an edit worth protecting');
  // Its 400ms debounce does briefly hold a snapshot off (any unsent write does),
  // but only until the push fires — and the deferred read is retried, not lost.
  pushTimer = null;
  assert.ok(canAdoptRemote());
});

// ── The first snapshot must not eat work entered offline ──────────

test('first snapshot: newer local work is pushed, not overwritten', () => {
  freshState();
  const ref = useFakeRef();
  remoteReady = false;      // nothing from the server yet
  dirtySinceLoad = true;    // …but a scorer already saved something
  state.results = { g1: { medals: { gold: 't0' } } };
  state.meta.lastDataChangeAt = '2026-07-24T12:00:00Z';

  handleRemoteSnapshot({ teams: state.teams, results: {}, meta: { lastDataChangeAt: '2026-07-24T11:00:00Z' } });

  assert.deepEqual(Object.keys(state.results), ['g1'], 'the offline-entered result survives');
  assert.equal(ref.writes.length, 1, 'and gets pushed up');
});

test('first snapshot: older local work yields to the server', () => {
  freshState();
  useFakeRef();
  remoteReady = false;
  dirtySinceLoad = true;
  state.results = { mine: { medals: { gold: 't0' } } };
  state.meta.lastDataChangeAt = '2026-07-24T10:00:00Z';

  handleRemoteSnapshot({ teams: state.teams, results: { theirs: { medals: { gold: 't1' } } }, meta: { lastDataChangeAt: '2026-07-24T11:00:00Z' } });

  assert.deepEqual(Object.keys(state.results), ['theirs'], 'the server is newer, so it wins');
});

test('an empty database gets seeded rather than adopted', () => {
  freshState();
  const ref = useFakeRef();
  remoteReady = false;
  state.results = { g1: { medals: { gold: 't0' } } };
  handleRemoteSnapshot(null);
  assert.equal(ref.writes.length, 1, 'we seed the database');
  assert.deepEqual(Object.keys(state.results), ['g1']);
});

test('nothing is pushed before the first snapshot lands', () => {
  freshState();
  const ref = useFakeRef();
  remoteReady = false; // a device on dead camp wifi
  state.results = { g1: { medals: { gold: 't0' } } };
  pushState();
  assert.equal(ref.writes.length, 0,
    'a set() queued before the first pull would wipe everyone else newer scores on connect');
});

// ── Per-path diffing: two refs must not clobber each other ────────

test('computeSyncUpdates writes only the items that changed', () => {
  freshState();
  const prev = { results: { a: { medals: { gold: 't0' } }, b: { medals: { gold: 't1' } } } };
  const cur = { results: { a: { medals: { gold: 't0' } }, b: { medals: { gold: 't2' } } } };
  const up = computeSyncUpdates(prev, cur);
  assert.deepEqual(Object.keys(up), ['results/b'], 'untouched items must not be re-sent');
});

test('computeSyncUpdates deletes a cleared item with an explicit null', () => {
  freshState();
  const up = computeSyncUpdates({ bonuses: { b1: { points: 3 } } }, { bonuses: {} });
  assert.deepEqual(up, { 'bonuses/b1': null }, 'RTDB needs null to remove a path');
});

test('a live match is diffed per FIELD so two refs keep both edits', () => {
  freshState();
  const prev = { live: { g: { key: 't0|t1', mode: 'kick', inning: 2, hr: { t0: 1 } } } };
  const cur = { live: { g: { key: 't0|t1', mode: 'kick', inning: 2, hr: { t0: 2 } } } };
  const up = computeSyncUpdates(prev, cur);
  assert.deepEqual(Object.keys(up), ['live/g/hr'],
    'a score tap must not re-send this device stale inning and revert the other ref');
});

test('a new pairing or mode switch replaces the whole live node', () => {
  freshState();
  const prev = { live: { g: { key: 't0|t1', mode: 'kick', inning: 3, hr: {} } } };
  const cur = { live: { g: { key: 't2|t3', mode: 'kick', inning: 1, hr: {} } } };
  assert.deepEqual(Object.keys(computeSyncUpdates(prev, cur)), ['live/g'],
    'a fresh matchup must not inherit the old one leftover fields');
});

test('teams and meta are written whole', () => {
  freshState();
  const up = computeSyncUpdates({ teams: [{ id: 't0', name: 'A' }] }, { teams: [{ id: 't0', name: 'B' }] });
  assert.deepEqual(Object.keys(up), ['teams']);
});

test('syncedSnapshot covers exactly the synced keys', () => {
  freshState();
  assert.deepEqual(Object.keys(syncedSnapshot()).sort(), [...SYNC_KEYS].sort());
});

test('flushPendingPush sends both the score push AND the week-config push', () => {
  freshState();
  const ref = useFakeRef();
  const configWrites = [];
  fbConfigRef = { set: (v) => { configWrites.push(v); return Promise.resolve(); } };

  state.results = { g1: { medals: { gold: 't0' } } };
  schedulePush();
  schedulePushConfig();

  // iOS suspends setTimeout the instant the phone locks, so anything still
  // sitting on the 400ms debounce has to go out now or never.
  flushPendingPush();

  assert.equal(ref.writes.length, 1, 'the score push went out');
  assert.equal(configWrites.length, 1, 'and so did the builder edit');
  assert.equal(pushTimer, null);
  assert.equal(pushConfigTimer, null);
});

test('an unchanged state pushes nothing at all', () => {
  freshState();
  const ref = useFakeRef();
  lastSyncedTree = syncedSnapshot();
  pushState();
  assert.equal(ref.writes.length, 0);
});
