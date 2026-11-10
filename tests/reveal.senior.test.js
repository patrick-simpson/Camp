// reveal.js under the SENIOR profile: the same checks as reveal.test.js (which this evals), sized to senior's four
// teams (g0…g3), on the sibling database root, plus the things that differ by design.
eval(readFixture('reveal.test.js'));

test('the senior camp reveals four groups from the sibling root, and the public path is its own', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(CAMP.teamCount, 4);
  assert.equal(dbPath('revealPublic/real'), 'seniorScoreboard/revealPublic/real');
  assert.equal(dbPath('revealPublic/practice'), 'seniorScoreboard/revealPublic/practice');
  assert.equal(lsKey(REVEAL_CACHE_KEY), 'campScoreboardRevealCache:senior', 'the cache is per camp');
  assert.equal(lsKey(REVEAL_CHAMPION_KEY), 'campScoreboardChampion:senior');
});
