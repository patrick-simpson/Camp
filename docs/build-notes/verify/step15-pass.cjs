// Step 15 Playwright pass: every screen and sheet of Camp week / Schedule / the rain plan, as editor and as owner, both
// camps, 360 and 390 wide, light and dark, 100% / 130% / 200% text. Reports every tap target under 44x44 and any page that
// scrolls sideways; screenshots under shots/. node step15-pass.cjs [baseUrl]  (OUT=<dir> for the screenshots; QUICK=junior STEPS=week,schedule-wed for one config)
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8941').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots/';
fs.mkdirSync(OUT, { recursive: true });

const MEASURE = () => {
  const issues = [];
  const sel = 'button, a[href], [role="tab"], [role="radio"], input:not([type="hidden"]), select, jelly-switch, jelly-checkbox, jelly-input';
  const roots = [document.getElementById('setup'), ...document.querySelectorAll('.sheet-overlay:not([hidden]) .sheet, #schedule-overlay:not([hidden]) .schedule-sheet, #ask-dialog[open]')].filter(Boolean);
  const seen = new Set();
  roots.forEach((root) => root.querySelectorAll(sel).forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    if (el.closest('[hidden]') || el.closest('[inert]') && false) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // a label row that wraps its input is measured by the row; skip an input inside a labelled field row
    if (el.tagName === 'INPUT' && el.closest('label.gl-row, label.fld')) { const lr = el.closest('label').getBoundingClientRect(); if (lr.height >= 43.5) return; }
    if (el.closest('.sheet-grab') || el.hasAttribute('data-sheet-grab')) return;
    // a tab-strip chip inside an overflow scroller is measured as is
    if (r.width < 43.5 || r.height < 43.5) issues.push({ el: (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (el.dataset && Object.keys(el.dataset).length ? '[' + Object.keys(el.dataset)[0] + '=' + el.dataset[Object.keys(el.dataset)[0]] + ']' : ''), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 24) });
  }));
  const sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
  const clip = [...document.querySelectorAll('#setup, .sheet-overlay:not([hidden]) .sheet')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.id || e.className).toString().slice(0, 30) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  return { issues, sideways, clip };
};

async function openPage(browser, { camp, w, scheme, text, owner, off }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 740 : 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: scheme });
  await ctx.addInitScript(({ camp }) => { try { localStorage.setItem('campScoreboardAuthHint', 'editor'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.clock.setFixedTime(new Date('2026-07-22T13:40:00Z'));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?now=3-940&cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && !!document.getElementById('tab-btn-more') && typeof setMemberRole === 'function' && !!customElements.get('jelly-drawer'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (text !== 100) await page.addStyleTag({ content: 'html{font-size:' + text + '% !important}' });
  await page.addStyleTag({ content: '#sdk-banner{display:none!important}' });
  await page.evaluate(({ camp, owner, off }) => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const b = [...document.querySelectorAll('button')].find((x) => /Neutral \/ no team/.test(x.textContent)); if (b) b.click();
    authUser = { email: owner ? 'patricksimpson.fx@gmail.com' : 'jenn@example.com', emailVerified: true };
    setMemberRole('editor');
    window.scrollTo = () => {};
    if (!off) {
      setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP)))); setupRev++;
      setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (d) => planForDow(d), CAMP).ops);
    } else { setupTree = normalizeSetup({}); setupRev++; }
    setupReady = true; configReady = true;
    openBuilder();
    renderAll();
  }, { camp, owner, off });
  await page.waitForTimeout(500);
  return { ctx, page, errs };
}

const STEPS = {
  hub: (p) => p.evaluate(() => { setupGo('hub'); }),
  week: (p) => p.evaluate(() => { setupGo('week'); }),
  'schedule-typical': (p) => p.evaluate(() => { state.ui.setupDay = 'typical'; setupGo('schedule'); }),
  'schedule-wed': (p) => p.evaluate(() => { state.ui.setupDay = 'wed'; setupGo('schedule'); }),
  'schedule-sat': (p) => p.evaluate(() => { state.ui.setupDay = 'sat'; setupGo('schedule'); }),
  'item-edit': (p) => p.evaluate(() => { state.ui.setupDay = 'wed'; setupGo('schedule'); const b = planForDow(3).find((x) => x.origin === 'typical' && x.type === 'activity' && !x.meal); schedOpenItem({ bid: b.id }); }),
  'item-add': (p) => p.evaluate(() => { state.ui.setupDay = 'wed'; setupGo('schedule'); schedOpenItem({ start: 1230, end: 1290 }); }),
  'item-ask': (p) => p.evaluate(() => { state.ui.setupDay = 'wed'; setupGo('schedule'); const b = planForDow(3).filter((x) => !x.noTime && x.origin === 'typical')[2]; schedOpenItem({ bid: b.id }); setupSched.item.form.start = b.start - 30; setupSched.item.form.end = b.end - 30; schedItemTouched('time'); }),
  'day-sheet': (p) => p.evaluate(() => { state.ui.setupDay = 'wed'; setupGo('schedule'); setupSheet('sched-day'); }),
  rain: (p) => p.evaluate(() => { rainOpen('wed'); }),
  'rain-actions': (p) => p.evaluate(() => { rainOpen('wed').then(() => { const b = planForDow(3).find((x) => /^Team competitions/.test(x.label)); rainOpenItem(b.id); }); }),
  'rain-swap': (p) => p.evaluate(() => { rainOpen('wed').then(() => { const b = planForDow(3).find((x) => /^Team competitions/.test(x.label)); rainOpenItem(b.id); rainAct('swap'); }); }),
  'rain-how': (p) => p.evaluate(() => { rainOpen('wed').then(() => { const b = planForDow(3).find((x) => /^Team competitions/.test(x.label)); const o = planForDow(3).find((x) => x.slot === 0 && x.type === 'elective') || planForDow(3).find((x) => x.id !== b.id && x.end - x.start !== b.end - b.start && !x.noTime); rainOpenItem(b.id); rainAct('swap'); rainPickSwap(o.id); }); }),
  'rain-time': (p) => p.evaluate(() => { rainOpen('wed').then(() => { const b = planForDow(3).find((x) => /^Team competitions/.test(x.label)); rainOpenItem(b.id); rainAct('time'); }); }),
  'rain-games': (p) => p.evaluate(() => { rainOpen('wed').then(() => { const b = planForDow(3).find((x) => /^Team competitions/.test(x.label)); rainOpenItem(b.id); rainAct('games'); }); }),
  'rain-move': (p) => p.evaluate(() => { rainOpen('wed').then(() => { const g = allGames().find((x) => x.blockId && (competitionDays().find((d) => d.id === x.dayId) || {}).dow === 3); rainOpenMove(g.id, 'list'); }); }),
  'rain-done': (p) => p.evaluate(() => { rainOpen('wed').then(() => { const b = planForDow(3).find((x) => /^Team competitions/.test(x.label)); const o = planForDow(3).find((x) => x.slot === 0 && x.type === 'elective') || planForDow(3).find((x) => x.id !== b.id && x.end - x.start !== b.end - b.start && !x.noTime); rainOpenItem(b.id); rainAct('swap'); rainPickSwap(o.id); rainPickHow('slots'); rainOpenDone(); }); }),
  'home-sheet': (p) => p.evaluate(() => { state.ui.view = 'home'; state.ui.builderScreen = undefined; renderAll(); openSchedule(); }),
};

(async () => {
  const browser = await chromium.launch();
  const report = [];
  const run = async (cfg, names, shoot) => {
    const { ctx, page, errs } = await openPage(browser, cfg);
    for (const name of names) {
      try {
        await STEPS[name](page);
        await page.waitForTimeout(550);
        const m = await page.evaluate(MEASURE);
        const tag = [cfg.camp, cfg.w, cfg.scheme, cfg.text + '%', cfg.owner ? 'owner' : 'editor', cfg.off ? 'preview' : 'live', name].join(' ');
        report.push({ tag, issues: m.issues, sideways: m.sideways, clip: m.clip });
        if (shoot && shoot.indexOf(name) !== -1) await page.screenshot({ path: OUT + [cfg.camp, cfg.w, cfg.scheme, cfg.text, cfg.off ? 'preview' : 'live', name].join('-') + '.png' });
        // close whatever sheet is open before the next step
        await page.evaluate(() => { ['sched-item', 'sched-day', 'rain-item', 'rain-done'].forEach((id) => { try { shellSheetClose(id); } catch (e) {} }); setupSched.item = null; });
        await page.waitForTimeout(150);
      } catch (e) { report.push({ tag: cfg.camp + ' ' + cfg.w + ' ' + name, error: String(e).slice(0, 200) }); }
    }
    if (errs.length) report.push({ tag: JSON.stringify(cfg), pageErrors: errs });
    await ctx.close();
  };
  const ALL = Object.keys(STEPS);
  const SHOT = ['week', 'schedule-wed', 'item-edit', 'item-ask', 'rain', 'rain-how', 'rain-done'];
  if (process.env.QUICK) {
    const camp = process.env.QUICK;
    await run({ camp, w: 360, scheme: process.env.SCHEME || 'light', text: Number(process.env.TEXT || 100), owner: true }, (process.env.STEPS || 'week,schedule-wed').split(','), (process.env.STEPS || 'week,schedule-wed').split(','));
    await browser.close();
    console.log(JSON.stringify(report.filter((r) => (r.issues && r.issues.length) || r.sideways || r.error)));
    return;
  }
  for (const camp of ['junior', 'senior']) {
    await run({ camp, w: 360, scheme: 'light', text: 100, owner: true }, ALL, SHOT);
    await run({ camp, w: 390, scheme: 'dark', text: 100, owner: false }, ALL, SHOT);
    await run({ camp, w: 360, scheme: 'light', text: 100, owner: true, off: true }, ['week', 'schedule-typical', 'schedule-wed'], ['week', 'schedule-wed']);
    await run({ camp, w: 360, scheme: 'light', text: 100, owner: false, off: true }, ['week', 'schedule-wed']);
    await run({ camp, w: 390, scheme: 'light', text: 130, owner: false }, ['week', 'schedule-wed', 'item-edit', 'rain', 'rain-actions', 'rain-done'], ['schedule-wed', 'rain']);
    await run({ camp, w: 360, scheme: 'light', text: 200, owner: false }, ['week', 'schedule-wed', 'item-edit', 'item-ask', 'rain', 'rain-actions', 'rain-swap', 'rain-how', 'rain-time', 'rain-move', 'rain-done'], ['week', 'schedule-wed', 'item-edit', 'rain', 'rain-how', 'rain-done']);
  }
  await browser.close();
  const bad = report.filter((r) => r.error || r.pageErrors || (r.issues && r.issues.length) || r.sideways || (r.clip && r.clip.length));
  console.log(JSON.stringify({ checked: report.length, bad }, null, 1));
})();
