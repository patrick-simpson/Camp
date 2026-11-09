// A restore at Senior Camp (4 teams) refuses the junior six-team roster. (The classic Teams tab's roster notes went with it in
// Step 30; the Teams screen's own are pinned in teams-screen.test.js.)

test('a restore at Senior Camp refuses the junior six-team roster', () => {
  freshState();
  const before = JSON.stringify(state.teams);
  const six = ['t0', 't1', 't2', 't3', 't4', 't5'].map((id) => ({ id, name: id }));
  tryImport(JSON.stringify({ config: state.config, teams: six }));
  assert.equal(JSON.stringify(state.teams), before);
});
