// The setup engine under the SENIOR profile (4 teams, seniorScoreboard/setup, ':senior'
// storage keys): the same checks as setup-sync.test.js (which this evals).
eval(readFixture('setup-sync.test.js'));

test('the senior run really is senior: its own setup path, cache key and outbox', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(dbPath('setup'), 'seniorScoreboard/setup');
  assert.equal(lsKey(SETUP_KEY), 'campScoreboardSetupV1:senior');
  assert.equal(lsKey('campSetupRpOutbox'), 'campSetupRpOutbox:senior');
});
