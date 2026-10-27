# Build plan: one integrated order for Project 2 and the app-shell redesign

Written 2026-10-27 against v184 (live; `node tests/run.js` = 560 passing in 28 files; 12 `?v=`
assets). It merges `setup-rebuild-spec.md` ("P2": stages S0–S10, T, R1) and
`app-shell-redesign-spec.md` ("the redesign": stages D0–D7). Neither spec is changed by this
plan, and it makes no design decisions: it only fixes the **order**, what ships together, how each
step is proven and undone, and what only the owner can do. Where the two specs touch, §7 says how.
CLAUDE.md stays authoritative for deploys, sync, rules and camps. Where this plan and P2's own
calendar (§13.1) differ, this plan wins.

---------------------------------------------------------------------------------

## 1. The short version (for the owner)

- **31 steps in six phases, November 2026 to May 2027** (plus a half-session of housekeeping first).
  26 are builds, 5 are short sittings that only you can do. About **80 build sessions** in all (a
  session is roughly half a day of agent work that ends with the tests green), about 12 to 14 a
  month, with roughly three weeks of slack in May.
- **No camp week runs before June 2027** (your answer), so every step ships off-season. From the
  first camp-week dates onward only bug fixes ship (the ±2-day freeze, P2 P8).
- **One agent builds at a time**, in the order below. Sonnet writes the code and the tests. Opus
  is used only for the screens that need design judgment (the shell, the Now card, the Games tab,
  the reveal remote, Tell everyone, the setup hub and schedule screens, and the final senior and
  polish pass): eight short "UI passes", named per step.
- **Both camps roll out together.** Nothing is tried on senior first. The two big switches,
  **Edit the week here** and the **new-year setup**, are yours alone, in the app and in the
  database rules.
- **What you do by hand** (§6): paste the one rules update (December), check the app on a real
  iPhone (January and March), press **Edit the week here** for both camps (February, then once more
  in March), paste the Cloudflare Worker when phone alerts go live (April), run and undo the
  new-year setup once as a rehearsal (April), take part in one rehearsal with real phones and a
  real TV (May), and run the new-year setup for both camps (May). Each is 10–60 minutes. Between
  them the plan never waits on you.
- **What changes for counselors first:** in November the standings disappear from their phones
  (Step 3). The Now/Games/Chat/More app arrives in January to March, and the director reveal
  remote in March. The big-screen reveal and the champion celebration are tested end to end in
  May.

---------------------------------------------------------------------------------

## 2. Ground rules for every step

**2.1 One agent at a time.** Steps run strictly in the order of §3; no parallel worktrees. A step
starts from the latest `main` and reads: its block in §5, the spec sections it cites, CLAUDE.md,
and the previous step's commit message. The next step does not start until this step's live
check has passed. "Needs" lists dependencies by step number.

**2.2 Models.** Sonnet implements and tests every step. Opus does only the **UI pass** named in a
step: the visual and interaction design of screens (markup, CSS, layout against the mockups); a
Sonnet session then wires behaviour and tests. Opus never writes engines, rules or tests.

**2.3 Definition of done (every build step).**
1. Tests added as listed; `node tests/run.js` green; `node --check` on every changed JS file.
   Pins that must change are changed in the same commit and named in its message.
2. CLAUDE.md's deploy checklist: every `?v=` bumped together, `APP_VERSION`, `CODE_UPDATED_AT`,
   `TV_BUILD` when the TV page changes, CSP for any new host, SDK hashes untouched, `CHANGES`
   still empty. A new script joins `index.html` and `tests/harness.js` `APP_FILES`.
3. CLAUDE.md updated in the same commit (what the step adds, every new node, key, limit).
4. Pushed to `main`, then verified **live**: the `curl … | grep -c` check for a string unique to
   the change, the `?v=` line of `index.html`, then the step's own live check (§5).
5. The commit message states the rollback (§2.5) and any owner action now pending.

**2.4 Branching.** CLAUDE.md's rule stays: every merge goes straight to `main`, no PR, and is
verified live. A push to `main` is a deploy, though, and a half-built shell cannot be half-live, so
a step with several sessions is built on a short-lived local branch (only a working copy, never a
PR) and merged the same day its acceptance passes. Steps that are dark by design (Step 10, S4, and
S5a's code before its switch is pressed) may deploy in pieces.

**2.5 Rollback kinds.** *Code:* `git revert` the commit, push, curl-verify; every step is
revertible. *Rules:* PUT the backup taken in block 1 of the runbook (P2 Appendix E). *Data:* the
owner's **Use the original week again** (switches a camp back instantly, keeps edits) and
**Undo the new-year setup** (puts the archive and epoch back in one update).

**2.6 Sizes.** S = one session or less; M = 2; L = 3; XL = 4–6. Sessions are estimates; a step that
runs over is split at a natural seam, not rushed.

---------------------------------------------------------------------------------

## 3. The order at a glance

Source labels are the specs' own. ◆ = a sitting only the owner can do. Month = when it is due,
not when the work starts. **Needs** lists steps that must be done first; a number written `~7` is
an ordering choice (the specs don't require it). **Phases:** A = steps 1–4 (safety, TV, secrecy,
seam); B = 5–11 (engines and the rules release); C = 12–14 (motion, the shell, setup
infrastructure); D = 15–22 (schedule data, Now, Games, the builders); E = 23–28 (the reveal,
director tools, people, alerts, the wizard); F = 29–31 (rehearsal and the new year).

| # | Step | Source | Due | Needs | Size | Opus pass |
|---|---|---|---|---|---|---|
| 0 | Save the mockups and motion demo into the repo | housekeeping | Nov | — | S | — |
| 1 | Safety fixes + counselor spelling merge | P2 S0a–S0k | Nov | — | L | — |
| 2 | TV page for both camps | P2 T | Nov | — | M | — |
| 3 | Secrecy, fail closed | redesign D1 | Nov | 2 | L | — |
| 4 | Accessor seam | P2 S1 | Nov | ~3 | M–L | — |
| 5 | `pushState` quarantine | P2 S2a | Dec | 1 | M | — |
| 6 | Teams per field | P2 S2b | Dec | ~5 | S | — |
| 7 | Two-tab writer lock | P2 S2c | Dec | ~6 | M | — |
| 8 | Epoch check | P2 S2d | Dec | ~7 | S | — |
| 9 | Config engine v2 + undo core | P2 S3 | Dec | 8 | L | — |
| 10 | Author and prove the one rules release | P2 R1 prep + redesign §4.4 | Dec | 5, ~9 | L | — |
| 11 | ◆ Publish the rules (once) | P2 R1 | Dec | 10 | S | — |
| 12 | Motion and calm | redesign D0 | Jan | ~4 | L | — |
| 13 | The shell: tabs, header, More, takeovers | redesign D2 | Jan | 12, ~4 | XL | yes |
| 14 | Setup infrastructure (dark) + hub | P2 S4 | Jan | 11, ~13 | XL | hub frame |
| 15 | Schedule as data | P2 S5a | Feb | 14 | XL | Schedule + rain plan |
| 16 | ◆ Edit the week here, both camps (schedule) | P2 A1 | Feb | 15 | S | — |
| 17 | Now, block by block | redesign D3 | Feb | 13, ~4, ~16 | XL | yes |
| 18 | Games tab | redesign D4 | Feb | 13, ~17 | L | yes |
| 19 | Meals, verses, cleanup, electives | P2 S5b | Mar | 15 | M | — |
| 20 | ◆ Edit the week here, other sections | P2 A1 | Mar | 19, ~16 | S | — |
| 21 | Games screen (builder side) | P2 S6a | Mar | 15, ~18 | M–L | — |
| 22 | The 4-team bracket | P2 S6b | Mar | 11, ~21 | L | — |
| 23 | The reveal: remote, mirror, TV, finale | redesign D5 | Mar | 3, 13, 2, 11 | XL | yes |
| 24 | Director tools: Tell everyone, Award points | redesign D6 | Apr | 13, ~14 | L | yes |
| 25 | Teams, People, Campers, walk-ups | P2 S7 | Apr | 11, 14 | XL | — |
| 26 | Alerts go further (Worker release) | P2 S9 | Apr | 15, 25 | M | — |
| 27 | ◆ Phone alerts go live (Worker paste) | Project 1 go-live + S9 | Apr | 26 | S | — |
| 28 | New-year wizard (owner only) | P2 S8 | Apr | 15, 19, 25, ~23 | L | — |
| 29 | Senior pass, polish, joint rehearsal | redesign D7 | May | all | L | yes |
| 30 | Tidy up | P2 S10 | May | 29 | S | — |
| 31 | ◆ The new-year setup, both camps | P2 A3 | May | 28, 29 | S | — |

Totals: P2's 17 stages plus the redesign's 8 are the 25 deploy stages; Step 10 is a rules-only
release; Step 0 and the five ◆ are not builds. `?v=` assets after each deploy that adds one:
Step 2 → 13, Step 3 → 14, Step 12 → 15, Step 14 → 17, Step 23 → 18.

---------------------------------------------------------------------------------

## 4. Why this order

1. **Safety, TV and secrecy first** (1–3). S0 fixes live bugs and does the spelling merge before
   anything derives an id from a name. The TV page is rewritten once into `current-standings.js`
   (T) so every later TV change (secrecy now, the reveal later) lands in the new file. Secrecy
   (D1) is the owner's strongest requirement and needs the most lead time: old cached phones
   must have updated long before June.
2. **Accessors before screens** (4). S1 is a no-op refactor with exact-parity tests. Everything
   after it, including the new Now and Games code, reads through the accessors, so the setup
   data (S4–S5) later swaps their bodies without touching the screens.
3. **Engines before features, one change per deploy** (5–9), as P2 requires. The whole stretch is
   invisible to users and needs the longest soak.
4. **One rules release** (10–11) carries P2's blocks, the owner-only clauses and the reveal blocks,
   so you paste once. It lands before the first code that writes any of it (S4, D5).
5. **Motion, then the shell** (12–13) before any new screen: the shell absorbs today's Settings
   drawer into More, and P2's hub then has its permanent home (More → Director → Set up the
   week) instead of being built twice.
6. **Data and screens interleave** (14–22): the editable schedule (S4–S5a) goes live early (Step
   16) so months of real use precede June, and Now/Games (D3/D4) are built against live edited
   data. The Games tab (D4) ships before P2's S6a, so S6a's home-card part is simply not built
   (P2 §9.4).
7. **The reveal** (23) needs secrecy (3), the shell (13), the TV rewrite (2) and the rules (11).
   It sits after the data steps so the remote can be rehearsed against a realistic week.
8. **People, alerts, wizard** (25–28): S9's Worker release needs S7's team-word rule and S5a's
   publisher, and one Worker paste serves go-live and S9 together (Step 27). The wizard (28) is
   last among the builds because it clears the reveal nodes, archives everything and needs the
   People screen for the way back onto teams.
9. **Rehearsal, tidy, new year** (29–31) last, with May's slack in front of June.

**Shipped together on purpose:** the rules release (P2's blocks, the owner-only clauses and the reveal
blocks, Steps 10–11); the shell with More, Chat as a tab and What counselors see (Step 13, because a
half-built shell cannot be half-live); the reveal's remote, counselor mirror, TV subscriber and
finale (Step 23, so a counselor's phone can never show a place the big screen hasn't); the Worker
release with phone-alert go-live (Steps 26–27, one paste); the wizard's clear with the reveal nodes
(Step 28). **Never together:** two state-engine changes in one deploy (P2 P7, Steps 5–9).

**What can reorder.** After Step 13, Steps 17–18, 23 and 24 are independent of each other and can
swap (redesign §16); 19, 21, 22 and 25 are independent of the redesign stages. Steps 1–13 should
not reorder.

**If time runs short, cut in this order** (a suggestion; nothing here is decided): Step 30; then
Step 26 (schedule-change alerts; basic phone alerts stay); then the "Preview as a counselor"
switch inside Step 24; then Step 22 (senior's Legacy Game stays a placement game, as the redesign
already allows); then the walk-up "Ask to join" part of Step 25. Everything else is needed for
the owner's stated requirements.

---------------------------------------------------------------------------------

## 5. The steps

Each block: **Ships** (together, in one deploy unless said), **Needs**, **Tests**, **Live check**,
**Rollback**, **Owner**. Test names are the specs' own.

### Step 0 · Save the mockups and motion demo · Nov · S · Sonnet
- **Ships:** copy the session scratchpad's `mockups/final/` (HTML, PNG, `_build.js`, the two audit
  scripts, `motion-demo.html`, `_motion-demo.src.html`) into `docs/build-notes/mockups/final/` and
  commit. Docs only: no deploy, no `?v=` bump.
- **Why:** the redesign spec (Appendix A) says they exist only in the session scratchpad, and every
  D-step uses them as its acceptance reference.
- **Tests / live check / rollback:** the files open; `_build.js` regenerates a mockup; revert.

### Step 1 · Safety fixes + counselor spelling merge · P2 S0a–S0k · Nov · L (4–5) · Sonnet
- **Ships:** P2 §13.2 S0a–S0k, each its own commit and deploy: the zombie draft (B1), format-change
  and clock leaks, the owner row (`OWNER_MEMBER_KEY`), danger-text contrast, `.ics` UIDs, the
  unknown-bracket guard, the legacy roster gate, the config first-pull gate with
  `pendingWritesTotal()`, test scaffolding (`tests/fake-rtdb.js`, the v183 builder fixture; tests
  only), fixed team counts, and **S0k: Alysa → Alyssa, Sofie → Sofia, Lilly → Lily** (`camps.js`,
  `tests/fixtures-junior-week.json`, alias table). **First action:** re-check each item against v184;
  the 93 glitch fixes may already cover parts of it (skip what is fixed, keep its test).
- **Needs:** — · `?v=` count 12.
- **Tests:** P2 §15 S0 row: `settings-crud`, `config-gate`, `owner-row`, `ics` (UID part),
  `spelling`. The fixture's `git diff` shows only the three spellings.
- **Live check:** the CLAUDE.md curl checks after each deploy; junior and senior as a director look
  unchanged (Playwright at fixed `?now=`; junior differs only in the three names); the owner row is
  read-only in Who can sign in; the game builder is read-only until the first config snapshot.
- **Rollback:** `git revert` per commit.
- **Owner:** optional, 2 minutes: rename the (at most three) member rows spelled Alysa / Sofie /
  Lilly in Who can sign in. The alias table keeps them working either way.

### Step 2 · TV page for both camps · P2 T · Nov · M (2) · Sonnet
- **Ships:** `camp-core.js` (shared standings core, double-window maths, DST conversion, the
  sanitizers; `?v=` → 13); the TV page's script moved to `current-standings.js` with its own CSP
  meta, `?camp=` / `CAMP_FORCE`, sanitized DOM rendering, the 3-reloads-an-hour cap, pages#3 / #5 /
  #6, the stalling.html link.
- **Needs:** —.
- **Tests:** `tv.test.js`, `camp-core.test.js` (legacy pin, DST, standings parity fuzz, sanitizer
  cases).
- **Live check:** junior TV unchanged (`?demo`); `?camp=senior` shows 4 teams and no broken image; a
  phone-account presenter can sign in; revoking access shows the overlay then at most 3 reloads an
  hour; no CSP violations in the console.
- **Rollback:** revert (TV only).
- **Note:** until Step 3 the TV still shows live standings to any signed-in member.

### Step 3 · Secrecy, fail closed · redesign D1 · Nov · L (3) · Sonnet
- **Ships:** `reveal-core.js` (`groupPlaces`, `revealView`, `tvFrame`, `untilFor`, normalisers;
  `?v=` → 14); `standingsVisible()` inside every points reader and every viewer path in redesign
  §4.12; viewer result alerts from the results diff in `applyRemoteState`; rewritten copy; seeded
  `hiddenCards.standings` and `.bonus` for old builds; the TV shows live standings to directors only
  and "Waiting for the directors…" to everyone else (interim until Step 23). The harness gains the
  sink recorder.
- **Needs:** 2.
- **Tests:** `secrecy.test.js` (viewer `renderAll` with the guard throwing; sink recorder; the
  remote-change scenarios; hint-paint; role flip), `reveal-core.test.js` (+ `.senior`),
  `sync.test.js` (identical first snapshot then a result → exactly one viewer alert).
- **Live check:** as a test counselor on both camps: no points, places, gaps, "+N" chips, catch-up
  hint or standings anywhere (home, game rows, toasts, copy/share); medal winners still show; as a
  director nothing changes; the TV says "Waiting" for a counselor and shows standings for a
  director. The bracket bye keeps its rule and only the "fewest points" reason stays
  director-only (redesign §4.12 row 17 and §18 Q4: the build follows the recommendation unless you
  say otherwise).
- **Rollback:** revert (the seeded keys are harmless).
- **Owner:** open the app once as a director after the deploy (30 seconds): the first new director
  build writes the `hiddenCards` seed that protects not-yet-updated counselor phones.
- **Note:** from here counselors have no standings surface until the reveal (Step 23). That is the
  owner's rule, and no camp is running.

### Step 4 · Accessor seam · P2 S1 · Nov · M–L (2) · Sonnet
- **Ships:** the SEAM block in `app.js` and every consumer in `app.js`, `chat.js`, `push.js`,
  `settings.js` converted (P2 §9). No behaviour change.
- **Needs:** ~3 (D1 edits several of the same readers; converting afterwards avoids doing the work twice).
- **Tests:** `accessors.test.js` (+ `.senior`: `===` parity for every row), `seam.test.js`; the
  10,080-minute banner fuzz and the render-stability tests unchanged and green.
- **Live check:** Playwright before/after identical on both camps (banner, schedule sheet, follow
  card, verse, cleanup, electives).
- **Rollback:** revert.

### Steps 5–8 · State-engine hardening · P2 S2a–S2d · Dec · M, S, M, S · Sonnet
Four **separate** deploys (P7), in this order, each with its own tests and live check:
- **5 · S2a** `pushState` quarantine → `sync-quarantine.test.js` (refused path quarantined, the
  rest advance; the network path byte-identical). **6 · S2b** teams per field → `teams-sync.test.js`
  (changes `sync.test.js:344` on purpose). **7 · S2c** two-tab writer lock → `tablock.test.js`.
  **8 · S2d** epoch check → `sync-epoch.test.js` (a no-op until an epoch exists).
- **Needs:** 1; each is placed after the one before it (one engine change per deploy, P2 P7).
- **Live check (each):** two laptops on each camp in turn (both are idle until June); an
  airplane-mode edit → force reload → reconnect keeps the edit; the second tab is read-only (S2c).
- **Rollback:** revert each.

### Step 9 · Config engine v2 + undo core · P2 S3 · Dec · L (3) · Sonnet
- **Ships:** P2 §6.3 and §7.1 core: transactions with id-keyed field ops, rebase on receipt,
  persisted `_cfgBase`, the config first-pull gate lifted, undo wired to config and teams commits,
  resolve-by-id handlers.
- **Needs:** 8.
- **Tests:** `config-sync.test.js`, `undo.test.js`; **changed on purpose:** `sync.test.js:355-372`,
  `sync-merge.test.js:132-147`.
- **Live check:** two laptops edit two fields of one game at once, on each camp: both kept; an
  airplane-mode game edit → reload → reconnect: kept.
- **Rollback:** revert (`_cfgBase` fields are ignored by old code).

### Step 10 · Author and prove the one rules release · P2 R1 prep · Dec · L (2–3) · Sonnet
- **Ships (a rules-only commit; no `?v=` bump; nothing live changes):** `database.rules.json` with
  P2 §8.2 and §8.3 **including the owner-only clauses** (`OWNER` / `OWNERKEEP`), **and the reveal
  blocks** (`reveal`, `revealFull`, `revealScreens`, `revealPractice`) written from redesign §4.4
  verbatim; `tests/rules.test.js` changes (P2 §8.10 + the owner and reveal lines); the emulator suites
  of P2 §8.8 (`compat-old-client`, `compat-new-client-old-rules`, `setup`, `restore`, `campers`,
  `access-requests`, `editors-here`, `teams-fields`, `brackets4`, **`owner-only`**) and the redesign's
  **`reveal.mjs`**; the rules size check; the CLAUDE.md "path before its feature" policy wording;
  Appendix E's blocks with this file's `sha256` prefix.
- **Needs:** 5 (a refused state write must quarantine, not wedge); placed after 9 so the rules match the finished engines.
- **Tests:** every emulator suite prints SAFE in both directions, seeded trees for **both camps**
  accepted; `node tests/run.js` green; the ancestor-validate probe plan recorded.
- **Live check:** none (inert until Step 11).
- **Rollback:** revert the commit.
- **Note:** the reveal client is built in Step 23. If it ever finds a flaw in these rules, a small
  second publish ("R2") is allowed; the plan expects none.

### Step 11 · ◆ Publish the rules, once · P2 R1 · Dec · S · Owner + Sonnet
- **Ships:** you paste P2 Appendix E blocks 1–4 in Cloud Shell: back up, publish (refuses a file
  whose hash differs), read back and unauthenticated probes, the discriminating checks. Then a short
  agent session records the results in CLAUDE.md's R1 checklist.
- **Needs:** 10.
- **Checks you run:** all unauthenticated probes say `Permission denied` on both roots; as yourself
  `setup/meta` and `campers` read ALLOWED; as a test counselor `campers` is DENIED; as another
  director `set(false)` at `<root>/setup/meta/on/schedule` is DENIED (the owner-only proof; as
  yourself it is allowed, so remove it at once); the one-line ancestor-validate probe.
- **Rollback:** PUT the backup from block 1. Every addition is inert, so nothing depends on it yet.
- **Owner:** 30–45 minutes; you need a test counselor account, a non-member test account and a
  second director sign-in.

### Step 12 · Motion and calm · redesign D0 · Jan · L (3) · Sonnet
- **Ships:** `jelly-motion.js` (the six presets, `play`, `playOut`, `morph`, `flipKeyed`,
  `whenHandsOff`, `restamp`, the press dent; `?v=` → 15); tokens in `styles.css`; `calmMotion()`
  with the frame-rate sampler, battery check and the OS setting (the OS beats Off); Calm motion
  Auto / On / Off in today's Settings drawer for now; pre-paint calm in `boot-guard.js`;
  `JOY_REDUCED` and the raw reads replaced; the nine media blocks become `html.calm-motion`; Jelly
  token mapping.
- **Needs:** — (placed after 4 so the two refactors don't overlap).
- **Tests:** `motion.test.js` (sampler vs Jelly's integrator; presets' damping and overshoot; the
  minimum visible deformation per row; calm truth table; no transform keyframes while calm;
  `outerHTML` unchanged after press, release, play, playOut, flipKeyed), `shell.test.js` (no motion
  media queries; pre-paint calm), `auth.test.js` wipe list.
- **Live check:** the switch works; a phone with Reduce Motion is calm; no first-paint flash after
  a reload (the boot guard); the springs match `motion-demo.html` (Step 0) side by side.
- **Rollback:** revert.

### Step 13 · The shell: tabs, header, More, takeovers · redesign D2 · Jan · XL (5) · Opus pass, then Sonnet
- **Ships (one deploy):** the header (identity root + the patched status pill), the bottom tab bar
  Now · Games · Chat · More, the four roots split by volatility, the sheets-and-takeovers model, the
  game takeover with its labelled back, **More** absorbing today's Settings drawer (one Alerts row,
  Appearance inline, "Not you? Change"; its Director section holds only what exists at this point:
  What counselors see, Set up the week → today's classic builder, Change history, Who can sign in;
  Run the reveal / Tell everyone / Award points appear as Steps 23–24 ship), Chat as a tab, the
  bottom stack, keyboard handling, scroll memory, history and Back, deep links, **What counselors
  see** (the six Hide switches move here; the standings switch retires), `teamMark` keyed images,
  accordion and idle-collapse removed, the Home Screen metas. Now hosts today's banner and live
  home unchanged inside the new frame. Check whether `sw.js`'s open targets need the new deep links
  (`reveal`, `game:<id>`, `alert:<id>`); if so bump `PUSH_SW_VERSION`.
- **Opus pass:** the visual system (redesign §8: tokens, type, colour roles, the blue roof, tab bar,
  More's grouped lists, sheet and takeover frames) against mockups 09, 15, 16.
- **Needs:** 12 (and the accessors from 4).
- **Tests:** `tabs.test.js` (switching, dirty render, scroll memory, history including Next-replaces
  and cold deep links); updated pins in `shell`, `overlays`, `home`, `render-stability` (a pill flip
  doesn't touch the shield; More's volatile lines don't rebuild the segmented controls),
  `game-view`, `chat`, `chat-view`, `sync`; Playwright: every target at least 44×44 at 360 and 390,
  at 130% and 200% text, both themes, both camps.
- **Live check:** both camps, as counselor and director. **Real iPhone, Home Screen app** (status-bar
  colour under the blue roof, tab bar above the home indicator, keyboard with the chat composer,
  Back gestures, wake lock available).
- **Rollback:** revert (one deploy).
- **Owner:** the iPhone check, 20 minutes (§6).

### Step 14 · Setup infrastructure (dark) + the hub · P2 S4 · Jan · XL (4) · Opus pass (hub frame), then Sonnet
- **Ships:** `setup-sync.js`, `setup-ui.js` (`?v=` → 17; `APP_FILES` grows), the setup engine,
  restore points and Backups v3, `editorsHere` and "also here", sync line, undo pill, `askDialog`,
  the single `persistSetup()` gate, **`isOwner()` / `ownerName()` and the owner-only gating**, and
  the **hub** reached from More → Director → Set up the week. The Schedule row says editing comes
  next; the owner-only gating is already in place for the buttons that arrive in Step 15.
- **Opus pass:** the hub, the frame around every setup screen and the director's-clipboard language
  (P2 §11.0–11.2).
- **Needs:** 11 (rules); placed after 13 so the hub's home (More → Director) already exists.
- **Tests:** `setup-sync.test.js`, `restore.test.js`, `editors-here.test.js`, `checklist.test.js`,
  `owner-only.test.js` (the owner helpers and the hub's owner-only rendering contract; Steps 15, 19
  and 28 extend it as each owner-only button arrives).
- **Live check:** probes; "Save a restore point now" on both camps, listed; two directors in the
  hub see each other.
- **Rollback:** revert; the nodes are inert.

### Step 15 · Schedule as data · P2 S5a · Feb · XL (5) · Opus pass (Schedule + rain plan), then Sonnet
- **Ships:** A1 + A2 (code; the switch stays unpressed), accessors switching on `meta/on/schedule`,
  Camp week, Schedule, the rain plan with game moves, the publisher with `rev`/`src`, the TV reading
  `setup/meta`, the full-week `.ics`, hub rows.
- **Opus pass:** the Schedule screen and the rain-plan panel, the one-handed moment M2 (P2 §11.5–11.6).
- **Needs:** 14.
- **Approval gate:** the M2 tap-count script runs on junior Wednesday in a seeded context; over 12
  taps means the panel changes before the step is accepted.
- **Tests:** `seed.test.js` + `.senior` (round trip of all 7 days both camps; the 10,080-minute banner
  fuzz identical before and after seeding; frozen id fixtures; the A2 oracle table), `schedule-edit`,
  `games-blocks`, push and `.ics` additions, and the seeded-context re-run of the `week`, `push`,
  `chat` tests **and of whichever redesign tests exist by then** (Steps 17–18 add `now-model` and
  `games-tab` to that run when they ship).
- **Live check:** code only; the switch isn't pressed, so both camps behave as before (curl +
  Playwright identical to the screenshots taken just before this step).
- **Rollback:** revert; the camps are untouched.

### Step 16 · ◆ Edit the week here, both camps (schedule) · P2 A1 · Feb · S · Owner + Sonnet
- **Ships:** you press **Edit the week here** for junior, then senior, in one sitting. Before you do,
  an agent session proves readiness: seeded fidelity green for both camps, the emulator seeded-tree
  suites re-run against a fresh export of each camp's data (you export them from the Firebase
  console: Data → Export JSON), and your walkthrough of Just Tuesday / Every day like Tuesday (the
  K11 check).
- **Needs:** 15, 11.
- **Live check:** console shows `setup/meta/on/schedule` under both roots; as another director the
  hub says "Patrick turns on editing" and shows no button; banner, schedule sheet and
  `.ics` match what they showed before; an edit on one phone appears on another within seconds; an
  airplane-mode edit survives reload and reconnect; **Use the original week again** restores the
  built-in schedule and Edit the week here brings the edits back.
- **Rollback:** **Use the original week again** (instant), the `pre-seed` point for what A1 wrote
  outside `setup`, or revert the code.
- **Owner:** 20 minutes for the walkthrough, 10 for the switches.

### Step 17 · Now, block by block · redesign D3 · Feb · XL (4) · Opus pass, then Sonnet
- **Ships:** `blockKind`, `nowModel`, every kind renderer (games block with status and podium strip;
  electives with my station first; meal cleanup and verse moments with director award buttons; the
  generic and arrival/send-off cards; Later today; Still to do today), "Running over" with "Still on
  this", the messages strip with the notice's "Take down", the 30-second tick and wake-up list.
- **Opus pass:** the Now card in all its kinds against mockups 01, 01b, 02, 03, 04, 12, 13.
- **Needs:** 13; placed after 4 (accessors) and 16 (so it is built against the edited schedule, live on both camps).
- **Tests:** `now-model.test.js` + `.senior` (every minute of every day: no throw, a block or a
  defined empty state, right kind, moment windows, personalisation, a live game past its block keeps
  the card capped at 45 minutes), render-stability per kind, award writes keep the own-team guard;
  Playwright: the podium strip at 360 with the widest podium and a 20-character name.
- **Live check:** `?now=` through each block kind on both camps as counselor and director; a games
  block lists its games with Not started / Live / Done and medal winners; no points anywhere for a
  counselor.
- **Rollback:** revert.
- **Owner:** redesign §18 Q1 (when directors give quick points) is the question this step touches;
  the build follows the recommendation (two taps from the Games standings, no extra moment on Now)
  unless you say otherwise.

### Step 18 · Games tab · redesign D4 · Feb · L (3) · Opus pass, then Sonnet
- **Ships:** day picker; directors' live standings (shared places, labelled arrows, medal counts in
  words, gap sentence, "Counselors can't see this", tap a team for quick points); the status model;
  Score + **Next game →**; the **podium picker** replacing the three dropdowns; live line per format.
  "Add games" opens today's builder until Step 21.
- **Opus pass:** the standings block and the podium picker (mockups 08, 14, 14b).
- **Needs:** 13; placed after 17, whose game rows it reuses.
- **Tests:** `games-tab.test.js` (status truth table including clocks; Next-game order skipping the
  own team; shared places equal the TV's grouping; the podium picker's disabled-later-rows and
  re-tap-clears; drafts per leaf), updated `game-view` pins.
- **Live check:** score a podium game on a phone in three taps and Save; a second director sees it;
  both camps.
- **Rollback:** revert.

### Step 19 · Meals, verses, cleanup, electives · P2 S5b · Mar · M (2) · Sonnet
- **Ships:** P2 §11.10–11.13 screens and the "can now be edited here too" prompt (owner only).
- **Needs:** 15.
- **Tests:** `sections.test.js` (fill-evenly, elective identity with the spellings from S0k, meal tag,
  verse video).
- **Live check:** both camps: the screens open for every director; the prompt appears for the owner
  only; nothing changes until Step 20.
- **Rollback:** revert.

### Step 20 · ◆ Edit the week here, other sections · P2 A1 · Mar · S · Owner + Sonnet
- **Ships:** you turn on meals, verses, cleanup and electives (junior only) for both camps in one
  sitting.
- **Needs:** 19; placed after 16.
- **Live check:** Now's cleanup and verse moments and More → Meal cleanup / Memory verse show the
  seeded data unchanged on both camps; an edited dish appears on the Now card after lunch.
- **Rollback:** the per-section **Use the original week again**.
- **Owner:** 10 minutes.

### Step 21 · Games screen (builder side) · P2 S6a · Mar · M–L (2–3) · Sonnet
- **Ships:** P2 §11.14: games by schedule item, the progressive game sheet, the When picker, ⚡ quick
  game to the current block, Matchups options; random-tail game ids. **Not built:** the home
  Competitions-card grouping (the Games tab replaced it, P2 §9.4). The Games tab's "Add games" /
  "Quick game" now open this sheet.
- **Needs:** 15; placed after 18 (the Games tab's "Add games" opens this sheet).
- **Tests:** `games-screen.test.js` (progressive save, deleted-elsewhere, quick game attaches to the
  current block, two devices adding the same name get two games, a new game never inherits a stale
  bracket or clock).
- **Live check:** both camps: add a game to an item, see it on Now and Games.
- **Rollback:** revert (`blockId` is inert to old code).

### Step 22 · The 4-team bracket · P2 S6b · Mar · L (3) · Sonnet
- **Ships:** the `brackets4` sync key, the four-team flow (semifinals, 3rd place before the final,
  final), the 6-team helpers extracted **after** their pin-first tests; senior's Legacy Game uses it,
  and its Now card (already built in Step 17 to read the bracket) starts showing "Red plays in the
  final next" (redesign mockup 13).
- **Needs:** 11 (the `state/brackets4` rule); placed after 21.
- **Tests:** `bracket.test.js` (pin first), `bracket.senior.test.js`; **changed on purpose:**
  `week.senior.test.js:105-115`.
- **Live check:** a senior sandbox tournament end to end, Clear result, delete the game; a junior
  6-team smoke test.
- **Rollback:** revert (old code ignores `brackets4`).

### Step 23 · The reveal: remote, counselor mirror, big screen, finale · redesign D5 · Mar · XL (6) · Opus pass, then Sonnet
- **Ships:** `reveal.js` (`?v=` → 18): the director remote (mini TV, grouped ladder, masked
  up-next, the big thumb-zone button with its wait on the face, Back, End reveal, screens online,
  practice runs, screen wake lock, `confirmedReveal`), the counselor mirror that ends at the final
  table, the red "Live on the big screen" strip on the other tabs, the 8 AM grid with
  `expireReveal()`, the champion line, Friday's finale, Buzz on start (never for practice), and the
  TV page rewritten as a subscriber. `revealBusy` joins `reloadBlocked`.
- **Opus pass:** the remote in mockup B's layout with mockup A's colours, every state of 07c, the
  mirror and the grid (mockups 05, 05b, 06, 07, 07b, 07c, 11).
- **Needs:** 3, 13, 2, 11.
- **Tests:** `tests/emulator/reveal.mjs` (opt-in), `rules.test.js` (both camps), `reveal.test.js`
  (command builders, CAS refusal, confirmed-state rendering, the phone lag keyed to `sa`, auto-end,
  DST `until`, a fake clock across 07:59:59 → 08:00:01 for the active tab, an inactive tab and a
  wake from sleep; practice never calls `pushSendAlert`; the champion path reads no points),
  `tv.test.js` (frames, waiting, late join, real beats practice).
- **Live check:** two phones as remotes, a TV or laptop as the big screen, one counselor phone:
  Start, reveal three places, Back, End early; the counselor phone keeps pace three seconds behind
  and keeps the grid; a practice run never shows on the counselor phone and never buzzes; the wake
  lock on a real iPhone Home Screen app. Buzz-on-start stays disabled with its reason until Step 27.
- **Rollback:** revert the client; the rules stay (inert).
- **Owner:** a TV or screen, two director phones, 30 minutes. Redesign §18 Q2 (the big screen needs a
  signed-in account) and Q3 (practice uses made-up points) are the questions this step touches; the
  build follows the recommendations unless you say otherwise.

### Step 24 · Director tools: Tell everyone, Award points · redesign D6 · Apr · L (3) · Opus pass, then Sonnet
- **Ships:** the one **Tell everyone** composer (Showing now with Take down, quick alerts, Buzz off by
  default and labelled on the Send button, the notice replace/undo rules, Done above the keyboard),
  **Award points**, **Preview as a counselor**, the Set up the week entry (its join badge is wired in
  Step 25, when requests exist). Buzz is disabled with a reason until phone alerts are live.
- **Opus pass:** the composer and Award points (mockup 10 and its dark twin; the patterns drawn for
  Award points).
- **Needs:** 13; placed after 14 (its "Write a full notice" link opens the hub's notice builder).
- **Tests:** `tell.test.js` (channel combinations, partial failure, undo restores the previous notice
  only if unchanged, draft survives a re-render, `reloadBlocked`, quick alerts tick Urgent),
  `award.test.js` (guards, deterministic ids).
- **Live check:** post a banner and pin a notice from a phone; take both down; award verse and
  cleanup points; Preview as a counselor shows no points and no director rows.
- **Rollback:** revert.

### Step 25 · Teams, People, Campers, walk-ups · P2 S7 · Apr · XL (5) · Sonnet
- **Ships:** P2 §11.7–11.9, §11.18: the palette and `teamAccentVars`, team photos, People (lists,
  **Put people on teams**, the asking switch, the block list, the owner row), Campers (directors
  only, never on a device), the denied screen's **Ask to join** (default role Counselor), chat
  mentions from `teamShort` with the capitalised-team-word rule. The Members row in More becomes
  People, and the join badge and request bar are wired to their new homes (§7 item 5). Before shipping: both camps' `state/teams` ids are read (an owner GET in
  Cloud Shell, 2 minutes); a one-off repair is built only if one isn't `tN`.
- **Needs:** 11, 14.
- **Tests:** `palette`, `teams-screen`, `campers` (never in any `setItem`, backup, restore or the TV),
  `people`, `access-requests`; `chat.senior.test.js` "Red"; **changed on purpose:** the team-word
  cases in `chat.test.js`.
- **Live check:** a viewer account cannot read `campers` (device and REST); with asking off a test
  Google account's request is refused with the closed message; switched on it can ask, a director's
  open app shows the bar, approving opens the requester's page by itself; switch asking off again.
- **Rollback:** revert; the switch off.

### Step 26 · Alerts go further · P2 S9 · Apr · M (2) · Sonnet
- **Ships (one Worker release, built and tested but not yet pasted):** `notifySchedule`, `schedSeen`
  cleanup, `teamNamedIn` accepting `short` under the capitalised-team-word rule; the client "Tell
  people" checkbox.
- **Needs:** 15, 25.
- **Tests:** `push-worker.test.js` additions and the `tests/push-e2e/` scenarios (run after any
  `worker.js` change).
- **Live check:** none until Step 27.
- **Rollback:** the previous Worker file; the client hides the checkbox on "unknown kind".

### Step 27 · ◆ Phone alerts go live (one Worker paste) · Project 1 go-live + S9 · Apr · S · Owner + Sonnet
- **Ships:** you paste `push-worker/worker.js` into Cloudflare and set its secret (the README is the
  guide); an agent session then sets `PUSH_SERVICE_URL`, adds the Worker's origin to `connect-src`
  in both CSPs (`index.html`, the TV page), bumps the `?v=` list, and verifies the drawer's sender
  line is not "blocked".
- **Needs:** 26.
- **Live check:** the owner and two testers subscribe; an Announcements message buzzes a closed
  phone; a schedule reminder; **Tell everyone → Buzz** reaches a test phone; **a reveal Start buzzes**
  (and a practice run does not); a schedule change from the rain plan offers "Tell people".
- **Rollback:** blank `PUSH_SERVICE_URL` (the feature goes dormant); re-paste the previous Worker.
- **Owner:** 30–45 minutes.

### Step 28 · New-year wizard (owner only) · P2 S8 · Apr · L (3) · Sonnet
- **Ships:** P2 §11.3 in full: the five steps, the claim, hold-to-clear, the verified archive, **Undo
  the new-year setup**, device-local reset on a new epoch, the history filter, the stranded-work
  download. The clear update **also deletes** `reveal`, `revealFull`, `revealScreens` and
  `revealPractice` (§7 item 6).
- **Needs:** 15, 19, 25; placed after 23 (it deletes the reveal nodes and ignores old-epoch reveals).
- **Tests:** `wizard.test.js` (archive verified before any clear; one atomic update with exactly the
  listed paths; no `members/*` in it; claim and take-over; resume at each step; Undo restores data
  and epoch in one update; a stale device is stranded, not applied; **a non-owner's claim and commit
  are refused, in the rules (emulator) and in the app**; a reveal from the old epoch is ignored).
- **Live check:** the owner runs the wizard for **both camps in one sitting**, checks the hub, presses
  **Undo the new-year setup**, confirms everything is back (scores, epoch, history, 2026 bonuses
  doubled again), then leaves it undone until Step 31. **Two precautions for this rehearsal run
  only:** tick "Counselors stay on their teams" (Undo does not put member teams back), and do it
  before anyone has typed real camper names (the clear always removes campers and Undo can't bring
  them back, by design, P2 §7.3). Open ask-to-join requests are also deleted by the clear.
- **Rollback:** Undo the new-year setup; revert.
- **Owner:** 30 minutes (this is the rehearsal that replaces a senior-first trial).

### Step 29 · Senior pass, polish, joint rehearsal · redesign D7 · May · L (3 + the rehearsal) · Opus pass, then Sonnet
- **Ships:** the senior pass (flag marks with a shape per team, empty sections hidden, the 4-team
  bracket on Now), the copy pass, CLAUDE.md's final sections (new nodes, the TV no longer computes,
  the `?v=` list, the motion rules), a Playwright pass of every mockup screen at 360 and 390, both
  themes, both camps, and the contrast audit (7:1 under 16px).
- **Opus pass:** senior visuals and a last look at every drawn screen.
- **Needs:** all builds before it.
- **Rehearsal (both camps, real phones, a real TV):** a full games day on `?now=` including a block
  running over; a reveal with two remotes and a practice run first; a practice run before 8 AM with
  last night's grid still up; a director's phone left alone for a minute mid-reveal; Friday's
  champion celebration; calm motion on and off, a phone in Low Power Mode, a phone with Reduce Motion;
  a counselor on a phone that has been closed all day.
- **Live check:** the rehearsal list above; findings become fixes before Step 31.
- **Rollback:** revert per fix.
- **Owner:** 1–2 hours with two directors and two counselors.

### Step 30 · Tidy up · P2 S10 · May · S · Sonnet
- **Ships:** the replaced classic tabs removed (Notice and Data code now live under the hub), dead
  `pendingRemoteConfig` remnants, the session-heuristic paths for camps already on, CLAUDE.md's final
  pass. The optional F1 fence only if the hub ever shows evidence (P2 §8.6).
- **Needs:** 29. **Tests:** the full suite. **Live check:** curl and a smoke pass. **Rollback:** revert.

### Step 31 · ◆ The new-year setup, both camps · P2 A3 · May · S · Owner
- **Ships:** you run the wizard for junior and senior in one sitting (camp dates when known, what
  carries over with "Counselors stay on their teams" left at No, save 2026, hold to clear), then work
  down each hub checklist with the other
  directors: teams, **Put people on teams**, campers, meals, verses, cleanup rota, electives, the
  notice. Senior's Sunday and Saturday keep their sample days (your answer); the hub shows a quiet
  note, not a warning.
- **Needs:** 28, 29.
- **Rollback:** Undo the new-year setup (14 days).
- **Owner:** an hour for the wizard; the checklists take the directors a few evenings.
- After this the code is frozen except for bug fixes; the deploy freeze applies around the dates.

---------------------------------------------------------------------------------

## 6. Owner actions, in order

| When | Step | What | Time |
|---|---|---|---|
| Nov | 1 | Optional: rename up to three member rows (Alysa, Sofie, Lilly) | 2 min |
| Nov | 3 | Open the app once as a director after the deploy | 30 s |
| Dec | 10 | Nothing, but have a test counselor account, a non-member test account and a second director ready | — |
| Dec | 11 | Paste the rules update (Appendix E blocks 1–4) and run the checks | 30–45 min |
| Jan | 13 | Check the shell on a real iPhone Home Screen app (status bar, tab bar, keyboard, Back, wake lock) | 20 min |
| Feb | 15–16 | Walk through Just Tuesday / Every day like Tuesday; export both camps' data from the console; press **Edit the week here** for junior then senior | 30 min |
| Mar | 20 | Turn on meals, verses, cleanup, electives for both camps | 10 min |
| Mar | 23 | Be there for the reveal check (a screen, two director phones) | 30 min |
| Apr | 25 | Read both camps' `state/teams` ids in Cloud Shell when the agent asks | 2 min |
| Apr | 27 | Paste the Cloudflare Worker and set its secret (`push-worker/README.md`) | 30–45 min |
| Apr | 28 | Run the wizard with "Counselors stay on their teams" ticked, check, and undo it (both camps), before real camper names exist | 30 min |
| May | 29 | The rehearsal: two directors, two counselors, real phones, a real TV | 1–2 h |
| May | 31 | Run the new-year setup for both camps; give the 2027 dates | 1 h |
| Any time | — | Real senior Sunday and Saturday schedules (not needed; the samples stay); team photos or flag photos (optional) | — |

Redesign §18 questions (still open; each has a recommended answer the build follows unless you say
otherwise, and each is needed by the step named): **Q4** the bracket bye reveals who is behind
(recommended: keep the rule, accept the small leak; Step 3, November); **Q1** when directors give
quick points (recommended: two taps from the Games standings; Step 17, February); **Q2** the big
screen needs a signed-in account (recommended: yes) and **Q3** practice runs use made-up points
(recommended: yes) (both Step 23, March).

---------------------------------------------------------------------------------

## 7. Where the two specs touch, and what each step must do about it

1. **One rules publish.** Step 10 writes P2's blocks, the owner-only clauses and the reveal blocks;
   Step 11 publishes them once. Step 23 adds no rules.
2. **The `?v=` list** grows 12 → 13 (Step 2) → 14 (3) → 15 (12) → 17 (14) → 18 (23). Each step updates
   `index.html`, `APP_FILES`, the TV page's references and CLAUDE.md in the same commit.
3. **The TV page** is rewritten once (Step 2), gets its secrecy interim in Step 3, reads `setup/meta`
   in Step 15 and becomes the reveal subscriber in Step 23. It never again computes standings
   itself after Step 23.
4. **Accessors:** from Step 4 on, no renderer reads the old constants. The redesign's `blockKind`
   and `teamMark` are added to the SEAM block by Steps 17 and 13. `seam.test.js` covers the new
   files. From Step 15 the seeded-context re-run covers whichever redesign tests exist, and Steps 17
   and 18 add `now-model` and `games-tab` to it.
5. **The More tab's Director section** is built in Step 13 with only the rows that exist, gains Run the
   reveal (23) and Tell everyone / Award points / Preview (24), re-points Set up the week to the hub
   (14), and swaps Who can sign in for People (25). P2's join badge and bar re-home to the More tab
   and Now's messages strip (P2 §9.4).
6. **The wizard's atomic clear** also deletes `reveal`, `revealFull`, `revealScreens` and
   `revealPractice` (the redesign lists the first three; clearing the practice node too keeps a new
   year empty). Clients already ignore a reveal from another epoch.
7. **`reloadBlocked()`** is extended by several steps (`pendingWritesTotal`, quarantine, the rain plan
   and wizard, `revealBusy`, `composerBusy`); the `sync.test.js` pin is updated each time so it names
   the full union.
8. **The Competitions card** is replaced by the Games tab (Step 18) before P2's S6a (Step 21), so S6a
   skips its home-card part.
9. **Before Step 16** senior's afternoon games and junior's Team Skits don't list under their block
   (today's heuristic); Step 16's A2 attaches them. Steps 17–18 are built after it, and their tests
   still pin the built-in fallback (a camp switched back to the original week), where those games
   stay unattached.
10. **Phone alerts:** Buzz on the remote (Step 23) and in Tell everyone (Step 24) show disabled with a
    reason until Step 27; their payload tests run earlier against `pushSendAlert`.
11. **The counselor spellings** (Step 1) precede every id derived from names (Step 15) and phone alerts.
12. **Owner-only:** Steps 10 (rules), 14 (UI), 15–16, 19–20, 28 each carry owner-only tests; no step
    adds a role.

---------------------------------------------------------------------------------

## 8. Assumptions made here, and what could go wrong

**Ordering choices this plan made (the owner can veto any):**
(a) A1 is pressed in two sittings, schedule first (Step 16) and the other four sections later (Step 20),
because P2 builds it per section; both camps each time. (b) The wizard is rehearsed by running it, undoing
it and leaving it undone until May (Step 28), in place of a senior-first trial; because Undo doesn't
restore member teams or campers, the rehearsal keeps teams and happens before real camper names exist. (c) Phone alerts go live
after S9 so there is one Worker paste (Step 27), which means Buzz is first proven live then. (d) The rules
are published in December, months before the reveal client exists; a small second publish is allowed if
Step 23 finds a flaw. (e) Multi-session steps merge to `main` only when finished (§2.4). (f) Before the switch in Step 16, the
emulator is run on a fresh export of each camp's data, in addition to the seeded trees P2 already requires.

| Risk | Mitigation |
|---|---|
| The rules paste is the one hand step that can stop sync if wrong | emulator both directions on seeded trees of both camps; the runbook backs up first; PUT the backup to undo |
| The shell looks wrong on a real iPhone Home Screen app | the Step 13 device check before anything builds on it; the roof layout doesn't depend on the status-bar outcome |
| A secrecy leak through a path nobody listed | the guard inside every points reader, the sink recorder, early ship (Step 3) so old phones update long before June |
| A1 or the wizard misbehave on real data without a canary camp | restore points per camp, the one-tap way back, fidelity fuzz in both camps, a fresh export run through the emulator first, rehearsal by undo |
| About 80 sessions in seven months with one agent | the cut line in §4; slack in May; steps size-checked at their start and split rather than rushed |
| The owner is needed at five sittings and three device checks | each is short and listed in §6; no build waits on you except at those points |
| Two specs edit the same functions (`renderAll`, `reloadBlocked`, TV page) | one agent at a time, the order in §4, and the seams in §7 |
