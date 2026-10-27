export const meta = {
  name: 'camp-glitch-fixes-sequential',
  description: 'Finish the glitch fixes ONE agent at a time on Sonnet: finish 2 interrupted fixers, then review → fix-up each group',
  phases: [
    { title: 'Finish', detail: 'builder + boot-theme fixers continue in their worktrees', model: 'sonnet' },
    { title: 'Review', detail: 'one skeptic per group, sequential', model: 'sonnet' },
    { title: 'Fix-up', detail: 'address review findings in the same worktree', model: 'sonnet' },
  ],
}

// Owner asked (2026-10-27): one agent at a time, slow is fine, Haiku/Sonnet
// where possible. Every await below is sequential on purpose — no parallel().

const SCRATCH = '/tmp/claude-0/-home-user-Camp/0f7c2075-f70d-5c41-9f9f-e6ae084416ea/scratchpad'
const WT = '/home/user/Camp/.claude/worktrees'
const GROUPS = [
  { key: 'games-live', wt: `${WT}/wf_de7fc0a9-b11-1`, base: 'cf1a77a', port: 8941, area: 'open game views, Live-now card / Big Board, clocks, boardCelebrate, tally medal pickers, game open/back scrolling, celebration misfires, unguarded renderAll callers, reduced-motion gaps' },
  { key: 'home', wt: `${WT}/wf_de7fc0a9-b11-2`, base: 'cf1a77a', port: 8942, area: 'home panels: now-banner rain hint, toasts, notice board, my electives, standings/catch-up idle rebuilds, points-pulse, announcement composer, day-tab pill' },
  { key: 'overlays', wt: `${WT}/wf_de7fc0a9-b11-3`, base: 'cf1a77a', port: 8943, area: 'schedule sheet, update banner, Members drawer, lock/sign-in screen, Jelly drawer/dialog open/close + backdrops, pickers' },
  { key: 'builder', wt: `${WT}/wf_de7fc0a9-b11-4`, base: 'cf1a77a', port: 8944, area: 'week builder (settings.js), game editor drafts, builderDirty, back/tab-switch, data tab, applyRemoteConfig echo, joy press scale on scroll, return-from-builder rise replay', unfinished: true },
  { key: 'chat', wt: `${WT}/wf_de7fc0a9-b11-5`, base: 'cf1a77a', port: 8945, area: 'Camp Chat (chat.js view/tabs/badges/scrolling/composer/lightbox/open-close, chat CSS)' },
  { key: 'boot-theme', wt: `${WT}/wf_de7fc0a9-b11-6`, base: '0880b0b', port: 8946, area: 'boot paint/CLS, :not(:defined) fallbacks, boot-guard.js, applyTheme + OS flips + theme-color meta, jelly-failed fallback, Google Fonts loading, current-standings.html sign-in overlay', unfinished: true },
]

const RULES = `
CONTEXT: "Camp Scoreboard" (CLAUDE.md is in your context — obey it: sync invariants, render-stability (setHtmlIfChanged; never re-create Jelly components when nothing changed; never transition: all), canEdit/roles, two camps). A Playwright sweep found glitches; each finding in your group file was re-verified by a skeptic ("verdict.refinedFix" is the skeptic's tested recommendation).
SCOPE: only your group's findings; keep the diff tight (five other groups' branches get merged with yours). Deferred, do not touch: moving the game view out from below the home accordion, the builder's overall layout (both are being redesigned), and do NOT remove the joy layer / sparkles / confetti / emoji (owner wants to keep them) — only stop misfires. Do NOT bump ?v=, APP_VERSION or CODE_UPDATED_AT, do NOT edit CLAUDE.md or PROGRESS.md, do NOT push. Commit only in YOUR worktree (cd there for EVERY command; never touch /home/user/Camp itself). Commit message trailer: "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" (exactly that line; no other model names anywhere).
Code style: match the surrounding code; short comments that explain WHY where a future edit could regress it. Tests: state-level tests in tests/ where testable; "node tests/run.js" must be all green; "node --check" every changed JS file. Browser proof: serve your worktree with python3 -m http.server <port> (background; kill it when done) and re-run the repro probes (copy from ${SCRATCH}/hunt/ into ${SCRATCH}/fix/<group>/, point at your port). Playwright is preinstalled (require('playwright'); chromium.launch() needs no options); close every browser. Be economical: the owner is watching usage — no exploratory sweeps beyond your findings.
`

const FIXED_SCHEMA = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    results: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['fixed', 'partially-fixed', 'not-fixed', 'not-needed'] }, what: { type: 'string' }, proof: { type: 'string' } }, required: ['id', 'status', 'what', 'proof'] } },
    testsPassed: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['commits', 'results', 'testsPassed', 'risks'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, where: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'where', 'problem', 'evidence', 'fix'] } },
    notActuallyFixed: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['ship', 'ship-after-fixes', 'do-not-ship'] },
  },
  required: ['issues', 'notActuallyFixed', 'verdict'],
}

const out = []

phase('Finish')
for (const g of GROUPS.filter((x) => x.unfinished)) {
  const r = await agent(`${RULES}
RESUMING INTERRUPTED WORK for group "${g.key}" (${g.area}). A previous fixer was stopped mid-way. Work ONLY in the git worktree ${g.wt} (branch ${'worktree-' + g.wt.split('/').pop()}). It holds that fixer's partial work (commits since ${g.base} and/or UNCOMMITTED changes — read "git -C ${g.wt} log ${g.base}..HEAD" and "git -C ${g.wt} diff" first), keep what is correct, fix what is wrong, finish every remaining finding in ${SCRATCH}/fix-groups/${g.key}.json, then commit. Browser port: ${g.port}. Return per-finding status with proof.`,
    { label: `finish:${g.key}`, phase: 'Finish', model: 'sonnet', schema: FIXED_SCHEMA })
  out.push({ group: g.key, finish: r })
  log(`finished ${g.key}: ${r ? r.results.filter((x) => x.status === 'fixed').length + ' fixed' : 'agent failed'}`)
}

for (const g of GROUPS) {
  const review = await agent(`${RULES}
You are an ADVERSARIAL REVIEWER for fix group "${g.key}" (${g.area}). READ-ONLY for the worktree ${g.wt} (do not edit/commit there; probes go under ${SCRATCH}/fix/${g.key}-review/). Review "git -C ${g.wt} diff ${g.base}...HEAD" against ${SCRATCH}/fix-groups/${g.key}.json. Find: glitches that still reproduce (serve the worktree on port ${g.port + 10}, re-run the repros), regressions (stale listeners after a skipped rebuild; selectable jelly-chips toggling their own 'selected'; inputs losing values/focus; closures over replaced state objects; CLAUDE.md sync invariants; editor vs viewer; junior vs senior; light/dark; reduced motion), out-of-scope changes, weak tests, style mismatches. Run node tests/run.js in the worktree. Report real problems with evidence only.`,
    { label: `review:${g.key}`, phase: 'Review', model: 'sonnet', schema: REVIEW_SCHEMA })
  let fixup = null
  if (review && (review.verdict !== 'ship' || review.issues.some((i) => i.severity !== 'minor') || review.notActuallyFixed.length)) {
    fixup = await agent(`${RULES}
You are the fixer for group "${g.key}" (${g.area}). Work IN the worktree ${g.wt} (cd there for every command). An independent reviewer reported the issues below. Fix every blocker/major issue and every finding listed as not actually fixed; fix minor issues when real and cheap, otherwise say why not. Re-run tests and the relevant repros on port ${g.port}, then commit. Findings: ${SCRATCH}/fix-groups/${g.key}.json. REVIEW: ${JSON.stringify(review)}`,
      { label: `fixup:${g.key}`, phase: 'Fix-up', model: 'sonnet', schema: FIXED_SCHEMA })
  }
  out.push({ group: g.key, review, fixup })
  log(`${g.key}: review ${review ? review.verdict : 'failed'}${fixup ? ', fix-up done' : ''}`)
}
return out
