// Restore points and Backups v3 (setup-rebuild-spec §7.2–§7.4, build step 14 / "S4"): shared, durable
// copies of the week under <root>/restoreIndex and <root>/restoreBody, written in ONE multi-path
// update, never listened to, put back THROUGH the engines as diffs. Driven against the in-memory
// Realtime Database (tests/fake-rtdb.js). The rules that bound them (undeletable archives, owner-only
// kinds, write-once pins) are database.rules.json's; the client says the same thing first, and
// these tests pin that it does. Run under the senior profile too (restore.senior.test.js evals this file).

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const RS_ROOT = CAMP.dbRoot;
const RS_RULES = JSON.parse(readFixture('../database.rules.json')).rules[RS_ROOT];
// Waits here are for the app, never for the clock (see waitUntil / waitQuiet in tests/harness.js): a fixed sleep is
// a bet that a chain of debounces and acknowledgements fits inside it, and loses when the process stalls.
const rsClone = (v) => JSON.parse(JSON.stringify(v));
const RS_JENN = { email: 'jenn@example.com', emailVerified: true };
const RS_JENN_KEY = 'jenn@example,com';
const RS_OWNER = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };

function rsTree() {
  return {
    meta: { schema: 1, on: { schedule: true, meals: true }, weekStart: '2027-07-18' },
    days: { mon: { typical: true, tag: 'Competition day 1' }, tue: { typical: true } },
    typical: {
      'b-swim-900': { start: 900, end: 960, label: 'Swim', type: 'activity', ord: 10 },
      'b-lunch-720': { start: 720, end: 780, label: 'Lunch', type: 'activity', meal: 'lunch', ord: 20 },
    },
    meals: { mon: { lunch: { dish: 'Pizza', emoji: '🍕' } } },
  };
}

// A director on a fake database with all three engines past their first snapshot.
async function rsSetup(opts) {
  const o = opts || {};
  freshState();
  authUser = o.user || RS_JENN;
  setMemberRole('editor');
  memberName = 'Jenn Reed';
  memberDirectory = { [RS_JENN_KEY]: { role: 'editor', name: 'Jenn Reed' }, [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick' } };
  memberDirectoryLoaded = true;
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  window.firebase = makeFakeFirebase(db);
  fbConnKnown = true; fbConnected = true;
  rpLastAt = 0; rpLastAutoAt = 0; rpWaitMs = 40; setupPushMs = 40;
  localStorage.removeItem(lsKey(RP_OUTBOX_KEY));
  localStorage.removeItem(lsKey(SETUP_KEY));
  // engine state
  setupRef = null; setupReady = false; setupDenied = false; setupWriteRefused = false;
  setupTree = normalizeSetup({}); setupBase = null; setupBaseAt = 0; setupBootBase = null; setupLast = null;
  setupPending = 0; clearTimeout(setupPushTimer); setupPushTimer = null; setupRefetchOwed = false;
  setupQuarantine = {}; setupClashes = []; setupEdited = {};
  undoClear();
  delete state._cfgBase; delete state._cfgNotes;
  configReady = false; cfgFirstPending = null; remoteReady = false; syncDenied = false;
  state.meta = state.meta || {};
  if (o.epoch) state.meta.epoch = o.epoch;
  db.serverSet(dbPath('state'), syncedSnapshot());
  db.serverSet(dbPath('config'), state.config);
  db.serverSet(dbPath('setup'), o.setup === undefined ? rsTree() : o.setup);
  fbRef = db.ref(dbPath('state'));
  fbConfigRef = db.ref(dbPath('config'));
  setupRef = db.ref(dbPath('setup'));
  fbRef.on('value', (snap) => handleRemoteSnapshot(snap.val()));
  attachConfigListener();
  attachSetupListener();
  db.deliverFirstSnapshots();
  flushPendingPush(); // the secrecy seed a confirmed director writes right after the first pull: sent now, not after its 400 ms debounce
  await waitUntil(() => remoteReady && configReady && setupReady, 'all three engines to pass their first pull');
  await waitQuiet(); // ...and acknowledged
  assert.equal(remoteReady && configReady && setupReady, true, 'all three engines are past their first pull');
  assert.equal(hasUnconfirmedLocalWork(), false, 'and nothing of this phone\'s is waiting to be confirmed');
  return db;
}

function rsTeardown() {
  delete window.FIREBASE_CONFIG;
  delete window.firebase;
  fbRef = null; fbConfigRef = null; setupRef = null;
  fbConnKnown = false; fbConnected = false;
  remoteReady = false; configReady = false; setupReady = false;
  rpWaitMs = RP_WAIT_MS; setupPushMs = SETUP_PUSH_MS;
  clearTimeout(setupPushTimer); setupPushTimer = null;
  clearTimeout(pushTimer); pushTimer = null;
  clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false;
  undoClear();
  setMemberRole(null);
  authUser = null; memberDirectory = null; memberDirectoryLoaded = false; memberName = null;
  localStorage.removeItem(lsKey(RP_OUTBOX_KEY));
}

function rsToasts(fn) {
  const real = showToast;
  const toasts = [];
  showToast = (m) => { toasts.push(m); };
  const done = () => { showToast = real; };
  let out;
  try { out = fn(toasts); } catch (e) { done(); throw e; }
  if (out && typeof out.then === 'function') return out.then((v) => { done(); return v; }, (e) => { done(); throw e; });
  done();
  return out;
}

// Wait until everything this phone changed has been acknowledged (no timer, nothing in flight, nothing unconfirmed).
async function rsSettle() {
  await waitQuiet();
  await waitUntil(() => pendingWritesTotal() === 0 && !hasUnconfirmedLocalWork() && !pushTimer && !pushConfigTimer && !setupPushTimer,
    'every write this phone made to be acknowledged');
}

const rsIndex = (db) => db.serverGet(RS_ROOT + '/restoreIndex') || {};
const rsBodies = (db) => db.serverGet(RS_ROOT + '/restoreBody') || {};
const rsWrites = (db, from) => db.log.slice(from || 0).filter((l) => l.kind === 'update' || l.kind === 'set');

// ── fnv1a ────────────────────────────────────────────────────────────

test('fnv1a is the 32-bit FNV-1a of the string, as 8 hex characters', () => {
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
  assert.equal(fnv1a('foobar'), 'bf9cf968');
  assert.ok(/^[0-9a-f]{8}$/.test(fnv1a('🏕️ camp — ünïcode')));
  assert.ok(fnv1a('abc') !== fnv1a('abd'));
});

// ── the body ─────────────────────────────────────────────────────────

test('the body excludes campers, members, chat, presence, photos and every device-local baseline; includes config, setup and state', async () => {
  const db = await rsSetup();
  try {
    state.picSetup = { 'g-pic': { source: 'own', words: ['secret word', 'another'] } };
    state._syncBase = { teams: [] }; state._cfgBase = { games: {} }; state._quarantine = { 'results/x': 1 };
    const body = restoreBodyObject();
    assert.equal(body.app, 'campScoreboardV3');
    assert.equal(body.camp, CAMP.id);
    assert.ok(body.config.games.length > 0);
    assert.equal(body.setup.typical['b-swim-900'].label, 'Swim');
    assert.deepEqual(body.sectionsOn, ['schedule', 'meals']);
    const keys = [].concat(Object.keys(body), Object.keys(body.state), Object.keys(body.setup));
    ['campers', 'members', 'chat', 'chatPhotos', 'presence', 'teamPhotos', 'accessRequests', 'push', '_syncBase', '_cfgBase', '_quarantine'].forEach((w) => {
      assert.notOk(keys.includes(w), 'the body carries ' + w);
    });
    assert.notOk(JSON.stringify(body).includes('secret word'), 'a typed drawing word never travels');
    assert.deepEqual(body.state.picSetup, { 'g-pic': { source: 'own' } }, 'drawing words never travel, only the modes');
    ['on', 'edited', 'wizard', 'seeded', 'epoch', 'epochAt'].forEach((k) => assert.equal(body.setup.meta && body.setup.meta[k], undefined, 'meta.' + k));
    assert.equal(body.setup.meta.weekStart, '2027-07-18');
    assert.ok(Array.isArray(body.state.teams));
    // The hash ignores `at` and `appVersion`: two points of the same data are the same.
    const a = restoreBodyObject();
    const b = Object.assign({}, a, { at: '1999-01-01T00:00:00.000Z', appVersion: 1 });
    assert.equal(restoreHash(a), restoreHash(b));
    b.config = Object.assign({}, b.config, { version: 99999 });
    assert.ok(restoreHash(a) !== restoreHash(b));
  } finally { delete state._syncBase; delete state._cfgBase; delete state._quarantine; rsTeardown(); }
});

// ── writing a point ──────────────────────────────────────────────────

test('a point is index + body in ONE multi-path update at the camp root, with the server\'s time and the writer\'s identity', async () => {
  const db = await rsSetup();
  try {
    const before = db.log.length;
    const r = await restoreSave('manual', 'Before the Friday show', { note: 'Foxes won' });
    assert.equal(r.ok, true);
    assert.ok(RP_ID_RE.test(r.rid), r.rid);
    const writes = rsWrites(db, before);
    assert.equal(writes.length, 1, 'one update');
    assert.deepEqual(writes[0].paths.sort(), [RS_ROOT + '/restoreBody/' + r.rid, RS_ROOT + '/restoreIndex/' + r.rid]);
    const row = rsIndex(db)[r.rid];
    assert.equal(row.kind, 'manual');
    assert.equal(row.label, 'Before the Friday show');
    assert.equal(row.note, 'Foxes won');
    assert.equal(row.byKey, RS_JENN_KEY, 'bound to the writer, as the rules require');
    assert.equal(typeof row.at, 'number', 'the server\'s clock');
    const str = rsBodies(db)[r.rid];
    assert.equal(typeof str, 'string', 'ONE string, so RTDB can neither prune nor array-coerce it');
    assert.equal(row.bytes, str.length);
    assert.equal(row.hash, restoreHash(JSON.parse(str)));
    // Everything it wrote satisfies the published rules' shape for a row.
    const rules = RS_RULES.restoreIndex.$rid;
    Object.keys(row).forEach((k) => assert.ok(rules[k] || k === 'pinned', 'the rules know the field ' + k));
    assert.ok(rules['.validate'].includes('hasChildren([\'at\', \'byKey\', \'kind\', \'label\', \'bytes\', \'hash\'])'));
    assert.ok(RS_RULES.restoreIndex.$rid['.validate'].includes('/^rp-[a-z0-9-]{4,48}$/'), 'the client\'s id pattern is the rules\'');
    assert.ok(row.bytes <= 900000 && row.label.length <= 120 && /^[0-9a-f]{8}$/.test(row.hash));
    assert.equal(rpLastAt > 0, true);
  } finally { rsTeardown(); }
});

test('a label is required and cut to 120; a body over the rules\' 900,000 characters is refused, not truncated', async () => {
  const db = await rsSetup();
  try {
    assert.equal((await restoreSave('manual', '   ')).reason, 'label');
    assert.equal((await restoreSave('nonsense', 'x')).reason, 'kind');
    const r = await restoreSave('manual', 'L'.repeat(300));
    assert.equal(rsIndex(db)[r.rid].label.length, 120);
    const big = restoreBodyObject();
    big.state.notice = { status: 'draft', title: 'x'.repeat(RP_BODY_MAX) };
    assert.equal((await restoreSave('manual', 'big', { body: big })).reason, 'too-big');
    assert.equal(Object.keys(rsIndex(db)).length, 1, 'nothing partial was written');
  } finally { rsTeardown(); }
});

test('archive and pre-wizard points are the owner\'s: refused for a director before any write, written for the owner', async () => {
  const db = await rsSetup();
  try {
    const before = db.log.length;
    ['archive', 'pre-wizard'].forEach(() => {});
    const a = await restoreSave('archive', '2026 week (junior)', { id: restoreArchiveId('', '2026-07-19') });
    assert.equal(a.reason, 'owner');
    assert.equal(a.message, 'Only Patrick can do that.');
    assert.equal((await restoreSave('pre-wizard', 'x')).reason, 'owner');
    assert.equal(rsWrites(db, before).length, 0);
    authUser = RS_OWNER;
    const o = await restoreSave('archive', '2026 week (junior)', { id: restoreArchiveId('', '2026-07-19'), pinned: true, note: 'Ferocious Foxes won with 211 points' });
    assert.equal(o.ok, true);
    assert.ok(/^rp-archive-pre-20260719-[a-z0-9]{4}$/.test(o.rid), o.rid);
    assert.equal(rsIndex(db)[o.rid].pinned, true);
    assert.equal(RS_RULES.restoreIndex.$rid.kind['.validate'].includes('patricksimpson,fx@gmail,com'), true, 'the rules say the same');
  } finally { rsTeardown(); }
});

test('the archive id carries the outgoing epoch (or pre-<date> for the first run) and a random tail that is always a legal id', () => {
  const a = restoreArchiveId('w20260719', '');
  assert.ok(/^rp-archive-w20260719-[a-z0-9]{4}$/.test(a), a);
  assert.ok(RP_ID_RE.test(a));
  assert.ok(RP_ID_RE.test(restoreArchiveId('W2026-07-19-2!', '')), 'junk in an epoch is laundered');
  assert.ok(restoreArchiveId('w20260719', '') !== restoreArchiveId('w20260719', ''), 'a re-run never collides with its own earlier write');
  assert.ok(restoreArchiveId('w'.repeat(80), '').length <= 48);
});

test('read-back verification: a point that matches its row passes; a changed body, or a changed length, does not', async () => {
  const db = await rsSetup();
  try {
    const r = await restoreSave('manual', 'Check me');
    assert.equal((await restoreVerify(r.rid)).ok, true);
    const body = JSON.parse(rsBodies(db)[r.rid]);
    body.config.version = 12345;
    db.serverSet(RS_ROOT + '/restoreBody/' + r.rid, JSON.stringify(body));
    assert.equal((await restoreVerify(r.rid)).reason, 'mismatch');
    db.serverSet(RS_ROOT + '/restoreBody/' + r.rid, null);
    assert.equal((await restoreVerify(r.rid)).reason, 'missing');
  } finally { rsTeardown(); }
});

test('an automatic point is taken before the first setup commit after 20 idle minutes, once per 5 minutes, and holds the PRE-edit week', async () => {
  const db = await rsSetup();
  try {
    rsToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'Moved Swim' }));
    await waitQuiet();
    let rows = Object.values(rsIndex(db));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'auto');
    assert.ok(/^Before Jenn’s edits, \d{1,2}:\d\d [AP]M$/.test(rows[0].label), rows[0].label);
    const body = JSON.parse(Object.values(rsBodies(db))[0]);
    assert.equal(body.setup.typical['b-swim-900'].start, 900, 'the week as it was BEFORE the edit');
    // A second commit right after: no second point.
    rsToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 880; }, { label: 'x' }));
    await waitQuiet();
    assert.equal(Object.keys(rsIndex(db)).length, 1, 'throttled');
    // Even after the idle gap, the 5-minute floor holds; past both it makes another.
    rpLastAt = Date.now() - 21 * 60 * 1000;
    rpLastAutoAt = Date.now() - 60 * 1000;
    rsToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 860; }, { label: 'x' }));
    await waitQuiet();
    assert.equal(Object.keys(rsIndex(db)).length, 1, 'one a minute ago: still throttled');
    rpLastAutoAt = Date.now() - 6 * 60 * 1000;
    rsToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 850; }, { label: 'x' }));
    await waitQuiet();
    assert.equal(Object.keys(rsIndex(db)).length, 2);
  } finally { rsTeardown(); }
});

test('a point in flight blocks a second automatic one (an import\'s pre-import point, then the setup commit that follows it), and a refused write gives the slot back', async () => {
  const db = await rsSetup();
  try {
    const p = restoreSave('pre-import', 'Before importing a backup');
    assert.equal(rpLastAt > 0, true, 'claimed at once, before the write is acknowledged');
    rsToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'x', undo: false }));
    await p;
    await waitQuiet();
    assert.deepEqual(Object.values(rsIndex(db)).map((r) => r.kind), ['pre-import'], 'no automatic point on top of it');
    // A refused write (here: the rules say no) hands the slot back.
    rpLastAt = 0;
    db.refuse(RS_ROOT + '/restoreIndex');
    const r = await restoreSave('manual', 'Refused');
    assert.equal(r.reason, 'refused');
    assert.equal(rpLastAt, 0);
  } finally { rsTeardown(); }
});

test('offline: a point that cannot be written in 4 s goes to the outbox (<= 3, newest kept), the action proceeds, and it is sent once on reconnect', async () => {
  const db = await rsSetup();
  try {
    db.goOffline(); fbConnected = false;
    const r = await restoreSave('manual', 'Written offline');
    assert.equal(r.ok, true);
    assert.equal(r.queued, true);
    assert.equal(restoreOutboxCount(), 1);
    assert.equal(Object.keys(rsIndex(db)).length, 0, 'not on the server yet');
    // A point the action REQUIRES first is refused instead: nothing proceeds without it.
    assert.equal((await restoreSave('pre-restore', 'x', { requireOnline: true })).reason, 'offline');
    // The outbox keeps the newest three.
    for (let i = 0; i < 4; i++) await restoreSave('manual', 'Queued ' + i, { skipCap: true });
    assert.equal(restoreOutboxCount(), 3);
    assert.ok(rpOutboxRead().every((e) => /Queued/.test(e.row.label)), 'newest kept');
    db.goOnline(); fbConnected = true;
    await waitQuiet();
    await restoreFlushOutbox();
    await waitQuiet();
    assert.equal(restoreOutboxCount(), 0);
    const labels = Object.values(rsIndex(db)).map((x) => x.label).sort();
    assert.equal(new Set(labels).size, labels.length, 'no duplicates: ' + labels);
    assert.ok(labels.every((l) => /Queued|Written/.test(l)));
  } finally { rsTeardown(); }
});

// ── the list, retention, pin, delete ─────────────────────────────────

function rsSeedRows(db, rows) {
  rows.forEach((r, i) => {
    db.serverSet(RS_ROOT + '/restoreIndex/' + r.rid, Object.assign({ at: 1000 + i, byKey: RS_JENN_KEY, label: r.rid, bytes: 10, hash: '00000000' }, r.row));
    db.serverSet(RS_ROOT + '/restoreBody/' + r.rid, '{}');
  });
}

test('retention keeps the newest 40 unpinned auto / pre-* points; pinned, archive and pre-wizard points are never touched; the oldest go in one update', async () => {
  const db = await rsSetup();
  try {
    const rows = [];
    for (let i = 0; i < 45; i++) rows.push({ rid: 'rp-auto' + String(i).padStart(3, '0'), row: { kind: i % 3 === 0 ? 'pre-delete' : 'auto', at: 2000 + i } });
    rows.push({ rid: 'rp-oldpinned', row: { kind: 'auto', at: 1, pinned: true } });
    rows.push({ rid: 'rp-archive-w2026-ab12', row: { kind: 'archive', at: 2, pinned: true } });
    rows.push({ rid: 'rp-prewizard-x1', row: { kind: 'pre-wizard', at: 3 } });
    rows.push({ rid: 'rp-oldmanual', row: { kind: 'manual', at: 4 } });
    rsSeedRows(db, rows);
    const before = db.log.length;
    const plan = await restoreRetain();
    assert.deepEqual(plan.toDelete.sort(), ['rp-auto000', 'rp-auto001', 'rp-auto002', 'rp-auto003', 'rp-auto004']);
    const after = rsIndex(db);
    ['rp-oldpinned', 'rp-archive-w2026-ab12', 'rp-prewizard-x1', 'rp-oldmanual'].forEach((rid) => assert.ok(after[rid], rid + ' is kept'));
    assert.equal(Object.keys(after).filter((k) => k.indexOf('rp-auto') === 0).length, 40);
    plan.toDelete.forEach((rid) => assert.equal(rsBodies(db)[rid], undefined, 'the body goes with its row'));
    assert.equal(rsWrites(db, before).length, 1, 'body + index of every deleted point in ONE update');
    // Idempotent: nothing more to trim.
    assert.deepEqual((await restoreRetain()).toDelete, []);
  } finally { rsTeardown(); }
});

test('unpinned manual points are capped at 20: the 21st is refused ("manual-full") so the UI can ask to delete one first', async () => {
  const db = await rsSetup();
  try {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push({ rid: 'rp-man' + String(i).padStart(3, '0'), row: { kind: 'manual', at: 3000 + i } });
    rows.push({ rid: 'rp-manpinned', row: { kind: 'manual', at: 5, pinned: true } }); // a kept point is not counted
    rsSeedRows(db, rows);
    const plan = restoreRetentionPlan(await restoreList());
    assert.equal(plan.manualCount, 20);
    assert.equal(plan.manualFull, true);
    assert.deepEqual(plan.toDelete, [], 'manual points are never trimmed by the retention routine');
    const r = await restoreSave('manual', 'The 21st');
    assert.equal(r.reason, 'manual-full');
    assert.equal(Object.keys(rsIndex(db)).length, 21, 'nothing written');
    assert.equal((await restoreDelete('rp-man000')).ok, true);
    assert.equal((await restoreSave('manual', 'Now there is room')).ok, true);
  } finally { rsTeardown(); }
});

test('Delete refuses a kept point, an archive and a pre-wizard point (the rules do too); Pin is write-once and never edits a label', async () => {
  const db = await rsSetup();
  try {
    rsSeedRows(db, [
      { rid: 'rp-plain', row: { kind: 'manual' } },
      { rid: 'rp-kept', row: { kind: 'manual', pinned: true } },
      { rid: 'rp-archive-w2026-zz99', row: { kind: 'archive', pinned: true } },
      { rid: 'rp-prewiz', row: { kind: 'pre-wizard' } },
    ]);
    assert.equal((await restoreDelete('rp-kept')).reason, 'kept');
    assert.equal((await restoreDelete('rp-archive-w2026-zz99')).reason, 'kept');
    assert.equal((await restoreDelete('rp-prewiz')).reason, 'kept');
    assert.equal((await restoreDelete('rp-missing1')).reason, 'missing');
    assert.equal((await restoreDelete('rp-plain')).ok, true);
    assert.equal(rsIndex(db)['rp-plain'], undefined);
    assert.equal(rsBodies(db)['rp-plain'], undefined);
    assert.equal(restoreDeletable({ kind: 'auto', pinned: false }), true);
    // Pin
    rsSeedRows(db, [{ rid: 'rp-topin', row: { kind: 'auto', label: 'Before Jenn’s edits' } }]);
    assert.equal((await restorePin('rp-topin')).ok, true);
    assert.equal(rsIndex(db)['rp-topin'].pinned, true);
    assert.equal(rsIndex(db)['rp-topin'].label, 'Before Jenn’s edits', 'pinning does not rename');
    assert.equal(restoreDeletable((await restoreList()).find((r) => r.rid === 'rp-topin')), false, 'and it is now undeletable');
    assert.equal((await restorePin('not a rid')).reason, 'id');
    // The rules agree: pinned is write-once true.
    assert.ok(RS_RULES.restoreIndex.$rid.pinned['.write'].includes('!data.exists() && newData.val() === true'));
  } finally { rsTeardown(); }
});

test('the list is read with once(), newest first, and whatever an editor\'s device wrote is laundered', async () => {
  const db = await rsSetup();
  try {
    rsSeedRows(db, [
      { rid: 'rp-older', row: { kind: 'auto', at: 10 } },
      { rid: 'rp-newer', row: { kind: 'manual', at: 99, note: 'n'.repeat(500) } },
      { rid: 'rp-bad1', row: { kind: 'bogus', at: 50 } },
    ]);
    db.serverSet(RS_ROOT + '/restoreIndex/NOT-AN-ID', { kind: 'auto', at: 1 });
    const rows = await restoreList();
    assert.deepEqual(rows.map((r) => r.rid), ['rp-newer', 'rp-older'], 'a bad kind and a bad id never render');
    assert.equal(rows[0].note.length, 200);
    assert.equal(db.listenerCount(RS_ROOT + '/restoreIndex'), 0, 'no listener holds the node open');
  } finally { rsTeardown(); }
});

test('reading a point refuses another camp\'s, an unreadable one and a missing one', async () => {
  const db = await rsSetup();
  try {
    const other = CAMP.id === 'junior' ? 'senior' : 'junior';
    const body = restoreBodyObject();
    db.serverSet(RS_ROOT + '/restoreBody/rp-mine', JSON.stringify(body));
    db.serverSet(RS_ROOT + '/restoreBody/rp-theirs', JSON.stringify(Object.assign({}, body, { camp: other })));
    db.serverSet(RS_ROOT + '/restoreBody/rp-junk', 'not json');
    db.serverSet(RS_ROOT + '/restoreBody/rp-wrongapp', JSON.stringify({ app: 'campScoreboardV2', camp: CAMP.id, config: {} }));
    assert.equal((await restoreRead('rp-mine')).ok, true);
    const t = await restoreRead('rp-theirs');
    assert.equal(t.ok, false);
    assert.equal(t.reason, 'other-camp');
    assert.equal(t.camp, other);
    assert.equal((await restoreRead('rp-junk')).reason, 'unreadable');
    assert.equal((await restoreRead('rp-wrongapp')).reason, 'unreadable');
    assert.equal((await restoreRead('rp-gone1')).reason, 'missing');
    assert.equal((await restoreRead('../../x')).reason, 'id');
  } finally { rsTeardown(); }
});

// ── what a restore would change ──────────────────────────────────────

test('the preview names what ticking each box would do, and says why a section is not offered', async () => {
  const db = await rsSetup();
  try {
    const point = restoreBodyObject();
    point.epoch = 'w20260719';
    point.at = '2026-07-19T12:00:00.000Z';
    // Change things since the point.
    rsToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; d.typical['b-lunch-720'].end = 790; d.meals.mon.lunch.dish = 'Tacos'; }, { label: 'x', undo: false }));
    state.config.games.push({ id: 'rain-bowling-k3f9', name: 'Rain bowling', dayId: state.config.days[0].id, format: 'tally', emoji: '🎳', session: 0 });
    state.results['rain-bowling-k3f9'] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'x' };
    const pv = restorePreview(point);
    assert.equal(pv.epochNote, 'This is from the 2026 week, not this one.');
    assert.equal(pv.sections.schedule.offered, true);
    assert.equal(pv.sections.schedule.count, 3);
    assert.ok(/the typical day \(2 items\)/.test(pv.sections.schedule.summary), pv.sections.schedule.summary);
    assert.ok(/menus/.test(pv.sections.schedule.summary));
    assert.equal(pv.sections.games.offered, true);
    assert.deepEqual(pv.kept.map((k) => k.name), ['Rain bowling'], '"Kept because they have scores"');
    assert.ok(/saved result/.test(pv.kept[0].why));
    assert.equal(pv.sections.scores.needsHold, true, 'Scores are the one section behind the hold-to-confirm');
    assert.equal(pv.sections.scores.count, 1, 'a result that isn\'t in the point');
    // A section that wasn't on in the point is not offered, with the owner's-switch sentence.
    point.sectionsOn = ['schedule'];
    const pv2 = restorePreview(point);
    const meals = pv2.notOffered.find((n) => n.section === 'meals');
    assert.equal(meals.reason, 'point-off');
    assert.ok(/owner’s switch/.test(meals.text));
    // Nothing on in the point: no schedule box at all (the week fields apart).
    point.sectionsOn = [];
    point.setup = { meta: {} };
    assert.equal(restorePreview(point).sections.schedule.offered, false);
    // A different roster is not offered.
    point.state.teams = point.state.teams.slice(0, 2);
    const pv3 = restorePreview(point);
    assert.equal(pv3.sections.teams.offered, false);
    assert.equal(pv3.sections.teams.reason, 'differ');
  } finally { rsTeardown(); }
});

// ── putting a point back ─────────────────────────────────────────────

test('preconditions: a restore is refused while anything is in flight, offline, in a view-only tab, and without the confirm for Scores', async () => {
  const db = await rsSetup();
  try {
    const point = restoreBodyObject();
    rsToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'x', undo: false }));
    assert.equal((await restoreApply(point, { schedule: true }, { label: 'x' })).reason, 'busy', 'an edit still going up');
    await waitQuiet();
    fbConnected = false;
    assert.equal((await restoreApply(point, { schedule: true }, { label: 'x' })).reason, 'offline');
    fbConnected = true;
    tabWriter = false;
    assert.equal((await restoreApply(point, { schedule: true }, { label: 'x' })).reason, 'readonly');
    tabWriter = true;
    assert.equal((await restoreApply(point, { scores: true }, { label: 'x' })).reason, 'confirm', 'Scores need the hold-to-confirm');
    assert.equal((await restoreApply(point, {}, { label: 'x' })).reason, 'nothing');
    assert.equal((await restoreApply(Object.assign({}, point, { camp: 'nope' }), { schedule: true }, { label: 'x' })).reason, 'other-camp');
    assert.equal(Object.keys(rsIndex(db)).filter((k) => rsIndex(db)[k].kind === 'pre-restore').length, 0, 'a refused restore writes no point');
  } finally { tabWriter = true; rsTeardown(); }
});

test('the preview and the pre-restore point come from the SERVER, not a stale local copy (the preflight re-reads state, config and setup)', async () => {
  const db = await rsSetup();
  try {
    const point = restoreBodyObject();
    setupRef.off('value'); // this phone stops hearing the server...
    const server = db.serverGet(dbPath('setup'));
    server.typical['b-swim-900'].start = 885; // ...while a colleague moves Swim
    db.serverSet(dbPath('setup'), server);
    assert.equal(setupTree.typical['b-swim-900'].start, 900, 'the local copy is stale');
    const r = await restoreApply(point, { schedule: true }, { label: 'the earlier week' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const pre = Object.values(rsIndex(db)).find((x) => x.kind === 'pre-restore');
    assert.ok(pre, 'a pre-restore point was written FIRST');
    const preBody = JSON.parse(rsBodies(db)[Object.keys(rsIndex(db)).find((k) => rsIndex(db)[k].kind === 'pre-restore')]);
    assert.equal(preBody.setup.typical['b-swim-900'].start, 885, 'it holds what the server had, not the stale copy');
    assert.ok(/^Before putting back “the earlier week”/.test(pre.label));
  } finally { rsTeardown(); }
});

test('a selective restore emits a minimal diff: only the schedule changes, nothing else is written, and the owner-only fields are never touched', async () => {
  const db = await rsSetup({ epoch: 'w20270718', setup: Object.assign(rsTree(), {}) });
  try {
    ssTouchEpoch(db);
    await waitQuiet();
    const point = restoreBodyObject();
    rsToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; d.meals.mon.lunch.dish = 'Tacos'; }, { label: 'x', undo: false }));
    await waitQuiet();
    const sBefore = JSON.stringify(db.serverGet(dbPath('state')));
    const cBefore = JSON.stringify(db.serverGet(dbPath('config')));
    const mark = db.log.length;
    const r = await restoreApply(point, { schedule: true }, { label: 'before the edit' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.applied, ['schedule']);
    await waitQuiet();
    const sv = db.serverGet(dbPath('setup'));
    assert.equal(sv.typical['b-swim-900'].start, 900, 'put back');
    assert.equal(sv.meals.mon.lunch.dish, 'Pizza');
    assert.equal(JSON.stringify(db.serverGet(dbPath('state'))), sBefore, 'scores, teams and notice untouched');
    assert.equal(JSON.stringify(db.serverGet(dbPath('config'))), cBefore, 'games untouched');
    const written = rsWrites(db, mark).flatMap((l) => l.paths).filter((p) => p.indexOf(RS_ROOT + '/setup/') === 0).map((p) => p.slice((RS_ROOT + '/setup/').length));
    assert.ok(written.includes('typical/b-swim-900/start') && written.includes('meals/mon/lunch'), written.join(','));
    assert.ok(written.every((p) => /^(typical|meals|meta\/edited)/.test(p)), 'a minimal diff: ' + written.join(','));
    ['meta/on', 'meta/epoch', 'meta/epochAt', 'meta/wizard', 'meta/seeded'].forEach((w) => assert.ok(!written.some((p) => p.indexOf(w) === 0), 'a restore never writes ' + w));
    assert.equal(sv.meta.epoch, 'w20270718');
    assert.deepEqual(Object.keys(sv.meta.on).sort(), ['meals', 'schedule'], 'the owner\'s switches are exactly as they were');
    assert.ok(sv.meta.on.schedule === true && sv.meta.on.meals === true);
    assert.equal(undoRecent().length, 0, 'a restore is not an Undo entry: the pre-restore point covers it');
  } finally { rsTeardown(); }
});

function ssTouchEpoch(db) {
  const s = db.serverGet(dbPath('setup'));
  s.meta.epoch = 'w20270718';
  db.serverSet(dbPath('setup'), s);
}

test('a Games-only restore keeps every game with a result, bracket, draft, live match or clock, and NEVER prunes', async () => {
  const db = await rsSetup();
  try {
    const point = restoreBodyObject();
    const day = state.config.days[0].id;
    const add = (id, name) => state.config.games.push({ id, name, dayId: day, format: 'tally', emoji: '🎳', session: 0 });
    ['g-res', 'g-brk', 'g-drf', 'g-live', 'g-clk', 'g-idle'].forEach((id) => add(id, id));
    state.results['g-res'] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'x' };
    state.brackets['g-brk'] = { phase: 'round1', pool: ['t0', 't1'] };
    state.drafts['g-drf'] = { scores: { t0: 5 }, medals: {} };
    state.live['g-live'] = { key: 't0|t1' };
    state.clocks['g-clk'] = { endAt: Date.now() + 60000, running: true };
    saveConfig(); touchData({ celebrate: false }); saveState();
    await rsSettle();
    const r = await restoreApply(point, { games: true }, { label: 'the earlier games' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const ids = state.config.games.map((g) => g.id);
    ['g-res', 'g-brk', 'g-drf', 'g-live', 'g-clk'].forEach((id) => assert.ok(ids.includes(id), id + ' survived: it has something recorded under it'));
    assert.equal(ids.includes('g-idle'), false, 'a game with nothing recorded went with the restore');
    assert.deepEqual(r.kept.map((k) => k.id).sort(), ['g-brk', 'g-clk', 'g-drf', 'g-live', 'g-res']);
    assert.ok(state.results['g-res'] && state.brackets['g-brk'] && state.drafts['g-drf'] && state.live['g-live'] && state.clocks['g-clk'], 'and nothing was pruned');
    // Only with Scores ticked (and confirmed) is anything pruned.
    await rsSettle();
    const r2 = await restoreApply(point, { games: true, scores: true }, { label: 'both', confirmed: true });
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(state.results['g-res'], undefined, 'Scores ticked: the point\'s (empty) scores replace them');
  } finally { rsTeardown(); }
});

test('Teams and Notice restore through stateEdit / saveState; a roster that doesn\'t fit is not offered and nothing is written', async () => {
  const db = await rsSetup();
  try {
    const point = restoreBodyObject();
    const oldName = state.teams[0].name;
    state.teams[0].name = 'Renamed Foxes';
    state.notice = Object.assign({}, state.notice, { status: 'posted', title: 'Changed notice' });
    saveState();
    await rsSettle();
    const r = await restoreApply(point, { teams: true, notice: true }, { label: 'earlier' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.applied, ['teams', 'notice']);
    assert.equal(state.teams[0].name, oldName);
    assert.ok(state.notice.title !== 'Changed notice');
    await waitQuiet();
    assert.equal(db.serverGet(dbPath('state')).teams[0].name, oldName, 'and it synced');
    point.state.teams = point.state.teams.slice(0, 2);
    const bad = await restoreApply(point, { teams: true }, { label: 'earlier' });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'not-offered');
    assert.deepEqual(bad.sections, ['teams']);
    assert.equal(state.teams.length, CAMP.teamCount, 'the roster is fixed: a restore can never add or remove a team');
  } finally { rsTeardown(); }
});

test('a section that is off now, or was off in the point, is not written into: nothing but the always-on week fields', async () => {
  const db = await rsSetup({ setup: { meta: { schema: 1, weekStart: '2027-07-18' } } });
  try {
    const point = restoreBodyObject();
    point.sectionsOn = ['schedule'];
    point.setup = { meta: { weekStart: '2027-08-01' }, typical: { 'b-x-1': { start: 1, end: 2, label: 'X', type: 'activity' } } };
    const r = await restoreApply(point, { schedule: true }, { label: 'a point' });
    assert.equal(r.ok, true, JSON.stringify(r));
    await waitQuiet();
    const sv = db.serverGet(dbPath('setup'));
    assert.equal(sv.meta.weekStart, '2027-08-01', 'the week dates came back');
    assert.equal(sv.typical, undefined, 'the schedule is the built-in copy right now: nothing was written into it');
    assert.equal(sv.meta.on, undefined);
  } finally { rsTeardown(); }
});

// ── Backups v3 ───────────────────────────────────────────────────────

test('backupJSON is the restore-point body plus exportedAt: camp, setup, notice, meta, clocks in; campers never', async () => {
  const db = await rsSetup();
  try {
    state.clocks['g-clock'] = { endAt: 1, running: false };
    const b = JSON.parse(backupJSON());
    assert.equal(b.app, 'campScoreboardV3');
    assert.equal(b.camp, CAMP.id);
    assert.ok(b.exportedAt && !Number.isNaN(Date.parse(b.exportedAt)));
    assert.ok(b.setup && b.setup.typical, 'setup');
    assert.ok(b.state.notice && b.state.meta && b.state.clocks, 'notice, meta, clocks');
    assert.ok(b.config.games.length > 0 && Array.isArray(b.state.teams));
    assert.notOk('campers' in b || 'campers' in b.state);
  } finally { rsTeardown(); }
});

test('a v3 backup round-trips the week through the engines, writes a pre-import point first, and restores announcements', async () => {
  const db = await rsSetup();
  try {
    const gid = state.config.games[0].id;
    state.results[gid] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'x' };
    state.announcements = { a1: { id: 'a1', text: 'Hello camp', at: new Date().toISOString(), ttlMs: 36000000 } };
    state.notice = Object.assign({}, state.notice, { title: 'Backed-up notice' });
    const before = medalCounts().t0.points;
    const backup = backupJSON();
    // Change everything, then import.
    state.results = {}; state.announcements = {}; state.notice = Object.assign({}, state.notice, { title: 'x' });
    rsToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'x', undo: false }));
    await waitQuiet();
    const mark = db.log.length;
    tryImport(backup);
    assert.equal(medalCounts().t0.points, before, 'scores restored');
    assert.equal(state.notice.title, 'Backed-up notice');
    assert.ok(state.announcements.a1, 'announcements are no longer dropped');
    assert.equal(setupTree.typical['b-swim-900'].start, 900, 'the schedule section that is on came back through commitSetup');
    await waitQuiet();
    const preRid = Object.keys(rsIndex(db)).find((k) => rsIndex(db)[k].kind === 'pre-import');
    assert.ok(preRid, 'a pre-import point was written');
    const preBody = JSON.parse(rsBodies(db)[preRid]);
    assert.equal(preBody.setup.typical['b-swim-900'].start, 870, 'it holds the week as it was BEFORE the import');
    assert.ok(rsWrites(db, mark).length > 0);
  } finally { rsTeardown(); }
});

test('an import never writes the epoch (state or setup), the switches or the stamps, even if a hand-edited backup carries them', async () => {
  const db = await rsSetup({ epoch: 'w20270718' });
  try {
    ssTouchEpoch(db);
    await waitQuiet();
    const b = JSON.parse(backupJSON());
    b.state.meta = { epoch: 'w20990101', epochAt: 1, hiddenCards: { standings: true } };
    b.setup.meta = Object.assign({}, b.setup.meta, { epoch: 'w20990101', on: { schedule: false }, wizard: { step: 5 }, seeded: { at: 1 } });
    tryImport(JSON.stringify(b));
    await waitQuiet();
    assert.equal(state.meta.epoch, 'w20270718');
    const sv = db.serverGet(dbPath('setup'));
    assert.equal(sv.meta.epoch, 'w20270718');
    assert.ok(sv.meta.on.schedule === true && sv.meta.on.meals === true, 'the switches are the owner\'s: a backup cannot turn one off');
    assert.equal(sv.meta.wizard, undefined);
    assert.equal(sv.meta.seeded, undefined);
  } finally { rsTeardown(); }
});

test('another camp\'s backup is refused with its name; "copy from the other camp" takes only Schedule, Games and Teams (a roster that doesn\'t fit is left out)', async () => {
  const db = await rsSetup();
  try {
    const other = CAMP.id === 'junior' ? 'senior' : 'junior';
    const mine = JSON.parse(backupJSON());
    const foreign = rsClone(mine);
    foreign.camp = other;
    foreign.config.games = foreign.config.games.slice(0, 2);
    foreign.state.results = { 'g-theirs': { medals: { gold: 't0' }, savedAt: 'x' } };
    foreign.state.teams = foreign.state.teams.slice(0, 2); // a different roster size
    foreign.setup.typical['b-swim-900'].start = 800;
    const gamesBefore = state.config.games.length;
    const resultsBefore = JSON.stringify(state.results);
    // Refused
    const errs = [];
    let said = '';
    tryImport(JSON.stringify(foreign), { say: (m) => { said = m; } });
    assert.ok(/not /.test(said) && said.includes(CAMPS[other].label), said);
    assert.equal(state.config.games.length, gamesBefore, 'nothing changed');
    // Copied
    tryImport(JSON.stringify(foreign), { copyFromOtherCamp: true });
    assert.equal(state.config.games.length, 2, 'Games came across');
    assert.equal(setupTree.typical['b-swim-900'].start, 800, 'Schedule came across');
    assert.equal(JSON.stringify(state.results).includes('g-theirs'), false, 'never its scores');
    assert.equal(state.teams.length, CAMP.teamCount, 'a roster that does not fit is left out, quietly');
    assert.equal(errs.length, 0);
    void resultsBefore;
  } finally { rsTeardown(); }
});

test('a hand-edited backup cannot skip the camp check or smuggle a junk catalog: camp missing, app flag edited, games not an array', async () => {
  const db = await rsSetup();
  try {
    const other = CAMP.id === 'junior' ? 'senior' : 'junior';
    const gamesBefore = state.config.games.length;
    const mine = JSON.parse(backupJSON());
    // A v3 file with its camp deleted is unreadable, never "probably mine".
    const noCamp = rsClone(mine); delete noCamp.camp;
    let said = '';
    const say = (m) => { said = m; };
    tryImport(JSON.stringify(noCamp), { say });
    assert.ok(/doesn't say which camp/.test(said), said);
    assert.equal(state.config.games.length, gamesBefore);
    assert.equal(restoreParseBody(JSON.stringify(noCamp)).ok === false, true);
    // The other camp's file with the app flag edited away is still the other camp's.
    const flat = rsClone(mine); flat.camp = other; delete flat.app; Object.assign(flat, flat.state); delete flat.state;
    flat.teams = state.teams; // a roster that fits must not be the only backstop
    flat.config = Object.assign({}, flat.config, { games: flat.config.games.slice(0, 1) });
    tryImport(JSON.stringify(flat), { say });
    assert.ok(said.includes(CAMPS[other].label), said);
    assert.equal(state.config.games.length, gamesBefore, 'nothing changed');
    // A catalog that is not arrays is refused by the restore-point reader.
    const junk = rsClone(mine); junk.config.games = 'x'; junk.config.days = 5;
    const r = restoreParseBody(JSON.stringify(junk));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unreadable');
  } finally { rsTeardown(); }
});

test('a v2 backup (the flat shape of every backup until now) is accepted exactly as before', async () => {
  const db = await rsSetup();
  try {
    const gid = state.config.games[0].id;
    const v2 = JSON.stringify({
      app: 'campScoreboardV2', exportedAt: '2026-07-01T00:00:00Z', config: state.config, teams: state.teams,
      results: { [gid]: { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'x' } },
    });
    tryImport(v2);
    assert.deepEqual(state.results[gid].medals, { gold: 't0', silver: 't1', bronze: 't2' });
    assert.equal(setupTree.typical['b-swim-900'].start, 900, 'a v2 backup knows nothing of setup and leaves it alone');
  } finally { rsTeardown(); }
});

test('a v3 backup\'s drawing setup carries modes only: it never overwrites the words on this device', async () => {
  const db = await rsSetup();
  try {
    const gid = state.config.games[0].id; // (an id that is not a game is an orphan and an import prunes it)
    state.picSetup = { [gid]: { source: 'own', words: ['kept word'] } };
    const b = JSON.parse(backupJSON());
    assert.deepEqual(b.state.picSetup, { [gid]: { source: 'own' } });
    b.state.picSetup[gid].source = 'builtin';
    tryImport(JSON.stringify(b));
    assert.equal(state.picSetup[gid].source, 'builtin');
    assert.deepEqual(state.picSetup[gid].words, ['kept word']);
  } finally { rsTeardown(); }
});
