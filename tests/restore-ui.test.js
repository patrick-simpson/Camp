// Restore points on screen (setup-ui.js, build step 14): the list, "Save a restore point now", the restore
// sheet with its section ticks, hold-to-confirm for scores, and the backup file. The engine is restore.test.js;
// here restoreList / restoreSave / restoreRead / restoreApply are the seams. Under the senior profile too.

const RU_ROWS = () => [
  { rid: 'rp-aaaa1', at: Date.now() - 600000, byKey: 'jenn@example,com', kind: 'auto', label: 'Before Jenn’s edits, 3:05 PM', note: '', bytes: 100, hash: 'h', epoch: '', pinned: false },
  { rid: 'rp-aaaa2', at: Date.now() - 3600000, byKey: 'pat@example,com', kind: 'manual', label: '<b>Before the rain plan</b>', note: '', bytes: 100, hash: 'h', epoch: '', pinned: true },
  { rid: 'rp-aaaa3', at: Date.now() - 86400000 * 300, byKey: 'x@y', kind: 'archive', label: '2026 week (junior)', note: '', bytes: 100, hash: 'h', epoch: '', pinned: true },
  { rid: 'rp-aaaa4', at: Date.now() - 7200000, byKey: 'pat@example,com', kind: 'manual', label: 'Saturday ready', note: '', bytes: 100, hash: 'h', epoch: '', pinned: false },
];

function ruOpen() {
  window.scrollTo = () => {};
  freshState();
  setMemberRole('editor');
  state.ui.view = 'settings';
  state.ui.builderScreen = 'backups';
  setupUi.wasOpen = false;
  setupUi.rsheet = null;
  setupUi.restore = { status: 'ok', rows: RU_ROWS(), at: Date.now(), loading: false };
}

function ruClose() {
  setupUi.wasOpen = false;
  setupUi.rsheet = null;
  setupUi.restore = { status: 'idle', rows: [], at: 0, loading: false };
  state.ui.view = 'home';
  state.ui.builderScreen = undefined;
  shell.sheets.length = 0;
  setMemberRole(null);
}

test('the list splits Kept (pinned), Recent and Past years, every label escaped, newest first inside each', () => {
  ruOpen();
  try {
    renderBackups();
    const kept = setupEl('rp-kept').innerHTML;
    const recent = setupEl('rp-list').innerHTML;
    const years = setupEl('rp-years').innerHTML;
    assert.ok(kept.indexOf('&lt;b&gt;Before the rain plan&lt;/b&gt;') !== -1 && kept.indexOf('<b>') === -1, 'the pinned point is Kept, and its label is escaped');
    assert.ok(/i-pin/.test(kept), 'a kept point wears the pin');
    assert.ok(recent.indexOf('Before Jenn’s edits, 3:05 PM') !== -1 && recent.indexOf('Saturday ready') !== -1);
    assert.ok(recent.indexOf('Before Jenn’s edits') < recent.indexOf('Saturday ready'), 'newest first');
    assert.ok(years.indexOf('2026 week (junior)') !== -1, 'an archive is a past year, never "recent"');
    assert.ok(recent.indexOf('2026 week') === -1 && kept.indexOf('2026 week') === -1);
    assert.equal(setupEl('rp-sec-kept').hidden, false);
    assert.equal(setupEl('rp-sec-years').hidden, false);
    assert.equal(setupEl('rp-empty').hidden, true);
    assert.equal(setupEl('rp-note').hidden, true);
    assert.equal((recent.match(/data-rp-open=/g) || []).length, 2);
    // Nothing yet: the plain empty line.
    setupUi.restore.rows = [];
    renderBackups();
    assert.equal(setupEl('rp-empty').hidden, false);
    assert.equal(setupEl('rp-sec-kept').hidden, true);
    assert.equal(setupEl('rp-sec-years').hidden, true);
  } finally { ruClose(); }
});

test('rules not published or no sync: one plain line instead of the lists, and Save is off', () => {
  ruOpen();
  try {
    setupUi.restore = { status: 'denied', rows: RU_ROWS(), at: 1, loading: false };
    renderBackups();
    assert.ok(/aren’t available yet/.test(setupEl('rp-note-text').textContent));
    assert.equal(setupEl('rp-note').hidden, false);
    assert.equal(setupEl('rp-save-btn').disabled, true);
    assert.equal(setupEl('rp-sec-recent').hidden, true);
    assert.equal(setupEl('rp-list').innerHTML, '', 'a refused read shows no list');
    setupUi.restore.status = 'nosync';
    renderBackups();
    assert.ok(/isn’t connected/.test(setupEl('rp-note-text').textContent));
    setupUi.restore.status = 'ok';
    renderBackups();
    assert.equal(setupEl('rp-save-btn').disabled, false);
    assert.equal(setupEl('rp-note').hidden, true);
  } finally { ruClose(); }
});

test('refreshRestoreIndex: ok, refused (rules) and offline each land in the right status', async () => {
  ruOpen();
  const realList = restoreList;
  const realHas = restoreHasFirebase;
  const realOn = restoreOnline;
  restoreHasFirebase = () => true;
  restoreOnline = () => true;
  try {
    setupUi.restore = { status: 'idle', rows: [], at: 0, loading: false };
    restoreList = async () => RU_ROWS();
    await refreshRestoreIndex();
    assert.equal(setupUi.restore.status, 'ok');
    assert.equal(setupUi.restore.rows.length, 4);
    restoreList = async () => { const e = new Error('no'); e.code = 'PERMISSION_DENIED'; throw e; };
    await refreshRestoreIndex();
    assert.equal(setupUi.restore.status, 'denied');
    restoreList = async () => { throw new Error('network'); };
    await refreshRestoreIndex();
    assert.equal(setupUi.restore.status, 'offline');
    restoreHasFirebase = () => false;
    await refreshRestoreIndex();
    assert.equal(setupUi.restore.status, 'nosync');
  } finally { restoreList = realList; restoreHasFirebase = realHas; restoreOnline = realOn; ruClose(); }
});

test('"Save a restore point now" asks for a name, trims it to 60, and saves a MANUAL point; Cancel saves nothing', async () => {
  ruOpen();
  const realAsk = askForText;
  const realSave = restoreSave;
  const realList = restoreList;
  const calls = [];
  restoreList = async () => RU_ROWS();
  try {
    suToastsRU = [];
    const realToast = showToast;
    showToast = (m) => suToastsRU.push(m);
    askForText = async () => ({ value: 'cancel', text: 'nope' });
    restoreSave = async (...a) => { calls.push(a); return { ok: true, rid: 'rp-new1' }; };
    await rpSaveManual();
    assert.equal(calls.length, 0, 'Cancel saved nothing');
    askForText = async (o) => {
      assert.equal(o.title, 'Save a restore point');
      assert.equal(o.input.maxLength, 60);
      assert.deepEqual(o.actions.map((a) => a.label), ['Cancel', 'Save'], 'a verb on each; Save is THE gold action');
      assert.equal(o.actions[1].kind, 'gold');
      return { value: 'save', text: '   ' + 'x'.repeat(80) + '  ' };
    };
    await rpSaveManual();
    assert.deepEqual(calls[0], ['manual', 'x'.repeat(60)]);
    assert.ok(/Saved “x+”/.test(suToastsRU[suToastsRU.length - 1]));
    askForText = async () => ({ value: 'save', text: '' });
    await rpSaveManual();
    assert.ok(/^Saved by /.test(calls[1][1]), 'a blank name falls back to "Saved by Jenn, 3:05 PM"');
    restoreSave = async () => ({ ok: true, rid: 'rp-q', queued: true });
    await rpSaveManual();
    assert.ok(/goes up when you’re back online/.test(suToastsRU[suToastsRU.length - 1]), 'a point waiting in the outbox says so');
    restoreSave = async () => ({ ok: false, reason: 'refused' });
    await rpSaveManual();
    assert.ok(/refused it/.test(suToastsRU[suToastsRU.length - 1]));
    showToast = realToast;
  } finally { askForText = realAsk; restoreSave = realSave; restoreList = realList; ruClose(); }
});
var suToastsRU = [];

test('20 saved by hand: it offers to delete the oldest one that is not kept, then saves', async () => {
  ruOpen();
  const realAsk = askDialog; const realSave = restoreSave; const realDel = restoreDelete; const realList = restoreList; const realToast = showToast;
  const log = [];
  try {
    showToast = () => {};
    restoreList = async () => RU_ROWS();
    setupUi.restore.rows = RU_ROWS();
    askDialog = async (o) => { log.push(o.title); return 'go'; };
    restoreDelete = async (rid) => { log.push('delete ' + rid); return { ok: true }; };
    restoreSave = async () => { log.push('save'); return { ok: true, rid: 'rp-new' }; };
    await rpMakeRoom('New one');
    assert.deepEqual(log, ['You have 20 saved by hand', 'delete rp-aaaa4', 'save'], 'the oldest unkept manual point (the pinned one is untouchable)');
    log.length = 0;
    askDialog = async () => 'no';
    await rpMakeRoom('New one');
    assert.deepEqual(log, [], 'Not now changes nothing');
  } finally { askDialog = realAsk; restoreSave = realSave; restoreDelete = realDel; restoreList = realList; showToast = realToast; ruClose(); }
});

// ── the restore sheet ──
function ruPoint() {
  const body = restoreBodyObject();
  return body;
}

test('the restore sheet offers each section with what it would change, Scores unticked; ticking Scores swaps the gold button for hold-to-confirm', () => {
  ruOpen();
  try {
    const body = ruPoint();
    body.state.teams = body.state.teams.map((t, i) => (i === 0 ? Object.assign({}, t, { name: 'Renamed Foxes' }) : t));
    openRestoreSheetForFile(body, 'camp-backup.json');
    const rs = setupUi.rsheet;
    assert.equal(rs.state, 'ready');
    assert.equal(rs.source, 'file');
    assert.equal(rs.picks.teams, true, 'a section that differs is ticked');
    assert.equal(rs.picks.games, false, 'one that is the same as now is not');
    assert.equal(rs.picks.scores, false, 'scores are never ticked for you (decision Q23)');
    renderRestoreSheet();
    assert.equal(setupEl('sheet-restore-title').textContent, 'camp-backup.json');
    assert.equal(setupEl('rp-restore-btn').hidden, false);
    assert.equal(setupEl('rp-restore-btn').disabled, false);
    assert.equal(setupEl('rp-hold-btn').hidden, true);
    assert.equal(document.querySelector('[data-rp-section="teams"]').querySelector('[data-rp-what]').textContent, 'team names');
    assert.equal(document.querySelector('[data-rp-section="games"]').querySelector('[data-rp-what]').textContent, 'Same as now');
    assert.equal(setupEl('rp-manage').hidden, true, 'a backup file has no keep / delete');
    rs.picks.scores = true;
    renderRestoreSheet();
    assert.equal(setupEl('rp-restore-btn').hidden, true, 'one action at a time');
    assert.equal(setupEl('rp-hold-btn').hidden, false);
    assert.equal(setupEl('rp-hold-label').textContent, 'Hold to put back ' + CAMP.label.replace('Camp', 'camp') + '’s scores', 'it names the camp');
    assert.equal(setupEl('rp-hold-confirm').hidden, true);
    rs.reveal = true;
    renderRestoreSheet();
    assert.equal(setupEl('rp-hold-confirm').hidden, false);
    assert.equal(setupEl('rp-hold-confirm').textContent, 'Yes, put back ' + CAMP.label.replace('Camp', 'camp') + '’s scores');
    rs.picks.scores = false; rs.picks.teams = false;
    renderRestoreSheet();
    assert.equal(setupEl('rp-restore-btn').disabled, true, 'nothing ticked: nothing to put back');
  } finally { ruClose(); }
});

test('a point from another year says so, kept games are named, and a section that cannot be offered is explained', () => {
  ruOpen();
  try {
    const body = ruPoint();
    body.epoch = '2026';
    openRestoreSheetForFile(body);
    renderRestoreSheet();
    assert.ok(/This is from the 2026 week/.test(setupEl('rp-epoch-text').textContent) || /week, not this one/.test(setupEl('rp-epoch-text').textContent), setupEl('rp-epoch-text').textContent);
    assert.equal(setupEl('rp-epoch-note').hidden, false);
    setupUi.rsheet.preview.kept = [{ id: 'rain', name: 'Rain bowling', why: 'a result' }];
    setupUi.rsheet.preview.notOffered = [{ section: 'meals', reason: 'point-off', text: 'This point is from before this section was edited here.' }];
    renderRestoreSheet();
    assert.equal(setupEl('rp-kept-text').textContent, 'Kept because they have scores: Rain bowling (a result)');
    assert.equal(setupEl('rp-not-offered').hidden, false);
  } finally { ruClose(); }
});

test('putting back: only the ticked, offered sections go to the engine; scores carry the hold\'s confirmation; the sheet closes and the list refreshes', async () => {
  ruOpen();
  const realApply = restoreApply; const realToast = showToast; const realList = restoreList;
  const calls = [];
  const toasts = [];
  try {
    showToast = (m) => toasts.push(m);
    restoreList = async () => RU_ROWS();
    restoreApply = async (body, picks, opts) => { calls.push({ picks, opts }); return { ok: true, applied: ['teams', 'scores'], kept: [{ id: 'g', name: 'Rain bowling' }], pre: 'rp-pre' }; };
    const body = ruPoint();
    body.state.teams = body.state.teams.map((t, i) => (i === 0 ? Object.assign({}, t, { name: 'Renamed Foxes' }) : t));
    openRestoreSheetForFile(body, 'b.json');
    setupUi.rsheet.picks.scores = true;
    await rpApply();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].picks.teams, true);
    assert.equal(calls[0].picks.games, false);
    assert.equal(calls[0].picks.scores, true);
    assert.equal(calls[0].opts.confirmed, true, 'the hold (or the two-tap) is the confirmation');
    assert.equal(setupUi.rsheet, null, 'the sheet is done');
    assert.ok(/Put back the teams and the scores\. A restore point from just before is saved\. Kept because they have scores: Rain bowling\./.test(toasts[0]), toasts[0]);
    // A refusal keeps the sheet open, changes nothing and says why in words.
    restoreApply = async () => ({ ok: false, reason: 'busy' });
    openRestoreSheetForFile(body, 'b.json');
    await rpApply();
    assert.ok(setupUi.rsheet, 'still open');
    assert.ok(/hasn’t finished saving/.test(toasts[toasts.length - 1]), toasts[toasts.length - 1]);
    // Nothing ticked: refused before the engine.
    setupUi.rsheet.picks = {};
    const before = calls.length;
    await rpApply();
    assert.equal(calls.length, before);
    assert.equal(toasts[toasts.length - 1], 'Tick at least one thing to put back.');
  } finally { restoreApply = realApply; showToast = realToast; restoreList = realList; ruClose(); }
});

test('opening a point from the list reads its body (a refused or missing one says so); keep and delete respect "kept points can\'t be deleted"', async () => {
  ruOpen();
  const realRead = restoreRead; const realPin = restorePin; const realDel = restoreDelete; const realAsk = askDialog; const realList = restoreList; const realToast = showToast;
  try {
    showToast = () => {};
    restoreList = async () => RU_ROWS();
    restoreRead = async () => ({ ok: false, reason: 'missing' });
    await openRestoreSheet('rp-aaaa1');
    assert.equal(setupUi.rsheet.state, 'error');
    renderRestoreSheet();
    assert.equal(setupEl('rp-meta').textContent, 'That restore point is gone.');
    assert.equal(setupEl('rp-restore-btn').hidden, true, 'no action on a point that cannot be read');
    restoreRead = async () => ({ ok: true, body: ruPoint() });
    await openRestoreSheet('rp-aaaa1');
    assert.equal(setupUi.rsheet.state, 'ready');
    renderRestoreSheet();
    assert.equal(setupEl('rp-manage').hidden, false);
    assert.equal(setupEl('rp-keep-row').hidden, false, 'an unkept point can be kept');
    assert.equal(setupEl('rp-delete-row').hidden, false, 'and deleted');
    await openRestoreSheet('rp-aaaa2'); // the pinned one
    renderRestoreSheet();
    assert.equal(setupEl('rp-keep-row').hidden, true, 'already kept');
    assert.equal(setupEl('rp-delete-row').hidden, true, 'kept points can\'t be deleted from the app');
    await openRestoreSheet('rp-aaaa3'); // the archive
    renderRestoreSheet();
    assert.equal(setupEl('rp-keep-row').hidden, true);
    assert.equal(setupEl('rp-delete-row').hidden, true);
    // Keep asks first, says what it means, then pins (write-once).
    await openRestoreSheet('rp-aaaa1');
    let pinned = '';
    restorePin = async (rid) => { pinned = rid; return { ok: true }; };
    let q = null;
    askDialog = async (o) => { q = o; return 'keep'; };
    await rpKeepPoint();
    assert.equal(q.body, 'Kept points can’t be deleted from the app.');
    assert.equal(pinned, 'rp-aaaa1');
    askDialog = async () => 'no';
    pinned = '';
    await rpKeepPoint();
    assert.equal(pinned, '', 'Not now pins nothing');
    // Delete: danger, and only when the engine says it can.
    restoreDelete = async () => ({ ok: true });
    askDialog = async (o) => { q = o; return 'delete'; };
    await openRestoreSheet('rp-aaaa4');
    await rpDeletePoint();
    assert.equal(q.actions[1].kind, 'danger');
    assert.equal(setupUi.rsheet, null);
  } finally {
    restoreRead = realRead; restorePin = realPin; restoreDelete = realDel; askDialog = realAsk; restoreList = realList; showToast = realToast; ruClose();
  }
});

// ── hold-to-confirm ──
function ruHold() {
  const anims = [];
  const fill = { animate: (kf, o) => { const a = { kf, o, currentTime: 0, cancel() { this.cancelled = true; } }; anims.push(a); return a; } };
  const listeners = {};
  const btn = { querySelector: () => fill, addEventListener: (t, fn) => { listeners[t] = fn; }, setPointerCapture: () => {} };
  const out = { done: 0, reveal: 0 };
  wireHold(btn, () => { out.done++; }, () => { out.reveal++; });
  return { anims, listeners, out };
}

test('a hold that finishes after the sheet was dismissed (Escape, Back, a re-render) puts nothing back', async () => {
  ruOpen();
  const realApply = restoreApply;
  let called = 0;
  try {
    restoreApply = async () => { called++; return { ok: true, applied: ['scores'], kept: [] }; };
    openRestoreSheetForFile(ruPoint(), 'b.json');
    setupUi.rsheet.picks.scores = true;
    shellSheetClose('restore'); // the person pressed Escape while the finger was still down
    await rpApply(); // ...and the 1.2 s hold completes
    assert.equal(called, 0, 'a dismissed sheet is a "no"');
    assert.ok(setupUi.rsheet, 'and nothing was torn down by the stray finish');
  } finally { restoreApply = realApply; ruClose(); }
});

test('hold-to-confirm: a full 1.2 s hold finishes once; letting go early drains the fill and does nothing; a quick tap reveals the two-tap button', async () => {
  assert.equal(RP_HOLD_MS, 1200);
  const h = ruHold();
  h.listeners.pointerdown({ button: 0, pointerId: 1 });
  assert.equal(h.anims[0].o.duration, 1200);
  assert.equal(h.anims[0].o.easing, 'linear');
  assert.equal(h.anims[0].kf[0].clipPath, 'inset(0 100% 0 0)', 'the fill is a clip-path wipe from the left, not a transform (calm keeps it)');
  assert.equal(h.anims[0].kf[1].clipPath, 'inset(0 0% 0 0)');
  h.anims[0].onfinish();
  assert.equal(h.out.done, 1, 'held to the end: done');
  h.anims[0].onfinish();
  h.listeners.pointerup({});
  assert.equal(h.out.done, 1, 'once only');
  // Let go early (after the tap window).
  const e = ruHold();
  e.listeners.pointerdown({ button: 0, pointerId: 1 });
  await new Promise((r) => setTimeout(r, 400));
  e.anims[0].currentTime = 600;
  e.listeners.pointerup({});
  assert.equal(e.out.done, 0, 'released at half: nothing happens');
  assert.equal(e.out.reveal, 0, 'and it was a hold, not a tap');
  assert.equal(e.anims[0].cancelled, true);
  assert.equal(e.anims[1].kf[0].clipPath, 'inset(0 50% 0 0)', 'the drain starts from where the fill had got to');
  assert.equal(e.anims[1].kf[1].clipPath, 'inset(0 100% 0 0)');
  // A quick tap.
  const t = ruHold();
  t.listeners.pointerdown({ button: 0, pointerId: 1 });
  t.listeners.pointerup({});
  assert.equal(t.out.reveal, 1);
  assert.equal(t.out.done, 0);
  // The keyboard and assistive tech: the same two-tap alternative.
  const k = ruHold();
  let prevented = false;
  k.listeners.keydown({ key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(k.out.reveal, 1);
  assert.ok(prevented);
  k.listeners.click({ detail: 0 });
  assert.equal(k.out.reveal, 2, 'a click with no pointer (VoiceOver) reveals');
  k.listeners.click({ detail: 1 });
  assert.equal(k.out.reveal, 2, 'a click that follows a pointer press is that press, already handled');
  k.listeners.pointerdown({ button: 2, pointerId: 1 });
  assert.equal(k.anims.length, 0, 'a right click starts nothing');
});

// ── backup files ──
test('a backup file of THIS camp opens the restore sheet (you pick what to put back); another camp\'s asks to copy; an unreadable one is told so', async () => {
  ruOpen();
  const realAsk = askDialog; const realToast = showToast; const realImport = tryImport;
  const toasts = [];
  let imported = null;
  try {
    showToast = (m) => toasts.push(m);
    tryImport = (text, opts) => { imported = { text, opts }; };
    const mine = JSON.stringify(Object.assign(backupObject()));
    await rpRestoreFile({ name: 'mine.json', text: async () => mine });
    assert.ok(setupUi.rsheet && setupUi.rsheet.source === 'file', 'the same sheet as a restore point');
    assert.equal(imported, null, 'nothing was replaced wholesale');
    setupUi.rsheet = null;
    await rpRestoreFile({ name: 'junk.json', text: async () => 'not json' });
    assert.ok(/doesn’t look like a Camp Scoreboard backup/.test(toasts[toasts.length - 1]));
    const other = JSON.parse(mine);
    other.camp = CAMP.id === 'junior' ? 'senior' : 'junior';
    let q = null;
    askDialog = async (o) => { q = o; return 'copy'; };
    await rpRestoreFile({ name: 'other.json', text: async () => JSON.stringify(other) });
    assert.ok(/That backup is from /.test(q.title));
    assert.equal(q.actions[1].label, 'Copy them');
    assert.equal(imported.opts.copyFromOtherCamp, true, 'only its schedule, games and teams');
    assert.equal(imported.opts.confirmed, true, 'asked once, in the dialog, not again with a native confirm');
    imported = null;
    askDialog = async () => 'no';
    await rpRestoreFile({ name: 'other.json', text: async () => JSON.stringify(other) });
    assert.equal(imported, null, 'Not now copies nothing');
    // An older flat (v2) backup: the dialog asks, then tryImport takes it.
    askDialog = async (o) => { q = o; return 'go'; };
    await rpRestoreFile({ name: 'old.json', text: async () => JSON.stringify({ app: 'campScoreboardV2', config: state.config, teams: state.teams }) });
    assert.equal(q.title, 'Replace this camp’s setup?');
    assert.equal(q.actions[1].kind, 'danger');
    assert.equal(imported.opts.confirmed, true);
    assert.equal(typeof imported.opts.say, 'function', 'its complaints come out as toasts');
  } finally { askDialog = realAsk; showToast = realToast; tryImport = realImport; ruClose(); }
});

test('tryImport takes its complaints through opts.say and skips its own confirm when the caller already asked', () => {
  freshState();
  setMemberRole('editor');
  const said = [];
  const realConfirm = confirm;
  let confirms = 0;
  confirm = () => { confirms++; return true; };
  try {
    tryImport('not json', { say: (m) => said.push(m) });
    assert.ok(/isn’t a whole backup/.test(said[0]));
    const mine = JSON.stringify({ app: 'campScoreboardV2', config: state.config });
    tryImport(mine, { say: () => {}, confirmed: true });
    assert.equal(confirms, 0, 'the caller\'s dialog was the question');
    tryImport(mine, { say: () => {} });
    assert.equal(confirms, 1, 'a caller that did not ask gets the native confirm, as before');
  } finally { confirm = realConfirm; setMemberRole(null); }
});

// ── Copy the backup, and Paste a backup (one path with a picked file) ──
const bpMine = () => JSON.stringify(backupObject());
function bpOther() { const o = JSON.parse(bpMine()); o.camp = CAMP.id === 'junior' ? 'senior' : 'junior'; return JSON.stringify(o); }
async function bpWith(fn) {
  const realAsk = askDialog; const realToast = showToast; const realImport = tryImport;
  const env = { asked: [], toasts: [], imported: null, answer: 'go' };
  askDialog = async (o) => { env.asked.push(o); return env.answer; };
  showToast = (m) => env.toasts.push(m);
  tryImport = (text, opts) => { env.imported = { text, opts }; };
  try { await fn(env); } finally { askDialog = realAsk; showToast = realToast; tryImport = realImport; backupPasteReset(); }
}

test('Copy the backup puts backupJSON() on the clipboard, says Copied in its own title, and never holds a camper name', () => {
  ruOpen();
  const realCopy = copyTextToClipboard;
  try {
    let copied = null; let btn = null;
    copyTextToClipboard = (text, b) => { copied = text; btn = b; };
    const el = { id: 'backup-copy-btn' };
    // a camper name held in memory (campers screen open) must never reach the clipboard
    campersMem.tree = { t0: [{ id: 'c-abcdefgh', name: 'Zzyzx-Camper', ord: 10 }] };
    campersMem.held = [{ tid: 't0', names: ['Zzyzx-Held'] }];
    campersMem.loaded = true;
    rpCopyBackup(el);
    assert.equal(/Zzyzx/.test(copied), false, 'no camper name in the copied text, held or listed');
    const strip = (t) => { const o = JSON.parse(t); delete o.at; delete o.exportedAt; if (o.config) delete o.config.updatedAt; return JSON.stringify(o); };
    assert.equal(strip(copied), strip(backupJSON()), 'the same text the file holds');
    assert.equal(btn, el, 'the button is handed over so its .copy-t title can say Copied');
    assert.equal(JSON.parse(copied).campers, undefined, 'no camper list in a backup');
    copied = null;
    setMemberRole('viewer');
    rpCopyBackup(el);
    assert.equal(copied, null, 'a counselor copies nothing');
  } finally { copyTextToClipboard = realCopy; campersMem.tree = {}; campersMem.held = []; ruClose(); }
  const src = readFixture('../setup-ui.js');
  assert.ok(/on\('#backup-copy-btn', 'click'/.test(src) && /on\('#backup-paste-row', 'click'/.test(src), 'both rows are wired');
});

test('pasting a backup of THIS camp opens the restore sheet and closes the paste sheet; the text is dropped from memory', async () => {
  ruOpen();
  await bpWith(async (env) => {
    openBackupPaste();
    assert.equal(backupPasteUi.open, true);
    assert.equal(setupEl('bp-check').hidden, true, 'nothing pasted: the dashed well, no gold key');
    backupPasteTyped(bpMine());
    assert.equal(setupEl('bp-check').hidden, false);
    assert.equal(setupEl('bp-wait').hidden, true);
    assert.equal(await backupPasteCheck(), true);
    assert.ok(setupUi.rsheet && setupUi.rsheet.source === 'file', 'the same sheet a file opens');
    assert.equal(env.imported, null, 'nothing is replaced from here');
    assert.equal(backupPasteUi.text, '', 'the pasted text is gone');
    assert.equal(shell.sheets.includes('backup-paste'), false);
  });
  ruClose();
});

test('pasting another camp\'s backup asks once; an older flat one asks once; Not now keeps the text so it can be fixed', async () => {
  ruOpen();
  await bpWith(async (env) => {
    openBackupPaste();
    const otherText = bpOther();
    backupPasteTyped(otherText);
    env.answer = 'no';
    assert.equal(await backupPasteCheck(), false);
    assert.equal(env.asked[0].actions[0].label, 'Not now');
    assert.equal(env.imported, null);
    assert.equal(backupPasteUi.text, otherText, 'Not now keeps what was pasted');
    assert.equal(backupPasteUi.open, true);
    env.answer = 'copy';
    assert.equal(await backupPasteCheck(), true);
    assert.equal(env.imported.opts.copyFromOtherCamp, true);
    assert.equal(env.imported.opts.confirmed, true);
    assert.equal(backupPasteUi.open, false, 'handed on: the sheet closes');
    env.imported = null; env.asked.length = 0; env.answer = 'go';
    openBackupPaste();
    backupPasteTyped(JSON.stringify({ app: 'campScoreboardV2', config: state.config, teams: state.teams }));
    assert.equal(await backupPasteCheck(), true);
    assert.equal(env.asked.length, 1);
    assert.equal(env.asked[0].title, 'Replace this camp’s setup?');
    assert.equal(env.imported.opts.confirmed, true);
  });
  ruClose();
});

test('pasted junk is a sentence in the sheet (aria-invalid) and nothing changes; typing clears it; no toast, no database', async () => {
  ruOpen();
  await bpWith(async (env) => {
    const attrs = []; const realAttr = setAttrIfChanged; setAttrIfChanged = (el, n, v) => { attrs.push([el === setupEl('bp-text') ? 'bp-text' : 'other', n, v]); };
    try {
    openBackupPaste();
    backupPasteTyped('{"half": ');
    assert.equal(await backupPasteCheck(), false);
    assert.equal(setupEl('bp-why').textContent, 'That isn’t a whole backup. Copy it again and paste all of it.');
    assert.deepEqual(attrs[attrs.length - 1], ['bp-text', 'aria-invalid', 'true']);
    assert.equal(env.toasts.length, 0);
    assert.equal(backupPasteUi.open, true, 'the sheet stays so it can be fixed');
    backupPasteTyped('{"half": 1');
    assert.equal(setupEl('bp-why').textContent, '', 'typing clears the sentence');
    assert.deepEqual(attrs[attrs.length - 1], ['bp-text', 'aria-invalid', null]);
    const noCamp = JSON.parse(bpMine()); delete noCamp.camp;
    backupPasteTyped(JSON.stringify(noCamp));
    await backupPasteCheck();
    assert.equal(setupEl('bp-why').textContent, 'That backup doesn’t say which camp it’s from, so it can’t be put back.');
    // wrong team count: tryImport's own refusal, in the sheet's words, through opts.say
    const bad = { app: 'campScoreboardV2', config: state.config, teams: state.teams.slice(0, 2) };
    backupPasteTyped(JSON.stringify(bad));
    env.answer = 'go';
    const said = [];
    tryImport = (text, opts) => { opts.say('That backup has 2 teams, but ' + CAMP.label + ' has ' + CAMP.teamCount + '. Nothing was changed.'); };
    await rpRestoreText(JSON.stringify(bad), { pasted: true, say: (m) => said.push(m) });
    assert.ok(/has 2 teams/.test(said.join(' ')));
    } finally { setAttrIfChanged = realAttr; }
  });
  ruClose();
});

test('the paste sheet’s ✕ and backdrop, tapped, ask before closing while text is in the box; an empty box closes freely', async () => {
  ruOpen();
  await bpWith(async (env) => {
    openBackupPaste();
    backupPasteTyped('abc');
    const tap = (sel) => { let stopped = false; backupPasteSheetTap({ target: { closest: (q) => (q === '[data-sheet-close]' && sel === 'close' ? {} : null) }, stopPropagation: () => { stopped = true; } }); return stopped; };
    env.answer = 'keep';
    assert.equal(tap('close'), true, 'the ✕ / backdrop tap is stopped before the shell closes the sheet');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(env.asked.length, 1);
    assert.equal(env.asked[0].title, 'Throw away the pasted backup?');
    assert.equal(tap('other'), false, 'a tap on anything else is left alone');
    backupPasteTyped('   ');
    assert.equal(tap('close'), false, 'an empty box closes freely');
    assert.equal(env.asked.length, 1, 'and asks nothing');
  });
  const src = readFixture('../setup-ui.js');
  assert.ok(/bpSheet\.addEventListener\('click', backupPasteSheetTap, true\)/.test(src), 'wired on the sheet, capturing');
  ruClose();
});

test('a flat backup with the wrong number of teams, pasted: the refusal sentence is in the sheet, no question is asked', async () => {
  ruOpen();
  await bpWith(async (env) => {
    openBackupPaste();
    const n = CAMP.teamCount === 6 ? 4 : 6;
    const flat = { app: 'campScoreboardV2', config: state.config, teams: Array.from({ length: n }, (_, i) => ({ id: 't' + i, name: 'T' + i, counselor: '' })) };
    backupPasteTyped(JSON.stringify(flat));
    assert.equal(await backupPasteCheck(), false);
    assert.ok(new RegExp('has ' + n + ' teams, but .* has ' + CAMP.teamCount).test(setupEl('bp-why').textContent), setupEl('bp-why').textContent);
    assert.equal(env.asked.length, 0, 'NO question asked for a backup that can never be put back');
    assert.equal(env.imported, null);
    assert.equal(backupPasteUi.open, true, 'the sheet stays so it can be fixed');
  });
  ruClose();
});

test('tryImport says its refusals in plain words (no tick box that no longer exists) and writes a restore point first', () => {
  freshState();
  setMemberRole('editor');
  const said = [];
  const other = JSON.parse(bpOther());
  tryImport(JSON.stringify(other), { say: (m) => said.push(m) });
  assert.ok(/Nothing was changed\.$/.test(said[0]) && !/tick/.test(said[0]), said[0]);
  const teams = JSON.stringify({ app: 'campScoreboardV2', config: state.config, teams: state.teams.slice(0, 2) });
  tryImport(teams, { say: (m) => said.push(m) });
  assert.ok(/ has \d+ teams, but .* has \d+\. Nothing was changed\.$/.test(said[1]), said[1]);
  const src = readFixture('../settings.js');
  assert.ok(/restoreAuto\('pre-import'/.test(src), 'a pre-import restore point is still written');
  setMemberRole(null);
});

test('a pasted backup holds the deploy reload and closing asks first; a counselor opens nothing; the text never reaches storage', async () => {
  ruOpen();
  await bpWith(async (env) => {
    assert.equal(reloadBlocked(), reloadBlocked());
    openBackupPaste();
    const before = reloadBlocked();
    backupPasteTyped('abc');
    assert.equal(backupPasteBusy(), true);
    assert.equal(reloadBlocked(), true, 'text in the box holds the reload');
    assert.equal(shellHasUnsentWork(), true, 'and the long-absence rule');
    env.answer = 'keep';
    assert.equal(setupSheetGuardClose('backup-paste'), true, 'closing is stopped while it asks');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(env.asked[0].title, 'Throw away the pasted backup?');
    assert.deepEqual(env.asked[0].actions.map((a) => a.label), ['Keep it', 'Throw it away']);
    assert.equal(backupPasteUi.text, 'abc', 'Keep it keeps it');
    backupPasteTyped('   ');
    assert.equal(setupSheetGuardClose('backup-paste'), false, 'an empty box closes freely');
    assert.equal(backupPasteBusy(), false);
    backupPasteTyped('abc');
    setupSheetClosed('backup-paste');
    assert.equal(backupPasteUi.text, '', 'a closed sheet forgets the text at once');
    assert.equal(before === false || before === true, true);
    setMemberRole('viewer');
    openBackupPaste();
    assert.equal(backupPasteUi.open, false, 'a counselor opens nothing');
    assert.equal(await rpRestoreText(bpMine(), {}), false, 'and restores nothing');
  });
  const src = readFixture('../setup-ui.js');
  const block = src.slice(src.indexOf('const backupPasteUi'), src.indexOf('function rpDownloadBackup') > src.indexOf('const backupPasteUi') ? src.indexOf('function rpDownloadBackup') : src.indexOf('const backupPasteUi') + 3000);
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(block), 'memory only');
  ruClose();
});
