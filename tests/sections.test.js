// Meals, memory verses, the cleanup rota and electives as DATA (setup-rebuild-spec §5.2, §9.2, §10.2, §11.10–11.13;
// build step 19): the seed, the accessors' "edited here" half, fill-evenly and the fairness line, an elective person's
// identity (member key first, then name, through canonicalCounselorName), the Meal tag, the verse video, the mutators the
// four screens commit, and the owner's Turn on. Nothing here is visible until the owner turns a section on: every
// accessor is proven the constant itself while off, and the constant's value (deep-equal) once the seed is on.
// Runs under the senior profile too (sections.senior.test.js): the junior-only expectations branch on CAMP.id.

const SEC_ALL = ['schedule', 'meals', 'verses', 'cleanup', 'electives'];
const SEC_DOWS = [0, 1, 2, 3, 4, 5, 6];
const SEC_JR = CAMP.id === 'junior';
// The harness's deepEqual compares JSON text, so key order counts: compare in RTDB's own (sorted) order.
const secSorted = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x)));
const secEq = (a, b, msg) => assert.deepEqual(secSorted(a), secSorted(b), msg);

function secLoad(sections) {
  freshState();
  setMemberRole('editor');
  setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, sections || SEC_ALL))));
  setupRev++;
  undoClear();
  return setupTree;
}
function secOff() {
  freshState();
  setupTree = normalizeSetup({});
  setupRev++;
}

// ── the seed ──

test('the seed of the four sections has the rules\' record shapes and survives RTDB\'s canonical form', () => {
  const s = buildSeed(CAMP, SEC_ALL);
  assert.deepEqual(s.meta.on, { schedule: true, meals: true, verses: true, cleanup: true, electives: true });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'plain data');
  assert.equal(JSON.stringify(buildSeed(CAMP, SEC_ALL)), JSON.stringify(s), 'deterministic');
  // meals: <dk>/<meal> { dish 1–80, emoji ≤ 16 with no markup }
  Object.keys(s.meals || {}).forEach((dk) => Object.keys(s.meals[dk]).forEach((m) => {
    assert.ok(SETUP_DK.includes(dk) && SETUP_MEAL_KEYS.includes(m), dk + '/' + m);
    const r = s.meals[dk][m];
    assert.ok(typeof r.dish === 'string' && r.dish.length >= 1 && r.dish.length <= 80);
    if (r.emoji !== undefined) assert.ok(r.emoji.length <= 16 && !/[<>&"]/.test(r.emoji));
  }));
  // verses: a theme with words, a day with words, a video only when https and ≤ 300
  assert.ok(s.verses.theme.text.length >= 1 && s.verses.theme.text.length <= 600);
  Object.keys(s.verses.days).forEach((dk) => {
    const v = s.verses.days[dk];
    assert.ok(SETUP_DK.includes(dk) && v.text.length >= 1 && v.text.length <= 600 && (v.ref || '').length <= 80);
    if (v.video) assert.ok(/^https:\/\//.test(v.video) && v.video.length <= 300);
  });
  // cleanup: <dk>/<meal>/<tid>: true
  Object.keys(s.cleanup || {}).forEach((dk) => Object.keys(s.cleanup[dk]).forEach((m) => Object.keys(s.cleanup[dk][m]).forEach((t) => {
    assert.ok(/^t[0-9]$/.test(t) && s.cleanup[dk][m][t] === true);
  })));
  // electives: station ids, slot keys, records with an ord, people with a name and an ord
  const e = s.electives || {};
  Object.keys(e.stations || {}).forEach((id) => {
    assert.ok(/^st-[a-z0-9-]{1,36}$/.test(id), id);
    assert.ok(e.stations[id].name.length >= 1 && e.stations[id].name.length <= 60);
  });
  Object.keys(e.slots || {}).forEach((dk) => Object.keys(e.slots[dk]).forEach((sl) => {
    assert.ok(/^s[0-2]$/.test(sl));
    Object.keys(e.slots[dk][sl]).forEach((st) => {
      assert.ok(e.stations[st], 'a slot names a station that exists');
      assert.equal(typeof e.slots[dk][sl][st].ord, 'number');
      Object.keys(e.slots[dk][sl][st].people || {}).forEach((p) => {
        assert.ok(p.length <= 200 && setupIsTypedPerson(p), p);
        assert.ok(e.slots[dk][sl][st].people[p].name.length <= 60 && typeof e.slots[dk][sl][st].people[p].ord === 'number');
      });
    });
  }));
  ['meals', 'verses', 'cleanup', 'electives'].forEach((k) => { if (s[k]) secEq(syncCanon({ [k]: s[k] }), { [k]: s[k] }, k + ' is not pruned by the database'); });
});

test('the seed carries the printed menus, rota, verses and stations exactly (junior) or leaves empty sections out (senior)', () => {
  const s = buildSeed(CAMP, SEC_ALL);
  if (SEC_JR) {
    assert.equal(s.meals.mon.lunch.dish, 'Wraps');
    assert.deepEqual(s.meals.sun, { supper: { dish: "Shepherd's Pie", emoji: '🥧' } });
    assert.deepEqual(s.cleanup.mon, { breakfast: { t5: true }, lunch: { t4: true }, supper: { t0: true } });
    assert.deepEqual(s.cleanup.fri.breakfast, { t3: true, t4: true }, 'Friday\'s pairs');
    assert.equal(s.verses.days.thu.video, MEMORY_VERSES[4].video);
    assert.equal(s.verses.days.mon.video, undefined);
    assert.equal(Object.keys(s.electives.stations).length, Object.keys(STATION_EMOJI).length, 'every printed station is on the list');
    assert.equal(s.electives.stations['st-crafts-with-eileen'].emoji, '🎨');
    assert.deepEqual(Object.keys(s.electives.slots).sort(), ['fri', 'mon', 'thu', 'tue', 'wed']);
    const swim = s.electives.slots.mon.s0['st-swimming'];
    assert.deepEqual(swim.people, { 'n-bria': { name: 'Bria', ord: 10 }, 'n-abby': { name: 'Abby', ord: 20 } });
    assert.equal(swim.ord, 10);
  } else {
    assert.ok(!s.meals && !s.cleanup && !s.electives, 'senior has no menu, rota or electives to seed');
    assert.ok(s.verses && s.verses.theme, 'its verses are seeded');
    assert.equal(s.meta.on.electives, true, 'the switch is still asked for by name; the screen simply is not offered');
  }
});

test('a plain buildSeed(camp) is still the schedule alone, and a section left out is not written', () => {
  const plain = buildSeed(CAMP);
  assert.deepEqual(plain.meta.on, { schedule: true });
  assert.ok(!plain.meals && !plain.verses && !plain.cleanup && !plain.electives);
  const one = buildSeed(CAMP, ['verses']);
  assert.deepEqual(Object.keys(one).sort(), ['meta', 'verses']);
  assert.deepEqual(one.meta.on, { verses: true });
});

// ── the accessors ──

test('while a section is off every accessor is the constant itself', () => {
  secOff();
  SEC_DOWS.forEach((d) => {
    ['breakfast', 'lunch', 'supper'].forEach((m) => assert.ok(mealFor(d, m) === ((MEALS[d] || {})[m] || null), d + m));
    assert.deepEqual(cleanupTeams(d, 'Lunch'), [].concat(((MEAL_CLEANUP_SCHEDULE[d] || {}).Lunch) || []));
    assert.equal(cleanupOnRota(d), !!MEAL_CLEANUP_SCHEDULE[d]);
    if (ELECTIVES[d]) assert.ok(electivesFor(d) === ELECTIVES[d]);
  });
  assert.ok(verseTheme() === MEMORY_VERSE_THEME);
  assert.ok(verseFor(2) === MEMORY_VERSES[2]);
  assert.ok(staffNames().length === Object.keys(TEAM_COUNSELORS).reduce((n, t) => n + TEAM_COUNSELORS[t].length, 0), 'the printed roster only');
  assert.equal(electiveSlotStart(1, 3), ELECTIVE_SLOT_MIN[1]);
  assert.equal(mealStart(3, 'Lunch'), MEAL_START_MINUTES.Lunch);
});

test('with every section on and freshly seeded, each accessor returns what the constant held', () => {
  secLoad();
  SEC_DOWS.forEach((d) => {
    ['breakfast', 'lunch', 'supper'].forEach((m) => assert.deepEqual(mealFor(d, m), (MEALS[d] || {})[m] || null, 'meal ' + d + m));
    MEAL_CLEANUP_MEALS.forEach((meal) => {
      assert.deepEqual(cleanupTeams(d, meal), [].concat(((MEAL_CLEANUP_SCHEDULE[d] || {})[meal]) || []), 'cleanup ' + d + meal);
    });
    assert.equal(cleanupOnRota(d), !!MEAL_CLEANUP_SCHEDULE[d], 'on the rota ' + d);
    assert.deepEqual(electivesFor(d).map((slot) => slot.map((row) => [row[0], row[1]])), (ELECTIVES[d] || []).map((slot) => slot.map((row) => [row[0], row[1]])), 'electives ' + d);
  });
  assert.deepEqual(verseTheme(), MEMORY_VERSE_THEME);
  [1, 2, 3, 4, 5].forEach((d) => assert.deepEqual(verseFor(d), MEMORY_VERSES[d], 'verse ' + d));
  assert.equal(verseFor(0).text, '', 'a day with no verse reads as an empty one');
  Object.keys(STATION_EMOJI).forEach((n) => assert.equal(stationEmoji(n), STATION_EMOJI[n]));
  assert.equal(stationEmoji('Nobody invented this'), '🌟');
  [1, 2, 3, 4, 5].forEach((d) => ELECTIVE_SLOT_MIN.forEach((min, slot) => { if (SEC_JR) assert.equal(electiveSlotStart(slot, d), min, 'slot ' + slot + ' day ' + d); }));
  [1, 2, 3, 4, 5].forEach((d) => ['Breakfast', 'Lunch', 'Supper'].forEach((m) => { if (SEC_JR) assert.equal(mealStart(d, m), MEAL_START_MINUTES[m], m + ' ' + d); }));
});

test('the accessors hand back the same objects until the tree changes (render-stability), and a change shows at once', () => {
  secLoad();
  const a = mealFor(1, 'lunch');
  const b = electivesFor(1);
  assert.ok(SEC_JR ? mealFor(1, 'lunch') === a : true);
  assert.ok(electivesFor(1) === b);
  setupTree.meals = setupTree.meals || {};
  setupTree.meals.mon = { lunch: { dish: 'Soup', emoji: '🍜' } };
  setupRev++;
  assert.deepEqual(mealFor(1, 'lunch'), { dish: 'Soup', emoji: '🍜' });
  assert.ok(electivesFor(1) !== b || !SEC_JR, 'a new revision rebuilds');
});

test('what a database holds is laundered on its way out: emoji markup, a javascript: video, a team past the roster', () => {
  secLoad();
  setupTree.meals = { mon: { lunch: { dish: 'Soup', emoji: '<img src=x onerror=alert(1)>' } } };
  setupTree.verses.days.mon = { text: 'Words', ref: 'Ref 1:1', video: 'javascript:alert(1)' };
  setupTree.verses.days.tue = { text: 'More', ref: 'Ref 2:2', video: 'http://not-https.example/v' };
  setupTree.verses.days.wed = { text: 'Fine', ref: 'Ref 3:3', video: 'https://youtu.be/abc' };
  setupTree.cleanup = { mon: { lunch: { t0: true, t8: true, junk: true, t1: 'yes' } } };
  setupRev++;
  assert.deepEqual(mealFor(1, 'lunch'), { dish: 'Soup' }, 'markup in an emoji is dropped, the dish stays');
  assert.equal(verseFor(1).video, undefined);
  assert.equal(verseFor(2).video, undefined, 'plain http is not a video link');
  assert.equal(verseFor(3).video, 'https://youtu.be/abc');
  assert.deepEqual(cleanupTeams(1, 'Lunch'), CAMP.teamCount > 1 ? ['t0'] : [], 't8, a non-team and a non-true are not teams');
});

test('with a section on but empty, the day shows nothing — no fallback to the printed copy inside a section that is on', () => {
  secLoad(['schedule', 'meals', 'verses', 'cleanup', 'electives']);
  setupTree.meals = {}; setupTree.cleanup = {}; setupTree.verses = {}; setupTree.electives = {};
  normalizeSetup(setupTree);
  setupRev++;
  assert.equal(mealFor(1, 'lunch'), null);
  assert.deepEqual(cleanupTeams(1, 'Lunch'), []);
  assert.equal(cleanupOnRota(1), false);
  assert.equal(verseFor(1).text, '');
  assert.equal(verseTheme().text, '');
  assert.deepEqual(electivesFor(1), []);
  assert.equal(mealCleanupNote(1, 'Lunch'), '', 'an untracked day says nothing');
});

test('a section turned off again (kept data) reads as the original at once, and an unreadable schema never reaches the data', () => {
  secLoad();
  setupTree.meals = { mon: { lunch: { dish: 'Soup' } } };
  setupRev++;
  assert.equal(mealFor(1, 'lunch').dish, 'Soup');
  setupTree.meta.on.meals = false;
  setupRev++;
  assert.ok(mealFor(1, 'lunch') === ((MEALS[1] || {}).lunch || null), 'off: the constant');
  setupTree.meta.on.meals = true;
  setupTree.meta.schema = 2;
  setupRev++;
  assert.ok(mealFor(1, 'lunch') === ((MEALS[1] || {}).lunch || null), 'a newer schema: the constant');
});

// ── the meal tag ──

test('a meal item is a meal by its Meal tag once the schedule is edited here: its dish, its cleanup line', () => {
  secLoad();
  const dk = 'mon';
  const id = Object.keys(setupTree.typical).find((k) => /^supper/i.test(setupTree.typical[k].label));
  assert.ok(id, 'the camp has a supper item');
  setupTree.meals = { mon: { supper: { dish: 'Pot roast', emoji: '🍖' } } };
  setupTree.cleanup = { mon: { supper: { t2: true } } };
  setupTree.typical[id].label = 'Supper and free time';
  setupTree.typical[id].meal = 'supper';
  setupRev++;
  const raw = scheduleForDow(1).find((b) => b.label === 'Supper and free time');
  assert.ok(raw);
  assert.equal(blockMeal(raw), 'Supper');
  assert.equal(mealInfo(1, raw).dish, 'Pot roast', 'a tagged item shows its dish (the label alone never matched)');
  assert.equal(decorateMealBlock(1, raw).label, 'Supper and free time — Pot roast');
  assert.ok(mealCleanupNote(1, raw.label, blockMeal(raw)).includes(esc(teamName('t2'))), 'and its cleanup team');
  // Untag it: plain label, no dish, no cleanup line.
  delete setupTree.typical[id].meal;
  setupRev++;
  const plain = scheduleForDow(1).find((b) => b.label === 'Supper and free time');
  assert.equal(blockMeal(plain), null);
  assert.equal(mealInfo(1, plain), null);
  assert.equal(decorateMealBlock(1, plain), plain);
  assert.equal(mealCleanupNote(1, plain.label, blockMeal(plain)), '');
  assert.ok(dk);
});

test('built in, a meal is still read off its label — the printed week is unchanged', () => {
  secOff();
  const lunch = scheduleForDow(1).find((b) => b.label === 'Lunch');
  assert.ok(lunch);
  assert.equal(blockMeal(lunch), 'Lunch');
  assert.equal(blockMeal({ label: "Supper — Shepherd's Pie" }), 'Supper');
  assert.equal(blockMeal({ label: 'Free time' }), null);
  assert.equal(mealInfo(1, lunch), mealFor(1, 'lunch'));
});

test('the meal start and the elective slot start follow the schedule once it is edited here', () => {
  secLoad();
  const lunch = Object.keys(setupTree.typical).find((k) => setupTree.typical[k].meal === 'lunch');
  assert.ok(lunch);
  setupTree.typical[lunch].start = 12 * 60 + 30;
  setupTree.typical[lunch].end = 13 * 60 + 15;
  setupRev++;
  assert.equal(mealStart(2, 'Lunch'), 12 * 60 + 30);
  assert.equal(mealStart(2, 'Supper') >= 0, true);
  if (SEC_JR) {
    const el = Object.keys(setupTree.typical).find((k) => setupTree.typical[k].type === 'elective' && setupTree.typical[k].slot === 1);
    setupTree.typical[el].start = 15 * 60 + 10;
    setupTree.typical[el].end = 15 * 60 + 55;
    setupRev++;
    assert.equal(electiveSlotStart(1, 3), 15 * 60 + 10, 'a moved Elective 2 moves the time everyone sees');
    assert.equal(electiveSlotStart(0, 3), ELECTIVE_SLOT_MIN[0]);
  }
});

// ── fill evenly, and the fairness line ──

const secSlots = (days, meals, want) => [].concat(...days.map((day) => meals.map((meal) => ({ day, meal, want: (want && want[day]) || 1, have: [] }))));
const secWeek = ['mon', 'tue', 'wed', 'thu', 'fri'];
const secMeals = ['breakfast', 'lunch', 'supper'];

function secCheckRota(res, teams) {
  const spread = Object.keys(res.counts).map((t) => res.counts[t]);
  assert.ok(Math.max.apply(null, spread) - Math.min.apply(null, spread) <= 1, 'every team within one of every other: ' + JSON.stringify(res.counts));
  secWeek.forEach((day) => {
    const used = [].concat(...res.slots.filter((s) => s.day === day).map((s) => s.teams));
    assert.equal(new Set(used).size, used.length, 'no team twice on ' + day);
  });
  secMeals.forEach((meal) => secWeek.slice(1).forEach((day, i) => {
    const a = res.slots.find((s) => s.day === secWeek[i] && s.meal === meal);
    const b = res.slots.find((s) => s.day === day && s.meal === meal);
    if (a && b) assert.ok(!b.teams.some((t) => a.teams.includes(t)), 'no team on ' + meal + ' two days running (' + secWeek[i] + '/' + day + ')');
  }));
  assert.ok(teams.length);
}

test('fill evenly (junior-sized): 6 teams, 15 meals — equal counts within one, no team twice in a day, none on one meal two days running', () => {
  const teams = ['t0', 't1', 't2', 't3', 't4', 't5'];
  const res = rotaFillEvenly({ teams, slots: secSlots(secWeek, secMeals) });
  assert.equal(res.slots.length, 15);
  assert.ok(res.slots.every((s) => s.teams.length === 1));
  assert.deepEqual(res.relaxed, []);
  secCheckRota(res, teams);
  assert.equal(JSON.stringify(rotaFillEvenly({ teams, slots: secSlots(secWeek, secMeals) })), JSON.stringify(res), 'deterministic');
});

test('fill evenly with a Friday of pairs gives every team exactly three, and with senior\'s four teams × two meals stays within one', () => {
  const six = ['t0', 't1', 't2', 't3', 't4', 't5'];
  const pairs = rotaFillEvenly({ teams: six, slots: secSlots(secWeek, secMeals, { fri: 2 }) });
  secCheckRota(pairs, six);
  assert.deepEqual(six.map((t) => pairs.counts[t]), [3, 3, 3, 3, 3, 3]);
  const four = ['t0', 't1', 't2', 't3'];
  const sen = rotaFillEvenly({ teams: four, slots: secSlots(secWeek, ['breakfast', 'lunch']) });
  secCheckRota(sen, four);
  assert.equal(sen.slots.length, 10);
});

test('fill evenly keeps what is already there, fills only the empty meals, and Redo starts over', () => {
  const teams = ['t0', 't1', 't2', 't3', 't4', 't5'];
  const slots = secSlots(secWeek, secMeals);
  slots[0].have = ['t5'];            // mon breakfast
  slots[1].have = ['t4', 't3'];      // mon lunch holds two (kept as it is, its own `want` aside)
  const kept = rotaFillEvenly({ teams, slots });
  assert.deepEqual(kept.slots[0].teams, ['t5']);
  assert.deepEqual(kept.slots[1].teams, ['t4', 't3']);
  assert.ok(kept.slots.slice(2).every((s) => s.teams.length === 1));
  const redo = rotaFillEvenly({ teams, slots, redo: true });
  assert.ok(redo.slots.every((s) => s.teams.length === 1), 'Redo ignores what was there');
  secCheckRota(redo, teams);
  // An unknown team in `have` is never kept.
  assert.deepEqual(rotaFillEvenly({ teams, slots: [{ day: 'mon', meal: 'lunch', want: 1, have: ['t9'] }] }).slots[0].teams.length, 1);
});

test('fill evenly relaxes a rule it cannot keep for a slot, says which, and still fills it', () => {
  const res = rotaFillEvenly({ teams: ['t0'], slots: secSlots(['mon', 'tue', 'wed'], ['lunch']) });
  assert.ok(res.slots.every((s) => s.teams.length === 1));
  assert.deepEqual(res.relaxed, ['tue lunch', 'wed lunch'], 'one team cannot avoid the same meal two days running: said, and still filled');
  assert.deepEqual(rotaFillEvenly({ teams: ['t0', 't1'], slots: secSlots(['mon', 'tue', 'wed'], ['lunch']) }).relaxed, [], 'two teams alternate');
  const tooMany = rotaFillEvenly({ teams: ['t0'], slots: [{ day: 'mon', meal: 'lunch', want: 3, have: [] }] });
  assert.deepEqual(tooMany.slots[0].teams, ['t0'], 'fewer teams than the meal wants: it takes what there is');
});

test('the fairness line says how many times each team cleans, and who cleans twice in a day', () => {
  const name = (t) => ({ t0: 'Foxes', t1: 'Turkey', t2: 'Maples' }[t] || t);
  const day = (d) => ({ mon: 'Monday', thu: 'Thursday' }[d] || d);
  const even = rotaFairness([{ day: 'mon', teams: ['t0'] }, { day: 'mon', teams: ['t1'] }, { day: 'thu', teams: ['t2'] }], ['t0', 't1', 't2'], name, day);
  assert.equal(even.line, 'Each team cleans 1 time.');
  assert.deepEqual(even.notes, []);
  const uneven = rotaFairness([{ day: 'thu', teams: ['t2'] }, { day: 'thu', teams: ['t2', 't0'] }, { day: 'mon', teams: ['t0'] }], ['t0', 't1', 't2'], name, day);
  assert.equal(uneven.line, 'Each team cleans 0–2 times.');
  assert.ok(uneven.notes.includes('Turkey isn’t on the rota yet.'));
  assert.ok(uneven.notes.includes('Maples clean twice on Thursday.'));
  assert.equal(rotaFairness([], ['t0'], name, day).line, 'Nobody is on the rota yet.');
});

// ── an elective person's identity ──

function secElectiveTree() {
  const t = secLoad(['schedule', 'electives']);
  t.electives = {
    stations: { 'st-swim': { name: 'Swim', emoji: '🏊' }, 'st-crafts': { name: 'Crafts', emoji: '🎨' } },
    slots: { mon: { s0: {
      'st-swim': { ord: 10, people: { 'alyssa@x,com': { name: 'Alyssa', ord: 10 }, 'n-sofie': { name: 'Sofie', ord: 20 } } },
      'st-crafts': { ord: 20, people: { 'other@x,com': { name: 'Alyssa', ord: 10 }, 'n-zac': { name: 'Zac', ord: 20 } } },
    } } },
  };
  setupRev++;
  return t;
}

test('an elective person is matched by member key first, then by name through the merged spellings', () => {
  secElectiveTree();
  const dir = memberDirectory;
  authUser = { email: 'alyssa@x.com', emailVerified: true };
  state.identity = 'Zoe';            // an identity that matches no name at all
  const swim = electivesFor(1)[0].find((r) => r[0] === 'Swim');
  const crafts = electivesFor(1)[0].find((r) => r[0] === 'Crafts');
  assert.deepEqual(swim[2], ['alyssa@x,com', ''], 'the legacy rows carry a third list: the member key of each name');
  assert.equal(electiveRowHasMe(swim), true, 'my own sign-in is the key on the Swim row — whatever name I picked');
  assert.equal(electiveRowHasMe(crafts), false, 'another Alyssa (another key) is not me, though the names agree');
  assert.equal(myStationFor(1, 0).station, 'Swim');
  authUser = null;
  state.identity = 'Sofie';          // an old spelling on this phone…
  assert.equal(electiveRowHasMe(swim), true, '…matches the typed Sofie by name');
  state.identity = 'Sofia';
  assert.equal(electiveIsMe('Sofie', ''), true, 'Sofia and Sofie are one person (S0k)');
  assert.equal(electiveIsMe('Sofia', ''), true);
  state.identity = 'Lilly';
  assert.equal(electiveIsMe('Lily', ''), true, 'Lilly and Lily too');
  state.identity = null;
  assert.equal(electiveIsMe('Zac', ''), false, 'no identity, nobody is me');
  assert.equal(myStationFor(1, 0), null);
  authUser = null; memberDirectory = dir;
});

test('a station name an elective person was typed under is a name the device can take as its identity', () => {
  secElectiveTree();
  assert.equal(electiveKnowsName('Zac'), true);
  assert.equal(electiveKnowsName('Nobody'), false);
  secOff();
  assert.equal(electiveKnowsName('Zac'), false, 'built in, only the printed roster counts');
  secElectiveTree();
  memberTeamId = 't0'; memberName = 'Zac';
  const was = state.identity;
  state.identity = undefined;
  adoptMemberTeam();
  assert.equal(state.identity, 'Zac', 'a counselor on an elective list is adopted, though no printed sheet names them');
  state.identity = was; memberTeamId = null; memberName = null;
  assert.ok(staffNames().includes('Zac') && staffNames().includes('Swim') === false, 'the mention dictionary gains the people on the stations');
});

test('"nearly the same name": Sophie ≈ Sofia, Zac ≈ Zack, but never Sofia/Sofie (one spelling now), nor two different names', () => {
  assert.equal(setupNamesNear('Sophie', 'Sofia'), true);
  assert.equal(setupNamesNear('Zac', 'Zack'), true);
  assert.equal(setupNamesNear('Josh', 'Joshua'), true);
  assert.equal(setupNamesNear('Sofie', 'Sofia'), false, 'the merged spellings are equal, not near');
  assert.equal(setupNamesNear('Lilly', 'Lily'), false);
  assert.equal(setupNamesNear('Cam', 'Kim'), false);
  assert.equal(setupNamesNear('Sam', 'Sam'), false);
  const members = [{ key: 'sofia@x,com', name: 'Sofia Reed' }, { key: 'zac@x,com', name: 'Zac' }];
  assert.equal(setupNearMember('Sophie', members).key, 'sofia@x,com', 'against a first name');
  assert.equal(setupNearMember('Zac', members), null, 'an exact name is no problem: counselors are found by name already');
  assert.equal(setupNearMember('Maya', members), null);
});

// ── the mutators ──

const secOps = (r) => r.ops;

test('every mutator is refused while its section is off, with nothing written', () => {
  secLoad(['schedule']);
  setupTree.meals = { mon: { lunch: { dish: 'Soup' } } };                                       // data a section holds while it is off
  setupTree.electives = { stations: { 'st-a': { name: 'A' } }, slots: { mon: { s0: { 'st-a': { ord: 10 } } } } };
  setupRev++;
  [mealsSet('mon', 'lunch', 'Stew', ''), versesSetDay('mon', { text: 'Words' }), versesSetTheme({ text: 'Words' }), cleanupSet('mon', 'lunch', ['t0']),
    electiveStationAdd('Archery', '🏹'), mealsCopyDay('mon', 'tue'), electiveCopyDay('mon', 'tue')].forEach((r) => {
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'off');
  });
});

test('meals: one dish at a time, an empty dish removes the menu line, markup in an emoji is dropped, copy a day', () => {
  secLoad();
  let r = mealsSet('wed', 'lunch', '  Tacos  ', '🌮');
  assert.equal(r.ok, true);
  secEq(secOps(r), { 'meals/wed/lunch': { dish: 'Tacos', emoji: '🌮' } });
  assert.deepEqual(mealFor(3, 'lunch'), { dish: 'Tacos', emoji: '🌮' });
  r = mealsSet('wed', 'lunch', 'x'.repeat(120), '<img src=x onerror=alert(1)>');
  assert.equal(secOps(r)['meals/wed/lunch'].dish.length, 80, 'cut to what the rules take');
  assert.equal(secOps(r)['meals/wed/lunch'].emoji, undefined, 'markup is no emoji');
  assert.equal(mealsSet('wed', 'lunch', 'x'.repeat(80), '').noop, true, 'an unchanged value writes nothing (the dish is already that, minus the emoji): a bare blur');
  r = mealsSet('wed', 'lunch', '   ', '🌮');
  assert.equal(secOps(r)['meals/wed/lunch'], null, 'no dish: the record goes (an emoji alone is not a menu)');
  assert.equal(mealsSet('xyz', 'lunch', 'a', '').ok, false);
  assert.equal(mealsSet('wed', 'elevenses', 'a', '').ok, false);
  setupTree.meals = { mon: { breakfast: { dish: 'Eggs' }, lunch: { dish: 'Wraps' } }, tue: { supper: { dish: 'Stew' } } };
  setupRev++;
  r = mealsCopyDay('mon', 'tue');
  assert.deepEqual(Object.keys(setupTree.meals.tue).sort(), ['breakfast', 'lunch'], 'the target\'s own dishes are replaced');
  assert.equal(mealsCopyDay('mon', 'mon').ok, false);
});

test('verses: words are required, a video must be https, no words at all removes the verse; each commit is one record', () => {
  secLoad();
  assert.equal(versesSetTheme({ text: '', ref: 'John 3:16' }).reason, 'text');
  assert.equal(versesSetDay('tue', { text: 'Words', video: 'http://x.example/v' }).reason, 'video');
  assert.equal(versesSetDay('tue', { text: 'Words', video: 'javascript:alert(1)' }).reason, 'video');
  let r = versesSetDay('tue', { text: 'Be kind', ref: 'Eph 4:32', video: 'https://youtu.be/xyz' });
  secEq(secOps(r), { 'verses/days/tue': { text: 'Be kind', ref: 'Eph 4:32', video: 'https://youtu.be/xyz' } });
  assert.equal(verseFor(2).video, 'https://youtu.be/xyz');
  r = versesSetDay('tue', { text: 'Be kind', ref: 'Eph 4:32', video: '' });
  secEq(secOps(r), { 'verses/days/tue': { text: 'Be kind', ref: 'Eph 4:32' } }, 'clearing the link keeps the verse');
  r = versesSetDay('tue', { text: '', ref: '', video: '' });
  assert.equal(secOps(r)['verses/days/tue'], null);
  r = versesSetTheme({ title: 'Seeds', text: 'A theme '.repeat(100), ref: 'Gal 2:20' });
  assert.equal(secOps(r)['verses/theme'].text.length, 600);
  assert.equal(secOps(r)['verses/theme'].title, 'Seeds');
});

test('cleanup: a meal\'s teams are replaced as a set; only the camp\'s own teams count; nobody removes the meal', () => {
  secLoad();
  let r = cleanupSet('wed', 'lunch', ['t1', 't0', 't9', 'junk']);
  assert.equal(r.ok, true);
  const ops = secOps(r);
  assert.ok(!JSON.stringify(ops).match(/t9|junk/), 'only the camp\'s own teams are written: ' + JSON.stringify(ops));
  assert.deepEqual(cleanupTeams(3, 'Lunch'), ['t0', 't1'], 'in slot order');
  r = cleanupSet('wed', 'lunch', []);
  assert.deepEqual(cleanupTeams(3, 'Lunch'), []);
  assert.equal(cleanupSet('wed', 'brunch', ['t0']).ok, false);
  const fill = cleanupApply([{ day: 'mon', meal: 'breakfast', teams: ['t2'] }, { day: 'tue', meal: 'lunch', teams: ['t1', 't0'] }], 'Filled evenly');
  assert.equal(fill.ok, true);
  assert.deepEqual(cleanupTeams(1, 'Breakfast'), ['t2']);
  assert.deepEqual(cleanupTeams(2, 'Lunch'), ['t0', 't1']);
  assert.equal(undoRecent().filter((e) => e.label === 'Filled evenly').length, 1, 'a fill is ONE undo entry');
});

test('electives: stations, slots and people — one commit each, removing a station takes it off every slot, a double tap adds nobody twice', () => {
  secElectiveTree();
  let r = electiveStationAdd('  Archery  ', '🏹');
  assert.equal(r.ok, true);
  assert.equal(r.id, 'st-archery');
  secEq(secOps(r), { 'electives/stations/st-archery': { name: 'Archery', emoji: '🏹' } });
  assert.equal(electiveStationAdd('Archery', '').id, 'st-archery-2', 'a taken id gets a number');
  assert.equal(electiveStationAdd('   ', '').reason, 'name');
  r = electiveSlotAddStation('tue', 1, 'st-archery');
  assert.equal(r.ok, true);
  assert.equal(setupElectiveRows(setupTree, 'tue', 1)[0].name, 'Archery');
  assert.equal(electiveSlotAddStation('tue', 1, 'st-archery').reason, 'cancelled', 'already there: nothing to write');
  r = electivePersonAdd('tue', 1, 'st-archery', { name: ' Maya ' });
  assert.equal(r.ok, true);
  assert.ok(secOps(r)['electives/slots/tue/s1/st-archery/people/n-maya'] || secOps(r)['electives/slots/tue/s1/st-archery'], JSON.stringify(secOps(r)));
  assert.equal(electivePersonAdd('tue', 1, 'st-archery', { name: 'maya' }).reason, 'cancelled', 'the same name twice at one station is a double tap');
  r = electivePersonAdd('tue', 1, 'st-archery', { key: 'maya@x,com', name: 'Maya Fox' });
  assert.equal(r.ok, true, 'a member with the same first name is a different person');
  assert.deepEqual(setupElectiveRows(setupTree, 'tue', 1)[0].people.map((p) => p.name), ['Maya', 'Maya Fox']);
  // Removing a station removes it from the list AND every slot that holds it, in one undo entry.
  r = electiveStationRemove('st-archery');
  assert.equal(r.ok, true);
  assert.equal(setupElectiveRows(setupTree, 'tue', 1).length, 0);
  assert.ok(!setupTree.electives.stations['st-archery']);
  assert.equal(undoRecent().filter((e) => /Removed the Archery station/.test(e.label)).length, 1);
  // A person off a station; the station still stands.
  r = electivePersonRemove('mon', 0, 'st-crafts', 'n-zac');
  assert.equal(r.ok, true);
  assert.deepEqual(setupElectiveRows(setupTree, 'mon', 0).find((x) => x.id === 'st-crafts').people.map((p) => p.pid), ['other@x,com']);
  // A colleague removed the station while I was choosing: refused in words' terms (removed), nothing written.
  delete setupTree.electives.stations['st-swim'];
  assert.equal(electiveSlotAddStation('wed', 0, 'st-swim').reason, 'removed');
});

test('electives: same as Monday copies the three slots; linking a typed name re-keys it everywhere it stands', () => {
  secElectiveTree();
  let r = electiveCopyDay('mon', 'wed');
  assert.equal(r.ok, true);
  assert.deepEqual(setupElectiveRows(setupTree, 'wed', 0).map((x) => x.name), ['Swim', 'Crafts']);
  assert.equal(electiveCopyDay('mon', 'mon').ok, false);
  setupTree.electives.slots.tue = { s2: { 'st-swim': { ord: 10, people: { 'n-sofie': { name: 'Sofie', ord: 5 } } } } };
  setupRev++;
  r = electiveLinkPerson('n-sofie', { key: 'sofia@x,com', name: 'Sofia' });
  assert.equal(r.ok, true);
  ['mon/s0/st-swim', 'wed/s0/st-swim', 'tue/s2/st-swim'].forEach((p) => {
    const [dk, sl, st] = p.split('/');
    const ppl = setupTree.electives.slots[dk][sl][st].people;
    assert.ok(ppl['sofia@x,com'] && !ppl['n-sofie'], p);
    assert.equal(ppl['sofia@x,com'].name, 'Sofia');
  });
  assert.equal(setupTree.electives.slots.tue.s2['st-swim'].people['sofia@x,com'].ord, 5, 'the order is kept');
  assert.equal(electiveLinkPerson('alyssa@x,com', { key: 'k', name: 'x' }).ok, false, 'only a typed name is linked');
});

test('a station or a person renamed in the member list reads with the new name (the directory leads, the typed name is the fallback)', () => {
  secElectiveTree();
  memberDirectory = { 'alyssa@x,com': { role: 'viewer', name: 'Alyssa Reed' } };
  const row = electivesFor(1)[0].find((x) => x[0] === 'Swim');
  assert.deepEqual(row[1], ['Alyssa Reed', 'Sofia'], 'the member by the directory\'s name; a typed Sofie in the one spelling');
  memberDirectory = null;
});

// ── Turn on (the owner's), against the in-memory database with the real engines past their first snapshot ──

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');
const SEC_ROOT = CAMP.dbRoot;
const SEC_OWNER = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
const SEC_JENN = { email: 'jenn@example.com', emailVerified: true };
const secWait = (ms) => new Promise((r) => setTimeout(r, ms || 5));

async function secBoot(opts) {
  const o = opts || {};
  freshState();
  authUser = o.user || SEC_OWNER;
  setMemberRole('editor');
  memberName = 'Patrick';
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick' }, 'jenn@example,com': { role: 'editor', name: 'Jenn Reed' } };
  memberDirectoryLoaded = true;
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  window.firebase = makeFakeFirebase(db);
  fbConnKnown = true; fbConnected = true;
  rpLastAt = 0; rpLastAutoAt = 0; rpWaitMs = 40; setupPushMs = 40;
  localStorage.removeItem(lsKey(RP_OUTBOX_KEY));
  localStorage.removeItem(lsKey(SETUP_KEY));
  setupRef = null; setupReady = false; setupDenied = false; setupWriteRefused = false;
  setupTree = normalizeSetup({}); setupBase = null; setupBaseAt = 0; setupBootBase = null; setupLast = null;
  setupPending = 0; clearTimeout(setupPushTimer); setupPushTimer = null; setupRefetchOwed = false;
  setupQuarantine = {}; setupClashes = []; setupEdited = {}; setupRev = 0;
  undoClear();
  delete state._cfgBase; delete state._cfgNotes;
  configReady = false; cfgFirstPending = null; remoteReady = false; syncDenied = false;
  db.serverSet(dbPath('state'), syncedSnapshot());
  db.serverSet(dbPath('config'), state.config);
  db.serverSet(dbPath('setup'), o.setup || buildSeed(CAMP));   // the schedule is already on: step 16 came first
  fbRef = db.ref(dbPath('state'));
  fbConfigRef = db.ref(dbPath('config'));
  setupRef = db.ref(dbPath('setup'));
  fbRef.on('value', (snap) => handleRemoteSnapshot(snap.val()));
  attachConfigListener();
  attachSetupListener();
  db.deliverFirstSnapshots();
  flushPendingPush();
  await secWait(40);
  assert.equal(remoteReady && configReady && setupReady, true, 'all three engines are past their first pull');
  return db;
}
function secDown() {
  delete window.FIREBASE_CONFIG;
  delete window.firebase;
  fbRef = null; fbConfigRef = null; setupRef = null;
  fbConnKnown = false; fbConnected = false;
  remoteReady = false; configReady = false; setupReady = false;
  rpWaitMs = RP_WAIT_MS; setupPushMs = SETUP_PUSH_MS;
  clearTimeout(setupPushTimer); setupPushTimer = null;
  clearTimeout(pushTimer); pushTimer = null;
  clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false;
  undoClear();
  setMemberRole(null);
  authUser = null; memberDirectory = null; memberDirectoryLoaded = false; memberName = null;
  setupTree = normalizeSetup({}); setupRev++;
  localStorage.removeItem(lsKey(RP_OUTBOX_KEY));
  localStorage.removeItem(lsKey(SETUP_KEY));
}
const secServer = (db) => db.serverGet(SEC_ROOT + '/setup') || {};
const secPoints = (db) => Object.values(db.serverGet(SEC_ROOT + '/restoreIndex') || {});
async function secLive(section, on) {
  for (let i = 0; i < 60 && sectionIsShared(section) !== on; i++) await secWait(10);
  assert.equal(sectionIsShared(section), on, section + ' ' + (on ? 'is' : 'is not') + ' edited here');
}
const SEC_QUIET = { campRunning: false };

test('Turn on: the owner switches the four sections on in ONE sitting — one restore point, one transaction, the schedule and the games untouched', async () => {
  const db = await secBoot();
  try {
    assert.equal(sectionIsShared('meals'), false, 'nothing is on until the owner presses it');
    const from = db.log.length;
    const sched = JSON.stringify(secServer(db).typical);
    const r = await setupTurnOn(['meals', 'verses', 'cleanup', 'electives'], SEC_QUIET);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.turnedOn, SEC_JR ? ['meals', 'verses', 'cleanup', 'electives'] : ['meals', 'verses', 'cleanup'], 'senior has no electives to turn on');
    await secLive('meals', true);
    const log = db.log.slice(from);
    assert.equal(secPoints(db).filter((x) => x.kind === 'pre-seed').length, 1, 'ONE restore point first');
    assert.equal(log.filter((l) => l.kind === 'transaction' && l.paths[0] === SEC_ROOT + '/setup').length, 1, 'ONE setup transaction');
    assert.equal(log.filter((l) => l.kind === 'transaction' && l.paths[0] === SEC_ROOT + '/config').length, 0, 'the games are not re-placed: only the schedule has games');
    const srv = secServer(db);
    assert.equal(JSON.stringify(srv.typical), sched, 'the schedule is not touched');
    assert.equal(srv.meta.on.meals && srv.meta.on.verses && srv.meta.on.cleanup, true);
    assert.equal(!!srv.meta.on.electives, SEC_JR);
    assert.equal(srv.meta.seeded.byKey, OWNER_MEMBER_KEY);
    if (SEC_JR) {
      assert.equal(srv.meals.mon.lunch.dish, 'Wraps');
      assert.equal(srv.cleanup.fri.supper.t2, true);
      assert.equal(srv.verses.days.thu.video, MEMORY_VERSES[4].video);
      assert.ok(srv.electives.slots.mon.s0['st-swimming']);
    }
    // What the camp reads is what it always did.
    assert.deepEqual(cleanupTeams(1, 'Supper'), [].concat(MEAL_CLEANUP_SCHEDULE[1] ? MEAL_CLEANUP_SCHEDULE[1].Supper : []));
    assert.deepEqual(verseTheme(), MEMORY_VERSE_THEME);
  } finally { secDown(); }
});

test('Turn on twice writes once; one section alone seeds only that section', async () => {
  const db = await secBoot();
  try {
    assert.equal((await setupTurnOn(['verses'], SEC_QUIET)).ok, true);
    await secLive('verses', true);
    assert.equal(sectionIsShared('meals'), false, 'the others are still the original');
    assert.equal(secServer(db).meals, undefined);
    const node = JSON.stringify(secServer(db));
    assert.equal((await setupTurnOn(['verses'], SEC_QUIET)).reason, 'already');
    assert.equal(JSON.stringify(secServer(db)), node, 'not a byte changed');
    assert.equal((await setupTurnOn(['nonsense'], SEC_QUIET)).reason, 'none');
  } finally { secDown(); }
});

test('Turn on is the owner\'s alone: another director or a counselor is refused before anything is written', async () => {
  const db = await secBoot({ user: SEC_JENN });
  try {
    const from = db.log.length;
    const r = await setupTurnOn(['meals'], SEC_QUIET);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'owner');
    assert.equal(r.message, 'Only Patrick can turn on editing.');
    setMemberRole('viewer');
    assert.equal((await setupTurnOn(['meals'], SEC_QUIET)).reason, 'owner');
    setMemberRole('editor');
    assert.equal(db.log.slice(from).length, 0, 'not even a restore point');
    assert.equal(sectionIsShared('meals'), false);
    // …and the other switch: a director cannot press Use the original week again for a section either.
    assert.equal(setupUseOriginal(['meals']).reason, 'owner');
  } finally { secDown(); }
});

test('Use the original again keeps the edits; turning on again brings them back and writes only the switch', async () => {
  const db = await secBoot();
  try {
    assert.equal((await setupTurnOn(['meals'], SEC_QUIET)).ok, true);
    await secLive('meals', true);
    const ms = mealsSet('wed', 'lunch', 'Leftover tacos', '🌮'); assert.equal(ms.ok, true, JSON.stringify(ms));
    await a1Settle();
    assert.equal(secServer(db).meals.wed.lunch.dish, 'Leftover tacos');
    const uo = setupUseOriginal(['meals']); assert.equal(uo.ok, true, JSON.stringify(uo));
    await secLive('meals', false);
    assert.ok(mealFor(3, 'lunch') === ((MEALS[3] || {}).lunch || null), 'everyone is back on the original menu');
    assert.equal(mealsSet('wed', 'lunch', 'Other', '').reason, 'off', 'nothing is edited into a section that is off');
    await a1Settle();
    assert.equal(secServer(db).meals.wed.lunch.dish, 'Leftover tacos', 'the edit is kept');
    const from = db.log.length;
    assert.equal((await setupTurnOn(['meals'], SEC_QUIET)).ok, true);
    await secLive('meals', true);
    assert.equal(mealFor(3, 'lunch').dish, 'Leftover tacos', 'the edit comes back');
    assert.equal(secPoints(db).filter((x) => x.kind === 'pre-seed').length, 1, 'no new restore point: nothing is seeded again');
    assert.ok(db.log.slice(from).every((l) => l.kind !== 'transaction' || l.paths[0] === SEC_ROOT + '/setup'));
  } finally { secDown(); }
});

async function a1Settle() {
  for (let i = 0; i < 80; i++) {
    if (pendingWritesTotal() === 0 && !hasUnconfirmedLocalWork() && !pushTimer && !pushConfigTimer && !setupPushTimer) return;
    await secWait(50);
  }
}
