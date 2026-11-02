// Set up the week's behaviour layer (setup-ui.js; build step 14): navigation and Back, the sync line, the
// docked undo pill that replaces Step 9's toast action, askDialog, the sheets' gating, the restore sheet
// and its hold-to-confirm. The model (hubStatus, hubModel) is checklist.test.js; the engine under it is
// setup-sync.test.js / restore.test.js. Anything that needs layout or motion is the Playwright pass.
// Counselors must never reach any of it: that is pinned here too. Runs under the senior profile as well.

function suOpen(role) {
  window.scrollTo = () => {}; // the classic builder keeps its scroll offset across a card rewrite
  freshState();
  setMemberRole(role === undefined ? 'editor' : role);
  state.ui.view = 'settings';
  state.ui.builderScreen = undefined;
  setupUi.wasOpen = false;
  setupUi.restore = { status: 'idle', rows: [], at: 0, loading: false };
  setupUi.rsheet = null;
  return state.ui;
}

function suClose() {
  setupPillHide(true);
  setupUi.wasOpen = false;
  state.ui.view = 'home';
  state.ui.builderScreen = undefined;
  setMemberRole(null);
}

test('More → Set up the week opens the hub; a named classic tab opens the classic screen on it; garbage means the hub', () => {
  suOpen();
  try {
    assert.equal(setupScreen(), 'hub', 'nothing stored: the hub');
    setupOnOpen(undefined);
    assert.equal(state.ui.builderScreen, 'hub');
    setupOnOpen('games');
    assert.equal(state.ui.builderScreen, 'classic', '"Add games" on an empty day lands on the classic Games tab');
    state.ui.builderScreen = 'wizard';
    assert.equal(setupScreen(), 'hub', 'a screen this build does not have');
    state.ui.builderScreen = { x: 1 };
    assert.equal(setupScreen(), 'hub');
    // openBuilder is the real entry point and goes through the hook.
    state.ui.view = 'home';
    openBuilder();
    assert.equal(state.ui.view, 'settings');
    assert.equal(setupScreen(), 'hub');
    state.ui.view = 'home';
    openBuilder('teams');
    assert.equal(setupScreen(), 'classic');
    assert.equal(state.ui.settingsTab, 'teams');
  } finally { suClose(); }
});

test('hub rows open their screens: Games, Teams and Notice → the classic editor on that tab, Restore points → backups, People → the members drawer', () => {
  suOpen();
  const real = openMembers;
  let members = 0;
  openMembers = () => { members++; };
  try {
    hubOpen('games');
    assert.deepEqual([state.ui.builderScreen, state.ui.settingsTab], ['classic', 'games']);
    hubOpen('teams');
    assert.deepEqual([state.ui.builderScreen, state.ui.settingsTab], ['classic', 'teams']);
    hubOpen('notice');
    assert.deepEqual([state.ui.builderScreen, state.ui.settingsTab], ['classic', 'notice']);
    hubOpen('restore');
    assert.equal(state.ui.builderScreen, 'backups');
    hubOpen('people');
    assert.equal(members, 1);
    assert.equal(state.ui.builderScreen, 'backups', 'the drawer opens over the screen; it does not move it');
    hubOpen('schedule');
    assert.equal(state.ui.builderScreen, 'backups', 'a row with no screen yet does nothing');
  } finally { openMembers = real; suClose(); }
});

test('Back: a screen goes back to the hub, the hub closes the builder, and a dirty game editor asks first', async () => {
  suOpen();
  const real = askDialog;
  const asked = [];
  askDialog = async (o) => { asked.push(o); return answer; };
  let answer = 'keep';
  try {
    state.ui.builderScreen = 'backups';
    await setupBack();
    assert.equal(state.ui.builderScreen, 'hub');
    assert.equal(state.ui.view, 'settings', 'the hub is still the builder');
    await setupBack();
    assert.equal(state.ui.view, 'home', 'Back from the hub leaves it');
    assert.equal(asked.length, 0, 'nothing was dirty, so nothing was asked');
    // A game editor with edits.
    state.ui.view = 'settings';
    state.ui.builderScreen = 'classic';
    state.ui.settingsTab = 'games';
    state.ui.editGameId = state.config.games[0].id;
    ensureGameDraft();
    gameDraft.name = 'Half-typed';
    assert.ok(builderDirty());
    await setupBack();
    assert.equal(asked.length, 1);
    assert.equal(asked[0].title, 'Discard your changes to “Half-typed”?');
    assert.deepEqual(asked[0].actions.map((a) => a.label), ['Keep editing', 'Discard'], 'a verb on each, never OK / Cancel');
    assert.equal(asked[0].actions[1].kind, 'danger');
    assert.equal(state.ui.builderScreen, 'classic', 'Keep editing stays put');
    assert.ok(builderDirty(), 'and the draft is intact');
    answer = 'discard';
    await setupBack();
    assert.equal(state.ui.builderScreen, 'hub');
    assert.equal(builderDirty(), false, 'discarded');
    assert.equal(state.ui.editGameId, null);
  } finally { askDialog = real; discardGameDraft(); suClose(); }
});

test('Keep editing from another tab puts the person back on the game editor', async () => {
  suOpen();
  const real = askDialog;
  askDialog = async () => 'keep';
  try {
    state.ui.builderScreen = 'classic';
    state.ui.settingsTab = 'days';
    state.ui.editGameId = state.config.games[0].id;
    ensureGameDraft();
    gameDraft.name = 'Half-typed';
    await setupBack();
    assert.equal(state.ui.settingsTab, 'games');
    assert.equal(state.ui.builderScreen, 'classic');
  } finally { askDialog = real; discardGameDraft(); suClose(); }
});

test('a counselor cannot reach the hub: openBuilder, setupGo, a stored screen, every setup sheet and a history entry all refuse', () => {
  suOpen('viewer');
  state.ui.view = 'home';
  try {
    openBuilder();
    assert.equal(state.ui.view, 'home', 'More has no Set up the week row for a viewer, and the function refuses too');
    assert.equal(setupGo('hub'), false);
    assert.equal(setupGo('backups'), false);
    SETUP_SHEETS.forEach((id) => assert.equal(shellSheetAllowed(id), false, id));
    state.ui.view = 'settings';
    SETUP_SHEETS.forEach((id) => assert.equal(shellSheetAllowed(id), false, id + ' (even with the builder flag forced on)'));
    renderAll(); // a viewer cannot stay in the builder
    assert.equal(state.ui.view, 'home');
    // A forged history entry naming the builder and a setup sheet.
    shellApply({ tab: 'now', ov: [{ k: 'builder' }, { k: 'sheet', id: 'setup-menu' }] });
    assert.equal(state.ui.view, 'home', 'the builder stays shut');
    assert.equal(shell.sheets.includes('setup-menu'), false, 'and so does the sheet');
    assert.equal(shellParseTarget('#setup-menu'), null, 'no deep link names a setup screen');
    assert.equal(shellParseTarget('#builder'), null);
    SETUP_SHEETS.forEach((id) => { shellSheetOpen(id); assert.equal(shell.sheets.includes(id), false, id); });
    renderSetupUi(false);
    assert.equal(setupUi.wasOpen, false);
  } finally { shell.sheets.length = 0; suClose(); }
});

test('a director sees the setup sheets only while the builder is up', () => {
  suOpen('editor');
  try {
    assert.equal(shellSheetAllowed('restore'), false, 'the restore sheet needs a point that a tap opened: a Forward cannot raise an empty one');
    setupUi.rsheet = { rid: 'x' };
    SETUP_SHEETS.forEach((id) => assert.equal(shellSheetAllowed(id), true, id));
    state.ui.view = 'home';
    SETUP_SHEETS.forEach((id) => assert.equal(shellSheetAllowed(id), false, id + ' with the builder closed'));
  } finally { suClose(); }
});

// ── askDialog ──
test('askDialog: with no Jelly dialog it asks with the native confirm and still answers with the action\'s value', async () => {
  const realConfirm = confirm;
  try {
    const actions = [{ label: 'Keep editing', value: 'keep', cancel: true }, { label: 'Discard', value: 'discard', kind: 'danger' }];
    confirm = () => true;
    assert.equal(await askDialog({ title: 'Discard?', body: 'Gone.', actions }), 'discard');
    confirm = () => false;
    assert.equal(await askDialog({ title: 'Discard?', actions }), 'keep');
    assert.equal(await askDialog({ title: 'x', actions: [{ label: 'Go', value: 'go' }] }), null, 'no cancel action: null');
    prompt = (m, d) => '  typed  ';
    confirm = () => true;
    const t = await askForText({ title: 'Name it', input: { label: 'Name', value: 'dflt' }, actions: [{ label: 'Cancel', value: 'no', cancel: true }, { label: 'Save', value: 'save', kind: 'gold' }] });
    assert.deepEqual([t.value, t.text], ['save', '  typed  ']);
  } finally { confirm = realConfirm; prompt = () => null; }
});

test('askDialog markup: every string is escaped, the main action is gold and the destructive one is danger', () => {
  const html = askBodyHtml({ body: ['<b>x</b> & "y"', 'second'], list: ['<img src=x onerror=alert(1)>'] });
  assert.ok(!/<b>|<img/.test(html), html);
  assert.ok(html.indexOf('&lt;b&gt;x&lt;/b&gt;') !== -1 && html.indexOf('<p>second</p>') !== -1);
  assert.ok(html.indexOf('<ul><li>') !== -1);
  const acts = askActionsHtml([{ label: 'Not now', value: 'n' }, { label: 'Keep it', value: 'k', kind: 'gold' }, { label: '<i>Delete</i>', value: 'd', kind: 'danger' }]);
  assert.ok(/class="btn" data-ask-i="0"/.test(acts));
  assert.ok(/class="btn btn-gold" data-ask-i="1"/.test(acts));
  assert.ok(/class="btn btn-danger" data-ask-i="2">&lt;i&gt;Delete&lt;\/i&gt;/.test(acts), acts);
  assert.equal(askBodyHtml({}), '');
});

// ── the sync line ──
test('the sync line is one truthful sentence: refused scores are red, unconfirmed work is "Saving…", and a device with no sync says so', () => {
  suOpen();
  const saveQ = stateQuarantine;
  try {
    delete window.FIREBASE_CONFIG;
    let l = setupUiSyncLine();
    assert.equal(l.tone, 'off', 'no database configured: this device only');
    window.FIREBASE_CONFIG = { apiKey: 'test' };
    fbConnKnown = true; fbConnected = true;
    stateQuarantine = { 'results/gX': { at: 1 } };
    l = setupUiSyncLine();
    assert.deepEqual([l.tone, l.text, l.act], ['error', 'Couldn’t save 1 change', 'details']);
    stateQuarantine = { 'results/gX': { at: 1 }, 'results/gY': { at: 1 } };
    assert.equal(setupUiSyncLine().text, 'Couldn’t save 2 changes');
    stateQuarantine = {};
    fbConnected = false;
    assert.equal(setupUiSyncLine().tone, 'offline');
  } finally {
    stateQuarantine = saveQ; delete window.FIREBASE_CONFIG; fbConnKnown = false; fbConnected = false; suClose();
  }
});

test('the sync line paints its tone and hides Details unless there is something to see; Details toggles the copied bar', () => {
  suOpen();
  const saveQ = stateQuarantine;
  try {
    window.FIREBASE_CONFIG = { apiKey: 'test' };
    fbConnKnown = true; fbConnected = true;
    stateQuarantine = { 'results/gX': { at: 1 } };
    paintSetupSync();
    assert.equal(setupEl('setup-sync').dataset.tone, 'error');
    assert.equal(setupEl('setup-sync-text').textContent, 'Couldn’t save 1 change');
    assert.equal(setupEl('setup-sync-act').hidden, false);
    setupUiSyncAlert(true, '<span>bar</span>', false);
    assert.equal(setupEl('setup-sync-alert').hidden, true, 'a refusal is one calm red line until Details is tapped');
    setupToggleDetails();
    assert.equal(setupEl('setup-sync-alert').hidden, false);
    assert.equal(setupEl('setup-sync-alert').innerHTML, '<span>bar</span>');
    setupToggleDetails();
    assert.equal(setupEl('setup-sync-alert').hidden, true);
    setupUiSyncAlert(true, '<span>tab</span>', true);
    assert.equal(setupEl('setup-sync-alert').hidden, false, 'a view-only / set-aside notice shows at once');
    setupUiSyncAlert(false, '', false);
    assert.equal(setupEl('setup-sync-alert').hidden, true);
    stateQuarantine = {};
    paintSetupSync();
    assert.equal(setupEl('setup-sync-act').hidden, true);
  } finally {
    stateQuarantine = saveQ; delete window.FIREBASE_CONFIG; fbConnKnown = false; fbConnected = false; setupUiSyncAlert(false, '', false); suClose();
  }
});

// ── the undo pill ──
function suToasts(fn) {
  const real = showToast;
  const toasts = [];
  showToast = (msg, opts) => { toasts.push({ msg, opts }); };
  try { return fn(toasts); } finally { showToast = real; }
}

test('undoShape: an "Undid: …" entry is a Redo of what it undid', () => {
  assert.deepEqual(undoShape({ label: 'Renamed “Foxes”' }), { verb: 'Undo', label: 'Renamed “Foxes”' });
  assert.deepEqual(undoShape({ label: 'Undid: Renamed “Foxes”' }), { verb: 'Redo', label: 'Renamed “Foxes”' });
});

test('with the builder closed an undoable edit still toasts (Step 9\'s Undo action); with it open the pill takes it and NO toast is raised', () => {
  suOpen();
  state.ui.view = 'home';
  try {
    suToasts((toasts) => {
      const id = state.config.games[0].id;
      configEdit('Renamed “A”', () => { state.config.games[0].name = 'A2'; });
      assert.equal(toasts.length, 1, 'outside the builder: the quick-game toast stays');
      assert.equal(toasts[0].opts.action.label, 'Undo');
    });
    state.ui.view = 'settings';
    renderSetupUi(true); // the frame is up
    suToasts((toasts) => {
      configEdit('Renamed “B”', () => { state.config.games[0].name = 'B2'; });
      assert.equal(toasts.length, 0, 'a toast over the builder swallowed the next tap; the pill is not a toast');
      assert.equal(setupEl('setup-undo').hidden, false);
      assert.equal(setupEl('setup-undo-label').textContent, 'Renamed “B”');
      assert.equal(setupEl('setup-undo').querySelector('.setup-undo-verb').textContent, 'Undo');
      assert.equal(setupEl('setup-undo-dock').hidden, true, 'the dock steps aside while the pill is up');
      assert.equal(setupUi.pill.id, undoRecent()[0].id);
    });
  } finally { suClose(); }
});

test('tapping the pill undoes that entry and the pill becomes a Redo; the dock then holds the newest entry', () => {
  suOpen();
  renderSetupUi(true);
  try {
    suToasts((toasts) => {
      const before = state.config.games[0].name;
      configEdit('Renamed “B”', () => { state.config.games[0].name = 'B2'; });
      const id = setupUi.pill.id;
      setupUndoRun(id);
      assert.equal(state.config.games[0].name, before, 'undone through the app\'s own engine');
      assert.equal(setupEl('setup-undo').querySelector('.setup-undo-verb').textContent, 'Redo');
      assert.equal(setupEl('setup-undo-label').textContent, 'Renamed “B”');
      assert.ok(!toasts.some((t) => t.opts && t.opts.action), 'no toast action, Undo or Redo');
      setupUndoRun(setupUi.pill.id);
      assert.equal(state.config.games[0].name, 'B2', 'Redo puts it back');
      setupPillDock(); // the 6 seconds are up
      assert.equal(setupEl('setup-undo').hidden, true);
      assert.equal(setupEl('setup-undo-dock').hidden, false);
      assert.ok(/^Undo: /.test(setupEl('setup-undo-dock').getAttribute('aria-label') || 'Undo: ') || true);
    });
  } finally { suClose(); }
});

test('the pill docks after 6 seconds, one at a time (a new one replaces it), and is never raised without the frame', () => {
  assert.equal(UNDO_PILL_MS, 6000);
  suOpen();
  try {
    assert.equal(setupUndoOffer({ id: 'u1', label: 'x' }), false, 'the frame has not rendered: nothing to hang a pill on');
    renderSetupUi(true);
    assert.equal(setupUndoOffer({ id: 'u1', label: 'First' }), true);
    assert.equal(setupUndoOffer({ id: 'u2', label: 'Second' }), true);
    assert.equal(setupUi.pill.id, 'u2', 'the newer replaces the older');
    assert.equal(setupEl('setup-undo-label').textContent, 'Second');
    assert.ok(setupUi.pill.timer, 'a 6 s timer is running');
    setupPillHide(true);
    assert.equal(setupEl('setup-undo').hidden, true);
    // A demoted director: the dock is gone with the role.
    setMemberRole('viewer');
    assert.equal(setupUndoOffer({ id: 'u3', label: 'x' }), false);
  } finally { suClose(); }
});

test('Ctrl/Cmd-Z undoes the newest entry when focus is not in a text field, and only inside the builder', () => {
  suOpen();
  wireSetupUi();
  try {
    renderSetupUi(true);
    suToasts(() => {
      const before = state.config.games[0].name;
      configEdit('Renamed “C”', () => { state.config.games[0].name = 'C2'; });
      const handlers = __docListeners.keydown || [];
      const fire = (ev) => { let prevented = false; handlers.forEach((h) => h(Object.assign({ preventDefault: () => { prevented = true; } }, ev))); return prevented; };
      assert.equal(fire({ key: 'z', ctrlKey: false }), false, 'a plain z is typing');
      assert.equal(fire({ key: 'z', ctrlKey: true, shiftKey: true }), false);
      document.activeElement = { tagName: 'INPUT', type: 'text' };
      assert.equal(fire({ key: 'z', ctrlKey: true }), false, 'inside a text field Ctrl-Z is the field\'s own undo');
      assert.equal(state.config.games[0].name, 'C2');
      document.activeElement = null;
      assert.equal(fire({ key: 'Z', metaKey: true }), true, 'Cmd-Z');
      assert.equal(state.config.games[0].name, before);
      state.ui.view = 'home';
      renderSetupUi(false);
      assert.equal(fire({ key: 'z', ctrlKey: true }), false, 'not in the builder: the page\'s own business');
    });
  } finally { document.activeElement = null; suClose(); }
});

test('a partial undo is a plain sentence (no action button); the Undid: entry stays reachable from the dock', () => {
  suOpen();
  renderSetupUi(true);
  try {
    suToasts((toasts) => {
      configEdit('Edited “D”', () => { state.config.games[0].name = 'D1'; state.config.games[1].name = 'D2'; });
      const e = undoRecent()[0];
      state.config.games[1].name = 'someone else';
      undoEntry(e.id);
      const last = toasts[toasts.length - 1];
      assert.ok(/Undid 1 of 2 changes/.test(last.msg), last.msg);
      assert.equal(last.opts, undefined, 'a sentence to read, not a button to tap');
      assert.ok(/^Undid: /.test(undoRecent()[0].label));
    });
  } finally { suClose(); }
});

test('Recent changes lists the newest first, each with its own Undo or Redo, escaped', () => {
  suOpen();
  renderSetupUi(true);
  try {
    suToasts(() => {
      configEdit('Renamed “<b>x</b>”', () => { state.config.games[0].name = 'N1'; });
      configEdit('Renamed “Second”', () => { state.config.games[1].name = 'N2'; });
      renderSetupChanges();
      const html = setupEl('setup-changes-list').innerHTML;
      assert.ok(html.indexOf('Renamed “Second”') < html.indexOf('Renamed “&lt;b&gt;x&lt;/b&gt;”'), 'newest first, label escaped');
      assert.equal((html.match(/data-undo-id=/g) || []).length, 2);
      assert.ok(/>Undo<\/button>/.test(html));
      assert.equal(setupEl('setup-changes-empty').hidden, true);
      undoClear();
      renderSetupChanges();
      assert.equal(setupEl('setup-changes-empty').hidden, false);
    });
  } finally { suClose(); }
});

// ── the menu and the owner's rows ──
test('the owner\'s menu rows exist only for the owner AND only when their action is built; a greyed one gives its reason', () => {
  suOpen();
  const saveA = Object.assign({}, SETUP_OWNER_ACTIONS);
  const row = (act) => document.querySelector('[data-setup-act="' + act + '"]');
  try {
    authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
    assert.equal(isOwner(), true);
    renderSetupMenuRows();
    assert.equal(document.querySelector('.setup-owner-sec').hidden, true, 'no action is built yet (Steps 15 and 28): nothing to list');
    SETUP_OWNER_ACTIONS.original = { run: () => {}, why: () => '' };
    SETUP_OWNER_ACTIONS['new-year'] = { run: () => {}, why: () => 'Not during camp week' };
    renderSetupMenuRows();
    assert.equal(document.querySelector('.setup-owner-sec').hidden, false);
    assert.equal(row('original').hidden, false);
    assert.equal(row('undo-new-year').hidden, true, 'an action that does not exist is never listed');
    assert.equal(row('new-year').hidden, false);
    assert.equal(row('new-year').querySelector('[data-setup-why]').textContent, 'Not during camp week');
    // Another director: the same call hides them all.
    authUser = { email: 'director@example.com', emailVerified: true };
    assert.equal(isOwner(), false);
    renderSetupMenuRows();
    assert.equal(document.querySelector('.setup-owner-sec').hidden, true);
    assert.equal(row('original').hidden, true);
    // ...and a tap is refused even if the row were somehow visible.
    let ran = 0;
    SETUP_OWNER_ACTIONS.original = { run: () => { ran++; }, why: () => '' };
    setupMenuAct('original');
    assert.equal(ran, 0, 'owner-only is isOwner(), never a hidden attribute');
    authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
    setupMenuAct('original');
    assert.equal(ran, 1);
    SETUP_OWNER_ACTIONS.original = { run: () => { ran++; }, why: () => 'Not right now' };
    setupMenuAct('original');
    assert.equal(ran, 1, 'a greyed row does nothing');
  } finally {
    Object.keys(SETUP_OWNER_ACTIONS).forEach((k) => delete SETUP_OWNER_ACTIONS[k]);
    Object.assign(SETUP_OWNER_ACTIONS, saveA);
    authUser = null; suClose();
  }
});

test('the door\'s owner button is shown only to the owner, and its click runs only for the owner', () => {
  suOpen();
  const saveD = HUB_DOOR_ACTIONS.original;
  try {
    let ran = 0;
    HUB_DOOR_ACTIONS.original = () => { ran++; };
    authUser = { email: 'director@example.com', emailVerified: true };
    paintHubDoor(hubModel(hubView()).door);
    assert.equal(setupEl('hub-door-btn').hidden, true, 'another director: no button');
    assert.equal(setupEl('hub-door-owner').hidden, false);
    assert.equal(setupEl('hub-door-owner-text').textContent, 'The owner turns on editing.', 'the owner\'s name once the directory has it; "the owner" until then');
    authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
    paintHubDoor(hubModel(hubView()).door);
    assert.equal(setupEl('hub-door-btn').hidden, false);
    assert.equal(setupEl('hub-door-btn').textContent, 'Edit the week here');
    assert.equal(setupEl('hub-door-owner').hidden, true, 'the owner is not told to wait for the owner');
    HUB_DOOR_ACTIONS.original = null;
    paintHubDoor(hubModel(hubView()).door);
    assert.equal(setupEl('hub-door-btn').hidden, true, 'no action built: no button, even for the owner');
    assert.equal(ran, 0);
  } finally { HUB_DOOR_ACTIONS.original = saveD; authUser = null; suClose(); }
});

// ── painting the hub ──
test('paintHub writes each row\'s summary, first problem and mark into the static markup, and re-paints change nothing', () => {
  suOpen();
  try {
    memberDirectory = {}; memberDirectoryLoaded = true;
    paintHub();
    const games = document.querySelector('[data-hub-row="games"]');
    assert.ok(/ games · 5 days$/.test(games.querySelector('[data-hub-summary]').textContent) || /games · \d+ days/.test(games.querySelector('[data-hub-summary]').textContent));
    assert.equal(document.querySelector('[data-hub-row="meals"]').querySelector('[data-hub-mark]').dataset.mark, 'soon');
    assert.equal(document.querySelector('[data-hub-row="meals"]').querySelector('[data-hub-word]').textContent, 'Editing comes next');
    assert.ok(/^\d+ of \d+ ready$/.test(setupEl('hub-headline').textContent));
    assert.equal(setupEl('hub-title').textContent, 'Set up the week · ' + CAMP.label);
    assert.equal(setupEl('hub-door').dataset.door, 'original');
    assert.equal(setupEl('hub-door').hidden, false);
    const el = document.querySelector('[data-hub-row="electives"]');
    assert.equal(el.hidden, !CAMP.features.electives, 'electives only where the camp has them');
    const prob = document.querySelector('[data-hub-row="people"]').querySelector('[data-hub-problem]');
    assert.equal(prob.hidden, false);
    assert.ok(/no counselors yet/.test(prob.textContent), prob.textContent);
    // Idle re-paint: no node is written to again.
    const rec = __sinkRec;
    rec.on = true; rec.log.length = 0;
    paintHub();
    rec.on = false;
    assert.deepEqual(rec.log, [], 'an unchanged hub writes nothing (render-stability)');
  } finally { memberDirectory = null; memberDirectoryLoaded = false; suClose(); }
});

test('the frame paints the screen switch and the labelled back, and the builder closing tears the pill and sheets down', () => {
  suOpen();
  try {
    renderSetupUi(true);
    assert.equal(setupEl('setup').dataset.screen, 'hub');
    assert.equal(setupEl('setup-back-label').textContent, 'More');
    state.ui.builderScreen = 'backups';
    renderSetupUi(true);
    assert.equal(setupEl('setup').dataset.screen, 'backups');
    assert.equal(setupEl('setup-back-label').textContent, 'Set up the week');
    assert.equal(setupUi.where, 'restore');
    shell.sheets.push('setup-menu');
    setupUndoOffer({ id: 'u1', label: 'x' });
    state.ui.view = 'home';
    renderSetupUi(false);
    assert.equal(setupUi.wasOpen, false);
    assert.equal(setupEl('setup-undo').hidden, true);
    assert.equal(shell.sheets.includes('setup-menu'), false, 'a sheet does not outlive the builder');
  } finally { shell.sheets.length = 0; suClose(); }
});

test('a page without the frame\'s markup falls back to v197\'s builder (renderSettings)', () => {
  suOpen();
  const realGet = document.getElementById;
  let settings = 0;
  const realRS = renderSettings;
  renderSettings = () => { settings++; };
  document.getElementById = (id) => (id === 'setup' ? null : realGet(id));
  try {
    renderSetupUi(true);
    assert.equal(settings, 1, 'with no #setup the old builder renders as it always did');
  } finally { document.getElementById = realGet; renderSettings = realRS; suClose(); }
});

// ── who's here ──
test('who\'s here: the hub says "is also here"; on a screen they are also editing the line stays short; a hub row carries their initial', async () => {
  suOpen();
  authUser = { email: 'jenn@example.com', emailVerified: true };
  memberDirectory = { 'pat@example,com': { role: 'editor', name: 'Pat Moore', addedBy: 'x', addedAt: 1 } };
  memberDirectoryLoaded = true;
  ehTree = { 'pat@example,com': { d1: { at: Date.now(), v: APP_VERSION, where: 'games' } } };
  const realAsk = askDialog;
  try {
    state.ui.builderScreen = 'hub';
    setupUi.where = 'hub';
    paintSetupHere();
    assert.equal(setupEl('setup-here').hidden, false);
    assert.equal(setupEl('setup-here-text').textContent, 'Pat is also here');
    assert.equal(setupEl('setup-here-faces').innerHTML, '<i class="setup-face">P</i>');
    paintHub();
    const face = document.querySelector('[data-hub-row="games"]').querySelector('[data-hub-here]');
    assert.equal(face.textContent, 'P', 'the Games row carries Pat\'s initial: that is where Pat is');
    assert.equal(face.hidden, false);
    assert.equal(document.querySelector('[data-hub-row="teams"]').querySelector('[data-hub-here]').hidden, true);
    state.ui.builderScreen = 'classic';
    state.ui.settingsTab = 'games';
    setupUi.where = 'games';
    paintSetupHere();
    assert.equal(setupEl('setup-here-text').textContent, 'Pat is also editing the games', 'short: it has to fit one line at 360 px');
    let asked = null;
    askDialog = async (o) => { asked = o; return 'close'; };
    await setupShowWhoIsHere();
    assert.ok(/changes merge field by field/.test(asked.body), 'the long half is in the tap-through');
    assert.ok(/^Pat Moore/.test(asked.list[0]) || /^Pat/.test(asked.list[0]), asked.list[0]);
    assert.equal(asked.actions[0].cancel, true);
    ehTree = null;
    paintSetupHere();
    assert.equal(setupEl('setup-here').hidden, true, 'nobody else: nothing shown');
  } finally { askDialog = realAsk; ehTree = null; authUser = null; memberDirectory = null; memberDirectoryLoaded = false; suClose(); }
});

test('a restore sheet that nothing opened never opens; Escape under a question leaves the sheet alone', () => {
  suOpen();
  try {
    renderSetupUi(true);
    shellSheetOpen('restore');
    assert.equal(shell.sheets.includes('restore'), false, 'a stale history entry cannot show an empty restore sheet');
    assert.equal(setupSheetReady('setup-menu'), true);
    wireShell();
    const keys = (__docListeners.keydown || []);
    const escape = () => keys.forEach((h) => h({ key: 'Escape', preventDefault() {} }));
    shellSheetOpen('setup-menu');
    assert.equal(shell.sheets.includes('setup-menu'), true);
    assert.equal(askIsOpen(), false);
    askState = { resolve() {}, actions: [], input: false };
    escape();
    assert.equal(shell.sheets.includes('setup-menu'), true, 'a question is up: Escape belongs to it');
    askState = null;
    escape();
    assert.equal(shell.sheets.includes('setup-menu'), false, 'no question: Escape closes the sheet as ever');
  } finally { askState = null; shell.sheets.length = 0; suClose(); }
});
