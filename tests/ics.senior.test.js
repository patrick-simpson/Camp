// The calendar export under the SENIOR profile: the same checks as ics.test.js
// (which this evals), plus the one thing that differs by design.
eval(readFixture('ics.test.js'));

test('the senior export is named and keyed as senior', () => {
  assert.equal(CAMP.id, 'senior');
  assert.ok(uidsOf(buildDayIcs(1)).every((u) => u.startsWith('senior-1-')));
  assert.ok(unfold(buildDayIcs(1)).includes('X-WR-CALNAME:Senior Camp'));
});
