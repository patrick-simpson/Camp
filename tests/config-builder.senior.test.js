// The builder side of the config engine v2 under the SENIOR profile (4 teams): the same
// checks as config-builder.test.js (which this evals).
eval(readFixture('config-builder.test.js'));

test('the senior run really is senior', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(lsKey('campSetupUndo'), 'campSetupUndo:senior');
});
