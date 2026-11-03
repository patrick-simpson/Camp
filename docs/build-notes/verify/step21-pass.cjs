// Step 21 (build): Set up the week → Games, driven with REAL taps in a real page (no Firebase: the stub recipe, the week seeded in the
// page). Flows: hub → Games row → the screen; Add a game here → name → Podium (the game is created); Change → When → another item;
// a bracket's Matchups board; the quick game from the Games tab; the day's ⋯. For each flow it reports tap targets under 44x44 and
// sideways scroll, and it checks what the tap WROTE (the page's own state). SHOTS=1 writes screenshots (OUT=<dir>).
//   node step21-pass.cjs [baseUrl]    (serve the worktree first: python3 -m http.server 8963)
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://localhost:8963').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots21/';
require('fs').mkdirSync(OUT, { recursive: true });

async function openPage(browser, { camp, w, scheme, text }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 740 : 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: scheme });
  await ctx.addInitScript(({ camp }) => { try { localStorage.setItem('campScoreboardAuthHint', 'editor'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?now=3-1015&cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && typeof setMemberRole === 'function' && !!customElements.get('jelly-switch'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (text !== 100) await page.addStyleTag({ content: 'html{font-size:' + text + '% !important}' });
  await page.addStyleTag({ content: '#sdk-banner,.toast,#toast-stack{display:none!important}' });
  await page.evaluate(() => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const b = [...document.querySelectorAll('button')].find((x) => /Neutral \/ no team/.test(x.textContent)); if (b) b.click();
    authUser = { email: 'jenn@example.com', emailVerified: true };
    setMemberRole('editor');
    setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
    setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (d) => planForDow(d), CAMP).ops);
    setupReady = true; configReady = true;
    renderAll();
  });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

const MEASURE = () => {
  const issues = [];
  const sel = 'button, a[href], [role="tab"], [role="radio"], input:not([type="hidden"]), textarea, select, summary, jelly-switch, jelly-checkbox';
  const roots = [document.getElementById('setup'), ...document.querySelectorAll('.sheet-overlay:not([hidden]) .sheet')].filter(Boolean);
  const seen = new Set();
  const shown = (e) => !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  roots.forEach((root) => root.querySelectorAll(sel).forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    if (!shown(el)) return;
    if (el.closest('.sheet-grab') || el.hasAttribute('data-sheet-grab')) return;
    if (el.closest('#app-header') || el.closest('#tabbar')) return;
    const r = el.getBoundingClientRect();
    if (el.tagName === 'INPUT' && el.closest('label.fld')) { const lr = el.closest('label').getBoundingClientRect(); if (lr.height >= 43.5 && r.height >= 40) return; }
    if (r.width < 43.5 || r.height < 43.5) issues.push({ el: (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 24) });
  }));
  const sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
  return { issues, sideways };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const report = [];
  const note = (tag, m) => { if (m && ((m.issues && m.issues.length) || m.sideways)) report.push(Object.assign({ tag }, m)); };
  const failures = [];
  const check = (name, ok, extra) => { if (!ok) failures.push(name + (extra ? ' — ' + extra : '')); };
  const sizes = process.env.QUICK ? [[390, 'light', 100]] : [[360, 'light', 100], [390, 'dark', 100], [360, 'light', 130], [390, 'light', 200]];
  for (const camp of ['junior', 'senior']) {
    for (const [w, scheme, txt] of sizes) {
      const tag = [camp, w, scheme, txt + '%'].join(' ');
      const { ctx, page, errs } = await openPage(browser, { camp, w, scheme, text: txt });
      const shot = async (n, full) => { if (process.env.SHOTS) await page.screenshot({ path: OUT + [camp, n, w, scheme, txt].join('-') + '.png', fullPage: !!full }); };
      const tap = async (sel) => { const loc = page.locator(sel).first(); await loc.scrollIntoViewIfNeeded().catch(() => {}); await loc.tap(); await sleep(250); };
      try {
        // More → Set up the week → Games (real taps)
        await page.evaluate(() => showTab('more'));
        await sleep(300);
        await tap('#builder-row');
        await sleep(500);
        await tap('[data-hub-row="games"]');
        await sleep(600);
        check(tag + ' the Games row opens the Games screen', await page.evaluate(() => document.getElementById('setup').dataset.screen === 'games'));
        const day = await page.evaluate(() => state.ui.sgDay || gmDayKey());
        await shot('screen', true);
        note(tag + ' screen', await page.evaluate(MEASURE));
        // Add a game here → the sheet at stage "name"
        const n0 = await page.evaluate(() => allGames().length);
        await tap('#setup-games [data-sg-add]');
        check(tag + ' the sheet opens at stage name', await page.evaluate(() => document.getElementById('sheet-game').dataset.stage === 'name' && !document.getElementById('sheet-game').hidden));
        await shot('sheet-name');
        note(tag + ' sheet name', await page.evaluate(MEASURE));
        await page.locator('#gm-name').fill('Rain bowling');
        await sleep(200);
        check(tag + ' a name brings in How is it scored?, writes nothing', await page.evaluate((n0) => document.getElementById('sheet-game').dataset.stage === 'format' && allGames().length === n0, n0));
        await shot('sheet-format');
        note(tag + ' sheet format', await page.evaluate(MEASURE));
        await tap('[data-gm-format="tally"]');
        await sleep(300);
        const made = await page.evaluate((n0) => ({ n: allGames().length - n0, stage: document.getElementById('sheet-game').dataset.stage, g: (gmUi.open && gameById(gmUi.open.gid)) ? { name: gameById(gmUi.open.gid).name, blockId: gameById(gmUi.open.gid).blockId, format: gameById(gmUi.open.gid).format } : null }), n0);
        check(tag + ' tapping Scores creates the game', made.n === 1 && made.stage === 'game' && made.g && made.g.name === 'Rain bowling' && made.g.format === 'tally' && !!made.g.blockId, JSON.stringify(made));
        await shot('sheet-game', true);
        note(tag + ' sheet game', await page.evaluate(MEASURE));
        // a field saves as it changes: Where, then a switch
        await page.locator('#gm-where').fill('The gym');
        await page.locator('#gm-unit').tap();
        await sleep(300);
        check(tag + ' Where saved when focus left it', await page.evaluate(() => gameById(gmUi.open.gid).location === 'The gym'));
        await page.locator('#gm-steps').fill('1, five');
        await page.locator('#gm-unit').tap();
        await sleep(300);
        check(tag + ' a bad counter list keeps its message and saves nothing', await page.evaluate(() => !gameById(gmUi.open.gid).counterSteps && !document.getElementById('gm-steps-error').hidden));
        note(tag + ' sheet error', await page.evaluate(MEASURE));
        await page.locator('#gm-steps').fill('1, 5');
        await page.locator('#gm-unit').tap();
        await sleep(300);
        check(tag + ' a fixed counter list saves', await page.evaluate(() => JSON.stringify(gameById(gmUi.open.gid).counterSteps) === '[1,5]'));
        // Change → When → pick another item (if the day has two)
        await tap('#gm-when-btn');
        await sleep(500);
        check(tag + ' the When pane opens', await page.evaluate(() => document.getElementById('sheet-game').dataset.pane === 'when'));
        await shot('sheet-when', true);
        note(tag + ' sheet when', await page.evaluate(MEASURE));
        const other = await page.evaluate(() => { const rows = [...document.querySelectorAll('#gm-when-list .gm-when-row:not([aria-current])')]; return rows.length ? rows[0].dataset.gmBlock : ''; });
        if (other) {
          await tap('#gm-when-list .gm-when-row:not([aria-current])');
          await sleep(400);
          check(tag + ' picking an item moves the game and goes back to the form', await page.evaluate((o) => gameById(gmUi.open.gid).blockId === o && document.getElementById('sheet-game').dataset.pane === 'form', other));
        } else await tap('#gm-pane-back');
        // Done closes; the game is on the screen
        await tap('#gm-done');
        await sleep(500);
        check(tag + ' Done closes the sheet and the screen lists the game', await page.evaluate(() => document.getElementById('sheet-game').hidden && /Rain bowling/.test(document.getElementById('sg-items').textContent)));
        await shot('screen-after', true);
        // a bracket's Matchups board
        await tap('#setup-games [data-sg-add]');
        await page.locator('#gm-name').fill('Rope pull');
        await tap('[data-gm-format="tournament"]');
        await sleep(300);
        await tap('[data-gm-seed="fixed"]');
        await sleep(300);
        await shot('sheet-matchups', true);
        note(tag + ' sheet matchups', await page.evaluate(MEASURE));
        const nTeams = await page.evaluate(() => teamIds().length);
        for (let i = 0; i < nTeams - 2; i++) { await page.locator('#gm-keys .gm-key[aria-pressed="false"]').first().tap(); await sleep(120); }
        await sleep(300);
        check(tag + ' a full board saves the pairs', await page.evaluate(() => { const g = gameById(gmUi.open.gid); return g.bracketSeed === 'fixed' && gmPairsValid(g.roundOneMatchups); }));
        await tap('#gm-done');
        await sleep(400);
        // the day's ⋯
        await tap('#sg-day-btn');
        await sleep(400);
        await shot('day-sheet');
        note(tag + ' day sheet', await page.evaluate(MEASURE));
        await page.locator('#sg-day-note').fill('Bring a towel');
        await page.locator('#sheet-sg-day .sheet-title').tap();
        await sleep(300);
        check(tag + ' the note saved when focus left it', await page.evaluate(() => gmDayRecs(gmUi.dayDk)[0].note === 'Bring a towel'));
        await page.evaluate(() => shellSheetClose('sg-day'));
        await sleep(300);
        check(tag + ' the note shows on the screen', await page.evaluate(() => !document.getElementById('sg-note').hidden && /towel/.test(document.getElementById('sg-note-text').textContent)));
        // back to the games tab and the quick game
        await page.evaluate(() => { setupCloseBuilder(); showTab('games'); });
        await sleep(600);
        await page.evaluate(() => { document.getElementById('games-quick') && document.getElementById('games-quick').click(); });
        await sleep(500);
        const q = await page.evaluate(() => ({ open: !!gmUi.open && !document.getElementById('sheet-game').hidden, mode: gmUi.open && gmUi.open.mode, fmt: document.getElementById('sheet-game').dataset.format, builder: builderOpen() }));
        check(tag + ' Quick game opens the game sheet over the Games tab with Podium picked', q.open && q.mode === 'quick' && q.fmt === 'placement' && !q.builder, JSON.stringify(q));
        await shot('quick');
        await page.locator('#gm-name').fill('Sock toss');
        await page.locator('#sheet-game .sheet-title').tap();
        await sleep(500);
        const qq = await page.evaluate(() => ({ g: gameById(gmUi.open.gid) && gameById(gmUi.open.gid).name, score: !document.getElementById('gm-score').hidden }));
        check(tag + ' naming the quick game creates it and offers Score it now', qq.g === 'Sock toss' && qq.score, JSON.stringify(qq));
        await shot('quick-made');
        note(tag + ' quick', await page.evaluate(MEASURE));
        await tap('#gm-score');
        await sleep(600);
        check(tag + ' Score it now opens the game', await page.evaluate(() => !!state.ui.gameId && document.getElementById('sheet-game').hidden));
      } catch (e) { failures.push(tag + ' threw: ' + String(e).slice(0, 300)); }
      if (errs.length) failures.push(tag + ' page errors: ' + errs.join(' | '));
      await ctx.close();
    }
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
  console.log(failures.length ? 'FAILURES:\n' + failures.join('\n') : 'no failures');
})();
