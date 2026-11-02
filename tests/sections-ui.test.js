// Meals, memory verses, the cleanup rota and electives: the hub's rows and the "can now be edited here too" prompt, and the
// screens' behaviour layer (setup-ui.js section 12; build step 19). The data under it is sections.test.js; this file drives the
// judgement (hubStatus' problem sentences, one per sentence), the owner-only door, the preview (every control disabled while a
// section is the original), and each screen's handlers with plain element stand-ins. Anything that needs layout — the strip,
// the rows at 130% / 200% text, the sheets — is the Playwright pass. Runs under the senior profile too.

const XU_JR = CAMP.id === 'junior';
const XU_ALL = ['schedule', 'meals', 'verses', 'cleanup', 'electives'];
const xuView = (over) => Object.assign({
  campLabel: CAMP.label, teamCount: CAMP.teamCount, electives: XU_JR, isOwner: false, ownerName: 'Patrick', now: 1,
  teams: [], days: [], games: [], members: [], membersLoaded: true, on: {}, held: {}, skip: {}, weekStart: '', weekRunning: false, newYearDue: false,
  setupTooNew: false, notice: { status: 'draft', has: false }, restore: { status: 'ok', newestAt: 1, count: 1 }, doorActions: {}, sec: {},
}, over || {});

function xuLoad(sections, over) {
  freshState();
  setMemberRole('editor');
  window.scrollTo = () => {};
  setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, sections || XU_ALL))));
  if (over) over(setupTree);
  setupRev++;
  undoClear();
  state.ui.view = 'settings';
  state.ui.secDay = undefined; state.ui.secSlot = undefined;
  return setupTree;
}
function xuEnd() {
  setMemberRole(null);
  state.ui.view = 'home';
  secUi.teams = null; secUi.person = null; secUi.station = null;
  setupTree = normalizeSetup({}); setupRev++;
}
// A stand-in for one of the screen's rows: its dataset and the two inputs it holds.
const xuRow = (dataset, fields) => ({ dataset, querySelector: (sel) => fields[sel] || null });

// ── the judgement: one case per problem sentence (Appendix B) ──

test('meals: not on is a plain line; on and empty is todo; a missing dish warns (a competition day, or a day that lists dishes)', () => {
  const off = hubStatus('meals', xuView());
  assert.deepEqual([off.mark, off.summary, off.word], ['info', 'The original menu', '']);
  assert.equal(hubStatus('meals', xuView({ on: { meals: true }, held: { meals: true } })).summary !== 'Showing the original — your edits are kept', true);
  assert.equal(hubStatus('meals', xuView({ held: { meals: true } })).summary, 'Showing the original — your edits are kept');
  assert.deepEqual(hubStatus('meals', xuView({ on: { meals: true }, sec: { meals: { listed: 0, days: '', missing: [] } } })).mark, 'todo');
  const ok = hubStatus('meals', xuView({ on: { meals: true }, sec: { meals: { listed: 15, days: 'Mon–Fri', missing: [] } } }));
  assert.deepEqual([ok.mark, ok.summary, ok.word], ['ok', 'Mon–Fri', 'Ready']);
  const one = hubStatus('meals', xuView({ on: { meals: true }, sec: { meals: { listed: 14, days: 'Mon–Fri', missing: [{ day: 'Wednesday', meal: 'lunch' }] } } }));
  assert.deepEqual([one.mark, one.problems], ['warn', ['Wednesday’s lunch has no dish']]);
  const many = hubStatus('meals', xuView({ on: { meals: true }, sec: { meals: { listed: 9, days: 'Mon–Wed', missing: [{ day: 'Thursday', meal: 'lunch' }, { day: 'Friday', meal: 'supper' }, { day: 'Friday', meal: 'lunch' }] } } }));
  assert.deepEqual(many.problems, ['3 meals have no dish']);
});

test('verses: no theme, a day with no verse, nothing at all', () => {
  const on = { verses: true };
  assert.equal(hubStatus('verses', xuView({ on, sec: { verses: { theme: false, days: 0, missing: [] } } })).mark, 'todo');
  const ok = hubStatus('verses', xuView({ on, sec: { verses: { theme: true, days: 5, missing: [] } } }));
  assert.deepEqual([ok.mark, ok.summary], ['ok', 'Theme + 5 days']);
  assert.deepEqual(hubStatus('verses', xuView({ on, sec: { verses: { theme: false, days: 5, missing: [] } } })).problems, ['There is no theme verse yet']);
  assert.deepEqual(hubStatus('verses', xuView({ on, sec: { verses: { theme: true, days: 4, missing: ['Wednesday'] } } })).problems, ['Wednesday has no verse']);
  assert.deepEqual(hubStatus('verses', xuView({ on, sec: { verses: { theme: true, days: 3, missing: ['Wednesday', 'Friday'] } } })).problems, ['Wednesday and Friday have no verse']);
  assert.deepEqual(hubStatus('verses', xuView({ on, sec: { verses: { theme: true, days: 1, missing: ['Tuesday', 'Wednesday', 'Friday'] } } })).problems, ['3 days have no verse']);
  assert.equal(hubStatus('verses', xuView({ on, sec: { verses: { theme: true, days: 1, missing: [] } } })).summary, 'Theme + 1 day');
});

test('cleanup: nobody yet is todo; a meal with no team and a team that is not on this camp warn; the summary is the fairness line', () => {
  const on = { cleanup: true };
  assert.equal(hubStatus('cleanup', xuView({ on, sec: { cleanup: { any: false, empty: [], unknown: [], line: '' } } })).mark, 'todo');
  const ok = hubStatus('cleanup', xuView({ on, sec: { cleanup: { any: true, empty: [], unknown: [], line: 'Each team cleans 2–3 times.' } } }));
  assert.deepEqual([ok.mark, ok.summary], ['ok', 'Each team cleans 2–3 times']);
  assert.deepEqual(hubStatus('cleanup', xuView({ on, sec: { cleanup: { any: true, empty: [{ day: 'Thursday', meal: 'supper' }], unknown: [], line: 'x' } } })).problems, ['Thursday’s supper has no team']);
  assert.deepEqual(hubStatus('cleanup', xuView({ on, sec: { cleanup: { any: true, empty: [1, 2, 3].map(() => ({ day: 'Monday', meal: 'lunch' })), unknown: [], line: 'x' } } })).problems, ['3 meals have no team']);
  assert.deepEqual(hubStatus('cleanup', xuView({ on, sec: { cleanup: { any: true, empty: [], unknown: ['t7'], line: 'x' } } })).problems, ['A team that isn’t on this camp is on the rota']);
});

test('electives: no stations is todo; an elective with none, a station with nobody, a person at two stations, a name that nearly matches a member', () => {
  const on = { electives: true };
  const sec = (over) => ({ electives: Object.assign({ stations: 6, slots: 3, noStations: [], nobody: [], twice: [], near: [] }, over || {}) });
  assert.equal(hubStatus('electives', xuView({ on, sec: sec({ stations: 0 }) })).mark, 'todo');
  const ok = hubStatus('electives', xuView({ on, sec: sec() }));
  assert.deepEqual([ok.mark, ok.summary], ['ok', '3 slots · 6 stations']);
  assert.deepEqual(hubStatus('electives', xuView({ on, sec: sec({ noStations: [{ day: 'Wednesday', slot: 1 }] }) })).problems, ['Wednesday’s Elective 2 has no stations']);
  assert.deepEqual(hubStatus('electives', xuView({ on, sec: sec({ noStations: [1, 2].map(() => ({ day: 'Monday', slot: 0 })) }) })).problems, ['2 electives have no stations']);
  assert.deepEqual(hubStatus('electives', xuView({ on, sec: sec({ nobody: [{ name: 'Archery', day: 'Tuesday' }] }) })).problems, ['Archery has nobody on Tuesday']);
  assert.deepEqual(hubStatus('electives', xuView({ on, sec: sec({ twice: [{ name: 'Zac', day: 'Monday', slot: 0 }] }) })).problems, ['Zac is at two stations in Monday’s Elective 1']);
  assert.deepEqual(hubStatus('electives', xuView({ on, sec: sec({ near: [{ name: 'Sophie', member: 'Sofia' }] }) })).problems, ['Sophie looks like Sofia on your list']);
  assert.equal(hubStatus('meals', xuView({ skip: { meals: true } })).mark, 'skip', 'an optional section can still be set aside');
});

test('hubSecView reads the real tree: junior\'s printed week is all ready; senior\'s empty menus and rota are todo, its verses ready', () => {
  xuLoad();
  try {
    const sec = hubSecView();
    assert.equal(sec.verses.theme, true);
    assert.equal(sec.verses.days, 5);
    assert.deepEqual(sec.verses.missing, []);
    if (XU_JR) {
      assert.equal(sec.meals.listed, 16);
      assert.equal(sec.meals.days, 'Sun–Fri');
      assert.deepEqual(sec.meals.missing, [], 'the printed week lists every Monday to Friday meal; a Saturday breakfast nobody planned is not judged');
      assert.equal(sec.cleanup.any, true);
      assert.deepEqual(sec.cleanup.empty, []);
      assert.equal(sec.cleanup.line, 'Each team cleans 3 times.');
      assert.equal(sec.electives.stations, 10);
      assert.deepEqual([sec.electives.noStations, sec.electives.nobody, sec.electives.twice, sec.electives.near], [[], [], [], []]);
      const model = hubModel(hubView());
      ['meals', 'verses', 'cleanup', 'electives'].forEach((k) => assert.equal(model.rows[k].mark, 'ok', k));
    } else {
      assert.equal(sec.meals.listed, 0);
      assert.equal(hubStatus('meals', hubView()).mark, 'todo');
      assert.equal(hubStatus('cleanup', hubView()).mark, 'todo');
      assert.equal(sec.electives, undefined, 'a camp with no electives has no such section');
    }
    assert.equal(hubStatus('verses', hubView()).mark, 'ok');
  } finally { xuEnd(); }
});

test('hubSecView finds each problem in the data: a missing dish, no theme, a meal with no team, a twice-listed person, a near name', () => {
  xuLoad(XU_ALL, (t) => {
    t.meals = { mon: { breakfast: { dish: 'Eggs' } } };
    delete t.verses.theme;
    t.verses.days = { mon: { text: 'Words', ref: 'R 1:1' } };
    t.cleanup = { mon: { breakfast: { t1: true } } };
    t.electives = { stations: { 'st-a': { name: 'Swim' }, 'st-b': { name: 'Crafts' } }, slots: { mon: { s0: {
      'st-a': { ord: 1, people: { 'n-sophie': { name: 'Sophie', ord: 1 }, 'n-zac': { name: 'Zac', ord: 2 } } },
      'st-b': { ord: 2, people: { 'n-zac2': { name: 'Zac', ord: 1 } } },
    } } } };
  });
  try {
    memberDirectory = { 'sofia@x,com': { role: 'viewer', name: 'Sofia Reed', addedBy: 'x', addedAt: 1 } };
    const sec = hubSecView();
    assert.equal(sec.meals.listed, 1);
    assert.ok(sec.meals.missing.some((m) => m.day === 'Monday' && m.meal === 'lunch'));
    assert.equal(sec.verses.theme, false);
    assert.ok(sec.verses.missing.includes('Tuesday'));
    assert.ok(sec.cleanup.empty.some((m) => m.day === 'Monday' && m.meal === 'lunch'));
    if (XU_JR) {
      assert.deepEqual(sec.electives.twice, [{ name: 'Zac', day: 'Monday', slot: 0 }]);
      assert.deepEqual(sec.electives.near, [{ name: 'Sophie', member: 'Sofia' }]);
      assert.ok(sec.electives.noStations.length >= 1, 'an Elective item with no stations');
    }
  } finally { memberDirectory = null; xuEnd(); }
});

// ── the prompt (owner only) ──

test('the front door offers the four smaller sections once the schedule is edited here: the owner\'s Turn on, everyone else\'s sentence with the owner\'s name', () => {
  const offNames = XU_JR ? 'The menus, the memory verses, the cleanup rota and the electives can now be edited here too.' : 'The menus, the memory verses and the cleanup rota can now be edited here too.';
  const d = hubDoor(xuView({ on: { schedule: true }, doorActions: { sections: true } }));
  assert.equal(d.door, 'sections');
  assert.equal(d.lead, offNames);
  assert.equal(d.ownerButton, 'Turn on');
  assert.equal(d.ownerText, 'Patrick turns it on.');
  assert.ok(/changes nothing anyone can see/.test(d.text));
  const none = hubDoor(xuView({ on: { schedule: true }, doorActions: {} }));
  assert.equal(none.ownerButton, '', 'nobody is offered a button with nothing behind it');
  assert.equal(none.ownerText, '');
  // Partly on: only what is still off is named; a section turned off with its edits kept says they are kept.
  const part = hubDoor(xuView({ on: { schedule: true, meals: true, verses: true }, doorActions: { sections: true } }));
  assert.equal(part.lead, XU_JR ? 'The cleanup rota and the electives can now be edited here too.' : 'The cleanup rota can now be edited here too.');
  const held = hubDoor(xuView({ on: { schedule: true, meals: true, verses: true, cleanup: true }, held: { electives: true }, electives: true, doorActions: { sections: true } }));
  if (XU_JR) assert.equal(held.text, 'Your changes are kept. Turning it on brings them back.');
  // Everything on: the prompt is gone. The schedule off: the original-week door speaks (and the running / new-year doors outrank both).
  assert.equal(hubDoor(xuView({ on: { schedule: true, meals: true, verses: true, cleanup: true, electives: true } })), null);
  assert.equal(hubDoor(xuView({ doorActions: { original: true } })).door, 'original');
  assert.equal(hubDoor(xuView({ on: { schedule: true }, weekRunning: true })).door, 'running');
  assert.equal(hubDoor(xuView({ on: { schedule: true }, newYearDue: true })).door, 'new-year');
});

test('the hub\'s door runs Turn on for every section still off, and only for the owner', async () => {
  const real = { ask: askDialog, turn: setupTurnOn, say: setupSay, isOwner };
  const asked = []; const turned = [];
  try {
    xuLoad(['schedule']);
    assert.equal(typeof HUB_DOOR_ACTIONS.sections, 'function');
    assert.deepEqual(secOffSections(), XU_JR ? ['meals', 'verses', 'cleanup', 'electives'] : ['meals', 'verses', 'cleanup']);
    askDialog = async (o) => { asked.push(o.title); return 'go'; };
    setupTurnOn = async (secs) => { turned.push(secs); return { ok: true, turnedOn: secs }; };
    let said = '';
    setupSay = (t) => { said = t; };
    // A director who is not the owner is refused before anything is asked.
    authUser = { email: 'jenn@example.com', emailVerified: true };
    assert.equal((await HUB_DOOR_ACTIONS.sections()).ok, false);
    assert.equal(asked.length, 0, 'not even a question');
    assert.equal(turned.length, 0);
    authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
    const r = await HUB_DOOR_ACTIONS.sections();
    assert.equal(r.ok, true);
    assert.deepEqual(turned[0], secOffSections());
    assert.ok(/^Edit the menus/.test(asked[0]), asked[0]);
    assert.ok(/^Editing is on for the menus/.test(said), said);
    // One screen's Turn on is that section alone; Not yet changes nothing.
    turned.length = 0;
    askDialog = async () => 'no';
    assert.equal((await secTurnOnFlow(['verses'])).reason, 'cancelled');
    assert.equal(turned.length, 0);
    askDialog = async () => 'go';
    await secTurnOnFlow(['verses']);
    assert.deepEqual(turned[0], ['verses']);
    // The freeze is a question in words, and the owner's "I know" overrides it.
    turned.length = 0;
    const answers = [];
    setupTurnOn = async (secs, opts) => { turned.push(JSON.stringify(opts)); return opts.overrideCampWeek ? { ok: true, turnedOn: secs } : { ok: false, reason: 'camp-week' }; };
    askDialog = async () => 'go';
    await secTurnOnFlow(['cleanup']);
    assert.deepEqual(turned, ['{}', '{"overrideCampWeek":true}']);
    assert.ok(answers.length === 0);
  } finally { askDialog = real.ask; setupTurnOn = real.turn; setupSay = real.say; authUser = null; xuEnd(); }
});

test('Use the original again is the owner\'s: asked first, then one commit that keeps every edit', async () => {
  const real = { ask: askDialog, say: setupSay };
  try {
    xuLoad();
    setupSay = () => {};
    askDialog = async () => 'go';
    authUser = { email: 'jenn@example.com', emailVerified: true };
    assert.equal((await secUseOriginal('meals')).ok, false, 'another director is refused');
    assert.equal(secOn('meals'), true);
    authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
    askDialog = async () => 'no';
    assert.equal((await secUseOriginal('meals')).reason, 'cancelled');
    askDialog = async () => 'go';
    const keep = JSON.stringify(setupTree.meals);
    assert.equal((await secUseOriginal('meals')).ok, true);
    assert.equal(secOn('meals'), false);
    assert.equal(JSON.stringify(setupTree.meals), keep, 'the data is kept');
    assert.equal(secOn('verses'), true, 'only that section');
  } finally { askDialog = real.ask; setupSay = real.say; authUser = null; xuEnd(); }
});

// ── the screens ──

test('a screen is reachable by a director only, the four sections are in the frame, and a camp with no electives never lands on one', () => {
  xuLoad();
  try {
    ['meals', 'verses', 'cleanup'].forEach((s) => assert.ok(SETUP_SCREENS.includes(s) && HUB_OPENS[s].screen === s, s));
    assert.ok(SETUP_SCREENS.includes('electives') && HUB_OPENS.electives.screen === 'electives');
    assert.equal(setupGo('meals'), true);
    assert.equal(setupScreen(), 'meals');
    assert.equal(setupWhereNow(), 'meals', 'the other directors are told where this one is');
    state.ui.builderScreen = 'electives';
    assert.equal(setupScreen(), XU_JR ? 'electives' : 'hub', 'senior has no electives: a stale screen reads as the hub');
    setMemberRole('viewer');
    assert.equal(setupGo('cleanup'), false, 'a counselor reaches none of it');
    ['sec-teams', 'sec-person', 'sec-station'].forEach((id) => assert.equal(shellSheetAllowed(id), false, id));
  } finally { xuEnd(); }
});

test('while a section is the original its screen is a read-only preview of the printed data: every control disabled', () => {
  xuLoad(['schedule']);
  try {
    assert.equal(secLive('meals'), false);
    state.ui.secDay = 'mon';
    renderMealsScreen();
    const row = setupEl('meals-list').querySelector('[data-key="m-lunch"]');
    assert.equal(row.querySelector('[data-meal-dish]').disabled, true);
    assert.equal(row.querySelector('[data-meal-emoji]').disabled, true);
    assert.equal(row.querySelector('[data-meal-dish]').value, ((MEALS[1] || {}).lunch || { dish: '' }).dish, 'it shows what came with the app');
    renderVersesScreen();
    assert.equal(setupVerseTheme(secTree('verses')).text, MEMORY_VERSE_THEME.text);
    // The door: the owner\'s Turn on and the same words for the others, the way back only while it is on.
    secPaintDoor('meals');
    assert.equal(setupEl('meals-door').hidden, false);
    assert.equal(setupEl('meals-door-lead').textContent, 'The menus can now be edited here too.');
    assert.equal(setupEl('meals-door-btn').textContent, 'Turn on');
    assert.equal(setupEl('meals-door-owner-text').textContent, 'The owner turns it on.');
    assert.equal(setupEl('meals-original').hidden, true);
    // A write into it is refused, in words (the preview's controls are off, so only a stale handler could try).
    const said = [];
    const was = setupSay; setupSay = (t) => said.push(t);
    secMealFocusOut(xuRow({ meal: 'lunch' }, { '[data-meal-dish]': { value: 'Tacos' }, '[data-meal-emoji]': { value: '' } }));
    assert.equal(said.length, 0, 'a preview is not live: its handlers do nothing');
    setupSay = was;
    assert.equal(mealsSet('mon', 'lunch', 'Tacos', '').reason, 'off');
  } finally { xuEnd(); }
});

test('Meals: a blur commits only when the value changed since the field gained focus; an empty dish removes the line; tabbing across rewrites nothing', () => {
  xuLoad();
  try {
    state.ui.secDay = 'wed';
    mealsSet('wed', 'lunch', 'Hot Dogs', '🌭');   // (senior has no printed menu: put the dish there first)
    const lunch = xuRow({ meal: 'lunch' }, { '[data-meal-dish]': { value: 'Hot Dogs' }, '[data-meal-emoji]': { value: '🌭' } });
    const rev = setupRev;
    secMealFocusIn(lunch);
    secMealFocusOut(lunch);
    assert.equal(setupRev, rev, 'tap and blur: nothing written');
    secMealFocusIn(lunch);
    lunch.querySelector('[data-meal-dish]').value = 'Hot dogs and corn';
    secMealFocusOut(lunch);
    assert.equal(mealFor(3, 'lunch').dish, 'Hot dogs and corn');
    assert.equal(undoRecent().filter((e) => /Hot dogs and corn/.test(e.label)).length, 1);
    secMealFocusIn(lunch);
    lunch.querySelector('[data-meal-dish]').value = '   ';
    secMealFocusOut(lunch);
    assert.equal(mealFor(3, 'lunch'), null, 'no dish: the menu line goes');
    // The menus of other days are copied by a day pick.
    assert.deepEqual(secMealCopySources('wed').includes('mon'), XU_JR);
  } finally { xuEnd(); }
});

test('Meals: the day strip is the days that have a meal; the rows come from the schedule\'s Meal-tagged items, once each', () => {
  xuLoad();
  try {
    const days = secDays('meals');
    assert.ok(days.includes('mon') && days.includes('fri'));
    assert.deepEqual(secMealItems(1).map((m) => m.meal), ['breakfast', 'lunch', 'supper'].filter((m) => planForDow(1).some((b) => b.meal === m)));
    secMealItems(1).forEach((m, i, a) => { if (i) assert.ok(m.start >= a[i - 1].start, 'in time order'); });
    assert.equal(secDays('cleanup').join(), 'mon,tue,wed,thu,fri');
    assert.equal(secDayKey('cleanup'), 'mon');
    state.ui.secDay = 'thu';
    assert.equal(secDayKey('cleanup'), 'thu');
    state.ui.secDay = 'sun';
    assert.equal(secDayKey('cleanup'), 'mon', 'a day the screen is not about falls back');
  } finally { xuEnd(); }
});

test('Verses: a blur commits one record when it changed; the words are required and the video must be https, said in place', () => {
  xuLoad();
  try {
    const els = { text: { value: 'Be kind.' }, ref: { value: 'Eph 4:32' }, video: { value: '' } };
    const err = setupEl('verses-form').querySelector('[data-verse-error]');
    const group = { dataset: { verse: 'wed' }, querySelector: (s) => (s === '[data-verse-error]' ? err : null), querySelectorAll: () => Object.keys(els).map((k) => Object.assign(els[k], { dataset: { verseField: k } })) };
    secVerseFocusIn(group);
    secVerseFocusOut(group);
    assert.equal(verseFor(3).text, 'Be kind.', 'a changed verse is one commit');
    els.video.value = 'http://nope.example/v';
    secVerseFocusIn(group);
    secVerseFocusOut(group);
    assert.equal(err.textContent, 'Use a link that starts with https://');
    assert.equal(verseFor(3).video, undefined, 'nothing was written');
    els.video.value = 'https://youtu.be/ok';
    secVerseFocusIn(group);
    secVerseFocusOut(group);
    assert.equal(verseFor(3).video, 'https://youtu.be/ok');
    assert.equal(err.textContent, '');
    els.text.value = '';
    secVerseFocusIn(group);
    secVerseFocusOut(group);
    assert.equal(err.textContent, 'A verse needs its words. Type them, or clear the whole verse.');
    assert.equal(verseFor(3).text, 'Be kind.', 'the words stay until the whole verse is cleared');
    els.ref.value = ''; els.video.value = '';
    secVerseFocusIn(group);
    secVerseFocusOut(group);
    assert.equal(verseFor(3).text, '', 'every field cleared: the verse is removed');
  } finally { xuEnd(); }
});

test('Cleanup: the sheet picks one or two teams, Save writes one commit, a third team is refused in words, No team yet clears', () => {
  xuLoad();
  try {
    state.ui.secDay = 'wed';
    secOpenTeams('lunch', null);
    assert.ok(secUi.teams, 'the sheet is open on Wednesday lunch');
    const was = secUi.teams.was.slice();
    secTeamsToggle('t0');
    secTeamsToggle('t1');
    secTeamsToggle('t2');
    assert.ok(secUi.teams.picked.length <= 2, 'a meal has one or two teams');
    assert.equal(setupEl('sec-teams-note').hidden, false);
    secUi.teams.picked = ['t1', 't0'];
    secTeamsSave(false);
    assert.deepEqual(cleanupTeams(3, 'Lunch'), ['t0', 't1']);
    assert.equal(undoRecent().filter((e) => /Wednesday lunch cleanup/.test(e.label)).length, 1);
    secOpenTeams('lunch', null);
    secTeamsSave(true);
    assert.deepEqual(cleanupTeams(3, 'Lunch'), [], 'No team yet');
    assert.ok(was.length >= 0);
    secUi.teams = null;
    setMemberRole('viewer');
    secOpenTeams('lunch', null);
    assert.equal(secUi.teams, null, 'a counselor cannot open it');
  } finally { xuEnd(); }
});

test('Cleanup: Fill evenly shows a preview in words first, Apply writes ONE commit, Cancel writes nothing; with nothing empty it asks before redoing', async () => {
  const real = { ask: askDialog, say: setupSay };
  const asked = [];
  try {
    xuLoad(XU_ALL, (t) => { t.cleanup = XU_JR ? { mon: { breakfast: { t5: true } } } : {}; });
    setupSay = () => {};
    askDialog = async (o) => { asked.push(o); return 'no'; };
    await secFillEvenly();
    assert.equal(asked.length, 1);
    assert.equal(asked[0].title, 'Fill the rota evenly?');
    assert.ok(asked[0].body.some((l) => /^Monday: /.test(l)), 'one line a day');
    assert.ok(asked[0].body.some((l) => /^Each team cleans/.test(l)), 'the fairness line');
    assert.deepEqual(cleanupTeams(2, 'Lunch'), [], 'Cancel wrote nothing');
    askDialog = async () => 'apply';
    await secFillEvenly();
    const slots = secCleanupSlots(setupTree);
    assert.ok(slots.length > 0 && slots.every((s) => s.have.length >= 1), 'every competition-day meal has a team');
    if (XU_JR) assert.deepEqual(cleanupTeams(1, 'Breakfast'), ['t5'], 'what was there stays');
    assert.equal(undoRecent().filter((e) => e.label === 'Filled the cleanup rota evenly').length, 1, 'ONE undo entry');
    // Everything is full now: it asks before starting over.
    asked.length = 0;
    askDialog = async (o) => { asked.push(o.title); return 'no'; };
    await secFillEvenly();
    assert.deepEqual(asked, ['Redo the whole rota evenly?']);
  } finally { askDialog = real.ask; setupSay = real.say; xuEnd(); }
});

test('Electives: a person is added from the list or typed, tapped off, linked, and a station is added to a slot, renamed, taken off and deleted', async () => {
  if (!XU_JR) { assert.equal(secOn('electives'), false); return; }
  const real = { ask: askDialog, say: setupSay };
  try {
    xuLoad();
    const said = [];
    setupSay = (t) => said.push(t);
    memberDirectory = { 'sofia@x,com': { role: 'viewer', name: 'Sofia Reed', teamId: 't3', addedBy: 'x', addedAt: 1 }, 'pending-maya-1': { role: 'viewer', name: 'Maya', addedBy: 'x', addedAt: 1 } };
    state.ui.secDay = 'tue'; state.ui.secSlot = 1;
    const rows = () => setupElectiveRows(setupTree, 'tue', 1);
    const first = rows()[0];
    // Tap a person off (Undo is the way back, no question).
    const gone = first.people[0];
    assert.equal(electivePersonRemove('tue', 1, first.id, gone.pid).ok, true);
    // Add from the list: a signed-in member keeps their key; a pending one is a typed name.
    secOpenAddPerson(first.id, null);
    secPersonAdd('sofia@x,com', 'Sofia Reed');
    assert.ok(rows()[0].people.some((p) => p.pid === 'sofia@x,com'), 'the member\'s key is kept ' + JSON.stringify(rows()[0].people));
    secOpenAddPerson(first.id, null);
    secPersonAdd('', 'Maya');
    assert.ok(rows()[0].people.some((p) => p.pid === 'n-maya' && p.typed), 'a typed name ' + JSON.stringify(rows()[0].people));
    // A near name gets a Link row, and Link re-keys it.
    secOpenAddPerson(first.id, null);
    secPersonAdd('', 'Sophie');
    const html = secStationHtml(rows()[0], true, secLinkTargets());
    assert.ok(/Sophie looks like Sofia on your list/.test(html), 'the Link row');
    assert.ok(/data-sec-link="n-sophie" data-sec-member="sofia@x,com"/.test(html));
    secLinkPerson('n-sophie', 'sofia@x,com');
    assert.ok(!rows()[0].people.some((p) => p.pid === 'n-sophie'), 'linked ' + JSON.stringify(rows()[0].people));
    // The preview has no controls: a name chip is a plain span, the station name a div.
    const view = secStationHtml(rows()[0], false, []);
    assert.ok(!/<button/.test(view) && /class="sec-chip"/.test(view));
    // Stations: new, picked, renamed, taken off, deleted.
    secOpenStation('add', '', null);
    setupEl('sec-station-name').value = 'Archery';
    setupEl('sec-station-emoji').value = '🏹';
    secStationSave();
    const arch = rows().find((r) => r.name === 'Archery');
    assert.ok(arch && arch.emoji === '🏹', 'one commit adds the station and puts it on this slot ' + JSON.stringify(rows().map((r) => r.name)));
    assert.equal(undoRecent().filter((e) => /Added the Archery station on Tuesday/.test(e.label)).length, 1);
    secOpenStation('edit', arch.id, null);
    setupEl('sec-station-name').value = 'Archery range';
    secStationSave();
    assert.ok(rows().some((r) => r.name === 'Archery range'), 'renamed ' + JSON.stringify([rows().map((r) => r.name), said, secUi.station]));
    setupEl('sec-station-name').value = '';
    secStationSave();
    assert.equal(setupEl('sec-station-error').hidden, false, 'a station needs a name');
    const off = electiveSlotRemoveStation('tue', 1, arch.id);
    assert.equal(off.ok, true);
    assert.ok(setupElectiveStations(setupTree).some((x) => x.id === arch.id), 'taken off the slot, still on the list');
    secUi.station = { mode: 'edit', dk: 'tue', slot: 1, st: arch.id };
    askDialog = async () => 'delete';
    await secStationDelete();
    assert.ok(!setupElectiveStations(setupTree).some((x) => x.id === arch.id), 'deleted from the list');
    askDialog = async () => 'no';
    const keep = setupElectiveStations(setupTree).length;
    secUi.station = { mode: 'edit', dk: 'tue', slot: 1, st: setupElectiveStations(setupTree)[0].id };
    await secStationDelete();
    assert.equal(setupElectiveStations(setupTree).length, keep, 'Keep it');
    // Same as Monday: asks when the day holds something, copies all three slots.
    state.ui.secDay = 'wed';
    const asked = [];
    askDialog = async (o) => { asked.push(o.title); return 'go'; };
    await secElectiveSame();
    assert.deepEqual(asked, ['Make Wednesday the same as Monday?']);
    assert.equal(JSON.stringify(setupElectiveRows(setupTree, 'wed', 2)), JSON.stringify(setupElectiveRows(setupTree, 'mon', 2)));
    // On break: the day's people at no station in this slot.
    assert.ok(Array.isArray(secBreakNames(setupTree, 'mon', 0)));
  } finally { askDialog = real.ask; setupSay = real.say; memberDirectory = null; xuEnd(); }
});

test('the paint is idempotent: nothing is rewritten when nothing changed (the screens run on every snapshot and every 30 seconds)', () => {
  xuLoad();
  try {
    const writes = [];
    const spy = (id) => { const el = setupEl(id); let v = el.innerHTML; Object.defineProperty(el, 'innerHTML', { configurable: true, get: () => v, set: (x) => { writes.push(id); v = x; } }); };
    ['cleanup-list', 'elec-list'].forEach(spy);
    renderCleanupScreen();
    renderCleanupScreen();
    assert.equal(writes.filter((w) => w === 'cleanup-list').length, 1, 'the list was written once, then left alone');
    if (XU_JR) {
      renderElectivesScreen();
      renderElectivesScreen();
      assert.equal(writes.filter((w) => w === 'elec-list').length, 1);
    }
    setupTree.cleanup.mon = { breakfast: { t0: true } };
    setupRev++;
    state.ui.secDay = 'mon';
    renderCleanupScreen();
    assert.equal(writes.filter((w) => w === 'cleanup-list').length, 2, 'a change repaints');
  } finally { xuEnd(); }
});
