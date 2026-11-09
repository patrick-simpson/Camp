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

// A clean engine, a signed-in phone of the given role, and a fake database with the camp's public node on it.
let rulesEra = 'r2';                                      // which published rules the model judges by: 'r1' (live before R2) or 'r2'
function resetReveal() {
  REVEAL_BRANDING_LIVE = false; revealBrandRefused = false; revealThumbs.clear(); rulesEra = 'r2';
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
  serverTimeOffset = 0; serverOffsetKnown = true;   // a phone that has met the server's clock (an unknown one holds the newest place back: see the clock-unknown test)
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
  await waitQuiet();
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
  await waitQuiet();
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
  await waitQuiet();
  atTime(T0 + 20000);
  assert.ok(revealMirrorView(), 'live before the refusal');
  const painted = [];
  revealPaint = (why) => painted.push(why);
  db.revokeRead(REAL);
  await waitQuiet();
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

test('a phone that has never learned the server clock fails closed: the newest place stays held back until the first answer, which is remembered even when small', async () => {
  const db = bootReveal('viewer');
  initReveal();
  serverOffsetKnown = false;                                  // a brand-new install: serverNow() is just this phone's clock
  localStorage.removeItem(SERVER_OFFSET_KEY);
  const sa = T0 + 10000;
  db.serverSet(REAL, { ctl: mkCtl({ cur: 1, shown: 2, sa, at: sa }), pub: mkPub(2) });
  atTime(sa + 60000);                                         // a minute on its own clock: far past the 3 s window
  let v = revealMirrorView();
  assert.equal(v.looking, true, 'held back: a fast phone clock could otherwise show it before the room hears it');
  assert.equal(v.rows.length, 1);
  assert.equal(revealRemoteView('real').rows.length, 2, 'a remote never waits');
  // the REAL `.info/serverTimeOffset` handler, lifted out of initSync and run in this page
  const app = readFixture('../app.js');
  const head = "ref('.info/serverTimeOffset').on('value', ";
  const from = app.indexOf(head) + head.length;
  const body = app.slice(from, app.indexOf('}, () => { /* rules/offline', from) + 1);
  assert.ok(body.startsWith('(s) => {'), 'the handler is where this test looks for it');
  const handler = (0, eval)('(' + body + ')');
  let woke = 0;
  const realWake = revealOnClockChange;
  revealOnClockChange = () => { woke++; realWake(); };
  handler({ val: () => 80 });                                 // 80 ms: under the 500 ms "changed" bar, still the first answer
  assert.equal(serverOffsetKnown, true);
  assert.equal(woke, 1, 'the reveal is re-evaluated at once');
  assert.equal(localStorage.getItem(SERVER_OFFSET_KEY), '80', 'remembered even though it is small');
  v = revealMirrorView();
  assert.equal(v.looking, false);
  assert.equal(v.rows.length, 2, 'the place appears once the clock is known');
  handler({ val: () => 90 });                                 // a refinement is not a first answer
  assert.equal(woke, 1);
  // a later launch knows at once; junk in storage does not count
  assert.equal(readStoredServerOffsetKnown(), true);
  localStorage.setItem(SERVER_OFFSET_KEY, 'soon');
  assert.equal(readStoredServerOffsetKnown(), false);
  localStorage.setItem(SERVER_OFFSET_KEY, String(SERVER_OFFSET_MAX_MS * 2));
  assert.equal(readStoredServerOffsetKnown(), false);
  localStorage.removeItem(SERVER_OFFSET_KEY);
  assert.equal(readStoredServerOffsetKnown(), false);
  revealOnClockChange = realWake;
  serverTimeOffset = 0; serverOffsetKnown = true;
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
  await waitQuiet();
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
  await waitQuiet();
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
  await waitQuiet();
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
  await waitQuiet();
  atTime(T0 + 3 * 3600 * 1000 + 120000);
  assert.equal(retireExpiredReveal().why, 'nothing', 'an ended real reveal is kept until its until');
  teardownReveal();
});

test('a view-only second tab of a director does not delete (the writer tab does)', async () => {
  const { ctl } = expiredSetup('editor');
  await waitQuiet();
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

// ════════════════════════════════════════════════════════════════════
// THE DIRECTORS' COMMANDS
// ════════════════════════════════════════════════════════════════════
// Every write goes through a MODEL of database.rules.json's reveal clauses (below), so a builder that
// writes what the rules would refuse fails here, fast. The model is a tripwire, not the authority: the
// real rules run against the real client in tests/emulator/reveal-client.mjs.

let nowT = T0;                                            // the one clock: this page's Date.now AND the database's `now`
const ME = 'jenn@example,com';                            // the director's member key (authUser below)

function resolveTs(v) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return nowT;
    const out = Array.isArray(v) ? [] : {};
    Object.keys(v).forEach((k) => { out[k] = resolveTs(v[k]); });
    return out;
  }
  return v;
}
function setPathIn(tree, path, value) {
  const parts = path.split('/');
  let cur = tree;
  parts.slice(0, -1).forEach((k) => { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; });
  if (value === null) delete cur[parts[parts.length - 1]]; else cur[parts[parts.length - 1]] = value;
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

// database.rules.json, revealPublic and revealFull, evaluated for one multi-path update at the camp root by a
// director whose member key is `me`. `root` = the camp's tree before the write, `values` = the update with
// every timestamp resolved. Returns { ok: true } or { ok: false, why }.
function rulesModel(root, values, now, me) {
  const old = (path) => path.split('/').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), root);
  const next = JSON.parse(JSON.stringify(root));
  Object.keys(values).forEach((k) => setPathIn(next, k, values[k]));
  const no = (why) => ({ ok: false, why });
  const SHAPE_CTL = ['v', 'id', 'seq', 'phase', 'cur', 'shown', 'teams', 'finale', 'at', 'sa', 'ca', 'startedAt', 'until', 'endedAt', 'endKind', 'epoch'];
  function ctlRule(ctl, was, mode, hasPub) {
    if (!ctl || typeof ctl !== 'object') return 'ctl is not a branch';
    const need = ['v', 'id', 'seq', 'phase', 'cur', 'shown', 'teams', 'finale', 'at', 'sa', 'ca', 'startedAt', 'until'];
    if (need.some((k) => ctl[k] === undefined)) return 'ctl misses a field';
    if (Object.keys(ctl).some((k) => !SHAPE_CTL.includes(k))) return 'ctl has an unknown field: ' + Object.keys(ctl).find((k) => !SHAPE_CTL.includes(k));
    if (!inRange(ctl.v, 1, 9) || !REVEAL_ID_RE.test(String(ctl.id)) || !inRange(ctl.seq, 1, 9999)) return 'v / id / seq';
    if (!/^(intro|live|champion|table|ended)$/.test(String(ctl.phase))) return 'phase';
    if (!inRange(ctl.cur, -1, 5) || !inRange(ctl.shown, 0, 6) || !inRange(ctl.teams, 2, 6) || typeof ctl.finale !== 'boolean') return 'cur / shown / teams / finale';
    if (!(ctl.cur < ctl.shown)) return 'cur must be below shown';
    if (ctl.at !== now) return 'at must be server time';
    if (!isNum(ctl.sa) || ctl.sa > now || !isNum(ctl.ca)) return 'sa / ca';
    if (!(ctl.startedAt === now || (was && ctl.startedAt === was.startedAt))) return 'startedAt';
    const cap = mode === 'practice' ? 10800000 : 172800000;
    if (!(ctl.until === (was && was.until) || (isNum(ctl.until) && ctl.until > now && ctl.until <= now + cap))) return 'until';
    if (ctl.endedAt !== undefined && !(ctl.endedAt === now || (was && ctl.endedAt === was.endedAt))) return 'endedAt';
    if (ctl.endKind !== undefined && !/^(done|early)$/.test(String(ctl.endKind))) return 'endKind';
    if (ctl.epoch !== undefined && !(typeof ctl.epoch === 'string' && ctl.epoch.length <= 24)) return 'epoch';
    if (was && was.id === ctl.id) {                                                  // a command on the same reveal
      if (ctl.seq !== was.seq + 1) return 'seq must be exactly one more (compare-and-set)';
      if (was.phase === 'ended') return 'an ended reveal cannot be commanded';
      if (ctl.shown < was.shown || ctl.shown > was.shown + 1) return 'shown moves by at most one, never down';
      if (ctl.shown > was.shown ? ctl.sa !== now : ctl.sa !== was.sa) return 'sa moves only when a place is shown';
      if (ctl.ca !== was.ca || ctl.startedAt !== was.startedAt || ctl.until !== was.until || ctl.finale !== was.finale) return 'ca / startedAt / until / finale are fixed inside a reveal';
    } else {                                                                         // a Start
      if (!(ctl.seq === 1 && ctl.shown === 0 && ctl.phase === 'intro' && ctl.startedAt === now && ctl.sa === now)) return 'a Start is seq 1, intro, shown 0, stamped now';
      if (!(ctl.ca > now - 60000 && ctl.ca <= now + 60000)) return 'ca is more than a minute old';
      if (hasPub) return 'a Start may not coexist with a pub';
    }
    return null;
  }
  function groupRule(key, grp, wasGroup, newCtl, oldCtl, modeOf) {
    if (!/^g[0-5]$/.test(key) || !grp || typeof grp !== 'object' || grp.place === undefined || grp.e === undefined) return 'group shape';
    if (Object.keys(grp).some((k) => k !== 'place' && k !== 'e')) return 'group has an unknown field';
    if (wasGroup !== undefined && newCtl.id === (oldCtl && oldCtl.id)) return 'a published place cannot be rewritten inside the same reveal';
    if (!(newCtl.shown >= Number(key[1]) + 1)) return 'a group cannot be published before its place is shown';
    if (!inRange(grp.place, 1, 6) || !grp.e || typeof grp.e !== 'object' || !Object.keys(grp.e).length) return 'place / e';
    for (const tid of Object.keys(grp.e)) {
      const e = grp.e[tid];
      if (!/^t[0-5]$/.test(tid) || !e || typeof e !== 'object') return 'team key ' + tid;
      if (['nm', 'p', 'g', 's', 'b'].some((k) => e[k] === undefined)) return 'entry misses a field';
      // R1 (the rules live before R2) knows no look beyond k; R2 adds em / pl / ph to a PUBLIC entry (rulesEra)
      const known = ['nm', 'k', 'p', 'g', 's', 'b', 'v', 'm', 'c'].concat(rulesEra === 'r2' ? ['em', 'pl', 'ph'] : []);
      if (Object.keys(e).some((k) => !known.includes(k))) return 'entry has an unknown field: ' + Object.keys(e).find((k) => !known.includes(k));
      if (e.em !== undefined && !(typeof e.em === 'string' && e.em.length >= 1 && e.em.length <= 16 && !/[<>&"']/.test(e.em))) return 'em';
      if (e.pl !== undefined && e.pl !== true) return 'pl';
      if (e.ph !== undefined) {
        if (!(typeof e.ph === 'string' && e.ph.length <= REVEAL_PHOTO_MAX && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(e.ph))) return 'ph';
        const sib = (next.revealPublic && next.revealPublic[modeOf] && next.revealPublic[modeOf].pub) || {};
        if (Object.keys(sib).some((gk) => gk !== key && sib[gk] && sib[gk].e && sib[gk].e[tid])) return 'ph: this team already has a photo in another place';
      }
      if (typeof e.nm !== 'string' || e.nm.length < 1 || e.nm.length > 30) return 'nm';
      if (!inRange(e.p, -9999, 99999) || !inRange(e.g, 0, 99) || !inRange(e.s, 0, 99) || !inRange(e.b, 0, 99)) return 'p / g / s / b';
      for (const k of ['v', 'm', 'c']) if (e[k] !== undefined && !inRange(e[k], -9999, 99999)) return k;
      if (e.k !== undefined && !/^[a-z]{2,12}$/.test(String(e.k))) return 'k';
    }
    return null;
  }
  for (const key of Object.keys(values)) {
    const [section, mode, a, b] = key.split('/');
    const v = values[key];
    if (section === 'revealPublic') {
      if (!/^(real|practice)$/.test(String(mode))) return no('mode');
      const was = old('revealPublic/' + mode);
      const wasCtl = was && was.ctl;
      if (a === undefined) {
        if (v === null) { if (mode === 'real' && wasCtl && !(wasCtl.until <= now)) return no('a real reveal cannot be deleted before its until'); continue; }
        if (!v || typeof v !== 'object' || !v.ctl || Object.keys(v).some((k) => k !== 'ctl' && k !== 'pub')) return no('a child is { ctl, pub } and nothing else');
        const why = ctlRule(v.ctl, wasCtl, mode, !!v.pub); if (why) return no(why);
        for (const gk of Object.keys(v.pub || {})) { const w = groupRule(gk, v.pub[gk], (wasCtl && wasCtl.id === v.ctl.id && was.pub) ? was.pub[gk] : undefined, v.ctl, wasCtl, mode); if (w) return no(w); }
      } else if (a === 'ctl' && b === undefined) {
        const why = ctlRule(v, wasCtl, mode, !!(next.revealPublic && next.revealPublic[mode] && next.revealPublic[mode].pub)); if (why) return no(why);
      } else if (a === 'pub' && b !== undefined && !key.split('/')[4]) {
        const nc = next.revealPublic && next.revealPublic[mode] && next.revealPublic[mode].ctl;
        if (!nc) return no('no ctl to publish under');
        const w = groupRule(b, v, was && was.pub ? was.pub[b] : undefined, nc, wasCtl, mode); if (w) return no(w);
      } else return no('a path this model does not allow: ' + key);
    } else if (section === 'revealFull') {
      if (key.split('/').length !== 2) return no('revealFull is written whole');
      if (v === null) continue;
      const nc = next.revealPublic && next.revealPublic[mode] && next.revealPublic[mode].ctl;
      if (!nc || v.r !== nc.id) return no('revealFull.r must equal the ctl id');
      if (['r', 'n', 'frozenAt', 'startedBy', 'g'].some((k) => v[k] === undefined) || Object.keys(v).some((k) => !['r', 'n', 'frozenAt', 'lastScoreAt', 'startedBy', 'g'].includes(k))) return no('revealFull shape');
      if (!inRange(v.n, 1, 6) || !(v.frozenAt === now || v.frozenAt === (old(key) && old(key).frozenAt)) || v.startedBy !== me) return no('n / frozenAt / startedBy');
      if (v.lastScoreAt !== undefined && !(isNum(v.lastScoreAt) && v.lastScoreAt <= now)) return no('lastScoreAt');
      for (const gk of Object.keys(v.g || {})) {
        const grp = v.g[gk];
        if (!/^g[0-5]$/.test(gk) || !grp || !inRange(grp.place, 1, 6)) return no('revealFull group ' + gk);
        for (const tid of Object.keys(grp.e || {})) { const e = grp.e[tid]; if (!/^t[0-5]$/.test(tid) || typeof e.nm !== 'string' || !e.nm.length || e.nm.length > 30) return no('revealFull entry'); }
      }
    } else return no('a section this model does not allow: ' + section);
  }
  return { ok: true };
}

// The fake database with the model in front of the camp-root update, writes recorded.
function withRulesModel(db, log) {
  const orig = db.ref;
  db.ref = (p) => {
    const r = orig(p);
    if (String(p) !== CAMP.dbRoot) return r;
    const update = r.update;
    r.update = (values) => {
      // another director's write may land first (a test's hook); the server then judges ours against what it holds NOW
      if (db.beforeUpdate) db.beforeUpdate(values);
      const resolved = resolveTs(values);
      const verdict = rulesModel((db.serverTree()[CAMP.dbRoot]) || {}, resolved, nowT, ME);
      log.push({ values: resolved, verdict });
      if (!verdict.ok) {
        return new Promise((resolve, reject) => setTimeout(() => { const e = new Error('PERMISSION_DENIED: ' + verdict.why); e.code = 'PERMISSION_DENIED'; reject(e); }, 0));
      }
      return update.call(r, values);
    };
    return r;
  };
}

// ── a director's phone with a known set of standings ─────────────────
// Points are set by custom bonuses (the simplest exact source); a team's name carries its place so a leak
// is greppable. `points` = per team index; ties are two equal numbers.
function seedStandings(points, names) {
  state.results = {};
  state.bonuses = {};
  state.teams.forEach((t, i) => {
    t.name = (names && names[i]) || ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'][i];
    state.bonuses['b' + i] = { teamId: t.id, category: 'custom', label: 'x', points: points[i], at: Date.parse('2026-01-01') };
  });
}
// 1st … last. Distinct, un-guessable point values so a leaked number is found by its digits.
const SENTINEL_POINTS = [971, 863, 752, 641, 533, 427];

async function bootDirector(opts) {
  const o = opts || {};
  nowT = o.now || T0;
  const db = bootReveal('editor', o.db);
  authUser = { email: 'jenn@example.com' };
  Date.now = () => nowT;
  db.now = () => nowT;
  const log = [];
  withRulesModel(db, log);
  db.log2 = log;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false; pendingWrites = 0; remoteRefetchPending = false;
  seedStandings(o.points || SENTINEL_POINTS.slice(0, state.teams.length));
  toasts = [];
  initReveal();
  await waitQuiet();
  return db;
}
let toasts = [];
showToast = (m) => { toasts.push(String(m)); };
function afterDirector() {
  authUser = null;
  teardownReveal();
}
const writesTo = (log, prefix) => log.filter((w) => w.verdict.ok).flatMap((w) => Object.keys(w.values).filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, value: w.values[k] })));

test('Start freezes the real standings, ties share a place, and the public node gets a ctl and no place at all', async () => {
  const db = await bootDirector();
  const r = await revealStart({ quiet: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const pubWrites = writesTo(db.log2, 'revealPublic/');
  assert.equal(pubWrites.length, 1, 'one write to the public node');
  const node = pubWrites[0].value;
  assert.deepEqual(Object.keys(node).sort(), ['ctl', 'pub'], 'a whole child: ctl and an explicit pub: null (a Start leaves no earlier place behind)');
  assert.equal(node.pub, null);
  const ctl = node.ctl;
  assert.equal(ctl.seq, 1); assert.equal(ctl.phase, 'intro'); assert.equal(ctl.cur, -1); assert.equal(ctl.shown, 0);
  assert.equal(ctl.teams, N);
  assert.equal(ctl.finale, false, 'a Wednesday');
  assert.equal(ctl.until, untilFor(T0, false), 'Thursday 08:00 camp time, from reveal-core');
  assert.equal(ctl.ca, T0, 'the director\'s clock at the tap, for the rules\' one-minute window');
  assert.equal(ctl.at, T0); assert.equal(ctl.sa, T0); assert.equal(ctl.startedAt, T0);
  assert.ok(REVEAL_ID_RE.test(ctl.id));
  assert.deepEqual(Object.keys(ctl).sort(), ['at', 'ca', 'cur', 'finale', 'id', 'phase', 'sa', 'seq', 'shown', 'startedAt', 'teams', 'until', 'v'], 'no epoch in a legacy week, no member key, no name');
  const full = writesTo(db.log2, 'revealFull/')[0].value;
  assert.equal(full.r, ctl.id);
  assert.equal(full.startedBy, ME, 'the director\'s key is written here and in no public field');
  assert.equal(full.n, N);
  assert.equal(Object.keys(full.g).length, N);
  assert.equal(full.g.g0.place, N, 'g0 is the LAST place, the first one shown');
  assert.equal(full.g['g' + (N - 1)].place, 1);
  assert.deepEqual(Object.keys(full.g.g0.e), ['t' + (N - 1)]);
  assert.equal(full.g['g' + (N - 1)].e.t0.p, SENTINEL_POINTS[0]);
  assert.equal(confirmedReveal.real.ctl.id, ctl.id, 'the confirmed store holds the server\'s ctl');
  assert.equal(revealFullFor('real').n, N, 'and this phone holds the up-next preview it just wrote');
  afterDirector();
});

test('a tie is one place with several teams, ordered by golds, silvers, bronzes then name, and the next place skips', async () => {
  const points = [900, 800, 800, 700, 600, 500].slice(0, state.teams.length);
  const db = await bootDirector({ points });
  const gid = allGames()[0].id;
  const mult = allGames()[0].messtival ? 2 : 1;
  state.results[gid] = { medals: { gold: state.teams[2].id, silver: state.teams[1].id, bronze: state.teams[0].id } };   // team 2 has the gold, so it leads the tie on points AND medals
  state.bonuses.b0.points -= MEDAL_POINTS.bronze * mult;
  state.bonuses.b1.points = 800 - MEDAL_POINTS.silver * mult;
  state.bonuses.b2.points = 800 - MEDAL_POINTS.gold * mult;
  assert.equal(revealFreezeRows().filter((r) => r.p === 800).length, 2, 'the setup really has a two-way tie');
  const f = revealFreeze(nowT);
  const places = f.groups.map((g) => g.place);
  assert.deepEqual(places, places.slice().sort((a, b) => b - a), 'reveal order: the last place first');
  const tie = f.groups.find((g) => g.entries.length === 2);
  assert.ok(tie, 'a two-team group');
  assert.equal(tie.place, 2, 'both are 2nd');
  assert.deepEqual(tie.entries.map((e) => e.id), [state.teams[2].id, state.teams[1].id], 'the gold medal leads the tie');
  assert.equal(f.groups.length, N - 1, 'one fewer place than teams');
  assert.equal(f.groups[f.groups.length - 1].place, 1, '1st is still the last group shown');
  const r = await revealStart({ quiet: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(writesTo(db.log2, 'revealFull/')[0].value.n, N - 1);
  afterDirector();
});

test('a team name longer than 30 characters is cut, never refused; a missing name falls back to Team N', async () => {
  const db = await bootDirector();
  state.teams[0].name = 'A'.repeat(29) + '🦊🦊';
  state.teams[1].name = '   ';
  const r = await revealStart({ quiet: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const g = writesTo(db.log2, 'revealFull/')[0].value.g;
  const names = [].concat(...Object.values(g).map((x) => Object.values(x.e).map((e) => e.nm)));
  assert.ok(names.every((n) => n.length >= 1 && n.length <= 30), names.join('|'));
  assert.ok(names.includes('Team 2'), 'the blank name became Team 2');
  assert.ok(!names.some((n) => /[\ud800-\udbff]$/.test(n)), 'no half an emoji');
  afterDirector();
});

test('the whole reveal walks: every place, a Back, the replay, the final table, End; seq +1 each time, sa only when a place is shown', async () => {
  const db = await bootDirector();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  const ctlOf = () => confirmedReveal.real.ctl;
  let prev = ctlOf();
  const step = async (action, expect) => {
    nowT += 5000;                                       // the beat is over: the button is ready
    const r = await (action === 'next' ? revealNext({ quiet: true }) : action === 'back' ? revealBack({ quiet: true }) : revealEnd({ quiet: true }));
    assert.equal(r.ok, true, action + ' ' + JSON.stringify(r) + ' ' + JSON.stringify((db.log2[db.log2.length - 1] || {}).verdict));
    const c = ctlOf();
    assert.equal(c.seq, prev.seq + 1, 'seq is one more');
    Object.keys(expect).forEach((k) => assert.equal(c[k], expect[k], action + ': ' + k + ' is ' + c[k]));
    assert.equal(c.sa === prev.sa, c.shown === prev.shown, 'sa moves exactly when a place is shown');
    assert.equal(c.at, nowT, 'at is the command\'s server time');
    assert.equal(c.ca, prev.ca); assert.equal(c.startedAt, prev.startedAt); assert.equal(c.until, prev.until); assert.equal(c.id, prev.id);
    prev = c;
  };
  await step('next', { phase: 'live', cur: 0, shown: 1 });
  await step('next', { phase: 'live', cur: 1, shown: 2 });
  await step('back', { phase: 'live', cur: 0, shown: 2 });
  await step('next', { phase: 'live', cur: 1, shown: 2 });                  // the replay: nothing new is published
  for (let k = 2; k < N; k++) await step('next', { phase: 'live', cur: k, shown: k + 1 });
  assert.equal(Object.keys(confirmedReveal.real.pub).length, N, 'every place is public only after it was shown');
  await step('next', { phase: 'table', cur: N - 1, shown: N });             // a Wednesday: no crowning
  await step('back', { phase: 'live', cur: N - 1, shown: N });
  await step('next', { phase: 'table', cur: N - 1, shown: N });
  await step('end', { phase: 'ended', endKind: 'done' });
  assert.equal(ctlOf().endedAt, nowT);
  const after = await revealNext({ quiet: true });
  assert.equal(after.ok, false); assert.equal(after.code, 'ended', 'an ended reveal takes no command');
  assert.equal(writesTo(db.log2, 'revealPublic/').filter((w) => /\/pub\/g/.test(w.key)).length, N, 'N groups were published in all: the replay and Back published none');
  afterDirector();
});

test('an early End says early; Friday (inside the camp week) crowns the champions between the last place and the table', async () => {
  const db = await bootDirector({ now: Date.parse('2027-06-25T23:31:00Z') });       // a Friday evening
  const realWeek = campWeek;
  campWeek = () => ({ start: '2027-06-20', phase: 'during' });
  assert.equal(revealIsFinaleDay(nowT), true);
  assert.equal((await revealStart({ quiet: true })).ok, true);
  assert.equal(confirmedReveal.real.ctl.finale, true, 'decided at Start from the camp day');
  const go = async (a) => { nowT += 5000; const r = await (a === 'next' ? revealNext({ quiet: true }) : a === 'back' ? revealBack({ quiet: true }) : revealEnd({ quiet: true })); assert.equal(r.ok, true, a + JSON.stringify(r)); };
  for (let k = 0; k < N; k++) await go('next');
  assert.equal(confirmedReveal.real.ctl.phase, 'live', 'all places shown, still live');
  nowT += 5000;
  assert.equal(revealRemoteModel().go.face, 'crown', 'the button offers the crowning');
  await go('next');
  assert.equal(confirmedReveal.real.ctl.phase, 'champion');
  await go('next');
  assert.equal(confirmedReveal.real.ctl.phase, 'table');
  await go('back');                                                                   // back from the table lands on the champions
  assert.equal(confirmedReveal.real.ctl.phase, 'champion');
  await go('end');
  assert.equal(confirmedReveal.real.ctl.endKind, 'early', 'End from anywhere but the table is early');
  campWeek = realWeek;
  afterDirector();
});

test('the finale is the camp\'s finale weekday inside its week: not the Friday before camp, not another day; the weekday is a setting', () => {
  const realWeek = campWeek;
  campWeek = () => ({ start: '2027-06-20', phase: 'during' });
  assert.equal(revealIsFinaleDay(Date.parse('2027-06-25T23:31:00Z')), true, 'Friday of the camp week');
  assert.equal(revealIsFinaleDay(Date.parse('2027-06-24T23:31:00Z')), false, 'Thursday');
  assert.equal(revealIsFinaleDay(Date.parse('2027-07-02T23:31:00Z')), false, 'the Friday after the week');
  assert.equal(revealIsFinaleDay(Date.parse('2027-06-18T23:31:00Z')), false, 'the Friday before it');
  campWeek = () => ({ start: null, phase: 'unset' });
  assert.equal(revealIsFinaleDay(Date.parse('2027-06-25T23:31:00Z')), true, 'with no week date, Friday is Friday');
  campWeek = realWeek;
  assert.equal(finaleDow(), 5, 'absent = Friday');
  setupTree.meta.finaleDow = 4;
  assert.equal(finaleDow(), 4);
  setupTree.meta.finaleDow = 'soon';
  assert.equal(finaleDow(), 5, 'junk = Friday');
  delete setupTree.meta.finaleDow;
});

// ── compare-and-set: the other director got there first ──────────────

test('two remotes press at once: the loser is refused by the rules, re-reads, says so in a sentence, and follows the server', async () => {
  const db = await bootDirector();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  nowT += 5000;
  // another director's Next lands between this phone's tap and the server seeing it: the SDK echo of OUR write
  // is not confirmed, and the winner's write moves seq and shown under it
  db.beforeUpdate = () => {
    db.beforeUpdate = null;
    const cur = db.serverGet(REAL).ctl;
    const other = Object.assign({}, cur, { seq: cur.seq + 1, phase: 'live', cur: 0, shown: 1, at: nowT, sa: nowT });
    db.serverSet(REAL + '/ctl', other);
    db.serverSet(REAL + '/pub/g0', { place: N, e: { ['t' + (N - 1)]: { nm: 'Winner', p: 1, g: 0, s: 0, b: 0, v: 0, m: 0, c: 0 } } });
  };
  const r = await revealNext();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'refused');
  assert.ok(toasts.some((t) => t === 'Another director already showed ' + ordinal(N) + ' place.'), 'the sentence names the place, never a team: ' + toasts.join(' | '));
  assert.equal(confirmedReveal.real.ctl.seq, 2, 'the remote follows the server\'s ctl');
  assert.equal(confirmedReveal.real.ctl.shown, 1);
  assert.equal(revealInFlight.real, 0, 'nothing is left in flight');
  // and it can carry on from there: the next press is a normal one
  nowT += 5000;
  assert.equal((await revealNext({ quiet: true })).ok, true);
  assert.equal(confirmedReveal.real.ctl.shown, 2);
  afterDirector();
});

test('a Start that another director\'s newer Start replaced is followed, not fought', async () => {
  const db = await bootDirector();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  const first = confirmedReveal.real.ctl.id;
  nowT += 5000;
  db.beforeUpdate = () => {
    db.beforeUpdate = null;
    db.serverSet(REAL, { ctl: Object.assign({}, db.serverGet(REAL).ctl, { id: 'r9zzzzzz-0000', seq: 1, at: nowT, sa: nowT, startedAt: nowT }) });
  };
  const r = await revealNext();
  assert.equal(r.ok, false);
  assert.ok(toasts.some((t) => /started a new reveal/.test(t)), toasts.join(' | '));
  assert.notOk(confirmedReveal.real.ctl.id === first, 'the remote now follows the new reveal');
  assert.equal(revealFullFor('real'), null, 'and does not use the freeze of the old one');
  afterDirector();
});

test('rules not published: a write is refused and the re-read is refused too, so the remote says the reveal is not switched on, and offers no button that leads to a refusal', async () => {
  const db = await bootDirector();
  db.revokeRead(dbPath('revealPublic'));                    // the public path is not readable (old rules): the listener is cancelled
  await waitQuiet();
  assert.equal(revealDenied, true);
  assert.equal(revealRemoteModel().stage, 'off');
  assert.equal(revealRemoteModel().why, 'rules');
  const r = await revealStart();
  assert.equal(r.ok, false); assert.equal(r.code, 'rules');
  assert.ok(toasts.some((t) => /isn.t switched on yet/.test(t)));
  assert.equal(db.log2.filter((w) => w.verdict.ok).length, 0, 'nothing was sent');
  afterDirector();
});

// ── confirmed state: only what the server acknowledged ───────────────

test('the SDK\'s optimistic echo of this phone\'s own write is NOT confirmed; the acknowledged re-read is', async () => {
  const db = await bootDirector();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  const painted = [];
  revealPaint = (why) => painted.push({ why, seq: confirmedReveal.real && confirmedReveal.real.ctl.seq });
  nowT += 5000;
  const seqBefore = confirmedReveal.real.ctl.seq;
  const pending = revealNext({ quiet: true });
  // the fake (like the SDK) has already raised the local event with the new ctl, but the write is unacknowledged
  assert.ok(db.serverGet(REAL).ctl.seq > seqBefore, 'the database holds the new value');
  assert.equal(confirmedReveal.real.ctl.seq, seqBefore, 'but nothing on this phone has taken it as confirmed');
  assert.equal(revealRemoteView('real').phase, 'intro', 'every consumer still reads the confirmed state');
  assert.equal(revealBusy(), true, 'and an auto-update may not reload the phone');
  await pending;
  assert.equal(confirmedReveal.real.ctl.seq, seqBefore + 1, 'acknowledged, then re-read, then confirmed');
  assert.ok(painted.every((p) => p.seq === seqBefore || p.seq === seqBefore + 1), 'no screen ever saw a value that was not the confirmed one');
  afterDirector();
});

test('a counselor\'s phone, which never writes, takes every snapshot as confirmed at once', async () => {
  const db = bootReveal('viewer');
  initReveal();
  db.serverSet(REAL, { ctl: mkCtl({ seq: 2, cur: 0, shown: 1 }), pub: mkPub(1) });
  assert.equal(confirmedReveal.real.ctl.seq, 2);
  db.serverSet(REAL, { ctl: mkCtl({ seq: 3, cur: 1, shown: 2 }), pub: mkPub(2) });
  assert.equal(confirmedReveal.real.ctl.seq, 3);
  teardownReveal();
});

// ── the button recharges ─────────────────────────────────────────────

test('after a place the button is locked for the beat (name 3 s, score to 4.5 s): a tap sends nothing and says how long; Back is locked too; End never is', async () => {
  const db = await bootDirector();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  const sent = () => db.log2.filter((w) => w.verdict.ok).length;
  nowT += 100;
  assert.equal((await revealNext({ quiet: true })).ok, true, 'the intro has no beat: Next works at once');
  assert.equal(revealRemoteModel().back.state, 'first', 'at the first place Back is already unavailable, beat or no beat');
  nowT += 5000;
  assert.equal((await revealNext({ quiet: true })).ok, true);
  const before = sent();
  nowT += 1000;
  let r = await revealNext();
  assert.equal(r.ok, false); assert.equal(r.code, 'wait');
  assert.ok(toasts.some((t) => t === 'Wait 4 s. The big screen is still showing ' + ordinal(N - 1) + ' place.'), 'the wait is until the button is ready (4.5 s after the command): ' + toasts.join(' | '));
  assert.equal(sent(), before, 'nothing was sent');
  const m = revealRemoteModel();
  assert.equal(m.go.state, 'charging');
  assert.equal(m.go.kicker, 'Showing the name… 2', 'counting down the name');
  assert.equal(m.back.state, 'locked');
  assert.equal(m.back.sub, 'after the score');
  nowT += 2500;                                               // 3.5 s in: the score is on
  const m2 = revealRemoteModel();
  assert.equal(m2.go.kicker, 'Showing the score… 1');
  r = await revealBack({ quiet: true });
  assert.equal(r.code, 'wait', 'Back waits for the same beat');
  nowT += 1000;                                               // 4.5 s: ready
  assert.equal(revealRemoteModel().go.state, 'ready');
  assert.equal((await revealNext({ quiet: true })).ok, true);
  nowT += 10;
  assert.equal((await revealEnd({ quiet: true })).ok, true, 'End is never locked');
  assert.equal(confirmedReveal.real.ctl.phase, 'ended');
  afterDirector();
});

// ── a practice is a different node and never buzzes ──────────────────

test('a practice writes only its own pair of nodes, never touches real, never calls pushSendAlert, and End deletes its two nodes', async () => {
  const db = await bootDirector();
  const buzzes = [];
  const realAlert = typeof pushSendAlert === 'function' ? pushSendAlert : null;
  pushSendAlert = (o) => { buzzes.push(o); return Promise.resolve({ ok: true }); };
  const realConfigured = pushConfigured;
  pushConfigured = () => true;                                // phone alerts ARE live: still nothing for a practice
  assert.equal((await revealStart({ quiet: true })).ok, true, 'a real reveal first, so "untouched" means something');
  assert.equal(buzzes.length, 1, 'the real Start buzzed once');
  await waitQuiet();
  const realBefore = JSON.stringify([db.serverGet(REAL), db.serverGet(dbPath('revealFull/real'))]);
  const logFrom = db.log2.length;
  revealSetPractice(true);
  assert.equal(revealBuzzState('practice').available, false);
  assert.equal(revealBuzzState('practice').reason, 'Practice runs never buzz phones.');
  const rr = await revealStart({ practice: true, quiet: true });
  assert.equal(rr.ok, true, JSON.stringify(rr));
  assert.equal(rr.mode, 'practice');
  nowT += 5000; assert.equal((await revealRun('next', { mode: 'practice', quiet: true })).ok, true);
  nowT += 5000; assert.equal((await revealRun('next', { mode: 'practice', quiet: true })).ok, true);
  assert.equal(confirmedReveal.practice.ctl.shown, 2);
  assert.equal(confirmedReveal.practice.ctl.until, untilFor(nowT, true) - 10000 + 0 || confirmedReveal.practice.ctl.until, 'a practice lives two hours');
  assert.equal(confirmedReveal.practice.ctl.until, T0 + 2 * 3600 * 1000);
  nowT += 5000;
  assert.equal((await revealRun('end', { mode: 'practice', quiet: true })).ok, true);
  await waitQuiet();
  const keys = db.log2.slice(logFrom).filter((w) => w.verdict.ok).flatMap((w) => Object.keys(w.values));
  assert.ok(keys.length >= 4);
  keys.forEach((k) => assert.ok(/^reveal(Public|Full)\/practice(\/|$)/.test(k), 'a practice write outside its own nodes: ' + k));
  assert.equal(JSON.stringify([db.serverGet(REAL), db.serverGet(dbPath('revealFull/real'))]), realBefore, 'the real reveal is byte-identical');
  assert.equal(db.serverGet(PRACTICE), null, 'End practice deleted the public node…');
  assert.equal(db.serverGet(dbPath('revealFull/practice')), null, '…and the private one, so its real standings leave at once');
  assert.equal(confirmedReveal.practice, null);
  assert.equal(buzzes.length, 1, 'a practice never called pushSendAlert');
  const src = readFixture('../reveal.js');
  const body = src.slice(src.indexOf('function revealBuzzAfterStart('), src.indexOf('\n}\n', src.indexOf('function revealBuzzAfterStart(')));
  assert.ok(/if \(mode !== 'real'\) return/.test(body) && body.indexOf("mode !== 'real'") < body.indexOf('pushSendAlert'), 'the only path to pushSendAlert refuses a practice before it gets there');
  assert.equal((src.match(/pushSendAlert\(/g) || []).length, 1, 'and there is exactly one call site');
  pushSendAlert = realAlert; pushConfigured = realConfigured;
  afterDirector();
});

test('Buzz: a real Start buzzes everyone once when phone alerts are live; until then it is disabled with its reason and sends nothing', async () => {
  const db = await bootDirector();
  const buzzes = [];
  const realAlert = pushSendAlert, realConfigured = pushConfigured;
  pushSendAlert = (o) => { buzzes.push(o); return Promise.resolve({ ok: true, sent: 3 }); };
  pushConfigured = () => false;                               // phone alerts not live (as before Step 27)
  assert.deepEqual(revealBuzzState('real'), { available: false, on: false, forced: false, reason: 'Phone alerts are not switched on yet.' });
  assert.equal(revealRemoteModel().buzz.available, false, 'the remote reads the same');
  assert.equal((await revealStart({ quiet: true })).ok, true);
  assert.equal(buzzes.length, 0, 'no phone alerts, no buzz');
  // live: on by default for a real reveal, and switchable off
  pushConfigured = () => true;
  const s = revealBuzzState('real');
  assert.equal(s.available, true); assert.equal(s.on, true);
  revealSetBuzz(false);
  assert.equal(revealBuzzState('real').on, false);
  assert.equal((await revealStart({ quiet: true })).ok, true);
  assert.equal(buzzes.length, 0, 'switched off: no buzz');
  revealSetBuzz(true);
  const r = await revealStart({ quiet: true });
  assert.equal(r.ok, true);
  assert.deepEqual(await r.buzz, { ok: true, sent: 3 });
  assert.equal(buzzes.length, 1);
  assert.deepEqual(buzzes[0], { text: 'The standings reveal is starting', audience: 'all', urgent: false });
  pushSendAlert = realAlert; pushConfigured = realConfigured;
  afterDirector();
});

test('pushSendAlert with a text is a direct send (no composer, no confirm, never throws); without one it is still the composer', async () => {
  setMemberRole('editor');
  const posts = [];
  const realPost = pushPost, realConfigured = pushConfigured;
  pushConfigured = () => true;
  pushPost = async (path, body) => { posts.push({ path, body }); return { sent: 2, queued: 1, failed: 0, batches: [] }; };
  let asked = 0;
  confirm = () => { asked += 1; return true; };
  const r = await pushSendAlert({ text: 'The standings reveal is starting', audience: 'all', urgent: false });
  assert.deepEqual(r, { ok: true, sent: 2, queued: 1, failed: 0 });
  assert.equal(asked, 0, 'no confirm: the director already pressed Start');
  assert.equal(posts[0].path, '/notify');
  assert.deepEqual(posts[0].body, { camp: CAMP.id, kind: 'alert', text: 'The standings reveal is starting', audience: 'all', urgent: false });
  pushPost = async () => { throw new Error('network down'); };
  const realWarn = console.warn; console.warn = () => {};
  const bad = await pushSendAlert({ text: 'x' });
  console.warn = realWarn;
  assert.equal(bad.ok, false, 'a failure is an answer, not a throw');
  pushConfigured = () => false;
  assert.deepEqual(await pushSendAlert({ text: 'x' }), { ok: false, error: 'not-configured' });
  setMemberRole('viewer');
  pushConfigured = () => true;
  assert.deepEqual(await pushSendAlert({ text: 'x' }), { ok: false, error: 'not-editor' });
  pushPost = realPost; pushConfigured = realConfigured;
  confirm = () => true;
  setMemberRole(null);
});

// ── a director mid-reveal must not be reloaded ──────────────────────

test('revealBusy: any director while a real reveal is live (remote open or not) and while a command is in flight; never a counselor, a practice, or an ended reveal', async () => {
  const db = await bootDirector();
  assert.equal(revealBusy(), false, 'nothing running');
  assert.equal((await revealStart({ practice: true, quiet: true })).ok, true);
  assert.equal(revealBusy(), false, 'a practice does not hold the phone');
  assert.equal((await revealStart({ quiet: true })).ok, true);
  assert.equal(revealRemoteOpen(), false, 'the remote is not even open');
  assert.equal(revealBusy(), true, 'a live real reveal holds the phone');
  assert.equal(reloadBlocked(), true, 'and the auto-update waits (reloadBlocked asks revealBusy)');
  assert.ok(/revealBusy\(\)/.test(readFixture('../app.js').slice(readFixture('../app.js').indexOf('function reloadBlocked()'), readFixture('../app.js').indexOf('function reloadWhenSafe()'))));
  setMemberRole('viewer');
  assert.equal(revealBusy(), false, 'a counselor is never held');
  setMemberRole('editor');
  nowT += 5000;
  await revealEnd({ quiet: true });
  assert.equal(revealBusy(), false, 'ended: free to reload');
  afterDirector();
});

// ── the screen stays on ──────────────────────────────────────────────

test('the wake lock: held while a director\'s remote is open or a real reveal is live, taken back by the wake handler, kept when a clock ends, released after', async () => {
  const db = await bootDirector();
  const requests = [];
  const releases = [];
  const sentinel = () => { const s = { released: false, addEventListener: () => {}, release() { releases.push(1); this.released = true; } }; return s; };
  navigator.wakeLock = { request: async (kind) => { requests.push(kind); return sentinel(); } };
  wakeLockSentinel = null; wakeLockWanted = false; wakeLockPending = false;
  assert.equal(revealWakeNeeded(), false);
  revealSetRemoteOpen(true);
  await waitQuiet();
  assert.equal(revealWakeNeeded(), true);
  assert.deepEqual(requests, ['screen'], 'opening the remote asks for the lock');
  assert.equal(revealWakeHeld(), true);
  assert.equal(revealRemoteModel().wake, 'on');
  // a clock ending elsewhere must not drop it
  releaseWakeLockIfIdle = null;
  if (!wakeLockNeeded()) releaseWakeLock();
  assert.equal(revealWakeHeld(), true, 'wakeLockNeeded() counts the reveal');
  revealSetRemoteOpen(false);
  assert.equal(revealWakeHeld(), false, 'closing the remote lets the screen sleep');
  assert.equal(releases.length, 1);
  // a live real reveal holds it without the remote
  assert.equal((await revealStart({ quiet: true })).ok, true);
  await waitQuiet();
  assert.equal(revealWakeHeld(), true, 'a real reveal live on a director\'s phone');
  // the OS dropped it when the page hid; coming back asks again
  wakeLockSentinel = null;
  rearmWakeLock();
  await waitQuiet();
  assert.equal(revealWakeHeld(), true);
  nowT += 5000;
  await revealEnd({ quiet: true });
  await waitQuiet();
  assert.equal(revealWakeHeld(), false, 'End releases it');
  // a counselor's phone never asks
  setMemberRole('viewer');
  requests.length = 0;
  revealSyncWake();
  assert.equal(requests.length, 0);
  delete navigator.wakeLock;
  afterDirector();
});

test('a refused wake lock shows as "Screen may sleep" (wake: off), never as an error', async () => {
  const db = await bootDirector();
  navigator.wakeLock = { request: async () => { throw new Error('NotAllowedError'); } };
  wakeLockSentinel = null; wakeLockWanted = false; wakeLockPending = false;
  revealSetRemoteOpen(true);
  await waitQuiet();
  assert.equal(revealRemoteModel().wake, 'off');
  revealSetRemoteOpen(false);
  delete navigator.wakeLock;
  afterDirector();
});

// ── who may Start, and when ──────────────────────────────────────────

test('Start refuses a counselor, a view-only second tab, a phone that is not up to date and a connection that has only just come back', async () => {
  const db = await bootDirector();
  const sent = () => db.log2.filter((w) => w.verdict.ok).length;
  setMemberRole('viewer');
  assert.equal((await revealStart({ quiet: true })).code, 'viewer');
  assert.equal((await revealNext({ quiet: true })).code, 'viewer');
  setMemberRole('editor');
  tabWriter = false;
  assert.equal((await revealStart({ quiet: true })).code, 'view-only');
  tabWriter = true;
  dataEditPending = true;
  let r = await revealStart({ quiet: true });
  assert.equal(r.code, 'not-ready'); dataEditPending = false;
  pendingWrites = 1;
  assert.equal((await revealStart({ quiet: true })).code, 'not-ready'); pendingWrites = 0;
  fbConnected = false;
  assert.equal((await revealStart({ quiet: true })).code, 'offline'); fbConnected = true;
  revealOnConnectionChange(true);                              // the socket flipped just now
  assert.equal((await revealStart({ quiet: true })).code, 'not-ready', 'a socket that only looks alive is not trusted for ten seconds');
  nowT += 11000;
  assert.equal(revealStartGate().canStart, true);
  assert.equal(sent(), 0, 'nothing was written by any refusal');
  assert.equal((await revealStart({ quiet: true })).ok, true);
  afterDirector();
});

test('the ready screen\'s checks: games not yet scored today are named (a warning, never a gate), and the last score\'s time is carried', async () => {
  const db = await bootDirector();
  state.meta.lastDataChangeAt = new Date(T0 - 120000).toISOString();
  const g = revealStartGate();
  assert.equal(g.lastScoreAt, T0 - 120000);
  assert.ok(Array.isArray(g.unscored));
  assert.equal(g.canStart, true, 'unscored games never block a Start');
  afterDirector();
});

test('Start again while still at the intro: scores saved since the freeze are noticed, and a new Start replaces the old reveal', async () => {
  const db = await bootDirector();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  const first = confirmedReveal.real.ctl.id;
  assert.equal(revealRemoteModel().freezeStale, false, 'the freeze is tonight\'s standings');
  state.bonuses.b5 = { teamId: state.teams[N - 1].id, category: 'custom', label: 'late', points: 600, at: Date.parse('2026-01-01') };
  assert.equal(revealRemoteModel().freezeStale, true, 'a score saved after the freeze: offer Start again');
  nowT += 1000;
  const r = await revealStart({ quiet: true });
  assert.equal(r.ok, true);
  assert.notOk(confirmedReveal.real.ctl.id === first, 'a new reveal');
  assert.equal(confirmedReveal.real.pub, null, 'the new Start left no earlier place behind');
  assert.equal(revealRemoteModel().freezeStale, false);
  afterDirector();
});

test('a team renamed mid-reveal: places already shown keep the old name, later ones carry the new; the frozen numbers do not change', async () => {
  const db = await bootDirector();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  nowT += 5000;
  await revealNext({ quiet: true });                                          // last place shown
  const lastId = 't' + (N - 1);
  const oldName = state.teams[N - 1].name;
  state.teams[N - 1].name = 'Renamed';
  state.teams[N - 2].name = 'Renamed too';
  state.bonuses['b' + (N - 2)].points = 1;                                    // and a score that changes after the freeze
  nowT += 5000;
  await revealNext({ quiet: true });
  const pub = confirmedReveal.real.pub;
  assert.equal(pub.g0.e[lastId].nm, oldName, 'a shown place does not change');
  assert.equal(pub.g1.e['t' + (N - 2)].nm, 'Renamed too', 'the next one carries the name as it is now');
  assert.equal(pub.g1.e['t' + (N - 2)].p, SENTINEL_POINTS[N - 2], 'but the frozen points');
  afterDirector();
});

// ── the remote's model: every state of mockup 07c ────────────────────

test('the remote model maps the phase to the stage and the button\'s words: ready, intro, a place, a tie, the crown, champions, the table, ended', async () => {
  const db = await bootDirector();
  let m = revealRemoteModel();
  assert.equal(m.stage, 'ready');
  assert.equal(m.go.big, 'Start the reveal');
  assert.equal(m.back.state, 'hidden');
  revealSetPractice(true);
  assert.equal(revealRemoteModel().go.big, 'Start a practice');
  assert.equal(revealRemoteModel().practice, true);
  revealSetPractice(false);
  assert.equal((await revealStart({ quiet: true })).ok, true);
  m = revealRemoteModel();
  assert.equal(m.stage, 'intro');
  assert.equal(m.go.kicker, 'Reveal'); assert.equal(m.go.big, ordinal(N) + ' place', 'junior starts at 6th, senior at 4th');
  assert.equal(m.back.state, 'first'); assert.equal(m.back.sub, 'nothing before');
  assert.deepEqual(m.count, { shown: 0, total: N });
  nowT += 100;
  await revealNext({ quiet: true });
  nowT += 5000;
  m = revealRemoteModel();
  assert.equal(m.stage, 'live');
  assert.equal(m.go.kicker, 'Reveal'); assert.equal(m.go.big, ordinal(N - 1) + ' place');
  assert.equal(m.back.state, 'first', 'at the first place Back is disabled');
  assert.equal(m.back.sub, 'Already at ' + ordinal(N) + ' place');
  assert.deepEqual(m.count, { shown: 1, total: N });
  await revealNext({ quiet: true });
  nowT += 5000;
  m = revealRemoteModel();
  assert.equal(m.back.state, 'ready'); assert.equal(m.back.sub, 'show ' + ordinal(N) + ' again');
  for (let k = 2; k < N; k++) { await revealNext({ quiet: true }); nowT += 5000; }
  m = revealRemoteModel();
  assert.equal(m.go.kicker, 'Next'); assert.equal(m.go.big, 'Show the final table', 'a Wednesday: no crowning');
  await revealNext({ quiet: true }); nowT += 5000;
  m = revealRemoteModel();
  assert.equal(m.stage, 'table');
  assert.equal(m.go.kicker, 'All places shown'); assert.equal(m.go.big, 'End the reveal');
  assert.equal(m.back.sub, 'show 1st again');
  await revealEnd({ quiet: true });
  m = revealRemoteModel();
  assert.equal(m.stage, 'ended');
  assert.equal(m.go.kicker, 'Replaces tonight’s'); assert.equal(m.go.big, 'Start a new reveal');
  assert.equal(m.endedAt, nowT);
  afterDirector();
});

test('a tie reads "(tie)" on the button, and the offline face replaces both buttons\' words', async () => {
  const points = [900, 800, 800, 700, 600, 500].slice(0, state.teams.length);
  const db = await bootDirector({ points });
  assert.equal((await revealStart({ quiet: true })).ok, true);
  const groups = revealFullFor('real').groups;
  const tieIdx = groups.findIndex((g) => g.entries.length === 2);
  for (let k = 0; k < tieIdx; k++) { nowT += 5000; await revealNext({ quiet: true }); }
  nowT += 5000;
  assert.equal(revealRemoteModel().go.big, '2nd place (tie)');
  fbConnected = false;
  const off = revealRemoteModel();
  assert.equal(off.go.state, 'offline');
  assert.equal(off.go.kicker, 'Reconnecting…');
  assert.equal(off.go.big, 'Your taps would not reach the big screen');
  assert.equal(off.back.state, 'offline');
  fbConnected = true;
  afterDirector();
});

test('the Practice switch decides the mode only while nothing is active; a live real reveal wins; the up-next preview comes from revealFull with once() when the remote opens and is dropped when it closes', async () => {
  const db = await bootDirector();
  assert.equal(revealRemoteMode(), 'real');
  revealSetPractice(true);
  assert.equal(revealRemoteMode(), 'practice');
  assert.equal((await revealStart({ practice: true, quiet: true })).ok, true);
  assert.equal(revealRemoteMode(), 'practice');
  revealSetPractice(false);
  assert.equal(revealRemoteMode(), 'practice', 'a practice that is running keeps the remote');
  assert.equal((await revealStart({ quiet: true })).ok, true);
  assert.equal(revealRemoteMode(), 'real', 'a real Start takes over');
  // the private order is fetched when the remote opens, and gone when it closes
  revealForgetFull('real');
  assert.equal(revealRemoteModel().go.state, 'blocked', 'Next cannot know the next place without it');
  db.paths.length = 0;
  revealSetRemoteOpen(true);
  await waitQuiet();
  assert.ok(db.paths.includes(dbPath('revealFull/real')), 'once() on revealFull/real when the remote opens');
  assert.equal(revealFullFor('real').n, N);
  assert.equal(revealRemoteModel().go.state, 'ready');
  revealSetRemoteOpen(false);
  assert.equal(revealFullFor('real'), null, 'nothing from revealFull outlives the remote');
  afterDirector();
});

test('a counselor promoted to director mid-camp gets the up-next preview the first time the remote opens, with no reload; a demotion drops it', async () => {
  const db = await bootDirector();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  setMemberRole('viewer');
  assert.equal(revealFullFor('real'), null, 'a demoted phone holds no private order');
  setMemberRole('editor');
  revealSetRemoteOpen(true);
  await waitQuiet();
  assert.equal(revealFullFor('real').n, N, 'fetched by once() on opening');
  setMemberRole('viewer');
  assert.equal(revealRemoteOpen(), false);
  assert.equal(revealFullFor('real'), null);
  afterDirector();
});

// ── the public-node sweep ────────────────────────────────────────────

test('the public node never carries a member key, a director name or a hidden team\'s id, name or points: a full reveal, a Back, an early End and a practice, swept write by write', async () => {
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].slice(0, N);
  const db = await bootDirector();
  const sweep = (label, shownIdxs) => {
    // every key that may appear in the public node, serialized, with what is allowed to be in it
    const pub = writesTo(db.log2, 'revealPublic/').concat([]).map((w) => w.key + '=' + JSON.stringify(w.value)).join('\n');
    assert.ok(!pub.includes(ME) && !/jenn|example/i.test(pub), label + ': a member key or a director name is in the public node');
    assert.ok(!/startedBy|"by"|counselor/i.test(pub), label + ': an identity field');
    // hidden = every team whose group is not yet shown
    const full = revealFullFor(confirmedReveal.real ? 'real' : 'practice');
    const hidden = full.groups.filter((g) => !shownIdxs.includes(g.idx));
    hidden.forEach((g) => g.entries.forEach((e) => {
      assert.ok(!pub.includes('"' + e.id + '"') && !pub.includes(e.nm) && !pub.includes(String(e.p)), label + ': hidden team ' + e.id + ' / ' + e.nm + ' / ' + e.p + ' is in the public node');
    }));
  };
  assert.equal((await revealStart({ quiet: true })).ok, true);
  sweep('after Start', []);
  const shown = [];
  for (let k = 0; k < N; k++) {
    nowT += 5000;
    await revealNext({ quiet: true });
    shown.push(k);
    sweep('after place ' + k, shown.slice());
    if (k === 1) { nowT += 5000; await revealBack({ quiet: true }); sweep('after a Back', shown.slice()); nowT += 5000; await revealNext({ quiet: true }); sweep('after the replay', shown.slice()); }
  }
  nowT += 5000; await revealNext({ quiet: true }); sweep('after the table', shown.slice());
  nowT += 5000; await revealEnd({ quiet: true }); sweep('after End', shown.slice());
  // an early End: Start, one place, End: the rest never reaches the public node
  nowT += 1000;
  assert.equal((await revealStart({ quiet: true })).ok, true);
  nowT += 5000; await revealNext({ quiet: true });
  nowT += 5000; await revealEnd({ quiet: true });
  const lastStart = db.log2.map((w, i) => ({ w, i })).filter((x) => x.w.verdict.ok && x.w.values['revealPublic/real']).pop().i;
  const early = db.log2.slice(lastStart).filter((w) => w.verdict.ok).flatMap((w) => Object.keys(w.values).filter((k) => k.startsWith('revealPublic/')).map((k) => k + '=' + JSON.stringify(w.values[k]))).join('\n');
  assert.ok(!early.includes(String(SENTINEL_POINTS[0])) && !early.includes('Alpha'), 'the early End: 1st place never went public');
  const publicTree = JSON.stringify(db.serverGet(dbPath('revealPublic')));
  assert.ok(!publicTree.includes(ME), 'and the stored public node holds no key');
  // a practice: its public node is the same, from the same freeze
  nowT += 1000;
  revealSetPractice(true);
  assert.equal((await revealStart({ practice: true, quiet: true })).ok, true);
  nowT += 5000; await revealRun('next', { mode: 'practice', quiet: true });
  const practiceTree = JSON.stringify(db.serverGet(PRACTICE));
  assert.ok(!practiceTree.includes(ME) && !practiceTree.includes(String(SENTINEL_POINTS[0])), 'a practice at its first place holds nothing of 1st');
  // the private node is the ONE place the key is written
  const full = JSON.stringify(db.serverGet(dbPath('revealFull/practice')));
  assert.ok(full.includes(ME), 'revealFull records who started it');
  afterDirector();
});

test('reveal.js writes only to revealPublic/<mode>(/ctl | /pub/g<k>) and revealFull/<mode>, and only the builders know those paths', () => {
  const src = readFixture('../reveal.js').replace(/\/\/[^\n]*/g, '');
  const keys = [...src.matchAll(/['"`]((?:revealPublic|revealFull)\/[^'"`]*)['"`]/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, '<x>'));
  keys.forEach((k) => assert.ok(/^reveal(Public|Full)\/(<x>|practice|real)?(\/ctl|\/pub\/g<x>)?$|^revealPublic\/<x>$|^revealPublic\/<x>\/ctl$|^revealPublic\/<x>\/pub\/g<x>$/.test(k) || /^reveal(Public|Full)\/$/.test(k) || /^reveal(Public|Full)\/(real|practice)$/.test(k), 'an unexpected path: ' + k));
  assert.ok(!/\.set\(|\.remove\(|\.transaction\(/.test(src.replace(/revealThumbs\.set\(/g, '')), 'no set, remove or transaction (revealThumbs is an in-memory Map)');
  assert.equal((src.match(/\.update\(/g) || []).length, 2, 'exactly two writers: a command and the retirement, each one multi-path update()');
});

// ── until across the clock changes, the epoch, and the first pull ────

test('Start\'s until is 08:00 camp time the next day across both clock changes, after midnight, and two hours for a practice', async () => {
  const cases = [
    ['2027-03-14T00:30:00Z', '2027-03-14T12:00:00Z', 'spring forward: Saturday evening → Sunday 08:00 EDT'],
    ['2027-11-07T00:30:00Z', '2027-11-07T13:00:00Z', 'fall back: Saturday evening → Sunday 08:00 EST'],
    ['2027-06-24T04:30:00Z', '2027-06-25T12:00:00Z', 'started after midnight: still the NEXT calendar day'],
  ];
  for (const [start, until, why] of cases) {
    const db = await bootDirector({ now: Date.parse(start) });
    const r = await revealStart({ quiet: true });
    assert.equal(r.ok, true, why + ' ' + JSON.stringify(r));
    assert.equal(confirmedReveal.real.ctl.until, Date.parse(until), why);
    afterDirector();
  }
  const db = await bootDirector({ now: Date.parse('2027-06-23T23:31:00Z') });
  revealSetPractice(true);
  assert.equal((await revealStart({ practice: true, quiet: true })).ok, true);
  assert.equal(confirmedReveal.practice.ctl.until, Date.parse('2027-06-24T01:31:00Z'), 'two hours, well inside the rules\' three');
  afterDirector();
});

test('a week with an epoch stamps it on the ctl (phones ignore a reveal from another year); a legacy week writes none', async () => {
  const db = await bootDirector();
  state.meta.epoch = 'w20270621';
  assert.equal((await revealStart({ quiet: true })).ok, true);
  assert.equal(confirmedReveal.real.ctl.epoch, 'w20270621');
  assert.ok(revealMirrorView(), 'and this phone, in that year, reads it');
  delete state.meta.epoch;
  assert.equal(revealMirrorView(), null, 'a phone in another year does not');
  afterDirector();
});

test('no command before the first server answer, and a command with the connection down is refused, never queued', async () => {
  nowT = T0;
  const db = bootReveal('editor');
  authUser = { email: 'jenn@example.com' };
  Date.now = () => nowT; db.now = () => nowT;
  const log = []; withRulesModel(db, log);
  clearTimeout(pushTimer); pushTimer = null; dataEditPending = false;
  seedStandings(SENTINEL_POINTS.slice(0, N));
  initReveal();                                                           // listener attached, but no answer yet (loaded is false until it lands)
  revealLoaded.real = false;
  assert.equal((await revealStart({ quiet: true })).code, 'loading', 'Start would not know whether a reveal is already live');
  revealLoaded.real = true;
  fbConnected = false;
  assert.equal((await revealStart({ quiet: true })).code, 'offline');
  assert.equal(log.length, 0, 'nothing was handed to the SDK, so nothing is queued to land late');
  fbConnected = true;
  afterDirector();
});

test('a command in flight is never doubled: a second tap while the first is unacknowledged sends nothing', async () => {
  const db = await bootDirector();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  nowT += 5000;
  const first = revealNext({ quiet: true });
  const second = await revealNext({ quiet: true });
  assert.equal(second.code, 'busy');
  assert.equal((await first).ok, true);
  assert.equal(db.log2.filter((w) => w.verdict.ok && Object.keys(w.values).some((k) => /\/pub\/g0$/.test(k))).length, 1, 'one place published, once');
  afterDirector();
});

test('the hooks into app.js are the ones this file relies on: the connection hook is wired, and nothing else reads a reveal from state', () => {
  const app = readFixture('../app.js');
  const conn = app.slice(app.indexOf("ref('.info/connected')"), app.indexOf('// Count listener lives here'));
  assert.ok(conn.includes('revealOnConnectionChange('), 'a Start waits out a fresh connection');
  assert.ok(/function wakeLockNeeded\(\)/.test(app) && !/!anyTimerRunning\(\)\) releaseWakeLock/.test(app), 'every release site asks wakeLockNeeded');
  const src = readFixture('../reveal.js');
  assert.ok(!/state\.reveal|SYNC_KEYS/.test(src), 'a reveal never lives in synced state');
});

// ── R2: a team's own look in a shown place (owner's decisions item 7) ───────────────────────────────
// The switch ships OFF; with it ON the published group of the place being shown carries the look of ITS teams
// only; against the rules that predate R2 a refused branded place is sent once more plain.

const KEYCAP = (i) => (i + 1) + '️⃣';
const BIG_A = 'data:image/jpeg;base64,' + 'A'.repeat(1000);     // an all-'A' thumbnail: no id, name or number can match it by chance
const BIG_B = 'data:image/jpeg;base64,' + 'B'.repeat(1000);
function giveLooks() {
  state.teams.forEach((t, i) => {
    if (i === N - 1) t.emoji = '🦉';                                  // the first place shown carries a look R1 knows nothing about
    if (i === 0) { t.color = 'teal'; t.emoji = '🦊'; t.photoV = 3; TEAM_PHOTO_MEM.set(t.id + ':3', BIG_A); revealThumbs.set(t.id, { v: 3, data: BIG_A }); }
    else if (i === 1) { t.plain = true; t.emoji = KEYCAP(1); t.short = 'Team 2'; }
    else if (i === 2) { t.color = 'purple'; }
  });
}
// the serialized writes of a whole reveal, with the rules model in front
async function walkReveal() {
  const db = await bootDirector();
  giveLooks();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  for (let k = 0; k < N; k++) { nowT += 5000; assert.equal((await revealNext({ quiet: true })).ok, true, 'place ' + k); }
  nowT += 5000; await revealNext({ quiet: true });
  nowT += 5000; await revealEnd({ quiet: true });
  return db;
}
// (the reveal id is random per Start: it is the one thing two runs may differ in)
const serializedWrites = (db) => JSON.stringify(db.log2.filter((w) => w.verdict.ok).map((w) => w.values)).replace(/r[a-z0-9]{6,12}-[a-z0-9]{4}/g, 'RID');

test('R2 switch OFF: a reveal writes exactly what it wrote before R2, whatever looks the teams have', async () => {
  assert.equal(REVEAL_BRANDING_LIVE, false, 'ships off');
  const withLooks = serializedWrites(await walkReveal());
  afterDirector();
  const db2 = await bootDirector();                                  // the same reveal, teams with no look at all
  state.teams.forEach((t) => { delete t.color; delete t.emoji; delete t.photoV; delete t.plain; });
  assert.equal((await revealStart({ quiet: true })).ok, true);
  for (let k = 0; k < N; k++) { nowT += 5000; await revealNext({ quiet: true }); }
  nowT += 5000; await revealNext({ quiet: true });
  nowT += 5000; await revealEnd({ quiet: true });
  assert.equal(withLooks, serializedWrites(db2), 'byte for byte');
  assert.ok(!/"(em|pl|ph)":/.test(withLooks));
  afterDirector();
});

test('R2 switch ON: the look rides only in a SHOWN place\'s public entry; never at Start, never in revealFull, never for a team not yet shown', async () => {
  const db = await bootDirector();
  REVEAL_BRANDING_LIVE = true;
  giveLooks();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  const startText = JSON.stringify(db.log2.filter((w) => w.verdict.ok).map((w) => w.values));
  assert.ok(!/"(k|em|pl|ph)":/.test(startText), 'a Start carries no look at all (the freeze names every team, the public node none)');
  const publicWrites = () => writesTo(db.log2, 'revealPublic/').filter((w) => /\/pub\/g\d$/.test(w.key));
  const seen = [];
  for (let k = 0; k < N; k++) {
    nowT += 5000;
    assert.equal((await revealNext({ quiet: true })).ok, true);
    const text = JSON.stringify(publicWrites().map((w) => w.value));
    // a team's look appears in the node only from the place it is shown in
    const full = revealFullFor('real');
    full.groups.forEach((g) => g.entries.forEach((e) => {
      const gone = g.idx > k;
      const tn = Number(e.id.slice(1));
      if (tn === 0 && gone) assert.ok(!text.includes(BIG_A), 'the photo of a team whose place is still hidden is not public (after place ' + k + ')');
      if (tn === 0 && !gone) assert.ok(text.includes(BIG_A), 'and it is public once its place is shown');
    }));
    seen.push(k);
  }
  const entries = {};
  publicWrites().forEach((w) => Object.keys(w.value.e).forEach((t) => { entries[t] = w.value.e[t]; }));
  assert.deepEqual({ k: entries.t0.k, em: entries.t0.em, ph: entries.t0.ph, pl: entries.t0.pl }, { k: 'teal', em: '🦊', ph: BIG_A, pl: undefined });
  assert.deepEqual({ k: entries.t1.k, em: entries.t1.em, pl: entries.t1.pl, ph: entries.t1.ph }, { k: undefined, em: KEYCAP(1), pl: true, ph: undefined });
  assert.equal(entries.t2.k, 'purple'); assert.ok(!('em' in entries.t2), 'the camp\'s printed mascot is never published as a team\'s own emoji');
  if (N > 4) assert.deepEqual(Object.keys(entries.t3).sort(), ['b', 'c', 'g', 'm', 'nm', 'p', 's', 'v'], 'a team with no look of its own carries none');
  const fullText = JSON.stringify(db.serverGet(dbPath('revealFull/real')));
  assert.ok(!/"(em|pl|ph)":/.test(fullText) && !fullText.includes(BIG_A), 'revealFull never carries a look');
  assert.ok(db.log2.every((w) => w.verdict.ok), 'every write passed the R2 model');
  afterDirector();
});

test('R2: the thumbnail is the current photo version\'s only, and nothing is sent for a photo that has not been made', async () => {
  await bootDirector();
  REVEAL_BRANDING_LIVE = true;
  giveLooks();
  assert.equal(revealBrandOf('t0').ph, BIG_A);
  state.teams[0].photoV = 4;                                          // a newer photo was uploaded: the old thumbnail is not it
  assert.ok(!('ph' in revealBrandOf('t0')), 'a thumbnail of another version is never sent');
  state.teams[0].photoV = 3;
  revealThumbs.set('t0', { v: 3, data: 'https://evil.example/x.png' });
  assert.ok(!('ph' in revealBrandOf('t0')), 'a thumbnail that is not an inline image is never sent');
  revealThumbs.set('t0', { v: 3, data: 'data:image/jpeg;base64,' + 'A'.repeat(REVEAL_PHOTO_MAX) });
  assert.ok(!('ph' in revealBrandOf('t0')), 'over the cap');
  delete state.teams[0].photoV;
  revealThumbs.set('t0', { v: 3, data: BIG_A });
  assert.ok(!('ph' in revealBrandOf('t0')), 'no photo on the record: no thumbnail');
  assert.ok(!/photoV/.test(JSON.stringify(revealBrandOf('t1'))), 'the version number itself is never published');
  afterDirector();
});

test('R2: closing the remote and a demotion drop every thumbnail; with no canvas preparing is a no-op', async () => {
  await bootDirector();
  REVEAL_BRANDING_LIVE = true;
  giveLooks();
  revealSetRemoteOpen(true);
  assert.ok(revealThumbs.size > 0, 'prepare is a no-op here (no canvas) and kept what the test seeded');
  revealSetRemoteOpen(false);
  assert.equal(revealThumbs.size, 0, 'closing the remote drops them');
  giveLooks();
  setMemberRole('viewer'); revealOnRoleChanged();
  assert.equal(revealThumbs.size, 0, 'a demotion drops them');
  afterDirector();
});

test('R2: the reveal cache holds no photo, so six thumbnails never cost it its instant paint', async () => {
  const db = await bootDirector();
  REVEAL_BRANDING_LIVE = true;
  giveLooks();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  for (let k = 0; k < N; k++) { nowT += 5000; await revealNext({ quiet: true }); }   // Alpha (the photo) is the last place shown
  assert.ok(JSON.stringify(confirmedReveal.real).includes(BIG_A), 'the confirmed node holds the thumbnail');
  revealStoreCache();
  const cached = localStorage.getItem(lsKey(REVEAL_CACHE_KEY));
  assert.ok(cached, 'the cache is written');
  assert.ok(!cached.includes('"ph"') && !cached.includes(BIG_A), 'without ph');
  assert.ok(cached.includes('"nm"'), 'but with names and numbers');
  assert.ok(JSON.stringify(confirmedReveal.real).includes(BIG_A), 'the in-memory node still has it for this session');
  void db;
  afterDirector();
});

test('R2 against the rules live before it: a branded place is refused, the same place is sent plain once, and every later place goes plain with no second refusal', async () => {
  const db = await bootDirector();
  REVEAL_BRANDING_LIVE = true; rulesEra = 'r1';
  giveLooks();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  nowT += 5000;
  const r = await revealNext({ quiet: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const refused = db.log2.filter((w) => !w.verdict.ok);
  assert.equal(refused.length, 1, 'exactly one refusal: the branded first place');
  assert.ok(/unknown field/.test(refused[0].verdict.why), refused[0].verdict.why);
  assert.equal(revealBrandRefused, true);
  assert.equal(confirmedReveal.real.ctl.shown, 1, 'the place went out');
  for (let k = 1; k < N; k++) { nowT += 5000; assert.equal((await revealNext({ quiet: true })).ok, true); }
  assert.equal(db.log2.filter((w) => !w.verdict.ok).length, 1, 'still one refusal in the whole reveal');
  nowT += 5000; assert.equal((await revealNext({ quiet: true })).ok, true);
  nowT += 5000; assert.equal((await revealEnd({ quiet: true })).ok, true);
  assert.ok(!/"(em|pl|ph)":/.test(serializedWrites(db)), 'no look in any accepted write');
  assert.ok(!toasts.some((t) => /rules|isn.t switched on/i.test(t)), 'the director is never told anything: ' + toasts.join(' | '));
  afterDirector();
});

test('R2: a refusal that is a RACE (another director moved the reveal) is never retried plain, and does not turn branding off', async () => {
  const db = await bootDirector();
  REVEAL_BRANDING_LIVE = true;
  giveLooks();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  nowT += 5000;
  db.beforeUpdate = () => {
    db.beforeUpdate = null;
    const cur = db.serverGet(REAL).ctl;
    db.serverSet(REAL + '/ctl', Object.assign({}, cur, { seq: cur.seq + 1, phase: 'live', cur: 0, shown: 1, at: nowT, sa: nowT }));
    db.serverSet(REAL + '/pub/g0', { place: N, e: { ['t' + (N - 1)]: { nm: 'Winner', p: 1, g: 0, s: 0, b: 0, v: 0, m: 0, c: 0 } } });
  };
  const sendsBefore = db.log2.length;
  const r = await revealNext({ quiet: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'refused');
  assert.equal(db.log2.length - sendsBefore, 1, 'one send, no retry');
  assert.equal(revealBrandRefused, false, 'a race says nothing about the rules');
  afterDirector();
});

test('R2: a refusal when the re-read is refused too (the rules are not published at all) is not retried, and branding stays on for when they are', async () => {
  const db = await bootDirector();
  REVEAL_BRANDING_LIVE = true; rulesEra = 'r1';
  giveLooks();
  assert.equal((await revealStart({ quiet: true })).ok, true);
  nowT += 5000;
  const ref = db.ref;
  db.ref = (p) => {
    const r = ref(p);
    if (String(p).endsWith('/revealPublic/real')) r.once = () => { const e = new Error('PERMISSION_DENIED'); e.code = 'PERMISSION_DENIED'; return Promise.reject(e); };
    return r;
  };
  const before = db.log2.length;
  const r = await revealNext({ quiet: true });
  assert.equal(r.ok, false);
  assert.equal(db.log2.length - before, 1, 'one send only');
  assert.equal(revealBrandRefused, false);
  afterDirector();
});

test('R2: only the builders know where a look goes: reveal.js adds em / pl / ph nowhere but revealGroupWire, and the Start and revealFull builders never pass a brand', () => {
  const src = readFixture('../reveal.js').replace(/\/\/[^\n]*/g, '');
  assert.ok(/revealGroupWire\(group, nameOf, brandOf\)/.test(src));
  assert.equal((src.match(/revealGroupWire\(/g) || []).length, 3, 'the definition, revealFullWire\'s call and the published group\'s call');
  assert.ok(/revealGroupWire\(grp\)/.test(src), 'revealFull\'s group is built with no brand');
  assert.ok(/revealGroupWire\(grp, o\.nameOf, o\.brandOf\)/.test(src), 'only the published group takes one');
  assert.ok(/let REVEAL_BRANDING_LIVE = false;/.test(src), 'ships off');
});
