// The accessors under the SENIOR profile: the same rows as accessors.test.js
// (which this evals) against senior's constants, plus what differs by design —
// four teams, no electives, an empty cleanup rota, no flag artwork yet.
eval(readFixture('accessors.test.js'));

test('senior: the accessors read senior\'s data, and its gaps are safe', () => {
  assert.equal(CAMP.id, 'senior');
  assert.deepEqual(teamIds(), ['t0', 't1', 't2', 't3']);
  assert.deepEqual(staffNames(), [], 'no printed counselor lists');
  [0, 1, 2, 3, 4, 5, 6].forEach((d) => assert.deepEqual(electivesFor(d), [], `no electives on day ${d}`));
  assert.equal(cleanupOnRota(1), false);
  assert.deepEqual(cleanupTeams(1, 'Lunch'), []);
  assert.equal(teamCrestSrc('t0'), null, 'no flag artwork yet');
});
