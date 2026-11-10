// THE FOUR-TEAM BRACKET'S SYNC KEY (setup-rebuild-spec S6b / 5.7.4, BUILD-PLAN Step 22): `state.brackets4` as one of the
// synced keys — the fresh state and the remote snapshot, what normalizeSyncedState heals (and what it must not invent),
// the per-MATCH write (brackets4/<gid>/m/<match>), two phones recording at once, the first-snapshot merge of an offline
// match, a late tap after the game was finished, and everything that has to clear it with the rest of a game's records
// (delete, format change, prune, backup). Running as SENIOR camp (4 teams: t0..t3). The engine itself is
// bracket.senior.test.js; the six-team wizard's pins are bracket.test.js.

const IDS = ['t0', 't1', 't2', 't3'];

function fourGame() {
  freshState();
  setMemberRole('editor');
  assert.deepEqual(teamIds(), IDS, 'senior has four teams');
  const g = state.config.games.find((x) => x.id === 'legacy-game-d1');
  g.format = 'tournament';
  return g;
}

// A started bracket with semifinals t0 v t3 and t1 v t2, and the pure rules played through to `upTo` matches.
function played(upTo, winners) {
  const w = Object.assign({ s1: 't0', s2: 't1', third: 't3', final: 't0' }, winners || {});
  const b = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1000);
  ['s1', 's2', 'third', 'final'].slice(0, upTo).forEach((k, i) => {
    const r = fourRecord(b, k, w[k], IDS, 2000 + i);
    assert.ok(r.ok, k + ': ' + JSON.stringify(r));
  });
  return b;
}

// Page-state tests: repaint and celebration are stubs, and always put back.
function quiet(fn) {
  const realRender = renderAll; const realCelebrate = celebrate;
  const log = { renders: 0, celebrated: [] };
  renderAll = () => { log.renders += 1; };
  celebrate = (id) => { log.celebrated.push(id); };
  try { return fn(log); } finally { renderAll = realRender; celebrate = realCelebrate; }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function seedPoints(spec) {
  const other = state.config.games.find((x) => x.id === 'team-comp-am-d1');
  state.results[other.id] = { medals: { gold: spec.gold, silver: spec.silver, bronze: spec.bronze }, savedAt: new Date().toISOString() };
}

// ── the key itself ──────────────────────────────────────────────────────────────────────────────────────────────

test('brackets4 is a sync key: fresh state, the snapshot, the remote list and the quarantine words all carry it', () => {
  assert.ok(SYNC_KEYS.includes('brackets4'));
  assert.deepEqual(makeFreshState().brackets4, {});
  freshState();
  assert.ok('brackets4' in syncedSnapshot());
  const g = state.config.games[0];
  assert.equal(quarantineLabel('brackets4/' + g.id + '/m/s1'), g.name + ' → bracket');
  // A snapshot that has none means "none" (RTDB prunes an empty map), and one that has one adopts it.
  state.brackets4 = { x: { at: 1, m: { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } } } };
  applyRemoteState({ teams: state.teams });
  assert.deepEqual(state.brackets4, {}, 'absent means empty, not keep mine');
  const remote = { teams: state.teams, brackets4: { g1: { at: 5, m: { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } } } } };
  applyRemoteState(remote);
  assert.deepEqual(Object.keys(state.brackets4), ['g1']);
  assert.deepEqual(state.brackets, {}, 'the six-team node is untouched');
});

test('normalizeSyncedState heals what RTDB prunes of brackets4 and nothing else: no invented value, junk left alone', () => {
  freshState();
  state.brackets4 = { empty: { at: 7 }, junk: 'oops', arr: [1, 2], ok: { at: 1, m: { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } } } };
  const before = clone(state.brackets4);
  normalizeSyncedState();
  assert.deepEqual(state.brackets4.empty, { at: 7, m: {} }, 'a bracket pruned of its matches gets its container back');
  assert.equal(state.brackets4.junk, 'oops');
  assert.deepEqual(state.brackets4.arr, [1, 2]);
  assert.deepEqual(state.brackets4.ok, before.ok);
  // …and what it healed is the same value to RTDB: nothing here would be pushed as somebody's edit.
  assert.deepEqual(syncCanon(state.brackets4.empty), syncCanon(before.empty));
  state.brackets4 = null;
  normalizeSyncedState();
  assert.deepEqual(state.brackets4, {}, 'no map at all (an old cache) reads as empty');
  state.brackets4 = [];
  normalizeSyncedState();
  assert.deepEqual(state.brackets4, {});
});

test('the six-team node never heals or reads a four-team record, even one stored under `brackets`', () => {
  const g = fourGame();
  const stray = { at: 1, m: { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } } };
  state.brackets[g.id] = clone(stray);
  assert.equal(bracketKnown(state.brackets[g.id]), false);
  normalizeSyncedState();
  assert.deepEqual(state.brackets[g.id], stray, 'normalizeBracket leaves it as it found it');
  assert.deepEqual(upcomingMatchups(g), []);
  assert.ok(gameRowStatus(g) !== 'live');
  assert.doesNotThrow(() => renderAll());
});

// ── the write: one path per MATCH ───────────────────────────────────────────────────────────────────────────────

test('computeSyncUpdates: a new bracket goes up whole; a recorded match is brackets4/<gid>/m/<match>; Undo is that match\'s deletion', () => {
  const g = fourGame();
  const snap = () => syncedSnapshot();
  const a = snap();
  state.brackets4[g.id] = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1000);
  const b = snap();
  assert.deepEqual(Object.keys(computeSyncUpdates(a, b)), ['brackets4/' + g.id], 'created whole');
  fourRecord(state.brackets4[g.id], 's1', 't0', IDS, 2000);
  const c = snap();
  assert.deepEqual(computeSyncUpdates(b, c), { ['brackets4/' + g.id + '/m/s1']: { a: 't0', b: 't3', winner: 't0', at: 2000 } });
  fourRecord(state.brackets4[g.id], 's2', 't1', IDS, 2001);
  fourRecord(state.brackets4[g.id], 'third', 't3', IDS, 2002);
  const d = snap();
  assert.deepEqual(Object.keys(computeSyncUpdates(c, d)).sort(), ['brackets4/' + g.id + '/m/s2', 'brackets4/' + g.id + '/m/third']);
  fourUndo(state.brackets4[g.id], IDS);
  assert.deepEqual(computeSyncUpdates(d, snap()), { ['brackets4/' + g.id + '/m/third']: null }, 'a taken-back match is deleted, nothing else is sent');
  // a different start time is its own path (not a whole-bracket rewrite)
  const e = snap();
  state.brackets4[g.id].at = 5;
  assert.deepEqual(Object.keys(computeSyncUpdates(e, snap())), ['brackets4/' + g.id + '/at']);
  // finishing: results/<gid> and the bracket's deletion in the SAME diff (one atomic update)
  quiet(() => {
    delete state.brackets4[g.id].at; state.brackets4[g.id].at = 1000;
    ['s1:t0', 's2:t1', 'third:t3', 'final:t0'].forEach((st) => { const [k, w] = st.split(':'); fourRecord(state.brackets4[g.id], k, w, IDS, 3000); });
    const before = snap();
    fourSaveResult(g);
    const up = computeSyncUpdates(before, snap());
    assert.deepEqual(Object.keys(up).sort(), ['brackets4/' + g.id, 'meta/lastDataChangeAt', 'results/' + g.id].sort());
    assert.equal(up['brackets4/' + g.id], null);
    assert.deepEqual(up['results/' + g.id].medals, { gold: 't0', silver: 't1', bronze: 't3' });
  });
});

test('two phones write DIFFERENT matches of one bracket: per-match writes keep both (a whole-bracket write would not)', () => {
  // The screen walks the matches in order, so only one match is ever up to be recorded; two phones write different matches when one is
  // a step behind (its screen still shows the match the other phone has already recorded and moved on from).
  const g = fourGame();
  const seedB = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1000);
  seedB.m.s1.winner = 't0'; seedB.m.s1.at = 1;
  state.brackets4[g.id] = clone(seedB);
  const server0 = syncedSnapshot();
  // phone A records Semifinal 2; phone B, from the same base with a stale screen, records Semifinal 1 the other way — each diff is made
  // against what the server confirmed
  const A = clone(server0); A.brackets4[g.id].m.s2.winner = 't2'; A.brackets4[g.id].m.s2.at = 2;
  const B = clone(server0); B.brackets4[g.id].m.s1.winner = 't3'; B.brackets4[g.id].m.s1.at = 3;
  const pa = computeSyncUpdates(server0, A);
  const pb = computeSyncUpdates(server0, B);
  assert.deepEqual(Object.keys(pa), ['brackets4/' + g.id + '/m/s2']);
  assert.deepEqual(Object.keys(pb), ['brackets4/' + g.id + '/m/s1']);
  const merged = applySyncPaths(applySyncPaths(server0, pa), pb);
  assert.equal(merged.brackets4[g.id].m.s2.winner, 't2');
  assert.equal(merged.brackets4[g.id].m.s1.winner, 't3', 'both survive');
  // the same match on both phones with different winners: last write wins for THAT match only (the re-check catches the rest)
  const C = clone(server0); C.brackets4[g.id].m.s1.winner = 't0'; C.brackets4[g.id].m.s1.at = 4;
  const last = applySyncPaths(applySyncPaths(server0, pb), computeSyncUpdates(server0, C));
  assert.equal(last.brackets4[g.id].m.s1.winner, 't0');
});

test('a match recorded offline merges through the real first snapshot beside one another phone recorded; the same match keeps the server\'s', () => {
  let toasts = [];
  showToast = (m) => { toasts.push(m); };
  const fakeRef = () => { const r = { writes: [], update(u) { r.writes.push(clone(u)); return Promise.resolve(); }, set(v) { r.writes.push({ __whole: v }); return Promise.resolve(); }, once() { return Promise.resolve({ val: () => null }); } }; return r; };
  const prune = (v) => {
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) { const a = v.map(prune).filter((x) => x !== undefined); return a.length ? a : undefined; }
    if (typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { const p = prune(v[k]); if (p !== undefined) o[k] = p; }); return Object.keys(o).length ? o : undefined; }
    return v;
  };
  const boot = (serverRaw) => {
    const ref = fakeRef();
    fbRef = ref; remoteReady = true; pendingWrites = 0; dataEditPending = false;
    clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
    document.activeElement = null;
    applyRemoteState(clone(serverRaw));
    state = JSON.parse(localStorage.getItem(STORAGE_KEY));
    normalizeSyncedState();
    bootSyncedTree = readConfirmedTree() || syncedSnapshot();
    remoteReady = false; lastSyncedTree = null; dirtySinceLoad = false;
    return ref;
  };
  const g = fourGame();
  state.brackets4[g.id] = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1000);
  const serverRaw = prune(syncedSnapshot());
  const ref = boot(serverRaw);
  toasts = [];
  // offline: this phone records Semifinal 1
  fourRecord(state.brackets4[g.id], 's1', 't0', IDS, 2000);
  touchData(); saveState();
  // meanwhile another phone recorded Semifinal 2
  const server = clone(serverRaw);
  server.brackets4[g.id].m.s2.winner = 't2'; server.brackets4[g.id].m.s2.at = 2500;
  handleRemoteSnapshot(server);
  assert.equal(state.brackets4[g.id].m.s1.winner, 't0', 'the offline semifinal survives');
  assert.equal(state.brackets4[g.id].m.s2.winner, 't2', 'and the other phone\'s too');
  assert.equal(ref.writes.length, 1);
  assert.ok(Object.keys(ref.writes[0]).includes('brackets4/' + g.id + '/m/s1'), 'only this phone\'s match goes up: ' + Object.keys(ref.writes[0]));
  assert.notOk(Object.keys(ref.writes[0]).some((k) => k.indexOf('/m/s2') !== -1), 'never the other phone\'s');
  assert.equal(toasts.filter((t) => /changed by someone else/.test(t)).length, 0, 'no conflict');

  // the SAME match recorded on both phones: the server's value is kept and the person is told
  const g2 = fourGame();
  state.brackets4[g2.id] = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1000);
  const raw2 = prune(syncedSnapshot());
  boot(raw2);
  toasts = [];
  fourRecord(state.brackets4[g2.id], 's1', 't0', IDS, 2000);
  touchData(); saveState();
  const server2 = clone(raw2);
  server2.brackets4[g2.id].m.s1.winner = 't3'; server2.brackets4[g2.id].m.s1.at = 1500;
  handleRemoteSnapshot(server2);
  assert.equal(state.brackets4[g2.id].m.s1.winner, 't3', 'their version of the same match');
  assert.ok(toasts.some((t) => /changed by someone else/.test(t)), 'and it says so');
});

test('a finished bracket deleted on the server beats a phone\'s late match: nothing is brought back, and the late tap is ignored', () => {
  const g = fourGame();
  state.brackets4[g.id] = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1000);
  fourRecord(state.brackets4[g.id], 's1', 't0', IDS, 2000);
  // the server says: the game was finished (a result, no bracket)
  const server = clone(syncedSnapshot());
  delete server.brackets4[g.id];
  server.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: new Date().toISOString() };
  applyRemoteState(clone(server));
  assert.notOk(state.brackets4[g.id]);
  assert.ok(state.results[g.id]);
  assert.deepEqual(fourRecordTap(g, 's2', 't1'), { ok: false, reason: 'saved' }, 'a late tap on a game that is already finished');
});

// ── a game's records: delete, format change, prune, backup ──────────────────────────────────────────────────────

test('deleting a game, changing its format, or an import prune clears its four-team bracket with the rest', () => {
  const g = fourGame();
  state.brackets4[g.id] = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1);
  assert.ok(gameRecordLabels(g.id).includes('the bracket in progress'));
  assert.ok(takenGameIds().has(g.id));
  // a game created under a reused id must not inherit it
  const stale = 'gone-game-' + Math.floor(Math.random() * 1000);
  state.brackets4[stale] = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1);
  pruneOrphanedGameData();
  assert.notOk(state.brackets4[stale], 'an orphan is pruned');
  assert.ok(state.brackets4[g.id], 'a live game\'s bracket is not');
  clearGameRecords(g.id);
  assert.notOk(state.brackets4[g.id]);
  // the Games screen's delete and format-change questions name a four-team bracket in progress too
  const g2 = fourGame();
  state.brackets4[g2.id] = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1);
  assert.ok(gameRecordLabels(g2.id).includes('the bracket in progress'), 'gameRecordLabels says a bracket is in progress');
});

test('a backup carries brackets4, and importing one heals and prunes it like every other record', () => {
  const g = fourGame();
  state.brackets4[g.id] = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1);
  const parsed = JSON.parse(backupJSON());
  assert.ok(parsed.state && parsed.state.brackets4 && parsed.state.brackets4[g.id], 'the in-progress four-team bracket is in the file');
  // a bracket for a game the week no longer has is pruned on import; one pruned of its matches is healed
  parsed.state.brackets4['no-such-game'] = parsed.state.brackets4[g.id];
  parsed.state.brackets4[g.id] = { at: 5 };
  const realConfirm = confirm; confirm = () => true;
  try { tryImport(JSON.stringify(parsed)); } finally { confirm = realConfirm; }
  assert.notOk(state.brackets4['no-such-game'], 'orphan pruned');
  assert.deepEqual(state.brackets4[g.id], { at: 5, m: {} }, 'healed');
});
