// reveal.js — the standings reveal's engine (redesign §4, BUILD-PLAN Step 23). Runs under both camp
// profiles (reveal.senior.test.js evals this file). reveal-core.js's pure rules are in reveal-core.test.js;
// this file is the PLUMBING: what the phone listens to and when, what it believes, when it lets go (the
// 8 AM rule, on the active tab, an inactive tab and after a wake from sleep), who may delete the expired
// node, what the champion line keeps, and (below, in the commands half) every write a director's phone makes,
// checked against a model of database.rules.json's compare-and-set clauses. The REAL rules are proven in
// tests/emulator/reveal.mjs and reveal-client.mjs (opt-in).

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const T0 = Date.parse('2027-06-23T23:31:00Z'); // a Wednesday, 7:31 PM EDT
const N = CAMP.teamCount;
const REAL = dbPath('revealPublic/real');
const PRACTICE = dbPath('revealPublic/practice');

function ent(id, p, extra) {
  return Object.assign({ nm: 'Team ' + id, p, g: 0, s: 0, b: 0, v: 0, m: 0, c: 0 }, extra || {});
}
function mkCtl(o) {
  return Object.assign({
    v: 1, id: 'r1kz9fxq-4hd2', seq: 3, phase: 'live', cur: 1, shown: 2, teams: N, finale: false,
    at: T0 + 10000, sa: T0 + 10000, ca: T0, startedAt: T0, until: untilFor(T0, false),
  }, o || {});
}
// the first `shown` places, worst first (g0 = last place), one team per group
function mkPub(shown) {
  const pub = {};
  for (let i = 0; i < shown; i++) {
    const tid = 't' + (N - 1 - i);
    pub['g' + i] = { place: N - i, e: { [tid]: ent(tid, 10 * (N - i), { nm: 'Team ' + tid, g: 1 }) } };
  }
  return pub;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 5 : ms));

// A clean engine, a signed-in phone of the given role, and a fake database with the camp's public node on it.
function resetReveal() {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
  if (revealRealRef && revealRealCb) { try { revealRealRef.off('value', revealRealCb); } catch (e) { /* ignore */ } }
  if (revealPracticeRef && revealPracticeCb) { try { revealPracticeRef.off('value', revealPracticeCb); } catch (e) { /* ignore */ } }
  revealStarted = false; revealDenied = false; revealPracticeDenied = false;
  revealRealRef = null; revealRealCb = null; revealPracticeRef = null; revealPracticeCb = null;
  confirmedReveal.real = null; confirmedReveal.practice = null;
  revealLoaded.real = false; revealLoaded.practice = false;
  revealLastSig = ''; revealLastRetireAt = 0; revealRetiring = false; revealExpiredId = null;
  if (typeof revealResetCommands === 'function') revealResetCommands();
  localStorage.removeItem(lsKey(REVEAL_CACHE_KEY));
  localStorage.removeItem(lsKey(REVEAL_CHAMPION_KEY));
  revealPaint = undefined;
}
function bootReveal(role, opts) {
  resetReveal();
  freshState();
  const db = makeFakeRtdb(opts);
  const paths = [];
  const realRef = db.ref;
  db.ref = (p) => { paths.push(String(p)); return realRef(p); };
  firebase = makeFakeFirebase(db);
  db.paths = paths;
  setMemberRole(role);
  serverTimeOffset = 0;
  fbConnected = true; remoteReady = true;
  return db;
}
function teardownReveal() {
  resetReveal();
  Date.now = realDateNow;
  setMemberRole(null);
  firebase = undefined;
  fbConnected = false; remoteReady = false;
}
const realDateNow = Date.now;
function atTime(ms) { Date.now = () => ms; }

// ── what a phone listens to ──────────────────────────────────────────

test('a counselor listens to revealPublic/real and nothing else; a director adds the practice child; a demotion takes it away', async () => {
  const db = bootReveal('viewer');
  initReveal();
  assert.equal(db.listenerCount(REAL), 1, 'the mirror');
  assert.equal(db.listenerCount(PRACTICE), 0, 'a counselor never hears a practice');
  assert.ok(db.paths.every((p) => p === REAL), 'no other path was even asked for: ' + db.paths.join(', '));
  setMemberRole('editor');
  assert.equal(db.listenerCount(PRACTICE), 1, 'a director also listens to the practice child');
  assert.equal(db.listenerCount(REAL), 1, 'and still one listener on the real one');
  db.serverSet(PRACTICE, { ctl: mkCtl({ id: 'r2kz9fxq-4hd3', until: T0 + 7200000 }), pub: mkPub(1) });
  assert.ok(confirmedReveal.practice, 'the practice reached the director');
  setMemberRole('viewer');
  assert.equal(db.listenerCount(PRACTICE), 0, 'a demoted phone stops listening');
  assert.equal(confirmedReveal.practice, null, 'and drops what it held');
  teardownReveal();
});

test('a counselor\'s phone never reads a practice: not by listener, not by the director\'s re-scan', async () => {
  const db = bootReveal('viewer');
  db.serverSet(PRACTICE, { ctl: mkCtl({ id: 'r2kz9fxq-4hd3', until: T0 + 7200000 }), pub: mkPub(2) });
  db.serverSet(REAL, { ctl: mkCtl(), pub: mkPub(2) });
  initReveal();
  await wait();
  assert.ok(confirmedReveal.real, 'the real reveal arrived');
  assert.equal(confirmedReveal.practice, null, 'the practice did not');
  assert.equal(await revealRescan(), false, 'a counselor phone does not even re-scan the whole public node');
  assert.ok(!db.paths.some((p) => /revealPublic$/.test(p)), 'no read of the parent node');
  assert.ok(!JSON.stringify(confirmedReveal).includes('r2kz9fxq-4hd3'), 'no byte of the practice is held');
  teardownReveal();
});

test('initReveal touches the database only from the approved path, and reveal.js names no path but revealPublic / revealFull', () => {
  const app = readFixture('../app.js');
  const sync = app.slice(app.indexOf('function initSync()'), app.indexOf('function schedulePush()'));
  assert.ok(sync.includes("initReveal()"), 'initSync (called only from the approved branch) starts it');
  assert.ok(sync.indexOf('initReveal()') > sync.indexOf('initPush()'), 'beside the other optional layers, after the state listener');
  const src = readFixture('../reveal.js');
  const paths = [...src.matchAll(/dbPath\('([^']*)'/g)].map((m) => m[1]);
  assert.ok(paths.length >= 3, 'the scan finds the listeners');
  paths.forEach((p) => assert.ok(/^reveal(Public|Full)(\/|$)/.test(p), 'a path outside the reveal nodes: ' + p));
  assert.ok(!/ref\(\s*['"`](state|members|config|setup|campers|chat|push)/.test(src), 'no ref to any other node');
  assert.ok(!/fbRef|syncDenied/.test(src.replace(/\/\/[^\n]*/g, '')), 'a refusal here never touches the state listener');
});

// ── confirmed state, the cache, failing closed ──────────────────────

test('the cached reveal paints at once; the first server snapshot replaces it, and a null one removes it', async () => {
  const db = bootReveal('viewer');
  localStorage.setItem(lsKey(REVEAL_CACHE_KEY), JSON.stringify({ ctl: mkCtl({ cur: 0, shown: 1, at: T0, sa: T0 }), pub: mkPub(1) }));
  revealLoadCache();
  atTime(T0 + 20000);
  const before = revealMirrorView();
  assert.ok(before && before.live, 'the cached reveal is live on screen before any listener answers');
  assert.equal(before.rows.length, 1);
  initReveal();
  await wait();
  assert.equal(revealMirrorView(), null, 'the server says there is no reveal: nothing');
  assert.equal(localStorage.getItem(lsKey(REVEAL_CACHE_KEY)), null, 'and the cache goes with it');
  db.serverSet(REAL, { ctl: mkCtl(), pub: mkPub(2) });
  assert.equal(revealMirrorView().rows.length, 2);
  assert.ok(JSON.parse(localStorage.getItem(lsKey(REVEAL_CACHE_KEY))).ctl.id, 'a live reveal is cached for the next open');
  teardownReveal();
});

test('a refused listener fails closed, for the reveal only: the cache is ignored and the state listener is untouched', async () => {
  const db = bootReveal('viewer');
  db.serverSet(REAL, { ctl: mkCtl(), pub: mkPub(2) });
  initReveal();
  await wait();
  atTime(T0 + 20000);
  assert.ok(revealMirrorView(), 'live before the refusal');
  const painted = [];
  revealPaint = (why) => painted.push(why);
  db.revokeRead(REAL);
  await wait();
  assert.equal(revealDenied, true);
  assert.equal(revealMirrorView(), null, 'a cached, even a fresh, reveal is not shown once the read is refused');
  assert.equal(revealLiveView(), null);
  assert.equal(revealGridView(), null);
  assert.ok(painted.includes('denied'), 'the screens are told');
  assert.notOk(syncDenied, 'syncDenied (the state listener\'s terminal flag) is not touched');
  teardownReveal();
});

test('a reveal from another camp year, a newer schema or no clock shows nothing (the epoch comes from this week\'s state)', async () => {
  const db = bootReveal('viewer');
  initReveal();
  atTime(T0 + 20000);
  db.serverSet(REAL, { ctl: mkCtl({ epoch: 'w20260101' }), pub: mkPub(2) });
  assert.equal(revealMirrorView(), null, 'this phone is in the legacy week, the reveal is from another year');
  state.meta.epoch = 'w20260101';
  assert.ok(revealMirrorView(), 'the same year reads');
  state.meta.epoch = 'w20270101';
  assert.equal(revealMirrorView(), null, 'a different year does not');
  delete state.meta.epoch;
  db.serverSet(REAL, { ctl: Object.assign(mkCtl(), { v: 2 }), pub: mkPub(2) });
  assert.equal(revealMirrorView(), null, 'a newer schema is not guessed at');
  teardownReveal();
});

// ── the phone's 3 s lag keys off `sa` ───────────────────────────────

test('the phone holds back only the newest place, only until sa + 3 s; Back, the final table, End and a reload never re-hide a row', async () => {
  const db = bootReveal('viewer');
  initReveal();
  const sa = T0 + 10000;
  db.serverSet(REAL, { ctl: mkCtl({ cur: 1, shown: 2, sa, at: sa }), pub: mkPub(2) });
  atTime(sa + 1000);
  let v = revealMirrorView();
  assert.equal(v.looking, true, 'inside the look-at-the-big-screen window');
  assert.equal(v.rows.length, 1, 'the newest place is withheld');
  assert.equal(v.onScreen, null);
  atTime(sa + 3000);
  v = revealMirrorView();
  assert.equal(v.looking, false);
  assert.equal(v.rows.length, 2, 'then it appears');
  // each later command keeps `sa` (nothing new was shown), so nothing is hidden again, even at +1 s from the command
  const cmds = [
    { phase: 'live', cur: 0, seq: 4 },                                        // Back
    { phase: 'champion', cur: 1, seq: 5, finale: false },                     // (a phase command)
    { phase: 'table', cur: 1, seq: 6 },                                       // the final table
    { phase: 'ended', cur: 1, seq: 7, endedAt: T0 + 90000, endKind: 'early' }, // End
  ];
  cmds.forEach((c) => {
    const at = T0 + 40000 + c.seq * 1000;
    db.serverSet(REAL, { ctl: mkCtl(Object.assign({ cur: 1, shown: 2, sa, at }, c)), pub: mkPub(2) });
    atTime(at + 1000);
    assert.equal(revealMirrorView().rows.length, 2, 'the row stays after a ' + c.phase + ' command at +1 s');
  });
  // a reload at +1 s from the last command: the cache paints the same two rows
  confirmedReveal.real = null;
  revealLoadCache();
  atTime(T0 + 60000);
  assert.equal(revealMirrorView().rows.length, 2, 'and so does a reload');
  // a NEW place moves sa, and is withheld again
  db.serverSet(REAL, { ctl: mkCtl({ cur: 2, shown: 3, sa: T0 + 70000, at: T0 + 70000, seq: 8, teams: N }), pub: mkPub(3) });
  atTime(T0 + 71000);
  assert.equal(revealMirrorView().rows.length, 2, 'the new third place is the only one held back');
  teardownReveal();
});

test('a director\'s remote never lags: it IS the big screen', async () => {
  const db = bootReveal('editor');
  initReveal();
  const sa = T0 + 10000;
  db.serverSet(REAL, { ctl: mkCtl({ cur: 1, shown: 2, sa, at: sa }), pub: mkPub(2) });
  atTime(sa + 500);
  assert.equal(revealRemoteView('real').rows.length, 2);
  assert.equal(revealMirrorView().rows.length, 1, 'while a director\'s Now mirror lags like a counselor\'s');
  teardownReveal();
});

// ── auto-end ─────────────────────────────────────────────────────────

test('a reveal nobody ended counts as over: 60 min idle in intro / live, 15 min in champion / table; the grid still follows until', async () => {
  const db = bootReveal('viewer');
  initReveal();
  const at = T0 + 10000;
  const put = (phase) => db.serverSet(REAL, { ctl: mkCtl({ phase, at, sa: at, cur: phase === 'intro' ? -1 : 1, shown: phase === 'intro' ? 0 : 2 }), pub: phase === 'intro' ? {} : mkPub(2) });
  put('live');
  atTime(at + 59 * 60 * 1000);
  assert.equal(revealMirrorView().live, true, 'live at 59 min');
  atTime(at + 61 * 60 * 1000);
  const v = revealMirrorView();
  assert.equal(v.live, false, 'over at 61 min');
  assert.equal(v.rows.length, 2, 'but the grid is still there until 8 AM');
  assert.ok(revealGridView(), 'and it is the grid that shows');
  assert.equal(revealLiveView(), null, 'Now is no longer the live mirror');
  put('table');
  atTime(at + 14 * 60 * 1000);
  assert.equal(revealMirrorView().phase, 'table', 'the table is not live either way');
  put('champion');
  atTime(at + 14 * 60 * 1000);
  assert.equal(revealMirrorView().live, true, 'champion at 14 min');
  atTime(at + 16 * 60 * 1000);
  assert.equal(revealMirrorView().live, false, 'champion over at 16 min');
  teardownReveal();
});

test('the next moment anything changes with no snapshot is found, for every kind of moment', () => {
  const sa = T0 + 10000;
  confirmedReveal.real = { ctl: mkCtl({ cur: 1, shown: 2, sa, at: sa }), pub: mkPub(2) };
  const c = normalizeRevealCtl(confirmedReveal.real.ctl);
  assert.equal(revealNextBoundary('real', sa - 5000), sa + 3000, 'the 3 s look-at-the-big-screen window ends first');
  assert.equal(revealNextBoundary('real', sa + 4000), sa + 60 * 60 * 1000 + 1, 'then an unended reveal counts as over');
  assert.equal(revealNextBoundary('real', sa + 61 * 60 * 1000), c.until, 'then the 8 AM hide');
  assert.equal(revealNextBoundary('real', c.until), null, 'and after that there is nothing left');
  confirmedReveal.real = { ctl: mkCtl({ phase: 'table', at: sa, sa }), pub: mkPub(2) };
  assert.equal(revealNextBoundary('real', sa + 4000), sa + 15 * 60 * 1000 + 1, 'the table is over sooner');
  confirmedReveal.real = null;
  assert.equal(revealNextBoundary('real', sa), null);
});

// ── 8 AM ──────────────────────────────────────────────────────────────

function fillGridRoots() {
  REVEAL_GRID_ROOTS.forEach((id) => {
    const root = document.getElementById(id);
    root.hidden = false;
    document.getElementById(id + '-list').innerHTML = '<div class="rv-row">Team t1 · 30 points</div>';
  });
}
function gridRootsEmpty() {
  return REVEAL_GRID_ROOTS.every((id) => document.getElementById(id).hidden === true && document.getElementById(id + '-list').innerHTML === '');
}

test('8 AM on the ACTIVE tab: the grid is there at 07:59:59 and gone at 08:00:01, by the 30 s tick', async () => {
  const db = bootReveal('viewer');
  initReveal();
  const ctl = mkCtl({ phase: 'ended', cur: 1, shown: 2, endedAt: T0 + 60000, endKind: 'early', at: T0 + 60000, sa: T0 + 10000 });
  const eight = ctl.until;
  assert.equal(eight, Date.parse('2027-06-24T12:00:00Z'), 'Thursday 08:00 EDT');
  db.serverSet(REAL, { ctl, pub: mkPub(2) });
  state.ui.tab = 'now';
  fillGridRoots();
  const ticks = [];
  const realTick = revealTick;
  revealTick = (why) => { ticks.push(why); return realTick(why); };
  atTime(eight - 1000);
  shellTick();
  assert.ok(ticks.includes('tick'), 'the shell\'s 30 s tick runs the reveal\'s clock');
  assert.ok(revealGridView(), 'at 07:59:59 the grid still shows');
  assert.equal(gridRootsEmpty(), false, 'and its roots are untouched');
  atTime(eight + 1000);
  shellTick();
  revealTick = realTick;
  assert.equal(revealGridView(), null, 'at 08:00:01 the view is closed');
  assert.ok(gridRootsEmpty(), 'and both roots were emptied directly, not left to a render that may never come');
  assert.equal(revealMirrorView().expired, true);
  assert.deepEqual(revealMirrorView().rows, []);
  teardownReveal();
});

test('8 AM on an INACTIVE tab: the Games grid root empties too, with no render of that tab', async () => {
  const db = bootReveal('viewer');
  initReveal();
  const ctl = mkCtl({ phase: 'ended', cur: 1, shown: 2, endedAt: T0 + 60000, endKind: 'done', at: T0 + 60000 });
  db.serverSet(REAL, { ctl, pub: mkPub(2) });
  state.ui.tab = 'chat';          // Games and Now are both behind another tab
  fillGridRoots();
  atTime(ctl.until - 1000);
  revealTick('tick');
  assert.equal(gridRootsEmpty(), false);
  atTime(ctl.until + 1000);
  revealTick('tick');
  assert.ok(gridRootsEmpty(), 'Now\'s and Games\' roots are both empty although neither tab was visible');
  state.ui.tab = 'now';
  teardownReveal();
});

test('8 AM after a WAKE FROM SLEEP: no timer ran while the phone slept, and the visibility / pageshow handlers still hide it', async () => {
  const db = bootReveal('viewer');
  initReveal();
  const ctl = mkCtl({ phase: 'ended', cur: 1, shown: 2, endedAt: T0 + 60000, endKind: 'early', at: T0 + 60000 });
  db.serverSet(REAL, { ctl, pub: mkPub(2) });
  fillGridRoots();
  atTime(ctl.until - 30 * 60 * 1000);       // 7:30: the phone goes to sleep
  revealTick('tick');
  assert.equal(gridRootsEmpty(), false);
  atTime(ctl.until + 5000);                 // 8:00:05: it wakes with every timer still unrun
  document.hidden = false;
  (__docListeners.visibilitychange || []).forEach((fn) => fn());
  assert.ok(gridRootsEmpty(), 'the visibilitychange listener reveal.js registered at load hid the grid');
  // the same for a page restored from the back-forward cache (pageshow has no recorded listener list: the handler is the one registered)
  fillGridRoots();
  revealExpiredId = null;
  revealOnWake();
  assert.ok(gridRootsEmpty(), 'revealOnWake (also the pageshow handler) hides it as well');
  const src = readFixture('../reveal.js');
  assert.ok(/addEventListener\('visibilitychange', revealOnWake\)/.test(src) && /addEventListener\('pageshow', revealOnWake\)/.test(src), 'both wake events are wired to it');
  teardownReveal();
});

test('a corrected clock re-runs the 8 AM decision: the `.info/serverTimeOffset` handler calls revealOnClockChange', () => {
  const app = readFixture('../app.js');
  const handler = app.slice(app.indexOf("ref('.info/serverTimeOffset')"), app.indexOf("ref('.info/connected')"));
  assert.ok(handler.includes('revealOnClockChange()'), 'a big correction tells the reveal');
  confirmedReveal.real = { ctl: mkCtl({ phase: 'ended', until: T0 + 3600000, endedAt: T0 + 100, endKind: 'early' }), pub: mkPub(2) };
  fillGridRoots();
  atTime(T0 + 3600000 - 2000);
  revealOnClockChange();
  assert.equal(gridRootsEmpty(), false, 'two seconds early: still there');
  serverTimeOffset = 5000;                  // the server says it is five seconds later than this phone thought
  revealOnClockChange();
  assert.ok(gridRootsEmpty(), 'a phone 5 s slow now knows it is past 8 AM');
  serverTimeOffset = 0;
  resetReveal();
  Date.now = realDateNow;
});

test('every consumer decides "expired" itself, at paint time, from serverNow: nothing is cached', () => {
  confirmedReveal.real = { ctl: mkCtl({ phase: 'ended', endedAt: T0 + 100, endKind: 'done' }), pub: mkPub(2) };
  setMemberRole('viewer');
  atTime(untilFor(T0, false) - 1);
  assert.ok(revealGridView(), 'one ms before');
  atTime(untilFor(T0, false));
  assert.equal(revealGridView(), null, 'the instant it hides, with no tick and no snapshot between');
  resetReveal();
  Date.now = realDateNow;
  setMemberRole(null);
});

// ── the director deletes the expired node ───────────────────────────

function expiredSetup(role, extra) {
  const db = bootReveal(role);
  const ctl = mkCtl(Object.assign({ phase: 'ended', cur: 1, shown: 2, endedAt: T0 + 60000, endKind: 'early', at: T0 + 60000 }, extra || {}));
  db.serverSet(REAL, { ctl, pub: mkPub(2) });
  db.serverSet(dbPath('revealFull/real'), { r: ctl.id, n: N, frozenAt: T0, startedBy: 'someone@x,com', g: mkPub(N) });
  initReveal();
  return { db, ctl };
}

test('retireExpiredReveal is for directors only: a counselor sends nothing, ever', async () => {
  const { db, ctl } = expiredSetup('viewer');
  await wait();
  atTime(ctl.until + 5000);
  const before = db.log.length;
  assert.equal(retireExpiredReveal().why, 'not-editor');
  revealTick('tick');
  assert.equal(db.log.length, before, 'no write was made');
  assert.ok(db.serverGet(REAL), 'the node is still there');
  teardownReveal();
});

test('retireExpiredReveal never sends before until, and deletes both nodes the moment it passes', async () => {
  const { db, ctl } = expiredSetup('editor');
  await wait();
  atTime(ctl.until - 1000);
  assert.equal(retireExpiredReveal().why, 'nothing', 'one second early: nothing is expired, nothing is sent');
  assert.ok(db.serverGet(REAL));
  atTime(ctl.until);
  const r = retireExpiredReveal();
  assert.deepEqual(r, { sent: true, modes: ['real'] });
  await waitQuiet();
  assert.equal(db.serverGet(REAL), null, 'the public node is gone');
  assert.equal(db.serverGet(dbPath('revealFull/real')), null, 'and so is the private full order');
  assert.equal(confirmedReveal.real, null, 'the re-read made the phone\'s own copy agree');
  teardownReveal();
});

test('retireExpiredReveal sends at most once a minute, only while connected and past the first pull', async () => {
  const { db, ctl } = expiredSetup('editor');
  await wait();
  atTime(ctl.until + 1000);
  fbConnected = false;
  assert.equal(retireExpiredReveal().why, 'not-ready', 'offline');
  fbConnected = true; remoteReady = false;
  assert.equal(retireExpiredReveal().why, 'not-ready', 'before the first pull');
  remoteReady = true;
  db.refuse(REAL);                                  // an early phone clock: the server refuses the delete
  assert.equal(retireExpiredReveal().sent, true);
  await waitQuiet();
  assert.ok(db.serverGet(REAL), 'a refusal is swallowed and the node stays');
  atTime(ctl.until + 30000);
  assert.equal(retireExpiredReveal().why, 'throttled', '30 s later: not yet');
  db.allow(REAL);
  atTime(ctl.until + 61000);
  assert.equal(retireExpiredReveal().sent, true, 'a minute later it tries again');
  await waitQuiet();
  assert.equal(db.serverGet(REAL), null);
  teardownReveal();
});

test('retireExpiredReveal retires a practice by ITS until (or a leftover ended one) and never touches a live real reveal', async () => {
  const db = bootReveal('editor');
  atTime(T0 + 60000);                                                      // long before the practice's own until
  const real = mkCtl({ phase: 'live' });                                   // until: tomorrow 8 AM, long away
  const pr = mkCtl({ id: 'r2kz9fxq-4hd3', phase: 'ended', endedAt: T0, endKind: 'done', until: T0 + 7200000, at: T0 });
  db.serverSet(REAL, { ctl: real, pub: mkPub(2) });
  db.serverSet(PRACTICE, { ctl: pr, pub: mkPub(1) });
  db.serverSet(dbPath('revealFull/practice'), { r: pr.id, n: N, frozenAt: T0, startedBy: 'x@x,com', g: mkPub(N) });
  initReveal();
  await waitQuiet();                                                        // the opening re-scan found the leftover, and retired it
  assert.equal(db.serverGet(PRACTICE), null, 'an ended practice is a leftover: gone');
  assert.equal(db.serverGet(dbPath('revealFull/practice')), null);
  assert.ok(db.serverGet(REAL), 'the real reveal is untouched');
  // a practice whose own until has passed is retired too (not just an ended one)
  db.serverSet(PRACTICE, { ctl: Object.assign({}, pr, { phase: 'live', endedAt: undefined, endKind: undefined }), pub: mkPub(1) });
  atTime(T0 + 3 * 3600 * 1000);
  assert.deepEqual(retireExpiredReveal(), { sent: true, modes: ['practice'] }, 'three hours on, the practice has expired');
  await waitQuiet();
  assert.equal(db.serverGet(PRACTICE), null);
  assert.ok(db.serverGet(REAL), 'still the real one is untouched');
  // a real reveal that has ENDED but whose 8 AM is ahead stays (the grid is for phones until then)
  db.serverSet(REAL, { ctl: Object.assign({}, real, { phase: 'ended', endedAt: T0, endKind: 'early' }), pub: mkPub(2) });
  await wait();
  atTime(T0 + 3 * 3600 * 1000 + 120000);
  assert.equal(retireExpiredReveal().why, 'nothing', 'an ended real reveal is kept until its until');
  teardownReveal();
});

test('a view-only second tab of a director does not delete (the writer tab does)', async () => {
  const { ctl } = expiredSetup('editor');
  await wait();
  tabWriter = false;
  atTime(ctl.until + 5000);
  assert.equal(retireExpiredReveal().why, 'not-editor');
  tabWriter = null;
  teardownReveal();
});

// ── the champion line ────────────────────────────────────────────────

function finaleNode(over) {
  const pub = {};
  for (let i = 0; i < N; i++) {
    const tid = 't' + (N - 1 - i);
    pub['g' + i] = { place: N - i, e: { [tid]: ent(tid, 10 * (N - i), { nm: 'Team ' + tid, g: 3, s: 2, b: 1, v: 4, m: 5, c: 6 }) } };
  }
  return { ctl: mkCtl(Object.assign({ finale: true, phase: 'champion', cur: N - 1, shown: N, at: T0 + 100000, sa: T0 + 100000, teams: N }, over || {})), pub };
}

test('the champion line: remembered when 1st place is on the phone, survives the node\'s deletion and 8 AM, and holds a name and nothing else', async () => {
  const db = bootReveal('viewer');
  initReveal();
  db.serverSet(REAL, finaleNode());
  atTime(T0 + 101000);
  revealEvaluate();
  assert.equal(revealChampionLine(), null, 'inside the 3 s look-at-the-big-screen window 1st place is not on the phone yet');
  atTime(T0 + 104000);
  revealEvaluate();
  assert.deepEqual(revealChampionLine(), [{ id: 't0', name: 'Team t0' }]);
  const stored = localStorage.getItem(lsKey(REVEAL_CHAMPION_KEY));
  ['"p"', '"g"', '"s"', '"b"', '"v"', '"m"', '"c"', '"place"', '"seq"', '"until"'].forEach((frag) => assert.ok(!stored.includes(frag), 'the stored line carries ' + frag + ': ' + stored));
  assert.ok(!/\d{2}/.test(stored.replace(/"at":\d+/, '').replace(/"rid":"[^"]*"/, '')), 'no number but the stamp: ' + stored);
  // the node is retired (a director deleted it) and everything else is gone; the line stays
  db.serverSet(REAL, null);
  atTime(finaleNode().ctl.until + 60000);
  assert.equal(revealMirrorView(), null, 'nothing else is left');
  assert.equal(revealGridView(), null);
  assert.deepEqual(revealChampionLine(), [{ id: 't0', name: 'Team t0' }], 'the champions outlive the node');
  teardownReveal();
});

test('the champion line is for a FINALE only, ends with the camp week, and never comes from a practice', async () => {
  const db = bootReveal('viewer');
  initReveal();
  db.serverSet(REAL, finaleNode({ finale: false }));
  atTime(T0 + 200000);
  revealEvaluate();
  assert.equal(revealChampionLine(), null, 'an ordinary evening crowns nobody');
  db.serverSet(REAL, finaleNode());
  atTime(T0 + 204000);
  revealEvaluate();
  assert.ok(revealChampionLine());
  // the camp week is over: "after" forgets it (campWeek says so from the week's start date)
  const realWeek = campWeek;
  campWeek = () => ({ start: '2027-06-20', phase: 'during' });
  assert.ok(revealChampionLine(), 'during the week it stays');
  campWeek = () => ({ start: '2027-06-20', phase: 'after' });
  assert.equal(revealChampionLine(), null, 'after the week it is forgotten');
  assert.equal(localStorage.getItem(lsKey(REVEAL_CHAMPION_KEY)), null, 'and removed, not just hidden');
  campWeek = realWeek;
  // a practice finale on a director's phone never writes the line
  db.serverSet(REAL, null);
  setMemberRole('editor');
  db.serverSet(PRACTICE, finaleNode({ id: 'r2kz9fxq-4hd3', until: T0 + 7200000 }));
  atTime(T0 + 210000);
  revealEvaluate();
  assert.equal(revealChampionLine(), null);
  teardownReveal();
});

test('the champion code reads no number: revealRememberChampion and revealChampionLine never touch p, g, s, b, v, m or c', () => {
  const src = readFixture('../reveal.js');
  ['revealRememberChampion', 'revealChampionLine'].forEach((name) => {
    const start = src.indexOf('function ' + name + '(');
    const body = src.slice(start, src.indexOf('\n}\n', start)).replace(/\/\/[^\n]*/g, '');
    assert.ok(body.length > 100, name + ' found');
    assert.ok(!/\.(p|g|s|b|v|m|c|place)\b/.test(body), name + ' reads a score field: ' + (/\.(p|g|s|b|v|m|c|place)\b/.exec(body) || [])[0]);
    assert.ok(!/medalCounts|rankTeamsByPoints|standingsVisible|state\.results|state\.bonuses/.test(body), name + ' reaches a points reader');
  });
});

// ── what leaves the device on sign-out, and the remembered clock ────

test('signing out wipes the reveal cache and the champion line, for both camps; the clock estimate stays', () => {
  Object.keys(CAMPS).forEach((cid) => {
    localStorage.setItem(REVEAL_CACHE_KEY + CAMPS[cid].storageSuffix, '{"ctl":{}}');
    localStorage.setItem(REVEAL_CHAMPION_KEY + CAMPS[cid].storageSuffix, '{"ver":1}');
  });
  localStorage.setItem(SERVER_OFFSET_KEY, '1500');
  clearLocalData();
  Object.keys(CAMPS).forEach((cid) => {
    assert.equal(localStorage.getItem(REVEAL_CACHE_KEY + CAMPS[cid].storageSuffix), null, cid + ' cache');
    assert.equal(localStorage.getItem(REVEAL_CHAMPION_KEY + CAMPS[cid].storageSuffix), null, cid + ' champion');
  });
  assert.equal(localStorage.getItem(SERVER_OFFSET_KEY), '1500', 'the server-clock estimate describes the phone, not the camp, and is kept');
  localStorage.removeItem(SERVER_OFFSET_KEY);
});

test('the server-clock estimate is remembered across a reload: a phone that opens offline at 7:58 still knows the server\'s time', () => {
  localStorage.setItem(SERVER_OFFSET_KEY, '-90000');
  assert.equal(readStoredServerOffset(), -90000);
  localStorage.setItem(SERVER_OFFSET_KEY, String(SERVER_OFFSET_MAX_MS * 2));
  assert.equal(readStoredServerOffset(), 0, 'a value that large is junk, not a clock');
  localStorage.setItem(SERVER_OFFSET_KEY, 'soon');
  assert.equal(readStoredServerOffset(), 0);
  localStorage.removeItem(SERVER_OFFSET_KEY);
  assert.equal(readStoredServerOffset(), 0, 'no estimate: exactly Date.now(), as before');
  rememberServerOffset(1234.6);
  assert.equal(localStorage.getItem(SERVER_OFFSET_KEY), '1235');
  localStorage.removeItem(SERVER_OFFSET_KEY);
  // a fresh page reads it before anything connects
  const { makeContext } = nodeRequire('./harness.js');
  const vm = nodeRequire('vm');
  const page = makeContext({ camp: CAMP.id, storage: { campScoreboardServerOffset: '42000' } });
  assert.equal(vm.runInContext('serverNow() - Date.now()', page.ctx) >= 41000, true, 'serverNow starts from the remembered offset');
  const fresh = makeContext({ camp: CAMP.id });
  assert.ok(Math.abs(vm.runInContext('serverNow() - Date.now()', fresh.ctx)) < 50, 'and from zero when there is none');
});
