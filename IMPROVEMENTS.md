# Improvement plan — Camp Scoreboard

Re-audited **2026-07-25**, after camp week finished (the week ran Mon 20 – Fri 24
July 2026). The original version of this file was written 2026-07-20 mid-camp;
essentially all of it — the P0 data-safety items, the P1 correctness bugs, and
the P2 graphics/UX/accessibility list — has since shipped. That backlog has been
replaced with what is actually still open, so nobody re-does finished work.

## Ground rules (read first)

- **`main` is the deploy branch.** GitHub Pages serves camp.patricksimpson.info
  from it; a push to `main` *is* the deploy. Verify against the live URL
  afterwards (see CLAUDE.md) — don't assume.
- **Camp week is over**, so the "an undeployed fix is the same as no fix"
  urgency has lifted. That's the one thing that has genuinely changed about how
  to work here: bigger, riskier changes (the ones marked decision-gated below)
  are now reasonable to attempt, because there's no live scoring to break.
- On every deploy: bump all SIX `?v=N` strings in `index.html` (styles.css,
  vendor/jelly.js, firebase-config.js, defaults.js, app.js, settings.js) plus
  the same `?v=` refs in `current-standings.html` / `stalling.html`, plus
  `APP_VERSION` and `CODE_UPDATED_AT` in `app.js` (and `TV_BUILD` if
  current-standings.html changed).
- **Run the tests**: `node tests/run.js`. Then `node --check` every changed JS
  file. Then the Playwright pass for anything visual (below).
- **Never regress the sync invariants** (CLAUDE.md → "Firebase Realtime Database
  gotcha"). `tests/sync.test.js` pins all of them; if a change makes those tests
  fail, the change is wrong, not the tests.

## Verification playbook

1. `node tests/run.js` — 80+ assertions over the real app.js/defaults.js/
   settings.js. Fast, no deps, no network. Add cases alongside any change to
   scoring, sync, the clock, the schedule data, or backup/restore.
2. `node --check` every changed JS file.
3. Playwright for anything visual: headless Chromium is available
   (`NODE_PATH=$(npm root -g)`, launch `chromium` from the global playwright),
   serve with `python3 -m http.server`. Seed `localStorage.campScoreboardAuthHint
   = 'editor'` to paint the app without a real sign-in (the pre-paint guard
   reads that key). To exercise the auth state machine itself, inject a scripted
   `window.firebase` stub before load and drive `onAuthStateChanged` / the
   member-record listener by hand (see the auth-ui harness used when this
   shipped). The Google popup can't run headless — the live sign-in check
   happens against the deployed site. Use `?now=<dow>-<hhmm>` to pin a schedule
   state. Screenshot light + dark at 360–414px, and assert `#app` has no
   horizontal overflow.
4. Sync-shape checks: simulate merges with keys missing (RTDB prune) — nothing
   throws, empties heal. `tests/sync.test.js` covers this; extend it rather than
   testing by hand.

## Open work

### 1. Real sign-in + locked database — ✅ COMPLETE (2026-07-25)
The PIN gate is gone. Access is Firebase Authentication + Realtime Database
security rules, and the rules are **published and verified**: every
unauthenticated read (state, config, members, changelog),
a write probe, and a self-escalation attempt all return `Permission denied`
(they returned live data that morning). Sign-in is Google (primary) plus
phone and email-link behind "Alternative sign in"; the member allowlist lives
at `campScoreboard/members`, keyed by email OR phone, and `canEdit()` reflects
a server-checked role. Owner `patricksimpson,fx@gmail,com` is seeded as editor
and hardcoded immutable in the rules (the lockout anchor — only the console's
Data tab can change it). Adding a member surfaces a copy-and-send invite.
See CLAUDE.md → "Auth, members & roles" for the model and the published
ruleset's shape.

Standing notes: data exposed before the flip must be assumed already-seen —
the lock protects data **going forward**. (`roster`/`contacts` were pre-gated
paths for PII that was never built; removed from the ruleset 2026-07-26 — a
member-readable, unvalidated path with no feature behind it is a trap waiting
to be filled in.) Safari's ~7-day storage purge signs people
out (one tap to fix). iOS-PWA popups can be flaky → phone/email-link are the
fallbacks. Free-plan caps stand: ~5 email links and ~10 texts per day
project-wide (each method states its cap in the UI and reports "limit
reached" accurately; there is deliberately no live remaining-count, since
Firebase exposes none and faking one would need a public counter in the
locked DB). Follow-ups: if a camper roster or parent-contact feature is ever
built, write its rules AT THAT POINT and make them EDITOR-only read — the old
pre-gated paths were member-readable, which is wrong for minors' details, and
they have been deleted rather than left lying around; Blaze only if the
email/SMS caps start to bite; App Check as optional later hardening.

### 1b. Counselors on teams — ✅ COMPLETE (2026-07-25)
A member record can carry a `teamId`, set per-row in Settings → Who can sign
in. That auto-opens the app on their team (no picker), makes the real
counselor names show on every team (a live `campScoreboard/members` listener
feeds `counselorName()`, with the hand-typed text as the fallback), and keeps
an assigned editor out of scoring the rounds their own team is in
(`canScoreRound` — brackets, tally rows, verse/cleanup/bonus rows; placement
games are deliberately not guarded). Counselors with no sign-in yet live as
`pending-…` rows (name + team, "add email or phone" later), seeded one-tap
from the printed roster. See CLAUDE.md → "Counselors ↔ teams ↔ accounts".

**Rules dependency**: the members rules need `teamId` allowed and
`pending-…` keys accepted, or both the team select and the seed button are
refused (the UI says so). Paste the updated ruleset in the console if that
hasn't happened yet.

### 1c. Senior camp (second camp in the same app) — Phase A SHIPPED (2026-07-25)
The app now carries two camp profiles (`camps.js`): junior (unchanged,
byte-identical paths/keys — pinned by tests) and senior (4 teams with flags,
the published sample-day schedule, no electives, 5 seeded scored games per
day incl. Legacy Game / Hot Seat / Let's Make a Deal). Accounts can be on
either camp's member list or both; dual-camp accounts pick a camp every
launch; a senior-only sign-in auto-bounces from the junior default. See
CLAUDE.md → "Two camps, one app".

**Phase B ✅ DONE (2026-07-25):** senior owner seeded via the console Data
tab and the combined ruleset published — junior verified still locked and
working, senior locked to outsiders, Patrick confirmed the camp picker and
senior scoreboard work on his device. **Phase C (open):** flag artwork +
real accents, real Sun/Sat senior schedule, 4-team bracket (2 semis →
3rd-place match → final), senior meals/verses/cleanup rota data, TV page
`?camp=senior`. (Cross-camp member management shipped 2026-07-26: the
Members drawer is one unified list with per-camp None/Viewer/Editor
switches.)

### 2. Service-worker caching for real offline use — decision-gated
`sw.js` ships deliberately WITHOUT a fetch handler so it can never serve stale
code (kill-switch documented in the file); it exists only so OS notifications
work. Adding caching would make the app usable on the dead patches of camp wifi,
but it's the single easiest way to pin every phone to an old build.

If Patrick wants it: network-first with cache fallback **only**, cache keyed to
the `?v=` number, old caches deleted on activate. Never cache-first. Test the
upgrade path (old SW → new SW → new assets) before it goes anywhere near a
phone, and keep the kill-switch working.

### 3. Copy/consistency nits
- Bonus meal chip says "Dinner"; the schedule and `MEALS` keys say "Supper".
  Pick one (the schedule's wording is "Supper").
- Elective-list name spellings differ from the roster (Lilly/Lily,
  Sofi/Sofie/Sofia). Ask Patrick whether that's intentional before normalizing —
  they may be different kids.

### 4. Change-history readability (small)
Verse and cleanup point edits are stored as delete-then-add in the bonus ledger,
so `describeCauses` logs "Monday memory verse — removed; Monday memory verse —
added" where a human would write "changed 3 → 5". Collapse a removed/added pair
that shares a label into one "changed" line.

### 5. Post-camp: what should the site show now?
Unasked and unanswered, but worth raising rather than guessing: the app is now a
finished week's scoreboard. Options range from "leave it exactly as it is" (a
permanent record — the current behavior, and a perfectly good answer) to a
frozen final-standings view, to archiving the week so next year starts clean.
The backup/restore in Settings → Data already covers keeping the week's data
safely, so nothing is at risk while this stays undecided.

## Shipped since the original audit (do not redo)

Kept as a short ledger so a future session doesn't re-derive these from the
original backlog's numbering.

- **Data safety**: offline-entered results defended against the first sync
  snapshot (`dirtySinceLoad`); `pagehide`/`visibilitychange` push flush;
  `saveState()` guarded against private-mode/quota throws; confirm on bonus
  removal; per-path (per-item, and per-field for `live`) sync writes so two refs
  don't clobber each other; `pendingWrites` guard against stale reconnect
  snapshots.
- **Correctness**: camp-time (`campNow()`) everywhere — day tabs, default day,
  standings summary; open schedule sheet refreshes; renders skipped on snapshot
  echoes so inputs keep focus; Messtival/Thu-evening double points (games and
  bonuses, cleanup exempt); `formatScore` can't emit "1:60"; negative times
  rejected; timers persist and hold a wake lock.
- **Graphics/UX**: full `<head>` identity (favicon, theme-color per scheme,
  description, og tags, apple-touch-icon, manifest); dark mode fixed on the lock
  screen and completed pre-paint; podium-tinted top three; confetti on save;
  progress bar in the Happening Now banner; slim banner during competition
  blocks; bottom-sheet polish (dvh, safe-area, exit animation, swipe-to-dismiss);
  outdoor-readable contrast; team emoji throughout; full accessibility pass
  (aria labels/roles/pressed, `inert` on the sheet, global focus-visible).
- **Later additions**: announcements with auto-expiry, live "Big Board" for
  every live game, per-team verse and cleanup ledgers, change history, week
  builder (teams/days/games) with backup + restore, rank-change arrows,
  catch-up hint, weather/rain hints, `.ics` day export, per-card "hide from
  viewers", Jelly UI migration, joy layer, presence chip.
- **2026-07-25 (this pass)**: deferred remote snapshots are re-fetched when the
  device goes idle instead of dropped; the synced game clock runs on RTDB server
  time (`.info/serverTimeOffset`) so a wrong phone clock can't misreport or
  early-buzz a countdown; `flushPendingPush()` covers the week-config push;
  restore-from-backup normalizes the imported tree; `tests/` added.
