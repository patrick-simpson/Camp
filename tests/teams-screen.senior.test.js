// The Teams screen under the SENIOR profile (4 teams, flags): the same checks as teams-screen.test.js (which this evals), plus
// what differs by design.
eval(readFixture('teams-screen.test.js'));

test('senior: four teams, the flag colours are older colours judged on both surfaces, and Red is hard to read in dark mode (the spec\'s own example)', () => {
  assert.equal(CAMP.id, 'senior');
  tsOpen();
  assert.equal(teamsModel().rows.length, 4);
  assert.deepEqual(teamColorInfo('t0').weak.includes('dark'), true);
  renderTeamsScreen();
  assert.equal(tsEl('teams-headline').textContent, '4 teams');
  tsClose();
});
