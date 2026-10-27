// The Teams tab at Senior Camp (4 teams). S0j said the number of teams is
// fixed; the old amber "bracket wizard is designed for 6 teams — you have 4
// (this camp normally runs 4)" sat right under that line and read as a
// contradiction. A roster that matches the camp is now a calm note, not a warning.

function teamsCard() {
  return { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
}

test('a 4-team roster at Senior Camp gets a calm note, not a warning', () => {
  freshState();
  assert.equal(CAMP.id, 'senior');
  assert.equal(state.teams.length, 4);
  const card = teamsCard();
  renderTeamsTab(card);
  assert.notOk(/warn-note/.test(card.innerHTML), 'no amber warning');
  assert.ok(/number of teams is fixed/.test(card.innerHTML));
  assert.ok(/Bracket games need 6 teams/.test(card.innerHTML) && /4-team bracket is planned/.test(card.innerHTML));
});

test('a roster that does not match the camp still warns (senior with 5)', () => {
  freshState();
  state.teams.push({ id: 't4', name: 'Extra', counselor: '' });
  const card = teamsCard();
  renderTeamsTab(card);
  assert.ok(/warn-note/.test(card.innerHTML) && /runs 4/.test(card.innerHTML), card.innerHTML);
});

test('a restore at Senior Camp refuses the junior six-team roster', () => {
  freshState();
  const before = JSON.stringify(state.teams);
  const six = ['t0', 't1', 't2', 't3', 't4', 't5'].map((id) => ({ id, name: id }));
  tryImport(JSON.stringify({ config: state.config, teams: six }));
  assert.equal(JSON.stringify(state.teams), before);
});
