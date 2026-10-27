# Project 2 — Setup UX rebuild — spec draft: MIGRATION & RISK FIRST

Baseline: repo at `63005d9`, `APP_VERSION = 183`, `node tests/run.js` = 436 passing / 22 files.
Angle of this draft: start from the live system (two camps with real data, cached old
clients, hand-published rules, push-to-main deploys, a test suite that pins junior data)
and design the path there first; the features are then fitted into stages that each
leave a running camp week safe.

Today is 2026-10-27. Junior ran in July 2026, so we are in the off-season. That is the
biggest risk reducer available: the risky cutovers should land before next summer. The
plan still assumes a camp week *could* be running whenever any stage deploys.

---

## 0. The short version

1. **Deploying code never changes a running week. Only an editor action does.** Every stage
   ships inert. The new behaviour turns on per camp through one of three explicit editor
   actions, and each one can be undone:
   - **A1 "Start using the editable schedule"**: seeds the camp's `setup` node from
     camps.js. Undo: the *Pause* switch (`setup/meta/paused`) puts the built-in
     schedule back for everyone.
   - **A2 "Attach games to the schedule"**: writes `blockId` onto games. Undo: a restore
     point.
   - **A3 "Start a new camp year"** (the wizard): archive, then clear, then set up. Undo:
     restore the archive.
2. **New data goes in new sibling nodes. Existing shapes never change.** `config` keeps
   its 5 data keys and its arrays (plus one optional fence marker, `mark`, §7.2), and
   `state` keeps its 12 keys. New things live under
   `<root>/setup`, `teamPhotos`, `campers`, `restoreIndex`, `restoreBody` and
   `accessRequests`. Only three data additions touch existing nodes, and all three are
   additive and need no rules change:
   - optional `blockId`/`ord` fields on games;
   - `state/meta/epoch`;
   - a new bracket `kind` under `brackets/<gid>`.
3. **camps.js stays forever, as the seed and as the fallback.** Every reader goes through
   accessors (Stage 0) that return the camps.js constants until the camp is seeded.
   Seeding is deterministic, and a fidelity test proves that a freshly seeded camp
   renders exactly what the constants render. Junior stays byte-identical until someone
   presses A1, and is output-identical right after.
4. **Rules go in additive-first, fenced-last.** Each stage that needs rules does a Cloud
   Shell PUT *before* its code deploy. Every rules change ships with an emulator proof in
   two directions: old client against new rules, and new client against old rules.
   Fences that deliberately refuse old builds come last (Stage 8). They are gated on
   evidence from a new presence field `v` (APP_VERSION) showing that no old build is
   still open.
5. **scoring#3 is fixed first, on the existing node, with no schema change** (Stage 1).
   The fix is a config engine with a persisted baseline, a three-way merge and
   transaction-based per-field writes. The games catalog then *stays* in `config`
   permanently. The risky "move games to a new node, mirror, fence" cutover is avoided
   entirely.
6. **Nine stages: S0 to S8.** The owner does four rules PUTs (S2, S3, S5, S8) and two
   Worker pastes (S5, S7). Nothing else is manual.

---

## 1. Goals and non-goals

### Goals (each traced to the owner interview)
| # | Goal |
|---|---|
| G1 | All editors can set up a camp: laptop for the big setup, phones mid-week, several editors at once. |
| G2 | A **new-year wizard** (copy last year → archive last year → clear scores) plus a **checklist hub** with ✅/⚠️ per section for everything afterwards. |
| G3 | The week is always Sun–Sat. Setup asks "which Sunday does camp start?" and that answer is the single source of truth for every date-dependent output. |
| G4 | **The schedule becomes editable synced data.** Build one typical day, copy it to Mon–Fri, then make per-day one-offs ("just this day" vs "every day like it"). Arrival (Sun) and send-off (Sat) days are separate. |
| G5 | Teams: fixed counts (junior 6, senior 4), each with a name, a light/dark-safe palette colour, an emoji and an optional uploaded photo. |
| G6 | People: typed roster, trickle-in, and walk-ups requesting access, all landing in one team list. Camper first names per team are **editor-only, enforced by rules**. |
| G7 | Meals, verses (plus theme), cleanup rota and junior electives become editable, seeded from camps.js. |
| G8 | Games are attached to schedule blocks. The 4-team bracket is finished (2 semis → 3rd-place match → final). |
| G9 | Curveballs: rain shuffles, two editors at once (per-field merge plus a "Jenn is also here" tag), bad Wi-Fi (offline edits survive a reload or force-quit). |
| G10 | Safety: undo, and automatic restore points. |
| G11 | A mid-week schedule change alerts that block's phone-alert subscribers. |
| G12 | Outputs: the TV page for both camps (`?camp=`), and a full-week `.ics`. |
| G13 | Deferred Project-1 items: scoring#3, scoring#6 (saveGameDraft half), rules#5, pages#3/#5/#6, the two-tabs limit, `.danger-link` contrast, and the senior "Red" mention gap. |
| G14 | Home-screen consumers read through stable accessors, so the separate layout redesign can sit on top. |

### Non-goals
- The home-screen layout redesign itself. This project only **flags the seam** (§8.3).
- Firebase Storage or Cloud Functions (Spark plan). Photos are compressed `data:` URLs in RTDB.
- A new role. All editors can do everything here.
- A live calendar subscription feed (`webcal:`). The export is a downloaded file.
- Parallel semifinals on two fields. `state.live` stays one match per game.
- Variable-length weeks. The week is Sun–Sat, always.
- Moving the games catalog out of `config` (see §0 item 5 and §5.2).
- Re-keying Pictionary state by game. The "one drawing game per week" rule stays.

---

## 2. Ground truth: the live system this has to survive

| Fact (verified in code) | Consequence for the plan |
|---|---|
| **Two roots with real data:** `campScoreboard/*` (junior; the literal must never change) and `seniorScoreboard/*` (senior). The rules blocks are identical modulo root, and `tests/rules.test.js` pins that. | Every node, rule, test and probe below is written once and applied to both roots. |
| **Cached old clients.** Auto-reload polls `index.html` every ~2 min and reloads only when `reloadBlocked()` allows. A phone that is offline or backgrounded can stay on an old build for days. | Every stage assumes builds N-1 and N-2 are writing at the same time as N. |
| **Old builds write `config` as a whole-node `set()` of exactly 5 keys** (`pushConfig`, app.js:2354). They treat `games`/`days`/`sessions` as arrays (`migrateState` app.js:1932 resets a non-array to `[]`). | Never add a data key to `config`, and never change those three shapes. Optional fields *inside* a game survive old builds: they adopt the remote copy wholesale and `toEditableDraft` deep-clones it (settings.js:317). |
| **`state` is sealed to the 12 SYNC_KEYS** (rules `$other:false`). `pushState` is one atomic multi-path `update()`, so one refused path fails the whole batch, and it retries forever with only `console.warn` (app.js:2925-2931). | Never add a SYNC_KEY. New paths under existing keys must already be legal under the published rules. |
| **`state.teams` is a whole-array singleton** (app.js:2804), read by the Worker (`campTeams`, worker.js:1687) and by the TV page (`normalizeTeams`). | Keep `{id,name,counselor}` there. Put new branding elsewhere. Make new clients write teams per field (fixed counts make index paths stable). |
| **Rules are hand-published** with a Cloud Shell PUT. Tests prove only the repo file. | Every rules step comes with a copy-paste command, a backup GET first, and the unauthenticated probe list (§7.5). |
| **Ancestor `.validate` is not evaluated**, so a write to `a/b/c` checks only rules at and below `c`. CLAUDE.md records this as the known `state/<unknown>/<child>` hole. | Record-level `hasChildren` checks (and `$dk`/`$tid` key patterns) protect whole-record writes only. Per-field writes into a deleted record must be stopped by the client engine (§5.3.5) and healed by the normalizer (§4.7), which also ignores unknown day and team keys. The design holds either way: if the emulator shows RTDB *does* check the record rule, such a write is refused instead, and it lands in the bisect quarantine (§5.3.5). The `setup-compat.mjs` case (d) records which behaviour is real. |
| **Push is dormant.** `PUSH_SERVICE_URL = ''` (push.js:37). `initPush` returns before `pushMaybeRepublishSchedule` (push.js:972-977). The "Camp week" section renders only when `pushConfigured()` (push.js:1460-1463). | **No shipped build can write `pushSchedule` today.** The well-known "stale editor republishes the code schedule" hazard only exists if Project 1 goes live *before* S3. See §11.3 and decision D4. |
| **Tests pin junior week data** through the app.js global aliases (`tests/camps.test.js:35-51`, fixture `tests/fixtures-junior-week.json`). | Keep every constant (DAY_SCHEDULE, MEALS, …) exactly as it is, as a seed. Add a *fidelity* test from seeded data to the same fixture (§9.4). |
| **The offline story exists only for `state`.** `_syncBase`, `firstSnapshotMerge`, `pendingWrites`. Config has no baseline, no first-pull gate and no accounting (app.js:2293-2358). | Build the same three properties for `config` (S1) and for `setup` (S2). Nothing new may be "online-only" without saying so in the UI. |
| **Deploy = push to `main`.** Every asset is `?v=`-bumped (12 today), along with `APP_VERSION` and `CODE_UPDATED_AT`. `CHANGES` must stay empty. | New script files join the `?v=` list. Every stage follows CLAUDE.md's deploy checklist, plus the live `curl` checks. |

---

## 3. Migration principles (every stage obeys all of these)

- **M1 New data, new node.** No new *data* keys in `config`, no new SYNC_KEYS. The one
  non-data key is the optional fence marker `config/mark` (R2, written from S2, required
  only in S8). It carries no information, so an old build's `set()` pruning it costs
  nothing, and the next new-build commit writes it back. The only additions to existing
  nodes are: optional fields on game objects, `state/meta/epoch` and
  `state/meta/epochAt` (meta accepts any field, and old clients copy `meta` wholesale and
  diff it per field, so they carry it untouched), per-field writes to `state/teams/<i>/<field>`,
  and a new bracket `kind`.
- **M2 Never reshape in place.** Arrays stay arrays and records keep their fields. A new
  meaning gets a new field, never a reinterpreted old one.
- **M3 Rules: additive, then code, then fence.** Within a stage, the R-step (rules PUT)
  precedes the C-step (code push). Fences (rules that refuse old builds) only come in S8,
  after presence `v` shows that no older build has been seen for 7 days.
- **M4 Seed and fallback.** Accessors return `synced ?? seed`. Seeding is an explicit,
  idempotent, deterministic editor action per camp. The camps.js constants are never
  deleted.
- **M5 Every new listener degrades only itself.** It copies `chatDenied`: a denied or failed
  listener sets a feature-local flag and shows a feature-local message. It never touches
  `fbRef`, `fbConfigRef` or `syncDenied`.
- **M6 Deploy is not activation.** A deploy changes behaviour only for bug fixes. New
  behaviour waits for A1, A2 or A3, and each has an undo path.
- **M7 Offline-honest writes.** A write path either has a persisted baseline and a
  three-way merge (state, config, setup), or it is explicitly online-only, with the UI
  saying so at the point of action (campers, photos, restore points, access requests).
- **M8 Fleet visibility.** From S2 on, presence rows carry `v: APP_VERSION`. Anything that
  would crash or clobber on an older build checks the fleet first: the 4-team bracket
  Start button, the wizard, and the S8 fences.
- **M9 Camp-week freeze.** Stages marked **off-season** must not deploy within ±2 days of
  a camp week. A1 and A3 refuse to run during a camp week, unless the editor ticks
  "I know a camp week is running" (the hub shows why). Before `weekStart` exists, the
  known dates come from decision D1.
- **M10 Pin first.** Each stage's commit adds tests that pin current behaviour *before* it
  changes the code those tests guard. The settings.js CRUD paths have no tests today.
- **M11 Handlers resolve by id at commit time.** No setup-screen handler closes over a
  synced object. It looks the object up by id when it commits. Remote applies replace
  objects (`applyRemoteConfig` does `state.config = remote`), and a handler holding the
  old object would write into a detached copy and lose the edit silently. This is the
  same lesson as CLAUDE.md's "an identical snapshot keeps the live objects".

---

## 4. Data model (both camps; `<root>` = `campScoreboard` or `seniorScoreboard`)

### 4.1 Where everything lives

| Data | Path | Read | Write | Why here |
|---|---|---|---|---|
| Games catalog, competition-day tabs, sessions | `<root>/config` (**unchanged shape**) plus optional `blockId` and `ord` per game | member | editor | Old builds, the TV page and backups read it. S1 makes it merge-safe in place. |
| Team names and counselor fallback text | `<root>/state/teams` (**unchanged shape**: `[{id,name,counselor}]`). New clients write per field. | member | editor | Read by the Worker, the TV page and old builds. |
| Team branding (short name, emoji, colour, photo version) | `<root>/setup/teams/<tid>` | member | editor | New. Merges per field. |
| Team photo bytes | `<root>/teamPhotos/<tid>` | member | editor | Big. Never listened to. Fetched once per version. |
| Week meta: weekStart, double-points window, finale day, pause switch, seed stamp | `<root>/setup/meta` | member | editor | New. |
| Day meta, typical-day template, per-day blocks | `<root>/setup/days`, `setup/template`, `setup/blocks` | member | editor | New. Merges per field per block. |
| Meals, cleanup rota, verses and theme, electives | `<root>/setup/meals`, `cleanup`, `verses`, `electives` | member | editor | New. Staff names only, no campers. |
| New-year epoch | `<root>/state/meta/epoch`, `state/meta/epochAt` | member | editor | Rides `_syncBase`, so a stale phone can tell. |
| 4-team bracket | `<root>/state/brackets/<gid>` with `kind:'four'` | member | editor | Rules accept any branch here. |
| Camper first names | `<root>/campers/<tid>/<cid>` | **editor** | editor | Minors' PII. Its own top-level node, because `.read` cascades. |
| Restore points and year archives | `<root>/restoreIndex/<rid>` (small), `<root>/restoreBody/<rid>` (one JSON string) | editor | editor create/delete (+pin) | No listeners, so they cost nothing until opened. |
| Walk-up requests | `<root>/accessRequests/<identityKey>` | editor (+ self) | self create (throttled), editor delete | First non-member-writable node. Tightly capped. |
| "Who is where" and the build number | `<root>/presence/<memberKey>/<deviceId>/{where,v}` | member | own identity | Optional fields only. |
| Published schedule for the Worker | `<root>/pushSchedule` plus optional `rev`, `src` | member | editor | Additive now; fenced in S8. |
| Worker's last-seen schedule | `pushServer/schedSeen/<campId>` | Worker only | Worker | Root deny-all already covers it. |

No new data key is written at the top of `config` (its only new key is the optional fence
marker `mark`), and no new key under `state`.

### 4.2 `<root>/setup`: shapes

Day keys are **`sun mon tue wed thu fri sat`**, never `0..6`. A map keyed `0..n` comes back from
RTDB as an array. `dowOfDayKey` and `dayKeyOfDow` convert between the two.

```js
setup = {
  meta: {
    schema: 1,                 // readers refuse (fall back + hub ⚠️) when schema > what they know
    seededAt: 1761520000000,   // ServerValue.TIMESTAMP — PRESENCE OF THIS = "camp is seeded"
    seededFrom: 'camps.js@v190',
    seededBy: 'jenn,x@gmail,com',
    paused: true,              // optional kill switch → every accessor falls back to camps.js
    weekStart: '2027-07-18',   // the Sunday (single source of truth from S3)
    year: 2027,
    double: { sd: 4, sm: 1020, ed: 6, em: 0 },  // verse/custom bonus 2× window, RELATIVE to weekStart
                                                // (dow + minutes, camp time). Absent = no window.
    finaleDow: 5               // TV champion finale day (default 5 = Fri)
  },
  days: {                      // one record per day key; ALWAYS present after seeding
    sun: { kind: 'arrival', tag: 'Arrival day' },
    mon: { kind: 'regular', tag: 'Competition day 1', tpl: 'typical' },
    // … tue–fri …
    sat: { kind: 'sendoff', tag: 'Send-off' }
  },                           // kind ∈ arrival | regular | sendoff | off
  template: {                  // THE typical day (G4). Same block shape, ids 't-…'
    't-01': { start: 480, end: 510, label: 'Breakfast', emoji: '🍳', type: 'activity', meal: 'breakfast', key: 'breakfast', ord: 1 }
  },
  blocks: {                    // the materialized week — what every reader reads
    mon: {
      's-mon-01': { start: 480, end: 510, label: 'Breakfast', emoji: '🍳', type: 'activity',
                    meal: 'breakfast', key: 'breakfast', ord: 1, tpl: 't-01' },
      's-mon-05': { start: 600, end: 705, label: 'Team competitions', emoji: '🏅', type: 'games',
                    key: 'team-competitions', ord: 5, tpl: 't-05' }
    }
  },
  meals:   { mon: { breakfast: { dish: 'Eggs and Bacon', emoji: '🥓' } } },
  cleanup: { mon: { breakfast: { t5: true } }, fri: { breakfast: { t3: true, t4: true } } },
  verses:  { theme: { title, text, ref }, days: { mon: { text, ref, video? } } },
  electives: {
    stations: { 'st-swimming': { name: 'Swimming', emoji: '🏊' } },
    slots: { mon: { s0: { 'r-01': { st: 'st-swimming', ord: 1, who: { bria: 'Bria', abby: 'Abby' } } } } }
  },
  teams: {
    t0: { short: 'Foxes', emoji: '🦊', accent: '#e2672b', color: 'ember', photoV: 3, crest: 'photo' }
  }
}
```

**Block fields.**

| Field | Type / limit | Meaning |
|---|---|---|
| `start`, `end` | minutes since midnight, camp time; `0 ≤ start < end ≤ 1440` | Same as today. |
| `label` (1–120) | string | Same as today. |
| `emoji` (≤16) | string | Same as today. |
| `type` | `activity`, `games` or `elective` | Same as today. **Kept as `type`**, so the accessor output is the exact constant shape. `games` only means "the Happening Now banner yields to the scoreboard". It does not limit where games can attach (§9.3). |
| `slot` | 0–2 | Elective slot. Same as today. |
| `noTime` | bool | Same as today. |
| `meal` | `breakfast`, `lunch` or `supper` | **New.** An explicit tag that replaces label sniffing (`mealInfo`, `blockMealName`, app.js:539-561). |
| `key` (≤48) | `[a-z0-9-]` | **New, stored.** The phone-alert subscription key. Seeded as `pushBlockKey(label)`, which is exactly today's computed key, so no phone loses a subscription. It is **never recomputed on rename**. |
| `ord` | number | **New.** The tie-breaker for blocks with the same `start`. Sort order is `(start, ord, id)`. This reproduces today's array order exactly: verified, every day in both camps is sorted by `start`, and the only tie is Tue/Thu movie night vs "Prepare for bed" at 21:15, which `ord` preserves. |
| `tpl` | template block id | **New.** Links a day's block to its typical-day origin, for "every day like it" (§10.4). |

**Ids.** Seeded blocks are deterministic, `s-<dk>-<nn>` (nn = 1-based index in the camps.js
array). Seeded template blocks are `t-<nn>`. Blocks created by an editor are
`b-<base36 time><4 random>`. All of them match `^[a-z0-9-]{1,40}$`, which is the existing
`pushSchedule/blocks/$blockId` pattern. Stations are `st-<slug>`, elective rows `r-<nn>` or
`r-<rand>`, and people inside `who` are `<slug>` (with `-2`, `-3` suffixes for duplicate
first names).

**Accessor output.** `scheduleForDow(dow)` returns the canonical array
`[{start,end,label,emoji,type,[slot],[noTime]}]`, sorted by `(start, ord, id)`, with extra
properties `id`, `meal`, `key`, `tpl` attached. The fidelity test strips those four and
deep-equals the result against `DAY_SCHEDULE[dow]`.

### 4.3 `config` additions (optional, ignored by old builds)
- `game.blockId`: a `setup/blocks/<dk>/<bid>` id. **Resolution rule:** the link is honoured
  only if that block exists *and* its day's dow equals the dow of `game.dayId`. Otherwise
  the game is treated as **unattached on its day**, and the hub shows ⚠️. An old builder
  that changes a game's Day select leaves `blockId` behind, and this rule makes that
  harmless.
- `game.ord`: order inside a block. Ties fall back to the array index.
- `dayId` and `session` stay **authoritative for old builds**. New code derives both from the
  block whenever a game is attached (§9.3), so an old build always sees a consistent pair.
- `config.days` remains the list of competition-day *tabs* `{id,name,dow,note}`. The hub
  keeps it aligned with `setup/days` and flags mismatches (§10.2). It is never replaced.

### 4.4 `state` additions
- `state.teams`: new clients diff it per `teams/<i>/<field>` when previous and current have
  the same length and the same ids in the same order. Otherwise they fall back to a whole
  write, which is today's behaviour. The fixed counts guarantee the fast path once the
  Teams screen no longer offers add, delete or reorder.
- `state.meta.epoch` (`'e' + base36 ms`) and `state.meta.epochAt` (ISO), written by the
  wizard. **Absent means the legacy epoch `''`.** Today's data is that epoch.
- `state.brackets[gid]` with `kind: 'four'` (§10.6). A record without `kind` is the 6-team
  shape.
- `state.results[gid].path` (optional): the finished bracket's match record, so a cleared
  result can be explained and restored. Old builds ignore it.

### 4.5 The other new nodes
```js
teamPhotos/<tid>      = { v: 3, data: 'data:image/jpeg;base64,…' }        // ≤ 80,000 chars (~58 KB)
campers/<tid>/<cid>   = { name: 'Ava', absent?: true }                     // cid 'c-<rand>'
restoreIndex/<rid>    = { at, byKey, kind, label, bytes, epoch?, pinned? } // rid 'rp-<base36>-<rand>'
restoreBody/<rid>     = '<JSON string of the snapshot, ≤ 900,000 chars>'
accessRequests/<key>  = { name, at, teamId?, note? }                       // key = requester's identityKey
presence/<k>/<d>      = { at, where?: 'setup:schedule/tue', v?: 190 }
pushSchedule          = { weekStart, at, by, blocks, rev?: 12, src?: '<hash of the setup schedule>' }
```

### 4.6 Sizes and bandwidth (Spark: 1 GB stored, 10 GB/month downloaded)
- `setup`: junior ≈ 13 KB blocks + 6 KB template + 5 KB meals/verses/rota/electives + 1 KB teams
  ≈ **25 KB**. Senior ≈ 15 KB. It is downloaded once per page load: 40 devices × 15 loads/day
  × 25 KB ≈ 15 MB/day. Per-field edits send only the changed paths to listeners.
- `config`: still about 17 KB. After S1 every config commit is a transaction, which writes the
  whole node, so each edit fans about 17 KB to each listener. At 40 devices × 300 edits in a
  setup weekend that is about 200 MB, or 2% of the month. That is acceptable, and it is the
  price of not moving games (§5.2).
- Restore points: about 60 KB each. 30 kept per camp plus pinned archives comes to about
  2–4 MB stored. Nothing listens to them.
- Team photos: at most 6 × 58 KB per camp. Fetched only when `photoV` changes, then cached in
  IndexedDB.
- Presence `where`: written only on screen transitions, by editors inside setup. A few hundred
  writes a day × 40 listeners × about 150 B is negligible. **No heartbeats.**
- localStorage blob (`STORAGE_KEY`): today about 42 KB. Adding `setup`, `_setupBase` and
  `_cfgBase` brings it to about 110 KB, far under quota. Photos never go in it.

### 4.7 Healing what RTDB prunes (`normalizeSetup`, called after every load and remote apply)
- `meta`, `days`, `template`, `blocks`, `meals`, `cleanup`, `verses`, `verses.days`,
  `electives.stations`, `electives.slots` and `teams` are each healed to `{}` when missing.
- **"Seeded" is decided only by `meta.seededAt`.** That number can never be pruned. Before it
  exists, every accessor returns the camps.js seed. After it exists, **absence means
  empty**: an empty day has no blocks, a meal with no dish shows its plain label, an empty
  rota slot is "TBA". The one exception is a field whose empty value is invalid: team
  `emoji`, `short` and colour, and the verse theme title. Those fall back *per field* to the
  camp default. This stops a deleted dish or verse from resurrecting last year's seed.
- **Partial records are dropped.** RTDB does not evaluate ancestor `.validate`, so a
  per-field write into a deleted block can create `{label}` alone. The normalizer hides
  any block missing `start`, `end`, `type` or `label`, or with `end <= start`. The engine
  then deletes it on the next push (§5.3.5).
- A `days.<dk>` record missing after seeding is healed to `{kind:'off', tag:''}`. The hub
  shows ⚠️.
- Unknown `type`, `meal` or `kind` values are treated as `activity`, none and `regular`
  respectively.

---

## 5. Sync engines, multi-editor behaviour, offline behaviour

### 5.1 The `state` engine: only three deliberate changes
Every CLAUDE.md invariant stays as it is: never push before the first pull; the three-way
first-snapshot merge against a persisted `_syncBase`; identity-preserving echo; per-path
diffs; the `editorMidEntry` allowlist; deferred snapshots re-read on idle; `reloadBlocked`.
The tests that pin them (`sync*.test.js`, about 1,200 lines) stay green **untouched**,
except where a change below is deliberate. The three changes:

1. **Teams per field (S1).** `SYNC_SINGLETONS` becomes `['notice']`. A teams block in
   `computeSyncUpdates` emits `teams/<i>/<field>` when previous and current have the same
   ids in the same order, and a whole `teams` write otherwise. `sync.test.js:344`
   ("teams are written whole") is changed on purpose and gains a both-shapes case.
   `firstSnapshotMerge` needs nothing extra, because `syncPathsOverlap` already handles
   the deeper paths.
2. **Epoch check (S6).** In `firstSnapshotMerge`, if the epoch in the baseline differs from
   the server's (`(bootSyncedTree.meta||{}).epoch||''` vs `remote.meta.epoch||''`), none of
   this phone's paths are kept. They are written to `lsKey('campScoreboardStranded')`
   instead, and the toast says "This phone had N changes from last camp week that never
   synced. They weren't added to this week. [Download them]". The same check runs in the
   config and setup engines. Old builds already have the 36 h `confirm()` (app.js:2564),
   and camp years are 12 months apart, so they always ask.
3. **Visible push failures (S1).** After 3 consecutive failed `pushState` batches, the sync
   indicator shows "⚠️ Some changes aren't saving — tap for details". The details list the
   refused paths from the last error. The retry logic is untouched. This turns the
   "poison path" from silent into visible, without editing the engine's control flow.

### 5.2 Config engine v2 (Stage 1): scoring#3 fixed on the existing node
**Why not move games to a new node?** Old builds `set()` the 5-key node and read games as an
array. Moving games would need a mirror back into `config` for old builds and the TV page,
plus a fence to stop stale old builds overwriting the mirror. That is three moving parts in
the most-read data in the app. A transactional per-field merge on the same node removes the
stale-copy clobber for every new build, with **no schema change and no rules change**. Its
only cost is about 17 KB fan-out per commit (§4.6). The id-keyed diff machinery it needs is
reused by the setup engine.

**5.2.1 Canonical id-space** (used for diff and merge only, never stored):
```js
cfgCanon(c) = syncCanon({ version: c.version, sessions: c.sessions,
                          days:  keyById(c.days),   // {d1: {...day, _o: 0}, ...}
                          games: keyById(c.games) }) // {gid: {...game, _o: i}}
cfgFromCanon(t, updatedAt) // → {version, updatedAt, sessions, days:[…sorted by (_o,id), _o stripped], games:[…]}
```
The diff depth: `version`, whole; `sessions`, whole; `days/<id>/<field>`;
`games/<id>/<field>`. A game field is compared whole (`rules`, `timer` and `liveTracker`
are each one leaf). Adding or deleting a record writes the whole record or `null`. A
reorder is an `_o` change. `updatedAt` is excluded and is stamped at commit.

**5.2.2 Persisted baseline.** `state._cfgBase` (canonical form of the last
server-confirmed config), `state._cfgBaseAt` and `state._cfgBaseEpoch` live in the same
`STORAGE_KEY` blob as `state.config`. One write covers both, so they can never disagree.
This copies the `_syncBase` pattern exactly.

**5.2.3 Writes are transactions, not `set()`.** This replaces `pushConfig`:
```js
const ops = treeDiff(state._cfgBase, cfgCanon(state.config), CFG_DEPTHS);   // my unconfirmed edits
if (!configReady || !Object.keys(ops).length) return;
pendingConfigWrites++;
fbConfigRef.transaction((cur) => {
  const merged = applyOpsSafe(cur ? cfgCanon(cur) : {}, ops, CFG_DEPTHS);   // skips field-ops on records the server no longer has
  return cfgFromCanon(merged, new Date().toISOString());
}, null, true).then(({ committed, snapshot }) => {
  if (committed) writeCfgBase(cfgCanon(snapshot.val()), /*persist*/ true);
  settle();
}, (e) => { settle(); noteConfigFailure(e); });      // ops stay unconfirmed → retried next push
```
- `applyOpsSafe` drops a `games/<id>/<field>` op when `games/<id>` is absent on the
  server (deleted meanwhile). It records the drop so the UI can say "Jenn deleted *Gaga
  Ball* while you were editing it" (fixes B5). A whole-record op re-creates the record
  only when the user chose "Keep my copy".
- `configReady` (new) flips on the first config snapshot. Nothing is pushed before it
  (fixes scoring#3's second half).
- `pendingConfigWrites` joins `reloadBlocked()`, `hasUnsyncedWork()` and
  `hasUnconfirmedLocalWork()` (which also checks `treeDiff(_cfgBase, …)` is non-empty).
  It does **not** join `canAdoptRemote()`, which stays about `state`.
- Offline: the SDK queues the transaction in memory. On reload the persisted
  `_cfgBase` and `state.config` re-derive the same ops, and the first-snapshot merge
  pushes them (5.2.4).

**5.2.4 Receiving config.** This replaces the wholesale `state.config = remote`.
- **First snapshot after load:** a three-way merge. `base = _cfgBase` (or a plain adopt if
  this is the first run of S1), `mine = treeDiff(base, local)` and
  `theirs = treeDiff(base, cfgCanon(remote))`. Keep my paths that don't overlap theirs.
  When the same path changed on both sides, the server wins and a toast says so. The
  merged config is adopted and its `_cfgBase` = the server tree. The kept ops are pushed.
  The epoch mismatch rule (5.1 #2) applies, and so does the same 36 h confirmation.
- **Later snapshots:** **rebase**, never stash. `state.config = cfgFromCanon(applyOpsSafe(cfgCanon(remote), myUnconfirmedOps))`,
  then `_cfgBase = cfgCanon(remote)`. `pendingRemoteConfig` and the "hold config while mid-entry" branch
  (app.js:2724) are removed. Data applies immediately. Only **rendering** is deferred
  while a setup field has focus (§5.8). `migrateState` still runs on the result. The
  existing rule stays: re-push only on a real version change made by an editor
  (app.js:2306). `remoteJustApplied` behaviour is unchanged (remote-config.test.js).
- `applyRemoteConfig` keeps object identity for unchanged games and days. When a record's
  canon JSON is unchanged, the previous object is kept, mirroring the identity-preserving
  echo in `applyRemoteState`.

**5.2.5 Game editor saves only what the editor changed (fixes scoring#3 at the source).**
- `ensureGameDraft` also stores `gameDraftOrigin`, a deep copy of the *saved game* at the
  moment the editor opened.
- `saveGameDraft` computes `fieldOps = treeDiff(origin, out)`, at game depth, and applies
  them to the **current** `state.config` game, which may contain remote changes. It never
  splices in the whole object.
- If the game was deleted meanwhile (`idx === -1`), it shows a Jelly dialog instead of
  silently closing: "Jenn deleted this game while you were editing. **Put it back with
  your changes** / **Discard my changes**".
- Format change (scoring#6, the saveGameDraft half): the confirm lists exactly what will
  go, then deletes `state.results[id]`, `state.brackets[id]` and `state.drafts[id]`,
  calls `clearLiveMatch(g)`, and deletes `state.clocks[id]` and `state.picSetup[id]`.
  `deleteGame` and `pruneOrphanedGameData` also delete `clocks[gid]` (a leak found while
  mapping).

### 5.3 Setup engine (Stage 2): a new file, `setup-sync.js`
It is cloned from the state engine's *design*, not refactored out of it. It reuses only the
pure helpers `syncCanon`, `applySyncPaths`, `syncValueAt` and `syncPathsOverlap`, plus the
new `treeDiff` and `applyOpsSafe` from S1.

**5.3.1 Globals:** `setupRef`, `setupReady`, `setupDenied`, `pendingSetupWrites`,
`setupPushTimer`, `setupRefetchPending`, and the `weekSetup` pointer read by accessors (see
5.3.6). The local tree is `state.setup`. The persisted baseline is `state._setupBase`,
`_setupBaseAt` and `_setupBaseEpoch`, in the same blob as everything else. **At script
load**, setup-sync.js sets `weekSetup` from the cached `state.setup` (when it carries
`seededAt`). A returning device on dead Wi-Fi therefore paints the *edited* week, not the
camps.js seed. A first-ever device paints the seed until its first snapshot, which is the
same as config today.

**5.3.2 Diff depths** (`SETUP_DEPTHS`, where "record" = written whole when created or
deleted, "fields" = per field afterwards):

| Subtree | Record | Field-level? |
|---|---|---|
| `meta/<field>` | — | yes; `double` is one leaf |
| `days/<dk>` | day | yes |
| `template/<bid>`, `blocks/<dk>/<bid>` | block | yes |
| `meals/<dk>/<meal>` | meal | no (small) |
| `cleanup/<dk>/<meal>/<tid>` | leaf `true` | — |
| `verses/theme`, `verses/days/<dk>` | verse | no (small) |
| `electives/stations/<st>` | station | no |
| `electives/slots/<dk>/<slot>/<row>` | row | yes; `who/<slug>` is per person |
| `teams/<tid>` | team | yes |

**5.3.3 Push.** This is `update()` on `dbPath('setup')` with the per-path ops: one atomic
batch per 400 ms window, and an explicit **single batch** for multi-block operations like
a rain shuffle or "copy typical day". It is gated on `setupReady` and counted in
`pendingSetupWrites`. On ack, `_setupBase` advances by exactly the acked paths
(`applySyncPaths`) and is persisted. This is the same pattern as `pushState`.
`pendingSetupWrites`, a queued `setupPushTimer` and a non-empty
`treeDiff(_setupBase, state.setup)` join `reloadBlocked()`, `hasUnsyncedWork()`,
`hasUnconfirmedLocalWork()`, `editorMidEntry()` (timer only) and `flushPendingPush()`,
exactly as the config counterparts do (§5.2.3).

**5.3.4 Receive.** The first snapshot is a three-way merge (same rules as 5.2.4). Later
snapshots: if `pendingSetupWrites === 0`, adopt (rebasing any not-yet-sent local ops).
Otherwise, mark `setupRefetchPending` and let the existing 1 s `idleRetryTick` re-read with
`once('value')`. That tick gains a setup branch. Identity is preserved per record, so
unchanged records keep their objects. An empty node with `seededAt` absent is normal: it
means "not seeded", and accessors use the seed. **The engine never seeds by itself.** A1
does (§9.1).

**5.3.5 Refusals (the poison path, done properly here).** When a batch is rejected:
- If it has ≤ 40 paths, retry each path alone, one after another. Paths that still fail
  are **quarantined**: the local value is reset to the server value, they are dropped
  from the ops, and a toast lists them in plain words ("Couldn't save Tuesday · *Supper*
  label (too long?)").
- If it has more than 40, or every path fails, treat it as "rules not published": set
  `setupDenied` and show the hub banner.
- Before pushing, any field op whose record is absent on the server is dropped and
  reported. This catches a block deleted by someone else, which RTDB would otherwise turn
  into a partial record (§2: ancestor validation isn't evaluated).

**5.3.6 Denied or absent.** A `setupRef` cancel callback sets `setupDenied = true`,
`weekSetup = null` and clears `setupReady`. The camp keeps running on the camps.js seed.
The hub shows "Editable schedule isn't available yet (database rules not updated)". It
never touches `fbRef` or `syncDenied` (M5). It attaches in `initSync` right after the
config listener, so it is post-approval like every other ref.

**5.3.7 Kill switch.** `setup/meta/paused === true` makes `weekSetup` read as unseeded for
every accessor. Editors still see the data in the setup screens, with a banner. One tap
under Week settings, and a second confirm.

### 5.4 Two editors at once: the conflict rules
| Situation | Result |
|---|---|
| Different fields, same record (A renames the block, B changes its time) | Both land. Per-field paths. |
| Same field, both online | The last ack wins. If an incoming change overlaps a path *I* wrote in the last 60 s, I get a toast: "Jenn changed *Supper* time right after you — showing hers. [Undo hers]" (Undo hers writes my value back). |
| Same field, one was offline | First-snapshot merge: the server wins plus a toast. My value stays in my undo stack. |
| A deletes a block or game; B edits a field of it | B's field op is dropped (5.2.3 / 5.3.5). B is told and offered "Put it back with your changes". |
| A shuffles a day (multi-block atomic), B edits one block on that day | Per-field merge. If B touched a time that A's shuffle moved, B's later ack wins for that field. The hub's overlap check flags any resulting overlap with ⚠️. |
| Two editors press A1 (seed) at once | The seed is deterministic and written by one transaction on the whole `setup` node that aborts if `meta.seededAt` already exists (§9.1). The second sees "already set up by Jenn" and writes nothing. |
| Two editors run the wizard | The wizard takes a soft lock `setup/meta/wizardBy` + `wizardAt` (≤ 30 min, editor-written). The second editor sees "Jenn is starting the new year (step 3 of 7)". |

### 5.5 "Jenn is also here" (presence `where` and `v`)
- **Write protocol** (so that under the *old* rules nothing breaks): `registerPresence`
  keeps `set({at: TIMESTAMP})` exactly as today. *Then* a separate
  `update({v: APP_VERSION})`, and on each setup screen change `update({where})`. Under
  old rules the `update` is refused and swallowed, and the row with `at` survives, so the
  "N here" chip is unaffected. That is the reason for two writes instead of one.
- **`where` vocabulary** (`^[a-z0-9:/_-]{0,60}$`): `setup`, `setup:hub`,
  `setup:schedule/tue`, `setup:schedule/typical`, `setup:games/<gid>`, `setup:teams`,
  `setup:people`, `setup:meals`, `setup:verses`, `setup:cleanup`, `setup:electives`,
  `setup:week`, `setup:wizard/<step>`. Leaving setup writes `where: ''`. `onDisconnect`
  removes the row as today.
- **Display.** In the builder header: "👋 Jenn is also here". On a screen with the same
  `where` prefix: "Jenn is also editing Tuesday — changes merge field by field". The name
  is resolved `memberKey → memberDirectory[key].name` and fails closed like
  `chatAuthorName`: with no directory it says "Another director". Rows with this tab's
  `presenceId` are skipped. Other tabs of the same account show as "You (another tab)".
- **Fleet check** `oldestBuildHere(roleFilter)`: the minimum `v` across rows, where a
  missing `v` counts as < S2. It is used by M8 gates.
- **No heartbeat.** Ghost rows are only as stale as the server's socket timeout, which is
  acceptable for a hint.

### 5.6 Bad Wi-Fi: what survives what
| Domain | Edit, then offline, then reload or force-quit | Mechanism |
|---|---|---|
| Scores (`state`) | Survives | Existing `_syncBase` three-way merge. |
| Teams names (`state.teams`) | Survives, now per field | Same, after 5.1 #1. |
| Games and days (`config`) | **Survives (new, S1)** | `_cfgBase` plus the three-way merge. |
| Schedule, meals, verses, rota, electives, branding (`setup`) | **Survives (new, S2/S3)** | `_setupBase` plus the three-way merge. |
| Undo stack | Survives | `lsKey('campScoreboardUndo')`. |
| Camper names | **Online-only.** It survives brief drops (SDK memory queue) but not a reload. | Deliberate: no PII in localStorage. The screen says "Camper names save when you're online". |
| Team photo upload, restore point, access request | Online-only. The button is disabled offline, with the reason. | Large or one-shot writes. |

### 5.7 Two tabs of the same camp (deferred item): a writer lock
- From S1, when a tab boots it requests `navigator.locks.request('camp-writer:' + CAMP.id, {ifAvailable: true}, holdForever)`.
- **The holder is the writer.** A tab that does not get the lock is a **read-only tab**:
  `tabReadOnly = true`, so `saveState`, `saveConfig` and the setup push are skipped. A
  banner says "Camp is open in another tab — this one is view-only. [Use this tab
  instead]". That button re-requests with `{steal: true}`. The previous holder's callback
  promise rejects, it switches to read-only, and it reloads to re-adopt from server and
  storage.
- `canEdit()` is unchanged. Instead a CSS class `html.tab-readonly` hides edit controls the
  same way `view-only` does, so role logic stays single-sourced.
- **Fallback where Web Locks are missing** (old Safari): a `BroadcastChannel('camp-'+id)`
  hello and claim. With neither, today's documented behaviour remains. Installed iOS PWAs
  don't share storage with Safari tabs, so this mostly matters on the director's laptop.
- Viewer tabs also take the lock. It costs nothing, and it stops two viewer tabs racing
  `_syncBase` writes.

### 5.8 Rendering setup screens without fighting remote edits
- The builder must stop rebuilding `view.innerHTML` on every `renderAll` (settings.js:60,
  B11). New screens (in `setup-ui.js`) render **per section container** through
  `setHtmlIfChanged`, which follows the render-stability rule.
- **Focus guard:** before writing a container, if `document.activeElement` is inside it,
  skip it, mark it stale and re-render it on `focusout`. The focused input keeps what the
  person typed. Any other inputs on the screen update live.
- Every editable control carries `data-bind="setup:blocks/tue/b-x/label"` (or
  `config:games/<gid>/name`, or `teams:<i>/name`). One delegated `change` listener per
  screen commits through `bindCommit(bind, value)`, which **resolves by id at commit
  time** (M11). Jelly `change` is blur/Enter, which is today's commit semantics.
- `editorMidEntry()` is unchanged (its allowlist still covers focused fields). Its
  `builderDirty()` clause stays for the game editor. B1 is fixed in S0 so that clause can't
  stick (§12 S0).

---

## 6. Undo, restore points, year archives

### 6.1 Undo: per device, immediate, conflict-aware
- Every setup commit (config, setup, teams) pushes one entry onto the undo stack:
  `{id, at, label, ops: {'<domain>:<path>': {b: before, a: after}}}`. `before` and `after`
  are canonical values taken from the engine's diff at commit time. Labels are plain
  words, for example "Moved Supper to 5:30 on Tue" or "Renamed Foxes".
- **Undo** writes `b` back only for paths whose *current* value still equals `a`. A path
  someone else has since changed is skipped, and the person is told "Jenn changed
  *Supper* after you — left hers alone". Each undo is itself committed through the
  engines (so it syncs, survives offline, and is itself undoable through **Redo**).
- Storage: memory plus `lsKey('campScoreboardUndo')`, capped at 30 entries or 200 KB,
  oldest dropped. It is added to the `clearLocalData` wipe list, and cleared when the
  epoch changes. Camper edits are undoable **in memory only** (M7: no PII in localStorage).
- UI: a toast after each commit, "Saved · Undo" (6 s). The setup header has a persistent
  **Undo ⟲ (label)** button. Scores are *not* in this stack: score entry keeps its
  existing tools ("Undo last match", "Clear result").

### 6.2 Restore points: shared, durable, any editor can restore
- **Body** (`restoreBody/<rid>`, one JSON string so RTDB can't prune or array-coerce it):
  ```js
  { app: 'campScoreboardV3', camp: 'junior', at, epoch, appVersion,
    config, setup, state: { teams, results, brackets, drafts, picRounds, picSetup /*modes only*/,
                            bonuses, live, clocks, announcements, notice, meta } }
  ```
  It **excludes** campers, members, chat, presence, push data and photos (photos are
  referenced only by `teams.*.photoV`). It is about 60 KB.
- **Index** (`restoreIndex/<rid>`): `{at, byKey, kind, label, bytes, epoch, pinned?}`, where
  `kind` ∈ `auto | manual | pre-import | pre-restore | pre-wizard | archive | pre-seed`.
- **Automatic triggers.** The editor's device writes one *before*:
  - A1 (seeding);
  - every wizard step that writes;
  - "Copy typical day to …";
  - deleting a day, a block that has games attached, or a game with a result;
  - import, restore-defaults, and any restore;
  - the first rain-plan action on a day;
  - and the first setup edit after 20 min of setup inactivity on that device.

  These are throttled to one per 5 min per device, except the pre-destructive ones.
- **Retention.** Keep the 30 newest unpinned points per camp. On each create, the creating
  device deletes the oldest beyond 30 (`kind:'archive'` is created pinned). Rules allow
  create, delete and pin only.
- **Restore flow** (Backups screen):
  1. Pick a point. The list reads only `restoreIndex`, with `once`.
  2. A preview is computed locally against the current data: "This will change 12 games,
     40 schedule blocks, 3 teams' names". Checkboxes choose sections: **Schedule & week**,
     **Games**, **Teams**, **Notice**, **Scores** (off by default; on asks a second time).
  3. A `pre-restore` point is written.
  4. Each section is applied **through its engine as a diff** against the current data,
     never a blind `set()`: config via one transaction, setup via one `update()`, state via
     `saveState()`. Other editors' unrelated work in sections not selected is untouched.
     The normalizers run before anything renders (the `tryImport` rule).
  5. A restore whose `epoch` differs from the current one warns: "This is from the 2026
     week".
- **Rules** (§7.3): editor read; editor create/delete only, with `at === now` and
  `byKey ===` the writer's identity; `pinned` is the only updatable field; the body is
  capped at 900,000 chars.

### 6.3 The year archive (wizard step 2)
- It is a pinned restore point with `kind:'archive'` and `label:'2026 week (junior)'`. It is
  **verified by read-back**, `once()` on both index and body with a length check, before the
  wizard can clear anything. The wizard also offers a JSON download of the same body (this
  is today's backup, with camp id and setup added).
- Campers are not archived by default (decision D6). Chat is not archived (decision D15).
  The changelog is append-only and stays. The history drawer filters to
  `at >= state.meta.epochAt`, with a "Show earlier years" toggle.

### 6.4 Backups (Data screen), fixing B9 on the way
`backupJSON()` becomes v3. It is the restore-point body plus `exportedAt`, and it
**includes** `camp`, `setup`, `notice`, `meta` and `clocks`, which were missing before.
`tryImport`:
- refuses a backup whose `camp` differs from the active camp, unless the editor ticks
  "copy from the other camp" (only Schedule, Games and Teams are then allowed);
- accepts v2 backups as today;
- shape-checks `teams` (fixed count, ids `t0..tN`);
- restores `announcements`, which the old import dropped;
- writes a `pre-import` restore point first;
- applies through the engines exactly like a restore.

---

## 7. Security rules

### 7.1 Macros used below
These are the expressions already in the file. The rules JSON stays literal and
hand-maintained; expand the macros by copying the existing strings with the camp's own root.

- `MEMBER(R)` is today's `state/.read` expression.
- `EDITOR(R)` is today's `state/.write` expression.
- `SELF($k)` is today's `presence/$memberKey/.write` identity clause.
- `MYKEY` is today's changelog `byKey` comparison.
- `DK` is `/^(sun|mon|tue|wed|thu|fri|sat)$/`.
- `ID40` is `/^[a-z0-9-]{1,40}$/`.

### 7.2 New and changed blocks (junior shown; the senior block is identical with `seniorScoreboard`)

```jsonc
"setup": {
  ".read": "MEMBER(R)", ".write": "EDITOR(R)",
  "meta": {
    "schema":     { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 99" },
    "seededAt":   { ".validate": "newData.isNumber() && newData.val() <= now" },
    "seededFrom": { ".validate": "newData.isString() && newData.val().length <= 60" },
    "seededBy":   { ".validate": "newData.isString() && newData.val().length <= 200" },
    "paused":     { ".validate": "newData.isBoolean()" },
    "weekStart":  { ".validate": "newData.isString() && newData.val().matches(/^20[0-9]{2}-[0-1][0-9]-[0-3][0-9]$/)" },
    "year":       { ".validate": "newData.isNumber() && newData.val() >= 2026 && newData.val() <= 2100" },
    "finaleDow":  { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 6" },
    "wizardBy":   { ".validate": "newData.isString() && newData.val().length <= 200" },
    "wizardAt":   { ".validate": "newData.isNumber() && newData.val() <= now" },
    "double": {
      ".validate": "newData.hasChildren(['sd','sm','ed','em'])",
      "sd": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 7" },
      "sm": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 1440" },
      "ed": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 7" },
      "em": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 1440" },
      "$other": { ".validate": false }
    },
    "$other": { ".validate": false }
  },
  "days": { "$dk": { ".validate": "$dk.matches(DK)",
    "kind": { ".validate": "newData.val() === 'arrival' || newData.val() === 'regular' || newData.val() === 'sendoff' || newData.val() === 'off'" },
    "tag":  { ".validate": "newData.isString() && newData.val().length <= 60" },
    "tpl":  { ".validate": "newData.isString() && newData.val().matches(ID40)" },
    "okOverlaps": { ".validate": "newData.isString() && newData.val().length <= 400" },
    "$other": { ".validate": false } } },
  "template": { "$bid": BLOCK },
  "blocks":   { "$dk": { ".validate": "$dk.matches(DK)", "$bid": BLOCK } },
  "meals": { "$dk": { ".validate": "$dk.matches(DK)", "$meal": {
    ".validate": "$meal.matches(/^(breakfast|lunch|supper)$/) && newData.hasChildren(['dish'])",
    "dish":  { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 80" },
    "emoji": { ".validate": "newData.isString() && newData.val().length <= 16" },
    "$other": { ".validate": false } } } },
  "cleanup": { "$dk": { ".validate": "$dk.matches(DK)", "$meal": { ".validate": "$meal.matches(/^(breakfast|lunch|supper)$/)",
    "$tid": { ".validate": "$tid.matches(/^t[0-9]$/) && newData.val() === true" } } } },
  "verses": {
    "theme": { "title": STR(80), "text": STR(600), "ref": STR(60), "$other": { ".validate": false } },
    "days": { "$dk": { ".validate": "$dk.matches(DK) && newData.hasChildren(['text'])",
      "text": STR(600), "ref": STR(60),
      "video": { ".validate": "newData.isString() && newData.val().length <= 200 && newData.val().matches(/^https:\\/\\//)" },
      "$other": { ".validate": false } } },
    "$other": { ".validate": false } },
  "electives": {
    "stations": { "$st": { ".validate": "$st.matches(/^st-[a-z0-9-]{1,36}$/) && newData.hasChildren(['name'])",
      "name": STR(60), "emoji": STR(16), "$other": { ".validate": false } } },
    "slots": { "$dk": { ".validate": "$dk.matches(DK)", "$slot": { ".validate": "$slot.matches(/^s[0-2]$/)",
      "$row": { ".validate": "$row.matches(/^r-[a-z0-9-]{1,36}$/) && newData.hasChildren(['st'])",
        "st":  { ".validate": "newData.isString() && newData.val().matches(/^st-[a-z0-9-]{1,36}$/)" },
        "ord": { ".validate": "newData.isNumber()" },
        "who": { "$p": { ".validate": "$p.matches(ID40) && newData.isString() && newData.val().length <= 40" } },
        "$other": { ".validate": false } } } } },
    "$other": { ".validate": false } },
  "teams": { "$tid": { ".validate": "$tid.matches(/^t[0-9]$/)",
    "short":  { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 24" },
    "emoji":  { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 16" },
    "color":  { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9-]{1,24}$/)" },
    "accent": { ".validate": "newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)" },
    "photoV": { ".validate": "newData.isNumber() && newData.val() >= 0" },
    "crest":  { ".validate": "newData.val() === 'repo' || newData.val() === 'photo' || newData.val() === 'none'" },
    "$other": { ".validate": false } } },
  "$other": { ".validate": false }
}
// BLOCK =
{ ".validate": "$bid.matches(ID40) && newData.hasChildren(['start','end','label','type']) && newData.child('end').val() > newData.child('start').val()",
  "start": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 1439" },
  "end":   { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 1440" },
  "label": { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 120" },
  "emoji": { ".validate": "newData.isString() && newData.val().length <= 16" },
  "type":  { ".validate": "newData.val() === 'activity' || newData.val() === 'games' || newData.val() === 'elective'" },
  "slot":  { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 2" },
  "noTime":{ ".validate": "newData.isBoolean()" },
  "meal":  { ".validate": "newData.val() === 'breakfast' || newData.val() === 'lunch' || newData.val() === 'supper'" },
  "key":   { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9-]{1,48}$/)" },
  "ord":   { ".validate": "newData.isNumber()" },
  "tpl":   { ".validate": "newData.isString() && newData.val().matches(ID40)" },
  "$other":{ ".validate": false } }
// STR(n) = { ".validate": "newData.isString() && newData.val().length <= n" }

"teamPhotos": { ".read": "MEMBER(R)", ".write": "EDITOR(R)",
  "$tid": { ".validate": "$tid.matches(/^t[0-9]$/) && newData.hasChildren(['v','data'])",
    "v":    { ".validate": "newData.isNumber() && newData.val() >= 0" },
    "data": { ".validate": "newData.isString() && newData.val().length <= 80000 && newData.val().beginsWith('data:image/jpeg;base64,')" },
    "$other": { ".validate": false } } },

"campers": { ".read": "EDITOR(R)", ".write": "EDITOR(R)",
  "$tid": { ".validate": "$tid.matches(/^t[0-9]$/)",
    "$cid": { ".validate": "$cid.matches(/^c-[a-z0-9]{3,24}$/) && newData.hasChildren(['name'])",
      "name":   { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 40" },
      "absent": { ".validate": "newData.isBoolean()" },
      "$other": { ".validate": false } } } },

"restoreIndex": { ".read": "EDITOR(R)",
  "$rid": { ".write": "EDITOR(R) && (!data.exists() || !newData.exists())",
    ".validate": "$rid.matches(/^rp-[a-z0-9-]{4,40}$/) && newData.hasChildren(['at','byKey','kind','label','bytes'])",
    "at":    { ".validate": "newData.isNumber() && newData.val() === now" },
    "byKey": { ".validate": "MYKEY(newData.val())" },
    "kind":  { ".validate": "newData.isString() && newData.val().matches(/^(auto|manual|pre-import|pre-restore|pre-wizard|pre-seed|archive)$/)" },
    "label": { ".validate": "newData.isString() && newData.val().length <= 120" },
    "bytes": { ".validate": "newData.isNumber() && newData.val() <= 900000" },
    "epoch": { ".validate": "newData.isString() && newData.val().length <= 40" },
    "pinned":{ ".write": "EDITOR(R)", ".validate": "newData.isBoolean()" },
    "$other": { ".validate": false } } },
"restoreBody": { ".read": "EDITOR(R)",
  "$rid": { ".write": "EDITOR(R) && (!data.exists() || !newData.exists())",
    ".validate": "$rid.matches(/^rp-[a-z0-9-]{4,40}$/) && newData.isString() && newData.val().length <= 900000" } },

"accessRequests": { ".read": "EDITOR(R)",
  "$key": {
    ".read": "SELF($key)",
    ".write": "(SELF($key) && newData.exists() && (!data.exists() || data.child('at').val() < now - 60000)) || (EDITOR(R) && !newData.exists()) || (SELF($key) && !newData.exists())",
    ".validate": "($key.contains('@') || $key.beginsWith('+')) && newData.hasChildren(['name','at'])",
    "name":   { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 60" },
    "teamId": { ".validate": "newData.isString() && newData.val().matches(/^t[0-9]$/)" },
    "note":   { ".validate": "newData.isString() && newData.val().length <= 200" },
    "at":     { ".validate": "newData.isNumber() && newData.val() === now" },
    "$other": { ".validate": false } } }
```
`SELF($key)` already requires `email_verified` for email identities and allows phone
identities, which is the same expression as presence.

**Changed blocks (additive):**
```jsonc
// presence/$memberKey/$deviceId — add two OPTIONAL children:
"where": { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9:\\/_-]{0,60}$/)" },
"v":     { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() < 100000" },
// pushSchedule — add two OPTIONAL children (S3); S8 FENCE makes rev required + increasing:
"rev": { ".validate": "newData.isNumber() && newData.val() >= 0" },
"src": { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9-]{0,64}$/)" },
// S8 fence, pushSchedule/.validate becomes:
//   "newData.hasChildren(['weekStart','at','by','blocks','rev']) && (!data.child('rev').exists() || newData.child('rev').val() > data.child('rev').val())"
// config — add one OPTIONAL child in R2 (fence marker, no data):
"mark": { ".validate": "newData.isNumber() && newData.val() >= 2" },
// optional S8 config fence, config/.validate becomes: "newData.hasChild('mark')"
```
`tests/rules.test.js:311-325` ("config type-pins", which use `CONFIG_KEYS`) follows
automatically once `CONFIG_KEYS` gains `mark` in S2.

**Not changed:** `state`, `members`, `changelog`, `chat*`, `push`, `pushAlerts`. `config`
changes only by the optional `mark` above.
rules#5 is fixed in the client (§13), and the owner key stays rules-immutable.

### 7.3 Publish order (one PUT per R-step; back up first with GET)
| Step | Stage | Adds | Old builds under it | New build under the *old* rules |
|---|---|---|---|---|
| **R2** | S2 (before code) | `setup`, `restoreIndex`, `restoreBody`; presence `where`/`v`; optional `config/mark` | Never touch these nodes. Presence `{at}` still valid. | `setup` listener denied, so `setupDenied` and the seed is used. Restore buttons show "not available yet". Presence `update({v})` is refused and swallowed; the `at` row survives. |
| **R3** | S3 (before code) | `pushSchedule` optional `rev` and `src` | Never write pushSchedule (push dormant, §2) or write it without the new fields: still valid. | The publish is refused. The editor sees "phone-alert schedule not updated", and the camp itself is unaffected. |
| **R5** | S5 (before code) | `teamPhotos`, `campers`, `accessRequests` | Never touch them. | Photo upload, campers and requests are each disabled with "not available yet". |
| **R8** | S8 (after the fleet check) | **Fences:** `pushSchedule` requires an increasing `rev`. Optional: `config` requires a new `mark` key (§12 S8). | **Refused, on purpose.** | n/a (this build writes `rev`). |

Each publish follows the CLAUDE.md procedure: GET a backup, PUT, GET it back and compare
byte for byte with the repo file, then run the probes in §7.5. The repo file and the
console change in the **same commit**.

### 7.4 Compatibility proofs: emulator suites (opt-in, `tests/emulator/`)
Each is written in the `fallback.mjs` style: run the same scenario against
`old.rules.json` (the currently published file) and `database.rules.json`, then print
SAFE or UNSAFE.

- `setup-compat.mjs`:
  - (a) an S1 client's write set (state per-field teams, config transaction) passes **both**
    rule files;
  - (b) a setup per-path update is refused under the old rules and accepted under the new;
  - (c) a viewer cannot write `setup`;
  - (d) a partial block write `setup/blocks/tue/x/label` with no record. The expected
    result is **accepted** (the ancestor-validate hole the client must guard against), and
    the test records the actual behaviour either way.
- `restore.mjs`: create, delete and pin are allowed. Editing a label is refused. A viewer
  can't read. `byKey` spoofing is refused.
- `campers.mjs`: a viewer's read of `campers` is refused, at the root and per team. An
  editor's per-field write is OK. Unknown children are refused.
- `access-requests.mjs`:
  - a signed-in non-member can create their own row, but not another's;
  - a second write within 60 s is refused;
  - an editor can read and delete;
  - another non-member can't read the row;
  - an unverified email is refused.
- `presence-compat.mjs`: the old `{at}` row is valid under both rule files. `{where,v}` is
  refused under old and accepted under new, and the `at` row survives the refusal.
- `pushschedule-fence.mjs` (S8): a whole set without `rev` is refused. A lower `rev` is
  refused. A higher `rev` is accepted.

### 7.5 Unauthenticated probes to add to the runbook (all must return `Permission denied`, for both roots)
`setup.json`, `setup/meta.json`, `teamPhotos.json`, `campers.json`, `campers/t0.json`,
`restoreIndex.json`, `restoreBody.json`, `accessRequests.json`, and a PUT probe to
`accessRequests/x@y,com.json`. That makes 9 per root.

### 7.6 `tests/rules.test.js` changes (deliberate, one per R-step)
- The expected gated-path list (lines 37-44) gains the new nodes.
- The `$other:false` seal list covers every new named record.
- New tests:
  - `campers` and `restore*` have editor-only `.read`, at the node and with no member grant below;
  - image fields in `teamPhotos` are pinned to `data:image/jpeg`;
  - the `teamId`/`$tid` patterns agree with `isTeamId`, `PUSH_TEAM_RE` and the Worker's `TEAM_RE`;
  - `accessRequests` write requires `SELF`;
  - the junior and senior blocks are identical modulo root, which is already tested and
    now also covers the new nodes.
- The "unused PII paths" test (164-176) stays for `roster`/`contacts`. A new sibling test
  asserts that `campers` is editor-read and that **no** other node's name contains
  `camper`.

---

## 8. Accessor layer (Stage 0) and every consumer

### 8.1 Rules of the layer
- The accessors live in **app.js** as top-level functions declared next to today's aliases.
  app.js boots on `DOMContentLoaded` (app.js:8735), so later scripts can fill in
  `weekSetup` before any render runs. That variable is set by setup-sync.js from S2 and
  is `null` until then.
- **Before seeding, an accessor returns the camps.js constant itself, the same object
  reference** (`DAY_SCHEDULE[dow]`, `MEALS[dow]`, …). That is how S0 is provably a no-op.
  After seeding, it returns data derived from `weekSetup`, in the *same shape*, so the
  helper logic downstream doesn't change.
- **Sanitising happens inside the accessors** (G5, G7), because about 60 call sites
  interpolate `teamEmoji()` raw and three inject `TEAM_ACCENT` raw into `style=`.
  - Emoji: a string of at most 16 UTF-16 units, with `<>&"'` removed; otherwise the default.
  - Colours: `#rrggbb` only.
  - Image sources: the `chatSafeImageSrc` rule (`data:image/` only, or a repo path from the seed).
  - Verse video: `https://` only, otherwise dropped.
- Small block helpers keep consumers identical before and after seeding:
  - `blockMeal(b) = b.meal ?? legacyMealOf(b.label)`, where `legacyMealOf` is today's
    label rule from app.js:539-561, moved into one place;
  - `blockKey(b) = b.key ?? pushBlockKey(b.label)`;
  - `blockId(b, dow, i) = b.id ?? 'd'+dow+'-'+b.start+'-'+i`, which is today's push id.

### 8.2 Accessors and the consumers that switch to them
| Accessor | Before seeding | After seeding | Consumers converted (file:line at v183) |
|---|---|---|---|
| `scheduleForDow(dow)` | `DAY_SCHEDULE[dow]` | `setup.blocks[dk]` sorted by (start, ord, id), canonical shape plus id/meal/key/tpl | `nowBannerHtml` app.js:744; schedule sheet 918; `buildDayIcs` 1007; push.js 1079, 1093, 1373, 1701 (via `scheduleWeek()`) |
| `scheduleWeek()` | `{0..6: DAY_SCHEDULE[d]}` | same, from setup | push.js `pushScheduleBlocks` 117-135 |
| `weekDays()` / `dayInfo(dow)` | `SCHED_DAYS` + kind (0 = arrival, 6 = sendoff, else regular) | `setup.days` + fixed names | schedule sheet 896, 917; .ics; hub |
| `dayLabel(dow)` | `DAY_NAMES[dow]` | same names (Sun–Sat full) | app.js 4556, 5055-5062, 5086, 5105, 5140, 5213, 5338 |
| `competitionDows()` | `[1,2,3,4,5]` | dows whose `kind === 'regular'` | verse chips 5054; cleanup 5212, 5177 |
| `mealFor(dow, meal)` | `MEALS[dow][meal]` | `setup.meals[dk][meal]` | `mealInfo` 539-543 → `decorateMealBlock` 547 |
| `mealStartMinutes(meal, dow)` | `MEAL_START_MINUTES` | start of that day's block tagged `meal` (else the constant) | 5168, 5179 |
| `cleanupTeamsFor(dow, meal)` | `MEAL_CLEANUP_SCHEDULE[dow][Meal]` | the keys of `setup.cleanup[dk][meal]`, returned as a string for 1 and an array for 2+ (today's shape) | `cleanupAssigned` 5161, `findNextCleanupFor` 5174, `mealCleanupNote` 566-574 |
| `verseTheme()`, `verseFor(dow)` | `MEMORY_VERSE_THEME`, `MEMORY_VERSES[dow]` | `setup.verses` (video sanitised) | `renderMemoryVerse` 5036-5126 |
| `electivesFor(dow)` | `ELECTIVES[dow]` | rebuilt as `[[stationName,[names]],…]` per slot (row `ord` order) | `electiveDayRoster` 337, `electiveBreakKids` 346, `myStationFor` 356, `myElectivesToday` 370-389, banner 787, sheet 945 |
| `stationEmoji(name)` | `STATION_EMOJI[name]` | station record emoji | 361, 385, 789, 948 |
| `electiveSlotStart(slot, dow)` | `ELECTIVE_SLOT_MIN[slot]` | start of the day's `type:'elective'` block with that `slot` | 383, 501, 503 |
| `doubleWindow()` | `{start: DOUBLE_BONUS_START, end: DOUBLE_BONUS_END}` | **Legacy epoch (no `state.meta.epoch`): still the constants**, so 2026 standings can never shift. New epoch: `meta.double` resolved against `meta.weekStart` in camp time (DST-safe, the same algorithm as the Worker's `etWallToEpoch`); `null` when either is missing | `bonusCountsDouble` 289, `inDoubleBonusWindow` 297, banner copy 4931/5109 (wording generated from the window), settings.js:307 |
| `weekStartDate()` | `null` | `meta.weekStart` | `campDateForDow` 994, .ics, push drawer, Worker publish |
| `finaleDow()` | 5 | `meta.finaleDow` | TV page |
| `teamEmoji(id)` | `TEAM_EMOJI` | `setup.teams[id].emoji`, falling back per field | about 60 sites (unchanged calls) |
| `teamShort(id)` | `TEAM_ABBREV[id]` | `setup.teams[id].short` | chat.js:530 (mention dictionary), the morning-meeting label editor, Worker publish |
| `teamAccentVars(id)` | `--team-accent-l/-d: TEAM_ACCENT[id]` | palette swatch light/dark, or legacy `accent` | follow card 4574-4577; **raw reads** 5783, 6646, 6729 |
| `teamCrestSrc(id)` | `TEAM_SHIELD[id]` | cached photo `data:` > repo crest > null | follow card 4565-4568; TV page |
| `teamCounselorNames(id)` | `TEAM_COUNSELORS[id]` | names of members with that `teamId`, plus the elective `who` names for that team (from S5) | `adoptMemberTeam` 4666-4667, `renderIdentityOptions` 4797, chat.js 507-527 |
| `gamesForBlock(bid)`, `blockForGame(g)`, `gamesForDow(dow)` | the heuristic (app.js:927-936, as today) | the `blockId` link, resolved per §4.3; unattached games listed separately | schedule sheet 927-936; .ics 1010-1016; hub; the game header's session line 5552 (S4) |

Every row gets a parity test in both camps: before seeding, the accessor returns `===` the
constant. After seeding from the same constants, it returns a deep-equal value
(`accessors.test.js`, `accessors.senior.test.js`).

### 8.3 The home-screen seam (flagged for the pending layout redesign)
The layout redesign must read **only** through these functions:
- schedule: `scheduleForDow`, `weekDays`, `dayInfo`, `gamesForBlock`, `gamesForDow`;
- teams: `teamEmoji`, `teamName`, `teamShort`, `teamAccentVars`, `teamCrestSrc`,
  `counselorName`;
- meals, rota and verses: `mealFor`, `cleanupTeamsFor`, `verseFor`, `verseTheme`;
- electives: `electivesFor`, `electiveSlotStart`;
- double points: `doubleWindow`;
- the existing game helpers: `gameStatus`, `liveHomeGames`, `homeBoardGame`,
  `currentMatchupOf`, `nextMatchupOf`, `medalCounts`, `rankTeamsByPoints`.

After S4, no home renderer may read `state.config.games` or `state.config.days` directly.
S4 converts the remaining direct reads at app.js 931-932, 1013-1014, 2985, 3003, 4132,
5359-5362, 5426-5430 and 5633 to `gamesForDow`, `gamesForDay` and `competitionDays()`. The
redesign will add new panels, so this list is the contract to hand to that project.

---

## 9. Seeding and migration from camps.js

### 9.1 A1 "Start using the editable schedule" (per camp, in the hub)
- **Preconditions**, each shown as an explanation when unmet:
  - an editor;
  - `setupReady && !setupDenied`;
  - `meta.seededAt` is absent;
  - this tab holds the writer lock;
  - not inside a camp week (M9), unless the override is ticked;
  - online.
- **Steps:**
  1. Write a `pre-seed` restore point.
  2. Run `setupRef.transaction(cur => (cur && cur.meta && cur.meta.seededAt) ? undefined : mergeSeed(cur, buildSeed(CAMP)))`.
     This is one atomic, idempotent write of about 25 KB. A second presser aborts and
     simply adopts. `mergeSeed` keeps every field already in `cur`; before seeding only
     `meta` (for example `weekStart`) can exist.
  3. If S4 code is present: A2 (§9.3) in the same flow.
  4. Republish `pushSchedule` (if push is live and `weekStart` is set): same keys, new ids
     (§11.3).
  5. The hub turns the Schedule, Meals, Verses, Cleanup, Electives and Week items live.
- `buildSeed(camp)` is **pure and deterministic**. It depends only on camps.js constants,
  plus the APP_VERSION stamp. It never writes `meta.weekStart`: whatever is already
  there (set from Week settings, or migrated from `pushSchedule`) is kept, because the
  transaction merges the seed into the existing `meta`. `seededAt` is
  `ServerValue.TIMESTAMP` and is excluded from the determinism test.
- **Undo:** the Pause switch (`meta.paused = true`) or the `pre-seed` restore point. A
  console delete of `<root>/setup` returns the camp to the unseeded state with zero code
  change, because the accessors fall back.

### 9.2 Seed construction (deterministic)
- `days`:
  - Sun: `{kind:'arrival', tag}`;
  - Mon–Fri: `{kind:'regular', tag, tpl:'typical'}`;
  - Sat: `{kind:'sendoff', tag}`.

  Tags come from `SCHED_DAYS[dow].tag`.
- `blocks[dk]['s-'+dk+'-'+pad2(i+1)]`:
  - fields `start, end, label, emoji, type, slot?, noTime?`, copied verbatim;
  - `ord = i+1`;
  - `key = pushBlockKey(label)`;
  - `meal = legacyMealOf(label)`, the exact rule `mealInfo` uses today. Junior's
    Breakfast, Lunch and Supper blocks, and senior's Breakfast and Lunch, get tagged.
    Senior "Supper and free time" does not (decision D18).
- `template` = Monday's blocks re-keyed `t-NN`. Each weekday block gets `tpl` = the
  template block with the **same `start` and the same `key`**, else no `tpl`. Junior
  result:
  - every shared weekday block is linked;
  - the campfire and morning-meeting blocks are linked with *different labels*. They are
    stored as per-day wording, so "every day like it" leaves them alone (§10.4);
  - Tue/Thu movie night and all of Friday evening stay unlinked one-offs.

  Senior: Tue–Fri are 100% linked.
- `meals`: copied from `MEALS`. Keys stay lowercase.
- `cleanup`: `MEAL_CLEANUP_SCHEDULE[dow][Meal]` (string or array) becomes `{tid: true}`.
- `verses`: theme plus days 1–5 under `mon..fri`. `video` is kept only if it is `https://`.
- `electives`:
  - `stations['st-'+slug(name)] = {name, emoji: STATION_EMOJI[name]}`;
  - `slots[dk]['s'+slot]['r-'+pad2(j+1)] = {st, ord: j+1, who: {slug(n): n}}`.

  Junior only. Senior's `{}` writes nothing.
- `teams[tid]`:
  - `short: TEAM_ABBREV[tid]`;
  - `emoji: TEAM_EMOJI[tid]`;
  - `accent: TEAM_ACCENT[tid]`, the legacy hex;
  - `crest: TEAM_SHIELD[tid] ? 'repo' : 'none'`;
  - `color` is unset. The hub asks for a palette pick.
- `meta`:
  - `{schema:1, seededAt, seededFrom, seededBy, finaleDow:5}`, merged into any `meta`
    that already exists (`weekStart`, `year` and `paused` are kept untouched);
  - `double: {sd:4, sm:1020, ed:6, em:0}`, which is the *shape* of today's "Thu 5:00 pm ET
    → Sat 00:00 ET" (app.js:286-287, the same for both camps today). It is used only once a
    wizard-created epoch exists (§8.2 `doubleWindow`), and is written only if `meta.double`
    is absent.

### 9.3 A2 "Attach games to the schedule": an explicit mapping, not the buggy heuristic
For each game, find its block on the game's day (`dow` of `game.dayId`):
1. **Candidates** are the `type:'games'` blocks whose `blockSession(block)` equals `game.session`,
   where `blockSession(b) = sessions.includes('Afternoon') && b.start >= 720 && b.start < 1020 ? 'Afternoon' : (b.start < 720 ? 'Morning' : 'Evening')`.
2. Exactly one candidate means attach.
3. Several candidates, or none: use `SEED_BLOCK_HINTS[idBase(game.id)]`, a label prefix
   matched against any block that day. `idBase` strips a trailing `-d<n>`. The hints are:
   `{'team-comp-am':'Team competitions@<720', 'team-comp-pm':'Team competitions@>=720', 'legacy-game':'Legacy Game', 'hot-seat':'“Hot Seat”', 'lets-make-a-deal':'“Hot Seat”', 'team-skits':'Team Skits'}`.
4. Still nothing: the game stays **unattached**, and the hub ⚠️ lists it with a one-tap
   picker.
5. `ord` = the game's current order among the games attached to that block. Set
   `dayId` and `session` **unchanged** (they already agree).

It is written as one config transaction (ops `games/<id>/blockId`, `games/<id>/ord`).

| Camp | Default games | Result |
|---|---|---|
| Junior | Mon–Thu Morning → 10:00 "Team competitions"; Evening → 18:00 "Evening competition"; Fri Morning → 10:00 | Step 2 attaches them |
| Junior | Fri Evening `team-skits` → 19:00 "Team Skits" | Step 3 hint. The block stays `type:'activity'`, so the banner behaviour is unchanged. This fixes the "Team Skits shows nowhere" bug. |
| Senior | `team-comp-am-*` → 9:45; `team-comp-pm-*` → 15:00; `legacy-game-*` → 16:50 | Step 3 hints (two Afternoon candidates). This fixes "10 of 25 never shown". |
| Senior | `hot-seat-*`, `lets-make-a-deal-*` → 18:50 | Step 2. This fixes "listed under three blocks". |
| Either | Games added during a week (live config) | Usually step 2. Anything else is listed for an editor. |

### 9.4 Fidelity and determinism tests (S3, S4; in both `seed.test.js` and `seed.senior.test.js`)
- For every dow 0..6: `strip(scheduleForDow(dow))` from a seeded tree deep-equals
  `DAY_SCHEDULE[dow]`, **in order**. That tree is passed through a fake-RTDB round trip,
  so prune and sort happen.
- `nowBannerHtml(dow, m)` is identical before and after seeding for **every minute of
  every day**. This reuses the existing week-test fuzz harness against two contexts.
- The same holds for: `mealFor`, `cleanupTeamsFor`, `verseFor`/`verseTheme`,
  `electivesFor`, `electiveSlotStart`, `stationEmoji`, `teamEmoji`, `teamShort`,
  `teamAccentVars`, and `doubleWindow()`. In the legacy epoch it returns the two
  constants to the millisecond, whatever `weekStart` says (§8.2). A second test sets a new
  epoch with `weekStart '2027-07-18'` and the seeded `double`, and expects Thu 2027-07-22
  17:00 ET to Sat 2027-07-24 00:00 ET.
- `pushScheduleBlocks` keys and the `pushBlockCatalog` rows are identical, so phone
  subscriptions survive. The block ids change format by design.
- `buildSeed(CAMP)` run twice gives deep-equal output (with `seededAt` stripped).
  A1 run twice under the fake RTDB writes once.
- The A2 mapping table above is asserted game by game for both default catalogs.
  `gamesForBlock` returns each game exactly once.
- `tests/camps.test.js` is unchanged and still green, because the constants are untouched.

### 9.5 The junior byte-identical guarantee, stated precisely
- **Before A1:** every accessor returns the original constant objects. Firebase paths and
  localStorage keys are unchanged. The `config` shape is unchanged. The only data written
  that a v183 device never wrote: presence `v`/`where` (from S2, optional), per-field
  `teams/<i>/<field>` paths (from S1, same resulting data), and config written by
  transaction instead of `set()` (same resulting data).
- **After A1, before any edit:** every rendered output is identical, by §9.4. A v183
  device still open renders the constants, which are the same values.
- **After the first edit:** junior intentionally diverges. Old builds that are still open
  keep showing the built-in schedule until they reload. The hub lists them by name from
  presence `v`.
- **Historical double points cannot move.** In the legacy epoch, `doubleWindow()` is
  pinned to the July-2026 constants, so setting next year's `weekStart` early (before
  the wizard runs) can't re-score last summer's bonuses. A new window takes effect only
  under a wizard-created epoch, when last year's bonuses have been archived and cleared.

### 9.6 Retiring 2026-only code paths without changing 2026 behaviour
- `normalizeSyncedState`'s roster migrations (app.js:6303-6311: the placeholder rename,
  and the counselor refill when `undefined`) run **only while `state.meta.epoch` is
  absent**, the legacy epoch. In a wizard-started year, an editor can name a team
  "Team 1" or blank a counselor, and nothing reverts it.
- `migrateState` v2–v5 are already gated on `version < 5`. They are unchanged, and senior
  stays at 5.
- `ANNOUNCE_PURGE_BEFORE` (app.js:7451) stays as is: it only purges older items.
- `DOUBLE_BONUS_*` and `TEAM_*` stay as seed constants. Nothing reads them directly after
  S0 except the accessors and `buildSeed`.

---

## 10. Editor screens

### 10.1 Navigation and conventions
- Settings → **Set up the week** becomes Settings → **Camp setup**. It opens the **hub**
  inside the existing `#settings-view` takeover (`openBuilder`, `body.builder-open`,
  `state.ui.view='settings'`). `state.ui.settingsTab` gains values `hub`, `schedule`,
  `games`, `teams`, `people`, `meals`, `verses`, `cleanup`, `electives`, `week`,
  `backups`, `notice`, `wizard`, plus a sub-key `state.ui.setupDay` (`typical|sun..sat`).
- **Migration-friendly UI cut-over:**
  - The existing five tabs (Games, Days, Teams, Notice, Data) stay reachable from the hub
    as screens until their replacement ships.
  - Days is absorbed into Schedule (S3).
  - Data becomes Backups (S2).
  - Teams is replaced in S5.
  - Games is reworked in S4.

  Nothing is removed before its replacement is live.
- Every screen has:
  - the header: **← Hub**, the screen title, "👋 Jenn is also here", **Undo ⟲**, and the
    sync dot (Saved / Saving / Offline – will sync / ⚠️ not saving);
  - a phone-first single column. On ≥ 900 px the schedule shows the day list and the day
    side by side;
  - native `confirm()`/`alert()`/`prompt()` replaced by a `jelly-dialog` helper
    `askDialog({title, body, actions})` (the settings.js call sites at 670, 788, 814, 849, 983, 1083, 1088, 1096-1097, 1365, 1373, 1381, 1484 and 1523 are converted as each screen is touched);
  - commit on `change` (blur/Enter). Toggles and pickers commit on tap.

### 10.2 The checklist hub (✅ done / ⚠️ needs attention / ○ not started / — not used at this camp)
The hub is computed locally by `checklistItems()`, a pure function and unit-tested, from the
accessors, `state`, `config`, `memberDirectory` and (editors only) the campers count. Each
row reads: the status icon, the title, a one-line reason, and a tap that opens the screen.

| Item | ✅ when | ⚠️ when (the reason is shown) |
|---|---|---|
| Camp week | `weekStart` is set, is a Sunday, and the camp week hasn't ended | Missing; in the past ("Still last year's week — start the new year"); not a Sunday |
| Editable schedule | `seededAt` set and not paused | Not seeded ("Using the built-in schedule" + **A1** button); paused ("Everyone sees the built-in schedule"); rules not published |
| Teams | `state.teams` ids are exactly `t0..t{N-1}`, N = `CAMP.teamCount`; every team has a name, emoji, short name and a palette colour; colours distinct | Wrong count or id ("Repair team slots"); missing emoji or short name; legacy colour not dark-mode safe; two teams the same colour |
| Counselors | Every team has ≥ 1 member with that `teamId` | Team with nobody; pending rows without sign-in (count); **walk-up requests waiting (count)** |
| Campers (editors) | Every team has ≥ 1 camper | No campers yet (○, optional) |
| Schedule | All 7 day records exist; arrival and send-off have blocks; no unintended overlaps; every block valid | A day with no blocks; overlaps (lists the pairs; pairs in the day's `okOverlaps` are excused, §10.4); blocks after 24:00 |
| Games | Every game attached to a block on its day; every `type:'games'` block on a competition day has ≥ 1 game; every tournament game's bracket kind fits the team count; every `config.days` tab has a matching `regular` day | Unattached games (list + picker); empty competition blocks; tournament with the wrong team count; tab/day mismatch |
| Meals | Every meal-tagged block has a dish | Meals without a dish (count) — ○ when the camp lists no meals at all |
| Memory verses | Theme plus a verse per competition day, none still "to be announced" | Placeholders remaining |
| Cleanup rota | Every competition-day meal has ≥ 1 team; ids valid | Gaps; unknown team; uneven load (info) |
| Electives (junior) | Each elective block has stations; every assigned name matches a staff member | Names that match nobody ("Sofia" vs "Sofie"), with one-tap fix |
| Double points | Window set (or explicitly "No double points") | Window still on last year's dates |
| Phone alerts | Push not set up (—); or `pushSchedule.src` == hash(current schedule) and `pushSchedule.weekStart` == `weekStart` | Out of date ("Republish" button) |
| Restore point | An archive of last year exists, or the epoch is still legacy | No archive yet (before wizard) |
| Notice | (info only) the draft or posted state | — |

The hub's top card is the state-of-the-world: "Junior Camp · Week of Sun Jul 18, 2027 ·
Editable schedule ON · 3 editors here". Below it sits the **Start a new camp year**
button (A3) and, while a camp week is running, a banner: "Camp week in progress — big
changes are locked; rain plan and small edits are fine".

### 10.3 New-year wizard (A3). It resumes per step; progress lives in `setup/meta.wizardBy/At` plus a local step
Pre-flight:
- the editor holds the writer lock;
- the camp is seeded (if not, the wizard does A1 first);
- not during a camp week;
- **fleet check:** if presence shows any *editor* device below build S6 (old viewer builds
  just adopt the cleared state), that device is named and
  the editor is asked to refresh it ("Jenn's phone is on an older version").
1. **Which Sunday does camp start?** A date picker restricted to Sundays, suggested as the
   same week next year. Shows "Arrival Sun Jul 18 → Send-off Sat Jul 24". Writes nothing yet.
2. **Archive last year.** A pinned `archive` restore point, verified by read-back (§6.3),
   plus an optional JSON download. The editor can't continue until it is verified.
3. **What carries over?** Per section: **Keep** (default) / **Reset to camp default**
   (camps.js seed) / **Clear**. The sections are: schedule, games (the results are always
   cleared in step 4), team names and branding, meals (default: Clear), verses (default:
   Clear), cleanup rota, electives assignments (default: Clear), notice (reset to draft),
   camper names (default: **Clear**, D6), and counselor team assignments (default:
   **Clear**, the owner row excepted, D20).
4. **Clear the scores.** One `saveState()` batch, through the state engine:
   - `results`, `brackets`, `drafts`, `picRounds`, `picSetup`, `bonuses`, `live`, `clocks`
     and `announcements` set to `{}`;
   - `notice.status = 'draft'`;
   - `meta.lastDataChangeAt` deleted;
   - **`meta.epoch` = new, `meta.epochAt` = now**.

   The config and setup changes from step 3 go through their engines. Members' `teamId`
   removal is one `members` multi-path update that **excludes `OWNER_MEMBER_KEY`**
   (otherwise the atomic update is refused as a whole; rules#5).
5. **Week settings.** `weekStart`, `year`, the double-points window (default Thu 5 pm →
   Fri midnight; "None" allowed), and the finale day.
6. **Teams.** Opens the Teams screen in wizard mode: names, short names, colours, emoji,
   photos.
7. **People.** Paste counselors per team, review walk-ups, paste campers.
8. **Done.** Back to the hub, with a summary of ⚠️ items left.

Every write step takes a `pre-wizard` restore point first. Each step is idempotent on
re-entry. Other devices see the new epoch on their next snapshot:
- they clear device-local `followTeam`, `identity`, `dayRanks` and dismissed announcements
  (`lsKey('campScoreboardEpochSeen')` ≠ epoch); the first sight with a legacy epoch just
  records it, with no reset;
- they re-show the team picker;
- the history drawer filters to the new epoch.

### 10.4 Schedule (S3)
- **Day strip:** **Typical day** · Sun (Arrival) · Mon … Fri · Sat (Send-off). Each pill
  shows ⚠️ when that day has hub issues.
- **Typical day** edits `setup/template`. The button **"Copy to days…"** opens checkboxes
  Mon–Fri (defaults: all `regular` days) with two modes:
  - **Replace those days** (destructive; restore point first; asks "Wednesday has 3
    one-off blocks — keep them?");
  - **Add what's missing**: template blocks with no linked block on that day.

  Copies mint new `b-` ids, with `tpl` set.
- **A day view** lists blocks in time order. Each row shows the time range, emoji, label,
  chips (🍽 Breakfast, 🏅 games ×3, 🌟 Elective 2, 🔔 alert name) and a ⚠️ for overlaps.
  **+ Add block** opens a block editor sheet:
  - start, end (15-min stepper and free entry), label, emoji;
  - "What is it?": Activity / Meal (picks breakfast, lunch or supper) / Competition (the
    banner yields to the scoreboard) / Elective (slot 1–3);
  - "Show without a time" (`noTime`);
  - **Advanced:** phone-alert name (`key`), read-only once phones subscribe unless "change
    anyway" is ticked.
- **Editing a block that has `tpl`**, when ≥ 1 other day has a linked block whose edited
  field still equals the template's *old* value, asks:
  - **"Just this day"**: writes only this block;
  - **"Every day like it (Mon, Tue, Thu, Fri)"**: writes the template, plus every linked
    block whose field still equals the old template value, in one atomic batch. Days with
    their own wording for that field are named and left alone ("Wednesday has its own
    wording — left alone").

  No per-field override flags are stored. "Overridden" means "differs from the template",
  which is computed.
- **Deleting a block** with games attached asks to detach them to "Unscheduled on Tue" (the
  games keep their results), or to move them to another block. A block that a
  started game is attached to (a result, an in-progress bracket or a draft) needs a second
  confirm. Games are never deleted from here.
- **Overlaps.** Two blocks that overlap are ⚠️ in the hub until an editor taps "This
  overlap is on purpose" on the warning. That dismissal is stored on the day as
  `setup/days/<dk>/okOverlaps`, a comma-separated list of `bidA+bidB` pairs (≤ 400 chars,
  validated in R2 as `newData.isString() && newData.val().length <= 400`). Whichever block
  sorts first (by `start`, then `ord`) wins the Happening-Now banner, which is today's
  first-match rule. Tue/Thu movie night is seeded as an allowed overlap, so the seeded
  hub is all ✅ for the schedule.
- **Rain plan** (a mode toggle on a day, for phones): tap a block, then actions:
  - **Swap with…** (pick another block): exchanges start/end. Games stay with their block.
  - **Move to time…**
  - **Move to another day…**: creates the block on that day with a new id, deletes this
    one, moves its games, and keeps `key`. If the destination day's double-points status
    differs, it asks "Make these games double points too?", which sets `messtival` per game.
  - **Shift everything after this by ± N min.**
  - **Cancel for today**: deletes the block. Its games detach to Unscheduled with a 🌧️
    note on the day's `config.days[].note`, which is an existing field.
  - For games: **Move game to block…**

  Each action is **one atomic multi-path batch** plus one undo entry. The first rain action
  on a day writes a restore point. Alerts follow automatically (§11.3).
- **Arrival and send-off days** are edited like any day, have no template link, and their
  `kind` is fixed by position (Sun/Sat) unless the owner later wants "off" days (D13).

### 10.5 Games (S4)
- **Games list:** grouped **by day, then by block** ("Tue · 10:00 Team competitions"), with
  "Unscheduled" groups per day. Drag handles on laptop; ↑↓ on phones. Reordering writes
  `ord` only.
- **Game editor:** today's fields, with **Day + Session replaced by "When"**. That is a
  picker of blocks across the week (competition blocks first, then the others, then
  "Not scheduled yet"). Choosing a block sets `blockId`, and derives and sets `dayId` (the
  `config.days` tab with that dow; created after a confirm if missing) and `session`
  (`blockSession`, §9.3), so old builds and the home tabs stay consistent.
- New tournament fields:
  - **Bracket**: shows "6-team bracket" or "4-team bracket (2 semis → 3rd place → final)"
    from `CAMP.teamCount`;
  - **Round 1 / semifinal pairings**: "Pick when you start" (default), or fixed pairs (a
    UI for today's JSON-only `roundOneMatchups`; 4-team: two pairs).
- Saves are field diffs (§5.2.5). The format-change cleanup is scoring#6.
- **Quick game ⚡** (rain-day add) attaches to the block that is happening now or next on
  that day (falling back to Unscheduled), replacing the `>= 720 ? 'Evening'` guess
  (settings.js:302). This fixes senior afternoons.

### 10.6 The 4-team bracket (S4)
- **Shape** (`kind:'four'`; map keys rather than arrays, so pruning can't coerce them):
  ```js
  brackets[gid] = { kind: 'four', startedAt,
    semis: { s1: {a, b, winner?, loser?}, s2: {a, b, winner?, loser?} },
    third: {a, b, winner?, loser?}?,  final: {a, b, winner?, loser?}? }
  ```
  **The phase is derived, never stored:** `semi1` until s1 has a winner, then `semi2`,
  then `third` (the losers), then `final` (the winners), then `summary`. That order is
  decision D12. `normalizeBracket` heals the `kind:'four'` records (missing `semis` means
  corrupt, so it shows "This bracket can't be read — Cancel it?", never a crash).
- **Start:** the pairings default to the current standings, 1 v 4 and 2 v 3, via
  `rankTeamsByPoints`. Ties are broken by team order, and two pickers allow swapping.
  Fixed pairs come from the game when set. Starting requires exactly 4 teams. Junior keeps
  the 6-team flow, chosen by `bracketKindFor(state.teams.length)` (6 → `six`, 4 → `four`,
  else a refusal saying the count).
- **Each step** reuses `matchupCalloutHTML`, `matchTrackerHTML`/`bindMatchTracker` and
  `bindMatchupCopy` with stage names "Semifinal 1", "Semifinal 2", "3rd-place match" and
  "Final". The own-team guard is `canScoreRound(a, b)` per match. **Undo is available on
  every step.**
- **Tap safety (two editors, whole-object write):** the winner handler re-reads
  `state.brackets[gid]` at tap time and ignores the tap if the expected match already has
  a winner (a toast: "Jenn already recorded that"). There is no phase change as a render
  side effect (contrast app.js:6951-6956).
- **Medals:** gold = final winner, silver = final loser, **bronze = 3rd-place winner**. Save
  writes `results[gid] = {medals, savedAt, path: <the bracket>}` and deletes the bracket.
  Every `messtival` doubling is unchanged.
- **Pure helpers** (extracted in S0 for 6-team, extended here) are the only code that
  changes a bracket: `bracketKindFor`, `freshBracket(kind, pairs)`,
  `bracketCurrent(g, b)`, `bracketNext(g, b)`, `bracketRecordWinner(b, stage, winner)`,
  `bracketUndo(b)`, `bracketMedals(b)`.
- These readers learn the new kind: `currentMatchupOf`/`nextMatchupOf` (app.js:5804,
  5821), `upcomingMatchups` (2964), `renderLiveHome` labels (5691), `renderLiveWatch`
  labels and its completed list (5876-5879), `bracketRefsTeam` (settings.js:127),
  `gameStatus`, and `liveHomeGames`.
- **Rollout gate (risk R1: an old editor build crashes on a `kind:'four'` object):** the
  **Start bracket** button for `four` is disabled while presence shows any *editor* of
  this camp on a build below S4 ("Jenn's device needs a refresh first"). Senior is the
  only camp with 4 teams, and its editors are few.

### 10.7 Teams (S5): fixed slots
- N cards (`CAMP.teamCount`). There is no add, delete or reorder, which removes the
  `t-<ts>` id bug (settings.js:1069) and `removeTeamEverywhere` from normal use. A
  "Repair team slots" tool appears only when the hub detects non-`tN` ids. It maps each
  odd team to a free slot, after a restore point. The mapping rewrites
  `results/brackets/drafts/bonuses/picRounds/notice zones/cleanup/member teamIds`. This is
  decision D21, and is likely never needed live.
- **Fields:**
  - Name (`state.teams[i].name`, per field);
  - Short name (`setup.teams.tN.short`): used in mentions, morning-meeting wording and the
    Worker;
  - Emoji;
  - **Colour**: a palette grid from `TEAM_PALETTE`, where taken swatches are dimmed;
  - **Photo**: upload, crop to a square or portrait, then `shrinkToDataUrl` (chat.js:420)
    to JPEG ≤ 80 k chars, painted on the team's light colour (JPEG has no transparency;
    decision D8). Writes `teamPhotos/tN = {v, data}`, then `setup.teams.tN.photoV = v` and
    `crest:'photo'`. Online only;
  - "Use the built-in shield" (junior: `crest:'repo'`);
  - Counselor fallback text (`state.teams[i].counselor`), shown greyed: "Shown only for teams
    with no counselor accounts".
- **`TEAM_PALETTE`** (camps.js, shared by both camps) is 12 swatches
  `{id, name, light, dark}`. Example ids: `ember`, `crimson`, `pumpkin`, `gold`, `forest`,
  `teal`, `sky`, `navy`, `violet`, `plum`, `slate`, `brown`. The values are chosen so that
  `palette.test.js` passes:
  - `light` reaches ≥ 4.5:1 as text on the light surface token and with white text on a
    `light` fill;
  - `dark` reaches ≥ 4.5:1 as text on the dark surface `#1a2030`.

  The CSS uses `--team-accent: var(--team-accent-l)`, switched to `var(--team-accent-d)`
  under the existing dark-theme selectors (`body.dark-theme` and the
  `prefers-color-scheme` block). Legacy `accent` hexes keep l = d until a swatch is picked.
- **Photo loading:** on `photoV` change, a device `once()`s `teamPhotos/tN`, launders it
  (`data:image/jpeg;base64,` only), and caches it in the existing IndexedDB photo store
  under `crest:<campId>:tN:<v>`. `clearPhotos` wipes it on sign-out. Precedence: photo >
  repo shield > emoji.

### 10.8 People (S5): one team list
- **Per team** (and "No team" plus "Directors" sections):
  - **counselors with sign-in** (member rows with `teamId`);
  - **⏳ No sign-in yet** (pending rows);
  - **🙋 Asking to join** (access requests that chose this team);
  - **Campers** (editor-only, collapsed by default, count shown).
- **Typed roster:** "Add counselors" takes a text area per team, one name per line. It
  creates pending rows in one multi-path update, de-duplicated by case-insensitive name,
  the `missingSeedCounselors` rule. This generalizes the junior-only `SEED_COUNSELORS`
  button, which remains as the "last year's printed roster" option.
- **Walk-ups:** a signed-in non-member sees the denied screen with a new **"Ask to join"**
  card (§11.4). Editors get a live, editor-only `accessRequests` listener, attached
  post-approval only when `canEdit()`. Its error handler degrades itself only. Each
  request offers:
  - **Approve as counselor** (viewer) or **Approve as director** (editor), with an optional
    team. This runs `createMemberIfAbsent`, then deletes the request
    (create-then-delete, like `convertPendingMember`);
  - **This is pending "Sofia (Pumpkins)"**: shown when a name matches case-insensitively.
    It converts that pending row to the requester's key, then deletes the request;
  - **Decline**: deletes the request.
- **Campers:** paste a list per team. Rows show name, an "absent" toggle (D6) and remove.
  - Editor-only listener on `campers`. Never in `STORAGE_KEY`, `SYNC_KEYS`, backups,
    restore points, the TV page or push.
  - Demotion (the `setMemberRole` → viewer path) detaches the listener and drops it from
    memory.
  - The screen says "Camper names are visible to directors only".
- **The owner row** (rules#5) is shown read-only: "Managed in the Firebase console" (team
  select and switches hidden), via `OWNER_MEMBER_KEY`.
- The Members drawer (`#members-overlay`) stays as is until S5 ships. It then becomes a
  link to People. Its per-camp None/Viewer/Editor switches move onto the People rows
  unchanged (`campMembersPath`, `mergeMemberLists`).

### 10.9 Meals, verses, cleanup, electives (S3)
- **Meals:** a grid of days × meal-tagged blocks. Each cell holds a dish and an emoji. A
  meal block with no dish shows the plain label (today's behaviour). Copy-from-day is
  offered.
- **Verses:** the theme (title, text, ref), then one card per competition day (text, ref,
  optional video URL that must start with `https://`).
- **Cleanup rota:** a grid of competition days × meals. Each cell is multi-select team
  chips (1 or 2 teams), showing a per-team count ("Foxes: 3 meals"). There is an
  "Auto-fill a fair rotation" helper, which builds a deterministic round-robin over N teams
  and the meals, and offers a preview before writing.
- **Electives (junior; hidden when `CAMP.features.electives` is false):**
  - **Stations**: name and emoji;
  - **per day × slot**: rows of station + people chips. The people picker lists staff
    names from the member directory first, then free text;
  - a ⚠️ marks names that match no member ("Sofia → Sofie?", with a one-tap rename);
  - "Copy Monday to Tue–Fri" is available.

### 10.10 Week settings (S3)
- **Camp week starts on (Sunday).** This is now the single source of truth
  (`setup/meta.weekStart`). The Phone-alerts drawer's own date input is replaced by a
  read-only line ("Week of Jul 18 — change in Camp setup").
- **Double points** for verse and custom bonuses: from (day, time) to (day, time), or
  "None". The banner copy ("tonight & Friday") is generated from it. Per-game
  **Messtival** stays a per-game checkbox, and its default when creating a game on a
  "double" day is ticked.
- **TV finale day:** Sun–Sat (default Fri).
- **Emergency: use the built-in schedule** (the Pause switch, with confirm).

### 10.11 Backups (S2)
Restore points (list, preview, selective restore, pin), "Save a restore point now",
download/import JSON (v3), and "Restore camp defaults", which keeps today's behaviour but
is restore-point-protected.

---

## 11. Outputs and the non-editor surfaces

### 11.1 TV standings page for both camps (Track T, shippable any time after S0; updated in S3 and S5)
- **Camp selection:** `?camp=senior|junior`, else `localStorage.campScoreboardActiveCamp`
  (the same device as the presenter's app), else junior. `reloadNow` already preserves
  params. stalling.html's link gains a camp toggle, and its "count 'em down from 6th" copy
  is computed from the team count.
- **No more duplicated constants:** the page loads `defaults.js?v=N` and `camps.js?v=N`
  (both side-effect-free; camps.js references `defaultConfig` at load, so defaults.js must
  come first; the TV script is one IIFE, current-standings.html:338, so camps.js's globals
  cannot collide with it). It uses `CAMPS[campId]` for `dbRoot`, `storageSuffix`, `teamCount`,
  default names, emoji, shields and accents. It deletes its own `DEFAULT_TEAM_NAMES`,
  `TEAM_EMOJI`, `TEAM_SHIELD`, `MESSTIVAL_GAME_IDS` and `STORAGE_KEY` copies (current-standings.html:350-373).
- **Live identity (after S3/S5):** one `once()` of `setup/meta` (double window, finale
  day, weekStart) and `setup/teams`, re-read when `config` changes (a cheap proxy), plus
  `teamPhotos/tN` per `photoV`. The precedence is the same as `teamCrestSrc`.
  **Null-safe images**: no crest means emoji only (fixes `src="undefined"`,
  current-standings.html:777-779).
- **The six-team loops** at 777 and 789 iterate `state.teams` ids. The intro counts down
  from N.
- **pages#5:** `computeStandings` skips results whose game id isn't in the live config
  (`liveGameIds` from `updateDoubledFrom`, null-guarded). It doubles bonuses with the
  `doubleWindow` from `setup/meta` (falling back to the constants), matching
  `medalCounts`.
- **pages#6:** sign-in uses the app's `identityKey` rule (email key or phone number). The
  members check reads `<root>/members/<key>`.
- **pages#3:** both `.on()` listeners get cancel callbacks. A cancel shows the denied
  overlay and reloads in 5 s (one-shot lifecycle, like the app).
- **Finale:** `isFinaleDay()` = today (camp time) is `finaleDow`, and if `weekStart` is set,
  the date is inside the camp week. `?finale` still forces it.
- **Testing:** the TV script stays inline, and no new served file is added.
  `tests/tv.test.js` extracts the inline `<script>` by regex into a vm context with a stub
  DOM, then tests `computeStandings` (orphans, doubling, 4 teams), `normalizeTeams`,
  camp selection, and `isFinaleDay`. `TV_BUILD` is bumped on every edit.

### 11.2 Full-week calendar export (S3)
- `buildWeekIcs()` produces one VCALENDAR per camp, holding every timed block Sun–Sat:
  - `X-WR-CALNAME:Junior Camp 2027`;
  - the existing `VTIMEZONE` block;
  - `DTSTART` and `DTEND` computed from `weekStart` + dow + minutes, in `America/New_York`;
  - `UID:<blockId>.<weekStart>.<campId>@camp.patricksimpson.info`, which is stable across
    edits, so re-importing **updates** events instead of duplicating them. This fixes the
    collision across camps and the Tue/Thu duplicate UIDs;
  - `SEQUENCE:<minutes since 2026-01-01>` (monotonic) and `DTSTAMP`;
  - `DESCRIPTION` with the dish (`mealFor`), the attached games (`gamesForBlock`) and the
    cleanup team;
  - lines folded at 75 octets (RFC 5545).
- The schedule sheet keeps "Add <Day> to calendar". It calls the same builder filtered to
  one day, and gains **"Add the whole week"**. Without `weekStart`, the export warns "Camp
  week not set — using this week's dates" (today's behaviour, labelled).
- `tests/ics.test.js`:
  - UIDs are unique per file and stable across a label edit;
  - folding is correct;
  - the DST edge is handled;
  - the dates come from `weekStart`;
  - both camps produce different UIDs.

### 11.3 Phone alerts: publishing from setup, stable keys, change alerts
- **Publisher (S3):** `pushPublishSchedule` builds the blocks from `scheduleWeek()`.
  - The block id becomes the setup block id. Before seeding it stays `d<dow>-<start>-<i>`.
  - `key` = the stored block `key`. For seeded data that equals today's computed key, so
    subscriptions survive.
  - It writes `rev = previous rev + 1` and `src = hash(canon schedule + weekStart)`, using a
    `transaction` on `pushSchedule` (R3 must be live first).
  - **Triggers:** (a) the setup engine acks a write touching `blocks/`, `days/` or
    `meta/weekStart`, debounced by 5 s; (b) an editor's load when `src` ≠ the local hash
    (this replaces `pushMaybeRepublishSchedule`'s compare-with-code); (c) the hub's
    Republish button.

  Deterministic inputs make racing editors converge. The transaction makes `rev`
  monotonic.
- **The week date** moves from the push drawer into Week settings (§10.10). The drawer
  reads `weekStartDate()`.
- **Sequencing with Project 1 go-live (decision D4):**
  - Today, no shipped build can write `pushSchedule` (§2).
  - **If push goes live after S3**, no build ever publishes a code-derived schedule, and
    nothing needs fencing.
  - **If push goes live before S3**, the S3 deploy must be followed by the R8 fence as soon
    as presence shows no pre-S3 editor build. Until then, a stale editor device that runs
    `pushMaybeRepublishSchedule` could republish the camps.js schedule. The S3 publisher
    re-publishes on its next load because `src` mismatches, so the damage self-heals within
    one editor page load.
- **Id change on first publish:** the Worker de-duplicates reminders by tag
  `block-<id>-<date>`, so a reminder due inside the same lead window as the
  republish could fire twice under old and new ids. The S3 publisher therefore skips a
  republish whose only changes are id renames if any block starts within the next 20 min;
  it retries on the next trigger.
- **Schedule-change alerts (S7, Worker; G11):**
  - A new cron step, `cronScheduleChanges(camp)`, runs after `cronSchedule` inside the
    camp window. It reads `pushSchedule/rev` and `at`, plus
    `pushServer/schedSeen/<camp> = {rev, blocks:{id:{dow,start,label,key}}}`.
  - If `rev` is unchanged, it stops.
  - If `now - at < 180 s`, it waits. This coalesces a rain shuffle's burst of edits into
    one alert.
  - Otherwise it reads `blocks`, diffs by id, and keeps changes whose old **or** new
    occurrence falls between now and the end of tomorrow (camp time) and hasn't started.
    The changes are moved (dow or start), removed, added, and renamed.
  - For each device whose prefs match either the old or new `key` (`blocksAll ||
    blocks[key]`, `lead` ignored), it builds **one digest**:
    - title "🗓️ Schedule change";
    - body "Supper now 5:30 PM (was 5:00) · Campfire moved to Thursday", at most 3 items
      then "+N more";
    - `tag: sched-<camp>-<rev>` and `open: 'schedule'`;
    - a new kind `sched` (sw.js maps it; `PUSH_SW_VERSION` is bumped).
  - It enqueues through the existing outbox/`PUSH_BATCH` path, then writes `schedSeen`. On
    the first run with no `schedSeen`, it stores the snapshot and sends nothing.
  - It **trusts only published data.** The page sends nothing new, and there is no new
    `/notify` kind. The free-plan budget: 3 small reads plus the outbox; the diff of about
    150 blocks is well under 10 ms CPU.
  - Tests are added to `tests/push-worker.test.js`:
    - the diff (move, remove, add, rename, past changes ignored);
    - the coalescing window;
    - digest wording;
    - recipient selection by old and new key;
    - the first-run silence.
  - `tests/push-e2e/` is re-run.

### 11.4 Walk-up "Ask to join" (S5)
- This is the denied screen (index.html:107-112, `denyMemberFinal` app.js:8438).
- **Visible when** R5 is live (probed with one refused/accepted `once()` of the requester's
  own `accessRequests/<key>`, which `SELF` can read).
- **The form** has a name (prefilled from `authUser.displayName`) and a free-text "Which
  team or counselor are you with?" (`note`, ≤ 200). A non-member can't read
  `state/teams`, so there is no team picker; the approving editor picks the team. If the
  denial probe found the other camp, it also asks "Which camp?" (the request is written
  to that camp's root). The optional `teamId` field in the rules is reserved for a later
  version that might publish team names to non-members.
- **Write:** a single `set()` of `{name, note?, at: TIMESTAMP}` to
  `<root>/accessRequests/<identityKey>`.
- **No listener (THE INVARIANT).** While the screen stays open, the device polls `once()`
  of its own `members/<key>` every 20 s, for at most 30 min. Each attempt is refused
  harmlessly until an editor approves. On success it reloads. The existing "I've been
  added — try again" button remains.
- **Request ownership:** the requester can withdraw (delete own) and can re-send after
  60 s, which the rules throttle.
- **Directors' alert:** the People badge and the hub ⚠️, plus (D7) an optional director
  push through the existing director-alert path, sent by the first editor device that sees
  the new request. It is de-duplicated with the request key as the alert id.

---

## 12. The staged build plan

### 12.1 Overview
| Stage | What ships | Rules | Owner does | Activates by | Safe to deploy during a camp week? | Rollback |
|---|---|---|---|---|---|---|
| **S0** Seams & safety nets | Accessor layer; pure 6-team bracket helpers; rules#5; scoring#6; B1; danger contrast; .ics UID fix; legacy-migration gating; test scaffolding | — | — | Deploy (pure refactor and bug fixes) | **Yes** | git revert |
| **T** TV page both camps | §11.1 (pre-setup part) | — | — | Deploy | Yes (TV only) | git revert |
| **S1** Config engine v2 | scoring#3 fix (transactions, baseline, rebase, first merge, field-diff game saves); teams per field; two-tab writer lock; undo for config/teams; visible push failures | — | — | Deploy (bug fix) | Tolerable; **prefer off-season** | git revert (blob extras ignored) |
| **S2** Infrastructure | R2; `setup-sync.js` (listen-only); restore points + Backups screen; presence `v`/`where` + "also here"; hub shell; `askDialog`; config `mark` written | **R2** | Rules PUT + probes | Deploy (nothing visible changes except the hub and backups) | Yes | Revert code; R2 is inert |
| **S3** Schedule as data | A1 seeding; Schedule / Meals / Verses / Cleanup / Electives / Week screens; accessors switch on `seededAt`; publisher from setup; full-week .ics; data-driven double points and finale | **R3** | Rules PUT; press **A1** (senior first) | **A1** per camp | Code: yes. **A1 for junior: off-season** | Pause switch; pre-seed restore point; revert |
| **S4** Games on blocks + 4-team bracket | A2 backfill; Games screen by block; "When" picker; tournament seeding UI; `kind:'four'` bracket; remaining direct config readers converted | — | Press **A2** (or it runs with A1) | **A2**; bracket Start (fleet-gated) | Code: yes. A2: off-season preferred | Restore point; finish or cancel 4-team brackets **before** reverting code |
| **S5** Teams & people | R5; Teams screen (palette, photos, short names); People screen (typed roster, walk-ups, campers); mention dictionary; Worker short-name fix | **R5** | Rules PUT; **Worker paste** | Deploy (new screens) | Yes | Revert; R5 inert; previous Worker re-paste |
| **S6** New-year wizard | A3; epoch; archive; device-local reset; history filter; hub complete | — | Run **A3** when ready | **A3** | **Off-season only** (enforced) | Restore the archive (all sections) |
| **S7** Change alerts | Worker `cronScheduleChanges`; sw.js `sched` kind; `PUSH_SW_VERSION` bump | — | **Worker paste** (needs Project 1 live) | Deploy | Yes | Re-paste the previous Worker; revert sw.js |
| **S8** Tighten | R8 fences after the fleet check; retire the replaced builder tabs; CLAUDE.md final | **R8** | Rules PUT | Rules publish | Yes | Restore the backed-up rules |

The ordering logic is this:
- S0 makes every later change a local edit behind an accessor.
- S1 fixes the live bug on the existing node before anything new is built on top of it.
- S2 lands all the plumbing and safety nets (restore points!) **before** the first
  data-changing activation in S3.
- S3–S5 are features, each behind an activation or new screens.
- S6 depends on all of them.
- S7 depends on Project 1 going live.
- S8 is the only stage that deliberately breaks old builds, and it comes last.

### 12.2 Stage details

#### S0: Seams and safety nets (code only)
- **Ships:**
  1. The §8 accessors in app.js. Every direct reader is converted in app.js, chat.js,
     push.js and settings.js.
  2. `blockMeal`, `blockKey` and `blockId` (§8.1).
  3. Pure bracket helpers for the **existing 6-team flow**. The click handlers in
     `renderBracketRound1/Bye/Semifinal/Championship/Summary` call them. Behaviour is
     identical, including the bye suggestion and fixed vs free pick.
  4. `OWNER_MEMBER_KEY = 'patricksimpson,fx@gmail,com'` in app.js. `renderMemberList` and
     `bindMemberList` treat it like `self`. The team select is hidden, and the row reads
     "Managed in the Firebase console" (rules#5).
  5. scoring#6's saveGameDraft half, plus the `clocks` leak in
     `deleteGame`/`pruneOrphanedGameData` (§5.2.5).
  6. B1: **← Back** and a tab switch with a dirty game draft ask "Discard your changes to
     *X*?" and then clear `gameDraft`. This removes the zombie `builderDirty()` that froze
     sync and blocked auto-reload.
  7. `.danger-link` and the other danger-coloured *text* (styles.css:1575 and 5388, plus the danger text at styles.css:499, 1695, 2262,
     2331, 2358, 2685, 2964, 3197, 4194, 4728 and 5198) use `--color-danger-text`. Its dark value is raised to ≥ 7:1 on
     `#1a2030` (for example `#ff8a8a`).
  8. `buildDayIcs` UIDs include the block index, which fixes the Tue/Thu duplicates. The
     full fix comes in S3.
  9. `normalizeSyncedState`'s roster migrations are gated on `!state.meta.epoch`. That is a
     no-op today.
  10. `tests/fake-rtdb.js`: an in-memory ref supporting `on/once/off/update/set/transaction`.
      It prunes nulls and empties and re-sorts keys like RTDB, supports `.info/connected`
      toggling, offline queuing and injected rule refusals per path.
- **Pin-first tests** (M10):
  - `settings-crud.test.js`: `validateGameDraft`, `saveGameDraft` (format change clears
    result + bracket + draft + live + clock), `duplicateGame`, `deleteGame`, `deleteDay`,
    `deleteTeam`/`teamRefs`, game reorder, and the B1 back-button draft clear;
  - `accessors.test.js` and `.senior.test.js`: `===` parity for every row of §8.2;
  - `bracket.test.js`: the 6-team full path to `medalCounts`, undo, bye tie, fixed order,
    `nextMatchupOf`, and a prune fuzz on every field;
  - `owner-row.test.js`: `OWNER_MEMBER_KEY` equals the literal in both rules blocks;
  - .ics UID uniqueness.
- **Verify live:**
  - the `curl` version checks (CLAUDE.md);
  - open junior and senior as an editor; the banner, schedule sheet, electives, verse and
    cleanup cards look unchanged (a Playwright screenshot diff against v183 on fixed
    `?now=` values);
  - the members drawer owner row is read-only.
- **Rollback:** `git revert`, then bump `?v=`.

#### Track T: TV page for both camps (any time after S0)
- **Ships:** §11.1 minus the setup-reading parts, which come with S3/S5 behind
  `typeof`-style feature checks (it reads `setup/*` only if present).
- **Tests:** `tests/tv.test.js`.
- **Verify live:** junior TV unchanged (`?demo`); `?camp=senior` shows 4 teams with no
  broken images; a phone-account presenter can sign in; revoking access shows the
  overlay, then a reload.
- **Rollback:** revert. TV only.

#### S1: Config engine v2 and its companions (code only)
- **Ships:**
  - §5.2 entirely;
  - teams per field (§5.1 #1);
  - the writer lock (§5.7);
  - undo for config and teams commits (§6.1), with UI in the existing builder (a toast and
    an Undo button);
  - the visible push-failure indicator (§5.1 #3);
  - Days and Teams tab handlers resolve by id at commit (M11);
  - remote config applies while a builder field is focused, with only rendering deferred
    (§5.8).
- **Compatibility:**
  - S1 writes the same 5-key, array-shaped config, so old builds read it unchanged.
  - Old builds' whole-node `set()` is still accepted (no rules change). It can still
    clobber, but only from devices that haven't reloaded, which is a strict improvement.
  - Per-field `state/teams/<i>/<f>` writes pass today's rules (no rule below `teams`;
    ancestor validate not evaluated). Old builds receive the full array through their
    listener.
- **First run:** a device with no `_cfgBase` does a plain adopt (today's behaviour) and
  then starts tracking.
- **Tests:**
  - `config-sync.test.js` on the fake RTDB:
    - rebase on receipt;
    - two "devices" edit different fields of one game: both survive;
    - same field: last ack wins, plus a toast;
    - delete vs edit: the edit is dropped, plus the "put it back" path;
    - the `configReady` gate;
    - offline edit → reload → first-snapshot merge pushes it;
    - prune and sort canon (empty `rules[]` isn't "theirs");
    - `pendingConfigWrites` in `reloadBlocked`, `hasUnsyncedWork` and
      `hasUnconfirmedLocalWork`;
    - a game-editor field diff.
  - `teams-sync.test.js`: per field, plus the whole-write fallback.
  - `tablock.test.js`: a stubbed `navigator.locks`; steal, then read-only, then reload.
  - `undo.test.js`: the conflict-aware undo.
  - **Deliberate updates:** `sync.test.js:344` (teams whole), `sync.test.js:355-372`
    (flush now calls the transaction stub), and `sync-merge.test.js:132-147`.
- **Verify live:**
  - two laptops on senior, editing two fields of one game at once: both are kept;
  - airplane mode, an edit, a force-reload, Wi-Fi back: the edit is kept;
  - a second tab is read-only.
- **Rollback:** revert. `_cfgBase`, `_cfgBaseAt` and `_cfgBaseEpoch` stay in the blob and
  old code ignores them.

#### S2: Infrastructure (R2, then code)
- **R2 (owner):**
  - add `setup`, `restoreIndex` and `restoreBody`;
  - add presence `where`/`v`;
  - add the **optional** `config/mark` (`newData.isNumber()`) so S2+ clients can mark
    their config writes for the S8 fence.

  This is one PUT: GET a backup first, PUT, read it back, run the probes (§7.5).
- **Ships:**
  - `setup-sync.js` (§5.3). It listens and normalizes. There is no seeding UI yet.
  - The Backups screen with restore points (§6.2–6.4). Auto points before import and
    restore-defaults.
  - Presence `v`/`where` (two-step write) and the "Jenn is also here" header chip.
  - The **hub shell** with live checklist rows for Teams, Counselors, Games (attachment
    shows "—" until S4), Restore point, and Notice. Schedule shows "Built-in schedule
    (editing comes next)".
  - `askDialog`.
  - CONFIG_KEYS gains `mark`, written as `2` inside config transactions **only when R2 is
    detected** (the `setup` listener got a snapshot or a null, not a denial). Otherwise
    `mark` is stripped, so a pre-R2 config write can never be refused for carrying it.
- **Files:**
  - `setup-sync.js` and `setup-ui.js`, loaded after settings.js and before chat.js;
  - index.html script tags with `?v=`, making **fourteen** `?v=` assets;
  - tests/harness.js `APP_FILES`;
  - the CLAUDE.md file list.
- **Compatibility:** proven by `setup-compat.mjs`, `presence-compat.mjs` and
  `restore.mjs` (§7.4). Code before rules: the setup listener is denied, so
  `setupDenied`; the hub says "rules not updated"; restore is disabled; presence is
  unaffected.
- **Tests:**
  - `setup-sync.test.js`: prune and heal, first merge, per-path diff depths, bisect and
    quarantine, the denied path never touching `fbRef`/`syncDenied`, the kill switch,
    partial-record drop;
  - `restore.test.js`: body excludes campers, members, chat and photos; retention of 30;
    pinned survive; a selective restore emits a minimal diff; a pre-restore point is
    written first; cross-epoch warning;
  - `presence.test.js`: name resolution fails closed; fleet minimum; where vocabulary;
  - `checklist.test.js`: the pre-seed rows;
  - `rules.test.js` updates.
- **Verify live:**
  - the unauthenticated probes for the new paths;
  - "Save a restore point" on senior, and see it listed;
  - two editors in the builder see each other's chip.
- **Rollback:** revert the code. R2 can stay; it is inert without clients.

#### S3: Schedule as data (R3, then code, then A1 per camp)
- **R3 (owner):** `pushSchedule` optional `rev`/`src`. This is safe for every existing
  writer (there are none today; §2).
- **Ships:**
  - `buildSeed` and **A1**;
  - accessors switch on `seededAt && !paused`;
  - the Schedule screen (typical day, copy to days, every-day-like-it, overlaps, rain
    plan; games are shown read-only on blocks via the heuristic until S4);
  - the Meals, Verses, Cleanup, Electives and Week settings screens;
  - the publisher from setup (§11.3);
  - the push drawer reads the week from setup;
  - **the camp week moves home.** `setup/meta.weekStart` can be set from Week settings
    **before A1** (`meta` can exist without `seededAt`; only `seededAt` switches the
    accessors). On first load as an editor, an S3 client copies an existing
    `pushSchedule/weekStart` into `setup/meta.weekStart` when the latter is absent. That is
    a one-time, idempotent migration;
  - full-week .ics;
  - `doubleWindow()` and `finaleDow()` from data;
  - TV reads `setup/meta`;
  - the hub rows for Schedule, Meals, Verses, Cleanup, Electives, Double points, Phone
    alerts and Camp week.
- **Activation:** an editor presses A1 on **senior first** (D3). The hub shows the result;
  compare it with the built-in output (§9.4 guarantees it). Junior follows, off-season (M9).
- **Tests:**
  - `seed.test.js` and `seed.senior.test.js` (all of §9.4, including the every-minute
    banner fuzz before vs after);
  - `schedule-edit.test.js`: every-day-like-it with overridden days left alone; copy
    typical (replace and add-missing); swap / shift / move-day as one atomic batch with one
    undo entry; delete block → games detach; overlap detection and dismissal;
  - `ics.test.js` (§11.2);
  - `push.test.js` additions: keys identical post-seed; ids are block ids; rev monotonic;
    src hash stable; the skip-if-imminent rule;
  - `doubleWindow` DST tests (July and an early-June week);
  - existing `week.test.js` and `week.senior.test.js` re-run in a **seeded** context too,
    via a `makeContext({camp, seeded:true})` option on the harness that pre-loads a
    `buildSeed` tree as `weekSetup`.
- **Verify live:**
  - probe that the setup paths deny unauthenticated access;
  - after A1 on senior, the console Data tab shows `seniorScoreboard/setup/meta/seededAt`;
  - the banner, schedule sheet and .ics match pre-A1;
  - edit a block on one phone and see it on another within seconds;
  - airplane-mode edit, reload, reconnect: it survives;
  - Pause and see the built-in schedule come back.
- **Rollback:** Pause (instant, data-level), then the pre-seed restore point, then a code
  revert (the accessors' fallback makes `setup` inert).

#### S4: Games on blocks and the 4-team bracket (code only)
- **Ships:**
  - **A2** (§9.3), offered in the hub for seeded camps and run automatically inside A1 on
    camps seeded after S4;
  - the Games screen by block, the "When" picker, the quick game attaching to the current
    block, and the tournament pairing UI;
  - `gamesForBlock` used by the schedule sheet, .ics and hub, plus the remaining direct
    config readers (§8.3);
  - the 4-team bracket (§10.6) with its fleet-gated Start.
- **Compatibility:**
  - `blockId`/`ord` are optional game fields. Old builds' `toEditableDraft` deep-clones
    them, and `saveGameDraft` only deletes per-format keys, so they survive.
    `tests/fixtures/legacy-builder-v183.js` (the v183 `toEditableDraft` + `saveGameDraft`,
    copied verbatim) asserts this in a test.
  - The dangling-link rule (§4.3) covers an old build changing Day.
  - `kind:'four'` brackets are protected by the fleet gate. Viewers on old builds are safe
    (verified: `currentMatchupOf` returns null, so "Waiting…").
- **Tests:**
  - `games-blocks.test.js`: the backfill table per camp, `gamesForBlock` exact-once,
    dangling resolution, derived `dayId`/`session`, the quick game attaching to the
    current block;
  - `bracket.senior.test.js`: start with standings pairing; the full path semis → third →
    final → summary; medals (bronze = 3rd-place winner); messtival ×2; undo at every step;
    stale double-tap ignored; the own-team guard per match; prune fuzz; `computeSyncUpdates`
    emits exactly `brackets/<gid>`; `firstSnapshotMerge` of an offline semi result;
    `bracketRefsTeam`;
  - **`week.senior.test.js:105-115` is changed on purpose**: senior now starts a `four`
    bracket, and a 5-team roster is refused with the count in the message;
  - the legacy builder preservation test.
- **Verify live:** a senior sandbox tournament (create, start, play through, save, Clear
  result, delete the game); a junior 6-team smoke on a sandbox game.
- **Rollback:** **first** finish or cancel every `kind:'four'` bracket (the hub lists
  them), because a pre-S4 editor build crashes on one (R1). Then revert. `blockId` fields
  are inert to old code.

#### S5: Teams and people (R5, then code, then Worker)
- **R5 (owner):** `teamPhotos`, `campers`, `accessRequests`.
- **Ships:**
  - the Teams screen (§10.7) with `TEAM_PALETTE` and CSS light/dark accent variables;
  - the People screen (§10.8);
  - "Ask to join" (§11.4);
  - the chat mention dictionary from `teamShort` and `teamCounselorNames`;
  - `adoptMemberTeam` identity matching via `teamCounselorNames`, which fixes the
    Sofia/Sofie adoption once an editor resolves the name in Electives;
  - the Members drawer links to People.
- **Worker (owner paste):** `campTeams` also reads `<root>/setup/teams` (one small read).
  `teamNamedIn` accepts the team's `short` name as a whole word (≥ 3 chars) in addition to
  the full name. That fixes senior "Red". Re-run `tests/push-worker.test.js` and
  `tests/push-e2e`.
- **Tests:**
  - `palette.test.js` (contrast for every swatch in both themes);
  - `teams-screen.test.js` (per-field writes, distinct-colour check, photo laundering, the
    IndexedDB cache key, precedence);
  - `campers.test.js` (never in `STORAGE_KEY`, `syncedSnapshot`, `backupJSON`, the restore
    body or the TV page; listener only when `canEdit()`; demotion detaches and clears;
    the denied state is local only);
  - `access-requests.test.js` (form write shape; the poll loop is bounded and attaches no
    listener; approve does create-then-delete; match-to-pending converts; decline);
  - `chat.senior.test.js` "Red" mention;
  - Worker `teamNamedIn` short names;
  - the emulator suites `campers.mjs` and `access-requests.mjs`.
- **Verify live:** the probes; a viewer account cannot see campers (a signed-in check on
  the device, and a REST call with a viewer token → denied); a test Google account
  requests access, an editor approves, the requester's screen opens by itself.
- **Rollback:** revert the code. R5 is inert. Re-paste the previous Worker.

#### S6: New-year wizard (code only; off-season only)
- **Ships:**
  - §10.3 in full;
  - the epoch handling in all three engines (§5.1 #2, §5.2.4);
  - the device-local reset on a new epoch;
  - the history drawer epoch filter;
  - the stranded-work download;
  - the hub completed.
- **Tests (`wizard.test.js`):**
  - the archive is verified before any clear (a fake-RTDB body read failure blocks
    step 4);
  - the clear batch paths are exact;
  - the epoch is set;
  - the members update excludes `OWNER_MEMBER_KEY` and pending rows unless chosen;
  - a stale device with unconfirmed old-epoch results, config and setup edits gets
    **none** applied, and they are stranded instead;
  - a device-local reset happens once per epoch, and the legacy epoch never resets;
  - Keep / Reset / Clear per section;
  - resume after reload at each step;
  - an old build receiving the cleared state adopts empties (the existing
    `applyRemoteState` missing-key behaviour).
- **Rollback:** restore the archive, selecting all sections including Scores.

#### S7: Schedule-change alerts (Worker + sw.js)
- **Precondition:** Project 1 is live (Worker deployed, `PUSH_SERVICE_URL` set, CSP
  updated, push rules published).
- **Ships:** §11.3 `cronScheduleChanges`, the sw.js `sched` kind, and the
  `PUSH_SW_VERSION` bump.
- **Tests:** §11.3, plus push-e2e with a mock phone subscribed to `supper`: move supper,
  then exactly one digest arrives after the quiet window.
- **Rollback:** re-paste the previous Worker; revert sw.js and bump.

#### S8: Tighten (R8)
- **Precondition:** for 7 consecutive days, presence shows no editor device below S3 for
  the `pushSchedule` fence, and below S2 for the config fence. The hub's "Devices" panel
  shows builds. Old viewer builds are fine: the fences block only writes viewers can't
  make anyway.
- **R8:**
  - `pushSchedule` requires an increasing `rev`;
  - optionally, `config/.validate` gains `newData.hasChild('mark')`, so a pre-S2 build's
    whole-node `set()` (which strips `mark`) is refused instead of silently clobbering.
    The emulator test is `pushschedule-fence.mjs` plus a config fence case.
- **Code:** remove the replaced builder tabs and the dead `pendingRemoteConfig` remnants.
  CLAUDE.md final pass (§12.3).
- **Rollback:** PUT the backed-up rules.

### 12.3 Per-stage housekeeping (every deploy, from CLAUDE.md)
- Bump every `?v=`, `APP_VERSION` and `CODE_UPDATED_AT`. `TV_BUILD` is bumped when the TV
  page changes. The current-standings and stalling `?v=` references are also bumped.
- `node tests/run.js` and `node --check` on every changed file. Run the emulator suites
  for any R-step, and push-e2e for any Worker change.
- Keep `CHANGES` empty, with no "What's new" banners.
- Mirror every console rules change in `database.rules.json` in the **same commit**.
- Run the live `curl` checks before calling a stage deployed.
- Update CLAUDE.md in the same commit. The new sections: "Setup data (setup node)",
  "Config engine v2", "Restore points", "Activation actions", plus updates to the files
  list, the deploy list (14 assets), the rules list and the presence shape.

---

## 13. Deferred Project-1 items: where each lands

| Item | Stage | Fix | Pinned by |
|---|---|---|---|
| scoring#3: week-builder whole-config `set()` from a stale copy, and no first-pull gate | **S1** | Config engine v2 (§5.2): `configReady`, transactions applying id-keyed field ops to the server's current value, rebase on receipt, a persisted baseline with three-way merge, field-diff game saves, deleted-meanwhile dialog | `config-sync.test.js` |
| scoring#6, the saveGameDraft half: format change leaves bracket, draft and live | **S0** | Format change clears result, bracket, draft, live, clock and picSetup after one confirm that lists them | `settings-crud.test.js` |
| rules#5: owner row offers controls the rules refuse | **S0** (drawer), **S5** (People) | `OWNER_MEMBER_KEY` treated like self; "Managed in the Firebase console" | `owner-row.test.js` (constant == rules literal, both roots) |
| pages#3: TV listeners have no cancel callback | **T** | Cancel → denied overlay → reload in 5 s | `tv.test.js` |
| pages#5: TV counts orphaned results | **T** | `liveGameIds` filter in `computeStandings` | `tv.test.js` |
| pages#6: TV treats phone accounts as signed out | **T** | `identityKey` rule (email key or phone) | `tv.test.js` |
| Two tabs of the same camp can erase each other's unconfirmed edits | **S1** | Web Locks writer election, read-only second tab, BroadcastChannel fallback | `tablock.test.js` |
| `.danger-link` (and other danger *text*) dark-mode contrast | **S0** | `--color-danger-text` everywhere it is text; dark value ≥ 7:1 | a contrast unit test on the token values |
| Senior "Red" short-name mention gap (client claims it; the Worker can't verify) | **S5** | Short names stored in `setup/teams/<tid>/short`, read by the Worker's `campTeams`; `teamNamedIn` accepts the short name as a whole word | `push-worker.test.js`, `chat.senior.test.js` |
| (found while mapping) Tue/Thu duplicate .ics UIDs; cross-camp UID collision | S0 / **S3** | Index in UID (S0); block-id + week + camp UID (S3) | `ics.test.js` |
| (found) Games shown under the wrong block or none (senior Afternoon, junior Team Skits) | **S4** | Explicit `blockId` with the A2 mapping table | `games-blocks.test.js` |
| (found) Builder "Back" leaves a zombie dirty draft that freezes sync and auto-reload (B1) | **S0** | Confirm and clear | `settings-crud.test.js` |
| (found) `deleteGame` / `pruneOrphanedGameData` leak `clocks[gid]` | **S0** | Delete it too | `settings-crud.test.js` |
| (found) Backup omits notice, meta and clocks; import has no camp check (B9) | **S2** | v3 backup and import (§6.4) | `backup.test.js` additions |
| (found) `normalizeSyncedState` resurrects 2026 names and counselors | **S0** (gate), **S6** (takes effect) | Legacy-epoch only | `wizard.test.js` |
| (found) Hard-coded July-2026 double window, banner copy, Friday finale | **S3** | `setup/meta.double`, `finaleDow`, generated copy | `seed.test.js` (legacy epoch keeps the 2026 constants; a new epoch computes the window) |

---

## 14. Test plan, consolidated

**Harness additions (S0):**
- `tests/fake-rtdb.js` (§12.2 S0);
- `makeContext({camp, seeded})`, which pre-loads `buildSeed(CAMP)` as the setup tree from
  S3, so **every existing week, push and chat test also runs against seeded data**: one
  extra runner pass per camp;
- `tests/fixtures/legacy-builder-v183.js` (S4).

**New unit files, by stage:**

| Stage | Files |
|---|---|
| S0 | `accessors(.senior).test.js`, `bracket.test.js`, `settings-crud.test.js`, `owner-row.test.js` |
| T | `tv.test.js` |
| S1 | `config-sync.test.js`, `teams-sync.test.js`, `tablock.test.js`, `undo.test.js` |
| S2 | `setup-sync.test.js`, `restore.test.js`, `presence.test.js`, `checklist.test.js` |
| S3 | `seed(.senior).test.js`, `schedule-edit.test.js`, `ics.test.js`, push additions |
| S4 | `games-blocks.test.js`, `bracket.senior.test.js` |
| S5 | `palette.test.js`, `teams-screen.test.js`, `campers.test.js`, `access-requests.test.js` |
| S6 | `wizard.test.js` |
| S7 | `push-worker.test.js` additions |

**Changed on purpose** (each listed in its stage's commit message):
- `sync.test.js:344`, `sync.test.js:355-372`;
- `sync-merge.test.js:132-147`;
- `week.senior.test.js:105-115`;
- `rules.test.js:37-44` plus the new-node assertions.

**Never changed:** `tests/camps.test.js` and `tests/fixtures-junior-week.json`. The
constants stay; that is the guarantee.

**Emulator** (opt-in, npm + Java): `setup-compat.mjs`, `restore.mjs`, `campers.mjs`,
`access-requests.mjs`, `presence-compat.mjs`, `pushschedule-fence.mjs`. Each prints
SAFE/UNSAFE for the old and new rule files. **They are a gate for every R-step.**

**push-e2e:** re-run for S5 and S7 (Worker changes).

**Playwright pass per stage:**
- before/after screenshots at fixed `?now=` values (banner, schedule sheet, follow card,
  verse, cleanup, electives) for both camps;
- the hub at phone width (390 px) and laptop width;
- light and dark themes, because of the palette.

**Manual live checks:** listed per stage in §12.2. The two-laptop concurrency check and
the airplane-mode reload check are mandatory for S1 and S3.

---

## 15. Risks and mitigations

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | An old cached **editor** build renders a `kind:'four'` bracket and crashes (`renderBracketSummary` null deref, verified by probe in the games map) | Low / high (blank game screen) | Fleet-gated Start (presence `v`), senior-only exposure, auto-reload, and a rollback procedure that clears 4-team brackets before reverting |
| R2 | Config transaction subtleties: a `null` first call, contention retries on a 17 KB node, `applyLocally` events re-entering `applyRemoteConfig` | Med / med | The transaction function is pure over `cur`; `null` means seeding the local tree. Retries are bounded by the SDK. The `applyRemoteConfig` rebase is idempotent. The fake RTDB simulates contention. If needed, the fallback is the same ops via `update()` of the whole array (still old-client-shaped). |
| R3 | A consumer missed in the accessor conversion keeps reading a constant, and diverges after edits | Med / low–med | §8.2 is an exhaustive grep list. An S3 test greps app.js, chat.js and push.js for direct reads of the constants outside the accessor block, and fails on any new one. |
| R4 | The ancestor-`.validate` hole lets a per-field write create a partial block or verse | Med / low | Client drops field ops on missing records (§5.3.5); the normalizer hides partials (§4.7); `setup-compat.mjs` documents the behaviour |
| R5 | Owner deploys code before the R-step, or skips the probes | Med / low | Every new listener degrades itself with a clear hub message (M5). Emulator "new client under old rules" proofs. The R-step runbook sits in the stage's commit message and in CLAUDE.md. |
| R6 | Old builds keep whole-`set()`-ing config until they reload, clobbering S1 users' edits | Low (auto-reload) / med | The off-season rollout; the presence "Devices" list; the optional S8 config fence |
| R7 | The first setup-based publish changes push ids; a reminder fires twice | Low / low | Skip-if-a-block-starts-within-20-min rule (§11.3) |
| R8 | Camper names leak through a cache, backup, restore point, log or TV | Low / **high (minors' PII)** | Editor-only rules at a dedicated node; never in `STORAGE_KEY`/`SYNC_KEYS`/backups/restore bodies; listener only for editors; demotion wipes; `campers.test.js` asserts every exclusion; a rules test forbids any other `camper` node |
| R9 | Spark budget: config transactions fan 17 KB per commit; restore points and photos | Low / med | §4.6 numbers (about 2% of the month per setup weekend); no listeners on restore and photo nodes; IndexedDB photo cache |
| R10 | Refactoring breaks the sync invariants' tests (about 1,200 lines that reach into globals) | Med / high | The state engine is barely touched (three changes, §5.1). The new engines are separate files with their own tests. |
| R11 | Live remote edits fight focus in the rebuilt screens | Med / med | Per-container `setHtmlIfChanged` plus the focus guard (§5.8); data applies immediately, render is deferred |
| R12 | Two directors run the wizard, or one runs it while another scores | Low / high | Wizard soft-lock (`wizardBy`); the off-season gate; the presence check before step 4; verified archive |
| R13 | Seeding during a live week surprises someone | Low / med | M9 gate with explicit override; fidelity tests guarantee identical output; Pause switch |
| R14 | "Every day like it" changes days the director didn't expect | Med / low | The dialog names the days that change and those left alone; one undo entry; auto restore point |
| R15 | Stranded offline work at a year boundary is discarded | Low / low | It's last year's; kept locally for download; old builds still ask (36 h confirm) |
| R16 | Walk-up spam (any Google account can write one row per camp) | Low / low | One row per identity, 60 s re-send throttle, 60/200-char caps, editor delete; requests never become members automatically |
| R17 | Rolling back S3 code after junior has been edited shows last year's built-in schedule | Low / med | Prefer Pause or a fix-forward; rollback notes say so; restore points keep the edited data |
| R18 | iOS PWA storage eviction loses `_setupBase`/`_cfgBase` | Low / low | Same as `_syncBase` today: a missing base means a plain adopt; unsent edits since the last open are lost (documented, same as scores) |

---

## 16. Decisions only the owner can make

1. **D1 Camp dates for 2027, both camps.** These set the freeze windows (M9) and the
   wizard's suggested Sunday. Is any camp week running before June 2027?
2. **D2 The manual steps:** four rules PUTs (S2, S3, S5, S8) and two Worker pastes (S5,
   S7), in that order. Is this acceptable, and who runs them?
3. **D3 Rehearse on senior first?** Seed senior and run a full fake week (schedule edits,
   a 4-team bracket, the wizard) before touching junior.
4. **D4 Push go-live timing.** Go live with phone alerts **after** S3 (recommended, so no
   fence is needed) or before (then the R8 pushSchedule fence is needed soon after S3).
5. **D5 Edit model.** Live edits with undo and restore points (recommended), or a
   draft/publish step like the Notice has?
6. **D6 Campers.**
   - An "absent" toggle?
   - Cleared by the new-year wizard (recommended: yes)?
   - Included in the editor-only archive (recommended: no)?
   - Any display beyond the People screen, such as a print-a-team-sheet (recommended:
     not in this project)?
7. **D7 Walk-ups.**
   - Approve as counselor (viewer) by default?
   - Push a director alert for each request?
   - Should requests expire after camp week?
8. **D8 Team photos.**
   - JPEG painted on the team colour (no transparency) acceptable?
   - Do uploaded photos replace the shipped junior shields?
   - Is about 58 KB per team acceptable?
9. **D9 Palette.** A fixed curated set of 12 (recommended), with colours forced distinct
   within a camp?
10. **D10 Double points.**
    - Keep "verse/custom bonuses double inside a window" (default Thu 5 pm → Fri
      midnight relative to the camp Sunday) plus per-game Messtival?
    - Should a game created on a double day default to Messtival?
11. **D11 TV finale day** per camp (default Friday).
12. **D12 The 4-team bracket.**
    - Pairing by standings 1v4 / 2v3 (default), free pick, or fixed?
    - 3rd-place match before the final?
    - Which senior games become tournaments, with which live-tracker settings?
13. **D13 Senior bookend days.**
    - The real Sunday arrival and Saturday send-off?
    - Is an "off" day kind needed?
    - Senior has historically run Fri→Sat. Is it now firmly Sun–Sat?
14. **D14 Names.** Are Sofia/Sofie, Lily/Lilly and Alysa/Alyssa the same people? This
    decides the one-time clean-up in Electives and People.
15. **D15 Archive scope and restore policy.**
    - Chat history archived or just left?
    - 30 automatic restore points per camp?
    - May every editor restore?
16. **D16 Schedule-change alerts.**
    - Which changes alert (time moved, removed, added, renamed)?
    - Over what horizon (now → end of tomorrow)?
    - One digest per phone?
    - Do they obey the per-block subscriptions only, or also the "director alerts" opt-in?
17. **D17 Date awareness.** Should the Happening-Now banner know the camp dates ("Camp
    starts Sunday" / hidden after send-off)? The default here is no (byte-identical); it
    would be a small follow-up.
18. **D18 Senior meal tag.** Should senior's "Supper and free time" be tagged as supper
    (then it gets a menu and a cleanup note)?
19. **D19 Electives.** Assignments are always staff, never campers. Keep keying them by
    first name, with a link to the member list for spelling checks?
20. **D20 New year.** Clear every counselor's team assignment by default? The owner row is
    always untouched.
21. **D21 Team slot repair.** Is a tool to repair non-`t0..tN` team ids needed? If the
    live data is clean, it can be dropped.
22. **D22 Fences (S8).** Turn on the pushSchedule fence when the device list is clean?
    The optional config fence too?
23. **D23 Two tabs.** Is a read-only second tab (with "Use this tab instead") the right
    behaviour on the laptop?

---

## Appendix A: change list by file

| File | Stages | Change |
|---|---|---|
| `app.js` | S0–S6 | Accessors (§8); `OWNER_MEMBER_KEY`; legacy gating; S1 config engine v2 (replaces `pushConfig`/`applyRemoteConfig` internals, adds `configReady`/`pendingConfigWrites`/`_cfgBase`); teams per-field diff; writer lock; failure indicator; presence two-step write; epoch checks; `clearLocalData` gains `campScoreboardUndo`, `campScoreboardEpochSeen`, `campScoreboardStranded`; bracket kinds and helpers; `gamesForBlock` readers |
| `settings.js` | S0, S1, S4 | B1, scoring#6, clocks leak; field-diff saves and resolve-by-id handlers; Games screen by block and "When" picker; tabs retired in S8 |
| `setup-sync.js` (new) | S2+ | Setup engine, `normalizeSetup`, `buildSeed`, A1/A2, restore-point read/write, publisher hash |
| `setup-ui.js` (new) | S2+ | Hub, checklist, wizard, Schedule/Meals/Verses/Cleanup/Electives/Week/Teams/People/Backups screens, `askDialog`, presence chips |
| `camps.js` | S5 | `TEAM_PALETTE` (shared). **No existing constant changes.** |
| `chat.js` | S0, S5 | Mention dictionary via `teamShort`/`teamCounselorNames` |
| `push.js` | S0, S3 | `scheduleWeek()`; publisher from setup with `rev`/`src`; the drawer's week line becomes read-only |
| `push-worker/worker.js` | S5, S7 | Short names in `campTeams`/`teamNamedIn`; `cronScheduleChanges` |
| `sw.js` | S7 | `sched` kind; `PUSH_SW_VERSION` bump |
| `current-standings.html` | T, S3, S5 | `?camp=`, camps.js/defaults.js load, pages#3/#5/#6, setup meta and teams, null-safe crests, finale day |
| `stalling.html` | T | Camp toggle on the TV link; team-count copy |
| `index.html` | S2+ | Two new script tags (14 `?v=` assets); denied-screen "Ask to join" markup (S5) |
| `styles.css` | S0, S2, S5 | Danger text token; hub, screens and dialog styles; `--team-accent-l/-d` theme switch |
| `database.rules.json` | S2, S3, S5, S8 | §7.2 |
| `tests/*` | every stage | §14 |
| `CLAUDE.md` | every stage | §12.3 |

## Appendix B: the owner's runbook for each R-step (copy-paste, Cloud Shell)
```
# 0. Back up what is live now
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://camp-89cea-default-rtdb.firebaseio.com/.settings/rules.json" > rules-backup-$(date +%F).json
# 1. Fetch the new reviewed file from the live site (deployed with the stage's commit)
curl -s -o rules.json https://camp.patricksimpson.info/database.rules.json
# 2. Publish
curl -X PUT -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  --data-binary @rules.json "https://camp-89cea-default-rtdb.firebaseio.com/.settings/rules.json"
# 3. Read back and compare (must print nothing)
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://camp-89cea-default-rtdb.firebaseio.com/.settings/rules.json" | diff - rules.json
# 4. Probes (each must say Permission denied) — both roots
for r in campScoreboard seniorScoreboard; do for p in setup teamPhotos campers restoreIndex restoreBody accessRequests; do
  curl -s "https://camp-89cea-default-rtdb.firebaseio.com/$r/$p.json"; echo " <- $r/$p"; done; done
```
**Order within a stage (two commits):**
1. **Rules commit:** `database.rules.json`, `tests/rules.test.js` and the emulator suites
   only. The browser never loads the rules file, so this needs no `?v=` bump and changes
   nothing for any device. Push it, then run the runbook above (it fetches the file from
   the live site).
2. **Code commit** (the C-step), after the probes pass.

If the order is ever reversed, nothing breaks: §7.3 shows every new-client-under-old-rules
case degrading to a hub message. The order exists only so nobody sees that message.
Fences (R8) are the exception: publish only after the device list is clean.
