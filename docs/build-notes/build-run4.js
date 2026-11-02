export const meta = {
  name: 'camp-build-step-13',
  description: 'BUILD-PLAN Step 13 (the new shell: tabs, header, More, takeovers): Opus design pass, two Sonnet build sessions, design + function reviews, fix-ups, one deploy',
  phases: [
    { title: 'Design', model: 'opus' },
    { title: 'Build', model: 'sonnet' },
    { title: 'Review' },
    { title: 'Fix-up' },
    { title: 'Deploy', model: 'sonnet' },
    { title: 'Live check', model: 'haiku' },
  ],
}

const REPO = '/home/user/Camp'
const SCR = '/tmp/claude-0/-home-user-Camp/0f7c2075-f70d-5c41-9f9f-e6ae084416ea/scratchpad'
const MOCK = `${REPO}/docs/build-notes/mockups/final`

const COMMON = `
You are building "Camp Scoreboard" (CLAUDE.md is in your context and is authoritative — note its "Every time any code asset changes" checklist, which lists every ?v= asset (fifteen today) plus the TV page's own references and its two-place build stamp). The plan is ${REPO}/docs/build-notes/BUILD-PLAN.md (read §2 ground rules and the Step 13 block in §5) with the specs it cites: ${REPO}/docs/build-notes/app-shell-redesign-spec.md (the redesign; its §1.2 owner answers override everything; Step 13 is its D2: §2 information architecture, §5.5 the game takeover, §6 Chat, §7 More, §8 visual system, §9 motion, §10 calm motion) and ${REPO}/docs/build-notes/setup-rebuild-spec.md (P2). The approved mockups are in ${MOCK} (an .html and a .png of each; Step 13's are 09-more-director, 15-chat-keyboard, 16-more-counselor; the frame — header, blue roof, tab bar — also shows in 01, 02 and 08). Read PROGRESS.md's latest "Next steps" entries for context: Steps 0–10 and 12 are live (v196). Step 11 (the owner publishing the new database rules) has NOT happened yet, so nothing in this step may depend on the R1 rules. No camp week runs before June 2027, so steps ship freely, but every deploy must leave both camps (junior and senior) fully working for counselors (viewers) and directors (editors), and the Step 3 secrecy rule holds everywhere: a counselor never sees points or places outside a reveal.
COMMITS: clear messages, ending with exactly the attribution lines (Co-Authored-By and Claude-Session) your own system reminder gives; no model names anywhere else in commits, code or comments.
QUALITY: match the surrounding code style; short WHY comments where a future edit could regress it; keep CLAUDE.md true in the same commit; the render-stability rules (setHtmlIfChanged / setLiveHtmlIfChanged, never re-create Jelly components needlessly, never transition: all); everything that moves is jelly-inspired (jelly-motion.js presets, redesign §9) and honours calm motion (§10). node tests/run.js all green and node --check every changed JS file before each commit. Browser checks: serve the worktree with python3 -m http.server <port> in the background (kill it after); Playwright is preinstalled (require('playwright'); chromium.launch() needs no options; close every browser); the no-Firebase stub recipe is ${SCR}/shots.cjs. Be economical with tokens.
`

const RESULT = { type: 'object', properties: { ok: { type: 'boolean' }, worktreePath: { type: 'string' }, branch: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, tests: { type: 'string' }, ownerActions: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'worktreePath', 'branch', 'commits', 'summary', 'tests', 'ownerActions', 'risks'] }
const REVIEW = { type: 'object', properties: { verdict: { type: 'string', enum: ['ship', 'ship-after-fixes', 'do-not-ship'] }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, where: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'where', 'problem', 'evidence', 'fix'] } } }, required: ['verdict', 'issues'] }
const DEPLOY = { type: 'object', properties: { ok: { type: 'boolean' }, version: { type: 'number' }, commit: { type: 'string' }, uniqueString: { type: 'string' }, uniqueAsset: { type: 'string' }, liveChecks: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'version', 'commit', 'uniqueString', 'uniqueAsset', 'liveChecks', 'problems'] }
const LIVE = { type: 'object', properties: { ok: { type: 'boolean' }, details: { type: 'string' } }, required: ['ok', 'details'] }
const needsFix = (r) => r && (r.verdict !== 'ship' || r.issues.some((i) => i.severity !== 'minor'))

// 1 — Opus UI pass (BUILD-PLAN §2.2: markup, CSS, layout against the mockups; never engines, rules or tests).
phase('Design')
const design = await agent(`${COMMON}
YOUR JOB: the OPUS UI PASS of BUILD-PLAN Step 13 — the visual and interaction design only (§2.2: markup, CSS, layout against the mockups; you never write engines, rules or tests). You are in an isolated git worktree: FIRST run pwd and git rev-parse --abbrev-ref HEAD and report both, then git fetch origin main && git merge origin/main.
Deliver, against mockups 09, 15, 16 (and the frame in 01/02/08) and redesign §8: the visual system as CSS tokens (type scale, colour roles, space/shape/targets, team identity) including the §8.10 Jelly token mapping that Step 12 deferred (today's --color-* are sourced FROM --jelly-*; re-source them so there is no cycle — read styles.css's token block and vendor/jelly.js's injected tokens first); the header with the blue roof; the bottom tab bar (Now · Games · Chat · More, safe-area aware, every target at least 44×44); More's grouped lists (director and counselor variants as drawn); the sheet frame and the takeover frame (the game takeover's labelled back). Put the static markup in index.html and the styles in styles.css, structured so a Sonnet session can wire behaviour without restyling: name every hook it will need (ids, data- attributes, classes) and list them in your report. You may add the minimum JS needed to see the frame render; leave real behaviour (tab switching, history, deep links, moving the Settings drawer's content) to the next session and say exactly what remains.
Look at the real page and the mockups side by side in Playwright at 360 and 390 px, light and dark, both camps, before you commit. Act as a senior graphic designer with an eye for improvement: where the live page can do better than the mockup within §8's rules, do it and say why; refuse the generic-app habits §8.8 lists (and the usual AI-design tells: gratuitous gradients, glassy cards, everything centred, emoji as decoration, uniform rounded boxes, low-contrast grey text). Motion is jelly-inspired and calm-aware. Keep node tests/run.js green; if a test pin breaks only because markup moved, do not edit the test — list it in your report for the next session. Separate commits per logical piece. Do NOT bump ?v=, APP_VERSION, CODE_UPDATED_AT or the TV build stamp and do NOT push.`,
  { label: 'design:step13', phase: 'Design', model: 'opus', isolation: 'worktree', schema: RESULT })
if (!design || !design.ok) return { ok: false, stoppedAt: 'design', design }
const WT = design.worktreePath
const BR = design.branch
const IN_WT = `Work IN the existing worktree ${WT} (branch ${BR}); cd there for every command and do not create another worktree.`

// 2 — Sonnet wires behaviour and tests, in two sessions so neither runs out of room.
phase('Build')
const buildA = await agent(`${COMMON}
${IN_WT} The Opus UI pass for Step 13 is committed there; its report: ${JSON.stringify(design)}
YOUR JOB (Sonnet session A of Step 13): wire the SHELL BEHAVIOUR on the design's hooks without restyling it: the four roots split by volatility (Now · Games · Chat · More), tab switching with dirty render (a hidden tab does not re-render on every snapshot; it catches up when shown), the sheets-and-takeovers model, the game takeover with its labelled back, Chat as a tab (chat.js's full-screen view becomes the Chat root; keep every chat invariant in CLAUDE.md "Camp chat", including Back closing it and the composer node surviving channel switches), the bottom stack (update bar, toaster, SDK pill — keep their documented order and offsets true, overlays.test.js pins them), keyboard handling (the composer above the keyboard, the tab bar hidden while typing), scroll memory per tab, history and Back (Next replaces, not pushes), deep links (cold load of #now, #games, #chat, #more, game:<id>; reveal and alert:<id> resolve to the right tab), and whether sw.js's notification open targets need the new deep links (if so bump PUSH_SW_VERSION). Now hosts today's banner and live home unchanged inside the new frame. Write tabs.test.js (switching, dirty render, scroll memory, history including Next-replaces and cold deep links) and update the pins that must change in shell, overlays, home, render-stability, game-view, chat, chat-view, sync (name each in the commit message). Re-check each item against the current code first. Separate commits per logical item. Do NOT bump versions or push. If you run short of room, commit what is done and green, and list precisely what is left.`,
  { label: 'build:step13-a', phase: 'Build', model: 'sonnet', schema: RESULT })
if (!buildA || !buildA.ok) return { ok: false, stoppedAt: 'build-a', design, buildA }

const buildB = await agent(`${COMMON}
${IN_WT} The Opus UI pass and Sonnet session A are committed there. Their reports: DESIGN ${JSON.stringify(design)} SESSION A ${JSON.stringify(buildA)}
YOUR JOB (Sonnet session B of Step 13): first finish anything session A listed as left. Then: More absorbs today's Settings drawer (one Alerts row opening push.js's drawer, Appearance inline — theme and Calm motion, "Not you? Change" for sign-out/identity; the Director section holds only what exists now: What counselors see, Set up the week → today's classic builder, Change history, Who can sign in; Run the reveal / Tell everyone / Award points are NOT added — Steps 23–24 add them); the camp switcher stays reachable for dual-camp accounts; **What counselors see** (the six "Hide from viewers" switches move here from the home cards, same state.meta.hiddenCards data, HIDEABLE_CARDS unchanged; the standings switch retires — Step 3's secrecy already governs standings); teamMark keyed images (one helper for a team's crest/flag/emoji tile, keyed so a re-render never re-creates an unchanged image); the home accordion and idle-collapse removed (cards are no longer collapsible); the Home Screen metas (apple-mobile-web-app-*, theme-color following the roof in both themes). Then the Playwright pass the plan requires: every tap target at least 44×44 at 360 and 390 px, at 130% and 200% text, both themes, both camps, as counselor and director — fix what fails (layout fixes stay true to the design; flag anything that needs a design decision instead of inventing one). Update CLAUDE.md for everything Step 13 changed (the tabs, the four roots, More, What counselors see, the moved switches, the bottom stack, deep links, the token mapping) in the same commits. node tests/run.js green and node --check. Do NOT bump versions or push. Report what the owner must check on a real iPhone (BUILD-PLAN Step 13 live check) as ownerActions.`,
  { label: 'build:step13-b', phase: 'Build', model: 'sonnet', schema: RESULT })
if (!buildB || !buildB.ok) return { ok: false, stoppedAt: 'build-b', design, buildA, buildB }

// 3 — Two independent reviews: function (Sonnet) and design (Opus, per the owner's rule).
const reports = JSON.stringify({ design, buildA, buildB })
const [funcReview, designReview] = await parallel([
  () => agent(`${COMMON}
ADVERSARIAL REVIEW (function) of BUILD-PLAN Step 13 as built in the worktree ${WT} (branch ${BR}). Read-only for you: do not edit or commit there; probe scripts go under ${SCR}/build-review/step13/. Diff: git -C ${WT} diff origin/main...HEAD (fetch first). Check against Step 13's block in BUILD-PLAN §5 and the cited spec sections: missing items, wrong behaviour, regressions (CLAUDE.md sync invariants, render stability — a pill flip must not touch the shield, More's volatile lines must not rebuild the segmented controls; chat invariants; reload-blocking; editor vs viewer; junior vs senior; the Step 3 secrecy rule — try hard to make a counselor see a point or a place through any tab, deep link, takeover or More row; history/Back loops; deep links on a cold load; a hidden tab re-rendering on every snapshot), weak or missing tests, CLAUDE.md drift. Run node tests/run.js and a Playwright pass of both camps as viewer and editor. Builders' reports: ${reports}`,
    { label: 'review:step13', phase: 'Review', model: 'sonnet', schema: REVIEW }),
  () => agent(`${COMMON}
DESIGN REVIEW of BUILD-PLAN Step 13 as built in the worktree ${WT} (branch ${BR}), by a senior graphic designer. Read-only for you: do not edit or commit there; screenshots go under ${SCR}/build-review/step13-design/. Compare the live worktree page with mockups 09, 15, 16 (and the frame in 01/02/08) at 360 and 390 px, light and dark, both camps, counselor and director, at 100%, 130% and 200% text: hierarchy, type scale, colour roles and contrast (redesign §8.9), spacing rhythm, alignment, the blue roof and its status-bar colour, the tab bar above the home indicator, More's grouped lists, sheet and takeover frames, empty and long-name states (a long team name, a long counselor name, a 4-team senior roster). Check motion: every change jelly-inspired per redesign §9.5 and fully calm under html.calm-motion and prefers-reduced-motion. Name any generic-app or AI-design habit that crept in (§8.8). Report each issue with a screenshot path and a concrete fix (the CSS or markup change). Builders' reports: ${reports}`,
    { label: 'review:step13-design', phase: 'Review', model: 'opus', schema: REVIEW }),
])

// 4 — Fix-ups: design findings by Opus, then function findings (and any pin a design fix moved) by Sonnet.
phase('Fix-up')
let designFix = null
if (needsFix(designReview)) {
  designFix = await agent(`${COMMON}
${IN_WT} Fix the DESIGN review findings for Step 13 (markup, CSS, layout; never engines, rules or tests): every blocker and major; minors when real and cheap (say why otherwise). Check each fix in Playwright at 360 and 390 px, both themes, both camps. Keep node tests/run.js green; if a pin breaks only because markup moved, list it for the next session instead of editing the test. Commit. Do NOT bump versions or push. Report worktreePath ${WT} and branch ${BR}. REVIEW: ${JSON.stringify(designReview)}`,
    { label: 'fixup:step13-design', phase: 'Fix-up', model: 'opus', schema: RESULT })
  if (!designFix || !designFix.ok) return { ok: false, stoppedAt: 'design fix-up', design, buildA, buildB, funcReview, designReview, designFix }
}
let funcFix = null
if (needsFix(funcReview) || designFix) {
  funcFix = await agent(`${COMMON}
${IN_WT} Fix the FUNCTION review findings for Step 13: every blocker and major; minors when real and cheap (say why otherwise).${designFix ? ` A design fix-up ran first; update any test pin it lists as moved: ${JSON.stringify(designFix)}` : ''} Then re-run the full Playwright pass (44×44 targets at 360/390, 130%/200% text, both themes, both camps, counselor and director) and node tests/run.js + node --check. Commit. Do NOT bump versions or push. Report worktreePath ${WT} and branch ${BR}. REVIEW: ${JSON.stringify(funcReview)}`,
    { label: 'fixup:step13', phase: 'Fix-up', model: 'sonnet', schema: RESULT })
  if (!funcFix || !funcFix.ok) return { ok: false, stoppedAt: 'fix-up', design, buildA, buildB, funcReview, designReview, designFix, funcFix }
}

// 5 — One deploy (Step 13 ships as one deploy: a half-built shell cannot be half-live).
phase('Deploy')
const owner = [].concat(buildB.ownerActions || [], (funcFix && funcFix.ownerActions) || [])
const dep = await agent(`${COMMON}
DEPLOY Step 13 from the worktree ${WT} (branch ${BR}; cd there for every command). (1) git fetch origin main && git merge origin/main; resolve conflicts keeping both sides' intent, then node tests/run.js must be green. (2) Follow CLAUDE.md's "Every time any code asset changes" checklist exactly: every ?v= in index.html together (all of them, including any NEW asset this step added — and add a new script to index.html, tests/harness.js APP_FILES and the CSP rules as CLAUDE.md says), the current-standings.html and stalling.html references, APP_VERSION to the same number, CODE_UPDATED_AT (date -u +%Y-%m-%dT%H:%M:%SZ), the TV build stamp in BOTH places if the TV page changed, PUSH_SW_VERSION if sw.js changed; CHANGES stays empty. (3) Append ONE line to PROGRESS.md under "## Next steps (resume here)" (at the top of that section): "- **Step 13 LIVE** (v<N>, <commit>, <Eastern time>) — <one-line plain-English summary>; owner action: <the real-iPhone check, and anything else>." and update its "Last updated" line (Eastern time). (4) node tests/run.js + node --check; commit "Build step 13: <summary> (v<N>)" whose message states the rollback (revert this one deploy) and the pending owner action (the real-iPhone check: ${JSON.stringify(owner)}). (5) git push origin HEAD:main (retry up to 4 times with 2/4/8/16 s backoff on network errors only; if rejected as non-fast-forward, fetch+merge origin/main again, re-test, retry). (6) Verify LIVE: poll https://camp.patricksimpson.info/index.html with a cache-busting query until app.js?v=<N> appears (up to ~5 minutes), confirm every ?v= is <N>, curl a string unique to this step in a live asset, and run what you can of Step 13's live check with Playwright against the live site (both camps; the four tabs; More; a game takeover and Back; the chat tab; no page errors). Report ok:false if anything is not live or broken (do NOT roll back on your own). In your report, uniqueAsset must be a bare site path such as app.js (no URL, no description) and uniqueString an exact literal substring of that live file (no counts or commentary) — an independent checker greps for it verbatim.`,
  { label: 'deploy:step13', phase: 'Deploy', model: 'sonnet', schema: DEPLOY })
if (!dep || !dep.ok) return { ok: false, stoppedAt: 'deploy', design, buildA, buildB, funcReview, designReview, designFix, funcFix, dep }

phase('Live check')
const live = await agent(`Independently verify a deploy of https://camp.patricksimpson.info (static site on GitHub Pages). Do not edit files. With curl and a cache-busting query string: (1) fetch /index.html and confirm every "?v=" on script/link tags equals ${dep.version} except manifest.json and apple-touch-icon.png; (2) fetch /${dep.uniqueAsset} and confirm it contains: ${JSON.stringify(dep.uniqueString)}; (3) confirm /current-standings.html returns HTTP 200. ok true only if all pass; include evidence.`,
  { label: 'live:step13', phase: 'Live check', model: 'haiku', schema: LIVE })
// Advisory, as in runs 2 and 3: the deploy agent's own live verification decides.
if (!(live && live.ok)) log(`step 13: live check disagreed (advisory) - ${live ? live.details.slice(0, 200) : 'no result'}`)
return {
  ok: true,
  design: design.summary, buildA: buildA.summary, buildB: buildB.summary,
  reviews: { function: funcReview && funcReview.verdict, design: designReview && designReview.verdict },
  fixes: { design: designFix && designFix.summary, function: funcFix && funcFix.summary },
  ownerActions: owner, risks: [].concat(design.risks || [], buildA.risks || [], buildB.risks || [], (funcFix && funcFix.risks) || []),
  dep, live,
}
