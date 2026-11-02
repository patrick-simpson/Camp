// The published schedule (setup-rebuild-spec §12.1, build step 15 / "S5a"): the week as data the sender can read, written
// by an editor's device as ONE transaction with a monotonic `rev` and a `src` hash of its content, so racing editors
// who build the same week write it once. Driven against the in-memory database. The whole push layer is dormant while
// PUSH_SERVICE_URL is blank; these tests turn it "on" the way push.test.js does. Runs under the senior profile too
// (push-publisher.senior.test.js evals this file).

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const PP_PATH = dbPath('pushSchedule');
const PP_WEEK = '2027-07-18';
const ppWait = (ms) => new Promise((r) => setTimeout(r, ms || 5));

function ppSeededTree() {
  return normalizeSetup(syncCanon(buildSeed(CAMP)));
}

function ppOn() {
  setupTree = ppSeededTree();
  setupRev++;
}

function ppOff() {
  setupTree = normalizeSetup({});
  setupRev++;
}

async function ppSetup(opts) {
  const o = opts || {};
  freshState();
  ppOff();
  authUser = { email: 'jenn@example.com', emailVerified: true };
  setMemberRole(o.role || 'editor');
  const db = makeFakeRtdb(); // (no FIREBASE_CONFIG: the setup engine is local-only here, so commitSetup is not held for a first snapshot)
  window.firebase = makeFakeFirebase(db);
  const real = { cfg: pushConfigured, ready: pushSyncReady };
  pushConfigured = () => true;
  pushSyncReady = true;
  pushPublishedSrc = null; pushWeekStart = undefined; pushWeekMigrated = false;
  clearTimeout(pushRepublishTimer); pushRepublishTimer = null;
  return { db, real };
}

function ppTeardown(ctx) {
  pushConfigured = ctx.real.cfg;
  pushSyncReady = ctx.real.ready;
  clearTimeout(pushRepublishTimer); pushRepublishTimer = null;
  pushPublishedSrc = null; pushWeekStart = undefined; pushWeekMigrated = false;
  delete window.firebase;
  setMemberRole(null);
  authUser = null;
  ppOff();
}

// ── src: a hash of exactly what the sender reads ─────────────────────

test('pushScheduleSrc is 8 hex of the canonical content: stable under key order, sensitive to anything the sender reads', () => {
  const blocks = pushScheduleBlocks(scheduleWeek());
  const a = pushScheduleSrc(PP_WEEK, blocks);
  assert.ok(/^[0-9a-f]{8}$/.test(a), 'the rules\' shape');
  assert.equal(pushScheduleSrc(PP_WEEK, JSON.parse(JSON.stringify(blocks))), a, 'a copy hashes the same');
  const reordered = {};
  Object.keys(blocks).reverse().forEach((k) => { reordered[k] = blocks[k]; });
  assert.equal(pushScheduleSrc(PP_WEEK, reordered), a, 'object key order is not content');
  assert.ok(pushScheduleSrc('2027-07-25', blocks) !== a, 'the week');
  const id = Object.keys(blocks)[3];
  const moved = JSON.parse(JSON.stringify(blocks)); moved[id].start += 5;
  assert.ok(pushScheduleSrc(PP_WEEK, moved) !== a, 'a start time');
  const renamed = JSON.parse(JSON.stringify(blocks)); renamed[id].label += '!';
  assert.ok(pushScheduleSrc(PP_WEEK, renamed) !== a, 'a label');
});

// ── the transaction ──────────────────────────────────────────────────

test('publishing: rev 1 with the content\'s src, identical content writes nothing, a real change is rev 2', async () => {
  const ctx = await ppSetup();
  try {
    const first = await pushPublishSchedule(PP_WEEK);
    assert.equal(first.published, true);
    assert.equal(first.rev, 1);
    let rec = ctx.db.serverGet(PP_PATH);
    assert.equal(rec.weekStart, PP_WEEK);
    assert.equal(rec.rev, 1);
    assert.equal(rec.src, pushScheduleSrc(PP_WEEK, pushScheduleBlocks(scheduleWeek())));
    assert.equal(rec.by, identityKey(authUser));
    assert.equal(typeof rec.at, 'number', 'the server\'s clock');
    assert.equal(Object.keys(rec.blocks).length, Object.keys(pushScheduleBlocks(scheduleWeek())).length);
    const at = rec.at;
    await ppWait(15);
    const again = await pushPublishSchedule(PP_WEEK);
    assert.equal(again.published, false, 'identical content is already published');
    assert.equal(again.rev, 1);
    assert.equal(ctx.db.serverGet(PP_PATH).at, at, 'not a byte rewritten');
    // The schedule changes (a camp whose schedule is edited here, a block moved): rev 2, a new src.
    ppOn();
    const lunch = planForDow(2).find((b) => b.label === 'Lunch');
    setupTree.typical[lunch.id].start = 725; setupTree.typical[lunch.id].end = 755; setupRev++;
    const second = await pushPublishSchedule(PP_WEEK);
    assert.equal(second.published, true);
    assert.equal(second.rev, 2, 'monotonic');
    rec = ctx.db.serverGet(PP_PATH);
    assert.equal(rec.rev, 2);
    assert.ok(rec.src !== first.src);
    assert.equal(rec.blocks['tue-' + lunch.id].start, 725, 'published under the block\'s own id');
    // The week moves: a new src too.
    const third = await pushPublishSchedule('2027-07-25');
    assert.equal(third.rev, 3);
    assert.equal(ctx.db.serverGet(PP_PATH).weekStart, '2027-07-25');
  } finally { ppTeardown(ctx); }
});

test('two editors publishing the same week at once write it once (the loser re-runs on the winner\'s value and aborts)', async () => {
  const ctx = await ppSetup();
  try {
    ctx.db.contend(PP_PATH, (db) => {
      const blocks = pushScheduleBlocks(scheduleWeek());
      db.serverSet(PP_PATH, { weekStart: PP_WEEK, at: Date.now(), by: 'pat@example,com', blocks, rev: 7, src: pushScheduleSrc(PP_WEEK, blocks) });
    });
    const r = await pushPublishSchedule(PP_WEEK);
    assert.equal(r.published, false, 'the other editor already wrote exactly this');
    assert.equal(r.rev, 7);
    assert.equal(ctx.db.serverGet(PP_PATH).rev, 7, 'rev is theirs, untouched');
    assert.equal(ctx.db.serverGet(PP_PATH).by, 'pat@example,com');
  } finally { ppTeardown(ctx); }
});

test('the record is what the rules accept: only the pinned fields, ids and keys of the published shape', async () => {
  const ctx = await ppSetup();
  try {
    ppOn();
    await pushPublishSchedule(PP_WEEK);
    const rec = ctx.db.serverGet(PP_PATH);
    assert.deepEqual(Object.keys(rec).sort(), ['at', 'blocks', 'by', 'rev', 'src', 'weekStart']);
    Object.keys(rec.blocks).forEach((id) => {
      assert.ok(/^[a-z0-9-]{1,40}$/.test(id), id);
      assert.deepEqual(Object.keys(rec.blocks[id]).sort(), ['dow', 'emoji', 'key', 'label', 'start']);
      assert.ok(/^[a-z0-9-]{1,48}$/.test(rec.blocks[id].key));
    });
    assert.ok(/^[0-9a-f]{8}$/.test(rec.src));
  } finally { ppTeardown(ctx); }
});

// ── who publishes, and when ──────────────────────────────────────────

test('catch-up: an editor on load republishes when the published src is not its own, and never when it is', async () => {
  const ctx = await ppSetup();
  try {
    // An older build wrote the built-in schedule with no src: put right, once.
    ctx.db.serverSet(PP_PATH, { weekStart: PP_WEEK, at: Date.now(), by: 'x@y,z', blocks: pushScheduleBlocks(scheduleWeek()) });
    await pushMaybeRepublishSchedule();
    let rec = ctx.db.serverGet(PP_PATH);
    assert.equal(rec.rev, 1, 'no rev before: this is the first');
    assert.ok(rec.src);
    assert.equal(pushWeekStart, PP_WEEK, 'the week the director already set is kept');
    const at = rec.at;
    await ppWait(15);
    await pushMaybeRepublishSchedule();
    assert.equal(ctx.db.serverGet(PP_PATH).at, at, 'up to date: nothing written');
    // Edit the week here is pressed (ids change format): the next editor to load puts it right.
    ppOn();
    await pushMaybeRepublishSchedule();
    rec = ctx.db.serverGet(PP_PATH);
    assert.equal(rec.rev, 2);
    assert.ok(Object.keys(rec.blocks).every((id) => /^(sun|mon|tue|wed|thu|fri|sat)-b-/.test(id)), 'now <dk>-<block id>');
  } finally { ppTeardown(ctx); }
});

test('a camp with no week date publishes nothing, a counselor never publishes, and a dormant push layer does nothing', async () => {
  const ctx = await ppSetup();
  try {
    await pushMaybeRepublishSchedule();
    assert.equal(ctx.db.serverGet(PP_PATH), null, 'no week, nobody to remind');
    assert.deepEqual(await pushRepublishSchedule(), { published: false, why: 'no-week' });
    setupTree.meta.weekStart = PP_WEEK; setupRev++;
    setMemberRole('viewer');
    assert.equal((await pushRepublishSchedule()).why, 'readonly');
    setMemberRole('editor');
    pushConfigured = () => false;
    assert.equal((await pushRepublishSchedule()).why, 'off', 'PUSH_SERVICE_URL blank: dormant');
    pushConfigured = () => true;
    const r = await pushRepublishSchedule();
    assert.equal(r.published, true, 'the date in setup is enough');
    assert.equal(ctx.db.serverGet(PP_PATH).weekStart, PP_WEEK);
    assert.equal((await pushRepublishSchedule()).why, 'same', 'and a second look is free');
    assert.equal((await pushRepublishSchedule({ force: true })).published, false, 'Publish now still goes through the transaction, which aborts on identical content');
    assert.equal(ctx.db.serverGet(PP_PATH).rev, 1);
  } finally { ppTeardown(ctx); }
});

test('the author publishes a few seconds after a setup commit; every editor does when the switch moves; a plain tree change does not', async () => {
  const ctx = await ppSetup();
  try {
    assert.equal(pushRepublishTimer, null);
    pushOnSetupEvent('commit');
    assert.ok(pushRepublishTimer !== null, 'a commit arms the publisher');
    clearTimeout(pushRepublishTimer); pushRepublishTimer = null;
    pushLastShared = scheduleIsShared();
    pushOnSetupEvent('tree');
    assert.equal(pushRepublishTimer, null, 'a colleague\'s edit is the author\'s to publish');
    ppOn();
    pushOnSetupEvent('tree');
    assert.ok(pushRepublishTimer !== null, 'the switch moved: ids and blocks changed on every device');
    clearTimeout(pushRepublishTimer); pushRepublishTimer = null;
    ppOff();
    pushOnSetupEvent('tree');
    assert.ok(pushRepublishTimer !== null, 'and back');
    clearTimeout(pushRepublishTimer); pushRepublishTimer = null;
    pushConfigured = () => false;
    pushOnSetupEvent('commit');
    assert.equal(pushRepublishTimer, null, 'dormant: nothing');
  } finally { ppTeardown(ctx); }
});

// ── the week date moves into setup ───────────────────────────────────

test('the week alerts were set up for is copied into setup/meta/weekStart once, and campWeek() reads it', async () => {
  const ctx = await ppSetup();
  try {
    pushWeekStart = PP_WEEK;
    assert.equal(setupWeekStart(), null);
    assert.equal(campWeek().start, PP_WEEK, 'the drawer\'s date is the fallback');
    pushMigrateWeekStart();
    assert.equal(setupWeekStart(), PP_WEEK, 'copied');
    assert.equal(pushWeekMigrated, true);
    setupTree.meta.weekStart = '2027-07-25'; setupRev++;
    pushWeekMigrated = false;
    pushMigrateWeekStart();
    assert.equal(setupWeekStart(), '2027-07-25', 'a date a director already set is never overwritten');
    // A viewer, or a phone whose setup has not loaded, copies nothing.
    delete setupTree.meta.weekStart; pushWeekMigrated = false;
    setMemberRole('viewer');
    pushMigrateWeekStart();
    assert.equal(setupWeekStart(), null);
    setMemberRole('editor');
  } finally { ppTeardown(ctx); }
});

test('the drawer\'s Save sets the date in setup and publishes it', async () => {
  const ctx = await ppSetup();
  try {
    await pushSaveWeekStart(PP_WEEK);
    assert.equal(setupWeekStart(), PP_WEEK);
    const rec = ctx.db.serverGet(PP_PATH);
    assert.equal(rec.weekStart, PP_WEEK);
    assert.equal(rec.rev, 1);
    assert.equal(pushWeekStart, PP_WEEK);
    // A date that is not a Sunday is refused before anything is written.
    await pushSaveWeekStart('2027-07-19');
    assert.equal(setupWeekStart(), PP_WEEK);
    assert.equal(ctx.db.serverGet(PP_PATH).rev, 1);
  } finally { ppTeardown(ctx); }
});

test('the drawer\'s Save publishes nothing when the setup date could not be written, so the two copies never disagree', async () => {
  const ctx = await ppSetup();
  const realEditable = setupEditable;
  const realToast = showToast;
  const said = [];
  showToast = (m) => { said.push(String(m)); };
  try {
    await pushSaveWeekStart(PP_WEEK);
    assert.equal(setupWeekStart(), PP_WEEK);
    assert.equal(ctx.db.serverGet(PP_PATH).weekStart, PP_WEEK);
    // The setup is still loading: commitSetup refuses, and campWeek() would prefer the OLD setup date over a newer
    // published one (the next republish would write it straight back), so nothing is published.
    setupEditable = () => false;
    said.length = 0;
    await pushSaveWeekStart('2027-07-25');
    assert.equal(setupWeekStart(), PP_WEEK, 'the setup date is unchanged');
    assert.equal(ctx.db.serverGet(PP_PATH).weekStart, PP_WEEK, 'and so is the published copy');
    assert.equal(pushWeekStart, PP_WEEK);
    assert.ok(said.some((m) => /still loading/.test(m)) && !said.some((m) => /alerts are set for/.test(m)), 'said, not reported as saved: ' + said.join(' | '));
  } finally { setupEditable = realEditable; showToast = realToast; ppTeardown(ctx); }
});

test('what a director edits on the Schedule screen is what phones are told: a move keeps its id and reminder key, a rename keeps the key until "start fresh", a skipped item is not published', async () => {
  freshState();
  setMemberRole('editor');
  ppOn();
  const dow = 3;
  const pick = planForDow(dow).find((b) => b.origin === 'typical' && b.type === 'activity' && !b.noTime && !b.meal && !b.teams && b.end - b.start >= 30);
  const before = pushScheduleBlocks(scheduleWeek());
  const pid = 'wed-' + pick.id;
  assert.ok(before[pid], 'published as <dk>-<block id>');
  const key = before[pid].key;
  // moved just on Wednesday: same id, same key, new start
  let r = schedCommit({ kind: 'edit', dk: 'wed', bid: pick.id, scope: 'day', item: { label: pick.base, emoji: pick.emoji, start: pick.start + 15, end: pick.end + 15, type: pick.type }, label: 'x' });
  assert.equal(r.ok, true);
  let after = pushScheduleBlocks(scheduleWeek());
  assert.equal(after[pid].start, pick.start + 15);
  assert.equal(after[pid].key, key);
  // renamed everywhere: the key holds
  r = schedCommit({ kind: 'edit', dk: 'wed', bid: pick.id, scope: 'typical', item: { label: 'Totally new name', emoji: pick.emoji, start: pick.start + 15, end: pick.end + 15, type: pick.type }, label: 'x' });
  after = pushScheduleBlocks(scheduleWeek());
  assert.equal(after[pid].label, 'Totally new name');
  assert.equal(after[pid].key, key, 'people who follow it keep following it');
  // ...until the director says start fresh
  r = schedCommit({ kind: 'edit', dk: 'wed', bid: pick.id, scope: 'typical', item: { label: 'Totally new name', emoji: pick.emoji, start: pick.start + 15, end: pick.end + 15, type: pick.type }, alertKey: 'totally-new-name', label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(pushScheduleBlocks(scheduleWeek())[pid].key, 'totally-new-name');
  // skipped on Wednesday only
  schedCommit({ kind: 'remove', dk: 'wed', bid: pick.id, scope: 'day', label: 'x' });
  after = pushScheduleBlocks(scheduleWeek());
  assert.equal(after[pid], undefined, 'a skipped item is not published');
  assert.ok(after['tue-' + pick.id] || after['mon-' + pick.id], 'other days still have it');
  // the content hash moved with every edit (so the author republishes and racing editors agree)
  assert.ok(pushScheduleSrc(PP_WEEK, after) !== pushScheduleSrc(PP_WEEK, before));
});
