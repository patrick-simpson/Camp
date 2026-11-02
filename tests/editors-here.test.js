// "Also here" and the Devices list (setup-rebuild-spec §6.7, build step 14 / "S4"): which directors have Set
// up the week open, and where. <root>/editorsHere/<memberKey>/<deviceId> = { at, v, where? } — editor-read,
// key-pinned to the writer, `at === now` on every write and a 1 s floor per row, so viewers never write or
// listen. Presence itself is untouched. Dark by the owner's rule: no row exists unless a director has the
// builder open. Driven against the in-memory Realtime Database (tests/fake-rtdb.js).
// Run under the senior profile too (editors-here.senior.test.js evals this file).

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const EH_ROOT = CAMP.dbRoot;
const EH_RULES = JSON.parse(readFixture('../database.rules.json')).rules[EH_ROOT];
const ehWait = (ms) => new Promise((r) => setTimeout(r, ms || 5));
const EH_JENN = { email: 'jenn@example.com', emailVerified: true };
const EH_JENN_KEY = 'jenn@example,com';
const EH_PAT_KEY = 'pat@example,com';
const EH_SAM_KEY = 'sam@example,com'; // a counselor (viewer)
const EH_MY_PATH = () => EH_ROOT + '/editorsHere/' + EH_JENN_KEY + '/' + presenceId;

function ehSetup(opts) {
  const o = opts || {};
  freshState();
  authUser = EH_JENN;
  setMemberRole(o.role || 'editor');
  memberDirectory = {
    [EH_JENN_KEY]: { role: 'editor', name: 'Jenn Reed' },
    [EH_PAT_KEY]: { role: 'editor', name: 'Pat Moore' },
    [EH_SAM_KEY]: { role: 'viewer', name: 'Sam Lee' },
  };
  memberDirectoryLoaded = true;
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb();
  const disconnects = [];
  const orig = db.ref;
  db.ref = (p) => {
    const r = orig(p);
    r.onDisconnect = () => ({ remove: () => { disconnects.push(String(p)); return Promise.resolve(); } });
    return r;
  };
  window.firebase = makeFakeFirebase(db);
  fbConnKnown = true; fbConnected = true;
  ehMinMs = 30;
  ehActive = false; ehRef = null; ehTree = null; ehWhere = ''; ehRowLive = false; ehLastWriteAt = 0; ehTimer = null; ehRetried = false;
  presenceRows = null;
  return { db, disconnects };
}

function ehTeardown() {
  editorsHereStop();
  delete window.FIREBASE_CONFIG;
  delete window.firebase;
  fbConnKnown = false; fbConnected = false;
  ehMinMs = EDITORS_HERE_MIN_MS;
  clearTimeout(ehTimer); ehTimer = null;
  ehTree = null; ehRef = null; presenceRows = null; ehRowLive = false; ehActive = false;
  setMemberRole(null);
  authUser = null; memberDirectory = null; memberDirectoryLoaded = false;
}

// Another director's row, as the server holds it.
function ehOther(db, key, device, row) {
  db.serverSet(EH_ROOT + '/editorsHere/' + key + '/' + device, Object.assign({ at: Date.now(), v: APP_VERSION }, row));
}

// ── reload with the builder open, a hinted role, a refused write ─────

test('a reload with the builder open: nothing attaches or writes before approval, and the listener AND the row start when it lands', async () => {
  const { db } = ehSetup();
  try {
    // The first render of a restored builder: a hinted (provisional) role, no sign-in yet.
    authUser = null;
    setMemberRole('editor', { provisional: true });
    assert.equal(editorsHereStart('hub'), true);
    assert.equal(ehRef, null, 'no identity: no listener');
    // Signed in, but the member record has not answered: still a guess, so still nothing.
    authUser = EH_JENN;
    editorsHereOnConnect();
    await ehWait(60);
    assert.equal(ehRef, null, 'a provisional role attaches nothing');
    assert.equal(ehRowLive, false);
    assert.equal(db.serverGet(EH_MY_PATH()), null, 'and writes nothing');
    // Approval lands (confirmed role), then the connect handler runs.
    setMemberRole('editor');
    editorsHereOnConnect();
    await ehWait(80);
    assert.ok(ehRef, 'the listener is attached');
    assert.equal(ehRowLive, true);
    assert.equal(db.serverGet(EH_MY_PATH()).where, 'hub');
    ehOther(db, EH_PAT_KEY, 'dev-pat-0001', { where: 'schedule' });
    await ehWait(20);
    assert.equal(editorsHereList().length, 1, 'and another director is seen');
  } finally { ehTeardown(); }
});

test('a refused write (the server stamps landed under a second apart) is retried ONCE with the latest place', async () => {
  const { db } = ehSetup();
  try {
    editorsHereStart('hub');
    await ehWait(80);
    assert.equal(db.serverGet(EH_MY_PATH()).where, 'hub');
    // The next update is refused once, the way the rules' 1 s floor would on uneven latency.
    const orig = db.ref;
    let refusals = 1;
    db.ref = (p) => {
      const r = orig(p);
      if (String(p) === EH_MY_PATH()) {
        const u = r.update;
        r.update = (v) => (refusals-- > 0 ? Promise.reject({ code: 'PERMISSION_DENIED' }) : u.call(r, v));
      }
      return r;
    };
    ehLastWriteAt = 0;
    editorsHereMove('schedule');
    await ehWait(20);
    assert.equal(db.serverGet(EH_MY_PATH()).where, 'hub', 'the refused write did not land');
    editorsHereMove('meals'); // the person moved on while the retry was pending: the retry carries THIS
    await ehWait(ehMinMs + 450);
    assert.equal(db.serverGet(EH_MY_PATH()).where, 'meals');
    assert.equal(ehRetried, false, 'a success re-arms the retry');
  } finally { ehTeardown(); }
});

test('rules that refuse every write: one retry, then silence (no loop)', async () => {
  const { db } = ehSetup();
  try {
    db.refuse(EH_ROOT + '/editorsHere');
    let sets = 0;
    const orig = db.ref;
    db.ref = (p) => { const r = orig(p); if (String(p) === EH_MY_PATH()) { const s0 = r.set; r.set = (v) => { sets++; return s0.call(r, v); }; } return r; };
    editorsHereStart('hub');
    await ehWait(ehMinMs * 2 + 500);
    assert.equal(sets, 2, 'the first write and exactly one retry');
    assert.equal(ehRowLive, false);
  } finally { ehTeardown(); }
});

// ── dark, and the write protocol ─────────────────────────────────────

test('dark: no row, no listener, and no write on connect — until a director opens Set up the week', async () => {
  const { db } = ehSetup();
  try {
    editorsHereOnConnect(); // a (re)connect with the builder closed
    await ehWait(60);
    assert.equal(db.serverGet(EH_ROOT + '/editorsHere'), null);
    assert.equal(db.log.length, 0, JSON.stringify(db.log));
    assert.equal(db.listenerCount(EH_ROOT + '/editorsHere'), 0, 'no listener either');
    assert.equal(EDITORS_HERE_EAGER, false, 'the spec\'s every-connect row is one switch, off while the step is dark');
    assert.equal(editorsHereMove('schedule:tue'), false, 'a screen change with the builder closed is not a write');
    assert.equal(db.log.length, 0);
  } finally { ehTeardown(); }
});

test('opening the builder writes my row once — { at (server), v, where } under my identity and device id — with its removal registered for a dropped socket', async () => {
  const { db, disconnects } = ehSetup();
  try {
    assert.equal(editorsHereStart('hub'), true);
    await ehWait(20);
    const row = db.serverGet(EH_MY_PATH());
    assert.ok(row, 'my row is there');
    assert.deepEqual(Object.keys(row).sort(), ['at', 'v', 'where']);
    assert.equal(row.v, APP_VERSION);
    assert.equal(row.where, 'hub');
    assert.equal(typeof row.at, 'number', 'the server\'s clock');
    assert.deepEqual(disconnects, [dbPath('editorsHere/' + EH_JENN_KEY + '/' + presenceId)], 'onDisconnect().remove() on exactly my row');
    assert.equal(db.listenerCount(EH_ROOT + '/editorsHere'), 1, 'and the editor-only listener is attached');
    // The shape is what the rules take: a legal device id, `v` a number, `where` the short vocabulary, nothing else.
    const rules = EH_RULES.editorsHere.$k.$d;
    assert.ok(rules['.validate'].includes('$d.matches(/^[A-Za-z0-9_-]{8,64}$/)') && /^[A-Za-z0-9_-]{8,64}$/.test(presenceId));
    assert.ok(rules.where['.validate'].includes('/^[a-z0-9:_-]{1,60}$/') && EDITORS_HERE_WHERE_RE.test(row.where));
    assert.ok(rules.v['.validate'].includes('<= 99999') && row.v <= 99999);
    assert.ok(rules['.write'].includes('$k === auth.token.email.toLowerCase().replace'), 'key-pinned to the writer');
    // Presence itself is untouched: nothing was written under presence.
    assert.ok(!db.log.some((l) => l.paths.some((p) => /\/presence\//.test(p))));
  } finally { ehTeardown(); }
});

test('moving between screens updates `where` in place (at refreshed), and leaving REMOVES it rather than blanking it; the 1 s floor coalesces a quick run', async () => {
  const { db } = ehSetup();
  try {
    editorsHereStart('hub');
    await ehWait(10);
    const first = db.serverGet(EH_MY_PATH()).at;
    // A quick run of screen changes: the first goes out when the floor allows, the rest collapse into ONE trailing write of the LAST place.
    const mark = db.log.length;
    editorsHereMove('schedule:typical');
    editorsHereMove('schedule:tue');
    editorsHereMove('item:tue:b-swim-900');
    assert.equal(db.log.slice(mark).filter((l) => l.kind === 'update').length, 0, 'inside the floor: held');
    await ehWait(80);
    const writes = db.log.slice(mark).filter((l) => l.kind === 'update');
    assert.equal(writes.length, 1, 'one trailing write, never a refusal');
    assert.equal(db.serverGet(EH_MY_PATH()).where, 'item:tue:b-swim-900', 'carrying the last place');
    assert.ok(db.serverGet(EH_MY_PATH()).at >= first);
    assert.equal(db.serverGet(EH_MY_PATH()).v, APP_VERSION, 'v is not rewritten');
    // The same place again is not a write.
    const n = db.log.length;
    assert.equal(editorsHereMove('item:tue:b-swim-900'), true);
    await ehWait(60);
    assert.equal(db.log.length, n);
    // Not a place the rules would take: not written.
    ['Has Capitals', 'x'.repeat(61), 'a/b', 'a b'].forEach((bad) => assert.equal(editorsHereMove(bad), false, bad));
    await ehWait(60);
    assert.equal(db.serverGet(EH_MY_PATH()).where, 'item:tue:b-swim-900');
    // Leaving the builder removes the row and the listener (dark mode: nothing lingers).
    editorsHereStop();
    await ehWait(20);
    assert.equal(db.serverGet(EH_MY_PATH()), null);
    assert.equal(db.listenerCount(EH_ROOT + '/editorsHere'), 0);
  } finally { ehTeardown(); }
});

test('a reconnect with the builder open registers the row and its onDisconnect afresh (the handler does not survive a dropped socket)', async () => {
  const { db, disconnects } = ehSetup();
  try {
    editorsHereStart('games');
    await ehWait(40);
    assert.equal(disconnects.length, 1);
    db.serverSet(EH_MY_PATH(), null); // the server noticed the dead socket and dropped it
    editorsHereOnConnect();
    await ehWait(60);
    assert.equal(db.serverGet(EH_MY_PATH()).where, 'games', 'back, in the same place');
    assert.equal(disconnects.length, 2, 'registered again');
  } finally { ehTeardown(); }
});

test('viewers never write or listen: a counselor, a view-only second tab and a demoted director', async () => {
  const { db } = ehSetup({ role: 'viewer' });
  try {
    assert.equal(editorsHereStart('hub'), false);
    assert.equal(editorsHereMove('games'), false);
    await ehWait(60);
    assert.equal(db.log.length, 0);
    assert.equal(db.listenerCount(EH_ROOT + '/editorsHere'), 0);
    assert.deepEqual(editorsHereList(), []);
    setMemberRole('editor');
    tabWriter = false; // a director's second tab is view-only
    assert.equal(editorsHereStart('hub'), false);
    tabWriter = true;
    assert.equal(db.log.length, 0);
    // A director who is demoted mid-session: the row goes and the listener with it.
    assert.equal(editorsHereStart('hub'), true);
    await ehWait(30);
    assert.ok(db.serverGet(EH_MY_PATH()));
    setMemberRole('viewer');
    await ehWait(30);
    assert.equal(db.serverGet(EH_MY_PATH()), null, 'removed');
    assert.equal(db.listenerCount(EH_ROOT + '/editorsHere'), 0, 'and no longer listening');
    assert.deepEqual(editorsHereList(), []);
  } finally { ehTeardown(); }
});

test('a refused write or listener is swallowed (rules that predate it): nothing throws, the feature shows nobody, fbRef/syncDenied untouched', async () => {
  const { db } = ehSetup();
  try {
    db.refuse(EH_ROOT + '/editorsHere');
    db.revokeRead(EH_ROOT + '/editorsHere');
    assert.doesNotThrow(() => editorsHereStart('hub'));
    await ehWait(60);
    assert.deepEqual(editorsHereList(), []);
    assert.equal(syncDenied, false);
    assert.equal(editorsHereHeader().count, 0);
  } finally { ehTeardown(); }
});

// ── reading: names fail closed, only directors, own device skipped ───

test('names come from the member directory and fail CLOSED: "Another director" with no directory or no name, never what a device claimed', async () => {
  const { db } = ehSetup();
  try {
    editorsHereStart('hub');
    ehOther(db, EH_PAT_KEY, 'patdevice01', { where: 'schedule:tue', name: 'IMPERSONATOR' });
    await ehWait(10);
    let rows = editorsHereList();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Pat');
    assert.ok(!JSON.stringify(rows).includes('IMPERSONATOR'), 'a name written into the row is never read');
    memberDirectory[EH_PAT_KEY].name = '  ';
    assert.equal(editorsHereList()[0].name, 'Another director', 'a director with no name on file');
    memberDirectory = null; memberDirectoryLoaded = false;
    assert.equal(editorsHereList()[0].name, 'Another director', 'no directory yet');
    assert.equal(editorsHereList().length, 1, 'the node is editor-read, so its writers were directors: still shown, unnamed');
  } finally { ehTeardown(); }
});

test('only keys whose directory role is editor are shown; this tab\'s own row is skipped; another device of mine is "You (another device)"', async () => {
  const { db } = ehSetup();
  try {
    editorsHereStart('hub');
    await ehWait(10);
    ehOther(db, EH_PAT_KEY, 'patdevice01', { where: 'games' });
    ehOther(db, EH_SAM_KEY, 'samdevice01', { where: 'games' }); // a counselor: not a director
    ehOther(db, EH_JENN_KEY, 'jenndevice2', { where: 'teams' }); // my other phone
    ehOther(db, 'ghost@example,com', 'ghostdevice', { where: 'games' }); // removed from the list since
    await ehWait(10);
    const rows = editorsHereList();
    assert.deepEqual(rows.map((r) => r.name).sort(), ['Pat', 'You (another device)']);
    assert.ok(!rows.some((r) => r.device === presenceId), 'my own row is not listed');
    assert.ok(!rows.some((r) => r.key === EH_SAM_KEY || r.key === 'ghost@example,com'));
    assert.equal(rows.find((r) => r.mine).words, 'the teams');
  } finally { ehTeardown(); }
});

test('the header says it in initials and words, and a matching screen says "also editing — changes merge field by field"', async () => {
  const { db } = ehSetup();
  try {
    editorsHereStart('schedule:tue');
    await ehWait(10);
    assert.deepEqual(editorsHereHeader(), { count: 0, faces: [], text: '', rows: [] });
    ehOther(db, EH_PAT_KEY, 'patdevice01', { where: 'schedule:tue', at: Date.now() - 2 * 60 * 1000 });
    await ehWait(10);
    let h = editorsHereHeader();
    assert.deepEqual(h.faces, ['P']);
    assert.equal(h.text, 'Pat is also here');
    assert.equal(h.rows[0].text, 'Pat · Tuesday’s schedule · 2 min ago');
    assert.equal(editorsHereOn('schedule:tue'), 'Pat is also editing Tuesday’s schedule — changes merge field by field');
    assert.equal(editorsHereOn('schedule:wed'), '', 'nobody else is on Wednesday');
    assert.equal(editorsHereOn('hub'), '');
    ehOther(db, EH_PAT_KEY, 'patdevice01', { where: 'item:tue:b-swim-900' });
    await ehWait(10);
    assert.equal(editorsHereOn('item:tue:b-swim-900'), 'Pat is editing this item too');
    ehOther(db, EH_JENN_KEY, 'jenndevice2', { where: 'hub' });
    memberDirectory['third@example,com'] = { role: 'editor', name: 'Robin' };
    ehOther(db, 'third@example,com', 'robindevice', { where: 'games' });
    await ehWait(10);
    h = editorsHereHeader();
    assert.equal(h.faces.length, 3);
    assert.ok(/ and 2 others are also here$/.test(h.text), h.text);
    assert.equal(h.count, 3);
  } finally { ehTeardown(); }
});

test('every `where` has words (and an unknown or hostile one never reaches them)', () => {
  const t = (w) => editorsHereWhereWords(w);
  assert.equal(t('hub'), 'the checklist');
  assert.equal(t('schedule:typical'), 'the typical day');
  assert.equal(t('schedule:tue'), 'Tuesday’s schedule');
  assert.equal(t('rain:wed'), 'Wednesday’s rain plan');
  assert.equal(t('team:t1'), teamName('t1'));
  assert.equal(t('game:' + state.config.games[0].id), state.config.games[0].name);
  assert.equal(t('game:nonexistent'), 'a game');
  ['week', 'games', 'teams', 'people', 'campers', 'meals', 'verses', 'cleanup', 'electives', 'wizard', 'restore'].forEach((w) => assert.ok(t(w).length > 3, w));
  assert.equal(t('<script>'), 'the setup');
  assert.equal(t(''), 'the setup');
});

// ── the Devices list ─────────────────────────────────────────────────

test('Devices joins presence and editorsHere by device id, keeps the last 10 minutes, shows only directors, and groups by build', async () => {
  const { db } = ehSetup();
  try {
    editorsHereStart('hub');
    await ehWait(10);
    const now = Date.now();
    presenceRows = {
      [EH_JENN_KEY]: { [presenceId]: { at: now }, jenndevice2: { at: now - 60000 } },
      [EH_PAT_KEY]: { patdevice01: { at: now - 30000 }, patdevice02: { at: now - 11 * 60 * 1000 } },
      [EH_SAM_KEY]: { samdevice01: { at: now } },                     // a counselor
      'legacy@example,com': { at: now, role: 'editor' },              // the old flat shape
    };
    ehOther(db, EH_PAT_KEY, 'patdevice01', { v: APP_VERSION - 1, where: 'games' });
    ehOther(db, EH_JENN_KEY, 'jenndevice2', { v: APP_VERSION });
    await ehWait(10);
    const d = devicesList();
    assert.equal(d.total, 3, 'my device, my other one, and Pat\'s fresh one');
    assert.ok(!d.rows.some((r) => r.key === EH_SAM_KEY), 'a counselor\'s phone is not a director device');
    assert.ok(!d.rows.some((r) => r.device === 'patdevice02'), 'older than 10 minutes: not here');
    const pat = d.rows.find((r) => r.device === 'patdevice01');
    assert.equal(pat.v, APP_VERSION - 1, 'matched to its editorsHere row by device id');
    assert.equal(pat.older, true);
    assert.equal(pat.name, 'Pat');
    const mine = d.rows.find((r) => r.mine);
    assert.equal(mine.name, 'You');
    assert.equal(d.older, 1);
    assert.deepEqual(d.byBuild, { [APP_VERSION]: 2, [APP_VERSION - 1]: 1 });
    assert.equal(d.lede, '1 director device is on an older version — it updates when reopened');
  } finally { ehTeardown(); }
});

test('Devices does not call a device OLD for lacking a row while rows are only written with the builder open: its build is unknown (a hint, never a gate)', async () => {
  const { db } = ehSetup();
  try {
    editorsHereStart('hub');
    await ehWait(10);
    presenceRows = { [EH_PAT_KEY]: { patdevice01: { at: Date.now() } } }; // Pat is online but has not opened Set up the week
    const d = devicesList();
    assert.equal(d.total, 1);
    assert.equal(d.rows[0].v, null);
    assert.equal(d.rows[0].older, false, 'no claim without evidence');
    assert.equal(d.rows[0].unknown, true);
    assert.equal(d.unknown, 1);
    assert.equal(d.older, 0);
    assert.ok(/as far as we can tell/.test(d.lede));
    assert.deepEqual(d.byBuild, { unknown: 1 });
    // In the spec's every-connect mode (EDITORS_HERE_EAGER) a missing row WOULD mean "older than the S4 build".
    assert.ok(/EDITORS_HERE_EAGER\s*=\s*false/.test(readFixture('../setup-sync.js')));
  } finally { ehTeardown(); }
});

test('Devices is for directors: a counselor gets nothing, and an empty room says so', async () => {
  const { db } = ehSetup();
  try {
    presenceRows = { [EH_PAT_KEY]: { patdevice01: { at: Date.now() } } };
    setMemberRole('viewer');
    assert.deepEqual(devicesList().rows, []);
    setMemberRole('editor');
    presenceRows = null;
    assert.equal(devicesList().lede, 'No other director devices are here right now');
    presenceRows = {};
    assert.equal(devicesList().total, 0);
  } finally { ehTeardown(); }
});

test('app.js hands the presence tree over and calls the connect hook beside registerPresence', () => {
  const src = readFixture('../app.js');
  assert.ok(/presenceRows = snap\.val\(\);/.test(src), 'the presence listener keeps the tree');
  assert.ok(/if \(fbConnected\) registerPresence\(\);[\s\S]{0,260}editorsHereOnConnect\(\)/.test(src), 'a (re)connect re-registers the builder row');
  assert.ok(/presenceId\b[\s\S]{0,40}= \(typeof crypto/.test(src));
});
