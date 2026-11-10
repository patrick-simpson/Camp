// The Schedule screen's behaviour layer (setup-ui.js section 10; setup-rebuild-spec §11.5; build step 15): what the
// rows say, the item sheet's questions (an overlap, a day with its own value, a renamed item), the two scope buttons,
// removing, and the day's menu. The mutators underneath are schedule-edit.test.js; anything that needs layout (the
// strip's scroll, 44 px targets) is the Playwright pass. Runs under the senior profile too.

function ssStart(opts) {
  window.scrollTo = () => {};
  freshState();
  setMemberRole('editor');
  authUser = { email: 'jenn@example.com', emailVerified: true };
  setupTree = normalizeSetup(opts && opts.off ? {} : setupClone(syncCanon(buildSeed(CAMP))));
  setupRev++;
  setupSched.item = null;
  setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (dow) => planForDow(dow), CAMP).ops); // the games sit on their items, as after Edit the week here
  undoClear();
  setupPillHide(true);
  state.ui.setupDay = (opts && opts.day) || 'wed';
}
function ssEnd() { setupSched.item = null; setupPillHide(true); authUser = null; setMemberRole(null); }
const ssRows = () => ['morning', 'afternoon', 'evening'].map((p) => document.querySelector('[data-sched-list="' + p + '"]').innerHTML).join('');
const ssSheetClose = () => { try { shellSheetClose('sched-item'); } catch (e) { /* not open */ } };

test('the typical day reads as a run sheet: the day in the head, who follows it, rows by part of the day, what a save reaches', () => {
  ssStart({ day: 'typical' });
  try {
    renderScheduleScreen();
    assert.equal(setupEl('sched-headline').textContent, 'The typical day');
    assert.ok(/^Mon–Fri follow this$/.test(setupEl('sched-lede').textContent), setupEl('sched-lede').textContent);
    assert.equal(setupEl('sched-rain-link').hidden, true, 'a rain plan is a day\'s');
    assert.equal(setupEl('sched-scope-note').hidden, false);
    assert.ok(/^Changes Mon–Fri, except days that have their own version of this$/.test(setupEl('sched-scope-note-text').textContent));
    const html = ssRows();
    assert.ok(/<button type="button" class="cb-row sched-row" data-bid="b-/.test(html), 'a row is a button');
    assert.ok(html.indexOf('sched-emo') !== -1 && html.indexOf('cb-time') !== -1);
    assert.equal(document.querySelector('[data-sched-part="morning"]').hidden, false);
    assert.equal(setupEl('sched-add-text').textContent, 'Add to the typical day');
    assert.equal(setupEl('sched-door').hidden, true);
  } finally { ssEnd(); }
});

test('a day view says where it stands; a day with its own schedule says so; the rain plan and the day\'s menu are there for a day only', () => {
  ssStart({ day: 'wed' });
  try {
    renderScheduleScreen();
    assert.equal(setupEl('sched-headline').textContent, 'Wednesday');
    assert.ok(/^Follows the typical day/.test(setupEl('sched-lede').textContent), setupEl('sched-lede').textContent);
    assert.equal(setupEl('sched-rain-link').hidden, false);
    assert.equal(setupEl('sched-day-btn').hidden, false);
    assert.ok(/^Rain plan for (today|Wednesday)$/.test(setupEl('sched-rain-link-text').textContent));
    state.ui.setupDay = 'sat';
    renderScheduleScreen();
    assert.ok(/^Its own schedule/.test(setupEl('sched-lede').textContent), setupEl('sched-lede').textContent);
    assert.equal(setupEl('sched-add-text').textContent, 'Add to Saturday');
  } finally { ssEnd(); }
});

test('while the schedule is the original, the screen is a read-only preview: rows are not buttons, no gaps, no add, the owner\'s door shows', () => {
  ssStart({ off: true, day: 'tue' });
  try {
    renderScheduleScreen();
    assert.equal(setupEl('sched-door').hidden, false);
    assert.equal(setupEl('sched-add').hidden, true);
    assert.equal(setupEl('sched-rain-link').hidden, true);
    const html = ssRows();
    assert.ok(html.indexOf('data-bid=') !== -1, 'the built-in week has real block ids');
    assert.equal(html.indexOf('<button'), -1, 'no row is a button');
    assert.equal(html.indexOf('sched-gap'), -1);
    assert.equal(html.indexOf('gl-chev'), -1, 'no chevron: nothing to open');
  } finally { ssEnd(); }
});

test('a gap of 15 minutes or more between two rows is an "Add something" row at its time; a tap opens the item sheet prefilled', () => {
  ssStart({ day: 'tue' });
  try {
    setupTree.typical = {};
    setupTree.dayBlocks.tue = {
      'b-tue-a-540': { start: 540, end: 600, label: 'A', emoji: '🌟', type: 'activity', ord: 0, alertKey: 'a' },
      'b-tue-b-660': { start: 660, end: 720, label: 'B', emoji: '🌟', type: 'activity', ord: 10, alertKey: 'b' },
    };
    setupTree.days.tue.typical = false;
    setupRev++;
    renderScheduleScreen();
    const html = ssRows();
    assert.ok(/data-gap-start="600" data-gap-end="660"/.test(html), html);
    assert.ok(/Add something · /.test(html));
    schedOpenItem({ start: 600, end: 660 });
    assert.equal(setupSched.item.mode, 'add');
    assert.deepEqual([setupSched.item.form.start, setupSched.item.form.end], [600, 660]);
    assert.equal(setupSched.item.dk, 'tue');
  } finally { ssSheetClose(); ssEnd(); }
});

test('an item of the typical day seen on Wednesday: Just Wednesday writes a patch, Every day like Wednesday the typical item', async () => {
  ssStart({ day: 'wed' });
  try {
    const target = planForDow(3).find((b) => b.origin === 'typical' && b.type === 'activity' && !b.noTime && !b.meal);
    schedOpenItem({ bid: target.id });
    const it = setupSched.item;
    assert.equal(it.origin, 'typical');
    it.form.emoji = '🎉';
    schedItemTouched('emoji');
    let m = schedItemModel(it);
    assert.equal(m.valid, true);
    assert.deepEqual(m.changed, ['emoji']);
    assert.equal(m.pending, false);
    await schedSaveItem('day');
    assert.equal(setupSched.item, null, 'saved: the sheet closes');
    assert.equal(setupTree.patches.wed[target.id].emoji, '🎉');
    assert.equal(setupTree.typical[target.id].emoji, target.emoji, 'the typical day untouched');
    assert.equal(planForDow(3).find((b) => b.id === target.id).origin, 'changed');
    // now every day like Wednesday
    schedOpenItem({ bid: target.id });
    setupSched.item.form.emoji = '🎊';
    await schedSaveItem('typical');
    assert.equal(setupTree.typical[target.id].emoji, '🎊');
    assert.equal(setupMapOf(setupTree.patches.wed)[target.id] && setupTree.patches.wed[target.id].emoji, undefined, 'Wednesday follows it now');
  } finally { ssSheetClose(); ssEnd(); }
});

test('invalid fields block the save, in words: no name, a start after the end', async () => {
  ssStart({ day: 'sat' });
  try {
    schedOpenItem({ start: 600, end: 660 });
    let it = setupSched.item;
    let m = schedItemModel(it);
    assert.equal(m.valid, false);
    assert.equal(m.errors.label, 'Give it a name.');
    it.form.label = 'Hike';
    it.form.start = 700; it.form.end = 650;
    m = schedItemModel(it);
    assert.equal(m.errors.time, 'Ends before it starts.');
    const before = Object.keys(setupMapOf(setupTree.dayBlocks.sat)).length;
    await schedSaveItem('day');
    assert.equal(Object.keys(setupMapOf(setupTree.dayBlocks.sat)).length, before, 'nothing written');
    it.form.end = 750;
    await schedSaveItem('day');
    assert.equal(Object.keys(setupTree.dayBlocks.sat).length, before + 1);
    assert.equal(setupSched.item, null);
  } finally { ssSheetClose(); ssEnd(); }
});

test('an overlap is asked about before the save: push later items back, or that\'s on purpose (which marks the item)', async () => {
  ssStart({ day: 'tue' });
  try {
    setupTree.typical = {};
    setupTree.days.tue.typical = false;
    setupTree.dayBlocks.tue = {
      'b-tue-a-540': { start: 540, end: 600, label: 'Alpha', emoji: '🌟', type: 'activity', ord: 0, alertKey: 'alpha' },
      'b-tue-b-600': { start: 600, end: 660, label: 'Bravo', emoji: '🌟', type: 'activity', ord: 10, alertKey: 'bravo' },
      'b-tue-c-660': { start: 660, end: 720, label: 'Charlie', emoji: '🌟', type: 'activity', ord: 20, alertKey: 'charlie' },
    };
    setupRev++;
    schedOpenItem({ bid: 'b-tue-a-540' });
    let it = setupSched.item;
    it.form.end = 630; // 30 minutes into Bravo
    schedItemTouched('time');
    let m = schedItemModel(it);
    assert.equal(m.overlap.id, 'b-tue-b-600');
    assert.equal(m.pushBy, 30);
    assert.equal(m.pending, true, 'the question blocks the save');
    await schedSaveItem('day');
    assert.equal(setupTree.dayBlocks.tue['b-tue-a-540'].end, 600, 'nothing saved while it is unanswered');
    // push later items back
    it.moves = schedRipple(planForDow(2).filter((b) => b.id !== 'b-tue-a-540'), m.overlap.id, m.pushBy);
    it.ask.overlap = 'push';
    m = schedItemModel(it);
    assert.equal(m.pending, false);
    await schedSaveItem('day');
    assert.equal(setupTree.dayBlocks.tue['b-tue-a-540'].end, 630);
    assert.deepEqual([setupTree.dayBlocks.tue['b-tue-b-600'].start, setupTree.dayBlocks.tue['b-tue-c-660'].start], [630, 690], 'the later items moved together');
    // on purpose
    schedOpenItem({ bid: 'b-tue-a-540' });
    it = setupSched.item;
    it.form.end = 660;
    schedItemTouched('time');
    m = schedItemModel(it);
    assert.ok(m.overlap, 'overlaps Bravo again');
    it.form.overlapOk = true; it.ask.overlap = 'ok';
    await schedSaveItem('day');
    assert.equal(setupTree.dayBlocks.tue['b-tue-a-540'].overlapOk, true);
    assert.equal(planForDow(2).find((b) => b.id === 'b-tue-a-540').overlapOk, true);
  } finally { ssSheetClose(); ssEnd(); }
});

test('a day with its own value for the changed field is asked about ("Keep Wednesday\'s" / "Change Wednesday too"), once per question', async () => {
  ssStart({ day: 'tue' });
  try {
    const typical = Object.keys(setupTree.typical).find((id) => setupTree.typical[id].type === 'activity' && !setupTree.typical[id].meal && !setupTree.typical[id].teams && setupTree.typical[id].end - setupTree.typical[id].start >= 30);
    setupTree.patches.wed = setupMapOf(setupTree.patches.wed);
    setupTree.patches.wed[typical] = { start: setupTree.typical[typical].start + 5 };
    setupRev++;
    schedOpenItem({ bid: typical });
    const it = setupSched.item;
    it.form.start = setupTree.typical[typical].start + 10;
    schedItemTouched('time');
    let m = schedItemModel(it);
    assert.deepEqual(m.keep.map((k) => k.dk), ['wed']);
    assert.ok(m.ownAsk, 'asked');
    assert.equal(m.pending, true);
    it.ask.own = 'keep'; it.ask.ownKey = m.ownKey;
    it.form.label = it.form.label + ' ';
    schedItemTouched('label');
    m = schedItemModel(it);
    assert.equal(m.ownAsk, null, 'a keystroke elsewhere does not re-ask');
    await schedSaveItem('typical');
    assert.equal(setupTree.typical[typical].start, it.rec ? it.rec.start + 10 : 0);
    assert.equal(setupTree.patches.wed[typical].start, setupTree.typical[typical].start - 5, 'Wednesday kept its own');
  } finally { ssSheetClose(); ssEnd(); }
});

test('renaming an item completely asks whether it is still the same thing for reminders; "start fresh" mints a new key, "same" keeps it', async () => {
  ssStart({ day: 'typical' });
  try {
    const bid = Object.keys(setupTree.typical).find((id) => setupTree.typical[id].type === 'activity' && !setupTree.typical[id].meal && !setupTree.typical[id].teams);
    const oldKey = setupTree.typical[bid].alertKey;
    schedOpenItem({ bid });
    let it = setupSched.item;
    it.form.label = 'Archery lesson';
    schedItemTouched('label');
    let m = schedItemModel(it);
    assert.equal(m.rekey, true);
    assert.equal(m.pending, true);
    it.ask.rekey = 'fresh'; it.ask.rekeyKey = m.headNew;
    await schedSaveItem('typical');
    assert.equal(setupTree.typical[bid].label, 'Archery lesson');
    assert.equal(setupTree.typical[bid].alertKey, 'archery-lesson');
    assert.ok(oldKey !== 'archery-lesson');
    // a small edit of the same name never asks
    schedOpenItem({ bid });
    it = setupSched.item;
    it.form.label = 'Archery lesson 2';
    schedItemTouched('label');
    assert.equal(schedItemModel(it).rekey, false);
    // same
    schedOpenItem({ bid });
    it = setupSched.item;
    it.form.label = 'Fishing';
    schedItemTouched('label');
    m = schedItemModel(it);
    it.ask.rekey = 'same'; it.ask.rekeyKey = m.headNew;
    await schedSaveItem('typical');
    assert.equal(setupTree.typical[bid].alertKey, 'archery-lesson', 'same thing for reminders: the key stays');
  } finally { ssSheetClose(); ssEnd(); }
});

test('Just Wednesday is not offered for a change a patch cannot carry, and the caption says why', () => {
  ssStart({ day: 'wed' });
  try {
    const meal = planForDow(3).find((b) => b.meal && b.origin === 'typical');
    schedOpenItem({ bid: meal.id });
    const it = setupSched.item;
    it.form.kind = 'activity';
    schedItemTouched('kind');
    const m = schedItemModel(it);
    assert.equal(m.unpatchable, 'meal');
    const note = setupEl('si-scope-caption').textContent;
    assert.ok(/^Just Wednesday can’t change the meal$/.test(note), note);
  } finally { ssSheetClose(); ssEnd(); }
});

test('removing: skip just Wednesday (reversible), remove from every day, or delete a one-off; the games on it are listed as not on the schedule', async () => {
  ssStart({ day: 'wed' });
  const realAsk = askDialog;
  try {
    const gamesBlock = planForDow(3).find((b) => b.type === 'games' && b.origin === 'typical' && schedGamesOf(b, 3).length);
    assert.ok(gamesBlock, 'a games item with games on it');
    const games = schedGamesOf(gamesBlock, 3);
    // skip just Wednesday
    schedOpenItem({ bid: gamesBlock.id });
    askDialog = async (o) => { assert.ok(o.actions.some((a) => a.value === 'day') && o.actions.some((a) => a.value === 'typical')); return 'day'; };
    await schedRemoveItem();
    assert.equal(planForDow(3).some((b) => b.id === gamesBlock.id), false);
    assert.equal(planForDow(3).skipped.some((b) => b.id === gamesBlock.id), true);
    renderScheduleScreen();
    assert.equal(setupEl('sched-sec-skipped').hidden, false);
    assert.ok(/data-sched-bring="/.test(setupEl('sched-skipped-list').innerHTML));
    schedBringBack(gamesBlock.id);
    assert.equal(planForDow(3).some((b) => b.id === gamesBlock.id), true, 'Bring back');
    // remove from every day: the games lose their place, with one undo entry
    undoClear();
    schedOpenItem({ bid: gamesBlock.id });
    askDialog = async () => 'typical';
    await schedRemoveItem();
    assert.equal(setupTree.typical[gamesBlock.id], undefined);
    games.forEach((g) => assert.equal(gameById(g.id).blockId, undefined, g.id));
    assert.equal(undoRecent().length, 1);
    assert.deepEqual([...new Set(undoRecent()[0].ops.map((o) => o[0]))].sort(), ['config', 'setup']);
    // declining writes nothing
    const left = planForDow(3).find((b) => b.origin === 'typical' && b.type === 'activity');
    schedOpenItem({ bid: left.id });
    askDialog = async () => 'no';
    await schedRemoveItem();
    assert.ok(setupTree.typical[left.id]);
  } finally { askDialog = realAsk; ssSheetClose(); ssEnd(); }
});

test('Copy to Mon–Fri makes the empty days follow the typical day; Copy from another day fills an own day', async () => {
  ssStart({ day: 'typical' });
  const realAsk = askDialog;
  try {
    setupTree.days.mon.typical = false;
    setupTree.days.tue.typical = false;
    setupTree.dayBlocks.tue = { 'b-tue-x-540': { start: 540, end: 600, label: 'X', emoji: '🌟', type: 'activity', ord: 0, alertKey: 'x' } };
    setupRev++;
    assert.deepEqual(schedCopyWeekDays(setupTree), ['mon'], 'Tuesday has its own items: left alone');
    schedCopyWeek();
    assert.equal(setupTree.days.mon.typical, true);
    assert.equal(setupTree.days.tue.typical, false);
    // an empty own day: copy from Wednesday
    setupTree.dayBlocks.sat = {};
    askDialog = async (o) => { assert.ok(o.actions.some((a) => a.value === '3'), 'Wednesday is on offer'); return '3'; };
    await schedCopyFromDay(6);
    assert.equal(Object.keys(setupMapOf(setupTree.dayBlocks.sat)).length, planForDow(3).length, 'copied');
  } finally { askDialog = realAsk; ssEnd(); }
});

test('the day strip names each day in words and the open sheet knows its day; selecting a day is remembered on the device', () => {
  ssStart({ day: 'typical' });
  try {
    assert.equal(schedDayKey(), 'typical');
    schedSetDay('thu');
    assert.equal(state.ui.setupDay, 'thu');
    state.ui.builderScreen = 'schedule';
    assert.equal(setupWhereNow(), 'schedule:thu');
    schedSetDay('nope');
    assert.equal(state.ui.setupDay, 'thu', 'not a day: ignored');
    assert.ok(/^Thursday/.test(schedStripLabel('thu', 4, true)));
    assert.equal(schedDaysWords(['mon', 'tue']), 'Mon, Tue');
    assert.equal(schedMinToInput(570), '09:30');
    assert.equal(schedInputToMin('09:30'), 570);
  } finally { state.ui.builderScreen = undefined; ssEnd(); }
});

test('an item sheet with edits asks before it closes by ANY route (✕, Escape, the phone\'s Back); Discard closes it, Keep editing leaves it, and it holds the deploy reload', async () => {
  ssStart({ day: 'tue' });
  state.ui.view = 'settings';
  state.ui.builderScreen = 'schedule';
  const realAsk = askDialog;
  const asked = [];
  let answer = 'keep';
  askDialog = (o) => { asked.push(o); return Promise.resolve(answer); };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  try {
    wireShell();
    const keys = (__docListeners.keydown || []);
    const escape = () => keys.forEach((h) => h({ key: 'Escape', preventDefault() {} }));
    schedOpenItem({ bid: planForDow(2).find((b) => !b.noTime).id });
    assert.equal(shell.sheets.includes('sched-item'), true, 'the sheet is up');
    // Nothing edited: nothing to ask, nothing held, Escape closes as ever.
    assert.equal(schedItemGuardClose(), false);
    assert.equal(schedItemBusy(), false);
    assert.equal(reloadBlocked(), false);
    escape();
    assert.equal(shell.sheets.includes('sched-item'), false);
    assert.equal(asked.length, 0);
    // Edited: the deploy reload waits, and every route asks.
    schedOpenItem({ bid: planForDow(2).find((b) => !b.noTime).id });
    setupSched.item.form.label = 'Half-typed';
    schedItemTouched('label');
    assert.equal(schedItemBusy(), true);
    assert.equal(reloadBlocked(), true, 'an unsaved item edit holds the auto-reload, as a game draft does');
    escape();
    await settle();
    assert.equal(asked.length, 1, 'Escape asks');
    assert.equal(asked[0].title, 'Discard your changes to Half-typed?');
    assert.deepEqual(asked[0].actions.map((a) => a.label), ['Keep editing', 'Discard']);
    assert.equal(shell.sheets.includes('sched-item'), true, 'Keep editing: still up');
    assert.ok(setupSched.item && setupSched.item.form.touched, 'with the edit intact');
    // The phone's Back (a snapshot without the sheet): the sheet stays and the question is asked.
    shellApply({ tab: 'now', ov: [{ k: 'builder' }] });
    await settle();
    assert.equal(asked.length, 2, 'Back asks too');
    assert.equal(shell.sheets.includes('sched-item'), true);
    // A question already up is not stacked on.
    askState = { resolve() {}, actions: [], input: false };
    escape();
    assert.equal(asked.length, 2);
    askState = null;
    // Discard closes it, and a closed sheet holds nothing.
    answer = 'discard';
    escape();
    await settle();
    assert.equal(asked.length, 3);
    assert.equal(shell.sheets.includes('sched-item'), false, 'Discard closes it');
    assert.equal(setupSched.item, null);
    assert.equal(schedItemBusy(), false);
    assert.equal(reloadBlocked(), false);
    // A sheet closed some other way that left its item set cannot hold the reload for good.
    setupSched.item = { form: { touched: true } };
    assert.equal(schedItemBusy(), false, 'only while the sheet is really up');
  } finally { askDialog = realAsk; askState = null; shell.sheets.length = 0; ssSheetClose(); ssEnd(); state.ui.view = 'home'; }
});

// ── "Tell people who follow this" (Step 26): the item sheet's tick and what a save sends ─────────────────────────

function ssTrackBox(id) { // the stub's elements keep no attributes: this one remembers "checked"
  const box = setupEl(id); let on = false;
  box.toggleAttribute = (n, v) => { on = v === undefined ? !on : !!v; return on; };
  box.hasAttribute = () => on;
  return box;
}

test('the tick on Remove…: offered only while alerts are live, in camp week, for a time the sender would tell; unticked every time; its outcome says who was told; never a real alert', async () => {
  const todayDow = campNow().dow;
  const todayKey = SETUP_DK[todayDow];
  const real = { cfg: pushConfigured, week: campWeek, tell: pushScheduleTell, now: serverNow, ask: askDialog, tickAsk: askWithTick };
  const told = [];
  ssStart({ day: todayKey });
  try {
    const target = planForDow(todayDow).find((b) => !b.noTime && b.type !== 'games' && !b.meal && b.start >= 120 && b.start <= 1000 && b.origin === 'typical');
    assert.ok(target, 'a plain item from the typical day');
    pushScheduleTell = async (before, alert) => { told.push({ before, alert }); return { ok: true, sent: 3, queued: 0 }; };
    const ymd = (add) => new Date(Date.UTC(2027, 6, 18 + add)).toISOString().slice(0, 10);
    let asked = null;
    askDialog = async () => 'day';
    askWithTick = async (o) => { asked = o; return { value: 'day', tick: asked.__answer === true }; };
    // dormant: a plain question, no tick
    schedOpenItem({ bid: target.id });
    await schedRemoveItem();
    assert.equal(asked, null, 'dormant: the ordinary question');
    schedBringBack(target.id);
    // live, camp week, an hour before the item
    pushConfigured = () => true;
    campWeek = () => ({ start: '2027-07-18', phase: 'during' });
    serverNow = () => etWallToEpoch(ymd(todayDow), 60);
    schedOpenItem({ bid: target.id });
    await schedRemoveItem();
    assert.ok(asked && asked.tick, 'the question carries the tick');
    assert.ok(/^Tell people who follow /.test(asked.tick.label), asked.tick.label);
    assert.ok(/tell everyone else in person/.test(asked.tick.note));
    assert.equal(told.length, 1, 'the change is named to the sender, quietly: unticked is alert false');
    assert.equal(told[0].alert, false, 'UNTICKED by default: nobody is alerted');
    schedBringBack(target.id);
    // ticked: the sender is told to alert
    asked = null;
    askWithTick = async (o) => { asked = o; return { value: 'day', tick: true }; };
    schedOpenItem({ bid: target.id });
    await schedRemoveItem();
    assert.equal(told.length, 2);
    assert.equal(told[1].alert, true);
    assert.ok(told[1].before && typeof told[1].before === 'object', 'the blocks as they were before the commit');
    schedBringBack(target.id);
    // an older Worker (bad-kind) hides it too
    pushSchedAlertsOff = true;
    serverNow = () => etWallToEpoch(ymd(todayDow), 60);
    asked = null;
    schedOpenItem({ bid: target.id });
    await schedRemoveItem();
    assert.equal(asked, null);
  } finally { pushSchedAlertsOff = false; pushConfigured = real.cfg; campWeek = real.week; serverNow = real.now; pushScheduleTell = real.tell; askDialog = real.ask; askWithTick = real.tickAsk; ssSheetClose(); ssEnd(); }
});

test('the tick on Remove… narrows with the scope: ticked, then "Skip just Monday" on a day the sender would not tell, the sender is told nothing to alert (a quiet baseline only); "Remove from every day like Monday" still tells', async () => {
  const real = { cfg: pushConfigured, week: campWeek, tell: pushScheduleTell, now: serverNow, ask: askDialog, tickAsk: askWithTick };
  const told = [];
  ssStart({ day: 'mon' });
  try {
    // A fixed clock: Wednesday 1 AM of the camp week, so the sender tells Wednesday and Thursday and nothing else.
    pushConfigured = () => true;
    campWeek = () => ({ start: '2027-07-18', phase: 'during' });
    serverNow = () => etWallToEpoch('2027-07-21', 60);
    pushScheduleTell = async (before, alert) => { told.push(alert); return { ok: true, sent: 3, queued: 0 }; };
    const target = planForDow(1).find((b) => !b.noTime && b.type !== 'games' && !b.meal && b.start >= 120 && b.start <= 1000 && b.origin === 'typical');
    assert.ok(target, 'a plain item from the typical day, seen on Monday');
    let offered = null;
    let pick = 'day';
    askWithTick = async (o) => { offered = o; return { value: pick, tick: true }; };
    schedOpenItem({ bid: target.id });
    await schedRemoveItem();
    assert.ok(offered && offered.tick, 'the tick is offered (Wednesday and Thursday follow the typical day)');
    assert.equal(told.length, 1, 'the sender is named the change');
    assert.equal(told[0], false, 'Skip just Monday: Monday is not a day the sender would tell, so the ticked box alerts nobody');
    schedBringBack(target.id);
    pick = 'typical';
    schedOpenItem({ bid: target.id });
    await schedRemoveItem();
    assert.equal(told.length, 2);
    assert.equal(told[1], true, 'removing it from every day it follows reaches Wednesday: the tick holds');
  } finally { pushConfigured = real.cfg; campWeek = real.week; serverNow = real.now; pushScheduleTell = real.tell; askDialog = real.ask; askWithTick = real.tickAsk; ssSheetClose(); ssEnd(); }
});

test('askWithTick: unticked every time it opens, a cancel is never a yes, the native confirm has no tick', async () => {
  // the dialog's own markup is stubbed by the harness; what matters is the answer shape
  const r = await askWithTick({ title: 'Remove it?', body: ['x'], actions: [{ label: 'Keep it', value: 'no', cancel: true }, { label: 'Remove it', value: 'go' }], tick: { label: 'Tell people who follow it', note: 'n' } });
  assert.equal(r.tick, false, 'with no dialog the native confirm answers: never ticked');
  assert.ok('value' in r && 'text' in r);
});

test('the tick on the item sheet: hidden while phone alerts are dormant, shown only for a change someone could be told about (a moved start, a new name) and then ticked for a move on a real day; a save tells the sender; unticked it is a quiet baseline move', async () => {
  // Moved on purpose with the Step 26 review: an emoji-only change no longer offers the tick (the sender would alert
  // "details changed" for nothing), and the tick needs a time still to come inside the sender's window.
  const todayDow = campNow().dow;
  const todayKey = SETUP_DK[todayDow];
  const real = { cfg: pushConfigured, week: campWeek, tell: pushScheduleTell, now: serverNow };
  const told = [];
  ssStart({ day: todayKey });
  try {
    const target = planForDow(todayDow).find((b) => !b.noTime && b.type !== 'games' && !b.meal && b.start >= 120 && b.start <= 1000);
    assert.ok(target, 'a plain item today');
    ssTrackBox('si-tell-check');
    pushScheduleTell = async (before, alert) => { told.push({ before, alert }); return { ok: true, sent: 1, queued: 0 }; };
    const ymd = (add) => new Date(Date.UTC(2027, 6, 18 + add)).toISOString().slice(0, 10);
    // dormant: PUSH_SERVICE_URL is blank
    schedOpenItem({ bid: target.id });
    setupSched.item.form.start = target.start + 5; schedItemTouched('start');
    assert.equal(setupEl('si-tell').hidden, true, 'dormant: never shown');
    ssSheetClose(); setupSched.item = null;
    // live, camp week running, one o'clock in the morning of today's date in the camp week
    pushConfigured = () => true;
    campWeek = () => ({ start: '2027-07-18', phase: 'during' });
    serverNow = () => etWallToEpoch(ymd(todayDow), 60);
    schedOpenItem({ bid: target.id });
    setupSched.item.form.emoji = '🎉'; schedItemTouched('emoji');
    assert.equal(setupEl('si-tell').hidden, true, 'an emoji alone is nothing to tell');
    ssSheetClose(); setupSched.item = null;
    schedOpenItem({ bid: target.id });
    setupSched.item.form.start = target.start + 5; schedItemTouched('start');
    assert.equal(setupEl('si-tell').hidden, false);
    assert.equal(setupEl('si-tell-check').hasAttribute('checked'), true, 'a moved start today starts ticked');
    await schedSaveItem('day');
    assert.equal(told.length, 1);
    assert.equal(told[0].alert, true);
    assert.ok(told[0].before && typeof told[0].before === 'object', 'the blocks as they were before the commit');
    // unticked: still named to the sender, so its baseline keeps up, but nobody is told
    schedOpenItem({ bid: target.id });
    const t1 = planForDow(todayDow).find((b) => b.id === target.id);
    setupSched.item.form.start = t1.start + 5; schedItemTouched('start');
    setupEl('si-tell-check').toggleAttribute('checked', false);
    await schedSaveItem('day');
    assert.equal(told.length, 2);
    assert.equal(told[1].alert, false);
    // a failing sender never stops the save
    pushScheduleTell = async () => { throw new Error('boom'); };
    schedOpenItem({ bid: target.id });
    setupSched.item.form.emoji = '🎈'; schedItemTouched('emoji');
    await schedSaveItem('day');
    assert.equal(setupSched.item, null, 'saved and closed');
    assert.equal(planForDow(todayDow).find((b) => b.id === target.id).emoji, '🎈');
    // an older Worker hid the tick
    pushScheduleTell = real.tell; pushSchedAlertsOff = true;
    schedOpenItem({ bid: target.id });
    const t2 = planForDow(todayDow).find((b) => b.id === target.id);
    setupSched.item.form.start = t2.start + 5; schedItemTouched('start');
    assert.equal(setupEl('si-tell').hidden, true);
  } finally { pushSchedAlertsOff = false; pushConfigured = real.cfg; campWeek = real.week; serverNow = real.now; pushScheduleTell = real.tell; ssSheetClose(); ssEnd(); }
});
