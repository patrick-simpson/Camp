// Step 25 Playwright pass: every Step 25 screen — the hub's Teams / People / Campers rows, the Teams screen and its sheets (team, colours), the
// People screen and its five sheets, the Campers screen (loaded, with names waiting for signal, with its Undo line) and its two sheets, the join bar
// on Now and More's People row, and the denied screen's Ask to join (the form, sent, closed) — as a DIRECTOR, as the OWNER and as a COUNSELOR (who must
// reach none of it), both camps, 360 and 390 wide, light and dark, 100% / 130% / 200% text. Reports every tap target under 44x44, sideways scroll,
// a row title squeezed into a sliver, and anything a counselor can reach. Screenshots under OUT/ (100% at 390 only, to keep the folder small).
//   node step25-pass.cjs [baseUrl]    (OUT=<dir>; QUICK=junior for one camp; ONLY=360/dark/200 for one config)
// Serve the worktree first: python3 -m http.server 8961 (no Firebase: the page is blocked from it, the role is set in the page, the database is a stub).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8961').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/step25-shots/';
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const note = (m) => { problems.push(m); console.log('PROBLEM', m); };

async function boot(browser, { role = 'editor', scheme = 'light', camp = 'junior', w = 390, h = 844, scale = 100 }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: true, hasTouch: true });
  await ctx.addInitScript(({ role, camp, scale }) => {
    localStorage.setItem('campScoreboardAuthHint', role);
    if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior');
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = scale + '%'; });
  }, { role, camp, scale });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => note('pageerror: ' + e.message));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!customElements.get('jelly-drawer') && typeof setupGo === 'function', null, { timeout: 25000 }).catch(() => note('the app did not boot'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const click = (re) => { const b = [...document.querySelectorAll('button')].find((x) => re.test(x.textContent)); if (b) b.click(); };
    click(/Neutral \/ no team|Neutral|just cheering/);
    const ov = document.getElementById('team-picker-overlay'); if (ov) { ov.removeAttribute('open'); ov.open = false; }
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
  });
  await page.addStyleTag({ content: '#sdk-banner,.toast,#toast-stack,jelly-toaster{display:none!important}' });
  return { ctx, page };
}

// Every visible control must be at least 44x44; no sideways scroll; no row title squeezed to a sliver.
async function audit(page, label, scope) {
  const bad = await page.evaluate((scope) => {
    const root = scope ? document.querySelector(scope) : document.body;
    const out = [];
    if (!root) return ['scope not found: ' + scope];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('sideways scroll: ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth);
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') && !el.closest('[inert]'); };
    let audited = 0;
    root.querySelectorAll('button, a[href], select, input:not([type=hidden]):not(.visually-hidden), textarea, [role=radio], [role=checkbox], jelly-switch, summary').forEach((el) => {
      if (!vis(el) || el.closest('.sheet-grab') || el.hasAttribute('data-sheet-grab')) return;
      const r = el.getBoundingClientRect();
      audited++;
      if (el.tagName === 'INPUT' && el.closest('label.gl-row, label.fld')) { const lr = el.closest('label').getBoundingClientRect(); if (lr.height >= 43.5) return; }
      if (r.width < 43.5 || r.height < 43.5) out.push('target ' + (el.id || (typeof el.className === 'string' ? el.className : '') || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || '').trim().slice(0, 24) + '"');
    });
    root.querySelectorAll('.cb-title, .cmp-chip, .ppl-head-name').forEach((el) => { if (vis(el) && (el.textContent || '').trim().length > 12 && el.getBoundingClientRect().width < 80 && !el.classList.contains('cmp-chip')) out.push('title squeezed ' + Math.round(el.getBoundingClientRect().width) + 'px "' + el.textContent.slice(0, 20) + '"'); });
    // A switch row's words squeezed beside its switch (the design review's People / Campers finding: 74px at 360px / 200%).
    root.querySelectorAll('.gl-row .gl-text').forEach((el) => { if (vis(el) && el.getBoundingClientRect().width < 150) out.push('switch-row words squeezed ' + Math.round(el.getBoundingClientRect().width) + 'px "' + el.textContent.trim().slice(0, 24) + '"'); });
    if (!audited) out.push('audited NOTHING (hidden or inert scope)');
    return out;
  }, scope);
  bad.forEach((b) => note(label + ': ' + b));
}

// The director's world, in the page: a stub database that says yes, the connection up, branded teams, people, requests and campers.
const SEED_DIRECTOR = (who) => {
  authUser = who === 'owner' ? { email: 'patricksimpson.fx@gmail.com', emailVerified: true } : { email: 'jenn@example.com', emailVerified: true };
  setMemberRole('editor');
  window.FIREBASE_CONFIG = { apiKey: 't' };
  const q = () => ({ once: () => Promise.resolve({ val: () => null, forEach() {} }), on() {}, off() {}, set: () => Promise.resolve(), update: () => Promise.resolve(), remove: () => Promise.resolve(), child() { return q(); }, onDisconnect: () => ({ remove: () => Promise.resolve(), cancel: () => Promise.resolve() }), orderByChild() { return q(); }, limitToLast() { return q(); } });
  window.firebase = { database: Object.assign(() => ({ ref: () => q() }), { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } }) };
  fbRef = fbRef || {}; fbConnKnown = true; fbConnected = true; syncStarted = false;
  restoreOnline = () => true;
  const ids = state.teams.map((x) => x.id);
  const pal = typeof CAMP_TEAM_PALETTE !== 'undefined' ? CAMP_TEAM_PALETTE : [];
  state.teams.forEach((t, i) => { if (pal[i]) t.color = pal[i].id; if (i === 0) { t.short = 'Foxes'; t.emoji = '🦊'; } });
  const iso = '2026-11-01T00:00:00Z';
  memberDirectory = {
    'jenn@example,com': { role: 'editor', name: 'Jenn Reed', addedBy: 'x', addedAt: iso },
    [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick Simpson', addedBy: 'console', addedAt: iso },
    'sam@example,com': { role: 'viewer', name: 'Sam Lee', teamId: ids[0], addedBy: 'x', addedAt: iso },
    'alyssa@example,com': { role: 'viewer', name: 'Alyssa Whittingham-Montgomery', teamId: ids[1], addedBy: 'x', addedAt: iso },
    'pending-taylor-ab12c': { role: 'viewer', name: 'Taylor', teamId: ids[0], addedBy: 'x', addedAt: iso },
    'pending-boss-qq1w2': { role: 'editor', name: 'Taylor Boss', addedBy: 'x', addedAt: iso },
  };
  memberDirectoryLoaded = true;
  pplReq.list = [{ key: 'taylor,reed@gmail,com', name: 'Taylor Reed', note: "I'm with the " + (state.teams[0].name.split(' ').pop()), at: Date.now() - 240000 },
    { key: 'x@y,com', name: '<img src=x onerror=alert(1)> Long Name Here Indeed', note: 'n'.repeat(150), at: Date.now() - 3600000 }];
  pplReq.loaded = true;
  joinBarSeen.clear();
  state.ui.view = 'settings'; state.ui.builderScreen = 'hub';
  renderAll();
};

// Minors' names: in memory only, exactly as the real listener would hold them. Called AFTER the builder is open (closing it lets the list go, by design).
const SEED_CAMPERS = () => {
  const ids = state.teams.map((x) => x.id);
  const row = (n, o) => ({ name: n, ord: o });
  const many = {};
  ['Maya', 'Eli', 'Grace', 'Owen', 'Ava R.', 'Ava T.', 'Maximilian-Alexander Montgomery III', 'Zoë', 'Li', 'Noor', 'Quinn', 'Brontë Xavier-Ozymandias Longname Jr.', '<img src=x onerror=alert(1)>', 'Ivy', 'Jo', 'Kai'].forEach((n, i) => { many['c-aaaaaa' + String(i).padStart(4, '0')] = row(n, (i + 1) * 10); });
  const data = { [ids[0]]: many };
  if (ids[1]) data[ids[1]] = { 'c-bbbbbb0001': row('Sophia', 10), 'c-bbbbbb0002': row('Theo', 20), 'c-bbbbbb0003': row('Uma', 30) };
  campersMem.tree = campersNorm(data); campersMem.loaded = true; campersMem.denied = false; campersMem.held = []; campersMem.heldNote = '';
  renderAll();
};

const CLOSE_SHEETS = () => {
  SETUP_SHEETS.forEach((id) => { if (shell.sheets.includes(id)) shellSheetClose(id); });
  teamUi.edit = null; teamUi.colors = false;
  peopleUi.person = peopleUi.request = peopleUi.teams = peopleUi.add = null; peopleUi.blocked = false;
  campersUi.edit = null; campersUi.add = null;
};

// Render-stability: two idle renderAll()s on the screen that is up change nothing in the page (a re-created node repaints and animates from scratch).
async function idle(page, label) {
  const n = await page.evaluate(async () => {
    let count = 0;
    const mo = new MutationObserver((list) => { count += list.filter((m) => !(m.target.id === 'joy-layer' || (m.target.closest && m.target.closest('#joy-layer')))).length; });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    renderAll(); await new Promise((r) => setTimeout(r, 60)); renderAll(); await new Promise((r) => setTimeout(r, 60));
    mo.disconnect();
    return count;
  });
  if (n) note(label + ': ' + n + ' DOM mutation(s) from two idle renderAlls');
}

async function show(page, label, fn, scope, shot) {
  await page.evaluate(CLOSE_SHEETS);
  await page.waitForTimeout(200);
  await page.evaluate(fn);
  await page.waitForTimeout(520);
  await audit(page, label, scope);
  if (shot) await page.screenshot({ path: OUT + label.replace(/[^a-z0-9]+/gi, '-') + '.png', fullPage: !/sheet/.test(label) });
}

(async () => {
  const browser = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split('/') : null;
  const camps = process.env.QUICK ? [process.env.QUICK] : ['junior', 'senior'];
  const configs = [];
  for (const camp of camps) for (const scheme of ['light', 'dark']) for (const [w, h] of [[360, 740], [390, 844]]) for (const scale of [100, 130, 200]) {
    if (only && (String(w) !== only[0] || scheme !== only[1] || String(scale) !== only[2])) continue;
    configs.push({ camp, scheme, w, h, scale });
  }

  // ── the DIRECTOR ──
  for (const c of configs) {
    const L = `director-${c.camp}-${c.scheme}-${c.w}-${c.scale}`;
    const shot = c.scale === 100 && c.w === 390;
    const { ctx, page } = await boot(browser, c);
    await page.evaluate(SEED_DIRECTOR, 'director');
    await page.waitForTimeout(500);
    // Now: the join bar; More: the People row and its dot
    await page.evaluate(() => { showTab('now'); renderAll(); });
    await page.waitForTimeout(350);
    if (c.w === 390 && c.scale !== 130) await audit(page, L + ' now-join-bar', '#announcements');
    if (shot) await page.screenshot({ path: OUT + L + '-now.png' });
    await page.evaluate(() => { showTab('more'); renderAll(); });
    await page.waitForTimeout(350);
    const more = await page.evaluate(() => ({ dot: !document.getElementById('tab-dot-more').hidden, people: document.getElementById('more-people-count').textContent, title: document.querySelector('#members-row .gl-title').textContent.replace(/\s+/g, ' ').trim() }));
    if (!more.dot || more.people !== '2' || !/^People/.test(more.title)) note(L + ': More badges ' + JSON.stringify(more));
    await audit(page, L + ' more', '#more-director');
    if (shot) await page.screenshot({ path: OUT + L + '-more.png' });
    // the frame
    await page.evaluate(() => { openBuilder(); });
    await page.waitForTimeout(500);
    await page.evaluate(SEED_CAMPERS);
    await show(page, L + ' hub', () => { setupGo('hub'); }, '#setup', shot);
    if (c.scale === 100) await idle(page, L + ' hub');
    const hub = await page.evaluate(() => ['teams', 'people', 'campers'].map((k) => { const r = document.querySelector('[data-hub-row="' + k + '"]'); return k + ': ' + r.tagName + ' ' + r.querySelector('[data-hub-summary]').textContent; }));
    if (!/campers: BUTTON \d+ campers?/.test(hub.join('|'))) note(L + ': the hub Campers row reads ' + hub.join(' | '));
    // Teams
    await show(page, L + ' teams', () => { setupGo('teams'); }, '#setup', shot);
    if (c.scale === 100) await idle(page, L + ' teams');
    const teamsText = await page.evaluate(() => document.getElementById('teams-list').textContent.replace(/\s+/g, ' '));
    if (!/\d+ campers?/.test(teamsText)) note(L + ': the Teams rows carry no camper count');
    await show(page, L + ' sheet-team', () => { document.querySelector('#teams-list [data-team-open]').click(); }, '.sheet-overlay:not([hidden]) .sheet', shot);
    await show(page, L + ' sheet-team-colors', () => { teamUi.colors = true; setupSheet('team-colors'); }, '.sheet-overlay:not([hidden]) .sheet', shot);
    // People
    await show(page, L + ' people', () => { setupGo('people'); }, '#setup', shot);
    if (c.scale === 100) await idle(page, L + ' people');
    const peopleText = await page.evaluate(() => document.getElementById('people-groups').textContent.replace(/\s+/g, ' '));
    if (!/\d+ campers?/.test(peopleText)) note(L + ': the People groups carry no camper count');
    const peopleSheets = [
      ['person', () => { peopleOpenPerson('sam@example,com'); }],
      ['person-pending', () => { peopleOpenPerson('pending-taylor-ab12c'); }],
      ['request', () => { peopleOpenRequest('taylor,reed@gmail,com'); }],
      ['teams', () => { peopleOpenTeams(); }],
      ['add-list', () => { peopleOpenAdd(null, 'list'); document.getElementById('ppa-lines').value = 'Cam, ' + state.teams[0].name + '\nSam Lee\nQuinn, nowhere'; renderPeopleAddSheet(); }],
      ['add-one', () => { peopleOpenAdd(null, 'one'); }],
      ['blocked', () => { pplReq.blocked = { status: 'ok', rows: [{ key: 'z@x,com', at: Date.now() - 86400000, byKey: 'jenn@example,com' }] }; peopleUi.blocked = true; setupSheet('people-blocked'); }],
    ];
    for (const [name, fn] of peopleSheets) {
      if (c.scale === 130 && !['person', 'request', 'add-list'].includes(name)) continue;
      await show(page, L + ' sheet-people-' + name, fn, '.sheet-overlay:not([hidden]) .sheet', shot);
    }
    // Campers
    await show(page, L + ' campers', () => { setupGo('campers'); }, '#setup', shot);
    if (c.scale === 100) await idle(page, L + ' campers');
    const campers = await page.evaluate(() => ({ head: document.getElementById('campers-headline').textContent, chips: document.querySelectorAll('#campers-groups .cmp-chip[data-camper]').length, adds: document.querySelectorAll('#campers-groups .cmp-add').length, teams: state.teams.length, bad: document.getElementById('campers-groups').innerHTML.includes('<img src=x') }));
    if (!/^\d+ campers$/.test(campers.head) || campers.chips < 15 || campers.adds !== campers.teams || campers.bad) note(L + ': the Campers screen ' + JSON.stringify(campers));
    await show(page, L + ' campers-waiting', () => { campersMem.held = [{ tid: 't0', names: ['Quinn Held', 'Zoë Held'] }, { tid: 't1', names: ['Eli Held'] }]; renderCampersScreen(); campersSayUndo('Removed Maximilian-Alexander Montgomery III.', async () => ({ ok: true })); renderCampersScreen(); }, '#setup', shot);
    await page.evaluate(() => { campersMem.held = []; campersUndoClear(); renderCampersScreen(); });
    await show(page, L + ' sheet-camper-edit', () => { campersOpenEdit('t0', 'c-aaaaaa0006'); }, '.sheet-overlay:not([hidden]) .sheet', shot);
    await show(page, L + ' sheet-camper-edit-long', () => { campersOpenEdit('t0', 'c-aaaaaa0011'); }, '.sheet-overlay:not([hidden]) .sheet', false);
    await show(page, L + ' sheet-camper-add', () => { campersOpenAdd('t1'); document.getElementById('cma-lines').value = 'Zyx, Quill\nAva T.\n' + 'z'.repeat(45); renderCamperAddSheet(); }, '.sheet-overlay:not([hidden]) .sheet', shot);
    await show(page, L + ' sheet-camper-add-offline', () => { fbConnected = false; campersOpenAdd('t0'); document.getElementById('cma-lines').value = 'Pip, Noor'; renderCamperAddSheet(); }, '.sheet-overlay:not([hidden]) .sheet', false);
    await page.evaluate(() => { fbConnected = true; });
    await ctx.close();
  }

  // ── the OWNER ── (the owner row, the repair sentence, body.setup-owner)
  for (const camp of camps) for (const [w, h, scale, scheme] of [[390, 844, 100, 'light'], [360, 740, 200, 'dark']]) {
    const L = `owner-${camp}-${scheme}-${w}-${scale}`;
    const { ctx, page } = await boot(browser, { camp, scheme, w, h, scale });
    await page.evaluate(SEED_DIRECTOR, 'owner');
    await page.evaluate(() => { openBuilder(); setupGo('people'); });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const row = [...document.querySelectorAll('#people-groups .ppl-row')].find((e) => /Owner · managed/.test(e.textContent)); return { owner: isOwner(), cls: document.body.classList.contains('setup-owner'), tag: row ? row.tagName : null, you: row ? /you/.test(row.textContent) : null }; });
    if (!r.owner || !r.cls || r.tag !== 'DIV' || !r.you) note(L + ': the owner view ' + JSON.stringify(r));
    await audit(page, L + ' people', '#setup');
    // a camp with a team slot missing: the owner is told to repair it, a director is told to ask the owner
    const owner = await page.evaluate(() => { state.teams = state.teams.slice(0, -1); setupGo('teams'); return document.getElementById('teams-repair-text').textContent; });
    if (!/need repair/.test(owner)) note(L + ': the owner\'s repair sentence is "' + owner + '"');
    await audit(page, L + ' teams-repair', '#setup');
    await ctx.close();
    const d = await boot(browser, { camp, scheme, w, h, scale });
    await d.page.evaluate(SEED_DIRECTOR, 'director');
    const dr = await d.page.evaluate(() => { openBuilder(); state.teams = state.teams.slice(0, -1); setupGo('teams'); return { text: document.getElementById('teams-repair-text').textContent, owner: isOwner(), cls: document.body.classList.contains('setup-owner') }; });
    if (dr.owner || dr.cls || !/^Ask .* to repair team slots$/.test(dr.text)) note(L + ': the director\'s repair sentence is ' + JSON.stringify(dr));
    await d.ctx.close();
  }

  // ── the COUNSELOR: reaches none of it ──
  for (const camp of camps) for (const [w, h] of [[360, 740], [390, 844]]) for (const scheme of ['light', 'dark']) for (const scale of [100, 200]) {
    const L = `counselor-${camp}-${scheme}-${w}-${scale}`;
    const { ctx, page } = await boot(browser, { role: 'viewer', camp, scheme, w, h, scale });
    await page.evaluate(() => {
      authUser = { email: 'sam@example.com', emailVerified: true };
      setMemberRole('viewer');
      const pal = typeof CAMP_TEAM_PALETTE !== 'undefined' ? CAMP_TEAM_PALETTE : [];
      state.teams.forEach((t, i) => { if (pal[i]) t.color = pal[i].id; if (i === 0) { t.short = 'Foxes'; t.emoji = '🦊'; } });
      state.followTeam = state.teams[0].id; setMemberTeam(state.teams[0].id);
      campersMem.tree = {}; campersMem.loaded = false;
      renderAll();
    });
    const reach = await page.evaluate(() => {
      const out = [];
      openBuilder(); if (builderOpen()) out.push('openBuilder opened for a counselor');
      if (setupGo('campers')) out.push('setupGo campers');
      if (setupGo('people')) out.push('setupGo people');
      state.ui.view = 'settings'; state.ui.builderScreen = 'campers'; renderAll();
      if (state.ui.view === 'settings') out.push('renderAll left a counselor in the builder');
      SETUP_SHEETS.forEach((id) => { if (shellSheetAllowed(id)) out.push('sheet allowed: ' + id); });
      if (campersFor('t0').length || campersTotal() || campersMem.ref) out.push('the camper list is reachable');
      campersOpenAdd('t0'); campersOpenEdit('t0', 'c-aaaaaa0001'); if (campersUi.add || campersUi.edit) out.push('a camper sheet opened');
      const vis = (id) => { const e = document.getElementById(id); if (!e || e.closest('[hidden]')) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      ['more-director', 'builder-row', 'members-row', 'setup', 'setup-campers', 'setup-people', 'setup-teams', 'sheet-camper-edit', 'sheet-camper-add', 'campers-groups'].forEach((id) => { if (vis(id)) out.push('visible: #' + id); });
      if (document.body.classList.contains('builder-open')) out.push('body.builder-open');
      if (document.body.textContent.includes('Maximilian')) out.push('a camper name is in the page');
      return out;
    });
    reach.forEach((r) => note(L + ': a counselor reaches ' + r));
    await page.evaluate(() => { showTab('more'); renderAll(); });
    await page.waitForTimeout(350);
    await audit(page, L + ' more', '#tab-more');
    await page.evaluate(() => { const b = document.getElementById('hdr-id'); if (b) b.click(); });
    await page.waitForTimeout(600);
    await audit(page, L + ' your-team', '.sheet-overlay:not([hidden]) .sheet');
    if (c_shot(w, scale)) await page.screenshot({ path: OUT + L + '-your-team.png' });
    await ctx.close();
  }

  // ── the denied screen's Ask to join ──
  for (const scheme of ['light', 'dark']) for (const [w, h] of [[360, 740], [390, 844]]) for (const scale of [100, 130, 200]) {
    if (process.env.QUICK && scale === 130) continue;
    const L = `denied-${scheme}-${w}-${scale}`;
    const { ctx, page } = await boot(browser, { role: 'viewer', scheme, w, h, scale });
    await page.evaluate(() => {
      authUser = { email: 'taylor.reed@gmail.com', emailVerified: true, displayName: 'Taylor Reed' };
      showAuthScreen('denied', { email: 'taylor.reed@gmail.com' });
      ask.key = 'taylor,reed@gmail,com'; ask.camp = CAMP.id; ask.ready = true; ask.rows = {}; ask.closed = false;
      document.getElementById('ask-name').value = 'Taylor Reed';
      askPaint();
    });
    await page.waitForTimeout(300);
    await audit(page, L + ' form', '#lock-screen');
    if (w === 390 && scale === 100) await page.screenshot({ path: OUT + L + '-form.png' });
    await page.evaluate(() => { ask.rows[ask.camp] = { name: 'Taylor Reed', at: Date.now() - 90000 }; askPaint(); });
    await page.waitForTimeout(200);
    await audit(page, L + ' sent', '#lock-screen');
    await page.evaluate(() => { ask.rows[ask.camp] = null; ask.closed = true; askPaint(); });
    await page.waitForTimeout(200);
    await audit(page, L + ' closed', '#lock-screen');
    await ctx.close();
  }

  await browser.close();
  const uniq = {};
  problems.forEach((p) => { const k = p.replace(/^\S+ /, '').replace(/\d+x\d+/g, 'WxH').replace(/\d+px/g, 'Npx'); uniq[k] = (uniq[k] || 0) + 1; });
  Object.keys(uniq).forEach((k) => console.log(uniq[k] + 'x ' + k));
  console.log(problems.length ? problems.length + ' problems' : 'CLEAN');
  process.exit(problems.length ? 1 : 0);

  function c_shot(w, scale) { return w === 390 && scale === 100; }
})();
