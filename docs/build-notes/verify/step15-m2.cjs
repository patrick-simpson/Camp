// M2 (P2 §11.6): the one-handed rain-plan moment, junior Wednesday, a seeded context, real taps.
// Change today's plan · Team competitions · Swap with… · Elective 1 · Swap their time slots · Axe Throwing · Thu ·
// Team competitions · Done · Done. Counts every tap, checks each target is already in view (no scrolling) at 360x640.
// It ends where it started: Now, with the schedule sheet open again (view "home", scheduleSheet true).
//   node step15-m2.cjs [baseUrl] [camp]   (serve the worktree first: python3 -m http.server 8941; OUT=<dir> for screenshots)
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://localhost:8941').replace(/\/$/, '');
const CAMP = process.argv[3] || 'junior';
const OUT = (process.env.OUT || require('os').tmpdir()) + '/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York' });
  await ctx.addInitScript(({ camp }) => { try { localStorage.setItem('campScoreboardAuthHint', 'editor'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp: CAMP });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.clock.setFixedTime(new Date('2026-07-22T13:40:00Z'));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?now=3-940&cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && !!document.getElementById('tab-btn-more') && typeof setMemberRole === 'function' && !!customElements.get('jelly-drawer'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const b = [...document.querySelectorAll('button')].find((x) => /Neutral \/ no team/.test(x.textContent)); if (b) b.click();
    authUser = { email: 'jenn@example.com', emailVerified: true };
    setMemberRole('editor');
    setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP)))); setupRev++;
    setupReady = true; configReady = true; // stand in for the first snapshots (Firebase is blocked here): the gates that stop a write before the first pull are open
    setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (d) => planForDow(d), CAMP).ops);
    renderAll();
  });
  await page.addStyleTag({ content: '#sdk-banner{display:none!important}' });
  await page.waitForTimeout(500);
  let taps = 0;
  const log = [];
  const inView = async (loc) => { const bb = await loc.boundingBox(); const vp = page.viewportSize(); return !!bb && bb.y >= 0 && bb.y + bb.height <= vp.height && bb.x >= 0 && bb.x + bb.width <= vp.width; };
  const tap = async (name, loc) => {
    await loc.waitFor({ state: 'visible', timeout: 5000 });
    const visible = await inView(loc);
    const bb = await loc.boundingBox();
    await loc.tap();
    taps++;
    log.push({ tap: taps, name, inViewBeforeTap: visible, size: bb ? Math.round(bb.width) + 'x' + Math.round(bb.height) : null });
    await page.waitForTimeout(450);
  };
  // The home schedule sheet is open (the moment starts at "Change today's plan").
  await page.evaluate(() => openSchedule());
  await page.waitForTimeout(700);
  await tap("Change today's plan", page.locator('#schedule-plan-btn'));
  await page.screenshot({ path: OUT + 'm2-1-list-' + CAMP + '.png' });
  await tap('Team competitions', page.locator('#rain-list .rain-row').filter({ hasText: 'Team competitions' }).first());
  await tap('Swap with…', page.locator('[data-rain-act="swap"]'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'm2-2-swap-' + CAMP + '.png' });
  await tap('Elective 1', page.locator('#rain-swap-list .rain-pick').filter({ has: page.locator('.cb-title span', { hasText: /^Elective 1$/ }) }).first());
  await page.screenshot({ path: OUT + 'm2-3-how-' + CAMP + '.png' });
  await tap('Swap their time slots', page.locator('[data-rain-how="slots"]'));
  await page.screenshot({ path: OUT + 'm2-4-staged-' + CAMP + '.png' });
  await tap('Axe Throwing', page.locator('#rain-list .rain-game[data-gid="axe-throwing"]'));
  await tap('Thu', page.locator('#rain-move-days [data-dk="thu"]'));
  await page.screenshot({ path: OUT + 'm2-5-move-' + CAMP + '.png' });
  await tap('Team competitions (Thursday)', page.locator('#rain-move-list .cb-row').filter({ hasText: 'Team competitions' }).first());
  await tap('Done', page.locator('#rain-done'));
  await page.screenshot({ path: OUT + 'm2-6-summary-' + CAMP + '.png' });
  await tap('Done', page.locator('#rain-commit'));
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const tc = planForDow(3).find((b) => /^Team competitions/.test(b.label));
    const e1 = planForDow(3).find((b) => b.type === 'elective' && b.slot === 0);
    const axe = gameById('axe-throwing');
    return { tc: tc && [tc.start, tc.end], e1: e1 && [e1.start, e1.end], axe: axe && [axe.dayId, axe.blockId], view: state.ui.view, screen: state.ui.view === 'settings' ? state.ui.builderScreen : null, scheduleSheet: !document.getElementById('schedule-overlay').hidden, undo: undoRecent().map((e) => e.label) };
  });
  console.log(JSON.stringify({ camp: CAMP, taps, gate: taps <= 12 ? 'PASS' : 'OVER', log, result, errs }, null, 1));
  await browser.close();
})();
