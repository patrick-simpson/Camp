// Restore points and Backups v3 under the SENIOR profile (4 teams, seniorScoreboard/restoreIndex, the
// ':senior' outbox key): the same checks as restore.test.js (which this evals).
eval(readFixture('restore.test.js'));

test('the senior run really is senior: its own root, outbox and a point of one camp is refused by the other', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(CAMP.dbRoot, 'seniorScoreboard');
  assert.equal(lsKey(RP_OUTBOX_KEY), 'campSetupRpOutbox:senior');
  assert.equal(CAMP.teamCount, 4);
});
