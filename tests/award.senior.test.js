// award.js under the SENIOR profile: the same checks as award.test.js (which this evals), sized to senior's four teams, whose marks
// are flags, plus the things that differ by design (its printed cleanup rota is empty).
eval(readFixture('award.test.js'));

test('senior: four teams, flag marks in the rows and the quick-points toggles, and a printed rota with nobody on it', () => {
  assert.equal(CAMP.id, 'senior');
  boot();
  assert.equal((awardVerseRows(WED).match(/class="aw-row"/g) || []).length, 4, 'four verse rows');
  assert.ok(/<svg class="tm flag"/.test(awardVerseRows(WED)) && !/<img/.test(awardVerseRows(WED)), 'flags, not shield images');
  assert.equal((awardTeamsHtml().match(/class="aw-team"/g) || []).length, 4);
  cleanupTeams = realCleanupTeams; // the camp's own rota: empty, so every meal reads "no team on the rota"
  const html = awardCleanupRows(WED);
  assert.equal((html.match(/class="aw-none"/g) || []).length, 3);
  assert.equal((html.match(/class="aw-pt"/g) || []).length, 0);
  done();
});
