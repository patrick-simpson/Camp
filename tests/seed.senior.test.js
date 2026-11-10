// The seed and the schedule maths under the SENIOR profile: the same checks as seed.test.js (which this evals),
// which branch on CAMP.id for the numbers that differ by design (four teams, no patches, placeholder bookends).
eval(readFixture('seed.test.js'));

test('the senior run really is senior: the stub Sunday and Saturday are marked, the sample day is the typical one', () => {
  assert.equal(CAMP.id, 'senior');
  const s = buildSeed(CAMP);
  assert.deepEqual(['sun', 'sat'].map((dk) => s.days[dk].placeholder), [true, true]);
  assert.deepEqual(['mon', 'tue', 'wed', 'thu', 'fri'].map((dk) => s.days[dk].typical), [true, true, true, true, true]);
});
