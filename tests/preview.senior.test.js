// Preview as a counselor under the SENIOR profile: the same checks as preview.test.js (which this evals), over four teams
// with flag marks and no electives, plus the one thing that differs by design: the lens does not care which camp it is.
eval(readFixture('preview.test.js'));

test('senior: a director who is ON a team previews as a counselor on that team, with its own-team lock gone and no points', () => {
  assert.equal(CAMP.id, 'senior');
  boot('editor');
  setMemberTeam('t3');
  assert.ok(canEdit() && !canScoreRound('t3'), 'a director on a team is locked out of scoring its own team');
  previewStart();
  assert.equal(canScoreRound('t0'), false, 'and in a preview out of everyone\'s');
  assert.equal(followedTeam().id, 't3', 'the screen is that team\'s, as a counselor on it would see');
  setStandingsGuardThrows(true);
  const out = record(() => { SHELL_TABS.forEach((tab) => { state.ui.tab = tab; renderAll(); }); });
  assert.deepEqual(leaksIn(out), []);
  setMemberTeam(null);
  done();
});
