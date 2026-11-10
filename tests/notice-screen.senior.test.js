// The Notice board screen under the SENIOR profile (four teams): the same checks as notice-screen.test.js, which this evals.
eval(readFixture('notice-screen.test.js'));

test('the senior run really is senior', () => {
  assert.equal(CAMP.id, 'senior');
});
