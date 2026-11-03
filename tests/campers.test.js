// Campers (BUILD-PLAN Step 25, P2 §11.9, P12; setup-sync.js "CAMPERS" and setup-ui.js section 15): minors' first names, per team, directors only.
// The rules this file pins:
//   - the data half: the pure helpers, an editor-only listener that attaches only while a camper-showing screen holds it, normalizes every
//     snapshot, degrades only itself when refused, goes the moment the screen lets go or the role drops; every camper write is a whole
//     `{ name, ord }` record, a move is ONE update (delete + create), a name typed with no signal is HELD in memory and sent on reconnect;
//   - the screen: counts and names painted into static markup, an idle repaint writes nothing, every name escaped, the sheets' handlers
//     (stand-in inputs, the real engine against the in-memory database), leaving with names waiting asks first, a counselor reaches none of it;
//   - P12, twice over: a SOURCE scan (no storage, console or network call in the section, no other file reads the list, nothing in a backup or
//     a restore point) and a RUNTIME sweep (a whole session of adds, renames, moves, removes, undo, an offline hold and a demotion leaves no
//     camper name in any localStorage / sessionStorage / IndexedDB write, any console call, the state, the backup, the restore body, the undo list).
// campers.senior.test.js evals this file under the senior profile (four teams); the emulator side is tests/emulator/campers-client.mjs.

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const CM_ROOT = CAMP.dbRoot;
const CM_JENN = { email: 'jenn@example.com', emailVerified: true };
const CM_TEAMS = [{ id: 't0', name: 'Ferocious Foxes' }, { id: 't1', name: 'Turkey Trotters' }];
// Names no other test, fixture or piece of code would ever contain: if one turns up anywhere it should not, it came from the camper list.
const CM_SECRET = ['Zyxwvu', 'Quillon', 'Brontë Xavier', 'Pip Ozymandias'];
const CM_SRC = readFixture('../setup-sync.js');
const CM_UI = readFixture('../setup-ui.js');
const CM_APP = readFixture('../app.js');
const CM_HTML = readFixture('../index.html');
const CM_ENGINE = CM_SRC.slice(CM_SRC.indexOf('// CAMPERS: first names per team'));
const CM_SCREEN = CM_UI.slice(CM_UI.indexOf('// ── 15. Campers (§11.9'));
const cmNoComments = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const cmPath = nodeRequire('path');
const cmFs = nodeRequire('fs');
const CM_ROOT_DIR = cmPath.join(cmPath.dirname(nodeRequire.resolve('./harness.js')), '..');

function cmReset() {
  campersDetach();
  campersMem.held = []; campersMem.heldNote = ''; campersMem.busy = 0; campersMem.flushing = false;
  campersUi.edit = null; campersUi.add = null; campersUi.undo = null;
}

function cmSetup(o) {
  window.scrollTo = () => {};
  freshState();
  authUser = CM_JENN;
  setMemberRole((o && o.role) || 'editor');
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb();
  window.firebase = makeFakeFirebase(db);
  fbConnKnown = true; fbConnected = true;
  syncStarted = false; // a test that wants the listener says so (cmListen): the role change's own attach waits on it
  state.teams = CM_TEAMS.map((t) => Object.assign({}, t));
  memberDirectory = {}; memberDirectoryLoaded = true;
  cmReset();
  if (o && o.data) db.serverSet(CM_ROOT + '/campers', o.data);
  return { db };
}

function cmTeardown() {
  cmReset();
  delete window.FIREBASE_CONFIG; delete window.firebase;
  fbConnKnown = false; fbConnected = false; syncStarted = false;
  counselorPreviewOn = false;
  setMemberRole(null);
  authUser = null; memberDirectory = null; memberDirectoryLoaded = false;
  state.ui.view = 'home'; state.ui.builderScreen = undefined;
  clearTimeout(setupPushTimer); setupPushTimer = null;
  while (shell.sheets.length) shellSheetClose(shell.sheets[shell.sheets.length - 1]);
}

const cmListen = async () => { syncStarted = true; campersWant(true); await waitUntil(() => campersMem.loaded, 'the first camper snapshot'); };
const cmRec = (name, ord) => ({ name, ord });
const cmData = () => ({
  t0: { 'c-aaaaaa0001': cmRec('Maya', 10), 'c-aaaaaa0002': cmRec('Eli', 20), 'c-aaaaaa0003': cmRec('Ava R.', 30) },
  t1: { 'c-bbbbbb0001': cmRec('Grace', 10), 'c-bbbbbb0002': cmRec('Owen', 20) },
});
const cmEl = (id) => document.getElementById(id);
const cmWrites = (db) => db.log.map((l) => l.kind + ' ' + l.paths.join(','));

// ── pure helpers ──

test('a typed name is cleaned the way the rules want: control characters out, spaces folded, cut to 40', () => {
  assert.equal(campersCleanName('  Maya \n\t R.  '), 'Maya R.');
  assert.equal(campersCleanName('x'.repeat(60)).length, 40);
  assert.equal(campersCleanName('   '), '');
  assert.equal(campersCleanName(null), '');
});

test('"First names, one per line or separated by commas": duplicates stay, empties go, long names are counted as cut, a huge paste is capped', () => {
  assert.deepEqual(campersParseNames('Maya\nEli, Grace;Owen\r\n\n  Ava R. ,Ava T.,').names, ['Maya', 'Eli', 'Grace', 'Owen', 'Ava R.', 'Ava T.']);
  assert.deepEqual(campersParseNames('Ava, Ava').names, ['Ava', 'Ava'], 'two with one name are two campers (add a last initial to tell them apart)');
  const long = campersParseNames('x'.repeat(41) + ', Eli');
  assert.deepEqual([long.names[0].length, long.names[1], long.cut], [40, 'Eli', 1]);
  const big = campersParseNames(Array.from({ length: CAMPERS_ADD_MAX + 5 }, (_, i) => 'N' + i).join('\n'));
  assert.deepEqual([big.names.length, big.over], [CAMPERS_ADD_MAX, true]);
  assert.deepEqual(campersParseNames('').names, []);
});

test('a snapshot is normalized on read: unknown teams, bad ids, nameless or ord-less rows and non-objects are dropped; rows sort by position, then name', () => {
  const tree = campersNorm({
    t1: { 'c-zzzzzz0001': cmRec('Zed', 20), 'c-zzzzzz0002': cmRec('Abe', 20), 'c-zzzzzz0003': cmRec('First', 5) },
    t9: { 'c-qqqqqq0001': cmRec('Ten', 10) },
    t0: { 'camper-1': cmRec('Bad id', 1), 'c-short': cmRec('Too short', 1), 'c-aaaaaa0001': { name: 'No ord' }, 'c-aaaaaa0002': { ord: 4 }, 'c-aaaaaa0003': 'text', 'c-aaaaaa0004': cmRec('Kept', 40) },
    team2: { 'c-zzzzzz0009': cmRec('Wrong team id', 1) },
    t2: 'a scalar',
  });
  assert.deepEqual(Object.keys(tree).sort(), ['t0', 't1', 't9'], 't9 matches the rules\' ^t[0-9]$ shape: it is simply not a team of this camp (the screens only ask for their own)');
  assert.deepEqual(tree.t0.map((c) => c.name), ['Kept']);
  assert.deepEqual(tree.t1.map((c) => c.name), ['First', 'Abe', 'Zed'], 'position first, then name');
  assert.deepEqual(campersNorm(null), {});
  assert.deepEqual(campersNorm('x'), {});
  assert.deepEqual(campersNorm([1, 2, 3]), {}, 'an array-coerced node is not a camper list');
  assert.equal(campersNorm({ t0: { 'c-aaaaaa0001': cmRec('<img src=x onerror=1>', 1) } }).t0[0].name, '<img src=x onerror=1>', 'text stays text: the screen escapes it');
});

test('a new camper id is c- and ten base36 characters (the rules want 6–20 of [a-z0-9]), never one already taken', () => {
  const taken = {};
  for (let i = 0; i < 200; i++) {
    const id = campersMintId(taken);
    assert.ok(/^c-[a-z0-9]{10}$/.test(id), id);
    assert.ok(!taken[id]);
    taken[id] = true;
  }
});

// ── the listener ──

test('the listener is a director\'s, after sign-in resolved and sync started, and only while a screen asks for it', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    campersWant(true);
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 0, 'sync has not started: nothing attaches (THE INVARIANT)');
    syncStarted = true;
    campersWant(true);
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 1);
    campersWant(true);
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 1, 'asking again attaches nothing more');
    await waitUntil(() => campersMem.loaded, 'the first snapshot');
    assert.equal(campersTotal(), 5);
    assert.deepEqual(campersFor('t0').map((c) => c.name), ['Maya', 'Eli', 'Ava R.']);
    assert.equal(campersCount('t1'), 2);
    assert.equal(campersStatus(), 'ok');
    campersWant(false);
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 0, 'a screen that does not show campers lets it go');
    assert.deepEqual([campersTotal(), campersFor('t0').length, campersMem.loaded], [0, 0, false], 'and the names go with it');
    assert.equal(campersStatus(), 'loading');
  } finally { cmTeardown(); }
});

test('a counselor\'s phone never listens and reads nothing: campersFor is [] for a viewer, a view-only tab and a counselor preview', async () => {
  const { db } = cmSetup({ role: 'viewer', data: cmData() });
  try {
    syncStarted = true;
    campersWant(true);
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 0, 'a viewer has no listener');
    assert.deepEqual([campersFor('t0'), campersTotal(), campersCount('t0')], [[], 0, 0]);
  } finally { cmTeardown(); }
  const e = cmSetup({ data: cmData() });
  try {
    await cmListen();
    assert.equal(campersFor('t0').length, 3);
    counselorPreviewOn = true;
    assert.deepEqual([campersFor('t0'), campersTotal()], [[], 0], 'while a director previews as a counselor the list reads as nothing');
    counselorPreviewOn = false;
    assert.equal(campersFor('t0').length, 3);
  } finally { cmTeardown(); }
  void e;
});

test('a demotion detaches the listener and drops the names AND anything held (a phone that may not edit keeps no minor\'s name)', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    await cmListen();
    fbConnected = false;
    await campersAdd('t0', ['Held One']);
    assert.equal(campersHeldCount(), 1);
    setMemberRole('viewer');
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 0);
    assert.deepEqual([campersMem.loaded, Object.keys(campersMem.tree).length, campersHeldCount(), campersFor('t0')], [false, 0, 0, []]);
    assert.ok(!JSON.stringify(campersMem).includes('Maya') && !JSON.stringify(campersMem).includes('Held One'));
  } finally { cmTeardown(); }
});

test('a refused read degrades campers only: denied is said, fbRef and syncDenied are untouched, nothing is retried', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    fbRef = db.ref(CM_ROOT + '/state');
    const was = fbRef;
    syncStarted = true;
    db.revokeRead(CM_ROOT + '/campers');
    campersWant(true);
    await waitUntil(() => campersMem.denied, 'the refusal');
    assert.equal(campersStatus(), 'denied');
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 0, 'a cancelled read is terminal: it is not re-armed');
    assert.equal(fbRef, was, 'the state listener\'s ref is untouched');
    assert.equal(syncDenied, false, 'and so is syncDenied');
    assert.deepEqual([campersTotal(), campersFor('t0')], [0, []]);
  } finally { fbRef = null; cmTeardown(); }
});

test('with no sync configured the status says so and nothing attaches', () => {
  cmSetup();
  try {
    delete window.FIREBASE_CONFIG;
    syncStarted = true;
    campersWant(true);
    assert.equal(campersStatus(), 'nosync');
    assert.equal(campersMem.ref, null);
  } finally { cmTeardown(); }
});

// ── the writes ──

test('Add: ONE multi-path update of whole { name, ord } records at the end of the team; two with one name are two campers', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    await cmListen();
    db.log.length = 0;
    const r = await campersAdd('t0', ['Ava', 'Ava', '  Noor  ']);
    assert.deepEqual([r.ok, r.added], [true, 3]);
    assert.equal(db.log.length, 1, 'one write');
    assert.equal(db.log[0].kind, 'update');
    assert.ok(db.log[0].paths.every((p) => /^[^/]+\/campers\/t0\/c-[a-z0-9]{10}$/.test(p)), 'each path is a whole camper under the team: ' + db.log[0].paths.join(','));
    await waitUntil(() => campersCount('t0') === 6, 'the listener to see them');
    const names = campersFor('t0').map((c) => c.name);
    assert.deepEqual(names, ['Maya', 'Eli', 'Ava R.', 'Ava', 'Ava', 'Noor'], 'after the others, in the order typed');
    const stored = db.serverGet(CM_ROOT + '/campers/t0');
    Object.keys(stored).forEach((cid) => assert.deepEqual(Object.keys(stored[cid]).sort(), ['name', 'ord'], 'a camper write is always { name, ord }'));
    assert.deepEqual(campersFor('t0').slice(3).map((c) => c.ord), [40, 50, 60]);
  } finally { cmTeardown(); }
});

test('Add refuses what it must: a counselor, a team this camp does not have, nothing to add; and it never writes for them', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    await cmListen();
    db.log.length = 0;
    assert.equal((await campersAdd('t9', ['X'])).reason, 'team');
    assert.equal((await campersAdd('team0', ['X'])).reason, 'team');
    assert.deepEqual(await campersAdd('t0', ['   ', '']), { ok: true, added: 0 });
    setMemberRole('viewer');
    assert.equal((await campersAdd('t0', ['X'])).reason, 'readonly');
    assert.equal((await campersRename('t0', 'c-aaaaaa0001', 'X')).reason, 'readonly');
    assert.equal((await campersMove('t0', 'c-aaaaaa0001', 't1')).reason, 'readonly');
    assert.equal((await campersRemove('t0', 'c-aaaaaa0001')).reason, 'readonly');
    assert.deepEqual(db.log, [], 'not one write');
  } finally { cmTeardown(); }
});

test('Rename writes ONE name leaf; Move is ONE update that deletes here and creates there under the same id, with its name and a position at the end; Remove deletes the record', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    await cmListen();
    db.log.length = 0;
    assert.equal((await campersRename('t0', 'c-aaaaaa0001', ' Maya L. ')).ok, true);
    assert.deepEqual(cmWrites(db), ['set ' + CM_ROOT + '/campers/t0/c-aaaaaa0001/name']);
    await waitUntil(() => campersFind('t0', 'c-aaaaaa0001').name === 'Maya L.', 'the rename to arrive');
    assert.deepEqual(await campersRename('t0', 'c-aaaaaa0001', 'Maya L.'), { ok: true, nothing: true }, 'the same name writes nothing');
    assert.equal((await campersRename('t0', 'c-aaaaaa0001', '   ')).reason, 'name');
    db.log.length = 0;
    const m = await campersMove('t0', 'c-aaaaaa0002', 't1', { name: 'Eli K.' });
    assert.equal(m.ok, true);
    assert.equal(db.log.length, 1, 'one atomic update');
    assert.deepEqual(db.log[0].paths.slice().sort(), [CM_ROOT + '/campers/t0/c-aaaaaa0002', CM_ROOT + '/campers/t1/c-aaaaaa0002']);
    await waitUntil(() => campersCount('t1') === 3, 'the move to arrive');
    assert.deepEqual(campersFor('t1').map((c) => [c.id, c.name, c.ord]).pop(), ['c-aaaaaa0002', 'Eli K.', 30], 'same id, the new name, after the others');
    assert.equal(db.serverGet(CM_ROOT + '/campers/t0/c-aaaaaa0002'), null, 'gone from the old team');
    assert.deepEqual(await campersMove('t1', 'c-aaaaaa0002', 't1'), { ok: true, nothing: true });
    assert.equal((await campersMove('t1', 'c-aaaaaa0002', 't9')).reason, 'team');
    db.log.length = 0;
    assert.equal((await campersRemove('t1', 'c-bbbbbb0001')).ok, true);
    assert.deepEqual(cmWrites(db), ['remove ' + CM_ROOT + '/campers/t1/c-bbbbbb0001']);
    assert.equal((await campersRemove('t1', 'c-bbbbbb0001')).reason, 'gone', 'a second remove of the same camper');
    const put = await campersPut('t1', 'c-bbbbbb0001', { name: 'Grace', ord: 10 });
    assert.equal(put.ok, true, 'the screen\'s undo puts the whole record back under the same id');
    assert.deepEqual(db.serverGet(CM_ROOT + '/campers/t1/c-bbbbbb0001'), { name: 'Grace', ord: 10 });
  } finally { cmTeardown(); }
});

test('every action but Add needs a connection and says so; a refused write is a sentence, never a throw', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    await cmListen();
    fbConnected = false;
    db.log.length = 0;
    assert.equal((await campersRename('t0', 'c-aaaaaa0001', 'X')).reason, 'offline');
    assert.equal((await campersMove('t0', 'c-aaaaaa0001', 't1')).reason, 'offline');
    assert.equal((await campersRemove('t0', 'c-aaaaaa0001')).reason, 'offline');
    assert.equal(campersWhy({ reason: 'offline' }), 'Needs a connection.');
    assert.deepEqual(db.log, []);
    fbConnected = true;
    db.refuse(CM_ROOT + '/campers');
    const r = await campersRename('t0', 'c-aaaaaa0001', 'Refused');
    assert.deepEqual([r.ok, r.reason], [false, 'refused']);
    assert.ok(/refused/.test(campersWhy(r)));
  } finally { cmTeardown(); }
});

test('names typed with no signal are HELD in memory (nothing sent, nothing stored) and go in one write the moment the signal is back', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    await cmListen();
    fbConnected = false;
    db.log.length = 0;
    const r1 = await campersAdd('t0', ['Held A', 'Held B']);
    const r2 = await campersAdd('t1', ['Held C']);
    assert.deepEqual([r1.ok, r1.held, r2.held], [true, 2, 1]);
    assert.deepEqual(db.log, [], 'nothing was sent');
    assert.equal(campersHeldCount(), 3);
    assert.deepEqual(campersHeldList().map((h) => h.tid + ':' + h.name), ['t0:Held A', 't0:Held B', 't1:Held C']);
    assert.equal(campersBusy(), true, 'the deploy\'s auto-reload waits');
    assert.equal(reloadBlocked(), true);
    const midReal = editorMidEntry;
    editorMidEntry = () => false;
    try { assert.equal(shellHasUnsentWork(), true, 'held names are in memory only: a long absence must not send the director home from them'); } finally { editorMidEntry = midReal; }
    assert.equal(builderLeaveWarning(), 'These 3 names haven’t been saved yet — they’ll be lost. Discard them?');
    fbConnected = true;
    campersOnConnect();
    await waitUntil(() => campersHeldCount() === 0, 'the held names to be sent');
    assert.equal(campersBusy(), false);
    await waitUntil(() => campersCount('t0') === 5 && campersCount('t1') === 3, 'the listener to see them');
    assert.deepEqual(campersFor('t0').slice(3).map((c) => c.name), ['Held A', 'Held B']);
    assert.equal(db.log.filter((l) => l.kind === 'update').length, 2, 'one update per team');
    assert.equal(builderLeaveWarning(), '');
  } finally { cmTeardown(); }
});

test('held names stay held when the database refuses them, with the reason in words; Discard drops them', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    await cmListen();
    fbConnected = false;
    await campersAdd('t0', ['Stuck']);
    db.refuse(CM_ROOT + '/campers');
    fbConnected = true;
    const r = await campersFlushHeld();
    assert.equal(r.ok, false);
    assert.equal(campersHeldCount(), 1, 'kept');
    assert.ok(/refused/.test(campersMem.heldNote));
    campersDiscardHeld();
    assert.deepEqual([campersHeldCount(), campersMem.heldNote], [0, '']);
  } finally { cmTeardown(); }
});

// ── the screen ──

function cmOpen(role, o) {
  const r = cmSetup(Object.assign({ role }, o || {}));
  state.ui.view = 'settings';
  state.ui.builderScreen = 'campers';
  setupUi.wasOpen = false;
  setupUi.restore = { status: 'idle', rows: [], at: 0, loading: false };
  undoClear();
  return r;
}

test('the screen: a headline with the count, a chip per camper, a dashed Add chip per team, the privacy sentence, and every name escaped', async () => {
  const data = cmData();
  data.t1['c-bbbbbb0003'] = cmRec('<img src=x onerror=alert(1)>', 30);
  cmOpen('editor', { data });
  try {
    renderCampersScreen();
    assert.equal(cmEl('campers-headline').textContent, 'Loading…', 'before the list arrives');
    assert.equal(cmEl('campers-groups').innerHTML, '', 'no names yet');
    await cmListen();
    renderCampersScreen();
    assert.equal(cmEl('campers-title').textContent, 'Campers · ' + CAMP.label);
    assert.equal(cmEl('campers-headline').textContent, '6 campers');
    assert.ok(/Only directors can see camper names\. Counselors never see this list, and it isn’t saved on any phone\./.test(CM_HTML), 'the lede is the spec\'s sentence, in the markup');
    const g = cmEl('campers-groups').innerHTML;
    assert.equal((g.match(/class="ppl-group cmp-group"/g) || []).length, state.teams.length, 'a section per team');
    assert.ok(g.includes('data-camper="t0|c-aaaaaa0001">Maya</button>'));
    assert.ok(g.includes('data-camper-add="t0"') && g.includes('data-camper-add="t1"'));
    assert.ok(g.includes('&lt;img src=x onerror=alert(1)&gt;') && !g.includes('<img src=x'), 'a hostile name is text, never markup');
    assert.ok(/3 campers/.test(g) && /Nobody yet/.test(g.replace(/3 campers/g, '')) === (state.teams.length > 2), 'a team with nobody says so');
    assert.equal(cmEl('campers-add-btn').hidden, false);
  } finally { cmTeardown(); }
});

test('the screen says why there is no list: sync off, a refused read; and offers no Add then', () => {
  cmOpen('editor');
  try {
    delete window.FIREBASE_CONFIG;
    renderCampersScreen();
    assert.equal(cmEl('campers-state').hidden, false);
    assert.ok(/Live sync is off/.test(cmEl('campers-state-text').textContent));
    assert.equal(cmEl('campers-add-btn').hidden, true);
    window.FIREBASE_CONFIG = { apiKey: 'test' };
    campersMem.denied = true;
    renderCampersScreen();
    assert.ok(/aren’t available yet/.test(cmEl('campers-state-text').textContent));
    campersMem.denied = false;
  } finally { cmTeardown(); }
});

test('an idle repaint writes nothing (render-stability): groups, held names, the undo line and the switch patch only what changed', async () => {
  cmOpen('editor', { data: cmData() });
  try {
    await cmListen();
    fbConnected = false;
    await campersAdd('t0', ['Held A']);
    campersSayUndo('Removed Maya.', async () => ({ ok: true }));
    renderCampersScreen();
    const rec = __sinkRec;
    rec.on = true; rec.log.length = 0;
    renderCampersScreen();
    rec.on = false;
    assert.deepEqual(rec.log, [], 'an unchanged Campers screen writes nothing');
    campersUndoClear();
  } finally { cmTeardown(); }
});

test('the Teams rows and the People groups carry the camper count once the list is held, and nothing before', async () => {
  cmOpen('editor', { data: cmData() });
  try {
    state.ui.builderScreen = 'teams';
    renderTeamsScreen();
    assert.ok(!/campers?\b/.test(cmEl('teams-list').innerHTML), 'no list yet: no count');
    await cmListen();
    renderTeamsScreen();
    assert.ok(/Ferocious Foxes[\s\S]*3 campers/.test(cmEl('teams-list').innerHTML.replace(/\s+/g, ' ')) || /3 campers/.test(cmEl('teams-list').innerHTML), 'the Foxes row says 3 campers');
    assert.ok(/2 campers/.test(cmEl('teams-list').innerHTML));
    state.ui.builderScreen = 'people';
    renderPeopleScreen();
    assert.ok(/ · 3 campers/.test(cmEl('people-groups').innerHTML), 'the People group says so too');
    campersWant(false);
    renderTeamsScreen();
    assert.ok(!/campers?\b/.test(cmEl('teams-list').innerHTML), 'the screen that lets the list go shows no count');
  } finally { cmTeardown(); }
});

test('the hub row: Loading… until the list arrives, then the count; a team with nobody is a note; the row is a button that opens the screen', async () => {
  cmOpen('editor', { data: cmData() });
  try {
    state.ui.builderScreen = 'hub';
    const row = () => document.querySelector('[data-hub-row="campers"]');
    assert.ok(/<button type="button" class="gl-row hub-row" data-hub-row="campers">/.test(CM_HTML), 'a row whose screen exists is a button (index.html)');
    paintHub();
    assert.equal(row().querySelector('[data-hub-summary]').textContent, 'Loading…');
    await cmListen();
    paintHub();
    const sum = row().querySelector('[data-hub-summary]').textContent;
    assert.equal(sum, '5 campers');
    const prob = row().querySelector('[data-hub-problem]');
    assert.equal(prob.textContent, state.teams.length > 2 ? state.teams[2].name + ' has no campers yet' : '', 'a team with no campers once any exist');
    hubOpen('campers');
    assert.equal(state.ui.builderScreen, 'campers');
  } finally { cmTeardown(); }
});

test('the listener follows the screen: the hub, Campers, People and Teams hold it; any other screen, and a closed builder, let it go', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    syncStarted = true;
    state.ui.view = 'settings';
    ['hub', 'campers', 'people', 'teams'].forEach((s) => {
      state.ui.builderScreen = s;
      renderSetupUi(true);
      assert.equal(db.listenerCount(CM_ROOT + '/campers'), 1, s + ' holds the list');
    });
    await waitUntil(() => campersMem.loaded, 'the snapshot');
    ['week', 'schedule', 'meals', 'verses', 'cleanup', 'backups'].forEach((s) => {
      state.ui.builderScreen = s;
      renderSetupUi(true);
      assert.equal(db.listenerCount(CM_ROOT + '/campers'), 0, s + ' lets it go');
      assert.equal(campersTotal(), 0);
      state.ui.builderScreen = 'campers';
      renderSetupUi(true);
      assert.equal(db.listenerCount(CM_ROOT + '/campers'), 1);
    });
    state.ui.view = 'home';
    renderSetupUi(false);
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 0, 'closing the builder lets it go');
    assert.equal(cmEl('campers-groups').innerHTML, '', 'and the page holds no names');
  } finally { cmTeardown(); }
});

test('the names are drawn only while the Campers screen is the one showing: any other screen (even one that still holds the list) empties the chips', async () => {
  const { db } = cmSetup({ data: cmData() });
  try {
    syncStarted = true;
    state.ui.view = 'settings';
    state.ui.builderScreen = 'campers';
    setupUi.wasOpen = false;
    renderSetupUi(true);
    await waitUntil(() => campersMem.loaded, 'the snapshot');
    renderCampersScreen();
    assert.ok(cmEl('campers-groups').innerHTML.includes('Maya'), 'the Campers screen draws the names');
    // The hub holds the list for its counts but does not show names.
    state.ui.builderScreen = 'hub';
    renderSetupUi(true);
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 1, 'the hub still holds the list');
    assert.equal(cmEl('campers-groups').innerHTML, '', 'but no name stays in the page behind it');
    // Coming back repaints them (the memo was forgotten with the markup).
    state.ui.builderScreen = 'campers';
    renderSetupUi(true);
    renderCampersScreen();
    assert.ok(cmEl('campers-groups').innerHTML.includes('Maya'), 'back on the Campers screen they are drawn again');
    // The Classic editor holds nothing: the listener and the names both go.
    state.ui.builderScreen = 'classic';
    renderSetupUi(true);
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 0);
    assert.equal(cmEl('campers-groups').innerHTML, '');
    // An idle paint of a screen with no names writes nothing.
    const el = cmEl('campers-groups');
    let writes = 0;
    const desc = Object.getOwnPropertyDescriptor(el, 'innerHTML');
    Object.defineProperty(el, 'innerHTML', { configurable: true, get() { return desc ? desc.get.call(el) : ''; }, set(v) { writes++; if (desc && desc.set) desc.set.call(el, v); } });
    renderSetupUi(true);
    renderSetupUi(true);
    assert.equal(writes, 0, 'nothing to forget, nothing written');
  } finally { cmTeardown(); }
});

test('a counselor reaches none of it: no listener, no sheet, no route to the screen, no row', async () => {
  const { db } = cmSetup({ role: 'viewer', data: cmData() });
  try {
    syncStarted = true;
    state.ui.view = 'settings';
    state.ui.builderScreen = 'campers';
    assert.equal(setupGo('campers'), false, 'setupGo refuses without canEdit()');
    campersOpenEdit('t0', 'c-aaaaaa0001');
    campersOpenAdd('t0');
    assert.deepEqual([campersUi.edit, campersUi.add], [null, null]);
    ['camper-edit', 'camper-add'].forEach((id) => assert.equal(shellSheetAllowed(id), false, id));
    renderAll();
    assert.equal(db.listenerCount(CM_ROOT + '/campers'), 0);
    assert.equal(campersTotal(), 0);
    assert.ok(!cmEl('campers-groups').innerHTML.includes('Maya'));
  } finally { cmTeardown(); }
});

// ── the sheets ──

test('Add campers: the sheet opens on the team that was tapped; names are parsed, the button counts them, Add writes once and closes; a toast says a count, never a name', async () => {
  cmOpen('editor', { data: cmData() });
  const toasts = [];
  const realToast = showToast;
  try {
    showToast = (m) => { toasts.push(String(m)); };
    await cmListen();
    renderCampersScreen();
    campersOpenAdd('t1');
    assert.ok(shell.sheets.includes('camper-add'));
    renderCamperAddSheet();
    assert.equal(cmEl('cma-team').value, 't1');
    assert.equal(cmEl('cma-go').textContent, 'Add campers');
    assert.equal(cmEl('cma-go').disabled, true, 'nothing typed yet');
    cmEl('cma-lines').value = 'Zyxwvu\nQuillon, Brontë Xavier';
    renderCamperAddSheet();
    assert.equal(cmEl('cma-go').textContent, 'Add 3 campers');
    assert.equal(cmEl('cma-go').disabled, false);
    assert.equal(campersAddDirty(), true);
    await campersAddGo();
    assert.equal(campersUi.add, null);
    assert.equal(shell.sheets.includes('camper-add'), false, 'the sheet closed');
    await waitUntil(() => campersCount('t1') === 5, 'the names to arrive');
    assert.deepEqual(toasts, ['Added 3 campers']);
    assert.ok(!toasts.join('').includes('Zyxwvu'), 'a toast says a count, never a name');
  } finally { showToast = realToast; cmTeardown(); }
});

test('Add campers with no signal: the sheet says the names will wait, the screen shows them waiting, and a name too long is said to be shortened', async () => {
  cmOpen('editor', { data: cmData() });
  const toasts = [];
  const realToast = showToast;
  try {
    showToast = (m) => { toasts.push(String(m)); };
    await cmListen();
    fbConnected = false;
    campersOpenAdd('t0');
    cmEl('cma-lines').value = 'Zyxwvu, ' + 'x'.repeat(45);
    renderCamperAddSheet();
    assert.ok(/no signal, so these will wait on this screen/.test(cmEl('cma-warn').textContent));
    assert.ok(/1 name is longer than 40 characters/.test(cmEl('cma-warn').textContent));
    await campersAddGo();
    assert.deepEqual(toasts, ['No signal — 2 names will wait on this screen']);
    renderCampersScreen();
    assert.equal(cmEl('campers-held').hidden, false);
    assert.equal(cmEl('campers-held-title').textContent, '2 names waiting to be saved');
    assert.ok(/Zyxwvu/.test(cmEl('campers-held-list').innerHTML));
    assert.ok(/Waiting for signal — keep this screen open\. Camper names aren’t stored on phones\./.test(CM_HTML));
    fbConnected = true;
    campersOnConnect();
    await waitUntil(() => campersHeldCount() === 0, 'the flush');
    assert.ok(toasts.includes('2 camper names saved'));
    renderCampersScreen();
    assert.equal(cmEl('campers-held').hidden, true);
  } finally { showToast = realToast; cmTeardown(); }
});

test('the camper sheet: rename, move and remove; Save with nothing changed just closes; a name that vanished meanwhile is said, not written', async () => {
  const { db } = cmSetup({ data: cmData() });
  const toasts = [];
  const realToast = showToast;
  try {
    showToast = (m) => { toasts.push(String(m)); };
    state.ui.view = 'settings'; state.ui.builderScreen = 'campers';
    await cmListen();
    campersOpenEdit('t0', 'c-aaaaaa0001');
    renderCamperEditSheet();
    assert.equal(cmEl('cme-name').value, 'Maya');
    assert.equal(cmEl('cme-team').value, 't0');
    assert.equal(cmEl('sheet-camper-edit-title').textContent, 'Maya');
    assert.equal(campersEditDirty(), false);
    await campersSaveEdit();
    assert.equal(shell.sheets.includes('camper-edit'), false, 'nothing changed: it just closes');
    assert.deepEqual(cmWrites(db).filter((w) => /campers/.test(w)), []);
    // rename + move in one save: ONE update, one name
    campersOpenEdit('t0', 'c-aaaaaa0002');
    renderCamperEditSheet();
    cmEl('cme-name').value = '  Eli K. ';
    cmEl('cme-team').value = 't1';
    assert.equal(campersEditDirty(), true);
    await campersSaveEdit();
    await waitUntil(() => campersFind('t1', 'c-aaaaaa0002'), 'the move to arrive');
    assert.equal(campersFind('t1', 'c-aaaaaa0002').name, 'Eli K.');
    assert.equal(db.log.filter((l) => l.kind === 'update').length, 1);
    // remove
    campersOpenEdit('t1', 'c-bbbbbb0002');
    renderCamperEditSheet();
    await campersRemoveGo();
    await waitUntil(() => !campersFind('t1', 'c-bbbbbb0002'), 'the removal to arrive');
    assert.deepEqual(toasts, ['Moved to ' + peopleTeamNameOf('t1'), 'Removed']);
    // a camper someone else removed while the sheet was open
    campersOpenEdit('t0', 'c-aaaaaa0003');
    renderCamperEditSheet();
    db.serverSet(CM_ROOT + '/campers/t0/c-aaaaaa0003', null);
    await waitUntil(() => !campersFind('t0', 'c-aaaaaa0003'), 'their removal to arrive');
    renderCamperEditSheet();
    assert.equal(cmEl('cme-error').hidden, false);
    assert.ok(/isn’t on the list any more/.test(cmEl('cme-error').textContent));
    assert.equal(cmEl('cme-save').disabled, true);
  } finally { showToast = realToast; cmTeardown(); }
});

test('Undo is one line on the screen, in memory: it puts a removed camper (same id and place), a move and a rename back, and is gone after a few seconds or with the screen', async () => {
  const { db } = cmSetup({ data: cmData() });
  const realToast = showToast;
  try {
    showToast = () => {};
    state.ui.view = 'settings'; state.ui.builderScreen = 'campers';
    await cmListen();
    // remove → undo
    campersOpenEdit('t0', 'c-aaaaaa0002'); renderCamperEditSheet();
    await campersRemoveGo();
    await waitUntil(() => !campersFind('t0', 'c-aaaaaa0002'), 'the removal');
    assert.equal(campersUi.undo.text, 'Removed Eli.');
    renderCampersScreen();
    assert.equal(cmEl('campers-undo').hidden, false);
    assert.equal(cmEl('campers-undo-text').textContent, 'Removed Eli.');
    await campersUndoGo();
    await waitUntil(() => campersFind('t0', 'c-aaaaaa0002'), 'the undo');
    assert.deepEqual(db.serverGet(CM_ROOT + '/campers/t0/c-aaaaaa0002'), { name: 'Eli', ord: 20 }, 'the same record, the same place');
    assert.equal(campersUi.undo, null);
    // move → undo (back to its own place, not the end)
    campersOpenEdit('t0', 'c-aaaaaa0001'); renderCamperEditSheet();
    cmEl('cme-team').value = 't1';
    await campersSaveEdit();
    await waitUntil(() => campersFind('t1', 'c-aaaaaa0001'), 'the move');
    await campersUndoGo();
    await waitUntil(() => campersFind('t0', 'c-aaaaaa0001') && !campersFind('t1', 'c-aaaaaa0001'), 'the move undone');
    assert.deepEqual(campersFind('t0', 'c-aaaaaa0001'), { id: 'c-aaaaaa0001', name: 'Maya', ord: 10 });
    // rename → undo
    campersOpenEdit('t0', 'c-aaaaaa0001'); renderCamperEditSheet();
    cmEl('cme-name').value = 'Maya Q.';
    await campersSaveEdit();
    await waitUntil(() => campersFind('t0', 'c-aaaaaa0001').name === 'Maya Q.', 'the rename');
    await campersUndoGo();
    await waitUntil(() => campersFind('t0', 'c-aaaaaa0001').name === 'Maya', 'the rename undone');
    // not in the setup undo stack (it is persisted): camper edits never go there
    assert.deepEqual(undoRead().filter((e) => /amper|Maya|Eli/.test(JSON.stringify(e))), []);
    // gone with the screen
    campersSayUndo('Removed Someone.', async () => ({ ok: true }));
    campersUiReset();
    assert.equal(campersUi.undo, null);
  } finally { showToast = realToast; cmTeardown(); }
});

test('closing a sheet with a name typed and not saved asks first, by every route, and holds the deploy reload; Keep editing leaves it, Discard closes it', async () => {
  cmOpen('editor', { data: cmData() });
  const real = askDialog;
  try {
    await cmListen();
    campersOpenAdd('t0');
    renderCamperAddSheet();
    assert.equal(setupSheetGuardClose('camper-add'), false, 'nothing typed: nothing at stake');
    cmEl('cma-lines').value = 'Zyxwvu';
    assert.equal(campersAddDirty(), true);
    assert.equal(campersUiBusy(), true);
    assert.equal(reloadBlocked(), true, 'the deploy\'s auto-reload waits');
    let asked = 0;
    askDialog = async () => { asked++; return 'keep'; };
    assert.equal(setupSheetGuardClose('camper-add'), true, 'the phone\'s Back and Escape reach the same question');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(asked, 1);
    assert.ok(shell.sheets.includes('camper-add'), 'kept');
    askDialog = async () => 'discard';
    assert.equal(setupSheetGuardClose('camper-add'), true);
    await waitUntil(() => !shell.sheets.includes('camper-add'), 'Discard to close the sheet');
    assert.equal(campersUi.add, null);
    assert.equal(campersUiBusy(), false);
    // the camper sheet: a changed name or team is at stake, putting it back is not
    campersOpenEdit('t0', 'c-aaaaaa0001');
    renderCamperEditSheet();
    assert.equal(setupSheetGuardClose('camper-edit'), false);
    cmEl('cme-name').value = 'Changed';
    assert.equal(campersEditDirty(), true);
    assert.equal(campersUiBusy(), true);
    askDialog = async () => 'discard';
    assert.equal(setupSheetGuardClose('camper-edit'), true);
    await waitUntil(() => !shell.sheets.includes('camper-edit'), 'Discard to close the camper sheet');
    campersOpenEdit('t0', 'c-aaaaaa0001');
    renderCamperEditSheet();
    cmEl('cme-name').value = 'Changed';
    cmEl('cme-name').value = 'Maya';
    assert.equal(campersEditDirty(), false, 'typed back to what it was: nothing at stake');
  } finally { askDialog = real; cmTeardown(); }
});

test('leaving the screen with names still waiting asks first (Keep waiting / Discard); the phone\'s Back and a deep link ask the same thing in words', async () => {
  cmOpen('editor', { data: cmData() });
  try {
    await cmListen();
    fbConnected = false;
    await campersAdd('t0', ['Zyxwvu', 'Quillon', 'Pip Ozymandias']);
    assert.equal(builderLeaveWarning(), 'These 3 names haven’t been saved yet — they’ll be lost. Discard them?');
    const realAsk = askDialog;
    let asked = null;
    askDialog = async (o) => { asked = o; return 'keep'; };
    try {
      assert.equal(await campersConfirmLeave(), false);
      assert.equal(asked.title, 'These 3 names haven’t been saved yet');
      assert.deepEqual(asked.actions.map((a) => a.label), ['Keep waiting', 'Discard']);
      assert.equal(campersHeldCount(), 3, 'Keep waiting keeps them');
      askDialog = async () => 'discard';
      assert.equal(await campersConfirmLeave(), true);
      assert.equal(campersHeldCount(), 0, 'Discard drops them');
    } finally { askDialog = realAsk; }
    await campersAdd('t0', ['Quillon']);
    assert.equal(builderLeaveWarning(), 'This name hasn’t been saved yet — it’ll be lost. Discard it?', 'one name, said in the singular');
  } finally { cmTeardown(); }
});

test('"Not using camper lists this year" is the week\'s own meta/skip/campers: a dash on the hub, the names kept, and a switch back', async () => {
  const { db } = cmSetup({ data: cmData() });
  const toasts = [];
  const realToast = showToast;
  try {
    showToast = (m) => { toasts.push(String(m)); };
    state.ui.view = 'settings'; state.ui.builderScreen = 'campers';
    await waitUntil(() => setupReady || true);
    setupReady = true; setupTree = setupTree || {}; setupTree.meta = setupTree.meta || {};
    setupBase = setupCanon(setupTree);
    await cmListen();
    await campersToggleSkip(true);
    assert.equal(setupTree.meta.skip.campers, true);
    renderCampersScreen();
    assert.equal(document.querySelector('[data-switch-state="campers-skip"]').textContent, 'On');
    assert.equal(hubStatus('campers', Object.assign(hubView(), { skip: setupTree.meta.skip })).mark, 'skip');
    assert.equal(campersTotal(), 5, 'the names are kept');
    await campersToggleSkip(false);
    assert.equal(setupTree.meta.skip.campers, undefined);
    renderCampersScreen();
    assert.equal(document.querySelector('[data-switch-state="campers-skip"]').textContent, 'Off');
    void db;
  } finally { showToast = realToast; clearTimeout(setupPushTimer); setupPushTimer = null; cmTeardown(); }
});

// ── P12: minors' names never leave memory ──

test('P12 (source): the CAMPERS section and the Campers screen touch no storage, console, network or cross-tab channel', () => {
  [['setup-sync.js CAMPERS', CM_ENGINE], ['setup-ui.js section 15', CM_SCREEN]].forEach(([what, src]) => {
    const code = cmNoComments(src);
    const hit = code.match(/localStorage|sessionStorage|indexedDB|\bsetItem\b|document\.cookie|\bconsole\b|\bfetch\s*\(|XMLHttpRequest|sendBeacon|postMessage|BroadcastChannel|navigator\.share|Notification|\blog\s*\(/);
    assert.equal(hit, null, what + ' must hold names in memory only: found ' + (hit && hit[0]));
  });
  // setup-sync.js CAMPERS is the LAST section of the file before the cache load: nothing after it can quietly add a reader
  assert.ok(CM_SRC.trim().endsWith('setupLoadCache();'));
  assert.ok(CM_SRC.indexOf('// CAMPERS: first names per team') > CM_SRC.indexOf('// PEOPLE: who is on the list'));
});

test('P12 (source): no other file reads the camper list — app.js only holds a reload and a leave for it, nothing else names it', () => {
  const root = CM_ROOT_DIR;
  const fs = cmFs;
  const shipped = fs.readdirSync(root).filter((f) => /\.(js|html)$/.test(f))
    .concat(['push-worker/worker.js'].filter((f) => fs.existsSync(cmPath.join(root, f))));
  const ID = /\bcampers(?:[A-Z]\w*)?\b(?=\s*[(=,.;)\]]|\s*$)|\bcampersMem\b|\bcampersUi\b|['"`]campers['"`/]|dbPath\(\s*['"`]campers|\/campers\b/g;
  const found = {};
  shipped.forEach((f) => {
    const src = cmNoComments(fs.readFileSync(cmPath.join(root, f), 'utf8'));
    const hits = (src.match(ID) || []).filter((h) => h !== 'campers');
    const strict = src.match(/\bcampers[A-Z]\w*|\bcampersMem\b|\bcampersUi\b|dbPath\(\s*['"`]campers|['"`]\/?campers\/?['"`]/g) || [];
    if (strict.length || hits.length) found[f] = Array.from(new Set(strict));
  });
  assert.deepEqual(Object.keys(found).sort(), ['app.js', 'index.html', 'setup-sync.js', 'setup-ui.js'].filter((f) => found[f]).sort(), 'only the engine, its screen and the hooks name the list: ' + JSON.stringify(Object.keys(found)));
  // (index.html names it in its own markup: ids like #setup-campers, never data)
  assert.deepEqual(found['app.js'].slice().sort(), ['campersBusy', 'campersDiscardHeld', 'campersHeldCount', 'campersOnConnect', 'campersUiBusy'],
    'app.js holds a reload, a leave and the reconnect for it, and reads no name');
  ['chat.js', 'push.js', 'settings.js', 'camps.js', 'camp-core.js', 'reveal-core.js', 'reveal.js', 'reveal-ui.js', 'tell.js', 'award.js', 'current-standings.js', 'tv-camp.js',
    'sw.js', 'stalling.html', 'current-standings.html', 'boot-guard.js'].forEach((f) => assert.ok(!found[f], f + ' must not touch the camper list'));
});

test('P12 (source): the TV page, the service worker, the alert sender and the standings sheet carry no camper data or node name at all', () => {
  const root = CM_ROOT_DIR;
  const fs = cmFs;
  ['current-standings.js', 'current-standings.html', 'tv-camp.js', 'sw.js', 'push-worker/worker.js', 'stalling.html'].forEach((f) => {
    const p = cmPath.join(root, f);
    if (!fs.existsSync(p)) return;
    assert.ok(!/camper/i.test(fs.readFileSync(p, 'utf8')), f + ' mentions campers');
  });
});

test('P12 (source): the restore-point body, the backup file and the synced state never name the list; the cache and SYNC_KEYS have no campers', () => {
  const body = CM_SRC.slice(CM_SRC.indexOf('function restoreBodyObject'), CM_SRC.indexOf('function restoreBodyObject') + 3000);
  assert.ok(!/campers[A-Z(]|campersMem|['"]campers['"]/.test(cmNoComments(body)), 'restoreBodyObject');
  const backup = CM_SRC.slice(CM_SRC.indexOf('function backupObject'), CM_SRC.indexOf('function backupObject') + 1500);
  assert.ok(!/campers[A-Z(]|campersMem|['"]campers['"]/.test(cmNoComments(backup)), 'backupObject');
  assert.ok(SYNC_KEYS.indexOf('campers') === -1);
  assert.ok(!/\bcampers\b/.test(JSON.stringify(Object.keys(state))));
  // no setItem anywhere is handed anything the list holds
  cmFs.readdirSync(CM_ROOT_DIR).filter((f) => /\.js$/.test(f)).forEach((f) => {
    const src = cmNoComments(cmFs.readFileSync(cmPath.join(CM_ROOT_DIR, f), 'utf8'));
    assert.ok(!/setItem\([^;]*campers[A-Z(]/.test(src), f + ' stores something from the camper list');
  });
});

test('P12 (runtime sweep): a whole session — listen, add, rename, move, remove, undo, an offline hold and flush, the screens, a demotion — leaves no camper name in any storage, console call, state, backup, restore body or undo entry', async () => {
  const { db } = cmSetup({ data: { t0: { 'c-aaaaaa0001': cmRec('Zyxwvu', 10), 'c-aaaaaa0002': cmRec('Quillon', 20) }, t1: { 'c-bbbbbb0001': cmRec('Brontë Xavier', 10) } } });
  const seen = [];
  const rec = (kind) => (...a) => { seen.push(kind + ' ' + a.map((x) => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch (e) { return String(x); } }).join(' ')); };
  const realLsSet = localStorage.setItem;
  const realSsSet = sessionStorage.setItem;
  const realIdb = indexedDB.open;
  const realConsole = {};
  ['log', 'info', 'warn', 'error', 'debug', 'trace'].forEach((k) => { realConsole[k] = console[k]; console[k] = rec('console.' + k); });
  const realToast = showToast;
  const toasts = [];
  try {
    localStorage.setItem = (k, v) => { seen.push('localStorage ' + k + '=' + v); return realLsSet.call(localStorage, k, v); };
    sessionStorage.setItem = (k, v) => { seen.push('sessionStorage ' + k + '=' + v); return realSsSet.call(sessionStorage, k, v); };
    indexedDB.open = (...a) => { seen.push('indexedDB ' + JSON.stringify(a)); return realIdb(...a); };
    showToast = (m) => { toasts.push(String(m)); };
    state.ui.view = 'settings'; state.ui.builderScreen = 'campers';
    await cmListen();
    renderCampersScreen(); paintHub();
    state.ui.builderScreen = 'people'; renderPeopleScreen();
    state.ui.builderScreen = 'teams'; renderTeamsScreen();
    state.ui.builderScreen = 'campers';
    await campersAdd('t0', ['Pip Ozymandias']);
    await waitUntil(() => campersCount('t0') === 3, 'the add');
    campersOpenEdit('t0', 'c-aaaaaa0001'); renderCamperEditSheet();
    cmEl('cme-name').value = 'Zyxwvu II'; cmEl('cme-team').value = 't1';
    await campersSaveEdit();
    await waitUntil(() => campersFind('t1', 'c-aaaaaa0001'), 'the move');
    await campersUndoGo();
    await waitUntil(() => campersFind('t0', 'c-aaaaaa0001'), 'the move undone');
    campersOpenEdit('t0', 'c-aaaaaa0002'); renderCamperEditSheet();
    await campersRemoveGo();
    await waitUntil(() => !campersFind('t0', 'c-aaaaaa0002'), 'the removal');
    await campersUndoGo();
    fbConnected = false;
    await campersAdd('t1', ['Held Zyxwvu']);
    renderCampersScreen();
    fbConnected = true; campersOnConnect();
    await waitUntil(() => campersHeldCount() === 0, 'the flush');
    // every place a copy of the cache could be made from
    ['save', 'persist', 'cache'].forEach(() => {});
    saveState();
    const dumps = {
      state: JSON.stringify(state),
      snapshot: JSON.stringify(syncedSnapshot()),
      restoreBody: JSON.stringify(restoreBodyObject()),
      backup: backupJSON(),
      undo: JSON.stringify(undoRead()),
      storage: JSON.stringify([...Array(localStorage.length).keys()].map((i) => { const k = localStorage.key(i); return [k, localStorage.getItem(k)]; })),
      toasts: toasts.join('|'),
    };
    setMemberRole('viewer');
    const after = JSON.stringify({ mem: campersMem, tree: campersMem.tree, held: campersMem.held, ui: campersUi });
    const names = CM_SECRET.concat(['Zyxwvu II', 'Held Zyxwvu']);
    names.forEach((n) => {
      Object.keys(dumps).forEach((k) => assert.ok(!dumps[k].includes(n), k + ' holds a camper name: ' + n));
      seen.forEach((s) => assert.ok(!s.includes(n), 'a storage or console call carried a camper name: ' + s.slice(0, 120)));
      assert.ok(!after.includes(n), 'a demoted phone still holds ' + n);
    });
    // (a storage KEY or a console line / database name that says "camper" is as much a leak as a value; a stored blob may say the word in the camp's own
    // printed text — the example notice and the schedule — so only the keys and the non-storage calls are judged here)
    assert.ok(seen.every((s) => !/camper/i.test(/^(localStorage|sessionStorage) /.test(s) ? s.split('=')[0] : s)), 'nor any camper key or node name: ' + seen.filter((s) => /camper/i.test(/^(localStorage|sessionStorage) /.test(s) ? s.split('=')[0] : s)).join('; ').slice(0, 200));
    assert.ok(db.log.every((l) => l.paths.every((p) => p.startsWith(CM_ROOT + '/campers/'))), 'every write went to the camper node and nowhere else');
  } finally {
    localStorage.setItem = realLsSet; sessionStorage.setItem = realSsSet; indexedDB.open = realIdb; showToast = realToast;
    Object.keys(realConsole).forEach((k) => { console[k] = realConsole[k]; });
    cmTeardown();
  }
});
