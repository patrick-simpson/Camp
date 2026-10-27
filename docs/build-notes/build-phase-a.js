export const meta = {
  name: 'camp-build-phase-a',
  description: 'Build Steps 1–4 of BUILD-PLAN.md, ONE agent at a time: Sonnet build → Sonnet review → Sonnet fix-up → Sonnet deploy → Haiku live check',
  phases: [
    { title: 'Build', model: 'sonnet' },
    { title: 'Review', model: 'sonnet' },
    { title: 'Fix-up', model: 'sonnet' },
    { title: 'Deploy', model: 'sonnet' },
    { title: 'Live check', model: 'haiku' },
  ],
}

// Owner rules: ONE agent at a time (every await is sequential), Haiku/Sonnet
// where possible (Opus only for design passes — none in Steps 1–4).

const REPO = '/home/user/Camp'
const WT = REPO + '/.claude/worktrees/build'
const SCR = '/tmp/claude-0/-home-user-Camp/0f7c2075-f70d-5c41-9f9f-e6ae084416ea/scratchpad'
const STEPS = (args && args.steps) || [1, 2, 3, 4]

const COMMON = `
You are building "Camp Scoreboard" (CLAUDE.md is in your context and is authoritative). The plan is ${REPO}/docs/build-notes/BUILD-PLAN.md (read §2 ground rules and your step's block in §5), with the specs it cites: ${REPO}/docs/build-notes/setup-rebuild-spec.md (P2) and ${REPO}/docs/build-notes/app-shell-redesign-spec.md (redesign; its §1.2 owner answers override everything). No camp week runs before June 2027, so steps ship freely, but every deploy must leave both camps fully working.
WORKSPACE: ONLY the git worktree ${WT} (branch "build"). cd there for EVERY command. Never edit ${REPO} itself (the orchestrator's checkout) or any other worktree.
COMMITS: clear messages; the LAST two lines of every commit message must be exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FmwrSqURuVRaeeP3mUmmwi
(no other model names anywhere in commits, code or comments).
QUALITY: match the surrounding code style; short WHY comments where a future edit could regress it; keep CLAUDE.md true in the same commit (what the step adds, every new node/key/limit); the render-stability rules (setHtmlIfChanged / setLiveHtmlIfChanged, never re-create Jelly components needlessly, never transition: all); jelly-inspired motion for anything that moves and calm motion respected. Tests: node tests/run.js all green and node --check every changed JS file before each commit. Browser checks: serve ${WT} with python3 -m http.server <port> in the background (kill it after), Playwright is preinstalled (require('playwright'); chromium.launch() needs no options; close every browser); the no-Firebase stub recipe is ${SCR}/shots.cjs. Be economical — the owner watches usage.
`

const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, commits: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, tests: { type: 'string' }, ownerActions: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'commits', 'summary', 'tests', 'ownerActions', 'risks'] }
const REVIEW = { type: 'object', properties: { verdict: { type: 'string', enum: ['ship', 'ship-after-fixes', 'do-not-ship'] }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, where: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'where', 'problem', 'evidence', 'fix'] } } }, required: ['verdict', 'issues'] }
const DEPLOY = { type: 'object', properties: { ok: { type: 'boolean' }, version: { type: 'number' }, commit: { type: 'string' }, uniqueString: { type: 'string', description: 'a string unique to this step present in a live asset' }, uniqueAsset: { type: 'string' }, liveChecks: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'version', 'commit', 'uniqueString', 'uniqueAsset', 'liveChecks', 'problems'] }
const LIVE = { type: 'object', properties: { ok: { type: 'boolean' }, details: { type: 'string' } }, required: ['ok', 'details'] }

const log2 = []
for (const n of STEPS) {
  phase('Build')
  const built = await agent(`${COMMON}
YOUR JOB: implement BUILD-PLAN Step ${n} completely (its "Ships", "Tests", and the parts of its "Live check" you can run locally). FIRST: cd ${WT}; git fetch origin main; git merge --ff-only origin/main (the branch must start at the live main; if it can't fast-forward, STOP and report ok:false). Re-check each item against the current code first (v184 already fixed many glitches — skip what is already done, keep/add its test). Make separate commits per logical item. Do NOT bump ?v=, APP_VERSION, CODE_UPDATED_AT or TV_BUILD and do NOT push — a separate deploy step does that. Report ok:false with a precise reason if the step can't be completed safely.`,
    { label: `build:step${n}`, phase: 'Build', model: 'sonnet', schema: RESULT })
  if (!built || !built.ok) { log2.push({ step: n, stoppedAt: 'build', built }); break }

  phase('Review')
  const review = await agent(`${COMMON}
ADVERSARIAL REVIEW of BUILD-PLAN Step ${n} as built in ${WT} (read-only for you: do not edit or commit; probe scripts go under ${SCR}/build-review/step${n}/). Diff: git -C ${WT} diff origin/main...HEAD. Check against the step's block in BUILD-PLAN §5 and the cited spec sections: missing items, wrong behaviour, regressions (sync invariants, render stability, editor vs viewer, junior vs senior, light/dark, calm motion), security/secrecy holes, weak tests, CLAUDE.md drift, style mismatches. Run node tests/run.js and a browser pass of both camps as viewer and editor. Builder's report: ${JSON.stringify(built)}`,
    { label: `review:step${n}`, phase: 'Review', model: 'sonnet', schema: REVIEW })

  let fixed = null
  if (review && (review.verdict !== 'ship' || review.issues.some((i) => i.severity !== 'minor'))) {
    phase('Fix-up')
    fixed = await agent(`${COMMON}
Fix the review findings for Step ${n} in ${WT}: every blocker and major; minors when real and cheap (say why otherwise). Tests + node --check, commit. Do NOT bump versions or push. REVIEW: ${JSON.stringify(review)}`,
      { label: `fixup:step${n}`, phase: 'Fix-up', model: 'sonnet', schema: RESULT })
    if (!fixed || !fixed.ok) { log2.push({ step: n, stoppedAt: 'fix-up', built, review, fixed }); break }
  }

  phase('Deploy')
  const dep = await agent(`${COMMON}
DEPLOY Step ${n} (built and reviewed in ${WT}). (1) cd ${WT}; git fetch origin main; git merge origin/main (absorbs the orchestrator's doc commits; resolve any conflict keeping both). (2) Follow CLAUDE.md's "Every time any code asset changes" checklist exactly: bump every ?v= in index.html together (and any NEW asset the step added — BUILD-PLAN §3 lists the expected asset count), the current-standings.html / stalling.html references, APP_VERSION to the same number, CODE_UPDATED_AT (date -u +%Y-%m-%dT%H:%M:%SZ), TV_BUILD (in BOTH places if Step 2 introduced the comment copy) if the TV page changed, CSP for any new host; CHANGES stays empty. A docs/rules-only step (no code asset changed) gets NO version bump. (3) node tests/run.js + node --check; commit "Build step ${n}: <summary> (v<N>)" whose message also states the rollback and any pending owner action. (4) git push origin HEAD:main (retry up to 4 times with 2/4/8/16 s backoff on network errors only). (5) Verify LIVE: poll https://camp.patricksimpson.info/index.html (cache-busting query) until app.js?v=<N> appears (up to ~5 minutes), confirm every ?v= is <N>, curl a string unique to this step in a live asset, and run the step's own live check where possible with Playwright against the live site (no real sign-in is possible headless; use what is checkable). Report ok:false if anything is not live or broken (do NOT try to roll back on your own — report).`,
    { label: `deploy:step${n}`, phase: 'Deploy', model: 'sonnet', schema: DEPLOY })
  if (!dep || !dep.ok) { log2.push({ step: n, stoppedAt: 'deploy', built, review, fixed, dep }); break }

  phase('Live check')
  const live = await agent(`Independently verify a deploy of https://camp.patricksimpson.info (a static site on GitHub Pages). Do not edit any files. Using curl with a cache-busting query string: (1) fetch /index.html and confirm every "?v=" number on its script/link tags equals ${dep.version} except manifest.json and apple-touch-icon.png (they have their own numbers); (2) fetch /${dep.uniqueAsset}?v=${dep.version} and confirm it contains the text: ${JSON.stringify(dep.uniqueString)}; (3) confirm https://camp.patricksimpson.info/current-standings.html returns HTTP 200. Report ok true only if all three pass, with the evidence.`,
    { label: `live:step${n}`, phase: 'Live check', model: 'haiku', schema: LIVE })
  log2.push({ step: n, built, review, fixed, dep, live })
  log(`Step ${n} deployed as v${dep.version} (${dep.commit}); live check ${live && live.ok ? 'passed' : 'FAILED'}`)
  if (!live || !live.ok) break
}
return log2
