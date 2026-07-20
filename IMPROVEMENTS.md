# Improvement plan — Camp Scoreboard

Written 2026-07-20 after a full-project review (all of `app.js`, `index.html`,
`styles.css`). This is an ordered, implementation-ready backlog for the next
Claude session. Every claim below was verified against the code; line numbers
are approximate (the file shifts) — search for the quoted identifiers.

## Ground rules (read first)

- **It is camp week. The site is live and in use.** `main` is the deploy branch,
  but GitHub Pages currently still serves `claude/festive-bohr-Wt6Np` — push every
  change to BOTH (plus the working branch), then verify against
  https://camp.patricksimpson.info per CLAUDE.md. Bump all three `?v=N` strings in
  `index.html` and `CODE_UPDATED_AT` in `app.js` on every deploy; `node --check app.js`.
- **Never regress the sync invariants** (CLAUDE.md): push gated on `remoteReady`;
  missing snapshot key = empty (only `teams` guarded); `normalizeSyncedState()`
  heals RTDB-pruned empties. Any new synced field follows the `bonuses` pattern
  (SYNC_KEYS + merge array + normalize + resetWeek).
- **Test before deploying**: headless Chromium + Playwright is available
  (`NODE_PATH=$(npm root -g)`, launch `chromium` from the global playwright).
  Serve with `python3 -m http.server`. Seed `localStorage`
  (`campScoreboardUnlocked=1`, `campScoreboardRole=edit`, `campScoreboardV2`).
  Use the `?now=<dow>-<hhmm>` URL override for schedule states. Firebase is
  unreachable from the sandbox — `ERR_CONNECTION_RESET` console errors are
  expected, not failures. Screenshot light + dark at 360–414px widths.
- Work items are ordered. **P0 before anything else** — those protect this week's
  data. Ship small commits; deploy + verify each.

## P0 — Data safety (do these first, they are small)

### 1. Offline-entered results can be silently destroyed by the first sync snapshot
`pushState()` early-returns until `remoteReady` (first snapshot), and nothing
re-queues the push afterward. So: page loads on dead wifi → scorer saves a result
→ push no-ops → wifi returns → first snapshot **replaces** `state.results` with
the server copy → the result vanishes. Also: `schedulePush` is a 400ms
`setTimeout` with no flush — locking the phone right after "Save Result" strands
the push (iOS suspends timers).
Fix, in `initSync`/`pushState` area of `app.js`:
- Add a `pagehide` + `visibilitychange`(hidden) listener that, when a `pushTimer`
  is pending, clears it and calls `pushState()` synchronously.
- Track a module-level `dirtySinceLoad = true` in `saveState()` when
  `!remoteReady`. In the first-snapshot merge, if `dirtySinceLoad` and local
  `state.meta.lastDataChangeAt` is strictly newer than
  `remote.meta.lastDataChangeAt`, **push local instead of adopting remote**
  (set `remoteReady = true` first so the push flows). Otherwise merge as today.
Verify: Playwright — stub `window.FIREBASE_CONFIG = {}` off/on; simulate by
calling the merge logic directly (pattern in scratchpad smoke tests); confirm a
locally-saved result survives a first snapshot that lacks it when local meta is
newer, and is replaced when older (current behavior).

### 2. `saveState()` throws unguarded in private mode / on quota
`localStorage.setItem(STORAGE_KEY, ...)` is bare while every other storage access
is try/caught. One failure makes every Save button appear dead.
Fix: wrap in try/catch, still call `schedulePush()` on failure (cloud + memory
still work). One-liner.

### 3. Bonus ✕ remove has no confirm — the only destructive action without one
`renderBonuses` remove handler: `delete state.bonuses[...]` on a single tap of a
small right-edge target, and the deletion syncs everywhere. Every comparable
action (`clear-result`, `resetWeek`, `reset-round`, `cancel bracket`) confirms.
Fix: `if (!confirm(...))` naming the team, label, and points.

## P1 — Correctness bugs

### 4. Device-timezone leaks (3 places disagree with camp time)
`campNow()` (America/New_York) is authoritative, but:
- `defaultDay()` — `new Date().getDay()`
- `renderDayTabs()` — `const todayDow = new Date().getDay()` (today-dot AND the
  "Heads up: today is…" note below the tabs)
- `standingsSummaryText()` — `new Date().toLocaleDateString([], ...)` header
A West-Coast parent late evening sees the wrong "today" tab while the schedule
sheet (which uses `campNow().dow`) disagrees on the same screen.
Fix: use `campNow().dow` in the first two; format the summary date with
`Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, weekday:'short', month:'short', day:'numeric' })`.

### 5. Open schedule sheet goes stale
The 30s interval calls only `renderNowBanner()`; `renderAll()` never touches the
sheet. Leave the sheet open across a block boundary → the NOW pill and dimming
are wrong; a game result syncing in doesn't update the ✓ chips.
Fix: in the interval callback and at the end of `renderAll()`:
`if (!scheduleOverlayEl().hidden) renderScheduleBody();`

### 6. Every sync snapshot (including the echo of your own push) rebuilds the UI and kills input focus
RTDB fires a local `value` event for your own `set()`. Typing in the tally /
bonus-points / custom-label inputs → `saveState` → push at 400ms → echo snapshot
→ `renderAll()` → focus lost, iOS keyboard dismisses. Other devices' pushes do it
at any moment.
Fix in the snapshot handler: before `renderAll()`, compare the incoming synced
slice with current state (`JSON.stringify` of the SYNC_KEYS subset is fine at
this scale) and skip the render when identical. Belt-and-braces: skip rebuilding
when `document.activeElement` is a text input inside `#entry-area`/`#bonus-body`
and values are equal.
Verify: Playwright — focus the bonus points input, call the merge with identical
data, assert focus retained.

### 7. Messtival double points — **DECISION NEEDED FROM PATRICK**
Friday's games carry `messtival: true` and the banner says "worth DOUBLE points
on the big scoreboard! (Track that on paper.)" — but `medalCounts()` applies flat
`MEDAL_POINTS`. Since the app is now fully points-based, Friday's app standings
will diverge from the paper scoreboard.
Ask Patrick: should messtival medals count double in the app?
- If yes: in `medalCounts()`, iterate `Object.entries(state.results)` and weight
  by `gameById(id).messtival ? 2 : 1`; update the banner copy ("counted double
  here too"); add `×2` note on Friday game cards.
- If no: change the banner/messtival tag copy so the app doesn't promise doubling.

### 8. Negative bonus points can't be typed on iPhone
`#bonus-points` is `type="number" inputmode="numeric"` — the iOS numeric pad has
no minus key, yet negatives are supported downstream (`.neg` styling). Also no
integer/bounds validation (`2.5`, `1e6` flow through).
Fix: add a +/− toggle button beside the field (default +); validate
`Number.isInteger(pts) && Math.abs(pts) <= 100`.

### 9. Countdown alarms don't fire while the phone is locked; timers lost on reload
`liveTimers`/`liveWatches` are in-memory; `tick()` is a suspended `setInterval`
when backgrounded, so `playAlarm()` only fires after wake. Reload mid-countdown
resets the clock (completed Pictionary laps are safe — synced; verified).
Fix (keep it device-local — do NOT sync):
- Persist `{endAt, duration, round, running, alarming}` per game to
  `localStorage` on start/pause/reset; rehydrate in `countdownHTML`.
- On `visibilitychange` → visible, if any timer's `endAt <= now` and not yet
  alarmed, fire `playAlarm()` immediately.
- While a timer runs, request `navigator.wakeLock.request('screen')` (guarded,
  re-request on visibilitychange); release on stop.

### 10. Time formatting edges
`formatScore` can emit "1:60" (rounding carries `s` to 60 — e.g. 119.97s);
`parseScoreInput` accepts negative times like `-1:30`.
Fix: after rounding, `if (s >= 60) { m += 1; s -= 60; }`; reject negatives.

## P2 — Graphics & UX (the fun part)

### 11. `<head>` identity: favicon, theme-color, description, apple-touch-icon
There is none of it. Add (no build step required):
- SVG emoji favicon data-URI (🏅).
- `<meta name="theme-color">` twice with `media` for light (`#f4f6f9`) and dark
  (`#10141c`) — AND update it from `applyTheme()` since the app can override the
  OS theme.
- `<meta name="description">` + `og:title`/`og:description`.
- `apple-touch-icon.png` — generate a real 180×180 PNG (🏅 on `#3355ff` rounded
  square; Python/PIL or canvas in Playwright, commit the file). iOS ignores SVG.
- Optional: tiny `manifest.json` (`display: standalone`, name, icons) so
  "Add to Home Screen" feels like an app. (Full offline service worker is P3.)

### 12. Dark mode is broken on the PIN lock screen + incomplete pre-paint fallback
The `@media (prefers-color-scheme: dark)` fallback overrides only 5 tokens;
`body.dark-theme` overrides 16. And `applyTheme()` only runs from `init()`, which
`boot()` skips while locked — so the lock screen (first thing everyone sees)
renders OS-dark users a half-dark theme: light-blue primary dots, cream gold
chips, wrong shadows. Fix:
- Copy the remaining token overrides (primary/primary-dark/primary-hover/danger/
  gold/silver/bronze pairs/shadows) into the `@media` fallback block.
- Add `color-scheme: light`/`dark` to the token sets so native `<select>`/input
  chrome matches (medal picker in dark mode currently gets light UA chrome).
- Call `applyTheme()` (or a minimal class-set based on saved `state.theme`) from
  `boot()` before `showLockScreen()`.

### 13. Podium-tint the top-3 standings rows
Rank 1 currently looks like rank 6. In `renderStandings`:
`tr.className = i < 3 && s.points > 0 ? 'podium-row podium-' + (i + 1) : ''`
(the `points > 0` gate keeps Monday's all-zero table neutral). CSS with existing
tokens: row background `var(--color-gold-bg)` (+silver/bronze), rank cell colored
+ 800 weight, inset 3px left accent. Also wrap zero medal counts in a
`.zero { opacity: .35 }` span so earned medals pop. Both themes come free via
tokens. Screenshot both.

### 14. Confetti on result save 🎉
Three "it's official" moments end in a silent re-render: tally save handler,
placement save handler, `save-bracket-btn` in `renderBracketSummary` (plus a
smaller burst on the championship winner tap). Add `celebrate(goldTeamId)`:
~40-line dependency-free canvas overlay (`position:fixed; inset:0;
pointer-events:none; z-index:2000`), ~80 particles, gravity, 1.5s, then remove.
Use token colors AND `fillText(teamEmoji(goldTeamId))` for some particles —
the winning mascot raining down will land with kids. Guard:
`if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;`
Pairs with the existing `playHighScore()` chime.

### 15. Progress bar in the Happening Now banner
`nowBannerHtml` has `b.start`/`b.end`/`minutes`; banner already re-renders every
30s. Append a 4px `.now-progress` track+fill (tokens: border bg, primary fill)
showing elapsed fraction of the current block. Skip for `noTime` blocks and the
pre-first-block states. "How long until lunch" as a filling bar.

### 16. Schedule reachable during competitions
`nowBannerHtml` returns `null` for `type === 'games'` blocks, and the banner is
the only way into the schedule sheet — so it's unreachable exactly during
10:00–11:45 and 18:00–18:45. CLAUDE.md documents the hidden banner as deliberate
(scoreboard is the main event), so keep the banner minimal: during games blocks
render a slim single-line variant — `🏅 Team competitions · 📅 Full schedule ›`
— no "Up next", no stations, still tappable. (Alternative if Patrick prefers the
banner fully hidden: a small 📅 button in the header that always opens the sheet.)

### 17. Bottom-sheet polish
- `max-height: 90vh` → add `90dvh` override (iOS URL bar eats the header).
- `.schedule-body` bottom padding → `calc(2rem + env(safe-area-inset-bottom))`;
  add `viewport-fit=cover` to the viewport meta.
- Exit animation: opening animates, closing blinks out — add a 0.2s
  translate-down class before setting `hidden`.
- Swipe-to-dismiss: the grabber implies it. Touch handlers on
  `.schedule-header` ONLY (never the scrollable body): track `touchstart/move`
  translateY, dismiss if `dy > 90`, else spring back. Reset transform in
  `closeSchedule()`.
- `.sched-day-chip` uses transparent borders on `--color-bg` while `.day-tab`
  uses visible borders on `--color-surface` — align the two day-switchers.

### 18. Outdoor readability (counselors in full sun)
- `--color-gold #b8860b` on `--color-gold-bg #fff6dd` ≈ 3.0:1 — fails at the tiny
  sizes it's used (format badges 0.7rem, game result line, bonus subtotal chips,
  played chips). Darken light-theme `--color-gold` to ~`#96690a` (check dark
  theme's `#e8c15a` separately — it's fine).
- `.bonus-hint` is 0.6rem — smallest text in the app carrying real info; raise to
  0.7rem.
- `.counter-btn-sub` drops opacity on colored text — remove the opacity, use a
  lighter weight.
- Consider muted token `#6b7280` → `#5b6472` (light theme) — free contrast.

### 19. More team-emoji moments (cheap, high-delight)
The mascots exist but are missing from: medal picker `<option>`s
(`${teamEmoji(t.id)} ${esc(t.name)}`), tally score rows, live `rank-pill`s,
bracket summary medal rows, and — the big one — `matchupCalloutHTML`, the bracket
hype screen: two large mascots facing off across the "vs".

### 20. Accessibility pass (all small)
- `<th>` 🥇🥈🥉 → wrap `<span role="img" aria-label="Gold medals">` etc.; `#` th
  gets `aria-label="Rank"`.
- `role="alert"` on `#entry-error`, `#bonus-error`, `#lock-error`;
  `aria-live="polite"` on `#sync-status`.
- `aria-pressed` on day tabs, sched-day chips, bonus category/meal/team chips.
- Sheet: set `document.getElementById('app').inert = true/false` on open/close
  (focus already moves in and restores — verified).
- Keypad: `aria-label="Delete digit"` on ⌫; `aria-hidden` on the dots row.
- Global `:is(button,[role=button],select,input):focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }`
  (only `.now-banner` styles focus today).

### 21. Small fixes & cleanups
- `esc()`: add `'` → `&#39;` and `>` → `&gt;` (currently safe — all attrs are
  double-quoted, verified — but it's one refactor from an XSS via team names
  containing `'`).
- `renderBonuses` render-guards for partially-synced entries:
  `esc(b.label || 'Bonus')`, `Number(b.points) || 0` (currently renders
  "undefined" if a field is pruned; doesn't throw — verified).
- Bonus meal chip "Dinner" vs schedule's "Supper" — align (ask Patrick which; the
  schedule and MEALS keys say Supper).
- Delete the unreachable generic stopwatch (`stopwatchHTML`/`bindStopwatch`,
  ~75 lines — no game defines `g.stopwatch`; the Pictionary runner has its own).
- Sync indicator honesty: subscribe `firebase.database().ref('.info/connected')`
  → drive `#sync-status` ("☁️ Synced" / "⚠️ Offline — will sync when back"); in
  the listener's cancel/error callback set `fbRef = null` + update indicator.
  (Currently says "Synced across devices" forever, even offline. Compounds P0#1.)
- Optional: flash a standings row (0.6s background pulse) when its points change
  from a remote sync — remote updates are invisible today.
- Pictionary photo flags are synced but blobs are per-device — other phones see
  "Retake"/"Export N" for photos they don't have; export politely no-ops
  (verified). Cosmetic: caption the export hint "photos live on the phone that
  took them".

## P3 — Stretch (decision-gated, only if the week's needs are met)

- **Offline/PWA**: manifest + a *careful* network-first service worker for the
  three assets. Risk: a bad SW can pin stale code and fight the `?v=` scheme —
  if attempted, use network-first with cache fallback ONLY, version the cache
  with the `?v` number, and add a kill-switch (`self.registration.unregister()`
  path). Do not attempt mid-week without Patrick's go-ahead.
- Meal-cleanup rota display: Patrick will supply which team cleans which
  meal/day; surface it in the schedule sheet meal blocks + a line in the bonus
  card. (Awarding already works via the cleanup category.)

## Open questions for Patrick (collect answers before the relevant item)
1. Messtival: double points in the app on Friday, or fix the copy? (P1 #7)
2. During competition blocks: slim banner (recommended) or header 📅 button? (P2 #16)
3. "Dinner" vs "Supper" wording for cleanup bonuses. (P2 #21)
4. Elective-list name spellings differ from the roster (Lilly/Lily, Sofi/Sofie/
   Sofia) — intentional or normalize?

## Verification playbook (recap)
1. `node --check app.js` after every edit.
2. Playwright locally: seed storage, use `?now=`, exercise the changed flow
   end-to-end, screenshot light+dark at 390px, check `pageerror` is empty and
   `#app` has zero horizontal overflow.
3. Sync-shape tests: simulate merges with keys missing (RTDB prune) — nothing
   throws, empties heal.
4. Bump `?v=` ×3 + `CODE_UPDATED_AT`, commit, push to the working branch,
   `main`, AND `claude/festive-bohr-Wt6Np`, then curl the live site until the
   new `?v=` and a change-specific string appear.
