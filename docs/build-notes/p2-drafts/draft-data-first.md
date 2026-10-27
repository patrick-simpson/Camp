# Project 2 — Setup UX rebuild: technical spec (draft, DATA-MODEL-FIRST angle)

Status: draft for judging (one of three). Written 2026-10-27 against `main` @ 63005d9
(APP_VERSION 183). Nothing in the app was changed to write this. Line numbers are
`file:line` at that commit.

Angle: design the synced data for the whole week first, so per-field merge, offline
survival, undo and restore points are *properties of the data and one sync engine*,
not features bolted onto each screen. The UI is derived from that model at the end.

Evidence used beyond the code maps: a throwaway prototype (scratchpad only, not
committed) that seeds the proposed schedule model from `DAY_SCHEDULE`, resolves it
back, and compares. Results are quoted in section 11.3; they are the main reason this
draft is confident the junior camp can stay byte-identical.

---------------------------------------------------------------------------------

## 0. The design in one screen

| Concern | Decision |
|---|---|
| Where new setup data lives | A NEW sibling node per camp, `<root>/setup`, id-keyed maps only, never arrays. Not inside `config` (old clients `set()` it whole and prune unknown keys) and not inside `state` (sealed, atomic score pushes). |
| Schedule shape | One or more *templates* ("Typical day") + 7 fixed day records `sun..sat`. A day either uses a template (then carries sparse per-day `edit` / `hide` / `own` records) or owns all its blocks. Block ids are stable (`b-…`), so games, meals, alerts and undo can point at them. |
| Games | Move to `<root>/setup/games/<gameId>` with `day` + `block` (attachment) and `ord`. The legacy `config` node becomes a *derived mirror* that old cached clients keep reading; in memory `state.config` is derived from setup so every existing reader keeps working. |
| Teams | Stay in `state.teams` (the Worker and TV already read it). Fixed slots `t0..tN`. New optional fields `short, emoji, color, photoV`. The state engine diffs `teams/<i>/<field>` instead of the whole array. Photos live in `<root>/teamPhotos/<tid>`. |
| People | The members list stays the ONE team list (accounts + "no sign-in yet" rows). New `<root>/accessRequests/<identityKey>` for walk-ups. Camper first names in `<root>/campers/<tid>/<cid>`, **editor-only read in the rules**. |
| Sync engine | One generic "domain sync" engine (`setup-sync.js`) cloned from the proven `state` engine: persisted confirmed baseline, three-way first-snapshot merge, leaf-level diffs, first-pull gate, in-flight accounting, poison-path quarantine. Instantiated twice: `setup` and `campers`. The `state` engine is only extended (teams/notice per-field, `brackets4`, epoch, quarantine), never rewritten. |
| Undo | Per device, from the engine's own diffs: `[domain, path, before, after]` ops, conflict-aware (only reverts a path still holding what we wrote). |
| Restore points | `<root>/setupRestore/<id>` (body as one JSON string) + `<root>/setupRestoreIndex/<id>` (metadata). Editor-only, create/delete only, nobody listens. Automatic before every destructive or bulk action and once per editing session. |
| New year | `epoch` in `setup/meta` + `state/meta`; archive written and verified first; then ONE atomic multi-path update at the camp root clears scores, bumps the epoch, and (optionally) clears team assignments and campers. Stale offline devices from last year are refused by an epoch check. |
| Junior safety | Until an editor flips `setup/meta/live` for that camp, every accessor returns the existing `camps.js` constants (the same objects). The fixture test is untouched. Flipping `live` back to `false` in the app or in the console is the instant rollback. |
| Rollout | 9 stages. Each stage that needs rules ships its rules first (additive, inert for old clients), then code that degrades cleanly if the rules aren't there yet. Two deliberate "fence" rules land only after the new code is the live one. |

---------------------------------------------------------------------------------

## 1. Goals and non-goals

### 1.1 Goals (from the owner interview, all confirmed)
1. Every editor can run setup; laptop for the big setup, phone mid-week; several at once.
2. New-year wizard: copy last year → archive last year → clear scores. Then a checklist
   hub with ✅/⚠️ per section.
3. Week is always Sun–Sat; setup asks "which Sunday does camp start?".
4. Schedule: build one typical day, use it Mon–Fri, then per-day one-offs ("just this
   day" vs "every day like it"). Arrival (Sun) and send-off (Sat) are separate days.
5. Teams: fixed counts (junior 6, senior 4): name, colour from a light/dark-safe
   palette, emoji, optional photo (shield/flag).
6. People: typed roster, trickle-in, walk-ups requesting access, all in one team list.
   Camper first names per team, editor-only, enforced by the rules.
7. Editable and seeded from today's data: meals, verses (+ theme), cleanup rota, junior
   electives.
8. Games attached to schedule blocks; finished 4-team bracket (2 semis → 3rd-place →
   final) for senior.
9. Curveballs: rain shuffles, two editors at once (per-field merge + "Jenn is also
   here"), bad Wi-Fi (offline edits survive reload/force-quit).
10. Safety: undo and automatic restore points.
11. A mid-week schedule change alerts that block's phone-alert subscribers.
12. Outputs: TV standings page for both camps (`?camp=`), full-week `.ics`.
13. Deferred Project-1 items (section 13).

### 1.2 Non-goals
- The home-screen layout redesign (separate interview). This spec only guarantees the
  seam: home consumers read through accessors (section 7) and the derived
  `state.config` keeps its shape.
- Date-aware "camp hasn't started / is over" banner behaviour. The app stays
  day-of-week driven; `weekStart` is used by alerts, `.ics`, double points and the
  wizard only. (Owner decision D11 can promote it later; the accessor `campDateFor`
  makes it a small change.)
- A live calendar subscription feed (needs a public URL; the Worker has no route and a
  10 ms CPU budget). Export is a downloaded file.
- Parallel semifinals on two fields (one `live` slot per game stays).
- Cloud Functions, Firebase Storage, Blaze plan, App Check, any build step.
- Changing the auth model or the viewer/editor roles.

---------------------------------------------------------------------------------

## 2. Constraints that drive every decision (verified in code)

C1. `config` is written as a whole-node `set()` of exactly five keys by every editor
    (`pushConfig` app.js:2354, `CONFIG_KEYS` 2346) and sealed by the rules
    (`$other:false`, database.rules.json:67). Old clients reset non-array
    `games/days/sessions` to `[]` (`migrateState` app.js:1932). ⇒ never add keys to
    `config`, never change its shape in place.

C2. `state` is sealed to `SYNC_KEYS` (rules 45-47) and every push is ONE atomic
    multi-path `update()` (app.js:2922). One refused path refuses the batch and the
    same batch is retried forever with only `console.warn` (2927-2931). ⇒ rules before
    any new `state/<key>`, and the engine needs a quarantine for refused paths.

C3. Only `state` has offline durability: `_syncBase` + three-way `firstSnapshotMerge`
    (2530-2590) + `pendingWrites`. Config edits are lost on reload and invisible to
    `reloadBlocked` (7764) / `hasUnconfirmedLocalWork` (8536).

C4. RTDB prunes `null`, `{}` and `[]`, and returns a map with dense numeric keys as an
    ARRAY. ⇒ no numeric keys anywhere new (`sun..sat`, `s0..s2`, `b-…`, `t0..`), and
    "absent" must have a defined meaning per section.

C5. `.read` cascades. `state`, `config`, `members`, `presence` are member-readable. ⇒
    camper names need their own top-level node with an editor-only `.read`.

C6. RTDB never evaluates an ancestor's `.validate` for a deeper write (the documented
    `state/<unknown>/<child>` hole). ⇒ field rules must sit on the leaves; a leaf can
    check its record still exists with `newData.parent().child(<anchor>).exists()`.

C7. Rules are hand-published (Cloud Shell PUT) and not versioned with code. Old cached
    clients live for minutes (auto-reload, app.js:7692) to days (offline phones).

C8. Spark plan: ~1 GB stored, 10 GB/month downloaded, no Storage. Photos must be small
    `data:` URLs fetched on demand, never on an always-on listener.

C9. Schedule order is semantic: "Happening now" is first-match over the array
    (app.js:769); Tue/Thu movie night wins only by array position (camps.js:206-230).

C10. Push block ids are positional (`d<dow>-<start>-<index>`, push.js:125) and
     subscriptions key on a label slug (`pushBlockKey`, push.js:106). Existing phones
    store those keys in `push/<member>/<device>/prefs/blocks` (sealed prefs).

C11. `tests/camps.test.js:35-51` deep-equals 20 junior constants (by their app.js alias
     names) to `tests/fixtures-junior-week.json`.

C12. The bracket engine refuses anything but 6 teams (app.js:6319). An old editor client
     handed a differently shaped object under `state/brackets/<gid>` runs
     `normalizeBracket` (6221) and a render-time phase write (6951-6956) — it would
     corrupt or crash it.

---------------------------------------------------------------------------------

## 3. Data model

### 3.1 Node map (per camp root: `campScoreboard` = junior, `seniorScoreboard` = senior)

| Node | Read | Write | Status | Holds | Listened by |
|---|---|---|---|---|---|
| `state` | member | editor | existing, extended | scores, `teams` (+ new optional fields), `notice`, `meta` (+ `epoch`), NEW `brackets4` | every device (`.on`) |
| `config` | member | editor | existing → derived mirror once games move | legacy days/games catalog for old clients and (until Stage 7) the TV page | old clients; new clients stop listening once games are live |
| `setup` | member | editor | NEW | week meta, templates, days, meals, verses, cleanup, electives, games | every device (`.on`) |
| `campers` | **editor** | editor | NEW | camper first names per team | editor devices only |
| `teamPhotos` | member | editor | NEW | one small image per team slot | nobody; `once()` per photo version |
| `accessRequests` | editor (+ own row) | own row (create/update/delete); editor (delete) | NEW | walk-up "let me in" rows | editor devices only |
| `setupRestore` | editor | editor (create/delete only) | NEW | restore point bodies | nobody |
| `setupRestoreIndex` | editor | editor (create/delete only) | NEW | restore point metadata | `once()` when the drawer opens |
| `archive` | editor | editor (create only) | NEW | one body per finished year | nobody |
| `presence/<mk>/<dev>` | member | own | existing, + optional `where`, `v` | "here" + what an editor is editing | every device (existing) |
| `pushSchedule` | member | editor | existing, + optional `rev` | published week for the Worker | Worker cron |
| `members`, `changelog`, `chat*`, `push`, `pushAlerts`, `pushServer` | unchanged | | | | |

Rule of thumb applied: data shown to viewers → member-readable node; data only editors
need → its own editor-read node; anything big or rarely read → no listener.

### 3.2 `setup` — exact shape

All maps are keyed by non-numeric ids. `dk` ∈ `sun mon tue wed thu fri sat`
(fixed; `dow = index`). Times are minutes since midnight in camp time
(`America/New_York`), `0 ≤ start ≤ 1439`, `1 ≤ end ≤ 1440`, same as today.

```text
setup/
  meta/
    v:          1                         schema version of this tree (number)
    live:       true|false                the switch: false/absent ⇒ app uses camps.js constants
    sections/   { schedule:1, meals:1, verses:1, cleanup:1, electives:1, games:1 }
                                          a section is data-driven only while its marker is 1
    epoch:      "w20270718"               which camp year this is (see 3.6)
    epochAt:    1784…                     server ms when the epoch began (history filter)
    weekStart:  "2027-07-18"              the Sunday camp starts (canonical; pushSchedule copies it)
    double/     { from:"2027-07-22T21:00:00Z", to:"2027-07-24T04:00:00Z" }
                                          bonus double-points window (replaces DOUBLE_BONUS_*)
    finaleDay:  "fri"                     day the TV page plays the champion finale
    rev:        12                        bumped only when the published schedule changes
    edited/<section>: { at:<server ms>, by:<memberKey> }    "last edited by" per section
  templates/<tplId>/                      tplId ^[a-z0-9-]{1,24}$  (seed: "typical")
    name:   "Typical day"
    blocks/<bid>: BLOCK
  days/<dk>/
    kind:   "arrival"|"regular"|"sendoff"|"off"
    tag:    "Competition day 1"           (was SCHED_DAYS[dow].tag)
    note:   "Bring a water bottle"        (was config.days[].note; lines become day banners)
    legacyId: "d1"                        the config day id this day maps to (keeps state.ui.day valid)
    tpl:    "typical"                     present ⇒ the day uses that template
    edit/<bid>: BLOCK_EDIT                per-day changes to a template block ("just this day")
    hide/<bid>: true                      template block removed on this day only
    own/<bid>:  BLOCK                     blocks that exist only on this day
  meals/<dk>/<meal>: { dish, emoji }      meal ∈ breakfast|lunch|supper
  verses/
    theme: { title, text, ref }
    days/<dk>: { text, ref, video? }      video must be https://
  cleanup/<dk>/<meal>/<tid>: true         a SET of teams per meal (per-team merge)
  electives/
    stations/<sid>: { name, emoji }       sid ^st-[a-z0-9-]{1,30}$
    days/<dk>/<sk>/<sid>/<nameKey>: "Lilly"   sk ∈ s0|s1|s2 ; nameKey = slug of the name
  games/<gid>: GAME                       gid ^[a-z0-9-]{1,48}$ (existing ids are kept)
```

`BLOCK` (all optional except `start`, which is the record's anchor):

| field | type / cap | meaning |
|---|---|---|
| `start`, `end` | number | minutes, camp time |
| `label` | string ≤ 80 | the block's name ("Snack and campfire") |
| `detail` | string ≤ 80 | per-occurrence tail, rendered as `label — detail` ("TJ") |
| `teams` | map `{t1:true,…}` | rendered as `label — 🦃 Turkey, 🍁 Maples & 🚜 John Deeres` (emoji + short names, id order). Replaces the label text baked in by `morningMeetingBlock` (camps.js:183) so a team rename updates it. Written whole (atomic). |
| `emoji` | string ≤ 16 | |
| `type` | `activity`\|`games`\|`elective` | same values as today |
| `slot` | 0\|1\|2 | elective slot (type elective only) |
| `noTime` | boolean | untimed (lights out, "Camp's over") |
| `meal` | `breakfast`\|`lunch`\|`supper` | explicit meal tag (replaces label sniffing, app.js:539-561) |
| `ord` | number | tie-break for equal `start` (lower first); see 3.3 |
| `alertKey` | ^[a-z0-9-]{1,48}$ | phone-alert subscription key; minted ONCE at creation, never changed by renames |
| `loc` | string ≤ 60 | default location for games attached to the block |

`BLOCK_EDIT` = any subset of the BLOCK fields (no anchor) plus `clear/<field>: true` to
remove a template field for that day (RTDB cannot store "field = null").

`GAME` = today's game object (section 1.1 of the games map) minus `id/dayId/session`,
plus `day` (dk), `block` (bid), `ord` (number), optional `status`
(`postponed`|`cancelled`), optional `bracket` (`{seedMode:'standings'|'pick'|'fixed',
seeds?:{s1:[ta,tb],s2:[tc,td]}, order:'third-first'|'final-first'}`). Arrays inside a
game (`rules`, `counterSteps`, `prompts`, `timer.presets`, `roundOneMatchups`) and the
objects `timer`, `liveTracker`, `ladderScoring`, `bracket`, `counterStepLabels` are
written whole. Anchor field: `format`.

### 3.3 Resolution rules (what every consumer sees)

`resolveDay(tree, dow)`:
1. `day = tree.days[dk]`. Missing day ⇒ `[]`.
2. If `day.tpl`: for each `bid` in `templates[tpl].blocks` not in `day.hide`: block =
   template block, then apply `day.edit[bid]` fields (replace whole field values), then
   delete fields listed in `day.edit[bid].clear`. Origin = `typical` or `changed`.
3. Add every `day.own[bid]` (origin `own`).
4. Sort by `start` asc, then `ord` asc (missing `ord` = 10), then `bid`.
5. Render: `label = label + (detail ? ' — '+detail : '') + (teams ? ' — '+joinTeams(ids) : '')`.
6. Output objects carry exactly today's fields (`start,end,label,emoji,type[,slot][,noTime]`)
   plus NON-enumerable-for-equality metadata: `iid` (`<dk>-<bid>`, the instance id,
   ≤ 36 chars), `bid`, `alertKey`, `meal`, `origin`, `loc`. (In code they are ordinary
   properties; the equality test strips them.)

Why this works: the prototype (11.3) reproduces all 7 junior and senior days exactly,
including the Tue/Thu movie-night overlap (it is an `own` block with a lower `ord` at
the same `start`, so it sorts ahead exactly as the hand-spliced array did).

Instance identity: `iid = dk + '-' + bid`. A game attaches to `(day, block)`; the same
template block on Tue and Wed is two instances. Phone alerts publish `iid` as the block
id and `alertKey` as the subscription key, so moving or renaming a block never changes
either (fixes C10).

### 3.4 `state` changes

- `state.teams[i] = { id:'t<i>', name, counselor?, short?, emoji?, color?, photoV? }`.
  `short` ≤ 12 chars (mentions, morning-meeting labels, Worker team check), `emoji`
  ≤ 16 chars, `color` = a palette id (section 8.6) — never a raw hex, `photoV` = number
  (version of `teamPhotos/<tid>`). Ids are fixed slots: length = `CAMP.teamCount`.
  Absent field ⇒ the camps.js constant for that id (so junior renders identically).
- `computeSyncUpdates`: when `prev.teams` and `cur.teams` are arrays of equal length with
  the same `id` at each index, diff per `teams/<i>/<field>`; otherwise whole (today's
  behaviour). Same treatment for `notice`: per top-level field, `zones`/`steps` whole.
- `state.meta.epoch` (string) and `state.meta.epochAt` (number) — per-field like other
  meta fields; no rules change (meta only requires "not a scalar").
- NEW sync key `brackets4` (`state/brackets4/<gid>`) for 4-team brackets (section 9).
  It is a separate key, not a new shape under `brackets`, because of C12: old clients
  never read or write an unknown key.

### 3.5 The other new nodes

```text
campers/<tid>/<cid>: { n: "Maya" }                 tid ^t[0-9]$, cid ^c[a-z0-9]{6,20}$, n 1..40 chars
teamPhotos/<tid>:   { v: 3, data: "data:image/png;base64,…" }   data ≤ 120000 chars, jpeg|png
accessRequests/<identityKey>: { name, teamId?, note?, at:<server ms> }
setupRestoreIndex/<rpId>: { at, byKey, by, kind, label, bytes, hasScores, epoch }
setupRestore/<rpId>:      { at, byKey, kind, label, body:"<JSON string>" }
archive/<epoch>:          { at, byKey, label, bytes, body:"<JSON string>" }
presence/<mk>/<dev>:      { at, where?:"setup:schedule:tue", v?:190 }
pushSchedule:             { weekStart, at, by, blocks, rev? }
```

Restore/archive bodies are one JSON string leaf on purpose: exact round-trip (no RTDB
pruning or array coercion), one write, and the rules can cap the size.

### 3.6 Ids, epochs and keys

| Id | Format | Minted by | Notes |
|---|---|---|---|
| block `bid` | `b-` + `[a-z0-9-]{1,30}` | seed: deterministic slug of the label head (+`-2` on clash); new: `b-` + 8 random base36 | deterministic seeds make two concurrent seeders write identical trees |
| instance `iid` | `<dk>-<bid>` | derived | ≤ 36 chars, satisfies pushSchedule's `^[a-z0-9-]{1,40}$` |
| `alertKey` | `^[a-z0-9-]{1,48}$` | seed: `pushBlockKey(rendered label)` = today's key; new: same function at creation | copied (not re-minted) when a block is duplicated or copied to a day |
| game id | existing slugs; new `makeId(name)` capped at 40, prefixed `g-` if all digits | settings.js:111 | never re-minted; results stay keyed by it |
| station `sid` | `st-<slug>` | seed / creation | |
| `nameKey` | slug of a person's name | derived | join key for electives (see D4) |
| camper `cid` | `c` + 10 random base36 | creation | |
| restore point id | Firebase push id | `ref.push().key` | |
| `epoch` | `w<weekStart YYYYMMDD>` (`pre-<YYYYMMDD>` for the year before the first wizard) | wizard | |

### 3.7 Empty-pruning: what "absent" means, and the healer

- While `meta.live !== true`, or a section's marker is not 1: the section comes from
  camps.js / `config` exactly as today.
- Once a section is live, ABSENT MEANS EMPTY. Deleting every meal leaves `meals`
  pruned and the app shows no dishes — it never falls back to 2026's menu. This is why
  section markers exist: they are the "present but empty" sentinel RTDB can't store.
- Day records never prune (each has `kind`). Templates never prune (`name`). A day with
  every template block hidden and no own blocks is a valid empty day.
- `normalizeSetup(tree)` runs after every load, adopt and merge (same place
  `normalizeSyncedState` runs for state): ensures all 7 day records exist in memory
  (kind `off` if missing), drops records of the wrong type, clamps times, drops
  `edit/hide` entries for template blocks that no longer exist, drops games with an
  unknown `format` into a quarantined list shown in the hub, and coerces any map that
  came back as an array (defence in depth for C4). It never writes; healing is
  in-memory only, so it can't trigger pushes (comparison is on canonical forms, 4.3).

### 3.8 Sizes and Spark budget (measured on the seeds)

| Section | junior | senior |
|---|---|---|
| schedule (template + days) | 7.3 KB (constants were 13.2 KB) | 3.5 KB (was 9.5 KB) |
| games | 16.5 KB + ~1 KB attachment fields | 7.6 KB |
| electives (map form) | 5.2 KB | 0 |
| meals / verses / cleanup | 0.8 / 1.3 / 0.4 KB | ~0 / 0.3 / 0 |
| **setup total** | **≈ 33 KB** | **≈ 12 KB** |

Per page load each device downloads the setup tree once (~33 KB, the same order as
today's config + state). Edits travel as leaf deltas, not whole-node re-sends (today a
one-letter game edit re-sends the 17 KB catalog to every listener). 40 devices × 10
loads/day × 7 days × 33 KB ≈ 92 MB/week. Photos: 6 × ≤ 90 KB, fetched once per version
per device and cached in IndexedDB ⇒ ≈ 20 MB the first day, ~0 after. Restore points:
≤ 40 × ≤ 120 KB ≈ 5 MB stored, never downloaded except on restore. Archives ≈ 120
KB/year. All far inside 1 GB stored / 10 GB month.

---------------------------------------------------------------------------------

## 4. Sync and multi-editor behaviour

### 4.1 One engine, cloned not refactored

`setup-sync.js` (loaded right after app.js) implements `createDomainSync(opts)`:

```js
createDomainSync({
  name: 'setup',                     // or 'campers'
  path: 'setup',                     // dbPath(path)
  cacheKey: lsKey('campSetupV1'),    // one localStorage blob: {tree, base, baseAt, epoch}
  readRole: 'member',                // 'editor' for campers: attach only when canEdit()
  atomic: SETUP_ATOMIC_PATTERNS,     // paths written whole (arrays, teams maps, game sub-objects)
  newestWins: ['meta/edited/*'],     // metadata stamps: never a conflict, newest wins
  normalize: normalizeSetup,
  onApplied: (changedPaths) => …,    // re-derive state.config, patch the builder, renderAll
})
```

Why a clone: the existing sync tests reach into `fbRef`, `lastSyncedTree`,
`pendingWrites`, `fbConfigRef = {set}` directly (sync.test.js:355-372). Rewriting the
state engine in place would rewrite the safety net. The clone reuses only the pure
helpers that already exist (`syncCanon`, `syncValueAt`, `applySyncPaths`,
`syncPathsOverlap`, app.js:2473-2523).

Engine globals per instance: `ref, tree, last (diff baseline), confirmed (persisted),
ready (first snapshot seen), pending (unacked writes), pushTimer, denied, held{}
(remote values held for a focused field), quarantine{}`.

### 4.2 Write path

1. Every edit goes through `setupEdit(label, mutate, opts)`:
   `before = canon(tree)`; `mutate(draft)` on a deep copy; `after = canon(draft)`;
   `ops = leafDiff(before, after)`; if empty, return.
   Then: `tree = draft`, record an undo entry (section 5.1), persist the cache, stamp
   `meta/edited/<section>` (server timestamp), schedule a push (300 ms debounce).
   `opts.restorePoint: 'Before deleting Kickball'` creates a restore point first (5.2).
2. `leafDiff(prev, cur)`: recursive; a path matching an `atomic` pattern, an array, a
   scalar, or an object that is absent on one side is written WHOLE at that path; two
   objects present on both sides recurse. Deletions are `null` at the highest absent
   path. (So a new block is one path; renaming it is one leaf path.)
3. `push()`: gated on `ready && !denied` (first-pull gate — the config hole in scoring#3
   cannot exist here). `updates = leafDiff(last, canon(tree))`; `last = canon(tree)`
   (optimistic); `pending++`; `ref.update(updates)`:
   - ack ⇒ `confirmed = applySyncPaths(confirmed, updates)`, persisted in the SAME
     localStorage write as the tree (the pair can't disagree — same invariant as
     `_syncBase`); `pending--`.
   - reject ⇒ quarantine procedure (4.5); `pending--`.
4. `flushPendingPush()` (app.js:7680) also flushes every domain's timer on
   `pagehide`/`visibilitychange`.

### 4.3 Read path

- **First snapshot after load** = three-way merge, identical in spirit to
  `firstSnapshotMerge`: `base = confirmed` (persisted), `mine = leafDiff(base, local)`,
  `theirs = leafDiff(base, server)`. Keep each of my paths that no their-path overlaps;
  overlapping ⇒ server wins + toast ("Something you changed offline was also changed by
  Jenn — kept theirs. Undo brings yours back"). The losing local values stay in the
  device's undo stack as a synthetic entry so "Undo" really does bring them back.
  Comparisons are on canonical forms (empties pruned, keys sorted) — the exact lesson
  of REVIEW-sync #1/#4. Apply the merged tree with the SERVER tree as `confirmed`, then
  push the kept paths. Work older than 36 h since `baseAt` asks first (same text pattern
  as app.js:2564).
- **Epoch check**: if the cached `epoch` ≠ server `meta/epoch`, discard `mine` (it
  belongs to a finished year) and offer "Download the unsent changes" (a JSON blob via
  `downloadBlob`). Same check is added to the state engine's `firstSnapshotMerge` using
  `meta/epoch` (Stage 1).
- **Later snapshots**: adopt when `pending === 0 && !pushTimer` (the proven
  `canAdoptRemote` rule). `editorMidEntry()` blocks adoption only when the focused
  element is OUTSIDE `#settings-view` (a score or tally field on the scoreboard — the
  adopt ends in `renderAll`, which must not blur it; same as today's config deferral).
  Inside the builder, setup edits from another editor apply while you type in a
  different field (live collaboration), using the hold rule below. Deferred snapshots
  are re-read with `once()` on the 1 s idle tick (`idleRetryTick`, app.js:2408,
  extended to every domain) — never replayed from a stash.
- **Focused-field hold**: every builder input carries `data-sp="<setup path>"`. On
  adopt, a changed path that overlaps the focused input's path is not written into the
  input; the server value goes to `held[path]` and the input gets a small "Jenn changed
  this" badge. On blur: unchanged by me ⇒ adopt `held`; changed by me ⇒ my commit wins,
  its undo entry's `before` is Jenn's value, toast "Jenn had changed this too — Undo
  restores hers".
- **Identity-preserving echo**: if the canonical signature didn't change, keep the live
  tree object (same reason as app.js:2633). Builder handlers never close over objects
  anyway: they look up by `data-sp` at event time.

### 4.4 Accounting integration (one helper, every guard)

New `pendingWritesTotal() = pendingWrites + setupSync.pending + campersSync.pending +
pendingConfigWrites`. Used by: `canAdoptRemote` (2376), `reloadBlocked` (7764),
`hasUnsyncedWork` (8527, also any domain `pushTimer`), `hasUnconfirmedLocalWork` (8536:
also `leafDiff(confirmed, tree)` non-empty for each domain — this is what makes the
sign-out / camp-switch warnings tell the truth about offline setup work),
`flushPendingPush`. `pendingConfigWrites` is a counter added to `pushConfig` in Stage 1
(closes the "deploy reload discards an in-flight config write" gap while config is
still the source of truth).

### 4.5 Poison-path quarantine (both engines)

When a multi-path `update()` is rejected with `PERMISSION_DENIED`:
1. If it had more than one path, retry each path alone, sequentially (max 50 paths; for
   more, bisect).
2. Paths that succeed advance `confirmed`. Paths refused alone go to `quarantine[path] =
   value` and are marked as "sent" in `last` (so they are not retried forever).
3. The hub (and, for state, the sync indicator) shows "⚠️ 1 change couldn't be saved:
   Kickball → location" with **Retry** (re-queue; useful once rules are published) and
   **Discard** (revert the local value to `confirmed`).
4. Non-permission errors (network) keep today's behaviour: restore `last`, retry later.

This turns the "client shipped ahead of its rules" failure (C2) from a silent permanent
wedge of all score sync into one visible line item.

### 4.6 Conflict rules (complete table)

| Situation | Result |
|---|---|
| Two editors, different fields (even of the same block/game) | both kept (leaf paths) |
| Two editors, same field, both online | last write wins at the server; the loser's device gets the new value live (or via hold/badge if focused) and can Undo |
| Same field edited offline on two devices | first one to sync wins; the second gets "kept theirs" toast + an Undo entry with its value |
| A deletes a game/block, B edits a field of it | B's leaf write is REFUSED by the rules (leaf anchor check, C6) → quarantine line "Kickball was deleted by someone else" with Discard / "Re-create it" (re-create = write whole record) |
| A edits the template block, B edits Tuesday's copy | both kept; Tuesday shows B's value (day edit beats template); Tuesday row shows "Tue has its own time" with "Use the typical time" |
| Reorder races | `ord` is a number; inserting between two blocks uses the midpoint, so concurrent inserts never collide; equal `ord` falls back to `bid` order (deterministic on every device) |
| Teams | per `teams/<i>/<field>`; an OLD client still writes the whole array (accepted; auto-reload retires them within minutes) |
| Cleanup | per team per meal (`cleanup/<dk>/<meal>/<tid>`): two editors adding different teams both stick |
| Electives | per person per station; moving a person = delete + add in one update |
| Campers | per camper record |
| Members | unchanged (child writes + `createMemberIfAbsent` transaction) |
| New-year commit vs a concurrent edit | the commit is one atomic root update; edits after it land in the new year; offline edits from before it are refused by the epoch check |

### 4.7 Presence: "Jenn is also here"

- Each editor device writes `presence/<mk>/<dev>/where` with `update({where})` only on
  TRANSITIONS (open hub, change section/day/game, close) — no heartbeat (a heartbeat
  would cost ≈1.2 GB/week, map 3 §3.1). Values: `setup`, `setup:schedule:tue`,
  `setup:game:<gid>`, `setup:teams`, `setup:people`, … (^[a-z0-9:/-]{0,48}$). Leaving
  the builder writes `where: null`. `v: APP_VERSION` is written once per connect.
- Writing `where` separately from `at` matters: under the OLD rules (`$other:false`) the
  `where` write is refused and swallowed, while the `{at}` row stays valid — presence
  never dies because of the new field. `registerPresence` (app.js:2167) still `set()`s
  `{at}` on every reconnect, which wipes `where`; the client re-writes its current
  `where` right after that `set()` resolves.
- Display: the existing presence listener (app.js:2711) already delivers the tree. The
  hub header shows "👤 Jenn is also here — Schedule · Tue"; each section row and each
  day chip shows a small avatar. Names resolve `memberKey → memberDirectory[mk].name`
  with the same fail-closed rule as `chatAuthorName` (no directory ⇒ "another
  editor"). Rows of the viewer's own `memberKey` with a different device id show "You,
  on another device".
- Rows are ghosts until the server notices a dead socket (accepted; typically < 1 min).

### 4.8 Two tabs of the same camp (closes REVIEW-sync #10)

`navigator.locks.request('camp-writer-' + CAMP.id, { ifAvailable: true }, …)` at boot.
The tab that gets the lock is the writer and holds it for its lifetime. A tab that does
not get it starts in **read-only mirror mode**: it never writes localStorage, never
pushes, shows a bar "This camp is open in another tab — this one is view-only. [Use this
tab instead]". "Use this tab instead" requests the lock with `{ steal: true }`; the old
tab's lock callback rejects with `AbortError`, it flushes its pushes, flips itself to
read-only and shows the same bar. On take-over the new writer reloads its state from
localStorage first (the old writer's last cache write) — a reload via `doReload()` is the
simplest correct way. Browsers without Web Locks (Safari < 15.4) keep today's behaviour
(documented). iOS Home-Screen apps and Safari tabs have separate storage, so this mostly
protects the director's laptop — exactly the setup machine. (Owner decision D1.)

### 4.9 Legacy `config`: derived in memory, mirrored for old clients

Once `meta.sections.games === 1`:
- `state.config = deriveLegacyConfig(setupTree)` after every setup apply:
  `version: 6`, `updatedAt: 'mirror ' + ISO`, `sessions` = the camp's seed sessions,
  `days` = setup days of kind ≠ off that have games or a `legacyId` (id = `legacyId` or
  `d-<dk>`, name = full day name, `dow`, `note`), `games` = setup games sorted by (day,
  block start, `ord`), each with derived `id`, `dayId`, `session` (block start < 12:00 →
  Morning; < 17:00 → Afternoon if the camp has that session; else Evening).
  Every existing reader of `state.config` (`gameById`, day tabs, standings, live home,
  TV until Stage 7) keeps working unchanged. `migrateState`'s version gates (<5) never
  fire on version 6.
- New clients never call `pushConfig` from the builder. At boot a new client attaches
  the `config` listener exactly as today unless its cached setup already says games are
  live; when the first setup snapshot says they are, it calls `fbConfigRef.off()` (a
  voluntary detach, not a cancelled read, so the one-shot listener invariant is not
  involved) and from then on derives `state.config` only from setup. Any editor device whose derived mirror differs from the last mirror it wrote
  pushes it (`set()`, deterministic content, so two editors write identical bytes).
- Old clients keep reading the mirror. Until the fence (Stage 6b) an old editor's config
  save overwrites the mirror and is then re-overwritten by the next new editor — the old
  editor's edit is lost but nothing else is. The fence rule (section 6.4) then refuses
  old clients' config writes outright.

---------------------------------------------------------------------------------

## 5. Undo and restore points

### 5.1 Undo (per device, immediate)

- Entry: `{ id, label, at, epoch, ops: [[domain, path, before, after], …] }` with
  canonical values. Domains: `setup`, `campers`, `state` (only `teams/*` and `notice/*`
  paths). Members/access changes are NOT undoable (security-relevant; they have their
  own confirms) — the toast says so.
- Recorded by `setupEdit`, `campersEdit`, and a thin `stateEdit(label, mutate)` wrapper
  used by the Teams/Notice screens (it diffs `teams`/`notice` with the same per-field
  rules before calling `saveState()`).
- Undo algorithm: for each op, `now = canon(valueAt(domain, path))`; if
  `deepEqual(now, after)` → write `before`; else → skip and list it ("Jenn has changed
  'Evening competition' since — left as is"). The undo itself goes through the normal
  edit path, so it is synced, merged and redo-able (the inverse entry goes on a redo
  stack, cleared by any new edit).
- Storage: memory + `lsKey('campSetupUndo')` (≤ 50 entries, ≤ 200 KB; oldest dropped);
  entries from another `epoch` are discarded. Added to `clearLocalData`'s list
  (app.js:8655) and wiped on sign-out. Camper ops are wiped on role downgrade.
- UI: "↶ Undo: Moved Evening competition (Tue)" button in the hub header and in every
  section; Ctrl/Cmd-Z when focus is not in a text field; a "Recent changes" sheet with
  the last 10 entries.

### 5.2 Restore points (shared, survive everything)

- **Body** (`setupRestore/<id>/body`, JSON string ≤ 600 000 chars):
  `{ v:1, camp, epoch, at, setup, teams, notice, config?, scores? }` where `config` is
  included only while games are not yet live, and `scores` (results, brackets,
  brackets4, drafts, picRounds, picSetup without words, bonuses, live, clocks,
  announcements, meta minus `lastDataChangeAt`) only for `kind: 'wizard'` and
  `kind: 'import'`. Campers are never included (D2), members never.
- **Index** (`setupRestoreIndex/<id>`): `{at, byKey, by, kind, label, bytes, hasScores,
  epoch}` so the list is one small `once()`.
- **Automatic triggers** (written by the device about to act, awaited with a 4 s
  timeout): delete a block that has games; delete a game; delete a station; "use typical
  day on Mon–Fri" when it would discard day edits; "Reset Tuesday to typical"; paste
  roster; import a backup; restore defaults; apply a restore point; every new-year
  wizard commit; turning `live` on or off; and once per editing session (first edit
  after 20 min of no setup edits on this device, label "Before Jenn's edits, 3:05 PM").
- **Offline**: a point that can't be written within 4 s goes into an outbox
  (`lsKey('campSetupRpOutbox')`, max 3, newest kept) uploaded on reconnect. The action
  proceeds either way (local undo still covers it).
- **Retention**: after creating a point, the creator deletes the oldest `auto` points
  beyond 40 total (body + index in one update). `manual` points are capped at 20 (the
  UI asks to delete one first). `wizard` points are never auto-pruned.
- **Restore**: read the body once → refuse a different camp; warn on a different epoch →
  show a summary computed by `leafDiff(current, body.setup)` ("Schedule: 4 blocks
  differ · Games: Kickball comes back · Teams: 1 name") with checkboxes (setup /
  teams & notice / scores-if-present, scores unchecked by default) → create a "Before
  restoring …" point → apply via `setupEdit('Restore: …')` (one atomic update; other
  editors see it live and it is undoable) and `stateEdit` for teams/notice; scores via
  `saveState()` (per-item diff).

---------------------------------------------------------------------------------

## 6. Security rules

### 6.1 Macros used below
`MEMBER(R)` / `EDITOR(R)` = the exact existing member / editor expressions for root R
(database.rules.json:7-8). `SELF($k)` = the presence self expression (line 111, first
conjunct). `BYKEY_IS_ME` = the changelog `byKey` expression (line 74, last conjunct).
`STR(n)` = `{ ".validate": "newData.isString() && newData.val().length <= n" }`.
`FALSE` = `{ ".validate": false }`. Macros are expanded by hand in the published file
(RTDB has no macros); a test re-expands them and compares.
Every block is written twice, identical modulo the root name (rules.test.js already
asserts that for push blocks; extend it to the whole file).

### 6.2 New blocks (shown for one root)

```jsonc
"setup": {
  ".read": "MEMBER(R)", ".write": "EDITOR(R)",
  "meta": {
    "v":        { ".validate": "newData.isNumber()" },
    "live":     { ".validate": "newData.isBoolean()" },
    "sections": { "$s": { ".validate": "$s.matches(/^(schedule|meals|verses|cleanup|electives|games)$/) && newData.isNumber()" } },
    "epoch":    { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9-]{1,40}$/)" },
    "epochAt":  { ".validate": "newData.isNumber()" },
    "weekStart":{ ".validate": "newData.isString() && newData.val().matches(/^20[0-9]{2}-[0-1][0-9]-[0-3][0-9]$/)" },
    "double":   { "from": { ".validate": "newData.isString() && newData.val().length <= 40" },
                  "to":   { ".validate": "newData.isString() && newData.val().length <= 40" },
                  "$other": { ".validate": false } },
    "finaleDay":{ ".validate": "newData.isString() && newData.val().matches(/^(sun|mon|tue|wed|thu|fri|sat)$/)" },
    "rev":      { ".validate": "newData.isNumber()" },
    "edited":   { "$s": { "at": { ".validate": "newData.isNumber() && newData.val() === now" },
                          "by": { ".validate": "newData.isString() && newData.val().length <= 200" },
                          "$other": { ".validate": false } } },
    "$other":   { ".validate": false }
  },
  "templates": { "$tpl": {
      "name":   { ".validate": "newData.isString() && newData.val().length <= 40" },
      "blocks": { "$bid": BLOCK_RULES },
      "$other": { ".validate": false } } },
  "days": {
    "sun": DAY_RULES, "mon": DAY_RULES, "tue": DAY_RULES, "wed": DAY_RULES,
    "thu": DAY_RULES, "fri": DAY_RULES, "sat": DAY_RULES,
    "$other": { ".validate": false } },
  "meals": { "$dk": { "$meal": {
      "dish":  { ".validate": "newData.isString() && newData.val().length <= 80" },
      "emoji": { ".validate": "newData.isString() && newData.val().length <= 16" },
      "$other": { ".validate": false } } } },
  "verses": {
    "theme": { "title": STR(80), "text": STR(600), "ref": STR(60), "$other": FALSE },
    "days":  { "$dk": { "text": STR(600), "ref": STR(60),
                        "video": { ".validate": "newData.isString() && newData.val().length <= 300 && newData.val().beginsWith('https://')" },
                        "$other": FALSE } },
    "$other": FALSE },
  "cleanup": { "$dk": { "$meal": { "$tid": {
      ".validate": "$tid.matches(/^t[0-9]$/) && newData.val() === true" } } } },
  "electives": {
    "stations": { "$sid": { "name": STR(60), "emoji": STR(16), "$other": FALSE } },
    "days": { "$dk": { "$sk": { "$sid": { "$nk": {
      ".validate": "$nk.matches(/^[a-z0-9-]{1,40}$/) && newData.isString() && newData.val().length <= 40" } } } } },
    "$other": FALSE },
  "games": { "$gid": GAME_RULES },          // added in Stage 6's rules PUT, not Stage 3's
  "$other": { ".validate": false }
}
```

`BLOCK_RULES` (anchor = `start`; every other leaf carries `ANCHOR = "&& newData.parent().child('start').exists()"`):
```jsonc
{
  "start": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 1439" },
  "end":   { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 1440 ANCHOR" },
  "label": { ".validate": "newData.isString() && newData.val().length <= 80 ANCHOR" },
  "detail":{ ".validate": "newData.isString() && newData.val().length <= 80 ANCHOR" },
  "teams": { ".validate": "newData.hasChildren() ANCHOR",
             "$tid": { ".validate": "$tid.matches(/^t[0-9]$/) && newData.val() === true" } },
  "emoji": { ".validate": "newData.isString() && newData.val().length <= 16 ANCHOR" },
  "type":  { ".validate": "newData.isString() && newData.val().matches(/^(activity|games|elective)$/) ANCHOR" },
  "slot":  { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 2 ANCHOR" },
  "noTime":{ ".validate": "newData.isBoolean() ANCHOR" },
  "meal":  { ".validate": "newData.isString() && newData.val().matches(/^(breakfast|lunch|supper)$/) ANCHOR" },
  "ord":   { ".validate": "newData.isNumber() ANCHOR" },
  "alertKey": { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9-]{1,48}$/) ANCHOR" },
  "loc":   { ".validate": "newData.isString() && newData.val().length <= 60 ANCHOR" },
  "$other": { ".validate": false }
}
```
The `$bid` key pattern (`^b-[a-z0-9-]{1,30}$`) is checked on `start` (the anchor is
always written when the record is created): `"start": {".validate": "$bid.matches(/^b-[a-z0-9-]{1,30}$/) && …"}`.
`BLOCK_EDIT_RULES` = the same leaves WITHOUT the anchor, plus
`"clear": { "$f": { ".validate": "$f.matches(/^(detail|teams|emoji|slot|noTime|meal|loc)$/) && newData.val() === true" } }`.

`DAY_RULES` (anchor = `kind`):
```jsonc
{
  "kind": { ".validate": "newData.isString() && newData.val().matches(/^(arrival|regular|sendoff|off)$/)" },
  "tag":  { ".validate": "newData.isString() && newData.val().length <= 60" },
  "note": { ".validate": "newData.isString() && newData.val().length <= 500" },
  "legacyId": { ".validate": "newData.isString() && newData.val().matches(/^d[a-z0-9-]{0,20}$/)" },
  "tpl":  { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9-]{1,24}$/)" },
  "edit": { "$bid": BLOCK_EDIT_RULES },
  "hide": { "$bid": { ".validate": "newData.val() === true" } },
  "own":  { "$bid": BLOCK_RULES },
  "$other": { ".validate": false }
}
```

`GAME_RULES` (anchor = `format`): `name` STR(60); `emoji` STR(16); `day` matches
dk; `block` matches `^b-…`; `ord` number; `status` `^(postponed|cancelled)$`;
`location` STR(80); `format` `^(placement|tally|tournament)$`; `headline` STR(200);
`unit` STR(30); booleans `lowerWins timeInput counterAllowNegative liveRankings
messtival`; branches `rules counterSteps counterStepLabels prompts liveTracker
ladderScoring roundOneMatchups timer bracket` (`!isString && !isNumber &&
!isBoolean`); every non-anchor leaf carries `newData.parent().child('format').exists()`;
`"$gid"` pattern checked on `format`; `$other: false`.

```jsonc
"campers": {
  ".read": "EDITOR(R)", ".write": "EDITOR(R)",
  "$tid": { "$cid": {
    "n": { ".validate": "$tid.matches(/^t[0-9]$/) && $cid.matches(/^c[a-z0-9]{6,20}$/) && newData.isString() && newData.val().length >= 1 && newData.val().length <= 40" },
    "$other": { ".validate": false } } }
},
"teamPhotos": {
  ".read": "MEMBER(R)", ".write": "EDITOR(R)",
  "$tid": {
    ".validate": "$tid.matches(/^t[0-9]$/) && newData.hasChildren(['v', 'data'])",
    "v":    { ".validate": "newData.isNumber()" },
    "data": { ".validate": "newData.isString() && newData.val().length <= 120000 && (newData.val().beginsWith('data:image/jpeg;base64,') || newData.val().beginsWith('data:image/png;base64,'))" },
    "$other": { ".validate": false } }
},
"accessRequests": {
  ".read": "EDITOR(R)",
  "$reqKey": {
    ".read": "SELF($reqKey)",
    ".write": "(SELF($reqKey) && !root.child(R).child('members').child($reqKey).exists()) || (EDITOR(R) && !newData.exists())",
    ".validate": "newData.hasChildren(['name', 'at'])",
    "name":   { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 60" },
    "teamId": { ".validate": "newData.isString() && newData.val().matches(/^t[0-9]$/)" },
    "note":   { ".validate": "newData.isString() && newData.val().length <= 200" },
    "at":     { ".validate": "newData.isNumber() && newData.val() === now" },
    "$other": { ".validate": false } }
},
"setupRestore": {
  ".read": "EDITOR(R)",
  "$rp": {
    ".write": "EDITOR(R) && (!data.exists() || !newData.exists())",
    ".validate": "newData.hasChildren(['at', 'byKey', 'kind', 'label', 'body'])",
    "at":    { ".validate": "newData.isNumber() && newData.val() === now" },
    "byKey": { ".validate": "BYKEY_IS_ME" },
    "kind":  { ".validate": "newData.isString() && newData.val().matches(/^(auto|manual|wizard|import)$/)" },
    "label": { ".validate": "newData.isString() && newData.val().length <= 120" },
    "body":  { ".validate": "newData.isString() && newData.val().length <= 600000" },
    "$other": { ".validate": false } }
},
"setupRestoreIndex": { /* same .read/.write; fields at, byKey, by(≤80), kind, label, bytes(number), hasScores(bool), epoch(pattern); $other false */ },
"archive": {
  ".read": "EDITOR(R)",
  "$ep": {
    ".write": "EDITOR(R) && !data.exists() && newData.exists()",
    /* at===now, byKey BYKEY_IS_ME, label ≤120, bytes number, body string ≤ 2000000, $other false */ }
}
```

Amendments to existing blocks:
- `presence/$memberKey/$deviceId`: add `"where": {".validate": "newData.isString() && newData.val().matches(/^[a-z0-9:/-]{0,48}$/)"}` and `"v": {".validate": "newData.isNumber()"}`.
- `pushSchedule`: add optional `"rev": {".validate": "newData.isNumber()"}`.
- `state`: add `"brackets4": {".validate": "!newData.isString() && !newData.isNumber() && !newData.isBoolean()"}`.
- `members/$memberKey/name`: tighten to `newData.isString() && newData.val().length <= 60`
  (old clients never write longer; the walk-up flow copies a ≤ 60 name).

### 6.3 Why these are safe for old cached clients
- Every new node is a sibling old clients never touch. `presence.where/v`,
  `pushSchedule.rev`, `state.brackets4` are optional; old clients don't write them, so
  their write sets pass the new rules unchanged. Proven per stage by an emulator test in
  the style of `tests/emulator/fallback.mjs`: (a) a recorded old-client write set passes
  the NEW rules; (b) the new client under the OLD rules degrades (setup denied → falls
  back to constants; presence `where` refused silently; no state wedge thanks to 4.5).
- New client code never attaches a new listener before approval (THE INVARIANT); each new
  listener's error callback sets only its own `*Denied` flag (chat pattern), never
  `fbRef`/`syncDenied`.
- `accessRequests` is the first rule a NON-member can write. Bounded: one row per verified
  identity, ≤ ~400 bytes, refused once that identity is a member. No listener is attached
  by the requester (one-shot `set()` and `once()`), so the invariant holds.

### 6.4 Deliberate fences (publish only after the new client is the live one)
- **F1 — config mirror fence (Stage 6b):** `config/updatedAt` validate becomes
  `newData.isString() && newData.val().length <= 60 && newData.val().beginsWith('mirror ')`.
  Old clients stamp an ISO date, so their whole-node config saves are refused (they only
  `console.warn`; auto-reload upgrades them). Publish once presence `v` shows no editor
  device below the Stage 6 build for 48 h, or at the latest when the camp is not running.
- **F2 — published-schedule fence (Stage 9):** `pushSchedule/.validate` gains
  `newData.hasChildren(['rev']) && (!data.child('rev').exists() || newData.child('rev').val() > data.child('rev').val())`.
  Today no shipped build publishes (`PUSH_SERVICE_URL` is blank in v182/183, so
  `pushMaybeRepublishSchedule` never runs — push.js:974), therefore the first publisher
  is a Stage-4+ build and F2 is defence in depth, not a rollout requirement.

### 6.5 Publish order (every stage)
1. Back up live rules (`GET …/.settings/rules.json`), 2. PUT the repo file, 3. read back
and byte-compare, 4. run the unauthenticated probes from the runbook plus the new ones
(unauthenticated + viewer reads of `campers`, `setupRestore`, `archive`,
`accessRequests` must be denied; a viewer write to `setup` denied), 5. only then push
the code. Rollback = PUT the backup (all additions are inert when absent).

### 6.6 Rules tests (tests/rules.test.js)
Update deliberately: gated-path list per camp (37-44: +setup, campers, teamPhotos,
accessRequests, setupRestore, setupRestoreIndex, archive — each added in the stage that
ships its feature); "unused PII paths" test (164-176) now asserts `campers` exists with
EDITOR-only `.read` and no other camper-ish path exists; `$other:false` seal list
(141-162) includes every new record; image `data:` pin test accepts `jpeg|png` for
`teamPhotos`; "state accepts exactly SYNC_KEYS" picks up `brackets4`; new tests: every
setup leaf except anchors references its anchor; `accessRequests` write is bound to
`SELF`; `setupRestore`/`archive` are create-only (`!data.exists()`); both roots
identical modulo root name for the whole file. Opt-in `tests/emulator/setup.mjs`:
leaf-after-delete refused, viewer can't read campers, non-member can write only their
own request, old-client write sets pass.

---------------------------------------------------------------------------------

## 7. The accessor layer (the seam for consumers and for the home redesign)

New file `week-data.js`, loaded after `camps.js` and before `app.js` (it owns
`let setupTree = null`, so no script ever reads it in its temporal dead zone). Pure
functions over `CAMP` constants + `setupTree` + `state` (read at call time). Rule:
**while `sectionLive(s)` is false, an accessor returns the SAME constant object it
replaces** (`scheduleFor(d) === DAY_SCHEDULE[d]`), so pre-switch behaviour is
byte-identical by construction and pinned by `===` tests.

| Accessor | Replaces (direct readers today) |
|---|---|
| `weekDays()` → 7 × `{dk,dow,kind,short,full,tag,note}` | `SCHED_DAYS` (app.js:896, 917), `DAY_NAMES` (273, 4556, 5055-5062, 5086, 5105, 5140, 5213, 5338) |
| `scheduleFor(dow)`, `scheduleWeek()` | `DAY_SCHEDULE` (app.js:744, 918, 1007; push.js:1079, 1093, 1373, 1701) |
| `blockByIid(iid)`, `mealOfBlock(b)`, `mealBlocks(dow)` | label sniffing `mealInfo`/`blockMealName` (539-561), `MEAL_START_MINUTES` (5168) |
| `electiveSlots(dow)` → `[{slot,start,end,stations:[{sid,name,emoji,people}]}]` | `ELECTIVES`, `STATION_EMOJI`, `ELECTIVE_SLOT_MIN` (339-389, 501-503, 785-789, 943-948) |
| `mealFor(dow, meal)` | `MEALS` (540) |
| `verseTheme()`, `verseFor(dow)`, `verseDays()` | `MEMORY_VERSE_THEME/VERSES` (5044-5051), the `[1..5]` loops (5054) |
| `cleanupTeams(dow, meal)`, `cleanupDays()` | `MEAL_CLEANUP_SCHEDULE` (568, 5162), loops (5177, 5212) |
| `teamName/teamShort/teamEmoji/teamAccentVars/teamCrestSrc(id)`, `counselorName`, `teamStaffNames` | `TEAM_EMOJI/SHIELD/ACCENT/ABBREV` incl. raw reads at 5783, 6646, 6729 and chat.js:530 |
| `gamesForBlock(iid)`, `gamesForDay(dk)` → `[{block, games}]` + `unscheduledGames()` | the `start < 720 ? 'Morning' : 'Evening'` heuristic (app.js:927-936, 1010-1016), `dayGamesHTML` grouping (5427-5431), game header session (5552) |
| `campWeekStart()`, `campDateFor(dow)`, `doubleWindow()`, `finaleDay()` | `campDateForDow` (994), `DOUBLE_BONUS_START/END` (286-287) |
| `campersFor(tid)` | (new; `[]` for non-editors) |
| `setupChecklist()` | (new, section 8.2) |

Sanitisation lives INSIDE the accessors because call sites interpolate raw: emoji ≤ 16
chars and no `<>&"'` (≈60 raw `teamEmoji()` sites), colour = palette lookup only,
crest = `data:image/(jpeg|png)` or a same-origin `images/` path only (the
`chatSafeImageSrc` pattern, chat.js:103), verse video = `https://` only.

Home-screen seam (flag for the layout redesign): `renderNowBanner`, `renderDayTabs`,
`renderLiveHome`, `renderStandings`/`renderFollowCard`, `renderMemoryVerse`,
`renderMealCleanup`, `renderMyElectives` read only accessors plus `state.config` (which
is derived, 4.9). A redesign may change those render functions freely as long as it
reads through this table; it must not read `setupTree`, `CAMP.*` or the old constants
directly.

---------------------------------------------------------------------------------

## 8. Editor screens (derived from the model)

### 8.1 Entry and shell
Settings row "Set up the week" becomes **Camp setup**. It opens the same full-page
takeover (`body.builder-open`, app.js:7821-7824) but renders the **hub**. Rendering
rules for every new screen: section containers update through `setHtmlIfChanged`; a
container that holds the focused element only gets in-place `[data-sp]` value patches,
its structural re-render waits for blur; no Jelly component is re-created when its HTML
is unchanged; no `transition: all` (render-stability rules). `renderSetupUI()` is called
from `renderAll` only while the builder is open and from the setup engine's
`onApplied`. Drafts (only the game editor sheet and the wizard) are persisted to
`lsKey('campSetupDraft')` so a reload restores them, and closing the builder by ANY path
(Back, tab switch, hub nav) asks Save / Discard — fixes B1 (zombie `gameDraft` freezing
sync).

Header (always visible): camp name + week dates, presence chips, Undo, and a save status
line driven by the engine: "✓ All changes saved" / "⏳ 3 changes waiting for Wi-Fi —
safe to close the app" (true, because the cache + baseline are persisted) / "⚠️ 1
change couldn't be saved — Review".

### 8.2 Checklist hub (✅ ⚠️ ○)
`setupChecklist()` is pure (testable) and returns `[{id, title, status:
'ok'|'warn'|'todo'|'info', summary, issues:[{text, target}]}]`. Rows, in order:

| Row | ✅ when | ⚠️ when (each issue links to its target) | ○ / info |
|---|---|---|---|
| Week | `weekStart` is a Sunday, within the next 400 days or the current week | missing; not a Sunday; > 8 days in the past ("Start a new year?") | |
| Teams | every slot has a non-placeholder name, a short name, an emoji, a colour; names and colours distinct | any missing / duplicate; team count ≠ `CAMP.teamCount` | photo missing is info only |
| People | every team has ≥ 1 staff member (member with that `teamId`, pending included) | a team with nobody; walk-up requests waiting ("🙋 2 asking to join"); pending rows older than 7 days (info) | |
| Campers (editors) | every team has ≥ 1 camper | — | ○ "optional" if none at all |
| Schedule | every day has blocks (`off` days excepted); no block ends before it starts; meal blocks tagged; no unmarked overlaps | each violation; a `games` block with no games ("Tue · Evening competition has no games") | |
| Games | every game attached to an existing block instance; tournaments runnable with this team count (6 or 4); ≤ 1 drawing game | unscheduled games; tournament on an unsupported count | |
| Meals | every meal-tagged block has a dish | count missing | ○ for a camp with no menu yet |
| Verses | theme + a verse for every `regular` day | missing days | |
| Cleanup | every meal-tagged block on `regular` days has ≥ 1 team | TBA count | balance per team is info |
| Electives (junior only, `CAMP.features.electives`) | every elective block has ≥ 1 station; every named person appears once per slot or on break | person in two stations in one slot | |
| Phone alerts | `pushSchedule.weekStart === meta.weekStart` and published blocks equal `scheduleWeek()` | out of date (button "Publish now") | ○ when `PUSH_SERVICE_URL` is blank |
| Double points | window inside the camp week | outside / missing | |
| Notice | | | info: Draft / Posted |
| Safety | | | info: newest restore point age; "Turn editable setup off" |

Below the checklist: **Tools** — New year…, Restore points, Back up / Import, Notice.

### 8.3 New-year wizard
Steps 1–4 only build a local draft (nothing is written until step 5, so abandoning
changes nothing):
1. **Which Sunday does camp start?** Date picker that only accepts Sundays. Derives
   `epoch`, the default double-points window (Thu 17:00 → Sat 00:00 camp time, matching
   2026's constants), and the finale day (Fri).
2. **What comes with you from last year?** One checkbox per section (schedule, games,
   meals, verses, cleanup, electives, teams' names/colours, notice), all on by default;
   unchecked = start that section empty. First year only (setup not live yet): the
   source is "this camp's built-in schedule" (camps.js + current config + `state.teams`).
3. **Teams.** N fixed slot cards (name, short, emoji, colour) prefilled; "Keep last
   year's" button.
4. **People.** Toggles: "Clear everyone's team assignment" (default on; owner row
   excluded), "Clear last year's campers" (default on, D2), "Paste this year's roster"
   (optional; creates pending rows).
5. **Archive and start.** Shows exactly what will be cleared ("22 results, 61 bonus
   entries, 2 brackets in progress") and then, on "Start the new year":
   a. require `pendingWritesTotal() === 0`, online, writer tab; warn if another editor
      is present in the builder;
   b. write `archive/<oldEpoch>` (create-only) and a `wizard` restore point; read the
      archive back with `once()` and compare its length — abort on mismatch;
   c. ONE atomic `update()` at the camp root: `state/{results,brackets,brackets4,drafts,
      picRounds,picSetup,bonuses,live,clocks,announcements}: null`,
      `state/meta/lastDataChangeAt: null`, `state/meta/epoch`, `state/meta/epochAt`,
      `state/notice/status: 'draft'`, `state/teams/<i>/<field>` for step 3,
      `setup/meta/{epoch,epochAt,weekStart,double,finaleDay}`, cleared sections,
      `members/<k>/teamId: null` for every non-owner member with a team,
      `campers: null` if chosen. Any refused path refuses all (nothing half-done);
   d. re-read state with `fbRef.once()` → normal adopt; publish the push schedule.
6. **Done** → hub, with the checklist now showing what's left.

Every device that later adopts a new `state/meta/epoch` (different from its stored
`state.ui.seenEpoch`) clears its device-local `followTeam`, `identity`, day ranks and
undo stack, and re-asks the team question. The change-history drawer hides entries
older than `epochAt` behind "Show last year" (the changelog is append-only, map 3 §3.2).

### 8.4 Week
Sunday date (same picker), day cards Sun..Sat with kind (Arrival / Camp day / Send-off
/ No camp), tag and day note, double-points window (two date-times defaulted from the
Sunday), finale day. Writes `setup/meta/*` and `setup/days/<dk>/{kind,tag,note}`.

### 8.5 Schedule (typical day, per-day one-offs, rain shuffle)
- **Typical day tab**: the template's blocks as rows (time range, emoji, label, detail,
  type, meal tag, elective slot, team-group chips for "who meets", default location,
  and the games attached on each day as chips). "+ Add block" defaults to the end of the
  previous block. "Use the typical day on: [Mon][Tue][Wed][Thu][Fri]" toggles `tpl`;
  turning a day ON that has its own blocks asks "Keep Tuesday's own blocks too / Replace
  them" (restore point first).
- **Day tabs Sun..Sat**: the resolved day with a badge per block — "typical", "changed
  today", "only today". Editing a typical-derived block opens a two-button choice the
  first time per session: **Just Tuesday** (writes `days/tue/edit/<bid>`) or **Every day
  like it** (writes the template; days with their own edit of that field are listed:
  "Tue and Thu have their own value — change them too?"). "Remove from Tuesday" writes
  `hide`. "Reset Tuesday to typical" removes `edit`/`hide`/`own` for that day after a
  restore point. Overlapping blocks are allowed but flagged; for an equal start a toggle
  "Show this one in Happening now" sets the lower `ord`.
- **Rain shuffle** (a "Shuffle today" button on today's and tomorrow's tabs): swap two
  blocks (exchanges their `start/end` as day edits), "Push everything after 2:00 PM
  later by [15/30/45/60] min", move a block to another time, move games between blocks,
  mark a game postponed. Edits stage in the panel with a before/after preview, then
  "Save" writes them as ONE `setupEdit` (one undo step, one atomic update). A
  "Tell people who get reminders for these blocks" switch (default on for today and
  tomorrow) triggers the change alert (10.2).
- Games attached to a block are never deleted with it: deleting the block detaches them
  to "Unscheduled on Tue" (⚠️ in the checklist) after a restore point.

### 8.6 Teams
N slot cards (`CAMP.teamCount`; no add / delete / reorder — fixed counts make slot ids
safe for per-field merge and kill B4's `t-<ts>` ids). Fields: name, short name (for
mentions and meeting labels; ≤ 12), emoji (picker + free entry, sanitised), colour
(palette swatches; a swatch used by another team is shown taken), photo (upload →
square-ish crop → canvas → PNG if it has transparency else JPEG, longest side 264 px,
≤ 90 KB; written to `teamPhotos/<tid>` and `photoV` bumped in the same root update).
Crest precedence: uploaded photo > shipped `images/team-shields/*.webp` > emoji.

Palette (proposed; contrast computed for this spec — the light value carries white text
and reads as text on `#ffffff` / `#f4f6f9`; the dark value reads as text on the dark
surface `#1a2030` and carries the dark ink `#10141c`; every pair ≥ 4.5:1):

| id | light | dark | | id | light | dark |
|---|---|---|---|---|---|---|
| red | #d43125 | #e15f56 | | teal | #1b7e76 | #24a89d |
| orange | #b8530f | #de6312 | | sky | #1876a5 | #1d8fc9 |
| amber | #966708 | #c2850a | | blue | #356ad4 | #5b86dc |
| gold | #846c0b | #bd9a0f | | indigo | #6a61d1 | #847dd9 |
| green | #257e43 | #2e9e53 | | purple | #974dcb | #a96dd5 |
| pink | #ce2c7d | #db5799 | | brown | #9b633b | #ba794a |

`teamAccentVars(id)` returns `--ta-l:<light>;--ta-d:<dark>`; CSS picks `--team-accent`
per theme (`body.dark-theme` and the media-query block). A team with no `color` gets
today's single hex in both (junior identical until a colour is chosen). A palette test
recomputes every ratio. (Today's accents fail one theme each: Pilgrim 2.38:1 on dark,
Pumpkin 2.95:1 on white, senior Red 2.99:1 on dark.)

### 8.7 People (one team list)
One screen, grouped by team then "No team": each staff row shows ✓ (has a sign-in), ⏳
"No sign-in yet" (pending), or 🙋 "Asking to join" (request). Data stays in `members`
(rows) and `accessRequests` (requests); the screen reads the live `memberDirectory`
(app.js:2739) and an editor-only `accessRequests` listener. Actions reuse the existing,
tested write paths (`createMemberIfAbsent` 1534, `planMemberAdd` 1546,
`convertPendingMember` 1575, child writes 1631-1677).
- **Typed roster**: "Paste a roster" accepts lines `Team name: Ana, Ben` or one name per
  line under a chosen team; de-duplicates against existing names case-insensitively
  (the `missingSeedCounselors` rule, 1334) and writes pending rows in one update.
  `SEED_COUNSELORS` becomes the default text of this box for junior.
- **Trickle-in**: pending row → "Add email or phone" (existing convert flow, but with a
  sheet instead of `prompt()`).
- **Walk-ups**: the denied screen (index.html:107-112) gains a form: name (required),
  team (optional select of team names — team names are not secret), note. It writes
  `accessRequests/<myKey>` once and shows "Sent — a director will let you in". An editor
  sees 🙋 rows: **Let in as Viewer / Editor** (if the name matches a pending row
  case-insensitively, the default action is "This is Sofie on Pumpkins" → convert that
  row to the request's identity key, then delete the request; otherwise
  `createMemberIfAbsent` then delete), or **Not now** (delete). Two requesters for one
  pending row → the second sees the row already converted.
- **Owner row** (rules#5): `OWNER_MEMBER_KEY = 'patricksimpson,fx@gmail,com'` in app.js
  (pinned to the rules string by a rules test); treated like "self": no switches, no team
  select, label "Managed in the Firebase console". Bulk member updates skip it.
- **Campers** (editors only, from `campersSync`): per team a list of first names with
  add (paste many, one per line), rename, move to team, remove. Copy states "First names
  only — visible to directors only". Never rendered for viewers, never on the TV, never
  in push payloads, chat mention targets, backups or restore points.

### 8.8 Meals, verses, cleanup, electives
- **Meals**: grid of days × meal-tagged blocks (from `mealBlocks(dow)`), dish + emoji.
- **Verses**: theme (title, text, ref) + one card per `regular` day (text, ref, https
  video).
- **Cleanup**: grid days × meals, team chips multi-select (per-team set), "Fill evenly"
  auto-rotate button (writes all cells in one edit; undoable).
- **Electives** (junior): stations (name, emoji); a day × slot board where each station
  lists people (chips picked from the member directory, or typed); "Copy Monday to every
  day". Slot times come from the elective blocks themselves, so a rain shuffle that moves
  Elective 2 moves its time everywhere (fixes the `ELECTIVE_SLOT_MIN` duplication).
  Identity adoption (`adoptMemberTeam`, 4666) changes from "name is in
  `TEAM_COUNSELORS`" to "name appears in any elective roster or in `TEAM_COUNSELORS`".

### 8.9 Games on blocks (Stage 6)
The Games section is block-centric: day → each `games` block instance → its games (drag
or up/down by `ord`) → "+ Add game here"; plus an "Unscheduled" bin. The game editor
sheet keeps today's fields (settings.js:354-526) and adds: block picker, status,
bracket settings for tournaments (kind shown from team count: 6 → classic wizard, 4 →
semis/3rd/final; seeding Standings 1v4 & 2v3 / Pick at start / Fixed pairs; 3rd-place
before or after the final). Save writes only fields that differ from the draft's base
(field-level, `setupEdit`), so it can't clobber another editor's other fields (this is
the root fix for scoring#3). Remote changes to the open game: untouched draft fields
update live; touched ones show a "Jenn changed this" chip. Game deleted remotely → the
sheet says so and offers Discard / Save as new. Format change on a started game deletes
`results/brackets/brackets4/drafts/live/clocks` for it after a confirm (scoring#6);
`deleteGame` and `pruneOrphanedGameData` also delete `clocks`.

Moving a game onto or off a day whose games are double points asks "Friday is
double-points — make this game double too?" (sets `messtival`).

### 8.10 Data
Back up (now `{app:'campScoreboardV3', camp, epoch, setup, teams, notice, meta,
clocks, results…}` — camp id included, campers excluded), Import (refuses another
camp's file unless confirmed; makes an `import` restore point first; normalises), Turn
editable setup on/off (writes `meta.live`; restore point), Archives (download a year as
JSON).

---------------------------------------------------------------------------------

## 9. The 4-team bracket

Data: `state/brackets4/<gid>` (new sync key, item map, per-match diff):
```text
{ seeded:true, at:<ms>,
  m: { s1:{a,b,winner?,at?}, s2:{a,b,winner?,at?},
       third:{winner?,at?}, final:{winner?,at?} } }
```
Third-place and final teams are DERIVED (semi losers / semi winners), never stored, so
two editors can never write inconsistent pairs. Phase is derived:
`seed` (no s1/s2) → `semis` → `third`/`final` in the game's `bracket.order` (default
3rd first, D5) → `summary`. RTDB pruning is harmless (absent winner = undecided).
`computeSyncUpdates` diffs `brackets4/<gid>/m/<match>` per match, so two semis recorded
on two phones both stick.

Logic as pure functions (new, unit-tested; the click handlers only call them):
`bracketKindFor(teamCount)` (6 → `'six'`, 4 → `'four'`, else null with a count-aware
message), `fourSeeds(mode, game, standings)` (standings mode: 1v4, 2v3 by
`rankTeamsByPoints`, ties broken by the existing gold/silver/bronze order, then slot),
`fourPhase(b, order)`, `fourCurrent(b, order)`, `fourNext(b, order)`,
`fourRecord(b, match, winner)` (refuses if that match already has a winner or its teams
aren't decided — the stale double-tap guard), `fourUndo(b)` (clears the most recent
`at`), `fourMedals(b)` (gold = final winner, silver = final loser, bronze = third-place
winner).

UI reuses `matchupCalloutHTML`, `matchTrackerHTML`/`bindMatchTracker`,
`bindMatchupCopy` with stage names "Semifinal 1/2", "3rd-place match", "Final". Every
step has Undo. Save → `results[gid] = {medals, savedAt, path}` where `path` is the
finished bracket (also added for the 6-team wizard) so "Reopen bracket" can restore it.
Readers updated: `currentMatchupOf`/`nextMatchupOf` (5804-5827), `upcomingMatchups`
(2964), `renderLiveHome`/`renderLiveWatch` labels and completed list, `liveHomeGames`,
`gameStatus`, `bracketRefsTeam`, `findNextMatchupFor`. The 6-team code is untouched
apart from the result `path` and a defensive "unknown phase → message" branch (never
summary). `tests/week.senior.test.js:105-115` changes from "refuses" to "starts a
4-team bracket".

---------------------------------------------------------------------------------

## 10. Outputs

### 10.1 Phone alerts: publishing the schedule from data
- `pushScheduleBlocks(week)` takes `scheduleWeek()`; a block with `iid` publishes under
  that id and `alertKey` as `key`; a block without (pre-switch) keeps today's
  `d<dow>-<start>-<i>` and `pushBlockKey(label)` — so pre-switch output is identical
  (push.test.js unchanged). After the switch, keys are unchanged (seeded from the same
  function), only ids change (`mon-b-breakfast`), which changes notification tags once.
- `weekStart` is read from `setup/meta/weekStart` once setup is live; the Phone-alerts
  drawer shows it read-only with "Change in Camp setup → Week".
- An editor device republishes (debounced 60 s after the last schedule edit, and on
  load when stale) with `rev = meta.rev + 1`, writing `setup/meta/rev` in the same
  root update so rev and blocks never disagree.

### 10.2 Mid-week change alerts (Worker; owner redeploys)
- New `/notify` kind `schedule` (`routeNotify`, worker.js:1848): editor-only (ID token +
  role check like `notifyAlert`), body `{camp, kind:'schedule', alert:true|false}`. The
  Worker trusts nothing but the database: it reads `pushSchedule` and its private
  `pushServer/<root>/schedSeen`, diffs by block id (start, label, removed, added),
  keeps instances whose date (`weekStart + dow`) is today or tomorrow in camp time and
  whose start hasn't passed, and — if `alert` — sends to devices whose prefs have
  `blocksAll` or `blocks[key]` (ignoring `lead`), one push per device listing up to 3
  changes ("🕒 Evening competition now 6:30 PM (was 6:00)", "Lights out cancelled
  today", "New: Movie night 9:15 PM"). It then stores `schedSeen`. `alert:false` only
  advances `schedSeen`. Rate-limited with `takeRateSlot` (10 s), audited in
  `pushAlerts`, batched through the existing outbox. Payload kind reuses `block`
  (`open:'schedule'`, tag `sched-<iid>-<date>`), so **sw.js does not change**.
- Client: after a publish caused by a schedule edit, call `/notify` with the switch value
  from the shuffle panel. While `PUSH_SERVICE_URL` is blank, nothing is called.

### 10.3 TV page for both camps
- `camps.js`: `activeCampId()` honours `window.CAMP_FORCE` when it names a known camp (one
  line; the app never sets it, so junior is unchanged). The TV page sets
  `CAMP_FORCE` from `?camp=` (else `localStorage.campScoreboardActiveCamp`, else junior)
  and loads `defaults.js`, `camps.js`, `week-data.js` with the shared `?v=`. That
  removes its duplicated constants (STORAGE_KEY, team names/emoji/shields, double
  window) — root cause of pages#5-style drift.
- Reads `<root>/state` and, if games are live, `<root>/setup/games` + `meta` (else
  `config`); team identity from `state.teams` + accessors; crest from `teamPhotos`
  (`once()` per version) else shipped shield else emoji (no `src="undefined"`); intro
  and cannon iterate `state.teams` (no literal t0..t5); finale on `finaleDay()`.
- Fixes: pages#3 (cancel callbacks → "access removed" overlay → reload in 5 s), pages#5
  (skip results whose game id isn't in the live catalog, like `medalCounts`), pages#6
  (phone accounts: mirror `identityKey`). `stalling.html` gets a camp toggle link.
  `TV_BUILD` bumped.

### 10.4 Full-week .ics
`buildWeekIcs()` beside `buildDayIcs` (which becomes a filter of it): all timed blocks
Sun..Sat with dates from `campDateFor(dow)` (= `weekStart + dow` when set; today's
week otherwise), `UID:<camp>-<epoch>-<iid>@camp.patricksimpson.info` (fixes the junior
Tue/Thu duplicate UIDs and the junior/senior collision), `SEQUENCE:<meta.rev>`,
`DTSTAMP`, `X-WR-CALNAME:<camp label> <year>`, dishes and cleanup notes in
DESCRIPTION, games from `gamesForBlock`, 75-octet line folding, existing VTIMEZONE.
Button "Add the whole week to my calendar" at the top of the schedule sheet.

---------------------------------------------------------------------------------

## 11. Migration and seeding

### 11.1 The switch (per camp, any editor, from the hub's first-run card or the Data screen)
1. `transaction()` on `setup/meta`: proceed only if absent → write `{v:1, live:false}`.
2. `seedSetup(CAMP, state.config, state.teams)` builds the tree deterministically
   (section 11.2) and writes it in one `update()` (sections + markers + `weekStart` if
   `pushSchedule/weekStart` exists).
3. Restore point `auto` "Before editable setup".
4. `setup/meta/live = true`. All devices switch on their next snapshot.
Two editors switching at once produce byte-identical trees; the transaction makes one
of them a no-op. A crash between 2 and 4 leaves `live:false` (constants still in use);
"Finish switching" re-runs 2 idempotently.

**Rollback**: set `live` to false (Data screen, or the owner in the console:
`setup/meta/live`). Every device returns to the constants on the next snapshot; the
data stays for later. Per-section rollback: remove that section's marker.

**Recommended order**: senior first (placeholder data, no live week), junior only
off-season. Junior is byte-identical until its switch; after it, identical by the seed
tests (11.3) except push ids (accepted, documented).

### 11.2 Seeder (deterministic, pure, in `week-data.js`)
- Schedule: template `typical` = the first weekday's blocks; each other weekday matched
  block-by-block (same start, end, type and label head) to the template; differing
  fields → `edit`; template blocks missing that day → `hide`; extra blocks → `own`
  with `ord` placing them before an equal-start template block (preserves array order).
  Sun/Sat (or any day without weekday blocks) → `own` only. Label tails that equal a
  team group rendering become `teams`; other tails become `detail`. Labels exactly
  "Breakfast"/"Lunch"/"Supper" get `meal`. `alertKey = pushBlockKey(rendered label)`.
  Kinds: Sun `arrival`, Sat `sendoff`, days with blocks `regular`.
- Days: `tag` from `SCHED_DAYS`, `note` + `legacyId` from `config.days` by `dow`.
- Meals / verses / cleanup / electives: straight transcriptions keyed by `dk`
  (cleanup values become team sets; elective rosters become `nameKey → name`).
- Games (Stage 6 switch, a second marker): every config game copied with its id; `day`
  from `dayId → dow`; `block` from an EXPLICIT backfill table, not the session heuristic
  (which is wrong today, games map §0.2):

  | camp | games | block |
  |---|---|---|
  | junior | Mon–Fri `Morning` | `b-team-competitions` (10:00) |
  | junior | Mon–Thu `Evening` | `b-evening-competition` (18:00) |
  | junior | `team-skits` (Fri Evening) | Friday's own "Team Skits" 19:00 block (its `type` becomes `games`) |
  | senior | `team-comp-am-*` | `b-team-competitions` (9:45) |
  | senior | `team-comp-pm-*` | `b-team-competitions-2` (15:00) |
  | senior | `legacy-game-*` | `b-legacy-game` (16:50) |
  | senior | `hot-seat-*`, `lets-make-a-deal-*` | the 18:50 block |
  | any | anything else | first `games` block of its day at or after the session's start, else Unscheduled |

  `ord` = config array order within the block. Games whose `dayId` matches no day go to
  Unscheduled.
- Teams: nothing is written to `state.teams` by the switch (absent fields already mean
  "constant"); the Teams screen writes fields when an editor sets them.

### 11.3 Junior byte-identity: what proves it (prototype results)
A scratch prototype of exactly this seeder + resolver, run in the real test harness:
- junior: 26 template blocks, 5 day edits (Tue/Thu meeting group, Tue/Wed/Thu campfire
  leader), 8 Friday hides, 26 own blocks (Sun 9, Tue 1, Thu 1, Fri 10, Sat 5); tree
  7.3 KB vs 13.2 KB of constants; `resolveDay` deep-equals `DAY_SCHEDULE[d]` for all 7
  days.
- senior: 20 template blocks, 6 own blocks; 3.5 KB vs 9.5 KB; deep-equal all 7 days.
- `nowBannerHtml(d, m)` produced byte-identical HTML from the constants and from the
  resolved seed for all 10,080 minutes of the week, in both camps.

These become permanent tests (`tests/setup-seed.test.js` + `.senior`), plus a frozen
fixture of the seeded ids (`tests/fixtures-setup-seed-junior.json`) so a later change to
the slug rule can't silently re-key a live camp's blocks.

### 11.4 Things deliberately left as code
`CAMP.features.electives`, `CAMP.teamCount`, `CAMP_TZ`, `MEDAL_POINTS`, `HIDEABLE_CARDS`,
`CHAT_CHANNELS`, weather coordinates, and the camps.js constants themselves (they are
now the seed and the pre-switch source; the fixture test keeps pinning them).
`normalizeSyncedState`'s 2026 roster migrations (app.js:6303-6311) are skipped once
`state.meta.epoch` exists, so a new year's blank counselor text or a team named "Team
1" is never rewritten to 2026 values.

---------------------------------------------------------------------------------

## 12. Staged build plan

Every stage: tests green (`node tests/run.js`), `node --check` on changed files, all
`?v=` bumped together (the list grows from 12 to 15 with `week-data.js`,
`setup-sync.js`, `setup-ui.js`), `APP_VERSION`, `CODE_UPDATED_AT`, CLAUDE.md updated,
live verification by curl. Rules (when any) are published and probed BEFORE the code
push (6.5). `tests/harness.js` `APP_FILES` becomes `defaults, camps, week-data, app,
setup-sync, settings, setup-ui, chat, push`.

| Stage | Ships | Rules | Tests added/changed | Rollback | Safe during a live camp? |
|---|---|---|---|---|---|
| **1 Foundations** | `OWNER_MEMBER_KEY` (rules#5); `.danger-link` + other danger text → `--color-danger-text` (B14); scoring#6 + `clocks` cleanup; B1 zombie draft; B5 deleted-game save; config `configReady` gate + `pendingConfigWrites` + `pendingWritesTotal()`; poison-path quarantine for `pushState`; `teams` + `notice` per-field diff; epoch check in `firstSnapshotMerge`; Web Locks two-tab guard; roster-migration gate | none | sync.test "teams written whole" → per-field; new quarantine, epoch, lock (stubbed `navigator.locks`), owner-row, scoring#6 tests | revert commit | yes (no data shape change) |
| **2 Seam + TV** | `week-data.js` accessors returning the constants; every direct reader converted (section 7); `teamAccentVars`; `CAMP_FORCE`; TV `?camp=` + pages#3/#5/#6; full-week `.ics` using today's dates rule (UID fix) | none | accessor `===` tests both camps; ics UID uniqueness; TV pure functions extracted into week-data where shared | revert | yes |
| **3 Setup data (dark)** | `setup-sync.js` engine (setup instance), seeder, resolver, switch flow, undo, restore points, presence `where/v`, hub (read-only checklist), Data-screen switch | setup (without `games`), setupRestore, setupRestoreIndex, presence fields | engine: leaf diff, 3-way merge (prune + key-order variants copied from sync-offline.test), epoch discard, hold-on-focus, quarantine; seed identity + banner fuzz (both camps); undo conflict; restore round-trip; rules + emulator | `live:false`; revert code; rules inert | yes — nothing changes until an editor switches a camp |
| **4 Week & schedule editors** | Week, Schedule (template/day/one-offs/rain shuffle), Meals, Verses, Cleanup, Electives screens; push publishes from data + `rev`; `weekStart` canonical; change-alert client call | pushSchedule `rev` | checklist conditions; resolver edits (edit/hide/own/clear); rain shuffle as one atomic edit; push blocks from data | `live:false` | yes (per camp switch) |
| **5 Teams & people** | Teams screen (palette, short, emoji, photo), People screen, walk-up form + approval, campers (`campersSync`), member name cap, client-side senior "Red" mention via `teamShort` | teamPhotos, accessRequests, campers, members.name cap | campers editor-only (rules + client never attaches for viewers + wiped on downgrade); request approval matches pending row; palette contrast; photo sanitiser | revert; nodes inert | yes |
| **6 Games on blocks + 4-team** | `setup/games` + games switch, derived `state.config` + mirror, rebuilt game editor (field-level save), block-centric Games screen, `brackets4` | setup/games, state/brackets4 | derive-config equals seed config (ids, order, messtival); backfill table; field-level save vs concurrent edit; bracket4 pure functions + sync per-match + prune fuzz; senior bracket test rewritten | remove `games` marker (back to config); revert | games switch only between camp weeks; 4-team only matters for senior |
| **6b Config fence** | — | F1 (`config/updatedAt` must start `mirror `) | rules test | PUT previous rules | yes |
| **7 New year** | wizard, archive, epoch device reset, history filter, restore UI complete | archive | wizard commit is one atomic update; refused path changes nothing; stale-epoch device discards; archive verify-before-clear | restore the `wizard` point | not during a camp week |
| **8 Worker** (owner pastes) | `/notify` kind `schedule`; `campTeams` reads `short`; `teamNamedIn` accepts the exact short name (≥ 2 chars) | none | push-worker.test + opt-in push-e2e | paste previous worker.js | yes (dormant until `PUSH_SERVICE_URL`) |
| **9 Retire** | old Games/Days/Teams tabs removed; config listener code removed (mirror kept one more season); F2 fence | F2 | — | — | off-season |

---------------------------------------------------------------------------------

## 13. Deferred Project-1 items

| Item | Where it is fixed |
|---|---|
| scoring#3 (whole-config `set()` from a stale copy) | Stage 1: `configReady` gate + in-flight accounting (the cheap half); Stage 6: games become id-keyed leaf data with field-level saves — the root fix. (The earlier interim `rebaseOnPendingConfig` stays skipped, per RESULTS-G1.) |
| scoring#6 (saveGameDraft half) | Stage 1: format change also deletes `brackets/drafts/live/clocks`; `deleteGame`/`pruneOrphanedGameData` delete `clocks` |
| rules#5 (owner row) | Stage 1: `OWNER_MEMBER_KEY` treated like self; bulk updates skip it |
| pages#3/#5/#6 (TV) | Stage 2 |
| Two tabs same camp | Stage 1 (Web Locks; Safari < 15.4 keeps the documented limit) |
| `.danger-link` and other danger text in dark mode | Stage 1: `.danger-link`, `.editor-footer .danger-link` and the text sites at styles.css 499, 1695, 2262, 2331, 2358, 2685, 2964, 3197, 4194, 4728, 5198 use `--color-danger-text` (already #ff8a8a ≈ 7:1 on dark) |
| Senior "Red" short-name mention gap | Stage 5 (client `teamShort`) + Stage 8 (Worker reads `state/teams/<i>/short`, exact-word match) |

Also folded in (found while mapping): duplicate `.ics` UIDs; games-to-block heuristic
(senior Afternoon games never shown, junior Team Skits never shown); `MEAL_START_MINUTES`
junior-only times; hard-coded 2026 double-points window; backup missing
notice/meta/clocks and camp id; import across camps; added-team ids failing
`isTeamId`; Sofia/Lily identity adoption (partly — see D4).

---------------------------------------------------------------------------------

## 14. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | A client ships ahead of its rules and wedges score sync (C2) | Rules-first per stage; quarantine (4.5) turns a refusal into one visible line; new nodes degrade alone |
| R2 | The generic engine has a merge bug that loses setup edits | It is a clone of the reviewed state engine using the same pure helpers; port every scenario in sync-offline/sync-merge tests (prune, key order, force-quit, ack ordering) before Stage 3 ships; senior switches first |
| R3 | Junior regresses at its switch | Seed identity + 10,080-minute banner fuzz tests; switch off-season; `live:false` rollback in seconds |
| R4 | Old editor clients during the games cutover | Derived mirror keeps them reading; F1 fence refuses their writes; auto-reload retires them; cutover between camp weeks |
| R5 | 4-team bracket objects confusing old clients | Separate `brackets4` key old clients never read |
| R6 | Camper names leak | Own node, editor-only `.read` (rules-enforced), listener only for editors, separate cache wiped on sign-out AND on downgrade, excluded from backups/restore points/TV/push/mentions; rules test pins it |
| R7 | Walk-up requests as a spam surface | Verified identity required, one ≤ 400 B row per identity, refused once a member, no listener for requesters; editors can delete; worst case a few KB |
| R8 | Live collaboration fights focus | Hold-on-focus + in-place field patches + deferred structural re-render of the focused container; drafts persisted |
| R9 | New-year commit half-applies | One atomic root update after a verified archive; refused path ⇒ nothing changed |
| R10 | A stale phone resurrects last year's scores | Epoch check in both engines (new builds); 36 h confirm on old builds (accepted residual) |
| R11 | Photo bandwidth/storage | ≤ 90 KB each, `once()` per version, IndexedDB cache, never on a listener |
| R12 | Push id change at the switch re-sends a reminder | Switch off-season; tags only change once |
| R13 | The checklist nags about optional things | Optional sections show ○/info, never ⚠️ |
| R14 | The rules file grows large and hand-published | Rule macros generated by a tiny node script in `tests/` that checks (not writes) both roots are identical; publish runbook with probes per stage |
| R15 | Scope: 9 stages | Stages 1–2 are independently valuable; 3–5 deliver the owner's setup asks; 6–8 can follow; each leaves a working camp |

---------------------------------------------------------------------------------

## 15. Decisions only the owner can make

- **D1** A second tab of the same camp on one computer becomes view-only (with "use this
  tab instead"). OK?
- **D2** Camper names: cleared by the new-year wizard by default? Never archived, never
  in restore points or backups (proposed)? Anyone besides editors ever see them (print
  sheets, team cards)?
- **D3** Walk-ups: allow the self-request row (any verified Google/phone account can
  write one small row), or keep "tell a director your email"? Default role on approval
  (Viewer proposed)? Notify editors only in-app (proposed) or also by phone alert?
- **D4** Are Sofie/Sofia, Lilly/Lily, Alysa/Alyssa the same people? Should electives
  keep matching by name (proposed, picked from the member list) or move to member keys?
- **D5** 4-team bracket: 3rd-place match before the final? Default seeding (by
  standings 1v4/2v3 proposed)? Which senior placeholder games become tournaments?
- **D6** Schedule-change alerts: which changes alert (time, rename, cancel, add), only
  today/tomorrow (proposed), and do they respect the "director alerts" mute?
- **D7** Restore points: keep 40 automatic + 20 named (proposed)? May any editor restore,
  and may a restore ever bring back scores (proposed: only from new-year points, and
  unchecked by default)?
- **D8** Archive: include chat history/photos (proposed: no)? Can editors delete
  archives (proposed: no, console only)?
- **D9** Palette: the 12 swatches above, two teams never share a colour (proposed)?
- **D10** Photos: may an upload replace the shipped junior shields? PNG allowed (needed
  for transparent shields)?
- **D11** Should the "Happening now" banner become date-aware once a week start exists
  (e.g. "Camp starts Sunday, July 18")? (Not in this project by default.)
- **D12** Double points default: Thursday evening + Friday, and the bonus window Thu 5 pm
  → Sat midnight?
- **D13** Senior's real Sunday arrival and Saturday send-off schedules, and does senior
  really run Mon–Fri competition days?
- **D14** Do we need a "postponed" game status, or is moving/deleting enough?
- **D15** When to switch each camp to editable setup (senior first, junior off-season
  proposed), and when to retire the legacy config mirror (one season proposed)?
- **D16** "Every day like it" vs "Just this day": ask every time, or remember the choice
  for the session (proposed: ask the first time per session)?

---------------------------------------------------------------------------------

## Appendix A — files and new functions

| File | New / changed |
|---|---|
| `week-data.js` (new) | `setupTree`, `sectionLive`, `normalizeSetup`, `seedSetup`, `resolveDay`, `renderBlockLabel`, accessors (section 7), sanitisers, `TEAM_PALETTE`, `setupChecklist`, `deriveLegacyConfig`, `fourSeeds/fourPhase/fourCurrent/fourNext/fourRecord/fourUndo/fourMedals`, `bracketKindFor` |
| `setup-sync.js` (new) | `createDomainSync`, `leafDiff`, `setupEdit`, `campersEdit`, `stateEdit`, undo/redo, `createRestorePoint`, `listRestorePoints`, `applyRestorePoint`, presence `where`, Web Locks writer guard, switch flow, wizard commit, config mirror writer |
| `setup-ui.js` (new) | hub, wizard, Week, Schedule (+ shuffle), Teams, People, Meals, Verses, Cleanup, Electives, Games (Stage 6), Restore points, Data screens |
| `app.js` | consumers → accessors; `pendingWritesTotal`; quarantine in `pushState`; teams/notice per-field diff; epoch in `firstSnapshotMerge`; `brackets4` sync key + UI; `OWNER_MEMBER_KEY`; `buildWeekIcs`; `idleRetryTick` covers domains; hooks typeof-guarded like chat/push |
| `settings.js` | game editor → field-level `setupEdit` (Stage 6); old tabs hidden once their section is live; Notice tab moves under the hub |
| `camps.js` | `CAMP_FORCE` in `activeCampId`; constants unchanged |
| `push.js` | `pushScheduleBlocks(scheduleWeek())`, `rev`, change-alert call, week start read-only |
| `chat.js` | mention targets from `teamShort`, member names and elective rosters |
| `current-standings.html` | `?camp=`, shared scripts, fixes pages#3/#5/#6 |
| `push-worker/worker.js` | kind `schedule`, `short` in `campTeams`/`teamNamedIn` |
| `database.rules.json` | sections 6.2–6.4, staged |
| `tests/` | `setup-sync.test.js`, `setup-seed.test.js`(+`.senior`), `setup-checklist.test.js`, `bracket4.senior.test.js`, `palette.test.js`, `wizard.test.js`, `campers.test.js`, `access-requests.test.js`, fixtures for seeded ids; updates listed per stage; `tests/emulator/setup.mjs` |
