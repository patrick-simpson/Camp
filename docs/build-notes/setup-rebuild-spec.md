# Project 2 — Setup rebuild: the unified spec

Status: **final unified spec, revised after adversarial review** (three reviewers — sync,
security, director experience — 48 findings; every decision and reason is in the **Review log**
at the end). Written by the spec lead on 2026-10-27 against `main` @ `63005d9`
(`APP_VERSION = 183`, `node tests/run.js` = 436 passing). `CLAUDE.md` stays authoritative on
anything this spec does not change. Line numbers are `file:line` at that commit. Review finding
ids are cited inline as `sync-F#`, `sec-F#` and `ux-R#`.

**Updated 2026-10-27 with the owner's answers.** All thirteen questions in §17.1 are answered and
§17.1 is now the record (§1.4 lists what each answer changed). Four answers differ from the
recommendations that had been applied: **both camps roll out together** (no senior-first trial);
the **new-year setup and the edited-here / original-week switch are owner-only**, enforced in the
database rules and in the app; senior's **arrival and send-off days keep their sample schedules**
for now; and the **counselor spellings merge to Sofia, Lily and Alyssa** (`camps.js` and
`tests/fixtures-junior-week.json`, stage S0k). The home-screen redesign now has its own spec,
`app-shell-redesign-spec.md`, and the integrated build order for both projects is
`BUILD-PLAN.md` (where the two disagree with this spec's calendar, `BUILD-PLAN.md` wins). The spec
was written against v183; the app is now v184, so every `file:line` below is approximate.

Sources: three competing drafts (`p2-drafts/draft-migration-first.md`,
`draft-editor-first.md`, `draft-data-first.md`) and a three-judge panel. Two of three judges
picked **migration-first** as the base; this spec starts there, takes the **editor-facing
design from editor-first**, and the **data/rules hardening from data-first**. Every
contradiction between them is resolved in §1.2, and every flaw the panel listed is mapped to
its fix in §1.3.

---------------------------------------------------------------------------------

## Plain-English summary (for the owner)

**What directors get**
- One place in the app, **Set up the week**, with a checklist that shows ✅ or ⚠️ for each
  part of camp: dates, schedule, games, teams, counselors, campers, meals, memory verses,
  cleanup rota and electives. Nothing needs a code change or a Firebase console visit.
- A **new-year wizard** in five short steps: pick the Sunday camp starts, choose what carries
  over from last year, save last year, clear the scoreboard, then finish from the checklist.
  **Only the owner can run it**, in the app and in the database rules (§1.4).
- **The schedule becomes editable.** You build one *typical day*; Monday to Friday use it.
  When you change something on a weekday the app asks **"Just Tuesday"** or **"Every day like
  Tuesday"** (and lists the days that will change). Sunday (arrival) and Saturday (send-off)
  are their own days.
- **Rain plan from a phone:** swap two items' time slots, move, cancel or add items for today,
  move games with them, then tap Done. You see a before/after list (including anything that
  now overlaps) and can tick "Tell people who get reminders".
- **Teams** keep their fixed count (junior 6, senior 4) and get a name, a short name, an emoji,
  a colour from a palette that reads well in light and dark mode, and an optional photo.
- **People:** typed counselor lists, people added later, and walk-ups who tap **Ask to join**
  on their own phone (while a director has asking switched on, e.g. during registration) all
  land in one list by team, with a quick way to put everyone on teams. **Camper first names**
  are visible to directors only, and the database itself enforces that.
- **Senior gets the 4-team bracket:** two semifinals, a 3rd-place match, then the final.
- The **TV standings page** works for both camps, and there is a **whole-week calendar file**.

**What keeps it safe**
- **Two directors at once:** changes merge field by field, and each sees "Jenn is also here".
- **Bad Wi-Fi:** schedule, games, teams, menus, verses, rota and electives are saved on the
  phone straight away and sent when it reconnects, even if the app was closed in between.
  **These need a connection** (the button says so when there isn't one): adding or changing
  people and their access, camper names (never stored on any phone; a list you typed waits on
  screen until the signal is back), team photos, asking to join, the new-year wizard, and
  restoring a restore point.
- **Undo** covers schedule, games, teams, menus, verses, rota and electives **on the device that
  made the change**; access changes and scores keep their own tools. **Automatic restore
  points** (any director, any device) are taken before anything big, and last year is
  **archived and checked** before the new year clears the scores; the archive can't be deleted
  from the app, and **Undo the new-year setup** puts last year back exactly.
- **Deploying never changes a running week.** Nothing switches over until **the owner** presses
  **Edit the week here** for that camp (owner-only, decision Q8); **Use the original week again**
  switches back in one tap and keeps every change, so pressing **Edit the week here** again brings
  them back. Until then junior behaves exactly as it does today (one deliberate exception: the
  counselor names are spelled Sofia, Lily and Alyssa everywhere, decision Q21); right after, it still
  looks identical.
- **Both camps roll out together** (decision Q2). There is no senior-first trial run: the owner
  presses **Edit the week here** for junior and senior in one sitting, off-season, with a restore
  point per camp and the one-tap way back, after the seeded-fidelity tests and the emulator run
  have passed for both. No camp week runs before June 2027 (decision Q1), so all the risky engine
  work happens this winter and spring.

**What you will do by hand**
- **One** database-rules update (three copy-pastes in Cloud Shell from Appendix E: back up,
  publish, check), plus quick checks in a browser signed in as yourself, as another director and
  as a test counselor. The same update also carries the standings-reveal blocks from the
  redesign spec, including the one deliberately public, read-only path the big screen reads.
- **One** Cloudflare Worker paste, when phone alerts go live.
- **You press the two big switches yourself** (decision Q8): **Edit the week here** (once per
  camp, both in one sitting) and the **new-year setup** (once per camp). No other director can.
- §17.1 holds your thirteen answers (all given on 2026-10-27); nothing in this spec is waiting
  on you. Everything else has a sensible default listed in §17.2 that you can change any time.

---------------------------------------------------------------------------------

## Contents

0. Plain-English summary (above)
1. How this spec was put together: base, grafts, resolved contradictions, panel flaws fixed, owner answers (§1.4)
2. Goals, non-goals, acceptance moments
3. Ground truth: verified facts the plan must survive
4. Principles every stage obeys
5. Data model (exact paths and shapes)
6. Sync, multi-editor and offline behaviour
7. Undo, restore points, archive, backups
8. Security rules (exact blocks, publish plan, backward compatibility)
9. Accessor layer, every consumer, and the home-screen seam
10. Seeding and migration from camps.js
11. Editor screens
12. Outputs: phone-alert schedule, schedule-change alerts, TV page, full-week calendar
13. Staged build plan (per-stage tests, live checks, rollback)
14. Deferred Project-1 items: where each lands
15. Test plan, consolidated
16. Risks
17. Decisions for the owner (17.1 the owner's recorded answers; 17.2 defaults applied)
- Appendix A: team colour palette (measured)
- Appendix B: checklist status rules (`hubStatus`)
- Appendix C: UI copy glossary
- Appendix D: change list by file
- Appendix E: rules publish runbook (pasted blocks, hash-checked)
- Review log: every adversarial-review finding, decision and reason

---------------------------------------------------------------------------------

## 1. How this spec was put together

### 1.1 Base and grafts

| Layer | Taken from | What it contributes |
|---|---|---|
| Rollout discipline (base) | migration-first | Deploy ≠ activation; explicit per-camp actions with undo; games stay in `config`; config engine v2 fixes scoring#3 first; legacy-epoch pin of double points; camp-week freeze; pin-first tests; fake-RTDB harness; emulator proofs in both directions; stable alert keys seeded from `pushBlockKey`. |
| Editor experience | editor-first | Six director "moments" as acceptance; the hub with a pure status function; five-step wizard with a claim lock; schedule as typical day + per-day changes + one-offs with **[Just Tuesday] / [Every day like Tuesday]**; rain plan from the home schedule sheet; sync line, undo pill, who's-here; offline "See mine" clash sheet; measured palette; game-backfill rule measured at 47/47; walk-up polling; `seam.test.js`. |
| Data and rules hardening | data-first | Leaf-level anchor rules (refuse a field write into a deleted record); `brackets4` as its own sync key; poison-path quarantine; one atomic root update for the new-year clear; per-section "last edited" stamps; synthetic undo for lost merge conflicts; restore bodies as one JSON string; block `teams` set for the morning meeting; `pendingWritesTotal()`; TV `CAMP_FORCE` hook. |

### 1.2 Contradictions between the drafts, and how this spec resolves them

| # | Topic | The drafts said | This spec | Why |
|---|---|---|---|---|
| C1 | Where games live | MF: stay in `config` (+`blockId`/`ord`). DF/EF: move to `setup/games`, keep a derived `config` mirror, fence old writers. | **Stay in `config`.** Optional `blockId`, `ord`, `bracketSeed` per game. | No mirror, no fence, no strict game rules. Verified: `config/games` is an unvalidated branch in the rules, and v183's `toEditableDraft`/`saveGameDraft` deep-clone unknown game fields (settings.js:317-360, 716-790), so old builders keep the new fields. Cost: ~17 KB fan-out per config commit (§5.12). |
| C2 | How the schedule is stored | MF: materialized per-day blocks with a computed `tpl` link. DF/EF: one template + sparse per-day changes + one-offs. (Judge 1 suggested mapping the EF screens onto MF's materialized blocks.) | **Template + per-day patches + per-day one-offs** (EF shape, §5.2), behind MF's activation switch. | The owner's "just this day / every day like it" maps one-to-one. Two editors stay safe: an edit to the typical day and a "just Tuesday" edit write different paths, so both survive with the intended meaning; under the materialized model "every day like it" rewrites Tuesday's block and can overwrite a concurrent Tuesday-only edit. Cancel becomes a reversible `off` patch. Two drafts measured the round trip as lossless for both camps. |
| C3 | Team branding | MF: `setup/teams`. DF: optional fields inside `state.teams`. EF: `setup/teams` plus a derived `state.teams` mirror. | **Optional fields inside `state.teams`** (`short`, `emoji`, `color`, `photoV`), diffed per `teams/<i>/<field>`. | No mirror (EF's mirror depended on the async member directory and would ping-pong). Verified: old clients adopt `remote.teams` wholesale (app.js:2608) and the classic Teams tab edits objects in place (settings.js:1040-1055), so extra fields survive. The Worker already reads `state/teams` (worker.js:1689), so the senior "Red" fix needs no extra read. |
| C4 | 4-team bracket storage | MF/EF: `kind:'four'` under `state/brackets/<gid>`. DF: new key `state/brackets4`. | **New sync key `brackets4`.** | Verified hazard: a v183 editor that renders a non-6-team object under `brackets` runs `normalizeBracket` (sets `phase:'round1'`, app.js:6225) and `renderBracketRound1` then writes `phase='bye'` and `saveState()` to everyone (app.js:6951-6955). Old builds never read an unknown key. Needs the `state/brackets4` rule published first (state is sealed). |
| C5 | Switching a camp to shared data | MF: `meta.seededAt` + `paused`. DF: `meta.live` + section markers. EF: `meta.on.<section>`. | **`setup/meta/on/<section>`** per section, shown to directors as **Edit the week here** / **Use the original week again**. | Per-section flags define "absent means empty" (the RTDB sentinel problem) and let each stage cut over one area. No jargon (A1/A2/A3) reaches directors. |
| C6 | Which node owns "competition days" | MF: `config.days` and `setup/days` both, "hub flags mismatches". EF: `setup/days.competition`. DF: `setup/days.kind`. | **`config.days` is the single authority** for competition-day tabs (`id,name,dow,note`). `setup/days` holds only schedule facts (`typical`, `tag`, `placeholder`). | One owner per fact. Old builds and the TV keep reading `config.days`; an old builder's Days-tab edit is simply the truth. Attaching a game to a block on a day with no tab creates the tab in the same config commit (§10.3). |
| C7 | Schedule-change alert transport | MF: Worker cron diffs automatically. DF: editor-triggered `/notify` with an alert flag. EF: client-written `pushChanges` text. | **Editor-triggered `/notify` kind `schedule`** carrying `{alert, ids}`; the Worker derives every word from the published schedule and a **per-block "last told" baseline** (§12.2). | Judges 1 and 3 preferred `/notify` (own CPU/subrequest budget, immediate "Sent to 23 phones" feedback). The per-block baseline fixes the race both other transports had (one editor's quiet save swallowing another's alert). Offline edits keep only the intent and re-ask on reconnect (EF). Client text is never sent (CLAUDE.md "the sender trusts nothing a member wrote"). |
| C8 | Quarantine for refused writes in `pushState` | DF/EF: bisect + surface. MF: visible indicator only, control flow untouched. Judges 2:1 for quarantine. | **Quarantine in `pushState` too**, but only on `PERMISSION_DENIED`, as its **own deploy**, off-season; the network-error path is byte-for-byte unchanged (§6.2). | Today a refused path wedges *all* score sync forever with only `console.warn` (app.js:2925-2931). Judge 3's concern (changing the engine under every score write) is met by isolating the change and pinning the network path with tests. |
| C9 | "Jenn is also here" | MF/DF: optional `where`/`v` on presence rows. EF: a separate `editing` node. | **A separate editor-only node `editorsHere/<memberKey>/<deviceId> = {at, v, where?}`** (EF's shape), written only by editor devices; presence stays `{at}`. *(Changed in review, sec-F7.)* | Presence is member-writable and every device listens to it, so `where`/`v` there could be forged by a counselor and would be streamed to ~40 phones. The new node is editor-read/editor-write, key-pinned to the writer, and only editor devices listen. Presence and its rules don't change at all. |
| C10 | Number of rules publishes | MF 4, DF ~7, EF ~8. | **One combined additive publish (R1)** before the first stage that needs it; one **optional** fence later, only with evidence and owner sign-off. | Judges 2 and 3 asked for the fewest hand steps. Every new node is inert until code uses it; CLAUDE.md's "don't add a path before its feature" policy is reworded (§8.6). |
| C11 | Fences against old builds | MF: config `mark` fence + `pushSchedule` rev fence. DF: config mirror fence + rev fence. EF: rev fence. | **No required fence.** No config fence at all (config `mark` dropped). The `pushSchedule` rev fence is optional (§8.6 F1). | Presence is ephemeral and can't prove an old build is gone (judge 3). Keeping games in `config` removes the reason for a config fence. Push is dormant today (`PUSH_SERVICE_URL = ''`, push.js:37), so no shipped build publishes a schedule; the hub detects a rev-less republish if it ever happens. |
| C12 | Rain plan commits | EF: each tap is an atomic commit. DF: staged panel, one Save. | **Staged panel** with a Done summary: one atomic commit, one undo step, one alert choice. The draft is persisted on the device **with the value each staged field had when it was staged**, and Done is a three-way compare (§11.6). | Judges 1 and 2. A plan is coherent only as a whole; other editors see it at Done. The stored base stops a long-open plan from silently undoing a colleague's later change (sync-F4). |
| C13 | When to ask the scope question | DF: first time per session. EF: every time. | **Every typical-linked save** shows two equal buttons, **[Just Tuesday] / [Every day like Tuesday]**, with a live caption naming the days that will actually change. | Judge 1. A remembered choice is an invisible mode. Wording from ux-R14. |
| C14 | Wizard | MF: 8 steps, cleared via separate engines. EF: 5 steps, not atomic across nodes. DF: one atomic commit. | **5 steps** (EF); week settings, teams, people and campers become hub tasks; the clear is **one atomic root update** (DF) after a verified archive. | Short wizard; nothing half-done. |
| C15 | Archive storage | MF: pinned restore point. DF/EF: separate `archive` node. | **A pinned restore point of kind `archive`** (no extra node). | Same shape, fewer rules. |
| C16 | Undo of member/role changes | EF: undoable. DF: not undoable. | **Not undoable.** The screen says so. | Security-relevant writes keep their own confirms (judge 3). |
| C17 | Camper names on devices | DF: cached with a persisted base. EF/MF: memory only. | **Memory only, online-only editing.** | Owner asked for rules-level privacy of minors' names. |
| C18 | Team photo format | MF: JPEG painted on team colour. DF/EF: PNG or JPEG. | **PNG (if transparent) or JPEG**, ≤ 100,000 chars (target ≤ 70,000). | Transparent shields must work in dark mode. Cap lowered in review (sec-F10) for the download budget when a phone can't cache. |
| C19 | Elective people keys | MF/DF: name slug. EF: member key, or `n-<slug>` for typed names. | **EF.** | Ends name-spelling joins going forward (the three known pairs are merged once, in S0k, decision Q21). Seeds stay `n-<slug>` (deterministic). |
| C20 | Day keys | MF/DF: `sun..sat`. EF: `d0..d6`. | **`sun..sat`.** | Readable in the console and in rules; never numeric (RTDB array coercion). |
| C21 | Double points | DF: window not seeded. EF: relative to `weekStart`. MF: legacy epoch pinned to the constants. | **MF pin**, plus a relative window that applies only under a wizard-created epoch. | `bonusCountsDouble` is retroactive by timestamp (app.js:289-293). Setting next year's dates early must not re-score summer 2026. |
| C22 | Epoch / archive ids | Various. | Epoch `w<YYYYMMDD>` of the new week's Sunday (legacy = absent). First archive id `rp-archive-pre-<YYYYMMDD>`. | Junior has no `weekStart` today. |
| C23 | TV page sharing code | DF: load `week-data.js` (needs app state). EF: embedded seed tables. MF: load `defaults.js` + `camps.js`. | **`defaults.js` + `camps.js` + a new pure `camp-core.js`** (double-window maths, DST conversion, standings core). | No app state needed; removes the duplication behind pages#5. |
| C24 | "Skip republish if a reminder is imminent" on the id change (MF R7) | MF: keep. Judge 1: keep. Judge 3: wrong. | **Dropped.** | Verified: the Worker walks a time window (`cronWindow`/`dueBlocks`, worker.js:511-542) with no per-block sent marker, so new ids cannot re-send a reminder already due. |
| C25 | Config transaction details | MF: `applyLocally=true`, `cur ? … : {}`. | `applyLocally = false`; the update function **aborts on `null`** (§6.3.3). | A `null` first call would otherwise commit a partial config. With the listener attached (gated on `configReady`) the SDK has the node cached, so `null` means the node really is gone. |
| C26 | Morning-meeting team names in labels | DF: block `teams` set. EF: rename-ripple prompt. | **`teams` set** on the block; label tail rendered from team emoji + short name. | A rename updates every label; alert keys don't move (they use the label head). |
| C27 | Web Locks for viewers | MF: viewers lock too. | **Editors only.** | Viewers have no unconfirmed edits to protect (judge 1). |
| C28 | What `pendingWritesTotal()` gates | DF: everything including `canAdoptRemote`. | Reload, sign-out, camp switch, flush and the wizard. **`canAdoptRemote` stays about `state`**; the wizard's root update counts as a state write. | A setup write in flight doesn't make a scores snapshot unsafe to adopt. |
| C29 | Scope trims | EF included a whole-week 7-column view, live dual-theme follow-card preview, Find-a-camper, camper "absent" toggle, Happening-Now naming games, an `editing` node, multiple templates. | **Cut or deferred** (judge 2). | Owner's confirmed list only. Hold-to-confirm is kept for exactly two actions (clear scores; restore with scores) with an accessible two-tap alternative. |

### 1.3 Every flaw the panel listed, and where it is fixed

| Flaw (judge) | Fixed in |
|---|---|
| Double points re-scored when the window moves (J1, J2, J3) | §5.7.3, §9.2 `doubleWindow()`, §10.5, §12.3 (TV mirror), test in §15 |
| EF `canAdoptSetup` ignored the unsent 300 ms push (J1) | §6.4.5: adoption gated on in-flight writes **and** unsent local ops are rebased onto the adopted tree |
| EF `state.teams` mirror from async directory (J1, J3) | No mirror (C3) |
| DF game `day` field corrupted by `migrateState` (J1) | Games stay in `config`; new fields are `blockId`/`ord`; test asserts no code path writes `day` (§15) |
| DF rules slips: `where` regex `/`, `edited.at === now` vs local estimate, `members.name` tightening, config fence (J1, J3) | `where` vocabulary has no `/` (§6.7); stamps are added at push time as `ServerValue.TIMESTAMP` and excluded from diffs (§6.4.3), and the rules accept an **unchanged** stamp so whole-node writes still pass (§8.2); no members change (§8.4); no config fence (C11) |
| DF walk-up team select unreadable for non-members; no throttle; no polling (J1, J2, J3) | Free-text note, a 60 s throttle that can't be bypassed by leaf writes or delete-and-recreate, a block list, closed unless a director opens asking, `once()` polling (§11.18, §8.2) |
| Camper names cached / in undo (J1, J2, J3) | Memory-only; undo for campers memory-only; `setItem` scan test (§5.9, §7.1, §15) |
| MF transaction `applyLocally` and `null` cur; config seed before first snapshot (J1, J3) | §6.3.3–6.3.4 |
| Fleet gates on presence rows with no role / ghost rows (J1, J3) | No hard fleet gates remain (brackets4 removes the bracket gate). The Devices list is a soft hint resolving roles via `memberDirectory`, with a 10-minute age filter (§6.7) |
| Auto change-alerts with no opt-out and shared cron budget (J1, J2) | Explicit choice; own `/notify` invocation; per-block baseline at `pushServer/schedSeen/<camp>`, cleaned by `cronMaintenance` (§12.2) |
| Wizard not atomic across nodes (J1, J2, J3) | One root update after a verified archive; `pendingWritesTotal() === 0`, writer tab, online (§11.3, §7.3) |
| Dual authority for days (J1, J3) | C6 |
| Web Locks transient failure after reload (J1, J3) | 1.5 s retry window, fail open, editors only, tested with stubbed locks and reload ordering (§6.9) |
| `pushSchedule` facts: push dormant; `rev` never written; fence could refuse P1 builds (J1, J2, J3) | §12.1, C11 |
| `weekStart` unset everywhere (J1, J2) | §10.6 defines the unset behaviour for every consumer |
| Staging honesty: consumer rewiring is the biggest change (J1, J3) | Stage S1 is a no-op refactor with `===` parity, the 10,080-minute banner fuzz, and `seam.test.js`; off-season (§13) |
| Unspecified items in the base: `mark` tests, member-undo UI, restore vs epoch, CLAUDE.md updates, fixture untouched (J1) | `mark` dropped; §7.1 UI text; §7.2 "restore never writes epoch"; §13.3 housekeeping; §15 "never changed" |
| Presence `set({at})` wipes extra fields (J2) | Moot since review: presence gains no fields; "also here" lives in the editor-only `editorsHere` node (§6.7) |
| Archive id when no `weekStart` exists (J2) | C22 |
| Strict `setup/games` rules (J2, J3) | C1 |
| Derived mirrors and their write ownership (J2, J3) | Only one derived copy remains (`pushSchedule`): deterministic content, `rev` by transaction, author-triggered (§12.1) |
| In-place 4-team bracket corrupted by old editors (J2, J3) | C4 |
| Stage sizes; state-engine changes bundled (J2, J3) | One state-engine change per deploy; S0 is eleven separate commits (§13) |
| DF notice per-field diff could merge two halves (J2) | `notice` stays a whole-written singleton (§6.2) |
| MF copy-vs-link semantics; cancel deletes the block (J2) | C2; cancel is an `off` patch (§11.6) |
| Fences/rules on existing paths not backward compatible (J2, J3) | Every rule change is additive (§8.5 table) |
| Scope creep (J2) | C29 |
| JPEG-only photos break transparent shields (J2) | C18 |
| Consumer rewiring needs parity tests + fuzz + seam test (J2) | §9, §15 |
| Fleet evidence can't prove a fence safe (J3) | C11; optional fence keyed on observed evidence plus owner sign-off |
| `pushState` control flow risk (J3) | C8 |
| MF R7 double reminder is wrong (J3) | C24 |
| EF alert items were client-written text (J3) | C7 |
| MF S0 extracted 6-team helpers too early (J3) | Moved to S6b behind pin-first bracket tests (§13) |
| No combined PUT / pre-flight diff script (J3) | R1 + the hash-checked, pasted runbook with a discriminating live check (§8.6, Appendix E) |
| Offline behaviour not explicit for photos, members, campers, wizard; "needs a connection" vs a refused write (J3) | §6.8 table; distinct UI states (§11.1 sync line) |

### 1.4 Owner answers recorded 2026-10-27, and where each one landed

All thirteen questions in §17.1 are answered (the table there is the record). Nine answers match
the recommendations already built into this spec and change nothing but their status.
**Four change the plan:**

| Answer | What changed, and where |
|---|---|
| **Q2: both camps roll out together** | No senior-first trial run. The summary, §10.1 (A1 is per camp, pressed for both in one sitting), §13.1 (activation, calendar), S2–S5a/S8 "Verify live", K2 and K5 no longer lean on senior as the canary. The safety net is the seeded-fidelity tests for both camps, the emulator seeded-tree suites, a restore point per camp, and the one-tap way back. Live checks name both camps. |
| **Q8: the new-year setup and the edited-here / original-week switch are owner-only** | App: the controls are shown only to the owner key; every other director reads the same sentence with the owner's name (§11.2, §11.3, Appendices B and C). Rules: new macros `OWNER` / `OWNERKEEP` (§8.1) on `setup/meta/on/*`, every `setup/meta/wizard` leaf, `setup/meta/{epoch,epochAt}` and `state/meta/{epoch,epochAt}` (§8.2, §8.3), and on creating `archive` / `pre-wizard` restore points. Restores never write the switches or the epoch (§7.2); **Undo the new-year setup** is owner-only (§7.3). New: moment M7 (§2.3), `owner-only.mjs` and `owner-only.test.js` (§8.8, §13.2), risk K23 (§16). |
| **Q11: senior's Sunday and Saturday keep the sample days for now** | The seed still marks them `placeholder: true` (it is true), but the hub shows a quiet info line, never a ⚠️ (§10.2, Appendix B). Nothing nags until a director replaces them. |
| **Q21: Sofie/Sofia, Lilly/Lily and Alysa/Alyssa merge to Sofia, Lily, Alyssa** | New stage **S0k** (§13.2): `camps.js` and `tests/fixtures-junior-week.json` change once, in one commit, before any id is derived from a name (S5a) and before phone alerts go live. "Junior is byte-identical" now means "apart from those three spellings" (P11, §3, §10.5). A small alias table keeps data already out there matching. The Electives "same person?" hint stays as a general helper; the three known pairs never need it (§11.13). |

**What "owner-only" covers (Q8).** The owner is the one sign-in the rules already treat specially
(`patricksimpson,fx@gmail,com`: immutable, and the permanent break-glass). No new role is added and
the member record's shape is unchanged. The owner-only acts are **Edit the week here** (A1: any
section, the first time or switching it back on), **Use the original week again**, the Advanced
per-section switches and **Start this section again from the original**, **Start the new-year
setup** (A3) and **Undo the new-year setup**. Everything else stays with every director: Camp week
dates (outside a due new year), Schedule, rain plans, Games, Teams, People (including the asking
switch and approvals), Campers, Meals, Memory verses, Cleanup rota, Electives, Notice board,
restore points (creating one, and restoring with or without scores) and phone-alert publishing.

**Honest limits** (same spirit as the own-team guard in CLAUDE.md):
(a) Rules can't tell which feature wrote a deletion, so a director can still clear scores the way
editors always could. What the rules pin is the *new year itself* (the epoch pair, the claim, the
archive points) and the *switch* (`on`): the wizard can't commit without writing the epoch and A1
can't commit without flipping `on`, and both are single atomic writes that refuse as a whole.
(b) RTDB doesn't evaluate `.validate` on deletes, so a non-owner director with console-level access
could delete an `on` flag, the claim or an epoch key. The app never does; deleting `on` has the same
effect as **Use the original week again** (the owner presses Edit the week here again); and
`owner-only.mjs` records what the emulator actually does rather than assuming it.
(c) **Start this section again from the original** re-seeds with ordinary section writes, so its
gate is the app only.
(d) Ownership is an email identity: the owner signs in with Google (a phone sign-in is never the
owner).

**The redesign.** `app-shell-redesign-spec.md` (Now · Games · Chat · More, the standings reveal,
jelly motion) is the second project. Where the two touch (the one rules publish, the TV page, the
accessor seam, the More tab's Director section, the wizard's clear list, the `?v=` list) §8.6,
§9.4, §11.1, §11.3 and `BUILD-PLAN.md` say how.

---------------------------------------------------------------------------------

## 2. Goals, non-goals, acceptance

### 2.1 Goals (each traced to the owner interview)

| # | Goal |
|---|---|
| G1 | All editors can set up a camp: laptop for the big setup, phone mid-week, several at once. No new role. Two switches are the owner's alone: the new-year setup and the edited-here / original-week switch (§1.4). |
| G2 | A new-year wizard (copy last year → archive last year → clear scores), run by the owner only, and a checklist hub with ✅/⚠️ per section. |
| G3 | The week is always Sun–Sat; setup asks "which Sunday does camp start?", and that answer is the single source of truth for every date-dependent output. |
| G4 | The schedule becomes editable synced data: one typical day used Mon–Fri, per-day one-offs ("just this day" vs "every day like it"); arrival and send-off are their own days. |
| G5 | Teams: fixed counts (junior 6, senior 4); name, palette colour (light/dark safe), emoji, optional photo. |
| G6 | People: typed roster, trickle-in and walk-ups in one team list. Camper first names per team, editor-only **by the rules**. |
| G7 | Meals, verses (+ theme), cleanup rota and junior electives become editable, seeded from camps.js. |
| G8 | Games are attached to schedule blocks; the 4-team bracket works (2 semis → 3rd-place match → final). |
| G9 | Curveballs: rain shuffles; two editors at once (per-field merge + "also here"); bad Wi-Fi (offline edits survive reload/force-quit like scores). |
| G10 | Undo and automatic restore points. |
| G11 | A mid-week schedule change can alert that block's phone-alert subscribers. |
| G12 | The TV standings page for both camps (`?camp=`) and a full-week `.ics`. |
| G13 | The deferred Project-1 items (§14). |
| G14 | Home-screen consumers read through stable accessors so the app-shell redesign (`app-shell-redesign-spec.md`) sits on top (§9.4). |

### 2.2 Non-goals
- The home-screen / app-shell redesign. It now has its own spec, `app-shell-redesign-spec.md`
  (Now · Games · Chat · More, the standings reveal, jelly motion; its own stages D0–D7). This
  project only builds the seam it reads through (§9.4); the integrated order of both projects is
  in `BUILD-PLAN.md`.
- Firebase Storage, Cloud Functions, the Blaze plan, App Check, any build step.
- A new role, or changing the viewer/editor model.
- Changing team counts (6/4 stay fixed in code).
- A live calendar subscription (`webcal:`); the export is a downloaded file.
- Parallel semifinals on two fields (`state.live` stays one match per game).
- Re-keying Pictionary by game; a server-side audit log of every setup edit (per-section
  "last changed by" stamps, undo and restore points cover the need).
- Date-aware Happening Now ("Camp starts Sunday…"), and naming games inside Happening Now:
  both belong to the redesign's Now tab (decision Q19; `app-shell-redesign-spec.md` §3).

### 2.3 Acceptance: seven moments (become the Playwright script for each stage that touches them)

| # | Moment | Device | Must be true |
|---|---|---|---|
| M1 | **The week before camp.** Patrick (the owner) runs the new-year setup for 2027 junior on a Sunday night; Jenn then works down the checklist. | Laptop, good Wi-Fi, maybe two tabs | The wizard takes him from last year to "ready" with no dead end; the checklist shows what's left; two panes on a wide screen; a second tab of the same camp opens read-only with **Use this tab instead**; Jenn sees the same checklist and every editing screen. |
| M2 | **Rainy Wednesday, 9:40.** Patrick in the dining-hall doorway; outdoor games start at 10:00. | Phone, one hand, spotty signal | From the home schedule sheet: **Change today's plan** → tap Team competitions → **Swap with…** → Elective 1 → **Swap their time slots** → tap Axe Throwing → **Move to…** → Thursday · Team competitions → Done → choose whether to alert. About ten taps, no keyboard. The tap count is measured by a Playwright script on junior Wednesday **before S5a is approved**; if it is over twelve, the panel changes, not the target. |
| M3 | **Two directors at once.** Jenn fixes Tuesday's supper time on her laptop while Patrick adds a rain game on his phone. | Laptop + phone | Both changes land; each sees "Patrick is also here". If they touch the very same field, the later one sees an inline choice, never a silent overwrite. |
| M4 | **Sunday registration.** A counselor not on the list signs in; a camper arrives late. | Counselor phone, director phone | A director has switched **Let people ask to join** on for registration. The counselor taps **Ask to join** and is told to find a director; the director's open app shows "Taylor is asking to join" at once; their page opens by itself once approved. The director adds the camper's first name in two taps (if the signal drops, the typed names wait on screen and send when it's back). Counselors can never read camper names (verified with a viewer token). |
| M5 | **Senior Thursday.** The Legacy Game is a 4-team bracket. | Phone | Two semifinals, 3rd place, final; Undo at every step; two refs recording different winners for one match can never produce medals from an impossible bracket (the bracket stops and asks for a re-check instead). |
| M6 | **Dead zone at the waterfront.** A director edits Friday's menu and the phone dies. | Phone | When it comes back the edit is still there and goes up on signal. If someone changed the same dish meanwhile, a toast says so and **See mine** offers **Use mine**. |
| M7 | **A director who isn't the owner opens Set up the week.** (decision Q8) | Phone | They see the checklist and every editing screen. Where the owner would see **Edit the week here** or **Start the new-year setup**, they read the same sentence with the owner's name ("Patrick turns on editing."). The same acts attempted straight against the database are refused by the rules (emulator-proven). |

Also checked per stage: every existing test passes, including `tests/camps.test.js` against
`tests/fixtures-junior-week.json` (changed once, on purpose, in S0k for the three counselor
spellings, then untouched); unauthenticated probes against every new node
return `Permission denied` (the redesign's `revealPublic` is the one deliberate exception: an
unauthenticated read answers `null`, a write is refused); a signed-in **viewer** gets
`Permission denied` on `campers`.

---------------------------------------------------------------------------------

## 3. Ground truth: verified facts the plan must survive

| Fact (verified at 63005d9) | Consequence |
|---|---|
| Two roots with real data: `campScoreboard/*` (junior; literal never changes) and `seniorScoreboard/*`. Rules blocks are identical modulo root (`rules.test.js:37-46`). | Every node, rule, test and probe is written once and applied to both roots. |
| Cached old builds live minutes (auto-reload, `reloadBlocked`) to days (offline phones). | Every stage assumes builds N-1 and N-2 write alongside N. |
| `config` is written as a whole-node `set()` of exactly five keys (`pushConfig`, app.js:2354; `CONFIG_KEYS` 2346) and sealed (`$other:false`). `migrateState` resets non-array `games/days/sessions` to `[]` and turns any `g.day` into `dayId` (app.js:1924-1945). `config/games` is an unvalidated branch. | Never add a top-level config key; never change those shapes; never write `day` on a game. Optional fields *inside* a game are safe. |
| The config listener seeds the catalog when the node is `null` (`if (!remote) { pushConfig(); }`, app.js:2721) and holds remote config while mid-entry (`pendingRemoteConfig`, 2724). Config has no baseline, no first-pull gate, no write accounting. | Config engine v2 (§6.3) adds all three and keeps the null-seed behaviour behind a transaction. |
| `state` is sealed to the 12 `SYNC_KEYS` (app.js:2151; rules `$other:false`). `pushState` is one atomic multi-path `update()`; a refusal re-diffs and retries the same batch forever with only `console.warn` (app.js:2895-2935). `applyRemoteState` copies a **hard-coded** key list (app.js:2619). | A new state key needs its rule first, an entry in `SYNC_KEYS`, and an entry in the 2619 list. A refused path must not wedge scores (§6.2). |
| Old clients adopt `remote.teams` wholesale (app.js:2608); the classic Teams tab edits team objects in place (settings.js:1040-1055) but "Add team" mints `t-<ts>` ids (settings.js:1069). | Extra team fields survive old builds. Add/delete teams is removed (fixed counts). |
| `normalizeBracket` defaults `phase` to `'round1'` (app.js:6225); `renderBracketRound1` writes `phase='bye'` + `saveState()` when the pool is empty (6951-6955); `renderTournament` refuses non-6 teams (6314-6324). | 4-team brackets go under a new key (C4). |
| `bonusCountsDouble`/`inDoubleBonusWindow` compare each bonus's timestamp to `DOUBLE_BONUS_START/END` (2026-07-23T21:00Z → 2026-07-25T04:00Z) at read time (app.js:280-300); `current-standings.html` mirrors it. | Moving the window re-scores history unless pinned (C21). |
| `registerPresence` does `set({at: TIMESTAMP})` on every connect (app.js:2167-2179); rules seal `$deviceId` (`hasChildren(['at'])`, `$other:false`); every device holds `.on('value')` on the whole presence tree (app.js:2712) and any member can write their own rows. | Presence is left exactly as it is. Editor-only "who's here / which build" data goes in its own editor-only node (C9, §6.7). |
| Push is dormant: `PUSH_SERVICE_URL = ''` (push.js:37). `pushMaybeRepublishSchedule` compares the published blocks to `pushScheduleBlocks(DAY_SCHEDULE)` and republishes (push.js:1087-1095); it never writes `rev`. `pushSchedule` is sealed (`$other:false`). | No shipped build can publish today. `rev`/`src` need rules first. |
| The Worker sends reminders by walking a time window per camp (`pushServer/cron/<camp>/upTo`; `cronWindow`/`dueBlocks`, worker.js:511-542), reading `pushSchedule/weekStart` and `blocks` (2132-2175). | New block ids can't double-send a reminder (C24). |
| sw.js accepts kind `block` with `open:'schedule'` (sw.js:39, 66); the Worker rewrites the body only for batches carrying `batch.block` (worker.js:1548). | A schedule-change digest can reuse kind `block` with no sw.js change. |
| Worker `campTeams` reads `<root>/state/teams` (worker.js:1689); `teamNamedIn` accepts the full name or a word of ≥ 4 letters other than "team" (`MIN_TEAM_WORD_CHARS = 4`, worker.js:128, 1677). Senior names are "Red Team" etc. (camps.js:488). | "Red" can't be verified → fix via `short` in `state.teams` (§12.2, §14). |
| Every `DAY_SCHEDULE` day in both camps is sorted by `start`; the only equal start is junior Tue/Thu movie night vs "Prepare for bed" at 21:15, where array order decides Happening Now (camps.js:206-230). | `ord` tie-break reproduces order exactly. |
| The junior morning meeting label is `head + ' — ' + joinTeamAbbrevs(group)` with `TEAM_EMOJI[id] + ' ' + TEAM_ABBREV[id]` (camps.js:173-191). | The block `teams` set re-renders it exactly (C26). |
| `tests/camps.test.js:35-51` deep-equals 20 junior constants to `tests/fixtures-junior-week.json`. | Constants stay as seed and fallback. Edited once, in S0k, for the three counselor spellings (Q21): the fixture is regenerated in the same commit and its diff is only those spellings; never edited after. |
| Light theme `--color-danger-text` = `var(--color-danger)` = `#d63b3b` (styles.css:23, 27) ≈ 4.26:1 on the page background; `.danger-link` uses `--color-danger` (styles.css:1576). | Contrast fix in S0. |
| Senior config has sessions `Morning/Afternoon/Evening` (camps.js:586). | Session derivation must handle Afternoon. |

---------------------------------------------------------------------------------

## 4. Principles every stage obeys

- **P1 Deploy is not activation.** A deploy changes behaviour only for bug fixes. New
  behaviour waits for an explicit, per-camp, undoable action by the owner:

  | Action | What directors see | Does | Undo |
  |---|---|---|---|
  | **A1** | **Edit the week here** (hub) | The first time: seeds `setup` sections from camps.js and writes `on.<section>`. A section that was on before (its `on` flag is stored as `false`) is just switched back on with its data untouched. Then attaches **unattached** games to blocks (A2). | **Use the original week again** (`on.*` false, instant, every device, data kept); the `pre-seed` restore point |
  | **A2** | (runs inside A1; the hub also offers **Put games on the schedule** whenever games lack a `blockId`, e.g. after "Reset games to camp default") | Writes `blockId`/`ord` only on games with no `blockId`, or one that doesn't resolve on the game's day; never touches an attached game. | The `pre-seed` (or a `pre-delete`) restore point |
  | **A3** | **Start the new-year setup** (hub) | The wizard: archive, then one atomic clear. | **Undo the new-year setup** (archived data and epoch together, §7.3) |

  A1 and A3 refuse during a camp week unless the editor ticks "I know a camp week is running"
  (§10.6 defines this when no week date exists).
  **A1, its undo, and A3 with its undo are owner-only (decision Q8).** The app shows these controls
  only to the owner key (everyone else reads a sentence naming the owner), and the rules refuse the
  writes that make them happen from anyone else (§1.4, §8.1 `OWNER`, §8.2, §8.3).
- **P2 New data in new places.** No new top-level key in `config`. Existing shapes don't
  change. The complete list of additions to existing nodes: optional game fields
  (`blockId`, `ord`, `bracketSeed`); optional team fields (`short`, `emoji`, `color`, `photoV`);
  `state/meta/epoch` + `epochAt`; the new sync key `state/brackets4`; optional
  `state/results/<gid>/path`; `pushSchedule` `rev`/`src`. (Presence is unchanged; see C9.)
- **P3 camps.js stays forever** as the seed and the fallback. Every reader goes through
  accessors (§9) that return the camps.js constant itself until a section is on.
- **P4 Rules are additive and published ahead of code (R1).** Every new client feature
  degrades on its own if R1 isn't live yet. Fences are never required.
- **P5 Every new listener degrades only itself** (the `chatDenied` pattern). It never
  touches `fbRef`, `fbConfigRef` or `syncDenied`.
- **P6 Offline-honest writes.** A write path either has a persisted confirmed baseline and a
  three-way first-snapshot merge (state, config, setup) or is explicitly online-only with
  the reason on the disabled control (photos, members, campers, restore, wizard, requests).
- **P7 One state-engine change per deploy**, each with its own tests, off-season.
- **P8 Camp-week freeze.** Stages marked *off-season* never deploy within ±2 days of a camp
  week. Decision Q1: no camp week runs before June 2027, so every stage that ships before then is
  off-season; the freeze starts when the dates are known. A1/A3 enforce it in the app.
- **P9 Pin first.** A stage's commit adds tests pinning current behaviour before changing the
  code they guard (settings.js CRUD and the 6-team bracket have no tests today).
- **P10 Resolve by id at commit time.** No builder handler closes over a synced object; it
  looks the object up by id/path when it commits (remote applies replace objects).
- **P11 Junior byte-identical until A1, output-identical after** (§10.5), except the three counselor spellings merged once in S0k (decision Q21).
- **P12 Camper names never leave their editor-only node**: not in localStorage, `SYNC_KEYS`,
  backups, restore points, archives, the TV page, push payloads, chat mentions or undo
  persistence.
- **P13 The Worker trusts nothing a member wrote**: every alert word comes from published,
  editor-only data.
- **P14 Every page sanitizes what it renders, with the same code.** The sanitizers live in
  `camp-core.js` (loaded by the app **and** the TV page); every database string is escaped or
  laundered before it reaches `innerHTML` or a `src`, and a stranger's text (walk-up requests)
  is treated as hostile (§9.1, §12.3, §11.8).
- **P15 Nothing strangers can write is open by default.** The walk-up request node accepts
  writes only while a director has switched asking on (§8.2, §11.8).

---------------------------------------------------------------------------------

## 5. Data model (both camps; `<root>` = `campScoreboard` or `seniorScoreboard`)

### 5.1 Where everything lives

| Node | Holds | Read | Write | Listener | Cached on device | Size (junior) |
|---|---|---|---|---|---|---|
| `<root>/state` (existing) | scores, `teams` (+ optional branding fields), notice, meta (+ `epoch`), **new key `brackets4`** | member | editor | every device (existing) | yes (`STORAGE_KEY`) | ~13 KB in camp week |
| `<root>/config` (existing, **shape unchanged**) | games (+ optional `blockId`/`ord`/`bracketSeed`), competition-day tabs `days` (the authority, C6), `sessions` | member | editor | every device (existing) | yes (`STORAGE_KEY`, + `_cfgBase`) | ~17 KB |
| **`<root>/setup`** | week meta, day facts, typical day, per-day patches and one-offs, meals, verses, cleanup rota, electives | member | editor | every device, post-approval | yes (`lsKey('campScoreboardSetupV1')`) | ~25 KB |
| **`<root>/campers`** | camper first names per team | **editor** | editor | editors, only while a camper-showing screen is open | **never** | ~3 KB |
| **`<root>/teamPhotos`** | one compressed image per team slot | member | editor | none: `once()` per `photoV`, only for crests actually on screen | IndexedDB photo store + an in-memory copy | ≤ 100,000 chars each (target ≤ 70,000) |
| **`<root>/accessRequests`** | walk-up "ask to join" rows (the only non-member-writable node; **closed unless `setup/meta/joinOpen` is true**) | editor (+ own row) | own row (throttled, not when blocked) / editor delete | editor devices only: a `limitToLast(25)` query on `at` | no | < 1 KB |
| **`<root>/accessBlocked`** | identities a director blocked from asking (`{at, byKey}`) | editor | editor | none: `once()` when People opens | no | tiny |
| **`<root>/editorsHere/<k>/<d>`** | "also here" for the builder: `{at, v, where?}` (C9) | **editor** | editor, own identity | editor devices only | no | tiny |
| **`<root>/restoreIndex`** | restore-point list rows | editor | editor create/delete (+ `pinned`) | none: `once()` when the screen opens | no | ~200 B each |
| **`<root>/restoreBody`** | restore-point bodies, one JSON string each | editor | editor create/delete | none | no | ~60 KB each |
| `<root>/pushSchedule` (existing) | + optional `rev`, `src` | member | editor | Worker | no | ~10 KB |
| `pushServer/schedSeen/<camp>` (Worker-private) | per-block "what followers were last told" | Worker | Worker | — | — | ~10 KB |
| `members`, `presence`, `changelog`, `chat*`, `chatRate`, `push`, `pushAlerts` | **unchanged** | | | | | |

### 5.2 `<root>/setup`, exactly

All maps are keyed by non-numeric ids so RTDB never coerces them to arrays. `dk` ∈
`sun mon tue wed thu fri sat` (dow 0–6; helpers `dkOfDow`, `dowOfDk`). Times are minutes
since midnight in camp time (`America/New_York`).

```js
setup = {
  meta: {
    schema: 1,                                   // readers fall back + hub ⚠️ when schema > known
    on: { schedule: true, meals: true, verses: true, cleanup: true, electives: true },
                                                 // per-section switch (§5.3); absent = never turned on,
                                                 // false = turned off (data kept) — both mean built-in copy.
                                                 // Changed ONLY by the owner (Q8, §8.2)
    seeded: { at: <server ms>, byKey: 'jenn,x@gmail,com', from: 'camps.js@v196' },
    weekStart: '2027-07-18',                     // the Sunday; may exist before any section is on
    double: { fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 },
                                                 // bonus ×2 window RELATIVE to weekStart; used ONLY
                                                 // under a wizard-created epoch (§5.7.3)
    finaleDow: 5,                                // TV champion finale (absent ⇒ 5)
    epoch: 'w20270718', epochAt: <server ms>,    // written only by the wizard commit (owner-only), with state/meta
    skip: { campers: true },                     // "Not using this year" (hub shows —, never ⚠️)
    edited: { schedule: { at: <server ms>, byKey: '…' }, … },   // added at PUSH time (§6.4.3)
    wizard: { step: 3, byKey: '…', at: <server ms>, fromEpoch: 'legacy',   // never '' (sync-F19); owner-only (Q8)
              archiveId: 'rp-archive-pre-20270601-k3f9',
              answers: '{"weekStart":"2027-07-18","double":{…},"carry":{…}}' },   // JSON string, ≤ 2,000
    joinOpen: true,                              // walk-ups may ask to join (§11.8); absent/false = closed
  },

  days: {                                        // schedule facts only (competition tabs live in config.days)
    sun: { typical: false, tag: 'Arrival day' },
    mon: { typical: true,  tag: 'Competition day 1' },
    …
    sat: { typical: false, tag: 'Send-off', placeholder: true },   // senior seed marks its stubs
  },

  typical: {                                     // THE typical day
    'b-team-competitions-600': {
      start: 600, end: 705, label: 'Team competitions', emoji: '🏅',
      type: 'games',                             // 'activity' | 'games' | 'elective' (today's values)
      ord: 50, alertKey: 'team-competitions',
      // optional: slot (0|1|2), meal ('breakfast'|'lunch'|'supper'), noTime, overlapOk,
      //           teams: { t1: true, t2: true, t5: true }   (rendered as the label tail)
    },
    …
  },

  patches: {                                     // "just this day" changes to typical items
    tue: {
      'b-snack-and-campfire-1200': { label: 'Snack and campfire — Cam' },
      'b-rising-bell-shower-morni-450': { teams: { t0: true, t3: true, t4: true } },   // group B
    },
    fri: { 'b-evening-competition-1080': { off: true }, … },
  },

  dayBlocks: {                                   // one-offs on a typical day; ALL items of a non-typical day
    tue: { 'b-tue-boys-cabin-movie-night-1275': { start: 1275, end: 1320, …, ord: 55, overlapOk: true } },
    sun: { 'b-sun-registration-840': { … }, … },
  },

  meals:   { mon: { breakfast: { dish: 'Eggs and Bacon', emoji: '🥓' }, … }, … },
  verses:  { theme: { title, text, ref }, days: { mon: { text, ref, video? }, … } },
  cleanup: { mon: { breakfast: { t5: true } }, fri: { breakfast: { t3: true, t4: true } }, … },
  electives: {
    stations: { 'st-crafts-with-eileen': { name: 'Crafts with Eileen', emoji: '🎨' }, … },
    slots: { mon: { s0: { 'st-crafts-with-eileen': { ord: 10,
               people: { 'alyssa,x@gmail,com': { name: 'Alyssa', ord: 10 },  // member key
                         'n-lily':             { name: 'Lily', ord: 20 } } } },    // typed name
           s1: {…}, s2: {…} }, … },
  },
}
```

### 5.3 Section switches, and "absence means empty"

| Section | Covers | Built-in source while off |
|---|---|---|
| `schedule` | `days`, `typical`, `patches`, `dayBlocks` | `DAY_SCHEDULE`, `SCHED_DAYS` |
| `meals` | `meals` | `MEALS` |
| `verses` | `verses` | `MEMORY_VERSE_THEME`, `MEMORY_VERSES` |
| `cleanup` | `cleanup` | `MEAL_CLEANUP_SCHEDULE` |
| `electives` | `electives` | `ELECTIVES`, `STATION_EMOJI`, `ELECTIVE_SLOT_MIN` |

- **Not sections:** `meta` (always read: `weekStart`, `finaleDow`, `double` per §5.7.3); team
  branding (per-field fallback in `state.teams`, §5.7.1); games (in `config`).
- **On means the subtree is the whole truth.** A missing key means empty: no `meals` ⇒ meal
  blocks show plain labels; no `cleanup/<dk>/<meal>` ⇒ "TBA"; a day with `typical:false` and
  no `dayBlocks` ⇒ an empty day. There is no fallback to camps.js inside a section that is on.
- **Turning a section on for the first time** (`meta/on/<section>` absent) is one atomic write of
  its seeded subtree **and** `meta/on/<section>: true` (§10.1). **Turning it off** writes only
  `meta/on/<section>: false`; data stays, every device returns to the built-in copy on its next
  snapshot. **Turning it on again** (`on` stored as `false`) writes only `on: true`: the section's
  data, including deliberately empty data (e.g. menus cleared by the wizard), comes back exactly
  as it was. Re-seeding from camps.js is a **separate, explicit** action, "Start this section
  again from the built-in copy", behind a `pre-seed` restore point and a confirm that says what
  will be replaced. *(Review: sync-F2, ux-R7.)*
- While a section is off but holds edits, its hub row says "Showing the original — your edits are
  kept. **Edit the week here** to bring them back".
- `meta/on/<section>` is the only "present but empty" sentinel needed: it is a boolean and is
  never pruned, and its three states (absent / `false` / `true`) are all meaningful.
- **Only the owner changes `meta/on/*`** (decision Q8): turning a section on or off, the first time
  or again, is the owner's act, enforced in the rules (§8.2 `OWNERKEEP`) and shown only to the owner
  in the app. Every other director edits whatever is on.

### 5.4 Block fields

| Field | Type / limit | Where | Meaning |
|---|---|---|---|
| `start`, `end` | integer minutes, `0 ≤ start ≤ 1439`, `1 ≤ end ≤ 1440`, `end > start` | all | as today. `end: 1440` means **"until the end of the day"** (seeded on every *Lights out* / *Camp's over* / *Welcome night*); the item sheet shows it as a switch, never as a time (§11.5). `start` **and** `label` together are the record **anchor**: every field's rule requires both to exist after the write (§8.1) |
| `label` | 1–120 chars | all | the label head; for blocks with `teams`, the rendered label is `label + ' — ' + teamsTail` |
| `emoji` | ≤ 16, no `<>&"` | all | as today |
| `type` | `activity` / `games` / `elective` | all | today's values, kept so the legacy shape comes out unchanged. `games` means "Happening Now yields to the scoreboard"; it doesn't restrict where games attach |
| `slot` | 0–2 | all | elective slot |
| `noTime` | bool | all | untimed (Lights out) |
| `meal` | `breakfast` / `lunch` / `supper` | all | **new**, explicit tag replacing label sniffing (app.js:539-561) |
| `ord` | number | all | tie-break for equal `start`; sort is `(start, ord, id)` |
| `alertKey` | `^[a-z0-9-]{1,48}$` | typical, dayBlocks | **new**, the phone-reminder key; seeded as `pushBlockKey(label)` (today's key); **never recomputed on rename** |
| `teams` | `{tN: true}` | all | **new**, rendered as `"🦃 Turkey, 🍁 Maples & 🚜 John Deeres"` in slot order using `teamEmoji` + `teamShort` (same join as `joinTeamAbbrevs`, camps.js:173-178) |
| `overlapOk` | bool | all | an editor confirmed an intended overlap (hub stops warning) |
| `off` | bool | patches, dayBlocks | cancelled for that day (reversible; "Bring back") |

A patch may set any field except `alertKey`. **Patches are only ever removed by a choice the
director made about that patch**: "Just Tuesday" saving a value equal to the typical one
removes that field of Tuesday's patch (the director is editing that very record), and "Change
Wednesday too" removes Wednesday's. A typical-day edit **never** strips other days' patches as a
side effect, even when they now look equal: that write could erase a colleague's concurrent
"Just Tuesday" change (sync-F16a). An equal-to-typical patch is harmless (it renders the same)
and the day view simply doesn't tag it "Changed for Tue".

### 5.5 Ids

| Thing | Id | Minted |
|---|---|---|
| Typical block (seed) | `b-` + slug(head label, ≤ 24) + `-` + start, e.g. `b-team-competitions-600` | `buildSeed`, deterministic |
| Day one-off / own-day block (seed) | `b-<dk>-` + slug(head, ≤ 24) + `-` + start, e.g. `b-tue-boys-cabin-movie-night-1275` | `buildSeed`, deterministic |
| New block | `b-` + 8 random base36 | on create |
| Block occurrence (published to the Worker) | `<dk>-<bid>` (≤ 40 chars: seeded ≤ 39, random 14) | derived |
| Station | `st-` + slug(name, ≤ 36) | seed / create |
| Elective person | the member key (`emailKey`/phone), or `n-` + slug(name) | pick / type |
| Camper | `c-` + 10 random base36 | create |
| New game (builder, ⚡ quick game, Duplicate) | `makeId(name)` slug + `-` + 4 random base36, e.g. `rain-bowling-k3f9`; `taken` also includes every key in `results`, `brackets`, `brackets4`, `drafts`, `picSetup`, `live` and `clocks` | create (S3) — two directors adding "Rain bowling" at once can't mint the same id (sync-F13). Seed and existing ids never change. |
| Restore point | `rp-` + base36(ms) + `-` + 4 random; archive `rp-archive-<epoch or pre-YYYYMMDD>-` + 4 random | create (the random tail means a retried or re-taken step 3 never collides with its own earlier write, ux-R6/sync-F18) |
| Epoch | `w` + YYYYMMDD of the new week's Sunday (`-2`…`-9` if re-run for the same week) | wizard |

- **Head label** is `pushHeadLabel()` (push.js:96): text before `' — '` or `' ('`. Slug =
  lowercase, non-alphanumerics → `-`, cut to the length limit, leading/trailing `-` trimmed
  (so the morning meeting is `b-rising-bell-shower-morni-450`). Collisions within one container
  get `-2`, `-3`. Published ids stay ≤ 40 chars (`<dk>-` + at most 35).
- **Alert keys are provably today's keys:** `alertKey = pushBlockKey(label)` for every seeded
  block (pinned by a test over both camps). Every existing phone subscription keeps working.
- **Frozen fixture:** `tests/fixtures-setup-seed-{junior,senior}.json` hold the seeded ids and
  alert keys, so a later change to the slug rule can't silently re-key a live camp.

### 5.6 Resolving a day (the one function every schedule consumer goes through)

```js
// setup-sync.js — pure
function resolveDay(tree, dow) {
  const dk = DK[dow], day = (tree.days || {})[dk] || {}, out = [], skipped = [], broken = [];
  if (day.typical) {
    const patches = ((tree.patches || {})[dk]) || {};
    for (const id of Object.keys(tree.typical || {})) {
      const p = patches[id] || {};
      const b = Object.assign({ id, dk, origin: patchDiffers(p, tree.typical[id]) ? 'changed' : 'typical' },
                              tree.typical[id], p);      // a patch field replaces the typical field whole
                                                         // (an equal-to-typical patch field isn't "changed", §5.4)
      if (!validBlock(b)) { broken.push(b); continue; }  // partial record from a race → hub ⚠️
      if (b.off) { b.origin = 'skipped'; skipped.push(b); continue; }
      out.push(b);
    }
  }
  const own = ((tree.dayBlocks || {})[dk]) || {};
  for (const id of Object.keys(own)) {
    const b = Object.assign({ id, dk, origin: day.typical ? 'oneoff' : 'own' }, own[id]);
    if (!validBlock(b)) { broken.push(b); continue; }
    if (b.off) { b.origin = 'skipped'; skipped.push(b); continue; }
    out.push(b);
  }
  out.sort((a, b) => a.start - b.start || (a.ord || 0) - (b.ord || 0) || (a.id < b.id ? -1 : 1));
  out.skipped = skipped;                               // "Skipped on Tuesday: … · Bring back"
  out.broken = broken;                                 // "1 broken item on Tuesday — Fix / Remove"
  return out;                                          // "rich" blocks
}
function renderLabel(b) {                              // teams in slot order, joinTeamAbbrevs' exact join
  return b.teams ? b.label + ' — ' + joinTeams(Object.keys(b.teams).sort(bySlot)) : b.label;
}
function legacyBlock(b) {                              // exactly today's DAY_SCHEDULE entry shape + key order
  const o = { start: b.start, end: b.end, label: renderLabel(b), emoji: b.emoji, type: b.type };
  if (b.slot !== undefined) o.slot = b.slot;
  if (b.noTime) o.noTime = true;
  return o;
}
```
- `validBlock(b)`: integer `start`/`end` in range with `end > start`, non-empty `label`, a known
  `type` (an unknown type renders as `activity`), sanitized emoji (else 🕒).
- The sort is total, so every device agrees on first-match-wins in `nowBannerHtml`.
- Resolution is memoized per setup revision (a counter bumped on every local commit and remote
  adopt), so repeated accessor calls return the **same array object** until the tree changes
  (render-stability).

### 5.7 `state` additions

**5.7.1 Team branding** (`state.teams[i]`, fixed slots `t0…t(N-1)`, N = `CAMP.teamCount`)

| Field | Type | Fallback when absent (per field) |
|---|---|---|
| `id`, `name`, `counselor` | unchanged | unchanged |
| `short` | 1–20 chars | `TEAM_ABBREV[id]` |
| `emoji` | ≤ 16, sanitized | `TEAM_EMOJI[id]` |
| `color` | a palette id (Appendix A) | legacy single hex `TEAM_ACCENT[id]` in both themes |
| `photoV` | number (ms) | no uploaded photo; crest = repo shield (`TEAM_SHIELD[id]`) or emoji |

New clients diff teams per `teams/<i>/<field>` when previous and current have the same ids in
the same order (always true with fixed slots), else whole (today's behaviour). Accessors
sanitize every field on read **and** R1 adds leaf rules for the new fields
(`state/teams/$i/{emoji, short, color, photoV}`, §8.3), so a bad value is refused at the server
too. (The earlier claim that the rules can't validate inside `teams` was wrong — sec-F3: leaf
validates under `$i` accept the legacy whole-array write, which carries none of these fields.)
On the TV page the same sanitizers come from `camp-core.js` (P14).

**5.7.2 Epoch.** `state/meta/epoch` (`w<YYYYMMDD>`) and `state/meta/epochAt` (server ms),
written only by the wizard commit (same values as `setup/meta`), which only the owner can run:
the rules pin both fields to the owner (§8.3). **Absent = the legacy epoch
`''`**, which is today's data. `meta` is diffed per field, so old builds carry it untouched.

**5.7.3 Double points.** `doubleWindow()` returns:
- **legacy epoch** (no `state.meta.epoch`): exactly `DOUBLE_BONUS_START`/`END`, whatever
  `weekStart` or `setup/meta/double` say. Summer 2026's standings can never shift.
- **wizard epoch:** `setup/meta/double` resolved against `setup/meta/weekStart` in camp time with
  the DST-safe `etWallToEpoch` (ported from worker.js into `camp-core.js`); `null` (no doubling)
  if either is missing. `toDow` may be 7 (the following Sunday 00:00 = "end of Saturday").
- The seeded relative window `{fromDow:4, fromMin:1020, toDow:6, toMin:0}` resolved against
  Sunday 2026-07-19 equals the constants to the millisecond (test).

**5.7.4 `brackets4`** — a new sync key (C4):
```js
state.brackets4[gid] = {
  at: <ms>,                                     // started
  m: { s1:    { a: 't2', b: 't0', winner?: 't0', at?: <ms> },
       s2:    { a: 't1', b: 't3', winner?, at? },
       third: { a?, b?, winner?, at? },         // teams DERIVED: the two semifinal losers; a/b are
       final: { a?, b?, winner?, at? } }        //   written WITH the winner, recording who played
}
```
**Every recorded match carries its participants** (`a`, `b`) next to its `winner`, so a record
can be checked against the bracket it was made in (sync-F9). `normalizeBracket4` (pure, run on
every adopt and before every render) checks the chain: `s1`/`s2` winners ∈ `{a, b}`; a recorded
`third`'s `{a, b}` equals the two derived semifinal losers and a recorded `final`'s equals the
two derived winners. Any mismatch (two refs recorded different winners for a semifinal, or a
late offline tap changed a semifinal after the next match was played) sets phase **`recheck`**:
the bracket shows "Semifinal 1 was changed to 🔵 Blue after the 3rd-place match was played —
check the 3rd-place result" with **[Keep Semifinal 1 as Blue and replay 3rd place]** /
**[Put Semifinal 1 back to 🔴 Red]**; `fourMedals` returns `null` and no result can be saved
until it is consistent. A record arriving for a game whose `results/<gid>` already exists (a
late tap after the bracket finished) is ignored and listed on the hub's Games row as "a late
bracket tap after the result was saved — **Discard**". The record itself stays a normal
`pushState` write (durable offline, merged on reconnect like every score); a transaction was
considered and rejected because RTDB transactions don't survive a reload or force-quit, which
the bad-Wi-Fi requirement needs.
Phase is derived, never stored: `s1` → `s2` → `third` → `final` → `summary` (order from
decision Q12; default 3rd place before the final). `computeSyncUpdates` diffs
`brackets4/<gid>/m/<match>` per match; creating writes `brackets4/<gid>` whole; finishing
writes `results/<gid>` and `brackets4/<gid>: null` in the same batch. Absent `winner` = undecided,
so pruning is harmless. `SYNC_KEYS`, the `applyRemoteState` list at app.js:2619, the rules and
the "state accepts exactly SYNC_KEYS" test all gain `brackets4`.

**5.7.5 `results[gid].path`** (optional): the finished bracket (either kind), so "Clear result"
can offer "Reopen the final". Old builds ignore it.

### 5.8 `config` additions (optional; old builds keep them)

| Field | Meaning |
|---|---|
| `game.blockId` | the `bid` of a block on the game's day (dow of `game.dayId`'s tab). **Honoured only if** that block exists in `resolveDay(tree, dow)`; otherwise the game is **unattached on its day** (hub ⚠️, "Not on the schedule (was on Tue · Team competitions)"). An old builder changing a game's Day leaves `blockId` dangling; this rule makes it harmless. |
| `game.ord` | order inside the block; ties fall back to array index |
| `game.bracketSeed` | tournaments only: `standings` (default) / `pick` / `fixed` (pairs in today's `roundOneMatchups`) |

- `dayId` and `session` stay **authoritative for old builds**; new code **derives both from the
  block** on attach (`session = blockSession(block)`: `< 720` Morning; `< 1020` Afternoon when the
  camp has that session; else Evening), so an old build always sees a consistent pair.
- `config.days` is the **only** list of competition days (C6). If a game is attached to a block
  on a dow with no tab, the same config commit creates `{id:'d'+dow, name, dow, note:''}`
  (after an inline confirm in the UI).
- **No code path writes `game.day`** (`migrateState` would rewrite it into `dayId`; pinned by a
  test).

### 5.9 The other new nodes

```js
campers/<tid>/<cid>      = { name: 'Ava', ord: 10 }                     // editor-only read; ord REQUIRED (anchor pair)
teamPhotos/<tid>         = { v: <ms>, data: 'data:image/png;base64,…' } // ≤ 100,000 chars, png|jpeg, base64 charset only
accessRequests/<idKey>   = { name: 'Taylor Reed', note?: 'With the Foxes', at: <server ms> }   // every write sets at = now
accessBlocked/<idKey>    = { at: <server ms>, byKey }                    // editor-only; "Block" on a request
restoreIndex/<rid>       = { at, byKey, kind, label, note?, bytes, hash, epoch?, pinned? }
restoreBody/<rid>        = '<JSON string, ≤ 900,000 chars>'
editorsHere/<k>/<d>      = { at, v: 196, where?: 'schedule:tue' }        // editor-only (C9); presence stays { at }
pushSchedule             = { weekStart, at, by, blocks, rev?: 12, src?: '9c1f04aa' }
pushServer/schedSeen/<camp> = { weekStart, blocks: { '<dk>-<bid>': { dow, start, label, key } } }
```

### 5.10 Healing what RTDB prunes (`normalizeSetup`, after every load, adopt and merge)

- Structure only: ensures `meta`, `meta.on`, `meta.skip`, `meta.edited`, `days`, `typical`,
  `patches`, `dayBlocks`, `meals`, `verses`, `verses.days`, `cleanup`, `electives`,
  `electives.stations`, `electives.slots` are objects; all seven `days` records exist in memory
  (`{typical:false, tag:''}`); coerces any map that came back as an array.
- **It never rewrites a stored value** (a value "repair" would appear in the next diff and be
  pushed as an edit nobody made). Bad values are skipped where they are read (`validBlock`,
  accessors), and the hub lists them ("1 broken item on Tuesday — Fix / Remove").
- In memory only, drops `patches/<dk>/<bid>` whose typical block no longer exists.
- Comparisons for diffs and merges always run on `syncCanon` forms (empties pruned, keys
  sorted), the lesson of REVIEW-sync #1/#4.

### 5.11 Device storage

| Key | Holds | Wiped by |
|---|---|---|
| `STORAGE_KEY` (existing) | + `state._cfgBase`, `_cfgBaseAt`, `_cfgBaseEpoch` (written in the same `setItem` as `state.config`); + `state._quarantine` (S2a: refused state paths, so the "couldn't be saved" line survives a reload) | existing |
| `lsKey('campScoreboardSetupV1')` | `{v:1, tree, base, baseAt, epoch, clashes, quarantine}` in **one** `setItem` | `clearLocalData` |
| `lsKey('campSetupUndo')` | undo stack (≤ 50 entries, ≤ 200 KB; never camper ops) | `clearLocalData`, epoch change, role drop from editor |
| `lsKey('campSetupRainDraft')` | the staged rain plan for one day: `{dk, epoch, at, items: {path: {base, staged}}}` (the value each field had when staged, sync-F4) | `clearLocalData`, Done/Discard, epoch change; older than 12 h → asked "Finish or discard the rain plan from yesterday?" |
| `lsKey('campWizardDraft')` | the wizard's step-1/2 answers for the director driving it (ux-R5) | `clearLocalData`, wizard commit or cancel, epoch change |
| `lsKey('campSetupPendingAlert')` | an alert intent made offline | `clearLocalData` |
| `lsKey('campSetupRpOutbox')` | ≤ 3 restore points that couldn't be written in 4 s | `clearLocalData` |
| `lsKey('campScoreboardStranded')` | unsent work from a previous camp year, for download | `clearLocalData`, after download |
| `lsKey('campScoreboardEpochSeen')` | last epoch this device reset for | `clearLocalData` |
| IndexedDB photo store `team:<campId>:tN:<v>` | cached team photo | `clearPhotos` (existing) |
| (none) | camper names | n/a — by design |

### 5.12 Sizes and the Spark budget (1 GB stored, 10 GB/month downloaded)

- `setup`: junior ≈ 25 KB (schedule ≈ 9.4 KB measured with `alertKey`/`ord`, electives ≈ 5 KB,
  the rest small); senior ≈ 8 KB. 40 devices × 15 loads/day × 25 KB ≈ 15 MB/day. Edits send only changed paths.
- `config` commits are transactions that write the whole ~17 KB node (C1): 40 listeners ×
  300 edits in a setup weekend ≈ 200 MB, about 2% of the month. Mid-week edits are a handful.
- Restore points ~60 KB; 40 auto + ≤ 20 manual + archives ≈ 4–6 MB stored, never listened to.
- Team photos ≤ 6 × 100,000 chars per camp (target ≤ 70 KB each). A phone fetches **only the
  crests it renders** (today: the followed team's on the follow card), once per `photoV`, into
  IndexedDB plus an in-memory copy. **Cache-miss worst case** (private mode, iOS eviction, K18):
  40 devices × 15 loads/day × 70 KB ≈ 42 MB/day ≈ 1.3 GB/month, about 13% of the month; with
  the cache working it is ≈ 17 MB per photo change. The TV renders all crests (≤ 420 KB per load)
  and its reloads are capped at 3 per hour (§12.3): ≤ 30 MB/day worst case. (sec-F10)
- `editorsHere` is written only by editors, on screen transitions inside the builder, and only
  editor devices listen; no heartbeat.
- `accessRequests`: at most one write per identity per 60 s (enforced, §8.2), only while a
  director has asking switched on, only editor devices listen and only to the newest 25 rows.

---------------------------------------------------------------------------------

## 6. Sync, multi-editor and offline behaviour

### 6.1 Shared pure helpers (new, in app.js next to `syncCanon`)

- `treeDiff(prev, cur, depthSpec)` → `{path: value|null}`. Objects present on both sides recurse
  until the spec says "leaf"; arrays and scalars are leaves; an object absent on one side is
  written whole (create) or as `null` (delete). Compares `syncCanon` forms.
- `applyOpsSafe(tree, ops, anchors)` → `{tree, dropped}`: applies ops, but drops a field op whose
  record (per `anchors`) is absent in `tree` and reports it.
- `fnv1a(str)` → 8 hex chars (restore-point hashes, `pushSchedule.src`).

### 6.2 The `state` engine: four deliberate changes, each its own deploy

Every CLAUDE.md invariant stays: never push before the first pull; three-way first-snapshot
merge against the persisted `_syncBase`; identity-preserving echo; per-path diffs; the
`editorMidEntry` allowlist; deferred snapshots re-read on idle; `reloadBlocked`. The tests that
pin them stay green untouched except where marked.

1. **S2a Quarantine on permission refusals** (C8). In `pushState`'s rejection handler, **only
   when `e.code === 'PERMISSION_DENIED'`**: retry each path of the batch alone, sequentially
   (≤ 50 paths; bisect beyond). Paths that succeed advance the confirmed baseline exactly as an
   ack does today. Paths refused alone go to `stateQuarantine[path] = value`, are treated as sent
   in `lastSyncedTree` (so they aren't retried forever), and the sync indicator shows
   "⚠️ 1 change couldn't be saved: *Kickball → result*" with **Retry** (re-queue) and
   **Discard** (restore the confirmed value). **Every other error keeps today's code path
   exactly** (restore `lastSyncedTree = prevBaseline`, settle).
   **Ordering (sync-F15):** while a bisect runs, `pushState` holds new pushes (the bisect counts
   in `pendingWrites`, so reload/adoption guards see it) and runs them after it ends; at retry
   time each path is re-read from **current** local state and skipped if it changed since the
   refused batch (the newer value goes out in the next normal push), so an older live-score value
   can never land after a newer one. `stateQuarantine` is persisted as `state._quarantine` in the
   same `STORAGE_KEY` write, so a refused score and its explanation survive a reload.
   Tests: a stub `fbRef.update` that refuses one path; a live-score tap during the bisect lands
   last; quarantine survives a reload; the network-error path diff-identical to v183.
2. **S2b Teams per field.** `SYNC_SINGLETONS` becomes `['notice']` (notice stays whole: it is one
   composed card). `computeSyncUpdates` emits `teams/<i>/<field>` when ids match by position,
   else whole. `sync.test.js:344` ("teams are written whole") changes on purpose and gains a
   both-shapes case; `firstSnapshotMerge` needs nothing (`syncPathsOverlap` handles depth).
3. **S2d Epoch check.** In `firstSnapshotMerge`, if `(bootSyncedTree.meta||{}).epoch||''` ≠
   `(remote.meta||{}).epoch||''`, keep **none** of this phone's paths: write them to
   `lsKey('campScoreboardStranded')`, adopt the server, toast "This phone had N changes from last
   camp week that never synced. They weren't added to this week. **Download them**". No-op until
   an epoch exists. Old builds still have the 36 h `confirm()` (app.js:2564).
4. **S6b `brackets4`** joins `SYNC_KEYS`, `SYNC_ITEM_MAPS`-style per-match diffing, and the
   hard-coded list in `applyRemoteState` (app.js:2619), so "missing means empty" holds for it.

### 6.3 Config engine v2 (S3): scoring#3 fixed on the existing node

**6.3.1 Canonical id-space** (diff/merge only, never stored):
```js
cfgCanon(c) = syncCanon({ version: c.version, sessions: c.sessions,
                          days:  keyById(c.days),     // { d1: {...day, _o: 0}, … }
                          games: keyById(c.games) })  // { gid: {...game, _o: i} }
cfgFromCanon(t, updatedAt) // → { version, updatedAt, sessions, days: [… by (_o,id)], games: [… by (_o,id)] }
CFG_DEPTHS: version whole; sessions whole; days/<id>/<field>; games/<id>/<field>
            (each game field is one leaf: rules, timer, liveTracker, … are written whole)
```
Add/delete of a record = whole record / `null`. Reorder = `_o` changes. `updatedAt` is excluded
from diffs and stamped at commit.

**6.3.2 Persisted baseline.** `state._cfgBase` (canon of the last server-confirmed config),
`_cfgBaseAt`, `_cfgBaseEpoch` live in the `STORAGE_KEY` blob beside `state.config`; one write
covers both (the `_syncBase` rule).

**6.3.3 Writes are transactions** (replacing `pushConfig`'s `set()`):
```js
function pushConfigV2() {
  if (!fbConfigRef || !configReady || tabReadOnly || wizardCommitInFlight) return;
  if (pendingConfigWrites > 0) { configPushOwed = true; return; }   // one transaction at a time
  const atPush = cfgCanon(state.config);
  const ops = treeDiff(state._cfgBase, atPush, CFG_DEPTHS);         // my unconfirmed edits
  if (!Object.keys(ops).length) return;
  pendingConfigWrites++;
  fbConfigRef.transaction((cur) => {
    if (cur === null) return;                          // ABORT: the node is really gone (listener is
                                                       // attached, so the SDK has it cached)
    const { tree, dropped } = applyOpsSafe(cfgCanon(cur), ops, CFG_ANCHORS);
    noteDroppedOps(dropped);                           // "Jenn deleted Gaga Ball while you were editing"
    return configForSync(cfgFromCanon(tree, new Date().toISOString()));
  }, null, /* applyLocally */ false).then(({ committed, snapshot }) => {
    if (committed) {
      const server = cfgCanon(snapshot.val());
      const since = treeDiff(atPush, cfgCanon(state.config), CFG_DEPTHS);   // edits made during the push
      state.config = cfgFromCanon(applyOpsSafe(server, since, CFG_ANCHORS).tree, state.config.updatedAt);
      writeCfgBase(server);                            // base + config persisted in ONE setItem
    } else showConfigNotice('The games list was deleted on the server — restore it from Restore points.');
  }, (e) => noteConfigFailure(e))                      // ops stay unconfirmed → retried next push
    .finally(() => { pendingConfigWrites--; if (configPushOwed) { configPushOwed = false; pushConfigV2(); } });
}
```
- **Why the rebase on commit:** the transaction may have merged other editors' changes that this
  device hasn't received yet. Setting the base to the committed server value without also
  rebasing the local copy would make the next diff "undo" their changes. Local = committed value +
  only the edits made since this push started.
- An old build's whole `set()` landing between our read and commit makes the server reject our
  hash; the SDK re-runs the function on the new value, so our ops apply on top of theirs.
- **Seeding an empty node** (keeps app.js:2721's behaviour): when the first config snapshot is
  `null`, `fbConfigRef.transaction(cur => cur === null ? configForSync(state.config) : undefined)`.
- `configReady` flips on the first config snapshot; nothing is pushed before it (scoring#3's
  second half). Edits made before it are **kept and merged** by the first-snapshot three-way
  merge (§6.3.4), so from S3 on the builder stays editable while the games list loads. (Between
  S0h and S3 there is no merge yet, so S0h keeps the game/day builder **read-only until
  `configReady`** — "Loading the games list…" — rather than letting an edit be silently replaced
  by the first snapshot; sync-F14.)

**6.3.4 Receiving config** (replaces `state.config = remote` and `pendingRemoteConfig`):
- **First snapshot after load** waits until the first **state** snapshot has also arrived
  (`remoteReady`), then: if `_cfgBaseEpoch` ≠ `state.meta.epoch||''` → strand local ops (as
  §6.2 #3), adopt. Else three-way: `mine = treeDiff(_cfgBase, local)`, `theirs =
  treeDiff(_cfgBase, cfgCanon(remote))`; keep mine where no path of theirs overlaps; on
  overlap the server wins, the loser goes to the clash list (§6.4.6) with a synthetic undo
  entry; a kept op whose record the server deleted goes to the "Put it back" list (sync-F12).
  Adopt the merged config with `_cfgBase = cfgCanon(remote)`; push the kept ops. Work
  unconfirmed for > 36 h asks first. A device with no `_cfgBase` (first run of S3) plain-adopts.
- **The config base follows the state epoch (sync-F11).** The wizard normally doesn't write
  `config` (games are kept), so the config base can't learn the new epoch from a config snapshot.
  Whenever the state engine adopts a `state.meta.epoch` different from `_cfgBaseEpoch`: if config
  has no unconfirmed ops, `_cfgBaseEpoch` is set to the new epoch in the **same** `setItem`; if it
  has some, they are from the old year and are stranded right then (§6.2 #3), and the epoch is
  updated. So a device that stays open across the wizard and then edits games offline keeps
  those edits through a reload.
- **Later snapshots: rebase, never stash.** `{tree, dropped} = applyOpsSafe(cfgCanon(remote),
  myUnconfirmedOps)`; `state.config = cfgFromCanon(tree)`, `_cfgBase = cfgCanon(remote)`. Any
  `dropped` op (my unsent edit to a game someone just deleted) goes to the same persisted **"X
  was removed — Put it back with your changes / Discard"** list as §6.3.5, never silently
  (sync-F12). Data applies immediately even mid-entry; only **rendering** is deferred while a
  field has focus (§6.10).
- `migrateState` still runs on the result; the existing rule stays (re-push only on a real
  version change by an editor, app.js:2306). `remoteJustApplied` behaviour unchanged.
- Identity is preserved per record: a game/day whose canon JSON didn't change keeps its object.

**6.3.5 Game editor saves only what changed.** `ensureGameDraft` also stores `gameDraftOrigin`
(deep copy of the saved game when the sheet opened). `saveGameDraft` parses the draft as today,
computes `fieldOps = treeDiff(origin, out)` at game depth and applies them to the **current**
game. If the game was deleted meanwhile → dialog "Jenn deleted this game while you were editing.
**Put it back with your changes** / **Discard my changes**". Fields someone else changed that
this editor also changed → inline "While you were editing, Patrick changed **Location** to
*Gym* (you have *Field 2*). [Keep mine] [Use his]" before writing.

**6.3.6 Accounting.** `pendingConfigWrites` and a non-empty `treeDiff(_cfgBase, …)` join
`pendingWritesTotal()` and `hasUnconfirmedLocalWork()` (§6.5). Tests that stubbed
`fbConfigRef.set` (`sync.test.js:355-372`, `sync-merge.test.js:132-147`) change on purpose to a
transaction stub.

### 6.4 The setup engine (`setup-sync.js`, S4)

Cloned from the state engine's *design*, not refactored out of it (the sync tests poke the
state engine's globals and are the safety net). Reuses `syncCanon`, `syncValueAt`,
`applySyncPaths`, `syncPathsOverlap`, `treeDiff`, `applyOpsSafe`.

**6.4.1 Globals.** `setupRef, setupReady, setupDenied, setupTree, setupLast (optimistic),
setupBase (confirmed, persisted), setupBootBase, setupPending, setupPushTimer,
setupRefetchOwed, setupFocusOwed, setupQuarantine, setupRev`. At script load the cached tree
is read so a returning device on dead Wi-Fi paints the *edited* week.

**6.4.2 Write path — `commitSetup(mutate, {label, section, alert?, restorePoint?})`:**
1. Refuse unless `canEdit()` (which is false in a read-only tab, §6.9) and
   `setupOn(section) || opts.turningOn`.
2. `before = clone(setupTree)`; `mutate(draft)`; `normalizeSetup(draft)`. **No automatic
   stripping of other records' patches** (§5.4, sync-F16a): only the mutate itself removes a
   patch field, when the director's own "Just Tuesday" save equals the typical value or they
   chose "Change Wednesday too".
3. **Existence check:** a field write into a block/record absent from `before` is refused with
   "Patrick removed this item" (Put it back / Discard).
4. `ops = treeDiff(before, draft, SETUP_DEPTHS)`; empty → return.
5. Record the undo entry (§7.1); `setupTree = draft`; **persist immediately** (tree + base in one
   `setItem`, so a force-quit right after a tap is safe); `setupRev++`.
6. Schedule the push (300 ms debounce); patch the builder in place; `renderAll()` for home
   consumers (deferred if a score field has focus, §6.10).

`SETUP_DEPTHS`: `meta/<field>` (with `double`, `seeded`, `wizard` as leaves); `days/<dk>/<field>`;
`typical/<bid>/<field>`, `dayBlocks/<dk>/<bid>/<field>`, `patches/<dk>/<bid>/<field>` (with
`teams` as a leaf); `meals/<dk>/<meal>` whole; `cleanup/<dk>/<meal>/<tid>` leaf;
`verses/theme` and `verses/days/<dk>` whole; `electives/stations/<st>` whole;
`electives/slots/<dk>/<slot>/<st>/ord` and `…/people/<p>` whole.

**6.4.3 Push.** Gate: `setupRef && setupReady && !setupDenied && canEdit() &&
!wizardCommitInFlight` (**never push before the first pull**). `updates = treeDiff(setupLast,
setupTree)`; then **append the section stamps**: for each section the updates touch,
`meta/edited/<section> = {at: ServerValue.TIMESTAMP, byKey: myKey}`. Stamps are **never part of
the diffed tree**: the local tree holds a `serverNow()` estimate for display only, and
`meta/edited/*` is excluded from `treeDiff`, from unconfirmed-work checks and from undo.
`setupLast = clone(setupTree)`; `setupPending++`; `setupRef.update(updates)`.
- Ack → `setupBase = applySyncPaths(setupBase, updates)`; persist; `setupPending--`.
- Refusal → §6.4.7. Network error → `setupLast = previous`, `setupPending--` (re-diffed next time).

**6.4.4 First snapshot after load.**
- `null` and this device never had a base → not set up yet: accessors use the built-in copy;
  the hub offers **Edit the week here**. **The engine never seeds by itself.**
- `null` but this device had a confirmed base → a deliberate wipe (console): adopt empty, keep
  the local tree only as "Download my setup", never re-seed from the cache (the state engine's
  `bootHadConfirmedBase` rule).
- `meta.epoch` differs from the cached base's epoch → adopt; strand unconfirmed local paths
  into a download (§6.11).
- Local unconfirmed paths (`treeDiff(bootBase, local)` non-empty) → three-way merge per path,
  exactly the `firstSnapshotMerge` algorithm on canonical forms; overlaps → server wins, the
  loser goes to `clashes` with a synthetic undo entry (§6.4.6); a kept path whose record the
  server deleted goes to the "Put it back" list instead of being pushed into a refusal (sync-F12). Merged tree applied with the
  **server** tree as confirmed base; kept paths pushed. > 36 h unconfirmed asks first.
- Otherwise plain adopt. `setupReady = true`.

**6.4.5 Later snapshots.** Adopt only when `setupPending === 0` (nothing in flight); otherwise
`setupRefetchOwed = true` and the existing 1 s `idleRetryTick` gains a setup branch that
re-reads with `setupRef.once('value')` when quiet (never replays a stashed payload). On adopt:
`unsent = treeDiff(setupLast, setupTree)` (edits made but not yet pushed, e.g. inside the
300 ms window); `{tree, dropped} = applyOpsSafe(normalizeSetup(remote), unsent)`;
`setupTree = tree`; `setupLast = setupBase = remote`; if `unsent` is non-empty the next push
re-sends exactly what survived. Every `dropped` op (an unsent edit to an item someone just
deleted) goes to the persisted **"Supper was removed — Put it back with your changes / Discard"**
list, stored with the clashes (sync-F12). **No local edit can be lost silently to an incoming
snapshot.** Echo check: if `canon(remote)` equals
`canon(setupLast)` keep the live objects and skip re-render.

**6.4.6 Clashes, kept, not dropped.** Each lost overlap `{path, mine, theirs, at, byName}` is
persisted in the setup key's `clashes` (≤ 30). Toast: "1 change you made offline clashed with
Patrick's; kept his. **See mine**". The sheet lists each in words ("Tuesday · Swim · starts:
yours 3:00 PM, Patrick's 2:30 PM") with **Use mine** (a normal `commitSetup`, or a config commit, with undo) and
**Dismiss**. Config-engine clashes (§6.3.4) are stored in the same list with `domain: 'config'`.
The same synthetic undo entry means the Undo pill can also bring it back.

**6.4.7 Refusals: bisect and quarantine** (never a silent wedge). On `PERMISSION_DENIED`:
retry each path alone (≤ 40; bisect beyond). Paths that pass advance the base. Paths refused
alone go to `setupQuarantine` (persisted) with a plain line in the sync line and the hub:
"Couldn't save Tuesday · *Supper* time — Supper was removed from the typical day" (when the
anchor rule refused it) or "…the database refused it". **Retry** and **Discard** (revert to the
base value). If **every** path is refused, treat it as "rules not published": `setupDenied`
banner ("Editing the week here isn't available yet — the database rules haven't been updated").

**6.4.8 Denied.** The `setupRef` cancel callback sets `setupDenied`, clears `setupReady`; the
camp keeps running on the built-in copy; the hub explains. Never touches `fbRef`/`syncDenied`.
Attached in `initSync` right after the config listener (post-approval).

**6.4.9 Focused-field hold.** Every builder input carries `data-bind="setup:typical/b-x/start"`
(or `config:games/<gid>/name`, `teams:3/short`). On adopt, a changed path overlapping the
focused input's bind is **not** written into the input; the remote value goes to
`setupFocusOwed[path]` and the field shows "Patrick just changed this to 2:30 PM — [Use his]
[Keep yours]". **The input's value is recorded when it gains focus (sync-F3).** On blur without
a choice: if the input still holds its focus-time value (the director only tapped or tabbed
through), his value is adopted into the input silently and **nothing is written**; only if the
director actually changed it does yours become a later write (yours wins), with an undo entry
recording his value. No blur ever writes an unchanged field: tabbing across the Meals grid can't
revert a colleague's dishes.

### 6.5 Accounting (one helper, every guard)

`pendingWritesTotal() = pendingWrites + pendingConfigWrites + setupPending + (wizardCommitInFlight ? 1 : 0)`.

| Guard | Adds |
|---|---|
| `reloadBlocked()` | `pendingWritesTotal() > 0`, `setupPushTimer`, the config push timer, `builderSheetDirty()`, a state-quarantine bisect in progress; **the rain-plan panel or the wizard open and touched within the last 2 minutes** (both are persisted on the device — the rain draft with its bases, the wizard answers in `campWizardDraft` — so an abandoned one never blocks updates: the page reloads and restores it; sync-F4, ux-R5) |
| `hasUnsyncedWork()` (camp switch) | the same timers and counters |
| `hasUnconfirmedLocalWork()` (sign-out) | non-empty `treeDiff(_cfgBase, config)` or `treeDiff(setupBase, setupTree)`, a non-empty quarantine, the restore-point outbox |
| `flushPendingPush()` (pagehide/visibilitychange) | flushes the setup and config timers too |
| `editorMidEntry()` | `setupPushTimer != null` (so a state snapshot isn't adopted mid-setup-commit) |
| `canAdoptRemote()` | **unchanged** (stays about `state`; C28). The wizard's root update increments `pendingWrites` itself. |
| Wizard precondition | `pendingWritesTotal() === 0` **and** no unconfirmed diffs in any engine **and** online **and** writer tab |

### 6.6 Two editors at once: the conflict table

| Situation | Result |
|---|---|
| Different fields, same block or game | Both land (per-field paths / per-field config ops). |
| Same field, both online | Last ack wins. If the other's change lands while I'm focused there: inline "Patrick just changed this" (§6.4.9). If it lands within 60 s after my own write to that path: toast "Jenn changed *Supper* time right after you — showing hers. [Undo hers]". |
| Same field, one offline | First-snapshot merge: server wins; mine goes to **See mine** + a synthetic undo entry. |
| A deletes a block/game, B edits a field of it | Setup: B's write is **refused by the anchor rules** (§8.1: every field, `start` and `label` included, requires the record's `start` **and** `label` to exist after the write), including a time move (`start`+`end`) that sat in the offline queue and lands on reconnect; it is quarantined ("Supper was removed…" with **Put it back** = re-create whole, or Discard). B's client usually catches it first (existence check, and the adopt path's `dropped` list, §6.4.5). Same for a camper rename racing "Move to team" (`name` requires `ord`). Config: `applyOpsSafe` drops the op; dialog "Put it back with your changes". |
| A edits the typical day, B edits Tuesday "just this day" | Different paths (`typical/…` vs `patches/tue/…`): both land; Tuesday shows B's value for that field (the meaning of "just this day"). A's commit never deletes Tuesday's patch as a side effect (§5.4), even if A's stale copy showed it equal to the new typical value. |
| A makes Friday its own day, B saves "Just Friday" | "Give Friday its own schedule" writes `days/fri/typical: false`, the copied `dayBlocks/fri` **and** `patches/fri: null` in one update; B's patch write is refused because patch fields require `days/<dk>/typical === true` (§8.1 `PANCHOR`) and goes to quarantine with "Friday is now its own day — open it and make the change there". "Go back to the typical day" likewise clears `dayBlocks/<dk>` in the same update (sync-F16b). |
| A finishes a rain plan she started 15 min ago; B changed one of those items meanwhile | Done compares each staged field's stored base with the current value; any field B changed is listed "Patrick moved *Lunch* to 12:15 since you started — [Keep his] [Use yours]" before anything is written (§11.6, sync-F4). |
| A shuffles a day (one atomic batch), B edits one item on that day | Per-field merge; the hub overlap check flags any resulting overlap. |
| The owner presses **Edit the week here** on two devices or tabs | One transaction on `setup` (§10.1; the rules accept the unchanged edit stamps and wizard claim it carries, sync-F1); the second press sees "You already turned this on" and writes nothing. No other director gets the button, and the rules refuse the same write from them (§8.2, Q8). |
| The owner starts the wizard on two devices | Claim by transaction on `setup/meta/wizard`; the second device sees "You're setting up 2027 on another device (step 3 of 5, 4 min ago) [Watch] [Take over]" (take over only after 15 min idle). A non-owner director sees a read-only line, "Patrick is setting up 2027 (step 3 of 5)", and no claim button; the rules refuse their write (Q8). |
| Two refs tap a bracket winner | On one device the handler re-reads the match and ignores a tap on a decided match ("Already recorded by Jenn"). Across devices (or a tap queued offline) the last ack wins for that match, the 60 s "changed right after you" toast tells the other ref, and if the change makes a later recorded match impossible the bracket goes to **re-check** and awards no medals until a ref resolves it (§5.7.4, sync-F9). |
| Two editors add teams to the same cleanup meal | Per-team leaves: both stick. |

### 6.7 Presence: "Jenn is also here", and the Devices list

- **Presence is untouched** (`registerPresence` keeps `set({at})`; the footer chip is unchanged).
- **Write protocol (sec-F7).** Editor devices only, after approval: on every connect,
  `editorsHere/<myKey>/<presenceId>` is `set({at: TIMESTAMP, v: APP_VERSION})` with
  `onDisconnect().remove()`; in the builder, `update({at: TIMESTAMP, where})` on each screen/sheet
  change and `where` removed on leaving. The node is editor-read and editor-write, key-pinned to
  the writer (`SELF($k)`), `at === now` on every write and a 1 s floor per row; viewers can
  neither write nor receive it, and only editor devices hold its listener. Under pre-R1 rules the
  writes are refused and swallowed (the feature just shows nobody).
- **`where` vocabulary** (`^[a-z0-9:_-]{1,60}$`, no `/`; removed rather than blanked on leaving): `hub`, `week`, `schedule:typical`,
  `schedule:<dk>`, `item:<dk>:<bid>`, `rain:<dk>`, `games`, `game:<gid>`, `teams`, `team:<tid>`,
  `people`, `campers`, `meals`, `verses`, `cleanup`, `electives`, `wizard`, `restore`.
- **Display.** Header: up to three initials, or "Jenn is also here" on a phone; tap → "Jenn ·
  Tuesday's schedule · 2 min ago". On a matching screen: "Jenn is also editing Tuesday — changes
  merge field by field". In a sheet with the same `item:`: "Jenn is editing this item too".
  Names resolve `memberKey → memberDirectory[key].name` and **fail closed** like
  `chatAuthorName` ("Another director" with no directory); only keys whose directory role is
  editor are shown. This tab's own `presenceId` is skipped; another device of the same member
  shows "You (another device)".
- **Devices list** (hub ⋯): editor devices only — presence rows (whose `at` is within 10 minutes)
  of members whose directory role is editor, each matched to its `editorsHere` row by device id
  and grouped by build `v`; an editor presence row with no matching `editorsHere` row is "older
  than the S4 build". It is a hint, never a gate: "2 director devices are on an older version —
  they update when reopened". (Old *viewer* builds don't matter here: they never write setup or
  config.)
- **No heartbeat.** Ghost rows last until the server notices the dead socket.

### 6.8 Bad Wi-Fi: what survives what

| Area | Offline edit? | Survives reload / force-quit? | How |
|---|---|---|---|
| Scores (`state`) | ✅ | ✅ | existing `_syncBase` merge |
| Team names and branding (`state.teams`) | ✅ | ✅ | same, per field (S2b) |
| Games and competition days (`config`) | ✅ | ✅ **new** | `_cfgBase` merge (S3) |
| Schedule, rain plan, week dates, meals, verses, rota, electives (`setup`) | ✅ | ✅ **new** | `setupBase` merge (S4) |
| Undo stack, rain draft (with bases), wizard answers, clashes, quarantine | ✅ | ✅ | localStorage |
| Restore point taken automatically | queued (outbox, ≤ 3) | ✅ | uploaded on reconnect; the action proceeds (undo covers it) |
| Team photos, People actions, walk-up request, the wizard, a restore | ❌ "Needs a connection" on the control | n/a | large, one-shot or privacy-bound |
| Campers | ⏳ typed names wait **on screen** ("Waiting for signal — keep this screen open") and send when it's back | ❌ by design (memory only; closing the sheet asks first) | P12 (ux-R12) |
| "Tell people" alert | the **intent** only | ✅ intent | re-asked on reconnect, never auto-sent late (§12.2) |

"Needs a connection" comes from `.info/connected` and greys the control with that sentence;
a **refused** write is a different, red state in the sync line ("Couldn't save … — tap for
details"). The two are never shown with the same words.

### 6.9 Two tabs of the same camp (the documented limit, closed)

- **Every editor tab starts undecided (sync-F17).** As soon as a role is known — including the
  role painted from the cached hint at boot (app.js:8724-8727), before auth confirms it — the tab
  requests `navigator.locks.request('camp-writer:' + CAMP.id, {ifAvailable: true},
  holdUntilUnload)`. Until the lock is decided, `tabWriter` is `null`: nothing is persisted and
  pushes are held (queued, not dropped), so the load-time migrate, a UI-only `saveState()` or a
  first-snapshot adopt can't write the cache ahead of the decision. Viewers don't lock (C27) and
  are writers by default (they have no unconfirmed edits to protect).
- **One persistence gate.** All seven `localStorage.setItem(STORAGE_KEY, …)` sites (app.js 2039,
  2062, 2254, 2299, 2324, 2582, 2638) and the setup key's writer go through one
  `persistState()` / `persistSetup()` that is a no-op unless `tabWriter === true`. A test scans
  app.js for any other `setItem(STORAGE_KEY`.
- **Not granted → retry** every 250 ms for **1.5 s** before concluding another tab holds it (a
  reloading page can briefly still hold the lock, e.g. after `doReload`/bfcache). If the API is
  missing or throws, **fail open** (today's behaviour) and fall back to a
  `BroadcastChannel('camp-tabs:' + CAMP.id)` hello/claim where available.
- **Read-only tab:** `tabReadOnly = true`; `canEdit()` returns false while it is set (so every
  existing write gate holds), it never writes `STORAGE_KEY` or the setup key, and a bar says
  "This camp is open in another tab — this one is view-only. **[Use this tab instead]**". That
  button requests with `{steal: true}`; the old tab's lock promise rejects → it **first** sets
  `tabWriter = false` (so nothing it does from here persists, including the ack handlers'
  `writeConfirmedTree`), then flushes its pushes, then shows the same bar. The new writer then
  `doReload()`s to re-adopt from storage and server; any of the old tab's edits still unacked
  are in the cache it last wrote as a writer and are re-merged by the first-snapshot merge.
- `reloadBlocked()` and the auto-reload are unchanged for a read-only tab (it has nothing
  unconfirmed). Tests use a stubbed `navigator.locks`, including "old page still holds the lock
  for 800 ms after reload ⇒ new page becomes the writer", "nothing persisted while undecided",
  and "an ack arriving after demotion doesn't touch the cache".

### 6.10 Rendering builder screens without fighting remote edits

- The builder stops rebuilding `view.innerHTML` on every `renderAll` (settings.js:60). New
  screens render per section container through `setHtmlIfChanged`; lists use a small keyed
  reconciler `patchRows(container, items, keyFn, rowHtml)` that never replaces the row holding
  `document.activeElement`. The `<jelly-tabs>` rebuild goes away (plain buttons).
- Setup and config adopts **apply data immediately**. If `editorMidEntry()` is true (a score or
  builder field focused), the home `renderAll` is deferred to the idle tick (`renderOwed`);
  inside the builder, containers holding focus get per-field patches only (§6.4.9).
- Sheets (bottom sheets on phones, the right pane on laptops) re-render only their read-only
  parts on remote change. A sheet's draft lives exactly as long as the sheet: closing it by any
  path asks Save/Discard when dirty (fixes B1). `builderSheetDirty()` feeds `reloadBlocked()`
  only, never adoption.

### 6.11 New year vs stale devices (the epoch)

- The wizard writes the new epoch to `state/meta` **and** `setup/meta` in the same atomic update.
- State engine: §6.2 #3. Config engine: §6.3.4. Setup engine: §6.4.4. In all three, unsent work
  from a previous epoch is **stranded** (downloadable JSON), never applied.
- Every device that adopts a new `state.meta.epoch` different from
  `lsKey('campScoreboardEpochSeen')` clears device-local `followTeam` (then `adoptMemberTeam`
  re-applies the account's team), `identity`, day ranks, dismissed announcements, the undo stack,
  clashes, the rain draft and the wizard draft, and re-shows the team picker. The first sight of
  the legacy epoch just records it. (An epoch going *back* — "Undo the new-year setup", §7.3 —
  is a change like any other and runs the same reset.)
- The history drawer filters to `at >= state.meta.epochAt` (no filter when `epochAt` is absent)
  with **Show earlier years**.
- **Accepted residual:** a device that is online and mid-way through sending a score at the very
  moment of the commit can land that one write after the clear (it was already on the wire). The
  wizard is off-season only, its claim screen and the Devices list show who else is online, and
  the hub's Games row would show the stray result as "a result for a game that hasn't been played
  this year" for a director to clear.

### 6.12 Invariant checklist (review this table for every engine PR)

| CLAUDE.md invariant | State | Config v2 | Setup |
|---|---|---|---|
| RTDB prunes empties → heal | `normalizeSyncedState` (+ `brackets4`) | `migrateState` | `normalizeSetup`; "absent = empty" per section |
| Never push before the first pull | `remoteReady` | `configReady` | `setupReady` |
| Three-way first-snapshot merge, persisted base, canonical compare | existing + epoch | new | new |
| Identical snapshot keeps live objects | existing | per record | echo check |
| Concurrent editors don't clobber | per path (+ teams per field) | per field via transaction | per leaf + anchor rules |
| `editorMidEntry` allowlist | unchanged (+ setup timer) | render deferral only | focused-field hold |
| Missing snapshot key = empty | + `brackets4` in the 2619 list | n/a | per section when on |
| Deferred snapshot re-read, never replayed | existing | n/a (rebase) | `setupRefetchOwed` + `once()` |
| Server time for clocks and stamps | unchanged | `updatedAt` local ISO (as today) | `ServerValue.TIMESTAMP` at push |
| `reloadBlocked` | unchanged + total | `pendingConfigWrites` | pending, timer, dirty sheet, rain draft |
| THE INVARIANT (no ref before approval) | unchanged | unchanged | `initSetupSync` from `initSync`; campers/requests/`editorsHere` listeners post-approval and editor-only; walk-up uses one write + `once()` polls |
| One-shot lifecycle / terminal read | unchanged | unchanged | setup/campers/requests errors degrade only themselves; role or camp changes still reload |

---------------------------------------------------------------------------------

## 7. Undo, restore points, archive, backups

### 7.1 Undo (per device, immediate, conflict-aware)

- **What is undoable:** every `commitSetup` (schedule, rain plan, week dates, meals, verses,
  rota, electives), every config commit from the builder (games, competition days), team
  branding/name commits (via a thin `stateEdit(label, mutate)` wrapper that diffs `teams` with
  the per-field rule before `saveState()`), and camper edits (**memory only**).
- **Not undoable:** People/access actions (role, team assignment, add, remove, approve), which
  are security-relevant and keep their own confirms. The People screen says so: "Access changes
  can't be undone with Undo — change them back here." Scores keep their existing tools
  ("Undo last match", "Clear result").
- **Entry:** `{id, label, at, epoch, ops: [[domain, path, before, after], …]}` with canonical
  values from the engine's own diff; `domain` ∈ `setup | config | teams | campers`. Labels are
  plain words ("Moved Swim to 3:00 PM on Tue", "Renamed Foxes"). Entries over 20 KB (a turn-on
  seed, a restore) are not stacked; restore points cover them.
- **Undo applies `before` only where the current value still equals `after`** (canonical
  compare). Paths someone changed since are left alone and reported: "Undone" / "Undid 3 of 4
  changes — Patrick changed *Starts* since; left his" / "Can't undo — Patrick changed this
  since". The undo itself goes through the normal engines (syncs, survives offline) and becomes
  a new entry "Undid: …", which can itself be undone (no separate redo stack).
- **Synthetic entries:** each server-wins merge conflict (§6.4.6, §6.3.4) adds an entry recording
  what the merge did — it changed **mine into theirs** — so `before` = **my** value and `after` =
  **the server's** value, labelled "Bring back your offline change to …". Undo then applies
  `before` (mine) where the current value still equals `after` (theirs), which is exactly the
  normal undo rule; if someone has changed it again since, it reports "Can't undo — Patrick
  changed this since". (The first draft had these reversed, which made every synthetic undo
  report "Can't undo"; sync-F10. `undo.test.js`: offline clash → Undo pill restores mine.)
- **Storage:** memory + `lsKey('campSetupUndo')` (≤ 50 entries, ≤ 200 KB, oldest dropped).
  Camper ops are never persisted. Cleared on epoch change, on a role drop from editor, and by
  `clearLocalData`.
- **UI:** after each commit the **undo pill** "↶ Undo: moved Swim to 3:00 PM" (one at a time,
  6 s, then it docks in the header). Long-press or ⋯ opens "Recent changes" (last 50); any entry
  can be undone on its own when it doesn't conflict. Ctrl/Cmd-Z when focus isn't in a text field.

### 7.2 Restore points (shared, durable, any editor can restore)

- **Body** (`restoreBody/<rid>`, ONE JSON string so RTDB can't prune or array-coerce it):
  ```js
  { app: 'campScoreboardV3', camp: 'junior', at, epoch, appVersion,
    config, setup /* minus meta.on, meta.edited, meta.wizard, meta.seeded, meta.epoch, meta.epochAt */,
    state: { teams, results, brackets, brackets4, drafts, picRounds,
             picSetup /* modes only, never words */, bonuses, live, clocks,
             announcements, notice, meta } }
  ```
  **Excludes** campers, members, chat, presence, push data, photos (referenced only by
  `teams[i].photoV`). About 60 KB.
- **Index** (`restoreIndex/<rid>`): `{at, byKey, kind, label, note?, bytes, hash, epoch?, pinned?}`,
  `kind` ∈ `auto | manual | pre-seed | pre-delete | pre-import | pre-restore | pre-wizard | archive`.
  Body and index are written in one multi-path `update()` at the camp root.
- **Taken automatically before:** **Edit the week here** the first time, **Use the original week
  again**, and "Start this section again from the original" (`pre-seed`); deleting a game that
  has a result, a block that has games, a station, or a day's one-offs ("Clear all of Tuesday's
  changes", "Make Friday follow the typical day again") (`pre-delete`); importing a file
  (`pre-import`); any restore (`pre-restore`); the wizard (`pre-wizard`, plus the `archive`);
  the first rain-plan Done on a day (`auto`); and the first setup commit after 20 minutes without
  a point on this device (`auto`, label "Before Jenn's edits, 3:05 PM"). Throttled to one per
  5 minutes per device except the `pre-*` kinds.
- **Waiting at most 4 s:** a point that can't be written in 4 s goes to the outbox
  (`lsKey('campSetupRpOutbox')`, ≤ 3, newest kept) and is uploaded on reconnect; the action
  proceeds (local undo covers it). **Exceptions that require the point first, online:** the
  wizard, a restore, **Edit the week here** the first time, and "Start this section again from the
  built-in copy".
- **Retention:** keep the newest **40** unpinned `auto`/`pre-*` points (except `pre-wizard`) per
  camp: the creating device deletes the oldest beyond 40 (body + index in one update). Unpinned
  `manual` points are capped at **20** (the UI asks to delete one first). **Pin** ("Name and
  keep") turns any point into a kept one (`pinned: true`, write-once); the confirm says "Kept
  points can't be deleted from the app". **`archive` and `pre-wizard` points and every pinned
  point are undeletable by the rules** (§8.2, sec-F2), not just by the client: no editor, no
  bug and no retention routine can remove last year's archive. Removing one is a console job.
- **Restoring:**
  0. **Preconditions (sync-F8):** `pendingWritesTotal() === 0`, no unconfirmed diffs in any
     engine, online, writer tab; then `once()` re-reads of `state`, `config` and `setup` so the
     preview and the `pre-restore` point are computed from the server, not a stale local copy.
  1. The list reads only `restoreIndex` with `once()`.
  2. Read the body once; refuse another camp's point; warn on a different epoch ("This is from
     the 2026 week").
  3. Show what would change, computed locally against current data ("Tuesday's schedule (4
     items) · 2 games · team names"), with section checkboxes: **Schedule & week**, **Games**,
     **Teams**, **Notice**, and **Scores** (unticked unless the director ticks it, decision Q23;
     on → hold-to-confirm, §11.0).
  4. Write a `pre-restore` point (online, required).
  5. Apply each chosen section **through its engine as a diff** (setup via one `commitSetup`
     with `undo:false`; config via one transaction; teams/notice/scores via `saveState()`
     after `normalizeSyncedState`, today's `tryImport` path). Other sections and other editors'
     unrelated work are untouched.
     **Games without Scores never costs a result (sync-F8).** A Games restore keeps every game
     that isn't in the point but has a result, a bracket (either kind), a draft, a live match or
     a clock; the preview lists them ("Kept because they have scores: Rain bowling · 🥇 Foxes").
     They can be removed only by also ticking **Scores**, which shows their points and needs the
     hold-to-confirm. `pruneOrphanedGameData` runs **only** when Scores is ticked.
  6. **A restore never writes `meta/on`, `meta/epoch`** (state or setup), `meta/edited`,
     `meta/wizard` or `meta/seeded`. `on`, `epoch` and `wizard` are owner-only (decision Q8), so a
     director's restore would be refused if it tried. **A section whose `on` flag was off or absent
     in the point is not offered** ("This point is from before this section was edited here. Going
     back to the original week is the owner's switch."), because restoring its data while the
     section is on would leave it empty. One exception, **Undo the new-year setup** (§7.3), which
     exists to put the archived epoch back and is the owner's act.

### 7.3 The year archive

The wizard's step 3 writes a **pinned restore point of kind `archive`** with id
`rp-archive-<outgoing epoch>-<4 random>` (or `rp-archive-pre-<YYYYMMDD>-<4 random>` for the first
wizard run, when the legacy epoch has no id), `label: '2026 week (junior)'` and `note: 'Ferocious
Foxes won with 211 points'`. Only the owner can create `archive` and `pre-wizard` points (§8.2), as
only the owner runs the wizard. It is **verified by read-back** (`once()` of index and body; compare
`bytes` length and `hash`) before the wizard can clear anything; the wizard also offers a JSON
download of the same body. Campers and chat are not archived (decisions Q7 and Q16). The
changelog is append-only and stays; the history drawer filters by epoch (§6.11). Archives are
editor-read only and **the rules refuse deleting them** (§8.2): removing one is a console job.

- **Step 3 is idempotent (ux-R6, sync-F18b).** If the claim already records an `archiveId`, the
  step reads that point back: if it verifies against the current data, it is reused and the
  wizard moves on; if it is missing, unreadable or doesn't match, a **new** id (fresh random
  tail) is written and the claim updated. Back-then-Next, a reload, a failed read-back and a
  Take over all land here, so a create-only rule can never strand the wizard.
- **Step 4 re-checks freshness (sync-F18a).** Right before the clear, the wizard recomputes the
  content hash of the would-be archive body from fresh `once()` reads (excluding `at` and
  `appVersion`) and compares it with the verified archive's. If anything changed since step 3
  (a resumed or taken-over wizard hours later; a late score), it writes a fresh archive point
  first, verifies it, records it in the claim, and only then clears. A score written in the
  milliseconds between that check and the commit is the §6.11 accepted residual.
- **Undo the new-year setup (sync-F7).** Restoring the archive like any other point would bring
  back last year's data under *this* year's epoch, so last year's bonuses would be scored
  against the new double-points window and the history filter would keep hiding last year. The
  newest archive point therefore offers, while no newer archive exists, a dedicated **Undo the
  new-year setup** (Restore points → Past years, and the hub ⋯ for 14 days after a wizard run).
  It is **owner-only** (it writes the epoch back; other directors see Past years and Download, and
  "Only Patrick can undo the new-year setup"). It has the restore preconditions (§7.2 step 0), a
  `pre-restore` point and the hold-to-confirm, and is **one atomic root update** that puts back: every archived state section including
  scores; `state/meta/epoch` and `epochAt` to the archived values (**deleted** for the legacy
  epoch, which re-enables the 2026 constant pin); `setup` sections and
  `setup/meta/{epoch, epochAt, weekStart, double, finaleDow}` to the archived values (deleted
  where absent); `config` to the archived games. Every device sees an epoch change and runs the
  §6.11 reset and stranding. Members' teams and campers are not part of an archive and stay as
  they are.

### 7.4 Backups (v3), fixing B9

`backupJSON()` becomes the restore-point body plus `exportedAt`; it now **includes** `camp`,
`setup`, `notice`, `meta`, `clocks` and `brackets4`, and still never campers. `tryImport`:
refuses a backup whose `camp` differs from the active camp unless "copy from the other camp" is
ticked (then only Schedule, Games and Teams); accepts v2 as today; shape-checks `teams` (fixed
count, ids `t0…tN`); restores `announcements` (dropped before); writes a `pre-import` point
first; applies through the engines exactly like a restore.

---------------------------------------------------------------------------------

## 8. Security rules

### 8.1 Macros used below

The real `database.rules.json` spells every expression out; `tests/rules.test.js` re-expands
these macros and compares, and asserts the junior and senior blocks are identical modulo the
root name. `R` is the camp root literal.

- `MEMBER(R)` = today's `state/.read` expression.
- `EDITOR(R)` = today's `state/.write` expression.
- `SELF(x)` = `auth != null && ((auth.token.email != null && auth.token.email_verified == true && x === auth.token.email.toLowerCase().replace('.', ',')) || (auth.token.phone_number != null && x === auth.token.phone_number))`
- `BRANCH` = `!newData.isString() && !newData.isNumber() && !newData.isBoolean()`
- `STR(n)` = `newData.isString() && newData.val().length <= n`; `NESTR(n)` adds `&& newData.val().length >= 1`
- `INT(a,b)` = `newData.isNumber() && newData.val() >= a && newData.val() <= b`
- `EMOJI` = `NESTR(16) && !newData.val().contains('<') && !newData.val().contains('>') && !newData.val().contains('&') && !newData.val().contains('"')`
- `DK` = `/^(sun|mon|tue|wed|thu|fri|sat)$/`
- `ANCHOR` = `newData.parent().child('start').exists() && newData.parent().child('label').exists()`
  — on **every** block field, `start` and `label` included (sync-F5). A whole-record create writes
  both, so it passes; any partial write into a record that no longer exists (a `{start, end}` time
  move, a label edit) finds one of the pair missing and is refused, instead of recreating half a
  block.
- `TYP(dk, bid)` = `newData.parent().parent().parent().parent().child('typical').child(bid)` (from
  a leaf at `patches/$dk/$bid/<field>`: 1 = `$bid`, 2 = `$dk`, 3 = `patches`, 4 = `setup`)
- `PANCHOR` = `$dk.matches(DK) && TYP($dk,$bid).child('start').exists() && TYP($dk,$bid).child('label').exists() && newData.parent().parent().parent().parent().child('days').child($dk).child('typical').val() === true`
  — a patch field may only be written for a typical block that exists, on a day that **uses** the
  typical day (sync-F16b). Placed on every patch leaf **including `teams`**, which sits at the same
  depth as `start` (four `.parent()` calls, never five; sync-F6 / sec-F6).
- `NOWKEEP` = `newData.isNumber() && (newData.val() === now || newData.val() === data.val())` — a
  stamp must be server time when it is written, but a whole-node write (A1's transaction, a
  restore) may carry an existing stamp unchanged (sync-F1).
- `SELFKEEP` = `newData.val() === data.val() || SELF(newData.val())` — the same for `byKey`
  fields: yours when written, someone else's only if it is carried unchanged.
- `OWNER` = `SELF('patricksimpson,fx@gmail,com')` — the writer is the owner (decision Q8). The
  literal is the one the members rule's owner-key immutability already uses, and `rules.test.js`
  asserts it equals `OWNER_MEMBER_KEY` in both roots (§8.10). A phone sign-in never matches (the
  literal isn't a phone number), so the owner signs in with Google.
- `OWNERKEEP` = `newData.val() === data.val() || OWNER` — a value may be carried unchanged by anyone
  (a whole-node write, a stale cache) but changed only by the owner. Like every macro it expands
  inside parentheses, so `X && OWNERKEEP` means `X && (A || B)`. Every owner clause sits on a
  **leaf**: the design doesn't depend on how rules compare whole branches, or on whether ancestor
  `.validate` runs (§8.1 below).

**Why the anchors matter.** CLAUDE.md records that RTDB does not evaluate an ancestor's `.validate`
for a deeper write (the known `state/<unknown>/<child>` hole); a reviewer's emulator run
(sec-review note a) saw ancestor validates evaluated on the merged data instead. **The design does
not depend on which is true:** leaf anchors refuse a field write into a deleted record either way,
and record-level `hasChildren`/`BRANCH` checks are added as well (they certainly protect
whole-record and container writes). Before R1, one probe against the **live** database settles
it (an editor, from a browser console, writes `campScoreboard/state/zzz-probe/x = 1`: refused ⇒
ancestors are evaluated; accepted ⇒ CLAUDE.md is right, and the stray is deleted at once — old
builds ignore unknown state keys), and CLAUDE.md and `rules.test.js` are corrected to match. The
client's existence check and `validBlock` skip stay as defence in depth.

### 8.2 New blocks (junior shown; senior identical with `seniorScoreboard`)

Changed in review: tolerant stamps (sync-F1), anchor pairs (sync-F5), the patch `teams` depth
(sync-F6/sec-F6), patches tied to typical days (sync-F16b), `fromEpoch`/`answers`/`joinOpen`
(sync-F19, ux-R5, sec-F1), `BRANCH` on every container (sec-F9), campers' `ord` pair, the
photo cap and charset (sec-F3/F10), the walk-up throttle and block list (sec-F1), protected
restore points (sec-F2) and the editor-only `editorsHere` node (sec-F7). **Changed 2026-10-27
(owner answer Q8):** `OWNER` / `OWNERKEEP` clauses on `meta/on/*`, `meta/epoch`, `meta/epochAt`,
every `meta/wizard` leaf and the `archive` / `pre-wizard` restore kinds; the matching `state/meta`
pair is in §8.3.

```jsonc
"setup": {
  ".read": "MEMBER(R)",
  ".write": "EDITOR(R)",
  ".validate": "BRANCH",
  "meta": {
    ".validate": "BRANCH",
    "schema":    { ".validate": "INT(1,99)" },
    "on":        { ".validate": "BRANCH",                  // Q8: every value changes only by the owner
                   "$s": { ".validate": "$s.matches(/^(schedule|meals|verses|cleanup|electives)$/) && newData.isBoolean() && OWNERKEEP" } },
    "seeded":    { ".validate": "newData.hasChildren(['at','byKey','from'])",
                   "at": { ".validate": "newData.isNumber() && newData.val() <= now" },
                   "byKey": { ".validate": "SELFKEEP" },
                   "from": { ".validate": "STR(60)" },
                   "$other": { ".validate": false } },
    "weekStart": { ".validate": "newData.isString() && newData.val().matches(/^20[0-9]{2}-[0-1][0-9]-[0-3][0-9]$/)" },
    "double":    { ".validate": "newData.hasChildren(['fromDow','fromMin','toDow','toMin'])",
                   "fromDow": { ".validate": "INT(0,6)" }, "fromMin": { ".validate": "INT(0,1439)" },
                   "toDow":   { ".validate": "INT(0,7)" }, "toMin":   { ".validate": "INT(0,1439)" },
                   "$other": { ".validate": false } },
    "finaleDow": { ".validate": "INT(0,6)" },
    "epoch":     { ".validate": "newData.isString() && newData.val().matches(/^w20[0-9]{6}(-[2-9])?$/) && OWNERKEEP" },
    "epochAt":   { ".validate": "newData.isNumber() && newData.val() <= now && OWNERKEEP" },
    "joinOpen":  { ".validate": "newData.isBoolean()" },
    "skip":      { ".validate": "BRANCH",
                   "$s": { ".validate": "$s.matches(/^(campers|meals|verses|cleanup|electives)$/) && newData.isBoolean()" } },
    "edited":    { ".validate": "BRANCH",
                   "$s": { ".validate": "$s.matches(/^(week|schedule|meals|verses|cleanup|electives)$/) && newData.hasChildren(['at','byKey'])",
                           "at": { ".validate": "NOWKEEP" },
                           "byKey": { ".validate": "SELFKEEP" },
                           "$other": { ".validate": false } } },
    "wizard":    { ".validate": "newData.hasChildren(['step','byKey','at','fromEpoch'])",
                   // Q8: a claim is the owner's alone — every leaf requires OWNER whenever it is written
                   "step": { ".validate": "INT(1,5) && OWNER" },
                   "byKey": { ".validate": "SELFKEEP && OWNER" },
                   "at": { ".validate": "NOWKEEP && OWNER" },
                   "fromEpoch": { ".validate": "NESTR(40) && OWNER" },          // 'legacy' for the legacy epoch, never ''
                   "archiveId": { ".validate": "newData.isString() && newData.val().matches(/^rp-[a-z0-9-]{4,48}$/) && OWNER" },
                   "answers": { ".validate": "STR(2000) && OWNER" },           // JSON string: the step-1/2 answers (ux-R5)
                   "$other": { ".validate": false } },
    "$other": { ".validate": false }
  },
  "days": { ".validate": "BRANCH", "$dk": {
    ".validate": "$dk.matches(DK) && newData.hasChildren(['typical'])",
    "typical":     { ".validate": "newData.isBoolean()" },
    "tag":         { ".validate": "STR(60) && newData.parent().child('typical').exists()" },
    "placeholder": { ".validate": "newData.isBoolean() && newData.parent().child('typical').exists()" },
    "$other": { ".validate": false } } },
  "typical":   { ".validate": "BRANCH", "$bid": BLOCK },
  "dayBlocks": { ".validate": "BRANCH", "$dk": { ".validate": "$dk.matches(DK) && BRANCH", "$bid": DAYBLOCK } },
  "patches":   { ".validate": "BRANCH", "$dk": { ".validate": "$dk.matches(DK) && BRANCH", "$bid": PATCH } },
  "meals": { ".validate": "BRANCH", "$dk": { ".validate": "$dk.matches(DK) && BRANCH", "$meal": {
    ".validate": "$meal.matches(/^(breakfast|lunch|supper)$/) && newData.hasChildren(['dish'])",
    "dish":  { ".validate": "NESTR(80)" },
    "emoji": { ".validate": "EMOJI && newData.parent().child('dish').exists()" },
    "$other": { ".validate": false } } } },
  "verses": {
    ".validate": "BRANCH",
    "theme": {
      ".validate": "newData.hasChildren(['text'])",
      "text":  { ".validate": "NESTR(600)" },
      "title": { ".validate": "STR(80) && newData.parent().child('text').exists()" },
      "ref":   { ".validate": "STR(80) && newData.parent().child('text').exists()" },
      "$other": { ".validate": false } },
    "days": { ".validate": "BRANCH", "$dk": {
      ".validate": "$dk.matches(DK) && newData.hasChildren(['text'])",
      "text":  { ".validate": "NESTR(600)" },
      "ref":   { ".validate": "STR(80) && newData.parent().child('text').exists()" },
      "video": { ".validate": "newData.isString() && newData.val().length <= 300 && newData.val().beginsWith('https://') && newData.parent().child('text').exists()" },
      "$other": { ".validate": false } } },
    "$other": { ".validate": false } },
  "cleanup": { ".validate": "BRANCH", "$dk": { ".validate": "$dk.matches(DK) && BRANCH", "$meal": {
    ".validate": "$meal.matches(/^(breakfast|lunch|supper)$/) && BRANCH",
    "$tid": { ".validate": "$tid.matches(/^t[0-9]$/) && newData.val() === true" } } } },
  "electives": {
    ".validate": "BRANCH",
    "stations": { ".validate": "BRANCH", "$st": {
      ".validate": "$st.matches(/^st-[a-z0-9-]{1,36}$/) && newData.hasChildren(['name'])",
      "name":  { ".validate": "NESTR(60)" },
      "emoji": { ".validate": "EMOJI && newData.parent().child('name').exists()" },
      "$other": { ".validate": false } } },
    "slots": { ".validate": "BRANCH", "$dk": { ".validate": "$dk.matches(DK) && BRANCH", "$slot": {
      ".validate": "$slot.matches(/^s[0-2]$/) && BRANCH", "$st": {
      ".validate": "$st.matches(/^st-[a-z0-9-]{1,36}$/) && newData.hasChildren(['ord'])",
      "ord": { ".validate": "newData.isNumber()" },
      "people": { ".validate": "BRANCH", "$p": {
        ".validate": "$p.length <= 200 && newData.hasChildren(['name','ord'])",
        "name": { ".validate": "NESTR(60) && newData.parent().child('ord').exists() && newData.parent().parent().parent().child('ord').exists()" },
        "ord":  { ".validate": "newData.isNumber() && newData.parent().child('name').exists() && newData.parent().parent().parent().child('ord').exists()" },
        "$other": { ".validate": false } } },
      "$other": { ".validate": false } } } } },
    "$other": { ".validate": false } },
  "$other": { ".validate": false }
}
```

`BLOCK` (typical items; `start` + `label` are the anchor pair, and `start` also checks the key
pattern):
```jsonc
{
  ".validate": "newData.hasChildren(['start','end','label','type'])",   // whole-record shape (defence in depth, §8.1)
  "start":     { ".validate": "$bid.matches(/^b-[a-z0-9-]{1,36}$/) && INT(0,1439) && ANCHOR" },
  "end":       { ".validate": "INT(1,1440) && ANCHOR && newData.val() > newData.parent().child('start').val()" },
  "label":     { ".validate": "NESTR(120) && ANCHOR" },
  "emoji":     { ".validate": "EMOJI && ANCHOR" },
  "type":      { ".validate": "(newData.val() === 'activity' || newData.val() === 'games' || newData.val() === 'elective') && ANCHOR" },
  "slot":      { ".validate": "(newData.val() === 0 || newData.val() === 1 || newData.val() === 2) && ANCHOR" },
  "noTime":    { ".validate": "newData.isBoolean() && ANCHOR" },
  "meal":      { ".validate": "(newData.val() === 'breakfast' || newData.val() === 'lunch' || newData.val() === 'supper') && ANCHOR" },
  "ord":       { ".validate": "newData.isNumber() && ANCHOR" },
  "alertKey":  { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9-]{1,48}$/) && ANCHOR" },
  "overlapOk": { ".validate": "newData.isBoolean() && ANCHOR" },
  "teams":     { ".validate": "newData.hasChildren() && ANCHOR",
                 "$tid": { ".validate": "$tid.matches(/^t[0-9]$/) && newData.val() === true" } },
  "$other":    { ".validate": false }
}
```
`DAYBLOCK` = `BLOCK` with `start` validated as `$dk.matches(DK) && $bid.matches(/^b-[a-z0-9-]{1,36}$/) && INT(0,1439) && ANCHOR`, plus `"off": { ".validate": "newData.isBoolean() && ANCHOR" }`.

`PATCH` (no record of its own; `$bid` has `".validate": "BRANCH"`, and **every leaf** requires the
typical block's `start` and `label` and a typical day): `start` `INT(0,1439) && PANCHOR`; `end`
`INT(1,1440) && PANCHOR`; `label` `NESTR(120) && PANCHOR`; `emoji` `EMOJI && PANCHOR`; `type`,
`slot`, `noTime`, `meal`, `ord`, `overlapOk`, `off` as in `BLOCK` with `&& PANCHOR` in place of
`ANCHOR`; **`teams` `newData.hasChildren() && PANCHOR`** — the `teams` node is at the same depth
as `start`, so it is the same four-parent `PANCHOR` (the draft's "five parents, one level deeper"
reached `<root>/typical` and refused every team patch, including junior's seed; sync-F6, sec-F6) —
with the same `$tid` child; `"$other": false`. No `alertKey` in a patch.

```jsonc
"campers": {
  ".read": "EDITOR(R)",
  ".write": "EDITOR(R)",
  ".validate": "BRANCH",
  "$tid": {
    ".validate": "$tid.matches(/^t[0-9]$/) && BRANCH",
    "$cid": {
      ".validate": "$cid.matches(/^c-[a-z0-9]{6,20}$/) && newData.hasChildren(['name','ord'])",
      "name": { ".validate": "NESTR(40) && newData.parent().child('ord').exists()" },   // anchor pair:
      "ord":  { ".validate": "newData.isNumber() && newData.parent().child('name').exists()" },   // a rename into a moved camper is refused
      "$other": { ".validate": false } } }
},
"teamPhotos": {
  ".read": "MEMBER(R)",
  "$tid": {
    ".write": "EDITOR(R)",
    ".validate": "$tid.matches(/^t[0-9]$/) && newData.hasChildren(['v','data'])",
    "v":    { ".validate": "newData.isNumber() && newData.val() >= 0" },
    "data": { ".validate": "newData.isString() && newData.val().length <= 100000 && newData.val().matches(/^data:image\\/(png|jpeg);base64,[A-Za-z0-9+\\/]+={0,2}$/)" },
    "$other": { ".validate": false } }
},
"accessRequests": {
  ".read": "EDITOR(R)",
  ".indexOn": ["at"],
  "$reqKey": {
    ".read": "SELF($reqKey)",
    ".write": "(SELF($reqKey) && newData.exists() && newData.child('at').val() === now && root.child(R).child('setup').child('meta').child('joinOpen').val() === true && !root.child(R).child('accessBlocked').child($reqKey).exists() && !(MEMBER(R)) && (!data.exists() || data.child('at').val() < now - 60000)) || (!newData.exists() && (EDITOR(R) || (SELF($reqKey) && data.child('at').val() < now - 60000)))",
    ".validate": "($reqKey.contains('@') || $reqKey.beginsWith('+')) && $reqKey.length <= 200 && newData.hasChildren(['name','at'])",
    "name": { ".validate": "NESTR(60)" },
    "note": { ".validate": "STR(200)" },
    "at":   { ".validate": "newData.isNumber() && newData.val() === now" },
    "$other": { ".validate": false } }
},
"accessBlocked": {
  ".read": "EDITOR(R)",
  "$k": {
    ".write": "EDITOR(R)",
    ".validate": "($k.contains('@') || $k.beginsWith('+')) && $k.length <= 200 && newData.hasChildren(['at','byKey'])",
    "at":    { ".validate": "newData.isNumber() && newData.val() <= now" },
    "byKey": { ".validate": "SELFKEEP" },
    "$other": { ".validate": false } }
},
"restoreIndex": {
  ".read": "EDITOR(R)",
  "$rid": {
    ".write": "EDITOR(R) && (!data.exists() || (!newData.exists() && data.child('kind').val() !== 'archive' && data.child('kind').val() !== 'pre-wizard' && data.child('pinned').val() !== true))",
    ".validate": "$rid.matches(/^rp-[a-z0-9-]{4,48}$/) && newData.hasChildren(['at','byKey','kind','label','bytes','hash'])",
    "at":     { ".validate": "newData.isNumber() && newData.val() === now" },
    "byKey":  { ".validate": "SELF(newData.val())" },
    "kind":   { ".validate": "newData.isString() && newData.val().matches(/^(auto|manual|pre-seed|pre-delete|pre-import|pre-restore|pre-wizard|archive)$/) && ((newData.val() !== 'archive' && newData.val() !== 'pre-wizard') || newData.val() === data.val() || OWNER)" },   // Q8
    "label":  { ".validate": "NESTR(120)" },
    "note":   { ".validate": "STR(200)" },
    "bytes":  { ".validate": "INT(0,900000)" },
    "hash":   { ".validate": "newData.isString() && newData.val().matches(/^[0-9a-f]{8}$/)" },
    "epoch":  { ".validate": "STR(40)" },
    "pinned": { ".write": "EDITOR(R) && !data.exists() && newData.val() === true",
                ".validate": "newData.isBoolean() && newData.parent().child('at').exists()" },
    "$other": { ".validate": false } }
},
"restoreBody": {
  ".read": "EDITOR(R)",
  "$rid": {
    ".write": "EDITOR(R) && (!data.exists() || (!newData.exists() && root.child(R).child('restoreIndex').child($rid).child('kind').val() !== 'archive' && root.child(R).child('restoreIndex').child($rid).child('kind').val() !== 'pre-wizard' && root.child(R).child('restoreIndex').child($rid).child('pinned').val() !== true))",
    ".validate": "$rid.matches(/^rp-[a-z0-9-]{4,48}$/) && newData.isString() && newData.val().length <= 900000" }
},
"editorsHere": {
  ".read": "EDITOR(R)",
  "$k": { "$d": {
    ".write": "SELF($k) && (!newData.exists() || (EDITOR(R) && (!data.exists() || data.child('at').val() < now - 1000)))",
    ".validate": "$d.matches(/^[A-Za-z0-9_-]{8,64}$/) && newData.hasChildren(['at','v'])",
    "at":    { ".validate": "newData.isNumber() && newData.val() === now" },
    "v":     { ".validate": "INT(0,99999)" },
    "where": { ".validate": "newData.isString() && newData.val().matches(/^[a-z0-9:_-]{1,60}$/)" },
    "$other": { ".validate": false } } }
}
```
- `pinned`'s own `.write` grants exactly one update of an existing index row: setting `pinned`
  to `true` once. Its parent's rule refuses deleting an `archive`, a `pre-wizard` or a pinned row
  (and, via `root`, its body), so last year's archive survives any editor or client bug (sec-F2).
  An unpinned `auto`/`manual`/`pre-*` row stays deletable for retention. In a multi-path delete of
  index + body, `root` is the pre-write data, so the body rule still sees the index row.
- `accessRequests` (sec-F1): every create or rewrite must set `at` to server time, so a leaf write
  to `note` (which leaves `at` unchanged) is refused; a requester may delete their own row only
  after 60 s, so delete-and-recreate can't beat the throttle; a blocked identity can't write; and
  **nothing is accepted unless an editor has set `setup/meta/joinOpen`**, so publishing R1 opens
  no stranger-writable node until a director switches asking on (S7's People screen). The reviewer
  measured both bypasses of the draft rule in the emulator (25/25 delete-recreate cycles, 100
  leaf writes in 1.2 s) and the replacement refusing them.
- `teamPhotos/data`: the full-charset regex stops a quote-breakout payload that a prefix check
  lets through. The reviewer's emulator accepted the regex on a 149,000-char string; the R1 gate
  re-runs it at the 100,000 cap against the live evaluator (a scratch write by the owner), and if
  the live evaluator refuses long strings under a regex, the rule falls back to the prefix check
  plus `!contains('"')`, `!contains('<')`, `!contains(' ')` (the accessor's full-regex laundering
  stays either way).

### 8.3 Additive amendments to existing blocks

```jsonc
// state — one new optional branch (the new sync key):
"brackets4": { ".validate": "BRANCH" },
// state/teams/$i — leaf rules for the NEW optional branding fields only (sec-F3). id, name,
// counselor stay unvalidated and there is no $other:false, so a v183 whole-array write (which
// carries none of these fields) is still accepted:
"teams": { "$i": {
  "emoji":  { ".validate": "EMOJI && !newData.val().contains(\"'\")" },
  "short":  { ".validate": "NESTR(20) && !newData.val().contains('<') && !newData.val().contains('>') && !newData.val().contains('&') && !newData.val().contains('\"')" },
  "color":  { ".validate": "newData.isString() && newData.val().matches(/^[a-z]{2,12}$/)" },
  "photoV": { ".validate": "newData.isNumber() && newData.val() >= 0" } } },
// state/meta — the epoch pair is owner-only (decision Q8). No `$other:false` under `meta`: old
// builds' `lastDataChangeAt`, `hiddenCards`… stay valid, and a legacy camp has no epoch key at all.
// OWNERKEEP lets any whole-`meta` write carry an existing epoch unchanged:
"meta": {
  "epoch":   { ".validate": "newData.isString() && newData.val().matches(/^w20[0-9]{6}(-[2-9])?$/) && OWNERKEEP" },
  "epochAt": { ".validate": "newData.isNumber() && newData.val() <= now && OWNERKEEP" } },
// pushSchedule — two new OPTIONAL children:
"rev": { ".validate": "newData.isNumber() && newData.val() >= 0" },
"src": { ".validate": "newData.isString() && newData.val().matches(/^[0-9a-f]{8}$/)" },
```
(Presence is **not** amended any more: "also here" moved to `editorsHere`, C9.)

### 8.4 Deliberately unchanged

`config` (no `mark` key, no fence), `members` (no `name` cap change), `presence` (C9),
`changelog`, `chat*`, `chatRate`, `push`, `pushAlerts`, the root deny-all (which keeps
`pushServer/schedSeen` Worker-only). The owner key stays rules-immutable (rules#5 is fixed in the
client, §14). It now also gates four acts (decision Q8: `meta/on`, the wizard claim, the epoch
pair, and the `archive` / `pre-wizard` restore kinds) without adding a role: the member record's
shape is untouched.

### 8.5 Backward compatibility, both directions

| Writer × rules | Result |
|---|---|
| v183 (old) client × R1 rules | Every write it makes is unchanged and still valid: state paths (including the whole `teams` array, which carries none of the newly validated fields), the config whole-`set()`, members, presence `{at}`, chat, push. It never touches the new nodes and never writes `brackets4`, `rev` or `src`. Proven by replaying the recorded v183 write set (`tests/emulator/compat-old-client.mjs`). |
| New client × pre-R1 rules | `setup` listener denied → `setupDenied`, built-in copy, hub "not available yet". Restore points, campers, photos, requests: each disabled with "not available yet". `editorsHere` writes refused and swallowed (nobody shown as "also here"). A `brackets4` write would be refused → S2a quarantine shows one line instead of wedging scores (and S6b only ships after R1). The publisher's `rev`/`src` write would be refused → "Phone-alert schedule not updated" (push is dormant until after R1 anyway). Proven by `compat-new-client-old-rules.mjs`. |
| New client × R1 rules | Everything works; anchors refuse field writes into deleted records (quarantined, explained). |

### 8.6 Publish plan

- **R1 — one combined additive PUT**, after S2a has shipped (so a mis-ordered state write is
  quarantined, not wedged) and before S4. Contents: everything in §8.2 and §8.3 (the owner-only
  clauses included) **and the reveal blocks of `app-shell-redesign-spec.md` §4.4** (`revealPublic`,
  the one deliberately public, read-only path, and `revealFull`; each has a `real` and a `practice`
  child), so the owner pastes once (`BUILD-PLAN.md`
  steps 10 and 11). Inert until code
  uses each node; the only node a non-member could write, `accessRequests`, stays **closed**
  until an editor sets `setup/meta/joinOpen` (sec-F1), so there is no stranger-writable surface
  in the months between R1 and S7. Gate: the emulator suites (§8.8) print SAFE for both
  directions, and seeded setup trees for **both** camps (from `buildSeed`, including junior's
  team patches) are written successfully under the new rules in the emulator.
- **Size check (sec-review note b).** The combined file roughly doubles (≈ 82 KB minified, ≈ 110
  KB as committed). Before R1, confirm the published RTDB rules size limit; a PUT over the limit
  is refused and leaves the old rules live (nothing breaks), and in that case R1 splits into R1a
  (`state`/`teams`/`meta` amendments, `setup`, restore points, `editorsHere`, the reveal blocks) and R1b (`campers`,
  `teamPhotos`, `accessRequests`, `accessBlocked`), each with the same runbook.
- **Ancestor-validate probe** (§8.1) is run once before R1 and its result recorded in CLAUDE.md.
- **Optional F1 fence — only with evidence and the owner's yes.** If the hub ever reports
  "An older version re-published the built-in schedule" (a `pushSchedule` write without
  `rev`/`src`, possible only if phone alerts go live before S5a, decision Q3), the
  `pushSchedule/.validate` may become
  `newData.hasChildren(['weekStart','at','by','blocks','rev']) && (!data.child('rev').exists() || newData.child('rev').val() > data.child('rev').val())`.
  Never needed otherwise.
- **Any later rules change** (none planned) follows the same runbook.
- **CLAUDE.md policy change.** "Don't re-add a path before its feature" becomes: *"A new path may
  be published ahead of its feature only as part of a reviewed, additive, inert rules release
  with read gates at least as strict as its eventual use, emulator compat proofs in both
  directions, and the unauthenticated probes. `roster`/`contacts`-style member-readable,
  unvalidated placeholders remain forbidden."*
- The repo file and the console change in the **same commit** (rules-only commit, no `?v=`
  bump), then the code commit after the probes pass.

### 8.7 Runbook

Appendix E (rewritten in review, sec-F5). **No fetched executable:** the owner pastes three
short command blocks from the chat or this appendix into Cloud Shell — back up, publish, check.
The rules file is fetched with a cache-buster and its `sha256` printed; the owner compares the
first 8 characters with the ones the rules commit's message states, and nothing is published on
a mismatch. The read-back compares the live rules with that verified file. Then the
**discriminating checks** — ones only the new rules pass — are run from a browser console signed
in as the owner (an editor) and as a test counselor (§8.9), because unauthenticated probes return
`Permission denied` under the old and new rules alike (the one exception is the public
`revealPublic` read, which answers `null` only under the new rules, §8.9).

### 8.8 Emulator suites (opt-in, npm + Java; **a gate for R1**)

Each runs the same scenario against `old.rules.json` (today's published file) and
`database.rules.json`, printing SAFE/UNSAFE in the `fallback.mjs` style:
- `compat-old-client.mjs`: the recorded v183 write set passes the new rules.
- `compat-new-client-old-rules.mjs`: the new client degrades as in §8.5.
- `setup.mjs`: seeded trees for both camps accepted (**including junior's Tue/Wed/Thu team
  patches**, sync-F6); viewer can read, can't write; **a field write into a deleted block, a
  deleted day and a deleted typical block (patch) is REFUSED**, and so is a `{start, end}` time
  move and a lone `label` write into a deleted block (sync-F5); a patch write for a day whose
  `typical` is `false` is refused (sync-F16b); `meta/edited` requires server time and the
  writer's own key **when written**, and a whole-`setup` transaction carrying existing edit
  stamps and a live wizard claim is **accepted** (run as the owner, who alone can press A1; stamp,
  then A1 for a second section; sync-F1);
  a wizard claim with `fromEpoch: 'legacy'` accepted, with `''` refused; a scalar or a
  100,000-char string at `setup/typical`, `setup/meals`, a `$dk` level is refused (sec-F9);
  `$other` refusals.
- `restore.mjs`: create/delete of an `auto` point allowed; editing a label refused; `pinned`
  set once to `true` allowed, unset or set to `false` refused; **deleting an `archive`, a
  `pre-wizard` or a pinned point refused — index alone, body alone, or both in one update**
  (sec-F2); viewer can't read; `byKey` spoofing refused.
- `campers.mjs`: viewer read refused at the root, per team and per leaf; editor whole-camper
  create OK; a `name` write into a deleted camper refused (sync-F5); scalars at `campers`,
  `campers/t0` and `campers/t0/c-…` refused (sec-F9); unknown children refused.
- `access-requests.mjs`: with `joinOpen` absent every create is refused; with it on, a signed-in
  non-member can create their own row, not another's; a second write within 60 s refused; **a
  leaf write to `note` refused; delete-then-recreate within 60 s refused; a blocked identity
  refused** (sec-F1); a member can't create one; editor read/delete; another non-member can't
  read; an unverified email refused.
- `editors-here.mjs`: an editor writes its own row; a viewer's write and read refused; another
  editor's key refused; a write without a fresh `at` refused; a second write within 1 s refused;
  presence `{at}` unchanged under both rule sets (sec-F7).
- `teams-fields.mjs`: a v183 whole-`teams` array write accepted; `emoji` with markup, a 5,000-char
  `short`, a quote-breakout `color` refused (sec-F3); `teamPhotos/data` with a `"` or a space in
  the body refused, a 100,000-char valid PNG data URL accepted.
- `brackets4.mjs`: refused under old rules, accepted under new; a scalar refused.
- `owner-only.mjs` (decision Q8). As the **owner**, all **accepted**: A1's whole-`setup` transaction
  (carrying stamps and a live claim), `on/<s>` true then false, a wizard claim create and update,
  `setup/meta/epoch` + `state/meta/epoch` + `epochAt` in one atomic root update (the wizard commit's
  shape), an `archive` and a `pre-wizard` restore point. As a **non-owner editor**, each of those is
  **refused** (A1 and the wizard commit refuse as a whole); an unchanged `on` / epoch carried in a
  whole-node write is accepted; a `manual` point is accepted. As a viewer: refused as before. A
  phone-signed-in owner key is not recognised. It also **records, not assumes**, what a non-owner
  *delete* of `on/<s>`, an epoch key or the claim does (`.validate` isn't evaluated for deletes;
  §1.4 limit b) and the result goes into CLAUDE.md.
- The reveal suite `reveal.mjs` (`app-shell-redesign-spec.md` §4.4 list) runs in the same gate; it
  includes the anonymous-read, shape and delete-only-after-`until` cases of the public path.

### 8.9 Probes after publishing

**Unauthenticated** (must return `Permission denied` under old and new rules alike, both roots —
they prove nothing broke, not that R1 is live): GET `setup`, `setup/meta`, `campers`,
`campers/t0`, `teamPhotos`, `accessRequests`, `accessBlocked`, `editorsHere`, `restoreIndex`,
`restoreBody`; PUT `accessRequests/x@y,com` and `setup/meta/on/schedule`.

**The one deliberately public path** (`app-shell-redesign-spec.md` §4.4, decision of 2026-10-27):
unauthenticated GET `<root>/revealPublic` answers `null` under the new rules and
`Permission denied` under the old ones, so it is also an unauthenticated proof that R1 is live;
unauthenticated PUT `<root>/revealPublic/real` and GET `<root>/revealFull` answer
`Permission denied` under both.

**Discriminating checks (only the new rules pass these; sec-F5)**, from a browser console on the
live site:
- signed in as the **owner** (editor): `once('value')` of `<root>/setup/meta` and of `<root>/campers`
  **succeed** (`null`, no error) in both camps — under the old rules both are denied;
- signed in as a **test counselor** (viewer): `campers` → denied; `setup` → allowed; a write to
  `editorsHere/<own key>/<id>` → denied;
- signed in as a **non-member test account**: a `set()` of its own `accessRequests` row →
  denied while asking is closed; reading `members`, `state`, `setup`, `campers`, `restoreIndex`
  and another identity's request → denied;
- signed in as a **non-owner director** (a test editor; decision Q8): `once('value')` of
  `setup/meta` ALLOWED as for the owner, and `set(false)` at `<root>/setup/meta/on/schedule`
  **DENIED**. As the owner the same write is ALLOWED, so `.remove()` it at once: absent and `false`
  both mean the original week, so the probe changes nothing a camp can see. Run it at R1, before
  any section is on.
The R1 checklist in CLAUDE.md records each line's result.

### 8.10 `tests/rules.test.js` (changed on purpose in the R1 commit)

- The gated-path list (`:37-44`) gains the new nodes, both camps.
- "state accepts exactly the synced keys" (`:294`) gains `brackets4`.
- "unused PII paths do not exist" (`:164`) still forbids `roster`/`contacts`, and now asserts
  `campers` exists with `.read` **equal to the editor expression** and no member grant below,
  and that no other node name contains `camper`.
- "image fields are pinned to inline JPEG data URLs" (`:128`) accepts `png|jpeg` for
  `teamPhotos` only, with the full base64 charset regex.
- New: every setup block leaf (anchor fields included) contains `ANCHOR` or `PANCHOR`, and the
  patch `teams` rule is the four-parent `PANCHOR`; every setup/campers container has `BRANCH` or a
  `hasChildren`; `accessRequests` create requires `SELF`, `!MEMBER`, `at === now`, `joinOpen` and
  not-blocked, and self-delete requires the 60 s age; restore nodes refuse deleting
  `archive`/`pre-wizard`/pinned rows and `pinned` is write-once; `editorsHere` read and write are
  editor-only and key-pinned; `$other:false` on every new named record; `OWNER_MEMBER_KEY` equals
  the owner literal in both roots; `where` has no `/`; stamps use `NOWKEEP`/`SELFKEEP`.
- New (decision Q8): the `OWNER` literal equals `OWNER_MEMBER_KEY` and the members-immutability
  literal in both roots; `meta/on/$s`, `setup/meta/{epoch,epochAt}`, `state/meta/{epoch,epochAt}`
  and every `meta/wizard` leaf contain `OWNER` or `OWNERKEEP`; the restore `kind` rule names
  `archive` and `pre-wizard` together with `OWNER`; no owner clause sits on a branch node; the
  reveal blocks (`app-shell-redesign-spec.md` §4.4) are present in both roots, identical modulo the
  root name; `revealPublic/.read` is the only `true` read in either root and no other path grants
  anonymous read.

---------------------------------------------------------------------------------

## 9. Accessor layer, every consumer, and the home-screen seam

### 9.1 Rules of the layer

- One block in **app.js** between `// ── SEAM: week data accessors ──` markers holds the only
  functions that read week data. The existing `const` aliases (`DAY_SCHEDULE = CAMP.daySchedule`,
  …) move inside the block unchanged (`tests/camps.test.js` reads them by global name, which
  still works).
- **While a section is off, an accessor returns the camps.js constant itself** (same object):
  `scheduleForDow(d) === DAY_SCHEDULE[d]`. That is how S1 is provably a no-op.
- When on, it returns data derived from the setup tree **in the same shape**, memoized per
  `setupRev` (same object until the tree changes).
- Each accessor calls into setup-sync.js through `typeof … === 'function'` guards, so deleting
  setup-sync.js's script tag falls back to the built-in copy everywhere.
- **Sanitizing happens inside the accessors** (≈ 60 call sites interpolate `teamEmoji()` raw;
  three inject `TEAM_ACCENT` into `style=`), and the sanitizer functions themselves live in
  **`camp-core.js`** (`safeEmoji`, `safeShort`, `safeColorVars`, `safeCrestSrc`, `safeVideoUrl`)
  so the TV page uses the very same code (P14, sec-F3): emoji ≤ 16 UTF-16 units with `<>&"'`
  removed, else the default; short names escaped and ≤ 20; colours only a palette id or a
  `#rrggbb` legacy hex; image sources only a **whole** data URL matching
  `^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$` (a prefix check, like today's
  `chatSafeImageSrc`, lets a quote-breakout through) or the `images/team-shields/` pattern; verse
  video only `https://`. Images are set with `img.src = …` (DOM property), never by string
  concatenation into markup.
- Accessors return plain data (never HTML), never throw on missing data.

### 9.2 Accessors, their sources, and the consumers that switch to them

| Accessor | While off (built-in) | While on (shared) | Consumers converted (file:line at v183) |
|---|---|---|---|
| `scheduleForDow(dow)` | `DAY_SCHEDULE[dow]` | `resolveDay(tree,dow).map(legacyBlock)` | `nowBannerHtml` app.js:744; schedule sheet 918; `buildDayIcs` 1007; push.js 1079, 1093, 1373, 1701 |
| `planForDow(dow)` | seed-resolve of `DAY_SCHEDULE` (same function over a built-in tree, cached) | `resolveDay` rich blocks `{id, dk, start, end, label (rendered), emoji, type, slot?, meal, noTime?, alertKey, origin, overlapOk?}` | builder, schedule sheet, .ics, push publisher |
| `scheduleWeek()` | `{0..6: DAY_SCHEDULE[d]}` | same from setup | push.js `pushScheduleBlocks` 117-135 |
| `weekDays()` | `SCHED_DAYS` + names + `config.days` dows | `setup.days` + names + `config.days` | schedule sheet 896, 917; .ics; hub |
| `dayLabel(dow)` | `DAY_NAMES[dow]` | same | app.js 4556, 5055-5062, 5086, 5105, 5140, 5213, 5338 |
| `competitionDays()` | `state.config.days` | `state.config.days` (the authority, C6) | `renderDayTabs`, `dayGamesHTML`, `defaultDay` |
| `competitionDows()` | `[1,2,3,4,5]` (today's literal loops) | dows of `config.days` | verse chips 5054; cleanup 5177, 5212 |
| `blockMeal(b)` / `blockKey(b)` / `blockPushId(b,dow,i)` | `legacyMealOf(label)` (app.js:539-561 moved here) / `pushBlockKey(label)` / `'d'+dow+'-'+start+'-'+i` | `b.meal` / `b.alertKey` / `dk+'-'+b.id` | `mealInfo`, `decorateMealBlock`, `blockMealName`, push.js |
| `mealFor(dow, meal)` | `MEALS[dow][meal]` | `setup.meals[dk][meal]` | `mealInfo` 539-543 → 547 |
| `mealStart(dow, meal)` | `MEAL_START_MINUTES` | start of that day's block tagged `meal` (else the constant) | 5168, 5179 |
| `cleanupTeams(dow, meal)` | `MEAL_CLEANUP_SCHEDULE[dow][Meal]` normalized to an array | keys of `setup.cleanup[dk][meal]` | `cleanupAssigned` 5161, `findNextCleanupFor` 5174, `mealCleanupNote` 566-574 |
| `verseTheme()`, `verseFor(dow)` | `MEMORY_VERSE_THEME`, `MEMORY_VERSES[dow]` | `setup.verses` (video re-checked) | `renderMemoryVerse` 5036-5126 |
| `electivesFor(dow)` | `ELECTIVES[dow]` | rebuilt as `[[stationName,[names]],…]` per slot by `ord` | `electiveDayRoster` 337, `electiveBreakKids` 346, `myStationFor` 356, `myElectivesToday` 370-389, banner 787, sheet 945 |
| `stationEmoji(name)` | `STATION_EMOJI[name]` | station record | 361, 385, 789, 948 |
| `electiveSlotStart(slot, dow)` | `ELECTIVE_SLOT_MIN[slot]` | start of that day's `elective` block with that slot | 383, 501, 503 |
| `doubleWindow()` | constants (legacy epoch) | §5.7.3 | `bonusCountsDouble` 289, `inDoubleBonusWindow` 297, banner copy 4931/5109 (generated from the window), settings.js:307 |
| `campWeek()` | `{start: setup.meta.weekStart ?? pushSchedule.weekStart ?? null, phase}` | same | `campDateForDow` 994, .ics, push drawer, publisher |
| `finaleDow()` | 5 | `meta.finaleDow` ?? 5 | TV page |
| `teamIds()` | `state.teams` ids | same | everywhere teams are listed |
| `teamName(id)` (existing) | `state.teams` | same | — |
| `teamShort(id)` | `TEAM_ABBREV[id]` | `teams[i].short` ?? constant | chat.js:530 mentions, morning-meeting `teams` tail, Worker |
| `teamEmoji(id)` (existing, now sanitizing) | `TEAM_EMOJI[id]` | `teams[i].emoji` ?? constant | ~60 sites unchanged |
| `teamAccentVars(id)` | `--team-accent-l/-d: TEAM_ACCENT[id]` | palette light/dark, or legacy hex both | follow card 4574-4577; raw reads 5783, 6646, 6729 |
| `teamCrestSrc(id)` | `TEAM_SHIELD[id]` | cached photo > repo shield > null | follow card 4565-4568; TV |
| `counselorName(id)` (existing), `staffNames()` | directory + `team.counselor` fallback; `TEAM_COUNSELORS` + directory | + elective `people` names | `adoptMemberTeam` 4666-4667, `renderIdentityOptions` 4797, chat.js 507-527 |
| `allGames()`, `gameById(id)` | `state.config.games` | same | `liveHomeGames`, `homeBoardGame`, `upcomingMatchups`, `findNextMatchupFor`, `describeCauses`, `standingsSummaryText`, `medalCounts` |
| `gamesForBlock(dow, bid)`, `gamesForDay(dow)`, `unscheduledGames(dow)` | today's Morning/Evening heuristic (app.js:927-936) for games without `blockId` | the `blockId` link per §5.8; unattached listed separately | schedule sheet 927-936; .ics 1010-1016; `dayGamesHTML` 5427-5431; game header 5552; hub |
| `campersFor(tid)` | `[]` for non-editors; memory tree for editors with the screen open | same | Campers/People/Teams screens only |
| `hubStatus(section)` | pure (Appendix B) | same | hub |

Every row gets a parity test in both camps (`accessors.test.js`, `accessors.senior.test.js`):
off → `===` the constant; on with a freshly seeded tree → deep-equal (after stripping the extra
rich fields).

### 9.3 `tests/seam.test.js`

Greps app.js, chat.js, push.js, settings.js, setup-ui.js for direct reads of `DAY_SCHEDULE`,
`SCHED_DAYS`, `MEALS`, `ELECTIVES`, `STATION_EMOJI`, `ELECTIVE_SLOT_MIN`, `MEMORY_VERSE`,
`MEAL_CLEANUP_SCHEDULE`, `MEAL_START_MINUTES`, `TEAM_(EMOJI|SHIELD|ACCENT|ABBREV|COUNSELORS)`,
`DEFAULT_`, `DAY_NAMES`, `DOUBLE_BONUS_`, `state.config.days`, `state.config.games` and
`setupTree` **outside the SEAM block** (plus the seed builder, which is allowed to read the
constants), and fails with the line number.

### 9.4 The home-screen seam (read by the app-shell redesign)

The app-shell redesign (`app-shell-redesign-spec.md`; its §12 maps each region to these accessors) must read **only** through the §9.2 table plus the existing game helpers
(`gameStatus`, `liveHomeGames`, `homeBoardGame`, `currentMatchupOf`, `nextMatchupOf`,
`medalCounts`, `rankTeamsByPoints`). It may rely on: plain data, no throws on missing data,
cheap memoized calls, identical behaviour whether a camp is on the built-in copy or shared
setup. It must keep writing through `setHtmlIfChanged` on the `renderAll` path. **No renderer
may read `setupTree`, `CAMP.*` week fields or the old constants directly** (`seam.test.js`
enforces it). The redesign has now decided what this section used to leave open: which cards
exist and in what order (Now · Games · Chat · More), the Happening Now layout, date-awareness
("Camp starts Sunday…"), naming games in the Now card, and the Competitions card (replaced by the
Games tab, grouped by block, `gamesForDay` returning blocks-with-games). **Until the Games tab
ships, this project keeps the Competitions card's visible grouping as it is today** (Morning /
Afternoon / Evening, now derived from each game's block via `blockSession`), so nothing the
redesign decides is changed twice (ux-R17). In the integrated order (`BUILD-PLAN.md`) the Games
tab (D4) ships before S6a, so S6a's home-card part is simply not built.

**Small additions this project does make to home-adjacent surfaces** (each kept minimal, each
behind its own function so the redesign can move or restyle it; ux-R17):

| Addition | Where today | Function |
|---|---|---|
| **Change today's plan** (editors, only when the camp's schedule is edited here) | home schedule sheet | `renderPlanEntry()` |
| **Add the whole week to my calendar** + its snapshot note | home schedule sheet | `renderWeekIcsEntry()` |
| Settings gear count badge for people asking to join (editors) | header gear | `renderJoinBadge()` |
| "Taylor is asking to join" bar (editors, while the app is open) | the existing announcement strip pattern | `renderJoinRequestBar()` |
| Games listed under the item they're attached to | home schedule sheet | `gamesForBlock()` |

**Where the redesign puts these** (`app-shell-redesign-spec.md` §2.2, §2.4, §3.2): the schedule
sheet stays a sheet, so **Change today's plan**, the week calendar entry and the attached games
stay in it; `renderJoinBadge()` becomes the More tab's gold dot and the Set up the week row;
`renderJoinRequestBar()` becomes the bar in Now's messages strip (directors only). Each keeps its
function name, so only the host element moves.

---------------------------------------------------------------------------------

## 10. Seeding and migration from camps.js

### 10.1 A1 "Edit the week here" (owner only; per camp, from the hub)

**Preconditions** (each unmet one is explained on the button): **the owner** (decision Q8: the button is shown to nobody else, and the rules refuse the write from anyone else, §8.2); writer tab;
`setupReady && !setupDenied`; online; not inside a camp week unless overridden (§10.6; the
override's words are "Camp is running. Turning this on changes nothing anyone can see — it only
lets directors edit here."); the sections being turned on are off.

**Steps:**
1. Write a `pre-seed` restore point (online, required) — only when at least one section is being
   seeded for the first time.
2. `setupRef.transaction(cur => mergeSeed(cur, buildSeed(CAMP, sectionsAvailableInThisBuild)),
   null, /* applyLocally */ false)` where, per requested section, `mergeSeed`:
   - **`cur.meta.on[section]` absent (never turned on):** writes the seeded subtree and
     `on[section] = true`;
   - **`on[section] === false` (turned off before):** writes **only** `on[section] = true`; the
     section's data, edited or deliberately empty, is left exactly as it is (sync-F2, ux-R7);
   - **`on[section] === true`:** nothing.
   It sets `meta.schema = 1` and, when it seeded anything, `meta.seeded = {at: TIMESTAMP, byKey,
   from: 'camps.js@v'+APP_VERSION}`, and **copies every other existing field unchanged** —
   `weekStart`, `meta.edited` stamps, a live `meta.wizard` claim. Because the transaction rewrites
   the whole node, those carried stamps are re-validated; the rules accept an unchanged stamp
   (`NOWKEEP`/`SELFKEEP`, §8.1), which is what lets A1 run after anyone has edited anything
   (sync-F1; emulator case "stamp, then A1 for a second section"). If nothing changes it returns
   `undefined` (abort): a second press (the owner's other device) sees "You already turned this
   on" and writes nothing.
   (`null` cur is legitimate here: the node really is empty; the SDK re-runs on a stale guess.)
3. Team branding (S2b present): for each team with no `short`/`emoji`, write the constants via
   the state engine (per field). Rendering is unchanged; this puts short names into data for the
   Worker's "Red" check.
4. **A2 runs in the same flow** (§10.3), as one config transaction, and touches **only games with
   no `blockId` or a `blockId` that doesn't resolve on the game's day** — never an attached game's
   `blockId` or `ord`, so rain-plan moves and hand-made attachments survive any number of
   off/on cycles (sync-F2).
5. If phone alerts are live and a week date is set, republish `pushSchedule` (§12.1) and reset
   the alert baseline (`/notify` `ids:['*']`, `alert:false`).
6. The hub turns the corresponding rows live.

**Undo:** **Use the original week again** (also owner-only; `meta/on/*: false`, instant on every
device, data kept). The `pre-seed` point covers what A1 wrote **outside** `setup` (Games' `blockId` /
`ord` and Teams' `short` / `emoji`): a restore never flips the switch itself (§7.2 step 6). A console delete of `<root>/setup` returns the camp to the
built-in copy with zero code change (accessors fall back).

**Start this section again from the original** (owner only, gated in the app because the write is
ordinary section data; hub ⋯ → Advanced, per section): a
`pre-seed` restore point, then a confirm naming what is replaced ("Replaces this camp's edited
schedule — 3 changed items, 2 one-offs — with the schedule that came with the app. Games keep
their schedule items where the item still exists."), then one `commitSetup` writing the seeded
subtree whole. It is the only path that re-seeds a section that has ever been on.

`buildSeed(camp, sections)` is **pure and deterministic**: inputs are the camps.js constants
only (never the async member directory, never device state). `meta.seeded` is excluded from the
determinism test.

### 10.2 Seed construction

- **Schedule** (measured lossless by two drafts; rule from editor-first):
  - The typical day = Monday's array (dow 1), re-keyed with §5.5 ids; `ord = 10 × index`.
  - For Tue–Fri, each block is matched to an **unused** typical block with the same `start`,
    `end`, `type`, `slot`, `noTime` **and the same head label**. Differences in label tail,
    emoji or team group become a patch; an unmatched typical block becomes `{off:true}`; an
    unmatched day block becomes a one-off in `dayBlocks/<dk>` with `ord` = the next typical
    block's `ord − 5` (so Tue/Thu movie night still sorts before "Prepare for bed" at 21:15 and
    keeps winning Happening Now). The head-label rule matters: without it junior Friday's
    "Team Skits" (19:00–20:00) would become a patch of "Evening service" and inherit its alert
    key. Measured result: junior Friday = 8 `off` patches + 10 one-offs; senior Tue–Fri are
    100% typical.
  - **Team groups:** a label tail that `joinTeams(ids sorted by slot)` reproduces exactly (the
    junior morning meeting) becomes `teams`; the group-B days get a `teams` patch. Any tail that
    doesn't reproduce exactly stays plain label text (the test lists which blocks converted:
    junior's morning meeting, nothing else).
  - Sunday and Saturday (and any day without weekday blocks) become own days (`typical:false`)
    with all blocks in `dayBlocks`. `days.<dk>.tag` from `SCHED_DAYS[dow].tag`.
  - `meal` = `legacyMealOf(label)` (today's exact rule): junior Breakfast/Lunch/Supper, senior
    Breakfast/Lunch. Senior "Supper and free time" stays untagged (identical behaviour; a
    director can tag it in the item sheet).
  - `alertKey = pushBlockKey(rendered label)` = today's key, for every block.
  - Senior's Sunday (2 blocks) and Saturday (4 blocks) are the stubs camps.js labels as
    unconfirmed (camps.js:527-529); they are seeded with `placeholder: true`. **Owner's answer
    (Q11): keep the sample days for now**, so the hub shows a quiet info line, never a ⚠️, and a
    director replaces them on the Schedule screen whenever the real days are known.
  - **Re-verified by the spec lead (2026-10-27)** with a throwaway script running exactly these
    rules, including the `teams` conversion, on the real camps.js: both camps round-trip all 7
    days exactly; every `alertKey` equals today's `pushBlockKey`; the longest published id is 39
    characters; junior = 26 typical items, patches Tue 2 / Wed 1 / Thu 2 / Fri 8, one-offs Sun 9 /
    Tue 1 / Thu 1 / Fri 10 / Sat 5, ≈ 9.4 KB; senior = 20 typical items, no patches, Sun 2 / Sat 4,
    ≈ 4.5 KB; the only block converted to `teams` is junior's morning meeting.
- **Meals:** copied from `MEALS`, lowercase keys. **Cleanup:** `MEAL_CLEANUP_SCHEDULE[dow][Meal]`
  (string or array) → `{tid: true}`. **Verses:** theme + days 1–5 under `mon…fri`; `video` only
  if `https://`. **Electives** (junior only): `stations['st-'+slug(name)] = {name, emoji:
  STATION_EMOJI[name]}`; `slots[dk]['s'+slot][stId] = {ord: 10×(j+1), people: {'n-'+slug(n):
  {name: n, ord: 10×(k+1)}}}`. Senior's empty electives write nothing.
- **Meta:** `schema`, `on`, `seeded` as above. `double` is written **only by the wizard**
  (§11.3), so the legacy pin can't be bypassed. `finaleDow` absent ⇒ 5.

### 10.3 A2 "Put games on the schedule" (the backfill rule)

**Scope (sync-F2):** only games with **no `blockId`, or a `blockId` that doesn't resolve on the
game's day** (`resolveDay`, §5.8). An attached game is never re-attached and its `ord` is never
rewritten, however often A1 or A2 runs. For each game in scope with a known dow (from its
`dayId` tab), the first rule that applies wins (editor-first, measured 47/47):
1. a **timed** block that day whose head label equals the game name (case-insensitive):
   junior `team-skits` → Friday's 19:00 "Team Skits" (an `activity` block, so Happening Now is
   unchanged);
2. a **`type:'games'`** block whose head label contains the game name: senior Legacy Game →
   16:50 "Legacy Game" (never 16:40 "Cool down & prepare for the Legacy Game", an `activity`);
3. by session: **Morning** → the first games block before 12:00; **Afternoon** → games blocks
   12:00–16:59 whose label contains the game name's first word, else the first of them;
   **Evening** → the first games block from 17:00;
4. `CAMP.gameBlockOverrides[gameId]` (empty in both profiles) overrides 1–3;
5. otherwise no `blockId` (hub ⚠️ "Not on the schedule" with a one-tap picker).

`ord` = after the games already attached to that block, in the backfilled games' current
order. `dayId` and `session` are
left as they are (they already agree). Written as **one config transaction** (ops
`games/<id>/blockId`, `games/<id>/ord`).

**Oracle table** (migration-first's hints become the expected result, asserted game by game):

| Camp | Games | Expected block |
|---|---|---|
| Junior | Mon–Thu Morning; Fri Morning | 10:00 "Team competitions" |
| Junior | Mon–Thu Evening | 18:00 "Evening competition" |
| Junior | Fri Evening `team-skits` | Fri 19:00 "Team Skits" |
| Senior | `team-comp-am-*` | 9:45 "Team competitions" |
| Senior | `team-comp-pm-*` | 15:00 block |
| Senior | `legacy-game-*` | 16:50 "Legacy Game" |
| Senior | `hot-seat-*`, `lets-make-a-deal-*` | 18:50 block |

This fixes two live bugs: senior Afternoon games shown nowhere (10 of 25) and junior Team Skits
shown nowhere. **Re-verified by the spec lead (2026-10-27)** against `defaultConfig()` and
`seniorDefaultConfig()`: 22/22 junior and 25/25 senior games land on the oracle's block, none
unscheduled.

### 10.4 Fidelity and determinism tests (`seed.test.js`, `seed.senior.test.js`)

- For dow 0–6: `scheduleForDow(dow)` from a seeded tree, **after a fake-RTDB round trip**
  (prune + key sort), deep-equals `DAY_SCHEDULE[dow]` in order.
- `nowBannerHtml(dow, m)` is byte-identical before and after seeding for **all 10,080 minutes**
  of the week, both camps.
- Same before/after equality for `mealFor`, `cleanupTeams`, `verseFor`/`verseTheme`,
  `electivesFor`, `electiveSlotStart`, `stationEmoji`, `teamEmoji`, `teamShort`,
  `teamAccentVars`, and `doubleWindow()` (legacy epoch: the constants to the millisecond, for any
  `weekStart`; a wizard epoch with `weekStart '2027-07-18'` and the seeded relative window:
  Thu 2027-07-22 17:00 ET → Sat 2027-07-24 00:00 ET; and the relative window over 2026-07-19
  equals the constants).
- `pushScheduleBlocks` keys and the phone-alert catalog rows are identical after seeding; ids
  change format by design (`<dk>-<bid>`).
- `buildSeed(CAMP)` twice → deep-equal (minus `seeded`); A1 twice under the fake RTDB writes once.
- **Off then on keeps everything (sync-F2, ux-R7):** A1 → edit a block, move a game by hand,
  clear meals → Use the original week again → Edit the week here → the edited block, the hand
  attachment (`blockId` and `ord`) and the empty meals are all still there; only "Start this
  section again from the built-in copy" re-seeds.
- **A1 after edits (sync-F1):** a fake-RTDB run with existing `meta/edited` stamps and a live
  wizard claim; A1 for a second section commits (paired with the emulator case in §8.8).
- The frozen id fixtures (§5.5) match.
- The A2 oracle table, game by game; `gamesForBlock` returns each game exactly once.
- `makeContext({camp, seeded: true})` re-runs every existing `week`, `push` and `chat` test
  against seeded data (one extra runner pass per camp).

### 10.5 The junior guarantee, precisely

- **Before A1:** every accessor returns the original constant objects; Firebase paths and
  storage keys are unchanged; the config shape is unchanged. Data a v183 device never wrote:
  `editorsHere` rows (a new editor-only node), per-field `teams/<i>/<field>` paths (same
  resulting data),
  config by transaction instead of `set()` (same resulting data).
- **After A1, before any edit:** every rendered output is identical (§10.4). A v183 device
  still open renders the constants, which are the same values.
- **After the first edit:** junior intentionally diverges; old builds still open show the
  built-in copy until they reload (the Devices list names them).
- **History can't move:** the legacy-epoch pin (§5.7.3).
- `tests/camps.test.js` is never changed. `tests/fixtures-junior-week.json` changes **once**, in
  S0k, when the counselor spellings merge (Q21): that commit regenerates it and its diff is exactly
  Alysa → Alyssa, Sofie → Sofia, Lilly → Lily; after that it is never edited again.
  "Byte-identical" in this spec means "identical to the 2026 app, apart from those three
  spellings".

### 10.6 The camp week date, and what happens before it exists

- `setup/meta/weekStart` is the single source of truth from S5a; it can be set from Camp week
  **before** A1 (meta can exist without any `on` flag) — **except while a new year is due**.
- **`newYearDue()` (ux-R4)** is true when no camp week is running and **either** the camp is still
  in the legacy epoch (or its epoch's week ended more than 7 days ago) **and** it holds any
  results, bonuses or brackets, **or** no week date exists. It does **not** depend on whether a
  date has been typed, so setting next year's date first can never hide the wizard. While it is
  true: the hub's first line is the new-year prompt (§11.2); the Camp week row's date input is
  replaced by "This camp still has 2026's scores. Pick 2027's dates in the new-year setup — it
  saves 2026 first. **[Start the new-year setup]**"; and **Start the new-year setup** is also in
  the hub ⋯ menu (where it stays permanently, greyed with the reason when not allowed). A camp
  with no scores at all (a brand-new camp) can still have its date set directly.
- One-time migration: an S5a editor client copies an existing `pushSchedule/weekStart` into
  `setup/meta/weekStart` when the latter is absent (today that value is `null`: push is dormant).
- **When no week date exists:**

  | Consumer | Behaviour |
  |---|---|
  | Hub "Camp week" row | ⚠️ "Pick the Sunday camp starts" |
  | Per-day calendar export | today's behaviour (this week's dates), labelled "Camp dates aren't set — using this week's dates" |
  | Whole-week calendar export | disabled: "Ask a director to set the camp dates" |
  | Camp-week freeze for A1/A3 | asks "Is a camp week running right now?" — **Yes** refuses (with the override checkbox), **No** proceeds |
  | Double points | legacy epoch: the constants; wizard epoch: none (§5.7.3) |
  | Phone alerts | publisher doesn't publish (as today); drawer says "Set the camp dates in Set up the week" |
  | TV finale | Friday by day-of-week, as today |

### 10.7 Retiring 2026-only code paths without changing 2026 behaviour

- `normalizeSyncedState`'s roster migrations (app.js:6303-6311: placeholder renames and the
  counselor refill) run **only in the legacy epoch** (S0g). In a wizard year an editor can name a
  team "Team 1" or blank a counselor and nothing reverts it.
- `migrateState` v2–v5 stay gated on `version < 5`; senior stays at 5.
- `DOUBLE_BONUS_*` move to `camp-core.js` (shared with the TV) and are read only through
  `doubleWindow()`.
- `SEED_COUNSELORS` stays as junior's "last year's printed roster" option in People.

---------------------------------------------------------------------------------

## 11. Editor screens

### 11.0 Design language: the director's clipboard

- **One column of rows divided by hairlines**, like a printed run sheet: times left-aligned in
  tabular numerals, labels medium weight, section names as short all-caps labels. No cards inside
  cards, no shadows on rows, no gradients or illustrations.
- **Status is a quiet mark at the row end:** `✅ Ready`, `⚠️ 3 to check`, `○ Not started`,
  `— Not used`, with a muted, specific line ("Saturday is empty", never "Incomplete"). The hub's
  top line is a sentence: "7 of 10 ready · next: Teams".
- **Verbs, sentence case, no exclamation marks.** "Copy to Mon–Fri", "Move to…", "Tell people",
  "Put it back". Never "Submit", "OK", "Oops".
- **Colour means something.** Primary blue for the one main action; danger text uses
  `--color-danger-text`; team colours only on team rows and previews.
- **Density follows the device.** Phone: rows ≥ 48 px, targets ≥ 44 px, editing in bottom sheets
  (`jelly-drawer`, bottom, ≤ 90vh) with a sticky footer. Laptop (≥ 900 px): two panes, the hub on
  the left (300 px, sticky), the selected screen on the right; sheets open in the right pane.
- **Native controls where phones do them better:** `<input type="time" step="300">`,
  `<input type="date">`, `<input type="file" accept="image/*">`. Jelly for the rest.
- **Confirmations:** `askDialog({title, body, actions})` (a `jelly-dialog` helper) replaces
  native `confirm/alert/prompt` on every screen this project touches (settings.js 670, 788, 814,
  849, 983, 1083, 1088, 1096-1097, 1365, 1373, 1381, 1484, 1523 as each is touched).
  **Hold-to-confirm** is used for exactly two actions: clearing the scoreboard (wizard step 4) and
  a restore that includes scores. The button fills over 1.2 s while pressed and names the camp
  ("Hold to clear Junior Camp's scoreboard"); a tap or keyboard activation reveals an inline
  second button "Yes, clear Junior Camp's scoreboard" (the accessible two-tap alternative).
- Render-stability rules hold: never `transition: all`; never re-create a Jelly component whose
  HTML didn't change.
- Refuses: carousels, blocking tooltips, skeleton shimmer for cached data, modal stacks, piling
  toasts (one undo pill at a time, a new one replaces it).

### 11.1 Entry points and the frame around every screen

**Entry points (editors only):**
- **More → Director → Set up the week** once the redesign's shell ships
  (`app-shell-redesign-spec.md` §7.5; the same `openBuilder` takeover). Until then Settings →
  **Set up the week** (the existing `#builder-row`, same name) → the hub.
- Home schedule sheet → **Change today's plan** → Schedule on today in rain-plan mode (§11.6).
  **Shown only when this camp's schedule is edited here** (`setupOn('schedule')`). Otherwise the
  sheet shows editors one line instead: "To change today's plan here, turn on editing in **Set up
  the week**" (linking to the hub's **Edit the week here**, whose camp-week override explains
  itself in plain words, §10.1). Never a button that leads to a refusal (ux-R18).
- An empty day on the home Competitions card (the Games tab after the redesign) → **Add games** → Games on that day.
- ⚡ quick game → the game sheet, attached to the block happening now or next on that day.
- People asking to join (ux-R10): a count badge on the Settings gear (the More tab's dot and the Set up the week row after the shell ships); **and**, when a new request
  arrives while the app is open, a toast plus a dismissible bar on the home screen (Now's messages strip after the shell ships; "🙋 Taylor
  Reed is asking to join · **See**") from the editor-only `accessRequests` query (§11.8). A
  director of both camps also gets a one-shot count of the other camp's requests at load ("1
  person is asking to join Senior camp").

**Takeover:** the builder keeps today's `state.ui.view === 'settings'` / `body.builder-open`
(`openBuilder`). `state.ui.builderScreen` (device-local: `hub | week | schedule | games | teams |
people | campers | meals | verses | cleanup | electives | notice | backups | wizard`) and
`state.ui.setupDay` (`typical | sun…sat`) replace `state.ui.settingsTab`; a reload reopens the
same screen. Chat still closes the builder.

**Header on every screen**, left to right:
1. **Back** ("Scoreboard" from the hub, "Set up the week" from a screen). A dirty sheet asks
   "Discard your changes to Team competitions?" (Keep editing / Discard).
2. **The sync line**, one truthful sentence: `Saved` · `Saving…` · `Saved on this device ·
   will sync when you're back online` (offline, or first snapshot pending) · `Couldn't save
   Teams · tap for details` (refused, red; details offer **Retry**, **Discard**, **Download my
   changes**) · `Editing here isn't available yet` (rules not published).
3. **Who's here** (§6.7).

Below it, the **undo pill** (§7.1).

**Migration-friendly cut-over:** until a section is on, its hub row opens a read-only preview
with the **Edit the week here** button; Games, Days, Teams, Notice and Data stay reachable as
"Classic editor" in the hub's ⋯ menu until their replacement ships. The classic Days tab is
absorbed into Camp week (S5a), Data into Backups (S4), Teams into Teams (S7), Games into Games
(S6a). Nothing is removed before its replacement is live.

### 11.2 The checklist hub ("Set up the week")

```
SET UP JUNIOR CAMP                                   [⋯]
Week of Sun, Jul 18 – Sat, Jul 24, 2027
7 of 10 ready · next: Teams
Jenn is also here

  Camp week        Sun Jul 18 – Sat Jul 24                 ✅
  Schedule         Typical day · Mon–Fri · 3 one-offs      ✅
  Games            22 games on 10 schedule items           ⚠️ 1 not on the schedule
  Teams            6 teams                                 ⚠️ Two teams are Blue
  People           18 counselors · 4 directors             ⚠️ 2 asking to join
  Campers          64 campers                              ✅
  Meals            Mon–Fri                                 ⚠️ 3 meals have no dish
  Memory verses    Theme + 5 days                          ✅
  Cleanup rota     Each team cleans 2–3 times              ✅
  Electives        3 slots · 6 stations                    ✅
  ─────────────
  Phone alerts     Schedule sent to phones                 ✅
  Notice board     Draft
  Restore points   Last saved 12 min ago
```
- Status comes from the pure `hubStatus(section, view)` (Appendix B), which also feeds "next:".
- Laptop rows also show "changed by Patrick · 20 min ago" from `setup/meta/edited/<section>`;
  a row someone else is on shows their initial.
- Optional sections (Campers, Meals, Memory verses, Cleanup rota, Electives) have **Not using this
  year** in their ⋯ menu (`setup/meta/skip/<section>`), shown as `— Not used`, never ⚠️.
- Electives appear only when `CAMP.features.electives` (junior).
- **One front door at a time (ux-R4).** The paragraph above the list is chosen in this order:
  1. **A camp week is running:** "Camp week in progress — the new-year setup is locked." plus,
     only when the schedule is edited here, "Rain plans and small edits are fine." (ux-R18)
  2. **`newYearDue()`** (§10.6): "Getting ready for 2027? **[Start the new-year setup]**" as the
     only primary button. The wizard turns on editing itself as its first step when needed, so
     "Edit the week here" is not offered separately here.
  3. **Not yet edited here** (no section on): "This camp's schedule, menus and verses are still
     the original copy that came with the app. Turning on editing changes nothing anyone can see
     until someone edits something. **[Edit the week here]**".
- **A section off but holding edits** shows on its row: "Showing the original — your edits are
  kept. **Edit the week here** to bring them back" (ux-R7).
- ⋯ menu: **Start the new-year setup** (always listed; greyed with the reason when not allowed),
  **Undo the new-year setup** (for 14 days after a wizard run, §7.3), Devices (§6.7), Classic
  editor, **Use the original week again** ("Everyone sees the schedule that came with the app.
  Your changes are kept and come back when you edit here again."), Advanced: per-section switches
  and "Start this section again from the original" (the emergency valves).
- **Who sees the buttons (decision Q8).** **Start the new-year setup**, **Edit the week here**,
  **Undo the new-year setup**, **Use the original week again** and everything under Advanced
  belong to the owner. Only the owner key sees those buttons; every other director reads the same
  sentence with the owner's name and no button: "Getting ready for 2027? Patrick starts the
  new-year setup." / "This camp is still using the original week. Patrick turns on editing." / on
  a row that is off but holding edits, "Showing the original — your edits are kept. Patrick can
  switch it back on." (`ownerName()` from the member directory; "the owner" until it loads.) The
  rest of the hub works for every director as soon as a section is on.

### 11.3 The new-year wizard (A3)

Five steps, one per screen, "2 of 5". Back is allowed until step 4 runs. **Claim:** starting
takes `setup/meta/wizard` by `transaction()` (`{step, byKey, at: TIMESTAMP, fromEpoch, answers?,
archiveId?}`, always written whole; `fromEpoch` is `'legacy'` for the legacy epoch, never `''`,
sync-F19). **The wizard is owner-only (decision Q8):** its entry points are shown only to the
owner key and the rules refuse every claim and commit write from anyone else (§8.2, §8.3), so the
claim guards the owner against themselves: a second device or tab sees "You're setting up 2027 on
another device (step 3 of 5, 4 min ago) **[Watch]** · **[Take over]**", and every other director
sees a read-only line, "Patrick is setting up 2027 (step 3 of 5)". **Preconditions:** the owner's
Google sign-in; writer tab; online; not during a camp week (enforced,
override available); the Devices list warns (doesn't block) if another director device is on an
older version. If the camp's schedule isn't edited here yet, the wizard's first action is A1 for
the schedule (with its `pre-seed` point), so there is only one front door (ux-R4).

**Answers survive a reload and a take-over (ux-R5).** Step 1 and 2 answers are kept in
`lsKey('campWizardDraft')` on the driving device **and** in the claim's `answers` (a JSON string,
≤ 2,000 chars) on every step change and every changed answer (throttled to once per 10 s), so a
reload resumes at the same step with the same answers and **Take over** inherits them ("You
chose on your other device: camp starts Sun Jul 18 · double points Thu 5 PM – end of Fri · keep schedule, clear
menus…" with **Use these** / **Start over**). The claim's `at` is refreshed by the same writes
and by any tap on the wizard (at most once a minute), so **Take over** appears only when the
driver has really been idle for 15 minutes. While the wizard is open and was touched in the last
2 minutes, `reloadBlocked()` holds (§6.5).

**Step 1 · When is camp?** "Camp starts on Sunday" (date input; a non-Sunday snaps with "Camp
weeks start on a Sunday. Did you mean **Sun, Jul 18**?"). Shows `Sun 18 · Mon 19 … Sat 24` with
last year's tags. **Double points:** "Last year: Thursday 5:00 PM until the end of Friday. Same
this year?" (Yes / Change… / No double points). Writes only the draft and the claim's `answers`.

**Step 2 · What carries over from 2026?** Plain-word checklist with defaults:

| Item | Default | Note |
|---|---|---|
| Schedule (typical day, arrival, send-off) | Keep | "You can change anything after." Followed by a review line when labels name last year's staff (ux-R9): "4 schedule items name people: *Snack and campfire — TJ*, *Laura's cottage*… **Review them**" (opens a list; nothing is changed automatically). |
| Games, on the same schedule items | Keep | Results are always cleared in step 4. Option: Reset to camp default. |
| Team names, short names, emoji, colours | Keep | "Rename them in a minute if the teams are new." |
| Counselor names typed on teams (the fallback text shown when a team has no counselor accounts) | **Clear** | "Last year's names would show on standings until people are put on teams." (ux-R9) |
| Team photos | Clear | "Last year's shields belong to last year's teams." |
| Cleanup rota | Keep | |
| Meal menus | Clear | |
| Memory verses and theme | Clear | |
| Elective stations / who's at each station | Keep / Clear | |
| Counselors stay on their teams | No | "Everyone keeps their sign-in. You'll put them on teams again in one list." (owner row untouched; decision Q22 keeps the default at No) |
| Campers | Always cleared | "Camper names are never kept between years." (decision Q7) |
| Notice board | back to a draft | |

**Step 3 · Save 2026.** Needs a connection. Writes the `pre-wizard` restore point and the
`archive` point (§7.3), reads both back and compares length and hash, records `archiveId` in the
claim. **Idempotent** (§7.3): an `archiveId` already in the claim is verified and reused, or
replaced by a fresh id if it doesn't verify — Back-then-Next, a reload, a failed read-back's **Try
again** and a Take over all work (ux-R6, sync-F18b). Shows "Saved 2026: 22 game results ·
Ferocious Foxes won with 211 points. You can look back at it any time in Restore points."
Nothing to confirm.

**Step 4 · Clear the scoreboard.** Lists exactly what will be cleared with counts ("22 game
results · 61 bonus points · 3 announcements · notice board back to a draft · 2 brackets in
progress"). The only control is **[Hold to clear Junior Camp's scoreboard]**. On release:
1. Re-check: `pendingWritesTotal() === 0`, no unconfirmed diffs in any engine, online, writer
   tab, the archive id in the claim verified this session, **and the archive still matches the
   data** (fresh `once()` reads hashed and compared, §7.3; if anything changed since step 3, a
   fresh archive point is written and verified first; sync-F18a).
2. `wizardCommitInFlight = true` (all three engines hold their pushes); `pendingWrites++`.
3. **One atomic multi-path `update()` at `<root>`** — the year's data only:
   - `state/{results,brackets,brackets4,drafts,picRounds,picSetup,bonuses,live,clocks,announcements}: null`
   - `state/meta/lastDataChangeAt: null`, `state/meta/epoch: <new>`, `state/meta/epochAt: TIMESTAMP`
   - `state/notice/status: 'draft'`
   - team carry-over choices: `state/teams/<i>/<field>` (e.g. `photoV: null` when photos are
     cleared, `counselor: null` when the typed counselor names are cleared)
   - `setup/meta/{epoch, epochAt, weekStart, double (or null), finaleDow}`, `setup/meta/wizard: null`
   - setup carry-over: `setup/meals: null` etc. for Clear (the section stays on ⇒ empty); a
     seeded subtree for Reset to camp default
   - games Reset (if chosen): `config: <configForSync(CAMP.defaultConfig())>` with `blockId`s
     re-derived against the carried-over schedule
   - `campers: null`
   - `revealPublic`, `revealFull`: `null` (the redesign's standings-reveal nodes with their `real`
     and `practice` children, `app-shell-redesign-spec.md` §4.3 and §4.13; absent until its stage D5
     ships, so deleting them is harmless; the owner clause in the `revealPublic` write rule lets the
     delete through even before an unexpired reveal's `until`. The redesign's earlier names
     `reveal`, `revealPractice` and `revealScreens` no longer exist and must not be listed: a path
     with no rule is refused, and one refused path refuses the whole atomic update)
   - `accessRequests/<k>: null` for each open request (enumerated: editors can only delete rows)
   Any refused path refuses all: nothing is half-done. **Member rows are deliberately not in this
   update (sec-F4):** the rules validate a whole member record on any leaf write, so one
   hand-seeded row missing `addedBy`/`addedAt` would refuse the entire clear with no diagnosis.
4. On ack: `pendingWrites--`, `wizardCommitInFlight = false`; re-read `state`, `config` and
   `setup` with `once()` and adopt each as the new confirmed baseline; republish `pushSchedule`
   and reset the alert baseline. On refusal: nothing changed; the step says so with **Try again**
   and names the refused area when the quarantine bisect can tell.
5. **Then, best-effort, counselors' teams** (unless "Counselors stay on their teams" was chosen):
   one small update per member with a `teamId` — `members/<k>/teamId: null` — skipping
   `OWNER_MEMBER_KEY` (rules#5). A row that refuses is listed, not retried in a loop: "Couldn't take
   Sam off the Foxes — that sign-in record is incomplete; fix it in People." Before the hold
   button is enabled, a preflight read of `members` already warns about any row that lacks
   `role`, `addedBy` or `addedAt`.

**Step 5 · Next steps.** The hub, every row honest. "Next: **Put people on teams**" (§11.8: the
one-list team picker for everyone, ux-R9), then Teams (new names are the usual first job). Week
settings, Teams, People and Campers are hub tasks, not wizard steps.

Other devices see the new epoch on their next snapshot (§6.11). **Undo the new-year setup** (§7.3)
is the rollback.

### 11.4 Camp week

- **Dates.** "Camp starts on" (a Sunday) and a read-only "Sun Jul 18 – Sat Jul 24, 2027"
  (`setup/meta/weekStart`). While `newYearDue()` the input is replaced by the route into the
  wizard (§10.6). The Phone-alerts drawer's own date input becomes a read-only line "Camp week:
  Jul 18–24 (change in Set up the week)".
- **Days.** Seven rows Sun–Sat, each with its **tag** ("Arrival day", "Competition day 3",
  "Messtival & Team Skits") and **one** choice (ux-R14): "This day: **[follows the typical day]**
  **[has its own schedule]**" (Mon–Fri default: follows). Switching runs the same atomic
  operation as the Schedule screen's "Give Friday its own schedule" / "Make Friday follow the
  typical day again"
  (§11.5), with the same restore point and confirm. **Which days have games** is not asked here:
  it lives at the top of the Games screen (§11.14), where it belongs, so the two day switches
  can't be combined in confusing ways.
- **Double points.** "Double points from [Thursday ▾] [5:00 PM] until [end of Friday ▾]" or
  **No double points** (`setup/meta/double`). In the legacy epoch the row reads "This year's
  double points are fixed (Thu Jul 23 5 PM – end of Fri Jul 24, 2026). A new window takes effect
  with the new-year setup." Saving in a wizard epoch offers "Also mark the 6 games in that window
  as double points?" (sets each game's existing `messtival` flag).
- **TV finale:** "Champion celebration on the TV page: [Friday ▾]" (`setup/meta/finaleDow`).

### 11.5 Schedule

**Day strip** (sticky): `Typical · Sun · Mon · Tue · Wed · Thu · Fri · Sat`; a dot under days
that use the typical day, a filled second dot under days with changes or one-offs; today's chip
outlined; ⚠️ on a day with hub issues. On a phone the strip scrolls horizontally and **opens
scrolled to today, with today's chip pinned at the left edge** during camp week (ux-R2).

**Typical day view:** rows (time range, emoji, label, a kind tag Meal / Games / Elective 1–3,
and for games items how many games are attached across the week). A "+ here" row appears in any
gap ≥ 15 minutes (phone) or on hover (laptop). Saving here needs no scope question; the footer
says "Changes Mon–Fri, except days that have their own version of this". If a day has its own
version of the field being changed, an inline line appears before Save: "Wednesday has its own
start time (10:30). [Keep Wednesday's] [Change Wednesday too]" (the latter deletes that patch
field in the same commit).

**A day view (e.g. Tuesday):** the resolved day, sorted by time, with tags: `Tue only`
(one-offs); `Changed for Tue` (with **Back to the usual** in the sheet); skipped typical items as
one muted line at the bottom: "Skipped on Tuesday: Evening competition · **Bring back**". A day
with many differences says where they are in one line at the top ("Friday evening is different
from the typical day: 8 items skipped, 10 Friday-only") so a director isn't surprised that the
morning still follows the typical day.
**Saving an item that comes from the typical day asks the scope question every time**, as two
equal buttons in the sheet's sticky footer:

**[Just Tuesday]**  **[Every day like Tuesday]**
*(live caption under the second, naming the days that will **actually** change: "Mon, Tue,
Thu, Fri — Wednesday keeps its own start time" or "Mon–Fri"; ux-R14)*

- Just Tuesday → writes `patches/tue/<bid>/<field>`.
- Every day like Tuesday → writes `typical/<bid>/<field>` (plus the "Change Wednesday too" choice
  above when other days have their own value).
- Adding from a day view asks [Add to just Tuesday] / [Add to every day like Tuesday]; removing
  asks [Skip just Tuesday] / [Remove from every day like Tuesday]. The same item action is called
  **Skip today** in the rain plan and **Skip just Tuesday** here, and is undone everywhere with
  **Bring back** (Appendix C).
- A one-off or an own-day item has a single [Save].
- **Arrival (Sun) and send-off (Sat)** are own days: no scope question. An empty one offers
  "Copy from another day…" (and "Start from last year's Sunday" when an archive exists).
- ⋯ → **Give Friday its own schedule** copies Friday's resolved items into `dayBlocks/fri` **with
  the same ids**, so attached games and alert keys don't move, in **one** atomic update with
  `days/fri/typical: false` and `patches/fri: null` (sync-F16b; a colleague's late "Just Friday"
  write is then refused by `PANCHOR` and explained). ⋯ → **Make Friday follow the typical day
  again** needs a `pre-delete` restore point and confirm; games on removed items are offered a new
  home; it writes `days/fri/typical: true` and `dayBlocks/fri: null` in one update.

**The item sheet** (bottom sheet on a phone, right pane on a laptop):

| Field | Control | Maps to |
|---|---|---|
| What happens | text | `label` (1–120) |
| Emoji | text + a small grid of camp emoji | `emoji` |
| Starts / Ends | two native time inputs, 5-minute steps, plus an **Until the end of the day** switch | `start`, `end`. The switch stores `end: 1440` and hides the End input; it is **on** for every seeded item that ends at midnight (*Lights out*, *Camp's over*, *Welcome night*), because a native time input can't hold 24:00 and would wrap to 00:00 (ux-R3). "Ends before it starts" refused inline. |
| This is… | segmented **Activity · Meal · Games · Elective** | `type` (+ `meal` / `slot`); Meal sets `type:'activity'` + `meal` |
| Which meal / Which elective | shown for Meal / Elective | `meal` / `slot` 0–2 |
| Show the time | switch (off for "Lights out") | `noTime` |
| Who meets | team chips (shown when the item has `teams`, or via ⋯ "List teams in the name") | `teams` |
| Games here | attached games for this day, each with **Move…**, plus **+ Add a game here** | games' `blockId` (S5a: move; S6a: add) |
| Phone reminders | read-only "People who follow *Team competitions* get reminded before this." | `alertKey` |
| Remove… | `.danger-link` | |

- **Overlap check, live:** "Overlaps *Prepare for bed* (9:15–9:30 PM). [Push later items back 15
  min] [That's on purpose]" (the latter sets `overlapOk`; the seed sets it on the movie nights).
- **Nothing is ever pushed past midnight (ux-R3).** "Push later items back" and the rain plan's
  "Move everything after it too" treat an item that runs **until the end of the day** as elastic
  (its start moves, its end stays 1440, and it shrinks to at least 5 minutes); any other item
  that would end after midnight is not moved and is listed: "*Cabin devotional* doesn't fit before
  midnight — shorten it or skip it today". So a ripple can never produce `end > 1440`, which the
  rules would refuse. Test: open and save every seeded block of both camps unchanged → zero ops;
  a ripple from 19:00 on every seeded day → every `end ≤ 1440`.
- **Renaming keeps the reminder key.** If the head of the label changes completely: "Is this still
  the same thing for reminders? [Yes, same] [No, start fresh]" (fresh mints a new `alertKey`).
- **Deleting an item with games** asks to move them to another item or to "Not on the schedule"
  (games keep their results); a started game (result, bracket, draft) needs a second confirm.
  Games are never deleted from here.
- **Guided first build** (empty typical day): one line, "Start with the first thing in the
  morning, usually breakfast. **[Add the first item]**"; once it has three items: "Use this for
  Monday to Friday? **[Copy to Mon–Fri]**" (sets `typical:true` on the chosen days).
- When a change touches an occurrence **today or tomorrow** during camp week and phone alerts are
  live, the sheet footer shows **☐ Tell people who follow this**. Default **on** only for a
  day-specific **time move or cancellation** today/tomorrow; **off** for renames, emoji and
  label fixes, and for typical-day changes (ux-R11). Under it, always: "Only phones that turned on
  reminders for this item get it — tell everyone else in person." (The app can't count other
  people's phones before sending — their alert settings are private to them — so the number
  comes back afterwards: "Sent to 23 phones".) See §12.2.

### 11.6 Rain plan (moving things around on one day)

Reached from a day view's ⋯ → **Rain plan for Tuesday**, or the home schedule sheet's **Change
today's plan** (editors only, and only when the schedule is edited here, §11.1; not a home-layout
change). Every change is "for this day only" (no scope question). **Changes are staged**, not
committed per tap: the panel shows each item's new position with the old one struck through.

**The draft (sync-F4).** It lives in `lsKey('campSetupRainDraft')` as `{dk, epoch, at, items:
{path: {base, staged}}}`: for every staged field, **the value it had when it was staged** is kept
beside the new one. Opening the panel (or restoring it after a reload) re-resolves the day from
the current setup tree. The draft is dropped on an epoch change; one older than 12 hours asks
"Finish or discard yesterday's rain plan?"; `reloadBlocked()` holds only while the panel is open
and was touched in the last 2 minutes (an abandoned draft never stops updates: the page reloads
and restores it).

**Phone layout (ux-R2).** The panel opens **collapsed around now**: the item happening now, the
next three, and any item with games, each as one 48 px row (time · emoji · label · games).
**Tapping a row opens its actions in a bottom sheet** — never five buttons per row. "Show the
whole day" expands the rest. Staged rows carry a small "changed" mark. Laptop: the whole day,
actions in the right pane.

```
RAIN PLAN · WEDNESDAY · changes are for today only            [Done]
▸ now   9:45  📣 Prepare for competitions
       10:00–11:45  🏅 Team competitions · Axe Throwing, Bowling
       12:00–12:30  🥪 Lunch
        1:15–2:00   🌟 Elective 1
       Show the whole day (22 more)
```
Item sheet: **[⇄ Swap with…]** **[⏱ Change time]** **[↑ Earlier] [↓ Later]** **[✕ Skip today]**
**[Games…]**.

| Action | Does (staged) | Writes at Done |
|---|---|---|
| ⇄ **Swap with…** (ux-R1) | pick any other timed item today from a short list (nearest first). When the two lengths differ the sheet offers, in plain words: **[Swap their time slots]** (default) — "Team competitions 1:15–2:00 PM · Elective 1 10:00–11:45 AM" (each takes the other's start **and** end, so nothing else moves and nothing overlaps) — or **[Keep their lengths]** — "Team competitions 1:15–3:00 PM (overlaps Snack Shack break) · Elective 1 10:00–10:45 AM (10:45–11:45 left free)" with the overlaps named before choosing | `patches/<dk>/<bid>/{start,end}` (typical items) or `dayBlocks/<dk>/<bid>/{start,end}` (one-offs) |
| ⏱ Change time | pick a new start (and end, or "until the end of the day"); switch "Move everything after it too" ripples later items, never past midnight (§11.5) | as above |
| ↑ Earlier / ↓ Later | swaps with the previous/next **timed** item; each keeps its length; the pair occupies the same span (for neighbours; long jumps use **Swap with…**) | as above |
| ✕ Skip today | skips the item today (reversible "Bring back"); games attached → "Move them to… (another item today / another day / Not on the schedule)" | `…/off: true` + games' `blockId`/`dayId`/`session`/`ord` |
| Games… | move each game to any item on any day (nearest first); moving to a double-points day asks "Make this game double points too?" (`messtival`) | config ops |
| + Add for today | a one-off ("Indoor movie") | `dayBlocks/<dk>/<new id>` |

**Done** first **compares every staged field's stored base with the current value** (the setup
tree and config as they are now, after any colleague's edits). A field someone else changed since
it was staged is shown before anything is written: "Patrick moved *Lunch* to 12:15 since you
started this plan — **[Keep his]** **[Use yours]**" (sync-F4). Then the summary, which **always
lists resulting overlaps and gaps**:
> 4 changes to Wednesday
> • Team competitions now 1:15–2:00 PM (was 10:00–11:45 AM)
> • Elective 1 now 10:00–11:45 AM (was 1:15–2:00 PM)
> • Axe Throwing moved to Thursday · Team competitions
> • Evening competition skipped today
> Nothing overlaps.   *(or: "⚠️ Team competitions overlaps Snack Shack break, 2:00–2:45 PM")*
>
> ☐ Tell people who get reminders for these   *(shown only when phone alerts are live and the
> day is today or later in camp week; ticked by default only when a time moved or an item was
> skipped today or tomorrow; "Only phones that turned on reminders for these items get it — tell
> everyone else in person")*
> **[Done]**  [Keep editing]  [Discard]

Done = a `pre-delete`/`auto` restore point (first rain plan of the day) + **one atomic setup
commit** + **one config transaction** for game moves + **one undo entry** ("Rain plan for
Wednesday") + the alert choice (§12.2). **Offline at Done** the plan commits on the phone as usual
(it syncs later) and the confirmation says so in words: "**Saved on your phone only. Nobody else
has this yet** — it goes out when you have signal." The alert choice is kept only as an intent
and re-asked on reconnect (ux-R11).

**M2 tap count** (Playwright, junior Wednesday, before S5a is approved): Change today's plan ·
Team competitions · Swap with… · Elective 1 · Swap their time slots · Axe Throwing · Move to… ·
Thursday · Team competitions · Done = 10 taps, no keyboard. Over 12 → change the panel.

**Clear all of Tuesday's changes** (⋯): `pre-delete` restore point, then removes `patches/tue`
and `dayBlocks/tue` after confirm; games on removed one-offs get a new home first.

### 11.7 Teams

A fixed list (`CAMP.teamCount` rows: 6 junior, 4 senior). No Add, Delete or reorder; the slots
`t0…tN` never change (they key results, rota, alerts and the rules). The classic tab's "Add
team" is removed in S0j.

```
TEAMS · 6
 🦊  Ferocious Foxes     Foxes     ● pumpkin   🛡     ✅
 🦃  Turkey Dinner       Turkey    ● (last year's colour)  ✅  (note: hard to read in dark mode)
```
A legacy colour that fails a theme is a **gentle note**, not a counted warning (ux-R13), so the
hub can reach "all ready" without touching every team; the Teams screen offers **Pick colours for
the flagged teams** to fix them all in one place.

**The team sheet:** **Team name** (1–60) and **Short name** (1–20; "Used where space is tight,
and when people mention the team in chat (e.g. *Foxes*)"). **Renaming a team asks about the rest
of its identity (ux-R13):** "Also change the short name (*Turkey*) and emoji (🦃)?" with
**[Suggest: *Hawks* · 🦅]** (short name = the new name's last word, emoji unchanged unless picked)
and **[Keep them]**, so chat mentions and the morning-meeting label don't keep the old team's
name; **Emoji** (input + a grid; taken
emoji dimmed with the other team's short name); **Colour** (12 swatches, Appendix A, each a pill
showing the team name on a light chip and a dark chip at once; a swatch another team uses stays
pickable and the hub warns "Two teams are Blue" — decision Q13); **Shield or flag photo**
("Add a photo" → crop to the shield aspect 480×667 with a draggable frame → **PNG if it has
transparency, else JPEG**; a PNG over the cap is re-exported as JPEG on the team's light tint;
long edge 480 px; ≤ 100,000 chars, aiming for ≤ 70,000 (JPEG quality steps down until it fits);
reuses `shrinkToDataUrl`/`loadImage`/`canvasToJpeg` plus a
`canvasToPng` sibling). Upload is online-only: write `teamPhotos/tN = {v: Date.now(), data}`
first, then `teams[i].photoV = v` through the state engine. **Remove photo** sets `photoV`
null. **Counselor fallback text** (`counselor`) shown greyed: "Shown only for teams with no
counselor accounts". The team's camper count (editors) appears on the row.

Photo loading: a device fetches a team's photo **only when it is about to render that crest**
(on a phone today: the followed team's follow card), with one `once()` of `teamPhotos/tN` per
`photoV`; launders it with the full-data-URL check (§9.1); keeps it in memory for the session and
in IndexedDB under `team:<campId>:tN:<v>`. Crest precedence: uploaded photo > shipped junior
shield > emoji. TV: always the light value (sec-F10).

### 11.8 People (counselors, directors, trickle-in, walk-ups)

One list by team that replaces three places (the Members drawer, pending rows,
`SEED_COUNSELORS`). Same data (`<root>/members`), new screen.

```
PEOPLE                                   Let people ask to join  [ On ]
  ASKING TO JOIN · 2
  ┌ Taylor Reed · taylor.reed@gmail.com · 4 min ago
  │ "I'm with the Foxes"
  │ Is this someone already on the list?
  │   [Taylor · Foxes · Counselor · no sign-in yet]  [Tay · Foxes · …]  [None of these]
  │ [Let in ▾ Counselor · Foxes]  [Not now]  [⋯ Block]
  🦊 FEROCIOUS FOXES · 3 counselors · 11 campers
    Alyssa         ✅ signed in
    Sam            ⏳ no sign-in yet          [Add sign-in]
  NOT ON A TEAM
    Jenn           Director · ✅
    Patrick        Owner · managed in the Firebase console
                         [Put people on teams]   [+ Add people]
```
- **Status words, not icons alone:** ✅ signed in · ⏳ no sign-in yet (pending row) · 🙋 asking
  to join.
- **Person sheet:** name, team (this camp's teams or "Not on a team"), **Role** (Counselor =
  `viewer` / Director = `editor`), sign-in (email or phone, auto-detected, `phoneKey()` as
  today), **Camps** (None / Counselor / Director per camp — today's `bindMemberList` /
  `campMembersPath` / `mergeMemberLists` logic, shown only to editors of both camps), "Copy
  invite text", **This is the same person as…** (on a pending row: pick a signed-in member; the
  pending row is removed and its team carried over if they have none; ux-R8), **Remove from this
  camp**.
- **Your own row** and **the owner row** are read-only: "Ask another director to change your
  access" / "Owner · managed in the Firebase console" (`OWNER_MEMBER_KEY`, rules#5).
- **Put people on teams (ux-R9):** one screen listing **everyone** on this camp (signed in and
  pending), each with a team selector, sorted by last year's team then name, with **[Save teams]**
  writing only the changed `members/<k>/teamId` leaves one row at a time (a refused row is listed,
  the rest are saved). It also accepts pasted "name, team" lines that **update existing people**
  as well as add new ones. This is how 18 counselors go back on teams after the wizard, in about
  a minute.
- **+ Add people:** *Type a list* — "One person per line. Add a team after a comma if you know it:
  *Cam, Foxes*". Live preview resolves each line ("Cam → 🦊 Foxes", "Sam → no team matched, will
  be Not on a team", "Alyssa → already on the list: **put on Foxes**"); matching is
  case-insensitive on team name or short name; an existing name is updated, not duplicated (the
  `missingSeedCounselors` rule, extended); **[Add 6 people]** writes pending rows
  (`pending-<slug>-<rand>`) in one multi-path update. Junior also offers "Last year's printed
  roster" (`SEED_COUNSELORS`). *One person with a sign-in* — today's add form.
- **Let people ask to join** (sec-F1): a switch at the top writing `setup/meta/joinOpen`; while it
  is off the rules refuse every request. Its caption: "Turn on during registration so people not
  on the list can ask from their own phone." The hub's People row says when it's been on for more
  than 7 days ("Asking to join is still on — turn it off after registration?").
- **Asking to join** — the listener (sec-F1): editor devices only, attached post-approval when
  `canEdit()`, as a `.on('value')` on `accessRequests.orderByChild('at').limitToLast(25)` (the
  rules carry `.indexOn: ['at']`), degrading only itself. A new row while the app is open raises
  the toast and home bar of §11.1 (ux-R10).
  - **Everything a requester typed is untrusted (sec-F8):** `name` and `note` are rendered only
    through `esc()` (test: a `<img src=x onerror=…>` name and a 400-character note render as
    text, trimmed to the rule limits).
  - **"Is this someone already on the list?" (ux-R8, sec-F8):** instead of an auto-guess, the
    request lists candidate pending rows: same **first name** (case-insensitive) first, then the
    team named in the note, then the rest of that team's pending rows. Each candidate shows its
    team **and role**. **Link** runs `convertPendingMember` to the requester's key, then deletes
    the request. Linking to a **Director**-role pending row additionally asks the approver to type
    the requester's email (or phone) to confirm it's really them.
  - **Let in** (role + team pickers; default role Counselor, decision Q6) asks the approver to
    confirm or edit the **name** that goes into the directory (prefilled from the request, which
    was prefilled from the sign-in display name), and warns if it matches an existing member's
    name ("There's already a Patrick — use a last initial?"), because the directory name is what
    chat trusts. Then `createMemberIfAbsent`, then delete the request (create-then-delete).
  - **Not now** deletes the request; **⋯ Block** writes `accessBlocked/<key>` and deletes the
    request, so that identity can't ask again (unblock from People ⋯ → Blocked).
- **Offline:** every People action shows "Needs a connection" while `.info/connected` is false.
- The Members drawer (`#members-overlay`) becomes a link to People when S7 ships.
- "Access changes can't be undone with Undo — change them back here."

### 11.9 Campers (directors only)

Opens with: "Only directors can see camper names. Counselors never see this list, and it isn't
saved on any phone."
```
CAMPERS · 64
  🦊 FEROCIOUS FOXES · 11
    Maya   Eli   Grace   Owen   Ava R.   Ava T.   …     [+ Add]
```
- **+ Add:** a textarea "First names, one per line or separated by commas" → one multi-path
  update of whole `{name, ord}` records (both are required by the rules, so a rename racing a
  move can't resurrect a camper; sync-F5). Duplicates allowed (caption: "add a last initial to
  tell two apart").
- Tap a name: **Move to ▾ team** (one atomic delete + create), **Rename**, **Remove**.
- Data: `.on('value')` on `campers` only while Campers, People or Teams is open and `canEdit()`;
  detached on close; held in memory only; demotion (`setMemberRole` → viewer) detaches and drops
  it; its error callback sets `campersDenied` and degrades campers only.
- **Offline (ux-R12):** the list is read-only, but names typed into **+ Add** while the signal
  is gone are **held in memory on that open screen**: "Waiting for signal — keep this screen open.
  Camper names aren't stored on phones." They are sent the moment `.info/connected` is true;
  closing the sheet or leaving the screen with names still waiting asks "These 3 names haven't
  been saved yet — they'll be lost. **Keep waiting** / **Discard**". Nothing touches device
  storage (P12).
- No other surface shows camper names in this project (decision Q7 covers a printable sheet).

### 11.10 Meals

A grid: rows are days that have Meal-tagged items; columns Breakfast / Lunch / Supper (only meals
that exist that day). Each cell: dish (≤ 80) and optional emoji. Phone: one day at a time with the
day strip. **Commit on blur only if the cell's value changed since it was focused** (§6.4.9,
sync-F3), so tabbing across the grid never rewrites a colleague's dish. Empty cells allowed
(Happening Now shows the plain label, as today).
"Copy from another day…".

### 11.11 Memory verses

Theme (title, text ≤ 600, reference) then one row per competition day (text, reference, optional
`https://` video link). "Copy verse text from last year" when an archive exists.

### 11.12 Cleanup rota

A grid of competition days × meals on a laptop; **on a phone, one day at a time** (the day strip
picks the day) with **one meal per row** — "Breakfast · 🦊 Foxes 🍁 Maples [Change]" (ux-R2).
Each cell holds team chips (one or two teams). **Fill
evenly** (a pure, tested function: equal count ±1 per team, no team twice in a day, no team on the
same meal two days running) offered as a preview with Apply / Cancel; a fairness line "Each team
cleans 2–3 times. Maples clean twice on Thursday." Writes `cleanup/<dk>/<meal>/<tid>: true`.
Bonus ids stay `cleanup-<team>-<dow>-<Meal>` (computed from the Meal name).

### 11.13 Electives (junior; `CAMP.features.electives`)

For each competition day, three slot columns whose times come from that day's Elective items
(laptop); **on a phone, one day and one slot at a time** — the day strip plus a segmented
**Elective 1 · 2 · 3** control — with stations as rows and people as wrapping chips (ux-R2).
Each slot lists **stations** (emoji + name, picked from the station list or created inline);
each station lists **people** as chips picked from the People list (stored by member key), with
"+ Someone not on the list" (stored as `n-<slug>`). A ⚠️ marks a name-only person whose name
nearly matches a member ("Sophie → Sofia?") with **Link** (re-keys to the member; Sofia, Lily and Alyssa have one spelling each since S0k, decision Q21, so the three known pairs never need this). Helpers: **Same
as Monday** (copies the slot setup), and a computed "On break: Lydia, Zac" line
(`electiveBreakKids` logic; the UI says "On break"). A signed-in counselor's own electives match
by member key first, then by name; `adoptMemberTeam`'s identity check uses `staffNames()`.

### 11.14 Games, attached to the schedule

Organised by the schedule, not Morning/Evening:
```
GAMES · 22 on 10 schedule items
  MONDAY
    10:00  🏅 Team competitions
           🛡️ Shields            Podium   [›]
           🦘 Kangaroo Kickball   Bracket  [›]
           + Add a game here
  NOT ON THE SCHEDULE · 1
           🎳 Rain bowling        Scores   [Put on the schedule…]
                                           [+ New game]
```
- **Which days have games** (top of the screen; moved here from Camp week, ux-R14): "Days with
  games: [Mon] [Tue] [Wed] [Thu] [Fri]" chips, each creating/removing the `config.days` tab for that
  dow through the config engine (removing a tab that has games asks where they go, as `deleteDay`
  does today), with the tab's optional **note** (banners on that day's games panel, today's
  Days-tab note).
- Reorder within an item with ⋯ Move up/down (`ord`); **Move to…** uses the rain-plan picker.
- **The game sheet** keeps today's fields and `validateGameDraft`, disclosed progressively:
  (1) name, emoji, where (defaults to the item's last-used location); (2) **How is it scored?**
  three rows with a sentence each — *Bracket* ("Teams play head-to-head; winners move on"; on
  senior "2 semifinals → 3rd-place match → final"), *Scores*, *Podium*; (3) the format's own
  options; brackets gain **Matchups**: *By standings* (default: 1st v 4th, 2nd v 3rd on senior),
  *Pick them when you start*, *Set them now* (pair pickers, replacing JSON-only
  `roundOneMatchups`) → `bracketSeed`; (4) Extras (collapsed): timer, drawing prompts, **Double
  points** (`messtival`); (5) How to play (rules), unchanged; (6) **When:** "Tuesday · Team
  competitions 10:00–11:45" with **Move…** (choosing a block sets `blockId` and derives `dayId` and
  `session`, §5.8).
- **Saves write only changed fields** (§6.3.5): scoring#3 fixed at the source. Deleted elsewhere →
  "Patrick deleted this game 2 min ago (Put it back with my changes / Close)".
- **Changing the format of a started game** says exactly what is discarded ("the saved podium,
  the bracket in progress, the live scoreboard") and removes result, bracket (either kind), draft,
  live, clock and picSetup (scoring#6, shipped in S0b).
- **Deleting a game** removes results, brackets (**both** `brackets` and `brackets4`), draft,
  picSetup, live **and clock** (today's leak), after a `pre-delete` restore point when it has a
  result; `pruneOrphanedGameData` clears the same set, so a game later created under a reused id
  can't inherit a stale bracket or clock (sync-F13).
- **New game ids** (builder, ⚡ quick game, Duplicate) get a random 4-character tail and a
  `taken` set that includes every key of `results`, `brackets`, `brackets4`, `drafts`,
  `picSetup`, `live` and `clocks` (§5.5): two directors adding "Rain bowling" at once create two
  games, not one that silently replaces the other (sync-F13).
- **⚡ Quick game** attaches to the block happening now or next on that day (falls back to Not on
  the schedule), replacing the `>= 720 ? 'Evening'` guess (settings.js:302) that breaks senior
  afternoons.

### 11.15 The 4-team bracket (game day)

What refs see when a senior tournament starts. Reuses `matchupCalloutHTML`,
`matchTrackerHTML`/`bindMatchTracker` and `bindMatchupCopy` unchanged.
- **Start:** "Suggested by points right now: 🔴 Red v 🟡 Gold · 🔵 Blue v 🟢 Green" **[Start with
  these] [Choose different]** (`bracketSeed: standings`, ties broken by `rankTeamsByPoints` then
  slot). Fixed pairs show with no choice; *Pick* shows two pair pickers. Requires exactly 4 teams
  (`bracketKindFor(n)`: 6 → `six` (existing `brackets`), 4 → `four` (`brackets4`), else a refusal
  that names the count).
- **Step bar:** `Semifinal 1 → Semifinal 2 → 3rd place → Final → Results` (order: decision Q12).
- **3rd place** = the two semifinal losers; **Final** = the two winners (derived for display;
  when a ref records either match, its `a`/`b` are stored with the winner, §5.7.4).
- **Summary:** 🥇 final winner, 🥈 final loser, 🥉 3rd-place winner. Saving writes
  `results[gid] = {medals, savedAt, path}` and `brackets4[gid] = null` in one batch; `messtival`
  doubling unchanged; "Clear result & re-enter" can offer **Reopen the final** from `path`.
- **Undo the last match** at every step (`fourUndo` clears the most recent `at`).
- **Stale double-tap guard (one device):** a winner tap re-reads the match; if already decided →
  ignored, toast "Already recorded by Jenn".
- **Two refs, two devices (sync-F9):** different winners recorded for one match → last ack wins
  for that match and the other ref gets the 60 s "changed right after you" toast; if that makes a
  later recorded match impossible, the bracket shows the **Re-check** step (§5.7.4) instead of the
  next match or the medals. Medals come only from a consistent chain.
- **Own-team guard:** `canScoreRound(a, b)` per match, as in 6-team.
- **No render-time writes:** phase is derived (contrast `renderBracketRound1`).
- **Pure helpers** (the only code that changes a 4-team bracket, unit-tested): `bracketKindFor`,
  `fourSeeds(mode, game, standings)`, `fourPhase(b, order)`, `fourCurrent`, `fourNext`,
  `fourRecord(b, match, winner)` (refuses a decided match or undecided teams; stores `a`/`b`),
  `fourUndo`, `fourMedals` (`null` unless the chain is consistent), `normalizeBracket4` (detects
  `recheck`), `fourResolve(b, choice)` (the two Re-check buttons).
- **Readers updated:** `currentMatchupOf`/`nextMatchupOf` (5804-5827), `upcomingMatchups`
  (2964), `renderLiveHome` labels (5691), `renderLiveWatch` labels and completed list
  (5876-5879), `liveHomeGames`, `gameStatus`, `bracketRefsTeam` (settings.js:127),
  `findNextMatchupFor`.
- The 6-team wizard keeps its flow; in S6b its click handlers move onto extracted pure helpers
  (behind pin-first `bracket.test.js`) and gain Undo-at-every-step and the stale-tap guard.

### 11.16 Notice board, Restore points & backups

- **Notice board:** today's `renderNoticeTab` editor moved under the hub unchanged (`nb-` hooks
  kept).
- **Restore points:** rows like "Before the new-year setup · Jenn · Jul 11, 9:12 PM", "Before
  Jenn's edits, 2:03 PM", "Before restoring 'Tuesday 9 AM'"; ⋯ **Name and keep** (pin; "Kept
  points can't be deleted from the app") and **Delete** (unpinned, non-archive only — the rules
  enforce it, §8.2); tapping shows what would change with section checkboxes (§7.2). "Save a
  restore point now" (named). **Past years** lists archive points with their winner line,
  **Download**, and on the newest one **Undo the new-year setup** (§7.3).
- **Backups:** "Download a backup file" (v3) and "Restore from a file" (refuses the other camp's
  file: "This backup is from Senior camp").
- **Advanced** (collapsed, warning line): per-section "Show the original instead (your changes
  are kept)" switches, and per-section "Start this section again from the original"
  (§10.1).

### 11.17 Things outside the builder that change

- **Denied screen** gains **Ask to join** (§11.18).
- **Schedule sheet** (home): **Add the whole week to my calendar** with its snapshot note
  (§12.4); for editors **Change today's plan** when the schedule is edited here, otherwise the
  one-line pointer to the hub (§11.1); games appear under the item they're attached to. All of
  these are listed in the §9.4 seam table.
- **Happening Now:** unchanged in look; reads `scheduleForDow`.
- **Phone-alerts drawer:** week date read-only; the "remind me about…" list built from
  `planForDow` (one row per `alertKey`, same as today's catalog).
- **Footer chip** "👥 N here": unchanged.

### 11.18 Walk-up "Ask to join" (the requester's side)

On the denied screen (index.html:107-112, `denyMemberFinal` app.js:8438), under today's text,
shown only when a `once()` of the requester's own `accessRequests/<key>` is allowed (i.e. R1 is
live):
```
You're signed in as taylor.reed@gmail.com, but you're not on the list yet.
Your name        [Taylor Reed          ]
Which camp       (•) Junior  ( ) Senior
Anything to add  [I'm with the Foxes   ]   (optional, 200 characters)
                 [Ask to join]
```
- **Your name** is prefilled from the sign-in's display name (Google gives one; phone sign-ins
  start empty), ux-R8.
- One `set()` of `{name, note?, at: TIMESTAMP}` to `<camp root>/accessRequests/<identityKey>`;
  no listener (THE INVARIANT). On success: "Sent. **Now tell a director you've asked** — they'll
  see it under Settings → People. This page will open by itself once they let you in. You can
  close it and come back." (ux-R10)
- **Asking is closed** (the rules refuse because no director has switched it on, or this sign-in
  was blocked): "Asking to join isn't open right now. Tell a director your email
  (taylor.reed@gmail.com) and they'll add you." — the same words for both cases, so a block
  isn't announced.
- No team picker (a non-member can't read `state/teams`); the approving director picks the team.
- While visible, the page polls `once()` of `members/<myKey>` on the chosen camp every 30 s and on
  focus, for at most 30 minutes (then "Tap to check again"). A refused read is harmless. On success
  it sets `localStorage.campScoreboardActiveCamp` to that camp and reloads (one-shot lifecycle).
- The requester can withdraw (delete own row, allowed 60 s after sending) and re-send after
  60 s (rules throttle). After 30 minutes the page says "Still waiting? Find a director — they'll
  see your request under Settings → People. **[Check again]**". The existing `denyMember`
  other-camp bounce still applies.
- Directors with the app open get a toast and a home bar the moment a request arrives, plus the
  People badge and the hub ⚠️ (§11.1); a phone alert per request is decision Q15.

---------------------------------------------------------------------------------

## 12. Outputs

### 12.1 Publishing the schedule for phone reminders (`pushSchedule`)

(The whole push layer stays dormant until Project 1's go-live steps; everything here does
nothing while `PUSH_SERVICE_URL` is blank, and the alert checkbox is hidden.)

- **Built-in camps** publish as today (ids `d<dow>-<start>-<i>`, keys `pushBlockKey(label)`,
  week date from the drawer until S5a, then from `campWeek()`), now **with `rev` and `src`**.
- **Shared-setup camps:** blocks from `planForDow` for dow 0–6, timed only; id `<dk>-<bid>`
  (stable under moves, inserts and renames); `key = alertKey` (= today's key for every seeded
  block, so subscriptions survive); `weekStart` from `setup/meta/weekStart`.
- **Write:** a `transaction` on `pushSchedule`: compute `src = fnv1a(canonicalJSON({weekStart,
  blocks}))`; abort if `cur.src === src` (identical content is already published; the author still sends its `/notify`, §12.2); else
  `{weekStart, at: TIMESTAMP, by, blocks, rev: (cur.rev||0)+1, src}`.
- **Who publishes:** (a) the **author device**, 5 s after its setup/config commit touching
  schedule or week acks; (b) any editor on load when the published `src` differs from its own
  (catch-up, never alerts); (c) the hub's **Publish now**. Content is deterministic, so racing
  editors write identical blocks; `rev` is monotonic by transaction.
- `pushMaybeRepublishSchedule` (push.js:1087) switches to comparing `src` instead of the code
  schedule.
- **Old-build evidence:** if the published record lacks `rev`/`src` (a pre-S5a build
  republished the built-in schedule, possible only if phone alerts went live before S5a), the
  hub's Phone alerts row shows ⚠️ "An older version re-published the built-in schedule at 3:02
  PM — it was put back" and any editor's catch-up republishes. That is the only evidence the
  optional fence (§8.6 F1) ever needs.
- The Worker needs **no change for reminders**: it reads `{dow, start, label, emoji, key}` per
  block and walks a time window, so new ids can't double-send (C24). A block moved later gets its
  reminder at the new time; a block moved into the already-walked window gets none (the change
  alert covers it).

### 12.2 Telling people when the schedule changes (G11)

**Client.**
- The author device tracks which published ids its commits touched since its last publish
  (`dirtyAlertIds`: a typical-item change marks every typical day's occurrence; a patch or one-off
  marks that day's; a deletion marks the old id) and the alert choice (`alert: true` if any commit
  in the batch had the box ticked).
- After its publish (§12.1 a) it calls `POST <PUSH_SERVICE_URL>/notify` with
  `{kind: 'schedule', camp, alert, ids: [...dirtyAlertIds]}` and the Firebase ID token (the
  director-alert transport). The sheet shows the Worker's tally ("Sent to 23 phones") or its error
  text. An old Worker answering "unknown kind" → "Schedule-change alerts need the latest alert
  sender" (S9).
- **Offline commits never alert automatically.** A commit made while `.info/connected` is false
  stores the intent (`lsKey('campSetupPendingAlert')`: ids, label, at). On reconnect, after the
  publish: "Send the alert about Tuesday's changes now? [Send] [Don't send]" → `alert: true` /
  `false`. An intent whose occurrences have all started is dropped silently (`alert: false`).
- When the week date changes or a camp turns on editing here (A1), the client calls
  `{alert: false, ids: ['*']}` to reset the baseline.

**Worker** (`routeNotify` accepts `kind: 'schedule'` → `notifySchedule(ictx, caller, camp, body)`):
1. Caller must be an editor of `camp` (ID token + `members/<key>/role`, as `notifyAlert`).
   `ids`: ≤ 200 strings matching `^[a-z0-9-]{1,40}$`, or exactly `['*']` with `alert: false`.
2. Read `<root>/pushSchedule` and `pushServer/schedSeen/<camp>`. Outside the camp window
   (weekStart − 1 day … + 8 days) → `{sent: 0, reason: 'not-camp-week'}`, still advancing the
   baseline for `ids`.
3. If `schedSeen` is absent or its `weekStart` differs, or `ids` is `['*']`: set `schedSeen` to
   the published blocks and reply `{sent: 0, reason: 'baseline'}`.
4. For each requested id: `was = schedSeen.blocks[id]`, `now = published.blocks[id]` → moved
   (dow/start changed), renamed (label changed), cancelled (was, no now), new (now, no was), or
   unchanged (skipped). A cancelled + new pair sharing the same `key` becomes one "moved" item.
   Keep only items whose old **or** new occurrence (`weekStart + dow`, camp time, DST-safe) lies
   between now and the end of tomorrow and hasn't started.
5. If `alert`: `takeRateSlot(camp, 'sched', 10 s)`; recipients = devices (the existing 4-newest
   cap) whose prefs have `blocksAll` or `blocks[key]` for an item's old or new key; `lead` is
   ignored; the "director alerts" mute does not apply (they asked to follow these blocks —
   decision Q26). **One digest per device**, listing only items that device follows: title "📅
   Tuesday's schedule changed" (or "Today's schedule changed"); body up to 3 lines like "🏅 Team
   competitions → 1:15 PM (was 10:00 AM)", "🔥 Campfire moved to Thu 8:00 PM", "Evening
   competition cancelled today", then "+2 more"; payload kind **`block`** (sw.js unchanged) with
   `open: 'schedule'`, `tag: 'sched-<camp>-<rev>'`, TTL until the end of the latest affected camp
   day; queued through `deliverJobs`/outbox (`PUSH_BATCH` unchanged; no `batch.block`, so the body
   isn't rewritten). Audit row `pushAlerts/<id>` with `kind: 'schedule'`.
6. **For the requested ids only**, set `schedSeen.blocks[id] = now` (or delete it), whether or not
   `alert` was set. The baseline means "what followers were last told about this block", so one
   editor's quiet save can never swallow another editor's alert about different blocks.
7. Reply `{sent, queued, devices, items}`.
8. `cronMaintenance` deletes `schedSeen/<camp>` more than 8 days after its week.

**Budget:** its own invocation (not the cron's 10 ms / 50-subrequest budget): token check,
members, `pushSchedule`, `schedSeen`, the camp's push tree, one `schedSeen` update, one audit
write, ≤ 20 encryptions with the rest to the outbox. Proven in `tests/push-e2e/` (a mock phone
subscribed to `supper`: move supper with the box ticked → exactly one digest; untick → none;
two editors in a row with different choices → only the ticked change is sent).

**Not alerted (no checkbox):** past occurrences; anything outside camp week; meal, verse and rota
text. **Unticked by default:** typical-day edits and renames/emoji/label fixes (ux-R11); only a
day-specific time move or skip today/tomorrow starts ticked.

### 12.3 The TV page for both camps (`current-standings.html`)

- **Camp choice:** `?camp=junior|senior`, else `localStorage.campScoreboardActiveCamp` (the
  presenter's app choice on the same origin), else junior. The page sets
  `window.CAMP_FORCE = campId` **before** loading `camps.js`, whose `activeCampId()` gains one line
  honouring `CAMP_FORCE` when it names a known camp (the app never sets it, so junior is
  unchanged). `stalling.html`'s link passes `?camp=<active camp>`; its "count 'em down from 6th"
  copy uses the team count.
- **Shared code instead of copies:** the page loads `defaults.js?v=N`, `camps.js?v=N` and
  `camp-core.js?v=N` (all side-effect-free; defaults first). It deletes its own
  `DEFAULT_TEAM_NAMES`, `TEAM_EMOJI`, `TEAM_SHIELD`, `MESSTIVAL_GAME_IDS`, `STORAGE_KEY` and
  double-window copies (current-standings.html:350-373) and uses `CAMP` for `dbRoot`,
  `storageSuffix`, `teamCount`, defaults, emoji, shields and accents. The TV script stays one IIFE,
  so camps.js's globals can't collide.
- **`camp-core.js`** (new, pure, also loaded by index.html before app.js): `DOUBLE_BONUS_START/END`
  (moved from app.js), `etWallToEpoch(ymd, minutes)` (ported from worker.js), `doubleWindowFor(
  {epoch, weekStart, double})` (§5.7.3), `bonusIsDouble(b, win)`, `liveGameIdSet(config)`,
  `computeStandingsCore(state, config, win)`. app.js's `bonusCountsDouble`/`inDoubleBonusWindow`
  call into it; a parity test fuzzes `medalCounts` totals against `computeStandingsCore`.
- **Data:** `.on` `state` and `config` as today (both with **cancel callbacks**, pages#3), plus a
  tiny `.on` of `setup/meta` (week date, double window, finale day) whose cancel is **non-fatal**:
  it falls back to the built-in defaults like `chatDenied`, never to the reload path (sec-F10).
  Team identity from `state.teams` + the per-field fallbacks; crests from `teamPhotos/tN` (`once()`
  per `photoV`, kept in memory and in IndexedDB like the app) → shipped shield → emoji tile — **no
  `<img src="undefined">`** (current-standings.html:777-779).
- **Rendering is sanitized with the app's own code (sec-F3, P14).** Today the page concatenates
  `teamEmoji(id)` raw into `innerHTML` (current-standings.html:837, 920, 1050) and builds `'<img
  src="' + shield + '"'` (:778, :835, :1043), and it has **no Content-Security-Policy** (only
  index.html has one). Once emoji and crests come from the database, an editor (or a stolen
  editor token) could plant markup that runs in the presenter's signed-in session. So: every
  emoji, short name and colour goes through `camp-core.js`'s `safeEmoji`/`safeShort`/
  `safeColorVars`; names stay `esc()`'d; crest images are created with `document.createElement
  ('img')` and `img.src = safeCrestSrc(…)`, never string-built; the inline script moves to
  `current-standings.js` (loaded with `?v=`), and the page gains a CSP meta tag mirroring
  index.html's (`script-src 'self'` plus the pinned Firebase SDK hosts; `img-src 'self' data:`; no
  inline script).
  Intro and cannon loops iterate the real team ids (no literal `t0…t5`); the intro counts down
  from N.
- **pages#5:** `computeStandings` skips results whose game id isn't in the live config (via
  `liveGameIdSet`, null-guarded), matching `medalCounts`, and doubles bonuses with
  `doubleWindowFor` (legacy pin included).
- **pages#6:** sign-in mirrors `identityKey` (email key, else the E.164 phone number); members
  check `<root>/members/<key>`.
- **pages#3:** a `state`/`config` cancel → the denied overlay → reload in 5 s; an auth change
  after start reloads (the app's one-shot lifecycle). **Reloads are capped at 3 per hour**
  (counted in `sessionStorage`); past the cap the overlay stays with "Tap to try again", so a TV
  left on with rules rolled back can't reload every 5 s and burn the download quota (sec-F10).
- **Finale:** `isFinaleDay()` = today (camp time) is `finaleDow()` and, when a week date exists,
  inside that week. `?finale` still forces it.
- **Tests:** `tests/tv.test.js` loads `current-standings.js` into a vm with a stub DOM and tests
  camp selection, `computeStandings` (orphans, doubling incl. the legacy pin, 4 teams),
  `normalizeTeams`, null-safe crests, `isFinaleDay`, **a `<img src=x onerror=…>` emoji and a
  quote-breakout crest rendering inert**, the non-fatal `setup/meta` cancel and the reload cap; a
  check that current-standings.html has a CSP meta and no inline `<script>` body. `TV_BUILD` bumps
  on every edit.

### 12.4 A full-week calendar file

- **Where:** the schedule sheet's **Add the whole week to my calendar** (per-day button stays).
  Disabled until a week date exists ("Ask a director to set the camp dates"). During camp week a
  second choice, **Only the days from today**, leaves out days already past (ux-R15).
- **Said where it's downloaded (ux-R15):** under the button, in plain words: "This is a snapshot
  of the schedule as it is now (Tue 9:40 AM). Your calendar won't update itself — if the schedule
  changes, download it again and delete the old camp events first." The same line is in the
  file's `X-WR-CALDESC`.
- **`buildWeekIcs()`** iterates `weekDays()` and each day's timed `planForDow` blocks; dates are
  `weekStart + dow` (never "this week"). Output:
  ```
  BEGIN:VCALENDAR / VERSION:2.0 / PRODID:-//camp.patricksimpson.info//Camp Scoreboard//EN
  CALSCALE:GREGORIAN / METHOD:PUBLISH
  X-WR-CALNAME:Junior Camp · Jul 18–24, 2027 / X-WR-TIMEZONE:America/New_York
  (the existing VTIMEZONE block)
  BEGIN:VEVENT
  UID:junior-2027-07-18-tue-b-team-competitions-600@camp.patricksimpson.info
  SEQUENCE:<minutes from weekStart−180 days to meta.edited.schedule.at, or 0>
  DTSTAMP:<now UTC> / LAST-MODIFIED:<meta.edited.schedule.at UTC>
  DTSTART;TZID=America/New_York:20270720T100000 / DTEND;TZID=America/New_York:20270720T114500
  SUMMARY:🏅 Team competitions
  DESCRIPTION:Games: Shields\, Kangaroo Kickball\nOn the menu: … (meal items)\nCleanup: … (meal items)
  END:VEVENT
  ```
  UIDs are unique and stable (camp + week + day + block id): fixes today's duplicate
  `campday-2-1275` on junior Tue/Thu and the junior/senior collision. Lines folded at 75 octets,
  UTF-8 aware. Filename carries the export time so two downloads are told apart:
  `junior-camp-2027-07-18-saved-0720-0940.ics`. Built-in camps use
  `<camp>-<week>-<dk>-<i>-<start>` UIDs. The per-day button uses the same builder.
- **Honest limit:** re-importing **updates** events in Apple Calendar (same UID, higher
  SEQUENCE); Google Calendar's file import may duplicate them, and neither removes deleted
  items. A live subscription needs a public URL (out of scope, decision Q20).
- **Tests** (`ics.test.js`): UID uniqueness per file and across camps, stability across a label
  edit, folding, the DST edge, dates from `weekStart`.

---------------------------------------------------------------------------------

## 13. Staged build plan

### 13.1 Overview

Every stage leaves a live camp working. "Off-season" stages never deploy within ±2 days of a
camp week (P8). Today is 2026-10-27; junior ran in July. No camp week runs before June 2027
(Q1), so everything that ships before then is off-season.

| Stage | Ships | Rules / owner step | Activates by | During a camp week? | Rollback |
|---|---|---|---|---|---|
| **S0** Safety fixes (11 commits) | B1; scoring#6 + clocks leak; rules#5; danger contrast; .ics UIDs; unknown-bracket-kind guard; legacy roster gate; config first-pull gate + accounting (builder read-only until the first config snapshot); test scaffolding; classic "Add team" removed; **counselor spelling merge (S0k, Q21)** | — | deploy (bug fixes) | yes | `git revert` each |
| **T** TV for both camps | `camp-core.js` (incl. the shared sanitizers); TV `?camp=`, shared scripts, script moved out of the page + CSP, pages#3/#5/#6, reload cap | — | deploy | yes (TV only) | revert |
| **S1** Accessor seam | §9 SEAM block; every consumer converted; `seam.test.js` | — | deploy (no-op refactor) | **off-season** | revert |
| **S2a** `pushState` quarantine | §6.2 #1 | — | deploy | **off-season** | revert |
| **S2b** Teams per field | §6.2 #2 | — | deploy | **off-season** | revert |
| **S2c** Two-tab writer lock | §6.9 | — | deploy | **off-season** | revert |
| **S2d** Epoch check | §6.2 #3 (no-op until an epoch exists) | — | deploy | **off-season** | revert |
| **S3** Config engine v2 + undo core | §6.3, §7.1 core | — | deploy | **off-season** | revert (`_cfgBase` fields ignored by old code) |
| **R1** Rules | §8.2 + §8.3, one PUT | **Owner: Cloud Shell runbook** | publish | yes (inert) | PUT the backup |
| **S4** Setup infrastructure (dark) | `setup-sync.js`, `setup-ui.js` shell + hub, restore points + Backups v3, `editorsHere` + "also here", sync line, undo pill, `askDialog` | — | deploy (hub + backups only) | yes | revert; nodes inert |
| **S5a** Schedule as data | A1 (schedule section) + A2; Camp week; Schedule; rain plan with game moves; publisher `rev`/`src`; full-week .ics; push drawer week line | — | **A1 by the owner, both camps, one sitting** | code yes; **A1 off-season (no camp before June 2027)** | Use the original week again; `pre-seed` point; revert |
| **S5b** Other sections | Meals, Verses, Cleanup, Electives screens + turn-on prompt | — | turn on per section (owner only, Q8) | yes | section off switch (owner only); revert |
| **S6a** Games screen | games by schedule item; progressive game sheet; When picker; ⚡ quick game to the current block; Matchups options | — | deploy | yes | revert (`blockId` inert to old code) |
| **S6b** 4-team bracket | `brackets4`; 4-team flow; 6-team helpers extracted behind pin-first tests | needs R1 | deploy | **off-season** (state key) | revert (old code ignores `brackets4`) |
| **S7** Teams & People | Teams (palette, photos, short names), People (lists, Put people on teams, walk-ups behind the "Let people ask to join" switch, block list, owner row), Campers, chat mentions via `teamShort`/`staffNames` | needs R1 | deploy | yes | revert; nodes inert; switch asking off |
| **S8** New-year wizard | §11.3; device-local reset; history filter; stranded download; hub complete; **Undo the new-year setup** | — | **A3 (owner only)** | **off-season only (enforced)** | **Undo the new-year setup** (§7.3: archived data **and** archived epoch, one atomic update) |
| **S9** Alerts go further | ONE Worker release: `notifySchedule` + `short`-name mentions + `schedSeen` cleanup; client "Tell people" checkbox | **Owner: Worker paste** (with Project 1 go-live) | deploy | yes | re-paste the previous Worker; checkbox hides itself |
| **S10** Tidy up | classic tabs removed; dead `pendingRemoteConfig` remnants; CLAUDE.md final pass; optional F1 fence only if §12.1 evidence appears | optional F1 PUT | — | yes | PUT the backup |

**Ordering logic.** S0/T are independent fixes. S1 turns every later change into a local edit
behind an accessor. S2/S3 harden the engines that everything builds on, one change per deploy,
before anything new is built on top. R1 lands all rules at once after S2a (quarantine) and
before the first code that uses them. S4 lands the plumbing and safety nets (restore points)
**before** the first data-changing activation (A1 in S5a). S5–S7 are features behind activation
or new screens. S8 depends on all of them. S9 depends on Project 1 go-live. S6b keeps its
slot: no camp runs before June, so senior doesn't need brackets early (decision Q9).

**Suggested calendar** (fixed by decisions Q1 and Q2: no camp week before June 2027, and both
camps roll out together): Nov–Dec 2026 S0, T, S1, S2a–d, S3; Jan 2027 R1, S4, S5a; Feb S5b, S6a,
S6b; Mar S7; Apr S8; then ONE **joint rehearsal of both camps** (A1 pressed for both in one
sitting, edits, a 4-team bracket on a sandbox game, the wizard run once and undone with **Undo the
new-year setup**); May the real new-year setup for both camps; S9 whenever phone alerts go live
(after S5a recommended, decision Q3). **The integrated order with the redesign's stages
(D0–D7) is `BUILD-PLAN.md`; where it differs from this calendar, it wins.**

### 13.2 Stage details

#### S0 — Safety fixes (each its own commit, test and deploy)
- **S0a B1 zombie draft:** **Back** and a tab switch with a dirty game draft ask "Discard your
  changes to *X*?" and clear `gameDraft`; `builderDirty()` is false when the builder is closed.
  Test: `editorMidEntry()` false after Back.
- **S0b scoring#6 + clocks leak:** a format change clears result, `brackets[id]`, `drafts[id]`,
  `clearLiveMatch(g)`, `clocks[id]`, `picSetup[id]`, with a confirm listing them; `deleteGame` and
  `pruneOrphanedGameData` also delete `clocks[gid]`. Tests: new `settings-crud.test.js` (pin-first:
  `validateGameDraft`, `saveGameDraft`, `duplicateGame`, `deleteGame`, `deleteDay`, reorder).
- **S0c rules#5:** `OWNER_MEMBER_KEY = 'patricksimpson,fx@gmail,com'` in app.js;
  `renderMemberList`/`bindMemberList` treat it like `self` (no switches, no team select, "Owner ·
  managed in the Firebase console"); bulk member updates skip it, and (from S7/S8) every bulk
  member write is per-row and best-effort, never folded into a larger atomic update, so one
  odd row can't refuse unrelated work (sec-F4). Test: constant equals the literal in both rules
  roots.
- **S0d danger text:** `.danger-link` (styles.css:1576) and every `color: var(--color-danger)` used
  **as text** (styles.css 499, 1695, 2262, 2331, 2358, 2685, 2964, 3197, 4194, 4728, 5198) switch to
  `var(--color-danger-text)`; light `--color-danger-text: #b42318` (6.57:1 on white, 6.07:1 on
  `#f4f6f9`); dark stays `#ff8a8a` (7.16:1). Test: contrast of the token values.
- **S0e .ics:** per-day UIDs `<camp>-<dk>-<i>-<start>`, 75-octet folding, `X-WR-CALNAME`.
- **S0f Unknown-bracket-kind guard:** `renderTournament` treats a `brackets[gid]` with any `kind`
  or missing 6-team fields as "This bracket needs the newest version — pull down to reload", with
  no writes and no throw. (Belt and braces; `brackets4` is the real fix.)
- **S0g Legacy roster gate:** `normalizeSyncedState`'s roster migrations run only when
  `!state.meta.epoch` (no-op today).
- **S0h Config first-pull gate:** `configReady`; nothing in `pushConfig` before the first config
  snapshot except the null-seed (now a transaction, §6.3.3); **until `configReady` the game/day
  builder is read-only** with "Loading the games list…" (there is no merge yet, so an edit made
  now would be silently replaced by the first snapshot; S3 lifts this, sync-F14);
  `pendingConfigWrites` counted; `pendingWritesTotal()` introduced and used by `reloadBlocked`,
  `hasUnsyncedWork`, `hasUnconfirmedLocalWork`; `.catch` surfaces "Couldn't save the week setup".
  Tests: `config-gate.test.js` (incl. "no builder edit possible before the first snapshot").
- **S0i Test scaffolding:** `tests/fake-rtdb.js` (in-memory ref: `on/once/off/update/set/
  transaction`, prunes nulls/empties, sorts keys, `.info/connected` toggling, offline queue,
  injected per-path refusals, transaction contention); `tests/fixtures/legacy-builder-v183.js`
  (v183 `toEditableDraft` + `saveGameDraft` verbatim).
- **S0j Fixed team counts:** the classic Teams tab loses **Add team** and **Delete team**
  (owner-confirmed fixed counts; removes the `t-<ts>` id bug).
- **S0k Counselor spelling merge (decision Q21).** One commit, before anything derives an id from
  a name (the seed's `n-<slug>` person ids, S5a) and before phone alerts go live (push is dormant
  today, so nobody follows a block whose label names a person; `pushBlockKey` outputs for the
  renamed labels are recorded in the test so the change is visible). `camps.js` only:
  **Alysa → Alyssa, Sofie → Sofia, Lilly → Lily** in `ELECTIVES`, `TEAM_COUNSELORS` (its "keyed to
  the ELECTIVES spellings … not the standings' Lily" comment goes, the caveat no longer exists),
  the printed-roster seed behind `SEED_COUNSELORS`, the morning-meeting labels (`Alyssa/Cam/Sam
  (B)`, `Sofia/William (B)`, `Lily/Jacob (A)`), the Wednesday evening block
  (`weekdayEvening('Sofia')`) and the header comments. `tests/fixtures-junior-week.json` is
  regenerated by a one-off script in the same commit; the review rule is that its `git diff`
  shows **only** those three spellings. `tests/chat.test.js` (the printed-list label
  `'Alysa'` → `'Alyssa'`) and the `tests/auth.test.js` sample names follow. A small alias table
  `COUNSELOR_NAME_ALIASES = { alysa: 'Alyssa', sofie: 'Sofia', lilly: 'Lily' }` with one function
  `canonicalCounselorName(n)` (camps.js) is used by `missingSeedCounselors`, the identity check in
  `adoptMemberTeam` / `myStationFor`, and later the People matcher, so data already out there (a
  member row named "Alysa", a phone whose stored `state.identity` is "Lilly") still matches;
  `normalizeSyncedState` rewrites a stored identity through it once. Member rows already in the
  database keep the name they were typed with until a director renames them in the Members list
  (three rows at most; a director action, listed in `BUILD-PLAN.md`).
  **Tests:** `spelling.test.js` (no old spelling anywhere in camps.js or the fixture; the alias
  table both ways; `missingSeedCounselors` doesn't add a second "Sofia" next to a member named
  "Sofie"; a stored identity "Lilly" still finds its electives). **Verify live:** junior's Now
  banner and schedule sheet show "Sofia/William (B)" and "Lily/Jacob (A)"; a phone whose identity
  was "Lilly" still sees its station.
- **Verify live:** the CLAUDE.md `curl` checks; junior and senior as an editor look unchanged
  (Playwright screenshots at fixed `?now=` vs v184; on junior only the three spellings differ);
  the owner row is read-only.

#### T — TV page for both camps
- **Ships:** `camp-core.js` (+ its `?v=` tag in index.html before app.js; app.js double-window
  calls and the sanitizers move into it, parity-tested), §12.3 minus `setup/meta` reading (added
  in S5a behind a presence check of the node, with its non-fatal cancel), the TV script moved to
  `current-standings.js` with a CSP meta on the page, sanitized DOM rendering, the 3-per-hour
  reload cap, `CAMP_FORCE` one-liner in camps.js, stalling.html link.
- **Tests:** `tv.test.js`; `camp-core.test.js` (legacy pin; DST; standings parity fuzz; sanitizer
  cases: markup emoji, quote-breakout data URL, `javascript:`/external crest URLs refused).
- **Verify live:** junior TV unchanged (`?demo`); `?camp=senior` shows 4 teams and no broken
  image; a phone-account presenter can sign in; revoking access shows the overlay, then a reload,
  and no more than 3 reloads in an hour; the browser console shows no CSP violations.

#### S1 — The accessor seam (no-op refactor; off-season)
- **Ships:** §9.1–9.3: the SEAM block, `blockMeal`/`blockKey`/`blockPushId`, every direct reader
  in app.js, chat.js, push.js and settings.js converted; `seam.test.js`.
- **Tests:** `accessors.test.js` + `.senior.test.js` (`===` parity, every row); the existing
  every-minute banner fuzz unchanged and green; render-stability for accessor-backed panels.
- **Verify live:** Playwright before/after screenshots identical (banner, schedule sheet, follow
  card, verse, cleanup, electives) for both camps.

#### S2a–S2d — State-engine hardening (four separate deploys; off-season)
- **S2a** quarantine (§6.2 #1). Tests: refused path quarantined, others advance; Retry/Discard;
  network path diff-identical; scores keep syncing with a poisoned path present.
- **S2b** teams per field (§6.2 #2). Tests: `teams-sync.test.js`; `sync.test.js:344` changed on
  purpose; old-client whole write still adopted.
- **S2c** writer lock (§6.9). Tests: `tablock.test.js` (stubbed `navigator.locks`; steal →
  read-only → reload; reload-ordering retry; API throws → fail open; viewers never lock).
- **S2d** epoch check (§6.2 #3). Tests: `sync-epoch.test.js` (old-epoch unconfirmed work stranded,
  never pushed; download offered; legacy epoch untouched).
- **Verify live (each):** two laptops, on each camp in turn (both are idle until June, Q2);
  airplane-mode edit → force reload → reconnect;
  second tab read-only (S2c).

#### S3 — Config engine v2 + undo core (off-season)
- **Ships:** §6.3 entirely; undo core (§7.1) wired to config and teams commits in the existing
  builder (toast + Undo button); Days/Teams handlers resolve by id (P10); remote config applies
  while a builder field is focused, rendering deferred.
- **Compatibility:** writes the same 5-key array-shaped config; old builds read it unchanged;
  their whole `set()` still accepted (it can clobber only from devices that haven't reloaded).
- **First run:** no `_cfgBase` → plain adopt, then tracking starts.
- **Tests:** `config-sync.test.js` on the fake RTDB (rebase on receipt; two devices edit different
  fields of one game → both survive; same field → last ack + toast; delete vs edit → dropped +
  "Put it back"; `null` cur aborts; the null-seed transaction; `configReady` gate; offline edit →
  reload → first-snapshot merge pushes it; prune/sort canon; epoch strand; accounting);
  `undo.test.js`; legacy-builder fixture keeps `blockId`/`ord`. **Changed on purpose:**
  `sync.test.js:355-372`, `sync-merge.test.js:132-147`.
- **Verify live:** two laptops edit two fields of one game at once, on each camp → both kept;
  airplane-mode game edit → reload → reconnect → kept.

#### R1 — The one rules update (owner)
- **Before:** emulator suites (§8.8) SAFE in both directions; seeded trees for both camps accepted
  (junior's team patches included); `rules.test.js` updated (§8.10); the ancestor-validate probe
  (§8.1) and the rules size check (§8.6) done and recorded; `owner-only.mjs` and the reveal suite
  (§8.8) green. The release carries the owner-only clauses and the reveal blocks (§8.6).
- **Do:** rules-only commit (its message states the file's `sha256`, first 8 characters) → push →
  owner pastes the Appendix E blocks: back up, publish (the script refuses a file whose hash
  doesn't match), read back → the unauthenticated probes **and the discriminating signed-in checks**
  (§8.9, including the non-owner-director check) pass → mark done in CLAUDE.md. `accessRequests` stays closed (`joinOpen` absent).
- **Rollback:** PUT the backup saved in step 0 (every addition is inert).

#### S4 — Setup infrastructure (dark)
- **Ships:** `setup-sync.js` (engine §6.4, `normalizeSetup`, `resolveDay`, `buildSeed`, restore
  points read/write, publisher hash), `setup-ui.js` (hub shell with live rows for Teams, People
  counts, Restore points, Notice; Schedule row shows "Built-in schedule (editing comes next)"),
  Backups screen (§7.2, §7.4), `editorsHere` and "also here" (§6.7), `askDialog`, sync line,
  undo pill, the single `persistSetup()` gate (§6.9), `isOwner()` / `ownerName()` and the
  owner-only gating of A1, the wizard and the switches (decision Q8). Both new files join
  index.html (**15 `?v=` assets** on this spec's own count, 17 in the integrated order) and
  `tests/harness.js` `APP_FILES` (`defaults, camps, camp-core, app, setup-sync, settings,
  setup-ui, chat, push`).
- **Tests:** `setup-sync.test.js` (prune/heal; first merge incl. prune + key-order variants ported
  from `sync-offline.test.js`; per-path depths; unsent ops rebased on adopt; bisect/quarantine;
  denied path never touches `fbRef`/`syncDenied`; stamps excluded from diffs and added at push;
  clashes persisted; echo keeps refs; **adopt-path `dropped` ops reach the Put-it-back list**;
  **a bare focus-and-blur writes nothing**; **no automatic patch stripping**); `restore.test.js`
  (body excludes campers/members/chat/photos; retention 40/20 never touches pinned, `archive` or
  `pre-wizard` points; selective restore emits a minimal diff; `pre-restore` first; never writes
  epoch; **a Games-only restore keeps every game with a result, bracket, draft, live match or
  clock and never prunes**; preconditions re-read the server); `editors-here.test.js`
  (fail-closed names; viewers never write or listen; Devices list joins presence and
  `editorsHere` by device id, 10-minute age filter); `checklist.test.js` (pre-seed rows; one
  front door per §11.2's order); `owner-only.test.js` (the helpers and the hub's owner-only
  rendering contract: owner-only controls render only for the owner key; another director sees the
  sentence with the owner's name; a non-owner call path returns a refusal before any write; the
  owner's name falls back to "the owner". S5a, S5b and S8 extend it to A1, Turn on, the wizard and
  Undo the new-year setup as those buttons arrive).
- **Verify live:** probes; "Save a restore point now" on both camps and see it listed; two editors in
  the builder see each other.

#### S5a — Schedule as data (A1 per camp; junior off-season)
- **Ships:** A1 + A2 (§10.1–10.3); accessors switch on `meta.on.schedule`; Camp week (§11.4) and
  the "Days with games" chips (§11.14, `config.days`); Schedule (§11.5); rain plan with game
  moves, Swap with…, phone layout and stored bases (§11.6);
  publisher with `rev`/`src` and the week date from setup (§12.1); TV reads `setup/meta`; the
  week-date migration (§10.6); full-week .ics (§12.4); hub rows Camp week, Schedule, Games
  (attachment), Phone alerts.
- **Approval gate:** the M2 tap-count script (§11.6) is run on junior Wednesday before this stage
  is approved; over 12 taps → change the panel first (ux-R1).
- **Activation:** A1 by **the owner, for both camps in one sitting**, off-season (decisions Q1,
  Q2, Q8); compare against the built-in output on each (§10.4 guarantees it). There is no
  senior-first trial: the seeded-fidelity tests run for both camps, the emulator runs the seeded
  trees for both camps (R1 gate), and the way back is **Use the original week again** plus the
  `pre-seed` point per camp.
- **Tests:** `seed.test.js` + `.senior` (all of §10.4); `schedule-edit.test.js` (Just Tuesday /
  Every day like Tuesday → exact paths; "Change Wednesday too"; reset; make own day keeps ids; overlap +
  `overlapOk`; Earlier/Later keeps durations; **Swap with… "time slots" and "keep lengths"
  produce the stated times and list the overlaps**; one atomic batch + one undo entry; **rain Done
  with a colleague's later change shows the clash and writes nothing until chosen**; **a stale
  draft from another epoch is dropped**; **no ripple ever produces `end > 1440`; every seeded block
  opened and saved unchanged produces zero ops**; **make own day / follow again are one update
  each and clear the other mode's subtree**; delete item → games re-homed); `games-blocks.test.js` (oracle table; exact-once; dangling `blockId`; derived
  `dayId`/`session`; new tab created in the same transaction); `push.test.js` additions (keys
  identical post-seed; ids `<dk>-<bid>`; `rev` monotonic; `src` stable); `ics.test.js`; the
  seeded-context re-run of `week`/`push`/`chat` tests (and, in the integrated order, whichever
  redesign tests exist by then; D3 and D4 add `now-model` and `games-tab` to the seeded run); A1 and the switches are owner-only
  (`owner-only.test.js`).
- **Verify live:** console shows `setup/meta/on/schedule` under both `campScoreboard` and
  `seniorScoreboard`; banner, sheet and .ics
  match pre-A1; an edit on one phone appears on another within seconds; airplane-mode edit →
  reload → reconnect → kept; **Use the original week again** restores the built-in schedule.

#### S5b — Meals, verses, cleanup, electives
- **Ships:** §11.10–11.13; their accessors' shared branches; hub rows; "can now be edited here
  too — **Turn on**" prompt for camps already on (owner only; everyone else reads "Patrick turns
  it on", Q8).
- **Tests:** Fill-evenly function; elective member-key identity + name fallback; meal-tag
  decoration (a tagged senior "Supper and free time" shows its dish); verse video `https://` only.

#### S6a — Games screen
- **Ships:** §11.14; the home Competitions card reads through `gamesForDay` **but keeps today's
  visible Morning / Afternoon / Evening grouping** (derived from each game's block), so the
  home redesign isn't pre-empted (ux-R17; in the integrated order the Games tab, D4, ships first
  and this part is not built, §9.4); `dayGamesHTML`, `gameStatus` header line via
  accessors; random-tail game ids and the wider `taken` set; `brackets4` cleared on delete/prune.
- **Tests:** progressive sheet saves only changed fields; deleted-elsewhere; quick game attaches to
  the current block (senior afternoon); Matchups ↔ `bracketSeed`/`roundOneMatchups`; two devices
  adding "Rain bowling" at once → two games; a new game never inherits a stale bracket/clock
  (sync-F13); the Competitions card markup is unchanged for a seeded camp (render-stability).

#### S6b — The 4-team bracket (needs R1; off-season)
- **Ships:** `brackets4` sync key (§5.7.4, §6.2 #4); §11.15; 6-team helpers extracted with Undo at
  every step and the stale-tap guard.
- **Tests (pin first):** `bracket.test.js` (6-team full path to `medalCounts`, undo, bye tie, fixed
  order, `nextMatchupOf`, prune fuzz) **before** extraction; `bracket.senior.test.js` (standings
  pairing; semis → third → final → summary; bronze = 3rd-place winner; `messtival` ×2; undo at
  every step; stale double-tap ignored; **two devices record different semifinal winners after
  the 3rd-place match → `recheck`, `fourMedals` null, no result saved, both Re-check buttons
  resolve it; a late tap after the result was saved is ignored and listed** (sync-F9); own-team
  guard; prune fuzz; `computeSyncUpdates` emits
  `brackets4/<gid>/m/<match>`; `firstSnapshotMerge` of an offline semi result; old-client
  `applyRemoteState` ignores `brackets4`). **Changed on purpose:** `week.senior.test.js:105-115`
  (refuses → starts a 4-team bracket; a 5-team roster refused with the count).
- **Verify live:** a senior sandbox tournament end to end; Clear result; delete the game; a junior
  6-team smoke test on a sandbox game.

#### S7 — Teams, People, Campers, walk-ups (needs R1)
- **Ships:** §11.7–11.9, §11.18; palette + `teamAccentVars` + CSS `--team-accent-l/-d` switched under
  `body.dark-theme` and the `prefers-color-scheme` block; chat mention dictionary from `teamShort` /
  `staffNames`, with the **capitalised-team-word rule** (below); the Members drawer links to
  People; the "Let people ask to join" switch, the block list, "Put people on teams", the
  request toast/bar and the camper waiting-for-signal hold. Before shipping, read both camps'
  `state/teams` ids (owner GET): if any id isn't `tN`, add a one-off repair (otherwise none is
  built).
- **Team words in mentions (ux-R19).** A team's short name, or a single word of its name, counts
  as a mention only when it is typed **with a capital first letter** ("Red", "Gold") or is
  followed by "team"/"campers" ("red team"), or when the full team name appears ("Red Team").
  Lower-case "red", "blue", "gold" in ordinary sentences no longer ping anyone. This tightens
  today's case-insensitive team-word matching on the client and the Worker's ≥ 4-letter word
  rule alike (so "blue" stops matching too); person names keep today's matching. The existing
  "Mentions" switch in Phone alerts already lets anyone silence mention alerts; no new switch is
  added (it would need a rules change to the sealed push prefs). `chat.test.js` team-word cases
  change on purpose.
- **Tests:** `palette.test.js` (every swatch both themes, recomputed); `teams-screen.test.js`
  (per-field writes; distinct-colour warning; legacy colour is a note, not a warning; rename asks
  about short name and emoji; photo laundering with the full-charset check; IndexedDB key;
  precedence; only rendered crests fetched);
  `campers.test.js` (never in any `setItem` — scan every call in the stub; never in
  `syncedSnapshot`, `backupJSON`, restore bodies, the TV; listener only for editors and only while
  a screen is open; demotion detaches; denied stays local; typed names held in memory offline and
  sent on reconnect, never stored; a camper write is always `{name, ord}`); `people.test.js` (paste
  parsing; an existing name is updated, not duplicated; "Put people on teams" writes only changed
  leaves, per row; first-name candidates for a request; Link to a Director-role pending row needs
  the typed email; the name-collision warning; owner row; request approve = create-then-delete;
  Block writes `accessBlocked`; **a `<img onerror>` name and a 400-char note render as text**);
  `access-requests.test.js` (form write shape; prefilled display name; closed-asking message;
  polling bounded, `once()` only, no listener; the editor query is `limitToLast(25)` on `at`);
  `chat.senior.test.js` "Red" mention (capitalised "Red" and "red team" mention; "a red shirt"
  doesn't).
- **Verify live:** probes; a viewer account cannot read campers (device check + REST with a viewer
  token); with asking **off**, a test Google account's request is refused with the closed message;
  switched **on**, it asks, an editor's open app shows the bar within seconds, the editor approves,
  the requester's page opens by itself; switch asking off again.

#### S8 — New-year wizard (off-season only; enforced)
- **Ships:** §11.3 in full; §6.11 device reset and history filter; stranded download; hub complete
  (Restore point row, Camp week "last year's dates", `newYearDue()` front door); **Undo the
  new-year setup** (§7.3).
- **Tests (`wizard.test.js`):** the archive is verified before any clear (a fake-RTDB body read
  failure blocks step 4); the clear is **one** update with exactly the listed paths; any refused
  path changes nothing; **no `members/*` path is in that update**, and the follow-up per-member
  team clear skips the owner and lists a malformed row without blocking anything (sec-F4: a
  fake-RTDB member row missing `addedAt`); pending rows' teams cleared only when chosen;
  `pendingWritesTotal() > 0` or unconfirmed diffs block the commit; claim + take-over after 15
  min **of real idleness** (`at` refreshed by interaction); **answers survive a reload and are
  inherited by a take-over**; **step 3 twice (Back/Next, reload, failed read-back) reuses or
  re-mints the archive id, never fails on "already exists"**; **data changed after step 3 → a
  fresh archive before the clear**; `fromEpoch` is `'legacy'`, never `''`; resume after reload at
  each step; **Undo the new-year setup restores the archived data and epoch in one update (legacy
  epoch ⇒ `state/meta/epoch` deleted, 2026 bonuses doubled again, history unfiltered)**; a
  `newYearDue()` camp with a date already typed still offers the wizard first (ux-R4); a stale device with old-epoch results/config/setup edits
  gets none applied (stranded); device-local reset once per epoch, never for the legacy epoch; an
  old build receiving the cleared state adopts empties (existing missing-key behaviour); **a
  non-owner editor's claim and commit are refused (rules, emulator) and the controls are absent
  (app)**; Undo the new-year setup is owner-only; the clear update also carries the reveal nodes.
- **Verify live:** the owner runs the wizard for **both camps in one sitting**, checks the hub, then
  presses **Undo the new-year setup** and confirms everything came back (scores, epoch, history
  filter, 2026 bonuses doubled again), then runs it again for real. That is the rehearsal, with a
  guaranteed way back; there is no senior-first trial (Q2). Two precautions for the rehearsal run
  only, because Undo restores the archive and epoch but **not** member teams or campers (§7.3):
  tick "Counselors stay on their teams", and do it before anyone has typed real camper names.

#### S9 — Schedule-change alerts and the Worker (with Project 1 go-live)
- **Precondition:** Project 1 live (Worker deployed, `PUSH_SERVICE_URL` set, CSP updated, push
  rules published).
- **Ships (one Worker paste):** `notifySchedule` (§12.2), `schedSeen` cleanup in
  `cronMaintenance`, and `teamNamedIn` accepting a team's `short` from `state/teams` (any length ≥
  3, not "team") **under the capitalised-team-word rule of S7** (ux-R19) — the senior "Red" fix
  without turning every "red" into a ping. Client: the "Tell people" checkbox with the S5a
  defaults and reach wording, intent queue, baseline resets.
- **Tests:** `push-worker.test.js` (diff kinds; moved-pairing by key; window filter; per-device
  digest; per-id baseline; first-run baseline; rate slot; audit row; short-name mentions:
  "Red" and "red team" match, "a red shirt" and "feeling blue" don't);
  `tests/push-e2e/` (§12.2 scenarios).
- **Rollback:** re-paste the previous Worker; the client hides the checkbox on "unknown kind".

#### S10 — Tidy up
- Remove the replaced classic tabs (keep Notice and Data code paths now living under the hub),
  dead `pendingRemoteConfig` remnants and the session heuristic paths for camps that are on.
  CLAUDE.md final pass. F1 fence only per §8.6.

### 13.3 Housekeeping on every deploy (CLAUDE.md, updated)

- Bump every `?v=` together (**12 today → 13 with `camp-core.js` in T → 15 with `setup-sync.js` and
  `setup-ui.js` in S4**, and 18 in all once the redesign's `jelly-motion.js`, `reveal-core.js` and
  `reveal.js` join; `BUILD-PLAN.md` gives the count after each step), `APP_VERSION` and
  `CODE_UPDATED_AT`; `TV_BUILD` when the TV page changes;
  the current-standings and stalling `?v=` references (now including `defaults.js`, `camps.js`,
  `camp-core.js` and, from T, `current-standings.js`; the TV page's own CSP meta is updated with
  index.html's whenever a host is added).
- `node tests/run.js` and `node --check` on every changed file; the emulator suites for any rules
  change; `push-e2e` for any Worker change.
- `CHANGES` stays empty (no "What's new" banners).
- Rules: the repo file and the console change in the same commit (rules-only commit first).
- The live `curl` checks before calling a stage deployed.
- CLAUDE.md updated in the same commit. New sections: "Setup data (`setup` node)", "Config engine
  v2", "Restore points & archive", "Edit-here switches (A1/A3), who may press them (owner-only, Q8) and the camp-week freeze",
  "Team branding fields", "4-team bracket (`brackets4`)", "Schedule-change alerts"; updates to the
  file list, the `?v=` list, the harness `APP_FILES`, the `editorsHere` node (presence itself is
  unchanged), the walk-up switch and block list, the protected restore points, the rules list,
  the ancestor-validate probe result (§8.1) and the "path before its feature" policy (§8.6); the
  "two tabs of one camp" limitation is removed (S2c).

---------------------------------------------------------------------------------

## 14. Deferred Project-1 items: where each lands

| Item | Stage | Fix | Pinned by |
|---|---|---|---|
| **scoring#3** week-builder saves `set()` the whole config from a stale copy; no first-pull gate | S0h (gate + accounting; builder read-only until the first snapshot), **S3** (root fix) | Config engine v2: `configReady`; transactions applying id-keyed field ops to the server's current value; rebase on receipt (dropped ops surfaced); persisted `_cfgBase` (epoch follows the state engine) with three-way merge; field-diff game saves; deleted-meanwhile dialog; collision-free new game ids | `config-gate.test.js`, `config-sync.test.js` |
| **scoring#6** (saveGameDraft half) format change leaves bracket, draft, live | **S0b** | Clears result, bracket (either kind from S6b), draft, live, clock, picSetup after one confirm listing them | `settings-crud.test.js` |
| **rules#5** owner row offers controls the rules refuse | **S0c** (drawer), **S7** (People), **S8** (wizard) | `OWNER_MEMBER_KEY` treated like self; "Owner · managed in the Firebase console"; bulk member writes skip it and are per-row, best-effort, never inside a larger atomic update (a malformed row can't refuse the year clear) | rules test: constant == literal in both roots; `wizard.test.js` malformed row |
| **pages#3** TV listeners have no cancel callback | **T** | `state`/`config` cancel → overlay → reload in 5 s, capped at 3 reloads/hour; `setup/meta` cancel non-fatal; auth change after start reloads | `tv.test.js` |
| (found in review) TV page renders database emoji/crests raw into `innerHTML` with no CSP | **T** | shared `camp-core.js` sanitizers, DOM-built images, script moved out, CSP meta | `tv.test.js`, `camp-core.test.js` |
| **pages#5** TV counts orphaned results | **T** | `liveGameIdSet` filter; shared `camp-core.js` standings core | `tv.test.js`, `camp-core.test.js` parity fuzz |
| **pages#6** TV treats phone accounts as signed out | **T** | mirror `identityKey` (email key or E.164 phone) | `tv.test.js` |
| **Two tabs of one camp** erase each other's unconfirmed edits | **S2c** | Web Locks writer election (editors) decided **before** anything is persisted; one `persistState()` gate for all seven cache writes; demotion turns persistence off before flushing; read-only second tab, retry window, BroadcastChannel fallback | `tablock.test.js` |
| **Other `.danger-link` / danger text dark-mode contrast** | **S0d** | `--color-danger-text` wherever danger is text; light `#b42318` | token contrast test |
| **Senior "Red" short-name mention gap** | **S7** (client: `teamShort` in mentions; `short` in `state.teams` via A1/Teams) + **S9** (Worker accepts `short`) | short names become data the Worker already reads (`state/teams`); team words count only when capitalised or followed by "team", so ordinary "red"/"blue" don't ping | `chat.senior.test.js`, `push-worker.test.js` |
| (found) Tue/Thu duplicate and cross-camp `.ics` UIDs | S0e / S5a | index + camp (S0e); camp + week + day + block id (S5a) | `ics.test.js` |
| (found) Games shown under the wrong block or none (senior Afternoon, junior Team Skits) | S5a | explicit `blockId` (A2) | `games-blocks.test.js` |
| (found) Builder Back leaves a zombie dirty draft that freezes sync and auto-reload (B1) | S0a | confirm and clear | `settings-crud.test.js` |
| (found) `deleteGame`/`pruneOrphanedGameData` leak `clocks[gid]` | S0b | delete it too | `settings-crud.test.js` |
| (found) Backup omits notice/meta/clocks; import has no camp check (B9) | S4 | backup v3 | `backup.test.js` additions |
| (found) `normalizeSyncedState` resurrects 2026 names/counselors | S0g (gate), S8 (takes effect) | legacy epoch only | `wizard.test.js` |
| (found) Hard-coded July-2026 double window, banner copy, Friday finale | T / S5a / S8 | `camp-core.js` pin; `setup/meta.double`/`finaleDow`; generated copy | `camp-core.test.js`, `seed.test.js` |
| (found) Classic "Add team" mints `t-<ts>` ids the rules/`isTeamId` reject | S0j | fixed counts; no add/delete | `settings-crud.test.js` |

---------------------------------------------------------------------------------

## 15. Test plan, consolidated

**Harness additions:** `tests/fake-rtdb.js` (S0i); `tests/fixtures/legacy-builder-v183.js` (S0i);
`makeContext({camp, seeded})` (S5a) pre-loading `buildSeed(CAMP)` with all sections on, so every
existing `week`, `push` and `chat` test also runs on seeded data; `APP_FILES` grows (S4).

| Stage | New test files |
|---|---|
| S0 | `settings-crud.test.js`, `config-gate.test.js`, `owner-row.test.js` (or a rules.test addition), `ics.test.js` (UID part), `spelling.test.js` (S0k) |
| T | `tv.test.js`, `camp-core.test.js` |
| S1 | `accessors.test.js`, `accessors.senior.test.js`, `seam.test.js` |
| S2 | `sync-quarantine.test.js`, `teams-sync.test.js`, `tablock.test.js`, `sync-epoch.test.js` |
| S3 | `config-sync.test.js`, `undo.test.js` |
| S4 | `setup-sync.test.js`, `restore.test.js`, `editors-here.test.js`, `checklist.test.js`, `owner-only.test.js` |
| S5a | `seed.test.js`, `seed.senior.test.js`, `schedule-edit.test.js`, `games-blocks.test.js`, `ics.test.js` (week), push additions, seeded re-runs |
| S5b | `sections.test.js` (fill-evenly, electives identity, meal tag, verse video) |
| S6a | `games-screen.test.js` |
| S6b | `bracket.test.js` (pin first), `bracket.senior.test.js` |
| S7 | `palette.test.js`, `teams-screen.test.js`, `campers.test.js`, `people.test.js`, `access-requests.test.js` |
| S8 | `wizard.test.js` |
| S9 | `push-worker.test.js` additions, `push-e2e` scenarios |

**Cross-cutting assertions:** no code path writes `game.day`; no `setItem` ever contains a camper
name; no `setItem(STORAGE_KEY` outside `persistState()`; `seam.test.js`; the frozen seed-id
fixtures; `pushBlockKey(label) === alertKey` for every seeded block in both camps; every place that
renders a database string into markup goes through `esc()` or a `camp-core.js` sanitizer (a grep
test over app.js, setup-ui.js, chat.js and current-standings.js for `innerHTML` built from
`teamEmoji(`, `.name`, `.note` or a crest without a sanitizer).

**Changed on purpose** (each named in its stage's commit message): `sync.test.js:344` (S2b),
`sync.test.js:355-372` and `sync-merge.test.js:132-147` (S3), `week.senior.test.js:105-115`
(S6b), `rules.test.js` gated list / `:128` / `:164` / `:294` (R1), `chat.test.js` team-word
mention cases (S7, capitalised-team-word rule), `tests/fixtures-junior-week.json` and the sample names in `chat.test.js` / `auth.test.js` (S0k, the three spellings).

**Never changed:** `tests/camps.test.js`; `tests/fixtures-junior-week.json` after S0k.

**Emulator** (opt-in, npm + Java): §8.8 suites (including `owner-only.mjs` and the redesign's reveal suite), **a gate for R1**; re-run for any later rules
change.

**Playwright pass per stage that touches UI:** before/after screenshots at fixed `?now=` values
(banner, schedule sheet, follow card, verse, cleanup, electives) for both camps; the hub at 390 px
and laptop width; light and dark themes; the seven moments (§2.3) as scripted flows.

**Manual live checks:** per stage in §13.2. The two-laptop concurrency check and the
airplane-mode reload check are mandatory for S2b, S3 and S5a.

---------------------------------------------------------------------------------

## 16. Risks

| # | Risk (K = risk, to avoid confusion with the rules step R1) | Likelihood / impact | Mitigation |
|---|---|---|---|
| K1 | A client ships ahead of R1 and a refused write wedges score sync | low / high | S2a quarantine ships first; R1 before any code that needs it; every new listener degrades itself (§8.5) |
| K2 | The setup engine diverges from the state engine's hard-won rules | med / high | A deliberate clone reusing the same pure helpers; every `sync-offline`/`sync-merge` scenario ported before S4 ships; the §6.12 table is a review checklist; both camps switch together after the seeded-fidelity tests and the emulator run (no senior-first trial, Q2) |
| K3 | Config transaction subtleties (contention on a 17 KB node; an old build's `set()` mid-transaction) | med / med | `applyLocally:false`; abort on `null`; ops idempotent; fake-RTDB contention tests; the old-build window closes on reload |
| K4 | A consumer missed in the accessor conversion keeps reading a constant and diverges after edits | med / low–med | §9.2 is an exhaustive list; `seam.test.js` fails on any direct read outside the SEAM block |
| K5 | Junior regresses at A1 | low / high | seed identity + 10,080-minute banner fuzz in both camps; frozen id fixtures; A1 off-season; Use the original week again in one tap; a restore point per camp; the owner presses it for both camps in one sitting (Q2) |
| K6 | Old builds keep whole-`set()`-ing config until they reload, clobbering S3 users' edits | low / med | off-season rollout; auto-reload; Devices list; (no fence needed) |
| K7 | Camper names leak (cache, backup, restore, archive, TV, push, screenshot) | low / **high (minors' PII)** | editor-only rules at a dedicated node; memory only; excluded everywhere (P12); `setItem` scan test; rules test forbids any other `camper` node; screenshots are a human matter: the screen's privacy line says so |
| K8 | Walk-up requests as a spam surface, or a way to burn the shared download quota (both camps share one database) | low / **high** if open (sec-F1) | closed unless a director switches asking on; verified identity; one ≤ 300 B row per identity per camp; a 60 s throttle that leaf writes and delete-and-recreate can't bypass (emulator-proven); a block list; refused once a member; editors delete; editors listen only to the newest 25 rows; no listener for requesters; stranger text always escaped |
| K9 | The new-year commit half-applies, hits the wrong camp, or can't be undone | low / high | one atomic root update (year data only; member teams afterwards, per row) after a verified, freshness-checked archive; the archive is undeletable by rules; camp name on the hold button; owner-only in the app and in the rules (Q8); the claim lock; off-season enforced; **Undo the new-year setup** restores data and epoch together |
| K10 | A stale phone brings last year's unsent scores into the new year | low / med | epoch check in all three engines (stranded, downloadable); old builds' 36 h confirm |
| K11 | "Just Tuesday" vs "Every day like Tuesday" confuses a director | med / med | two equal buttons with the day list; tags on rows; Undo; restore points; an owner walkthrough before S5a ships |
| K12 | Live remote edits fight focus in the builder | med / med | keyed row reconciler that never replaces the focused row; focused-field hold; render deferral |
| K13 | Two editors' alert choices interfere | low / low | per-block "last told" baseline (§12.2) |
| K14 | The Worker paste and rules PUT depend on the owner | high / low | everything degrades with a clear message until done; one PUT, one paste; Appendix E script |
| K15 | Spark budget (config transactions, photos, restore points, a looping TV, cache misses) | low / med | §5.12 numbers incl. the no-cache worst case; photos ≤ 100,000 chars and fetched only when rendered; no listeners on restore/photo nodes; IndexedDB + memory cache; TV reloads capped at 3/hour |
| K16 | A Web Locks race leaves a single tab read-only | low / med | 1.5 s retry; fail open; editors only; reload-ordering test |
| K17 | Rolling back S5a code after junior has been edited shows the built-in schedule | low / med | prefer Use the original week again or fix-forward; restore points keep the edited data |
| K18 | iOS storage eviction loses `setupBase`/`_cfgBase` | low / low | same as `_syncBase`: no base ⇒ plain adopt; unsent edits since the last open are lost (documented, same as scores) |
| K19 | Rules typo in the large `setup` block refuses a legitimate write | med / med | emulator suites with seeded trees for both camps before R1; quarantine names the path; the runbook's read-back diff and discriminating check |
| K20 | Scope: 17 deploy stages here, 25 with the redesign's D0–D7 (`BUILD-PLAN.md`) | med / med | each stage independently valuable and revertible; S0–S3 pay off even if later stages slip; features gated by activation |
| K21 | Database text becomes markup on a page without a CSP (the TV) | low / high | shared sanitizers in `camp-core.js` (P14); DOM-built images; TV CSP and no inline script; leaf rules on team fields; grep test (§15) |
| K22 | The combined rules file exceeds the published size limit | low / low | size check before R1; an oversized PUT is refused and leaves the old rules live; split into R1a/R1b (§8.6) |
| K23 | The owner is the only person who can start the new year or switch a camp's editing on (Q8) | low / med | Both are off-season acts (A1 once ever, the wizard once a year); nothing in a camp week needs them; the owner key is already the permanent console break-glass, and the console can write the same fields (CLAUDE.md records how); if the owner is unreachable the camp runs on whatever is already switched on. Another director can't be made owner from the app, by design |


---------------------------------------------------------------------------------

## 17. Decisions for the owner

All thirteen questions that only the owner could answer were answered on **2026-10-27**; §17.1
is now the record. §17.2 lists the defaults that were applied without asking. Each question
keeps its reference tag (Q1…Q27) because the rest of this spec refers to them, and §1.4 says
what each answer changed.

### 17.1 The owner's answers (2026-10-27)

| Tag | Question | Answer | Was it the recommendation? | Landed in |
|---|---|---|---|---|
| Q1 | Will any camp week, junior or senior, run before June 2027? | **No: nothing before June** (the 2027 dates are wanted when known) | yes | P8, §13.1 |
| Q2 | Try everything on senior camp first, as a practice run, before junior? | **Both camps at the same time** | **no** (recommended: senior first) | summary, §1.4, §10.1, §13, K2, K5 |
| Q22 | When a new camp year starts, does every counselor come off their team? | **Yes, take everyone off their team** (everyone keeps their sign-in) | yes | §11.3 step 2, §11.8 |
| Q7 | Camper first names wiped every new year, and only ever shown to directors? | **Yes** | yes | §5.9, §7.3, §11.9, P12 |
| Q6 | May someone who isn't on the list tap "Ask to join" (only while a director has switched asking on)? | **Yes, and let them in as a Counselor unless the director picks Director** | yes | §11.8, §11.18 |
| Q8 | Who may start the new-year setup, or switch a camp between "edited here" and "the original week"? | **Only the owner** | **no** (recommended: any director) | §1.4, P1, §5.2–5.3, §6.6, §7.2–7.3, §8, §10.1, §11.2–11.3, S4/S5a/S8, K23, Appendices B–C |
| Q23 | When a director goes back to a restore point, may it bring back scores too? | **Only if they tick "Also restore scores"** (unticked unless they choose it) | yes | §7.2 |
| Q10 | Which senior games are played as a 4-team bracket? | **The Legacy Game each day** | yes | §11.14, §11.15, S6b |
| Q12 | In the 4-team bracket, is the 3rd-place match played before the final? | **Yes: 3rd place first, final last** | yes | §5.7.4, §11.15 |
| Q11 | Senior's arrival day (Sunday) and send-off day (Saturday) only have sample schedules. How should the real ones get in? | **Keep the sample days for now** | **no** (recommended: directors type them in, the checklist reminds them) | §10.2, Appendix B |
| Q18 | Double points next year? | **The same as 2026: Thursday 5 PM until the end of Friday** | yes | §5.7.3, §10.6, §11.3 step 1 |
| Q25 | Which day does the TV page play the champion celebration? | **Friday** | yes | §12.3, `finaleDow` |
| Q21 | Are Sofie and Sofia, Lilly and Lily, and Alysa and Alyssa the same people? | **Yes, merge them: Sofia, Lily, Alyssa** | **no** (recommended: not sure, directors link them) | S0k, §3, §5.2, §10.5, §11.8, §11.13, Appendix D |

### 17.2 Defaults already applied (say if you want any of them different)

- **(Q3) Phone alerts go live after the editable schedule is built.** It's the simplest order,
  and nothing old can put the original schedule back for reminders. *(Alternatives: before; not
  planning alerts yet.)*
- **(Q4) You run the one database-rules update yourself, as three copy-pastes in Cloud Shell**,
  early in the build. *(Alternatives: one update per feature; someone else runs it.)*
- **(Q5) When a director changes today's or tomorrow's schedule, a "Tell people" box appears.**
  It starts ticked only for a time change or a skipped item on a specific day, and unticked for
  renames and for changes to the typical day. *(Alternatives: always alert; never alert.)*
- **(Q9) The 4-team bracket ships in its planned slot (S6b)**, not early: no camp runs before
  June 2027, so senior doesn't need it sooner. *(Alternative: ship it right after the rules
  update, ahead of the setup screens.)*
- **(Q13) Two teams may have the same colour; the checklist warns.** *(Alternative: never
  allowed.)*
- **(Q14) Team colours come from a 12-colour palette that reads well in light and dark mode**;
  last year's colours stay until someone changes them. *(Alternative: any colour, with a
  warning.)*
- **(Q15) A new "Ask to join" request shows in directors' open apps (a pop-up and a bar) and as a
  badge, but doesn't buzz phones.** *(Alternative: a phone alert to directors.)*
- **(Q16) Last year's archive doesn't include the chat.** Chat stays where it is. *(Alternative:
  include it.)*
- **(Q17) An uploaded team photo replaces junior's built-in team shield.** *(Alternative: the
  built-in shields always win.)*
- **(Q19) This project doesn't change the home screen for dates or name games inside "Happening
  Now"** — both belong to the redesign's Now tab (`app-shell-redesign-spec.md` §3: "Camp starts
  Sunday, …" before the camp week, and the block's games listed on the card). *(Alternative: add
  them now.)*
- **(Q20) A downloadable whole-week calendar file is enough**, with a note that it doesn't update
  itself. *(Alternative: a live calendar subscription, which needs extra work on the alert
  sender.)*
- **(Q24) On a laptop, a second tab of the same camp shows the camp but can't change anything,
  with a "Use this tab instead" button.** *(Alternative: no such protection.)*
- **(Q26) Schedule-change alerts still reach people who muted "director alerts"**, because they
  chose to follow those schedule items. *(Alternative: the mute silences them too.)*
- **(Q27) If an old phone ever puts the original schedule back for reminders, we add a database
  rule against old versions — only if it actually happens.** *(Alternative: never.)*

---------------------------------------------------------------------------------

## Appendix A — Team colour palette (measured)

Each swatch has a **light** value (text and fills on light surfaces; white text on it) and a
**dark** value (text on dark surfaces; dark `#181b1d` text on it). Contrast computed with the WCAG
formula against the app's tokens: light surface `#ffffff`, light background `#f4f6f9`, dark
surface `#1a2030`, dark background `#10141c`. Every value clears 4.5:1 in its theme (most clear
5:1). `palette.test.js` recomputes them.

| id | light | on white | on light bg | dark | on dark surface | on dark bg | dark text on it |
|---|---|---|---|---|---|---|---|
| red | `#b42318` | 6.57 | 6.07 | `#ff8a80` | 7.11 | 8.08 | 7.58 |
| pumpkin | `#b54708` | 5.43 | 5.01 | `#ffab5e` | 8.69 | 9.87 | 9.26 |
| gold | `#8a6100` | 5.54 | 5.12 | `#f2c24b` | 9.74 | 11.06 | 10.38 |
| green | `#2f7d32` | 5.12 | 4.73 | `#7fd88a` | 9.35 | 10.62 | 9.97 |
| forest | `#1f5e3a` | 7.72 | 7.13 | `#8ee0b0` | 10.39 | 11.80 | 11.08 |
| teal | `#0b7570` | 5.54 | 5.11 | `#5fd6cf` | 9.28 | 10.54 | 9.90 |
| blue | `#1f5fb8` | 6.20 | 5.73 | `#86b6ff` | 7.85 | 8.91 | 8.36 |
| indigo | `#4338ca` | 7.90 | 7.30 | `#aab4ff` | 8.26 | 9.38 | 8.80 |
| purple | `#7b3fb5` | 6.52 | 6.02 | `#cfa8ff` | 8.27 | 9.39 | 8.82 |
| berry | `#b0306a` | 6.04 | 5.58 | `#ff93c3` | 7.90 | 8.97 | 8.42 |
| brown | `#7a4a22` | 7.42 | 6.85 | `#dfae82` | 8.13 | 9.23 | 8.67 |
| slate | `#4b5563` | 7.56 | 6.98 | `#c3c9d6` | 9.78 | 11.10 | 10.42 |

**CSS:** `teamAccentVars(id)` emits `--team-accent-l:<light>;--team-accent-d:<dark>`. styles.css
sets `--team-accent: var(--team-accent-l)` on team surfaces and `var(--team-accent-d)` under
`body.dark-theme` and `@media (prefers-color-scheme: dark) body:not(.light-theme):not(.dark-theme)`.
Existing `--team-accent` consumers are unchanged. White text on the light value, `#181b1d` on the
dark value. The TV page (always light) uses the light value. A legacy hex (no `color` yet) is
emitted for both; the hub flags it when it fails a theme (today: junior `#345b96` 2.38:1 on the
dark surface; senior Red 2.99:1 on dark).

## Appendix B — Checklist status rules (`hubStatus(section, view)`)

Returns `{mark: 'ok'|'warn'|'todo'|'skip'|'info', summary, problems: [string]}`: `skip` if
`meta.skip[section]`; `warn` if any problem; `todo` for an optional section with nothing in it;
else `ok`. One unit test per problem sentence.

**Owner-only fixes (Q8).** Wherever a row's fix is **Edit the week here**, **Start the new-year
setup**, **Use the original week again** or **Undo the new-year setup**, only the owner sees the
button; everyone else sees the same problem sentence with the owner's name in place of the button.

| Section | Problems (each a plain sentence linking to its fix) | Summary when ok |
|---|---|---|
| Camp week | **`newYearDue()`** ("This camp still has 2026's scores — start the new-year setup", linking to the wizard, never to a bare date input; ux-R4); no `weekStart` on a camp with no scores ("Pick the Sunday camp starts"); not a Sunday | "Sun Jul 18 – Sat Jul 24" |
| Schedule | not turned on ("Using the original schedule" + **Edit the week here** for the owner, "Patrick turns on editing" for everyone else); turned off with edits kept ("Showing the original — your edits are kept"); (info) labels naming last year's staff after a wizard run ("4 items name people — review them"); typical day empty; a day used by camp has no items ("Saturday is empty"); (info, never a warning, Q11) a `placeholder` day ("Arrival and send-off days still use the sample schedule"); an item with `end ≤ start`; an overlap not marked `overlapOk` ("2 items overlap on Tuesday at 9:15 PM"); a Breakfast/Lunch/Supper-looking label without the Meal tag; a broken item ("1 broken item on Tuesday — Fix / Remove"); rules not published | "Typical day · Mon–Fri · 3 one-offs" |
| Games | games not on the schedule (list + picker); a dangling `blockId`; a late bracket tap after a result was saved (**Discard**); a 4-team bracket waiting for a re-check; a Games item on a competition day with no games; a tournament whose team count has no bracket kind; more than one drawing game; location "TBA" (senior seed) | "22 games on 10 items" |
| Teams | wrong count or an id not `tN` ("Ask Patrick to repair team slots"); missing name / short name / emoji ("Foxes has no short name"); two teams share a colour ("Two teams are Blue"). **Info, not a warning:** a legacy colour that fails a theme ("Turkey Dinner's colour is hard to read in dark mode — **Pick colours for flagged teams**"; ux-R13) | "6 teams" |
| People | requests waiting ("🙋 2 asking to join"); a team with no counselor **accounts** — typed fallback text doesn't count ("Foxes has no counselors yet — **Put people on teams**"; ux-R9); pending rows ("3 people have no sign-in yet", info after 7 days); a member row missing `role`/`addedBy`/`addedAt` ("Sam's sign-in record is incomplete"); (info) asking to join switched on for more than 7 days | "18 counselors · 4 directors" |
| Campers (editors) | a team with no campers (once any camper exists) | "64 campers" (`todo` when none at all) |
| Meals | Meal-tagged items without a dish | "Mon–Fri" (`todo` when the camp lists no dishes at all) |
| Memory verses | no theme; a competition day without a verse; placeholder text remaining | "Theme + 5 days" |
| Cleanup rota | a competition-day meal with no team; an unknown team id | "Each team cleans 2–3 times" (balance is info) |
| Electives (junior) | an Elective item whose slot has no stations; a station with nobody; a person in two stations in one slot; a name-only person who nearly matches a member | "3 slots · 6 stations" |
| Phone alerts (only when push is live) | published `src` ≠ local hash for > 2 min ("Out of date — Publish now"); `weekStart` differs; a rev-less republish by an older version | "Schedule sent to phones" (`skip` while push isn't set up) |
| Double points (in Camp week) | (wizard epoch) window missing and not explicitly "none"; window outside the camp week | "Thu 5 PM – end of Fri" |
| Notice board | — | `info`: Draft / Posted |
| Restore points | `warn` when the restore nodes are denied (rules not published) | `info`: newest point's age |
| Devices | — | `info`: "2 director devices on an older version" |

## Appendix C — UI copy glossary

| Code | On screen |
|---|---|
| block | "item" ("Add an item", "This item is a meal") |
| typical day / `typical: true` | "Typical day" / "follows the typical day" |
| scope buttons | **[Just Tuesday]** / **[Every day like Tuesday]**, with a caption naming the days that change (never "every typical day"; ux-R14) |
| patch | "Changed for Tue"; undone with **Back to the usual** |
| one-off (`dayBlocks` on a typical day) | "Tue only" |
| `off: true` | "Skipped on Tuesday" / **Skip today** (rain plan) / **Skip just Tuesday** (day view) — always undone with **Bring back** |
| own day (`typical: false`) | "has its own schedule"; **Give Friday its own schedule** / **Make Friday follow the typical day again** |
| removing all of a day's patches and one-offs | **Clear all of Tuesday's changes** |
| `end: 1440` | **Until the end of the day** |
| `alertKey` | "Phone reminders follow …" |
| viewer / editor | Counselor / Director |
| pending member | "no sign-in yet" |
| access request | "asking to join"; `joinOpen` = **Let people ask to join**; `accessBlocked` = **Block** |
| restore point | "restore point" (automatic ones: "Before Jenn's edits, 3:05 PM"); pinned = "kept" |
| archive | "Past years"; the epoch rollback = **Undo the new-year setup** |
| epoch | "this camp week" / "2027" |
| `messtival` | "Double points" |
| `meta.on.<section>` true / false | "edited here" / "the original (the copy that came with the app)" — never "shared setup" or "built-in copy" on screen (ux-R7) |
| A1 / its undo / re-seed | **Edit the week here** / **Use the original week again** ("your changes are kept") / **Start this section again from the original** (all owner only) |
| A3 | **Start the new-year setup** (owner only) |
| quarantine | "couldn't be saved" |
| `tabReadOnly` | "this tab is view-only" |
| `editorsHere` | "Jenn is also here" |
| an owner-only act, seen by another director | The same sentence with the owner's name and no button: "Patrick turns on editing." / "Patrick starts the new-year setup." (`ownerName()`; "the owner" until the directory loads) |

## Appendix D — Change list by file

| File | Stages | Change |
|---|---|---|
| `app.js` | S0–S8 | `OWNER_MEMBER_KEY`, `isOwner()` / `ownerName()` (S4); `canonicalCounselorName()` consumers in `missingSeedCounselors`, `adoptMemberTeam`, `myStationFor` (S0k); config first-pull gate and `pendingWritesTotal()`; legacy roster gate; unknown-bracket guard; SEAM accessor block; pure helpers `treeDiff`/`applyOpsSafe`/`fnv1a`; `pushState` quarantine; teams per field; Web Locks writer; epoch check; config engine v2 (replaces `pushConfig`/`applyRemoteConfig` internals; `configReady`, `pendingConfigWrites`, `_cfgBase`); undo core; `editorsHere` writes (editors only); one `persistState()` gate for the seven cache writes; quarantine ordering + persistence; `brackets4` key and 4-team flow (stored participants, `recheck`) + extracted 6-team helpers; random-tail game ids; `buildWeekIcs`; `clearLocalData` list gains the new keys; `idleRetryTick` setup branch |
| `settings.js` | S0, S3, S6a | B1; scoring#6; clocks leak; no add/delete team; field-diff game saves and resolve-by-id handlers; Games screen by schedule item and "When" picker; classic tabs retired in S10 |
| `camp-core.js` (new) | T | double-window constants and maths, `etWallToEpoch`, `liveGameIdSet`, `computeStandingsCore`, **the shared sanitizers** (`safeEmoji`, `safeShort`, `safeColorVars`, `safeCrestSrc`, `safeVideoUrl`) |
| `setup-sync.js` (new) | S4+ | setup engine, `normalizeSetup`, `resolveDay`/`legacyBlock`/`renderLabel`, `buildSeed`, A1/A2, restore points, publisher hash, schedule-alert id tracking |
| `setup-ui.js` (new) | S4+ | hub, wizard, Camp week, Schedule, rain plan, Teams, People (incl. Put people on teams, asking switch, block list), Campers, Meals, Verses, Cleanup, Electives, Backups; `askDialog`; hold-to-confirm; "also here" chips; sync line; undo pill |
| `camps.js` | S0k, T, S7 | `CAMP_FORCE` one-liner in `activeCampId()`; `TEAM_PALETTE`; `gameBlockOverrides: {}` per profile; `COUNSELOR_NAME_ALIASES` and `canonicalCounselorName()`. **No existing constant changes except the three counselor spellings (S0k, Q21).** |
| `chat.js` | S1, S7 | mention dictionary via `teamShort`/`staffNames`; capitalised-team-word rule |
| `push.js` | S1, S5a, S9 | `scheduleWeek()`; publisher from `planForDow` with `rev`/`src` (transaction); drawer week line read-only; `/notify` schedule calls and the offline intent |
| `push-worker/worker.js` | S9 | `notifySchedule`; `schedSeen` cleanup; `teamNamedIn` accepts `short` under the capitalised-team-word rule |
| `sw.js` | — | unchanged (digests reuse kind `block`) |
| `current-standings.html` + `current-standings.js` (new) | T, S5a | `?camp=`/`CAMP_FORCE`, shared scripts, script moved out of the page + CSP meta, sanitized DOM rendering, pages#3/#5/#6 with the reload cap, null-safe crests, N-team loops, `setup/meta` (non-fatal cancel), finale day; `TV_BUILD` |
| `stalling.html` | T | camp-aware link; team-count copy |
| `index.html` | T, S4, S7 | `camp-core.js`, `setup-sync.js`, `setup-ui.js` tags (15 `?v=` assets); denied-screen "Ask to join" markup |
| `styles.css` | S0, S4, S7 | danger text token; builder layout, sheets, hub, dialogs; `--team-accent-l/-d` theme switch |
| `database.rules.json` | R1 | §8.2, §8.3 (owner-only clauses included) and the reveal blocks (`app-shell-redesign-spec.md` §4.4) |
| (no new tool file) | R1 | the Appendix E blocks are pasted by the owner; nothing executable is fetched from the site (sec-F5) |
| `tests/*` | every stage | §15 |
| `CLAUDE.md` | every stage | §13.3 |

## Appendix E — Rules publish runbook (pasted, not fetched)

Rewritten in review (sec-F5). The draft had the owner download and run a script from the public
site with an OAuth token in hand, compare the live rules against a rules file that could be a
10-minute-stale CDN copy (so "RULES MATCH" could pass without R1 being live), and rely on
unauthenticated probes that say `Permission denied` under the old and new rules alike. Now:

- **Nothing executable is fetched.** The owner pastes the blocks below (they also come in chat
  with the rules commit, together with the file's 8-character `sha256` prefix).
- **The rules file is verified before use**: fetched with a cache-buster and checked against the
  hash in the commit message; a mismatch stops everything ("the site hasn't updated yet — wait
  10 minutes and paste block 1 again").
- **A check only the new rules pass** is run in the browser afterwards (block 4).

**Block 1 — back up and fetch** (Google Cloud Shell, already signed in to gcloud):
```
DB=https://camp-89cea-default-rtdb.firebaseio.com
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" "$DB/.settings/rules.json" > rules-backup-$(date +%F-%H%M).json && ls -l rules-backup-*.json
curl -s -o rules.json "https://camp.patricksimpson.info/database.rules.json?cb=$(date +%s)"
sha256sum rules.json | cut -c1-8      # must equal the 8 characters given with the rules commit
```
**Block 2 — publish** (only if the 8 characters matched; set `EXPECT` to them):
```
EXPECT=xxxxxxxx
[ "$(sha256sum rules.json | cut -c1-8)" = "$EXPECT" ] && \
  curl -s -X PUT -H "Authorization: Bearer $TOKEN" --data-binary @rules.json "$DB/.settings/rules.json"
```
(A refusal — including "too large", §8.6 — leaves the old rules live; nothing breaks.)

**Block 3 — read back and unauthenticated probes:**
```
curl -s -H "Authorization: Bearer $TOKEN" "$DB/.settings/rules.json" | diff -q - rules.json && echo "RULES MATCH"
for r in campScoreboard seniorScoreboard; do
  for p in state config members setup setup/meta campers campers/t0 teamPhotos accessRequests accessBlocked editorsHere restoreIndex restoreBody; do
    printf '%s/%s: ' "$r" "$p"; curl -s "$DB/$r/$p.json"; echo; done
  printf '%s PUT accessRequests: ' "$r"; curl -s -X PUT -d '{"name":"x","at":1}' "$DB/$r/accessRequests/x@y,com.json"; echo
  printf '%s PUT setup: ' "$r"; curl -s -X PUT -d 'true' "$DB/$r/setup/meta/on/schedule.json"; echo
  printf '%s revealFull: ' "$r"; curl -s "$DB/$r/revealFull.json"; echo
  printf '%s PUT revealPublic: ' "$r"; curl -s -X PUT -d '{"ctl":{"v":1}}' "$DB/$r/revealPublic/real.json"; echo
  printf '%s revealPublic (must say null): ' "$r"; curl -s "$DB/$r/revealPublic.json"; echo
done
```
Every probe line must say `Permission denied`, except the `revealPublic` read, which must say
`null`: it is the one deliberately public path (the big screen's feed), and under the old rules it
says `Permission denied`, so that line alone proves the new rules are live. If the read-back differs
or any other probe answers anything else: restore with block 2 using the backup file in place of
`rules.json`.

**Block 4 — the discriminating check (browser, on camp.patricksimpson.info, console):**
```js
const db = firebase.database();
for (const r of ['campScoreboard', 'seniorScoreboard'])
  for (const p of ['setup/meta', 'campers'])
    db.ref(r + '/' + p).once('value').then(
      () => console.log(r, p, 'ALLOWED'), (e) => console.log(r, p, 'DENIED', e.code));
```
Signed in as **you** (an editor): all four lines `ALLOWED` — under the old rules they are all
`DENIED`, so this is the proof R1 is live. Signed in as **a test counselor**: `setup/meta`
`ALLOWED`, `campers` `DENIED`. Signed in as **another director (not the owner)**: the four reads
`ALLOWED` as for you, and `db.ref('campScoreboard/setup/meta/on/schedule').set(false)` must come back
`DENIED` (decision Q8; if you run it as yourself it is allowed, so `.remove()` it straight away).
Signed in as **a non-member test account**: all `DENIED`. Record
the results in CLAUDE.md's R1 checklist (§8.9).

**Order within a stage:** (1) a rules-only commit (`database.rules.json`, `tests/rules.test.js`,
emulator suites; no `?v=` bump; the browser never loads the rules file; the commit message states
the 8-character hash) → push → blocks 1–4; (2) then the code commit. If the order is ever
reversed, nothing breaks (§8.5): the new client degrades to "not available yet" messages until the
rules are live.

---------------------------------------------------------------------------------

## Review log

Three adversarial reviews of this spec (2026-10-27): **sync** (sync engine and multi-editor
correctness, findings `sync-F1…F19`), **sec** (rules, privacy and quota, emulator-tested,
`sec-F1…F10`) and **ux** (director experience, `ux-R1…R19`). Each finding's factual claims were
checked against the code at `63005d9` where they made one (settings.js `makeId`/`taken`/
`pruneOrphanedGameData`, app.js's seven `setItem(STORAGE_KEY` sites, the boot role hint and
`reloadBlocked`, current-standings.html's raw `innerHTML` and missing CSP, camps.js's 24:00 ends
and the Wednesday block order, the members/push-prefs rules, worker.js's `MIN_TEAM_WORD_CHARS`);
all checked claims held. **48 findings: 48 accepted, 0 rejected outright; 6 accepted with part of
the proposed fix replaced by a different one (marked "modified", reason given).**

| Id | Decision | Reason (and where it's fixed) |
|---|---|---|
| sync-F1 | Accept | A whole-`setup` transaction re-validates every stored stamp, so `=== now`/`SELF` rules refuse A1 once anything was edited. Took the reviewer's second fix: stamps use `NOWKEEP`/`SELFKEEP` (an unchanged value passes), and `mergeSeed` carries `meta/edited` and `meta/wizard` untouched; a separate claim node was not used because it opens a window where `on` is true with no data. §8.1, §8.2, §10.1, §6.6, emulator + seed tests. |
| sync-F2 | Accept | Off-then-on re-seeded and A2 re-attached every game. `on` now has three states (absent / `false` / `true`): re-enabling only flips the flag; re-seeding is a separate, restore-pointed action; A2 touches only unattached or dangling games. §5.3, §10.1, §10.3, §10.4. |
| sync-F3 | Accept | A bare focus-and-blur wrote a stale value over a colleague's change. The focus-time value is recorded; an unchanged field never writes on blur. §6.4.9, §11.10. |
| sync-F4 | Accept | The rain draft had no per-field base. It now stores each staged field's base, Done is a three-way compare with a clash line, the draft is re-resolved on open, dropped on epoch change, asks after 12 h, and blocks reload only while touched in the last 2 min. §11.6, §5.11, §6.5, §6.6, §6.11. |
| sync-F5 | Accept | The anchor field itself had no existence check, so a `{start,end}` move recreated half a deleted block (and a camper rename resurrected a moved camper). Every block field now requires `start` **and** `label`; campers require `name` **and** `ord`; record-level `hasChildren` added; the §6.6 claim corrected. §8.1, §8.2, §11.9, §8.8. |
| sync-F6 | Accept | Verified: five `.parent()` calls from the `teams` node reach `<root>`, refusing every team patch including junior's seed. The patch `teams` rule is the four-parent `PANCHOR`. §8.1, §8.2, §8.8, §8.10. |
| sync-F7 | Accept | Restoring the archive kept the new epoch, so 2026 bonuses were scored against the 2027 window. Added **Undo the new-year setup**: archived data and archived epoch (deleted for legacy) in one atomic update; S8's rollback now uses it. §7.3, §7.2, §11.2, §11.16, §13.1. |
| sync-F8 | Accept | Verified `pruneOrphanedGameData` deletes results for any game missing from config. A Games-only restore now keeps every game with scores and never prunes unless Scores is ticked (with hold-to-confirm); restores first require no pending work and re-read the server. §7.2, S4 tests. |
| sync-F9 | Accept (modified) | Accepted: store `a`/`b` on `third`/`final`, refuse medals from an inconsistent chain (new `recheck` phase with two resolve buttons), ignore late taps after a saved result. Replaced: the per-match transaction — RTDB transactions don't survive a reload or force-quit, which the bad-Wi-Fi requirement needs; the consistency check makes the cross-device race harmless instead. M5 reworded. §5.7.4, §11.15, §6.6, §2.3, S6b tests. |
| sync-F10 | Accept | Synthetic undo entries were reversed. Now `before` = mine, `after` = server's, so the normal undo rule restores mine. §7.1, `undo.test.js`. |
| sync-F11 | Accept | The wizard doesn't write config, so `_cfgBaseEpoch` never learned the new epoch and later offline game edits were stranded. The config base epoch now follows the state engine's epoch adopt (stranding only genuinely old-year ops). §6.3.4. |
| sync-F12 | Accept | Both adopt paths ignored `dropped`. Dropped ops from later snapshots and from the first-snapshot merge go to the persisted "Put it back / Discard" list. §6.3.4, §6.4.4, §6.4.5. |
| sync-F13 | Accept | Verified `makeId` is deterministic and `taken` = config ids + results keys. New game ids get a random 4-char tail; `taken` includes `brackets`, `brackets4`, `drafts`, `picSetup`, `live`, `clocks`; delete and prune clear `brackets4`. §5.5, §11.14, S6a. |
| sync-F14 | Accept | Between S0h and S3 there's no merge, so a pre-snapshot builder edit would be silently replaced. S0h keeps the game/day builder read-only until `configReady`; S3 lifts it. §6.3.3, §13.2 S0h, §14. |
| sync-F15 | Accept | A bisect retry could land an older live score after a newer one. New pushes are held during a bisect, each retried path is re-read and skipped if changed, and the quarantine is persisted with `STORAGE_KEY`. §6.2, §5.11, §6.5. |
| sync-F16 | Accept | (a) Automatic stripping of equal patches could erase a concurrent "Just Tuesday" edit: patches are now removed only by the director's own choice on that record. (b) A patch written to a day just made its own day was invisible and resurfaced later: `PANCHOR` requires `days/<dk>/typical === true`, and "own day"/"follow again" clear the other mode's subtree atomically. §5.4, §6.4.2, §8.1, §11.5, §6.6. |
| sync-F17 | Accept | Verified seven unconditional `setItem(STORAGE_KEY` sites and the boot role hint. Editor tabs start undecided (no persistence, pushes held), all writes go through one `persistState()` gate, and demotion turns persistence off before flushing. §6.9, §14, §15. |
| sync-F18 | Accept | (a) A resumed wizard could clear data written after the archive: step 4 re-hashes and writes a fresh archive if anything changed. (b) A deterministic id plus create-only rules stranded a retried step 3: ids get a random tail and step 3 reuses-or-re-mints. §7.3, §5.5, §11.3. (Same as ux-R6.) |
| sync-F19 | Accept | The codebase's own model says RTDB prunes `''`, which would make the first claim fail `hasChildren`. `fromEpoch` is `'legacy'` and the rule is `NESTR(40)`. §5.2, §8.2, §11.3. |
| sec-F1 | Accept (modified) | Accepted the emulator-tested rule (`at === now` on every write, age-gated self-delete), the `accessBlocked` block list and **Block**, and a bounded editor listener. Replaced two parts: (3) instead of `once()`-only, a `limitToLast(25)` query on `at` stays live on editor devices, because ux-R10 needs directors told in real time and the fixed throttle bounds the traffic; (4) instead of a second publish (R1b), R1 ships the node **closed** behind an editor-set `setup/meta/joinOpen` switch, so no stranger-writable node exists until a director opens it in S7 — same safety, still one owner publish. K8 rewritten. §8.2, §5.1, §5.12, §11.8, §11.18, §16, P15. |
| sec-F2 | Accept | Rules let any editor delete the archive. `archive`, `pre-wizard` and pinned rows (index and body) are now undeletable by rules; `pinned` is write-once `true`; retention counts only unpinned points. §8.2, §7.2, §7.3, §11.16, §8.8. |
| sec-F3 | Accept | Verified: the TV page concatenates raw `teamEmoji()` and crest URLs into `innerHTML` and has no CSP. Sanitizers move to `camp-core.js` and are shared with the TV; full-data-URL regex; `img.src` via the DOM; TV script moved out with a CSP; leaf rules for `state/teams/$i/{emoji,short,color,photoV}` (the "rules can't validate inside teams" claim was wrong). P14, §5.7.1, §8.3, §9.1, §12.3, §16 K21. |
| sec-F4 | Accept | Verified the member `.validate` (`hasChildren(['role','addedBy','addedAt'])`) applies to the merged record, so one malformed row would refuse the whole clear. Member team clearing moves out of the atomic update into per-row best-effort writes, with a preflight warning. §11.3, §13.2 S0c, §14, `wizard.test.js`. |
| sec-F5 | Accept | The runbook could pass on a stale CDN copy and its unauthenticated probes can't tell old rules from new. No fetched script; cache-busted fetch checked against a hash in the commit message; discriminating signed-in checks only the new rules pass; non-member probes. §8.7, §8.9, Appendix E, §13.2 R1. |
| sec-F6 | Accept | Duplicate of sync-F6 (emulator-confirmed: 5 parents refused, 4 allowed). Fixed with sync-F6. |
| sec-F7 | Accept | Presence `where`/`v` were forgeable by viewers and streamed to every device. "Also here" and the build version move to an editor-only, key-pinned, 1 s-floored `editorsHere` node that only editor devices read; presence and its rules are untouched. C9, §5.1, §5.9, §6.7, §8.2, §8.3, §8.5, §8.8. |
| sec-F8 | Accept | A stranger's `name`/`note` reached the most privileged screen unescaped, and "Link them" could hand a Director-role pending row to a self-named stranger. `esc()` everywhere with a test; candidates show team and role; linking to a Director row needs the typed email; the approver confirms the directory name with a duplicate-name warning. §11.8, S7 tests. |
| sec-F9 | Accept | Scalars and huge strings were accepted at `setup` containers and `campers` levels, and `setup` is cached on every device. `BRANCH` (or `hasChildren`) on every container and `$dk`/`$tid`/`$cid` level. §8.2, §8.8, §8.10. |
| sec-F10 | Accept (modified) | Accepted: `setup/meta` cancel non-fatal; TV reloads capped at 3/hour; memory + IndexedDB photo cache; fetch only rendered crests; §5.12 gains photo bytes and the cache-miss case. Replaced: the cap goes to 100,000 chars (target 70,000), not 60 KB — shields and flags need visible detail, and with only rendered crests fetched the no-cache worst case is ≈ 1.3 GB/month. C18, §5.1, §5.12, §8.2, §11.7, §12.3, K15. |
| sec note (a) | Accept | The "ancestor `.validate` never runs" rationale contradicted the reviewer's emulator. The design no longer depends on it (leaf anchors plus record-level checks); a one-line live probe before R1 settles it and corrects CLAUDE.md. §8.1, §8.6. |
| sec note (b) | Accept | Rules size roughly doubles. Size check before R1; an oversized PUT is refused harmlessly; R1a/R1b split as fallback. §8.6, K22. |
| ux-R1 | Accept | Verified: Earlier/Later can't exchange Team competitions (10:00–11:45) and Elective 1 (13:15–14:00) without dragging Lunch, and the example result overlapped Snack Shack break. Added **Swap with…** with "Swap their time slots" (no overlaps) vs "Keep their lengths" (overlaps named), overlaps listed at Done, example fixed, a Playwright tap count gating S5a. §2.3, §11.6, §13.2 S5a. |
| ux-R2 | Accept | Rain plan opens collapsed around now with actions in a bottom sheet; phone layouts specified for cleanup (one day, one meal per row) and electives (one slot at a time); the day strip opens on today. §11.5, §11.6, §11.12, §11.13. |
| ux-R3 | Accept | Verified seeded `end: hm(24,0)` items, which native time inputs can't hold. "Until the end of the day" switch storing 1440; ripples treat such items as elastic and never push past midnight; tests save every seeded block unchanged. §5.4, §11.5, §11.6. |
| ux-R4 | Accept | Two front doors and a date-first trap. `newYearDue()` no longer depends on a typed date; one front door at a time; the wizard folds in A1; **Start the new-year setup** always in ⋯; the Camp week row routes to the wizard. §10.6, §11.2, §11.3, §11.4, Appendix B. |
| ux-R5 | Accept | Wizard answers had nowhere to live. A device draft key plus an `answers` field in the claim (rules added), take-over inherits them, claim `at` refreshed by interaction, and the open wizard holds reload. §5.2, §5.11, §6.5, §8.2, §11.3. |
| ux-R6 | Accept | Duplicate of sync-F18(b); step 3 is idempotent. §7.3, §11.3. |
| ux-R7 | Accept | Same data-loss bug as sync-F2 (fixed there), plus wording: on-screen names are now **Edit the week here** / **Use the original week again** ("your changes are kept") / **Start this section again from the original**, and a section that's off but holds edits says so. Summary, §5.3, §10.1, §11.2, Appendix C. |
| ux-R8 | Accept | Exact-name matching never linked "Cam" to "Cam Smith". Requests list first-name candidates (team hint from the note first) with **None of these**; the request name is prefilled from the sign-in display name; pending rows can later be merged ("This is the same person as…"). §11.8, §11.18. |
| ux-R9 | Accept | No bulk way back onto teams, and last year's typed counselor names lingered. Added **Put people on teams** (one list, per-row selectors; pasted lines update existing people), a wizard row clearing typed counselor names (default Clear), a "names in the schedule" review, and a People status that ignores fallback text. §11.3, §11.8, Appendix B. |
| ux-R10 | Accept | Directors weren't really told. A toast and home bar when a request arrives, a one-shot other-camp count, and requester copy "Now tell a director you've asked". Phone alerts per request stay decision Q15 (default no). §11.1, §11.8, §11.18, §9.4. |
| ux-R11 | Accept (modified) | Accepted: default ticked only for time moves and skips today/tomorrow, off for label fixes; offline Done says "Saved on your phone only. Nobody else has this yet." Replaced: "Reaches about N phones" **before** sending — the client can't count other members' subscriptions (owner-only push records), so the box says plainly that only phones following the item get it, and the count is shown after sending. §11.5, §11.6, §12.2. |
| ux-R12 | Accept | The owner summary over-promised. It now scopes Undo to the device and to schedule/games/teams/menus/verses/rota/electives, lists every online-only action, and camper names typed offline wait on screen (memory only) and send on reconnect. Summary, §6.8, §11.9. |
| ux-R13 | Accept | A rename now asks about short name and emoji; the hub mock uses an Appendix B sentence ("Two teams are Blue"); a failing legacy colour is an info note with "Pick colours for flagged teams", so the hub can reach all-ready. §11.2, §11.7, Appendix B. |
| ux-R14 | Accept (modified) | Accepted: **[Just Tuesday] / [Every day like Tuesday]** with a live caption of the days that actually change; one day choice ("follows the typical day" / "has its own schedule") with competition days moved to the Games screen; one name per action ("Skip", "Bring back", "Clear all of Tuesday's changes", "Give Friday its own schedule"). Replaced: seeding junior Friday as its own day — all 18 of Friday's differences are after 5 PM, so its morning should keep following the typical day (a breakfast change must reach Friday); the day view instead says "Friday evening is different from the typical day". C13, §11.4, §11.5, §11.14, Appendix C. |
| ux-R15 | Accept | The calendar's limits are now shown at the button and in the file, with "Only the days from today" and the export time in the filename. §12.4. |
| ux-R16 | Accept | §17 split into 13 questions only the owner can answer (plain words, most important first) and 14 defaults already applied; the Q-numbers stay as reference tags. Kept three beyond the reviewer's ten because only the owner knows them: Q6 (walk-up policy), Q8 (who may run the wizard), Q21 (whether Sofie/Sofia are one person). §17, summary. |
| ux-R17 | Accept | The Competitions card keeps today's visible Morning/Afternoon/Evening grouping (now derived from blocks); the small home-adjacent additions are listed in the §9.4 seam table behind their own functions. §9.4, §11.17, §13.2 S6a. |
| ux-R18 | Accept | "Change today's plan" appears only when the schedule is edited here; otherwise a one-line pointer to the hub; the camp-week override is worded plainly; "rain plans are fine" shows only when true. §10.1, §11.1, §11.2, §11.17. |
| ux-R19 | Accept (modified) | Accepted: a team word (short name or a word of the name) counts as a mention only when capitalised, followed by "team"/"campers", or as the full team name — applied to the client and the Worker, which also ends today's lower-case "blue"/"gold" pings. Replaced: a separate team-mention mute — the existing **Mentions** switch already silences mention alerts, and a new pref would need a rules change to the sealed push prefs plus a Worker change. §13.2 S7/S9, §14, Appendix D. |

---------------------------------------------------------------------------------

## Change log

- **2026-10-27: the owner's answers to §17.1 recorded** (all thirteen). Four changed the plan:
  **both camps roll out together** (Q2), the **new-year setup and the edited-here / original-week
  switch are owner-only, enforced in the rules and the app** (Q8), **senior's Sunday and Saturday
  keep their sample days** (Q11), and the **counselor spellings merge to Sofia, Lily and Alyssa**
  (Q21, new stage S0k). Nine matched the recommendations. §2.2 and §9.4 now point to
  `app-shell-redesign-spec.md` for the home-screen redesign, and `BUILD-PLAN.md` is the integrated
  order of both projects. Sections touched: summary, §1.4 (new), §2.1–2.3 (new moment M7), §3,
  §4 (P1, P8, P11), §5.2, §5.3, §5.7.2, §6.6, §7.2, §7.3, §8.1–8.4, §8.6, §8.8–8.10, §9.4,
  §10.1, §10.2, §10.5, §11.1–11.3, §11.8, §11.13, §13.1–13.3 (new stage S0k), §15, §16 (K2, K5,
  K9, K20, new K23), §17, Appendices B, C, D and E. Not changed by this update: the sync, setup
  and undo engines, the data model apart from the owner-only fields, and every other screen.
