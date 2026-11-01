// The week-data accessors (the SEAM block in app.js, setup-rebuild-spec §9).
// While a section is off — it always is until the setup rebuild lands — an
// accessor hands back the camps.js constant ITSELF, so the seam is provably a
// no-op: every row below is a `===` against the constant it fronts, for every
// key the camp actually has. accessors.senior.test.js evals this file under the
// senior profile (the runner seeds the camp before the scripts load), so both
// camps get every row. The renderers' own output is covered by week.test.js,
// the 10,080-minute banner fuzz and render-stability.test.js, all unchanged.

const DOWS = [0, 1, 2, 3, 4, 5, 6];
const MEAL_KEYS = ['breakfast', 'lunch', 'supper'];
const TEAM_KEYS = Object.keys(CAMP.teamEmoji);

test('schedule accessors return the constant itself, and an empty list for a day with none', () => {
  DOWS.forEach((d) => {
    if (DAY_SCHEDULE[d]) assert.ok(scheduleForDow(d) === DAY_SCHEDULE[d], `day ${d} is the same array`);
    else assert.deepEqual(scheduleForDow(d), [], `day ${d} has no blocks`);
  });
  assert.ok(scheduleWeek() === DAY_SCHEDULE);
  assert.ok(weekDays() === SCHED_DAYS);
  DOWS.forEach((d) => assert.equal(dayLabel(d), DAY_NAMES[d] || ''));
  [undefined, null, 99, 'x'].forEach((junk) => {
    assert.deepEqual(scheduleForDow(junk), [], 'junk in, empty list out, no throw');
    assert.equal(dayLabel(junk), '');
  });
  assert.ok(Object.isFrozen(scheduleForDow(99)), 'the shared empty list cannot be scribbled on');
});

test('competitionDows are Monday to Friday and cannot be changed by a caller', () => {
  assert.deepEqual(competitionDows(), [1, 2, 3, 4, 5]);
  assert.ok(Object.isFrozen(competitionDows()));
});

test('meal accessors return the menu entries and meal times themselves', () => {
  DOWS.forEach((d) => MEAL_KEYS.forEach((m) => {
    const entry = (MEALS[d] || {})[m];
    if (entry) assert.ok(mealFor(d, m) === entry, `${d}/${m}`);
    else assert.equal(mealFor(d, m), null);
  }));
  assert.equal(mealFor(99, 'lunch'), null);
  assert.equal(mealFor(1, 'elevenses'), null);
  ['Breakfast', 'Lunch', 'Supper'].forEach((m) => assert.equal(mealStart(1, m), MEAL_START_MINUTES[m]));
  assert.deepEqual(['Breakfast', 'Lunch', 'Supper'].map((m) => mealStart(3, m)), [8 * 60, 12 * 60, 17 * 60]);
  // mealInfo is the block-shaped lookup the banner and sheet use.
  DOWS.forEach((d) => scheduleForDow(d).forEach((b) => {
    assert.ok(mealInfo(d, b) === mealFor(d, (b.label || '').toLowerCase()));
  }));
});

test('a block is a meal when its head label is one, decorated or not', () => {
  assert.equal(legacyMealOf('Supper'), 'Supper');
  assert.equal(legacyMealOf("Supper — Shepherd's Pie"), 'Supper');
  assert.equal(legacyMealOf('  Breakfast '), 'Breakfast');
  assert.equal(legacyMealOf('Free time'), null);
  assert.equal(legacyMealOf(undefined), null);
  assert.equal(blockMeal({ label: 'Lunch — Tacos' }), 'Lunch');
  assert.equal(blockMeal(null), null);
});

test('cleanup accessors normalize the rota to arrays and tell TBA from not-on-the-rota', () => {
  DOWS.forEach((d) => {
    assert.equal(cleanupOnRota(d), !!MEAL_CLEANUP_SCHEDULE[d], `day ${d} on the rota`);
    MEAL_CLEANUP_MEALS.forEach((meal) => {
      const raw = (MEAL_CLEANUP_SCHEDULE[d] || {})[meal];
      const want = raw ? [].concat(raw) : [];
      assert.deepEqual(cleanupTeams(d, meal), want, `${d}/${meal}`);
      if (Array.isArray(raw)) assert.ok(cleanupTeams(d, meal) === raw, 'a shared pair is the same array');
    });
  });
  assert.deepEqual(cleanupTeams(99, 'Lunch'), []);
  assert.deepEqual(cleanupTeams(1, 'Elevenses'), []);
});

test('verse accessors return the theme and each day\'s verse themselves', () => {
  assert.ok(verseTheme() === MEMORY_VERSE_THEME);
  [1, 2, 3, 4, 5].forEach((d) => assert.ok(verseFor(d) === MEMORY_VERSES[d], `verse ${d}`));
  const none = verseFor(0);
  assert.equal(none.text, '');
  assert.equal(none.ref, '');
  assert.equal(none.video, null, 'a missing day reads as an empty verse, not a throw');
});

test('elective accessors return the roster, emoji and slot starts themselves', () => {
  DOWS.forEach((d) => {
    if (ELECTIVES[d]) assert.ok(electivesFor(d) === ELECTIVES[d]);
    else assert.deepEqual(electivesFor(d), []);
  });
  Object.keys(STATION_EMOJI).forEach((name) => assert.equal(stationEmoji(name), STATION_EMOJI[name]));
  assert.equal(stationEmoji('A station nobody invented'), '🌟');
  ELECTIVE_SLOT_MIN.forEach((min, slot) => assert.equal(electiveSlotStart(slot, 1), min));
});

test('the double-points window is the legacy one, and the helpers still use it', () => {
  assert.ok(doubleWindow() === DOUBLE_WINDOW_LEGACY);
  const inside = new Date(DOUBLE_WINDOW_LEGACY.start + 1000).toISOString();
  const before = new Date(DOUBLE_WINDOW_LEGACY.start - 1000).toISOString();
  setMemberRole('editor');
  assert.equal(bonusCountsDouble({ category: 'custom', at: inside }), true);
  assert.equal(bonusCountsDouble({ category: 'custom', at: before }), false);
});

test('team accessors return the constants themselves for every team the camp has', () => {
  TEAM_KEYS.forEach((id) => {
    assert.equal(teamEmoji(id), TEAM_EMOJI[id], `${id} emoji survives the sanitizer unchanged`);
    assert.equal(teamShort(id), TEAM_ABBREV[id], `${id} short name`);
    assert.equal(teamAccent(id), TEAM_ACCENT[id] || null, `${id} accent`);
    assert.equal(teamCrestSrc(id), TEAM_SHIELD[id] || null, `${id} crest passes the sanitizer unchanged`);
  });
  assert.deepEqual(teamIds(), state.teams.map((t) => t.id));
  assert.equal(teamEmoji('t99'), '🏳️');
  assert.equal(teamShort('t99'), '');
  assert.equal(teamAccent('t99'), null);
  assert.equal(teamCrestSrc('t99'), null);
});

test('team accessors launder what a database could one day hand them', () => {
  const was = { e: TEAM_EMOJI.t0, s: TEAM_SHIELD.t0, a: TEAM_ABBREV.t0 };
  try {
    TEAM_EMOJI.t0 = '<img src=x onerror=alert(1)>';
    assert.equal(teamEmoji('t0'), '🏳️', 'markup in an emoji falls back');
    TEAM_SHIELD.t0 = 'https://tracker.example/pixel.png';
    assert.equal(teamCrestSrc('t0'), null, 'an external image is refused');
    TEAM_SHIELD.t0 = 'data:image/png;base64,AAAA" onerror="alert(1)';
    assert.equal(teamCrestSrc('t0'), null, 'a quote-breakout data URL is refused');
    TEAM_ABBREV.t0 = 'A name far too long for a tight space';
    assert.ok(teamShort('t0').length <= 20, 'a short name is cut');
  } finally {
    TEAM_EMOJI.t0 = was.e; TEAM_SHIELD.t0 = was.s; TEAM_ABBREV.t0 = was.a;
  }
});

test('the printed roster accessors cover every team, in order', () => {
  Object.keys(TEAM_COUNSELORS).forEach((tid) => assert.ok(teamRoster(tid) === TEAM_COUNSELORS[tid]));
  assert.deepEqual(teamRoster('t99'), []);
  const flat = [];
  Object.keys(TEAM_COUNSELORS).forEach((tid) => TEAM_COUNSELORS[tid].forEach((n) => flat.push(n)));
  assert.deepEqual(staffNames(), flat);
});

test('the roster a fresh device seeds, and what an old roster migrates from, come through unchanged', () => {
  assert.deepEqual(seedTeams(), makeFreshState().teams);
  assert.deepEqual(seedTeams().map((t) => t.name), DEFAULT_TEAM_NAMES);
  DEFAULT_TEAM_NAMES.forEach((name, i) => {
    const legacy = legacyRosterFor(i);
    assert.ok(legacy.oldNames === OLD_PLACEHOLDER_TEAM_NAMES[i]);
    assert.equal(legacy.name, name);
    assert.equal(legacy.oldCounselor, OLD_PLACEHOLDER_COUNSELORS[i]);
    assert.equal(legacy.counselor, DEFAULT_COUNSELORS[i]);
  });
});

test('game and day accessors read the live config, and survive a missing one', () => {
  assert.ok(allGames() === state.config.games);
  assert.ok(competitionDays() === state.config.days);
  const g = allGames()[0];
  assert.ok(gameById(g.id) === g);
  assert.equal(gameById('no-such-game'), undefined);
  const day = competitionDays()[0];
  assert.ok(dayById(day.id) === day);
  assert.deepEqual(gamesForDayId(day.id), allGames().filter((x) => x.dayId === day.id));
  const config = state.config;
  try {
    state.config = undefined;
    assert.deepEqual(allGames(), []);
    assert.deepEqual(competitionDays(), []);
    assert.equal(gameById('x'), undefined);
  } finally { state.config = config; }
});

test('gamesForBlock keeps the long-standing Morning / Evening rule for every games block', () => {
  let checked = 0;
  DOWS.forEach((dow) => scheduleForDow(dow).filter((b) => b.type === 'games').forEach((b) => {
    const session = b.start < 720 ? 'Morning' : 'Evening';
    const dayIds = state.config.days.filter((d) => d.dow === dow).map((d) => d.id);
    const want = state.config.games.filter((g) => dayIds.includes(g.dayId) && g.session === session);
    assert.deepEqual(gamesForBlock(dow, b), want, `day ${dow} block at ${b.start}`);
    checked++;
  }));
  assert.ok(checked > 0, 'the camp has competition blocks to check');
  const meal = scheduleForDow(1).find((b) => b.type !== 'games');
  assert.deepEqual(gamesForBlock(1, meal), [], 'only a games block holds games');
  assert.deepEqual(gamesForBlock(1, null), []);
});

test('the alert publisher keys come from the accessors and match the old spelling', () => {
  const blocks = pushScheduleBlocks(scheduleWeek());
  DOWS.forEach((dow) => scheduleForDow(dow).forEach((b, i) => {
    if (b.noTime) return;
    const id = blockPushId(b, dow, i);
    assert.equal(id, 'd' + dow + '-' + b.start + '-' + i);
    assert.ok(blocks[id], `${id} is published`);
    assert.equal(blocks[id].key, blockKey(b));
    assert.equal(blockKey(b), pushBlockKey(b.label));
  }));
});
