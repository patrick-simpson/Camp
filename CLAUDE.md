# Camp Scoreboard — CLAUDE.md

## What this is

A static, vanilla JS/HTML/CSS web app (no build step, no framework, no
`package.json`) that runs camp game scoring for a week-long kids' camp.
Deployed via GitHub Pages at **camp.patricksimpson.info**. Every game and
schedule detail is hardcoded data — there's no backend beyond an optional
Firebase Realtime Database used purely for cross-device sync.

Files:
- `index.html` — page shell
- `app.js` — main logic + the week schedule (`DAY_SCHEDULE`), ~6400 lines
- `defaults.js` — the built-in default week: day list + full game catalog
  (`defaultConfig()`); live config then lives in synced state
- `settings.js` — the settings sheet + week-builder UI
- `styles.css` — all styling (design tokens at the top, light + dark)
- `firebase-config.js` — sync config
- `vendor/jelly.js` — vendored Jelly UI web components (chips, buttons,
  drawers, dialogs); it injects `--jelly-*` design tokens on :root at
  runtime, which the app's `--color-*` tokens re-source
- `sw.js` — notification-only service worker (deliberately NO fetch
  handler, so it can never serve stale code; kill-switch documented inside)
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
   SIX on the same number: `styles.css`, `vendor/jelly.js`,
   `firebase-config.js`, `defaults.js`, `app.js`, `settings.js` — keep
   them in sync, all bumped together. Also bump `APP_VERSION` in `app.js`
   to the same number (it drives the auto-reload version check).
   `current-standings.html` and `stalling.html` load `vendor/jelly.js`
   (and current-standings loads `firebase-config.js`) with the same `?v=`
   scheme — bump those references too. (`manifest.json` and
   `apple-touch-icon.png` have their own `?v=`, only bumped when those
   files actually change.)
2. Update `CODE_UPDATED_AT` near the top of `app.js` to the current UTC
   time (`date -u +%Y-%m-%dT%H:%M:%SZ`) — this drives the "Code last
   updated" line in the page footer. There's no build pipeline to stamp
   this automatically, so it's a manual step, easy to forget.
   `current-standings.html` has its own `TV_BUILD` stamp — bump it when
   that file changes.
3. `node --check` every changed JS file before committing — cheap syntax
   safety net for a codebase with no test suite.
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
assets together, as always). Viewers reload almost immediately; an editor
mid-score-entry (`editorMidEntry`: a focused input, or a queued/in-flight
data push) gets a dismissible "tap to refresh" bar (`#update-banner`) and
auto-reloads only once it's safe — so a score being typed is never lost.
The reload uses `doReload` (adds a throwaway `?r=` cache-buster) so it
fetches the fresh `index.html` instead of a cached copy and can't loop.
(A phone only starts polling once it's running a build that has this code,
so it auto-reloads from the *next* deploy after it loads this one.)

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

Two more sync invariants (both fixed after live testing exposed them —
don't regress these):
- **Never push before the first pull.** `pushState()` is gated on
  `remoteReady`, which flips true only when the first server snapshot
  arrives. Without it, a device on slow wifi that saves anything before
  its first sync queues a `set()` of stale local state that wipes
  everyone's newer scores on connect.
- **A snapshot key that's missing means "empty", not "keep mine".** The
  remote merge replaces `results`/`brackets`/`drafts`/`picRounds`/`meta`
  with `{}` when absent from the snapshot (RTDB prunes empty objects, so
  absence IS the empty state). Only `teams` is guarded. Treating missing
  as keep-local made "New week (reset)" silently fail to propagate.

## Footer timestamps

- **"Code last updated"** — `CODE_UPDATED_AT` constant in `app.js`,
  manually bumped (see deploy steps above).
- **"Data last updated"** — `state.meta.lastDataChangeAt`, stamped by
  `touchData()` at points that represent real scoreboard activity (a game
  result saved, a bracket match recorded, a team renamed). Deliberately
  NOT stamped by view-only actions (switching day tabs, dark mode, PIN
  unlock) so it reflects actual camp activity, not page traffic. Synced
  across devices like the rest of state. If you add a new way to record
  real data, call `touchData()` there too.

Both timestamps render in camp time (`America/New_York`, formatted via
`formatEasternStamp`), matching the "Happening Now" schedule banner's
convention — never device-local time.

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
