// ── reveal.js — the standings reveal's ENGINE (redesign §4, build plan Step 23) ──
// What a phone knows about a reveal, how it learns it, when it lets go of it, and
// (further down) the director's commands. It is an optional layer in the same
// contract as chat.js and push.js: a classic script loaded right after app.js, every
// hook in app.js typeof-guarded, so deleting its <script> leaves a running app that
// simply shows no reveal. It paints NOTHING itself except emptying the 8 AM grid
// roots: the remote, the Now mirror, the red strip and the frozen grid are painted by
// whatever defines `revealPaint(why, mode)` (the screens' build session), which this
// file calls after every confirmed change and every time-driven one.
//
// THE RULES THIS FILE LIVES BY
//  - Phones read the reveal through reveal-core.js's revealView ONLY (it fails closed),
//    from <root>/revealPublic/real ONLY: not even a practice's bytes reach a counselor.
//    Nothing here touches a points reader unless the person is a confirmed director
//    starting a reveal (the freeze, in the commands half).
//  - Listeners attach after membership is approved (initReveal is called from initSync),
//    and a refusal degrades the reveal only: never fbRef, never syncDenied.
//  - Every consumer reads `confirmedReveal` — server-acknowledged state — never the SDK's
//    optimistic echo of this phone's own write, which the SDK reverts if the rules refuse it.
//  - Time is the SERVER's (serverNow()), read at the moment of use, never cached: the 8 AM
//    hide must not depend on a value computed earlier.
//  - Classic scripts share one global scope: every name here starts reveal / REVEAL_ so it
//    can't collide with reveal-core.js (whose names this file deliberately reuses).

const REVEAL_CACHE_KEY = 'campScoreboardRevealCache';     // per camp (lsKey): { ctl, pub } of the REAL reveal, for an instant paint and offline
const REVEAL_CHAMPION_KEY = 'campScoreboardChampion';     // per camp (lsKey): the crowned team(s), name only, no number
const REVEAL_CACHE_MAX_CHARS = 20000;                     // a real node is about 1 KB; refuse to keep anything silly
const REVEAL_RETIRE_EVERY_MS = 60 * 1000;                 // retireExpiredReveal sends at most this often
const REVEAL_RESCAN_MS = 5 * 60 * 1000;                   // and a director re-reads revealPublic this often while the page is visible
const REVEAL_CHAMPION_KEEP_MS = 14 * 24 * 3600 * 1000;    // the champion line never outlives this, whatever the week says
const REVEAL_GRID_ROOTS = ['now-reveal-grid', 'games-reveal-grid']; // the frozen grid's roots (index.html); each has a '-list' child

// ── the confirmed store ─────────────────────────────────────────────
// The raw { ctl, pub } of each child, as the SERVER last said it, or null (no node).
// Raw on purpose: a screen reads it through normalizeRevealCtl / revealView, and the
// command builders copy fields from it, so a clamped or repaired copy can never be
// written back. `real` is the one counselors read; `practice` is attached for
// directors only.
const confirmedReveal = { real: null, practice: null };
const revealLoaded = { real: false, practice: false };   // a server snapshot (not the cache) has landed
let revealStarted = false;
let revealDenied = false;                                // the real listener was refused: rules not published, or switched off
let revealPracticeDenied = false;
let revealRealRef = null, revealRealCb = null;
let revealPracticeRef = null, revealPracticeCb = null;
let revealTimer = null;                                  // the next moment anything on screen changes with no snapshot to say so
let revealRescanTimer = null;
let revealLastSig = '';
let revealLastRetireAt = 0;
let revealRetiring = false;

function revealSdkReady() {
  return typeof firebase !== 'undefined' && !!firebase.database;
}

function revealClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// ── who is looking, and when ────────────────────────────────────────
// Phones hold the newest place back for REVEAL_LOOK_MS ('viewer' | 'editor'); a
// director's remote and the big screen ARE the show and never lag.
function revealViewRole() { return viewRole() === 'editor' ? 'editor' : 'viewer'; } // viewRole: a counselor preview reads the counselor's view (the phone's 3 s hold, no remote data)

// A reveal from another camp year (wizard epoch) is ignored; '' = the legacy week.
function revealEpoch() {
  const e = state && state.meta && state.meta.epoch;
  return typeof e === 'string' ? e : '';
}

function revealViewOf(mode, role) {
  const node = confirmedReveal[mode];
  if (!node) return null;
  return revealView(node.ctl, node.pub, serverNow, role, {
    denied: mode === 'real' ? revealDenied : revealPracticeDenied,
    epoch: revealEpoch(),
    // A phone that has never learned the server's clock fails closed (the newest place is held back): see app.js.
    clockUnknown: !serverOffsetKnown,
  });
}

// What the Now mirror and the strip read (a director's phone included).
function revealMirrorView() { return revealViewOf('real', revealViewRole()); }
// What a director's remote reads (no lag), for either child.
function revealRemoteView(mode) { return revealViewOf(mode === 'practice' ? 'practice' : 'real', 'remote'); }
// The takeover of Now: a reveal that is live and not yet at the final table.
function revealLiveView() { const v = revealMirrorView(); return v && v.live ? v : null; }
// The frozen grid: a reveal that is over (ended, early, auto-ended, at the table) and not yet 8 AM.
function revealGridView() {
  const v = revealMirrorView();
  return v && !v.expired && !v.live && v.rows.length ? v : null;
}

// ── the cache (an instant first paint, and a phone that starts offline) ──
function revealLoadCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(lsKey(REVEAL_CACHE_KEY)) || 'null');
    if (raw && typeof raw === 'object' && raw.ctl && typeof raw.ctl === 'object') {
      confirmedReveal.real = { ctl: raw.ctl, pub: raw.pub && typeof raw.pub === 'object' ? raw.pub : null };
    }
  } catch (e) { /* a corrupt cache is no cache */ }
}

function revealStoreCache() {
  try {
    const node = confirmedReveal.real;
    const c = node && normalizeRevealCtl(node.ctl);
    // nothing to keep: no reveal, or one whose 8 AM has passed (its numbers must not linger on the phone)
    if (!node || (c && serverNow() >= c.until)) { localStorage.removeItem(lsKey(REVEAL_CACHE_KEY)); return; }
    const text = JSON.stringify(node);
    if (text.length > REVEAL_CACHE_MAX_CHARS) { localStorage.removeItem(lsKey(REVEAL_CACHE_KEY)); return; }
    localStorage.setItem(lsKey(REVEAL_CACHE_KEY), text);
  } catch (e) { /* storage blocked or full: the live listener still works */ }
}

function revealDropCache() {
  try { localStorage.removeItem(lsKey(REVEAL_CACHE_KEY)); } catch (e) { /* ignore */ }
}

// ── snapshots in ─────────────────────────────────────────────────────
function revealNodeOf(val) {
  if (!val || typeof val !== 'object' || !val.ctl || typeof val.ctl !== 'object') return null;
  return { ctl: revealClone(val.ctl), pub: val.pub && typeof val.pub === 'object' ? revealClone(val.pub) : null };
}

// Take `val` (a child's value as the server holds it) as the confirmed state.
// Returns true when anything on screen could differ.
function revealAccept(mode, val, why) {
  const next = revealNodeOf(val);
  const changed = JSON.stringify(confirmedReveal[mode]) !== JSON.stringify(next) || !revealLoaded[mode];
  confirmedReveal[mode] = next;
  revealLoaded[mode] = true;
  if (mode === 'real') revealStoreCache();
  // A different reveal (a new Start) leaves the old freeze behind.
  if (!next || (revealFullHeld(mode) && revealFullHeld(mode).r !== next.ctl.id)) revealForgetFull(mode);
  if (changed) revealChanged(mode, why || 'snapshot');
  else revealArmTimer();
  return changed;
}

function revealOnSnapshot(mode, snap) {
  // A snapshot raised while this phone's own command is still unacknowledged is the SDK's
  // optimistic echo (it will be reverted if the rules refuse it): it is not confirmed. The
  // command's completion re-reads the node, which is.
  if (typeof revealInFlight !== 'undefined' && revealInFlight[mode] > 0) return;
  revealAccept(mode, snap.val(), 'snapshot');
}

// Everything that follows a confirmed change, or the clock reaching a moment that matters.
function revealChanged(mode, why) {
  revealEvaluate();
  revealLastSig = revealTimeSig();
  if (typeof revealPaint === 'function') revealPaint(why || 'data', mode);
}

function revealEvaluate() {
  revealRememberChampion();
  revealArmTimer();
  if (typeof revealAfterEvaluate === 'function') revealAfterEvaluate();
}

// ── listeners (after membership is approved: initSync calls this) ───
function initReveal() {
  if (revealStarted) return;
  revealStarted = true;
  if (!revealSdkReady()) return;
  try {
    revealRealRef = firebase.database().ref(dbPath('revealPublic/real'));
    revealRealCb = (snap) => revealOnSnapshot('real', snap);
    revealRealRef.on('value', revealRealCb, () => {
      // Refused (the rules are not published, or the read was switched off): fail closed, this feature only.
      revealDenied = true;
      revealChanged('real', 'denied');
    });
  } catch (e) { revealDenied = true; }
  revealSyncRole();
  if (!revealRescanTimer && typeof setInterval === 'function') {
    revealRescanTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      revealRescan().then(() => { retireExpiredReveal(); });
    }, REVEAL_RESCAN_MS);
  }
  revealRescan().then(() => { retireExpiredReveal(); });
}

// A director also listens to the practice child; a counselor never does. The read is public
// (it can't be cancelled by a role change), so this only ever attaches or detaches.
function revealSyncRole() {
  if (!revealStarted || !revealSdkReady()) return;
  if (memberRole === 'editor' && !revealPracticeRef) {
    try {
      revealPracticeRef = firebase.database().ref(dbPath('revealPublic/practice'));
      revealPracticeCb = (snap) => revealOnSnapshot('practice', snap);
      revealPracticeRef.on('value', revealPracticeCb, () => {
        revealPracticeDenied = true;
        revealChanged('practice', 'denied');
      });
    } catch (e) { revealPracticeRef = null; revealPracticeDenied = true; }
  } else if (memberRole !== 'editor' && revealPracticeRef) {
    try { revealPracticeRef.off('value', revealPracticeCb); } catch (e) { /* ignore */ }
    revealPracticeRef = null;
    revealPracticeCb = null;
    confirmedReveal.practice = null;
    revealLoaded.practice = false;
    revealPracticeDenied = false;
    revealForgetFull('practice');
    revealForgetFull('real');   // the up-next preview is for directors: a demoted phone drops it
  }
}

// app.js's setMemberRole calls this after the role changed.
function revealOnRoleChange() {
  revealSyncRole();
  if (typeof revealOnRoleChanged === 'function') revealOnRoleChanged();
  revealChanged('real', 'role');
  if (memberRole === 'editor') revealRescan().then(() => { retireExpiredReveal(); });
}

// One once() read of the whole public node: a director's backstop for what the two listeners
// might have missed, and how retireExpiredReveal learns what exists. Never for counselors
// (their phones must not download a practice).
function revealRescan() {
  if (!revealStarted || memberRole !== 'editor' || !revealSdkReady()) return Promise.resolve(false);
  return firebase.database().ref(dbPath('revealPublic')).once('value').then((snap) => {
    const v = (snap && snap.val()) || {};
    ['real', 'practice'].forEach((m) => {
      // not while a command of ours is unacknowledged: the node under it is about to change
      if (typeof revealInFlight !== 'undefined' && revealInFlight[m] > 0) return;
      revealAccept(m, v[m] || null, 'rescan');
    });
    return true;
  }).catch(() => false);
}

// ── the clock: when does something change with no snapshot to say so? ──
// The 3-second look-at-the-big-screen window ends, an unended reveal is treated as over,
// the 8 AM hide: each is a MOMENT, and a quiet 8:00 brings no snapshot. One timer is armed
// for the soonest, re-armed after every change, and the 30 s tick, a wake from sleep and a
// corrected clock all run the same revealTick, so a missed timer costs seconds, never
// correctness (every reader also decides "expired" itself, at paint time).
function revealNextBoundary(mode, now) {
  const node = confirmedReveal[mode];
  const c = node && normalizeRevealCtl(node.ctl);
  if (!c) return null;
  let best = null;
  const take = (t) => { if (typeof t === 'number' && t > now && (best === null || t < best)) best = t; };
  take(c.until);
  if (mode === 'real' && c.shown > 0) take(c.sa + REVEAL_LOOK_MS);
  if (c.phase !== 'ended') {
    take(c.at + (c.phase === 'champion' || c.phase === 'table' ? REVEAL_AUTO_END_SHORT_MS : REVEAL_AUTO_END_LONG_MS) + 1);
  }
  return best;
}

function revealArmTimer() {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
  const now = serverNow();
  let at = null;
  ['real', 'practice'].forEach((m) => {
    const t = revealNextBoundary(m, now);
    if (t !== null && (at === null || t < at)) at = t;
  });
  if (at === null) return;
  // a little past the moment (never early: an early fire would only re-arm); capped, because a
  // timer longer than 2^31 ms fires at once. A long wait is simply re-armed by the next tick.
  const wait = Math.min(Math.max(at - now + 25, 25), 2147000000);
  revealTimer = setTimeout(() => { revealTimer = null; revealTick('timer'); }, wait);
}

// What a screen could notice changing with time alone.
function revealTimeSig() {
  const f = (v) => (v ? [v.live, v.phase, v.expired, v.looking, v.onScreen, v.rows.length].join('|') : '-');
  // The camp day rides along: the grid's "Tonight's" becomes "Last night's" at midnight, with no snapshot to say so.
  return f(revealMirrorView()) + '/' + (viewRole() === 'editor' ? f(revealRemoteView('practice')) : '-') + '/' + revealYmdOf(serverNow());
}

// The 30 s tick (shellTick), a wake, a corrected clock and the timer all land here.
function revealTick(why) {
  if (!revealStarted && !confirmedReveal.real) return;
  expireReveal();
  retireExpiredReveal();
  revealEvaluate();
  const sig = revealTimeSig();
  if (sig !== revealLastSig) {
    revealLastSig = sig;
    if (typeof revealPaint === 'function') revealPaint(why || 'time', null);
  }
}

// Waking up: iOS restores a frozen page without running any timer. Hidden → visible and a
// restored page both come here (registered once, at load, so a quiet 8:00 can't be missed).
function revealOnWake() {
  if (typeof document !== 'undefined' && document.hidden) return;
  revealTick('wake');
  if (memberRole === 'editor') revealRescan().then(() => { retireExpiredReveal(); });
}

// The `.info/serverTimeOffset` handler in app.js calls this when the estimate moved: every
// "is it 8 AM yet" answer may have changed.
function revealOnClockChange() { revealTick('clock'); }

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', revealOnWake);
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pageshow', revealOnWake);
}

// ── 8 AM: the grid goes ──────────────────────────────────────────────
// Hiding is one time-driven action, not a render side effect: a quiet 8:00 brings no snapshot,
// so no renderAll. expireReveal empties every grid root DIRECTLY (Now's, Games') and drops the
// device's copy of the numbers; every renderer that can draw a grid also decides "expired"
// itself at paint time (revealView), so even a missed call cannot show points after 8 AM.
// Returns true when a reveal expired since the last call.
let revealExpiredId = null;
function expireReveal() {
  const node = confirmedReveal.real;
  const c = node && normalizeRevealCtl(node.ctl);
  if (!c || serverNow() < c.until) return false;
  revealRememberChampion();                    // the crowned team's NAME outlives the node
  revealEmptyGridRoots();
  if (revealExpiredId === c.id) return false;
  revealExpiredId = c.id;
  revealDropCache();                           // an expired grid keeps no numbers on this phone
  return true;
}

function revealEmptyGridRoots() {
  REVEAL_GRID_ROOTS.forEach((id) => {
    const root = document.getElementById(id);
    if (!root) return;
    setHtmlIfChanged(document.getElementById(id + '-list'), '');
    setHiddenIfChanged(root, true);
  });
}

// ── the writer's half of the 8 AM rule (directors only) ─────────────
// The node is deleted by a director phone, never a counselor's. The rules decide by the SERVER's
// clock: a phone whose clock runs early is refused (swallowed, retried next minute), one that
// runs late deletes a little late; two directors at once both succeed. Sends at most once a
// minute, only while the connection is up and the first pull is done, and only for a child whose
// own `until` has passed (a practice may also have been left in phase ended).
function revealRawUntil(node) {
  const u = node && node.ctl ? node.ctl.until : null;
  return typeof u === 'number' && Number.isFinite(u) && u > 0 ? u : null;
}

function revealExpiredModes() {
  const now = serverNow();
  const out = [];
  ['real', 'practice'].forEach((m) => {
    const node = confirmedReveal[m];
    if (!node) return;
    const until = revealRawUntil(node);
    if (until !== null && now >= until) out.push(m);
    else if (m === 'practice' && node.ctl.phase === 'ended') out.push(m);
  });
  return out;
}

function retireExpiredReveal() {
  if (!(memberRole === 'editor' && memberRoleConfirmed && canEdit())) return { sent: false, why: 'not-editor' };
  if (!revealStarted || !revealSdkReady()) return { sent: false, why: 'no-sync' };
  if (!remoteReady || !fbConnected) return { sent: false, why: 'not-ready' };
  if (revealRetiring || (typeof revealInFlight !== 'undefined' && (revealInFlight.real || revealInFlight.practice))) return { sent: false, why: 'busy' };
  const modes = revealExpiredModes();
  if (!modes.length) return { sent: false, why: 'nothing' };
  const t = Date.now();
  if (t - revealLastRetireAt < REVEAL_RETIRE_EVERY_MS) return { sent: false, why: 'throttled' };
  revealLastRetireAt = t;
  const updates = {};
  modes.forEach((m) => { updates['revealPublic/' + m] = null; updates['revealFull/' + m] = null; });
  revealRetiring = true;
  const root = firebase.database().ref(CAMP.dbRoot);
  Promise.resolve().then(() => root.update(updates)).catch(() => { /* a refusal (early clock) is retried next minute */ }).then(() => {
    revealRetiring = false;
    return revealRescan();
  });
  return { sent: true, modes };
}

// ── the champion line ────────────────────────────────────────────────
// A FINALE reveal crowns the 1st-place team(s) in front of the whole camp. The grid goes at 8 AM
// and the node is deleted, but "this week's champions" is shown on Saturday's end card, so the
// phone remembers the NAME(S) (id + name, no number, nothing else) the moment the 1st-place
// group is on its screen, and keeps them until the camp week ends. It reads only the view's
// `champion` list: never a score, a medal count or a place. A phone that was closed during the
// ceremony simply has no line.
function revealRememberChampion() {
  const v = revealMirrorView();
  const list = v && v.champion;
  if (!list || !list.length) return false;
  const names = list
    .filter((c) => c && REVEAL_TEAM_KEY_RE.test(String(c.id)))
    .map((c) => ({ id: String(c.id), name: revealCleanName(c.name) }))
    .filter((c) => c.name);
  if (!names.length) return false;
  try {
    const prev = JSON.parse(localStorage.getItem(lsKey(REVEAL_CHAMPION_KEY)) || 'null');
    if (prev && prev.rid === v.id && JSON.stringify(prev.names) === JSON.stringify(names)) return false;
    localStorage.setItem(lsKey(REVEAL_CHAMPION_KEY), JSON.stringify({ ver: 1, rid: v.id, at: serverNow(), names }));
  } catch (e) { return false; }
  return true;
}

// [{ id, name }] or null. Forgotten when the camp week is over (or 14 days on, if no week date
// is known), so last year's champions never greet next year's Saturday.
function revealChampionLine() {
  let rec = null;
  try { rec = JSON.parse(localStorage.getItem(lsKey(REVEAL_CHAMPION_KEY)) || 'null'); } catch (e) { return null; }
  if (!rec || rec.ver !== 1 || !Array.isArray(rec.names) || typeof rec.at !== 'number') return null;
  const week = typeof campWeek === 'function' ? campWeek() : null;
  if ((week && week.phase === 'after') || serverNow() - rec.at > REVEAL_CHAMPION_KEEP_MS) {
    try { localStorage.removeItem(lsKey(REVEAL_CHAMPION_KEY)); } catch (e) { /* ignore */ }
    return null;
  }
  const out = rec.names
    .filter((c) => c && REVEAL_TEAM_KEY_RE.test(String(c.id)))
    .map((c) => ({ id: String(c.id), name: revealCleanName(c.name) }))
    .filter((c) => c.name);
  return out.length ? out : null;
}


// ════════════════════════════════════════════════════════════════════
// THE DIRECTORS' COMMANDS (redesign §4.5, §4.6)
// ════════════════════════════════════════════════════════════════════
// Every write a director's phone makes to the reveal is built here by a PURE builder (the time
// is an argument: a ServerValue.TIMESTAMP placeholder in production, a number in a test) and sent
// as ONE multi-path update at the camp root. Compare-and-set is the RULES' job — a command
// carries seq + 1 and `shown` at most + 1, `sa` only when a place is shown, and a Start carries
// `pub: null` — and this file's job is to build exactly the write the rules accept and to treat a
// refusal as "someone else got there first": re-read, say so in a sentence, follow the server.
//
//  - The PUBLIC node only ever gets the ctl and, as each place is shown, that one group. The complete
//    order (every team, every point) lives in revealFull/<mode>, editor-only, fetched with once() and
//    held in memory only while the remote is open; the member key is written there and nowhere else.
//  - A practice writes the `practice` child from the same real freeze, never touches `real`, never
//    calls pushSendAlert, and its End is the one command that deletes.

const REVEAL_ACK_SLOW_MS = 12 * 1000;       // a command not acknowledged this long looks like a dead connection
const REVEAL_CONNECT_QUIET_MS = 10 * 1000;  // a Start waits this long after the connection last changed (a socket that only looks alive)
const REVEAL_CHAMPION_LOCK_MS = REVEAL_BEAT_SCORE_MS; // the crowning holds the button this long (its big-screen moment)
const REVEAL_BUZZ_TEXT = 'The standings reveal is starting';

const revealInFlight = { real: 0, practice: 0 };        // commands handed to the server and not yet acknowledged
const revealInFlightSince = { real: 0, practice: 0 };
const revealFullStore = { real: null, practice: null }; // the director's private copy of the complete order: { r, n, groups }
const revealFullFetching = { real: null, practice: null };   // the read in progress (a promise), so a caller that needs the order waits for IT
const revealFullTried = { real: '', practice: '' };      // the reveal id the private freeze was last asked for (so an absent one is not asked for on every tick)
let revealConnChangedAt = 0;
let revealRemoteOpenFlag = false;                       // a director's remote is on screen
let revealPracticeOn = false;                           // the remote's Practice switch (the next Start)
let revealBuzzOn = true;                                // the remote's Buzz switch (a real Start only)
let revealStarting = false;

// A test's fresh start.
function revealResetCommands() {
  revealInFlight.real = 0; revealInFlight.practice = 0;
  revealInFlightSince.real = 0; revealInFlightSince.practice = 0;
  revealFullStore.real = null; revealFullStore.practice = null;
  revealFullFetching.real = null; revealFullFetching.practice = null;
  revealFullTried.real = ''; revealFullTried.practice = '';
  revealConnChangedAt = 0; revealRemoteOpenFlag = false; revealPracticeOn = false; revealBuzzOn = true; revealStarting = false;
}

function revealFullHeld(mode) { return revealFullStore[mode]; }
function revealForgetFull(mode) { revealFullStore[mode] = null; }

// The private freeze for the reveal the server currently holds, or null if none is held for THAT reveal.
function revealFullFor(mode) {
  const full = revealFullStore[mode];
  const node = confirmedReveal[mode];
  return full && node && node.ctl && full.r === node.ctl.id ? full : null;
}

// ── who may command, and whether the phone is fit to ─────────────────
// A confirmed director in the tab that owns the cache: the member record's role says director, and
// canEdit() says this is the writer tab (a second tab is view-only and writes nothing).
function revealMayCommand() {
  if (!(memberRole === 'editor' && memberRoleConfirmed)) return { ok: false, code: 'viewer' };
  if (!canEdit()) return { ok: false, code: 'view-only' };
  if (revealDenied) return { ok: false, code: 'rules' };
  if (!revealStarted || !revealSdkReady()) return { ok: false, code: 'no-sync' };
  return { ok: true };
}

function revealSlowAck() {
  const since = Math.max(revealInFlightSince.real, revealInFlightSince.practice);
  return !!since && Date.now() - since > REVEAL_ACK_SLOW_MS;
}

function revealOnConnectionChange() {
  revealConnChangedAt = Date.now();
  if (typeof revealPaint === 'function') revealPaint('connection', null);
}

// The sentence for a command this phone refused before sending anything, by reason. A refusal with no
// sentence left a gold button that looked ready, was tapped and did nothing, so every reason a director can
// reach says why (and reveal-ui.js wobbles the button for each).
function revealWhyWords(code) {
  switch (code) {
    case 'rules': return 'The reveal isn’t switched on yet (the database rules need updating).';
    case 'teams': return 'The reveal needs 2 to 6 teams with ids t0 to t5. Ask ' + (typeof ownerName === 'function' ? ownerName() : 'the owner') + '.';
    case 'no-identity': return 'This phone isn’t signed in. Reload the page and sign in again.';
    case 'clock': return 'This phone’s clock isn’t ready. Reload the page and try again.';
    case 'viewer': return 'Still checking that you’re a director. Try again in a moment.';
    case 'view-only': return 'This tab is view-only. Use the tab that is editing.';
    case 'no-sync': return 'Sync is off on this phone.';
    default: return '';
  }
}

// Why a Start cannot work on this phone however long it waits, or null. Cheap (no standings are computed), so
// the gate can ask it on every paint and the dock says why instead of looking ready. revealFreeze applies the
// same rule to the rows it builds; the Start that gets past this still goes through that check.
function revealStartBlock(nowMs) {
  const teams = state && Array.isArray(state.teams) ? state.teams : [];
  if (teams.length < 2 || teams.length > REVEAL_MAX_GROUPS || teams.some((t) => !t || !REVEAL_TEAM_KEY_RE.test(String(t.id)))) return 'teams';
  if (!identityKey(authUser)) return 'no-identity';
  if (!Number.isFinite(untilFor(nowMs, false))) return 'clock';
  return null;
}

// The ready screen's checks (mockup 06): is this phone up to date, is every game today scored, when
// was the last score saved. Only the first gates a Start; the other two are said, never enforced.
function revealStartGate() {
  const may = revealMayCommand();
  const settled = !!fbConnected && !!remoteReady && pendingWrites === 0 && !dataEditPending && !remoteRefetchPending && !editorMidEntry();
  const quiet = !!revealConnChangedAt && Date.now() - revealConnChangedAt < REVEAL_CONNECT_QUIET_MS;
  const now = serverNow();
  const dow = revealDowOf(now);
  let unscored = [];
  try {
    gamesForDay(dow).forEach((x) => x.games.forEach((g) => { if (!(state.results && state.results[g.id])) unscored.push(g.name || g.id); }));
  } catch (e) { unscored = []; }
  const last = Date.parse(state.meta && state.meta.lastDataChangeAt);
  const pending = !revealLoaded.real || (revealPracticeOn && !revealLoaded.practice);
  const startWhy = may.ok ? revealStartBlock(now) : null;
  return {
    mayCommand: may.ok, code: may.ok ? (pending ? 'loading' : null) : may.code,
    phoneCaughtUp: settled && !quiet, settled, quiet, startWhy,
    unscored, lastScoreAt: Number.isFinite(last) ? last : null,
    canStart: may.ok && !startWhy && settled && !quiet && !pending && !revealStarting,
  };
}

// ── camp day, finale ──────────────────────────────────────────────────
function revealDowOf(ms) {
  const p = etParts(ms);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}
function revealYmdOf(ms) {
  const p = etParts(ms);
  const two = (n) => (n < 10 ? '0' : '') + n;
  return p.year + '-' + two(p.month) + '-' + two(p.day);
}
// The crowning happens on the finale weekday (Friday unless the week says otherwise) and, when the week
// has a start date, only inside that week, so a rehearsal the Friday before camp is just a rehearsal.
function revealIsFinaleDay(ms) {
  if (revealDowOf(ms) !== finaleDow()) return false;
  const week = typeof campWeek === 'function' ? campWeek() : null;
  if (week && week.start) {
    const a = week.start.split('-').map(Number);
    const b = revealYmdOf(ms).split('-').map(Number);
    const gap = Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
    if (gap < 0 || gap > 6) return false;
  }
  return true;
}

// ── the freeze (Start) ────────────────────────────────────────────────
// Computed on the director's phone with the app's own code: medalCounts → rankTeamsByPoints →
// groupPlaces. A whole number each (the public shape takes nothing else), the team's name cut to 30
// characters rather than refused, never a point the app does not itself show a director.
function revealWhole(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0;
}

function revealFreezeRows() {
  const counts = medalCounts();
  return rankTeamsByPoints(counts).map((t) => {
    const c = counts[t.id] || {};
    return {
      id: String(t.id),
      nm: standingsTieName(t), // the Games tab's tie order uses the same name
      p: revealWhole(c.points, -9999, 99999),
      g: revealWhole(c.gold, 0, 99), s: revealWhole(c.silver, 0, 99), b: revealWhole(c.bronze, 0, 99),
      v: revealWhole(c.verse, -9999, 99999), m: revealWhole(c.meals, -9999, 99999), c: revealWhole(c.custom, -9999, 99999),
    };
  });
}

// Rows in rank order → the places in REVEAL order: [0] is the last place (the first one shown).
function revealFreezeGroups(rows) {
  return groupPlaces(rows).slice().reverse();
}

function revealFreeze(nowMs) {
  if (!standingsVisible()) return { ok: false, code: 'viewer' };
  const rows = revealFreezeRows();
  if (rows.length < 2 || rows.length > REVEAL_MAX_GROUPS || rows.some((r) => !REVEAL_TEAM_KEY_RE.test(r.id))) return { ok: false, code: 'teams' };
  const groups = revealFreezeGroups(rows);
  const last = Date.parse(state.meta && state.meta.lastDataChangeAt);
  return {
    ok: true, rows, groups, n: groups.length, teams: rows.length,
    // a device stamp may run ahead of the server's clock; the rules want it no later than server time
    lastScoreAt: Number.isFinite(last) ? Math.min(last, nowMs) : null,
  };
}

// One place as the database holds it: { place, e: { <teamId>: { nm, p, g, s, b, v, m, c } } }. `nameOf(id)`
// lets a place that is being SHOWN carry a team's name as it is now, while the numbers stay the frozen ones.
function revealGroupWire(group, nameOf) {
  const e = {};
  group.entries.forEach((en) => {
    const now = nameOf ? revealCleanName(nameOf(en.id)) : '';
    e[en.id] = { nm: now || en.nm, p: en.p, g: en.g, s: en.s, b: en.b, v: en.v, m: en.m, c: en.c };
  });
  return { place: group.place, e };
}

function revealCurrentName(id) {
  const t = state && state.teams ? state.teams.find((x) => x.id === id) : null;
  return t ? t.name : '';
}

function revealFullWire(freeze, o) {
  const g = {};
  freeze.groups.forEach((grp, i) => { g['g' + i] = revealGroupWire(grp); });
  const full = { r: o.id, n: freeze.n, frozenAt: o.ts, startedBy: o.me, g };
  if (freeze.lastScoreAt !== null) full.lastScoreAt = freeze.lastScoreAt;
  return full;
}

// ── the pure builders ─────────────────────────────────────────────────
// A Start: one root-level update, the ctl and `pub: null` (a Start leaves no earlier place behind, and
// the rules refuse one that does) at revealPublic/<mode>, and the private freeze at revealFull/<mode>.
// o = { mode, id, ts, nowMs, me, finale, epoch }
function revealBuildStart(freeze, o) {
  const practice = o.mode === 'practice';
  const until = untilFor(o.nowMs, practice);
  if (!Number.isFinite(until)) return { ok: false, code: 'clock' };
  const ctl = {
    v: REVEAL_SCHEMA, id: o.id, seq: 1, phase: 'intro', cur: -1, shown: 0, teams: freeze.teams, finale: !!o.finale,
    at: o.ts, sa: o.ts, ca: Math.round(o.nowMs), startedAt: o.ts, until,
  };
  if (typeof o.epoch === 'string' && REVEAL_EPOCH_RE.test(o.epoch)) ctl.epoch = o.epoch;
  const updates = {
    ['revealPublic/' + o.mode]: { ctl, pub: null },
    ['revealFull/' + o.mode]: revealFullWire(freeze, o),
  };
  return { ok: true, updates, ctl };
}

// What a command does to the ctl, as a pure function of the confirmed ctl and the freeze. `c` is the
// normalized ctl, `full` { n, groups } (null when not held). Returns { phase, cur, shown, publish?, endKind? }
// or { error }. This is the whole state machine of redesign §4.2.
function revealPlan(c, full, action) {
  const n = full ? full.n : 0;
  if (action === 'end') return c.phase === 'ended' ? { error: 'ended' } : { phase: 'ended', cur: c.cur, shown: c.shown, endKind: c.phase === 'table' ? 'done' : 'early' };
  if (c.phase === 'ended') return { error: 'ended' };
  if (action === 'next') {
    if (c.phase === 'table') return { error: 'table' };                      // "All places shown": the button is End the reveal
    if (c.phase === 'champion') return { phase: 'table', cur: c.cur, shown: c.shown };
    if (!full) return { error: 'no-full' };
    if (c.phase === 'intro') return n >= 1 ? { phase: 'live', cur: 0, shown: 1, publish: 0 } : { error: 'no-full' };
    const t = c.cur + 1;                                                     // live
    if (t < c.shown) return { phase: 'live', cur: t, shown: c.shown };       // showing one again after a Back: nothing new to publish
    if (t < n) return { phase: 'live', cur: t, shown: c.shown + 1, publish: t };
    return { phase: c.finale ? 'champion' : 'table', cur: c.cur, shown: c.shown };
  }
  if (action === 'back') {
    if (c.phase === 'intro') return { error: 'first' };
    if (c.phase === 'live') return c.cur <= 0 ? { error: 'first' } : { phase: 'live', cur: c.cur - 1, shown: c.shown };
    if (c.phase === 'champion') return { phase: 'live', cur: c.cur, shown: c.shown };
    if (c.phase === 'table') return { phase: c.finale ? 'champion' : 'live', cur: c.cur, shown: c.shown };
  }
  return { error: 'unknown' };
}

// Next / Back / End (and the crown, which is Next) on a node the server confirmed. `node` is the raw
// { ctl, pub }, `full` the freeze, o = { mode, ts, nameOf? }. The ctl is copied from the RAW confirmed value
// field by field (never from the normalized one: a clamped `until` written back would be refused), with
// seq + 1 and `at` now; `sa` moves only when a place is shown. A real End sets phase ended and DELETES
// nothing; a practice's End is the one delete (revealBuildEndPractice).
function revealBuildCommand(action, node, full, o) {
  const raw = node && node.ctl;
  const c = normalizeRevealCtl(raw);
  if (!c || c.until !== raw.until) return { ok: false, code: 'unreadable' };
  const held = full && full.r === c.id ? full : null;
  const plan = revealPlan(c, held, action);
  if (plan.error) return { ok: false, code: plan.error };
  const ctl = {
    v: raw.v, id: raw.id, seq: raw.seq + 1, phase: plan.phase, cur: plan.cur, shown: plan.shown, teams: raw.teams, finale: raw.finale === true,
    at: o.ts, sa: plan.shown > c.shown ? o.ts : raw.sa, ca: raw.ca, startedAt: raw.startedAt, until: raw.until,
  };
  if (typeof raw.epoch === 'string') ctl.epoch = raw.epoch;
  if (plan.phase === 'ended') { ctl.endedAt = o.ts; ctl.endKind = plan.endKind; }
  const updates = { ['revealPublic/' + o.mode + '/ctl']: ctl };
  if (plan.publish !== undefined) {
    const grp = held && held.groups.find((g) => g.idx === plan.publish);
    if (!grp) return { ok: false, code: 'no-full' };
    updates['revealPublic/' + o.mode + '/pub/g' + plan.publish] = revealGroupWire(grp, o.nameOf);
  }
  return { ok: true, updates, ctl, plan };
}

// A practice's End: both its nodes go at once, so its real standings leave the public node the moment
// the rehearsal ends. (A real reveal is never deleted by a command; only retireExpiredReveal, after until.)
function revealBuildEndPractice() {
  return { ok: true, updates: { 'revealPublic/practice': null, 'revealFull/practice': null } };
}

// ── what the remote shows ─────────────────────────────────────────────
// The button recharges after a command that puts a place on the big screen: name alone for 3 s, then
// the score until 4.5 s, measured from the command's own server time (`at`), so every remote agrees.
// Only a place (live) and the crowning hold it; the intro and the table have no beat to wait out.
function revealCharge(c, now) {
  if (!c) return { left: 0, total: 0, kind: null, secs: 0 };
  const total = c.phase === 'live' ? REVEAL_BEAT_BREAKDOWN_MS : c.phase === 'champion' ? REVEAL_CHAMPION_LOCK_MS : 0;
  const elapsed = Math.max(0, now - c.at);
  const left = Math.max(0, total - elapsed);
  if (!left) return { left: 0, total, kind: null, secs: 0 };
  if (c.phase === 'champion') return { left, total, kind: 'crown', secs: Math.ceil(left / 1000) };
  const inName = elapsed < REVEAL_BEAT_SCORE_MS;
  return { left, total, kind: inName ? 'name' : 'score', secs: Math.ceil(((inName ? REVEAL_BEAT_SCORE_MS : REVEAL_BEAT_BREAKDOWN_MS) - elapsed) / 1000) };
}

function revealPlaceWord(place, tie) { return ordinal(place) + ' place' + (tie ? ' (tie)' : ''); }

// What the big button will do next, from the confirmed ctl and the freeze (null freeze: the place is unknown).
function revealNextInfo(c, full) {
  if (!c || c.phase === 'ended') return { action: 'start' };
  if (c.phase === 'table') return { action: 'end' };
  if (c.phase === 'champion') return { action: 'table' };
  const n = full ? full.n : null;
  const t = c.phase === 'intro' ? 0 : c.cur + 1;
  const grp = full ? full.groups.find((g) => g.idx === t) : null;
  if (c.phase === 'live' && t >= c.shown && n !== null && t >= n) return { action: c.finale ? 'crown' : 'table' };
  return { action: c.phase === 'live' && t < c.shown ? 'replay' : 'reveal', idx: t, place: grp ? grp.place : null, tie: grp ? grp.entries.length > 1 : false };
}

// The place the Back button would show again, from the PUBLIC node (a shown place is public anyway).
function revealBackInfo(c, node) {
  if (!c || c.phase === 'ended') return { state: 'hidden' };
  const groups = normalizeRevealPub(node && node.pub);
  const placeAt = (idx) => { const g = groups.find((x) => x.idx === idx); return g ? g.place : null; };
  if (c.phase === 'intro') return { state: 'first', sub: 'nothing before' };
  if (c.phase === 'live') {
    if (c.cur <= 0) { const p = placeAt(0); return { state: 'first', sub: p ? 'Already at ' + ordinal(p) + ' place' : 'Already at the first place' }; }
    const p = placeAt(c.cur - 1);
    return { state: 'ready', sub: p ? 'show ' + ordinal(p) + ' again' : 'show the one before', place: p };
  }
  if (c.phase === 'champion') { const p = placeAt(c.cur); return { state: 'ready', sub: p ? 'show ' + ordinal(p) + ' again' : 'show 1st again', place: p }; }
  const p = placeAt(c.cur);                                                  // table
  return { state: 'ready', sub: c.finale ? 'champions' : (p ? 'show ' + ordinal(p) + ' again' : 'show 1st again'), place: p };
}

// Which child the remote is about: the real reveal while it is active (intro, live, champion or the
// table, and not yet 8 AM), else a running practice, else whatever the Practice switch says the next
// Start will be.
function revealRemoteMode() {
  const active = (m) => { const v = revealRemoteView(m); return !!(v && !v.expired && v.phase !== 'ended'); };
  if (active('real')) return 'real';
  if (active('practice')) return 'practice';
  return revealPracticeOn ? 'practice' : 'real';
}

function revealStageOf(mode, view, c) {
  if (revealDenied) return 'off';
  if (view && !view.expired && view.phase !== 'ended') return view.phase;
  if (mode === 'real' && c && !revealPracticeOn) {
    const rv = revealRemoteView('real');
    if (rv && !rv.expired) return 'ended';                                  // last night's reveal, over, still on counselor phones
  }
  return 'ready';
}

// The one object the remote paints from. Data, not markup: the stage (#takeover-reveal[data-phase]),
// the button's and Back's states and words, the recharge, who may press, and the Practice / Buzz / wake
// facts. Everything is derived from CONFIRMED state and the server clock at the moment it is asked.
function revealRemoteModel() {
  const mode = revealRemoteMode();
  const practice = mode === 'practice';
  const now = serverNow();
  const node = confirmedReveal[mode];
  const view = revealRemoteView(mode);
  const c = node ? normalizeRevealCtl(node.ctl) : null;
  const live = !!(c && view && !view.expired && view.phase !== 'ended');
  const cc = live ? c : null;
  const stage = revealStageOf(mode, view, c);
  const may = revealMayCommand();
  const full = revealFullFor(mode);
  const charge = cc ? revealCharge(cc, now) : { left: 0, total: 0, kind: null, secs: 0 };
  const online = !!fbConnected && !revealSlowAck();
  const next = revealNextInfo(stage === 'ended' ? null : cc, full);
  const back = revealBackInfo(cc, node);
  let backState = back.state;
  if (backState === 'ready' && charge.left > 0) backState = 'locked';
  if (!online && backState !== 'hidden') backState = 'offline';
  // Next from the intro or a place needs the private freeze (which place comes next, and whether it is the last)
  const needsFull = !!cc && (cc.phase === 'intro' || cc.phase === 'live');
  let goState = 'ready';
  if (!online) goState = 'offline';
  else if (!may.ok || !revealLoaded[mode] || (needsFull && !full)) goState = 'blocked';
  else if (charge.left > 0) goState = 'charging';
  // the words on the big button: [small line, big line]
  let kicker = '', big = '';
  if (next.action === 'start') {
    big = stage === 'ended' ? 'Start a new reveal' : practice ? 'Start a practice' : 'Start the reveal';
    kicker = stage === 'ended' ? 'Replaces tonight’s' : '';
  } else if (next.action === 'reveal' || next.action === 'replay') {
    kicker = next.action === 'reveal' ? 'Reveal' : 'Show again';
    big = next.place ? revealPlaceWord(next.place, next.tie) : 'Next place';
  } else if (next.action === 'crown') { kicker = (dayLabel(finaleDow()) || 'Finale') + ' finale'; big = 'Crown the champions'; }
  else if (next.action === 'table') { kicker = 'Next'; big = 'Show the final table'; }
  else if (next.action === 'end') { kicker = 'All places shown'; big = 'End the reveal'; }
  if (goState === 'charging') {
    kicker = charge.kind === 'name' ? 'Showing the name… ' + charge.secs : charge.kind === 'score' ? 'Showing the score… ' + charge.secs : 'Crowning… ' + charge.secs;
    big = next.action === 'crown' ? 'Champions next' : next.action === 'table' ? 'Final table next' : next.action === 'end' ? 'End the reveal' : next.place ? revealPlaceWord(next.place, next.tie) + ' next' : 'Next place';
  } else if (goState === 'offline') {
    // Disconnected: nothing is sent. Connected but slow to answer: the last tap is already with the SDK and may
    // still land (revealSend's note), so the line must not promise it won't.
    kicker = 'Reconnecting…';
    big = fbConnected ? 'Your last tap may still arrive' : 'Your taps would not reach the big screen';
  }
  const startedAt = c ? c.startedAt : null;
  return {
    mode, practice, stage, loading: !revealLoaded[mode],
    why: revealDenied ? 'rules' : may.ok ? null : may.code,
    mayCommand: may.ok, online, view, ctl: cc, startedAt, until: c ? c.until : null,
    // when it ended: the End's own stamp, else (an auto-ended one) when its last command went stale
    endedAt: stage === 'ended' && c ? (c.endedAt || c.at + (c.phase === 'champion' || c.phase === 'table' ? REVEAL_AUTO_END_SHORT_MS : REVEAL_AUTO_END_LONG_MS)) : null,
    count: cc ? { shown: view.rows.reduce((n, r) => n + r.entries.length, 0), total: cc.teams } : null,
    next, back: { state: backState, sub: backState === 'locked' ? 'after the score' : back.sub || '', place: back.place || null },
    go: { state: goState, kicker, big, face: next.action === 'crown' ? 'crown' : null, action: next.action },
    charge, full: !!full,
    freezeStale: !!(cc && cc.phase === 'intro' && revealFreezeStale(mode)),
    buzz: revealBuzzState(mode), wake: revealWakeHeld() ? 'on' : 'off',
  };
}

// While a reveal is still at its intro the director may have saved a score: the freeze is no longer
// tonight's standings. Compared on the numbers (a rename is not a score).
function revealFreezeSig(groups) {
  return JSON.stringify(groups.map((g) => [g.place, g.entries.map((e) => [e.id, e.p, e.g, e.s, e.b, e.v, e.m, e.c])]));
}
function revealFreezeStale(mode) {
  const full = revealFullFor(mode);
  if (!full || !standingsVisible()) return false;
  const now = revealFreeze(serverNow());
  return !!(now.ok && revealFreezeSig(now.groups) !== revealFreezeSig(full.groups.slice().sort((a, b) => a.idx - b.idx)));
}

// ── fetching the private freeze ───────────────────────────────────────
// revealFull is fetched, not listened to (no long-lived editor-only listener, so the terminal-read rule
// can't bite and a counselor promoted mid-camp gets the up-next preview the first time they open the
// remote): once() when the remote opens and after each acknowledged command. In memory only.
function revealNormalizeFull(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = typeof raw.r === 'string' && REVEAL_ID_RE.test(raw.r) ? raw.r : null;
  const n = revealInt(raw.n, 1, REVEAL_MAX_GROUPS);
  const groups = normalizeRevealPub(raw.g);
  if (!r || n === null || groups.length !== n || groups.some((g, i) => g.idx !== i)) return null; // a half-readable freeze is never used
  // `by` is the director's own member key (editor-only data): the remote names the director in "Started by Jenn
  // at 7:31" and never writes or shows the raw key.
  const by = typeof raw.startedBy === 'string' && raw.startedBy.length <= 160 ? raw.startedBy : '';
  return { r, n, groups, by };
}

function revealFetchFull(mode) {
  if (revealFullFetching[mode]) return revealFullFetching[mode];
  if (memberRole !== 'editor' || !revealStarted || !revealSdkReady()) return Promise.resolve(revealFullStore[mode]);
  revealFullTried[mode] = confirmedReveal[mode] && confirmedReveal[mode].ctl ? confirmedReveal[mode].ctl.id : '';
  const read = firebase.database().ref(dbPath('revealFull/' + mode)).once('value').then((snap) => {
    revealFullFetching[mode] = null;
    if (memberRole !== 'editor') return null;                  // demoted while it was in flight
    revealFullStore[mode] = revealNormalizeFull(snap && snap.val());
    if (typeof revealPaint === 'function') revealPaint('full', mode);
    return revealFullStore[mode];
  }).catch(() => { revealFullFetching[mode] = null; return null; });
  revealFullFetching[mode] = read;
  return read;
}

// After every evaluation: keep the wake lock honest, and keep the private freeze in step with the reveal
// the server holds (another director's new Start brings a new one).
function revealAfterEvaluate() {
  revealSyncWake();
  if (!revealRemoteOpenFlag || memberRole !== 'editor') return;
  ['real', 'practice'].forEach((m) => {
    const node = confirmedReveal[m];
    if (node && node.ctl && !revealFullFor(m) && !revealInFlight[m] && revealFullTried[m] !== node.ctl.id) revealFetchFull(m);
  });
}

// The remote came up (or went away): a director's remote fetches the private order with once(); closing it
// drops the in-memory copy (nothing from revealFull outlives the remote) and lets the screen sleep again.
function revealSetRemoteOpen(open) {
  open = !!open;
  if (open === revealRemoteOpenFlag) return;
  revealRemoteOpenFlag = open;
  if (open) {
    revealFetchFull('real');
    revealFetchFull('practice');
    revealRescan();
  } else {
    revealForgetFull('real');
    revealForgetFull('practice');
  }
  revealSyncWake();
}
function revealRemoteOpen() { return revealRemoteOpenFlag; }
function revealSetPractice(on) { revealPracticeOn = !!on; }
function revealPracticeSwitch() { return revealPracticeOn; }
function revealSetBuzz(on) { revealBuzzOn = !!on; }

// ── the screen stays on ───────────────────────────────────────────────
// While a director's remote is open, or a real reveal is live on a director's phone (even with the remote
// closed), the screen is held awake through app.js's wake lock: wakeLockNeeded() asks this, and a lock the
// OS drops when the page hides is taken back on return (rearmWakeLock). A refused lock shows as
// `wake: 'off'` ("Screen may sleep") so the director knows to tap it awake between speeches.
function revealWakeNeeded() {
  if (!(memberRole === 'editor' && memberRoleConfirmed)) return false;
  if (revealRemoteOpenFlag) return true;
  const v = revealRemoteView('real');
  return !!(v && v.live);
}

function revealSyncWake() {
  if (typeof requestWakeLock !== 'function') return;
  if (revealWakeNeeded()) {
    if (!wakeLockWanted) requestWakeLock();
    else if (!wakeLockSentinel) acquireWakeLock();
  } else if (wakeLockWanted && !wakeLockNeeded()) {
    releaseWakeLock();
  }
}
function revealWakeHeld() { return !!(typeof wakeLockSentinel !== 'undefined' && wakeLockSentinel); }
function revealOnWakeChange() { if (typeof revealPaint === 'function') revealPaint('wake', null); }
function revealOnRoleChanged() { if (memberRole !== 'editor') revealRemoteOpenFlag = false; revealSyncWake(); }

// The auto-update must not reload a director's phone mid-reveal: true for any director while a
// non-practice reveal is live (not only with the remote open), and while any command is unacknowledged.
function revealBusy() {
  if (memberRole !== 'editor') return false;
  if (revealInFlight.real > 0 || revealInFlight.practice > 0 || revealRetiring) return true;
  const v = revealRemoteView('real');
  return !!(v && v.live);
}

// ── Buzz on a real Start ──────────────────────────────────────────────
// Calls everyone to the big screen through the director-alert path (push.js), only for a REAL start
// and only once phone alerts are live (PUSH_SERVICE_URL set: Step 27). Until then it is disabled with its
// reason. A practice has NO path to pushSendAlert: it is greyed with its own sentence.
function revealBuzzState(mode) {
  if (mode === 'practice') return { available: false, on: false, forced: true, reason: 'Practice runs never buzz phones.' };
  const live = typeof pushConfigured === 'function' && pushConfigured();
  return { available: live, on: live && revealBuzzOn, forced: false, reason: live ? '' : 'Phone alerts are not switched on yet.' };
}

function revealBuzzAfterStart(mode) {
  if (mode !== 'real') return Promise.resolve(null);          // a practice never buzzes
  if (!revealBuzzState('real').on || typeof pushSendAlert !== 'function') return Promise.resolve(null);
  return Promise.resolve(pushSendAlert({ text: REVEAL_BUZZ_TEXT, audience: 'all', urgent: false })).catch(() => null);
}

// ── sending ───────────────────────────────────────────────────────────
function revealRootRef() { return firebase.database().ref(CAMP.dbRoot); }
function revealTs() { return firebase.database.ServerValue.TIMESTAMP; }
function revealSay(text, quiet) { if (!quiet && text && typeof showToast === 'function') showToast(text); }
function revealIsDenied(e) {
  return !!e && (e.code === 'PERMISSION_DENIED' || /permission[_ ]denied/i.test(String(e.message || e)));
}

// Re-read one child after a command settles and take it as confirmed: the ONLY way this phone's own write
// becomes the state its screens show. Resolves { read, denied }.
function revealReread(mode) {
  return firebase.database().ref(dbPath('revealPublic/' + mode)).once('value').then((snap) => {
    revealAccept(mode, snap.val(), 'reread');
    return { read: true, denied: false };
  }, (e) => ({ read: false, denied: revealIsDenied(e) }));
}

// Hand one update to the server and settle. In flight is counted for the duration (so the SDK's optimistic
// echo is not taken as confirmed and an auto-update cannot reload the phone), then the node is re-read.
// WHAT GUARDS A STALE TAP: the app refuses a command while `.info/connected` is false, and the rules' `seq`
// compare-and-set refuses a second one that raced it. Only a Start also carries a freshness window (`ca`).
// RECORDED LIMIT, accepted: a Next, Back or End tapped in the seconds before a half-dead socket is noticed
// (`.info/connected` still true) sits in the SDK's own offline queue and is applied on reconnect if `seq` is
// still current; `sa` / `at` take the SERVER's time at delivery, so the big screen can show that place late,
// even minutes after the tap. revealSlowAck() flips the dock to "Reconnecting…" after 12 s and keeps it
// locked (the command still counts in flight) but cannot cancel the queued write, and the rules cannot be
// tightened in this step. What it can never do is skip or invent a place: `seq` and `shown` only move by one.
function revealSend(mode, updates) {
  revealInFlight[mode] += 1;
  revealInFlightSince[mode] = Date.now();
  let sent;
  try { sent = Promise.resolve(revealRootRef().update(updates)); } catch (e) { sent = Promise.reject(e); }
  return sent.then(() => ({ ok: true }), (err) => ({ ok: false, err })).then((res) => {
    revealInFlight[mode] = Math.max(0, revealInFlight[mode] - 1);
    if (!revealInFlight[mode]) revealInFlightSince[mode] = 0;
    return revealReread(mode).then((rr) => Object.assign(res, rr));
  });
}

function revealPublicGroups(mode) {
  const node = confirmedReveal[mode];
  return normalizeRevealPub(node && node.pub);
}

// The one sentence for a command the server refused: rules not published, or another director got there first.
function revealExplainRefusal(mode, before, rr, quiet) {
  if (rr.denied) { revealDenied = true; revealSay(revealWhyWords('rules'), quiet); return { code: 'rules' }; }
  const node = confirmedReveal[mode];
  const after = node ? normalizeRevealCtl(node.ctl) : null;
  if (after && before && after.id === before.id && after.shown > before.shown) {
    const g = revealPublicGroups(mode).find((x) => x.idx === after.shown - 1);
    revealSay(g ? 'Another director already showed ' + ordinal(g.place) + ' place.' : 'Another director already showed the next place.', quiet);
  } else if (!after || (before && after.id !== before.id)) {
    revealSay('Another director started a new reveal. This remote now follows it.', quiet);
  } else {
    revealSay('Another director moved the reveal on. This remote is up to date.', quiet);
  }
  return { code: 'refused' };
}

function revealRefuse(code, message, quiet, extra) {
  if (message) revealSay(message, quiet);
  return Object.assign({ ok: false, code, message: message || '' }, extra || {});
}

// ── the commands ──────────────────────────────────────────────────────
// Next, Back and End all come through here. Returns a promise of { ok, code?, message? }; a refusal on the
// client (too soon, offline, no freeze) sends nothing, and one from the server re-reads and follows it.
async function revealRun(action, opts) {
  const o = opts || {};
  const quiet = !!o.quiet;
  const mode = o.mode || revealRemoteMode();
  const may = revealMayCommand();
  if (!may.ok) return revealRefuse(may.code, revealWhyWords(may.code), quiet);
  if (!revealLoaded[mode]) return revealRefuse('loading', '', quiet);
  if (!fbConnected) return revealRefuse('offline', 'Your taps would not reach the big screen.', quiet);
  if (revealInFlight[mode] > 0) return revealRefuse('busy', '', quiet);
  const node = confirmedReveal[mode];
  const c = node ? normalizeRevealCtl(node.ctl) : null;
  if (!c) return revealRefuse('none', '', quiet);
  if (mode === 'practice' && action === 'end') {
    const built = revealBuildEndPractice();
    const res = await revealSend(mode, built.updates);
    revealForgetFull(mode);
    return res.ok ? { ok: true } : revealRefuse('failed', 'Couldn’t reach the server. Try again.', quiet);
  }
  const now = serverNow();
  if (action !== 'end') {
    const charge = revealCharge(c, now);
    if (charge.left > 0) {
      const g = revealPublicGroups(mode).find((x) => x.idx === c.cur);
      const onScreen = c.phase === 'champion' ? 'the champions' : g ? ordinal(g.place) + ' place' : 'the last place';
      return revealRefuse('wait', 'Wait ' + Math.ceil(charge.left / 1000) + ' s. The big screen is still showing ' + onScreen + '.', quiet, { left: charge.left });
    }
  }
  let full = revealFullFor(mode);
  if (!full && action === 'next' && (c.phase === 'intro' || c.phase === 'live')) {
    await revealFetchFull(mode);
    full = revealFullFor(mode);
    if (!full) return revealRefuse('no-full', 'Couldn’t load the places for this reveal. Check your connection and try again.', quiet);
  }
  const built = revealBuildCommand(action, node, full, { mode, ts: revealTs(), nameOf: revealCurrentName });
  if (!built.ok) return revealRefuse(built.code, '', quiet);
  const res = await revealSend(mode, built.updates);
  if (res.ok) {
    revealFetchFull(mode);                                       // fetched again after each acknowledged command
    return { ok: true, ctl: built.ctl };
  }
  if (revealIsDenied(res.err)) {
    const why = revealExplainRefusal(mode, c, res, quiet);
    return { ok: false, code: why.code };
  }
  return revealRefuse('failed', 'Couldn’t reach the big screen. Try again.', quiet);
}

function revealNext(opts) { return revealRun('next', opts); }
function revealBack(opts) { return revealRun('back', opts); }
function revealEnd(opts) { return revealRun('end', opts); }

function revealNewId(nowMs) {
  const stamp = Math.floor(nowMs).toString(36).slice(-9).padStart(6, '0');
  const tail = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return 'r' + stamp + '-' + tail;
}

// Start (or Start again, or Start a new reveal: the caller confirmed what needs confirming). `practice`
// writes the practice child from the same real freeze and never touches `real`.
async function revealStart(opts) {
  const o = opts || {};
  const quiet = !!o.quiet;
  const mode = o.practice ? 'practice' : 'real';
  const gate = revealStartGate();
  if (!gate.mayCommand) return revealRefuse(gate.code, revealWhyWords(gate.code), quiet);
  if (revealStarting || revealInFlight[mode] > 0) return revealRefuse('busy', '', quiet);
  if (gate.code === 'loading') return revealRefuse('loading', '', quiet);
  if (!fbConnected) return revealRefuse('offline', 'Your taps would not reach the big screen.', quiet);
  if (!gate.phoneCaughtUp) return revealRefuse('not-ready', 'Waiting for this phone to catch up…', quiet);
  const me = identityKey(authUser);
  if (!me) return revealRefuse('no-identity', revealWhyWords('no-identity'), quiet);
  const nowMs = serverNow();
  const block = revealStartBlock(nowMs);
  if (block) return revealRefuse(block, revealWhyWords(block), quiet);
  const freeze = revealFreeze(nowMs);
  if (!freeze.ok) return revealRefuse(freeze.code, revealWhyWords(freeze.code), quiet);
  const id = revealNewId(nowMs);
  const built = revealBuildStart(freeze, { mode, id, ts: revealTs(), nowMs, me, finale: revealIsFinaleDay(nowMs), epoch: revealEpoch() });
  if (!built.ok) return revealRefuse(built.code, revealWhyWords(built.code), quiet);
  revealStarting = true;
  try {
    const res = await revealSend(mode, built.updates);
    if (!res.ok) {
      if (revealIsDenied(res.err)) {
        // the rules refused a Start: either they are not published, or the `ca` window / a clause said no
        if (res.denied) { revealDenied = true; return revealRefuse('rules', revealWhyWords('rules'), quiet); }
        return revealRefuse('refused', 'That Start didn’t reach the server. Start again?', quiet);
      }
      return revealRefuse('failed', 'Couldn’t reach the server. Try again.', quiet);
    }
    // this phone wrote the freeze: it already holds the complete order (the up-next preview), no read needed
    revealFullStore[mode] = revealNormalizeFull(built.updates['revealFull/' + mode]);
    revealFullTried[mode] = id;
    revealAfterEvaluate();
    // calling everyone to the big screen must not hold the Start button's own answer: `buzz` is a promise
    return { ok: true, id, mode, buzz: revealBuzzAfterStart(mode) };
  } finally { revealStarting = false; }
}

revealLoadCache();
