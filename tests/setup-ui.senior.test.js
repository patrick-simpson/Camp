// Set up the week's behaviour layer under the SENIOR profile: the same checks as setup-ui.test.js, which this evals.
eval(readFixture('setup-ui.test.js'));

test('the senior run really is senior', () => {
  assert.equal(CAMP.id, 'senior');
});
