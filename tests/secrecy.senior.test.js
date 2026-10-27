// Standings secrecy under the SENIOR profile: the same checks as secrecy.test.js
// (which this evals) — four teams, flags instead of shields, no electives — so a
// leak that only senior's data shape could reach is caught too.
eval(readFixture('secrecy.test.js'));

test('the senior profile is the one under test', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(state.teams.length, 4);
});
