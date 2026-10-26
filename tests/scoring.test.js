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

// ── Changelog entries must fit the database rules ─────────────────
// The rules cap reason at 500, team at 60, by at 80. A refused push is
// swallowed, so an over-long reason = a silently missing audit entry (a backup
// restore with 15+ scored games used to produce exactly that).

test('changelogReason: short lists pass through untouched', () => {
  assert.equal(changelogReason([]), 'Points updated');
  assert.equal(changelogReason(['Shields — result saved']), 'Shields — result saved');
  assert.equal(changelogReason(['A — result saved', 'B — result saved']), 'A — result saved; B — result saved');
});

test('changelogReason: a bulk change is clamped under the rules cap and counts what it left out', () => {
  const causes = [];
  for (let i = 0; i < 40; i++) causes.push('Game number ' + i + ' — result saved');
  const full = causes.join('; ');
  assert.ok(utf8Len(full) > 500, 'precondition: the unclamped reason would be refused');

  const out = changelogReason(causes);
  assert.ok(utf8Len(out) <= 500, 'fits the rules cap in bytes: ' + utf8Len(out));
  assert.ok(out.length <= 500);
  const m = out.match(/; … \+(\d+) more$/);
  assert.ok(m, 'ends with a "+N more" tail: ' + out.slice(-30));
  const shown = out.slice(0, out.length - m[0].length).split('; ').length;
  assert.equal(shown + Number(m[1]), causes.length, 'every cause is either shown or counted');
  assert.ok(out.startsWith(causes[0]), 'whole causes are kept from the front');
});

test('changelogReason: one absurdly long cause is cut rather than refused', () => {
  const out = changelogReason(['X'.repeat(2000) + ' — result saved', 'B — result saved']);
  assert.ok(utf8Len(out) <= 500, 'length ' + utf8Len(out));
  assert.ok(out.endsWith('; … +1 more'));
});

test('clampText never exceeds the byte budget or splits a character', () => {
  assert.equal(clampText('short', 60), 'short');
  const emoji = '🦊'.repeat(50); // 4 bytes each
  const out = clampText(emoji, 60);
  assert.ok(utf8Len(out) <= 60, 'bytes ' + utf8Len(out));
  assert.ok(out.endsWith('…'));
  assert.equal(out.replace(/🦊/g, '').replace('…', ''), '', 'only whole characters remain');
});

test('recordPointHistory pushes entries that satisfy the rules (reason ≤ 500, team ≤ 60, by ≤ 80)', () => {
  setMemberRole('editor');
  authUser = { email: 'Ed.Itor@example.com' };
  memberName = 'N'.repeat(200);
  const teamName0 = state.teams[0].name;
  state.teams[0].name = 'T'.repeat(100);
  const pushed = [];
  globalThis.firebase = { database: () => ({ ref: () => ({ push: (v) => { pushed.push(v); return Promise.resolve(); } }) }) };
  fbRef = {};

  // A restore-style bulk change: every game gets a result at once.
  state.results = {};
  clPrevSnap = snapshotForLog(medalCounts()); // baseline: nothing scored
  state.config.games.slice(0, 20).forEach((g) => {
    state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: '2026-07-20T12:00:00Z' };
  });
  recordPointHistory(medalCounts(), false);

  assert.ok(pushed.length >= 3, 'an entry per changed team: ' + pushed.length);
  pushed.forEach((e) => {
    assert.ok(utf8Len(e.reason) <= 500, 'reason ' + utf8Len(e.reason));
    assert.ok(utf8Len(e.team) <= 60, 'team ' + utf8Len(e.team));
    assert.ok(utf8Len(e.by) <= 80, 'by ' + utf8Len(e.by));
    assert.ok(e.reason.includes('more'), 'the clamp says how many it left out');
    assert.equal(e.byKey, 'ed,itor@example,com');
  });

  fbRef = null;
  delete globalThis.firebase;
  memberName = null;
  authUser = null;
  clPrevSnap = null;
  state.results = {};
  state.teams[0].name = teamName0;
});

// ── counterAllowNegative (Counselor Hide and Seek's −1) ───────────

test('parseScoreInput allows a negative only for games that opt in', () => {
  const allow = { counterAllowNegative: true };
  assert.equal(parseScoreInput(allow, '-1'), -1);
  assert.equal(parseScoreInput(allow, '-5'), -5);
  assert.equal(parseScoreInput(allow, '0'), 0);
  assert.equal(parseScoreInput(allow, 'abc'), null, 'junk is still junk');
  assert.equal(parseScoreInput(plain, '-1'), null, 'an ordinary game still rejects negatives');
  assert.equal(parseScoreInput(timed, '-1:30'), null, 'and a time is never negative');
});

test('a negative Hide-and-Seek score ranks last and reaches the medal auto-fill', () => {
  freshState();
  const g = gameById('counselor-hide-seek');
  assert.ok(g && g.counterAllowNegative, 'precondition: the real game opts in');
  state.drafts[g.id] = { scores: { t0: '-1', t1: '3', t2: '0' }, medals: {} };

  const live = tallyRankLive(g).map((e) => e.id);
  assert.deepEqual(live, ['t1', 't2', 't0'], 'the −1 team stays on the live board, below 0');
  const ranked = autoRank(g, state.drafts[g.id]).map((e) => e.id);
  assert.deepEqual(ranked, ['t1', 't2', 't0'], 'and is part of the medal auto-fill');
  delete state.drafts[g.id];
});

// ── A leftover bracket must not keep a non-tournament game "live" ──

test('liveHomeGames only treats a bracket as live for a tournament game', () => {
  freshState();
  const g = state.config.games.find((x) => x.format === 'tournament');
  state.brackets[g.id] = freshBracket();
  assert.ok(liveHomeGames().some((x) => x.id === g.id), 'a started tournament is live');

  // The director switches the game to tally; its bracket stays behind in state.
  const original = g.format;
  g.format = 'tally';
  assert.notOk(liveHomeGames().some((x) => x.id === g.id), 'the stale bracket no longer pins it to Live now');
  assert.equal(homeBoardGame(), null, 'nor takes over the home Big Board');
  g.format = original;
  delete state.brackets[g.id];
});
