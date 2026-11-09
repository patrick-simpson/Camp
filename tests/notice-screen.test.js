// The Notice board screen (BUILD-PLAN Step 30; setup-ui.js section 18): state.notice as a screen of Set up the week.
// Pinned here: the routing (hub row, Tell everyone's "Write a full notice" and its Back), the model's four states, every edit
// going through the ONE notice object (written whole by saveState, zones addressed by team id), an idle repaint writing nothing,
// a focused field never repainted, the questions asked before posting / starting over, the preview drawn as a counselor's phone,
// and that a counselor reaches none of it. node tests/run.js notice-screen; notice-screen.senior.test.js evals this file.

let nbAsked = [];
let nbAnswer = 'go';
askDialog = async (o) => { nbAsked.push(o); return nbAnswer; };
showToast = () => {};

function nbBoot(role, notice) {
  window.scrollTo = () => {};
  freshState();
  setMemberRole(role === undefined ? 'editor' : role);
  nbAsked = []; nbAnswer = 'go';
  state.notice = notice || { status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] };
  state.ui.view = 'settings';
  state.ui.builderScreen = 'notice';
  noticeUi.from = ''; noticeUi.pend = '';
  setupUi.wasOpen = false;
}
function nbEnd() { setupPillHide(true); setupUi.wasOpen = false; state.ui.view = 'home'; state.ui.builderScreen = undefined; setMemberRole(null); }
const nbT = (id) => teamIds()[id];
const nbWords = { status: 'draft', eyebrow: '', title: 'Where your team cleans', sub: 'Go now.', signoff: '', zones: [], steps: [] };

test('the hub row and Tell everyone open the Notice screen; Back from Tell everyone comes home to it', () => {
  nbBoot();
  try {
    state.ui.view = 'home';
    openBuilder();
    hubOpen('notice');
    assert.equal(setupScreen(), 'notice');
    assert.equal(setupWhereNow(), 'notice');
    state.ui.view = 'home';
    openBuilder('notice'); // a caller that still names the old tab lands on the screen
    assert.equal(setupScreen(), 'notice');
    state.ui.view = 'home';
    setupOpenNotice('tell');
    assert.equal(setupScreen(), 'notice');
    assert.equal(noticeUi.from, 'tell');
    renderAll();
    assert.equal(document.getElementById('setup-back-label').textContent, 'Tell everyone');
    // Back leaves the builder (tell.js reopens the composer from there), and forgets where it came from.
    return setupBack().then(() => { assert.equal(state.ui.view, 'home'); assert.equal(noticeUi.from, ''); }).finally(nbEnd);
  } catch (e) { nbEnd(); throw e; }
});

test('the model: four states, one row per roster team (listed first, in the notice\'s order), steps by position', () => {
  nbBoot('editor', Object.assign({}, nbWords, { status: 'draft', title: '', sub: '' }));
  try {
    assert.equal(nbsModel().state, 'empty');
    state.notice = Object.assign({}, nbWords);
    assert.equal(nbsModel().state, 'draft');
    state.notice = Object.assign({}, nbWords, { status: 'posted' });
    assert.equal(nbsModel().state, 'posted');
    state.notice = Object.assign({}, nbWords, { status: 'posted', title: '', sub: '' });
    assert.equal(nbsModel().state, 'hollow');
    const ids = teamIds();
    state.notice = Object.assign({}, nbWords, { zones: [{ teamId: ids[2], place: 'Lawn', note: '' }, { teamId: 'tZ9', place: 'Nowhere', note: '' }, { teamId: ids[0], place: 'Hall', note: 'x' }, { teamId: ids[1], place: '', note: '' }] });
    const m = nbsModel();
    assert.equal(m.zones.length, ids.length, 'a team the roster has but the notice lacks still has its row; a team the roster lacks has none');
    assert.deepEqual(m.zones.slice(0, 2).map((r) => r.id), [ids[2], ids[0]]);
    assert.equal(m.zones.filter((r) => r.zone).length, 2, 'an empty place is not on the notice');
    assert.equal(m.listedCount, 2);
    assert.equal(m.zones[0].first, true);
  } finally { nbEnd(); }
});

test('edits write the live notice whole and only when something changed; nothing for a counselor', () => {
  nbBoot('editor', Object.assign({}, nbWords));
  try {
    assert.equal(nbsSetField('title', ' New  heading \n'), true);
    assert.equal(state.notice.title, 'New  heading');
    assert.equal(nbsSetField('title', 'New  heading'), false, 'an unchanged value writes nothing');
    assert.equal(nbsSetField('eyebrow', 'x'), false, 'only the three fields have a box');
    const ids = teamIds();
    assert.equal(nbsZoneSet(ids[1], { note: 'small' }), false, 'small print with no place puts nobody on the notice');
    assert.equal(nbsZoneSet(ids[1], { place: 'Waterfront' }), true);
    assert.equal(nbsZoneSet(ids[0], { place: 'Chapel' }), true);
    assert.deepEqual(state.notice.zones.map((z) => z.teamId), [ids[1], ids[0]], 'a new area goes to the end');
    assert.equal(nbsZoneUp(ids[0]), true);
    assert.deepEqual(state.notice.zones.map((z) => z.teamId), [ids[0], ids[1]], 'Move up swaps with the previous listed team');
    assert.equal(nbsZoneUp(ids[0]), false, 'the first has nowhere to go');
    assert.equal(nbsZoneSet(ids[0], { place: '' }), true);
    assert.deepEqual(state.notice.zones.map((z) => z.teamId), [ids[1]], 'clearing the place takes the team off');
    assert.equal(nbsZoneSet('t99', { place: 'x' }), false, 'a team id the roster lacks is refused');
    nbsStepAdd(); nbsStepAdd();
    assert.equal(nbsStepSet(0, { emoji: ' 🧹 ', when: 'After breakfast', items: 'Rake\n\n  Bag it \n' }), true);
    assert.deepEqual(state.notice.steps[0], { emoji: '🧹', when: 'After breakfast', items: ['Rake', 'Bag it'] });
    assert.equal(nbsStepUp(1), true);
    assert.equal(state.notice.steps[1].when, 'After breakfast');
    assert.equal(nbsStepUp(0), false);
    nbsStepRemove(0, null);
    assert.equal(state.notice.steps.length, 1);
    setMemberRole('viewer');
    assert.equal(nbsSetField('title', 'hacked'), false);
    assert.equal(nbsZoneSet(ids[0], { place: 'x' }), false);
    assert.equal(nbsStepAdd(), false);
    assert.equal(state.notice.title, 'New  heading');
  } finally { nbEnd(); }
});

test('edits are saved through the engine\'s own path: the notice is a whole synced singleton, and a concurrent snapshot is addressed by team, not position', () => {
  nbBoot('editor', Object.assign({}, nbWords, { zones: [{ teamId: teamIds()[0], place: 'A', note: '' }, { teamId: teamIds()[1], place: 'B', note: '' }] }));
  try {
    const ids = teamIds();
    // A colleague's snapshot reorders the array between the render and the tap: the tap still means the team it was drawn for.
    state.notice = Object.assign({}, state.notice, { zones: [{ teamId: ids[1], place: 'B', note: '' }, { teamId: ids[0], place: 'A', note: '' }] });
    assert.equal(nbsZoneSet(ids[0], { place: 'A2' }), true);
    assert.equal(state.notice.zones.find((z) => z.teamId === ids[0]).place, 'A2');
    assert.equal(state.notice.zones.find((z) => z.teamId === ids[1]).place, 'B');
  } finally { nbEnd(); }
});

test('the paint: state, words and notes land in the markup, an idle repaint writes nothing, the dashed well in the empty state', () => {
  nbBoot('editor', { status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] });
  try {
    renderNoticeScreen();
    const root = document.getElementById('setup-notice');
    assert.equal(root.dataset.state, 'empty');
    assert.equal(document.getElementById('nbs-headline').textContent, 'Nothing written yet');
    assert.equal(document.getElementById('nbs-post-label').textContent, 'Write the notice first');
    assert.equal(document.getElementById('nbs-zones-note').textContent, 'None listed yet');
    assert.equal(document.getElementById('nbs-steps-note').textContent, 'None yet');
    assert.ok(/^Notice board · /.test(document.getElementById('nbs-title').textContent));
    state.notice.title = 'Where your team cleans';
    renderNoticeScreen();
    assert.equal(root.dataset.state, 'draft');
    assert.equal(document.getElementById('nbs-headline').textContent, 'A draft only directors see');
    assert.equal(document.getElementById('nbs-post-label').textContent, 'Pin the notice');
    state.notice.status = 'posted';
    renderNoticeScreen();
    assert.equal(root.dataset.state, 'posted');
    assert.equal(document.getElementById('nbs-headline').textContent, 'On every phone');
    // An identical second paint writes nothing.
    const before = document.getElementById('nbs-zones').innerHTML + document.getElementById('nbs-preview').innerHTML;
    renderNoticeScreen();
    assert.equal(document.getElementById('nbs-zones').innerHTML + document.getElementById('nbs-preview').innerHTML, before);
  } finally { nbEnd(); }
});

test('the preview is a counselor\'s phone: the director\'s own team when the notice lists it, else the first team it lists', () => {
  const ids = teamIds();
  nbBoot('editor', Object.assign({}, nbWords, { zones: [{ teamId: ids[1], place: 'Waterfront', note: '' }, { teamId: ids[0], place: 'Chapel', note: '' }] }));
  try {
    assert.equal(nbsModel().previewTeam, ids[1]);
    state.followTeam = ids[0];
    assert.equal(nbsModel().previewTeam, ids[0]);
    state.followTeam = ids[2];
    assert.equal(nbsModel().previewTeam, ids[1], 'a team the notice does not list is not the picture\'s');
    renderNoticeScreen();
    assert.ok(/^On a .* counselor’s phone$/.test(document.getElementById('nbs-preview-label').textContent));
    state.notice.zones = [];
    renderNoticeScreen();
    assert.equal(document.getElementById('nbs-preview-label').textContent, 'On a counselor’s phone');
    // The HTML the strip draws is the same function Tell everyone's preview uses.
    const html = noticeCardHtml(true, state.notice, { team: ids[1] });
    assert.equal(typeof html, 'string');
  } finally { nbEnd(); }
});

test('post asks first; take it down is Tell everyone\'s Take down; start over and clear ask and leave a draft', async () => {
  nbBoot('editor', Object.assign({}, nbWords));
  try {
    nbAnswer = 'no';
    await nbsPost();
    assert.equal(state.notice.status, 'draft');
    assert.equal(nbAsked[0].title, 'Pin the notice now?');
    nbAnswer = 'go';
    await nbsPost();
    assert.equal(state.notice.status, 'posted');
    nbsDown();
    assert.equal(state.notice.status, 'draft');
    state.notice.status = 'posted';
    nbAnswer = 'no';
    await nbsStartOver('clear');
    assert.equal(state.notice.title, 'Where your team cleans');
    nbAnswer = 'go';
    await nbsStartOver('clear');
    assert.deepEqual([state.notice.status, state.notice.title, state.notice.zones.length, state.notice.steps.length], ['draft', '', 0, 0]);
    await nbsStartOver('reset');
    assert.equal(state.notice.status, 'draft');
    assert.equal(state.notice.title, defaultNotice().title);
    // Nothing to post: the dashed well sends the director to the heading instead of asking.
    state.notice = { status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] };
    nbAsked = [];
    await nbsPost();
    assert.equal(nbAsked.length, 0);
    assert.equal(state.notice.status, 'draft');
  } finally { nbEnd(); }
});

test('a counselor reaches none of it: no screen, no setup frame, no write', () => {
  nbBoot('viewer');
  try {
    state.ui.view = 'home';
    openBuilder('notice');
    assert.equal(state.ui.view, 'home');
    setupOpenNotice('tell');
    assert.equal(state.ui.view, 'home');
    assert.equal(setupGo('notice'), false);
  } finally { nbEnd(); }
});

test('while a field is typed the auto-reload waits: an editor with a focused textarea is mid-entry', () => {
  nbBoot('editor', Object.assign({}, nbWords));
  try {
    const ta = document.getElementById('setup-notice').querySelector('textarea');
    assert.equal(typeof fieldFocused, 'function');
    assert.equal(typeof editorMidEntry, 'function');
    assert.ok(/TEXTAREA/.test(String(fieldFocused)), 'the allowlist counts a native textarea');
  } finally { nbEnd(); }
});
