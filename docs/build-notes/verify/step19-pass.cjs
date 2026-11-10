// Step 19 Playwright pass: every screen and sheet of Meals / Memory verses / Cleanup rota / Electives (and the hub's prompt), as editor and as owner, both
// camps, 360 and 390 wide, light and dark, 100% / 130% / 200% text. Reports every tap target under 44x44 and any page that
// scrolls sideways, any row title or sub squeezed under 80px, and any segment whose label overflows it; screenshots under shots/. node step15-pass.cjs [baseUrl]  (OUT=<dir> for the screenshots; QUICK=junior STEPS=meals,cleanup for one config)
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8943').replace(/\/$/, '');
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
  // A row's words squeezed into a narrow column (a .gl-row with no .gl-ico put its text in the 30px icon column: one word a line).
  const shown = (e) => !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
  const narrow = [...document.querySelectorAll('#setup .gl-title, #setup .gl-sub, .sheet-overlay:not([hidden]) .gl-title, .sheet-overlay:not([hidden]) .gl-sub')]
    .filter((e) => shown(e) && e.getBoundingClientRect().width < 80).map((e) => (e.textContent || '').trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().width) + 'px');
  // A segment whose label overflows its button (the electives control at 200% text).
  const segs = [...document.querySelectorAll('#setup .seg-btn')].filter((e) => shown(e) && e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent || '').trim().slice(0, 24) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  return { issues, sideways, clip, narrow, segs };
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
    memberDirectory = { 'sofia@x,com': { role: 'viewer', name: 'Sofia Reed', teamId: 't3', addedBy: 'x', addedAt: 1 }, 'zac@x,com': { role: 'viewer', name: 'Zac Lund', teamId: 't1', addedBy: 'x', addedAt: 1 }, 'pending-maya-1': { role: 'viewer', name: 'Maya', teamId: 't0', addedBy: 'x', addedAt: 1 } }; memberDirectoryLoaded = true;
    window.scrollTo = () => {};
    if (!off) {
      setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
      setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (d) => planForDow(d), CAMP).ops);
    } else { setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP)))); setupRev++; }
    setupReady = true; configReady = true;
    openBuilder();
    renderAll();
  }, { camp, owner, off });
  await page.waitForTimeout(500);
  return { ctx, page, errs };
}

const STEPS = {
  hub: (p) => p.evaluate(() => { setupGo('hub'); }),
  meals: (p) => p.evaluate(() => { state.ui.secDay = 'wed'; setupGo('meals'); }),
  'meals-sun': (p) => p.evaluate(() => { state.ui.secDay = 'sun'; setupGo('meals'); }),
  verses: (p) => p.evaluate(() => { setupGo('verses'); }),
  'verse-sheet': (p) => p.evaluate(() => { setupGo('verses'); secOpenVerse(hubCompetitionDks()[0], null); }),
  'meals-pick': (p) => p.evaluate(() => { state.ui.secDay = 'wed'; setupGo('meals'); renderAll(); const b = document.querySelector('#meals-list .sec-meal [data-meal-emoji]'); if (b) b.click(); }),
  cleanup: (p) => p.evaluate(() => { state.ui.secDay = 'wed'; setupGo('cleanup'); }),
  'cleanup-sheet': (p) => p.evaluate(() => { state.ui.secDay = 'fri'; setupGo('cleanup'); secOpenTeams('lunch', null); }),
  'cleanup-fill': (p) => p.evaluate(() => { state.ui.secDay = 'wed'; setupGo('cleanup'); secFillEvenly(); }),
  electives: (p) => p.evaluate(() => { state.ui.secDay = 'tue'; state.ui.secSlot = 1; setupGo('electives'); }),
  'electives-3': (p) => p.evaluate(() => { state.ui.secDay = 'fri'; state.ui.secSlot = 2; setupGo('electives'); }),
  'elec-person': (p) => p.evaluate(() => { state.ui.secDay = 'tue'; state.ui.secSlot = 1; setupGo('electives'); secOpenAddPerson(setupElectiveRows(setupTree, 'tue', 1)[0].id, null); }),
  'elec-station-add': (p) => p.evaluate(() => { state.ui.secDay = 'tue'; state.ui.secSlot = 1; setupGo('electives'); secOpenStation('add', '', null); }),
  'elec-station-edit': (p) => p.evaluate(() => { state.ui.secDay = 'tue'; state.ui.secSlot = 1; setupGo('electives'); secOpenStation('edit', setupElectiveRows(setupTree, 'tue', 1)[0].id, null); }),
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
        report.push({ tag, issues: m.issues, sideways: m.sideways, clip: m.clip, narrow: m.narrow, segs: m.segs });
        if (shoot && shoot.indexOf(name) !== -1) await page.screenshot({ path: OUT + [cfg.camp, cfg.w, cfg.scheme, cfg.text, cfg.off ? 'preview' : 'live', name].join('-') + '.png' });
        // close whatever sheet is open before the next step
        await page.evaluate(() => { ['sec-teams', 'sec-person', 'sec-station', 'sec-verse'].forEach((id) => { try { shellSheetClose(id); } catch (e) {} }); secUi.teams = null; secUi.person = null; secUi.station = null; secUi.verse = null; try { const d = document.getElementById('ask-dialog'); const b = d && d.querySelector('[data-ask-i]'); if (askIsOpen() && b) b.click(); } catch (e) {} });
        await page.waitForTimeout(150);
      } catch (e) { report.push({ tag: cfg.camp + ' ' + cfg.w + ' ' + name, error: String(e).slice(0, 200) }); }
    }
    if (errs.length) report.push({ tag: JSON.stringify(cfg), pageErrors: errs });
    await ctx.close();
  };
  const ALL = Object.keys(STEPS);
  const SHOT = ['hub', 'meals', 'meals-pick', 'verses', 'verse-sheet', 'cleanup', 'cleanup-sheet', 'cleanup-fill', 'electives', 'elec-person', 'elec-station-add', 'elec-station-edit'];
  if (process.env.QUICK) {
    const camp = process.env.QUICK;
    const names = (process.env.STEPS || 'meals,cleanup').split(',');
    await run({ camp, w: Number(process.env.W || 360), scheme: process.env.SCHEME || 'light', text: Number(process.env.TEXT || 100), owner: process.env.OWNER !== '0', off: process.env.OFF === '1' }, names, names);
    await browser.close();
    console.log(JSON.stringify(report.filter((r) => (r.issues && r.issues.length) || r.sideways || r.error || r.pageErrors || (r.narrow && r.narrow.length) || (r.segs && r.segs.length))));
    return;
  }
  const JR = ['hub', 'meals', 'meals-sun', 'meals-pick', 'verses', 'verse-sheet', 'cleanup', 'cleanup-sheet', 'cleanup-fill', 'electives', 'electives-3', 'elec-person', 'elec-station-add', 'elec-station-edit'];
  const SR = ['hub', 'meals', 'meals-sun', 'meals-pick', 'verses', 'verse-sheet', 'cleanup', 'cleanup-sheet', 'cleanup-fill'];
  for (const camp of ['junior', 'senior']) {
    const set = camp === 'junior' ? JR : SR;
    await run({ camp, w: 360, scheme: 'light', text: 100, owner: true }, set, SHOT);
    await run({ camp, w: 390, scheme: 'dark', text: 100, owner: false }, set, SHOT);
    await run({ camp, w: 360, scheme: 'light', text: 100, owner: true, off: true }, ['hub', 'meals', 'verses', 'cleanup'].concat(camp === 'junior' ? ['electives'] : []), ['hub', 'meals', 'electives']);
    await run({ camp, w: 360, scheme: 'light', text: 100, owner: false, off: true }, ['hub', 'meals', 'cleanup']);
    await run({ camp, w: 390, scheme: 'light', text: 130, owner: false }, set, ['meals', 'cleanup', 'electives']);
    await run({ camp, w: 360, scheme: 'light', text: 200, owner: false }, set, ['hub', 'meals', 'verses', 'cleanup', 'cleanup-sheet', 'electives', 'elec-person']);
  }
  await browser.close();
  const bad = report.filter((r) => r.error || r.pageErrors || (r.issues && r.issues.length) || r.sideways || (r.clip && r.clip.length) || (r.narrow && r.narrow.length) || (r.segs && r.segs.length));
  console.log(JSON.stringify({ checked: report.length, bad }, null, 1));
})();
