// THE FOUR-TEAM BRACKET (setup-rebuild-spec S6b, BUILD-PLAN Step 22): the data (state.brackets4), its sync, and the engine —
// two semifinals, the 3rd-place match, the final — running as SENIOR camp (4 teams: t0..t3). A separate file from
// bracket.test.js on purpose: that one pins the six-team wizard on six teams and cannot run here.
//
// The engine is pure (fourRead / fourPhase / fourCurrent / fourNext / fourStart / fourRecord / fourUndo / fourMedals /
// fourResolve / fourSeeds / fourPath: they take the bracket and the camp's team ids) with page-state wrappers around it
// (fourStartGame / fourRecordTap / fourUndoTap / fourResolveTap / fourSaveResult). Both are tested here; the screens that
// call them are the next session's. The key's sync (per-match writes, the merge, backups, deleting a game) is
// bracket-sync.senior.test.js.

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

// ── which kind of bracket a roster is ───────────────────────────────────────────────────────────────────────────

test('bracketKindFor: six teams is the wizard, four is the new bracket, anything else is neither', () => {
  assert.equal(bracketKindFor(6), 'six');
  assert.equal(bracketKindFor(4), 'four');
  [0, 1, 2, 3, 5, 7, 8, '4', null, undefined].forEach((n) => assert.equal(bracketKindFor(n), null, String(n)));
  assert.equal(bracketPlayable(6), true);
  assert.equal(bracketPlayable(5), false);
});

// ── reading a stored bracket ────────────────────────────────────────────────────────────────────────────────────

test('fourRead: plain laundered cells; an unrecorded 3rd-place match and final show the teams they will have', () => {
  const b = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1000);
  let v = fourRead(b, IDS);
  assert.deepEqual(v.m.s1, { a: 't0', b: 't3', winner: '', at: 0, recorded: false });
  assert.deepEqual([v.m.third.a, v.m.third.b, v.m.final.a, v.m.final.b], ['', '', '', ''], 'nobody known yet');
  assert.equal(v.recheck, null);
  fourRecord(b, 's1', 't3', IDS, 5);
  v = fourRead(b, IDS);
  assert.deepEqual([v.m.third.a, v.m.third.b], ['t0', ''], 'the first semifinal\'s loser is known, the second\'s is not');
  assert.deepEqual([v.m.final.a, v.m.final.b], ['t3', '']);
  assert.equal(v.m.third.recorded, false);
});

test('fourRead refuses what it cannot read (null): junk, not four different teams of this camp, a winner who did not play', () => {
  const ok = () => ({ at: 1, m: { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } } });
  assert.ok(fourRead(ok(), IDS));
  [null, undefined, 'x', 7, [], {}, { at: 1 }, { m: [] }, { m: 'x' }].forEach((junk) => assert.equal(fourRead(junk, IDS), null, JSON.stringify(junk)));
  const bad = (f) => { const b = ok(); f(b); return fourRead(b, IDS); };
  assert.equal(bad((b) => { delete b.m.s2; }), null, 'a missing semifinal');
  assert.equal(bad((b) => { b.m.s2.b = 't0'; }), null, 'a team in both semifinals');
  assert.equal(bad((b) => { b.m.s1.b = 't0'; }), null, 'a team against itself');
  assert.equal(bad((b) => { b.m.s1.a = 't9'; }), null, 'a team that is not this camp\'s');
  assert.equal(bad((b) => { b.m.s1.winner = 't1'; }), null, 'a semifinal won by someone who did not play it');
  assert.ok(bad((b) => { b.m.s1.winner = ''; }), 'an empty winner is just undecided');
  assert.equal(fourRead(ok(), ['t0', 't1']), null, 'ids is the roster: a different roster cannot read it');
});

test('fourRead launders every id through the roster: a stored string never becomes a team', () => {
  const b = played(4);
  b.m.final.a = '<img src=x onerror=alert(1)>';
  const v = fourRead(b, IDS);
  assert.equal(v.m.final.a, '', 'dropped');
  assert.equal(v.recheck && v.recheck.match, 'final', 'and a final that no longer says who played is a re-check, not a medal');
});

// ── starting ────────────────────────────────────────────────────────────────────────────────────────────────────

test('fourStart: two pairs, four different teams of this camp; anything else cannot start one', () => {
  assert.deepEqual(fourStart([['t2', 't0'], ['t3', 't1']], IDS, 99), { at: 99, m: { s1: { a: 't2', b: 't0' }, s2: { a: 't3', b: 't1' } } });
  [[['t0', 't1']], [['t0', 't1'], ['t1', 't2']], [['t0', 't1'], ['t2', 't2']], [['t0', 't1'], ['t2', 't9']], [['t0'], ['t1', 't2']], 'x', null].forEach((p) =>
    assert.equal(fourStart(p, IDS, 1), null, JSON.stringify(p)));
  assert.equal(fourStart([['t0', 't1'], ['t2', 't3']], ['t0', 't1', 't2', 't3', 't4', 't5'], 1), null, 'not on a six-team roster');
});

test('fourSeeds: "by the standings" pairs first v last and second v third; fixed pairs are used as saved; a pick has none', () => {
  const g = { roundOneMatchups: [['t0', 't2'], ['t1', 't3']] };
  assert.deepEqual(fourSeeds('standings', g, ['t2', 't0', 't3', 't1'], IDS), [['t2', 't1'], ['t0', 't3']]);
  assert.equal(fourSeeds('standings', g, ['t2', 't0', 't3'], IDS), null, 'three ranked is not enough');
  assert.equal(fourSeeds('standings', g, ['t2', 't2', 't0', 't3'], IDS), null, 'a team twice does not count twice');
  assert.deepEqual(fourSeeds('fixed', g, [], IDS), [['t0', 't2'], ['t1', 't3']]);
  assert.ok(fourSeeds('fixed', g, [], IDS)[0] !== g.roundOneMatchups[0], 'a copy');
  assert.equal(fourSeeds('fixed', { roundOneMatchups: [['t0', 't2']] }, [], IDS), null, 'half a board is no fixture');
  assert.equal(fourSeeds('pick', g, ['t0', 't1', 't2', 't3'], IDS), null);
});

test('fourSeedMode reads the Matchups setting the way the game sheet does', () => {
  const pairs = [['t0', 't1'], ['t2', 't3']];
  assert.equal(fourSeedMode({ bracketSeed: 'standings' }, IDS), 'standings');
  assert.equal(fourSeedMode({ bracketSeed: 'pick' }, IDS), 'pick');
  assert.equal(fourSeedMode({ bracketSeed: 'fixed', roundOneMatchups: pairs }, IDS), 'fixed');
  assert.equal(fourSeedMode({ bracketSeed: 'fixed' }, IDS), 'pick', 'fixed with no complete pairs plays as a pick');
  assert.equal(fourSeedMode({ roundOneMatchups: pairs }, IDS), 'fixed', 'pairs with no explicit choice are fixed');
  assert.equal(fourSeedMode({}, IDS), 'pick');
  assert.equal(fourSeedMode(null, IDS), 'pick');
});

// ── the flow: semifinals, 3rd place, final ──────────────────────────────────────────────────────────────────────

test('the phase is derived: s1 → s2 → third → final → summary, and nothing is stored to say so', () => {
  const b = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1000);
  assert.deepEqual(Object.keys(b).sort(), ['at', 'm']);
  const phases = [fourPhase(b, IDS)];
  [['s1', 't0'], ['s2', 't2'], ['third', 't1'], ['final', 't0']].forEach(([k, w], i) => {
    assert.equal(fourCurrent(b, IDS).key, k);
    assert.ok(fourRecord(b, k, w, IDS, 10 + i).ok);
    phases.push(fourPhase(b, IDS));
  });
  assert.deepEqual(phases, ['s1', 's2', 'third', 'final', 'summary']);
  assert.equal(fourCurrent(b, IDS), null, 'nothing waits at the summary');
  assert.equal(fourNext(b, IDS), null);
  assert.equal(fourPhase(null, IDS), 'broken');
});

test('fourCurrent and fourNext say who plays now and who plays after, with a blank for a team not decided yet', () => {
  const b = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1);
  assert.deepEqual(fourCurrent(b, IDS), { key: 's1', a: 't0', b: 't3' });
  assert.deepEqual(fourNext(b, IDS), { key: 's2', a: 't1', b: 't2' }, 'the second semifinal is known from the start');
  fourRecord(b, 's1', 't3', IDS, 2);
  assert.deepEqual(fourCurrent(b, IDS), { key: 's2', a: 't1', b: 't2' });
  assert.deepEqual(fourNext(b, IDS), { key: 'third', a: 't0', b: '' }, 'the first loser is known, the second is not yet');
  fourRecord(b, 's2', 't1', IDS, 3);
  assert.deepEqual(fourCurrent(b, IDS), { key: 'third', a: 't0', b: 't2' }, 'the two semifinal losers');
  assert.deepEqual(fourNext(b, IDS), { key: 'final', a: 't3', b: 't1' }, 'the two winners');
  fourRecord(b, 'third', 't0', IDS, 4);
  assert.deepEqual(fourCurrent(b, IDS), { key: 'final', a: 't3', b: 't1' });
  assert.equal(fourNext(b, IDS), null);
});

test('a recorded third place and final keep the two teams that played them, next to the winner and the time', () => {
  const b = played(4, { s1: 't3', s2: 't2', third: 't1', final: 't2' });
  assert.deepEqual(b.m.s1, { a: 't0', b: 't3', winner: 't3', at: 2000 }, 'a semifinal keeps its seeds');
  assert.deepEqual(b.m.third, { a: 't0', b: 't1', winner: 't1', at: 2002 });
  assert.deepEqual(b.m.final, { a: 't3', b: 't2', winner: 't2', at: 2003 });
});

test('fourMedals: gold wins the final, silver loses it, bronze wins the 3rd-place match (not the semifinal loser)', () => {
  const b = played(4, { s1: 't0', s2: 't1', third: 't2', final: 't1' });
  // semifinal losers are t3 and t2; t2 won 3rd place; t1 beat t0 in the final.
  assert.deepEqual(fourMedals(b, IDS), { gold: 't1', silver: 't0', bronze: 't2' });
  const c = played(4, { s1: 't0', s2: 't1', third: 't3', final: 't0' });
  assert.deepEqual(fourMedals(c, IDS), { gold: 't0', silver: 't1', bronze: 't3' });
  for (const [up, name] of [[0, 'nothing'], [1, 'a semifinal'], [2, 'both semifinals'], [3, 'no final']]) {
    assert.equal(fourMedals(played(up), IDS), null, 'not before all four are recorded: ' + name);
  }
});

test('fourRecord refuses what it must, says why, and changes nothing', () => {
  const b = fourStart([['t0', 't3'], ['t1', 't2']], IDS, 1);
  const frozen = JSON.stringify(b);
  const refuse = (key, w) => { const r = fourRecord(b, key, w, IDS, 9); assert.equal(JSON.stringify(b), frozen, 'untouched'); return r; };
  assert.deepEqual(refuse('s2', 't1'), { ok: false, reason: 'order' }, 'the second semifinal waits for the first');
  assert.deepEqual(refuse('third', 't0'), { ok: false, reason: 'order' });
  assert.deepEqual(refuse('final', 't0'), { ok: false, reason: 'order' });
  assert.deepEqual(refuse('s1', 't1'), { ok: false, reason: 'winner' }, 'a team that is not in the match');
  assert.deepEqual(refuse('s1', ''), { ok: false, reason: 'winner' });
  assert.deepEqual(refuse('s3', 't0'), { ok: false, reason: 'match' });
  assert.deepEqual(fourRecord(null, 's1', 't0', IDS, 9), { ok: false, reason: 'broken' });
  assert.ok(fourRecord(b, 's1', 't0', IDS, 9).ok);
  const done = JSON.stringify(b);
  assert.deepEqual(fourRecord(b, 's1', 't3', IDS, 10), { ok: false, reason: 'decided' }, 'a stale second tap never overwrites');
  assert.equal(JSON.stringify(b), done);
  const full = played(4);
  assert.deepEqual(fourRecord(full, 'final', 't1', IDS, 99), { ok: false, reason: 'decided' });
});

test('fourUndo takes back the last match in play order at every step, down to nothing', () => {
  const b = played(4, { s1: 't0', s2: 't1', third: 't3', final: 't0' });
  const taken = [];
  for (let i = 0; i < 6; i++) { const k = fourUndo(b, IDS); if (!k) break; taken.push(k); }
  assert.deepEqual(taken, ['final', 'third', 's2', 's1']);
  assert.deepEqual(b.m, { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } }, 'both semifinals are back to their seeds');
  assert.equal(fourPhase(b, IDS), 's1');
  assert.equal(fourUndo(b, IDS), null);
  assert.equal(fourUndo(null, IDS), null);
  // a phone whose clock is wrong does not change which match is "last"
  const c = played(3);
  c.m.s1.at = 99999999;
  assert.equal(fourUndo(c, IDS), 'third');
});

// ── two refs, two phones (sync-F9) ──────────────────────────────────────────────────────────────────────────────

test('a semifinal changed after the 3rd-place match was played is a RE-CHECK: no medals, no more matches, and it says what changed', () => {
  const b = played(3, { s1: 't0', s2: 't1', third: 't3' }); // t3 beat t2 for 3rd
  // Another ref's phone, which still thought Semifinal 1 was open, records Blue's... t3 as the winner; its write lands last.
  b.m.s1.winner = 't3';
  const v = fourRead(b, IDS);
  assert.deepEqual(v.recheck, { match: 'third', semi: 's1', now: 't3', was: 't0' });
  assert.equal(fourPhase(b, IDS), 'recheck');
  assert.equal(fourCurrent(b, IDS), null);
  assert.equal(fourNext(b, IDS), null);
  assert.equal(fourMedals(b, IDS), null);
  assert.deepEqual(fourRecord(b, 'final', 't3', IDS, 1), { ok: false, reason: 'recheck' });
  assert.deepEqual(fourRecord(b, 's2', 't2', IDS, 1), { ok: false, reason: 'recheck' });
});

test('Re-check, "keep": the semifinal stands as changed and the matches played on the old one are thrown out to be replayed', () => {
  const b = played(4, { s1: 't0', s2: 't1', third: 't3', final: 't0' });
  b.m.s1.winner = 't3';
  assert.deepEqual(fourRead(b, IDS).recheck.match, 'third');
  assert.equal(fourResolve(b, 'keep', IDS, 5), true);
  assert.equal(b.m.s1.winner, 't3', 'the semifinal is as the second ref left it');
  assert.equal(b.m.third, undefined);
  assert.equal(b.m.final, undefined);
  assert.equal(fourRead(b, IDS).recheck, null);
  assert.deepEqual(fourCurrent(b, IDS), { key: 'third', a: 't0', b: 't2' }, 'replay 3rd place between the right teams');
  assert.equal(fourMedals(b, IDS), null);
});

test('Re-check, "put back": the semifinal goes back to who the later matches were played with, and the bracket carries on', () => {
  const b = played(4, { s1: 't0', s2: 't1', third: 't3', final: 't0' });
  b.m.s1.winner = 't3';
  assert.equal(fourResolve(b, 'back', IDS, 5), true);
  assert.equal(b.m.s1.winner, 't0');
  assert.equal(b.m.s1.at, 5);
  assert.equal(fourRead(b, IDS).recheck, null);
  assert.equal(fourPhase(b, IDS), 'summary', 'everything that was recorded is consistent again');
  assert.deepEqual(fourMedals(b, IDS), { gold: 't0', silver: 't1', bronze: 't3' });
});

test('Re-check also covers the second semifinal, a semifinal that was cleared, and a final changed under the 3rd-place result', () => {
  const b = played(3, { s1: 't0', s2: 't1', third: 't3' });
  b.m.s2.winner = 't2';
  assert.deepEqual(fourRead(b, IDS).recheck, { match: 'third', semi: 's2', now: 't2', was: 't1' });
  assert.equal(fourResolve(b, 'back', IDS, 1), true);
  assert.equal(b.m.s2.winner, 't1');

  // another ref took Semifinal 1 back (an Undo on a stale screen) after the 3rd-place match
  const c = played(3, { s1: 't0', s2: 't1', third: 't3' });
  delete c.m.s1.winner; delete c.m.s1.at;
  assert.deepEqual(fourRead(c, IDS).recheck, { match: 'third', semi: 's1', now: '', was: 't0' }, 'now is empty: nobody wins it any more');
  assert.equal(fourPhase(c, IDS), 'recheck');
  assert.equal(fourResolve(c, 'back', IDS, 7), true);
  assert.equal(c.m.s1.winner, 't0');

  // a final whose teams no longer match the winners, with the 3rd-place match fine
  const d = played(4, { s1: 't0', s2: 't1', third: 't3', final: 't0' });
  d.m.final.b = 't2';
  assert.equal(fourRead(d, IDS).recheck.match, 'final');
  assert.equal(fourResolve(d, 'keep', IDS, 1), true);
  assert.ok(d.m.third && !d.m.final, 'only the match that no longer agrees is replayed');
  assert.equal(fourPhase(d, IDS), 'final');
});

test('Re-check: later matches that contradict each other cannot be "put back", only replayed; nothing changes on a refusal', () => {
  const b = played(4, { s1: 't0', s2: 't1', third: 't3', final: 't0' });
  // the 3rd-place match says t0 lost Semifinal 1 while the final says t0 won it
  b.m.third = { a: 't0', b: 't2', winner: 't2', at: 9 };
  const r = fourRead(b, IDS);
  assert.equal(r.recheck.match, 'third');
  assert.equal(r.recheck.semi, null, 'no semifinal can be blamed');
  assert.equal(r.recheck.was, null);
  const frozen = JSON.stringify(b);
  assert.equal(fourResolve(b, 'back', IDS, 5), false);
  assert.equal(JSON.stringify(b), frozen);
  assert.equal(fourResolve(b, 'sideways', IDS, 5), false, 'not one of the two choices');
  assert.equal(JSON.stringify(b), frozen);
  assert.equal(fourResolve(b, 'keep', IDS, 5), true);
  assert.equal(fourRead(b, IDS).recheck, null);
  assert.equal(fourResolve(b, 'keep', IDS, 5), false, 'nothing left to settle');
  assert.equal(fourResolve(played(2), 'keep', IDS, 5), false, 'a healthy bracket has nothing to settle');
});

test('a 3rd-place record or final with a winner who did not play it is a re-check, never a podium', () => {
  const b = played(4);
  b.m.third.winner = 't1';
  assert.equal(fourRead(b, IDS).recheck.match, 'third');
  assert.equal(fourMedals(b, IDS), null);
});

// ── what is kept on a finished result ───────────────────────────────────────────────────────────────────────────

test('fourPath keeps only laundered fields of the finished bracket, with every team a roster id', () => {
  const b = played(4, { s1: 't0', s2: 't1', third: 't3', final: 't0' });
  b.extra = 'ignored'; b.m.s1.note = '<b>x</b>';
  const p = fourPath(b, IDS);
  assert.deepEqual(Object.keys(p).sort(), ['at', 'm']);
  assert.deepEqual(Object.keys(p.m), ['s1', 's2', 'third', 'final']);
  assert.deepEqual(p.m.s1, { a: 't0', b: 't3', winner: 't0', at: 2000 });
  assert.equal(JSON.stringify(p).indexOf('ignored'), -1);
  assert.equal(JSON.stringify(p).indexOf('<b>'), -1);
  assert.equal(fourPath({ m: {} }, IDS), null);
});

// ── the engine on the page's state ──────────────────────────────────────────────────────────────────────────────

test('Start: a director starts a bracket from two pairs; a viewer, a wrong-sized roster, a saved game or a started one cannot', () => {
  const g = fourGame();
  quiet((log) => {
    setMemberRole('viewer');
    assert.deepEqual(fourStartGame(g, [['t0', 't3'], ['t1', 't2']]), { ok: false, reason: 'readonly' });
    setMemberRole('editor');
    assert.deepEqual(fourStartGame(g, [['t0', 't3'], ['t1', 't1']]), { ok: false, reason: 'pairs' });
    assert.notOk(state.brackets4[g.id]);
    state.live[g.id] = { key: 't0|t3', inning: 2, outs: 0, half: 0, hr: { t0: 4 } };
    assert.deepEqual(fourStartGame(g, [['t0', 't3'], ['t1', 't2']]), { ok: true });
    assert.deepEqual(Object.keys(state.brackets4[g.id]).sort(), ['at', 'm']);
    assert.notOk(state.live[g.id], 'a new bracket starts with a clean tally');
    assert.ok(log.renders > 0);
    assert.deepEqual(fourStartGame(g, [['t0', 't3'], ['t1', 't2']]), { ok: false, reason: 'started' });
    delete state.brackets4[g.id];
    state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: new Date().toISOString() };
    assert.deepEqual(fourStartGame(g, [['t0', 't3'], ['t1', 't2']]), { ok: false, reason: 'saved' });
    delete state.results[g.id];
    state.teams.push({ id: 't4', name: 'Extra', counselor: '' });
    const r = fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    assert.deepEqual([r.ok, r.reason, r.count], [false, 'teams', 5], 'a five-team roster is refused with the count');
  });
});

test('fourSeedPlan: fixed pairs for anyone who can start; the standings suggestion only for a director with confirmed points', () => {
  const g = fourGame();
  g.bracketSeed = 'standings';
  seedPoints({ gold: 't2', silver: 't0', bronze: 't3' }); // t2 7, t0 5, t3 3, t1 0
  let plan = fourSeedPlan(g);
  assert.equal(plan.mode, 'standings');
  assert.deepEqual(plan.pairs, [['t2', 't1'], ['t0', 't3']], 'first v last, second v third');
  setMemberRole('editor', { provisional: true });
  assert.deepEqual(fourSeedPlan(g), { mode: 'standings', pairs: null }, 'a hinted editor has no points to judge by');
  setMemberRole('viewer');
  assert.equal(fourSeedPlan(g).pairs, null);
  setMemberRole('editor');
  g.bracketSeed = 'fixed';
  g.roundOneMatchups = [['t0', 't1'], ['t2', 't3']];
  assert.deepEqual(fourSeedPlan(g), { mode: 'fixed', pairs: [['t0', 't1'], ['t2', 't3']] });
  g.bracketSeed = 'pick';
  assert.deepEqual(fourSeedPlan(g), { mode: 'pick', pairs: null });
});

test('standings ties are broken by golds, silvers and bronzes, then by the roster\'s order', () => {
  const g = fourGame();
  g.bracketSeed = 'standings';
  // every team on 0 points: the roster's order decides (t0 first … t3 last)
  assert.deepEqual(fourSeedPlan(g).pairs, [['t0', 't3'], ['t1', 't2']]);
  // t1 and t2 both earn 5: a silver each. t1 also holds a bronze elsewhere worth 3 → leads on points; t0 trails.
  seedPoints({ gold: 't3', silver: 't1', bronze: 't2' });
  const other = state.config.games.find((x) => x.id === 'team-comp-pm-d1');
  state.results[other.id] = { medals: { gold: 't0', silver: 't2', bronze: 't1' }, savedAt: new Date().toISOString() };
  // t3: 7, t1: 5+3=8, t2: 3+5=8, t0: 7 → t1 and t2 tie on 8 (1 silver 1 bronze each), t3 and t0 tie on 7 (1 gold each): roster order
  assert.deepEqual(fourSeedPlan(g).pairs, [['t1', 't3'], ['t2', 't0']], 'the tie keeps the roster order inside each pair of equals');
});

test('Record a match through the page: stamped, saved, repainted; a viewer, a late tap and a stale tap are ignored and said', () => {
  const g = fourGame();
  quiet((log) => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    state.meta.lastDataChangeAt = undefined;
    setMemberRole('viewer');
    assert.deepEqual(fourRecordTap(g, 's1', 't0'), { ok: false, reason: 'readonly' });
    setMemberRole('editor');
    const before = log.renders;
    const r = fourRecordTap(g, 's1', 't0');
    assert.deepEqual([r.ok, r.match, r.winner], [true, 's1', 't0']);
    assert.ok(state.meta.lastDataChangeAt, 'a recorded match is real scoreboard activity');
    assert.ok(log.renders > before);
    assert.equal(state.brackets4[g.id].m.s1.winner, 't0');
    assert.deepEqual(fourRecordTap(g, 's1', 't3'), { ok: false, reason: 'decided' }, 'the double tap does not overwrite');
    assert.equal(state.brackets4[g.id].m.s1.winner, 't0');
    assert.deepEqual(fourRecordTap(g, 'final', 't0'), { ok: false, reason: 'order' });
    assert.deepEqual(fourRecordTap({ id: 'nope' }, 's1', 't0'), { ok: false, reason: 'none' });
    // a late tap after the result was saved
    state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: new Date().toISOString() };
    const frozen = JSON.stringify(state.brackets4[g.id]);
    assert.deepEqual(fourRecordTap(g, 's2', 't1'), { ok: false, reason: 'saved' });
    assert.equal(JSON.stringify(state.brackets4[g.id]), frozen, 'ignored');
  });
});

test('the own-team guard: a director on a team cannot record or undo that team\'s match, and can the others', () => {
  const g = fourGame();
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    setMemberTeam('t0');
    assert.deepEqual(fourRecordTap(g, 's1', 't0'), { ok: false, reason: 'team' });
    assert.equal(state.brackets4[g.id].m.s1.winner, undefined);
    setMemberTeam('t2');
    assert.ok(fourRecordTap(g, 's1', 't3').ok, 'a match their team is not in is theirs to record');
    assert.deepEqual(fourRecordTap(g, 's2', 't1'), { ok: false, reason: 'team' });
    setMemberTeam('t3');
    assert.deepEqual(fourUndoTap(g), { ok: false, reason: 'team' }, 'and the undo of a match they are in');
    assert.equal(state.brackets4[g.id].m.s1.winner, 't3');
    setMemberTeam(null);
    assert.deepEqual(fourUndoTap(g), { ok: true, match: 's1' });
  });
});

test('the whole flow through the page: start → semifinals → 3rd place → final → Save Result → medalCounts', () => {
  const g = fourGame();
  g.messtival = true;
  quiet((log) => {
    assert.ok(fourStartGame(g, [['t0', 't3'], ['t1', 't2']]).ok);
    assert.equal(gameRowStatus(g), 'live');
    assert.deepEqual(fourSaveResult(g), { ok: false, reason: 'unfinished' });
    ['s1:t3', 's2:t1', 'third:t0', 'final:t3'].forEach((step) => {
      const [k, w] = step.split(':');
      assert.ok(fourRecordTap(g, k, w).ok, step);
    });
    assert.equal(fourPhase(state.brackets4[g.id], teamIds()), 'summary');
    const before = medalCounts();
    assert.equal(before.t3.points, 0);
    const r = fourSaveResult(g);
    assert.deepEqual(r, { ok: true, medals: { gold: 't3', silver: 't1', bronze: 't0' } });
    const rec = state.results[g.id];
    assert.deepEqual(Object.keys(rec).sort(), ['medals', 'path', 'savedAt']);
    assert.deepEqual(rec.medals, { gold: 't3', silver: 't1', bronze: 't0' });
    assert.deepEqual(rec.path.m.final, { a: 't3', b: 't1', winner: 't3', at: rec.path.m.final.at });
    assert.notOk(state.brackets4[g.id], 'the bracket is retired');
    assert.deepEqual(log.celebrated, ['t3']);
    const c = medalCounts();
    assert.equal(c.t3.points, MEDAL_POINTS.gold * 2, 'a messtival game pays double');
    assert.equal(c.t1.points, MEDAL_POINTS.silver * 2);
    assert.equal(c.t0.points, MEDAL_POINTS.bronze * 2, 'bronze is the 3rd-place WINNER (t0), not a semifinal loser');
    assert.equal(c.t2.points, 0, 'the 3rd-place loser gets nothing');
    assert.equal(c.t3.gold, 1, 'medal counts stay raw');
    assert.equal(gameRowStatus(g), 'done');
    assert.deepEqual(fourSaveResult(g), { ok: false, reason: 'saved' });
    // Clear result takes the points off and brings no bracket back
    delete state.results[g.id];
    assert.equal(medalCounts().t3.points, 0);
    assert.notOk(state.brackets4[g.id]);
  });
});

test('Undo through the page at every step; Re-check through the page; neither works for a viewer or after a result', () => {
  const g = fourGame();
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    assert.deepEqual(fourUndoTap(g), { ok: false, reason: 'none' }, 'nothing to take back');
    ['s1:t0', 's2:t1', 'third:t3'].forEach((st) => { const [k, w] = st.split(':'); fourRecordTap(g, k, w); });
    assert.deepEqual(fourUndoTap(g), { ok: true, match: 'third' });
    assert.deepEqual(fourUndoTap(g), { ok: true, match: 's2' });
    fourRecordTap(g, 's2', 't2');
    fourRecordTap(g, 'third', 't3');
    // a second ref's phone lands Semifinal 1 as t3 after the 3rd-place match
    state.brackets4[g.id].m.s1.winner = 't3';
    assert.deepEqual(fourRecordTap(g, 'final', 't3'), { ok: false, reason: 'recheck' });
    assert.deepEqual(fourResolveTap(g, 'nonsense'), { ok: false, reason: 'unresolved' });
    setMemberRole('viewer');
    assert.deepEqual(fourResolveTap(g, 'keep'), { ok: false, reason: 'readonly' });
    assert.deepEqual(fourUndoTap(g), { ok: false, reason: 'readonly' });
    setMemberRole('editor');
    assert.deepEqual(fourResolveTap(g, 'keep'), { ok: true });
    assert.equal(fourPhase(state.brackets4[g.id], teamIds()), 'third');
    state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: new Date().toISOString() };
    assert.deepEqual(fourUndoTap(g), { ok: false, reason: 'saved' });
    assert.deepEqual(fourResolveTap(g, 'keep'), { ok: false, reason: 'saved' });
  });
});

test('Save Result is refused until the bracket is finished AND consistent', () => {
  const g = fourGame();
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    ['s1:t0', 's2:t1', 'third:t3', 'final:t0'].forEach((st) => { const [k, w] = st.split(':'); fourRecordTap(g, k, w); });
    state.brackets4[g.id].m.s1.winner = 't3'; // a re-check
    assert.deepEqual(fourSaveResult(g), { ok: false, reason: 'unfinished' });
    assert.notOk(state.results[g.id], 'no podium is written from a bracket that disagrees with itself');
    assert.ok(state.brackets4[g.id], 'and the bracket stays');
    fourResolveTap(g, 'back');
    assert.ok(fourSaveResult(g).ok);
  });
});

test('a four-team bracket is what the Now card, the live status and the own-team round read', () => {
  const g = fourGame();
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    fourRecordTap(g, 's1', 't0');
    const b4 = nowBracket4({ myTeam: 't0' }, g);
    assert.deepEqual(b4.cells.map((c) => c.status), ['done', 'live', 'todo', 'todo']);
    assert.ok(/plays in the final next/.test(b4.note.rest), 'Red plays in the final next');
    assert.equal(gameRowStatus(g), 'live');
    assert.deepEqual(gameRoundTeams(g), ['t1', 't2'], 'the match under way is the second semifinal');
  });
});

test('a counselor preview reaches none of it: every page-state wrapper refuses as a viewer would, and the standings suggestion goes quiet', () => {
  const g = fourGame();
  g.bracketSeed = 'standings';
  seedPoints({ gold: 't2', silver: 't0', bronze: 't3' });
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    fourRecordTap(g, 's1', 't0');
    assert.ok(fourSeedPlan(g).pairs, 'a director sees the suggestion');
    counselorPreviewOn = true;
    try {
      const frozen = JSON.stringify(state.brackets4[g.id]);
      assert.deepEqual(fourRecordTap(g, 's2', 't1'), { ok: false, reason: 'readonly' });
      assert.deepEqual(fourUndoTap(g), { ok: false, reason: 'readonly' });
      assert.deepEqual(fourResolveTap(g, 'keep'), { ok: false, reason: 'readonly' });
      assert.deepEqual(fourSaveResult(g), { ok: false, reason: 'readonly' });
      assert.deepEqual(fourStartGame({ id: 'other' }, [['t0', 't3'], ['t1', 't2']]), { ok: false, reason: 'readonly' });
      assert.equal(JSON.stringify(state.brackets4[g.id]), frozen, 'nothing changed');
      assert.equal(fourSeedPlan(g).pairs, null, 'a preview of a counselor\'s screen has no standings to suggest from');
    } finally { counselorPreviewOn = false; }
    assert.ok(fourSeedPlan(g).pairs, 'and the director is back');
  });
});
