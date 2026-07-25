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
- `camps.js` — the TWO CAMP PROFILES (see "Two camps, one app" below):
  junior + senior, each with its Firebase root, storage namespace, team
  branding, printed daily schedule, and seed data. Loads between defaults.js
  and app.js; app.js reads everything through the active `CAMP`
- `settings.js` — the settings sheet + week-builder UI
- `styles.css` — all styling (design tokens at the top, light + dark)
- `firebase-config.js` — sync config (also used by Firebase Auth sign-in)
- `auth-email-link.js` / `auth-phone.js` — optional alternative sign-in
  methods (emailed link; phone number + texted code). Each loads via a guarded
  global (`window.CampEmailLink` / `window.CampPhone`) and mounts into the
  "Alternative sign in" disclosure; delete one script tag to drop that method.
  Google is the primary button and always remains.
- `vendor/jelly.js` — vendored Jelly UI web components (chips, buttons,
  drawers, dialogs); it injects `--jelly-*` design tokens on :root at
  runtime, which the app's `--color-*` tokens re-source
- `sw.js` — notification-only service worker (deliberately NO fetch
  handler, so it can never serve stale code; kill-switch documented inside)
- `tests/` — `node tests/run.js`, no dependencies, never served to the
  browser (see "Tests" below)
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
   NINE on the same number: `styles.css`, `vendor/jelly.js`,
   `firebase-config.js`, `defaults.js`, `camps.js`, `app.js`, `settings.js`,
   `auth-phone.js`, `auth-email-link.js` — keep them in sync, all bumped
   together. Also bump
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
- **Live revocation**: the member self-read stays an `.on('value')` — a
  removal cancels it (→ not-approved kick + `clearLocalData()`), a role change
  fires a fresh snapshot (→ `setMemberRole` re-renders in place).
- **Pre-paint hint**: `campScoreboardAuthHint` (`'viewer'|'editor'`) caches
  the last confirmed role so a returning approved device paints instantly from
  local state while auth re-confirms; index.html's guard reads the same key.
  Convenience only — a forged hint shows an empty shell (rules refuse all
  data). Same literal lives in the index.html pre-paint guard.
- **One-shot lifecycle**: voluntary sign-out and re-sign-in-after-teardown
  both end in `location.reload()` — no listener re-attachment machinery, since
  the terminal-fbRef design can't be safely restarted in place.
- **Sign-out** (`signOutAndClear`) wipes the camp data cached on the device
  (`clearLocalData`: STORAGE_KEY, day ranks, dismissed banners, the hint, the
  parked email) plus IndexedDB photos (`clearPhotos`), then reloads. Theme is
  NOT preserved — the boot guards discard partial state, so it resets to Auto.
- **Rules are PUBLISHED and enforced** (2026-07-25). Verified after the flip:
  unauthenticated reads of state/config/members/changelog/roster/contacts, a
  write probe, and a self-escalation attempt all return `Permission denied`.
  The owner key `patricksimpson,fx@gmail,com` is seeded editor and immutable
  from clients — the console Data tab is the only way to change it, and the
  permanent break-glass path.
- **Rules live in the Firebase console**, not this repo (there's no deploy
  pipeline for them). The current ruleset + a click-by-click console runbook
  are in the plan that shipped this change; the shape is: per-child gates
  (rules cascade — nothing granted at the `campScoreboard` root), reads need
  membership, writes need `role === 'editor'`, `email_verified` required,
  changelog append-only + editor-read, presence per-child member-writable,
  `roster`/`contacts` pre-gated for future PII, owner key immutable.
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
  superseded. The same tick also drains `pendingRemoteConfig`, which used to
  be flushed only by a focusout inside the week builder.
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
