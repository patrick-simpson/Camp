// reveal-core.js under the SENIOR profile: the same checks as reveal-core.test.js
// (which this evals), sized to senior's four teams (g0…g3 groups), plus the one
// thing that differs by design.
eval(readFixture('reveal-core.test.js'));

test('the senior camp has four teams, so a full reveal is four groups and the first button is 4th place', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(CAMP.teamCount, 4);
  const now = Date.parse('2027-06-23T23:31:00Z');
  const v = revealView(mkCtl({ cur: 0, shown: 1, teams: 4 }), mkPub(1), now, 'tv');
  assert.equal(v.rows[0].place, 4);
  assert.equal(v.remaining, 3);
});
