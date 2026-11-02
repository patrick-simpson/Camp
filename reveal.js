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
function revealViewRole() { return memberRole === 'editor' ? 'editor' : 'viewer'; }

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
  return f(revealMirrorView()) + '/' + (memberRole === 'editor' ? f(revealRemoteView('practice')) : '-');
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

// What the rest of the file's commands half needs before it exists: nothing is held yet.
function revealFullHeld() { return null; }
function revealForgetFull() { /* the commands half keeps the director's up-next copy */ }

revealLoadCache();
