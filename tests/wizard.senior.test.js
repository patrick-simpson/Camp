// The new-year wizard's engine under the SENIOR profile (four teams, no electives): the same cases as wizard.test.js (which this evals).
eval(readFixture('wizard.test.js'));

test('the senior run really is senior: four teams, no elective items in the carry-over', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(state.teams.length, 4);
  const plan = wzPlan({ answers: { carry: Object.fromEntries(WIZARD_ITEMS.map((k) => [k, 'clear'])) } });
  assert.equal(Object.keys(plan.updates).filter((p) => /electives/.test(p)).length, 0);
});
