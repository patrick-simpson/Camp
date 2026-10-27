# Build progress — read this first when resuming

Last updated: **Tue Oct 27, 6:15 AM ET** (update this line every time the file changes)

This file is the single source of truth for an in-flight, multi-session build.
If a session stopped (usage limits, container reclaimed), a fresh Claude session
should read this file top to bottom, then continue from **"Next steps"**.
It is committed to the working branch so it survives the container being reset.

- Working branch: **`ccr-b0a70176-9ril2l`** (push progress here; `main` is the
  LIVE site — only finished, verified work goes to `main`, per CLAUDE.md).
- Owner: Patrick (non-programmer; wants plain-English explanations, Eastern time
  only, percent-complete updates with ETAs, one question at a time, haiku/sonnet
  for simple work and opus only for hard parts, and to be told what that saved).

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
- LAYOUT INTERVIEW: Q1 answered → **"What's happening now"** (first screen
  follows the camp day; short standings always right under it). Next: Q2
  (standings visibility; rec "always, except a reveal stretch").

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
