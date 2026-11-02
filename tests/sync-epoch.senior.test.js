// A phone's unsent work from a previous camp year is stranded under the SENIOR profile
// (4 teams, seniorScoreboard/state, ':senior' storage keys): the same checks as
// sync-epoch.test.js (which this evals).
eval(readFixture('sync-epoch.test.js'));

test('the senior run really is senior: its own database root and its own stranded key', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(dbPath('state'), 'seniorScoreboard/state');
  assert.equal(lsKey('campScoreboardStranded'), 'campScoreboardStranded:senior');
});
