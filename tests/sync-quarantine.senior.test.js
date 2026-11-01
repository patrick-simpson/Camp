// The refused-write quarantine under the SENIOR profile: the same checks as
// sync-quarantine.test.js (which this evals), against seniorScoreboard/state.
eval(readFixture('sync-quarantine.test.js'));

test('the senior run really is senior, and its database root is the sibling one', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(dbPath('state'), 'seniorScoreboard/state');
});
