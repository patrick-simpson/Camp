// The Schedule screen's mutators and the rain plan's engine (setup-rebuild-spec §11.5-§11.6; build step 15):
// setup-sync.js section 8 (schedEditMutate, schedAddMutate, schedRemoveMutate, schedOwnMutate, schedRipple, schedScopeInfo…)
// and section 9 (rainStage, rainView, rainSwapSlots, rainRetime, rainChanges, rainClashes, rainCommitMutate…). They are
// pure over a tree, so each rule is driven with a plain object here and the screens (setup-ui.js) only gather the
// answers; the commit goes through the real commitSetup. Runs under the senior profile too (schedule-edit.senior.test.js).

const seClone = (v) => JSON.parse(JSON.stringify(v));
// RTDB prunes an emptied container, the live tree keeps it until the next echo: both read as "gone".
const seEmpty = (v) => v === undefined || v === null || (typeof v === 'object' && Object.keys(v).length === 0);
const seMatch = (re, s, msg) => assert.ok(re.test(s), (msg || '') + ' ' + s);

function seTree() {
  return normalizeSetup({
    meta: { schema: 1, on: { schedule: true } },
    days: { sun: { typical: false, tag: 'Arrival day' }, mon: { typical: true }, tue: { typical: true }, wed: { typical: true }, thu: { typical: true }, fri: { typical: true }, sat: { typical: false } },
    typical: {
      'b-swim-900': { start: 900, end: 960, label: 'Swim', emoji: '🏊', type: 'activity', ord: 10, alertKey: 'swim' },
      'b-lunch-720': { start: 720, end: 780, label: 'Lunch', emoji: '🥪', type: 'activity', meal: 'lunch', ord: 20, alertKey: 'lunch' },
      'b-team-competitions-600': { start: 600, end: 705, label: 'Team competitions', emoji: '🏅', type: 'games', ord: 5, alertKey: 'team-competitions' },
      'b-lights-out-1350': { start: 1350, end: 1440, label: 'Lights out', emoji: '🌙', type: 'activity', noTime: true, ord: 90, alertKey: 'lights-out' },
    },
    patches: { wed: { 'b-swim-900': { start: 930, end: 990 } }, fri: { 'b-lunch-720': { off: true } } },
    dayBlocks: {
      tue: { 'b-tue-movie-1140': { start: 1140, end: 1260, label: 'Movie', emoji: '🎬', type: 'activity', ord: 100, alertKey: 'movie' } },
      sun: { 'b-sun-welcome-840': { start: 840, end: 900, label: 'Welcome', emoji: '👋', type: 'activity', ord: 0, alertKey: 'welcome' } },
    },
  });
}

function seStart(tree) {
  freshState();
  setMemberRole('editor');
  setupTree = tree || seTree();
  setupRev++;
  undoClear();
}

// An item sheet's fields for a stored/rich block, optionally changed.
function seItem(b, over) {
  return Object.assign({ label: b.base || b.label, emoji: b.emoji, start: b.start, end: b.end, type: b.type, slot: b.slot, meal: b.meal, noTime: b.noTime, teams: b.teams, overlapOk: b.overlapOk }, over || {});
}
function seRich(dow, bid) { return planForDow(dow).find((b) => b.id === bid); }

test('editing the typical day writes typical/<bid>/<field> only; a day that follows it needs no scope question', () => {
  seStart();
  const r = schedCommit({ kind: 'edit', dk: '', bid: 'b-swim-900', scope: 'typical', item: seItem({ base: 'Swim', emoji: '🏊', start: 900, end: 960, type: 'activity' }, { label: 'Swim time', end: 975 }), label: 'x' });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.ops).sort(), ['typical/b-swim-900/end', 'typical/b-swim-900/label']);
  assert.equal(setupTree.typical['b-swim-900'].alertKey, 'swim', 'a rename keeps the reminder key');
});

test('"Every day like Wednesday" writes the typical day, drops Wednesday\'s patch on those fields, and leaves other days\' own values alone', () => {
  seStart();
  const wed = seRich(3, 'b-swim-900');
  assert.equal(wed.start, 930, 'Wednesday shows its own start');
  const r = schedCommit({ kind: 'edit', dk: 'wed', bid: 'b-swim-900', scope: 'typical', item: seItem(wed, { start: 945, end: 1005 }), label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(setupTree.typical['b-swim-900'].start, 945);
  assert.equal(setupTree.typical['b-swim-900'].end, 1005);
  assert.ok(seEmpty(setupMapOf(setupTree.patches.wed)['b-swim-900']), 'the seen day now follows: its patch is gone');
});

test('a field the sheet left alone is never written into the typical day (a patched day\'s value is not the typical one)', () => {
  seStart();
  const wed = seRich(3, 'b-swim-900'); // start 930, end 990 are Wednesday's own
  const r = schedCommit({ kind: 'edit', dk: 'wed', bid: 'b-swim-900', scope: 'typical', item: seItem(wed, { emoji: '🏖️' }), label: 'x' });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.ops), ['typical/b-swim-900/emoji'], 'only the emoji');
  assert.equal(setupTree.patches.wed['b-swim-900'].start, 930, 'Wednesday keeps its own start');
});

test('schedScopeInfo names the days that change and the ones that keep their own value', () => {
  const t = seTree();
  const info = schedScopeInfo(t, 'b-swim-900', ['start']);
  assert.deepEqual(info.change, ['mon', 'tue', 'thu', 'fri']);
  assert.deepEqual(info.keep, [{ dk: 'wed', fields: ['start'] }]);
  assert.equal(schedDaysWords(info.change), 'Mon, Tue, Thu, Fri');
  assert.equal(schedDaysWords(['mon', 'tue', 'wed', 'thu', 'fri']), 'Mon–Fri');
  assert.deepEqual(schedScopeInfo(t, 'b-lunch-720', ['label']).change, ['mon', 'tue', 'wed', 'thu'], 'Friday skips lunch: nothing to change there');
  assert.equal(schedDaysWords(['sun', 'mon', 'tue', 'thu']), 'Sun–Tue, Thu');
});

test('"Change Wednesday too" removes Wednesday\'s patch on that field in the same commit', () => {
  seStart();
  const tue = seRich(2, 'b-swim-900');
  const r = schedCommit({ kind: 'edit', dk: 'tue', bid: 'b-swim-900', scope: 'typical', item: seItem(tue, { start: 910, end: 970 }), changeOwn: ['wed'], label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(setupTree.typical['b-swim-900'].start, 910);
  assert.ok(seEmpty(setupMapOf(setupTree.patches.wed)['b-swim-900']));
});

test('"Just Tuesday" writes patches/tue only for what differs from the typical item; setting a field back to the usual drops it', () => {
  seStart();
  const tue = seRich(2, 'b-swim-900');
  let r = schedCommit({ kind: 'edit', dk: 'tue', bid: 'b-swim-900', scope: 'day', item: seItem(tue, { start: 915, end: 975, emoji: '🏖️' }), label: 'x' });
  assert.equal(r.ok, true);
  assert.deepEqual(seClone(setupTree.patches.tue['b-swim-900']), { emoji: '🏖️', start: 915, end: 975 });
  assert.equal(setupTree.typical['b-swim-900'].start, 900, 'the typical day is untouched');
  const back = seRich(2, 'b-swim-900');
  r = schedCommit({ kind: 'edit', dk: 'tue', bid: 'b-swim-900', scope: 'day', item: seItem(back, { start: 900, end: 960, emoji: '🏊' }), label: 'x' });
  assert.equal(r.ok, true);
  assert.ok(seEmpty(setupMapOf(setupTree.patches.tue)['b-swim-900']), 'Back to the usual: the patch is gone');
});

test('"Just Tuesday" cannot remove a typical field a patch cannot unset (a meal, an elective slot, the teams): it is refused with the words', () => {
  seStart();
  const tue = seRich(2, 'b-lunch-720');
  const r = schedCommit({ kind: 'edit', dk: 'tue', bid: 'b-lunch-720', scope: 'day', item: seItem(tue, { meal: undefined }), label: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unpatchable');
  assert.equal(r.fields, 'meal');
  assert.ok(seEmpty(setupMapOf(setupTree.patches.tue)['b-lunch-720']), 'nothing written');
  assert.equal(schedUnpatchable(setupTree.typical['b-lunch-720'], seItem(tue, { meal: undefined })), 'meal');
  assert.equal(schedUnpatchable(setupTree.typical['b-lunch-720'], seItem(tue)), '');
});

test('a one-off or an own item is edited in place, whatever the scope', () => {
  seStart();
  const movie = seRich(2, 'b-tue-movie-1140');
  assert.equal(movie.origin, 'oneoff');
  const r = schedCommit({ kind: 'edit', dk: 'tue', bid: 'b-tue-movie-1140', scope: 'typical', item: seItem(movie, { label: 'Outdoor movie', start: 1170, end: 1290 }), label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(setupTree.dayBlocks.tue['b-tue-movie-1140'].label, 'Outdoor movie');
  assert.equal(setupTree.dayBlocks.tue['b-tue-movie-1140'].start, 1170);
  assert.equal(setupTree.typical['b-swim-900'].start, 900);
});

test('an item a colleague removed refuses the edit by name instead of resurrecting a half record', () => {
  seStart();
  const tue = seRich(2, 'b-swim-900');
  delete setupTree.typical['b-swim-900'];
  const r = schedCommit({ kind: 'edit', dk: 'tue', bid: 'b-swim-900', where: 'typical', scope: 'day', item: seItem(tue, { start: 915, end: 975 }), label: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'removed');
});

test('adding: to the typical day (a typical id) or to one day (that day\'s own id), a fresh id every time, a reminder key, an ord after the rest', () => {
  seStart();
  let r = schedCommit({ kind: 'add', dk: 'tue', scope: 'typical', item: { label: 'Snack Shack', emoji: '🍦', start: 840, end: 870, type: 'activity' }, label: 'x' });
  assert.equal(r.ok, true);
  // A block made by hand is `b-` + 8 random base36 (§5.5), never the seed's slug id: two directors adding the same item at
  // once can't mint one id, and `<dk>-<id>` is 14 characters whatever the name (the pushSchedule rule allows 40).
  seMatch(/^b-[a-z0-9]{8}$/, r.id);
  assert.equal(setupTree.typical[r.id].alertKey, 'snack-shack');
  assert.ok(setupTree.typical[r.id].ord > 90, 'after the rest of the typical day');
  const first = r.id;
  r = schedCommit({ kind: 'add', dk: 'tue', scope: 'day', item: { label: 'Snack Shack', emoji: '🍦', start: 840, end: 870, type: 'activity' }, label: 'x' });
  seMatch(/^b-[a-z0-9]{8}$/, r.id);
  assert.ok(r.id !== first, 'never the typical day\'s id: a typical id and an own id both publish as <dk>-<id>');
  const again = schedCommit({ kind: 'add', dk: 'tue', scope: 'day', item: { label: 'Snack Shack', emoji: '🍦', start: 840, end: 870, type: 'activity' }, label: 'x' });
  assert.ok(again.id !== r.id, 'a fresh id every time, with no suffix to grow');
  const long = schedCommit({ kind: 'add', dk: 'wed', scope: 'day', item: { label: 'A very long name for an item that would have filled a slug id to the brim', emoji: '🍦', start: 840, end: 870, type: 'activity' }, label: 'x' });
  assert.ok(('wed-' + long.id).length <= 14, 'a long name cannot push the published id over the rule\'s 40');
  assert.equal(planForDow(2).filter((b) => /Snack/.test(b.label)).length, 3);
});

test('removing: Skip just Tuesday (off patch), Remove from every day (typical + every patch of it), delete a one-off; Bring back undoes a skip', () => {
  seStart();
  let r = schedCommit({ kind: 'remove', dk: 'tue', bid: 'b-swim-900', scope: 'day', label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(setupTree.patches.tue['b-swim-900'].off, true);
  assert.equal(planForDow(2).some((b) => b.id === 'b-swim-900'), false);
  assert.equal(planForDow(2).skipped.some((b) => b.id === 'b-swim-900'), true);
  r = schedCommit({ kind: 'bring', dk: 'tue', bid: 'b-swim-900', label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(planForDow(2).some((b) => b.id === 'b-swim-900'), true);
  r = schedCommit({ kind: 'remove', dk: 'wed', bid: 'b-swim-900', scope: 'typical', label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(setupTree.typical['b-swim-900'], undefined);
  assert.ok(seEmpty(setupMapOf(setupTree.patches.wed)['b-swim-900']), 'its patches go with it (the rules refuse a patch for a block that is gone)');
  r = schedCommit({ kind: 'remove', dk: 'tue', bid: 'b-tue-movie-1140', scope: 'day', label: 'x' });
  assert.ok(seEmpty(setupTree.dayBlocks.tue), 'a one-off is deleted');
});

test('Give Tuesday its own schedule: the same ids in dayBlocks, typical:false, patches gone, in ONE commit — and the day reads exactly as before', () => {
  seStart();
  schedCommit({ kind: 'remove', dk: 'tue', bid: 'b-lunch-720', scope: 'day', label: 'x' });
  const before = seClone(planForDow(2).map((b) => [b.id, b.start, b.end, b.label, b.emoji, b.type, b.alertKey]));
  const r = schedCommit({ kind: 'own', dk: 'tue', blocks: planForDow(2), label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(setupTree.days.tue.typical, false);
  assert.ok(seEmpty(setupMapOf(setupTree.patches.tue)['b-lunch-720']));
  assert.ok(setupTree.dayBlocks.tue['b-swim-900'], 'the same id');
  assert.equal(setupTree.dayBlocks.tue['b-lunch-720'], undefined, 'a skipped item is not copied');
  assert.deepEqual(seClone(planForDow(2).map((b) => [b.id, b.start, b.end, b.label, b.emoji, b.type, b.alertKey])), before);
  assert.ok(Object.keys(r.ops).length > 3 && Object.keys(r.ops).some((p) => /^days\/tue/.test(p)), 'the day record changes in the same commit');
});

test('Make Tuesday follow the typical day again: typical:true and its own items gone; Clear removes patches and one-offs', () => {
  seStart();
  schedCommit({ kind: 'own', dk: 'tue', blocks: planForDow(2), label: 'x' });
  let r = schedCommit({ kind: 'follow', dk: 'tue', label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(setupTree.days.tue.typical, true);
  assert.ok(seEmpty(setupMapOf(setupTree.dayBlocks).tue));
  seStart();
  r = schedCommit({ kind: 'clear', dk: 'wed', label: 'x' });
  assert.ok(seEmpty(setupMapOf(setupTree.patches).wed));
  assert.equal(planForDow(3).find((b) => b.id === 'b-swim-900').start, 900, 'Wednesday is the typical day again');
});

test('Copy from another day fills an empty own day with new ids and the same reminder keys', () => {
  seStart();
  const r = schedCommit({ kind: 'copy', dk: 'sat', blocks: planForDow(1), label: 'x' });
  assert.equal(r.ok, true);
  const ids = Object.keys(setupTree.dayBlocks.sat);
  assert.equal(ids.length, planForDow(1).length);
  ids.forEach((id) => seMatch(/^b-[a-z0-9]{8}$/, id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(planForDow(6).find((b) => b.base === 'Swim').alertKey, 'swim');
});

test('overlaps: an item on purpose or an untimed one never counts; the candidate itself is left out', () => {
  const blocks = [{ id: 'a', start: 540, end: 600 }, { id: 'b', start: 600, end: 660, overlapOk: true }, { id: 'c', start: 700, end: 760, noTime: true }];
  assert.deepEqual(schedOverlaps(blocks, { id: 'x', start: 570, end: 650 }).map((b) => b.id), ['a'], 'b is on purpose');
  assert.deepEqual(schedOverlaps(blocks, { id: 'a', start: 570, end: 650 }).map((b) => b.id), [], 'not itself');
  assert.deepEqual(schedOverlaps(blocks, { id: 'x', start: 700, end: 760 }), [], 'an untimed item is not on the clock');
  assert.deepEqual(schedOverlaps(blocks, { id: 'x', start: 600, end: 650, noTime: true }), []);
});

test('ripple: everything from the item on moves; an item to the end of the day shrinks; nothing ever ends past midnight', () => {
  const blocks = [
    { id: 'a', start: 1080, end: 1140 }, { id: 'b', start: 1140, end: 1260 }, { id: 'c', start: 1290, end: 1350 },
    { id: 'd', start: 1380, end: 1440 }, { id: 'e', start: 1410, end: 1439 },
  ];
  const r = schedRipple(blocks, 'b', 30);
  assert.deepEqual(r.moves.b, { start: 1170, end: 1290 });
  assert.deepEqual(r.moves.c, { start: 1320, end: 1380 });
  assert.deepEqual(r.moves.d, { start: 1410, end: 1440 }, 'until the end of the day: the start moves, the end stays');
  assert.deepEqual(r.nofit.map((b) => b.id), ['e'], 'it would end after midnight: not moved, listed');
  assert.equal(r.moves.a, undefined, 'earlier items stay');
  Object.keys(r.moves).forEach((id) => assert.ok(r.moves[id].end <= 1440 && r.moves[id].start >= 0, id));
  const late = schedRipple(blocks, 'd', 60);
  assert.deepEqual(late.moves.d, undefined, 'an end-of-day item pushed past the last minutes of the day cannot move');
});

test('gaps of 15 minutes or more between two timed items are listed; overlapping or touching items leave none', () => {
  assert.deepEqual(schedGaps([{ start: 540, end: 600 }, { start: 600, end: 660 }, { start: 840, end: 900 }]), [{ start: 660, end: 840 }]);
  assert.deepEqual(schedGaps([{ start: 540, end: 600 }, { start: 610, end: 660 }]), [], 'ten minutes is not a gap');
  assert.deepEqual(schedGaps([{ start: 540, end: 700 }, { start: 600, end: 650 }, { start: 720, end: 760 }]), [{ start: 700, end: 720 }], 'an item inside another does not open one');
});

test('open and save every seeded item of the camp unchanged, as the typical day, as its day and as one scope or the other: zero ops', () => {
  const tree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP))));
  seStart(tree);
  let n = 0;
  for (let dow = 0; dow < 7; dow++) {
    const dk = SETUP_DK[dow];
    planForDow(dow).forEach((b) => {
      ['day', 'typical'].forEach((scope) => {
        const r = schedCommit({ kind: 'edit', dk, bid: b.id, scope, item: seItem(b), label: 'x' });
        assert.equal(r.ok, true, dk + ' ' + b.id);
        assert.deepEqual(r.ops, {}, dk + ' ' + b.id + ' ' + scope + ' wrote something');
        n++;
      });
    });
  }
  assert.ok(n > 100, 'every block of every day: ' + n);
});

test('a ripple from 7:00 PM on every seeded day leaves every end at or before midnight', () => {
  const tree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP))));
  seStart(tree);
  for (let dow = 0; dow < 7; dow++) {
    const blocks = planForDow(dow);
    const first = blocks.find((b) => !b.noTime && b.start >= 1140);
    if (!first) continue;
    [15, 30, -15].forEach((delta) => {
      const r = schedRipple(blocks, first.id, delta);
      Object.keys(r.moves).forEach((id) => assert.ok(r.moves[id].end <= 1440 && r.moves[id].start >= 0 && r.moves[id].end > r.moves[id].start, SETUP_DK[dow] + ' ' + id + ' ' + delta));
    });
  }
});

// ── the rain plan ───────────────────────────────────────────────────

function seRainDay() {
  seStart();
  // a plain Wednesday: Team competitions 10:00-11:45, Lunch 12:00-13:00, Swim 15:00-16:00 -> its patch 15:30-16:30
  return 3;
}

test('swap their time slots: each takes the other\'s start and end; keep their lengths: each takes the start, keeps its length, null past midnight', () => {
  const a = { id: 'a', start: 600, end: 705 }; // 105 min
  const b = { id: 'b', start: 795, end: 840 }; // 45 min
  assert.deepEqual(rainSwapSlots(a, b), { a: { start: 795, end: 840 }, b: { start: 600, end: 705 } });
  assert.deepEqual(rainSwapLengths(a, b), { a: { start: 795, end: 900 }, b: { start: 600, end: 645 } });
  assert.equal(rainSwapLengths({ id: 'a', start: 600, end: 1000 }, { id: 'b', start: 1300, end: 1340 }), null, 'a would end at 1700 minutes');
});

test('earlier / later swaps with the timed neighbour, each keeps its length and the pair keeps its span', () => {
  const blocks = [{ id: 'a', start: 540, end: 600 }, { id: 'n', start: 610, end: 620, noTime: true }, { id: 'b', start: 630, end: 700 }, { id: 'c', start: 720, end: 780 }];
  const r = rainNudge(blocks, 'b', -1);
  assert.deepEqual(r, { b: { start: 540, end: 610 }, a: { start: 640, end: 700 } }, 'b first, a after the same 30-minute gap; the span 9:00-11:40 is the same');
  assert.equal(rainNudge(blocks, 'a', -1), null, 'nothing earlier');
  assert.equal(rainNudge(blocks, 'c', 1), null, 'nothing later');
  assert.deepEqual(rainNudge(blocks, 'b', 1), { c: { start: 630, end: 690 }, b: { start: 710, end: 780 } });
});

test('staging keeps the FIRST base, and a field put back to it leaves the plan', () => {
  const day = seRainDay();
  const plan = rainPlanNew('wed', '', 1);
  rainStageFields(plan, setupTree, 'wed', 'b-lunch-720', { start: 735, end: 795 });
  const p = 'patches/wed/b-lunch-720/start';
  assert.equal(plan.items[p].base, null);
  assert.equal(plan.items[p].staged, 735);
  rainStageFields(plan, setupTree, 'wed', 'b-lunch-720', { start: 750 });
  assert.equal(plan.items[p].base, null, 'the base is what the tree held when it was first staged');
  assert.equal(plan.items[p].staged, 750);
  rainStageFields(plan, setupTree, 'wed', 'b-swim-900', { start: 930 });
  assert.equal(plan.items['patches/wed/b-swim-900/start'], undefined, 'staging a field to what it already is stages nothing');
  rainUnstage(plan, 'wed', 'b-lunch-720');
  assert.deepEqual(plan.items, {});
  assert.equal(day, 3);
});

test('rainView shows the day as the plan would leave it; rainChanges says what changed in the day\'s order', () => {
  seRainDay();
  const plan = rainPlanNew('wed', '', 1);
  const tc = seRich(3, 'b-team-competitions-600');
  const lunch = seRich(3, 'b-lunch-720');
  rainStageFields(plan, setupTree, 'wed', tc.id, rainSwapSlots(tc, lunch)[tc.id]);
  rainStageFields(plan, setupTree, 'wed', lunch.id, rainSwapSlots(tc, lunch)[lunch.id]);
  rainStageFields(plan, setupTree, 'wed', 'b-swim-900', { off: true });
  const c = rainChanges(setupTree, plan, 3, state.config);
  assert.deepEqual(c.lines.map((l) => l.kind + ':' + l.id), ['time:b-lunch-720', 'time:b-team-competitions-600', 'skip:b-swim-900']);
  const t = c.lines.find((l) => l.id === 'b-team-competitions-600');
  assert.deepEqual([t.start, t.end, t.was.start, t.was.end], [720, 780, 600, 705]);
  assert.equal(c.after.some((b) => b.id === 'b-swim-900'), false, 'skipped today');
  assert.equal(seRich(3, 'b-swim-900').start, 930, 'the live tree is untouched until Done');
});

test('Done: the verdict names overlaps and new gaps; a clean plan says nothing overlaps', () => {
  seRainDay();
  const plan = rainPlanNew('wed', '', 1);
  const v0 = rainView(setupTree, plan, 3);
  assert.deepEqual(rainVerdict(v0.before, v0.after), []);
  rainStageFields(plan, setupTree, 'wed', 'b-lunch-720', { start: 690, end: 750 }); // lands on Team competitions 10:00-11:45
  const v1 = rainView(setupTree, plan, 3);
  const verdict = rainVerdict(v1.before, v1.after);
  assert.equal(verdict.some((x) => x.kind === 'overlap'), true);
  const o = verdict.find((x) => x.kind === 'overlap');
  assert.deepEqual([o.start, o.end], [690, 705]);
  const lonely = rainPlanNew('wed', '', 1);
  rainStageFields(lonely, setupTree, 'wed', 'b-swim-900', { off: true });
  const v2 = rainView(setupTree, lonely, 3);
  assert.equal(rainVerdict(v2.before, v2.after).filter((x) => x.kind === 'overlap').length, 0);
});

test('Done checks every staged field\'s base against the tree NOW: a colleague\'s change is a clash, the same change is not', () => {
  seRainDay();
  const plan = rainPlanNew('wed', '', 1);
  rainStageFields(plan, setupTree, 'wed', 'b-lunch-720', { start: 735, end: 795 });
  assert.deepEqual(rainClashes(setupTree, plan), []);
  setupTree.patches.wed = setupTree.patches.wed || {};
  setupTree.patches.wed['b-lunch-720'] = { start: 740 }; // Pat moved it since
  const c = rainClashes(setupTree, plan);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].path, c[0].mine, c[0].theirs], ['patches/wed/b-lunch-720/start', 735, 740]);
  setupTree.patches.wed['b-lunch-720'] = { start: 735, end: 795 };
  assert.deepEqual(rainClashes(setupTree, plan), [], 'they did the same thing');
});

test('the commit writes staged fields as patches (a one-off on its record), drops a patch equal to the typical value, and Keep his leaves a path alone', () => {
  seRainDay();
  const plan = rainPlanNew('wed', '', 1);
  rainStageFields(plan, setupTree, 'wed', 'b-lunch-720', { start: 735, end: 795 });
  rainStageFields(plan, setupTree, 'wed', 'b-swim-900', { start: 900, end: 960 }); // back to the TYPICAL swim: Wednesday's patch should go
  let res = commitSetup((d) => rainCommitMutate(d, plan, []), { undo: false });
  assert.equal(res.ok, true);
  assert.deepEqual(setupTree.patches.wed['b-lunch-720'], { start: 735, end: 795 });
  assert.ok(seEmpty(setupMapOf(setupTree.patches.wed)['b-swim-900']), 'equal to the typical item: no patch');
  // a one-off keeps its fields on its own record
  seStart();
  const movie = rainPlanNew('tue', '', 1);
  rainStageFields(movie, setupTree, 'tue', 'b-tue-movie-1140', { start: 1200, end: 1320 });
  assert.ok(/^dayBlocks\/tue\//.test(Object.keys(movie.items)[0]));
  res = commitSetup((d) => rainCommitMutate(d, movie, []), { undo: false });
  assert.equal(setupTree.dayBlocks.tue['b-tue-movie-1140'].start, 1200);
  // "Keep his"
  seStart();
  const keep = rainPlanNew('wed', '', 1);
  rainStageFields(keep, setupTree, 'wed', 'b-lunch-720', { start: 735, end: 795 });
  res = commitSetup((d) => rainCommitMutate(d, keep, ['patches/wed/b-lunch-720/start']), { undo: false });
  assert.equal(setupTree.patches.wed['b-lunch-720'].start, undefined);
  assert.equal(setupTree.patches.wed['b-lunch-720'].end, 795);
});

test('a skipped one-off is off on its own record and Bring back clears it; a one-off added by the plan is a whole record', () => {
  seStart();
  const plan = rainPlanNew('tue', '', 1);
  rainStageFields(plan, setupTree, 'tue', 'b-tue-movie-1140', { off: true });
  assert.equal(Object.keys(plan.items)[0], 'dayBlocks/tue/b-tue-movie-1140/off');
  let res = commitSetup((d) => rainCommitMutate(d, plan, []), { undo: false });
  assert.equal(planForDow(2).some((b) => b.id === 'b-tue-movie-1140'), false);
  res = schedCommit({ kind: 'bring', dk: 'tue', bid: 'b-tue-movie-1140', label: 'x' });
  assert.equal(res.ok, true);
  assert.equal(planForDow(2).some((b) => b.id === 'b-tue-movie-1140'), true);
  const add = rainPlanNew('tue', '', 1);
  rainStage(add, setupTree, 'dayBlocks/tue/b-tue-indoor-games-780', { start: 780, end: 840, label: 'Indoor games', emoji: '🎲', type: 'activity', alertKey: 'indoor-games', ord: 110 });
  const v = rainView(setupTree, add, 2);
  assert.equal(v.after.some((b) => b.id === 'b-tue-indoor-games-780'), true);
  assert.equal(rainChanges(setupTree, add, 2, state.config).lines.some((l) => l.kind === 'add'), true);
});

test('game moves: staged on the plan, applied to the config (blockId, ord, session, day), "Not on the schedule" clears the link; a colleague\'s move since is a clash', () => {
  seStart();
  const config = seClone(state.config);
  const g = config.games[0];
  const plan = rainPlanNew('wed', '', 1);
  rainStageGame(plan, g, { blockId: 'b-x', dayId: config.days[1].id, session: 'Evening', ord: 30 });
  assert.equal(plan.games[g.id].base.dayId, g.dayId);
  assert.equal(rainApplyGames(config, plan), 1);
  assert.deepEqual([config.games[0].blockId, config.games[0].ord, config.games[0].dayId, config.games[0].session], ['b-x', 30, config.days[1].id, 'Evening']);
  const gone = rainPlanNew('wed', '', 1);
  rainStageGame(gone, config.games[0], { blockId: null });
  rainApplyGames(config, gone);
  assert.equal(config.games[0].blockId, undefined);
  assert.equal(config.games[0].ord, undefined);
  const back = rainPlanNew('wed', '', 1);
  rainStageGame(back, g, { blockId: g.blockId || null, dayId: g.dayId });
  assert.deepEqual(back.games, {}, 'put back where it was: nothing staged');
  const other = seClone(state.config);
  other.games[0].blockId = 'b-colleague';
  assert.equal(rainGameClashes(other, plan).length, 1);
  assert.equal(rainSessionFor({ sessions: ['Morning', 'Evening'] }, { start: 600 }), 'Morning');
  assert.equal(rainSessionFor({ sessions: ['Morning', 'Afternoon', 'Evening'] }, { start: 900 }), 'Afternoon');
});

test('putting back one half of a swap puts the other half back too (the fields one action staged are tied together)', () => {
  seRainDay();
  const plan = rainPlanNew('wed', '', 1);
  const tc = seRich(3, 'b-team-competitions-600');
  const lunch = seRich(3, 'b-lunch-720');
  const moves = rainSwapSlots(tc, lunch);
  Object.keys(moves).forEach((id) => rainStageFields(plan, setupTree, 'wed', id, moves[id], 'g1'));
  rainStageFields(plan, setupTree, 'wed', 'b-swim-900', { off: true });
  rainUnstage(plan, 'wed', 'b-lunch-720');
  assert.deepEqual(Object.keys(plan.items), ['patches/wed/b-swim-900/off'], 'both halves gone, the unrelated skip stays');
});
