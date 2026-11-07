// The Set up the week hub's checklist (setup-rebuild-spec §11.2, Appendix B/C; build step 14).
// hubStatus(section, view) is PURE — a plain `view` in, { mark, word, summary, problems } out — so each
// problem sentence of Appendix B that this step can honestly evaluate has its own case, and the rows whose
// screens come later (Steps 15, 19, 25) say `soon` and claim nothing. hubModel adds "N of M ready", what is
// next and the front door; hubDoor's owner-only rendering contract is pinned here too (Q8): the owner's
// button exists only with an action behind it, and everyone else reads the same sentence with the owner's
// name — never a button for a director who is not the owner. Runs under the senior profile as well.

const INDEX_HTML = readFixture('../index.html');
const CL_NOW = Date.UTC(2027, 6, 18, 15, 0, 0);
const clDays = (n) => Array.from({ length: n }, (_, i) => ({ id: 'd' + (i + 1), name: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][i] }));
const clGames = (days, each) => days.flatMap((d) => Array.from({ length: each }, (_, i) => ({ id: d.id + 'g' + i, name: 'Game ' + d.id + i, dayId: d.id, format: 'placement', location: 'Field' })));
const clTeams = (n) => Array.from({ length: n }, (_, i) => ({ id: 't' + i, name: ['Foxes', 'Pumpkins', 'Turkey', 'Pilgrims', 'Maples', 'Deeres'][i], counselor: '' }));
const clMember = (key, role, extra) => Object.assign({ key, role, name: key.split('@')[0], addedBy: 'owner', addedAt: CL_NOW - 3 * 86400000, pending: false }, extra || {});

function clView(over) {
  const days = clDays(5);
  const teams = clTeams(CAMP.teamCount);
  return Object.assign({
    campLabel: CAMP.label, teamCount: CAMP.teamCount, electives: false, isOwner: false, ownerName: 'Patrick', now: CL_NOW,
    teams, days, games: clGames(days, 2), members: teams.map((t, i) => clMember('c' + i + '@x', 'viewer', { teamId: t.id })).concat(clMember('d@x', 'editor')),
    membersLoaded: true, on: {}, skip: {}, weekStart: '', weekRunning: false, newYearDue: false, setupTooNew: false,
    notice: { status: 'draft', has: false }, restore: { status: 'ok', newestAt: CL_NOW - 12 * 60000, count: 3 }, doorActions: {},
  }, over || {});
}

// ── Games ──
test('Games: ok says how many games on how many days; "No games yet" is todo', () => {
  const s = hubStatus('games', clView());
  assert.equal(s.mark, 'ok');
  assert.equal(s.word, 'Ready');
  assert.equal(s.summary, '10 games · 5 days');
  assert.equal(hubStatus('games', clView({ games: [] })).mark, 'warn', 'days with no games are a warning, not a todo');
  const none = hubStatus('games', clView({ games: [], days: [] }));
  assert.equal(none.mark, 'todo');
  assert.equal(none.summary, 'No games yet');
});

test('Games problems: a game on no day, a day with no games, a tournament with no bracket, TBA', () => {
  const v = clView();
  const lost = hubStatus('games', clView({ games: v.games.concat([{ id: 'x', name: 'Rain bowling', dayId: 'gone', format: 'placement', location: 'Gym' }]) }));
  assert.deepEqual(lost.problems, ['Rain bowling isn’t on a day']);
  assert.equal(lost.mark, 'warn');
  assert.equal(lost.word, '1 to check');
  const two = hubStatus('games', clView({ games: v.games.concat([{ id: 'x', name: 'A', dayId: 'gone' }, { id: 'y', name: 'B', dayId: 'gone' }]) }));
  assert.deepEqual(two.problems, ['2 games aren’t on a day']);
  assert.deepEqual(hubStatus('games', clView({ games: v.games.filter((g) => g.dayId !== 'd4') })).problems, ['Thursday has no games']);
  assert.deepEqual(hubStatus('games', clView({ games: v.games.filter((g) => g.dayId !== 'd4' && g.dayId !== 'd5') })).problems, ['Thursday and Friday have no games']);
  assert.deepEqual(hubStatus('games', clView({ games: v.games.filter((g) => g.dayId === 'd1') })).problems, ['4 days have no games']);
  const tour = hubStatus('games', clView({ teamCount: 5, games: v.games.concat([{ id: 't', name: 'Kickball', dayId: 'd1', format: 'tournament', location: 'Lawn' }]) }));
  assert.deepEqual(tour.problems, ['Kickball is a tournament, but there is no bracket for 5 teams']);
  assert.deepEqual(hubStatus('games', clView({ games: v.games.concat([{ id: 't', name: 'Kickball', dayId: 'd1', format: 'tournament', location: 'Lawn' }]) })).problems, [], 'four and six teams both have a bracket');
  const tba = (n) => v.games.map((g, i) => (i < n ? Object.assign({}, g, { location: ' TBA ' }) : g));
  assert.deepEqual(hubStatus('games', clView({ games: tba(1) })).problems, ['1 game still says TBA for where']);
  assert.deepEqual(hubStatus('games', clView({ games: tba(4) })).problems, ['4 games still say TBA for where']);
});

// ── Teams ──
test('Teams: ok, a wrong count, a bad id and an unnamed team (the owner reads a different sentence)', () => {
  assert.equal(hubStatus('teams', clView()).summary, CAMP.teamCount + ' teams');
  assert.equal(hubStatus('teams', clView()).mark, 'ok');
  const few = clView({ teams: clTeams(CAMP.teamCount).slice(1) });
  assert.deepEqual(hubStatus('teams', few).problems, ['Ask Patrick to repair team slots'], 'to everyone else, the owner by name');
  assert.deepEqual(hubStatus('teams', Object.assign({}, few, { isOwner: true })).problems, ['The team slots need repair'], 'the owner is not told to ask themselves');
  const badId = clTeams(CAMP.teamCount);
  badId[0] = Object.assign({}, badId[0], { id: 't-1700000000' });
  assert.equal(hubStatus('teams', clView({ teams: badId })).problems[0], 'Ask Patrick to repair team slots');
  const dup = clTeams(CAMP.teamCount);
  dup[1] = Object.assign({}, dup[1], { id: 't0' });
  assert.equal(hubStatus('teams', clView({ teams: dup })).mark, 'warn', 'two teams on one slot');
  const unnamed = clTeams(CAMP.teamCount);
  unnamed[2] = Object.assign({}, unnamed[2], { name: '  ' });
  assert.deepEqual(hubStatus('teams', clView({ teams: unnamed })).problems, ['Team 3 has no name']);
});

// ── People ──
test('People: counts counselors and directors; says so while the list loads', () => {
  const s = hubStatus('people', clView());
  assert.equal(s.mark, 'ok');
  assert.equal(s.summary, CAMP.teamCount + ' counselors · 1 director');
  const loading = hubStatus('people', clView({ membersLoaded: false }));
  assert.equal(loading.mark, 'info');
  assert.equal(loading.summary, 'Loading the list…');
  assert.equal(loading.word, '');
});

test('People problems: a team with no counselors, an incomplete record, people with no sign-in yet', () => {
  const v = clView();
  const noOne = hubStatus('people', clView({ members: v.members.filter((m) => m.teamId !== 't1') }));
  assert.deepEqual(noOne.problems, ['Pumpkins has no counselors yet']);
  assert.equal(noOne.mark, 'warn');
  const half = v.members.concat([clMember('sam@x', 'viewer', { name: 'Sam', addedBy: '' })]);
  assert.deepEqual(hubStatus('people', clView({ members: half })).problems, ['Sam’s sign-in record is incomplete']);
  const norole = v.members.concat([clMember('lee@x', undefined, { name: 'Lee' })]);
  assert.deepEqual(hubStatus('people', clView({ members: norole })).problems, ['Lee’s sign-in record is incomplete']);
  // The owner row is console-seeded and legitimately has no addedBy / addedAt.
  const owner = v.members.concat([clMember('pat@x', 'editor', { name: 'Patrick', addedBy: '', addedAt: undefined, owner: true })]);
  assert.deepEqual(hubStatus('people', clView({ members: owner })).problems, [], 'the owner row is never "incomplete"');
  const pend = (n, age) => v.members.concat(Array.from({ length: n }, (_, i) => clMember('pending-x' + i, 'viewer', { name: 'P' + i, pending: true, addedAt: CL_NOW - age })));
  assert.deepEqual(hubStatus('people', clView({ members: pend(1, 86400000) })).problems, ['1 person has no sign-in yet']);
  assert.deepEqual(hubStatus('people', clView({ members: pend(3, 86400000) })).problems, ['3 people have no sign-in yet']);
  assert.deepEqual(hubStatus('people', clView({ members: pend(3, 8 * 86400000) })).problems, [], 'after a week it is a note, not a nag');
});

// ── The rest of the rows ──
test('rows whose screen comes later say `soon` and claim nothing; an optional one can be set aside', () => {
  // Campers has its screen now (Step 25, session 3): its row is judged (see the Campers cases below). Phone alerts is the one that is still to come.
  ['alerts'].forEach((k) => {
    const s = hubStatus(k, clView());
    assert.equal(s.mark, 'soon', k);
    assert.equal(s.word, 'Editing comes next', k);
    assert.deepEqual(s.problems, [], k + ' has nothing to check yet');
  });
  // Meals, verses, the rota and electives have their screens now (Step 19): while the section is the original the row is a plain
  // "info" line that claims nothing (their judging is sections.test.js's hub cases).
  [['meals', 'The original menu'], ['verses', 'The original verses'], ['cleanup', 'The original rota'], ['electives', 'The original stations']].forEach(([k, line]) => {
    const s = hubStatus(k, clView());
    assert.deepEqual([s.mark, s.summary, s.word, s.problems.length], ['info', line, '', 0], k);
  });
  const skipped = hubStatus('meals', clView({ skip: { meals: true } }));
  assert.equal(skipped.mark, 'skip');
  assert.equal(skipped.word, 'Not used');
  assert.equal(hubStatus('games', clView({ skip: { games: true } })).mark, 'ok', 'only the optional sections can be set aside');
});

test('Camp week and Schedule have their screens now (Step 15): dates are ok or a plain line, never a warning; the schedule says where it stands', () => {
  const wk = hubStatus('week', clView({ weekStart: '2027-07-18' }));
  assert.deepEqual([wk.mark, wk.summary], ['ok', 'Sun Jul 18 – Sat Jul 24']);
  const none = hubStatus('week', clView());
  assert.deepEqual([none.mark, none.summary, none.word], ['info', 'No dates set yet', ''], 'the 2026 week has no dates: that is not a chore');
  const off = hubStatus('schedule', clView());
  assert.deepEqual([off.mark, off.summary, off.word], ['info', 'The original schedule', '']);
  const on = hubStatus('schedule', clView({ on: { schedule: true } }));
  assert.deepEqual([on.mark, on.summary], ['ok', 'Edited here'], 'no model of the days yet: still ready');
  const good = hubStatus('schedule', clView({ on: { schedule: true }, schedule: { follow: 'Mon–Fri', oneOffs: 3, empty: [], broken: [], overlaps: [] } }));
  assert.deepEqual([good.mark, good.summary], ['ok', 'Typical day · Mon–Fri · 3 one-offs']);
  const bad = hubStatus('schedule', clView({ on: { schedule: true }, schedule: { follow: 'Mon–Fri', oneOffs: 0, typicalEmpty: true, empty: ['Saturday'], broken: [{ day: 'Tuesday', n: 1 }], overlaps: [{ day: 'Tuesday', n: 2, at: '9:15 PM' }] } }));
  assert.equal(bad.mark, 'warn');
  assert.deepEqual(bad.problems, ['The typical day is empty', 'Saturday is empty', '1 broken item on Tuesday', '2 items overlap on Tuesday at 9:15 PM']);
  const newer = hubStatus('schedule', clView({ setupTooNew: true }));
  assert.equal(newer.mark, 'warn');
});

test('Schedule row, Appendix B sentences: "showing the original, your edits are kept", a meal without its tag, and a quiet note for a day still on the sample', () => {
  const held = hubStatus('schedule', clView({ held: { schedule: true } }));
  assert.deepEqual([held.mark, held.summary, held.word], ['info', 'Showing the original — your edits are kept', '']);
  const door = hubDoor(clView({ held: { schedule: true }, doorActions: { original: true } }));
  assert.equal(door.door, 'original');
  assert.equal(door.text, 'Your changes to the schedule are kept. Turning on editing brings them back.');
  assert.equal(door.ownerButton, 'Edit the week here');
  assert.equal(door.ownerText, 'Patrick can switch it back on.', 'everyone else reads the owner\'s name, no button');
  assert.equal(hubDoor(clView({ doorActions: { original: true } })).lead, 'This camp is still using the original week.', 'never turned on: the old sentence');
  const meals = hubStatus('schedule', clView({ on: { schedule: true }, schedule: { follow: 'Mon–Fri', oneOffs: 0, empty: [], broken: [], overlaps: [], unmarkedMeals: [{ day: 'Tuesday', names: ['Lunch'] }, { day: 'Friday', names: ['Breakfast', 'Supper'] }] } }));
  assert.equal(meals.mark, 'warn');
  assert.deepEqual(meals.problems, ['Lunch on Tuesday isn’t marked as a meal', 'Breakfast and Supper on Friday aren’t marked as meals']);
  const sample = hubStatus('schedule', clView({ on: { schedule: true }, schedule: { follow: 'Mon–Fri', oneOffs: 0, empty: [], broken: [], overlaps: [], sample: ['Sunday', 'Saturday'] } }));
  assert.equal(sample.mark, 'ok', 'a placeholder day is information, never a warning');
  assert.deepEqual(sample.problems, []);
  assert.equal(sample.note, 'Sunday and Saturday still use the sample schedule');
  assert.equal(hubStatus('schedule', clView({ on: { schedule: true }, schedule: { follow: 'Mon–Fri', sample: ['Sunday'] } })).note, 'Sunday still uses the sample schedule');
  assert.equal(hubStatus('schedule', clView({ on: { schedule: true }, schedule: { follow: 'Mon–Fri' } })).note, undefined);
});

test('hubScheduleView over the seeded camp: no unmarked meal anywhere, and only a day that still matches the seed is a sample day (the placeholder flag stays for good)', () => {
  freshState();
  setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP))));
  setupRev++;
  try {
    const v = hubScheduleView();
    // Junior's every meal is tagged by the seed. Senior's printed "Supper and free time" is NOT (the seed tags only an exact
    // Breakfast / Lunch / Supper label), and the warning says so; Step 20's live check tags it before meals and cleanup go on.
    if (CAMP.id === 'junior') assert.deepEqual(v.unmarkedMeals, [], 'every seeded meal carries its Meal tag');
    else {
      assert.ok(v.unmarkedMeals.length, 'senior\'s supper reads like a meal and has no tag');
      v.unmarkedMeals.forEach((m) => assert.deepEqual(m.names, ['Supper and free time']));
      const row = hubStatus('schedule', clView({ on: { schedule: true }, schedule: v }));
      assert.equal(row.mark, 'warn');
      assert.equal(row.problems.length, 1, 'the same item on every day is one sentence, not five');
      assert.ok(/^Supper and free time on .+ isn’t marked as a meal$/.test(row.problems[0]), row.problems[0]);
    }
    const placeholders = (CAMP.placeholderDays || []).map((dow) => SETUP_DAY_WORDS[SETUP_DK[dow]]);
    assert.deepEqual(v.sample, placeholders, CAMP.id === 'senior' ? 'senior\'s arrival and send-off days' : 'junior has none');
    if (placeholders.length) {
      // A director replaces the first one: the note goes, the flag stays.
      const dow = CAMP.placeholderDays[0];
      const dk = SETUP_DK[dow];
      setupTree.dayBlocks[dk] = { 'b-x-540': { start: 540, end: 600, label: 'Welcome', emoji: '👋', type: 'activity', ord: 0, alertKey: 'welcome' } };
      setupTree.days[dk].typical = false;
      setupRev++;
      assert.deepEqual(hubScheduleView().sample, placeholders.slice(1), 'the replaced day is no longer called a sample');
      assert.equal(setupMapOf(setupTree.days)[dk].placeholder, true, 'the flag itself is untouched');
    }
    // A Lunch without its tag is named.
    const lunch = Object.keys(setupTree.typical).find((id) => setupTree.typical[id].meal === 'lunch');
    assert.ok(lunch, 'the seeded typical day has a lunch');
    delete setupTree.typical[lunch].meal;
    setupRev++;
    const lunchy = hubScheduleView().unmarkedMeals;
    assert.ok(lunchy.length && lunchy.every((m) => m.names.includes('Lunch')), 'named, day by day');
    assert.deepEqual(secLooseMeals([{ label: 'Supper and free time' }, { label: 'Supper', meal: 'supper' }, { label: 'Lunch cleanup — crew' }, { label: 'Free time' }]), ['Supper and free time', 'Lunch cleanup'], 'a label that begins with a meal word, once each; a tagged one is fine');
  } finally { setupTree = normalizeSetup({}); setupRev++; }
});

test('Notice board and Restore points are information, not chores; denied restore nodes are a warning', () => {
  assert.deepEqual([hubStatus('notice', clView()).mark, hubStatus('notice', clView()).word, hubStatus('notice', clView()).summary], ['info', 'Draft', 'Nothing written yet']);
  assert.equal(hubStatus('notice', clView({ notice: { status: 'draft', has: true } })).summary, 'Not on anyone’s phone yet');
  const posted = hubStatus('notice', clView({ notice: { status: 'posted', has: true } }));
  assert.deepEqual([posted.word, posted.summary], ['Posted', 'On every phone']);
  assert.equal(hubStatus('restore', clView()).summary, 'Last saved 12 min ago');
  assert.equal(hubStatus('restore', clView({ restore: { status: 'ok', newestAt: 0, count: 0 } })).summary, 'None saved yet');
  assert.equal(hubStatus('restore', clView({ restore: { status: 'loading' } })).summary, 'Checking…');
  const denied = hubStatus('restore', clView({ restore: { status: 'denied' } }));
  assert.equal(denied.mark, 'warn');
  assert.deepEqual(denied.problems, ['Restore points can’t be saved yet — the database rules need updating']);
});

test('hubAgo and hubWeekRange read the way a person says them', () => {
  assert.equal(hubAgo(CL_NOW - 30000, CL_NOW), 'just now');
  assert.equal(hubAgo(CL_NOW - 12 * 60000, CL_NOW), '12 min ago');
  assert.equal(hubAgo(CL_NOW - 3 * 3600000, CL_NOW), '3 h ago');
  assert.equal(hubAgo(CL_NOW - 2 * 86400000, CL_NOW), '2 days ago');
  assert.equal(hubAgo(CL_NOW - 86400000, CL_NOW), '24 h ago'.replace('24 h', '1 day'));
  assert.equal(hubWeekRange('2027-07-18'), 'Sun Jul 18 – Sat Jul 24');
  assert.equal(hubWeekRange('2027-02-31'), '', 'a date that cannot exist');
  assert.equal(hubWeekRange('soon'), '');
});

// ── The model: the headline, what is next, the door ──
test('hubModel: "N of M ready" counts what can be judged, names the first thing to fix, leaves `soon` rows out', () => {
  const ok = hubModel(clView());
  assert.equal(ok.headline, '3 of 3 ready');
  assert.equal(ok.ready, 3);
  assert.equal(ok.total, 3);
  assert.equal(ok.next, '');
  // (Campers has its screen now, so no counted row is still waiting: the plain sentence. Step 25, session 3.)
  assert.equal(ok.lede, 'Everything is ready.');
  assert.equal(ok.kicker, 'Set up the week · ' + CAMP.label);
  const v = clView();
  const bad = hubModel(clView({ teams: clTeams(CAMP.teamCount).map((t, i) => (i === 0 ? Object.assign({}, t, { name: '' }) : t)), members: v.members.filter((m) => m.teamId !== 't1') }));
  assert.equal(bad.headline, '1 of 3 ready');
  assert.equal(bad.next, 'teams', 'the first warning in the list order');
  assert.equal(bad.lede, 'Next: Teams');
  const skipAll = hubModel(clView({ games: [], days: [], teams: clTeams(CAMP.teamCount), skip: {} }));
  assert.equal(skipAll.next, 'games', 'a warning outranks nothing-to-do');
  const withElectives = hubModel(clView({ electives: true }));
  assert.equal(withElectives.total, 3, 'electives is `soon` for now, so it joins no total');
  assert.ok(HUB_COUNTED.indexOf('electives') !== -1);
});

test('the front door: one at a time, in the spec\'s order; a button only with an action behind it', () => {
  // 1 — a camp week is running (outranks everything), with the rain-plan line only when the schedule is edited here
  const run = hubDoor(clView({ weekRunning: true, newYearDue: true }));
  assert.equal(run.door, 'running');
  assert.equal(run.lead, 'Camp week in progress — the new-year setup is locked.');
  assert.equal(run.text, '');
  assert.equal(hubDoor(clView({ weekRunning: true, on: { schedule: true } })).text, 'Rain plans and small edits are fine.');
  assert.equal(run.ownerButton, '');
  // 2 — the new year is due
  const ny = hubDoor(clView({ newYearDue: true, nextYear: '2027' }));
  assert.equal(ny.door, 'new-year');
  assert.equal(ny.lead, 'Getting ready for 2027?');
  // 3 — nothing edited here yet
  const orig = hubDoor(clView());
  assert.equal(orig.door, 'original');
  assert.equal(orig.lead, 'This camp is still using the original week.');
  assert.equal(hubDoor(clView({ on: { meals: true } })), null, 'once anything is edited here there is no door');
});

test('owner-only contract: with no action behind a door nobody is offered a button or told "Patrick turns on editing"', () => {
  const d = hubDoor(clView());
  assert.equal(d.ownerButton, '');
  assert.equal(d.ownerText, '');
  assert.ok(/comes in the next update/.test(d.text), 'it just says what is true');
  const ny = hubDoor(clView({ newYearDue: true }));
  assert.equal(ny.ownerButton, '');
  assert.equal(ny.ownerText, '');
});

test('owner-only contract: with the action built, the owner gets the button and every other director the same sentence with the owner\'s name', () => {
  const door = hubDoor(clView({ doorActions: { original: true, 'new-year': true } }));
  assert.equal(door.ownerButton, 'Edit the week here');
  assert.equal(door.ownerText, 'Patrick turns on editing.');
  assert.ok(/Turning on editing changes nothing anyone can see until someone edits something/.test(door.text));
  const ny = hubDoor(clView({ newYearDue: true, nextYear: '2027', doorActions: { 'new-year': true } }));
  assert.equal(ny.ownerButton, 'Start the new-year setup');
  assert.equal(ny.ownerText, 'Patrick starts the new-year setup.');
  assert.equal(hubDoor(clView({ ownerName: 'the owner', doorActions: { original: true } })).ownerText, 'The owner turns on editing.', 'until the directory has loaded');
});

// ── hubView: what the page itself says, through the real globals ──
test('hubView reads the live page: the camp\'s own games, teams, members and the notice', () => {
  freshState();
  setMemberRole('editor');
  memberDirectory = { 'a@x': { role: 'viewer', name: 'Ann', teamId: 't0', addedBy: 'o', addedAt: 1 }, 'pending-sam-abc12': { role: 'viewer', name: 'Sam' } };
  memberDirectoryLoaded = true;
  try {
    const v = hubView();
    assert.equal(v.teamCount, CAMP.teamCount);
    assert.equal(v.electives, !!CAMP.features.electives);
    assert.equal(v.games.length, allGames().length);
    assert.equal(v.members.length, 2);
    assert.equal(v.members.find((m) => m.key === 'pending-sam-abc12').pending, true);
    assert.equal(v.membersLoaded, true);
    assert.equal(v.isOwner, false);
    assert.equal(v.notice.status, 'draft', 'the seeded notice is a draft');
    const model = hubModel(v);
    assert.ok(/^\d+ of \d+ ready$/.test(model.headline), model.headline);
    assert.equal(model.rows.people.mark, 'warn', 'most teams have no counselor account in this member list');
  } finally { setMemberRole(null); memberDirectory = null; memberDirectoryLoaded = false; }
});

test('the junior hub counts electives only where the camp has them', () => {
  assert.equal(!!CAMP.features.electives, CAMP.id === 'junior');
  assert.equal(HUB_ROW_KEYS.length, 13);
  assert.ok(HUB_ROW_KEYS.every((k) => HUB_LABELS[k]), 'every row has its plain name');
  Object.keys(HUB_OPENS).forEach((k) => assert.ok(HUB_ROW_KEYS.indexOf(k) !== -1, k + ' is a real row'));
});

// ── The markup this model feeds (index.html is the contract) ──
test('every hub row the model names exists in the markup with its five parts, and a row that opens something is a <button>', () => {
  HUB_ROW_KEYS.forEach((k) => {
    const m = new RegExp('<(button|div)[^>]*data-hub-row="' + k + '"[^>]*>([\\s\\S]*?)</\\1>').exec(INDEX_HTML);
    assert.ok(m, k + ' row is in index.html');
    ['data-hub-summary', 'data-hub-problem', 'data-hub-mark', 'data-hub-word'].forEach((a) => assert.ok(m[0].indexOf(a) !== -1, k + ' has ' + a));
    assert.equal(m[1] === 'button', !!HUB_OPENS[k], k + (HUB_OPENS[k] ? ' opens a screen, so it is a button' : ' has no screen yet, so it is a plain div, never a dead button'));
  });
});

test('a row that is still loading (People) is not counted either way, and a device with no database says what restore points need', () => {
  const m = hubModel(clView({ membersLoaded: false }));
  assert.equal(m.total, 2, 'Games and Teams only: People says "Loading the list…" and is neither ready nor a problem');
  assert.equal(m.headline, '2 of 2 ready');
  assert.equal(hubStatus('restore', clView({ restore: { status: 'nosync' } })).summary, 'Needs the camp database');
  assert.equal(hubStatus('restore', clView({ restore: { status: 'offline' } })).summary, 'Needs a connection');
});

// ── Campers (Step 25, session 3): minors' names are read only while a camper-showing screen holds the listener, so the row says
// "Loading…" until the list arrives and only ever carries counts ──
test('Campers: loading until the list arrives, todo with none, a count when there are some, a team with none is a note once any exist', () => {
  assert.deepEqual([hubStatus('campers', clView()).mark, hubStatus('campers', clView()).summary], ['info', 'Loading…'], 'no view of the list yet');
  assert.equal(hubStatus('campers', clView({ campers: { status: 'nosync' } })).summary, 'Needs the camp database');
  assert.equal(hubStatus('campers', clView({ campers: { status: 'denied' } })).summary, 'Not available yet');
  const none = hubStatus('campers', clView({ campers: { status: 'ok', total: 0, empty: [] } }));
  assert.deepEqual([none.mark, none.summary, none.problems.length], ['todo', 'No campers yet', 0]);
  const some = hubStatus('campers', clView({ campers: { status: 'ok', total: 64, empty: [] } }));
  assert.deepEqual([some.mark, some.summary], ['ok', '64 campers']);
  assert.equal(hubStatus('campers', clView({ campers: { status: 'ok', total: 1, empty: [] } })).summary, '1 camper');
  const gap = hubStatus('campers', clView({ campers: { status: 'ok', total: 12, empty: ['Maples'] } }));
  assert.deepEqual([gap.mark, gap.problems], ['warn', ['Maples has no campers yet']]);
  const skipped = hubStatus('campers', clView({ skip: { campers: true }, campers: { status: 'ok', total: 0, empty: [] } }));
  assert.equal(skipped.mark, 'skip', 'not using camper lists this year: a dash, never a warning');
  // the row counts toward "N of M ready" only once it can be judged
  assert.equal(hubModel(clView()).total, 3, 'loading is not counted');
  assert.equal(hubModel(clView({ campers: { status: 'ok', total: 64, empty: [] } })).total, 4);
});

// ── Step 28: the hub door for a new-year setup under way ──
test('a new-year setup under way is the hub door, for each of the three readers, ahead of the camp week and the original-week doors', () => {
  const w = (o) => hubDoor(clView({ ownerName: 'patrick', doorActions: { wizard: true, 'new-year': true }, weekRunning: true, wizard: Object.assign({ step: 4, year: '2027', idleMs: 0, canTakeOver: false }, o) }));
  const mine = w({ state: 'mine' });
  assert.deepEqual([mine.door, mine.ownerButton, mine.text], ['wizard', 'Carry on', 'Step 4 of 5']);
  const other = w({ state: 'other', idleMs: 5 * 60000 });
  assert.deepEqual([other.door, other.ownerButton, other.pair, other.takeover], ['wizard', '', true, false]);
  assert.equal(w({ state: 'other', canTakeOver: true }).takeover, true);
  const watching = w({ state: 'watching' });
  assert.equal(watching.lead, 'Patrick is setting up 2027 (step 4 of 5).');
  assert.equal(watching.ownerButton + watching.ownerText, '', 'another director reads, never presses');
  assert.equal(hubDoor(clView({ weekRunning: true, wizard: null })).door, 'running', 'no run: the camp week door as before');
});
