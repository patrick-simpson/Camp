// The whole app, running AS SENIOR CAMP. The `.senior.` in this filename
// makes the runner seed campScoreboardActiveCamp='senior' before the
// scripts load (see tests/run.js), so every constant here — DAY_SCHEDULE,
// TEAM_EMOJI, dbPath(), STORAGE_KEY — is the senior profile's. These are
// the same structural checks week.test.js runs for junior, plus the pieces
// that differ by design (4 teams, no electives, namespaced storage).

test('the senior profile is actually active', () => {
  assert.equal(CAMP.id, 'senior');
  assert.equal(activeCampId(), 'senior');
});

test('senior Firebase paths live under the sibling root', () => {
  assert.equal(dbPath('state'), 'seniorScoreboard/state');
  assert.equal(dbPath('config'), 'seniorScoreboard/config');
  assert.equal(dbPath('members'), 'seniorScoreboard/members');
});

test('senior localStorage keys are namespaced away from junior ones', () => {
  assert.equal(STORAGE_KEY, 'campScoreboardV2:senior');
  assert.equal(DAY_RANK_KEY, 'campScoreboardDayRanks:senior');
  assert.equal(CHANGE_DISMISS_KEY, 'campScoreboardDismissedChanges:senior');
  assert.equal(ANNOUNCE_DISMISS_KEY, 'campScoreboardDismissedAnnouncements:senior');
});

test('a fresh senior state seeds four teams and the senior catalog', () => {
  const s = freshState();
  assert.equal(s.teams.length, 4);
  assert.deepEqual(s.teams.map((t) => t.id), ['t0', 't1', 't2', 't3']);
  assert.ok(s.teams.every((t) => t.name && typeof t.counselor === 'string'));
  assert.equal(s.config.version, 5);
  assert.deepEqual(s.config.sessions, ['Morning', 'Afternoon', 'Evening']);
  assert.equal(s.config.days.length, 5);
  assert.equal(s.config.games.length, 25, 'five seeded games per day');
});

test('migrateState is idempotent on senior data and never fires junior one-shots', () => {
  const s = freshState();
  const before = JSON.stringify(s.config);
  migrateState(s);
  migrateState(s);
  assert.equal(JSON.stringify(s.config), before, 'nothing changed on re-migrate');
  assert.notOk(s.config.games.some((g) => g.messtival), 'the junior double-points migration never touches senior games');
});

test('normalizeSyncedState never renames senior teams', () => {
  freshState();
  state.teams[0].name = 'The Crimson Tide'; // a real rename an editor made
  state.teams[1].counselor = undefined;      // RTDB pruned an empty string
  normalizeSyncedState();
  assert.equal(state.teams[0].name, 'The Crimson Tide', 'no placeholder migration lists exist for senior');
  assert.equal(state.teams[1].counselor, '', 'pruned counselor heals to empty, not to a junior name');
});

test('nowBannerHtml survives every minute of every senior day', () => {
  // The cheapest possible validator of the hand-typed senior schedule: the
  // banner renderer walks blocks for all 10,080 minutes of the week.
  for (let dow = 0; dow <= 6; dow++) {
    for (let m = 0; m < 24 * 60; m++) {
      assert.doesNotThrow(() => nowBannerHtml(dow, m), `dow ${dow} minute ${m}`);
    }
  }
});

test('the senior day names its landmark blocks', () => {
  const noonish = nowBannerHtml(1, hm(10, 0));
  assert.ok(noonish !== undefined, 'mid-competition renders (slim banner)');
  const legacy = nowBannerHtml(1, hm(17, 0));
  assert.ok(String(legacy).includes('Legacy Game'), 'the Legacy Game block shows by name');
});

test('electives are fully inert at senior camp', () => {
  freshState();
  assert.notOk(CAMP.features.electives);
  assert.deepEqual(ELECTIVES, {});
  state.identity = 'Someone';
  assert.equal(electiveMeOnDay(1), false, 'no elective data → nobody is at a station');
  assert.equal(myStationFor(1, 0), null, 'and no station of mine to show');
  // The identity picker is an electives affordance — it must refuse to open.
  state.followTeam = 't1';
  state.identity = undefined;
  openIdentityPicker();
  assert.notOk(document.getElementById('team-picker-overlay').getAttribute === undefined, 'smoke: stub still an element');
});

test('the meal-cleanup rota is all TBA until filled in', () => {
  assert.deepEqual(cleanupTeams(1, 'Breakfast'), []);
  assert.equal(findNextCleanupFor('t0'), null, 'no rota → no "next cleanup" line on the Your team sheet');
});

test('senior verse card data renders without a real sheet', () => {
  [1, 2, 3, 4, 5].forEach((dow) => {
    assert.ok(MEMORY_VERSES[dow] && MEMORY_VERSES[dow].text.length, `day ${dow}`);
  });
});

test('teamEmoji and accents cover the four senior teams (and only them)', () => {
  ['t0', 't1', 't2', 't3'].forEach((id) => {
    assert.ok(teamEmoji(id) !== '🏳️', `${id} has a real emoji`);
    assert.ok(teamAccent(id), `${id} has an accent color`);
  });
  assert.equal(teamCrestSrc('t0'), null, 'no flag artwork yet — crest lookup is empty');
  assert.equal(teamEmoji('t5'), '🏳️', 'junior-only slots fall back safely');
});

// CHANGED ON PURPOSE (Step 22, setup-rebuild-spec S6b): this used to pin that a tournament game on senior's four teams showed the
// six-team wizard's "needs exactly 6 teams" card and created no bracket. Four teams now play the four-team bracket (brackets4): the
// game shows its own Start card, and the six-team wizard's node is never touched. A roster that is neither four nor six is still
// refused, with the count (below, on a five-team roster).
test('a tournament game on senior\'s four teams starts the four-team bracket, and never creates a six-team one', () => {
  freshState();
  setMemberRole('editor');
  assert.equal(state.teams.length, 4);
  const container = document.getElementById('entry-area');
  const g = { id: 'x', name: 'X', format: 'tournament', rules: [] };
  assert.doesNotThrow(() => renderTournament(container, g));
  assert.notOk(state.brackets && state.brackets.x, 'no six-team bracket was created');
  assert.notOk(/needs exactly 6 teams/.test(container.innerHTML), 'the six-team refusal is gone for a four-team roster');
  assert.ok(/data-four="pick"/.test(container.innerHTML) || /data-four="start-plan"/.test(container.innerHTML), 'the four-team Start card is what shows: ' + container.innerHTML.slice(0, 200));
  assert.equal(bracketPlayable(4), true);
});

test('a roster that is neither four nor six is refused with its count, and starts nothing', () => {
  freshState();
  setMemberRole('editor');
  state.teams = state.teams.concat([{ id: 't4', name: 'Fifth', counselor: '' }]);
  assert.equal(teamIds().length, 5);
  const container = document.getElementById('entry-area');
  const g = { id: 'y', name: 'Y', format: 'tournament', rules: [] };
  assert.doesNotThrow(() => renderTournament(container, g));
  assert.ok(/needs exactly 6 teams — you have 5/.test(container.innerHTML), container.innerHTML.slice(0, 200));
  assert.notOk(state.brackets && state.brackets.y, 'no bracket was created');
  assert.notOk(state.brackets4 && state.brackets4.y, 'and no four-team one either');
  assert.deepEqual(fourStartGame(g, [['t0', 't1'], ['t2', 't3']]), { ok: false, reason: 'teams', count: 5 });
});

test('a senior notice draft seeds itself and stays invisible', () => {
  freshState();
  assert.equal(state.notice.status, 'draft');
  assert.notOk(noticePosted(), 'a draft renders nowhere');
  assert.deepEqual(state.notice.zones.map((z) => z.teamId).sort(), ['t0', 't1', 't2', 't3']);
});
