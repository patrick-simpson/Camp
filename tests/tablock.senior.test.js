// The two-tab writer lock under the SENIOR profile: the same checks as
// tablock.test.js (which this evals), against the senior camp's own lock and cache.
eval(readFixture('tablock.test.js'));

test('the senior run really is senior: its own lock name and cache key', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(navigator.locks, undefined, 'this file context has no lock API of its own');
  assert.equal(tabLockName(), 'camp-writer:senior');
  assert.equal(STORAGE_KEY, 'campScoreboardV2:senior');
});
