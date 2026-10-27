// The roster migration in normalizeSyncedState (setup-rebuild-spec S0g): it
// swaps generic "Team N" names and placeholder counselors for the 2026 roster,
// and runs on EVERY remote merge. That is right for the legacy week and wrong
// for any later year, where a director's own team named "Team 4" would be
// swapped back. It runs only while state.meta.epoch is absent (the new-year
// setup wizard stamps one). A no-op today, pinned so the gate can't be lost.

function rosterOf(names, counselors) {
  freshState();
  state.teams = names.map((n, i) => ({ id: 't' + i, name: n, counselor: counselors ? counselors[i] : 'Pat' }));
}

test('legacy week: a placeholder team name and counselor are swapped for the real roster', () => {
  rosterOf(['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'], OLD_PLACEHOLDER_COUNSELORS);
  assert.notOk(state.meta.epoch, 'precondition: no epoch');
  normalizeSyncedState();
  assert.equal(state.teams[0].name, DEFAULT_TEAM_NAMES[0]);
  assert.equal(state.teams[0].counselor, DEFAULT_COUNSELORS[0]);
});

test('legacy week: a hand-edited name is left alone', () => {
  rosterOf(['The Hawks', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6']);
  normalizeSyncedState();
  assert.equal(state.teams[0].name, 'The Hawks');
  assert.equal(state.teams[0].counselor, 'Pat');
});

test('a new-year epoch: nothing on the roster is migrated back', () => {
  rosterOf(['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'], OLD_PLACEHOLDER_COUNSELORS);
  state.meta.epoch = 'e-2027';
  normalizeSyncedState();
  assert.deepEqual(state.teams.map((t) => t.name), ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'],
    'directors named these on purpose');
  assert.equal(state.teams[0].counselor, OLD_PLACEHOLDER_COUNSELORS[0], 'and so is the counselor');
});

test('a new-year epoch: a pruned empty counselor reads back as empty, not a 2026 name', () => {
  rosterOf(['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6']);
  state.teams.forEach((t) => { delete t.counselor; });
  state.meta.epoch = 'e-2027';
  normalizeSyncedState();
  state.teams.forEach((t) => assert.equal(t.counselor, ''));
});

test('legacy week: a missing counselor is still filled from the default roster', () => {
  rosterOf(['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6']);
  delete state.teams[2].counselor;
  normalizeSyncedState();
  assert.equal(state.teams[2].counselor, DEFAULT_COUNSELORS[2] || '');
});
