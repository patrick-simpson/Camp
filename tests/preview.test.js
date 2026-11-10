// PREVIEW AS A COUNSELOR (redesign §7.4; BUILD-PLAN Step 24). A director's phone drawn the way a counselor's is, so a
// switch in What counselors see can be checked without a second phone. The risk is not that a counselor reaches it (the
// screen opens for a CONFIRMED director only); it is that the lens leaks a director's view into a "counselor" screen, or
// writes something, or strands a person inside it, or makes the sync engines treat a director as a viewer. Pinned here:
//   1. the lens is three one-line reads (canEdit / standingsVisible / isOwner) plus viewRole, and `memberRole`, the
//      writer election, the auth hint and storage are never touched; nothing about it survives a reload;
//   2. it starts only for a confirmed director on a writer tab, and it ends by Exit, by an absence longer than the
//      shell's ten minutes and by any change that makes the person not a confirmed director (setMemberRole, a second
//      tab taking the writer lock);
//   3. the WHOLE app, walked through every tab, sheet and takeover, shows no points, no places and no director-only
//      row, with the points guard THROWING for a viewer (so a render path that reaches a points reader fails loudly);
//   4. FIDELITY: the page left behind by a preview is the page a real counselor's phone paints, node for node;
//   5. every write gate still holds (nothing reaches the database from a tap in a preview: director acts, chat, phone
//      alerts), and the engines still treat the phone as a director's (a snapshot mid-preview never drops unconfirmed
//      work; a reload is still held for unsent work).

const vm = nodeRequire('vm');
const { makeContext } = nodeRequire('./harness.js');
const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');

installSinks();
const SINKS = __sinkRec;

// The wall clock is pinned (a ?now= preview: Wednesday 10:00 AM camp time, inside the games block). These suites scan every
// string the app writes for a signed number, and the Now card says "Running over · +10 min" in a real overrun hour of the real
// clock, which is a time and not a point: loosening the pattern to ignore it would also let a real "+5" slip, so the suite
// pins the time instead and never depends on the hour it runs.
location.search = '?now=3-1000';
const PV_SEEDED = scheduleIsShared();
const INDEX = readFixture('../index.html');
const APP_SRC = readFixture('../app.js');
const CSS = readFixture('../styles.css');

const LEAK_PATTERNS = [
  [/\bpts?\b/i, 'points'],
  [/(^|[\s(])[+−-]\d+/, 'a signed number'],
  [/\b\d+(st|nd|rd|th)\b/i, 'an ordinal place'],
  [/\b(trail|trails|trailing|behind|ahead)\b/i, 'a gap word'],
];
const SENTENCE_SINKS = ['toast', 'jellyToast', 'notification', 'Notification', 'share', 'clipboard', 'copy'];
const POINTS_WORD = /\bpoints?\b/i;
// Words only a director's screen carries (the director tools, the builder, the reveal remote, the secret sections).
const DIRECTOR_WORDS = /Tell everyone|Award points|Who can sign in|Change history|What counselors see|Run the reveal|Showing now|Quick alerts|Put these back|Restore point/i; // (a game's own rules say "Set up the week" on senior: not that)

function readable(entry) {
  if (entry.kind !== 'innerHTML' && entry.kind !== 'insertAdjacentHTML') return entry.text;
  const attrs = [];
  entry.text.replace(/\s(?:title|aria-label|alt|placeholder|label)="([^"]*)"/g, (m, v) => { attrs.push(v); return m; });
  return entry.text.replace(/<[^>]+>/g, ' ').concat(' ', attrs.join(' '));
}
function leaksIn(entries) {
  const out = [];
  entries.forEach((e) => {
    const text = readable(e);
    LEAK_PATTERNS.forEach(([re, why]) => { if (re.test(text)) out.push(`${why} in ${e.kind}: ${text.replace(/\s+/g, ' ').trim().slice(0, 140)}`); });
    if (SENTENCE_SINKS.includes(e.kind) && POINTS_WORD.test(text)) out.push(`the word points in ${e.kind}: ${text.slice(0, 140)}`);
  });
  return out;
}
function record(fn) {
  SINKS.log.length = 0;
  SINKS.on = true;
  try { fn(); } finally { SINKS.on = false; }
  return SINKS.log.slice();
}

// A week with points everywhere a leak could come from: medals, verse, cleanup, custom bonuses (one negative), a
// live tally, a started bracket, a hidden section for each switch.
function seedWeek() {
  freshState();
  const games = state.config.games;
  games.slice(0, 4).forEach((g, i) => {
    state.results[g.id] = { medals: { gold: 't' + (i % 3), silver: 't' + ((i + 1) % 3), bronze: 't' + ((i + 2) % 3) }, savedAt: '2026-07-20T12:0' + i + ':00Z' };
  });
  state.bonuses = {
    v1: { teamId: 't0', category: 'verse', label: 'Mon memory verse', points: 5, at: '2026-07-20T12:05:00Z', day: 1 },
    c1: { teamId: 't1', category: 'cleanup', label: 'Mon Lunch cleanup', points: 3, at: '2026-07-20T12:06:00Z', day: 1, meal: 'Lunch' },
    q1: { teamId: 't2', category: 'custom', label: 'Spirit', points: 4, at: '2026-07-20T12:07:00Z' },
    q2: { teamId: 't3', category: 'custom', label: 'Penalty', points: -2, at: '2026-07-20T12:08:00Z' },
  };
  const live = games.find((g) => g.liveRankings && !state.results[g.id]);
  if (live) {
    const scores = {};
    state.teams.forEach((t, i) => { scores[t.id] = String(10 + i * 3); });
    state.drafts[live.id] = { scores, medals: {} };
  }
  state.followTeam = 't1';
  state.notify = true;
  appStarted = true;
  fbRef = null;
  resultAlertsArmed = true;
  return { live };
}

function boot(role, opts) {
  seedWeek();
  counselorPreviewOn = false;
  tabWriter = true;
  setMemberRole(role === undefined ? 'editor' : role, opts);
  setMemberTeam(null);
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false;
  authUser = { email: 'jenn@example.com' };
  memberName = 'Jenn';
  shell.sheets.slice().forEach((id) => shellSheetClose(id));
  state.ui.tab = 'now'; state.ui.gameId = null; state.ui.tool = null; state.ui.revealOpen = false; state.ui.view = 'home';
}
function done() {
  previewEnd();
  counselorPreviewOn = false;
  tabWriter = true;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  shell.sheets.slice().forEach((id) => shellSheetClose(id));
  state.ui.tab = 'now'; state.ui.gameId = null; state.ui.tool = null; state.ui.revealOpen = false; state.ui.view = 'home';
  setStandingsGuardThrows(false);
  setMemberRole(null);
  authUser = null;
  memberName = null;
}
function el(id) { return document.getElementById(id); }
const notEqual = (a, b, msg) => assert.ok(a !== b, msg || ('expected something other than ' + JSON.stringify(b)));
const sorted = (list) => list.map((e) => e.text.replace(/\s+/g, ' ').trim()).sort();

// ── 1. the lens ──────────────────────────────────────────────────────

test('the lens: a preview makes canEdit, standingsVisible and isOwner false and viewRole a counselor, and nothing else moves', () => {
  boot('editor');
  authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true };
  assert.ok(canEdit() && standingsVisible() && isOwner(), 'precondition: a director who is the owner');
  assert.equal(viewRole(), 'editor');
  const calls = [];
  const realSet = setMemberRole;
  setMemberRole = (...a) => { calls.push(a); return realSet(...a); };
  try {
    assert.equal(previewStart(), true);
    assert.equal(canEdit(), false);
    assert.equal(standingsVisible(), false);
    assert.equal(isOwner(), false, 'the owner is not the owner while looking as a counselor: no owner act can start');
    assert.equal(viewRole(), 'viewer');
    // what the SIGN-IN says is exactly as it was: the writer election, the hint and the engines read these
    assert.equal(memberRole, 'editor');
    assert.equal(memberRoleConfirmed, true);
    assert.equal(directorTab(), true, 'the engines still see a director\'s writer tab');
    assert.equal(tabWriter, true);
    assert.deepEqual(calls, [], 'the preview never goes through setMemberRole');
    previewStop();
  } finally { setMemberRole = realSet; }
  assert.ok(canEdit() && standingsVisible() && isOwner(), 'Exit gives all three back');
  assert.equal(viewRole(), 'editor');
  done();
});

test('a counselor, a hint-painted director, a director\'s view-only second tab and an unresolved role cannot start one', () => {
  boot('viewer');
  assert.equal(previewMayStart(), false);
  assert.equal(previewStart(), false);
  assert.equal(counselorPreviewOn, false, 'a counselor never gets the lens');
  setMemberRole('editor', { provisional: true });
  assert.equal(previewStart(), false, 'a hint-painted director has not been confirmed by the member record');
  setMemberRole('editor');
  tabWriter = false;
  assert.equal(previewStart(), false, 'a view-only second tab does not preview');
  tabWriter = true;
  setMemberRole(null);
  assert.equal(previewStart(), false);
  setMemberRole('editor');
  appStarted = false;
  assert.equal(previewStart(), false, 'nothing before the app has started');
  appStarted = true;
  assert.equal(previewStart(), true);
  assert.equal(previewStart(), false, 'a second start while one is up does nothing');
  assert.equal(counselorPreviewOn, true);
  done();
});

test('the Preview button is never dead: a tap that cannot start one says why, and one that can says nothing', () => {
  const realToast = showToast; const toasts = [];
  showToast = (m) => { toasts.push(String(m)); };
  try {
    // a hint-painted director (the stored role, the member record not yet answered): What counselors see opens, the tap used to do nothing
    boot('editor', { provisional: true });
    assert.equal(previewTap(), false);
    assert.equal(counselorPreviewOn, false);
    assert.deepEqual(toasts, ['Still signing you in. Try again in a moment.']);
    // a second tab that does not hold the writer lock
    toasts.length = 0;
    setMemberRole('editor');
    tabWriter = false;
    assert.equal(previewTap(), false);
    assert.deepEqual(toasts, ['This tab is view-only. Preview from the tab that edits.']);
    // before the app has started
    toasts.length = 0;
    tabWriter = true;
    appStarted = false;
    assert.equal(previewTap(), false);
    assert.equal(toasts.length, 1, 'one sentence');
    appStarted = true;
    // a confirmed director on a writer tab: it starts, and a tap while one is up says nothing (the bar's Exit is on screen)
    toasts.length = 0;
    assert.equal(previewTap(), true);
    assert.equal(counselorPreviewOn, true);
    assert.equal(previewTap(), false);
    assert.deepEqual(toasts, [], 'starting says nothing, and a second tap while one is up is quiet');
  } finally { showToast = realToast; }
  assert.ok(/addEventListener\('click', \(\) => previewTap\(\)\)/.test(APP_SRC), 'the button is wired to the tap that says why');
  done();
});

test('nothing about a preview is stored: not in state, not in the cache, not the auth hint, and a fresh page is the director\'s own', () => {
  boot('editor');
  setAuthHint('editor');
  const hintBefore = localStorage.getItem(AUTH_HINT_KEY);
  const keysBefore = Object.keys(__localStorageStore ? Object.fromEntries(__localStorageStore) : {}).sort();
  assert.equal(previewStart(), true);
  state.ui.tab = 'games'; renderAll();
  saveState();
  assert.notOk(/preview|counselorPreview/i.test(JSON.stringify(state)), 'no preview marker in state: ' + (JSON.stringify(state).match(/.{20}preview.{20}/i) || [''])[0]);
  const stored = Object.fromEntries(__localStorageStore);
  Object.keys(stored).forEach((k) => assert.notOk(/preview/i.test(k) || /counselorPreview/.test(String(stored[k])), 'no stored key or value names a preview: ' + k));
  assert.equal(localStorage.getItem(AUTH_HINT_KEY), hintBefore, 'the auth hint still says editor');
  assert.deepEqual(Object.keys(Object.fromEntries(__localStorageStore)).sort(), keysBefore, 'no new storage key appeared');
  // the page after a reload, over this very cache: the lens is off, because it only ever lived in memory
  const { ctx } = makeContext({ storage: { [STORAGE_KEY]: JSON.stringify(state), [AUTH_HINT_KEY]: 'editor' }, seeded: PV_SEEDED });
  assert.equal(vm.runInContext('counselorPreviewOn', ctx), false);
  assert.equal(vm.runInContext('viewRole()', ctx), null, 'before sign-in resolves the role is nothing, never a counselor preview');
  assert.equal(vm.runInContext('document.documentElement.classList.contains("counselor-preview")', ctx), false);
  done();
});

// ── 2. impossible to get stuck in ─────────────────────────────────────

test('Exit lands on More with What counselors see open again; every other way out just lets go', () => {
  boot('editor');
  state.ui.tab = 'more'; renderAll();
  shellSheetOpen('counselors');
  assert.ok(shell.sheets.includes('counselors'));
  assert.equal(previewStart(), true);
  assert.notOk(shell.sheets.includes('counselors'), 'the director\'s sheet closes: a counselor has no door to it');
  assert.equal(shellSheetAllowed('counselors'), false);
  state.ui.tab = 'now'; renderAll();
  previewStop({ back: true });
  assert.equal(counselorPreviewOn, false);
  assert.equal(activeTab(), 'more', 'Exit comes back to the screen the preview began on');
  assert.ok(shell.sheets.includes('counselors'), 'and reopens What counselors see, so a switch can be changed and checked again');
  shellSheetClose('counselors');
  previewStart();
  previewStop(); // an end that is not the button
  assert.equal(counselorPreviewOn, false);
  assert.notOk(shell.sheets.includes('counselors'), 'only the button reopens the sheet');
  done();
});

test('the shell\'s ten-minute absence ends a preview, a short one does not', () => {
  boot('editor');
  previewStart();
  shell.hiddenAt = Date.now() - 60 * 1000;
  shellResume();
  assert.equal(counselorPreviewOn, true, 'a minute away: still previewing');
  shell.hiddenAt = Date.now() - SHELL_RESUME_MS - 1000;
  shellResume();
  assert.equal(counselorPreviewOn, false, 'put down for over ten minutes it comes back as the director\'s own view');
  assert.ok(canEdit());
  done();
});

test('a role change that makes the person not a confirmed director ends it at once, a repeat of the same answer does not', () => {
  boot('editor');
  previewStart();
  setMemberRole('editor'); // the member listener fires again with the same record
  assert.equal(counselorPreviewOn, true, 'the same confirmed answer keeps it');
  setMemberRole('viewer'); // a remote demotion
  assert.equal(counselorPreviewOn, false);
  assert.equal(canEdit(), false);
  assert.equal(memberRole, 'viewer', 'and the person is the viewer the record says');
  setMemberRole('editor');
  previewStart();
  setMemberRole(null); // removed from the list
  assert.equal(counselorPreviewOn, false);
  setMemberRole('editor');
  previewStart();
  setMemberRole('editor', { provisional: true });
  assert.equal(counselorPreviewOn, false, 'a role that is no longer confirmed is not a director to preview as');
  done();
});

test('a demotion ends it even before the app has rendered anything (setMemberRole itself, not only the next render)', () => {
  boot('editor');
  previewStart();
  appStarted = false; // no renderAll will run inside setMemberRole
  setMemberRole('viewer');
  assert.equal(counselorPreviewOn, false);
  appStarted = true;
  done();
});

test('a second tab taking the writer lock ends it on the next render (the view-only bar must be reachable)', () => {
  boot('editor');
  previewStart();
  tabWriter = false;
  renderAll();
  assert.equal(counselorPreviewOn, false);
  assert.equal(tabReadOnly(), true);
  done();
});

test('the bar answers under everything: it sits outside #app, above takeovers and sheets, and the preview paints and unpaints it', () => {
  const barAt = INDEX.indexOf('id="preview-bar"');
  assert.ok(barAt > -1 && barAt < INDEX.search(/<div id="app"/), 'the bar is in the page before #app, so it still answers while #app is inert');
  assert.ok(/id="preview-exit"/.test(INDEX.slice(barAt, barAt + 700)), 'its Exit button is inside it');
  assert.ok(/\.pv-bar \{[^}]*z-index: 10000/.test(CSS), 'above takeovers and sheets (z 10000; dialogs and drawers sit at 10001)');
  assert.ok(/\.pv-frame \{[^}]*pointer-events: none/.test(CSS), 'the frame never takes a tap');
  const quiet = APP_SRC.indexOf('const JOY_QUIET');
  assert.ok(/#preview-bar/.test(APP_SRC.slice(quiet, quiet + 600)), 'no sparkles on the bar');
  assert.ok(/<div id="preview-bar"[^>]*\shidden>/.test(INDEX) && /<i id="preview-frame"[^>]*\shidden>/.test(INDEX), 'both ship hidden: only a preview shows them');
  boot('editor');
  previewStart();
  assert.equal(el('preview-bar').hidden, false, 'the bar is up');
  assert.equal(el('preview-frame').hidden, false, 'and the frame');
  previewStop();
  assert.equal(el('preview-bar').hidden, true, 'Exit takes both down');
  assert.equal(el('preview-frame').hidden, true);
  done();
});

test('what the preview draws for a team-less director: More\'s Your team row keeps its words in the text column when its mark is hidden', () => {
  // A counselor with no team, and so a director in a preview with no team, sees "Your team · Pick the team you are with": with
  // the mark out of the layout the words slid into the 30px icon column, one word to a line (found in Chromium by this step's pass).
  assert.ok(/\.gl-ico\[hidden\] \+ \.gl-text \{\s*grid-column: 2;/.test(CSS), 'the rule is in styles.css');
  boot('editor');
  const row = document.querySelector('#tab-more [data-more-row="team"]');
  state.followTeam = null; state.ui.tab = 'more';
  previewStart();
  assert.equal(row.hidden, false, 'a counselor with no team has the row (a director with no team does not)');
  assert.equal(el('more-team-mark').hidden, true, 'and its mark is out of the layout');
  done();
});

test('--pv-h is the measured bar height while up and is removed after Exit', () => {
  boot('editor');
  const set = {}; const removed = [];
  const root = document.documentElement;
  const realSetProp = root.style.setProperty; const realRemove = root.style.removeProperty;
  root.style.setProperty = (k, v) => { set[k] = v; };
  root.style.removeProperty = (k) => { removed.push(k); };
  try {
    el('preview-bar').offsetHeight = 61;
    previewStart();
    assert.equal(set['--pv-h'], '61px', 'measured from the bar as drawn, not the CSS guess');
    el('preview-bar').offsetHeight = 96; // wraps at large text
    previewMeasure();
    assert.equal(set['--pv-h'], '96px');
    previewStop();
    assert.ok(removed.includes('--pv-h'), 'nothing is left on :root after Exit');
  } finally { root.style.setProperty = realSetProp; root.style.removeProperty = realRemove; el('preview-bar').offsetHeight = undefined; }
  done();
});

// ── 3. the whole app as a counselor sees it ───────────────────────────

test('walk every tab, sheet and takeover in a preview, with the points guard throwing: no points, no places, no director row', () => {
  const { live } = boot('editor') || seedWeek();
  state.meta.hiddenCards = { competitions: false };
  state.ui.tab = 'games'; // the standings are on the Games tab, and only the visible tab renders
  renderAll(); // a director's page first, so every node holds director markup: the preview must clear it
  const before = leaksIn(__domSweep());
  assert.ok(before.length >= 3, 'precondition: the director\'s page does carry them (' + before.length + ')'); // the standings' places, awarded points and gap sentence (the follow card's place went with Step 17)
  previewStart();
  setStandingsGuardThrows(true);
  const out = record(() => {
    SHELL_TABS.forEach((tab) => { state.ui.tab = tab; renderAll(); shellTick(); });
    // every sheet a counselor can open
    ['team', 'verse', 'cleanup', 'alerts'].forEach((id) => { shellSheetOpen(id); renderAll(); shellSheetClose(id); });
    // every game takeover, finished, live and not started
    state.config.games.forEach((g) => { openGame(g.id, { from: 'games' }); renderAll(); });
    if (live) { openGame(live.id, { from: 'now' }); renderAll(); }
    closeGame();
    state.ui.tab = 'more'; renderAll();
  });
  // The Games tab's own director pieces stay shut: the two sheets that read points and write them, the dock, the standings.
  ['quick', 'standings'].forEach((id) => assert.equal(shellSheetAllowed(id), false, 'the ' + id + ' sheet is not a counselor\'s'));
  assert.equal(gamesQuickReady(), false);
  assert.equal(document.getElementById('takeover-game-dock').hidden, true, 'no Next game dock on a counselor\'s takeover');
  assert.equal(document.getElementById('gs-list').innerHTML, '', 'and no standings rows');
  assert.ok(out.length > 20, 'the recorder is live: ' + out.length + ' writes seen');
  assert.deepEqual(leaksIn(out), [], 'a sink carried a point, a place or a gap');
  assert.deepEqual(leaksIn(__domSweep()), [], 'markup left in a node');
  // (the static markup of a director row is not in the stub DOM: that half is the hidden flags below and the FIDELITY
  // test, which compares every node a preview leaves with a real counselor's)
  const dir = __domSweep().filter((e) => DIRECTOR_WORDS.test(readable(e)));
  assert.deepEqual(dir.map((e) => e.text.slice(0, 80)), [], 'director-only words are on the counselor screen');
  done();
});

// ── The game takeover's director pieces (Step 18, build session 2): the podium picker, its Save, the saved line ──
// What a director has on the screen while picking names teams in every key's label, and the Save well names what is missing;
// a finished game's director view carries the points and the Change button. A counselor preview must clear all of it at once
// (the entry area and the dock are written by the renderers a role flip re-runs) and the picker must never be reachable.
test('a counselor preview clears the podium picker, its Save and the saved line, and a preview can pick and save nothing', () => {
  boot('editor');
  const t = teamIds();
  const g = state.config.games.find((x) => x.format !== 'tournament' && x.format !== 'tally' && !state.results[x.id]);
  assert.ok(g, 'a podium game with no result');
  state.drafts[g.id] = { medals: {} };
  podiumPick(g.id, 'gold', t[0]); podiumPick(g.id, 'silver', t[1]);
  state.ui.gameId = g.id; state.ui.gameFrom = 'games';
  renderAll();
  const entry = el('entry-area'); const dock = el('takeover-game-dock');
  assert.ok(/id="podium-picker"/.test(entry.innerHTML) && /Pick bronze, then save/.test(dock.innerHTML), 'precondition: the director\'s picker and Save');
  previewStart();
  setStandingsGuardThrows(true);
  const out = record(() => { renderAll(); shellTick(); });
  assert.notOk(/podium-picker|pp-team|pp-row/.test(entry.innerHTML), 'no keys: a counselor reads the live line');
  assert.ok(/class="nw-note gv-wait"/.test(entry.innerHTML) && entry.innerHTML.includes('Not scored yet. The winners show here when a director saves them.'),
    'the one plain line a counselor gets for an unscored game: ' + entry.innerHTML.slice(0, 200));
  assert.deepEqual(leaksIn([{ kind: 'innerHTML', text: entry.innerHTML }]), [], 'and it says no point, place or gap');
  assert.equal(dock.hidden, true, 'no Save');
  assert.equal(dock.innerHTML, '');
  assert.deepEqual(leaksIn(out), [], 'a sink carried a point, a place or a gap');
  assert.deepEqual(leaksIn(__domSweep()), [], 'markup left in a node');
  // nothing can be picked, saved, cleared or re-opened from a preview, whoever calls it
  const draft = JSON.stringify(state.drafts[g.id]);
  assert.equal(podiumPick(g.id, 'bronze', t[2]).problem, 'unavailable');
  assert.equal(podiumPick(g.id, 'gold', t[0]).problem, 'unavailable', 'not even the clear');
  assert.equal(podiumSave(g.id).problem, 'unavailable');
  assert.equal(JSON.stringify(state.drafts[g.id]), draft);
  assert.equal(state.results[g.id], undefined);
  assert.equal(gamesDock(g.id), null);
  // a finished game: the winners, and none of the director's saved line, points or Change button
  const done_ = state.config.games.find((x) => state.results[x.id]);
  state.ui.gameId = done_.id;
  const out2 = record(() => renderAll());
  assert.ok(/gres-r/.test(entry.innerHTML), 'the winners are public');
  assert.notOk(/gres-pts|game-saved|game-change/.test(entry.innerHTML), 'but not what they are worth, the saved line or Change: ' + entry.innerHTML.slice(0, 300));
  assert.deepEqual(leaksIn(out2), []);
  assert.deepEqual(leaksIn(__domSweep()), []);
  state.ui.gameId = null;
  done();
});

// ── Now, every kind of card (Step 17): the picture is a function of the clock, so a preview is walked through each ──
// The times of one picture of every kind: a block of each kind on Wednesday (inside it and just after its end, where the cleanup
// moment, Running over and Still to do live), Sunday's arrival, Saturday's send-off, the night and the early morning.
const NOW_WALK_BASE = Date.UTC(2026, 6, 22, 12, 0, 0);
function nowWalkTimes() {
  const out = [];
  const bl = nowBlocks(3);
  ['games', 'elective', 'meal', 'bible', 'meeting', 'worship', 'bedtime', 'activity'].forEach((k) => {
    const nb = bl.find((x) => x.kind === k && !x.noTime);
    if (nb) { out.push([3, nb.start + 3]); out.push([3, nb.end + 5]); }
  });
  const meal = bl.filter((x) => x.kind === 'meal' && !x.noTime).pop();
  if (meal) out.push([3, meal.end + 12]);
  const a = nowBlocks(0).find((x) => x.kind === 'arrival' && !x.noTime);
  if (a) out.push([0, a.start + 3]);
  const sf = nowBlocks(6).find((x) => x.kind === 'sendoff' && !x.noTime);
  if (sf) out.push([6, sf.start + 3]);
  out.push([3, 23 * 60 + 30], [3, 6 * 60 + 5]);
  return out;
}
// A week with something in every corner for Now: a podium, a live tally, a notice with a team line, banners, a rota.
const NOW_WALK_SETUP = `
  const gb = nowBlocks(3).find((x) => x.kind === 'games' && gamesForBlock(3, x.b).length);
  const gs = gb ? gamesForBlock(3, gb.b) : [];
  if (gs[0]) state.results[gs[0].id] = { medals: { gold: 't2', silver: 't1', bronze: 't0' }, savedAt: '2026-07-22T14:00:00Z' };
  if (gs[1]) { Object.assign(gs[1], { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false }); state.drafts[gs[1].id] = { scores: { t3: '9', t0: '4', t1: '6' } }; }
  state.bonuses = { 'cleanup-t1-3-Lunch': { teamId: 't1', category: 'cleanup', points: 3, day: 3, meal: 'Lunch', at: '2026-07-22T14:00:00Z' }, 'verse-t0-3': { teamId: 't0', category: 'verse', points: 5, day: 3, at: '2026-07-22T14:00:00Z' } };
  Object.assign(state.notice, { status: 'posted', eyebrow: '', title: 'Saturday cleanup', sub: 'Every team has one place', signoff: 'See you next year',
    zones: [{ teamId: 't1', place: 'Dining hall', note: 'tables' }], steps: [{ emoji: '🧹', when: '9:00 · Everyone', items: ['Strip the beds'] }] });
  state.announcements = { p1: { id: 'p1', text: 'Water break', at: new Date().toISOString(), by: 'Jenn', ttlMs: 3600000 }, p2: { id: 'p2', text: 'Supper moves', at: new Date(Date.now() - 1000).toISOString(), by: 'Jenn', ttlMs: 3600000 } };
  cleanupOnRota = (d) => d >= 1 && d <= 5;
  cleanupTeams = (d, meal) => (d < 1 || d > 5 ? [] : meal === 'Breakfast' ? ['t0'] : meal === 'Lunch' ? ['t1', 't2'] : []);
`;
const NOW_NODE = /^#(?:now-(?!reveal|champion)|announcements$|sheet-(?:notice|messages|whos-where)|whos-where)/;
function nowAtJs(d, m) { return `campNow = () => ({ dow: ${d}, minutes: ${m} }); serverNow = () => ${NOW_WALK_BASE + m * 60000};`; }
// What only a director's Now carries: keys, Score, a place numeral, the foot, Still to do, Take down, the moment's secret line.
const NOW_DIRECTOR_MARKUP = [/class="aw-pt"|class="aw-pts|class="aw-row"|class="aw-lock"/, /nm-saved|nm-label/, /class="lb-pl"|data-ranked/, /data-score-game|gr-score|gr-why/, /data-todo|nr-act/, /Points stay|3 = spotless|Still to do|Take down|Still on /];

test('Now, every kind of card, walked in a preview with the points guard throwing: no key, no Score, no point, no place, no director control', () => {
  const realNow = campNow; const realServer = serverNow; const realOnRota = cleanupOnRota; const realRota = cleanupTeams;
  try {
    boot('editor');
    eval(NOW_WALK_SETUP);
    const times = nowWalkTimes();
    assert.ok(times.length >= 10, 'a real list of times: ' + times.length);
    // a director's own Now first, at the Bible study that carries the most director markup, so every node holds it
    const bible = times.find(([d, m]) => nowBlocks(d).some((x) => x.kind === 'bible' && m === x.start + 3)) || times[0];
    eval(nowAtJs(bible[0], bible[1]));
    renderAll();
    assert.ok(NOW_DIRECTOR_MARKUP.some((re) => re.test(NOW_ID_MARKUP())), 'precondition: the director\'s Now does carry director markup');
    previewStart();
    setStandingsGuardThrows(true);
    const found = [];
    const out = record(() => {
      times.forEach(([d, m]) => {
        eval(nowAtJs(d, m));
        renderAll(); shellTick();
        const markup = NOW_ID_MARKUP();
        NOW_DIRECTOR_MARKUP.forEach((re) => { if (re.test(markup)) found.push(`dow ${d} minute ${m}: ${re} in ${markup.match(re)[0]}`); });
      });
    });
    assert.ok(out.length > 20, 'the recorder is live: ' + out.length + ' writes seen');
    assert.deepEqual(found.slice(0, 4), [], 'director markup on a counselor\'s Now');
    assert.deepEqual(leaksIn(out), [], 'a sink carried a point, a place or a gap');
    done();
  } finally { campNow = realNow; serverNow = realServer; cleanupOnRota = realOnRota; cleanupTeams = realRota; }
});
function NOW_ID_MARKUP() {
  return Object.entries(__domEntries()).filter(([k]) => NOW_NODE.test(k)).map(([, v]) => v).join(' ');
}

// A What's new note is THIS PHONE's own reading list, not camp content, and a preview never draws one (see "What's new notes"). Both
// phones of a fidelity comparison therefore start with every note read, so the comparison is about the camp's page alone.
function pvRead(m) {
  vm.runInContext("localStorage.setItem(WHATS_NEW_KEY, JSON.stringify({ v: 2, d: Object.fromEntries(CHANGES.map((c) => [c.id, 1])) }))", m.ctx);
  return m;
}
test('FIDELITY, Now at every kind of card: a director in a preview paints, node for node, what a real counselor\'s phone paints', () => {
  const mk = () => pvRead(makeContext({ camp: CAMP.id, seeded: PV_SEEDED }));
  const a = mk(); const b = mk();
  scenario(a.ctx, 'viewer', false);
  scenario(b.ctx, 'editor', false);
  vm.runInContext(NOW_WALK_SETUP, a.ctx);
  vm.runInContext(NOW_WALK_SETUP, b.ctx);
  const times = nowWalkTimes();
  const bible = times.find(([d, m]) => nowBlocks(d).some((x) => x.kind === 'bible' && m === x.start + 3)) || times[0];
  // the director's own page first, at the moment with keys: every node holds director markup before the preview starts
  vm.runInContext(nowAtJs(bible[0], bible[1]) + 'renderAll(); previewStart();', b.ctx);
  const entries = (c) => {
    const e = JSON.parse(JSON.stringify(vm.runInContext('__domEntries()', c)));
    const out = {};
    Object.keys(e).filter((k) => NOW_NODE.test(k)).forEach((k) => { out[k] = e[k].replace(/\s+/g, ' ').trim(); });
    return out;
  };
  const diff = [];
  times.forEach(([d, m]) => {
    vm.runInContext(nowAtJs(d, m) + 'renderAll(); shellTick();', a.ctx);
    vm.runInContext(nowAtJs(d, m) + 'renderAll(); shellTick();', b.ctx);
    const x = entries(a.ctx); const y = entries(b.ctx);
    new Set(Object.keys(x).concat(Object.keys(y))).forEach((k) => {
      if ((x[k] || '') !== (y[k] || '')) diff.push(`dow ${d} minute ${m} ${k}: counselor ${JSON.stringify((x[k] || '').slice(0, 90))} / preview ${JSON.stringify((y[k] || '').slice(0, 90))}`);
    });
  });
  assert.deepEqual(diff.slice(0, 6), [], 'Now differs between a counselor and a preview');
  // the comparison can fail: the same walk as a director with NO preview differs (it carries keys, Score and Still to do)
  const c = mk();
  scenario(c.ctx, 'editor', false);
  vm.runInContext(NOW_WALK_SETUP, c.ctx);
  let differs = false;
  times.forEach(([d, m]) => {
    vm.runInContext(nowAtJs(d, m) + 'renderAll(); shellTick();', a.ctx);
    vm.runInContext(nowAtJs(d, m) + 'renderAll(); shellTick();', c.ctx);
    const x = entries(a.ctx); const y = entries(c.ctx);
    if (Object.keys(x).concat(Object.keys(y)).some((k) => (x[k] || '') !== (y[k] || ''))) differs = true;
  });
  assert.ok(differs, 'a director with no preview paints something a counselor does not');
});

// ── a four-team bracket under way (Step 22) ──────────────────────────
// The four cells name "3rd place" — the match for the bronze medal, never a standings place — so that label is set aside before the
// leak patterns read the text (the ordinal-place pattern is for a team's rank, and a real rank would still be caught).
const B4_LABEL = /\b3rd place( match)?\b/gi;
const noB4Label = (entries) => entries.map((e) => Object.assign({}, e, { text: String(e.text).replace(B4_LABEL, '[bracket match]') }));

test('a four-team bracket under way, in a preview: the counselor\'s view of it at every step - no control, no suggestion, no point, no place - and no tap records anything', () => {
  boot('editor');
  state.teams = state.teams.slice(0, 4); // a four-team bracket belongs to a four-team camp (fourRead needs exactly four teams)
  const g = state.config.games.find((x) => x.format === 'tournament') || state.config.games[state.config.games.length - 1];
  g.format = 'tournament';
  delete state.results[g.id];
  const stage = {
    's1 on': { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } },
    's2 on': { s1: { a: 't0', b: 't3', winner: 't0' }, s2: { a: 't1', b: 't2' } },
    'third on': { s1: { a: 't0', b: 't3', winner: 't0' }, s2: { a: 't1', b: 't2', winner: 't2' } },
    'final on': { s1: { a: 't0', b: 't3', winner: 't0' }, s2: { a: 't1', b: 't2', winner: 't2' }, third: { a: 't3', b: 't1', winner: 't1' } },
    'all played': { s1: { a: 't0', b: 't3', winner: 't0' }, s2: { a: 't1', b: 't2', winner: 't2' }, third: { a: 't3', b: 't1', winner: 't1' }, final: { a: 't0', b: 't2', winner: 't0' } },
    're-check': { s1: { a: 't0', b: 't3', winner: 't3' }, s2: { a: 't1', b: 't2', winner: 't2' }, third: { a: 't3', b: 't1', winner: 't1' } },
  };
  state.followTeam = 't0';
  state.ui.tab = 'games';
  // a director's own page first, with the director's controls in it (only where the camp plays the four-team bracket)
  state.brackets4 = { [g.id]: { at: 1, m: JSON.parse(JSON.stringify(stage['s1 on'])) } };
  openGame(g.id, { from: 'games' }); renderAll();
  if (teamIds().length === 4) assert.ok(/data-four=|winner-btn/.test(el('entry-area').innerHTML), 'precondition: the director\'s screen carries the bracket controls');
  previewStart();
  setStandingsGuardThrows(true);
  const seen = [];
  const out = record(() => {
    Object.keys(stage).forEach((k) => {
      state.brackets4 = { [g.id]: { at: 1, m: JSON.parse(JSON.stringify(stage[k])) } };
      openGame(g.id, { from: 'games' }); renderAll(); shellTick();
      seen.push([k, el('entry-area').innerHTML]);
    });
  });
  seen.forEach(([k, html]) => {
    assert.notOk(/winner-btn|data-four=|data-live=|save-bracket-btn|Suggested by the points|undo-match-btn/.test(html), k + ': a control or a suggestion on a counselor\'s screen: ' + html.slice(0, 160));
    assert.ok(/live-watch/.test(html), k + ': the spectator\'s view');
  });
  assert.ok(/Live now · Semifinal 1/.test(seen[0][1]) && /plays in semifinal 1/i.test(seen[0][1]), 'the followed team is told where it plays');
  assert.ok(/Live now · 3rd place/.test(seen[2][1].replace(/\s+/g, ' ')), 'the 3rd-place match is named as one');
  assert.ok(/double-checking a result/.test(seen[5][1]) && !/plays in the final next/.test(seen[5][1]), 'a re-check holds the view and tells no team what is next');
  assert.deepEqual(leaksIn(noB4Label(out)), [], 'a sink carried a point, a place or a gap');
  assert.deepEqual(leaksIn(noB4Label(__domSweep())), [], 'markup left in a node');
  // no tap can record anything: the wrappers refuse, and a forged tap on the entry area does nothing
  const before = JSON.stringify(state.brackets4);
  const box = el('entry-area'); box.__fourGid = g.id;
  const tapAt = (els) => fourEntryTap({ closest: (sel) => els[sel] || null }, box);
  assert.equal(tapAt({ '.winner-btn': { dataset: { winner: 't0' } }, '[data-four-match]': { dataset: { fourMatch: 's1' } } }), false);
  assert.equal(tapAt({ '[data-four]': { dataset: { four: 'cancel' } } }), false);
  assert.equal(tapAt({ '[data-four]': { dataset: { four: 'save' } } }), false);
  ['s1', 's2', 'third', 'final'].forEach((k) => assert.equal(fourRecordTap(g, k, 't0').ok, false));
  assert.equal(fourSaveResult(g).ok, false);
  assert.equal(fourReopen(g).ok, false);
  assert.equal(discardLateBracket(g.id).ok, false);
  assert.equal(JSON.stringify(state.brackets4), before, 'nothing changed');
  // a saved four-team result is the podium a counselor already sees: its kept bracket path says nothing a counselor must not see
  state.results[g.id] = { medals: { gold: 't0', silver: 't2', bronze: 't1' }, savedAt: '2026-07-20T12:09:00Z', path: { at: 1, m: JSON.parse(JSON.stringify(stage['all played'])) } };
  delete state.brackets4[g.id];
  openGame(g.id, { from: 'games' }); renderAll();
  assert.equal(fourCanReopen(g), false, 'no Reopen the final in a preview');
  assert.notOk(/Reopen|Change the result/.test(el('entry-area').innerHTML), 'and no way to change the result');
  assert.deepEqual(leaksIn(noB4Label(__domSweep())), [], 'the saved result leaves no point or place behind either');
  done();
});

test('a six-team bracket under way, in a preview: the counselor\'s Results phase and every step before it carry no control, no suggestion, no point, no place - and no tap records anything', () => {
  boot('editor');
  if (teamIds().length !== 6) return done(); // a four-team camp plays the four-team bracket: the test above walks that one
  const g = state.config.games.find((x) => x.format === 'tournament');
  assert.ok(g, 'the sandbox has a tournament game');
  delete state.results[g.id];
  const mk = (phase, extra) => Object.assign({ phase, pool: [], selectedPair: [], matches: [], byeTeamId: null }, extra || {});
  const stage = {
    round1: mk('round1', { pool: ['t0', 't1', 't2', 't3', 't4', 't5'], selectedPair: ['t0', 't1'], matches: [{ winner: 't2', loser: 't3' }] }),
    bye: mk('bye', { matches: [{ winner: 't0', loser: 't3' }, { winner: 't1', loser: 't4' }, { winner: 't2', loser: 't5' }] }),
    semifinal: mk('semifinal', { byeTeamId: 't0', matches: [{ winner: 't0', loser: 't3' }, { winner: 't1', loser: 't4' }, { winner: 't2', loser: 't5' }], semifinal: { a: 't1', b: 't2' } }),
    championship: mk('championship', { byeTeamId: 't0', matches: [{ winner: 't0', loser: 't3' }, { winner: 't1', loser: 't4' }, { winner: 't2', loser: 't5' }], semifinal: { a: 't1', b: 't2', winner: 't1', loser: 't2' }, championship: { a: 't0', b: 't1' } }),
    summary: mk('summary', { byeTeamId: 't0', matches: [{ winner: 't0', loser: 't3' }, { winner: 't1', loser: 't4' }, { winner: 't2', loser: 't5' }], semifinal: { a: 't1', b: 't2', winner: 't1', loser: 't2' }, championship: { a: 't0', b: 't1', winner: 't0', loser: 't1' } }),
  };
  state.followTeam = 't0';
  state.ui.tab = 'games';
  state.brackets = { [g.id]: JSON.parse(JSON.stringify(stage.summary)) };
  openGame(g.id, { from: 'games' }); renderAll();
  assert.ok(/Ready to save|save-bracket-btn|data-bracket/.test(el('entry-area').innerHTML + el('tools-area').innerHTML + el('entry-area').outerHTML), 'precondition: the director\'s own screen is the Results step');
  previewStart();
  setStandingsGuardThrows(true);
  const seen = [];
  const out = record(() => {
    Object.keys(stage).forEach((k) => {
      state.brackets = { [g.id]: JSON.parse(JSON.stringify(stage[k])) };
      openGame(g.id, { from: 'games' }); renderAll(); shellTick();
      seen.push([k, el('entry-area').innerHTML]);
    });
  });
  seen.forEach(([k, html]) => {
    assert.notOk(/winner-btn|start-bracket-btn|save-bracket-btn|undo-match-btn|undo-bye-btn|cancel-bracket|data-live=|Suggested by the points|bye-chip|data-bye/.test(html), k + ': a control or a suggestion on a counselor\'s screen: ' + html.slice(0, 160));
    assert.ok(/live-watch/.test(html), k + ': the spectator\'s view');
  });
  assert.ok(/Played so far/.test(seen[1][1]), 'the matches played are listed in words a counselor reads');
  assert.ok(/All matches played/.test(seen[4][1]), 'the Results phase says a director is saving it, and names no winner');
  assert.deepEqual(leaksIn(out), [], 'a sink carried a point, a place or a gap');
  assert.deepEqual(leaksIn(__domSweep()), [], 'markup left in a node');
  state.brackets = { [g.id]: JSON.parse(JSON.stringify(stage.summary)) };
  const was = JSON.stringify(state.brackets);
  assert.equal(sixSaveResult(g).ok, false, 'a preview cannot save the six-team result');
  assert.equal(JSON.stringify(state.brackets), was, 'nothing changed');
  assert.ok(!state.results[g.id], 'and no result was written');
  done();
});

test('every door a counselor has no key to stays shut in a preview: the director tools, the remote, the builder, the drawers, the owner\'s acts', () => {
  boot('editor');
  previewStart();
  assert.equal(openTool('tell', { from: 'more' }), false);
  assert.equal(openTool('award', { from: 'more' }), false);
  assert.equal(openReveal({ from: 'more' }), false);
  openBuilder('games');
  notEqual(state.ui.view, 'settings', 'the builder does not open');
  openBuilder('notice');
  notEqual(state.ui.view, 'settings', 'the Notice screen does not open in a preview');
  if (typeof nbsSetField === 'function') {
    const before = JSON.stringify(state.notice);
    nbsSetField('title', 'Leak check');
    assert.equal(JSON.stringify(state.notice), before, 'the notice screen writes nothing in a preview');
  }
  ['members', 'history', 'counselors'].forEach((id) => { shellSheetOpen(id); assert.notOk(shell.sheets.includes(id), id + ' is a director\'s sheet'); });
  SETUP_SHEETS.forEach((id) => { shellSheetOpen(id); assert.notOk(shell.sheets.includes(id), id + ' belongs to the builder'); });
  // The game sheet (Step 21) also opens over the Games tab with the builder closed — its Add games, Quick game and a game's row — and is a
  // director's alone: in a preview none of the doors opens it, and no engine call writes a game.
  const nGames = allGames().length;
  shellSheetOpen('game');
  assert.notOk(shell.sheets.includes('game'), 'the game sheet is a director\'s');
  assert.equal(shellSheetAllowed('game'), false);
  assert.equal(gmAddGames('wed'), false);
  assert.equal(gmOpenQuick(), false);
  assert.equal(gmOpenNew({ dk: 'wed' }), false);
  assert.equal(gmOpenGame(allGames()[0].id), false);
  startQuickGame();
  assert.equal(gmUi.open, null, 'nothing opened');
  assert.equal(gmCommit(allGames()[0].id, { location: 'Mine' }).ok, false, 'and the engine writes nothing');
  assert.equal(gmMakeDay('sat').ok, false);
  assert.equal(allGames().length, nGames);
  openHistory(); openMembers();
  assert.deepEqual(shell.sheets, [], 'no sheet came up');
  // a deep link that names a director screen lands on a counselor screen
  shellOpenTarget('reveal');
  assert.notOk(revealRemoteIsOpen(), 'the remote stays shut');
  assert.equal(toolOpenId(), null);
  // a tool that was open when the preview began closes with it
  previewStop();
  assert.equal(openTool('tell', { from: 'more' }), true);
  previewStart();
  assert.equal(toolOpenId(), null, 'Tell everyone closed when the preview began');
  assert.equal(state.ui.tool, null);
  // More shows no director group, and none of the rows inside it
  state.ui.tab = 'more'; renderAll();
  assert.equal(el('more-director').hidden, true);
  ['tell-row', 'award-row', 'history-row'].forEach((id) => assert.equal(el(id).hidden, true, id + ' is hidden'));
  done();
});

test('What counselors see hides in a preview exactly what it hides for a counselor: Games, Memory verse, Meal cleanup and Chat', () => {
  boot('editor');
  state.meta.hiddenCards = { competitions: true, verse: true, cleanup: true, chat: true };
  renderAll();
  const card = (k) => document.querySelector(`[data-card="${k}"]`);
  ['competitions', 'verse', 'cleanup'].forEach((k) => assert.equal(card(k).hidden, false, 'a director sees ' + k));
  assert.equal(chatHiddenFromMe(), false);
  previewStart();
  ['competitions', 'verse', 'cleanup'].forEach((k) => assert.equal(card(k).hidden, true, 'the preview hides ' + k));
  assert.equal(el('games-off').hidden, false, 'Games says why it is empty, as a counselor reads it');
  assert.equal(chatHiddenFromMe(), true, 'the Chat tab says it is turned off');
  assert.equal(shellSheetAllowed('verse'), false);
  assert.equal(shellSheetAllowed('cleanup'), false);
  // the standings and the quick-points ledger are secret for a counselor whatever the switches say
  assert.equal(card('standings').hidden, true);
  assert.equal(card('bonus').hidden, true);
  previewStop();
  assert.equal(card('competitions').hidden, false, 'Exit shows them to the director again');
  assert.equal(chatHiddenFromMe(), false);
  done();
});

test('What counselors see on Now: a preview draws a games block, Bible study and a meal exactly as a counselor\'s phone does with the switches off', () => {
  const realOnRota = cleanupOnRota; const realRota = cleanupTeams;
  try {
    boot('editor');
    cleanupOnRota = (d) => d >= 1 && d <= 5;
    cleanupTeams = (d, meal) => (d < 1 || d > 5 ? [] : meal === 'Breakfast' ? ['t0'] : meal === 'Lunch' ? ['t1', 't2'] : []);
    state.meta.hiddenCards = { competitions: true, verse: true, cleanup: true };
    const day = nowBlocks(3);
    const games = day.find((x) => x.kind === 'games' && gamesForBlock(3, x.b).length);
    const lunch = day.find((x) => x.kind === 'meal' && x.meal === 'Lunch');
    const picture = (m) => { const x = nowModel({ now: { dow: 3, minutes: m }, ms: Date.UTC(2026, 6, 22, 12, 0, 0) + m * 60000 }); return [x.card.kind, !!x.moment, x.body.duty ? x.body.duty.length : 0, (x.body.rows || []).filter((r) => 'status' in r).length]; };
    const times = [games.start + 5, lunch.start + 5, lunch.end + 5];
    const own = times.map(picture);
    assert.equal(own[0][0], 'games', 'a director sees Games on Now');
    assert.equal(own[2][1], true, 'and the cleanup panel');
    previewStart();
    const prev = times.map(picture);
    previewStop();
    // a real counselor's phone with the same switches
    setMemberRole('viewer');
    const real = times.map(picture);
    assert.deepEqual(prev, real, 'a preview draws what a counselor draws');
    assert.equal(prev[0][0], 'activity');
    assert.equal(prev[1][2], 0);
    assert.equal(prev[2][1], false);
    done();
  } finally { cleanupOnRota = realOnRota; cleanupTeams = realRota; }
});

test('the reveal: a preview reads the counselor\'s view of it (the phone\'s hold, no director data), never the remote\'s', () => {
  boot('editor');
  assert.equal(revealViewRole(), 'editor');
  assert.equal(revealUiIsDirector(), true);
  previewStart();
  assert.equal(revealViewRole(), 'viewer');
  assert.equal(revealUiIsDirector(), false);
  assert.equal(revealRemoteMayOpen(), false);
  assert.equal(revealRemoteIsOpen(), false);
  previewStop();
  assert.equal(revealViewRole(), 'editor');
  done();
});

test('a live reveal in a preview is exactly the counselor\'s mirror: the same rows, the same hold on the newest place', () => {
  boot('editor');
  const T0 = Date.parse('2027-06-23T23:31:00Z'); const N = CAMP.teamCount; const sa = T0 + 10000;
  const ent = (id, p) => ({ nm: 'Team ' + id, p, g: 1, s: 0, b: 0, v: 0, m: 0, c: 0 });
  const pub = {};
  for (let i = 0; i < 2; i++) { const tid = 't' + (N - 1 - i); pub['g' + i] = { place: N - i, e: { [tid]: ent(tid, 10 * (N - i)) } }; }
  const ctl = { v: 1, id: 'r1kz9fxq-4hd2', seq: 3, phase: 'live', cur: 1, shown: 2, teams: N, finale: false, at: sa, sa, ca: T0, startedAt: T0, until: untilFor(T0, false) };
  const realNow = Date.now; const wasKnown = serverOffsetKnown; const wasOffset = serverTimeOffset;
  serverTimeOffset = 0; serverOffsetKnown = true;
  confirmedReveal.real = { ctl, pub };
  try {
    const seen = {};
    [['preview', sa + 1000], ['preview', sa + 3000]].forEach(([, at]) => {
      Date.now = () => at;
      if (!counselorPreviewOn) previewStart();
      seen['p' + at] = JSON.stringify(revealMirrorView());
    });
    previewStop();
    setMemberRole('viewer'); // a real counselor
    [sa + 1000, sa + 3000].forEach((at) => { Date.now = () => at; seen['v' + at] = JSON.stringify(revealMirrorView()); });
    assert.equal(seen['p' + (sa + 1000)], seen['v' + (sa + 1000)], 'inside the hold: the same view');
    assert.equal(seen['p' + (sa + 3000)], seen['v' + (sa + 3000)], 'after it: the same view');
    assert.equal(JSON.parse(seen['p' + (sa + 1000)]).rows.length, 1, 'and the newest place is withheld in both');
    assert.equal(JSON.parse(seen['p' + (sa + 3000)]).rows.length, 2);
  } finally { Date.now = realNow; serverOffsetKnown = wasKnown; serverTimeOffset = wasOffset; confirmedReveal.real = null; }
  done();
});

test('POSITIVE CONTROL: the same walk as a director, with no preview, does hit the patterns', () => {
  boot('editor');
  state.ui.tab = 'games'; renderAll();
  state.ui.tab = 'more'; renderAll();
  const found = leaksIn(__domSweep());
  assert.ok(found.length >= 3, 'a director\'s pages carry points and places: ' + found.length);
  done();
});

// ── 4. fidelity: the page a preview leaves is the page a counselor's phone paints ──

// Everything a screen shows, tab by tab, as { node: text } (a node is what the page looked it up with).
function walkPage(c) {
  return vm.runInContext(`(function () {
    const out = {};
    SHELL_TABS.forEach((tab) => {
      state.ui.tab = tab;
      renderAll();
      shellTick();
      const e = __domEntries();
      Object.keys(e).forEach((k) => { e[k] = e[k].replace(/\\s+/g, ' ').trim(); });
      out[tab] = e;
    });
    state.ui.tab = 'now';
    renderAll();
    return out;
  })()`, c);
}
function scenario(c, role, preview) {
  return vm.runInContext(`(function () {
    state = makeFreshState(); migrateState(state); normalizeSyncedState();
    ${PV_SEEDED ? 'setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (dow) => planForDow(dow), CAMP).ops);' : ''}
    const games = state.config.games;
    games.slice(0, 4).forEach((g, i) => { state.results[g.id] = { medals: { gold: 't' + (i % 3), silver: 't' + ((i + 1) % 3), bronze: 't' + ((i + 2) % 3) }, savedAt: '2026-07-20T12:0' + i + ':00Z' }; });
    state.bonuses = {
      v1: { teamId: 't0', category: 'verse', label: 'Mon memory verse', points: 5, at: '2026-07-20T12:05:00Z', day: 1 },
      q2: { teamId: 't3', category: 'custom', label: 'Penalty', points: -2, at: '2026-07-20T12:08:00Z' },
    };
    state.meta.hiddenCards = { competitions: false, verse: true, chat: true };
    state.followTeam = 't1';
    appStarted = true; fbRef = null;
    authUser = { email: 'jenn@example.com' }; memberName = 'Jenn';
    setMemberRole(${JSON.stringify(role)});
    ${preview ? 'renderAll(); previewStart();' : ''}
    state.ui.tab = 'now'; state.ui.gameId = null; state.ui.tool = null;
    return true;
  })()`, c);
}

// Text a DIRECTOR's renderer wrote into a node that lives inside a row hidden for everyone but directors. It stays behind
// (the renderer returns early for someone who may not open the row, as it always has for a demoted director), the row's
// own hidden flag is what keeps it off a counselor's screen, and the test checks that flag.
const HIDDEN_DIRECTOR_TEXT = { '#tell-row-sub': 'tell-row', '#more-reveal-state': 'reveal-row' };

function pageDiff(counselor, previewed, ctx) {
  const out = [];
  SHELL_TABS.forEach((tab) => {
    const x = counselor[tab]; const y = previewed[tab];
    new Set(Object.keys(x).concat(Object.keys(y))).forEach((k) => {
      if ((x[k] || '') === (y[k] || '')) return;
      const row = HIDDEN_DIRECTOR_TEXT[k];
      if (row && vm.runInContext(`__domHidden(${JSON.stringify(row)})`, ctx)) return;
      out.push(`${tab} ${k}: counselor ${JSON.stringify((x[k] || '').slice(0, 80))} / preview ${JSON.stringify((y[k] || '').slice(0, 80))}`);
    });
  });
  return out;
}

test('FIDELITY: a director in a preview paints, tab for tab and node for node, what a counselor\'s phone paints', () => {
  // The same week on two phones: a real counselor's, and a director's that has painted ITS OWN page first (so every
  // node holds director markup) and then started the preview.
  const mk = () => pvRead(makeContext({ camp: CAMP.id, seeded: PV_SEEDED }));
  let diff = [];
  for (let attempt = 0; attempt < 3; attempt++) { // a minute boundary between the two walks changes the banner's clock: retry; a real difference repeats
    const a = mk(); const b = mk();
    scenario(a.ctx, 'viewer', false);
    scenario(b.ctx, 'editor', true);
    diff = pageDiff(walkPage(a.ctx), walkPage(b.ctx), b.ctx);
    if (!diff.length) break;
  }
  assert.deepEqual(diff, [], 'the two pages differ');
  // a page that was never walked proves nothing: the walk really painted something
  const a = mk();
  scenario(a.ctx, 'viewer', false);
  assert.ok(Object.values(walkPage(a.ctx).now).filter((t) => t).length > 5, 'the counselor page has content');
});

test('FIDELITY, the other way: a director who has NOT started a preview paints something a counselor does not (the comparison can fail)', () => {
  const mk = () => pvRead(makeContext({ camp: CAMP.id, seeded: PV_SEEDED }));
  const a = mk(); const b = mk();
  scenario(a.ctx, 'viewer', false);
  scenario(b.ctx, 'editor', false);
  const diff = pageDiff(walkPage(a.ctx), walkPage(b.ctx), b.ctx);
  assert.ok(diff.length >= 3, 'a director\'s tabs are not a counselor\'s: ' + diff.length + ' nodes differ');
  assert.ok(diff.some((d) => /#gs-list|#gs-gap|#qp-now|standings|bonus|follow|pts/i.test(d)), 'and the difference is the standings and points: ' + diff.slice(0, 3).join(' | '));
});

// ── 5. every write gate still holds ───────────────────────────────────

test('nothing a tap can do in a preview reaches the database or changes the week: director acts and counselor acts alike', async () => {
  boot('editor');
  const db = makeFakeRtdb();
  const writes = [];
  const realFirebase = globalThis.firebase;
  const wrap = (ref) => new Proxy(ref, {
    get(t, k) {
      if (['set', 'update', 'remove', 'push', 'transaction'].includes(k)) return (...a) => { writes.push(k); return Promise.resolve(); };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  globalThis.firebase = { database: Object.assign(() => ({ ref: (p) => wrap({ set() {}, update() {}, remove() {}, push() { return { key: 'k1' }; }, transaction() {} }) }), { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } }) };
  const savedPush = pushState; const savedSave = saveState;
  let saves = 0;
  saveState = (...a) => { saves += 1; return savedSave(...a); };
  const realToast = showToast; const toasts = [];
  showToast = (m) => { toasts.push(String(m)); };
  try {
    previewStart();
    state.announcements = { a1: { id: 'a1', text: 'x', at: new Date().toISOString(), ttlMs: 3600000 } };
    const before = JSON.stringify(syncedSnapshot());
    // the director's acts
    setVersePoints('t0', 3, 5);
    setCleanupPoints('t0', 3, 'Lunch', 3);
    bonusDraft.teams = ['t0']; bonusDraft.points = '4'; bonusDraft.sign = 1; bonusDraft.category = 'custom'; bonusDraft.custom = 'x';
    notEqual(bonusAddFromDraft({ day: 3 }), '', 'the quick-points writer refuses');
    assert.equal(removeBonusEntry(Object.keys(state.bonuses)[0]), false);
    assert.equal(postBanner('Lightning. Everyone inside.', 3600000), null);
    assert.equal(takeDownBanner('a1'), false);
    setNoticeStatus('posted');
    toggleCardHidden('verse');
    assert.equal(configLocked(), true, 'the catalog\'s writers ask configLocked(), which says no to a preview');
    assert.equal(putGamesOnSchedule && putGamesOnSchedule().ok, false);
    assert.equal(typeof commitSetup === 'function' && commitSetup((t) => t, { label: 'x' }).ok, false, 'a setup commit is refused');
    assert.equal((await pushSendAlert({ text: 'hi', audience: 'all' })).ok, false, 'a director alert is refused');
    assert.equal((await revealStart({ practice: true, quiet: true })).ok, false, 'a reveal Start is refused');
    assert.equal(canScoreRound('t5'), false);
    assert.equal(settleExpiredClocks(), false);
    pruneExpiredAnnouncements();
    assert.ok(state.announcements.a1, 'housekeeping that would delete is paused too');
    assert.equal(JSON.stringify(syncedSnapshot()), before, 'the week did not move');
    assert.deepEqual(writes, [], 'nothing reached the database: ' + writes.join(','));
    assert.equal(saves, 0, 'and nothing was even saved on this phone');
    // a counselor's acts that WOULD write for a counselor: chat and phone alerts
    myKeyForTest();
    const input = el('chat-input'); input.value = 'hello from a preview';
    sendChatMessage('general');
    assert.equal(input.value, 'hello from a preview', 'the words stay in the box');
    sendChatPhoto('general', { name: 'p.jpg', size: 10 });
    deleteChatMessage('general', { id: 'm1', byKey: identityKey(authUser) });
    await pushEnable(); await pushDisable(); await pushSendTest();
    await assert.doesNotThrow(() => chatAtomicSend({ 'chat/general/x': { text: 'x' } }, 'chatRate/me').catch(() => {}));
    assert.deepEqual(writes, [], 'no chat or alert write reached the database: ' + writes.join(','));
    assert.ok(toasts.some((t) => /previewing as a counselor/i.test(t)), 'a refused tap says so: ' + JSON.stringify(toasts.slice(-3)));
    // and the same taps work as soon as the preview is over
    previewStop();
    assert.equal(canEdit(), true);
    setVersePoints('t0', 3, 5);
    assert.ok(state.bonuses['verse-t0-3'], 'Exit gives a director\'s writers back');
  } finally {
    globalThis.firebase = realFirebase; saveState = savedSave; showToast = realToast;
    done();
  }
});
function myKeyForTest() { authUser = { email: 'jenn@example.com', emailVerified: true }; }

test('the push drawer keeps a bell flipped in a preview on this phone and writes the record afterwards', () => {
  boot('editor');
  previewStart();
  const real = setTimeout; const timers = [];
  pushPrefsTimer = null;
  pushRewriteRecord();
  assert.ok(pushPrefsTimer, 'the rewrite is re-armed, not run, while the preview is up');
  clearTimeout(pushPrefsTimer); pushPrefsTimer = null;
  done();
});

// ── 6. the engines still see a director ───────────────────────────────

const PV_CS_PATH = dbPath('config');
test('a config snapshot landing mid-preview rebases the director\'s unconfirmed edit, and the push still goes out', async () => {
  boot('editor');
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  configReady = false; cfgFirstPending = null; remoteReady = true; syncDenied = false; pendingConfigWrites = 0; configPushOwed = false;
  delete state._cfgBase; delete state._cfgNotes;
  undoClear();
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  db.serverSet(PV_CS_PATH, state.config);
  fbConfigRef = db.ref(PV_CS_PATH);
  attachConfigListener();
  db.deliverFirstSnapshots();
  await waitUntil(() => configReady, 'the first config snapshot');
  try {
    const gid = state.config.games[0].id; const other = state.config.games[1].id;
    const mineName = state.config.games[0].name + ' (mine)';
    state.config.games[0].name = mineName; // an unconfirmed edit made as a director, just before the preview
    assert.ok(Object.keys(cfgUnconfirmed()).length > 0, 'precondition: unconfirmed work');
    previewStart();
    assert.equal(hasUnconfirmedLocalWork(), true, 'sign-out still names it');
    // another director edits a different game while this phone is previewing
    const cur = db.serverGet(PV_CS_PATH);
    cur.games.find((g) => g.id === other).name = 'Theirs';
    db.serverSet(PV_CS_PATH, cur);
    await waitQuiet();
    assert.equal(state.config.games.find((g) => g.id === gid).name, mineName, 'the unconfirmed edit survived the snapshot: the engine did not treat this phone as a viewer');
    assert.equal(state.config.games.find((g) => g.id === other).name, 'Theirs', 'and their change arrived');
    saveConfig();
    pushConfig();
    await waitQuiet();
    assert.equal(db.serverGet(PV_CS_PATH).games.find((g) => g.id === gid).name, mineName, 'the director\'s edit reached the server from a phone that was previewing');
    assert.equal(Object.keys(cfgUnconfirmed()).length, 0);
    previewStop();
  } finally {
    delete window.FIREBASE_CONFIG; fbConfigRef = null; configReady = false; cfgFirstPending = null; remoteReady = false;
    pendingConfigWrites = 0; configPushOwed = false; dataEditPending = false; delete state._cfgBase; delete state._cfgNotes;
    clearTimeout(pushConfigTimer); pushConfigTimer = null; undoClear();
    done();
  }
});

test('the auto-update reload is still held for unsent work while previewing (a director\'s unsent score, a refused batch)', () => {
  boot('editor');
  previewStart();
  assert.equal(reloadBlocked(), false, 'nothing unsent: free to reload (which ends the preview)');
  pendingWrites = 1;
  assert.equal(reloadBlocked(), true);
  pendingWrites = 0;
  dataEditPending = true; // a queued data push, the editor's mid-entry signal
  assert.equal(reloadBlocked(), true, 'editorMidEntry still counts for the phone: the lens is not a viewer');
  dataEditPending = false;
  done();
});

test('the engines ask directorTab, never canEdit: a source pin over the functions that protect or send work already made', () => {
  const body = (src, name) => {
    const m = new RegExp('(?:async )?function ' + name + '\\(').exec(src);
    assert.ok(m, name + ' exists');
    let i = src.indexOf('{', m.index); let depth = 0;
    for (let k = i; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(m.index, k + 1); } }
    return src.slice(m.index);
  };
  const SETUP_SRC = readFixture('../setup-sync.js');
  const PUSH_SRC = readFixture('../push.js');
  const engines = [
    [APP_SRC, 'applyRemoteConfig'], [APP_SRC, 'firstConfigMerge'], [APP_SRC, 'cfgFollowStateEpoch'], [APP_SRC, 'autoRetryQuarantined'],
    [APP_SRC, 'reloadBlocked'], [APP_SRC, 'shellHasUnsentWork'], [APP_SRC, 'hasUnconfirmedLocalWork'],
    [SETUP_SRC, 'firstSetupMerge'], [SETUP_SRC, 'pushSetup'], [SETUP_SRC, 'restoreFlushOutbox'], [PUSH_SRC, 'pushRepublishSchedule'],
  ];
  // (applyRemoteConfig's one canEdit is the migration push: it CREATES a write, so it pauses in a preview on purpose)
  const allowed = { applyRemoteConfig: 'upgraded && canEdit() && state.config.version !== v0' };
  engines.forEach(([src, name]) => {
    let b = body(src, name).replace(/\/\/.*$/gm, '');
    if (allowed[name]) b = b.replace(allowed[name], '');
    assert.notOk(/\bcanEdit\(\)/.test(b), name + ' must ask directorTab(): a preview must not make this phone a viewer to its engines');
  });
  // …and the setup engine's snapshot merge, whose `canEdit` calls sit inside a larger function
  const snap = body(SETUP_SRC, 'processFirstSetup') + body(SETUP_SRC, 'onSetupSnapshot');
  assert.ok(snap.length > 400 && !/\bcanEdit\(\)/.test(snap.replace(/\/\/.*$/gm, '')), 'the setup snapshot path asks directorTab');
  // every other canEdit() in the screens (the lens makes them refuse) is a gate or a render: no list of call sites to keep
  assert.ok(/function canEdit\(\) \{\s*return directorTab\(\) && !counselorPreviewOn;/.test(APP_SRC), 'canEdit is the one lens');
  assert.ok(/function viewRole\(\) \{\s*return counselorPreviewOn \? 'viewer' : memberRole;/.test(APP_SRC), 'viewRole is the other');
});

test('the lens is read in only the places it was designed for: no other script names counselorPreviewOn but the chat backstop', () => {
  // every script index.html loads (the same list shell.test.js pins), read as source
  const files = [...INDEX.matchAll(/<script[^>]*\ssrc="([a-z0-9-]+\.js)\?v=/g)].map((m) => m[1]);
  assert.ok(files.length >= 15 && files.includes('app.js') && files.includes('tell.js'), 'the list of scripts was read: ' + files.length);
  const named = files.filter((f) => /counselorPreviewOn/.test(readFixture('../' + f)));
  assert.deepEqual(named.sort(), ['app.js', 'chat.js', 'push.js'].sort(), 'the flag is app.js\'s; chat.js\'s send backstop and push.js\'s record rewrite are the only readers elsewhere');
  const stored = /localStorage\.setItem\([^)]*[Pp]review|sessionStorage[^;]*[Pp]review|state\.ui\.[a-zA-Z]*[Pp]review/;
  files.forEach((f) => assert.notOk(stored.test(readFixture('../' + f)), f + ' stores the preview'));
});
