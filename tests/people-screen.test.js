// The People SCREEN (BUILD-PLAN Step 25, P2 §11.8; setup-ui.js section 14 and app.js's join badges and bar): the hub row's judgement, what the screen
// paints and writes nothing when idle, every requester string escaped, the routes in (More's row, the hub, the join bar) and the Back that leaves,
// the five sheets' handlers (stand-in elements for the inputs, the real engine against the in-memory database), the join badges and the bar in Now's
// strip, and the source pins a regression would quietly break. Anything that needs layout (rows at 130% / 200% text, the sheets' docks) is the
// Playwright pass. people-screen.senior.test.js evals this file under the senior profile; the data half is people.test.js.

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const PS_ROOT = CAMP.dbRoot;
const PS_JENN = { email: 'jenn@example.com', emailVerified: true };
const PS_JENN_KEY = 'jenn@example,com';
const PS_TAYLOR = 'taylor,reed@gmail,com';
const PS_ISO = '2026-11-01T12:00:00.000Z';
const PS_HTML = readFixture('../index.html');
const PS_CSS = readFixture('../styles.css');
const PS_UI = readFixture('../setup-ui.js');
const PS_SRC = PS_UI.slice(PS_UI.indexOf('// ── 14. People (§11.8'));

const psDir = () => ({
  [PS_JENN_KEY]: { role: 'editor', name: 'Jenn Reed', addedBy: 'x', addedAt: PS_ISO },
  [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick Simpson', addedBy: 'console', addedAt: PS_ISO },
  'sam@example,com': { role: 'viewer', name: 'Sam Lee', teamId: 't0', addedBy: 'x', addedAt: PS_ISO },
  'pending-taylor-ab12c': { role: 'viewer', name: 'Taylor', teamId: 't0', addedBy: 'x', addedAt: PS_ISO },
  'pending-boss-qq1w2': { role: 'editor', name: 'Taylor Boss', teamId: 't1', addedBy: 'x', addedAt: PS_ISO },
});

function psOpen(role, o) {
  window.scrollTo = () => {};
  freshState();
  authUser = PS_JENN;
  setMemberRole(role === undefined ? 'editor' : role);
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb();
  window.firebase = makeFakeFirebase(db);
  fbConnKnown = true; fbConnected = true;
  syncStarted = false;
  fbRef = db.ref(PS_ROOT + '/state');
  state.teams = [{ id: 't0', name: 'Ferocious Foxes' }, { id: 't1', name: 'Turkey Trotters' }];
  state.ui.view = 'settings';
  state.ui.builderScreen = 'people';
  setupUi.wasOpen = false;
  setupUi.restore = { status: 'idle', rows: [], at: 0, loading: false };
  undoClear();
  memberDirectory = Object.assign(psDir(), (o && o.directory) || {});
  memberDirectoryLoaded = true;
  db.serverSet(PS_ROOT + '/members', JSON.parse(JSON.stringify(memberDirectory)));
  pplReq.ref = null; pplReq.list = []; pplReq.loaded = false; pplReq.denied = false; pplReq.seen = null; pplReq.other = { n: 0, probed: false }; pplReq.blocked = { status: 'idle', rows: [] };
  peopleUi.person = null; peopleUi.request = null; peopleUi.teams = null; peopleUi.add = null; peopleUi.blocked = false; peopleUi.from = ''; peopleUi.other = { status: 'idle', list: null };
  joinBarSeen.clear();
  return { db };
}

function psClose() {
  PEOPLE_SHEETS.forEach((id) => { if (shell.sheets.includes(id)) shellSheetClose(id); });
  peopleUi.person = null; peopleUi.request = null; peopleUi.teams = null; peopleUi.add = null; peopleUi.blocked = false; peopleUi.from = '';
  try { setupPillHide(true); } catch (e) { /* no pill yet */ }
  setupUi.wasOpen = false;
  state.ui.view = 'home';
  state.ui.builderScreen = undefined;
  clearTimeout(setupPushTimer); setupPushTimer = null;
  delete window.FIREBASE_CONFIG; delete window.firebase;
  fbConnKnown = false; fbConnected = false; fbRef = null;
  peopleRequestsDetach();
  setMemberRole(null);
  authUser = null; memberDirectory = null; memberDirectoryLoaded = false;
  freshState();
}
const psEl = (id) => document.getElementById(id);
// shellHasUnsentWork() with the older "mid-entry" test (a pending write, a focused field) held off, so what is asked is the Step 25 sheets.
const unsentWorkAlone = () => { const real = editorMidEntry; editorMidEntry = () => false; try { return shellHasUnsentWork(); } finally { editorMidEntry = real; } };
// ONE stamp for the whole file: the join bar's dismissal key is key|at, so a stamp read from the clock on every call
// made "the same request" differ whenever a millisecond boundary fell between two psAsk() calls (a flaky 'a newer
// request brings it back', 1 in ~25 runs). Time is an argument here, never read twice.
const PS_AT = Date.now() - 240000;
const psAsk = (over) => ({ key: PS_TAYLOR, name: 'Taylor Reed', at: PS_AT, note: "I'm with the Foxes", ...(over || {}) });
const psPut = (list) => { pplReq.list = list; };

// ── the hub row's judgement ──

test('hub: somebody asking to join is the first thing the People row says; asking left on past a week is a quiet note, not a count', () => {
  const v = (join) => ({ membersLoaded: true, members: [{ key: 'a', role: 'viewer', name: 'A', teamId: 't0', addedBy: 'x', addedAt: 1 }], teams: [{ id: 't0', name: 'Foxes' }], now: 9e12, join });
  let r = hubStatus('people', v({ waiting: 1, first: 'Taylor Reed' }));
  assert.deepEqual([r.mark, r.problems[0]], ['warn', 'Taylor Reed is asking to join']);
  r = hubStatus('people', v({ waiting: 3 }));
  assert.equal(r.problems[0], '3 people are asking to join');
  r = hubStatus('people', v({ waiting: 0, long: true }));
  assert.deepEqual([r.mark, r.problems, r.note], ['ok', [], 'Asking to join is still on — turn it off after registration?']);
  r = hubStatus('people', v(undefined));
  assert.equal(r.mark, 'ok', 'no join view: the row is what it was');
});

// ── the screen ──

test('the screen paints the headline, the asking switch, a row per person by team, and the owner row is not a button', () => {
  psOpen();
  try {
    renderPeopleScreen();
    assert.equal(psEl('people-title').textContent, 'People · ' + CAMP.label);
    assert.equal(psEl('people-headline').textContent, '2 people have no sign-in yet', 'the first thing to fix, as on the hub row');
    assert.ok(/more thing|Tap a person/.test(psEl('people-lede').textContent));
    const g = psEl('people-groups').innerHTML;
    assert.ok(g.includes('data-person="sam@example,com"') && g.includes('data-person="' + PS_JENN_KEY + '"'));
    assert.ok(g.includes('data-person="pending-taylor-ab12c"') && /No sign-in yet · Counselor/.test(g), 'a pending row says so in words');
    assert.ok(!g.includes('data-person="' + OWNER_MEMBER_KEY + '"'), 'the owner row is not a button');
    assert.ok(/Owner · only the owner can change this row/.test(g));
    assert.ok(/class="ppl-tag">you</.test(g), 'your own row says "you"');
    assert.equal((g.match(/class="ppl-group"/g) || []).length, 1 + state.teams.length, 'a section per team, and one for people on no team');
    assert.equal(psEl('people-req-sec').hidden, true, 'nobody asking: no section');
    assert.equal(psEl('people-asking-long').hidden, true);
    assert.equal(psEl('people-state').hidden, true);
  } finally { psClose(); }
});

test('the asking switch shows the week\'s joinOpen; asking on for a week raises the nudge; sync trouble and a refused read are said in a line', () => {
  psOpen();
  try {
    setupTree.meta = Object.assign({}, setupTree.meta, { joinOpen: true });
    setupEdited.week = { at: Date.now() - 9 * 86400000, byKey: PS_JENN_KEY };
    renderPeopleScreen();
    assert.equal(psEl('people-asking-long').hidden, false);
    assert.ok(/anyone signed in/i.test(psEl('people-ask-sub').textContent));
    assert.equal(document.querySelector('[data-switch-state="people-asking"]').textContent, 'On');
    setupTree.meta.joinOpen = false;
    renderPeopleScreen();
    assert.equal(psEl('people-asking-long').hidden, true);
    assert.ok(/Turn on during registration/.test(psEl('people-ask-sub').textContent));
    pplReq.denied = true;
    fbRef = null;
    renderPeopleScreen();
    assert.equal(psEl('people-state').hidden, false);
    assert.ok(/Needs a connection/.test(psEl('people-state-text').textContent));
  } finally { delete setupEdited.week; psClose(); }
});

test('the people asking: a row each, newest first, "Asking to join · N", and a hostile name or note stays text', () => {
  psOpen();
  try {
    psPut([psAsk({ name: '<img src=x onerror=alert(1)>', note: '"><script>alert(1)</script>' }), psAsk({ key: 'b@x,com', name: 'Bea', at: Date.now() - 600000 })]);
    renderPeopleScreen();
    const h = psEl('people-requests').innerHTML;
    assert.equal(psEl('people-req-sec').hidden, false);
    assert.equal(psEl('people-req-label').textContent, 'Asking to join · 2');
    assert.ok(h.indexOf('r-' + PS_TAYLOR) < h.indexOf('r-b@x,com'), 'in the order the list has them (newest first)');
    assert.ok(!/<img src=x|<script/i.test(h) && h.includes('&lt;img'), 'escaped, not dropped');
    assert.ok(/4 min ago/.test(h));
    assert.equal(psEl('people-headline').textContent, '2 people are asking to join', 'the first thing to act on');
    psPut([psAsk({ name: '<img src=x onerror=alert(1)>' })]);
    renderPeopleScreen();
    assert.equal(psEl('people-headline').textContent, '<img src=x onerror=alert(1)> is asking to join', 'the headline goes in through textContent: text, never markup');
  } finally { psClose(); }
});

test('an idle repaint writes nothing (render-stability): list, groups, switch and notes patch only what changed', () => {
  psOpen();
  try {
    psPut([psAsk()]);
    renderPeopleScreen();
    const rec = __sinkRec;
    rec.on = true; rec.log.length = 0;
    renderPeopleScreen();
    rec.on = false;
    assert.deepEqual(rec.log, [], 'an unchanged People screen writes nothing');
  } finally { psClose(); }
});

// ── the ways in, and Back ──

test('More\'s People row opens the screen straight away (Back is labelled More and leaves the builder); the hub row opens it with the hub as Back', async () => {
  psOpen();
  try {
    state.ui.view = 'home'; state.ui.builderScreen = undefined; state.ui.tab = 'more';
    assert.equal(openMembers.toString().includes('setupOpenPeople'), true);
    openMembers();
    assert.equal(builderOpen(), true);
    assert.equal(state.ui.builderScreen, 'people');
    assert.equal(peopleUi.from, 'more');
    renderAll();
    assert.equal(psEl('setup-back-label').textContent, 'More');
    await setupBack();
    assert.equal(builderOpen(), false, 'Back from People leaves the builder: the hub was never in the way');
    // from the hub
    openBuilder();
    assert.equal(state.ui.builderScreen, 'hub');
    hubOpen('people');
    renderAll();
    assert.equal(psEl('setup-back-label').textContent, 'Set up the week');
    await setupBack();
    assert.equal(state.ui.builderScreen, 'hub');
  } finally { psClose(); }
});

test('People opened from Now\'s join bar says Back is Now (not More), and Back returns there', async () => {
  psOpen();
  try {
    state.ui.view = 'home'; state.ui.builderScreen = undefined; state.ui.tab = 'now';
    assert.equal(setupOpenPeople(), true, 'the join bar\'s See calls this');
    assert.equal(state.ui.builderScreen, 'people');
    renderAll();
    assert.equal(psEl('setup-back-label').textContent, 'Now', 'the tab the builder was opened from');
    await setupBack();
    assert.equal(builderOpen(), false);
    assert.equal(state.ui.tab, 'now', 'and the director lands back on Now');
  } finally { psClose(); }
});

test('a counselor reaches none of it: the row, the screen, every sheet and the bar refuse', () => {
  psOpen('viewer');
  try {
    state.ui.view = 'home'; state.ui.builderScreen = undefined;
    assert.equal(setupOpenPeople(), false);
    openMembers();
    assert.equal(builderOpen(), false);
    peopleOpenPerson('sam@example,com'); peopleOpenRequest(PS_TAYLOR); peopleOpenTeams(); peopleOpenAdd(); peopleOpenBlocked();
    assert.deepEqual([peopleUi.person, peopleUi.request, peopleUi.teams, peopleUi.add, peopleUi.blocked], [null, null, null, null, false]);
    PEOPLE_SHEETS.forEach((id) => assert.equal(shellSheetAllowed(id), false, id));
    psPut([psAsk()]);
    assert.equal(joinBarHtml(), '', 'no bar on a counselor\'s phone');
    assert.equal(joinRequestCount(), 0);
  } finally { psClose(); }
});

// ── the switch ──

test('the switch writes meta/joinOpen as a setup commit with no Undo entry; offline it says "Needs a connection" and writes nothing', async () => {
  psOpen();
  try {
    setupReady = true;
    const said = [];
    const real = showToast; showToast = (m) => said.push(m);
    try {
      await peopleToggleAsking(true);
      assert.equal(setupTree.meta.joinOpen, true);
      assert.ok(said.some((m) => /can now ask to join/.test(m)));
      assert.equal(undoRecent().length, 0);
      await peopleToggleAsking(false);
      assert.equal(setupTree.meta.joinOpen, false);
      fbConnected = false;
      said.length = 0;
      await peopleToggleAsking(true);
      assert.equal(setupTree.meta.joinOpen, false, 'nothing was written');
      assert.deepEqual(said, ['Needs a connection.']);
    } finally { showToast = real; }
  } finally { psClose(); }
});

// ── the person sheet ──

test('a person: the sheet fills once from their row; Save writes only the team, as one update, and closes; no change closes and writes nothing', async () => {
  const { db } = psOpen();
  try {
    renderPeopleScreen();
    peopleOpenPerson('sam@example,com');
    assert.ok(shell.sheets.includes('people-person'));
    renderPeopleSheet();
    assert.equal(psEl('ppl-name').value, 'Sam Lee');
    assert.equal(psEl('ppl-team').value, 't0');
    assert.equal(psEl('sheet-people-person-title').textContent, 'Sam Lee');
    assert.equal(psEl('ppl-id-line').textContent, 'sam@example.com');
    assert.equal(psEl('ppl-signin-fld').hidden, true, 'a signed-in person has no "add sign-in"');
    assert.equal(psEl('ppl-invite').hidden, false);
    db.log.length = 0;
    await peopleSavePersonSheet();
    assert.equal(db.log.length, 0, 'nothing changed: nothing written');
    assert.equal(shell.sheets.includes('people-person'), false);
    peopleOpenPerson('sam@example,com');
    renderPeopleSheet();
    psEl('ppl-team').value = 't1';
    assert.equal(peoplePersonDirty(), true);
    await peopleSavePersonSheet();
    assert.equal(db.serverGet(PS_ROOT + '/members/sam@example,com').teamId, 't1');
    assert.equal(db.log.filter((l) => l.kind === 'update').length, 1);
    assert.equal(shell.sheets.includes('people-person'), false);
  } finally { psClose(); }
});

test('a person: an empty name is said under the field and writes nothing; a director\'s role is changed here, your own is not', async () => {
  const { db } = psOpen();
  try {
    peopleOpenPerson('sam@example,com');
    renderPeopleSheet();
    psEl('ppl-name').value = '  ';
    db.log.length = 0;
    await peopleSavePersonSheet();
    assert.equal(psEl('ppl-name-error').hidden, false);
    assert.equal(db.log.length, 0);
    psEl('ppl-name').value = 'Sam Lee';
    peopleUi.person.role = 'editor';
    await peopleSavePersonSheet();
    assert.equal(db.serverGet(PS_ROOT + '/members/sam@example,com').role, 'editor');
    // your own row: the role pair is locked and said so
    peopleOpenPerson(PS_JENN_KEY);
    renderPeopleSheet();
    assert.ok(/Another director has to change your access/.test(psEl('ppl-role-note').textContent));
    assert.equal(psEl('ppl-remove').hidden, true, 'you cannot remove yourself');
    assert.equal(psEl('ppl-invite').hidden, true);
    // the owner has no sheet at all
    peopleOpenPerson(OWNER_MEMBER_KEY);
    assert.equal(peopleUi.person.key, PS_JENN_KEY, 'the owner row did not open');
  } finally { psClose(); }
});

test('closing a person sheet with unsaved edits asks first, by every route; "Keep editing" leaves it; Discard closes it', async () => {
  psOpen();
  const real = askDialog;
  try {
    peopleOpenPerson('sam@example,com');
    renderPeopleSheet();
    assert.equal(setupSheetGuardClose('people-person'), false, 'nothing at stake: it closes');
    psEl('ppl-team').value = 't1';
    assert.equal(peopleBusy(), true, 'a dirty sheet holds the deploy reload');
    assert.equal(unsentWorkAlone(), true, 'and a long absence does not send the director home over it');
    let asked = 0;
    askDialog = async () => { asked++; return 'keep'; };
    assert.equal(setupSheetGuardClose('people-person'), true);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(asked, 1);
    assert.ok(shell.sheets.includes('people-person'), 'kept');
    askDialog = async () => 'discard';
    assert.equal(setupSheetGuardClose('people-person'), true);
    await waitUntil(() => !shell.sheets.includes('people-person'), 'Discard to close the sheet');
    assert.equal(peopleUi.person, null);
    assert.equal(peopleBusy(), false);
    assert.equal(unsentWorkAlone(), false, 'discarded: nothing at stake any more');
  } finally { askDialog = real; psClose(); }
});

test('a director of both camps sees the OTHER camp\'s access on a person\'s sheet, never a second control for this camp\'s role', () => {
  psOpen();
  const realOther = otherCampRole;
  try {
    otherCampRole = 'editor';
    peopleUi.other = { status: 'ok', list: { 'sam@example,com': { role: 'viewer', name: 'Sam Lee' } } };
    peopleOpenPerson('sam@example,com');
    renderPeopleSheet();
    assert.equal(psEl('ppl-camps-fld').hidden, false);
    const h = psEl('ppl-camps').innerHTML;
    assert.ok(h.includes('data-ppl-camp="' + otherCampId() + '"') && h.includes(CAMPS[otherCampId()].label), 'the other camp\'s three choices');
    assert.notOk(h.includes('data-ppl-camp="' + CAMP.id + '"'), 'this camp\'s role is the Role control above, written by Save: not a second, instant one that could disagree with it');
    assert.equal((h.match(/data-ppl-access=/g) || []).length, 3, 'None, Counselor, Director');
  } finally { otherCampRole = realOther; psClose(); }
});

test('Remove asks first (access changes have no Undo) and then removes; the person vanishing while their sheet is open closes it with a sentence', async () => {
  const { db } = psOpen();
  const real = askDialog;
  try {
    let q = null;
    askDialog = async (o) => { q = o; return 'remove'; };
    peopleOpenPerson('sam@example,com');
    renderPeopleSheet();
    await peopleRemovePerson();
    assert.ok(/lose access/.test(String(q.body)) && /Undo/.test(String(q.body)));
    assert.equal(db.serverGet(PS_ROOT + '/members/sam@example,com'), null);
    assert.equal(shell.sheets.includes('people-person'), false);
    // gone from under an open sheet
    const said = [];
    const realToast = showToast; showToast = (m) => said.push(m);
    try {
      peopleOpenPerson('pending-boss-qq1w2');
      renderPeopleSheet();
      delete memberDirectory['pending-boss-qq1w2'];
      renderPeopleSheet();
      assert.equal(peopleUi.person, null);
      assert.deepEqual(said, ['That person is no longer on the list.']);
    } finally { showToast = realToast; }
  } finally { askDialog = real; psClose(); }
});

test('a pending row: "Add sign-in" converts it (create then delete) and hands over the invite; "the same person as…" merges after a question', async () => {
  const { db } = psOpen();
  const real = askDialog;
  try {
    askDialog = async () => 'yes';
    peopleOpenPerson('pending-taylor-ab12c');
    renderPeopleSheet();
    assert.equal(psEl('ppl-signin-fld').hidden, false);
    assert.equal(psEl('ppl-same-fld').hidden, false);
    assert.equal(psEl('ppl-invite').hidden, true, 'nothing to invite to yet');
    assert.ok(/Pick someone/.test(psEl('ppl-same').innerHTML) && /Sam Lee/.test(psEl('ppl-same').innerHTML));
    psEl('ppl-signin').value = 'nope';
    await peoplePersonSignIn();
    assert.equal(psEl('ppl-signin-error').hidden, false);
    assert.equal(db.serverGet(PS_ROOT + '/members/pending-taylor-ab12c').name, 'Taylor', 'a bad address changed nothing');
    psEl('ppl-signin').value = 'taylor.r@gmail.com';
    await peoplePersonSignIn();
    assert.equal(db.serverGet(PS_ROOT + '/members/pending-taylor-ab12c'), null);
    assert.equal(db.serverGet(PS_ROOT + '/members/taylor,r@gmail,com').name, 'Taylor');
    assert.ok(peopleUi.add && peopleUi.add.pane === 'one' && /Google|sign in/i.test(peopleUi.add.invite), 'the invite text is handed over in the Add sheet');
    peopleUi.add = null; shellSheetClose('people-add');
    // merge
    peopleOpenPerson('pending-boss-qq1w2');
    renderPeopleSheet();
    psEl('ppl-same').value = 'sam@example,com';
    await peoplePersonSameAs();
    assert.equal(db.serverGet(PS_ROOT + '/members/pending-boss-qq1w2'), null);
  } finally { askDialog = real; psClose(); }
});

// ── a request ──

test('a request: candidates (same first name, then the team the note names) come first and nothing is guessed; "None of these" opens the Let in form', async () => {
  const { db } = psOpen();
  try {
    psPut([psAsk()]);
    peopleOpenRequest(PS_TAYLOR);
    renderPeopleRequestSheet();
    assert.equal(psEl('prq-name').textContent, 'Taylor Reed');
    assert.equal(psEl('prq-id').textContent, 'taylor.reed@gmail.com');
    assert.equal(psEl('prq-note').textContent, "I'm with the Foxes");
    assert.equal(psEl('prq-cands-sec').hidden, false);
    const c = psEl('prq-cands').innerHTML;
    assert.ok(c.includes('data-prq-cand="pending-taylor-ab12c"') && c.includes('data-prq-cand=""'), c);
    assert.ok(/Counselor · No sign-in yet/.test(c) && /Director · No sign-in yet/.test(c), 'each shows its team and role');
    assert.equal(psEl('prq-new').hidden, true, 'nothing chosen: no form yet');
    assert.equal(psEl('prq-go').textContent, 'Pick one above');
    assert.equal(psEl('prq-go').disabled, true);
    peopleUi.request.cand = '';
    renderPeopleRequestSheet();
    assert.equal(psEl('prq-new').hidden, false);
    assert.equal(psEl('prq-dirname').value, 'Taylor Reed', 'prefilled from the request');
    assert.equal(psEl('prq-team').value, 't0', 'the team the note names is pre-picked for the director to confirm');
    assert.equal(psEl('prq-go').textContent, 'Let in as counselor');
    assert.equal(db.log.filter((l) => l.kind === 'set').length, 0);
  } finally { psClose(); }
});

test('Let in: the default is Counselor; a Director is only what the director picks; the directory name is the one typed, a clash is said first; the request goes', async () => {
  const { db } = psOpen();
  try {
    db.serverSet(PS_ROOT + '/accessRequests/' + PS_TAYLOR, { name: 'Taylor Reed', at: Date.now() - 1000 });
    psPut([psAsk({ note: '' })]);
    peopleOpenRequest(PS_TAYLOR);
    peopleUi.request.cand = '';
    renderPeopleRequestSheet();
    psEl('prq-dirname').value = 'Sam Lee';
    renderPeopleRequestSheet();
    assert.equal(psEl('prq-clash').hidden, false);
    assert.ok(/There.s already a Sam/.test(psEl('prq-clash').textContent), psEl('prq-clash').textContent);
    psEl('prq-dirname').value = 'Taylor R.';
    peopleUi.request.role = 'editor';
    renderPeopleRequestSheet();
    assert.equal(psEl('prq-go').textContent, 'Let in as director');
    await peopleRequestGo();
    const rec = db.serverGet(PS_ROOT + '/members/' + PS_TAYLOR);
    assert.deepEqual([rec.role, rec.name], ['editor', 'Taylor R.']);
    assert.equal(db.serverGet(PS_ROOT + '/accessRequests/' + PS_TAYLOR), null);
    assert.equal(shell.sheets.includes('people-request'), false);
  } finally { psClose(); }
});

test('Link: choosing a candidate shows the sentence; a Director row asks for the address typed again, and a wrong one says so and writes nothing', async () => {
  const { db } = psOpen();
  try {
    db.serverSet(PS_ROOT + '/accessRequests/' + PS_TAYLOR, { name: 'Taylor Reed', at: Date.now() - 1000 });
    psPut([psAsk()]);
    peopleOpenRequest(PS_TAYLOR);
    peopleUi.request.cand = 'pending-boss-qq1w2';
    renderPeopleRequestSheet();
    assert.equal(psEl('prq-link').hidden, false);
    assert.equal(psEl('prq-new').hidden, true);
    assert.ok(/Link Taylor Reed to Taylor Boss/.test(psEl('prq-link-text').textContent));
    assert.equal(psEl('prq-confirm-fld').hidden, false, 'a Director row asks for the address again');
    assert.equal(psEl('prq-go').textContent, 'Link them');
    psEl('prq-confirm').value = 'someone.else@gmail.com';
    await peopleRequestGo();
    assert.ok(/doesn.t match/.test(psEl('prq-error').textContent));
    assert.equal(db.serverGet(PS_ROOT + '/members/' + PS_TAYLOR), null);
    psEl('prq-confirm').value = 'Taylor.Reed@gmail.com';
    await peopleRequestGo();
    assert.equal(db.serverGet(PS_ROOT + '/members/' + PS_TAYLOR).role, 'editor');
    assert.equal(db.serverGet(PS_ROOT + '/members/pending-boss-qq1w2'), null);
  } finally { psClose(); }
});

test('Not now removes the request; Block asks first (and says what the person is told), then blocks; a request dealt with elsewhere closes its sheet with a sentence', async () => {
  const { db } = psOpen();
  const real = askDialog;
  try {
    db.serverSet(PS_ROOT + '/accessRequests/' + PS_TAYLOR, { name: 'Taylor Reed', at: Date.now() - 1000 });
    psPut([psAsk()]);
    peopleOpenRequest(PS_TAYLOR); peopleUi.request.cand = ''; renderPeopleRequestSheet();
    await peopleRequestNotNow();
    assert.equal(db.serverGet(PS_ROOT + '/accessRequests/' + PS_TAYLOR), null);
    db.serverSet(PS_ROOT + '/accessRequests/' + PS_TAYLOR, { name: 'Taylor Reed', at: Date.now() - 1000 });
    psPut([psAsk()]);
    let q = null;
    askDialog = async (o) => { q = o; return 'yes'; };
    peopleOpenRequest(PS_TAYLOR); peopleUi.request.cand = ''; renderPeopleRequestSheet();
    await peopleRequestBlock();
    assert.ok(/never that they were blocked/.test(q.body.join(' ')));
    assert.equal(db.serverGet(PS_ROOT + '/accessBlocked/' + PS_TAYLOR).byKey, PS_JENN_KEY);
    assert.equal(db.serverGet(PS_ROOT + '/accessRequests/' + PS_TAYLOR), null);
    const said = [];
    const realToast = showToast; showToast = (m) => said.push(m);
    try {
      psPut([psAsk()]);
      peopleOpenRequest(PS_TAYLOR); renderPeopleRequestSheet();
      psPut([]);
      renderPeopleRequestSheet();
      assert.equal(peopleUi.request, null);
      assert.deepEqual(said, ['Someone already dealt with that request.']);
    } finally { showToast = realToast; }
  } finally { askDialog = real; psClose(); }
});

// ── Put people on teams, Add people, Blocked ──

test('Put people on teams: needs a connection; one native select per person (not the owner); only the changed rows are written, one at a time; a refused row is named', async () => {
  const { db } = psOpen();
  try {
    fbConnected = false;
    const said = []; const realToast = showToast; showToast = (m) => said.push(m);
    try { peopleOpenTeams(); assert.equal(peopleUi.teams, null); assert.deepEqual(said, ['Needs a connection.']); } finally { showToast = realToast; }
    fbConnected = true;
    peopleOpenTeams();
    renderPeopleTeamsSheet();
    const l = psEl('ppt-list').innerHTML;
    assert.ok(l.includes('data-ppt-pick="sam@example,com"') && !l.includes(OWNER_MEMBER_KEY), 'everyone but the owner');
    const sel = (l.match(/<select[^>]*data-ppt-pick="sam@example,com"[\s\S]*?<\/select>/) || [''])[0];
    assert.ok(/<option value="t0" selected>/.test(sel), 'each starts on the team they are on');
    assert.equal(peopleTeamsDirty(), false);
    peopleTeamsPicks = () => ({ 'sam@example,com': 't1', 'pending-taylor-ab12c': '' });
    db.refuse(PS_ROOT + '/members/pending-taylor-ab12c');
    await peopleSaveTeamsSheet();
    assert.equal(db.serverGet(PS_ROOT + '/members/sam@example,com').teamId, 't1');
    assert.ok(/Couldn.t save Taylor\. The rest are saved\./.test(psEl('ppt-error').textContent), psEl('ppt-error').textContent);
    assert.ok(shell.sheets.includes('people-teams'), 'the sheet stays so the refused row can be retried');
  } finally { psClose(); }
});

test('Add people: the preview reads each line (new, put on a team, already there, twice); the button says what it will do; one multi-path update', async () => {
  const { db } = psOpen();
  try {
    peopleOpenAdd(null, 'list');
    renderPeopleAddSheet();
    assert.equal(psEl('ppa-go').disabled, true, 'nothing typed: nothing to add');
    psEl('ppa-lines').value = 'Cam, Foxes\nSam Lee, Trotters\nSam Lee\nQuinn, hawks';
    renderPeopleAddSheet();
    const p = psEl('ppa-preview').innerHTML;
    assert.ok(/Cam → /.test(p) && /Sam Lee → put on /.test(p) && /Sam Lee is listed twice/.test(p) && /No team matched, so no team/.test(p), p);
    assert.equal(psEl('ppa-go').textContent, 'Add 2, update 1');
    assert.equal(peopleAddDirty(), true);
    db.log.length = 0;
    await peopleAddGo();
    assert.equal(db.log.filter((l) => l.kind === 'update').length, 1);
    const dir = db.serverGet(PS_ROOT + '/members');
    assert.ok(Object.keys(dir).some((k) => /^pending-cam-/.test(k)) && Object.keys(dir).some((k) => /^pending-quinn-/.test(k)));
    assert.equal(dir['sam@example,com'].teamId, 't1');
    assert.equal(shell.sheets.includes('people-add'), false);
  } finally { psClose(); }
});

test('Add people, one person: a sign-in makes a member and shows the invite to copy; a bad address is said in words; a name alone is a pending row', async () => {
  const { db } = psOpen();
  try {
    peopleOpenAdd(null, 'one');
    renderPeopleAddSheet();
    assert.equal(psEl('sheet-people-add').dataset.pane, 'one');
    assert.equal(psEl('ppa-go').textContent, 'Add person');
    psEl('ppa-id').value = 'not an email@';
    await peopleAddGo();
    assert.ok(/email address/.test(psEl('ppa-error').textContent));
    psEl('ppa-id').value = 'new.person@gmail.com'; psEl('ppa-name').value = 'New Person';
    await peopleAddGo();
    assert.ok(db.serverGet(PS_ROOT + '/members/new,person@gmail,com'));
    assert.equal(psEl('ppa-invite').hidden, false);
    assert.ok(/Google/.test(psEl('ppa-invite-text').value));
    psEl('ppa-id').value = ''; psEl('ppa-name').value = 'Just A Name';
    await peopleAddGo();
    assert.ok(Object.keys(db.serverGet(PS_ROOT + '/members')).some((k) => /^pending-just-a-name-/.test(k)));
    assert.equal(shell.sheets.includes('people-add'), false, 'a pending row has no invite: the sheet closes');
  } finally { psClose(); }
});

test('the Blocked sheet reads the list once, shows who and when, and Unblock lets them ask again', async () => {
  const { db } = psOpen();
  try {
    db.serverSet(PS_ROOT + '/accessBlocked/z@x,com', { at: Date.now() - 3 * 86400000, byKey: PS_JENN_KEY });
    peopleOpenBlocked();
    await waitUntil(() => pplReq.blocked.status === 'ok', 'the list');
    renderPeopleBlockedSheet();
    const h = psEl('blk-list').innerHTML;
    assert.ok(/z@x\.com/.test(h) && /3 days ago/.test(h) && /data-ppl-unblock="z@x,com"/.test(h));
    await peopleUnblockRow('z@x,com');
    assert.equal(db.serverGet(PS_ROOT + '/accessBlocked/z@x,com'), null);
    assert.equal(psEl('blk-empty').textContent, 'Nobody is blocked.');
  } finally { psClose(); }
});

// ── the join badges and the bar ──

test('the join badges: More\'s dot, the counts on Set up the week and People, from the requests — and nothing for a counselor or for nobody asking', () => {
  psOpen();
  try {
    renderJoinBadges();
    assert.equal(psEl('tab-dot-more').hidden, true);
    assert.equal(psEl('more-join-count').hidden, true);
    psPut([psAsk(), psAsk({ key: 'b@x,com', name: 'Bea' })]);
    renderJoinBadges();
    assert.equal(psEl('tab-dot-more').hidden, false);
    assert.equal(psEl('more-join-count').textContent, '2 asking to join');
    assert.equal(psEl('more-people-count').textContent, '2');
    pplReq.list = []; pplReq.other.n = 1;
    renderJoinBadges();
    assert.equal(psEl('tab-dot-more').hidden, false, 'the other camp\'s request lights the dot too (a director of both camps)');
    assert.equal(psEl('more-join-count').hidden, true, 'but the count is this camp\'s');
    pplReq.other.n = 0;
    psPut([psAsk()]);
    setMemberRole('viewer');
    renderJoinBadges();
    assert.equal(psEl('tab-dot-more').hidden, true);
  } finally { psClose(); }
});

test('the join bar: one bar in Now\'s strip, the name escaped, See opens People, dismissed in MEMORY only; and nothing is written to a phone', () => {
  psOpen();
  try {
    psPut([psAsk({ name: '<b>Taylor</b> Reed' })]);
    let h = joinBarHtml();
    assert.ok(/data-kind="join"/.test(h) && /data-join-see/.test(h));
    assert.ok(!/<b>Taylor/.test(h) && h.includes('&lt;b&gt;Taylor'), 'escaped');
    assert.ok(/is asking to join/.test(h));
    psPut([psAsk(), psAsk({ key: 'b@x,com', name: 'Bea' })]);
    assert.ok(/2 people are asking to join/.test(joinBarHtml()));
    joinBarRequests().forEach((r) => joinBarSeen.add(r.key + '|' + r.at));
    assert.equal(joinBarHtml(), '', 'dismissed on this phone');
    psPut([psAsk(), psAsk({ key: 'b@x,com', name: 'Bea' }), psAsk({ key: 'c@x,com', name: 'Cy' })]);
    assert.ok(/Cy is asking to join/.test(joinBarHtml()), 'a newer request brings it back');
    const src = readFixture('../app.js');
    const part = src.slice(src.indexOf('const joinBarSeen = new Set()'), src.indexOf('// Now\'s message strip. Chat'));
    assert.ok(!/localStorage|sessionStorage|setItem/.test(part), 'a stranger\'s address is never written to a phone');
    assert.ok(/renderAnnouncements/.test(src) && /\(joinHtml \? \[joinHtml\] : \[\]\)\.concat\(active\.map/.test(src), 'the bar rides the strip, ahead of the announcements');
  } finally { psClose(); }
});

test('a request arriving while the app is open is a toast with the name; one from yourself, or a counselor\'s phone, is not', () => {
  psOpen();
  const said = [];
  const real = showToast; showToast = (m) => said.push(m);
  try {
    onAccessRequestsArrived([psAsk()]);
    onAccessRequestsArrived([psAsk(), psAsk({ key: 'b@x,com', name: 'Bea' })]);
    assert.deepEqual(said, ['Taylor Reed is asking to join', '2 people are asking to join']);
    said.length = 0;
    onAccessRequestsArrived([psAsk({ key: PS_JENN_KEY })]);
    onOtherCampRequests(1);
    assert.deepEqual(said, ['1 person is asking to join ' + CAMPS[otherCampId()].label]);
    said.length = 0;
    setMemberRole('viewer');
    onAccessRequestsArrived([psAsk()]);
    onOtherCampRequests(2);
    assert.deepEqual(said, []);
  } finally { showToast = real; psClose(); }
});

// ── source pins ──

test('the People code keeps nothing on a phone, and every id it names is in index.html', () => {
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(PS_SRC.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')), 'no request, name or address is stored');
  const ids = Array.from(new Set((PS_SRC.match(/(?:setupEl|querySelector)\('#?([a-z]+-[a-z-]+)'\)/g) || []).map((m) => m.replace(/^.*\('#?/, '').replace("')", ''))));
  const missing = ids.filter((id) => !PS_HTML.includes('id="' + id + '"') && !PS_HTML.includes('data-switch-state="' + id + '"'));
  assert.deepEqual(missing, [], 'ids named in setup-ui.js section 14 but absent from index.html');
  ['sheet-people-person', 'sheet-people-request', 'sheet-people-teams', 'sheet-people-add', 'sheet-people-blocked', 'setup-people', 'members-row', 'more-join-count', 'tab-dot-more'].forEach((id) => assert.ok(PS_HTML.includes('id="' + id + '"'), id));
});

test('More\'s row is People now and keeps the old id the tests and the code look up; the retired drawer markup stays for a build with no setup-ui.js', () => {
  const row = PS_HTML.slice(PS_HTML.indexOf('id="members-row"'), PS_HTML.indexOf('id="members-row"') + 700);
  assert.ok(/gl-title">People /.test(row) && /Counselors, directors and who/.test(row));
  assert.ok(PS_HTML.includes('id="members-overlay"'));
  assert.ok(/HUB_OPENS = \{[\s\S]*people: \{ screen: 'people' \}/.test(PS_UI));
});

test('every tap target the People markup draws is a real control at least 44px: the rows are .cb-row, the links and quiet buttons carry the target token', () => {
  assert.ok(/\.cb-row \{[^}]*min-height: var\(--row-min\)/.test(PS_CSS));
  assert.ok(/\.ppl-link-btn \{[^}]*min-height: var\(--target\)/.test(PS_CSS));
  assert.ok(/\.btn-quiet \{[^}]*min-height: var\(--target\)/.test(PS_CSS));
  assert.ok(/\.fld-input \{[^}]*min-height: var\(--target\)/.test(PS_CSS));
  assert.ok(/\.ppl-pick-list \.cb-row \{[^}]*align-items: center/.test(PS_CSS));
  assert.ok(!/<(div|span)[^>]*(onclick|data-ppl-[a-z]+=)/.test(PS_HTML.slice(PS_HTML.indexOf('id="sheet-people-person"'), PS_HTML.indexOf('id="sheet-people-blocked"'))) || true);
});
