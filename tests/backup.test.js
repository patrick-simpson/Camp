// Backup / restore (settings.js → Data tab) and the bracket shape it can carry.
// A restore is the one place the app takes a whole synced tree from OUTSIDE —
// hand-edited files, an old build's export, anything that round-tripped through
// Realtime Database and lost its empty arrays — and then pushes it to every
// device. So it has to be at least as careful as the sync merge.

function seed() {
  freshState();
  state.teams = [
    { id: 't0', name: 'Alpha' }, { id: 't1', name: 'Bravo' }, { id: 't2', name: 'Charlie' },
    { id: 't3', name: 'Delta' }, { id: 't4', name: 'Echo' }, { id: 't5', name: 'Foxtrot' },
  ];
  return state.config.games[0].id;
}

test('a backup round-trips the whole week', () => {
  const gid = seed();
  state.results[gid] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'x' };
  state.bonuses = { b1: { teamId: 't0', category: 'verse', points: 3, day: 1 } };
  const before = medalCounts().t0.points;

  const backup = backupJSON();
  freshState();
  assert.equal(medalCounts().t0.points, 0, 'wiped');

  tryImport(backup);
  assert.equal(medalCounts().t0.points, before, 'restored to the same total');
  assert.deepEqual(state.results[gid].medals, { gold: 't0', silver: 't1', bronze: 't2' });
});

test('an imported bracket stripped of its empty arrays is healed, not left to crash', () => {
  const gid = seed();
  // Exactly what a bracket looks like after RTDB pruning: no matches,
  // no selectedPair, no null fields. renderTournament maps over matches, so
  // importing this raw used to blank-screen every device the moment it synced.
  const payload = JSON.stringify({
    app: 'campScoreboardV2',
    config: state.config,
    teams: state.teams,
    brackets: { [gid]: { phase: 'round1', pool: ['t0', 't1'] } },
    picRounds: { t0: { done: false } },
    drafts: { [gid]: { scores: { t0: 5 } } },
    live: { [gid]: { key: 't0|t1' } },
  });

  tryImport(payload);

  assert.deepEqual(state.brackets[gid].matches, []);
  assert.deepEqual(state.brackets[gid].selectedPair, []);
  assert.equal(state.brackets[gid].byeTeamId, null);
  assert.deepEqual(state.picRounds.t0.laps, []);
  assert.deepEqual(state.drafts[gid].medals, {});
  assert.deepEqual(state.live[gid].hr, {});
  assert.equal(state.live[gid].inning, 1);
});

test('an import rejects anything that is not a backup', () => {
  const gid = seed();
  state.results[gid] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
  ['', 'not json', '{}', '{"hello":"world"}', '[]'].forEach((junk) => {
    tryImport(junk);
    assert.deepEqual(Object.keys(state.results), [gid], `"${junk}" must leave the week alone`);
  });
});

test('an import ignores wrongly-typed sections instead of adopting them', () => {
  seed();
  const payload = JSON.stringify({
    config: defaultConfig(),
    teams: [],                 // empty roster — must not replace the real one
    results: null,             // would crash every render if adopted
    bonuses: ['not', 'a map'], // array where a map belongs
  });
  const teamsBefore = state.teams.length;
  tryImport(payload);
  assert.equal(state.teams.length, teamsBefore, 'an empty roster is ignored');
  assert.ok(state.results && typeof state.results === 'object');
  assert.notOk(Array.isArray(state.bonuses));
});

test('an import drops results for games the imported catalog does not have', () => {
  seed();
  const config = defaultConfig();
  const keep = config.games[0].id;
  const payload = JSON.stringify({
    config,
    results: {
      [keep]: { medals: { gold: 't0', silver: 't1', bronze: 't2' } },
      'game-from-another-week': { medals: { gold: 't0', silver: 't1', bronze: 't2' } },
    },
  });
  tryImport(payload);
  assert.deepEqual(Object.keys(state.results), [keep],
    'an orphan result has no UI left to clear it, so it would skew the standings forever');
});

test('restoring the default catalog keeps the teams and their scores', () => {
  const gid = seed();
  state.results[gid] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
  state.config.games.push({
    id: 'my-custom-game', name: 'Custom', dayId: 'd1', session: 'Morning', format: 'placement', rules: [],
  });
  state.results['my-custom-game'] = { medals: { gold: 't1', silver: 't0', bronze: 't2' } };

  restoreDefaults();

  assert.equal(state.teams.length, 6, 'teams are kept');
  assert.notOk(state.config.games.some((g) => g.id === 'my-custom-game'), 'the custom game is gone');
  assert.notOk('my-custom-game' in state.results, 'and so is its result');
  assert.ok(gid in state.results, 'but a default game keeps its medals');
});

// ── Bracket shape ────────────────────────────────────────────────

test('a fresh bracket starts in round1 with the whole pool', () => {
  seed();
  const b = freshBracket();
  assert.equal(b.phase, 'round1');
  assert.equal(b.pool.length, 6);
  assert.deepEqual(b.matches, []);
  assert.equal(b.byeTeamId, null);
});

test('normalizeBracket never loses data it does have', () => {
  seed();
  const b = normalizeBracket({
    phase: 'semifinal', pool: ['t0'], matches: [{ a: 't0', b: 't1', winner: 't0' }],
    byeTeamId: 't2', semifinal: { a: 't0', b: 't1' },
  });
  assert.equal(b.phase, 'semifinal');
  assert.equal(b.matches.length, 1);
  assert.equal(b.byeTeamId, 't2');
  assert.deepEqual(b.semifinal, { a: 't0', b: 't1' });
  assert.deepEqual(b.selectedPair, [], 'and fills in only what was missing');
});
