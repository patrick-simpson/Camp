# Camp Scoreboard — CLAUDE.md

## What this is

A static, vanilla JS/HTML/CSS web app (no build step, no framework, no
`package.json`) that runs camp game scoring for a week-long kids' camp.
Deployed via GitHub Pages at **camp.patricksimpson.info**. Every game and
schedule detail is hardcoded data — there's no backend beyond an optional
Firebase Realtime Database used purely for cross-device sync.

Files:
- `index.html` — page shell
- `boot-guard.js` — the pre-paint lock guard. Its own file ONLY so the CSP can
  refuse inline scripts entirely; must stay a classic (non-module, non-defer)
  `<script>` in `<head>` or the app flashes before it locks. Besides the lock
  it also paints, before the first frame, what the stored hints say: an
  explicit Light/Dark choice (`campScoreboardTheme` → `data-jelly-mode`; Auto
  leaves it unset), `html.calm-motion` + `data-jelly-motion="reduce"` when the
  phone asks for reduced motion or the last session was calm
  (`campScoreboardCalmLast`, written by jelly-motion.js), and
  `html.view-only` for a viewer-hinted device (on a dual-role account the active
  camp's entry in `campScoreboardCampsHint` decides it: the single
  `campScoreboardAuthHint` keeps whichever camp was approved last). A second
  IIFE in it adds `html.jelly-failed` when `vendor/jelly.js` never defines its
  elements, which lifts styles.css's hide of undefined custom elements
  (`:where(html:not(.jelly-failed)) :not(:defined)` — the `:where()` is
  load-bearing) so the Google sign-in button stays usable. The verdict is
  load-based, not a short timer: the module `<script>`'s `error` event, a
  `jelly.js` parse/evaluation `error` (iOS < 16.4 can't parse it), and the
  window `load` event (a module runs before `load`, so elements still
  undefined then means it failed — it catches a browser that reports neither
  error) — plus a 15 s backstop for a request that hangs. A 4 s timer used to
  trip on a merely SLOW load and flash unstyled cards; `whenDefined` withdraws
  the class if the elements do arrive. A third IIFE flips the Google Fonts
  `<link id="gfonts">` from `media="print"` to `all` once loaded (a blocking
  stylesheet left the page blank while fonts.googleapis.com was slow; an inline
  `onload` is refused by the CSP)
- `app.js` — main logic, ~10000 lines. Its **SEAM block** (between the
  `// ── SEAM: week data accessors` and `// ── end SEAM` markers, just after the
  member helpers) is the only code that reads the week's own data — see "The
  week-data seam" below
- `defaults.js` — the built-in default week: day list + full game catalog
  (`defaultConfig()`); live config then lives in synced state
- `camps.js` — the TWO CAMP PROFILES (see "Two camps, one app" below):
  junior + senior, each with its Firebase root, storage namespace, team
  branding, printed daily schedule, and seed data. Loads between defaults.js
  and app.js; app.js reads the profile through the active `CAMP`, and the week
  fields (schedule, meals, electives, verses, rota, team branding) only inside
  its SEAM block
- `camp-core.js` — PURE helpers the app and the TV page share, loaded between
  defaults.js and camps.js: Eastern-time maths (`etWallToEpoch`, DST-safe;
  `push-worker/worker.js` keeps its own pasted copy and `tests/camp-core.test.js`
  fuzzes the two against each other), the double-points window
  (`DOUBLE_BONUS_START/END`, `DOUBLE_WINDOW_LEGACY`, `doubleWindowFor`,
  `bonusIsDouble`; app.js's `bonusCountsDouble`/`inDoubleBonusWindow` call into
  it and a week with no epoch is pinned to the legacy window), `liveGameIdSet`,
  and **the sanitizers** (`safeEmoji`, `safeShort`, `safeColorVars`,
  `safeCrestSrc`, `safeVideoUrl`) that every database string passes through on
  its way into markup or an image address. Nothing runs at load and it touches
  no DOM, storage or network (a test pins that), so the TV page can load it
  without app state
- `reveal-core.js` — the standings reveal's PURE rules, loaded right after
  camp-core.js (it needs `etParts` / `etWallToEpoch`): `groupPlaces` (equal
  points share a place; inside a tie golds, silvers, bronzes, then name),
  `untilFor` (a real reveal hides at 08:00 camp time the NEXT calendar day,
  DST-safe; a practice after 2 h), `normalizeRevealCtl` / `normalizeRevealPub`
  (what a snapshot hands back is whatever a director's device wrote, so every
  reader goes through these: exactly this schema or null, unknown fields dropped,
  names laundered and cut to 30), **`revealView(ctl, pub, serverNow, role, opts)`**
  (the ONLY thing a viewer's screen reads about standings, and it FAILS CLOSED:
  nothing for no / refused / too-new / other-year data or no clock; an expired
  reveal is a closed view whose only content is the champion's NAME line; a
  phone holds the newest place back 3 s after `ctl.sa`, never re-hiding one
  already shown) and `tvFrame` (the big screen's frame as a pure function of
  the node and the server clock). Time is always an ARGUMENT (a number or a
  function read at call time), never read inside, so the 8 AM hide can't depend
  on a cached value; a test pins the file pure. The TV page loads it and takes
  `groupPlaces` from it, so places and tie order match everywhere. The node's
  writer and the phone's readers are `reveal.js` (below)
- `reveal.js` — the standings reveal's ENGINE (see "The standings reveal: the
  engine"): what a phone knows about a reveal (the confirmed store, the
  `revealPublic/real` listener, the cache), the 8 AM rule (`expireReveal`, and on
  directors' phones `retireExpiredReveal`), the champion line, and the directors'
  commands. An optional layer like chat.js: a classic script loaded right after
  app.js, every hook in app.js typeof-guarded
- `reveal-ui.js` — the reveal's SCREENS (see "The standings reveal: the screens,
  behaviour"): the director's remote, Now's live mirror, the frozen grid, the header
  strip, the tab dot, the champion line, More's row and Games' link. Defines
  `revealPaint`, which the engine calls; a classic script right after reveal.js,
  every hook in app.js typeof-guarded, so deleting its `<script>` leaves the engine
  running and painting nothing
- `jelly-motion.js` — the SPRING SYSTEM and the ONE calm-motion switch (see
  "Motion and calm motion" below). A classic script loaded between camps.js and
  app.js with no dependency on `vendor/jelly.js` (that module can't parse on
  iOS < 16.4 and boot-guard's `jelly-failed` path must still move). Globals
  `JellyMotion`, `calmMotion()`, `calmReason()`
- `setup-sync.js` — the SETUP ENGINE (see "The setup engine" below): the week's
  schedule, menus, verses, rota and electives as data under `<root>/setup`, the
  single `persistSetup()` gate, the setup undo domain, the sync line's state.
  Loaded right after app.js (it uses app.js's globals) and before settings.js;
  every hook in app.js is typeof-guarded, so deleting its `<script>` leaves a
  running app. DARK at Step 14: it reads, and writes only when a director acts
  (and every section's switch is the owner's, which nothing turns on yet)
- `setup-ui.js` — SET UP THE WEEK's behaviour (see "Set up the week: behaviour"
  below): the hub and its checklist (`hubStatus`, pure), the frame's head (sync
  line, who's here), Back, the docked undo pill, `askDialog`, the four sheets,
  Restore points and hold-to-confirm. Loaded right after settings.js (which it calls
  for the Classic editor screen); every hook into it is typeof-guarded, so deleting
  its `<script>` leaves the v197 builder (no `data-screen` on `#setup`)
- `settings.js` — the settings sheet + week-builder UI. The builder's
  `jelly-tabs` shell is built ONCE and kept; `renderSettings` refreshes only
  the active card (through `setHtmlIfChanged`), hidden cards are filled one
  per idle slice after it (`prefillBuilderCard`) and refreshed when their tab
  is shown, and the page scroll is put back after every refresh — so a remote
  config echo no longer rebuilds five cards, re-springs the tab pill or throws
  the page to the top. `builderDirty()` counts only an OPEN game editor with
  edits (a stranded draft must not freeze sync or the auto-reload), Back and
  tab switches never silently discard it, and a tab other than Games carries an
  "Unsaved changes" reminder while one is open. Every commit to `state.config` or
  the roster goes through `configEdit` / `stateEdit` (an Undo toast; see "Undo
  core"), looks its record up by id when it runs, and the game editor writes only
  the fields it changed (`gameDraftOrigin`, `gameFieldOps`). A strip above the
  tabs (`configNotesHtml`) lists what the config engine set aside — Put it back /
  Use mine (see "The week config is a field-op engine")
- `chat.js` — Camp Chat (see "Camp chat" below): four channels, automatic
  mention alerts, compressed in-database photos. Self-contained layer,
  loaded after settings.js; every hook in app.js is typeof-guarded
- `push.js` — Phone alerts (see "Phone alerts" below): subscribes the phone
  to Web Push, the 📲 Phone alerts drawer, the director alert composer, and
  publishing the week's schedule for reminders. Self-contained layer loaded
  after chat.js; every hook in app.js/chat.js is typeof-guarded
- `push-worker/` — the alert SENDER: a Cloudflare Worker (free plan) that is
  NOT served to browsers as code — the owner pastes `worker.js` into the
  Cloudflare dashboard. `README.md` there is the plain-English setup guide
- `styles.css` — all styling. The VISUAL SYSTEM block at the top (redesign
  §8) is the one source of colour, type and shape: palette literals (`--paper`,
  `--sheet`, `--ink`/`-2`/`-3`, `--blue`, `--link`, `--roof`, `--gold`, `--live`,
  `--done`, `--well`/`--lift`, medal and flag colours), whole-`font` type tokens
  (`--t-title`, `--t-row`, `--t-meta`, …), the 4px space grid, radii, edges,
  `--target` (44) and the frame heights. Light on `:root`; dark under
  `:root[data-jelly-mode="dark"]` and the OS media query — on `:root`, never
  body, because the `--jelly-*` mapping is declared there. Sourcing runs one
  way only: palette → `--jelly-color-*` (§8.10) → the older `--color-*` names
  (kept for existing rules; `--color-bg`'s literal fallbacks are dead and stay
  only for `shell.test.js`'s pin). Never map a palette or Jelly token from a
  `--color-*` one. Any new colour meets §8.1 rule 6 in BOTH themes (7:1 under
  16px, 4.5:1 at 16px+, 3:1 for boundaries)
- `firebase-config.js` — sync config (also used by Firebase Auth sign-in)
- `auth-email-link.js` / `auth-phone.js` — optional alternative sign-in
  methods (emailed link; phone number + texted code). Each loads via a guarded
  global (`window.CampEmailLink` / `window.CampPhone`) and mounts into the
  "Alternative sign in" disclosure; delete one script tag to drop that method.
  Google is the primary button and always remains.
- `vendor/jelly.js` — vendored Jelly UI web components (chips, buttons,
  drawers, dialogs); it injects `--jelly-*` design tokens on :root at
  runtime inside `@layer jelly`, which styles.css's unlayered mapping (from the
  palette) beats in both modes, from the first frame. It carries LOCAL
  patches (grep `Local patch`: the external-removeAttribute close race,
  the drawer/dialog scrim fade — `jellyScrimFade` — and `part="close"` on the
  dialog's ✕ so styles.css can make it 44×44) that a re-vendor must
  re-apply; `tests/overlays.test.js` runs the real helpers extracted from it
- `sw.js` — notification + push service worker (deliberately NO fetch
  handler, so it can never serve stale code; kill-switch documented inside).
  Registered as `sw.js?v=<PUSH_SW_VERSION>&push=<worker url>` by push.js
- `tests/` — `node tests/run.js`, no dependencies, never served to the
  browser (see "Tests" below). `tests/emulator/` (rules in the RTDB
  emulator) and `tests/push-e2e/` (the alert sender in real workerd) are
  opt-in suites that need npm + Java (the owner-export readiness gate is `tests/emulator/export-replay.mjs`, see "Tests"). `tests/rules-macros.js` is the SOURCE of
  the R1 rules blocks (see "R1" under "Auth, members & roles"); it is not a test
  and is never loaded by the browser. `tests/stall.js` is a preload that makes timers
  stall at random, to hunt tests that wait on the clock (see "Waiting in a test")
- `current-standings.html` + `current-standings.js` + `tv-camp.js` — the big-screen
  reveal page, for BOTH camps (see "The TV page" below): **public and read-only**,
  no sign-in, no Auth SDK, reads only `<root>/revealPublic` and `.info`, writes
  nothing. The page is markup, CSS, its own CSP and the build stamp; its script lives
  in `current-standings.js` (a page with a CSP refuses inline script); `tv-camp.js`
  is a dozen lines that set `window.CAMP_FORCE` from `?camp=` before camps.js
  runs. It loads `defaults.js` + `camp-core.js` + `reveal-core.js` + `camps.js`
  instead of carrying copies, so only the flag shapes are still mirrored ("keep in
  sync")
- `stalling.html` — self-contained presenter gag page (loads no camp code; its
  Current Standings card links to the TV page for the device's camp)
- `manifest.json`, `apple-touch-icon.png` — PWA/home-screen identity
- `images/` — team shields + stalling photos; `CNAME` — custom domain

**There is a reviewed, prioritized improvement backlog in `IMPROVEMENTS.md`**
(written 2026-07-20 after a full-project audit). If asked to improve, polish,
or fix the site without more specific direction, start there — P0 items are
data-safety fixes that should land before further feature work.

## Deployment: push directly to `main`, no PR

**`main` is the live branch.** GitHub Pages serves camp.patricksimpson.info
from it. There is no CI, no build step, and no staging environment — a
push to `main` **is** the deploy. When asked to fix or change something on
this site, commit and push straight to `main`. Don't create a feature
branch and leave the fix sitting in a PR — during camp week, an undeployed
fix is functionally the same as no fix, and that exact mistake already
happened once (see "History" below).

**Before considering any change actually deployed**, verify it's live —
don't just push and assume:
```
curl -s https://camp.patricksimpson.info/app.js | grep -c '<something unique to your change>'
curl -s https://camp.patricksimpson.info/index.html | grep -E 'app\.js\?v=|styles\.css\?v='
```
If the live site doesn't reflect your push, GitHub Pages' source branch may
not actually be `main` (Settings → Pages → Build and deployment → Branch)
— check that before assuming the deploy failed for some other reason.

**Every time any code asset changes:**
1. Bump the `?v=N` cache-busting query string in `index.html` — there are
   NINETEEN on the same number: `boot-guard.js`, `styles.css`, `vendor/jelly.js`,
   `firebase-config.js`, `defaults.js`, `camp-core.js`, `reveal-core.js`,
   `camps.js`, `jelly-motion.js`, `app.js`, `reveal.js`, `reveal-ui.js`, `setup-sync.js`, `settings.js`,
   `setup-ui.js`, `chat.js`, `push.js`, `auth-phone.js`, `auth-email-link.js` —
   keep them in sync, all bumped together. Also bump
   `APP_VERSION` in `app.js` to the same number (it drives the auto-reload
   version check). `stalling.html` loads `vendor/jelly.js`, and
   `current-standings.html` loads `vendor/jelly.js`, `firebase-config.js`,
   `defaults.js`, `camp-core.js`, `reveal-core.js`, `tv-camp.js`, `camps.js` and
   `current-standings.js`, with the same `?v=` scheme — bump those references
   too. (The Firebase SDK
   `<script>` tags are pinned to the SDK version, not `?v=`; `manifest.json`
   and `apple-touch-icon.png` have their own `?v=`, only bumped when those
   files actually change.)
2. Update `CODE_UPDATED_AT` near the top of `app.js` to the current UTC
   time (`date -u +%Y-%m-%dT%H:%M:%SZ`) — this drives the "Code last
   updated" tooltip on More's footer line. There's no build pipeline to stamp
   this automatically, so it's a manual step, easy to forget.
   `current-standings.html` has its own build stamp — bump it when that file
   changes — and the stamp lives in TWO places that must carry the same value:
   `<meta name="tv-build" content="…">` and the exact text `var TV_BUILD =
   '…'` inside an HTML comment (see "The TV page"). Bump both, never one.
3. Run `node tests/run.js`, then `node --check` every changed JS file,
   before committing (see "Tests" below).
   **If you touched `database.rules.json`, it is not live until it is pasted
   into the Firebase console** — the tests only check the file.
   **If you bump the Firebase SDK version**, the three `<script>` tags in
   `index.html` (app, auth, database) and the two in `current-standings.html`
   (app, database: the big screen loads no Auth SDK) carry `integrity="sha384-…"`
   hashes pinned to `10.12.0`. New version ⇒ recompute them, or the SDK is
   blocked and nobody can sign in or sync (`firebaseSdkReady()` fails →
   `onSdkLoadFailed`: a "Couldn't reach the sign-in service" screen, or a
   read-only copy with a tap-to-reload bar on a returning device — it keeps
   the hint and cache, never wipes, and retries a few times on its own):
   `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
   **If you add an external host** (a new API, a font, an image CDN), add it
   to the `Content-Security-Policy` meta tag in `index.html` too, or the
   browser silently blocks the request.
4. **Do NOT add "What's new" banner entries.** The banners are discontinued
   (owner's call, 2026-07-21): the `CHANGES` array at the top of `app.js` is
   kept EMPTY and must stay that way — do not append entries for user-visible
   changes. The queue machinery is left in place but dormant (see "What's new
   banners" below).

## What's new banners & auto-reload

**"What's new" banners — DISCONTINUED (2026-07-21).** The owner turned these
off. `CHANGES` (top of `app.js`) is kept EMPTY so no banner ever renders
(`activeChanges()` returns nothing). Do not add entries. The mechanics below
are preserved only as documentation of the dormant machinery, in case it's
ever revived — but the current policy is: no banners.

`CHANGES` was a hand-maintained
list of recent, user-visible changes. Each entry — `{ id, at, text }` —
can render a dismissible banner at the top of the page (`renderWhatsNew`,
into `#whats-new`). They roll in as a **queue, one at a time, one per
hour**, and only during awake hours. Rules:
- `at` is UTC ISO (`date -u +%Y-%m-%dT%H:%M:%SZ`) — normally the same
  stamp as that deploy's `CODE_UPDATED_AT`.
- **Release schedule** (`changeReleases`): each entry's release time is the
  later of its own awake-slotted ship time (`nextAwakeSlot` — a change
  shipped in quiet hours waits for 8am) and one awake-hour behind the
  previous entry's release (`addAwakeMs`, `CHANGE_SPACING_MS`). So a batch
  shipped overnight starts appearing at ~8am and advances one per hour.
- **One at a time** (`activeChanges`): only the newest entry that has
  rolled in, isn't dismissed, and is still inside its two-hour awake window
  shows — each is superseded by the next as its hour arrives.
- Awake hours are 7am–9pm camp time (`QUIET_END_HOUR`/`QUIET_START_HOUR`);
  the release schedule and the two-hour visibility window both count awake
  time only (`awakeElapsedMs`), pausing overnight.
- `id` is a stable slug; a viewer's dismissal is remembered per-`id` in
  `localStorage` (`campScoreboardDismissedChanges`).
- List order is the queue order (index 0 rolls in first). Add newest
  entries to the front; prune long-past ones when editing the list.
- `renderWhatsNew` runs from `renderAll` and the 30-second interval, so
  banners advance on their own within ~30s, no interaction needed.

**Auto-reload on deploy.** Open phones refresh themselves when a newer
build ships. Each client polls the deployed `index.html` (same-origin,
`cache: 'no-store'`, every couple minutes and on tab refocus —
`startUpdatePolling`/`checkForUpdate`) and compares its `app.js?v=` number
to the one the page is running (`myAppVersion`). A higher deployed number
calls `onNewVersion`. This is **deploy-driven and works on a single
device** — no Firebase or peer announcement involved — which is why the
`?v=` bump on every deploy is what actually triggers it (bump all three
assets together, as always). Every device gets an "Update ready · tap" status
pill in the header (`#hdr-pill`, `renderSyncPill`) and auto-reloads only once `reloadBlocked()`
says it's safe (rechecked inside the final 1.2 s, retried every 12 s):
for EVERY role, no unconfirmed write (`pendingWritesTotal() > 0`: scores AND the
week-config node — the SDK's offline queue is in memory only, so a reload would
lose it — and a refused-write bisect, see "Refused writes" below), no running
Pictionary lap (`liveWatches`), and no chat message being typed into a
focused composer or still sending (`chatComposerBusy`); for editors, also
not mid-entry (`editorMidEntry`: a focused score field, or a queued data
push). A synced game clock deliberately does NOT block it (its `endAt` is in
the database and survives a reload).
The pill's own tap asks first (`wirePill`: `reloadBlocked()` sampled at
pointerdown, since the tap itself blurs the composer) instead of reloading
past an unsent message or a typed score. **The bottom strip is the toaster
alone** (styles.css, THE BOTTOM STACK note): the update bar and the SDK-down
pill moved into the header's status pill (both of the bar's layouts, and the
`has-update-banner` footer room, are gone). Toasts take taps, so they clear the
tab bar (`--tabbar-h` = the bar as drawn, 58px + the home-indicator inset), the
chat composer on the Chat tab (`+ 76px`), and a takeover's dock; while typing in
chat they ride the keyboard (`--kb-h`). Change the offsets together
(`overlays.test.js` pins their order, in all three layers). The ONE bottom bar
left is the sign-in screen's tap-to-reload (`showSdkDownBanner`, `.update-banner`,
only while the app has not started: a lock screen has no header to hold a pill).
`showToast` keeps at most
`TOAST_MAX_VISIBLE` (3) on screen, dismissing the oldest that isn't a "Your
team…" toast.
The reload uses `doReload` (adds a throwaway `?r=` cache-buster, written with
`history.replaceState(history.state, …)` and then `location.reload()`, NOT
`location.replace()`: a replace starts a document whose `history.state` is null,
so the shell read its stack as foreign and filed a second Now and tab above the
old ones, and Back on Now stopped leaving the app) so it
fetches the fresh `index.html` instead of a cached copy and can't loop.
(A phone only starts polling once it's running a build that has this code,
so it auto-reloads from the *next* deploy after it loads this one.)

## Motion and calm motion (jelly-motion.js)

Design: `docs/build-notes/app-shell-redesign-spec.md` §9–10; the reference feel is
`docs/build-notes/mockups/final/motion-demo.html`. Redesign stage D0.

- **Six springs**, one integrator: `JellyMotion.presets` = `press`, `arrive`,
  `snap`, `settle` (full-screen takeovers only), `glide`, `wobble`. They are
  integrated exactly as `vendor/jelly.js`'s `E()` does (semi-implicit Euler, mass
  1, velocity first, ONE step per frame) and SAMPLED at dt = 1/60 s — what a
  Jelly component computes on a 60 Hz phone — so `snap` overshoots 4.9% like
  Jelly's own thumbs (sampling at 1/240 gave 7.3%). `tests/motion.test.js`
  extracts the real `E()` from `vendor/jelly.js` and compares frame by frame.
- **WAAPI only, no residue.** `play` / `playOut` / `press` / `release` /
  `flipKeyed` write no inline style, no class, no `commitStyles()`: a leftover
  `style=""` makes `setHtmlIfChanged` (`el.__dom === el.innerHTML`) rewrite the
  whole root on the next render, re-creating Jelly components and cutting the
  spring off. `fill: 'forwards'` is allowed only for the press hold (release
  always cancels it) and for an exit until its `done()` removed the element.
  `follow()` (an rAF spring that writes style) is only for nodes no string
  renderer rewrites. `restamp(root)` is the escape hatch for a rare in-place
  change inside a `setHtmlIfChanged` root. With no `Element.animate` (very old
  WebKit, the test harness) every helper is a no-op and `playOut` still runs
  its `done()`.
- **Motion starts from diffs, never from renders.** Whoever knows a change
  happened calls `play`; markup never carries animation classes. `morph` /
  `flipKeyed` keep nodes with the same `data-key` (so a FLIP can move the real
  nodes — rewriting a root through innerHTML replaced the nodes a plain FLIP
  measured, and neighbours just jumped). `whenHandsOff(fn)` runs a list reflow
  only with no pointer down and 400 ms after the last touch (a pointer "down"
  for over 10 s counts as lost).
- **app.js survives a missing jelly-motion.js.** A no-op `JellyMotion` +
  `calmMotion()` / `calmReason()` stand-in at the top of app.js (nothing moves,
  nothing is calm) is installed only when the real script never defined them; chat.js and
  push.js are typeof-guarded the same way. `shell.test.js` boots the real scripts
  without the file (`makeContext({ without: [...] })`).
- **One calm switch: `calmMotion()`** (and `calmReason()`). App code never reads
  `matchMedia` for motion again. The OS "reduce motion" setting beats the switch
  (it is an accessibility setting; Off must not override it); Off beats only
  the battery signals; Auto adds the frame-rate sampler (≤ 36 Hz twice in a row
  = saver, ≥ 50 Hz twice = not; 24 rAF intervals, median; 2 s after boot, 1.5 s
  after the page becomes visible, every 5 min; it NEVER samples while
  `JellyMotion.busy()` — a running animation, or a `busySource` the app
  registered — and abandons a sample if motion starts mid-way) and
  `navigator.getBattery()` (≤ 20% and not charging; Android Chrome only).
  A FIRST reading that disagrees with the current verdict is confirmed ~4 s later
  (`CONFIRM_MS`, once — `awaitingConfirm()`), not at the next 5-minute sample, so
  a first launch on a phone in Low Power Mode is calm within ~8 s; a low reading
  that agrees with a carried `battery-saver` verdict renews its hold, so an
  always-30 Hz phone never lapses to full-motion springs at 30 fps.
  Calm comes on at once and ends only after 60 s without a battery signal (a
  phone near the threshold must not flap); the switch and the OS are immediate.
  Any `play` has a calm path (an opacity-only fade) or returns null, and calm
  keyframes are stripped of anything that moves, so **no transform keyframe is
  ever created while calm** (`motion.test.js` pins it).
- **What it writes when the verdict changes:** `html.calm-motion`,
  `html[data-jelly-motion]` (`reduce` / `no-preference`, which Jelly's own
  components read) and a window `jelly-motion-change` event (Jelly listens), and
  mirrors the verdict into `localStorage.campScoreboardCalmLast` (the reason,
  or absent) for the pre-paint guard. The switch itself is
  `localStorage.campScoreboardCalmMotion` (`on` / `off`; Auto = key absent).
  Both are device-wide like the theme keys.
- **The joy layer reads `calmMotion()` live** (it used to be a `matchMedia`
  const read once at load, plus three raw reads, all gone; `tests/motion.test.js`
  pins that no `prefers-reduced-motion` is left in app.js / settings.js /
  chat.js / push.js; the TV page, which has no switch, keeps honouring the OS
  setting itself). Tap sparkles, confetti and board cannons are off while calm;
  a save is marked by one soft gold ring (`joyRing`, a transient node in
  `#joy-layer` pulsed by `JellyMotion.ring`) instead of the burst. **The press
  is `JellyMotion.press` / `release`** (a WAAPI dent toward the finger,
  `app.js`'s delegated pointer handlers, same 80 ms delay / 8 px slop / quick-tap
  pop from rest as before; a press called off eases back softly). The old
  `.joy-pressed` / `.joy-pop` classes are gone: a class would be residue
  (`class=""`) in a `setHtmlIfChanged` root. The dent is for plain
  `button, a, summary` only (`JOY_PRESSABLE`): Jelly components keep their own
  canvas press physics, so a plain button/link/summary has NO `:active`
  transform rule in styles.css (it would pop to its scale, then dent from
  identity at 80 ms). A control wider than ~160 px (a full-width list row)
  gets a proportionally gentler dent. **The finger must stay inside the dented
  control**: the dent's depth is clamped by the touch point's distance from the
  top edge (none in the top ~2 px strip), because a control that slides 4 px down
  and squashes leaves the top strip empty and a held tap there clicked whatever
  was behind it (`motion.test.js` maps the touch point through the held
  transform for every point of every size). **A WAAPI transform replaces the
  element's resting CSS transform, it does not compose with it**, so `press` /
  `release` read `getComputedStyle(el).transform` (after cancelling their own
  hold, or they would read the dent back) and write it in front of every dent
  frame (`restingTransform`, `p.base`): a fixed element (the sign-in screen's SDK-down bar is one) is
  centred with `left:50%; transform:translateX(-50%)` and used to jump half their
  width sideways, past the viewport edge, for the whole hold (`motion.test.js`
  gives the fake element a resting transform). The wobble is cut at 900 ms (its
  1.4 s tail was sub-pixel; the ring also keeps `busy()` true). `JellyMotion.busySource` is how the app
  tells the calm sampler what is moving (confetti, joy-layer children, a running
  stopwatch, a clock in its final minute).
- **More → This phone → Calm motion: Auto · On · Off** (plain radio buttons in
  Appearance, under Theme), with one plain-English line under
  it saying what is happening right now (`renderCalmRow` / `calmReasonLine`;
  "Your phone asks for less motion. Change it in your phone's Settings." when the
  OS wins over Off). The line follows `jelly-motion-change`, so it stays true when
  battery saver turns calm on by itself. The note reserves two lines
  (`.gl-panel-note { min-height }`, in the note's own line-height), so a verdict
  that changed length can't move the control under the finger; the longest verdict
  (the OS one, 70 characters) was measured at two lines at 360px and
  `motion.test.js` pins 76 characters as the ceiling. At 130%+ text it wraps to a
  third line and nudges the rows below, accepted.
  The control is `<button role="radio">`s, so a failed Jelly module leaves it
  working with no fallback styling. While the page is hidden the sampler does not
  poll: it returns and `visibilitychange` re-arms it.
- **styles.css answers to ONE class.** Every rule that animates is either under
  `html:not(.calm-motion)` or has an `html.calm-motion <same selector>` rule that
  switches it off; there is no `@media (prefers-reduced-motion)` anywhere (the
  OS setting is already inside `calmMotion()`, and boot-guard adds the class for
  it before first paint). `tests/shell.test.js` lints this over every animation
  rule (tap sparkles, `.joy-p`, are the one exception: `joyBurst()` spawns none
  while calm). The `--jm-*` tokens at the top of styles.css replace every
  hand-written `cubic-bezier`; `--jm-press` and `--jm-arrive` become the sampled
  springs themselves under `@supports (animation-timing-function: linear(0, 1))`
  — the stop lists are pasted (no build step) and `motion.test.js` fails if they
  drift from `JellyMotion.cssLinear()`. A rule keeps its own duration and takes
  only the curve from a token. `jelly-toaster { --jelly-toast-radius: 14px }` is
  set on the element (a `:root` value can't beat the toaster's own `:host`
  declaration). The full §8.10 Jelly token mapping landed with Step 13's
  palette (see `styles.css` above): `[variant="amber"]` takes ink and, in dark,
  `rose`/`mint` take navy (Jelly has one label colour for four fills of
  different lightness), and `jelly-switch` reads ON done-green / OFF an ink-3
  thumb.

## The shell: tabs, takeovers, sheets, history (Step 13 — behaviour wired)

app.js's "THE SHELL" section (`shell`, `SHELL_TABS`, `showTab`, `shellSync`,
`shellReconcile`, `openGame` / `closeGame`, `shellSheetOpen` / `shellSheetClose`,
`shellOpenTarget`, `shellBoot`, `wireShell`) drives the frame below. Rules a
future edit must not break (all pinned by `tests/tabs.test.js`):

- **State is the source of truth, the browser's history is DERIVED from it.**
  `state.ui.tab` (`now|games|chat|more`, device-local, saved with `ui`),
  `state.ui.gameId` (+ `gameFrom`: the tab it was opened from, `gameDow`), `state.ui.revealOpen` (+ `revealFrom`: the director's reveal remote, a second takeover, see "The standings reveal: the screens, behaviour"),
  `state.ui.view === 'settings'` (the classic builder) and `shell.sheets` say
  what is open; `renderAll` → `shellSync()` paints the root (`#app[data-tab]`,
  `aria-current="page"`, `body.takeover-open`) and `shellReconcile()` makes the stack
  match. No click handler pushes history. The stack is always `[Now] + [the tab,
  unless Now] + one entry per open overlay`, so an entry's snapshot
  `{campShell:1, tab, ov:[{k:'game'|'builder'|'sheet', id, from?}]}` is a pure
  function of its top (`shellChain`) and a plan from one snapshot to another is
  too (`shellHistPlan`): leaving Now pushes ONE entry, tab → tab REPLACES it,
  back to Now pops it, a takeover or sheet pushes, one pop plus one push is a
  replace ("Next game" over the game it replaces). Back / Forward / a history
  jump land on a snapshot that `shellApply` paints; our own `history.go(-n)` is
  recognised (`shell.busy`) and its popstate ignored, and the ops queue waits for
  it. Entry URLs are never touched: a `#hash` is only an INPUT (a deep link at
  boot, consumed). A takeover opened cold first tags the base entry Now, then
  pushes, so the label and the gesture agree. Back out of an open game editor
  with unsaved edits asks first (and re-pushes on "no").
- **Dirty render.** `renderShellTabs()` runs `SHELL_ALWAYS` (renderers with
  side effects: `renderStandings` — the change history, point alerts, rank
  baseline, §13.9 — plus pruning and the open schedule), the VISIBLE tab's
  `SHELL_PANELS[tab].render`, and marks the others dirty; a tab renders when
  shown. The 30 s tick (`shellTick`) runs only the visible tab's time-driven
  part. The Competitions / Standings / Cleanup / Verse / Bonus cards still sit
  in Now's markup, so they render with Now until they move into Games and More
  (then move their lines in `SHELL_PANELS`; **a renderer with side effects may
  only leave `SHELL_ALWAYS` once the side effects are lifted out of it**).
- **Scroll memory**: a passive scroll listener records the visible TAB's
  document scroll (`shell.scroll`); a takeover, the builder and the Chat panel
  never write a tab's slot, and a root change restores the incoming tab's scroll
  after it has rendered. Re-tapping the active tab glides to the top (Chat: to
  the newest message). `builderReturnY`, `gameOpener` / `rememberGameOpener` /
  `restoreGameOpener` / `scrollToGameView` and the accordion fold on game open
  are gone: the tab under a takeover never moves.
- **Coming back** (`shellResume`): hidden more than 10 minutes → reopen on Now
  at the top with takeovers closed, unless something is half-typed
  (`shellHasUnsentWork`: a focused score field / dirty builder, a sending or
  typed chat message). A reload restores the tab / game / builder only if
  `state.ui.shellAt` is within 10 minutes (`doReload` stamps it, so the auto-
  update reload keeps your place) and a game only on the same camp day.
- **The game takeover** (`#takeover-game`, §5.5): `renderGameView` writes the
  header text and the labelled back (`shellGameBackLabel`: "Now", "Wednesday
  games", "More", "Chat") only when they differ, and builds the body (double-
  points tag, rules `<details>`, `#clock-area` / `#tools-area` / `#entry-area`)
  once per game — compared as a string so an open "How to play" survives. The
  existing entry renderers are untouched. Open with `openGame(id, {from})`,
  close with `closeGame()`.
- **Sheets** (`.sheet-overlay`, ids `sheet-<name>`): `shellSheetOpen/Close`
  (focus returns to the opener, `#app` goes inert, grab-strip drag closes,
  Escape / ✕ / backdrop / Back close). Motion (§9.5): the sheet is thrown up on
  `arrive` with its overshoot drawn as a stretch from the PLANTED bottom edge
  (never more travel: that lifted it off the bottom of the screen), the scrim
  fades in on `glide`; closing slides it down with `playOut` (220 ms; calm: a
  140 ms fade) and hides it at the end unless it was reopened meanwhile — focus
  and inert are settled at the moment of close, and the overlay takes no taps
  on its way out. A drag lets go from where the finger left it. The game
  takeover does the same to the right (`renderGameView`'s close branch). `schedule` is the older
  `#schedule-overlay`, which keeps its own markup and only reports in. So do the
  three remaining jelly-drawers — **Alerts, Change history, Who can sign in**
  (`SHELL_DRAWERS`: ids `alerts` / `history` / `members`): the shell opens and
  closes the drawer and files the history entry, and the drawer's own ✕ /
  backdrop / Escape report back through its `close` event (`wireMore`), so phone
  Back closes it instead of popping the tab beneath. They wear the shell sheet's
  frame through `jelly-drawer[side="bottom"]::part(sheet|backdrop|close)`
  (flush to the bottom, rounded on top, flat scrim). Moving Alerts into a real
  `.sheet-overlay` would also need push.js's `pushDrawerOpen` and the frame test's
  drawer pin to change. `shellSheetAllowed` says who
  may open which (the directors' drawers, `counselors`, and a hidden Memory verse /
  Meal cleanup refuse everyone else, whatever asked: a deep link, a Forward).
  `shellSheetFill` renders a reading sheet on open and on every `renderAll` while
  it stays open (`renderShellSheets`), whatever tab is under it.
- **Keyboard** (§13.6): `textEntryFocused()` (a tag allowlist; NOT
  `fieldFocused()`, which says no inside `#chat-view`) sets `body.kb-open` on
  focusin and clears it 100 ms after focusout; `visualViewport` sets `--kb-h`.
- **Deep links** (`shellParseTarget` / `shellOpenTarget`, used by `#hash` at
  boot, by a same-page `hashchange` (the new entry is re-planned: tagged Now,
  the rest pushed) and by push.js's `pushHandleOpen`): `now games chat more`, `chat:<ch>`,
  `schedule` (the sheet over Now), `game:<id>` (the takeover), `reveal` and
  `alert:<id>` (Now). **sw.js needed no change**: nothing sends the three new
  targets yet (the Worker emits `chat:<ch>`, `schedule` or none; sw.js's
  validator drops anything else to "", which opens Now — where `reveal` and
  `alert:<id>` land anyway), so `PUSH_SW_VERSION` stays. Step 23's Buzz on a reveal's Start is an
  ordinary director alert (`pushSendAlert`, no `reveal` target, and dark until
  Step 27 sets the Worker's URL); when something does start sending `reveal`, the
  Worker, sw.js's regex and `PUSH_SW_VERSION` change together.

## The shell frame (Step 13 — markup and visual system)

Static markup in index.html, styled in styles.css's THE FRAME section; a
renderer only patches text, `hidden` and a few attributes. **`#app[data-tab]`**
(`now | games | chat | more`; absent reads as Now) is the one switch the CSS
reads: which `[data-tab-panel]` shows (`#tab-now` = today's `main-wrap`,
unchanged; `#tab-games` with `#games-days` / `#games-standings` / `#games-rows`;
`#tab-chat`, a fixed keyboard-riding panel; `#tab-more`), the header's form and
where the tab blob rests. The switcher sets it together with `aria-current="page"` on
the `#tabbar .tab[data-tab]` button. Header `#app-header`: `#hdr-id` (Now: who
you are, the Your team sheet's button; identity/role/camp only), `.hdr-title`
(`[data-title-for]`), `#hdr-who`, `#hdr-pill` (`data-tone` wait | offline |
update | error, text in `#hdr-pill-text`; hides `#hdr-who` while shown),
`#reveal-strip` (never on Now), and `#sync-alert` (the refused-edits / view-only-tab
bar, IN the header under the identity row so it sticks with it). Tab bar `#tabbar`: one `.tab-blob` (CSS rest
position; spring it with JellyMotion, never a CSS transition: `shellSpringBlob`
stretches it `scale(1+s, 1−0.4s)` from its speed, `shellPopIcon` pops the icon
.78→1, `shellArrivePanel` brings the panel up 22px with its overshoot as a ~4%
squash — fill `backwards`, so no transform outlives it — and calm fades the
panel in 120 ms), badges
`#tab-badge-chat`, `#tab-dot-now`, `#tab-dot-more`; it slides away under
`body.takeover-open`, `body.kb-open`, and today's `builder-open`.
Takeovers `.takeover` (`#takeover-game`: `.tk-back[data-takeover-back]` with
`.tk-back-label`, `#takeover-game-title`/`-sub`/`-status`/`-body`/`-dock`;
`.tk-dock[data-kb-hide]`; `.is-roof` = the camp-blue broadcast roof, which
never flips in dark). Sheets `.sheet-overlay` (`#sheet-team`, `[data-sheet-close]`,
`[data-sheet-grab]`; also `#sheet-verse`, `#sheet-cleanup`, `#sheet-counselors`).
More (`#more-director` — `html.view-only` never lays it
out — `#more-camp`, `#more-phone`, `#more-camps`, `#more-fun`, `#more-account`,
`#more-foot`): every row has a `data-more-row` hook AND carries the id the
retired Settings drawer's row had (`#builder-row`, `#history-row`, `#members-row`,
`#alerts-row`, `#signout-btn`, `#theme-toggle`, `#calm-toggle`, `#calm-reason`,
`#camp-switch`, `#account-label`; the Sound switch `#sound-toggle` moved into the
Alerts drawer), so the code and tests that looked them up kept working.
Shared pieces: the line-icon
sprite (`<svg class="ico"><use href="#i-…"/>`; flag marks `#flag-plain|swallow|
stripe|chevron` with `.flag[data-flag]`), chunky `.btn` / `.btn-gold` /
`.btn-big` (the edge compresses while held; a disabled one is a dashed well that
says what's missing), segmented `.seg` / `.seg-btn` whose chosen state IS its
`aria-checked` / `aria-selected` / `aria-current`, and grouped lists `.gl` /
`.gl-row` / `.gl-panel` / `.gl-count` / `.gl-row-split` (a full-row
`.gl-row-hit` button plus a sibling `.gl-link`, never nested buttons). Every
target is 44×44 or more at 360 and 390 px, at 130% and 200% text. Toasts ride
`calc(var(--tabbar-h) + 12px)` up (above a takeover's dock, and above the
composer on the Chat tab); see "What's new banners & auto-reload".

## The frame's pieces (Step 13 — session B: header, pill, More, Games)

All in app.js's "THE FRAME'S PIECES" block. Everything is split by VOLATILITY and
patches in place (`setTextIfChanged`, `setHiddenIfChanged`, `setHtmlIfChanged`),
so a connection flicker never re-creates the shield and a push-state change
never rebuilds a segmented control under a finger.

- **`teamMark` is the one helper for how a team looks** (§8.4):
  `teamMarkSpec(id)` → a **shield** image when the camp ships artwork
  (`CAMP.teamCrest`, junior), else a **flag** (`CAMP.teamFlag`, senior: red /
  blue / green / gold; the SHAPE — plain, swallowtail, stripe, chevron — comes
  from the team's ORDER so two teams stay apart under colour-blindness), else an
  emoji **tile** (its accent goes into `style` only if it is a plain hex).
  `teamMarkHtml(id, {size, label})` is the markup (`.tm`, sized by `--tm`);
  **`paintTeamMark(el, id, opts)` writes through `setHtmlIfChanged`**, so the
  `<img>` of a long-lived spot (header, Your team sheet, More's team row) is
  never re-created by a re-render. Older surfaces (the follow card, boards)
  still draw their own crests; migrate them here, not by copying the rule.
- **Header** (`renderHeader` from `renderAll` and the 30 s tick): `headerModel()` —
  a counselor with a team: the team's mark + name, "Sam · Junior camp ·
  Wednesday"; a director with no team: the camp mark, the CAMP as the headline
  ("Junior camp", sentence case) over "Jenn · Director · Wednesday" (mockup 02:
  a director on both camps must never lose which camp this is); never a number
  (a test pins it) and never a name guessed from the email. The right-hand
  `#hdr-who` is "Sam · Foxes" (the team's short name) on the other tabs, "Jenn ·
  Director" with no team. The row WRAPS: when the identity / title and the
  status pill can't share a line (a long pill, 130–200% text) the pill drops
  under them; the team name gets two lines before it is cut. The header's drawn
  height is measured into `--hdr-live` (a ResizeObserver in `wireShell`), which
  the fixed Chat panel starts under. Tapping `#hdr-id`
  opens the **Your team sheet** (`renderTeamSheet`: counselors, "Up next",
  "Next meal cleanup", and the "Not you? Change" door — only where
  `CAMP.features.electives`; a team set by the account says so instead of
  offering "Change team"). It closes itself before the team / identity picker
  dialog opens.
- **Status pill** (`#hdr-pill`, `syncPillModel` → `renderSyncPill`): appears ONLY
  when something is wrong and takes `#hdr-who`'s place. In priority order: **Can't
  connect · tap** (SDK failed: reload), **Update ready · tap** (`newVersionSeen`:
  reload), **Sync blocked** (rules cancelled a read), **Reconnecting…** for the
  first `PILL_WAIT_MS` (10 s) after the connection drops (`noteConnectionChange`,
  one-shot timer, not the tick) and then **Offline · saved on this phone**. The two
  reload tones ask before throwing away unsent work (`wirePill`); the others only
  say what is happening in a toast. The refused-edits / stranded-work / view-only
  tab bar stays a BAR (`#sync-alert`, now inside the sticky header, in flow): it
  carries Retry / Discard / Download, which a pill cannot, so there is no
  "Couldn't save" pill beside it. **The game takeover covers the header and
  makes `#app` inert**, so the header's bar and pill would be out of reach in the
  one place scores are saved: `#takeover-game-status` (in flow between `.tk-head`
  and `.tk-body`, hidden unless something shows) carries a second copy,
  `#tk-sync-alert` and `#tk-pill`. `updateSyncAlert` writes the same markup into
  both bars (`setHtmlIfChanged`, so a finger mid-tap keeps its button),
  `renderSyncPill` paints both pills from `SYNC_PILLS`, `wireSyncStatus` /
  `wirePill` wire both, and `paintTakeoverStatus` shows the row only while one of
  them is up. Retry / Discard in the bar are full 44px targets
  (`.sync-alert .sync-quarantine-btn`). Toasts need nothing like it: the toaster
  (z 10002) sits above a drawer (10001), so a toast raised from inside Alerts or
  Who can sign in is visible, only inert while the modal is open.
- **More** (`renderMore`, rendered with the tab; `wireMore` / `wireSegs` once):
  Director (editors only: **What counselors see**, **Set up the week** → today's
  classic builder, **Change history**, **Who can sign in**, **Run the reveal**
  (Step 23: the remote, see "The standings reveal"); Tell everyone / Award points
  arrive with Step 24), Camp (**Full schedule**, **Memory verse**, **Meal cleanup** — the last
  two are reading SHEETS holding the day-by-day content and the directors' award
  buttons, `#verse-body` / `#cleanup-body`), This phone (**Alerts**, Appearance,
  Your team), Switch camp (accounts on both camps' lists), Fun, Account, footer
  (`renderMoreFoot`: "v197 · data updated … · N phones have Camp open", which
  replaced the page footer). Theme, Calm motion and Camp are `.seg` radio-groups:
  `paintSeg` sets `aria-checked` + the roving tab stop, `wireSegs` handles click
  and the arrow keys (`setTheme` / `setCalmPref` / `switchCamp`). The **Alerts**
  row's line (`alertsStateLine`, patched by `renderAlertsState` — push.js calls it
  wherever the push state changes) says what really reaches the phone; it opens
  the push drawer, now two sections: "While Camp is open" (pop-ups
  `#notify-toggle`, which is the same `state.notify` as the Now strip's Notify
  me button, and Sound `#sound-toggle`) and "When Camp is closed" (`#alerts-body`,
  push.js). "Not you?" in the Your team row re-asks the counselor on junior and
  offers sign-out on senior (no identity to re-ask).
- **What counselors see** (`#sheet-counselors`): one switch per section on the
  **same `state.meta.hiddenCards` keys** (`HIDEABLE_CARDS` unchanged): Games
  (`competitions`), Memory verse, Meal cleanup, Chat. A switch is **ON when
  counselors can see the section** (the data still says "hidden"), with the
  word "Shown" / "Hidden" beside it (`data-hide-state`). Standings are a locked
  row, "Secret until you reveal them": the old standings switch is retired (the
  key stays seeded true for old builds, `ensureSecrecySeed`). `applyCardVisibility`
  hides the section WHERE IT LIVES — `#games-days` (`data-card="competitions"`,
  with `#games-off` "Games are turned off right now"), More's `#verse-row` /
  `#cleanup-row` (and closes their sheet if open), the standings and Quick
  points sections — and the Chat tab shows chat.js's "Chat is turned off right
  now". **Not built: "Preview as a counselor"** (§7.4): a render override of the
  role is a secrecy risk that wants its own step.
- **The Games tab is the interim home of the old cards** until Step 18:
  `#games-days` holds today's `#day-tabs` (every day's game list),
  `#games-standings` the Current standings table and Quick points (both
  `SECRET_CARDS`: directors only), `#games-rows` is reserved. The home cards no
  longer fold open: **the accordion, `jelly-collapsible` cards, `applyCardDefaults`,
  the 5-minute idle collapse and the `.card-opening` rise are gone**, and the
  shell's own "come back after 10 minutes" rule replaced the idle collapse.
  `renderStandings` stays in `SHELL_ALWAYS` (its side effects are not lifted
  out yet, §13.9).
- **The 44px rule reaches everything that moved into the frame** (Playwright
  audit, 360 and 390 px, 100 / 130 / 200% text via the root font size, both
  themes, both camps, counselor and director: header, tab bar, Games, Chat, More,
  every sheet and drawer, the game takeover). A `jelly-switch` is 44px tall
  (`--jelly-switch-height: var(--target)`; the component's large preset is 40);
  the Jelly chips that moved (`.bonus-team-chip`, `.verse-day-chip`, `.pts-btn`)
  are `height` / `min-width: var(--target)` on the HOST (the component fixes its
  host at 30 / 36px, and an outer rule on the host beats its `:host`);
  "How to play" and the lone text links (`.quick-game-btn`, `#clear-result-btn`,
  Now's follow-card and announcement links until Step 17 retires them) get a
  44px hit box. A takeover whose back label is long ("Wednesday games") lets its
  title wrap onto its own row (`.tk-head` wraps, `.tk-titles { flex: 1 1 13rem }`).
  Not audited: the week builder (settings.js, its own screens) and a game
  mid-play (a live bracket, score entry); the audit opens each game's takeover in
  its saved state.
- **Sparkles only where a press means something** (§9.7): the tap burst fires on
  `JOY_SPARKLE` (jelly-buttons, chips, `.pts-btn`, `.btn-gold`, `[data-joy]`)
  and never inside `JOY_QUIET` (tab bar, header, More, takeover head, the
  drawers, chat, the lock screen). A positive list: a new control is quiet until
  it is named.
- **Home Screen / status bar**: index.html carries `apple-mobile-web-app-capable`,
  `mobile-web-app-capable`, `apple-mobile-web-app-title`, status-bar style
  `default`, and the two pre-paint `theme-color` metas (paper `#f5efe2` light,
  `#0c1030` dark). `applyTheme` → `applyChromeColor` writes the same pair into the
  no-media meta (`CHROME_PAPER`) and switches it to the camp-blue roof
  (`CHROME_ROOF`) while a `.takeover.is-roof` is up (`roofUp()`, rechecked from
  `shellPaint`). manifest.json's `theme_color` / `background_color` are paper too.
  Whether iOS actually paints the status bar under a roof is the owner's iPhone
  check; the layout does not depend on the answer.
- **Sticky really sticks**: body is `overflow-x: clip` (with `hidden` before it
  as the fallback), never `hidden` alone. With html's own `overflow-x` set,
  body's `hidden` made body a scroll container that never scrolls, and the
  app header (and anything else `position: sticky`) scrolled away with the
  page — v197 shipped that way. Don't put `hidden` back on its own.

## The standings reveal: the screens (Step 23 — markup and visual system)

Redesign §4, mockups 05, 05b, 06, 07, 07b, 07c, 09, 11 with the Appendix A
"Mockup deltas" applied (no screens count anywhere — the big screen is public and
can't report in; "Started 7:31", never a name, on phones; the Practice copy; the
chip and the mini TV wear "Practice"). Static markup in index.html (comments there
name every hook), styles in styles.css's THE STANDINGS REVEAL block. Every root ships
`hidden`; **reveal.js is the engine and reveal-ui.js paints these roots** (the next two
sections). Rules for whoever edits them:

- **Switches, not hidden-juggling.** `#takeover-reveal[data-phase]` (`ready |
  intro | live | champion | table | ended | off`) is the ONE thing that picks the
  remote's panel (`#reveal-ready` / `#reveal-live` / `#reveal-off`) and whether
  Back is in the dock; `[data-mode="practice"]` adds the mini TV's tag (the roof
  stays blue: a practice is public too). `#tab-now[data-reveal="live"]` (set
  with `#now-reveal` un-hidden) makes Now the reveal: the notice, the team strip,
  the schedule banner, a live board, the grid and the champion line step aside;
  announcements and the builder stay.
- **One row system** for the remote ladder, the mirror and the grid:
  `.rv-list[data-kind="remote | mirror | grid"] > .rv-row[data-state]`
  (`shown` · `still` · `looking` · `unrevealed` · `hidden` · `next`), plus
  `data-onscreen`, `data-champion` and `data-key` (keyed for JellyMotion). The
  exact markup is the ROW MARKUP comment at `#now-reveal`; a renderer never styles
  a row. Counts are words in nowrap spans, never medal discs. The lists are the
  `setHtmlIfChanged` roots; the peek is `#reveal-ladder[data-peek]` (the LIST's
  attribute, so holding it never makes the memo stale).
- **The mini TV** (`.mtv#reveal-tv`, `data-frame` = `tvFrame().mode`, `data-beat`)
  is drawn in container units (`--u`, one design pixel of 352), so one picture is
  the 352px stage and the 150px thumbnail; always the TV's light colours. The stage
  is the thumbnail on phones under 700px tall AND while nothing is on the big screen
  (ready / ended / off), so the checks and both switches fit above Start; it grows
  when the show starts (spring it with JellyMotion, never a CSS transition).
- **The dock** never uses `disabled` (a tap during the wait must reach the handler
  for the wobble + toast): `aria-disabled` + `#reveal-go[data-state]` (`ready |
  charging | offline | blocked`, `data-face="crown"`) and `#reveal-back[data-state]`
  (`ready | locked | first | offline`). The recharge fill is CSS on `width` (a
  progress bar: it runs under calm too) from `--charge-ms` / `--charge-from` set on
  the button. Locked / first are pressed flat into the well, never faded (the reason
  must read in sunlight).
- **Larger text** is handled by size containers keyed in rem (`rv-list`: points join
  the name's column from ~120%, the place stacks above the team from ~170%;
  `rm-dock`: Back gets its own row above the gold from ~170%). The place columns are
  rem; the marks stay px. The big button's labels have ceilings (past ~40 / 20px
  they only wrap).
- **Other hooks:** `#reveal-strip-count` (the header strip's "3 of 6 shown"),
  `#reveal-row` (More's gold row; `data-state` adds `practice`), `#games-reveal-link`
  (the remote's way in from Games), `#now-reveal-remote` (directors on Now),
  `#now-champion` (the Saturday champion line, name and mark only),
  `#now-reveal-grid` and `#games-reveal-grid` (the frozen grid). New icons:
  `#i-rewind` (Back moves the room's screen: never a chevron) and `#i-crown`.

## The standings reveal: the engine (reveal.js — Step 23, build session 1)

Redesign §4.5, §4.9, §4.10. `reveal.js` is an optional layer (a classic script
right after app.js, before setup-sync.js; every hook in app.js typeof-guarded) and
paints NOTHING except emptying the 8 AM grid roots: reveal-ui.js defines
`revealPaint(why, mode)`, which reveal.js calls after every confirmed
change and every time-driven one. Names are all `reveal…` / `REVEAL_…` (one global
scope with reveal-core.js).

- **The confirmed store.** `confirmedReveal.real` / `.practice` hold the raw
  `{ctl, pub}` the SERVER last said (or null); `revealLoaded` says a server
  snapshot (not the cache) has landed. Every reader goes through reveal-core's
  `revealView` (`revealMirrorView()` for the Now mirror and strip, with the 3 s
  phone lag; `revealRemoteView(mode)` for a remote, no lag; `revealLiveView()` /
  `revealGridView()` split a live reveal from a finished one). A snapshot raised
  while this phone's own command is unacknowledged is the SDK's optimistic echo
  and is NOT taken (`revealInFlight`); the command's completion re-reads the node.
- **Listeners, after approval only.** `initReveal()` is called from `initSync`
  (beside initPush), attaches ONE listener to `<root>/revealPublic/real` for
  everyone and, for a director, one to `…/practice` (attached and detached by
  `revealSyncRole()` from `setMemberRole`'s `revealOnRoleChange`; a counselor
  never receives a practice's bytes). A refusal sets `revealDenied` and fails the
  reveal closed — never `fbRef` or `syncDenied`. The only database paths reveal.js
  names are `revealPublic/…` and `revealFull/…` (`reveal.test.js` scans for it).
- **The cache.** `lsKey('campScoreboardRevealCache')` holds the real `{ctl,pub}`
  for an instant paint and an offline start; never a practice, never an expired
  reveal (an expired grid keeps no numbers on the phone), wiped by
  `clearLocalData` with `lsKey('campScoreboardChampion')`.
- **The clock.** `serverNow()` now starts from `campScoreboardServerOffset`
  (device-wide, not camp data, kept on sign-out), written whenever the
  `.info/serverTimeOffset` estimate moves, so a phone that opens offline at 7:58
  still hides the grid at 8:00 by the SERVER's time. `revealNextBoundary` finds
  the next moment anything changes with no snapshot (the 3 s look-at-the-big-screen
  window, an unended reveal counting as over, 8 AM); one timer is armed for it and
  re-armed after every change; the 30 s tick (`shellTick` → `revealTick`), a wake
  (`visibilitychange` and `pageshow`, registered at load) and a corrected clock
  (`revealOnClockChange`) run the same `revealTick`, so a missed timer costs
  seconds, never correctness. Every consumer also decides "expired" at paint time.
- **8 AM.** `expireReveal()` empties every grid root directly (`#now-reveal-grid`,
  `#games-reveal-grid`) — an inactive tab included, with no render — and drops the
  cache. On directors' phones `retireExpiredReveal()` deletes the expired nodes
  (`revealPublic/<mode>` + `revealFull/<mode>` in one update): editors only (a
  view-only second tab does not), at most once a minute, only while connected and
  past the first pull, only for a child whose own `until` has passed (a practice
  may also be a leftover in phase `ended`; a real reveal that merely ended is kept
  until its `until`), after the opening `once()` re-scan of `revealPublic` (and
  every 5 minutes while visible). The rules decide by server time, so an early
  phone clock is simply refused and retried.
- **The champion line.** From a FINALE reveal whose 1st place is on the phone
  (after the 3 s lag), `revealRememberChampion()` stores `[{id, name}]` only —
  read from the view's `champion`, never a score — in `lsKey('campScoreboardChampion')`;
  `revealChampionLine()` returns it until `campWeek().phase === 'after'` (or 14
  days), after the node and the grid are gone. A practice never writes it.

- **The commands (a director's phone only).** Every write is built by a PURE
  builder (time is an argument: `ServerValue.TIMESTAMP` in production) and sent as
  ONE multi-path `update()` at the camp root (`revealRun` / `revealStart` →
  `revealSend`). Compare-and-set is the rules' job; the builders write exactly what
  they accept: a Start is `revealPublic/<mode> = { ctl, pub: null }` plus
  `revealFull/<mode>` (the complete order, the director's member key, editor-only);
  Next / Back / End are `revealPublic/<mode>/ctl` (the RAW confirmed ctl copied field
  by field, `seq + 1`, `at` now, `sa` now only when `shown` grows) plus, when a place
  is shown, `…/pub/g<k>` (that ONE group). The state machine is `revealPlan`
  (redesign §4.2): intro → live (cur 0…n−1, replays after a Back publish nothing) →
  champion (finale days only: `revealIsFinaleDay`, `finaleDow()` in the SEAM block,
  Friday by default, inside the week when it has a date) → table → ended; Back at
  the first place and at the intro is refused; End is `early` from anywhere but the
  table; a REAL End deletes nothing, a PRACTICE End deletes both its nodes.
  `g0` is the LAST place (the first shown); ties are one group; names are cut to 30
  characters; a place being shown carries the team's name as it is now, the numbers
  stay the frozen ones. `ca` is the director's `serverNow()` at the tap (the rules
  refuse a Start whose `ca` is over a minute old), `until` is `untilFor` (08:00 the
  next camp day across both clock changes; a practice two hours), `epoch` rides the
  ctl when the week has one.
- **After a command settles** the node is re-read with `once()` and THAT becomes
  confirmed (`revealSend`): `revealInFlight` makes the SDK's optimistic echo of our own
  write count for nothing, and `revealBusy()` (any director while a real reveal is
  live, or a command unacknowledged) joins `reloadBlocked()`. A rules refusal re-reads
  and says one sentence ("Another director already showed 4th place." — a place, never
  a team); if the re-read is refused too the rules are not published
  ("The reveal isn't switched on yet…", `revealDenied`, stage `off`, no button that
  leads to a refusal). Nothing is queued: offline refuses at the tap. A Start waits for
  the phone to be caught up (`revealStartGate`: connected, first pull done, nothing
  unsent or being typed) and 10 s after the connection last changed.
- **The button recharges** (`revealCharge`): after a place the big button and Back are
  locked until `at + 4.5 s` (name 0–3 s, score to 4.5 s; the crowning 3 s); a tap sends
  nothing and says "Wait 4 s. The big screen is still showing 5th place."; End never
  locks. `revealRemoteModel()` is what the remote paints from: the stage
  (`#takeover-reveal[data-phase]`), the button's and Back's states and words (mockup
  07c), the count, the recharge, the Practice / Buzz / wake facts, `freezeStale` (scores
  changed since the freeze while still at the intro: "Start again").
- **The private order** (`revealFull`) is fetched with `once()` when the remote opens
  (`revealSetRemoteOpen`) and after each acknowledged command, kept in memory only
  (`revealFullFor`: only for the reveal the server holds), dropped when the remote
  closes or the phone is demoted. No long-lived editor-only listener exists.
- **Buzz** (`revealBuzzState`, `revealBuzzAfterStart`): a REAL Start calls
  `pushSendAlert({ text: 'The standings reveal is starting', audience: 'all' })`
  (push.js: a text argument is a direct send, no composer, no confirm, never throws)
  only when phone alerts are live (`pushConfigured()`, i.e. `PUSH_SERVICE_URL` set at
  Step 27); until then it is disabled with its reason. A practice has no path to it
  (greyed: "Practice runs never buzz phones.") and never writes `real`.
- **The screen stays on.** `wakeLockNeeded()` (app.js) = a timer running OR
  `revealWakeNeeded()` (a director with the remote open, or a real reveal live on a
  director's phone); every place that released the lock on "no timer" asks it, so a
  clock ending cannot drop a reveal's lock. A refused lock reads `wake: 'off'`
  ("Screen may sleep").
- **Proved against the published rules** by `tests/emulator/reveal-client.mjs`
  (opt-in): the shipped reveal.js, through the unit tests' vm and DOM stub, talks to
  the emulator under `database.rules.json` through an adapter from the SDK's modular API
  to the compat shape the app calls; every command of the state machine (both camps), the
  Friday crowning, a practice, two remotes racing, a stale-`ca` Start, a counselor's mirror
  and `retireExpiredReveal` run for real. Mutation-checked: a stale `sa`, a Start written as
  `ctl` alone, a `seq` that does not advance, a place published one early and a member key
  in the public ctl each turn it red. Re-run it after ANY change to a builder in reveal.js.
- **Proved in real browsers** by `tests/emulator/reveal-e2e.cjs` (opt-in; Playwright, the
  database AND auth emulators: `npx firebase emulators:start --only auth,database --project
  camp-89cea`, then `NODE_PATH=$(npm root -g) node reveal-e2e.cjs`): the SHIPPED pages, two director
  phones as remotes and a counselor phone (signed in through the Auth emulator with a fake Google
  credential) and a SIGNED-OUT big screen, against the real `database.rules.json`. The script serves the
  worktree itself and, for the test only, swaps in a `firebase-config.js` that points the SDK at the
  emulators and lets the pages' CSP reach them (`firebase-config.js` is never edited); the SDK files are
  the pinned 10.12.0 builds, checked against the hashes the pages carry. 34 checks: Start, three places
  (the counselor three seconds behind, "Look at the big screen" meanwhile), both remotes pressing at once
  (one place, the loser told), Back, End early (the frozen grid with "Not revealed"), an anonymous
  read of `revealPublic` showing only the places shown, `revealFull` refused to a stranger, a practice that
  plays tagged on the big screen and never reaches the counselor, a real Start taking the big screen over
  from the practice (via the remote's "Start the real reveal", which a remote following a live practice
  offers because it has no other Start to press), the practice returning when the real reveal ends and
  leaving no trace at its End, and the big screen having loaded no Auth SDK and talked to nothing but the
  database. Re-run it after any change to current-standings.js, reveal-core.js or the remote.
- **Paint hook contract** (reveal-ui.js defines `revealPaint(why, mode)`, which the engine
  calls after every confirmed change and time-driven change; `why` is `snapshot`,
  `reread`, `denied`, `role`, `rescan`, `tick`, `timer`, `wake`, `clock`, `connection`,
  `full`), read ONLY `revealMirrorView()` / `revealLiveView()` / `revealGridView()` /
  `revealChampionLine()` for phones and `revealRemoteModel()` for the remote, call
  `revealStart` / `revealNext` / `revealBack` / `revealEnd` (each answers
  `{ ok, code, message? }`; they raise their own toasts unless `{ quiet: true }`),
  `revealSetRemoteOpen(bool)`, `revealSetPractice(bool)`, `revealSetBuzz(bool)`.

## The standings reveal: the screens, behaviour (reveal-ui.js — Step 23, build session 2)

Redesign §4.1, §4.8–4.10. reveal-ui.js paints the design pass's static markup from the
engine's views; every write goes through `setHtmlIfChanged` (or a keyed morph),
`setTextIfChanged`, `setHiddenIfChanged` or `dataset` guarded to differ, so an idle repaint
writes nothing (`reveal-ui.test.js` and `reveal-remote.test.js` count the writes). Names are
`revealUi…` / `renderReveal…`. It runs from `renderAll` (`renderRevealUi`), from the engine's
`revealPaint`, and from one re-armed timer while the remote is open.

- **SECRECY (the one rule).** The phones' screens (Now's mirror, the grids, the strip, the dot,
  the champion line) read the reveal through `revealLiveView()` / `revealGridView()` /
  `revealChampionLine()` ONLY, i.e. reveal-core's `revealView`, which fails closed. No points
  helper, no private freeze, no `confirmedReveal`, no remote model: a source scan pins it, and a
  counselor's phone never builds `revealRemoteModel()`, never opens the remote (`openReveal`
  refuses, `renderAll` puts a forged `state.ui.revealOpen` away) and never has the withheld place
  in any markup or sink. A director's live standings stay in Games; a director sees no frozen
  grid (live standings "as always"), but gets the same mirror plus "Open the remote".
- **Now's mirror** (`renderRevealMirror`): rows from `revealUiMirrorHtml` — one still-to-come row
  per TEAM first (a tie cannot be read off the count), then the places shown best first. While the
  newest place is held back (3 s after `sa`) one still row becomes "Look at the big screen" where the
  place will land and that team is NOT in the markup. Counts are words, each in its own nowrap span,
  never a medal disc; "Your team" is `state.followTeam`'s row (ink outline until Step 25 supplies a
  validated per-theme team colour as `--team`); "Started 7:31", never a name. The list is cleared
  whenever the mirror is not live (a hidden list is no place to keep numbers). The "Happening now" row
  is read from `scheduleForDow` and follows the 30 s tick (`SHELL_PANELS.now.tick`).
- **The frozen grid** (`renderRevealGrids`, Now and Games, counselors only): `revealUiGridHtml`,
  "Not revealed" per team an early End never showed (a count of teams, never of groups), "Tonight's" /
  "Last night's" by camp day (`revealTimeSig` carries the camp day so it flips at midnight with no
  snapshot), "Revealed 7:31 PM · hides at 8 AM". `expireReveal()` empties it at 8 AM.
- **The strip and the dot** (`renderRevealStrip`): on every tab but Now, only while `revealLiveView()`;
  the count is patched alone ("3 of 6 shown", empty at the intro); when it appears or goes the header
  grows by its own height and a scrolled reader is moved by the same amount (measured only at that
  moment). More's row says "Ready" / "Live · 3 of 6 shown" / "Practice on the big screen" / "Not
  switched on yet"; the champion line is name and mark only and never beside the grid or over the live mirror.
- **Rows are stable strings** (`revealUiShownRowHtml` / `Still` / `Looking` / `revealUiLadderModel`): keyed
  `data-key` (`g<place>`, `still-<i>`, `unrev-<i>`, `look`, `h-<i>`), no inline style and no animation
  class beyond the marks' own size variable. A change to a list that is already drawn MORPHS it
  (`revealUiPaintList` → `JellyMotion.flipKeyed`, behind `whenHandsOff` on a counselor's phone); first
  paints, hidden tabs and a hidden page are plain writes.
- **Motion** (§9.5, all `JellyMotion`, calm = fades / a ring, nothing that moves): the look row arrives
  (`arrive`), a landing row unwraps on `wobble` with its shield dropping and its points rolling up, the
  panel unfolds when it appears on a phone that was watching Now, "On the big screen now" slides on `snap`
  from its old row, Your team bursts once (`joyBurst`, calm `joyRing`), the champion crown drops with
  confetti (a canvas that will not draw never costs the paint: try/catch). The ledger (`revealUiNote` /
  `revealUiOnce`, §9.8) records the first sighting and plays nothing: a reload, a late join, a reopened remote
  and an inactive tab replay nothing.

**The remote** (`renderRevealRemote`, `#takeover-reveal`):
- **Shell.** A takeover of its own (`revealRemoteIsOpen()` = `state.ui.revealOpen` and a director whose
  screens loaded: `revealRemoteMayOpen()`), `state.ui.revealFrom` names the tab it came from, one history
  entry `{k:'reveal', from}` (Back pops it, Forward restores it for a director only), `openReveal` /
  `closeReveal`, opened from More's row, Games' link, Now's "Open the remote" and the `reveal` deep link
  (`shellParseTarget` → `{tab:'now', reveal:true}`; a counselor lands on Now). One takeover at a time
  (opening a game, the builder or a deep link closes it); `shellTakeoverOpen()` covers it, so the tab bar
  slides away and `#app` is inert; Escape closes it; the roof is re-derived from the element
  (`revealUiRoofSync`) so the status bar is the camp blue while it is up; a long lock-screen pause never sends
  a director home while a reveal is live (`shellHasUnsentWork`); `shellBoot` restores it only within 10 minutes.
  The engine is told `revealSetRemoteOpen(true/false)` (the private freeze, the wake lock).
- **What it paints** is `revealRemoteModel()` and nothing else (confirmed state, the server clock):
  `data-phase` / `data-mode` / the chip, the mini TV (`revealUiPaintTv`: reveal-core's `tvFrame` into the
  slots, caption in words as a polite live region), the ready panel's checks (only "this phone is up to date"
  gates a Start; an unscored game is a warning with its name), the Practice and Buzz rows, the ladder
  (`revealUiLadderModel`: hidden rows carry a place and nothing else, ONE masked next row, shown rows with
  their team; without the private freeze the hidden rows have no place numbers and there is no peek), "Started by
  Pat at 7:21 PM" from the member list for another director's reveal (`revealFull` keeps the starter's key,
  editor-only), "Scores changed since you started" at the intro.
- **The dock**: `#reveal-go` / `#reveal-back` carry `data-state` and `aria-disabled`, never `disabled` (a tap
  during the wait must reach the handler: the engine's toast says why and the button wobbles once, calm: a
  200 ms dim via `data-refused`). The recharge fill's `--charge-ms` / `--charge-from` are written once per command
  (`revealUi.go.key`, reset on open) so a repaint never restarts the animation; the countdown seconds, the beat
  boundaries and the quiet window after a reconnect re-arm ONE timer (`revealUiNextMoment`); the label swap and the
  ready pop skip the first paint and the countdown's own seconds.
- **The peek** (`revealUiPeek`): hold 350 ms (Enter / Space on a keyboard) and the LIST gets `data-peek` (the row's
  markup never changes, so the hold is not cut off); it ends on release or after 3 s, cannot start during the big
  screen's 8 s beat (the row then says "Masked while the big screen plays") and is put away when a new command lands.
  The next team's name and points ARE in the director's own DOM while masked (CSS masks them); every other
  hidden row has none.
- **Confirms** (`askDialog`): End the reveal / the practice (the sentence names 8 AM, "tomorrow" only when it
  is), Start a new reveal over last night's (a real Start only), "N games have no score yet / Start anyway?",
  never for a practice that replaces nothing and never for Start again.
- **A practice hides the real Start, so it offers it** (`#reveal-offer`, `#reveal-start-real`, found by
  the end-to-end run): `revealRemoteMode()` follows the real reveal while it is active, else a RUNNING practice,
  so a remote showing a practice has no Start button of its own. While a practice plays (`m.practice` and the
  director may command) a gold row at the top of the places panel says "This is a practice." with **Start the
  real reveal**; `revealUiStartReal` runs the ordinary Start flow for a real reveal (it asks "Start a new
  reveal?" when last night's grid would be replaced, and the unscored-games warning). The practice stays in its
  own child, the big screen switches to the real reveal at once, and the remote then follows the real one.

**Tests:** `reveal-ui.test.js` (the phones' screens, secrecy, idle repaint, ids in index.html, loads without
either file) and `reveal-remote.test.js` (the shell, every stage and dock state, tvFrame beats, the ladder, the peek,
checks, confirms, the whole walk, calm), both `.senior` twins, both in `SEEDED_FILES`. A test that writes a reveal
node for the remote must write it to the fake database too (the remote's opening reads would replace a node the
database does not hold) and wait for the listener (`waitUntil`), not `waitQuiet`: a countdown timer on a frozen
test clock re-arms for ever. Browser pass (Playwright against the real code; no screens are mocked): 360 / 390 px,
100 / 130 / 200 % text, light / dark, both camps, counselor / director: every target at least 44x44, every text
line meeting the contrast rule, no sideways scroll, in every state of the remote, the mirror, the grids, the strip,
More, Games and the champion line.

## Set up the week: the frame, the hub, the clipboard (Step 14 — markup and visual system)

P2 §11.0–11.2 ("the director's clipboard") inside redesign §8. Static markup in
index.html (`#setup`, its four sheets, `#ask-dialog`), styled in styles.css's
"SET UP THE WEEK" section; a renderer patches text, `hidden` and the data-*
named here, never rebuilds a row. **The behaviour is wired separately** (the
rest of Step 14, in setup-ui.js: see "Set up the week: behaviour" below); with no
`data-screen` on `#setup` the markup is inert and the builder is v197's.

- **`#setup[data-screen]` is the one switch** (`hub | backups | classic`, and
  Step 15's `week | schedule | rain`, Step 19's `meals | verses | cleanup | electives`; a later
  screen adds its own pair of lines in the CSS). `#setup` wraps `#settings-view`
  inside `#tab-now`, shown only under `body.builder-open` (which hides every
  other child of main-wrap: `:not(#setup)`). **No `data-screen` = the v197
  builder exactly** (only `#settings-view`, with its own back); with one, the
  frame's head shows, the classic builder's `#settings-back-btn` and `h2` step
  aside and `.setup-classic-title` ("Classic editor") titles that screen.
  renderSettings still writes `#settings-view`.
- **The head** (`.setup-head`, sticky, paper, full bleed): `#setup-back` with
  `#setup-back-label` (the tab the builder was opened from — More, or Games from an empty day's "Add games" — on the hub, "Set up the week" on a screen),
  `#setup-undo-dock` (the docked undo; its aria-label is the entry's label),
  `#setup-menu-btn` (→ `#sheet-setup-menu`). Second row (`.setup-status`, one
  left-aligned column): the sync line
  `#setup-sync[data-tone=saved|saving|offline|error|off]` — the CSS-drawn mark,
  then ONE text column `.setup-sync-body` holding `#setup-sync-text` and, inline
  at the end of the words, `#setup-sync-act` "Details" (only for `error`, its hit
  area the whole line), so the mark never wraps away from its sentence — and
  under it who's here `#setup-here` (`#setup-here-faces` takes up to three
  `<i class="setup-face">J</i>`, `#setup-here-text` the sentence, which wraps).
  `#setup-sync-alert` is a mirror of the header's Retry / Discard / Download bar
  (the app header steps aside for the builder). `#setup-undo` is THE undo pill
  (one button, `#setup-undo-label`), out of flow INSIDE `.setup-bar`: it hangs
  under the head at the right for 6 s with a paper halo (no half-letters of the
  headline show round it), then docks; never a toast. **Large text**
  (`#setup.setup-big`, set by setup-ui.js `paintSetupFit` when the frame is under
  18em of its own text across — the same test as the CSS container queries, read
  in JS because it decides how the head itself is pinned): the head goes
  `display: contents` and only the bar is sticky (it is then the pill's
  containing block), so the sync line and who's here scroll away — pinned whole,
  the head was 185 px at 200%. Who's here shows only the faces beside the sync
  line under 18em (a container query on `.setup-status`; the sentence stays the
  button's name).
- **The hub** (`#setup-hub`): the answer is the headline — `#hub-title` is the
  small kicker/name ("Set up the week · Junior camp"), `#hub-headline` the big
  line ("7 of 10 ready"), `#hub-lede` what next — replaced by `#hub-next`
  (`#hub-next-text`, `data-hub-open`), a link-coloured 44px target with a
  chevron, when the next row opens something ("Next: People ›" opens People).
  The week group's `#hub-week-note` says once why only some rows count ("7 can't
  be changed here yet"); a `soon` row shows no mark of its own (its word is
  visually hidden, kept for screen readers). `#hub-door[data-door=running|
  new-year|original]` (hidden when none; `data-quiet` = the original-week door
  with no action behind it yet: its lead alone, one plain ink-2 line, no
  paragraph): `#hub-door-lead`, `#hub-door-text`,
  the owner's gold `#hub-door-btn` (`data-owner-only`) or everyone else's
  `#hub-door-owner` / `#hub-door-owner-text` ("Patrick turns on editing.",
  `data-not-owner`). Rows `[data-hub-row=week|schedule|games|teams|people|
  campers|meals|verses|cleanup|electives|alerts|notice|restore]` each carry
  `[data-hub-summary]`, `[data-hub-problem]` (hidden when none; it spans the
  row's full width), `[data-hub-here]` (another director's initial) and
  `[data-hub-mark][data-mark=ok|warn|todo|skip|info|soon]` + `[data-hub-word]`
  — CSS draws the glyph (check / gold "!" / ring / dash), never an emoji. **A
  row whose screen exists is a `<button>` with a chevron** (games, teams,
  people, notice, restore at Step 14; week and schedule at Step 15, which always
  open their screen — a read-only preview with the owner's Edit the week here
  while the schedule isn't edited here); **one whose screen comes later is a
  `<div>`** (campers → 25, alerts): never a dead button — the step that brings the
  screen turns the div into a button (Step 19 did it for meals, verses, cleanup and electives). Electives starts hidden (junior only). At
  ~130%+ text the mark drops under the summary (a container query on
  `.hub-list`, in em, so it follows the phone's text size) and the chevron stays
  centred on the whole row at its right edge, as on More.
- **Owner-only** (decision Q8): `data-owner-only` elements start `hidden`, and
  CSS also removes them unless `body.setup-owner` — set from `isOwner()` on
  every render, never from anything stored — and removes `data-not-owner`
  sentences for the owner. Belt and braces; the rules refuse the writes anyway.
- **Restore points** (`#setup-backups`): the frame's title pattern — the
  `#backups-title` kicker ("Restore points · Junior Camp"), `#backups-headline`
  the answer (`hubStatus('restore')`'s summary: "Last saved 10 min ago" / "None
  saved yet"), one `#backups-lede` line; `#rp-save-btn` (gold) in a `.setup-dock`
  that sticks to the foot of the screen (the takeover has no tab bar), `#rp-note` /
  `#rp-note-text` (rules refused), `#rp-sec-kept` / `#rp-kept`, `#rp-sec-recent` /
  `#rp-list` / `#rp-recent-note` / `#rp-empty`, `#rp-sec-years` / `#rp-years`,
  `#backup-download-btn`, `#backup-restore-row` (a label for the visually hidden
  `#backup-file-input`), the owner's `#setup-advanced` / `#setup-advanced-body`.
- **Clipboard rows** (`.cb-row` in a `.gl.cb-list`): `.cb-time` (a tabular
  column, `<small>` for the day or date; a past year's point shows the YEAR, its
  date under it), `.cb-main` > `.cb-title` + `.cb-sub` (whole words wrap,
  `break-word`, never `anywhere`), `.cb-end`. A `<button>` when the row opens
  something, a `<div>` when it ends in its own `.btn.btn-sm`. At ~130%+ text
  (a container query on `.cb-list`, 18em) the time and day become one small line
  above the title, and a row ending in a button puts it on that line so the
  title gets the whole width (the fixed column left titles 21 px wide at 200%).
  An empty `.cb-list` is no box. Restore points, recent changes, devices, and
  Step 15's schedule, rain plan, swap and move rows are all these.
- **Sheets** (shell sheets, editors only, ONE at a time — ⋯ → Devices closes
  the menu first): `#sheet-setup-menu` (`[data-setup-act=changes|devices|
  classic]`; the owner group `.setup-owner-sec` with `new-year|undo-new-year|
  original|advanced`, each `data-owner-only hidden`; one that can't be used
  right now gets `aria-disabled="true"` and its reason in `[data-setup-why]`),
  `#sheet-setup-changes` (`#setup-changes-list`, `#setup-changes-empty`),
  `#sheet-setup-devices` (`#setup-devices-lede`, `#setup-devices-list`,
  `#setup-devices-empty`), `#sheet-restore` (`#sheet-restore-title`, `#rp-meta`,
  `#rp-epoch-note`, `.rp-opt[data-rp-section]` > `jelly-checkbox.rp-check
  [data-rp-pick]` + `[data-rp-what]`, `#rp-kept-note`, `#rp-not-offered`, and a
  `.sheet-dock` with `#rp-restore-btn` / `#rp-hold-btn` / `#rp-hold-confirm` /
  `#rp-hold-cancel`). With nobody else here the devices sheet is its one empty
  line (the lede is hidden).
- **askDialog** (`jelly-dialog#ask-dialog.ask`): `#ask-title`, `#ask-body`,
  `#ask-actions` of `.btn` / `.btn.btn-gold` (THE main action) /
  `.btn.btn-danger` (destructive; danger text, never a red fill); a short pair
  shares a row, long labels stack. Every jelly-dialog now has the sheet's flat
  scrim, a hairline edge and a 44px ✕ (the vendor patch above).
- **Hold-to-confirm** (`.btn-hold` > `.btn-hold-label` + `.btn-hold-fill` >
  its own copy of the label, `#rp-hold-fill-label`): the fill is solid
  `--live` with the copy in `--on-live`, ABOVE the label, and the app wipes its
  `clip-path` from `inset(0 100% 0 0)` to `inset(0)` over 1.2 s while held, so
  the button visibly turns red left to right in both themes — not a transform,
  so calm keeps it (it is the only way to see how long is left). A tap or a key
  reveals the two-tap alternative IN the hold button's place: the filled
  `#rp-hold-confirm` (`.btn-danger-fill`, the one filled destructive button, so
  which one commits is never in doubt) and `#rp-hold-cancel` (`.btn-quiet`)
  back to the hold; focus follows. The revealing tap's own click must not land on
  what now fills the spot: the hold button cancels its `touchend` default, and
  "Yes" counts only a press that began on it (or a key / assistive-tech click).
  `rpApply` (and the reveal) also require the restore sheet to still be OPEN: a hold
  still down when Escape / Back dismissed the sheet must not finish and put the scores
  back after the person said no.
- **Keep mine / Use theirs** (§6.3.5): `.clash-list` > `.clash[data-clash-field]`
  > `.clash-q` + `.seg.clash-pick[role=radiogroup]` > two `.seg-btn[role=radio]
  [data-clash-pick=mine|theirs]` with `.clash-who` and `.clash-val` — the full
  markup is in styles.css beside `.clash`. Each side wears a radio ring that
  fills when picked, with a hairline between the halves, and both start on one
  line. Values are words (settings.js `clashShow(v, field, other, side)`): a
  rules clash is its first differing line ("How it works: “Winner takes all.”",
  `clashRulesLine`), a day its name, a format its label, double points On / Off,
  prompts a count, a timer its minutes, the scoreboard its rounds and unit;
  never JSON — the last resort is "Your version" / "Their version". The config engine's set-aside notes
  (configNotesHtml) wear the same look: the gold "!", no emoji, no amber tint.

## Set up the week: behaviour (setup-ui.js — Step 14)

Wires the markup above to the engine (setup-sync.js, "The setup engine"). One classic
script; a renderer patches text, `hidden` and `data-*` on static markup and never
rebuilds a row (an idle `paintHub` writes nothing: `setup-ui.test.js`), and every hook
into it from app.js / settings.js is typeof-guarded.

- **Frame hooks in app.js**: `renderAll` calls `renderSetupUi(inBuilder)` (without the
  file: `renderSettings()` as before); `openBuilder(tab)` calls `setupOnOpen(tab)`;
  `init` calls `wireSetupUi()`; `shellSheetAllowed` / `shellSheetFill` know
  `SETUP_SHEETS`; `updateSyncAlert` hands its bar to `setupUiSyncAlert`; `JOY_QUIET`
  gains `#setup`, the four sheets and `#ask-dialog` (the gold buttons must not sparkle).
- **Screens and Back**: `state.ui.builderScreen` (device-local; `hub` default,
  `backups`, `classic`; anything else reads as the hub) is mirrored into
  `#setup[data-screen]`. More → Set up the week opens the hub; `openBuilder('games')`
  ("Add games") lands on the classic screen on that tab; hub rows Games / Teams /
  Notice open the classic screen on that tab (`state.ui.settingsTab`), Restore points
  opens `backups`, People opens the Who can sign in drawer. Back goes screen → hub →
  closes the builder; a dirty game editor (`builderDirty()`, named by
  `builderDirtyName()`) asks through `askDialog` first, and "Keep editing" puts the
  person back on it. The classic screen still renders through `renderSettings()` and
  keeps its own tab shell. The hub does not push history entries of its own (the
  builder is one entry; the four sheets are shell sheets and do).
- **Counselors reach none of it**: the More row is editor-only, `openBuilder` / `setupGo`
  refuse without `canEdit()`, `renderAll` closes the builder for anyone who isn't an
  editor, the four sheets are allowed only for `canEdit() && builderOpen()`, and no deep
  link names a setup screen (`shellParseTarget`). Nothing the hub shows is a point or a
  place: it counts games and people and names no score.
- **The checklist** (`hubStatus(section, view)`, Appendix B): pure — `hubView()` builds the
  plain `view` from the page and tests hand one in. Marks `ok | warn | todo | skip | info`
  plus `soon` (this step's: the section's screen is still to come, so the row says "Editing
  comes next" and a plain summary — "The original menu" — and claims nothing). Evaluated
  today: **Games** (a game on no day, a day with no games, a tournament with no bracket for
  the camp's team count, "N games still say TBA"), **Teams** (wrong count / bad id →
  "Ask Patrick to repair team slots", an unnamed team), **People** (a team with no counselor
  accounts, an incomplete member record — the owner row is exempt, people with no sign-in
  yet for a week), **Notice board** and **Restore points** (info; denied restore nodes warn).
  Step 19 judges **Meals, Memory verses, Cleanup rota and Electives** (`hubSectionStatus`, from
  `hubSecView()`: see "Meals, verses, cleanup, electives: the screens"); not yet (their data
  arrives with their step): campers, phone alerts, asking-to-join, team colours. `hubModel`:
  "N of M ready" counts only rows that can be judged (`soon` and `skip` are left out), "Next:
  Teams" names the first warning. `HUB_OPENS` is the table of rows that open something
  (a row whose screen exists is a `<button>`, otherwise a `<div>`: `checklist.test.js`
  checks `index.html` against it). **Step 15** gave Camp week and Schedule their screens:
  Camp week is `ok` with its dates or a plain `info` "No dates set yet" (the 2026 week has
  none: never a chore); Schedule is `info` "The original schedule" while it isn't edited
  here ("Showing the original — your edits are kept" once it was turned off again — the
  door then says so too), else Appendix B's problems from `hubScheduleView()` (typical day
  empty, an empty day, broken items, an overlap nobody marked, a Breakfast / Lunch / Supper
  item without the Meal tag) with the summary "Typical day · Mon–Fri · 3 one-offs"; a day
  still on the seeded sample schedule (senior's Sunday and Saturday: `hubStillSample` asks
  the plan, not the `placeholder` flag, which stays for good) is a quiet `note` on the row,
  never a warning (Q11); a schema this build can't read is a warning.
- **The front door** (`hubDoor`): running → new year due → nothing edited here yet, in that
  order. **Owner-only (Q8)**: the owner's gold button and the sentence every other director
  reads ("Patrick turns on editing.", via `ownerName()`) exist only when the door's action
  exists — `HUB_DOOR_ACTIONS.original` is Step 15's Edit the week here (`setupEditTheWeek`),
  `['new-year']` stays `null` until Step 28 puts
  a function there — nobody is offered a button that can only fail, and a door with no
  action is just its lead as one plain line (`data-quiet`; the model's text, "comes in the
  next update", is not shown). The menu's owner rows work the same way
  (`SETUP_OWNER_ACTIONS`: listed only for `isOwner()` AND when the action exists; a row that
  can't be used right now stays, greyed, with its reason in `[data-setup-why]`); a tap is
  re-checked against `isOwner()` and `why()` before it runs. `body.setup-owner` is set from
  `isOwner()` on every render (`applyOwnerClass`).
- **The sync line** (`setupUiSyncLine`): the setup engine's `setupSyncLine()` speaks first
  (its refusals and "rules not published"), then a refused score (`stateQuarantine`), then
  anything unconfirmed ("Saving…"). `Details` (error only; the whole line is its hit area)
  reveals `#setup-sync-alert`, a copy of the header's Retry / Discard bar that
  `updateSyncAlert` keeps current; a view-only or set-aside notice shows at once.
- **Who's here**: `editorsHereHeader()` into `#setup-here` (initials + sentence; on a screen
  another director is also on and it isn't the hub, the line is the short half of
  `editorsHereOn` — "Pat is also editing the games"; the tap-through adds "changes merge
  field by field"); tap → who is where, in an `askDialog`. Hub rows carry the initial
  of a director whose `where` maps to them (`setupHereRow`). Opening the builder starts the
  device's `editorsHere` row (`editorsHereStart`), every screen change moves it
  (`setupMoveHere`), closing the builder stops it (`setupUiClosed`: also the pill and every
  setup sheet).
- **The undo pill**: while the frame is up, `undoRecord` / `undoEntry` call
  `setupUndoOffer(entry)` instead of raising Step 9's toast: `#setup-undo` hangs under the
  head for `UNDO_PILL_MS` (6 s; JellyMotion `arrive` dropping in and squashing on landing,
  §9.5's banner mapping; calm = a fade) — while it is up `.setup[data-pill]` steps the
  screen's intro down by its height, so it never covers the headline — then `setupPillDock` shrinks it into
  `#setup-undo-dock` (`playOut`) and the dock's icon pops (`press`, none under calm). Tap = undo that entry; the dock undoes the
  newest entry (`undoTop`), a 500 ms press on it opens Recent changes, Ctrl/Cmd-Z does the
  same when focus isn't in a text field (and not with a sheet open). One at a time, a new
  one replaces it; an `Undid: …` entry reads **Redo**. A partial undo ("Undid 1 of 2 …") is
  a plain sentence toast with no button; the newest entry is still the `Undid:` one, so the
  dock can put it back. Outside the builder (the ⚡ quick game) the old toast action stays.
- **askDialog** (`askDialog(opts)` → the chosen action's `value`; `askForText(opts)` →
  `{ value, text }`): one at a time (a second waits for the first's exit, because a re-open
  during Jelly's exit would be closed by it), escapes every string, focus on the safe action,
  Escape / ✕ / the backdrop resolve as the `cancel` action. Where `jelly-dialog` never loaded
  it asks with the native `confirm` / `prompt`, so a caller always gets an answer. Copy: a verb
  on every button, never OK / Cancel; a plain cancel is "Not now". `html` (caller-built from
  escaped parts) replaces the paragraphs in the dialog while `body` stays the words the native
  fallback shows; `stack` makes a list of choices; `kind: 'quiet'` a link-like way out. The
  action row is sticky at the dialog's foot, so a long question keeps its buttons in reach.
- **Escape and Back**: while a question is up (`askIsOpen()`) Escape belongs to it and the
  sheet underneath stays (app.js's Escape handler checks); the phone's Back pops the top
  history entry — a sheet, the Who can sign in drawer — before it leaves the builder. Opening
  the builder and every screen change put focus on Back (`setupFocusBack`; a tap leaves
  `:focus-visible` off, so touch shows no ring). The restore sheet is allowed
  only with a point a tap opened (`setupSheetReady`), so a Forward or a stale history entry
  can't raise an empty one.
- **Sheets** (ONE open at a time: `setupSheet` closes the others first): the menu (⋯:
  Recent changes, Director devices, Classic editor, then the owner's rows), Recent changes
  (`undoRecent()`, each row ends in its own Undo or Redo), Director devices (`devicesList()`),
  and the restore sheet.
- **Restore points**: `refreshRestoreIndex()` reads `restoreList()` once (never a listener) when
  the builder opens, on the screen, and after a save, into `setupUi.restore` (`status`: idle |
  loading | ok | denied | offline | nosync — a refused read says the rules aren't published and
  turns Save off). "Save a restore point now" asks for a name (`askForText`, 60 characters,
  default "Saved by Jenn, 3:05 PM") then `restoreSave('manual', name)`; at the 20-by-hand cap it
  offers to delete the oldest one that isn't kept. The restore sheet opens from a row
  (`restoreRead` → `restorePreview`) or from a backup file; sections tick as the preview says
  (Scores never pre-ticked, decision Q23), the dock shows ONE action: **Put these back**, or with
  Scores ticked the hold button naming the camp ("Hold to put back Junior camp's scores") — a
  1.2 s clip-path wipe on `.btn-hold-fill` over pointer events (not a transform, so calm keeps it;
  letting go early drains it; a tap, Enter / Space or a click with no pointer reveals
  `#rp-hold-confirm`, the two-tap alternative, with `#rp-hold-cancel`, in the hold button's
  place — see Hold-to-confirm above). `restoreApply` does the work and its refusal
  reasons are worded in `RP_WHY`. A point's own **Keep this point** (write-once, says "Kept points
  can't be deleted from the app") and **Delete this point** (only where `restoreDeletable`) sit in
  `#rp-manage`. A backup FILE picked on the screen: a v3 file of this camp opens the same sheet
  (you pick what to put back); another camp's asks once to copy its schedule, games and teams
  (`tryImport(text, { copyFromOtherCamp, confirmed, say })`); an older flat file asks once, then
  `tryImport`. `tryImport`'s new `opts.say` takes its complaints (default: the Data tab's) and
  `opts.confirmed` skips its native confirm.

## Camp week, Schedule, the rain plan (Step 15 — markup and visual system)

P2 §11.4–11.6 inside the Step 14 frame, styled in styles.css's "SET UP THE WEEK: Camp
week, Schedule, the rain plan" block. Static markup a renderer patches (text, `hidden`,
aria-checked / aria-selected / aria-pressed, data-*) and lists it fills with clipboard rows;
the full row templates are in index.html's comments beside each list. The CSS switch lines
for `data-screen="week" | "schedule" | "rain"` exist. **The behaviour is built — see "Camp
week, Schedule and the rain plan: behaviour" below** (routing in `SETUP_SCREENS`,
`HUB_OPENS`, `SETUP_SHEETS`, `renderSetupUi`'s dispatch, `setupWhereNow`; the renderers and
every handler in setup-ui.js sections 8–11; the mutators in setup-sync.js sections 8–9).

- **The day strip** `#sched-days` (shown on `schedule` only) lives INSIDE `#setup-head`, so
  it pins with the head (at large text it scrolls away with the sync line). `.daypick`, a
  well that scrolls sideways: `button.daypick-btn[role=tab][data-day=typical|sun…sat]`,
  chosen `aria-selected="true"`, today `data-today` (a link-blue ring), `[data-dot=typical]`
  (a ring: follows the typical day) and `[data-dot=changed]` (a filled dot) under the name,
  `[data-sd-warn]` the gold "!" at the corner; each button's `aria-label` says it all in
  words. Open scrolled so today's chip is at the left edge (its offset within the track);
  on every day change the chosen chip is scrolled whole into view (`stripRevealChip`, the
  "nearest" rule onto a SNAP position — `scroll-padding-inline` keeps a snapped chip clear
  of the fades; an in-between target was snapped back out of view). The scrollbar is hidden,
  so a strip that continues fades out at that edge: `paintStripOverflow` sets
  `[data-overflow=start|end|both]` from the scroll position (on render and on scroll) and
  CSS masks that edge. The chosen chip lands with a `snap` squash (calm: nothing).
  `#sched-days-key` (aria-hidden, the same ring / dot / "!" in words) shows under the strip
  on the typical day's view only. The move picker reuses `.daypick` as a radiogroup
  (`#rain-move-days`, `data-dk`), with the same fade and reveal.
- **Rows**: `.cb-row` with the emoji in its own column — `.cb-title > .sched-emo + span`
  (a grid, so labels start level and a wrapped label never runs under its emoji; the
  `.cb-sub` indents to match). Schedule rows `.sched-row[data-bid]` with
  `[data-diff=only|changed]`, `[data-notime]` ("time hidden" under the time), `[data-warn]`
  (the gold "!" before the sub), `[data-skipped]` (title struck). The sub is the KIND in
  words ("Meal", "Games · 3 games", "Elective 1"; none for a plain activity, none when the
  label already says it) then at most ONE `.sched-tag` — a difference from the typical day
  ("Wed only", "Changed for Wed", "Own version on Fri"), an ink outline; the rain plan's
  `[data-tag=changed|skipped]` is filled ink. Lists are split by part of day,
  `[data-sched-part|data-sched-list=morning|afternoon|evening]` (before 12:00, to 5:00 PM,
  after), because 12-hour run-sheet times need it; an empty part is hidden. A gap ≥ 15 min
  is a `button.sched-gap[data-gap-start][data-gap-end]` row between two rows (dashed).
  A read-only preview renders rows as `<div>`s with no chevron.
- **Headlines** (`.setup-headline`): `font-size: min(1.75rem, 10.5vw)` — the answer grows
  less than body text at large sizes, so the longest day name keeps its words whole at 200%
  on a 360px phone — and `overflow-wrap: break-word` (never `anywhere`: it split
  "Wednesda / y"). Words in setup sentences use ONE time style, `setupRange` ("1:15–2:00
  PM", "9:30 PM–midnight"; setup-sync.js's `setupClock` for a single time) and
  `setupLength` ("1 h 45 min"); the run-sheet rows keep their bare "10:00 –11:45" column.
- **Camp week** `#setup-week`: `#week-title` / `#week-headline` ("Jul 18–24, 2027") /
  `#week-lede`; the read-only door `#week-door` (`-lead`, `-text`, owner `-btn`,
  `-owner` / `-owner-text`) — on Camp week and Schedule the door is SHORT (`.setup-door`):
  one quiet line ("The original week · the days are read-only" / "The original week ·
  read-only"; `-text` stays empty), the owner's compact gold `btn-sm` beside it, the 🔒 line
  under it for everyone else; the full paragraph is the hub's alone. The field rows
  (`.wk-field`) stack the native control under the label below 25em of the list's own text
  (every phone, and large text); Dates `#week-start-row` (a label row)
  `#week-start` (native date), `#week-start-sub`, `#week-start-error`, `#week-wizard`
  (while `newYearDue()`); Days `#week-days` — a TICK SHEET, not seven segmented controls:
  a header row (`.wk-head`, "Typical day | Own schedule") over two 44px tick columns;
  `.wk-day[data-dow]` > `.wk-day-name` (+ `[data-week-date]`, `[data-week-tag]`) and
  `.wk-ticks[role=radiogroup]` > `button.wk-tick[role=radio][data-week-follow=typical|own]`
  (chosen: an ink disc in its ring; `.wk-tick-word` is the accessible name, shown beside
  the ring at large text where the header row steps aside); Double points
  `#week-double-legacy` / `-text` (legacy epoch: the form is hidden), `#week-double-box`,
  `#week-double-on` (jelly-switch + `[data-switch-state]`), `#week-double-form` >
  `#week-double-from` / `#week-double-at` / `#week-double-until`, `#week-double-note`;
  `#week-finale` (TV finale). Selects are native on purpose (the phone's own wheel); a
  read-only preview sets `disabled` / `aria-disabled="true"` on every control.
- **Schedule** `#setup-schedule` (the strip's tabpanel): `#sched-title` / `#sched-headline`
  (the DAY: "Wednesday", "The typical day") / `#sched-lede` ("Today · follows the typical
  day · 2 changes"); `.sched-acts` > `#sched-rain-link` (`#sched-rain-link-text`, "Rain plan
  for today") and `#sched-day-btn` (a 44x44 ⋯ pinned right on the same line, "Day options"
  for the screen reader only → `#sheet-sched-day`), both hidden on the typical day and in a
  preview (the rain link also on a day with nothing on it); `#sched-door` (same parts as the week's); `#sched-day-note`
  / `-text` (where a day differs), `#sched-scope-note` / `-text` (the typical day: "Changes
  Mon–Fri, except days that have their own version of this"); the guided first build
  `#sched-empty` (`-text`, `#sched-add-first`, `#sched-copy-from`, `#sched-copy-archive`) and
  `#sched-copy` (`-text`, `#sched-copy-week`) — `.sched-start` is a wrapping flex row, the
  line on its own row and the actions from one left edge; `#sched-sec-skipped` /
  `#sched-skipped-label` / `#sched-skipped-list` (rows with `[data-sched-bring]` Bring back);
  `#sched-add` / `#sched-add-text`.
- **Sheets** (shell sheets, editors only, one at a time): `#sheet-sched-day` (rows
  `[data-sched-act=rain|own|follow|copy|clear]`, titles in `[data-sched-act-title]`;
  `clear` is a `.gl-row-danger`). `#sheet-sched-item` (`.sheet-tall`, ≤ 90dvh): a SHORT
  fixed title "Edit item" / "New item" (a long name as the title took the screen at large
  text), `#si-where` / `-text` / `#si-reset` (Back to the usual); then, in the order a
  director edits: `.si-name-row` — `#si-emoji-btn` (a 48px tile showing the emoji,
  `#si-emoji-now`; `aria-expanded`, opens the grid inline: `it.emojiOpen`) beside `#si-label`
  (a jelly-input drawn as a field: its fill goes, the host carries the 2px edge) —
  `#si-label-error`, `#si-emoji` (hidden until the tile opens it) > `#si-emoji-grid`
  (`button.si-emo[data-emoji][aria-pressed]`; a pick closes the grid and focus returns to
  the tile) + `#si-emoji-other`, `#si-start` / `#si-end` (native time, step 300; they stack
  at large text) / `#si-end-fld` / `#si-time-error`, `#si-allday`, `#si-showtime`, the
  inline questions (right under the times, below), `#si-type` (`[data-si-type]`, Elective carries `data-feature="electives"`), `#si-meal-fld`
  / `#si-meal`, `#si-slot-fld` / `#si-slot`, `#si-teams-fld` / `#si-teams`
  (`button.si-team[data-team][aria-pressed]`: solid ink edge on, dashed ink-3 off),
  `#si-games-fld` / `#si-games` (rows with `[data-si-move]`) / `#si-add-game`, `#si-alert`
  / `-text`, `#si-remove` / `-text`. The inline questions: `#si-overlap`
  (`[data-si-overlap=after|push|ok]`: `#si-overlap-after` "Start at 8:30 AM instead" when the
  clash is with an item that starts at or before this one — `schedOverlapAfter`, a form
  change only; `#si-overlap-push` only for a clash with a later one), `#si-ownday`
  (`[data-si-ownday=keep|change]`), `#si-rekey` (`[data-si-rekey=same|fresh]`), `#si-nofit`.
  The dock: while the save can't happen yet (no name, bad times, an open question) it is ONE
  dashed well `#si-wait` / `#si-wait-text` that names the step ("Answer the overlap question
  first ↑", "Type what happens, then add"; `schedItemWait`) and, tapped, scrolls to it and
  focuses it — the real buttons step aside (still `aria-disabled`); otherwise `#si-tell`
  (`.sheet-tell`, `#si-tell-check`), the scope
  pair `#si-scope` > `#si-save-day` / `#si-save-all` (texts in `#si-save-day-text` /
  `#si-save-all-text`; the live caption `#si-scope-caption` rides INSIDE the second, so it
  is read as that choice) — two EQUAL plain buttons, stacked — or the single gold `#si-save`.
  An inline question is the gold "!" + a sentence + its answers, never a dialog over the
  sheet. The sheet grid uses `grid-auto-rows: max-content`: a scrolling grid otherwise
  squeezes an `overflow:hidden` group (`.gl`) to nothing. Large text: when the grab, head,
  where-line and dock take more than 45% of the sheet, `schedItemFit` sets `[data-flow]`
  and the WHOLE sheet scrolls as one (at 200% the pinned parts left a 38px window); decided
  per open and only ever switched on while open, so the form never jumps mid-edit.
- **The rain plan** `#setup-rain` (`data-screen="rain"`): `#rain-title` ("Rain plan ·
  Wednesday") / `#rain-headline` (the answer: "Wednesday as planned" → "3 changes to
  Wednesday") / `#rain-lede`; `#rain-note` / `-text` (a restored draft, a colleague's
  change); `#rain-list` — collapsed around now: rows `.rain-row[data-bid]` with
  `[data-when=now|past]` (now: `<small class="rain-now">Now</small>` in the time column, the
  end moves to the sub "Until 9:45"), `[data-staged]` (the filled "Changed" tag + the old
  time struck, `s.rain-was`), skipped rows `<div>`s with `[data-rain-bring]`; a games
  item's games right under it, `button.rain-game[data-gid][data-bid]` (indented to the
  titles, 44px, "Move ›"; staged: the name struck and `.rain-game-to` "To Thursday · Team
  competitions" on a line under it); a folded run `button.rain-fold[data-rain-expand]` ("6
  more until 5:00", the last one until the run's END; a plain hairline row from the time
  column in link ink with a chevron — no fill); the struck `s.rain-was` is whole
  (`nowrap`) and drops under the tag when it doesn't fit; `#rain-more` / `#rain-more-text` (also
  `[data-rain-expand]`); `#rain-add`; the dock's gold `#rain-done` with `#rain-done-count`
  ("3 changes", shown only when something is staged).
- **`#sheet-rain-item[data-pane=actions|swap|how|time|games|move]`** — ONE sheet with
  panes, never a stack: `#rain-pane-back` / `#rain-pane-back-label` ("‹ Team
  competitions", hidden on actions and on a move opened straight from the list; it takes
  the spare room — `margin-right: auto` — so the ✕ stays at the right edge when the title
  steps aside),
  `#rain-item-title` (no emoji: §8.6), `#rain-item-when`. actions: `[data-rain-act=swap|
  time|earlier|later|games|skip|reset]` (`earlier` / `later` are one `.rain-pair` row of
  two halves with `[data-rain-pair-sub]`; a missing neighbour is `aria-disabled`),
  `#rain-games-sub`, `#rain-skip-sub`, `#rain-reset-sub`. swap: `#rain-swap-earlier` above
  `#rain-swap-list` (`.cb-row.rain-pick[data-bid]`, the length in the sub; this item is
  `[data-self]` "This one"; the body opens scrolled so "This one" is at its top). how: two
  `button.rain-opt[data-rain-how=slots|lengths]` that SHOW THEIR RESULTS
  (`[data-rain-how-lines]` > `.rain-opt-line`, `[data-rain-how-foot]` with
  `.rain-opt-warn` per overlap); slots is the gold `.rain-opt-main`; one tap stages it.
  time: `#rain-start` / `#rain-end` / `#rain-end-fld` / `#rain-time-error`, `#rain-allday`,
  `#rain-ripple`, `#rain-time-warn`, and the dock `#rain-item-dock` > `#rain-time-use`.
  games: `#rain-games-list` (`button.cb-row.rain-game-pick[data-rain-move]`: the whole row
  the button, ending in "Move ›", the list's game-row look). move: `#rain-move-days`,
  `#rain-move-list` (that day's Games items first), `#rain-move-all` / `-text` ("Other items
  on Thursday"), `#rain-move-none`,
  `#rain-move-double` / `-text` (`[data-rain-double=yes|no]`).
- **`#sheet-rain-done`**: `#rain-sum-title`, `#rain-clashes` (the game editor's `.clash`
  Keep his / Use yours), `#rain-sum-list` (`li.rain-sum-li`), the verdict that is ALWAYS
  said `#rain-verdict[data-tone=ok|warn]` > `#rain-verdict-lines` (`.rain-verdict-line`),
  `#rain-tell` (`.sheet-tell`, `#rain-tell-check`), `#rain-offline`; the dock `#rain-commit`
  (gold; with an unpicked clash the dashed `aria-disabled` "Pick one for Lunch first"),
  `#rain-keep`, `#rain-discard` (`.btn-quiet-danger`).
- **The way in from the home schedule sheet**: `#schedule-plan` docked under
  `#schedule-body` (editors only): `#schedule-plan-btn` / `#schedule-plan-text` ("Change
  today's plan"; another day's name when it isn't today) when the schedule is edited here,
  else `#schedule-plan-note` with `#schedule-plan-hub` (opens Set up the week; ux-R18). A
  plan opened this way remembers it (`setupRain.cameFrom = 'now'`, in memory only): Back is
  labelled "Now", and Back and Done (`rainBackHome`) leave the builder for Now with the
  schedule sheet open again instead of landing on the Schedule screen.
- **M2 by design (≤ 12 taps):** Change today's plan · Team competitions · Swap with… ·
  Elective 1 · Swap their time slots · Axe Throwing (straight from the list: no Games…
  step) · Thu · Team competitions · Done · Done = 10. The panel opens collapsed around now
  with every games item and its games in view, the swap list opens on "This one" with
  Elective 1 six rows down, and Thursday's move list shows its Games items first.
- **Motion** (JellyMotion, calm-aware): a staged row re-sorts by key (`glide`, only once
  hands are off the list) and so does a Schedule list when an edit re-sorts it on the same
  day (`schedPaintList`: its own memo; a day switch is a plain replace), its "Changed" tag
  pops (`press`), a pane change arrives from the side it came from (forward from the right,
  Back from the left; `arrive` with the overshoot spent as a landing squash; calm: a fade),
  the emoji grid arrives under its tile, the chosen day chip lands with `snap`, the fold
  opening unfolds (`arrive` + `glide`), and the sheets are the shell's. One CSS transition:
  the screen's intro steps down to make room for the undo pill (`.setup[data-pill]`, on the
  `--jm-arrive` tokens; none under calm).

## Camp week, Schedule and the rain plan: behaviour (Step 15)

The markup and visual system are above; this is what runs. Engine in setup-sync.js sections
8–9 (pure over a draft tree; `commitSetup` is still the one write path), screens in
setup-ui.js sections 8–11. No new file, so no new `?v=` entry.

- **Routing.** `HUB_OPENS` has `week` and `schedule`; `SETUP_SCREENS` adds `week | schedule |
  rain`; `SETUP_SHEETS` adds `sched-day`, `sched-item`, `rain-item`, `rain-done` (each opens
  only with something a tap opened: `setupSheetReady`). `setupWhereNow` tells editorsHere
  `week`, `schedule:<day|typical>` or `rain:<day>`. `state.ui.setupDay` (`typical | sun…sat`,
  device-local; with none, today during the camp week else typical) and `state.ui.rainDay`.
  `setupScreen()` returns `schedule` for a stored `rain` when the schedule isn't edited here
  (a reload after Use the original week again). Back from the rain plan goes to that day's
  Schedule and asks first when anything is staged (`rainLeave`: Keep planning / Leave it for
  later / Discard).
- **Camp week** (`renderWeekScreen`). Dates: a native date, only a Sunday (`isValidWeekStart`),
  one undoable commit to `meta/weekStart` (always editable: `week` is a section that is
  always on). Days: a tick sheet, the same two operations as the Schedule's day menu
  (`schedGiveOwn`, `schedMakeFollowAgain`); read-only (`aria-disabled`) while the schedule is
  the original. Double points: **in the legacy epoch (no `state.meta.epoch`) the form is
  hidden and the fixed window is read out**; with an epoch it writes `meta/double`. TV
  finale: `meta/finaleDow`. Nothing reads `double` yet (Step 28); `finaleDow()` (SEAM block, absent or junk = Friday) is read by the standings reveal's Start (Step 23).
- **The Schedule screen** (`renderScheduleScreen`): the day strip (ring = follows the typical
  day, dot = has changes, gold "!" = `schedDayIssues`; opens with today's chip at the left
  edge during the camp week, and keeps the chosen chip in view), rows by part of the day
  built as strings and painted by `schedPaintList` (rows keyed `data-key="r-<bid>"`, gaps
  `gap-<start>`), gap rows (`schedGaps`, ≥ 15 min), skipped items with Bring back. While
  the schedule is the original every row is a `<div>` (`schedViewTree()` = the seeded
  built-in tree) and the screen shows the owner's door. The **item sheet** keeps its form in
  `setupSched.item`; `schedItemModel()` derives everything that isn't a plain field. Its
  questions are inline, each answered before the save it guards and **keyed to the question
  it was answered for** (a keystroke elsewhere never re-asks): an overlap (`Start at 8:30 AM
  instead` when it is with an item that starts at or before this one — moves the form's
  start past it, same length; `Push later items back N min` runs `schedRipple`, offered only
  for a later item; `That's on purpose` sets `overlapOk`), a day with its own
  value for a changed field (`Keep Wednesday's` / `Change Wednesday too`), a renamed item
  (`Yes, same` keeps `alertKey`; `No, start fresh` mints one — a patch can't carry it, so it is
  written to the record). Two equal scope buttons for an item that comes from the typical day:
  **Just Tue** writes `patches/tue/<bid>/<field>` for what differs (a field set back to the
  typical value drops out — "Back to the usual"); **Every day like Tue** writes
  `typical/<bid>/<field>` and removes the seen day's patch on exactly the fields that changed
  (never one the sheet left alone). A change a patch can't carry (removing a meal, an elective
  slot or the teams) refuses Just Tue in words. Remove asks skip-just-this-day / remove-from-
  every-day / delete a one-off, and re-homes the games with `setupCombined` (**ONE undo entry
  for the setup and the games**). Closing an edited sheet by ANY route asks first — ✕, the
  scrim, Escape (app.js's Escape handler) and the phone's Back (`shellApply`: the sheet stays
  up and the stack entry goes back) all go through `schedItemGuardClose()`; Discard closes it,
  Keep editing leaves it. While such a sheet is open, `schedItemBusy()` holds the deploy
  auto-reload (`reloadBlocked`), as `rainBusy()` does for a rain plan. A block made by hand
  gets `b-` + 8 random base36 (`setupMintNewId`: an added item, a rain-plan one-off, the items
  of a copied day) — never the seed's slug id (`setupMintId`, seed only), which two directors
  adding the same name at once would mint twice and which a collision suffix could push past
  the 40 characters `pushSchedule` allows once published as `<dk>-<id>`. "Tell people who
  follow this" is not built (the alert sender is Step 26).
- **Day operations** are shared by Camp week and Schedule: give a day its own schedule (same
  ids, `typical:false`, patches gone, one commit), follow again / clear (confirm, a
  `pre-delete` restore point first — a device with no sync has nowhere to keep one and goes
  on, any other refusal stops it — and the games on removed items listed as not on the
  schedule). Copy to Mon–Fri turns on the Mon–Fri days with nothing of their own. "Start from
  last year's Sunday" is not built (no archive yet).
- **The rain plan** (`rainOpen` → the `rain` screen). A plan is `{dk, epoch, at, items:
  {path: {base, staged, g?}}, games: {gid: {base, staged}}}`: every staged field keeps the
  value it had when first staged (`rainStage`: a field put back to its base leaves the plan;
  `g` ties the fields one action staged, so Put it back on one half of a swap puts the other
  back). It is saved to `lsKey('campSetupRainDraft')` on every stage (wiped on sign-out), comes
  back after a reload, is dropped on another day or camp year, and an old one (> 12 h) asks.
  `rainBusy()` (in `reloadBlocked`) holds an auto-reload only while a plan with changes is
  open and was touched in the last 2 minutes. The list opens collapsed around now (now, the
  next three, every games item with its games, every staged item; runs fold; `rain-fold` and
  `Show the whole day`). One item sheet with panes (`data-pane`): actions, swap (opens scrolled
  to "This one"), how (two lengths differ: **Swap their time slots** or **Keep their lengths**,
  each showing its result and the overlaps it opens before choosing), time (new start/end,
  until the end of the day, ripple that never ends past midnight), games, move (a game to any
  item on any day with a competition day; its `dayId` follows the item's weekday, `session`
  the item's time, `ord` after what it holds; onto double-points games asks first). **Done**
  (`rainOpenDone`): clashes first — every staged base against the tree NOW (`Use yours` /
  `Keep theirs`; Done waits for each), the lines, the verdict that is ALWAYS said (overlaps and
  new 45-minute gaps, or "Nothing overlaps."), then `rainCommit`: `restoreAutoForEdit` (inside
  `commitSetup`) + ONE setup commit + ONE config change + ONE undo entry "Rain plan for
  Wednesday" (`setupCombined`). Offline it says so in words. "Add something for today" is the
  item sheet in staging mode (`it.stage`): a whole one-off record staged under
  `dayBlocks/<dk>/<id>`. The "Tell people" choice is kept as an intent in
  `lsKey('campSetupAlertIntent')` only when phone alerts are live (nothing sends it until
  Step 26). Motion: `JellyMotion.flipKeyed` glides survivors when a staged row re-sorts (not
  under a thumb: `whenHandsOff`), the Changed tag pops (`press`), panes arrive from the side;
  calm is a plain replace / fade.
- **The home schedule sheet's way in** (`renderSchedulePlan`, called from `renderSchedule`):
  editors see **Change today's plan** (another day's name when it isn't today) when the
  schedule is edited here, else one line pointing at Set up the week — never a button that
  leads to a refusal; counselors see none of it.
- **Calendar and phones.** With the schedule edited here the per-day `.ics` uses the block id
  in its UID (moving or renaming an item updates the event in place; the position and start it
  used would change with the edit). The publisher already republishes after a setup commit.
- **Gates.** M2 (junior Wednesday, seeded context, real taps at 360×640):
  `docs/build-notes/verify/step15-m2.cjs` — **10 taps**, every target already in view, over the
  gate of 12 never. The wider pass (every screen and sheet, both camps, editor and owner, 360 /
  390, light / dark, 100 / 130 / 200 % text: no target under 44×44, no sideways scroll):
  `docs/build-notes/verify/step15-pass.cjs`. Both serve the worktree (`python3 -m http.server`),
  block Firebase and stand in for the first snapshots (`setupReady = configReady = true`).

## Tests

`node tests/run.js` (optionally with a filename filter: `node tests/run.js
sync`). Zero dependencies, no network. The whole suite takes about 50 seconds of wall
time but only about 25 of CPU: the rest is the engine tests waiting out the app's real
debounces (the state / config push is 400 ms; the setup push is shortened to 40 ms through
`setupPushMs`), so `restore`, `config-sync`, `seed` and `setup-sync` are 2–4 s per camp and
everything else well under 1 s. A filter runs one file (and its seeded / senior twins). **Run it before every
commit**, alongside `node --check`.

**Waiting in a test — wait for the app, never for the clock** (the intermittent "1 failed,
2955 passed" seen once on main was this class of test). A fixed `await sleep(40)` is a bet
that a chain of debounce timers and database acknowledgements finishes inside 40 ms; it wins
on an idle laptop and loses whenever the process stalls (a GC pause, a cold container, three
suites at once), because the sleep's own timer comes due before the next link of the chain
has even been scheduled. So:
- **`waitQuiet()`** (a global in every test file, from `tests/harness.js`) resolves once every
  short app timer (asked for 1 s or less: a debounce, a retry, a floor) has fired AND every
  acknowledgement `fake-rtdb.js` still owes has been delivered (`inflight()`), with nothing new
  started for two hops. It is "the push went out, was acknowledged and everything that set off
  has settled". Use it where a test used to sleep for a flush. It ignores a timer longer than 1 s
  (the calm-motion sampler's 2 s, a toast), and a write queued by an OFFLINE fake database (that
  one waits for `goOnline()`, it is not in flight). It looks at the file's own context only.
- **A "nothing happened" assertion rests on `waitQuiet()`'s horizon.** `waitQuiet()` returns after two quiet
  2 ms hops, where the old fixed sleep (150 ms, 560 ms in `editors-here`) was long enough to let a stray timer
  fire. It still sees every app timer of 1 s or less and every acknowledgement `fake-rtdb.js` owes, so "no write was
  made" holds against any debounce, retry or ack chain; it does NOT see a write started by a timer longer than 1 s, or by
  anything other than the app's `setTimeout` / the fake database. Where a test must rule out a long timer, wait for
  that timer's own delay (the code's constant) or assert on the delay the code asked for; a runaway retry loop
  now shows as `waitQuiet`'s 20 s deadline error, not as one extra write.
- **`waitUntil(cond, 'what we wait for', ms?)`** polls every 2 ms, resolves as soon as `cond()` is
  truthy and throws at a 20 s deadline naming the condition. Use it for a specific state
  (`waitUntil(() => remoteReady && configReady && setupReady, …)`, `waitUntil(() => ehTimer, 'the
  refused write to leave a retry pending')`) — especially when `waitQuiet()` would wait out a timer
  the test means to catch pending. Never a bounded `for` loop that falls through silently at the
  end: that is a sleep with extra steps (`rsSettle` / `a1Settle` / `settled` were).
- **Still fine** (all deterministic): a `ssWait(5)`–`(10)` for the ONE hop of an acknowledgement
  (the ack timer was armed before the sleep's, so timers fire it first, whatever stalled); a test
  timer armed AFTER and longer than the app timer it waits out (`closeSchedule`'s 200 ms against
  `sleep(260)`: timers fire in expiry order); an elapsed-time wait that only needs "at least this
  long" (a stall can only lengthen it).
- **Never** let a test depend on two things happening within N ms of each other. A floor or window
  that the test must stay INSIDE is stamped in the same synchronous block as the actions
  (`ehLastWriteAt = Date.now()` beside the three `editorsHereMove`s, with a 150 ms floor), and a
  "this must not take longer than…" check asserts on the delay the code ASKED for (the chat
  send's `setTimeout`), not on a stopwatch.
- **A timer a case leaves pending is the next case's problem.** The app's own debounce
  (`pushTimer`, `pushConfigTimer`) keeps running after a test resets the variable to `null`, and
  fires `pushState()` into whatever database the NEXT test has attached — a first-pull test then
  finds its offline work already sent and nothing to strand. A reset is `clearTimeout(pushTimer);
  pushTimer = null`, in `boot()` and in `teardown()`, never the assignment alone.
- **`tests/stall.js`** is the hunter: `node -r ./tests/stall.js tests/run.js <filter>` makes
  timer callbacks stall at random (`STALL_SEED`, `STALL_P` = 0.15, `STALL_MS` = 100; same seed,
  same stalls). A test that fails under it and passes without is waiting on the clock. Sweep a
  few seeds after touching any async test (`for s in 1 2 3 4 5; do STALL_SEED=$s node -r
  ./tests/stall.js tests/run.js; done`), and loop a file you changed under CPU contention too.

`tests/harness.js` loads the real `defaults.js` + `app.js` + `settings.js` into
a Node `vm` context behind a small DOM stub, so the tests exercise the exact
code the site ships — there's no build step and no second copy of the logic to
drift. Each `*.test.js` file gets its own freshly-loaded context, so one file's
mutations of `state` can't leak into another's. Because top-level `let`/`const`
in a vm script land in the context's global lexical scope, test files reference
`state`, `medalCounts`, `SYNC_KEYS`, … directly, exactly as app.js does.
`document.addEventListener` calls made at load are recorded (never fired by
the harness itself) in `__docListeners[type]`, so a test can reach the
delegated handlers — the joy-press pointer handlers, the failed-module
tap-to-close — by event type.

Nothing in `tests/` is referenced by `index.html`, so adding to it cannot
change what a browser loads. Timers a context starts (the app's toast and
reveal timers, the `requestAnimationFrame` shim) are tracked, and `run.js`
calls `clearAllTimers()` after each file, so a leftover chain can't keep Node
alive: the run exits as soon as the cases finish (no stray timer holds it open).

What's covered, and why each file exists:
- `scoring.test.js` — score parse/format edges, `esc()`, `medalCounts()`
  (including double points and orphaned results), bonus buckets, tie-breaks.
- `reveal-ui.test.js` / `reveal-remote.test.js` (+ `.senior` twins) — the reveal's screens: see "The standings
  reveal: the screens, behaviour" (secrecy, the 3 s lag, idle repaint writes nothing, the remote's shell, dock states,
  ladder, peek, confirms)
- `reveal.test.js` (+ `.senior`, which evals it) — reveal.js's read side and 8 AM rule
  against `fake-rtdb.js`: what each role listens to (a counselor: `revealPublic/real`
  only, never a practice, even by re-scan), the cache, a refused listener failing closed
  without touching `syncDenied`, an other-year or too-new reveal, the phone lag keyed to
  `sa` (Back, the table, End and a reload never re-hide a row), auto-end, the next-moment
  finder, **a fake clock across 07:59:59 → 08:00:01 on the active tab, an inactive tab and
  after a wake from sleep**, `retireExpiredReveal` (editors only, never before `until`,
  once a minute, practice vs real), the champion line (a name, never a number, survives the
  node), the sign-out wipe and the remembered server-clock offset; and the COMMANDS against
  a JS model of database.rules.json's reveal clauses (`rulesModel`: ctl compare-and-set,
  Start-without-pub, groups only after their place is shown, shapes, delete-after-until,
  `revealFull.r` = the ctl id, `startedBy` = the writer): the freeze (ties, 30-character
  names), the whole walk, Back, the replay, the crown, early / done End, the race against
  another director, rules not published, the optimistic echo not being confirmed, the
  recharge lock, **practice isolation** (only its own nodes, never `pushSendAlert`, End
  deletes both), Buzz, `revealBusy` in `reloadBlocked`, the wake lock, the Start gate,
  the model's words for every state of mockup 07c, **the public-node sweep** (no member
  key, no director name, no hidden team's id, name or points in any serialized write of
  a full reveal, a Back, an early End and a practice), DST `until`, the epoch
- `tv.test.js` / `stalling.test.js` — the big-screen page for both camps (public and
  read-only since Step 23: the paths it may touch, no write, no `firebase.auth`, the
  frames and their beats on a fake clock, Waiting, late join, real beats practice, a
  refused feed, hidden-for-a-minute, the CSP and the stamp in both places), and the
  link into it (see "The TV page").
- `camp-core.test.js` — `camp-core.js`: the legacy double-window pin (the
  constants, and the seeded relative window resolving to them to the
  millisecond), DST edges, parity with the alert sender's copy of the maths,
  and every sanitizer's refusals (markup emoji, a quote-breakout data URL,
  `javascript:` / external crest URLs).
- `sync.test.js` — **every invariant in the section below**, plus the deferred-
  snapshot and per-path-diff behavior. A failure here is a regression, not a
  test bug.
- `sync-epoch.test.js` (+ `.senior`, which evals the same file) — "A new camp
  year strands a phone's unsent work" below, against `fake-rtdb.js` with the
  wizard's commit written straight into the database: no epoch (and the same
  epoch) on both sides is the ordinary merge and writes nothing to the stranded
  store; a different epoch (later, and back to legacy) strands every path kind —
  scores, a team rename, a deletion — with zero database writes and the server's
  tree adopted as the new confirmed base; the toast count; only the activity
  stamp outstanding; an EMPTY node keeping the console-wipe rule; this year's
  value for the same game id standing; a parked refusal cleared; reload read-back,
  dedupe, the ten-entry cap, a blocked or full store, the per-camp key and
  `clearLocalData`; the bar (count, buttons, calm look, priority behind a red
  refusal and the view-only tab, a counselor's phone), Download's JSON, Dismiss
  asking first, the sign-out question, and a source pin that stranding never
  touches the network. (Its strand cases fail with the epoch branch removed.)
- `teams-sync.test.js` (+ `.senior`, 4 teams) — "Team names and counselors sync
  per field" below, against `fake-rtdb.js` with a second device writing straight
  into the database: the diff matrix (one path per field, `''` and `null`, whole
  on a reorder / resize / missing roster / id-less record), two directors'
  different-team and name-vs-counselor edits both surviving, the acknowledged
  push advancing the confirmed baseline per field, an old build's whole write
  still adopted, the half-built-roster guard (editor writes back whole, viewer
  doesn't), an offline rename merged through the real first snapshot (different
  team, different field, same field, a server-side reorder), and a refused team
  field parked as "Team names" and discarded. `sync.test.js`'s "teams are
  written whole" case was changed on purpose by S2b.
- `tablock.test.js` (+ `.senior`) — "Two tabs of one camp: one writer" above, one
  fresh copy of the app per tab (`makeContext`) over a stubbed `navigator.locks`
  with the real ifAvailable / steal / hold-until-unload semantics and a fake
  clock: no API fails open, viewers never lock, the lock name is per camp, the
  load-time migrate / a save / a first-snapshot adopt write nothing while
  undecided (and are made once the answer is yes), a held push goes out (state
  AND week config, and a held flag alone keeps a snapshot from being adopted), the
  250 ms × 1.5 s retry window then view-only, the reload-ordering case (the old
  page holds the lock 800 ms), a throwing or rejecting API failing open, a
  request that never answers failing open after 4 s, a viewer flip releasing the
  lock, a confirmed role not restarting the election, a view-only director still
  seeing standings (and opening a hidden Chat card) but writing nothing, the bar,
  the steal (old tab stops persisting before it flushes — pinned by what
  `pushState` sees of `tabWriter` — an ack after demotion leaves the cache alone,
  the claimant reloads, offline it does not steal, the next page is the writer),
  Retry / Discard absent from a read-only tab, `html.standings-shown`, the
  BroadcastChannel fallback, and the one-`setItem` source scan.
- `sync-quarantine.test.js` (+ `.senior`, which evals the same file against
  `seniorScoreboard/state`) — "Refused writes" below, driven against
  `fake-rtdb.js` through the app's real `fbRef`: a refused path parked while the
  rest of its batch lands, the sync-F15 ordering (a mid-bisect push is held, a
  changed path is skipped), >50 paths halved, a network error left on the
  original path, Retry / Discard, the adopt that must not wipe a parked score,
  a RELOAD while parked run through the real first-snapshot merge (re-sent and
  re-parked, saved once accepted, dropped when the server moved past it), the
  server winning over a parked path, the one automatic retry, the top bar, a
  view-only device never quarantining, the sync line.
  `boot-cache.test.js` pins that `_quarantine` loads at boot.
- `clock.test.js` — the synced countdown, including clock-skew between devices.
- `week.test.js` — structural checks on the hand-edited data: `DAY_SCHEDULE`
  block ordering/durations, `nowBannerHtml` fuzzed over every minute of every
  day, `defaultConfig()` integrity (unique game ids, real dayIds/sessions/
  formats), the meal-cleanup rota's team ids, announcement expiry, `.ics`
  export, and the notice board (draft stays invisible, posting is editor-only,
  every shape RTDB can prune is healed).
- `backup.test.js` — restore-from-backup, including that an imported tree gets
  normalized and orphan-pruned before it can render or sync.
- `render-stability.test.js` — re-renders that change nothing don't touch the
  DOM. `renderAll` runs on every remote snapshot and the 30 s tick, and a
  re-created Jelly component repaints/animates from scratch (the "Happening
  now" progress bar refilled from empty twice a minute; the team shield
  blinked; chips twitched). Home panels write through `setHtmlIfChanged`,
  the day tabs refresh their panels in place, and the progress bar is nudged
  rather than rebuilt (the rain hint is patched in place — `splitNowBanner`
  keeps it out of the bar's shape check). The frame's volatile lines are pinned
  by BEHAVIOUR (write counters on the stub: a pill flip writes the pill and not
  the shield or the identity text; `renderMore` with changed alerts / presence
  writes no segmented-control attribute), and a Playwright MutationObserver pass
  over both camps, both roles and all four tabs sees zero DOM mutations from two
  idle `renderAll`s: every visibility toggle in the render path goes through
  `setHiddenIfChanged` / `setTextIfChanged` / `setClassNameIfChanged`, so a new
  panel's `el.hidden = …` or `el.className = …` is a regression. Panels that are SUPPOSED to change
  under their own markup — anything holding a game clock (the 500 ms tick
  rewrites its digits), a Big Board (goal cannons get appended), a score form
  — use `setLiveHtmlIfChanged(el, html, holds)` instead: it compares markup
  only (clock digits blanked) and rebuilds if any object in `holds` (the game,
  a bracket) was replaced by a remote snapshot, so a kept form's listeners
  never write into an orphan. The open game view is therefore updated in
  place: the head (back pill, title, "How to play") is built once per game and
  compared as a plain string, so an idle `renderAll` neither replays the pill's
  slide-in nor slams the rules `<details>` shut, and the tally medal picks
  are set in place. **By design a STARTED bracket and the live-tracker entries
  still rebuild on every render** (their sub-views close over the bracket
  object and build in several writes) — `renderTournament` clears the compare
  key itself — so a Big Board's pulse phase restarts there. `renderAll` ends
  with `paintBoardClocks()` (a rebuilt clock is born with its final-minute
  classes) and `holdBoardCelebrations()` carries in-flight cannons/pops onto
  the board that replaced theirs. New panels on the renderAll path should do
  the same; never `transition: all` (it animated chips' line-height on every
  rebuild).
- `frame.test.js` (+ `.senior`, which evals it) — session B's pieces: `teamMark`
  (shield / flag-with-a-shape / tile; `paintTeamMark` writes only when the mark
  changes), the header model (never a number), More keeping the retired Settings
  drawer's ids, What counselors see (four switches on the existing keys, ON =
  shown, the standings row locked), the three drawers on the history stack, and
  the Your team sheet reading no standings.
- `game-view.test.js` (the rules above: live-html skip, kept forms firing real
  handlers after a state swap, celebrations only for scoring), `home.test.js`
  (home panels, toast cap, announcement composer), `overlays.test.js` (schedule
  sheet, status pill, members drawer, lock screen, scrim fade, pickers),
  `shell.test.js` (page-shell text pins: the not-yet-defined hide, the boot
  guard, no motion media query, **index.html's nineteen versioned assets share
  one `?v=` equal to `APP_VERSION`, in load order**), `builder.test.js`
  (week-builder shell, drafts, joy press), `chat-view.test.js`
  (chat view lifecycle, drafts, Back), `theme.test.js` (pre-paint theme and
  atomic flips) — each pins the state rules behind a glitch fix. `motion.test.js`
  loads `jelly-motion.js` into its OWN vm context (a hand-made DOM, a fake clock
  that also drives `setTimeout`, a queue-driven `requestAnimationFrame`, a WAAPI
  recorder): the springs against Jelly's `E()`, overshoot and minimum visible
  deformation (the §9.5 TABLE only, until a step ships a real call site), play/playOut/press/release/morph/flipKeyed,
  the held press keeping the finger inside the control, no residue, the calm
  truth table, hysteresis and the sampler (an always-30 Hz phone stays calm). Anything only
  visible in a browser (animation, layout) is source-checked or left to the
  Playwright pass.
- `tabs.test.js` — the shell (see "The shell: tabs, takeovers, sheets,
  history"): the pure history rules (`shellChain`, `shellHistPlan`, entry
  validation, deep-link parsing), tab switching, dirty render, scroll memory,
  history against a fake `history` with real entries and an asynchronous `go()`
  (Now → tab pushes one entry, tab → tab replaces, Back, Next-game replaces, cold
  deep links, a reload within / after ten minutes, the builder and the schedule
  sheet on the stack, the dirty-editor confirm), the chat tab, the keyboard rule
  and the sw.js "no change needed" pin.
- `fake-rtdb.js` (+ `fake-rtdb.test.js`) — an in-memory Realtime Database for
  sync tests: `const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js')`. It
  reproduces what has bitten this app — pruning of nulls/empties, array↔map
  round trips, sorted keys, `value` listeners (a refused read cancels one
  terminally), multi-path `update`, `transaction` (null first run, contention
  re-run, abort), `.info/connected`, an offline queue that replays in order,
  injected per-path refusals, and `{ manualFirstSnapshot: true }` so a test
  controls when the first pull lands. Every acknowledgement is delivered a
  macrotask after its call and COUNTED while on its way: `inflight()` (exported) is how many
  are owed across all fake databases, which is what `waitQuiet()` waits on. Drive the app's real `fbRef` /
  `fbConfigRef` with `db.ref(...)` instead of a one-method stub.
  `tests/fixtures/legacy-builder-v183.js` is the game editor's
  `toEditableDraft` + `saveGameDraft` verbatim from v183 (never edited): the
  config-engine rebuild's field-diff save must produce the same game from the
  same draft (`settings-crud.test.js` runs both).
- `wait.test.js` — the waiting helpers every async test uses (see "Waiting in a test"):
  `waitUntil` resolves at once when the condition holds, takes an async one and names what it
  waited for at its deadline; `waitQuiet` waits out a short timer a timer started and a whole
  chain of fake-database acknowledgements (each setting off the next write), ignores a long timer
  and a write an offline database is only holding, and names the timers that would not settle.
- `spelling.test.js` — the three-name merge and the alias table (old spellings
  only in the alias block of camps.js; old data still matches everywhere).
- `ics.test.js` (+ `.senior`, which evals the same file) — the "Add to calendar"
  export: every line folded to 75 octets (`icsFold`, byte-counted, never inside
  a UTF-8 sequence), UIDs `<camp>-<dow>-<block index>-<start>@…` so the two
  camps' exports of one weekday can never overwrite each other and a re-import
  updates in place, and `X-WR-CALNAME` = the camp's label — that is the per-day
  file while no camp dates are set. Since step 15 it also pins the WEEK file
  (`buildWeekIcs`): null with no dates, one VEVENT per timed block of all seven
  days, dates from `weekStart + dow` across a month, a year and a DST edge, UIDs
  unique and stable (camp + week + day + block id once the schedule is edited
  here, camp + week + day + position + start for the built-in copy), SEQUENCE /
  LAST-MODIFIED following the last schedule edit, the games / menu / cleanup in the
  description, one-day and from-today files that share the week file's UIDs, and the
  sheet's entry.
- `legacy-roster.test.js` — the 2026 roster migration runs only without a
  `meta.epoch`.
- `boot-cache.test.js` — loads the real scripts into a FRESH context over a
  populated cache (`makeContext({ storage: { campScoreboardV2: '…' } })`). A phone
  with a week already cached runs `normalizeSyncedState` / `migrateState` while
  app.js is still evaluating, so a load-time helper that reads a top-level
  `const` declared further down the file throws a TDZ error and the app boots
  blank — invisible to every other test, which loads empty and seeds state later.
  Keep helpers that run at load free of later top-level `const`s.
- `bracket-guard.test.js` — a foreign-shaped bracket renders the reload card, is
  never healed, pushed, or shown as live (see "A bracket this build can't read").
- `config-gate.test.js` — the week-config first-pull gate (nothing pushed before the
  first snapshot is processed, the baseline-less builder read-only, the first snapshot
  waiting for the state's first pull, data applied at once mid-entry, the null-seed),
  driven against `fake-rtdb.js` with the app's real `attachConfigListener`.
- `config-sync.test.js` (+ `.senior`) — **the config engine v2** (see "The week config
  is a field-op engine"): `treeDiff` / `applyOpsSafe` and the canonical id-space
  (including a seeded fuzz: base + diff = edit for random inserts, deletes, reorders and
  field edits, both catalogs), rebase on receipt, two devices editing two fields of one
  game, same field last-commit-wins, an old build's whole `set()` landing mid-push, a
  snapshot landing mid-push, the in-flight edit, `null` abort, re-seed of an emptied
  node, delete-vs-edit → Put it back (received and found-at-commit), the offline edit →
  real reload (a fresh context over the cache) → first-snapshot merge, clash → Use mine,
  the 36 h ask, epoch strand and follow, and accounting; plus the review-fix set —
  a renumbering never clashes (an offline delete or reorder beside a colleague's earlier
  delete / insert), a lost delete leaves its neighbours in place, same-id creates never
  overwrite (in the transaction, on a snapshot, in the first merge), last year's notes
  forgotten, and a seeded fuzz of the first-snapshot merge (both camps).
- `config-builder.test.js` (+ `.senior`) — the builder side of it: the game editor's
  field-diff save (a colleague's other field kept silently, a field both changed
  asked, removed-meanwhile offered back, a no-change save sends nothing, a new game is
  one whole-record op), the notes strip's markup (escaped) and the repaint after an
  Undo.
- `undo.test.js` (+ `.senior`) — **the undo core**: canonical entries, the Undo/Redo
  toast actions, undo only where the value still equals `after` (partial and refused
  reports), adds/deletes/reorders/days/teams, the offline-clash synthetic entry, the
  50-entry / 200 KB / 20 KB caps and persistence across a reload, clearing on epoch /
  demotion / `clearLocalData`, the viewer gate, the guards (a scored game, a day with
  games), a vanished record counted as left, neighbour placement of a restored game, and
  the 6 s / 44px toast action.
- `contrast.test.js` — danger red as TEXT. `--color-danger` is a fill tuned to
  carry white text; any rule that colours text red uses `--color-danger-text`
  (light `#b42318`, 6.57:1 on white; dark `#ff8a8a`). The test pins the token
  values' contrast and fails if a bare `color: var(--color-danger)` comes back.
  (A field's placeholder uses `--placeholder` — `--ink-3` 85 % over `--sheet`,
  about 5:1 in both themes; the browser's own grey is 3.5:1 in dark.)
- `export-guard.test.js` — a Firebase console export (members' emails, phones, chat) can't be committed by
  accident: `git check-ignore` says the names the console really writes (`<project>-default-rtdb-export.json`,
  `camp-export.json`, `*.export.json`, an `exports/` folder) are ignored at the repo root and under `tests/`,
  `tests/emulator/`, `docs/`; the replay tooling itself is not swallowed by the patterns; and no tracked file is named
  like an export or holds a camp root (`campScoreboard` / `seniorScoreboard`, or `members` + `state`) at its top level,
  so a renamed export is caught too. Skips, saying so, outside a git work tree.
- `owner-row.test.js` — the owner's Members row is read-only, and the client
  constant matches the rules literal in both camps.
- `rules.test.js` — the FILE `database.rules.json` is coherent: deny-all root,
  per-camp member lookups, `email_verified` everywhere, the `emailKey` transform,
  owner-key immutability, chat/changelog/presence/push pins, and (R1) that the
  ten R1 blocks equal what `tests/rules-macros.js` produces in both camps, that
  `revealPublic/.read` is the ONLY anonymous read in either camp, the anchors,
  the owner-only leaves, the reveal's bounds and the size budget. It cannot see
  what is published, and it proves nothing about behaviour: that is
  `tests/emulator/` (see "R1").
- `settings-crud.test.js` — the classic builder's create / edit / delete paths
  (`validateGameDraft`, `saveGameDraft`, `duplicateGame`, `deleteGame`,
  `deleteDay`, reorder, `pruneOrphanedGameData`). Everything the app keeps under
  a game id is ONE list in settings.js, `GAME_RECORD_MAPS` (result, bracket,
  score entry, live match, clock, drawing setup): a format change names and
  clears all of it after one confirm, `deleteGame` and the import / restore
  prune drop all of it (the clock used to be left behind — a "running" clock
  with no game to settle it). Add a new per-game synced map there.
  **Team counts are fixed** (6 junior, 4 senior — owner-confirmed): the classic
  Teams tab only renames, sets counselors and reorders. It has no Add / Delete
  team; "Add team" minted `t-<timestamp>` ids, which fail `isTeamId`
  (`/^t\d+$/`) and the push-device prefs rule (`^t[0-9]$`) — teams are
  `t0`…`t(N-1)` — so no code path may add or remove a team. A restore can't
  either: `tryImport` refuses (before its confirm, nothing replaced) a backup
  whose non-empty `teams` isn't exactly `CAMP.teamCount` unique `isTeamId` ids —
  the other camp's backup, or a hand-edited one. An absent/empty `teams` keeps
  the camp's own. The Teams tab's bracket note is a calm line when the roster
  matches the camp (senior's 4; `settings-teams.senior.test.js`) and the amber
  warning only when it doesn't.
- `owner-only.test.js` — `isOwner()` from the sign-in (never the device),
  `ownerName()` failing closed to "the owner", `ownerGate` / `ownerSays`, and
  `body.setup-owner`, and the hub's owner-only contract: every `data-owner-only` control
  in the markup starts `hidden` and CSS removes it unless `body.setup-owner`, no owner action
  is built yet (`SETUP_OWNER_ACTIONS`, `HUB_DOOR_ACTIONS` empty), and a non-owner director
  reaches an owner control by no path (the sentence, the menu, the door click, the menu tap).
  Steps 15, 19 and 28 extend it as each owner-only button lands.
- `setup-sync.test.js` (+ `.senior`) — the setup engine against `fake-rtdb.js`:
  heal and canonical form, per-shape depths, anchors, dark (nothing written, owner
  switches refused), first-snapshot three-way merge (prune and key-order variants),
  clashes and Put it back, the epoch strand and the wipe, rebase of unsent edits,
  echo keeping refs, bisect / quarantine / "rules not published", the read refused
  without touching `fbRef`/`syncDenied`, the tab-writer gate, accounting hooks, undo,
  the sync line, a cached week booting.
- `restore.test.js` (+ `.senior`) — restore points against `fake-rtdb.js`: the body's
  exclusions and hash, one multi-path write, owner-only kinds, the 4 s outbox,
  retention (40 / 20, never pinned / archive / pre-wizard), pin and delete, another
  camp's point refused, the preview, preconditions and the server re-read, a
  minimal selective diff that never writes epoch or switches, a Games-only
  restore keeping every game with scores, and Backups v3 (round trip, pre-import
  point, other camp, v2 still accepted). `fnv1a` vectors.
- `editors-here.test.js` (+ `.senior`) — "also here" and Devices: dark (no row, no
  listener, no write on connect), the write protocol and the rules' shape, the 1 s
  floor coalescing, reconnect, viewers / view-only tabs / a demotion never writing
  or listening, a refused write swallowed, fail-closed names, only directors shown,
  the header and matching-screen sentences, every `where` worded, and the Devices
  join by device id with its 10-minute filter and build grouping.
- `checklist.test.js` (+ `.senior`) — the hub's checklist: one case per problem sentence
  `hubStatus` can honestly evaluate this step (Games, Teams, People, Notice, Restore
  points), the `soon` rows claiming nothing, "N of M ready" / what is next, the front
  door's order, **the owner-only rendering contract** (a button only for the owner AND only
  with an action behind it; every other director reads the owner's name; never a dead
  button), `hubView` over the live page, and the hub rows in `index.html` (a row that
  opens a screen is a `<button>`, one that doesn't is a `<div>`).
- `setup-ui.test.js` (+ `.senior`) — navigation (More → hub, a named tab → the classic
  screen, Back, a dirty game editor asking through `askDialog`), **a counselor reaching
  none of it** (`openBuilder`, `setupGo`, a stored screen, every setup sheet, a forged
  history entry, a deep link), the sync line and its Details, the undo pill (no toast
  inside the builder, Redo, docking, one at a time, Ctrl/Cmd-Z, a partial undo as a plain
  sentence), Recent changes, the owner's menu rows, `askDialog` (native fallback,
  escaping), and that an idle `paintHub` writes nothing.
- `restore-ui.test.js` (+ `.senior`) — the Restore points screen (Kept / Recent / Past
  years, rules-not-published and no-sync notes), Save a restore point now (name, 60
  characters, the 20-by-hand cap), the restore sheet (sections, Scores unticked, the
  hold button naming the camp, the two-tap alternative), the hold itself (1.2 s clip-path
  wipe, drain on early release, a tap reveals), keep and delete, and backup files.
- `auth.test.js` — the `emailKey` contract (multi-dot/case/trim — the
  regression that would lock people out under the rules), the `canEdit` truth
  table via `setMemberRole`, the `memberRecord` shape, `clearLocalData`'s
  wipe list, and that no PIN machinery survives.
- `accessors.test.js` (+ `.senior`, which evals it) — every accessor in the SEAM
  block against the camps.js constant it fronts: while a section is off, `===`
  the constant itself, for every key the camp has; the shared empty lists are
  frozen; junk in never throws; the sanitizers are applied on the way out (a
  markup emoji, an external or quote-breakout crest, an over-long short name);
  and `campWeek()` (unset / before / during / after, setup date over the drawer's).
- `seed.test.js` (+ `.senior`) and `games-blocks.test.js` (+ `.senior`) — the schedule as
  data: the seed's round trip, measured shape and frozen id fixtures, the 10,080-minute
  banner fuzz before vs after seeding, the A2 oracle (see "Schedule as data"), and that a
  game the rain plan moved shows on its new item and is never put back by A2. Both
  eval-twin under senior.
- `schedule-edit.test.js` (+ `.senior`) — setup-sync.js sections 8–9, pure over a tree:
  edit by scope (typical vs just this day; the patches that go with it; a day's own patch
  never written into the typical day), the days an "Every day like…" save reaches, add /
  remove / bring back, give a day its own schedule (same ids, one commit, the day reads
  exactly as before) and follow again, the ripple (never past midnight, an end-of-day item
  elastic), overlaps and gaps, "open and save every seeded item unchanged: zero ops", and the
  rain plan's engine (first base kept, swaps, nudges, retime, Done's clash check, verdict,
  commit mutator, game moves). `schedule-screen.test.js` (+ `.senior`) — the Schedule screen's
  behaviour layer: rows, preview mode, gaps, the item sheet's questions (overlap, a day with
  its own value, a rename), the scope buttons, remove with games, the day's menu.
  `week-screen.test.js` (+ `.senior`) — Camp week (dates, ticks, finale, the legacy double
  window), Edit the week here as a conversation, Use the original week again.
  `rain-plan.test.js` (+ `.senior`) — opening, collapse, every action, the draft, Back,
  Done (clashes, verdict, ONE commit and ONE undo entry for setup + games), the home sheet's
  way in, and **M2 in handler calls (10)**; the REAL tap count is the Playwright script.
- `sections.test.js` (+ `.senior`) — step 19's four sections: the seed's record shapes against
  the rules, every accessor the constant itself while off and deep-equal to it once the seed is
  on (both camps), the Meal tag (a tagged "Supper and free time" shows its dish and its cleanup
  line; off, a meal is still read off its label), the verse video through `safeVideoUrl`,
  fill-evenly (±1, no team twice a day, no team on one meal two days running, locked slots,
  Friday's pairs, a relaxed rule is reported), the fairness line, an elective person's identity
  (member key first, then name through `canonicalCounselorName`), the mutators' exact ops and
  their `off` refusal, and Turn on against the fake database (ONE restore point, ONE
  transaction, owner only, off-then-on keeps the edit).
- **The seeded pass** — `tests/run.js` re-runs `SEEDED_FILES` (week, push, chat, ics,
  tabs, frame, shell, home, render-stability, game-view, secrecy, motion, overlays,
  boot-cache, backup) against a camp whose schedule is edited here
  (`makeContext({camp, seeded: true})`; junior, and senior where the file has a
  `.senior` twin). `SEEDED=all` probes every file, `SEEDED=off` skips it. A test that
  builds its own fresh context (boot-cache, secrecy's hint-paint boots, shell's
  missing-script boot) passes `seeded: scheduleIsShared()` through, and `ics.test.js`'s
  `wkSet` / `wkReset` put the seeded tree back (`wkOff` is the printed week on purpose) —
  otherwise the "seeded" rerun quietly repeats the plain one. A third pass,
  `SEEDED_ALL_FILES` (week, ics, push, chat, home, tabs, shell, render-stability, secrecy,
  frame), runs with `makeContext({camp, seeded: 'all'})`: the four smaller sections ON as
  well, the page as it will be after step 20, proving their "on" half shows what the built-in
  half did.
- `seam.test.js` — greps `app.js` (minus the SEAM block), `chat.js`, `push.js`
  and `settings.js` for direct reads of the week constants, `CAMP.<week field>`,
  `setupTree` and `state.config.days|games` (including a computed key, an alias
  or destructure, and a read split over lines), and fails with `file:line`. The
  builder's WRITES to the catalog (`.push`/`.splice`/`[i] =`/`moveItem`) are
  recognised by shape and allowed. It also tests its own scan, so it can't go
  quietly vacuous.

The stub is deliberately minimal, and DOM lookups return a memoized stub element
rather than null (closer to the real page, where a render function's container
always exists). Tests assert on state and return values, never on markup —
anything needing real layout belongs in the Playwright pass.

**The readiness gate for Edit the week here (Steps 16 and 20): `tests/emulator/export-replay.mjs`.** The owner takes a
console export of the whole database (Data → ⋮ → Export JSON; it holds members' emails, phones and chat, so keep it outside
the repo, never commit it, delete it afterwards: the repo's root `.gitignore` and `tests/emulator/.gitignore` ignore every
`*export*.json` and an `exports/` folder as a net, and `tests/export-guard.test.js` pins that) and one
command, `CAMP_EXPORT=/path/to/camp-89cea-default-rtdb-export.json node export-replay.mjs` in `tests/emulator/` with the database emulator
running, gives a verdict per camp. For each camp it loads the exported data into the emulator, drives the REAL client (the
shipped scripts through `tests/harness.js` over `tests/fake-rtdb.js` holding the same data) as the owner through
`setupTurnOn` (schedule, then meals / verses / cleanup / electives), the games' attachments and the publisher, records every
write, replays them under the real `database.rules.json` (each accepted; the owner-only ones refused to a non-owner
director), compares what the camp reads before and after (the schedule, the banner for every minute, the calendar files, the
games per block, the alert blocks, meals, verses, cleanup, electives, staff) allowing only the documented intended
differences (`replay-fidelity.mjs`), checks that Use the original week again restores the "before" set exactly, replays a
second director's edits, and reports team ids (`t0…t(N-1)`) and any game left on no schedule item. It prints paths and counts and
no email, phone number or chat (a difference it cannot explain is printed as text, scrubbed of emails and phones, so it can
name a game, a dish, an elective station or a counselor). `make-synthetic-export.mjs` writes fake console exports (clean and "junk") to prove it before
the real file exists, and `REPLAY_MUTATE=refused-write|seed-block|rollback-leak` or a weakened `R1_RULES` file shows it go red.
Details and how to read a finding: `tests/emulator/README.md`.

## Two camps, one app (junior + senior)

Since 2026-07-25 this codebase serves TWO camps: **junior** (the original)
and **senior** (ages 13–18; 4 teams with flags, no electives, different
daily schedule). Everything per-camp lives in a profile in `camps.js` —
`CAMPS.junior` / `CAMPS.senior` — and `CAMP` is the active one, chosen
per-device by `localStorage.campScoreboardActiveCamp` (junior is the
default, so pre-camps devices behave identically). The one other input is
`window.CAMP_FORCE`: `activeCampId()` honours it when it names a real camp,
and only the TV page ever sets it (`tv-camp.js`, from `?camp=`) — the app never
does, so an app device always chooses by its own key.

- **Junior is byte-identical to the single-camp app** — apart from the three
  counselor spellings merged once on purpose (below). Its `dbRoot` is the
  original `campScoreboard` literal and its `storageSuffix` is `''`, so
  every Firebase path and localStorage key is exactly what it always was —
  `tests/camps.test.js` pins this, plus a deep-equal of the whole junior
  week data against `tests/fixtures-junior-week.json` (dumped before the
  move; regenerated ONCE, for the spelling merge — its diff is only those three
  spellings — and never edited since). Senior lives under the SIBLING root `seniorScoreboard/*` with
  `':senior'`-suffixed storage keys and its own members list.
- **Every Firebase path goes through `dbPath(sub)`** and every per-camp
  storage key through `lsKey(base)` (both in camps.js). Never write a
  `'campScoreboard/…'` literal again.
- **Membership is per-camp**: `campScoreboard/members` and
  `seniorScoreboard/members` are separate lists; being on both = access to
  both, and roles can differ per camp. The active camp's member self-read
  is the ONLY `.on()` attach; the other camp gets a one-shot `once()` probe
  after approval (a refused `once()` is harmless), recorded in
  `localStorage.campScoreboardCampsHint` (`{junior:'editor',
  senior:'viewer'}`).
- **The Members drawer manages BOTH camps in one list** (`renderMembers`
  loads both lists via `once()`; `mergeMemberLists` folds them to one row
  per person). Each row carries a per-camp None/Viewer/Editor switch:
  None removes that camp's record (confirmed), Viewer/Editor writes the
  role, and setting a role where no record exists GRANTS access (a fresh
  `memberRecord`, name carried over, `teamId` deliberately not — teams are
  per-camp; the team select on the row edits the ACTIVE camp's record
  only). A switch is disabled for your own row and for camps where you're
  not an editor (`campRoleOf`); cross-camp writes go through
  `campMembersPath(campId, key)` — the only cross-camp write path. The add
  form gains a "This camp only / Both camps" choice when you're an editor
  in both. Pending rows stay single-camp (their random key means nothing
  to the other list) and keep the simple Viewer/Editor + Remove controls.
  If the other camp's list can't be read (not a member there), the drawer
  falls back to exactly the single-camp UI.
- **One spelling per counselor** (decision Q21, 2026-10): Alysa → **Alyssa**,
  Sofie → **Sofia**, Lilly → **Lily**, merged once across `camps.js`
  (`ELECTIVES`, `TEAM_COUNSELORS`, `SEED_COUNSELORS`, `DEFAULT_COUNSELORS`, the
  Wednesday evening label). Data already out there — a member row typed
  "Alysa", a phone whose stored `state.identity` is "Lilly" — keeps matching
  through ONE function, `canonicalCounselorName()` (camps.js; table
  `COUNSELOR_NAME_ALIASES`): `missingSeedCounselors`, `adoptMemberTeam`,
  `myStationFor` / `myElectivesToday` / the schedule "You" markers, and chat's
  `mentionIsMine` all compare through it, and `normalizeSyncedState` rewrites a
  stored identity once. Alert block keys are unaffected (`pushHeadLabel` cuts a
  label before any name). Member rows already in the database keep the name they
  were typed with until a director renames them — but they DISPLAY merged:
  `counselorName()` (standings, tally rows, matchup callouts) runs its text
  through `respellCounselorText()` (camps.js, word by word, display only, never
  written), so a team's hand-typed counselor line in the database never shows
  an old spelling. Any NEW place that compares a counselor's name must go
  through `canonicalCounselorName`.
- **Switching camps is ALWAYS set-key-then-reload** (`switchCamp()`), never
  re-pointing refs in place — the listener lifecycle is one-shot (a
  cancelled read is terminal). Dual-camp accounts get the camp picker
  **once** — the first time the device discovers both camps
  (`campScoreboardCampAsked`) — and the choice is then remembered (the
  active-camp key IS the memory). Owner's revised call, 2026-07-25;
  ask-every-launch was the original behavior. The camp question outranks
  the team picker — the team question is held while the camp dialog is open
  and re-asked on its close. Mid-session switching: More's **Switch camp**
  group (`#more-camps`, the Junior / Senior radio buttons `#camp-switch`; only
  when `campScoreboardCampsHint` shows both camps).
- **Denied in the active camp → probe the other one** (`denyMember`): a
  senior-only counselor whose first sign-in lands on the junior default
  gets auto-bounced to senior (one-shot per tab via
  `sessionStorage.campSwitchTried`, so denied-in-both can never loop).
- **Feature flags**: `CAMP.features.electives` is the only one — senior
  turns the electives card, the identity ("which one are you?") picker
  step, and the follow-card identity line off. Verse, cleanup, and the
  meals menu stay ON for senior with placeholder/empty data (empty rota
  ⇒ TBA; empty meals ⇒ plain labels; placeholder verses).
- **Senior seed data is placeholders**: Red/Blue/Green/Gold teams (t0..t3 —
  same id scheme, disambiguated by root+namespace), the published sample
  day as the Mon–Fri schedule, and 5 seeded placement games per day (two
  Team Competitions, Legacy Game, Hot Seat, Let's Make a Deal — all scored,
  owner's call). `seniorDefaultConfig()` uses `version: 5` ON PURPOSE: the
  junior one-shot migrations in `migrateState` are gated on `version < 5`
  and must never fire against senior data.
- **The 6-team bracket wizard refuses senior's 4 teams** (existing
  `renderTournament` guard) — a 4-team bracket (2 semis → 3rd-place match →
  final) is planned; until then senior uses placement/tally formats.
- **Tests**: a file named `*.senior.test.js` runs against the senior
  profile (the runner seeds the camp key before scripts load —
  `makeContext({camp:'senior'})`). `week.senior.test.js` re-runs the
  structural checks + the every-minute banner fuzz as senior.
- **Rules are PUBLISHED for both camps** (2026-07-25, verified): one
  combined ruleset — the junior block unchanged plus a `seniorScoreboard`
  copy with only the members-lookup path swapped. All fifteen
  unauthenticated probes (six read paths per camp, write probes, a
  member-injection attempt) return `Permission denied`, except that since R1
  was published (2026-11-02) exactly one read per camp
  (`<root>/revealPublic`) answers `null` instead (see "R1"). The senior owner
  record `seniorScoreboard/members/patricksimpson,fx@gmail,com` is seeded
  editor via the console Data tab and is rules-immutable, same as junior's.
  (First seeding attempt landed NESTED INSIDE campScoreboard — the console's
  per-row + is easy to hit one level down; the fix was delete + re-add via a
  direct path URL. Check indentation when console-seeding.)
  `current-standings.html` serves both camps through `?camp=` (below).

## The week-data seam (the SEAM block in app.js)

Added at Step 4 of `docs/build-notes/BUILD-PLAN.md` (setup-rebuild-spec §9). The
week's own data — the printed schedule (`DAY_SCHEDULE`, `SCHED_DAYS`,
`DAY_NAMES`), meals, the cleanup rota, memory verses, electives, team branding
and printed counselor lists, the roster seed, the double-points window, and the
game/day catalog (`state.config.games|days`) — is read in ONE place. The per-camp
constants moved INTO the block unchanged (the names are still globals, so
`tests/camps.test.js` and the migration tests read them as before); every
renderer, `chat.js`'s mention dictionary, `push.js`'s publisher and
`settings.js`'s builder ask an accessor instead. **Do not read those constants,
`CAMP.<week field>` or `state.config.days|games` anywhere else** —
`tests/seam.test.js` fails with the line. A new reader of week data adds (or
reuses) an accessor in the block.

- **Why:** the setup rebuild (BUILD-PLAN Steps 14–22) lets a director edit the
  week in the app, kept as shared data. The accessors are the single place that
  will choose between the built-in copy and the shared one; no renderer changes
  again. **No behaviour change until a switch is pressed**: while a section is off
  (every section is, until the owner's Edit the week here) an accessor returns the
  camps.js constant itself (the same object). Verified
  byte-identical on both camps (banner at 19 times of day, schedule sheet and
  `.ics` for all seven days, follow card, verse, cleanup, electives, identity
  picker, viewer and editor) before and after.
- **Rules of the layer:** plain data, never markup; never throw on missing data
  (a missing day is the shared frozen empty list `NO_ITEMS`, a missing verse
  `NO_VERSE`) — and never mutate what one returns; text from the database passes
  a `camp-core.js` sanitizer on the way out (`teamEmoji` → `safeEmoji`,
  `teamShort` → `safeShort`, `teamCrestSrc` → `safeCrestSrc`).
- **The accessors:** schedule — `scheduleIsShared`, `scheduleForDow`, `planForDow`,
  `scheduleWeek`, `weekDays`, `campWeek`, `dayLabel`, `competitionDows` (Mon–Fri),
  `competitionDays`, `dayById`; games —
  `allGames`, `gameById`, `gamesForDayId(dayId)`, `gamesForBlock(dow, block)` (the
  Morning-before-noon / Evening rule, matched to the weekday by each config day's
  `dow`; the built-in blocks carry no id, so it takes the block); meals and
  cleanup — `legacyMealOf(label)`, `mealFor`, `mealStart`,
  `cleanupOnRota(dow)` (is the day on the rota at all: untracked says nothing, a
  tracked day with no team reads "TBA"), `cleanupTeams(dow, meal)` (always an
  array, `[]` = TBA); alerts — `blockKey`, `blockPushId`; verses — `verseTheme`,
  `verseFor`; electives — `electivesFor`, `stationEmoji`, `electiveSlotStart`;
  `doubleWindow`, `finaleDow` (the weekday the standings reveal crowns the champions, Friday by default); teams — `teamIds`, `teamEmoji`, `teamShort`, `teamAccent`,
  `teamCrestSrc` (was `teamShield`), `teamRoster(tid)`, `staffNames`, `seedTeams`,
  `legacyRosterFor(i)`.
- **Deliberately not built yet** (nothing reads them, so no dead code): the spec's
  `teamAccentVars` (needs the CSS to read a light/dark pair),
  `hubStatus`, `campersFor` — each lands with the step that first needs it.
  **The "on" half of the schedule accessors is built (Step 15)**: `scheduleForDow`,
  `scheduleWeek`, `weekDays`, `planForDow`, `campWeek`, `blockKey`, `blockPushId`,
  `gamesForBlock`, `gamesForDay` and `unscheduledGames` choose between the built-in
  copy and the shared one on `meta/on/schedule` (see "Schedule as data"); `mealFor`,
  `mealStart`, `blockMeal`, `cleanupOnRota`, `cleanupTeams`, `verseTheme`, `verseFor`,
  `electivesFor`, `stationEmoji`, `electiveSlotStart` and `staffNames` choose on their own
  section's switch (step 19: see "Meals, verses, cleanup, electives as data"); teams' "on"
  half arrives with step 25.
- **The builder is the authority, not a reader.** `settings.js` still WRITES the
  catalog straight into `state.config` (`push`, `splice`, the reorder swap and
  `moveItem`) — `competitionDays()`/`allGames()` front that same array. Reads
  there go through the accessors.
- **`staffNames()` is the printed roster only**; the member directory
  (`memberDirectory`, which carries each person's key) stays chat's own source,
  so the mention dictionary is unchanged.
- **Pins that moved:** `cleanupAssigned` → `cleanupTeams` (`secrecy.test.js`,
  `week.senior.test.js`), `teamShield` → `teamCrestSrc` (`week.senior.test.js`).
- **Load order:** the block sits before the state is built (`let state = …`), and
  every accessor reads `state` only when called. Everything else an accessor
  reads is declared INSIDE the block (the camps.js aliases, plus
  `MEAL_CLEANUP_MEALS` / `MEAL_ICONS`, which `legacyMealOf` needs), so a
  load-time caller (`normalizeSyncedState`, `migrateState`) can never hit a TDZ
  error on a top-level `const` declared further down (`boot-cache.test.js`).
  Keep it that way: a new constant an accessor reads goes in the block.
- **Colours are not laundered yet.** `teamAccent()` still returns the camps.js
  colour raw into `style=` at three board renderers — safe only while it is a
  code constant. The step that lets a week source team colours from the
  database must launder them at the accessor with `safeColorVars` (BUILD-PLAN
  Step 25, the palette and `teamAccentVars` step).
- **The guard's reach** (`tests/seam.test.js`): per-line regexes for the
  constants, `CAMP.<field>` (also `CAMP?.`), `state.config.days|games` (also
  `?.`), plus the indirect shapes — a computed key (`state.config['days']`,
  `CAMP['meals']`), an alias or destructure (`const cfg = state.config;`,
  `const { meals } = CAMP;`) and a read split over lines (a line that ends in
  `state.config` / `CAMP`). The builder's writes are cut out of a line before
  the read test. It is a tripwire for the shapes the code uses, not a parser —
  a read hidden behind a helper that takes `state.config` as an argument is
  not seen.

## Camp chat (chat.js)

Four fixed channels — ids `announcements` / `general` / `memes` / `photos`
(`CHAT_CHANNELS` in camps.js; the IDS are a contract with the security
rules, labels/emoji are free to change). Every signed-in member can post,
viewers included — chat is deliberately NOT `canEdit()`-gated (the first
member-writable content path; author identity is validated by the rules,
so nobody can post as someone else).

- **Data lives BESIDE state, never in it**: `<dbRoot>/chat/<ch>/<msgId>`
  (push ids) and `<dbRoot>/chatPhotos/<photoId>` — sibling nodes, own
  listeners (`initChatSync`, called from `initSync` post-approval),
  in-memory only. Nothing chat-related touches `SYNC_KEYS`, the
  localStorage snapshot, or the diff push. A chat listener error sets
  `chatDenied` and degrades CHAT ONLY — it must never touch
  `fbRef`/`syncDenied` (the terminal-read invariant is the state
  listener's).
- **Message**: `{at: ServerValue.TIMESTAMP, byKey (rules-validated ==
  auth identity), name ≤60, text? ≤2000, thumb? ≤24k-char JPEG data URL,
  photoId?}`. No edits by design (rules allow create and delete only);
  authors delete their own, editors delete anything and can 🧹 clear a
  whole channel (double-confirm; also deletes the channel's photos via
  `orderByChild('ch')`).
- **`byKey` is the only trustworthy field on a message.** The rules validate
  it against the sender's authenticated identity; `name` is just a string the
  sender's device wrote and is length-capped only, so a signed-in member could
  post under someone else's name. **Never render `msg.name` directly** — every
  display path goes through `chatAuthorName(msg)`, which resolves `byKey`
  against `memberDirectory` (editor-maintained, so it's the source of truth).
  A current member with no `name` on file renders as their email/phone rather
  than their claim; the stored `name` survives ONLY as the fallback for a key
  that has left the directory, so a departed counselor's history reads as
  their name instead of a raw email. The directory arrives async and changes
  on rename, so app.js's members listener calls `onMemberDirectoryChanged()`
  to rebuild the bubbles. The stored `name` is deliberately still written —
  it's the departed-member fallback, not the display source.
  `chatAuthorName` fails CLOSED: `memberDirectoryLoaded` (app.js) distinguishes
  "no directory yet / read failed" from "loaded", and with no directory it
  shows the rules-validated identity rather than the claim — otherwise a read
  error would restore spoofing app-wide. The departed-member fallback also
  refuses a name that belongs to somebody still on the list, so a member can't
  plant messages as "Patrick" now and have them activate once they're removed.
- **Three fields are laundered on the way in** (`normalizeChatMsg`), because
  the rules are not versioned with the code and a regression there must not
  reach the DOM:
  - `chatSafeImageSrc` — `thumb` and the lightbox's `chatPhotos.data` render
    ONLY if they are inline `data:image/…` URLs. An `<img src>` is the one
    place a database string becomes an outbound request, so an external URL
    here is a tracking beacon that fires for every viewer of a channel.
  - `chatSafeAt` — clamps the timestamp. **This one is load-bearing**:
    `chatAnnouncementBanners` calls `new Date(at).toISOString()`, which THROWS
    on an out-of-range number, and it runs inside `renderAnnouncements` →
    `renderAll`. One announcements message with a wild `at` would take the
    whole app down on every device, with no working UI left to delete it from.
    Clamping the future also stops such a message pinning itself to the banner
    strip and the unread badge forever.
  - `chatSafePhotoId` — push-id charset only; the id is concatenated into a
    database path.
- **Photos are split**: a ~320px thumbnail rides in the message; the
  ~1280px full image lives in `chatPhotos` and is fetched by `once()` only
  when tapped (lightbox). This is the bandwidth design — every page load
  re-downloads each channel's `limitToLast(CHAT_WINDOW = 50)` window, so
  inline full photos would burn the free 10GB/month. `CHAT_WINDOW` is THE
  tuning knob.
- **Backlog vs live**: after attaching `child_added`, a `once('value')`
  resolves AFTER the initial backlog — that flips `chatReady[ch]`. Backlog
  counts toward unread but never toasts; only post-ready messages run
  `notifyChatMessage` (own messages skipped; `announcements` while
  subscribed → everyone gets toast + OS notification + chime + vibrate,
  clone of `notifyNewAnnouncements`; else mention-of-me → louder alert;
  else SUBSCRIBED channel → normal alert; else badge only).
- **Channel subscriptions** (`lsKey('campScoreboardChatSubs')`, wiped on
  sign-out): a subscribed channel alerts on EVERY message. Announcements
  is subscribed BY DEFAULT (owner's call) and can be muted; everything
  else is opt-in via the bell at the end of the channel strip (`toggleChatSub`).
- **The banner strip**: a message posted in the Announcements channel also
  rides the top-of-app announcements area for 15 minutes
  (`chatAnnouncementBanners`, merged in by `renderAnnouncements`,
  dismissible through the same dismissed set; `CHAT_BANNER_MS`). Chat-
  sourced banners carry no "remove for everyone" (delete the message in
  chat instead).
- **Mentions are AUTOMATIC** (no @ syntax): `chatMentionTargets()` = every
  member-directory name (+ first names), the printed roster
  (`staffNames()`), team names, short team names (`teamShort()`); `mentionScan` is word-boundary, case-insensitive,
  longest-match-wins (pure — tests/chat.test.js). "Mine" = my
  `memberName`/`state.identity`/identity key/`memberTeamId`/
  `state.followTeam`. Rendering walks the RAW string and escapes each
  segment (`renderChatText`) — never regex over escaped HTML.
- **Unread**: per-camp seen map `lsKey('campScoreboardChatSeen')`
  (`{ch: lastSeenMs}`, wiped by `clearLocalData`); unread = other
  people's messages after lastSeen. Badges on the Chat tab bar button +
  channel tabs; seen marked while the channel is open and the tab visible.
- **UI**: the **Chat tab** (`#tab-chat`, a fixed panel between the header and
  the tab bar, redesign §6; `#chat-view` lives inside it). There is no home card
  and no `body.chat-open`: `chatOpenNow()` means "the Chat tab is on screen with
  nothing stacked over it" (`activeTab()` / `shellTakeoverOpen()`), and
  `chatBuilt()` means the view exists. The tab's unread badge is
  `renderTabBadges()` (`unreadTotal()`, capped "99+", named in the button's
  `aria-label`); `renderChatStatus()` refreshes it and the Home Screen icon
  badge after every chat event. When the editors hide Chat from counselors
  (`hiddenCards.chat`, in `HIDEABLE_CARDS`) the tab stays and its panel says
  "Chat is turned off right now" (`data-chat-shell="off"`; the shell is rebuilt
  when it comes back); the switch itself moves to What counselors see. The
  view (channel strip, list, composer) is BUILT once, on the tab's first
  show (`buildChatShell`, also when the viewer's role flips — the broom
  button is the one role-dependent part) and then KEPT across tab switches; a
  channel switch, bell toggle or directory update only PATCHES it in place
  (`updateChatShell`: active tab, header, composer placeholder, the list through
  `setHtmlIfChanged`), and a non-forced `renderChatView` is a no-op while
  `chatViewBuiltFor` already matches — the tab's panel renderer runs it only
  while Chat is the visible tab. So the composer node survives a channel
  switch AND a trip to another tab (iOS won't re-focus a detached input: the
  keyboard would drop), and live messages append incrementally even while
  another tab shows (`shownHere` = built for that channel; only MARKING seen
  needs `chatOpenNow()`). A hidden panel forgets its list scroll, so
  `chatOnTabHidden` / `chatOnTabShown` (called by the shell) remember it and
  land on the newest message when the reader was at the bottom. Half-typed text
  lives in the in-memory `chatDrafts` (per channel, never localStorage, gone on
  sign-out) and follows the person across channel switches and tab trips
  (`chatHasDraft()` also stops the shell sending someone home after a long
  absence). Every handler reads the channel at call time
  (`chatCurrentChannel`), never closed over at build time. There is no channel
  header row: the open channel's name is a visually-hidden `h2` (the selected
  segment already shows it), and the bell (`#i-bell` / `#i-bell-off`,
  `aria-pressed`) and an editor's broom are line-icon buttons at the END of the
  switcher row (`.chat-switch`). The strip (`.chat-tabs`) always scrolls sideways
  when the labels can't share the width (130–200% text, a bell + broom at 360px),
  its clipped edges fade (`chatMarkStripEdges`), and the open channel is scrolled
  into view (`chatRevealActiveTab`, also on `chatOnTabShown`); `.chat-well` is the
  drawn track inside it. The composer is a `<textarea rows=1>` that grows to ~4
  lines (`field-sizing: content`, `chatFitComposer` elsewhere): Enter sends,
  Shift+Enter is a new line (bubbles keep it: `pre-wrap`). "Sync is off" is only said when it is
  definitive (`chatSyncOff`: no config, SDK failed, or a rules refusal);
  otherwise the list reads "Loading…", and app.js's `onSdkLoadFailed` calls
  the typeof-guarded `onChatSyncStateChanged` so it flips at once.
  **Phone Back** is the shell's (leaving Now for Chat pushes one entry, Back
  returns to Now): chat files no history entry of its own and has no back pill
  or `popstate` listener. `openChat(ch)` (notification taps, push.js) switches to
  the tab on that channel and refuses a viewer who has chat hidden.
- **Rules**: `chat` + `chatPhotos` blocks per camp root (member-read,
  member-create-with-own-byKey, author-or-editor delete, editor
  channel-clear, string caps, `$other: false`). Until pasted, chat shows
  "isn't available yet" and everything else works — code can deploy first.
- **Honest limit** (owner accepted): no push server, so alerts fire only
  on devices with the tab open (backgrounded OK, closed no); unread badges
  catch everyone else up on next open.

## Phone alerts (push.js + push-worker/) — added 2026-10-26

Real notifications that reach a phone with Camp CLOSED (the in-app toasts and
`maybeNativeNotification` only work while the tab is alive). Owner's
requirements, all confirmed: staff only (signed-in members), no app stores
(the site installed to the Home Screen — iPhones need that, iOS 16.4+), and
**$0 with no credit card**. What can buzz a closed phone: Announcements
(default on), a mention of you or your team, every message in a belled
channel, any schedule block you pick (5/10/15 min early), and director
alerts (Everyone / a team / directors only, with an Urgent switch that
ignores the "director alerts" opt-out). Design spec:
`docs/build-notes/push-alerts-spec.md`.

- **Why a Cloudflare Worker**: sending Web Push needs a server holding the
  VAPID private key. Firebase Cloud Functions need the Blaze (card) plan, so
  the sender is a free-plan Cloudflare Worker (`push-worker/worker.js`, pasted
  into the dashboard — setup guide `push-worker/README.md`). It talks to RTDB
  as ADMIN through a service-account key stored as the Worker secret
  `FIREBASE_SERVICE_ACCOUNT`, and verifies callers' Firebase ID tokens itself.
  It never trusts what the page says about a message: `/notify` gets
  `{ch, msgId}`, reads the message, and only the AUTHOR may trigger it.
- **Free-plan limits drive the shape**: 50 subrequests and 10 ms CPU per
  invocation. Web Push encryption costs real CPU per phone, so one invocation
  sends at most `PUSH_BATCH` (20); the rest become `pushServer/outbox` batches
  that the posting page drains at once (`POST /drain`, fire-and-forget) and the
  every-minute cron drains as the backstop. Claims are ETag-conditional
  deletes, so a batch is sent at most once. Don't raise `PUSH_BATCH` casually.
- **Data**: per camp root — `push/<memberKey>/<deviceId>` (one record per
  person+device: endpoint, keys, prefs; owner-only read/write in the rules;
  removed members can still delete their own), `pushSchedule` (the week's
  blocks + `weekStart` + `rev` + `src`, editor-written — the schedule is JS in camps.js
  (or, once edited on the Schedule screen, data in `setup/`) and the Worker can't run JS, so
  editor devices publish it as data and re-publish automatically when it changes; the week
  is `campWeek().start`, i.e. `setup/meta/weekStart`, see "The published schedule"), `pushAlerts`
  (director-alert audit log, Worker-written, editor-read). Worker-private
  state lives in top-level `pushServer/` (VAPID keys — generated by the
  Worker on first use and NEVER regenerated, cron cursor, dedupe markers,
  rate stamps, outbox); the root deny-all keeps every client out of it.
- **Schedule reminders only run during camp week**: an editor sets "Starts on
  (a Sunday)" in the drawer; outside [that Sunday − 1 day, +8 days] the cron
  reads one tiny value and writes nothing.
- **Same invariant as chat**: nothing touches the database until membership is
  approved (`initPush()` is called from the approved sync path). Push failures
  never block or fail a chat send.
- **sw.js must show a notification for EVERY push** (iOS revokes push
  permission otherwise) and still has NO fetch handler. Notification tags are
  shared with the page (`chat-<msgId>`, `alert-<id>`, `block-<id>-<date>`) so
  an open app's own notification and the push collapse into one.
- **iOS**: the permission request must be the first await in the tap
  handler; subscribing needs a tap too, so a phone that lost its
  subscription gets a "tap to reconnect" prompt instead of a silent retry.
- **Push endpoints are allowlisted** (rules + Worker): a device record's
  endpoint must be on google.com/googleapis.com, Apple, Mozilla or Windows
  push hosts — otherwise any member could make the sender POST to arbitrary
  URLs. A new browser with a different push host would need adding in both.
- **The sender trusts nothing a member wrote** (hardened 2026-10-26): it
  honours at most the 4 newest devices per member (cron maintenance deletes
  the surplus and ex-members' records), re-derives chat mentions from the
  stored message text + member names (a request can't "mention" everyone),
  gives every push POST an 8 s timeout with `redirect:'manual'` and never
  reads more than 300 bytes of a refusal (one hung endpoint can't wedge a
  send or the cron), throttles the unauthenticated `/resubscribe` scan to
  once a minute (it reads both camps' push trees — an unthrottled loop could
  burn the Spark plan's download quota), and keeps push-service error text
  off its public status page.
- **Going live needs three things** (until then `PUSH_SERVICE_URL` in push.js
  is blank and the feature is dormant — the drawer says so): (1) the owner
  deploys the Worker (README); (2) set `PUSH_SERVICE_URL` to its exact URL AND
  add that origin to `connect-src` in index.html's CSP (otherwise the browser
  silently blocks it — the drawer's sender line will say "blocked"); (3)
  publish `database.rules.json` (push/pushSchedule/pushAlerts blocks).
- **Tests**: `tests/push.test.js` (+ `.senior`) pin the client helpers and
  sw.js's payload mapping; `tests/push-worker.test.js` loads the Worker module
  and checks encryption against an independent node:crypto decryption, VAPID,
  ID-token verification, recipient selection, cron window math, batching and
  the subrequest cap. `tests/push-e2e/` (opt-in) runs the real Worker in
  workerd against the RTDB emulator with ~30 mock phones — run it after any
  worker.js change.
- **`pushSendAlert(opts)`**: with no argument it is the director's composer; with
  `{ text, audience?, urgent? }` it is a DIRECT send for code that already confirmed with the
  person (the standings reveal's Buzz): no composer, no confirm, never throws, answers
  `{ ok, sent, queued, failed }` or `{ ok: false, error }`. Both go through
  `pushSendAlertNow`, one `/notify` of kind `alert`.
- **Honest limits** (owner accepted): iPhones must use the Home Screen app;
  iOS Focus modes can still silence alerts (web push can't be "time
  sensitive"); a phone that is off gets queued alerts when it comes back,
  within each alert's TTL.

## Auth, members & roles (the security boundary)

**Sign-in is real now (2026-07-25).** The old 4-digit PIN gate is gone — it
only ever locked the *page*, while the database answered anyone on the
internet (verified: an unauthenticated `curl` returned everything). Access is
now enforced by **Firebase Authentication + Realtime Database security
rules**; the client code only shapes the UI.

- **Everyone signs in** — Google is the primary button (`signInWithPopup`,
  never redirect — redirect needs cross-site storage Safari/Firefox block off
  the authDomain). Two optional backups live behind an "Alternative sign in"
  disclosure: an emailed link (`auth-email-link.js`) and a phone number +
  texted code (`auth-phone.js`). Both are free-plan capped (email ~5/day,
  phone ~10/day, project-wide) — each shows its cap up front and turns the
  quota error into a "use Google" message; there is deliberately no live
  "X remaining" counter (Firebase exposes none, and faking one would need a
  public counter poked into the locked DB). No public access to camp data —
  the one deliberate exception (R1, published 2026-11-02) is the standings
  reveal's `revealPublic` (anonymous READ only; see "R1").
- **Two roles, from the member record only** (never from anything on the
  device): `viewer` (counselors — read-only; deliberately can't touch their
  own team's points) and `editor` (directors/game leaders — edit scores AND
  manage the member list). `canEdit()` still gates ~28 call sites; its backing
  store swapped from localStorage to `memberRole`, set by `setMemberRole()` —
  and it is also false in an editor's SECOND tab of the same camp, which is
  view-only (see "Two tabs of one camp: one writer").
- **THE INVARIANT**: no database ref attaches until sign-in resolves AND the
  self-read of `campScoreboard/members/<identityKey>` confirms approval.
  `startSync()` (the only sanctioned entry to `initSync()`) is called *only*
  from `onMemberSnapshot`'s approved branch. Reason: the state listener's
  error callback treats a cancelled read as terminal (the SDK won't re-arm
  it), so an early attach under locked rules would kill sync for the session.
- **Identity is email OR phone.** `identityKey(user)` = `emailKey(user.email)`
  for Google/email accounts, else the phone number (E.164) for phone accounts;
  `identityLabel()` is the human form, `identityFromKey()` turns a stored key
  back to something displayable. The security rules gate on the same OR (see
  the ruleset in the plan / the runbook): `members/<emailKey>` for a verified
  email, `members/<phone_number>` for a phone account (phone accounts are
  inherently verified). A member key is an email (`contains('@')`) or a phone
  (`beginsWith('+')`); the Members UI auto-detects which from the typed value,
  and `phoneKey()` normalizes a typed number to the E.164 Firebase reports
  (US +1 default) so a hand-added phone member isn't silently locked out.
- **`emailKey(email)`** = `email.trim().toLowerCase().replaceAll('.', ',')`.
  RTDB forbids `.` in keys; the members list is keyed by this. It MUST mirror
  the rules' `.replace('.', ',')`, which in the rules language replaces ALL
  dots — so the client uses `replaceAll`, never JS `.replace` (which would
  only catch the first dot and lock out any multi-dot address, the owner's
  included). (The big-screen page used to duplicate this; it signs nobody in now.)
- **Member record**: `{ role, name?, teamId?, addedBy, addedAt }`
  (`memberRecord()`; `name`/`teamId` omitted, not null, when empty). Built at `campScoreboard/members`,
  editor-managed via More → **Who can sign in** (`renderMembers`). Your
  own row is disabled (another editor must change your access); the owner key
  is additionally immutable in the rules (the lockout anchor).
- **The owner row is read-only** (`OWNER_MEMBER_KEY` in app.js, the same literal
  as the rules' `$memberKey != '…'` in BOTH roots; `tests/owner-row.test.js`
  pins they agree). Every client write to that key is refused, so the Members
  drawer renders it with no access switches, no team select and no Remove — just
  "👑 Owner · managed in the Firebase console" — for the owner and for every
  other editor alike; the add form and the pending-convert flow refuse the key
  before writing. Any bulk member write (the seed roster today; the new-year
  wizard later) must skip that key and be per-row and best-effort, never folded
  into a larger atomic update, so one refused row can't take unrelated work with it.
- **Owner-only gating** (decision Q8, Step 14): the new-year setup, Edit the week
  here and the other sections' switches are the owner's alone — the rules say so
  (`OWNER` / `OWNERKEEP`); the client half is four helpers in app.js beside
  `OWNER_MEMBER_KEY`. `isOwner()` reads the SIGN-IN (`authUser`'s identity key ===
  `OWNER_MEMBER_KEY`, a confirmed editor, a verified address), never anything stored
  on the device — a forged hint or camps ledger changes nothing. `ownerName()` is the
  owner row's first name from the member directory (the row is rules-immutable, so no
  editor can rename it) and fails closed to "the owner". `ownerGate(what)` /
  `requireOwner(what)` give the refusal ("Only Patrick can …") BEFORE any write, and
  `ownerSays('turns on editing')` is the sentence every other director reads in place
  of the button. `applyOwnerClass()` (from `applyRoleClass`) sets `body.setup-owner`,
  which styles.css reads to show the `data-owner-only` controls. Any NEW owner-only
  action goes through these, and `tests/owner-only.test.js` is where it is pinned.
- **Live revocation**: the member self-read stays an `.on('value')` — a
  removal cancels it (→ not-approved kick + `clearLocalData()`), a role change
  fires a fresh snapshot (→ `setMemberRole` re-renders in place).
- **Pre-paint hint**: `campScoreboardAuthHint` (`'viewer'|'editor'`) caches
  the last confirmed role so a returning approved device paints instantly from
  local state while auth re-confirms; index.html's guard reads the same key.
  Convenience only — a forged hint shows an empty shell (rules refuse all
  data). Same literal lives in the index.html pre-paint guard.
  **A hinted role is PROVISIONAL** (Step 3): `boot()` calls
  `setMemberRole(hint, { provisional: true })`, which paints the shell but leaves
  `memberRoleConfirmed` false, so `standingsVisible()` (= `canEdit() &&
  memberRoleConfirmed`) stays false until the member record answers. A stale
  'editor' hint on a demoted director's phone therefore shows no standings from
  the cached week, and writes no secrecy seed on a guess (`ensureSecrecySeed`
  needs a confirmed director). Test seam: `setMemberRole(role)` with no opts is
  confirmed. A second hint,
  `campScoreboardTheme` (`'light'|'dark'`, an EXPLICIT choice only — Auto =
  key absent), is mirrored out of `state.theme` by `applyTheme()` so
  boot-guard.js can set `data-jelly-mode` before first paint; it is
  device-wide, not per camp (the guard runs before camps.js), and `boot()`'s
  `applyTheme` corrects a camp whose own choice differs. Auto sets no
  `body.dark-theme` class — the `@media` block in styles.css follows the OS
  live (`watchOsColorScheme` re-runs `applyTheme` so the `theme-color` meta
  follows too).
- **One-shot lifecycle**: voluntary sign-out and re-sign-in-after-teardown
  both end in `location.reload()` — no listener re-attachment machinery, since
  the terminal-fbRef design can't be safely restarted in place.
- **Sign-out** (`signOutAndClear`) wipes the camp data cached on the device
  (`clearLocalData`: STORAGE_KEY, day ranks, dismissed banners, the hint, the
  theme hint, the Calm motion switch and its last verdict
  (`campScoreboardCalmMotion` / `campScoreboardCalmLast`), the parked email, and
  any stranded last-year work `campScoreboardStranded` — the sign-out question
  names it first — and the builder's undo history `campSetupUndo`)
  plus IndexedDB photos (`clearPhotos`), then reloads. Theme and Calm motion are
  NOT preserved — the boot guards discard partial state, so they reset to Auto.
- **Rules are PUBLISHED and enforced** (2026-07-25). Verified after the flip:
  unauthenticated reads of state/config/members/changelog, a
  write probe, and a self-escalation attempt all return `Permission denied`.
  The owner key `patricksimpson,fx@gmail,com` is seeded editor and immutable
  from clients — the console Data tab is the only way to change it, and the
  permanent break-glass path.
- **The rules live in `database.rules.json` at the repo root** (added
  2026-07-26). The **console is still what enforces them** — there is no deploy
  pipeline — but the repo file is the reviewed, diffable source of truth.
  **Any console paste MUST be mirrored into that file in the same commit, and
  vice versa**, or the two silently drift. `tests/rules.test.js` pins the
  invariants (deny-all root, no cross-camp member lookups, `email_verified`
  everywhere, the `emailKey` transform matching the client, owner-key
  immutability in both roots, chat `byKey` bound to the sender, the four
  channel ids matching `CHAT_CHANNELS`, image fields pinned to `data:` URLs,
  `$other: false` on every named-child record, bounded timestamps). Those tests
  prove the FILE is coherent — they cannot see the console, so after every
  publish re-run the unauthenticated probes in the runbook.
  **Published and verified 2026-07-26**: the live ruleset is byte-identical to
  this file (read back and compared). Publishing no longer has to be a console
  paste — the rules REST endpoint takes a PUT with an OAuth token:
  `PUT https://camp-89cea-default-rtdb.firebaseio.com/.settings/rules.json`.
  From Google Cloud Shell, where gcloud is already signed in, that is two lines:
  `curl -s -o rules.json https://camp.patricksimpson.info/database.rules.json`
  then `curl -X PUT -H "Authorization: Bearer $(gcloud auth print-access-token)"
  --data-binary @rules.json "<that URL>"`. Back the live rules up first with the
  same URL and a GET.
  The shape is: per-child gates (rules cascade — nothing granted at the
  `campScoreboard` root), reads need membership, writes need
  `role === 'editor'`, `email_verified` required, changelog append-only +
  editor-read, presence per-child member-writable, `roster`/`contacts`
  owner key immutable. (`roster`/`contacts` used to be pre-gated here; removed
  2026-07-26 — member-readable with no validation and no feature behind them.)
  **Policy (reworded 2026-11-02, Step 10): a new path may be published ahead of
  its feature ONLY as part of a reviewed, additive, inert rules release, with
  read gates at least as strict as its eventual use, emulator compat proofs in
  both directions, and the unauthenticated probes. `roster`/`contacts`-style
  member-readable, unvalidated placeholders remain forbidden** (R1's `campers`
  is the proof of the pattern: editor-only read, validated down to the leaf).
- **R1 — the one rules release: PUBLISHED AND VERIFIED LIVE** (written in
  BUILD-PLAN Step 10, 2026-11-02; published by the owner at Step 11 the same
  night, read back byte-identical, every probe as expected — the checklist below
  has the results). `database.rules.json` now also
  carries, identical in both camps modulo the root name: P2's `setup`, `campers`
  (editor-only: minors' names), `teamPhotos`, `accessRequests`, `accessBlocked`,
  `restoreIndex`, `restoreBody`, `editorsHere`; the standings reveal's
  `revealPublic` + `revealFull` (each with a `real` and a `practice` child; no
  `reveal`, `revealPractice` or `revealScreens` node exists); and ADDITIVE
  amendments: `state/brackets4` (a branch, published ahead of Step 22 — the
  rules test allows it beside `SYNC_KEYS` until then), optional
  `state/teams/$i/{emoji,short,color,photoV}` (id/name/counselor stay
  unvalidated, so a v183 whole-array write still passes), `state/meta/{epoch,
  epochAt}` and `pushSchedule/{rev,src}`. No client shipped before Step 11 touches
  any of it. Against the pre-R1 ruleset (the Step 11 backup, i.e. after a
  rollback) every new node answers `Permission denied` and a new client degrades
  to "not available yet" (proved both directions below).
  - **Source of truth for the R1 blocks is `tests/rules-macros.js`**, written with
    the spec's macro names (`MEMBER`, `EDITOR`, `SELF`, `ANCHOR`, `PANCHOR`,
    `NOWKEEP`, `SELFKEEP`, `OWNER`, `OWNERKEEP` …) once for both camps. Edit it,
    run `node tests/rules-macros.js` (rewrites the R1 blocks in the JSON, leaves
    every existing block byte-for-byte), and `rules.test.js` fails if the file
    ever differs from the source — never hand-edit the R1 part of the JSON. The
    existing blocks stay hand-written. A later rules change still goes through
    the Appendix E runbook, and the repo file and the console change together.
  - **The ONE anonymous-read path in either camp: `<root>/revealPublic/.read:
    true`** (owner's answer of 2026-10-27: the big-screen page has no sign-in).
    `.read` cascades DOWN only, so `<root>`, `state`, `members`, `chat`,
    `revealFull` … still need membership; `rules.test.js` pins that this is the
    only `true` read and that every other read and write mentions `auth != null`;
    nothing under `$mode` re-grants one. It holds only what the camp already
    saw on the big screen (the ctl, and one group per revealed place), bounded
    by the rules' shape (g0–g5, t0–t5, names ≤ 30, no member key or counselor
    name field exists). `revealFull` (the complete order, editor-only) keeps an
    unrevealed place out of the public node; a group can't even be written
    before its place is shown, and a Start may not coexist with a `pub` (a
    client that writes only `ctl` can't carry the previous reveal's places under
    a fresh one). **Size-bounded** (the Spark download quota counts on it):
    `revealPublic`, its `pub`, `revealFull` and its `g` are each a BRANCH, so no
    scalar — a multi-megabyte string — can land anywhere an anonymous reader
    downloads (the review of Step 10 found all four open; `rules.test.js` sweeps
    the containers and `reveal.mjs` writes the scalars). **Recorded limit, not a
    promise:** the delete guard protects the NODE (a real reveal can't be erased
    before its 08:00 `until`), not its places — a director can still delete one
    shown place or `pub` mid-reveal, which is accepted because the same director
    can Start a replacement at any time, and a per-group guard would cost a ~1 KB
    expression plus a "new id" exception to cover only a client bug.
    `reveal.mjs` pins it, so adding the guard later is noticed. **KILL SWITCH,
    one line**: change `revealPublic/.read` from `true` to the `MEMBER`
    expression (`setup/.read` spells it out) and publish through the runbook;
    phones and remotes carry on, the big screen shows Waiting. Rules can't limit
    connections (Spark allows 100 at once): the TV page holds its connection
    only while visible (built, Step 23: `goOffline()` after 60 s hidden).
  - **Q8 owner-only acts** (no new role; the member record's shape is
    untouched): `setup/meta/on/<section>`, `setup/meta/{epoch,epochAt}` and
    `state/meta/{epoch,epochAt}`, every `setup/meta/wizard` leaf, and the
    `archive` / `pre-wizard` restore kinds compare the caller to ONE literal
    (`OWNER` = `SELF('patricksimpson,fx@gmail,com')`, the members-immutability
    literal; `rules.test.js` pins all three agree). Each sits on a LEAF
    (never a branch node, so nothing depends on how rules compare whole
    branches), and `OWNERKEEP` lets any whole-node write carry an existing value
    unchanged. A phone sign-in is never the owner. **Recorded, not assumed
    (emulator, 2026-11-02): a non-owner director's DELETE of `on/<s>`, an epoch
    key or the wizard claim is ALLOWED** — `.validate` is not evaluated for a
    delete and the node's `.write` is editor-only (setup-rebuild-spec §1.4 limit
    b). Pinned by `owner-only.mjs` so a change is noticed.
  - **Anchors, not a hope about ancestors.** Every block field carries
    `ANCHOR` (typical, dayBlocks) or `PANCHOR` (patches: a typical block that
    exists, on a day whose `typical` is true; the patch `teams` NODE is the
    same FOUR-parent expression, never five), and so does the team-flag LEAF
    `teams/$tid` (`ANCHOR_TID`, one `.parent()` deeper; `PANCHOR_TID` is FIVE
    parents from the leaf to `setup`) — its protection must not rest on the
    `teams` node's validate, an ancestor — so a field write into a deleted
    record is refused whether or not ancestor `.validate` runs. **Recorded
    (emulator, 2026-11-02): the emulator DOES evaluate ancestor `.validate` on a
    deeper write** — `campScoreboard/state/zzz-probe/x = 1` is DENIED by
    `state/$other:false` — which contradicts the "known hole" note below (observed
    on the live database). `ancestor-validate.mjs` proves the anchors alone
    refuse those writes with every record-level and `teams`-node validate
    stripped (team flags included), so R1 is
    correct under either answer. **Live answer (Step 11, 2026-11-02): the live
    database refuses that write too** — ancestor `.validate` IS evaluated there,
    and the old "known hole" note below is corrected.
  - **Behaviour is proven in the emulator** (opt-in; needs npm + Java; see
    `tests/emulator/README.md`; `npm run test:r1`): `compat-old-client`
    (26 operations of a v183–v196 client replayed on both rulesets, identical and
    accepted), `compat-new-client-old-rules` (new nodes refused cleanly before,
    accepted after; everyday traffic identical; a denied `setup` listener
    never hurts the `state` one), `setup` (the seeded week of BOTH camps built
    from camps.js, junior's Tue/Thu/Fri patches included; anchors, stamps, shapes),
    `restore`, `campers`, `access-requests`, `editors-here`, `teams-fields`,
    `brackets4`, `owner-only`, `reveal` (the public path's first proof: anonymous
    read, shape, compare-and-set races, delete-only-after-`until`, practice
    isolation, scalars refused), `reveal-client` (Step 23: the REAL client's
    writes and reads against these rules, below) and `ancestor-validate`: 267
    cases, all SAFE. They
    were mutation-checked: weakening any one clause (the ended guard, the shown
    clause, the delete guard, `revealFull` read, the seq/`ca` checks, the
    joinOpen, pin, owner, anchor, patch-anchor, team-flag-anchor, the four reveal
    BRANCH guards, the Start-without-`pub` clause, campers and photo clauses)
    turns a suite red. The seed they use is a fixture (`tests/emulator/camp-data.mjs`,
    rules of setup-rebuild-spec §10.2), until Step 15's real `buildSeed`.
  - **Size**: 160 KB as committed (131 KB minified) for both camps, above the
    spec's old ≈110 / 82 KB estimate (§8.6 now quotes these figures);
    `rules.test.js` budgets 192 KiB / 160 KiB against RTDB's documented 256 KiB
    limit. The longest single expression equals the longest already published
    (1,916 characters, chat's `.write`), so expression length is not the risk.
    **The live database accepted it at Step 11 (2026-11-02); no split was
    needed.** For a future, larger release: a PUT over the limit is refused
    and leaves the old rules live (nothing breaks). **A "too large" refusal means
    STOP and ask for the split** — R1a: state/teams/meta amendments, `setup`,
    restore points, `editorsHere`, the reveal blocks; R1b: `campers`,
    `teamPhotos`, `accessRequests`, `accessBlocked` (setup-rebuild-spec §8.6).
    The split is not pre-generated: at 160 KB against a 256 KiB limit it is
    unlikely to be needed, and a pre-built pair would be two more hashes and two
    more runbooks to keep true.
  - **R1 checklist — FILLED at Step 11, Mon Nov 2 2026, about 1:50–2:20 AM ET**
    (the file hash prefix to verify is in the Step 10 commit message — recompute
    with `sha256sum database.rules.json | cut -c1-8` after ANY edit). How the
    signed-in checks were run, should they ever need repeating without the owner
    at a keyboard: through the RTDB REST API with real ID tokens (`?auth=`), the
    owner's from an emailed sign-in link (Identity Toolkit `sendOobCode` +
    `signInWithEmailLink`, link read through the owner's Gmail with permission —
    it adds the email-link method to the owner's Auth user; Google sign-in is
    unaffected), and a temporary `patricksimpsonfx+camptest@gmail.com` account
    (same inbox) taken non-member → viewer → editor in junior only, then its
    member record removed and its Auth user deleted. Results:
    1. back up the live rules (runbook block 1); confirm the hash prefix:
       **done** (owner, Cloud Shell; `ccf2e5d3` matched).
    2. publish (block 2); the console accepted the size: **yes** (owner).
    3. read-back equals the file (block 3): **RULES MATCH** (owner).
    4. unauthenticated probes on both roots: all `Permission denied` EXCEPT
       `GET <root>/revealPublic`, which says `null` (and its PUT, plus
       `revealFull`, still denied): **as expected** — the owner ran all of
       block 3; an agent re-ran every read: 14 private paths per camp
       `Permission denied`, `revealPublic` `null` in both camps.
    5. discriminating checks (block 4): the owner reads `setup/meta` and
       `campers` ALLOWED on both roots; a test counselor `campers` DENIED,
       `setup` ALLOWED, a write to `editorsHere/<own key>/<id>` DENIED; a
       non-member test account denied everywhere; **another director**
       `set(false)` at `<root>/setup/meta/on/schedule` DENIED (as the owner it is
       allowed — `.remove()` it at once): **all as expected, 53/53** (agent,
       with the tokens above). Owner: `setup/meta` + `campers` ALLOWED on both
       roots (and state/config/members/chat still readable). Non-member: every
       private read DENIED on both roots, `revealPublic` readable, an
       `editorsHere` write DENIED. Counselor: state/config/members/chat/
       `setup/meta` ALLOWED; `campers`, `campers/t0`, `editorsHere`,
       `revealFull`, `restoreIndex`, `accessRequests`, `accessBlocked` DENIED;
       senior (no record there) DENIED; writes to `editorsHere`,
       `setup/meta/on/schedule`, `teamPhotos/t0` and its own `role` DENIED.
       Other director: reads incl. `campers`, `editorsHere`, `revealFull`
       ALLOWED; `set(false)` at `setup/meta/on/schedule` DENIED (the switch was
       absent, so it was a real change); a same-value write to the owner's
       member record DENIED; its own `editorsHere` row ALLOWED, a second write
       inside a second DENIED (throttle), deleting it ALLOWED; senior `campers`
       DENIED.
    6. the LIVE ancestor-validate probe: an editor writes
       `campScoreboard/state/zzz-probe/x = 1` — refused ⇒ ancestors are
       evaluated, accepted ⇒ the "known hole" below is right (delete the stray
       at once; old builds ignore unknown state keys): **REFUSED**
       (`PERMISSION_DENIED`, by the owner in the browser console and again by
       an agent) — ancestors ARE evaluated live, same as the emulator.
    7. the live regex check: the owner writes a 100,000-character PNG data URL
       to `<root>/teamPhotos/t0` and deletes it; if the live evaluator refuses
       it, `teamPhotos/data` falls back to the prefix check plus
       `!contains('"')`, `!contains('<')`, `!contains(' ')` (setup-rebuild-spec
       §8.2): **ACCEPTED** (agent, as the owner; stored, then deleted) — the
       full-charset regex stays, no fallback. Also REFUSED, as they should be:
       100,001 characters, an `https://` address, and a `"`-breakout string.
    8. a quick glance at the Firebase console's connections graph on the first
       real reveal night (Step 23).
- **Presence is keyed by member** (`presence/<memberKey>/<deviceId>`, changed
  2026-07-26). It used to be a flat caller-chosen UUID, which meant any member
  could overwrite or delete any OTHER member's row and mint unlimited rows; the
  rules now pin the subtree to the writer's own identity. The record is `{at}`
  and nothing else — it used to carry a self-declared `role` that NOTHING ever
  read (`presenceCount` is just a child count) and that a viewer could set to
  `editor`. `presenceDeviceCount()` deliberately IGNORES rows in the old flat
  shape: no client can delete one under the new rules, so counting them would
  double-count forever. Clear the `presence` node from the console once, right
  after pasting, to retire the stragglers.
- **Changelog attribution is pinned** (2026-07-26). `byKey` must equal the
  writer's authenticated identity, same expression chat uses, and the history
  drawer renders it through `historyAuthorName()` → `chatAuthorName()` rather
  than printing the free-text `by`. Pinning without the reader change would
  have been cosmetic: a forger would just keep writing `by: 'Patrick'`.
  `at` is deliberately still a client ISO string — `changelogTime()` normalizes
  both shapes for sorting, so a server-set numeric field can be added later
  without a migration, but converting it now would have meant a rules-first
  deploy on the one node whose failure mode is a silently-empty audit log.
- **`state` accepts exactly `SYNC_KEYS`, each of which must be a branch**
  (2026-07-26), and `config`'s five keys are type-pinned. Rules can't measure
  subtree size, so this targets the actual vector: a multi-megabyte STRING
  dropped at `state/results`, which would land in every device's localStorage.
  `configForSync()` strips unknown keys before every config push, so a stray
  from an imported backup can't bounce the whole `set()`. A deeper stray,
  `state/<unknown>/<child>`, is refused too. (An older note here called that a
  "known hole", on the theory that RTDB never evaluates an ancestor's
  `.validate`; the live database DOES — probed at Step 11, 2026-11-02:
  `state/zzz-probe/x = 1` is refused by `state/$other: false`, exactly as in the
  emulator.) R1 adds `brackets4` to the allowed keys ahead of its client,
  Step 22.
- **`config` IS sealed** (`$other: false`, 2026-07-26 — the live node was read
  and holds exactly the five keys). Safe even if a stray ever appears, because
  `pushConfig` is a whole-node `set()` of `configForSync()` output: the write
  never carries an unknown key, and being a `set()` it prunes any stray already
  in the node.
- **Rate limit (added 2026-07-26).** Every chat send is ONE atomic multi-path
  `update()` at the camp root carrying the content plus a
  `chatRate/<myKey>` stamp (`chatAtomicSend` in chat.js). The rules refuse a
  create whose previous stamp is under a second old, and require the same
  update to advance it — so skipping the stamp isn't an opt-out. The stamp is
  pinned to `now`, writable only by its owner, so it can't be backdated to
  clear the throttle. Deletes are never throttled (moderation must stay fast).
  `CHAT_MIN_SEND_MS` (1200ms) sits deliberately ABOVE the rules' 1000ms floor
  so a real person is stopped politely on the client and never sees a refusal.
  `chatAtomicSend` SERIALIZES sends: each starts a full `CHAT_MIN_SEND_MS`
  after the previous one was acknowledged (the rules measure the floor from
  the previous write's server time, so a caption typed during a photo upload,
  or an offline burst replayed on reconnect, used to be refused — words and
  all; reproduced against the emulator 2026-10-26). A refused send retries
  once with the stamp (same push id ⇒ no duplicate); the stamp-less attempt
  survives only as a last resort for a ruleset that predates chatRate.
  Behaviour is verified in `tests/emulator/` (opt-in, needs npm + Java).
- **Older note, now only partly true: rate limiting used to be absent.** Any
  member can write unlimited chat messages, photos and presence rows; the rules
  The chat paths are now throttled (above). `presence` still is NOT: it is
  member-writable with an unbounded key space. Members are a few dozen known,
  named, removable people; removal + 🧹 clear-channel remains the real remedy.
- **Also deliberate: every member can read the whole `members` list** — names,
  emails, phone numbers, roles, in both camps. `counselorName`, the mention
  targets and the Members drawer all need it. Splitting it (a member-readable
  `directory` of `{name, teamId}` beside an editor-only `members`) is the fix
  if that ever stops being acceptable.
- **The test seam**: `setMemberRole('editor'|'viewer'|null)` sets the role and
  `setMemberTeam('t2'|null)` the team, both with no Firebase — that's how
  `tests/*.test.js` drive editor-only and own-team paths (never by writing a
  localStorage role, which no longer exists).
- Playwright: seed `localStorage.campScoreboardAuthHint = 'editor'` to paint
  the app without a real sign-in; the popup itself can't run headless against
  Google, so the live sign-in check happens against the deployed site.

## The setup engine (setup-sync.js — Step 14, dark)

Specs: P2 §5, §6.4, §7. Nothing here changes what a counselor or a director
sees until a director acts: Step 15 ships Edit the week here (the owner's switch),
and until then every commit into a section is refused ("off").

- **The node** `<root>/setup` (`meta`, `days`, `typical`, `patches`, `dayBlocks`,
  `meals`, `verses`, `cleanup`, `electives`; rules published and verified, Step 11).
  Every member reads it (ONE read-only listener, `initSetupSync`, attached from
  `initSync` after approval); only editors write. `meta/on/<section>` is the
  section switch (absent / false = the built-in copy, true = the subtree is the
  whole truth) and is the OWNER's alone, as are `meta/epoch`, `epochAt`, `wizard`
  and `seeded` (`SETUP_OWNER_META`; a non-owner commit that touches one is refused
  with "Only Patrick can …" before any write — decided on the VALUES: every diff of the
  tree goes through `setupTreeDiff`, which turns the coarse `meta` op treeDiff emits for a
  camp with no `meta` yet into per-field `meta/<field>` leaves, so an empty node gates
  exactly like a seeded one and a push never carries `meta` beside `meta/edited/…`, an
  ancestor and descendant pair that `update()` throws on). `meta/edited/<section>` (who changed
  it, server time) is added at push and never part of the diffed tree.
- **The tree**: `setupTree` (live, normalized), `setupBase` (what the server last
  CONFIRMED, canonical, persisted), `setupLast` (what it will hold once in-flight
  pushes land). Diffs and merges run on `setupCanon` forms (empties pruned, keys
  sorted, and minus the in-memory fillers: the seven default day records and
  `meta/edited`), so healing can never be pushed as an edit nobody made.
  `normalizeSetup` is structure-only and never rewrites a stored value; an orphan
  patch (its typical block is gone) stays in the data and readers use
  `setupLivePatches(dk)` — the spec's in-memory delete would put an invented
  delete into the next diff. `SETUP_DEPTHS` says how deep `treeDiff` recurses per
  shape; `setupApplyOps` is applyOpsSafe for this tree (the rules' anchors: a field
  needs its record, a patch needs its typical block AND a day that follows the
  typical day).
- **Write path**: `commitSetup(mutate, {label, undo, quiet, expect, turningOn})`
  edits a copy, diffs, refuses (`readonly`, `loading`, `cancelled`, `removed`,
  `off`, `owner`) before anything changes, records the undo entry (domain `setup`
  in `UNDO_DOMAINS`), applies, persists IMMEDIATELY and pushes after 300 ms as one
  multi-path `update()` plus the section stamps. Never push before the first pull
  (`setupReady`). A bare focus-and-blur writes nothing (`setupFocusIn/Out`; a
  commit of an unchanged value is a no-op with no stamp and no undo). **No
  automatic patch stripping**: only a mutate removes a patch field.
- **Snapshots**: the first one is a three-way merge per path against the persisted
  base (same path changed on both sides keeps the server's, mine goes to the
  clash list with a synthetic undo entry; a kept op whose record the server
  deleted goes to Put it back instead of into a refusal; > 36 h unconfirmed asks;
  a moved `meta/epoch` strands unconfirmed paths as a download; an empty node on a
  phone that had content is a wipe — adopt empty, keep the copy only as a
  download, never re-seed). The engine NEVER seeds. Later ones adopt only with
  nothing in flight (otherwise `setupRefetchOwed`, paid by `idleRetryTick` with
  `once()`, never a replay), rebase unsent edits on top, and keep the live object
  of every unchanged subtree (`setupKeepRefs`; an echo of my own write repaints
  nothing). `setupClashes` (clashes + Put-it-back notes, ≤ 30) is persisted.
- **Refusals**: on `PERMISSION_DENIED` only, a batch is re-sent path by path
  (`bisectSetupBatch`); a path refused alone is parked in `setupQuarantine`
  (persisted, treated as sent) with Retry / Discard; every path refused with none
  explained by a vanished record means the rules for setup/* aren't published
  (`setupWriteRefused`: editing off, the sync line says so). A refused READ sets
  `setupDenied` and degrades the setup engine only — never `fbRef` / `syncDenied`.
  The header's red bar (`updateSyncAlert`) shows a parked setup path when no score
  is parked (`setupQuarantineBarHtml`, `[data-setup-quarantine]`).
- **The cache** is `lsKey('campScoreboardSetupV1')` = `{v, tree, base, baseAt,
  epoch, clashes, quarantine}` in ONE setItem, written only by `persistSetup()` —
  a no-op unless this tab owns the cache (a view-only second tab never writes;
  owed while the election is pending, paid by `decideTabWriter` →
  `setupOnTabDecided`). Read at load by `setupLoadCache()` (the last line of the
  file, so nothing it uses is a TDZ read: `boot-cache.test.js`). Wiped by
  `clearLocalData` with the restore-point outbox.
- **Accounting** (P2 §6.5): `pendingWritesTotal()` adds `setupPending`; `editorMidEntry`
  counts the 300 ms timer and a held push (`tabHeldSetup`); `hasUnsyncedWork`,
  `hasUnconfirmedLocalWork` (unconfirmed paths, a parked refusal, a restore point waiting in the outbox), `flushPendingPush`
  and `idleRetryTick` all call in, typeof-guarded.
- **Seams for the UI** (setup-ui.js, the rest of Step 14): `onSetupEvent(fn)`
  (`'tree' | 'commit' | 'sync' | 'clashes'`), `setupSyncLine()` →
  `{tone: saved|saving|offline|error|off, text, act}`, `setupEditedBy(section)`,
  `setupEditorName(key)` (fails closed to "Another director"), `setupClashList()` /
  `setupUseMine` / `setupPutBack` / `setupDismissClash`, `retrySetupQuarantine` /
  `discardSetupQuarantine`, `setupOn(section)` / `setupSeeded()` /
  `setupSchemaTooNew()`.
- **Restore points** (P2 §7.2; same file): a SHARED, durable copy of the week.
  `<root>/restoreBody/<rid>` is ONE JSON string (≤ 900,000 chars, so RTDB can't
  prune or array-coerce it) and `<root>/restoreIndex/<rid>` is the list row
  `{at, byKey, kind, label, note?, bytes, hash, epoch?, pinned?}`, both written in
  ONE multi-path update at the camp root (`restoreSave`); `at` is the server's
  clock and `byKey` the writer's identity, as the rules require. Never listened
  to — `restoreList()` / `restoreRead()` are `once()`. `restoreBodyObject()` is
  `{app:'campScoreboardV3', camp, at, epoch, appVersion, config, setup (minus the
  owner-only meta and the stamps), sectionsOn, state}` and EXCLUDES campers,
  members, chat, presence, push, photos and every device-local baseline;
  `picSetup` travels as modes only, never words. (`sectionsOn` is one field beyond
  the spec: "a section that wasn't on in the point isn't offered" needs it, and
  `meta/on` is deliberately not in the body.) `restoreHash` = `fnv1a` (app.js, 8
  hex) of the body minus `at` / `appVersion`. Kinds: `auto | manual | pre-seed |
  pre-delete | pre-import | pre-restore | pre-wizard | archive`; `archive` and
  `pre-wizard` are the owner's (client refuses first; rules too) and are
  undeletable along with every pinned point (`restoreDeletable`). Waiting at most
  4 s (`rpWaitMs`): a point that can't be written goes to the outbox
  (`lsKey('campSetupRpOutbox')`, ≤ 3, newest kept, sent once on reconnect — a rid
  already on the server is just dropped), and the action proceeds; `requireOnline`
  (a restore, the wizard, Edit the week here's first press) refuses instead.
  `commitSetup` takes an `auto` point before the first commit after 20 idle
  minutes ("Before Jenn's edits, 3:05 PM"; one per 5 min per device; the body is
  captured BEFORE the edit applies). Retention (`restoreRetain`, creating device,
  one update): newest 40 unpinned auto / pre-* (never pre-wizard, archives,
  pinned); unpinned manual capped at 20 ("manual-full": the UI asks to delete
  one first). `restorePin` is write-once.
- **Putting a point back** (`restorePreview(body)` then `restoreApply(body, picks,
  {label, confirmed})`): preconditions first (`restorePreflight`: a director's
  writer tab, online, nothing in flight or unconfirmed in ANY engine, then
  `once()` re-reads of state, config and setup so the preview and the
  `pre-restore` point come from the SERVER); a `pre-restore` point is written
  online before anything changes; each chosen section (`schedule`, `games`,
  `teams`, `notice`, `scores`) goes through its own engine as a diff (setup: one
  `commitSetup` with `undo:false`; games: `configEdit`; teams: `stateEdit`).
  A restore NEVER writes `meta/on`, `epoch`, `epochAt`, `wizard`, `seeded` or
  `edited`; a setup section is offered only if it was on in the point AND is on
  now. **A Games restore keeps every game that has a result, bracket (either
  kind), draft, live match or clock** and `pruneOrphanedGameData` runs only when
  Scores is ticked, which needs `opts.confirmed` (the sheet's hold-to-confirm,
  decision Q23).
- **Backups v3** (§7.4): `backupJSON()` (settings.js) is `backupObject()` — the
  restore-point body plus `exportedAt`, so it includes camp, setup, notice, meta,
  clocks and brackets4 and still never campers. `tryImport(text, {copyFromOtherCamp})`
  accepts v2 (flat) as before, refuses another camp's backup by name unless the
  copy tick is set (then Schedule, Games and Teams only, and a roster that
  doesn't fit is left out) — a `camp` naming another camp refuses whatever the
  file's `app` flag says, and a v3 file with no readable camp is refused outright;
  `restoreParseBody` also requires `config.games` / `config.days` to be arrays —
  shape-checks teams, restores announcements (dropped
  before) and the notice board, merges `picSetup` modes without touching the
  words on the device, never applies `meta` (the epoch), and writes a
  `pre-import` point first (fire-and-forget).
- **"Also here"** (P2 §6.7): `<root>/editorsHere/<memberKey>/<deviceId> = {at, v,
  where?}` — editor-read, key-pinned to the writer, `at === now` and a 1 s floor
  per row (the client's `ehMinMs` is 1.2 s: quick screen changes coalesce into ONE
  trailing write of the last place, never a refusal). Presence is untouched and
  stays `{at}`. `where` is the short vocabulary `[a-z0-9:_-]{1,60}` (`hub`,
  `schedule:tue`, `item:tue:<bid>`, `rain:<dk>`, `game:<gid>`, `team:<tid>`,
  `people`, …) and is REMOVED, never blanked, on leaving. **Dark by the owner's
  rule**: a row exists only while Set up the week is open on a director's device —
  `editorsHereStart(where)` on open (writes the row, registers
  `onDisconnect().remove()`, attaches the editor-only listener),
  `editorsHereMove(where)` on every screen or sheet change, `editorsHereStop()` on
  close; `editorsHereOnConnect()` (from app.js's `.info/connected` handler, beside
  `registerPresence`) re-registers on every reconnect, ATTACHES the listener when
  the builder is open (a reload with it open starts it before sign-in, when nothing
  can attach) and does nothing with the builder closed. `ehMayWrite` needs a CONFIRMED
  role, so a hinted editor neither listens nor writes before approval. A write the
  rules refuse (the server stamps landed under a second apart) is retried once with
  the latest place, then swallowed. `EDITORS_HERE_EAGER` (false) is the one switch for the spec's
  row-on-every-connect behaviour, for the step that turns the setup screens on.
  Viewers, a view-only second tab and a demoted director never write or listen
  (demotion removes the row: `setupOnRoleChange` → `editorsHereOnRoleChange`); a
  refused write or listener is swallowed and degrades only this feature. Reading:
  `editorsHereList()` (names via `setupEditorName`, fail-closed "Another director";
  only keys whose directory role is editor; my own row skipped, my other phone is
  "You (another device)"), `editorsHereHeader()` (up to three initials, "Jenn is
  also here"), `editorsHereOn(where)` ("Jenn is also editing Tuesday — changes merge
  field by field" / "Jenn is editing this item too"), `editorsHereWhereWords`.
- **Devices** (the hub's ⋯): `devicesList()` joins app.js's presence tree
  (`presenceRows`, now kept by the presence listener) with `editorsHere` by DEVICE ID,
  keeps rows from the last 10 minutes, only members whose directory role is editor,
  groups by build `v`, and says "N director devices are on an older version — they
  update when reopened". A hint, never a gate. Because rows exist only with the
  builder open, a device with no row is "build unknown", not "older" (the spec's
  inference needs `EDITORS_HERE_EAGER`).
- **Step 15 adds** the schedule maths, the seed, the plans the accessors read and
  Put games on the schedule to the END of this file — see the next section.

## Schedule as data: the seed, the plans, A2 (setup-sync.js §5 — Step 15, switch unpressed)

Specs: P2 §5.4–5.6, §9, §10. **Nothing here changes what anyone sees until the owner
presses Edit the week here** (`meta/on/schedule`, section 5's A1, built in the same
step): while the switch is off every accessor returns the camps.js constant itself.
Both camps, junior and senior, run all of it.

- **`resolveDay(tree, dow)`** is the ONE function every schedule consumer goes through:
  the typical day (when `days/<dk>/typical`) with the day's patches laid over it, minus
  what is `off`, plus the day's `dayBlocks`, sorted by `(start, ord, id)` — a total
  order, so every device agrees on which block Happening Now finds first. Returns rich
  blocks with `.skipped` (cancelled for the day, "Bring back") and `.broken` (a partial
  record from a two-director race; readers skip it, the hub lists it). `validBlock`,
  `renderLabel(b)` (a block with `teams` ends ` — 🦃 Turkey, 🍁 Maples & …`, built from
  `teamEmoji` / `teamShort`), `legacyBlock(b)` (exactly today's `DAY_SCHEDULE` entry,
  same fields in the same order). `setupRichBlock(b)` is what `planForDow` returns:
  `{id, dk, start, end, label (rendered), base (as stored), emoji, type, slot?, meal?,
  noTime?, teams?, alertKey, origin: typical|changed|oneoff|own, overlapOk?, ord}`.
- **`buildSeed(camp, sections)`** is PURE and deterministic (the camps.js constants only,
  never the directory or device state; `meta.seeded` is added at write time). Monday is
  the typical day (`ord` = 10 × position); Tuesday–Friday become patches (a different
  tail, emoji or team group), `{off:true}` patches (a typical item that day lacks) and
  one-offs in `dayBlocks` (an item typical lacks; its `ord` sits between its neighbours,
  so Tue/Thu movie night still sorts before "Prepare for bed" and keeps winning Happening
  Now); Sunday, Saturday and any day with no weekday blocks are own days. Ids are
  `b-<slug of the head label, ≤ 24>-<start>` (own days `b-<dk>-…`; a collision gets
  `-2`), so a published id `<dk>-<id>` is ≤ 40 characters (longest 39). `alertKey` =
  `pushBlockKey(label)` for every block — **today's keys, never recomputed on a rename**,
  so every phone's subscriptions survive. `meal` = `legacyMealOf(label)` lower-cased
  (tagged now, read from step 19). A label tail that `joinTeams` reproduces EXACTLY
  becomes `teams` (junior's morning meeting, group B on Tue/Thu/Sat); any other tail
  stays label text. Measured and pinned: junior 26 typical items, patches Tue 2 / Wed 1
  / Thu 2 / Fri 8 (all `off`), one-offs Sun 9 / Tue 1 / Thu 1 / Fri 10 / Sat 5, ~9.6 KB;
  senior 20 typical, no patches, Sun 2 / Sat 4, ~4.6 KB. `camps.js` gained
  `placeholderDays` (senior `[0, 6]`: the stub bookends are seeded `placeholder: true`,
  so the hub says "sample day", never a warning) and `gameBlockOverrides` (`{}` in both).
  `tests/fixtures-setup-seed-{junior,senior}.json` FREEZE the seeded ids and alert keys:
  a change to the slug rule can never silently re-key a live camp — **never edit them**.
- **The plans** (`setupLivePlans()`, memoized on the tree's identity AND `setupRev`, so a
  test or restore that swaps the tree whole still rebuilds; the same objects until the
  tree changes — render-stability): rich `[7]`, legacy `[7]`, `week`, `days`.
  `SETUP_RICH_OF` (a WeakMap) maps each legacy block an accessor handed out back to its
  rich twin, which is how `blockKey(b)` / `blockPushId(b, dow, i)` / `gamesForBlock` know
  a block's id and alert key without the legacy shape carrying any extra field (so
  `scheduleForDow(d)` deep-equals `DAY_SCHEDULE[d]`). A COPY of a block (the meal
  decorator's) is not in the map and falls back to the printed rules. While the switch is
  off `planForDow` answers from `setupBuiltInPlans()` — the built-in week resolved the
  same way, cached once — so a preview has real block ids.
- **The accessors** (app.js SEAM block; every one typeof-guards setup-sync.js): switch =
  `scheduleIsShared()` = `setupScheduleLive()` = `meta/on/schedule === true` AND
  `meta/schema` ≤ 1 (a newer build's data is never guessed at: built-in copy).
  `scheduleForDow`, `scheduleWeek`, `weekDays` (the day strip: dow, short, full, tag
  from `setup/days`), `planForDow`, `blockKey` / `blockPushId` (rich: the stored
  `alertKey` and `<dk>-<id>`), `gamesForBlock` (on: games whose `blockId` is the block,
  in `ord` order, ties by catalog position, any kind of block; off: the long-standing
  Morning/Evening rule, **links ignored** — exactly today), `gamesForDay(dow)` →
  `[{block, games}]`, `unscheduledGames(dow)` (games on that weekday's competition days
  listed under no block — in either mode; built-in senior shows its 10 Afternoon games
  and junior Team Skits here, which is the bug A2 fixes; the schedule sheet and the
  per-day `.ics` ask `gamesForBlock` for EVERY block now, not only `type: 'games'` ones —
  built-in that is the same answer, edited here it lists Team Skits under Friday 7:00 PM
  and a game the rain plan moved onto lunch under lunch. Measured in Chromium against the
  live v198 build with the seed switched on: junior's ONLY visible difference is the
  Team Skits chip (and its `.ics` line), the 10,080-minute banner digest is identical
  (`67c9222c` junior, `7604588f` senior); senior's Afternoon games move to their own
  blocks and stop being shown under the 3:00 and 4:50 PM blocks as the Evening pair), `campWeek()` →
  `{start, phase}`: `setup/meta/weekStart` (ALWAYS read, even with every section off)
  else the date phone alerts were set up with (`pushKnownWeekStart()`), a real SUNDAY
  or null; `phase` is `unset | before | during | after` and `during` is the Saturday
  before through the Sunday after (what the A1 / new-year freeze refuses inside).
- **A2, Put games on the schedule** (`setupGameAttachments(config, resolve, camp)` is
  pure; `setupApplyGameAttachments(config, ops)`; `putGamesOnSchedule()` is the button's
  function): touches ONLY games with no `blockId` or one that does not resolve on the
  game's day — never an attached game's link or `ord`, so rain-plan moves and hand
  attachments survive any number of off/on cycles. First rule that applies, on the game's
  day: the camp's `gameBlockOverrides`; a timed block whose head label IS the game's
  name; a `games` block whose head label contains it (curly quotes read as straight);
  by session — Morning: the first games block before 12:00, Afternoon: the games blocks
  12:00–4:59 PM naming the game's first word (else the first), Evening: the first games
  block from 5:00 PM; otherwise unplaced (`why: 'day' | 'rule'`, never guessed). `ord` goes
  after what the block already holds, in catalog order, from 10. `putGamesOnSchedule`
  mutates `state.config.games` and calls `saveConfig()` — the config engine sends ONE
  transaction (`games/<id>/blockId`, `games/<id>/ord`); refused (`off`, `readonly`,
  `loading`) before anything changes. **Oracle** (pinned, game by game): junior 22/22
  (Morning → 10:00 Team competitions, Evening → 18:00 Evening competition, Team Skits →
  Fri 19:00 Team Skits); senior 25/25 (9:45 / 3:00 PM Team competitions, Legacy Game →
  16:50, Hot Seat and Let's Make a Deal → 18:50). **A game created in the classic builder
  (Add game, ⚡ quick game) while the schedule is edited here is placed at once**:
  `setupAttachNewGame(config, game)` runs A2's rules for that ONE game inside the config
  edit that adds it (`saveGameDraft`), so it shows on its natural block, in the calendar
  file and on counselors' phones; a duplicate keeps its original's link (the copy is a clone).
  Restore defaults and an imported backup run the whole of A2 (`putGamesOnSchedule()`) after
  they replace the catalog — a game with no link is otherwise listed on no block. It never
  re-places a game whose link still resolves; a game taken off the schedule on purpose
  (`blockId` removed) is untouched by a new game, and `gamesForBlock` deliberately has NO
  fallback for a missing link (that would resurrect it). The hub's Games row warns "N games
  aren't on the schedule" from `unscheduledGames()` (`hubUnscheduledGames`) while the schedule
  is edited here.
- **A1, Edit the week here** (`setupTurnOn(sections, opts)`) and **Use the original week
  again** (`setupUseOriginal(sections)`), both OWNER-ONLY (`isOwner()`, from the sign-in;
  the rules refuse anyone else too). The switch is `meta/on/<section>` with three states:
  absent = never turned on, `false` = turned off (data kept), `true` = the subtree is the
  whole truth. `mergeSeed(cur, seed, sections, info)` is the pure heart: never turned on →
  the seeded subtree AND `on: true`; turned off before → ONLY `on: true` (the data, edited
  or deliberately empty, returns exactly as it was; `meta.seeded` is not re-stamped); already
  on → nothing; it sets `meta.schema`, stamps `meta.seeded = {at, byKey, from:
  'camps.js@v<APP_VERSION>'}` only when it seeded, copies every other field unchanged
  (`weekStart`, `meta/edited` stamps, a live `meta/wizard` claim — the rules accept an
  unchanged stamp, which is what lets A1 run after anyone has edited anything), returns
  `undefined` (the transaction aborts: a second press, or the owner's other device, writes
  nothing) when nothing changes, and never touches a node a newer schema wrote. `setupTurnOn`
  says every refusal BEFORE it writes: `owner` (+`message`), `none`, `loading`, `denied`,
  `schema`, `tab` (a view-only second tab), `offline`, `already`, `camp-week` (the freeze:
  `campWeek().phase === 'during'`, or no date and the owner answered "yes, a camp week is
  running"), `ask-camp-week` (no date set: the caller must ask "Is a camp week running right
  now?" and pass `{campRunning}`; `{overrideCampWeek}` is the owner's "I know a camp week is
  running" tick), `restore-point`, `failed`, `refused`. Then, in order: a `pre-seed` restore
  point (REQUIRED, online — only when something is seeded for the first time), ONE
  `setupRef.transaction(mergeSeed)`, a re-read of its own snapshot at once
  (`setupIdleTick`: it was turned away while the write was in flight), A2 against the
  committed tree as one config edit (skipped, for the hub to offer later, when the catalog
  is not editable yet). Phone alerts follow on their own: push.js's setup-event hook
  republishes when the switch moves (see "The published schedule").
  `setupUseOriginal` is one ordinary `commitSetup` writing `meta/on/<s>: false` (no undo
  entry: the other button is the undo). The buttons are `HUB_DOOR_ACTIONS.original`
  (`setupEditTheWeek`: a plain question first, "Is a camp week running right now?" when no
  date is set, the freeze as a question the owner can override in words, every refusal a
  sentence — `TURNON_WHY`) and `SETUP_OWNER_ACTIONS.original` (`setupUseOriginalFlow`, greyed
  with "Already using the original week." while off). **Not built here:** team branding (`short` / `emoji` written to `state.teams`, A1 step 3)
  waits for step 25, the first reader of those fields. Nothing presses the switch in this
  step: both camps stay on the built-in week until the owner does. **The seed marks the
  printed week's own overlaps `overlapOk`** (junior's Tue and Thu cabin movie nights run over
  Prepare for bed and the devotional: the longer item of each overlapping pair), so a freshly
  seeded camp warns about nothing; the frozen id fixtures are unaffected (they pin ids and
  alert keys only).
- **The published schedule** (push.js; the whole push layer is still dormant while
  `PUSH_SERVICE_URL` is blank): `pushPublishSchedule(weekStart)` is ONE transaction on
  `pushSchedule` — `{weekStart, at, by, blocks, rev: (cur.rev||0)+1, src}`, where
  `src = fnv1a(pushStableJson({weekStart, blocks}))` (8 hex, what the rules pin) — and
  writes NOTHING when `cur` already holds that content (identical content is already
  published; `rev` counts real changes only, monotonic by transaction, so racing editors
  write once). Built-in camps publish as before (`d<dow>-<start>-<position>`); a camp
  edited here publishes `<dk>-<block id>` with each block's own `alertKey`, ids that stay
  put when a block is moved or renamed (a phone subscribed to "lunch" keeps getting it).
  The week is `campWeek().start` (setup date, else the drawer's); with no date nothing is
  published. Who publishes: the author's device 5 s after its setup commit
  (`pushScheduleSoon`, from `onSetupEvent('commit')`), every editor device when the switch
  itself moves (a `'tree'` event with `scheduleIsShared()` changed — the ids change format;
  identical content aborts for all but the first), and any editor on load when the
  published `src` is not its own (`pushMaybeRepublishSchedule`: a record with no `src`, from
  an older build, never equals one, so it is put right — catch-up, never alerts).
  `pushRepublishSchedule({force})` is the hub's Publish-now seam. `pushMigrateWeekStart`
  copies the date alerts were set up with into `setup/meta/weekStart` once (retried on
  setup events), and the drawer's Save now writes the setup date before publishing.
  The schedule-change ALERT (`/notify` kind `schedule`, the baseline reset on a switch)
  is the Worker's step 26 (S9) and is not here.
- **The whole-week calendar file** (app.js next to `buildDayIcs`, P2 §12.4):
  `buildWeekIcs({dows, fromDow, now})` is null with no camp dates (`campWeek().start`); else
  one VEVENT per TIMED block of `planForDow` for every day of `weekDays()` — dates are
  `weekStart + dow` (never "this week"), times are wall-clock in `TZID=America/New_York`
  with the shared `ICS_VTIMEZONE` (so a DST change can't shift anything). UID =
  `<camp>-<week>-<dk>-<block id>@camp.patricksimpson.info` once the schedule is edited
  here (stable under a rename and a move: a calendar that honours UID + SEQUENCE updates
  the event in place), `<camp>-<week>-<dk>-<position>-<start>` for the built-in copy.
  `SEQUENCE` = minutes from 180 days before the week to the last schedule edit
  (`setupEditedAt('schedule')`, 0 if never), `LAST-MODIFIED` that moment. DESCRIPTION =
  `Games: …` (`gamesForBlock`), `On the menu: …`, `Cleanup: …` for a meal; header has
  `METHOD:PUBLISH`, `X-WR-CALNAME:<camp> · Jul 18–24\, 2027` (the comma is escaped:
  it is a TEXT value), `X-WR-TIMEZONE` and an `X-WR-CALDESC` that says it is a snapshot
  and to delete the old events first. `weekIcsFileName` =
  `junior-camp-2027-07-18-saved-0720-0940.ics`. **With camp dates set, the per-day button
  is the same builder asked for one day** (same UIDs, so importing a day then the week
  never duplicates); with none it is the original per-day file, byte for byte.
  The sheet's entry is `renderWeekIcsEntry()` (a "whole week" button, "Only the days from
  today" from the camp's Sunday until its last Saturday — never on the Sunday itself, which
  is the whole week, and never on the Saturday BEFORE camp, which `campWeek().phase`
  already calls "during" (the freeze window) — the snapshot note in plain words): **with no
  camp dates it renders NOTHING, on the very line it replaced**, so an untouched camp's
  schedule sheet is byte for byte what it was — the spec's
  disabled "Ask a director to set the camp dates" is a one-line change there when the
  Camp week screen is how a director sets them.
- **The real seed against the real rules**: `tests/emulator/camp-data.mjs`'s `buildSeed(id)` is
  now `setup-sync.js`'s `buildSeed` run through the unit-test harness (the hand-written copy
  it replaced is kept as `buildSeedFixture`), and the twelve R1 emulator suites were re-run
  against it for BOTH camps — 27 + 40 + 33 + 14 + 11 + 16 + 13 + 16 + 3 + 22 + 45 + 9 cases,
  all SAFE, including the owner's whole-`setup` transaction (`owner-only.mjs`) and
  every pinned id / date / range (`setup.mjs`). Re-run them (README there) after any change
  to the seed or to `mergeSeed`.
- **The seeded pass** (`tests/run.js`, `makeContext({camp, seeded: true})`): the seed,
  round-tripped through RTDB's canonical form, is already `setupTree` with the switch on
  and the catalog's games are linked (A2). The week / push / chat / ics / tabs / frame /
  shell / home / render-stability / game-view / secrecy / motion / overlays / boot-cache /
  backup tests re-run against it, junior and (where the file has a `.senior` twin)
  senior — `SEEDED=all` probes every file (only the off-mode pins — `accessors`,
  `checklist`, `owner-only`, `setup-ui` — assume an empty tree), `SEEDED=off` skips the
  pass. A redesign test joins `SEEDED_FILES` when it ships (steps 17 and 18: `now-model`,
  `games-tab`).
- **Tests**: `seed.test.js` (+ `.senior`: round trip of all seven days through the fake
  RTDB, the measured shape, the rules' record shapes, the frozen id fixtures, the
  10,080-minute banner fuzz identical before and after seeding, the alert publisher's
  keys and catalog identical, a renamed + moved block keeping its published id and
  key; and A1 against the fake database with all three engines past their first snapshot:
  one pre-seed point THEN one transaction, ONE config transaction for A2, no phantom diff
  afterwards, twice writes once, owner-only, every refusal before a write, the camp-week
  freeze, stamps / a wizard claim carried, off-then-on keeps the edit and the hand
  attachment), `push-publisher.test.js` (+ `.senior`: src stability, rev 1 → 2 → 3, identical
  content writes nothing, two editors at once write once, the rules' record shape,
  catch-up from an older build's record, dormant / counselor / no-date gates, the author
  and switch-moved triggers, the week-date migration, the drawer's Save),
  `games-blocks.test.js` (+ `.senior`: the A2 oracle, never-touches-attached,
  re-homing, unplaced, each rule, exactly-once listing, `putGamesOnSchedule`).

## Meals, verses, cleanup, electives as data (setup-sync.js §10 — Step 19, switches unpressed)

Specs: P2 §5.2–5.3, §9.2, §10.2, §11.10–11.13. **Nothing here changes what anyone sees until the
owner turns a section on** (`meta/on/<section>`; Step 20 presses them): while a section is off,
its accessors return the camps.js constant itself, and every mutator is refused `off`. Both camps
run all of it; electives only where `CAMP.features.electives` (junior).

- **The seed** (`buildSeed(camp, sections)`): a plain `buildSeed(CAMP)` is still the schedule
  alone (`SETUP_SEED_SECTIONS`, the default every test and A1 uses); the four sections are asked
  for by name. `meals/<dk>/<meal>` `{dish ≤ 80, emoji?}` from `MEALS` (junior 16 dishes, Sunday
  supper included); `verses/theme` and `verses/days/<dk>` from the constants (`video` only when
  `safeVideoUrl` passes and ≤ 300); `cleanup/<dk>/<meal>/<tid>: true` from the printed rota
  (Friday's pairs are two teams); `electives/stations/st-<slug ≤ 30>` `{name, emoji}` — every
  station in `STATION_EMOJI`, used or not — and `electives/slots/<dk>/s<n>/<st>` `{ord: 10×(j+1),
  people: {'n-<slug>': {name, ord}}}` (every printed person is a TYPED name; a director links one
  to a member later). Senior seeds its verses only (no menu, rota or electives data): the
  switches are still asked for by name, and a section with nothing to seed is simply switched on
  empty (absence means empty). `mergeSeed` is generic and unchanged; `setupTurnOn(sections)` and
  `setupUseOriginal(sections)` now take any of the five (electives filtered out where the camp has
  none), and A2 (the games' links) runs only when the schedule is among the sections turned on.
- **`setupSectionLive(s)`** = switch on AND schema ≤ 1 (`setupScheduleLive` is its schedule case);
  app.js's `sectionIsShared(s)` wraps it behind a typeof guard.
- **The readers** (pure over a tree: `setupMealRecord`, `setupCleanupIds`, `setupVerseDay`,
  `setupElectiveRows`, …) feed one memo, `setupSecs()`, keyed on the tree, `setupRev` AND the member
  directory (an elective person's name follows a rename), so an accessor hands back the same
  objects until something changes (render-stability). What a database holds is laundered on the way
  out: a meal emoji through `safeEmoji`, a verse video through `safeVideoUrl` (http and
  `javascript:` dropped, the verse stays), a cleanup id that is not one of the camp's own teams
  dropped, an elective name through `respellCounselorText` (one spelling per counselor).
- **Accessors, "on" half**: `mealFor` (`setup.meals`); `blockMeal(b)` — the meal a block is,
  from its **Meal tag** once the schedule is edited here (`setupRichOf(b).meal`), else read off the
  label as before (`legacyMealOf`); `mealInfo` follows the tag the same way, so a tagged "Supper
  and free time" shows its dish; `mealCleanupNote(dow, label, meal)` / `icsCleanupText` take the tag
  as an optional third argument; `mealStart` and `electiveSlotStart` read the start of that day's
  tagged / Elective item once the SCHEDULE is edited here (a rain plan that moves Elective 1 moves
  the time everyone sees; built in, the constants — and not quite "equal to the constants" for senior: its printed lunch starts 12:30 where `MEAL_START_MINUTES.Lunch` says 12:00, so once the schedule is edited here senior's "Next meal cleanup" time reads 12:30; `tests/sections.test.js` pins `mealStart` = the seeded Meal item's start on both camps); `cleanupOnRota(dow)` = a day with a team on any
  meal (an untracked day says nothing, exactly as the printed rota did — senior's empty rota stays
  silent); `cleanupTeams` in slot order; `verseTheme()` is `NO_THEME` when there is none (the card
  then leaves the theme out) and `verseFor` `NO_VERSE`; `electivesFor(dow)` keeps the legacy shape
  `[slot → [[station, [names], [member keys]]…]]` with a THIRD list the legacy rows don't have;
  `stationEmoji`; `staffNames()` adds the people on the stations (the mention dictionary).
- **An elective person's identity**: `electiveIsMe(name, key)` — my own sign-in matches by MEMBER
  KEY first, a key that is somebody else's never matches by name, a typed name matches
  `state.identity` through `canonicalCounselorName` on both sides (Lilly = Lily, Sofie = Sofia).
  `electiveRowHasMe(row)`, `electiveMeOnDay(dow)`; `myStationFor`, `myElectivesToday`, the Now
  banner and the schedule sheet's chips all use them. `adoptMemberTeam` takes a name the electives
  list knows (`electiveKnowsName`) as the device's identity, as it did the printed roster's.
- **The diff cuts a first write to records** (`setupTreeDiff`, `SETUP_RECORD_DEPTH`): the first
  dish into a section with nothing in it is `meals/wed/lunch`, not a whole `meals` (which would
  overwrite a colleague's first write and take theirs with an undo); the same for a deleted
  container. It stops at the RECORD (`electives/slots/<dk>/<s>/<st>`, `…/people/<p>`) because a
  field op into an absent record is dropped by `setupApplyOps`.
- **The mutators** are plain `commitSetup`s (one undo entry, one push), each refused `off` until
  the section is on: `mealsSet` (an empty dish removes the record — the rules want a dish, an emoji
  alone is not a menu), `mealsCopyDay`; `versesSetTheme` / `versesSetDay` (`reason: 'text'` — a
  verse needs its words — or `'video'` — https only — before anything is written; no words at all
  removes it); `cleanupSet` (the meal's teams replaced as a set), `cleanupApply` (a fill-evenly
  result as ONE commit); `electiveStationAdd/Edit/Remove` (a removal also takes the station off
  every slot, one undo), `electiveSlotAddStation/RemoveStation`, `electivePersonAdd/Remove` (a
  member key or a typed `n-<slug>`; the same name twice at one station is a double tap),
  `electiveCopyDay` ("Same as Monday"), `electiveLinkPerson` (re-keys a typed name to a member
  everywhere it stands, keeping its order).
- **Pure helpers**: `rotaFillEvenly({teams, slots: [{day, meal, want, have}], redo})` — the lowest
  count goes next, a team is not on one meal two days running nor twice in a day; the team with the
  fewest remaining places that day goes first (so a team that cannot repeat Thursday's supper is
  not left for Friday's supper); a rule it cannot keep for one slot is dropped for that slot alone
  and listed in `relaxed`; `have` is kept unless `redo`. `rotaFairness(slots, teams, nameOf,
  dayName)` → "Each team cleans 2–3 times. Maples clean twice on Thursday." `setupNamesNear` /
  `setupNearMember` — "Sophie ≈ Sofia" (one letter apart, or the same consonants from the same first
  letter; never two names that are already one spelling, never an exact match: a counselor is found
  by name already). `setupNearMember` looks in this order: an exact full name → nothing to flag; a
  member listed with a LONGER name that starts with the typed one ("Sofia" / "Sofia Reed" — the name
  matches nobody's sign-in, so a Link is offered; two members sharing the first name → none, not
  guessed) beats a near spelling, so an exact first name is never hijacked by "Sophie". `setupNearLabel`
  says the member's whole name in that first-name case ("Sofia looks like Sofia Reed"). Adding a person
  compares with the spellings merged (`setupNameCanon`: Lilly beside Lily is one chip) and refuses a
  typed first name where a member with that first name already stands; a member added where the typed
  name stands is allowed (Link merges them).
- **Tests**: `sections.test.js` (above). `seed.test.js`'s two pins moved on purpose (a plain seed is
  still the schedule alone; the four sections seed when named; `setupTurnOn(['nonsense'])` is
  `none`), `setup-sync.test.js`'s depth pin (a new day of electives is
  `electives/slots/mon/s0/st-art`, not `electives/slots/mon`).

## Meals, verses, cleanup, electives: the screens (setup-ui.js §12 — Step 19)

P2 §11.10–11.13 inside the Step 14 / 15 frame, in the same clipboard language (§11.0): kicker /
headline / lede, the screen's door, then one column of hairline rows; nothing here is a new
component (`.cb-row`, `.gl`, `.daypick`, `.seg`, `.si-team`, `.sched-add`, `.setup-note`,
`.setup-door`, `.fld`, `.btn`, the shell sheets, `askDialog`). **Nothing is reachable by a counselor,
and nothing is written until the owner turns a section on**: a section that is the original shows
its screen as a read-only PREVIEW of the printed data (`secTree(section)` is the live tree when the
section is on, else `setupBuiltInSections()`; a row a `<div>`, the data as plain words — a dish is a
`.cb-sub` line, a station's people one line of names — never a disabled field or a chunky chip, §8.1.3;
the row keeps its keyed shape, so turning the section on only swaps the inputs in).

- **Routing**: `SETUP_SCREENS` gains `meals | verses | cleanup | electives`, `HUB_OPENS` their rows
  (the four hub rows are `<button>`s with a chevron now; `checklist.test.js` checks the markup
  against the table), `setupWhereNow` tells editorsHere the plain name, `renderSetupUi` dispatches to
  `renderSecScreen(section)`, and `setupScreen()` reads a stored `electives` as the hub on a camp with
  none. Four shell sheets join `SETUP_SHEETS` (`sec-teams`, `sec-person`, `sec-station`, each
  allowed only with what a tap opened — `secUi.teams / person / station` — and `sec-verse`, which
  raised without a tap shows the verse its form was last on, fresh from the tree).
- **Markup / CSS**: index.html's block after `#setup-rain` (`#setup-meals`, `-verses`, `-cleanup`,
  `-electives`; ids `<s>-title | -headline | -lede | -door…`), the shared day strip `#sec-days` in the
  head (`data-setup-screen="sec"`: shown on meals / cleanup / electives only; Mon–Fri, or for the menus
  every day that has a Meal item; a gold "!" on a day the hub's judgement would flag; `state.ui.secDay`
  and, for electives, `state.ui.secSlot`, device-local), and the three sheets. The CSS is ONE block at
  the END of styles.css ("SET UP THE WEEK: Meals, Memory verses, Cleanup rota, Electives"); every
  tap target is the 44px token, and the row layouts hold at 130 % and 200 % text (the cb-list container
  query puts the time above the title).
- **The door and the prompt** (owner only, Q8): each screen's door is `paintPreviewDoor(prefix,
  preview, copy)` with the section's own words — "The menus can now be edited here too." and the
  owner's gold **Turn on**, every other director's "Patrick turns it on." (a section turned off with its
  edits kept says "Showing the original · your edits are kept"). The hub carries the same prompt as its
  front door `data-door="sections"` (`hubDoor`: only when the schedule is edited here and a section is
  still the original; running → new-year → original outrank it; it names just what is still off); its
  button is `HUB_DOOR_ACTIONS.sections` = `secTurnOnFlow(secOffSections())` — every section that is off
  in ONE sitting, one restore point, one transaction. A screen's own Turn on is that section alone.
  `secTurnOnFlow` is Edit the week here's conversation for any list of sections (a plain question first;
  "Is a camp week running right now?" when no date is set; the freeze as a question the owner can
  override in words; every refusal a sentence from `TURNON_WHY`), and refuses a non-owner before it
  asks anything. The way back is a quiet owner-only line at the foot of each screen
  (`#<s>-original`, `data-sec-original`): `secUseOriginal(section)` = one `setupUseOriginal([section])`
  after a question; the edits are kept. **Not built here: Advanced → "Start this section again from the
  original"** (the re-seed of a section that has ever been on, §10.1; the menu's Advanced row stays
  unwired, `SETUP_OWNER_ACTIONS` has only `original`; BUILD-PLAN assigns it to Step 28, the wizard).
- **Meals** (`renderMealsScreen`): a row per Meal-tagged item of the day, once per meal (`secMealItems`:
  the plan's items in time order, tag from the SCHEDULE, so a "Supper and free time" item tagged Supper
  is a row; an item that READS like a meal — a label beginning Breakfast / Lunch / Supper — but has no tag
  gets no row, so the lede says "“Supper and free time” isn’t marked as a meal" (`secLooseMeals`, the
  same test the Schedule hub row uses, one sentence for days that share it). Senior's seed leaves its
  "Supper and free time" untagged (the seed tags only an exact label), so senior shows that warning from
  the moment its schedule is turned on: **Step 20's live check tags senior's supper on the Schedule
  screen BEFORE meals and cleanup are turned on.** The screen opens on the first competition day outside
  camp week, not on Sunday's lone supper): the time and the meal's name, then the dish across the whole row (a textarea that grows —
  `field-sizing: content`, else `secGrow` — so a long dish wraps) with a 44px emoji button AFTER it (the
  dish first in the tab order; empty, a link-blue "+"). The button opens a one-row food picker under
  the dish (`secMealPicker`; a pick is one `mealsSet` commit, `secMealPick`, which moves the focus
  baseline so the blur after it writes nothing). The rows are written once per day and PATCHED in place
  by key (`secPaintKeyed`: a focused field keeps its text and caret; values are set only when the field
  isn't focused). A commit happens on focusout and only when the value changed since the field gained
  focus (`setupFocusIn / Out`, §6.4.9): tapping into a dish and out writes nothing, and Enter finishes
  the field. Copy from another day… is an `askDialog` with the days as full-width rows ("Monday · 3
  dishes", `stack: true`) and a quiet Not now after them.
- **Memory verses**: a run sheet (`secVerseRowHtml`, keyed `v-<key>`): the theme ("Harvest of the Heart ·
  Galatians 2:20"), then a row per competition day — the day in the time column, the reference as the
  title, the first words as a two-line sub, a chevron; a verse still saying "to be announced" (senior's
  seed), one with no reference, or a missing one carries the gold "!" and says so. The headline is the
  theme's name; the lede says what is missing. A tap opens `sec-verse`: Title (theme only), the Verse in
  the scripture serif growing with its words, Reference (book chapter:verse), Video link (days only),
  Save docked. `#verses-form` IS the group (`data-verse`); it commits as one record when focus LEAVES
  the form (Save blurs the field; the ✕ and the backdrop too), never between its own fields. Every
  problem is said at once (`secVerseProblems`): each field in error gets `aria-invalid` and the danger
  edge, and the words ("A verse needs its words. Type them, or clear the whole verse." / "Use a link that
  starts with https://", or for an https link refused for its characters "That link has a space or a
  quote in it. Paste it again.") sit under the first of them; the sheet stays up while anything is in
  error (`versesRecord` is pure and checks before anything is written). The blur's "did it change since
  focus" test compares CANONICAL forms (`setupCanonVal` — `versesRecord` builds text, ref, title in its own
  key order, so a raw compare never matched and every blur rewrote a colleague's edit with the stale form
  value; `tests/sections-ui.test.js` pins both directions). The theme card on Now reads "Theme verse" with
  no dangling separator when the theme has no title.
- **Cleanup rota**: a row per meal keyed `c-<meal>` (the time, the meal, the teams as their marks and
  names — `secTeamHtml`, the teams sheet's shields and flags, never senior's hue-only circles — and a
  gold "!" when no team is on it on a rota that has teams on other meals) → the `sec-teams` sheet: the
  item sheet's team toggles (written once per set of teams, `aria-pressed` patched, so the tapped one
  pops), one or two (a third is refused in words), **Save** (always that word) and the quiet "Take the
  teams off". **Fill evenly** is `rotaFillEvenly` with the preview in ONE `askDialog`: a hairline table
  (`html`: a day label, a row per meal — time · meal · the teams' marks and short names), the fairness
  line and any rule it had to bend; titled "Redo the whole rota evenly?" with "This replaces every
  meal's team." when every meal already has one (no second question: Undo covers it); then Apply (ONE
  `cleanupApply` commit, one undo entry) or Not now. Its `body` is the same preview in words, for the
  native-confirm fallback. The dialog's buttons stay in reach at any length (`.ask-actions` is sticky).
  The fairness line sits under the list for the whole week.
- **Electives** (junior): the day strip, the label "Elective", then a segmented control whose segments
  are the slot's number over its time ("2" / "3:00 PM", aria-label "Elective 2, 3:00 PM" — "Elective 1"
  with a time overflowed its third at 200 % text), then a block per station keyed `st-<id>`: its name (a
  44px button → the station sheet), its people as wrapping chips keyed `p-<pid>` (tap one to take them
  off — "Tap a name to take them off." says so once above the list; Undo is the way back, no
  question), the quiet "+ Add someone" line (→ `sec-person`: first the people ON BREAK in this
  elective, members and typed names alike, then everyone else on the list with where they already are —
  "At Laser Tag" — or their team; each row's icon the team mark or an initial disc; a member keeps
  their key, a pending member and "Someone not on the list" are typed names), and a row for a typed
  name that nearly matches a member ("Sophie looks like Sofia on your list. [Yes, it's Sofia]"). "On
  break: …" under the list, **Add a station** (→ `sec-station`: pick one that isn't in this slot, or a
  new name + emoji: ONE commit adds it to the list and the slot; Save docked), and **Same as Monday**
  (asks first when the day holds anything). A station's own sheet renames it, takes it off this slot,
  or deletes it everywhere (a question, then one undo entry); those two rows sit a 24px gap under the
  form, each with its icon. **Laptop layout deferred:** §11.12 / §11.13 describe a grid / three slot
  columns at laptop width; these screens are the same centred phone column as the Step 14/15 screens at
  1280px (consistent, not as specified).
- **Motion** (§9.5, the Schedule's way — `secPaintList`): the cleanup, electives and verse lists are
  keyed; an edit on the same view glides the survivors once hands are off the list (`whenHandsOff` →
  `flipKeyed`), new rows and chips arrive, rows whose words changed pop (Fill evenly), and the chips
  inside a station glide relative to it (`secInnerRects / secInnerGlide`). A chip tapped off squashes
  out first (`playOut`), then the commit (a refusal brings it back). A new day or slot is an immediate
  replace that slides in from that side (`secSlideIn`); the picked slot snaps like the day pill; a team
  toggle pops. Calm motion and reduced motion: opacity only. The day strip fits seven days at 360px
  (`data-n="7"`) and its gold "!" sits under the day's name.
- **The hub's rows** (`hubSectionStatus`, Appendix B; pure over `v.sec[section]` that `hubSecView()`
  builds from the live tree): not on → a plain info line ("The original menu"); on → Meals: todo with no
  dishes, a warning for a meal with no dish (only a competition day, or a day that lists dishes, is
  judged), summary "Sun–Fri"; Verses: "There is no theme verse yet", days with no verse, summary "Theme
  + 5 days"; Cleanup: todo with nobody on it, a meal with no team, a team that isn't on this camp,
  summary the fairness line; Electives: an Elective item whose slot has no stations, a station with
  nobody, a person at two stations in one slot, a near name; summary "3 slots · 10 stations".
- **Tests**: `sections-ui.test.js` (+ `.senior`) — one case per problem sentence, `hubSecView` on the
  real tree (junior all ready; senior's menus and rota todo, no electives), the prompt (owner button,
  the sentence everyone else reads, partly on, held, gone when all on), Turn on / Use the original as
  conversations (owner only, the freeze), reachability (a counselor reaches none), the preview (every
  control disabled, its handlers do nothing), each screen's handlers with element stand-ins, and the
  idempotent paint; `owner-only.test.js` gains the four doors' markup and calls. The pass:
  `docs/build-notes/verify/step19-pass.cjs` (every screen and sheet, both camps, editor / owner /
  preview, 360 / 390, light / dark, 100 / 130 / 200 % text: no target under 44×44, no sideways
  scroll, no row title or sub squeezed under 80px, no segment label overflowing its button; serve the
  worktree with `python3 -m http.server 8943`).
  `docs/build-notes/verify/step19-same.cjs` is the proof that turning the four sections on changes
  nothing anyone sees: in Chromium the banner at every quarter hour of all seven days, every day's
  schedule sheet, the verses, rota and electives are identical with the schedule on and with
  everything on, both camps (the one difference: `staffNames()` gains the elective stations' game
  leaders, Patrick and Stephen, for the chat mention dictionary — the spec's "+ elective people
  names").

## Counselors ↔ teams ↔ accounts

A member record can carry a **`teamId`** (`'t0'`…`'t5'`) — the team that
person is ON. It's set per-row in More → **Who can sign in**, and it does
three things.

**1. The app opens on their team.** `adoptMemberTeam()` (called from
`maybeShowTeamPicker()` and again whenever the member snapshot changes)
points `state.followTeam` at their team and takes the picker back down if a
hint-painted device already opened it. It **overrides a hand-picked team** on
purpose — the account is the truth. Their follow card says "YOUR TEAM" where
the Change button would be. Their member `name` also becomes `state.identity`,
but only when the team's printed roster (`teamRoster()`) actually lists that name — the electives data
is keyed to those spellings, so adopting an unknown name would just look up
nothing forever.

**2. Real counselor names, everywhere.** A live `.on('value')` on
`campScoreboard/members` (attached in `initSync`, i.e. only after approval
like every other ref) fills **`memberDirectory`**. `counselorName(id)` returns
the directory's assigned staff for that team, joined and sorted, and falls
back to the hand-typed `team.counselor` text for teams nobody's assigned to
yet — so the two sources coexist mid-transition. Everything downstream
(standings, tally rows, matchup callouts, `matchupText`, the identity picker)
goes through `counselorName`, so there's one place to change.

**3. The own-team guard.** `canScoreRound(...teamIds)` is the ONE function
that decides it: an editor with a `teamId` can score every round except the
ones their own team is in. `blockedByOwnTeam()` distinguishes "guarded" from
"just a viewer", and `ownTeamNoteHTML()` is the shared explanation. Loosening
or tightening this is a one-line change inside `canScoreRound`. Where it
bites:
- **Bracket matches** — `matchupCalloutHTML` drops the winner buttons and
  `matchTrackerHTML` swaps the live tracker for a read-only board. Both
  round-1 flavors (free pick and fixed `roundOneMatchups`), the semifinal and
  the final all route through those two, so it's covered in one place. Calling
  up teams, copying the matchup text, and the bye pick stay available.
- **Tally scores** — their own team's input is `readonly disabled` and its
  counter buttons are gone; everyone else's row works normally, and they still
  save the result.
- **Verse / cleanup / bonus points** — their own team's row loses its point
  buttons (the total still shows), and `setVersePoints`/`setCleanupPoints`
  refuse the write defensively even if something else calls them.
- **Placement games are NOT guarded** — a podium pick is one atomic act with
  no per-round unit to withhold. Left open deliberately.

It is a **fairness affordance, not a security boundary**: the database rules
gate on `role` alone and cannot tell which round a write belongs to. Someone
determined could bypass it from a console. That's fine — it's there so nobody
is put in the position of scoring their own team.

**Pending members** are people we know by name and team who have no sign-in
yet. Their key is `pending-<slug>-<rand>` — deliberately something
`identityKey()` can never produce (no `@`, no leading `+`), so a stranger can
never inherit the row. They show as "⏳ No sign-in yet" with an **add email or
phone** action; `convertPendingMember()` writes the real key FIRST and only
then removes the placeholder (RTDB keys are immutable, so this is
create-then-delete — a failure part-way keeps the person). A pending row gets
no invite text, because there's nothing to sign in to yet.

**`SEED_COUNSELORS`** is this week's printed roster, behind the drawer's
"👥 Add this week's counselors" button. `missingSeedCounselors()` matches on
**name, case-insensitively**, so it's idempotent — including for someone who
has since been given a real email. The button writes all the missing rows in
one multi-path `update()` and disappears once nobody's missing. It exists
because the database is locked now: seeding has to happen from a signed-in
editor's device, not a `curl`.

## Firebase Realtime Database gotcha (already bit us once)

Realtime Database **silently drops empty arrays, empty objects, and
`null` values on write** — there's no way to represent "present but
empty." Any piece of synced state (`SYNC_KEYS` in `app.js`) that can
legitimately be empty at some point (e.g. a freshly-created bracket with
`matches: []`) can come back from a remote round-trip missing those keys
entirely. A render function that assumes `.length` or `.map` will always
work on those fields will throw.

The fix pattern already in place (`normalizeBracket` in `app.js`): after
loading from `localStorage`, after every remote merge in `initSync`, and
right before a render function reads a synced object, coerce missing
array/object fields back to safe defaults in place. Follow this same
pattern for any new synced, potentially-empty data shape — don't assume
"it was an empty array when I wrote it, so it'll still be one when I read
it back."

More sync invariants (each fixed after it bit us — don't regress these;
`tests/sync.test.js` pins all of them):
- **Never push before the first pull.** `pushState()` is gated on
  `remoteReady`, which flips true only when the first server snapshot
  arrives. Without it, a device on slow wifi that saves anything before
  its first sync queues a `set()` of stale local state that wipes
  everyone's newer scores on connect.
- **The week config is a field-op engine, never a whole-object write** (config
  engine v2, setup rebuild spec §6.3 — build step 9; it replaced scoring#3's
  whole-`set()` last-write-wins). `campScoreboard/config` is still the same
  five-key, array-shaped node (`version`, `updatedAt`, `sessions`, `days`, `games` —
  old builds read it unchanged; their whole `set()` still lands and can only clobber
  from a device that hasn't reloaded). What changed is how a device talks to it:
  - **Canonical id-space** (`cfgCanon` / `cfgFromCanon`, diff and merge ONLY, never
    stored): `days` and `games` keyed by record id, each record carrying its list
    position as `_o`; `syncCanon`'d, so RTDB's pruning and key order are no change.
    `treeDiff(prev, cur, CFG_DEPTHS)` turns two such trees into id-keyed ops
    (`games/<gid>/<field>` — every game field is ONE leaf, so `rules`, `timer`,
    `liveTracker` are written whole; a record add = the whole record, a delete =
    `null`, a reorder = its `_o` changing). `treeDiff` and `applyOpsSafe` are the
    shared pure helpers (next to `syncCanon`) the setup engine will reuse;
    `applyOpsSafe(tree, ops, CFG_ANCHORS)` drops a FIELD op into a record that is
    gone (reported, never resurrected half-built) and always applies a delete — and a
    create into free space. A create that meets a record already there is NEVER an
    overwrite: identical content (position `_o` aside) is skipped, different content is
    dropped as a `collide` (two phones minted one id at once; `opts.overwrite` is only
    for a deliberate Use mine). A record whose canonical form is unchanged keeps its object across every
    adopt (`cfgFromCanon(…, prev)`): open views and the render-stability rules need it.
  - **A persisted confirmed baseline**: `state._cfgBase` (canonical config the server
    last CONFIRMED), `_cfgBaseAt`, `_cfgBaseEpoch`, in the SAME `STORAGE_KEY` write
    as `state.config` (`writeCfgBase` — the `_syncBase` rule: the pair can't disagree).
    Unconfirmed work = `treeDiff(_cfgBase, config)` (`cfgUnconfirmed()`), so it
    survives a reload, a force-quit and an iOS eviction. Never synced, never in a
    backup (`backupJSON` lists its keys). A device with no baseline (its first run of
    this engine) plain-adopts the first snapshot, and tracking starts there.
  - **A push is a TRANSACTION** (`pushConfig`) applying MY unconfirmed ops to the
    server's CURRENT value (`applyOpsSafe` on `cfgCanon(cur)`), stamping `updatedAt`
    inside it — so two directors editing different fields of one game both land, an
    old build's `set()` landing between our read and our commit just makes the SDK
    re-run it, and the same field edited on both sides is last-commit-wins. One at a
    time (`pendingConfigWrites`; a push asked for mid-flight sets `configPushOwed` and
    runs when it settles). A `null` current value ABORTS (the node is really gone —
    the listener is about to see the null and re-seed it from this phone's catalog,
    edits included). On commit `cfgPushCommitted` REBASES the local copy: committed
    server value + only the edits made since the push began, measured from the push-
    time tree (baseline + the ops sent), so a snapshot that landed mid-push can't make
    the next diff "undo" a colleague's change. Ops the transaction dropped go to the
    Put-it-back list. Sync not configured ⇒ no ref ⇒ nothing is pushed (local-only
    unchanged). `configForSync` still strips unknown keys; because the node's value
    is replaced by the transaction's result, a stray already in it is pruned by the
    first edit.
  - **A snapshot is REBASED, never stashed or swapped in** (`applyRemoteConfig`):
    server + my unconfirmed ops (`applyOpsSafe`), base := the server's tree. A viewer
    (or a read-only tab) has no edits, so it just adopts. Data applies AT ONCE, even
    mid-entry; only the repaint waits for a focused field (`renderAllWhenIdle`) —
    `pendingRemoteConfig`, `configFirstHeld` and `flushPendingRemoteConfig` are gone.
    Handlers resolve their record BY ID when they commit (P10): a snapshot may have
    replaced every object since a row was drawn. `migrateState` still runs on the
    result; only a REAL version change from an editor re-pushes.
  - **The first snapshot waits for the state engine's first pull** (`cfgFirstPending`,
    released by `handleRemoteSnapshot` — its epoch lives in `state/meta`), then
    `configReady` flips and `firstConfigMerge` runs a three-way merge: mine
    (`treeDiff(base, local)`) kept where no path of theirs overlaps and pushed;
    **positions (`_o`) are never paths for this test** — every insert or delete
    renumbers all later records, so counting them made an offline delete clash with a
    colleague's earlier delete and revert. `cfgMergeOrder` settles positions afterwards
    from RELATIVE order: the server's order, my new records after their old neighbour,
    my reorder laid back only where the server didn't move the same records (both
    reordering: the server's stands, quietly), then a dense `_o` so no tie-break can
    swap a pair. Whole records compare without `_o` ("the server already says it"), and
    a NEW record of mine meeting a different one under its id is a `collide` note, not
    a clash. The same path changed on both sides keeps the SERVER's (the loser is listed as a
    `clash` note with **Use mine** / **Dismiss**, and gets a synthetic undo entry whose
    `before` is MINE and `after` the server's, so Undo brings it back); a kept op whose
    record the server deleted is dropped by `applyOpsSafe` into a **Put it back** note
    instead of being pushed into a refusal. Unconfirmed longer than 36 h asks first
    (`confirm`, as the state engine does). An EPOCH change (the baseline's
    `_cfgBaseEpoch` ≠ `state.meta.epoch`) first forgets last year's notes and undo
    history (`cfgForgetLastYear` — also when nothing was unconfirmed, before the adopt
    re-stamps the epoch), then strands the ops as downloadable JSON
    (`cfgStrand`, paths prefixed `config/`, same store and bar as the state engine's
    stranded work) and adopts — and `cfgFollowStateEpoch` (called at the end of
    `applyRemoteState`) keeps the baseline's epoch following the state engine's, so a
    device open across the wizard strands only genuinely old-year edits (sync-F11).
    Nothing is pushed before `configReady` (the null-seed aside: an empty node is
    seeded by a TRANSACTION into a truly empty node, `seedConfigIfAbsent`, and the
    seeded value becomes the baseline). **The builder is editable while the games list
    loads only on a device that HAS a baseline** (`configEditable()`): its edit is
    merged when the snapshot lands. A device without one keeps the "Loading the games
    list…" placeholders (`renderConfigLoading`) because nothing could tell its edit
    apart from the cached copy the snapshot replaces; it lifts at once when no snapshot
    can ever come (sync not configured, SDK down, config read refused).
  - **Notes** (`state._cfgNotes`, ≤ 30, in the cache blob, not synced): `putback`
    `{section, key, name, record, collide?}` and `clash` `{path, mine, theirs, what}`;
    shown in a strip above the builder's tabs (`configNotesHtml`, wired once, escaped;
    a whole-record clash reads "you deleted X, but someone changed it too" with
    **Delete it anyway**). `cfgPutBack` re-creates the record with my edits (a `collide`
    note re-keys it with a fresh random tail — the other record is somebody's and stays)
    and `cfgUseMine` writes my value — both ordinary undoable commits, and `cfgUseMine`
    keeps its note when nothing could be written (the record is gone, or `cfgRecordGuard`
    refuses: removing a game that has a result/bracket/clock, or a day that has games,
    is the builder's own confirmed Delete, not a side door). A bare reorder of a
    vanished record is dropped silently.
  - **Accounting**: config writes are counted (`pendingConfigWrites`);
    `pendingWritesTotal()` = scores + config feeds `reloadBlocked` and
    `hasUnsyncedWork`; `hasUnconfirmedLocalWork` (sign-out) also asks
    `cfgUnconfirmed()` for an editor, so a builder edit that never reached the server —
    even from an earlier session — is named in the sign-out question; `canAdoptRemote`
    deliberately stays about `state` alone. A refused or failed config write says
    "Couldn't save the week setup"; the edit stays unconfirmed and goes up with the
    next builder change or, after a reload, the first-snapshot merge.
  - **The game editor saves only what it changed** (§6.3.5): `ensureGameDraft` keeps
    `gameDraftOrigin` (a deep copy of the saved game as the sheet opened);
    `saveGameDraft` computes `gameFieldOps(origin, out)` and applies just those fields
    to the game as it is NOW (resolved by id). A field somebody else ALSO changed to
    something different is asked about INLINE (Step 14; the native `confirm` is gone): the
    first Save tap writes nothing and raises `gameClash` — a `.clash` per field above
    Save, a radiogroup of the two actual values ("Keep mine" / "Use theirs"; the config
    has no authorship, so "someone changed Location"), Save a dashed well ("Pick one for
    Location, then save") until each has a pick; the next Save writes the picks and the
    fields nobody else touched either way. The block is rebuilt from the game as it is at
    every Save tap, so a pick made about values that changed again is asked again
    (`gameClashSync`), and it is cleared with the draft. A game removed meanwhile asks in
    `askDialog` ("Someone deleted “X” while you were editing it": Discard my changes / Put
    it back with my changes; dismissing it changes nothing — the draft is the only copy).
    The format-change confirm and the editor's own "Discard?" are still native.
    `tests/fixtures/legacy-builder-v183.js` parity holds. A NEW
    game's id (builder, ⚡ quick game, Duplicate) is the name's slug + `-` + 4 random
    base36 (`makeId`, `takenGameIds`: `taken` covers every `GAME_RECORD_MAPS` key too);
    day ids are still `d-<ms>`.
- **Undo core** (setup rebuild spec §7.1 — build step 9). The builder's commits go
  through two wrappers: `configEdit(label, mutate, opts)` (games and days) and
  `stateEdit(label, mutate, opts)` (teams: rename, counselors, reorder; the roster in
  the same id-keyed form via `teamsCanon`, `_o` = position). Each snapshots the
  canonical tree, runs the mutation (which looks its record up BY ID — P10), commits
  through the normal engine (`saveConfig` / `saveState`: nothing real changed ⇒
  nothing stamped, sent or recorded) and records
  `{id, label, at, epoch, ops: [[domain, path, before, after], …]}` with canonical
  values from the engine's own diff (`undoRecord`), then shows its toast with an
  **Undo** button (`showToast(msg, { action: { label, run }, duration })` — the
  Jelly toaster has no action slot and is vendored, so `addToastAction` appends the
  button to the toast it returns). `undoEntry(id)` puts `before` back ONLY where the
  current value still equals `after` (canonical compare), per domain through
  `UNDO_DOMAINS` (`config`, `teams`; setup and campers join with their engines);
  paths somebody changed since are left alone and said out loud ("Undid 1 of 2
  changes — someone changed game “X” · name since; left theirs." / "Can't undo —
  someone changed this since."; the config has no per-record authorship, so it says
  "someone"). Undo keeps the builder's own guards (`UNDO_DOMAINS.*.guard` →
  `cfgRecordGuard`: it won't remove a scored game or a day that has games — it says
  so and keeps the entry), counts an op whose record a colleague deleted as left, not
  applied, and puts a deleted record back beside its old NEIGHBOUR (`cfgPlaceRestored`)
  with the renumber ops of later records skipped (never listed as "changed since").
  The Undo toast lasts `UNDO_TOAST_MS` (6 s) and its button is a 44px target that takes
  no layout room — and is now only what runs OUTSIDE Set up the week (the ⚡ quick game):
  while the builder's frame is up, `undoRecord` and `undoEntry` hand the entry to
  `setupUndoOffer` (setup-ui.js, "The undo pill") and raise no toast at all, because a
  toast over the builder swallowed the next tap. The undo is itself a commit, so it becomes a new `Undid: …` entry whose
  pill / toast offers **Redo** (undoing that entry; there is no separate redo stack). After
  an undo the builder forgets its markup memo (`refreshBuilderCards`) because its text
  fields commit without repainting. Not undoable, on purpose: People/access changes
  (they keep their confirms), scores (their own tools), a backup restore and "Put back
  the original games and days" (`{ undo: false }` — they also move scores/roster), and
  deleting or changing the format of a game that had records (`label: null` — Undo
  would bring back the game but not its result). Stored per camp in
  `lsKey('campSetupUndo')` (`UNDO_KEY`): memory + storage, ≤ 50 entries, ≤ 200 KB,
  oldest dropped, an entry over 20 KB (a seed, a big restore) not stacked at all;
  read lazily (never at load — boot-cache.test.js); cleared on an epoch change
  (`cfgFollowStateEpoch`), when a device stops being an editor (`setMemberRole`), and
  by `clearLocalData`. An entry from an earlier epoch refuses and is dropped. A viewer
  or a read-only tab can't undo (`canEdit()`).
- **The first snapshot is a three-way merge, per path** (2026-10-26). The
  cached state carries `state._syncBase`: the tree the server last CONFIRMED
  (advanced only on adopt and on an acknowledged push — never
  optimistically — and stored in the same localStorage write as the scores so
  the pair can't disagree). On the first snapshot after load,
  `firstSnapshotMerge` re-applies every path this phone changed since that
  baseline that nobody else touched, and pushes exactly those; the same path
  changed on both sides keeps the server's value (toast). This is what makes
  a score saved in a dead zone survive a force-quit, an iOS eviction or a
  reload. It replaced "newest `lastDataChangeAt` takes the whole tree", which
  either dropped the offline score or pushed this phone's whole stale tree
  over everyone's newer results (`lastSyncedTree` was null on that path).
  `_syncBase` is never synced and never in a backup. Comparisons run on
  RTDB-CANONICAL forms (`syncCanon`: empties pruned, keys sorted) — the raw
  snapshot is pruned and key-sorted while the cache is normalized, and
  comparing them directly made every healed empty look like someone else's
  edit (caught by review, 2026-10-26). The merged tree is applied with the
  SERVER's tree as its confirmed base (it's not confirmed until the push
  acks). Unconfirmed work older than 36 h since the last confirmation asks
  before sending; an EMPTY state node on a phone that has a baseline is
  treated as a deliberate wipe (adopt it, push back only our own edits +
  the roster), not seeded. Two tabs of the SAME camp on one device used to
  overwrite each other's unconfirmed edits in the shared cache; they now have
  ONE writer (two bullets down). A different EPOCH on the server strands this
  phone's work instead of merging it (next bullet).
- **A new camp year strands a phone's unsent work, never applies it** (S2d, setup
  rebuild spec §6.2 #3 / §6.11). The new-year wizard (Step 28, not built) will stamp
  `state/meta/epoch` (`w<YYYYMMDD>`; absent = the legacy week, which is every camp
  today). `firstSnapshotMerge` compares the epoch in the baseline the server last
  CONFIRMED to this phone (`epochOfTree(base)`, i.e. `_syncBase`) with the one in
  the snapshot; when they differ, the three-way merge does NOT run: every path this
  phone changed (`strandOldEpochWork`) is written to
  `lsKey('campScoreboardStranded')` (`STRANDED_KEY`) as
  `{at, from, to, lastSyncedAt, changes: [{path, what, value}]}` — `from`/`to` are
  the epoch or `'legacy'` (never `''`), `value` is the canonical (`syncCanon`) form
  and `null` is a deletion — then the server's tree is adopted and **nothing is
  pushed**. A refused edit parked from last year (`stateQuarantine`) goes with it,
  so no red bar survives into the new year. Only `meta/lastDataChangeAt`
  outstanding is not "work": a plain adopt, no toast. It is checked BEFORE the
  three-way compare, and `tests/sync-epoch.test.js` pins that the function writes
  nothing to the database. Rules of the store: per camp (`lsKey`), wiped by
  `clearLocalData`, lazily read (`readStranded` — never at load), newest ten
  entries, identical work stranded twice (two tabs, a crash between the set-aside
  and the adopt) is one entry, never synced, never in a backup, never in
  `SYNC_KEYS`. **An EMPTY node is not an epoch change** (a console wipe takes
  `meta` with it): it keeps the wipe rule above. An epoch going BACK (Undo the
  new-year setup) strands exactly like one going forward. The person is told by a
  toast ("This phone had N changes from last camp week that never synced. They
  weren't added to this week. Download them from the bar at the top of the page.")
  and then by a calm bar in the `#sync-alert` strip — "N old changes not added to
  this week." with **Download** (one JSON file, `camp-unsynced-changes-<camp>-<date>.json`)
  and **Dismiss** (asks first; it is the only copy). The bar uses the strip's
  neutral `sync-alert-tab` look, and waits behind this week's refused scores (red)
  and the view-only-tab bar; Download never deletes. Signing out names it in its
  question. The week config's own epoch check (step 9) strands its ops into the same
  store with `config/…` paths (see "The week config is a field-op engine"). Not built
  here: the device-local reset on a new epoch (`campScoreboardEpochSeen`) and the
  setup engine's epoch check arrive with the wizard (Step 28) and the setup engine.
- **Two tabs of one camp: one writer** (S2c, setup rebuild spec §6.9). The cache
  (`STORAGE_KEY`) holds this device's unconfirmed edits and the baseline they are
  measured against, and each tab kept its own in-memory copy and wrote the WHOLE
  cache, so the later write erased the other's unsent work. An EDITOR tab now
  takes the Web Lock `camp-writer:<camp>` (per camp, so a junior and a senior tab
  never contend) before it persists anything. `tabWriter` is `null` (undecided),
  `true` (owns the cache) or `false` (another tab does: **view-only**).
  - **One gate.** Every cache write is `persistState()` — a no-op unless
    `tabWriter === true`, and while undecided the write is OWED and made the
    moment the tab is decided a writer. `tests/tablock.test.js` scans every
    shipped script for any other `setItem` on the key; add no second writer (the
    week-setup node's own cache, when S4 adds one, goes through the same gate).
  - **Undecided until the answer.** The election starts in `setMemberRole`, the
    moment a role is KNOWN — the hinted role boot() paints included, before auth
    confirms it. A device whose stored hint says editor starts undecided AT LOAD
    (`tabHintedEditor()`, read from the same hint keys boot() uses; the literal
    for `CAMPS_HINT_KEY` is repeated there because that const is declared far
    below — a TDZ read), so the load-time migrate cannot write ahead of the
    election; every other tab (a viewer, or no hint) is a writer from the start,
    and `startTabElection()` undecides it if it turns out to be an editor. While
    undecided `pushState`/`pushConfig` HOLD (`tabMayPush`: the diff is untouched,
    so the push goes out the moment the tab is decided; the held flags count as
    unsent work in `editorMidEntry`, so a snapshot is not adopted over it).
  - **Not granted → retry** every 250 ms for 1.5 s (`TAB_RETRY_MS` ×
    `TAB_RETRY_MAX`) — a reloading page can still hold the lock for a moment —
    then the tab is view-only. **Fail open**: no `navigator.locks`, a throw, or a
    non-abort rejection makes the tab a writer (today's behaviour), and where
    `BroadcastChannel('camp-tabs:<camp>')` exists a hello / here / claim /
    released exchange keeps a second tab from racing the first (300 ms hello
    window). Viewers never lock and are writers by default (decision C27); a
    hinted editor whose record says viewer releases the lock (`tabBecomeViewer`).
  - **View-only tab.** `canEdit()` is `memberRole === 'editor' && tabWriter !==
    false`, so every existing write gate holds and `html.view-only` paints. It is
    NOT a viewer for what it may SEE: `standingsVisible()`, the hide-from-viewers
    card rule (`applyCardVisibility`), `renderAll`'s chat takeover check AND
    chat.js's `chatHiddenFromMe()` (the tap on the card) all read the member
    record's role (`memberRole`), so a director's second tab shows every card and
    the standings and opens chat even when it is hidden from viewers
    (`ensureSecrecySeed` writes only when `canEdit()`). Any NEW "is this person a
    viewer, for what they may see" test uses `memberRole`; `canEdit()` means "may
    write" and is false in this tab. A bar in the `#sync-alert` strip (never wanted
    at the same time as a parked score, since a view-only tab cannot park one) says
    "View-only: another tab is editing." with **Use this tab instead** (kept to two
    lines at 320px: the copy is short and `styles.css` drops both one step under
    360px). A read-only tab never pushes (`tabMayPush`) and never asks for the
    lock again by itself (no auto-takeover: its in-memory copy is older than the
    cache the writer kept). A parked change loaded from the cache shows in its sync
    line WITHOUT Retry / Discard (`quarantineLineHtml`; both functions also return
    unless `canEdit()`): the writer tab owns it. The footer copy of the sync line
    (`html.view-only`) is shown only while the Current standings section is NOT on the
    page — `applyCardVisibility` sets `html.standings-shown` from
    `standingsVisible()`, so a director's view-only tab does not read it twice.
  - **A lock request that never answers fails open.** Throw, rejection and a
    missing API all fail open, but a request whose callback never runs would leave
    `tabWriter` null for good (nothing cached, nothing pushed, every reload blocked
    by the held flags, no error). Each ask gets a `TAB_ANSWER_MS` (4 s) watchdog,
    cancelled when its callback runs (a held lock or a "no"), so it never cuts into
    the 1.5 s retry window; if it fires, `tabFailOpen` decides and a lock granted
    late is let go at once (`gaveUp`).
  - **Use this tab instead** = `navigator.locks.request(name, {steal: true})`
    and then `doReload()` to re-adopt from the cache and the server (a reload
    first asks if `reloadBlocked()`; OFFLINE it says "Needs a connection" and
    steals nothing — the reload would fail into the browser's error page with the
    lock already taken, leaving both tabs dead). The old tab's lock promise rejects with
    AbortError: it sets `tabWriter = false` FIRST (so nothing it does persists —
    an ack's `writeConfirmedTree` after demotion included), then
    `flushTabPushes()` sends what it had queued (the one time a read-only tab
    pushes), then shows the bar. Its unacked edits are in the cache it last wrote
    as a writer and are re-merged by the first-snapshot merge.
  - A hinted editor on a device whose SDK cannot load is downgraded to viewer
    (`onSdkLoadFailed`), which releases the lock like any viewer flip.
- **Refused writes: a rules refusal is quarantined, never a wedge** (S2a, setup
  rebuild spec §6.2 #1). `pushState` is one atomic multi-path `update()`, so ONE
  path the rules refuse refused the whole batch, and the old handler re-sent the
  same batch on every push forever (only a `console.warn`) — every score after it
  queued behind the poisoned path. Now, **only on `e.code === 'PERMISSION_DENIED'`**,
  `startStateBisect` re-sends the refused batch one path at a time
  (`bisectRefusedBatch`; more than `STATE_BISECT_SINGLES` = 50 paths are halved
  first). A path the server takes advances `confirmedTree` exactly as an ack does;
  a path refused ALONE goes to `stateQuarantine[path] = value`, is treated as sent
  (`lastSyncedTree` already holds it, so it is not retried forever), and the
  sync line (`#sync-status`, both copies) reads "⚠️ N changes couldn't be saved:
  Kickball → result" with **Retry** (put the paths back into the diff and push the
  CURRENT value) and **Discard** (confirm first; puts the server-confirmed value
  back into state AND baseline, sends nothing). **Every other error keeps the
  original handler byte for byte** (restore `lastSyncedTree = prevBaseline`,
  settle) — a dropped connection is not a refusal; a connection that drops
  mid-bisect hands the unreached paths back to the diff the same way. **Editors
  only**: a view-only device's refused stray diff takes that same quiet original
  path (`canEdit()` in the rejection handler) — no park, no toast, no line.
  **Where an editor sees it**: the same news rides a bar under the header's
  identity row, `#sync-alert` (`updateSyncAlert`; it lives INSIDE the sticky
  `#app-header`, in flow, so it sticks with it on every tab and never floats over
  the identity row — it used to be `position: fixed`, which the header replaced;
  `body.has-sync-alert` is still toggled as a hook), because the standings
  section holding the line is not on every tab. One constant-height row, names
  truncated; Retry / Discard are the same delegated buttons. The card line says
  Offline FIRST when offline (the bar still names the refused edit), and the park
  toast says where to act. Each parked path also gets ONE silent automatic Retry
  `QUARANTINE_AUTO_RETRY_MS` (20 s) after parking (`scheduleQuarantineAutoRetry`
  / `autoRetryQuarantined`; the path stays parked meanwhile so the bar doesn't
  flicker; `quarantineAutoRetried` marks it, `unpark()` clears the mark) — a
  transient refusal, which healed on the next push before parking, should not
  need a human; a second refusal waits for Retry without a new toast.
  Ordering (sync-F15): the bisect counts in `pendingWrites` (so the adopt, reload,
  camp-switch and sign-out guards see it; `reloadBlocked` also names
  `stateBisecting`), one bisect runs at a time (`stateBisectQueue`), and
  `pushState` HOLDS new pushes while one runs (`stateBisectHeld`) and runs them
  after — a score tapped mid-bisect can't land before the retry of an older value
  of the same path. Each retried path is also re-read from the live local state
  and SKIPPED if it changed since the refused batch (the newer value goes out in
  that next push: `lastSyncedTree` still holds the batch's value, so the diff
  finds it). `applyRemoteState` re-lays the parked values on top of an adopted
  snapshot (the server's own tree stays the confirmed baseline) — adopting must
  never silently wipe a score the sync line is still naming; `pruneQuarantine`
  drops a path once local equals confirmed (the retry got through, someone saved
  the same value, Discard). **The server wins when it moved past a parked path**
  (`dropSupersededQuarantine`): if the adopted snapshot changed that same value
  against the last confirmed tree, or removed a record it lives in (New week
  clears every result at once), the parked path is dropped, not laid over — last
  week's refused result must not sit on top of a reset week — with a toast (the
  first-snapshot merge counts it as a conflict, so "kept their version" is true).
  Not judged on the merge's second pass (`confirmedBase` set: its `remote` is the
  server tree with this phone's edits laid in). The parked set is persisted as
  `state._quarantine` in the same `STORAGE_KEY` write as the scores (never
  synced, never in a backup, wiped with the cache on sign-out); after a reload
  the first-snapshot merge re-sends the path, so it heals once the rules accept
  it and is re-parked if not — **`firstSnapshotMerge` takes its base
  (`serverNorm`) from `confirmedTree`, never `lastSyncedTree`**: the adopt's
  overlay puts the parked values INTO `lastSyncedTree`, and using it as the base
  made the diff find nothing to send and the reload silently un-parked the path
  (`sync-quarantine.test.js` reloads through the real merge to pin it).
  `readQuarantine` runs at load: it may touch only `state` and `SYNC_KEYS`
  (the boot-cache TDZ rule). The line carries labels, never values, so it is safe
  for the secrecy rules.
- **A bracket this build can't read is never healed or written.**
  `bracketKnown()` (app.js) says a `brackets[gid]` is a six-team wizard bracket:
  no `kind`, a phase it can place, and at least one six-team field (a truly empty
  object is just an RTDB-pruned bare bracket and still heals). Anything else is
  returned UNTOUCHED by `normalizeBracket` — healing would stamp
  round1/pool/matches onto a newer build's bracket and the next push would write
  that over every device's copy. `renderTournament` and `renderLiveWatch` show
  "This bracket needs the newest version — pull down to reload" (with a Reload
  now button, a plain reload, not a state write; an EDITOR also gets a confirmed
  "Clear this bracket", the same delete as Cancel this bracket, because a
  bracket that is plain garbage rather than a newer shape is otherwise
  console-only to remove); the game stays out of Live now and the upcoming
  matchups. The 4-team bracket is planned under its own node
  (`brackets4`); this is the belt-and-braces for a phone that predates it.
- **The 2026 roster migration is legacy-week only.** `normalizeSyncedState` swaps
  generic "Team N" names and placeholder counselors for the 2026 roster on every
  remote merge; it now runs only while `state.meta.epoch` is absent (the future
  new-year wizard stamps one), so a later year's directors can name a team "Team
  4" without it being swapped back. With an epoch, a pruned empty counselor
  reads back as `''`. A no-op today (nothing sets an epoch yet).
- **An identical snapshot keeps the live objects.** `applyRemoteState`
  restores the previous `state[k]` references when the signature didn't
  change — open tally/bracket/notice views close over those objects, and an
  idle re-fetch of our own write used to detach them so every later tap was
  silently not saved.
- **Concurrent editors don't clobber each other:** tally `drafts` are diffed
  per score/medal leaf (a NEW draft too), `meta` per field and `hiddenCards`
  per card, `teams` per FIELD (next bullet; only `notice` is still written
  whole). Verse/cleanup
  points use deterministic ids (`verse-<team>-<dow>`,
  `cleanup-<team>-<dow>-<meal>`) so two devices write one slot, not two.
- **Team names and counselors sync per field** (S2b, setup rebuild spec §6.2 #2).
  `teams` used to be a singleton, so renaming one team re-sent the whole roster
  and a second director's rename of a DIFFERENT team (or of the same team's
  counselor) was reverted by whichever phone saved last. `computeSyncUpdates` now
  emits `teams/<i>/<field>` (a removed field is `null`) when the two rosters line
  up by position — `rosterAligned`: same length, same id at every index — and the
  WHOLE `teams` array otherwise: a reorder (the Teams tab's ↑/↓ moves ids between
  positions), a different size, no roster on one side (the first push, the
  empty-node re-seed), a record with no id. `SYNC_SINGLETONS` is `['notice']`.
  `firstSnapshotMerge` needed nothing: a per-field path from this phone and one
  from the server only conflict when equal or nested (`syncPathsOverlap`), and a
  server-side reorder is a whole-`teams` path that overlaps everything under it,
  so an offline rename never lands on whichever team moved into its slot.
  Per-position paths have ONE known narrow race, accepted: a rename sent in the
  seconds between another director's reorder and its snapshot reaching this
  phone names the team now sitting at that index; reordering teams is a
  once-a-year setup act. **The guard that comes with it**:
  because a single `teams/2/name` can now re-grow a roster in a `state` node
  wiped from the console, RTDB would hand back a roster with holes and no ids.
  `applyRemoteState` adopts `remote.teams` only when `rosterIsWhole` (an array,
  every record with a string `id`); otherwise this device keeps its own roster
  and an EDITOR writes it back whole (`lastSyncedTree.teams = null` +
  `schedulePush`; a viewer writes nothing). Old builds still send the whole
  array and every build adopts it — nothing to migrate, and `database.rules.json`
  already accepts a per-field write (`teams` only has to stay a branch).
  Quarantine needs nothing special: `quarantineLabel('teams/1/name')` reads
  "Team names" and `setStatePath` walks the roster array.
- **`editorMidEntry` is an allowlist** (its focus test is `fieldFocused()`):
  native INPUT/TEXTAREA/SELECT, contentEditable, and only
  `JELLY-(INPUT|TEXTAREA|SELECT|OTP)`; the chat composer is deliberately not
  counted. Every Jelly component delegates focus, so the old
  `startsWith('JELLY-')` counted a tapped card header or button as typing and
  froze live updates on Android/desktop Chrome until focus moved.
- **A snapshot key that's missing means "empty", not "keep mine".** The
  remote merge replaces `results`/`brackets`/`drafts`/`picRounds`/`meta`
  with `{}` when absent from the snapshot (RTDB prunes empty objects, so
  absence IS the empty state). Only `teams` is guarded. Treating missing
  as keep-local made "New week (reset)" silently fail to propagate.
- **A snapshot you can't safely adopt must be re-fetched, not dropped.**
  `canAdoptRemote()` refuses to overwrite local state while the editor is
  mid-entry (`editorMidEntry()`) or a local write is unconfirmed
  (`pendingWrites > 0`) — that's what stops a reconnect's stale replay from
  reverting scores being typed. But RTDB only fires `value` again when the
  server data *changes*, so a snapshot turned away this way is gone: a phone
  sitting with a score field focused could stay silently stale for the rest
  of a game. `deferRemoteSnapshot()` therefore records that a read is owed and
  an idle tick re-reads (`fbRef.once`) once the device is quiet. Re-reading,
  not replaying a stashed payload, is deliberate — the payload may already be
  superseded. The same tick also pays off an owed render (the week config no
  longer parks here: it applies at once and only its repaint waits): a BACKGROUND event — a game clock settling at 0:00, the staff list
  changing — calls `renderAllWhenIdle()` rather than `renderAll()`, so it
  can't rebuild a focused field under an editor's thumb (keyboard dropped, an
  open select gone); `fieldFocused()` defers it to the next quiet tick.
- **The synced game clock runs on server time, not device time.**
  `state.clocks[gid].endAt` is absolute and every device counts down to it, so
  the devices have to agree on "now". `serverNow()` = `Date.now()` +
  `.info/serverTimeOffset`, and `clockRemaining()`/`applyClockAction()` both
  use it. With sync off the offset is 0 and it's exactly `Date.now()`. Before
  this, a handset a few minutes off showed a countdown that far wrong on the
  Big Board — and a second *editor* device would hit zero early, buzz, and
  stop the synced clock for everyone.

## `defaults.js` edits don't reach an already-running week

`defaultConfig()` in `defaults.js` only seeds a **brand-new** device/state —
`makeFreshState()` on first-ever load, or `migrateState()` if `state.config`
is entirely missing. Once a week has been set up (More → Set up the
week), the live days/games catalog lives in its own Firebase node,
`campScoreboard/config` — a *sibling* ref to `campScoreboard/state`, kept
separate deliberately (see the `fbConfigRef` comment in `app.js`) so older
cached clients never need to know about it. Every device with the app open
holds a live `.on('value')` listener on it (`applyRemoteConfig`), so edits
to that node propagate instantly, no reload needed.

**This means: editing a game's data in `defaults.js` and deploying it does
NOT change anything for a camp week that's already in progress.** It only
changes what a device with zero prior state would seed. A mid-week request
like "change game X's rounds/rules/etc." needs the live config patched
directly, in addition to (not instead of) fixing `defaults.js` so future
fresh setups match:
```
# Read the current games array to find the target game's array index:
curl -s "https://<project>-default-rtdb.firebaseio.com/campScoreboard/config/games.json"
# Replace just that index with the corrected object (PUT, not PATCH —
# the whole game object at that path):
curl -s -X PUT "https://<project>-default-rtdb.firebaseio.com/campScoreboard/config/games/<i>.json" -d @corrected-game.json
```
Always re-fetch afterward to confirm the write stuck. This bit us once
already: a rounds-count change was committed to `defaults.js` and "verified
live" by curling the raw `defaults.js` file — which only proves the static
asset changed, not that the running week's synced config did. Curling the
Firebase REST endpoint (as above) is the only way to confirm a game-data
change actually reached devices mid-week.

## The TV page (current-standings.html) — both camps

The big-screen reveal (redesign §4.11, Step 23). **A PUBLIC, READ-ONLY subscriber**:
anyone with the address can open it, so it has no account at all. No sign-in, no
Auth SDK (index.html carries three Firebase SDK tags, this page two: app +
database, each with its pinned `integrity` hash), no sign-in overlay, no members
read. It reads exactly **`<root>/revealPublic`** (one listener, both children),
**`.info/serverTimeOffset`** and **`.info/connected`**, writes NOTHING (not a
presence row, not a heartbeat: an anonymously writable path is the one thing the
design refuses), and never computes a standing: names, points and places arrive
already frozen into the node, one place at a time, and only places a director has
shown are in the node at all. With no live reveal it says "Waiting for the
directors…" (mockup 11). The old signed-in, directors-only interim page is gone.

- **What it draws is `tvFrame()`**, reveal-core's pure function of `(ctl, pub,
  server time)` (the remote's mini TV runs the very same one): `waiting | intro |
  hero | board | champion | table`, plus `heroIdx`, `beat` (`name` alone for 3 s →
  `score` → `breakdown` at 4.5 s → docks into the board at 8 s, all measured from
  `ctl.at`), `docked` and `fresh`. A live `real` reveal always wins; a live
  `practice` plays (tagged "Practice", `#tv-practice`) only when there is none, and a
  real Start takes the screen over at once; a real reveal that has ended hands the
  screen back to a practice still playing. Waiting also covers: ended, auto-ended
  (15 min idle in champion / table, 60 in intro / live), `until` passed, a schema
  too new, a frame with nothing to draw (an empty board is not a frame, so a
  half-written command fails closed rather than leaving a blank stage), a refused
  listener, and **no server clock yet** — until `.info/serverTimeOffset` answers
  nothing is painted from the node (`serverNow()` is NaN, which `tvFrame` reads as
  "no clock"), so a TV with a wrong clock can neither show a stale reveal nor hide a
  live one, and every time comparison uses the SERVER's time, never the TV's.
- **Time moves the screen with no snapshot.** `nextBoundary()` is the soonest of
  every child's `at + 3 / 4.5 / 8 s`, auto-end and `until`; one `setTimeout`
  re-armed after every paint (`armTimer`, +25 ms so it is never early), plus a 30 s
  safety tick and the page coming back to the front. `render()` is deduped by a
  signature (child, id, seq, frame, hero, beat, docked, the places' words), so an
  idle tick touches nothing, and it wraps everything in a try/catch that fails closed
  to Waiting.
- **No replay for a late joiner.** `animate` is true only for a page that was
  already showing a reveal (it watched the change) or a place still inside its first
  3 s (`fresh`): everything else — a reload, a late open — draws the frame as it
  stands (`.hero` without `.enter`, `#board.still` so no rows pop in, no crowning
  barrage), and only a place inside its first 3 s gets its confetti. A Back is a new
  command (`seq`), so the place replays; the same `seq` arriving again is an echo
  and changes nothing. Ties keep the side-by-side layout and a two-way tie keeps the
  shield fight (name beat only; not for a late joiner, a three-way tie or reduced
  motion).
- **The words are the phones' words**: "2 gold · 1 silver · 1 bronze" then
  "verse 4 · cleanup 3 · quick 2" (the second line only when one is non-zero; a
  negative reads with a minus sign), in the hero (`.hero-break .words`) and on the
  board (`.med`) — never medal discs, which mean a place won, never a count (§8.4).
  The intro says "Get ready…" and **never names the first place**: a tie at the
  bottom makes it not the last team's number, and the node carries no group count on
  purpose (a count would tell the room a tie exists before it is revealed). No
  keyboard or click advancing exists (the old handlers are gone): the only document
  listener is `visibilitychange`.
- **Marks are by team id, from files that ship with the page** (`teamMark`): a
  shield that passes `safeCrestSrc` (junior), else the camp's flag drawn from the
  page's own `#flag-*` symbols (senior; the SHAPE by the team's slot, so two flags
  stay apart without colour), else an emoji tile through `safeEmoji`. No P2 team
  photo, colour or emoji a director typed ever reaches this public page. Names come
  from the node through `normalizeRevealPub` (control characters spaced out, cut to
  30) and are `esc()`'d; crests are DOM nodes with `img.src = …`, never concatenated.
- **Connection**: the status line (`#wait-status[data-tone]`) says `connecting`
  until the first answer, `ok` ("Connected · this screen is ready") only when the
  socket is up AND the clock and the feed have answered, `offline` ("Reconnecting…")
  after a drop, ten seconds of never connecting, a refusal or a missing SDK. On a
  reveal's frames the news rides the `#tv-reconnect` chip instead, and the frame
  stays; on return the listener repaints from the node at once. A **refused listener
  is terminal in the SDK**, so the page fails closed (Waiting, the small "Can't reach
  the standings feed" line) and attaches again every 30 s: the rules get published or
  the read is switched back on and the screen comes back by itself. A page whose SDK
  never loaded says the same, and reloads itself (at most three times per tab,
  `sessionStorage`) only once its own update poll proves the network answers.
- **Holds its connection only while visible**: hidden for 60 s → `goOffline()`,
  shown again → `goOnline()`. Spark allows 100 connections at once across both camps,
  every phone and every TV page, and a public page makes it easy for a few curious
  people to open one; a TV never hides, a phone in a pocket does. The kill switch is
  in the R1 notes (one rules line); the connections graph deserves a glance on the
  first real reveal night.
- **Camp choice**: `?camp=junior|senior` (case-insensitive), else the camp this
  device's own app last used (`campScoreboardActiveCamp`, same origin), else
  junior. `tv-camp.js` sets `window.CAMP_FORCE` before `camps.js` loads, and
  `activeCampId()` honours it only when it names a real camp (the app never sets
  it). Everything per-camp then comes from `CAMP`: `dbRoot` (the feed is THIS
  camp's `revealPublic`), team count, default names, emoji, crests and flags. The tab
  title names the camp.
- **Nothing is copied from the app** except the flag shapes / colours
  (`TEAM_FLAG_SHAPES`, `TEAM_FLAG_COLORS`: "keep in sync" with app.js): the page loads
  `defaults.js`, `camp-core.js` (sanitizers), `reveal-core.js` (`tvFrame`,
  `normalizeRevealCtl`, `normalizeRevealPub`, the beat and auto-end constants),
  `tv-camp.js` and `camps.js`. `MEDAL_POINTS`, the double-points window, `emailKey`
  and the orphan filter are gone with the standings maths.
- **The page has its own CSP** (a `<meta>`): no inline script, `script-src 'self'`
  plus the pinned Firebase SDK on gstatic and the database's own `*.firebaseio.com`
  (its long-polling fallback), images `'self' data:`, `connect-src` the database's
  https / wss hosts and nothing else. **The sign-in hosts are gone** (Google's
  accounts and apis, the project's auth domain, the googleapis token services):
  nothing here signs in. It loads no Google Fonts. **A new external host or an inline
  script breaks the page silently** — add the host to this page's meta too, and put
  script in a file.
- **The build stamp lives in two places**: `<meta name="tv-build">` (what the
  page's own 90-second / refocus check reads, falling back to the comment) AND
  the exact text `var TV_BUILD = '<stamp>'` in an HTML comment. A TV left open
  on a v184-or-earlier page, or on the signed-in interim page, polls its own
  address and reads that text with a regex to decide whether to reload; the text
  must stay in the HTML or a stuck TV would never learn about any later build.
  Every TV build keeps both, equal. **A newer build reloads the page only while it
  is waiting** (nothing on the stage); mid-reveal a small `#update-chip` appears
  instead, and the page reloads the moment the reveal is over. Reload the TV once
  after the deploy that ships this page.
- **Practice is public while it plays** (owner-accepted, redesign §4.12 row 19): the
  `practice` child holds only the places it has shown, End deletes it, and no phone
  ever reads it. The Practice switch says so in words.
- **Old pages during the rollout** (§4.11): a signed-in interim page keeps working
  until it reloads into this one and never shows a counselor anything; this page
  against rules that were not published would show Waiting and the small line and
  leak nothing; phones and TVs can be updated in either order (a TV updated first
  just waits).
- **Tests**: `tests/tv.test.js` loads the page's real scripts (in tag order) into a
  vm behind a DOM that records every `innerHTML` and every created element, a fake
  clock that drives `setTimeout` / `setInterval` / `Date.now`, and a fake Firebase
  whose every object throws (and records) on any call the page is not meant to make.
  It pins: the paths (nothing but `<root>/revealPublic` and `.info`), no write, no
  `firebase.auth`, no sign-in text anywhere, exactly two SDK tags with their hashes;
  Waiting and its marks per camp; nothing painted before the clock answers and the
  server's time used over the TV's own; every frame and beat on the page's own timer;
  words not discs; ties; senior flags; the finale; Back; late join; real beats
  practice and a practice returning; ended / expired / idle / too-new reveals;
  hostile names; a refused feed and its retry; no SDK; a drop and a return; hidden for
  60 s; the CSP (no sign-in host); the order of scripts; and the stamp in both places
  with the update rules. `tests/stalling.test.js` pins the standings card's `?camp=`
  link and its team-count table against `camps.js`. The end-to-end run (two remotes and
  a signed-out TV against a local database emulator with the real rules) is
  `tests/emulator/reveal-e2e.cjs` (see "Tests").

## Footer timestamps (More's footer line)

- **"Code last updated"** — `CODE_UPDATED_AT` constant in `app.js`,
  manually bumped (see deploy steps above). It is the tooltip of More's footer
  line (`renderMoreFoot`); the page footer it used to ride is gone.
- **"Data last updated"** — `state.meta.lastDataChangeAt`, stamped by
  `touchData()` at points that represent real scoreboard activity (a game
  result saved, a bracket match recorded, a team renamed). Deliberately
  NOT stamped by view-only actions (switching day tabs, dark mode, sign-in
  unlock) so it reflects actual camp activity, not page traffic. Synced
  across devices like the rest of state. If you add a new way to record
  real data, call `touchData()` there too.

Both timestamps render in camp time (`America/New_York`, formatted via
`formatEasternStamp`), matching the "Happening Now" schedule banner's
convention — never device-local time.

## The notice board (one big, unmissable message)

`state.notice` — synced (in `SYNC_KEYS`, and a `SYNC_SINGLETON`: it's one
composed card, always written whole). Renders into `#notice-board`, the FIRST
section on the page, deliberately larger and louder than an announcement.

Built for send-off-morning cleanup, where six separate announcements filled a
whole phone screen and buried the one line each camper needed. Reach for it
when a single message has structure (per-team assignments, a running order)
and everyone must see it; reach for an announcement when it's one line that
should expire on its own.

- **Composed in the week builder**, More → Set up the week → **Notice**
  (`renderNoticeTab` in settings.js), not typed into a single box: heading,
  intro, per-team assignments, numbered steps with bullets, closing line —
  plus a live preview that renders the real card.
- **Draft or posted, no timer.** `status: 'draft'` means nobody but the editor
  sees it (keep editing indefinitely); `'posted'` puts it on every device until
  someone puts it back to draft. `setNoticeStatus()` is the only way to flip
  it and is editor-gated. There is no auto-expiry by design — the previous
  hardcoded version timed out on a clock, which is wrong for something you
  want up "until the job's done".
- An **empty** posted notice stays hidden rather than rendering a bare box.
- **Anyone following a team** gets their own assignment called out in a strip
  above the list, with their row marked.
- `defaultNotice()` is the seeded example (the Saturday cleanup plan). A
  database that has never had a notice gets it as a **draft** — seeding must
  never post a card by itself.
- `normalizeNotice()` heals what RTDB prunes (empty strings, empty `zones` /
  `steps`, junk rows) and is called from `normalizeSyncedState()`, so it runs
  after every remote merge. Same rule as everything else synced — see the RTDB
  gotcha above.
- Builder form hooks are prefixed **`nb-`** so they can't collide with the
  card's own `notice-` classes: the preview renders the real card, so both
  sets of markup live in the same tab. (They did collide once — card list CSS
  landed on the form's textareas.)
- Editor-typed text is escaped on render; nothing typed into the builder can
  inject markup.

## Hiding sections from viewers (More → What counselors see)

Four sections carry an editor-only switch in **More → Director → What counselors
see** (`#sheet-counselors`, `.hide-card-toggle[data-hide-card="<key>"]`): Games,
Memory verse, Meal cleanup, Chat. Flipping one adds that key to
**`state.meta.hiddenCards`** — synced, so it applies on every device — and
view-only devices then don't render the section at all. Editors always see
every section. (This used to be a "🙈 Hide from viewers" switch on each home card;
the switches moved when the cards left Now. Same data, same keys.)

- Keys are the sections' `data-card` values (the Games list, More's two Camp
  rows, the two secret sections) listed in `HIDEABLE_CARDS` (app.js); Chat has no
  element to hide — its tab says "Chat is turned off right now".
- All of it is applied centrally by `applyCardVisibility()`, called at the
  TOP of `renderAll` — before `renderGameView`, because hiding Games
  also has to close a viewer's open game detail (otherwise the hidden section's
  content stays readable).
- Hiding closes an open Memory verse / Meal cleanup sheet for viewers, so a later
  un-hide never surfaces it already on screen.
- These are deliberately NOT `touchData()` moments — a display preference is
  not scoreboard activity, so they don't bump "Data last updated".
- RTDB prunes `hiddenCards` away entirely once it's empty (all sections shown);
  `normalizeSyncedState` heals it back to `{}`, and readers must tolerate it
  being missing. A legacy `state.meta.standingsHidden` boolean from the
  standings-only first version is still honored on read.

## History / why these rules exist

- A bracket-format bug (blank screen after "Start Bracket") was fixed and
  pushed to a feature branch, but a PR had already merged an earlier
  commit into the live branch — the fix itself sat unmerged while the bug
  kept reproducing live, mid-camp. Hence: push straight to `main`, and
  verify against the live URL before calling anything fixed.
- The repo's live branch used to be named `claude/festive-bohr-Wt6Np` (the
  actual default branch GitHub Pages served from), while a separate,
  long-stale branch literally named `main` pointed at an old, unrelated
  domain (`tripplanner.doofus.live`). Both have since been reconciled:
  `main` now mirrors what was live, and the old stale `main` is preserved
  at `archive/main-tripplanner-old-2026-07-19` in case anything from it is
  ever needed. If `main` doesn't seem to control deployment, check that
  the GitHub repo's default branch and Pages source are actually set to
  `main` in Settings — that manual flip may still be pending.
