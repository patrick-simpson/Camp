// The undo core under the SENIOR profile (4 teams, ':senior' storage keys): the same
// checks as undo.test.js (which this evals).
eval(readFixture('undo.test.js'));

test('the senior run really is senior: its own undo key', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(lsKey('campSetupUndo'), 'campSetupUndo:senior');
});
