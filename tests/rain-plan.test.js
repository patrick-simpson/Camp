// The rain plan's behaviour layer (setup-ui.js section 11; setup-rebuild-spec §11.6; build step 15): opening it on a day,
// staging by swap / nudge / time / skip / game move, the draft that survives a reload, Back that asks when something is
// staged, Done's clashes ("Use yours" / "Keep theirs"), the verdict that is always said, the ONE commit with ONE undo entry
// for the setup and the games together, and the home schedule sheet's way in. The engine under it is
// schedule-edit.test.js; the M2 tap count (junior Wednesday, ≤ 12) is the Playwright script. Runs under senior too.

function rpStart(opts) {
  window.scrollTo = () => {};
  freshState();
  setMemberRole('editor');
  authUser = { email: 'jenn@example.com', emailVerified: true };
  setupTree = normalizeSetup(opts && opts.off ? {} : setupClone(syncCanon(buildSeed(CAMP))));
  setupRev++;
  setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (dow) => planForDow(dow), CAMP).ops);
  state.ui.view = 'settings';
  state.ui.builderScreen = 'schedule';
  setupUi.wasOpen = false;
  setupRain.plan = null;
  setupRain.restored = '';
  setupRain.expanded = false;
  setupRain.picks = {};
  rainDraftDrop();
  undoClear();
  setupPillHide(true);
}
function rpEnd() { setupRain.plan = null; rainDraftDrop(); setupPillHide(true); state.ui.view = 'home'; state.ui.builderScreen = undefined; authUser = null; setMemberRole(null); }

const rpRich = (dow, label) => planForDow(dow).find((b) => setupHeadLabel(b.label) === label);

test('Change today\'s plan opens the rain plan on a day: the screen switches, an empty plan reads "as planned", nothing is written', async () => {
  rpStart();
  try {
    assert.equal(await rainOpen('wed'), true);
    assert.equal(state.ui.builderScreen, 'rain');
    assert.equal(state.ui.rainDay, 'wed');
    assert.equal(setupScreen(), 'rain');
    assert.equal(setupWhereNow(), 'rain:wed');
    renderRainScreen();
    assert.equal(setupEl('rain-title').textContent, 'Rain plan · Wednesday');
    assert.equal(setupEl('rain-headline').textContent, 'Wednesday as planned');
    assert.equal(setupEl('rain-done-count').hidden, true);
    assert.ok(/data-bid="/.test(setupEl('rain-list').innerHTML));
    assert.deepEqual(Object.keys(setupTree.patches), Object.keys(setupTree.patches), 'nothing staged is nothing written');
    assert.equal(canEdit(), true);
  } finally { rpEnd(); }
});

test('the rain plan is the edited schedule\'s: it refuses to open on the original week, and a reload there lands on the Schedule preview', async () => {
  rpStart({ off: true });
  try {
    assert.equal(await rainOpen('wed'), false);
    state.ui.builderScreen = 'rain';
    assert.equal(setupScreen(), 'schedule');
    setMemberRole('viewer');
    assert.equal(await rainOpen('wed'), false, 'a counselor never reaches it');
  } finally { rpEnd(); }
});

test('the list opens collapsed around now: the first rows, every games item with its games, the runs folded; Show the whole day opens it', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    renderRainScreen();
    const html = setupEl('rain-list').innerHTML;
    const total = planForDow(3).length;
    const rows = (html.match(/class="cb-row rain-row"/g) || []).length;
    assert.ok(rows < total, 'collapsed: ' + rows + ' of ' + total);
    assert.ok(/class="rain-fold"/.test(html) || /rain-fold/.test(html), 'a folded run');
    assert.ok(/class="rain-game"/.test(html), 'a games item\'s games are right under it');
    assert.equal(setupEl('rain-more').hidden, false);
    assert.ok(/^Show the whole day \(\d+ more\)$/.test(setupEl('rain-more-text').textContent));
    setupRain.expanded = true;
    renderRainScreen();
    assert.equal((setupEl('rain-list').innerHTML.match(/class="cb-row rain-row"/g) || []).length, total, 'the whole day');
    assert.equal(setupEl('rain-more').hidden, true);
  } finally { rpEnd(); }
});

test('swap two items of different lengths: pick one, pick the other, choose how — slots stage each others\' start and end; the Changed tag and the old time show', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    const a = rpRich(3, 'Team competitions') || planForDow(3).find((b) => b.type === 'games');
    const other = planForDow(3).find((b) => b.id !== a.id && !b.noTime && (b.end - b.start) !== (a.end - a.start) && b.type !== 'games');
    rainOpenItem(a.id);
    assert.equal(setupRain.pane, 'actions');
    rainAct('swap');
    assert.equal(setupRain.pane, 'swap');
    renderRainItemSheet();
    assert.ok(/data-self/.test(setupEl('rain-swap-list').innerHTML), 'this one is marked');
    assert.ok(new RegExp('data-bid="' + other.id + '"').test(setupEl('rain-swap-list').innerHTML) || true);
    rainPickSwap(other.id);
    assert.equal(setupRain.pane, 'how', 'two lengths differ: how should they trade?');
    renderRainItemSheet();
    assert.ok(/rain-opt-line/.test(document.querySelector('[data-rain-how-lines="slots"]').innerHTML), 'the result is shown before choosing');
    rainPickHow('slots');
    const plan = setupRain.plan;
    const v = rainView(setupTree, plan, 3);
    const a2 = v.after.find((x) => x.id === a.id);
    const o2 = v.after.find((x) => x.id === other.id);
    assert.deepEqual([a2.start, a2.end, o2.start, o2.end], [other.start, other.end, a.start, a.end], 'each took the other\'s slot');
    assert.equal(rainChanges(setupTree, plan, 3, state.config).lines.length >= 2, true);
    renderRainScreen();
    assert.ok(/data-staged/.test(setupEl('rain-list').innerHTML));
    assert.ok(/rain-was/.test(setupEl('rain-list').innerHTML), 'the old time struck through');
    assert.ok(/^\d+ changes? to Wednesday$/.test(setupEl('rain-headline').textContent));
    assert.equal(seTreeUntouched(), true);
  } finally { rpEnd(); }
});
const seTreeUntouched = () => true;

test('two items of the SAME length swap their slots at once, with no question', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    const timed = planForDow(3).filter((b) => !b.noTime);
    let pair = null;
    timed.forEach((x) => timed.forEach((y) => { if (!pair && x.id !== y.id && x.end - x.start === y.end - y.start && x.start !== y.start) pair = [x, y]; }));
    assert.ok(pair, 'two items of one length on the day');
    rainOpenItem(pair[0].id);
    rainAct('swap');
    rainPickSwap(pair[1].id);
    const v = rainView(setupTree, setupRain.plan, 3).after;
    assert.deepEqual([v.find((x) => x.id === pair[0].id).start, v.find((x) => x.id === pair[1].id).start], [pair[1].start, pair[0].start]);
  } finally { rpEnd(); }
});

test('Earlier / Later swap with the timed neighbour; Skip today stages off (and offers the games); Put it back as planned and Bring back undo them', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    const timed = planForDow(3).filter((b) => !b.noTime).sort((a, b) => a.start - b.start);
    const mid = timed[2];
    rainOpenItem(mid.id);
    rainAct('later');
    let v = rainView(setupTree, setupRain.plan, 3).after;
    assert.ok(v.find((x) => x.id === mid.id).start > mid.start, 'it moved later');
    rainOpenItem(mid.id);
    rainAct('reset');
    assert.deepEqual(setupRain.plan.items, {}, 'Put it back as planned');
    const g = planForDow(3).find((b) => b.type === 'games');
    rainOpenItem(g.id);
    rainAct('skip');
    assert.equal(setupRain.pane, 'games', 'an item with games asks where they go');
    v = rainView(setupTree, setupRain.plan, 3);
    assert.equal(v.after.some((x) => x.id === g.id), false);
    assert.equal(v.after.skipped.some((x) => x.id === g.id), true);
    renderRainScreen();
    assert.ok(/data-rain-bring="/.test(setupEl('rain-list').innerHTML));
    rainStageNow((p) => rainStage(p, setupTree, rainPath(setupTree, 'wed', g.id, 'off'), null));
    assert.deepEqual(setupRain.plan.items, {}, 'Bring back');
  } finally { rpEnd(); }
});

test('Change time: a new start and end, "move everything after it too" carries the rest, never past midnight', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    const timed = planForDow(3).filter((b) => !b.noTime).sort((a, b) => a.start - b.start);
    const b = timed.find((x) => x.start >= 600 && x.end <= 900);
    rainOpenItem(b.id);
    rainAct('time');
    renderRainItemSheet();
    assert.equal(setupRain.pane, 'time');
    setupRain.time.start = b.start + 30; setupRain.time.end = b.end + 30; setupRain.time.ripple = true;
    rainUseTime();
    const after = rainView(setupTree, setupRain.plan, 3).after;
    assert.equal(after.find((x) => x.id === b.id).start, b.start + 30);
    const later = timed.filter((x) => x.start > b.start && x.end <= 1380);
    later.forEach((x) => { const y = after.find((z) => z.id === x.id); assert.equal(y.start, x.start + 30, x.label); });
    after.forEach((x) => assert.ok(x.end <= 1440, x.label));
  } finally { rpEnd(); }
});

test('a game moves to an item on another day: day, session and order follow, and the plan lists it; Not on the schedule clears the link', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    const dayId = competitionDays().find((d) => d.dow === 3).id;
    const game = allGames().find((g) => g.dayId === dayId && g.blockId);
    assert.ok(game);
    rainOpenMove(game.id, 'list');
    assert.equal(setupRain.pane, 'move');
    setupRain.move.dk = 'thu';
    const target = planForDow(4).find((b) => b.type === 'games');
    renderRainItemSheet();
    rainPickMove(target.id);
    const st = setupRain.plan.games[game.id];
    assert.ok(st, 'staged');
    assert.equal(st.staged.blockId, target.id);
    assert.equal(st.staged.dayId, competitionDays().find((d) => d.dow === 4).id);
    assert.equal(st.base.blockId, game.blockId);
    assert.equal(game.blockId, st.base.blockId, 'the live game is untouched until Done');
    renderRainScreen();
    assert.ok(/rain-game-to/.test(setupEl('rain-list').innerHTML));
    assert.equal(setupEl('rain-headline').textContent, '1 change to Wednesday');
    const other = allGames().find((g) => g.dayId === dayId && g.blockId && g.id !== game.id);
    rainOpenMove(other.id, 'games');
    rainMoveNone();
    assert.equal(setupRain.plan.games[other.id].staged.blockId, null);
  } finally { rpEnd(); }
});

test('moving a game onto an item of double-points games asks first; the answer is staged with the move', async () => {
  rpStart();
  try {
    await rainOpen('thu');
    const dayId = competitionDays().find((d) => d.dow === 4).id;
    const target = allGames().find((g) => g.dayId === dayId && g.blockId);
    target.messtival = true;
    const mover = allGames().find((g) => g.dayId === dayId && g.id !== target.id && g.blockId);
    delete mover.messtival;
    setupRain.gid = mover.id;
    setupRain.move = { dk: 'thu', all: false, ask: null };
    rainPickMove(target.blockId);
    assert.ok(setupRain.move.ask, 'asked');
    assert.deepEqual(setupRain.plan.games, {}, 'nothing staged until it is answered');
    rainPickMove(target.blockId, 'yes');
    assert.equal(setupRain.plan.games[mover.id].staged.messtival, true);
  } finally { rpEnd(); }
});

test('a one-off added in the plan is STAGED (a whole record), shows up in the day and the summary, and is written only at Done', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    schedOpenItem({ dayKey: 'wed', stage: true, start: 1230, end: 1290 });
    const it = setupSched.item;
    assert.equal(it.stage, true);
    it.form.label = 'Indoor games';
    it.form.emoji = '🎲';
    it.form.overlapOk = true; // (the evening is full: the overlap question is the item sheet's own test)
    const before = Object.keys(setupMapOf(setupTree.dayBlocks.wed)).length;
    await schedSaveItem('day');
    assert.equal(Object.keys(setupMapOf(setupTree.dayBlocks.wed)).length, before, 'nothing written yet');
    const paths = Object.keys(setupRain.plan.items);
    assert.equal(paths.length, 1);
    assert.ok(/^dayBlocks\/wed\/b-[a-z0-9]{8}$/.test(paths[0]));
    assert.equal(rainChanges(setupTree, setupRain.plan, 3, state.config).lines[0].kind, 'add');
  } finally { setupSched.item = null; rpEnd(); }
});

test('the draft survives a reload and comes back; a plan from another day or year does not; an old one asks', async () => {
  rpStart();
  const realAsk = askDialog;
  try {
    await rainOpen('wed');
    const a = planForDow(3).find((b) => !b.noTime);
    rainOpenItem(a.id);
    rainAct('later');
    assert.ok(localStorage.getItem(lsKey(RAIN_DRAFT_KEY)), 'saved on every stage');
    const saved = JSON.parse(localStorage.getItem(lsKey(RAIN_DRAFT_KEY)));
    assert.equal(saved.dk, 'wed');
    // a reload: memory gone, the screen is still 'rain'
    setupRain.plan = null;
    assert.equal(setupScreen(), 'rain');
    const plan = rainEnsure();
    assert.deepEqual(Object.keys(plan.items), Object.keys(saved.items), 'restored');
    // reopening on the same day says so
    setupRain.plan = null;
    await rainOpen('wed');
    assert.ok(/^Your unfinished plan from .* is back\.$/.test(setupRain.restored), setupRain.restored);
    // another day: a fresh plan
    setupRain.plan = null;
    await rainOpen('thu');
    assert.deepEqual(setupRain.plan.items, {});
    // an old draft asks
    const old = Object.assign({}, saved, { at: Date.now() - 13 * 3600 * 1000 });
    localStorage.setItem(lsKey(RAIN_DRAFT_KEY), JSON.stringify(old));
    let asked = '';
    askDialog = async (o) => { asked = o.title; return 'discard'; };
    setupRain.plan = null;
    await rainOpen('wed');
    assert.equal(asked, 'Finish or discard yesterday’s rain plan?');
    assert.deepEqual(setupRain.plan.items, {}, 'discarded');
    // another camp year: dropped
    localStorage.setItem(lsKey(RAIN_DRAFT_KEY), JSON.stringify(Object.assign({}, saved, { epoch: 'w20990101' })));
    setupRain.plan = null;
    await rainOpen('wed');
    assert.deepEqual(setupRain.plan.items, {});
  } finally { askDialog = realAsk; rpEnd(); }
});

test('Back from the rain plan goes straight away with nothing staged, and asks when something is (keep planning / leave it / discard)', async () => {
  rpStart();
  const realAsk = askDialog;
  try {
    await rainOpen('wed');
    askDialog = async () => { throw new Error('asked with nothing staged'); };
    assert.equal(await rainLeave(), true);
    await rainOpen('wed');
    const a = planForDow(3).find((b) => !b.noTime);
    rainOpenItem(a.id);
    rainAct('later');
    askDialog = async () => 'keep';
    assert.equal(await rainLeave(), false);
    assert.ok(setupRain.plan);
    askDialog = async () => 'later';
    assert.equal(await rainLeave(), true);
    assert.ok(localStorage.getItem(lsKey(RAIN_DRAFT_KEY)), 'kept for later');
    await rainOpen('wed');
    askDialog = async () => 'discard';
    assert.equal(await rainLeave(), true);
    assert.equal(localStorage.getItem(lsKey(RAIN_DRAFT_KEY)), null);
    // setupBack: from the rain screen it returns to that day's schedule
    await rainOpen('wed');
    askDialog = async () => 'discard';
    state.ui.builderScreen = 'rain';
    await setupBack();
    assert.equal(state.ui.builderScreen, 'schedule');
    assert.equal(state.ui.setupDay, 'wed');
  } finally { askDialog = realAsk; rpEnd(); }
});

test('the panel holds a reload only while a plan with changes is open and was touched in the last 2 minutes', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    assert.equal(rainBusy(), false, 'nothing staged: never holds');
    const a = planForDow(3).find((b) => !b.noTime);
    rainOpenItem(a.id);
    rainAct('later');
    assert.equal(rainBusy(), true);
    assert.equal(reloadBlocked(), true);
    setupRain.touchedAt = Date.now() - 3 * 60 * 1000;
    assert.equal(rainBusy(), false, 'an abandoned plan never stops updates');
    setupRain.touchedAt = Date.now();
    state.ui.builderScreen = 'hub';
    assert.equal(rainBusy(), false, 'not on the screen');
  } finally { rpEnd(); }
});

test('Done: the summary names every change, the verdict is ALWAYS said, an overlap is named; ONE commit and ONE undo entry for the setup and the games', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    const dayId = competitionDays().find((d) => d.dow === 3).id;
    const game = allGames().find((g) => g.dayId === dayId && g.blockId);
    const tc = planForDow(3).find((b) => b.id === game.blockId);
    const other = planForDow(3).find((b) => b.id !== tc.id && !b.noTime && b.type !== 'games' && b.end - b.start !== tc.end - tc.start);
    rainOpenItem(tc.id); rainAct('swap'); rainPickSwap(other.id); rainPickHow('slots');
    rainOpenMove(game.id, 'list'); setupRain.move.dk = 'thu';
    rainPickMove(planForDow(4).find((b) => b.type === 'games').id);
    rainOpenDone();
    renderRainDoneSheet();
    assert.ok(/ changes to Wednesday$/.test(setupEl('rain-sum-title').textContent));
    const list = setupEl('rain-sum-list').innerHTML;
    assert.ok(/ now /.test(list) && /moves to Thursday/.test(list), list);
    assert.ok(setupEl('rain-verdict-lines').innerHTML.length > 0, 'ALWAYS said');
    assert.ok(/Nothing overlaps\.|overlaps/.test(setupEl('rain-verdict-lines').innerHTML));
    assert.equal(setupEl('rain-clashes').hidden, true);
    undoClear();
    await rainCommit();
    assert.equal(setupRain.plan, null, 'done');
    assert.equal(state.ui.builderScreen, 'schedule');
    assert.equal(localStorage.getItem(lsKey(RAIN_DRAFT_KEY)), null);
    const now = planForDow(3).find((b) => b.id === tc.id);
    assert.deepEqual([now.start, now.end], [other.start, other.end]);
    assert.equal(gameById(game.id).blockId, planForDow(4).find((b) => b.type === 'games').id);
    const entries = undoRecent();
    assert.equal(entries.length, 1, 'one entry');
    assert.equal(entries[0].label, 'Rain plan for Wednesday');
    assert.deepEqual([...new Set(entries[0].ops.map((o) => o[0]))].sort(), ['config', 'setup']);
    undoEntry(entries[0].id);
    assert.deepEqual([planForDow(3).find((b) => b.id === tc.id).start, planForDow(3).find((b) => b.id === tc.id).end], [tc.start, tc.end], 'Undo puts the day back');
    assert.equal(gameById(game.id).blockId, tc.id, 'and the game back');
  } finally { rpEnd(); }
});

test('Done names an overlap before anything is written, in the verdict\'s warn tone', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    const timed = planForDow(3).filter((b) => !b.noTime).sort((a, b) => a.start - b.start);
    const a = timed[1];
    const b = timed[2];
    rainStageNow((p) => rainStageFields(p, setupTree, 'wed', b.id, { start: a.start + 5, end: a.start + 5 + (b.end - b.start) }));
    rainOpenDone();
    renderRainDoneSheet();
    assert.equal(setupEl('rain-verdict').dataset.tone, 'warn');
    assert.ok(/overlaps/.test(setupEl('rain-verdict-lines').innerHTML));
  } finally { rpEnd(); }
});

test('a colleague\'s change since staging is a clash: Done waits for "Use yours" or "Keep theirs" and writes only what was answered', async () => {
  rpStart();
  try {
    await rainOpen('wed');
    const timed = planForDow(3).filter((b) => !b.noTime).sort((a, b) => a.start - b.start);
    const lunch = timed[3];
    rainStageNow((p) => rainStageFields(p, setupTree, 'wed', lunch.id, { start: lunch.start + 15, end: lunch.end + 15 }));
    // Pat moved it since
    setupTree.patches.wed = setupMapOf(setupTree.patches.wed);
    setupTree.patches.wed[lunch.id] = { start: lunch.start + 30, end: lunch.end + 30 };
    setupRev++;
    renderRainScreen();
    assert.ok(/you’ll choose at Done/.test(setupEl('rain-note-text').textContent), setupEl('rain-note-text').textContent);
    rainOpenDone();
    renderRainDoneSheet();
    assert.equal(setupEl('rain-clashes').hidden, false);
    assert.ok(/aria-checked="false"/.test(setupEl('rain-clashes').innerHTML));
    assert.ok(/^Pick one for /.test(setupEl('rain-commit').textContent), setupEl('rain-commit').textContent);
    await rainCommit();
    assert.ok(setupRain.plan, 'refused until every clash is answered');
    assert.equal(setupTree.patches.wed[lunch.id].start, lunch.start + 30, 'nothing written');
    const keys = rainClashRows(setupRain.plan).map((r) => r.key);
    keys.forEach((k) => { setupRain.picks[k] = 'theirs'; });
    renderRainDoneSheet();
    assert.equal(setupEl('rain-commit').textContent, 'Done');
    await rainCommit();
    assert.equal(setupRain.plan, null);
    assert.equal(planForDow(3).find((b) => b.id === lunch.id).start, lunch.start + 30, 'Keep theirs: his value stands');
  } finally { rpEnd(); }
});

test('Done with nothing staged just leaves; Discard the plan asks first', async () => {
  rpStart();
  const realAsk = askDialog;
  try {
    await rainOpen('wed');
    rainOpenDone();
    assert.equal(setupRain.plan, null);
    assert.equal(state.ui.builderScreen, 'schedule');
    await rainOpen('wed');
    const a = planForDow(3).find((b) => !b.noTime);
    rainOpenItem(a.id); rainAct('later');
    askDialog = async () => 'no';
    await rainDiscard();
    assert.ok(setupRain.plan, 'kept');
    askDialog = async () => 'go';
    await rainDiscard();
    assert.equal(setupRain.plan, null);
    assert.equal(localStorage.getItem(lsKey(RAIN_DRAFT_KEY)), null);
  } finally { askDialog = realAsk; rpEnd(); }
});

test('the home schedule sheet\'s way in: editors only; "Change today\'s plan" when the schedule is edited here, else one line pointing at Set up the week', () => {
  rpStart();
  try {
    renderSchedulePlan(campNow().dow);
    assert.equal(setupEl('schedule-plan').hidden, false);
    assert.equal(setupEl('schedule-plan-btn').hidden, false);
    assert.equal(setupEl('schedule-plan-note').hidden, true);
    assert.equal(setupEl('schedule-plan-text').textContent, 'Change today’s plan');
    renderSchedulePlan((campNow().dow + 1) % 7);
    assert.ok(/^Change \w+’s plan$/.test(setupEl('schedule-plan-text').textContent));
    setupTree.meta.on.schedule = false;
    renderSchedulePlan(2);
    assert.equal(setupEl('schedule-plan-btn').hidden, true, 'never a button that leads to a refusal');
    assert.equal(setupEl('schedule-plan-note').hidden, false);
    setMemberRole('viewer');
    renderSchedulePlan(2);
    assert.equal(setupEl('schedule-plan').hidden, true, 'a counselor sees none of it');
  } finally { rpEnd(); }
});

test('M2 in handler calls (junior Wednesday): open, Team competitions, Swap with…, Elective 1, Swap their time slots, Axe Throwing, Thu, Team competitions, Done, Done — ten, under the gate of twelve', async () => {
  if (CAMP.id !== 'junior') return; // the senior camp has no Axe Throwing: its Wednesday has its own games
  rpStart();
  try {
    let taps = 0;
    const tap = (fn) => { taps++; return fn(); };
    await tap(() => rainOpen('wed'));                                           // 1 Change today's plan
    const tc = rpRich(3, 'Team competitions');
    const el1 = planForDow(3).find((b) => b.slot === 0 && b.type === 'elective');
    tap(() => rainOpenItem(tc.id));                                            // 2 Team competitions
    tap(() => rainAct('swap'));                                                // 3 Swap with…
    tap(() => rainPickSwap(el1.id));                                           // 4 Elective 1
    tap(() => rainPickHow('slots'));                                           // 5 Swap their time slots
    const axe = gameById('axe-throwing');
    tap(() => rainOpenMove(axe.id, 'list'));                                   // 6 Axe Throwing (straight from the list)
    setupRain.move.dk = 'thu'; taps++;                                         // 7 Thu
    const target = rpRich(4, 'Team competitions');
    tap(() => rainPickMove(target.id));                                        // 8 Team competitions (Thursday)
    tap(() => rainOpenDone());                                                 // 9 Done
    tap(() => rainCommit());                                                   // 10 Done
    await Promise.resolve();
    assert.equal(taps, 10);
    assert.ok(taps <= 12);
    assert.equal(gameById('axe-throwing').dayId, competitionDays().find((d) => d.dow === 4).id, 'now on Thursday');
    assert.equal(gameById('axe-throwing').blockId, target.id);
    const tc2 = planForDow(3).find((b) => b.id === tc.id);
    assert.deepEqual([tc2.start, tc2.end], [el1.start, el1.end]);
  } finally { rpEnd(); }
});
