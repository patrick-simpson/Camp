// The setup engine (setup-rebuild-spec §6.4, build step 14 / "S4"): the week's schedule,
// menus, verses, rota and electives as DATA under <root>/setup, synced by an engine that
// clones the config engine's design (id-keyed field ops against a persisted confirmed
// baseline, a three-way first-snapshot merge, rebase on receipt). Driven against the
// in-memory Realtime Database (tests/fake-rtdb.js) with the engine's real listener, push,
// merge and bisect. Dark by design: nothing writes until a director acts, and every
// section's switch is the OWNER's, so these tests put the switch on at the SERVER the way
// Step 15's Edit the week here will. Run under the senior profile too
// (setup-sync.senior.test.js evals this file).

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const SS_PATH = dbPath('setup');
const ssWait = (ms) => new Promise((r) => setTimeout(r, ms || 5));
const SS_PUSH_MS = 40;
const SS_FLUSH = SS_PUSH_MS + 110; // a push window and a margin: the engine's 300 ms debounce, shortened (setupPushMs)
const ssClone = (v) => JSON.parse(JSON.stringify(v));

const SS_JENN = { email: 'jenn@example.com', emailVerified: true };
const SS_JENN_KEY = 'jenn@example,com';
const SS_PAT_KEY = 'pat@example,com';

// What a camp looks like once the schedule is being edited here (the switch is on).
function ssTree() {
  return {
    meta: { schema: 1, on: { schedule: true, meals: true }, weekStart: '2027-07-18' },
    days: { mon: { typical: true, tag: 'Competition day 1' }, tue: { typical: true }, sun: { typical: false, tag: 'Arrival day' } },
    typical: {
      'b-swim-900': { start: 900, end: 960, label: 'Swim', type: 'activity', ord: 10 },
      'b-lunch-720': { start: 720, end: 780, label: 'Lunch', type: 'activity', meal: 'lunch', ord: 20 },
    },
    patches: { tue: { 'b-swim-900': { label: 'Swim — Cam' } } },
    dayBlocks: { sun: { 'b-sun-registration-840': { start: 840, end: 900, label: 'Registration', type: 'activity' } } },
    meals: { mon: { lunch: { dish: 'Pizza', emoji: '🍕' } } },
    cleanup: { mon: { lunch: { t0: true } } },
  };
}

function ssReset() {
  setupPushMs = SS_PUSH_MS;
  authUser = SS_JENN;
  setMemberRole('editor');
  memberDirectory = {
    [SS_JENN_KEY]: { role: 'editor', name: 'Jenn Reed' },
    [SS_PAT_KEY]: { role: 'editor', name: 'Pat Moore' },
  };
  memberDirectoryLoaded = true;
  setupRef = null; setupReady = false; setupDenied = false; setupWriteRefused = false;
  setupTree = normalizeSetup({}); setupBase = null; setupBaseAt = 0; setupBootBase = null; setupLast = null;
  setupPending = 0; clearTimeout(setupPushTimer); setupPushTimer = null; setupRefetchOwed = false;
  setupBisecting = false; setupBisectQueue = []; setupBisectHeld = false;
  setupQuarantine = {}; setupClashes = []; setupEdited = {}; setupRev = 0; setupFocus = null; setupFocusOwed = {};
  localStorage.removeItem(lsKey(SETUP_KEY));
  undoClear();
}

// A signed-in editor whose first setup snapshot has landed, on a fake database.
async function ssSetup(server, opts) {
  freshState();
  ssReset();
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  window.firebase = makeFakeFirebase(db);
  if (server !== undefined && server !== null) db.serverSet(SS_PATH, server);
  if (opts && opts.cache) {
    localStorage.setItem(lsKey(SETUP_KEY), JSON.stringify(opts.cache));
    setupLoadCache();
  }
  setupRef = db.ref(SS_PATH);
  attachSetupListener();
  if (!(opts && opts.hold)) { db.deliverFirstSnapshots(); await ssWait(5); }
  return db;
}

function ssTeardown() {
  setupPushMs = SETUP_PUSH_MS;
  delete window.FIREBASE_CONFIG;
  delete window.firebase;
  setupRef = null;
  ssReset();
  setMemberRole(null);
  authUser = null;
  memberDirectory = null;
  memberDirectoryLoaded = false;
}

// Another device's edit, as the server stores it.
function ssServer(db, fn) {
  const cur = db.serverGet(SS_PATH) || {};
  fn(cur);
  db.serverSet(SS_PATH, cur);
}

function ssToasts(fn) {
  const real = showToast;
  const toasts = [];
  showToast = (msg, opts) => { toasts.push(msg); };
  const done = () => { showToast = real; };
  let out;
  try { out = fn(toasts); } catch (e) { done(); throw e; }
  if (out && typeof out.then === 'function') return out.then((v) => { done(); return v; }, (e) => { done(); throw e; });
  done();
  return out;
}

const ssUpdates = (db) => db.log.filter((l) => l.kind === 'update' || l.kind === 'set');

// ── the tree: heal, canonical form, depths ───────────────────────────

test('normalizeSetup makes every container and all seven days exist, and never rewrites a stored value', () => {
  const t = normalizeSetup({});
  ['meta', 'days', 'typical', 'patches', 'dayBlocks', 'meals', 'verses', 'cleanup', 'electives'].forEach((k) => assert.ok(setupIsMap(t[k]), k));
  ['on', 'skip', 'edited'].forEach((k) => assert.ok(setupIsMap(t.meta[k]), 'meta.' + k));
  assert.ok(setupIsMap(t.verses.days) && setupIsMap(t.electives.stations) && setupIsMap(t.electives.slots));
  assert.deepEqual(Object.keys(t.days), SETUP_DK, 'all seven day records');
  SETUP_DK.forEach((dk) => assert.deepEqual(t.days[dk], { typical: false, tag: '' }));
  // Stored values are never repaired: a bad one stays exactly as it was (readers skip it).
  const bad = { typical: { 'b-x-1': { start: 'noon', label: 5 } }, days: { mon: { typical: true, tag: 'Day 1' } } };
  normalizeSetup(bad);
  assert.deepEqual(bad.typical['b-x-1'], { start: 'noon', label: 5 });
  assert.deepEqual(bad.days.mon, { typical: true, tag: 'Day 1' });
});

test('normalizeSetup coerces a map that came back as an array, and junk containers', () => {
  const t = normalizeSetup({ typical: ['a', null, 'c'], meals: 'oops', days: 7, patches: { tue: ['x'] }, meta: [] });
  assert.deepEqual(t.typical, { 0: 'a', 2: 'c' });
  assert.deepEqual(t.meals, {});
  assert.ok(setupIsMap(t.days) && t.days.mon.typical === false);
  assert.deepEqual(t.patches.tue, { 0: 'x' });
  assert.ok(setupIsMap(t.meta) && setupIsMap(t.meta.on));
  assert.doesNotThrow(() => normalizeSetup(null));
  assert.doesNotThrow(() => normalizeSetup('junk'));
});

test('the canonical form drops what is not an edit: default days, meta/edited, empties, key order', () => {
  const a = normalizeSetup(ssTree());
  a.meta.edited = { schedule: { at: 5, byKey: 'x' } };
  const b = ssTree();
  b.days = Object.assign({ fri: { typical: false, tag: '' } }, b.days); // a stored default day: the same as no record
  assert.equal(JSON.stringify(setupCanon(a)), JSON.stringify(setupCanon(b)));
  assert.equal(setupCanon(a).meta.edited, undefined);
  assert.equal(setupCanon(a).days.fri, undefined, 'the in-memory fillers never reach a diff');
  assert.deepEqual(setupDiff(a, b), {}, 'so none of them can be pushed as an edit nobody made');
  assert.deepEqual(setupCanon({ typical: {}, patches: { tue: {} } }), {}, 'empties are pruned like the server does');
});

test('setupDiff recurses to each shape\'s depth: fields of a block, a meal whole, a rota leaf, a verse day whole', () => {
  const a = ssTree();
  // (a section that does not exist yet is created WHOLE by the first edit into it — a create is one op —
  // so the rest of the sections are given something to diff against first)
  a.verses = { theme: { text: 'Theme' }, days: { tue: { text: 'Tue' } } };
  a.electives = { stations: { 'st-old': { name: 'Old' } }, slots: { tue: { s1: { 'st-old': { ord: 1 } } } } };
  const b = ssClone(a);
  b.typical['b-swim-900'].start = 870;                       // a field of a typical block
  b.patches.tue['b-swim-900'].teams = { t0: true };           // a patch field (teams is a leaf)
  b.dayBlocks.sun['b-sun-registration-840'].label = 'Check-in'; // a field of a one-off
  b.meals.mon.lunch = { dish: 'Tacos' };                      // a meal replaced WHOLE (emoji gone with it)
  b.cleanup.mon.lunch.t3 = true;                              // one team leaf
  b.verses = { theme: { text: 'x' }, days: { tue: { text: 'Tue' }, mon: { text: 'a' } } };
  b.electives.stations['st-art'] = { name: 'Art' };
  b.electives.slots.mon = { s0: { 'st-art': { ord: 10, people: { 'n-lily': { name: 'Lily', ord: 1 } } } } };
  b.meta.double = { fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 };
  b.meta.on.cleanup = true;
  const d = setupDiff(a, b);
  assert.deepEqual(Object.keys(d).sort(), [
    'cleanup/mon/lunch/t3',
    'dayBlocks/sun/b-sun-registration-840/label',
    'electives/slots/mon/s0/st-art', // a new day is cut to its RECORDS (step 19: a colleague's first write beside it is not overwritten)
    'electives/stations/st-art',
    'meals/mon/lunch',
    'meta/double',
    'meta/on/cleanup',
    'patches/tue/b-swim-900/teams',
    'typical/b-swim-900/start',
    'verses/days/mon',
    'verses/theme',
  ]);
  assert.deepEqual(d['meals/mon/lunch'], { dish: 'Tacos' });
  // An existing slot: the order and one person are separate leaves.
  const c = ssClone(b);
  c.electives.slots.mon.s0['st-art'].ord = 20;
  c.electives.slots.mon.s0['st-art'].people['n-sam'] = { name: 'Sam', ord: 2 };
  assert.deepEqual(Object.keys(setupDiff(b, c)).sort(), ['electives/slots/mon/s0/st-art/ord', 'electives/slots/mon/s0/st-art/people/n-sam']);
  // A deleted block is one null; its patch is a separate path (nothing strips it for you).
  const e = ssClone(a);
  delete e.typical['b-swim-900'];
  assert.deepEqual(setupDiff(a, e), { 'typical/b-swim-900': null });
});

test('setupApplyOps drops a field into a vanished record, a patch with no block or on a day of its own, and a different record under a taken id', () => {
  const t = setupCanon(ssTree());
  const ops = {
    'typical/b-gone-1/start': 600,                                  // record absent
    'typical/b-swim-900/end': 975,                                  // fine
    'patches/tue/b-swim-900/label': 'Swim — Pat',                   // fine
    'patches/tue/b-gone-1/label': 'x',                              // its block is gone
    'patches/sun/b-swim-900/label': 'y',                            // Sunday has its own schedule
    'dayBlocks/sun/b-sun-registration-840': { start: 1, end: 2, label: 'Different' }, // taken id, different content
    'dayBlocks/sun/b-new-1': { start: 1000, end: 1100, label: 'New', type: 'activity' },
    'typical/b-nothing-1/end': null,                                // a delete into nothing is not news
  };
  const r = setupApplyOps(t, ops);
  assert.equal(r.tree.typical['b-swim-900'].end, 975);
  assert.equal(r.tree.patches.tue['b-swim-900'].label, 'Swim — Pat');
  assert.equal(r.tree.typical['b-gone-1'], undefined);
  assert.equal(r.tree.dayBlocks.sun['b-new-1'].label, 'New');
  assert.equal(r.tree.dayBlocks.sun['b-sun-registration-840'].label, 'Registration', 'a collision never overwrites');
  const byPath = {};
  r.dropped.forEach((d) => { byPath[d.path] = d; });
  assert.deepEqual(Object.keys(byPath).sort(), ['dayBlocks/sun/b-sun-registration-840', 'patches/sun/b-swim-900/label', 'patches/tue/b-gone-1/label', 'typical/b-gone-1/start']);
  assert.equal(byPath['patches/tue/b-gone-1/label'].why, 'block');
  assert.equal(byPath['patches/sun/b-swim-900/label'].why, 'day');
  assert.equal(byPath['dayBlocks/sun/b-sun-registration-840'].collide, true);
  assert.equal(byPath['typical/b-gone-1/start'].record, 'typical/b-gone-1');
  // The same record, identical, is simply already true.
  assert.deepEqual(setupApplyOps(t, { 'dayBlocks/sun/b-sun-registration-840': ssTree().dayBlocks.sun['b-sun-registration-840'] }).dropped, []);
  // The input tree is never mutated.
  assert.deepEqual(t, setupCanon(ssTree()));
});

test('the words for a path read as sentences ("Tuesday only · Swim · name")', () => {
  const t = setupCanon(ssTree());
  assert.equal(setupWhat('typical/b-swim-900/start', t), 'Typical day · Swim · starts');
  assert.equal(setupWhat('patches/tue/b-swim-900/label', t), 'Tuesday only · Swim · name');
  assert.equal(setupWhat('dayBlocks/sun/b-sun-registration-840/end', t), 'Sunday · Registration · ends');
  assert.equal(setupWhat('meals/mon/lunch', t), 'Monday · Lunch');
  assert.equal(setupWhat('meta/weekStart', t), 'Camp week · start date');
  assert.equal(setupClock(900), '3:00 PM');
  assert.equal(setupClock(0), '12:00 AM');
  assert.equal(setupClock(1440), 'end of day');
  assert.equal(setupShow('typical/b-swim-900/start', 870), '2:30 PM');
});

// ── dark: nothing writes until a director acts ──────────────────────

test('dark: an empty node is "not set up yet" — the engine attaches, reads, and NEVER seeds', async () => {
  const db = await ssSetup(null);
  try {
    assert.equal(setupReady, true);
    assert.equal(setupOn('schedule'), false);
    assert.equal(setupSeeded(), false);
    assert.deepEqual(setupBase, {});
    assert.equal(ssUpdates(db).length, 0, 'no write of any kind: ' + JSON.stringify(db.log));
    assert.equal(db.serverGet(SS_PATH), null);
    await ssWait(SS_FLUSH);
    assert.equal(ssUpdates(db).length, 0);
    assert.equal(db.listenerCount(SS_PATH), 1, 'one listener, read-only');
  } finally { ssTeardown(); }
});

test('dark: a snapshot adopted on an editor writes nothing either (no repair, no stamp)', async () => {
  const db = await ssSetup(ssTree());
  try {
    assert.equal(setupOn('schedule'), true);
    assert.equal(setupTree.typical['b-swim-900'].label, 'Swim');
    await ssWait(SS_FLUSH);
    assert.equal(ssUpdates(db).length, 0, JSON.stringify(db.log));
    assert.equal(db.serverGet(SS_PATH).days.fri, undefined, 'the in-memory day records were not pushed');
  } finally { ssTeardown(); }
});

test('an EMPTY server node (no meta at all) gates exactly like a seeded one: no coarse `meta` op slips past the owner or the section check', async () => {
  const db = await ssSetup(null);
  try {
    memberDirectory[OWNER_MEMBER_KEY] = { role: 'editor', name: 'Patrick Simpson' };
    const cases = {
      on: (d) => { d.meta.on = { schedule: true }; },
      epoch: (d) => { d.meta.epoch = 'w20270718'; },
      wizard: (d) => { d.meta.wizard = { step: 1, byKey: 'x', at: 1, fromEpoch: 'legacy' }; },
      seeded: (d) => { d.meta.seeded = { at: 1, byKey: 'x', from: 'camps.js' }; },
    };
    Object.keys(cases).forEach((f) => {
      const r = commitSetup(cases[f], { label: 'x', turningOn: true });
      assert.equal(r.ok, false, f);
      assert.equal(r.reason, 'owner', f);
    });
    assert.equal(setupTree.meta.epoch, undefined, 'nothing was applied');
    assert.equal(setupOn('schedule'), false);
    await ssWait(SS_FLUSH);
    assert.equal(ssUpdates(db).length, 0);
    // The always-on week fields are the one thing a director may write into an empty node,
    // and they go out as per-field leaves beside the stamp — never as `meta` + `meta/edited/…`
    // (an update() with an ancestor and a descendant path throws).
    const w = commitSetup((d) => { d.meta.weekStart = '2027-07-25'; }, { label: 'Moved the week' });
    assert.equal(w.ok, true);
    assert.equal(w.ops.meta, undefined);
    assert.equal(w.ops['meta/weekStart'], '2027-07-25');
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).meta.weekStart, '2027-07-25');
  } finally { ssTeardown(); }
});

test('setupTreeDiff turns a coarse meta op into per-field leaves, both ways', () => {
  assert.deepEqual(setupTreeDiff({}, { meta: { weekStart: '2027-07-18', on: { schedule: true } } }), { 'meta/on': { schedule: true }, 'meta/weekStart': '2027-07-18' });
  assert.deepEqual(setupTreeDiff({ meta: { weekStart: '2027-07-18', epoch: 'e' } }, {}), { 'meta/epoch': null, 'meta/weekStart': null });
  assert.deepEqual(setupTreeDiff({ meta: { weekStart: 'a' } }, { meta: { weekStart: 'b' } }), { 'meta/weekStart': 'b' });
});

test('the switch is the owner\'s: with every section off, a commit into one is refused ("off") and writes nothing', async () => {
  const db = await ssSetup({ meta: { schema: 1, weekStart: '2027-07-18' } });
  try {
    const r = commitSetup((d) => { d.typical['b-x-100'] = { start: 100, end: 200, label: 'X', type: 'activity' }; }, { label: 'Added X' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'off');
    assert.equal(r.section, 'schedule');
    assert.equal(setupTree.typical['b-x-100'], undefined);
    await ssWait(SS_FLUSH);
    assert.equal(ssUpdates(db).length, 0);
    // The always-on week fields are the one exception: they exist before any section is on.
    const w = commitSetup((d) => { d.meta.weekStart = '2027-07-25'; }, { label: 'Moved the week' });
    assert.equal(w.ok, true);
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).meta.weekStart, '2027-07-25');
  } finally { ssTeardown(); }
});

test('owner-only fields are refused before any write unless the owner commits them (meta/on, epoch, wizard, seed)', async () => {
  const db = await ssSetup({ meta: { schema: 1 } });
  try {
    memberDirectory[OWNER_MEMBER_KEY] = { role: 'editor', name: 'Patrick Simpson' };
    const turnOn = (d) => { d.meta.on.schedule = true; };
    let r = commitSetup(turnOn, { label: 'Turned on', turningOn: true, ownerWhat: 'turn on editing' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'owner');
    assert.equal(r.message, 'Only Patrick can turn on editing.');
    ['epoch', 'epochAt', 'wizard', 'seeded'].forEach((f) => {
      const v = f === 'epoch' ? 'w20270718' : f === 'epochAt' ? 5 : f === 'wizard' ? { step: 1, byKey: 'x', at: 1, fromEpoch: 'legacy' } : { at: 1, byKey: 'x', from: 'camps.js' };
      const res = commitSetup((d) => { d.meta[f] = v; }, { label: 'x' });
      assert.equal(res.reason, 'owner', f);
    });
    assert.equal(setupTree.meta.on.schedule, undefined, 'nothing was applied');
    await ssWait(SS_FLUSH);
    assert.equal(ssUpdates(db).length, 0);
    // The owner, signed in as themselves, can.
    authUser = { email: 'Patricksimpson.FX@gmail.com', emailVerified: true };
    r = commitSetup(turnOn, { label: 'Turned on', turningOn: true });
    assert.equal(r.ok, true);
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).meta.on.schedule, true);
  } finally { ssTeardown(); }
});

test('a viewer, a read-only tab and "still loading" are refused with a reason, writing nothing', async () => {
  const db = await ssSetup(ssTree());
  try {
    const edit = () => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'x' });
    setMemberRole('viewer');
    assert.equal(edit().reason, 'readonly');
    setMemberRole('editor');
    tabWriter = false;
    assert.equal(edit().reason, 'readonly', 'a second tab is view-only');
    tabWriter = true;
    setupReady = false; setupBase = null; // before the first pull, on a phone with no baseline
    assert.equal(edit().reason, 'loading');
    setupReady = true;
    setupDenied = true;
    assert.equal(edit().reason, 'loading', 'rules not published: not editable');
    assert.equal(setupTree.typical['b-swim-900'].start, 900);
    await ssWait(SS_FLUSH);
    assert.equal(ssUpdates(db).length, 0);
  } finally { ssTeardown(); }
});

// ── committing and pushing ──────────────────────────────────────────

test('a commit applies at once, persists immediately, and goes up as one update of exactly the changed paths, plus the section stamp', async () => {
  const db = await ssSetup(ssTree());
  try {
    const r = ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; d.meals.mon.lunch.dish = 'Tacos'; }, { label: 'Moved Swim to 2:30 PM' }));
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.ops).sort(), ['meals/mon/lunch', 'typical/b-swim-900/start']);
    assert.equal(setupTree.typical['b-swim-900'].start, 870, 'applied at once');
    const cached = JSON.parse(localStorage.getItem(lsKey(SETUP_KEY)));
    assert.equal(cached.tree.typical['b-swim-900'].start, 870, 'persisted in the same tick: a force-quit right after a tap is safe');
    assert.equal(cached.base.typical['b-swim-900'].start, 900, 'while the confirmed base still says what the server holds');
    assert.ok(setupPushTimer != null, 'a push is queued');
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 900, 'nothing sent yet (300 ms coalescing)');
    await ssWait(SS_FLUSH);
    const sv = db.serverGet(SS_PATH);
    assert.equal(sv.typical['b-swim-900'].start, 870);
    assert.equal(sv.typical['b-lunch-720'].start, 720, 'a path nobody touched is not rewritten');
    assert.equal(sv.meals.mon.lunch.dish, 'Tacos');
    const upd = ssUpdates(db).filter((l) => l.kind === 'update').pop();
    const sp = dbPath('setup') + '/';
    assert.deepEqual(upd.paths.sort(), [sp + 'meals/mon/lunch', sp + 'meta/edited/meals', sp + 'meta/edited/schedule', sp + 'typical/b-swim-900/start'], 'one stamp per section touched rides along; nothing else does');
    assert.equal(sv.meta.edited.schedule.byKey, SS_JENN_KEY, 'stamped with the writer\'s identity');
    assert.equal(typeof sv.meta.edited.schedule.at, 'number', 'and the server\'s clock');
    assert.equal(setupPending, 0);
    assert.equal(setupBase.typical['b-swim-900'].start, 870, 'the ack advanced the confirmed base');
    assert.deepEqual(setupUnconfirmed(), {});
    assert.equal(JSON.parse(localStorage.getItem(lsKey(SETUP_KEY))).base.typical['b-swim-900'].start, 870, 'and it was persisted');
  } finally { ssTeardown(); }
});

test('stamps are never part of a diff: meta/edited is excluded from the diffed tree, from unconfirmed work and from the cache tree', async () => {
  const db = await ssSetup(ssTree());
  try {
    ssToasts(() => commitSetup((d) => { d.typical['b-lunch-720'].label = 'Big lunch'; }, { label: 'Renamed Lunch' }));
    await ssWait(SS_FLUSH);
    assert.ok(db.serverGet(SS_PATH).meta.edited, 'the server holds a stamp');
    assert.equal(setupCanon(setupTree).meta.edited, undefined);
    assert.equal(setupBase.meta && setupBase.meta.edited, undefined, 'the confirmed base never holds one');
    assert.deepEqual(setupUnconfirmed(), {});
    assert.equal(JSON.parse(localStorage.getItem(lsKey(SETUP_KEY))).tree.meta.edited, undefined);
    assert.equal(setupEditedBy('schedule').name, 'You', 'the hub can still say who changed what (from the server\'s stamps, kept apart from the tree)');
    // A colleague's stamp arrives with their snapshot; names resolve through the directory.
    ssServer(db, (c) => { c.typical['b-lunch-720'].start = 725; c.meta.edited.schedule = { at: Date.now(), byKey: SS_PAT_KEY }; });
    await ssWait(5);
    assert.equal(setupEditedBy('schedule').name, 'Pat');
    memberDirectory = null; memberDirectoryLoaded = false;
    assert.equal(setupEditedBy('schedule').name, 'Another director', 'no directory: fail closed');
  } finally { ssTeardown(); }
});

test('a bare focus-and-blur writes nothing, and a field the director really changed is the only write', async () => {
  const db = await ssSetup(ssTree());
  try {
    const path = 'typical/b-swim-900/start';
    setupFocusIn(path);
    let out = setupFocusOut(path, 900);
    assert.equal(out.changed, false, 'tapped or tabbed through: the caller commits nothing');
    // And even if a caller commits the unchanged value, it is a no-op with no stamp and no undo.
    const r = commitSetup((d) => { d.typical['b-swim-900'].start = 900; }, { label: 'x' });
    assert.equal(r.ok, true);
    assert.equal(r.noop, true);
    assert.equal(undoRecent().length, 0);
    await ssWait(SS_FLUSH);
    assert.equal(ssUpdates(db).length, 0);
    setupFocusIn(path);
    assert.equal(setupFocusOut(path, 870).changed, true);
  } finally { ssTeardown(); }
});

test('a colleague\'s change under a FOCUSED field is held, not written into the input (and recorded as owed)', async () => {
  const db = await ssSetup(ssTree());
  try {
    const path = 'typical/b-swim-900/start';
    setupFocusIn(path);
    ssServer(db, (c) => { c.typical['b-swim-900'].start = 870; });
    await ssWait(5);
    assert.equal(setupTree.typical['b-swim-900'].start, 870, 'the data applied at once');
    assert.deepEqual(setupFocusOwed[path], { theirs: 870, mine: 900 }, 'the input is told, not overwritten');
    const out = setupFocusOut(path, 900);
    assert.equal(out.changed, false);
    assert.deepEqual(out.owed, { theirs: 870, mine: 900 }, 'blur without a choice adopts his value silently');
    assert.equal(setupFocusOwed[path], undefined);
  } finally { ssTeardown(); }
});

test('NO automatic patch stripping: a typical-day edit never touches another day\'s patch, even when it now looks equal', async () => {
  const db = await ssSetup(ssTree());
  try {
    const r = ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].label = 'Swim — Cam'; }, { label: 'Renamed Swim' }));
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.ops), ['typical/b-swim-900/label'], 'no patch op rode along');
    await ssWait(SS_FLUSH);
    assert.deepEqual(db.serverGet(SS_PATH).patches, { tue: { 'b-swim-900': { label: 'Swim — Cam' } } }, 'Tuesday\'s patch is still there');
    // Deleting the block leaves the patch row in the data; readers skip it instead of the engine "repairing" it.
    ssToasts(() => commitSetup((d) => { delete d.typical['b-swim-900']; }, { label: 'Removed Swim' }));
    assert.ok(setupTree.patches.tue['b-swim-900'], 'still stored (a later put-back would find it)');
    assert.deepEqual(setupLivePatches('tue'), {}, 'but nothing reads it while its block is gone');
    await ssWait(SS_FLUSH);
    assert.ok(db.serverGet(SS_PATH).patches.tue['b-swim-900'], 'and it was not deleted on the server by a diff nobody made');
  } finally { ssTeardown(); }
});

test('the existence check: an edit into an item a colleague removed is refused — "removed", with who', async () => {
  const db = await ssSetup(ssTree());
  try {
    ssServer(db, (c) => { delete c.typical['b-swim-900']; c.meta.edited = { schedule: { at: Date.now(), byKey: SS_PAT_KEY } }; });
    await ssWait(5);
    const r = commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'x', expect: ['typical/b-swim-900'] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'removed');
    assert.deepEqual(r.paths, ['typical/b-swim-900']);
    assert.equal(r.byName, 'Pat', '"Pat removed this item"');
    // Without `expect`, a mutate that recreates half a record is still caught by the anchor rule.
    const half = commitSetup((d) => { d.typical['b-swim-900'] = { end: 999 }; }, { label: 'x' });
    assert.equal(half.ok, true, 'a whole new record is a create, not a field write');
  } finally { ssTeardown(); }
});

// ── the first snapshot: a three-way merge, per path ─────────────────

function ssCache(tree, base, extra) {
  return Object.assign({ v: 1, tree, base, baseAt: Date.now(), epoch: '', clashes: [], quarantine: {} }, extra || {});
}

test('an edit saved on a phone that never reached the server survives a reload: re-applied and pushed on the first snapshot', async () => {
  const base = setupCanon(ssTree());
  const edited = ssClone(base);
  edited.typical['b-swim-900'].start = 870;
  const server = ssTree();
  server.meals.mon.lunch.dish = 'Tacos'; // a colleague changed something else meanwhile
  const db = await ssSetup(server, { cache: ssCache(edited, base) });
  try {
    assert.equal(setupTree.typical['b-swim-900'].start, 870, 'the cached edit is on screen even before the server answers (dead Wi-Fi)');
    assert.equal(setupTree.meals.mon.lunch.dish, 'Tacos', 'and the colleague\'s change arrived');
    await ssWait(SS_FLUSH);
    const sv = db.serverGet(SS_PATH);
    assert.equal(sv.typical['b-swim-900'].start, 870, 'mine was pushed');
    assert.equal(sv.meals.mon.lunch.dish, 'Tacos', 'theirs was kept');
    const upd = ssUpdates(db).filter((l) => l.kind === 'update').pop();
    assert.ok(!upd.paths.some((p) => /meals/.test(p)), 'only my path went up: ' + upd.paths);
    assert.deepEqual(setupClashes, []);
  } finally { ssTeardown(); }
});

test('the same path changed on both sides keeps the SERVER\'s value; mine is listed, persisted, and undoable; Use mine writes it with undo', async () => {
  const base = setupCanon(ssTree());
  const edited = ssClone(base);
  edited.typical['b-swim-900'].start = 870;
  const server = ssTree();
  server.typical['b-swim-900'].start = 885;
  server.meta.edited = { schedule: { at: Date.now(), byKey: SS_PAT_KEY } };
  const db = await ssSetup(server, { cache: ssCache(edited, base) });
  try {
    await ssToasts(async () => { await ssWait(5); });
    assert.equal(setupTree.typical['b-swim-900'].start, 885, 'the server won');
    assert.equal(setupClashes.length, 1);
    const c = setupClashes[0];
    assert.equal(c.kind, 'clash');
    assert.equal(c.path, 'typical/b-swim-900/start');
    assert.equal(c.mine, 870);
    assert.equal(c.theirs, 885);
    assert.equal(c.what, 'Typical day · Swim · starts');
    assert.equal(c.byKey, SS_PAT_KEY);
    assert.equal(setupEditorName(c.byKey), 'Pat');
    // persisted with the cache: it survives a reload
    assert.equal(JSON.parse(localStorage.getItem(lsKey(SETUP_KEY))).clashes.length, 1);
    // the synthetic undo entry changes MINE into THEIRS, so undoing it brings mine back
    const entry = undoRecent()[0];
    assert.equal(entry.label, 'Bring back your offline change to Typical day · Swim · starts');
    assert.deepEqual(entry.ops, [['setup', 'typical/b-swim-900/start', 870, 885]]);
    const res = ssToasts(() => undoEntry(entry.id));
    assert.equal(res.applied, 1);
    assert.equal(setupTree.typical['b-swim-900'].start, 870, 'Undo brought my offline change back');
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 870);
  } finally { ssTeardown(); }
});

test('Use mine is a normal commit; Dismiss just forgets the clash', async () => {
  const base = setupCanon(ssTree());
  const edited = ssClone(base);
  edited.typical['b-swim-900'].start = 870;
  const server = ssTree();
  server.typical['b-swim-900'].start = 885;
  const db = await ssSetup(server, { cache: ssCache(edited, base) });
  try {
    ssToasts(() => {
      const id = setupClashes[0].id;
      const r = setupUseMine(id);
      assert.equal(r.ok, true);
      assert.equal(setupTree.typical['b-swim-900'].start, 870);
      assert.equal(setupClashes.length, 0, 'the note is gone');
    });
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 870);
    // Dismiss
    setupClashes = [{ id: 'nx', kind: 'clash', path: 'meta/weekStart', mine: '2027-08-01', theirs: '2027-07-18', what: 'w', at: '' }];
    setupDismissClash('nx');
    assert.deepEqual(setupClashes, []);
  } finally { ssTeardown(); }
});

test('prune and key-order variants: an empty stored value and a differently ordered snapshot are not somebody else\'s edit', async () => {
  const base = setupCanon(ssTree());
  const edited = ssClone(base);
  edited.typical['b-swim-900'].start = 870;
  // The server hands back the same tree with keys in another order and an empty container.
  const server = { cleanup: { mon: { lunch: { t0: true } } }, typical: { 'b-lunch-720': ssTree().typical['b-lunch-720'], 'b-swim-900': ssTree().typical['b-swim-900'] }, meals: ssTree().meals, dayBlocks: ssTree().dayBlocks, patches: ssTree().patches, days: ssTree().days, meta: ssTree().meta };
  server.verses = {}; // pruned by RTDB, so it never arrives
  const db = await ssSetup(server, { cache: ssCache(edited, base) });
  try {
    await ssWait(SS_FLUSH);
    assert.deepEqual(setupClashes, [], 'no phantom clash');
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 870, 'my edit went up exactly once');
    assert.equal(ssUpdates(db).filter((l) => l.kind === 'update').length, 1);
  } finally { ssTeardown(); }
});

test('a kept edit whose record the server deleted goes to the Put-it-back list instead of being pushed into a refusal', async () => {
  const base = setupCanon(ssTree());
  const edited = ssClone(base);
  edited.typical['b-swim-900'].end = 975;
  const server = ssTree();
  delete server.typical['b-swim-900'];
  const db = await ssSetup(server, { cache: ssCache(edited, base) });
  try {
    assert.equal(setupTree.typical['b-swim-900'], undefined);
    const note = setupClashes.find((n) => n.kind === 'putback');
    assert.ok(note, 'listed: ' + JSON.stringify(setupClashes));
    assert.equal(note.record, 'typical/b-swim-900');
    assert.equal(note.name, 'Swim');
    assert.equal(note.value.end, 975, 'with my change');
    await ssWait(SS_FLUSH);
    assert.ok(!ssUpdates(db).some((l) => l.paths && l.paths.some((p) => /b-swim-900/.test(p))), 'nothing was sent into the missing record');
    // Put it back: the whole record, with my edit, as a normal commit.
    const r = ssToasts(() => setupPutBack(note.id));
    assert.equal(r.ok, true);
    assert.equal(setupTree.typical['b-swim-900'].end, 975);
    assert.equal(setupClashes.length, 0);
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].end, 975);
  } finally { ssTeardown(); }
});

test('work from a PREVIOUS camp year is stranded as a download, never applied (the epoch moved)', async () => {
  const base = setupCanon(ssTree());
  base.meta.epoch = 'w20260719';
  const edited = ssClone(base);
  edited.typical['b-swim-900'].start = 870;
  const server = ssTree();
  server.meta.epoch = 'w20270718';
  server.typical['b-swim-900'].start = 885;
  const before = strandedCount();
  const db = await ssSetup(server, { cache: ssCache(edited, base, { epoch: 'w20260719' }) });
  try {
    assert.equal(setupTree.typical['b-swim-900'].start, 885, 'the server\'s week, not last year\'s edit');
    assert.equal(strandedCount(), before + 1, 'the edit is set aside as a download');
    const kept = readStranded()[readStranded().length - 1];
    assert.equal(kept.from, 'w20260719');
    assert.equal(kept.to, 'w20270718');
    assert.equal(kept.changes[0].path, 'setup/typical/b-swim-900/start');
    assert.equal(kept.changes[0].value, 870);
    assert.deepEqual(setupClashes, []);
    assert.equal(undoRecent().length, 0, 'last year\'s undo history is gone');
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 885, 'nothing of last year was pushed');
  } finally { strandedList = []; writeStranded(); ssTeardown(); }
});

test('an EMPTY node on a phone that had content is a deliberate wipe: adopt empty, keep the old copy only as a download, never re-seed', async () => {
  const base = setupCanon(ssTree());
  const before = strandedCount();
  const db = await ssSetup(null, { cache: ssCache(base, base) });
  try {
    assert.deepEqual(setupCanon(setupTree), {}, 'the empty node was adopted');
    assert.equal(setupOn('schedule'), false);
    assert.equal(strandedCount(), before + Object.keys(base).length, 'what the phone held is downloadable');
    await ssWait(SS_FLUSH);
    assert.equal(ssUpdates(db).length, 0, 'and nothing was written back');
    assert.equal(db.serverGet(SS_PATH), null);
  } finally { strandedList = []; writeStranded(); ssTeardown(); }
});

test('unconfirmed work older than 36 hours asks before it is sent; declining keeps it local', async () => {
  const base = setupCanon(ssTree());
  const edited = ssClone(base);
  edited.typical['b-swim-900'].start = 870;
  const asked = [];
  const realConfirm = confirm;
  confirm = (m) => { asked.push(m); return false; };
  let db;
  try {
    db = await ssSetup(ssTree(), { cache: ssCache(edited, base, { baseAt: Date.now() - 40 * 3600 * 1000 }) });
    await ssWait(SS_FLUSH);
    assert.equal(asked.length, 1);
    assert.ok(/1 change/.test(asked[0]), asked[0]);
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 900, 'declined: not sent');
  } finally { confirm = realConfirm; ssTeardown(); }
});

test('a viewer (or a read-only tab) adopts the server verbatim and never pushes', async () => {
  const base = setupCanon(ssTree());
  const edited = ssClone(base);
  edited.typical['b-swim-900'].start = 870; // what a demoted director's phone might still hold
  freshState();
  ssReset();
  setMemberRole('viewer');
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  window.firebase = makeFakeFirebase(db);
  db.serverSet(SS_PATH, ssTree());
  localStorage.setItem(lsKey(SETUP_KEY), JSON.stringify(ssCache(edited, base)));
  setupLoadCache();
  setupRef = db.ref(SS_PATH);
  attachSetupListener();
  db.deliverFirstSnapshots();
  try {
    await ssWait(SS_FLUSH);
    assert.equal(setupTree.typical['b-swim-900'].start, 900, 'the server\'s week');
    assert.equal(ssUpdates(db).length, 0, 'a viewer never writes');
    assert.equal(commitSetup((d) => { d.meta.weekStart = '2027-08-01'; }, {}).reason, 'readonly');
  } finally { ssTeardown(); }
});

// ── later snapshots: rebase, echo, deferral ─────────────────────────

test('an echo of this device\'s own write keeps every live object and repaints nothing', async () => {
  const db = await ssSetup(ssTree());
  try {
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'Moved Swim' }));
    const lunch = setupTree.typical['b-lunch-720'];
    const tree = setupTree;
    const rev = setupRev;
    await ssWait(SS_FLUSH); // the push lands, and the database echoes the value back through the listener
    assert.equal(setupTree, tree, 'the top-level object is the same');
    assert.equal(setupTree.typical['b-lunch-720'], lunch, 'so is every record');
    assert.equal(setupRev, rev, 'and nothing was repainted (rev unchanged)');
  } finally { ssTeardown(); }
});

test('a colleague\'s edit elsewhere keeps the live objects of everything that did not change', async () => {
  const db = await ssSetup(ssTree());
  try {
    const lunch = setupTree.typical['b-lunch-720'];
    const meals = setupTree.meals;
    ssServer(db, (c) => { c.typical['b-swim-900'].end = 975; });
    await ssWait(5);
    assert.equal(setupTree.typical['b-swim-900'].end, 975);
    assert.equal(setupTree.typical['b-lunch-720'], lunch, 'the untouched record is the same object (open sheets, render-stability)');
    assert.equal(setupTree.meals, meals);
  } finally { ssTeardown(); }
});

test('unsent edits (inside the 300 ms window) are rebased onto an incoming snapshot, never lost', async () => {
  const db = await ssSetup(ssTree());
  try {
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'Moved Swim' }));
    assert.ok(setupPushTimer != null);
    ssServer(db, (c) => { c.meals.mon.lunch.dish = 'Tacos'; }); // lands before my push
    await ssWait(5);
    assert.equal(setupTree.meals.mon.lunch.dish, 'Tacos', 'theirs arrived');
    assert.equal(setupTree.typical['b-swim-900'].start, 870, 'mine is still laid over it');
    await ssWait(SS_FLUSH);
    const sv = db.serverGet(SS_PATH);
    assert.equal(sv.typical['b-swim-900'].start, 870, 'and was sent');
    assert.equal(sv.meals.mon.lunch.dish, 'Tacos', 'without undoing his');
  } finally { ssTeardown(); }
});

test('adopt-path dropped ops reach the Put-it-back list: an unsent edit to an item somebody just deleted', async () => {
  const db = await ssSetup(ssTree());
  try {
    ssToasts(() => commitSetup((d) => { d.typical['b-lunch-720'].start = 725; }, { label: 'Moved Lunch' }));
    ssToasts(() => { ssServer(db, (c) => { delete c.typical['b-lunch-720']; }); });
    await ssWait(5);
    assert.equal(setupTree.typical['b-lunch-720'], undefined, 'it is gone');
    const note = setupClashes.find((n) => n.kind === 'putback' && n.record === 'typical/b-lunch-720');
    assert.ok(note, 'listed: ' + JSON.stringify(setupClashes));
    assert.equal(note.name, 'Lunch');
    assert.equal(note.value.start, 725, '"Lunch was removed — Put it back with your changes"');
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).typical['b-lunch-720'], undefined, 'nothing was written into the deleted record');
    // Discard just forgets it.
    setupDismissClash(note.id);
    assert.equal(setupClashes.length, 0);
  } finally { ssTeardown(); }
});

test('a snapshot that arrives while a write is in flight is not adopted: a re-read is owed and paid when quiet, never a replay', async () => {
  const db = await ssSetup(ssTree());
  try {
    db.goOffline();
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'Moved Swim' }));
    await ssWait(SS_FLUSH);
    assert.equal(setupPending, 1, 'the push is queued behind the dead connection');
    assert.equal(pendingWritesTotal() > 0, true, 'and every reload / sign-out guard can see it');
    assert.equal(reloadBlocked(), true);
    onSetupSnapshot(ssTree()); // the server's PREVIOUS value re-fires on reconnect
    assert.equal(setupTree.typical['b-swim-900'].start, 870, 'not reverted');
    assert.equal(setupRefetchOwed, true);
    db.goOnline();
    await ssWait(10);
    assert.equal(setupPending, 0);
    setupIdleTick();
    await ssWait(10);
    assert.equal(setupRefetchOwed, false, 'the owed read ran');
    assert.equal(setupTree.typical['b-swim-900'].start, 870, 'and what it read is the server\'s latest, which includes mine');
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 870);
  } finally { ssTeardown(); }
});

test('an edit made offline goes up on reconnect, in order, and survives a "reload" in between', async () => {
  const db = await ssSetup(ssTree());
  try {
    db.goOffline();
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'Moved Swim' }));
    await ssWait(SS_FLUSH);
    // The phone is force-quit: only the cache survives. The next page load re-reads it.
    const cached = JSON.parse(localStorage.getItem(lsKey(SETUP_KEY)));
    assert.equal(cached.tree.typical['b-swim-900'].start, 870);
    assert.equal(cached.base.typical['b-swim-900'].start, 900, 'the base is what the server last CONFIRMED, so the edit is still unconfirmed work');
    const db2 = await ssSetup(ssTree(), { cache: cached });
    assert.equal(setupTree.typical['b-swim-900'].start, 870);
    await ssWait(SS_FLUSH);
    assert.equal(db2.serverGet(SS_PATH).typical['b-swim-900'].start, 870, 'the first-snapshot merge re-sent it');
  } finally { ssTeardown(); }
});

// ── refusals: bisect and quarantine ─────────────────────────────────

test('a refused path is parked, not a wedge: the rest of the batch goes through; Retry sends it once the rules accept it', async () => {
  const db = await ssSetup(ssTree());
  try {
    db.refuse(SS_PATH + '/typical/b-lunch-720');
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; d.typical['b-lunch-720'].start = 725; d.meals.mon.lunch.dish = 'Tacos'; }, { label: 'Three edits' }));
    await ssWait(SS_FLUSH + 40);
    const sv = db.serverGet(SS_PATH);
    assert.equal(sv.typical['b-swim-900'].start, 870, 'the paths the server took went through');
    assert.equal(sv.meals.mon.lunch.dish, 'Tacos');
    assert.equal(sv.typical['b-lunch-720'].start, 720, 'the refused one did not');
    assert.deepEqual(Object.keys(setupQuarantine), ['typical/b-lunch-720/start']);
    assert.equal(setupQuarantine['typical/b-lunch-720/start'], 725);
    assert.equal(setupParkedCount(), 1);
    assert.equal(setupPending, 0, 'settled');
    assert.equal(setupWriteRefused, false, 'one refusal among several is not "rules not published"');
    assert.equal(setupBase.typical['b-swim-900'].start, 870, 'the confirmed base advanced by exactly what the server took');
    assert.equal(setupBase.typical['b-lunch-720'].start, 720);
    const line = setupSyncLine();
    assert.equal(line.tone, 'error');
    assert.equal(line.text, 'Couldn’t save Typical day · Lunch · starts');
    assert.equal(line.act, 'details');
    assert.ok(setupQuarantineBarHtml().includes('data-setup-quarantine="retry"'));
    assert.equal(hasUnconfirmedLocalWork(), true, 'sign-out must warn: this phone holds work the server refused');
    // The parked value survives a snapshot (the server hasn't moved past it): it stays on screen and parked.
    ssServer(db, (c) => { c.cleanup = { mon: { lunch: { t1: true } } }; });
    await ssWait(5);
    assert.equal(setupTree.typical['b-lunch-720'].start, 725, 'still what the director typed');
    assert.equal(setupParkedCount(), 1);
    assert.deepEqual(Object.keys(treeDiff(setupLast, setupCanon(setupTree), SETUP_DEPTHS)), [], 'and still treated as sent (not retried forever)');
    // Retry once the rules accept it.
    db.allow(SS_PATH + '/typical/b-lunch-720');
    assert.equal(retrySetupQuarantine(), true);
    await ssWait(SS_FLUSH + 40);
    assert.equal(db.serverGet(SS_PATH).typical['b-lunch-720'].start, 725);
    assert.equal(setupParkedCount(), 0);
    assert.equal(setupSyncLine().tone, 'saved');
  } finally { ssTeardown(); }
});

test('Discard puts a parked path back to the confirmed value in the tree AND the diff, so nothing is re-sent', async () => {
  const db = await ssSetup(ssTree());
  try {
    db.refuse(SS_PATH + '/typical/b-lunch-720');
    ssToasts(() => commitSetup((d) => { d.typical['b-lunch-720'].start = 725; d.typical['b-swim-900'].start = 870; }, { label: 'Two edits' }));
    await ssWait(SS_FLUSH + 40);
    assert.equal(setupParkedCount(), 1);
    assert.equal(discardSetupQuarantine(), true, 'confirm() auto-accepts in the harness');
    assert.equal(setupTree.typical['b-lunch-720'].start, 720);
    assert.equal(setupParkedCount(), 0);
    assert.deepEqual(setupUnconfirmed(), {});
    const writes = ssUpdates(db).length;
    pushSetup();
    await ssWait(20);
    assert.equal(ssUpdates(db).length, writes, 'nothing re-sent');
  } finally { ssTeardown(); }
});

test('if EVERY path of a batch is refused, the rules are not published: editing turns off with that sentence, nothing parked', async () => {
  const db = await ssSetup(ssTree());
  try {
    db.refuse(SS_PATH);
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; d.meals.mon.lunch.dish = 'Tacos'; d.meta.weekStart = '2027-07-25'; }, { label: 'Three edits' }));
    await ssWait(SS_FLUSH + 40);
    assert.equal(setupWriteRefused, true);
    assert.equal(setupParkedCount(), 0, 'not forty quarantine rows');
    const line = setupSyncLine();
    assert.equal(line.tone, 'error');
    assert.equal(line.text, 'Editing the week here isn’t available yet — the database rules haven’t been updated');
    assert.equal(commitSetup((d) => { d.meta.weekStart = '2027-08-01'; }, {}).reason, 'loading', 'no more edits are taken');
    assert.equal(syncDenied, false, 'it never touches the state engine\'s terminal flag');
    // Once the owner publishes the rules, Retry sends everything that was waiting.
    db.allow(SS_PATH);
    assert.equal(retrySetupQuarantine(), true);
    await ssWait(SS_FLUSH + 40);
    assert.equal(setupWriteRefused, false);
    const sv = db.serverGet(SS_PATH);
    assert.equal(sv.typical['b-swim-900'].start, 870);
    assert.equal(sv.meals.mon.lunch.dish, 'Tacos');
    assert.equal(sv.meta.weekStart, '2027-07-25');
    assert.equal(setupSyncLine().tone, 'saved');
  } finally { ssTeardown(); }
});

test('a refusal explained by a vanished record (the anchor rules) is parked on its own, never read as "rules not published"', async () => {
  const db = await ssSetup(ssTree());
  try {
    // This phone has just been told the block is gone, but a time move (start + end) that sat in the
    // offline queue lands on reconnect: the rules refuse BOTH paths (every field needs the record's start
    // and label), which would read as "every path refused" if the engine didn't know why.
    setupBase = setupCanon(ssTree());
    delete setupBase.typical['b-lunch-720'];
    assert.equal(setupExplainRefusal('typical/b-lunch-720/start'), 'it was removed');
    assert.equal(setupExplainRefusal('typical/b-swim-900/start'), '', 'an existing record has no such excuse');
    assert.equal(setupExplainRefusal('patches/tue/b-gone-1/label'), 'its item was removed from the typical day');
    assert.equal(setupExplainRefusal('patches/sun/b-swim-900/label'), 'that day follows its own schedule now');
    db.refuse(SS_PATH + '/typical/b-lunch-720');
    setupTree.typical['b-lunch-720'].start = 725;
    setupTree.typical['b-lunch-720'].end = 790;
    setupLast = setupCanon(setupTree);
    ssToasts(() => {});
    await ssToasts(() => bisectSetupBatch({ updates: { 'typical/b-lunch-720/start': 725, 'typical/b-lunch-720/end': 790 }, prev: setupBase }));
    assert.equal(setupWriteRefused, false, 'two refused paths, both explained');
    assert.equal(setupParkedCount(), 2, 'each is parked with its words, for Retry / Discard');
    assert.ok(/Lunch/.test(setupParkedWords()));
  } finally { ssTeardown(); }
});

test('the setup read being refused degrades the setup engine ONLY: syncDenied and fbRef are untouched, and the camp keeps running', async () => {
  const db = await ssSetup(ssTree(), { hold: true });
  const fb = fbRef;
  const warn = console.warn;
  console.warn = () => {};
  try {
    db.revokeRead(SS_PATH);
    await ssWait(5);
    assert.equal(setupDenied, true);
    assert.equal(setupReady, false);
    assert.equal(setupRef, null);
    assert.equal(syncDenied, false, 'the state engine\'s terminal-read invariant is not touched');
    assert.equal(fbRef, fb);
    assert.equal(setupSyncLine().text, 'Editing the week here isn’t available yet');
    assert.equal(setupSyncLine().tone, 'off');
    assert.equal(setupOn('schedule'), false, 'the built-in week keeps running');
  } finally { console.warn = warn; ssTeardown(); }
});

// ── the cache and the tab writer ────────────────────────────────────

test('persistSetup is the one writer: a no-op in a view-only tab, owed (and paid) while the tab\'s decision is pending', async () => {
  const db = await ssSetup(ssTree());
  try {
    const key = lsKey(SETUP_KEY);
    localStorage.removeItem(key);
    tabWriter = false;
    assert.equal(persistSetup(), false);
    assert.equal(localStorage.getItem(key), null, 'a second tab never writes the cache its sibling\'s unconfirmed edits live in');
    tabWriter = null;
    assert.equal(persistSetup(), false);
    assert.equal(setupPersistOwed, true, 'owed while undecided');
    assert.equal(localStorage.getItem(key), null);
    decideTabWriter(true);
    assert.ok(localStorage.getItem(key), 'made the moment the tab is decided a writer');
    assert.equal(setupPersistOwed, false);
    tabWriter = false;
    assert.equal(setupPersistOwed, false);
  } finally { tabWriter = true; ssTeardown(); }
});

test('an undecided tab holds a setup push (queued, not dropped) and sends it once it is decided a writer', async () => {
  const db = await ssSetup(ssTree());
  try {
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'Moved Swim' }));
    tabWriter = null; // the election re-opened
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 900, 'held');
    assert.equal(tabHeldSetup, true);
    assert.equal(editorMidEntry(), true, 'a held push blocks the reload like any unsent edit');
    decideTabWriter(true);
    await ssWait(20);
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 870, 'sent the moment it was decided');
    assert.equal(tabHeldSetup, false);
  } finally { tabWriter = true; ssTeardown(); }
});

test('the cache key is written only through persistSetup: no other setItem of it anywhere', () => {
  ['app.js', 'settings.js', 'chat.js', 'push.js', 'camps.js'].forEach((f) => {
    assert.notOk(/setItem\([^)]*SETUP_KEY/.test(readFixture('../' + f)), f + ' writes the setup cache directly');
  });
  const mine = readFixture('../setup-sync.js');
  const sites = mine.match(/localStorage\.setItem\(lsKey\(SETUP_KEY\)/g) || [];
  assert.equal(sites.length, 1, 'exactly one writer in setup-sync.js');
  assert.ok(/function persistSetup\(\)[\s\S]*?localStorage\.setItem\(lsKey\(SETUP_KEY\)/.test(mine));
});

test('sign-out wipes the setup cache and the restore-point outbox for both camps', () => {
  Object.keys(CAMPS).forEach((cid) => {
    ['campScoreboardSetupV1', 'campSetupRpOutbox'].forEach((b) => localStorage.setItem(b + CAMPS[cid].storageSuffix, '{"v":1}'));
  });
  clearLocalData();
  Object.keys(CAMPS).forEach((cid) => {
    ['campScoreboardSetupV1', 'campSetupRpOutbox'].forEach((b) => assert.equal(localStorage.getItem(b + CAMPS[cid].storageSuffix), null, b + CAMPS[cid].storageSuffix));
  });
});

test('every guard counts the setup engine: pending writes, the timer, the flush, unconfirmed work at sign-out', async () => {
  const db = await ssSetup(ssTree());
  try {
    assert.equal(pendingWritesTotal(), 0);
    assert.equal(hasUnsyncedWork(), false);
    assert.equal(hasUnconfirmedLocalWork(), false);
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'Moved Swim' }));
    assert.equal(hasUnsyncedWork(), true, 'a camp switch asks: an edit is queued');
    assert.equal(editorMidEntry(), true, 'a state snapshot is not adopted mid-setup-commit, and the reload waits');
    assert.equal(hasUnconfirmedLocalWork(), true, 'sign-out asks: the cache is the only copy');
    flushPendingPush(); // pagehide
    assert.equal(setupPushTimer, null, 'the 300 ms timer was flushed');
    assert.equal(pendingWritesTotal(), 1, 'in flight');
    await ssWait(20);
    assert.equal(pendingWritesTotal(), 0);
    assert.equal(hasUnconfirmedLocalWork(), false, 'acknowledged');
    setMemberRole('viewer');
    setupBase = setupCanon(ssTree()); setupTree = normalizeSetup(ssTree()); setupTree.typical['b-swim-900'].start = 1;
    assert.equal(hasUnconfirmedLocalWork(), false, 'a viewer has nothing of its own to lose');
    // A restore point queued offline is unconfirmed work too: sign-out would discard the outbox.
    setMemberRole('editor');
    setupBase = setupCanon(setupTree);
    assert.equal(hasUnconfirmedLocalWork(), false);
    rpOutboxAdd({ rid: 'rp-queued-1', row: { kind: 'manual', at: 1, label: 'x' }, body: '{}' });
    assert.equal(hasUnconfirmedLocalWork(), true, 'sign-out asks while a restore point waits for the network');
    rpOutboxDrop('rp-queued-1');
    assert.equal(hasUnconfirmedLocalWork(), false);
  } finally { localStorage.removeItem(lsKey(RP_OUTBOX_KEY)); ssTeardown(); }
});

test('the idle tick of app.js pays the setup engine\'s owed read (and keeps itself armed while one is owed)', async () => {
  const db = await ssSetup(ssTree());
  try {
    setupRefetchOwed = true;
    ssServer(db, (c) => { c.meals.mon.lunch.dish = 'Tacos'; });
    await ssWait(5);
    setupRefetchOwed = true;
    idleRetryTick();
    await ssWait(10);
    assert.equal(setupRefetchOwed, false);
  } finally { ssTeardown(); }
});

test('a phone with a week already cached boots (the load-time cache read touches only what is initialised)', () => {
  const tree = ssTree();
  const base = setupCanon(tree);
  const cache = JSON.stringify(ssCache(base, base));
  const { makeContext } = nodeRequire('./harness.js');
  const vm = nodeRequire('vm');
  const key = lsKey(SETUP_KEY);
  let boot;
  assert.doesNotThrow(() => { boot = makeContext({ camp: CAMP.id, storage: { [key]: cache } }); }, 'every script loads over a cached setup');
  assert.equal(vm.runInContext("setupTree.typical['b-swim-900'].label", boot.ctx), 'Swim');
  assert.equal(vm.runInContext('setupOn("schedule")', boot.ctx), true, 'the edited week paints before the server answers');
  assert.equal(vm.runInContext('setupReady', boot.ctx), false, 'and nothing is pushed before the first pull');
  // Junk in the cache is ignored, not fatal.
  ['{', 'null', '{"v":2}', '{"v":1,"tree":[]}'].forEach((junk) => {
    assert.doesNotThrow(() => makeContext({ camp: CAMP.id, storage: { [key]: junk } }), junk);
  });
});

// ── undo ────────────────────────────────────────────────────────────

test('undo covers the setup domain: it puts `before` back where the value still equals `after`, as a commit of its own', async () => {
  const db = await ssSetup(ssTree());
  try {
    const entry = ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; d.meals.mon.lunch.dish = 'Tacos'; }, { label: 'Two edits' })).entry;
    assert.ok(entry && entry.ops.every((o) => o[0] === 'setup'));
    await ssWait(SS_FLUSH);
    // A colleague changes one of the two since.
    ssServer(db, (c) => { c.meals.mon.lunch.dish = 'Nachos'; });
    await ssWait(5);
    const res = ssToasts(() => undoEntry(entry.id));
    assert.deepEqual(res, { applied: 1, total: 2 }, 'one of two: his change is left alone');
    assert.equal(setupTree.typical['b-swim-900'].start, 900);
    assert.equal(setupTree.meals.mon.lunch.dish, 'Nachos');
    await ssWait(SS_FLUSH);
    assert.equal(db.serverGet(SS_PATH).typical['b-swim-900'].start, 900, 'the undo syncs like any edit');
    assert.equal(undoRecent()[0].label, 'Undid: Two edits', 'and is itself an entry');
  } finally { ssTeardown(); }
});

test('undo of a delete puts the record back; an Undo into a section that has been switched off is left, not written', async () => {
  const db = await ssSetup(ssTree());
  try {
    const entry = ssToasts(() => commitSetup((d) => { delete d.typical['b-lunch-720']; }, { label: 'Removed Lunch' })).entry;
    assert.equal(setupTree.typical['b-lunch-720'], undefined);
    ssToasts(() => undoEntry(entry.id));
    assert.equal(setupTree.typical['b-lunch-720'].label, 'Lunch');
    const e2 = ssToasts(() => commitSetup((d) => { d.typical['b-lunch-720'].start = 725; }, { label: 'Moved Lunch' })).entry;
    setupTree.meta.on.schedule = false; // the owner switched the section off
    const res = ssToasts(() => undoEntry(e2.id));
    assert.equal(res.applied, 0, 'nothing written into the built-in copy');
    assert.equal(setupTree.typical['b-lunch-720'].start, 725);
  } finally { ssTeardown(); }
});

// ── the sync line ───────────────────────────────────────────────────

test('the sync line speaks in five tones, offline and refused never in the same words', async () => {
  const db = await ssSetup(ssTree());
  fbConnKnown = true; fbConnected = true;
  try {
    assert.deepEqual(setupSyncLine(), { tone: 'saved', text: 'Saved', act: '' });
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'Moved Swim' }));
    assert.equal(setupSyncLine().tone, 'saving');
    await ssWait(SS_FLUSH);
    assert.equal(setupSyncLine().tone, 'saved');
    fbConnected = false;
    assert.deepEqual(setupSyncLine(), { tone: 'offline', text: 'Offline — changes will save when you’re back', act: '' });
    db.goOffline();
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 880; }, { label: 'Moved Swim again' }));
    assert.equal(setupSyncLine().text, 'Offline — 1 change will save when you’re back');
    db.goOnline();
    await ssWait(SS_FLUSH);
    fbConnected = true;
    delete window.FIREBASE_CONFIG;
    assert.equal(setupSyncLine().tone, 'off', 'no sync configured');
    assert.ok(/This device only/.test(setupSyncLine().text));
    window.FIREBASE_CONFIG = { apiKey: 'test' };
    sdkLoadFailed = true;
    assert.equal(setupSyncLine().tone, 'off');
    sdkLoadFailed = false;
  } finally { fbConnKnown = false; fbConnected = false; sdkLoadFailed = false; ssTeardown(); }
});

test('the sync line does not say "Saved" before the first pull has landed', async () => {
  const db = await ssSetup(ssTree(), { hold: true });
  fbConnKnown = true; fbConnected = true;
  try {
    assert.deepEqual(setupSyncLine(), { tone: 'saving', text: 'Connecting…', act: '' });
    db.deliverFirstSnapshots();
    await ssWait(5);
    assert.equal(setupSyncLine().tone, 'saved');
  } finally { fbConnKnown = false; fbConnected = false; ssTeardown(); }
});

test('engine events: a UI layer hears tree, commit and sync changes, and a listener that throws never stops the engine', async () => {
  const db = await ssSetup(ssTree());
  const heard = [];
  const off = onSetupEvent((k) => { heard.push(k); });
  const off2 = onSetupEvent(() => { throw new Error('a broken listener'); });
  const warn = console.warn;
  console.warn = () => {};
  try {
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 870; }, { label: 'Moved Swim' }));
    assert.ok(heard.includes('commit'));
    await ssWait(SS_FLUSH);
    ssServer(db, (c) => { c.meals.mon.lunch.dish = 'Tacos'; });
    await ssWait(5);
    assert.ok(heard.includes('tree'));
    assert.ok(heard.includes('sync'));
    assert.equal(setupTree.meals.mon.lunch.dish, 'Tacos', 'the engine carried on');
    off(); off2();
    const n = heard.length;
    ssToasts(() => commitSetup((d) => { d.typical['b-swim-900'].start = 880; }, { label: 'x' }));
    assert.equal(heard.length, n, 'unsubscribed');
  } finally { console.warn = warn; ssTeardown(); }
});

test('the app runs exactly as before when setup-sync.js never loaded: every hook in app.js is typeof-guarded', () => {
  const vm = nodeRequire('vm');
  const { makeContext } = nodeRequire('./harness.js');
  let boot;
  assert.doesNotThrow(() => { boot = makeContext({ camp: CAMP.id, without: ['setup-sync.js'] }); }, 'the page loads without it');
  const run = (expr) => vm.runInContext(expr, boot.ctx);
  assert.equal(run("typeof setupOn"), 'undefined', 'it really is absent');
  assert.doesNotThrow(() => run(`
    setMemberRole('editor');
    renderAll(); updateSyncIndicator(); updateSyncAlert();
    pendingWritesTotal(); reloadBlocked(); hasUnsyncedWork(); hasUnconfirmedLocalWork(); editorMidEntry();
    flushPendingPush(); idleRetryTick(); armIdleRetry(); idleRetryTick();
    decideTabWriter(true); decideTabWriter(false);
    setMemberRole('viewer'); setMemberRole(null);
    clearLocalData();
    onSyncStatusClick({ target: { closest: () => null } });
  `), 'every guarded call site tolerates the missing engine');
  assert.equal(run('pendingWritesTotal()'), 0);
  assert.equal(run('hasUnconfirmedLocalWork()'), false);
});

test('a node written by a NEWER build is recognised, so readers fall back instead of guessing', async () => {
  const db = await ssSetup({ meta: { schema: 7 } });
  try {
    assert.equal(setupSchemaTooNew(), true);
    setupTree.meta.schema = 1;
    assert.equal(setupSchemaTooNew(), false);
  } finally { ssTeardown(); }
});
