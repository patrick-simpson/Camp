// Team names and counselors sync per field under the SENIOR profile (4 teams): the
// same checks as teams-sync.test.js (which this evals), against seniorScoreboard/state.
eval(readFixture('teams-sync.test.js'));

test('the senior run really is senior: four teams, its own database root', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(dbPath('state'), 'seniorScoreboard/state');
  freshState();
  assert.equal(state.teams.length, 4);
});
