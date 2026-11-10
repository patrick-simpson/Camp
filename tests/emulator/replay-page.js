// Runs INSIDE the app's vm context (tests/harness.js makeContext) for export-replay.mjs — never imported or
// served. It shares the page's global scope exactly as a test file does, so it may use the app's top-level names
// (state, setupTree, setupTurnOn, …) directly. Everything it returns is plain JSON.
//
// rrBoot      a signed-in phone whose three engines (state, config, setup) have passed their first pull — the
//             same boot a1Setup (tests/seed.test.js) does, over a fake database that the caller preloaded
// rrSettle    wait until every write this phone made has been acknowledged
// rrTurnOn    what the owner's tap runs (setupTurnOn), then waits for the engines to settle
// rrUseOriginal  the other button
// rrSnapshot  everything the camp reads from the week, for the fidelity comparison

async function rrBoot(o) {
  authUser = { email: o.email, emailVerified: true };
  setMemberRole(o.role);
  memberName = o.name || null;
  memberDirectory = o.members || {};
  memberDirectoryLoaded = true;
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  fbConnKnown = true; fbConnected = true;
  rpLastAt = 0; rpLastAutoAt = 0; rpWaitMs = 40; setupPushMs = 40;
  localStorage.removeItem(lsKey(RP_OUTBOX_KEY));
  localStorage.removeItem(lsKey(SETUP_KEY));
  setupRef = null; setupReady = false; setupDenied = false; setupWriteRefused = false;
  setupTree = normalizeSetup({}); setupBase = null; setupBaseAt = 0; setupBootBase = null; setupLast = null;
  setupPending = 0; clearTimeout(setupPushTimer); setupPushTimer = null; setupRefetchOwed = false;
  setupQuarantine = {}; setupClashes = []; setupEdited = {}; setupRev = 0;
  undoClear();
  delete state._cfgBase; delete state._cfgNotes;
  configReady = false; cfgFirstPending = null; remoteReady = false; syncDenied = false;
  fbRef = firebase.database().ref(dbPath('state'));
  fbConfigRef = firebase.database().ref(dbPath('config'));
  setupRef = firebase.database().ref(dbPath('setup'));
  fbRef.on('value', (snap) => handleRemoteSnapshot(snap.val()));
  attachConfigListener();
  attachSetupListener();
  __rrDb.deliverFirstSnapshots();
  flushPendingPush();
  await waitUntil(() => remoteReady && configReady && setupReady, 'all three engines to pass their first pull');
  await rrSettle();
  return { remoteReady, configReady, setupReady };
}

async function rrSettle() {
  await waitQuiet();
  await waitUntil(() => pendingWritesTotal() === 0 && !hasUnconfirmedLocalWork() && !pushTimer && !pushConfigTimer && !setupPushTimer,
    'every write this phone made to be acknowledged');
}

// The camp's Sunday, for the dated calendar file and the publisher: the one the export already holds, else a
// placeholder the caller passes (the real week is set on the Camp week screen).
function rrSetWeek(weekStart) {
  pushWeekStart = weekStart;
  pushPublishedSrc = null;
}

async function rrTurnOn(sections, opts) {
  const r = await setupTurnOn(sections, opts || { campRunning: false });
  if (r && r.ok) {
    await waitUntil(() => (r.turnedOn || []).every((s) => setupOn(s)), 'the engine to adopt the switch');
  }
  await rrSettle();
  return JSON.parse(JSON.stringify(r));
}

async function rrUseOriginal(sections) {
  const r = JSON.parse(JSON.stringify(setupUseOriginal(sections)));
  await rrSettle(); // the commit is pushed after a short debounce
  return r;
}

// A2's second door, the hub's "Put games on the schedule": what is still unplaced after the turn-on.
function rrPutGames() {
  return JSON.parse(JSON.stringify(putGamesOnSchedule()));
}

// Force the publisher on (PUSH_SERVICE_URL is blank until phone alerts go live, so today it is dormant) and run it.
async function rrPublish() {
  const real = pushConfigured;
  pushConfigured = () => true;
  try { return JSON.parse(JSON.stringify(await pushRepublishSchedule({ force: true }))); } finally { pushConfigured = real; }
}

function rrOwnerFacts() {
  return { owner: isOwner(), role: memberRole, editor: canEdit(), hasElectives: setupHasElectives(), on: SETUP_SECTIONS.filter(setupOn), weekPhase: campWeek().phase };
}

// Games that sit on no block of their weekday, and the rota days that read TBA, by name — for the report.
function rrPlacement() {
  const out = { unscheduled: [], tba: [] };
  competitionDows().forEach((d) => {
    unscheduledGames(d).forEach((g) => out.unscheduled.push({ dow: d, id: g.id, name: g.name, session: g.session }));
    if (cleanupOnRota(d)) MEAL_CLEANUP_MEALS.forEach((m) => { if (!cleanupTeams(d, m).length) out.tba.push({ dow: d, meal: m }); });
  });
  return JSON.parse(JSON.stringify(out));
}

// ── the fidelity snapshot ──────────────────────────────────────────────────────────────────────────────────
// Every thing the camp reads from the week, flattened to { key: string } so a before and an after can be diffed
// line by line. Time is pinned (campNow, the Date the calendar file stamps) so two snapshots of one week are equal.
const RR_NOW = '2027-07-21T14:30:00.000Z';
const RR_DOWS = [0, 1, 2, 3, 4, 5, 6];
const RR_MEALS = ['Breakfast', 'Lunch', 'Supper'];

function rrSnapshot(o) {
  const opt = o || {};
  const out = {};
  const put = (k, v) => { out[k] = typeof v === 'string' ? v : JSON.stringify(v === undefined ? null : v); };
  const realNow = campNow;
  campNow = () => ({ dow: 9, minutes: 0 }); // no day is "today": no Now pill, no past dimming
  rrSetWeek(opt.weekStart || null);
  try {
    put('shared', scheduleIsShared());
    put('weekDays', weekDays());
    RR_DOWS.forEach((d) => {
      const day = scheduleForDow(d);
      put('schedule/' + d, day);
      day.forEach((b, i) => {
        const key = d + '/' + i + ' ' + b.start + ' ' + b.label;
        put('block-games/' + key, gamesForBlock(d, b).map((g) => g.id + ' ' + g.name));
        const decorated = decorateMealBlock(d, b);
        put('block-dressed/' + key, [decorated.emoji, decorated.label]);
        put('block-meal/' + key, blockMeal(b));
        put('block-cleanup-note/' + key, mealCleanupNote(d, b.label, blockMeal(b)));
        put('block-key/' + key, blockKey(b));
      });
      put('unscheduled/' + d, unscheduledGames(d).map((g) => g.id));
      for (let m = 0; m < 1440; m++) put('banner/' + d + '/' + m, nowBannerHtml(d, m));
      // the schedule sheet, as the person reading it sees it (the timeline; the calendar buttons are in it too)
      scheduleDay = d;
      renderScheduleBody();
      put('sheet/' + d, document.getElementById('schedule-body').innerHTML);
    });
    // the one-day calendar file as a phone with no camp dates set gets it (the legacy file, stamped with the moment it was
    // made, so the stamp is blanked); with dates set it is the week's file for that day (compared below)
    rrSetWeek(null);
    put('ics-legacy-dated', !!campWeek().start);
    const stamp = (s) => s ? s.replace(/DTSTAMP:[0-9TZ]+/g, 'DTSTAMP:*').replace(/X-WR-CALDESC:[^\r\n]*(\r\n [^\r\n]*)*/g, 'X-WR-CALDESC:*') : s;
    RR_DOWS.forEach((d) => put('ics-day-legacy/' + d, stamp(buildDayIcs(d))));
    rrSetWeek(opt.weekStart || null);
    put('ics-week', buildWeekIcs({ now: new Date(RR_NOW) }));
    RR_DOWS.forEach((d) => put('ics-week-day/' + d, buildWeekIcs({ dows: [d], now: new Date(RR_NOW) })));
    const blocks = pushScheduleBlocks(scheduleWeek());
    Object.keys(blocks).forEach((id) => put('push-block/' + blocks[id].dow + ' ' + blocks[id].start + ' ' + blocks[id].label, blocks[id]));
    put('push-block-ids', Object.keys(blocks));
    put('push-catalog', pushBlockCatalog(scheduleWeek()));
    put('push-src', pushScheduleSrc(opt.weekStart || '', blocks));
    RR_DOWS.forEach((d) => {
      RR_MEALS.forEach((m) => {
        put('meal/' + d + '/' + m, mealFor(d, m.toLowerCase()));
        put('meal-start/' + d + '/' + m, mealStart(d, m));
        put('cleanup/' + d + '/' + m, cleanupTeams(d, m));
      });
      put('cleanup-on-rota/' + d, cleanupOnRota(d));
      put('verse/' + d, verseFor(d));
      const el = electivesFor(d);
      put('electives/' + d, el);
      [0, 1, 2].forEach((s) => put('elective-start/' + d + '/' + s, electiveSlotStart(s, d)));
      el.forEach((slot) => (slot || []).forEach((row) => put('station-emoji/' + row[0], stationEmoji(row[0]))));
    });
    put('verse-theme', verseTheme());
    put('staff', staffNames());
    put('teams', teamIds().map((id) => id + ' ' + teamName(id)));
    put('competition-days', competitionDays().map((d) => d.id + ' ' + d.dow));
    put('game-count', allGames().length);
    allGames().forEach((g) => put('game/' + g.id, { name: g.name, session: g.session, dayId: g.dayId }));
  } finally {
    campNow = realNow;
  }
  return out;
}

// ── what a director's taps write once a section is edited here (the owner pressed it; this is somebody else) ───────
// Each is the app's own mutator, one commit, one push. The week screen, the schedule sheets and the section screens
// call exactly these. Returns { done: [what ran], skipped: [{ what, why }], failed: [{ what, why }] } — names only.
async function rrEdits(weekStart) {
  const out = { done: [], skipped: [], failed: [] };
  const run = async (what, fn) => {
    try {
      const r = fn();
      if (r === null) { out.skipped.push({ what, why: 'nothing to edit in this camp' }); return; }
      if (r && r.ok === false) { out.failed.push({ what, why: String(r.reason || 'refused') }); return; }
      await rrSettle();
      out.done.push(what);
    } catch (e) { out.failed.push({ what, why: String(e && e.message || e).slice(0, 120) }); }
  };
  const asItem = (rec, over) => Object.assign({ label: rec.label, emoji: rec.emoji, start: rec.start, end: rec.end, type: rec.type, slot: rec.slot, meal: rec.meal, noTime: rec.noTime, teams: rec.teams, overlapOk: rec.overlapOk }, over || {});
  const typical = Object.keys(setupTree.typical || {}).map((id) => [id, setupTree.typical[id]]).filter(([id, r]) => r && r.type === 'activity' && !r.meal && !r.noTime && !r.teams);
  const pick = typical[3] || typical[0];
  if (weekStart) await run('the Camp week screen sets the dates', () => commitSetup((d) => { d.meta.weekStart = weekStart; }, { label: 'Camp dates' }));
  await run('rename a typical item for every day', () => pick ? commitSetup((d) => schedEditMutate(d, { dk: '', bid: pick[0], item: asItem(pick[1], { label: pick[1].label + ' (edited)' }), scope: 'typical' }), { label: 'Renamed an item' }) : null);
  await run('"Just Tuesday": move an item five minutes on one day', () => pick ? commitSetup((d) => schedEditMutate(d, { dk: 'tue', bid: pick[0], item: asItem(pick[1], { start: pick[1].start + 5, end: pick[1].end + 5 }), scope: 'day' }), { label: 'Tuesday only' }) : null);
  await run('skip an item on one day', () => pick ? commitSetup((d) => schedRemoveMutate(d, { dk: 'thu', bid: pick[0], scope: 'day' }), { label: 'Skipped on Thursday' }) : null);
  await run("add a one-off item on a day (Saturday's own list)", () => commitSetup((d) => { schedAddMutate(d, { dk: 'sat', scope: 'day', item: { label: 'Replay one-off', emoji: '🎈', start: 600, end: 660, type: 'activity' } }); }, { label: 'Added an item' }));
  await run("a meal's dish and emoji", () => sectionIsShared('meals') ? mealsSet('wed', 'lunch', 'Replay dish', '🌮') : null);
  await run("a meal's cleanup teams", () => sectionIsShared('cleanup') ? cleanupSet('wed', 'lunch', ['t0', 't1']) : null);
  await run("a day's memory verse", () => sectionIsShared('verses') ? versesSetDay('wed', { text: 'Replay verse text', ref: 'Psalm 1:1' }) : null);
  await run('the theme verse', () => sectionIsShared('verses') ? versesSetTheme({ text: 'Replay theme text', ref: 'Psalm 2:1', title: 'Replay theme' }) : null);
  let st = null;
  await run('add an elective station to a slot', () => {
    if (!sectionIsShared('electives')) return null;
    const r = electiveStationAddToSlot('Replay station', '🎯', 'wed', 1);
    st = r && r.ok ? r.id : null;
    return r;
  });
  await run('put a typed person on the station', () => st ? electivePersonAdd('wed', 1, st, { name: 'Replay Person' }) : null);
  await run('rename the station', () => st ? electiveStationEdit(st, 'Replay station 2', '🎯') : null);
  return JSON.parse(JSON.stringify(out));
}
