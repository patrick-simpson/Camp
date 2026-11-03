// Step 22: the four-team bracket (senior's Legacy Game) end to end in a real browser, and a junior six-team smoke test.
//
// Reached the way a person reaches it: the page's own renderers and engine (no specimen markup), real taps on the takeover's buttons. No Firebase
// (the stub recipe: the week is seeded in the page, the role is set in the page). Three parts:
//   E2E     senior, a director: Start (suggested by the points) -> Semifinal 1 -> 2 -> 3rd place -> Final -> Results -> Save Result, then Change the
//           result -> Reopen the final -> record it again; Choose different (the pick); Cancel this bracket; the screen survives an idle repaint
//   STATES  every screen at 360 and 390 px, light and dark, 100 / 130 / 200 % text: tap targets under 44x44, sideways scroll, errors; a counselor's
//           game view and Now card with the bracket under way (and a Re-check holding it)
//   JUNIOR  the six-team wizard to a saved result (a smoke test: nothing about it should have changed)
//   node step22-pass.cjs [baseUrl]      (serve the worktree first: python3 -m http.server 8961)
//   SHOTS=1 OUT=<dir> writes screenshots; QUICK=1 runs the e2e only
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://localhost:8961').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/s22/';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const note = (where, what) => { problems.push(where + ': ' + what); console.log('  ✗ ' + where + ': ' + what); };
let checks = 0;
const ok = (cond, where, what) => { checks += 1; if (!cond) note(where, what); };

async function open(browser, { camp = 'senior', role = 'editor', w = 390, scheme = 'light', text = 100, now = '4-1655', team = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 740 : 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: scheme });
  const hint = role === 'counselor' ? 'viewer' : 'editor';
  await ctx.addInitScript(({ camp, hint }) => { try { localStorage.setItem('campScoreboardAuthHint', hint); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp, hint });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?now=' + now + '&cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && typeof setMemberRole === 'function' && !!customElements.get('jelly-switch'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (text !== 100) await page.addStyleTag({ content: 'html{font-size:' + text + '% !important}' });
  await page.addStyleTag({ content: '#sdk-banner,.toast,#toast-stack{display:none!important}' });
  await page.evaluate(({ role, team }) => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const b = [...document.querySelectorAll('#team-picker-overlay button')].find((x) => /Neutral|just cheering/i.test(x.textContent)); if (b) b.click();
    authUser = { email: 'jenn@example.com', emailVerified: true };
    setMemberRole(role === 'counselor' ? 'viewer' : 'editor');
    window.scrollTo = () => {};
    setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
    setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (d) => planForDow(d), CAMP).ops);
    setupReady = true; configReady = true;
    if (team) state.followTeam = team;
    renderAll();
  }, { role, team });
  await page.waitForTimeout(500);
  return { ctx, page, errs };
}

// Everything tappable in the takeover must be a 44px target; nothing may scroll sideways.
const MEASURE = () => {
  const out = { small: [], sideways: false };
  const root = document.getElementById('takeover-game');
  if (!root) return out;
  const shown = (e) => !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  root.querySelectorAll('button, jelly-button, a[href], summary, [role="button"]').forEach((el) => {
    if (!shown(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) out.small.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || '').trim().slice(0, 20) + '"');
  });
  const body = document.getElementById('takeover-game-body');
  out.sideways = document.documentElement.scrollWidth > window.innerWidth + 1 || (body && getComputedStyle(body).overflowX !== 'hidden' && body.scrollWidth > body.clientWidth + 1);
  return out;
};

async function shot(page, name) { if (process.env.SHOTS) await page.screenshot({ path: OUT + name + '.png' }); }
async function measure(page, where, allow) {
  const m = await page.evaluate(MEASURE);
  const small = m.small.filter((s) => !(allow || []).some((a) => s.includes(a)));
  ok(!small.length, where, 'targets under 44px: ' + small.join('; '));
  ok(!m.sideways, where, 'scrolls sideways');
}
const text = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return e ? e.innerText : null; }, sel);
const entry = (page) => text(page, '#entry-area');
const hasSel = (page, sel) => page.evaluate((sel) => !!document.querySelector(sel), sel);
async function tap(page, sel) { const loc = page.locator(sel).first(); await loc.scrollIntoViewIfNeeded().catch(() => {}); await loc.tap(); await sleep(350); }

// Points so the suggestion has something to say: the standings are Gold, Red, Green, Blue (best first).
const SEED_POINTS = () => {
  const g = state.config.games.find((x) => x.format === 'placement' && x.id.startsWith('team-comp-am'));
  state.results[g.id] = { medals: { gold: 't3', silver: 't0', bronze: 't2' }, savedAt: new Date().toISOString() };
  touchData(); renderAll();
};

async function e2e(browser) {
  console.log('E2E senior, a director, 390 light');
  const { ctx, page, errs } = await open(browser);
  await page.evaluate(SEED_POINTS);
  await page.evaluate(() => openGame('legacy-game-d4', { from: 'now' }));
  await sleep(700);
  let t = await entry(page);
  ok(/Run the bracket/.test(t) && /Suggested by the points right now/i.test(t), 'start', 'the Start card suggests the pairs: ' + (t || '').slice(0, 120));
  ok(/Gold Team\s+vs\s+\S+\s+Blue Team/.test(t) && /Red Team\s+vs\s+\S+\s+Green Team/.test(t), 'start', 'best v worst, second v third: ' + (t || '').replace(/\s+/g, ' ').slice(0, 260));
  await shot(page, 'start-suggested'); await measure(page, 'start (suggested)');
  // Choose different, then pick
  await tap(page, '[data-four="choose"]');
  t = await entry(page);
  ok(/Tap the two teams that play Semifinal 1/.test(t), 'pick', 'the pick card shows');
  await tap(page, '[data-four="pick"][data-team="t1"]');
  await tap(page, '[data-four="pick"][data-team="t2"]');
  ok(await hasSel(page, '[data-four="start-pick"]'), 'pick', 'two picks fill the other pair and Start is offered');
  await shot(page, 'start-pick'); await measure(page, 'start (pick)');
  await tap(page, '[data-four="unchoose"]');
  ok(await hasSel(page, '[data-four="start-plan"]'), 'pick', 'Back to the suggestion');
  await tap(page, '[data-four="start-plan"]');
  t = await entry(page);
  ok(/Semifinal 1/.test(t) && await hasSel(page, '.winner-btn'), 'semifinal 1', 'the first match is up: ' + (t || '').slice(0, 100));
  ok(await hasSel(page, '.bracket-steps .wizard-step.active'), 'semifinal 1', 'the step bar says where it is');
  await shot(page, 'semifinal-1'); await measure(page, 'semifinal 1');
  // an idle repaint leaves the screen (and its live tally) alone
  const same = await page.evaluate(() => { const el = document.querySelector('#entry-area .four-entry'); renderAll(); renderAll(); return el === document.querySelector('#entry-area .four-entry'); });
  ok(same, 'semifinal 1', 'an idle repaint kept the same nodes');
  // the live tally: +1 for the first team, in place
  await tap(page, '[data-live="hr-up"]');
  ok(await page.evaluate(() => state.live['legacy-game-d4'] && Object.values(state.live['legacy-game-d4'].hr).reduce((a, b) => a + b, 0) === 1), 'semifinal 1', 'the tally took a point');
  // record: Gold wins Semifinal 1
  await tap(page, '.winner-btn[data-winner="t3"]');
  t = await entry(page);
  ok(/Semifinal 2/.test(t), 'semifinal 2', 'the second semifinal is up: ' + (t || '').slice(0, 80));
  ok(await hasSel(page, '[data-four="undo"]'), 'semifinal 2', 'Undo last match is offered');
  await shot(page, 'semifinal-2'); await measure(page, 'semifinal 2');
  await tap(page, '[data-four="undo"]');
  t = await entry(page);
  ok(/Semifinal 1/.test(t) && !/Completed:/.test(t), 'undo', 'Undo took Semifinal 1 back');
  await tap(page, '.winner-btn[data-winner="t3"]');
  await tap(page, '.winner-btn[data-winner="t0"]'); // semifinal 2 is Red v Green: Red wins
  t = await entry(page);
  ok(/3rd place match/.test(t) && /bronze/.test(t), '3rd place', '3rd place before the final: ' + (t || '').slice(0, 80));
  ok(await page.evaluate(() => [...document.querySelectorAll('#entry-area .winner-btn')].map((b) => b.dataset.winner).sort().join()) === 't1,t2', '3rd place', 'the two semifinal losers play it');
  await shot(page, 'third-place'); await measure(page, '3rd place');
  await tap(page, '.winner-btn[data-winner="t2"]'); // Green takes the bronze
  t = await entry(page);
  ok(/Final/.test(t) && /gold/.test(t), 'final', 'the final: ' + (t || '').slice(0, 80));
  await shot(page, 'final');
  await tap(page, '.winner-btn[data-winner="t3"]');
  t = await entry(page);
  ok(/Game results/.test(t) && await hasSel(page, '#save-bracket-btn'), 'summary', 'the summary offers Save Result: ' + (t || '').slice(0, 80));
  await shot(page, 'summary'); await measure(page, 'summary');
  // Save Result
  await tap(page, '#save-bracket-btn');
  await sleep(500);
  const saved = await page.evaluate(() => ({ r: state.results['legacy-game-d4'], b: state.brackets4['legacy-game-d4'] }));
  ok(saved.r && saved.r.medals.gold === 't3' && saved.r.medals.silver === 't0' && saved.r.medals.bronze === 't2' && !saved.b, 'save', 'gold Gold, silver Red, bronze Green: ' + JSON.stringify(saved.r && saved.r.medals));
  ok(saved.r && saved.r.path && saved.r.path.m && saved.r.path.m.final, 'save', 'the finished bracket is kept on the result');
  t = await entry(page);
  ok(/Gold Team|Gold/.test(t) && await hasSel(page, '#game-change'), 'saved', 'the saved result shows with Change the result');
  await shot(page, 'saved'); await measure(page, 'saved');
  // Change the result -> Reopen the final -> the other team wins it -> Save again
  await tap(page, '#game-change');
  await sleep(600);
  const dlg = await page.evaluate(() => { const d = document.getElementById('ask-dialog'); return d && d.hasAttribute('open') ? d.innerText : null; });
  ok(dlg && /Reopen the final/.test(dlg) && /Start over/.test(dlg) && /Keep it/.test(dlg), 'reopen', 'the question offers all three answers: ' + (dlg || 'no dialog').replace(/\s+/g, ' ').slice(0, 160));
  await shot(page, 'reopen-dialog');
  const small = await page.evaluate(() => [...document.querySelectorAll('#ask-actions button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.width < 43.5 || r.height < 43.5); }).map((b) => b.textContent.trim()));
  ok(!small.length, 'reopen', 'dialog buttons under 44px: ' + small.join(', '));
  await page.locator('#ask-actions button', { hasText: 'Reopen the final' }).first().tap();
  await sleep(600);
  t = await entry(page);
  ok(/Final/.test(t) && await hasSel(page, '.winner-btn') && await page.evaluate(() => !state.results['legacy-game-d4']), 'reopen', 'the final is back and the result is off: ' + (t || '').slice(0, 80));
  await shot(page, 'reopened');
  await tap(page, '.winner-btn[data-winner="t0"]');
  await tap(page, '#save-bracket-btn');
  await sleep(500);
  ok(await page.evaluate(() => state.results['legacy-game-d4'] && state.results['legacy-game-d4'].medals.gold === 't0' && state.results['legacy-game-d4'].medals.silver === 't3'), 'reopen', 'the new final is the result: Red gold, Gold silver');
  // Start over, then Cancel this bracket
  await tap(page, '#game-change');
  await sleep(500);
  await page.locator('#ask-actions button', { hasText: 'Start over' }).first().tap();
  await sleep(600);
  ok(/Run the bracket/.test(await entry(page)) && await page.evaluate(() => !state.results['legacy-game-d4'] && !state.brackets4['legacy-game-d4']), 'start over', 'back at the Start card with nothing left');
  await tap(page, '[data-four="start-plan"]');
  await tap(page, '[data-four="cancel"]');
  await sleep(500);
  const ask2 = await page.evaluate(() => { const d = document.getElementById('ask-dialog'); return d && d.hasAttribute('open') ? d.innerText : null; });
  ok(ask2 && /Cancel this bracket\?/.test(ask2), 'cancel', 'Cancel this bracket asks first: ' + (ask2 || 'no dialog').replace(/\s+/g, ' ').slice(0, 100));
  await page.locator('#ask-actions button', { hasText: 'Cancel the bracket' }).first().tap();
  await sleep(600);
  ok(await page.evaluate(() => !state.brackets4['legacy-game-d4']) && /Run the bracket/.test(await entry(page)), 'cancel', 'the bracket is gone and the Start card is back');
  ok(errs.length === 0, 'e2e', 'page errors: ' + errs.join(' | '));
  await ctx.close();
}

// The states a bracket can be in, reached through the engine (the same functions the taps call), for both roles.
const G = 'legacy-game-d4';
const STATES = {
  'start-suggested': () => { reset(); },
  'start-pick': () => { reset(); fourUi.gid = 'legacy-game-d4'; fourUi.choosing = true; fourUi.order = ['t1', 't2']; },
  'semifinal-1': () => { reset(); fourStartGame(gameById('legacy-game-d4'), [['t3', 't1'], ['t0', 't2']]); },
  'third-place': () => { reset(); const g = gameById('legacy-game-d4'); fourStartGame(g, [['t3', 't1'], ['t0', 't2']]); fourRecordTap(g, 's1', 't3'); fourRecordTap(g, 's2', 't0'); },
  'final': () => { reset(); const g = gameById('legacy-game-d4'); fourStartGame(g, [['t3', 't1'], ['t0', 't2']]); fourRecordTap(g, 's1', 't3'); fourRecordTap(g, 's2', 't0'); fourRecordTap(g, 'third', 't2'); },
  'summary': () => { reset(); const g = gameById('legacy-game-d4'); fourStartGame(g, [['t3', 't1'], ['t0', 't2']]); fourRecordTap(g, 's1', 't3'); fourRecordTap(g, 's2', 't0'); fourRecordTap(g, 'third', 't2'); fourRecordTap(g, 'final', 't3'); },
  'recheck': () => { reset(); const g = gameById('legacy-game-d4'); fourStartGame(g, [['t3', 't1'], ['t0', 't2']]); fourRecordTap(g, 's1', 't3'); fourRecordTap(g, 's2', 't0'); fourRecordTap(g, 'third', 't2'); state.brackets4['legacy-game-d4'].m.s1.winner = 't1'; },
  'unreadable': () => { reset(); state.brackets4['legacy-game-d4'] = { m: { final: { a: 't0', b: 't1', winner: 't0' } } }; },
  'saved': () => { reset(); const g = gameById('legacy-game-d4'); fourStartGame(g, [['t3', 't1'], ['t0', 't2']]); fourRecordTap(g, 's1', 't3'); fourRecordTap(g, 's2', 't0'); fourRecordTap(g, 'third', 't2'); fourRecordTap(g, 'final', 't3'); fourSaveResult(g); },
};
const PREP = `
  window.reset = () => { delete state.results['${G}']; delete state.brackets4['${G}']; delete state.live['${G}']; fourUi.gid = ''; fourUi.choosing = false; fourUi.order = []; };
  window.celebrate = () => {};
`;

async function statesPass(browser) {
  const sizes = process.env.QUICK ? [[390, 'light', 100]] : [[360, 'light', 100], [360, 'dark', 200], [390, 'light', 130], [390, 'dark', 100], [360, 'light', 200]];
  for (const role of ['editor', 'counselor']) {
    for (const [w, scheme, tx] of sizes) {
      const where = role + ' ' + w + ' ' + scheme + ' ' + tx + '%';
      console.log('STATES ' + where);
      const { ctx, page, errs } = await open(browser, { role, w, scheme, text: tx, team: role === 'counselor' ? 't0' : '' });
      await page.evaluate(PREP);
      await page.evaluate(SEED_POINTS);
      for (const name of Object.keys(STATES)) {
        if (role === 'counselor' && ['start-suggested', 'start-pick', 'unreadable'].includes(name)) continue;
        // a counselor's phone is shown what a director's screen wrote: the state is made as a director, then the phone is a counselor's again
        await page.evaluate(({ fn, counselor }) => { if (counselor) setMemberRole('editor'); eval('(' + fn + ')()'); if (counselor) setMemberRole('viewer'); openGame('legacy-game-d4', { from: 'now' }); renderAll(); }, { fn: STATES[name].toString(), counselor: role === 'counselor' });
        await sleep(450);
        const t = await text(page, '#entry-area');
        ok(t && t.length > 10, where + ' ' + name, 'the entry area is empty');
        if (role === 'counselor') ok(!(await hasSel(page, '.winner-btn, [data-four], #save-bracket-btn')), where + ' ' + name, 'a counselor sees a control');
        await measure(page, where + ' ' + name);
        await shot(page, `${role}-${w}-${scheme}-${tx}-${name}`);
      }
      // a counselor's Now card with the bracket under way (mockup 13)
      if (role === 'counselor') {
        await page.evaluate(() => { reset(); const g = gameById('legacy-game-d4'); fourStartGame = fourStartGame; setMemberRole('editor'); fourStartGame(g, [['t3', 't1'], ['t0', 't2']]); fourRecordTap(g, 's1', 't3'); setMemberRole('viewer'); closeGame(); state.ui.tab = 'now'; renderAll(); });
        await sleep(600);
        const nowText = await text(page, '#now-card');
        ok(/Legacy Game/.test(nowText || '') && /Semifinal/.test(nowText || ''), where + ' now', 'the Now card names the bracket: ' + (nowText || '').replace(/\s+/g, ' ').slice(0, 160));
        ok(/plays in semifinal 2|plays in the final next/i.test(nowText || '') || tx > 100, where + ' now', 'Red\'s line: ' + (nowText || '').replace(/\s+/g, ' ').slice(0, 200));
        ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), where + ' now', 'the page scrolls sideways');
        await shot(page, `counselor-${w}-${scheme}-${tx}-now`);
      }
      ok(errs.length === 0, where, 'page errors: ' + errs.join(' | '));
      await ctx.close();
    }
  }
}

async function juniorSmoke(browser) {
  console.log('JUNIOR six-team smoke, 390 light');
  const { ctx, page, errs } = await open(browser, { camp: 'junior', now: '2-1005' });
  await page.evaluate(() => { window.celebrate = () => {}; openGame('kangaroo-kickball', { from: 'now' }); });
  await sleep(600);
  await tap(page, '#start-bracket-btn');
  let t = await entry(page);
  ok(/Round 1 — Match 1 of 3/.test(t), 'junior', 'Start Bracket: ' + (t || '').slice(0, 80));
  await shot(page, 'junior-round1');
  await tap(page, '.winner-btn[data-winner="t3"]'); // Pumpkins win over Foxes
  await tap(page, '.winner-btn[data-winner="t1"]');
  await tap(page, '.winner-btn[data-winner="t2"]');
  t = await entry(page);
  ok(/Who gets the bye/.test(t), 'junior', 'the bye step: ' + (t || '').slice(0, 80));
  ok(await hasSel(page, '#undo-to-round1-btn'), 'junior', 'Back to Round 1 is offered');
  await tap(page, '.tiebreak-chip >> nth=0');
  t = await entry(page);
  ok(/Championship Game/.test(t), 'junior', 'the championship game: ' + (t || '').slice(0, 80));
  ok(await hasSel(page, '#undo-bye-btn'), 'junior', 'Back to the bye is offered (new)');
  await shot(page, 'junior-championship');
  await measure(page, 'junior championship');
  await tap(page, '.winner-btn >> nth=0');
  t = await entry(page);
  ok(/<h3>Final<\/h3>/.test(await page.evaluate(() => document.getElementById('entry-area').innerHTML)) || /Final/.test(t), 'junior', 'the final');
  ok(await hasSel(page, '#undo-semifinal-btn'), 'junior', 'Undo the championship game result is offered (new)');
  await tap(page, '#undo-semifinal-btn');
  ok(/Championship Game/.test(await entry(page)), 'junior', 'Undo took the championship game back');
  await tap(page, '.winner-btn >> nth=0');
  await tap(page, '.winner-btn >> nth=0');
  t = await entry(page);
  ok(/Game results/.test(t) && await hasSel(page, '#undo-final-btn'), 'junior', 'the summary, with Undo the final result: ' + (t || '').slice(0, 60));
  await shot(page, 'junior-summary'); await measure(page, 'junior summary');
  await tap(page, '#save-bracket-btn');
  await sleep(500);
  ok(await page.evaluate(() => !!state.results['kangaroo-kickball'] && !state.brackets['kangaroo-kickball']), 'junior', 'Save Result saved the result and retired the bracket');
  ok(errs.length === 0, 'junior', 'page errors: ' + errs.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await e2e(browser);
    if (!process.env.QUICK) { await statesPass(browser); }
    else await statesPass(browser);
    await juniorSmoke(browser);
  } finally { await browser.close(); }
  console.log(problems.length ? '\n' + problems.length + ' problem(s) in ' + checks + ' checks' : '\nall ' + checks + ' checks passed');
  process.exit(problems.length ? 1 : 0);
})();
