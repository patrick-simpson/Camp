// reveal-ui.js under the SENIOR profile: the same checks as reveal-ui.test.js (which this evals), sized to senior's four
// teams, whose marks are flags (a shape from the team's order), plus the things that differ by design.
eval(readFixture('reveal-ui.test.js'));

test('senior: four teams, flag marks in the rows and the mini TV, and the same rows for a 4-team ladder', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(CAMP.teamCount, 4);
  bootUi('viewer');
  atTime(mkCtl().at + 50000);
  showReveal(mkCtl({ cur: 1, shown: 2 }), mkPub(2));
  const html = el('now-reveal-list').innerHTML;
  assert.ok(/<svg class="tm flag"/.test(html), 'a flag mark, not a shield');
  assert.ok(!/<img/.test(html), 'senior ships no shield image');
  assert.equal(rows('now-reveal-list').length, 4, 'four rows in all');
  assert.equal(el('now-reveal-count').textContent, '2 of 4 shown');
  teardownUi();
});
