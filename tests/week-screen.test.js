// The Camp week screen and the owner's doors (setup-ui.js section 8-9; setup-rebuild-spec §10.1, §11.4; build step 15):
// the dates, the Days tick sheet (the same two operations as the Schedule screen's day menu), the TV finale, the fixed
// legacy double-points window, Edit the week here as a conversation (every refusal in words, the camp-week freeze as a
// question) and Use the original week again. Counselors never reach any of it (the builder is editors-only). Runs under
// the senior profile too (week-screen.senior.test.js evals this file).

const wkClone = (v) => JSON.parse(JSON.stringify(v));
const WK_OWNER = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };

function wkStart(opts) {
  window.scrollTo = () => {};
  freshState();
  setMemberRole('editor');
  authUser = (opts && opts.owner) ? WK_OWNER : { email: 'jenn@example.com', emailVerified: true };
  setupTree = normalizeSetup(opts && opts.off ? {} : setupClone(syncCanon(buildSeed(CAMP))));
  setupRev++;
  undoClear();
  setupPillHide(true);
}

function wkEnd() { setupPillHide(true); authUser = null; setMemberRole(null); }

test('the Camp week screen reads the week: no dates yet, then the range, then what follows the typical day', () => {
  wkStart();
  try {
    renderWeekScreen();
    assert.equal(setupEl('week-headline').textContent, 'No dates yet');
    assert.ok(/Pick the Sunday/.test(setupEl('week-lede').textContent));
    assert.equal(setupEl('week-door').hidden, true, 'the schedule is edited here: no read-only door');
    const r = commitSetup((d) => { d.meta.weekStart = '2027-07-18'; }, { label: 'x' });
    assert.equal(r.ok, true);
    renderWeekScreen();
    assert.equal(setupEl('week-headline').textContent, 'Jul 18–24, 2027');
    assert.ok(/Sunday to Saturday · .*follow the typical day/.test(setupEl('week-lede').textContent), setupEl('week-lede').textContent);
    assert.equal(setupEl('week-start-sub').textContent, 'Sun Jul 18 – Sat Jul 24');
    assert.equal(weekHeadline('2027-07-18'), 'Jul 18–24, 2027');
    assert.equal(weekHeadline('2027-07-25'), 'Jul 25–31, 2027');
    assert.equal(weekHeadline('2027-08-01'), 'Aug 1–7, 2027');
    assert.equal(weekHeadline('2027-07-28'.replace('28', '25')), 'Jul 25–31, 2027');
    assert.equal(weekHeadline('2027-11-28'), 'Nov 28 – Dec 4, 2027', 'a week across a month');
    assert.equal(weekDateWords('2027-07-18', 3), 'Jul 21');
  } finally { wkEnd(); }
});

test('while the schedule is the original, the screen is a preview with the owner\'s door; the dates stay editable', () => {
  wkStart({ off: true });
  try {
    renderWeekScreen();
    assert.equal(setupEl('week-door').hidden, false);
    assert.equal(setupEl('week-door-btn').hidden, true, 'a director who is not the owner: no button');
    assert.equal(setupEl('week-door-owner').hidden, false);
    assert.ok(/turns on editing\.$/.test(setupEl('week-door-owner-text').textContent));
    authUser = WK_OWNER;
    renderWeekScreen();
    assert.equal(setupEl('week-door-btn').hidden, false);
    assert.equal(setupEl('week-door-btn').textContent, 'Edit the week here');
    assert.equal(setupEl('week-door-owner').hidden, true);
    weekTick(3, 'own');
    assert.equal(setupMapOf(setupTree.days.wed).typical, false, 'a tick on a preview changes nothing (and the original week has no setup tree)');
    assert.deepEqual(Object.keys(setupMapOf(setupTree.dayBlocks)), []);
    weekSetStart('2027-07-18');
    assert.equal(setupTree.meta.weekStart, '2027-07-18', 'the camp week\'s own setting is editable before editing is turned on');
  } finally { wkEnd(); }
});

test('Starts on: only a Sunday is accepted, in words; a good date is one undoable change', () => {
  wkStart();
  try {
    weekSetStart('2027-07-19'); // a Monday
    assert.equal(setupEl('week-start-error').hidden, false);
    assert.ok(/Sunday/.test(setupEl('week-start-error').textContent));
    assert.equal(setupTree.meta.weekStart, undefined);
    weekSetStart('');
    assert.equal(setupEl('week-start-error').hidden, false);
    weekSetStart('2027-07-18');
    assert.equal(setupEl('week-start-error').hidden, true);
    assert.equal(setupTree.meta.weekStart, '2027-07-18');
    assert.equal(undoRecent()[0].label, 'Camp starts Sun Jul 18');
    assert.equal(undoRecent()[0].ops[0][0], 'setup');
  } finally { wkEnd(); }
});

test('the TV finale day is saved as meta/finaleDow; double points are fixed in the legacy week and read as such', () => {
  wkStart();
  try {
    renderWeekScreen();
    assert.equal(setupEl('week-double-legacy').hidden, false, 'no epoch: the legacy window');
    assert.equal(setupEl('week-double-box').hidden, true);
    assert.ok(/fixed \(Thu Jul 23, 5 PM – end of Fri Jul 24, 2026\)\. A new window takes effect with the new-year setup\./.test(setupEl('week-double-legacy-text').textContent), setupEl('week-double-legacy-text').textContent);
    weekSetFinale('4');
    assert.equal(setupTree.meta.finaleDow, 4);
    weekSetFinale('9');
    assert.equal(setupTree.meta.finaleDow, 4, 'not a day: ignored');
    state.meta.epoch = 'w20270718';
    renderWeekScreen();
    assert.equal(setupEl('week-double-legacy').hidden, true, 'a wizard epoch: the form');
    assert.equal(setupEl('week-double-box').hidden, false);
    setupEl('week-double-from').value = '4';
    setupEl('week-double-until').value = '6';
    setupEl('week-double-at').value = '17:00';
    weekSaveDouble(true);
    assert.deepEqual(wkClone(setupTree.meta.double), { fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 });
    setupEl('week-double-until').value = '4';
    weekSaveDouble(true);
    assert.equal(setupEl('week-double-note').hidden, false, 'it has to end after it starts');
    assert.equal(setupTree.meta.double.toDow, 6);
    weekSaveDouble(false);
    assert.equal(setupTree.meta.double, undefined);
  } finally { delete state.meta.epoch; wkEnd(); }
});

test('a tick gives a day its own schedule (confirmed), and ticking it back asks, saves a restore point and re-homes the games, as ONE undo entry', async () => {
  wkStart();
  const realAsk = askDialog;
  const realSave = restoreSave;
  const asked = [];
  const saved = [];
  askDialog = async (o) => { asked.push(o.title); return 'go'; };
  restoreSave = async (kind, label) => { saved.push(kind + ':' + label); return { ok: true }; };
  try {
    const dow = 3;
    assert.equal(setupTree.days.wed.typical, true);
    weekTick(dow, 'typical'); // already so: nothing
    assert.deepEqual(asked, []);
    await schedGiveOwn(dow);
    assert.deepEqual(asked, ['Give Wednesday its own schedule?']);
    assert.equal(setupTree.days.wed.typical, false);
    const typicalId = Object.keys(setupTree.typical)[0];
    assert.ok(setupTree.dayBlocks.wed[typicalId], 'the same ids');
    // a game that sits on an item only Wednesday has
    const added = schedCommit({ kind: 'add', dk: 'wed', scope: 'day', item: { label: 'Rain games', emoji: '🎲', start: 780, end: 840, type: 'games' }, label: 'x' });
    const dayId = competitionDays().find((d) => d.dow === dow).id;
    const game = allGames().find((g) => g.dayId === dayId);
    game.blockId = added.id; game.ord = 10;
    undoClear();
    await schedMakeFollowAgain(dow);
    assert.equal(asked[1], 'Make Wednesday follow the typical day again?');
    assert.deepEqual(saved, ['pre-delete:Before Wednesday follows the typical day'], 'the restore point first');
    assert.equal(setupTree.days.wed.typical, true);
    assert.equal(game.blockId, undefined, 'its game is listed as not on the schedule');
    assert.ok(unscheduledGames(dow).some((g) => g.id === game.id));
    const entries = undoRecent();
    assert.equal(entries.length, 1, 'one entry for the setup and the games together');
    assert.deepEqual([...new Set(entries[0].ops.map((o) => o[0]))].sort(), ['config', 'setup']);
    undoEntry(entries[0].id);
    assert.equal(setupTree.days.wed.typical, false, 'Undo puts the day back');
    assert.equal(gameById(game.id).blockId, added.id, 'and the game back on its item');
  } finally { askDialog = realAsk; restoreSave = realSave; wkEnd(); }
});

test('declining the question writes nothing; a restore point that cannot be saved stops a destructive change', async () => {
  wkStart();
  const realAsk = askDialog;
  const realSave = restoreSave;
  try {
    askDialog = async () => 'no';
    await schedGiveOwn(2);
    assert.equal(setupTree.days.tue.typical, true);
    schedCommit({ kind: 'own', dk: 'tue', blocks: planForDow(2), label: 'x' });
    await schedMakeFollowAgain(2);
    assert.equal(setupTree.days.tue.typical, false, 'declined');
    askDialog = async () => 'go';
    restoreSave = async () => ({ ok: false, reason: 'manual-full' });
    await schedMakeFollowAgain(2);
    assert.equal(setupTree.days.tue.typical, false, 'no restore point, no delete');
    restoreSave = async () => ({ ok: false, reason: 'offline' });
    await schedMakeFollowAgain(2);
    assert.equal(setupTree.days.tue.typical, true, 'a device with no sync has nowhere to keep one: it goes on');
  } finally { askDialog = realAsk; restoreSave = realSave; wkEnd(); }
});

test('Edit the week here: only the owner, a question first, then the camp-week freeze as a question; every refusal is a sentence', async () => {
  wkStart({ owner: true, off: true });
  const realAsk = askDialog;
  const realOn = setupTurnOn;
  const toasts = [];
  const realToast = showToast;
  showToast = (m) => { toasts.push(m); };
  try {
    // another director: the owner's name, and nothing runs
    authUser = { email: 'jenn@example.com', emailVerified: true };
    let called = 0;
    setupTurnOn = async () => { called++; return { ok: true }; };
    askDialog = async () => 'go';
    const r0 = await setupEditTheWeek();
    assert.equal(r0.ok, false);
    assert.equal(called, 0);
    assert.ok(/^Only .* can turn on editing\.$/.test(toasts[0]), toasts[0]);
    authUser = WK_OWNER;
    // Not yet at the first question: nothing is written
    askDialog = async () => 'no';
    assert.equal((await setupEditTheWeek()).reason, 'cancelled');
    assert.equal(called, 0);
    // No date set -> "Is a camp week running?" -> not yet -> on
    const answers = ['go', 'no'];
    const titles = [];
    askDialog = async (o) => { titles.push(o.title); return answers.shift(); };
    const seq = [{ ok: false, reason: 'ask-camp-week' }, { ok: true, turnedOn: ['schedule'], attach: { attached: 22, unplaced: [] } }];
    const optsSeen = [];
    setupTurnOn = async (sections, opts) => { optsSeen.push(Object.assign({}, opts)); return seq.shift(); };
    const r1 = await setupEditTheWeek();
    assert.equal(r1.ok, true);
    assert.deepEqual(titles.map((t) => /week here\?$/.test(t) ? 'edit' : t), ['edit', 'Is a camp week running right now?']);
    assert.deepEqual(optsSeen, [{}, { campRunning: false }]);
    assert.equal(toasts[toasts.length - 1], 'Editing is on for ' + campWord() + '. 22 games put on the schedule.');
    // A running week: the freeze, then the owner may say they know
    const ans2 = ['go', 'go'];
    const seq2 = [{ ok: false, reason: 'camp-week' }, { ok: true, turnedOn: ['schedule'], attach: null }];
    const opts2 = [];
    askDialog = async () => ans2.shift();
    setupTurnOn = async (sections, opts) => { opts2.push(Object.assign({}, opts)); return seq2.shift(); };
    assert.equal((await setupEditTheWeek()).ok, true);
    assert.deepEqual(opts2, [{}, { overrideCampWeek: true }]);
    // ...or waits
    const ans3 = ['go', 'wait'];
    askDialog = async () => ans3.shift();
    setupTurnOn = async () => ({ ok: false, reason: 'camp-week' });
    assert.equal((await setupEditTheWeek()).reason, 'cancelled');
    // every other refusal is a plain sentence
    for (const reason of ['loading', 'denied', 'schema', 'tab', 'offline', 'already', 'restore-point', 'refused', 'failed']) {
      toasts.length = 0;
      askDialog = async () => 'go';
      setupTurnOn = async () => ({ ok: false, reason });
      await setupEditTheWeek();
      assert.equal(toasts[0], TURNON_WHY[reason], reason);
      assert.ok(/[a-z]\.$/.test(toasts[0]), reason + ' says it in a sentence');
    }
  } finally { askDialog = realAsk; setupTurnOn = realOn; showToast = realToast; wkEnd(); }
});

test('Use the original week again: asks, then the switch goes false and the edits stay; only the owner', async () => {
  wkStart({ owner: true });
  const realAsk = askDialog;
  const toasts = [];
  const realToast = showToast;
  showToast = (m) => { toasts.push(m); };
  try {
    assert.equal(scheduleIsShared(), true);
    assert.equal(SETUP_OWNER_ACTIONS.original.why(), '');
    askDialog = async () => 'no';
    assert.equal((await setupUseOriginalFlow()).reason, 'cancelled');
    assert.equal(scheduleIsShared(), true);
    askDialog = async () => 'go';
    const r = await setupUseOriginalFlow();
    assert.equal(r.ok, true);
    assert.equal(scheduleIsShared(), false, 'everyone reads the built-in week again');
    assert.ok(Object.keys(setupTree.typical).length > 0, 'and the edits are kept');
    assert.equal(SETUP_OWNER_ACTIONS.original.why(), 'Already using the original week.');
    assert.ok(/original week/.test(toasts[toasts.length - 1]));
    authUser = { email: 'jenn@example.com', emailVerified: true };
    toasts.length = 0;
    assert.equal((await setupUseOriginalFlow()).reason, 'owner');
    assert.ok(/^Only .* can switch back to the original week\.$/.test(toasts[0]), toasts[0]);
  } finally { askDialog = realAsk; showToast = realToast; wkEnd(); }
});
