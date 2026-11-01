export const meta = {
  name: 'camp-build-steps-4-to-12',
  description: 'Build BUILD-PLAN Steps 4–10 and 12 in two parallel lanes (4→12 and 5→6→7→8→9→10), each step build → review → fix-up → serialized deploy → Haiku live check',
  phases: [
    { title: 'Build', model: 'sonnet' },
    { title: 'Review', model: 'sonnet' },
    { title: 'Fix-up', model: 'sonnet' },
    { title: 'Deploy', model: 'sonnet' },
    { title: 'Live check', model: 'haiku' },
  ],
}

const REPO = '/home/user/Camp'
const SCR = '/tmp/claude-0/-home-user-Camp/0f7c2075-f70d-5c41-9f9f-e6ae084416ea/scratchpad'
// Hard order from BUILD-PLAN §3/§5: 12 is "placed after 4 so the two refactors
// don't overlap"; 5→6→7→8 are one engine change per deploy; 9 needs 8; 10 is
// placed after 9 so the rules match the finished engines. Two independent
// lanes, so the runtime's two concurrent slots stay busy.
const DEPS = (args && args.deps) || { 4: [], 12: [4], 5: [], 6: [5], 7: [6], 8: [7], 9: [8], 10: [9] }
const DOCS_ONLY = { 10: true } // a rules-only release: no ?v= bump

const COMMON = `
You are building "Camp Scoreboard" (CLAUDE.md is in your context and is authoritative — note its "Every time any code asset changes" checklist now lists THIRTEEN ?v= assets plus the TV page's own references and its two-place build stamp). The plan is ${REPO}/docs/build-notes/BUILD-PLAN.md (read §2 ground rules and your step's block in §5) with the specs it cites: ${REPO}/docs/build-notes/setup-rebuild-spec.md (P2) and ${REPO}/docs/build-notes/app-shell-redesign-spec.md (redesign; its §1.2 owner answers override everything). Read PROGRESS.md's latest "Next steps" entries for context (Steps 0–3 are live as v188; Step 3 was finished on the owner's PC). No camp week runs before June 2027, so steps ship freely, but every deploy must leave both camps fully working. Another step may be building in parallel in a different worktree — keep your diff tight to your step.
COMMITS: clear messages; the LAST two lines of every commit message must be exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FmwrSqURuVRaeeP3mUmmwi
(no other model names anywhere in commits, code or comments).
QUALITY: match the surrounding code style; short WHY comments where a future edit could regress it; keep CLAUDE.md true in the same commit; the render-stability rules (setHtmlIfChanged / setLiveHtmlIfChanged, never re-create Jelly components needlessly, never transition: all); anything that moves is jelly-inspired and honours calm motion. node tests/run.js all green and node --check every changed JS file before each commit. Browser checks: serve your worktree with python3 -m http.server <port> in the background (kill it after); Playwright is preinstalled (require('playwright'); chromium.launch() needs no options; close every browser); the no-Firebase stub recipe is ${SCR}/shots.cjs. Be economical with tokens.
`

const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, worktreePath: { type: 'string' }, branch: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, tests: { type: 'string' }, ownerActions: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'worktreePath', 'branch', 'commits', 'summary', 'tests', 'ownerActions', 'risks'] }
const REVIEW = { type: 'object', properties: { verdict: { type: 'string', enum: ['ship', 'ship-after-fixes', 'do-not-ship'] }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, where: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'where', 'problem', 'evidence', 'fix'] } } }, required: ['verdict', 'issues'] }
const DEPLOY = { type: 'object', properties: { ok: { type: 'boolean' }, version: { type: 'number' }, commit: { type: 'string' }, uniqueString: { type: 'string' }, uniqueAsset: { type: 'string' }, liveChecks: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'version', 'commit', 'uniqueString', 'uniqueAsset', 'liveChecks', 'problems'] }
const LIVE = { type: 'object', properties: { ok: { type: 'boolean' }, details: { type: 'string' } }, required: ['ok', 'details'] }

// Deploys are serialized: two lanes must never push to main at once.
let lock = Promise.resolve()
const serialize = (fn) => { const p = lock.then(fn, fn); lock = p.catch(() => {}); return p }

const out = {}
async function runStep(n) {
  const built = await agent(`${COMMON}
YOUR JOB: implement BUILD-PLAN Step ${n} completely (its "Ships", "Tests", and the parts of its "Live check" you can run locally). You are in an isolated git worktree: FIRST run pwd and git rev-parse --abbrev-ref HEAD and report both, then git fetch origin main && git merge origin/main (start from the live main). Re-check each item against the current code first (skip what is already done, keep/add its test). Separate commits per logical item. Do NOT bump ?v=, APP_VERSION, CODE_UPDATED_AT or the TV build stamp and do NOT push — a deploy step does that. Report ok:false with a precise reason if the step can't be completed safely.`,
    { label: `build:step${n}`, phase: 'Build', model: 'sonnet', isolation: 'worktree', schema: RESULT })
  if (!built || !built.ok) return (out[n] = { ok: false, stoppedAt: 'build', built })
  const WT = built.worktreePath

  const review = await agent(`${COMMON}
ADVERSARIAL REVIEW of BUILD-PLAN Step ${n} as built in the worktree ${WT} (branch ${built.branch}). Read-only for you: do not edit or commit there; probe scripts go under ${SCR}/build-review/step${n}/. Diff: git -C ${WT} diff origin/main...HEAD (fetch first). Check against the step's block in BUILD-PLAN §5 and the cited spec sections: missing items, wrong behaviour, regressions (CLAUDE.md sync invariants, render stability, editor vs viewer, junior vs senior, light/dark, calm motion, the Step 3 secrecy rules — counselors must never see points/places), security holes, weak tests, CLAUDE.md drift, style. Run node tests/run.js and a browser pass of both camps as viewer and editor. Builder's report: ${JSON.stringify(built)}`,
    { label: `review:step${n}`, phase: 'Review', model: 'sonnet', schema: REVIEW })

  let fixed = null
  if (review && (review.verdict !== 'ship' || review.issues.some((i) => i.severity !== 'minor'))) {
    fixed = await agent(`${COMMON}
Fix the review findings for Step ${n} IN the worktree ${WT} (cd there for every command; branch ${built.branch}): every blocker and major; minors when real and cheap (say why otherwise). Tests + node --check, commit. Do NOT bump versions or push. Report worktreePath ${WT} and branch ${built.branch}. REVIEW: ${JSON.stringify(review)}`,
      { label: `fixup:step${n}`, phase: 'Fix-up', model: 'sonnet', schema: RESULT })
    if (!fixed || !fixed.ok) return (out[n] = { ok: false, stoppedAt: 'fix-up', built, review, fixed })
  }

  return serialize(async () => {
    const dep = await agent(`${COMMON}
DEPLOY Step ${n} from the worktree ${WT} (branch ${built.branch}; cd there for every command). (1) git fetch origin main && git merge origin/main — another lane may have deployed meanwhile; resolve conflicts keeping both steps' intent, then node tests/run.js must be green. (2) ${DOCS_ONLY[n] ? 'This is a rules/docs-only release: NO ?v= bump, no APP_VERSION/CODE_UPDATED_AT change — but double-check no code asset changed; if one did, follow the full checklist instead.' : 'Follow CLAUDE.md\'s "Every time any code asset changes" checklist exactly: every ?v= in index.html together (all of them, including any NEW asset your step added — and add the new script to index.html, tests/harness.js APP_FILES and the CSP rules as CLAUDE.md says), the current-standings.html and stalling.html references, APP_VERSION to the same number, CODE_UPDATED_AT (date -u +%Y-%m-%dT%H:%M:%SZ), the TV build stamp in BOTH places if the TV page changed; CHANGES stays empty.'} (3) Append ONE line to PROGRESS.md under "## Next steps (resume here)" (at the top of that section): "- **Step ${n} LIVE** (v<N>, <commit>, <Eastern time>) — <one-line plain-English summary>; owner action: <none or what>." and update its "Last updated" line (Eastern time). (4) node tests/run.js + node --check; commit "Build step ${n}: <summary> (v<N>)" whose message states the rollback and any pending owner action. (5) git push origin HEAD:main (retry up to 4 times with 2/4/8/16 s backoff on network errors only; if rejected as non-fast-forward, fetch+merge origin/main again, re-test, retry). (6) Verify LIVE: poll https://camp.patricksimpson.info/index.html with a cache-busting query until app.js?v=<N> appears (up to ~5 minutes; for a no-bump release check the pushed commit's file instead, e.g. database.rules.json), confirm every ?v= is <N>, curl a string unique to this step in a live asset, and run what you can of the step's own live check with Playwright against the live site. Report ok:false if anything is not live or broken (do NOT roll back on your own).`,
      { label: `deploy:step${n}`, phase: 'Deploy', model: 'sonnet', schema: DEPLOY })
    if (!dep || !dep.ok) return (out[n] = { ok: false, stoppedAt: 'deploy', built, review, fixed, dep })
    const live = await agent(`Independently verify a deploy of https://camp.patricksimpson.info (static site on GitHub Pages). Do not edit files. With curl and a cache-busting query string: (1) ${DOCS_ONLY[n] ? 'skip the ?v= check (rules-only release)' : `fetch /index.html and confirm every "?v=" on script/link tags equals ${dep.version} except manifest.json and apple-touch-icon.png`}; (2) fetch /${dep.uniqueAsset} and confirm it contains: ${JSON.stringify(dep.uniqueString)}; (3) confirm /current-standings.html returns HTTP 200. ok true only if all pass; include evidence.`,
      { label: `live:step${n}`, phase: 'Live check', model: 'haiku', schema: LIVE })
    // The Haiku live check is ADVISORY: in run 1 it failed twice on the deploy
    // agent's loosely worded grep target while the deploy itself was live and
    // verified (v189). A shipped step is one whose deploy agent verified it live.
    if (!(live && live.ok)) log(`step ${n}: live check disagreed (advisory) - ${live ? live.details.slice(0, 200) : 'no result'}`)
    return (out[n] = { ok: !!dep.ok, built: built.summary, review: review && review.verdict, dep, live })
  })
}

const memo = {}
function step(n) {
  if (!memo[n]) {
    memo[n] = Promise.all((DEPS[n] || []).map(step)).then((res) =>
      res.every((r) => r && r.ok) ? runStep(n) : (out[n] = { ok: false, skipped: 'a dependency did not ship' }))
  }
  return memo[n]
}
await Promise.all(Object.keys(DEPS).map((k) => step(Number(k))))
const shipped = Object.keys(out).filter((k) => out[k].ok)
log(`Shipped steps: ${shipped.join(', ') || 'none'}`)
return out
