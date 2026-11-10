// The hub's checklist under the SENIOR profile (four teams, no electives): the same checks as
// checklist.test.js, which this evals.
eval(readFixture('checklist.test.js'));

test('the senior run really is senior: four teams, no electives row in its total', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(CAMP.teamCount, 4);
  assert.equal(hubModel(clView({ electives: !!CAMP.features.electives })).total, 3);
});
