// Step 21 (build session 2): every state of Set up the week → Games and the game sheet, reached the way a person reaches it — the page's own engine
// and renderers (no specimen markup), real taps and typing where a field is involved — for each camp, width, theme and text size. No Firebase (the
// stub recipe: the week seeded in the page, the role set in the page). For every state it reports tap targets under 44x44, sideways scroll, text squeezed
// into a narrow column, and (SHOTS=1, OUT=<dir>) writes a screenshot to look at. The roles:
//   editor / owner  the whole list; the owner's phone must paint the very same screens (nothing owner-only hangs on them)
//   counselor       reaches none of it: no Set up the week row, no Add games / Quick game on the Games tab, every engine call refuses, the sheet never opens
//   node step21-states.cjs [baseUrl]    (serve the worktree first: python3 -m http.server 8977)
//   ONLY=<state>[,…]   QUICK=1 (390 light 100% only)   SIZE=360,light,200 (one size)   CAMPS=junior|senior   ROLE=editor|owner|counselor|all
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://localhost:8977').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/s21states/';
require('fs').mkdirSync(OUT, { recursive: true });
const OWNER_EMAIL = 'patricksimpson.fx@gmail.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(browser, { camp, w, scheme, text, role }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 740 : 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: scheme });
  const hint = role === 'counselor' ? 'viewer' : 'editor';
  await ctx.addInitScript(({ camp, hint }) => { try { localStorage.setItem('campScoreboardAuthHint', hint); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp, hint });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?now=3-1015&cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && typeof setMemberRole === 'function' && !!customElements.get('jelly-switch'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (text !== 100) await page.addStyleTag({ content: 'html{font-size:' + text + '% !important}' });
  await page.addStyleTag({ content: '#sdk-banner,.toast,#toast-stack{display:none!important}' });
  await page.evaluate(({ role, email }) => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const b = [...document.querySelectorAll('button')].find((x) => /Neutral \/ no team/.test(x.textContent)); if (b) b.click();
    authUser = { email, emailVerified: true };
    setMemberRole(role === 'counselor' ? 'viewer' : 'editor');
    window.scrollTo = () => {};
    setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule', 'meals', 'verses', 'cleanup', 'electives'])))); setupRev++;
    setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (d) => planForDow(d), CAMP).ops);
    setupReady = true; configReady = true;
    renderAll();
  }, { role, email: role === 'owner' ? OWNER_EMAIL : 'jenn@example.com' });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

const MEASURE = () => {
  const issues = [];
  const sel = 'button, a[href], [role="tab"], [role="radio"], input:not([type="hidden"]), textarea, select, summary, jelly-switch, jelly-checkbox';
  const roots = [document.getElementById('setup'), ...document.querySelectorAll('.sheet-overlay:not([hidden]) .sheet'), document.querySelector('jelly-dialog[open] .ask, #ask-dialog[open]')].filter(Boolean);
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
  const clip = [...document.querySelectorAll('#setup-games, .sheet-overlay:not([hidden]) .sheet-body')].filter((e) => e.scrollWidth > e.clientWidth + (e.id === 'setup-games' ? 10 : 1)).map((e) => (e.id || e.className).toString().slice(0, 30) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  const narrow = [...document.querySelectorAll('#setup-games .cb-title, #setup-games .cb-sub, #setup-games .sg-item-name, .sheet-overlay:not([hidden]) .gl-title, .sheet-overlay:not([hidden]) .gl-sub, .sheet-overlay:not([hidden]) .cb-title, .sheet-overlay:not([hidden]) .gm-key')]
    .filter((e) => shown(e) && e.getBoundingClientRect().width < (e.classList.contains('gm-key') ? 56 : 80)).map((e) => (e.textContent || '').trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().width) + 'px');
  return { issues, sideways, clip, narrow };
};

// A helper kit for the states: runs in Node, drives the page.
function kit(page) {
  const ev = (fn, arg) => page.evaluate(fn, arg);
  return {
    ev,
    settle: async (ms) => { await sleep(ms || 450); },
    tap: async (sel) => { const loc = page.locator(sel).first(); await loc.scrollIntoViewIfNeeded().catch(() => {}); await loc.tap(); await sleep(300); },
    fill: async (sel, text) => { await page.locator(sel).first().fill(text); await sleep(250); },
    blur: async () => { await page.locator('#sheet-game .sheet-title').tap().catch(() => {}); await sleep(250); },
    closeAll: async () => { await ev(() => { ['game', 'sg-day', 'setup-menu'].forEach((id) => { try { if (shell.sheets.includes(id)) shellSheetClose(id); } catch (e) {} }); const d = document.getElementById('ask-dialog'); if (d && d.hasAttribute('open')) { try { d.removeAttribute('open'); } catch (e) {} } gmUi.open = null; }); await sleep(250); },
    // the Wednesday of the camp (today in this page's clock), and its first Games item
    wedFirstItem: () => ev(() => { const dk = 'wed'; const b = planForDow(3).find((x) => x.type === 'games' && !x.noTime); return b ? b.id : ''; }),
  };
}

// state name → { build: async (k) => void, scope: 'setup' | 'sheet' } — the page is already on the Games screen (Wednesday) unless a state says otherwise
const STATES = [
  ['hub', async (k) => { await k.ev(() => { openBuilder(); setupGo('hub'); }); await k.settle(); }],
  ['screen-wed', async (k) => { await k.ev(() => gmOpenScreen('wed')); await k.settle(); }],
  ['screen-loose', async (k) => { await k.ev(() => { const g = gmGamesOnDay('wed')[0]; delete g.blockId; delete g.ord; gmOpenScreen('wed'); renderAll(); }); await k.settle(); }],
  ['screen-tba-note', async (k) => { await k.ev(() => { const g = gmGamesOnDay('wed').slice(-1)[0]; g.location = 'TBA'; gmSetDayNote('wed', 'Bring a towel, the evening games get wet'); gmOpenScreen('wed'); renderAll(); }); await k.settle(); }],
  ['screen-not-a-day', async (k) => { await k.ev(() => gmOpenScreen('sat')); await k.settle(); }],
  ['screen-empty-day', async (k) => { await k.ev(() => { gmMakeDay('sat'); gmOpenScreen('sat'); renderAll(); }); await k.settle(); }],
  ['screen-original', async (k) => { await k.ev(() => { setupTree.meta = setupTree.meta || {}; setupTree.meta.on = Object.assign({}, setupTree.meta.on, { schedule: false }); setupRev++; gmOpenScreen('wed'); renderAll(); }); await k.settle(600); }],
  ['day-sheet', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); gmOpenDaySheet(document.getElementById('sg-day-btn')); }); await k.settle(600); }],
  ['day-takeoff-ask', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); gmTakeDayOffFlow(); }); await k.settle(700); }],
  ['sheet-name', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-add]'); await k.settle(600); }],
  ['sheet-format', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-add]'); await k.fill('#gm-name', 'Rain bowling'); await k.settle(600); }],
  ['sheet-podium', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-add]'); await k.fill('#gm-name', 'Rain bowling'); await k.tap('[data-gm-format="placement"]'); await k.settle(700); }],
  ['sheet-tally-extras', async (k) => {
    await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-add]'); await k.fill('#gm-name', 'Water relay'); await k.tap('[data-gm-format="tally"]');
    await k.fill('#gm-steps', '1, five'); await k.blur();
    await k.ev(() => { document.querySelectorAll('#sheet-game details').forEach((d) => { d.open = true; }); }); await k.settle(600);
  }],
  ['sheet-bracket-standings', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-add]'); await k.fill('#gm-name', 'Rope pull'); await k.tap('[data-gm-format="tournament"]'); await k.settle(700); }],
  ['sheet-bracket-board', async (k) => {
    await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-add]'); await k.fill('#gm-name', 'Rope pull'); await k.tap('[data-gm-format="tournament"]'); await k.tap('[data-gm-seed="fixed"]');
    const n = await k.ev(() => teamIds().length);
    for (let i = 0; i < Math.max(1, n - 3); i++) { await page_keyTap(k); }
    await k.settle(600);
  }],
  ['sheet-bracket-done', async (k) => {
    await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-add]'); await k.fill('#gm-name', 'Rope pull'); await k.tap('[data-gm-format="tournament"]'); await k.tap('[data-gm-seed="fixed"]');
    const n = await k.ev(() => teamIds().length);
    for (let i = 0; i < n - 2; i++) await page_keyTap(k);
    await k.settle(700);
  }],
  ['sheet-saved-collapsed', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-open]'); await k.settle(700); }],
  ['sheet-howto', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-open]'); await k.ev(() => { document.querySelectorAll('#sheet-game details').forEach((d) => { d.open = true; }); }); await k.settle(600); }],
  ['sheet-change-warn', async (k) => {
    await k.ev(() => { const g = gmGamesOnDay('wed')[0]; state.results = state.results || {}; state.results[g.id] = { medals: { gold: teamIds()[0], silver: teamIds()[1], bronze: teamIds()[2] }, savedAt: Date.now() }; gmOpenScreen('wed'); renderAll(); });
    await k.tap('#setup-games [data-sg-open]'); await k.tap('#gm-format [role="radio"][aria-checked="true"]'); await k.settle(600);
  }],
  ['sheet-when', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-open]'); await k.tap('#gm-when-btn'); await k.settle(700); }],
  ['sheet-when-other-day', async (k) => {
    await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-open]'); await k.tap('#gm-when-btn');
    await k.ev(() => { const b = document.querySelector('#gm-when-days [data-dk="sat"]'); if (b) b.click(); }); await k.settle(700);
  }],
  ['sheet-gone', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-open]'); await k.ev(() => { const id = gmUi.open.gid; const i = state.config.games.findIndex((g) => g.id === id); state.config.games.splice(i, 1); renderAll(); }); await k.settle(700); }],
  ['sheet-quick', async (k) => { await k.ev(() => { setupCloseBuilder(); showTab('games'); }); await k.settle(500); await k.ev(() => startQuickGame()); await k.settle(700); }],
  ['sheet-quick-made', async (k) => { await k.ev(() => { setupCloseBuilder(); showTab('games'); }); await k.settle(500); await k.ev(() => startQuickGame()); await k.settle(500); await k.fill('#gm-name', 'Sock toss'); await k.blur(); await k.settle(700); }],
  ['sheet-delete-ask', async (k) => { await k.ev(() => { gmOpenScreen('wed'); renderAll(); }); await k.tap('#setup-games [data-sg-open]'); await k.ev(() => { const d = document.querySelector('#gm-delete, [data-gm-delete]'); if (d) d.click(); }); await k.settle(700); }],
];
async function page_keyTap(k) { await k.ev(() => { const b = document.querySelector('#gm-keys .gm-key[aria-pressed="false"]'); if (b) b.click(); }); await sleep(150); }

(async () => {
  const browser = await chromium.launch();
  const report = [];
  const failures = [];
  const only = process.env.ONLY ? process.env.ONLY.split(',') : STATES.map((s) => s[0]);
  const roles = process.env.ROLE && process.env.ROLE !== 'all' ? [process.env.ROLE] : (process.env.QUICK ? ['editor'] : ['editor']);
  let sizes = process.env.QUICK ? [[390, 'light', 100]] : [[360, 'light', 100], [390, 'dark', 100], [360, 'dark', 130], [390, 'light', 130], [360, 'light', 200], [390, 'dark', 200]];
  if (process.env.SIZE) { const [a, b, c] = process.env.SIZE.split(','); sizes = [[Number(a), b, Number(c)]]; } // one size per process: run several in parallel
  const camps = process.env.CAMPS ? process.env.CAMPS.split(',') : ['junior', 'senior'];
  for (const role of roles) {
    for (const camp of camps) {
      for (const [w, scheme, txt] of sizes) {
        for (const [name, build] of STATES) {
          if (!only.includes(name)) continue;
          const tag = [role, camp, name, w, scheme, txt + '%'].join(' ');
          const { ctx, page, errs } = await openPage(browser, { camp, w, scheme, text: txt, role });
          const k = kit(page);
          try {
            await build(k);
            const m = await page.evaluate(MEASURE);
            if (m.issues.length || m.sideways || m.clip.length || m.narrow.length) report.push(Object.assign({ tag }, m));
            if (process.env.SHOTS) {
              await page.screenshot({ path: OUT + [role, camp, name, w, scheme, txt].join('-') + '.png', fullPage: /^(screen|hub)/.test(name) });
              // a sheet scrolls inside itself: the rest of it, from the foot
              const moved = /^sheet-/.test(name) ? await page.evaluate(() => {
                const sh = document.querySelector('#sheet-game .sheet');
                const cands = [sh, document.querySelector('#sheet-game [data-gm-pane="form"]'), document.querySelector('#sheet-game .sheet-body')].filter(Boolean);
                const b = cands.find((e) => e.scrollHeight > e.clientHeight + 4);
                if (!b) return false;
                b.scrollTop = b.scrollHeight; return true;
              }) : false;
              if (moved) { await page.waitForTimeout(150); await page.screenshot({ path: OUT + [role, camp, name, w, scheme, txt, 'p2'].join('-') + '.png' }); }
            }
          } catch (e) { failures.push(tag + ' threw: ' + String(e).slice(0, 240)); }
          if (errs.length) failures.push(tag + ' page errors: ' + errs.join(' | '));
          await ctx.close();
        }
      }
    }
  }
  // The counselor: reaches none of it (a short list of checks, both camps, a few sizes).
  if (!process.env.ROLE || process.env.ROLE === 'all' || process.env.ROLE === 'counselor') {
    for (const camp of camps) {
      for (const [w, scheme, txt] of [[360, 'light', 100], [390, 'dark', 130], [360, 'light', 200]]) {
        const tag = ['counselor', camp, w, scheme, txt + '%'].join(' ');
        const { ctx, page, errs } = await openPage(browser, { camp, w, scheme, text: txt, role: 'counselor' });
        try {
          const r = await page.evaluate(() => {
            const out = {};
            showTab('more'); renderAll();
            const row = document.getElementById('builder-row');
            out.moreRowHidden = !row || row.hidden || row.offsetParent === null;
            showTab('games'); renderAll();
            const add = document.querySelector('[data-games-add]');
            const quick = document.getElementById('games-quick');
            out.noAdd = !add || add.offsetParent === null;
            out.noQuick = !quick || quick.hidden || quick.offsetParent === null;
            out.engine = [gmOpenNew({ dk: 'wed' }), gmOpenQuick(), gmOpenGame(allGames()[0].id), gmAddGames('wed')].every((x) => !x);
            out.sheetClosed = !shell.sheets.includes('game') && (document.getElementById('sheet-game') || {}).hidden !== false;
            out.builderClosed = !builderOpen();
            try { startQuickGame(); } catch (e) { out.threw = String(e); }
            out.afterQuick = !shell.sheets.includes('game') && !builderOpen();
            out.allowed = shellSheetAllowed('game') === false;
            gmOpenScreen('wed');
            out.screenRefused = !builderOpen();
            return out;
          });
          Object.keys(r).forEach((key) => { if (key !== 'threw' && r[key] !== true) failures.push(tag + ' counselor check failed: ' + key); });
          if (r.threw) failures.push(tag + ' threw: ' + r.threw);
        } catch (e) { failures.push(tag + ' threw: ' + String(e).slice(0, 240)); }
        if (errs.length) failures.push(tag + ' page errors: ' + errs.join(' | '));
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
  console.log(failures.length ? 'FAILURES:\n' + failures.join('\n') : 'no failures');
})();
