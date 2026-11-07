// The new-year setup's SCREENS (setup-ui.js §17, Step 28 session 2) over the engine wizard.test.js covers: who may see them, the
// steps walked with the real engine against the in-memory database, the claim's three views, the hub door, Undo, Advanced's re-seed
// and the past-year sheet. The rules for all of it are proven in tests/emulator/wizard-client.mjs. Under the senior profile too.

// The helpers of wizard.test.js (everything above its first case), so this file has the same database and the same last year.
const WZ_SRC = readFixture('wizard.test.js');
// (`const` would stay inside the eval: the helpers' top-level constants become `var`s so this file sees them)
eval(WZ_SRC.slice(0, WZ_SRC.indexOf('// ── pure pieces')).replace(/^const /gm, 'var '));

const nywEl = (id) => document.getElementById(id);
const nywStep = async (n) => { await waitUntil(() => nywModelNow() && nywModelNow().step === n, 'the wizard to reach step ' + n); };
function nywReset() { Object.assign(nywUi, { watching: false, typed: '', ask: null, save: { state: 'idle', res: null, why: '' }, clear: { state: 'idle', why: '', reveal: false }, members: null, membersAsked: false, done: null, doneLeft: false, a1Ran: false, claim: null, claimAt: 0, freeze: {}, undo: null, staffOpen: false, lastStep: 0, lastMode: '' }); state.ui.builderScreen = undefined; }

test('pure pieces: the nearest Sunday, the double window in words, the month line, the tally row escapes its words', () => {
  assert.equal(nywSundayNear('2027-07-19'), '2027-07-18', 'Monday goes back');
  assert.equal(nywSundayNear('2027-07-21'), '2027-07-18', 'Wednesday goes back');
  assert.equal(nywSundayNear('2027-07-22'), '2027-07-25', 'Thursday goes forward');
  assert.equal(nywSundayNear('2027-07-18'), '2027-07-18');
  assert.equal(nywSundayNear('nope'), '');
  assert.equal(nywDoubleWords({ fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 }), 'Thursday 5:00 PM until the end of Friday');
  assert.equal(nywDoubleWords({ fromDow: 3, fromMin: 600, toDow: 4, toMin: 780 }), 'Wednesday 10:00 AM until Thursday 1:00 PM');
  assert.equal(nywDoubleWords({ fromDow: 4, fromMin: 600, toDow: 3, toMin: 0 }), '');
  assert.equal(nywMonthWords('2027-07-18'), 'July 2027');
  assert.equal(nywMonthWords('2027-08-29'), 'August – September 2027');
  const row = nywTallyRow('x', 3, '<b>games</b>', '"sub" & more');
  assert.ok(!/<b>/.test(row) && /&lt;b&gt;games/.test(row) && /&quot;sub&quot;|&amp;/.test(row), row);
  assert.ok(/data-mark="check"/.test(nywTallyRow('y', { mark: 'check' }, 'done', '')));
  assert.equal(nywNextWhy({ step: 1 }, { weekStart: '' }), 'Pick the Sunday camp starts');
  assert.equal(nywNextWhy({ step: 1 }, { weekStart: '2027-07-18' }), '');
});

test('the hub door: a run under way outranks the rest; the driving device carries on, the other watches, everyone else reads a sentence', () => {
  const base = { ownerName: 'Patrick', doorActions: { wizard: true, 'new-year': true } };
  const mine = hubDoor(Object.assign({}, base, { wizard: { state: 'mine', step: 3, year: '2027' } }));
  assert.equal(mine.door, 'wizard');
  assert.equal(mine.ownerButton, 'Carry on');
  assert.equal(mine.text, 'Step 3 of 5');
  const other = hubDoor(Object.assign({}, base, { wizard: { state: 'other', step: 3, year: '2027', idleMs: 240000, canTakeOver: false }, weekRunning: true }));
  assert.equal(other.door, 'wizard', 'ahead of the camp-week door');
  assert.equal(other.pair, true);
  assert.equal(other.takeover, false);
  assert.ok(/another device/.test(other.lead) && /Step 3 of 5 · last tap 4 min ago/.test(other.text), JSON.stringify(other));
  assert.equal(hubDoor(Object.assign({}, base, { wizard: { state: 'other', step: 3, year: '2027', idleMs: 20 * 60000, canTakeOver: true } })).takeover, true);
  const watching = hubDoor(Object.assign({}, base, { wizard: { state: 'watching', step: 2, year: '2027' } }));
  assert.equal(watching.ownerButton, '');
  assert.equal(watching.pair, false);
  assert.equal(watching.lead, 'Patrick is setting up 2027 (step 2 of 5).');
  assert.ok(/before Patrick finishes/.test(watching.text));
  assert.equal(hubDoor(Object.assign({}, base, { wizard: null, newYearDue: true, nextYear: '2027' })).ownerButton, 'Start the new-year setup');
});

test('the owner alone: another director and a counselor read the hub for the wizard screen and every entry refuses before a write', async () => {
  const db = await wzSetup({ user: WZ_JENN, role: 'editor' });
  try {
    nywReset();
    state.ui.builderScreen = 'wizard';
    assert.equal(setupScreen(), 'hub', 'a stored wizard screen is the hub for a plain director');
    const from = db.log.length;
    assert.equal((await nywStart()).reason, 'owner');
    assert.equal((await setupRestartSection('meals', {})).reason, 'owner');
    nywOpenUndo();
    assert.equal(nywUi.undo, null, 'no Undo sheet for anyone but the owner');
    assert.equal(db.log.length, from, 'nothing was written');
    db.serverSet(dbPath('setup/meta/wizard'), { step: 3, byKey: OWNER_MEMBER_KEY, at: Date.now(), fromEpoch: 'legacy', answers: JSON.stringify({ dev: 'owner-device-1' }) });
    await waitUntil(() => wizardClaimOf(setupTree), 'the claim to arrive');
    assert.equal(nywMayShow(), false, 'watching is the hub door\'s sentence, never the screen');
    const v = nywDoorView();
    assert.equal(v.state, 'watching');
    assert.equal(hubDoor({ ownerName: 'Patrick', wizard: v }).lead.indexOf('Patrick is setting up'), 0);
  } finally { nywReset(); wzTeardown(); }
});

test('the whole walk on screen: Start, a date, what carries over, save and check 2026, hold to clear, the done list, leave', async () => {
  const db = await wzSetup();
  const realConfirm = confirm;
  try {
    nywReset();
    confirm = () => true; // "No, it's not" is the question's main action when no camp dates are set
    const r = await nywStart();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(state.ui.builderScreen, 'wizard');
    await nywStep(1);
    assert.equal(setupScreen(), 'wizard');
    renderNywScreen();
    assert.equal(nywEl('setup-wizard').dataset.step, '1');
    assert.equal(nywEl('setup-wizard').dataset.drive, 'me');
    assert.equal(nywEl('nyw-count').textContent, 'Step 1 of 5');
    assert.equal(nywEl('nyw-headline').textContent, 'When is camp?');
    assert.equal(nywEl('nyw-next').textContent, 'Pick the Sunday camp starts', 'no date: the dashed well names what is missing');
    // a Tuesday is a nudge, never an answer
    nywSetDate('2027-07-20');
    assert.equal(wizardAnswers().weekStart, '');
    assert.equal(nywUi.typed, '2027-07-20');
    renderNywScreen();
    assert.equal(nywEl('nyw-snap').hidden, false);
    assert.equal(nywEl('nyw-snap-use').dataset.sunday, '2027-07-18');
    nywSetDate('2027-07-18');
    assert.equal(wizardAnswers().weekStart, '2027-07-18');
    assert.equal(nywUi.typed, '');
    renderNywScreen();
    assert.equal(nywEl('nyw-snap').hidden, true);
    assert.equal(nywEl('nyw-sec-week').hidden, false);
    assert.equal(nywEl('nyw-week-month').textContent, 'July 2027');
    assert.equal(nywEl('nyw-next').textContent, 'Next: what carries over');
    // double points: three choices; "change" opens the form with last year's window
    nywSetDouble('none'); assert.equal(wizardAnswers().double, 'none');
    nywSetDouble('same'); assert.equal(wizardAnswers().double, 'same');
    nywSetDouble('change'); assert.equal(wizardDoubleOk(wizardAnswers().double), true);
    nywSetDouble('same');
    await nywNext();
    await nywStep(2);
    renderNywScreen();
    assert.equal(nywEl('nyw-headline').textContent.indexOf('What carries over from'), 0);
    nywPick('meals', 'keep');
    assert.equal(wizardAnswers().carry.meals, 'keep');
    nywPick('bogus', 'keep'); nywPick('meals', 'maybe');
    assert.equal(wizardAnswers().carry.meals, 'keep', 'a junk tap writes nothing');
    await nywNext();
    await nywStep(3);
    renderNywScreen(); // arriving on step 3 saves and checks last year by itself
    await waitUntil(() => nywUi.save.state === 'saved', 'the copy to be saved and checked');
    renderNywScreen();
    assert.equal(nywEl('nyw-save-state').dataset.tone, 'saved');
    assert.ok(/results|game result/.test(nywEl('nyw-saved-list').innerHTML) || nywEl('nyw-saved-list').innerHTML.length > 0);
    assert.equal(nywEl('nyw-next').textContent, 'Next: clear the scoreboard');
    await waitUntil(() => wizardModel().claim && wizardModel().claim.archiveId, 'the archive id in the claim');
    await nywNext();
    await nywStep(4);
    renderNywScreen();
    await waitUntil(() => nywUi.members, 'the member preflight');
    renderNywScreen();
    assert.equal(nywEl('nyw-hold-btn').hidden, false, 'step 4 is the hold button alone');
    assert.equal(nywEl('nyw-hold-confirm').hidden, true);
    assert.ok(/game result/.test(nywEl('nyw-clear-list').innerHTML) && /data-key="campers-all"/.test(nywEl('nyw-clear-list').innerHTML), 'camper names are always named in the clear list (the count once held, else in words): ' + nywEl('nyw-clear-list').innerHTML);
    assert.ok(/counselors? taken off/.test(nywEl('nyw-clear-list').innerHTML), 'the members that will move: ' + nywEl('nyw-clear-list').innerHTML);
    assert.equal(nywEl('nyw-members-warn').hidden, false, 'the incomplete sign-in is named before the hold');
    // a tap reveals the two-tap alternative in the hold's place
    nywUi.clear.reveal = true; renderNywScreen();
    assert.equal(nywEl('nyw-hold-btn').hidden, true);
    assert.equal(nywEl('nyw-hold-confirm').hidden, false);
    nywUi.clear.reveal = false;
    nywUi.freeze = { campRunning: false };
    await nywRunClear();
    assert.equal(nywUi.done && nywUi.done.ok, true, JSON.stringify(nywUi.done) + JSON.stringify(nywUi.clear));
    assert.equal(state.meta.epoch.indexOf('w'), 0, 'the new year is in');
    assert.equal(nywModelNow().step, 5);
    renderNywScreen();
    assert.equal(nywEl('setup-wizard').dataset.step, '5');
    assert.ok(/Scoreboard cleared/.test(nywEl('nyw-done-list').innerHTML));
    assert.ok(/Broken/.test(nywEl('nyw-left-list').innerHTML), 'the member the follow-up could not move is named');
    assert.equal(nywEl('nyw-left').hidden, false);
    nywLeaveDone();
    assert.equal(nywDoneOn(), false);
    assert.equal(state.ui.builderScreen, 'hub');
  } finally { confirm = realConfirm; nywReset(); wzTeardown(); }
});

test('the claim\'s other views: another device drives (claim panel only), Watch reads, Take over after idle brings the answers and asks', async () => {
  const db = await wzSetup();
  try {
    nywReset();
    db.serverSet(dbPath('setup/meta/wizard'), { step: 3, byKey: OWNER_MEMBER_KEY, at: Date.now(), fromEpoch: 'legacy', answers: JSON.stringify({ dev: 'other-device-123', weekStart: '2027-07-18', double: 'none' }) });
    await waitUntil(() => wizardClaimOf(setupTree), 'the claim to arrive');
    state.ui.builderScreen = 'wizard';
    assert.equal(nywModelNow().mode, 'other');
    assert.equal(setupScreen(), 'wizard', 'the owner may see the claim');
    renderNywScreen();
    assert.equal(nywEl('setup-wizard').dataset.drive, 'other');
    assert.equal(nywEl('nyw-claim').hidden, false);
    assert.equal(nywEl('nyw-takeover').hidden, true, 'not offered until that device has been idle');
    assert.equal(nywEl('nyw-takeover-note').hidden, false);
    assert.equal(nywEl('nyw-headline').textContent, 'You’re setting up 2027 on another device');
    nywWatch();
    assert.equal(nywModelNow().mode, 'watch');
    renderNywScreen();
    assert.equal(nywEl('setup-wizard').dataset.drive, 'watch');
    assert.equal(nywEl('nyw-claim').dataset.claim, 'watching');
    assert.equal(nywEl('nyw-count').textContent, 'Step 3 of 5');
    // idle: the door offers it
    const view = nywDoorView();
    assert.equal(view.state, 'other');
    db.serverSet(dbPath('setup/meta/wizard'), { step: 3, byKey: OWNER_MEMBER_KEY, at: Date.now() - WIZARD_IDLE_MS - 1000, fromEpoch: 'legacy', answers: JSON.stringify({ dev: 'other-device-123', weekStart: '2027-07-18', double: 'none' }) });
    await waitUntil(() => nywDoorView() && nywDoorView().canTakeOver, 'the idle claim to offer Take over');
    renderNywScreen();
    assert.equal(nywEl('nyw-takeover').hidden, false);
    await nywTakeOver();
    await waitUntil(() => wizardModel().state === 'mine', 'now mine');
    assert.equal(nywUi.watching, false);
    assert.ok(nywUi.ask && /other device/.test(nywUi.ask.q) && nywUi.ask.list.some((l) => /Camp starts/.test(l)), 'what was chosen there is asked about: ' + JSON.stringify(nywUi.ask));
    renderNywScreen();
    assert.equal(nywEl('nyw-ask').hidden, false);
    assert.equal(wizardAnswers().double, 'none');
  } finally { nywReset(); wzTeardown(); }
});

test('Undo the new-year setup: the menu row says when it is offered, the sheet reads the saved copy, the hold puts the year back', async () => {
  const db = await wzSetup();
  try {
    nywReset();
    assert.equal(SETUP_OWNER_ACTIONS['undo-new-year'].why(), 'Nothing to undo yet');
    await wzToStep4(db);
    nywUi.freeze = { campRunning: false };
    assert.equal((await wizardClear(WZ_QUIET)).ok, true);
    await wzSettle();
    setupUi.restore = { status: 'ok', rows: await restoreList(), at: Date.now(), loading: false };
    assert.equal(SETUP_OWNER_ACTIONS['undo-new-year'].why(), '', 'offered inside the 14 days');
    nywOpenUndo();
    await waitUntil(() => nywUi.undo && nywUi.undo.state === 'ready', 'the saved copy to be read');
    renderNywUndoSheet();
    assert.ok(/game result/.test(nywEl('nyu-back').innerHTML), nywEl('nyu-back').innerHTML);
    assert.ok(/as they are now/i.test(nywEl('nyu-stay').innerHTML));
    assert.equal(nywEl('nyu-hold-btn').hidden, false);
    shell.sheets.push('nyw-undo'); // the sheet is up (the hold only finishes while it is)
    await nywRunUndo();
    assert.equal(nywUi.undo, null, 'the sheet is done');
    assert.equal(state.meta.epoch || '', '', 'the legacy epoch is back');
    assert.equal(Object.keys(state.results).length, 2, 'the scores are back');
  } finally { shell.sheets.length = 0; nywReset(); wzTeardown(); }
});

test('a past year\'s sheet is download-and-undo only: no section ticks, never put back piece by piece', async () => {
  const db = await wzSetup();
  try {
    nywReset();
    const arch = await wzToStep4(db);
    setupUi.restore = { status: 'ok', rows: await restoreList(), at: Date.now(), loading: false };
    const row = setupUi.restore.rows.find((r) => r.rid === arch.rid);
    assert.equal(row.kind, 'archive');
    setupUi.rsheet = { rid: row.rid, row, source: 'index', state: 'ready', body: restoreBodyObject(), preview: null, picks: {}, reveal: false, busy: false, why: '' };
    paintArchiveYear(setupUi.rsheet);
    assert.equal(nywEl('sheet-restore').dataset.kind, 'archive');
    assert.equal(nywEl('rp-year').hidden, false);
    assert.equal(nywEl('rp-year-download-title').textContent.indexOf('Download'), 0);
    assert.equal(nywEl('rp-year-undo').hidden, true, 'nothing to undo while the archive was taken under the epoch in force... or it is the newest one');
    shell.sheets.push('restore');
    const from = db.log.length;
    await rpApply();
    assert.equal(db.log.length, from, 'an archive is never applied section by section');
    setupUi.rsheet = null;
  } finally { shell.sheets.length = 0; setupUi.rsheet = null; nywReset(); wzTeardown(); }
});

test('Advanced → Start again from the original: only a section that has ever been on, one restore point first, one transaction, the owner alone', async () => {
  const db = await wzSetup();
  try {
    nywReset();
    // the pure heart
    const seed = buildSeed(CAMP, ['meals']);
    assert.equal(restartSeed({ meta: { on: {} } }, seed, 'meals', { at: 1, byKey: 'k' }), undefined, 'never turned on: nothing to start again');
    assert.equal(restartSeed({ meta: { schema: 99, on: { meals: true } } }, seed, 'meals', { at: 1, byKey: 'k' }), undefined, 'a newer build\'s node is never touched');
    const cur = { meta: { on: { meals: false, cleanup: true }, weekStart: '2027-07-18', edited: { meals: { at: 5, byKey: 'x' } } }, meals: { mon: { lunch: { dish: 'Soup' } } }, cleanup: { mon: { lunch: { t0: true } } } };
    const out = restartSeed(cur, seed, 'meals', { at: 9, byKey: 'k' });
    assert.equal(out.meta.on.meals, true, 'ends on');
    assert.deepEqual(out.cleanup, cur.cleanup, 'other sections are untouched');
    assert.equal(out.meta.weekStart, '2027-07-18');
    assert.equal(out.meta.restarted, undefined, 'the rules\' meta has no room for a field of its own');
    assert.deepEqual(out.meta.edited.meals, { at: 9, byKey: 'k' });
    assert.equal(JSON.stringify(out.meals), JSON.stringify(seed.meals || undefined) === undefined ? undefined : JSON.stringify(seed.meals));
    assert.ok(cur.meals.mon.lunch.dish === 'Soup', 'the input is never changed');
    // the screen's rows
    renderAdvancedSheet();
    assert.equal(advStateOf('meals'), 'on');
    // the engine, against the database
    const mealDay = Object.keys(setupTree.meals || {})[0];
    if (mealDay) {
      const meal = Object.keys(setupTree.meals[mealDay])[0];
      const was = JSON.stringify(setupTree.meals);
      db.serverSet(dbPath('setup/meals/' + mealDay + '/' + meal + '/dish'), 'Edited dish');
      await waitUntil(() => setupTree.meals[mealDay][meal].dish === 'Edited dish', 'the edit to arrive');
      const from = db.log.length;
      const r = await setupRestartSection('meals', WZ_QUIET);
      assert.equal(r.ok, true, JSON.stringify(r));
      await waitUntil(() => setupTree.meals[mealDay][meal].dish !== 'Edited dish', 'the seed to come back');
      assert.equal(JSON.stringify(setupTree.meals), was, 'exactly the seeded menus again');
      const log = db.log.slice(from);
      assert.equal(log.filter((l) => l.kind === 'transaction').length, 1, 'ONE transaction');
      const points = (await restoreList()).filter((p) => p.kind === 'pre-seed' && /again/.test(p.label));
      assert.equal(points.length, 1, 'one restore point first');
    }
    // never turned on, and the freeze
    assert.equal((await setupRestartSection('nonsense', WZ_QUIET)).reason, 'none');
    const tree = setupClone(setupTree); delete tree.meta.on.verses; setupTree = normalizeSetup(tree); setupRev++;
    assert.equal((await setupRestartSection('verses', WZ_QUIET)).reason, 'never');
    assert.equal((await setupRestartSection('meals', {})).reason, 'ask-camp-week', 'no dates anywhere: asked, never assumed');
    assert.equal((await setupRestartSection('meals', { campRunning: true })).reason, 'camp-week');
  } finally { nywReset(); wzTeardown(); }
});

test('the staff line: schedule items that name someone are listed and nothing is changed', async () => {
  await wzSetup();
  try {
    const before = JSON.stringify(setupTree);
    const items = nywStaffItems();
    assert.ok(Array.isArray(items));
    items.forEach((i) => { assert.ok(i.names.length && i.label.includes(' — ')); });
    renderNywStaffSheet();
    assert.equal(JSON.stringify(setupTree), before);
  } finally { wzTeardown(); }
});

test('the new-year screen names no year in its markup (years come from the dates: nywYears)', () => {
  const html = readFixture("../index.html");
  const i = html.indexOf('id="setup-wizard"');
  const sec = html.slice(i, html.indexOf('</section>', i)).replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/20\d\d/.test(sec), 'a hard-coded year in #setup-wizard: ' + (sec.match(/.{20}20\d\d.{10}/) || [''])[0]);
});
