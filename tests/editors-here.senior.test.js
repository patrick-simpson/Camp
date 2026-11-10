// "Also here" and Devices under the SENIOR profile (seniorScoreboard/editorsHere): the same checks as
// editors-here.test.js (which this evals).
eval(readFixture('editors-here.test.js'));

test('the senior run really is senior: its own editorsHere path', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(dbPath('editorsHere'), 'seniorScoreboard/editorsHere');
});
