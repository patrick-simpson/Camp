// Restore points on screen under the SENIOR profile: the same checks as restore-ui.test.js, which this evals.
eval(readFixture('restore-ui.test.js'));

test('the senior run really is senior', () => {
  assert.equal(CAMP.id, 'senior');
});
