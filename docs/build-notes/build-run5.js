export const meta = {
  name: 'camp-build-steps-14-15-19',
  description: 'BUILD-PLAN Steps 14 → 15 → 19, one step at a time: Opus design pass where the plan names one, Sonnet build sessions, function (Sonnet) + design (Opus) reviews, fix-ups, one deploy and a Haiku live check per step; stops before owner Step 16',
  phases: [
    { title: 'Step 14', detail: 'setup infrastructure (dark) + the hub' },
    { title: 'Step 15', detail: 'schedule as data (switch stays unpressed)' },
    { title: 'Step 19', detail: 'meals, verses, cleanup, electives screens' },
  ],
}

const REPO = '/home/user/Camp'
const SCR = '/tmp/claude-0/-home-user-Camp/0f7c2075-f70d-5c41-9f9f-e6ae084416ea/scratchpad'

const COMMON = (n) => `
You are building "Camp Scoreboard" (CLAUDE.md is in your context and is authoritative — note its "Every time any code asset changes" checklist, which lists every ?v= asset (fifteen before Step 14; Step 14 adds setup-sync.js and setup-ui.js) plus the TV page's own references and its two-place build stamp, and its "The shell frame" section, which documents Step 13's hooks). The plan is ${REPO}/docs/build-notes/BUILD-PLAN.md (read §2 ground rules and the Step ${n} block in §5) with the specs it cites: ${REPO}/docs/build-notes/setup-rebuild-spec.md (P2, the setup rebuild: Steps 14, 15 and 19 are its S4, S5a and S5b; §11 is the screens, §11.0 the director's-clipboard design language, §11.1 the frame) and ${REPO}/docs/build-notes/app-shell-redesign-spec.md (the redesign; its §1.2 owner answers override everything; §8 visual system, §9 motion, §10 calm motion). Read PROGRESS.md's latest "Next steps" entries and the previous step's commit message. State of play: Steps 0–13 are live (v197: the new shell — header, tab bar Now/Games/Chat/More, More with a Director group, sheets and takeovers). Step 11 is DONE: the R1 database rules are published and verified live on both camps (setup/*, editorsHere, campers, accessRequests, restore points, the owner-only setup/meta/on/* switches, …), so this step's code may rely on them. database.rules.json and tests/rules-macros.js are the source of truth and you must NOT change the rules (a change would need the owner to publish again — if you find you need one, stop and report it as a risk). No camp week runs before June 2027, so steps ship freely, but every deploy must leave both camps (junior and senior) fully working for counselors (viewers) and directors (editors); the Step 3 secrecy rule holds everywhere (a counselor never sees points or places outside a reveal); the owner is OWNER_MEMBER_KEY, and owner-only means isOwner(), never anything stored on the device.
COMMITS: clear messages; the LAST two lines of every commit message must be exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FmwrSqURuVRaeeP3mUmmwi
(no other model names anywhere in commits, code or comments).
QUALITY: match the surrounding code style; short WHY comments where a future edit could regress it; keep CLAUDE.md true in the same commit; the render-stability rules (setHtmlIfChanged / setLiveHtmlIfChanged, never re-create Jelly components needlessly, never transition: all); the CLAUDE.md sync invariants (first-pull gates, RTDB pruning heals, never trust a snapshot's shape); everything that moves is jelly-inspired (jelly-motion.js presets, redesign §9) and honours calm motion (§10); every tap target at least 44×44. node tests/run.js all green and node --check every changed JS file before each commit. Browser checks: serve the worktree with python3 -m http.server <port> in the background (kill it after); Playwright is preinstalled (require('playwright'); chromium.launch() needs no options; close every browser); the no-Firebase stub recipe is ${SCR}/shots.cjs (seed localStorage.campScoreboardAuthHint to paint the shell). Be economical with tokens.
`

const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, worktreePath: { type: 'string' }, branch: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, tests: { type: 'string' }, ownerActions: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'worktreePath', 'branch', 'commits', 'summary', 'tests', 'ownerActions', 'risks'] }
const REVIEW = { type: 'object', properties: { verdict: { type: 'string', enum: ['ship', 'ship-after-fixes', 'do-not-ship'] }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, where: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'where', 'problem', 'evidence', 'fix'] } } }, required: ['verdict', 'issues'] }
const DEPLOY = { type: 'object', properties: { ok: { type: 'boolean' }, version: { type: 'number' }, commit: { type: 'string' }, uniqueString: { type: 'string' }, uniqueAsset: { type: 'string' }, liveChecks: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'version', 'commit', 'uniqueString', 'uniqueAsset', 'liveChecks', 'problems'] }
const LIVE = { type: 'object', properties: { ok: { type: 'boolean' }, details: { type: 'string' } }, required: ['ok', 'details'] }
const needsFix = (r) => r && (r.verdict !== 'ship' || r.issues.some((i) => i.severity !== 'minor'))
const START = `You are in an isolated git worktree: FIRST run pwd and git rev-parse --abbrev-ref HEAD and report both as worktreePath and branch, then git fetch origin main && git merge origin/main (the previous step was deployed to main after this worktree was cut; you must build on it).`

const STEPS = [
  {
    n: 14,
    design: `the OPUS UI PASS of BUILD-PLAN Step 14 — the hub ("Set up the week", P2 §11.2: the checklist), the frame around every setup screen (§11.1: entry points, the labelled back, the sync line, the docked undo pill, "also here", the look of askDialog and of the inline "Keep mine / Use his"), and the director's-clipboard language (§11.0). The hub is reached from More → Director → Set up the week (today that row opens the classic week builder; the hub takes over that entry, and the classic builder stays reachable from the hub until later steps replace its sections). There are no mockups for the setup screens: design them from P2 §11 inside redesign §8's visual system (Step 13's tokens in styles.css) so they read as the same app as mockups 09 and 16. Rows whose screens arrive later (Schedule → Step 15, which says "editing comes next" for now; Meals / Verses / Cleanup / Electives → Step 19; Games → Step 21; Teams / People / Campers → Step 25; New year → Step 28) show their state honestly, never as dead buttons; owner-only buttons render only for the owner.`,
    sessions: [
      `the setup ENGINE, dark: setup-sync.js (a NEW classic script: the setup engine, the single persistSetup() gate, restore points and Backups v3, editorsHere presence and "also here", the sync line's state) and isOwner() / ownerName() with the owner-only gating. Wire the new script (and setup-ui.js if the Opus pass already created it) into index.html at the CURRENT ?v= number (the deploy session bumps every number together), into tests/harness.js APP_FILES and into CLAUDE.md's file list and asset count. Re-read P2 S4 and database.rules.json for the exact node shapes and limits (the editorsHere 1 s floor, restore index shape). Tests: setup-sync.test.js, restore.test.js, editors-here.test.js, owner-only.test.js. Nothing writes to the setup nodes unless a director acts (the step is dark), and nothing attaches before membership approval (CLAUDE.md's auth invariant).`,
      `setup-ui.js on the Opus pass's hooks: the hub and its checklist (checklist.test.js), the frame around every setup screen, the docked undo pill (6 s) taking over from Step 9's Undo/Redo toast action (addToastAction in undoRecord / undoEntry — a toast over the builder swallows the next tap), askDialog, and the inline "Keep mine / Use his" of P2 §6.3.5 replacing saveGameDraft's native confirm() for a field both directors changed (the config has no authorship, so messages say "someone"); the sync line and "also here" on the engine session A built; "Save a restore point now" and the restore list. Then the Playwright pass: 44×44 targets at 360 and 390 px, 130% and 200% text, both themes, both camps; a counselor cannot reach the hub by any path (More, deep link, history); director and owner variants differ only where owner-only says. Update CLAUDE.md for everything Step 14 adds (files, nodes, keys, limits, the hub, the undo pill).`,
    ],
    reviewFocus: `the persistSetup gate (nothing written while dark except what a director does), restore points round trip and Backups v3 import refusing the other camp's or a hand-edited file, editorsHere honouring the rules' 1 s floor and the per-member key, isOwner() never trusting the device, owner-only buttons both hidden AND harmless for non-owners, the undo pill vs the toaster and the bottom stack, Keep mine / Use his, the classic builder still working end to end, no listener attached before approval, counselors unable to reach the hub by any path`,
    live: `Step 14's own live check as far as a signed-out machine can go: unauthenticated REST probes (curl https://camp-89cea-default-rtdb.firebaseio.com/<root>/<node>.json) of every node this step reads or writes, both roots, must return Permission denied; Playwright on the live site with the hint-painted shell (Firebase blocked): More → Director → Set up the week opens the hub for an editor and is absent for a viewer, both camps, no page errors. "Save a restore point now" on both camps and "two directors in the hub see each other" need real sign-ins — list them as owner checks.`,
  },
  {
    n: 15,
    design: `the OPUS UI PASS of BUILD-PLAN Step 15 — the Schedule screen (P2 §11.5) and the rain-plan panel with game moves (§11.6), designed for the one-handed moment M2 (find P2's definition of M2); plus the hub rows Step 15 adds (Camp week, Schedule). The approval gate is a tap count: the M2 script on junior Wednesday in a seeded context must take 12 taps or fewer, so design the panel for that. No mockups exist: design inside redesign §8 and the frame Step 14 built.`,
    sessions: [
      `A1 + A2 in code with the switch UNPRESSED. BEFORE changing anything, take "before" screenshots of the LIVE site (https://camp.patricksimpson.info, both camps, viewer and editor, the Now / Games / More tabs and the schedule sheet, 390 px, hint-painted shell with Firebase blocked, a fixed fake clock) into ${SCR}/step15-before/ with the script saved beside them, so the deploy can compare. Then: the seed (the built-in week → setup data, both camps, all 7 days), accessors switching on setup/meta/on/schedule (off ⇒ exactly today's behaviour), the publisher with rev / src, the full-week .ics. Tests: seed.test.js + seed.senior.test.js (round trip of all 7 days, both camps; the 10,080-minute banner fuzz identical before and after seeding; frozen id fixtures; the A2 oracle table) and the seeded-context re-run of the week, push and chat tests plus whichever redesign tests exist (tabs, frame, more, …).`,
      `the Schedule screen and the rain plan with game moves on the Opus pass's hooks; Camp week; the hub rows; schedule-edit.test.js and games-blocks.test.js; the push and .ics additions. Write the M2 tap-count script (junior Wednesday, seeded context), run it and report the count — over 12 means change the panel before you finish. The Playwright pass (44×44 at 360 / 390 px, 130% / 200% text, both themes, both camps, editor and owner; counselors cannot reach it). Update CLAUDE.md. The TV page does NOT read setup/meta (BUILD-PLAN Step 15 says why).`,
    ],
    reviewFocus: `switch off ⇒ byte-identical behaviour on both camps (the Happening now banner over every minute, the schedule sheet, .ics, the push schedule publish), seed fidelity for all 7 days, the rev / src publisher, the rain plan never losing a game, a result or a block, DST edges, the M2 tap count (re-run the script), the owner-only switch, and the seeded-context reruns actually running seeded`,
    live: `code only — the switch is not pressed, so both camps must behave exactly as before: take the same Playwright screenshots of the live site after the deploy with the script in ${SCR}/step15-before/ and compare them to the "before" set (report any pixel difference that is not the build stamp); curl checks.`,
  },
  {
    n: 19,
    design: null,
    sessions: [
      `the P2 §11.10–11.13 screens (Meals, Memory verses, Cleanup rota, Electives — junior only, CAMP.features.electives) inside Step 14's setup frame, reached from the hub, plus the "can now be edited here too" prompt (owner only). Nothing changes on either camp until Step 20 presses the switch: while setup/meta/on/<section> is off, the app reads exactly what it reads today. Match the look of the Step 14 / 15 setup screens exactly (the director's-clipboard language, P2 §11.0; redesign §8) — reuse their components rather than inventing new ones. Tests: sections.test.js (fill-evenly, elective identity with the spellings from S0k via canonicalCounselorName, the meal tag, the verse video through safeVideoUrl). The Playwright pass (44×44, 360 / 390 px, 130% / 200% text, both themes, both camps, editor vs owner vs counselor). Update CLAUDE.md.`,
    ],
    reviewFocus: `switch off ⇒ unchanged behaviour on both camps, the prompt for the owner only, counselor-name spellings, the video sanitizer, electives absent on senior, the hub rows' states`,
    live: `both camps with the hint-painted shell: the four screens open from the hub for an editor; the "can now be edited here too" prompt does not appear for a non-owner editor (the owner-only view needs a real owner sign-in — list it as an owner check); nothing changes for counselors.`,
  },
]

const results = {}
for (const s of STEPS) {
  const P = `Step ${s.n}`
  phase(P)
  const C = COMMON(s.n)
  let design = null
  if (s.design) {
    design = await agent(`${C}
YOUR JOB: ${s.design} This is §2.2's UI pass: markup, CSS and layout only (you never write engines, rules or tests). ${START} Put static markup and styles where the step's files want them (index.html / styles.css, or a new setup-ui.js if the step creates it — wire a new script into index.html at the CURRENT ?v= and into tests/harness.js APP_FILES), structured so a Sonnet session can wire behaviour without restyling: name every hook it will need (ids, data- attributes, classes) and list them in your report, and say exactly what behaviour remains. Look at your screens in Playwright at 360 and 390 px, light and dark, both camps, before you commit. Act as a senior graphic designer with an eye for improvement: refuse the generic-app habits redesign §8.8 lists and the usual AI-design tells (gratuitous gradients, glassy cards, everything centred, emoji as decoration, uniform rounded boxes, low-contrast grey text). Keep node tests/run.js green; if a pin breaks only because markup moved, do not edit the test — list it. Separate commits per logical piece. Do NOT bump ?v=, APP_VERSION, CODE_UPDATED_AT or the TV build stamp and do NOT push.`,
      { label: `design:${s.n}`, phase: P, model: 'opus', isolation: 'worktree', schema: RESULT })
    if (!design || !design.ok) return { ok: false, stoppedAt: `${s.n} design`, results, design }
  }
  const builds = []
  let WT = design && design.worktreePath
  let BR = design && design.branch
  for (let i = 0; i < s.sessions.length; i++) {
    const first = !WT
    const where = first ? START : `Work IN the existing worktree ${WT} (branch ${BR}); cd there for every command and do not create another worktree.`
    const prior = JSON.stringify({ design, builds })
    const b = await agent(`${C}
${where} ${design || builds.length ? `Earlier sessions of Step ${s.n} are committed there; their reports: ${prior}` : ''}
YOUR JOB (Sonnet session ${i + 1} of ${s.sessions.length} of Step ${s.n}): ${i > 0 ? 'first finish anything an earlier session listed as left. Then: ' : ''}${s.sessions[i]} Re-check each item against the current code first. Separate commits per logical item, each green. Do NOT bump versions or push. If you run short of room, commit what is done and green, and list precisely what is left. Put what the owner must check on a real phone or with a real sign-in in ownerActions.`,
      { label: `build:${s.n}${s.sessions.length > 1 ? String.fromCharCode(97 + i) : ''}`, phase: P, model: 'sonnet', isolation: first ? 'worktree' : undefined, schema: RESULT })
    if (!b || !b.ok) return { ok: false, stoppedAt: `${s.n} build ${i + 1}`, results, design, builds, b }
    if (first) { WT = b.worktreePath; BR = b.branch }
    builds.push(b)
  }
  const IN_WT = `Work IN the existing worktree ${WT} (branch ${BR}); cd there for every command and do not create another worktree.`
  const reports = JSON.stringify({ design, builds })
  const [funcReview, designReview] = await parallel([
    () => agent(`${C}
ADVERSARIAL REVIEW (function) of BUILD-PLAN Step ${s.n} as built in the worktree ${WT} (branch ${BR}). Read-only for you: do not edit or commit there; probe scripts go under ${SCR}/build-review/step${s.n}/. Diff: git -C ${WT} diff origin/main...HEAD (fetch first). Check against Step ${s.n}'s block in BUILD-PLAN §5 and the cited P2 sections: missing items, wrong behaviour, regressions — especially ${s.reviewFocus}; plus CLAUDE.md sync invariants, render stability, reload blocking, editor vs viewer vs owner, junior vs senior, the Step 3 secrecy rule, security (every database string laundered before markup), weak or missing tests, CLAUDE.md drift. Run node tests/run.js and a Playwright pass of both camps as viewer, editor and owner. Builders' reports: ${reports}`,
      { label: `review:${s.n}`, phase: P, model: 'sonnet', schema: REVIEW }),
    () => agent(`${C}
DESIGN REVIEW of BUILD-PLAN Step ${s.n} as built in the worktree ${WT} (branch ${BR}), by a senior graphic designer. Read-only for you: do not edit or commit there; screenshots go under ${SCR}/build-review/step${s.n}-design/. Look at every screen this step adds at 360 and 390 px, light and dark, both camps, editor and owner, at 100%, 130% and 200% text, beside the shipped app (mockups 09 and 16 show the More screen these hang off): does it read as the same app; hierarchy, type scale, colour roles and contrast (redesign §8.9), spacing rhythm, alignment, P2 §11.0's director's-clipboard language, empty / long-name / 4-team senior states, the one-handed reach of primary actions, plain-English labels a non-programmer camp director understands. Motion: jelly-inspired per redesign §9.5 and fully calm under html.calm-motion and prefers-reduced-motion. Name any generic-app or AI-design habit that crept in (§8.8). Each issue with a screenshot path and a concrete fix. Builders' reports: ${reports}`,
      { label: `review:${s.n}-design`, phase: P, model: 'opus', schema: REVIEW }),
  ])
  let designFix = null
  if (needsFix(designReview)) {
    designFix = await agent(`${C}
${IN_WT} Fix the DESIGN review findings for Step ${s.n} (markup, CSS, layout; never engines, rules or tests): every blocker and major; minors when real and cheap (say why otherwise). Check each fix in Playwright at 360 and 390 px, both themes, both camps. Keep node tests/run.js green; if a pin breaks only because markup moved, list it for the next session instead of editing the test. Commit. Do NOT bump versions or push. Report worktreePath ${WT} and branch ${BR}. REVIEW: ${JSON.stringify(designReview)}`,
      { label: `fixup:${s.n}-design`, phase: P, model: 'opus', schema: RESULT })
    if (!designFix || !designFix.ok) return { ok: false, stoppedAt: `${s.n} design fix-up`, results, design, builds, funcReview, designReview, designFix }
  }
  let funcFix = null
  if (needsFix(funcReview) || designFix) {
    funcFix = await agent(`${C}
${IN_WT} Fix the FUNCTION review findings for Step ${s.n}: every blocker and major; minors when real and cheap (say why otherwise).${designFix ? ` A design fix-up ran first; update any test pin it lists as moved: ${JSON.stringify(designFix)}` : ''} Then re-run the Playwright pass and node tests/run.js + node --check. Commit. Do NOT bump versions or push. Report worktreePath ${WT} and branch ${BR}. REVIEW: ${JSON.stringify(funcReview)}`,
      { label: `fixup:${s.n}`, phase: P, model: 'sonnet', schema: RESULT })
    if (!funcFix || !funcFix.ok) return { ok: false, stoppedAt: `${s.n} fix-up`, results, design, builds, funcReview, designReview, designFix, funcFix }
  }
  const owner = [].concat(...builds.map((b) => b.ownerActions || []), (funcFix && funcFix.ownerActions) || [])
  const dep = await agent(`${C}
DEPLOY Step ${s.n} from the worktree ${WT} (branch ${BR}; cd there for every command). (1) git fetch origin main && git merge origin/main; resolve conflicts keeping both sides' intent, then node tests/run.js must be green. (2) Follow CLAUDE.md's "Every time any code asset changes" checklist exactly: every ?v= in index.html together (all of them, including any NEW script this step added — check it is in index.html, tests/harness.js APP_FILES and CLAUDE.md's list, and that CLAUDE.md's count is right), the current-standings.html and stalling.html references, APP_VERSION to the same number, CODE_UPDATED_AT (date -u +%Y-%m-%dT%H:%M:%SZ), the TV build stamp in BOTH places if the TV page changed, PUSH_SW_VERSION only if sw.js changed, manifest.json's own ?v= only if it changed; CHANGES stays empty. (3) Add ONE line to PROGRESS.md at the top of "## Next steps (resume here)": "- **Step ${s.n} LIVE** (v<N>, commit <hash>, <weekday Mon D, h:mm AM/PM ET — use TZ=America/New_York date>) — <one-line plain-English summary a non-programmer understands>; owner action: <none, or exactly what>." and update its "Last updated" line (Eastern time). (4) node tests/run.js + node --check; commit "Build step ${s.n}: <summary> (v<N>)" whose message states the rollback (BUILD-PLAN's Rollback line for Step ${s.n}) and the pending owner actions: ${JSON.stringify(owner)}. (5) git push origin HEAD:main (retry up to 4 times with 2/4/8/16 s backoff on network errors only; if rejected as non-fast-forward, fetch + merge origin/main again, re-test, retry). (6) Verify LIVE: poll https://camp.patricksimpson.info/index.html with a cache-busting query until app.js?v=<N> appears (up to ~10 minutes — GitHub Pages' CDN caches for 10), confirm every ?v= is <N>, curl a string unique to this step in a live asset, then: ${s.live} Report ok:false if anything is not live or broken (do NOT roll back on your own). uniqueAsset must be a bare site path such as app.js and uniqueString an exact literal substring of that live file — an independent checker greps for it verbatim.`,
    { label: `deploy:${s.n}`, phase: P, model: 'sonnet', schema: DEPLOY })
  if (!dep || !dep.ok) return { ok: false, stoppedAt: `${s.n} deploy`, results, design, builds, funcReview, designReview, designFix, funcFix, dep }
  const live = await agent(`Independently verify a deploy of https://camp.patricksimpson.info (static site on GitHub Pages; its CDN can lag up to 10 minutes — retry for up to 10 minutes before failing). Do not edit files. With curl and a cache-busting query string: (1) fetch /index.html and confirm every "?v=" on script/link tags equals ${dep.version} except manifest.json and apple-touch-icon.png; (2) fetch /${dep.uniqueAsset} and confirm it contains: ${JSON.stringify(dep.uniqueString)}; (3) confirm /current-standings.html returns HTTP 200. ok true only if all pass; include short evidence.`,
    { label: `live:${s.n}`, phase: P, model: 'haiku', schema: LIVE })
  if (!(live && live.ok)) log(`step ${s.n}: live check disagreed (advisory) - ${live ? live.details.slice(0, 200) : 'no result'}`)
  results[s.n] = {
    design: design && design.summary, builds: builds.map((b) => b.summary),
    reviews: { function: funcReview && funcReview.verdict, design: designReview && designReview.verdict },
    fixes: { design: designFix && designFix.summary, function: funcFix && funcFix.summary },
    ownerActions: owner,
    risks: [].concat((design && design.risks) || [], ...builds.map((b) => b.risks || []), (designFix && designFix.risks) || [], (funcFix && funcFix.risks) || []),
    dep, live,
  }
  log(`Step ${s.n} live as v${dep.version} (${dep.commit})`)
}
return { ok: true, results }
