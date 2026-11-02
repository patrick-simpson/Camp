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
