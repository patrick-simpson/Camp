// stalling.html is a self-contained gag page that loads no camp code; its one
// link into the real app is the Current Standings card.

test('the stalling page links to the camp the presenter is in, and its copy follows the team count', () => {
  const ST = readFixture('../stalling.html');
  assert.ok(/data-tv-link/.test(ST), 'the standings card is marked for the link rewrite');
  assert.ok(/campScoreboardActiveCamp/.test(ST), 'it reads the same device-local camp key the app writes');
  assert.ok(/current-standings\.html\?camp=/.test(ST), 'and passes it as ?camp=');
  assert.ok(/id="tv-count"/.test(ST), 'the "count them down" copy has a hook for the team count');
  // The two team counts the page knows must be the camps' real ones.
  const m = /TEAM_COUNTS\s*=\s*\{\s*junior:\s*(\d+),\s*senior:\s*(\d+)\s*\}/.exec(ST);
  assert.ok(m, 'a TEAM_COUNTS table');
  assert.equal(Number(m[1]), CAMPS.junior.teamCount, 'junior count matches camps.js');
  assert.equal(Number(m[2]), CAMPS.senior.teamCount, 'senior count matches camps.js');
});
