// Score entry/formatting and the standings maths — the numbers on the wall.

const timed = { timeInput: true };
const plain = {};

test('parseScoreInput reads mm:ss and plain numbers', () => {
  assert.equal(parseScoreInput(timed, '1:30'), 90);
  assert.equal(parseScoreInput(timed, '0:07.5'), 7.5);
  assert.equal(parseScoreInput(timed, ' 2:00 '), 120);
  assert.equal(parseScoreInput(plain, '42'), 42);
  assert.equal(parseScoreInput(plain, '3.5'), 3.5);
});

test('parseScoreInput rejects blanks, junk, and impossible values', () => {
  assert.equal(parseScoreInput(plain, ''), null);
  assert.equal(parseScoreInput(plain, '   '), null);
  assert.equal(parseScoreInput(plain, 'abc'), null);
  assert.equal(parseScoreInput(plain, '-5'), null, 'scores are never negative');
  assert.equal(parseScoreInput(timed, '-1:30'), null, 'times are never negative');
  assert.equal(parseScoreInput(timed, '1:60'), null, 'seconds must be < 60');
  assert.equal(parseScoreInput(timed, '1:xx'), null);
});

test('formatScore never emits a 60-second reading', () => {
  // 119.97s rounds to 120.0 — the naive version printed "1:60".
  assert.equal(formatScore(timed, 119.97), '2:00');
  assert.equal(formatScore(timed, 59.99), '1:00');
  assert.equal(formatScore(timed, 90), '1:30');
  assert.equal(formatScore(timed, 7.5), '0:07.5');
  assert.equal(formatScore(plain, 42), '42');
});

test('parse → format round-trips a typed time', () => {
  ['0:01', '0:45.5', '1:30', '12:09'].forEach((s) => {
    assert.equal(formatScore(timed, parseScoreInput(timed, s)), s);
  });
});

test('esc closes every HTML injection vector used in attributes', () => {
  assert.equal(esc('<b>'), '&lt;b&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(esc("O'Brien"), 'O&#39;Brien');
  assert.equal(esc(null), 'null', 'non-strings are coerced, never thrown on');
});

// ── Standings ────────────────────────────────────────────────────

function setupTeams() {
  freshState();
  state.teams = [
    { id: 't0', name: 'Alpha' }, { id: 't1', name: 'Bravo' }, { id: 't2', name: 'Charlie' },
  ];
  state.results = {};
  state.bonuses = {};
  return state.config.games;
}

test('medalCounts pays gold/silver/bronze at MEDAL_POINTS', () => {
  const games = setupTeams();
  state.results[games[0].id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
  const c = medalCounts();
  assert.equal(c.t0.points, MEDAL_POINTS.gold);
  assert.equal(c.t1.points, MEDAL_POINTS.silver);
  assert.equal(c.t2.points, MEDAL_POINTS.bronze);
  assert.equal(c.t0.gold, 1);
  assert.equal(c.t0.silver, 0);
});

test('a messtival game pays double points but still counts one medal', () => {
  const games = setupTeams();
  const g = games[0];
  g.messtival = true;
  state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
  const c = medalCounts();
  assert.equal(c.t0.points, MEDAL_POINTS.gold * 2);
  assert.equal(c.t0.gold, 1, 'medal COUNTS stay raw — only the point value doubles');
});

test('a result for a game no longer in the catalog is ignored', () => {
  setupTeams();
  state.results['game-that-was-deleted'] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
  const c = medalCounts();
  assert.equal(c.t0.points, 0, 'an orphan medal must not haunt the standings forever');
});

test('a result missing its medals block never throws', () => {
  setupTeams();
  state.results['x'] = null;
  state.results['y'] = {};
  assert.doesNotThrow(() => medalCounts());
});

test('bonusBreakdown splits verse / cleanup / custom into their own columns', () => {
  setupTeams();
  state.bonuses = {
    b1: { teamId: 't0', category: 'verse', points: 3 },
    b2: { teamId: 't0', category: 'cleanup', points: 2 },
    b3: { teamId: 't0', category: 'custom', points: 5 },
    b4: { teamId: 't0', points: 1 }, // no category → custom
  };
  const c = medalCounts();
  assert.equal(c.t0.verse, 3);
  assert.equal(c.t0.meals, 2);
  assert.equal(c.t0.custom, 6);
  assert.equal(c.t0.bonus, 11);
  assert.equal(c.t0.points, 11, 'bonuses feed the grand total');
});

test('bonuses survive pruned/garbage fields and unknown teams', () => {
  setupTeams();
  state.bonuses = {
    b1: { teamId: 't0', category: 'custom', points: '4' }, // string from a JSON round-trip
    b2: { teamId: 'ghost', category: 'custom', points: 99 }, // team deleted
    b3: { teamId: 't0', category: 'custom' }, // points pruned by RTDB
    b4: null,
  };
  const c = medalCounts();
  assert.equal(c.t0.custom, 4);
  assert.equal(c.t1.custom, 0);
});

test('negative bonus points subtract', () => {
  setupTeams();
  state.bonuses = { b1: { teamId: 't0', category: 'custom', points: -3 } };
  assert.equal(medalCounts().t0.points, -3);
});

test('rankTeamsByPoints breaks point ties by medal quality', () => {
  setupTeams();
  const counts = {
    t0: { points: 10, gold: 0, silver: 2, bronze: 0 },
    t1: { points: 10, gold: 1, silver: 0, bronze: 1 },
    t2: { points: 12, gold: 0, silver: 0, bronze: 0 },
  };
  assert.deepEqual(rankTeamsByPoints(counts).map((t) => t.id), ['t2', 't1', 't0'],
    'more points first; on a tie the team with the gold outranks the one with two silvers');
});
