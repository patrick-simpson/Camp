// ── Camp Scoreboard ─────────────────────────────────────────────
// The week's games, day by day. Three formats:
//  - tournament: 2 teams at a time, 3 first-round matches, winners go
//    to the medal round. The bye goes to whichever winner is lowest in
//    the OVERALL standings coming into today — the app asks you, since
//    the official scoreboard lives on paper.
//  - tally: every team posts a score; top 3 auto-earn medals.
//  - placement: no numbers, you just pick who took gold/silver/bronze.

// jelly-motion.js is a classic script loaded just before this one. If it is
// missing or fails (a deploy typo, an unbumped ?v=, a stale cached index.html)
// app.js used to throw at load and the whole app was dead; chat.js and push.js
// guard their hooks the same way. This is the smallest stand-in that keeps every
// call site working: nothing moves, nothing is calm, the Calm motion switch just
// reads Auto. Keys are the real literals (clearLocalData wipes them).
if (typeof JellyMotion === 'undefined') {
  globalThis.JellyMotion = {
    pref: () => 'auto', setPref: () => false, busySource: () => {}, ring: () => null, press: () => null, release: () => null,
    keys: { pref: 'campScoreboardCalmMotion', last: 'campScoreboardCalmLast' },
  };
  globalThis.calmMotion = () => false;
  globalThis.calmReason = () => null;
}

const STORAGE_KEY = lsKey('campScoreboardV2'); // per-camp; junior stays the bare literal (suffix '')

// Bump this to the current UTC timestamp (`date -u +%Y-%m-%dT%H:%M:%SZ`)
// every time a code asset (app.js, settings.js, defaults.js, styles.css,
// index.html) changes and gets deployed — it drives the "Code last
// updated" line in the footer. There's no build step here to stamp this
// automatically, so it's a manual step alongside the ?v=N cache-bust
// bump in index.html (six assets share the number — see CLAUDE.md).
const CODE_UPDATED_AT = '2026-11-07T11:26:03Z';
// Shown in the footer; bump together with the ?v= cache-busters in index.html.
const APP_VERSION = 210;

// "What's new" banners. Each entry advertises a user-visible change at the top
// of the page for TWO HOURS after its `at` time, then auto-expires. Every time
// you ship something worth telling people about, add an entry here (newest
// first) — same manual discipline as bumping CODE_UPDATED_AT and the ?v=
// cache-bust. `at` is UTC ISO (`date -u +%Y-%m-%dT%H:%M:%SZ`); `id` is a stable
// slug so a viewer's dismissal sticks; `text` is the short announcement.
// Multiple recent changes stack as separate banners, each expiring on its own
// two-hour clock. Old entries can be pruned once they're well past two hours.
// "What's new" banners are discontinued — leave this list EMPTY and do not add
// entries going forward (owner's call, 2026-07-21). With it empty, activeChanges()
// returns nothing and no banner ever renders. The queue machinery below is left
// dormant but harmless.
const CHANGES = [];

// ── Sign-in & roles (Firebase Authentication) ────────────────────
// The old 4-digit PIN gate is gone (2026-07-25). It only ever locked the
// PAGE — the database itself answered to anyone on the internet, which was
// verified live before this change. Access is now real: everyone signs in
// (Google, or an emailed link), and the database's own security rules only
// answer to emails listed at campScoreboard/members. The client code below
// shapes the UI; the RULES are the security boundary — nothing here can
// grant data access that the server doesn't independently verify.
//
// Roles, decided by the member record (never by anything on the device):
//   'viewer' — counselors. Can watch everything, can change nothing.
//              (Deliberate: counselors must not bump their own team's points.)
//   'editor' — directors / game leaders. Edit scores AND manage the member
//              list (More → Who can sign in).
//
// THE ONE INVARIANT (see also CLAUDE.md → "Auth, members & roles"):
// no database ref may attach until sign-in resolves AND the self-read of
// campScoreboard/members/<emailKey> confirms approval — the state listener's
// error callback treats a cancelled read as terminal (see initSync), so an
// early attach under locked rules would kill sync for the whole session.
// startSync() is therefore called only from the approved branch below.
//
// AUTH_HINT_KEY caches the last confirmed role so a returning, approved
// device paints the app instantly from local state (exactly the pre-auth
// behavior) while sign-in re-confirms in the background. It is convenience
// only: forging it shows an empty shell — the rules still refuse all data.
const AUTH_HINT_KEY = 'campScoreboardAuthHint'; // 'viewer' | 'editor' (same literal in index.html's pre-paint guard)
const EMAIL_SIGNIN_KEY = 'campScoreboardEmailForSignIn'; // email-link flow parks the address here
// An EXPLICIT Light/Dark choice, mirrored out of state.theme by applyTheme() so
// boot-guard.js can paint it pre-paint (same literal there). Auto = key absent.
// Device-wide, not per camp: the guard runs before camps.js, and boot()'s
// applyTheme corrects a camp whose own choice differs. Wiped by clearLocalData.
const THEME_HINT_KEY = 'campScoreboardTheme'; // 'light' | 'dark'

let authUser = null;       // firebase.auth() user, once signed in
let memberRole = null;     // 'viewer' | 'editor' | null (not resolved / not approved)
// Preview as a counselor (redesign §7.4, Step 24): a director's phone shown the app the way a counselor's phone
// renders it. MEMORY ONLY (never in state, never in storage, never the role or the auth hint: a reload is always
// the director's own view) and declared up here beside memberRole because canEdit() reads it at load time.
// See "Preview as a counselor" below for the lens (viewRole, directorTab, canEdit, standingsVisible, isOwner).
let counselorPreviewOn = false;
// True only once the member record itself has answered for this role. A role
// painted from a device-stored hint (boot) is provisional: it can paint the
// shell, but standingsVisible() waits for the answer (see setMemberRole).
let memberRoleConfirmed = false;
let memberName = null;     // display name from the member record, if set
let memberTeamId = null;   // 't0'…'t5' — the team this person is ON, if assigned
let authTornDown = false;  // sign-in was lost mid-session; recovery is a reload

// The whole member list, kept live once sync attaches (members can read the
// list — it's the staff directory). Null until it first loads; readers must
// fall back to the hand-typed counselor text until then.
let memberDirectory = null;
// Whether a directory snapshot has ever actually ARRIVED. `memberDirectory`
// alone can't tell "not loaded yet / read failed" from "loaded and empty", and
// chat's author-name resolution has to fail CLOSED: with no directory it shows
// the rules-validated identity rather than the name the sender's device typed.
let memberDirectoryLoaded = false;

// The single write-path for the role — and the test seam: tests call this
// directly instead of faking a Firebase sign-in (see tests/auth.test.js).
// `opts.provisional` marks a role painted from a device-stored hint (boot). A
// hint is a convenience, not proof: it can be stale (a demoted director's phone)
// or set by hand, and the cached week it would unlock holds results a counselor
// must not see. So a provisional role paints the shell but does NOT make
// standingsVisible() true; the member record's answer does (no opts = confirmed).
function setMemberRole(role, opts) {
  const next = role === 'editor' || role === 'viewer' ? role : null;
  const confirmed = next !== null && !(opts && opts.provisional);
  const changed = memberRole !== next || memberRoleConfirmed !== confirmed;
  // A device that stops being an editor keeps no undo history: it could not use it,
  // and the next person to sign in on it must not find the last director's changes.
  if (memberRole === 'editor' && next !== 'editor') undoClear();
  // A counselor preview belongs to a CONFIRMED director: anything else (demoted, removed, not yet answered) ends it
  // here, before the role moves, so no render in between draws a half-previewed screen.
  if (counselorPreviewOn && !(next === 'editor' && confirmed)) previewEnd();
  if (typeof setupOnRoleChange === 'function') setupOnRoleChange(memberRole, next);
  memberRole = next;
  memberRoleConfirmed = confirmed;
  // The standings reveal listens to the practice child as a director only (reveal.js).
  if (changed && typeof revealOnRoleChange === 'function') revealOnRoleChange();
  // The writer election starts the moment a role is KNOWN — the hinted role at
  // boot included, before auth confirms it — so no cache write or push can run
  // ahead of it. A null role (not resolved / kicked) leaves the tab as it is.
  if (next === 'editor') startTabElection();
  else if (next === 'viewer') tabBecomeViewer();
  // A device promoted during a session seeds the old-build keys now, not at its
  // next data change (ensureSecrecySeed still needs a synced first pull). Only a
  // confirmed director seeds: a hint-painted device must not write on a guess.
  if (next === 'editor' && confirmed && changed) ensureSecrecySeed();
  if (appStarted && changed) {
    applyRoleClass();
    updateAccountRow();
    renderAll();
  }
}

// The other half of the test seam: which team this account belongs to. Set
// from the member record; drives both the auto-followed team and the
// own-team scoring guard below.
function setMemberTeam(teamId) {
  const next = isTeamId(teamId) ? teamId : null;
  const changed = memberTeamId !== next;
  memberTeamId = next;
  if (appStarted && changed) {
    adoptMemberTeam();
    renderAll();
  }
}

function isTeamId(id) {
  return typeof id === 'string' && /^t\d+$/.test(id);
}

// ── Two tabs of one camp: ONE writer (setup-rebuild-spec §6.9) ────────────────
// STORAGE_KEY holds this device's unconfirmed edits and the confirmed baseline
// they are measured against (_syncBase). Two tabs of the same camp each keep their
// own in-memory copy and each used to write the WHOLE cache, so the later write
// erased the other tab's unsent edits and rewound its baseline. An EDITOR tab now
// takes a Web Lock ('camp-writer:<camp>') BEFORE it persists anything:
//   tabWriter === null    undecided: nothing is written to the cache and pushes wait
//                         (queued, not dropped: the diff is kept, so they go out the
//                         moment the tab is decided)
//   tabWriter === true    this tab owns the cache. Viewers are writers by default —
//                         they have no unconfirmed edits to protect, so they never lock
//   tabWriter === false   another tab owns it: this one is VIEW-ONLY. canEdit() is
//                         false (every existing write gate holds) and the cache is
//                         never written; a bar offers "Use this tab instead"
// Every cache write goes through persistState() (a test scans the source for any
// other setItem on the key), and every read of "may this tab write" goes through
// tabWriter — declared up here because the load-time migrate (a cached week
// upgraded while app.js is still evaluating) already calls persistState().
// A device whose stored hint says EDITOR starts undecided at load, before boot()
// has even set the role, so that migrate cannot write ahead of the election; every
// other tab (a viewer, or a device with no hint — nothing cached worth protecting)
// is a writer from the start, and startTabElection() undecides it if it turns out
// to be an editor after all.
function tabHintedEditor() {
  try {
    let h = null;
    try { const c = JSON.parse(localStorage.getItem('campScoreboardCampsHint') || '{}'); h = c && c[CAMP.id]; } catch (e) { h = null; }
    if (h !== 'editor' && h !== 'viewer') h = localStorage.getItem(AUTH_HINT_KEY); // boot()'s order: per-camp ledger, else the single hint
    return h === 'editor';
  } catch (e) { return false; }
}
// (the literal above is CAMPS_HINT_KEY, which is declared far below: a TDZ read here)
let tabWriter = tabHintedEditor() ? null : true;
let tabElectionOn = false;  // an editor election has run (or is running) for this role stint
let tabElectionRun = 0;     // bumped when the role leaves 'editor', so a late retry stands down
let tabLockRelease = null;  // resolves the lock promise we hold (a viewer flip frees the lock)
let tabChannel = null;      // BroadcastChannel fallback (no Web Locks), else null
let tabClaimPending = false; // fallback: we asked the writer to let go and will reload
let tabFlushing = false;    // a demoted tab is sending what it had queued
let tabHeldState = false;   // a state push was asked for while undecided
let tabHeldConfig = false;  // a config push was asked for while undecided
let tabHeldSetup = false;   // a setup push was asked for while undecided (setup-sync.js)
let persistOwed = false;    // a cache write was asked for while undecided
const TAB_RETRY_MS = 250;
const TAB_RETRY_MAX = 6;    // 6 x 250 ms: a reloading page can still hold the lock for a moment
const TAB_HELLO_MS = 300;   // fallback: how long a new tab waits for a writer's answer
const TAB_ANSWER_MS = 4000; // a lock request whose callback never runs fails open after this long
const TAB_ID = Math.random().toString(36).slice(2);

function tabReadOnly() {
  return tabWriter === false;
}

// The ONE question every screen and every action asks: may this phone act as a director right now? False in a
// counselor preview (see "Preview as a counselor"), so every gate that already says "directors only" holds there
// with no second list to keep.
function canEdit() {
  return directorTab() && !counselorPreviewOn;
}

// The same test without the preview: "this tab IS a director's writer tab". Only the ENGINES that protect or send
// work that already exists ask it — merging a snapshot over unconfirmed edits, pushing them, re-sending a refused
// batch, holding a reload while something is unsent, naming it at sign-out. A preview changes what the screen
// shows and what a tap may do; it must never make the engines treat this phone as a viewer, because a viewer's
// rules are "adopt the server's copy", which would drop a director's unconfirmed week. Code that CREATES a write
// or offers a director's control asks canEdit() and so pauses while a preview is up.
function directorTab() {
  return memberRole === 'editor' && tabWriter !== false;
}

// The role the SCREEN is drawn for: a counselor's while a preview is up, else the member record's. For what the
// person may SEE (which sections show, which words, which reveal view). Never for what they may DO (canEdit) and
// never for the sign-in's own bookkeeping (memberRole: the hint, the listeners, the writer election).
function viewRole() {
  return counselorPreviewOn ? 'viewer' : memberRole;
}

// The ONE writer of the cache. A no-op unless this tab owns it; while undecided
// the write is owed and made the moment the tab is decided a writer.
function persistState() {
  if (tabWriter !== true) {
    if (tabWriter === null) persistOwed = true;
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    // Private mode / quota exceeded: cloud + in-memory state still work, and the
    // previous consistent cache stays. Never let a failed write kill the caller.
    console.warn('localStorage write failed (private mode or quota?)', e);
    return false;
  }
}

function tabLocksApi() {
  try {
    const l = navigator.locks;
    return l && typeof l.request === 'function' ? l : null;
  } catch (e) { return null; }
}

function tabLockName() {
  return 'camp-writer:' + CAMP.id;
}

// What a change of writer means to the screen: canEdit() just flipped.
function tabRepaint() {
  if (!appStarted) return;
  applyRoleClass();
  updateAccountRow();
  updateSyncIndicator(); // the view-only bar lives in the sync-alert strip
  renderAll();
}

function decideTabWriter(writer) {
  if (tabWriter === writer) return;
  const wasReadOnly = tabWriter === false;
  tabWriter = writer;
  if (writer) {
    // Undecided no more: make the cache write and the pushes that were waiting.
    if (persistOwed) { persistOwed = false; persistState(); }
    if (tabHeldState) { tabHeldState = false; schedulePush(); }
    if (tabHeldConfig) { tabHeldConfig = false; schedulePushConfig(); }
    if (tabHeldSetup) { tabHeldSetup = false; if (typeof pushSetup === 'function') pushSetup(); }
    if (typeof setupOnTabDecided === 'function') setupOnTabDecided(true);
  } else {
    // Another tab owns the cache. Persistence is already off (tabWriter is
    // false); send what this tab had queued — an edit typed in the first second
    // is the person's — then show the bar. The cache write owed is the other
    // tab's business now.
    persistOwed = false;
    if (typeof setupOnTabDecided === 'function') setupOnTabDecided(false);
    flushTabPushes();
  }
  if (wasReadOnly !== (writer === false)) tabRepaint(); // only a flip of canEdit() needs a repaint
}

// A tab that stops being the writer still SENDS what it had queued (the database
// is shared; only the cache is not). pushState/pushConfig refuse a read-only tab
// except inside this call.
function flushTabPushes() {
  tabFlushing = true;
  try {
    flushPendingPush();
    if (tabHeldState) { tabHeldState = false; pushState(); }
    if (tabHeldConfig) { tabHeldConfig = false; pushConfig(); }
    if (tabHeldSetup) { tabHeldSetup = false; if (typeof pushSetup === 'function') pushSetup(); }
  } finally { tabFlushing = false; }
}

// pushState / pushConfig ask this first. Undecided tabs hold (and remember that
// they did); a read-only tab has no edits of its own to send.
function tabMayPush(kind) {
  // The new-year setup's commit is in flight (setup-sync.js "The new-year wizard"): all three engines hold their pushes
  // until it has been acknowledged and the server's new year adopted, so nothing of last year's is diffed against it.
  // Held like an undecided tab's push (the flags are paid by wizardReleaseHolds). typeof: setup-sync.js loads after this file.
  if (typeof wizardHoldsPushes === 'function' && wizardHoldsPushes()) {
    if (kind === 'config') tabHeldConfig = true; else if (kind === 'setup') tabHeldSetup = true; else tabHeldState = true;
    return false;
  }
  if (tabWriter === null) {
    if (kind === 'config') tabHeldConfig = true; else if (kind === 'setup') tabHeldSetup = true; else tabHeldState = true;
    return false;
  }
  return tabWriter === true || tabFlushing;
}

// Called when the role becomes 'editor' (setMemberRole, including the hinted role
// painted at boot — before auth confirms it). Idempotent for the stint.
function startTabElection() {
  if (tabElectionOn) return;
  tabElectionOn = true;
  const run = ++tabElectionRun;
  tabWriter = null; // a promoted viewer waits for the lock too
  const locks = tabLocksApi();
  if (!locks) { tabFailOpen(run, null); return; }
  let retries = 0;
  let gaveUp = false; // the watchdog already failed this election open
  let watchdog = null;
  const attempt = () => {
    if (run !== tabElectionRun) return; // the role changed under the retry
    // Throw, rejection and a missing API all fail open below, but a request whose
    // callback NEVER runs would leave tabWriter null for good: the cache is never
    // written, pushes hold forever and editorMidEntry blocks every reload — with
    // no error shown. Each ask gets a deadline; failing open costs nothing here.
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      watchdog = null;
      if (run !== tabElectionRun || tabWriter !== null) return;
      gaveUp = true;
      tabFailOpen(run, new Error('Web Locks did not answer'));
    }, TAB_ANSWER_MS);
    let req;
    try {
      req = locks.request(tabLockName(), { ifAvailable: true }, (lock) => {
        clearTimeout(watchdog); watchdog = null; // answered (a held lock or a "no"): the retry loop owns the clock now
        if (run !== tabElectionRun || gaveUp) return undefined; // stood down (or failed open) meanwhile: let the lock go
        if (!lock) {
          // Another tab holds it — or a page that is reloading still does for a
          // moment (doReload / bfcache). Ask again before concluding.
          if (retries < TAB_RETRY_MAX) { retries += 1; setTimeout(attempt, TAB_RETRY_MS); } else decideTabWriter(false);
          return undefined;
        }
        // Held until this page unloads: the promise never settles by itself.
        const held = new Promise((resolve) => { tabLockRelease = resolve; });
        decideTabWriter(true);
        return held;
      });
    } catch (e) { clearTimeout(watchdog); watchdog = null; tabFailOpen(run, e); return; }
    if (req && typeof req.catch === 'function') req.catch((e) => { clearTimeout(watchdog); watchdog = null; onTabLockRejected(run, e); });
  };
  attempt();
}

// The held lock's promise rejects with AbortError when another tab STEALS it
// ("Use this tab instead"). Anything else is the API misbehaving: fail open.
function onTabLockRejected(run, e) {
  if (run !== tabElectionRun) return;
  if (e && e.name === 'AbortError') {
    tabLockRelease = null;
    decideTabWriter(false); // sets tabWriter = false FIRST, then flushes, then the bar
  } else tabFailOpen(run, e);
}

// Web Locks missing or throwing: write as before (a tab that cannot be told apart
// must not be locked out of its own camp), and where BroadcastChannel exists let
// the tabs find each other with a hello / claim.
function tabFailOpen(run, e) {
  if (e) console.warn('Web Locks unavailable, writing without a lock', e);
  let ch = null;
  try { if (typeof BroadcastChannel === 'function') ch = new BroadcastChannel('camp-tabs:' + CAMP.id); } catch (err) { ch = null; }
  if (!ch) { decideTabWriter(true); return; }
  tabChannel = ch;
  let answered = false;
  ch.onmessage = (ev) => {
    const m = ev && ev.data;
    if (!m || m.id === TAB_ID || run !== tabElectionRun) return;
    // A writer answers a newcomer; a claim from another tab turns a writer read-only.
    if (m.t === 'hello' && tabWriter === true) ch.postMessage({ t: 'here', id: TAB_ID, to: m.id });
    else if (m.t === 'here' && m.to === TAB_ID && tabWriter === null) { answered = true; decideTabWriter(false); }
    else if (m.t === 'claim' && tabWriter === true) { decideTabWriter(false); ch.postMessage({ t: 'released', id: TAB_ID, to: m.id }); }
    else if (m.t === 'released' && m.to === TAB_ID && tabClaimPending) { tabClaimPending = false; doReload(); }
  };
  try { ch.postMessage({ t: 'hello', id: TAB_ID }); } catch (err) { /* the timer below decides */ }
  setTimeout(() => { if (!answered && run === tabElectionRun && tabWriter === null) decideTabWriter(true); }, TAB_HELLO_MS);
}

// "Use this tab instead": steal the lock. The old tab's lock promise rejects and
// it stops persisting before it flushes; this tab then reloads to re-adopt from
// the cache the old tab last wrote as a writer and from the server — its own
// copy is older than both, so it must never be the one that writes next.
function claimWriterTab() {
  if (!tabReadOnly()) return;
  // Offline, the reload below fails into the browser's error page (no service-worker
  // fetch handler, and doReload's unique ?r= defeats the HTTP cache) — and the lock
  // is stolen by then, so BOTH tabs would be unusable. Say so before stealing.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { showToast('Needs a connection to switch tabs. Try again when you are back online.'); return; }
  if (reloadBlocked() && !confirm('You have something unfinished here (an unsent message, a score being typed, or a running timer). Switch tabs anyway?')) return;
  if (tabChannel) {
    tabClaimPending = true;
    try { tabChannel.postMessage({ t: 'claim', id: TAB_ID }); } catch (e) { /* the timer below reloads anyway */ }
    setTimeout(() => { if (tabClaimPending) { tabClaimPending = false; doReload(); } }, 1500);
    return;
  }
  const locks = tabLocksApi();
  if (!locks) { doReload(); return; }
  try {
    locks.request(tabLockName(), { steal: true }, () => {
      doReload();
      return new Promise((resolve) => { tabLockRelease = resolve; });
    }).catch(() => { /* stolen back by yet another tab: that one reloads, and so does this page */ });
  } catch (e) { doReload(); }
}

// Viewers never lock (nothing unconfirmed to protect): an editor hint that turns
// out to be a viewer record lets go of the lock and stops being read-only.
function tabBecomeViewer() {
  tabElectionOn = false;
  tabElectionRun += 1;
  if (tabLockRelease) { const r = tabLockRelease; tabLockRelease = null; r(); }
  if (tabChannel) { try { tabChannel.close(); } catch (e) { /* fine */ } tabChannel = null; }
  decideTabWriter(true);
}

// The view-only bar's copy (the sync-alert strip; see updateSyncAlert).
function tabBarHtml() {
  return '<span class="sync-alert-text">View-only: another tab is editing.</span>' +
    '<button type="button" class="link-btn sync-quarantine-btn" data-tab-claim="1">Use this tab instead</button>';
}

// ── Standings secrecy ─────────────────────────────────────────────
// The owner's rule (2026-10-27): counselors see NO points, places, gaps or
// standings anywhere in the app except what a director has revealed. Only the
// medal WINNERS of a finished game stay visible (they are read straight from
// state.results and never go through a points reader). Directors see
// everything, always.
//
// Enforced where points are PRODUCED, not just where they are drawn: every
// points reader starts with pointsReadAllowed(), so a render path somebody adds
// later (or forgets) that reaches a reader as a viewer gets zeros / an empty
// list instead of the truth. Under test the guard THROWS for a viewer
// (setStandingsGuardThrows), so a viewer render that reaches one fails loudly
// instead of quietly showing zeros. Gating is in code paths, never CSS:
// html.view-only leaves every node in the DOM.
//
// standingsVisible() is the ONE place that says who may see standings. Today
// that is "a director whose role the MEMBER RECORD has confirmed": canEdit() is
// not enough, because the first frame can paint a director from the device hint
// before any answer arrives. A hint-painted (provisional) role, a role that has
// not resolved (null), and an unreachable database are all NOT a director: fail
// closed. The shell may still paint as a director; the numbers wait.
// A counselor preview (counselorPreviewOn) joins it here: while one is up this says no.
let standingsGuardThrows = false; // test seam only, off in the browser
function setStandingsGuardThrows(on) { standingsGuardThrows = !!on; }

function standingsVisible() {
  // The member record's role, not canEdit(): a director's SECOND tab is view-only
  // (see tabWriter) but the person is still a director and still sees standings.
  // A counselor preview is the one exception: it shows what a counselor sees, which is no points and no places.
  return memberRole === 'editor' && memberRoleConfirmed && !counselorPreviewOn;
}

function pointsReadAllowed(reader) {
  if (standingsVisible()) return true;
  if (standingsGuardThrows) throw new Error('standings read by a non-director: ' + reader);
  return false;
}

// ── The own-team guard ────────────────────────────────────────────
// Staff assigned to a team (their member record's teamId) are editors
// everywhere EXCEPT the specific rounds their own team is playing or
// earning in: they can run the rest of the game normally — call up other
// matchups, record other teams' scores, finalize the result — but the one
// round with their own team in it is read-only for them, and another editor
// records it.
//
// Deliberately ONE function, so both loosening and tightening this are a
// one-line change: `return canEdit()` opens everything up; adding
// `if (memberTeamId) return false` closes every game to assigned staff.
// It is a fairness affordance, not a security boundary — the database rules
// gate on `role` alone and cannot see which round a write belongs to.
function canScoreRound(...teamIds) {
  if (!canEdit()) return false;
  if (!memberTeamId) return true; // nobody assigned a team is guarded
  return !teamIds.some((id) => id === memberTeamId);
}

// True when the guard above is what's blocking this round (as opposed to
// simply not being an editor) — the cue to explain rather than hide.
function blockedByOwnTeam(...teamIds) {
  return canEdit() && !canScoreRound(...teamIds);
}

// The standard explanation, shown wherever the guard takes controls away.
function ownTeamNoteHTML(what) {
  const mark = typeof bracketMarkHtml === 'function' ? bracketMarkHtml(memberTeamId, 20) : teamEmoji(memberTeamId);
  return `<p class="own-team-note"><svg class="ico" aria-hidden="true"><use href="#i-lock"/></svg><span>You're on ${mark} <strong>${esc(teamName(memberTeamId))}</strong>, so ${esc(what)} is read-only for you. Another director records it.</span></p>`;
}

// The member list is keyed by a person's SIGN-IN IDENTITY: their email (for
// Google / email-link) or their phone number (for phone sign-in). Two shapes:
//
//  - emailKey: lowercased email with EVERY dot turned into a comma. RTDB
//    forbids '.' in keys, and this must mirror the security rules'
//    `.replace('.', ',')`, which in the rules language replaces ALL
//    occurrences — hence replaceAll here, never JS .replace (which would only
//    catch the first dot and silently lock out any multi-dot address, the
//    owner's own included).
//  - phoneKey: the E.164 number (e.g. +15551234567). Phone numbers have no
//    dots to escape, and '+' is a legal RTDB key char, so the number IS the
//    key. This must match what Firebase reports as auth.token.phone_number,
//    which is always E.164 — so we normalize typed input the same way.
function emailKey(email) {
  return String(email || '').trim().toLowerCase().replaceAll('.', ',');
}

// Normalize a phone number to E.164 (+<countrycode><digits>) so a number an
// editor TYPES into the member list matches the one Firebase reports when that
// person signs in. Defaults to US (+1) when no country code is given — this is
// a US camp. Returns '' if there aren't enough digits to be a real number.
function phoneKey(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const hadPlus = s[0] === '+';
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7) return ''; // too short to be a real phone number
  if (hadPlus) return '+' + digits;                 // they typed a full +… number
  if (digits.length === 10) return '+1' + digits;   // bare US 10-digit
  if (digits.length === 11 && digits[0] === '1') return '+' + digits; // US with the 1
  return '+' + digits;                               // best effort: assume it's complete
}

// The member-list key for a signed-in user — email first, else phone.
function identityKey(user) {
  if (!user) return '';
  if (user.email) return emailKey(user.email);
  if (user.phoneNumber) return phoneKey(user.phoneNumber);
  return '';
}

// The human-readable identity for a signed-in user (for the account row, the
// not-approved screen, changelog attribution).
function identityLabel(user) {
  if (!user) return '';
  return user.email || user.phoneNumber || '';
}

// A stored member key back to something displayable: a phone key (+…) shows
// as-is; an email key turns its commas back into dots (lossless — real emails
// never contain commas).
function identityFromKey(key) {
  const k = String(key || '');
  return k[0] === '+' ? k : k.replaceAll(',', '.');
}

// The owner's member key, the lockout anchor. The security rules refuse EVERY
// write to this key in both camps' member lists (`$memberKey != '…'`), so the
// Members drawer must not offer controls that can only fail: its row shows
// "Owner · only the owner can change this row" and nothing else, for the owner
// themselves and for every other editor. The same literal is in
// database.rules.json (tests/owner-row.test.js pins that they agree). Any bulk
// member write must skip this key and be per-row and best-effort, never folded
// into a larger atomic update — one refused row would take the rest with it.
const OWNER_MEMBER_KEY = 'patricksimpson,fx@gmail,com';

// ── The owner (decision Q8) ─────────────────────────────────────────────────
// The two big switches — Edit the week here (and the sections after it), the
// new-year setup and Undo the new-year setup — are the OWNER's alone. The rules
// enforce it (OWNER / OWNERKEEP on every leaf that carries one); this is the
// client half, so a director who is NOT the owner is never offered a button that
// can only fail, and a non-owner call path is refused before anything is written.
//   isOwner()   from the SIGN-IN, never anything stored on the device: the
//               identity firebase.auth() reports, an editor whose member record
//               has answered, and a verified address (the rules' `email_verified`;
//               a phone identity never matches the owner's email key).
//   ownerName() the owner's first name as the member directory spells it (the
//               owner row is rules-immutable, so an editor cannot rename it into
//               something misleading), else "the owner". Fails CLOSED like
//               chatAuthorName: no directory yet, no name on the row => the
//               plain word, never a guess.
//   ownerGate(what) / requireOwner(what)   the refusal, as data and as a toast:
//               "Only Patrick can turn on editing." — said BEFORE any write.
//   ownerSays(rest)  "Patrick turns on editing." / "The owner turns on editing."
//               — the sentence every other director sees in place of the button.
function isOwner() {
  if (!authUser || memberRole !== 'editor' || !memberRoleConfirmed || counselorPreviewOn) return false;
  if (authUser.emailVerified === false) return false;
  return identityKey(authUser) === OWNER_MEMBER_KEY;
}

function ownerName() {
  const rec = memberDirectoryLoaded && memberDirectory && Object.prototype.hasOwnProperty.call(memberDirectory, OWNER_MEMBER_KEY)
    ? memberDirectory[OWNER_MEMBER_KEY] : null;
  const first = rec && typeof rec.name === 'string' ? rec.name.trim().split(/\s+/)[0] : '';
  return first ? first.slice(0, 30) : 'the owner';
}

function ownerGate(what) {
  if (isOwner()) return { ok: true, reason: '' };
  return { ok: false, reason: 'Only ' + ownerName() + ' can ' + String(what || 'do that') + '.' };
}

function requireOwner(what) {
  const gate = ownerGate(what);
  if (!gate.ok && typeof showToast === 'function') showToast(gate.reason);
  return gate.ok;
}

function ownerSays(rest) {
  const name = ownerName();
  return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + String(rest || '') + '.';
}

// body.setup-owner is what styles.css reads to show the owner-only buttons (the
// markup also starts them `hidden`, and the rules refuse the writes anyway).
function applyOwnerClass() {
  document.body.classList.toggle('setup-owner', isOwner());
}

// A member row for someone who has no sign-in yet — a counselor we know by
// name and team, whose email or phone gets filled in later. The key must be
// something `identityKey()` can NEVER produce, or a stranger could inherit
// the row: no '@' (email keys always have one) and no leading '+' (phone
// keys always do). The random tail keeps two people with the same name apart.
function pendingKey(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 24) || 'staff';
  return 'pending-' + slug + '-' + Math.random().toString(36).slice(2, 7);
}

// A member key is about to be concatenated into a database path, so it has to
// be a legal RTDB key first. `.`/`#`/`$`/`[`/`]`/`/` are illegal there and make
// ref() THROW — which, from the members drawer, surfaces as a button that does
// nothing. The email regex upstream allows `#` and `$` in the local part, and
// emailKey() only rewrites dots, so this is the check that actually holds.
function isValidMemberKey(key) {
  const k = String(key || '');
  if (!k || k.length > 200 || /[.#$[\]/\x00-\x1f\x7f]/.test(k)) return false;
  return k.includes('@') || k.startsWith('+') || isPendingKey(k);
}

function isPendingKey(key) {
  // Exclusive, not a bare prefix: match only what pendingKey() can actually
  // emit. A real identity is an email or a phone, so someone whose address
  // begins "pending-" (pending-team@…) would otherwise be rendered as a
  // placeholder row and offered the convert-to-real-key flow.
  const k = String(key || '');
  return k.startsWith('pending-') && !k.includes('@') && !k.startsWith('+');
}

// Shape of one campScoreboard/members entry. `name` and `teamId` are omitted
// (not null) when empty — RTDB drops nulls, and the rules validate each as a
// string when present.
function memberRecord(role, name, teamId) {
  const rec = {
    role: role === 'editor' ? 'editor' : 'viewer',
    addedBy: identityLabel(authUser) || 'unknown',
    addedAt: new Date().toISOString(),
  };
  if (name && String(name).trim()) rec.name = String(name).trim();
  if (isTeamId(teamId)) rec.teamId = teamId;
  return rec;
}

// Everyone in the member directory who is assigned to a team, by display
// name (falling back to their sign-in identity when they have no name yet).
// Empty until the directory loads — callers fall back to team.counselor.
function teamStaffNames(teamId) {
  if (!memberDirectory || !isTeamId(teamId)) return [];
  return Object.keys(memberDirectory)
    .filter((k) => memberDirectory[k] && memberDirectory[k].teamId === teamId)
    .map((k) => String(memberDirectory[k].name || identityFromKey(k)))
    .sort((a, b) => a.localeCompare(b));
}

// ── SEAM: week data accessors ─────────────────────────────────────
// The ONLY code that reads the week's own data: the printed schedule, meals,
// electives, memory verses, the cleanup rota, team branding and the game
// catalog. Every renderer, the chat mention dictionary and the alert publisher
// ask an accessor below instead of the camps.js constant, so where the data
// comes from can change in ONE place (the setup rebuild adds a shared copy
// that a director edits in the app; the accessors will pick it up). Rules of
// the layer (setup-rebuild-spec §9.1), pinned by tests/seam.test.js and
// tests/accessors.test.js:
//   - While a section is off, an accessor returns the camps.js constant ITSELF
//     (same object), so this layer is provably a no-op. The schedule's switch
//     (setup/meta/on/schedule, the owner's Edit the week here) moves the
//     schedule accessors onto the shared copy, and each of meals, verses, cleanup
//     and electives (setup/meta/on/<section>, step 19) moves its own accessors;
//     a team's own branding (short, emoji, color, photoV: optional fields of
//     state.teams, step 25) has no switch: each field falls back to the camp's
//     own constant while the team record doesn't carry it.
//   - They return plain data, never markup, and never throw on missing data
//     (a missing day is a shared frozen empty list, a missing verse an empty
//     one). Never mutate what one returns.
//   - Text from the database passes a camp-core.js sanitizer on its way out.
// The per-camp constants moved here unchanged from their old spots in this
// file (tests/camps.test.js still reads them by global name). Not yet
// accessors, because nothing reads them yet: hubStatus.
// (finaleDow arrived with the standings reveal, Step 23; teamAccentVars with
// the palette, Step 25. `campersFor` is NOT an accessor of this block: camper
// names are minors' data held in memory by setup-sync.js's CAMPERS section for a
// director with a camper-showing screen open, and nothing else may read them.)

const DEFAULT_TEAM_NAMES = CAMP.defaultTeamNames;
const TEAM_EMOJI = CAMP.teamEmoji;
const TEAM_SHIELD = CAMP.teamCrest;
const TEAM_ACCENT = CAMP.teamAccent;
// Short-form team names for tight spaces — per-camp (camps.js).
const TEAM_ABBREV = CAMP.teamAbbrev;
// Name/counselor migration lists for older saved rosters — per-camp;
// empty for senior, so senior teams are never auto-renamed.
const OLD_PLACEHOLDER_TEAM_NAMES = CAMP.oldPlaceholderTeamNames;
const DEFAULT_COUNSELORS = CAMP.defaultCounselors;
const OLD_PLACEHOLDER_COUNSELORS = CAMP.oldPlaceholderCounselors;

const DAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };

// The full printed week, per camp (camps.js): every block of every day,
// minutes-since-midnight in camp time. (hm() also lives in camps.js now.)
const DAY_SCHEDULE = CAMP.daySchedule;
const SCHED_DAYS = CAMP.schedDays; // per-camp day list + tags (camps.js)

// Electives — junior-only (CAMP.features.electives). The active profile
// supplies who's at which station (junior: the handwritten packet;
// senior: empty — no electives at senior camp, so these all no-op).
const STATION_EMOJI = CAMP.stationEmoji;
const ELECTIVES = CAMP.electives;
// Device-identity → team, keyed to the ELECTIVES spellings (junior).
// Empty for senior — identities come from member records instead.
const TEAM_COUNSELORS = CAMP.teamCounselors;
const ELECTIVE_SLOT_MIN = CAMP.electiveSlotMin;

// What the kitchen is serving — per-camp data (camps.js), keyed by
// day-of-week (0 Sun .. 6 Sat) then lowercase meal block name. When a
// meal is listed, the Happening Now banner names the dish during that
// block. Unknown meals just show the plain block label, so an empty or
// sparse menu (senior, for now) is always safe.
const MEALS = CAMP.meals;
// The meal-cleanup rota itself is per-camp data (camps.js) — junior's printed
// 6-team rota, senior's still-empty one (every meal TBA until filled in).
const MEAL_CLEANUP_SCHEDULE = CAMP.mealCleanupSchedule;
// The three meals the rota tracks, in order, and their icons. These live in the
// block because legacyMealOf() reads MEAL_CLEANUP_MEALS: a top-level const
// declared further down the file would be a TDZ error for any load-time caller
// (normalizeSyncedState / migrateState run while this file is still evaluating).
const MEAL_CLEANUP_MEALS = ['Breakfast', 'Lunch', 'Supper'];
const MEAL_ICONS = { Breakfast: '🍳', Lunch: '🥪', Supper: '🍲' };
// Start time of each meal (same across Mon–Fri, per the junior weekday schedule) —
// lets findNextCleanupFor skip a meal that's already started today.
const MEAL_START_MINUTES = { Breakfast: hm(8, 0), Lunch: hm(12, 0), Supper: hm(17, 0) };

// The week's theme verse + one memory verse per camp day (Mon–Fri) —
// per-camp data (camps.js): junior's printed "Harvest of the Heart"
// sheet, senior's placeholders until its sheet exists.
const MEMORY_VERSE_THEME = CAMP.memoryVerseTheme;
const MEMORY_VERSES = CAMP.memoryVerses;

// The weekdays that carry competition, Mon–Fri: what the verse and cleanup
// day chips and the cleanup lookahead loop over.
const COMPETITION_DOWS = Object.freeze([1, 2, 3, 4, 5]);
// One shared frozen empty list, so "nothing there" costs no allocation and
// nobody can scribble on it; and the verse a missing day reads as.
const NO_ITEMS = Object.freeze([]);
const NO_VERSE = Object.freeze({ text: '', ref: '', video: null });
const NO_THEME = Object.freeze({ title: '', text: '', ref: '' });

// ── Schedule
// Is this camp's schedule edited in the app (setup/meta/on/schedule is true, in a schema this build reads)? setup-sync.js
// answers; with its <script> tag gone, or the switch off, every schedule accessor is the camps.js constant itself.
function scheduleIsShared() { return typeof setupScheduleLive === 'function' && setupScheduleLive(); }
// A weekday 0–6 from a number or a one-digit string, else -1 (junk reads as an empty day, never a throw).
function weekdayIndex(dow) {
  const n = typeof dow === 'string' && /^[0-6]$/.test(dow) ? Number(dow) : dow;
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : -1;
}
// One day's blocks, [{ start, end, label, emoji, type?, slot?, noTime? }] — the printed shape, whichever copy it
// comes from; the same array object until the shared tree changes.
function scheduleForDow(dow) {
  if (scheduleIsShared()) { const d = weekdayIndex(dow); return d < 0 ? NO_ITEMS : setupLegacyDay(d); }
  return DAY_SCHEDULE[dow] || NO_ITEMS;
}
// One day's blocks with everything the schedule screen, the alert publisher and the calendar file need:
// [{ id, dk, start, end, label (rendered), base (the label as stored), emoji, type, slot?, meal?, noTime?, teams?,
// alertKey, origin: typical|changed|oneoff|own, overlapOk?, ord }], plus `.skipped` and `.broken` lists. While the
// schedule is built-in it is the printed week resolved the same way, so a preview has real block ids.
function planForDow(dow) {
  const d = weekdayIndex(dow);
  if (d < 0 || typeof setupPlanOf !== 'function') return NO_ITEMS;
  return setupPlanOf(d, scheduleIsShared());
}
// The whole week, { 0..6: blocks }.
function scheduleWeek() { return scheduleIsShared() ? setupLegacyWeek() : DAY_SCHEDULE; }
// The schedule sheet's day list, indexed by weekday: [{ dow, short, full, tag }].
function weekDays() { return scheduleIsShared() ? setupWeekDays() : SCHED_DAYS; }
// The camp week: { start: 'YYYY-MM-DD' (the Sunday) | null, phase: 'unset' | 'before' | 'during' | 'after' }. The date is
// setup/meta/weekStart — always read, even with every section off — else the one phone alerts were set up with;
// 'during' is the day before the Sunday through the day after the Saturday, the window the freeze (A1, the new-year
// wizard) refuses inside.
function campWeek() {
  let start = typeof setupWeekStart === 'function' ? setupWeekStart() : null;
  if (!start && typeof pushKnownWeekStart === 'function') start = pushKnownWeekStart();
  if (!start) return { start: null, phase: 'unset' };
  const t = campDateStr().split('-').map(Number);
  const s = start.split('-').map(Number);
  const gap = Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(s[0], s[1] - 1, s[2])) / 86400000);
  return { start, phase: gap < -1 ? 'before' : gap <= 7 ? 'during' : 'after' };
}
function dayLabel(dow) { return DAY_NAMES[dow] || ''; }
// The weekdays that carry competition, and the editable competition days
// (state.config.days — the authority for which days have games).
function competitionDows() { return COMPETITION_DOWS; }
function competitionDays() { return (state.config && state.config.days) || NO_ITEMS; }
function dayById(id) { return competitionDays().find((d) => d.id === id); }

// ── Games
function allGames() { return (state.config && state.config.games) || NO_ITEMS; }
function gameById(id) { return allGames().find((g) => g.id === id); }
// Games listed under a competition-day id (config.days[].id), not a weekday.
function gamesForDayId(dayId) { return allGames().filter((g) => g.dayId === dayId); }
// Games under one schedule block of weekday `dow`. While the schedule is the built-in copy the blocks carry no id,
// so this is the long-standing rule: a games block holds that weekday's Morning games if it starts before noon,
// else its Evening ones (editable competition days are matched to the weekday by their dow). Once the schedule is
// edited here it is the link a game carries: games whose `blockId` is this block (any kind of block can hold games),
// in `ord` order, ties by position in the catalog. The block must be one an accessor returned.
function gamesForBlock(dow, block) {
  if (!block) return NO_ITEMS;
  const rich = scheduleIsShared() && typeof setupRichOf === 'function' ? setupRichOf(block) : null;
  if (rich) {
    const dayIds = competitionDays().filter((d) => d.dow === dow).map((d) => d.id);
    return allGames()
      .map((g, i) => ({ g, i }))
      .filter((x) => x.g.blockId === rich.id && dayIds.includes(x.g.dayId))
      .sort((a, b) => ((Number.isFinite(a.g.ord) ? a.g.ord : 1e9) - (Number.isFinite(b.g.ord) ? b.g.ord : 1e9)) || (a.i - b.i))
      .map((x) => x.g);
  }
  if (block.type !== 'games') return NO_ITEMS;
  const session = block.start < 720 ? 'Morning' : 'Evening';
  const dayIds = competitionDays().filter((d) => d.dow === dow).map((d) => d.id);
  return allGames().filter((g) => dayIds.includes(g.dayId) && g.session === session);
}
// A weekday's blocks that hold games, in schedule order: [{ block, games }].
function gamesForDay(dow) {
  return scheduleForDow(dow).map((block) => ({ block, games: gamesForBlock(dow, block) })).filter((x) => x.games.length);
}
// The games on this weekday's competition days that sit on NO block of it — a game with no schedule item, or one
// whose item was removed or skipped for the day (or, while the schedule is built-in, one the Morning/Evening rule
// doesn't reach: senior's Afternoon games).
function unscheduledGames(dow) {
  const dayIds = competitionDays().filter((d) => d.dow === dow).map((d) => d.id);
  const listed = new Set();
  gamesForDay(dow).forEach((x) => x.games.forEach((g) => listed.add(g)));
  return allGames().filter((g) => dayIds.includes(g.dayId) && !listed.has(g));
}

// ── Meals and cleanup
// The meal a block represents (Breakfast/Lunch/Supper), or null. Handles
// decorated labels like "Supper — Shepherd's Pie".
function legacyMealOf(label) {
  const base = String(label || '').split(' — ')[0].trim();
  return MEAL_CLEANUP_MEALS.includes(base) ? base : null;
}
// Is this section (meals, verses, cleanup, electives) edited here — its switch on, in a schema this build reads? Off, or
// without setup-sync.js, every accessor below is the camps.js constant itself.
function sectionIsShared(section) { return typeof setupSectionLive === 'function' && setupSectionLive(section); }
// The meal a block represents ('Breakfast' | 'Lunch' | 'Supper'), or null. Built in it is read off the label (legacyMealOf);
// once the schedule is edited here it is the item's own Meal tag, so a "Supper and free time" item tagged Supper is a meal.
function blockMeal(b) {
  const rich = scheduleIsShared() && typeof setupRichOf === 'function' ? setupRichOf(b) : null;
  if (rich) return rich.meal ? (MEAL_CLEANUP_MEALS.find((m) => m.toLowerCase() === rich.meal) || null) : null;
  return legacyMealOf(b && b.label);
}
// The menu entry { dish, emoji } for a lowercase meal block name, or null.
function mealFor(dow, meal) {
  if (sectionIsShared('meals')) { const d = weekdayIndex(dow); return d < 0 || typeof setupMealFor !== 'function' ? null : setupMealFor(d, meal); }
  const day = MEALS[dow];
  return (day && day[meal]) || null;
}
// When a meal starts on a weekday: built in, the same for every day; once the schedule is edited here, the start of that
// day's item tagged with the meal (else the usual).
function mealStart(dow, meal) {
  if (scheduleIsShared()) {
    const hit = planForDow(dow).find((b) => b.meal === String(meal).toLowerCase() && !b.noTime);
    if (hit) return hit.start;
  }
  return MEAL_START_MINUTES[meal];
}
// Is this weekday on the cleanup rota at all? (A tracked day with an unassigned
// meal reads "TBA"; an untracked day says nothing.) Edited here: a day with a team on any meal.
function cleanupOnRota(dow) {
  if (sectionIsShared('cleanup')) { const d = weekdayIndex(dow); return d >= 0 && typeof setupCleanupOnRota === 'function' && setupCleanupOnRota(d); }
  return !!MEAL_CLEANUP_SCHEDULE[dow];
}
// Team ids on cleanup for a day + meal, always an array ([] = TBA).
function cleanupTeams(dow, meal) {
  if (sectionIsShared('cleanup')) { const d = weekdayIndex(dow); return d < 0 || typeof setupCleanupFor !== 'function' ? NO_ITEMS : (setupCleanupFor(d, meal) || NO_ITEMS); }
  const day = MEAL_CLEANUP_SCHEDULE[dow];
  const assigned = day && day[meal];
  return assigned ? (Array.isArray(assigned) ? assigned : [assigned]) : NO_ITEMS;
}

// ── Block kind (redesign §3.1): what a schedule block IS, for the Now card. An explicit field where the data has one
// (`type`: games / elective; the Meal tag, through blockMeal), else today's label rules; arrival and send-off come from
// the weekday. The head of a label is what is before " — " (the tail is a note or a list of people). Constants live in
// the block (a load-time caller must never hit a TDZ read). A renderer that wants the kind asks here, never the label.
const KIND_BIBLE_RE = /\bbible study\b/;
const KIND_MEETING_RE = /^(rising bell|wake up)\b/;
const KIND_BED_RE = /\b(lights out|prepare for bed|devotions?|devotional)\b/;
const KIND_WORSHIP_RE = /\b(service|worship)\b/;
const KIND_PREP_RE = /^(prepare|prep|cool down)\b/; // "Prepare for worship service" is preparing, not worshipping
function kindHead(label) { return String(label == null ? '' : label).split(' — ')[0].trim().toLowerCase(); }
// Does this block's head read as worship (a service or a worship time that is not a "Prepare for …" block)?
function kindIsWorship(b) {
  if (!b || b.type === 'games' || b.type === 'elective') return false;
  const head = kindHead(b.label);
  return KIND_WORSHIP_RE.test(head) && !KIND_PREP_RE.test(head);
}
// 'games' | 'elective' | 'meal' | 'bible' | 'meeting' | 'worship' | 'bedtime' | 'arrival' | 'sendoff' | 'activity'.
// `b` is a block an accessor returned (either shape), `dow` its weekday: Saturday's blocks are the send-off, and
// Sunday's, up to the first worship block (all of it when there is none), are the arrival.
function blockKind(b, dow) {
  if (!b || typeof b !== 'object') return 'activity';
  if (b.type === 'games') return 'games';
  if (b.type === 'elective') return CAMP.features.electives ? 'elective' : 'activity';
  if (blockMeal(b)) return 'meal';
  const head = kindHead(b.label);
  if (KIND_BIBLE_RE.test(head)) return 'bible';
  if (KIND_MEETING_RE.test(head)) return 'meeting';
  if (KIND_BED_RE.test(head)) return 'bedtime';
  if (kindIsWorship(b)) return 'worship';
  const d = weekdayIndex(dow);
  if (d === 6) return 'sendoff';
  if (d === 0) {
    const worship = scheduleForDow(0).find(kindIsWorship);
    if (!worship || b.start < worship.start) return 'arrival';
  }
  return b.noTime ? 'bedtime' : 'activity';
}

// The teams a block is FOR (the morning meeting's group of teams, a team's own item): ids in the camp's order, [] when it is for
// everyone. Built in, the printed label's team tail is the seed's `teams` set (the built-in plan carries it); edited here, it is the
// item's own `teams`.
function blockTeams(b, dow) {
  if (!b || typeof b !== 'object') return NO_ITEMS;
  let rich = scheduleIsShared() && typeof setupRichOf === 'function' ? setupRichOf(b) : null;
  if (!rich) rich = planForDow(dow).find((p) => p.start === b.start && p.end === b.end && p.label === b.label) || null;
  return rich && rich.teams ? teamIds().filter((id) => rich.teams[id]) : NO_ITEMS;
}

// ── Alerts: the stable key a block is subscribed by, and its published id.
// (pushBlockKey lives in push.js, which loads later and may be absent.) A block the shared schedule handed out carries
// its own: the key it was seeded with (today's, and never recomputed on a rename) and the id `<dk>-<block id>`, which
// stays put when the block is moved or renamed.
function blockKey(b) {
  const rich = scheduleIsShared() && typeof setupRichOf === 'function' ? setupRichOf(b) : null;
  if (rich) return rich.alertKey;
  return typeof pushBlockKey === 'function' ? pushBlockKey(b && b.label) : '';
}
// The start is read as a number, the same way the publisher validates it, so a
// padded or string start can never yield an id the validation didn't accept.
function blockPushId(b, dow, i) {
  const rich = scheduleIsShared() && typeof setupRichOf === 'function' ? setupRichOf(b) : null;
  if (rich) return rich.dk + '-' + rich.id;
  return 'd' + dow + '-' + Number(b.start) + '-' + i;
}

// ── Memory verses
// Edited here, no theme verse reads as an empty one (the card then leaves the theme out).
function verseTheme() {
  if (sectionIsShared('verses') && typeof setupVerseThemeNow === 'function') return setupVerseThemeNow() || NO_THEME;
  return MEMORY_VERSE_THEME;
}
function verseFor(dow) {
  if (sectionIsShared('verses') && typeof setupVerseFor === 'function') { const d = weekdayIndex(dow); return (d >= 0 && setupVerseFor(d)) || NO_VERSE; }
  return MEMORY_VERSES[dow] || NO_VERSE;
}
// Redesign §1.2 #14: a section with nothing real in it is not shown to counselors (senior's seed is all placeholders: "Verse to
// be announced.", a rota with no team). Judged through the accessors, so it is right with each section's switch on AND off, and
// it flips by itself the moment a director fills one day in. Directors always see the section (the hub's to-do is their prompt).
function verseIsReal(v) {
  const text = String((v && v.text) || '').trim();
  return !!text && !(/\bto be announced\b/i.test(text) && !String((v && v.ref) || '').trim());
}
function verseSectionEmpty() {
  for (let dow = 0; dow <= 6; dow += 1) if (verseIsReal(verseFor(dow))) return false;
  return !verseIsReal(verseTheme());
}
function cleanupSectionEmpty() {
  for (let dow = 0; dow <= 6; dow += 1) if (cleanupOnRota(dow)) return false;
  return true;
}
// Is this hideable section empty (so a counselor's screen leaves it out)?
function cardEmptyForViewers(card) {
  return card === 'verse' ? verseSectionEmpty() : card === 'cleanup' ? cleanupSectionEmpty() : false;
}

// ── Electives
// A day's slots, [slot → [[stationName, [names], [member keys]?], …]]; [] on a day with none. Edited here the third list is
// the member key behind each name ('' for a typed one) — see electiveIsMe.
function electivesFor(dow) {
  if (sectionIsShared('electives') && typeof setupElectivesOf === 'function') { const d = weekdayIndex(dow); return d < 0 ? NO_ITEMS : (setupElectivesOf(d) || NO_ITEMS); }
  return ELECTIVES[dow] || NO_ITEMS;
}
function stationEmoji(name) {
  if (sectionIsShared('electives') && typeof setupStationEmoji === 'function') return setupStationEmoji(name) || '🌟';
  return STATION_EMOJI[name] || '🌟';
}
// When an elective slot starts on a weekday: the usual 1:15 / 3:00 / 4:00 while the schedule is built in; once it is edited
// here, the start of that day's Elective item for the slot (a rain plan that moves Elective 1 moves the time everyone sees).
function electiveSlotStart(slot, dow) {
  if (scheduleIsShared()) {
    const hit = planForDow(dow).find((b) => b.type === 'elective' && b.slot === slot && !b.noTime);
    if (hit) return hit.start;
  }
  return ELECTIVE_SLOT_MIN[slot];
}
// Is this one of the people at a station — me? Built in a name is all there is: the device's chosen identity (canonical on
// both sides: Alysa and Alyssa are one person). Edited here a person may carry a member key: my own sign-in matches by key
// first, and a key that is somebody else's never matches by name; a typed name matches by name.
function electiveIsMe(name, key) {
  const mine = typeof authUser !== 'undefined' && authUser && typeof identityKey === 'function' ? identityKey(authUser) : '';
  if (key && mine) return key === mine;
  const me = canonicalCounselorName(state.identity);
  return !!me && canonicalCounselorName(name) === me;
}
// Is a station's people list (a row of electivesFor) mine? `row` = [station, names, keys?].
function electiveRowHasMe(row) {
  const names = (row && row[1]) || [];
  const keys = (row && row[2]) || [];
  return names.some((n, i) => electiveIsMe(n, keys[i] || ''));
}
// A name an elective list knows, so adoptMemberTeam can take it as the device's identity (edited here, a name added to
// the electives counts; built in, only the printed roster does).
function electiveKnowsName(name) {
  return sectionIsShared('electives') && typeof setupElectiveNames === 'function' && setupElectiveNames().some((n) => canonicalCounselorName(n) === name);
}

// ── Double points
// The window, { start, end } epoch ms (camp-core.js doubleWindowFor shape).
// A week with no epoch (every week until the new-year setup) is pinned to the legacy window, whatever the setup data says.
// With an epoch the window is the week's own: setup/meta/double over setup/meta/weekStart (no `double` = no doubling).
// Memoised on its three inputs: bonusCountsDouble asks once per bonus entry.
let doubleWindowMemo = null;
function doubleWindow() {
  const epoch = state && state.meta && typeof state.meta.epoch === 'string' ? state.meta.epoch : '';
  if (!epoch) return DOUBLE_WINDOW_LEGACY;
  const meta = typeof setupTree !== 'undefined' && setupTree && setupTree.meta ? setupTree.meta : {};
  const start = campWeek().start;
  const key = epoch + '|' + start + '|' + JSON.stringify(meta.double || null);
  if (!doubleWindowMemo || doubleWindowMemo.key !== key) doubleWindowMemo = { key, win: doubleWindowFor({ epoch, weekStart: start, double: meta.double }) };
  return doubleWindowMemo.win;
}
// The weekday (0 = Sunday … 6 = Saturday) on which the standings reveal ends in the champions' crowning
// (setup/meta/finaleDow, always read like the week's start date; absent or junk = Friday).
function finaleDow() {
  const v = typeof setupTree !== 'undefined' && setupTree && setupTree.meta ? setupTree.meta.finaleDow : null;
  return Number.isInteger(v) && v >= 0 && v <= 6 ? v : 5;
}

// ── Teams
function teamIds() { return (state.teams || NO_ITEMS).map((t) => t.id); }
// A team's own record in state.teams (null for an id the roster doesn't carry).
function teamRecord(id) { return (state.teams || NO_ITEMS).find((t) => t && t.id === id) || null; }
// The emoji and the short name are each the team record's own optional field (what the Teams screen sets),
// per field, else the camp's constant; both pass a camp-core sanitizer on the way out (a database string is
// never trusted: markup in an emoji, an over-long short name).
function teamEmoji(id) { return teamEmojiOwn(id) || '🏳️'; }
// The same, '' when neither the record nor the camp has an emoji for the team (teamEmoji then shows the white flag): what the
// Teams screen shows in its field and what the hub judges ("Foxes has no emoji").
function teamEmojiOwn(id) {
  const rec = teamRecord(id);
  return safeEmoji(rec ? rec.emoji : undefined, safeEmoji(TEAM_EMOJI[id], ''));
}
function teamShort(id) {
  const rec = teamRecord(id);
  return safeShort(rec ? rec.short : undefined, safeShort(TEAM_ABBREV[id], ''));
}
// The palette swatch a team record names: its id ('pumpkin'), or '' when the team has none yet or the
// stored string is not one of the twelve (a database string only ever SELECTS a swatch, never becomes CSS).
function teamColorId(id) {
  const rec = teamRecord(id);
  const c = rec && rec.color;
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(CAMP_TEAM_PALETTE, c) ? c : '';
}
// THE one place a team colour is laundered (camp-core.js safeColorVars): the `--team-accent-l:…;--team-accent-d:…`
// pair the CSS reads (styles.css, "Team accent"), or '' when the team has no colour at all. The palette id the
// record names wins; without one the camp's older single hex stands in for both themes. Only hex digits and
// fixed variable names can come out, so the result is safe in a style attribute without esc().
function teamAccentVars(id) {
  const rec = teamRecord(id);
  return safeColorVars(rec ? rec.color : undefined, TEAM_ACCENT[id], CAMP_TEAM_PALETTE);
}
// The light value as one plain '#rrggbb', or null: for the places that cannot take the pair (a tile's edge).
function teamAccent(id) {
  const m = /--team-accent-l:(#[0-9a-fA-F]{6})/.exec(teamAccentVars(id));
  return m ? m[1] : null;
}
// The team photos this device has in memory ('<id>:<photoV>' → a laundered data URL), filled by teamPhotoNeed
// (app.js "Team photos"). Declared here, inside the block, so a load-time caller can never hit a TDZ read.
const TEAM_PHOTO_MEM = new Map();
// The version of a team's uploaded photo (the record's photoV, a non-negative number) or null.
function teamPhotoVersion(id) {
  const rec = teamRecord(id);
  const v = rec ? rec.photoV : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}
// A team's crest image, or null if there is none — callers fall back to the emoji (or a flag). Precedence: the
// uploaded photo (only once THIS version of it has arrived on the device) > the camp's shipped shield. Set it
// with src=, never concatenate beyond what safeCrestSrc has matched in full.
function teamCrestSrc(id) {
  const v = teamPhotoVersion(id);
  const photo = v === null ? null : safeCrestSrc(TEAM_PHOTO_MEM.get(id + ':' + v));
  return photo || safeCrestSrc(TEAM_SHIELD[id]);
}
// The printed counselor names for one team (the names the electives data is
// keyed to), and every team's, flat.
function teamRoster(tid) { return TEAM_COUNSELORS[tid] || NO_ITEMS; }
function staffNames() {
  const out = [];
  Object.keys(TEAM_COUNSELORS).forEach((tid) => teamRoster(tid).forEach((n) => out.push(n)));
  // Edited here, the people on the elective stations are names a mention can find too (a game leader who is on no team).
  if (sectionIsShared('electives') && typeof setupElectiveNames === 'function') setupElectiveNames().forEach((n) => { if (!out.includes(n)) out.push(n); });
  return out;
}
// What a brand-new device seeds for the roster, and what an older saved roster
// is migrated from (the 2026 week; see normalizeSyncedState).
function seedTeams() { return DEFAULT_TEAM_NAMES.map((name, i) => ({ id: 't' + i, name, counselor: DEFAULT_COUNSELORS[i] })); }
function legacyRosterFor(i) {
  return {
    oldNames: OLD_PLACEHOLDER_TEAM_NAMES[i], name: DEFAULT_TEAM_NAMES[i],
    oldCounselor: OLD_PLACEHOLDER_COUNSELORS[i], counselor: DEFAULT_COUNSELORS[i],
  };
}
// ── end SEAM ──────────────────────────────────────────────────────

// Everything is points based: each medal is worth a fixed number of
// points, and the week standings rank teams by total points.
const MEDAL_POINTS = { gold: 7, silver: 5, bronze: 3 };

// ── Double-points window (Patrick's call, Thu evening 2026-07-23) ──
// Everything from Thursday 5pm ET through the end of Friday counts DOUBLE,
// except meal cleanup. Games are handled by their `messtival` flag (see the
// config v5 migration); the window doubles the OTHER point sources — verse
// recitals and custom bonuses — by entry timestamp, at computation time, so
// it's retroactive and needs no ledger edits. The constants and the maths live
// in camp-core.js (the TV page loads the same copy); this week is the legacy
// one, so it is pinned to DOUBLE_WINDOW_LEGACY.
function bonusCountsDouble(b) {
  if (!pointsReadAllowed('bonusCountsDouble')) return false; // a points reader: see "Standings secrecy"
  return bonusIsDouble(b, doubleWindow());
}

// True while "now" is inside the double-points window (drives the notices
// on the verse/bonus cards).
function inDoubleBonusWindow() {
  return inDoubleWindow(doubleWindow(), Date.now());
}

// ── Game catalog ────────────────────────────────────────────────
// The week's games and days now live in editable, synced state
// (state.config) — built out by editors in More → Set up the week.
// The built-in defaults are in defaults.js (defaultConfig()); the
// builder UI is in settings.js. dayLabel() (the SEAM block) stays: the memory-verse,
// meal-cleanup, and daily-schedule features are keyed by real day of
// week, independent of the editable competition days.

// ── Live daily schedule ("Happening now" banner) ─────────────────
// The full week from the printed Junior Camp packet, so the top of the
// page can say what camp is doing at this very moment. Times are minutes
// since midnight in CAMP TIME (US Eastern) — never the phone's timezone,
// so the banner is right even for family checking in from elsewhere.
// During competition blocks the banner hides; the scoreboard below is
// the main event then. Blocks are contiguous — findIndex is enough.

const CAMP_TZ = 'America/New_York';

// The full set of kids at camp on a given day = everyone assigned to any
// station across that day's elective slots. A kid missing from a particular
// slot is on break for it (see electiveBreakKids).
function electiveDayRoster(dow) {
  const set = new Set();
  electivesFor(dow).forEach((slot) => {
    (slot || []).forEach(([, kids]) => (kids || []).forEach((k) => set.add(k)));
  });
  return set;
}

// Kids with no station in this elective slot — they're on "Break".
function electiveBreakKids(dow, slot) {
  const assigned = new Set();
  (electivesFor(dow)[slot] || []).forEach(([, kids]) => (kids || []).forEach((k) => assigned.add(k)));
  return [...electiveDayRoster(dow)].filter((k) => !assigned.has(k)).sort();
}

// Where the stored identity is during one elective slot of any day:
// { station, emoji, onBreak }, or null when there's nothing to say (no
// identity, no electives that day, or the identity isn't on that day's
// sheet — counselors and parents). Used by the schedule sheet's "You" chip.
function myStationFor(dow, slot) {
  const stations = electivesFor(dow)[slot] || [];
  const found = stations.find(electiveRowHasMe);
  if (found) return { station: found[0], emoji: stationEmoji(found[0]), onBreak: false };
  if (electiveMeOnDay(dow)) return { station: 'Break', emoji: '☕', onBreak: true };
  return null;
}
// Am I at any station on this day (any slot)? Not being there at all says nothing: no "Break" for a counselor or a parent.
function electiveMeOnDay(dow) {
  return electivesFor(dow).some((slot) => (slot || []).some(electiveRowHasMe));
}

// ── Elective weather forecast ─────────────────────────────────────
// Shows the forecast next to FUTURE electives (schedule sheet + "My electives
// today" card). Source: Open-Meteo — free, no API key, CORS-friendly, so it
// works from a static GitHub Pages site. Coordinates are Campground Rd,
// Belgrade ME (weather is regional, so town-level precision is plenty).
// Fails silent when offline/blocked, exactly like the optional Firebase sync.
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
  + '?latitude=44.5055&longitude=-69.7791'
  + '&hourly=temperature_2m,weather_code,precipitation_probability'
  + '&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=7';
const WEATHER_CACHE_KEY = 'campWeatherCache';
const WEATHER_TTL_MS = 30 * 60 * 1000; // refetch at most every 30 min
const WEATHER_RAIN_MIN = 40;           // only surface rain % at/above this

// WMO weather_code → { emoji, label }.
const WEATHER_CODES = {
  0: { emoji: '☀️', label: 'Clear' }, 1: { emoji: '🌤️', label: 'Mainly clear' },
  2: { emoji: '⛅', label: 'Partly cloudy' }, 3: { emoji: '☁️', label: 'Overcast' },
  45: { emoji: '🌫️', label: 'Fog' }, 48: { emoji: '🌫️', label: 'Fog' },
  51: { emoji: '🌦️', label: 'Light drizzle' }, 53: { emoji: '🌦️', label: 'Drizzle' }, 55: { emoji: '🌦️', label: 'Heavy drizzle' },
  56: { emoji: '🌧️', label: 'Freezing drizzle' }, 57: { emoji: '🌧️', label: 'Freezing drizzle' },
  61: { emoji: '🌧️', label: 'Light rain' }, 63: { emoji: '🌧️', label: 'Rain' }, 65: { emoji: '🌧️', label: 'Heavy rain' },
  66: { emoji: '🌧️', label: 'Freezing rain' }, 67: { emoji: '🌧️', label: 'Freezing rain' },
  71: { emoji: '🌨️', label: 'Light snow' }, 73: { emoji: '🌨️', label: 'Snow' }, 75: { emoji: '🌨️', label: 'Heavy snow' },
  77: { emoji: '🌨️', label: 'Snow grains' },
  80: { emoji: '🌦️', label: 'Rain showers' }, 81: { emoji: '🌦️', label: 'Rain showers' }, 82: { emoji: '⛈️', label: 'Violent showers' },
  85: { emoji: '🌨️', label: 'Snow showers' }, 86: { emoji: '🌨️', label: 'Snow showers' },
  95: { emoji: '⛈️', label: 'Thunderstorm' }, 96: { emoji: '⛈️', label: 'Thunderstorm w/ hail' }, 99: { emoji: '⛈️', label: 'Thunderstorm w/ hail' },
};

// { dates: ['YYYY-MM-DD', …], byTime: { 'YYYY-MM-DDTHH:00': {temp, code, precip} }, at }
let weatherData = null;

// Today's date in camp time as 'YYYY-MM-DD' (en-CA renders ISO order), used to
// tell whether a cached forecast is still keyed to the right "today".
function campDateStr() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CAMP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch (e) { return ''; }
}

function processWeather(json) {
  const h = json && json.hourly;
  if (!h || !Array.isArray(h.time)) return null;
  const byTime = {};
  const dates = [];
  h.time.forEach((t, i) => {
    // Coerce: these come from a third-party API and reach the DOM. They are
    // only safe today because every render site compares them numerically —
    // one future refactor that prints one directly would turn open-meteo into
    // an injection path. Numbers in, numbers out.
    byTime[t] = { temp: Number(h.temperature_2m[i]), code: Number(h.weather_code[i]), precip: Number(h.precipitation_probability[i]) };
    const d = t.slice(0, 10);
    if (dates[dates.length - 1] !== d) dates.push(d);
  });
  return { dates, byTime, at: Date.now() };
}

// Paint badges in-place once weather lands (schedule sheet + the Now card's
// rain note).
function repaintWeather() {
  refreshOpenSchedule();
  if (typeof renderNow === 'function') nowRefresh(); // the card's rain note
}

function loadWeatherCache() {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw);
    // Discard a forecast whose day 0 isn't today — the day-offset mapping in
    // electiveWxHtml assumes dates[0] === today.
    if (cached && cached.dates && cached.dates[0] === campDateStr()) weatherData = cached;
  } catch (e) { /* ignore corrupt/absent cache */ }
}

async function fetchWeather() {
  try {
    const res = await fetch(WEATHER_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = processWeather(await res.json());
    if (!data) return;
    weatherData = data;
    try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data)); } catch (e) { /* quota / private mode */ }
    repaintWeather();
  } catch (e) { /* offline / blocked — try again next tick */ }
}

function weatherFresh() {
  return weatherData && weatherData.dates[0] === campDateStr() && (Date.now() - weatherData.at) < WEATHER_TTL_MS;
}

function startWeatherUpdates() {
  loadWeatherCache();
  if (!weatherFresh()) fetchWeather();
  setInterval(() => { if (!weatherFresh()) fetchWeather(); }, WEATHER_TTL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !weatherFresh()) fetchWeather(); });
}

// Forecast badge HTML for one elective slot, or '' when it shouldn't show:
// no data, a past day, a today-slot that already started, beyond the forecast
// range, or a missing hour. dow is the schedule day being rendered (0–6).
function electiveWxHtml(dow, slot) {
  if (!weatherData) return '';
  const now = campNow();
  const dayOffset = dow - now.dow;
  if (dayOffset < 0) return '';                                            // earlier this week
  if (dayOffset === 0 && electiveSlotStart(slot, dow) <= now.minutes) return ''; // today, already started
  if (dayOffset >= weatherData.dates.length) return '';                    // past the 7-day window
  const hour = Math.floor(electiveSlotStart(slot, dow) / 60);
  const w = weatherData.byTime[`${weatherData.dates[dayOffset]}T${String(hour).padStart(2, '0')}:00`];
  if (!w || w.temp == null) return '';
  const info = WEATHER_CODES[w.code] || { emoji: '🌡️', label: 'Forecast' };
  const rain = (w.precip != null && w.precip >= WEATHER_RAIN_MIN) ? ` · ${w.precip}%` : '';
  return `<span class="wx-badge" title="${esc(info.label)} · forecast">${info.emoji} ${Math.round(w.temp)}°${rain}</span>`;
}

// The first hour within the next three (from the current hour, camp time) whose rain chance crosses WEATHER_RAIN_MIN, as plain data,
// { precip, when } or null: no forecast, a dry stretch, or an hour past midnight (camp's asleep) is null. Now's model reads it.
// The clock is an argument (Now's model passes the one it is given, so a picture at any minute is the same whatever the wall clock says);
// with none it is the camp's.
function upcomingRain(minutes, date) {
  if (!weatherData) return null;
  const today = weatherData.dates[0];
  if (today !== (date || campDateStr())) return null;
  const startHour = Math.floor((Number.isFinite(minutes) ? minutes : campNow().minutes) / 60);
  for (let h = startHour; h <= startHour + 3 && h <= 23; h++) {
    const w = weatherData.byTime[`${today}T${String(h).padStart(2, '0')}:00`];
    if (w && w.precip != null && w.precip >= WEATHER_RAIN_MIN) {
      return { precip: w.precip, when: h === startHour ? 'this hour' : `near ${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}` };
    }
  }
  return null;
}

// ── Meal menu ────────────────────────────────────────────────────
// What the kitchen is serving comes from mealFor() (the SEAM block).
function mealInfo(dow, block) {
  if (!block) return null;
  // Once the schedule is edited here the item's Meal tag says which meal it is (a "Supper and free time" item tagged Supper
  // gets its dish); built in it is the label, as it has always been.
  const rich = scheduleIsShared() && typeof setupRichOf === 'function' ? setupRichOf(block) : null;
  if (rich) return rich.meal ? mealFor(dow, rich.meal) : null;
  return mealFor(dow, (block.label || '').toLowerCase());
}

// Returns the block as-is, or a copy dressed up with tonight's dish —
// e.g. "Supper" becomes "Supper — Shepherd's Pie" with a 🥧 emoji.
function decorateMealBlock(dow, block) {
  const meal = mealInfo(dow, block);
  if (!meal) return block;
  return Object.assign({}, block, {
    emoji: meal.emoji || block.emoji,
    label: block.label + ' — ' + meal.dish,
  });
}

// A "🧽 <team>" note naming who's on cleanup for the meal a block represents,
// shown next to the meal wherever it appears. '' when the block isn't a meal or
// the day isn't on the cleanup rota; "TBA" for a tracked day not yet assigned.
function mealCleanupNote(dow, label, tagged) {
  // `tagged` is blockMeal() of the item the label came from (its Meal tag once the schedule is edited here); without it
  // the label says.
  const meal = tagged !== undefined ? tagged : legacyMealOf(label);
  if (!meal || !cleanupOnRota(dow)) return '';
  const teams = cleanupTeams(dow, meal);
  if (!teams.length) return ''; // nothing to say until a team is on it (the hub's to-do is the directors' prompt)
  const who = teams.map(id => `${teamEmoji(id)} ${esc(teamName(id))}`).join(' + ');
  return ` <span class="meal-cleanup-note">🧽 ${who}</span>`;
}

// ── Notice board (big, top-of-page, editor-composed) ─────────────
// One large card pinned above every other section, for the message that has
// to be impossible to miss. Built for send-off-morning cleanup: six separate
// announcements filled the whole phone screen and buried the one line each
// camper actually needed.
//
// Unlike an announcement, it isn't typed in a single box and it doesn't
// expire on a timer. It's composed in the week builder (More → Set up
// the week → Notice) and lives in synced state, so every device shows the
// same thing, and it is either a DRAFT (nobody sees it; keep editing as long
// as you like) or POSTED (on every device until you put it back to draft).
//
// Shape — state.notice, synced (see SYNC_KEYS):
//   { status: 'draft' | 'posted',
//     eyebrow, title, sub, signoff,          // all optional strings
//     zones: [{ teamId, place, note }],      // per-team assignments, in order
//     steps: [{ emoji, when, items: [] }] }  // the running order
const NOTICE_STATUSES = ['draft', 'posted'];

// The starting content — per-camp (camps.js): junior seeds its Saturday
// send-off cleanup plan (the worked example this feature was built for),
// senior a TBA skeleton. Always a DRAFT — seeding must never post a card.
function defaultNotice() {
  return CAMP.defaultNotice();
}

// Coerce state.notice into a shape every reader can trust. Realtime Database
// prunes empty arrays/strings on write, so a posted notice with no zones (or
// no steps) comes back missing them entirely — see the RTDB note in CLAUDE.md.
// A notice with no `status` at all has never existed on this database, so it
// gets seeded with the worked example above.
function normalizeNotice() {
  let n = state.notice;
  if (!n || typeof n !== 'object' || Array.isArray(n) || !n.status) {
    n = defaultNotice();
  }
  if (!NOTICE_STATUSES.includes(n.status)) n.status = 'draft';
  ['eyebrow', 'title', 'sub', 'signoff'].forEach((k) => {
    n[k] = typeof n[k] === 'string' ? n[k] : '';
  });
  n.zones = (Array.isArray(n.zones) ? n.zones : [])
    .filter((z) => z && typeof z === 'object')
    .map((z) => ({ teamId: String(z.teamId || ''), place: String(z.place || ''), note: String(z.note || '') }));
  n.steps = (Array.isArray(n.steps) ? n.steps : [])
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      emoji: String(s.emoji || ''),
      when: String(s.when || ''),
      items: (Array.isArray(s.items) ? s.items : []).map((i) => String(i)).filter(Boolean),
    }));
  state.notice = n;
  return n;
}

function noticeBoard() {
  return normalizeNotice();
}

// Posted AND actually saying something — an empty posted notice would render
// as a bare box, so it stays hidden until it has content.
function noticePosted() {
  const n = noticeBoard();
  if (n.status !== 'posted') return false;
  return !!(n.title || n.sub || n.signoff || n.zones.length || n.steps.length);
}

// One team's assignment on the current notice, or null.
function noticeZoneFor(teamId) {
  return noticeBoard().zones.find((z) => z.teamId === teamId) || null;
}

// The notice as a counselor's phone draws it (now-ui.js: the strip on Now and, behind See all, the whole notice), for the two
// previews that must not drift from the real thing: Tell everyone's "On a counselor's phone" (`opts.strip`: the strip alone, which
// is all Now shows) and the builder's Notice tab (the strip and what See all opens). `preview` draws it regardless of status;
// `notice` draws one that is not the live one (what a pin WOULD post): it must already be a whole, normalized card. null when
// the notice is not posted and this is not a preview; '' without now-ui.js (there is no Now to show it on).
function noticeCardHtml(preview, notice, opts) {
  if (!preview && !noticePosted()) return null;
  return typeof nowNoticePreviewHtml === 'function' ? nowNoticePreviewHtml(nowNoticeData(nowCtx(), notice), opts) : '';
}

// Post / un-post from the builder. Editors only — it shows on every device.
function setNoticeStatus(status, opts) {
  if (!canEdit() || !NOTICE_STATUSES.includes(status)) return;
  noticeBoard().status = status;
  // Posting/taking down is a real broadcast, same as an announcement, so it
  // stamps "Data last updated". Drafting edits deliberately don't — they're
  // invisible to everyone else until posted. (opts is touchData's: Tell everyone's
  // Take down passes { celebrate: false }, because bringing something down is not
  // a celebration.)
  touchData(opts);
  saveState();
  renderAll();
}

// Current day-of-week + minutes-since-midnight, in camp time.
// Debug/preview override: add ?now=<dow>-<hhmm> to the page URL,
// e.g. ?now=1-1330 previews Monday 1:30pm.
function campNowOverride() {
  const m = /[?&]now=(\d)-(\d{3,4})(?:&|$)/.exec(location.search);
  if (!m) return null;
  const t = m[2].padStart(4, '0');
  return { dow: +m[1], minutes: +t.slice(0, 2) * 60 + +t.slice(2) };
}
function campNow() {
  const over = campNowOverride();
  if (over) return over;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CAMP_TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const hour = parseInt(get('hour'), 10) % 24; // hour12:false renders midnight as "24"
    return { dow: dowMap[get('weekday')], minutes: hour * 60 + parseInt(get('minute'), 10) };
  } catch (e) {
    const d = new Date(); // worst case: device time
    return { dow: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}

// Named schedClock/schedRange (not fmtClock) — fmtBoardClock/fmtWatch below
// have their own formatters and function declarations share one namespace.
function schedClock(mins, withSuffix) {
  const h = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  const h12 = ((h + 11) % 12) + 1;
  return h12 + ':' + String(mm).padStart(2, '0') + (withSuffix ? (h < 12 ? 'am' : 'pm') : '');
}

function schedRange(start, end) {
  const sameHalf = (start < 720) === (end < 720 || end === 1440);
  return schedClock(start, !sameHalf) + '–' + schedClock(end, true);
}

// ════════════════════════════════════════════════════════════════════
// THE NOW ENGINE — nowModel() and what hangs off it (redesign §3; BUILD-PLAN Step 17, build session 1)
// ════════════════════════════════════════════════════════════════════
// ONE function computes the whole Now tab from the week's data (through the SEAM accessors), the state and the clock it is
// GIVEN, so a test can walk every minute of every day in both camps (tests/now-model.test.js), as week.test.js walks the old
// banner. It returns PLAIN DATA — no markup, no DOM, no timer — and the renderers (later Step 17 sessions) only paint it.
// Rules of the layer:
//   - SECRECY. A counselor's model holds no point and no place: points come from the guarded readers (cleanupEarned,
//     versePointsByDay: they return nothing for a counselor) and only for `ctx.points`; a live tally is in roster order unless
//     a director looks at it. A game's medal winners and live scores are public (redesign §4.12 rows 11-12).
//   - THE CLOCK IS AN ARGUMENT (`opts.now` = { dow, minutes }, `opts.ms` = server ms), never read inside the picture. Every
//     minute of every day is a block or a named empty state (`card.kind`: between | morning | night | none | over).
//   - What changes with the clock alone lives in `clock` (minutes left, the hairline, minutes until the next block) and is
//     patched by the tick; everything else changes only at a minute listed in `wake`, or with the data (a snapshot's
//     renderAll). A test pins that: no minute that changes the picture is missing from `wake`.
//   - Week data only through the SEAM accessors (tests/seam.test.js); text from the database is escaped by the renderer
//     (esc) and every emoji, link and colour that reaches markup passes a camp-core.js sanitizer.
// Hooks a renderer provides (all typeof-guarded, so the page runs without them): renderNow(model) for a full paint,
// renderNowClock(model) when only model.clock moved, renderNowMessages(model) when only the message strip moved.

const NOW_CLEANUP_WINDOW_MIN = 30;      // the cleanup moment: this long after a meal's end (redesign §3.3)
const NOW_OVERRUN_MAX_MIN = 45;         // a games block past its end stays the card at most this long (§3.1)
const NOW_HOLD_STEP_MS = 10 * 60000;    // "Still on this · +10 min": each tap adds this much
const NOW_MORNING_FROM_MIN = 6 * 60;    // before this hour, before the day's first block, the card is the night one
const NOW_LATER_MAX = 3;                // Later today: the three after Up next
const NOW_TODO_MAX = 3;                 // Still to do today: three rows, then "N more"

function nowMyTeam() {
  const t = state.followTeam;
  return typeof t === 'string' && teamIds().includes(t) ? t : '';
}

// The context one picture is computed in. The role is read here, once: `director` = may act as a director right now
// (false in a counselor preview), `points` = may see points (a CONFIRMED director outside a preview).
function nowCtx(opts) {
  opts = opts || {};
  const n = opts.now || campNow();
  const dow = weekdayIndex(n.dow);
  const minutes = Number(n.minutes);
  return {
    dow: dow < 0 ? 0 : dow,
    minutes: Number.isFinite(minutes) ? Math.max(0, Math.min(1439, Math.floor(minutes))) : 0,
    ms: Number.isFinite(opts.ms) ? opts.ms : serverNow(),
    date: typeof opts.date === 'string' ? opts.date : campDateStr(),
    forced: opts.forced !== undefined ? !!opts.forced : !!campNowOverride(), // a ?now= preview ignores the camp week's dates
    director: canEdit(),
    points: standingsVisible(),
    myTeam: nowMyTeam(),
    identity: state.identity,
    hidden: nowHiddenSections(),
  };
}
// The sections the directors switched off in More → What counselors see, as THIS screen is drawn (viewRole: a counselor preview
// honours them, a director's own screen does not): `games` (the Games tab's switch), `verse`, `cleanup`. A hidden section is not
// on Now either: its card is a plain activity card and its lines are not there at all (applyCardVisibility is the same rule for
// the tabs and sheets).
function nowHiddenSections() {
  const seeAll = viewRole() === 'editor';
  return { games: !seeAll && cardHiddenFromViewers('competitions'), verse: !seeAll && (cardHiddenFromViewers('verse') || verseSectionEmpty()), cleanup: !seeAll && (cardHiddenFromViewers('cleanup') || cleanupSectionEmpty()) };
}

// ── words ────────────────────────────────────────────────────────────
// A label as { head, tail, place }: the head is what is before " — ", a trailing "(Laura's cottage)" is the place.
function nowSplitLabel(label) {
  const s = String(label == null ? '' : label);
  const at = s.indexOf(' — ');
  let head = (at < 0 ? s : s.slice(0, at)).trim();
  const tail = at < 0 ? '' : s.slice(at + 3).trim();
  let place = '';
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(head);
  if (m) { head = m[1].trim(); place = m[2].trim(); }
  return { head, tail, place };
}
// A tail that is only people ("Jenn, Laura, Erica & Patrick") reads "with …"; any other tail is a note ("Snack Shack open").
function nowTailText(tail) {
  if (!tail) return '';
  const people = tail.split(/\s*(?:,|&|\band\b)\s*/).every((w) => /^[A-Z][^\s,&]*(?:\s+[A-Z][^\s,&]*)*$/.test(w));
  return people ? 'with ' + tail : tail;
}
function nowJoinNames(names) {
  return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}
function nowTeamWord(id) { return teamShort(id) || teamName(id); }
// A game's place as a row says it: '' for nothing and for a placeholder ("TBA", "TBD"), which is no information (the copy glossary).
function nowPlaceWord(where) {
  const w = String(where == null ? '' : where).trim();
  return /^(tba|tbd|to be announced|to be decided)\.?$/i.test(w) ? '' : w;
}
// Two names that read the same (a game named like its block): case, curly quotes and spaces aside.
function nowSameName(a, b) {
  const n = (t) => String(t == null ? '' : t).toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  return !!n(a) && n(a) === n(b);
}
// How many of a games block's games a director still has to score: "Not scored yet" for a block of one, "3 games still to score" when
// none is, "2 of 3 games still to score" once some are (never "1 of 1 game").
function nowStillToScoreText(left, total) {
  if (left >= total) return total === 1 ? 'Not scored yet' : total + ' games still to score';
  return left + ' of ' + total + ' game' + (total === 1 ? '' : 's') + ' still to score';
}
// The line under a card that IS one game (mockup 13: "4-team bracket · Main field"): its format in plain words, then its place.
function nowGameKindLine(row) {
  const kind = row.format === 'tournament' ? teamIds().length + '-team bracket' : row.format === 'tally' ? 'Every team scores' : 'Gold, silver and bronze';
  return [kind, row.where].filter(Boolean).join(' · ');
}
// "63 min left" / "7 min over" (from model.clock), and "in 3 h 10 min" for a countdown.
function nowLeftText(c) {
  if (!c) return '';
  if (c.over) return c.over + ' min over';
  return c.left == null ? '' : c.left + ' min left';
}
function nowSpanText(mins) {
  const m = Math.max(0, Math.round(mins));
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
}
// 'YYYY-MM-DD' → "Sunday, June 21" (the date as written, no time zone to get wrong).
function nowDateLong(str) {
  const p = String(str || '').split('-').map(Number);
  if (p.length !== 3 || p.some((x) => !Number.isFinite(x))) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(Date.UTC(p[0], p[1] - 1, p[2])));
  } catch (e) { return ''; }
}

// ── the day ──────────────────────────────────────────────────────────
// One weekday's blocks as the engine reads them (schedule order, so the first block that holds a minute wins, as the old
// banner found it): the accessor's block plus what the card needs. `id` is the published block id: `<dk>-<id>` once the
// schedule is edited here, `d<dow>-<start>-<position>` while it is the printed copy: unique either way.
// With Games switched off for this screen (`ctx.hidden.games`) a games block is a plain activity: no rows, no podium, no
// "Running over", no game names in Up next.
function nowBlocks(dow, ctx) {
  const noGames = !!(ctx && ctx.hidden && ctx.hidden.games);
  return scheduleForDow(dow).map((b, i) => {
    const sp = nowSplitLabel(b.label);
    const teams = blockTeams(b, dow);
    const kind = blockKind(b, dow);
    return {
      i, dow, b, id: blockPushId(b, dow, i), start: b.start, end: b.end, noTime: !!b.noTime,
      emoji: safeEmoji(b.emoji, ''), type: b.type || 'activity', slot: b.slot,
      kind: noGames && kind === 'games' ? 'activity' : kind, meal: blockMeal(b), head: sp.head, place: sp.place, tail: teams.length ? '' : sp.tail, teams,
    };
  });
}
function nowFind(blocks, minutes) { return blocks.find((x) => minutes >= x.start && minutes < x.end) || null; }

// What camp week the clock is in: 'unset' (no dates anywhere: the printed weekday schedule runs, as it always did),
// 'before' / 'during' / 'after' from the Sunday the week starts. A previewed clock (?now=) is always 'during'.
function nowDayGap(startStr, dateStr) {
  const a = String(startStr).split('-').map(Number);
  const b = String(dateStr).split('-').map(Number);
  if (a.length !== 3 || b.length !== 3 || a.some((x) => !Number.isFinite(x)) || b.some((x) => !Number.isFinite(x))) return 0;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}
function nowWeek(ctx) {
  if (ctx.forced) return { phase: 'during', start: null };
  const start = campWeek().start;
  if (!start) return { phase: 'unset', start: null };
  const gap = nowDayGap(start, ctx.date);
  return { phase: gap < 0 ? 'before' : gap > 6 ? 'after' : 'during', start };
}

// ── games ────────────────────────────────────────────────────────────
// The status model of redesign §5.3 (the Games tab reuses it): Done = a result; Live = a bracket in progress, a draft with any
// score or medal, or a game clock that is running; else Not started. A bracket left behind by a format change does not count.
function gameRowStatus(g, ms) {
  if (!g) return 'todo';
  if (state.results && state.results[g.id]) return 'done';
  const b = state.brackets && state.brackets[g.id];
  if (b && g.format === 'tournament' && bracketKnown(b) && normalizeBracket(b).phase !== 'summary') return 'live';
  if (g.format === 'tournament' && state.brackets4 && fourRead(state.brackets4[g.id], teamIds())) return 'live'; // a bracket this build cannot read does not count, as the six-team one
  const d = state.drafts && state.drafts[g.id];
  if (d && ((d.scores && Object.values(d.scores).some((v) => String(v).trim() !== '')) || (d.medals && Object.values(d.medals).some(Boolean)))) return 'live';
  const c = state.clocks && state.clocks[g.id];
  if (c && c.running === true && Number(c.endAt) > (Number.isFinite(ms) ? ms : serverNow())) return 'live';
  return 'todo';
}

// The three medal winners of a finished game, [{ place: 1|2|3, team, mine }] — public, read from the result directly.
function nowPodium(ctx, g) {
  const r = state.results && state.results[g.id];
  const ids = teamIds();
  if (!r || !r.medals) return null;
  return [['gold', 1], ['silver', 2], ['bronze', 3]]
    .filter(([k]) => ids.includes(r.medals[k]))
    .map(([k, place]) => ({ place, team: r.medals[k], name: teamName(r.medals[k]), mine: r.medals[k] === ctx.myTeam }));
}

// A live game's board as data. Tally: the teams that are in (roster order — the ORDER is a director's), match: the pair
// playing now with their score and the next pair when it is known. Placement: nothing (the sub says "Being scored").
function nowLiveBoard(ctx, g) {
  const b = state.brackets && state.brackets[g.id];
  if (g.format === 'tournament' && b && bracketKnown(b)) {
    const nb = normalizeBracket(b);
    if (nb.phase === 'summary') return null;
    const phase = { round1: 'Round 1', bye: 'Bye', semifinal: 'Championship game', championship: 'Final' }[nb.phase] || '';
    const next = nextMatchupOf(g, nb);
    return nowMatchBoard(ctx, g, currentMatchupOf(g, nb), phase, next ? next.slice(0, 2) : null);
  }
  // The four-team bracket: the match waiting for a winner is named as its cell is ("Semifinal 2", "3rd place").
  const f = g.format === 'tournament' && !b ? fourLive(g) : null;
  if (f) return nowMatchBoard(ctx, g, f.pair, FOUR_NAMES[f.key], f.next);
  if (g.liveRankings && tallyInProgress(g)) {
    const ranked = tallyRankLive(g);
    return {
      kind: 'tally', ranked: ctx.points, inCount: ranked.length, total: state.teams.length,
      cap: ranked.length + ' of ' + state.teams.length + ' in',
      rows: ranked.map((e, i) => Object.assign({ team: e.id, name: teamName(e.id), v: formatScore(g, e.v), mine: e.id === ctx.myTeam }, ctx.points ? { place: i + 1 } : {})),
    };
  }
  return null;
}

// The 'match' board of a bracket game: the pair playing now (with the live tally when the game keeps one) and the pair after it.
function nowMatchBoard(ctx, g, pair, phase, nextPair) {
  let cap = phase;
  let scores = null;
  if (pair && g.ladderScoring) {
    const l = getLadderMatch(g, pair[0], pair[1]);
    scores = [l.a, l.b];
    cap += ' · First to ' + (g.ladderScoring.target || 21);
  } else if (pair && g.liveTracker) {
    const l = getLiveMatch(g, pair[0], pair[1]);
    scores = [l.hr[pair[0]] || 0, l.hr[pair[1]] || 0];
    const innings = g.liveTracker.innings || 3;
    if (innings > 1) cap += ' · ' + (g.liveTracker.periodLabel || 'Inning') + ' ' + l.inning + ' of ' + innings;
    if (g.liveTracker.outs) cap += ' · ' + outsLabel(l.outs);
  }
  return {
    kind: 'match', cap,
    sides: pair ? pair.map((id, i) => ({ team: id, name: teamName(id), v: scores ? scores[i] : null, mine: id === ctx.myTeam })) : [],
    next: nextPair || null,
  };
}

// The four-team bracket (state.brackets4[gid] = { m: { s1, s2, third, final } }) as four cells in the order of play, read through
// fourRead (every team a roster id; third place is the two semifinal losers and the final the two winners until a match records
// its own); null while no bracket exists or this build cannot read the one that does. While a recorded match disagrees with the
// semifinals it came from (`hold`) no cell is live and no team is told what is next: a director is settling it.
function nowBracket4(ctx, g) {
  const ids = teamIds();
  const v = fourRead(state.brackets4 && state.brackets4[g.id], ids);
  if (!v) return null;
  const m = v.m;
  const hold = !!v.recheck;
  const tbd = { third: ['Semifinal 1 loser', 'Semifinal 2 loser'], final: ['Semifinal 1 winner', 'Semifinal 2 winner'] };
  const live = hold ? undefined : FOUR_ORDER.find((k) => !m[k].winner);
  // While a result is being checked the picture must never show an impossible chain (Semifinal 1 "Blue won" beside a final
  // that Blue also plays): the questioned match says Checking and shows no winner, and the side of the 3rd place match and the
  // final that comes from it is the dashed "Semifinal 1 winner / loser" again, as it was before that semifinal was played.
  const checking = hold ? (v.recheck.semi || v.recheck.match) : '';
  const fromSemi = (k, j) => (k === 'third' || k === 'final' ? (j === 0 ? 's1' : 's2') : '');
  const cells = FOUR_ORDER.map((k) => {
    const c = m[k];
    const isCheck = k === checking;
    const other = (j) => {
      // The side that comes from the semifinal nobody questions keeps its team (its winner for the final, its loser for 3rd place).
      const s = m[fromSemi(k, j)];
      if (!s || !s.winner) return '';
      return k === 'final' ? s.winner : (s.winner === s.a ? s.b : s.a);
    };
    const settled = hold && v.recheck.semi && (k === 'third' || k === 'final');
    return {
      key: 'b4-' + k, slot: k, name: FOUR_NAMES[k],
      status: isCheck ? 'check' : settled ? 'todo' : c.winner ? 'done' : k === live ? 'live' : 'todo',
      next: !!live && FOUR_ORDER[FOUR_ORDER.indexOf(live) + 1] === k,
      teams: [0, 1].map((j) => {
        const id = settled ? (fromSemi(k, j) === v.recheck.semi ? '' : other(j)) : [c.a, c.b][j];
        const shown = !isCheck && !settled;
        return {
          team: id, name: id ? teamName(id) : '', tbd: id ? '' : (tbd[k] ? tbd[k][j] : 'To be decided'),
          won: shown && !!id && c.winner === id, lost: shown && !!id && !!c.winner && c.winner !== id, mine: !!id && id === ctx.myTeam,
        };
      }),
    };
  });
  // The line for MY team, from the bracket's own order (never "the last game today": the block can hold other games).
  let note = null;
  const me = ctx.myTeam;
  if (me && !hold && !m.final.winner) {
    const word = nowTeamWord(me);
    const inSemi = ['s1', 's2'].find((k) => m[k].a === me || m[k].b === me);
    const thirdLeft = !m.third.winner;
    if (inSemi && !m[inSemi].winner) note = { lead: word, rest: ' plays in ' + FOUR_NAMES[inSemi].toLowerCase() };
    else if (inSemi && m[inSemi].winner === me) note = { lead: word, rest: ' plays in the final next' + (thirdLeft ? ' · 3rd place match first' : '') };
    else if (inSemi && thirdLeft) note = { lead: word, rest: ' plays the 3rd place match next' };
  }
  return { cells, hold, note: note ? Object.assign({ team: me, mine: true }, note) : null };
}

// One game as a row of the Now card (and, later, the Games tab).
function nowGameRow(ctx, g) {
  const status = gameRowStatus(g, ctx.ms);
  const row = {
    key: 'g-' + g.id, id: g.id, name: g.name, emoji: safeEmoji(g.emoji, ''), where: nowPlaceWord(g.location), format: g.format || '',
    status, next: false, mine: false, line: '', podium: null, board: null, score: null,
  };
  if (status === 'done') {
    const r = state.results[g.id];
    // "finished 10:31": the run sheet's bare clock (§8.7), so a narrow row never leaves "AM" on a line of its own.
    const at = r && typeof r.savedAt === 'string' ? messageClock(r.savedAt, true).replace(/\s*[AP]M$/i, '') : '';
    row.line = at ? 'finished ' + at : 'finished';
    row.podium = nowPodium(ctx, g);
    row.mine = !!(row.podium && row.podium.some((c) => c.mine));
  } else if (status === 'live') {
    row.board = nowLiveBoard(ctx, g);
    const b4 = row.board ? null : nowBracket4(ctx, g);
    const cell = b4 ? b4.cells.find((c) => c.status === 'live') : null;
    // ONE live line per format, the same on Now and Games: the round ("Round 1"; the board under it carries the inning and the
    // target) and the count ("2 of 6 teams in"; the board's head then just says what it is), never the same fact twice.
    if (row.board && row.board.kind === 'match') {
      row.line = String(row.board.cap).split(' · ')[0];
      row.mine = row.board.sides.some((s) => s.mine);
    } else if (row.board && row.board.kind === 'tally') {
      row.line = row.board.inCount + ' of ' + row.board.total + ' teams in';
      row.mine = row.board.rows.some((r) => r.mine);
    } else if (cell) {
      row.line = cell.name; // the four-team bracket's match under way, named as its cell is: "Semifinal 2", "3rd place"
      row.mine = cell.teams.some((t) => t.mine);
    } else row.line = 'Being scored';
  }
  if (ctx.director && status !== 'done') {
    // A bracket's current round that has my own team in it is another director's to score (canScoreRound); a tally or a
    // podium game is not guarded at the game level.
    let pair = status === 'live' && row.board && row.board.kind === 'match' ? row.board.sides.map((s) => s.team) : [];
    if (!pair.length && status === 'live' && !row.board) {
      const b4 = nowBracket4(ctx, g);
      const cell = b4 ? b4.cells.find((c) => c.status === 'live') : null;
      if (cell) pair = cell.teams.map((t) => t.team).filter(Boolean);
    }
    row.score = { gold: false, why: pair.length && blockedByOwnTeam(...pair) ? 'Your team plays · another director scores' : null };
  }
  return row;
}

// A games block's body: live first, then not started in the block's own order, then done.
function nowGamesBody(ctx, nb) {
  const games = gamesForBlock(ctx.dow, nb.b);
  const rows = games.map((g) => nowGameRow(ctx, g));
  const rank = { live: 0, todo: 1, done: 2 };
  const ordered = rows.map((r, i) => ({ r, i })).sort((a, b) => (rank[a.r.status] - rank[b.r.status]) || (a.i - b.i)).map((x) => x.r);
  const firstTodo = ordered.find((r) => r.status === 'todo');
  if (firstTodo) firstTodo.next = true;
  // ONE gold Score (§8.1 rule 3: gold is the single primary action): the live game's, else the one up next; the rest are outlined.
  const lead = ordered.find((r) => r.status === 'live') || firstTodo;
  ordered.forEach((r) => { if (r.score) r.score.gold = r === lead; });
  const left = ordered.filter((r) => r.status !== 'done').length;
  const b4 = games.map((g) => nowBracket4(ctx, g)).find(Boolean) || null;
  return {
    rows: ordered, total: ordered.length, stillToScore: ctx.director ? left : null,
    doubled: games.some((g) => g.messtival), bracket4: b4,
    // ONE game named like its block (senior's Legacy Game): the card IS that game (mockup 13), so the renderer folds its row into
    // the card instead of repeating the name under the title.
    solo: games.length === 1 && nowSameName(games[0].name, nb.head),
  };
}

// ── running over (§3.1) ──────────────────────────────────────────────
function nowOverrunRec() {
  const o = state.meta && state.meta.overrun;
  const until = o && typeof o === 'object' ? Number(o.until) : NaN;
  return o && typeof o.key === 'string' && Number.isFinite(until) ? { key: o.key, until } : null;
}
// The minute at which a games block can no longer be held over: 45 minutes past its end, never past the start of the next one.
function nowGamesCap(blocks, nb) {
  const nextGames = blocks.find((x) => x !== nb && x.kind === 'games' && !x.noTime && x.start >= nb.end);
  const cap = nb.end + NOW_OVERRUN_MAX_MIN;
  return nextGames ? Math.min(cap, nextGames.start) : cap;
}
// The games block that still holds the card although its end has passed: a game in it is Live, or a director said "Still on
// this" (state.meta.overrun, until a server time) — within the cap. The latest-ending one when two qualify.
function nowHeld(ctx, blocks) {
  const rec = nowOverrunRec();
  let best = null;
  blocks.forEach((nb) => {
    if (nb.kind !== 'games' || nb.noTime) return;
    const cap = nowGamesCap(blocks, nb);
    if (!(ctx.minutes >= nb.end && ctx.minutes < cap)) return;
    const live = gamesForBlock(ctx.dow, nb.b).some((g) => gameRowStatus(g, ctx.ms) === 'live');
    const said = !!rec && rec.key === ctx.dow + ':' + nb.id && ctx.ms < rec.until;
    if (!live && !said) return;
    if (!best || nb.end > best.nb.end) best = { nb, cap, by: live ? 'live' : 'director' };
  });
  return best;
}
// The schedule item Now is on at this minute, for a director's ⚡ quick game (Step 21): the very pick the Now card makes — the item
// under way, or a games item that has run over while a game is still live or a director said "Still on this" — so a quick game
// lands where the card says the camp is. { dow, i, b, kind, held } or null between items. `b` is the accessor's block (setupRichOf
// reaches the rich one) and `i` its place in scheduleForDow(dow), as nowModel's `block.i`. Pure.
function nowCurrentBlock(opts) {
  const ctx = nowCtx(opts);
  const blocks = nowBlocks(ctx.dow, ctx);
  const held = nowHeld(ctx, blocks);
  const cur = held ? held.nb : nowFind(blocks, ctx.minutes);
  return cur ? { dow: ctx.dow, i: cur.i, b: cur.b, kind: cur.kind, held: !!held } : null;
}
// The director's "Still on this · +10 min": offered while a games block has ended inside its window with a game still to score
// (it can be offered on the NEXT block's card — the clock has already moved on), or while one is held by a director's word.
// { key, name, can, held, cap, nextUntil } or null. `nextUntil` (server ms) moves every second: it is for the tap
// (nowHoldOverrun), never part of the picture (the model leaves it out, so the picture is the same all minute).
function nowHoldOffer(ctx, blocks, held) {
  if (!ctx.director) return null;
  let nb = held ? held.nb : null;
  if (held && held.by === 'live') return null; // something is live: nothing to ask for
  if (!nb) {
    blocks.forEach((x) => {
      if (x.kind !== 'games' || x.noTime) return;
      const cap = nowGamesCap(blocks, x);
      if (ctx.minutes >= x.end && ctx.minutes < cap && (!nb || x.end > nb.end)) nb = x;
    });
    if (!nb) return null;
    if (!gamesForBlock(ctx.dow, nb.b).some((g) => gameRowStatus(g, ctx.ms) !== 'done')) return null;
  }
  const cap = nowGamesCap(blocks, nb);
  const key = ctx.dow + ':' + nb.id;
  const rec = nowOverrunRec();
  const eff = rec && rec.key === key && rec.until > ctx.ms ? rec.until : ctx.ms;
  const effMin = ctx.minutes + Math.ceil((eff - ctx.ms) / 60000); // the minute the hold reaches, so "can" holds still all minute
  return {
    key, name: nb.head, can: effMin < cap, held: !!held, cap,
    nextUntil: Math.min(eff + NOW_HOLD_STEP_MS, ctx.ms + (cap - ctx.minutes) * 60000),
  };
}
// A director taps "Still on this · +10 min". Display only: nothing but this one meta field is written, so no other block
// moves and two directors cannot clobber anything else (meta is diffed per field). Not scoreboard activity: no touchData.
function nowHoldOverrun(opts) {
  if (!canEdit()) return false;
  const ctx = nowCtx(opts);
  const blocks = nowBlocks(ctx.dow, ctx);
  const offer = nowHoldOffer(ctx, blocks, nowHeld(ctx, blocks));
  if (!offer || !offer.can) return false;
  if (!state.meta || typeof state.meta !== 'object') state.meta = {};
  state.meta.overrun = { key: offer.key, until: offer.nextUntil };
  saveState();
  renderAll();
  return true;
}

// ── personalisation ──────────────────────────────────────────────────
// The teams on cleanup after a meal block, [{ team, mine }] ([] for a block that is no meal, a day off the rota or a meal with
// nobody on it — senior's empty rota says nothing).
function nowDuty(ctx, nb) {
  if (!nb.meal || ctx.hidden.cleanup || !cleanupOnRota(ctx.dow)) return []; // Meal cleanup switched off: not a line, not a moment
  return cleanupTeams(ctx.dow, nb.meal).map((id) => ({ team: id, mine: id === ctx.myTeam }));
}
// The team a counselor's NAME belongs to ('' when nobody's roster has it): the printed roster and the member directory, both
// compared through the one spelling per counselor.
function nowTeamOfName(name) {
  const c = canonicalCounselorName(name);
  return teamIds().find((id) => teamRoster(id).some((n) => canonicalCounselorName(n) === c) || teamStaffNames(id).some((n) => canonicalCounselorName(n) === c)) || '';
}
// Where I am during one elective block: { station, emoji, onBreak, with: [{ name, team }] }, or null when this phone's
// identity is on no elective sheet that day (a counselor not on it, a parent) — which says nothing, not "On break".
function nowStationAt(ctx, nb) {
  if (nb.kind !== 'elective' || typeof nb.slot !== 'number' || !electiveMeOnDay(ctx.dow)) return null;
  const rows = electivesFor(ctx.dow)[nb.slot] || [];
  const mine = rows.find((r) => electiveRowHasMe(r));
  if (!mine) return { station: '', emoji: '☕', onBreak: true, with: [] };
  const keys = mine[2] || [];
  return {
    station: mine[0], emoji: safeEmoji(stationEmoji(mine[0]), '🌟'), onBreak: false,
    with: (mine[1] || []).filter((n, i) => !electiveIsMe(n, keys[i] || '')).map((n) => ({ name: n, team: nowTeamOfName(n) })),
  };
}

// A run row (Up next, Later today, Then, Tomorrow): flat, time · emoji · title, with a sub only when it says something
// personal. `sub` = { text, mine } — mine means the renderer bolds "Your team".
function nowRow(ctx, nb) {
  const dish = nb.kind === 'meal' ? mealInfo(ctx.dow, nb.b) : null;
  const row = {
    key: 'b-' + nb.id, id: nb.id, kind: nb.kind, start: nb.start, time: nb.noTime ? '' : schedClock(nb.start, false),
    noTime: nb.noTime, emoji: dish && dish.emoji ? safeEmoji(dish.emoji, nb.emoji) : nb.emoji, title: nb.head,
    dish: dish ? { emoji: safeEmoji(dish.emoji, ''), text: String(dish.dish) } : null, sub: null, mine: false,
  };
  if (nb.kind === 'meal') {
    const duty = nowDuty(ctx, nb);
    if (duty.some((d) => d.mine)) { row.sub = { text: 'Your team is on cleanup', mine: true }; row.mine = true; }
    else if (duty.length) row.sub = { text: nowJoinNames(duty.map((d) => nowTeamWord(d.team))) + ' on cleanup', mine: false };
  } else if (nb.kind === 'elective') {
    // The person's own answer is the title (mockup 03, §8.1 rule 1): their station with its emoji, the slot and who they are with
    // under it — or "Break · Elective 3 · you're free". Someone on no elective sheet keeps the plain "Elective 2" row.
    const st = nowStationAt(ctx, nb);
    if (st && st.onBreak) {
      row.title = 'Break';
      row.emoji = '';
      row.sub = { text: nb.head + ' · you’re free', mine: false };
      row.mine = true;
    } else if (st) {
      row.title = st.station;
      row.emoji = st.emoji;
      row.sub = { text: nb.head + (st.with.length ? ' · with ' + nowJoinNames(st.with.map((w) => w.name)) : ''), mine: false };
      row.mine = true;
    }
  } else if (nb.kind === 'games') {
    const games = gamesForBlock(ctx.dow, nb.b);
    if (games.length) {
      let text = games[0].name + (games.length > 1 ? ' and ' + (games.length - 1) + ' more' : '');
      // "Foxes play first": my team's next matchup is the first one of a bracket game in this block.
      const first = ctx.myTeam ? games.find((g) => g.format === 'tournament' && !(state.results && state.results[g.id]) && upcomingMatchups(g)[0] && (upcomingMatchups(g)[0].aId === ctx.myTeam || upcomingMatchups(g)[0].bId === ctx.myTeam)) : null;
      if (first) { text += ' · ' + nowTeamWord(ctx.myTeam) + ' play first'; row.mine = true; }
      row.sub = { text, mine: !!first };
    }
  } else if (nb.tail) row.sub = { text: nowTailText(nb.tail), mine: false };
  return row;
}

// ── the kinds' bodies ────────────────────────────────────────────────
// A verse still saying the seed's "to be announced" with no reference (senior's placeholder) is NOT scripture: `tba` makes the renderer
// say "Today's verse hasn't been added yet" in plain words (Award points and the Verses screen call it missing too). The card stays
// Bible study's, so a director keeps the verse points. A theme titled with the camp's own name ("Senior Camp") names nothing.
function nowVerse(dow, ctx) {
  if (ctx && ctx.hidden.verse) return null; // Memory verse switched off: Bible study is a plain card
  const v = verseFor(dow);
  if (!v || !(String(v.text || '').trim() || String(v.ref || '').trim())) return null;
  const tba = (o) => /\bto be announced\b/i.test(String(o.text || '')) && !String(o.ref || '').trim();
  const t = verseTheme();
  const tTitle = t && String(t.title || '').trim().toLowerCase() !== String(CAMP.label || '').trim().toLowerCase() ? String(t.title || '') : '';
  const theme = t && (tTitle || String(t.ref || '').trim()) ? { title: tTitle, ref: String(t.ref || '') } : null;
  return { text: String(v.text || ''), ref: String(v.ref || ''), video: safeVideoUrl(v.video), theme, tba: tba(v) };
}
// The identity ask's choices: the team's counselors (the member directory once it has some, else the printed roster).
function nowIdentityNames(teamId) {
  const staff = teamStaffNames(teamId);
  return (staff.length ? staff : teamRoster(teamId)).slice();
}
// An elective block: my station (or break), the ask when this phone has no identity yet, or every station. `then` = the next
// three blocks that are not just preparing, an elective one personalised.
function nowElectiveBody(ctx, nb, blocks) {
  const me = electiveMeOnDay(ctx.dow);
  const st = nowStationAt(ctx, nb);
  const mode = me ? (st && !st.onBreak ? 'station' : 'break')
    : !ctx.director && ctx.myTeam && ctx.identity === undefined ? 'ask' : 'all';
  const rows = electivesFor(ctx.dow)[nb.slot] || [];
  const stations = rows.map((r) => {
    const keys = r[2] || [];
    return {
      key: 'st-' + String(r[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-'), station: r[0], emoji: safeEmoji(stationEmoji(r[0]), '🌟'),
      people: (r[1] || []).map((n, i) => ({ name: n, mine: electiveIsMe(n, keys[i] || '') })), mine: electiveRowHasMe(r),
    };
  });
  const breakNames = electiveBreakKids(ctx.dow, nb.slot);
  const after = blocks.slice(nb.i + 1).filter((x) => !/^prepare\b/i.test(x.head)).slice(0, 3);
  return {
    mode, station: mode === 'station' ? st : null, stations, onBreak: breakNames.map((n) => ({ name: n, mine: electiveIsMe(n, '') })),
    count: { stations: stations.length, onBreak: breakNames.length },
    ask: mode === 'ask' ? { names: nowIdentityNames(ctx.myTeam) } : null,
    then: mode === 'station' || mode === 'break' ? after.map((x) => nowRow(ctx, x)) : [], // only a personal card draws "Then"
  };
}

// ── moments (§3.3): the cleanup panel after a meal, the verse points in Bible study ──
function nowCleanupMoment(ctx, blocks) {
  for (const nb of blocks) {
    if (!nb.meal || nb.noTime) continue;
    if (!(ctx.minutes >= nb.end && ctx.minutes < nb.end + NOW_CLEANUP_WINDOW_MIN)) continue;
    const duty = nowDuty(ctx, nb);
    if (!duty.length) continue;
    // The keys, their points and the lock are a director's WRITER tab's (as the verse moment's are): in a director's second,
    // view-only tab (`canEdit()` false) every team would read "another director gives these", so it shows only whose turn it is.
    const keys = ctx.points && ctx.director;
    const earned = keys ? cleanupEarned(ctx.dow, nb.meal) : {};
    const moment = {
      kind: 'cleanup', dow: ctx.dow, meal: nb.meal, title: nb.meal + ' cleanup', until: nb.end + NOW_CLEANUP_WINDOW_MIN,
      teams: duty.map((d) => {
        const t = { key: 'c-' + d.team, team: d.team, name: teamName(d.team), mine: d.mine, who: counselorName(d.team) };
        if (keys) { t.locked = !canScoreRound(d.team); t.pts = earned[d.team] || 0; }
        return t;
      }),
    };
    // The keys are a CONFIRMED director's (Award points' rule): a counselor's, a preview's, a hinted director's and a view-only
    // tab's moment has no such field at all, only whose turn it is.
    if (keys) { moment.secret = true; moment.max = 3; }
    return moment;
  }
  return null;
}
// Bible study's verse points: a CONFIRMED director's alone (a counselor's model has no verse moment at all).
function nowVerseMoment(ctx, nb) {
  if (!ctx.points || !ctx.director || nb.kind !== 'bible') return null;
  const earned = versePointsByDay()[ctx.dow] || { raw: {}, effective: {} };
  return {
    kind: 'verse', dow: ctx.dow, title: 'Verse points', until: nb.end, secret: true, max: 5, mult: inDoubleBonusWindow() ? 2 : 1,
    teams: teamIds().map((id) => ({
      key: 'v-' + id, team: id, name: teamName(id), mine: id === ctx.myTeam, locked: !canScoreRound(id),
      pts: earned.raw[id] || 0, given: earned.effective[id] || 0,
    })),
  };
}

// ── the notice (a posted message with structure: the send-off cleanup plan) ──
function nowNoticeData(ctx, notice) {
  const n = notice || noticeBoard(); // a notice that is not the live one (Tell everyone's and the builder's previews) must already be whole
  const ids = teamIds();
  const yours = ctx.myTeam ? n.zones.find((z) => z.teamId === ctx.myTeam) || null : null; // from THIS notice (a preview draws one that is not live)
  return {
    eyebrow: n.eyebrow, title: n.title, sub: n.sub, signoff: n.signoff,
    yours: yours && ids.includes(yours.teamId) ? { team: yours.teamId, place: yours.place, note: yours.note } : null,
    zones: n.zones.filter((z) => ids.includes(z.teamId)).map((z) => ({ key: 'z-' + z.teamId, team: z.teamId, place: z.place, note: z.note, mine: z.teamId === ctx.myTeam })),
    steps: n.steps.filter((s) => s.when || s.items.length).map((s) => ({ emoji: safeEmoji(s.emoji, ''), when: s.when, items: s.items.slice() })),
  };
}

// ── the messages strip (§3.2) ────────────────────────────────────────
// In order: the posted notice (unless it IS the card), the join bar (a director's), then banners newest first — the synced
// announcements this phone has not dismissed and the Announcements-channel chat messages of the last 15 minutes. A renderer
// caps the strip to a third of the screen and sends the rest to a sheet; this is the whole list.
function nowMessages(ctx, cardKind) {
  const out = [];
  if (cardKind !== 'notice' && noticePosted()) {
    const d = nowNoticeData(ctx);
    out.push({ kind: 'notice', key: 'notice', title: d.title || d.eyebrow || 'Notice', sub: d.sub, yours: d.yours, canTakeDown: ctx.director });
  }
  const reqs = ctx.director ? joinBarRequests() : [];
  if (reqs.length) out.push({ kind: 'join', key: 'join', n: reqs.length, text: reqs.length === 1 ? reqs[0].name + ' is asking to join' : reqs.length + ' people are asking to join' });
  const fromChat = typeof chatAnnouncementBanners === 'function' ? chatAnnouncementBanners() : [];
  activeAnnouncements().concat(fromChat).sort((a, b) => String(b.at).localeCompare(String(a.at))).forEach((a) => {
    out.push({
      kind: a.fromChat ? 'chat' : 'banner', key: 'ann-' + a.id, id: a.id, text: String(a.text), at: a.at, by: a.by || '',
      canRemove: ctx.director && !a.fromChat,
    });
  });
  return out;
}

// ── Still to do today (§3.5, directors) ──────────────────────────────
// What the day's moments left undone, oldest first: a game whose block has ended with no result, a meal whose cleanup window
// is over with no points for a team the director may score, Bible study with a team not given verse points, and the people
// waiting to join. Points are read only for a CONFIRMED director (the guarded readers say nothing to anyone else).
function nowTodo(ctx, blocks, shown) {
  if (!ctx.director) return { rows: [], more: 0 };
  const rows = [];
  blocks.forEach((nb) => {
    if (nb.noTime) return;
    if (ctx.minutes >= nb.end) {
      gamesForBlock(ctx.dow, nb.b).forEach((g) => {
        if (gameRowStatus(g, ctx.ms) === 'done' || (shown && shown.has(g.id))) return; // a game the card above is holding is not listed twice
        rows.push({ at: nb.end, key: 'todo-game-' + g.id, todo: 'game', ref: g.id, title: g.name, sub: 'Not scored yet' });
      });
    }
    if (!ctx.points || !competitionDows().includes(ctx.dow)) return;
    if (nb.meal && ctx.minutes >= nb.end + NOW_CLEANUP_WINDOW_MIN) {
      const earned = cleanupEarned(ctx.dow, nb.meal);
      const lacking = nowDuty(ctx, nb).map((d) => d.team).filter((id) => !(earned[id] > 0) && canScoreRound(id));
      if (lacking.length) {
        rows.push({ at: nb.end + NOW_CLEANUP_WINDOW_MIN, key: 'todo-cleanup-' + ctx.dow + '-' + nb.meal.toLowerCase(), todo: 'cleanup', ref: nb.meal,
          title: nb.meal + ' cleanup points', sub: nowJoinNames(lacking.map(nowTeamWord)) + ' · Not given yet' });
      }
    } else if (nb.kind === 'bible' && ctx.minutes >= nb.end && nowVerse(ctx.dow, ctx)) {
      const raw = (versePointsByDay()[ctx.dow] || { raw: {} }).raw;
      const all = teamIds();
      const lacking = all.filter((id) => !(raw[id] > 0) && canScoreRound(id));
      if (lacking.length) {
        const given = all.filter((id) => raw[id] > 0).length;
        rows.push({ at: nb.end, key: 'todo-verse-' + ctx.dow, todo: 'verse', ref: String(ctx.dow), title: 'Verse points',
          sub: given ? given + ' of ' + all.length + ' teams given' : 'Not given yet' });
      }
    }
  });
  rows.sort((a, b) => a.at - b.at);
  const reqs = joinBarRequests();
  if (reqs.length) rows.push({ at: Infinity, key: 'todo-join', todo: 'join', ref: '', title: reqs.length === 1 ? reqs[0].name + ' is asking to join' : reqs.length + ' people are asking to join', sub: 'People' });
  return { rows: rows.slice(0, NOW_TODO_MAX).map((r) => ({ key: r.key, todo: r.todo, ref: r.ref, title: r.title, sub: r.sub })), more: Math.max(0, rows.length - NOW_TODO_MAX) };
}

// ── the clock part and the wake-up list ──────────────────────────────
// What moves with the clock alone, from the model's `basis` ({ start, end, noTime, over, upcoming }): minutes left (or minutes
// over), the hairline's 0–1, minutes until the next block starts. The tick recomputes only this between wake-ups.
function nowClockOf(basis, minutes) {
  const out = { left: null, over: 0, progress: null, untilNext: null };
  if (!basis) return out;
  if (basis.upcoming != null) out.untilNext = Math.max(0, basis.upcoming - minutes);
  if (basis.end == null || basis.noTime) return out;
  if (basis.over) { out.over = Math.max(0, minutes - basis.end); out.progress = 1; return out; }
  out.left = Math.max(0, basis.end - minutes);
  out.progress = basis.end > basis.start ? Math.max(0, Math.min(1, (minutes - basis.start) / (basis.end - basis.start))) : null;
  return out;
}
// The minutes (today, after now) at which the picture can change: every block's start and end, the end of a meal's cleanup
// window, the cap of a games block's hold, each full hour (the rain hint reads the hour), the morning threshold, midnight,
// and the minute a director's "Still on this" runs out. A superset is harmless (the tick recomputes and the renderer
// compares); a missing minute is a stale card, which tests/now-model.test.js hunts minute by minute.
function nowWake(ctx, blocks) {
  const set = new Set([NOW_MORNING_FROM_MIN, 1440]);
  for (let h = 1; h <= 24; h++) set.add(h * 60);
  blocks.forEach((nb) => {
    set.add(nb.start);
    set.add(nb.end);
    if (nb.meal && !nb.noTime) set.add(nb.end + NOW_CLEANUP_WINDOW_MIN);
    if (nb.kind === 'games' && !nb.noTime) set.add(nowGamesCap(blocks, nb));
  });
  const rec = nowOverrunRec();
  if (rec && rec.until > ctx.ms) set.add(ctx.minutes + Math.ceil((rec.until - ctx.ms) / 60000));
  return [...set].filter((m) => m > ctx.minutes).sort((a, b) => a - b);
}

// ── the picture ──────────────────────────────────────────────────────
// A live reveal wins the top of the tab (reveal-ui.js paints the mirror itself; the renderer puts the rest away). Nothing of
// the reveal's content is read here.
function nowReveal() {
  return typeof revealLiveView === 'function' && typeof confirmedReveal !== 'undefined' && revealLiveView() ? { live: true } : null;
}
function nowCard(kind, o) {
  return Object.assign({ kind, k: 'Now', when: '', tag: '', title: '', emoji: '', status: '', sub: null, lead: null, over: false, notes: [], hold: null, down: false }, o);
}
// The first three blocks of a weekday as run rows (the morning card's "Today", the night card's "Tomorrow").
function nowFirstRows(ctx, dow) {
  const tctx = Object.assign({}, ctx, { dow });
  return nowBlocks(dow, tctx).slice(0, 3).map((nb) => nowRow(tctx, nb));
}
// Up next = the first block starting at or after the card's block ends (today's rule: it keeps Tuesday's overlapping movie night
// right); with no card block, the first block still to start. Later today = the three after it (all of Sunday's run sheet).
// A games block HELD past its end (a game still Live, or a director's "Still on this") may have run into the block after it: Up next is
// then the first block after it that has not ended, and one already under way says so instead of passing for upcoming.
function nowNextLater(ctx, blocks, cur, upcoming, held) {
  const after = held ? nowAfterHeld(ctx, blocks, cur) : cur ? blocks.find((x) => x.start >= cur.end) || null : upcoming;
  const rest = after ? blocks.slice(blocks.indexOf(after) + 1) : [];
  const next = after ? nowRow(ctx, after) : null;
  if (next && held && after.start <= ctx.minutes) next.sub = { text: next.sub && next.sub.text ? 'Already started · ' + next.sub.text : 'Already started', mine: !!(next.sub && next.sub.mine) };
  return { next, later: (ctx.dow === 0 ? rest : rest.slice(0, NOW_LATER_MAX)).map((x) => nowRow(ctx, x)) };
}
function nowAfterHeld(ctx, blocks, nb) {
  return blocks.slice(blocks.indexOf(nb) + 1).find((x) => x.end > ctx.minutes) || null;
}
// Sunday's welcome for a counselor on a team: "Meet your team at Team assignments · 5:30 · Chapel Lawn".
function nowWelcome(ctx, blocks) {
  if (!ctx.myTeam) return null;
  const meet = blocks.find((x) => /^team assignments\b/i.test(x.head));
  return { team: ctx.myTeam, name: teamName(ctx.myTeam), meet: meet ? { title: meet.head, time: schedClock(meet.start, false), place: meet.place } : null };
}
function nowChampion() {
  return typeof revealChampionLine === 'function' ? revealChampionLine() : null;
}

// The card of a block (the clock's, or the games block that is running over).
function nowBlockCard(ctx, blocks, nb, held) {
  let kind = nb.kind;
  const verse = kind === 'bible' ? nowVerse(ctx.dow, ctx) : null;
  if (kind === 'bible' && !verse) kind = 'activity';
  if (kind === 'bedtime' && nb.noTime) kind = 'night';
  else if (kind === 'sendoff' && nb.noTime) kind = 'over';
  else if (kind === 'sendoff' && noticePosted()) kind = 'notice';
  const card = nowCard(kind, {
    k: held ? 'Running over' : kind === 'night' ? 'Tonight' : kind === 'over' ? 'Today' : 'Now', over: !!held,
    when: nb.noTime ? '' : schedClock(nb.start, false) + '–' + schedClock(nb.end, false), title: nb.head, emoji: nb.emoji, // "10:00–11:45" (§8.7)
  });
  let body = {};
  if (kind === 'games') {
    body = nowGamesBody(ctx, nb);
    const solo = body.solo ? body.rows[0] : null;
    if (held) {
      const after = nowAfterHeld(ctx, blocks, nb); // the block that is next in the day, which may already have begun
      card.sub = 'Still going' + (after ? ' · ' + after.head + (after.start > ctx.minutes ? ' at ' + schedClock(after.start, false) : ' has started') : '');
    }
    else if (solo) card.sub = nowGameKindLine(solo); // the card's own Score (a director's) says what is left
    else if (ctx.director && body.stillToScore) card.sub = nowStillToScoreText(body.stillToScore, body.total);
    if (solo && solo.status !== 'todo') card.status = solo.status; // the Live / Done tag rides the title
  } else if (kind === 'elective') {
    body = nowElectiveBody(ctx, nb, blocks);
    card.tag = 'Elective ' + ((Number(nb.slot) || 0) + 1);
    if (body.mode === 'station' || body.mode === 'break') card.lead = { text: 'Your station', change: ctx.identity || null };
    if (body.mode === 'station') {
      card.title = body.station.station;
      card.emoji = body.station.emoji;
      card.sub = body.station.with.length ? 'with ' + nowJoinNames(body.station.with.map((w) => w.name)) : null;
    } else if (body.mode === 'break') {
      card.title = "You're on break";
      card.emoji = '☕';
    }
  } else if (kind === 'meal') {
    const dish = mealInfo(ctx.dow, nb.b);
    body = { dish: dish ? { emoji: safeEmoji(dish.emoji, ''), text: String(dish.dish) } : null, duty: nowDuty(ctx, nb) };
    if (body.dish && body.dish.emoji) card.emoji = body.dish.emoji;
  } else if (kind === 'bible') {
    body = { verse };
  } else if (kind === 'meeting') {
    const names = nb.teams.map(nowTeamWord);
    body = { teams: nb.teams.slice(), place: nb.place, youMeet: !!ctx.myTeam && nb.teams.includes(ctx.myTeam) };
    card.sub = [nb.place, names.length ? nowJoinNames(names) : nowTailText(nb.tail)].filter(Boolean).join(' · ') || null;
  } else if (kind === 'arrival') {
    body = { welcome: nowWelcome(ctx, blocks) };
    card.sub = nowTailText(nb.tail) || nb.place || null;
  } else if (kind === 'night') {
    card.title = 'Lights out';
    body = { heading: 'Tomorrow', rows: nowFirstRows(ctx, (ctx.dow + 1) % 7) };
  } else if (kind === 'over') {
    card.title = 'See you next year';
    body = { champion: nowChampion() };
  } else if (kind === 'notice') {
    body = { notice: nowNoticeData(ctx) };
    card.title = body.notice.title || nb.head;
    card.emoji = '';
    card.down = ctx.director;
  } else card.sub = nowTailText(nb.tail) || nb.place || null; // worship, activity, bedtime: the label's note
  card.notes = [];
  if (kind === 'games' && body.doubled) card.notes.push({ kind: 'double', text: 'Double points until the end of Friday' });
  const rain = kind === 'night' || kind === 'over' ? null : upcomingRain(ctx.minutes, ctx.date);
  if (rain) card.notes.push({ kind: 'rain', text: rain.precip + '% chance of rain ' + rain.when });
  if (kind === 'games' && body.bracket4 && body.bracket4.note) card.notes.push(Object.assign({ kind: 'team' }, body.bracket4.note));
  // A result being checked: said in the slot the team's line sits in, so the cells are never left to explain themselves.
  else if (kind === 'games' && body.bracket4 && body.bracket4.hold) card.notes.push({ kind: 'hold', text: FOUR_HOLD_NOTE });
  if (kind === 'meal') {
    body.duty.forEach((d) => card.notes.push({ kind: 'team', team: d.team, mine: d.mine, lead: d.mine ? 'Your team' : teamName(d.team), rest: (d.mine ? ' is' : '') + ' on cleanup after ' + nb.meal.toLowerCase() }));
  }
  return { card, body, kind, basis: { start: nb.start, end: nb.end, noTime: nb.noTime || kind === 'night' || kind === 'over', over: !!held, upcoming: null } };
}

// The card when no block holds this minute: the arrival countdown (Sunday before the first block), the morning, the night
// (before dawn, or after the day's last block), or the gap between two blocks.
function nowGapCard(ctx, blocks, upcoming) {
  const first = blocks[0];
  const lastEnd = Math.max(...blocks.map((x) => x.end));
  const basis = { start: null, end: null, noTime: true, over: false, upcoming: upcoming ? upcoming.start : null };
  if (ctx.minutes < first.start) {
    if (ctx.dow === 0) {
      // The generated empty states carry no emoji (§8.6: emoji are for schedule blocks, stations and dishes, never decoration).
      return { card: nowCard('arrival', { k: 'Today', title: 'Camp starts today', sub: first.head + ' at ' + schedClock(first.start, false) }),
        body: { countdown: { title: first.head, start: first.start, place: first.place }, welcome: nowWelcome(ctx, blocks) }, basis };
    }
    if (ctx.minutes < NOW_MORNING_FROM_MIN) {
      return { card: nowCard('night', { k: 'Tonight', title: 'Lights out', sub: "Everyone's sleeping" }), body: { heading: 'Today', rows: nowFirstRows(ctx, ctx.dow) }, basis };
    }
    return { card: nowCard('morning', { k: 'Today', title: 'Good morning' }), body: { heading: 'Today', rows: nowFirstRows(ctx, ctx.dow) }, basis };
  }
  if (ctx.minutes >= lastEnd || !upcoming) {
    return { card: nowCard('night', { k: 'Tonight', title: 'Lights out' }), body: { heading: 'Tomorrow', rows: nowFirstRows(ctx, (ctx.dow + 1) % 7) }, basis: { start: null, end: null, noTime: true, over: false, upcoming: null } };
  }
  return { card: nowCard('between', { k: 'Today', title: 'Up next', emoji: '' }), body: { rows: [nowRow(ctx, upcoming)] }, basis };
}

// THE function. See the section's head for what it promises; the fields:
//   at { dow, minutes, ms, forced } · week { phase, start } · reveal { live } | null · messages [notice? join? banners…]
//   card { kind, k, when, tag, title, emoji, status, sub, lead, over, notes, hold, down } — kind is a block kind or one of
//     between | morning | night | none | over | notice (the posted notice is the send-off's card)
//   block (the schedule block behind the card, or null) · moment { kind: 'cleanup' | 'verse', … } | null · body (the kind's data)
//   next · later · laterHeading · todo · todoMore · wholeDay · basis / clock (the minute-by-minute part) · wake (see nowWake)
function nowModel(opts) {
  const ctx = nowCtx(opts);
  const week = nowWeek(ctx);
  const blocks = nowBlocks(ctx.dow, ctx);
  const m = {
    at: { dow: ctx.dow, minutes: ctx.minutes, ms: ctx.ms, forced: ctx.forced }, week, reveal: nowReveal(), messages: [], card: null, block: null,
    moment: null, body: {}, next: null, later: [], laterHeading: ctx.dow === 0 ? 'Today' : 'Later today', todo: [], todoMore: 0, wholeDay: false,
    basis: null, clock: null, wake: [],
  };
  let live = false;
  if (week.phase === 'before') {
    m.card = nowCard('none', { k: 'Today', title: 'Camp starts ' + (nowDateLong(week.start) || 'soon') });
    m.body = { cta: ctx.director ? 'setup' : null };
  } else if (week.phase === 'after') {
    m.card = nowCard('over', { k: 'Today', title: 'See you next year' });
    m.body = { champion: nowChampion() };
  } else if (!blocks.length) {
    m.card = nowCard('none', { k: 'Today', title: week.phase === 'unset' ? 'No camp week is set up yet' : 'Nothing is planned for today' });
    m.body = { cta: ctx.director ? 'setup' : null };
  } else {
    live = true;
    m.wholeDay = true;
    const held = nowHeld(ctx, blocks);
    const cur = held ? held.nb : nowFind(blocks, ctx.minutes);
    const upcoming = blocks.find((x) => x.start > ctx.minutes) || null;
    let nl;
    if (cur) {
      const r = nowBlockCard(ctx, blocks, cur, held);
      m.card = r.card; m.body = r.body; m.basis = r.basis;
      m.block = { id: cur.id, key: ctx.dow + ':' + cur.id, i: cur.i, kind: r.kind, label: cur.b.label, title: cur.head, place: cur.place, tail: cur.tail, emoji: cur.emoji, start: cur.start, end: cur.end, noTime: cur.noTime, meal: cur.meal, overrun: held ? { by: held.by, cap: held.cap } : null };
      // Cleanup first (it is the shorter window: senior's Bible study starts the minute breakfast ends), then Bible study's verse points.
      if (!held && r.kind !== 'night' && r.kind !== 'over') {
        const cm = nowCleanupMoment(ctx, blocks);
        const vm = r.kind === 'bible' ? nowVerseMoment(ctx, cur) : null;
        m.moment = cm || vm;
        // The cleanup panel holds the one moment slot first; a director is told when the verse keys follow it (they open when the
        // cleanup window closes, a minute already in `wake`). Only a confirmed director has a verse moment, so only they read this.
        if (cm && vm && cm.until < cur.end) cm.then = 'Verse points open at ' + schedClock(cm.until, false);
      }
      nl = nowNextLater(ctx, blocks, r.kind === 'night' || r.kind === 'over' ? null : cur, r.kind === 'night' || r.kind === 'over' ? null : upcoming, !!held);
      if (r.kind === 'night' || r.kind === 'over') nl = { next: null, later: [] };
    } else {
      const r = nowGapCard(ctx, blocks, upcoming);
      m.card = r.card; m.body = r.body; m.basis = r.basis;
      nl = nowNextLater(ctx, blocks, null, upcoming);
      if (r.card.kind === 'between') nl = { next: null, later: nl.later };
      else if (r.card.kind === 'morning' || r.card.kind === 'night') nl = { next: null, later: [] };
    }
    m.next = nl.next;
    m.later = nl.later;
    // No block is listed twice on the tab. The elective card's "Then" already lists what comes next, so Up next goes and Later
    // today starts after the last Then row, leaving out the "Prepare for …" rows the same way Then does (mockup 03).
    const then = m.body && Array.isArray(m.body.then) ? m.body.then : [];
    if (then.length) {
      const lastI = Math.max(...then.map((r) => blocks.findIndex((x) => x.id === r.id)));
      m.next = null;
      m.later = blocks.slice(lastI + 1).filter((x) => !/^prepare\b/i.test(x.head)).slice(0, NOW_LATER_MAX).map((x) => nowRow(ctx, x));
    }
    const offer = nowHoldOffer(ctx, blocks, held);
    m.card.hold = offer ? { key: offer.key, name: offer.name, can: offer.can, held: offer.held, cap: offer.cap } : null;
  }
  m.messages = nowMessages(ctx, m.card.kind);
  if (live) {
    const shown = new Set(m.card.kind === 'games' && Array.isArray(m.body.rows) ? m.body.rows.map((r) => r.id) : []);
    const t = nowTodo(ctx, blocks, shown);
    m.todo = t.rows; m.todoMore = t.more;
  }
  m.clock = nowClockOf(m.basis, ctx.minutes);
  m.wake = nowWake(ctx, blocks);
  return m;
}

// ── the tick ─────────────────────────────────────────────────────────
// renderAll's Now panel asks for a full picture (the data moved); the 30-second tick asks the clock only: a full recompute at
// a wake-up (or when the day or the previewed clock changed), otherwise just the clock part and the message strip (a banner's
// time is up, a chat banner's 15 minutes). Without a renderer (renderNow) none of it runs, so the page is as it was.
let nowLast = null;
function nowRefresh(opts) {
  const model = nowModel(opts);
  nowLast = model;
  if (typeof renderNow === 'function') renderNow(model);
  return model;
}
function nowTick(opts) {
  const ctx = nowCtx(opts);
  const last = nowLast;
  if (!last || last.at.dow !== ctx.dow || ctx.minutes < last.at.minutes || ctx.minutes >= last.wake[0]) { nowRefresh(opts); return 'full'; }
  last.clock = nowClockOf(last.basis, ctx.minutes);
  last.messages = nowMessages(ctx, last.card.kind);
  if (typeof renderNowClock === 'function') renderNowClock(last);
  if (typeof renderNowMessages === 'function') renderNowMessages(last);
  return 'clock';
}

// ── Full week schedule sheet (Now's "Whole day" link, More → Full schedule) ──────
// A bottom sheet with the whole printed schedule, day by day: a
// timeline of every block, today's current block highlighted, meals
// showing their dish, electives showing who's at each station, and
// competition blocks listing that day's actual games.

let scheduleDay = null; // day shown while the sheet is open (not persisted)

function scheduleOverlayEl() {
  return document.getElementById('schedule-overlay');
}

function openSchedule() {
  scheduleDay = campNow().dow;
  const overlay = scheduleOverlayEl();
  overlay.classList.remove('closing');
  overlay.hidden = false;
  document.body.classList.add('no-scroll');
  const app = document.getElementById('app');
  if (app) app.inert = true; // background isn't reachable by tab/AT while the sheet is up
  shellSheetOpen('schedule'); // the shell files a history entry: phone Back closes the sheet
  renderSchedule();
  // Land the reader on "now" (today only — other days start at the top).
  requestAnimationFrame(() => {
    const nowCard = document.querySelector('.sched-block.now');
    if (nowCard) nowCard.scrollIntoView({ block: 'center' });
    const closeBtn = document.getElementById('schedule-close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  });
}

// fromDy: how far (px) a swipe had already dragged the sheet down. The
// slide-out keyframes start from there (via --drag) — clearing the inline
// transform alone made the sheet snap back up to rest for a frame and THEN
// slide down. closeSchedule is also a click listener, so its first argument
// can be an Event: only a number counts.
function closeSchedule(fromDy) {
  shellSheetClose('schedule'); // its history entry goes now, not after the slide-out
  const overlay = scheduleOverlayEl();
  const sheet = overlay.querySelector('.schedule-sheet');
  if (sheet) {
    if (typeof fromDy === 'number' && fromDy > 0) sheet.style.setProperty('--drag', fromDy + 'px');
    sheet.style.transform = ''; // clear any swipe offset
  }
  const finish = () => {
    if (sheet) sheet.style.removeProperty('--drag'); // a later close must not inherit a stale offset
    overlay.hidden = true;
    overlay.classList.remove('closing');
    document.body.classList.remove('no-scroll');
    const app = document.getElementById('app');
    if (app) app.inert = false;
    // Focus goes back to the Whole day link that opened it (the Now card's list head), when Now shows one.
    const day = document.querySelector('#now-later-day:not([hidden]), #now-next-day:not([hidden])');
    if (day && typeof day.focus === 'function') day.focus({ preventScroll: true });
  };
  if (calmMotion()) { finish(); return; }
  overlay.classList.add('closing'); // play the slide-down, then hide
  setTimeout(finish, 200);
}

function renderSchedule() {
  renderScheduleDays();
  renderScheduleBody();
  if (typeof renderSchedulePlan === 'function') renderSchedulePlan(scheduleDay); // editors: "Change today's plan" (setup-ui.js)
}

function renderScheduleDays() {
  const wrap = document.getElementById('schedule-days');
  if (!wrap) return;
  const todayDow = campNow().dow;
  // The chips are built once and then only have their `selected` state moved.
  // Rebuilding all seven on every tap destroyed the focused chip (keyboard and
  // screen-reader users were dropped back on <body>) and replaced the one just
  // tapped with a fresh, already-selected chip, so its own select animation
  // never played. The markup deliberately carries no `selected`; it is applied
  // below. It's rebuilt only when it changes (the today-dot moves at midnight).
  const html = weekDays().map((d) => `
    <jelly-chip class="sched-day-chip" selectable size="small" data-dow="${d.dow}">
      ${d.short}${d.dow === todayDow ? '<span class="today-dot" title="Today"></span>' : ''}
    </jelly-chip>`).join('');
  if (wrap.__daysHtml !== html || !wrap.querySelector('.sched-day-chip')) {
    wrap.innerHTML = html;
    wrap.__daysHtml = html;
    wrap.querySelectorAll('.sched-day-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        scheduleDay = parseInt(btn.dataset.dow, 10);
        syncScheduleDaySelection(); // a selectable chip toggles ITSELF on tap — re-assert the truth
        renderScheduleBody();
        const body = document.getElementById('schedule-body');
        if (body) body.scrollTop = 0;
        joyStagger(body);
      });
    });
  }
  syncScheduleDaySelection();
}

// Mark the chip for the shown day, and only that one, in place.
function syncScheduleDaySelection() {
  const wrap = document.getElementById('schedule-days');
  if (!wrap) return;
  wrap.querySelectorAll('.sched-day-chip').forEach((c) => {
    c.toggleAttribute('selected', parseInt(c.dataset.dow, 10) === scheduleDay);
  });
}

function renderScheduleBody() {
  const wrap = document.getElementById('schedule-body');
  if (!wrap) return;
  const dow = scheduleDay;
  const { dow: nowDow, minutes } = campNow();
  const isToday = dow === nowDow;
  const day = weekDays()[dow] || weekDays()[0];
  const blocks = scheduleForDow(dow);

  const rows = blocks.map((raw) => {
    const b = decorateMealBlock(dow, raw);
    const status = !isToday ? '' : minutes >= raw.end ? 'past' : minutes >= raw.start ? 'now' : '';
    const meal = mealInfo(dow, raw);

    let extra = '';
    let labelBadge = ''; // forecast badge next to the label (future electives only)
    // The games played in this item. Competition days are editable; gamesForBlock maps this block's real day-of-week to
    // whichever configured day(s) carry that dow. Any kind of block can hold games once the schedule is edited here
    // (junior's Team Skits, a game the rain plan moved onto lunch); built-in, only a games block does, as it always has.
    const games = gamesForBlock(dow, raw);
    if (games.length) {
      extra = `<div class="sched-games">${games.map((g) =>
        `<span class="sched-game-chip ${state.results[g.id] ? 'played' : ''}">${esc(g.emoji)} ${esc(g.name)}</span>`).join('')}</div>`;
    }
    if (raw.type === 'elective') {
      labelBadge = electiveWxHtml(dow, raw.slot);
      // Pin the viewer's own station at the top of the block so they don't
      // have to scan every roster for their name.
      const mine = myStationFor(dow, raw.slot);
      if (mine) labelBadge += `<span class="sched-you-chip">Your station: ${mine.emoji} ${esc(mine.station)}</span>`;
      const kidText = (kids, keys) => kids.map((k, i) => electiveIsMe(k, keys && keys[i]) ? `<span class="sched-you">${esc(k)}</span>` : esc(k)).join(' · ');
      const stations = electivesFor(dow)[raw.slot] || [];
      if (stations.length) {
        let stationRows = stations.map((row) =>
          `<div class="sched-station${electiveRowHasMe(row) ? ' sched-station-you' : ''}"><span class="sched-station-name">${stationEmoji(row[0])} ${esc(row[0])}</span>
            <span class="sched-station-kids">${kidText(row[1], row[2])}</span></div>`).join('');
        const breakKids = electiveBreakKids(dow, raw.slot);
        if (breakKids.length) {
          stationRows += `<div class="sched-station sched-break${breakKids.some((k) => electiveIsMe(k, '')) ? ' sched-station-you' : ''}"><span class="sched-station-name">Break</span>
            <span class="sched-station-kids">${kidText(breakKids)}</span></div>`;
        }
        extra += `<div class="sched-stations">${stationRows}</div>`;
      }
    }

    return `<div class="sched-block ${status} ${meal ? 'meal' : ''}">
      <div class="sched-rail"><span class="sched-dot"></span></div>
      <div class="sched-card">
        <div class="sched-time">${raw.noTime ? '' : gamesWhen(raw.start, raw.end)}${status === 'now' ? '<span class="sched-now-pill">Now</span>' : ''}</div>
        <div class="sched-label"><span class="sched-emoji">${b.emoji}</span> ${esc(b.label)}${mealCleanupNote(dow, b.label, blockMeal(raw))}${labelBadge}</div>
        ${extra}
      </div>
    </div>`;
  }).join('');

  // This runs on every renderAll and every 30 s tick while the sheet is open,
  // so an unchanged timeline must not be rewritten: that re-created the
  // calendar button, dropped a text selection, and — inside the 900 ms
  // .joy-stagger window after a day tap — replayed the rise-in from invisible.
  // A block boundary ("Now" pill, past dimming) or a saved game result changes
  // the markup, so those still land.
  const html = `
    <h3 class="sched-day-title">${day.full} <span class="sched-day-tag">· ${esc(day.tag)}</span></h3>
    <div class="sched-timeline">${rows || '<p class="muted">Nothing scheduled.</p>'}</div>
    ${blocks.some((b) => !b.noTime) ? `<div class="sched-ics-row"><jelly-button id="sched-ics-btn" class="secondary-btn" variant="platinum" size="small">Add ${day.full} to calendar</jelly-button></div>` : ''}${renderWeekIcsEntry()}
  `;
  if (!setHtmlIfChanged(wrap, html)) return; // the live button already has its handler (same dow/day: the day title is in the markup)
  const icsBtn = document.getElementById('sched-ics-btn');
  if (icsBtn) {
    icsBtn.addEventListener('click', () => {
      const blob = new Blob([buildDayIcs(dow)], { type: 'text/calendar' });
      downloadBlob(blob, 'camp-' + day.short.toLowerCase() + '.ics');
    });
  }
  const weekBtn = document.getElementById('sched-ics-week-btn');
  if (weekBtn && !weekBtn.hasAttribute('disabled')) weekBtn.addEventListener('click', () => downloadWeekIcs());
  const fromBtn = document.getElementById('sched-ics-from-btn');
  if (fromBtn) fromBtn.addEventListener('click', () => downloadWeekIcs({ fromDow: campNow().dow }));
}

// ── "Add to calendar" (.ics) export of one schedule day ──────────
// Times go out as TZID=America/New_York wall-clock (with a standard US
// eastern VTIMEZONE), so the event is right no matter what timezone the
// parent's phone is in — same convention as everything else camp-time.
function icsEscape(s) {
  // CR as well as LF (RFC 5545 §3.3.11): a lone \r left raw would end the
  // property line early and let typed text forge a calendar field.
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

// RFC 5545 §3.1: a content line over 75 OCTETS is folded — CRLF plus one space
// — and the count is bytes, not characters. A fold must never land inside a
// UTF-8 sequence, and every SUMMARY opens with a 4-byte emoji. Strict importers
// (Outlook, Apple Calendar) drop or mangle the event when a long DESCRIPTION
// (the morning's game list) is left on one line. Counted by hand because
// TextEncoder isn't in every runtime this file loads in (the test vm).
function icsFold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75; // continuation lines open with a space that counts too: 74 more
  for (const ch of String(line)) {
    const cp = ch.codePointAt(0);
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// 'YYYYMMDD' in camp time for the given day-of-week of the camp week: the week's own Sunday when a director has set
// the dates (never "this week"), else the current calendar week, the way this has always worked.
function campDateForDow(dow) {
  const wk = campWeek();
  if (wk.start) {
    const [wy, wm, wd] = wk.start.split('-').map(Number);
    return new Date(Date.UTC(wy, wm - 1, wd + dow)).toISOString().slice(0, 10).replace(/-/g, '');
  }
  const [y, m, d] = campDateStr().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + (dow - campNow().dow)));
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}

// The standard US eastern VTIMEZONE both files carry (every line of it a fixed string).
const ICS_VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:America/New_York',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT',
  'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST',
  'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

function buildDayIcs(dow) {
  // Once the camp's dates are set, one day is the week's builder asked for one day: the same dates, the same UIDs
  // (so importing the day and then the week never duplicates an event) and the same descriptions (§12.4).
  if (campWeek().start) return buildWeekIcs({ dows: [dow] });
  const date = campDateForDow(dow);
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const fmt = (mins) => {
    const mm = Math.min(mins, hm(23, 59)); // paranoia: keep a stray midnight end in-day
    return `${date}T${String(Math.floor(mm / 60)).padStart(2, '0')}${String(mm % 60).padStart(2, '0')}00`;
  };
  const day = scheduleForDow(dow);
  const events = day.map((raw, i) => ({ raw, i })).filter(({ raw }) => !raw.noTime).map(({ raw, i }) => {
    const b = decorateMealBlock(dow, raw);
    let desc = '';
    // Name the actual games in the event body, like the schedule sheet does (any block that holds games).
    const held = gamesForBlock(dow, raw);
    if (held.length) desc = held.map((g) => `${g.emoji} ${g.name}`).join(', ');
    // UID = camp + day + the block's position in the day + its start. Before,
    // the junior and senior exports of the same weekday shared UIDs
    // (campday-<dow>-<start>), so importing both overwrote one with the other.
    // The position keeps two blocks that start together apart.
    // Once the schedule is edited here an item's block id is its identity: moving or renaming it must update the event in
    // place, not duplicate it (the position and start above would change with the edit).
    const rich = scheduleIsShared() ? planForDow(dow)[i] : null;
    return [
      'BEGIN:VEVENT',
      `UID:${rich ? CAMP.id + '-' + dow + '-' + rich.id : CAMP.id + '-' + dow + '-' + i + '-' + raw.start}@camp.patricksimpson.info`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/New_York:${fmt(raw.start)}`,
      `DTEND;TZID=America/New_York:${fmt(raw.end)}`,
      `SUMMARY:${icsEscape(b.emoji + ' ' + b.label)}`,
      desc ? `DESCRIPTION:${icsEscape(desc)}` : '',
    ].filter(Boolean).concat('END:VEVENT');
  });
  // X-WR-CALNAME names the calendar an importer creates (Apple, Google), so
  // each camp's days land together instead of in "Untitled".
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Camp Scoreboard//camp.patricksimpson.info//EN', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:' + icsEscape(CAMP.label),
    ...ICS_VTIMEZONE, ...[].concat(...events), 'END:VCALENDAR',
  ].map(icsFold).join('\r\n') + '\r\n';
}

// The schedule sheet's "Add the whole week to my calendar" (and, during the week, "Only the days from today"), with
// the plain-words note that it is a snapshot (§12.4). Until a director has set the camp dates there is NO file to
// offer, and for now the sheet then shows nothing at all — exactly what it showed before this existed, so a camp that
// has not been touched renders byte-for-byte as it did (the entry sits on the line it replaced, so even the blank line
// is the same). (The spec's disabled button, "Ask a director to set the camp dates", is a one-line return here; now that
// the Camp week screen is how a director sets them, whether to show it is the deploy session's call.) The markup changes only
// when the dates or the phase do, so an idle re-render rewrites nothing; the moment of the snapshot goes into the
// file's own description and name, and the toast, not into this text.
function renderWeekIcsEntry() {
  const wk = campWeek();
  if (!wk.start) return '';
  // 'during' starts a day early (the freeze window), so the Saturday BEFORE camp is 'during' too: from there "the days
  // from today" would be only the camp's own Saturday. Offer it from the Sunday on, and not ON the Sunday (the whole week).
  const fromToday = wk.phase === 'during' && campDateStr() >= wk.start && campNow().dow > 0;
  return `<div class="sched-ics-row sched-ics-week"><jelly-button id="sched-ics-week-btn" class="secondary-btn" variant="platinum" size="small">Add the whole week to my calendar</jelly-button>`
    + (fromToday ? `<jelly-button id="sched-ics-from-btn" class="secondary-btn" variant="platinum" size="small">Only the days from today</jelly-button>` : '')
    + `<p class="sched-ics-note">This is a snapshot of the schedule as it is now. Your calendar won’t update itself: if the schedule changes, download it again and delete the old camp events first.</p></div>`;
}

function downloadWeekIcs(opts) {
  const now = new Date();
  const ics = buildWeekIcs(Object.assign({ now }, opts));
  if (!ics) return;
  downloadBlob(new Blob([ics], { type: 'text/calendar' }), weekIcsFileName(now));
  showToast('📆 Saved a snapshot of the schedule as of ' + icsSavedStamp(now).text + '. Your calendar won’t update itself: if the schedule changes, download it again and delete the old camp events first.');
}

// ── The whole week as one calendar file (setup-rebuild-spec §12.4) ──
// Dates are the camp week's own (weekStart + dow), never "this week"; with no date there is no file (null — the
// sheet says "Ask a director to set the camp dates"). Events are the TIMED blocks of planForDow, UID `<camp>-<week>-
// <dk>-<block id>` once the schedule is edited here (stable under a rename, a move and a re-import: a calendar that
// honours UID + SEQUENCE updates the event in place), `<camp>-<week>-<dk>-<position>-<start>` for the built-in copy.
// DESCRIPTION: the games played in the block, the menu and who is on cleanup for a meal. Lines folded at 75 octets,
// UTF-8 aware. `opts`: { dows: [..] one day, or a few; fromDow: leave out the days before it; now: a Date, for tests }.
function icsMonthDay(utcDate) {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][utcDate.getUTCMonth()] + ' ' + utcDate.getUTCDate();
}
// "Jul 18–24, 2027" / "Jul 30 – Aug 5, 2027": the week that starts on that Sunday.
function icsWeekLabel(weekStart) {
  const [y, m, d] = weekStart.split('-').map(Number);
  const a = new Date(Date.UTC(y, m - 1, d));
  const b = new Date(Date.UTC(y, m - 1, d + 6));
  const range = a.getUTCMonth() === b.getUTCMonth() ? icsMonthDay(a) + '–' + b.getUTCDate() : icsMonthDay(a) + ' – ' + icsMonthDay(b);
  return range + ', ' + b.getUTCFullYear();
}
// "Tue 9:40 AM" and "0720-0940" for the moment of the download, in camp time.
function icsSavedStamp(now) {
  const at = now || new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, weekday: 'short', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: false }).formatToParts(at);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    const h = String(parseInt(get('hour'), 10) % 24).padStart(2, '0');
    const mi = get('minute');
    const h12 = (parseInt(h, 10) % 12) || 12;
    return { text: get('weekday') + ' ' + h12 + ':' + mi + ' ' + (parseInt(h, 10) < 12 ? 'AM' : 'PM'), file: get('month') + get('day') + '-' + h + mi };
  } catch (e) { return { text: at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC', file: at.toISOString().slice(5, 16).replace(/[-:T]/g, '') }; }
}
// "Cleanup: 🦊 Ferocious Foxes + …" for a meal block on the rota, plain text (a calendar has no markup).
function icsCleanupText(dow, label, tagged) {
  const meal = tagged !== undefined ? tagged : legacyMealOf(label);
  if (!meal || !cleanupOnRota(dow)) return '';
  const teams = cleanupTeams(dow, meal);
  return teams.length ? 'Cleanup: ' + teams.map((id) => teamEmoji(id) + ' ' + teamName(id)).join(' + ') : '';
}

function buildWeekIcs(opts) {
  const o = opts || {};
  const wk = campWeek();
  if (!wk.start) return null;
  const [wy, wm, wd] = wk.start.split('-').map(Number);
  const dateOf = (dow) => new Date(Date.UTC(wy, wm - 1, wd + dow)).toISOString().slice(0, 10).replace(/-/g, '');
  const now = o.now instanceof Date ? o.now : new Date();
  const utc = (d) => d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const fmt = (date, mins) => {
    const mm = Math.min(mins, hm(23, 59)); // an end of 24:00 stays in the day
    return `${date}T${String(Math.floor(mm / 60)).padStart(2, '0')}${String(mm % 60).padStart(2, '0')}00`;
  };
  // When a director last changed the schedule: SEQUENCE counts minutes from 180 days before the week to that moment
  // (always higher after an edit, so a calendar that honours UID + SEQUENCE updates in place), LAST-MODIFIED is it.
  const editedAt = typeof setupEditedAt === 'function' ? setupEditedAt('schedule') : 0;
  const base = Date.UTC(wy, wm - 1, wd) - 180 * 86400000;
  const seq = editedAt > base ? Math.floor((editedAt - base) / 60000) : 0;
  const shared = scheduleIsShared();
  const wanted = Array.isArray(o.dows) ? o.dows : null;
  const events = [];
  weekDays().forEach((day) => {
    const dow = day.dow;
    if (wanted && wanted.indexOf(dow) === -1) return;
    if (Number.isInteger(o.fromDow) && dow < o.fromDow) return;
    const date = dateOf(dow);
    const legacy = scheduleForDow(dow);
    planForDow(dow).forEach((r, i) => {
      if (r.noTime) return;
      const raw = legacy[i] || r; // the same order: the printed block this one came from (gamesForBlock wants it)
      const lines = [];
      const games = gamesForBlock(dow, raw);
      if (games.length) lines.push('Games: ' + games.map((g) => g.name).join(', '));
      const meal = mealInfo(dow, raw);
      if (meal) lines.push('On the menu: ' + meal.dish);
      const cleanup = icsCleanupText(dow, r.label, blockMeal(raw));
      if (cleanup) lines.push(cleanup);
      const uid = shared ? `${CAMP.id}-${wk.start}-${r.dk}-${r.id}` : `${CAMP.id}-${wk.start}-${r.dk}-${i}-${r.start}`;
      events.push([
        'BEGIN:VEVENT',
        `UID:${uid}@camp.patricksimpson.info`,
        `SEQUENCE:${seq}`,
        `DTSTAMP:${utc(now)}`,
        editedAt ? `LAST-MODIFIED:${utc(new Date(editedAt))}` : '',
        `DTSTART;TZID=America/New_York:${fmt(date, r.start)}`,
        `DTEND;TZID=America/New_York:${fmt(date, r.end)}`,
        `SUMMARY:${icsEscape(r.emoji + ' ' + r.label)}`,
        lines.length ? `DESCRIPTION:${icsEscape(lines.join('\n'))}` : '',
        'END:VEVENT',
      ].filter(Boolean));
    });
  });
  const saved = icsSavedStamp(now);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//camp.patricksimpson.info//Camp Scoreboard//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEscape(CAMP.label + ' · ' + icsWeekLabel(wk.start)),
    'X-WR-TIMEZONE:America/New_York',
    'X-WR-CALDESC:' + icsEscape('A snapshot of the schedule as it was on ' + saved.text + '. Your calendar will not update itself: if the schedule changes, download it again and delete the old camp events first.'),
    ...ICS_VTIMEZONE, ...[].concat(...events), 'END:VCALENDAR',
  ].map(icsFold).join('\r\n') + '\r\n';
}

// The file name carries the moment it was made, so two downloads are told apart: junior-camp-2027-07-18-saved-0720-0940.ics
function weekIcsFileName(now) {
  const wk = campWeek();
  return CAMP.id + '-camp-' + (wk.start || 'dates-unset') + '-saved-' + icsSavedStamp(now).file + '.ics';
}

function wireSchedule() {
  document.getElementById('schedule-close').addEventListener('click', closeSchedule);
  scheduleOverlayEl().querySelector('.schedule-backdrop').addEventListener('click', closeSchedule);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scheduleOverlayEl().hidden) closeSchedule();
  });

  // Swipe-to-dismiss — only from the header (grabber). The scrollable body
  // keeps its own scroll; we never hijack it.
  const header = scheduleOverlayEl().querySelector('.schedule-header');
  const sheet = scheduleOverlayEl().querySelector('.schedule-sheet');
  if (header && sheet) {
    let startY = null;
    let dy = 0;
    header.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      dy = 0;
      sheet.style.transition = 'none';
    }, { passive: true });
    header.addEventListener('touchmove', (e) => {
      if (startY == null) return;
      dy = Math.max(0, e.touches[0].clientY - startY); // downward only
      sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    // Release: past the threshold, hand the drag offset to closeSchedule so
    // the slide-out continues from where the finger let go; short of it,
    // ease back (the sheet has no resting transition, so without one the
    // spring-back snapped). touchstart sets transition:none, so this one
    // can't leak into the next drag.
    const release = () => {
      if (startY == null) return;
      startY = null;
      if (dy > 90) { sheet.style.transition = ''; closeSchedule(dy); return; }
      sheet.style.transition = calmMotion() ? '' : 'transform 0.2s ease';
      sheet.style.transform = '';
    };
    header.addEventListener('touchend', release);
    // The OS can take the gesture away (incoming call, edge swipe, a gesture
    // takeover): no touchend ever comes, which left the sheet stuck partly
    // dragged. A cancelled drag is never a dismiss.
    header.addEventListener('touchcancel', () => { dy = 0; release(); });
  }
}

// ── Drawer fallbacks (the Jelly module never loaded) ─────────────
// The old gear drawer is gone: its rows live in More (the tab), and the drawers
// that remain — Change history, Who can sign in, Alerts — are opened from More
// and sit on the shell's history stack (shellSheetOpen), so phone Back closes them.
function wireSettings() {
  // Degraded-mode escape hatch: if the Jelly module never loaded, the sheets
  // render via the :not(:defined)[open] fallback CSS and have no ✕/backdrop —
  // let Escape close them. (When the component IS registered it owns Escape.)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || customElements.get('jelly-drawer')) return;
    ['history-overlay', 'team-picker-overlay', 'members-overlay', 'alerts-overlay'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.hasAttribute('open')) el.removeAttribute('open');
    });
  });
  // …but the phones that hit this path (iOS < 16.4 can't parse the module) have
  // no Escape key. So: a tap anywhere OUTSIDE an open sheet closes it, and so
  // does a tap on the "✕ Close" bar styles.css paints at its top (a pseudo-
  // element, so the tap's target is the sheet itself, in its top strip).
  // Capture phase + stopPropagation: the dismissing tap must not also press
  // whatever sits behind the sheet. Checked at event time so a module that
  // arrives late takes over cleanly; the tap that OPENS a sheet runs while none
  // is open, so it is unaffected.
  document.addEventListener('click', (e) => {
    if (customElements.get('jelly-drawer')) return;
    const open = [...document.querySelectorAll('jelly-drawer[open], jelly-dialog[open]')];
    const close = failedModuleSheetsToClose(open, e.target, e.clientY);
    if (!close.length) return;
    close.forEach((el) => el.removeAttribute('open'));
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

// Which open sheets does a tap close while the Jelly module is absent? Elements
// are duck-typed (contains / getBoundingClientRect) so the rule is unit-tested
// without a browser. A tap outside every open sheet closes them all; a tap on
// the "✕ Close" bar (the sheet's own top 52px — a pseudo-element, so the target
// is the sheet itself) closes that sheet; a tap inside one's content closes
// nothing. [] = leave the tap alone.
function failedModuleSheetsToClose(open, target, clientY) {
  const inside = open.find((el) => el.contains(target));
  const onBar = !!inside && target === inside && clientY - inside.getBoundingClientRect().top <= 52;
  if (inside && !onBar) return [];
  return onBar ? [inside] : open;
}

// ── Change-history sheet (editor-only) ───────────────────────────
// Opened from More → Director; a jelly-drawer on the shell's history stack
// (shellSheetOpen), so phone Back closes it.
function historyOverlayEl() {
  return document.getElementById('history-overlay');
}

// A viewer must never keep the change history on screen: a director demoted
// while the drawer is open has it shut and its rows cleared on the next render.
function closeHistoryForViewer() {
  const overlay = historyOverlayEl();
  if (overlay && overlay.hasAttribute('open')) overlay.removeAttribute('open');
  const body = document.getElementById('history-body');
  if (body && body.innerHTML) body.innerHTML = '';
}

function openHistory() {
  // Every point change, newest first: directors' eyes only (see "Standings
  // secrecy"). The row is hidden for viewers, and the rules refuse them the read.
  if (!canEdit()) return;
  const overlay = historyOverlayEl();
  if (!overlay) return;
  historyShowEarlier = false;
  renderHistory();
  shellSheetOpen('history');
}

// The history drawer shows this camp year only: from the moment the new-year setup stamped (`state.meta.epochAt`, the
// server's clock; absent = the legacy week, no filter). `historyShowEarlier` is the drawer's own "Show earlier years".
let historyShowEarlier = false;
function historyEpochFloor() {
  const a = state && state.meta ? state.meta.epochAt : null;
  return typeof a === 'number' && isFinite(a) && a > 0 ? a : 0;
}
function historyFilterRows(rows, epochAt, showEarlier) {
  if (!epochAt || showEarlier) return { rows, hidden: 0 };
  const keep = rows.filter((r) => changelogTime(r) >= epochAt);
  return { rows: keep, hidden: rows.length - keep.length };
}

function renderHistory() {
  const body = document.getElementById('history-body');
  if (!body) return;
  if (!fbRef) {
    body.innerHTML = '<p class="muted">Needs a connection: there’s no shared change history to show right now.</p>';
    return;
  }
  // Skeleton rows while the changelog fetch is in flight — varied widths so
  // the placeholder reads as a list of entries, not a repeated bar.
  body.innerHTML = '<div class="history-skeleton" aria-label="Loading change history">' +
    [92, 68, 84, 58, 76, 88].map((w) =>
      `<jelly-skeleton shape="line" style="width: ${w}%"></jelly-skeleton>`).join('') +
    '</div>';
  firebase.database().ref(dbPath('changelog')).limitToLast(500).once('value')
    .then((snap) => {
      const val = snap.val() || {};
      const rows = Object.keys(val).map((k) => val[k]).filter(Boolean);
      // Sort on a NUMBER, not the raw field. Entries written before 2026-07-26
      // carry an ISO string; newer ones carry a server-set number, and the two
      // will coexist in this node forever. A string compare across both would
      // silently interleave them wrongly (every number sorts before "2…"), so
      // normalize first. formatEasternStamp already accepts either shape.
      rows.sort((a, b) => changelogTime(b) - changelogTime(a));
      // This camp year only (§6.11): changes older than the new-year setup are behind "Show earlier years".
      const f = historyFilterRows(rows, historyEpochFloor(), historyShowEarlier);
      const toggle = historyEpochFloor()
        ? (historyShowEarlier
          ? '<button type="button" class="btn btn-sm" id="history-earlier">Show this year only</button>'
          : (f.hidden ? '<button type="button" class="btn btn-sm" id="history-earlier">Show earlier years</button>' : ''))
        : '';
      body.innerHTML = (f.rows.length ? renderHistoryRows(f.rows) : '<p class="muted">No point changes recorded yet' + (historyEpochFloor() && !historyShowEarlier ? ' this year' : '') + '.</p>') + toggle;
      const tb = document.getElementById('history-earlier');
      if (tb) tb.addEventListener('click', () => { historyShowEarlier = !historyShowEarlier; renderHistory(); });
    })
    .catch(() => {
      body.innerHTML = '<p class="muted">Couldn\'t load the history (offline?). Close and reopen to try again.</p>';
    });
}

// A changelog entry's time in milliseconds, whichever shape it was stored in.
// 0 for junk, which sorts it to the bottom rather than throwing off everything
// around it.
function changelogTime(row) {
  const at = row && row.at;
  if (typeof at === 'number') return Number.isFinite(at) ? at : 0;
  const ms = Date.parse(String(at || ''));
  return Number.isNaN(ms) ? 0 : ms;
}

// Who to name on a changelog row. `by` is a plain string the writing device
// chose; `byKey` is pinned by the rules to that device's authenticated
// identity, so it is the only trustworthy field here. Resolve it through the
// member directory exactly as chat does — which also inherits chat's
// fail-closed behaviour when the directory hasn't loaded, and its refusal to
// let a departed member's stored name impersonate somebody still on the list.
// typeof-guarded because chat.js is an optional layer loaded after this file.
function historyAuthorName(row) {
  if (typeof chatAuthorName === 'function') return chatAuthorName({ byKey: row.byKey, name: row.by });
  return row.by || identityFromKey(row.byKey || '') || 'Someone';
}

function renderHistoryRows(rows) {
  let html = '';
  let lastDay = null;
  rows.forEach((r) => {
    const stamp = formatEasternStamp(r.at) || '';
    const comma = stamp.indexOf(',');
    const day = comma > -1 ? stamp.slice(0, comma) : stamp;
    const time = comma > -1 ? stamp.slice(comma + 2) : '';
    if (day !== lastDay) { html += `<div class="cl-day">${esc(day || '—')}</div>`; lastDay = day; }
    const delta = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
    const cls = r.delta > 0 ? 'cl-pos' : 'cl-neg';
    const who = (r.byKey || r.by) ? ` · ${esc(String(historyAuthorName(r)))}` : '';
    const emoji = r.teamId ? teamEmoji(r.teamId) : '';
    html += `
      <div class="cl-entry">
        <div class="cl-entry-top">
          <span class="cl-team">${emoji ? emoji + ' ' : ''}${esc(String(r.team || r.teamId || '?'))}</span>
          <span class="cl-delta ${cls}">${esc(delta)} pts</span>
        </div>
        <div class="cl-entry-sub">${esc(String(r.reason || 'Points updated'))} · ${esc(String(r.before))}→${esc(String(r.after))}</div>
        <div class="cl-entry-meta">${esc(time)}${who}</div>
      </div>`;
  });
  return html;
}

// ── Members (More → Who can sign in) ─────────────────────────
// Editor-only management of campScoreboard/members — the allowlist the
// security rules check on every read and write. Same drawer pattern as the
// change history. All writes here are themselves rule-checked server-side
// (editors only), so a failure toast means the rules said no, not a bug.

function membersOverlayEl() {
  return document.getElementById('members-overlay');
}

// After adding someone, the app hands the editor a ready-to-send invite to
// paste into their own text/email (the app is a static site and can't send
// mail itself). Set on a successful add, shown at the top of the list until
// dismissed or the next add. Cleared when the drawer is (re)opened so a stale
// invite from earlier doesn't linger.
let lastInvite = null;

// Build the copy-and-send invite for a newly added member. Tailored to how
// they'll sign in (email vs phone) and what their role lets them do.
function inviteText(key, role) {
  const isPhone = String(key)[0] === '+';
  const shown = identityFromKey(key);
  const where = location.origin || 'https://camp.patricksimpson.info';
  const can = role === 'editor'
    ? 'You’ll be able to enter scores and help run the games.'
    : 'You’ll be able to see the schedule, the games and the medal winners.';
  const how = isPhone
    ? `Open ${where} on your phone, tap “Alternative sign in” → “Sign in with a phone number”, and enter ${shown}. You’ll get a texted code to finish.`
    : `Open ${where} on your phone and tap “Continue with Google”, then choose your ${shown} account. (No Google account? Tap “Alternative sign in” → “Email me a sign-in link”.)`;
  return `You’re on the Camp scoreboard app! 🏅\n\n${how}\n\n${can}`;
}

function openMembers() {
  if (!canEdit()) return;
  // People (setup-ui.js) replaced this drawer: the same list, by team, with the asking switch and the requests. The drawer's own code
  // below stays only for a build with no setup-ui.js, and for the helpers (planMemberAdd, inviteText …) People still uses.
  if (typeof setupOpenPeople === 'function' && setupOpenPeople()) return;
  lastInvite = null;
  const overlay = membersOverlayEl();
  if (!overlay) return;
  renderMembers();
  shellSheetOpen('members');
}

function renderMembers() {
  const body = document.getElementById('members-body');
  if (!body) return;
  if (!fbRef) {
    body.innerHTML = '<p class="muted">Needs a connection: the member list can’t be reached right now.</p>';
    return;
  }
  // Loading bars only on the first fill. Every role/team/remove tap calls
  // this again; swapping the list for skeleton bars each time made the drawer
  // flash and jump back to the top, so a refresh keeps the current list up
  // (dimmed) until the new one lands. The sequence number drops a slower,
  // older load that resolves after a newer one.
  const seq = renderMembers.seq = (renderMembers.seq || 0) + 1;
  if (body.querySelector('.member-list')) body.classList.add('is-refreshing');
  else {
    body.innerHTML = '<div class="history-skeleton">' +
      [90, 70, 80].map((w) => `<div class="skeleton-row" style="width:${w}%"><jelly-skeleton style="height:2.6rem"></jelly-skeleton></div>`).join('') +
      '</div>';
  }
  // Both camps' lists load side by side. The other camp's read succeeds for
  // anyone who is a member THERE (the list is that camp's staff directory);
  // a refused read simply means "manage this camp only" — the drawer then
  // looks exactly like the single-camp version.
  const other = CAMPS[otherCampId()];
  Promise.all([
    firebase.database().ref(dbPath('members')).once('value').then((s) => s.val() || {}),
    firebase.database().ref(other.dbRoot + '/members').once('value')
      .then((s) => s.val() || {})
      .catch(() => null),
  ])
    .then(([active, others]) => {
      if (seq !== renderMembers.seq) return;
      body.classList.remove('is-refreshing');
      const lists = {};
      lists[CAMP.id] = active;
      lists[other.id] = others; // null ⇒ single-camp view
      renderMemberList(body, lists);
    })
    .catch(() => {
      if (seq !== renderMembers.seq) return;
      body.classList.remove('is-refreshing');
      body.innerHTML = '<p class="muted">Couldn\'t load the member list — check the connection and try again.</p>';
    });
}

// This week's printed counselor roster, per team — per-camp data
// (camps.js); the seed list behind "Add this week's counselors" in the
// Members drawer. They start as PENDING members (a name and a team, no
// sign-in yet). An empty list (senior, for now) hides the button.
const SEED_COUNSELORS = CAMP.seedCounselors;

// Which seed counselors aren't in the member list yet, matched by name
// (case-insensitively) so pressing the button twice doesn't duplicate anyone —
// including someone who has since been given a real email or phone.
function missingSeedCounselors(members) {
  // Through canonicalCounselorName on both sides: a member row typed "Alysa"
  // before the spelling merge still counts as Alyssa being on the list.
  const key = (n) => String(canonicalCounselorName(String(n || '').trim())).toLowerCase();
  const have = new Set(Object.keys(members || {})
    .map((k) => key(members[k] && members[k].name))
    .filter(Boolean));
  const out = [];
  SEED_COUNSELORS.forEach(([teamId, names]) => {
    names.forEach((name) => {
      if (!have.has(key(name))) out.push({ name, teamId });
    });
  });
  return out;
}

// The team <select> shown on every member row and in the add form.
function memberTeamSelectHTML(cls, teamId, label) {
  return `<jelly-select class="${cls}" placeholder="— no team —" ${isTeamId(teamId) ? `value="${esc(teamId)}"` : ''} label="${esc(label)}" size="small">
    <jelly-option value="">— no team —</jelly-option>
    ${state.teams.map((t) => `<jelly-option value="${esc(t.id)}">${teamEmoji(t.id)} ${esc(t.name)}</jelly-option>`).join('')}
  </jelly-select>`;
}

// This account's role at a given camp — the active camp's is live state,
// the other camp's comes from the one-shot probe (or its cached hint).
function campRoleOf(campId) {
  if (campId === CAMP.id) return memberRole;
  if (otherCampRole) return otherCampRole;
  const h = readCampsHint()[campId];
  return h === 'editor' || h === 'viewer' ? h : null;
}

// One person per row, however many camps they're on: fold the per-camp
// member lists into { key, camps: { junior: rec|null, senior: rec|null } },
// sorted by display name. Pure — pinned by tests/camps.test.js.
function mergeMemberLists(lists) {
  const rows = new Map();
  Object.keys(CAMPS).forEach((cid) => {
    Object.keys(lists[cid] || {}).forEach((key) => {
      if (!rows.has(key)) rows.set(key, { key, camps: { junior: null, senior: null } });
      rows.get(key).camps[cid] = lists[cid][key];
    });
  });
  const nameOf = (r) => String((r.camps.junior && r.camps.junior.name) ||
    (r.camps.senior && r.camps.senior.name) || identityFromKey(r.key));
  return [...rows.values()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

// The path to one camp's record for a key — the ONLY place a cross-camp
// members write is spelled out.
function campMembersPath(campId, key) {
  return CAMPS[campId].dbRoot + '/members/' + key;
}

// The "Add someone" form's typed state. renderMemberList rebuilds the whole
// drawer body — form included — so anything half-typed there used to vanish
// whenever a refresh landed (a removal, an invite dismiss, another add). Read
// it before the rebuild and put it back after. Returns null when there is no
// form yet (first fill).
const MEMBER_ADD_FIELDS = [['id', '#member-add-id'], ['name', '#member-add-name'], ['role', '#member-add-role'],
  ['camps', '#member-add-camps'], ['team', '.member-add-team']];

function readMemberAddDraft(body) {
  if (!body.querySelector('#member-add-id')) return null;
  const draft = {};
  MEMBER_ADD_FIELDS.forEach(([k, sel]) => {
    const el = body.querySelector(sel);
    draft[k] = el ? String(el.value || '') : '';
  });
  const err = body.querySelector('#member-add-error');
  draft.error = err && !err.hidden ? err.textContent : '';
  return draft;
}

function restoreMemberAddDraft(body, draft) {
  if (!draft) return;
  MEMBER_ADD_FIELDS.forEach(([k, sel]) => {
    const el = body.querySelector(sel);
    if (el && draft[k]) el.value = draft[k];
  });
  const err = body.querySelector('#member-add-error');
  if (err && draft.error) { err.textContent = draft.error; err.hidden = false; }
}

// A successful add starts the form over (the rebuild that follows must not
// carry the person just added back into it).
function resetMemberAddForm(body) {
  const set = (sel, v) => { const el = body.querySelector(sel); if (el) el.value = v; };
  set('#member-add-id', '');
  set('#member-add-name', '');
  set('#member-add-role', 'viewer');
  set('#member-add-camps', 'active');
  set('.member-add-team', '');
  const err = body.querySelector('#member-add-error');
  if (err) err.hidden = true;
}

function renderMemberList(body, lists) {
  const draft = readMemberAddDraft(body);
  const myKey = identityKey(authUser);
  const crossCamp = !!lists[otherCampId()]; // other list readable ⇒ show both columns
  const campIds = crossCamp ? ['junior', 'senior'] : [CAMP.id];
  const merged = mergeMemberLists(crossCamp ? lists : { [CAMP.id]: lists[CAMP.id] });

  const rows = merged.map(({ key, camps }) => {
    const activeRec = camps[CAMP.id];
    const anyRec = activeRec || camps[otherCampId()] || {};
    const self = key === myKey;
    const owner = key === OWNER_MEMBER_KEY; // the rules refuse every write to this row
    const pending = isPendingKey(key);
    const isPhone = String(key)[0] === '+';
    const displayName = anyRec.name || identityFromKey(key);
    const idLine = pending
      ? `<span class="member-email member-pending">⏳ No sign-in yet — <button type="button" class="link-btn member-add-signin">add email or phone</button></span>`
      : (anyRec.name ? `<span class="member-email">${isPhone ? '📱 ' : ''}${esc(identityFromKey(key))}</span>` : '');

    // Per-camp access. Pending rows live in ONE camp only (their key means
    // nothing to the other camp until a real sign-in exists), so they keep
    // the simple single-camp role control.
    let accessHTML;
    if (owner) {
      accessHTML = ''; // no switches: nothing the app writes here would be accepted
    } else if (pending) {
      accessHTML = `<jelly-segmented class="member-role" size="small" label="Role" value="${anyRec.role === 'editor' ? 'editor' : 'viewer'}" ${self ? 'disabled' : ''}>
          <jelly-segment value="viewer">👀 Viewer</jelly-segment>
          <jelly-segment value="editor">✏️ Editor</jelly-segment>
        </jelly-segmented>
        <button type="button" class="link-btn danger-link member-remove">Remove</button>`;
    } else {
      accessHTML = campIds.map((cid) => {
        const rec = camps[cid];
        const value = rec ? (rec.role === 'editor' ? 'editor' : 'viewer') : 'none';
        // You can only change a camp you're an editor OF; your own access is
        // always someone else's job to change.
        const disabled = self || campRoleOf(cid) !== 'editor';
        const label = crossCamp
          ? `<span class="member-access-camp">${cid === 'senior' ? '🚩 Senior' : '🛡️ Junior'}</span>`
          : '';
        return `<div class="member-access-row">
          ${label}
          <jelly-segmented class="member-access" size="small" label="${esc(CAMPS[cid].label)} access" value="${value}" data-camp-id="${esc(cid)}" ${disabled ? 'disabled' : ''}>
            <jelly-segment value="none">None</jelly-segment>
            <jelly-segment value="viewer">Viewer</jelly-segment>
            <jelly-segment value="editor">Editor</jelly-segment>
          </jelly-segmented>
        </div>`;
      }).join('');
    }

    // The team lives on the ACTIVE camp's record (each camp has its own
    // teams) — set the other camp's team from inside that camp.
    const teamHTML = !owner && !pending && activeRec
      ? memberTeamSelectHTML('member-team', activeRec.teamId, displayName + ' team')
      : '';

    return `<div class="member-row${pending ? ' member-row-pending' : ''}" data-member-key="${esc(key)}">
      <div class="member-id">
        <span class="member-name">${esc(displayName)}${self ? ' <span class="member-you">(you)</span>' : ''}</span>
        ${idLine}
      </div>
      ${owner ? '' : `<div class="member-controls">
        ${accessHTML}
        ${teamHTML}
      </div>`}
      ${owner ? '<p class="muted member-self-note member-owner-note">👑 Owner · only the owner can change this row</p>'
        : self ? '<p class="muted member-self-note">That\'s you — another editor has to change or remove your access.</p>' : ''}
    </div>`;
  }).join('');

  const inviteBanner = lastInvite ? `
    <div class="member-invite">
      <div class="member-invite-head">
        <span class="member-invite-title">✅ Added — send them this</span>
        <button type="button" class="member-invite-dismiss" aria-label="Dismiss">✕</button>
      </div>
      <p class="muted member-invite-note">The app can't email people itself, so copy this and send it however you like (text, email, group chat).</p>
      <textarea class="member-invite-text" id="member-invite-text" rows="6" readonly>${esc(lastInvite)}</textarea>
      <jelly-button class="secondary-btn" variant="primary" id="member-invite-copy" block>📋 Copy invite</jelly-button>
    </div>` : '';

  const missing = missingSeedCounselors(lists[CAMP.id]);
  const seedBlock = missing.length ? `
    <div class="member-seed">
      <p class="muted">Not everyone's on the list yet. Add this week's ${missing.length} missing counselor${missing.length === 1 ? '' : 's'} by name and team — they'll sit here as “no sign-in yet” until you add each person's email or phone.</p>
      <jelly-button id="member-seed-btn" class="secondary-btn" variant="platinum" block>👥 Add this week's counselors</jelly-button>
    </div>` : '';

  // The add form can grant the other camp too — but only when this editor
  // can actually write there.
  const canAddBoth = crossCamp && campRoleOf(otherCampId()) === 'editor';
  const addCampsHTML = canAddBoth ? `
        <div class="form-field">
          <label class="form-label">Camps</label>
          <jelly-segmented id="member-add-camps" size="small" label="Camps" value="active">
            <jelly-segment value="active">${CAMP.id === 'senior' ? '🚩' : '🛡️'} ${esc(CAMP.label.replace(' Camp', ''))} only</jelly-segment>
            <jelly-segment value="both">⛺ Both camps</jelly-segment>
          </jelly-segmented>
        </div>` : '';

  const crossSub = crossCamp
    ? `<p class="muted members-sub">Each person has a switch per camp: <strong>None</strong> (can't open that camp at all), <strong>Viewer</strong>, or <strong>Editor</strong>. Someone on both camps picks between them in the app.</p>`
    : '';

  body.innerHTML = `
    <p class="muted members-sub">Everyone here can open the app. Viewers can look; editors can change scores and manage this list. Anyone not on the list gets nothing — the database itself refuses them.</p>
    ${crossSub}
    <p class="muted members-sub">Giving someone a <strong>team</strong> does two things: the app opens on that team for them, and — if they're an editor — it keeps them out of scoring the rounds their own team is in. Teams are per-camp; this drawer sets their ${esc(CAMP.label)} team.</p>
    ${inviteBanner}
    <div class="member-list">${rows || '<p class="muted">Nobody yet.</p>'}</div>
    ${seedBlock}
    <div class="member-add">
      <h3>Add someone</h3>
      <div class="form-field">
        <label class="form-label">Email or phone number</label>
        <jelly-input class="form-input" id="member-add-id" type="text" placeholder="name@example.com or 555-123-4567"></jelly-input>
        <p class="muted member-add-hint">Use the email they sign in with — or a phone number if they'll use phone sign-in. Leave it blank to add someone by name now and fill this in later.</p>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Name</label>
          <jelly-input class="form-input" id="member-add-name" type="text" placeholder="First name"></jelly-input>
        </div>
        <div class="form-field">
          <label class="form-label">Role</label>
          <jelly-segmented id="member-add-role" size="small" label="Role" value="viewer">
            <jelly-segment value="viewer">👀 Viewer</jelly-segment>
            <jelly-segment value="editor">✏️ Editor</jelly-segment>
          </jelly-segmented>
        </div>
      </div>
      ${addCampsHTML}
      <div class="form-field">
        <label class="form-label">Team (optional)</label>
        ${memberTeamSelectHTML('member-add-team', null, 'Team for the new member')}
      </div>
      <jelly-button id="member-add-btn" class="secondary-btn" variant="primary">+ Add member</jelly-button>
      <p class="entry-error" id="member-add-error" hidden></p>
    </div>`;

  bindMemberList(body, myKey, lists);
  restoreMemberAddDraft(body, draft);
}

// Create a member record ONLY where none exists. A plain set() replaces
// whatever is already at the key — and the add form defaults to Viewer / no
// team / no name, so re-adding someone already on the list silently demoted
// them and wiped their team and name (and they'd see it happen mid-game, as
// their member listener flipped them view-only). The drawer's own lists catch
// the stale-by-seconds case up front; the transaction catches the race where
// another editor wrote the key since this drawer loaded. Resolves true when
// the record was written, false when the key was already taken.
function createMemberIfAbsent(ref, rec) {
  return ref.transaction((cur) => (cur === null ? rec : undefined))
    .then((res) => !!(res && res.committed));
}

// What an "Add someone" submit may write, given the member lists the drawer
// loaded. Pure — pinned by tests/auth.test.js. Returns { error } or
// { camps: [campId, …] }: only the camps where the key is ABSENT, so "Both
// camps" on someone already in one grants the other without touching the
// first. Your own key is refused outright (the drawer already disables your
// own row — "another editor has to change your access" — and these paths must
// not be a way around that).
function planMemberAdd({ key, pending, bothCamps, myKey, lists }) {
  if (key === OWNER_MEMBER_KEY) {
    return { error: 'That account is the owner — it is managed in the Firebase console.' };
  }
  if (!pending && key === myKey) {
    return { error: "That's your own account — another editor has to change your access." };
  }
  const here = CAMP.id;
  const there = otherCampId();
  const camps = [];
  if (!(lists[here] || {})[key]) camps.push(here);
  if (bothCamps && !pending && !(lists[there] || {})[key]) camps.push(there);
  if (!camps.length) {
    return { error: 'Already on the list — change their access on their row below.' };
  }
  return { camps };
}

// Why a pending row can't be pointed at this new key ('' when it can): it is
// the editor's own account, or somebody is already listed under it.
function memberConvertRefusal(newKey, myKey, lists) {
  if (newKey === OWNER_MEMBER_KEY) return 'That account is the owner — it is managed in the Firebase console.';
  if (newKey === myKey) return "That's your own account — another editor has to change your access.";
  if ((lists[CAMP.id] || {})[newKey]) return 'Already on the list — change their access on their row instead.';
  return '';
}

// Move a pending row (name + team, no sign-in) onto its real email/phone key.
// RTDB keys are immutable, so this is a create-then-delete: write the new key
// first, and only remove the placeholder once that lands — a failure part-way
// leaves the pending row intact rather than losing the person. The create is
// absent-only (createMemberIfAbsent): pointing a seed-roster row at someone
// who is already listed would otherwise overwrite their live record.
function convertPendingMember(key, rec, lists) {
  const raw = (prompt('Email address or phone number for ' + (rec.name || 'this person') + ':', '') || '').trim();
  if (!raw) return;
  let newKey;
  if (raw.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) { showToast("That doesn't look like an email address."); return; }
    newKey = emailKey(raw);
  } else {
    newKey = phoneKey(raw);
    if (!newKey) { showToast("That doesn't look like a phone number — include the area code."); return; }
  }
  if (!isValidMemberKey(newKey)) { showToast("That address has a character the database can't use as a key."); return; }
  const refusal = memberConvertRefusal(newKey, identityKey(authUser), lists || {});
  if (refusal) { showToast(refusal); return; }
  const role = rec.role === 'editor' ? 'editor' : 'viewer';
  const next = memberRecord(role, rec.name, rec.teamId);
  createMemberIfAbsent(firebase.database().ref(dbPath('members/' + newKey)), next)
    .then((created) => {
      if (!created) { showToast('Already on the list — change their access on their row instead.'); return null; }
      return firebase.database().ref(dbPath('members/' + key)).remove().then(() => {
        lastInvite = inviteText(newKey, role); // they can sign in now — hand over the invite
        showToast(identityFromKey(newKey) + ' can now sign in', { mine: true });
        renderMembers();
      });
    })
    .catch(() => showToast('Change refused — are you still an editor?'));
}

function bindMemberList(body, myKey, lists) {
  const activeMembers = lists[CAMP.id] || {};
  body.querySelectorAll('.member-row').forEach((row) => {
    const key = row.dataset.memberKey;
    if (key === OWNER_MEMBER_KEY) return; // read-only row: no controls were rendered
    const self = key === myKey;
    const camps = {
      junior: (lists.junior && lists.junior[key]) || null,
      senior: (lists.senior && lists.senior[key]) || null,
    };
    const rec = camps[CAMP.id] || camps[otherCampId()] || {};
    const who = rec.name || identityFromKey(key);

    // Pending rows keep the simple single-camp role control.
    const roleSeg = row.querySelector('.member-role');
    if (roleSeg) {
      roleSeg.addEventListener('change', (e) => {
        const role = e.detail && e.detail.value;
        if (self || !role || (role !== 'viewer' && role !== 'editor')) return;
        // A role/team change on an EXISTING record doesn't rebuild the drawer:
        // the control already shows the new value, and re-creating every row's
        // segmented + select froze the page for ~1 s at 40 members. The record
        // this closure holds is patched instead, so a later action on the same
        // row (convert, grant) reads current data. A refusal still re-renders,
        // to put the control back.
        firebase.database().ref(dbPath('members/' + key + '/role')).set(role)
          .then(() => { rec.role = role; showToast(`${who} is now a ${role}`, { mine: true }); })
          .catch(() => { showToast('Change refused — are you still an editor?'); renderMembers(); });
      });
    }

    // The per-camp access switches. None ⇒ remove that camp's record (with a
    // confirm); Viewer/Editor on an existing record ⇒ role child write;
    // Viewer/Editor where there is no record ⇒ grant (write a fresh record,
    // carrying the name over from their other-camp record).
    row.querySelectorAll('.member-access').forEach((seg) => {
      seg.addEventListener('change', (e) => {
        const value = e.detail && e.detail.value;
        const cid = seg.dataset.campId;
        if (self || !cid || !CAMPS[cid] || !value) return;
        const existing = camps[cid];
        const label = CAMPS[cid].label;
        const fail = () => { showToast(`Change refused — are you still an editor at ${label}?`); renderMembers(); };
        if (value === 'none') {
          if (!existing) return; // nothing to remove
          if (!confirm(`Remove ${who} from ${label}? They lose access to it the moment this saves.`)) { renderMembers(); return; }
          firebase.database().ref(campMembersPath(cid, key)).remove()
            .then(() => { showToast(`${who} removed from ${label}`, { mine: true }); renderMembers(); })
            .catch(fail);
        } else if (value === 'viewer' || value === 'editor') {
          if (existing) {
            firebase.database().ref(campMembersPath(cid, key) + '/role').set(value)
              .then(() => { existing.role = value; showToast(`${who} is now a ${value} at ${label}`, { mine: true }); })
              .catch(fail);
          } else {
            // teamId deliberately not carried over — teams differ per camp.
            firebase.database().ref(campMembersPath(cid, key)).set(memberRecord(value, rec.name))
              .then(() => { showToast(`${who} can now sign in to ${label}`, { mine: true }); renderMembers(); })
              .catch(fail);
          }
        }
      });
    });

    // Team: a child write, so the parent .validate doesn't re-run. Clearing it
    // is a remove() — RTDB has no "present but empty" for a string.
    const teamSel = row.querySelector('.member-team');
    if (teamSel) {
      teamSel.addEventListener('change', () => {
        const teamId = teamSel.value || '';
        const ref = firebase.database().ref(dbPath('members/' + key + '/teamId'));
        const done = () => {
          const activeRec = camps[CAMP.id];
          if (activeRec) { if (isTeamId(teamId)) activeRec.teamId = teamId; else delete activeRec.teamId; }
          showToast(isTeamId(teamId) ? `${who} is with ${teamName(teamId)}` : `${who} has no team`, { mine: true });
        };
        (isTeamId(teamId) ? ref.set(teamId) : ref.remove())
          .then(done)
          // A refusal here usually means the database rules predate team
          // assignments and still reject an unknown `teamId` field.
          .catch(() => { showToast("Couldn't save the team — the database rules may need updating."); renderMembers(); });
      });
    }

    const convert = row.querySelector('.member-add-signin');
    if (convert) convert.addEventListener('click', () => convertPendingMember(key, camps[CAMP.id] || rec, lists));

    // Pending rows only (real rows retire via the per-camp None switch).
    const rm = row.querySelector('.member-remove');
    if (rm) {
      rm.addEventListener('click', () => {
        if (self) return;
        if (!confirm(`Remove ${who}? They lose access the moment this saves.`)) return;
        firebase.database().ref(dbPath('members/' + key)).remove()
          .then(() => { showToast('Removed', { mine: true }); renderMembers(); })
          .catch(() => showToast('Remove refused — are you still an editor?'));
      });
    }
  });

  // One write for the whole seed list — a multi-path update, so it either all
  // lands or none of it does.
  const seedBtn = document.getElementById('member-seed-btn');
  if (seedBtn) {
    seedBtn.addEventListener('click', () => {
      const missing = missingSeedCounselors(activeMembers);
      if (!missing.length) { renderMembers(); return; }
      const patch = {};
      missing.forEach((c) => { patch[pendingKey(c.name)] = memberRecord('viewer', c.name, c.teamId); });
      firebase.database().ref(dbPath('members')).update(patch)
        .then(() => { showToast(`Added ${missing.length} counselor${missing.length === 1 ? '' : 's'}`, { mine: true }); renderMembers(); })
        // Same caveat as the team select: pre-team rules reject both the
        // `teamId` field and the `pending-…` keys these rows use.
        .catch(() => showToast("Couldn't add them — the database rules may need updating."));
    });
  }

  const addBtn = document.getElementById('member-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const errEl = document.getElementById('member-add-error');
      const raw = (document.getElementById('member-add-id').value || '').trim();
      const name = (document.getElementById('member-add-name').value || '').trim();
      const roleSeg = document.getElementById('member-add-role');
      const teamSel = document.getElementById('member-add-team') || body.querySelector('.member-add-team');
      const campsSeg = document.getElementById('member-add-camps');
      const teamId = (teamSel && teamSel.value) || '';
      const role = (roleSeg && roleSeg.value) === 'editor' ? 'editor' : 'viewer';
      const bothCamps = !!(campsSeg && campsSeg.value === 'both');
      // Auto-detect: anything with an @ is an email; a blank field means
      // "by name for now" (a pending row); otherwise a phone number.
      let key, shownId, pending = false;
      if (!raw) {
        if (!name) {
          errEl.textContent = 'Give at least a name — or an email/phone to let them sign in.';
          errEl.hidden = false;
          return;
        }
        key = pendingKey(name);
        shownId = name;
        pending = true;
      } else if (raw.includes('@')) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
          errEl.textContent = 'That doesn\'t look like an email address.';
          errEl.hidden = false;
          return;
        }
        key = emailKey(raw);
        shownId = raw;
      } else {
        key = phoneKey(raw);
        if (!key) {
          errEl.textContent = 'That doesn\'t look like a phone number. Include the area code (e.g. 555-123-4567).';
          errEl.hidden = false;
          return;
        }
        shownId = key; // the normalized +E.164 we're about to store — so they can eyeball it
      }
      if (!isValidMemberKey(key)) {
        errEl.textContent = 'That address has a character the database can\'t use as a key. Try another.';
        errEl.hidden = false;
        return;
      }
      // Only ever CREATE: someone already on the list keeps their role, name
      // and team (see planMemberAdd / createMemberIfAbsent).
      const plan = planMemberAdd({ key, pending, bothCamps, myKey, lists });
      if (plan.error) {
        errEl.textContent = plan.error;
        errEl.hidden = false;
        return;
      }
      errEl.hidden = true;
      // "Both camps" also writes the other camp's record (no team — teams
      // are per-camp). A pending row stays single-camp: its random key means
      // nothing to the other camp's list.
      const writes = plan.camps.map((cid) => createMemberIfAbsent(
        firebase.database().ref(campMembersPath(cid, key)),
        cid === CAMP.id ? memberRecord(role, name, teamId) : memberRecord(role, name)));
      Promise.all(writes)
        .then((created) => {
          if (!created.some(Boolean)) {
            // Another editor added them since this drawer loaded.
            errEl.textContent = 'Already on the list — change their access on their row below.';
            errEl.hidden = false;
            renderMembers();
            return;
          }
          showToast(pending ? shownId + ' added — no sign-in yet' : shownId + ' can now sign in', { mine: true });
          // A pending row can't sign in yet, so there's nothing to invite them to.
          lastInvite = pending ? null : inviteText(key, role);
          resetMemberAddForm(body); // done with it — the rebuild below must not carry it over
          renderMembers();
        })
        .catch(() => {
          errEl.textContent = 'Add refused — are you still an editor?';
          errEl.hidden = false;
        });
    });
  }

  // Invite banner: copy the ready-made message, or dismiss it.
  const inviteCopy = document.getElementById('member-invite-copy');
  if (inviteCopy) {
    inviteCopy.addEventListener('click', () => {
      copyTextToClipboard(lastInvite || '', inviteCopy);
    });
  }
  const inviteDismiss = body.querySelector('.member-invite-dismiss');
  if (inviteDismiss) {
    inviteDismiss.addEventListener('click', () => { lastInvite = null; renderMembers(); });
  }
}


function wireMembers() {
  const row = document.getElementById('members-row');
  if (row) row.addEventListener('click', openMembers);
}

// The mid-session way to change camps: the Junior / Senior control in More
// (wireSegs → switchCamp). Hidden unless this account is on both camps' lists —
// see updateAccountRow. Picking the other camp is the usual set-key-and-reload.
function wireCampSwitcher() {
  // However the camp picker closes (choice, backdrop, Escape), the deferred
  // team question gets its turn back.
  const overlay = document.getElementById('camp-picker-overlay');
  if (overlay) overlay.addEventListener('close', () => { maybeShowTeamPicker(); });
}

function wireHistory() {
  const row = document.getElementById('history-row');
  if (row) row.addEventListener('click', openHistory);
  // Backdrop, ✕, and Escape are the drawer's own; no extra wiring needed.
}

// Formats an ISO timestamp as camp time, e.g. "Jul 19, 8:47pm ET" —
// same convention as the schedule banner, so the footer always reads in
// camp time regardless of which timezone a visiting parent's phone is in.
function formatEasternStamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMP_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value;
  return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')}${(get('dayPeriod') || '').toLowerCase()} ET`;
}

// The footer line (version · data stamp · phones online) is More's footer now
// (renderMoreFoot). The presence count still lands here, so renderPresence keeps
// its name and just refreshes that line.
function renderFooter() {
  renderMoreFoot();
}

// ── State ────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Could not load saved state, starting fresh.', e);
  }
  return null;
}

function makeFreshState() {
  return {
    config: CAMP.defaultConfig(), // editable days/games catalog (More → Set up the week)
    teams: seedTeams(),
    results: {},   // gameId -> { medals: {gold, silver, bronze}, scores?, savedAt }
    brackets: {},  // gameId -> in-progress six-team tournament
    brackets4: {}, // gameId -> in-progress four-team tournament (its own node: a six-team build never reads or heals it)
    drafts: {},    // gameId -> in-progress tally/placement entry
    bonuses: {},   // bonusId -> { teamId, category, label, points, at }
    picSetup: {},  // gameId -> { source: 'pregenerated'|'own'|'numbered', words: [] } (Pictionary item source)
    live: {},      // gameId -> { key, inning, hr } live match tally (synced so everyone can watch)
    clocks: {},    // gameId -> { running, endAt, remaining, duration } synced game clock
    announcements: {}, // annId -> { id, text, at, by, ttlMs } broadcast messages; expire ttlMs after `at` (1h default)
    ui: { day: null, gameId: null }, // day is filled in by migrateState (needs config)
    theme: null,
  };
}

// The selected day is a config day id ('d1'...). Prefer the config day whose
// dow matches today in camp time; otherwise the first configured day.
function defaultDay(config) {
  const days = (config && config.days) || [];
  const todayDow = campNow().dow; // camp time (America/New_York), 0 Sun .. 6 Sat
  const today = days.find((d) => d.dow === todayDow);
  if (today) return today.id;
  return days.length ? days[0].id : null;
}

// Upgrades older-shaped state (or an imported backup) in place so the rest
// of the app only ever sees the current shape. Game ids never change here —
// saved results/brackets/picSetup stay keyed correctly. Also heals RTDB's
// empty-array pruning on config (games, days, rules), mirroring what
// normalizeSyncedState() does for the score state.
function migrateState(s) {
  let changed = false;
  if (!s.config || typeof s.config !== 'object') {
    s.config = CAMP.defaultConfig();
    changed = true;
  }
  const c = s.config;
  if (!c.version) { c.version = 1; changed = true; }
  if (!Array.isArray(c.games)) { c.games = []; changed = true; }
  if (!Array.isArray(c.days)) { c.days = []; changed = true; }
  if (!Array.isArray(c.sessions) || !c.sessions.length) {
    c.sessions = ['Morning', 'Evening'];
    changed = true;
  }
  c.games.forEach((g) => {
    if (g.day !== undefined) {
      if (!g.dayId) g.dayId = 'd' + g.day;
      delete g.day;
      changed = true;
    }
    if (!Array.isArray(g.rules)) { g.rules = []; changed = true; }
    g.rules.forEach((sec) => {
      if (!Array.isArray(sec.items)) { sec.items = []; changed = true; }
    });
  });
  // One-shot catalog upgrades. The stored/synced config (campScoreboard/config)
  // overrides defaults.js on every device, so editing a game's defaults there
  // never reaches an existing week — these back-fills do, then push themselves
  // up via applyRemoteConfig/saveConfig. Guarded by c.version so a later manual
  // edit (e.g. removing the timer) isn't undone on the next load.
  if ((c.version || 1) < 2) {
    const ww = c.games.find((g) => g.id === 'waiter-water-chain');
    if (ww && !ww.timer) ww.timer = { label: 'Game clock', presets: [600] };
    c.version = 2;
    changed = true;
  }
  if ((c.version || 1) < 3) {
    // Counselor Hide and Seek: score buttons are +5 (counselor) / +1, with a
    // single −1 button (was +5/+10, then briefly +5/+1 with a −5 button — a
    // defaults.js-only edit made before this migration system existed, so it
    // likely never reached the synced config either). Force the final shape
    // directly rather than special-casing the intermediate state.
    const hs = c.games.find((g) => g.id === 'counselor-hide-seek');
    if (hs) {
      hs.counterSteps = [1, 5];
      hs.counterStepLabels = { 5: 'counselor' };
    }
    c.version = 3;
    changed = true;
  }
  if ((c.version || 1) < 4) {
    // Counselor Hide and Seek: all teams play at once (no bracket), so give it
    // the same all-teams liveRankings treatment as Inflatable Bowling/Cider
    // Survivor — it now shows as a live row on Now (and a live board in its own
    // takeover) with every team's running score, updating in real time as the
    // ref taps points, plus its game clock.
    const hs2 = c.games.find((g) => g.id === 'counselor-hide-seek');
    if (hs2) hs2.liveRankings = true;
    c.version = 4;
    changed = true;
  }
  if ((c.version || 1) < 5) {
    // Patrick's call, Thursday evening 2026-07-23: everything tonight and all
    // of Friday counts DOUBLE (meal cleanup excluded — that's handled in
    // bonusCountsDouble, not here). Flag Thursday-evening games and every
    // Friday game. Because medalCounts() weights at computation time, this
    // retroactively doubles already-saved results (Counselor Hide and Seek).
    // Friday's morning games were already flagged; this catches Team Skits
    // and any games added/moved since.
    const doubleDayIds = { evening: [], all: [] };
    (c.days || []).forEach((d) => {
      if (d.dow === 4) doubleDayIds.evening.push(d.id);
      if (d.dow === 5) doubleDayIds.all.push(d.id);
    });
    c.games.forEach((g) => {
      if (doubleDayIds.all.includes(g.dayId) ||
          (doubleDayIds.evening.includes(g.dayId) && g.session === 'Evening')) {
        g.messtival = true;
      }
    });
    c.version = 5;
    changed = true;
  }
  if (!s.ui) { s.ui = { day: null, gameId: null }; changed = true; }
  if (typeof s.ui.day === 'number') { s.ui.day = 'd' + s.ui.day; changed = true; }
  if (!s.ui.day || !c.days.some((d) => d.id === s.ui.day)) {
    s.ui.day = defaultDay(c);
    changed = true;
  }
  return changed;
}

let state = loadState() || makeFreshState();
if (!state.teams || !state.results) state = makeFreshState();
if (!state.ui) state.ui = { day: null, gameId: null };
if (!state.meta) state.meta = {};
if (!state.bonuses) state.bonuses = {}; // extra/bonus points ledger
if (!state.live) state.live = {}; // live match tallies (synced; see liveTracker)
if (!state.clocks) state.clocks = {}; // per-game synced clocks (see getClock/setClock)
if (!state.announcements) state.announcements = {}; // broadcast messages (see renderAnnouncements)
// state.notice is the big top-of-page notice board (see defaultNotice); it's
// seeded to the example DRAFT by normalizeNotice, so nothing shows until posted.
if (state.theme === undefined) state.theme = null; // pre-theme saves: follow the device
if (state.notify === undefined) state.notify = false; // device-local, not synced (see SYNC_KEYS)
// state.followTeam stays `undefined` until the picker is answered (a team id,
// or null for "neutral/no team") — device-local, not synced.
// state.identity is the counselor this device belongs to, and is deliberately
// left tri-state (device-local, not synced): `undefined` = never asked (so we
// can proactively prompt on next launch), `null` = asked and skipped ("just
// cheering"), or a name string. JSON.stringify drops undefined, so "never
// asked" round-trips through localStorage naturally — same as followTeam.
if (migrateState(state)) {
  // Persist the upgraded shape right away (saveState() isn't safe yet —
  // the sync globals below haven't been initialized at this point). The tab is
  // not a decided writer yet, so this is OWED and made once it is (persistState).
  persistState();
}
normalizeSyncedState();

// Who's with this team, everywhere the app names a team's counselors. The
// member directory is the live truth once anyone is assigned to a team in
// More → Who can sign in; the hand-typed team.counselor text is the
// fallback for teams nobody has been assigned to yet (and for the moment
// before the directory loads).
function counselorName(id) {
  const staff = teamStaffNames(id);
  // Respelled on the way out (respellCounselorText): the stored text — a team's
  // typed counselor line, a member row's name — can still carry the old spellings.
  if (staff.length) return respellCounselorText(staff.join(', '));
  const t = state.teams.find((t) => t.id === id);
  return t && t.counselor ? respellCounselorText(t.counselor) : '';
}

function saveState() {
  // A save made before the first server snapshot lands is "unsynced local
  // work" — track it so the first snapshot can defend it instead of blindly
  // adopting a stale remote copy (see the initSync merge). Set before the
  // write so a quota/private-mode throw doesn't skip the flag.
  if (!remoteReady) dirtySinceLoad = true;
  // A failed write (private mode / quota) is warned about inside persistState:
  // cloud + in-memory state still work, so the Save button must not look dead.
  persistState();
  if (!applyingRemote) schedulePush();
}

// Stamps "when real scoreboard data last changed" for the footer — a
// result saved, a bracket match recorded, or a team renamed. Deliberately
// NOT called for view-only actions (day tab, theme, PIN) so it reflects
// actual camp activity, not just page traffic.
// Synced writes that are NOT scoreboard activity still come through here, for
// the dataEditPending guard: a clock Start/Pause/Reset (and the buzzer's own
// settle) passes { stamp: false, celebrate: false }, and undo-style live-score
// taps (goal −, inning, outs, Reset tally) pass { celebrate: false } — the
// confetti used to fire on all of them, and on every editor's phone at 0:00.
function touchData(opts) {
  const o = opts || {};
  if (!state.meta) state.meta = {};
  if (o.stamp !== false) state.meta.lastDataChangeAt = new Date().toISOString();
  dataEditPending = true; // real edit queued — guard it until it's pushed
  if (o.celebrate !== false) joyCelebrate(); // every real data save gets a little celebration
}

// ── Per-card "hide from viewers" (editor-only, synced) ───────────
// state.meta.hiddenCards is a { cardKey: true } map — a card listed there is
// hidden on view-only devices (e.g. suspense before an awards reveal).
// Editors always see every card, each with the switch that governs it. These
// are NOT touchData() moments: a display preference isn't scoreboard
// activity, so they don't bump "Data last updated".
//
// Keys match the data-card attributes in index.html (and the switches'
// data-hide-card, in the What counselors see sheet). Four sections carry a switch
// (competitions = the Games tab's list, verse, cleanup, chat — the Chat tab shows
// "Chat is turned off right now" instead of hiding). The other two, standings and bonus, are listed too so the one code
// path handles every card, but they have no switch: they are SECRET_CARDS below,
// hidden from every non-director whatever this map says.
const HIDEABLE_CARDS = ['competitions', 'standings', 'verse', 'cleanup', 'bonus', 'chat'];

// The two cards that ARE the standings (the table, and the quick-points ledger
// that feeds it). They are hidden from every non-director in code whatever
// meta.hiddenCards says, so there is nothing for a director to switch (the cards
// carry a "Counselors can't see this" note instead of the switch) and no
// un-hiding that could expose them. The keys are STILL written into
// meta.hiddenCards (ensureSecrecySeed) for one reason only: a phone that has not
// updated yet runs the old code, which honours that map and nothing else.
const SECRET_CARDS = ['standings', 'bonus'];

// Keeps the two secret cards' keys in meta.hiddenCards for builds that predate
// SECRET_CARDS (see there): a not-yet-updated counselor phone hides the table
// and the quick-points ledger from the map alone, and it re-reads the map on
// every snapshot, so it is safe the moment a director build has seen the server.
// Idempotent and cheap: it writes only when a key is missing, so an old
// director build that un-hid a card is set right again by the next new one.
// Directors only (a counselor's phone can't write the node), only once the
// first snapshot has landed (a write before it would queue stale state), and
// only with sync on. Deliberately NOT in normalizeSyncedState, which runs for
// everyone and on every load.
function ensureSecrecySeed() {
  if (!canEdit() || !standingsVisible() || !syncEnabled() || !remoteReady) return;
  if (!state.meta) state.meta = {};
  if (!state.meta.hiddenCards || typeof state.meta.hiddenCards !== 'object') state.meta.hiddenCards = {};
  let changed = false;
  SECRET_CARDS.forEach((k) => {
    if (state.meta.hiddenCards[k] !== true) { state.meta.hiddenCards[k] = true; changed = true; }
  });
  if (changed) saveState();
}

function cardHiddenFromViewers(card) {
  if (SECRET_CARDS.includes(card)) return true;
  const m = state.meta || {};
  if (m.hiddenCards && m.hiddenCards[card]) return true;
  // Legacy single-purpose flag from the standings-only version of this
  // feature. Still honored so a device running the older build that pushes
  // the old shape can't silently un-hide the table mid-camp.
  if (card === 'standings' && m.standingsHidden) return true;
  return false;
}

function toggleCardHidden(card) {
  if (!canEdit()) return; // the switch lives in a director's sheet; the function holds the same line (and a preview's)
  if (!HIDEABLE_CARDS.includes(card) || SECRET_CARDS.includes(card)) return;
  if (!state.meta) state.meta = {};
  const wasHidden = cardHiddenFromViewers(card);
  if (!state.meta.hiddenCards) state.meta.hiddenCards = {};
  if (wasHidden) {
    delete state.meta.hiddenCards[card];
    if (card === 'standings') delete state.meta.standingsHidden; // retire the legacy flag
  } else {
    state.meta.hiddenCards[card] = true;
  }
  saveState();
  renderAll();
}

// Applies every section's hidden state and syncs the switches (What counselors
// see, More → Director). Runs from renderAll (before renderGameView, which depends
// on the competitions result). A section the viewer may not see is hidden where
// it lives — the Games list, More's Memory verse / Meal cleanup rows, the standings
// section — and a reading sheet already open for it is closed, so a later un-hide
// never surfaces it already on screen.
function applyCardVisibility() {
  // The person's ROLE, not this tab's write lock (tabWriter): a director's second,
  // view-only tab still shows every section the first one does. (viewRole, not memberRole: a counselor preview
  // hides exactly what a counselor's phone hides.)
  const editor = viewRole() === 'editor';
  const seeStandings = standingsVisible(); // the secret sections follow the confirmed role
  // styles.css shows the footer sync line for a view-only device ONLY while the
  // Current Standings section (which carries the same line) is not on the page — a
  // director's view-only second tab has it, and would read it twice.
  document.documentElement.classList.toggle('standings-shown', seeStandings);
  HIDEABLE_CARDS.forEach((key) => {
    const hidden = cardHiddenFromViewers(key);
    const hideForMe = (hidden && !(SECRET_CARDS.includes(key) ? seeStandings : editor)) || (!editor && cardEmptyForViewers(key));
    const card = document.querySelector(`[data-card="${key}"]`);
    if (card) {
      setHiddenIfChanged(card, hideForMe);
      if (hideForMe && shell.sheets.includes(key)) shellSheetClose(key); // verse / cleanup
    }
    // ON = counselors see it (the data is still "hidden from viewers").
    const sw = document.querySelector(`.hide-card-toggle[data-hide-card="${key}"]`);
    if (sw && sw.hasAttribute('checked') === hidden) sw.toggleAttribute('checked', !hidden);
    setTextIfChanged(document.querySelector(`[data-hide-state="${key}"]`), hidden ? 'Hidden' : 'Shown');
  });
  // The Games tab says why it is empty for a counselor the directors turned it off for.
  setHiddenIfChanged(document.getElementById('games-off'), !(!editor && cardHiddenFromViewers('competitions')));
  // A viewer must not keep reading a game detail out of a hidden Competitions
  // list. Cleared here (not saved) so the renderGameView later in this same
  // pass closes the view.
  if (!editor && cardHiddenFromViewers('competitions') && state.ui.gameId) {
    state.ui.gameId = null;
  }
}

// ONE way to write the camp's name in the frame (§8.2, sentence case): "Junior camp". The calendar's X-WR-CALNAME keeps the plain label.
function campWord() { return String(CAMP.label || 'Camp').replace(/\bCamp\b/, 'camp'); }

// ── Cloud sync (Firebase Realtime Database) ──────────────────────
// Optional. If window.FIREBASE_CONFIG is filled in (firebase-config.js)
// and the SDK loaded, scores sync across every device in real time.
// Otherwise the app runs exactly as before, local-only.

const SYNC_KEYS = ['teams', 'results', 'brackets', 'brackets4', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'meta', 'clocks', 'announcements', 'notice'];
let fbRef = null;
// Per-tab id for the "who's here" presence chip — minted once per page load
// (not persisted) so each open tab counts, and cleans up, independently. It is
// the SECOND path segment: presence/<memberKey>/<deviceId>. It used to be a
// flat, caller-chosen key, which meant any member could overwrite or delete any
// OTHER member's presence row and mint unlimited rows; nesting under the member
// key lets the rules pin the whole subtree to the writer's own identity.
const presenceId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : newBonusId();
let presenceCount = 0;
// The presence tree as the listener last heard it (member -> device -> {at}): setup-sync.js's Devices
// list joins it with editorsHere by device id. Null until the first snapshot.
let presenceRows = null;

// Claim this tab's presence row and arrange for it to vanish when the socket
// drops. Called on every (re)connect, because onDisconnect handlers don't
// survive a dropped socket. Entirely best-effort — a rules refusal arrives as a
// promise REJECTION rather than a throw, so each call needs its own .catch or
// it surfaces as an unhandled rejection. Nothing but the footer chip reads this.
function registerPresence() {
  if (!fbConnected || typeof firebase === 'undefined') return;
  const myKey = identityKey(authUser);
  if (!myKey) return;
  try {
    const pRef = firebase.database().ref(dbPath('presence/' + myKey + '/' + presenceId));
    pRef.onDisconnect().remove().catch(() => {});
    // `at` is the only field. The row used to also carry `role`, which nothing
    // ever read and which the writer simply declared — a viewer could write
    // 'editor'. RTDB can't store an empty object, so one field has to stay.
    pRef.set({ at: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  } catch (e) { /* chip stays hidden */ }
}

// How many devices are here, counting the nested shape only. Rows in the old
// flat shape (presence/<uuid> = {role, at}) are IGNORED rather than counted:
// under the member-keyed rules NO client can delete one — not even the tab that
// wrote it — so counting them would permanently double-count every device that
// reloads into this build. Briefly under-reporting heals itself; over-reporting
// would not. (Clearing the presence node from the console once, right after the
// rules paste, retires the last of them.)
function presenceDeviceCount(tree) {
  if (!tree || typeof tree !== 'object') return 0;
  let n = 0;
  Object.keys(tree).forEach((memberKey) => {
    const devices = tree[memberKey];
    if (!devices || typeof devices !== 'object') return;
    if (typeof devices.at === 'number') return; // legacy flat row — skip
    Object.keys(devices).forEach((d) => { if (devices[d] && typeof devices[d] === 'object') n += 1; });
  });
  return n;
}
let applyingRemote = false;
let pushTimer = null;
// No pushes until the first server snapshot has landed. Without this, a
// device on slow camp wifi that saves anything (even a day-tab tap) before
// its first sync queues a set() of its stale local state — and the SDK
// delivers that on connect, wiping everyone's newer scores.
let remoteReady = false;
// True once anything has been saved locally before the first snapshot landed.
// Lets the first-snapshot merge defend offline-entered results instead of
// silently replacing them with a stale server copy.
let dirtySinceLoad = false;
// True while a *data* edit (touchData) is queued but not yet pushed. The merge
// uses this — not the raw pushTimer — to decide whether to hold off adopting a
// snapshot, so view-only saves (day tab, theme, notify, follow-team) never
// block an incoming update or its notification.
let dataEditPending = false;
// Count of local writes handed to the server (fbRef.set) that it hasn't
// confirmed committed yet. While offline, a queued set()'s promise stays
// pending, so this stays > 0 — and the merge uses it to refuse to adopt the
// server's PREVIOUS value (the snapshot that re-fires on reconnect) until our
// cached edit has actually uploaded. This is what stops scores being typed /
// saved offline from getting reverted by a stale reconnect snapshot.
let pendingWrites = 0;
// The same, for the week-config node (the builder's games/days catalog), which
// has its own sibling ref and used to be invisible to every "is anything still
// unsent?" guard: an auto-reload or a sign-out right after a builder save threw
// the in-memory offline queue away. pendingWritesTotal() is what those guards
// ask; canAdoptRemote() deliberately stays about `state` only — a config write
// in flight doesn't make a SCORES snapshot unsafe to adopt.
let pendingConfigWrites = 0;
// (+ the setup engine's pushes in flight — setup-sync.js, typeof-guarded like every optional layer)
function pendingWritesTotal() { return pendingWrites + pendingConfigWrites + (typeof setupPendingCount === 'function' ? setupPendingCount() : 0); }
// The config's first-pull gate, twin of `remoteReady`: false until the first
// config snapshot has been PROCESSED (it waits for the state's first pull, whose
// epoch it needs — see onConfigSnapshot). Until then nothing is pushed (the
// null-seed aside). A device holding a confirmed baseline (state._cfgBase) may
// edit the catalog meanwhile: those edits are three-way merged when the snapshot
// lands (firstConfigMerge). A device with NO baseline (its first run of this
// engine) stays read-only (configEditable): nothing could tell its edit apart
// from the cached copy, and the first snapshot replaces that copy.
let configReady = false;
// The first config snapshot, when it arrived before the state's first pull;
// processed the moment that pull lands (handleRemoteSnapshot). { remote } or null.
let cfgFirstPending = null;
// A config push asked for while a transaction was still in flight: it runs the
// moment that one settles (one transaction at a time — see pushConfig).
let configPushOwed = false;
// The synced state as we last knew it on the server — the baseline the next
// push diffs against so it writes ONLY the items this device changed (per-path
// update), instead of overwriting the whole tree and clobbering edits another
// device made to other items. null means "resync the whole tree next push"
// (before the first push, or to recover after a failed one). Updated on every
// adopt (in the value handler) and every push.
let lastSyncedTree = null;
// The synced tree exactly as it was when this page loaded (the cached copy) — the
// baseline for 'what did THIS device change before the first snapshot arrived'.
let bootSyncedTree = null;
// The synced tree the SERVER is known to hold — advanced only by events the
// server confirmed (adopting a snapshot; a push's update() resolving), never
// optimistically. It rides INSIDE the cached state (state._syncBase), because
// the SDK's offline write queue lives in memory only: after a force-quit, an
// iOS eviction or a reload, this is the only way to tell "saved on this phone
// but never uploaded" apart from "the server has it" — and storing it in the
// SAME localStorage write as the scores means the pair can never disagree (a
// failed write, e.g. quota, leaves the previous consistent pair, so a stale
// cache can never masquerade as a deletion). Not synced (not in SYNC_KEYS)
// and not in backups (backupJSON lists its keys). See firstSnapshotMerge.
let confirmedTree = null;

function readConfirmedTree() {
  const v = state && state._syncBase;
  return v && typeof v === 'object' && !Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : null;
}

function writeConfirmedTree(tree, persistNow) {
  confirmedTree = tree;
  state._syncBase = tree;
  state._syncBaseAt = Date.now(); // when the server last confirmed anything to this phone
  // (A failed write leaves the previous consistent pair; a tab that no longer owns
  // the cache — an ack arriving after demotion — writes nothing: persistState.)
  if (persistNow) persistState();
}

// The editable week config (days/games catalog) syncs on its own sibling ref
// (campScoreboard/config) — deliberately OUTSIDE campScoreboard/state so older
// cached clients, and the state node's own key-list bookkeeping (SYNC_KEYS /
// SYNC_ITEM_MAPS / the merge's replace list), never have to know about it.
// The node is still ONE array-shaped object (old builds read it unchanged), but
// since the config engine v2 (below) nobody writes it whole: edits travel as
// id-keyed field ops applied by a transaction to the server's CURRENT value.
let fbConfigRef = null;
// The newest week-config snapshot the listener has handed over (canonical form) and how many it has handed over: a commit's own
// completion can arrive AFTER a colleague's newer snapshot, see cfgPushCommitted.
let cfgLastRemote = null;
let cfgRemoteSeq = 0;
let pushConfigTimer = null;
let applyingRemoteConfig = false;

// ── Shared clock reference ───────────────────────────────────────
// The synced game clock stores an absolute `endAt` and every device counts down
// to it locally (see getClock/clockRemaining) — which silently assumed every
// phone agreed on the current time. They don't: a handset whose clock is a
// couple of minutes off showed a countdown that far wrong on the Big Board, and
// a second EDITOR device with a fast clock would hit zero early, sound the
// buzzer, and stop the synced clock for everyone.
//
// RTDB publishes the difference between the server's clock and this device's at
// `.info/serverTimeOffset`, so serverNow() is the same instant on every device
// that has ever connected. With sync off (or before the first connect) the
// offset is 0 and this is exactly Date.now() — identical to the old behavior.
//
// The last estimate is kept in localStorage (device-wide, not camp data, not wiped on sign-out:
// it describes this phone's clock, nothing else) so a phone that opens OFFLINE at 7:58 still
// knows what time the server thinks it is: the standings reveal hides at 8:00 by the server's
// clock, and a phone that fell back to its own clock could show a grid minutes after it.
const SERVER_OFFSET_KEY = 'campScoreboardServerOffset';
const SERVER_OFFSET_MAX_MS = 7 * 24 * 3600 * 1000; // a stored value this large is junk, not a clock
function readStoredServerOffset() {
  try {
    const raw = localStorage.getItem(SERVER_OFFSET_KEY);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) && Math.abs(v) <= SERVER_OFFSET_MAX_MS ? v : 0;
  } catch (e) { return 0; }
}
function rememberServerOffset(off) {
  try { localStorage.setItem(SERVER_OFFSET_KEY, String(Math.round(off))); } catch (e) { /* the next connect refreshes it */ }
}
let serverTimeOffset = readStoredServerOffset();
// Has this phone EVER learned the server's clock (a remembered estimate or a live answer)? A brand-new install
// has serverNow() === Date.now() until the first `.info/serverTimeOffset` answer, and the standings reveal's
// 3-second hold-back of the newest place is measured against it: a phone whose own clock runs fast could show
// a place before the room hears it. revealViewOf passes `clockUnknown` while this is false and revealView
// holds the newest place back, failing closed, until the first answer (the handler below re-runs the reveal).
// Written with the estimate (even a tiny one) so a later launch knows at once.
function readStoredServerOffsetKnown() {
  try {
    const raw = localStorage.getItem(SERVER_OFFSET_KEY);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) && Math.abs(v) <= SERVER_OFFSET_MAX_MS;
  } catch (e) { return false; }
}
let serverOffsetKnown = readStoredServerOffsetKnown();

function serverNow() {
  return Date.now() + serverTimeOffset;
}

function syncEnabled() {
  return !!fbRef;
}

// ══ Config engine v2 (setup-rebuild-spec §6.3 / §7.1 core — build step 9, "S3") ═══
// The root fix for scoring#3. The week catalog (campScoreboard/config: days +
// games) used to be written WHOLE, so a director saving from a stale copy erased
// every other director's edit. Now:
//   • An edit is a set of FIELD OPS keyed by record id (`games/<gid>/<field>`,
//     `days/<id>/<field>`; a record add/delete is the whole record / null; a
//     reorder is a change of its `_o`). Ops are measured against `state._cfgBase`,
//     the config the server last CONFIRMED to this phone, which rides in the SAME
//     STORAGE_KEY write as `state.config` (the `_syncBase` rule: the pair can't
//     disagree). Unconfirmed work = treeDiff(_cfgBase, config), so it survives a
//     reload or a force-quit.
//   • A push is a TRANSACTION that applies those ops to the server's CURRENT value
//     (applyOpsSafe: an op into a record somebody deleted is dropped and listed
//     under "Put it back"). Nobody set()s the node any more.
//   • A snapshot is REBASED — server + my unconfirmed ops — never stashed or
//     swapped in. Data applies at once, even mid-entry; only the repaint waits for
//     a focused field (renderAllWhenIdle).
//   • The FIRST snapshot after load is a three-way merge, like the state engine's.
// The node itself is unchanged (the same five-key, array-shaped object), so old
// builds read it fine; their whole set() still lands (it can only clobber from a
// device that hasn't reloaded).
// CFG_DEPTHS: how far treeDiff recurses before a value is one leaf (version and
// sessions whole; each game/day FIELD is a leaf — rules, timer, liveTracker… are
// written whole). CFG_ANCHORS: how many path segments name a record, so applyOpsSafe
// can tell a field op into a vanished record from one into a live record.
const CFG_DEPTHS = { version: 1, sessions: 1, days: 3, games: 3 };
const CFG_ANCHORS = { days: 2, games: 2 };
const CFG_STALE_MS = 36 * 60 * 60 * 1000; // unconfirmed longer than this asks before it is sent (as the state engine does)
const CFG_NOTES_MAX = 30;

// An array, or the index-keyed map RTDB hands back for a sparse one, as a list.
function cfgList(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    return Object.keys(v).sort((a, b) => (Number(a) - Number(b)) || (a < b ? -1 : a > b ? 1 : 0)).map((k) => v[k]);
  }
  return [];
}

// The map key a record goes by: its id (a '/' would split the path), else its position.
function cfgKey(rec, i) {
  const id = rec && typeof rec.id === 'string' && rec.id ? rec.id : '~' + i;
  return id.replace(/\//g, '%2F');
}

function cfgKeyed(list) {
  const out = {};
  cfgList(list).forEach((rec, i) => {
    if (!rec || typeof rec !== 'object') return;
    let key = cfgKey(rec, i);
    while (out[key]) key += '~'; // a duplicate id (a hand-edited backup) keeps both records
    out[key] = Object.assign({}, rec, { _o: i });
  });
  return out;
}

// Canonical id-space — for diff and merge ONLY, never stored on the server.
function cfgCanon(c) {
  const src = c && typeof c === 'object' ? c : {};
  return syncCanon({ version: src.version, sessions: src.sessions, days: cfgKeyed(src.days), games: cfgKeyed(src.games) }) || {};
}

// A keyed map back to a list ordered by (_o, key). A record whose canonical form
// is unchanged keeps the object it already was (`prevList`): open views, the game
// editor's lookups and the render-stability rules all lean on identity per record.
function cfgUnkeyed(map, prevList) {
  const prevByKey = {};
  cfgList(prevList).forEach((rec, i) => { if (rec && typeof rec === 'object') prevByKey[cfgKey(rec, i)] = rec; });
  const orderOf = (r) => (typeof r._o === 'number' ? r._o : Infinity);
  return Object.keys(map && typeof map === 'object' ? map : {})
    .map((key) => ({ key, rec: map[key] }))
    .filter((e) => e.rec && typeof e.rec === 'object')
    .sort((a, b) => {
      const ao = orderOf(a.rec), bo = orderOf(b.rec);
      if (ao !== bo) return ao < bo ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .map(({ key, rec }) => {
      const plain = Object.assign({}, rec);
      delete plain._o;
      const prev = prevByKey[key];
      return prev && JSON.stringify(syncCanon(prev)) === JSON.stringify(plain) ? prev : plain;
    });
}

function cfgFromCanon(t, updatedAt, prev) {
  const tree = t || {};
  const out = {};
  if (tree.version !== undefined) out.version = tree.version;
  if (updatedAt) out.updatedAt = updatedAt;
  if (tree.sessions !== undefined) out.sessions = tree.sessions;
  out.days = cfgUnkeyed(tree.days, prev && prev.days);
  out.games = cfgUnkeyed(tree.games, prev && prev.games);
  return out;
}

function cfgValueAt(tree, path) {
  const v = syncValueAt(tree, path);
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

// A position is `_o`, and every insert, delete and move AHEAD of a record rewrites it,
// so a record's `_o` changing is usually somebody else's edit renumbering it — not a
// touch of the record itself. The merge never lets one count as a clash.
function cfgIsOrderPath(p) {
  return String(p).split('/')[2] === '_o';
}

// A record without its position (what "is this the same game?" compares).
function cfgStripOrder(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !('_o' in v)) return v;
  const c = Object.assign({}, v);
  delete c._o;
  return c;
}

function cfgLater(a, b) {
  return String(a || '') >= String(b || '') ? (a || undefined) : b;
}

// The confirmed baseline (canonical form) or null on a device that never had one.
function cfgBaseTree() {
  const b = state && state._cfgBase;
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

// Advance the baseline to what the server confirmed. One persistState carries it
// together with state.config — the pair is never written apart.
function writeCfgBase(tree) {
  state._cfgBase = tree;
  state._cfgBaseAt = Date.now();
  state._cfgBaseEpoch = (state.meta && state.meta.epoch) || '';
  persistState();
}

// What this phone changed that the server hasn't confirmed ({} when none, or on a
// device with no baseline to measure against).
function cfgUnconfirmed() {
  const base = cfgBaseTree();
  return base ? treeDiff(base, cfgCanon(state.config), CFG_DEPTHS) : {};
}

// ── Words for a path (toasts, notes, the stranded download) ──────────
const CFG_FIELD_LABELS = {
  name: 'name', emoji: 'emoji', dayId: 'day', session: 'session', location: 'location', format: 'format',
  headline: 'tagline', rules: 'rules', timer: 'timer', liveTracker: 'scoreboard', messtival: 'double points',
  note: 'note', dow: 'day of the week', prompts: 'drawing prompts', _o: 'order',
};

function cfgWhat(path, ...trees) {
  const parts = String(path).split('/');
  if (parts[0] === 'version') return 'the week setup version';
  if (parts[0] === 'sessions') return 'the session names';
  if (parts[0] === 'games' || parts[0] === 'days') {
    let name = parts[1];
    for (const t of trees) {
      const rec = t && t[parts[0]] && t[parts[0]][parts[1]];
      if (rec && rec.name) { name = rec.name; break; }
    }
    const noun = parts[0] === 'games' ? 'game' : 'day';
    const field = parts[2] ? (CFG_FIELD_LABELS[parts[2]] || parts[2]) : '';
    return field ? `${noun} “${name}” · ${field}` : `${noun} “${name}”`;
  }
  return String(path);
}

function cfgShow(v) {
  if (v === null || v === undefined) return 'nothing';
  if (typeof v === 'string') return v === '' ? 'blank' : '“' + (v.length > 40 ? v.slice(0, 40) + '…' : v) + '”';
  if (typeof v === 'object') { const j = JSON.stringify(v); return j.length > 40 ? j.slice(0, 40) + '…' : j; }
  return String(v);
}

// ── Notes: what a merge or a rebase set aside instead of dropping ─────
// `state._cfgNotes` rides in the STORAGE_KEY blob (not synced, not in a backup),
// so a clash or a vanished record is still waiting after a reload. Two kinds:
//   putback  an edit of mine hit a record somebody deleted — { section, key, name,
//            record (canonical, with _o) }: Put it back with my changes / Discard
//   clash    the same field was changed on both sides while I was offline and the
//            server's value won — { path, mine, theirs, what }: Use mine / Dismiss
// More → Set up the week shows them (settings.js renderConfigNotes).
function cfgNotes() {
  const n = state && state._cfgNotes;
  return Array.isArray(n) ? n : [];
}

function cfgSetNotes(list) {
  if (list.length) state._cfgNotes = list.slice(-CFG_NOTES_MAX);
  else delete state._cfgNotes;
  persistState();
  if (appStarted && state.ui && state.ui.view === 'settings') renderAllWhenIdle();
}

function cfgNoteId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function cfgDropNote(id) {
  cfgSetNotes(cfgNotes().filter((n) => n.id !== id));
}

// Ops that were dropped because their record is gone on the server. `localCanon`
// is this phone's config at that moment — it still holds the record, with my edits.
function cfgNoteDropped(dropped, localCanon) {
  const records = {};
  dropped.forEach((d) => { (records[d.record] = records[d.record] || []).push(d); });
  const added = [];
  Object.keys(records).forEach((rp) => {
    const [section, key] = rp.split('/');
    // `collide`: not a record somebody removed, but a NEW one of mine that met a different
    // record under the same id (two phones minted it at once) — set aside, not overwritten.
    // The record is taken from the op itself: this phone's copy under that id may already
    // be the other one's (a snapshot got there first), and the same collision is reported
    // by the snapshot AND by my push's commit — once is enough.
    const collideOp = records[rp].find((d) => d.collide);
    const collide = !!collideOp;
    const rec = collide ? syncCanon(collideOp.value) : localCanon && localCanon[section] && localCanon[section][key];
    if (!rec) return;
    if (collide && cfgNotes().some((n) => n.kind === 'putback' && n.collide && n.section === section && n.key === key &&
      JSON.stringify(cfgStripOrder(n.record)) === JSON.stringify(cfgStripOrder(rec)))) return;
    // A bare reorder of something that is gone isn't worth a question.
    if (records[rp].every((d) => cfgIsOrderPath(d.path))) return;
    added.push({ id: cfgNoteId(), kind: 'putback', section, key, name: rec.name || key, record: rec, at: new Date().toISOString(), ...(collide ? { collide: true } : {}) });
  });
  if (!added.length) return;
  cfgSetNotes(cfgNotes().filter((n) => !(n.kind === 'putback' && added.some((a) => a.section === n.section && a.key === n.key))).concat(added));
  const gone = added.filter((a) => !a.collide);
  const clashed = added.filter((a) => a.collide);
  const quoted = (list) => list.map((a) => '“' + a.name + '”').join(', ');
  if (gone.length) showToast(`⚠️ ${quoted(gone)} ${gone.length === 1 ? 'was' : 'were'} removed while you were editing. More → Set up the week can put ${gone.length === 1 ? 'it' : 'them'} back with your changes.`);
  if (clashed.length) showToast(`⚠️ ${quoted(clashed)} couldn’t be added: somebody added a different one with the same id at the same moment. More → Set up the week can add ${clashed.length === 1 ? 'it' : 'them'} again under ${clashed.length === 1 ? 'a new id' : 'new ids'}.`);
}

// The games or days list of a config (a parameter, not `state.config`: the seam scan
// reads that literally and a computed key would trip it).
function cfgSectionList(config, section) {
  const key = section === 'games' ? 'games' : 'days';
  if (!Array.isArray(config[key])) config[key] = [];
  return config[key];
}

// A key no record in `section` carries yet: `base` + a random 4-char tail (the same
// shape settings.js gives a new game's id, so a re-keyed record looks like any other).
function cfgFreshKey(section, base) {
  const taken = new Set(cfgSectionList(state.config, section).map((r, i) => cfgKey(r, i)));
  const stem = String(base || 'item').replace(/-[a-z0-9]{4}$/, '').replace(/[^A-Za-z0-9-]/g, '') || 'item';
  let key;
  do { key = stem + '-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0'); } while (taken.has(key));
  return key;
}

// Put a removed record back, with my edits, as an ordinary (undoable) config commit.
// A `collide` note (my NEW record met a different one under the same id) adds it again
// under a fresh id instead — the other record is somebody's and stays.
function cfgPutBack(noteId) {
  const note = cfgNotes().find((n) => n.id === noteId && n.kind === 'putback');
  if (!note) return false;
  if (!canEdit() || !configEditable()) { showToast('The games list isn’t ready to edit yet — try again in a moment.'); return false; }
  const rec = Object.assign({}, note.record);
  const order = rec._o;
  delete rec._o;
  const noun = note.section === 'games' ? 'game' : 'day';
  let exists = false;
  configEdit(`${note.collide ? 'Added' : 'Put back'} ${noun} “${note.name}”`, () => {
    const list = cfgSectionList(state.config, note.section);
    if (list.some((r, i) => r && cfgKey(r, i) === note.key)) {
      if (!note.collide) { exists = true; return false; }
      rec.id = cfgFreshKey(note.section, note.key);
    }
    list.splice(typeof order === 'number' ? Math.min(order, list.length) : list.length, 0, rec);
    migrateState(state); // heal what the canonical form pruned (a game's empty rules[]), as cfgApplyPaths does
  });
  cfgDropNote(noteId);
  if (exists) showToast(`“${note.name}” is already back.`);
  return !exists;
}

// Writing a whole record that REPLACES or REMOVES a game or day that exists skips the
// confirms the builder's own Delete asks (a game's saved result, bracket…; a day's games),
// so the engine's side doors — Use mine, Undo — refuse it and point at the builder.
// Returns the reason, or '' when it is fine.
function cfgRecordGuard(path, value) {
  const parts = String(path).split('/');
  if (parts.length !== 2) return '';
  const [section, key] = parts;
  const rec = cfgCanon(state.config)[section] && cfgCanon(state.config)[section][key];
  if (!rec) return ''; // creating: nothing to lose
  if (value !== null && JSON.stringify(cfgStripOrder(value)) === JSON.stringify(cfgStripOrder(rec))) return '';
  const name = '“' + (rec.name || key) + '”';
  if (section === 'games') {
    const labels = typeof gameRecordLabels === 'function' ? gameRecordLabels(rec.id || key) : [];
    if (labels.length) return `${name} has ${labels.join(' and ')} — remove it from the Games tab instead, which asks first.`;
  } else if (value === null && gamesForDayId(rec.id || key).length) {
    return `${name} has games scheduled on it — move or delete those first.`;
  }
  return '';
}

// A clash's "Use mine": write my offline value over the server's, as a normal commit.
// The note stays when nothing could be written (the record is gone, or removing it would
// throw away scores) — a "Use mine" that silently did nothing was the worst answer.
function cfgUseMine(noteId) {
  const note = cfgNotes().find((n) => n.id === noteId && n.kind === 'clash');
  if (!note) return false;
  if (!canEdit() || !configEditable()) { showToast('The games list isn’t ready to edit yet — try again in a moment.'); return false; }
  const block = cfgRecordGuard(note.path, note.mine);
  if (block) { showToast(block); return false; }
  let dropped = [];
  configEdit(`Used your version of ${note.what}`, () => { dropped = cfgApplyPaths({ [note.path]: note.mine }, { overwrite: true }).dropped; });
  if (dropped.length) { showToast(`Couldn’t use yours: ${note.what} has been removed since.`); return false; }
  cfgDropNote(noteId);
  return true;
}

// Apply canonical-path changes to the live config (a change into a record that is
// gone is dropped, never resurrecting it). Returns applyOpsSafe's result. `opts` is
// applyOpsSafe's: a deliberate "Use mine" overwrites the record it names.
function cfgApplyPaths(changes, opts) {
  const r = applyOpsSafe(cfgCanon(state.config), changes, CFG_ANCHORS, opts);
  state.config = cfgFromCanon(r.tree, state.config.updatedAt, state.config);
  migrateState(state); // heal what the canonical form prunes (a game's empty rules[])
  return r;
}

// ── Receiving the config ─────────────────────────────────────────────

// The week-config listener. Its own function so tests can attach it to a fake
// database (tests/config-gate.test.js) without standing up the whole of initSync.
function attachConfigListener() {
  fbConfigRef.on('value', (snap) => {
    onConfigSnapshot(snap.val());
  }, (err) => {
    console.warn('Firebase config read failed, staying local', err);
    fbConfigRef = null;
    syncDenied = true;
    updateSyncIndicator();
  });
}

// The FIRST snapshot waits for the state's first pull (handleRemoteSnapshot hands
// it back): the merge compares epochs, and the epoch lives in state/meta. Later
// ones are rebased on arrival.
function onConfigSnapshot(remote) {
  if (!configReady) {
    if (!remoteReady) { cfgFirstPending = { remote }; return; }
    processFirstConfig(remote);
    return;
  }
  if (!remote) { seedConfigIfAbsent(); return; } // the node was emptied: this phone's catalog is the only one left
  applyRemoteConfig(remote);
}

function processFirstConfig(remote) {
  cfgFirstPending = null;
  configReady = true; // the server has spoken and its epoch is known: pushes may flow
  // A phone back from before a new camp year: last year's notes and undo history go
  // BEFORE the merge or the adopt re-stamps the baseline's epoch (cfgFollowStateEpoch
  // can't, it waits for configReady) — even when nothing of mine was unconfirmed.
  if (cfgBaseTree() && (state._cfgBaseEpoch || '') !== ((state.meta && state.meta.epoch) || '')) cfgForgetLastYear();
  if (!remote) {
    // An empty node: this phone's catalog is the only one there is — seed it.
    seedConfigIfAbsent();
  } else if (!firstConfigMerge(remote)) {
    applyRemoteConfig(remote);
  }
  // The builder may have been showing "Loading the games list…"; open it now, even
  // when the catalog came back identical (applyRemoteConfig renders only on a
  // change). Held while a field is focused, like every background render.
  if (appStarted && state.ui.view === 'settings') renderAllWhenIdle();
}

// The state engine's first pull has landed: hand over a config snapshot that was
// waiting for its epoch.
function releaseFirstConfig() {
  if (cfgFirstPending && !configReady) processFirstConfig(cfgFirstPending.remote);
}

// Adopt `remote` (the server's config) with this phone's unconfirmed edits laid
// over it — rebase on receipt, never stash. `opts.mine` supplies the ops to lay
// over (the first-snapshot merge's kept set, and `opts.reorder` its position
// settlement); by default they are everything this
// phone changed since the server last confirmed (treeDiff(_cfgBase, config)). A
// viewer has no edits of its own, so it just adopts. With no baseline (first run
// of this engine) nothing is unconfirmed: a plain adopt, and tracking starts.
function applyRemoteConfig(remote, opts) {
  // Compared in RTDB-canonical form (syncCanon): the echo of this device's own edit
  // comes back key-sorted with nulls dropped, and a plain string compare read that
  // as somebody else's change — a second full builder rebuild half a second after
  // every Add day / new game.
  const beforeJson = JSON.stringify(syncCanon(state.config));
  const v0 = remote && remote.version;
  const remoteCanon = cfgCanon(remote);
  cfgLastRemote = remoteCanon;
  cfgRemoteSeq++;
  const localCanon = cfgCanon(state.config);
  const base = cfgBaseTree();
  const mine = opts && opts.mine ? opts.mine : (base && directorTab() ? treeDiff(base, localCanon, CFG_DEPTHS) : {}); // directorTab, not canEdit: a counselor preview must never make this phone drop its unconfirmed edits
  const rebased = applyOpsSafe(remoteCanon, mine, CFG_ANCHORS);
  if (opts && opts.reorder) rebased.tree = opts.reorder(rebased.tree); // the first-snapshot merge settles positions
  applyingRemoteConfig = true;
  state.config = cfgFromCanon(rebased.tree, cfgLater(remote && remote.updatedAt, Object.keys(mine).length ? state.config.updatedAt : ''), state.config);
  const upgraded = migrateState(state);
  writeCfgBase(remoteCanon);
  applyingRemoteConfig = false;
  if (rebased.dropped.length) cfgNoteDropped(rebased.dropped, localCanon);
  // Push back only a REAL migration (the version moved) and only from an editor.
  // migrateState also returns true when it merely healed what RTDB pruned (a quick
  // game's empty rules[]), and re-pushing then made every open editor device write
  // on every config event — racing whoever was actually editing.
  if (upgraded && canEdit() && state.config.version !== v0) schedulePushConfig();
  if (appStarted && JSON.stringify(syncCanon(state.config)) !== beforeJson) {
    // A config change can move points (double-points flag, a deleted game with
    // a result, a restore). It arrived from ELSEWHERE, so runStandingsSideEffects must
    // treat the totals shift as remote — exactly as applyRemoteState does —
    // and advance its baseline without logging. Left unset, every online
    // editor's device wrote its own "Points updated" changelog entries for an
    // edit somebody else made, blaming them in the audit log (the rules accept
    // those writes because byKey really is the writer). The editor who made the
    // change already logged it from their own render.
    remoteJustApplied = true;
    renderAllWhenIdle(); // data is already applied; only the repaint waits for a focused field
  }
}

// The first config snapshot after load, three-way:
//   base   = the config the server last confirmed to this phone (_cfgBase)
//   mine   = what this phone changed since base (treeDiff, still unconfirmed)
//   theirs = what everyone else changed on the server since base
// Keep every path of mine that nobody else touched and push exactly those; the
// same path changed on both sides keeps the SERVER's value (the loser is listed
// for "Use mine" and gets an undo entry); a kept op whose record the server
// deleted goes to "Put it back". Positions (`_o`) are NOT paths in that sense —
// every insert or delete renumbers everything after it — so they never clash:
// cfgMergeOrder settles them from relative order afterwards. Returns false when
// there is nothing of mine to protect (the caller adopts plainly). Work from an
// earlier camp year is stranded, never merged; work older than 36 h asks first.
function firstConfigMerge(remote) {
  if (!directorTab()) return false; // a viewer / read-only tab has no edits of its own to keep (a preview is not one: see directorTab)
  const base = cfgBaseTree();
  if (!base) return false;
  const baseAt = Number(state._cfgBaseAt) || 0;
  const localCanon = cfgCanon(state.config);
  const mine = treeDiff(base, localCanon, CFG_DEPTHS);
  const minePaths = Object.keys(mine);
  if (!minePaths.length) return false;
  const remoteCanon = cfgCanon(remote);
  const fromEpoch = state._cfgBaseEpoch || '';
  const toEpoch = (state.meta && state.meta.epoch) || '';
  if (fromEpoch !== toEpoch) {
    cfgStrand(mine, localCanon, fromEpoch, toEpoch, baseAt);
    applyRemoteConfig(remote, { mine: {} });
    return true;
  }
  const theirs = treeDiff(base, remoteCanon, CFG_DEPTHS);
  const theirPaths = Object.keys(theirs).filter((q) => !cfgIsOrderPath(q)); // a renumbering is not a touch
  // A record the server deleted is not a clash with an edit INSIDE it: that edit is
  // dropped by applyOpsSafe and offered back under "Put it back".
  const recordDeleted = (q) => theirs[q] === null && CFG_ANCHORS[q.split('/')[0]] === q.split('/').length;
  const isRecord = (p) => CFG_ANCHORS[p.split('/')[0]] === p.split('/').length;
  let keep = {};
  const clashed = [];
  const collided = []; // my NEW record met a different one under the same id
  minePaths.forEach((p) => {
    if (cfgIsOrderPath(p)) return;
    // Whole records compare without their position: a colleague's insert moved it.
    if (JSON.stringify(cfgStripOrder(cfgValueAt(remoteCanon, p))) === JSON.stringify(cfgStripOrder(mine[p]))) return; // the server already says it
    if (isRecord(p) && mine[p] !== null && cfgValueAt(remoteCanon, p) !== null) { collided.push(p); return; }
    const clash = theirPaths.some((q) => syncPathsOverlap(p, q) && !(recordDeleted(q) && p.startsWith(q + '/')));
    if (clash) clashed.push(p); else keep[p] = mine[p];
  });
  let declined = false;
  const keepPaths = Object.keys(keep);
  if (keepPaths.length && baseAt && Date.now() - baseAt > CFG_STALE_MS) {
    const when = formatEasternStamp(new Date(baseAt).toISOString()) || 'a while ago';
    if (!confirm(`This phone has ${keepPaths.length} change${keepPaths.length === 1 ? '' : 's'} to the week setup saved since ${when} that never reached the server. Send ${keepPaths.length === 1 ? 'it' : 'them'} now?`)) { keep = {}; declined = true; }
  }
  applyRemoteConfig(remote, {
    mine: keep,
    reorder: declined ? null : (tree) => cfgMergeOrder(base, localCanon, remoteCanon, tree),
  });
  cfgRecordClashes(clashed, mine, localCanon, remoteCanon);
  if (collided.length) cfgNoteDropped(collided.map((p) => ({ path: p, value: mine[p], record: p, collide: true })), localCanon);
  pushConfig(); // whatever now differs from the new base (my kept ops and positions); a no-op when nothing does
  return true;
}

// The records of one section of a canonical tree, in list order.
function cfgOrderIds(tree, section) {
  const m = (tree && tree[section]) || {};
  const at = (id) => (m[id] && typeof m[id]._o === 'number' ? m[id]._o : Infinity);
  return Object.keys(m).sort((a, b) => (at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1) || (a < b ? -1 : a > b ? 1 : 0));
}

// Positions after the first-snapshot merge, per section. The SERVER's order is the
// starting point (it carries every colleague's insert, delete and move); a record I
// added goes right after the one that preceded it on my phone; and where I MOVED
// records the server did not move, my relative order of the ones we both still have is
// laid back over the slots they occupy. Two people reordering the same records: the
// server's order stands, quietly. Every record then gets a dense `_o`, so none tie
// and cfgUnkeyed's key tie-break can never swap a pair (a restored record used to).
// `merged` is the canonical tree to settle (changed in place and returned).
function cfgMergeOrder(base, local, remote, merged) {
  ['days', 'games'].forEach((section) => {
    const m = merged[section];
    if (!m) return;
    const remoteIds = cfgOrderIds(remote, section);
    const localIds = cfgOrderIds(local, section);
    const baseIds = cfgOrderIds(base, section);
    const inRemote = new Set(remoteIds);
    const order = remoteIds.filter((id) => m[id]);
    localIds.forEach((id, i) => {
      if (!m[id] || inRemote.has(id)) return; // only a record I ADDED needs a place
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const k = order.indexOf(localIds[j]);
        if (k > -1) { at = k + 1; break; }
      }
      order.splice(at, 0, id);
    });
    const inBase = new Set(baseIds);
    const inLocal = new Set(localIds);
    const both = (id) => inBase.has(id) && inLocal.has(id) && inRemote.has(id) && !!m[id];
    const same = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
    const baseSeq = baseIds.filter(both);
    const mineSeq = localIds.filter(both);
    if (!same(mineSeq, baseSeq) && same(remoteIds.filter(both), baseSeq)) {
      const slots = [];
      order.forEach((id, i) => { if (both(id)) slots.push(i); });
      mineSeq.forEach((id, n) => { order[slots[n]] = id; });
    }
    Object.keys(m).forEach((id) => { if (order.indexOf(id) === -1) order.push(id); }); // never lose a record
    order.forEach((id, i) => { m[id]._o = i; });
  });
  return merged;
}

function cfgRecordClashes(paths, mine, localCanon, remoteCanon) {
  // A lost reorder is not worth a question (the server's order stands); anything else is listed.
  const shown = paths.filter((p) => !cfgIsOrderPath(p));
  if (!shown.length) return;
  const added = shown.map((p) => ({
    id: cfgNoteId(), kind: 'clash', path: p, mine: mine[p], theirs: cfgValueAt(remoteCanon, p),
    what: cfgWhat(p, localCanon, remoteCanon), at: new Date().toISOString(),
  }));
  cfgSetNotes(cfgNotes().filter((n) => !(n.kind === 'clash' && added.some((a) => a.path === n.path))).concat(added));
  // The synthetic entry changes MINE into THEIRS, so Undo (which puts `before` back
  // where the value still equals `after`) brings my offline edit back.
  added.forEach((a) => undoRecord('Bring back your offline change to ' + a.what, [['config', a.path, a.mine, a.theirs]], { quiet: true }));
  showToast(`⚠️ ${added.length} change${added.length === 1 ? '' : 's'} you made offline clashed with someone else’s — kept theirs. More → Set up the week lets you bring ${added.length === 1 ? 'it' : 'them'} back.`);
}

// Unsent config edits from a PREVIOUS camp year are set aside as downloadable JSON,
// never applied (same store and bar as the state engine's stranded work).
function cfgStrand(mine, localCanon, fromEpoch, toEpoch, baseAt) {
  const changes = Object.keys(mine).filter((p) => !cfgIsOrderPath(p)).map((p) => ({
    path: 'config/' + p, what: cfgWhat(p, localCanon), value: mine[p] === undefined ? null : mine[p],
  }));
  if (!changes.length) return false;
  const kept = addStranded({
    at: new Date().toISOString(),
    from: fromEpoch || 'legacy',
    to: toEpoch || 'legacy',
    lastSyncedAt: baseAt ? new Date(baseAt).toISOString() : null,
    changes,
  });
  const n = changes.length;
  showToast(`⚠️ This phone had ${n} change${n === 1 ? '' : 's'} to the week setup from last camp week that never synced. ${n === 1 ? 'It wasn’t' : 'They weren’t'} added to this week. ` +
    (kept ? `Download ${n === 1 ? 'it' : 'them'} from the bar at the top of the page.` : 'This phone is out of room to keep them, so download them now.'));
  updateSyncIndicator();
  return true;
}

// The config base follows the state engine's epoch (sync-F11). The wizard (step 28)
// doesn't write `config`, so a config snapshot never tells the base about a new
// year. Whenever the state engine adopts an epoch other than the one the base was
// confirmed under: edits still unconfirmed are last year's and are stranded right
// then, and the base takes the new epoch in the same write — so a device that
// stays open across the wizard and then edits games offline keeps THOSE edits
// through a reload. A no-op until an epoch exists (both sides read '').
function cfgFollowStateEpoch() {
  if (!configReady) return; // the first config snapshot compares epochs itself
  const base = cfgBaseTree();
  if (!base) return;
  const e = (state.meta && state.meta.epoch) || '';
  const was = state._cfgBaseEpoch || '';
  if (was === e) return;
  const localCanon = cfgCanon(state.config);
  const mine = directorTab() ? treeDiff(base, localCanon, CFG_DEPTHS) : {};
  if (Object.keys(mine).length) {
    cfgStrand(mine, localCanon, was, e, Number(state._cfgBaseAt) || 0);
    state.config = cfgFromCanon(base, state.config.updatedAt, state.config);
    migrateState(state);
  }
  state._cfgBaseEpoch = e;
  cfgForgetLastYear();
  persistState();
}

// Last camp year's clash and put-back notes and its undo history mean nothing in the
// new one (Put it back would carry last year's game into this year's catalog).
function cfgForgetLastYear() {
  if (cfgNotes().length) delete state._cfgNotes;
  undoClear();
}

// ── A new camp year on this phone (§6.11) ────────────────────────────
// The first time this device adopts a state epoch other than the one it last saw (`campScoreboardEpochSeen`, per camp),
// what it remembered about the old year is cleared: the team it follows and who it is (the account's team comes straight
// back through adoptMemberTeam, and the picker is asked again), its morning standings baseline, dismissed banners, the
// undo history, the setup clashes, the unfinished rain plan and the wizard's draft. A device with no record yet is
// treated as the legacy week (every phone that ran before this existed), so the first sight of the legacy epoch just
// records it. An epoch going BACK (Undo the new-year setup) is a change like any other. Nothing here is camp data on the
// server, and nothing is written to it.
const EPOCH_SEEN_KEY = 'campScoreboardEpochSeen';
function epochDeviceReset() {
  if (!state || !state.meta) return false;
  const now = typeof state.meta.epoch === 'string' ? state.meta.epoch : '';
  let seen = null;
  try { seen = localStorage.getItem(lsKey(EPOCH_SEEN_KEY)); } catch (e) { /* private mode: nothing to compare with */ }
  const was = seen === null || seen === 'legacy' ? '' : seen;
  if (was === now) { if (seen === null && now === '') { try { localStorage.setItem(lsKey(EPOCH_SEEN_KEY), 'legacy'); } catch (e) { /* fine */ } } return false; }
  try { localStorage.setItem(lsKey(EPOCH_SEEN_KEY), now || 'legacy'); } catch (e) { /* fine */ }
  const had = state.followTeam !== undefined || state.identity !== undefined;
  delete state.followTeam;
  delete state.identity;
  [DAY_RANK_KEY, CHANGE_DISMISS_KEY, ANNOUNCE_DISMISS_KEY, lsKey('campSetupRainDraft'), lsKey('campWizardDraft')].forEach((k) => {
    try { localStorage.removeItem(k); } catch (e) { /* fine */ }
  });
  undoClear();
  if (typeof setupForgetLastYear === 'function') { setupForgetLastYear(); if (typeof persistSetup === 'function') persistSetup(); }
  if (typeof wizardDraftForget === 'function') wizardDraftForget();
  persistState();
  if (had && typeof appStarted !== 'undefined' && appStarted) { renderAll(); maybeShowTeamPicker(); }
  return true;
}

// ── Sending the config ───────────────────────────────────────────────

// Settings code calls this after mutating state.config (configEdit does, for the
// ones that also want an undo entry).
function saveConfig() {
  state.config.updatedAt = new Date().toISOString();
  persistState();
  if (!applyingRemoteConfig) schedulePushConfig();
}

function schedulePushConfig() {
  if (!fbConfigRef) return;
  clearTimeout(pushConfigTimer);
  // Null the handle when it fires (mirrors schedulePush) — its non-null-ness
  // means "a config edit is queued but unsent", which defers remote applies.
  pushConfigTimer = setTimeout(() => { pushConfigTimer = null; pushConfig(); }, 400);
}

// The exact top-level keys the config node may carry. The rules seal this node
// with "$other": false, so ONE unrecognised key would bounce the whole write.
// Strays are plausible: tryImport (settings.js) assigns state.config wholesale from
// a pasted backup, and a server node may hold a leftover. cfgFromCanon already
// emits only these; this is the last line (and the seed's). Because a push replaces
// the node's value with the transaction's result, a stray already in the live node
// is pruned by the first edit after this ships.
// Keep in sync with defaultConfig() (defaults.js) and seniorDefaultConfig().
const CONFIG_KEYS = ['version', 'updatedAt', 'sessions', 'days', 'games'];

function configForSync(config) {
  const out = {};
  CONFIG_KEYS.forEach((k) => { if (config && config[k] !== undefined) out[k] = config[k]; });
  return out;
}

// May the games/days catalog be edited right now? Yes once the first config
// snapshot has been processed; before that only on a device holding a confirmed
// baseline (its edit is kept and three-way merged when the snapshot lands), and
// whenever no snapshot is ever coming that could replace an edit: sync isn't
// configured (local-only), the SDK never loaded (read-only copy anyway), or the
// config read was refused (access revoked). Otherwise the builder shows "Loading
// the games list…". Covers the Games and Days tabs and the Data tab's import /
// restore-defaults, i.e. every writer of state.config.
function configEditable() {
  if (configReady) return true;
  if (!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey)) return true;
  if (syncDenied || sdkLoadFailed) return true;
  return !!cfgBaseTree();
}

// One transaction at a time, applying MY unconfirmed ops (the diff against the
// confirmed baseline) to the server's CURRENT value — so two directors editing
// different fields of one game both land, and an old build's whole set() landing
// between our read and our commit just makes the SDK re-run this on the new value.
function pushConfig() {
  // Not before the first config snapshot: until then this phone doesn't know what
  // the server holds (or which year it is in).
  if (!fbConfigRef || applyingRemoteConfig || !configReady) return;
  if (!tabMayPush('config')) return; // see pushState
  if (pendingConfigWrites > 0) { configPushOwed = true; return; }
  const base = cfgBaseTree();
  if (!base) return; // no confirmed baseline yet (a seed is in flight): nothing to measure against
  const atPush = cfgCanon(state.config);
  const ops = treeDiff(base, atPush, CFG_DEPTHS);
  if (!Object.keys(ops).length) return;
  pendingConfigWrites++;
  const seq0 = cfgRemoteSeq;
  const settle = () => {
    pendingConfigWrites = Math.max(0, pendingConfigWrites - 1);
    if (configPushOwed) { configPushOwed = false; pushConfig(); }
  };
  let dropped = [];
  // transaction() can throw synchronously (an illegal key from a hand-edited
  // backup); without the catch the counter would stay raised and block every reload.
  try {
    fbConfigRef.transaction((cur) => {
      // ABORT: the node is really gone (our listener keeps it cached, so null is not
      // "not loaded yet"). The listener is about to see the null and re-seed it from
      // this phone's catalog, edits included; the ops stay unconfirmed until then.
      if (cur === null || cur === undefined) return undefined;
      const r = applyOpsSafe(cfgCanon(cur), ops, CFG_ANCHORS);
      dropped = r.dropped; // the LAST run's (the SDK may re-run this on a newer server value)
      return JSON.parse(JSON.stringify(configForSync(cfgFromCanon(r.tree, new Date().toISOString()))));
    }, null, false).then((res) => {
      try {
        if (res && res.committed) cfgPushCommitted(res.snapshot.val(), ops, dropped, seq0);
        else console.warn('config push aborted: the node is gone on the server; it will be re-seeded');
      } finally { settle(); }
    }, (e) => { settle(); configPushFailed(e); });
  } catch (e) {
    settle();
    configPushFailed(e);
  }
}

// The transaction committed `serverVal`. The server's value may include other
// editors' changes this phone hasn't received yet, so rebase the LOCAL copy onto it:
// local = the committed value + only the edits made since this push started. (Setting
// the base to the committed value without that would make the next diff "undo"
// somebody else's change.) The push-time tree is the base plus the ops we sent — a
// snapshot that landed mid-push has already rebased the base, and this follows it.
function cfgPushCommitted(serverVal, ops, txnDropped, seq0) {
  const server = cfgCanon(serverVal);
  const localBefore = cfgCanon(state.config);
  const atPush = applyOpsSafe(cfgBaseTree() || {}, ops, CFG_ANCHORS).tree;
  const since = treeDiff(atPush, localBefore, CFG_DEPTHS); // edits made while the push was in flight
  const r = applyOpsSafe(server, since, CFG_ANCHORS);
  const beforeJson = JSON.stringify(syncCanon(state.config));
  applyingRemoteConfig = true;
  state.config = cfgFromCanon(r.tree, cfgLater(serverVal && serverVal.updatedAt, state.config.updatedAt), state.config);
  migrateState(state);
  writeCfgBase(server); // base + config persisted in ONE setItem
  applyingRemoteConfig = false;
  const lost = (txnDropped || []).concat(r.dropped);
  if (lost.length) cfgNoteDropped(lost, localBefore);
  if (appStarted && JSON.stringify(syncCanon(state.config)) !== beforeJson) {
    remoteJustApplied = true; // others' changes rode in with the commit
    renderAllWhenIdle();
  }
  // The committed value is the transaction's OWN output, handed over a tick after the server took it. A colleague's commit right
  // behind ours can reach the listener first and is adopted the moment it lands; adopting the older committed value just now moved this
  // phone's copy and baseline back behind it, and the listener will not fire again for a state it has already shown, so the colleague's
  // field would stay missing until the next change (seen in tests/emulator/games-client.mjs, two directors saving at once). Settle it
  // by reading once more. Only when a snapshot landed during the push and differs from what the commit returned.
  if (seq0 !== undefined && cfgRemoteSeq !== seq0 && cfgLastRemote && JSON.stringify(cfgLastRemote) !== JSON.stringify(server)) cfgSettleReread();
}

function cfgSettleReread() {
  const ref = fbConfigRef;
  if (!ref || typeof ref.once !== 'function') return;
  try {
    ref.once('value').then((snap) => { if (fbConfigRef === ref && configReady) onConfigSnapshot(snap.val()); }, () => { /* the next snapshot settles it */ });
  } catch (e) { /* a read that cannot start leaves it to the next snapshot */ }
}

// The builder's save is the one write this app used to lose in silence (the
// catch was a console.warn). Say so; the edit is still on this phone and goes up
// with the next builder change — or, after a reload, with the first-snapshot merge.
function configPushFailed(e) {
  console.warn('config push failed', e);
  if (typeof showToast === 'function') showToast("Couldn't save the week setup — check your connection and try again.");
}

// First upgraded client on an empty config node seeds the catalog — as a
// transaction that only writes into a node that is really empty, so two phones
// seeding at once (or one racing a director's first save) can't overwrite each
// other. Never touches an existing node: returning undefined aborts. The seeded
// value becomes the confirmed baseline.
function seedConfigIfAbsent() {
  if (!fbConfigRef) return;
  pendingConfigWrites++;
  const settle = () => { pendingConfigWrites = Math.max(0, pendingConfigWrites - 1); };
  try {
    fbConfigRef.transaction(
      (cur) => (cur === null ? JSON.parse(JSON.stringify(configForSync(state.config))) : undefined),
      null, false,
    ).then((res) => {
      try {
        if (res && res.committed && res.snapshot) writeCfgBase(cfgCanon(res.snapshot.val()));
      } finally { settle(); }
    }, (e) => { settle(); console.warn('config seed failed', e); });
  } catch (e) {
    settle();
    console.warn('config seed threw', e);
  }
}

// ── Commits that can be undone (setup-rebuild-spec §7.1, core) ────────────
// configEdit / stateEdit are the two commit wrappers: snapshot the canonical tree,
// run the mutation (which looks its record up BY ID when it runs — P10: a remote
// apply may have replaced every object since the handler was wired), commit through
// the normal engine, and record what changed as an undo entry. Entry:
//   { id, label, at, epoch, ops: [[domain, path, before, after], …] }
// with canonical before/after from the engine's own diff; domain ∈ config | teams
// (setup and campers join later). Undo puts `before` back ONLY where the current
// value still equals `after`; paths somebody changed since are left alone and
// said out loud. The undo is itself a commit, so it becomes a new "Undid: …" entry
// (no separate redo stack). People/access changes are not undoable (they keep
// their own confirms); scores keep their own tools.
// Persisted per camp in lsKey('campSetupUndo') — at most 50 entries / 200 KB, oldest
// dropped; an entry over 20 KB (a restore, a seed) isn't stacked — and cleared on
// an epoch change, when a device stops being an editor, and by clearLocalData.
const UNDO_KEY = 'campSetupUndo';
const UNDO_MAX_ENTRIES = 50;
const UNDO_MAX_BYTES = 200000;
const UNDO_ENTRY_MAX_BYTES = 20000;
// How long the Undo / Redo toast stays (the spec's docked pill, step 14, is 6 s; this toast stands in until it lands).
const UNDO_TOAST_MS = 6000;
let undoList = null; // lazily read from storage on first use (never at load: boot-cache.test.js)
let undoLastRecorded = null;

function undoRead() {
  if (undoList) return undoList;
  let list = [];
  try {
    const raw = JSON.parse(localStorage.getItem(lsKey(UNDO_KEY)) || '[]');
    if (Array.isArray(raw)) list = raw.filter((e) => e && typeof e.id === 'string' && Array.isArray(e.ops));
  } catch (e) { /* unreadable or blocked storage: no history as far as this page can tell */ }
  undoList = list;
  return list;
}

function undoWrite() {
  try {
    if (undoList && undoList.length) localStorage.setItem(lsKey(UNDO_KEY), JSON.stringify(undoList));
    else localStorage.removeItem(lsKey(UNDO_KEY));
  } catch (e) { /* quota / private mode: the in-memory copy still serves this page */ }
}

function undoClear() {
  undoList = [];
  undoLastRecorded = null;
  undoWrite();
}

function undoDrop(id) {
  undoList = undoRead().filter((e) => e.id !== id);
  undoWrite();
}

// Newest first (what a "Recent changes" list would show).
function undoRecent() {
  return undoRead().slice().reverse();
}

// Returns the entry, or null when there was nothing to record or it was too big.
function undoRecord(label, ops, opts) {
  if (!ops || !ops.length || !label) return null;
  const entry = {
    id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label: String(label),
    at: new Date().toISOString(),
    epoch: (state.meta && state.meta.epoch) || '',
    ops,
  };
  if (JSON.stringify(entry).length > UNDO_ENTRY_MAX_BYTES) return null;
  const list = undoRead();
  list.push(entry);
  while (list.length > UNDO_MAX_ENTRIES || (list.length > 1 && JSON.stringify(list).length > UNDO_MAX_BYTES)) list.shift();
  undoWrite();
  undoLastRecorded = entry;
  if (!(opts && opts.quiet)) {
    // Inside Set up the week the docked undo pill takes it (setup-ui.js): a toast at the foot of the
    // screen swallowed the next tap on a sheet's Save. Anywhere else (the ⚡ quick game) it is still a toast.
    if (!(typeof setupUndoOffer === 'function' && setupUndoOffer(entry))) {
      showToast(entry.label, { action: { label: 'Undo', run: () => undoEntry(entry.id) }, duration: UNDO_TOAST_MS });
    }
  }
  return entry;
}

function configEdit(label, mutate, opts) {
  const before = cfgCanon(state.config);
  if (mutate() === false) return false;
  const ops = treeDiff(before, cfgCanon(state.config), CFG_DEPTHS);
  const paths = Object.keys(ops);
  if (!paths.length) return true; // nothing real changed: nothing to send, stamp or undo
  saveConfig();
  if (!(opts && opts.undo === false)) undoRecord(label, paths.map((p) => ['config', p, cfgValueAt(before, p), ops[p]]), opts);
  return true;
}

// The roster in the same id-keyed form (teams/<id>/<field>, `_o` = position), so a
// rename, a counselor edit and a reorder diff and undo field by field.
const TEAMS_DEPTHS = { teams: 3 };
function teamsCanon(teams) {
  const keyed = {};
  (teams || []).forEach((t, i) => { if (t && typeof t.id === 'string') keyed[t.id] = Object.assign({}, t, { _o: i }); });
  return syncCanon({ teams: keyed }) || {};
}

// What a team's optional branding fields may hold. These are the published rules' own limits for
// state/teams/$i/{short, emoji, color, photoV}: a value the rules would refuse is a parked, never-saved write,
// so the Teams screen refuses it first (in words), and a backup or a restore point never carries one in.
//   short  1–20 characters, none of  < > & "        emoji  1–16 characters, none of  < > & " '
//   color  one of the twelve palette ids            photoV a non-negative number (the photo's version)
const TEAM_SHORT_BAD = /[<>&"]/;
const TEAM_EMOJI_BAD = /[<>&"']/;
function teamShortValid(v) { return typeof v === 'string' && v.length >= 1 && v.length <= 20 && !TEAM_SHORT_BAD.test(v) && safeShort(v, '') === v; }
function teamEmojiValid(v) { return typeof v === 'string' && v.length >= 1 && v.length <= 16 && !TEAM_EMOJI_BAD.test(v) && safeEmoji(v, '') === v; }
function teamColorValid(v) { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CAMP_TEAM_PALETTE, v); }
function teamPhotoVValid(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }

// A roster out of a backup file or a restore point: id, name and counselor as they were, and only the branding
// fields that pass the checks above. `photoV` is NEVER taken from the file: the photo node holds only the newest
// upload, so an old version number would point at a photo that is gone — the live photo stays as it is.
function teamsFromBackup(list) {
  if (!Array.isArray(list)) return list;
  return list.map((t) => {
    if (!t || typeof t !== 'object') return t;
    const out = Object.assign({}, t);
    ['short', 'emoji', 'color', 'photoV'].forEach((f) => delete out[f]);
    if (teamShortValid(t.short)) out.short = t.short;
    if (teamEmojiValid(t.emoji)) out.emoji = t.emoji;
    if (teamColorValid(t.color)) out.color = t.color;
    const live = (state.teams || NO_ITEMS).find((x) => x && t.id && x.id === t.id);
    if (live && teamPhotoVValid(live.photoV)) out.photoV = live.photoV;
    return out;
  });
}

function stateEdit(label, mutate, opts) {
  const before = teamsCanon(state.teams);
  if (mutate() === false) return false;
  const ops = treeDiff(before, teamsCanon(state.teams), TEAMS_DEPTHS);
  const paths = Object.keys(ops);
  if (!paths.length) return true;
  saveState();
  if (!(opts && opts.undo === false)) undoRecord(label, paths.map((p) => ['teams', p, cfgValueAt(before, p), ops[p]]), opts);
  return true;
}

function teamsApplyPaths(changes) {
  const order = {};
  (state.teams || []).forEach((t, i) => { order[t.id] = i; });
  let reorder = false;
  Object.keys(changes).forEach((path) => {
    const [, id, field] = path.split('/');
    const t = (state.teams || []).find((x) => x.id === id);
    if (!t || !field) return;
    if (field === '_o') { if (typeof changes[path] === 'number') { order[id] = changes[path]; reorder = true; } return; }
    if (changes[path] === null) delete t[field]; else t[field] = changes[path];
  });
  if (reorder) state.teams.sort((a, b) => order[a.id] - order[b.id]);
}

// Undoing a delete puts the record back where it was — by its former NEIGHBOUR when
// the entry remembers one (the renumber op of the record that followed it), else by its
// old index clamped to the list — instead of at a stale `_o` that a colleague's later
// insert or delete has moved under it. Fractions are fine: the list re-derives dense
// positions on the next canonical pass.
function cfgPlaceRestored(changes, entryOps) {
  const out = Object.assign({}, changes);
  const live = cfgCanon(state.config);
  Object.keys(changes).forEach((p) => {
    const parts = p.split('/');
    const v = changes[p];
    if (parts.length !== 2 || !v || typeof v !== 'object' || typeof v._o !== 'number') return;
    const section = parts[0];
    const now = live[section] || {};
    const count = Object.keys(now).length;
    const next = (entryOps || []).find((op) => op[0] === 'config' && op[1].split('/')[0] === section &&
      cfgIsOrderPath(op[1]) && op[2] === v._o + 1 && op[3] === v._o);
    const nextRec = next && now[next[1].split('/')[1]];
    out[p] = Object.assign({}, v, { _o: nextRec ? nextRec._o - 0.5 : (v._o < count ? v._o - 0.5 : count) });
  });
  return out;
}

// Each domain says how to read a path now, whether restoring a value would throw away
// something the builder's own handlers protect (`guard`: a reason, or ''), and how to
// commit changes through its normal engine, quietly (undoEntry raises the one toast).
// `apply` returns the paths the engine had to drop because their record is gone.
const UNDO_DOMAINS = {
  config: {
    valueAt: (path) => cfgValueAt(cfgCanon(state.config), path),
    what: (path) => cfgWhat(path, cfgCanon(state.config)),
    guard: (path, value) => cfgRecordGuard(path, value),
    apply: (changes, label, entryOps) => {
      let dropped = [];
      configEdit(label, () => { dropped = cfgApplyPaths(cfgPlaceRestored(changes, entryOps)).dropped; }, { quiet: true });
      return dropped.map((d) => d.path);
    },
  },
  teams: {
    valueAt: (path) => cfgValueAt(teamsCanon(state.teams), path),
    what: (path) => {
      const [, id, field] = path.split('/');
      const t = (state.teams || []).find((x) => x.id === id);
      return `team “${(t && t.name) || id}”${field ? ' · ' + (field === 'counselor' ? 'counselors' : field === '_o' ? 'order' : field) : ''}`;
    },
    apply: (changes, label) => { stateEdit(label, () => teamsApplyPaths(changes), { quiet: true }); return []; },
  },
};

// Undo one entry. Returns { applied, total } (null when the entry is gone or the
// device may not edit).
function undoEntry(id) {
  const entry = undoRead().find((e) => e.id === id);
  if (!entry) return null;
  if (!canEdit()) { showToast('Only a director can undo a change.'); return null; }
  if ((entry.epoch || '') !== ((state.meta && state.meta.epoch) || '')) {
    undoDrop(id);
    showToast('That change is from an earlier camp year, so it can’t be undone here.');
    return null;
  }
  // A position op beside a whole-record op in its section is just the renumbering that
  // insert or delete caused: restoring the record places it (cfgPlaceRestored), and
  // listing games whose order nobody touched as "changed since" would be noise.
  const structural = {};
  entry.ops.forEach((op) => { if (op[1].split('/').length === 2) structural[op[0] + '/' + op[1].split('/')[0]] = true; });
  const renumber = (op) => cfgIsOrderPath(op[1]) && structural[op[0] + '/' + op[1].split('/')[0]];
  const ops = entry.ops.filter((op) => !renumber(op));
  const byDomain = {};
  ops.forEach((op) => { (byDomain[op[0]] = byDomain[op[0]] || []).push(op); });
  const left = []; // somebody changed it since
  const held = []; // refused: it would throw away what the builder's own Delete asks about
  let applied = 0;
  undoLastRecorded = null;
  Object.keys(byDomain).forEach((domain) => {
    const h = UNDO_DOMAINS[domain];
    if (!h) { byDomain[domain].forEach((op) => left.push(op)); return; }
    const changes = {};
    const taken = [];
    byDomain[domain].forEach((op) => {
      if (JSON.stringify(h.valueAt(op[1])) !== JSON.stringify(op[3])) { left.push(op); return; }
      const why = h.guard ? h.guard(op[1], op[2]) : '';
      if (why) { held.push(why); return; }
      changes[op[1]] = op[2];
      taken.push(op);
    });
    if (!taken.length) return;
    const dropped = h.apply(changes, 'Undid: ' + entry.label, entry.ops) || [];
    applied += taken.length - dropped.length;
    taken.filter((op) => dropped.indexOf(op[1]) > -1).forEach((op) => left.push(op)); // its record is gone: nothing changed
  });
  const total = ops.length;
  const redo = undoLastRecorded;
  if (applied) {
    undoDrop(id);
    // The builder's text fields commit without repainting (a blur-time rebuild eats the
    // next tap), so an undo has to bring them up to date itself.
    if (typeof refreshBuilderCards === 'function') refreshBuilderCards();
    if (appStarted) renderAllWhenIdle();
  }
  const action = redo ? { label: 'Redo', run: () => undoEntry(redo.id) } : null;
  if (!applied) {
    showToast(held.length ? 'Can’t undo — ' + held[0] : 'Can’t undo — someone changed this since.');
  } else if (left.length || held.length) {
    const names = left.map((op) => (UNDO_DOMAINS[op[0]] ? UNDO_DOMAINS[op[0]].what(op[1]) : op[1]))
      .filter((w, i, a) => a.indexOf(w) === i).slice(0, 2).join(' and ');
    // A partial undo is a sentence to read, not a button to tap: a plain toast, no action. The newest entry
    // is still the Undid: one, so the dock (and Recent changes) can put it back.
    showToast(`Undid ${applied} of ${total} changes${left.length ? ` — someone changed ${names} since; left theirs` : ''}.${held.length ? ' ' + held[0] : ''}`,
      typeof setupUndoOffer === 'function' && builderOpen() ? undefined : { action, duration: UNDO_TOAST_MS });
  } else if (!(redo && typeof setupUndoOffer === 'function' && setupUndoOffer(redo))) {
    showToast('Undone: ' + entry.label, { action, duration: UNDO_TOAST_MS }); // (inside Set up the week the pill says "Redo" instead)
  }
  return { applied, total };
}

// ── Adopting a remote snapshot ───────────────────────────────────
// Split out of the fbRef listener so the merge is one named, testable unit
// (tests/sync.test.js drives it directly) and so a snapshot we had to defer
// can be picked up again later.

// True when it's safe to replace local synced state with the server's copy.
// Adopting is UNSAFE while either:
//   • the editor is mid-entry — a score/name input is focused, or a data edit
//     is typed/queued but not yet pushed (editorMidEntry), or
//   • we have a local write the server hasn't confirmed yet (pendingWrites > 0)
//     — e.g. scores entered offline and still queued.
// Without this guard a reconnect re-fires the server's PREVIOUS value and the
// merge replaces state.drafts/results with it, reverting the scores being typed
// (a later Save then persists the reverted values and teams lose points).
// View-only saves (day tab, theme, notify, follow-team) don't trip
// editorMidEntry, so they never block an incoming update.
function canAdoptRemote() {
  return !editorMidEntry() && pendingWrites === 0;
}

// Set when a snapshot arrived that we couldn't safely adopt. RTDB only fires
// `value` again when the server data CHANGES, so a deferred snapshot used to be
// dropped outright: a phone left sitting with a score input focused could stay
// silently stale for the rest of a game. Instead of stashing the (possibly
// superseded) payload, we remember that we owe ourselves a read and re-fetch
// the current value once this device goes idle — so what lands is always the
// server's latest, never a stale replay.
let syncDenied = false; // a live listener was cancelled by the rules (access revoked)
let remoteRefetchPending = false;
let idleRetryTimer = null;

// Arm (or keep) the once-a-second idle check that drains whatever we deferred.
// (The week config no longer parks here: it applies at once and only its REPAINT
// waits, through renderAllWhenIdle — see applyRemoteConfig.)
function armIdleRetry() {
  if (!idleRetryTimer) idleRetryTimer = setInterval(idleRetryTick, 1000);
}

function deferRemoteSnapshot() {
  remoteRefetchPending = true;
  armIdleRetry();
}

function clearDeferredSnapshot() {
  remoteRefetchPending = false;
}

// A re-render owed to a BACKGROUND event — a game clock settling at 0:00, the
// staff list changing — that landed while someone was typing or had a
// dropdown open. Those paths called renderAll outright, which rebuilt the
// focused field under the editor's thumb: the keyboard dropped, an open
// select vanished. Remote snapshots were already held back (canAdoptRemote);
// these weren't. The idle tick pays the render off once focus leaves.
let renderOwed = false;

function renderAllWhenIdle() {
  if (fieldFocused()) {
    renderOwed = true;
    armIdleRetry();
    return;
  }
  renderOwed = false;
  renderAll();
}

function idleRetryTick() {
  // The setup engine's owed re-read (setup-sync.js) rides the same once-a-second tick.
  const setupOwed = typeof setupRefetchIsOwed === 'function' && setupRefetchIsOwed();
  if (!remoteRefetchPending && !renderOwed && !setupOwed) {
    clearInterval(idleRetryTimer);
    idleRetryTimer = null;
    return;
  }
  if (setupOwed && typeof setupIdleTick === 'function') setupIdleTick();
  // An owed render waits only for the field to let go — not for pushes to
  // settle like the remote adopt below (with sync off they never do).
  if (renderOwed && !fieldFocused()) { renderOwed = false; renderAll(); }
  if (!remoteRefetchPending) return;
  if (!canAdoptRemote()) return; // still mid-entry / mid-push — check again next tick
  if (remoteRefetchPending && fbRef) {
    clearDeferredSnapshot();
    fbRef.once('value')
      .then((snap) => handleRemoteSnapshot(snap.val()))
      .catch(() => { /* offline — the live listener will fire again on reconnect */ });
  } else {
    clearDeferredSnapshot();
  }
}

// Entry point for every snapshot, live or re-fetched. The wrapper exists for ONE
// thing: the week config's first snapshot waits for this engine's first pull (its
// epoch is in state/meta), and every path out of the body below — adopt, merge,
// seed, strand — has to release it afterwards.
function handleRemoteSnapshot(remote) {
  const first = !remoteReady;
  try { handleRemoteSnapshotBody(remote); } finally { if (first) releaseFirstConfig(); }
}

function handleRemoteSnapshotBody(remote) {
  const firstSnapshot = !remoteReady;
  remoteReady = true; // server truth received — pushes may flow now
  if (!remote) {
    // An EMPTY state node. If this phone has never seen this database, seed
    // it (the original behaviour). But if the server once confirmed data to
    // this phone, somebody cleared it on purpose (a fresh session started
    // from the console): adopting the empty server and pushing back only this
    // phone's own unconfirmed edits keeps an old cache from resurrecting last
    // week's results for everyone. The roster is guarded locally (a missing
    // `teams` never wipes it), so it's put back explicitly.
    if (firstSnapshot && bootHadConfirmedBase) {
      if (!firstSnapshotMerge({})) applyRemoteState({});
      lastSyncedTree = Object.assign({}, lastSyncedTree, { teams: null });
      pushState();
      return;
    }
    // Arm the result-alert baseline on this first pull too: the local results
    // are what the next live result is diffed against, so a quiet empty boot
    // doesn't leave the first real result silent (only the second would alert).
    resultAlertsArmed = true;
    pushState(); return; // seed an empty database
  }
  // The first snapshot after load is a THREE-WAY merge, so nothing entered on
  // dead camp wifi is silently lost (owner's requirement: offline edits must
  // stick and catch up later):
  //   base   = the tree the server last CONFIRMED to this phone (persisted —
  //            see confirmedTree — so it survives a force-quit, an iOS
  //            eviction or a deploy reload, not just this page load)
  //   mine   = what this phone changed since base (still unconfirmed)
  //   theirs = what everyone else changed on the server since base
  // Adopt the server, then re-apply every one of MY paths that nobody else
  // touched, and push just those. The same path changed on both sides goes to
  // the server's value (and the person is told). This replaced a coarse
  // "newest timestamp wins the whole tree" rule that either dropped an offline
  // score or — worse — pushed this phone's whole stale tree over everyone's
  // newer results (both verified 2026-10-26).
  if (firstSnapshot && bootSyncedTree && firstSnapshotMerge(remote)) return;
  if (firstSnapshot) dataEditPending = false; // the first snapshot reconciles any pre-sync edit
  // Any later snapshot waits for this device to be idle (see canAdoptRemote /
  // deferRemoteSnapshot).
  if (!firstSnapshot && !canAdoptRemote()) { deferRemoteSnapshot(); return; }
  applyRemoteState(remote);
}

// Does path `a` overlap path `b` (equal, or one contains the other)?
function syncPathsOverlap(a, b) {
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

// Value at a slash path inside a plain tree (undefined if absent).
function syncValueAt(tree, path) {
  let node = tree;
  for (const part of path.split('/')) {
    if (!node || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

// A copy of `tree` with RTDB-style path updates applied (null deletes).
function applySyncPaths(tree, updates) {
  const out = JSON.parse(JSON.stringify(tree || {}));
  Object.keys(updates).forEach((path) => {
    const parts = path.split('/');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
      node = node[parts[i]];
    }
    const last = parts[parts.length - 1];
    const v = updates[path];
    if (v === null || v === undefined) delete node[last];
    else node[last] = JSON.parse(JSON.stringify(v));
  });
  return out;
}

// RTDB-canonical form for COMPARISON only: what the server would hand back —
// null/empty objects/empty arrays pruned, keys sorted. Both the normalized
// local trees and the raw snapshot pass through it, so healing (bracket nulls,
// empty laps/hr) and key order never read as "somebody else changed this".
function syncCanon(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const a = v.map(syncCanon);
    while (a.length && a[a.length - 1] === undefined) a.pop();
    return a.length ? a.map((x) => (x === undefined ? null : x)) : undefined;
  }
  if (typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach((k) => { const c = syncCanon(v[k]); if (c !== undefined) o[k] = c; });
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}
function syncCanonTree(t) {
  const out = {};
  SYNC_KEYS.forEach((k) => { const c = syncCanon(t && t[k]); out[k] = c === undefined ? null : c; });
  return out;
}

// ── Shared pure helpers for the id-keyed engines (setup-rebuild-spec §6.1) ──
// The config engine uses them now; the setup engine (S4) is built on the same two.
//
// treeDiff(prev, cur, depthSpec) → { 'a/b/c': value | null }. Both sides are
// compared in canonical form (syncCanon). Objects present on BOTH sides recurse
// until `depthSpec` says leaf; arrays and scalars are leaves; an object absent on
// one side is written whole (a create) or as null (a delete). `depthSpec` maps a
// TOP-LEVEL key to how many path segments reach its leaves (default 1 = the whole
// value is one leaf), or to a function (parts) => isLeaf for the odd shape. The
// values returned are copies, safe to keep.
function treeDiff(prev, cur, depthSpec) {
  const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isLeaf = (parts) => {
    const d = depthSpec && depthSpec[parts[0]];
    if (typeof d === 'function') return !!d(parts);
    return parts.length >= (typeof d === 'number' ? d : 1);
  };
  const out = {};
  const walk = (a, b, parts) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (!isLeaf(parts) && isMap(a) && isMap(b)) {
      Object.keys(Object.assign({}, a, b)).forEach((k) => walk(a[k], b[k], parts.concat(k)));
      return;
    }
    out[parts.join('/')] = b === undefined ? null : b;
  };
  const pa = syncCanon(prev);
  const pb = syncCanon(cur);
  const ma = isMap(pa) ? pa : {};
  const mb = isMap(pb) ? pb : {};
  Object.keys(Object.assign({}, ma, mb)).forEach((k) => walk(ma[k], mb[k], [k]));
  return out;
}

// applyOpsSafe(tree, ops, anchors) → { tree, dropped }. Applies treeDiff-style ops
// to a canonical tree, EXCEPT a field op whose record is absent: `anchors` maps a
// top-level key to how many path segments name a record (games: 2 → games/<id>),
// so `games/<id>/name` is dropped (and reported) when games/<id> is gone — writing
// it would resurrect a half record — while a whole-record op (a create) or a delete
// always applies. A field delete (null) into an absent record is a no-op, not news.
// The mirror case: a whole-record CREATE meeting a record that already exists is never
// an overwrite (two phones minted the same id at once — the later write would silently
// replace the other's game). Identical content (position `_o` aside) means the tree
// already says it and the op is skipped; different content is dropped as a collision.
// `opts.overwrite` is for a deliberate "Use mine". `dropped` entries: { path, value,
// record, collide? }.
function applyOpsSafe(tree, ops, anchors, opts) {
  const dropped = [];
  const apply = {};
  Object.keys(ops).forEach((path) => {
    const parts = path.split('/');
    const depth = anchors && anchors[parts[0]];
    if (depth && parts.length === depth && ops[path] !== null && !(opts && opts.overwrite)) {
      const cur = syncValueAt(tree, path);
      if (cur !== undefined) {
        if (JSON.stringify(cfgStripOrder(cur)) !== JSON.stringify(cfgStripOrder(syncCanon(ops[path])))) {
          dropped.push({ path, value: ops[path], record: path, collide: true });
        }
        return;
      }
    }
    if (depth && parts.length > depth) {
      const record = parts.slice(0, depth).join('/');
      if (syncValueAt(tree, record) === undefined) {
        if (ops[path] !== null) dropped.push({ path, value: ops[path], record });
        return;
      }
    }
    apply[path] = ops[path];
  });
  // Canonical in, canonical out: deleting a record's last sibling must not leave an
  // empty map behind (the database would have pruned it).
  return { tree: syncCanon(applySyncPaths(tree, apply)) || {}, dropped };
}

// fnv1a(str) → 8 hex chars: the 32-bit FNV-1a hash of a string's UTF-16 code units. A
// content fingerprint, not a security measure — restore points carry one so a read-back
// can tell "the body I wrote" from "something else" (setup-sync.js), and the schedule
// publisher will stamp `src` with one (Step 15).
function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ── Stranded work (setup-rebuild-spec §6.2 #3, "S2d") ──────────────
// Unsent work from a PREVIOUS camp year must never be written into the current
// one. The new-year wizard (Step 28) stamps `state.meta.epoch`; a phone that was
// away across it comes back holding edits made against last year's tree, and the
// three-way merge would happily re-apply every path nobody "touched" (the wizard
// cleared them all, so nobody did). When the epoch the server last confirmed to
// this phone differs from the one the server holds now, NONE of this phone's
// paths are kept: they are set aside here, as downloadable JSON, and the server's
// tree is adopted. Until an epoch exists (every camp today) both sides read '' and
// none of this runs. Stored per camp (lsKey) and wiped by clearLocalData; the
// bar in the sync-alert strip offers Download / Dismiss, and nothing here is
// ever synced or pushed.
const STRANDED_KEY = 'campScoreboardStranded';
const STRANDED_MAX_ENTRIES = 10; // newest kept; a phone only strands once per new year, so this is generous
let strandedList = null; // lazily read from storage on first use (never at load: boot-cache.test.js)

function readStranded() {
  if (strandedList) return strandedList;
  let list = [];
  try {
    const raw = JSON.parse(localStorage.getItem(lsKey(STRANDED_KEY)) || '[]');
    if (Array.isArray(raw)) list = raw.filter((en) => en && typeof en === 'object' && Array.isArray(en.changes));
  } catch (e) { /* unreadable or blocked storage: nothing stranded as far as this page can tell */ }
  strandedList = list;
  return list;
}

function strandedCount() {
  return readStranded().reduce((n, en) => n + en.changes.length, 0);
}

// Returns false when the write failed (the in-memory copy still serves Download
// for this page's life).
function writeStranded() {
  try {
    if (strandedList && strandedList.length) localStorage.setItem(lsKey(STRANDED_KEY), JSON.stringify(strandedList));
    else localStorage.removeItem(lsKey(STRANDED_KEY));
    return true;
  } catch (e) { return false; }
}

// The epoch a synced tree carries ('' = the legacy week, which has none).
function epochOfTree(t) {
  const e = syncValueAt(t, 'meta/epoch');
  return typeof e === 'string' ? e : '';
}

function addStranded(entry) {
  const list = readStranded();
  // Two tabs (or a reload after a crash between this write and the adopt's) can
  // strand the same work twice: identical epochs and changes are one entry.
  const key = (en) => en.from + '>' + en.to + ':' + JSON.stringify(en.changes);
  if (!list.some((en) => key(en) === key(entry))) list.push(entry);
  while (list.length > STRANDED_MAX_ENTRIES) list.shift();
  return writeStranded();
}

// The year the set-aside work belongs to, when every entry agrees on one (the camp week it was last synced in), else ''.
function strandedYear() {
  const years = [];
  readStranded().forEach((en) => {
    const t = Date.parse(en.lastSyncedAt || en.at);
    const y = isFinite(t) ? String(new Date(t).getUTCFullYear()) : '';
    if (y && years.indexOf(y) === -1) years.push(y);
  });
  return years.length === 1 ? years[0] : '';
}

// Step 28's template (the calm "tab" look, two lines at most): the year named once an entry can say which. The toast and the
// sign-out question carry the full sentence.
function strandedBarHtml() {
  const n = strandedCount();
  const y = strandedYear();
  return '<span class="sync-alert-ico" aria-hidden="true"><svg class="ico"><use href="#i-download"/></svg></span>' +
    `<span class="sync-alert-text" title="From the last camp week: they never synced, so they weren’t added to this week.">${n} change${n === 1 ? '' : 's'} from ${y ? esc(y) : 'last camp week'} ${n === 1 ? 'wasn’t' : 'weren’t'} added</span>` +
    '<span class="sync-quarantine-actions">' +
    '<button type="button" class="link-btn sync-quarantine-btn" data-stranded="download">Download</button> ' +
    '<button type="button" class="link-btn danger-link sync-quarantine-btn" data-stranded="dismiss">Dismiss</button>' +
    '</span>';
}

function strandedDownloadJson() {
  return JSON.stringify({
    app: 'campScoreboardStranded',
    camp: CAMP.id,
    label: CAMP.label,
    downloadedAt: new Date().toISOString(),
    note: 'Changes this phone made but never sent to the server before a new camp year began. ' +
      'They were NOT added to the new year. Each change is a path under state/ (scores and teams) ' +
      'or config/ (the games and days setup, by id: config/games/<game id>/<field>, config/days/<day id>/<field>) ' +
      'and the value that was set there (null = it was deleted).',
    entries: readStranded(),
  }, null, 2);
}

function downloadStranded() {
  if (!strandedCount()) return;
  downloadBlob(new Blob([strandedDownloadJson()], { type: 'application/json' }),
    'camp-unsynced-changes-' + CAMP.id + '-' + new Date().toISOString().slice(0, 10) + '.json');
  showToast('Saved to your downloads. Tap Dismiss in the bar once you have the file.');
}

// Delete what was set aside. Asked first: this is the only copy (askDialog where the setup frame loaded, the browser's own question otherwise).
async function dismissStranded() {
  const n = strandedCount();
  if (!n) return;
  const q = `Delete ${n === 1 ? 'this change' : 'these ' + n + ' changes'} from this phone?`;
  const body = `${n === 1 ? 'It was' : 'They were'} not added to this week, and ${n === 1 ? 'it' : 'they'} can’t be brought back.`;
  let yes;
  if (typeof askDialog === 'function') {
    yes = (await askDialog({ title: q, body, actions: [{ label: 'Keep ' + (n === 1 ? 'it' : 'them'), value: 'keep', cancel: true }, { label: 'Delete ' + (n === 1 ? 'it' : 'them'), value: 'delete', kind: 'danger' }] })) === 'delete';
  } else yes = confirm(q + ' ' + body);
  if (!yes) return;
  strandedList = [];
  writeStranded();
  updateSyncIndicator();
}

// This phone's paths against a server that has moved to another epoch: set them
// aside, adopt the server. Returns false when there is nothing worth setting
// aside (only the activity stamp), so the caller falls through to a plain adopt.
function strandOldEpochWork(remote, mine, fromEpoch, toEpoch, baseAt) {
  const changes = Object.keys(mine).filter((p) => p !== 'meta/lastDataChangeAt').map((p) => ({
    path: p, what: quarantineLabel(p), value: mine[p] === undefined ? null : mine[p],
  }));
  if (!changes.length) return false;
  const kept = addStranded({
    at: new Date().toISOString(),
    from: fromEpoch || 'legacy',
    to: toEpoch || 'legacy',
    lastSyncedAt: baseAt ? new Date(baseAt).toISOString() : null,
    changes,
  });
  // A refused edit parked from last year would be laid back over the new tree by
  // the adopt below and keep its red bar up for a week it doesn't belong to.
  if (Object.keys(stateQuarantine).length) {
    stateQuarantine = {};
    quarantineAutoRetried = {};
    quarantineChanged();
  }
  dataEditPending = false;
  applyRemoteState(remote); // the server's tree is also the new confirmed base; nothing is pushed
  const n = changes.length;
  showToast(`⚠️ This phone had ${n} change${n === 1 ? '' : 's'} from last camp week that never synced. ${n === 1 ? 'It wasn’t' : 'They weren’t'} added to this week. ` +
    (kept ? `Download ${n === 1 ? 'it' : 'them'} from the bar at the top of the page.` : 'This phone is out of room to keep them, so download them now.'));
  updateSyncIndicator();
  return true;
}

// Returns true when it handled the snapshot (adopted + pushed our edits).
function firstSnapshotMerge(remote) {
  // Read before anything below adopts a snapshot (which re-stamps it).
  const baseAt = Number(state._syncBaseAt) || 0;
  const base = syncCanonTree(bootSyncedTree);
  const local = syncCanonTree(syncedSnapshot());
  const mine = computeSyncUpdates(base, local);
  const minePaths = Object.keys(mine);
  if (!minePaths.length) return false; // nothing of ours outstanding — plain adopt
  // A different epoch than the one the server last confirmed to this phone: the
  // new year began while it was away, so its unsent work is last year's (see
  // "Stranded work" above). A wholly EMPTY node says nothing about an epoch (a
  // console wipe takes meta with it), so that case keeps its own rule in
  // handleRemoteSnapshot. Legacy camps read '' on both sides: a no-op.
  if (remote && Object.keys(remote).length) {
    const fromEpoch = epochOfTree(base);
    const toEpoch = epochOfTree(remote);
    if (fromEpoch !== toEpoch) return strandOldEpochWork(remote, mine, fromEpoch, toEpoch, baseAt);
  }
  const serverTree = syncCanonTree(remote);
  const theirs = computeSyncUpdates(base, serverTree);
  const theirPaths = Object.keys(theirs);
  const keep = {};
  const conflicts = [];
  const canonAt = (t, p) => { const v = syncCanon(syncValueAt(t, p)); return v === undefined ? null : v; };
  minePaths.forEach((p) => {
    if (p === 'meta/lastDataChangeAt') {
      const srv = syncValueAt(serverTree, p);
      if (!srv || String(mine[p]) > String(srv)) keep[p] = mine[p];
      return;
    }
    if (JSON.stringify(canonAt(serverTree, p)) === JSON.stringify(syncCanon(mine[p]) === undefined ? null : syncCanon(mine[p]))) return;
    if (theirPaths.some((q) => syncPathsOverlap(p, q))) { conflicts.push(p); return; }
    keep[p] = mine[p];
  });
  // A parked path (stateQuarantine) that the server has since moved past is the
  // server's now — re-sending it would put last week's refused score into a
  // reset week. It counts as a conflict (the toast below is then true).
  const superseded = dropSupersededQuarantine(serverTree, base);
  superseded.forEach((p) => {
    delete keep[p];
    if (conflicts.indexOf(p) === -1) conflicts.push(p);
  });
  if (superseded.length) quarantineChanged(); // the loaded cache copy still names them
  // Device-local Pictionary words: the adopt below only re-attaches them to a
  // setup the SERVER already has, so a setup made offline would lose them.
  const words = {};
  Object.keys(state.picSetup || {}).forEach((gid) => {
    const s = state.picSetup[gid];
    if (s && Array.isArray(s.words) && s.words.length) words[gid] = s.words.slice();
  });
  dataEditPending = false;
  applyRemoteState(remote);
  // The CONFIRMED tree, never lastSyncedTree: with parked edits applyRemoteState
  // lays them over the server's tree, so lastSyncedTree already holds them. Used
  // as the base below, it made the diff find nothing to send and the parked path
  // was silently un-parked by a reload (confirmedTree is the un-overlaid tree).
  const serverNorm = JSON.parse(JSON.stringify(confirmedTree));
  // Work that waited a long time (more than a day and a half since the
  // server last confirmed anything) might belong to a week that has since
  // been reset — ask before sending it rather than slipping old results
  // into a new session.
  const realKeep = Object.keys(keep).filter((p) => p !== 'meta/lastDataChangeAt');
  if (realKeep.length && baseAt && Date.now() - baseAt > 36 * 60 * 60 * 1000) {
    const when = formatEasternStamp(new Date(baseAt).toISOString()) || 'a while ago';
    if (!confirm(`This phone has ${realKeep.length} change${realKeep.length === 1 ? '' : 's'} saved since ${when} that never reached the server. Send ${realKeep.length === 1 ? 'it' : 'them'} now?`)) {
      Object.keys(keep).forEach((p) => { delete keep[p]; });
    }
  }
  if (Object.keys(keep).length) {
    // asLocalEdit: these ARE this account's edits (made offline, never
    // logged — recordPointHistory had no database then), so the standings
    // render logs them to the change history instead of treating them as
    // someone else's remote update.
    applyRemoteState(applySyncPaths(serverNorm, keep), serverNorm, { asLocalEdit: true }); // base stays the SERVER's tree
    Object.keys(words).forEach((gid) => { if (state.picSetup[gid]) state.picSetup[gid].words = words[gid]; });
    persistState();
    lastSyncedTree = serverNorm;
    pushState();
  }
  if (conflicts.length) {
    showToast('⚠️ Something you changed while offline was also changed by someone else — kept their version.');
  }
  return true;
}

function applyRemoteState(remote, confirmedBase, opts) {
  clearDeferredSnapshot(); // this snapshot supersedes any read we still owed
  applyingRemote = true;
  // Signature of the synced slice before applying this snapshot. RTDB fires
  // a local `value` event for our own set(), so most snapshots are pure
  // echoes — re-rendering on those blurs the tally/bonus inputs and
  // dismisses the iOS keyboard mid-entry. Skip renderAll when nothing
  // actually changed (below).
  const beforeSig = syncSignature();
  const prevRefs = {};
  SYNC_KEYS.forEach((k) => { prevRefs[k] = state[k]; });
  // The snapshot is the entire synced tree, so a key missing from it
  // means "empty" — RTDB prunes empty objects on write. Treating
  // missing as keep-local made "New week (reset)" un-syncable: other
  // devices kept their old results and re-pushed them later. Teams
  // stay guarded — a snapshot without a roster is malformed, and so is a
  // half-built one (rosterIsWhole): this device keeps its own roster and, as an
  // editor, writes it back whole below.
  let rosterBroken = false;
  if (remote.teams) {
    if (rosterIsWhole(remote.teams)) state.teams = remote.teams;
    else rosterBroken = true;
  }
  // Announcements as they stood before this snapshot — anything the merge
  // adds beyond these is news worth a toast (see notifyNewAnnouncements).
  const annBefore = state.announcements || {};
  // Pictionary prompt words are never synced (see pushState) — the incoming
  // snapshot carries only each game's mode. Stash this device's own words so
  // the ref's list survives adopting a remote update, then re-attach them to
  // any setup the snapshot still has (a remotely-reset mode drops them too).
  const localPicWords = {};
  Object.keys(state.picSetup || {}).forEach((gid) => {
    const s = state.picSetup[gid];
    if (s && s.words && s.words.length) localPicWords[gid] = s.words;
  });
  ['results', 'brackets', 'brackets4', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'meta', 'clocks', 'announcements', 'notice'].forEach((k) => {
    state[k] = remote[k] !== undefined ? remote[k] : {};
  });
  Object.keys(localPicWords).forEach((gid) => {
    if (state.picSetup[gid]) state.picSetup[gid].words = localPicWords[gid];
  });
  // Realtime Database silently drops empty arrays/nulls on write, so a
  // freshly-started bracket or Pictionary round can come back missing
  // its empty fields. Heal everything the instant remote data lands,
  // before any render sees it.
  normalizeSyncedState();
  // Edits the rules refused (stateQuarantine) stay on top of the server's tree:
  // adopting it would silently wipe a score the director is still being told
  // about. The server's own tree is kept aside as the confirmed baseline.
  // A parked path the server has moved past (someone else changed it, or deleted
  // a record it lives in — "New week" clears every result at once) is the
  // server's now, not laid over: see dropSupersededQuarantine. Not judged on the
  // merge's second pass (confirmedBase set): its `remote` is the server tree with
  // this phone's own edits laid in, and the real one was judged on the first.
  let serverTree = null;
  let superseded = [];
  if (Object.keys(stateQuarantine).length) {
    serverTree = syncedSnapshot();
    if (!confirmedBase) superseded = dropSupersededQuarantine(serverTree, confirmedTree || (bootHadConfirmedBase ? bootSyncedTree : null));
    Object.keys(stateQuarantine).forEach((p) => setStatePath(p, stateQuarantine[p]));
    normalizeSyncedState();
  }
  // Pure echo: keep the live objects so open views' closures stay attached.
  if (syncSignature() === beforeSig) SYNC_KEYS.forEach((k) => { state[k] = prevRefs[k]; });
  // We now match the server, so this snapshot becomes the diff baseline —
  // otherwise the next push would re-send data we just received.
  lastSyncedTree = syncedSnapshot();
  writeConfirmedTree(confirmedBase || serverTree || lastSyncedTree);
  // A half-built roster came back (see rosterIsWhole), so the server no longer
  // holds what this device does: forget that it was confirmed and the next push
  // diffs `teams` as new — the whole array. A shallow copy, so the confirmed tree
  // written just above is left alone. Editors only: a viewer's write is refused.
  if (rosterBroken && canEdit()) {
    lastSyncedTree = Object.assign({}, lastSyncedTree, { teams: null });
    schedulePush();
  }
  // a parked path the server now agrees on is no longer parked
  if ((Object.keys(stateQuarantine).length && pruneQuarantine()) || superseded.length) quarantineChanged();
  if (superseded.length) showToast('↩️ A change that couldn’t be saved was replaced by a newer one from another device.');
  persistState();
  applyingRemote = false;
  // The first snapshot of a page load is catch-up, never news (chat's backlog
  // rule): a phone that was away, or one that never synced before, would
  // otherwise be told about every result in the database at once. Our own
  // offline edits re-applied by firstSnapshotMerge (asLocalEdit) aren't news
  // either.
  const resultChanges = resultAlertsArmed && !(opts && opts.asLocalEdit)
    ? detectResultChanges(prevRefs.results, state.results) : [];
  resultAlertsArmed = true;
  if (appStarted && syncSignature() !== beforeSig) {
    remoteJustApplied = !(opts && opts.asLocalEdit); // let runStandingsSideEffects raise the point alerts for it
    const matchupChanges = detectMatchupChanges();
    renderAll();
    notifyMatchupChanges(matchupChanges);
    notifyResultChanges(resultChanges);
    notifyNewAnnouncements(annBefore);
  }
  cfgFollowStateEpoch(); // the week config's baseline follows the epoch this snapshot carries (sync-F11)
  epochDeviceReset(); // a new camp year clears what this phone remembered about the last one (§6.11)
  ensureSecrecySeed(); // after the snapshot is in place, so the one-key write diffs against it
}

// Set once the first snapshot of this page load has been applied (see above).
let resultAlertsArmed = false;

// One-shot wrapper around initSync — THE only sanctioned way in. Called from
// onMemberSnapshot's approved branch, never earlier: under the locked rules a
// listener attached before approval is cancelled, and a cancelled read is
// terminal (see the fbRef error callback below).
let syncStarted = false;

function startSync() {
  if (syncStarted) return;
  syncStarted = true;
  initSync();
}

function initSync() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || typeof firebase === 'undefined') {
    updateSyncIndicator();
    return; // local-only mode
  }
  try {
    // (firebase.initializeApp happens in startAuth() — auth needs the app
    // object before the database does.)
    fbRef = firebase.database().ref(dbPath('state'));
    updateSyncIndicator(); // sync is on but unconfirmed — show "Connecting…"
    fbRef.on('value', (snap) => {
      handleRemoteSnapshot(snap.val());
    }, (err) => {
      // A cancelled read is terminal — the SDK won't re-arm it. Since refs
      // only ever attach AFTER membership was confirmed, landing here means
      // access was revoked mid-session (the member listener delivers the
      // actual kick); tell the truth in the indicator either way.
      console.warn('Firebase read failed, staying local', err);
      fbRef = null;
      fbConnected = false;
      syncDenied = true;
      updateSyncIndicator();
    });
    // Shared clock reference for the synced game clocks (see serverNow). Fires
    // once shortly after connect and again whenever the estimate is refined.
    firebase.database().ref('.info/serverTimeOffset').on('value', (s) => {
      const off = Number(s.val());
      if (!Number.isFinite(off)) return;
      const changed = Math.abs(off - serverTimeOffset) > 500;
      const firstAnswer = !serverOffsetKnown;
      serverTimeOffset = off;
      serverOffsetKnown = true;
      if (changed || firstAnswer) rememberServerOffset(off);
      // A big correction means every visible countdown was wrong — repaint now
      // rather than waiting for the next 500ms tick to creep it into place.
      if (changed && appStarted) tickBoardClocks();
      // …and every "is it 8 AM yet" answer the standings reveal gave (reveal.js).
      // (the first answer too, even a small one: it lifts the reveal's clock-unknown hold-back)
      if ((changed || firstAnswer) && typeof revealOnClockChange === 'function') revealOnClockChange();
    }, () => { /* rules/offline — stay on device time */ });
    // Honest connection state: RTDB's .info/connected flips as wifi comes and
    // goes, so the indicator can say "Offline — will sync when back" instead of
    // a permanent "Synced".
    firebase.database().ref('.info/connected').on('value', (s) => {
      fbConnected = !!s.val();
      fbConnKnown = true; // first real answer — retire the "Connecting…" spinner
      noteConnectionChange(fbConnected);
      if (typeof revealOnConnectionChange === 'function') revealOnConnectionChange(fbConnected); // a Start waits out a fresh connection (reveal.js)
      updateSyncIndicator();
      // Re-register presence on every (re)connect — onDisconnect handlers
      // don't survive a dropped socket, so a reconnect after wifi drops or
      // the phone waking up needs a fresh one each time.
      if (fbConnected) registerPresence();
      // "Also here" (setup-sync.js): a director's builder row needs registering afresh on every connect too.
      if (fbConnected && typeof editorsHereOnConnect === 'function') editorsHereOnConnect();
      // Camper names typed while the signal was gone (held in memory on the open screen, never stored) go now.
      if (fbConnected && typeof campersOnConnect === 'function') campersOnConnect();
    });
    // Count listener lives here (not inside the connected handler above) so
    // it's registered exactly once — putting it there would re-subscribe on
    // every reconnect and stack up duplicate listeners.
    try {
      firebase.database().ref(dbPath('presence')).on('value', (snap) => {
        presenceRows = snap.val();
        presenceCount = presenceDeviceCount(presenceRows);
        renderPresence();
      }, () => { /* denied: the chip stays hidden. Never touch fbRef/syncDenied. */ });
    } catch (e) { /* ignore — chip just stays hidden */ }
    // Week-config catalog listener (sibling ref — see the fbConfigRef comment).
    fbConfigRef = firebase.database().ref(dbPath('config'));
    attachConfigListener();
    // The week's setup data (setup-sync.js — optional layer, typeof-guarded): one
    // read-only listener, attached HERE and only here, i.e. after membership was
    // confirmed. Its refusals degrade the setup engine only, never fbRef/syncDenied.
    if (typeof initSetupSync === 'function') initSetupSync();
    // Who is asking to join (setup-sync.js "PEOPLE" — optional layer, same guard): a director's device attaches ONE editor-only
    // query here, after membership was confirmed. A viewer's phone never listens; a refusal degrades this feature only.
    if (typeof peopleRequestsAttach === 'function') peopleRequestsAttach();
    // Staff directory: who's on the camp list and which team each is with.
    // Members may read the whole list (it's the staff roster), and this is
    // what makes the real counselor names show on each team everywhere. Only
    // attached here — i.e. after membership was confirmed — like every other
    // ref. A denial just leaves the hand-typed counselor text in place.
    try {
      firebase.database().ref(dbPath('members')).on('value', (snap) => {
        const next = snap.val() || {};
        // A re-fire with the same list (a reconnect) changes nothing on screen.
        const changed = !memberDirectoryLoaded || JSON.stringify(next) !== JSON.stringify(memberDirectory);
        memberDirectory = next;
        memberDirectoryLoaded = true;
        // Held while a field is focused — see renderAllWhenIdle.
        if (appStarted && changed) renderAllWhenIdle();
        // Chat shows author names FROM this directory (a message's own `name`
        // is client-supplied), so its bubbles need rebuilding when it lands.
        if (typeof onMemberDirectoryChanged === 'function') onMemberDirectoryChanged();
      }, () => { memberDirectory = null; memberDirectoryLoaded = false; });
    } catch (e) { /* ignore — counselor text falls back to state.teams */ }
    // Camp Chat listeners (chat.js — the tenth script; typeof-guarded so a
    // build without it still runs). Chat attaches HERE, i.e. only after
    // membership confirmed, and its own error handlers degrade chat only.
    if (typeof initChatSync === 'function') initChatSync();
    // Phone alerts (push.js — optional layer, same typeof guard). Same
    // invariant: it touches the database only from here on, post-approval.
    if (typeof initPush === 'function') initPush();
    // The standings reveal (reveal.js — optional layer, same guard): the counselor mirror listens to
    // <root>/revealPublic/real (a public path, but still only after approval, like every ref), a
    // director also to its practice child. A refusal degrades the reveal only.
    if (typeof initReveal === 'function') initReveal();
    // (Auto-reload is handled by startUpdatePolling — a same-origin poll of the
    // deployed index.html — so it works on a single device and doesn't depend on
    // Firebase or another client announcing the build.)
    // Flush a pending debounced push before the page is hidden/suspended. iOS
    // suspends setTimeout when the phone locks, so a result saved right before
    // locking would otherwise strand its 400ms push and never reach the server.
    window.addEventListener('pagehide', flushPendingPush);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushPendingPush();
    });
    updateSyncIndicator();
  } catch (e) {
    console.error('Firebase init failed, staying local-only', e);
    fbRef = null;
    updateSyncIndicator();
  }
}

function schedulePush() {
  if (!fbRef) return;
  clearTimeout(pushTimer);
  // Null the handle when it fires so `pushTimer !== null` is an accurate
  // "a local write is queued but not yet sent" signal — the remote merge
  // uses it to avoid clobbering an un-pushed edit (see initSync).
  pushTimer = setTimeout(() => { pushTimer = null; pushState(); }, 400); // coalesce rapid edits
}

// The synced form of picSetup: each game's MODE (source) travels so ref
// devices agree on labeling, but the actual Pictionary prompt words never
// leave the device that typed them — they're a surprise and must not be
// broadcast over the shared database. (The built-in list and viewer display
// are handled separately; this keeps custom 'own' words off the wire.)
function picSetupForSync(picSetup) {
  if (!picSetup || typeof picSetup !== 'object') return picSetup;
  const out = {};
  Object.keys(picSetup).forEach((gid) => {
    const s = picSetup[gid];
    out[gid] = (s && typeof s === 'object') ? { source: s.source } : s;
  });
  return out;
}

// Maps written per-child (one path per game/team/bonus) so concurrent edits to
// DIFFERENT items on different devices never overwrite each other. `teams` is
// per FIELD (see rosterAligned); `meta` is per field inside computeSyncUpdates.
const SYNC_ITEM_MAPS = ['results', 'brackets', 'picRounds', 'picSetup', 'bonuses', 'clocks', 'announcements'];
// `live` is NOT here — it's diffed one level deeper (per match field) in
// computeSyncUpdates so concurrent refs don't clobber each other's fields.
// `brackets4` is NOT here either — it is diffed per match (brackets4/<gid>/m/<match>).
// `notice` is the one singleton left — one composed card, always written whole.
// (`teams` stopped being one in S2b: a rename is one field, not the whole roster.)
const SYNC_SINGLETONS = ['notice'];

// Do two rosters line up by position — the same length, and the same team id at
// every index? Only then can a change be sent as `teams/<i>/<field>`; anything
// else (a reorder, a different size, no roster on one side, a record with no id)
// is structural and goes up as the whole `teams` array. Takes the canonical or
// the raw form alike (both are arrays of plain records).
function rosterAligned(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return false;
  return a.every((t, i) => t && b[i] && typeof t === 'object' && typeof b[i] === 'object'
    && typeof t.id === 'string' && t.id === b[i].id);
}

// A roster this app can run on: an array whose every record carries an id.
// Per-field team writes mean a state node wiped from the console can be re-grown
// by a single rename as `teams/2/name` alone, which RTDB hands back as a roster
// with holes and no ids. That must never replace the real one (applyRemoteState
// keeps ours and writes it back whole).
function rosterIsWhole(t) {
  return Array.isArray(t) && t.length > 0 && t.every((x) => x && typeof x === 'object' && typeof x.id === 'string');
}

// The synced portion of state as it should exist on the server: a deep copy
// with Pictionary words stripped (never synced). Serves as both the push
// source and the diff baseline, so both sides compare like-for-like.
function syncedSnapshot() {
  const snap = {};
  SYNC_KEYS.forEach((k) => { snap[k] = state[k] === undefined ? null : state[k]; });
  snap.picSetup = picSetupForSync(state.picSetup);
  return JSON.parse(JSON.stringify(snap)); // also strips any `undefined` RTDB rejects
}

// Flat RTDB multi-location update (path -> value, or null to delete) covering
// exactly what changed between two synced snapshots. Item maps diff per child,
// the roster per field, the notice whole.
function computeSyncUpdates(prev, cur) {
  const up = {};
  SYNC_ITEM_MAPS.forEach((k) => {
    const p = (prev && prev[k]) || {};
    const c = (cur && cur[k]) || {};
    Object.keys(c).forEach((id) => {
      if (JSON.stringify(c[id]) !== JSON.stringify(p[id])) up[k + '/' + id] = c[id];
    });
    Object.keys(p).forEach((id) => {
      if (!(id in c)) up[k + '/' + id] = null; // item deleted (cleared result, removed bonus, …)
    });
  });
  // brackets4 (the four-team bracket) is diffed per MATCH, brackets4/<gid>/m/<match>: two phones writing DIFFERENT matches keep both
  // (a whole-bracket write would put the stale half of each back; the screen walks the matches in order, so it takes a phone that
  // is a step behind to do it, and two phones recording the SAME match is last-write-wins, which the Re-check step then audits). A
  // bracket that is new, or changes shape, goes up whole; a finished or cancelled one is its deletion (finishing writes
  // results/<gid> in the same batch). Absent `winner` = undecided, so RTDB's pruning is harmless.
  {
    const p = (prev && prev.brackets4) || {};
    const c = (cur && cur.brackets4) || {};
    const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    Object.keys(c).forEach((gid) => {
      const cb = c[gid], pb = p[gid];
      if (JSON.stringify(cb) === JSON.stringify(pb)) return;
      if (!plain(cb) || !plain(pb)) { up['brackets4/' + gid] = cb; return; }
      Object.keys(cb).forEach((f) => {
        if (f !== 'm' && JSON.stringify(cb[f]) !== JSON.stringify(pb[f])) up['brackets4/' + gid + '/' + f] = cb[f];
      });
      Object.keys(pb).forEach((f) => { if (f !== 'm' && !(f in cb)) up['brackets4/' + gid + '/' + f] = null; });
      const cm = plain(cb.m) ? cb.m : {};
      const pm = plain(pb.m) ? pb.m : {};
      Object.keys(cm).forEach((k) => { if (JSON.stringify(cm[k]) !== JSON.stringify(pm[k])) up['brackets4/' + gid + '/m/' + k] = cm[k]; });
      Object.keys(pm).forEach((k) => { if (!(k in cm)) up['brackets4/' + gid + '/m/' + k] = null; });
    });
    Object.keys(p).forEach((gid) => { if (!(gid in c)) up['brackets4/' + gid] = null; });
  }
  // `live` is diffed one level deeper — per match FIELD — so two refs editing
  // the SAME match don't clobber each other: one bumping a team's score writes
  // only live/{gid}/hr, leaving another ref's live/{gid}/inning (the half)
  // untouched. Previously the whole match object was written on every action,
  // so a score tap re-sent that device's stale inning/half and reverted it. A
  // brand-new pairing (different key) or a mode switch replaces the whole node.
  {
    const p = (prev && prev.live) || {};
    const c = (cur && cur.live) || {};
    Object.keys(c).forEach((gid) => {
      const cm = c[gid], pm = p[gid];
      if (JSON.stringify(cm) === JSON.stringify(pm)) return;
      if (!pm || pm.key !== cm.key || pm.mode !== cm.mode) { up['live/' + gid] = cm; return; }
      Object.keys(cm).forEach((f) => {
        if (JSON.stringify(cm[f]) !== JSON.stringify(pm[f])) up['live/' + gid + '/' + f] = cm[f];
      });
      Object.keys(pm).forEach((f) => {
        if (!(f in cm)) up['live/' + gid + '/' + f] = null;
      });
    });
    Object.keys(p).forEach((gid) => { if (!(gid in c)) up['live/' + gid] = null; });
  }
  // drafts: diffed per scores/medals LEAF so two editors on one tally game don't wipe each other.
  {
    const p = (prev && prev.drafts) || {};
    const c = (cur && cur.drafts) || {};
    Object.keys(c).forEach((gid) => {
      const cd = c[gid], pd = p[gid];
      if (JSON.stringify(cd) === JSON.stringify(pd)) return;
      if (!cd || typeof cd !== 'object') { up['drafts/' + gid] = cd === undefined ? null : cd; return; }
      const pdo = (pd && typeof pd === 'object') ? pd : {};
      ['scores', 'medals'].forEach((f) => {
        const cf = (cd[f] && typeof cd[f] === 'object') ? cd[f] : {};
        const pf = (pdo[f] && typeof pdo[f] === 'object') ? pdo[f] : {};
        Object.keys(cf).forEach((k) => { if (JSON.stringify(cf[k]) !== JSON.stringify(pf[k])) up['drafts/' + gid + '/' + f + '/' + k] = cf[k]; });
        Object.keys(pf).forEach((k) => { if (!(k in cf)) up['drafts/' + gid + '/' + f + '/' + k] = null; });
      });
    });
    Object.keys(p).forEach((gid) => { if (!(gid in c)) up['drafts/' + gid] = null; });
  }
  // meta: per field, hiddenCards per card, so a score save (lastDataChangeAt) never reverts another editor's hide.
  {
    const p = (prev && prev.meta && typeof prev.meta === 'object') ? prev.meta : {};
    const c = (cur && cur.meta && typeof cur.meta === 'object') ? cur.meta : {};
    Object.keys(c).forEach((f) => {
      if (f === 'hiddenCards' && c[f] && typeof c[f] === 'object') {
        const ph = (p.hiddenCards && typeof p.hiddenCards === 'object') ? p.hiddenCards : {};
        Object.keys(c[f]).forEach((card) => { if (JSON.stringify(c[f][card]) !== JSON.stringify(ph[card])) up['meta/hiddenCards/' + card] = c[f][card]; });
        Object.keys(ph).forEach((card) => { if (!(card in c[f])) up['meta/hiddenCards/' + card] = null; });
      } else if (JSON.stringify(c[f]) !== JSON.stringify(p[f])) up['meta/' + f] = c[f];
    });
    Object.keys(p).forEach((f) => {
      if (f === 'hiddenCards' && !(f in c) && p[f] && typeof p[f] === 'object') Object.keys(p[f]).forEach((card) => { up['meta/hiddenCards/' + card] = null; });
      else if (!(f in c)) up['meta/' + f] = null;
    });
  }
  // teams: per FIELD while the roster lines up by position, so two directors
  // renaming DIFFERENT teams (or one renaming and one setting counselors) keep
  // both edits — the whole array used to go up on every rename and the last
  // writer won all six. Reordering moves ids between positions, so a reorder (or
  // any roster that doesn't line up) is written whole, like a first push.
  {
    const pt = prev ? prev.teams : undefined;
    const ct = cur ? cur.teams : undefined;
    if (JSON.stringify(ct) !== JSON.stringify(pt)) {
      if (rosterAligned(pt, ct)) {
        ct.forEach((t, i) => {
          const p = pt[i];
          Object.keys(t).forEach((f) => {
            if (JSON.stringify(t[f]) !== JSON.stringify(p[f])) up['teams/' + i + '/' + f] = t[f] === undefined ? null : t[f];
          });
          Object.keys(p).forEach((f) => { if (!(f in t)) up['teams/' + i + '/' + f] = null; });
        });
      } else up.teams = ct === undefined ? null : ct;
    }
  }
  SYNC_SINGLETONS.forEach((k) => {
    const pv = prev ? prev[k] : undefined;
    const cv = cur ? cur[k] : undefined;
    if (JSON.stringify(cv) !== JSON.stringify(pv)) up[k] = (cv === undefined ? null : cv);
  });
  return up;
}

function pushState() {
  if (!fbRef || applyingRemote || !remoteReady) return;
  // Undecided tabs hold (the diff below is untouched, so it goes out once decided);
  // a read-only tab has no edits of its own (see the tab writer block).
  if (!tabMayPush('state')) return;
  // A refused batch is being re-sent path by path (see the quarantine block
  // below). A push now could land a newer value that the retry then overwrites
  // with its older one, so it waits and runs the moment the bisect ends. The
  // edit isn't lost meanwhile: dataEditPending stays raised and the local
  // cache already holds it.
  if (stateBisecting) { stateBisectHeld = true; return; }
  const cur = syncedSnapshot();
  const prevBaseline = lastSyncedTree;
  // First push (or recovering from a failed one): write every top-level key so
  // the server is brought fully in step. Afterwards only changed items go up.
  const updates = prevBaseline
    ? computeSyncUpdates(prevBaseline, cur)
    : SYNC_KEYS.reduce((u, k) => { u[k] = cur[k]; return u; }, {});
  // Adopt `cur` as the new baseline optimistically; restore it on failure so
  // the same changes are re-diffed (and re-sent per-path) next time rather than
  // stranded.
  lastSyncedTree = cur;
  dataEditPending = false; // current state (incl. any edit) is going to the server
  if (!Object.keys(updates).length) return; // nothing actually changed
  // Track the write until the server confirms it. Offline, the promise stays
  // pending (the SDK queues the write and flushes on reconnect), so
  // pendingWrites stays > 0 and the merge won't adopt the stale reconnect
  // snapshot until our cached edit has uploaded. Settle on success AND failure
  // so a rejected write can't wedge sync closed.
  pendingWrites++;
  const settle = () => { pendingWrites = Math.max(0, pendingWrites - 1); };
  // update() can throw SYNCHRONOUSLY (an illegal key in the payload, say, from
  // a hand-edited backup). Without this catch the counter would stay raised
  // forever, and canAdoptRemote() would refuse every future snapshot — the
  // device would sit there looking connected while silently never syncing again.
  try {
    fbRef.update(updates).then(() => {
      // The server now holds these paths: advance the persisted baseline by
      // exactly them (acks arrive in write order, so this composes).
      writeConfirmedTree(applySyncPaths(confirmedTree || prevBaseline || {}, updates), true);
      pruneQuarantineAndRepaint(); // a Retry that got through clears its line
      settle();
      if (typeof gamesSavedRefresh === 'function') gamesSavedRefresh(); // "Saving…" → "Saved … everyone's phone has it" (the open game's line)
    }, (e) => {
      // ONLY a rules refusal is quarantined (S2a), and only for an editor — the
      // person who typed the value and can Retry or Discard it. One refused path
      // refuses the whole atomic update, and re-diffing the same batch forever
      // wedged every score behind it. Every other failure (a dropped connection,
      // an SDK error) and a view-only device's stray diff (nothing a counselor
      // needs to be told about) keep the original quiet handling below.
      if (e && e.code === 'PERMISSION_DENIED' && directorTab()) { startStateBisect(updates, prevBaseline, settle); return; }
      console.warn('sync push failed', e);
      lastSyncedTree = prevBaseline; // re-send these changes (still per-path) next push
      settle();
    });
  } catch (e) {
    console.warn('sync push threw', e);
    lastSyncedTree = prevBaseline;
    settle();
  }
}

// ── Refused writes: quarantine, never a wedge (setup-rebuild-spec §6.2 #1) ──
// pushState is ONE atomic multi-path update(), so a single path the rules refuse
// (a rules/code mismatch, a record removed under an edit) refused the whole
// batch — and the old handler restored the baseline and re-sent the same batch on
// the next push, forever: every score entered after it queued behind one poisoned
// path, with only a console.warn. On PERMISSION_DENIED (and only then) the refused
// batch is re-sent one path at a time: paths the server takes advance the
// confirmed baseline exactly like an ack; a path refused ALONE is parked in
// stateQuarantine, treated as sent (lastSyncedTree already holds it, so it isn't
// retried forever) and named on the sync line with Retry / Discard. Every other
// failure of a write (a dropped connection) keeps its original handling.
//   • One bisect at a time, and it counts in pendingWrites (settle runs when it
//     ends), so the adopt / reload / sign-out guards see it like any write.
//   • pushState holds new pushes while a bisect runs and runs them after (sync-F15):
//     a score tapped mid-bisect must not land BEFORE the retry of an older value
//     of the same path. Each retried path is also re-read from the live local
//     state and skipped when it changed since the refused batch — the newer value
//     goes out in that next push (lastSyncedTree still holds the batch's value, so
//     the diff finds it).
//   • Persisted as state._quarantine in the same STORAGE_KEY write as the scores
//     (not synced, not in backups), so a refused score and its explanation survive
//     a reload. After a reload the first-snapshot merge re-sends the path (its
//     base is the CONFIRMED tree, which never holds a parked value), which
//     self-heals once the rules accept it and re-parks it if they still refuse.
//   • An editor sees it where they are looking: a bar pinned to the very top of
//     the page (#sync-alert), not only the line inside the closed Current
//     Standings card. Each parked path also gets ONE silent automatic retry a
//     little later (a transient refusal — an auth blip — used to self-heal on
//     the next push, so it should not need a human), then waits for Retry.
//   • The server wins when it moved past a parked path (dropSupersededQuarantine);
//     a view-only device never quarantines (pushState).
const STATE_BISECT_SINGLES = 50; // up to this many paths are re-sent one by one; more are halved first
let stateQuarantine = readQuarantine(); // path -> the value the rules refused (null = a delete)
let stateBisecting = false;  // a refused batch is being re-sent
let stateBisectQueue = [];   // refused batches waiting their turn
let stateBisectHeld = false; // a pushState arrived mid-bisect (see pushState)
const QUARANTINE_AUTO_RETRY_MS = 20000;
let quarantineAutoRetried = {}; // path -> true once it has had its one automatic retry
let quarantineRetryTimer = null;

// Runs at load, so it may touch only `state` and SYNC_KEYS (boot-cache.test.js:
// a later top-level const read from here is a TDZ crash and a blank app).
function readQuarantine() {
  const q = state && state._quarantine;
  const out = {};
  if (q && typeof q === 'object' && !Array.isArray(q)) {
    Object.keys(q).forEach((p) => {
      if (SYNC_KEYS.indexOf(p.split('/')[0]) !== -1) out[p] = q[p] === undefined ? null : q[p];
    });
  }
  return out;
}

// The one place the parked set changes shape: mirrors it into state (so every
// STORAGE_KEY write carries it), persists, and repaints the sync line.
function quarantineChanged() {
  if (Object.keys(stateQuarantine).length) state._quarantine = stateQuarantine;
  else delete state._quarantine;
  persistState(); // (the in-memory copy still shows the line if the write fails)
  updateSyncIndicator();
}

// What `tree` holds at `path`, as a value an update() can carry (null = absent).
function stateBaselineAt(tree, path) {
  const v = syncValueAt(tree, path);
  return v === undefined ? null : v;
}

// Does the live local value at `path` still equal `value` (compared in RTDB-
// canonical form, so a healed empty never reads as a change)?
function stateValueIs(path, value) {
  return JSON.stringify(syncCanon(syncValueAt(syncedSnapshot(), path))) === JSON.stringify(syncCanon(value));
}

// A path leaves the parked set for good (saved, replaced, discarded): its
// automatic-retry mark goes with it, so a LATER refusal of the same path is
// announced and retried afresh rather than treated as already-seen.
function unpark(p) {
  delete stateQuarantine[p];
  delete quarantineAutoRetried[p];
}

// Drop parked paths whose local value now equals what the server confirmed: the
// retry got through, somebody else's snapshot replaced it, or Discard restored it.
function pruneQuarantine() {
  if (!confirmedTree) return false;
  let changed = false;
  Object.keys(stateQuarantine).forEach((p) => {
    if (JSON.stringify(syncCanon(syncValueAt(confirmedTree, p))) === JSON.stringify(syncCanon(syncValueAt(syncedSnapshot(), p)))) {
      unpark(p);
      changed = true;
    }
  });
  return changed;
}

// Parked paths the server has moved past since it last confirmed anything to
// this phone (`prevTree`): somebody else changed the same value, or deleted a
// record it lives in. Laying the parked value over THAT would keep last week's
// refused result on top of a reset week until someone Discards it, so the
// server's version wins — the rule the first-snapshot merge applies to any path
// changed on both sides. Returns the paths it dropped; the caller persists and
// says so. (Without a confirmed baseline there is nothing to compare: keep.)
function dropSupersededQuarantine(serverTree, prevTree) {
  const dropped = [];
  if (!prevTree) return dropped;
  const valueKey = (t, p) => { const v = syncCanon(syncValueAt(t, p)); return v === undefined ? 'null' : JSON.stringify(v); };
  Object.keys(stateQuarantine).forEach((p) => {
    const parts = p.split('/');
    let moved = valueKey(serverTree, p) !== valueKey(prevTree, p);
    // An ancestor that held something and is now gone (the record was removed).
    for (let i = 1; !moved && i < parts.length; i++) {
      const q = parts.slice(0, i).join('/');
      moved = valueKey(prevTree, q) !== 'null' && valueKey(serverTree, q) === 'null';
    }
    if (moved) { unpark(p); dropped.push(p); }
  });
  return dropped;
}

function pruneQuarantineAndRepaint() {
  if (Object.keys(stateQuarantine).length && pruneQuarantine()) quarantineChanged();
}

function startStateBisect(updates, prevBaseline, settle) {
  stateBisectQueue.push({ updates, prevBaseline, settle });
  if (stateBisecting) return; // the running bisect picks it up next
  stateBisecting = true;
  runStateBisects().catch((e) => { console.warn('sync bisect failed', e); });
}

async function runStateBisects() {
  try {
    while (stateBisectQueue.length) {
      const job = stateBisectQueue.shift();
      try { await bisectRefusedBatch(job); }
      catch (e) { console.warn('sync bisect failed', e); }
      finally { job.settle(); }
    }
  } finally {
    stateBisecting = false;
    if (stateBisectHeld) { stateBisectHeld = false; pushState(); } // the pushes held meanwhile
  }
}

async function bisectRefusedBatch(job) {
  const updates = job.updates;
  const prevBaseline = job.prevBaseline;
  const open = new Set(Object.keys(updates)); // neither saved, parked nor superseded yet
  let parked = 0;
  // Send `group` as one update. true = taken (or nothing left to send), false =
  // refused. A path whose live value moved on since the refused batch is
  // dropped from the group first (sync-F15) — its newer value is the next
  // normal push's job.
  const send = async (group) => {
    const sub = {};
    group.forEach((p) => {
      if (stateValueIs(p, updates[p])) sub[p] = updates[p]; else open.delete(p);
    });
    if (!Object.keys(sub).length) return true;
    try {
      await fbRef.update(sub);
    } catch (e) {
      if (e && e.code === 'PERMISSION_DENIED') return false;
      throw e; // a dropped connection etc.: the finally below hands the rest back to the diff
    }
    writeConfirmedTree(applySyncPaths(confirmedTree || prevBaseline || {}, sub), true); // as an ack does
    Object.keys(sub).forEach((p) => open.delete(p));
    return true;
  };
  const park = (p) => {
    open.delete(p);
    if (!(p in stateQuarantine)) parked++; // said once: a path already parked (a retry refused again) is not announced again
    stateQuarantine[p] = updates[p] === undefined ? null : updates[p];
    quarantineChanged();
  };
  const settleGroup = async (group) => {
    if (group.length > STATE_BISECT_SINGLES) {
      const mid = group.length >> 1;
      for (const half of [group.slice(0, mid), group.slice(mid)]) {
        if (!(await send(half))) await settleGroup(half);
      }
      return;
    }
    for (const p of group) {
      if (!open.has(p)) continue;
      if (!(await send([p]))) park(p);
    }
  };
  try {
    await settleGroup(Object.keys(updates));
  } catch (e) {
    console.warn('sync push failed', e);
  } finally {
    // Whatever the bisect never reached (the connection dropped part-way) goes
    // back into the diff, exactly as the unquarantined failure path restores it.
    if (open.size && lastSyncedTree) {
      const back = {};
      open.forEach((p) => { back[p] = stateBaselineAt(prevBaseline, p); });
      lastSyncedTree = applySyncPaths(lastSyncedTree, back);
    }
  }
  pruneQuarantineAndRepaint();
  if (parked) showToast('⚠️ A change couldn’t be saved. Retry or Discard it from the red bar at the top of the screen.');
  scheduleQuarantineAutoRetry();
}

// Words for the sync line: which game, and which part of it.
const QUARANTINE_PART_WORDS = {
  results: 'result', brackets: 'bracket', brackets4: 'bracket', drafts: 'draft scores', picRounds: 'Pictionary round',
  picSetup: 'Pictionary setup', bonuses: 'bonus points', live: 'live score', clocks: 'game clock',
  announcements: 'announcement', teams: 'team names', notice: 'notice board', meta: 'camp settings',
};
function quarantineLabel(path) {
  const parts = path.split('/');
  const word = QUARANTINE_PART_WORDS[parts[0]] || parts[0];
  const g = parts[1] ? allGames().find((x) => x.id === parts[1]) : null;
  return g ? g.name + ' → ' + word : word.charAt(0).toUpperCase() + word.slice(1);
}

// What is parked, in words, escaped: "Kickball → result, Verse → bonus points +1 more".
function quarantineNames() {
  const names = [];
  Object.keys(stateQuarantine).forEach((p) => { const l = quarantineLabel(p); if (names.indexOf(l) === -1) names.push(l); });
  return names.slice(0, 2).map(esc).join(', ') + (names.length > 2 ? ` +${names.length - 2} more` : '');
}

function quarantineActionsHtml() {
  return '<span class="sync-quarantine-actions">' +
    '<button type="button" class="link-btn sync-quarantine-btn" data-sync-quarantine="retry">Retry</button> ' +
    '<button type="button" class="link-btn danger-link sync-quarantine-btn" data-sync-quarantine="discard">Discard</button>' +
    '</span>';
}

function quarantineLineHtml() {
  const n = Object.keys(stateQuarantine).length;
  // No buttons for a tab that cannot write (a director's view-only second tab, a
  // demoted phone): a parked path loaded from the cache belongs to the WRITER tab,
  // and Retry / Discard here would only change this tab's memory.
  return `⚠️ ${n} change${n === 1 ? '' : 's'} couldn’t be saved: <em>${quarantineNames()}</em>` + (canEdit() ? ' ' + quarantineActionsHtml() : '');
}

// The top bar's copy of it: one short row (the names truncate to the width).
function quarantineBarHtml() {
  const n = Object.keys(stateQuarantine).length;
  return `<span class="sync-alert-text">⚠️ ${n} change${n === 1 ? '' : 's'} unsaved: <em>${quarantineNames()}</em></span>` + quarantineActionsHtml();
}

// Retry: put every parked path back into the diff (baseline = what the server
// holds) and push now. What goes out is the CURRENT local value, which may have
// moved on since the refusal. Refused again, it is simply parked again.
function retryQuarantined() {
  if (!canEdit()) return; // a read-only tab would clear its copy and push nothing: it would read as synced
  const paths = Object.keys(stateQuarantine);
  if (!paths.length) return;
  if (!fbRef || !remoteReady) { showToast('Not connected yet. Try again in a moment.'); return; }
  rebaseQuarantined(paths);
  stateQuarantine = {};
  quarantineAutoRetried = {};
  quarantineChanged();
  pushState(); // held until the running bisect ends, if one is
}

// Put `paths` back into the diff: their baseline becomes what the server holds.
function rebaseQuarantined(paths) {
  if (!lastSyncedTree) return;
  const back = {};
  paths.forEach((p) => { back[p] = confirmedTree ? stateBaselineAt(confirmedTree, p) : null; });
  lastSyncedTree = applySyncPaths(lastSyncedTree, back);
}

// The one automatic Retry each parked path gets, QUARANTINE_AUTO_RETRY_MS after
// it was parked. A transient refusal (an auth blip, a rules fix published a
// moment later) used to heal on the very next push; parking made it need a
// human, so give it one quiet chance first. The path stays parked meanwhile (the
// bar doesn't flicker): an ack clears it through pruneQuarantine, a second
// refusal just re-parks it without a new toast.
function scheduleQuarantineAutoRetry() {
  if (quarantineRetryTimer || !Object.keys(stateQuarantine).some((p) => !quarantineAutoRetried[p])) return;
  quarantineRetryTimer = setTimeout(() => { quarantineRetryTimer = null; autoRetryQuarantined(); }, QUARANTINE_AUTO_RETRY_MS);
}

function autoRetryQuarantined() {
  const fresh = Object.keys(stateQuarantine).filter((p) => !quarantineAutoRetried[p]);
  if (!fresh.length || !fbRef || !remoteReady || !directorTab()) return; // the parked work is the director's, preview or not
  fresh.forEach((p) => { quarantineAutoRetried[p] = true; });
  rebaseQuarantined(fresh);
  pushState();
}

// Write `value` (null = delete) at a synced path into live state, in place, and
// prune the parents that emptied (what the server would do), so a discarded
// write leaves no hollow `live/<game>` behind.
function setStatePath(path, value) {
  const parts = path.split('/');
  const copy = value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
  const top = parts[0];
  if (parts.length === 1) {
    if (top === 'teams') { if (copy) state.teams = copy; return; } // a roster is never emptied
    state[top] = copy === null ? {} : copy;
    return;
  }
  const chain = [];
  let node = state[top];
  if (!node || typeof node !== 'object') {
    if (copy === null) return;
    node = state[top] = {};
  }
  chain.push([null, node]);
  for (let i = 1; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== 'object') {
      if (copy === null) return;
      node[parts[i]] = {};
    }
    chain.push([parts[i], node[parts[i]]]);
    node = node[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (copy === null) {
    delete node[last];
    for (let i = chain.length - 1; i > 0; i--) { // never the top-level map itself
      if (Object.keys(chain[i][1]).length) break;
      delete chain[i - 1][1][chain[i][0]];
    }
  } else node[last] = copy;
}

// Discard: put each parked path back to the value the server confirmed, in the
// live state AND the diff baseline, so nothing is re-sent. Asked first — the
// director typed those values.
function discardQuarantined() {
  if (!canEdit()) return; // see retryQuarantined
  const paths = Object.keys(stateQuarantine);
  if (!paths.length) return;
  if (!confirmedTree) { showToast('Not connected yet. Try again in a moment.'); return; }
  const n = paths.length;
  if (!confirm(`Discard ${n === 1 ? 'the change' : 'these ' + n + ' changes'} that couldn’t be saved? The scoreboard goes back to what is saved.`)) return;
  const back = {};
  paths.forEach((p) => {
    back[p] = stateBaselineAt(confirmedTree, p);
    setStatePath(p, back[p]);
  });
  if (lastSyncedTree) lastSyncedTree = applySyncPaths(lastSyncedTree, back);
  normalizeSyncedState();
  stateQuarantine = {};
  quarantineAutoRetried = {};
  quarantineChanged();
  renderAll();
}

// One delegated listener per sync line (all three copies); the buttons live inside
// markup updateSyncIndicator rewrites, so they can't carry listeners of their own.
function onSyncStatusClick(e) {
  const claim = e && e.target && e.target.closest ? e.target.closest('[data-tab-claim]') : null;
  if (claim && claim.dataset && claim.dataset.tabClaim) { claimWriterTab(); return; }
  const set = e && e.target && e.target.closest ? e.target.closest('[data-stranded]') : null;
  if (set && set.dataset && set.dataset.stranded) {
    if (set.dataset.stranded === 'download') downloadStranded(); else dismissStranded();
    return;
  }
  const setupBtn = e && e.target && e.target.closest ? e.target.closest('[data-setup-quarantine]') : null;
  if (setupBtn && setupBtn.dataset && setupBtn.dataset.setupQuarantine && typeof retrySetupQuarantine === 'function') {
    if (setupBtn.dataset.setupQuarantine === 'discard') discardSetupQuarantine(); else retrySetupQuarantine();
    return;
  }
  const btn = e && e.target && e.target.closest ? e.target.closest('[data-sync-quarantine]') : null;
  if (!btn) return;
  if (btn.dataset.syncQuarantine === 'discard') discardQuarantined(); else retryQuarantined();
}

function wireSyncStatus() {
  ['gs-sync', 'sync-status-footer', 'sync-alert', 'tk-sync-alert', 'setup-sync-alert'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', onSyncStatusClick);
  });
}

// Cheap content signature of the synced state, used to skip re-rendering on
// snapshot echoes (including our own set()). JSON order is stable because the
// keys come from a fixed array.
function syncSignature() {
  return JSON.stringify(SYNC_KEYS.map((k) => state[k]));
}
// Did this phone's cache come with a server-confirmed baseline? (Decides
// seed-vs-respect-the-wipe for an empty state node, and whether a first
// snapshot can trust old unconfirmed work.)
let bootHadConfirmedBase = !!readConfirmedTree(); // let, not const: tests simulate a reload
bootSyncedTree = readConfirmedTree() || syncedSnapshot();

// A matchup "slot" — a stable key for one pairing, so a genuinely NEW matchup
// can be told apart from an undo/clear across syncs.
function matchupSlot(aId, bId) {
  if (!aId || !bId) return null;
  return { aId, bId, key: [aId, bId].sort().join('|') };
}

// The upcoming matchups of a game's bracket that are KNOWN right now: the
// current (being called up / played) matchup plus the on-deck matchup when it
// can be determined (a fixed-order Round 1). Works for both fixed-order and
// free-pick brackets — it reads the same currentMatchupOf/nextMatchupOf the
// bracket screens use, so it stays correct now that fixed-order Round 1 no
// longer sets selectedPair.
function upcomingMatchups(g) {
  if (g.format !== 'tournament') return [];
  const raw = state.brackets && state.brackets[g.id];
  if (!raw) return fourUpcoming(g);
  if (!bracketKnown(raw)) return [];
  const b = normalizeBracket(raw);
  const out = [];
  const cur = currentMatchupOf(g, b);
  if (cur) out.push(matchupSlot(cur[0], cur[1]));
  const nxt = nextMatchupOf(g, b);
  if (nxt) out.push(matchupSlot(nxt[0], nxt[1]));
  return out.filter(Boolean);
}

// The same for a four-team bracket: the match waiting for a winner, and the one after it when BOTH its teams are known (the
// second semifinal after the first, the final after the 3rd-place match; the 3rd-place match is not known while a semifinal is on).
function fourUpcoming(g) {
  const f = fourLive(g);
  if (!f) return [];
  const out = [matchupSlot(f.pair[0], f.pair[1])];
  if (f.next) out.push(matchupSlot(f.next[0], f.next[1]));
  return out.filter(Boolean);
}

// A four-team bracket's live part as plain data, for every reader that wants "who plays now and who after": { key, pair, nextKey,
// next } — `next` only when both its teams are known — or null (no bracket, one this build cannot read, one waiting on a
// re-check, one that is finished).
function fourLive(g) {
  const b = g && state.brackets4 ? state.brackets4[g.id] : null;
  const ids = teamIds();
  const cur = fourCurrent(b, ids);
  if (!cur) return null;
  const nx = fourNext(b, ids);
  return { key: cur.key, pair: [cur.a, cur.b], nextKey: nx ? nx.key : '', next: nx && nx.a && nx.b ? [nx.a, nx.b] : null };
}

// gameId -> [slot,...] snapshot of known upcoming matchups, so a genuinely NEW
// matchup can be told apart from an undo/clear across remote syncs — even for
// a bracket nobody currently has open.
let lastBracketSlots = null;

function detectMatchupChanges() {
  const prev = lastBracketSlots;
  const next = {};
  const changes = [];
  allGames().forEach((g) => {
    if (g.format !== 'tournament') return;
    const ups = upcomingMatchups(g);
    next[g.id] = ups;
    if (prev === null) return; // first time: seed, don't fire
    const prevKeys = new Set((prev[g.id] || []).map((s) => s.key));
    ups.forEach((s) => {
      if (!prevKeys.has(s.key)) changes.push({ game: g, aId: s.aId, bId: s.bId });
    });
  });
  lastBracketSlots = next;
  return changes;
}

// The soonest known matchup involving `teamId` (current preferred, then on
// deck) — used by the "Your team" summary card's "Up next" line.
function findNextMatchupFor(teamId) {
  if (!teamId) return null;
  for (const g of allGames()) {
    if (g.format !== 'tournament' || state.results[g.id]) continue;
    for (const s of upcomingMatchups(g)) {
      if (s.aId === teamId || s.bId === teamId) {
        return { game: g, opponentId: s.aId === teamId ? s.bId : s.aId };
      }
    }
  }
  return null;
}

let fbConnected = false; // live RTDB connection state (.info/connected)
let fbConnKnown = false; // first .info/connected callback received
// The Firebase SDK scripts (or the member read) failed on a device that has a
// production config — a connectivity failure, not "local dev". Declared up here
// because updateSyncIndicator reads it; set by onSdkLoadFailed (auth gate).
let sdkLoadFailed = false;

// The editor's persistent surface for refused edits: a bar pinned to the top of
// the page. The line inside the Current Standings card is closed by
// default (and off-screen), so on its own a director had no sign a score was
// unsaved once the toast faded. Editors only — nothing is parked on a view-only
// device (pushState) — and independent of the connection line below: an editor
// who is offline AND holds a refused score is told both.
function updateSyncAlert() {
  // Two copies of the one bar: the header's, and the game takeover's own strip (the
  // takeover covers the header and makes #app inert, so the header's bar can't be
  // tapped while a director is scoring, which is when a refused score needs it).
  const els = ['sync-alert', 'tk-sync-alert'].map((id) => document.getElementById(id)).filter(Boolean);
  if (!els.length) return;
  // A director's SECOND tab is view-only (tabWriter): the same strip says so and
  // offers the switch. canEdit() is false there, so nothing is ever parked and the
  // two messages can never want the strip at once.
  const viewOnlyTab = viewRole() === 'editor' && tabReadOnly();
  const stateParked = !viewOnlyTab && canEdit() && Object.keys(stateQuarantine).length > 0;
  // A refused path of the week's setup (setup-sync.js) uses the same bar when no score is parked.
  const setupParked = !viewOnlyTab && !stateParked && canEdit() && typeof setupParkedCount === 'function' && setupParkedCount() > 0;
  const parked = stateParked || setupParked;
  // Work set aside from a previous camp year (strandOldEpochWork) waits its turn:
  // this week's refused scores and the view-only tab are more urgent, and it is
  // news rather than an error, so it borrows the calm "tab" look.
  const stranded = !viewOnlyTab && !parked && strandedCount() > 0;
  const show = viewOnlyTab || parked || stranded;
  const html = show ? (viewOnlyTab ? tabBarHtml() : stateParked ? quarantineBarHtml() : setupParked ? setupQuarantineBarHtml() : strandedBarHtml()) : '';
  els.forEach((el) => {
    // Written only when it changes: a rebuilt button loses a finger mid-tap.
    if (show) setHtmlIfChanged(el, html);
    el.classList.toggle('sync-alert-tab', viewOnlyTab || stranded);
    setHiddenIfChanged(el, !show);
  });
  // The builder's own copy (the header steps aside for it): a refused save stays one red line until its Details is tapped.
  if (typeof setupUiSyncAlert === 'function') setupUiSyncAlert(show, html, viewOnlyTab || stranded);
  paintTakeoverStatus();
  document.body.classList.toggle('has-sync-alert', show); // styles.css reserves its height above the first card
}

// The takeover's status row is there only while its bar or its pill is.
function paintTakeoverStatus() {
  const box = document.getElementById('takeover-game-status');
  if (!box) return;
  const a = document.getElementById('tk-sync-alert');
  const p = document.getElementById('tk-pill');
  setHiddenIfChanged(box, !((a && !a.hidden) || (p && !p.hidden)));
}

function updateSyncIndicator() {
  updateSyncAlert();
  renderSyncPill();
  if (typeof gamesSavedRefresh === 'function') gamesSavedRefresh(); // a connection change or a refused write moves the open result's saved line
  if (typeof setupNotify === 'function') setupNotify('sync'); // the builder frame's own sync line follows the same truth
  // Two copies of the line: the one in the Games standings panel (directors)
  // and a footer one that only view-only devices WITHOUT the standings panel show
  // (styles.css, html.standings-shown), because the panel is not rendered for them
  // any more (see "Standings secrecy").
  const els = ['gs-sync', 'sync-status-footer'].map((id) => document.getElementById(id)).filter(Boolean);
  if (!els.length) return;
  const spinner = '<jelly-spinner type="dots" size="small" label="Connecting"></jelly-spinner> Connecting…';
  let text = null; // plain text, or
  let html = null; // the spinner markup
  let synced = false;
  let quarantined = false;
  if (syncDenied) {
    // A live listener was cancelled by the security rules — this device's
    // access changed mid-session. The member listener handles the kick; this
    // just keeps the indicator honest until it lands.
    text = '🔒 Sync blocked — your access changed';
  } else if (sdkLoadFailed) {
    text = '⚠️ Couldn’t connect — read-only copy';
  } else if (!syncEnabled() && !syncStarted && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && typeof firebase !== 'undefined' && firebase.auth) {
    // Sync exists but hasn't been allowed to attach yet — sign-in and the
    // membership check are still resolving in the background.
    html = spinner;
  } else if (!syncEnabled()) {
    text = '📱 This device only';
  } else if (!fbConnKnown) {
    // Startup gap before Firebase reports the connection state either way —
    // previously blank; a small jelly spinner reads as "working on it".
    html = spinner;
  } else if (!fbConnected) {
    // Ahead of the quarantine line: offline is the bigger news (new scores are
    // not uploading at all), and the top bar (updateSyncAlert) still carries
    // any refused edits.
    text = '⚠️ Offline — will sync when back';
  } else if (Object.keys(stateQuarantine).length) {
    // The rules refused some of this device's edits and sync moved on without
    // them (see "Refused writes" above). Named, with Retry / Discard, ahead of
    // "Synced" — that word would be a lie while a score is sitting unsaved.
    html = quarantineLineHtml();
    quarantined = true;
  } else {
    text = '☁️ Synced';
    synced = true;
  }
  els.forEach((el) => {
    // The quarantine line carries buttons, so it is written only when it
    // changes (a rebuilt button loses a finger mid-tap).
    if (quarantined) setHtmlIfChanged(el, html);
    else if (html !== null) el.innerHTML = html; else el.textContent = text;
    el.classList.toggle('synced', synced);
    el.classList.toggle('quarantined', quarantined);
  });
}

function renderPresence() {
  renderFooter(); // the live "who's here" count renders inside the footer line
}

function teamName(id) {
  const t = state.teams.find((t) => t.id === id);
  return t ? t.name : '???';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Write a panel's markup only when it would actually change. Every remote
// snapshot and the 30-second tick run renderAll, and re-setting identical
// innerHTML still throws the old nodes away: Jelly chips/buttons repaint
// their canvases from scratch, images re-decode (a blank flash), and a
// finger mid-press loses its button. Skips only when the markup is the same
// as last time AND nobody has changed the DOM since (a chip that toggled
// its own `selected`, an error line un-hidden) — then the panel is exactly
// what a rebuild would produce. Returns true when it wrote, so callers wire
// their listeners only onto fresh nodes.
function setHtmlIfChanged(el, html) {
  if (el.__html === html && el.__dom === el.innerHTML) return false;
  el.innerHTML = html;
  el.__html = html;
  el.__dom = el.innerHTML;
  return true;
}

// A tap on a button inside a list the screen repaints through setHtmlIfChanged replaces that very button, and focus falls
// to <body>: a keyboard, switch or screen-reader user would have to find their way back from the top after EVERY tap (a
// point key, a team chip). Ask `focusWas(btn)` BEFORE the act that repaints and `focusBack(had, fresh)` after it with the
// button that now sits where it was. A tap that never focused the button (iOS Safari, which doesn't) changes nothing.
function focusWas(el) { return !!el && typeof document !== 'undefined' && document.activeElement === el; }
function focusBack(had, el) {
  if (!had || !el || el === document.activeElement || typeof el.focus !== 'function') return;
  try { el.focus({ preventScroll: true }); } catch (e) { /* fine */ }
}

// A keyed list that GLIDES (redesign §9.5: a row removed squashes out and the rest glide up by key; a row added
// arrives). Same contract as setHtmlIfChanged — an unchanged list writes nothing — but a change to a list already on
// screen keeps its rows by data-key (JellyMotion.flipKeyed), so the survivors spring from where they were instead of
// jumping. The first paint, a new `o.view` (another day: a plain replace, the caller slides it), a page without
// Element.animate (the test harness) and calm motion are one plain write (calm: the rest jump). A change somebody
// ELSE made waits until no finger is on the screen (whenHandsOff: the row about to be tapped must not slide away);
// the person's own act glides at once (glideNow). `o.arrive(node)` runs on every row that is new. A deferred paint is
// dropped when a newer one is asked for (`__keyedWant`), so the list always ends on the latest markup.
let listGlideNow = false;
function glideNow(fn) {
  const was = listGlideNow;
  listGlideNow = true;
  try { return fn(); } finally { listGlideNow = was; }
}
function paintKeyedList(el, html, o) {
  if (!el) return false;
  o = o || {};
  const sameView = el.__keyedView === o.view;
  if (el.__html === html && el.__dom === el.innerHTML) { el.__keyedWant = html; el.__keyedView = o.view; return false; }
  el.__keyedWant = html;
  el.__keyedView = o.view;
  const canMove = typeof JellyMotion !== 'undefined' && typeof el.animate === 'function' && el.__html !== undefined && sameView;
  if (!canMove || calmMotion() || !el.children || !el.children.length) {
    // A list that was empty (or calm motion) is one write; its new rows still arrive (calm: a fade).
    const had = {};
    if (el.children) Array.prototype.forEach.call(el.children, (c) => { if (c.dataset && c.dataset.key) had[c.dataset.key] = 1; });
    setHtmlIfChanged(el, html);
    if (canMove && o.arrive) Array.prototype.forEach.call(el.children, (c) => { if (c.dataset && c.dataset.key && !had[c.dataset.key]) o.arrive(c); });
    return true;
  }
  const run = () => {
    if (el.__keyedWant !== html || (el.__html === html && el.__dom === el.innerHTML)) return;
    let added = [];
    try { added = JellyMotion.flipKeyed(el, html, 'glide') || []; } catch (e) { el.innerHTML = html; added = []; }
    el.__html = html;
    el.__dom = el.innerHTML;
    if (o.arrive) added.forEach((n) => o.arrive(n));
  };
  if (listGlideNow) run(); else JellyMotion.whenHandsOff(run);
  return true;
}
// A row leaving by the person's own tap: a small squash and a fade (§9.5 "Banner dismissed": scale(.96) + opacity;
// calm: the fade alone), then `done` (the write that removes it, run inside glideNow so the rest glide at once).
function playRowOut(row, done) {
  if (row && row.__leaving) return; // a second tap while it leaves
  if (!row || typeof JellyMotion === 'undefined') { done(); return; }
  row.__leaving = true;
  JellyMotion.playOut(row, (x) => ({ transform: 'scale(' + (1 - 0.04 * x) + ')', opacity: 1 - x }), 180, () => { row.__leaving = false; done(); });
}

// The same skip for panels that are SUPPOSED to change under their own
// markup: anything holding a game clock (the 500 ms tick rewrites its digits
// and urgency classes in place), a Big Board (goal cannons get appended to
// it), a score form (inputs, a Jelly select reflecting its pick). There
// setHtmlIfChanged's "has the DOM moved since?" check is always true, so it
// would rebuild every time. This compares the markup alone, with clock digits
// blanked out (they're the tick's job — see paintBoardClocks, and the
// Pictionary stopwatch's two readouts in tick()). Use setHtmlIfChanged for a
// panel nothing else touches; this one for anything ticking or interactive.
// `holds` lists the objects the panel's listeners close over (the game, a
// bracket): a remote snapshot swaps state objects for fresh copies, and a
// skipped rebuild would leave the old handlers writing into orphans — scores
// silently not saved. Any of them replaced means rebuild. Returns true when it
// wrote, so callers wire listeners only onto fresh nodes.
function setLiveHtmlIfChanged(el, html, holds) {
  const key = html.replace(/(data-game-clock[^>]*>)[^<]*/g, '$1')
    .replace(/(id="sw-(?:display|total)-[^"]*"[^>]*>)[^<]*/g, '$1');
  const prev = el.__liveHolds;
  if (el.__liveKey === key && prev && prev.length === holds.length &&
      holds.every((h, i) => h === prev[i])) return false;
  el.innerHTML = html;
  el.__liveKey = key;
  el.__liveHolds = holds;
  return true;
}

// ── Sound effects (Web Audio — no files needed) ──────────────────

let audioCtx = null;
let masterGain = null;

function getAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, startOffset, dur, type, peak) {
  const ac = getAudio();
  if (!ac) return;
  const t0 = ac.currentTime + startOffset;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(masterGain);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function soundOn() {
  return state.sound !== false;
}

function playAlarm() {
  if (!soundOn() || !getAudio()) return;
  cutAllSound();
  for (let i = 0; i < 8; i++) { // ~6.5 seconds of hard two-tone beeping
    tone(880, i * 0.8, 0.3, 'square', 0.8);
    tone(660, i * 0.8 + 0.38, 0.3, 'square', 0.8);
  }
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400, 200, 400]);
}

// Drop every scheduled beep by orphaning the master gain node.
function cutAllSound() {
  if (audioCtx && masterGain) {
    masterGain.disconnect();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (navigator.vibrate) navigator.vibrate(0);
}

function playHighScore() {
  if (!soundOn() || !getAudio()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.5));
  tone(1568, 0.4, 0.35, 'sine', 0.3); // sparkle on top
}

// Quiet two-note chime for a point-change alert about a team you're not following.
function playAlertChime() {
  if (!soundOn() || !getAudio()) return;
  tone(880, 0, 0.15, 'sine', 0.35);
  tone(1174.66, 0.12, 0.25, 'sine', 0.3);
}

// Brighter three-note chime for an alert about the team you're following.
function playMineChime() {
  if (!soundOn() || !getAudio()) return;
  tone(880, 0, 0.15, 'sine', 0.4);
  tone(1174.66, 0.11, 0.15, 'sine', 0.4);
  tone(1567.98, 0.22, 0.3, 'sine', 0.4);
}

// ── In-app toasts + subscribe-to-notifications ───────────────────
// No push infra: alerts only fire while the tab is alive on a device, but
// need neither billing nor a server deploy. OS notifications go through the
// notification-only service worker (sw.js — no fetch handler, see its
// header) because Android Chrome and installed-PWA iOS refuse the plain
// Notification constructor. "Mine" alerts (about the followed team) get a
// fuller toast + OS Notification (only when the tab isn't focused, so it
// isn't a redundant second alert) and a brighter chime; everyone else's
// events still show, just quieter. Announcements notify every subscribed
// phone regardless of team.

// The rail has no cap of its own and its toasts take taps (pointer-events:auto),
// so a burst — one snapshot moving several teams, a restore, a phone waking
// after a long sleep — used to stack up and cover most of a phone screen.
// Past this many, one is dismissed (its normal exit animation) to make room:
// the oldest that isn't an "Your team…" toast, so a later up-next or
// announcement toast pushes out other teams' points rather than your own.
const TOAST_MAX_VISIBLE = 3;
const liveToasts = []; // { toast, mine }

// A button inside a toast (opts.action = { label, run }): Undo after a builder
// commit, Redo after an undo. The Jelly toaster has no action slot and is vendored,
// so the button is appended to the toast it returned. Its click must not also
// dismiss through the toast's own click handler, and closes the toast itself after
// running. Plain inline styling: the toast lives in the toaster's shadow tree,
// where the page's stylesheet doesn't reach. The padding makes a 44px-tall hit area and
// the negative margin takes it back out of the layout, so the toast is no taller than
// before (a 26px Undo was a miss-tap under a thumb, and the toast covers what's below).
function addToastAction(toast, action) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toast-action';
  btn.textContent = action.label;
  btn.style.cssText = 'appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-weight:700;' +
    'text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:14px 10px;margin:-14px -4px;border-radius:8px;touch-action:manipulation';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    try { action.run(); } finally {
      const close = toast.querySelector && toast.querySelector('.close');
      if (close) close.click(); else if (toast.remove) toast.remove();
    }
  });
  // Before the ✕ when the toast has one (a direct child of the Jelly toast), else last.
  const close = toast.querySelector && toast.querySelector('.close');
  if (close && close.parentNode === toast && typeof toast.insertBefore === 'function') toast.insertBefore(btn, close);
  else toast.appendChild(btn);
}

function showToast(message, opts) {
  const mine = !!(opts && opts.mine);
  const action = opts && opts.action;
  const ms = (opts && opts.duration) || (mine ? 5500 : 4000);
  // Jelly toaster (the <jelly-toaster position="bottom"> rail in index.html).
  // Falls back to the legacy #toast-container pill if the module hasn't
  // loaded/failed — toasts carry sync errors and must always surface.
  if (window.jellyToast) {
    const toast = window.jellyToast(message, { tone: mine ? 'success' : 'info', duration: ms });
    if (toast) {
      if (action) addToastAction(toast, action);
      liveToasts.push({ toast, mine });
      for (let i = liveToasts.length - 1; i >= 0; i--) if (!liveToasts[i].toast.isConnected) liveToasts.splice(i, 1);
      while (liveToasts.length > TOAST_MAX_VISIBLE) {
        // Never the toast just raised; prefer the oldest that isn't mine.
        let at = liveToasts.slice(0, -1).findIndex((t) => !t.mine);
        if (at < 0) at = 0;
        // Dismiss through the ✕ — its handler stops propagation, so this
        // synthetic click stays inside the toaster instead of bubbling to
        // the document's delegated click handlers.
        const old = liveToasts.splice(at, 1)[0].toast;
        const close = old.querySelector && old.querySelector('.close');
        (close || old).click();
      }
    }
    return;
  }
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast' + (mine ? ' toast-mine' : '');
  el.textContent = message;
  if (action) addToastAction(el, action);
  container.appendChild(el);
  const remove = () => el.remove();
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(remove, 250);
  }, ms);
}

function maybeNativeNotification(title, body, tag) {
  if (!window.Notification || Notification.permission !== 'granted' || !document.hidden) return;
  const opts = { body, icon: 'apple-touch-icon.png', badge: 'apple-touch-icon.png', tag };
  // Phones need the service-worker path: Chrome on Android throws on the
  // `new Notification()` constructor, and iOS (installed PWA) only shows
  // notifications through a registration. Desktop falls through to the
  // constructor if the sw.js registration isn't there for some reason.
  const viaConstructor = () => { try { new Notification(title, opts); } catch (e) { /* toast already showed */ } };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.showNotification) reg.showNotification(title, opts);
        else viaConstructor();
      }).catch(viaConstructor);
      return;
    }
    viaConstructor();
  } catch (e) { /* no notification support at all — the toast already showed */ }
}

// Turn notifications on (idempotent). Must be called from a user gesture so
// the OS permission prompt + audio unlock are allowed. Caller persists.
function enableNotify() {
  getAudio(); // unlock sound from the triggering user gesture
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  state.notify = true;
  updateNotifyButton();
}

function toggleNotify() {
  if (!state.notify) {
    enableNotify();
    // Directors still hear points move; a counselor hears results (who won a
    // medal), which is all the standings secrecy lets them know.
    showToast(standingsVisible()
      ? "🔔 You'll get an alert whenever a team's points change, a team is called up next, an announcement is posted, or someone mentions you or your team in Chat — as long as this tab stays open."
      : "🔔 You'll get an alert when a game finishes, a team is called up next, an announcement is posted, or someone mentions you or your team in Chat — as long as this tab stays open.");
  } else {
    state.notify = false;
    updateNotifyButton();
  }
  saveState();
}

function updateNotifyButton() {
  const sw = document.getElementById('notify-toggle');
  if (sw) sw.toggleAttribute('checked', !!state.notify);
  paintSwitchWord('notify-toggle', !!state.notify);
  renderAlertsState();
}

// The word beside an Alerts switch (§8.5: the state is said, not left to the
// track's colour). Written only when it changes.
function paintSwitchWord(id, on) {
  const w = document.querySelector(`[data-switch-state="${id}"]`);
  const t = on ? 'On' : 'Off';
  if (w && w.textContent !== t) w.textContent = t;
}

// changes: [{ team, delta, total }]
// Toast and notification text is PLAIN text (jellyToast sets textContent,
// showNotification takes a string) — never esc() it, or a team or game named
// with an apostrophe or ampersand shows a literal "&#39;" / "&amp;".
function notifyPointChanges(changes) {
  // Directors only: a viewer's phone never hears a team's points move (see
  // "Standings secrecy"). Viewers get notifyResultChanges instead, which says
  // who won a medal and nothing about totals.
  if (!standingsVisible() || !state.notify || !changes.length) return;
  const mineChanges = [];
  const others = [];
  changes.forEach(({ team, delta, total }) => {
    const sign = delta > 0 ? '+' : '';
    const msg = `${teamEmoji(team.id)} ${team.name} ${sign}${delta} pts (now ${total})`;
    (team.id === state.followTeam ? mineChanges : others).push({ team, sign, delta, msg });
  });
  // One snapshot can move every team (a placement save, a restore, a new
  // week), and a toast apiece used to fill the screen. Everyone else's changes
  // share ONE toast; past three teams it uses their short names so it still
  // wraps to a few lines on a small phone. (showToast's visible-toast cap
  // evicts non-mine toasts first, so "Your team scored!" is never the one lost.)
  if (others.length === 1) {
    showToast(others[0].msg);
  } else if (others.length > 1) {
    const short = others.length > 3;
    showToast('📈 ' + others.map(({ team, sign, delta }) =>
      `${teamEmoji(team.id)} ${(short && teamShort(team.id)) || team.name} ${sign}${delta}`).join(' · '));
  }
  mineChanges.forEach(({ team, msg }) => {
    showToast("Your team scored! " + msg, { mine: true });
    maybeNativeNotification('🏅 Your team scored!', msg, 'camp-points-' + team.id);
  });
  if (mineChanges.length) playMineChime(); else playAlertChime();
}

// ── Result alerts (what a counselor hears instead of point changes) ──
// A viewer is told WHO won a medal in a finished game, and nothing about totals,
// places or gaps (see "Standings secrecy"). The change list comes from a diff
// of the results the phone had against the ones the snapshot brought, made in
// applyRemoteState itself: a baseline kept in a lazily-seeded module variable
// (as detectMatchupChanges used to) would swallow the first live change after a
// quiet boot. Medal winners are public by the owner's rule, so naming them here
// leaks nothing.
const MEDAL_KEYS = ['gold', 'silver', 'bronze'];

// [{ game, medals }] for every result that is new or whose winners / save stamp
// changed, in the week's game order. A cleared result is not news; a result
// whose game is gone (an import can leave one) has nothing to name.
function detectResultChanges(prev, next) {
  const was = prev || {};
  const now = next || {};
  const out = [];
  allGames().forEach((g) => {
    const r = now[g.id];
    if (!r || !r.medals) return;
    const p = was[g.id];
    const same = p && p.medals && p.savedAt === r.savedAt && MEDAL_KEYS.every((k) => p.medals[k] === r.medals[k]);
    if (!same) out.push({ game: g, medals: r.medals });
  });
  return out;
}

// changes: [{ game, medals }]. Plain text, never esc()'d (toasts set textContent).
// Directors are not sent here: they keep the point toasts (notifyPointChanges).
function notifyResultChanges(changes) {
  if (standingsVisible() || !state.notify || !changes.length) return;
  const mine = [];
  const others = [];
  changes.forEach(({ game, medals }) => {
    const place = state.followTeam ? MEDAL_KEYS.find((k) => medals[k] === state.followTeam) : null;
    if (place) mine.push({ game, place });
    else others.push({ game, medals });
  });
  // Quiet: a snapshot that finished several games shares ONE toast past two
  // (showToast's visible-toast cap would otherwise push "your team" out).
  if (others.length > 2) {
    showToast('🏅 Results are in: ' + others.map(({ game }) => game.name).join(', '));
  } else {
    others.forEach(({ game, medals }) => {
      showToast('🏅 ' + game.name + ': ' + MEDAL_KEYS.map((k) => teamName(medals[k]) + ' ' + k).join(', '));
    });
  }
  mine.forEach(({ game, place }) => {
    const msg = teamEmoji(state.followTeam) + ' ' + teamName(state.followTeam) + ' won ' + place + ' in ' + game.name + '!';
    showToast('Your team won a medal! ' + msg, { mine: true });
    maybeNativeNotification('🏅 Your team won a medal!', msg, 'camp-result-' + game.id);
  });
  if (mine.length) playMineChime(); else playAlertChime();
}

// changes: [{ game, stage, aId, bId }]
function notifyMatchupChanges(changes) {
  if (!state.notify || !changes.length) return;
  let anyMine = false;
  changes.forEach(({ game, aId, bId }) => {
    const mine = aId === state.followTeam || bId === state.followTeam;
    if (mine) anyMine = true;
    const msg = `${teamEmoji(aId)} ${teamName(aId)} vs ${teamEmoji(bId)} ${teamName(bId)} — ${game.name}`;
    showToast(mine ? "You're up next! " + msg : "Up next: " + msg, { mine });
    if (mine) maybeNativeNotification('🏅 Your team is up next!', msg, 'camp-matchup-' + game.id);
  });
  if (anyMine) playMineChime(); else playAlertChime();
}

// Dependency-free confetti burst on "it's official" moments. The winning
// team's mascot rains down among token-colored bits. Off while calm (the calm
// stand-in is joyCelebrate's gold ring).
let confettiRunning = 0; // the calm-motion sampler waits while any confetti is in the air
function celebrate(goldTeamId) {
  if (calmMotion()) return;
  confettiRunning++;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2000';
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const emoji = goldTeamId != null ? teamEmoji(goldTeamId) : '🎉';
  const colors = ['#3355ff', '#96690a', '#d63b3b', '#6b7280', '#a15c2a', '#e8c15a'];
  const parts = [];
  for (let i = 0; i < 80; i++) {
    const useEmoji = i % 4 === 0;
    parts.push({
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: H * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 8,
      g: 0.28 + Math.random() * 0.12,
      size: useEmoji ? 20 + Math.random() * 10 : 6 + Math.random() * 5,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length], emoji: useEmoji,
    });
  }
  const start = performance.now();
  const DURATION = 1600;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    parts.forEach((p) => {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / DURATION);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.emoji) {
        ctx.font = p.size + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 0, 0);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      }
      ctx.restore();
    });
    if (t < DURATION) requestAnimationFrame(frame);
    else { canvas.remove(); confettiRunning = Math.max(0, confettiRunning - 1); }
  }
  requestAnimationFrame(frame);
}

// ── Timers & stopwatches ─────────────────────────────────────────
// Stopwatch state is kept in memory so it keeps running while you browse
// other games. The countdown clock is synced (see getClock/setClock) instead
// of living here — see the "Per-game synced clock" section.

const liveWatches = {}; // gameId -> stopwatch state
let tickHandle = null;

// Keep the screen awake while a countdown or stopwatch runs (guarded — not on
// all browsers).
let wakeLockSentinel = null;
let wakeLockPending = false; // a request is in flight (don't stack a second one)
// THIS device started a timer (clock Start / Pictionary lap) and so wants the
// screen held. The browser drops a screen wake lock whenever the page is hidden
// — a quick switch to Messages or the camera — and nothing used to take it
// back, so the ref's phone then slept through the countdown. The flag lets
// rearmWakeLock() restore it on return. It must stay per-device-intent: a plain
// "re-request while any clock runs" would keep EVERY viewer's screen on for as
// long as a synced game clock ticks anywhere.
let wakeLockWanted = false;

// A synced clock that is actually counting down. `running` alone isn't enough:
// a clock whose zero was missed (everyone's phone asleep, a render that landed
// after zero) stays running:true at 0:00 until an editor device settles it, and
// must not hold the wake lock or show a Pause button meanwhile.
function clockLive(c) {
  return !!(c && c.running && clockRemaining(c) > 0);
}

function anyTimerRunning() {
  return Object.values(liveWatches).some((w) => w.running)
    || Object.values(state.clocks || {}).some(clockLive);
}

// Something wants the screen held: a timer, or the standings reveal (a director's remote is open, or a real
// reveal is live on this director's phone — reveal.js decides). Every place that used to ask only
// anyTimerRunning() before letting go of the lock asks this, so a clock ending cannot drop a reveal's lock.
function wakeLockNeeded() {
  return anyTimerRunning() || (typeof revealWakeNeeded === 'function' && revealWakeNeeded());
}

async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLockSentinel || wakeLockPending || !wakeLockNeeded()) return;
  wakeLockPending = true;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    if (!wakeLockWanted) { // released while the request was in flight
      try { sentinel.release(); } catch (e) { /* ignore */ }
      return;
    }
    wakeLockSentinel = sentinel;
    sentinel.addEventListener('release', () => {
      if (wakeLockSentinel === sentinel) { wakeLockSentinel = null; if (typeof revealOnWakeChange === 'function') revealOnWakeChange(); }
    });
    if (typeof revealOnWakeChange === 'function') revealOnWakeChange(); // the remote's "Screen stays on" line
  } catch (e) { /* user gesture / permission not available — ignore */ }
  finally { wakeLockPending = false; }
}
function requestWakeLock() {
  wakeLockWanted = true;
  return acquireWakeLock();
}
function releaseWakeLock() {
  wakeLockWanted = false;
  if (wakeLockSentinel) { try { wakeLockSentinel.release(); } catch (e) { /* ignore */ } wakeLockSentinel = null; }
}
// Back in the foreground: take the lock back only if this device wanted it and
// something is still timing; if everything finished meanwhile, stand down.
function rearmWakeLock() {
  if (!wakeLockWanted) return;
  if (wakeLockNeeded()) acquireWakeLock();
  else releaseWakeLock();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) rearmWakeLock(); });

function ensureTicking() {
  if (!tickHandle) tickHandle = setInterval(tick, 100);
}

function tick() {
  const now = Date.now();
  let anyRunning = false;
  Object.entries(liveWatches).forEach(([gid, w]) => {
    if (!w.running) return;
    anyRunning = true;
    const lapMs = now - w.startAt;
    const el = document.getElementById('sw-display-' + gid);
    if (el) el.textContent = fmtWatch(lapMs);
    const tot = document.getElementById('sw-total-' + gid);
    if (tot) tot.textContent = fmtWatch(w.lapsTotal + lapMs);
  });
  if (!anyRunning) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function fmtWatch(ms) {
  const ds = Math.floor(ms / 100);
  const s = Math.floor(ds / 10);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + '.' + (ds % 10);
}

function renderTools(wrap, g) {
  // The game clock now renders separately (everyone-facing) in #clock-area via
  // clockBlockHTML / the live tracker's Big Board — see renderGameView. Tools
  // is left for the Pictionary round runner (editor-only prompt/photo flow).
  let html = '';
  if (g.prompts) html += picRoundHTML(g);
  // Skipped when unchanged: while a lap runs, every snapshot or tick used to
  // rebuild the "Guessed it! Stop clock" button — a press straddling it was
  // lost — and the words editor's collapsed/open state reset. The handlers
  // resolve everything (round, watch, setup) when they fire and re-render
  // themselves after a change, so only the game is held.
  if (setLiveHtmlIfChanged(wrap, html, [g]) && g.prompts) bindPicRound(wrap, g);
}

// ── Game clock ticker ────────────────────────────────────────────

// Expiries this device has already handled, keyed 'gameId@endAt' (a restart
// gets a new endAt, so it gets a new key).
const clockAlarmed = new Set();
// Only buzz for an expiry this fresh. A phone that slept through the end and
// wakes 20 minutes later must still SETTLE the clock, but blasting a long-dead
// alarm into whatever is happening now helps nobody.
const CLOCK_ALARM_FRESH_MS = 5000;

// Zero handling, driven by STATE rather than by what happens to be painted:
// it used to fire only on seeing a clock element tick from >0 to 0, so a clock
// that ended while its game wasn't on screen, while the phone slept, or across
// a render that repainted it at 0 was never stopped — it sat "running" at 0:00
// for everyone, with a Pause button and the wake lock held. Editors only (a
// viewer can't write).
//
// The buzzer is not a state write, so it needs no snapshot (a ref working
// offline still gets the alarm). The STOP is a write, and must never happen
// before the first server snapshot: setClock mutates state, and a pre-snapshot
// write marks the device dirty so the first merge pushes its whole stale tree
// (the never-push-before-pull invariant). Until then the clock simply stays
// expired-but-"running" locally — clockLive already renders it as finished —
// and the first tick after the snapshot settles it.
function settleExpiredClocks() {
  if (!canEdit()) return false;
  const mayWrite = fbRef ? remoteReady : !(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);
  let changed = false;
  Object.keys(state.clocks || {}).forEach((gid) => {
    const c = state.clocks[gid];
    if (!c || !c.running || clockRemaining(c) > 0) return;
    const g = gameById(gid);
    if (!g || !g.timer) return;
    const endAt = Number(c.endAt) || 0;
    const key = gid + '@' + endAt;
    if (!clockAlarmed.has(key)) {
      clockAlarmed.add(key);
      if (serverNow() - endAt < CLOCK_ALARM_FRESH_MS) playAlarm();
    }
    if (!mayWrite) return;
    // Every device settles on 0:00; viewers only see it.
    setClock(g, (cl) => { cl.running = false; cl.remaining = 0; });
    changed = true;
  });
  return changed;
}

// Updates every visible clock (the standalone game-clock box AND the Big
// Board's clock — both carry [data-game-clock]) from the per-game synced
// clock. Runs on a cheap global interval (see init) so every device — refs
// and spectators — ticks in lockstep without any network traffic while it
// runs; the editor's device sounds the alarm and stops the clock at zero
// (settleExpiredClocks, from state — not from what is painted).
function tickBoardClocks() {
  const settled = settleExpiredClocks();
  // Nothing left running — stopped just above, or paused/expired from another
  // device: let the screen sleep again.
  if (wakeLockWanted && !wakeLockNeeded()) releaseWakeLock();
  // Not a bare renderAll: this fires on its own, and an editor typing a score
  // when the clock hits zero lost the field (and the keyboard) to it.
  if (settled) renderAllWhenIdle();
  paintBoardClocks();
}

// Paint every visible clock's digits and urgency classes from state. The
// classes exist only here — the markup builders emit just board-clock-zero —
// so renderAll calls this too, as its last step: a board it rebuilt in the
// final minute was otherwise born un-amber / un-red (no heartbeat, no glow)
// for up to half a second, until the next tick. Not tickBoardClocks itself
// from renderAll: that settles clocks (a write) and can call renderAll.
function paintBoardClocks() {
  const els = document.querySelectorAll('[data-game-clock]');
  if (!els.length) return;
  els.forEach((el) => {
    const g = gameById(el.dataset.gameId);
    if (!g || !g.timer) return;
    const clock = getClock(g);
    const rem = clockRemaining(clock);
    el.textContent = fmtBoardClock(rem);
    el.classList.toggle('board-clock-zero', rem === 0);
    // Anticipation: amber pulse inside the last minute, heartbeat + board
    // glow inside the last ten seconds (only while actually running).
    const running = !!clock.running;
    el.classList.toggle('clock-final-min', running && rem > 10000 && rem <= 60000);
    el.classList.toggle('clock-final-ten', running && rem > 0 && rem <= 10000);
    const board = el.closest('.big-board');
    if (board) board.classList.toggle('board-final-ten', running && rem > 0 && rem <= 10000);
  });
}

// ── Photo storage (IndexedDB — photos are too big for localStorage) ──

let photoDBPromise = null;
let photoDBConn = null; // the open connection photoDBPromise resolved to

// Forget a connection — and close it — but only if it is still THE cached one:
// a concurrent operation may already have reopened a fresh connection, and
// that one must survive.
function dropPhotoDB(db) {
  try { db.close(); } catch (e) { /* already closed */ }
  if (photoDBConn === db) { photoDBConn = null; photoDBPromise = null; }
}

function photoDB() {
  if (!photoDBPromise) {
    const p = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(lsKey('campScoreboardPhotos'), 1); } catch (e) { reject(e); return; } // per-camp photo store
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => {
        const db = req.result;
        photoDBConn = db;
        // The browser can close a connection under us (iOS WebKit's
        // "Connection to Indexed Database server lost", storage eviction,
        // another tab's upgrade/delete). Forget it so the next operation
        // reopens instead of failing against a dead handle for the rest of
        // the session.
        db.onclose = () => dropPhotoDB(db);
        db.onversionchange = () => dropPhotoDB(db);
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
    photoDBPromise = p;
    // Never cache a failed open — the next call should try again.
    p.catch(() => { if (photoDBPromise === p) photoDBPromise = null; });
  }
  return photoDBPromise;
}

// Resolves only once the transaction has COMMITTED. A request's onsuccess just
// means it was accepted — a quota or disk failure can still abort the
// transaction afterwards, and a photo reported "saved" that never landed is
// worse than an error. Any failure drops the connection it used and retries
// ONCE on a fresh one, which is what rescues a dead connection invisibly (the
// ops are idempotent: put/get/delete/clear).
function idbOp(mode, fn, retried) {
  let used = null;
  return photoDB().then((db) => new Promise((resolve, reject) => {
    used = db;
    const tx = db.transaction('photos', mode); // throws on a dead connection → rejects
    const req = fn(tx.objectStore('photos'));
    let result;
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || req.error || new Error('photo transaction aborted'));
  })).catch((e) => {
    if (used) dropPhotoDB(used);
    if (retried) throw e;
    return idbOp(mode, fn, true);
  });
}

const putPhoto = (key, blob) => idbOp('readwrite', (s) => s.put(blob, key));
const getPhoto = (key) => idbOp('readonly', (s) => s.get(key));
const delPhoto = (key) => idbOp('readwrite', (s) => s.delete(key));
const clearPhotos = () => idbOp('readwrite', (s) => s.clear());

function picPhotoKey(teamId, idx) {
  return 'pic:' + teamId + ':' + idx;
}

// ── Team photos (P2 §11.7): an uploaded shield or flag, one per team slot ──
// A director's upload is ONE node, <root>/teamPhotos/<tid> = { v, data }, plus the record's `photoV` (state.teams[i], set
// only after the photo landed). A device fetches a team's photo ONLY when it is about to draw that crest
// (teamPhotoNeed is called by the code that draws one: teamMarkSpec, the Your team card), one once() per photoV, and keeps
// it in memory (TEAM_PHOTO_MEM, which teamCrestSrc reads) and in this camp's IndexedDB store under
// 'team:<camp>:<tid>:<v>'. Nothing here is a listener, and nothing runs before the member check has approved the device
// (fbRef is null until then). A photo is used only when the node's `v` equals the record's `photoV`; anything else is
// somebody's newer upload still on its way, and the shipped shield (or the emoji) stays up meanwhile.
const TEAM_PHOTO_MAX = 100000; // characters of data URL: the rules' own cap (the editor aims for 70,000)
const TEAM_PHOTO_IDB_WAIT_MS = 1500; // how long the device's own copy may take before the server is asked
const teamPhotoAsked = new Set(); // '<tid>:<v>' already asked for, so a render never asks twice
function teamPhotoIdbKey(id, v) { return 'team:' + CAMP.id + ':' + id + ':' + v; }
// The data URL when it is whole and one of the two image types, else null (the same full-match check the rules make).
function teamPhotoClean(data) {
  return typeof data === 'string' && data.length <= TEAM_PHOTO_MAX ? safeCrestSrc(data) : null;
}
function teamPhotoStore(id, v, data) {
  Array.from(TEAM_PHOTO_MEM.keys()).forEach((k) => { if (k.startsWith(id + ':') && k !== id + ':' + v) TEAM_PHOTO_MEM.delete(k); }); // only the newest version is kept
  TEAM_PHOTO_MEM.set(id + ':' + v, data);
}
function teamPhotoNeed(id) {
  const v = teamPhotoVersion(id);
  if (v === null) return;
  const key = id + ':' + v;
  if (TEAM_PHOTO_MEM.has(key) || teamPhotoAsked.has(key)) return;
  if (!fbRef) return; // not approved yet (or no sync configured): a later render asks
  teamPhotoAsked.add(key);
  const arrived = () => { if (typeof renderAllWhenIdle === 'function') renderAllWhenIdle(); };
  const fromServer = () => firebase.database().ref(dbPath('teamPhotos/' + id)).once('value').then((snap) => {
    const val = snap.val();
    const data = val && typeof val === 'object' && val.v === v ? teamPhotoClean(val.data) : null;
    if (!data) return; // not there, not this version, or not a clean image: the shield / emoji stays
    teamPhotoStore(id, v, data);
    putPhoto(teamPhotoIdbKey(id, v), data).catch(() => { /* the memory copy still serves this session */ });
    arrived();
  });
  // A failing IndexedDB (private mode, a dead connection) is just a miss, and so is one that never answers (an open
  // that stays blocked would otherwise keep the server read from ever being made).
  const local = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), TEAM_PHOTO_IDB_WAIT_MS);
    getPhoto(teamPhotoIdbKey(id, v)).catch(() => null).then((x) => { clearTimeout(timer); resolve(x); });
  });
  local
    .then((cached) => {
      const data = teamPhotoClean(cached);
      if (data) { teamPhotoStore(id, v, data); arrived(); return null; }
      return fromServer();
    })
    .catch((e) => {
      // A refused read (rules not published for this node) is final for this version; a dropped connection can be asked again.
      if (!(e && e.code === 'PERMISSION_DENIED')) teamPhotoAsked.delete(key);
    });
}

function loadImage(blob) {
  if (window.createImageBitmap) {
    return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => loadImageViaTag(blob));
  }
  return loadImageViaTag(blob);
}

function loadImageViaTag(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Downscale camera shots so 60 photos don't blow up the phone's storage.
async function shrinkPhoto(file) {
  const img = await loadImage(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return canvasToJpeg(c, 0.85);
}

// ── Pictionary round runner ─────────────────────────────────────

function picRounds() {
  if (!state.picRounds) state.picRounds = {};
  return state.picRounds;
}

function picRound(teamId) {
  const all = picRounds();
  if (!all[teamId]) all[teamId] = { laps: [], done: false };
  return normalizePicRound(all[teamId]);
}

function picLapsSum(round) {
  return round ? round.laps.reduce((a, l) => a + l.ms, 0) : 0;
}

// Pictionary item source, chosen by the ref before the first team runs:
// 'pregenerated' (the built-in word list), 'own' (ref's own words), or
// 'numbered' (just "Item N", no words). Synced so every ref device agrees.
function picSetupFor(gid) {
  if (!state.picSetup) state.picSetup = {};
  return state.picSetup[gid] || null;
}

// The label to show/caption for drawing item i. Words are only ever shown in
// the ref tools (canEdit) — never to viewers — and in 'numbered' mode there is
// no secret word at all.
function promptLabel(g, i) {
  const s = picSetupFor(g.id);
  const src = s && s.source;
  if (src === 'numbered') return `Item ${i + 1}`;
  if (src === 'own') {
    const w = s.words && s.words[i];
    return (w && String(w).trim()) ? String(w).trim() : `Item ${i + 1}`;
  }
  return (g.prompts && g.prompts[i]) || `Item ${i + 1}`; // pregenerated default
}

function picRoundHTML(g) {
  let w = liveWatches[g.id];
  if (!w) w = liveWatches[g.id] = { running: false, startAt: 0, lapsTotal: 0 };
  const teamId = state.ui.picTeam;
  const round = teamId ? picRound(teamId) : null;
  // Always derive the total from the saved laps — the in-memory copy dies
  // on reload, and a stale 0 here would fill a short total into the score.
  w.lapsTotal = picLapsSum(round);

  const setup = picSetupFor(g.id);
  const anyLaps = state.teams.some((t) => { const r = picRounds()[t.id]; return r && r.laps && r.laps.length; });

  // Ask the ref how the items should be shown, before the first team runs.
  if (!setup) {
    return `<div class="tool-box" data-tool="pic-round">
      <div class="tool-label">🎨 Drawing round</div>
      <div class="pic-setup">
        <p class="pic-setup-q">How should the ${g.prompts.length} drawing items be shown to the ref?</p>
        <div class="pic-setup-opts">
          <jelly-button class="secondary-btn" variant="platinum" block data-pic-source="pregenerated">🎃 Use the built-in list</jelly-button>
          <jelly-button class="secondary-btn" variant="platinum" block data-pic-source="own">✏️ Enter our own</jelly-button>
          <jelly-button class="secondary-btn" variant="platinum" block data-pic-source="numbered">🔢 Just numbered items</jelly-button>
        </div>
        <p class="muted pic-setup-hint">Viewers never see the words either way — only the live times. This locks once a team has started.</p>
      </div>
    </div>`;
  }

  const modeLabel = { pregenerated: 'Built-in list', own: 'Your own items', numbered: 'Numbered items' }[setup.source] || '';
  const modeStrip = `<div class="pic-mode-strip">Items: <strong>${esc(modeLabel)}</strong>${anyLaps ? '' : ' · <button class="link-btn" data-pic-source="reset">change</button>'}</div>`;

  const wordsEditor = setup.source === 'own' ? `
    <details class="pic-words-editor" ${anyLaps ? '' : 'open'}>
      <summary>✏️ Your ${g.prompts.length} items${anyLaps ? '' : ' — type them in'}</summary>
      <div class="pic-words-grid">
        ${Array.from({ length: g.prompts.length }, (_, i) => `
          <label class="pic-word-row"><span class="pic-word-num">${i + 1}.</span>
            <input type="text" data-pic-word="${i}" value="${esc((setup.words && setup.words[i]) || '')}" placeholder="Item ${i + 1}" ${anyLaps ? 'disabled' : ''} />
          </label>`).join('')}
      </div>
    </details>` : '';

  const chips = `<div class="pic-team-chips">${state.teams.map((t) => {
    const r = picRounds()[t.id];
    const status = r && r.done ? ' ✓' : r && r.laps.length ? ` ${r.laps.length}/10` : '';
    return `<button class="team-chip pic-team-chip ${teamId === t.id ? 'selected' : ''}" data-team-id="${esc(t.id)}" ${w.running ? 'disabled' : ''}>${esc(t.name)}${status}<span class="chip-sub">${esc(counselorName(t.id))}</span></button>`;
  }).join('')}</div>`;

  let panel = '';
  if (round) {
    const n = round.laps.length;
    if (!round.done) {
      const prompt = promptLabel(g, n);
      const hasWord = prompt !== `Item ${n + 1}`; // numbered / blank-own has no secret word
      panel = `
        <div class="pic-prompt-card">
          <div class="pic-prompt-label">Item ${n + 1} of ${g.prompts.length}</div>
          ${hasWord ? `<div class="pic-prompt-word">${esc(prompt)}</div>` : ''}
        </div>
        <div class="big-clock" id="sw-display-${esc(g.id)}">${fmtWatch(w.running ? Date.now() - w.startAt : 0)}</div>
        <div class="sw-total-line">Team total: <strong id="sw-total-${g.id}">${fmtWatch(w.lapsTotal + (w.running ? Date.now() - w.startAt : 0))}</strong></div>
        <div class="timer-btn-row">
          ${w.running
            ? `<jelly-button class="timer-main-btn stop-lap-btn" variant="amber" block data-action="stop-lap">⏹ Guessed it! Stop clock</jelly-button>`
            : `<jelly-button class="timer-main-btn" block data-action="start-lap">▶ Nose down — start</jelly-button>`}
        </div>`;
    } else {
      const photoCount = round.laps.filter((l) => l.photo).length;
      panel = `
        <div class="pic-done-banner">🎉 Round complete — total <strong>${fmtWatch(round.laps.reduce((a, l) => a + l.ms, 0))}</strong>. Score filled in below.</div>
        <div class="timer-btn-row">
          <jelly-button class="timer-main-btn" variant="platinum" block data-action="export-photos">⬇ Export ${photoCount} captioned photo${photoCount === 1 ? '' : 's'}</jelly-button>
        </div>
        <p class="muted pic-export-hint" id="pic-export-status">Each photo gets a harvest banner with the team, the prompt, and their time. Photos live on the phone that took them.</p>`;
    }

    if (round.laps.length) {
      panel += `<div class="pic-items">${round.laps.map((lap, i) => {
        const lbl = promptLabel(g, i);
        const text = lbl === `Item ${i + 1}` ? lbl : `${i + 1}. ${lbl}`;
        return `
        <div class="pic-item-row">
          <span class="pic-item-text">${esc(text)} — ${fmtWatch(lap.ms)}</span>
          <button class="pic-photo-btn ${lap.photo ? 'has-photo' : ''}" data-action="photo" data-lap="${i}">${lap.photo ? '📷 Retake' : '📷 Add photo'}</button>
        </div>`;
      }).join('')}</div>
        <div class="sw-actions">
          ${!round.done ? `<button class="link-btn" data-action="undo-lap">Undo last item</button>` : ''}
          <button class="link-btn danger-link" data-action="reset-round">Reset this team's round</button>
        </div>`;
    }
  } else {
    panel = `<p class="muted">Pick a team to run their 10 drawings.</p>`;
  }

  return `<div class="tool-box" data-tool="pic-round">
    <div class="tool-label">🎨 Drawing round</div>
    ${modeStrip}
    ${wordsEditor}
    ${chips}
    ${panel}
  </div>
  <input type="file" id="pic-photo-input" accept="image/*" capture="environment" hidden>`;
}

function bindPicRound(wrap, g) {
  const box = wrap.querySelector('[data-tool="pic-round"]');
  if (!box) return;
  const w = liveWatches[g.id];
  const photoInput = wrap.querySelector('#pic-photo-input');

  box.querySelectorAll('.pic-team-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (w.running) return;
      state.ui.picTeam = chip.dataset.teamId;
      const r = picRound(chip.dataset.teamId);
      w.lapsTotal = r.laps.reduce((a, l) => a + l.ms, 0);
      saveState();
      renderTools(wrap, g);
    });
  });

  // Item-source chooser (asked before the first team) + custom-word entry.
  box.querySelectorAll('[data-pic-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.picSource;
      if (!state.picSetup) state.picSetup = {};
      if (src === 'reset') {
        delete state.picSetup[g.id];
      } else {
        const prev = state.picSetup[g.id] || {};
        state.picSetup[g.id] = { source: src, words: Array.isArray(prev.words) ? prev.words : [] };
      }
      saveState();
      renderTools(wrap, g);
    });
  });

  box.querySelectorAll('input[data-pic-word]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const s = state.picSetup && state.picSetup[g.id];
      if (!s) return;
      if (!Array.isArray(s.words)) s.words = [];
      s.words[parseInt(inp.dataset.picWord, 10)] = inp.value;
      saveState(); // no full re-render — keep input focus while typing
    });
  });

  box.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      const teamId = state.ui.picTeam;
      const round = teamId ? picRound(teamId) : null;

      if (a === 'start-lap') {
        getAudio();
        w.startAt = Date.now();
        w.running = true;
        ensureTicking();
        requestWakeLock(); // a lap is a timer too — the screen must not sleep mid-lap
      } else if (a === 'stop-lap') {
        const ms = Date.now() - w.startAt;
        w.running = false;
        if (!wakeLockNeeded()) releaseWakeLock();
        round.laps.push({ ms, photo: false });
        w.lapsTotal = picLapsSum(round);
        touchData();
        if (round.laps.length >= g.prompts.length) {
          round.done = true;
          const draft = state.drafts[g.id] || (state.drafts[g.id] = { scores: {}, medals: {} });
          const prevLeader = leaderOf(g, draft);
          // Total comes straight from the saved laps, floored to the same
          // decisecond the display shows, so the filled score matches it.
          const totalDs = Math.floor(picLapsSum(round) / 100);
          const m = Math.floor(totalDs / 600);
          const s = (totalDs - m * 600) / 10;
          draft.scores[teamId] = m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
          draft.medals = {};
          saveState();
          checkHighScore(g, draft, teamId, prevLeader);
          renderAll();
          return;
        }
        saveState();
      } else if (a === 'undo-lap') {
        const last = round.laps.pop();
        if (last) {
          delPhoto(picPhotoKey(teamId, round.laps.length)).catch(() => {});
        }
        round.done = false;
        w.lapsTotal = picLapsSum(round);
        saveState();
      } else if (a === 'reset-round') {
        if (!confirm("Reset this team's round? All their times and photos for this game are cleared.")) return;
        round.laps.forEach((_, i) => delPhoto(picPhotoKey(teamId, i)).catch(() => {}));
        round.laps = [];
        round.done = false;
        w.lapsTotal = 0;
        w.running = false;
        if (!wakeLockNeeded()) releaseWakeLock();
        saveState();
      } else if (a === 'photo') {
        photoInput.dataset.teamId = teamId;
        photoInput.dataset.lap = btn.dataset.lap;
        photoInput.click();
        return;
      } else if (a === 'export-photos') {
        exportTeamPhotos(g, teamId, btn);
        return;
      }
      renderTools(wrap, g);
    });
  });

  // The item-source chooser view has no photo input (no team is running yet).
  if (photoInput) {
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      const teamId = photoInput.dataset.teamId;
      const lapIdx = parseInt(photoInput.dataset.lap, 10);
      try {
        const blob = await shrinkPhoto(file);
        await putPhoto(picPhotoKey(teamId, lapIdx), blob);
        picRound(teamId).laps[lapIdx].photo = true;
        saveState();
        renderTools(wrap, g);
      } catch (e) {
        alert('Could not save that photo — try again.');
        console.error(e);
      }
    });
  }
}

// ── Captioned photo export ──

function drawBannerLeaf(x, cx, cy, size, rot, color) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.fillStyle = color;
  x.beginPath();
  x.moveTo(0, -size / 2);
  x.quadraticCurveTo(size * 0.45, -size * 0.1, 0, size / 2);
  x.quadraticCurveTo(-size * 0.45, -size * 0.1, 0, -size / 2);
  x.fill();
  x.strokeStyle = 'rgba(252, 245, 228, 0.65)';
  x.lineWidth = Math.max(1, size * 0.05);
  x.beginPath();
  x.moveTo(0, -size * 0.36);
  x.lineTo(0, size * 0.36);
  x.stroke();
  x.restore();
}

function fitFont(x, text, weightStyle, px, maxWidth, family) {
  let size = px;
  do {
    x.font = `${weightStyle} ${Math.round(size)}px ${family}`;
    if (x.measureText(text).width <= maxWidth) break;
    size *= 0.94;
  } while (size > 10);
  return size;
}

async function composeCaptioned(photoBlob, teamStr, promptStr, ms) {
  const img = await loadImage(photoBlob);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const bannerH = Math.max(130, Math.round(w * 0.17));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + bannerH;
  const x = c.getContext('2d');
  const serif = `Georgia, 'Times New Roman', serif`;

  // Parchment banner
  const grad = x.createLinearGradient(0, 0, 0, bannerH);
  grad.addColorStop(0, '#f9f0da');
  grad.addColorStop(1, '#eeddb8');
  x.fillStyle = grad;
  x.fillRect(0, 0, w, bannerH);

  // Double rule above the photo
  x.strokeStyle = '#b3591c';
  x.lineWidth = Math.max(3, w * 0.005);
  x.beginPath();
  x.moveTo(w * 0.03, bannerH - x.lineWidth * 3);
  x.lineTo(w * 0.97, bannerH - x.lineWidth * 3);
  x.stroke();
  x.strokeStyle = '#6d3a10';
  x.lineWidth = Math.max(1.5, w * 0.002);
  x.beginPath();
  x.moveTo(w * 0.03, bannerH - w * 0.013);
  x.lineTo(w * 0.97, bannerH - w * 0.013);
  x.stroke();

  // Corner leaves
  drawBannerLeaf(x, w * 0.065, bannerH * 0.42, bannerH * 0.34, -0.55, '#c96f1e');
  drawBannerLeaf(x, w * 0.045, bannerH * 0.6, bannerH * 0.24, 0.5, '#8a5a12');
  drawBannerLeaf(x, w * 0.935, bannerH * 0.42, bannerH * 0.34, 0.55, '#c96f1e');
  drawBannerLeaf(x, w * 0.955, bannerH * 0.6, bannerH * 0.24, -0.5, '#8a5a12');

  // Text
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const maxText = w * 0.72;

  x.fillStyle = '#4a2c10';
  fitFont(x, teamStr, '700', bannerH * 0.3, maxText, serif);
  x.fillText(teamStr, w / 2, bannerH * 0.33);

  const sub = `drew “${promptStr}” in ${fmtWatch(ms)}`;
  x.fillStyle = '#9c4f0f';
  fitFont(x, sub, 'italic 400', bannerH * 0.18, maxText, serif);
  x.fillText(sub, w / 2, bannerH * 0.64);

  x.drawImage(img, 0, bannerH);
  return canvasToJpeg(c, 0.9);
}

function safeFileName(str) {
  return str.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportTeamPhotos(g, teamId, btn) {
  const round = picRound(teamId);
  const team = teamName(teamId);
  const status = document.getElementById('pic-export-status');
  const say = (msg) => { if (status) status.textContent = msg; };

  btn.setAttribute('disabled', '');
  try {
    const files = [];
    for (let i = 0; i < round.laps.length; i++) {
      if (!round.laps[i].photo) continue;
      say(`Building photo ${files.length + 1}…`);
      const blob = await getPhoto(picPhotoKey(teamId, i));
      if (!blob) continue;
      const out = await composeCaptioned(blob, team, promptLabel(g, i), round.laps[i].ms);
      files.push(new File([out], `${safeFileName(team)}-${safeFileName(promptLabel(g, i))}.jpg`, { type: 'image/jpeg' }));
    }
    if (!files.length) {
      say('No photos taken for this team yet — use the Add photo buttons first.');
      return;
    }
    if (navigator.canShare && navigator.canShare({ files })) {
      say(`Sharing ${files.length} photos…`);
      await navigator.share({ files, title: team + ' — Pumpkin Pictionary' }).catch(() => {});
      say(`Shared ${files.length} captioned photos.`);
    } else {
      say(`Downloading ${files.length} photos…`);
      files.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 500));
      say(`Downloaded ${files.length} captioned photos.`);
    }
  } catch (e) {
    console.error(e);
    say('Export hit a snag — try again.');
  } finally {
    btn.removeAttribute('disabled');
  }
}

// ── Copy / share helpers ─────────────────────────────────────────

function copyTextToClipboard(text, btn) {
  const done = () => {
    if (typeof btn === 'function') { btn(); return; } // a caller that says "Copied" its own way
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.setAttribute('disabled', '');
    setTimeout(() => { btn.textContent = orig; btn.removeAttribute('disabled'); }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
  } else {
    legacyCopy(text, done);
  }
}

function legacyCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
  ta.remove();
  done();
}

function matchupText(g, stage, aId, bId) {
  const withC = (id) => counselorName(id) ? `${teamName(id)} (${counselorName(id)})` : teamName(id);
  return `${g.name} ${stage}: ${withC(aId)} vs ${withC(bId)} — head to ${g.location}!`;
}

// A team's mark where a bracket shows a match (the call-up, the live board, the own-team note): the flag with its shape, or the
// emoji tile, from teamMarkHtml (§8.4: colour alone — senior's 🔴 🔵 🟢 🟡 circles — fails red vs gold under deuteranopia). A
// team whose mark is an IMAGE (junior's shields) keeps its emoji here: the six-team wizard rebuilds these views on every render,
// and an <img> re-created twice a minute blinks. Its emoji is a mascot with a shape of its own, never a bare colour.
function bracketMarkHtml(id, size) {
  return teamMarkSpec(id).kind === 'shield' ? `<span class="bk-emoji" aria-hidden="true">${teamEmoji(id)}</span>` : teamMarkHtml(id, { size });
}

function matchupCalloutHTML(aId, bId) {
  const counselors = [counselorName(aId), counselorName(bId)].filter(Boolean);
  return `<div class="matchup-callout">
    <p class="call-next-label">Call up next</p>
    <div class="matchup-mascots" aria-hidden="true">
      <span class="matchup-mascot">${bracketMarkHtml(aId, 52)}</span>
      <span class="matchup-vs-emoji">vs</span>
      <span class="matchup-mascot">${bracketMarkHtml(bId, 52)}</span>
    </div>
    <p class="call-next-teams">${esc(teamName(aId))} <span class="vs">vs</span> ${esc(teamName(bId))}</p>
    ${counselors.length === 2 ? `<p class="call-next-counselors">Counselors: ${esc(counselors[0])} &amp; ${esc(counselors[1])}</p>` : ''}
    ${blockedByOwnTeam(aId, bId) ? '' : `<div class="winner-btn-row">
      <jelly-button class="winner-btn" variant="azure" block data-winner="${aId}">${esc(teamName(aId))} won</jelly-button>
      <jelly-button class="winner-btn" variant="azure" block data-winner="${bId}">${esc(teamName(bId))} won</jelly-button>
    </div>`}
    <jelly-button class="copy-matchup-btn" variant="platinum" block><svg class="ico" aria-hidden="true"><use href="#i-copy"/></svg>Copy matchup for text</jelly-button>
  </div>`;
}

function bindMatchupCopy(body, g, stage, aId, bId) {
  const btn = body.querySelector('.copy-matchup-btn');
  if (btn) btn.addEventListener('click', () => copyTextToClipboard(matchupText(g, stage, aId, bId), btn));
}

function standingsSummaryText() {
  const campDate = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
  const lines = ['🏅 Camp — ' + campDate];
  // Points and places are directors' eyes only (see "Standings secrecy"): the
  // table is built only for them, so a viewer who reaches Copy / Share — the
  // card is hidden for them, but this is gated in code, not CSS — gets just the
  // game winners below.
  if (standingsVisible()) {
    const counts = medalCounts();
    const ranked = rankTeamsByPoints(counts);
    lines.push('');
    lines.push(`Standings (🥇 ${MEDAL_POINTS.gold} · 🥈 ${MEDAL_POINTS.silver} · 🥉 ${MEDAL_POINTS.bronze} pts):`);
    ranked.forEach((t, i) => {
      const s = counts[t.id];
      const parts = [`🥇${s.gold} 🥈${s.silver} 🥉${s.bronze}`];
      if (s.verse) parts.push(`📖${s.verse > 0 ? '+' : ''}${s.verse}`);
      if (s.meals) parts.push(`🧽${s.meals > 0 ? '+' : ''}${s.meals}`);
      if (s.custom) parts.push(`✨${s.custom > 0 ? '+' : ''}${s.custom}`);
      lines.push(`${i + 1}) ${teamEmoji(t.id)} ${t.name} · ${s.points} pts (${parts.join(' ')})`);
    });
  }

  const played = allGames().filter((g) => state.results[g.id]);
  if (played.length) {
    lines.push('');
    lines.push('Medals so far:');
    played.forEach((g) => {
      const m = state.results[g.id].medals;
      lines.push(`• ${g.name} — 🥇 ${teamName(m.gold)}, 🥈 ${teamName(m.silver)}, 🥉 ${teamName(m.bronze)}`);
    });
  } else {
    lines.push('');
    lines.push('No games saved yet.');
  }
  return lines.join('\n');
}

// ── High-score chime ──

function leaderOf(g, draft) {
  const ranked = autoRank(g, draft);
  return ranked.length ? ranked[0] : null;
}

function checkHighScore(g, draft, teamId, prevLeader) {
  const newLeader = leaderOf(g, draft);
  if (!newLeader || newLeader.id !== teamId) return;
  if (prevLeader && prevLeader.id !== teamId &&
      (g.lowerWins ? newLeader.v < prevLeader.v : newLeader.v > prevLeader.v)) {
    playHighScore();
  }
}

// ── Time helpers (Pumpkin Pictionary) ────────────────────────────

function parseScoreInput(game, raw) {
  const str = String(raw).trim();
  if (!str) return null;
  if (game.timeInput && str.includes(':')) {
    const [m, s] = str.split(':');
    const mm = parseInt(m, 10);
    const ss = parseFloat(s);
    if (isNaN(mm) || isNaN(ss) || ss >= 60 || mm < 0 || ss < 0) return null;
    return mm * 60 + ss;
  }
  const v = parseFloat(str);
  // Scores/times are never negative — except a counter game that opts in
  // (Counselor Hide and Seek's −1). Rejecting there made the counter read −1
  // back as 0, left the team off the live board and the medal auto-fill, and
  // dropped the score from the saved result.
  if (isNaN(v) || (v < 0 && !game.counterAllowNegative)) return null;
  return v;
}

function formatScore(game, val) {
  if (game.timeInput) {
    let m = Math.floor(val / 60);
    let s = Math.round((val - m * 60) * 10) / 10;
    if (s >= 60) { m += 1; s -= 60; } // rounding can carry (e.g. 119.97s → 2:00, not 1:60)
    return m + ':' + (s < 10 ? '0' : '') + (Number.isInteger(s) ? s : s.toFixed(1));
  }
  return String(val);
}

// ── Standings (derived from saved results) ───────────────────────

// Extra points per team from the bonus ledger, split by source. Bible
// memorization ('verse') and meal cleanup ('cleanup') each get their own
// standings column, so they're totaled separately rather than lumped into a
// single "bonus" figure; any free-form entry falls in 'custom'.
function bonusBreakdown() {
  const totals = {};
  state.teams.forEach((t) => (totals[t.id] = { verse: 0, meals: 0, custom: 0 }));
  if (!pointsReadAllowed('bonusBreakdown')) return totals; // a viewer gets zeros, never the ledger
  Object.values(state.bonuses || {}).forEach((b) => {
    if (!b || !totals[b.teamId]) return;
    const p = Number(b.points);
    if (isNaN(p)) return;
    const bucket = b.category === 'verse' ? 'verse'
      : b.category === 'cleanup' ? 'meals'
      : 'custom';
    // Thu-evening/Friday double-points window (cleanup exempt) — see
    // bonusCountsDouble. The ledger keeps the raw value; the ×2 chip in
    // renderBonuses explains the difference.
    totals[b.teamId][bucket] += p * (bonusCountsDouble(b) ? 2 : 1);
  });
  return totals;
}

function medalCounts() {
  const counts = {};
  state.teams.forEach((t) => (counts[t.id] = { gold: 0, silver: 0, bronze: 0, medalPts: 0, verse: 0, meals: 0, custom: 0, bonus: 0, points: 0 }));
  // A viewer gets the all-zero table: the winners of each game are read from
  // state.results directly (they stay visible), never from these totals.
  if (!pointsReadAllowed('medalCounts')) return counts;
  const extra = bonusBreakdown();
  // Iterate entries so we can weight points per game: Messtival games are
  // worth DOUBLE on the scoreboard. Medal *counts* stay raw; only the point
  // value doubles. Results for games no longer in the (editable) catalog are
  // skipped — deleting a game removes its result, but an import/restore can
  // still leave an orphan behind, and a phantom medal with no game to clear
  // it from would corrupt the standings forever.
  Object.entries(state.results).forEach(([id, r]) => {
    if (!r || !r.medals) return;
    const g = gameById(id);
    if (!g) return;
    const mult = g.messtival ? 2 : 1;
    if (counts[r.medals.gold]) { counts[r.medals.gold].gold += 1; counts[r.medals.gold].medalPts += MEDAL_POINTS.gold * mult; }
    if (counts[r.medals.silver]) { counts[r.medals.silver].silver += 1; counts[r.medals.silver].medalPts += MEDAL_POINTS.silver * mult; }
    if (counts[r.medals.bronze]) { counts[r.medals.bronze].bronze += 1; counts[r.medals.bronze].medalPts += MEDAL_POINTS.bronze * mult; }
  });
  state.teams.forEach((t) => {
    const c = counts[t.id];
    const e = extra[t.id] || { verse: 0, meals: 0, custom: 0 };
    c.verse = e.verse;
    c.meals = e.meals;
    c.custom = e.custom;
    c.bonus = e.verse + e.meals + e.custom; // all extras, for the grand total
    c.points = c.medalPts + c.bonus; // grand total drives the leaderboard
  });
  return counts;
}

// Rank by total points; break point ties by finish quality (golds,
// then silvers, then bronzes).
function rankTeamsByPoints(counts) {
  // A viewer gets the roster in its own fixed order, never an order that says who leads.
  if (!pointsReadAllowed('rankTeamsByPoints')) return [...state.teams];
  return [...state.teams].sort((a, b) => {
    const sa = counts[a.id], sb = counts[b.id];
    if (sb.points !== sa.points) return sb.points - sa.points;
    if (sb.gold !== sa.gold) return sb.gold - sa.gold;
    if (sb.silver !== sa.silver) return sb.silver - sa.silver;
    return sb.bronze - sa.bronze;
  });
}

let lastPointsByTeam = null; // for the point alerts (a change that arrived from another phone)
let remoteJustApplied = false;

// ── Rank-change arrows (vs the start of the camp day) ─────────────
// Each device snapshots the standings the first time it renders on a new camp date, then the Games tab shows an arrow per team
// against that baseline. Deliberately device-local (NOT synced): every phone keeps its own morning baseline.
const DAY_RANK_KEY = lsKey('campScoreboardDayRanks');

// The name groupPlaces breaks a COMPLETE tie by (same points, same medals), the way the reveal's freeze words it: control characters
// gone, cut to 30, "Team N" for none. The Games tab, its arrows' baseline and the reveal's freeze all use this one, so a team name
// over 30 characters or with an odd character in it can't be ordered one way on a director's phone and another on the big screen.
function standingsTieName(t) {
  const clean = revealCleanName(t.name);
  return clean || ('Team ' + (state.teams.findIndex((x) => x.id === t.id) + 1));
}

// Whether the standings the baseline would be taken from can be trusted yet. With sync attached the week on this phone is a cache
// until the first server snapshot lands (a phone opened that morning with an empty or yesterday's cache would take a flat or old
// baseline and keep it all day), so the baseline waits for the snapshot; the render the snapshot triggers takes it. With no sync at
// all (local-only, or the SDK never loaded) the local copy IS the week. Same test as settleExpiredClocks'.
function dayBaselineReady() {
  if (fbRef) return remoteReady;
  return sdkLoadFailed || !(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);
}

// The day's baseline as SHARED PLACES (reveal-core's groupPlaces: equal points share one), for the Games standings' arrows.
// `flat` is a baseline taken while nobody had a point: every team was level, so "moved since this morning" would say nothing
// and the arrows stay off for the rest of that day. A record from an older build (positions, no `places`) is taken afresh.
// Null for a phone that may not read points.
function startOfDayPlaces() {
  if (!pointsReadAllowed('startOfDayPlaces')) return null;
  const today = campDateStr();
  let snap = null;
  try {
    snap = JSON.parse(localStorage.getItem(DAY_RANK_KEY) || 'null');
  } catch (e) { /* corrupt — re-snapshot below */ }
  if (!snap || snap.date !== today || !snap.places) {
    if (!dayBaselineReady()) return null; // no arrows until the first snapshot has said what this morning's places were
    const counts = medalCounts();
    const ranked = rankTeamsByPoints(counts);
    const groups = groupPlaces(ranked.map((t) => ({ id: t.id, nm: standingsTieName(t), p: counts[t.id].points, g: counts[t.id].gold, s: counts[t.id].silver, b: counts[t.id].bronze })));
    const places = {};
    groups.forEach((gr) => gr.entries.forEach((e) => { places[e.id] = gr.place; }));
    snap = { date: today, places, flat: ranked.every((t) => counts[t.id].points === 0) };
    try { localStorage.setItem(DAY_RANK_KEY, JSON.stringify(snap)); } catch (e) { /* fine */ }
  }
  return { places: snap.places, flat: !!snap.flat };
}

// Everything the standings DO besides being drawn — for every render pass, whatever tab is showing (§13.9: the Games panel that
// draws them paints only while it is on screen, so these could not live in it). Directors only: the start-of-day place baseline
// (the Games arrows' "since this morning"), the point alerts for a change that arrived from another phone, and the change
// history. No DOM. A phone that may not read points computes nothing about them and forgets what it had (a demoted editor's
// next render drops the baseline of the pulse and the history with it).
function runStandingsSideEffects() {
  if (!standingsVisible()) {
    lastPointsByTeam = null;
    clPrevSnap = null;
    remoteJustApplied = false;
    // The standings panel renders only while Games is showing, so a role flip seen from another tab must still empty it.
    if (typeof gamesClearStandings === 'function') gamesClearStandings();
    return;
  }
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);
  // A change that came from ANOTHER phone (a remote sync, not this director's own edit — those already get direct feedback).
  // Skip the very first pass (nothing to compare with).
  const remoteOrigin = remoteJustApplied; // capture before reset — drives change-history logging
  const fromRemote = remoteOrigin && lastPointsByTeam !== null;
  remoteJustApplied = false;
  const changedTeams = []; // {team, delta, total} — for the notify option
  startOfDayPlaces(); // takes the day's baseline the first time a director's phone renders on a new camp date
  ranked.forEach((team) => {
    if (fromRemote && lastPointsByTeam[team.id] !== undefined && lastPointsByTeam[team.id] !== counts[team.id].points) {
      changedTeams.push({ team, delta: counts[team.id].points - lastPointsByTeam[team.id], total: counts[team.id].points });
    }
  });
  lastPointsByTeam = {};
  ranked.forEach((team) => { lastPointsByTeam[team.id] = counts[team.id].points; });
  if (changedTeams.length) notifyPointChanges(changedTeams);
  // Append any local point-total changes to the change-history log. Best-effort:
  // wrapped so a logging failure can never break the standings render.
  try { recordPointHistory(counts, remoteOrigin); } catch (e) { /* never break rendering */ }
}

// ── Change history (append-only log at a SEPARATE Firebase path) ──────────────
// A timestamped record of every point-total change, written to
// campScoreboard/changelog — NOT campScoreboard/state, so it never touches the
// synced scoreboard and can't interfere with the merge/push logic. Only the
// editor device that originates a change logs it (remote merges are skipped —
// the originating device already logged), so there are no duplicates. Writes
// are append-only (push()), so there's no read-modify-write to clobber. Every
// path guards on fbRef and is wrapped in try/catch, so with sync off or on an
// error this is a silent no-op.
let clPrevSnap = null; // last-seen { points, results, bonuses } for diffing

function snapshotForLog(counts) {
  if (!pointsReadAllowed('snapshotForLog')) return { points: {}, results: {}, bonuses: {} };
  const points = {};
  (state.teams || []).forEach((t) => { points[t.id] = counts[t.id] ? counts[t.id].points : 0; });
  const results = {};
  Object.keys(state.results || {}).forEach((gid) => {
    const r = state.results[gid];
    if (r) results[gid] = r.savedAt || '1';
  });
  const bonuses = {};
  Object.keys(state.bonuses || {}).forEach((id) => {
    const b = state.bonuses[id];
    if (b) bonuses[id] = { category: b.category, label: b.label, points: b.points };
  });
  return { points, results, bonuses };
}

function bonusCauseLabel(b) {
  if (!b) return 'Bonus';
  if (b.label) return b.label;
  if (b.category === 'verse') return 'Memory verse';
  if (b.category === 'cleanup') return 'Meal cleanup';
  return 'Bonus';
}

// Human-readable causes for what changed between two snapshots.
function describeCauses(prev, snap) {
  const causes = [];
  Object.keys(snap.results).forEach((gid) => {
    if (prev.results[gid] !== snap.results[gid]) {
      const g = gameById(gid);
      causes.push((g ? g.name : gid) + ' — result saved');
    }
  });
  Object.keys(prev.results).forEach((gid) => {
    if (!(gid in snap.results)) {
      const g = gameById(gid);
      causes.push((g ? g.name : gid) + ' — result cleared');
    }
  });
  Object.keys(snap.bonuses).forEach((id) => {
    if (!(id in prev.bonuses)) causes.push(bonusCauseLabel(snap.bonuses[id]) + ' — added');
  });
  Object.keys(prev.bonuses).forEach((id) => {
    if (!(id in snap.bonuses)) causes.push(bonusCauseLabel(prev.bonuses[id]) + ' — removed');
  });
  return causes;
}

// The changelog rules cap `reason` at 500, `team` at 60 and `by` at 80, and a
// refused push is swallowed by the .catch below — so an over-long value is not
// an error, it is a silently MISSING audit entry. A backup restore (one entry per
// scored game, easily 15+) is exactly the bulk change that blew the reason cap,
// leaving the week's biggest points event with no trace in the history drawer.
// Lengths are measured in UTF-8 bytes to stay safely under the rules however
// they count: every cause carries a 3-byte em dash.
const CHANGELOG_REASON_MAX = 500;

function utf8Len(str) {
  let n = 0;
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

// Truncate to at most `max` UTF-8 bytes (never splitting a character), ending
// in an ellipsis when anything was cut.
function clampText(str, max) {
  const s = String(str);
  if (utf8Len(s) <= max) return s;
  let out = '';
  let n = 0;
  for (const ch of s) {
    const l = utf8Len(ch);
    if (n + l > max - 3) break; // leave room for the 3-byte ellipsis
    out += ch;
    n += l;
  }
  return out + '…';
}

// The changelog `reason` for a list of causes: all of them when they fit,
// otherwise as many whole causes as leave room for "; … +N more".
function changelogReason(causes) {
  if (!causes.length) return 'Points updated';
  const full = causes.join('; ');
  if (utf8Len(full) <= CHANGELOG_REASON_MAX) return full;
  const kept = [];
  let len = 0;
  for (let i = 0; i < causes.length; i++) {
    const tail = '; … +' + (causes.length - i - 1) + ' more';
    const add = (kept.length ? 2 : 0) + utf8Len(causes[i]);
    if (len + add + utf8Len(tail) > CHANGELOG_REASON_MAX) break;
    kept.push(causes[i]);
    len += add;
  }
  // Not even the first cause fits (an absurdly long game name): cut that one.
  if (!kept.length) kept.push(clampText(causes[0], CHANGELOG_REASON_MAX - 40));
  const more = causes.length - kept.length;
  return kept.join('; ') + (more > 0 ? '; … +' + more + ' more' : '');
}

function recordPointHistory(counts, isRemote) {
  // Editors only, decided BEFORE any points are read (a viewer builds no
  // snapshot and keeps no baseline). See "Standings secrecy".
  if (!standingsVisible() || !canEdit()) { clPrevSnap = null; return; }
  const snap = snapshotForLog(counts);
  const prev = clPrevSnap;
  clPrevSnap = snap;        // always advance the baseline
  if (!prev) return;        // first render is the baseline — never logged
  if (isRemote) return;     // remote merge: the originating device already logged
  if (!fbRef) return;       // sync off — nowhere to log

  const changed = [];
  Object.keys(snap.points).forEach((tid) => {
    const before = prev.points[tid];
    const after = snap.points[tid];
    if (before !== undefined && before !== after) changed.push({ tid, before, after });
  });
  if (!changed.length) return;

  const reason = changelogReason(describeCauses(prev, snap));
  const at = new Date().toISOString();
  // Attribution comes from the ACCOUNT, never from state.identity — that's the
  // device-local "which one are you?" pick from the electives card, which any
  // counselor can set to any name in Settings. This is the accountability log;
  // it has to say who was signed in. memberName is the editor-maintained
  // member record, identityLabel the auth token — both server-side truths.
  const by = clampText(memberName || identityLabel(authUser) || '', 80) || null;
  // The rules pin this to the writer's authenticated identity, so a write
  // without it is refused outright — bail rather than fire a doomed push.
  const byKey = identityKey(authUser);
  if (!byKey) return;
  const logRef = firebase.database().ref(dbPath('changelog'));
  changed.forEach(({ tid, before, after }) => {
    logRef.push({ at, teamId: tid, team: clampText(teamName(tid), 60), delta: after - before, before, after, reason, by, byKey })
      .catch(() => { /* offline / rules — the log entry is best-effort */ });
  });
}

// A team's colour on an element, for the CSS that reads --team-accent-l / -d (styles.css "Team accent").
// teamAccentAttr is for markup written as a string (the board renderers): a whole ` style="…"` attribute or
// nothing, and nothing but hex digits and the two variable names can be in it (teamAccentVars).
function teamAccentAttr(id) {
  const vars = teamAccentVars(id);
  return vars ? ` style="${vars}"` : '';
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Team + identity picker ────────────────────────────────────────
// A tiny two-step flow in one overlay: first "which team are you rooting
// for?", then (for a real team) "which one are you?" so a counselor's own
// electives can be surfaced. Device-local — shown once after unlocking until
// answered, and reachable again later via the Now card's "Not Sam? Change". Existing
// followers from before identity shipped get only the name step on next launch.

// Picker step machine (module-local, not persisted).
let pickerStep = 'team';       // 'team' | 'identity'
let pickerTeamId = null;       // team whose counselors the identity step lists
let pickerNotifyToast = null;  // "following…" toast deferred to the final close

function teamPickerOverlayEl() {
  return document.getElementById('team-picker-overlay');
}

// Staff whose account says which team they're on don't get asked — the app
// already knows, so it just follows that team (and uses their member name as
// their identity, for the electives view). Returns true when it answered the
// question, so the picker stays shut.
//
// This overrides a hand-picked choice on purpose: the account is the truth,
// and a counselor who tapped a different team during camp week shouldn't
// keep seeing someone else's team as "yours". Un-assign them in More →
// Who can sign in and the picker comes back.
function adoptMemberTeam() {
  if (!memberTeamId) return false;
  let changed = false;
  if (state.followTeam !== memberTeamId) { state.followTeam = memberTeamId; changed = true; }
  // A member row typed with an old spelling ("Alysa") still adopts the one the
  // electives data is keyed to ("Alyssa") — see canonicalCounselorName.
  const canonName = memberName ? canonicalCounselorName(memberName) : '';
  const known = canonName && (teamRoster(memberTeamId).includes(canonName) || electiveKnowsName(canonName)) ? canonName : null;
  // Only adopt a name the electives data actually knows; otherwise leave the
  // identity answered-as-skipped rather than looking up nothing forever.
  const wanted = known || null;
  if (state.identity === undefined || (known && state.identity !== known)) {
    state.identity = wanted;
    changed = true;
  }
  if (changed) saveState();
  // A device painting from the cached hint runs maybeShowTeamPicker() before
  // the member record has arrived, so the picker may already be up by the
  // time we learn their team — take it back down. (Only the team step: an
  // identity picker they opened themselves is theirs to close.)
  if (pickerStep === 'team') closeTeamPicker();
  return true;
}

function maybeShowTeamPicker() {
  // The "which camp?" question outranks "which team?" — while the camp
  // picker is up, hold this one (its close event re-runs us; see
  // wireCampSwitcher).
  const cp = document.getElementById('camp-picker-overlay');
  if (cp && cp.hasAttribute && cp.hasAttribute('open')) return;
  if (adoptMemberTeam()) return; // their account already says which team they're on
  if (state.followTeam === undefined) { openTeamPicker(); return; }
  // Already following a real team but never answered "which one are you?"
  // (a fresh install skips this; existing followers get just the name step).
  // The question only exists where electives do.
  if (CAMP.features.electives && state.followTeam && state.identity === undefined) openIdentityPicker();
}

function openTeamPicker() {
  pickerStep = 'team';
  pickerNotifyToast = null;
  showPickerOverlay();
}

// Jump straight to the identity step (from the Now card's "Not Sam? Change", or the launch
// migration). Only meaningful when a real team is being followed.
function openIdentityPicker() {
  if (!CAMP.features.electives) return; // no electives → no "which one are you?"
  if (!state.followTeam) return;
  pickerStep = 'identity';
  pickerTeamId = state.followTeam;
  pickerNotifyToast = null;
  showPickerOverlay();
}

// The picker is a jelly-dialog: backdrop click, ✕, and Escape dismiss it
// without choosing. Pre-answer that just means "ask again next launch"
// (maybeShowTeamPicker re-opens it until the team question is answered).
function showPickerOverlay() {
  const overlay = teamPickerOverlayEl();
  if (!overlay) return;
  holdPickerHeight(false); // a fresh open sizes to its own step
  renderPickerStep();
  overlay.setAttribute('open', '');
}

// Programmatic close — a hand-off (adoptMemberTeam, openCampPicker). The
// attribute path skips the component's exit animation and the dialog is gone in
// one frame, which is right when another overlay is taking over.
function closeTeamPicker() {
  const overlay = teamPickerOverlayEl();
  if (!overlay) return;
  overlay.removeAttribute('open');
}

// A close the PERSON asked for (they picked, or chose to stay put) should play
// the dialog's exit animation, as the ✕ and backdrop already do: `open = false`
// goes through the component's animated close, removeAttribute('open') doesn't.
// Before jelly has upgraded the element `.open` is only a plain property, so
// fall back to the attribute then.
function closeOverlayAnimated(overlay) {
  if (!overlay || !overlay.hasAttribute('open')) return;
  if (typeof customElements !== 'undefined' && customElements.get(overlay.localName)) overlay.open = false;
  else overlay.removeAttribute('open');
}

function renderPickerStep() {
  const title = document.querySelector('.team-picker-title');
  const hint = document.querySelector('.team-picker-hint');
  if (pickerStep === 'identity') {
    if (title) title.textContent = 'Which counselor are you?';
    if (hint) hint.textContent = "So we can show your electives whenever you check in. Just cheering? Skip it.";
    renderIdentityOptions();
  } else {
    if (title) title.textContent = '👋 Which team are you rooting for?';
    if (hint) hint.textContent = 'You’ll get alerts when your team plays and wins medals.';
    renderTeamPickerOptions();
  }
}

function renderTeamPickerOptions() {
  const wrap = document.getElementById('team-picker-options');
  if (!wrap) return;
  wrap.innerHTML = state.teams.map((t) =>
    `<button class="team-picker-option ${state.followTeam === t.id ? 'selected' : ''}" data-team-id="${esc(t.id)}">
      <span class="chip-emoji">${teamEmoji(t.id)}</span> ${esc(t.name)}
    </button>`
  ).join('') + `<button class="team-picker-option team-picker-neutral ${state.followTeam === null ? 'selected' : ''}" data-team-id="">🙅 Neutral / no team</button>`;
  wrap.querySelectorAll('.team-picker-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.teamId || null;
      const turnedOnNotify = id && !state.notify;
      // Switching to a different team invalidates a prior identity — re-ask it.
      if (id !== state.followTeam) state.identity = null;
      state.followTeam = id;
      // Following a team opts you into its alerts — the picker promises alerts
      // "when your team plays and wins medals," which only fire when
      // notifications are on. (Neutral leaves the notify setting alone.)
      if (id && !state.notify) enableNotify();
      saveState();
      if (!id) {                       // neutral — no team, so no identity step
        state.identity = null;
        saveState();
        closePickerAndRender();
        return;
      }
      if (turnedOnNotify) {
        pickerNotifyToast = `🔔 Following ${teamEmoji(id)} ${teamName(id)} — you'll get alerts here when they play and win medals.`;
      }
      // The identity step exists to show YOUR electives — a camp without
      // electives (senior) has nothing to ask, so the picker just closes.
      if (!CAMP.features.electives) {
        state.identity = null;
        saveState();
        closePickerAndRender();
        return;
      }
      // Advance to the identity step (don't close yet).
      pickerTeamId = id;
      pickerStep = 'identity';
      holdPickerHeight(true);
      renderPickerStep();
    });
  });
}

// The identity step lists fewer options than the team step, and the dialog is
// vertically centred, so swapping the content made it snap shorter (565 → 359px)
// and re-centre in one frame. Keep the title, hint and option list as tall as
// the team step left them; `false` lets go (a fresh open sizes to its own step).
function holdPickerHeight(hold) {
  ['.team-picker-title', '.team-picker-hint', '#team-picker-options'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.minHeight = hold && el.offsetHeight ? el.offsetHeight + 'px' : '';
  });
}

function renderIdentityOptions() {
  const wrap = document.getElementById('team-picker-options');
  if (!wrap) return;
  // The member directory is the live roster once counselors are assigned to
  // teams; the printed roster, teamRoster() (which the electives data is keyed to), is the
  // fallback for a team nobody's been assigned to yet.
  const staff = teamStaffNames(pickerTeamId);
  const names = staff.length ? staff : teamRoster(pickerTeamId);
  wrap.innerHTML = names.map((n) =>
    `<button class="team-picker-option ${state.identity === n ? 'selected' : ''}" data-counselor="${esc(n)}">
      <span class="chip-emoji">${teamEmoji(pickerTeamId)}</span> ${esc(n)}
    </button>`
  ).join('') + `<button class="team-picker-option team-picker-neutral ${state.identity === null ? 'selected' : ''}" data-counselor="">🙌 Skip — I'm just cheering</button>`;
  wrap.querySelectorAll('.team-picker-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.identity = btn.dataset.counselor || null;
      saveState();
      closePickerAndRender();
    });
  });
}

function closePickerAndRender() {
  closeOverlayAnimated(teamPickerOverlayEl()); // the dialog's close event shows any pending notify toast
  renderAll();
}

function wireTeamPicker() {
  const overlay = teamPickerOverlayEl();
  if (!overlay) return;
  // The dialog's own backdrop/✕/Escape can dismiss without choosing. At the
  // identity step that's effectively "skip"; pre-answer it means "ask again
  // next launch" (maybeShowTeamPicker re-opens until answered). A pending
  // "following…" toast still shows so the choice that WAS made is confirmed.
  overlay.addEventListener('close', () => {
    if (pickerNotifyToast) { showToast(pickerNotifyToast); pickerNotifyToast = null; }
  });
}

// ── Bonus points (extra points, entered here and in Award points) ──

// Form state of Award points' quick-points entry — lives outside state so it isn't synced or persisted; the fields persist
// across adds for fast nightly entry. (The Games standings' quick-points sheet keeps a draft of its own: gamesQuickAdd.)
let bonusDraft = { category: 'custom', meal: 'Breakfast', teams: [], points: '', custom: '', sign: 1 };

function bonusLabelFor(d) {
  if (d.category === 'verse') return 'Verse memorization';
  if (d.category === 'cleanup') return `${d.meal} cleanup`;
  return (d.custom || '').trim() || 'Bonus';
}

function newBonusId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── The quick-points writers (the Games standings' quick-points sheet and Award points share them) ──
// ONE way to add a custom bonus and ONE way to remove a ledger entry, so the two screens that give points can
// never disagree about a rule (the own-team guard, the 1–100 range, the sign). Both work on the shared `bonusDraft`.
const BONUS_PROBLEMS = {
  teams: 'Pick at least one team.',
  points: 'Enter a non-zero point value.',
  range: 'Points must be a whole number from 1 to 100.',
  'own-team': "Your own team's points are awarded by another director.",
};

// What is wrong with the draft, as a code ('' = nothing): the message above, or Award points' button words.
function bonusDraftProblem(d) {
  const mag = Math.abs(Number(d.points));
  if (!d.teams.length) return 'teams';
  if (d.points === '' || isNaN(mag) || mag === 0) return 'points';
  if (!Number.isInteger(mag) || mag > 100) return 'range';
  if (d.teams.some((id) => !canScoreRound(id))) return 'own-team';
  return '';
}

// Writes the draft as one ledger entry per picked team (the same label and timestamp), then clears what was entered
// (the teams, the points, the sign back to +, a custom reason). Returns '' on success, else the problem code. Saves,
// does not render: the caller renders. `opts.day` (1–7) is the camp day the entry belongs to when that is not today —
// Award points records a correction for Wednesday on Thursday morning under Wednesday's list. It is stamped on the
// entry as `day` (verse and cleanup entries carry one already); the standings never read it for a custom bonus, and
// the double-points window still goes by the entry's own timestamp. The Games tab passes nothing: an entry with no
// `day` belongs to the weekday it was recorded on.
function bonusAddFromDraft(opts) {
  const d = (opts && opts.draft) || bonusDraft; // the Games tab's quick points use a draft of their own (gamesQuickAdd)
  if (!canEdit()) return 'own-team';
  const problem = bonusDraftProblem(d);
  if (problem) return problem;
  const pts = d.sign * Math.abs(Number(d.points));
  const label = bonusLabelFor(d);
  const at = new Date().toISOString();
  const day = Number(opts && opts.day);
  d.teams.forEach((teamId) => {
    const entry = { teamId, category: d.category, label, points: pts, at };
    if (d.category === 'custom' && Number.isInteger(day) && day >= 1 && day <= 7) entry.day = day;
    const id = newBonusId();
    state.bonuses[id] = entry;
    if (opts && Array.isArray(opts.made)) opts.made.push(id); // for an Undo that takes back exactly these
  });
  d.teams = [];
  d.points = '';
  d.sign = 1; // back to the default (+) for the next entry
  if (d.category === 'custom') d.custom = '';
  touchData();
  saveState();
  return '';
}

// Removes one ledger entry (a director's act; the own team's are another director's to change). Does not confirm, save
// or render: callers confirm in their own words and render after. Returns whether it removed one.
function removeBonusEntry(id) {
  const b = state.bonuses && state.bonuses[id];
  if (!b || !canEdit() || !canScoreRound(b.teamId)) return false;
  delete state.bonuses[id];
  touchData();
  saveState();
  return true;
}

// The camp day (0 Sun … 6 Sat) a ledger entry belongs to: the `day` it was filed under (Award points stamps one), else the
// camp-time weekday it was recorded on. Award points' day list.
function bonusDowOf(b) {
  const filed = Number(b && b.day);
  if (Number.isInteger(filed) && filed >= 1 && filed <= 7) return filed === 7 ? 0 : filed;
  const ms = Date.parse(b && b.at);
  if (!Number.isFinite(ms)) return -1;
  const p = etParts(ms);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

// What each team earned for one day + meal of meal cleanup, by team id (a points reader: directors only).
function cleanupEarned(day, meal) {
  const out = {};
  if (!pointsReadAllowed('cleanupEarned')) return out;
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b && b.category === 'cleanup' && (Number(b.day) || 0) === day && (b.meal || 'Breakfast') === meal) {
      out[b.teamId] = (out[b.teamId] || 0) + (Number(b.points) || 0);
    }
  });
  return out;
}

// ── Memory verses ────────────────────────────────────────────────
// The week's theme verse + one memory verse per camp day (Mon–Fri) —
// per-camp data (camps.js): junior's printed "Harvest of the Heart"
// sheet, senior's placeholders until its sheet exists. Counselors read
// the day's verse here and award points to teams that recite it; the
// points live in the bonus ledger under the 'verse' category.

// Which day's verse the card is showing, and the point-entry draft. Both
// live outside state so they aren't synced or persisted (verseDay defaults
// to today each load).
let verseDay = null;

// dow -> { raw: { teamId -> stored points }, effective: { teamId -> what the
// standings count } } from the 'verse' ledger entries. `effective` weights
// each entry by its own timestamp via bonusCountsDouble() — the same rule
// medalCounts() applies — so a pre-window entry stays single even when the
// double-points window is active right now.
function versePointsByDay() {
  const map = {};
  if (!pointsReadAllowed('versePointsByDay')) return map;
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b.category !== 'verse') return;
    const day = Number(b.day) || 0;
    if (!map[day]) map[day] = { raw: {}, effective: {} };
    const pts = Number(b.points) || 0;
    map[day].raw[b.teamId] = (map[day].raw[b.teamId] || 0) + pts;
    map[day].effective[b.teamId] = (map[day].effective[b.teamId] || 0) + pts * (bonusCountsDouble(b) ? 2 : 1);
  });
  return map;
}

// Set a card's one-line description only when it changed (these run on every render).
function setCardDesc(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}

function renderMemoryVerse() {
  const wrap = document.getElementById('verse-body');
  if (!wrap) return;
  // The points grid is a CONFIRMED director's: a hint-painted device (no member
  // answer yet) reads the verse like a counselor, so it reads no points either.
  const editing = standingsVisible();
  // index.html ships the counselor wording (fail closed); directors get the one
  // that talks about points.
  setCardDesc('verse-desc', editing
    ? "Each day's memory verse — pick a day to read it, and record points for teams that recite it. Verse points count toward each team's total in Current Standings."
    : "Each day's memory verse — pick a day to read it.");
  // Default to today's verse (Mon–Fri); fall back to Monday on the weekend.
  if (verseDay == null) {
    const dow = campNow().dow;
    verseDay = competitionDows().includes(dow) ? dow : competitionDows()[0];
  }
  const verse = verseFor(verseDay);
  const theme = verseTheme();
  const todayDow = campNow().dow;

  // Edited here, a week with no theme verse yet shows none (the day's verse still reads).
  const themeHTML = !theme.text ? '' : `
    <div class="verse-theme">
      <span class="verse-theme-label"><svg class="ico" aria-hidden="true"><use href="#i-book"/></svg>Theme verse${theme.title ? ' · ' + esc(theme.title) : ''}</span>
      <p class="verse-theme-text">“${esc(theme.text)}”</p>
      <p class="verse-theme-ref">${esc(theme.ref)}</p>
    </div>`;

  const dayChips = `<div class="verse-day-row">${competitionDows().map((dow) =>
    `<jelly-chip class="verse-day-chip" selectable size="small" ${dow === verseDay ? 'selected' : ''} data-verse-day="${dow}">${dayLabel(dow).slice(0, 3)}${dow === todayDow ? '<span class="today-dot" title="Today"></span>' : ''}</jelly-chip>`).join('')}</div>`;

  const verseVideo = verse.video
    ? `<a class="verse-video-link" href="${esc(verse.video)}" target="_blank" rel="noopener noreferrer">▶️ Watch the video</a>`
    : '';
  const verseBox = `
    <div class="verse-day-card">
      <span class="verse-day-name">${esc(dayLabel(verseDay))}</span>
      ${verse.text ? `<p class="verse-day-text">“${esc(verse.text)}”</p>
      <p class="verse-day-ref">${esc(verse.ref)}</p>` : '<p class="verse-day-text muted">No verse for this day yet.</p>'}
      ${verseVideo}
    </div>`;

  // One row per team: the day's verse points, shown exactly once. Editors
  // set a team's points by tapping 0–5 directly (0 clears); no separate
  // pick-teams-then-type flow, no duplicate summary chips + ledger.
  //
  // The stored/tapped scale always stays 0–5 raw (setVersePoints, the
  // selected-chip check, and data-pts below all use the raw number) —
  // bonusCountsDouble() is what actually doubles it in the standings, keyed
  // off each entry's own timestamp. On screen: tap-button labels show what a
  // tap made RIGHT NOW is worth (new entries are stamped "now", so during
  // the window a perfect recitation reads "10", not a "5" that quietly
  // becomes 10 elsewhere), while each team's shown total is the per-entry
  // effective value — a Monday entry viewed on Friday stays single, exactly
  // as the standings count it.
  // Counselors read the verse and nothing more: the per-team points (the rows
  // and their "+N" totals) are directors' eyes only, so the ledger is not even
  // read for anyone else.
  const earned = (editing && versePointsByDay()[verseDay]) || { raw: {}, effective: {} };
  const doubling = inDoubleBonusWindow();
  const displayMult = doubling ? 2 : 1;
  const hint = editing
    ? `<p class="bonus-entry-hint muted">Tap a team's points for ${esc(dayLabel(verseDay))}'s verse — 0 clears them.${doubling ? ' Double points are on — the tap values already show the doubled worth.' : ''}</p>`
    : '';
  const rowsHTML = `<div class="pts-grid">${state.teams.map((t) => {
    const pts = earned.raw[t.id] || 0; // raw stored value (0–5)
    const displayPts = earned.effective[t.id] || 0; // what it's actually worth in the standings
    // The own-team guard: a team's own verse points are that team's "round".
    const btns = editing && canScoreRound(t.id)
      ? `<div class="pts-btn-row" data-team-id="${esc(t.id)}" role="group" aria-label="${esc(t.name)} verse points">
          ${[0, 1, 2, 3, 4, 5].map((n) =>
            `<jelly-chip class="pts-btn" selectable shape="square" ${pts === n ? 'selected' : ''} data-pts="${n}">${n * displayMult}</jelly-chip>`).join('')}
        </div>`
      : '';
    return `<div class="pts-row">
      <span class="pts-row-team">${teamEmoji(t.id)} ${esc(t.name)}${displayPts > 5 ? ` <span class="pts-row-total">+${displayPts}</span>` : ((!editing || !canScoreRound(t.id)) && displayPts > 0 ? ` <span class="pts-row-total">+${displayPts}</span>` : '')}</span>
      ${btns}${editing && blockedByOwnTeam(t.id) ? '<span class="pts-row-locked">🛡️ your team</span>' : ''}
    </div>`;
  }).join('')}</div>`;

  const doubleNote = inDoubleBonusWindow()
    ? `<div class="messtival-banner">⚡ Double points until the end of Friday</div>`
    : '';
  if (!setHtmlIfChanged(wrap, doubleNote + themeHTML + dayChips + verseBox + hint + (editing ? rowsHTML : ''))) return;

  wrap.querySelectorAll('.verse-day-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      verseDay = parseInt(btn.dataset.verseDay, 10);
      renderMemoryVerse();
      joyStagger(document.querySelector('#verse-body .pts-grid'));
    });
  });
  wrap.querySelectorAll('.pts-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const teamId = btn.closest('.pts-btn-row').dataset.teamId;
      setVersePoints(teamId, verseDay, parseInt(btn.dataset.pts, 10));
    });
  });
}

// Sets a team's verse points for a day to exactly `pts` — replaces any
// existing entries for that (team, day) so the ledger holds one truth.
function setVersePoints(teamId, dow, pts) {
  if (!canScoreRound(teamId)) return; // own-team guard
  const fixedId = 'verse-' + teamId + '-' + dow;
  Object.entries(state.bonuses || {}).forEach(([id, b]) => {
    if (b && b.category === 'verse' && b.teamId === teamId && (Number(b.day) || 0) === dow) {
      delete state.bonuses[id];
    }
  });
  if (pts > 0) {
    state.bonuses[fixedId] = {
      teamId, category: 'verse', label: `${dayLabel(dow)} memory verse`,
      points: pts, at: new Date().toISOString(), day: dow,
    };
  }
  touchData();
  saveState();
  renderAll();
}

// ── Meal cleanup ─────────────────────────────────────────────────
// Each meal, a team is on cleanup. The rota (who cleans which meal each day)
// is fixed data (cleanupTeams(), SEAM block); points earned are stored in the bonus ledger under the
// 'cleanup' category, tagged with day + meal, so they flow into the week
// standings — same pattern as Memory Verse. A missing meal key = TBA.

// The soonest known meal-cleanup duty for `teamId` (today's remaining meals,
// then the rest of the week) — used by the "Your team" summary card's
// "Next meal cleanup" line. null if nothing's assigned yet (still TBA) or
// the week's meals are done.
function findNextCleanupFor(teamId) {
  if (!teamId) return null;
  const { dow: todayDow, minutes: nowMinutes } = campNow();
  for (const day of competitionDows()) {
    if (day < todayDow) continue; // earlier this week (a weekend reads as past too)
    for (const meal of MEAL_CLEANUP_MEALS) {
      if (day === todayDow && mealStart(day, meal) <= nowMinutes) continue;
      if (cleanupTeams(day, meal).includes(teamId)) return { day, meal };
    }
  }
  return null;
}

// Which day's rota the card is showing + the entry draft (not synced).
let cleanupDay = null;

// Total cleanup points recorded for one day + meal.
function cleanupMealPoints(day, meal) {
  let sum = 0;
  if (!pointsReadAllowed('cleanupMealPoints')) return sum;
  Object.values(state.bonuses || {}).forEach((b) => {
    if (b.category === 'cleanup' && (Number(b.day) || 0) === day && b.meal === meal) {
      sum += Number(b.points) || 0;
    }
  });
  return sum;
}

function renderMealCleanup() {
  const wrap = document.getElementById('cleanup-body');
  if (!wrap) return;
  setCardDesc('cleanup-desc', canEdit()
    ? "Each meal a team is on cleanup — pick a day to see the rota and award points. Cleanup points count toward each team's total in Current Standings."
    : 'Each meal a team is on cleanup — pick a day to see the rota.');
  // Default to today (Mon–Fri, else Monday).
  if (cleanupDay == null) {
    const dow = campNow().dow;
    cleanupDay = competitionDows().includes(dow) ? dow : competitionDows()[0];
  }
  const todayDow = campNow().dow;

  const dayChips = `<div class="verse-day-row">${competitionDows().map((dow) =>
    `<jelly-chip class="verse-day-chip" selectable size="small" ${dow === cleanupDay ? 'selected' : ''} data-cleanup-day="${dow}">${dayLabel(dow).slice(0, 3)}${dow === todayDow ? '<span class="today-dot" title="Today"></span>' : ''}</jelly-chip>`).join('')}</div>`;

  const rotaHTML = `<div class="cleanup-rota">${MEAL_CLEANUP_MEALS.map((meal) => {
    const teams = cleanupTeams(cleanupDay, meal);
    const teamStr = teams.length > 0
      ? teams.map(id => `${teamEmoji(id)} ${esc(teamName(id))}`).join(' + ')
      : '<span class="cleanup-tba">TBA</span>';
    return `<div class="cleanup-meal-row">
      <span class="cleanup-meal-name">${MEAL_ICONS[meal]} ${esc(meal)}</span>
      <span class="cleanup-meal-team">${teamStr}</span>
    </div>`;
  }).join('')}</div>`;

  // The rota IS the interface: one block per meal showing the assigned team,
  // and (for editors) the 0–3 point buttons right on it — no separate meal
  // chips or repeated team list. Viewers see the rota ONLY: no "+N" badges, no
  // ledger (see "Standings secrecy").
  const editing = canEdit();
  const earnedFor = (meal) => {
    const out = {};
    Object.values(state.bonuses || {}).forEach((b) => {
      if (b && b.category === 'cleanup' && (Number(b.day) || 0) === cleanupDay && (b.meal || 'Breakfast') === meal) {
        out[b.teamId] = (out[b.teamId] || 0) + (Number(b.points) || 0);
      }
    });
    return out;
  };

  let entryHTML = '';
  if (editing) {
    entryHTML = MEAL_CLEANUP_MEALS.map((meal) => {
      const assigned = cleanupTeams(cleanupDay, meal);
      const earned = earnedFor(meal);
      // Rota team(s) first; then any team that somehow has points for this
      // meal without being on the rota (rota edits, old data) so it stays
      // clearable rather than invisible.
      const rows = assigned.concat(teamIds().filter((id) => earned[id] && !assigned.includes(id)));
      const body = rows.length
        ? rows.map((id) => {
            const pts = earned[id] || 0;
            // The own-team guard: a team's own cleanup score is its round.
            const locked = blockedByOwnTeam(id);
            return `<div class="pts-row">
              <span class="pts-row-team">${teamEmoji(id)} ${esc(teamName(id))}${assigned.includes(id) ? '' : ' <span class="pts-row-total">not on rota</span>'}${pts > 3 || locked ? ` <span class="pts-row-total">+${pts}</span>` : ''}</span>
              ${locked ? '<span class="pts-row-locked">🛡️ your team</span>' : `<div class="pts-btn-row" data-team-id="${esc(id)}" data-meal="${esc(meal)}" role="group" aria-label="${esc(teamName(id))} ${esc(meal)} cleanup points">
                ${[0, 1, 2, 3].map((n) =>
                  `<jelly-chip class="pts-btn" selectable shape="square" ${pts === n ? 'selected' : ''} data-pts="${n}">${n}</jelly-chip>`).join('')}
              </div>`}
            </div>`;
          }).join('')
        : '<p class="muted bonus-empty">No team on the rota yet.</p>';
      return `<div class="cleanup-meal-block">
        <span class="cleanup-meal-name">${MEAL_ICONS[meal]} ${esc(meal)}</span>
        ${body}
      </div>`;
    }).join('');
  }

  // Legacy cleanup entries with no day (from the old Bonus card) — surface them
  // so their points aren't invisible even though they still count in totals.
  const legacy = !editing ? [] : Object.entries(state.bonuses || {})
    .filter(([, b]) => b.category === 'cleanup' && !(Number(b.day) >= 1 && Number(b.day) <= 5))
    .sort((a, b) => (b[1].at || '').localeCompare(a[1].at || ''));
  const legacyHTML = legacy.length
    ? `<p class="bonus-entry-hint muted">Earlier cleanup points (no day set):</p>
       <ul class="bonus-ledger">${legacy.map(([id, b]) => {
        const pts = Number(b.points) || 0;
        return `<li class="bonus-item">
          <span class="bonus-item-main">
            <span class="bonus-item-team">${teamEmoji(b.teamId)} ${esc(teamName(b.teamId))}</span>
            <span class="bonus-item-label">🧽 ${esc(b.label || 'Cleanup')}</span>
          </span>
          <span class="bonus-item-pts">+${esc(String(pts))}</span>
          ${canEdit() ? `<jelly-icon-button class="bonus-remove-btn" variant="rose" label="Remove this cleanup point" data-bonus-id="${esc(id)}">✕</jelly-icon-button>` : ''}
        </li>`;
      }).join('')}</ul>`
    : '';

  // Editors get the interactive rota (entryHTML); viewers the read-only one.
  if (!setHtmlIfChanged(wrap, dayChips + (editing ? entryHTML : rotaHTML) + legacyHTML)) return;

  wrap.querySelectorAll('.verse-day-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      cleanupDay = parseInt(btn.dataset.cleanupDay, 10);
      renderMealCleanup();
      joyStagger(document.querySelector('#cleanup-body .cleanup-rota, #cleanup-body .pts-grid'));
    });
  });
  wrap.querySelectorAll('.pts-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.pts-btn-row');
      setCleanupPoints(row.dataset.teamId, cleanupDay, row.dataset.meal, parseInt(btn.dataset.pts, 10));
    });
  });
  wrap.querySelectorAll('.bonus-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.bonusId;
      const b = state.bonuses[id];
      if (!b) return;
      const pts = Number(b.points) || 0;
      if (!confirm(`Remove +${pts} cleanup point${pts === 1 ? '' : 's'} for ${teamName(b.teamId)}?`)) return;
      delete state.bonuses[id];
      touchData();
      saveState();
      renderAll();
    });
  });
}

// Sets a team's cleanup points for a day+meal to exactly `pts` — replaces
// any existing entries for that (team, day, meal).
function setCleanupPoints(teamId, dow, meal, pts) {
  if (!canScoreRound(teamId)) return; // own-team guard
  const fixedId = 'cleanup-' + teamId + '-' + dow + '-' + meal;
  Object.entries(state.bonuses || {}).forEach(([id, b]) => {
    if (b && b.category === 'cleanup' && b.teamId === teamId &&
        (Number(b.day) || 0) === dow && (b.meal || 'Breakfast') === meal) {
      delete state.bonuses[id];
    }
  });
  if (pts > 0) {
    state.bonuses[fixedId] = {
      teamId, category: 'cleanup', label: `${dayLabel(dow)} ${meal} cleanup`,
      points: pts, at: new Date().toISOString(), day: dow, meal,
    };
  }
  touchData();
  saveState();
  renderAll();
}

// ── Game formats ─────────────────────────────────────────────────

const FORMAT_BADGES = {
  tournament: { label: 'Bracket', cls: 'badge-bracket', variant: 'azure' },
  tally: { label: 'Score entry', cls: 'badge-tally', variant: 'amber' },
  placement: { label: 'Podium pick', cls: 'badge-podium', variant: 'platinum' },
};

// ════════════════════════════════════════════════════════════════════
// THE GAMES ENGINE — gamesModel() and what hangs off it (redesign §5; BUILD-PLAN Step 18, build session 1)
// ════════════════════════════════════════════════════════════════════
// The Games tab as PLAIN DATA — no markup, no DOM — computed in the Now engine's own context (nowCtx: the role is read
// once, `director` = may act as a director right now, `points` = may see points) and from its own rows (nowGameRow), so a
// game reads the same on Now and here. games-ui.js paints it onto the static markup in #tab-games; a test walks it.
// Rules of the layer:
//   - SECRECY. The directors' standings (`standings`) are null unless `ctx.points`; a counselor's model holds no point, no
//     place, no leader's name and no picked team of a game still being scored (nowGameRow's rows carry a live tally in
//     roster order for a counselor, and "Being scored" for a draft). `secret` is the line a counselor reads instead.
//   - THE CLOCK IS AN ARGUMENT (`opts.now`, `opts.ms`), so a test can put "today" anywhere in the week.
//   - Week data only through the SEAM accessors (tests/seam.test.js).

const GAMES_QUICK_KEYS = [1, 2, 3, 5];                                // the points a director can give from the standings
const GAMES_QUICK_WHY = ['Sportsmanship', 'Team spirit', 'Helping out']; // the reasons offered (and "Other…")
const GAMES_QUICK_UNDO_MS = 10000;                                    // the Undo toast after quick points (§5.2)

// A block's run-sheet clock ("10:00–11:45"; from noon on, "6:00–6:45 PM": the part of day said once, at the end).
function gamesWhen(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  return schedClock(start, false) + '–' + schedClock(end, false) + (start >= 720 ? ' PM' : '');
}

function gamesOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// The day the clock is in, as a competition day: none before or after the camp week's dates (a Wednesday of last year is not
// "today"), else the day whose weekday it is.
function gamesToday(ctx, week) {
  if (week.phase === 'before' || week.phase === 'after') return null;
  return competitionDays().find((d) => d.dow === ctx.dow) || null;
}
// Is this day behind the clock? Sunday (the week's start) has nothing behind it, Saturday has the whole competition week.
function gamesDayIsPast(day, ctx, week) {
  if (week.phase === 'after') return true;
  if (week.phase === 'before') return false;
  return Number.isInteger(day.dow) && day.dow < ctx.dow;
}

// The picker's one status under a day name: 'done' (it has games and every one has a result — also on today), 'today', 'left'
// (a day behind us with games still unscored: `left` of them), else ''. A day with no games says nothing.
function gamesDayStatus(day, ctx, week, today) {
  const games = gamesForDayId(day.id);
  const total = games.length;
  const left = games.filter((g) => !(state.results && state.results[g.id])).length;
  let st = '';
  if (total && !left) st = 'done';
  else if (today && today.id === day.id) st = 'today';
  else if (total && left && gamesDayIsPast(day, ctx, week)) st = 'left';
  return { st, left, total };
}

// The two teams whose round a game is waiting on ([] when it names none): a bracket's current matchup, a bracket not yet
// started with a fixed first matchup, a four-team bracket's match under way. A tally or a podium game is never guarded at
// the game level (canScoreRound only bites a round with a team in it).
function gameRoundTeams(g) {
  if (!g || g.format !== 'tournament') return [];
  const raw = state.brackets && state.brackets[g.id];
  if (raw) {
    if (!bracketKnown(raw)) return [];
    const nb = normalizeBracket(raw);
    if (nb.phase === 'summary') return [];
    const pair = currentMatchupOf(g, nb);
    return pair ? pair.slice(0, 2).filter(Boolean) : [];
  }
  const f = fourLive(g);
  if (f) return f.pair.slice();
  if (g.format === 'tournament' && state.brackets4 && state.brackets4[g.id]) return []; // a four-team bracket that is finished, waiting on a re-check or unreadable
  const first = Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length ? g.roundOneMatchups[0] : null;
  return Array.isArray(first) ? first.slice(0, 2).filter(Boolean) : [];
}
// Would the own-team guard keep THIS director from scoring this game's round? (a director on a team; false for everyone else)
function gameBlockedForMe(g) {
  const t = gameRoundTeams(g);
  return t.length > 0 && blockedByOwnTeam(...t);
}

// One game as a row of the Games tab: Now's row (status, place, medals, board, the Score button) with the live line said
// per format — a round, "4 of 6 teams in", "Clock running", "Being scored" — and the own-team reason for every game a
// director's team plays the next round of, not only a live one.
function gamesRow(ctx, g) {
  const row = nowGameRow(ctx, g);
  if (row.status === 'live') {
    const b = row.board;
    const c = state.clocks && state.clocks[g.id];
    if (b && b.kind === 'match') row.line = String(b.cap).split(' · ')[0];
    else if (b && b.kind === 'tally') row.line = b.inCount + ' of ' + b.total + ' teams in';
    else if (row.line === 'Being scored' && c && c.running === true && Number(c.endAt) > ctx.ms) row.line = 'Clock running';
  }
  if (ctx.director && row.status !== 'done') {
    row.score = row.score || { gold: false, why: null };
    if (!row.score.why && gameBlockedForMe(g)) row.score.why = 'Your team plays · another director scores';
  }
  return row;
}

// One competition day's games in the order a director walks them: the schedule's blocks by time (each block's games in its
// own order), then the games on no block. [{ key, title, when, start, end, now, off, games }]. A day no block holds any of
// the games of (a camp whose schedule has none of them yet) falls back to the session names — Morning, Evening — rather
// than calling every game "not on the schedule".
function gamesDayGroups(day, ctx, today) {
  const own = gamesForDayId(day.id);
  const mine = new Set(own);
  const isToday = !!today && today.id === day.id;
  const groups = [];
  const listed = new Set();
  scheduleForDow(day.dow).forEach((b, i) => {
    // A game sits on ONE block here (the built-in senior rule lists its Evening pair under every games block after noon).
    const games = gamesForBlock(day.dow, b).filter((g) => mine.has(g) && !listed.has(g));
    if (!games.length) return;
    games.forEach((g) => listed.add(g));
    const timed = !b.noTime && Number.isFinite(b.start) && Number.isFinite(b.end);
    groups.push({
      key: 'b-' + blockPushId(b, day.dow, i), title: nowSplitLabel(b.label).head, when: timed ? gamesWhen(b.start, b.end) : '',
      start: timed ? b.start : null, end: timed ? b.end : null, now: isToday && timed && ctx.minutes >= b.start && ctx.minutes < b.end, off: false, games,
    });
  });
  const rest = own.filter((g) => !listed.has(g));
  if (!rest.length) return groups;
  // No schedule edited here means no game has a link to a block (gamesForBlock lists only Morning and Evening games under the
  // printed blocks), so "Not on the schedule" would be untrue of a printed week's Afternoon or Legacy games: they stay under their
  // session's name, as the old Games tab had them. "Not on the schedule" is for a game a director left off an edited schedule.
  if (!groups.length || !scheduleIsShared()) {
    const known = (state.config && state.config.sessions) || [];
    const sessions = known.concat([...new Set(rest.map((g) => g.session))].filter((s) => !known.includes(s)));
    sessions.forEach((s) => {
      const games = rest.filter((g) => g.session === s);
      if (games.length) groups.push({ key: 's-' + s, title: String(s), when: '', start: null, end: null, now: false, off: false, games });
    });
    return groups;
  }
  groups.push({ key: 'none', title: 'Not on the schedule', when: '', start: null, end: null, now: false, off: true, games: rest });
  return groups;
}

// The rows of a day's groups, with the two marks a director reads the day by: "up next" (today only: the first game not yet
// started in the block under way or the first block still to come) and the ONE gold Score (§8.1 rule 3): the first live game
// this director can score, else the one up next.
function gamesDayRows(ctx, day, today) {
  const groups = gamesDayGroups(day, ctx, today);
  const isToday = !!today && today.id === day.id;
  const out = groups.map((gr) => ({ key: gr.key, title: gr.title, when: gr.when, now: gr.now, off: gr.off, rows: gr.games.map((g) => gamesRow(ctx, g)) }));
  let next = null;
  if (isToday) {
    const from = groups.findIndex((gr) => gr.end != null && gr.end > ctx.minutes);
    for (let i = from < 0 ? groups.length : from; i < out.length && !next; i++) next = out[i].rows.find((r) => r.status === 'todo') || null;
  }
  if (next) next.next = true;
  if (ctx.director) {
    const rows = [];
    out.forEach((b) => b.rows.forEach((r) => rows.push(r)));
    const can = (r) => r.score && !r.score.why;
    const lead = rows.find((r) => r.status === 'live' && can(r)) || (next && can(next) ? next : null);
    rows.forEach((r) => { if (r.score) r.score.gold = r === lead; });
  }
  return out;
}

// The day's lines under the picker: the double-points line (every game of the day, or only some, named) and the day's own notes.
function gamesDayNotes(day, games) {
  const notes = [];
  const doubled = games.filter((g) => g.messtival);
  if (doubled.length) {
    notes.push({ kind: 'double', text: 'Double points until the end of Friday' + (doubled.length === games.length ? '' : ': ' + doubled.map((g) => g.name).join(', ')) });
  }
  String(day.note || '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => notes.push({ kind: 'day', text: l }));
  return notes;
}

function gamesModel(opts) {
  const ctx = nowCtx(opts);
  const week = nowWeek(ctx);
  const days = competitionDays();
  const today = gamesToday(ctx, week);
  const m = {
    at: { dow: ctx.dow, minutes: ctx.minutes, ms: ctx.ms, forced: ctx.forced }, week, director: ctx.director, points: ctx.points,
    off: false, secret: false, days: [], day: null, dayNote: '', notes: [], blocks: [], empty: null, quick: null, standings: null,
  };
  if (ctx.hidden.games) { m.off = true; return m; } // What counselors see turned Games off: nothing is computed
  m.secret = !ctx.points;
  const chosen = days.find((d) => d.id === state.ui.day) || today || days[0] || null;
  m.days = days.map((d) => {
    const s = gamesDayStatus(d, ctx, week, today);
    const name = String(d.name || '');
    const words = s.st === 'done' ? 'every game done' : s.st === 'today' ? 'today' : s.st === 'left' ? s.left + ' game' + (s.left === 1 ? '' : 's') + ' left' : '';
    return {
      id: d.id, dow: d.dow, name, short: name.slice(0, 3), st: s.st, left: s.left, total: s.total, today: !!today && today.id === d.id,
      selected: !!chosen && chosen.id === d.id, label: name + (words ? ', ' + words : ''),
    };
  });
  if (!chosen) {
    m.empty = { text: 'No competition days are set up yet.', add: ctx.director };
  } else {
    m.day = { id: chosen.id, dow: chosen.dow, name: String(chosen.name || ''), today: !!today && today.id === chosen.id };
    m.dayNote = today && today.id !== chosen.id ? m.day.name + ' · not today' : '';
    const games = gamesForDayId(chosen.id);
    m.notes = gamesDayNotes(chosen, games);
    m.blocks = gamesDayRows(ctx, chosen, today);
    if (!games.length) m.empty = { text: 'No games on ' + m.day.name + ' yet.', add: ctx.director };
    else if (ctx.director) m.quick = { sub: 'Add a one-off game to ' + m.day.name };
  }
  m.standings = ctx.points ? gamesStandings(ctx) : null;
  return m;
}

// ── Next game ─────────────────────────────────────────────────────────
// After a result is saved the takeover offers the next game of the SAME DAY in the order a director walks it: the rest of
// the block, then the later blocks, then the games on no block, then (wrapping round) whatever is still unscored before the
// game just done. A game whose round is the director's own team's is skipped and named instead ("needs another director").
// { game, left, waiting: [{id, name}], allDone, day, isToday }: `left` is every game this director can still score
// (`game` is the first of them), `allDone` is every game of the day having a result.
function gamesNextAfter(gid, opts) {
  const g = gameById(gid);
  const day = g ? dayById(g.dayId) : null;
  const none = { game: null, left: 0, waiting: [], allDone: false, day: null, isToday: false };
  if (!g || !day) return none;
  const ctx = nowCtx(opts);
  const today = gamesToday(ctx, nowWeek(ctx));
  const list = [];
  gamesDayGroups(day, ctx, today).forEach((gr) => gr.games.forEach((x) => list.push(x)));
  const at = list.indexOf(g);
  const order = at < 0 ? list : list.slice(at + 1).concat(list.slice(0, at));
  const open = order.filter((x) => x.id !== g.id && !(state.results && state.results[x.id]));
  const can = open.filter((x) => !gameBlockedForMe(x));
  return {
    game: can[0] || null, left: can.length, waiting: open.filter((x) => gameBlockedForMe(x)).map((x) => ({ id: x.id, name: x.name })),
    allDone: list.every((x) => state.results && state.results[x.id]), day: { id: day.id, name: String(day.name || '') }, isToday: !!today && today.id === day.id,
  };
}

// The takeover dock's words (directors): WHILE a podium is being picked, the Save button and what is missing; once a result is
// saved, what is left, the Next game button and where Back goes.
// { tone: 'pick', save: { ready, label, target } } | { tone: 'next' | 'wait' | 'done', left: text, next: { id, name } | null,
// back: 'Back to Now', to: 'Now' (the header back's own words, what the button shows) } or null (no director, or a game with nothing to
// dock: a bracket or a tally keeps its own Save in the body).
function gamesDock(gid, opts) {
  const g = gameById(gid);
  if (!g || !canEdit()) return null;
  if (!(state.results && state.results[g.id])) {
    if (gameIsPodium(g)) return { tone: 'pick', save: gamesPodium(g).save };
    // A four-team bracket whose four matches all agree saves from the same gold dock button as a podium (its Save was a pill in
    // the middle of the page, the one tap of the flow that looked like nothing else in the app).
    return fourReadyToSave(g) ? { tone: 'four' } : null;
  }
  const n = gamesNextAfter(gid, opts);
  const when = n.isToday || !n.day ? 'today' : 'on ' + n.day.name;
  const to = shellGameBackLabel(g);
  const back = 'Back to ' + to;
  const names = (list) => nowJoinNames(list.map((w) => w.name));
  if (n.game) {
    return { tone: 'next', left: n.left + ' game' + (n.left === 1 ? '' : 's') + ' left ' + when + ' that you can score', next: { id: n.game.id, name: n.game.name }, back, to };
  }
  if (n.waiting.length) {
    const w = n.waiting.length;
    return {
      tone: 'wait', next: null, back, to,
      left: 'Nothing left that you can score. ' + (w === 1 ? '1 game needs' : w + ' games need') + ' another director: ' + names(n.waiting) + ' (your team plays)',
    };
  }
  return { tone: 'done', next: null, back, to, left: n.allDone ? 'Every game ' + (n.isToday || !n.day ? 'today' : 'on ' + n.day.name) + ' is scored' : 'Nothing left that you can score' };
}

// A director taps Next game: re-asked at the tap (the data may have moved since the dock was drawn), and the takeover swaps
// to it — one history entry replaced, never one pushed, and the labelled Back still names where the first game was opened from.
function openNextGame() {
  const cur = state.ui && state.ui.gameId;
  if (!cur || !canEdit()) return false;
  const n = gamesNextAfter(cur);
  if (!n.game) { renderAll(); return false; }
  return openGame(n.game.id, { from: state.ui.gameFrom });
}

// ── The podium picker (redesign §5.5; games-ui.js draws it) ─────────────────────────────────────────────────────────
// A podium game (anything that is not a bracket or a tally) is scored by choosing three DIFFERENT teams: three rows of team keys,
// three taps and Save. The picks are the draft's own `medals` leaves (`drafts/<game>/medals/<medal>`), the same ones the three
// dropdowns wrote, so two directors never clobber each other (computeSyncUpdates diffs them per leaf) and the counselors' "Being
// scored" line behaves as before. A format allows no tie on a medal: one team per medal, which is also what a result stores.
const PODIUM_MEDALS = ['gold', 'silver', 'bronze'];
const PODIUM_WORDS = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
function gameIsPodium(g) { return !!g && g.format !== 'tournament' && g.format !== 'tally'; }

// The draft's picks as the picker reads them. Never trust the snapshot's shape: a stale team id (a roster change) is no pick, and a
// team that two directors wrote to two medals at the same moment keeps only its first (gold before silver before bronze), so the
// picker can never show one team twice or save a podium the format forbids.
function podiumPicks(g) {
  const d = state.drafts && g ? state.drafts[g.id] : null;
  const raw = d && typeof d === 'object' && d.medals && typeof d.medals === 'object' ? d.medals : {};
  const ids = teamIds();
  const used = {};
  const out = {};
  PODIUM_MEDALS.forEach((m) => {
    const t = raw[m];
    out[m] = typeof t === 'string' && ids.includes(t) && !used[t] ? (used[t] = true, t) : null;
  });
  return out;
}

// The picker as plain data: a row per medal, a key per team, and the Save button's words.
//   row: { medal, place, word, pts (number | null: only a phone that may read points), wait (the medal above it is still empty and
//   this one holds nothing: its keys are the dashed "not yet" well), waitFor ('gold' | null), pick, teams: [key] }
//   key: { team, name, short, picked, taken ('gold' | … | '': held by ANOTHER medal), disabled, label }
//   save: { ready, label, target (the first medal still to pick: a tap on the dashed well goes there) | null }
// A row that already holds a pick never waits, so a pick left by an older build or another director can always be cleared.
function gamesPodium(g) {
  const picks = podiumPicks(g);
  const mult = g && g.messtival ? 2 : 1;
  const pts = standingsVisible();
  const holder = {};
  PODIUM_MEDALS.forEach((m) => { if (picks[m]) holder[picks[m]] = m; });
  const ids = teamIds();
  const rows = PODIUM_MEDALS.map((medal, i) => {
    const above = i ? PODIUM_MEDALS[i - 1] : null;
    const wait = !!above && !picks[above] && !picks[medal];
    const teams = ids.map((team) => {
      const picked = picks[medal] === team;
      const taken = !picked && holder[team] ? holder[team] : '';
      const name = teamName(team);
      const short = nowTeamWord(team);
      const label = name + (taken ? ', has ' + taken : wait ? ', waiting for ' + above : '');
      return { team, name, short, picked, taken, disabled: !picked && (!!taken || wait), label };
    });
    return { medal, place: i + 1, word: PODIUM_WORDS[medal], pts: pts ? MEDAL_POINTS[medal] * mult : null, wait, waitFor: wait ? above : null, pick: picks[medal], teams };
  });
  const missing = PODIUM_MEDALS.filter((m) => !picks[m]);
  const label = !missing.length ? 'Save result'
    : missing.length === 1 ? 'Pick ' + missing[0] + ', then save'
    : missing.length === 2 ? 'Pick ' + missing[0] + ' and ' + missing[1]
    : 'Pick gold, silver and bronze';
  return { gid: g ? g.id : null, doubled: mult === 2, rows, picks, save: { ready: !missing.length, label, target: missing[0] || null } };
}

// A tap on a key: pick the team for that medal, or (the same key again) clear it. Refused, saying why, when the game is not a
// podium, already has a result (a second director saved first), the row is still waiting for the medal above, or the team already
// holds another medal. Writes the draft leaf and saves (the per-leaf push); the caller renders. { ok, action: 'pick' | 'clear',
// medal, team } or { ok: false, problem: 'unavailable' | 'unknown' | 'wait' | 'taken', by? }.
function podiumPick(gid, medal, team) {
  const g = gameById(gid);
  if (!g || !canEdit() || !gameIsPodium(g) || (state.results && state.results[g.id])) return { ok: false, problem: 'unavailable' };
  if (!PODIUM_MEDALS.includes(medal) || !teamIds().includes(team)) return { ok: false, problem: 'unknown' };
  const row = gamesPodium(g).rows.find((r) => r.medal === medal);
  const key = row.teams.find((t) => t.team === team);
  let action = 'pick';
  if (key.picked) action = 'clear';
  else if (key.taken) return { ok: false, problem: 'taken', by: key.taken };
  else if (row.wait) return { ok: false, problem: 'wait' };
  const d = normalizeDraft(state.drafts[g.id] || (state.drafts[g.id] = { medals: {} }));
  if (action === 'clear') delete d.medals[medal]; else d.medals[medal] = team;
  saveState();
  return { ok: true, action, medal, team };
}

// Save: the same record the Save Result button wrote (medals + savedAt, the draft removed, the stamp, the confetti). Refused
// while the podium is incomplete or a result already exists (a second director's save is not overwritten by a stale form).
// { ok: true, medals } or { ok: false, problem: 'unavailable' | 'incomplete', target? }.
function podiumSave(gid) {
  const g = gameById(gid);
  if (!g || !canEdit() || !gameIsPodium(g) || (state.results && state.results[g.id])) return { ok: false, problem: 'unavailable' };
  const picks = podiumPicks(g);
  const missing = PODIUM_MEDALS.filter((m) => !picks[m]);
  if (missing.length) return { ok: false, problem: 'incomplete', target: missing[0] };
  state.results[g.id] = { medals: { gold: picks.gold, silver: picks.silver, bronze: picks.bronze }, savedAt: new Date().toISOString() };
  delete state.drafts[g.id];
  touchData();
  saveState();
  renderAll();
  celebrate(picks.gold);
  return { ok: true, medals: state.results[g.id].medals };
}

// ── The saved result (mockup 14b) ───────────────────────────────────────────────────────────────────────────────────
// Has the server confirmed this result? 'saved' only once the write is ACKNOWLEDGED (the confirmed tree holds the same record),
// so "everyone's phone has it" is never a hope. 'saving' while it goes up, 'offline' while it cannot (no connection, or this
// device keeps no sync at all), 'refused' when the rules turned it away (the bar at the top has Retry / Discard). null: no result.
function gameResultState(gid) {
  const r = state.results && state.results[gid];
  if (!r) return null;
  if (stateQuarantine && ('results/' + gid) in stateQuarantine) return 'refused';
  if (!syncEnabled()) return 'offline';
  if (fbConnKnown && !fbConnected) return 'offline';
  const held = confirmedTree && confirmedTree.results ? confirmedTree.results[gid] : undefined;
  return JSON.stringify(syncCanon(held)) === JSON.stringify(syncCanon(r)) ? 'saved' : 'saving';
}

// The words of the line above the winners ("Saved 10:52 AM · everyone's phone has it"), camp time.
function gameSavedWords(state_, savedAt) {
  const d = savedAt ? new Date(savedAt) : null;
  const at = d && !Number.isNaN(d.getTime())
    ? ' ' + new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
    : '';
  if (state_ === 'saved') return 'Saved' + at + ' · everyone’s phone has it';
  if (state_ === 'saving') return 'Saving…';
  if (state_ === 'refused') return 'Not saved yet · the server turned it away. Use Retry in the bar at the top.';
  return 'Saved on this phone' + (syncEnabled() ? ' · it sends when you’re back online' : '');
}

// A saved result as plain data. The winners are public (a counselor reads them); what a medal is worth in the standings is a
// point, so `pts` is only on a phone that may read points; the "Saved … everyone's phone has it" line and the Change button are
// a director's (`saved` null, `change` false for everyone else).
//   { saved: { state, text } | null, places: [{ place, medal, word, team, name, short, pts, mine }], scores: { cap, rows } | null, change }
function gamesResultModel(g, result) {
  const mult = g && g.messtival ? 2 : 1;
  const pts = standingsVisible();
  const me = state.followTeam || null;
  const medals = result && result.medals && typeof result.medals === 'object' ? result.medals : {};
  const places = PODIUM_MEDALS.map((medal, i) => ({
    place: i + 1, medal, word: PODIUM_WORDS[medal], team: medals[medal], name: teamName(medals[medal]), short: nowTeamWord(medals[medal]),
    pts: pts ? MEDAL_POINTS[medal] * mult : null, mine: !!me && medals[medal] === me,
  })).filter((p) => typeof p.team === 'string' && p.team);
  let scores = null;
  if (result && result.scores && typeof result.scores === 'object' && Object.keys(result.scores).length) {
    const rows = Object.entries(result.scores).filter((e) => Number.isFinite(Number(e[1])))
      .sort((a, b) => (g.lowerWins ? a[1] - b[1] : b[1] - a[1]))
      .map(([team, v]) => ({ team, name: teamName(team), short: nowTeamWord(team), v: formatScore(g, v) }));
    if (rows.length) scores = { cap: 'Scores · ' + (g.unit || 'points') + (g.lowerWins ? ' · lowest wins' : ''), rows };
  }
  const st = canEdit() ? gameResultState(g.id) : null;
  return { saved: st ? { state: st, text: gameSavedWords(st, result && result.savedAt) } : null, places, scores, change: canEdit() };
}

// ── The directors' standings ─────────────────────────────────────────
// Places are reveal-core's groupPlaces over the app's own ranking — the same call the reveal's freeze makes — so a tie reads
// the same on this phone, the remote and the big screen: equal points share a place (1, 2, 2, 4), and inside a tie the golds,
// then silvers, then bronzes, then the name decide the order. Arrows compare this place with the one this device took at the
// start of the camp day (a baseline taken while nobody had a point says nothing: no arrows that day).
const GAMES_NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

// "Turkey trail Maples by 3. One gold for Turkey would put them in front." — about the director's own team when they are on one
// (the followed team, which an account's team sets), else the team in second. Data, not words: the renderer says it and bolds
// the names. { kind: 'trail' | 'lead' | 'tie', teams: [ids the sentence is about], lead: id, gap, golds, tie, gold } or null.
//   trail: `teams` trail `lead` by `gap`; `golds` golds (worth `gold` each now) would put them in front, or just tie them
//          (`tie`) when the gap is a whole number of golds.   lead: `teams` (one) lead `lead` by `gap`.
//   tie: `teams` are level at the top.
function gamesGap(rows) {
  const leader = rows[0];
  if (!leader || rows.length < 2 || leader.pts <= 0) return null;
  const gold = MEDAL_POINTS.gold * (inDoubleBonusWindow() ? 2 : 1);
  const tops = rows.filter((r) => r.pts === leader.pts).map((r) => r.team);
  const mine = state.followTeam ? rows.find((r) => r.team === state.followTeam) : null;
  if (tops.length > 1 && (!mine || mine.pts === leader.pts)) return { kind: 'tie', teams: tops, lead: leader.team, gap: 0, golds: 0, tie: false, gold };
  if (mine && mine.team === leader.team) {
    const second = rows[1];
    return { kind: 'lead', teams: [leader.team], lead: second.team, gap: leader.pts - second.pts, golds: 0, tie: false, gold };
  }
  const chase = mine || rows[1];
  const gap = leader.pts - chase.pts;
  const teams = mine ? [mine.team] : rows.filter((r) => r.pts === chase.pts && r.team !== leader.team).map((r) => r.team);
  const exact = gap % gold === 0;
  return { kind: 'trail', teams, lead: leader.team, gap, golds: exact ? gap / gold : Math.floor(gap / gold) + 1, tie: exact, gold };
}

// The gap as a sentence: `parts` ([{ text } | { team }], the renderer bolds a team's short name) and the same as plain `text`.
function gamesGapSentence(gap) {
  if (!gap) return null;
  const parts = [];
  const names = (ids) => ids.map((id) => nowTeamWord(id));
  const say = (t) => parts.push({ text: t });
  const sayTeams = (ids) => {
    ids.forEach((id, i) => {
      if (i) say(i === ids.length - 1 ? ' and ' : ', ');
      parts.push({ team: id });
    });
  };
  if (gap.kind === 'tie') {
    sayTeams(gap.teams); say(' are tied on points. The next medal breaks it.');
  } else if (gap.kind === 'lead') {
    sayTeams(gap.teams); say(' lead '); parts.push({ team: gap.lead }); say(' by ' + gap.gap + '.');
  } else {
    sayTeams(gap.teams); say(' trail '); parts.push({ team: gap.lead }); say(' by ' + gap.gap + '. ');
    const n = gap.golds;
    const doubled = gap.gold > MEDAL_POINTS.gold;
    say((GAMES_NUMBER_WORDS[n] || String(n)) + (doubled ? ' double-points gold' : ' gold') + (n === 1 ? '' : 's') + ' for ');
    if (gap.teams.length === 1) parts.push({ team: gap.teams[0] }); else say(gap.teams.length === 2 ? 'either' : 'any of them');
    say(' would ' + (gap.tie ? 'tie them.' : 'put them in front.'));
  }
  const text = parts.map((p) => (p.team ? nowTeamWord(p.team) : p.text)).join('');
  return { parts, text, names: names(gap.teams) };
}

function gamesStandings(ctx) {
  if (!ctx.points) return null;
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);
  const entries = ranked.map((t) => {
    const c = counts[t.id];
    return { id: t.id, nm: standingsTieName(t), p: c.points, g: c.gold, s: c.silver, b: c.bronze };
  });
  const empty = entries.every((e) => e.p === 0);
  // A table nobody has scored on has no places: the teams stay in roster order (groupPlaces would sort a tie by name).
  const groups = empty ? [{ place: 1, entries }] : groupPlaces(entries);
  const base = startOfDayPlaces();
  const arrows = !empty && !!base && !base.flat;
  const rows = [];
  groups.forEach((gr) => gr.entries.forEach((e) => {
    const c = counts[e.id];
    const was = base && base.places ? base.places[e.id] : null;
    rows.push({
      key: e.id, team: e.id, name: teamName(e.id), short: teamShort(e.id) || teamName(e.id), place: empty ? 0 : gr.place,
      tie: !empty && gr.entries.length > 1, pts: e.p, gold: c.gold, silver: c.silver, bronze: c.bronze, awarded: c.bonus,
      mv: arrows && Number.isFinite(was) ? was - gr.place : 0, locked: ctx.director && !canScoreRound(e.id), tap: ctx.director,
    });
  }));
  const gap = empty ? null : gamesGap(rows);
  return { empty, arrows, rows, gap, sentence: gamesGapSentence(gap) };
}

// What the quick-points sheet says about a team: "4th · 22 points so far" (tied: "2nd, tied"). null for a team that is not
// one of the camp's or when this phone may not see points.
function gamesQuickInfo(teamId) {
  if (!standingsVisible()) return null;
  const st = gamesStandings({ points: true, director: canEdit() });
  const r = st && st.rows.find((x) => x.team === teamId);
  if (!r) return null;
  const pts = r.pts + ' point' + (r.pts === 1 ? '' : 's') + ' so far';
  // medals: the row's medal line in words, for the sheet (the standings row drops it at very large text).
  const medals = st.empty ? '' : r.gold + ' gold · ' + r.silver + ' silver · ' + r.bronze + ' bronze';
  return { team: r.team, name: r.name, short: r.short, pts: r.pts, now: st.empty ? pts : gamesOrdinal(r.place) + (r.tie ? ', tied' : '') + ' · ' + pts, medals, doubled: inDoubleBonusWindow() };
}

// Quick points: the same ledger write as Award points (bonusAddFromDraft: the 1–100 range, the own-team guard, one entry per
// team stamped now, so the double-points window counts by its own timestamp), on a draft of its own so the Award points form is
// not disturbed. { ok, ids, pts, counted, team } or { ok: false, problem } — 'not-director' | 'team' | 'points' | an own-team
// refusal from the writer. Saves; the caller renders.
function gamesQuickAdd(teamId, pts, why) {
  if (!canEdit() || !standingsVisible()) return { ok: false, problem: 'not-director' };
  if (!teamIds().includes(teamId)) return { ok: false, problem: 'team' };
  if (!GAMES_QUICK_KEYS.includes(pts)) return { ok: false, problem: 'points' };
  if (!canScoreRound(teamId)) return { ok: false, problem: 'own-team' };
  const draft = { category: 'custom', meal: 'Breakfast', teams: [teamId], points: String(pts), custom: String(why == null ? '' : why).trim().slice(0, 40), sign: 1 };
  const made = [];
  const problem = bonusAddFromDraft({ draft, made });
  if (problem) return { ok: false, problem };
  return { ok: true, ids: made, pts, counted: pts * (inDoubleBonusWindow() ? 2 : 1), team: teamId };
}
// The Undo for it: takes back exactly the entries that add made (each only while it is still there and may be removed).
function gamesQuickUndo(ids) {
  let n = 0;
  (ids || []).forEach((id) => { if (removeBonusEntry(id)) n += 1; });
  if (n) renderAll();
  return n;
}

// ── Game view ────────────────────────────────────────────────────

// The game takeover (redesign §5.5): full screen over whatever tab opened it,
// its own scroll, a labelled back that names where it returns. The tab
// underneath never moves, so nothing about the page has to be remembered and
// restored (the old accordion fold, rememberGameOpener / restoreGameOpener and
// scrollToGameView retired with the appended #game-view). Opening, closing and
// the history entry are the shell's: openGame / closeGame above.
function renderGameView() {
  const tk = document.getElementById('takeover-game');
  const body = document.getElementById('takeover-game-body');
  if (!tk || !body) return;
  const g = state.ui.gameId ? gameById(state.ui.gameId) : null;
  if (!g) {
    if (tk.__gid) { // it was up: focus goes back to what opened it
      const o = shell.opener;
      shell.opener = null;
      if (o && o.isConnected !== false && typeof o.focus === 'function') { try { o.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
      tk.__gid = null; // before the exit: with no WAAPI its end runs at once
      // It slides back out to the right (playOut 220 ms; calm: a 140 ms fade),
      // taking no taps on the way, and is hidden at the end unless a game
      // reopened it meanwhile. Runs once: renderAll calls this again mid-exit.
      if (!tk.hidden && typeof JellyMotion !== 'undefined') {
        tk.style.pointerEvents = 'none';
        JellyMotion.playOut(tk, (x) => ({ transform: `translateX(${x * 100}%)` }), 220, () => {
          if (tk.__gid) return;
          tk.hidden = true;
          tk.style.pointerEvents = '';
        });
      } else tk.hidden = true;
    } else if (!tk.hidden && !tk.style.pointerEvents) tk.hidden = true;
    tk.__gid = null;
    body.__headHtml = null; // the next open builds afresh (and the dock is drawn again for the game it opens)
    return;
  }
  const opening = tk.hidden || tk.__gid !== g.id;
  tk.hidden = false;
  tk.style.pointerEvents = '';
  tk.__gid = g.id;

  // The header names the game and where Back goes; plain text nodes, written
  // only when they differ (this runs on every renderAll).
  const badge = FORMAT_BADGES[g.format] || { label: g.format || '?', cls: '' };
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  // Plain words (§8.6: no emoji in a heading or a status line; mockup 14).
  setText('takeover-game-title', g.name);
  setText('takeover-game-sub', [g.location, g.session, badge.label].filter(Boolean).join(' · '));
  const backLabel = shellGameBackLabel(g);
  setText('takeover-game-back-label', backLabel);
  const backBtn = tk.querySelector('[data-takeover-back]');
  if (backBtn && backBtn.getAttribute('aria-label') !== 'Back to ' + backLabel) backBtn.setAttribute('aria-label', 'Back to ' + backLabel);

  // The body head (double-points tag, rules) is built once per game and then
  // left alone. It used to be rewritten on every renderAll — every snapshot,
  // every clock tap — which slammed "How to play" shut under someone reading it.
  // Compared as a plain string, not via setHtmlIfChanged: opening the rules
  // adds `open` to the <details>, which that would read as "DOM changed" and
  // rebuild — shut.
  const headHtml = `
    ${g.messtival ? '<div class="nw-notes"><p class="nw-note" data-note="double"><svg class="ico" aria-hidden="true"><use href="#i-bolt"/></svg><span>Double points until the end of Friday</span></p></div>' : ''}
    ${(g.rules || []).length ? `<details class="rules-details">
      <summary>How to play</summary>
      ${g.rules.map((sec) => `
        <h4>${esc(sec.h)}</h4>
        <ul>${(sec.items || []).map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
      `).join('')}
    </details>` : ''}`;
  if (body.__headHtml !== headHtml || !body.querySelector('#entry-area')) {
    body.innerHTML = `${headHtml}
    <div id="clock-area"></div>
    <div id="tools-area"></div>
    <div id="entry-area"></div>
  `;
    body.__headHtml = headHtml;
    body.scrollTop = 0;
  }
  if (opening) {
    // A whole screen arrives with the full-screen spring (settle: no bounce);
    // the page behind it is inert, so focus moves in with it.
    if (typeof JellyMotion !== 'undefined') JellyMotion.play(tk, 'settle', (x) => ({ transform: `translateX(${(1 - x) * 100}%)` }));
    if (backBtn && typeof backBtn.focus === 'function') { try { backBtn.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
  }

  // Standalone game clock — everyone sees it tick live; only editors get the
  // controls (clockBlockHTML handles that). Live-tracker games show their clock
  // on the Big Board instead, so they're excluded here to avoid a double clock.
  // Rebuilt only when it changes, so the urgency classes, the zero alarm and
  // the buttons under a thumb survive unrelated renders.
  const ca = document.getElementById('clock-area');
  if (g.timer && !g.liveTracker && !state.results[g.id]) {
    if (setLiveHtmlIfChanged(ca, clockBlockHTML(g), [g])) bindClock(ca, g);
  } else {
    setLiveHtmlIfChanged(ca, '', []);
  }

  // Pictionary keeps its tools visible after the result is saved so
  // photos can still be exported; other tools hide once the game is done.
  // Viewers don't get the score-entry tools at all.
  const tools = document.getElementById('tools-area');
  if (canEdit() && (g.timer || g.prompts) && (g.prompts || !state.results[g.id])) {
    renderTools(tools, g);
  } else {
    setLiveHtmlIfChanged(tools, '', []); // the area outlives a render, so clear what's gone
  }

  // Each entry renderer skips an unchanged rebuild itself (setLiveHtmlIfChanged)
  // — except a started bracket (see renderTournament), which still rebuilds.
  const entry = document.getElementById('entry-area');
  const result = state.results[g.id];
  if (result) {
    renderResult(entry, g, result);
  } else if (!canEdit()) {
    renderLiveWatch(entry, g);
  } else if (g.format === 'tournament') {
    renderTournament(entry, g);
  } else if (g.format === 'tally') {
    renderTally(entry, g);
  } else {
    renderPlacement(entry, g);
  }
  // The dock under the body: Back and Next game once a result is saved (directors; games-ui.js).
  if (typeof renderGameDock === 'function') renderGameDock(g);
}

// Ranked live standings for a `liveRankings` tally game (Inflatable Bowling,
// Pictionary), read straight from the synced draft scores so viewers see the
// board climb in real time. For Pictionary the per-team totals are filled by
// the round runner as each team finishes; only times/points are ever exposed —
// never the drawing words.
function tallyRankLive(g) {
  const d = state.drafts && state.drafts[g.id];
  const entries = [];
  if (d && d.scores) {
    state.teams.forEach((t) => {
      const raw = d.scores[t.id];
      if (raw === undefined || String(raw).trim() === '') return;
      const v = parseScoreInput(g, raw);
      if (v !== null) entries.push({ id: t.id, v });
    });
    // The live ORDER says who leads, so only a director gets it. A counselor gets
    // the teams in roster order (entries are built in roster order above): the
    // game scores are public, the places are not (redesign §4.12 rows 11-12).
    if (standingsVisible()) entries.sort((a, b) => (g.lowerWins ? a.v - b.v : b.v - a.v));
  }
  return entries;
}

function tallyInProgress(g) {
  return !!g.liveRankings && !state.results[g.id] && tallyRankLive(g).length > 0;
}

// The matchup a bracket is currently waiting on a winner for — used by the
// read-only live-watch view so spectators see who's playing right now.
function currentMatchupOf(g, b) {
  if (!b) return null;
  if (b.phase === 'round1') {
    if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) {
      return g.roundOneMatchups[(b.matches || []).length] || null;
    }
    return (b.selectedPair && b.selectedPair.length === 2) ? b.selectedPair : null;
  }
  if (b.phase === 'semifinal' && b.semifinal && b.semifinal.winner == null) return [b.semifinal.a, b.semifinal.b];
  if (b.phase === 'championship' && b.championship && b.championship.winner == null) return [b.championship.a, b.championship.b];
  return null;
}

// The matchup that will be played AFTER the current one, when it's already
// known — i.e. the next pair in a fixed-order Round 1. Returns null when the
// next pairing can't be known yet (free pick, or a later stage whose teams
// aren't decided). Drives the "Up next" line under the live score.
function nextMatchupOf(g, b) {
  if (!b || b.phase !== 'round1') return null;
  if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) {
    return g.roundOneMatchups[(b.matches || []).length + 1] || null;
  }
  return null;
}

// Read-only live view for spectators (no score PIN): the current matchup,
// its live inning/tally (synced from the ref's device), and completed
// matches. Re-rendered by renderAll whenever a synced update lands.
// Note: no clock here — for the game's OWN page, #clock-area (renderGameView)
// already shows the standalone game clock above this view; a second one here
// would just duplicate it.
function renderLiveTallyWatch(container, g) {
  const ranked = tallyRankLive(g);
  if (!ranked.length) {
    setLiveHtmlIfChanged(container, `<div class="live-watch">
      <p class="live-watch-label">🔴 ${esc(g.name)}</p>
      <p class="muted">Live rankings will appear here as the ref enters scores — no refresh needed.</p>
    </div>`, [g]);
    return;
  }
  // The places, the podium and "Suggested: gold, silver, bronze" are directors'
  // only: a counselor sees the roster in its fixed order with the live scores and
  // no numerals (the scores themselves stay public). The suggested medals showed
  // the winners before a director saved the result.
  const seeOrder = standingsVisible();
  const complete = ranked.length >= state.teams.length && seeOrder;
  const medals = ['🥇', '🥈', '🥉'];
  const rows = ranked.map((e, i) => `
    <li class="lw-rank-row${seeOrder && i < 3 ? ' lw-podium' : ''}">
      <span class="lw-rank">${!seeOrder ? '' : complete && i < 3 ? medals[i] : (i + 1) + '.'}</span>
      <span class="lw-rank-team">${teamEmoji(e.id)} ${esc(teamName(e.id))}</span>
      <span class="lw-rank-score">${esc(formatScore(g, e.v))}</span>
    </li>`).join('');
  setLiveHtmlIfChanged(container, `<div class="live-watch live-watch-board">
    <p class="live-watch-label">🔴 Live now · ${esc(g.name)}</p>
    <p class="live-watch-board-sub">${g.lowerWins ? 'Fastest total time' : 'Team totals'} · ${ranked.length}/${state.teams.length} teams in</p>
    <ol class="lw-rank-list">${rows}</ol>
    ${complete
      ? `<p class="live-watch-suggest">🏅 Suggested: 🥇 ${esc(teamName(ranked[0].id))} · 🥈 ${esc(teamName(ranked[1].id))} · 🥉 ${esc(teamName(ranked[2].id))}</p>`
      : '<p class="muted live-watch-note">Updates automatically as the ref scores — no refresh needed.</p>'}
  </div>`, [g]);
}

// Every write here goes through setLiveHtmlIfChanged: a spectator's view used
// to be rebuilt on every snapshot from anywhere, wiping goal cannons
// mid-flight and dropping the clock's final-ten heartbeat. Nothing in it holds
// state (no listeners), so the game is the only thing to compare.
function renderLiveWatch(container, g) {
  // Tally games with live rankings (Inflatable Bowling, Pictionary) show a
  // read-only leaderboard rather than a bracket matchup.
  if (g.liveRankings && !(state.brackets && state.brackets[g.id])) {
    renderLiveTallyWatch(container, g);
    return;
  }
  const raw = state.brackets && state.brackets[g.id];
  if (!raw && state.brackets4 && state.brackets4[g.id]) { renderLiveWatchFour(container, g); return; }
  if (!raw) {
    // One plain line with a line icon (§8.6, §8.8): never an emoji in a dashed, tinted box.
    setLiveHtmlIfChanged(container, '<p class="nw-note gv-wait"><svg class="ico" aria-hidden="true"><use href="#i-clock"/></svg>' +
      '<span>Not scored yet. The winners show here when a director saves them.</span></p>', [g]);
    return;
  }
  if (!bracketKnown(raw)) {
    if (setLiveHtmlIfChanged(container, unknownBracketHtml(), [g])) wireUnknownBracketCard(container, g);
    return;
  }
  const b = normalizeBracket(raw);
  const phaseLabel = { round1: 'Round 1', bye: 'Bye', semifinal: 'Championship game', championship: 'Final', summary: 'Results' }[b.phase] || '';
  const pair = currentMatchupOf(g, b);

  const done = (b.matches || []).map((m) =>
    `<li>${teamEmoji(m.winner)} ${esc(teamName(m.winner))} def. ${esc(teamName(m.loser))}</li>`).join('');
  const doneHTML = done ? `<div class="live-watch-done"><p class="muted">Completed:</p><ul>${done}</ul></div>` : '';

  if (!pair) {
    setLiveHtmlIfChanged(container, `<div class="live-watch">
      <p class="live-watch-label">🔴 ${esc(g.name)} — ${phaseLabel} in progress</p>
      <p class="muted">Waiting for the next matchup…</p>
      ${doneHTML}
    </div>`, [g]);
    return;
  }

  // Every live game gets the same big-board treatment now — giant scores, the
  // live clock, and (for goal games) the celebrations — sized to own the screen.
  const scoreHTML = liveBoardHTML(g, pair[0], pair[1]);

  const nxt = nextMatchupOf(g, b);
  const onDeckHTML = nxt
    ? `<p class="live-watch-ondeck">⏭️ Up next: ${teamEmoji(nxt[0])} ${esc(teamName(nxt[0]))} vs ${teamEmoji(nxt[1])} ${esc(teamName(nxt[1]))}</p>`
    : '';

  setLiveHtmlIfChanged(container, `
    <div class="live-watch">
      ${g.liveTracker ? '' : `<p class="live-watch-label">🔴 Live now · ${phaseLabel}</p>`}
      ${scoreHTML}
      ${onDeckHTML}
      <p class="muted live-watch-note">Updates automatically as the ref scores — no refresh needed.</p>
      ${doneHTML}
    </div>`, [g]);

  // Every render, written or not: it diffs the score against the last one.
  const boardEl = container.querySelector('.big-board');
  if (boardEl && g.liveTracker) {
    boardDiffCelebrate(boardEl, g, getLiveMatch(g, pair[0], pair[1]), pair);
  }
}

// The same for a four-team bracket (senior), in the order a counselor reads it (mockup 13): the followed team's line first (what it
// plays next, the answer), then the match under way on the big board, who plays after it, and the four cells in order of play (Now's
// own card, so a counselor reads one picture of it everywhere). While a result is being checked, the line says so in place of the
// team's. Display only, and built from fourRead, so nothing a stray database value says reaches the markup as anything but a team
// of this camp. No tinted box around it (the cells are a well of their own) and nothing centred but the board.
function renderLiveWatchFour(container, g) {
  const b4 = nowBracket4({ myTeam: nowMyTeam() }, g);
  if (!b4) {
    // Something is there that this build cannot read (or a bracket still being set up): one quiet line, never a throw.
    setLiveHtmlIfChanged(container, '<p class="nw-note gv-wait"><svg class="ico" aria-hidden="true"><use href="#i-clock"/></svg>' +
      '<span>Not scored yet. The winners show here when a director saves them.</span></p>', [g]);
    return;
  }
  const f = fourLive(g);
  const grid = typeof nowBracket4Html === 'function' ? `<div class="gv-b4">${nowBracket4Html(b4)}</div>` : '';
  const clock = (text) => `<p class="nw-note gv-b4-hold"><svg class="ico" aria-hidden="true"><use href="#i-clock"/></svg><span>${esc(text)}</span></p>`;
  let line = '';
  if (b4.hold) line = clock(FOUR_HOLD_NOTE);
  else if (b4.note) line = `<p class="gv-b4-note" data-team="${esc(b4.note.team)}">${typeof nowMark === 'function' ? nowMark(b4.note.team, 22) : ''}<span><b>${esc(b4.note.lead)}</b>${esc(b4.note.rest)}</span></p>`;
  if (!f && !b4.hold) line += clock('All four matches are played. A director saves the result next.');
  const head = f ? `<p class="live-watch-label">Live now · ${esc(FOUR_NAMES[f.key])}</p>` : '';
  const board = f ? liveBoardHTML(g, f.pair[0], f.pair[1]) : '';
  const onDeck = f && f.next
    ? `<p class="live-watch-ondeck">Up next: ${fourTeamHtml(f.next[0])} <span class="four-vs">vs</span> ${fourTeamHtml(f.next[1])}</p>` : '';
  setLiveHtmlIfChanged(container, `<div class="live-watch-four">${line}${head}${board}${onDeck}${grid}</div>`, [g]);
  // Every render, written or not: it diffs the score against the last one.
  const boardEl = container.querySelector('.big-board');
  if (f && boardEl && g.liveTracker) boardDiffCelebrate(boardEl, g, getLiveMatch(g, f.pair[0], f.pair[1]), f.pair);
  // A cell that changed under the counselor's eyes pops its tag (the same motion as Now's card).
  const memo = container.__b4Gid === g.id && container.__b4Memo ? container.__b4Memo : (container.__b4Memo = { sig: null, pending: new Map() });
  container.__b4Gid = g.id;
  if (typeof nowB4Motion === 'function') nowB4Motion(container, b4, memo, typeof shellTakeoverOpen === 'function' ? shellTakeoverOpen() : true);
}

// The "+7 pts" chip beside a medal. The winner stays visible to everyone; what
// each medal is worth in the standings is points text, so only a director gets
// the chip (every bracket and result chip goes through here).
function medalWorthChip(points) {
  return standingsVisible() ? ` <span class="medal-points">+${points} pts</span>` : '';
}

function renderResult(container, g, result) {
  // The saved result is games-ui.js's (mockup 14b: the "Saved … everyone's phone has it" line, the winners as a list). The page
  // below is what a phone shows when that script never loaded: the same facts, plainly.
  if (typeof renderSavedResult === 'function') { renderSavedResult(container, g, result); return; }
  let extra = '';
  if (result.scores) {
    const rows = Object.entries(result.scores)
      .sort((a, b) => (g.lowerWins ? a[1] - b[1] : b[1] - a[1]))
      .map(([id, v]) => `<li>${esc(teamName(id))}: ${formatScore(g, v)}</li>`).join('');
    extra = `<p class="muted">Scores (${esc(g.unit || 'points')}):</p><ul class="score-recap">${rows}</ul>`;
  }
  // Match medalCounts()'s weighting — a messtival-flagged game (Friday, or
  // Thursday evening/Friday under the double-points window) pays double, and
  // this recap must show the same numbers the standings actually award.
  const mult = g.messtival ? 2 : 1;
  // The winners are public; what each medal is worth in the standings is not
  // (see "Standings secrecy"), so the "+7 pts" chips are directors' only.
  const worth = (k) => medalWorthChip(MEDAL_POINTS[k] * mult);
  // The listener below resolves state when tapped, so only the game is held.
  const fresh = setLiveHtmlIfChanged(container, `
    <h3>Final results</h3>
    <div class="medal-summary">
      <div class="medal-row gold-row">🥇 <strong>${esc(teamName(result.medals.gold))}</strong>${worth('gold')}</div>
      <div class="medal-row silver-row">🥈 <strong>${esc(teamName(result.medals.silver))}</strong>${worth('silver')}</div>
      <div class="medal-row bronze-row">🥉 <strong>${esc(teamName(result.medals.bronze))}</strong>${worth('bronze')}</div>
    </div>
    ${extra}
    ${canEdit() ? '<button id="clear-result-btn" class="link-btn danger-link">Clear result &amp; re-enter</button>' : ''}
  `, [g]);
  if (!fresh || !canEdit()) return;
  document.getElementById('clear-result-btn').addEventListener('click', () => {
    if (!confirm('Clear the saved result for ' + g.name + '? Its points come off the week standings.')) return;
    delete state.results[g.id];
    touchData();
    saveState();
    renderAll();
  });
}

// ── Medal picker (shared by tally + placement) ───────────────────

function medalPickerHTML(picks, game) {
  const mult = game && game.messtival ? 2 : 1; // Messtival doubles the points
  // The worth of each medal is points text: shown to directors only.
  const worth = (n) => (standingsVisible() ? ` · ${n} pts` : '');
  const slots = [
    { key: 'gold', label: `🥇 Gold${worth(MEDAL_POINTS.gold * mult)}` },
    { key: 'silver', label: `🥈 Silver${worth(MEDAL_POINTS.silver * mult)}` },
    { key: 'bronze', label: `🥉 Bronze${worth(MEDAL_POINTS.bronze * mult)}` },
  ];
  return `<div class="medal-picker">
    ${slots.map((s) => `
      <div class="medal-slot medal-slot-${s.key}">
        <span>${s.label}</span>
        <jelly-select data-medal="${s.key}" placeholder="— pick team —" ${picks[s.key] ? `value="${esc(picks[s.key])}"` : ''} label="${s.key} medal team">
          ${state.teams.map((t) =>
            `<jelly-option value="${esc(t.id)}">${teamEmoji(t.id)} ${esc(t.name)}</jelly-option>`
          ).join('')}
        </jelly-select>
      </div>
    `).join('')}
  </div>`;
}

function readMedalPicks(container) {
  const picks = {};
  container.querySelectorAll('[data-medal]').forEach((sel) => {
    picks[sel.dataset.medal] = sel.value || null;
  });
  return picks;
}

function validateMedals(picks) {
  if (!picks.gold || !picks.silver || !picks.bronze) return 'Pick a team for every medal.';
  if (picks.gold === picks.silver || picks.gold === picks.bronze || picks.silver === picks.bronze) {
    return 'Each medal needs a different team.';
  }
  return null;
}

// ── Tally format ─────────────────────────────────────────────────

function renderTally(container, g) {
  if (!state.drafts[g.id]) state.drafts[g.id] = { scores: {}, medals: {} };
  const draft = normalizeDraft(state.drafts[g.id]);
  const steps = g.counterSteps;
  // The listeners below resolve the draft when they FIRE, not from `draft`:
  // the form now outlives renders that don't change it, and a remote snapshot
  // swaps state.drafts for a fresh copy — a handler still holding the old one
  // would type into an orphan and the score would never be saved.
  const liveDraft = () => normalizeDraft(state.drafts[g.id] || (state.drafts[g.id] = { scores: {}, medals: {} }));

  // The own-team guard: a tally game's "round" is each team's own score, so
  // an editor assigned to a team gets everyone else's row and a locked one
  // for their own (see canScoreRound). They still finalize the result.
  const blockedTeam = state.teams.find((t) => blockedByOwnTeam(t.id));

  // Skipped when nothing in it changed: rebuilding re-created ~100 Jelly
  // elements (50-130 ms, several times that on a phone) on every snapshot
  // from anywhere while an editor had the game open. But a snapshot can put a
  // score back to exactly what this form was built with — same markup, while
  // the field still shows what was typed since — so it may only be kept when
  // the fields on screen still match the draft.
  const showsDraft = [...container.querySelectorAll('.score-input-row input')]
    .every((input) => input.value === (draft.scores[input.dataset.teamId] || ''));
  if (!showsDraft) container.__liveKey = null;
  const fresh = setLiveHtmlIfChanged(container, `
    <h3>Scores <span class="unit-tag">(${esc(g.unit || 'points')}${g.lowerWins ? ' — lowest wins' : ''})</span></h3>
    ${blockedTeam ? ownTeamNoteHTML('your own team\u2019s score') : ''}
    <div class="score-input-grid">
      ${state.teams.map((t) => {
        const locked = blockedByOwnTeam(t.id);
        return `
        <div class="score-input-row ${steps && !locked ? 'with-counter' : ''}${locked ? ' score-row-locked' : ''}">
          <div class="score-row-top">
            <span class="score-team"><span class="chip-emoji">${teamEmoji(t.id)}</span> ${esc(t.name)}<span class="chip-sub">${locked ? 'your team — another director scores this' : esc(counselorName(t.id))}</span></span>
            <input type="text" inputmode="${g.timeInput ? 'numeric' : 'decimal'}" placeholder="${g.timeInput ? 'm:ss' : '0'}"
              data-team-id="${esc(t.id)}" value="${esc(draft.scores[t.id] || '')}" ${locked ? 'readonly disabled' : ''} />
          </div>
          ${steps && !locked ? `<div class="counter-btn-row" data-team-id="${esc(t.id)}">
            <jelly-button class="counter-btn minus" shape="square" variant="platinum" block data-delta="${-steps[0]}">−${steps[0]}</jelly-button>
            ${steps.map((s) => {
              const lbl = g.counterStepLabels && g.counterStepLabels[s] ? `<span class="counter-btn-sub">${esc(g.counterStepLabels[s])}</span>` : '';
              return `<jelly-button class="counter-btn plus" shape="square" block data-delta="${s}">+${s}${lbl}</jelly-button>`;
            }).join('')}
          </div>` : ''}
        </div>
      `;
      }).join('')}
    </div>
    ${g.liveRankings ? '<button id="reset-scores-btn" class="link-btn danger-link reset-scores-btn">Reset all scores</button>' : ''}
    <div id="tally-medals"></div>
    <p id="entry-error" class="entry-error" role="alert" hidden></p>
    <jelly-button id="save-result-btn" class="primary-btn" block>Save result</jelly-button>
  `, [g]);
  if (!fresh) {
    // The picks aren't part of the form's markup (another editor may have
    // changed one), so the medal block still refreshes — cheaply, see there.
    updateTallyMedals(g);
    return;
  }

  container.querySelectorAll('.score-input-row input').forEach((input) => {
    let leaderBefore = null;
    input.addEventListener('focus', () => {
      leaderBefore = leaderOf(g, liveDraft());
    });
    input.addEventListener('input', () => {
      const live = liveDraft();
      live.scores[input.dataset.teamId] = input.value;
      live.medals = {}; // re-auto-rank when scores change
      saveState();
      updateTallyMedals(g);
    });
    input.addEventListener('change', () => {
      const live = liveDraft();
      checkHighScore(g, live, input.dataset.teamId, leaderBefore);
      leaderBefore = leaderOf(g, live);
    });
    // Push the moment the field loses focus, so the value lands on the server
    // right away rather than waiting out the debounce.
    input.addEventListener('blur', flushPendingPush);
  });

  container.querySelectorAll('.counter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      getAudio(); // unlock audio on a user gesture
      const live = liveDraft();
      const teamId = btn.closest('.counter-btn-row').dataset.teamId;
      const delta = parseInt(btn.dataset.delta, 10);
      const prevLeader = leaderOf(g, live);
      const current = parseScoreInput(g, live.scores[teamId] || '') || 0;
      let next = current + delta;
      if (next < 0 && !g.counterAllowNegative) next = 0;
      live.scores[teamId] = String(next);
      live.medals = {};
      const input = container.querySelector(`input[data-team-id="${teamId}"]`);
      if (input) input.value = String(next);
      saveState();
      checkHighScore(g, live, teamId, prevLeader);
      updateTallyMedals(g);
    });
  });

  updateTallyMedals(g);

  // Live-ranking games (Counselor Hide and Seek, etc.) accumulate points by
  // tapping counters. Discarding the whole in-progress draft both zeroes every
  // team AND removes the game from the "LIVE" home board — a team scored to 0
  // still counts as live (tallyRankLive keeps 0s), so clearing the draft is the
  // only way to un-start a game begun prematurely. Deleting the key (rather than
  // emptying it) de-lists it on every synced device too. A saved result is
  // untouched — that's the separate "Clear result" control on the result view.
  const resetBtn = document.getElementById('reset-scores-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('Reset ' + g.name + ' back to zero and take it off the live board?')) return;
      delete state.drafts[g.id];
      saveState();
      renderAll();
    });
  }

  document.getElementById('save-result-btn').addEventListener('click', () => {
    const picks = readMedalPicks(document.getElementById('tally-medals'));
    const err = validateMedals(picks);
    const errEl = document.getElementById('entry-error');
    if (err) {
      errEl.textContent = err;
      errEl.hidden = false;
      return;
    }
    const live = liveDraft();
    const scores = {};
    state.teams.forEach((t) => {
      const v = parseScoreInput(g, live.scores[t.id] || '');
      if (v !== null) scores[t.id] = v;
    });
    state.results[g.id] = { medals: picks, scores, savedAt: new Date().toISOString() };
    delete state.drafts[g.id];
    touchData();
    saveState();
    renderAll();
    celebrate(picks.gold);
  });
}

function autoRank(g, draft) {
  const entries = [];
  state.teams.forEach((t) => {
    const v = parseScoreInput(g, draft.scores[t.id] || '');
    if (v !== null) entries.push({ id: t.id, v });
  });
  entries.sort((a, b) => (g.lowerWins ? a.v - b.v : b.v - a.v));
  return entries;
}

function updateTallyMedals(g) {
  const draft = state.drafts[g.id];
  const wrap = document.getElementById('tally-medals');
  if (!wrap) return;
  const ranked = autoRank(g, draft);

  const auto = {
    gold: ranked[0] ? ranked[0].id : null,
    silver: ranked[1] ? ranked[1].id : null,
    bronze: ranked[2] ? ranked[2].id : null,
  };
  const picks = {
    gold: draft.medals.gold || auto.gold,
    silver: draft.medals.silver || auto.silver,
    bronze: draft.medals.bronze || auto.bronze,
  };

  // Tie warning: a team just outside the podium with the same score as one on it.
  let tieNote = '';
  if (ranked.length >= 4 && ranked[3].v === ranked[2].v) {
    tieNote = '<p class="tie-note">⚠️ Tie at the bronze line — adjust the medals below if needed.</p>';
  } else if (ranked.length >= 2 && ranked[0].v === ranked[1].v) {
    tieNote = '<p class="tie-note">⚠️ Tie at the top — adjust the medals below if needed.</p>';
  } else if (ranked.length >= 3 && ranked[1].v === ranked[2].v) {
    tieNote = '<p class="tie-note">⚠️ Tie for silver/bronze — adjust the medals below if needed.</p>';
  }

  // Written in parts. The ranking pills carry the scores, so they change on
  // every keystroke and +N tap. The pickers (3 Jelly selects, 18 options — the
  // expensive part) are built once per team list; a changed pick just sets the
  // selects' values in place, so not even the first keystrokes (where the
  // auto-picks move) rebuild them — ~50 ms on desktop, several times that on
  // a phone, and it closed a dropdown someone had open.
  if (!wrap.querySelector('#tally-picker')) {
    wrap.innerHTML = '<div id="tally-ranking"></div><div id="tally-heading"></div><div id="tally-picker"></div>';
  }
  setHtmlIfChanged(wrap.querySelector('#tally-ranking'), `
    ${ranked.length ? `<div class="live-ranking">${ranked.map((e, i) =>
      `<span class="rank-pill">${i + 1}. ${teamEmoji(e.id)} ${esc(teamName(e.id))} · ${formatScore(g, e.v)}</span>`).join('')}</div>` : ''}
    ${tieNote}`);
  setHtmlIfChanged(wrap.querySelector('#tally-heading'),
    `<h3 class="medal-picker-heading">Medals ${ranked.length >= 3 ? '<span class="unit-tag">(auto-filled from scores)</span>' : ''}</h3>`);
  const picker = wrap.querySelector('#tally-picker');
  const shape = medalPickerHTML({}, g); // everything but which team is picked
  if (picker.__shape === shape && picker.querySelector('[data-medal]')) {
    picker.querySelectorAll('[data-medal]').forEach((sel) => {
      const want = picks[sel.dataset.medal] || '';
      if ((sel.value || '') !== want) sel.value = want;
    });
    return;
  }
  picker.innerHTML = medalPickerHTML(picks, g);
  picker.__shape = shape;

  picker.querySelectorAll('[data-medal]').forEach((sel) => {
    sel.addEventListener('change', () => {
      // Resolved when picked: the picker outlives renders now, and the draft
      // it was built from may since have been replaced by a snapshot.
      const d = state.drafts[g.id];
      if (!d) return;
      normalizeDraft(d).medals[sel.dataset.medal] = sel.value || null;
      saveState();
    });
  });
}

// ── Placement format ─────────────────────────────────────────────

function renderPlacement(container, g) {
  // The podium picker (redesign §5.5, games-ui.js): three rows of team keys, Save in the dock. Without that script the three
  // dropdowns below still score the game — score entry must never depend on one more file loading over bad wifi.
  if (typeof renderPodiumPicker === 'function') { renderPodiumPicker(container, g); return; }
  if (!state.drafts[g.id]) state.drafts[g.id] = { medals: {} };
  const draft = normalizeDraft(state.drafts[g.id]);

  // Same skip as renderTally (six Jelly selects rebuilt on every snapshot
  // cost ~50 ms), with the same proviso — kept only while the selects on
  // screen still show the draft — and listeners that resolve it when they fire.
  const showsDraft = [...container.querySelectorAll('[data-medal]')]
    .every((sel) => (sel.value || null) === (draft.medals[sel.dataset.medal] || null));
  if (!showsDraft) container.__liveKey = null;
  const fresh = setLiveHtmlIfChanged(container, `
    <h3>Podium</h3>
    <p class="muted">No score-keeping needed — just record who placed.</p>
    <div id="placement-medals">${medalPickerHTML(draft.medals, g)}</div>
    <p id="entry-error" class="entry-error" role="alert" hidden></p>
    <jelly-button id="save-result-btn" class="primary-btn" block>Save result</jelly-button>
  `, [g]);
  if (!fresh) return;

  container.querySelectorAll('[data-medal]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const d = normalizeDraft(state.drafts[g.id] || (state.drafts[g.id] = { medals: {} }));
      d.medals[sel.dataset.medal] = sel.value || null;
      saveState();
    });
  });

  document.getElementById('save-result-btn').addEventListener('click', () => {
    const picks = readMedalPicks(document.getElementById('placement-medals'));
    const err = validateMedals(picks);
    const errEl = document.getElementById('entry-error');
    if (err) {
      errEl.textContent = err;
      errEl.hidden = false;
      return;
    }
    state.results[g.id] = { medals: picks, savedAt: new Date().toISOString() };
    delete state.drafts[g.id];
    touchData();
    saveState();
    renderAll();
    celebrate(picks.gold);
  });
}

// ── Tournament format ────────────────────────────────────────────

function freshBracket() {
  return {
    phase: 'round1', // round1 -> bye -> semifinal -> championship -> summary
    pool: teamIds(),
    selectedPair: [],
    matches: [],
    byeTeamId: null,
    semifinal: null,
    championship: null,
  };
}

// ── The six-team bracket's rules (pure) ──────────────────────────────────────────────────────────
// What the wizard's taps DO to a bracket, with no DOM and no state read: each takes the bracket (the object
// in state.brackets[gid]) and changes it in place, returning what it recorded (null / false when it
// refused). The click handlers below call these, then touchData / saveState / renderAll. They were
// written down from the handlers' own bodies and pinned first (tests/bracket.test.js), so nothing about what
// a director sees changed when they moved out.

// Round 1, free pick: tap a team to pick it, tap it again to put it back; at most two at a time.
function sixPick(b, id) {
  const at = b.selectedPair.indexOf(id);
  if (at > -1) b.selectedPair.splice(at, 1);
  else if (b.selectedPair.length < 2) b.selectedPair.push(id);
  return b.selectedPair;
}

// Round 1 (free pick or a fixed order): a and c played, `winner` won. The pair leaves the pool.
function sixRecordMatch(b, a, c, winner) {
  if (!b || !a || !c || a === c || (winner !== a && winner !== c)) return null;
  const rec = { a, b: c, winner, loser: winner === a ? c : a };
  b.matches.push(rec);
  b.pool = b.pool.filter((id) => id !== a && id !== c);
  b.selectedPair = [];
  return rec;
}

// The last round-1 match comes back: both teams re-join the END of the pool. A pair being picked is left alone.
function sixUndoMatch(b) {
  const last = b.matches.pop();
  if (last) b.pool.push(last.a, last.b);
  return last || null;
}

// Back from the bye to round 1 (the same undo, and the phase).
function sixBackToRound1(b) {
  sixUndoMatch(b);
  b.phase = 'round1';
  return b;
}

// The three round-1 winners; the one who gets the bye goes straight to the final, the other two meet.
function sixChooseBye(b, byeId) {
  const winners = b.matches.map((m) => m.winner);
  if (winners.indexOf(byeId) === -1) return false;
  const others = winners.filter((id) => id !== byeId);
  b.byeTeamId = byeId;
  b.semifinal = { a: others[0], b: others[1], winner: null, loser: null };
  b.phase = 'semifinal';
  return true;
}

// The championship game's winner meets the bye team in the final; its loser has the bronze.
function sixRecordSemifinal(b, winner) {
  const s = b && b.semifinal;
  if (!s || (winner !== s.a && winner !== s.b)) return false;
  s.winner = winner;
  s.loser = winner === s.a ? s.b : s.a;
  b.championship = { a: b.byeTeamId, b: winner, winner: null, loser: null };
  b.phase = 'championship';
  return true;
}

function sixRecordFinal(b, winner) {
  const c = b && b.championship;
  if (!c || (winner !== c.a && winner !== c.b)) return false;
  c.winner = winner;
  c.loser = winner === c.a ? c.b : c.a;
  b.phase = 'summary';
  return true;
}

// The podium of a finished six-team bracket: gold wins the final, silver loses it, bronze lost the championship game.
function sixMedals(b) {
  return { gold: b.championship.winner, silver: b.championship.loser, bronze: b.semifinal.loser };
}

// Back from the championship game to the bye choice: the bye is taken back, the three round-1 winners are as they were.
function sixBackToBye(b) {
  if (!b || !b.semifinal || b.semifinal.winner) return false; // nothing to take back once the championship game has a winner: undo that first
  b.byeTeamId = null;
  b.semifinal = null;
  b.championship = null;
  b.phase = 'bye';
  return true;
}

// The championship game's result comes back (the final, not played yet, goes with it).
function sixUndoSemifinal(b) {
  const s = b && b.semifinal;
  if (!s || !s.winner || (b.championship && b.championship.winner)) return false; // the final's result comes back first
  s.winner = null;
  s.loser = null;
  b.championship = null;
  b.phase = 'semifinal';
  return true;
}

// The final's result comes back, so the final can be played again.
function sixUndoFinal(b) {
  const c = b && b.championship;
  if (!c || !c.winner) return false;
  c.winner = null;
  c.loser = null;
  b.phase = 'championship';
  return true;
}

// ── What both brackets share ─────────────────────────────────────────────────────────────────────
// Which node holds a game's bracket: the six-team wizard's `brackets`, the four-team bracket's `brackets4`.
function bracketNode(kind) { return kind === 'four' ? state.brackets4 : state.brackets; }

// Save a finished bracket's podium as the game's result (the same record a tally or a placement game saves, so
// medalCounts, the Now card and the reveal read it identically), retire the bracket and the game's live tally with it,
// and celebrate the winner. `path` is the finished bracket itself, kept on the result for a four-team game.
function finishBracket(g, kind, medals, path) {
  const rec = { medals: { gold: medals.gold, silver: medals.silver, bronze: medals.bronze }, savedAt: new Date().toISOString() };
  if (path) rec.path = path;
  state.results[g.id] = rec;
  const node = bracketNode(kind);
  if (node) delete node[g.id];
  clearLiveMatch(g);
  touchData();
  saveState();
  renderAll();
  celebrate(medals.gold);
}

// Throw a bracket away, and the live tally of its current match with it (Cancel this bracket; Clear this bracket).
function cancelBracket(g, kind) {
  const node = bracketNode(kind);
  if (node) delete node[g.id];
  clearLiveMatch(g);
  saveState();
  renderAll();
}

// Whatever either kind of bracket still holds for a game (a late tap's stray included), thrown away. Returns whether there was any.
function dropBracketNodes(gid) {
  let had = false;
  ['brackets', 'brackets4'].forEach((k) => {
    if (state[k] && state[k][gid]) { delete state[k][gid]; had = true; }
  });
  return had;
}

// One device, one result at a time. A bracket repaints in place, so the screen that follows a recorded winner has ITS first winner
// button at the very same spot as the one just tapped (and the Undo link that follows an Undo is under the same thumb too): a quick
// second tap (a double tap, a nervous thumb) lands on the NEXT match and records it with the wrong team, or takes back a second
// match. No stale screen is involved (the new match IS what the screen shows), so the "read the match again when the tap fires"
// guards cannot see it. For a moment after this device records a result, further record taps are ignored and said; the same for
// Undo after an Undo. A record then an Undo is NOT held (the "oops, wrong team" reflex), and a clock that stepped backwards never
// locks anything. Tests that play a whole bracket call bracketTapReset() between taps, as a person's separate taps would be further apart.
const BRACKET_TAP_SETTLE_MS = 700;
const BRACKET_TAP_WORDS = 'That tap came right after the last one, so it was ignored. Tap again if you meant it.';
const bracketTapLast = { record: 0, undo: 0 };
function bracketTapHeld(kind) {
  const at = bracketTapLast[kind || 'record'];
  const gap = Date.now() - at;
  if (at > 0 && gap >= 0 && gap < BRACKET_TAP_SETTLE_MS) { showToast(BRACKET_TAP_WORDS); return true; }
  return false;
}
function bracketTapDone(kind) { bracketTapLast[kind || 'record'] = Date.now(); }
function bracketTapReset() { bracketTapLast.record = 0; bracketTapLast.undo = 0; }
// A six-team wizard handler behind that guard: `fn` returns false when it did nothing.
function sixTap(fn, kind) {
  return () => {
    if (bracketTapHeld(kind)) return;
    if (fn() !== false) bracketTapDone(kind);
  };
}

// ── The four-team bracket's rules (pure) ─────────────────────────────────────────────────────────
// A tournament on exactly four teams (senior camp): two semifinals, the 3rd-place match, the final.
//
//   state.brackets4[gid] = { at: <ms>, m: { s1:    { a, b, winner?, at? },
//                                          s2:    { a, b, winner?, at? },
//                                          third: { a?, b?, winner?, at? },
//                                          final: { a?, b?, winner?, at? } } }
//
// s1 and s2 are seeded when it starts. third and final are written when they are RECORDED, with the two teams that played
// them next to the winner, so a record can always be checked against the bracket it was made in (a second ref on a second phone
// can change a semifinal after the match that follows it was played — setup-rebuild-spec sync-F9). The PHASE is never stored: it
// is the first match with no winner, in FOUR_ORDER: s1 → s2 → third → final → summary (decision Q12: 3rd place before the final;
// should the owner ever flip it, FOUR_ORDER is the one place — nothing else names the order),
// 'recheck' when a recorded match disagrees with the semifinals it came from, 'broken' when the bracket cannot be read at all.
//
// Nothing here reads state, the DOM or the clock: every function takes the bracket and the camp's team ids, and the ones that
// change a bracket change it in place and say what they did. The page-state wrappers (fourRecordTap …) are below.
const FOUR_ORDER = ['s1', 's2', 'third', 'final'];
// What each match is called on every screen (the step bar, the Now card's four cells, a live row's line, a toast).
const FOUR_NAMES = { s1: 'Semifinal 1', s2: 'Semifinal 2', third: '3rd place', final: 'Final' };
// The one line everybody but the deciding director reads while a result is being checked (Now's card and the game view).
const FOUR_HOLD_NOTE = 'A director is double-checking a result. The bracket carries on soon.';

// How many teams a tournament can be played with: six (the wizard, `brackets`), four (`brackets4`), or neither.
function bracketKindFor(n) { return n === 6 ? 'six' : n === 4 ? 'four' : null; }

// Can this many teams be played as a bracket in the app right now? (The Games sheet says so when they cannot.)
function bracketPlayable(n) {
  const kind = bracketKindFor(n);
  return kind === 'six' || (kind === 'four' && typeof renderBracketFour === 'function');
}

// RTDB prunes an empty map: a four-team bracket whose matches are all gone reads back with no `m`. This restores the one container
// the rest relies on and nothing else — healing must never invent a value (the next push would write it as somebody's edit), and a
// stored value that is not a match is left for fourRead to refuse. It runs at load (a cached week), so it reads nothing declared
// further down this file.
function normalizeBracket4(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  if (!b.m || typeof b.m !== 'object' || Array.isArray(b.m)) b.m = {};
  return b;
}

// One look at a stored four-team bracket as plain, laundered data — or null when this build cannot read it (not an object, a camp
// that does not have exactly four teams, a semifinal without two different teams of this camp, four teams that are not four, a
// semifinal winner who did not play it).
// Every id passes the roster (`ids`), so a stored string can never reach markup as a team. Cells are { a, b, winner, at, recorded }:
// a recorded match keeps the teams it was played with, an unrecorded third / final shows the teams it WILL have ('' while unknown).
// `recheck` is null while every recorded match agrees with the semifinals; else { match, semi, now, was } — the later match that
// disagrees, the semifinal it was played on, who wins that semifinal now ('' = nobody) and who the later matches say won it (null
// when they do not agree). `vouch` is that per-semifinal answer, which fourResolve('back') puts back.
function fourRead(b, ids) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || !b.m || typeof b.m !== 'object' || Array.isArray(b.m)) return null;
  const roster = Array.isArray(ids) ? ids : [];
  // A four-team bracket only exists on a camp with four teams: a stray under a six-team (junior) game, which names four of its six,
  // would otherwise read as a live bracket (marking the game live and feeding matchup alerts) that no screen there can show.
  if (roster.length !== 4) return null;
  const id = (v) => (typeof v === 'string' && roster.indexOf(v) !== -1 ? v : '');
  const rec = (k) => (b.m[k] && typeof b.m[k] === 'object' && !Array.isArray(b.m[k]) ? b.m[k] : null);
  const cell = (k) => {
    const r = rec(k);
    if (!r) return { a: '', b: '', winner: '', at: 0, recorded: false };
    return { a: id(r.a), b: id(r.b), winner: id(r.winner), at: Number(r.at) > 0 ? Number(r.at) : 0, recorded: false };
  };
  const m = { s1: cell('s1'), s2: cell('s2'), third: cell('third'), final: cell('final') };
  const seeds = [m.s1.a, m.s1.b, m.s2.a, m.s2.b];
  if (seeds.some((x) => !x) || new Set(seeds).size !== 4) return null;
  for (const k of ['s1', 's2']) {
    const raw = rec(k).winner;
    if (raw !== undefined && raw !== null && raw !== '' && raw !== m[k].a && raw !== m[k].b) return null;
    m[k].recorded = !!m[k].winner;
  }
  const loser = (c) => (c.winner ? (c.winner === c.a ? c.b : c.a) : '');
  const want = { third: [loser(m.s1), loser(m.s2)], final: [m.s1.winner, m.s2.winner] };
  const sameTeams = (c, w) => !!c.a && !!c.b && !!w[0] && !!w[1] && c.a !== c.b && ((c.a === w[0] && c.b === w[1]) || (c.a === w[1] && c.b === w[0]));
  ['third', 'final'].forEach((k) => {
    const r = rec(k);
    const c = m[k];
    c.recorded = !!(r && typeof r.winner === 'string' && r.winner);
    if (!c.recorded) { c.a = want[k][0]; c.b = want[k][1]; c.winner = ''; c.at = 0; return; }
    c.fits = sameTeams(c, want[k]) && (c.winner === c.a || c.winner === c.b);
  });
  // Who do the matches played AFTER a semifinal say won it? The final has its winner in it, the 3rd-place match its loser.
  const vouch = {};
  ['s1', 's2'].forEach((k) => {
    const c = m[k];
    const says = [];
    [['final', true], ['third', false]].forEach(([mk, winnerSide]) => {
      const x = m[mk];
      if (!x.recorded) return;
      const hitA = x.a === c.a || x.b === c.a;
      const hitB = x.a === c.b || x.b === c.b;
      if (hitA === hitB) return; // both or neither: it says nothing about this semifinal
      const played = hitA ? c.a : c.b;
      says.push(winnerSide ? played : (played === c.a ? c.b : c.a));
    });
    vouch[k] = says.length && says.every((x) => x === says[0]) ? says[0] : '';
  });
  let recheck = null;
  const bad = ['third', 'final'].filter((k) => m[k].recorded && !m[k].fits);
  if (bad.length) {
    const semi = ['s1', 's2'].find((k) => vouch[k] && vouch[k] !== m[k].winner) || null;
    recheck = { match: bad[0], semi, now: semi ? m[semi].winner : '', was: semi ? vouch[semi] : null };
  }
  return { m, recheck, vouch };
}

// Where a bracket is: 's1' | 's2' | 'third' | 'final' (the match waiting for a winner), 'summary' (all four decided),
// 'recheck' (a recorded match disagrees with its semifinals: nothing more is recorded until it is settled) or 'broken'.
function fourPhase(b, ids) {
  const v = fourRead(b, ids);
  if (!v) return 'broken';
  if (v.recheck) return 'recheck';
  return FOUR_ORDER.find((k) => !v.m[k].winner) || 'summary';
}

// The match waiting for a winner, { key, a, b } (both teams are known: the order never reaches a match before its teams), or null.
function fourCurrent(b, ids) {
  const v = fourRead(b, ids);
  if (!v || v.recheck) return null;
  const k = FOUR_ORDER.find((x) => !v.m[x].winner);
  return k ? { key: k, a: v.m[k].a, b: v.m[k].b } : null;
}

// The match after the current one, { key, a, b } with '' for a team not decided yet (the 3rd-place match while the second
// semifinal is on), or null when the current one is the last.
function fourNext(b, ids) {
  const v = fourRead(b, ids);
  if (!v || v.recheck) return null;
  const at = FOUR_ORDER.findIndex((x) => !v.m[x].winner);
  const k = at === -1 ? undefined : FOUR_ORDER[at + 1];
  return k ? { key: k, a: v.m[k].a, b: v.m[k].b } : null;
}

// Two pairs that can start a four-team bracket: exactly two pairs, four different teams of this camp.
function fourPairsValid(pairs, ids) {
  if (!Array.isArray(pairs) || pairs.length !== 2 || !Array.isArray(ids) || ids.length !== 4) return false;
  const flat = [].concat(...pairs.map((p) => (Array.isArray(p) && p.length === 2 ? p : [])));
  return flat.length === 4 && flat.every((t) => ids.indexOf(t) !== -1) && new Set(flat).size === 4;
}

// How a game's semifinals are chosen, from its Matchups setting (the game sheet's choice, read the way it reads it):
// 'standings' (best v worst, second v third), 'fixed' (the pairs saved with the game), or 'pick' (the director picks both pairs).
function fourSeedMode(g, ids) {
  const kinds = ['standings', 'pick', 'fixed'];
  const fixed = fourPairsValid(g && g.roundOneMatchups, ids);
  if (g && kinds.indexOf(g.bracketSeed) !== -1 && (g.bracketSeed !== 'fixed' || fixed)) return g.bracketSeed;
  return fixed ? 'fixed' : 'pick';
}

// The two semifinals a mode suggests, [[a, b], [c, d]], or null (a pick has none; 'standings' needs the four teams ranked, best
// first, which only a director with confirmed points has). Ties are the caller's: `ranked` already breaks them (golds, silvers,
// bronzes, then the roster's order).
function fourSeeds(mode, g, ranked, ids) {
  if (mode === 'fixed') return fourPairsValid(g && g.roundOneMatchups, ids) ? g.roundOneMatchups.map((p) => p.slice()) : null;
  if (mode === 'standings') {
    const r = (Array.isArray(ranked) ? ranked : []).filter((t, i, a) => ids.indexOf(t) !== -1 && a.indexOf(t) === i);
    return r.length === 4 ? [[r[0], r[3]], [r[1], r[2]]] : null;
  }
  return null;
}

// A new four-team bracket from two pairs (null when they cannot start one).
function fourStart(pairs, ids, now) {
  if (!fourPairsValid(pairs, ids)) return null;
  return { at: Number(now) > 0 ? Number(now) : Date.now(), m: { s1: { a: pairs[0][0], b: pairs[0][1] }, s2: { a: pairs[1][0], b: pairs[1][1] } } };
}

// Record the winner of the match that is waiting. Refuses (and changes nothing) with a reason: 'broken' | 'recheck' | 'match' (not
// one of the four) | 'decided' (a stale second tap, or another ref got there first: the winner is NOT overwritten; says which match
// and who won it) | 'summary' |
// 'order' (it is not this match's turn) | 'winner' (not one of the two teams). A recorded third / final stores the two teams that
// played it next to the winner; a semifinal keeps the seeds it was created with.
function fourRecord(b, key, winner, ids, now) {
  const v = fourRead(b, ids);
  if (!v) return { ok: false, reason: 'broken' };
  if (v.recheck) return { ok: false, reason: 'recheck' };
  if (FOUR_ORDER.indexOf(key) === -1) return { ok: false, reason: 'match' };
  if (v.m[key].winner) return { ok: false, reason: 'decided', match: key, winner: v.m[key].winner };
  const cur = fourCurrent(b, ids);
  if (!cur) return { ok: false, reason: 'summary' };
  if (cur.key !== key) return { ok: false, reason: 'order' };
  if (winner !== cur.a && winner !== cur.b) return { ok: false, reason: 'winner' };
  const at = Number(now) > 0 ? Number(now) : Date.now();
  if (key === 's1' || key === 's2') { b.m[key].winner = winner; b.m[key].at = at; }
  else b.m[key] = { a: cur.a, b: cur.b, winner, at };
  return { ok: true, match: key, a: cur.a, b: cur.b, winner };
}

// Take the most recently recorded match back (the last one in play order — a phone's clock does not decide it) and say which; null
// when nothing is recorded. A semifinal keeps its seeds, a 3rd-place match or final is removed.
function fourUndo(b, ids) {
  const v = fourRead(b, ids);
  if (!v) return null;
  const k = FOUR_ORDER.slice().reverse().find((x) => v.m[x].recorded);
  if (!k) return null;
  if (k === 's1' || k === 's2') { delete b.m[k].winner; delete b.m[k].at; }
  else delete b.m[k];
  return k;
}

// The podium of a finished bracket: gold wins the final, silver loses it, bronze wins the 3rd-place match — or null unless all four
// matches are recorded AND agree (a bracket that is waiting on a re-check never pays out a medal).
function fourMedals(b, ids) {
  const v = fourRead(b, ids);
  if (!v || v.recheck || !v.m.third.recorded || !v.m.final.recorded) return null;
  const f = v.m.final;
  return { gold: f.winner, silver: f.winner === f.a ? f.b : f.a, bronze: v.m.third.winner };
}

// Settle a re-check (the two buttons). 'keep': the semifinals stand as they are now and every later match that was played on the old
// ones is thrown out to be replayed. 'back': the semifinal(s) go back to who the later matches were played with. Returns true when
// the bracket is consistent afterwards, false (nothing changed) when there was nothing to settle, the choice is not one, or putting it
// back would not make it agree (the later matches contradict each other).
function fourResolve(b, choice, ids, now) {
  const v = fourRead(b, ids);
  if (!v || !v.recheck) return false;
  if (choice === 'keep') {
    ['third', 'final'].forEach((k) => { if (v.m[k].recorded && !v.m[k].fits) delete b.m[k]; });
    return true;
  }
  if (choice !== 'back') return false;
  const at = Number(now) > 0 ? Number(now) : Date.now();
  const next = JSON.parse(JSON.stringify(b.m));
  ['s1', 's2'].forEach((k) => { if (v.vouch[k] && v.vouch[k] !== v.m[k].winner) { next[k].winner = v.vouch[k]; next[k].at = at; } });
  const after = fourRead({ m: next }, ids);
  if (!after || after.recheck) return false;
  b.m = next;
  return true;
}

// The finished bracket as it is kept on the result (results[gid].path, so a later "Clear result" can reopen the final): only
// laundered fields, every team a roster id.
function fourPath(b, ids) {
  const v = fourRead(b, ids);
  if (!v) return null;
  const out = { at: Number(b.at) > 0 ? Number(b.at) : 0, m: {} };
  FOUR_ORDER.forEach((k) => {
    const c = v.m[k];
    if (!c.recorded && k !== 's1' && k !== 's2') return;
    const o = { a: c.a, b: c.b };
    if (c.winner) { o.winner = c.winner; if (c.at) o.at = c.at; }
    out.m[k] = o;
  });
  return out;
}

// ── The four-team bracket on the page's state (effects) ──────────────────────────────────────────
// What a tap does: check the person may (a director; not on a team in the match: canScoreRound), check the bracket still says what the
// screen said (a result already saved, a match already recorded: ignored and said), change it through the pure rules above, then touch the
// data, save and repaint exactly as the six-team wizard's handlers do. Each returns { ok } or { ok: false, reason } for the toast.
function fourBracketOf(g) {
  const b = g && state.brackets4 ? state.brackets4[g.id] : null;
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

// Is this game's four-team bracket finished and consistent, so its result can be saved (the summary screen)? Never for a game whose
// result is saved, or a camp that plays the six-team wizard.
function fourReadyToSave(g) {
  if (!g || g.format !== 'tournament' || (state.results && state.results[g.id]) || bracketKindFor(teamIds().length) !== 'four') return false;
  const b = fourBracketOf(g);
  return !!b && fourPhase(b, teamIds()) === 'summary';
}

// The semifinals the Start card offers: { mode, pairs } — pairs null for a free pick, and for "by the standings" on a screen with no
// confirmed points (never the zeros medalCounts returns to a hint-painted device: the same rule as the six-team suggestion).
function fourSeedPlan(g) {
  const ids = teamIds();
  const mode = fourSeedMode(g, ids);
  if (mode === 'fixed') return { mode, pairs: fourSeeds(mode, g, [], ids) };
  if (mode === 'standings' && canEdit() && standingsVisible()) {
    return { mode, pairs: fourSeeds(mode, g, rankTeamsByPoints(medalCounts()).map((t) => t.id), ids) };
  }
  return { mode, pairs: null };
}

function fourStartGame(g, pairs) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  const n = teamIds().length;
  if (bracketKindFor(n) !== 'four') return { ok: false, reason: 'teams', count: n };
  if (state.results[g.id]) return { ok: false, reason: 'saved' };
  if (fourBracketOf(g)) return { ok: false, reason: 'started' };
  const b = fourStart(pairs, teamIds(), serverNow());
  if (!b) return { ok: false, reason: 'pairs' };
  if (!state.brackets4) state.brackets4 = {};
  state.brackets4[g.id] = b;
  clearLiveMatch(g); // a new bracket starts with a clean tally
  saveState();
  renderAll();
  return { ok: true };
}

function fourRecordTap(g, key, winner) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  if (state.results[g.id]) return { ok: false, reason: 'saved' }; // a late tap after the result was saved: ignored
  const b = fourBracketOf(g);
  if (!b) return { ok: false, reason: 'none' };
  const v = fourRead(b, teamIds());
  const c = v && v.m[key];
  if (c && !canScoreRound(c.a, c.b)) return { ok: false, reason: 'team' };
  const r = fourRecord(b, key, winner, teamIds(), serverNow());
  if (!r.ok) return r;
  touchData();
  saveState();
  renderAll();
  return r;
}

function fourUndoTap(g) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  if (state.results[g.id]) return { ok: false, reason: 'saved' };
  const b = fourBracketOf(g);
  if (!b) return { ok: false, reason: 'none' };
  const v = fourRead(b, teamIds());
  const last = v ? FOUR_ORDER.slice().reverse().find((k) => v.m[k].recorded) : null;
  if (last && !canScoreRound(v.m[last].a, v.m[last].b)) return { ok: false, reason: 'team' };
  const k = fourUndo(b, teamIds());
  if (!k) return { ok: false, reason: 'none' };
  touchData();
  saveState();
  renderAll();
  return { ok: true, match: k };
}

function fourResolveTap(g, choice) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  if (state.results[g.id]) return { ok: false, reason: 'saved' };
  const b = fourBracketOf(g);
  if (!b) return { ok: false, reason: 'none' };
  if (!fourCanResolve(fourRead(b, teamIds()))) return { ok: false, reason: 'team' };
  if (!fourResolve(b, choice, teamIds(), serverNow())) return { ok: false, reason: 'unresolved' };
  touchData();
  saveState();
  renderAll();
  return { ok: true };
}

// Save Result: the podium of a consistent, finished bracket becomes the game's result — the same record, and so the same medalCounts,
// as a six-team bracket's — with the finished bracket kept on it as `path`.
function fourSaveResult(g) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  if (state.results[g.id]) return { ok: false, reason: 'saved' };
  const b = fourBracketOf(g);
  if (!b) return { ok: false, reason: 'none' };
  const medals = fourMedals(b, teamIds());
  if (!medals) return { ok: false, reason: 'unfinished' };
  finishBracket(g, 'four', medals, fourPath(b, teamIds()));
  return { ok: true, medals };
}

// The matches a Re-check answer decides again, as [a, b] pairs: the semifinal that changed and every later match that is thrown out or
// whose winner is put back. A director whose own team played one of them leaves the answer to another (canScoreRound, as Undo does).
function fourResolveTeams(v) {
  if (!v || !v.recheck) return [];
  const keys = [];
  if (v.recheck.semi) keys.push(v.recheck.semi);
  ['third', 'final'].forEach((k) => { if (v.m[k].recorded && !v.m[k].fits) keys.push(k); });
  ['s1', 's2'].forEach((k) => { if (v.vouch[k] && v.vouch[k] !== v.m[k].winner && keys.indexOf(k) === -1) keys.push(k); });
  return keys.map((k) => [v.m[k].a, v.m[k].b]);
}

function fourCanResolve(v) {
  return fourResolveTeams(v).every((pair) => canScoreRound(pair[0], pair[1]));
}

// Brackets that need a director's eye, for Set up the week's Games row and screen: `late` — a bracket node still under a game whose
// result is saved (a phone that had not heard yet recorded a match: the engine and every reader ignore it, a new Start replaces it,
// and Discard removes it); `recheck` — a four-team bracket waiting on a re-check (a recorded match disagrees with its semifinals).
// Plain data over state, never throws: [{ id, name }].
function bracketNotes() {
  const out = { late: [], recheck: [] };
  const ids = teamIds();
  allGames().forEach((g) => {
    if (!g || g.format !== 'tournament') return;
    const name = String(g.name || '').trim() || 'A game';
    const six = state.brackets && state.brackets[g.id];
    const four = state.brackets4 && state.brackets4[g.id];
    if (state.results && state.results[g.id]) {
      if ((six && typeof six === 'object') || (four && typeof four === 'object')) out.late.push({ id: g.id, name });
    } else if (four) {
      const v = fourRead(four, ids);
      if (v && v.recheck) out.recheck.push({ id: g.id, name });
    }
  });
  return out;
}

// Discard what a late tap left under a game whose result is saved. Only while that is what is there: the result is untouched.
function discardLateBracket(gid) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  if (!(state.results && state.results[gid])) return { ok: false, reason: 'none' };
  if (!dropBracketNodes(gid)) return { ok: false, reason: 'none' };
  saveState();
  renderAll();
  return { ok: true };
}

// Reopen the final: a saved four-team result keeps the finished bracket (results[gid].path), so "Change the result" can put it back
// as a bracket to play on, with the final thrown out and every other match as it was, instead of only clearing everything. null when
// the result carries no bracket this build can read and call consistent (a six-team result, a podium game, an older record).
function fourReopenBracket(result, ids) {
  const v = result && fourRead(result.path, ids);
  if (!v || v.recheck || !v.m.final.recorded || !v.m.third.recorded) return null;
  const p = fourPath(result.path, ids);
  delete p.m.final;
  return fourPhase(p, ids) === 'final' ? p : null;
}

// Is there a finished bracket on this game's result that a director could reopen, whoever that director is? (The dialog says why a
// director whose own team played the final is not offered it.)
function fourHasReopenable(g) {
  return !!(g && canEdit() && g.format === 'tournament' && state.results && state.results[g.id] && bracketKindFor(teamIds().length) === 'four' &&
    fourReopenBracket(state.results[g.id], teamIds()));
}

// Reopening the final decides the final again, so, as Undo, it is left to a director whose own team did not play it.
function fourReopenOwnTeam(g) {
  if (!fourHasReopenable(g)) return false;
  const f = fourRead(state.results[g.id].path, teamIds()).m.final;
  return !canScoreRound(f.a, f.b);
}

function fourCanReopen(g) {
  return fourHasReopenable(g) && !fourReopenOwnTeam(g);
}

// Reopen the final: the result comes off (its points leave the standings until it is saved again) and the bracket is back at the
// final, for everyone, in one write. Whatever a late tap left under the game's bracket is replaced.
function fourReopen(g) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  const b = state.results && state.results[g.id] ? fourReopenBracket(state.results[g.id], teamIds()) : null;
  if (!b) return { ok: false, reason: 'none' };
  if (fourReopenOwnTeam(g)) return { ok: false, reason: 'team' };
  delete state.results[g.id];
  if (!state.brackets4) state.brackets4 = {};
  state.brackets4[g.id] = b;
  clearLiveMatch(g);
  touchData();
  saveState();
  renderAll();
  return { ok: true };
}

// Realtime Database can't represent "present but empty" for arrays/nulls —
// it prunes those keys on write, so a bracket round-tripped through sync
// can come back missing matches/selectedPair/etc. This restores a safe,
// well-formed shape in place, whatever the source (sync, storage, or a
// bug) actually handed us.
// The six-team wizard's phases, and the fields only it writes. A bracket this
// build doesn't understand — a `kind` it has never heard of (the 4-team bracket
// lives under its own node, `brackets4`, with its own reader fourRead: a record
// of its shape that strays in here is not a six-team bracket), a phase it
// can't place, or keys with none of the six-team fields — must be left EXACTLY
// as found: healing would stamp round1/pool/matches onto it and the next push
// would write that over another version's bracket on every device. A truly
// empty object is still just a bracket RTDB pruned bare, and heals as before.
//
// The two lists are LOCAL on purpose: normalizeSyncedState runs at script load
// (a device with a bracket in its cache calls this before a top-level `const`
// further down this file has been initialised — a TDZ crash at boot).
function bracketKnown(b) {
  const phases = ['round1', 'bye', 'semifinal', 'championship', 'summary'];
  const fields = ['phase', 'pool', 'selectedPair', 'matches', 'byeTeamId', 'semifinal', 'championship'];
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  if (b.kind !== undefined) return false;
  if (b.phase !== undefined && phases.indexOf(b.phase) < 0) return false;
  const keys = Object.keys(b);
  return !keys.length || keys.some((k) => fields.indexOf(k) >= 0);
}

// The card shown in place of a bracket this build can't read — no controls
// that write, no throw. The button is a plain reload, not a state write.
//
// Reloading only helps when the bracket really is from a newer build. A bracket
// that is simply garbage (a hand-edited console value, a bad import) would
// otherwise be console-only to remove, so an EDITOR also gets a confirmed
// "Clear this bracket" (the same delete as Cancel this bracket).
function unknownBracketHtml() {
  return `
    <h3>Run the bracket</h3>
    <p class="tie-note">⚠️ This bracket needs the newest version — pull down to reload. Nothing here can change it until you do. <button type="button" class="link-btn" id="bracket-reload-btn">Reload now</button></p>
    ${canEdit() ? '<div class="wizard-footer"><button type="button" class="link-btn danger-link" id="bracket-clear-btn">Clear this bracket</button></div>' : ''}
  `;
}

function wireUnknownBracketCard(container, g) {
  const btn = container.querySelector('#bracket-reload-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (reloadBlocked() && !confirm('You have something unfinished here (an unsent message, a score being typed, or a running timer). Reload anyway?')) return;
    doReload();
  });
  const clear = container.querySelector('#bracket-clear-btn');
  if (clear && g) {
    clear.addEventListener('click', () => {
      if (!canEdit()) return;
      if (!confirm('Clear this bracket for everyone? Reload first if a newer version might be able to read it — clearing deletes it on every phone and cannot be undone.')) return;
      cancelBracket(g, 'six');
    });
  }
}

function normalizeBracket(b) {
  if (!bracketKnown(b)) return b; // see bracketKnown: never heal what we can't read
  if (!Array.isArray(b.pool)) b.pool = [];
  if (!Array.isArray(b.selectedPair)) b.selectedPair = [];
  if (!Array.isArray(b.matches)) b.matches = [];
  if (!b.phase) b.phase = 'round1';
  if (b.byeTeamId === undefined) b.byeTeamId = null;
  if (b.semifinal === undefined) b.semifinal = null;
  if (b.championship === undefined) b.championship = null;
  return b;
}

// Same guarantee for a Pictionary drawing round: a fresh round is
// { laps: [], done: false }, and RTDB prunes the empty laps array.
function normalizePicRound(r) {
  if (!Array.isArray(r.laps)) r.laps = [];
  r.done = !!r.done;
  return r;
}

// And for a score-entry draft: { scores: {}, medals: {} } — either side
// can be empty (and thus pruned) while the other has data.
function normalizeDraft(d) {
  if (!d.scores) d.scores = {};
  if (!d.medals) d.medals = {};
  return d;
}

// A live match tally: { key, inning, hr: {teamId: n} }. RTDB prunes an
// empty hr map and a 0/absent inning, so heal them after a round-trip.
function normalizeLiveMatch(l) {
  if (l && l.mode === 'ladder') {
    // Ladder Ball match: running totals + this-round raw points + a round log
    // for undo. RTDB prunes zeros/empty arrays, so coerce everything back.
    if (typeof l.a !== 'number' || l.a < 0) l.a = 0;
    if (typeof l.b !== 'number' || l.b < 0) l.b = 0;
    if (typeof l.ra !== 'number' || l.ra < 0) l.ra = 0;
    if (typeof l.rb !== 'number' || l.rb < 0) l.rb = 0;
    if (!Array.isArray(l.log)) l.log = [];
    return l;
  }
  if (!l.hr) l.hr = {};
  if (typeof l.inning !== 'number' || l.inning < 1) l.inning = 1;
  if (typeof l.outs !== 'number' || l.outs < 0) l.outs = 0;
  if (l.half !== 1) l.half = 0; // 0 = first team kicking, 1 = second team
  return l;
}

// One sweep over every synced shape that can carry pruned-empty fields.
// Called after loading from localStorage and after every remote merge.
function normalizeSyncedState() {
  Object.values(state.brackets || {}).forEach(normalizeBracket);
  // The four-team bracket's own node. RTDB prunes an empty map to nothing, and a stored value that is not an object under a
  // game id is somebody's junk (the rules only make the node itself a branch): normalizeBracket4 leaves what it cannot read.
  if (!state.brackets4 || typeof state.brackets4 !== 'object' || Array.isArray(state.brackets4)) state.brackets4 = {};
  Object.values(state.brackets4).forEach(normalizeBracket4);
  Object.values(state.picRounds || {}).forEach(normalizePicRound);
  Object.values(state.drafts || {}).forEach(normalizeDraft);
  if (!state.bonuses) state.bonuses = {}; // RTDB prunes an empty ledger to nothing
  if (!state.picSetup) state.picSetup = {}; // RTDB prunes an empty map to nothing
  // RTDB can round-trip a sparse `words` array back as an object — re-array it.
  Object.values(state.picSetup).forEach((s) => {
    if (!s) return;
    if (Array.isArray(s.words)) return;
    if (s.words && typeof s.words === 'object') {
      const arr = [];
      Object.keys(s.words).forEach((k) => { arr[+k] = s.words[k]; });
      s.words = arr;
    } else {
      s.words = [];
    }
  });
  if (!state.live) state.live = {}; // RTDB prunes an empty live map to nothing
  Object.values(state.live).forEach(normalizeLiveMatch);
  if (!state.clocks) state.clocks = {}; // RTDB prunes an empty clocks map to nothing
  if (!state.announcements) state.announcements = {}; // RTDB prunes an empty map to nothing
  // The notice board: RTDB prunes its empty arrays/strings, and an absent
  // notice means this database has never had one — normalizeNotice seeds the
  // example draft in that case (never a posted card).
  normalizeNotice();
  if (!state.meta) state.meta = {}; // RTDB prunes an all-defaults meta to nothing
  // Un-hiding every card empties hiddenCards, which RTDB then prunes away —
  // heal it so the switches and applyCardVisibility always read a real map.
  if (!state.meta.hiddenCards || typeof state.meta.hiddenCards !== 'object') state.meta.hiddenCards = {};
  // Migrate rosters saved before names/counselors were set: swap generic
  // "Team N" names and placeholder counselors for the real roster values.
  // Anything hand-edited (not matching a known placeholder) is left alone.
  // LEGACY WEEK ONLY: this runs on every remote merge, and a director who has
  // since named a team "Team 4" (or any old placeholder) on purpose would have
  // it swapped back to a 2026 team name. Once a new-year epoch exists
  // (state.meta.epoch, stamped by the setup wizard) the roster is the
  // directors' own and is never "migrated". A no-op until that ships.
  // A phone whose stored "which one are you?" answer is an old spelling
  // ("Lilly") is moved onto the merged one ("Lily") so its electives still
  // resolve. Device-local, so nothing here is synced; persisted by the next save.
  if (typeof state.identity === 'string') {
    const canon = canonicalCounselorName(state.identity);
    if (canon !== state.identity) state.identity = canon;
  }
  const legacyWeek = !state.meta.epoch;
  (state.teams || []).forEach((t, i) => {
    if (!legacyWeek) {
      // RTDB prunes an empty counselor string; read it back as '' (never as a
      // 2026 name).
      if (t.counselor === undefined) t.counselor = '';
      return;
    }
    const legacy = legacyRosterFor(i);
    if (legacy.oldNames && legacy.oldNames.indexOf(t.name) !== -1 && legacy.name) {
      t.name = legacy.name;
    }
    if (t.counselor === undefined || t.counselor === legacy.oldCounselor) {
      t.counselor = legacy.counselor || '';
    }
  });
}

function renderTournament(container, g) {
  // Four teams (senior) play the four-team bracket, which has its own node and its own screens (below).
  if (bracketKindFor(teamIds().length) === 'four') { renderBracketFour(container, g); return; }
  // A bracket from a newer build: show the reload card, write nothing, throw
  // nothing (see bracketKnown).
  if (state.brackets[g.id] && !bracketKnown(state.brackets[g.id])) {
    if (setLiveHtmlIfChanged(container, unknownBracketHtml(), [g])) wireUnknownBracketCard(container, g);
    return;
  }
  if (!state.brackets[g.id]) {
    // The bracket wizard's phases (3 first-round matches → bye → semifinal →
    // championship) assume exactly 6 teams; with any other count it saves
    // corrupt results. Block starting rather than corrupting.
    // Both cards are static, so an idle render leaves them be (the Start
    // button used to be rebuilt on every snapshot). The listener holds only
    // the game.
    if (state.teams.length !== 6) {
      setLiveHtmlIfChanged(container, `
        <h3>Run the bracket</h3>
        <p class="tie-note">⚠️ The bracket wizard needs exactly 6 teams — you have ${state.teams.length}. Adjust the roster in More → Set up the week, or switch this game to another format.</p>
      `, [g]);
      return;
    }
    if (setLiveHtmlIfChanged(container, `
      <h3>Run the bracket</h3>
      <p class="muted">Three first-round matches, then the medal round. The bye goes to the Round&nbsp;1 winner with the fewest points this week — the app suggests who, using the live standings.</p>
      <jelly-button id="start-bracket-btn" class="primary-btn" block>Start Bracket</jelly-button>
    `, [g])) {
      document.getElementById('start-bracket-btn').addEventListener('click', () => {
        state.brackets[g.id] = freshBracket();
        clearLiveMatch(g); // a new bracket starts with a clean tally
        saveState();
        renderAll();
      });
    }
    return;
  }

  // A started bracket is rebuilt on every render — its sub-views close over the
  // bracket object and build in several writes — so forget the key the static
  // cards above (and the other entry forms) compare against: the markup it
  // describes is about to be replaced under it.
  container.__liveKey = null;
  const b = normalizeBracket(state.brackets[g.id]);
  let html = `<div class="bracket-steps">
    ${['round1', 'bye', 'semifinal', 'championship', 'summary'].map((p, i) => {
      const labels = { round1: 'Round 1', bye: 'Bye', semifinal: 'Championship', championship: 'Final', summary: 'Results' };
      const order = ['round1', 'bye', 'semifinal', 'championship', 'summary'];
      const cls = p === b.phase ? 'active' : order.indexOf(p) < order.indexOf(b.phase) ? 'done' : '';
      return `<span class="wizard-step ${cls}">${labels[p]}</span>${i < 4 ? '<span class="wizard-step-arrow">→</span>' : ''}`;
    }).join('')}
  </div><div id="bracket-body"></div>
  <div class="wizard-footer"><button id="cancel-bracket-btn" class="link-btn danger-link">Cancel this bracket</button></div>`;
  container.innerHTML = html;

  document.getElementById('cancel-bracket-btn').addEventListener('click', () => {
    if (!confirm('Cancel this bracket? Nothing will be saved.')) return;
    cancelBracket(g, 'six');
  });

  const body = document.getElementById('bracket-body');
  if (b.phase === 'round1') renderBracketRound1(body, g, b);
  else if (b.phase === 'bye') renderBracketBye(body, g, b);
  else if (b.phase === 'semifinal') renderBracketSemifinal(body, g, b);
  else if (b.phase === 'championship') renderBracketChampionship(body, g, b);
  else renderBracketSummary(body, g, b);
}

// ── Live match scorekeeper (innings + per-team tally) ────────────
// The ref taps the innings/tally as a match runs; it's synced like the rest
// of the scoreboard (state.live in SYNC_KEYS) so anyone with the app open —
// counselors or spectators — watches it update in real time, with
// localStorage as the offline backup. Keyed by game + matchup, so moving to
// the next matchup starts a fresh tally.

function getLiveMatch(g, aId, bId) {
  const key = [aId, bId].join('|');
  const l = state.live && state.live[g.id];
  if (l && l.key === key) {
    return { key, inning: Number(l.inning) || 1, outs: Number(l.outs) || 0, half: l.half === 1 ? 1 : 0, hr: Object.assign({}, l.hr) };
  }
  return { key, inning: 1, outs: 0, half: 0, hr: {} };
}

// opts.celebrate: only a goal going UP is worth confetti (see touchData).
function setLiveMatch(g, l, opts) {
  if (!state.live) state.live = {};
  state.live[g.id] = { key: l.key, inning: Number(l.inning) || 1, outs: Number(l.outs) || 0, half: l.half === 1 ? 1 : 0, hr: l.hr || {} };
  touchData({ celebrate: !!(opts && opts.celebrate) });
  saveState();
}

function clockRemaining(clock) {
  if (!clock) return 0;
  // serverNow(), not Date.now() — endAt was written against the server's clock
  // by whichever device started the timer (see the serverNow comment).
  if (clock.running) return Math.max(0, (Number(clock.endAt) || 0) - serverNow());
  return Math.max(0, Number(clock.remaining) || 0);
}

function defaultClock(g) {
  const secs = (g.timer && g.timer.presets && g.timer.presets[0]) || 600;
  return { running: false, endAt: 0, remaining: secs * 1000, duration: secs * 1000, round: 1 };
}

// ── Per-game synced clock ────────────────────────────────────────
// One clock per game, stored in the synced `clocks` map (SYNC_KEYS) — so every
// device (refs and spectators) sees the same countdown and it survives bracket
// matchup changes (keyed by game, not by pairing, unlike the old match clock).
// Only endAt + running sync; each device computes remaining locally, so a
// running clock writes nothing to the network. Used by the standalone
// game-clock box AND, for live-tracker games, the Big Board clock.
function getClock(g) {
  const c = state.clocks && state.clocks[g.id];
  if (c && typeof c.duration === 'number') {
    return {
      running: !!c.running,
      endAt: Number(c.endAt) || 0,
      remaining: Number(c.remaining) || 0,
      duration: Number(c.duration) || 0,
      round: Number(c.round) || 1,
    };
  }
  return defaultClock(g);
}

function setClock(g, mutate) {
  if (!state.clocks) state.clocks = {};
  const clock = getClock(g);
  mutate(clock);
  state.clocks[g.id] = clock;
  // Running a clock isn't scoreboard data: no footer stamp, no confetti (this
  // is also the buzzer's settle path). Still guarded until pushed.
  touchData({ stamp: false, celebrate: false });
  saveState();
}

// Apply a clock control action (start / pause / reset / preset) and re-render.
// Shared by the standalone game clock and the Big Board clock so both behave
// identically.
function applyClockAction(g, act, secs) {
  if (act === 'start') getAudio(); // unlock audio while we have the user gesture
  setClock(g, (c) => {
    if (act === 'start') {
      if (clockRemaining(c) === 0) {
        // Restart from full. Also drop `running`: a clock stuck running at 0:00
        // would otherwise still read its (past) endAt and restart already
        // expired.
        c.running = false;
        c.remaining = c.duration;
      }
      c.endAt = serverNow() + clockRemaining(c); // absolute, on the shared clock
      c.running = true;
    } else if (act === 'pause') {
      c.remaining = clockRemaining(c);
      c.running = false;
    } else if (act === 'reset') {
      cutAllSound();
      c.running = false;
      c.remaining = c.duration;
    } else if (act === 'preset') {
      c.duration = (Number(secs) || 600) * 1000;
      c.remaining = c.duration;
      c.running = false;
    } else if (act === 'next-round') {
      cutAllSound();
      c.running = false;
      c.round = (Number(c.round) || 1) + 1;
      c.remaining = c.duration;
    }
  });
  if (act === 'start') requestWakeLock();
  else if (!wakeLockNeeded()) releaseWakeLock();
  renderAll();
}

// Standalone game clock for games WITHOUT a live tracker (the tracker games
// show their clock on the Big Board instead). Everyone sees it tick; only
// editors get the Start/Pause/Reset controls and preset chips.
function clockBlockHTML(g) {
  const clock = getClock(g);
  const remaining = clockRemaining(clock);
  const viewer = !canEdit();
  const onLastRound = !g.timer.rounds || clock.round >= g.timer.rounds;
  const roundLabel = g.timer.rounds ? `<div class="round-label">Round ${clock.round} of ${g.timer.rounds}</div>` : '';
  const live = clockLive(clock); // not merely `running` — see clockLive
  const presets = (!viewer && !live && (g.timer.presets || []).length > 1)
    ? `<div class="preset-row">${g.timer.presets.map((p) =>
        `<button class="preset-chip ${clock.duration === p * 1000 ? 'selected' : ''}" data-clock="preset" data-secs="${p}">${fmtBoardClock(p * 1000)}</button>`).join('')}</div>`
    : '';
  let mainBtn;
  if (live) {
    mainBtn = '<button class="timer-main-btn" data-clock="pause">⏸ Pause</button>';
  } else if (remaining === 0 && !onLastRound) {
    mainBtn = '<button class="timer-main-btn" data-clock="next-round">Next round →</button>';
  } else {
    mainBtn = `<button class="timer-main-btn" data-clock="start">▶ ${remaining === clock.duration ? 'Start' : remaining === 0 ? 'Restart' : 'Resume'}</button>`;
  }
  const controls = viewer ? '' : `
    ${presets}
    <div class="board-clock-btns">
      ${mainBtn}
      ${remaining !== clock.duration ? '<button class="timer-side-btn" data-clock="reset">↺ Reset</button>' : ''}
    </div>`;
  return `<div class="tool-box game-clock-box ${remaining === 0 ? 'alarming' : ''}" data-tool="game-clock">
    <div class="tool-label">⏱️ ${esc(g.timer.label || 'Game clock')}</div>
    ${roundLabel}
    <div class="big-clock board-clock ${remaining === 0 ? 'board-clock-zero' : ''}" data-game-clock data-game-id="${esc(g.id)}">${fmtBoardClock(remaining)}</div>
    ${controls}
  </div>`;
}

function bindClock(container, g) {
  container.querySelectorAll('[data-tool="game-clock"] [data-clock]').forEach((btn) => {
    btn.addEventListener('click', () => applyClockAction(g, btn.dataset.clock, btn.dataset.secs));
  });
}

// ── Ladder Ball match (per-round cancellation, first to exactly 21) ──
// Same live/synced model as the kickball tracker, but a different shape:
// running totals a/b, this-round raw points ra/rb, and a log of scored rounds
// for undo. Keyed by matchup so a new pairing starts fresh.
function getLadderMatch(g, aId, bId) {
  const key = [aId, bId].join('|');
  const l = state.live && state.live[g.id];
  if (l && l.mode === 'ladder' && l.key === key) {
    return { key, mode: 'ladder', a: Number(l.a) || 0, b: Number(l.b) || 0, ra: Number(l.ra) || 0, rb: Number(l.rb) || 0, log: Array.isArray(l.log) ? l.log.slice() : [] };
  }
  return { key, mode: 'ladder', a: 0, b: 0, ra: 0, rb: 0, log: [] };
}

// opts.celebrate: rungs and a scored round are points; a clear or an undo isn't.
function setLadderMatch(g, l, opts) {
  if (!state.live) state.live = {};
  state.live[g.id] = { key: l.key, mode: 'ladder', a: Number(l.a) || 0, b: Number(l.b) || 0, ra: Number(l.ra) || 0, rb: Number(l.rb) || 0, log: Array.isArray(l.log) ? l.log : [] };
  touchData({ celebrate: !!(opts && opts.celebrate) });
  saveState();
}

// The team id that has reached the target (won), or null. Overshoot holds, so
// totals never exceed the target, but >= keeps this robust.
function ladderWinnerId(g, l, aId, bId) {
  const target = (g.ladderScoring && g.ladderScoring.target) || 21;
  if (l.a >= target) return aId;
  if (l.b >= target) return bId;
  return null;
}

// The team currently kicking, given the half (0 = first team, 1 = second).
function kickingTeamId(l, aId, bId) {
  return (Number(l.half) || 0) === 1 ? bId : aId;
}

// "2 outs" / "1 out" / "0 outs"
function outsLabel(n) {
  return `${n} out${n === 1 ? '' : 's'}`;
}

// Filled/empty pips for the outs display, e.g. ●●○ for 2 of 3.
function outsPips(n, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < n ? '●' : '○';
  return s;
}

function clearLiveMatch(g) {
  if (state.live && state.live[g.id]) {
    delete state.live[g.id];
    saveState();
  }
}

// ── The Big Board ────────────────────────────────────────────────
// One joyful scoreboard for live-tracked matches: giant scores, the match
// clock right beneath them (synced — spectators see it tick), and a burst
// of team-emoji confetti when a goal goes up. Editors get steppers and
// clock controls on the same card; viewers get the same board, display
// only, sized to fill over half the screen.

// Last rendered scores per game+matchup, so a score that went UP —
// whether tapped here or arriving over sync — triggers the celebration.
let lastBoardScores = {};

function fmtBoardClock(ms) {
  const s = Math.ceil(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// GOAL! Pop the scoring team's number and fire the emoji cannons: two
// volleys from the board's bottom corners arcing up and across, mixing the
// team's mascot with party emoji.
function boardCelebrate(boardEl, teamId) {
  if (!boardEl) return;
  const col = boardEl.querySelector(`[data-board-col="${teamId}"]`);
  const val = col && col.querySelector('.board-score');
  if (val) {
    val.classList.remove('score-pop');
    void val.offsetWidth; // restart the animation
    val.classList.add('score-pop');
  }
  if (calmMotion()) return;
  const mascot = teamEmoji(teamId);
  const extras = ['🎉', '🎊', '✨', '⭐'];
  const H = boardEl.getBoundingClientRect().height || 300;
  for (let i = 0; i < 24; i++) {
    const fromLeft = i % 2 === 0;
    const p = document.createElement('span');
    p.className = 'board-cannon';
    p.textContent = i % 3 === 0 ? extras[(i / 3 | 0) % extras.length] : mascot;
    // Launch angle 50°–85° from the corner, aimed inward; distance scales
    // with the board so the spray fills tall spectator boards too.
    const angle = (50 + Math.random() * 35) * Math.PI / 180;
    const dist = H * (0.55 + Math.random() * 0.55);
    const dx = Math.cos(angle) * dist * (fromLeft ? 1 : -1);
    const dy = -Math.sin(angle) * dist;
    p.style.setProperty('--tx', dx.toFixed(0) + 'px');
    p.style.setProperty('--ty', dy.toFixed(0) + 'px');
    p.style.setProperty('--br', (Math.random() * 480 - 240).toFixed(0) + 'deg');
    p.style.setProperty('--bd', (1.0 + Math.random() * 0.6).toFixed(2) + 's');
    p.style.animationDelay = (Math.random() * 0.18).toFixed(2) + 's';
    p.style[fromLeft ? 'left' : 'right'] = '4px';
    boardEl.appendChild(p);
    setTimeout(() => p.remove(), 2100);
  }
}

// Compare current scores to the last render and celebrate any increase.
function boardDiffCelebrate(boardEl, g, l, pair) {
  const memoKey = g.id + '|' + l.key;
  const prev = lastBoardScores[memoKey] || {};
  pair.forEach((id) => {
    const now = Number(l.hr[id]) || 0;
    if (prev[id] !== undefined && now > prev[id]) {
      boardCelebrate(boardEl, id);
    }
  });
  lastBoardScores = { [memoKey]: { [pair[0]]: Number(l.hr[pair[0]]) || 0, [pair[1]]: Number(l.hr[pair[1]]) || 0 } };
}

// The cannons and the score pop live INSIDE their .big-board (it clips them),
// so a render that has to rebuild the board — the ref's own Pause tap a moment
// after a goal, a real change from a snapshot — cut the celebration off
// mid-flight. renderAll lifts whatever is still flying before it renders, and
// afterwards sets it down at the same point in its animation on the board that
// replaced it. A board the render left alone keeps its own. Returns the
// set-down step.
function holdBoardCelebrations() {
  const held = [];
  document.querySelectorAll('.big-board[data-board-game]').forEach((board) => {
    const cannons = [...board.querySelectorAll('.board-cannon')]
      .map((p) => ({ p, t: runningAnimTime(p) })).filter((x) => x.t != null);
    const pops = [...board.querySelectorAll('[data-board-col] .score-pop')]
      .map((el) => ({ team: el.closest('[data-board-col]').dataset.boardCol, t: runningAnimTime(el) }))
      .filter((x) => x.t != null);
    // Only onto a replacement in the SAME place: a board in the game takeover keeps its volley across a rebuild.
    const host = board.closest('#takeover-game');
    if (host && (cannons.length || pops.length)) held.push({ board, host, gid: board.dataset.boardGame, cannons, pops });
  });
  return () => held.forEach(({ board, host, gid, cannons, pops }) => {
    if (board.isConnected) return; // not rebuilt — nothing was cut
    const next = [...host.querySelectorAll('.big-board[data-board-game]')].find((b) => b.dataset.boardGame === gid);
    if (!next) return;
    cannons.forEach(({ p, t }) => { next.appendChild(p); seekAnimations(p, t); });
    pops.forEach(({ team, t }) => {
      const col = [...next.querySelectorAll('[data-board-col]')].find((c) => c.dataset.boardCol === team);
      const val = col && col.querySelector('.board-score');
      if (!val || val.classList.contains('score-pop')) return; // a new goal is already popping it
      val.classList.add('score-pop');
      seekAnimations(val, t);
    });
  });
}

// Where an element's CSS animation has got to, or null if none is playing
// (finished, or reduced motion turned it off) — only those are carried over.
function runningAnimTime(el) {
  const a = el.getAnimations ? el.getAnimations()[0] : null;
  return a && a.playState === 'running' ? a.currentTime : null;
}

function seekAnimations(el, t) {
  if (t == null || !el.getAnimations) return;
  el.getAnimations().forEach((a) => { a.currentTime = t; });
}

function liveTrackerHTML(g, aId, bId, viewer) {
  if (!g.liveTracker) return '';
  const maxInn = g.liveTracker.innings || 3;
  const maxOuts = g.liveTracker.outs == null ? 3 : g.liveTracker.outs;
  const sideLabel = g.liveTracker.sideLabel || 'up';
  const periodLabel = g.liveTracker.periodLabel || 'Inning';
  const l = getLiveMatch(g, aId, bId);
  const clock = g.timer ? getClock(g) : null;
  const remaining = clock ? clockRemaining(clock) : 0;

  const col = (id) => `
    <div class="board-col" data-board-col="${esc(id)}"${teamAccentAttr(id)}>
      <span class="board-emoji">${bracketMarkHtml(id, viewer ? 52 : 40)}</span>
      <span class="board-name">${esc(teamName(id))}</span>
      <span class="board-score" data-hr-team="${esc(id)}">${l.hr[id] || 0}</span>
      ${viewer ? '' : `<div class="board-stepper">
        <button class="live-btn" data-live="hr-down" data-team="${esc(id)}" aria-label="Subtract from ${esc(teamName(id))}">−</button>
        <button class="live-btn board-plus" data-live="hr-up" data-team="${esc(id)}" aria-label="Add to ${esc(teamName(id))}">+</button>
      </div>`}
    </div>`;

  // A single-period tracker is just a running score — label the numbers with
  // the game's unit instead of a pointless "Round 1 of 1" stepper.
  const periodRow = maxInn <= 1
    ? `<span class="board-period">${esc(g.liveTracker.unit || 'Live score')}</span>`
    : viewer
      ? `<span class="board-period">${esc(periodLabel)} <span id="live-inning-val">${l.inning}</span> of ${maxInn}</span>`
      : `<span class="board-period">
          <button class="live-btn" data-live="inning-down" aria-label="Previous ${esc(periodLabel.toLowerCase())}">−</button>
          ${esc(periodLabel)} <span id="live-inning-val">${l.inning}</span> of ${maxInn}
          <button class="live-btn" data-live="inning-up" aria-label="Next ${esc(periodLabel.toLowerCase())}">+</button>
        </span>`;

  const clockHTML = clock ? `
    <div class="board-clock-wrap">
      <span class="board-clock ${remaining === 0 ? 'board-clock-zero' : ''}" data-game-clock data-game-id="${esc(g.id)}">${fmtBoardClock(remaining)}</span>
      ${viewer ? '' : `
        ${!clockLive(clock) && (g.timer.presets || []).length > 1 ? `<div class="preset-row">${g.timer.presets.map((p) =>
          `<button class="preset-chip ${clock.duration === p * 1000 ? 'selected' : ''}" data-clock="preset" data-secs="${p}">${fmtBoardClock(p * 1000)}</button>`).join('')}</div>` : ''}
        <div class="board-clock-btns">
          ${clockLive(clock)
            ? `<button class="timer-main-btn" data-clock="pause">⏸ Pause</button>`
            : `<button class="timer-main-btn" data-clock="start">▶ ${remaining === clock.duration ? 'Start' : remaining === 0 ? 'Restart' : 'Resume'}</button>`}
          ${remaining !== clock.duration ? `<button class="timer-side-btn" data-clock="reset">↺ Reset</button>` : ''}
        </div>`}
    </div>` : '';

  const kickingRow = maxOuts ? `
    <div class="board-subrow">
      <span class="live-label">${esc(sideLabel.charAt(0).toUpperCase() + sideLabel.slice(1))}</span>
      <span class="live-kicking-team" id="live-kicking-team">${teamEmoji(kickingTeamId(l, aId, bId))} ${esc(teamName(kickingTeamId(l, aId, bId)))}</span>
      ${viewer ? '' : `<button class="live-btn live-switch-btn" data-live="half-toggle" aria-label="Switch ${esc(sideLabel)} team">⇄</button>`}
    </div>
    <div class="board-subrow">
      <span class="live-label">Outs</span>
      ${viewer ? '' : `<button class="live-btn" data-live="out-down" aria-label="Remove an out">−</button>`}
      <span class="live-outs-pips" id="live-outs-pips" aria-label="${outsLabel(l.outs)}">${outsPips(l.outs, maxOuts)}</span>
      ${viewer ? '' : `<button class="live-btn" data-live="out-up" aria-label="Add an out">+</button>`}
    </div>` : '';

  return `<div class="big-board ${viewer ? 'viewer' : ''}" data-board-game="${esc(g.id)}">
    <div class="board-head">
      <span class="board-live-badge">Live</span>
      ${periodRow}
    </div>
    <div class="board-cols">
      ${col(aId)}
      <span class="board-dash">–</span>
      ${col(bId)}
    </div>
    ${clockHTML}
    ${kickingRow}
    ${viewer ? '' : '<button class="live-reset link-btn" data-live="reset">Reset tally</button>'}
  </div>`;
}

// Unified spectator scoresheet — every live game (goal tracker, ladder ball,
// or a plain bracket matchup) shows the SAME big board: giant team scores, the
// live clock when the game has one, and a context sub-line. Display-only (no
// controls). Goal-tracker games delegate to liveTrackerHTML for their
// period/outs extras; the others build the board here.
function liveBoardHTML(g, aId, bId) {
  if (g.liveTracker) return liveTrackerHTML(g, aId, bId, true);
  const clock = g.timer ? getClock(g) : null;
  const remaining = clock ? clockRemaining(clock) : 0;
  let aScore = null, bScore = null, sub = '';
  if (g.ladderScoring) {
    const l = getLadderMatch(g, aId, bId);
    aScore = l.a; bScore = l.b;
    const target = g.ladderScoring.target || 21;
    const w = ladderWinnerId(g, l, aId, bId);
    sub = w ? `🏆 ${teamEmoji(w)} ${esc(teamName(w))} reached ${target}!` : `First to exactly ${target}`;
  }
  const col = (id, score) => `
    <div class="board-col"${teamAccentAttr(id)}>
      <span class="board-emoji">${bracketMarkHtml(id, 52)}</span>
      <span class="board-name">${esc(teamName(id))}</span>
      ${score != null ? `<span class="board-score">${score}</span>` : ''}
    </div>`;
  const clockHTML = clock ? `
    <div class="board-clock-wrap">
      <span class="board-clock ${remaining === 0 ? 'board-clock-zero' : ''}" data-game-clock data-game-id="${esc(g.id)}">${fmtBoardClock(remaining)}</span>
    </div>` : '';
  return `<div class="big-board viewer" data-board-game="${esc(g.id)}">
    <div class="board-head">
      <span class="board-live-badge">Live</span>
      ${sub ? `<span class="board-period">${sub}</span>` : ''}
    </div>
    <div class="board-cols">
      ${col(aId, aScore)}
      <span class="board-dash">–</span>
      ${col(bId, bScore)}
    </div>
    ${clockHTML}
  </div>`;
}

function bindLiveTracker(container, g, aId, bId) {
  if (!g.liveTracker) return;
  const maxInn = g.liveTracker.innings || 3;
  const maxOuts = g.liveTracker.outs == null ? 3 : g.liveTracker.outs;

  // Celebrate any score increase that arrived since the last render (a
  // remote ref's goal, or a full re-render after a local one).
  const boardEl = container.querySelector('.big-board');
  if (boardEl) boardDiffCelebrate(boardEl, g, getLiveMatch(g, aId, bId), [aId, bId]);

  // Clock controls re-render the whole view (their buttons change shape);
  // the running display itself ticks via the global board-clock interval.
  container.querySelectorAll('[data-clock]').forEach((btn) => {
    btn.addEventListener('click', () => applyClockAction(g, btn.dataset.clock, btn.dataset.secs));
  });

  const refresh = () => {
    const l = getLiveMatch(g, aId, bId);
    const iv = container.querySelector('#live-inning-val');
    if (iv) iv.textContent = l.inning;
    const op = container.querySelector('#live-outs-pips');
    if (op) { op.textContent = outsPips(l.outs, maxOuts); op.setAttribute('aria-label', outsLabel(l.outs)); }
    const kt = container.querySelector('#live-kicking-team');
    if (kt) { const kid = kickingTeamId(l, aId, bId); kt.textContent = `${teamEmoji(kid)} ${teamName(kid)}`; }
    container.querySelectorAll('[data-hr-team]').forEach((el) => {
      el.textContent = l.hr[el.dataset.hrTeam] || 0;
    });
    const memoKey = g.id + '|' + l.key;
    lastBoardScores = { [memoKey]: { [aId]: Number(l.hr[aId]) || 0, [bId]: Number(l.hr[bId]) || 0 } };
  };
  container.querySelectorAll('[data-live]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.live;
      const team = btn.dataset.team;
      const l = getLiveMatch(g, aId, bId);
      if (act === 'inning-up') l.inning = Math.min(maxInn, (Number(l.inning) || 1) + 1);
      else if (act === 'inning-down') l.inning = Math.max(1, (Number(l.inning) || 1) - 1);
      else if (act === 'half-toggle') { l.half = (Number(l.half) || 0) === 1 ? 0 : 1; l.outs = 0; }
      else if (act === 'out-up') {
        const o = (Number(l.outs) || 0) + 1;
        if (o >= maxOuts) {
          if ((Number(l.half) || 0) === 0) {
            // First team retired — the second team kicks (same inning).
            l.half = 1;
            l.outs = 0;
          } else if ((Number(l.inning) || 1) < maxInn) {
            // Both teams have kicked — roll to the next inning, first team up.
            l.inning = (Number(l.inning) || 1) + 1;
            l.half = 0;
            l.outs = 0;
          } else {
            l.outs = maxOuts; // final inning, both sides done: hold at the limit
          }
        } else {
          l.outs = o;
        }
      }
      else if (act === 'out-down') l.outs = Math.max(0, (Number(l.outs) || 0) - 1);
      else if (act === 'hr-up') l.hr[team] = (Number(l.hr[team]) || 0) + 1;
      else if (act === 'hr-down') l.hr[team] = Math.max(0, (Number(l.hr[team]) || 0) - 1);
      else if (act === 'reset') { l.inning = 1; l.outs = 0; l.half = 0; l.hr = {}; }
      setLiveMatch(g, l, { celebrate: act === 'hr-up' });
      refresh();
      if (act === 'hr-up') {
        boardCelebrate(container.querySelector('.big-board'), team);
      }
    });
  });
}

// Ladder Ball round scorer. Both teams tap the rungs they landed this round
// (Top 3 / Mid 2 / Bottom 1); "Score round" applies cancellation — the higher
// raw total cancels the lower and the winner banks the difference — with the
// exactly-21 rule (a round that would push a team past 21 is a bust and holds
// their score). Totals sync live so spectators watch them climb.
function ladderMatchHTML(g, aId, bId) {
  if (!g.ladderScoring) return '';
  const sc = g.ladderScoring;
  const target = sc.target || 21;
  const l = getLadderMatch(g, aId, bId);
  const winner = ladderWinnerId(g, l, aId, bId);
  const teamBlock = (id, side, total, raw) => `
    <div class="ladder-team">
      <div class="ladder-team-head">
        <span class="ladder-team-name">${teamEmoji(id)} ${esc(teamName(id))}</span>
        <span class="ladder-total" data-ladder-total="${side}">${total}</span>
      </div>
      <div class="ladder-round-line">This round: <span class="ladder-round-val" data-ladder-round="${side}">${raw}</span></div>
      <div class="ladder-rungs">
        <button class="live-btn ladder-rung" data-ladder="rung" data-side="${side}" data-pts="${Number(sc.top) || 0}">Top +${sc.top}</button>
        <button class="live-btn ladder-rung" data-ladder="rung" data-side="${side}" data-pts="${Number(sc.mid) || 0}">Mid +${sc.mid}</button>
        <button class="live-btn ladder-rung" data-ladder="rung" data-side="${side}" data-pts="${Number(sc.bottom) || 0}">Bot +${sc.bottom}</button>
        <button class="live-btn ladder-clear" data-ladder="round-clear" data-side="${side}" aria-label="Clear this round for ${esc(teamName(id))}">↺</button>
      </div>
    </div>`;
  const wonBanner = winner
    ? `<p class="ladder-won">🏆 ${teamEmoji(winner)} ${esc(teamName(winner))} reached ${target}! Tap their <strong>“won”</strong> button above to lock it in.</p>`
    : '';
  return `<div class="ladder-tracker">
    <p class="ladder-target">🪜 First to exactly ${target} · cancellation scoring each round</p>
    <div class="ladder-teams">
      ${teamBlock(aId, 'a', l.a, l.ra)}
      ${teamBlock(bId, 'b', l.b, l.rb)}
    </div>
    <jelly-button class="primary-btn ladder-score-round" block data-ladder="score-round"${winner ? ' disabled' : ''}>Score this round</jelly-button>
    ${l.log.length ? '<button class="link-btn ladder-undo" data-ladder="undo-round">Undo last round</button>' : ''}
    ${wonBanner}
  </div>`;
}

function bindLadderMatch(container, g, aId, bId) {
  if (!g.ladderScoring) return;
  const sc = g.ladderScoring;
  const target = sc.target || 21;
  const refresh = () => {
    const l = getLadderMatch(g, aId, bId);
    const set = (sel, v) => { const el = container.querySelector(sel); if (el) el.textContent = v; };
    set('[data-ladder-total="a"]', l.a);
    set('[data-ladder-total="b"]', l.b);
    set('[data-ladder-round="a"]', l.ra);
    set('[data-ladder-round="b"]', l.rb);
  };
  // Pre-highlight the winning team's "won" button once a team hits 21, so the
  // ref knows exactly which one advances the bracket.
  const highlightWinner = () => {
    const w = ladderWinnerId(g, getLadderMatch(g, aId, bId), aId, bId);
    container.querySelectorAll('.winner-btn').forEach((btn) => {
      btn.classList.toggle('winner-ready', w != null && btn.dataset.winner === w);
    });
  };
  container.querySelectorAll('[data-ladder]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.ladder;
      const l = getLadderMatch(g, aId, bId);
      if (act === 'rung') {
        const pts = Number(btn.dataset.pts) || 0;
        if (btn.dataset.side === 'a') l.ra += pts; else l.rb += pts;
      } else if (act === 'round-clear') {
        if (btn.dataset.side === 'a') l.ra = 0; else l.rb = 0;
      } else if (act === 'score-round') {
        const delta = Math.abs(l.ra - l.rb);
        const winSide = l.ra > l.rb ? 'a' : l.rb > l.ra ? 'b' : null;
        if (winSide && delta > 0) {
          const cur = winSide === 'a' ? l.a : l.b;
          const next = cur + delta;
          const applied = next <= target; // bust (over 21) holds the score
          if (applied) { if (winSide === 'a') l.a = next; else l.b = next; }
          l.log.push({ ra: l.ra, rb: l.rb, winner: winSide, delta, applied });
        } else {
          l.log.push({ ra: l.ra, rb: l.rb, winner: null, delta: 0, applied: true });
        }
        l.ra = 0; l.rb = 0;
      } else if (act === 'undo-round') {
        const last = l.log.pop();
        if (last && last.winner && last.applied) {
          if (last.winner === 'a') l.a = Math.max(0, l.a - last.delta);
          else l.b = Math.max(0, l.b - last.delta);
        }
      }
      setLadderMatch(g, l, { celebrate: act === 'rung' || act === 'score-round' });
      // A rung/clear tap only changes numbers — refresh in place to stay snappy
      // and keep scroll position. Scoring or undoing a round can flip the
      // won-banner / disabled state, so re-render the whole view for those.
      if (act === 'rung' || act === 'round-clear') { refresh(); highlightWinner(); }
      else renderAll();
    });
  });
  highlightWinner();
}

// A tournament match shows either the Ladder Ball round scorer or the generic
// live tally, depending on the game. One dispatch point keeps the bracket
// render functions identical across games.
// The read-only stand-in an own-team-guarded editor sees where the live
// tracker would be: the same big board every spectator gets, so they can
// still follow their own team's match — they just can't touch the score.
function liveMatchWatchHTML(g, aId, bId) {
  return `<div class="live-watch">
    ${liveBoardHTML(g, aId, bId)}
    <p class="muted live-watch-note">Updates by itself as another director scores.</p>
  </div>`;
}

function matchTrackerHTML(g, aId, bId) {
  // The own-team guard: an editor on one of these two teams doesn't score
  // THIS match (see canScoreRound) — they still run the rest of the game.
  if (blockedByOwnTeam(aId, bId)) {
    return ownTeamNoteHTML('this match') + liveMatchWatchHTML(g, aId, bId);
  }
  return g.ladderScoring ? ladderMatchHTML(g, aId, bId) : liveTrackerHTML(g, aId, bId);
}

function bindMatchTracker(container, g, aId, bId) {
  if (blockedByOwnTeam(aId, bId)) return; // nothing interactive was rendered
  if (g.ladderScoring) bindLadderMatch(container, g, aId, bId);
  else bindLiveTracker(container, g, aId, bId);
}

// "By the standings" (Set up the week → Games → Matchups, game.bracketSeed): the director who calls the next match up is SUGGESTED the best
// remaining team against the lowest remaining one (1st v 6th, then 2nd v 5th, then 3rd v 4th), from the points as they are right now,
// and taps to call them up. A suggestion for a director only (standingsVisible: never a counselor's screen, never a preview of one) and
// never written anywhere: nothing about who plays whom is stored until the director calls a pair up, exactly as a hand pick. A game with
// fixed pairs, or on "Pick them when you start", has none. The four-team bracket (Step 22) reads bracketSeed through its own fourSeeds.
function bracketSuggestPair(g, b) {
  if (!g || g.bracketSeed !== 'standings' || !b || b.phase !== 'round1') return null;
  if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) return null;
  if (b.selectedPair && b.selectedPair.length) return null;
  if (!canEdit() || !standingsVisible()) return null;
  const pool = Array.isArray(b.pool) ? b.pool : [];
  if (pool.length < 2) return null;
  const ranked = rankTeamsByPoints(medalCounts()).map((t) => t.id).filter((id) => pool.indexOf(id) !== -1);
  return ranked.length >= 2 ? [ranked[0], ranked[ranked.length - 1]] : null;
}

// The six-team bracket as it is NOW, if it is still at the step the screen drew (`phase`). A tap made on an older screen — another
// director recorded the match, a snapshot replaced the bracket, the result was saved — is ignored, said and repainted, and never
// applied to a copy nobody holds any more (the stale double-tap guard, as the four-team bracket's).
function sixLive(g, phase) {
  if (state.results && state.results[g.id]) { sixStale('This game’s result is already saved.'); return null; }
  const raw = state.brackets && state.brackets[g.id];
  if (!raw || !bracketKnown(raw)) { sixStale('This bracket is gone. The screen now shows where things are.'); return null; }
  const live = normalizeBracket(raw);
  if (live.phase !== phase) { sixStale('The bracket moved on. The screen now shows where it is.'); return null; }
  return live;
}

function sixStale(words) {
  showToast(words || 'That was already recorded. The screen now shows what is saved.');
  renderAll();
}

function renderBracketRound1(body, g, b) {
  if (b.pool.length === 0) {
    b.phase = 'bye';
    saveState();
    renderAll();
    return;
  }

  // Games with a fixed Round 1 order (e.g. Kangaroo Kickball) walk the
  // preset matchups in order instead of the free "pick two teams" flow.
  if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) {
    renderBracketRound1Fixed(body, g, b, g.roundOneMatchups);
    return;
  }

  const suggest = bracketSuggestPair(g, b);
  let html = `<h3>Round 1 — Match ${b.matches.length + 1} of 3</h3>
    <p class="muted">Pick the two teams to call up next.</p>
    ${suggest ? `<p class="muted seed-suggest">Suggested by the points: ${esc(teamName(suggest[0]))} v ${esc(teamName(suggest[1]))} <button type="button" id="seed-suggest-btn" class="link-btn">Call them up</button></p>` : ''}
    <div class="team-chip-grid">
      ${b.pool.map((id) => `<button class="team-chip ${b.selectedPair.includes(id) ? 'selected' : ''}" data-team-id="${id}">${esc(teamName(id))}<span class="chip-sub">${esc(counselorName(id))}</span></button>`).join('')}
    </div>`;

  if (b.selectedPair.length === 2) {
    html += matchupCalloutHTML(b.selectedPair[0], b.selectedPair[1]);
    html += matchTrackerHTML(g, b.selectedPair[0], b.selectedPair[1]);
  }

  if (b.matches.length > 0) {
    html += `<div class="completed-matches">
      <p class="muted">Completed:</p>
      <ul>${b.matches.map((m) => `<li>${esc(teamName(m.winner))} def. ${esc(teamName(m.loser))}</li>`).join('')}</ul>
      <button id="undo-match-btn" class="link-btn">Undo last match</button>
    </div>`;
  }

  body.innerHTML = html;

  if (b.selectedPair.length === 2) {
    bindMatchupCopy(body, g, `Round 1 (match ${b.matches.length + 1})`, b.selectedPair[0], b.selectedPair[1]);
    bindMatchTracker(body, g, b.selectedPair[0], b.selectedPair[1]);
  }

  // Every tap resolves the bracket as it is NOW (sixLive): a screen drawn before another director's tap is ignored, said and
  // repainted, never applied to a copy nobody holds.
  const suggestBtn = body.querySelector('#seed-suggest-btn');
  if (suggestBtn && suggest) suggestBtn.addEventListener('click', () => {
    const live = sixLive(g, 'round1');
    if (!live) return;
    live.selectedPair = suggest.slice();
    saveState();
    renderAll();
  });

  body.querySelectorAll('.team-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const live = sixLive(g, 'round1');
      if (!live) return;
      sixPick(live, btn.dataset.teamId);
      saveState();
      renderAll();
    });
  });

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', sixTap(() => {
      const live = sixLive(g, 'round1');
      if (!live) return false;
      const [a, c] = live.selectedPair;
      if (!sixRecordMatch(live, a, c, btn.dataset.winner)) { sixStale(); return false; }
      touchData();
      saveState();
      renderAll();
    }));
  });

  const undoBtn = document.getElementById('undo-match-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', sixTap(() => {
      const live = sixLive(g, 'round1');
      if (!live) return false;
      sixUndoMatch(live);
      saveState();
      renderAll();
    }, 'undo'));
  }
}

// Round 1 driven by a fixed, pre-set matchup order (game.roundOneMatchups).
// Shows the whole schedule up front — done matches with their winner, the
// current one flagged NOW, the rest upcoming — so counselors always know
// who's on deck. Each match just needs a winner tapped; no team-picking.
function renderBracketRound1Fixed(body, g, b, preset) {
  const currentIndex = b.matches.length; // matches recorded so far == next index
  const current = preset[currentIndex] || null;

  const scheduleHTML = `<div class="matchup-order">
    <p class="matchup-order-label">Match order</p>
    <ol class="matchup-order-list">
      ${preset.map((pair, i) => {
        const [x, y] = pair;
        let status = 'upcoming';
        let detail = '';
        if (i < currentIndex) {
          status = 'done';
          const m = b.matches[i];
          if (m) detail = `<span class="mo-result">✓ ${esc(teamName(m.winner))} won</span>`;
        } else if (i === currentIndex) {
          status = 'current';
          detail = '<span class="mo-now">NOW</span>';
        }
        return `<li class="matchup-order-item mo-${status}">
          <span class="mo-teams">${teamEmoji(x)} ${esc(teamName(x))} <span class="mo-vs">vs</span> ${teamEmoji(y)} ${esc(teamName(y))}</span>
          ${detail}
        </li>`;
      }).join('')}
    </ol>
  </div>`;

  let html = `<h3>Round 1 — Match ${currentIndex + 1} of ${preset.length}</h3>` + scheduleHTML;

  if (current) {
    html += matchupCalloutHTML(current[0], current[1]);
    html += matchTrackerHTML(g, current[0], current[1]);
  }

  if (b.matches.length > 0) {
    // Named for the match it takes back, in the same place and look as every bracket's Undo (the four-team one too).
    html += `<div class="completed-matches"><button id="undo-match-btn" class="link-btn"><svg class="ico" aria-hidden="true"><use href="#i-undo"/></svg>Undo Round 1, match ${b.matches.length}</button></div>`;
  }

  body.innerHTML = html;

  if (current) {
    bindMatchupCopy(body, g, `Round 1 (match ${currentIndex + 1})`, current[0], current[1]);
    bindMatchTracker(body, g, current[0], current[1]);
  }

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', sixTap(() => {
      if (!current) return false;
      const live = sixLive(g, 'round1');
      if (!live) return false;
      // The match the screen showed is the one recorded only while the bracket is still at that match.
      if (live.matches.length !== currentIndex) { sixStale(); return false; }
      const [a, c] = current;
      if (!sixRecordMatch(live, a, c, btn.dataset.winner)) { sixStale(); return false; }
      touchData();
      saveState();
      renderAll();
    }));
  });

  const undoBtn = document.getElementById('undo-match-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', sixTap(() => {
      const live = sixLive(g, 'round1');
      if (!live) return false;
      sixUndoMatch(live);
      saveState();
      renderAll();
    }, 'undo'));
  }
}

function renderBracketBye(body, g, b) {
  const winners = b.matches.map((m) => m.winner);
  // Suggest the winner with the fewest week points (the trailing team) using
  // the live standings. If two or more tie for the fewest, don't pick — let
  // the ref decide, but still show everyone's points.
  // Only a confirmed director has points to judge by: a hint-painted device
  // (standingsVisible false) shows the picker with no numbers and no suggestion,
  // never the zeros medalCounts() returns to it.
  const seeTotals = standingsVisible();
  const counts = seeTotals ? medalCounts() : {};
  const pointsOf = (id) => (counts[id] && counts[id].points) || 0;
  const lowest = winners.reduce((min, id) => Math.min(min, pointsOf(id)), Infinity);
  const lowCount = winners.filter((id) => pointsOf(id) === lowest).length;
  const suggestedId = seeTotals && lowCount === 1 ? winners.find((id) => pointsOf(id) === lowest) : null;
  const verdict = suggestedId
    ? `The app suggests <strong>${esc(teamName(suggestedId))}</strong> — but you decide.`
    : seeTotals ? 'These winners are tied for the fewest, so pick whoever you like.' : 'The points that decide it show once your sign-in is confirmed.';
  body.innerHTML = `
    <h3>Who gets the bye?</h3>
    <p class="muted">The bye (skip straight to the Final) goes to whichever Round&nbsp;1 winner has the <strong>fewest points this week</strong>. ${verdict}</p>
    <div class="team-chip-grid">
      ${winners.map((id) => {
        const p = pointsOf(id);
        const sug = id === suggestedId;
        const sub = seeTotals ? `<span class="chip-sub">${p} pt${p === 1 ? '' : 's'} this week${sug ? ' · suggested' : ''}</span>` : '';
        return `<button class="team-chip tiebreak-chip ${sug ? 'suggested-chip' : ''}" data-team-id="${id}">${sug ? '⭐ ' : ''}${esc(teamName(id))}${sub}</button>`;
      }).join('')}
    </div>
    <button id="undo-to-round1-btn" class="link-btn"><svg class="ico" aria-hidden="true"><use href="#i-chev-l"/></svg>Back to Round 1</button>
  `;

  body.querySelectorAll('.tiebreak-chip').forEach((btn) => {
    btn.addEventListener('click', sixTap(() => {
      const live = sixLive(g, 'bye');
      if (!live) return false;
      if (!sixChooseBye(live, btn.dataset.teamId)) { sixStale(); return false; }
      touchData();
      saveState();
      renderAll();
    }));
  });

  document.getElementById('undo-to-round1-btn').addEventListener('click', sixTap(() => {
    const live = sixLive(g, 'bye');
    if (!live) return false;
    sixBackToRound1(live);
    saveState();
    renderAll();
  }, 'undo'));
}

// "Undo" under a six-team step that has a result to take back. Offered only to a director who may score the match it takes back
// (canScoreRound: a director on a team in it leaves that to another), as the four-team bracket's Undo last match.
function sixUndoHtml(id, label, teams) {
  return teams && canScoreRound(...teams) ? `<p class="completed-matches"><button type="button" id="${id}" class="link-btn"><svg class="ico" aria-hidden="true"><use href="#i-undo"/></svg>${esc(label)}</button></p>` : '';
}

function renderBracketSemifinal(body, g, b) {
  body.innerHTML = `
    <h3>Championship Game</h3>
    <p class="bye-note">🎟️ <strong>${esc(teamName(b.byeTeamId))}</strong> has the bye — straight to the Final.</p>
    ${matchupCalloutHTML(b.semifinal.a, b.semifinal.b)}
    ${matchTrackerHTML(g, b.semifinal.a, b.semifinal.b)}
    <p class="completed-matches"><button type="button" id="undo-bye-btn" class="link-btn"><svg class="ico" aria-hidden="true"><use href="#i-chev-l"/></svg>Back to the bye</button></p>
  `;

  bindMatchupCopy(body, g, 'Championship game', b.semifinal.a, b.semifinal.b);
  bindMatchTracker(body, g, b.semifinal.a, b.semifinal.b);

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', sixTap(() => {
      const live = sixLive(g, 'semifinal');
      if (!live) return false;
      if (!sixRecordSemifinal(live, btn.dataset.winner)) { sixStale(); return false; }
      touchData();
      saveState();
      renderAll();
    }));
  });

  document.getElementById('undo-bye-btn').addEventListener('click', sixTap(() => {
    const live = sixLive(g, 'semifinal');
    if (!live) return false;
    sixBackToBye(live);
    saveState();
    renderAll();
  }, 'undo'));
}

function renderBracketChampionship(body, g, b) {
  const mult = g.messtival ? 2 : 1; // match medalCounts()'s weighting
  body.innerHTML = `
    <h3>Final</h3>
    <p class="bronze-note">🥉 <strong>${esc(teamName(b.semifinal.loser))}</strong> takes the bronze medal${standingsVisible() ? ` (+${MEDAL_POINTS.bronze * mult} pts)` : ''}.</p>
    ${matchupCalloutHTML(b.championship.a, b.championship.b)}
    ${matchTrackerHTML(g, b.championship.a, b.championship.b)}
    ${sixUndoHtml('undo-semifinal-btn', 'Undo the championship game', [b.semifinal.a, b.semifinal.b])}
  `;

  bindMatchupCopy(body, g, 'Final', b.championship.a, b.championship.b);
  bindMatchTracker(body, g, b.championship.a, b.championship.b);

  body.querySelectorAll('.winner-btn').forEach((btn) => {
    btn.addEventListener('click', sixTap(() => {
      const live = sixLive(g, 'championship');
      if (!live) return false;
      if (!sixRecordFinal(live, btn.dataset.winner)) { sixStale(); return false; }
      touchData();
      saveState();
      renderAll();
    }));
  });

  const undoBtn = document.getElementById('undo-semifinal-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', sixTap(() => {
      const live = sixLive(g, 'championship');
      if (!live) return false;
      sixUndoSemifinal(live);
      saveState();
      renderAll();
    }, 'undo'));
  }
}

function renderBracketSummary(body, g, b) {
  const medals = sixMedals(b);
  const goldId = medals.gold;
  const silverId = medals.silver;
  const bronzeId = medals.bronze;
  const eliminated = b.matches.map((m) => m.loser);
  const mult = g.messtival ? 2 : 1; // match medalCounts()'s weighting

  body.innerHTML = `
    <h3>Game results</h3>
    <div class="medal-summary">
      <div class="medal-row gold-row">🥇 ${teamEmoji(goldId)} <strong>${esc(teamName(goldId))}</strong>${medalWorthChip(MEDAL_POINTS.gold * mult)}</div>
      <div class="medal-row silver-row">🥈 ${teamEmoji(silverId)} <strong>${esc(teamName(silverId))}</strong>${medalWorthChip(MEDAL_POINTS.silver * mult)}</div>
      <div class="medal-row bronze-row">🥉 ${teamEmoji(bronzeId)} <strong>${esc(teamName(bronzeId))}</strong>${medalWorthChip(MEDAL_POINTS.bronze * mult)}</div>
    </div>
    <p class="muted">Eliminated in Round 1: ${eliminated.map((id) => esc(teamName(id))).join(', ')}</p>
    <jelly-button id="save-bracket-btn" class="primary-btn" block>Save result</jelly-button>
    ${sixUndoHtml('undo-final-btn', 'Undo the final', [b.championship.a, b.championship.b])}
  `;

  document.getElementById('save-bracket-btn').addEventListener('click', () => {
    // The podium comes from the bracket as it is when the button is tapped, never from the screen that was drawn.
    const live = sixLive(g, 'summary');
    if (!live) return;
    finishBracket(g, 'six', sixMedals(live));
  });

  const undoBtn = document.getElementById('undo-final-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', sixTap(() => {
      const live = sixLive(g, 'summary');
      if (!live) return false;
      sixUndoFinal(live);
      saveState();
      renderAll();
    }, 'undo'));
  }
}

// ── The four-team bracket's screens (Step 22; senior) ────────────────────────────────────────────
// What a director sees in the game takeover while a four-team tournament is played: the Start card ("Suggested by the points" with
// Choose different, a fixed pair set, or a pick of the two semifinals), then the step bar (Semifinal 1 → Semifinal 2 → 3rd place →
// Final → Results) over the match waiting for a winner, which is the six-team wizard's own callout and live tally (matchupCalloutHTML,
// matchTrackerHTML: the own-team guard comes with them), the Re-check card when a recorded match disagrees with its semifinals, and
// the summary with Save Result. Everything is DRAWN from state.brackets4 through fourRead and written by the page-state wrappers
// (fourStartGame, fourRecordTap, fourUndoTap, fourResolveTap, fourSaveResult): a render writes nothing, the phase is never stored,
// and a tap resolves its game and its match when it fires, so a screen made before another director's tap can only be ignored, said
// and repainted. The markup goes through setLiveHtmlIfChanged (an idle render leaves a running live tally alone) and the taps are
// delegated once per container, resolved by data-four.
const fourUi = { gid: '', choosing: false, order: [] };

// The Start card's picker: tap a team to place it (the first two meet in Semifinal 1, and the other two fill Semifinal 2 as soon as
// two are placed), tap a placed one to take it out. Pure; returns the new order, never longer than the roster.
function fourPickTap(order, tid, ids) {
  if (!Array.isArray(ids) || ids.indexOf(tid) === -1) return (order || []).slice();
  if ((order || []).indexOf(tid) !== -1) return order.filter((t) => t !== tid);
  const next = (order || []).concat([tid]);
  const free = ids.filter((t) => next.indexOf(t) === -1);
  return free.length === 2 && ids.length === 4 ? next.concat(free) : next;
}

// A team as the four-team screens show it: its mark (the flag with its shape, §8.4 — never the colour-only circle emoji, which
// fails red vs gold under deuteranopia) and its name. These screens rebuild only when their markup changes (setLiveHtmlIfChanged).
function fourTeamHtml(id, size) {
  return `<span class="four-team">${teamMarkHtml(id, { size: size || 22 })}<span class="four-team-nm">${esc(teamName(id))}</span></span>`;
}

// The two semifinals as one hairline list: "Semifinal 1" over its two teams.
function fourPairsListHtml(label, pairs) {
  return `<p class="four-label">${esc(label)}</p>
    <ol class="four-pairs">${pairs.map((p, i) => `<li class="four-pair"><span class="four-pair-k">Semifinal ${i + 1}</span>` +
      `<span class="four-pair-t">${fourTeamHtml(p[0])}<span class="four-vs">vs</span>${fourTeamHtml(p[1])}</span></li>`).join('')}</ol>`;
}

// No bracket yet: the three ways a game's Matchups setting starts one. One meta line says how it runs (§8.8: no paragraph above
// the content); the main action is the one blue Start.
function fourStartHtml(g) {
  const ids = teamIds();
  const plan = fourSeedPlan(g);
  const choosing = fourUi.gid === g.id && fourUi.choosing;
  const head = '<h3 class="four-h">Run the bracket</h3><p class="four-meta">Two semifinals, then the 3rd place match and the final.</p>';
  if (plan.mode === 'fixed' && plan.pairs) {
    return `${head}${fourPairsListHtml('The semifinals for this game', plan.pairs)}
      <jelly-button class="primary-btn four-go" block data-four="start-plan">Start the bracket</jelly-button>`;
  }
  if (plan.mode === 'standings' && plan.pairs && !choosing) {
    return `${head}${fourPairsListHtml('Suggested by the points right now', plan.pairs)}
      <jelly-button class="primary-btn four-go" block data-four="start-plan">Start with these</jelly-button>
      <p class="four-alt"><button type="button" class="link-btn" data-four="choose">Choose different</button></p>`;
  }
  // A pick (the game's own setting, or Choose different, or "by the standings" on a phone with no confirmed points to judge by).
  const order = fourUi.gid === g.id ? fourUi.order.filter((t) => ids.indexOf(t) !== -1) : [];
  const pairs = fourPairsValid([order.slice(0, 2), order.slice(2, 4)], ids) ? [order.slice(0, 2), order.slice(2, 4)] : null;
  const why = plan.mode === 'standings' && !plan.pairs
    ? '<p class="four-meta">The points that suggest the pairs show once your sign-in is confirmed. Pick them yourself for now.</p>' : '';
  const slot = (i) => (order[i] ? fourTeamHtml(order[i]) : '<span class="four-open"><i class="b4-tbd" aria-hidden="true"></i>Pick a team</span>');
  // A placed team carries its semifinal's number in an ink disc (the words are there for a screen reader), so the teams you
  // tapped and the two filled in for you read as two pairs, not four look-alike chips.
  const chips = ids.map((id) => {
    const at = order.indexOf(id);
    const semi = at < 2 ? 1 : 2;
    return `<button type="button" class="team-chip four-chip ${at !== -1 ? 'selected' : ''}" data-four="pick" data-team="${esc(id)}" aria-pressed="${at !== -1 ? 'true' : 'false'}">` +
      `${at !== -1 ? `<i class="four-disc" aria-hidden="true">${semi}</i>` : ''}${fourTeamHtml(id)}` +
      `${at === -1 ? (counselorName(id) ? `<span class="chip-sub">${esc(counselorName(id))}</span>` : '') : `<span class="visually-hidden">Semifinal ${semi}</span>`}</button>`;
  }).join('');
  return `${head}${why}
    <p class="four-label">Tap the two teams that play Semifinal 1. The other two play Semifinal 2.</p>
    <div class="four-pick">
      <div class="team-chip-grid">${chips}</div>
      <ol class="four-pairs">
        <li class="four-pair"><span class="four-pair-k">Semifinal 1</span><span class="four-pair-t">${slot(0)}<span class="four-vs">vs</span>${slot(1)}</span></li>
        <li class="four-pair"><span class="four-pair-k">Semifinal 2</span><span class="four-pair-t">${slot(2)}<span class="four-vs">vs</span>${slot(3)}</span></li>
      </ol>
    </div>
    ${pairs ? '<jelly-button class="primary-btn four-go" block data-four="start-pick">Start the bracket</jelly-button>' : ''}
    ${plan.pairs ? '<p class="four-alt"><button type="button" class="link-btn" data-four="unchoose">Back to the suggestion</button></p>' : ''}`;
}

// Where the bracket is: one sentence-case line ("Step 2 of 5 · Semifinal 2"), never a row of pills that wraps to four lines at
// large text (the map under the match shows the whole bracket). Nothing during a re-check: its card says what is going on.
function fourStepsHtml(v, phase) {
  const labels = [['s1', FOUR_NAMES.s1], ['s2', FOUR_NAMES.s2], ['third', '3rd place match'], ['final', 'Final'], ['summary', 'Results']];
  const i = labels.findIndex(([k]) => k === phase);
  if (i === -1) return '';
  return `<p class="four-steps" data-four-step="${esc(phase)}">Step ${i + 1} of ${labels.length} · <span class="wizard-step active" aria-current="step">${esc(labels[i][1])}</span></p>`;
}

// The bracket so far as Now's own 2×2 picture (the same cells a counselor reads), with the match under way outlined: the map of
// the whole bracket under whatever the director is doing now.
function fourMapHtml(g) {
  if (typeof nowBracket4Html !== 'function') return '';
  const b4 = nowBracket4({ myTeam: nowMyTeam() }, g);
  return b4 ? `<div class="gv-b4 four-map"><p class="four-label">The bracket</p>${nowBracket4Html(b4)}</div>` : '';
}

// Undo, named for the match it takes back ("Undo Semifinal 2", "Undo the final"): only the last match in play order, and only for
// a director who may score it (canScoreRound). The six-team wizard's Undo links sit in the same place and look.
const FOUR_UNDO_WORDS = { s1: 'Undo Semifinal 1', s2: 'Undo Semifinal 2', third: 'Undo the 3rd place match', final: 'Undo the final' };
function fourUndoHtml(v) {
  const last = FOUR_ORDER.slice().reverse().find((k) => v.m[k].recorded);
  if (!last || !canScoreRound(v.m[last].a, v.m[last].b)) return '';
  return `<p class="four-undo"><button type="button" class="link-btn" data-four="undo"><svg class="ico" aria-hidden="true"><use href="#i-undo"/></svg>${esc(FOUR_UNDO_WORDS[last])}</button></p>`;
}

// A recorded match disagrees with the semifinals it was played on (two phones recorded different winners, or a semifinal was
// changed after the 3rd place match): nothing more is recorded and no medal paid until a director answers. Two equal buttons (a
// real choice, neither the "main" one), each saying what it does to the rest of the bracket INSIDE it, so a consequence can never
// be read as the next button's.
function fourRecheckHtml(v) {
  const r = v.recheck;
  const nm = (id) => `<b>${esc(teamName(id))}</b>`;
  const played = ['third', 'final'].filter((k) => v.m[k].recorded);
  const playedWords = played.map((k) => (k === 'third' ? 'the 3rd place match' : 'the final')).join(' and ');
  const Played = playedWords ? playedWords.charAt(0).toUpperCase() + playedWords.slice(1) : 'The later matches';
  const was = played.length > 1 ? 'were' : 'was';
  const what = r.semi
    ? `${esc(FOUR_NAMES[r.semi])} now says ${r.now ? nm(r.now) + ' won' : 'nobody won'}. ${esc(Played)} ${was} played as if ${r.was ? nm(r.was) : 'a different team'} had won it.`
    : `The ${esc(r.match === 'third' ? '3rd place match' : 'final')} result doesn’t fit the semifinals it was played on.`;
  const keepT = r.semi && r.now ? `Keep ${esc(teamName(r.now))} as the winner` : 'Play the later matches again';
  const keepS = `${esc(Played)} ${played.length > 1 ? 'are' : 'is'} played again`;
  // A director whose own team played one of the matches in question leaves the answer to another (canScoreRound, as Undo does): the
  // two buttons are not offered, and the card says why.
  const mine = fourCanResolve(v);
  return `<div class="four-recheck" role="alert">
    <h3 data-four-h tabindex="-1">Please check a result</h3>
    <p>${what}</p>
    <p class="four-meta">${mine ? 'Another director may have changed it. Which one is right?' : 'Your team plays in one of these matches, so another director decides which one is right.'}</p>
    ${mine ? `<div class="four-choices">
      <button type="button" class="btn btn-block four-choice" data-four="keep"><span class="four-choice-t">${keepT}</span><span class="four-choice-s">${keepS}</span></button>
      ${r.semi && r.was ? `<button type="button" class="btn btn-block four-choice four-back" data-four="back"><span class="four-choice-t">Put ${esc(teamName(r.was))} back as the winner</span><span class="four-choice-s">Nothing else changes</span></button>` : ''}
    </div>` : ''}
  </div>`;
}

// The match waiting for a winner: its own heading and one line on what the winner plays next, then the callout with the winner
// buttons and the live tally. The wrapper names the match, so a winner tap says which match the screen showed.
function fourMatchHtml(g, v, cur) {
  const mult = g.messtival ? 2 : 1; // match medalCounts()'s weighting
  const pts = (m) => (standingsVisible() ? ` (+${MEDAL_POINTS[m] * mult} pts)` : '');
  const heads = { s1: 'Semifinal 1', s2: 'Semifinal 2', third: '3rd place match', final: 'Final' };
  // A medal is a numbered disc (§8.3), never 🥇 / 🥉 used as an icon.
  const disc = (n) => `<i class="pp-disc" data-place="${n}" aria-hidden="true">${n}</i>`;
  const note = cur.key === 'third' ? `<p class="four-note">${disc(3)}<span>The winner takes the bronze medal${pts('bronze')}.</span></p>`
    : cur.key === 'final' ? `<p class="four-note">${disc(1)}<span>The winner takes gold${pts('gold')}. The other team takes silver${pts('silver')}.</span></p>`
    : '<p class="four-meta">The winner plays in the final. The loser plays for 3rd place.</p>';
  return `<h3 data-four-h tabindex="-1">${esc(heads[cur.key])}</h3>${note}
    <div data-four-match="${esc(cur.key)}">${matchupCalloutHTML(cur.a, cur.b)}${matchTrackerHTML(g, cur.a, cur.b)}</div>`;
}

// All four matches agree: the winners as the saved result's own hairline list (medal disc, flag, name, the worth for directors),
// so the screen does not change its look at the moment of saving. The Save itself is the dock's gold button (renderGameDock:
// gamesDock's 'four' tone), as a podium game's is.
function fourSummaryHtml(g, v) {
  const f = v.m.final;
  const medals = { gold: f.winner, silver: f.winner === f.a ? f.b : f.a, bronze: v.m.third.winner };
  const list = typeof gamesResultHtml === 'function'
    ? gamesResultHtml(Object.assign(gamesResultModel(g, { medals }), { saved: null, scores: null, change: false }))
    : `<ol class="gres">${PODIUM_MEDALS.map((k, i) => `<li class="gres-r" data-place="${i + 1}">${fourTeamHtml(medals[k], 34)}</li>`).join('')}</ol>`;
  return `<h3 data-four-h tabindex="-1">Ready to save</h3>
    <p class="four-meta">Check the winners, then save the result for everyone.</p>${list}`;
}

// What this build cannot read (a half-written bracket a late tap left behind, a value from a newer build): no controls that write
// but the director's own way out. What to do, in order, without guessing whether a newer version exists.
function fourUnreadableHtml() {
  return `<h3>Run the bracket</h3>
    <p class="four-meta">This bracket can’t be read here, so nothing on it can change. Reload to get the newest version of the app. If it still can’t be read, clear it and start again.</p>
    <p class="four-alt"><button type="button" class="link-btn" data-four="reload">Reload now</button></p>
    <div class="wizard-footer"><button type="button" class="link-btn danger-link" data-four="clear">Clear this bracket</button></div>`;
}

// The whole entry area for one game, from state alone.
function fourScreenHtml(g) {
  const ids = teamIds();
  const raw = fourBracketOf(g);
  if (!raw) return fourStartHtml(g);
  const v = fourRead(raw, ids);
  if (!v) return fourUnreadableHtml();
  const phase = fourPhase(raw, ids);
  const cur = fourCurrent(raw, ids);
  let body;
  if (phase === 'recheck') body = fourRecheckHtml(v);
  else if (cur) body = fourMatchHtml(g, v, cur);
  else body = fourSummaryHtml(g, v);
  return `${fourStepsHtml(v, phase)}<div id="bracket-body" data-four-phase="${esc(phase)}">${body}${phase === 'recheck' ? '' : fourUndoHtml(v)}${fourMapHtml(g)}</div>
    <div class="wizard-footer"><button type="button" class="link-btn danger-link" data-four="cancel">Cancel this bracket</button></div>`;
}

function renderBracketFour(container, g) {
  if (fourUi.gid !== g.id) { fourUi.gid = g.id; fourUi.choosing = false; fourUi.order = []; }
  container.__fourGid = g.id;
  fourWire(container);
  const html = `<div class="four-entry">${fourScreenHtml(g)}</div>`;
  const raw = fourBracketOf(g);
  const ids = teamIds();
  const phase = raw ? fourPhase(raw, ids) : 'start';
  if (!setLiveHtmlIfChanged(container, html, [g])) return;
  // Rebuilt: the live tally and the copy button of the match under way are bound to the new nodes.
  const cur = raw ? fourCurrent(raw, ids) : null;
  if (cur) {
    bindMatchupCopy(container, g, FOUR_NAMES[cur.key], cur.a, cur.b);
    bindMatchTracker(container, g, cur.a, cur.b);
  }
  fourMotion(container, g, phase);
}

// The flow moving on (a winner recorded, the next step, an Undo, the Re-check card appearing): the step line's current step
// snaps in, the new match arrives the way Now's card does (up 14px, landing with its squash), the Re-check card unfolds from its
// top, and the map's cells that changed pop their tags (nowB4Motion). Only for a change made while the takeover was showing this
// game (a first paint is a plain write). Calm: the match and the card fade, nothing else moves (no transform keyframe while calm).
function fourMotion(container, g, phase) {
  const was = container.__fourPhase;
  const same = container.__fourMotionGid === g.id;
  container.__fourPhase = phase;
  container.__fourMotionGid = g.id;
  const memo = same && container.__fourB4 ? container.__fourB4 : (container.__fourB4 = { sig: null, pending: new Map() });
  const b4 = fourBracketOf(g) ? nowBracket4({ myTeam: nowMyTeam() }, g) : null;
  const live = same && was !== undefined && typeof JellyMotion !== 'undefined' && typeof container.querySelector === 'function';
  if (typeof nowB4Motion === 'function') nowB4Motion(container, b4, memo, live);
  if (!live || was === phase) return;
  const step = container.querySelector('.four-steps .wizard-step');
  if (step) JellyMotion.play(step, 'snap', (x) => ({ transform: 'scale(' + (0.6 + 0.4 * x) + ')' }), { calm: false });
  const card = container.querySelector('.four-recheck');
  const match = container.querySelector('[data-four-match]') || container.querySelector('.gres') || container.querySelector('.four-pairs');
  if (card && typeof nowUnfold === 'function') nowUnfold(card);
  else if (match && typeof nowArrive === 'function') nowArrive(match);
}

function fourWire(container) {
  if (container.__fourWired || typeof container.addEventListener !== 'function') return;
  container.__fourWired = true;
  container.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (t) fourEntryTap(t, container);
  });
}

// The words for a refused tap: what the person needs to know, in plain English. The screen is repainted for the ones that mean it
// was out of date.
const FOUR_WHY = {
  readonly: 'Only a director can record the bracket.',
  saved: 'This game’s result is already saved.',
  team: 'Your team plays in this match, so another director decides it.',
  decided: 'That match was already recorded. The screen now shows what is saved.',
  order: 'The bracket moved on. The screen now shows where it is.',
  recheck: 'A result needs checking first.',
  none: 'This bracket is gone. The screen now shows where things are.',
  unfinished: 'Every match has to be played, and agree, before the result can be saved.',
  pairs: 'Pick four different teams first.',
  started: 'This bracket was already started.',
  match: 'The screen now shows where the bracket is.',
  winner: 'The screen now shows who plays.',
  unresolved: 'That did not settle it. The screen now shows what is left.',
};
const FOUR_THE = { s1: 'Semifinal 1', s2: 'Semifinal 2', third: 'the 3rd place match', final: 'the final' };
function fourSay(r) {
  if (!r || r.ok) return;
  // A match that was already recorded says who won it, so the director sees at once whether it is the result they meant to record.
  const decided = r.reason === 'decided' && r.winner && FOUR_THE[r.match]
    ? 'Already recorded: ' + teamName(r.winner) + ' won ' + FOUR_THE[r.match] + '. The screen now shows what is saved.' : '';
  showToast(decided || FOUR_WHY[r.reason] || 'That did not go through.');
  if (['decided', 'order', 'recheck', 'none', 'match', 'winner', 'unresolved', 'started'].indexOf(r.reason) !== -1) renderAll();
}

// One tap in the entry area, resolved when it fires (never closed over from the render that made the button).
function fourEntryTap(t, container) {
  const g = gameById(container.__fourGid || '');
  if (!g || !canEdit()) return false;
  const win = t.closest('.winner-btn');
  const btn = t.closest('[data-four]');
  const had = focusWas(win || btn);
  const heading = () => (container.querySelector ? container.querySelector('[data-four-h]') : null);
  // A tap that moved the bracket on lands the director at the top of the new screen (the step bar and the heading), with focus on
  // the heading when it was on the button that was tapped; a refusal is said, and the screen repainted.
  const moved = (r) => {
    fourSay(r);
    if (!r || !r.ok) return;
    const body = document.getElementById('takeover-game-body');
    if (body) body.scrollTop = 0;
    focusBack(had, heading());
  };
  // The acts that move the bracket on to a screen whose first button sits under the same thumb (see bracketTapHeld): one at a time.
  const once = (run, kind) => {
    if (bracketTapHeld(kind)) return true;
    const r = run();
    if (r && r.ok) bracketTapDone(kind);
    moved(r);
    return true;
  };
  if (win) {
    const host = t.closest('[data-four-match]');
    return once(() => fourRecordTap(g, host ? host.dataset.fourMatch : '', win.dataset.winner));
  }
  if (!btn) return false;
  const act = btn.dataset.four;
  const ids = teamIds();
  if (act === 'choose') { fourUi.choosing = true; fourUi.order = []; renderAll(); return true; }
  if (act === 'unchoose') { fourUi.choosing = false; fourUi.order = []; renderAll(); return true; }
  if (act === 'pick') { fourUi.order = fourPickTap(fourUi.order, btn.dataset.team, ids); renderAll(); return true; }
  if (act === 'start-plan' || act === 'start-pick') {
    const pairs = act === 'start-plan' ? fourSeedPlan(g).pairs : fourPairsValid([fourUi.order.slice(0, 2), fourUi.order.slice(2, 4)], ids) ? [fourUi.order.slice(0, 2), fourUi.order.slice(2, 4)] : null;
    return once(() => {
      const r = fourStartGame(g, pairs);
      if (r.ok) { fourUi.choosing = false; fourUi.order = []; }
      return r;
    });
  }
  if (act === 'undo') return once(() => fourUndoTap(g), 'undo');
  if (act === 'keep' || act === 'back') return once(() => fourResolveTap(g, act));
  if (act === 'save') { fourSay(fourSaveResult(g)); return true; }
  if (act === 'cancel' || act === 'clear') { fourCancelTap(g, act === 'clear'); return true; }
  if (act === 'reload') {
    if (reloadBlocked() && !confirm('You have something unfinished here (an unsent message, a score being typed, or a running timer). Reload anyway?')) return true;
    doReload();
    return true;
  }
  return false;
}

// Cancel this bracket / Clear this bracket: asked first, then gone on every phone (nothing is saved, the live tally goes with it).
async function fourCancelTap(g, unreadable) {
  const opts = unreadable
    ? { title: 'Clear this bracket?', body: 'It goes away on every phone and cannot be brought back. Reload first if a newer version might be able to read it.', actions: [{ label: 'Clear it', value: 'yes', kind: 'danger' }, { label: 'Keep it', value: 'cancel', cancel: true }] }
    : { title: 'Cancel this bracket?', body: 'Nothing is saved, and the bracket goes away on every phone.', actions: [{ label: 'Cancel the bracket', value: 'yes', kind: 'danger' }, { label: 'Keep it', value: 'cancel', cancel: true }] };
  const yes = typeof askDialog === 'function' ? (await askDialog(opts)) === 'yes' : confirm(opts.title + '\n\n' + opts.body);
  // The answer may have taken a while: the result may have been saved, or this phone may have lost its right to.
  if (!yes || !canEdit() || state.results[g.id] || !fourBracketOf(g)) return false;
  cancelBracket(g, 'four');
  return true;
}

// ── Theme ────────────────────────────────────────────────────────

// Which look applyTheme() last put on screen ('dark' | 'light'); null until the
// first call, so the initial paint never counts as a flip.
let appliedLook = null;

// A flip changes every surface and token in one style recalc, but anything with
// its own colour transition (card/banner borders, chip and link colours) would
// keep fading on its own timer behind them — a half-flipped page for ~150ms.
// html.theme-switching (styles.css) turns transitions off for the flip frames.
// Called BEFORE the classes change, so the same recalc that flips the tokens
// starts no transitions; removed two frames on (the timeout covers a hidden
// tab, where rAF is paused). Shadow-DOM Jelly parts aren't reached by it and
// repaint through jelly-theme-change.
function suspendThemeTransitions() {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  const done = () => root.classList.remove('theme-switching');
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(done));
  setTimeout(done, 250);
}

function applyTheme() {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = state.theme === 'dark' || (state.theme === null && prefersDark);
  const look = dark ? 'dark' : 'light';
  if (appliedLook !== null && appliedLook !== look) suspendThemeTransitions();
  appliedLook = look;
  // Only an EXPLICIT Dark sets the class. Auto is the @media block in
  // styles.css, which follows the OS live: setting the class from prefersDark
  // here froze the dark tokens in place when the OS later flipped to light (the
  // podium rows kept their dark tints under now-dark text) — applyTheme only
  // ran at boot and on a tap, never on an OS change.
  document.body.classList.toggle('dark-theme', state.theme === 'dark');
  document.body.classList.toggle('light-theme', !dark && state.theme === 'light');
  // Mirror an explicit choice where boot-guard.js can read it before paint.
  try {
    if (state.theme === 'dark' || state.theme === 'light') localStorage.setItem(THEME_HINT_KEY, state.theme);
    else localStorage.removeItem(THEME_HINT_KEY);
  } catch (e) { /* storage blocked: the guard just can't pre-paint it */ }
  // Drive Jelly UI's document-level tokens the same way: an explicit choice
  // maps 1:1 onto data-jelly-mode; auto removes the attribute so Jelly's own
  // prefers-color-scheme fallback tracks live OS flips (mirroring the app's
  // @media token block). Canvas-painted Jelly components repaint on the
  // jelly-theme-change event.
  if (state.theme === 'dark' || state.theme === 'light') {
    document.documentElement.setAttribute('data-jelly-mode', state.theme);
  } else {
    document.documentElement.removeAttribute('data-jelly-mode');
  }
  window.dispatchEvent(new CustomEvent('jelly-theme-change'));
  // Reflect the choice into More's Theme control (radio buttons: aria-checked
  // only, never a click, so no feedback loop).
  paintSeg(document.getElementById('theme-toggle'), state.theme === 'dark' ? 'dark' : state.theme === 'light' ? 'light' : 'auto');
  applyChromeColor();
}

// The browser chrome (the status bar of a Home Screen app) is the colour of what is
// at the TOP of the screen: the paper header in both themes, or the camp-blue roof
// while a broadcast takeover (.takeover.is-roof — the reveal remote, Tell everyone;
// Steps 23–24) is up. Keep these hexes in step with --paper and --roof in styles.css
// and with the pre-paint <meta name="theme-color"> pair in index.html.
const CHROME_PAPER = { light: '#f5efe2', dark: '#0c1030' };
const CHROME_ROOF = '#2c47ee';
const CHROME_INK = { light: '#141a48', dark: '#f3f4ff' }; // the preview bar (styles.css --ink in each theme)

function roofUp() {
  const el = document.querySelector && document.querySelector('.takeover.is-roof:not([hidden])');
  return !!(el && el.classList && el.classList.contains('is-roof') && !el.hidden);
}

function applyChromeColor() {
  // The app can override the OS theme, so keep the browser chrome color in step.
  // A no-media meta appended last wins over the pre-paint media metas.
  let meta = document.getElementById('dynamic-theme-color');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.id = 'dynamic-theme-color';
    document.head.appendChild(meta);
  }
  const look = appliedLook === 'dark' ? 'dark' : 'light';
  // The preview bar is the strongest thing on the screen, so the status bar takes its ink (the bar reaches under it).
  const color = counselorPreviewOn ? CHROME_INK[look] : roofUp() ? CHROME_ROOF : CHROME_PAPER[look];
  if (meta.content !== color) meta.content = color;
}

// Auto follows the OS. The page itself already does (the @media block), but the
// no-media theme-color meta above beats the pre-paint media metas and is only
// written here, so without this the status bar kept the old colour after a
// dusk/dawn OS flip until the next reload. Only Auto cares — an explicit choice
// ignores the OS.
function watchOsColorScheme() {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onFlip = () => { if (state.theme === null) applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onFlip);
    else if (mq.addListener) mq.addListener(onFlip); // Safari < 14
  } catch (e) { /* no matchMedia: nothing to follow */ }
}

// Called from the Appearance segmented control: 'light' | 'auto' | 'dark'.
// 'auto' maps to null so applyTheme falls back to the OS preference —
// restoring an option the old two-state toggle couldn't express.
function setTheme(choice) {
  state.theme = choice === 'dark' ? 'dark' : choice === 'light' ? 'light' : null;
  saveState();
  applyTheme();
}

// ── Calm motion row (More → Calm motion: Auto · On · Off) ────
// The switch and the verdict both live in jelly-motion.js (device-local, never
// in synced state: a phone's battery is its own business). This is only the
// row: the three-part control, and one line saying what is happening RIGHT NOW.
function calmReasonLine(pref, calm, reason) {
  if (reason === 'os') return "Your phone asks for less motion. Change it in your phone's Settings."; // two lines at 360px: the note reserves two
  if (reason === 'switch-on') return 'Calm all the time, as you chose.';
  if (reason === 'battery-saver') return 'Calm right now: your phone is saving battery.';
  if (reason === 'battery-low') return 'Calm right now: your battery is low.';
  if (pref === 'off') return 'Full motion, as you chose.';
  // One short state line (§7.1); what Auto watches is the control's
  // aria-description in index.html, not a paragraph under it.
  return calm ? 'Calm right now.' : 'Full motion right now.';
}

function renderCalmRow() {
  const pref = JellyMotion.pref();
  // aria-checked only — never a click, so no feedback loop.
  paintSeg(document.getElementById('calm-toggle'), pref);
  setTextIfChanged(document.getElementById('calm-reason'), calmReasonLine(pref, calmMotion(), calmReason()));
}

// Called from the Calm motion segmented control: 'auto' | 'on' | 'off'.
function setCalmPref(choice) {
  JellyMotion.setPref(choice);
  renderCalmRow();
}

function applySoundIcon() {
  const el = document.getElementById('sound-toggle');
  if (el) el.toggleAttribute('checked', soundOn());
  paintSwitchWord('sound-toggle', soundOn());
}

function toggleSound() {
  state.sound = !soundOn();
  if (!soundOn()) cutAllSound();
  else playHighScore(); // quick confirmation blip
  saveState();
  applySoundIcon();
}

// ── "What's new" banners ─────────────────────────────────────────
// Each CHANGES entry shows a dismissible banner at the top for two hours after
// it shipped, then expires on its own. Dismissals are per-device (localStorage)
// and per-change id, so clearing one banner doesn't clear the others.
const CHANGE_TTL_MS = 2 * 60 * 60 * 1000; // advertise a change for two hours
const CHANGE_DISMISS_KEY = lsKey('campScoreboardDismissedChanges');

function dismissedChanges() {
  try { return JSON.parse(localStorage.getItem(CHANGE_DISMISS_KEY) || '[]') || []; }
  catch (e) { return []; }
}

function dismissChange(id) {
  const d = dismissedChanges();
  if (!d.includes(id)) {
    d.push(id);
    try { localStorage.setItem(CHANGE_DISMISS_KEY, JSON.stringify(d)); } catch (e) { /* fine */ }
  }
}

// The two-hour window counts only "awake" time — it pauses overnight (9pm–8am
// camp time) so a change that ships late at night isn't spent before anyone
// sees it; it resumes advertising in the morning. Quiet hours are camp-local
// (America/New_York, matching every other timestamp in the app), not device
// time.
const QUIET_START_HOUR = 21; // 9pm — pause the timer
const QUIET_END_HOUR = 7;    // 7am — resume the timer (first notice rolls in at 7am)

function campHour(ms) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, hour: '2-digit', hour12: false }).format(new Date(ms));
  return parseInt(h, 10) % 24; // some engines format midnight as "24"
}

function isAwakeHours(ms) {
  const h = campHour(ms);
  return h >= QUIET_END_HOUR && h < QUIET_START_HOUR; // 7am–9pm
}

// Awake (non-quiet) milliseconds elapsed between two instants. Sampled at a
// coarse step — the spans involved are short (a change is only ever live across
// at most one night, since there are 13 awake hours a day vs a 2-hour budget),
// and minute-level accuracy is plenty for a banner. Stops early once the cap is
// reached.
function awakeElapsedMs(fromMs, toMs, capMs) {
  if (toMs <= fromMs) return 0;
  const STEP = 5 * 60 * 1000;
  let awake = 0;
  for (let t = fromMs; t < toMs; t += STEP) {
    if (isAwakeHours(t)) {
      awake += Math.min(STEP, toMs - t);
      if (capMs != null && awake >= capMs) return awake; // no need to keep counting
    }
  }
  return awake;
}

// The banners are a QUEUE, not a wall: they roll in one at a time, one every
// 15 minutes, and only during awake hours (7am–9pm). A change shipped overnight
// waits for 7am; the rest follow at 15-minute intervals behind it. So the
// batch below, all shipped late at night, starts appearing at 7am and
// advances every 15 minutes.
const CHANGE_SPACING_MS = 15 * 60 * 1000; // at most one new banner per 15 minutes

// The first awake instant at/after t: if t falls in quiet hours, jump forward
// to ~8am; otherwise t itself.
function nextAwakeSlot(t) {
  const STEP = 5 * 60 * 1000;
  let x = t, guard = 0;
  while (!isAwakeHours(x) && guard < 4000) { x += STEP; guard++; }
  return x;
}

// The instant `addMs` of AWAKE time after fromMs (quiet hours don't count).
function addAwakeMs(fromMs, addMs) {
  const STEP = 5 * 60 * 1000;
  let x = fromMs, remaining = addMs, guard = 0;
  while (remaining > 0 && guard < 8000) {
    x += STEP;
    if (isAwakeHours(x)) remaining -= STEP;
    guard++;
  }
  return x;
}

// Release time of each CHANGES entry (in list order): the later of its own
// awake-slotted ship time and 15 minutes (awake) behind the previous
// release, so they queue up one per 15 minutes. Deterministic from the `at`
// values.
function changeReleases() {
  const list = (typeof CHANGES !== 'undefined' ? CHANGES : []);
  const releases = [];
  let prev = null;
  for (let i = 0; i < list.length; i++) {
    const shipped = Date.parse(list[i] && list[i].at);
    let r = nextAwakeSlot(isNaN(shipped) ? Date.now() : shipped);
    if (prev != null) {
      const spaced = addAwakeMs(prev, CHANGE_SPACING_MS);
      if (spaced > r) r = spaced;
    }
    releases[i] = r;
    prev = r;
  }
  return releases;
}

// One banner at a time: the newest entry that has rolled in, isn't dismissed,
// and is still inside its two-hour awake window. Each is superseded by the next
// as its 15-minute slot arrives.
function activeChanges() {
  const now = Date.now();
  const dismissed = dismissedChanges();
  const list = (typeof CHANGES !== 'undefined' ? CHANGES : []);
  const releases = changeReleases();
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (!c || !c.id || !c.text) continue;
    const r = releases[i];
    if (now < r) continue;                                        // hasn't rolled in yet
    if (dismissed.includes(c.id)) continue;
    if (awakeElapsedMs(r, now, CHANGE_TTL_MS) >= CHANGE_TTL_MS) continue; // past its window
    return [c];
  }
  return [];
}

function renderWhatsNew() {
  const wrap = document.getElementById('whats-new');
  if (!wrap) return;
  const active = activeChanges();
  if (!active.length) { setHiddenIfChanged(wrap, true); if (wrap.innerHTML) wrap.innerHTML = ''; return; }
  setHiddenIfChanged(wrap, false);
  wrap.innerHTML = active.map((c) => `
    <div class="whats-new-banner" role="status">
      <button class="whats-new-dismiss" data-change-id="${esc(c.id)}" aria-label="Dismiss this update">✕</button>
      <span class="whats-new-badge">New update</span>
      <span class="whats-new-text">${esc(c.text)}</span>
    </div>`).join('');
  wrap.querySelectorAll('.whats-new-dismiss').forEach((btn) => {
    btn.addEventListener('click', () => { dismissChange(btn.dataset.changeId); renderWhatsNew(); });
  });
}

// ── Broadcast announcements: banners (📣) ────────────────────────
// Director-posted messages that sync to every phone (state.announcements —
// see SYNC_KEYS) and pin at the top of Now until they expire or each viewer
// dismisses them. Dismissal is per-device (like the what's-new banners);
// taking one down is a director's act and removes it for everyone. Every
// banner expires on its own: Tell everyone (tell.js) picks a duration (1 hour
// by default), stamped as `ttlMs` on the entry; expired entries stop
// rendering everywhere immediately and editor devices prune them from synced
// state (per-child null pushes) as housekeeping. There is NO composer here any
// more: the one place a banner is written is Tell everyone, through postBanner.
const ANNOUNCE_DISMISS_KEY = lsKey('campScoreboardDismissedAnnouncements');
const ANNOUNCE_DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const ANNOUNCE_TTL_CHOICES = [
  { key: '1h', ms: 60 * 60 * 1000, label: '1 hour' },
  { key: '3h', ms: 3 * 60 * 60 * 1000, label: '3 hours' },
  { key: 'day', ms: 24 * 60 * 60 * 1000, label: 'All day' },
];
const BANNER_MAX = 280; // characters (Tell everyone's message limit)
// Announcements posted before this deploy predate expiry support — treat
// them all as already expired (the one-time "delete everything currently
// up" cleanup, 2026-07-24).
const ANNOUNCE_PURGE_BEFORE = Date.parse('2026-07-24T10:13:24Z');

// When an announcement stops showing, as epoch ms. Unparseable `at` or a
// pre-expiry-era post → 0 (already expired). Missing/invalid ttlMs (old
// entries, RTDB-pruned fields) falls back to the 1-hour default.
function announcementExpiresAt(a) {
  const posted = Date.parse((a && a.at) || '');
  if (!Number.isFinite(posted)) return 0;
  if (posted < ANNOUNCE_PURGE_BEFORE) return 0;
  return posted + (Number(a.ttlMs) > 0 ? Number(a.ttlMs) : ANNOUNCE_DEFAULT_TTL_MS);
}

function announcementExpired(a) {
  return Date.now() >= announcementExpiresAt(a);
}

// Editor-side housekeeping: drop expired entries from synced state so the
// database doesn't accumulate dead announcements. Not touchData() — pruning
// isn't scoreboard activity (see "Footer timestamps" in CLAUDE.md).
function pruneExpiredAnnouncements() {
  if (!canEdit()) return;
  let pruned = false;
  Object.entries(state.announcements || {}).forEach(([id, a]) => {
    if (!a || announcementExpired(a)) {
      delete state.announcements[id];
      pruned = true;
    }
  });
  if (pruned) saveState();
}

function dismissedAnnouncements() {
  try { return JSON.parse(localStorage.getItem(ANNOUNCE_DISMISS_KEY) || '[]') || []; } catch (e) { return []; }
}

function dismissAnnouncement(id) {
  const d = dismissedAnnouncements();
  if (d.includes(id)) return;
  d.push(id);
  try { localStorage.setItem(ANNOUNCE_DISMISS_KEY, JSON.stringify(d)); } catch (e) { /* fine */ }
}

// Every synced banner still up, newest first (entries partially pruned by RTDB
// are render-guarded like bonuses). Expired ones never show, on any device, even
// before the editor prune has deleted them from synced state. A director's
// "Showing now" (Tell everyone) lists these whether or not THIS phone dismissed
// them: a dismissal is only ever one phone's.
function liveAnnouncements() {
  return Object.values(state.announcements || {})
    .filter((a) => a && a.id && a.text && !announcementExpired(a))
    .sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
}

// What Now's strip shows: the live banners this phone hasn't dismissed.
function activeAnnouncements() {
  const dismissed = dismissedAnnouncements();
  return liveAnnouncements().filter((a) => !dismissed.includes(a.id));
}

// A time of day in camp time ("4:52 PM"); with the weekday ahead of it when it
// was not today ("Tue 4:52 PM") unless `timeOnly`. Never the phone's own zone, and never the narrow
// no-break space newer engines put before PM.
function messageClock(iso, timeOnly) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  try {
    const fmt = (o) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: CAMP_TZ }, o)).formatToParts(d);
    const t = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
    const get = (parts, type) => ((parts.find((p) => p.type === type) || {}).value || '').replace(/[  ]/g, ' ');
    const clock = get(t, 'hour') + ':' + get(t, 'minute') + ' ' + get(t, 'dayPeriod').toUpperCase();
    const day = (x) => new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).format(x);
    return timeOnly || day(d) === day(new Date()) ? clock : get(fmt({ weekday: 'short' }), 'weekday') + ' ' + clock;
  } catch (e) { return ''; }
}

// ONE function writes a message banner (BANNER MARKUP in index.html): Now's strip draws every banner with it
// and Tell everyone's "On a counselor's phone" draws the one it is about to send, so the preview can never
// drift from the real thing. The one blue tint; no badge, no emoji, no capitals. `m` is a synced announcement
// ({id, text, at, by}) or a chat-sourced one ({…, fromChat: true}). opts.preview: the meta reads "Now · Jenn",
// no Remove, and the dismiss × is drawn but inert (the preview's CSS takes its pointer events away).
// opts.editor: a director's "Remove for everyone" on a synced banner (never on a chat one: delete it in chat).
function messageHtml(m, opts) {
  opts = opts || {};
  const chat = !!m.fromChat;
  const when = opts.preview ? 'Now' : messageClock(m.at);
  const metaHtml = [chat ? 'Announcements chat' : '', when, m.by || ''].filter(Boolean).map((x) => esc(x)).join(' · ');
  const id = esc(m.id || '');
  const remove = opts.editor && !opts.preview && !chat
    ? `<button type="button" class="msg-remove" data-ann-id="${id}">Take down for everyone</button>` : '';
  return `<div class="msg" data-kind="${chat ? 'chat' : 'banner'}" data-key="ann-${id}" role="status">` +
    `<span class="msg-ico" aria-hidden="true"><svg class="ico"><use href="#${chat ? 'i-bubble' : 'i-megaphone'}"/></svg></span>` +
    `<div class="msg-body"><p class="msg-text">${esc(m.text)}</p><p class="msg-meta"><span>${metaHtml}</span>${remove}</p></div>` +
    `<button type="button" class="msg-x" data-ann-id="${id}" aria-label="Dismiss this announcement on this phone"><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button>` +
    `</div>`;
}

// The join bar (setup-rebuild-spec §11.1, ux-R10): a director's "Taylor Reed is asking to join · See" in Now's message strip, one bar for
// everyone waiting, dismissible per phone. A requester's name is escaped; the dismissal is kept in MEMORY only (a stranger's address is never
// written to a phone), so a reload shows the bar again until somebody decides — the badges stay until then anyway.
const joinBarSeen = new Set();

function joinBarRequests() {
  return canEdit() && typeof peopleRequests === 'function' ? peopleRequests().filter((r) => !joinBarSeen.has(r.key + '|' + r.at)) : [];
}

function joinBarHtml() {
  const reqs = joinBarRequests();
  if (!reqs.length) return '';
  const text = reqs.length === 1 ? reqs[0].name + ' is asking to join' : reqs.length + ' people are asking to join';
  return `<div class="msg" data-kind="join" data-key="join" role="status">` +
    `<span class="msg-ico" aria-hidden="true"><svg class="ico"><use href="#i-people"/></svg></span>` +
    // One link that says where it goes ("People   See" read as the phrase "People See"), at 16px: link ink on the dark message tint is
    // 6.3:1, which clears the contrast rule from 16px, never at the 13px meta size.
    `<div class="msg-body"><p class="msg-text">${esc(text)}</p><p class="msg-meta"><button type="button" class="msg-remove msg-join-see" data-join-see>See who’s asking<svg class="ico" aria-hidden="true"><use href="#i-chev-r"/></svg></button></p></div>` +
    `<button type="button" class="msg-x" data-join-x aria-label="Dismiss this on this phone"><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button></div>`;
}

// Now's message strip. Chat's Announcements channel rides it for 15 minutes per message (chat.js provides them
// pre-filtered; same dismissed set). Runs on every renderAll and the 30 s tick, so it writes only a change
// (setHtmlIfChanged / paintKeyedList) and its two buttons are ONE delegated listener, wired once.
// Motion (§9.5), only for a change seen on screen: a banner that arrives drops in from above and squashes on
// landing (annArrive), one dismissed here squashes out (playRowOut) and the rest glide up by key, and the sections
// under the strip glide to their new places instead of jumping. Never on the first paint, on the paint that brings
// Now back into view (its whole panel arrives then), before the first server snapshot (the cache and then the
// snapshot at boot), or under a takeover. A change somebody else made waits until no finger is on the screen.
// Calm: arrivals fade, the rest jump.
// How many messages the strip holds before the rest go behind "N more messages" (redesign §3.2: about a third of the screen). This
// COUNT is the upper bound: three messages, the notice strip counting as one, one fewer once the root text is 130% or more. Without
// now-ui.js there is no strip to cap, so everything shows as it always did.
function annStripCap() {
  if (typeof renderNow !== 'function') return Infinity;
  let scale = 1;
  try { scale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16; } catch (e) { /* no layout: the normal cap */ }
  const noticeUp = noticePosted() && !(nowLast && nowLast.card && nowLast.card.kind === 'notice');
  return Math.max(1, (scale >= 1.3 ? 2 : 3) - (noticeUp ? 1 : 0));
}
// …and then the strip is MEASURED, because a count cannot see how tall a message really is (a long banner, a notice with its
// team line, iOS large text, which never changes the root font size): trailing messages go behind "N more messages" until the
// notice plus the messages shown fit in a third of the window. The messages are measured at the strip's own width in a hidden
// copy that is added and removed at once, and only when the messages or the width changed (`annFit`), so an idle render writes
// nothing. With no layout (the test harness, Now not on screen) the count stands. With no notice the newest message always shows.
let annFit = { sig: '', ext: [] };
function annStripRoom(items) {
  const cap = Math.min(items.length, annStripCap());
  const tab = document.getElementById('tab-now');
  if (!cap || !tab || typeof tab.getBoundingClientRect !== 'function' || typeof window === 'undefined') return cap;
  const box = tab.getBoundingClientRect();
  const vh = window.innerHeight || 0;
  if (!(box.width > 0) || !(vh > 0)) return cap;
  let cs = null;
  try { cs = getComputedStyle(tab); } catch (e) { return cap; }
  const w = Math.round(box.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
  const sig = w + '|' + items.join('\u0001');
  if (annFit.sig !== sig) {
    const m = document.createElement('div');
    m.className = 'announcements';
    m.setAttribute('aria-hidden', 'true');
    m.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;width:' + w + 'px';
    m.innerHTML = items.join('');
    tab.appendChild(m);
    const top = m.getBoundingClientRect().top;
    annFit = { sig, ext: Array.prototype.map.call(m.children, (c) => c.getBoundingClientRect().bottom - top) };
    m.remove();
  }
  if (!(annFit.ext[0] > 0)) return cap;
  const notice = document.getElementById('now-notice');
  const nh = notice && !notice.hidden ? notice.getBoundingClientRect().height : 0;
  const budget = vh / 3 - (nh > 0 ? nh + (parseFloat(cs.rowGap) || 0) : 0);
  let k = 0;
  while (k < cap && annFit.ext[k] <= budget) k++;
  return nh > 0 ? k : Math.max(1, k);
}
// What the strip had no room for, as markup (#sheet-messages' body) and a count (#now-msgs-more).
let annOverflow = { n: 0, html: '' };

function renderAnnouncements() {
  const wrap = document.getElementById('announcements');
  if (!wrap) return;
  const fromChat = (typeof chatAnnouncementBanners === 'function') ? chatAnnouncementBanners() : [];
  const active = activeAnnouncements().concat(fromChat)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const editor = canEdit();
  const joinHtml = joinBarHtml();
  const items = (joinHtml ? [joinHtml] : []).concat(active.map((a) => messageHtml(a, { editor })));
  const room = annStripRoom(items);
  const html = items.slice(0, room).join('');
  const count = Math.min(items.length, room);
  annOverflow = { n: items.length - count, html: items.slice(count).join('') };
  const onScreen = activeTab() === 'now' && shell.dirty.now === false && !shellTakeoverOpen() && !builderOpen();
  const moving = onScreen && wrap.__annLive === true && typeof wrap.animate === 'function' && typeof JellyMotion !== 'undefined';
  wrap.__annLive = onScreen && remoteReady;
  if (!moving) {
    wrap.__keyedWant = html;
    setHiddenIfChanged(wrap, !count);
    setHtmlIfChanged(wrap, html);
  } else annPaintMoving(wrap, html, count);
  const more = document.getElementById('now-msgs-more');
  setHiddenIfChanged(more, !annOverflow.n);
  if (annOverflow.n) setTextIfChanged(document.getElementById('now-msgs-more-text'), annOverflow.n + ' more message' + (annOverflow.n === 1 ? '' : 's'));
  if (typeof renderNowSheet === 'function' && shell.sheets.includes('messages')) renderNowSheet('messages');
  if (wrap.__wired) return;
  wrap.__wired = true;
  wrap.addEventListener('click', annStripClick);
}

// The strip's taps (one delegated listener, here and on #sheet-messages-body): See who's asking, dismiss on this phone, and a
// director's Remove for everyone.
function annStripClick(e) {
  const t = e.target && e.target.closest ? e.target : null;
  if (t && t.closest('[data-join-see]')) { if (typeof setupOpenPeople === 'function') setupOpenPeople(); return; }
  const jx = t && t.closest('[data-join-x]');
  if (jx) {
    playRowOut(jx.closest('.msg'), () => { joinBarRequests().forEach((r) => joinBarSeen.add(r.key + '|' + r.at)); glideNow(renderAnnouncements); });
    return;
  }
  const x = t && t.closest('.msg-x');
  if (x) {
    const id = x.dataset.annId;
    playRowOut(x.closest('.msg'), () => { dismissAnnouncement(id); glideNow(renderAnnouncements); });
    return;
  }
  const rm = t && t.closest('.msg-remove');
  if (!rm) return;
  if (!canEdit()) return;
  const a = (state.announcements || {})[rm.dataset.annId];
  if (!a) return;
  // The same take down as Tell everyone's Showing now: no question (OK / Cancel is not how this app asks), the
  // banner squashes out and a 10-second Undo puts it back only if it is still down and unexpired.
  if (typeof tellTakeDown === 'function') { tellTakeDown('banner', a.id, rm.closest('.msg')); return; }
  if (!confirm(`Remove this announcement from every phone?\n\n"${a.text}"`)) return;
  takeDownBanner(a.id);
  touchData();
  saveState();
  renderAnnouncements();
}

// The strip's change, painted with motion (renderAnnouncements decided it may move). The sections under the strip
// are measured before and after, and each that is on screen glides from where it was (they are static sections whose
// own renderers rewrite only their insides, so a WAAPI transform on the section leaves no residue).
function annPaintMoving(wrap, html, n) {
  if (wrap.__html === html && wrap.__dom === wrap.innerHTML) { wrap.__keyedWant = html; setHiddenIfChanged(wrap, !n); return; }
  wrap.__keyedWant = html;
  const run = () => {
    if (wrap.__keyedWant !== html || (wrap.__html === html && wrap.__dom === wrap.innerHTML)) return;
    const below = annBelow(wrap);
    const had = {};
    Array.prototype.forEach.call(wrap.children, (c) => { if (c.dataset && c.dataset.key) had[c.dataset.key] = 1; });
    setHiddenIfChanged(wrap, !n);
    if (wrap.children.length && !calmMotion()) {
      try { JellyMotion.flipKeyed(wrap, html, 'glide'); } catch (e) { wrap.innerHTML = html; }
    } else wrap.innerHTML = html;
    wrap.__html = html;
    wrap.__dom = wrap.innerHTML;
    Array.prototype.forEach.call(wrap.children, (c) => { if (c.dataset && c.dataset.key && !had[c.dataset.key]) annArrive(c); });
    if (!calmMotion()) annGlideBelow(below);
  };
  if (listGlideNow) run(); else JellyMotion.whenHandsOff(run);
}

// The sections after the strip that are on screen, with where they are now.
function annBelow(wrap) {
  const out = [];
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
  for (let el = wrap.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.hidden) continue;
    const top = el.getBoundingClientRect().top;
    if (top > vh) break;
    out.push({ el, top });
  }
  return out;
}
function annGlideBelow(below) {
  below.forEach(({ el, top }) => {
    const dy = top - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    JellyMotion.play(el, 'glide', (x) => ({ transform: 'translateY(' + dy * (1 - x) + 'px)' }), { calm: false });
  });
}
// A banner arrives: it drops 56px from above and spends its overshoot as a ~6% landing squash, anchored at its foot
// (scale(1+.18o, 1−.5o); arrive overshoots ~12%). Calm: a fade.
function annArrive(node) {
  JellyMotion.play(node, 'arrive', (x) => {
    const o = Math.max(0, x - 1);
    return {
      transform: 'translateY(' + (-56 * (1 - Math.min(1, x))) + 'px) scale(' + (1 + 0.18 * o) + ', ' + (1 - 0.5 * o) + ')',
      transformOrigin: '50% 100%',
      opacity: Math.min(1, x * 2),
    };
  }, { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 160 });
}

// The two writes of a banner, plain state edits with no render and no save (the caller — Tell everyone, a Take
// down, an Undo — saves once, after everything it changed). Directors only.
function postBanner(text, ttlMs, now) {
  if (!canEdit()) return null;
  const clean = String(text || '').trim().slice(0, BANNER_MAX);
  if (!clean) return null;
  const id = newBonusId();
  state.announcements = state.announcements || {};
  state.announcements[id] = {
    id, text: clean, at: (now instanceof Date ? now : new Date()).toISOString(),
    by: frameMyName(), ttlMs: Number(ttlMs) > 0 ? Number(ttlMs) : ANNOUNCE_DEFAULT_TTL_MS,
  };
  return id;
}

function takeDownBanner(id) {
  if (!canEdit() || !state.announcements || !state.announcements[id]) return false;
  delete state.announcements[id];
  return true;
}

// Toast (and, with notifications on, a lock-screen notification) for
// announcements that arrived in a remote snapshot. prevMap is the
// announcements map as it stood BEFORE the merge, so echoes of this
// device's own post never re-notify.
function notifyNewAnnouncements(prevMap) {
  const dismissed = dismissedAnnouncements();
  let anyNew = false;
  Object.keys(state.announcements || {}).forEach((id) => {
    if (prevMap && id in prevMap) return;
    const a = state.announcements[id];
    if (!a || !a.text || dismissed.includes(id)) return;
    if (announcementExpired(a)) return; // a stale entry syncing in late shouldn't ping
    anyNew = true;
    showToast('📣 ' + a.text);
    if (state.notify) maybeNativeNotification('📣 Camp announcement', a.text, 'camp-announcement-' + id);
  });
  // Subscribed phones also get the audible/tactile ping — an announcement is
  // for everyone, so it uses the brighter "mine" chime.
  if (anyNew && state.notify) {
    playMineChime();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

// ── Auto-reload on new deploy ────────────────────────────────────
// Each client polls the deployed index.html (same-origin, no-store) and compares
// its app.js?v= number to the one THIS page is running. When the deploy is
// newer, it reloads to catch up — immediately for viewers, but only when it's
// safe for an editor (not mid score-entry), with a tap-to-refresh bar in the
// meantime so an in-progress score is never lost. This is deploy-driven, so it
// works on a single device without Firebase or another client announcing it.
// (A client only starts polling once it's running a build that has this code —
// so a given phone auto-reloads from the NEXT deploy after it loads this one.)
let newVersionSeen = false;
const UPDATE_POLL_MS = 2 * 60 * 1000;

// The focus half of editorMidEntry: is someone typing or choosing in a field
// right now? Background re-renders (renderAllWhenIdle) wait on this alone —
// the rest of editorMidEntry means "a write is queued", which a clock settling
// at zero always sets itself, so gating on all of it would defer that render
// every single time.
function fieldFocused() {
  const ae = document.activeElement;
  // Jelly form controls surface as the focused element's HOST (JELLY-INPUT,
  // JELLY-TEXTAREA, JELLY-SELECT, JELLY-OTP) — a focused one is mid-entry
  // exactly like a native field; missing this would let a deploy's auto-reload
  // eat a score being typed.
  // It is an ALLOWLIST on purpose. Every Jelly component delegates focus, so
  // on Android/desktop Chrome a plain tap on a Jelly host (a jelly-tabs header),
  // a jelly-button or a chip leaves THAT host focused — and the old
  // `startsWith('JELLY-')` test counted it as typing, which froze live updates
  // on that phone until something else took focus (verified 2026-10-26).
  // ...and the chat composer is NOT score entry. Counting it would defer every
  // incoming scoreboard update for as long as anyone sits with the message box
  // focused, which during a game is exactly when people are chatting.
  const inChatComposer = ae && ae.closest && ae.closest('#chat-view');
  return !!(!inChatComposer && ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' ||
      /^JELLY-(INPUT|TEXTAREA|SELECT|OTP)$/.test(ae.tagName || '') || ae.isContentEditable));
}

function editorMidEntry() {
  if (fieldFocused()) return true;
  // A half-built game in the week builder is unsaved in-memory work — the
  // update-poll auto-reload and remote merges must not wipe it.
  if (typeof builderDirty === 'function' && builderDirty()) return true;
  // a real edit is typed/queued but not yet synced — including a push an undecided
  // tab is holding (tabMayPush): the timer that asked for it has already fired
  // (and a setup edit still inside its 300 ms window, or a setup push an undecided tab holds)
  return dataEditPending || pushTimer != null || pushConfigTimer != null || tabHeldState || tabHeldConfig ||
    tabHeldSetup || (typeof setupBusy === 'function' && setupBusy()) ||
    (typeof tellComposerBusy === 'function' && tellComposerBusy());
}

// Send any debounced push right now (e.g. when a score field loses focus, or
// the page is being hidden) so an entered value reaches the server promptly
// instead of waiting out the coalescing timer. Covers the week-config push too:
// iOS suspends setTimeout the moment the phone locks, so a game edited in the
// builder right before locking would otherwise strand its 400ms push and never
// reach the other devices.
function flushPendingPush() {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; pushState(); }
  if (pushConfigTimer) { clearTimeout(pushConfigTimer); pushConfigTimer = null; pushConfig(); }
  if (typeof flushSetupPush === 'function') flushSetupPush();
}

// The app.js build number this page loaded with, read off its own <script> tag.
function myAppVersion() {
  const s = document.querySelector('script[src*="app.js?v="]');
  const m = s && (s.getAttribute('src') || '').match(/app\.js\?v=(\d+)/);
  return m ? Number(m[1]) : null;
}

async function checkForUpdate() {
  if (newVersionSeen) return;
  const mine = myAppVersion();
  if (!mine) return;
  try {
    const res = await fetch('index.html?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/app\.js\?v=(\d+)/);
    const deployed = m ? Number(m[1]) : null;
    if (deployed && deployed > mine) onNewVersion();
  } catch (e) { /* offline / blocked — just try again next tick */ }
}

function startUpdatePolling() {
  setInterval(checkForUpdate, UPDATE_POLL_MS);
  // Phones spend most of camp locked; check the moment the tab comes back too.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  checkForUpdate();
}

// Reload with a cache-buster on the page URL so we actually fetch the new
// index.html (and thus the new ?v assets), never a stale cached copy — which
// would otherwise bounce us straight back into "update available" forever.
function doReload() {
  // A reload mid-session must reopen on the same tab: stamp the shell so the
  // "away more than 10 minutes" rule (shellBoot) doesn't read it as a cold start.
  try { shellStamp(); persistState(); } catch (e) { /* the reload goes ahead */ }
  try {
    const u = new URL(location.href);
    u.searchParams.set('r', String(Date.now()));
    // location.replace() would start a new document whose history.state is null,
    // so shellBoot read "not ours" and the next reconcile filed a second Now and
    // tab ABOVE the old ones: Back from Games then took two presses and Back on Now
    // stopped leaving the app. Rewriting the URL in place keeps the entry (and the
    // shell's state in it); the unseen ?r= still makes the reload fetch a fresh
    // index.html, and it still can't loop.
    if (typeof history !== 'undefined' && history.replaceState) {
      history.replaceState(history.state, '', u.toString());
      location.reload();
    } else {
      location.replace(u.toString());
    }
  } catch (e) {
    location.reload();
  }
}

// (The "new version" bar and the "can't connect" pill are the header's status pill
// now — renderSyncPill / wirePill: its tap asks before a reload throws away
// unsent work, sampling reloadBlocked() at pointerdown because the tap itself
// blurs a chat composer.)

// Work that only exists on THIS page and would vanish in a reload. The RTDB
// web SDK keeps its offline write queue in memory only, so a reload while a
// saved score is still unconfirmed (pendingWrites > 0 — e.g. the deploy poll
// won the race with a reconnect) loses it outright, and the next load's first
// snapshot then overwrites the cached copy. Same for a running Pictionary lap
// (in-memory stopwatch) and a chat message being typed or still uploading —
// those block the reload for EVERY role, not just editors. A synced game clock
// deliberately does NOT block: its endAt is in the database and survives a
// reload, and holding every editor's hotfix for a whole game would be worse.
function reloadBlocked() {
  if (pendingWritesTotal() > 0) return true;
  // A refused batch being re-sent path by path already counts in pendingWrites;
  // named here too so the union stays readable (see "Refused writes").
  if (stateBisecting) return true;
  if (directorTab() && editorMidEntry()) return true;
  if (Object.values(liveWatches || {}).some((w) => w && w.running)) return true;
  if (typeof chatComposerBusy === 'function' && chatComposerBusy()) return true;
  // a director mid-reveal (a real reveal live on this phone, or a command not yet acknowledged): reload after it (reveal.js)
  if (typeof revealBusy === 'function' && revealBusy()) return true;
  if (typeof tellComposerBusy === 'function' && tellComposerBusy()) return true; // a message being typed in Tell everyone, or a send going out (tell.js)
  if (typeof rainBusy === 'function' && rainBusy()) return true; // a rain plan being made (setup-ui.js: only while open and touched in the last 2 minutes)
  if (typeof schedItemBusy === 'function' && schedItemBusy()) return true; // a Schedule item with edits not yet saved (setup-ui.js)
  if (typeof teamEditBusy === 'function' && teamEditBusy()) return true; // a team sheet with edits not yet saved, or a photo going up (setup-ui.js)
  if (typeof peopleBusy === 'function' && peopleBusy()) return true; // a People sheet with edits not yet saved, or a write still going (setup-ui.js)
  if (typeof campersBusy === 'function' && campersBusy()) return true; // camper names waiting for the signal, or a camper write going: held in memory only, a reload would lose them (setup-sync.js)
  if (typeof campersUiBusy === 'function' && campersUiBusy()) return true; // a camper sheet with a name typed and not yet saved (setup-ui.js)
  if (typeof wizardBusy === 'function' && wizardBusy()) return true; // the new-year setup: a commit going out, or the wizard open and touched in the last 2 minutes (setup-sync.js)
  if (typeof gmBusy === 'function' && gmBusy()) return true; // a new game with a name typed and nothing saved yet (setup-ui.js: the game sheet)
  return false;
}

function reloadWhenSafe() {
  if (reloadBlocked()) { setTimeout(reloadWhenSafe, 12000); return; } // check back shortly
  // Re-check at the last moment: a score saved in these 1.2 s must not be lost either.
  setTimeout(() => (reloadBlocked() ? reloadWhenSafe() : doReload()), 1200);
}

function onNewVersion() {
  if (newVersionSeen) return; // a reload is already scheduled/pending
  newVersionSeen = true;
  renderSyncPill();
  reloadWhenSafe();
}

// ── Init ─────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════
// THE SHELL — four tabs, takeovers, sheets, history (redesign §2, §13)
// ════════════════════════════════════════════════════════════════════
// Three containers, one job each: a TAB is a place you live (Now, Games, Chat,
// More), a TAKEOVER is something you do (a game today), a SHEET is something
// you read and leave (the schedule). The source of truth stays where it always
// was — state.ui.tab, state.ui.gameId, state.ui.view === 'settings', and the
// open sheets — and everything else is DERIVED from it on every renderAll:
// which panel shows, which takeover is up, and what the browser's history
// stack must look like so the phone's Back does the obvious thing. Nothing
// below ever pushes history from a click handler; a handler changes state and
// renderAll → shellSync() reconciles the stack against it.
//
// HISTORY (§13.5). The stack is always [Now] + [the tab, unless it is Now] +
// one entry per open overlay, so every entry's snapshot is a pure function of
// its top (shellChain), and a plan from one snapshot to another is a pure
// function too (shellHistPlan). Leaving Now for a tab pushes ONE entry (Back
// returns to Now; Back on Now leaves the app), moving between non-Now tabs
// REPLACES it, a takeover or sheet pushes, "Next game" replaces the takeover's
// entry. Entry URLs are never touched (no hash): a hash is only an INPUT, a
// deep link, consumed at boot. Entries carry {campShell:1, tab, ov:[…]}, so a
// reload, Back, Forward or a long-press jump all land on a known snapshot that
// shellApply() paints.
//
// DIRTY RENDER (§13.2). Only the visible tab's renderer runs on a snapshot or
// the 30 s tick; the others are marked dirty and catch up when shown. A panel
// whose renderer has SIDE EFFECTS (standings: the change history, point
// alerts, the rank baseline — §13.9) must not live behind this: those stay in
// SHELL_ALWAYS until they are lifted out.

const SHELL_TABS = ['now', 'games', 'chat', 'more'];
// Away longer than this and the app reopens on Now (§13.4); also how long a
// reload remembers a tab / takeover.
const SHELL_RESUME_MS = 10 * 60 * 1000;

const shell = {
  cur: null,       // the history entry we believe the browser is on (a snapshot); null = not ours / unknown
  root: null,      // what is painted: a tab id, or 'builder'
  dirty: { now: true, games: true, chat: true, more: true },
  scroll: { now: 0, games: 0, chat: 0, more: 0 }, // document scroll per tab (a takeover and the chat panel scroll themselves)
  sheets: [],      // open sheet ids, oldest first
  opener: null,    // the element that opened the takeover / a sheet, focus returns to it
  q: [],           // pending history ops (a Back must finish before the next push)
  busy: false,
  busyTimer: null,
  hiddenAt: 0,
  applying: false, // shellApply is painting a snapshot: nothing may reconcile mid-way
  bootSheet: null,
  wired: false,
  roof: false,     // a blue-roof takeover is up (the status bar follows it)
};

function shellTabOk(t) { return SHELL_TABS.includes(t); }

function activeTab() {
  const t = state && state.ui && state.ui.tab;
  return shellTabOk(t) ? t : 'now';
}

// What the document is currently showing: a tab, or the week builder (which
// still lives inside #tab-now until it becomes a takeover of its own).
function shellVisibleRoot() {
  return builderOpen() ? 'builder' : activeTab();
}

// ── snapshots (pure) ────────────────────────────────────────────────
// {tab, ov:[{k:'builder'} | {k:'game', id, from?} | {k:'sheet', id}]}
function shellSnap() {
  const ov = [];
  if (builderOpen()) ov.push({ k: 'builder' });
  const gid = state.ui.gameId;
  if (gid && gameById(gid)) {
    const o = { k: 'game', id: gid };
    if (shellTabOk(state.ui.gameFrom)) o.from = state.ui.gameFrom;
    ov.push(o);
  }
  if (revealRemoteIsOpen()) {
    const o = { k: 'reveal' };
    if (shellTabOk(state.ui.revealFrom)) o.from = state.ui.revealFrom;
    ov.push(o);
  }
  const tool = toolOpenId();
  if (tool) {
    const o = { k: tool };
    if (shellTabOk(state.ui.toolFrom)) o.from = state.ui.toolFrom;
    ov.push(o);
  }
  shell.sheets.forEach((id) => ov.push({ k: 'sheet', id }));
  return { tab: activeTab(), ov };
}

// A history entry's state is whatever a device wrote (or an older build left),
// so it is validated like any other stored input: exactly this shape or null.
function shellSnapFromRaw(raw) {
  if (!raw || typeof raw !== 'object' || raw.campShell !== 1) return null;
  const ov = [];
  (Array.isArray(raw.ov) ? raw.ov : []).slice(0, 4).forEach((o) => {
    if (!o || typeof o !== 'object') return;
    if (o.k === 'builder') ov.push({ k: 'builder' });
    else if (o.k === 'game' && typeof o.id === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(o.id)) {
      const g = { k: 'game', id: o.id };
      if (shellTabOk(o.from)) g.from = o.from;
      ov.push(g);
    } else if (o.k === 'reveal' || o.k === 'tell' || o.k === 'award') {
      const r = { k: o.k };
      if (shellTabOk(o.from)) r.from = o.from;
      ov.push(r);
    } else if (o.k === 'sheet' && typeof o.id === 'string' && /^[a-z0-9-]{1,24}$/.test(o.id)) ov.push({ k: 'sheet', id: o.id });
  });
  return { tab: shellTabOk(raw.tab) ? raw.tab : 'now', ov };
}

function shellSnapKey(s) {
  return s.tab + '|' + s.ov.map((o) => o.k + ':' + (o.id || '')).join(',');
}

// Every entry from the base up to `s` (the stack is fully determined by its top).
function shellChain(s) {
  const out = [{ tab: 'now', ov: [] }];
  if (s.tab !== 'now') out.push({ tab: s.tab, ov: [] });
  s.ov.forEach((o, i) => out.push({ tab: s.tab, ov: s.ov.slice(0, i + 1) }));
  return out;
}

// What to do to the browser's history to get from the entry it is on (`cur`,
// null when that entry isn't ours) to `want`. A single pop + single push is
// ONE replace: tab → tab, and "Next game" over the game it replaces.
function shellHistPlan(cur, want) {
  const b = shellChain(want);
  if (!cur) return [{ op: 'replace', s: b[0] }].concat(b.slice(1).map((s) => ({ op: 'push', s })));
  const a = shellChain(cur);
  let p = 0;
  while (p < a.length && p < b.length && shellSnapKey(a[p]) === shellSnapKey(b[p])) p += 1;
  const pops = a.length - p;
  const pushes = b.slice(p);
  if (!pops && !pushes.length) return [];
  if (pops === 1 && pushes.length === 1) return [{ op: 'replace', s: pushes[0] }];
  const ops = [];
  if (pops) ops.push({ op: 'back', n: pops });
  pushes.forEach((s) => ops.push({ op: 'push', s }));
  return ops;
}

// ── history runner ──────────────────────────────────────────────────
function shellEntryState(s) {
  const ov = s.ov.map((o) => {
    const x = { k: o.k };
    if (o.id) x.id = o.id;
    if (o.from) x.from = o.from;
    return x;
  });
  return { campShell: 1, tab: s.tab, ov };
}

function shellHistPump() {
  if (shell.busy) return;
  const hist = typeof history !== 'undefined' ? history : null;
  while (shell.q.length) {
    const op = shell.q.shift();
    try {
      if (!hist) continue;
      if (op.op === 'push' && hist.pushState) hist.pushState(shellEntryState(op.s), '');
      else if (op.op === 'replace' && hist.replaceState) hist.replaceState(shellEntryState(op.s), '');
      else if (op.op === 'back' && hist.go) {
        // The popstate this raises is OUR doing (the UI already shows where we
        // are), so the queue waits for it — a push issued before it would land
        // on the wrong entry. The timer is the no-popstate-ever safety net.
        shell.busy = true;
        shell.busyTimer = setTimeout(shellBackDone, 600);
        hist.go(-op.n);
        return;
      }
    } catch (e) { /* no history API (or a sandbox): Back just leaves, as before */ }
  }
}

function shellBackDone() {
  if (shell.busyTimer) { clearTimeout(shell.busyTimer); shell.busyTimer = null; }
  shell.busy = false;
  shellHistPump();
}

// Make the browser's stack match the state. `shell.cur` moves to `want` at
// once (the queued ops get it there), so a second call before they finish
// plans from where they will end up.
function shellReconcile() {
  if (shell.applying) return;
  const want = shellSnap();
  const ops = shellHistPlan(shell.cur, want);
  shell.cur = want;
  if (!ops.length) return;
  shell.q.push(...ops);
  shellHistPump();
}

// The phone's Back / Forward / a history jump: the entry it landed on says
// where we are; paint that. Our own queued Back lands here too, and is ignored.
function shellOnPopState(e) {
  if (shell.busy) { shellBackDone(); return; }
  shell.q.length = 0; // the person's navigation outranks whatever we had queued
  const s = shellSnapFromRaw(e && e.state) || { tab: 'now', ov: [] };
  shell.cur = s;
  shellApply(s);
}

// Paint a snapshot: open / close what it names, switch to its tab. Every piece
// of state moves first and the stack is reconciled once at the end (by the
// renderAll inside), so it never plans against a half-applied snapshot.
function shellApply(s) {
  // A Schedule item with unsaved edits is asked about first: Back keeps the sheet up (the reconcile in renderAll puts
  // the entry straight back) and the answer closes it, which files the pop again. Before anything below moves.
  // (Step 25 generalised this to every setup sheet that holds an edit: the Schedule item and a team: setupSheetGuardClose.)
  if (typeof setupSheetGuardClose === 'function' &&
      shell.sheets.some((id) => !s.ov.some((o) => o.k === 'sheet' && o.id === id) && setupSheetGuardClose(id))) {
    renderAll();
    return;
  }
  const game = s.ov.find((o) => o.k === 'game');
  const wantBuilder = s.ov.some((o) => o.k === 'builder');
  if (!wantBuilder && builderOpen()) {
    // Back out of an open game editor would strand its draft: ask first, and if
    // the answer is no the reconcile in renderAll puts the entry straight back
    // (shell.cur is the entry the browser is on, the builder is still open).
    const why = builderLeaveWarning();
    if (why && !confirm(why)) {
      renderAll();
      return;
    }
    if (why && typeof campersDiscardHeld === 'function') campersDiscardHeld();
    if (typeof discardGameDraft === 'function') discardGameDraft();
    state.ui.view = 'home';
  } else if (wantBuilder && !builderOpen() && canEdit()) {
    state.ui.view = 'settings';
    if (!state.ui.settingsTab) state.ui.settingsTab = 'games';
  }
  state.ui.gameId = game && gameById(game.id) ? game.id : null;
  if (game && game.from) state.ui.gameFrom = game.from;
  // The reveal remote is a takeover of its own (directors only; a Forward onto it as a counselor shows the tab).
  const rv = s.ov.find((o) => o.k === 'reveal');
  state.ui.revealOpen = !!(rv && revealRemoteMayOpen());
  if (rv && rv.from) state.ui.revealFrom = rv.from;
  // So are the director tools (Tell everyone, Award points): one at a time, a director's only.
  const tl = s.ov.find((o) => o.k === 'tell' || o.k === 'award');
  state.ui.tool = tl && toolMayOpen(tl.k) ? tl.k : null;
  if (tl && tl.from) state.ui.toolFrom = tl.from;
  state.ui.tab = s.tab;
  shell.applying = true;
  try {
    shell.sheets.slice().forEach((id) => {
      if (s.ov.some((o) => o.k === 'sheet' && o.id === id)) return;
      if (id === 'schedule' && typeof closeSchedule === 'function') closeSchedule();
      else shellSheetClose(id);
    });
    s.ov.filter((o) => o.k === 'sheet').forEach((o) => {
      if (shell.sheets.includes(o.id)) return;
      if (o.id === 'schedule' && typeof openSchedule === 'function') openSchedule();
      else shellSheetOpen(o.id);
    });
  } finally { shell.applying = false; }
  shellStamp();
  saveState();
  renderAll();
}

// ── painting ────────────────────────────────────────────────────────
function shellStamp() {
  if (state && state.ui) state.ui.shellAt = Date.now();
}

function shellTabIndex(root) {
  const i = SHELL_TABS.indexOf(root);
  return i < 0 ? 0 : i;
}

// The blob is one element resting where CSS puts it (#app[data-tab]); it
// springs from the old tab's place (JellyMotion snap, stretching with its
// velocity). Calm jumps: calm === false means no motion at all.
function shellSpringBlob(from, to) {
  const blob = document.getElementById('tabbar') && document.getElementById('tabbar').querySelector('.tab-blob');
  const row = document.getElementById('tabbar') && document.getElementById('tabbar').querySelector('.tabbar-row');
  if (!blob || !row || typeof JellyMotion === 'undefined' || !row.clientWidth) return;
  const dx = (shellTabIndex(from) - shellTabIndex(to)) * (row.clientWidth / SHELL_TABS.length);
  if (!dx) return;
  // Jelly stretch from the blob's own speed (px/s): long one way, thin the other
  // (§9.5: scale(1+s, 1−0.4s), s = min(.5, |v|/1600)).
  JellyMotion.play(blob, 'snap', (x, v) => {
    const s = Math.min(0.5, Math.abs(v * dx) / 1600);
    return { transform: `translateX(${dx * (1 - x)}px) scale(${1 + s}, ${1 - 0.4 * s})` };
  }, { calm: false });
}

// Pop the icon of the tab just chosen (a tiny press spring).
function shellPopIcon(tab) {
  const ico = document.querySelector(`#tabbar .tab[data-tab="${tab}"] .tab-ico`);
  if (!ico || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(ico, 'press', (x) => ({ transform: `scale(${0.78 + 0.22 * x})` }), { calm: false });
}

// The incoming panel arrives from 22px down, its top edge leading; the spring's
// overshoot becomes a ~4% squash instead of a bounce past rest (§9.5 row 1).
// fill 'backwards' (play's), so no transform outlives the motion: a transformed
// panel would capture the fixed Chat panel and the sticky pieces inside it.
function shellArrivePanel(root) {
  const panel = document.getElementById('tab-' + root);
  if (!panel || typeof JellyMotion === 'undefined') return;
  JellyMotion.play(panel, 'arrive', (x) => {
    const o = Math.max(0, x - 1);
    return {
      transform: `translateY(${22 * (1 - Math.min(1, x))}px) scale(${1 + 0.12 * o}, ${1 - 0.3 * o})`,
      transformOrigin: '50% 0',
      opacity: Math.min(1, x * 1.6),
    };
  }, { calm: [{ opacity: 0 }, { opacity: 1 }], calmMs: 120 });
}

// A takeover is up: a game, or the director's reveal remote (one at a time).
function shellTakeoverOpen() {
  return !!(state.ui.gameId && gameById(state.ui.gameId)) || revealRemoteIsOpen() || !!toolOpenId();
}

// Which panel shows, the tab buttons' state, the takeover's body class. Returns
// whether the visible root CHANGED, so the caller can restore its scroll after
// the new panel has rendered.
function shellPaint() {
  const root = shellVisibleRoot();
  const tab = activeTab();
  const prev = shell.root;
  const changed = root !== prev;
  if (changed && prev === 'chat' && typeof chatOnTabHidden === 'function') chatOnTabHidden();
  const app = document.getElementById('app');
  // The builder still lives inside #tab-now, so while it is up the Now panel is
  // the one in the layout (the tab buttons keep naming the tab to return to).
  const attr = root === 'builder' ? 'now' : root;
  if (app && app.getAttribute('data-tab') !== attr) app.setAttribute('data-tab', attr);
  document.querySelectorAll('#tabbar .tab').forEach((btn) => {
    const on = btn.dataset.tab === tab;
    if (on) { if (btn.getAttribute('aria-current') !== 'page') btn.setAttribute('aria-current', 'page'); }
    else if (btn.getAttribute('aria-current') !== null) btn.removeAttribute('aria-current');
  });
  const takeover = shellTakeoverOpen();
  document.body.classList.toggle('takeover-open', takeover);
  if (shell.roof !== roofUp()) { shell.roof = roofUp(); applyChromeColor(); } // the status bar follows the roof
  // Everything behind a takeover is unreachable for Tab and screen readers.
  if (app && 'inert' in app && !shell.sheets.length) app.inert = takeover;
  if (changed) {
    shell.root = root;
    if (prev && prev !== 'builder' && root !== 'builder') { shellSpringBlob(prev, root); shellPopIcon(root); shellArrivePanel(root); }
  }
  return changed;
}

// Put the incoming root's document scroll back (a tab remembers where it was;
// the builder, a takeover's host and the chat panel start at the top).
function shellRestoreScroll(root) {
  const y = root === 'now' || root === 'games' || root === 'more' ? (shell.scroll[root] || 0) : 0;
  shellScrollTo(y, false);
  if (root === 'chat' && typeof chatOnTabShown === 'function') chatOnTabShown();
}

function shellScrollTo(y, smooth) {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
  if (smooth && !calmMotion()) window.scrollTo({ top: y, behavior: 'smooth' });
  else window.scrollTo(0, y);
}

// Passive scroll listener: remembers the visible tab's document scroll, and
// shows the header's hairline only once something has moved under it. A
// takeover or the builder collapses the page, so those never write a tab's slot.
function shellOnScroll() {
  const header = document.getElementById('app-header');
  const y = (typeof window !== 'undefined' && window.scrollY) || 0;
  if (header) header.classList.toggle('is-scrolled', y > 2);
  const root = shell.root;
  if (root === 'now' || root === 'games' || root === 'more') {
    if (!shellTakeoverOpen() && !shell.sheets.length) shell.scroll[root] = y;
  }
}

// ── switching ───────────────────────────────────────────────────────
// Close whatever is stacked over the tabs before moving to one (a deep link, a
// notification tap). A builder with an unsaved game editor is never discarded
// silently.
function shellCloseOverlays() {
  shell.sheets.slice().forEach((id) => (id === 'schedule' && typeof closeSchedule === 'function' ? closeSchedule() : shellSheetClose(id)));
  state.ui.gameId = null;
  state.ui.revealOpen = false;
  state.ui.tool = null;
  if (builderOpen()) {
    const why = builderLeaveWarning();
    if (why && !confirm(why)) return false;
    if (why && typeof campersDiscardHeld === 'function') campersDiscardHeld();
    if (typeof discardGameDraft === 'function') discardGameDraft();
    state.ui.view = 'home';
  }
  return true;
}

function showTab(tab, opts) {
  opts = opts || {};
  if (!shellTabOk(tab)) return false;
  const stacked = shellSnap().ov.length > 0;
  if (tab === activeTab() && !stacked) {
    if (!opts.silent) shellRetap(tab);
    return true;
  }
  if (stacked && !shellCloseOverlays()) return false;
  state.ui.tab = tab;
  shellStamp();
  saveState();
  renderAll();
  return true;
}

// Tapping the tab you are on glides it to the top (Chat: to the newest message).
function shellRetap(tab) {
  if (tab === 'chat') {
    if (typeof chatScrollToBottom === 'function') chatScrollToBottom();
    return;
  }
  shellScrollTo(0, true);
}

// ── takeovers (the game) ────────────────────────────────────────────
// `from` names where the labelled back returns: the tab the game was opened on.
function openGame(gid, opts) {
  const g = gameById(gid);
  if (!g) return false;
  opts = opts || {};
  // Focus returns to the control that opened the takeover (kept across a
  // "Next game" swap: the opener is the first one).
  if (!state.ui.gameId) shell.opener = document.activeElement || null;
  state.ui.revealOpen = false; // one takeover at a time
  state.ui.tool = null;
  state.ui.gameId = g.id;
  state.ui.gameFrom = shellTabOk(opts.from) ? opts.from : activeTab();
  state.ui.gameDow = campNow().dow;
  state.ui.day = g.dayId;
  shellStamp();
  saveState();
  renderAll();
  return true;
}

function closeGame() {
  if (!state.ui.gameId) return;
  state.ui.gameId = null;
  shellStamp();
  saveState();
  renderAll(); // renderGameView hands focus back when the takeover goes (a Back gesture closes it too)
}

// ── takeovers (the director's reveal remote) ────────────────────────
// The reveal remote (#takeover-reveal, reveal-ui.js) is a takeover of its own: a director opens it from
// More → Run the reveal, Games' "Reveal these on the big screen" or Now's "Open the remote" (or the
// `reveal` deep link), the shell files ONE history entry for it, and Back closes it onto the tab it came
// from. State is device-local like the game's (`state.ui.revealOpen`, `revealFrom`). Reachable only for a
// director whose screens file loaded: without reveal-ui.js there is no remote, and a counselor has none.
function revealRemoteMayOpen() {
  return canEdit() && typeof renderRevealRemote === 'function';
}
function revealRemoteIsOpen() {
  return !!(state && state.ui && state.ui.revealOpen && revealRemoteMayOpen());
}

function openReveal(opts) {
  if (!revealRemoteMayOpen() || builderOpen()) return false;
  opts = opts || {};
  if (!state.ui.revealOpen) shell.opener = document.activeElement || null;
  state.ui.gameId = null; // one takeover at a time
  state.ui.tool = null;
  state.ui.revealOpen = true;
  state.ui.revealFrom = shellTabOk(opts.from) ? opts.from : activeTab();
  shellStamp();
  saveState();
  renderAll();
  return true;
}

function closeReveal() {
  if (!state.ui.revealOpen) return;
  state.ui.revealOpen = false;
  shellStamp();
  saveState();
  renderAll(); // renderRevealRemote slides it out and hands focus back (a Back gesture closes it too)
}

// ── takeovers (the director tools: Tell everyone, Award points) ──────
// Two more takeovers a director opens from More → Director (tell.js and award.js hold their screens, the static markup is
// #takeover-tell / #takeover-award in index.html). ONE at a time, like the game and the remote: `state.ui.tool`
// ('tell' | 'award', device-local) and `state.ui.toolFrom` (the tab the labelled Back returns to). Directors only, and only
// where the screen's script loaded (delete tell.js and More shows no Tell everyone row). Award points shows points, so it
// also waits for a CONFIRMED director (standingsVisible): a stale hint on a demoted phone opens nothing.
function toolScreenLoaded(id) {
  if (id === 'tell') return typeof renderTellEveryone === 'function';
  if (id === 'award') return typeof renderAwardPoints === 'function';
  return false;
}
function toolMayOpen(id) {
  return canEdit() && toolScreenLoaded(id) && (id !== 'award' || standingsVisible());
}
function toolOpenId() {
  const t = state && state.ui && state.ui.tool;
  return t && toolMayOpen(t) ? t : null;
}
function toolIsOpen(id) { return toolOpenId() === id; }

function openTool(id, opts) {
  if (!toolMayOpen(id) || builderOpen()) return false;
  opts = opts || {};
  if (!toolOpenId()) shell.opener = document.activeElement || null;
  state.ui.gameId = null; // one takeover at a time
  state.ui.revealOpen = false;
  state.ui.tool = id;
  state.ui.toolFrom = shellTabOk(opts.from) ? opts.from : activeTab();
  shellStamp();
  saveState();
  renderAll();
  return true;
}

function closeTool() {
  if (!state.ui.tool) return;
  state.ui.tool = null;
  shellStamp();
  saveState();
  renderAll(); // the screen slides out and hands focus back (a Back gesture closes it too)
}

// ── Preview as a counselor (redesign §7.4; Step 24) ─────────────────────────
// A director's phone shown the app the way a counselor's phone draws it, so a switch in What counselors see can be
// checked without a second phone. It is a LENS over the role, and every rule below is there so it can never leak or
// trap:
//   - It is `counselorPreviewOn`, memory only: never in state, never in storage, never the role or the auth hint.
//     A reload, a sign-out, a camp switch and the auto-update reload all end it; it is always the director's own
//     view the next time the page loads.
//   - It never touches `memberRole`. That would run the sign-in's own bookkeeping (the writer election, the undo
//     history, the reveal listeners, the pre-paint hint) for a person who is still a director. The lens is three
//     one-line reads and nothing else: canEdit() is false (every "directors only" gate refuses, with no second
//     list to keep), standingsVisible() is false (the ONE place that says who may see points: nothing computes or
//     draws one), isOwner() is false, and viewRole() says 'viewer' where the screen decides what to SHOW. The
//     renderers, the reveal's mirror view and the chat's hidden-section rule all follow those, so the preview is
//     the counselor's code path, not a copy of it.
//   - The engines do not follow it (directorTab): a snapshot arriving mid-preview still merges over unconfirmed
//     work, a queued push still goes out, a reload is still held for unsent work.
//   - Only a CONFIRMED director on a writer tab starts it (previewMayStart), from What counselors see. It ends by
//     the bar's Exit (always on screen, outside #app so it answers under a takeover or a sheet), by an absence
//     longer than the shell's 10 minutes, and by any change that makes the person not a confirmed director
//     (setMemberRole, a second tab taking the writer lock: previewMayRun, checked at the top of every render).
//   - What a counselor may DO and a preview must not: chat (send, photo, delete), phone-alert subscribe and
//     settings. Each refuses through previewRefuses() with one sentence. Everything else a counselor can tap is on
//     this phone only (theme, team, dismiss), as it is for them.
function previewMayRun() {
  return memberRole === 'editor' && memberRoleConfirmed && tabWriter !== false;
}

function previewMayStart() {
  return !!(appStarted && !counselorPreviewOn && previewMayRun());
}

function previewIsOn() { return counselorPreviewOn; }

// The one sentence every refused write says (a toast; chat's composer and the alert switches ask first).
function previewRefuses() {
  if (!counselorPreviewOn) return false;
  showToast('You are previewing as a counselor. Nothing is sent. Tap Exit to go back.');
  return true;
}

// The bar's height, measured into :root the way the header's is (it wraps at large text; the CSS value is only the
// one-line fallback). Never set while the bar is hidden, so nothing is left behind after Exit.
function previewMeasure() {
  const root = document.documentElement;
  const bar = document.getElementById('preview-bar');
  const h = counselorPreviewOn && bar ? Math.round(Number(bar.offsetHeight) || 0) : 0;
  if (h > 0) root.style.setProperty('--pv-h', h + 'px');
  else root.style.removeProperty('--pv-h');
}

// Everything that DRAWS the preview: the switch class (CSS moves the header, the Chat panel, the reveal strip, the
// takeovers and the sheets down by the bar), the bar, the frame, the browser chrome colour.
function previewPaint() {
  const on = counselorPreviewOn;
  document.documentElement.classList.toggle('counselor-preview', on);
  setHiddenIfChanged(document.getElementById('preview-bar'), !on);
  setHiddenIfChanged(document.getElementById('preview-frame'), !on);
  previewMeasure();
  applyChromeColor();
}

// The flag off and the bar down, with no render of its own (setMemberRole and renderAll call it from inside one).
function previewEnd() {
  if (!counselorPreviewOn) return false;
  counselorPreviewOn = false;
  previewPaint();
  return true;
}

// Why a tap on Preview as a counselor did nothing, in one sentence ('' when there is no reason to say). The screen opens
// for any phone that paints as a director, but a director whose role is only the stored hint (before the member record
// answers, or offline for a long time) cannot start one: a button that does nothing and says nothing is a dead button.
function previewWhyNot() {
  if (counselorPreviewOn) return '';
  if (!appStarted) return 'Still opening. Try again in a moment.';
  if (memberRole !== 'editor' || !memberRoleConfirmed) return 'Still signing you in. Try again in a moment.';
  if (tabWriter === false) return 'This tab is view-only. Preview from the tab that edits.';
  return '';
}

// The button's tap: start it, or say why not.
function previewTap() {
  if (previewStart()) return true;
  const why = previewWhyNot();
  if (why) showToast(why);
  return false;
}

function previewStart() {
  if (!previewMayStart()) return false;
  counselorPreviewOn = true;
  // The sheets a counselor has no door to (What counselors see itself, Who can sign in, change history, the
  // builder's) close now; renderAll closes the director's takeovers and the builder.
  shellCloseDisallowedSheets();
  previewPaint();
  applyRoleClass();
  updateAccountRow();
  renderAll();
  // The way in sits at the foot of What counselors see, usually with More scrolled down; the Director group is gone
  // now, so that scroll would open the counselor's More mid-page under the header. Start where a counselor's tab
  // starts: at the top (and the same again on Exit).
  previewScrollTop();
  const exit = document.getElementById('preview-exit');
  if (exit && typeof exit.focus === 'function') { try { exit.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
  return true;
}

// Exit. `back` (the bar's own button) lands the director where the preview began, which is always More: What counselors
// see opens again, so a switch can be changed and checked in a loop. Every other end (an absence, a role change)
// just lets go.
function previewStop(opts) {
  if (!previewEnd()) return false;
  if (appStarted) {
    applyRoleClass();
    updateAccountRow();
    renderAll();
    if (opts && opts.back && canEdit()) {
      shell.scroll.more = 0; // the tab is restored from its slot when it is shown
      if (activeTab() !== 'more') showTab('more');
      previewScrollTop();
      shellSheetOpen('counselors', document.getElementById('counselors-row'));
    }
  }
  return true;
}

function previewScrollTop(tries) {
  shell.scroll[activeTab()] = 0;
  if (activeTab() !== 'more') shell.scroll.more = 0;
  shellScrollTo(0, false);
  // Closing What counselors see pops its history entry, and the browser then puts back the scroll it remembered for
  // the entry it lands on (found at 130–200% text, where More is long): go to the top again once our own Back landed.
  if (shell.busy && (tries || 0) < 20) setTimeout(() => previewScrollTop((tries || 0) + 1), 40);
}

// A sheet that is open and not allowed for who the screen is now closes (a role the preview or a demotion took
// away): the drawers and sheets only ask shellSheetAllowed when they OPEN, so nothing else would.
function shellCloseDisallowedSheets() {
  shell.sheets.slice().forEach((id) => {
    if (id !== 'schedule' && !shellSheetAllowed(id)) shellSheetClose(id);
  });
}

function wirePreview() {
  const go = document.getElementById('counselors-preview-btn');
  if (go) go.addEventListener('click', () => previewTap());
  const exit = document.getElementById('preview-exit');
  if (exit) exit.addEventListener('click', () => previewStop({ back: true }));
  const bar = document.getElementById('preview-bar');
  if (bar && typeof ResizeObserver === 'function') new ResizeObserver(previewMeasure).observe(bar);
}

// "‹ More", "‹ Games", "‹ Now": where a tool's Back lands.
function shellToolBackLabel() {
  const from = shellTabOk(state.ui.toolFrom) ? state.ui.toolFrom : 'more';
  return from === 'games' ? 'Games' : from === 'chat' ? 'Chat' : from === 'now' ? 'Now' : 'More';
}

// "‹ More", "‹ Games", "‹ Now": where the remote's Back lands.
function shellRevealBackLabel() {
  const from = shellTabOk(state.ui.revealFrom) ? state.ui.revealFrom : 'more';
  return from === 'games' ? 'Games' : from === 'chat' ? 'Chat' : from === 'now' ? 'Now' : 'More';
}

// "‹ Now", "‹ Wednesday games", "‹ More": always a fixed place the Back lands on.
function shellGameBackLabel(g) {
  const from = shellTabOk(state.ui.gameFrom) ? state.ui.gameFrom : 'now';
  if (from === 'games') {
    const d = g ? dayById(g.dayId) : null;
    return d ? d.name + ' games' : 'Games';
  }
  return from === 'more' ? 'More' : from === 'chat' ? 'Chat' : 'Now';
}

// ── sheets ──────────────────────────────────────────────────────────
// Short reference you read and leave. The frame (.sheet-overlay in index.html)
// is shared: backdrop / ✕ / Escape / Back close it, the grab strip drags it
// down, focus is trapped while open and returns to the opener. `schedule` is
// the older #schedule-overlay, which keeps its own markup and motion and only
// reports here, so Back closes it too.
// The three jelly-drawers that remain (Alerts, Change history, Who can sign in)
// ride the same stack: the drawer keeps its own backdrop, focus and scroll lock;
// the shell only OPENS and CLOSES it and files the history entry, so phone Back
// closes it instead of popping the tab beneath. Their own ✕ / backdrop / Escape
// report back through the `close` event (wireShell).
const SHELL_DRAWERS = { alerts: 'alerts-overlay', history: 'history-overlay', members: 'members-overlay' };

function shellSheetEl(id) {
  if (id === 'schedule') return null;
  return document.getElementById(SHELL_DRAWERS[id] || 'sheet-' + id);
}

// What a deep link or a Forward may open: the director-only drawers need a director.
function shellSheetAllowed(id) {
  if (id === 'members' || id === 'history' || id === 'counselors') return canEdit();
  // The game sheet (setup-ui.js section 16) also opens over the Games tab, with the builder closed: Quick game and Add games are
  // there. Directors only, and only with a game a tap named (a Forward onto a stale entry opens nothing).
  if (id === 'game') return canEdit() && typeof gmSheetReady === 'function' && gmSheetReady();
  // Set up the week's own sheets (setup-ui.js): directors only, and only while the builder is up.
  if (typeof SETUP_SHEETS !== 'undefined' && SETUP_SHEETS.includes(id)) return canEdit() && builderOpen() && setupSheetReady(id);
  if (id === 'verse' || id === 'cleanup') return canEdit() || !(cardHiddenFromViewers(id) || cardEmptyForViewers(id));
  // The Games standings' two sheets (games-ui.js): quick points opens only for a team a tap named (a director's, never their
  // own team: a Forward onto a stale entry opens nothing); the copy / share / Award points sheet is a confirmed director's.
  if (id === 'quick') return typeof gamesQuickReady === 'function' && gamesQuickReady();
  if (id === 'standings') return standingsVisible() && typeof renderStandingsSheet === 'function';
  // Now's three reading sheets (now-ui.js): each only while it has something to say (a notice taken down or a banner
  // dismissed closes its sheet through the next fill; a Forward onto a stale entry opens nothing).
  if (id === 'notice' || id === 'messages' || id === 'whos-where') return typeof nowSheetAllowed === 'function' && nowSheetAllowed(id);
  return true;
}

function shellSheetOpen(id, opener) {
  if (shell.sheets.includes(id)) return;
  if (!shellSheetAllowed(id)) return;
  if (SHELL_DRAWERS[id]) {
    const d = shellSheetEl(id);
    if (!d) return;
    d.setAttribute('open', '');
    shell.sheets.push(id);
    shellReconcile();
    return;
  }
  if (id !== 'schedule') {
    const el = shellSheetEl(id);
    if (!el) return;
    el.hidden = false;
    shellSheetFill(id);
    shell.opener = opener || document.activeElement || null;
    el.style.pointerEvents = ''; // reopened mid-exit
    const sheet = el.querySelector('.sheet');
    const scrim = el.querySelector('.sheet-backdrop');
    if (sheet && typeof JellyMotion !== 'undefined') {
      // Thrown up from below; the overshoot is NOT more travel (that lifted the
      // whole sheet 67px off the bottom of the screen with the page showing
      // under it) but a stretch from the planted bottom edge (§9.5).
      JellyMotion.play(sheet, 'arrive', (x) => (x <= 1
        ? { transform: `translateY(${(1 - x) * 100}%)`, transformOrigin: '50% 100%' }
        : { transform: `scale(${1 - 0.25 * (x - 1)}, ${1 + 0.35 * (x - 1)})`, transformOrigin: '50% 100%' }));
      if (scrim) JellyMotion.play(scrim, 'glide', (x) => ({ opacity: Math.min(1, x) }), { calm: [{ opacity: 0 }, { opacity: 1 }] });
    }
    const close = el.querySelector('.sheet-close');
    if (close && typeof close.focus === 'function') { try { close.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
    const app = document.getElementById('app');
    if (app && 'inert' in app) app.inert = true;
  }
  shell.sheets.push(id);
  shellReconcile();
}

function shellSheetClose(id) {
  const i = shell.sheets.indexOf(id);
  if (i < 0) return;
  shell.sheets.splice(i, 1);
  if (SHELL_DRAWERS[id]) {
    const d = shellSheetEl(id);
    if (d && d.hasAttribute('open')) d.removeAttribute('open'); // its own close event lands here again and finds nothing to do
    shellReconcile();
    return;
  }
  if (id !== 'schedule') {
    const el = shellSheetEl(id);
    if (el) {
      // Slides back down (playOut: calm is a 140 ms fade) and is hidden at the
      // end — unless it was reopened meanwhile. Focus and inert are settled now,
      // below, not when the motion ends; the overlay stops taking taps at once.
      const sheet = el.querySelector('.sheet');
      const scrim = el.querySelector('.sheet-backdrop');
      const from = (sheet && sheet.style.transform) || 'translateY(0px)'; // a drag lets go from where the finger left it
      const done = () => {
        if (shell.sheets.includes(id)) return;
        el.hidden = true;
        el.style.pointerEvents = '';
        if (sheet) { sheet.style.transform = ''; sheet.style.transition = ''; }
      };
      if (sheet && typeof JellyMotion !== 'undefined' && !el.hidden) {
        el.style.pointerEvents = 'none';
        if (scrim) JellyMotion.playOut(scrim, (x) => ({ opacity: 1 - x }), 220);
        JellyMotion.playOut(sheet, (x) => ({ transform: x ? 'translateY(100%)' : from }), 220, done);
      } else done();
    }
    if (!shell.sheets.length) {
      const app = document.getElementById('app');
      if (app && 'inert' in app) app.inert = shellTakeoverOpen();
    }
    const o = shell.opener;
    shell.opener = null;
    if (o && o.isConnected !== false && typeof o.focus === 'function') { try { o.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }
  // A setup sheet that keeps state of its own (the game sheet) lets go of it now, not at the next paint.
  if (typeof setupSheetClosed === 'function') setupSheetClosed(id);
  shellReconcile();
}

// Drag the grab strip down to close; the list inside scrolls normally.
function wireSheetDrag(overlay) {
  const grab = overlay.querySelector('[data-sheet-grab]');
  const sheet = overlay.querySelector('.sheet');
  if (!grab || !sheet) return;
  let startY = null;
  let dy = 0;
  const id = overlay.id.replace(/^sheet-/, '');
  const end = () => {
    if (startY == null) return;
    startY = null;
    sheet.style.transition = calmMotion() ? '' : 'transform 0.2s ease';
    if (dy > 90) { shellSheetClose(id); return; } // the exit starts from where the finger let go
    sheet.style.transform = '';
  };
  grab.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; }, { passive: true });
  grab.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  grab.addEventListener('touchend', end);
  grab.addEventListener('touchcancel', () => { dy = 0; end(); });
}

// ── dirty render ────────────────────────────────────────────────────
// What each tab renders. Now: the Now card and what hangs off it, the messages strip. Games: the day picker, the day's
// blocks and the directors' standings (gamesModel, painted by games-ui.js; what the standings DO besides being drawn is in
// SHELL_ALWAYS below). More: its volatile lines. Memory verse and Meal cleanup are
// reading SHEETS opened from More: they render while open (renderShellSheets).
// The Games tab: the model painted by games-ui.js. Without that file the tab is empty (the standings' side effects still
// run). A stale day choice (a day the builder removed) is put right here, as the old day tabs did.
function gamesRefresh() {
  if (typeof renderGamesPanel !== 'function') return;
  const days = competitionDays();
  if (days.length && !days.some((d) => d.id === state.ui.day)) state.ui.day = defaultDay(state.config);
  renderGamesPanel(gamesModel());
}

const SHELL_PANELS = {
  now: {
    // The Now engine (nowModel, now-ui.js) paints the card, the moment, Still to do / Up next / Later today and the messages
    // strip: a full picture whenever the data moved. Without that file Now keeps the banners and nothing else.
    render() {
      renderWhatsNew();
      if (typeof renderNow === 'function') nowRefresh(); else renderAnnouncements();
    },
    // What changes with the clock alone (the 30 s tick): a full recompute only at a wake-up, else the clock part and the strip.
    tick() {
      renderWhatsNew();
      if (typeof renderNow === 'function') nowTick(); else renderAnnouncements();
      // the mirror's "Happening now" row follows the clock too (it is not a snapshot's business)
      if (typeof renderRevealMirror === 'function' && typeof confirmedReveal !== 'undefined') renderRevealMirror();
    },
  },
  games: {
    render() { gamesRefresh(); },
    // The block under way, "up next" and a day's "Today" move with the clock alone.
    tick() { gamesRefresh(); },
  },
  chat: {
    render() { if (typeof renderChatView === 'function') renderChatView(); },
    tick() {},
  },
  more: {
    render() { renderMore(); },
    tick() { renderMoreFoot(); },
  },
};

// Work that runs on every pass whatever tab is showing: it has side effects
// (runStandingsSideEffects records the change history, raises the point alerts and
// keeps the start-of-day place baseline for directors — lifted out of the old
// standings card, §13.9, so the Games panel that draws them paints only while it is
// on screen) or keeps state honest (pruning expired announcements).
const SHELL_ALWAYS = [
  () => pruneExpiredAnnouncements(),
  () => runStandingsSideEffects(),
  () => refreshOpenSchedule(),
];

function renderTab(tab) {
  const p = SHELL_PANELS[tab];
  if (p) p.render();
  shell.dirty[tab] = false;
}

// Called from renderAll: the visible tab renders, the rest wait.
function renderShellTabs() {
  const active = activeTab();
  SHELL_ALWAYS.forEach((fn) => fn());
  renderTab(active);
  SHELL_TABS.forEach((t) => { if (t !== active) shell.dirty[t] = true; });
}

// The 30 s tick and the wake-up: the time-driven part of the visible tab only.
function shellTick() {
  shellStamp();
  // The reveal's time-driven moments (the 8 AM hide, the 3 s look-at-the-big-screen window, an
  // unended reveal counting as over): a quiet 8:00 brings no snapshot, so no renderAll (reveal.js).
  if (typeof revealTick === 'function') revealTick('tick');
  if (typeof tellTick === 'function') tellTick(); // Showing now's "ends in 38 min" (tell.js: only while it is open)
  SHELL_ALWAYS.forEach((fn) => fn());
  const p = SHELL_PANELS[activeTab()];
  if (p) p.tick();
  SHELL_TABS.forEach((t) => { if (t !== activeTab()) shell.dirty[t] = true; });
  renderHeader();
  renderTabBadges();
}

// Counts on the tab bar. Patched in place — the buttons are static markup.
// ── People: asking to join, told to a director (setup-sync.js peopleRequests*; setup-rebuild-spec §11.1, ux-R10) ──
// A request arriving while a director has the app open is a toast; the same news stays on More's dot, the Set up the week count
// and the People row until somebody decides. A director of both camps also hears once, at load, about the OTHER camp's.
function joinRequestCount() {
  return typeof peopleRequests === 'function' && canEdit() ? peopleRequests().length : 0;
}

function onAccessRequestsChanged() {
  if (appStarted) renderAllWhenIdle();
}

function onAccessRequestsArrived(fresh) {
  const mine = identityKey(authUser);
  const others = (fresh || []).filter((r) => r && r.key !== mine);
  if (canEdit() && others.length) {
    showToast(others.length === 1 ? others[0].name + ' is asking to join' : others.length + ' people are asking to join', { duration: 6000 });
  }
  onAccessRequestsChanged();
}

function onOtherCampRequests(n) {
  if (!canEdit() || !n) return;
  showToast((n === 1 ? '1 person is' : n + ' people are') + ' asking to join ' + CAMPS[otherCampId()].label, { duration: 6000 });
}

// The join badges: More's gold dot, the counts on the Set up the week and People rows. A director's, from the requests listener (and, for a
// director of both camps, the other camp's count read once at load). Text and `hidden` only, so an idle pass writes nothing.
function renderJoinBadges() {
  const mine = joinRequestCount();
  const other = canEdit() && typeof pplReq !== 'undefined' ? pplReq.other.n : 0;
  setHiddenIfChanged(document.getElementById('tab-dot-more'), !(mine || other));
  const word = mine ? mine + ' asking to join' : '';
  ['more-join-count', 'more-people-count'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    setTextIfChanged(el, mine ? (id === 'more-people-count' ? String(mine) : word) : '');
    setHiddenIfChanged(el, !mine);
    if (id === 'more-people-count' && mine) { const t = mine + ' asking to join'; if (el.getAttribute && el.getAttribute('aria-label') !== t) el.setAttribute('aria-label', t); }
  });
}

function renderTabBadges() {
  renderJoinBadges();
  const chat = document.getElementById('tab-badge-chat');
  if (chat) {
    const hidden = typeof chatHiddenFromMe === 'function' && chatHiddenFromMe();
    const n = !hidden && typeof unreadTotal === 'function' ? unreadTotal() : 0;
    const text = n > 99 ? '99+' : n ? String(n) : '';
    if (chat.hidden !== (n === 0)) chat.hidden = n === 0;
    if (chat.textContent !== text) chat.textContent = text;
    const btn = document.getElementById('tab-btn-chat');
    const label = n ? 'Chat, ' + n + ' unread' : 'Chat';
    if (btn && btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
  }
}

// ════════════════════════════════════════════════════════════════════
// THE FRAME'S PIECES — team marks, the header, the status pill, the Your team
// sheet, and More (redesign §2.2, §7, §8.4, §13.1)
// ════════════════════════════════════════════════════════════════════
// Roots are split by VOLATILITY: the identity block changes only with identity /
// team / role / camp / the day, the pill flips with the connection, and More's
// volatile lines (the alerts verdict, the calm verdict, the account line, the
// footer) are text nodes of their own. Every writer below patches in place or
// writes through setHtmlIfChanged, so a connection flicker never re-creates the
// shield and a push-state change never rebuilds a segmented control under a finger.

// ── teamMark: the ONE helper for how a team looks (§8.4) ───────────
// A shield image when the camp ships one (junior), else a flag mark (senior), else
// an emoji tile. The shape of a flag comes from the team's ORDER so two teams stay
// apart under colour-blindness; its colour from CAMP.teamFlag. Callers that paint
// a long-lived spot (header, sheet, More row) use paintTeamMark, which writes only
// when the mark would change, so the <img> is never re-created by a re-render.
const TEAM_FLAG_SHAPES = ['plain', 'swallow', 'stripe', 'chevron'];
const TEAM_FLAG_COLORS = ['red', 'blue', 'green', 'gold'];

function teamMarkSpec(id) {
  teamPhotoNeed(id); // an uploaded photo is fetched only when a crest is about to be drawn; the shield / flag shows meanwhile
  const src = teamCrestSrc(id);
  if (src) return { kind: 'shield', src };
  const color = CAMP.teamFlag && CAMP.teamFlag[id];
  if (TEAM_FLAG_COLORS.includes(color)) {
    const i = Math.max(0, teamIds().indexOf(id));
    // A colour picked on the Teams screen IS the team's colour (§8.1 rule 5: one team, one colour): the flag's fill comes
    // from the palette swatch the record names (the half for the theme in force), and only the camp's built-in flag colour
    // stands in while the team has none. The SHAPE stays the team's order. `accent` is teamAccentVars' laundered pair.
    const accent = teamColorId(id) ? teamAccentVars(id) : '';
    return accent ? { kind: 'flag', color, shape: TEAM_FLAG_SHAPES[i % TEAM_FLAG_SHAPES.length], accent }
      : { kind: 'flag', color, shape: TEAM_FLAG_SHAPES[i % TEAM_FLAG_SHAPES.length] };
  }
  // The accent goes into a style attribute: only what teamAccentVars let through (hex digits and fixed names) ever does.
  return { kind: 'tile', emoji: teamEmoji(id), accent: teamAccentVars(id) };
}

// opts.size: px width (default 34); opts.label: spoken name ('' = decorative,
// the name is printed beside it).
function teamMarkHtml(id, opts) {
  const size = Math.max(12, Math.min(160, Number(opts && opts.size) || 34));
  const label = (opts && opts.label) || '';
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  const spec = teamMarkSpec(id);
  const tm = `--tm:${size}px`;
  if (spec.kind === 'shield') {
    return `<img class="tm tm-shield" data-team="${esc(id)}" src="${esc(spec.src)}" alt="${esc(label)}" style="${tm}" width="${size}" height="${Math.round(size * 667 / 480)}" decoding="async">`;
  }
  if (spec.kind === 'flag') {
    // A picked palette colour beats the data-flag rule's fill (an inline custom property wins); [data-team] picks its theme half.
    const fill = spec.accent ? ';' + spec.accent + ';--flag-fill:var(--team)' : '';
    return `<svg class="tm flag" data-team="${esc(id)}" data-flag="${spec.color}" style="${tm}${fill}" viewBox="0 0 32 32" ${a11y}><use href="#flag-${spec.shape}"/></svg>`;
  }
  // The tile's edge is the team's colour for the theme in force: [data-team] turns the -l/-d pair into --team.
  return `<span class="tm tm-tile" data-team="${esc(id)}" style="${tm}${spec.accent ? ';' + spec.accent + ';--tm-accent:var(--team)' : ''}" ${a11y}>${spec.emoji}</span>`;
}

function paintTeamMark(el, id, opts) {
  if (!el) return false;
  return setHtmlIfChanged(el, teamMarkHtml(id, opts));
}

// textContent only when it differs: a text node patched in place never replays
// anything and never drops a selection.
function setTextIfChanged(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}
function setHiddenIfChanged(el, hidden) {
  if (el && el.hidden !== hidden) el.hidden = hidden;
}
function setClassNameIfChanged(el, name) {
  if (el && el.className !== name) el.className = name;
}
// An attribute / data-* only when it differs (a same-value write is still a mutation record, and
// render-stability's MutationObserver pass counts it). null, undefined and false remove it; true is the
// empty-string boolean attribute.
function setAttrIfChanged(el, name, v) {
  if (!el) return;
  if (v === null || v === undefined || v === false) { if (el.getAttribute(name) !== null) el.removeAttribute(name); return; }
  const s = v === true ? '' : String(v);
  if (el.getAttribute(name) !== s) el.setAttribute(name, s);
}
function setDataIfChanged(el, key, v) {
  if (!el || !el.dataset) return;
  if (v === null || v === undefined || v === false) { if (key in el.dataset) delete el.dataset[key]; return; }
  const s = v === true ? '' : String(v);
  if (el.dataset[key] !== s) el.dataset[key] = s;
}
// Radio-group keys for a plain `.seg` of `.seg-btn[role=radio]`: the arrows move the choice and the focus
// with it (choose(btn) does the choosing).
function segArrowKeys(seg, choose) {
  seg.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    const btns = [...seg.querySelectorAll('.seg-btn')].filter((b) => !b.hidden);
    const i = btns.findIndex((b) => b === document.activeElement || b.getAttribute('aria-checked') === 'true');
    const next = btns[(Math.max(0, i) + dir + btns.length) % btns.length];
    if (!next) return;
    e.preventDefault();
    choose(next);
    next.focus();
  });
}

// ── the header (§2.2) ──────────────────────────────────────────────
function frameRoleWord() { return viewRole() === 'editor' ? 'Director' : 'Counselor'; }

// A person's own name as the app knows it: the member record's, else the
// "which one are you?" pick. '' when neither is set (never a guess from the email).
function frameMyName() {
  const n = memberName && String(memberName).trim();
  if (n) return n;
  return state.identity ? canonicalCounselorName(state.identity) : '';
}

function followedTeam() {
  const tid = state.followTeam;
  return tid ? (state.teams || NO_ITEMS).find((t) => t.id === tid) || null : null;
}

function headerModel() {
  const team = followedTeam();
  const me = frameMyName();
  const role = frameRoleWord();
  const day = dayLabel(campNow().dow);
  // Sentence case, as everywhere in the frame (§8.2): "Junior camp".
  const camp = campWord();
  // The headline is what you're FOR: your team, or, with no team, the camp. A
  // director on both camps must never lose which one this is to a long name
  // (mockup 02: "Junior camp" over "Jenn · Director · Wednesday").
  return {
    teamId: team ? team.id : null,
    name: team ? team.name : (camp || role),
    sub: (team ? [me, camp, day] : [me, role, day]).filter(Boolean).join(' · '),
    who: (team ? [me, teamShort(team.id) || team.name] : [me, role]).filter(Boolean).join(' · '),
  };
}

const HDR_CAMP_MARK = '<svg class="ico"><use href="#i-sun"/></svg>';

function renderHeader() {
  const idBtn = document.getElementById('hdr-id');
  if (!idBtn) return;
  const m = headerModel();
  const mark = document.getElementById('hdr-mark');
  if (mark) {
    if (m.teamId) {
      if (mark.classList.contains('hdr-campmark')) mark.classList.remove('hdr-campmark');
      paintTeamMark(mark, m.teamId, { size: 34 });
    } else {
      if (!mark.classList.contains('hdr-campmark')) mark.classList.add('hdr-campmark');
      setHtmlIfChanged(mark, HDR_CAMP_MARK);
    }
  }
  setTextIfChanged(document.getElementById('hdr-name'), m.name);
  setTextIfChanged(document.getElementById('hdr-sub'), m.sub);
  setTextIfChanged(document.getElementById('hdr-who'), m.who);
  renderSyncPill();
}

// ── the status pill (§2.2) ─────────────────────────────────────────
// Appears ONLY when something is wrong, and takes the identity line's place. It is
// its own node, patched in place. This is the one home of what used to be the
// bottom update bar and the "can't reach sign-in" pill: both still ask before a
// reload throws away unsent work (wirePill: the same pointerdown / confirm rule).
let fbOfflineSince = 0; // when the connection last dropped (the wait → offline step)
const PILL_WAIT_MS = 10 * 1000;

function syncPillModel() {
  if (sdkLoadFailed) return { tone: 'error', text: 'Can’t connect · tap', act: 'reload' };
  if (newVersionSeen) return { tone: 'update', text: 'Update ready · tap', act: 'reload' };
  if (syncDenied) return { tone: 'error', text: 'Sync blocked', act: 'say', say: 'Your access changed, so this phone stopped syncing. If that is a surprise, ask a director.' };
  if (syncEnabled() && fbConnKnown && !fbConnected) {
    const waiting = (typeof navigator === 'undefined' || navigator.onLine !== false) && fbOfflineSince && Date.now() - fbOfflineSince < PILL_WAIT_MS;
    if (waiting) return { tone: 'wait', text: 'Reconnecting…', act: 'say', say: 'Reconnecting to the camp server.' };
    return { tone: 'offline', text: 'Offline · saved on this phone', act: 'say', say: 'You are offline. What you save stays on this phone and syncs when the connection is back.' };
  }
  return null;
}

// The pill is drawn twice: in the header, and in the game takeover's status strip
// (the takeover covers the header; see index.html #takeover-game-status).
const SYNC_PILLS = [['hdr-pill', 'hdr-pill-text'], ['tk-pill', 'tk-pill-text']];

function renderSyncPill() {
  const m = syncPillModel();
  SYNC_PILLS.forEach(([pid, tid]) => {
    const pill = document.getElementById(pid);
    if (!pill) return;
    if (!m) { setHiddenIfChanged(pill, true); return; }
    if (pill.__tone !== m.tone) { pill.__tone = m.tone; pill.setAttribute('data-tone', m.tone); }
    pill.__go = m.act;
    pill.__say = m.say || '';
    setTextIfChanged(document.getElementById(tid), m.text);
    setHiddenIfChanged(pill, false);
  });
  paintTakeoverStatus();
}

// The connection just dropped or came back: the Reconnecting → Offline step is a
// one-shot timer, not the 30 s tick.
function noteConnectionChange(connected) {
  if (connected) { fbOfflineSince = 0; return; }
  if (!fbOfflineSince) fbOfflineSince = Date.now();
  setTimeout(renderSyncPill, PILL_WAIT_MS + 100);
}

function wirePill(pill) {
  pill = pill || document.getElementById('hdr-pill'); // (a test hands in its own element)
  if (!pill) return;
  // Sampled at pointerdown, before the tap moves focus off a chat composer or a
  // score field (reloadBlocked / chatComposerBusy only count a FOCUSED field).
  let heldAtPress = false;
  pill.addEventListener('pointerdown', () => { heldAtPress = reloadBlocked(); });
  pill.addEventListener('mousedown', (e) => e.preventDefault());
  pill.addEventListener('click', () => {
    const held = heldAtPress || reloadBlocked();
    heldAtPress = false;
    if (pill.__go !== 'reload') { if (pill.__say) showToast(pill.__say); return; }
    if (held && !confirm('You have something unfinished here (an unsent message, a score being typed, or a running timer). Refresh anyway?')) return;
    doReload();
  });
}

// ── the Your team sheet (§2.2) ─────────────────────────────────────
// Who is on the team, what is next for it, and the "Not you?" door. Never points:
// a counselor's phone must not learn a standing from here.
function renderTeamSheet() {
  const nameEl = document.getElementById('ts-name');
  if (!nameEl) return;
  const team = followedTeam();
  const markEl = document.getElementById('ts-mark');
  const subEl = document.getElementById('ts-sub');
  const factsEl = document.getElementById('ts-facts');
  const actionsEl = document.getElementById('ts-actions');
  const me = frameMyName();
  // One headline: the sheet's own title IS the team's name (§8.1 rule 1); the
  // mark sits beside the counselors line under it.
  setTextIfChanged(document.getElementById('sheet-team-title'), team ? team.name : 'Your team');
  setHiddenIfChanged(nameEl, !!team);
  if (!team) {
    setHiddenIfChanged(markEl, true);
    setTextIfChanged(nameEl, 'No team yet');
    setTextIfChanged(subEl, 'Pick the team you are with and its next games show up here.');
    setHtmlIfChanged(factsEl, '');
    if (setHtmlIfChanged(actionsEl, '<button type="button" class="btn btn-gold btn-block" data-ts="team">Pick a team</button>')) wireTeamSheetActions(actionsEl);
    return;
  }
  setHiddenIfChanged(markEl, false);
  paintTeamMark(markEl, team.id, { size: 52 });
  setTextIfChanged(nameEl, team.name);
  const staff = counselorName(team.id);
  setTextIfChanged(subEl, staff ? 'Counselors: ' + staff : '');
  const next = findNextMatchupFor(team.id);
  const cleanup = findNextCleanupFor(team.id);
  const facts = [];
  // Plain hairline rows with a line icon, not tinted boxes (§8.1 rule 7).
  const fact = (ico, label, text) => `<div class="ts-fact"><svg class="ico ts-fact-ico" aria-hidden="true"><use href="#i-${ico}"/></svg><span class="ts-fact-words"><span class="ts-fact-label">${label}</span><span class="ts-fact-text">${text}</span></span></div>`;
  if (next) facts.push(fact('trophy', 'Up next', `vs ${esc(teamName(next.opponentId))} in ${esc(next.game.name)}`));
  if (cleanup) facts.push(fact('broom', 'Next meal cleanup', `${esc(dayLabel(cleanup.day))} ${esc(cleanup.meal)}`));
  setHtmlIfChanged(factsEl, facts.join(''));
  const acts = [];
  if (CAMP.features.electives) {
    acts.push(me
      ? `<p class="ts-you">You’re ${esc(me)}</p><button type="button" class="btn btn-block" data-ts="identity">Not you? Change</button>`
      : '<button type="button" class="btn btn-block" data-ts="identity">Which counselor are you?</button>');
  }
  acts.push(memberTeamId
    ? '<p class="ts-note">Your team is set by your account.</p>'
    : '<button type="button" class="btn btn-block" data-ts="team">Change team</button>');
  if (setHtmlIfChanged(actionsEl, acts.join(''))) wireTeamSheetActions(actionsEl);
}

function wireTeamSheetActions(root) {
  root.querySelectorAll('[data-ts]').forEach((b) => b.addEventListener('click', () => {
    const which = b.dataset.ts;
    shellSheetClose('team'); // the picker is a dialog of its own: one thing over the page at a time
    if (which === 'identity') openIdentityPicker(); else openTeamPicker();
  }));
}

function openTeamSheet(opener) {
  renderTeamSheet();
  shellSheetOpen('team', opener);
}

// ── More (§7) ──────────────────────────────────────────────────────
// Static markup; this patches only the lines that can change.
function alertsStateLine() {
  const st = typeof pushStatus === 'function' ? pushStatus() : 'dormant';
  if (st === 'on') return 'On · reaches you even with Camp closed';
  if (st === 'reconnect') return 'Tap to reconnect · closed-app alerts are paused';
  return state.notify ? 'Only while Camp is open' : 'Off';
}

function renderAlertsState() {
  setTextIfChanged(document.getElementById('alerts-state'), alertsStateLine());
}

// A segmented control of plain radio buttons: the chosen one is its aria-checked,
// and the one tab stop (roving tabindex) rides on it.
function paintSeg(seg, value) {
  if (!seg) return;
  seg.querySelectorAll('.seg-btn').forEach((btn) => {
    const on = btn.dataset.value === value;
    if (btn.getAttribute('aria-checked') !== String(on)) btn.setAttribute('aria-checked', String(on));
    const ti = on ? '0' : '-1';
    if (btn.getAttribute('tabindex') !== ti) btn.setAttribute('tabindex', ti);
  });
}

function wireSegs() {
  document.querySelectorAll('#tab-more [data-seg]').forEach((seg) => {
    const choose = (btn) => {
      const v = btn.dataset.value;
      const kind = seg.dataset.seg;
      if (kind === 'theme') setTheme(v);
      else if (kind === 'calm') setCalmPref(v);
      else if (kind === 'camp') { if (v !== CAMP.id) switchCamp(v); }
    };
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.seg-btn');
      if (btn) choose(btn);
    });
    // Radio-group keys: the arrows move the choice (and the focus with it).
    segArrowKeys(seg, choose);
  });
}

function renderMoreTeamRow() {
  const row = document.querySelector('#tab-more [data-more-row="team"]');
  if (!row) return;
  const team = followedTeam();
  // A director with no team has no "your team" to show.
  setHiddenIfChanged(row, !team && viewRole() === 'editor');
  if (row.hidden) return;
  const me = frameMyName();
  const mark = document.getElementById('more-team-mark');
  if (team) { setHiddenIfChanged(mark, false); paintTeamMark(mark, team.id, { size: 30 }); } else setHiddenIfChanged(mark, true);
  setTextIfChanged(document.getElementById('more-team-name'), team ? ' · ' + team.name : '');
  setTextIfChanged(document.getElementById('more-team-you'), team ? (me ? 'You’re ' + me : '') : 'Pick the team you are with');
  const link = row.querySelector('[data-more-team-change]');
  if (link) {
    const label = CAMP.features.electives ? (me ? 'Not you? Change' : 'Which counselor are you?') : 'Not you? Sign out';
    setTextIfChanged(link, label);
    setHiddenIfChanged(link, !team || (!CAMP.features.electives && !me));
  }
}

function renderMoreFoot() {
  const el = document.getElementById('more-foot');
  if (!el) return;
  const stamp = formatEasternStamp(state.meta && state.meta.lastDataChangeAt);
  const bits = ['v' + APP_VERSION, stamp ? 'data updated ' + stamp : 'no scores yet'];
  if (syncEnabled() && presenceCount > 0) bits.push(presenceCount + (presenceCount === 1 ? ' phone has' : ' phones have') + ' Camp open');
  setTextIfChanged(el, bits.join(' · '));
  // "Code last updated" (CODE_UPDATED_AT, bumped by hand at every deploy) rides as the line's tooltip.
  const built = 'Code last updated: ' + (formatEasternStamp(CODE_UPDATED_AT) || 'unknown');
  if (el.title !== built) el.title = built;
}

function renderMore() {
  const editor = viewRole() === 'editor';
  setHiddenIfChanged(document.getElementById('more-director'), !editor);
  renderAlertsState();
  renderCalmRow();
  paintSeg(document.getElementById('theme-toggle'), state.theme === 'dark' ? 'dark' : state.theme === 'light' ? 'light' : 'auto');
  renderMoreTeamRow();
  updateAccountRow();
  renderMoreFoot();
}

function wireMore() {
  const on = (sel, fn) => { const el = document.querySelector(sel); if (el) el.addEventListener('click', fn); };
  on('#counselors-row', (e) => shellSheetOpen('counselors', e.currentTarget));
  on('#schedule-row', () => openSchedule());
  on('#verse-row', (e) => shellSheetOpen('verse', e.currentTarget));
  on('#cleanup-row', (e) => shellSheetOpen('cleanup', e.currentTarget));
  on('[data-more-team-open]', (e) => openTeamSheet(e.currentTarget));
  on('[data-more-team-change]', () => { if (CAMP.features.electives) openIdentityPicker(); else signOutAndClear(); });
  const hdrId = document.getElementById('hdr-id');
  if (hdrId) hdrId.addEventListener('click', () => openTeamSheet(hdrId));
  // The three drawers close by their own ✕ / backdrop / Escape: they report back
  // here so the history entry goes with them.
  Object.keys(SHELL_DRAWERS).forEach((id) => {
    const d = document.getElementById(SHELL_DRAWERS[id]);
    if (d) d.addEventListener('close', () => shellSheetClose(id));
  });
  wireSegs();
  wirePill();
  wirePill(document.getElementById('tk-pill')); // the game takeover's copy (the header is under it)
}

// What fills a sheet when it opens, and on every pass while it stays open.
function shellSheetFill(id) {
  if (id === 'team') renderTeamSheet();
  else if (id === 'verse') renderMemoryVerse();
  else if (id === 'cleanup') renderMealCleanup();
  else if (id === 'quick') { if (typeof renderQuickSheet === 'function') renderQuickSheet(); }
  else if (id === 'standings') { if (typeof renderStandingsSheet === 'function') renderStandingsSheet(); }
  else if (id === 'notice' || id === 'messages' || id === 'whos-where') { if (typeof renderNowSheet === 'function') renderNowSheet(id); }
  else if (typeof SETUP_SHEETS !== 'undefined' && SETUP_SHEETS.includes(id)) renderSetupSheet(id);
}
function renderShellSheets() {
  shell.sheets.forEach((id) => { if (id !== 'schedule') shellSheetFill(id); });
}

// ── keyboard (§13.6) ────────────────────────────────────────────────
// A text-entry element is focused: the tab bar slides away and a takeover's
// score dock steps aside. NOT fieldFocused(): that one deliberately says "no"
// inside the chat view (so chatting doesn't defer scoreboard updates), which
// would leave the chat composer — the main reason for this rule — without it.
function textEntryFocused() {
  const ae = document.activeElement;
  return !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable ||
    /^JELLY-(INPUT|TEXTAREA|OTP)$/.test(ae.tagName || '')) && ae.type !== 'file' && ae.type !== 'checkbox' && ae.type !== 'radio');
}

let shellKbTimer = null;
function shellSyncKeyboard() {
  if (shellKbTimer) { clearTimeout(shellKbTimer); shellKbTimer = null; }
  if (textEntryFocused()) { document.body.classList.add('kb-open'); return; }
  // Moving between two fields fires focusout then focusin: wait a beat so the
  // bar doesn't flicker.
  shellKbTimer = setTimeout(() => {
    shellKbTimer = null;
    if (!textEntryFocused()) document.body.classList.remove('kb-open');
  }, 100);
}

// iOS doesn't move fixed elements with the keyboard: the visual viewport says
// how much of the layout viewport it covers, and the docks ride on that.
function shellSyncViewport() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  document.documentElement.style.setProperty('--kb-h', kb + 'px');
}

// ── coming back, boot, deep links ───────────────────────────────────
function shellHasUnsentWork() {
  if (typeof editorMidEntry === 'function' && directorTab() && editorMidEntry()) return true;
  if (typeof chatComposerBusy === 'function' && chatComposerBusy()) return true;
  if (typeof chatHasDraft === 'function' && chatHasDraft()) return true;
  // A director running the reveal is never sent back to Now by a long lock-screen pause: the remote is the work.
  if (revealRemoteIsOpen() && typeof revealBusy === 'function' && revealBusy()) return true;
  // A director with Tell everyone open and a message typed, or a send still going out (tell.js).
  if (typeof tellComposerBusy === 'function' && tellComposerBusy()) return true;
  // Set up the week's People, Team and Camper sheets (and a photo being cropped or going up) live in memory only, and held camper
  // names have no stored copy at all: a director who stepped away mid-edit finds them where they left them, not discarded.
  if (typeof teamEditBusy === 'function' && teamEditBusy()) return true;
  if (typeof peopleBusy === 'function' && peopleBusy()) return true;
  if (typeof campersBusy === 'function' && campersBusy()) return true;
  if (typeof campersUiBusy === 'function' && campersUiBusy()) return true;
  if (typeof gmBusy === 'function' && gmBusy()) return true; // a new game's name, typed and not yet a game
  return false;
}

// Away longer than SHELL_RESUME_MS: reopen on Now at the top, takeovers closed,
// unless something half-typed would be lost (replaces the 5-minute idle collapse
// of the cards for the shell's own state).
function shellResume() {
  const away = shell.hiddenAt ? Date.now() - shell.hiddenAt : 0;
  shell.hiddenAt = 0;
  // A counselor preview does not survive the same absence that sends everyone home: a phone put down for ten
  // minutes comes back as the director's own (it has no unsent work of its own, so the check below never holds it).
  const previewEnded = away > SHELL_RESUME_MS && previewEnd();
  if (previewEnded) { applyRoleClass(); updateAccountRow(); }
  // iOS restores a frozen page without firing the interval, so waking up runs the
  // time-driven pass itself (the block that changed, a banner that expired).
  if (away <= SHELL_RESUME_MS || shellHasUnsentWork()) { shellTick(); if (previewEnded) renderAll(); return; }
  shell.sheets.slice().forEach((id) => (id === 'schedule' && typeof closeSchedule === 'function' ? closeSchedule() : shellSheetClose(id)));
  state.ui.gameId = null;
  state.ui.revealOpen = false;
  state.ui.tool = null;
  if (builderOpen()) { state.ui.view = 'home'; if (typeof discardGameDraft === 'function') discardGameDraft(); }
  state.ui.tab = 'now';
  shell.scroll.now = 0;
  shellStamp();
  saveState();
  renderAll();
  shellScrollTo(0, false);
}

// 'now' | 'games' | 'chat' | 'more' | 'schedule' | 'reveal' | 'alert:<id>' |
// 'game:<id>' | 'chat:<channel>' → what to show. Unknown targets show Now.
function shellParseTarget(raw) {
  const t = String(raw || '').replace(/^#/, '').trim();
  if (shellTabOk(t)) return { tab: t };
  if (t === 'reveal') return { tab: 'now', reveal: true };            // the director's remote (a counselor lands on Now, where the mirror is)
  if (/^alert:[A-Za-z0-9_-]{1,64}$/.test(t)) return { tab: 'now' };
  if (t === 'schedule') return { tab: 'now', sheet: 'schedule' };
  let m = /^game:([A-Za-z0-9_.:-]{1,80})$/.exec(t);
  if (m) return { tab: 'now', game: m[1] };
  m = /^chat:([a-z0-9_-]{1,32})$/.exec(t);
  if (m) return { tab: 'chat', channel: m[1] };
  return null;
}

// A deep link: a notification tap, ?open=, a #hash at launch. A takeover or
// sheet opened from nowhere has nothing under it, so shellReconcile's plan
// first tags the base entry as Now and then pushes what the link names.
function shellOpenTarget(raw) {
  const t = shellParseTarget(raw);
  if (!t) return false;
  if (t.channel && typeof chatChannelById === 'function' && !chatChannelById(t.channel)) return false;
  if (t.game && !gameById(t.game)) return false;
  if (!shellCloseOverlays()) return false;
  state.ui.tab = t.tab;
  if (t.channel) state.ui.chatChannel = t.channel;
  if (t.game) {
    const g = gameById(t.game);
    state.ui.gameId = g.id;
    state.ui.gameFrom = 'now';
    state.ui.gameDow = campNow().dow;
    state.ui.day = g.dayId;
  }
  shellStamp();
  saveState();
  renderAll();
  if (t.reveal && revealRemoteMayOpen() && !builderOpen()) { state.ui.revealOpen = true; state.ui.revealFrom = 'now'; saveState(); renderAll(); }
  if (t.sheet === 'schedule' && typeof openSchedule === 'function') openSchedule();
  return true;
}

// Boot, before the first renderAll. A tab, game or builder is restored only
// within SHELL_RESUME_MS of the last time the shell moved (a reload, the
// auto-update, an iOS eviction); a longer absence opens on Now. A #hash names
// a deep link and always wins; it is consumed (the URL is never left holding
// it, so a later reload doesn't replay it).
function shellBoot() {
  const ui = state.ui;
  const fresh = ui.shellAt && Date.now() - ui.shellAt <= SHELL_RESUME_MS;
  if (ui.chatOpen) { // a build before the Chat tab stored "chat is open" here
    delete ui.chatOpen;
    if (fresh) ui.tab = 'chat';
  }
  if (!fresh) {
    ui.tab = 'now';
    ui.gameId = null;
    ui.revealOpen = false;
    ui.tool = null;
    if (ui.view === 'settings') ui.view = 'home';
  } else if (ui.gameId) {
    // a game left open yesterday must not greet someone on Wednesday
    if (!gameById(ui.gameId) || ui.gameDow !== campNow().dow) ui.gameId = null;
  }
  if (!shellTabOk(ui.tab)) ui.tab = 'now';
  let hash = '';
  try { hash = String((typeof location !== 'undefined' && location.hash) || ''); } catch (e) { /* none */ }
  if (hash && shellParseTarget(hash)) {
    const t = shellParseTarget(hash);
    ui.tab = t.tab;
    if (t.channel && typeof chatChannelById === 'function' && chatChannelById(t.channel)) ui.chatChannel = t.channel;
    if (t.game && gameById(t.game)) { ui.gameId = t.game; ui.gameFrom = 'now'; ui.gameDow = campNow().dow; }
    if (t.reveal) { ui.revealOpen = true; ui.revealFrom = 'now'; } // renderAll drops it for anyone who is not a director
    shell.bootSheet = t.sheet || null;
    try {
      if (typeof history !== 'undefined' && history.replaceState) {
        history.replaceState(history.state, '', location.pathname + (location.search || ''));
      }
    } catch (e) { /* the hash just stays */ }
  }
  shell.cur = typeof history !== 'undefined' ? shellSnapFromRaw(history.state) : null;
  shellStamp();
}

function wireShell() {
  if (shell.wired) return;
  shell.wired = true;
  document.querySelectorAll('#tabbar .tab').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  const strip = document.getElementById('reveal-strip');
  if (strip) strip.addEventListener('click', () => showTab('now'));
  const back = document.querySelector('#takeover-game [data-takeover-back]');
  if (back) back.addEventListener('click', closeGame);
  const revealBack = document.querySelector('#takeover-reveal [data-takeover-back]');
  if (revealBack) revealBack.addEventListener('click', closeReveal);
  ['tell', 'award'].forEach((id) => {
    const b = document.querySelector('#takeover-' + id + ' [data-takeover-back]');
    if (b) b.addEventListener('click', closeTool);
  });
  document.querySelectorAll('.sheet-overlay').forEach((el) => {
    const id = el.id.replace(/^sheet-/, '');
    el.querySelectorAll('[data-sheet-close]').forEach((c) => c.addEventListener('click', () => shellSheetClose(id)));
    wireSheetDrag(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (typeof askIsOpen === 'function' && askIsOpen()) return; // a question over a sheet takes the Escape; the sheet stays
    const top = shell.sheets[shell.sheets.length - 1];
    if (top && typeof setupSheetGuardClose === 'function' && setupSheetGuardClose(top)) return; // a half-made edit (a Schedule item, a team) asks first
    if (top && top !== 'schedule') shellSheetClose(top);
    else if (!top && revealRemoteIsOpen()) closeReveal();
    else if (!top && toolOpenId()) closeTool();
    else if (!top && shellTakeoverOpen()) closeGame();
  });
  window.addEventListener('popstate', shellOnPopState);
  // A link to this same page that differs only by its #fragment (a tap on a
  // shared link while Camp is already open) navigates without a reload: treat
  // it like the boot-time deep link. The browser filed a new entry for it that
  // is not ours, so the stack is re-planned from there (tag it Now, push the rest).
  window.addEventListener('hashchange', () => {
    const hash = String((typeof location !== 'undefined' && location.hash) || '');
    if (!hash) return;
    const known = !!shellParseTarget(hash);
    try { history.replaceState(null, '', location.pathname + (location.search || '')); } catch (e) { /* the hash just stays */ }
    if (!known) return;
    shell.cur = null;
    shellOpenTarget(hash);
  });
  window.addEventListener('scroll', shellOnScroll, { passive: true });
  wirePreview();
  // The header's real height (it wraps for a long status pill or large text, and
  // carries the sync bar): the fixed Chat panel starts under it, never behind it.
  const header = document.getElementById('app-header');
  if (header && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--hdr-live', header.offsetHeight + 'px');
    }).observe(header);
  }
  // Focus handling for the keyboard rule.
  document.addEventListener('focusin', shellSyncKeyboard);
  document.addEventListener('focusout', shellSyncKeyboard);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', shellSyncViewport);
    window.visualViewport.addEventListener('scroll', shellSyncViewport);
  }
  // Waking up: iOS restores a frozen page without firing the interval.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { shell.hiddenAt = Date.now(); shellStamp(); saveState(); return; }
    shellResume();
  });
  window.addEventListener('pagehide', () => { shellStamp(); saveState(); });
  window.addEventListener('pageshow', (e) => { if (e && e.persisted) shellResume(); });
}

// The shell's part of every renderAll, in order: settle state, derive and paint
// the root, reconcile history. Returns whether the visible root changed.
function shellSync() {
  if (state.ui.gameId && !gameById(state.ui.gameId)) state.ui.gameId = null; // the game left the week
  const changed = shellPaint();
  shellReconcile();
  return changed;
}

function renderAll() {
  // A preview outlives nothing it depends on: a phone that is no longer a confirmed director's writer tab (a second
  // tab took the lock) ends it before anything is drawn.
  if (counselorPreviewOn && !previewMayRun() && previewEnd()) { applyRoleClass(); updateAccountRow(); }
  const setDownBoardCelebrations = holdBoardCelebrations(); // see there
  // Builder visibility is derived from state every render — settings.js
  // navigates by mutating state.ui.view, not by calling open/close helpers.
  if (state.ui.view === 'settings' && !canEdit()) {
    state.ui.view = 'home';
    // Don't strand a half-edited game behind the closed builder.
    if (typeof discardGameDraft === 'function') discardGameDraft();
  }
  const inBuilder = builderOpen();
  document.body.classList.toggle('builder-open', inBuilder);
  const builderView = document.getElementById('settings-view');
  setHiddenIfChanged(builderView, !inBuilder); // renderAll runs on every snapshot: write only a change
  applyCardVisibility(); // before the shell derives what is open — it may close a hidden card's game
  if (!canEdit()) { closeHistoryForViewer(); shellCloseDisallowedSheets(); } // a demoted editor's (or a preview's) open director sheets
  const historyRow = document.getElementById('history-row');
  setHiddenIfChanged(historyRow, !canEdit()); // editors' only in code too, not just in CSS (html.view-only)
  // The shell (§13.2): paint the visible root, reconcile the history stack,
  // then render the visible tab (the others are marked dirty and catch up when
  // shown) and the open takeover.
  // A remote left open for someone who is not (or no longer) a director closes here, before the shell derives what is up.
  if (state.ui.revealOpen && !revealRemoteMayOpen()) state.ui.revealOpen = false;
  // So does a tool (Tell everyone, Award points) left open for someone who is not a director any more.
  if (state.ui.tool && !canEdit()) state.ui.tool = null;
  const rootChanged = shellSync();
  renderHeader();
  renderTabBadges();
  renderShellTabs();
  renderShellSheets();
  renderGameView();
  // The reveal's screens (reveal-ui.js): the remote takeover, Now's mirror and grid, the header strip, the
  // tab dot, More's row, Games' link. Each writes only what changed.
  if (typeof renderRevealUi === 'function') renderRevealUi();
  // The director tools' screens (tell.js, award.js): More's two rows and, while one is open, its takeover.
  if (typeof renderTellEveryone === 'function') renderTellEveryone();
  if (typeof renderAwardPoints === 'function') renderAwardPoints();
  // The builder's frame (setup-ui.js: hub, head, sheets) paints around the classic builder, which it still calls
  // for the Classic editor screen; without that file the builder is v197's.
  if (typeof renderSetupUi === 'function') renderSetupUi(inBuilder);
  else if (inBuilder && typeof renderSettings === 'function') renderSettings();
  if (typeof renderChatStatus === 'function') renderChatStatus();
  if (rootChanged) shellRestoreScroll(shell.root); // after the new panel has rendered
  setDownBoardCelebrations();
  // Last: a clock this pass rebuilt is born with its final-minute / final-ten
  // classes instead of losing them until the next 500 ms tick.
  paintBoardClocks();
}

// ── Week builder (More → Set up the week) ────────────────────
// A full-page editor-only view over the main page: body.builder-open hides
// every other main-wrap section via CSS. settings.js renders the content
// (renderSettings) and signals "back" by setting state.ui.view = 'home'
// before its own renderAll() — visibility is re-derived above either way.

function builderOpen() {
  return state.ui.view === 'settings';
}

// What leaving the builder by a route that has no dialog of its own (the phone's Back, a deep link) would throw away, as the question to ask
// ('' = nothing): an unsaved game editor, or camper names still waiting for the signal (held in memory only, setup-sync.js "CAMPERS").
function builderLeaveWarning() {
  if (typeof builderDirty === 'function' && builderDirty()) return 'Discard your unsaved changes?';
  const n = typeof campersHeldCount === 'function' ? campersHeldCount() : 0;
  return n === 1 ? 'This name hasn’t been saved yet — it’ll be lost. Discard it?' : n ? 'These ' + n + ' names haven’t been saved yet — they’ll be lost. Discard them?' : '';
}

// (Where the page was scrolled is the shell's: the tab it came from keeps its
// scroll slot and gets it back when the builder closes — shellRestoreScroll.)

function openBuilder(tab, screen) {
  if (!canEdit()) return;
  state.ui.gameId = null; // one takeover at a time
  state.ui.revealOpen = false;
  state.ui.tool = null;
  state.ui.view = 'settings';
  if (tab) state.ui.settingsTab = tab;
  if (!state.ui.settingsTab) state.ui.settingsTab = 'games';
  if (typeof setupOnOpen === 'function') setupOnOpen(tab, screen); // the hub, a named screen (More → People), or a named classic tab
  shellStamp();
  saveState();
  renderAll();
}

// Keep an open schedule sheet in step with time and synced results — its
// NOW pill, dimming, and ✓ chips otherwise go stale across a block boundary
// or when a remote result lands.
function refreshOpenSchedule() {
  const overlay = scheduleOverlayEl();
  if (overlay && !overlay.hidden) renderScheduleBody();
}

function init() {
  applyTheme();
  applySoundIcon();
  // (Theme, Calm motion and Camp are plain radio buttons in More: wireSegs.)
  // The verdict can change without a tap (battery saver on, the phone's own
  // setting flipped): keep the line under the control telling the truth.
  window.addEventListener('jelly-motion-change', renderCalmRow);
  renderCalmRow();
  document.getElementById('sound-toggle').addEventListener('change', toggleSound);
  // The Alerts sheet's "While Camp is open" pop-ups switch is the one control for state.notify
  // (the Notify me button left Now with Step 17).
  const notifySw = document.getElementById('notify-toggle');
  // (A change event is the person's own tap — a programmatic `checked` never fires one — so it simply flips the state.)
  if (notifySw) notifySw.addEventListener('change', toggleNotify);
  // One switch per section in What counselors see (More → Director; editor-only,
  // hidden by CSS for view-only). The switches are static markup, so wiring them
  // once here is enough — applyCardVisibility keeps their checked state in step.
  document.querySelectorAll('.hide-card-toggle[data-hide-card]').forEach((sw) => {
    sw.addEventListener('change', () => toggleCardHidden(sw.dataset.hideCard));
  });

  // Account row (settings sheet): shows who's signed in; the button signs out.
  const signoutBtn = document.getElementById('signout-btn');
  if (signoutBtn) signoutBtn.addEventListener('click', signOutAndClear);
  updateAccountRow();
  wireMembers();
  wireCampSwitcher();
  if (typeof wireChat === 'function') wireChat();
  if (typeof wirePush === 'function') wirePush();
  if (typeof wireSetupUi === 'function') wireSetupUi();
  if (typeof wireRevealUi === 'function') wireRevealUi();
  wireShell();
  wireMore();

  updateNotifyButton();
  wireTeamPicker();

  wireSchedule();
  wireSettings();
  wireHistory();
  wireSyncStatus();

  // Week builder entry point (Settings sheet → Set up the week).
  const builderRow = document.getElementById('builder-row');
  if (builderRow) builderRow.addEventListener('click', () => openBuilder());
  // (Sync is NOT started here — startSync() runs from the approved branch
  // of the member listener, the only place allowed to attach database refs.
  // Until then the indicator honestly reads "Connecting…", or "This device
  // only" when there's no Firebase at all.)
  updateSyncIndicator();
  renderPresence();

  startUpdatePolling();
  startWeatherUpdates();
  // Notification-only service worker (no fetch handler — see sw.js header).
  // Needed so OS notifications work on phones: Android Chrome and installed
  // iOS PWAs only show them via a registration, never the bare constructor —
  // and it's where phone alerts (push.js) arrive. push.js registers it under
  // a versioned URL (sw.js?v=N, updateViaCache:'none'); without push.js the
  // plain registration below is exactly what this always did.
  if ('serviceWorker' in navigator) {
    if (typeof pushRegisterServiceWorker === 'function') {
      pushRegisterServiceWorker();
    } else {
      try { navigator.serviceWorker.register('sw.js').catch(() => { /* fine — toasts still work */ }); } catch (e) { /* ignore */ }
    }
  }

  shellBoot(); // which tab / takeover to open on, and what the history stack already says
  renderAll();
  if (shell.bootSheet === 'schedule') { shell.bootSheet = null; openSchedule(); }

  // Keep the "happening now" banner (and any open schedule sheet) current
  // without any taps — and expire "what's new" banners once they hit two hours.
  // Only the visible tab's time-driven part runs (the others catch up when shown).
  setInterval(() => { shellTick(); if (typeof renderChatStatus === 'function') renderChatStatus(); }, 30 * 1000);

  // Tick every visible Big Board clock (no-ops instantly when none is on
  // screen, so the interval is effectively free the rest of the week).
  setInterval(tickBoardClocks, 500);
}

function updateAccountRow() {
  // The Account row's line in More: who is signed in, and as what.
  const label = document.getElementById('account-label');
  if (label) {
    const who = identityLabel(authUser); // email or phone number
    const role = canEdit() ? 'Director' : tabReadOnly() && !counselorPreviewOn ? 'Director (view-only tab)' : 'Counselor';
    const text = (who ? who + ' · ' : '') + role;
    setTextIfChanged(label, text);
  }
  // The camp switcher only exists for accounts on both camps' lists. The
  // control just reflects the active camp — the page reloads on change, so
  // it never has to track anything.
  const group = document.getElementById('more-camps');
  if (group) {
    setHiddenIfChanged(group, !hasBothCamps());
    paintSeg(document.getElementById('camp-switch'), CAMP.id);
  }
}

// ── Joy layer ────────────────────────────────────────────────────
// Playful, decorative-only animation glue: springy press feedback on every
// tappable control, a little sparkle burst at the tap point, staggered
// rise-ins when a view re-renders from a tap, and a bigger celebration
// whenever real scoreboard data is saved (hooked from touchData). All of it
// is transform/opacity only, capped, throttled, and off while calm — the one
// switch, calmMotion() (jelly-motion.js), read live at every use, so flipping
// Calm motion or the phone entering battery saver takes effect on the next tap.
// The app works identically with this section gone.
const JOY_TAPPABLE = 'button, a, summary, jelly-button, jelly-chip, jelly-segment, jelly-icon-button';
// What gets the press dent. The Jelly components keep their own canvas press
// physics (a second, skewed dent on top of a jelly-button's own ring-back
// fought it); plain controls get JellyMotion.press/release.
const JOY_PRESSABLE = 'button, a, summary';

// The calm-motion sampler measures the frame rate, so it waits for everything
// the app knows is moving: confetti in the air, sparkles or a ring in the joy
// layer, a running stopwatch (100 ms tick), a clock in its final minute (the
// heartbeat). Evaluated lazily, never at load.
JellyMotion.busySource(() => {
  const layer = document.getElementById('joy-layer');
  return confettiRunning > 0
    || !!(layer && layer.childElementCount > 0)
    || Object.values(liveWatches).some((w) => w && w.running)
    || document.querySelectorAll('.clock-final-min, .clock-final-ten').length > 0;
});
const JOY_COLORS = ['var(--color-primary)', 'var(--color-gold)', '#ff6b9d', 'var(--color-bronze)', '#4cc9a4'];
let joyLastTap = { x: null, y: null };
let joyLastBurstAt = 0;

function joyLayerEl() {
  let el = document.getElementById('joy-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'joy-layer';
    document.body.appendChild(el);
  }
  return el;
}

// A burst of sparkles at (x, y). Small for ordinary taps; big (more
// particles, some emoji, longer flight) for save/celebrate moments.
function joyBurst(x, y, big) {
  if (calmMotion()) return;
  if (x == null || y == null) { x = innerWidth / 2; y = innerHeight / 2; }
  const now = Date.now();
  if (!big && now - joyLastBurstAt < 90) return; // throttle rapid taps
  joyLastBurstAt = now;
  const layer = joyLayerEl();
  if (layer.childElementCount > 70) return; // hard cap, keeps the DOM tiny
  const n = big ? 16 : 6;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    if (big && Math.random() < 0.35) {
      p.className = 'joy-p';
      p.textContent = ['✨', '⭐', '🎉', '💫'][Math.floor(Math.random() * 4)];
    } else {
      p.className = 'joy-p dot';
      p.style.setProperty('--c', JOY_COLORS[i % JOY_COLORS.length]);
    }
    const ang = Math.random() * Math.PI * 2;
    const dist = (big ? 55 : 26) + Math.random() * (big ? 85 : 26);
    p.style.setProperty('--x', x + 'px');
    p.style.setProperty('--y', y + 'px');
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * dist + (big ? 30 : 10) + 'px'); // slight fall
    p.style.setProperty('--t', ((big ? 0.75 : 0.5) + Math.random() * 0.3).toFixed(2) + 's');
    p.style.setProperty('--r', Math.round(Math.random() * 360 - 180) + 'deg');
    p.addEventListener('animationend', () => p.remove());
    layer.appendChild(p);
  }
}

// Re-run a container's children through the staggered rise-in. Called right
// after a tap-triggered re-render (day switch, back to list, verse day…) —
// never from sync/background renders, so remote updates stay calm.
function joyStagger(el) {
  if (!el || calmMotion()) return;
  el.classList.remove('joy-stagger');
  void el.offsetWidth; // restart the animation
  el.classList.add('joy-stagger');
  setTimeout(() => el.classList.remove('joy-stagger'), 900);
}

// Slide a view into place (game detail opening).
function joySlideIn(el) {
  if (!el || calmMotion()) return;
  el.classList.remove('joy-slide-in');
  void el.offsetWidth;
  el.classList.add('joy-slide-in');
  setTimeout(() => el.classList.remove('joy-slide-in'), 500);
}

// The big one: called from touchData(), so every action that records real
// scoreboard data (a result saved, points awarded, a bracket win…) throws a
// proper little celebration from wherever the editor's finger last was.
let joyLastCelebrateAt = 0;
function joyCelebrate() {
  const now = Date.now();
  if (now - joyLastCelebrateAt < 800) return;
  joyLastCelebrateAt = now;
  // Calm motion marks a save with one soft gold ring where the finger last was,
  // instead of the burst (redesign §10.4).
  if (calmMotion()) joyRing(joyLastTap.x, joyLastTap.y);
  else joyBurst(joyLastTap.x, joyLastTap.y, true);
}

// Calm motion's stand-in for confetti: a single gold ring pulse, no movement.
// A transient node in #joy-layer (never inside a string-rendered root), removed
// when its animation ends — or at once on a browser with no WAAPI.
function joyRing(x, y) {
  if (x == null || y == null) { x = innerWidth / 2; y = innerHeight / 2; }
  const layer = joyLayerEl();
  if (layer.childElementCount > 70) return;
  const r = document.createElement('span');
  r.className = 'joy-ring';
  r.style.setProperty('--x', x + 'px');
  r.style.setProperty('--y', y + 'px');
  layer.appendChild(r);
  const a = JellyMotion.ring(r);
  if (a) a.addEventListener('finish', () => r.remove());
  else r.remove();
}

// Delegated press feedback: the control dents toward the finger and, on release,
// rings back past rest (JellyMotion.press / release — WAAPI only, so a press
// leaves no class or style behind for setHtmlIfChanged to trip over; the old
// joy-pressed / joy-pop classes retired with this).
// The press waits a beat (JOY_PRESS_DELAY_MS) and is called off if the finger
// travels: a finger put down on a row to SCROLL the list used to shrink the
// row and then snap it back when the scroll took over — a twitch on nearly
// every touch-scroll. A quick tap that lifts before the delay still gets the
// pop (release with fromRest, which starts at rest), so taps still feel springy.
const JOY_PRESS_DELAY_MS = 80;
const JOY_PRESS_SLOP_PX = 8;
let joyPress = null; // { el, x, y, timer, shown } — the press in progress, if any

// Called off mid-gesture (a scroll took over, or the finger slid away). Eases
// back from the dent without ringing (soft), instead of snapping.
function joyPressAbort() {
  const p = joyPress;
  joyPress = null;
  if (!p) return;
  clearTimeout(p.timer);
  if (p.shown) JellyMotion.release(p.el, { soft: true });
}

document.addEventListener('pointerdown', (e) => {
  joyLastTap = { x: e.clientX, y: e.clientY };
  joyPressAbort();
  const t = e.target.closest && e.target.closest(JOY_PRESSABLE);
  if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
  const p = { el: t, x: e.clientX, y: e.clientY, timer: 0, shown: false };
  p.timer = setTimeout(() => {
    if (joyPress !== p) return;
    p.shown = true;
    JellyMotion.press(t, { x: p.x, y: p.y });
  }, JOY_PRESS_DELAY_MS);
  joyPress = p;
}, { passive: true });

document.addEventListener('pointermove', (e) => {
  if (joyPress && Math.hypot(e.clientX - joyPress.x, e.clientY - joyPress.y) > JOY_PRESS_SLOP_PX) joyPressAbort();
}, { passive: true });

document.addEventListener('pointerup', () => {
  const p = joyPress;
  joyPress = null;
  if (!p) return;
  clearTimeout(p.timer);
  // `shown` false = a tap quicker than the delay: pop from rest, never snap in.
  JellyMotion.release(p.el, p.shown ? undefined : { fromRest: true });
}, { passive: true });

document.addEventListener('pointercancel', () => { joyPressAbort(); }, { passive: true });

// Sparkle only where a press MEANS something (redesign §9.7): a score, a save, an
// award, a medal pick — never on tabs, back buttons, rows, switches or links, which
// are navigation and settings. A positive list, so a new control is quiet until it
// is named here (or carries data-joy), and the chrome around the work stays quiet
// wherever the work happens to sit.
const JOY_SPARKLE = 'jelly-button, jelly-chip, .pts-btn, .btn-gold, [data-joy]';
// Set up the week is a calm clipboard: its gold buttons (the one main action of a screen, a sheet or a
// question) must not sparkle when tapped.
const JOY_QUIET = '#tabbar, #app-header, .more, .tk-head, jelly-drawer, #chat-view, .lock-screen, #setup, ' +
  '#sheet-setup-menu, #sheet-setup-changes, #sheet-setup-devices, #sheet-restore, #ask-dialog, ' +
  '#takeover-tell, #preview-bar'; // sending is not a celebration (the award keys name themselves with data-joy)
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest(JOY_SPARKLE);
  if (!t || t.closest(JOY_QUIET)) return;
  joyBurst(e.clientX, e.clientY, false);
}, { passive: true });

// ── Auth gate ────────────────────────────────────────────────────
// See the "Sign-in & roles" block at the top of this file for the model.
// The flow: boot() → startAuth() → onAuthStateChanged → member self-read →
// approved → startApp() (+ startSync()). Every screen along the way renders
// inside the #lock-screen shell via html.locked.

let appStarted = false;

function applyRoleClass() {
  document.documentElement.classList.toggle('view-only', !canEdit());
  applyOwnerClass();
}

function startApp() {
  document.documentElement.classList.remove('locked');
  document.documentElement.classList.toggle('camp-senior', CAMP.id === 'senior');
  applyRoleClass();
  // Seed the "up next" baseline from what this phone already holds, so the
  // first LIVE change after a quiet boot still alerts. detectMatchupChanges used
  // to seed itself on its first call — which was the first snapshot's — and
  // swallowed it.
  if (lastBracketSlots === null) detectMatchupChanges();
  if (!appStarted) {
    appStarted = true;
    init();
  } else {
    updateAccountRow();
    renderAll();
  }
  maybeShowTeamPicker();
}

// Show one of the lock-screen panels: 'checking' | 'signin' | 'denied'.
// opts: { error, email }
function showAuthScreen(mode, opts) {
  document.documentElement.classList.add('locked');
  ['auth-checking', 'auth-signin', 'auth-denied'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = id !== 'auth-' + (mode === 'signin' ? 'signin' : mode);
  });
  const errEl = document.getElementById('lock-error');
  if (errEl) {
    errEl.textContent = (opts && opts.error) || '';
    errEl.hidden = !(opts && opts.error);
  }
  if (mode !== 'denied') askToJoinStop();
  const who = document.getElementById('auth-denied-email');
  if (who && opts && opts.email) who.textContent = opts.email;
  // The alternative sign-in methods mount lazily into their slots inside the
  // "Alternative sign in" disclosure. Both are optional modules (delete the
  // matching <script> tag to remove one); the Google button always remains.
  // mount() replaces the slot's innerHTML, so an ERROR re-show (Google popup
  // blocked, offline…) must not call it on a slot that already has its form —
  // that wiped a half-typed number/email and reset a phone flow that was
  // waiting on its texted code (spending another of the day's few texts). The
  // plain 'signin' show still remounts: first paint, and after a sign-out /
  // "use a different account", so a shared phone never greets the next person
  // with the previous number or code step.
  if (mode === 'signin') {
    const keepForms = !!(opts && opts.error);
    [['alt-phone-slot', window.CampPhone], ['alt-email-slot', window.CampEmailLink]].forEach(([id, mod]) => {
      const slot = document.getElementById(id);
      if (mod && slot && !(keepForms && slot.firstElementChild)) mod.mount(slot);
    });
  }
}

function hideLockError() {
  const errEl = document.getElementById('lock-error');
  if (errEl) errEl.hidden = true;
}

// Human messages for the sign-in errors people actually hit.
function showSignInError(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return; // they changed their mind
  let msg;
  if (code === 'auth/popup-blocked') {
    msg = 'Your browser blocked the sign-in window — allow pop-ups for this site and try again.';
  } else if (code === 'auth/network-request-failed') {
    msg = 'You look offline — signing in needs an internet connection.';
  } else if (code === 'auth/unauthorized-domain') {
    msg = 'This copy of the site isn\'t authorized for sign-in (unauthorized domain).';
  } else {
    msg = 'Sign-in didn\'t work (' + (code || 'unknown error') + '). Try again.';
  }
  showAuthScreen('signin', { error: msg });
}

// Always offer Google's account chooser. A shared office machine or a
// counselor's personal profile is usually already signed into some OTHER
// Google account, and without select_account the popup silently re-picks it —
// so "Use a different account" would just sign the same wrong one back in.
function googleProvider() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

function wireAuthScreen() {
  const googleBtn = document.getElementById('google-signin-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      // No SDK to sign in WITH (see onSdkLoadFailed): the useful thing a tap
      // can do is try loading it again.
      if (sdkLoadFailed) { doReload(); return; }
      hideLockError();
      // signInWithPopup must be called synchronously inside the click handler
      // — any await first and Safari/iOS drops the user gesture and blocks
      // the popup. Never signInWithRedirect: it needs cross-site storage that
      // Safari/Firefox block for sites not hosted on the authDomain.
      try {
        firebase.auth().signInWithPopup(googleProvider()).catch(showSignInError);
      } catch (e) {
        showSignInError(e);
      }
    });
  }
  const switchBtn = document.getElementById('auth-switch-btn');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      try { firebase.auth().signOut().catch(() => {}); } catch (e) { /* ignore */ }
      // onAuthStateChanged(null) takes over and shows the sign-in panel.
    });
  }
  const retryBtn = document.getElementById('auth-retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', () => location.reload());
  wireAskToJoin();
}

// ── Ask to join: the requester's side (setup-rebuild-spec §11.18; Step 25) ───────────────────────────────
// A signed-in account that is on NO list can ask a director to add it — but only while a director has switched asking on
// (setup/meta/joinOpen), and the rules, not this code, enforce that. One `set()` of { name, note?, at: server time } to
// <camp root>/accessRequests/<identityKey>. A non-member has NO listener (THE INVARIANT: a cancelled read is terminal): the page reads
// its own request with once(), and polls members/<me> with once() every 30 s while it is visible (and on focus), for at most 30
// minutes, until a director lets it in — then the camp is made the active one and the page reloads (one-shot lifecycle).
// Nothing a director typed or the database holds is ever put into markup here: every string goes in through textContent / value.
const ASK_POLL_MS = 30000;            // the page asks "am I on the list yet?" this often while it is visible
const ASK_POLL_MAX_MS = 30 * 60000;   // …for this long, then it says "Still waiting?" and waits to be asked
const ASK_FOCUS_MIN_MS = 5000;        // a focus never polls more than once in this
const ASK_WITHDRAW_MS = 62000;        // the rules let a requester delete their row 60 s after asking (a little slack for the clock)
const ASK_NAME_MAX = 60;
const ASK_NOTE_MAX = 200;

const ask = {
  key: '',          // this account's member key ('' = nothing to ask with)
  camp: '',         // the camp the form is about
  rows: {},         // campId → this account's own request row there ({ name, note, at }) or null
  ready: false,     // the rules that carry accessRequests answered a read of our own row
  closed: false,    // the last ask was refused: asking is closed (or this sign-in is blocked — the same words)
  busy: false,      // a send or a withdraw is in flight
  timer: null,
  withdrawTimer: null,
  since: 0,         // when this stretch of polling started
  last: 0,          // when it last asked
  expired: false,   // 30 minutes passed
  offset: 0,        // the database's clock minus ours (the page has no .info listener), for the withdraw delay
  wired: false,
};

function askEl(id) { return document.getElementById(id); }

function askClean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function askRef(campId) {
  return firebase.database().ref(CAMPS[campId].dbRoot + '/accessRequests/' + ask.key);
}

function askSay(id, text) {
  const el = askEl(id);
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

// Starts from denyMemberFinal, on the denied screen only. Hidden unless the rules answer a read of our own row (R1 published).
function askToJoinStart() {
  askToJoinStop();
  ask.key = identityKey(authUser);
  ask.camp = CAMP.id;
  ask.rows = {};
  ask.ready = false;
  ask.closed = false;
  ask.expired = false;
  ask.busy = false;
  const panel = askEl('ask-join');
  if (panel) panel.hidden = true;
  askPaintFrame();
  if (!ask.key || !isValidMemberKey(ask.key) || isPendingKey(ask.key)) return;
  if (typeof firebase === 'undefined' || !firebase.database) return;
  const name = askEl('ask-name');
  if (name && !name.value) name.value = askClean(authUser && authUser.displayName, ASK_NAME_MAX); // phone sign-ins start empty
  try {
    // The clock offset is a convenience for the withdraw delay; a refusal or no answer just leaves it 0.
    firebase.database().ref('.info/serverTimeOffset').once('value').then((s) => { const v = Number(s && s.val()); if (isFinite(v)) ask.offset = v; }).catch(() => {});
  } catch (e) { /* the device clock it is */ }
  askLoadRow(ask.camp).then((ok) => {
    if (!ok) return; // rules not published (a refused read): the page stays exactly as it was
    ask.ready = true;
    askPaint();
    askPollStart();
  });
}

function askToJoinStop() {
  clearTimeout(ask.timer);
  clearTimeout(ask.withdrawTimer);
  ask.timer = null;
  ask.withdrawTimer = null;
}

// One read of our own row at a camp. Resolves true when the read was allowed (even if there is no row), false when refused.
function askLoadRow(campId) {
  try {
    return askRef(campId).once('value').then((snap) => {
      const v = snap && snap.val();
      ask.rows[campId] = v && typeof v === 'object' && typeof v.at === 'number'
        ? { name: askClean(v.name, ASK_NAME_MAX), note: askClean(v.note, ASK_NOTE_MAX), at: v.at } : null;
      return true;
    }, () => false);
  } catch (e) { return Promise.resolve(false); }
}

function askNow() { return Date.now() + ask.offset; }

// The panel from the state: the form, the "sent" card, or the closed words — one of them, never two.
// The denied screen around the panel: its line says what this page offers (asking, when the panel is up), and the legacy
// "I've been added — try again" steps aside while the panel offers its own (one way to do each job, in one button language).
function askPaintFrame() {
  const note = document.getElementById('auth-denied-note');
  if (note) {
    const t = ask.ready ? 'This account isn’t on the camp list yet. Ask to join below, or ask a director to add you.'
      : 'This account isn’t on the camp list yet — ask a director to add you, then try again.';
    if (note.textContent !== t) note.textContent = t;
  }
  const retry = document.getElementById('auth-retry-btn');
  if (retry && retry.hidden !== !!ask.ready) retry.hidden = !!ask.ready;
}

function askPaint() {
  const panel = askEl('ask-join');
  if (!panel) return;
  panel.hidden = !ask.ready;
  askPaintFrame();
  const row = ask.rows[ask.camp];
  const showForm = !row && !ask.closed;
  const form = askEl('ask-form');
  if (form) form.hidden = !showForm;
  const sent = askEl('ask-sent');
  if (sent) sent.hidden = !row;
  const closed = askEl('ask-closed');
  if (closed) closed.hidden = !(ask.closed && !row);
  const phone = String(ask.key).charAt(0) === '+';
  askSay('ask-closed-text', ask.closed && !row
    ? 'Asking to join isn’t open right now. Tell a director your ' + (phone ? 'phone number' : 'email') + ' (' + identityFromKey(ask.key) + ') and they’ll add you.' : '');
  const camps = askEl('ask-camps');
  if (camps) Array.prototype.forEach.call(camps.querySelectorAll('[data-ask-camp]'), (b) => { b.setAttribute('aria-checked', b.dataset.askCamp === ask.camp ? 'true' : 'false'); });
  const send = askEl('ask-send');
  if (send) { send.disabled = ask.busy; send.setAttribute('aria-disabled', ask.busy ? 'true' : 'false'); }
  const withdraw = askEl('ask-withdraw');
  if (withdraw) withdraw.hidden = !(row && askNow() - row.at >= ASK_WITHDRAW_MS);
  const added = askEl('ask-added');
  if (added) added.hidden = !!row;
  askSay('ask-wait', row ? (ask.expired ? 'Still waiting? Find a director — they’ll see your request under More → People.' : 'Checking every 30 seconds while this page is open.') : '');
  if (row) askScheduleWithdraw(row);
}

// The Withdraw button appears a minute after asking (the rules' own delay), without anyone touching the page.
function askScheduleWithdraw(row) {
  clearTimeout(ask.withdrawTimer);
  const wait = ASK_WITHDRAW_MS - (askNow() - row.at);
  if (wait > 0 && wait < 120000) ask.withdrawTimer = setTimeout(askPaint, wait + 50);
}

function askSend() {
  if (ask.busy) return;
  const nameEl = askEl('ask-name');
  const noteEl = askEl('ask-note');
  const name = askClean(nameEl && nameEl.value, ASK_NAME_MAX);
  const note = askClean(noteEl && noteEl.value, ASK_NOTE_MAX);
  askSay('ask-error', '');
  if (!name) { askSay('ask-error', 'Type your name so a director knows who you are.'); if (nameEl && nameEl.focus) nameEl.focus(); return; }
  const campId = ask.camp;
  ask.busy = true;
  askPaint();
  const at = firebase.database.ServerValue.TIMESTAMP;
  askRef(campId).set(note ? { name, note, at } : { name, at }).then(() => askLoadRow(campId)).then(() => {
    ask.busy = false;
    ask.closed = false;
    ask.expired = false;
    askPaint();
    askPollStart();
  }, (e) => {
    ask.busy = false;
    // PERMISSION_DENIED covers every refusal the rules make — asking switched off, this sign-in blocked, an unverified address — and
    // they are said in the same words, so a block is never announced.
    if (e && e.code === 'PERMISSION_DENIED') ask.closed = true;
    else askSay('ask-error', 'Couldn’t send that — check your connection and try again.');
    askPaint();
  });
}

function askWithdraw() {
  const row = ask.rows[ask.camp];
  if (ask.busy || !row) return;
  ask.busy = true;
  askSay('ask-error', '');
  askRef(ask.camp).remove().then(() => {
    ask.busy = false;
    ask.rows[ask.camp] = null;
    askPaint();
  }, () => {
    ask.busy = false;
    askSay('ask-error', 'You can take your request back a minute after you sent it. Try again in a moment.');
    askPaint();
  });
}

function askPickCamp(campId) {
  if (!CAMPS[campId] || campId === ask.camp || ask.busy) return;
  ask.camp = campId;
  ask.closed = false;
  askSay('ask-error', '');
  askPaint();
  // The other camp's own row, once, so "Sent." is true for the camp the form is about.
  if (!Object.prototype.hasOwnProperty.call(ask.rows, campId)) askLoadRow(campId).then(() => { askPaint(); askPollStart(); });
  else askPollStart();
}

// Polling: while a request is out (at any camp), ask members/<me> with once() every 30 s while the page is visible, for 30 minutes.
function askPollStart() {
  if (!Object.keys(ask.rows).some((c) => ask.rows[c])) return;
  ask.since = Date.now();
  ask.expired = false;
  askSchedulePoll();
}

function askSchedulePoll() {
  clearTimeout(ask.timer);
  ask.timer = null;
  if (ask.expired || !Object.keys(ask.rows).some((c) => ask.rows[c])) return;
  ask.timer = setTimeout(() => askPoll(false), ASK_POLL_MS);
}

// `manual`: the person tapped Check again — a new thirty minutes, and an answer whatever the tab is doing.
function askPoll(manual) {
  clearTimeout(ask.timer);
  ask.timer = null;
  if (manual) { ask.since = Date.now(); ask.expired = false; }
  else if (document.visibilityState === 'hidden') return; // visibilitychange re-arms it
  else if (Date.now() - ask.since > ASK_POLL_MAX_MS) { ask.expired = true; askPaint(); return; }
  ask.last = Date.now();
  const camps = Object.keys(ask.rows).filter((c) => ask.rows[c]);
  const next = () => { askPaint(); askSchedulePoll(); };
  const one = (i) => {
    if (i >= camps.length) { next(); return; }
    let p;
    try { p = firebase.database().ref(CAMPS[camps[i]].dbRoot + '/members/' + ask.key).once('value'); } catch (e) { one(i + 1); return; }
    p.then((snap) => {
      const rec = snap && snap.val();
      if (rec && (rec.role === 'editor' || rec.role === 'viewer')) askOpenCamp(camps[i], rec.role);
      else one(i + 1);
    }, () => one(i + 1)); // a refused read is just "not on that list yet"
  };
  one(0);
}

// Approved: make that camp the one this device opens, and reload — the sign-in then finds the record and starts the app.
function askOpenCamp(campId, role) {
  try {
    localStorage.setItem(ACTIVE_CAMP_KEY, campId);
    localStorage.setItem(AUTH_HINT_KEY, role);
  } catch (e) { /* storage blocked: the reload lands on the default camp, and the sign-in's own camp bounce still finds this one */ }
  writeCampsHint(campId, role);
  location.reload();
}

function wireAskToJoin() {
  if (ask.wired) return;
  ask.wired = true;
  const on = (id, ev, fn) => { const el = askEl(id); if (el) el.addEventListener(ev, fn); };
  on('ask-form', 'submit', (e) => { e.preventDefault(); askSend(); });
  on('ask-withdraw', 'click', askWithdraw);
  on('ask-check', 'click', () => askPoll(true));
  on('ask-again', 'click', () => { ask.closed = false; askPaint(); });
  on('ask-added', 'click', () => location.reload());
  const camps = askEl('ask-camps');
  if (camps) camps.addEventListener('click', (e) => { const b = e.target && e.target.closest ? e.target.closest('[data-ask-camp]') : null; if (b) askPickCamp(b.dataset.askCamp); });
  // Coming back to the page (the tab shown, the window focused) is the moment to look — never more than once in five seconds.
  const again = () => {
    if (!ask.ready || document.visibilityState === 'hidden' || Date.now() - ask.last < ASK_FOCUS_MIN_MS) return;
    if (!Object.keys(ask.rows).some((c) => ask.rows[c]) || ask.expired) return;
    askPoll(false);
  };
  document.addEventListener('visibilitychange', again);
  window.addEventListener('focus', again);
}

// True only when all three Firebase SDK scripts (app + auth + database)
// loaded. They are separate cross-origin requests (index.html, SRI-pinned), so
// on flaky camp wifi one can fail — or be refused for a wrong hash — while the
// same-origin page loads fine.
function firebaseSdkReady() {
  return typeof firebase !== 'undefined' && !!firebase.auth && !!firebase.database;
}

const SDK_RETRIES_KEY = 'campSdkRetries'; // sessionStorage: auto-reloads spent on a missing SDK
const SDK_MAX_RETRIES = 3;

// Entry point, from boot(). Initializes Firebase (the auth SDK needs the app
// before the database does) and subscribes to sign-in state.
function startAuth() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey) {
    // No Firebase config at all (local dev). There is nothing to sign in TO —
    // run local-only.
    startApp();
    return;
  }
  if (!firebaseSdkReady()) {
    // A production config but the SDK didn't load: a connectivity failure, NOT
    // "local dev". Never paint an editable app that can never sync, and never
    // fall through to handleAuthUser — a missing firebase.database used to
    // surface there as "not on the camp list" and wipe the local data.
    onSdkLoadFailed();
    return;
  }
  try { sessionStorage.removeItem(SDK_RETRIES_KEY); } catch (e) { /* fine */ }
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
  } catch (e) {
    showAuthScreen('signin', { error: 'Sign-in couldn\'t start — reload to try again.' });
    return;
  }
  // Returning from an emailed sign-in link? Complete it before (well,
  // alongside) the state subscription — success lands in handleAuthUser.
  if (window.CampEmailLink) window.CampEmailLink.completeSignInIfLink();
  firebase.auth().onAuthStateChanged(handleAuthUser);
}

// The sign-in/sync layer can't run (SDK scripts missing, or the member read
// couldn't even be attempted). Whatever this device is showing can be neither
// confirmed nor synced, so it must not be EDITABLE: a hint-painted returning
// editor is downgraded to viewer for this session — the hint and the cached
// camp data are deliberately left alone, so the next load that gets the SDK
// paints exactly as before and nothing entered offline is thrown away. A
// device with nothing painted gets the sign-in screen with the reason. Either
// way the way out is visible (the tap-to-reload bar) and a couple of
// reloads are tried by themselves when connectivity returns.
function onSdkLoadFailed(msg) {
  sdkLoadFailed = true;
  if (appStarted) {
    setMemberRole('viewer');
  } else {
    showAuthScreen('signin', { error: msg || 'Couldn\u2019t reach the sign-in service \u2014 check your connection and reload.' });
  }
  updateSyncIndicator(); // → renderSyncPill: a returning device gets the header pill
  if (!appStarted) showSdkDownBanner(); // the lock screen has no header: it keeps a tap-to-reload bar
  // Chat's "Loading…" becomes its real "sync is off" note now that it's final.
  if (typeof onChatSyncStateChanged === 'function') onChatSyncStateChanged();
  // Bounded: SDK_MAX_RETRIES reloads per tab session (reset once the SDK loads,
  // see startAuth), each fired when the network is back or the phone wakes.
  let tries = 0;
  try { tries = Number(sessionStorage.getItem(SDK_RETRIES_KEY)) || 0; } catch (e) { /* fine */ }
  if (tries >= SDK_MAX_RETRIES) return;
  let fired = false;
  const go = () => {
    if (fired || navigator.onLine === false) return;
    fired = true;
    try { sessionStorage.setItem(SDK_RETRIES_KEY, String(tries + 1)); } catch (e) { /* fine */ }
    doReload();
  };
  window.addEventListener('online', go);
  // Not { once: true }: going HIDDEN is also a visibilitychange, and would
  // spend the listener before the phone ever woke up again.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
}

// The sign-in screen (no header behind it) keeps a plain tap-to-reload bar. A
// plain button on purpose: this is recovery UI for a page whose scripts are
// failing, so it can't lean on the jelly module having loaded. Nothing unsent can
// exist here (the app never started), so it reloads without asking.
function showSdkDownBanner() {
  if (document.getElementById('sdk-banner')) return;
  const bar = document.createElement('button');
  bar.id = 'sdk-banner';
  bar.className = 'update-banner';
  bar.type = 'button';
  bar.textContent = 'Couldn\u2019t connect \u2014 tap to reload';
  bar.addEventListener('click', doReload);
  document.body.appendChild(bar);
}

let memberRef = null; // this account's own campScoreboard/members entry

function handleAuthUser(user) {
  if (memberRef) { try { memberRef.off(); } catch (e) { /* ignore */ } memberRef = null; }
  const key = identityKey(user); // email or phone; '' if neither
  if (!user || !key) {
    authUser = null;
    clearAuthHint();
    if (appStarted) authTornDown = true; // recovery from here is a reload (see onMemberSnapshot)
    showAuthScreen('signin');
    return;
  }
  authUser = user;
  // The approval check: the self-read of this account's member record (keyed
  // by email or phone). Under the locked rules a non-member's read is
  // CANCELLED (not null) — both land on the not-approved screen. Kept attached
  // for live changes: a removal cancels this listener (kick), a role change
  // fires a fresh snapshot.
  if (!appStarted) showAuthScreen('checking');
  // ref() THROWS on an illegal key. Unhandled here, that would abort sign-in
  // with a blank "Checking sign-in…" and no explanation — so treat it as what
  // it is: an identity that can't be on the list.
  if (!isValidMemberKey(key)) { denyMemberFinal(); return; }
  try {
    memberRef = firebase.database().ref(dbPath('members/' + key));
    memberRef.on('value', onMemberSnapshot, onMemberReadError);
  } catch (e) {
    // An exception here is infrastructure (a half-loaded SDK, blocked storage),
    // NOT "this account isn't on the list" — the illegal-key case this catch
    // used to stand in for is isValidMemberKey's job above. denyMemberFinal
    // would wipe the cached camp data (offline-entered scores included) and tell
    // an approved director they have been removed. Show a reloadable error.
    console.warn('member ref failed', e);
    onSdkLoadFailed('Couldn\u2019t reach the camp database \u2014 check your connection and reload.');
  }
}

function onMemberSnapshot(snap) {
  const rec = snap.val();
  if (!rec || !rec.role) { denyMember(); return; }
  // Approved HERE, so the one-shot camp bounce (denyMember) has done its job:
  // re-arm it. Left set, a senior-only counselor who later signs out (or is
  // revoked and re-added) lands back on the junior default with the guard
  // still tripped, and is turned away without the senior probe ever running —
  // for the rest of the tab/PWA session. NOT cleared in clearLocalData:
  // denyMemberFinal calls that, and clearing there would let denied-in-both
  // loop. Approval is the only point that proves the bounce landed.
  try { sessionStorage.removeItem(CAMP_SWITCH_TRIED_KEY); } catch (e) { /* fine */ }
  memberName = rec.name || null;
  setMemberRole(rec.role);
  setMemberTeam(rec.teamId); // which team they're ON (auto-follow + own-team guard)
  setAuthHint(memberRole);
  if (authTornDown) {
    // Sign-in was lost and re-established mid-session. The database listeners
    // from before are permanently dead (a cancelled read is terminal — see
    // initSync), so the honest recovery is a clean reload.
    location.reload();
    return;
  }
  startApp();
  startSync(); // attach the database listeners — only ever from here
  probeOtherCamp(); // one-shot: is this account on the OTHER camp's list too?
  maybeShowCampPicker(); // dual-camp accounts choose a camp every launch
}

function onMemberReadError() {
  denyMember(); // read refused by rules: signed in, but not on the list
}

function denyMember() {
  // Not on THIS camp's list — but maybe on the other one. The default camp
  // is junior, so a senior-only counselor's first sign-in lands here; probe
  // the other camp once and switch over instead of turning them away. The
  // sessionStorage flag makes the bounce one-shot (denied in BOTH camps
  // must end at the denial screen, never a reload loop).
  const key = identityKey(authUser);
  let tried = false;
  try { tried = sessionStorage.getItem(CAMP_SWITCH_TRIED_KEY) === '1'; } catch (e) { /* fine */ }
  const canProbe = key && !tried && typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length;
  if (canProbe) {
    const other = CAMPS[otherCampId()];
    try {
      firebase.database().ref(other.dbRoot + '/members/' + key).once('value')
        .then((snap) => {
          const rec = snap.val();
          if (rec && (rec.role === 'editor' || rec.role === 'viewer')) {
            try { sessionStorage.setItem(CAMP_SWITCH_TRIED_KEY, '1'); } catch (e) { /* fine */ }
            writeCampsHint(other.id, rec.role);
            writeCampsHint(CAMP.id, null);
            switchCamp(other.id);
          } else {
            denyMemberFinal();
          }
        })
        .catch(denyMemberFinal);
      return;
    } catch (e) { /* fall through */ }
  }
  denyMemberFinal();
}

function denyMemberFinal() {
  const who = identityLabel(authUser); // email or phone number
  setMemberRole(null);
  setMemberTeam(null);
  memberDirectory = null;
  memberDirectoryLoaded = false;
  clearAuthHint();
  // A device that isn't approved shouldn't keep camp data around either.
  clearLocalData();
  try { clearPhotos().catch(() => {}); } catch (e) { /* ignore */ }
  // If sync had already started, this is a REVOCATION mid-session, and every
  // other terminal auth transition in this file reloads (signOutAndClear, the
  // re-sign-in-after-teardown path). Hiding the app behind a CSS class would
  // leave the whole scoreboard and the chat backlog sitting live in the DOM,
  // one devtools inspection away, on a device we just cut off. Reload instead.
  // Guarded on syncStarted so a never-approved account, which reaches here on
  // its FIRST sign-in, still gets the denied screen rather than a reload loop
  // (the hint is cleared above, so the reloaded page paints locked).
  if (syncStarted) { location.reload(); return; }
  showAuthScreen('denied', { email: who });
  askToJoinStart(); // the walk-up's way in (setup-rebuild-spec §11.18): shown only if the published rules answer a read of our own row
}

// ── Pre-paint hint ───────────────────────────────────────────────
// Approved devices cache their last confirmed role so the NEXT load paints
// the app instantly from local state while sign-in re-confirms in the
// background (index.html's pre-paint guard reads the same key). Purely a
// convenience — the security rules never consult it.
function setAuthHint(role) {
  try { localStorage.setItem(AUTH_HINT_KEY, role); } catch (e) { /* fine */ }
  writeCampsHint(CAMP.id, role); // the per-camp ledger behind the camp picker
}

function clearAuthHint() {
  try { localStorage.removeItem(AUTH_HINT_KEY); } catch (e) { /* fine */ }
}

function authHintRole() {
  try {
    const h = localStorage.getItem(AUTH_HINT_KEY);
    return h === 'editor' || h === 'viewer' ? h : null;
  } catch (e) { return null; }
}

// ── The other camp ───────────────────────────────────────────────
// One account can be on the junior list, the senior list, or both — each
// camp keeps its own members node (campScoreboard/members vs
// seniorScoreboard/members). This device only ever ATTACHES listeners for
// the active camp; the other camp gets a single one-shot once() probe (a
// failed once() is harmless — it's the .on() self-read whose cancellation
// is terminal). CAMPS_HINT_KEY caches what the probes learned —
// {junior: 'editor', senior: 'viewer'} — so the camp picker and switcher
// can paint instantly on later loads. Like the auth hint, it's convenience
// only: the rules never consult it, and a forged entry buys an empty shell.
const CAMPS_HINT_KEY = 'campScoreboardCampsHint';
const CAMP_SWITCH_TRIED_KEY = 'campSwitchTried'; // sessionStorage loop guard
const CAMP_ASKED_KEY = 'campScoreboardCampAsked'; // the one-time "which camp?" ask already happened

let otherCampRole = null;   // 'viewer' | 'editor' | null — this account, other camp
let otherCampProbed = false;
let campPickerAsked = false; // the every-launch ask happens once per page load

function readCampsHint() {
  try {
    const h = JSON.parse(localStorage.getItem(CAMPS_HINT_KEY) || '{}');
    return (h && typeof h === 'object' && !Array.isArray(h)) ? h : {};
  } catch (e) { return {}; }
}

function writeCampsHint(campId, role) {
  const h = readCampsHint();
  if (role === 'editor' || role === 'viewer') h[campId] = role;
  else delete h[campId];
  try { localStorage.setItem(CAMPS_HINT_KEY, JSON.stringify(h)); } catch (e) { /* fine */ }
}

// True when this account is (as far as the hints know) on BOTH camps' lists.
function hasBothCamps() {
  const h = readCampsHint();
  return !!(h.junior && h.senior);
}

// Set-key-and-reload — the ONLY way to change camps. The listener lifecycle
// is one-shot by design (a cancelled read is terminal; there is no teardown
// path), so a running page never re-points its refs in place.
// A saved-but-unconfirmed edit on this page — what a deliberate reload
// (camp switch, sign-out) would silently throw away, since the SDK's offline
// queue lives only in memory. Deliberately NOT editorMidEntry(): on Chrome the
// control that was just tapped (the Camp segmented control, the Sign out
// button) is itself a focused Jelly host, so that would always say yes.
function hasUnsyncedWork() {
  return pendingWritesTotal() > 0 || dataEditPending || pushTimer != null || pushConfigTimer != null ||
    (typeof setupBusy === 'function' && setupBusy()) ||
    (typeof campersBusy === 'function' && campersBusy()) ||
    (typeof builderDirty === 'function' && builderDirty());
}

// Work saved on this phone that the server never confirmed — including
// work from an EARLIER session (killed before it uploaded), which no
// in-memory flag knows about. Only sign-out needs this: it wipes the cache,
// the one copy of that work. (A camp switch keeps per-camp storage.)
function hasUnconfirmedLocalWork() {
  if (pendingConfigWrites > 0) return true; // a builder save the server hasn't acknowledged
  // Saved on this phone but never confirmed — including a builder edit from an
  // earlier session, which only the persisted baseline (_cfgBase) can tell apart.
  if (directorTab() && Object.keys(cfgUnconfirmed()).length) return true;
  // The same for the week's setup (setup-sync.js): an unconfirmed path, a parked refusal.
  if (directorTab() && typeof setupHasUnconfirmed === 'function' && setupHasUnconfirmed()) return true;
  try {
    const base = confirmedTree || bootSyncedTree;
    if (!base) return false;
    return Object.keys(computeSyncUpdates(syncCanonTree(base), syncCanonTree(syncedSnapshot())))
      .some((p) => p !== 'meta/lastDataChangeAt');
  } catch (e) { return false; }
}

function switchCamp(campId) {
  if (!CAMPS[campId] || campId === CAMP.id) return;
  // Send anything still sitting in the debounce first; only then ask whether
  // something is genuinely unconfirmed. A confirm, not a hard block: an
  // offline director must never be wedged on the wrong camp.
  flushPendingPush();
  if (hasUnsyncedWork() &&
      !confirm("A score you saved hasn't reached the server yet. Switching camps now can lose it. Switch anyway?")) {
    paintSeg(document.getElementById('camp-switch'), CAMP.id); // it already moved — put it back
    return;
  }
  // Storage blocked (private mode, or a locked-down browser): the whole switch
  // is set-key-then-reload, so without the key the reload would land back on
  // the same camp. Say so instead of silently doing nothing — a senior-only
  // counselor bounced here would otherwise sit on "Checking sign-in…" forever.
  try {
    localStorage.setItem(ACTIVE_CAMP_KEY, campId);
  } catch (e) {
    showToast("This browser is blocking site storage, so the camp can't be remembered. Turn off private browsing and try again.");
    return;
  }
  // Hand the destination camp's cached role to the pre-paint guard so the
  // next load paints with the right chrome immediately.
  const role = readCampsHint()[campId];
  try {
    if (role === 'editor' || role === 'viewer') localStorage.setItem(AUTH_HINT_KEY, role);
    else localStorage.removeItem(AUTH_HINT_KEY);
  } catch (e) { /* fine */ }
  location.reload();
}

// One-shot probe of the other camp's member record, fired after this camp
// approves. Fills otherCampRole + the camps hint, then surfaces the
// dual-camp UI (picker on launch, switcher row) if it just became relevant.
function probeOtherCamp() {
  if (otherCampProbed) return;
  otherCampProbed = true;
  const key = identityKey(authUser);
  if (!key || typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
  const other = CAMPS[otherCampId()];
  const record = (rec) => {
    otherCampRole = rec && (rec.role === 'editor' || rec.role === 'viewer') ? rec.role : null;
    writeCampsHint(other.id, otherCampRole);
    if (appStarted) {
      updateAccountRow();
      maybeShowCampPicker();
    }
    // A director of both camps hears about the other camp's waiting requests once (setup-sync.js peopleOtherCampProbe): the first
    // time this device meets the second camp the role is not known until HERE, after the requests listener has attached.
    if (typeof peopleOtherCampProbe === 'function') peopleOtherCampProbe();
  };
  try {
    firebase.database().ref(other.dbRoot + '/members/' + key).once('value')
      .then((snap) => record(snap.val()))
      .catch(() => record(null)); // rules refused the read — not on that list
  } catch (e) { record(null); }
}

// An account with BOTH camps gets asked which one ONCE — the first time
// this device discovers the second camp — and the answer is remembered
// (the active-camp key). After that the app opens straight into the camp
// you used last; switching lives in Settings (the Camp switcher) and the
// footer camp chip. Single-camp accounts never see any of this.
// (Owner's revised call, 2026-07-25 — this replaced ask-every-launch.)
function maybeShowCampPicker() {
  if (campPickerAsked || !hasBothCamps()) return;
  campPickerAsked = true;
  try {
    if (localStorage.getItem(CAMP_ASKED_KEY) === '1') return; // already answered once
    localStorage.setItem(CAMP_ASKED_KEY, '1');
  } catch (e) { /* fine */ }
  openCampPicker();
}

function openCampPicker() {
  const overlay = document.getElementById('camp-picker-overlay');
  const wrap = document.getElementById('camp-picker-options');
  if (!overlay || !wrap) return;
  closeTeamPicker(); // one dialog at a time — the camp question comes first
  const h = readCampsHint();
  wrap.innerHTML = ['junior', 'senior'].map((cid) => {
    const c = CAMPS[cid];
    const here = cid === CAMP.id;
    const role = h[cid] === 'editor' ? '✏️ Editor' : '👀 Viewer';
    return `<button class="team-picker-option camp-picker-option ${here ? 'selected' : ''}" data-camp-id="${esc(cid)}">
      <span class="chip-emoji">${cid === 'senior' ? '🚩' : '🛡️'}</span> ${esc(c.label)}
      <span class="chip-sub">${role}${here ? ' · you\u2019re here now' : ''}</span>
    </button>`;
  }).join('');
  wrap.querySelectorAll('.camp-picker-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cid = btn.dataset.campId;
      if (cid === CAMP.id) { closeOverlayAnimated(overlay); return; } // staying put
      switchCamp(cid);
    });
  });
  overlay.setAttribute('open', '');
}

// ── Sign out ─────────────────────────────────────────────────────
// Signing out also clears the camp data cached on this device — the whole
// synced state lives in localStorage (and Pictionary photos in IndexedDB),
// and once PII rides along in it, a signed-out device must not keep a copy.
// The theme preference resets to Auto (the boot guards discard partial
// state, so there is deliberately no carry-over mechanism).
function clearLocalData() {
  // Both camps' caches go — sign-out is account-level, and a signed-out
  // device must not keep either camp's data. (The bare base names are the
  // junior keys; the suffixed ones are senior's.)
  // (Phone alerts: the per-camp on-flag and prefs go too. The browser-wide
  // device id and the sender's public key stay — neither is camp data — and
  // the device's database records are deleted by pushSignOut beforehand.)
  const bases = ['campScoreboardV2', 'campScoreboardDayRanks',
    'campScoreboardDismissedChanges', 'campScoreboardDismissedAnnouncements',
    'campScoreboardChatSeen', 'campScoreboardChatSubs',
    'campScoreboardPushOn', 'campScoreboardPushPrefs', STRANDED_KEY, UNDO_KEY,
    'campScoreboardRevealCache', 'campScoreboardChampion', // (reveal.js: the last real reveal as the phone held it; the crowned team's name)
    'campScoreboardTellDraft', // (tell.js: a half-typed Tell everyone message)
    'campScoreboardSetupV1', 'campSetupRpOutbox', 'campSetupRainDraft', 'campSetupAlertIntent',
    'campScoreboardEpochSeen', 'campWizardDraft']; // (the camp year this device last saw; the new-year setup's unfinished answers) (setup-sync.js: the setup cache, the restore-point outbox; setup-ui.js: an unfinished rain plan, a leftover alert choice from before Step 26, wiped only)
  Object.keys(CAMPS).forEach((cid) => {
    bases.forEach((b) => {
      try { localStorage.removeItem(b + CAMPS[cid].storageSuffix); } catch (e) { /* ignore */ }
    });
  });
  // The calm-motion switch and its last verdict (device-wide, like the theme
  // keys) go with the rest: a signed-out device is a clean one.
  [AUTH_HINT_KEY, EMAIL_SIGNIN_KEY, CAMPS_HINT_KEY, ACTIVE_CAMP_KEY, CAMP_ASKED_KEY, THEME_HINT_KEY,
    JellyMotion.keys.pref, JellyMotion.keys.last].forEach((k) => {
    try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
  });
}

let signingOut = false;

function signOutAndClear() {
  if (signingOut) return;
  flushPendingPush();
  // Work set aside from a previous camp year lives only on this phone too: say so
  // first, whichever question follows (see "Stranded work").
  const strandedN = strandedCount();
  const them = strandedN === 1 ? 'it' : 'them';
  const strandedNote = strandedN
    ? `This phone still holds ${strandedN} change${strandedN === 1 ? '' : 's'} from last camp week that never synced. Signing out deletes ${them}; Download ${them} from the bar at the top first if you want ${them}.\n\n`
    : '';
  const msg = strandedNote + ((hasUnsyncedWork() || hasUnconfirmedLocalWork())
    ? "A score you saved hasn't reached the server yet — signing out now will lose it. Sign out anyway?"
    : 'Sign out? Camp data stored on this device will be cleared.');
  if (!confirm(msg)) return;
  signingOut = true;
  // Phone alerts first, while still signed in: this device's push records
  // can only be deleted by their owner, so after signOut() the rules refuse.
  // pushSignOut is bounded (3s) and never rejects — a dead connection delays
  // sign-out a moment, it can't block it. Without push.js this is a no-op.
  const pushDone = typeof pushSignOut === 'function'
    ? Promise.resolve().then(pushSignOut).catch(() => {})
    : Promise.resolve();
  pushDone.then(finishSignOut);
}

function finishSignOut() {
  clearLocalData();
  // Sign-out is a fresh start: the next account on this tab may be a
  // senior-only counselor who needs the camp bounce (see onMemberSnapshot).
  try { sessionStorage.removeItem(CAMP_SWITCH_TRIED_KEY); } catch (e) { /* fine */ }
  try { clearPhotos().catch(() => {}); } catch (e) { /* ignore */ }
  // The active camp's photo store is cleared above; delete the other
  // camp's database wholesale (it isn't open, so deleteDatabase is safe).
  try { indexedDB.deleteDatabase('campScoreboardPhotos' + CAMPS[otherCampId()].storageSuffix); } catch (e) { /* ignore */ }
  const done = () => location.reload(); // full teardown: timers, listeners, in-memory state
  try {
    firebase.auth().signOut().then(done, done);
  } catch (e) {
    done();
  }
}

function boot() {
  applyTheme(); // the lock screen is the first thing everyone sees — theme it too
  watchOsColorScheme();
  // Name the page after the active camp so a phone with both camps open in
  // two tabs can tell them apart. Junior keeps the plain "Camp" it always had.
  if (CAMP.id === 'senior') {
    document.title = 'Camp · Senior';
    const logo = document.querySelector('.lock-logo');
    const nm = logo && logo.querySelector('.lock-logo-name');
    if (nm) nm.textContent = 'Camp · Senior'; // the big screen's camp mark stays; only its words change
  }
  wireAuthScreen();
  // A device that was approved last time paints the app immediately from
  // local state (exactly the pre-auth behavior) with its cached role, while
  // startAuth() re-confirms in the background — and intervenes only if the
  // server disagrees. A forged hint buys an empty shell: the rules refuse
  // every read, and denyMember() locks the screen again.
  // Prefer the per-camp ledger (a dual-role account paints with the RIGHT
  // role for this camp); fall back to the single-value hint.
  // The hint is PROVISIONAL: it paints the shell, but no standings or points
  // until the member record answers (setMemberRole). A stale 'editor' hint on a
  // counselor's phone must not show the cached week while the answer is missing.
  const campsHint = readCampsHint()[CAMP.id];
  const hinted = (campsHint === 'editor' || campsHint === 'viewer') ? campsHint : authHintRole();
  if (hinted) {
    setMemberRole(hinted, { provisional: true });
    startApp();
    maybeShowCampPicker(); // dual-camp devices choose a camp every launch
  } else {
    showAuthScreen('checking');
  }
  startAuth();
}

document.addEventListener('DOMContentLoaded', boot);
