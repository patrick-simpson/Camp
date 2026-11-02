// The seed and the schedule maths (setup-rebuild-spec §5.4–5.6, §10.2, §10.4; build step 15 / "S5a").
// Edit the week here (A1) turns the printed week in camps.js into DATA under <root>/setup, and from then on
// every schedule consumer reads it through the accessors. The promise this file holds the code to: the seeded
// week renders EXACTLY what the printed week rendered — every day, every minute of the week, both camps — so
// pressing the switch changes nothing anyone can see. Runs under the senior profile too
// (seed.senior.test.js evals this file).

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const SEED_DOWS = [0, 1, 2, 3, 4, 5, 6];
const seedClone = (v) => JSON.parse(JSON.stringify(v));

// What the database hands back after a write: pruned, key-sorted, arrays as maps and back — the round trip the
// seeded tree really takes before any device reads it.
function seedRoundTrip(tree) {
  const db = makeFakeRtdb();
  db.serverSet('setup', tree);
  return db.serverGet('setup');
}

// The seeded tree as a device holds it after the first setup snapshot.
function seedTreeOf(sections) {
  return normalizeSetup(seedRoundTrip(buildSeed(CAMP, sections)));
}

// Every block the seed writes, as { container, id } pairs in a stable order — the frozen fixtures' shape.
function seedIdTable(seed) {
  return {
    typical: Object.keys(seed.typical).map((id) => [id, seed.typical[id].alertKey]),
    patches: Object.keys(seed.patches).sort().reduce((o, dk) => { o[dk] = Object.keys(seed.patches[dk]); return o; }, {}),
    dayBlocks: Object.keys(seed.dayBlocks).sort().reduce((o, dk) => { o[dk] = Object.keys(seed.dayBlocks[dk]).map((id) => [id, seed.dayBlocks[dk][id].alertKey]); return o; }, {}),
  };
}

// ── pure helpers ─────────────────────────────────────────────────────

test('setupSlug and setupHeadLabel are the id and key rules, and agree with the alert keys', () => {
  assert.equal(setupSlug('Team competitions', 24), 'team-competitions');
  assert.equal(setupSlug("Rising bell, shower & morning meeting", 24), 'rising-bell-shower-morni', 'cut to 24, no dangling dash');
  assert.equal(setupSlug('  --Hi!!  ', 24), 'hi');
  assert.equal(setupSlug('“Hot Seat” & “Let’s Make a Deal!”', 24), 'hot-seat-let-s-make-a-de');
  assert.equal(setupSlug('🎉🎉', 24), 'block', 'nothing left of an all-emoji name');
  SEED_DOWS.forEach((d) => (DAY_SCHEDULE[d] || []).forEach((b) => {
    assert.equal(setupHeadLabel(b.label), pushHeadLabel(b.label), b.label);
    assert.equal(setupAlertKey(b.label), pushBlockKey(b.label), b.label);
  }));
});

test('a block id is minted from its head label and start, and a collision gets -2, -3', () => {
  const taken = {};
  assert.equal(setupMintId('', 'Team competitions', 600, taken), 'b-team-competitions-600');
  assert.equal(setupMintId('', 'Team competitions', 600, taken), 'b-team-competitions-600-2');
  assert.equal(setupMintId('', 'Team competitions', 600, taken), 'b-team-competitions-600-3');
  assert.equal(setupMintId('tue', "Boys cabin movie night", 1275, taken), 'b-tue-boys-cabin-movie-night-1275');
  assert.equal(setupMintId('', 'Snack and campfire — TJ', 1200, taken), 'b-snack-and-campfire-1200', 'the head label only: a tail never reaches the id');
});

test('renderLabel puts a block\'s team tail on its label, in slot order', () => {
  assert.equal(renderLabel({ label: 'Meeting', teams: { t0: true } }), 'Meeting — ' + teamEmoji('t0') + ' ' + teamShort('t0'));
  const two = renderLabel({ label: 'Meeting', teams: { t1: true, t0: true } });
  assert.equal(two, 'Meeting — ' + teamEmoji('t0') + ' ' + teamShort('t0') + ' & ' + teamEmoji('t1') + ' ' + teamShort('t1'));
  assert.equal(renderLabel({ label: 'Plain' }), 'Plain');
  assert.equal(renderLabel({ label: 'Plain', teams: {} }), 'Plain', 'an empty set is no set');
  assert.equal(renderLabel({ label: 'Plain', teams: { x9: true, t0: false } }), 'Plain', 'only real team ids that are true');
});

test('legacyBlock is the printed shape, field for field and in order', () => {
  const g = legacyBlock({ start: 600, end: 705, label: 'Team competitions', emoji: '🏅', type: 'games', ord: 50, alertKey: 'x', meal: 'lunch' });
  assert.equal(JSON.stringify(g), JSON.stringify({ start: 600, end: 705, label: 'Team competitions', emoji: '🏅', type: 'games' }));
  const e = legacyBlock({ start: 795, end: 840, label: 'Elective 1', emoji: '🌟', type: 'elective', slot: 0 });
  assert.equal(JSON.stringify(e), JSON.stringify({ start: 795, end: 840, label: 'Elective 1', emoji: '🌟', type: 'elective', slot: 0 }));
  const n = legacyBlock({ start: 1320, end: 1440, label: 'Lights out', emoji: '🛏️', type: 'activity', noTime: true });
  assert.equal(JSON.stringify(n), JSON.stringify({ start: 1320, end: 1440, label: 'Lights out', emoji: '🛏️', type: 'activity', noTime: true }));
  assert.equal(legacyBlock({ start: 1, end: 2, label: 'x', emoji: '🙂', type: 'mystery' }).type, 'activity', 'an unknown type reads as an activity');
  assert.equal(legacyBlock({ start: 1, end: 2, label: 'x', emoji: '<>&"', type: 'activity' }).emoji, '🕒', 'nothing but markup reads as the clock');
  assert.equal(legacyBlock({ start: 1, end: 2, label: 'x', emoji: '<b>🙂', type: 'activity' }).emoji, 'b🙂', 'markup characters are removed (safeEmoji), never rendered');
  assert.equal(legacyBlock({ start: 1, end: 2, label: 'x', type: 'activity' }).emoji, '🕒', 'a block with no emoji reads as the clock');
  assert.equal('slot' in legacyBlock({ start: 1, end: 2, label: 'x', emoji: '🙂', type: 'activity', slot: 7 }), false, 'a slot outside 0-2 is dropped');
});

test('validBlock wants whole minutes in range, end after start, and a label', () => {
  const ok = { start: 600, end: 660, label: 'x' };
  assert.ok(validBlock(ok));
  assert.ok(validBlock({ start: 0, end: 1440, label: 'x' }), 'until the end of the day');
  [{ start: 600.5 }, { end: 600 }, { end: 1441 }, { start: -1 }, { start: 1440, end: 1440 }, { label: '' }, { label: 5 }, { start: '600' }].forEach((patch) => {
    assert.equal(validBlock(Object.assign({}, ok, patch)), false, JSON.stringify(patch));
  });
  assert.equal(validBlock(null), false);
  assert.equal(validBlock([]), false);
});

// ── resolveDay ───────────────────────────────────────────────────────

function resolveTree() {
  return normalizeSetup({
    days: { mon: { typical: true }, tue: { typical: true }, wed: { typical: false }, sun: { typical: false } },
    typical: {
      'b-swim-900': { start: 900, end: 960, label: 'Swim', emoji: '🏊', type: 'activity', ord: 20, alertKey: 'swim' },
      'b-lunch-720': { start: 720, end: 780, label: 'Lunch', emoji: '🥪', type: 'activity', ord: 10, meal: 'lunch', alertKey: 'lunch' },
      'b-meet-450': { start: 450, end: 480, label: 'Meeting', emoji: '⏰', type: 'activity', ord: 0, teams: { t1: true } },
    },
    patches: {
      tue: { 'b-swim-900': { label: 'Swim — Cam', start: 930 }, 'b-lunch-720': { off: true }, 'b-meet-450': { teams: { t0: true } }, 'b-gone-1': { label: 'orphan' } },
      mon: { 'b-swim-900': { label: 'Swim' } },
    },
    dayBlocks: {
      tue: { 'b-tue-movie-1275': { start: 1275, end: 1320, label: 'Movie night', emoji: '🎬', type: 'activity', ord: 5, overlapOk: true }, 'b-tue-half-1': { start: 5 } },
      wed: { 'b-wed-trip-600': { start: 600, end: 700, label: 'Trip', emoji: '🚌', type: 'activity' }, 'b-wed-off-700': { start: 700, end: 760, label: 'Gone', type: 'activity', off: true } },
    },
  });
}

test('resolveDay: a typical day takes its patches, drops what is off, adds the day\'s one-offs, and sorts by (start, ord, id)', () => {
  const t = resolveTree();
  const mon = resolveDay(t, 1);
  assert.deepEqual(mon.map((b) => b.id), ['b-meet-450', 'b-lunch-720', 'b-swim-900']);
  assert.deepEqual(mon.map((b) => b.origin), ['typical', 'typical', 'typical'], 'a patch equal to the typical value is not "changed"');
  const tue = resolveDay(t, 2);
  assert.deepEqual(tue.map((b) => b.id), ['b-meet-450', 'b-swim-900', 'b-tue-movie-1275']);
  assert.equal(tue.find((b) => b.id === 'b-swim-900').label, 'Swim — Cam');
  assert.equal(tue.find((b) => b.id === 'b-swim-900').start, 930, 'a patch field replaces the typical field whole');
  assert.equal(tue.find((b) => b.id === 'b-swim-900').origin, 'changed');
  assert.equal(tue.find((b) => b.id === 'b-tue-movie-1275').origin, 'oneoff');
  assert.deepEqual(tue.skipped.map((b) => [b.id, b.origin]), [['b-lunch-720', 'skipped']], 'cancelled for the day, and listed so it can be brought back');
  assert.equal(tue.broken.length, 1, 'a partial one-off lands in the broken list, never in the day');
  assert.equal(tue.broken[0].id, 'b-tue-half-1');
  assert.deepEqual(legacyBlock(tue[0]).label, 'Meeting — ' + teamEmoji('t0') + ' ' + teamShort('t0'), 'the team group patch');
});

test('resolveDay: an own day shows only its own blocks, a skipped one-off is listed, an unknown day is empty', () => {
  const t = resolveTree();
  const wed = resolveDay(t, 3);
  assert.deepEqual(wed.map((b) => [b.id, b.origin]), [['b-wed-trip-600', 'own']], 'typical blocks never reach an own day');
  assert.deepEqual(wed.skipped.map((b) => b.id), ['b-wed-off-700']);
  assert.deepEqual(resolveDay(t, 6), [], 'a day with no record and no blocks');
  assert.deepEqual(resolveDay(null, 2), []);
  assert.deepEqual(resolveDay({}, 0), []);
});

test('resolveDay: ties on start are broken by ord, then by id, so every device agrees', () => {
  const t = normalizeSetup({
    days: { mon: { typical: true } },
    typical: {
      'b-b-600': { start: 600, end: 660, label: 'B', type: 'activity', ord: 10 },
      'b-a-600': { start: 600, end: 660, label: 'A', type: 'activity', ord: 10 },
      'b-c-600': { start: 600, end: 660, label: 'C', type: 'activity', ord: 5 },
    },
  });
  assert.deepEqual(resolveDay(t, 1).map((b) => b.id), ['b-c-600', 'b-a-600', 'b-b-600']);
});

test('the plans are the same objects until the tree changes, and a block knows its rich twin', () => {
  setupTree = seedTreeOf();
  setupRev++;
  const a = setupLivePlans();
  assert.ok(setupLivePlans() === a, 'memoized');
  assert.ok(setupLegacyDay(2) === a.legacy[2]);
  const first = a.legacy[1][0];
  const rich = setupRichOf(first);
  assert.ok(rich && rich.start === first.start && rich.id.startsWith('b-'), 'a legacy block maps back to its rich block');
  assert.equal(setupRichOf({ start: 1, end: 2, label: 'x' }), null, 'a copy is not an accessor block');
  assert.equal(setupRichOf(null), null);
  setupRev++;
  assert.ok(setupLivePlans() !== a, 'a new revision rebuilds');
  const swapped = seedTreeOf(); setupTree = swapped; // a whole new tree at the SAME revision still rebuilds
  assert.ok(setupLivePlans().tree === swapped);
  setupTree = normalizeSetup({}); setupRev++;
});

// ── the seed ─────────────────────────────────────────────────────────

test('buildSeed is deterministic, pure, and knows only the sections this build can seed', () => {
  const a = buildSeed(CAMP);
  const b = buildSeed(CAMP, ['schedule']);
  assert.deepEqual(a, b);
  assert.deepEqual(buildSeed(CAMP), seedClone(buildSeed(CAMP)), 'plain data');
  assert.ok(!('seeded' in a.meta), 'meta.seeded is added by mergeSeed, at write time');
  assert.deepEqual(a.meta, { schema: 1, on: { schedule: true } });
  assert.deepEqual(buildSeed(CAMP, ['meals', 'verses', 'cleanup', 'electives']), { meta: { schema: 1, on: {} } }, 'the other sections are not built yet');
  // Never the directory or the device's state.
  const before = JSON.stringify(buildSeed(CAMP));
  const dir = memberDirectory; const role = memberRole;
  memberDirectory = { 'x@y,z': { role: 'editor', name: 'Somebody' } };
  state.teams.forEach((t) => { t.name = 'Renamed'; });
  assert.equal(JSON.stringify(buildSeed(CAMP)), before);
  memberDirectory = dir; memberRole = role;
});

test('the seed has the measured shape (§10.2): typical day, patches, one-offs, one team group, placeholders', () => {
  const s = buildSeed(CAMP);
  assert.deepEqual(Object.keys(s.days), SETUP_DK, 'all seven days, in order');
  const count = (m) => Object.keys(m || {}).sort().map((k) => k + ':' + Object.keys(m[k]).length).join(' ');
  const withTeams = [];
  Object.keys(s.typical).forEach((id) => { if (s.typical[id].teams) withTeams.push(s.typical[id].label); });
  if (CAMP.id === 'junior') {
    assert.equal(Object.keys(s.typical).length, 26);
    assert.equal(count(s.patches), 'fri:8 thu:2 tue:2 wed:1');
    assert.equal(count(s.dayBlocks), 'fri:10 sat:5 sun:9 thu:1 tue:1');
    assert.deepEqual(withTeams, ["Rising bell, shower & morning meeting (Laura's cottage)"], 'the morning meeting is the only block that converts to teams');
    assert.deepEqual(s.patches.tue['b-rising-bell-shower-morni-450'], { teams: { t0: true, t3: true, t4: true } }, 'group B days patch the team group');
    assert.deepEqual(s.patches.thu['b-rising-bell-shower-morni-450'], { teams: { t0: true, t3: true, t4: true } });
    assert.equal(s.patches.wed['b-snack-and-campfire-1200'].label, 'Snack and campfire — Sofia', 'a campfire leader is a label patch');
    assert.ok(Object.keys(s.patches.fri).every((k) => s.patches.fri[k].off === true), 'junior Friday is eight cancelled items plus ten of its own');
    assert.equal(s.days.fri.typical, true);
    assert.equal(s.days.sat.typical, false);
    assert.ok(!SEED_DOWS.some((d) => s.days[SETUP_DK[d]].placeholder), 'junior has no placeholder days');
    assert.ok(JSON.stringify(s).length < 12000, 'about 9.4 KB');
  } else {
    assert.equal(Object.keys(s.typical).length, 20);
    assert.deepEqual(s.patches, {}, 'senior Tuesday to Friday are the typical day exactly');
    assert.equal(count(s.dayBlocks), 'sat:4 sun:2');
    assert.deepEqual(withTeams, []);
    assert.equal(s.days.sun.placeholder, true, 'the stub bookends are marked');
    assert.equal(s.days.sat.placeholder, true);
    assert.ok(!s.days.mon.placeholder && !s.days.fri.placeholder);
    assert.ok(JSON.stringify(s).length < 6000, 'about 4.5 KB');
  }
  assert.equal(s.typical[Object.keys(s.typical)[5]].ord, 50, 'typical blocks are 10 apart');
  SETUP_DK.forEach((dk, d) => assert.equal(s.days[dk].tag, SCHED_DAYS[d].tag, dk + ' keeps its tag'));
});

test('every seeded record is one the published rules accept', () => {
  const s = buildSeed(CAMP);
  const check = (id, b, where) => {
    assert.ok(/^b-[a-z0-9-]{1,36}$/.test(id), where + ' id ' + id);
    assert.ok(Number.isInteger(b.start) && b.start >= 0 && b.start <= 1439, where + ' start');
    assert.ok(Number.isInteger(b.end) && b.end >= 1 && b.end <= 1440 && b.end > b.start, where + ' end');
    assert.ok(typeof b.label === 'string' && b.label.length >= 1 && b.label.length <= 120, where + ' label');
    assert.ok(typeof b.emoji === 'string' && b.emoji.length >= 1 && b.emoji.length <= 16 && !/[<>&"]/.test(b.emoji), where + ' emoji');
    assert.ok(['activity', 'games', 'elective'].indexOf(b.type) !== -1, where + ' type');
    if (b.slot !== undefined) assert.ok([0, 1, 2].indexOf(b.slot) !== -1, where + ' slot');
    if (b.noTime !== undefined) assert.equal(b.noTime, true);
    if (b.meal !== undefined) assert.ok(['breakfast', 'lunch', 'supper'].indexOf(b.meal) !== -1, where + ' meal');
    assert.equal(typeof b.ord, 'number', where + ' ord');
    assert.ok(/^[a-z0-9-]{1,48}$/.test(b.alertKey), where + ' alertKey');
    if (b.teams) Object.keys(b.teams).forEach((t) => assert.ok(/^t[0-9]$/.test(t) && b.teams[t] === true, where + ' teams'));
    const allowed = ['start', 'end', 'label', 'emoji', 'type', 'slot', 'noTime', 'meal', 'ord', 'alertKey', 'teams'];
    Object.keys(b).forEach((k) => assert.ok(allowed.indexOf(k) !== -1, where + ' has an unexpected field ' + k));
  };
  Object.keys(s.typical).forEach((id) => check(id, s.typical[id], 'typical'));
  Object.keys(s.dayBlocks).forEach((dk) => Object.keys(s.dayBlocks[dk]).forEach((id) => check(id, s.dayBlocks[dk][id], dk)));
  Object.keys(s.days).forEach((dk) => {
    assert.equal(typeof s.days[dk].typical, 'boolean');
    if (s.days[dk].tag !== undefined) assert.ok(typeof s.days[dk].tag === 'string' && s.days[dk].tag.length <= 60);
    Object.keys(s.days[dk]).forEach((k) => assert.ok(['typical', 'tag', 'placeholder'].indexOf(k) !== -1, 'day field ' + k));
  });
  Object.keys(s.patches).forEach((dk) => Object.keys(s.patches[dk]).forEach((bid) => {
    assert.ok(s.typical[bid], 'a patch names a typical block that exists: ' + dk + '/' + bid);
    assert.ok(!('alertKey' in s.patches[dk][bid]), 'a patch never sets the alert key');
  }));
  // The published id (the Worker's, <dk>-<id>) fits the rules' 40.
  let longest = 0;
  SETUP_DK.forEach((dk) => resolveDay(normalizeSetup(seedClone(s)), SETUP_DK.indexOf(dk)).forEach((b) => { longest = Math.max(longest, (dk + '-' + b.id).length); }));
  assert.ok(longest <= 40, 'longest published id ' + longest);
  assert.ok(longest >= 30, 'the ids are long enough to be readable, ' + longest);
});

test('ids are unique inside a container, and no own block shares an id with a typical one', () => {
  const s = buildSeed(CAMP);
  Object.keys(s.dayBlocks).forEach((dk) => Object.keys(s.dayBlocks[dk]).forEach((id) => {
    assert.ok(!(id in s.typical), dk + '/' + id + ' collides with a typical block');
  }));
});

test('alertKey is today\'s pushBlockKey of the rendered label for every block of both profiles', () => {
  const s = buildSeed(CAMP);
  const t = normalizeSetup(seedRoundTrip(s));
  SEED_DOWS.forEach((d) => resolveDay(t, d).forEach((b) => {
    assert.equal(b.alertKey, pushBlockKey(renderLabel(b)), b.id);
  }));
});

test('meal tags: today\'s legacyMealOf, lower case, and a decorated or longer label is left alone', () => {
  const s = buildSeed(CAMP);
  const all = [].concat(Object.keys(s.typical).map((id) => s.typical[id]), ...Object.keys(s.dayBlocks).map((dk) => Object.keys(s.dayBlocks[dk]).map((id) => s.dayBlocks[dk][id])));
  all.forEach((b) => {
    const want = legacyMealOf(b.label);
    assert.equal(b.meal, want ? want.toLowerCase() : undefined, b.label);
  });
  const tagged = Array.from(new Set(all.filter((b) => b.meal).map((b) => b.meal))).sort();
  assert.deepEqual(tagged, CAMP.id === 'junior' ? ['breakfast', 'lunch', 'supper'] : ['breakfast', 'lunch'], 'senior\'s "Supper and free time" stays untagged, as today');
});

test('frozen id fixtures: a change to the slug rule can never silently re-key a live camp', () => {
  const want = JSON.parse(readFixture('fixtures-setup-seed-' + CAMP.id + '.json'));
  assert.deepEqual(seedIdTable(buildSeed(CAMP)), want, 'the seeded ids and alert keys moved — this fixture is never edited, a re-key is a migration');
});

// ── fidelity: the seeded week IS the printed week ────────────────────

test('round trip: every day of the seeded tree, after a database round trip, is the printed day in order', () => {
  const tree = seedTreeOf();
  SEED_DOWS.forEach((d) => {
    const got = resolveDay(tree, d).map(legacyBlock);
    const want = DAY_SCHEDULE[d] || [];
    assert.equal(got.length, want.length, 'day ' + d + ' block count');
    assert.equal(JSON.stringify(got), JSON.stringify(want), 'day ' + d + ' differs (fields, order or key order)');
  });
});

test('on, scheduleForDow / scheduleWeek / weekDays are the printed week; off they are the constants', () => {
  SEED_DOWS.forEach((d) => assert.ok(scheduleForDow(d) === (DAY_SCHEDULE[d] || scheduleForDow(99))), 'off: the constant itself');
  assert.equal(scheduleIsShared(), false);
  setupTree = seedTreeOf(); setupRev++;
  assert.equal(scheduleIsShared(), true);
  SEED_DOWS.forEach((d) => {
    assert.equal(JSON.stringify(scheduleForDow(d)), JSON.stringify(DAY_SCHEDULE[d] || []), 'day ' + d);
    assert.ok(scheduleForDow(d) === scheduleForDow(d), 'the same array until the tree changes');
    assert.equal(JSON.stringify(scheduleWeek()[d]), JSON.stringify(DAY_SCHEDULE[d] || []));
  });
  assert.ok(scheduleWeek() === scheduleWeek());
  assert.equal(JSON.stringify(weekDays()), JSON.stringify(SCHED_DAYS), 'the day strip: dow, short, full, tag');
  assert.ok(weekDays() === weekDays());
  assert.deepEqual(scheduleForDow(99), []);
  assert.deepEqual(scheduleForDow('x'), []);
  assert.deepEqual(scheduleForDow(null), []);
  assert.equal(JSON.stringify(scheduleForDow('3')), JSON.stringify(DAY_SCHEDULE[3]), 'a digit string is the day');
  setupTree = normalizeSetup({}); setupRev++;
  assert.equal(scheduleIsShared(), false, 'off again: the built-in week');
  assert.ok(scheduleForDow(2) === DAY_SCHEDULE[2]);
});

test('a switch that is off, or a schema this build cannot read, is the built-in week', () => {
  const tree = seedTreeOf();
  tree.meta.on.schedule = false;
  setupTree = tree; setupRev++;
  assert.equal(scheduleIsShared(), false, 'turned off: data kept, built-in copy shown');
  assert.ok(scheduleForDow(1) === DAY_SCHEDULE[1]);
  tree.meta.on.schedule = true; tree.meta.schema = 2; setupRev++;
  assert.equal(setupSchemaTooNew(), true);
  assert.equal(scheduleIsShared(), false, 'a newer build\'s data is never guessed at');
  tree.meta.schema = 1; setupRev++;
  assert.equal(scheduleIsShared(), true);
  setupTree = normalizeSetup({}); setupRev++;
});

test('a day the shared schedule has no blocks for is empty, and the banner says nothing, never throws', () => {
  const tree = seedTreeOf();
  tree.days.sat = { typical: false, tag: '' };
  delete tree.dayBlocks.sat;
  setupTree = tree; setupRev++;
  assert.deepEqual(scheduleForDow(6), []);
  assert.equal(nowBannerHtml(6, 600), null);
  setupTree = normalizeSetup({}); setupRev++;
});

test('planForDow: the same rich blocks whether built-in or edited here (a preview has real ids)', () => {
  const off = SEED_DOWS.map((d) => planForDow(d).map((b) => Object.assign({}, b)));
  setupTree = seedTreeOf(); setupRev++;
  const on = SEED_DOWS.map((d) => planForDow(d).map((b) => Object.assign({}, b)));
  assert.deepEqual(on, off, 'seeded and built-in resolve alike');
  assert.ok(on[2].every((b) => /^b-/.test(b.id) && b.dk === 'tue' && typeof b.alertKey === 'string'));
  const mon = planForDow(1);
  const lunch = mon.find((b) => b.label === 'Lunch');
  assert.equal(lunch.meal, 'lunch');
  assert.equal(lunch.origin, 'typical');
  assert.ok(Array.isArray(mon.skipped) && Array.isArray(mon.broken));
  assert.deepEqual(planForDow(99), []);
  setupTree = normalizeSetup({}); setupRev++;
});

test('the banner is byte-identical before and after seeding, for every minute of the week', () => {
  const grab = () => { const out = []; SEED_DOWS.forEach((d) => { for (let m = 0; m < 1440; m++) out.push(nowBannerHtml(d, m)); }); return out; };
  const before = grab();
  assert.equal(before.length, 10080);
  assert.ok(before.filter((x) => x !== null).length > 5000, 'the fuzz is looking at real banners');
  setupTree = seedTreeOf(); setupRev++;
  assert.equal(scheduleIsShared(), true);
  const after = grab();
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) assert.fail('banner differs at day ' + Math.floor(i / 1440) + ' minute ' + (i % 1440) + '\n  before: ' + String(before[i]).slice(0, 200) + '\n  after:  ' + String(after[i]).slice(0, 200));
  }
  setupTree = normalizeSetup({}); setupRev++;
});

test('the seed is the same data a restore point and the engine see: canonical, and a no-op diff against itself', () => {
  const tree = seedTreeOf();
  assert.deepEqual(setupDiff(tree, tree), {});
  assert.deepEqual(setupDiff({}, tree).meta, undefined, 'meta is always per-field, never the coarse op');
  assert.ok(Object.keys(setupDiff({}, tree)).length > 3);
});

test('the alert publisher: keys, labels and the drawer\'s catalog are identical after seeding; ids change format by design', () => {
  const before = pushScheduleBlocks(scheduleWeek());
  const catalogBefore = pushBlockCatalog(scheduleWeek());
  setupTree = seedTreeOf(); setupRev++;
  const after = pushScheduleBlocks(scheduleWeek());
  const catalogAfter = pushBlockCatalog(scheduleWeek());
  const strip = (m) => Object.keys(m).map((id) => m[id]);
  assert.deepEqual(strip(after), strip(before), 'the same blocks in the same order with the same dow, start, label, emoji and key');
  assert.deepEqual(catalogAfter, catalogBefore, 'the 📲 Phone alerts list is unchanged');
  Object.keys(before).forEach((id) => assert.ok(/^d[0-6]-\d+-\d+$/.test(id), 'built-in ids are d<dow>-<start>-<position>: ' + id));
  Object.keys(after).forEach((id) => {
    assert.ok(/^[a-z0-9-]{1,40}$/.test(id), 'the rules\' shape: ' + id);
    assert.ok(/^(sun|mon|tue|wed|thu|fri|sat)-b-/.test(id), 'shared ids are <dk>-<block id>: ' + id);
  });
  assert.equal(Object.keys(after).length, Object.keys(before).length, 'no duplicate ids collapsed two blocks');
  // A block's published id and key follow the block, not its position or its words: rename and move it.
  const lunch = planForDow(2).find((b) => b.label === 'Lunch');
  const idBefore = Object.keys(pushScheduleBlocks(scheduleWeek())).find((id) => id === 'tue-' + lunch.id);
  assert.ok(idBefore, 'tuesday lunch is published as tue-' + lunch.id);
  setupTree.typical[lunch.id].label = 'Midday meal';
  setupTree.typical[lunch.id].start = 725;
  setupTree.typical[lunch.id].end = 755;
  setupRev++;
  const moved = pushScheduleBlocks(scheduleWeek())['tue-' + lunch.id];
  assert.ok(moved, 'the same id after a rename and a move');
  assert.equal(moved.label, 'Midday meal');
  assert.equal(moved.start, 725);
  assert.equal(moved.key, lunch.alertKey, 'and the same key: phones subscribed to "lunch" keep getting it');
  setupTree = normalizeSetup({}); setupRev++;
});

// ── A1: Edit the week here, and Use the original week again (§10.1) ──
// Driven against the in-memory database with the real engines past their first snapshot. The switch is the OWNER's.

const A1_ROOT = CAMP.dbRoot;
const A1_OWNER = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
const A1_JENN = { email: 'jenn@example.com', emailVerified: true };
const a1Wait = (ms) => new Promise((r) => setTimeout(r, ms || 5));
const A1_QUIET = { campRunning: false }; // no camp week is set in these cases: the freeze question's answer is "no"

async function a1Setup(opts) {
  const o = opts || {};
  freshState();
  authUser = o.user || A1_OWNER;
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
  if (o.setup) db.serverSet(dbPath('setup'), o.setup);
  fbRef = db.ref(dbPath('state'));
  fbConfigRef = db.ref(dbPath('config'));
  setupRef = db.ref(dbPath('setup'));
  fbRef.on('value', (snap) => handleRemoteSnapshot(snap.val()));
  attachConfigListener();
  attachSetupListener();
  db.deliverFirstSnapshots();
  flushPendingPush();
  await a1Wait(40);
  assert.equal(remoteReady && configReady && setupReady, true, 'all three engines are past their first pull');
  return db;
}

function a1Teardown() {
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

async function a1Settle() {
  for (let i = 0; i < 80; i++) {
    if (pendingWritesTotal() === 0 && !hasUnconfirmedLocalWork() && !pushTimer && !pushConfigTimer && !setupPushTimer) return;
    await a1Wait(50);
  }
}

// The commit's own snapshot is adopted through the engine (a re-read when it was turned away mid-write): wait for it.
async function a1WaitShared(on) {
  for (let i = 0; i < 60 && scheduleIsShared() !== on; i++) await a1Wait(10);
  assert.equal(scheduleIsShared(), on, 'the engine adopted the switch');
}

const a1Server = (db) => db.serverGet(A1_ROOT + '/setup') || {};
const a1Points = (db) => Object.values(db.serverGet(A1_ROOT + '/restoreIndex') || {});

test('mergeSeed: seeds a section never turned on, flips only the switch for one turned off, and leaves one that is on', () => {
  const info = { at: 1700000000000, byKey: 'patricksimpson,fx@gmail,com', from: 'camps.js@v199' };
  const seed = buildSeed(CAMP);
  const fresh = mergeSeed(null, seed, ['schedule'], info);
  assert.equal(JSON.stringify(syncCanon(fresh.meta)), JSON.stringify(syncCanon({ schema: 1, on: { schedule: true }, seeded: info })));
  assert.deepEqual(fresh.typical, seed.typical);
  assert.deepEqual(fresh.days, seed.days);
  assert.equal(mergeSeed({}, seed, [], info), undefined, 'no sections: nothing to write');
  assert.equal(mergeSeed(fresh, seed, ['schedule'], info), undefined, 'already on: the transaction aborts');
  assert.equal(mergeSeed(fresh, seed, ['nonsense'], info), undefined);
  // Turned off before: ONLY the switch, the data (edited here) stays exactly as it is, and seeded is not re-stamped.
  const edited = JSON.parse(JSON.stringify(fresh));
  edited.meta.on.schedule = false;
  edited.typical[Object.keys(edited.typical)[0]].label = 'Edited here';
  edited.dayBlocks = { sun: { 'b-sun-mine-1': { start: 600, end: 660, label: 'Mine', type: 'activity' } } };
  const again = mergeSeed(edited, seed, ['schedule'], { at: 2, byKey: 'x', from: 'y' });
  assert.equal(again.meta.on.schedule, true);
  assert.deepEqual(again.meta.seeded, info, 'the first seed record stays');
  assert.equal(again.typical[Object.keys(again.typical)[0]].label, 'Edited here');
  assert.deepEqual(again.dayBlocks, edited.dayBlocks, 'a day the owner rewrote is not re-seeded');
  // It never mutates what it was given, and copies every other field unchanged (stamps, a wizard claim, the week date).
  const cur = { meta: { weekStart: '2027-07-18', edited: { week: { at: 5, byKey: 'a' } }, wizard: { step: 3, byKey: 'o', at: 9 }, on: { meals: true } }, meals: { mon: { lunch: { dish: 'x' } } } };
  const frozen = JSON.stringify(cur);
  const merged = mergeSeed(cur, seed, ['schedule'], info);
  assert.equal(JSON.stringify(cur), frozen, 'the input is untouched');
  assert.equal(merged.meta.weekStart, '2027-07-18');
  assert.deepEqual(merged.meta.edited, cur.meta.edited);
  assert.equal(JSON.stringify(syncCanon(merged.meta.wizard)), JSON.stringify(syncCanon(cur.meta.wizard)));
  assert.deepEqual(merged.meta.on, { meals: true, schedule: true }, 'another section\'s switch is carried');
  assert.deepEqual(merged.meals, cur.meals);
  // A node written by a newer build is never touched.
  assert.equal(mergeSeed({ meta: { schema: 2 } }, seed, ['schedule'], info), undefined);
});

test('A1 on an empty node: a pre-seed point first, then ONE transaction that seeds and flips the switch; A2 links the games', async () => {
  const db = await a1Setup();
  try {
    const from = db.log.length;
    const r = await setupTurnOn(undefined, A1_QUIET);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.turnedOn, ['schedule']);
    assert.deepEqual(r.seeded, ['schedule']);
    assert.equal(r.attach.attached, allGames().length, 'every game got a place');
    const server = a1Server(db);
    assert.equal(server.meta.on.schedule, true);
    assert.equal(server.meta.schema, 1);
    assert.equal(server.meta.seeded.byKey, OWNER_MEMBER_KEY);
    assert.equal(server.meta.seeded.from, 'camps.js@v' + APP_VERSION);
    assert.equal(typeof server.meta.seeded.at, 'number', 'the server\'s clock, resolved by the transaction');
    assert.equal(JSON.stringify(syncCanon(server.typical)), JSON.stringify(syncCanon(buildSeed(CAMP).typical)), 'the seeded typical day, after the round trip');
    // Order of writes: the safety net, THEN the transaction.
    const log = db.log.slice(from);
    const rp = log.findIndex((l) => l.kind === 'update' && l.paths.some((p) => /restoreIndex\/rp-/.test(p)));
    const txn = log.findIndex((l) => l.kind === 'transaction' && l.paths[0] === A1_ROOT + '/setup');
    assert.ok(rp !== -1 && txn !== -1 && rp < txn, 'the pre-seed restore point is written before the transaction');
    assert.equal(a1Points(db).filter((x) => x.kind === 'pre-seed').length, 1);
    // The engine adopted it like any other snapshot: the accessors flipped, and there is no phantom diff.
    await a1WaitShared(true);
    assert.deepEqual(setupDiff(setupBase, setupTree), {}, 'nothing for the engine to push');
    await a1Settle();
    assert.equal(setupPendingCount(), 0);
    // A2's one config transaction landed on the server: every game carries blockId and ord.
    const games = (db.serverGet(A1_ROOT + '/config') || {}).games;
    const list = Array.isArray(games) ? games : Object.values(games);
    assert.ok(list.every((g) => typeof g.blockId === 'string' && g.ord > 0), 'the games\' links reached the config node');
    assert.equal(db.log.slice(from).filter((l) => l.kind === 'transaction' && l.paths[0] === A1_ROOT + '/config').length, 1, 'ONE config transaction');
  } finally { a1Teardown(); }
});

test('A1 twice writes once: a second press, or the owner\'s other device, aborts and the node is untouched', async () => {
  const db = await a1Setup();
  try {
    assert.equal((await setupTurnOn(undefined, A1_QUIET)).ok, true);
    await a1WaitShared(true);
    const node = JSON.stringify(a1Server(db));
    const points = a1Points(db).filter((x) => x.kind === 'pre-seed').length;
    const second = await setupTurnOn(undefined, A1_QUIET);
    assert.equal(second.reason, 'already', 'the switch is on: "You already turned this on"');
    // The other device has not heard yet: it presses too. The transaction re-runs on the server's value and aborts.
    setupTree = normalizeSetup({}); setupRev++;
    assert.equal(scheduleIsShared(), false);
    const stale = await setupTurnOn(undefined, A1_QUIET);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'already');
    assert.equal(JSON.stringify(a1Server(db)), node, 'not a byte changed');
    assert.equal(a1Points(db).filter((x) => x.kind === 'pre-seed').length, points + 1, 'a point is only a safety net: the stale press took its own, harmlessly');
  } finally { a1Teardown(); }
});

test('only the owner can press it: another director or a counselor is refused before anything is written', async () => {
  const db = await a1Setup({ user: A1_JENN });
  try {
    const from = db.log.length;
    const r = await setupTurnOn(undefined, A1_QUIET);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'owner');
    assert.equal(r.message, 'Only Patrick can turn on editing.');
    setMemberRole('viewer');
    assert.equal((await setupTurnOn(undefined, A1_QUIET)).reason, 'owner');
    setMemberRole('editor');
    assert.equal(db.log.slice(from).length, 0, 'not even a restore point');
    assert.equal(scheduleIsShared(), false);
    const back = setupUseOriginal();
    assert.equal(back.reason, 'owner', 'the owner check comes first, whatever is on');
    assert.equal(back.message, 'Only Patrick can switch back to the original week.');
  } finally { a1Teardown(); }
});

test('A1 preconditions are said first: loading, offline, denied, a newer schema, a restore point that cannot be written', async () => {
  const db = await a1Setup();
  try {
    const from = db.log.length;
    setupReady = false;
    assert.equal((await setupTurnOn(undefined, A1_QUIET)).reason, 'loading');
    setupReady = true;
    fbConnected = false;
    assert.equal((await setupTurnOn(undefined, A1_QUIET)).reason, 'offline');
    fbConnected = true;
    setupDenied = true;
    assert.equal((await setupTurnOn(undefined, A1_QUIET)).reason, 'denied');
    setupDenied = false;
    setupTree.meta.schema = 2;
    assert.equal((await setupTurnOn(undefined, A1_QUIET)).reason, 'schema');
    setupTree.meta.schema = undefined;
    assert.equal((await setupTurnOn(['meals'])).reason, 'none', 'a section this build cannot seed');
    assert.equal(db.log.slice(from).length, 0, 'every refusal came before any write');
    // The point is the safety net: without it, nothing is written.
    db.refuse(A1_ROOT + '/restoreIndex');
    const r = await setupTurnOn(undefined, A1_QUIET);
    assert.equal(r.reason, 'restore-point');
    assert.equal(db.serverGet(A1_ROOT + '/setup'), null, 'the node was not touched');
    assert.equal(scheduleIsShared(), false);
    db.allow(A1_ROOT + '/restoreIndex');
  } finally { a1Teardown(); }
});

test('the camp-week freeze: a running week refuses, an unset date asks, "no" proceeds, the override proceeds', async () => {
  const db = await a1Setup();
  const realToday = campDateStr;
  try {
    setupTree.meta.weekStart = '2027-07-18'; setupRev++;
    campDateStr = () => '2027-07-20';
    assert.equal((await setupTurnOn()).reason, 'camp-week');
    campDateStr = () => '2027-03-01';
    delete setupTree.meta.weekStart; setupRev++;
    assert.equal((await setupTurnOn()).reason, 'ask-camp-week', 'no date: the owner is asked "Is a camp week running right now?"');
    assert.equal((await setupTurnOn(undefined, { campRunning: true })).reason, 'camp-week');
    setupTree.meta.weekStart = '2027-07-18'; setupRev++;
    campDateStr = () => '2027-07-20';
    assert.equal((await setupTurnOn(undefined, { overrideCampWeek: true })).ok, true, '"I know a camp week is running"');
  } finally { campDateStr = realToday; a1Teardown(); }
});

test('A1 after edits: stamps, a live wizard claim and another section\'s switch are carried; a second section still commits', async () => {
  const carried = { meta: { weekStart: '2027-07-18', on: { meals: true }, edited: { week: { at: 1700000000000, byKey: 'jenn@example,com' } }, wizard: { step: 2, byKey: OWNER_MEMBER_KEY, at: 1700000000000, fromEpoch: 'legacy' } }, meals: { mon: { lunch: { dish: 'Pizza', emoji: '🍕' } } } };
  const db = await a1Setup({ setup: carried });
  const realToday = campDateStr;
  try {
    campDateStr = () => '2027-03-01';
    const r = await setupTurnOn(undefined, A1_QUIET);
    assert.equal(r.ok, true, JSON.stringify(r));
    const server = a1Server(db);
    assert.equal(JSON.stringify(syncCanon(server.meta.edited)), JSON.stringify(syncCanon(carried.meta.edited)), 'the stamp is carried as it was');
    assert.equal(JSON.stringify(syncCanon(server.meta.wizard)), JSON.stringify(syncCanon(carried.meta.wizard)));
    assert.equal(server.meta.weekStart, '2027-07-18');
    assert.deepEqual(server.meta.on, { meals: true, schedule: true });
    assert.deepEqual(server.meals, carried.meals);
  } finally { campDateStr = realToday; a1Teardown(); }
});

test('off then on keeps everything: the edit, the hand attachment and the empty day all survive; only the switch moves', async () => {
  const db = await a1Setup();
  try {
    assert.equal((await setupTurnOn(undefined, A1_QUIET)).ok, true);
    await a1WaitShared(true);
    await a1Settle();
    // An edit on the schedule, and a game moved by hand.
    const lunchId = planForDow(2).find((b) => b.label === 'Lunch').id;
    const edit = commitSetup((d) => { d.typical[lunchId].label = 'Midday meal'; }, { label: 'Renamed lunch' });
    assert.equal(edit.ok, true);
    const day = competitionDays().find((d) => d.dow === 2);
    const moved = allGames().find((g) => g.dayId === day.id && g.session === 'Morning');
    moved.blockId = lunchId; moved.ord = 777;
    saveConfig();
    await a1Settle();
    const serverBefore = JSON.stringify(a1Server(db));
    const seeded = a1Server(db).meta.seeded;
    // Use the original week again: instant, and the built-in copy is back.
    const off = setupUseOriginal();
    assert.equal(off.ok, true, JSON.stringify(off));
    assert.equal(scheduleIsShared(), false);
    assert.ok(scheduleForDow(2) === DAY_SCHEDULE[2], 'the printed week, the constant itself');
    await a1Settle();
    assert.equal(a1Server(db).meta.on.schedule, false, 'the switch is false on the server');
    assert.equal(a1Server(db).typical[lunchId].label, 'Midday meal', 'the edit is KEPT');
    const points = a1Points(db).length;
    // Edit the week here again.
    const on = await setupTurnOn(undefined, A1_QUIET);
    assert.equal(on.ok, true, JSON.stringify(on));
    assert.deepEqual(on.seeded, [], 'nothing was seeded: only the switch');
    await a1WaitShared(true);
    await a1Settle();
    const after = a1Server(db);
    assert.equal(after.meta.on.schedule, true);
    assert.deepEqual(after.meta.seeded, seeded, 'the first seed record stays');
    assert.equal(after.typical[lunchId].label, 'Midday meal', 'the edit came back');
    assert.equal(scheduleIsShared(), true);
    assert.equal(planForDow(2).find((b) => b.id === lunchId).label, 'Midday meal');
    const g = allGames().find((x) => x.id === moved.id);
    assert.equal(g.blockId, lunchId, 'the hand attachment is untouched');
    assert.equal(g.ord, 777);
    assert.equal(a1Points(db).length, points, 'no second pre-seed point: nothing was seeded');
    // Everything but the switch is exactly as it was.
    const strip = (t) => { const c = JSON.parse(t); delete c.meta.on; delete c.meta.edited; return JSON.stringify(c); };
    assert.equal(strip(JSON.stringify(after)), strip(serverBefore));
  } finally { a1Teardown(); }
});

test('Use the original week again is the owner\'s too, and refused for another director before it writes', async () => {
  const db = await a1Setup();
  try {
    assert.equal((await setupTurnOn(undefined, A1_QUIET)).ok, true);
    await a1WaitShared(true);
    await a1Settle();
    authUser = A1_JENN;
    const from = db.log.length;
    const r = setupUseOriginal();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'owner');
    assert.equal(r.message, 'Only Patrick can switch back to the original week.');
    assert.equal(scheduleIsShared(), true, 'still on');
    assert.equal(db.log.slice(from).length, 0);
  } finally { a1Teardown(); }
});
