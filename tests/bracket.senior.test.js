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

// ── what spectators read (Step 22, session 2) ───────────────────────────────────────────────────────────────────

test('upcomingMatchups / findNextMatchupFor / gameRoundTeams follow the four-team bracket: the match under way, and the next one only when both its teams are known', () => {
  const g = fourGame();
  quiet(() => {
    assert.deepEqual(gameRoundTeams(g), [], 'no bracket, no fixed pairs: no round');
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    const keys = () => upcomingMatchups(g).map((s) => s.key);
    assert.deepEqual(keys(), ['t0|t3', 't1|t2'], 'semifinal 1 now, semifinal 2 after it');
    assert.deepEqual(gameRoundTeams(g), ['t0', 't3']);
    assert.deepEqual(findNextMatchupFor('t3'), { game: g, opponentId: 't0' });
    assert.deepEqual(findNextMatchupFor('t2'), { game: g, opponentId: 't1' }, 'a team on deck is found too');
    fourRecordTap(g, 's1', 't0');
    assert.deepEqual(keys(), ['t1|t2'], 'the 3rd-place match is not known while a semifinal is on');
    fourRecordTap(g, 's2', 't2');
    assert.deepEqual(upcomingMatchups(g).map((s) => [s.aId, s.bId]), [['t3', 't1'], ['t0', 't2']], '3rd place (the two losers), then the final (the two winners)');
    assert.deepEqual(gameRoundTeams(g), ['t3', 't1']);
    fourRecordTap(g, 'third', 't3');
    assert.deepEqual(upcomingMatchups(g).map((s) => [s.aId, s.bId]), [['t0', 't2']], 'the final is the last: nothing after it');
    fourRecordTap(g, 'final', 't2');
    assert.deepEqual(upcomingMatchups(g), [], 'all four played: nothing is up');
    assert.deepEqual(gameRoundTeams(g), []);
    assert.equal(findNextMatchupFor('t0'), null);
  });
});

test('a bracket waiting on a re-check, or one this build cannot read, has no match up and no team in a round', () => {
  const g = fourGame();
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    ['s1:t0', 's2:t1', 'third:t3'].forEach((st) => { const [k, w] = st.split(':'); fourRecordTap(g, k, w); });
    state.brackets4[g.id].m.s1.winner = 't3';
    assert.deepEqual(upcomingMatchups(g), []);
    assert.deepEqual(gameRoundTeams(g), []);
    assert.equal(gameRowStatus(g), 'live', 'it is still a game under way');
    state.brackets4[g.id] = { m: { final: { a: 't0', b: 't1', winner: 't0' } } }; // a stray, seedless late tap
    assert.equal(gameRowStatus(g), 'todo', 'a bracket nobody can read does not make a live game');
    assert.deepEqual(upcomingMatchups(g), []);
    assert.deepEqual(gameRoundTeams(g), []);
  });
});

test('the Now row and its board name the four-team match under way, with the live tally and the next pair', () => {
  const g = fourGame();
  g.liveTracker = { unit: 'Points', periodLabel: 'Round', innings: 1, outs: 0 };
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    state.live[g.id] = { key: 't0|t3', inning: 1, outs: 0, half: 0, hr: { t0: 4, t3: 2 } };
    const board = nowLiveBoard({ myTeam: 't3', points: false }, g);
    assert.equal(board.kind, 'match');
    assert.equal(board.cap, 'Semifinal 1', 'a one-period tracker adds no round counter');
    assert.deepEqual(board.sides.map((s) => [s.team, s.v, s.mine]), [['t0', 4, false], ['t3', 2, true]]);
    assert.deepEqual(board.next, ['t1', 't2']);
    fourRecordTap(g, 's1', 't0');
    fourRecordTap(g, 's2', 't1');
    assert.equal(nowLiveBoard({ myTeam: '' }, g).cap, '3rd place');
    assert.deepEqual(nowLiveBoard({ myTeam: '' }, g).next, ['t0', 't1'], 'after 3rd place: the final');
  });
});

test('a counselor\'s game view of a four-team bracket: the match on the big board, who is next, the four cells, never a control', () => {
  const g = fourGame();
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    fourRecordTap(g, 's1', 't0');
    setMemberRole('viewer');
    state.followTeam = 't0';
    const box = document.getElementById('entry-area');
    box.innerHTML = '';
    renderLiveWatch(box, g);
    const html = box.innerHTML;
    assert.ok(/Live now · Semifinal 2/.test(html), html);
    assert.ok(/Up next/.test(html) === false, 'the 3rd-place match is not known while semifinal 2 is on');
    assert.ok(/plays in the final next/.test(html), 'the followed team is told what it plays next');
    assert.ok(/class="b4"/.test(html), 'the four cells are Now\'s own card');
    assert.notOk(/winner-btn|data-live=|data-four=/.test(html), 'a spectator\'s view holds no control');
    fourRecordTap(g, 's2', 't1'); // (fails as a viewer: nothing changes)
    setMemberRole('editor');
    fourRecordTap(g, 's2', 't1');
    setMemberRole('viewer');
    renderLiveWatch(box, g);
    assert.ok(/Live now · 3rd place/.test(box.innerHTML) && /Up next:/.test(box.innerHTML), 'now the final is known and is on deck');
    setMemberRole('editor');
    fourRecordTap(g, 'third', 't3');
    fourRecordTap(g, 'final', 't0');
    setMemberRole('viewer');
    renderLiveWatch(box, g);
    assert.ok(/All four matches are played/.test(box.innerHTML));
    // a stray value this build cannot read is one quiet line, never a throw
    state.brackets4[g.id] = { m: { final: { a: 't0', b: 'zz', winner: 'zz' } } };
    assert.doesNotThrow(() => renderLiveWatch(box, g));
    assert.ok(/Not scored yet/.test(box.innerHTML));
  });
});

// ── the screens (Step 22, session 2) ────────────────────────────────────────────────────────────────────────────
// renderBracketFour draws the game's entry area from state alone; a tap is `fourEntryTap(target, container)` with the target resolved
// by data-four / .winner-btn / data-four-match, exactly what the delegated listener passes. The driver below is that listener.

function screen(g) {
  const box = document.getElementById('entry-area');
  if (box.__fourGid !== g.id) { box.innerHTML = ''; box.__liveKey = null; box.__liveHolds = null; }
  renderTournament(box, g); // the same door the game takeover uses
  return box;
}

// A tap on what the screen holds: { winner: 't0', match: 's1' } or { four: 'undo', team?: 't1' }.
function tap(box, what) {
  const els = {};
  if (what.winner) {
    els['.winner-btn'] = { dataset: { winner: what.winner } };
    els['[data-four-match]'] = { dataset: { fourMatch: what.match } };
  }
  if (what.four) els['[data-four]'] = { dataset: { four: what.four, team: what.team } };
  const t = { closest: (sel) => els[sel] || null };
  return fourEntryTap(t, box);
}

// The screen's offers, read from its markup: which data-four actions and winner buttons it holds.
const offers = (box) => [...String(box.innerHTML).matchAll(/data-four="([a-z-]+)"/g)].map((m) => m[1]);
const winnerBtns = (box) => [...String(box.innerHTML).matchAll(/class="winner-btn"[^>]*data-winner="([^"]+)"/g)].map((m) => m[1]);

function withToasts(fn) {
  const real = showToast; const said = [];
  showToast = (m) => { said.push(String(m)); };
  try { return fn(said); } finally { showToast = real; }
}

test('Start card, fixed pairs: the pairs are shown as set, one button starts them, and a started bracket shows the first semifinal', () => {
  const g = fourGame();
  g.bracketSeed = 'fixed';
  g.roundOneMatchups = [['t0', 't3'], ['t1', 't2']];
  quiet(() => {
    let box = screen(g);
    assert.ok(/The semifinals for this game/.test(box.innerHTML));
    assert.deepEqual(offers(box), ['start-plan'], 'fixed pairs offer no choice');
    assert.notOk(state.brackets4[g.id], 'a render writes nothing');
    tap(box, { four: 'start-plan' });
    assert.deepEqual(state.brackets4[g.id].m.s1, { a: 't0', b: 't3' });
    box = screen(g);
    assert.ok(/<h3 data-four-h tabindex="-1">Semifinal 1<\/h3>/.test(box.innerHTML));
    assert.deepEqual(winnerBtns(box), ['t0', 't3']);
    assert.ok(/data-four-match="s1"/.test(box.innerHTML));
    assert.ok(/wizard-step active"[^>]*aria-current="step">Semifinal 1/.test(box.innerHTML), 'the step bar says where it is');
    assert.deepEqual(offers(box), ['cancel'], 'Cancel only: nothing to undo yet');
  });
});

test('Start card, by the standings: suggested pairs with Choose different; picking two teams fills the rest; Start with a pick', () => {
  const g = fourGame();
  g.bracketSeed = 'standings';
  seedPoints({ gold: 't2', silver: 't0', bronze: 't3' }); // t2 leads, then t0, t3, t1
  quiet(() => {
    let box = screen(g);
    assert.ok(/Suggested by the points right now/.test(box.innerHTML));
    assert.deepEqual(offers(box), ['start-plan', 'choose']);
    assert.deepEqual(fourSeedPlan(g).pairs, [['t2', 't1'], ['t0', 't3']], 'best v worst, second v third');
    tap(box, { four: 'choose' });
    box = screen(g);
    assert.deepEqual(offers(box).filter((x) => x !== 'pick'), ['unchoose'], 'no Start until four are placed');
    tap(box, { four: 'pick', team: 't1' });
    tap(box, { four: 'pick', team: 't3' });
    box = screen(g);
    assert.ok(offers(box).includes('start-pick'), 'two picks fill the other semifinal');
    assert.ok(/Semifinal 1<\/span>/.test(box.innerHTML) && /Semifinal 2<\/span>/.test(box.innerHTML));
    tap(box, { four: 'pick', team: 't1' }); // take one out again
    box = screen(g);
    assert.notOk(offers(box).includes('start-pick'));
    tap(box, { four: 'pick', team: 't1' });
    tap(box, { four: 'start-pick' });
    assert.deepEqual([state.brackets4[g.id].m.s1, state.brackets4[g.id].m.s2], [{ a: 't3', b: 't0' }, { a: 't2', b: 't1' }],
      'the order the teams were placed in: the first two meet in Semifinal 1, the other two in Semifinal 2');
  });
});

test('Start card, a pick, and "by the standings" on a phone with no confirmed points: the director picks, and is told why', () => {
  const g = fourGame();
  g.bracketSeed = 'standings';
  setMemberRole('editor', { provisional: true });
  quiet(() => {
    const box = screen(g);
    assert.ok(/once your sign-in is confirmed/.test(box.innerHTML));
    assert.notOk(offers(box).includes('start-plan'));
    assert.deepEqual(offers(box).filter((x) => x !== 'pick'), [], 'nothing to go back to');
  });
  g.bracketSeed = 'pick';
  setMemberRole('editor');
  quiet(() => {
    const box = screen(g);
    assert.notOk(/once your sign-in is confirmed/.test(box.innerHTML));
    assert.equal(offers(box).filter((x) => x === 'pick').length, 4);
  });
});

test('the whole tournament through the screens: winner taps, the step bar, 3rd place before the final, the summary, Save Result', () => {
  const g = fourGame();
  g.bracketSeed = 'fixed';
  g.roundOneMatchups = [['t0', 't3'], ['t1', 't2']];
  quiet((log) => {
    let box = screen(g);
    tap(box, { four: 'start-plan' });
    const play = (key, winner, headline) => {
      box = screen(g);
      assert.ok(new RegExp('<h3 data-four-h tabindex="-1">' + headline + '</h3>').test(box.innerHTML), key + ': ' + box.innerHTML.slice(0, 300));
      assert.ok(winnerBtns(box).includes(winner));
      tap(box, { winner, match: key });
    };
    play('s1', 't3', 'Semifinal 1');
    play('s2', 't1', 'Semifinal 2');
    box = screen(g);
    assert.deepEqual(winnerBtns(box), ['t0', 't2'], '3rd place: the two losers');
    assert.ok(/3rd place match<\/h3>/.test(box.innerHTML) && /bronze/.test(box.innerHTML));
    assert.ok(/Completed:[\s\S]*Semifinal 1: [^<]*def\./.test(box.innerHTML));
    assert.ok(offers(box).includes('undo'));
    play('third', 't2', '3rd place match');
    play('final', 't3', 'Final');
    box = screen(g);
    assert.ok(/Game results/.test(box.innerHTML) && /id="save-bracket-btn"/.test(box.innerHTML));
    assert.deepEqual(offers(box).filter((x) => x === 'save').length, 1);
    assert.ok(/wizard-step active"[^>]*aria-current="step">Results/.test(box.innerHTML));
    tap(box, { four: 'save' });
    assert.deepEqual(state.results[g.id].medals, { gold: 't3', silver: 't1', bronze: 't2' });
    assert.notOk(state.brackets4[g.id], 'the bracket is retired with the result');
    assert.ok(log.celebrated.includes('t3'));
  });
});

test('a stale tap is ignored and said: the screen was drawn before another phone recorded the match', () => {
  const g = fourGame();
  quiet(() => withToasts((said) => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    const box = screen(g);
    fourRecord(state.brackets4[g.id], 's1', 't3', IDS, 9); // the other phone's tap lands under this screen
    const before = clone(state.brackets4[g.id]);
    tap(box, { winner: 't0', match: 's1' });
    assert.deepEqual(state.brackets4[g.id], before, 'the winner already recorded is not overwritten');
    assert.ok(said.some((m) => /already recorded/.test(m)), said.join('|'));
    // a tap for a match that is not up any more
    tap(box, { winner: 't0', match: 'third' });
    assert.deepEqual(state.brackets4[g.id], before);
    // a late tap after the result was saved
    state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'x' };
    tap(box, { winner: 't1', match: 's2' });
    assert.deepEqual(state.brackets4[g.id], before);
    assert.ok(said.some((m) => /result is already saved/.test(m)));
  }));
});

test('Undo last match: offered from the first recorded match on, takes back the last one, and is not offered for a match the director\'s own team played', () => {
  const g = fourGame();
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    fourRecordTap(g, 's1', 't0');
    let box = screen(g);
    assert.ok(offers(box).includes('undo'));
    tap(box, { four: 'undo' });
    assert.notOk(state.brackets4[g.id].m.s1.winner, 'semifinal 1 is open again');
    fourRecordTap(g, 's1', 't0');
    setMemberTeam('t0');
    box = screen(g);
    assert.notOk(offers(box).includes('undo'), 't0 played that match: another director undoes it');
    assert.deepEqual(winnerBtns(box), ['t1', 't2'], 'semifinal 2 is theirs to record');
    setMemberTeam(null);
  });
});

test('the own-team guard on the screen: no winner buttons for a match the director\'s team plays, and the reason is said', () => {
  const g = fourGame();
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    setMemberTeam('t3');
    const box = screen(g);
    assert.deepEqual(winnerBtns(box), []);
    assert.ok(/read-only for you/.test(box.innerHTML));
    const before = clone(state.brackets4[g.id]);
    tap(box, { winner: 't0', match: 's1' });
    assert.deepEqual(state.brackets4[g.id], before, 'and a forged tap does nothing');
    setMemberTeam(null);
  });
});

test('the Re-check card: names what changed, offers both answers in words, and records nothing until one is chosen', () => {
  const g = fourGame();
  quiet(() => withToasts((said) => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    ['s1:t0', 's2:t1', 'third:t3'].forEach((st) => { const [k, w] = st.split(':'); fourRecordTap(g, k, w); });
    state.brackets4[g.id].m.s1.winner = 't3'; // another phone changed semifinal 1 after the 3rd-place match
    let box = screen(g);
    assert.ok(/Please check a result/.test(box.innerHTML));
    assert.ok(/Semifinal 1 now says <b>Gold Team<\/b> won/.test(box.innerHTML), box.innerHTML);
    assert.deepEqual(offers(box).filter((x) => x !== 'cancel'), ['keep', 'back']);
    assert.ok(/Keep Gold Team as the winner/.test(box.innerHTML));
    assert.ok(/Put Red Team back as the winner/.test(box.innerHTML));
    assert.deepEqual(winnerBtns(box), [], 'no match can be recorded while it is waiting');
    assert.notOk(/id="save-bracket-btn"/.test(box.innerHTML), 'and no result can be saved');
    assert.ok(/class="wizard-step done/.test(box.innerHTML) && !/wizard-step active/.test(box.innerHTML), 'no step is "where it is"');
    tap(box, { four: 'back' });
    assert.equal(state.brackets4[g.id].m.s1.winner, 't0');
    box = screen(g);
    assert.deepEqual(winnerBtns(box), ['t0', 't1'], 'the final is on again');
    // keep: the matches played on the old semifinal are thrown out
    state.brackets4[g.id].m.s2.winner = 't2';
    box = screen(g);
    assert.ok(/Please check a result/.test(box.innerHTML));
    tap(box, { four: 'keep' });
    assert.notOk(state.brackets4[g.id].m.third, 'the 3rd-place match is to be played again');
    assert.deepEqual(said, []);
  }));
});

test('Cancel this bracket asks first and takes the bracket and its tally away; a bracket this build cannot read can be cleared, nothing else', async () => {
  const g = fourGame();
  const realRender = renderAll;
  const realAsk = typeof askDialog === 'function' ? askDialog : undefined;
  renderAll = () => {};
  try {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    state.live[g.id] = { key: 't0|t3', inning: 1, outs: 0, half: 0, hr: { t0: 1 } };
    const asked = [];
    askDialog = async (o) => { asked.push(o.title); return 'cancel'; };
    await fourCancelTap(g, false);
    assert.ok(state.brackets4[g.id], 'Keep it: nothing changed');
    askDialog = async (o) => { asked.push(o.title); return 'yes'; };
    await fourCancelTap(g, false);
    assert.notOk(state.brackets4[g.id]);
    assert.notOk(state.live[g.id], 'the live tally goes with it');
    assert.deepEqual(asked, ['Cancel this bracket?', 'Cancel this bracket?']);
    // an unreadable one: only the way out
    state.brackets4[g.id] = { m: { final: { a: 't0', b: 't1', winner: 't0' } } };
    const box = screen(g);
    assert.ok(/can’t be read here/.test(box.innerHTML));
    assert.deepEqual(offers(box), ['reload', 'clear']);
    assert.notOk(/winner-btn/.test(box.innerHTML));
    await fourCancelTap(g, true);
    assert.notOk(state.brackets4[g.id]);
    // a result saved while the question was open is not undone by the answer
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    askDialog = async () => { state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'x' }; return 'yes'; };
    assert.equal(await fourCancelTap(g, false), false);
    assert.ok(state.brackets4[g.id], 'the bracket stays once a result exists');
  } finally { renderAll = realRender; askDialog = realAsk; }
});

test('an idle repaint writes nothing and re-binds nothing; a database string never reaches the markup as anything but text', () => {
  const g = fourGame();
  quiet(() => {
    state.teams[0].name = '<img src=x onerror=alert(1)> Reds';
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    const box = screen(g);
    const html = box.innerHTML;
    assert.notOk(/<img src=x/.test(html), 'the team name is escaped');
    assert.ok(/&lt;img src=x/.test(html));
    const realBind = bindMatchTracker; let binds = 0;
    bindMatchTracker = (...a) => { binds += 1; return realBind(...a); };
    try {
      renderTournament(box, g); renderTournament(box, g);
      assert.equal(binds, 0, 'nothing changed, so nothing was rebuilt or re-bound');
      fourRecordTap(g, 's1', 't0');
      renderTournament(box, g);
      assert.equal(binds, 1, 'a recorded match rebuilds the screen once');
    } finally { bindMatchTracker = realBind; }
  });
});

test('a counselor preview and a viewer reach none of the screen\'s controls: the screen is not drawn for them, and a forged tap does nothing', () => {
  const g = fourGame();
  quiet(() => {
    fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
    const box = screen(g);
    const before = clone(state.brackets4[g.id]);
    counselorPreviewOn = true;
    try {
      assert.equal(tap(box, { winner: 't0', match: 's1' }), false);
      assert.equal(tap(box, { four: 'cancel' }), false);
      assert.deepEqual(state.brackets4[g.id], before);
    } finally { counselorPreviewOn = false; }
    setMemberRole('viewer');
    assert.equal(tap(box, { winner: 't0', match: 's1' }), false);
    assert.deepEqual(state.brackets4[g.id], before);
  });
});

// ── Reopen the final (results[gid].path) ────────────────────────────────────────────────────────────────────────

// Play a whole bracket through the page and save it.
function savedBracket(g, winners) {
  const w = Object.assign({ s1: 't0', s2: 't1', third: 't3', final: 't0' }, winners || {});
  fourStartGame(g, [['t0', 't3'], ['t1', 't2']]);
  ['s1', 's2', 'third', 'final'].forEach((k) => assert.ok(fourRecordTap(g, k, w[k]).ok, k));
  assert.ok(fourSaveResult(g).ok);
}

test('Reopen the final: the saved result comes off, the bracket is back at the final with every other match as it was, and the final can be played again', () => {
  const g = fourGame();
  quiet(() => {
    savedBracket(g);
    assert.equal(fourCanReopen(g), true);
    assert.deepEqual(medalCounts().t0.gold, 1, 'the result counts');
    assert.deepEqual(fourReopen(g), { ok: true });
    assert.notOk(state.results[g.id], 'the result is gone, and its points with it');
    assert.equal(medalCounts().t0.gold, 0);
    assert.equal(fourPhase(state.brackets4[g.id], IDS), 'final');
    const v = fourRead(state.brackets4[g.id], IDS);
    assert.deepEqual([v.m.s1.winner, v.m.s2.winner, v.m.third.winner, v.m.final.recorded], ['t0', 't1', 't3', false], 'every other match is as it was');
    assert.equal(gameRowStatus(g), 'live');
    assert.ok(fourRecordTap(g, 'final', 't1').ok, 'the other team wins the final this time');
    assert.ok(fourSaveResult(g).ok);
    assert.deepEqual(state.results[g.id].medals, { gold: 't1', silver: 't0', bronze: 't3' });
    // not offered for what carries no bracket
    delete state.results[g.id].path;
    assert.equal(fourCanReopen(g), false);
    assert.deepEqual(fourReopen(g), { ok: false, reason: 'none' });
    assert.ok(state.results[g.id], 'and nothing was removed');
  });
});

test('Reopen the final is refused for a viewer, for junk, and for a path that is not a consistent finished bracket; and it syncs as one change', () => {
  const g = fourGame();
  quiet(() => {
    savedBracket(g);
    const good = JSON.stringify(state.results[g.id]);
    const set = (f) => { const r = JSON.parse(good); f(r); state.results[g.id] = r; return fourCanReopen(g); };
    assert.equal(set(() => {}), true);
    setMemberRole('viewer');
    assert.equal(fourCanReopen(g), false);
    assert.deepEqual(fourReopen(g), { ok: false, reason: 'readonly' });
    setMemberRole('editor');
    assert.equal(set((r) => { r.path = 'x'; }), false, 'a string');
    assert.equal(set((r) => { r.path = { m: [] }; }), false, 'an array');
    assert.equal(set((r) => { r.path.m = { s1: { a: 't0', b: 't1' } }; }), false, 'one semifinal');
    assert.equal(set((r) => { delete r.path.m.third; }), false, 'no 3rd-place match');
    assert.equal(set((r) => { r.path.m.final = { a: 't1', b: 't2', winner: 't1' }; }), false, 'a final between the wrong teams');
    assert.equal(set((r) => { r.path.m.s1.winner = 't3'; }), false, 'a semifinal that now disagrees with the matches after it');
    assert.equal(set((r) => { r.path.m.final.winner = 'zz'; }), false, 'a winner who is no team of this camp');
    assert.equal(set((r) => { delete r.path; }), false, 'a result with no bracket on it (a podium game, an older record)');
    // one change: the result deleted and the bracket back, in one push
    state.results[g.id] = JSON.parse(good);
    const before = clone(state);
    assert.deepEqual(fourReopen(g), { ok: true });
    const up = computeSyncUpdates(before, state);
    assert.equal(up['results/' + g.id], null, 'the result is deleted');
    assert.ok(up['brackets4/' + g.id] && up['brackets4/' + g.id].m && up['brackets4/' + g.id].m.third, 'and the bracket is back, whole');
    assert.notOk(Object.keys(up).some((k) => /^brackets4\/[^/]+\/m\/final/.test(k)), 'with no final in it');
  });
});

test('Change the result on a four-team game offers Reopen the final, Start over and Keep it; a podium game offers only the old pair', async () => {
  const g = fourGame();
  const realRender = renderAll; const realAsk = typeof askDialog === 'function' ? askDialog : undefined; const realCelebrate = celebrate;
  renderAll = () => {}; celebrate = () => {};
  try {
    savedBracket(g);
    state.ui.gameId = g.id;
    let shown = null;
    askDialog = async (o) => { shown = o; return 'cancel'; };
    assert.equal(await gamesChangeResult(), false);
    assert.deepEqual(shown.actions.map((a) => a.label), ['Reopen the final', 'Start over', 'Keep it']);
    assert.ok(state.results[g.id], 'Keep it changes nothing');
    askDialog = async () => 'reopen';
    assert.equal(await gamesChangeResult(), true);
    assert.equal(fourPhase(state.brackets4[g.id], IDS), 'final');
    assert.notOk(state.results[g.id]);
    // Start over: the result AND its bracket path are gone, and the Start card is what is left
    assert.ok(fourRecordTap(g, 'final', 't0').ok && fourSaveResult(g).ok);
    askDialog = async () => 'clear';
    assert.equal(await gamesChangeResult(), true);
    assert.notOk(state.results[g.id]);
    assert.notOk(state.brackets4[g.id], 'no bracket either: a fresh Start');
    // a podium game keeps the old two answers
    const other = state.config.games.find((x) => x.id === 'team-comp-am-d1');
    state.results[other.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'x' };
    state.ui.gameId = other.id;
    askDialog = async (o) => { shown = o; return 'cancel'; };
    await gamesChangeResult();
    assert.deepEqual(shown.actions.map((a) => a.label), ['Clear it and pick again', 'Keep it']);
  } finally { renderAll = realRender; askDialog = realAsk; celebrate = realCelebrate; state.ui.gameId = null; }
});
