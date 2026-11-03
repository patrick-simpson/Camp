// The team colour palette and its laundering under the SENIOR profile (4 teams, no shield artwork): the
// same checks as palette.test.js (which this evals).
eval(readFixture('palette.test.js'));

test('the senior run really is senior: four teams whose older colours are flags\' hues, each launders to a pair', () => {
  assert.equal(CAMP.id, 'senior');
  freshState();
  assert.equal(teamIds().length, 4);
  teamIds().forEach((id) => {
    assert.ok(/^--team-accent-l:#[0-9a-f]{6};--team-accent-d:#[0-9a-f]{6}$/.test(teamAccentVars(id)), id);
  });
});
