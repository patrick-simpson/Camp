# Build progress — read this first when resuming

Last updated: **Tue Oct 27, 1:40 PM ET** (update this line every time the file changes)

This file is the single source of truth for an in-flight, multi-session build.
If a session stopped (usage limits, container reclaimed), a fresh Claude session
should read this file top to bottom, then continue from **"Next steps"**.
It is committed to the working branch so it survives the container being reset.

- Working branch: **`ccr-b0a70176-9ril2l`** (push progress here; `main` is the
  LIVE site — only finished, verified work goes to `main`, per CLAUDE.md).
- Owner: Patrick (non-programmer; wants plain-English explanations, Eastern time
  only, percent-complete updates with ETAs, one question at a time, haiku/sonnet
  for simple work and opus only for hard parts, and to be told what that saved).
- **MODEL RULES (owner, 2026-10-27):** ONE agent at a time (slow is fine; avoid
  usage overage). Haiku/Sonnet for mapping, fixing, checking, reviewing.
  **Any actual DESIGN work (layouts, visual design, mockups, the redesign
  spec's design decisions) must be done by OPUS, "with an eye for
  improvement"** — i.e. don't just transcribe the mockups; push them further.
- **MOTION RULE (owner, 2026-10-27): "All changes and animations in page
  should be jelly inspired."** Every state change (a panel appearing, a tab
  switch, a score/place updating, the reveal ladder filling, sheets opening,
  toasts, banners) should move like the Jelly UI components: springy,
  squishy, physical (overshoot + settle, squash on press), consistent with
  vendor/jelly.js's springs — not plain fades/slides. Still honour
  prefers-reduced-motion, still never re-animate when nothing changed
  (render-stability), and keep the joy layer. The Opus redesign must define
  one shared jelly motion system (tokens/curves/helpers) and show the owner a
  live motion sample before building. After the v184 merge, sweep any NEW
  transitions the glitch fixers added (e.g. backdrop/dialog fades) onto it.
- **BATTERY SAVER ⇒ REDUCED MOTION (owner, 2026-10-27; chose "auto-detect +
  manual switch").** Browsers expose no battery-saver flag, so: one
  `calmMotion()` source of truth = prefers-reduced-motion OR a detected
  power-save signal OR the user's switch. Signals: (1) frame-rate sample —
  iOS Low Power Mode and Chrome Energy Saver cap requestAnimationFrame at
  ~30 Hz (sample briefly while idle + on visibilitychange; never during an
  animation); (2) Android Chrome navigator.getBattery(): level ≤ 20% and not
  charging (+ listen for changes); Safari has no Battery API. Settings →
  Appearance gets "Calm motion: Auto / On / Off" (device-local). CSS hook:
  html.calm-motion mirrors the reduced-motion rules; JS (joy layer, confetti,
  Jelly springs via its own motion setting — jelly.js dispatches
  'jelly-motion-change' and reads F() for reduced motion; check whether it
  can be forced) must read calmMotion(). Belongs to the shared jelly motion
  system in the Opus redesign; could ship earlier as its own small step.

---

## The two projects (in order)

### Project 1 — Phone alerts (Web Push) + reliability hunt — ✅ SHIPPED (v182; status table below is historical)
Owner-approved design (from an interview, all confirmed):
- Real notifications when the app is CLOSED, for counselors + directors only.
- No app stores: the existing site installed to the Home Screen (iPhone needs
  "Add to Home Screen", iOS 16.4+). Completely free, NO credit card.
- Sender = a **Cloudflare Worker on the free plan** (owner already has a
  Cloudflare account). Firebase stays on the free Spark plan.
- Alerts: Announcements channel (default on), mentions of you/your team,
  every message in subscribed channels, every schedule block individually
  subscribable (5/10/15 min early, default 10), and director alerts to
  Everyone / one team / directors only, with an **Urgent** toggle.
- Test-alert button: **rotating camp jokes** (owner's pick). **No other easter eggs.**
- Full technical spec: [`docs/build-notes/push-alerts-spec.md`](docs/build-notes/push-alerts-spec.md).
- Also requested: "reliability hunting across the project to make it rock solid".

### Project 2 — Setup UX rebuild (junior + senior) — SPEC IN PROGRESS (workflow wf_65a1aad8-2c6, started 11:10 PM ET Mon)
Owner-confirmed requirements (interview complete, owner said "Yes, that's it"):
- Who: all editors (no new role); laptop for the big setup, phones mid-week,
  several editors at once.
- Shape: **new-year wizard** (copies last year, clears scores, archives last
  year) + a **checklist hub** with ✅/⚠️ per section for everything after.
- Week is always **Sun–Sat**; setup asks "which Sunday does camp start?".
- Schedule: build one **typical day**, copy to Mon–Fri, then per-day one-offs
  ("just this day" / "every day like it"); arrival + send-off days separate.
  Today the schedule is HARD-CODED in `camps.js` — it must become editable data.
- Teams: fixed counts (junior 6, senior 4): name, color from a light/dark-safe
  palette, emoji, optional uploaded photo.
- Counselors: typed roster, trickle-in, and walk-ups requesting access, all
  landing in one team list. **Camper first names** per team, editor-only.
- Also editable (seed from today's `camps.js` data): meal menus, memory verses
  (+ theme), meal cleanup rota, junior electives.
- Games: rebuild to match, games attached to schedule blocks, **finish the
  4-team bracket** so senior can run brackets.
- Curveballs: rain shuffles, two editors at once (per-field merge + "Jenn is
  also here" presence tag), bad Wi-Fi (offline edits sync later).
- Safety: Undo + automatic restore points.
- A mid-week schedule change **alerts subscribers of that block** (uses Project 1).
- Outputs: TV standings page for **both** camps, full-week calendar export.

---

## Status — Project 1

| Step | Status |
|---|---|
| Interview + design | ✅ done |
| Spec written | ✅ `docs/build-notes/push-alerts-spec.md` |
| Reliability hunt: 8 finders done → 50 findings (~38 unique). Workflow stopped (only 2 verifiers at a time on this 4-CPU box); re-verifying with 7 parallel Sonnet agents, batches in scratchpad `verify-G1…G7-*.json` (copy of all findings: `docs/build-notes/reliability-findings.json`) | ⏳ verifying |
| Worker sender build (`push-worker/`) | ✅ merged (commit b00e20b) |
| App side build (`push.js`, `sw.js`, rules, drawer UI) | ✅ merged (commit fbc2647) |
| Merge both halves into the branch | ✅ 312 tests green |
| Add rotating camp jokes to the test alert (Worker `test` payload) | ✅ |
| E2E: real workerd (wrangler dev) + RTDB emulator + mock push service | ✅ all green — saved as `tests/push-e2e/` (opt-in, README inside); FCM accepted real pushes (201) |
| Apply confirmed reliability fixes | ⬜ |
| Independent review pass (Sonnet reviewers, Opus final) | ⏳ 2 Sonnet reviewers running (app side + Worker) |
| Docs: CLAUDE.md "Phone alerts" section + file list + TWELVE `?v=` assets | ✅ |
| Version bump (all `?v=` + APP_VERSION + CODE_UPDATED_AT) | ⬜ |
| Push to `main`, verify live (curl checks in CLAUDE.md) | ⬜ |
| Owner sets up the Cloudflare Worker (guide in `push-worker/README.md`) | ⬜ owner |
| Set `PUSH_SERVICE_URL` in `push.js` + add the Worker host to the CSP `connect-src` in `index.html`; publish rules (Cloud Shell PUT per CLAUDE.md) | ⬜ needs owner's Worker URL |

ETA (said to owner at 5:28 PM ET): Project 1 live ~9:15 PM ET Mon; Project 2 ~6 PM ET Tue (could slip).
**Owner warned at 6:09 PM ET they're about to run out of usage.** A self-wake is
scheduled for **9:50 PM ET Mon** (trigger `trig_01EaQMRZwnHyXMZjAvkVmBFX`, a
send_later into this session). ETAs above shift by however long the pause lasts.

---

## Key facts discovered (don't re-derive)

- Cloudflare free plan: **50 subrequests and 10 ms CPU per invocation**
  (HTTP and cron alike); 5 cron triggers/account. Web Push encryption measured
  ~0.6–0.8 ms/recipient in Node (native is ~5× faster) ⇒ cap 20 sends per
  invocation, overflow goes to an outbox drained by `/drain` (client fires it
  immediately) and by the every-minute cron (backstop).
- Fetching your own workers.dev URL from inside a Worker fails (error 1042)
  without a compat flag — that's why fan-out is client-assisted + cron.
- Apple requires `aes128gcm` + VAPID; must always show a notification for
  every push (silent pushes get the permission revoked).
- Test bench: saved in the repo as `tests/push-e2e/` (README inside has the
  exact commands). Notes:
  - `npm i wrangler@4 web-push@3 firebase-tools@13` in a scratch dir.
  - RTDB emulator: `npx firebase emulators:start --only database --project camp-89cea`
    with the repo's `database.rules.json`. Rules are enforced on namespace
    **`camp-89cea-default-rtdb`** (the Worker's FIREBASE_DB_URL keeps `?ns=` on every request).
    Admin = header `Authorization: Bearer owner`.
  - Headless Chromium can NOT subscribe to push; **headful under `xvfb-run`
    CAN** (gets a real FCM endpoint). FCM accepted our VAPID push with 201, but
    delivery back to the browser doesn't arrive in this sandbox (blocked MCS
    port) — so correctness of encryption is proven by independent node:crypto
    decryption (mock push service in `tests/push-e2e/lib.mjs`), and VAPID by FCM's 201.
- Local-only git exclude: `.claude/worktrees/` is in `.git/info/exclude`
  (builder worktrees must never be committed).

## Next steps (resume here)
**v183 LIVE (10:06 PM ET Mon, commit 554fbe1)** — owner reported "progress bars
keep reloading" + asked to look for other animation glitches. Fixed: home
panels no longer rebuild when nothing changed (`setHtmlIfChanged`), the
now-banner bar is nudged in place, day tabs refresh panels in place, team
shield kept, Members drawer no longer flashes to skeleton bars on each edit,
no more `transition: all`. 436 tests. Owner ALSO asked "should the whole page
layout be rethought — does it make sense?" → assessment given (scoreboard is
buried in a collapsed row; Happening Now is half the screen; six look-alike
rows; viewer and editor share one layout though their jobs differ). Layout
INTERVIEW in progress (one question at a time) — record answers here as they
come. A home-layout redesign likely folds into Project 2.

**11:00 PM ET — deep sweep running (ultracode on).** Workflow run
`wf_68e0e1aa-cac` (script under ~/.claude/projects/-home-user-Camp/…/workflows/
scripts/camp-glitch-sweep-and-layout-review-wf_68e0e1aa-cac.js): 6 Sonnet
glitch finders (home-live, games, overlays, builder, chat, boot-theme-pages)
each followed by a Sonnet adversarial verifier, plus a 4-lens layout panel
(counselor, director, visual design, IA) → synthesis with an ORDERED owner
interview. Reference screenshots: scratchpad/shots/*.png (shots.cjs). If the
session died mid-run: resume with Workflow({scriptPath, resumeFromRunId}).
**11:10 PM ET — Project 2 spec workflow running in parallel** (owner: "also
resume your previous work"): run `wf_65a1aad8-2c6` (script
camp-setup-rebuild-spec-wf_65a1aad8-2c6.js in the same scripts dir): 5 Sonnet
code mappers → 3 independent drafts (data-first / editor-first /
migration-first) in docs/build-notes/p2-drafts/ → 3 judges → unified spec at
docs/build-notes/setup-rebuild-spec.md → 3 adversarial reviews → revision with
a "Decisions for the owner" list (ask ONE at a time, after the layout Qs).
**6:10 AM ET Tue — container restarted overnight; state recovered.**
- Project 2 spec DONE: docs/build-notes/setup-rebuild-spec.md (3,613 lines; 48
  review findings all accepted; stages S0,T,S1–S10,R1). 13 owner decisions
  (Q1 "any camp week before June 2027?" first) — ask AFTER the layout questions.
- Fix workflow hit the session limit: games-live/home/overlays/chat fixers
  finished (worktrees .claude/worktrees/wf_de7fc0a9-b11-{1,2,3,5}, NOT yet
  reviewed); builder fixer cut off mid-work (uncommitted in -4); boot-theme
  never ran. Resumed as task wpddg2lwq (same run id; builder continues in -4).
  When done: SQUASH-merge each branch into main (fixer commit trailers name the
  wrong model — squash keeps them out of history), resolve conflicts, tests,
  v184, push, verify live.
- LAYOUT INTERVIEW answers so far:
  - Q1 first screen → **"What's happening now"** (follows the camp day).
  - Q2 standings (owner's own words): counselors see standings ONLY while the
    directors reveal them on the big screen, and for 5 minutes after; then they
    hide. Standings not yet revealed on the big screen must never show.
    Follow-ups answered:
    - Hide ALL points and places from counselors (team card place/points,
      "+7" pop-ups, catch-up hint); game MEDAL WINNERS stay visible on finished
      games (they watched it happen).
    - During a reveal, phones KEEP PACE with the TV place by place (6th→1st);
      unrevealed places show as "still to come".
    - Directors (editors) see everything, always.
    - Big-screen page: anyone may open it, but NO PEEKING — outside a reveal it
      waits ("Waiting for the directors…"); during a director-run reveal it
      mirrors. ⇒ the director's TV must publish reveal progress (frozen
      standings + revealed count + start/finish times) to Firebase.
    - Assumed (tell owner): the 5 minutes count from when 1st place is shown;
      hiding is in-app (medal winners are visible, so points can't be truly
      secret anyway).
  - Q3 navigation → **bottom tabs**; tab set → **Now · Games · Chat · More**
    (Now becomes the live reveal during one; directors find live standings
    at the top of Games; More = schedule, verse, cleanup, quick points,
    settings).
  - Q4 → **same tabs for everyone + director tools**: Score buttons on game
    rows for directors; a Director section at the top of More (tell everyone,
    award points, what counselors see, set up the week).
  - Q5 scorekeeping → **it varies** (Score on every row + "Next game →"
    after saving; maybe remember "my game").
  - Q6 games block → **this block's games + status** (Not started/Live/Done,
    place; directors get Score; counselors see live score + medal winners).
  - Q7 electives → **my station first** (now + next; "Who's where ›";
    directors see the full list open).
  - Q8 → **at their moment + in More** (after a meal: cleanup teams + award
    buttons; Bible study: the verse; all three also under More).
  - Q9 → **one "Tell everyone" button** (Director section: message + banner
    duration / buzz phones (+urgent) / pin as the big notice).
  - Q10 emoji → **teams, stations, schedule only** (plain words elsewhere).
  - Q11 motion → **KEEP IT ALL** (sparkles on taps, confetti on saves) —
    only stop misfires.
  - Q12 → **phones only** (no wide/TV layouts beyond the reveal + setup).
  - Q13 senior → **same layout, empty parts hidden** (flag colors + optional
    team photo).
  LAYOUT INTERVIEW COMPLETE.
- PROJECT 2 OWNER DECISIONS (spec §17; ★ = differs from the spec's default):
  1. No camp week before June 2027 (still want 2027 dates later).
  2. ★ Rollout: BOTH camps at the same time (not senior-first).
  3. New year: take every counselor off their team.
  4. Camper first names: wiped each new year; directors only.
  5. Walk-ups: "Ask to join" (only while a director switches asking on);
     approved as Counselor unless the director picks Director.
  6. ★ New-year setup + "edited here / original week" switch: ONLY THE OWNER
     (patricksimpson.fx@gmail.com key), not any director.
  7. Restore points: scores only if "Also restore scores" is ticked.
  8. Senior 4-team bracket: the Legacy Game each day.
  9. 3rd-place match BEFORE the final.
  10. ★ Senior Sunday/Saturday: KEEP THE SAMPLE days for now.
  11. Double points: same as 2026 (Thu 5 PM → end of Fri).
  12. Champion celebration: Friday.
  13. ★ Spellings: MERGE — Sofie→Sofia, Lilly→Lily, Alysa→Alyssa everywhere.
  NEXT: fold these + the layout answers into one build plan (redesign spec on
  top of the P2 seam), clickable mockups for owner approval, then build.
- **6:30 AM ET — design workflow `wf_a35b1828-746` running** (script
  camp-app-shell-redesign-spec-wf_a35b1828-746.js): 2 Sonnet mappers → 3
  designs (glance / director / buildable) each with spec + phone mockups
  (scratchpad/mockups/<angle>/) → 3 judges → docs/build-notes/
  app-shell-redesign-spec.md + final mockups (scratchpad/mockups/final/) →
  3 reviews (secrecy, stability, sunlight) → revise + update P2 spec §17 with
  the owner's answers + docs/build-notes/BUILD-PLAN.md. THEN: show the owner
  the final mockups for approval (one question at a time) before building.
- **6:35 AM ET — OWNER CHANGED THE PLAN:**
  - NEW REQUIREMENT: directors run the reveal from their PHONE as a remote
    control (like https://awana.kvbchurch.org/journey/remote/ — screenshots in
    scratchpad/ref/), in sync with the big screen. Show the owner a couple of
    MOCKUPS before implementing anything.
  - Run ONE AGENT AT A TIME (slow is fine; avoid usage overage). Use Haiku and
    Sonnet where possible.
  - So: stopped the design workflow (wf_a35b1828-746, only mappers had run) and
    the fix workflow. Worktree state: games-live(-1), home(-2), overlays(-3),
    chat(-5) fixes committed; builder(-4) uncommitted partial; boot-theme(-6)
    partial (commits + uncommitted). Sequential Sonnet script ready:
    scratchpad/fix-sequential.js (finish builder + boot-theme, then
    review→fix-up per group, strictly one agent at a time).
  - One Sonnet agent is making the reveal-remote mockups (2 directions A/B +
    counselor mirror + More/Director) into scratchpad/mockups/remote/.
  - Order from here: mockups → owner picks → run fix-sequential.js → merge,
    v184 → redesign spec (sequential, Sonnet-heavy) incl. the remote.
- **REVEAL REMOTE — owner decisions (mockups saved in docs/build-notes/
  mockups/remote/, generator _build.js):**
  - Pick: **B's layout ("Stage remote": live mini copy of the TV on top, a
    ladder of places filling in, one huge thumb-zone "Reveal 3rd place"
    button, private "only on this phone" up-next preview) in A's LIGHT
    colors** (light page, chunky physical buttons, camp blue header, gold
    primary). Reachable from More → Director → "Run the reveal".
  - ★ CHANGED RULE: after a place is revealed, counselors can see the FULL
    revealed score grid until **8 AM camp time the next day** (replaces the
    5-minute window). They see the grid frozen at the reveal, never live
    points. Before/while a reveal runs: only places already revealed.
  - Defaults I chose (tell owner): Back steps the TV back one place (places
    already shown stay shown on phones); "End reveal early" keeps whatever was
    revealed until 8 AM; a new reveal replaces the previous one; any director
    can run the remote; the TV page with no reveal says "Waiting for the
    directors…".
- **~1:30 PM ET — OWNER APPROVED the redesign ("Yes, this is it").** Answers
  to the designer's questions: no quick-points moment on Now; ★ big-screen
  page PUBLIC (no TV sign-in; a public node with only revealed data);
  ★ practice uses REAL standings on the real big screen, tagged Practice, no
  pairing (owner accepts anyone opening the public page could see it; phones
  never mirror practice; never buzzes); keep the bracket bye rule (junior
  6-team bracket). Recorded at the top of the spec's §1.2. NEXT: one Sonnet
  agent folds these into the spec's reveal sections + rules + BUILD-PLAN,
  then build per BUILD-PLAN one agent at a time, deploying each step live,
  pausing at owner-action steps (◆).
- **12:49 PM ET — redesign spec run DONE.** docs/build-notes/
  app-shell-redesign-spec.md (2,337 lines; 56 critic findings, 54 accepted
  as written, 2 accepted with an owner-decision-preserving fix; Review log
  at end), docs/build-notes/BUILD-PLAN.md (31 steps, Nov 2026 → May 2027,
  owner actions listed), setup-rebuild-spec.md §17 updated with the 13
  answers. Final mockups + motion-demo.html copied to docs/build-notes/
  mockups/final/. Designer's 4 open questions: quick-points moment on Now
  (rec: no), big screen needs a sign-in (rec: yes), practice runs made-up
  points (rec: yes), bracket bye rule small leak (rec: keep). NEXT: show the
  owner the mockups + demo, approval one question at a time, then build
  step by step per BUILD-PLAN (one agent at a time).
- **10:10 AM ET — redesign spec run `wf_b47e2dfe-4f9`** (script
  camp-redesign-spec-sequential-wf_b47e2dfe-4f9.js; strictly ONE agent at a
  time): Sonnet map:shell → Sonnet map:reveal → OPUS design:lead (spec at
  docs/build-notes/app-shell-redesign-spec.md + mockups + interactive jelly
  motion demo in scratchpad/mockups/final/) → 3 Sonnet critics → OPUS
  design:revise → Sonnet plan:update (P2 spec §17 + docs/build-notes/
  BUILD-PLAN.md). If interrupted: re-run with resumeFromRunId. THEN: copy the
  mockups + demo into docs/build-notes/mockups/final/, show the owner, ask
  approval one question at a time, then build per BUILD-PLAN (one agent at a
  time; Sonnet builds, Opus for design-sensitive UI).
- **10:00 AM ET — v184 LIVE** (commit 2fe3338; merge 594feaa of
  integrate-v184 = 6 squashed fix groups + 3 integration commits). 560 tests.
  Live check: all 12 assets ?v=184, Inter font loads (media print→all via
  boot-guard), no page errors, sign-in visible, jelly not failed. Fix
  worktrees removed (branches worktree-wf_de7fc0a9-b11-* and integrate-v184
  kept locally). Not live-tested (needs a real sign-in): sync, Members drawer
  two-camp list, push. Known small gap: at 320px with BOTH the SDK-down pill
  and update bar at home, the pill overlaps the bar ~14px.
  NEXT: redesign spec — sequential, design by OPUS (eye for improvement),
  mapping/critique by Sonnet; jelly motion system + battery-saver calm
  motion + reveal remote (B layout in A's light colors; grid visible to
  counselors until 8 AM next day) + all layout answers; mockups + a live
  motion demo for owner approval BEFORE building.
- **9:14 AM ET — sequential fix run DONE** (results: docs/build-notes/
  glitch-fix-results-2026-10-27.json). All 6 groups fixed + reviewed + fixed
  up; worktree branches worktree-wf_de7fc0a9-b11-{1..6}. Known accepted
  leftovers: started brackets / live-tracker entries still rebuild per render
  (their Big Board pulse phase restarts); now-banner bar still re-created on a
  mid-meal team rename; iOS keyboard behaviour only verified in Chromium.
  **9:20 AM ET — one Sonnet agent merging** them into branch integrate-v184
  (worktree .claude/worktrees/integrate-v184), squash per group, CLAUDE.md
  updated, browser smoke. THEN (me): review diff, bump v184 (12 ?v= + TV refs
  + APP_VERSION + CODE_UPDATED_AT), merge to main, push, verify live; then
  move new fades onto jelly motion later (redesign).
- **7:05 AM ET — sequential fix run `wf_c027577c-7ac`** (scratchpad/
  fix-sequential.js, copy in docs/build-notes/): finish builder(-4) +
  boot-theme(-6), then review→fix-up each of the 6 groups, ONE Sonnet agent
  at a time (~13 agents, est. 4–7 h). If interrupted: re-run with
  resumeFromRunId. After: squash-merge the 6 worktree branches → main, tests,
  v184, push, verify live; then the redesign spec (sequential, Sonnet-first).

**1:15 AM ET Tue — sweep DONE**: 95 confirmed glitches (8 high/24 med/63 low)
+ layout verdict "partly" with 13 ordered interview questions. Full result
saved: docs/build-notes/glitch-sweep-2026-10-27.json (`confirmed`, `surfaces`,
`layout.synth.interviewQuestions`). Deferred: game-view-below-accordion (layout
redesign), builder-layout-structure (Project 2).
**1:20 AM ET — fix workflow `wf_de7fc0a9-b11` running** (script
camp-glitch-fixes-wf_de7fc0a9-b11.js): 6 groups (games-live, home, overlays,
builder, chat, boot-theme; files scratchpad/fix-groups/<g>.json), each fixer
in its own git worktree (branch worktree-agent-*) → Sonnet reviewer → fix-up.
NEXT: merge the 6 branches into main, node tests/run.js, bump v184, push,
verify live. Layout interview: ask Q1 of the 13 (one at a time); then the
Project 2 spec's owner decisions.
(older:) After it returns: fix confirmed glitches (one editor of app.js at a time),
tests + node --check, bump v184, push main, verify live; then present the
layout assessment and ask interview Q1 (ONE question at a time).

**Project 1 SHIPPED to `main` at 7:26 PM ET Mon (v182, commit 9adcf24).**
Everything is merged: phone alerts (dormant until the Worker exists), all
verified reliability fixes, the Worker hardening, the sync-review fixes and the
drawer design fixes — 431 tests green, real-browser smoke test clean.
A Haiku agent was verifying the live site at the time of writing; if unsure,
re-run the curl checks in CLAUDE.md (expect `?v=182`, `firstSnapshotMerge` in
app.js, push.js with blank PUSH_SERVICE_URL, sw.js without a fetch handler).

Still waiting on the OWNER (tell them again if they haven't done it):
1. Set up the Cloudflare Worker — `push-worker/README.md` (≈15 min) — and send
   us its URL. Then: set `PUSH_SERVICE_URL` in push.js, add that exact origin to
   `connect-src` in index.html's CSP, bump ?v=, deploy, verify.
2. Publish `database.rules.json` (Cloud Shell PUT per CLAUDE.md; back up the
   live rules first). Until then, turning alerts on says the rules aren't
   switched on yet; everything else works.
3. After both: on a phone, Settings → Phone alerts → Turn on → Send me a test.

Deferred to Project 2 (fold in there): scoring#3 (config per-field merge),
scoring#6 saveGameDraft half, rules#5 (owner row), pages#3/#5/#6 (TV page per
camp), two-tab unconfirmed-edit limit (REVIEW-sync #10), other `.danger-link`
dark-mode contrast (visual QA note), senior "Red" team short-name mention gap.

**Project 2 (setup UX rebuild, junior + senior) — NEXT.** Requirements are in
"The two projects" above (owner-confirmed). Start by writing a spec like the
push one (docs/build-notes/), get it adversarially reviewed, then build in
stages with tests + Playwright after each, updating this file after each
stage. Big pieces: schedule data model (move camps.js schedules/meals/verses/
cleanup/electives into synced, per-field-merged config with seeding from
today's data), new-year wizard (copy last year → archive → clear scores),
checklist hub, teams (palette color + emoji + optional photo), counselors
(roster / trickle-in / request-access → one team list), camper first names
(editor-only rules!), games attached to schedule blocks + 4-team bracket,
presence tags, Undo + restore points, mid-week schedule change ⇒ push alert,
TV page both camps, full-week calendar export.
