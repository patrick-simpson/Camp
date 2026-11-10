// A team's own branding under the SENIOR profile (4 teams, flags instead of shields): the same checks as
// team-branding.test.js (which this evals), plus what differs by design.
eval(readFixture('team-branding.test.js'));

test('senior: with no shield artwork, an uploaded photo is what replaces the flag, and nothing else changes', () => {
  assert.equal(CAMP.id, 'senior');
  freshState();
  assert.equal(teamCrestSrc('t0'), null, 'no shipped crest');
  assert.equal(teamMarkSpec('t0').kind, 'flag');
  state.teams[0].photoV = 4;
  TEAM_PHOTO_MEM.set('t0:4', 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(teamMarkSpec('t0').kind, 'shield', 'the photo, drawn as a crest');
  assert.equal(teamMarkSpec('t1').kind, 'flag', 'the other teams keep their flags');
  TEAM_PHOTO_MEM.clear();
  freshState();
});
