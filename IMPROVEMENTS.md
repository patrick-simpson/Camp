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
   serve with `python3 -m http.server`. Seed `localStorage` with
   `campScoreboardUnlocked=1`, `campScoreboardRole=edit`, and
   `campScoreboardEditEpoch` = the current `EDIT_PIN_EPOCH` from app.js
   (currently `r2`) — without the epoch, index.html's pre-paint guard wipes the
   unlock keys and re-locks the page. Use `?now=<dow>-<hhmm>` to pin a schedule
   state. Firebase is unreachable from the sandbox; `ERR_CONNECTION_RESET`
   console noise is expected. Screenshot light + dark at 360–414px, and assert
   `#app` has no horizontal overflow.
4. Sync-shape checks: simulate merges with keys missing (RTDB prune) — nothing
   throws, empties heal. `tests/sync.test.js` covers this; extend it rather than
   testing by hand.

## Open work

### 1. Make the edit PIN actually secret — needs Firebase Auth (the big one)
This is the only item left with real substance, and camp being over is exactly
the window for it.

Where it stands: the PIN check is PBKDF2-HMAC-SHA256 at 1.2M iterations over a
fresh random salt, so one guess costs ~0.5–2s instead of microseconds. (The
earlier single-SHA-256 scheme was swept end-to-end — both PINs recovered — in
**47ms** on a laptop.) That raises the floor but cannot close the hole:
verification happens in the browser, so every visitor receives the salt, the
iteration count, and both target hashes, and a 4-digit PIN is only 10,000
candidates. A GPU still sweeps that in well under a minute.

Worse, and unfixed: **RTDB is world-writable to anyone who reads
`firebase-config.js`.** The PIN gates the UI, not the database.

The fix for both is to stop checking the secret on the client:
- Firebase Auth — anonymous sign-in plus a custom claim, or a plain
  email/password account per counselor.
- RTDB security rules that allow writes only to authed editors, and (optionally)
  reads only to authed devices at all.
- Then the credential never ships inside the app, and a hostile client can't
  write scores even if it fakes the UI.

Needs Firebase console changes and a migration path for already-unlocked
devices. Was explicitly deferred out of camp week; it is now unblocked.

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
