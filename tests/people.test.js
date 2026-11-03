// People (BUILD-PLAN Step 25, P2 §11.8; setup-sync.js "PEOPLE"): the pure rules (what a request's words are cleaned to, which pending rows
// might be the person asking, how a team is named by a word, what pasted lines resolve to, which rows a Put-people-on-teams pass writes) and
// the data half against the in-memory database (the editor-only requests listener and when it attaches, Let in / Link / Not now / Block in
// the order the rules need, Put people on teams one row at a time, Add people in ONE multi-path update, the owner row and your own never
// written). The People SCREEN is people-screen.test.js; the requester's side is access-requests.test.js. people.senior.test.js evals this
// file under the senior profile.

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const PP_ROOT = CAMP.dbRoot;
const PP_JENN = { email: 'jenn@example.com', emailVerified: true };
const PP_JENN_KEY = 'jenn@example,com';
const PP_TAYLOR = 'taylor,reed@gmail,com';  // the walk-up
const PP_TEAMS = [{ id: 't0', name: 'Ferocious Foxes' }, { id: 't1', name: 'Turkey Trotters' }];
const PP_ISO = '2026-11-01T12:00:00.000Z';

// The directory every case starts from (a camp's list as the app holds it): a director (you), the owner, a counselor on a team and three
// pending rows (a name and a team, no sign-in yet), one of them a Director.
const PP_DIR = () => ({
  [PP_JENN_KEY]: { role: 'editor', name: 'Jenn Reed', addedBy: 'x', addedAt: PP_ISO },
  [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick Simpson', addedBy: 'console', addedAt: PP_ISO },
  'sam@example,com': { role: 'viewer', name: 'Sam Lee', teamId: 't0', addedBy: 'x', addedAt: PP_ISO },
  'pending-taylor-ab12c': { role: 'viewer', name: 'Taylor', teamId: 't0', addedBy: 'x', addedAt: PP_ISO },
  'pending-tay-zz9y8': { role: 'viewer', name: 'Tay', teamId: 't1', addedBy: 'x', addedAt: PP_ISO },
  'pending-boss-qq1w2': { role: 'editor', name: 'Taylor Boss', teamId: 't1', addedBy: 'x', addedAt: PP_ISO },
});

function ppSetup(opts) {
  const o = opts || {};
  freshState();
  authUser = PP_JENN;
  setMemberRole(o.role || 'editor');
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb();
  window.firebase = makeFakeFirebase(db);
  fbConnKnown = true; fbConnected = true;
  syncStarted = false; // a test that wants the listener says so (ppListen): the role change's own attach waits on it
  state.teams = PP_TEAMS.map((t) => Object.assign({}, t));
  memberDirectory = Object.assign(PP_DIR(), o.directory || {});
  memberDirectoryLoaded = true;
  db.serverSet(PP_ROOT + '/members', JSON.parse(JSON.stringify(memberDirectory)));
  pplReq.ref = null; pplReq.list = []; pplReq.loaded = false; pplReq.denied = false; pplReq.seen = null; pplReq.other = { n: 0, probed: false };
  pplReq.blocked = { status: 'idle', rows: [] };
  return { db };
}

function ppTeardown() {
  peopleRequestsDetach();
  delete window.FIREBASE_CONFIG;
  delete window.firebase;
  fbConnKnown = false; fbConnected = false;
  syncStarted = false;
  setMemberRole(null);
  authUser = null; memberDirectory = null; memberDirectoryLoaded = false;
}

const ppListen = () => { syncStarted = true; peopleRequestsAttach(); };
const ppAsk = (db, key, over) => db.serverSet(PP_ROOT + '/accessRequests/' + key, Object.assign({ name: 'Taylor Reed', at: Date.now() }, over || {}));
const ppReq = (over) => Object.assign({ key: PP_TAYLOR, name: 'Taylor Reed', at: Date.now() }, over || {});
const ppWrites = (db) => db.log.filter((l) => l.kind !== 'transaction' || true).map((l) => l.kind + ' ' + l.paths.join(','));

// ── cleaning what a stranger typed ──

test('a request is cleaned to the rules\' limits: name 60, note 200, control characters gone, a wild time clamped', () => {
  const r = pplNormRequest(PP_TAYLOR, { name: '  Taylor\n\t Reed  ' + 'x'.repeat(100), note: 'N'.repeat(400), at: Date.now() + 9e12 });
  assert.equal(r.name.length, 60);
  assert.ok(r.name.startsWith('Taylor Reed xxx'), 'whitespace folded');
  assert.equal(r.note.length, 200);
  assert.ok(r.at <= Date.now() + 1000, 'a far-future time reads as now');
  assert.equal(pplNormRequest(PP_TAYLOR, { name: 'A', at: -5 }).at, 0);
});

test('markup in a name or a note stays inert TEXT (the screen escapes it; nothing here interprets it)', () => {
  const r = pplNormRequest(PP_TAYLOR, { name: '<img src=x onerror=alert(1)>', note: '"><script>x</script>', at: 5 });
  assert.equal(r.name, '<img src=x onerror=alert(1)>');
  assert.equal(esc(r.name), '&lt;img src=x onerror=alert(1)&gt;');
  assert.ok(!esc(r.note).includes('<script>'));
});

test('a row the rules could not have let in is dropped: a pending-looking key, no @ or +, no name, not an object', () => {
  assert.equal(pplNormRequest('pending-x-1', { name: 'A', at: 1 }), null);
  assert.equal(pplNormRequest('nobody', { name: 'A', at: 1 }), null);
  assert.equal(pplNormRequest('a.b@x,com', { name: 'A', at: 1 }), null, 'a dot is not a legal key');
  assert.equal(pplNormRequest(PP_TAYLOR, { name: '   ', at: 1 }), null);
  assert.equal(pplNormRequest(PP_TAYLOR, 'x'), null);
  assert.equal(pplNormRequest(PP_TAYLOR, null), null);
  assert.deepEqual(pplNormRequest('+15551234567', { name: 'Phone Pal', at: 3 }), { key: '+15551234567', name: 'Phone Pal', at: 3 });
});

// ── teams named by a word ──

test('a team is named by a word case-blind: its name, its short name, the last word of its name, singular or plural; two answers is none', () => {
  state.teams = PP_TEAMS.map((t) => Object.assign({}, t));
  assert.equal(peopleTeamByWord('foxes', state.teams), 't0');
  assert.equal(peopleTeamByWord('Fox', state.teams), 't0');
  assert.equal(peopleTeamByWord('ferocious foxes', state.teams), 't0');
  assert.equal(peopleTeamByWord('TROTTERS', state.teams), 't1');
  assert.equal(peopleTeamByWord('hawks', state.teams), '');
  assert.equal(peopleTeamByWord('', state.teams), '');
  const two = [{ id: 't0', name: 'Red Foxes' }, { id: 't1', name: 'Blue Foxes' }];
  assert.equal(peopleTeamByWord('foxes', two), '', 'two teams answer to it: never a guess');
  assert.equal(peopleTeamByWord('red foxes', two), 't0');
});

test('the team a note names: a whole word of it; none, or two, is none', () => {
  assert.equal(peopleTeamInText('I\'m with the Foxes', PP_TEAMS), 't0');
  assert.equal(peopleTeamInText('turkey trotters counselor', PP_TEAMS), 't1');
  assert.equal(peopleTeamInText('Foxes or Trotters, not sure', PP_TEAMS), '');
  assert.equal(peopleTeamInText('new this year', PP_TEAMS), '');
  assert.equal(peopleTeamInText('', PP_TEAMS), '');
});

// ── is this someone already on the list ──

test('candidates: the same first name first (one spelling per counselor), then the team the note names; each carries its team and role; at most eight', () => {
  const rows = peopleRows(PP_DIR(), PP_JENN_KEY);
  const c = peopleCandidates({ name: 'Taylor Reed', note: 'I\'m with the Trotters' }, rows, PP_TEAMS);
  assert.deepEqual(c.map((x) => [x.key, x.why, x.teamId, x.role]), [
    ['pending-taylor-ab12c', 'name', 't0', 'viewer'],
    ['pending-boss-qq1w2', 'name', 't1', 'editor'],
    ['pending-tay-zz9y8', 'team', 't1', 'viewer'],
  ], 'first-name rows (Taylor, Taylor Boss), then the rest of the named team\'s rows');
  const cam = peopleCandidates({ name: 'Cam Smith' }, peopleRows({ 'pending-cam-1': { role: 'viewer', name: 'Cam' }, 'pending-lilly-1': { role: 'viewer', name: 'Lilly' } }), PP_TEAMS);
  assert.deepEqual(cam.map((x) => x.name), ['Cam'], 'the first name of the request meets the typed first name');
  const lily = peopleCandidates({ name: 'Lily Gray' }, peopleRows({ 'pending-lilly-1': { role: 'viewer', name: 'Lilly' } }), PP_TEAMS);
  assert.deepEqual(lily.map((x) => x.name), ['Lilly'], 'Lilly and Lily are one person here');
  assert.deepEqual(peopleCandidates({ name: 'Zed' }, peopleRows(PP_DIR()), PP_TEAMS), [], 'no one: an empty list, not a guess');
  const many = {};
  for (let i = 0; i < 12; i++) many['pending-sam-' + i] = { role: 'viewer', name: 'Sam ' + i };
  assert.equal(peopleCandidates({ name: 'Sam Q' }, peopleRows(many), PP_TEAMS).length, 8);
});

test('a directory name that clashes with a member is said before it is written: the same whole name, or a lone first name another member has', () => {
  const rows = peopleRows(PP_DIR(), PP_JENN_KEY);
  assert.equal(peopleNameClash('sam lee', rows).key, 'sam@example,com');
  assert.equal(peopleNameClash('Patrick', rows).key, OWNER_MEMBER_KEY, 'a first name alone meets Patrick Simpson');
  assert.equal(peopleNameClash('Patrick Jones', rows), null, 'a different last name is a different person');
  assert.equal(peopleNameClash('Sam Lee', rows, 'sam@example,com'), null, 'a row never clashes with itself');
  assert.equal(peopleNameClash('', rows), null);
});

// ── pasted lines ──

test('"Cam, Foxes": a new person is added, an existing one is updated or already there, a repeat is skipped, an unknown team says so', () => {
  const rows = peopleRows(PP_DIR(), PP_JENN_KEY);
  const p = peopleParseLines('Cam, Foxes\nSam Lee, Trotters\nSam Lee, Foxes\nQuinn, hawks\n\n, Foxes\nCam\nsam lee', rows, PP_TEAMS);
  assert.deepEqual(p.rows.map((r) => [r.name, r.status, r.teamId, r.note]), [
    ['Cam', 'new', 't0', ''],
    ['Sam Lee', 'update', 't1', ''],
    ['Sam Lee', 'repeat', 't0', ''],
    ['Quinn', 'new', '', 'No team matched'],
    ['', 'empty', '', ''],
    ['Cam', 'repeat', '', ''],
    ['sam lee', 'repeat', '', ''],
  ]);
  assert.equal(p.add.length, 2);
  assert.equal(p.update.length, 1);
  assert.equal(p.update[0].key, 'sam@example,com');
  const same = peopleParseLines('Sam Lee, Foxes\nSam Lee', rows, PP_TEAMS);
  assert.deepEqual(same.rows.map((r) => r.status), ['same', 'repeat'], 'already on that team: nothing to change');
  assert.equal(peopleParseLines('Patrick Simpson, Foxes', rows, PP_TEAMS).rows[0].status, 'new', 'the owner row is never updated by a pasted line');
});

test('Put people on teams: only the rows whose chosen team differs, off every team as \'\', the owner never', () => {
  const rows = peopleRows(PP_DIR(), PP_JENN_KEY);
  const ch = peopleTeamChanges(rows, { 'sam@example,com': 't1', [PP_JENN_KEY]: 't0', 'pending-tay-zz9y8': 't1', 'pending-taylor-ab12c': '', [OWNER_MEMBER_KEY]: 't0', 'ghost@x,com': 't0' });
  assert.deepEqual(ch.map((c) => [c.key, c.teamId]).sort(), [[PP_JENN_KEY, 't0'], ['pending-taylor-ab12c', ''], ['sam@example,com', 't1']]);
});

test('the list by team: this camp\'s own order, directors first then by name, people on no (or an unknown) team at the end', () => {
  const dir = Object.assign(PP_DIR(), { 'ann@x,com': { role: 'viewer', name: 'Ann', teamId: 't9' }, 'bo@x,com': { role: 'editor', name: 'Bo', teamId: 't0' } });
  const g = peopleGroups(peopleRows(dir, PP_JENN_KEY), PP_TEAMS);
  assert.deepEqual(g.groups.map((x) => x.team.id), ['t0', 't1']);
  assert.deepEqual(g.groups[0].rows.map((r) => r.name), ['Bo', 'Sam Lee', 'Taylor']);
  assert.deepEqual(g.none.map((r) => r.name), ['Patrick Simpson', 'Jenn Reed', 'Ann'], 'owner first, then directors, then the rest; an id the camp lacks counts as no team');
  const rows = peopleRows(PP_DIR(), PP_JENN_KEY);
  assert.equal(rows.find((r) => r.key === PP_JENN_KEY).self, true);
  assert.equal(rows.find((r) => r.key === OWNER_MEMBER_KEY).owner, true);
  assert.equal(rows.find((r) => r.key === 'pending-tay-zz9y8').pending, true);
});

// ── the requests listener ──

test('the listener is a director\'s alone: a counselor, a hinted (unconfirmed) editor and a device with no sync attach nothing', () => {
  for (const role of ['viewer']) {
    const { db } = ppSetup({ role });
    try { peopleRequestsAttach(); assert.equal(pplReq.ref, null, role + ' attaches nothing'); assert.equal(db.listenerCount(), 0); } finally { ppTeardown(); }
  }
  const { db } = ppSetup();
  try {
    setMemberRole('editor', { provisional: true });
    peopleRequestsAttach();
    assert.equal(pplReq.ref, null, 'a hinted role is a guess: nothing attaches');
    setMemberRole('editor');
    syncStarted = false;
    peopleRequestsAttach();
    assert.equal(pplReq.ref, null, 'before sync has started (membership not yet confirmed here)');
    syncStarted = true;
    delete window.FIREBASE_CONFIG;
    peopleRequestsAttach();
    assert.equal(pplReq.ref, null, 'no database configured');
    window.FIREBASE_CONFIG = { apiKey: 'test' };
    peopleRequestsAttach();
    assert.ok(pplReq.ref, 'a confirmed director with sync attaches');
    assert.equal(db.listenerCount(PP_ROOT + '/accessRequests'), 1);
    peopleRequestsAttach();
    assert.equal(db.listenerCount(PP_ROOT + '/accessRequests'), 1, 'attaching twice leaves one listener');
  } finally { ppTeardown(); }
});

test('the first snapshot lists what is waiting WITHOUT announcing it; a new request after that is announced once, with its name', async () => {
  const { db } = ppSetup();
  const arrived = [];
  const was = window.onAccessRequestsArrived;
  try {
    ppAsk(db, 'old@x,com', { name: 'Old Request', at: Date.now() - 600000 });
    onAccessRequestsArrived = (fresh) => arrived.push(fresh.map((r) => r.name));
    ppListen();
    await waitQuiet();
    assert.deepEqual(peopleRequests().map((r) => r.name), ['Old Request']);
    assert.deepEqual(arrived, [], 'what was already waiting is not "just arrived"');
    ppAsk(db, PP_TAYLOR, { name: 'Taylor Reed' });
    await waitQuiet();
    assert.deepEqual(arrived, [['Taylor Reed']]);
    assert.deepEqual(peopleRequests().map((r) => r.name), ['Taylor Reed', 'Old Request'], 'newest first');
    await db.ref(PP_ROOT + '/accessRequests/old@x,com').remove();
    await waitQuiet();
    assert.deepEqual(arrived, [['Taylor Reed']], 'a removal is not an arrival');
    assert.equal(peopleRequests().length, 1);
  } finally { onAccessRequestsArrived = was; ppTeardown(); }
});

test('only the 25 newest rows are read; a hostile row is dropped; someone who has since become a member is not listed', async () => {
  const { db } = ppSetup();
  try {
    for (let i = 0; i < 30; i++) ppAsk(db, 'p' + i + '@x,com', { name: 'P ' + i, at: 1000 + i });
    ppAsk(db, 'bad key', { name: 'Bad', at: 5000 });
    ppAsk(db, 'sam@example,com', { name: 'Sam Lee', at: 2000 });
    ppListen();
    await waitQuiet();
    const names = peopleRequests().map((r) => r.name);
    assert.ok(names.length <= 25 && !names.includes('P 0') && !names.includes('Bad'), 'the window: the newest 25 by `at`, no malformed row');
    assert.ok(!names.includes('Sam Lee'), 'Sam is already a member: a leftover request is not a request');
  } finally { ppTeardown(); }
});

test('a refused read is this feature\'s alone: it never touches fbRef or syncDenied, and the list is just empty', async () => {
  const { db } = ppSetup();
  try {
    const before = syncDenied;
    db.revokeRead(PP_ROOT + '/accessRequests');
    ppListen();
    await waitQuiet();
    assert.equal(pplReq.denied, true);
    assert.equal(pplReq.ref, null);
    assert.deepEqual(peopleRequests(), []);
    assert.equal(syncDenied, before, 'the state listener\'s terminal-read invariant is untouched');
  } finally { ppTeardown(); }
});

test('a demotion drops the list and the listener; a promotion starts it (a microtask after the role is set)', async () => {
  const { db } = ppSetup();
  try {
    ppAsk(db, PP_TAYLOR);
    ppListen();
    await waitQuiet();
    assert.equal(peopleRequests().length, 1);
    setMemberRole('viewer');
    assert.equal(pplReq.ref, null);
    assert.deepEqual(peopleRequests(), []);
    assert.equal(db.listenerCount(PP_ROOT + '/accessRequests'), 0);
    setMemberRole('editor');
    await waitQuiet();
    assert.ok(pplReq.ref, 'promoted: attached');
    assert.equal(peopleRequests().length, 1);
  } finally { ppTeardown(); }
});

test('a director of BOTH camps hears once about the other camp\'s waiting requests; one who is not a director there hears nothing', async () => {
  const { db } = ppSetup();
  const heard = [];
  const was = window.onOtherCampRequests;
  const otherRoot = CAMPS[otherCampId()].dbRoot;
  try {
    onOtherCampRequests = (n) => heard.push(n);
    db.serverSet(otherRoot + '/accessRequests/a@x,com', { name: 'A', at: 5 });
    db.serverSet(otherRoot + '/accessRequests/b@x,com', { name: 'B', at: 6 });
    otherCampRole = 'viewer';
    ppListen();
    await waitQuiet();
    assert.deepEqual(heard, [], 'a counselor over there is never asked');
    peopleRequestsDetach();
    otherCampRole = 'editor';
    ppListen();
    await waitQuiet();
    assert.deepEqual(heard, [2]);
    peopleOtherCampProbe();
    await waitQuiet();
    assert.deepEqual(heard, [2], 'once');
  } finally { onOtherCampRequests = was; otherCampRole = null; ppTeardown(); }
});

// ── acting on a request ──

test('Let in: the member record is created where none is (name, role, team), THEN the request is deleted — in that order', async () => {
  const { db } = ppSetup();
  try {
    ppAsk(db, PP_TAYLOR);
    db.log.length = 0;
    const r = await peopleLetIn(ppReq(), { name: 'Taylor R.', role: 'viewer', teamId: 't0' });
    assert.equal(r.ok, true);
    const rec = db.serverGet(PP_ROOT + '/members/' + PP_TAYLOR);
    assert.deepEqual([rec.role, rec.name, rec.teamId], ['viewer', 'Taylor R.', 't0']);
    assert.equal(db.serverGet(PP_ROOT + '/accessRequests/' + PP_TAYLOR), null);
    const order = db.log.map((l) => l.paths[0]);
    assert.ok(order.indexOf(PP_ROOT + '/members/' + PP_TAYLOR) < order.indexOf(PP_ROOT + '/accessRequests/' + PP_TAYLOR), 'create first, delete after');
    assert.ok(/sign in/.test(r.invite), 'and the invite text is handed back');
  } finally { ppTeardown(); }
});

test('Let in: the default is Counselor with no team; an editor is only what the director picked; an unknown team is no team; the name is cut to 60', async () => {
  const { db } = ppSetup();
  try {
    await peopleLetIn(ppReq({ key: 'a@x,com' }), { name: 'A'.repeat(90) });
    let rec = db.serverGet(PP_ROOT + '/members/a@x,com');
    assert.deepEqual([rec.role, rec.teamId, rec.name.length], ['viewer', undefined, 60]);
    await peopleLetIn(ppReq({ key: 'b@x,com' }), { name: 'B', role: 'editor', teamId: 't9' });
    rec = db.serverGet(PP_ROOT + '/members/b@x,com');
    assert.deepEqual([rec.role, rec.teamId], ['editor', undefined], 'a team this camp does not have is dropped');
  } finally { ppTeardown(); }
});

test('Let in never overwrites: someone already on the list keeps their record, and the leftover request is still cleared', async () => {
  const { db } = ppSetup();
  try {
    ppAsk(db, 'sam@example,com', { name: 'Sam' });
    const r = await peopleLetIn(ppReq({ key: 'sam@example,com' }), { name: 'Imposter', role: 'editor' });
    assert.deepEqual([r.ok, r.already], [true, true]);
    const rec = db.serverGet(PP_ROOT + '/members/sam@example,com');
    assert.deepEqual([rec.role, rec.name], ['viewer', 'Sam Lee']);
    assert.equal(db.serverGet(PP_ROOT + '/accessRequests/sam@example,com'), null);
  } finally { ppTeardown(); }
});

test('Link: the pending row\'s record (name, role, team) moves to the requester\'s key, the pending row goes, then the request', async () => {
  const { db } = ppSetup();
  try {
    ppAsk(db, PP_TAYLOR);
    db.log.length = 0;
    const r = await peopleLink(ppReq(), 'pending-taylor-ab12c', {});
    assert.equal(r.ok, true);
    const rec = db.serverGet(PP_ROOT + '/members/' + PP_TAYLOR);
    assert.deepEqual([rec.role, rec.name, rec.teamId], ['viewer', 'Taylor', 't0'], 'the director\'s typed name stays; the requester\'s words are not trusted');
    assert.equal(db.serverGet(PP_ROOT + '/members/pending-taylor-ab12c'), null);
    assert.equal(db.serverGet(PP_ROOT + '/accessRequests/' + PP_TAYLOR), null);
    const order = db.log.map((l) => l.paths[0]);
    assert.ok(order.indexOf(PP_ROOT + '/members/' + PP_TAYLOR) < order.indexOf(PP_ROOT + '/members/pending-taylor-ab12c'), 'create before delete');
  } finally { ppTeardown(); }
});

test('Link to a DIRECTOR row asks for the requester\'s email typed again: a stranger who typed a director\'s first name gets nothing', async () => {
  const { db } = ppSetup();
  try {
    ppAsk(db, PP_TAYLOR);
    db.log.length = 0;
    let r = await peopleLink(ppReq(), 'pending-boss-qq1w2', {});
    assert.deepEqual([r.ok, r.reason], [false, 'confirm']);
    r = await peopleLink(ppReq(), 'pending-boss-qq1w2', { confirm: 'someone.else@gmail.com' });
    assert.deepEqual([r.ok, r.reason], [false, 'confirm']);
    assert.equal(db.log.length, 0, 'nothing was written');
    r = await peopleLink(ppReq(), 'pending-boss-qq1w2', { confirm: 'Taylor.Reed@Gmail.com' });
    assert.equal(r.ok, true, 'the same address in any case and with dots is the same key');
    assert.equal(db.serverGet(PP_ROOT + '/members/' + PP_TAYLOR).role, 'editor');
  } finally { ppTeardown(); }
});

test('Link refuses a row that is not pending, one that is gone, and a key that already has a record (nothing is overwritten)', async () => {
  const { db } = ppSetup();
  try {
    assert.equal((await peopleLink(ppReq(), 'sam@example,com', {})).reason, 'gone', 'a signed-in member is not a candidate');
    assert.equal((await peopleLink(ppReq(), 'pending-nobody-1', {})).reason, 'gone');
    db.serverSet(PP_ROOT + '/members/' + PP_TAYLOR, { role: 'viewer', name: 'Taylor already', addedBy: 'x', addedAt: PP_ISO });
    const r = await peopleLink(ppReq(), 'pending-taylor-ab12c', {});
    assert.deepEqual([r.ok, r.reason], [false, 'exists']);
    assert.ok(db.serverGet(PP_ROOT + '/members/pending-taylor-ab12c'), 'the pending row is still there');
  } finally { ppTeardown(); }
});

test('Not now deletes the request; Block writes accessBlocked FIRST (so a re-ask cannot slip in) then deletes it; Unblock removes the block', async () => {
  const { db } = ppSetup();
  try {
    ppAsk(db, PP_TAYLOR);
    assert.equal((await peopleNotNow(ppReq())).ok, true);
    assert.equal(db.serverGet(PP_ROOT + '/accessRequests/' + PP_TAYLOR), null);
    ppAsk(db, PP_TAYLOR);
    db.log.length = 0;
    assert.equal((await peopleBlock(ppReq())).ok, true);
    const b = db.serverGet(PP_ROOT + '/accessBlocked/' + PP_TAYLOR);
    assert.equal(b.byKey, PP_JENN_KEY, 'byKey is the writer\'s own identity, as the rules require');
    assert.equal(typeof b.at, 'number');
    assert.equal(db.serverGet(PP_ROOT + '/accessRequests/' + PP_TAYLOR), null);
    const order = db.log.map((l) => l.paths[0]);
    assert.ok(order.indexOf(PP_ROOT + '/accessBlocked/' + PP_TAYLOR) < order.indexOf(PP_ROOT + '/accessRequests/' + PP_TAYLOR));
    const list = await peopleLoadBlocked();
    assert.deepEqual([list.status, list.rows.map((x) => x.key)], ['ok', [PP_TAYLOR]]);
    assert.equal((await peopleUnblock(PP_TAYLOR)).ok, true);
    assert.equal(db.serverGet(PP_ROOT + '/accessBlocked/' + PP_TAYLOR), null);
    assert.deepEqual(pplReq.blocked.rows, []);
  } finally { ppTeardown(); }
});

test('the Blocked list is ONE read when asked for, never a listener; a refused read says so', async () => {
  const { db } = ppSetup();
  try {
    db.serverSet(PP_ROOT + '/accessBlocked/z@x,com', { at: 5, byKey: PP_JENN_KEY });
    const before = db.listenerCount();
    const r = await peopleLoadBlocked();
    assert.equal(r.rows.length, 1);
    assert.equal(db.listenerCount(), before, 'no listener was added');
    db.revokeRead(PP_ROOT + '/accessBlocked');
    assert.equal((await peopleLoadBlocked()).status, 'denied');
  } finally { ppTeardown(); }
});

// ── guards: offline, a counselor, the owner, yourself ──

test('a counselor\'s phone and an offline director write nothing, and say why', async () => {
  const { db } = ppSetup({ role: 'viewer' });
  try {
    const log = () => db.log.length;
    assert.equal((await peopleLetIn(ppReq(), {})).reason, 'readonly');
    assert.equal((await peopleBlock(ppReq())).reason, 'readonly');
    assert.equal((await peopleSavePerson('sam@example,com', { teamId: 't1' })).reason, 'readonly');
    assert.equal((await peopleAddLines({ add: [{ name: 'Z' }], update: [] }, 'viewer')).reason, 'readonly');
    assert.equal(peopleSetAsking(true).reason, 'readonly');
    assert.equal(log(), 0);
    setMemberRole('editor');
    fbConnected = false;
    assert.equal((await peopleLetIn(ppReq(), {})).reason, 'offline');
    assert.equal((await peopleSaveTeams([{ key: 'sam@example,com', teamId: 't1' }])).reason, 'offline');
    assert.equal(peopleWhy({ reason: 'offline' }), 'Needs a connection.');
    assert.equal(log(), 0);
  } finally { ppTeardown(); }
});

test('the owner row and your own access are never written from here', async () => {
  const { db } = ppSetup();
  try {
    db.log.length = 0;
    assert.equal((await peopleSavePerson(OWNER_MEMBER_KEY, { teamId: 't0' })).reason, 'owner');
    assert.equal((await peopleRemove(OWNER_MEMBER_KEY)).reason, 'owner');
    assert.equal((await peopleSetCampAccess(OWNER_MEMBER_KEY, CAMP.id, 'none')).reason, 'owner');
    assert.equal((await peopleLetIn(ppReq({ key: OWNER_MEMBER_KEY }), {})).reason, 'owner');
    assert.equal((await peopleBlock(ppReq({ key: OWNER_MEMBER_KEY }))).reason, 'owner');
    assert.equal((await peopleSavePerson(PP_JENN_KEY, { role: 'viewer' })).reason, 'self', 'you cannot demote yourself');
    assert.equal((await peopleRemove(PP_JENN_KEY)).reason, 'self');
    assert.equal(db.log.length, 0);
    assert.equal((await peopleSavePerson(PP_JENN_KEY, { teamId: 't1' })).ok, true, 'your own TEAM is yours to change');
    assert.equal(db.serverGet(PP_ROOT + '/members/' + PP_JENN_KEY).teamId, 't1');
  } finally { ppTeardown(); }
});

// ── editing a person ──

test('a person\'s save writes only the fields that changed, as one update at their row; off the team removes teamId', async () => {
  const { db } = ppSetup();
  try {
    db.log.length = 0;
    assert.equal((await peopleSavePerson('sam@example,com', { name: 'Samuel Lee', teamId: 't1', role: 'editor' })).ok, true);
    assert.equal(db.log.filter((l) => l.kind === 'update').length, 1);
    let rec = db.serverGet(PP_ROOT + '/members/sam@example,com');
    assert.deepEqual([rec.name, rec.teamId, rec.role, rec.addedBy], ['Samuel Lee', 't1', 'editor', 'x']);
    await peopleSavePerson('sam@example,com', { teamId: '' });
    rec = db.serverGet(PP_ROOT + '/members/sam@example,com');
    assert.equal(rec.teamId, undefined, 'RTDB has no present-but-empty string: the field is removed');
    assert.equal((await peopleSavePerson('sam@example,com', {})).nothing, true);
    assert.equal((await peopleSavePerson('sam@example,com', { name: '  ' })).reason, 'name');
    assert.equal((await peopleSavePerson('sam@example,com', { role: 'boss' })).reason, 'invalid');
  } finally { ppTeardown(); }
});

test('Put people on teams: one row at a time, a refused row is listed and the rest are saved', async () => {
  const { db } = ppSetup();
  try {
    db.refuse(PP_ROOT + '/members/pending-tay-zz9y8');
    db.log.length = 0;
    const res = await peopleSaveTeams([
      { key: 'sam@example,com', name: 'Sam Lee', teamId: 't1' },
      { key: 'pending-tay-zz9y8', name: 'Tay', teamId: 't0' },
      { key: 'pending-taylor-ab12c', name: 'Taylor', teamId: '' },
    ]);
    assert.deepEqual([res.ok, res.saved, res.failed.map((f) => f.name)], [false, 2, ['Tay']]);
    assert.equal(db.serverGet(PP_ROOT + '/members/sam@example,com').teamId, 't1');
    assert.equal(db.serverGet(PP_ROOT + '/members/pending-tay-zz9y8').teamId, 't1', 'the refused row is as it was');
    assert.equal(db.serverGet(PP_ROOT + '/members/pending-taylor-ab12c').teamId, undefined);
    assert.equal(db.log.length, 3, 'three separate writes, not one batch a single refusal could poison');
  } finally { ppTeardown(); }
});

test('Add people: new lines become pending rows and named people are put on teams, in ONE multi-path update', async () => {
  const { db } = ppSetup();
  try {
    const parsed = peopleParseLines('Cam, Foxes\nQuinn\nSam Lee, Trotters', peopleRows(PP_DIR()), PP_TEAMS);
    db.log.length = 0;
    const r = await peopleAddLines(parsed, 'viewer');
    assert.deepEqual([r.ok, r.added, r.moved], [true, 2, 1]);
    assert.equal(db.log.filter((l) => l.kind === 'update').length, 1, 'one multi-path update');
    const dir = db.serverGet(PP_ROOT + '/members');
    const cam = Object.keys(dir).find((k) => dir[k].name === 'Cam');
    assert.ok(/^pending-cam-/.test(cam) && dir[cam].teamId === 't0' && dir[cam].role === 'viewer');
    assert.equal(dir['sam@example,com'].teamId, 't1');
    assert.equal(dir['sam@example,com'].name, 'Sam Lee', 'an existing person is updated, never duplicated or renamed');
    assert.equal((await peopleAddLines({ add: [], update: [] }, 'viewer')).added, 0, 'nothing to write is not a write');
  } finally { ppTeardown(); }
});

test('Add one person: only ever CREATES — someone already on the list keeps their role, name and team; an own or owner address is refused in words', async () => {
  const { db } = ppSetup();
  try {
    let r = await peopleAddMember({ id: 'new.person@gmail.com', name: 'New Person', role: 'viewer', teamId: 't1' });
    assert.equal(r.ok, true);
    assert.deepEqual(db.serverGet(PP_ROOT + '/members/new,person@gmail,com'), Object.assign({}, db.serverGet(PP_ROOT + '/members/new,person@gmail,com'), { role: 'viewer', name: 'New Person', teamId: 't1' }));
    assert.ok(/gmail\.com/.test(r.invite) || /Google/.test(r.invite));
    r = await peopleAddMember({ id: 'sam@example.com', name: 'Imposter', role: 'editor' });
    assert.equal(r.ok, false);
    assert.ok(/Already on the list/.test(r.message));
    assert.equal(db.serverGet(PP_ROOT + '/members/sam@example,com').role, 'viewer');
    assert.ok(/own account/.test((await peopleAddMember({ id: 'jenn@example.com' })).message));
    assert.ok(/owner/.test((await peopleAddMember({ id: 'patricksimpson.fx@gmail.com' })).message));
    assert.ok(/email address/.test((await peopleAddMember({ id: 'not an@email' })).message));
    assert.ok(/at least a name/.test((await peopleAddMember({ id: '', name: '' })).message));
    r = await peopleAddMember({ id: '', name: 'No Signin', role: 'viewer', teamId: 't0' });
    assert.deepEqual([r.ok, r.pending, r.invite], [true, true, ''], 'a name with no sign-in is a pending row with nothing to invite them to');
  } finally { ppTeardown(); }
});

test('a pending row gets its sign-in (create then delete, absent-only); the typed text is read as an email or a phone', async () => {
  const { db } = ppSetup();
  try {
    assert.ok(/doesn.t look like/.test((await peopleAddSignIn('pending-tay-zz9y8', 'nope')).message));
    assert.ok(/doesn.t look like a phone/.test((await peopleAddSignIn('pending-tay-zz9y8', '12')).message));
    const r = await peopleAddSignIn('pending-tay-zz9y8', '(555) 123-4567');
    assert.equal(r.ok, true);
    assert.equal(r.key, '+15551234567');
    assert.deepEqual([db.serverGet(PP_ROOT + '/members/+15551234567').name, db.serverGet(PP_ROOT + '/members/pending-tay-zz9y8')], ['Tay', null]);
    const dup = await peopleAddSignIn('pending-taylor-ab12c', 'sam@example.com');
    assert.equal(dup.ok, false);
    assert.ok(/Already on the list/.test(dup.message));
    assert.ok(db.serverGet(PP_ROOT + '/members/pending-taylor-ab12c'), 'the pending row survives a refused convert');
  } finally { ppTeardown(); }
});

test('"This is the same person as…": the pending row folds into the member; its team is carried over only if the member has none', async () => {
  const { db } = ppSetup();
  try {
    db.serverSet(PP_ROOT + '/members/noteam@x,com', { role: 'viewer', name: 'No Team', addedBy: 'x', addedAt: PP_ISO });
    memberDirectory['noteam@x,com'] = { role: 'viewer', name: 'No Team' };
    assert.equal((await peopleSameAs('pending-tay-zz9y8', 'noteam@x,com')).ok, true);
    assert.equal(db.serverGet(PP_ROOT + '/members/noteam@x,com').teamId, 't1');
    assert.equal(db.serverGet(PP_ROOT + '/members/pending-tay-zz9y8'), null);
    assert.equal((await peopleSameAs('pending-taylor-ab12c', 'sam@example,com')).ok, true);
    assert.equal(db.serverGet(PP_ROOT + '/members/sam@example,com').teamId, 't0', 'Sam keeps their own team');
    assert.equal((await peopleSameAs('pending-boss-qq1w2', 'pending-tay-zz9y8')).reason, 'gone', 'only a signed-in member can be the other half');
  } finally { ppTeardown(); }
});

test('the per-camp access of a director of both camps: None removes, a role sets, a role where there is no record creates (name carried, team not); only where you are a director', async () => {
  const { db } = ppSetup();
  const other = otherCampId();
  const otherRoot = CAMPS[other].dbRoot;
  try {
    otherCampRole = 'editor';
    db.serverSet(otherRoot + '/members/sam@example,com', { role: 'viewer', name: 'Sam', addedBy: 'x', addedAt: PP_ISO });
    assert.equal((await peopleSetCampAccess('sam@example,com', other, 'editor')).ok, true);
    assert.equal(db.serverGet(otherRoot + '/members/sam@example,com').role, 'editor');
    assert.equal((await peopleSetCampAccess('sam@example,com', other, 'none')).ok, true);
    assert.equal(db.serverGet(otherRoot + '/members/sam@example,com'), null);
    assert.equal((await peopleSetCampAccess('sam@example,com', other, 'viewer')).ok, true);
    const rec = db.serverGet(otherRoot + '/members/sam@example,com');
    assert.deepEqual([rec.role, rec.name, rec.teamId], ['viewer', 'Sam Lee', undefined]);
    otherCampRole = 'viewer';
    assert.equal((await peopleSetCampAccess('sam@example,com', other, 'none')).reason, 'readonly');
  } finally { otherCampRole = null; ppTeardown(); }
});

// ── the switch ──

test('the asking switch is the week\'s own meta/joinOpen: an ordinary setup commit, no undo entry; asking on is what pplAskingOn reads', () => {
  const { db } = ppSetup();
  try {
    undoClear();
    const before = undoRecent().length;
    setupReady = true;
    const r = peopleSetAsking(true);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(pplAskingOn(), true);
    assert.equal(setupTree.meta.joinOpen, true);
    assert.equal(undoRecent().length, before, 'a setting, not an access change: no Undo entry');
    assert.equal(peopleSetAsking(false).ok, true);
    assert.equal(pplAskingOn(), false);
    assert.equal(setupTree.meta.joinOpen, false, 'off is written as false, so the rules read it closed');
  } finally { clearTimeout(setupPushTimer); setupPushTimer = null; ppTeardown(); }
});

test('asking on for more than a week: the week\'s own stamp is a lower bound on how long (nothing newer has touched it)', () => {
  ppSetup();
  try {
    setupTree.meta = Object.assign({}, setupTree.meta, { joinOpen: true });
    setupEdited.week = { at: Date.now() - 8 * 86400000, byKey: PP_JENN_KEY };
    assert.equal(pplAskingLongOn(Date.now()), true);
    setupEdited.week = { at: Date.now() - 2 * 86400000, byKey: PP_JENN_KEY };
    assert.equal(pplAskingLongOn(Date.now()), false);
    setupTree.meta.joinOpen = false;
    setupEdited.week = { at: Date.now() - 20 * 86400000, byKey: PP_JENN_KEY };
    assert.equal(pplAskingLongOn(Date.now()), false, 'off is never nagged');
  } finally { delete setupEdited.week; ppTeardown(); }
});

test('the engine imports nothing it must not: no camper, no localStorage, no listener for a non-member (source pin)', () => {
  const src = readFixture('../setup-sync.js');
  const part = src.slice(src.indexOf('// PEOPLE: who is on the list')).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(part), 'requests and names are held in memory only');
  assert.ok(!/campers/.test(part.replace(/camper names|Campers/g, '')), 'campers are session 3\'s and never here');
  assert.equal((part.match(/\.on\('value'/g) || []).length, 1, 'ONE listener: the editor-only requests query');
});
