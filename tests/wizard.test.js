// The new-year wizard's ENGINE (setup-rebuild-spec §11.3, §7.3, §6.11; build step 28, session 1). Owner-only: the claim, the
// take-over, the verified archive, ONE atomic clear (exactly the listed paths, never members/*), resume at each step, Undo the new-year
// setup, the device reset on a new epoch, the setup engine's stranding, the history filter. Driven against the in-memory database with
// the real engines past their first snapshot. The camp-wide rules for all of it are proven in tests/emulator/wizard-client.mjs.
// Runs under the senior profile too (wizard.senior.test.js evals this file).

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const WZ_ROOT = CAMP.dbRoot;
const WZ_OWNER = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
const WZ_JENN = { email: 'jenn@example.com', emailVerified: true };
const WZ_QUIET = { campRunning: false };
const wzClone = (v) => JSON.parse(JSON.stringify(v));
const wzIsNull = (v, why) => assert.ok(v === null, (why || 'expected null') + ' — got ' + JSON.stringify(v));
const wzNe = (a, b, why) => assert.ok(a !== b, why || ('expected different values, both ' + JSON.stringify(a)));
// A real Sunday near today in camp time (a camp week can only start on one).
function wzSunday(offsetDays) {
  const t = campDateStr().split('-').map(Number);
  const d = new Date(Date.UTC(t[0], t[1] - 1, t[2] + (offsetDays || 0)));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
const WZ_SECTIONS = CAMP.features && CAMP.features.electives ? ['schedule', 'meals', 'verses', 'cleanup', 'electives'] : ['schedule', 'meals', 'verses', 'cleanup'];

// The week as the database holds it with every section edited here (the seed, round-tripped).
function wzSetupTree() {
  const db = makeFakeRtdb();
  db.serverSet('x', mergeSeed(null, buildSeed(CAMP, WZ_SECTIONS), WZ_SECTIONS, { at: 1700000000000, byKey: OWNER_MEMBER_KEY, from: 'camps.js@v1' }));
  return db.serverGet('x');
}

async function wzSetup(o) {
  const opt = o || {};
  freshState();
  authUser = opt.user || WZ_OWNER;
  setMemberRole(opt.role || 'editor');
  memberName = 'Patrick';
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick' }, 'jenn@example,com': { role: 'editor', name: 'Jenn Reed' } };
  memberDirectoryLoaded = true;
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  window.firebase = makeFakeFirebase(db);
  fbConnKnown = true; fbConnected = true;
  rpLastAt = 0; rpLastAutoAt = 0; rpWaitMs = 40; setupPushMs = 40;
  localStorage.removeItem(lsKey(RP_OUTBOX_KEY));
  localStorage.removeItem(lsKey(SETUP_KEY));
  localStorage.removeItem(lsKey(WIZARD_DRAFT_KEY));
  localStorage.removeItem(lsKey(EPOCH_SEEN_KEY));
  wizardDraft = null; wizardCommitInFlight = false; wizardClaimWroteAt = 0; wizardAnswersSentAt = 0; wizardAnswersDirty = false;
  setupRef = null; setupReady = false; setupDenied = false; setupWriteRefused = false;
  setupTree = normalizeSetup({}); setupBase = null; setupBaseAt = 0; setupBootBase = null; setupLast = null;
  setupPending = 0; clearTimeout(setupPushTimer); setupPushTimer = null; setupRefetchOwed = false;
  setupQuarantine = {}; setupClashes = []; setupEdited = {}; setupRev = 0;
  undoClear();
  delete state._cfgBase; delete state._cfgNotes;
  configReady = false; cfgFirstPending = null; remoteReady = false; syncDenied = false;
  // last year's data
  const games = allGames();
  state.results = { [games[0].id]: { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 1 }, [games[1].id]: { medals: { gold: 't0', silver: 't2', bronze: 't1' }, savedAt: 2 } };
  state.bonuses = { b1: { teamId: 't1', category: 'custom', label: 'Spirit', points: 5, at: '2026-07-23T22:00:00.000Z' } };
  state.announcements = { a1: { id: 'a1', text: 'Hello', at: new Date().toISOString(), by: 'x', ttlMs: 3600000 } };
  state.notice = Object.assign({}, state.notice, { status: 'posted', title: 'Cleanup', intro: 'Go' });
  state.teams[0].counselor = 'Last Year Lee';
  state.teams[0].photoV = 3;
  state.meta.lastDataChangeAt = '2026-07-24T20:00:00.000Z';
  db.serverSet(dbPath('state'), syncedSnapshot());
  db.serverSet(dbPath('config'), state.config);
  db.serverSet(dbPath('setup'), opt.setup === null ? {} : (opt.setup || wzSetupTree()));
  db.serverSet(dbPath('members'), {
    [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick', addedBy: 'seed', addedAt: '2026-01-01', teamId: 't0' },
    'jenn@example,com': { role: 'editor', name: 'Jenn Reed', addedBy: 'seed', addedAt: '2026-01-01', teamId: 't1' },
    'sam@example,com': { role: 'viewer', name: 'Sam', addedBy: 'seed', addedAt: '2026-01-01', teamId: 't2' },
    'broken@example,com': { role: 'viewer', name: 'Broken', teamId: 't0' }, // a hand-seeded row with no addedBy / addedAt
    'free@example,com': { role: 'viewer', name: 'Free', addedBy: 'seed', addedAt: '2026-01-01' },
  });
  db.serverSet(dbPath('campers'), { t0: { c1: { name: 'Kid', ord: 10 } } });
  db.serverSet(dbPath('accessRequests'), { 'new@example,com': { name: 'New Person', at: 1700000000000 }, 'new2@example,com': { name: 'Two', at: 1700000000001 } });
  db.serverSet(dbPath('revealPublic'), { real: { ctl: { v: 1, id: 'x' }, pub: {} } });
  db.serverSet(dbPath('revealFull'), { real: { r: 'x' } });
  fbRef = db.ref(dbPath('state'));
  fbConfigRef = db.ref(dbPath('config'));
  setupRef = db.ref(dbPath('setup'));
  fbRef.on('value', (snap) => handleRemoteSnapshot(snap.val()));
  attachConfigListener();
  attachSetupListener();
  db.deliverFirstSnapshots();
  flushPendingPush();
  await waitUntil(() => remoteReady && configReady && setupReady, 'all three engines to pass their first pull');
  await waitQuiet();
  return db;
}

function wzTeardown() {
  delete window.FIREBASE_CONFIG;
  delete window.firebase;
  fbRef = null; fbConfigRef = null; setupRef = null;
  fbConnKnown = false; fbConnected = false;
  remoteReady = false; configReady = false; setupReady = false;
  rpWaitMs = RP_WAIT_MS; setupPushMs = SETUP_PUSH_MS;
  clearTimeout(setupPushTimer); setupPushTimer = null;
  clearTimeout(pushTimer); pushTimer = null;
  clearTimeout(pushConfigTimer); pushConfigTimer = null;
  clearTimeout(wizardAnswersTimer); wizardAnswersTimer = null;
  wizardCommitInFlight = false; wizardDraft = null; wizardOpenNow = false;
  dataEditPending = false;
  undoClear();
  setMemberRole(null);
  authUser = null; memberDirectory = null; memberDirectoryLoaded = false; memberName = null;
  setupTree = normalizeSetup({}); setupRev++;
  localStorage.removeItem(lsKey(RP_OUTBOX_KEY));
  localStorage.removeItem(lsKey(SETUP_KEY));
  localStorage.removeItem(lsKey(WIZARD_DRAFT_KEY));
  localStorage.removeItem(lsKey(EPOCH_SEEN_KEY));
  localStorage.removeItem(WIZARD_DEVICE_KEY);
}

async function wzSettle() {
  await waitQuiet();
  await waitUntil(() => pendingWritesTotal() === 0 && !hasUnconfirmedLocalWork() && !pushTimer && !pushConfigTimer && !setupPushTimer, 'every write to be acknowledged');
}

// Start, pick a date, save last year, and stand at step 4: what every later case builds on.
async function wzToStep4(db) {
  const started = await wizardStart(WZ_QUIET);
  assert.equal(started.ok, true, JSON.stringify(started));
  await waitUntil(() => wizardModel().state === 'mine', 'the claim to arrive as mine');
  wizardAnswer({ weekStart: '2027-07-18' });
  assert.equal((await wizardSetStep(3)).ok, true);
  const a = await wizardArchive();
  assert.equal(a.ok, true, JSON.stringify(a));
  await waitUntil(() => wizardModel().claim && wizardModel().claim.archiveId === a.rid, 'the claim to carry the archive id');
  assert.equal((await wizardSetStep(4)).ok, true);
  await waitUntil(() => wizardModel().claim.step === 4, 'step 4');
  return a;
}

const wzServer = (db, p) => db.serverGet(WZ_ROOT + '/' + p);
const wzUpdates = (db) => db.log.filter((l) => l.kind === 'update');

// ── pure pieces ──────────────────────────────────────────────────────

test('answers: a Sunday or nothing, every carry item keep|clear with the spec\'s defaults, junk takes the default', () => {
  assert.equal(wizardIsSunday('2027-07-18'), true);
  assert.equal(wizardIsSunday('2027-07-19'), false);
  assert.equal(wizardIsSunday('2027-02-30'), false);
  assert.equal(wizardIsSunday('Jul 18'), false);
  const d = wizardNormAnswers({});
  assert.equal(d.weekStart, '');
  assert.equal(d.double, 'same');
  assert.deepEqual(d.carry, { schedule: 'keep', games: 'keep', teams: 'keep', counselors: 'clear', photos: 'clear', cleanup: 'keep', meals: 'clear', verses: 'clear', stations: 'keep', stationPeople: 'clear', memberTeams: 'clear' });
  const n = wizardNormAnswers({ weekStart: '2027-07-20', double: { fromDow: 9 }, carry: { meals: 'keep', verses: 'maybe', bogus: 'clear' }, extra: 1 });
  assert.equal(n.weekStart, '', 'a Tuesday is no camp start');
  assert.equal(n.double, 'same', 'a window that is not one is "same"');
  assert.equal(n.carry.meals, 'keep');
  assert.equal(n.carry.verses, 'clear', 'a junk value takes the default');
  assert.equal(n.carry.bogus, undefined);
  assert.equal(wizardNormAnswers({ double: 'none' }).double, 'none');
  assert.deepEqual(wizardNormAnswers({ double: { fromDow: 3, fromMin: 600, toDow: 4, toMin: 0 } }).double, { fromDow: 3, fromMin: 600, toDow: 4, toMin: 0 });
  assert.equal(wizardNormAnswers({ double: { fromDow: 4, fromMin: 600, toDow: 3, toMin: 0 } }).double, 'same', 'ends before it starts');
});

test('"same as last year" is the legacy Thursday 5 PM until the end of Friday, in the one shape camp-core reads', () => {
  const v = wizardDoubleValue('same', { epoch: '', double: undefined });
  assert.deepEqual(v, { fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 });
  // camp-core resolves it, for last summer's week, to exactly the legacy window
  const win = doubleWindowFor({ epoch: 'w20260101', weekStart: '2026-07-19', double: v });
  assert.equal(win.start, DOUBLE_WINDOW_LEGACY.start);
  assert.equal(win.end, DOUBLE_WINDOW_LEGACY.end);
  assert.equal(wizardDoubleValue('none', {}), null);
  assert.deepEqual(wizardDoubleValue('same', { epoch: 'w20270101', double: { fromDow: 3, fromMin: 0, toDow: 4, toMin: 0 } }), { fromDow: 3, fromMin: 0, toDow: 4, toMin: 0 }, 'a later year\'s "same" is what that year held');
  assert.equal(wizardDoubleValue('same', { epoch: 'w20270101' }), null);
});

test('the new epoch is w<date> in camp time, with -2… when that is today\'s own and taken', () => {
  assert.equal(wizardNewEpoch('2027-04-05', ''), 'w20270405');
  assert.equal(wizardNewEpoch('2027-04-05', 'w20270405'), 'w20270405-2');
  assert.ok(WIZARD_EPOCH_RE.test(wizardNewEpoch('2027-04-05', 'w20270405-2')), 'the rules\' own pattern');
});

test('a claim is read as exactly its shape: step 1-5, a key, a time, an epoch; junk is no claim', () => {
  const ok = { step: 3, byKey: 'o@x,com', at: 1700000000000, fromEpoch: 'legacy', archiveId: 'rp-archive-pre20261101-ab12', answers: JSON.stringify({ dev: 'device-abc123', weekStart: '2027-07-18', double: 'none', carry: { meals: 'keep' } }) };
  const c = wizardClaimOf({ meta: { wizard: ok } });
  assert.equal(c.step, 3);
  assert.equal(c.dev, 'device-abc123');
  assert.equal(c.answers.weekStart, '2027-07-18');
  assert.equal(c.answers.double, 'none');
  assert.equal(c.answers.carry.meals, 'keep');
  assert.equal(c.answers.carry.verses, 'clear');
  [{ step: 6 }, { step: 0 }, { byKey: 5 }, { at: 0 }, { fromEpoch: '' }, { fromEpoch: 'x'.repeat(41) }].forEach((bad) => assert.equal(wizardClaimOf({ meta: { wizard: Object.assign({}, ok, bad) } }), null, JSON.stringify(bad)));
  assert.equal(wizardClaimOf({ meta: { wizard: 'x' } }), null);
  assert.equal(wizardClaimOf({ meta: {} }), null);
  assert.equal(wizardClaimOf(null), null);
  const loose = wizardClaimOf({ meta: { wizard: Object.assign({}, ok, { archiveId: '../../x', answers: '{not json' }) } });
  assert.equal(loose.archiveId, '', 'an archive id that is not a restore point id is dropped');
  assert.equal(loose.dev, '');
  assert.equal(loose.answers.weekStart, '');
});

test('which step may be entered: the camp\'s Sunday for step 2, a saved archive for step 4, nothing past 4', () => {
  const ans = wizardNormAnswers({ weekStart: '2027-07-18' });
  assert.equal(wizardCanGo(1, null, {}).ok, true);
  assert.equal(wizardCanGo(2, null, {}).reason, 'dates');
  assert.equal(wizardCanGo(3, null, ans).ok, true);
  assert.equal(wizardCanGo(4, { archiveId: '' }, ans).reason, 'archive');
  assert.equal(wizardCanGo(4, { archiveId: 'rp-archive-pre20261101-ab12' }, ans).ok, true);
  assert.equal(wizardCanGo(5, { archiveId: 'rp-archive-pre20261101-ab12' }, ans).ok, false);
});

// ── the clear's exact paths ──────────────────────────────────────────

function wzPlan(over) {
  const answers = wizardNormAnswers(Object.assign({ weekStart: '2027-07-18' }, over && over.answers));
  const st = wzClone(Object.assign({}, state));
  const inp = Object.assign({
    answers, newEpoch: 'w20270405', ts: { '.sv': 'timestamp' }, state: st, tree: setupCanon(wzSetupTree()), config: state.config,
    curMeta: { epoch: '', double: undefined }, requestKeys: ['a@x,com', 'b@x,com'], nowIso: '2027-04-05T12:00:00.000Z',
  }, over && over.inp);
  return wizardClearUpdate(inp);
}

test('the clear lists EXACTLY the year\'s data: the scoreboard, the epoch pair, the week\'s settings, campers, both reveal nodes and each open request — never members/*', () => {
  freshState();
  state.results = { g: { medals: {} } };
  state.bonuses = { b: { teamId: 't0', points: 1 } };
  state.notice = Object.assign({}, state.notice, { status: 'posted' });
  state.teams[0].counselor = 'Lee'; state.teams[0].photoV = 2;
  const plan = wzPlan();
  assert.equal(plan.ok, true, JSON.stringify(plan.problems));
  const keys = Object.keys(plan.updates).sort();
  // nothing outside the allowed roots
  keys.forEach((k) => assert.ok(/^(state\/|setup\/|campers$|revealPublic$|revealFull$|accessRequests\/|config$)/.test(k), 'unexpected path ' + k));
  assert.equal(keys.filter((k) => k.indexOf('members') === 0).length, 0, 'no member row is in the atomic update');
  ['results', 'brackets', 'brackets4', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'clocks', 'announcements'].forEach((k) => wzIsNull(plan.updates['state/' + k], k));
  wzIsNull(plan.updates['state/meta/lastDataChangeAt']);
  assert.equal(plan.updates['state/meta/epoch'], 'w20270405');
  assert.equal(plan.updates['setup/meta/epoch'], 'w20270405');
  assert.deepEqual(plan.updates['state/meta/epochAt'], { '.sv': 'timestamp' });
  assert.deepEqual(plan.updates['setup/meta/epochAt'], { '.sv': 'timestamp' });
  assert.equal(plan.updates['setup/meta/weekStart'], '2027-07-18');
  assert.deepEqual(plan.updates['setup/meta/double'], { fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 });
  wzIsNull(plan.updates['setup/meta/wizard'], 'the claim goes in the same update');
  assert.equal(plan.updates['state/notice/status'], 'draft');
  wzIsNull(plan.updates['state/teams/0/counselor'], 'typed counselor names are cleared by default');
  wzIsNull(plan.updates['state/teams/0/photoV'], 'so are team photos');
  wzIsNull(plan.updates.campers);
  wzIsNull(plan.updates.revealPublic);
  wzIsNull(plan.updates.revealFull);
  wzIsNull(plan.updates['accessRequests/a@x,com']);
  wzIsNull(plan.updates['accessRequests/b@x,com']);
  wzIsNull(plan.updates['setup/meals'], 'menus clear by default');
  wzIsNull(plan.updates['setup/verses']);
  assert.equal(plan.updates['setup/cleanup'], undefined, 'the rota is kept by default');
  assert.equal(plan.updates['setup/typical'], undefined, 'and so is the schedule');
  assert.equal(plan.updates.config, undefined, 'and the games: the config node is not written at all');
  assert.equal(plan.updates['state/teams/0/name'], undefined);
  // no path is the ancestor of another (the SDK throws on that)
  keys.forEach((a) => keys.forEach((b) => { if (a !== b) assert.ok(b.indexOf(a + '/') !== 0, a + ' is above ' + b); }));
  assert.equal(plan.counts.results, 1);
  assert.equal(plan.counts.requests, 2);
  assert.equal(plan.counts.noticePosted, true);
});

test('the carry-over answers decide the setup paths: Keep writes nothing, Clear empties (and turns an off section on, empty), the app\'s schedule and games are re-derived', () => {
  freshState();
  const keepAll = Object.fromEntries(WIZARD_ITEMS.map((k) => [k, 'keep']));
  const k = wzPlan({ answers: { carry: keepAll } });
  assert.equal(k.ok, true);
  assert.equal(Object.keys(k.updates).filter((p) => /^setup\/(meals|verses|cleanup|electives|typical|days|patches|dayBlocks)/.test(p)).length, 0, 'Keep everything: no section path');
  assert.equal(k.updates['state/teams/0/counselor'], undefined);
  const clearAll = Object.fromEntries(WIZARD_ITEMS.map((x) => [x, 'clear']));
  const c = wzPlan({ answers: { carry: clearAll } });
  wzIsNull(c.updates['setup/cleanup']);
  assert.ok(c.updates['setup/typical'] && c.updates['setup/days'], 'the app\'s schedule is written back whole');
  assert.ok(c.updates.config && Array.isArray(c.updates.config.games), 'the app\'s games, whole');
  assert.ok(c.updates.config.games.every((g) => typeof g.blockId === 'string' && g.blockId), 'each re-linked to a block of the schedule it lands on');
  assert.equal(c.updates.config.updatedAt, '2027-04-05T12:00:00.000Z');
  if (CAMP.features.electives) wzIsNull(c.updates['setup/electives']);
  // a section that is OFF can't be emptied (it is the original week): Clear switches it on, empty
  const off = wzPlan({ answers: { carry: { meals: 'clear' } }, inp: { tree: setupCanon(wzClone(Object.assign({}, wzSetupTree(), { meta: Object.assign({}, wzSetupTree().meta, { on: { schedule: true } }) }))) } });
  assert.equal(off.updates['setup/meta/on/meals'], true);
  wzIsNull(off.updates['setup/meals']);
  // "keep the games, but the schedule is the app's": links that no longer resolve are re-placed, the rest of the catalog is the live one
  const sch = wzPlan({ answers: { carry: { schedule: 'clear', games: 'keep' } } });
  assert.ok(sch.updates.config, 'the games follow a changed schedule');
  assert.equal(sch.updates.config.games.length, allGames().length, 'every game of the live catalog stays');
  assert.ok(sch.updates.config.games.every((g) => typeof g.blockId === 'string'));
  // the app's team names
  const t = wzPlan({ answers: { carry: { teams: 'clear' } } });
  state.teams.forEach((tm, i) => { if (tm.name !== DEFAULT_TEAM_NAMES[i]) assert.equal(t.updates['state/teams/' + i + '/name'], DEFAULT_TEAM_NAMES[i]); });
});

test('a clear that cannot be built is refused whole: no Sunday picked, or a roster that is not whole', () => {
  freshState();
  assert.deepEqual(wizardClearUpdate({ answers: {}, newEpoch: 'w20270405', ts: 1, state, tree: {}, config: state.config, requestKeys: [] }).problems, ['dates']);
  const p = wizardClearUpdate({ answers: { weekStart: '2027-07-18' }, newEpoch: 'w20270405', ts: 1, state: Object.assign({}, state, { teams: [{ name: 'no id' }] }), tree: {}, config: state.config, requestKeys: [] });
  assert.equal(p.ok, false);
  assert.deepEqual(p.problems, ['teams']);
  assert.deepEqual(p.updates, {});
});

test('Undo\'s update puts back the archive: every state section with the scores, the epoch pair (deleted for the legacy epoch), the week\'s settings and the games — and never members, campers or requests', () => {
  freshState();
  const body = restoreBodyObject();
  body.state.meta = Object.assign({}, body.state.meta, { lastDataChangeAt: '2026-07-24T20:00:00.000Z' });
  const u = wizardUndoUpdate(body, { on: { schedule: true } });
  wzIsNull(u['state/meta/epoch'], 'the legacy epoch is DELETED, which re-enables the 2026 constant pin');
  wzIsNull(u['state/meta/epochAt']);
  wzIsNull(u['setup/meta/epoch']);
  wzIsNull(u['setup/meta/wizard']);
  assert.equal(u['state/meta/lastDataChangeAt'], '2026-07-24T20:00:00.000Z');
  assert.ok(u.config && Array.isArray(u.config.games));
  Object.keys(u).forEach((k) => assert.ok(/^(state\/|setup\/|config$)/.test(k), 'unexpected path ' + k));
  assert.equal(Object.keys(u).filter((k) => /members|campers|accessRequests|reveal/.test(k)).length, 0);
  const withEpoch = Object.assign(wzClone(body), { epoch: 'w20260101' });
  withEpoch.state.meta = { epoch: 'w20260101', epochAt: 1700000000000 };
  const u2 = wizardUndoUpdate(withEpoch, {});
  assert.equal(u2['state/meta/epoch'], 'w20260101');
  assert.equal(u2['state/meta/epochAt'], 1700000000000);
  assert.equal(u2['setup/meta/epoch'], 'w20260101', 'both engines\' epochs go back together');
});

// ── the owner's gate ─────────────────────────────────────────────────

test('a non-owner director and a counselor reach none of it: every entry refuses before any write', async () => {
  for (const who of [{ user: WZ_JENN, role: 'editor' }, { user: WZ_JENN, role: 'viewer' }]) {
    const db = await wzSetup(who);
    try {
      const from = db.log.length;
      const calls = [wizardStart(WZ_QUIET), wizardTakeOver({ force: true }), wizardSetStep(2), wizardArchive(), wizardClear(WZ_QUIET), wizardUndo('rp-archive-pre20261101-ab12'), wizardRelease(), wizardFlushAnswers(), wizardStartOver()];
      const results = await Promise.all(calls);
      results.forEach((r, i) => assert.ok(r.ok === false || r.noop === true, 'call ' + i + ' ' + JSON.stringify(r)));
      assert.equal(results[0].reason, 'owner');
      assert.ok(/Only Patrick can/.test(results[0].message));
      assert.equal(results[4].reason === 'owner' || results[4].reason === 'not-mine', true);
      assert.equal(db.log.length, from, 'not one write or transaction was attempted (' + who.role + ')');
      assert.equal(wizardModel().state, 'none');
    } finally { wzTeardown(); }
  }
});

// ── the claim ────────────────────────────────────────────────────────

test('Start claims the wizard with a transaction on setup/meta/wizard: step 1, the owner\'s key, the epoch it starts from, this device', async () => {
  const db = await wzSetup();
  try {
    const from = db.log.length;
    const r = await wizardStart(WZ_QUIET);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.started, true);
    const txns = db.log.slice(from).filter((l) => l.kind === 'transaction');
    assert.deepEqual(txns.map((t) => t.paths[0]), [WZ_ROOT + '/setup/meta/wizard'], 'ONE transaction, on the claim node');
    const w = wzServer(db, 'setup/meta/wizard');
    assert.equal(w.step, 1);
    assert.equal(w.byKey, OWNER_MEMBER_KEY);
    assert.equal(w.fromEpoch, 'legacy', 'never an empty string (RTDB would prune it)');
    assert.equal(typeof w.at, 'number', 'the server\'s clock');
    assert.equal(JSON.parse(w.answers).dev, wizardDeviceId());
    await waitUntil(() => wizardModel().state === 'mine', 'the claim to arrive');
    assert.equal(wizardModel().claim.step, 1);
    // pressing Start again on this device resumes, writing nothing
    const n = db.log.length;
    const again = await wizardStart(WZ_QUIET);
    assert.equal(again.resumed, true);
    assert.equal(db.log.length, n);
  } finally { wzTeardown(); }
});

test('Start turns on editing for the schedule first (A1, with its pre-seed point) when it is not edited here yet — and is refused inside a camp week', async () => {
  const db = await wzSetup({ setup: null });
  try {
    const r = await wizardStart(WZ_QUIET);
    assert.equal(r.ok, true, JSON.stringify(r));
    await waitUntil(() => scheduleIsShared() && wizardModel().state === 'mine', 'A1 and the claim');
    assert.equal(wzServer(db, 'setup/meta/on/schedule'), true);
    assert.equal(Object.values(wzServer(db, 'restoreIndex') || {}).filter((x) => x.kind === 'pre-seed').length, 1);
  } finally { wzTeardown(); }
  const db2 = await wzSetup();
  try {
    // a camp week is running right now
    const sun = wzSunday(0);
    commitSetup((d) => { d.meta.weekStart = sun; }, { undo: false });
    await wzSettle();
    const frozen = await wizardStart();
    assert.equal(frozen.reason, 'camp-week');
    assert.equal(wizardModel().state, 'none');
    assert.equal(wzServer(db2, 'setup/meta/wizard'), null, 'nothing was claimed');
    const over = await wizardStart({ overrideCampWeek: true });
    assert.equal(over.ok, true, 'the owner may say so in words');
  } finally { wzTeardown(); }
  const db3 = await wzSetup({ setup: wzSetupTree() });
  try {
    setupTree.meta.weekStart = undefined; delete setupTree.meta.weekStart; setupRev++;
    const ask = await wizardStart(); // no dates anywhere: the freeze is a question
    assert.equal(ask.reason, 'ask-camp-week');
    assert.equal((await wizardStart({ campRunning: true })).reason, 'camp-week');
  } finally { wzTeardown(); }
});

test('a second device sees the claim as another\'s: Watch, and Take over only after 15 idle minutes (or forced); the answers come with it', async () => {
  const db = await wzSetup();
  try {
    assert.equal((await wizardStart(WZ_QUIET)).ok, true);
    await waitUntil(() => wizardModel().state === 'mine', 'mine');
    wizardAnswer({ weekStart: '2027-07-18', double: 'none', carry: { meals: 'keep' } });
    await wizardFlushAnswers();
    await waitUntil(() => wizardClaimOf(setupTree) && wizardClaimOf(setupTree).answers.double === 'none', 'the answers to reach the claim');
    // another phone of the owner's
    localStorage.setItem(WIZARD_DEVICE_KEY, 'other-device-123');
    wizardDraft = null; localStorage.removeItem(lsKey(WIZARD_DRAFT_KEY));
    let m = wizardModel();
    assert.equal(m.state, 'other');
    assert.equal(m.canTakeOver, false);
    assert.equal(m.byName, 'You', 'my own key reads as "You" (the screen says: another device of yours)');
    assert.equal((await wizardStart(WZ_QUIET)).reason, 'other', 'Start never overwrites a live claim');
    assert.equal((await wizardTakeOver()).reason, 'busy');
    m = wizardModel(m.claim.at + WIZARD_IDLE_MS);
    assert.equal(m.canTakeOver, true, 'idle for 15 minutes');
    const from = db.log.length;
    const t = await wizardTakeOver({ force: true });
    assert.equal(t.ok, true, JSON.stringify(t));
    assert.equal(t.inherited.double, 'none');
    assert.equal(t.inherited.carry.meals, 'keep');
    assert.equal(t.inherited.weekStart, '2027-07-18');
    assert.equal(db.log.slice(from).filter((l) => l.kind === 'transaction').length, 1);
    await waitUntil(() => wizardModel().state === 'mine', 'now mine');
    assert.equal(wizardAnswers().double, 'none', 'the answers are this device\'s draft now');
    // the first device is now the other one
    localStorage.setItem(WIZARD_DEVICE_KEY, 'first-device-1234');
    assert.equal(wizardModel().state, 'other');
  } finally { wzTeardown(); }
});

test('another director only ever WATCHES: a read-only line, never a control, and the claim\'s owner is named', async () => {
  const db = await wzSetup({ user: WZ_JENN, role: 'editor' });
  try {
    db.serverSet(dbPath('setup/meta/wizard'), { step: 3, byKey: OWNER_MEMBER_KEY, at: Date.now(), fromEpoch: 'legacy', answers: JSON.stringify({ dev: 'owner-device-1' }) });
    await waitUntil(() => wizardClaimOf(setupTree), 'the claim to arrive');
    const m = wizardModel();
    assert.equal(m.state, 'watching');
    assert.equal(m.canTakeOver, false);
    assert.equal(m.byName, 'Patrick');
    assert.equal(m.claim.step, 3);
  } finally { wzTeardown(); }
});

test('a leftover claim from another camp year is stale: the owner starts over it, nobody is shown a claim that cannot be live', async () => {
  const db = await wzSetup();
  try {
    db.serverSet(dbPath('setup/meta/wizard'), { step: 4, byKey: OWNER_MEMBER_KEY, at: Date.now() - 1e9, fromEpoch: 'w20260101', answers: JSON.stringify({ dev: 'old-device-123' }) });
    await waitUntil(() => wizardClaimOf(setupTree), 'the claim to arrive');
    assert.equal(wizardModel().state, 'stale');
    const r = await wizardStart(WZ_QUIET);
    assert.equal(r.started, true, JSON.stringify(r));
    await waitUntil(() => wizardModel().state === 'mine', 'a fresh claim');
    assert.equal(wizardModel().claim.step, 1);
    assert.equal(wizardModel().claim.fromEpoch, 'legacy');
  } finally { wzTeardown(); }
});

test('resume at each step: a reload (a fresh memory, the same device) finds the same step and the same answers, and Release lets the claim go', async () => {
  const db = await wzSetup();
  try {
    assert.equal((await wizardStart(WZ_QUIET)).ok, true);
    await waitUntil(() => wizardModel().state === 'mine', 'mine');
    wizardAnswer({ weekStart: '2027-07-18', double: { fromDow: 3, fromMin: 0, toDow: 4, toMin: 0 }, carry: { photos: 'keep' } });
    for (const n of [2, 3]) {
      assert.equal((await wizardSetStep(n)).ok, true);
      await waitUntil(() => wizardModel().claim.step === n, 'step ' + n);
      wizardDraft = null; // a reload: memory gone, localStorage and the claim stay
      const m = wizardModel();
      assert.equal(m.state, 'mine', 'step ' + n + ': still this device\'s');
      assert.equal(m.claim.step, n);
      assert.equal(wizardAnswers().weekStart, '2027-07-18');
      assert.deepEqual(wizardAnswers().double, { fromDow: 3, fromMin: 0, toDow: 4, toMin: 0 });
      assert.equal(wizardAnswers().carry.photos, 'keep');
      assert.equal(wizardClaimOf(setupTree).answers.carry.photos, 'keep', 'and the claim holds them too');
    }
    assert.equal((await wizardSetStep(1)).ok, true, 'Back is allowed');
    assert.equal((await wizardSetStep(4)).reason, 'archive', 'step 4 needs the archive');
    assert.equal((await wizardRelease()).ok, true);
    await waitUntil(() => wizardModel().state === 'none', 'the claim to go');
    assert.equal(wzServer(db, 'setup/meta/wizard'), null);
  } finally { wzTeardown(); }
});

test('a changed answer reaches the claim at most every 10 s (a step change sends it at once), and a tap refreshes the claim at most once a minute', async () => {
  const db = await wzSetup();
  try {
    assert.equal((await wizardStart(WZ_QUIET)).ok, true);
    await waitUntil(() => wizardModel().state === 'mine', 'mine');
    wizardAnswersSentAt = Date.now(); // the last send was just now
    const n = db.log.length;
    wizardAnswer({ weekStart: '2027-07-18' });
    wizardAnswer({ weekStart: '2027-07-25' });
    assert.equal(db.log.length, n, 'throttled: nothing sent yet');
    assert.ok(wizardAnswersTimer, 'one timer is waiting out the rest of the 10 s');
    assert.equal(wizardDraftRead().answers.weekStart, '2027-07-25', 'but this device keeps it at once');
    const sent = await wizardFlushAnswers();
    assert.equal(sent.ok, true);
    assert.equal(wizardClaimOf({ meta: { wizard: wzServer(db, 'setup/meta/wizard') } }).answers.weekStart, '2027-07-25');
    wizardClaimWroteAt = Date.now();
    const m = db.log.length;
    await wizardTouch();
    assert.equal(db.log.length, m, 'a tap inside the minute writes nothing');
    wizardClaimWroteAt = Date.now() - WIZARD_TOUCH_MS - 1;
    await wizardTouch();
    assert.ok(db.log.length > m, 'a minute later it does');
  } finally { wzTeardown(); }
});

test('an open wizard touched in the last 2 minutes, and a commit in flight, hold the auto-reload', () => {
  freshState();
  wizardOpenNow = false;
  assert.equal(wizardBusy(), false);
  wizardSetOpen(true);
  assert.equal(wizardBusy(), true);
  assert.equal(reloadBlocked(), true);
  wizardTouchedAt = Date.now() - WIZARD_BUSY_MS - 1;
  assert.equal(wizardBusy(), false, 'untouched for 2 minutes: an abandoned screen never stops an update');
  wizardSetOpen(false);
  wizardCommitInFlight = true;
  assert.equal(wizardBusy(), true);
  assert.equal(wizardHoldsPushes(), true);
  assert.equal(tabMayPush('state'), false, 'every engine\'s push is held while the clear is on the wire');
  assert.equal(tabMayPush('config'), false);
  assert.equal(tabMayPush('setup'), false);
  wizardCommitInFlight = false;
  tabHeldState = tabHeldConfig = tabHeldSetup = false;
  assert.equal(wizardBusy(), false);
});

// ── the archive ──────────────────────────────────────────────────────

test('step 3: the pre-wizard point and a PINNED archive are written, READ BACK and compared, and only then is the id put in the claim', async () => {
  const db = await wzSetup();
  try {
    assert.equal((await wizardStart(WZ_QUIET)).ok, true);
    await waitUntil(() => wizardModel().state === 'mine', 'mine');
    wizardAnswer({ weekStart: '2027-07-18' });
    const from = db.log.length;
    const a = await wizardArchive();
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(a.reused, false);
    assert.ok(/^rp-archive-pre-\d{8}-[a-z0-9]{4}$/.test(a.rid), 'the legacy epoch has no id of its own');
    assert.equal(a.counts.results, 2);
    assert.equal(a.counts.bonuses, 1);
    assert.ok(/^\d{4} camp week \u00b7 (Junior|Senior) Camp$/.test(a.label), a.label); // changed on purpose: the label names the camp in words
    const index = wzServer(db, 'restoreIndex');
    const rows = Object.values(index);
    assert.equal(rows.filter((r) => r.kind === 'pre-wizard').length, 1);
    const arch = index[a.rid];
    assert.equal(arch.kind, 'archive');
    assert.equal(arch.pinned, true);
    const body = JSON.parse(wzServer(db, 'restoreBody/' + a.rid));
    assert.equal(arch.bytes, wzServer(db, 'restoreBody/' + a.rid).length);
    assert.equal(arch.hash, restoreHash(body));
    assert.equal(Object.keys(body.state.results).length, 2, 'the scores are in it');
    assert.equal(body.setup.meta && body.setup.meta.wizard, undefined, 'the claim is not part of what is saved');
    // ORDER: the writes of the two points, then READS of the index and the body, THEN the claim
    const log = db.log.slice(from);
    const w1 = log.findIndex((l) => l.kind === 'update' && l.paths.some((p) => /restoreIndex\/rp-archive/.test(p)));
    const claimTxn = log.map((l, i) => (l.kind === 'transaction' && l.paths[0] === WZ_ROOT + '/setup/meta/wizard' ? i : -1)).filter((i) => i > w1)[0];
    assert.ok(w1 !== -1 && claimTxn !== undefined, 'the claim records the id only after the archive was written (and verified)');
    await waitUntil(() => wizardModel().claim.archiveId === a.rid, 'the claim');
  } finally { wzTeardown(); }
});

test('step 3 is idempotent: Back-then-Next reuses a verified archive, a changed week gets a fresh one, a missing one is replaced — never a collision', async () => {
  const db = await wzSetup();
  try {
    const first = await wzToStep4(db);
    const points = () => Object.values(wzServer(db, 'restoreIndex') || {});
    assert.equal(points().filter((r) => r.kind === 'archive').length, 1);
    const again = await wizardArchive();
    assert.equal(again.ok, true);
    assert.equal(again.reused, true, 'verified and reused');
    assert.equal(again.rid, first.rid);
    assert.equal(points().filter((r) => r.kind === 'archive').length, 1, 'no second point');
    assert.equal(points().filter((r) => r.kind === 'pre-wizard').length, 1, 'and no second pre-wizard point');
    // a score arrives meanwhile (another director): the archive no longer matches the data
    const gid = allGames()[2].id;
    db.serverSet(dbPath('state/results/' + gid), { medals: { gold: 't3', silver: 't4', bronze: 't5' }, savedAt: 9 });
    await waitUntil(() => state.results[gid], 'the late score to arrive');
    const fresh = await wizardArchive();
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.equal(fresh.reused, false);
    wzNe(fresh.rid, first.rid, 'a fresh id: a create-only rule can never strand it');
    assert.equal(fresh.counts.results, 3);
    // the point it named is gone from the database (a console clean-up): replaced
    await waitUntil(() => wizardModel().claim.archiveId === fresh.rid, 'the claim');
    db.serverSet(dbPath('restoreIndex/' + fresh.rid), null);
    db.serverSet(dbPath('restoreBody/' + fresh.rid), null);
    const replaced = await wizardArchive();
    assert.equal(replaced.ok, true);
    assert.equal(replaced.reused, false);
    wzNe(replaced.rid, fresh.rid);
  } finally { wzTeardown(); }
});

test('a failed read-back is said and nothing is put in the claim: the wizard cannot reach step 4 on an archive nobody verified', async () => {
  const db = await wzSetup();
  try {
    assert.equal((await wizardStart(WZ_QUIET)).ok, true);
    await waitUntil(() => wizardModel().state === 'mine', 'mine');
    wizardAnswer({ weekStart: '2027-07-18' });
    // the body is cut short on its way in: the index row says one length, the database holds another
    const realRef = db.ref;
    db.ref = (p) => {
      const r = realRef(p);
      if (String(p) === WZ_ROOT) {
        const upd = r.update.bind(r);
        r.update = (vals) => {
          const v = Object.assign({}, vals);
          Object.keys(v).forEach((k) => { if (/^restoreBody\/rp-archive/.test(k)) v[k] = String(v[k]).slice(0, 50); });
          return upd(v);
        };
      }
      return r;
    };
    window.firebase = makeFakeFirebase(db);
    const a = await wizardArchive();
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'verify');
    assert.equal(wizardClaimOf(setupTree).archiveId, '', 'no id in the claim');
    assert.equal((await wizardSetStep(4)).reason, 'archive');
    assert.equal((await wizardClear(WZ_QUIET)).reason, 'archive', 'and the clear refuses: nothing was verified');
    assert.equal(wzServer(db, 'state/results') !== null, true, 'nothing was cleared');
    db.ref = realRef;
    window.firebase = makeFakeFirebase(db);
    assert.equal((await wizardArchive()).ok, true, 'Try again works');
  } finally { wzTeardown(); }
});

// ── the clear, end to end ────────────────────────────────────────────

test('step 4: ONE atomic update with exactly the listed paths, after a verified archive — and last year is gone, the new year is in, on every engine', async () => {
  const db = await wzSetup();
  try {
    const arch = await wzToStep4(db);
    const from = db.log.length;
    const r = await wizardClear(WZ_QUIET);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(/^w20\d{6}(-[2-9])?$/.test(r.epoch));
    assert.equal(r.archiveId, arch.rid);
    assert.equal(r.counts.results, 2);
    // ONE multi-path update at the camp root carries the year; its paths are what the pure builder lists
    const rootUpdates = db.log.slice(from).filter((l) => l.kind === 'update' && l.paths.some((p) => p === WZ_ROOT + '/state/meta/epoch'));
    assert.equal(rootUpdates.length, 1, 'ONE atomic update');
    const paths = rootUpdates[0].paths;
    assert.ok(paths.every((p) => p.indexOf(WZ_ROOT + '/members') !== 0), 'no member row in it');
    ['state/results', 'state/bonuses', 'state/announcements', 'state/meta/epoch', 'state/meta/epochAt', 'setup/meta/epoch', 'setup/meta/weekStart', 'setup/meta/double', 'setup/meta/finaleDow', 'setup/meta/wizard', 'campers', 'revealPublic', 'revealFull', 'accessRequests/new@example,com', 'accessRequests/new2@example,com', 'state/notice/status', 'state/teams/0/counselor', 'state/teams/0/photoV']
      .forEach((p) => assert.ok(paths.indexOf(WZ_ROOT + '/' + p) !== -1, 'the update carries ' + p));
    // the archive was verified BEFORE the update: its writes and its read-back come first
    const order = db.log.slice(from);
    assert.ok(order.findIndex((l) => l.kind === 'update' && l.paths.some((p) => p === WZ_ROOT + '/state/meta/epoch')) > -1);
    // the server
    assert.equal(wzServer(db, 'state/results'), null);
    assert.equal(wzServer(db, 'state/bonuses'), null);
    assert.equal(wzServer(db, 'state/meta/epoch'), r.epoch);
    assert.equal(wzServer(db, 'setup/meta/epoch'), r.epoch, 'both nodes carry the same year');
    assert.equal(wzServer(db, 'state/meta/epochAt'), wzServer(db, 'setup/meta/epochAt'));
    assert.equal(wzServer(db, 'setup/meta/weekStart'), '2027-07-18');
    assert.deepEqual(wzServer(db, 'setup/meta/double'), { fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 });
    assert.equal(wzServer(db, 'setup/meta/wizard'), null, 'the claim left in the same update');
    assert.equal(wzServer(db, 'state/notice/status'), 'draft');
    assert.equal(wzServer(db, 'campers'), null);
    assert.equal(wzServer(db, 'accessRequests'), null);
    assert.equal(wzServer(db, 'revealPublic'), null);
    assert.equal(wzServer(db, 'revealFull'), null);
    assert.equal(wzServer(db, 'state/teams')[0].counselor, undefined, 'the typed counselor name went');
    assert.equal(wzServer(db, 'state/teams')[0].photoV, undefined);
    assert.equal(wzServer(db, 'setup/meals'), null, 'menus cleared');
    assert.ok(wzServer(db, 'setup/typical'), 'the schedule kept');
    if (CAMP.id === 'junior') assert.ok(wzServer(db, 'setup/cleanup'), 'the rota kept (senior has no rota to keep)');
    // this phone: the new year is adopted, nothing is left to send, nothing stranded
    await wzSettle();
    assert.equal(state.meta.epoch, r.epoch);
    assert.deepEqual(state.results, {});
    assert.equal(epochOfTree(setupTree), r.epoch);
    assert.equal(wizardCommitInFlight, false);
    assert.equal(Object.keys(setupUnconfirmed()).length, 0);
    assert.equal(readStranded().length, 0);
    // members: the counselors' teams followed, one small update each, the owner skipped, the broken row listed
    const members = wzServer(db, 'members');
    assert.equal(members[OWNER_MEMBER_KEY].teamId, 't0', 'the owner row is never written');
    assert.equal(members['sam@example,com'].teamId, undefined);
    assert.equal(members['jenn@example,com'].teamId, undefined, 'a director comes off a team like anyone');
    assert.equal(members['sam@example,com'].role, 'viewer', 'everyone keeps their sign-in');
    const memberUpdates = wzUpdates(db).slice(from ? 0 : 0).filter((l) => l.paths.length === 1 && /\/members\/.+\/teamId$/.test(l.paths[0]) && db.log.indexOf(l) >= from);
    assert.equal(memberUpdates.length, r.members.cleared, 'one small update per member');
    assert.deepEqual(r.members.incomplete.map((m) => m.key), ['broken@example,com'], 'an incomplete sign-in record is listed before the hold, never in the big update');
    // the epoch changed on this device too: its remembered year is the new one
    assert.equal(localStorage.getItem(lsKey(EPOCH_SEEN_KEY)), r.epoch);
    assert.equal(wizardDraftRead().done.epoch, r.epoch, 'the receipt step 5 reads');
  } finally { wzTeardown(); }
});

test('"Counselors stay on their teams" leaves every member row alone', async () => {
  const db = await wzSetup();
  try {
    await wzToStep4(db);
    wizardAnswer({ carry: { memberTeams: 'keep' } });
    const r = await wizardClear(WZ_QUIET);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(wzServer(db, 'members')['sam@example,com'].teamId, 't2');
    assert.equal(r.members.cleared, 0);
  } finally { wzTeardown(); }
});

test('the clear re-checks before it writes: unsent work of this phone, no archive, not the driver, a camp week, offline — each refuses with nothing changed', async () => {
  const db = await wzSetup();
  try {
    assert.equal((await wizardClear(WZ_QUIET)).reason, 'not-mine', 'no claim');
    await wzToStep4(db);
    const results = JSON.stringify(wzServer(db, 'state/results'));
    // an unconfirmed edit of this phone's own
    setupPushMs = 100000;
    commitSetup((d) => { d.meta.finaleDow = 3; }, { undo: false });
    wizardQuietMs = 0; // no waiting: the edit is still unacknowledged when the clear looks
    assert.equal((await wizardClear(WZ_QUIET)).reason, 'busy');
    wizardQuietMs = 8000;
    clearTimeout(setupPushTimer); setupPushTimer = null;
    setupPushMs = 40;
    pushSetup();
    await wzSettle();
    // a camp week
    const sun = wzSunday(0);
    commitSetup((d) => { d.meta.weekStart = sun; }, { undo: false });
    await wzSettle();
    assert.equal((await wizardClear()).reason, 'camp-week');
    commitSetup((d) => { d.meta.weekStart = '2026-07-19'; }, { undo: false });
    await wzSettle();
    // offline
    fbConnected = false;
    assert.equal((await wizardClear(WZ_QUIET)).reason, 'offline');
    fbConnected = true;
    // another device is the driver
    localStorage.setItem(WIZARD_DEVICE_KEY, 'other-device-123');
    assert.equal((await wizardClear(WZ_QUIET)).reason, 'not-mine');
    assert.equal(JSON.stringify(wzServer(db, 'state/results')), results, 'nothing was cleared');
    assert.equal(wzServer(db, 'state/meta/epoch'), null);
  } finally { wzTeardown(); }
});

test('a refused clear changes NOTHING: the database says no to one path and the whole update is refused', async () => {
  const db = await wzSetup();
  try {
    await wzToStep4(db);
    db.refuse(WZ_ROOT + '/campers');
    const r = await wizardClear(WZ_QUIET);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'refused');
    assert.ok(wzServer(db, 'state/results'), 'last year is still there');
    assert.equal(wzServer(db, 'state/meta/epoch'), null);
    assert.equal(wizardCommitInFlight, false, 'the engines are released');
    assert.equal(wizardModel().state, 'mine', 'and the wizard is still the owner\'s, to try again');
  } finally { wzTeardown(); }
});

test('a late score between step 3 and the hold gets a fresh archive first (the resumed wizard never clears data the archive does not hold)', async () => {
  const db = await wzSetup();
  try {
    const first = await wzToStep4(db);
    const gid = allGames()[3].id;
    db.serverSet(dbPath('state/results/' + gid), { medals: { gold: 't3', silver: 't4', bronze: 't5' }, savedAt: 9 });
    await waitUntil(() => state.results[gid], 'the late score');
    const r = await wizardClear(WZ_QUIET);
    assert.equal(r.ok, true, JSON.stringify(r));
    wzNe(r.archiveId, first.rid, 'a fresh point');
    const body = JSON.parse(wzServer(db, 'restoreBody/' + r.archiveId));
    assert.ok(body.state.results[gid], 'the late score is in what was saved');
  } finally { wzTeardown(); }
});

// ── Undo the new-year setup ──────────────────────────────────────────

test('Undo the new-year setup restores the data AND the epoch in ONE atomic update: the scores, the legacy epoch (deleted), the week\'s dates, 2026 bonuses doubled again', async () => {
  const db = await wzSetup();
  try {
    const arch = await wzToStep4(db);
    const cleared = await wizardClear(WZ_QUIET);
    assert.equal(cleared.ok, true, JSON.stringify(cleared));
    await wzSettle();
    assert.equal(doubleWindow() === DOUBLE_WINDOW_LEGACY, false, 'in the new year the window is the week\'s own');
    const offer = await wizardUndoOffer();
    assert.equal(offer.rid, arch.rid, 'the newest archive is offered');
    assert.equal(offer.recent, true);
    const from = db.log.length;
    const u = await wizardUndo(arch.rid);
    assert.equal(u.ok, true, JSON.stringify(u));
    assert.equal(u.epoch, '');
    const upd = db.log.slice(from).filter((l) => l.kind === 'update' && l.paths.some((p) => p === WZ_ROOT + '/state/meta/epoch'));
    assert.equal(upd.length, 1, 'data and epoch in ONE update');
    assert.ok(upd[0].paths.some((p) => p === WZ_ROOT + '/setup/meta/epoch'), 'both epochs in it');
    assert.ok(upd[0].paths.every((p) => !/\/(members|campers|accessRequests|revealPublic|revealFull)/.test(p)), 'members, campers, requests and the reveal stay as they are');
    assert.equal(Object.keys(wzServer(db, 'state/results')).length, 2, 'the scores are back');
    assert.equal(wzServer(db, 'state/bonuses').b1.points, 5);
    assert.equal(wzServer(db, 'state/meta/epoch'), null, 'the legacy epoch is deleted');
    assert.equal(wzServer(db, 'state/meta/epochAt'), null);
    assert.equal(wzServer(db, 'setup/meta/epoch'), null);
    assert.equal(wzServer(db, 'setup/meta/wizard'), null);
    assert.equal(wzServer(db, 'setup/meta/weekStart'), null, 'the dates go back to what the archive held (none)');
    assert.equal(wzServer(db, 'state/meta/lastDataChangeAt'), '2026-07-24T20:00:00.000Z');
    if (CAMP.id === 'junior') assert.ok(wzServer(db, 'setup/meals'), 'the menus are back (senior has none)');
    assert.equal(wzServer(db, 'state/notice/status'), 'posted', 'and the notice as it was');
    assert.equal(wzServer(db, 'state/teams')[0].counselor, 'Last Year Lee');
    assert.equal(wzServer(db, 'state/teams')[0].photoV, 3);
    // a pre-restore point came first
    assert.equal(Object.values(wzServer(db, 'restoreIndex')).filter((r) => r.kind === 'pre-restore').length, 1);
    await wzSettle();
    assert.equal(state.meta.epoch, undefined, 'this phone is back in the legacy week');
    assert.equal(doubleWindow(), DOUBLE_WINDOW_LEGACY, 'which re-enables the 2026 window, so the bonuses of 2026 are doubled again');
    assert.equal(bonusCountsDouble(state.bonuses.b1), true);
    // not offered again once it is done; the same archive twice refuses
    assert.equal(await wizardUndoOffer(), null);
    assert.equal((await wizardUndo(arch.rid)).reason, 'nothing');
  } finally { wzTeardown(); }
});

test('Undo is owner-only, only for the NEWEST archive, and only with nothing of this phone\'s in flight', async () => {
  const db = await wzSetup();
  try {
    const arch = await wzToStep4(db);
    assert.equal((await wizardClear(WZ_QUIET)).ok, true);
    await wzSettle();
    assert.equal((await wizardUndo('rp-archive-pre20200101-zzzz')).reason, 'not-newest');
    setupPushMs = 100000;
    commitSetup((d) => { d.meta.finaleDow = 2; }, { undo: false });
    wizardQuietMs = 0;
    assert.equal((await wizardUndo(arch.rid)).reason, 'busy');
    wizardQuietMs = 8000;
    clearTimeout(setupPushTimer); setupPushTimer = null; setupPushMs = 40; pushSetup(); await wzSettle();
  } finally { wzTeardown(); }
  const db2 = await wzSetup({ user: WZ_JENN, role: 'editor' });
  try {
    const n = db2.log.length;
    const r = await wizardUndo('rp-archive-pre20261101-ab12');
    assert.equal(r.reason, 'owner');
    assert.equal(db2.log.length, n);
  } finally { wzTeardown(); }
});

// ── a new camp year on other devices ─────────────────────────────────

test('the setup engine STRANDS a stale device\'s unconfirmed week when the epoch moves under it, never applies it', async () => {
  const db = await wzSetup();
  try {
    setupPushMs = 100000;
    commitSetup((d) => { d.meta.finaleDow = 3; }, { undo: false }); // unconfirmed, last year's
    assert.ok(Object.keys(setupUnconfirmed()).length > 0);
    const server = wzClone(db.serverGet(dbPath('setup')));
    server.meta = Object.assign({}, server.meta, { epoch: 'w20270405', epochAt: 1700000000000, weekStart: '2027-07-18' });
    delete server.meals;
    const n = db.log.length;
    db.serverSet(dbPath('setup'), server);
    await waitUntil(() => epochOfTree(setupTree) === 'w20270405', 'the new year to arrive');
    assert.equal(setupTree.meta.finaleDow, undefined, 'last year\'s edit was not applied to the new year');
    assert.equal(setupTree.meta.weekStart, '2027-07-18');
    const stranded = readStranded();
    assert.equal(stranded.length, 1);
    assert.equal(stranded[0].from, 'legacy');
    assert.equal(stranded[0].to, 'w20270405');
    assert.ok(stranded[0].changes.some((c) => c.path === 'setup/meta/finaleDow'), 'it is kept as a download');
    clearTimeout(setupPushTimer); setupPushTimer = null;
    assert.equal(db.log.slice(n).filter((l) => l.kind === 'update' || l.kind === 'transaction').length, 0, 'and nothing was sent');
    assert.equal(Object.keys(setupUnconfirmed()).length, 0);
  } finally { wzTeardown(); }
});

test('a device\'s remembered year is reset the first time it adopts another epoch: the team it follows, who it is, its baseline, dismissed banners, undo, clashes, the rain draft and the wizard draft — never the first sight of the legacy week', () => {
  freshState();
  localStorage.removeItem(lsKey(EPOCH_SEEN_KEY));
  state.followTeam = 't2'; state.identity = 'Sam';
  localStorage.setItem(DAY_RANK_KEY, '{"date":"x"}');
  localStorage.setItem(CHANGE_DISMISS_KEY, '["a"]');
  localStorage.setItem(ANNOUNCE_DISMISS_KEY, '["a"]');
  localStorage.setItem(lsKey('campSetupRainDraft'), '{}');
  localStorage.setItem(lsKey(WIZARD_DRAFT_KEY), '{"v":1}');
  setupClashes = [{ id: 'n1' }];
  assert.equal(epochDeviceReset(), false, 'the first sight of the legacy week only records it');
  assert.equal(localStorage.getItem(lsKey(EPOCH_SEEN_KEY)), 'legacy');
  assert.equal(state.followTeam, 't2');
  assert.equal(epochDeviceReset(), false, 'and is silent after');
  state.meta.epoch = 'w20270405';
  assert.equal(epochDeviceReset(), true);
  assert.equal(state.followTeam, undefined, 'the picker is asked again');
  assert.equal(state.identity, undefined);
  [DAY_RANK_KEY, CHANGE_DISMISS_KEY, ANNOUNCE_DISMISS_KEY, lsKey('campSetupRainDraft'), lsKey(WIZARD_DRAFT_KEY)].forEach((k) => assert.equal(localStorage.getItem(k), null, k));
  assert.deepEqual(setupClashes, []);
  assert.equal(localStorage.getItem(lsKey(EPOCH_SEEN_KEY)), 'w20270405');
  assert.equal(epochDeviceReset(), false, 'a second snapshot of the same year changes nothing');
  // an epoch going BACK (Undo the new-year setup) is a change like any other
  state.followTeam = 't1';
  delete state.meta.epoch;
  assert.equal(epochDeviceReset(), true);
  assert.equal(state.followTeam, undefined);
  assert.equal(localStorage.getItem(lsKey(EPOCH_SEEN_KEY)), 'legacy');
  localStorage.removeItem(lsKey(EPOCH_SEEN_KEY));
});

test('a phone that ran before this existed (no record of a year) learns the new year on its first snapshot of it', () => {
  freshState();
  localStorage.removeItem(lsKey(EPOCH_SEEN_KEY));
  state.followTeam = 't1';
  state.meta.epoch = 'w20270405';
  assert.equal(epochDeviceReset(), true, 'an unknown past is the legacy week');
  assert.equal(state.followTeam, undefined);
  localStorage.removeItem(lsKey(EPOCH_SEEN_KEY));
});

test('sign-out wipes the new-year setup\'s device keys with the rest', () => {
  localStorage.setItem(lsKey(EPOCH_SEEN_KEY), 'legacy');
  localStorage.setItem(lsKey(WIZARD_DRAFT_KEY), '{"v":1}');
  clearLocalData();
  assert.equal(localStorage.getItem(lsKey(EPOCH_SEEN_KEY)), null);
  assert.equal(localStorage.getItem(lsKey(WIZARD_DRAFT_KEY)), null);
});

test('the history drawer shows this camp year only, with Show earlier years; no filter before an epoch exists', () => {
  const rows = [{ at: 5000, team: 'a' }, { at: '1970-01-01T00:00:01.000Z', team: 'old' }, { at: 9000, team: 'b' }];
  assert.deepEqual(historyFilterRows(rows, 0, false), { rows, hidden: 0 }, 'the legacy week: no filter');
  const f = historyFilterRows(rows, 4000, false);
  assert.deepEqual(f.rows.map((r) => r.team), ['a', 'b']);
  assert.equal(f.hidden, 1);
  assert.equal(historyFilterRows(rows, 4000, true).rows.length, 3, 'Show earlier years');
  freshState();
  assert.equal(historyEpochFloor(), 0);
  state.meta.epochAt = 1700000000000;
  assert.equal(historyEpochFloor(), 1700000000000);
  state.meta.epochAt = 'junk';
  assert.equal(historyEpochFloor(), 0);
});

test('the double-points window follows the epoch: pinned to the legacy window with none, the week\'s own with one, none at all when the year says none', async () => {
  freshState();
  authUser = WZ_OWNER;
  setMemberRole('editor'); // a points reader: only a confirmed director counts a bonus
  assert.equal(doubleWindow(), DOUBLE_WINDOW_LEGACY, 'no epoch: whatever the setup data says');
  state.meta.epoch = 'w20270405';
  setupTree = normalizeSetup({ meta: { weekStart: '2027-07-18', double: { fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 } } });
  setupRev++;
  const w = doubleWindow();
  assert.equal(w.start, etWallToEpoch('2027-07-18', 4 * 1440 + 1020));
  assert.equal(w.end, etWallToEpoch('2027-07-18', 6 * 1440));
  assert.equal(doubleWindow(), w, 'memoised');
  const entry = { category: 'custom', at: new Date(w.start + 3600000).toISOString() };
  assert.equal(bonusCountsDouble(entry), true);
  assert.equal(bonusCountsDouble({ category: 'custom', at: '2026-07-23T22:00:00.000Z' }), false, 'last year\'s hour is not in this year\'s window');
  setupTree = normalizeSetup({ meta: { weekStart: '2027-07-18' } });
  setupRev++;
  assert.equal(doubleWindow(), null, 'a year with no window doubles nothing');
  setupTree = normalizeSetup({});
  setupRev++;
  delete state.meta.epoch;
  setMemberRole(null);
  authUser = null;
});

test('a reveal from the old camp year is ignored once the epoch moves (the reveal reads this week\'s epoch)', () => {
  const T = 1800000000000;
  const n = state.teams.length;
  const ctl = { v: 1, id: 'r1kz9fxq-4hd2', seq: 3, phase: 'live', cur: 1, shown: 2, teams: n, finale: false, at: T, sa: T, ca: T - 1000, startedAt: T - 1000, until: T + 86400000, epoch: 'w20260101' };
  const pub = {};
  for (let i = 0; i < 2; i++) { const tid = 't' + (n - 1 - i); pub['g' + i] = { place: n - i, e: { [tid]: { nm: 'Team ' + tid, p: 10, g: 0, s: 0, b: 0, v: 0, m: 0, c: 0 } } }; }
  assert.ok(revealView(ctl, pub, () => T + 20000, 'viewer', { epoch: 'w20260101', clockUnknown: false }), 'this year\'s reveal reads');
  assert.equal(revealView(ctl, pub, () => T + 20000, 'viewer', { epoch: 'w20270405', clockUnknown: false }), null, 'after the new-year setup it shows nothing');
  assert.equal(revealView(ctl, pub, () => T + 20000, 'viewer', { epoch: '', clockUnknown: false }), null, 'and nothing in the legacy week either');
});
