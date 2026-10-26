# Build progress — read this first when resuming

Last updated: **Mon Oct 26, ~7:20 PM ET** (update this line every time the file changes)

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

### Project 1 — Phone alerts (Web Push) + reliability hunt — IN PROGRESS
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

### Project 2 — Setup UX rebuild (junior + senior) — NOT STARTED (build after Project 1 ships)
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
State at ~7:20 PM ET Mon:
- ALL verification + both code reviews are DONE. Verdicts + decisions:
  `docs/build-notes/verify/RESULTS*.md`, `REVIEW-worker.md`.
- **Opus fixes DONE** in worktree branch `opus-sync-fixes`
  (`.claude/worktrees/opus-sync`, 3 commits: sync merge safety G1/G2, chat G3,
  alerts app-side hardening + rules endpoint allowlist). Backup of all three
  as a patch on this branch: `docs/build-notes/verify/opus-sync-fixes.patch`
  (`git am` it if the worktree is gone).
- **Sonnet fixer A** (G4/G5/G6/G7 rows in RESULTS.md, RESULTS-G7.md) works
  directly in the MAIN tree on this branch, committing per fix. If it died
  mid-way: check `git status` / RESULTS.md status column, finish the rest.
- **Sonnet fixer B** hardens push-worker/worker.js per REVIEW-worker.md in
  its own worktree (branch `worktree-agent-…`). If lost, re-run from
  REVIEW-worker.md (self-contained).
Then:
1. Merge `opus-sync-fixes` + fixer B's branch into this branch; resolve
   conflicts (app.js applyRemoteConfig: fixer A added `remoteJustApplied =
   true` (rules#2), Opus added the version gate (sync#8) — keep both).
   `node tests/run.js` green; `node --check` all JS.
2. Re-run `tests/push-e2e` (README inside) against the merged worker.js.
3. Docs: CLAUDE.md — auto-reload now waits for unconfirmed writes / laps /
   chat sends (all roles); editorMidEntry is an allowlist; sync invariants
   list: first-snapshot per-path defence, identity-preserving echoes, per-leaf
   drafts, per-field meta; chatAtomicSend serializes (no more "retries
   without the stamp" as the main path); SDK-hash failure no longer "dies at
   Checking sign-in…"; push endpoint host allowlist.
4. Version bump (TWELVE `?v=` + current-standings/stalling refs + APP_VERSION
   + CODE_UPDATED_AT; TV_BUILD if the TV page changed), merge to `main`,
   push, verify live (curl per CLAUDE.md).
5. Owner summary (plain English) + what they must do: Cloudflare setup
   (push-worker/README.md), send us the Worker URL (then set PUSH_SERVICE_URL
   + CSP connect-src), publish database.rules.json (Cloud Shell PUT per
   CLAUDE.md). Report model-use savings.
6. Then Project 2 (setup rebuild) — spec first. Deferred audit items to fold
   in: scoring#3 (config per-field merge), scoring#6 saveGameDraft half,
   rules#5 (owner row), pages#3/#5/#6 (TV page per camp).
