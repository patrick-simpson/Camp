// The config engine v2 under the SENIOR profile (4 teams, seniorScoreboard/config,
// ':senior' storage keys): the same checks as config-sync.test.js (which this evals).
eval(readFixture('config-sync.test.js'));

test('the senior run really is senior: its own config path and its own undo key', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(dbPath('config'), 'seniorScoreboard/config');
  assert.equal(lsKey('campSetupUndo'), 'campSetupUndo:senior');
});
