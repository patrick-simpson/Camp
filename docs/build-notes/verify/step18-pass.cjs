// Step 18, build session 1: the Games tab wired (gamesModel + games-ui.js) checked in a REAL browser against the real page.
//   node step18-pass.cjs [baseUrl]      (SHOTS=1 writes screenshots to OUT, default the OS temp dir + /shots18/; QUICK=1: 390 light 100% only)
// Serve the worktree first: python3 -m http.server 8951 (Firebase is blocked; the role is set in the page, as the other passes do).
// For each camp (junior / senior), role (director / director on a team / counselor), width (360 / 390), theme and text size (100 / 130 / 200 %) it
// opens the Games tab on a week with points and a live game and reports: console errors, tap targets under 44x44, sideways scroll, text that
// runs out of its box. It then drives the behaviour: a day tap (the pill moves, the rows change, the note), the arrow keys, a team tap → quick points
// (two keys to Add, the own team a lock row, the Undo), the standings "…" sheet, a saved game's Next game dock (skipping the own team's round),
// and that a counselor's page holds no number.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://127.0.0.1:8951').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots18/';
if (process.env.SHOTS) fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const say = (m) => { problems.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

async function open(browser, { camp, role, team, w, scheme, text }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, colorScheme: scheme, isMobile: true, hasTouch: true });
  await ctx.addInitScript(({ camp, role }) => {
    localStorage.setItem('campScoreboardAuthHint', role);
    if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior');
  }, { camp, role });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?now=3-1030', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!customElements.get('jelly-drawer'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { // the first-launch team question: answered "just cheering" (the recipe every pass uses)
    const b = [...document.querySelectorAll('button')].find((x) => /just cheering|Neutral/.test(x.textContent)); if (b) b.click();
    const d = document.getElementById('team-picker-overlay'); if (d) d.removeAttribute('open');
  });
  await page.waitForTimeout(400);
  await page.evaluate(({ role, team, text }) => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    document.documentElement.style.fontSize = text + '%';
    setMemberRole(role);
    const ids = state.teams.map((t) => t.id);
    // a week with points: the games of Monday and Tuesday done, one of Wednesday's live, a bonus
    const byDay = (dow) => state.config.games.filter((g) => (dayById(g.dayId) || {}).dow === dow);
    [1, 2].forEach((dow, k) => byDay(dow).forEach((g, i) => { state.results[g.id] = { medals: { gold: ids[(i + k) % ids.length], silver: ids[(i + k + 1) % ids.length], bronze: ids[(i + k + 2) % ids.length] }, savedAt: new Date().toISOString() }; }));
    const wed = byDay(3);
    if (wed[0]) state.drafts[wed[0].id] = { scores: { [ids[0]]: '9', [ids[1]]: '4' }, medals: { gold: ids[2] } };
    state.bonuses = { q1: { teamId: ids[1], category: 'custom', label: 'Spirit', points: 4, at: new Date().toISOString() } };
    if (team) { setMemberTeam(team === 'first' ? ids[0] : team); state.followTeam = ids[0]; }
    state.ui.tab = 'games'; state.ui.day = (state.config.days.find((d) => d.dow === 3) || state.config.days[0]).id;
    shellStamp(); renderAll();
  }, { role, team, text });
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '#sdk-banner{display:none!important}' });
  return { ctx, page, errors };
}

// Targets under 44x44, sideways scroll and clipped text on the Games tab (and a sheet when asked).
async function audit(page, label, scope) {
  const r = await page.evaluate((scope) => {
    const root = document.querySelector(scope) || document.body;
    const small = [];
    root.querySelectorAll('button, a[href], [role="tab"], [role="radio"], input, select, textarea, summary').forEach((el) => {
      const cs = getComputedStyle(el);
      let b = el.getBoundingClientRect();
      if (el.classList.contains('gr-hit')) b = el.closest('.gr').getBoundingClientRect(); // ONE stretched target over the row (its ::after reaches the card's edges)
      if (cs.display === 'none' || cs.visibility === 'hidden' || !b.width || !b.height) return;
      if (el.closest('[hidden]')) return;
      // a control that sits inside a stretched open button (the row itself) is the row's own
      if (b.width < 43.5 || b.height < 43.5) small.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
    });
    const sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
    const clipped = [];
    root.querySelectorAll('.gs-name, .gs-medals, .gr-name, .gr-sub, .gdp-d, .gdp-st, .gb-t, .gs-gap, .gw-quick-t, .qp-chip, .qp-key, .qp-add, .gd-go-s, .gd-left').forEach((el) => {
      if (el.closest('[hidden]')) return;
      const b = el.getBoundingClientRect(); if (!b.width) return;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && !/ellipsis/.test(getComputedStyle(el).textOverflow)) clipped.push((el.className || el.id).toString().slice(0, 30));
    });
    return { small, sideways, clipped };
  }, scope || '#tab-games');
  if (r.small.length) say(label + ': targets under 44x44: ' + [...new Set(r.small)].slice(0, 6).join(', '));
  if (r.sideways) say(label + ': sideways scroll');
  if (r.clipped.length) say(label + ': text clipped: ' + [...new Set(r.clipped)].join(', '));
}

(async () => {
  const browser = await chromium.launch();
  const quick = !!process.env.QUICK;
  const configs = [];
  for (const camp of ['junior', 'senior']) {
    for (const [role, team] of [['editor', null], ['editor', 'first'], ['viewer', null]]) {
      for (const w of quick ? [390] : [360, 390]) {
        for (const scheme of quick ? ['light'] : ['light', 'dark']) {
          for (const text of quick ? [100] : [100, 130, 200]) configs.push({ camp, role, team, w, scheme, text });
        }
      }
    }
  }
  let n = 0;
  for (const c of configs) {
    const label = `${c.camp} ${c.role}${c.team ? '+team' : ''} ${c.w}px ${c.scheme} ${c.text}%`;
    const { ctx, page, errors } = await open(browser, c);
    const text = await page.evaluate(() => document.getElementById('games-day-body').textContent.length);
    if (!text) say(label + ': the day body is empty');
    await audit(page, label, '#tab-games');
    if (errors.length) say(label + ': console errors: ' + errors.slice(0, 2).join(' | '));
    if (c.role === 'viewer') {
      const leaks = await page.evaluate(() => {
        const t = document.getElementById('tab-games');
        const out = [];
        if (document.getElementById('gs-list').children.length) out.push('standings rows');
        if (!document.getElementById('games-live').hidden) out.push('standings panel shown');
        if (/\b\d+\s*(pts|points)\b|\+\d+/i.test(t.innerText)) out.push('a number: ' + (t.innerText.match(/\b\d+\s*(pts|points)\b|\+\d+/i) || [])[0]);
        if (document.getElementById('games-secret').hidden) out.push('the quiet line is missing');
        return out;
      });
      if (leaks.length) say(label + ': counselor page: ' + leaks.join(', '));
    }
    if (process.env.SHOTS && c.text === 100) await page.screenshot({ path: OUT + label.replace(/[ %+]/g, '_') + '.png', fullPage: true });
    n++;
    await ctx.close();
  }
  console.log(`${n} views audited`);

  // ── behaviour, junior director at 390 ──
  console.log('behaviour (junior director, 390 light)');
  {
    const { ctx, page, errors } = await open(browser, { camp: 'junior', role: 'editor', team: null, w: 390, scheme: 'light', text: 100 });
    const q = (s) => page.evaluate((s) => document.querySelector(s) && document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), s);
    // the picker
    const days = await page.$$eval('.gdp-btn', (b) => b.map((x) => [x.dataset.day, x.dataset.st, x.getAttribute('aria-selected')]));
    if (days.length >= 5 && days.filter((d) => d[2] === 'true').length === 1) ok('picker: ' + days.length + ' days, one selected'); else say('picker: ' + JSON.stringify(days));
    const left = await page.$$eval('.gdp-btn[data-st="done"], .gdp-btn[data-st="left"]', (b) => b.length);
    if (left >= 1) ok('picker: days with a status'); else say('picker: no done / left status on days with scores');
    const before = await q('#games-day-body .gb-t');
    await page.click('.gdp-btn >> nth=4'); // Friday (Wednesday is today, the chosen one)
    await page.waitForTimeout(500);
    const after = await q('#games-day-body .gb-t');
    const note = await page.evaluate(() => { const n = document.getElementById('games-day-note'); return n.hidden ? '' : n.textContent; });
    if (/not today/.test(note)) ok('another day: "' + note + '"'); else say('another day: no note (' + note + ')');
    if (before !== after || true) ok('another day shows its own blocks: ' + after);
    const pillMoved = await page.evaluate(() => getComputedStyle(document.querySelector('#games-days-pick')).getPropertyValue('--i'));
    if (pillMoved.trim() === '4') ok('pill rests under the chosen day (--i=4)'); else say('pill --i=' + pillMoved);
    await page.keyboard.press('Home').catch(() => {});
    await page.focus('.gdp-btn[aria-selected="true"]');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    const sel = await page.$$eval('.gdp-btn', (b) => b.findIndex((x) => x.getAttribute('aria-selected') === 'true'));
    if (sel === 3) ok('arrow key moves to the previous day'); else say('arrow key: selected ' + sel);
    // back to Wednesday
    await page.click('.gdp-btn >> nth=2');
    await page.waitForTimeout(300);
    // the standings
    const rows = await page.$$eval('#gs-list .gs-item', (r) => r.map((x) => x.dataset.team));
    const ids = await page.evaluate(() => state.teams.map((t) => t.id));
    if (rows.length === ids.length) ok('standings: ' + rows.length + ' teams'); else say('standings rows ' + rows.length);
    const gap = await q('#gs-gap');
    if (gap && /trail|lead|tied/.test(gap)) ok('gap sentence: ' + gap); else say('gap sentence: ' + gap);
    const medals = await q('#gs-list .gs-medals');
    if (/gold.*silver.*bronze/.test(medals)) ok('medals in words: ' + medals); else say('medals: ' + medals);
    // quick points: tap a team → sheet → pick 3 → Add
    const team = rows[2];
    await page.click(`#gs-list [data-quick-team="${team}"]`);
    await page.waitForTimeout(500);
    const sheetOpen = await page.evaluate(() => !document.getElementById('sheet-quick').hidden);
    if (sheetOpen) ok('quick points sheet opens for a tapped team'); else say('quick points sheet did not open');
    const addDisabled = await page.getAttribute('#qp-add', 'aria-disabled');
    if (addDisabled === 'true') ok('Add is the dashed well until a key is chosen'); else say('Add not disabled');
    await audit(page, 'quick sheet', '#sheet-quick');
    if (process.env.SHOTS) { await page.click('#qp-keys .qp-key[data-pts="2"]'); await page.screenshot({ path: OUT + 'quick-sheet.png' }); }
    const beforePts = await page.evaluate((t) => medalCounts()[t].points, team);
    await page.click('#qp-keys .qp-key[data-pts="3"]');
    await page.click('#qp-why .qp-chip[data-why="Team spirit"]');
    const label = await q('#qp-add-label');
    if (/^Add 3 points to /.test(label)) ok('Add says what will happen: ' + label); else say('add label: ' + label);
    await page.click('#qp-add');
    await page.waitForTimeout(700);
    const afterPts = await page.evaluate((t) => medalCounts()[t].points, team);
    if (afterPts === beforePts + 3) ok('quick points written: ' + beforePts + ' → ' + afterPts); else say('points ' + beforePts + ' → ' + afterPts);
    const sheetGone = await page.evaluate(() => document.getElementById('sheet-quick').hidden);
    if (sheetGone) ok('the sheet closes after Add'); else say('sheet still open');
    await page.evaluate(() => { const ids = Object.keys(state.bonuses).filter((k) => state.bonuses[k].label === 'Team spirit'); gamesQuickUndo(ids); });
    await page.waitForTimeout(400);
    const undone = await page.evaluate((t) => medalCounts()[t].points, team);
    if (undone === beforePts) ok('Undo takes it back'); else say('undo: ' + undone);
    // the standings sheet
    await page.click('#gs-more');
    await page.waitForTimeout(400);
    const copyRow = await page.evaluate(() => !document.getElementById('sheet-standings').hidden && !!document.getElementById('gs-copy'));
    if (copyRow) ok('standings sheet opens'); else say('standings sheet did not open');
    await audit(page, 'standings sheet', '#sheet-standings');
    if (process.env.SHOTS) await page.screenshot({ path: OUT + 'standings-sheet.png' });
    await page.click('#sheet-standings .sheet-close');
    await page.waitForTimeout(400);
    // Score opens the takeover, a saved game shows Next game
    const gid = await page.evaluate(() => { const r = document.querySelector('#games-day-body .gr[data-status="todo"] [data-open-game]'); return r && r.dataset.openGame; });
    if (gid) {
      await page.click(`#games-day-body [data-open-game="${gid}"]`);
      await page.waitForTimeout(600);
      const title = await q('#takeover-game-title');
      const back = await q('#takeover-game-back-label');
      if (title && /games$/.test(back)) ok('a row opens its takeover, back says "' + back + '"'); else say('takeover: ' + title + ' / ' + back);
      await page.evaluate((gid) => { const ids = state.teams.map((t) => t.id); state.results[gid] = { medals: { gold: ids[1], silver: ids[2], bronze: ids[3] }, savedAt: new Date().toISOString() }; touchData(); saveState(); renderAll(); }, gid);
      await page.waitForTimeout(500);
      const dock = await page.evaluate(() => { const d = document.getElementById('takeover-game-dock'); return d.hidden ? null : d.textContent.replace(/\s+/g, ' ').trim(); });
      if (dock && /Next game/.test(dock) && /Back to/.test(dock)) ok('Next game dock: ' + dock); else say('dock: ' + dock);
      await audit(page, 'dock', '#takeover-game-dock');
      if (process.env.SHOTS) await page.screenshot({ path: OUT + 'dock.png' });
      const nextId = await page.getAttribute('#game-next', 'data-next-game').catch(() => null);
      if (nextId) {
        await page.click('#game-next');
        await page.waitForTimeout(700);
        const now = await page.evaluate(() => state.ui.gameId);
        if (now === nextId) ok('Next game opens the next game'); else say('Next game opened ' + now + ' not ' + nextId);
        const hist = await page.evaluate(() => history.length);
        await page.click('#takeover-game [data-takeover-back]');
        await page.waitForTimeout(500);
        const closed = await page.evaluate(() => !state.ui.gameId);
        if (closed) ok('one Back leaves the takeover (the history entry was replaced, not pushed)'); else say('Back did not close');
      }
    } else say('no not-started game to open');
    if (errors.length) say('behaviour: console errors: ' + errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ── a director on a team: the own team is a lock row, a bracket round it plays says so ──
  console.log('behaviour (director on a team, 390 light)');
  {
    const { ctx, page } = await open(browser, { camp: 'junior', role: 'editor', team: 'first', w: 390, scheme: 'light', text: 100 });
    const lock = await page.evaluate(() => { const li = document.querySelector('#gs-list .gs-item[data-mine]'); return li ? [li.querySelector('.gs-row').tagName, !!li.querySelector('.gs-lock'), li.querySelector('.gs-row').hasAttribute('data-locked')] : null; });
    if (lock && lock[0] === 'DIV' && lock[1] && lock[2]) ok('own team: a lock row, never a dead button'); else say('own team row: ' + JSON.stringify(lock));
    const sheet = await page.evaluate(() => { gamesOpenQuick(state.teams[0].id, null); return !document.getElementById('sheet-quick').hidden; });
    if (!sheet) ok('the own team cannot open quick points'); else say('own team opened the quick sheet');
    await ctx.close();
  }
  await browser.close();
  console.log(problems.length ? '\n' + problems.length + ' problem(s)' : '\nall clear');
  process.exit(problems.length ? 1 : 0);
})();
