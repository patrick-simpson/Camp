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
  leaves it unset) and `html.view-only` for a viewer-hinted device. A second
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
- `app.js` — main logic + the week schedule (`DAY_SCHEDULE`), ~9500 lines
- `defaults.js` — the built-in default week: day list + full game catalog
  (`defaultConfig()`); live config then lives in synced state
- `camps.js` — the TWO CAMP PROFILES (see "Two camps, one app" below):
  junior + senior, each with its Firebase root, storage namespace, team
  branding, printed daily schedule, and seed data. Loads between defaults.js
  and app.js; app.js reads everything through the active `CAMP`
- `settings.js` — the settings sheet + week-builder UI. The builder's
  `jelly-tabs` shell is built ONCE and kept; `renderSettings` refreshes only
  the active card (through `setHtmlIfChanged`), hidden cards are filled one
  per idle slice after it (`prefillBuilderCard`) and refreshed when their tab
  is shown, and the page scroll is put back after every refresh — so a remote
  config echo no longer rebuilds five cards, re-springs the tab pill or throws
  the page to the top. `builderDirty()` counts only an OPEN game editor with
  edits (a stranded draft must not freeze sync or the auto-reload), Back and
  tab switches never silently discard it, and a tab other than Games carries an
  "Unsaved changes" reminder while one is open
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
- `styles.css` — all styling (design tokens at the top, light + dark)
- `firebase-config.js` — sync config (also used by Firebase Auth sign-in)
- `auth-email-link.js` / `auth-phone.js` — optional alternative sign-in
  methods (emailed link; phone number + texted code). Each loads via a guarded
  global (`window.CampEmailLink` / `window.CampPhone`) and mounts into the
  "Alternative sign in" disclosure; delete one script tag to drop that method.
  Google is the primary button and always remains.
- `vendor/jelly.js` — vendored Jelly UI web components (chips, buttons,
  drawers, dialogs); it injects `--jelly-*` design tokens on :root at
  runtime, which the app's `--color-*` tokens re-source. It carries LOCAL
  patches (grep `Local patch`: the external-removeAttribute close race, and
  the drawer/dialog scrim fade — `jellyScrimFade`) that a re-vendor must
  re-apply; `tests/overlays.test.js` runs the real helpers extracted from it
- `sw.js` — notification + push service worker (deliberately NO fetch
  handler, so it can never serve stale code; kill-switch documented inside).
  Registered as `sw.js?v=<PUSH_SW_VERSION>&push=<worker url>` by push.js
- `tests/` — `node tests/run.js`, no dependencies, never served to the
  browser (see "Tests" below). `tests/emulator/` (rules in the RTDB
  emulator) and `tests/push-e2e/` (the alert sender in real workerd) are
  opt-in suites that need npm + Java
- `current-standings.html` — self-contained TV/presenter standings page
  (duplicates a few constants from app.js — marked "keep in sync")
- `stalling.html` — self-contained presenter gag page
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
   TWELVE on the same number: `boot-guard.js`, `styles.css`, `vendor/jelly.js`,
   `firebase-config.js`, `defaults.js`, `camps.js`, `app.js`, `settings.js`,
   `chat.js`, `push.js`, `auth-phone.js`, `auth-email-link.js` — keep them in sync,
   all bumped together. Also bump
   `APP_VERSION` in `app.js` to the same number (it drives the auto-reload
   version check). `current-standings.html` and `stalling.html` load
   `vendor/jelly.js` (and current-standings loads `firebase-config.js`) with
   the same `?v=` scheme — bump those references too. (The Firebase SDK
   `<script>` tags are pinned to the SDK version, not `?v=`; `manifest.json`
   and `apple-touch-icon.png` have their own `?v=`, only bumped when those
   files actually change.)
2. Update `CODE_UPDATED_AT` near the top of `app.js` to the current UTC
   time (`date -u +%Y-%m-%dT%H:%M:%SZ`) — this drives the "Code last
   updated" line in the page footer. There's no build pipeline to stamp
   this automatically, so it's a manual step, easy to forget.
   `current-standings.html` has its own `TV_BUILD` stamp — bump it when
   that file changes.
3. Run `node tests/run.js`, then `node --check` every changed JS file,
   before committing (see "Tests" below).
   **If you touched `database.rules.json`, it is not live until it is pasted
   into the Firebase console** — the tests only check the file.
   **If you bump the Firebase SDK version**, the three `<script>` tags in
   `index.html` and `current-standings.html` carry `integrity="sha384-…"`
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
assets together, as always). Every device gets a dismissible "tap to
refresh" bar (`#update-banner`) and auto-reloads only once `reloadBlocked()`
says it's safe (rechecked inside the final 1.2 s, retried every 12 s):
for EVERY role, no unconfirmed write (`pendingWrites > 0` — the SDK's
offline queue is in memory only, so a reload would lose it), no running
Pictionary lap (`liveWatches`), and no chat message being typed into a
focused composer or still sending (`chatComposerBusy`); for editors, also
not mid-entry (`editorMidEntry`: a focused score field, or a queued data
push). A synced game clock deliberately does NOT block it (its `endAt` is in
the database and survives a reload).
The bar's own tap asks first (`wireReloadBanner`: `reloadBlocked()` sampled at
pointerdown, since the tap itself blurs the composer) instead of reloading
past an unsent message or a typed score. Bottom-strip layout (styles.css, one
block next to `.update-banner-alert`): at home the bar sits at `bottom: 1rem`
with the toaster lifted above it (8rem); in chat (`body.chat-open`) the bar is
lifted to 5.5rem so it never covers the composer, and the toaster to 12rem to
clear both (5rem when there is no bar); the SDK-down pill, when it shares
the strip with the bar, stacks above it (6.5rem at home, 12rem in chat). The
toaster takes taps, so a toast over the composer swallowed Send and one over
the bar swallowed Refresh — change the offsets together (`overlays.test.js`
pins their order). `showToast` keeps at most
`TOAST_MAX_VISIBLE` (3) on screen, dismissing the oldest that isn't a "Your
team…" toast.
The reload uses `doReload` (adds a throwaway `?r=` cache-buster) so it
fetches the fresh `index.html` instead of a cached copy and can't loop.
(A phone only starts polling once it's running a build that has this code,
so it auto-reloads from the *next* deploy after it loads this one.)

## Tests

`node tests/run.js` (optionally with a filename filter: `node tests/run.js
sync`). Zero dependencies, no network, ~1 second. **Run it before every
commit**, alongside `node --check`.

`tests/harness.js` loads the real `defaults.js` + `app.js` + `settings.js` into
a Node `vm` context behind a small DOM stub, so the tests exercise the exact
code the site ships — there's no build step and no second copy of the logic to
drift. Each `*.test.js` file gets its own freshly-loaded context, so one file's
mutations of `state` can't leak into another's. Because top-level `let`/`const`
in a vm script land in the context's global lexical scope, test files reference
`state`, `medalCounts`, `SYNC_KEYS`, … directly, exactly as app.js does.
`document.addEventListener` calls made at load are recorded (never fired by
the harness itself) in `__docListeners[type]`, so a test can reach the
delegated handlers — the joy-press pointer handlers, the card `toggle`
listener, the failed-module tap-to-close — by event type.

Nothing in `tests/` is referenced by `index.html`, so adding to it cannot
change what a browser loads.

What's covered, and why each file exists:
- `scoring.test.js` — score parse/format edges, `esc()`, `medalCounts()`
  (including double points and orphaned results), bonus buckets, tie-breaks.
- `sync.test.js` — **every invariant in the section below**, plus the deferred-
  snapshot and per-path-diff behavior. A failure here is a regression, not a
  test bug.
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
  keeps it out of the bar's shape check). Panels that are SUPPOSED to change
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
- `game-view.test.js` (the rules above: live-html skip, kept forms firing real
  handlers after a state swap, celebrations only for scoring), `home.test.js`
  (home panels, toast cap, announcement composer), `overlays.test.js` (schedule
  sheet, update bar, members drawer, lock screen, scrim fade, pickers),
  `builder.test.js` (week-builder shell, drafts, joy press), `chat-view.test.js`
  (chat view lifecycle, drafts, Back), `theme.test.js` (pre-paint theme and
  atomic flips) — each pins the state rules behind a glitch fix. Anything only
  visible in a browser (animation, layout) is source-checked or left to the
  Playwright pass.
- `contrast.test.js` — danger red as TEXT. `--color-danger` is a fill tuned to
  carry white text; any rule that colours text red uses `--color-danger-text`
  (light `#b42318`, 6.57:1 on white; dark `#ff8a8a`). The test pins the token
  values' contrast and fails if a bare `color: var(--color-danger)` comes back.
- `owner-row.test.js` — the owner's Members row is read-only, and the client
  constant matches the rules literal in both camps.
- `settings-crud.test.js` — the classic builder's create / edit / delete paths
  (`validateGameDraft`, `saveGameDraft`, `duplicateGame`, `deleteGame`,
  `deleteDay`, reorder, `pruneOrphanedGameData`). Everything the app keeps under
  a game id is ONE list in settings.js, `GAME_RECORD_MAPS` (result, bracket,
  score entry, live match, clock, drawing setup): a format change names and
  clears all of it after one confirm, `deleteGame` and the import / restore
  prune drop all of it (the clock used to be left behind — a "running" clock
  with no game to settle it). Add a new per-game synced map there.
- `auth.test.js` — the `emailKey` contract (multi-dot/case/trim — the
  regression that would lock people out under the rules), the `canEdit` truth
  table via `setMemberRole`, the `memberRecord` shape, `clearLocalData`'s
  wipe list, and that no PIN machinery survives.

The stub is deliberately minimal, and DOM lookups return a memoized stub element
rather than null (closer to the real page, where a render function's container
always exists). Tests assert on state and return values, never on markup —
anything needing real layout belongs in the Playwright pass.

## Two camps, one app (junior + senior)

Since 2026-07-25 this codebase serves TWO camps: **junior** (the original)
and **senior** (ages 13–18; 4 teams with flags, no electives, different
daily schedule). Everything per-camp lives in a profile in `camps.js` —
`CAMPS.junior` / `CAMPS.senior` — and `CAMP` is the active one, chosen
per-device by `localStorage.campScoreboardActiveCamp` (junior is the
default, so pre-camps devices behave identically).

- **Junior is byte-identical to the single-camp app.** Its `dbRoot` is the
  original `campScoreboard` literal and its `storageSuffix` is `''`, so
  every Firebase path and localStorage key is exactly what it always was —
  `tests/camps.test.js` pins this, plus a deep-equal of the whole junior
  week data against `tests/fixtures-junior-week.json` (dumped before the
  move). Senior lives under the SIBLING root `seniorScoreboard/*` with
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
- **Switching camps is ALWAYS set-key-then-reload** (`switchCamp()`), never
  re-pointing refs in place — the listener lifecycle is one-shot (a
  cancelled read is terminal). Dual-camp accounts get the camp picker
  **once** — the first time the device discovers both camps
  (`campScoreboardCampAsked`) — and the choice is then remembered (the
  active-camp key IS the memory). Owner's revised call, 2026-07-25;
  ask-every-launch was the original behavior. The camp question outranks
  the team picker — the team question is held while the camp dialog is open
  and re-asked on its close. Mid-session switching: the Settings **Camp
  segmented switcher** (`#camp-switch`) + the footer camp chip (both only
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
  member-injection attempt) return `Permission denied`. The senior owner
  record `seniorScoreboard/members/patricksimpson,fx@gmail,com` is seeded
  editor via the console Data tab and is rules-immutable, same as junior's.
  (First seeding attempt landed NESTED INSIDE campScoreboard — the console's
  per-row + is easy to hit one level down; the fix was delete + re-add via a
  direct path URL. Check indentation when console-seeding.)
  `current-standings.html` is junior-only until it grows a `?camp=` switch
  (planned).

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
  else is opt-in via the 🔔/🔕 bell in the chat header (`toggleChatSub`).
- **The banner strip**: a message posted in the Announcements channel also
  rides the top-of-app announcements area for 15 minutes
  (`chatAnnouncementBanners`, merged in by `renderAnnouncements`,
  dismissible through the same dismissed set; `CHAT_BANNER_MS`). Chat-
  sourced banners carry no "remove for everyone" (delete the message in
  chat instead).
- **Mentions are AUTOMATIC** (no @ syntax): `chatMentionTargets()` = every
  member-directory name (+ first names), `TEAM_COUNSELORS`, team names,
  `TEAM_ABBREV`; `mentionScan` is word-boundary, case-insensitive,
  longest-match-wins (pure — tests/chat.test.js). "Mine" = my
  `memberName`/`state.identity`/identity key/`memberTeamId`/
  `state.followTeam`. Rendering walks the RAW string and escapes each
  segment (`renderChatText`) — never regex over escaped HTML.
- **Unread**: per-camp seen map `lsKey('campScoreboardChatSeen')`
  (`{ch: lastSeenMs}`, wiped by `clearLocalData`); unread = other
  people's messages after lastSeen. Badges on the home card + channel
  tabs; seen marked while the channel is open and the tab visible.
- **UI**: home card `#chat-card` (`data-card="chat"`, in `HIDEABLE_CARDS`
  — hide-from-viewers is the editors' kill switch and force-closes a
  viewer's open chat) → full-screen `#chat-view` via `body.chat-open`
  (builder-style takeover; `state.ui.chatOpen`/`chatChannel`,
  device-local). The shell (header, tab strip, list, composer) is BUILT once
  per open (`buildChatShell`, also when the viewer's role flips — the 🧹
  button is the one role-dependent part); a channel switch, bell toggle or
  directory update only PATCHES it in place (`updateChatShell`: active tab,
  header, composer placeholder, the list through `setHtmlIfChanged`), and a
  non-forced `renderChatView` is a no-op while `chatViewBuiltFor` already
  matches — `renderAll` runs it on every snapshot. So the composer node
  survives a channel switch (iOS won't re-focus a detached input: the keyboard
  would drop) and live messages append incrementally. Half-typed text lives
  in the in-memory `chatDrafts` (per channel, never localStorage, gone on
  sign-out) and follows the person across channel switches and a
  close/reopen. Every handler reads the channel at call time
  (`chatCurrentChannel`), never closed over at build time. The header names
  the open channel by its SHORT label; under 480px the tab strip shows
  emoji only (label kept for screen readers) and the unread badge sits on
  the tab's corner out of flow. "Sync is off" is only said when it is
  definitive (`chatSyncOff`: no config, SDK failed, or a rules refusal);
  otherwise the list reads "Loading…", and app.js's `onSdkLoadFailed` calls
  the typeof-guarded `onChatSyncStateChanged` so it flips at once.
  **Phone Back closes chat**: opening pushes one history entry
  (`chatHistoryPush`, state `{campChat:1}`); `wireChat`'s `popstate` listener
  closes the chat when it's popped; closing from the ← Camp pill pops it back
  off (`chatHistoryPop`), and `renderChatCard` hands back a stale entry when
  `renderAll` closed the chat itself. Chat only — settings and game detail
  still have no history entry of their own.
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
  blocks + `weekStart`, editor-written — the schedule is JS in camps.js and
  the Worker can't run JS, so editor devices publish it as data and
  re-publish automatically when the code's schedule changes), `pushAlerts`
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
  public counter poked into the locked DB). No public access.
- **Two roles, from the member record only** (never from anything on the
  device): `viewer` (counselors — read-only; deliberately can't touch their
  own team's points) and `editor` (directors/game leaders — edit scores AND
  manage the member list). `canEdit()` still gates ~28 call sites; its backing
  store swapped from localStorage to `memberRole`, set by `setMemberRole()`.
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
  included). `current-standings.html` duplicates this — keep in sync.
- **Member record**: `{ role, name?, teamId?, addedBy, addedAt }`
  (`memberRecord()`; `name`/`teamId` omitted, not null, when empty). Built at `campScoreboard/members`,
  editor-managed via Settings → **Who can sign in** (`renderMembers`). Your
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
- **Live revocation**: the member self-read stays an `.on('value')` — a
  removal cancels it (→ not-approved kick + `clearLocalData()`), a role change
  fires a fresh snapshot (→ `setMemberRole` re-renders in place).
- **Pre-paint hint**: `campScoreboardAuthHint` (`'viewer'|'editor'`) caches
  the last confirmed role so a returning approved device paints instantly from
  local state while auth re-confirms; index.html's guard reads the same key.
  Convenience only — a forged hint shows an empty shell (rules refuse all
  data). Same literal lives in the index.html pre-paint guard. A second hint,
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
  theme hint, the parked email) plus IndexedDB photos (`clearPhotos`), then
  reloads. Theme is NOT preserved — the boot guards discard partial state, so
  it resets to Auto.
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
  2026-07-26 — member-readable with no validation and no feature behind them.
  Don't re-add a path before its feature, and when a camper roster is real it
  wants EDITOR-only read, not member read.)
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
  from an imported backup can't bounce the whole `set()`. Known hole, accepted:
  `state/<unknown>/<child>` still passes, because `$other` is an ancestor of
  that path and RTDB never evaluates ancestor `.validate`. Closing it means
  moving `.write` onto each of the twelve children — all-or-nothing, and not
  worth it against a threat model of a few known directors.
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

## Counselors ↔ teams ↔ accounts

A member record can carry a **`teamId`** (`'t0'`…`'t5'`) — the team that
person is ON. It's set per-row in Settings → **Who can sign in**, and it does
three things.

**1. The app opens on their team.** `adoptMemberTeam()` (called from
`maybeShowTeamPicker()` and again whenever the member snapshot changes)
points `state.followTeam` at their team and takes the picker back down if a
hint-painted device already opened it. It **overrides a hand-picked team** on
purpose — the account is the truth. Their follow card says "YOUR TEAM" where
the Change button would be. Their member `name` also becomes `state.identity`,
but only when `TEAM_COUNSELORS` actually lists that name — the electives data
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
  the roster), not seeded. Known limit: two tabs of the SAME camp on one
  device can overwrite each other's unconfirmed edits in the shared cache —
  use one tab per camp.
- **An identical snapshot keeps the live objects.** `applyRemoteState`
  restores the previous `state[k]` references when the signature didn't
  change — open tally/bracket/notice views close over those objects, and an
  idle re-fetch of our own write used to detach them so every later tap was
  silently not saved.
- **Concurrent editors don't clobber each other:** tally `drafts` are diffed
  per score/medal leaf (a NEW draft too), `meta` per field and `hiddenCards`
  per card (`teams` and `notice` are still written whole). Verse/cleanup
  points use deterministic ids (`verse-<team>-<dow>`,
  `cleanup-<team>-<dow>-<meal>`) so two devices write one slot, not two.
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
  superseded. The same tick also drains `pendingRemoteConfig` (which used to
  be flushed only by a focusout inside the week builder) and pays off an owed
  render: a BACKGROUND event — a game clock settling at 0:00, the staff list
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
is entirely missing. Once a week has been set up (Settings → Set up the
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

## Footer timestamps

- **"Code last updated"** — `CODE_UPDATED_AT` constant in `app.js`,
  manually bumped (see deploy steps above).
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

- **Composed in the week builder**, Settings → Set up the week → **Notice**
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

## Hiding home panels from viewers

Each of the five home cards carries an editor-only "🙈 Hide from viewers"
`jelly-switch` (`.hide-card-toggle[data-hide-card="<key>"]`, in a
`.card-visibility-row` that CSS hides for `html.view-only`). Flipping one adds
that card's key to **`state.meta.hiddenCards`** — synced, so it applies on
every device — and view-only devices then don't render the card at all.
Editors always see every card, including the switch that governs it.

- Keys are the cards' `data-card` values, listed in `HIDEABLE_CARDS` (app.js).
- All of it is applied centrally by `applyCardVisibility()`, called at the
  TOP of `renderAll` — before `renderGameView`, because hiding Competitions
  also has to close a viewer's open game detail (otherwise the hidden card's
  content stays readable).
- Hiding force-closes the card for viewers, so a later un-hide doesn't pop it
  out already expanded (matches the closed-by-default rule).
- These are deliberately NOT `touchData()` moments — a display preference is
  not scoreboard activity, so they don't bump "Data last updated".
- RTDB prunes `hiddenCards` away entirely once it's empty (all cards shown);
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
