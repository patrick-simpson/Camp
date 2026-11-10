// Step 24 Playwright pass: every Step 24 screen — More's Director rows, Tell everyone (empty, and with every channel, a partial-failure
// report and Showing now), Award points, What counselors see with its Preview button, and PREVIEW AS A COUNSELOR itself (the bar, the
// frame, every tab, a game takeover, the sheets a counselor can open) — as a director, as the owner and as a counselor, both camps,
// 360 and 390 wide, light and dark, 100% / 130% / 200% text. Reports every tap target under 44x44, sideways scroll, text that overflows
// its box, the preview's geometry (the bar's height = --pv-h, the header and takeovers sitting under it, Exit 44px, the bar capped at
// 200% text), and anything a counselor must not see inside a preview (a director row, a point, a place). Screenshots under shots/.
//   node step24-pass.cjs [baseUrl]   (OUT=<dir> for the screenshots; QUICK=junior for one camp; ONLY=360/dark/200 for one config)
// Serve the worktree first: python3 -m http.server 8961 (no Firebase: the page is blocked from it and the role is set in the page).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://localhost:8961').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots/';
fs.mkdirSync(OUT, { recursive: true });

// Every interactive thing a person can see inside `rootSel` (default: the whole page, minus what is hidden or inert behind a takeover).
const MEASURE = (rootSel) => {
  const roots = rootSel ? [...document.querySelectorAll(rootSel)] : [document.body];
  const sel = 'button, a[href], [role="tab"], [role="radio"], [role="checkbox"], input:not([type="hidden"]), select, textarea, jelly-switch, jelly-checkbox, jelly-input';
  const small = []; const seen = new Set();
  const shown = (e) => {
    if (e.closest('[hidden]') || e.closest('[inert]')) return false;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  roots.forEach((root) => root.querySelectorAll(sel).forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    if (!shown(el)) return;
    if (el.closest('.sheet-grab') || el.hasAttribute('data-sheet-grab')) return;
    if (el.closest('.tab-blob') ) return;
    const r = el.getBoundingClientRect();
    // the page's own chrome that is not on screen (the tab bar slides away under a takeover; a fixed panel under another)
    if (r.bottom < 0 || r.top > window.innerHeight + 1) return;
    if (el.tagName === 'INPUT' && el.closest('label.gl-row, label.fld')) { const lr = el.closest('label').getBoundingClientRect(); if (lr.height >= 43.5) return; }
    if (Math.min(r.width, r.height) < 43.5) small.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || '').trim().slice(0, 20) + '"');
  }));
  const sideways = document.documentElement.scrollWidth - window.innerWidth;
  // A row's words squeezed into a narrow column (one word to a line): found at 200% text in What counselors see and in More's Your team row.
  const narrow = [...document.querySelectorAll('.gl-title, .gl-sub, .tell-tick-title, .tell-tick-sub, .aw-name, .tell-live-title')]
    .filter((e) => shown(e) && e.getBoundingClientRect().width < 80 && (e.textContent || '').trim().length > 12)
    .map((e) => (e.textContent || '').trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().width) + 'px');
  const clipped = [...document.querySelectorAll('button, .gl-title, .gl-sub, .tell-tick-title, .tell-tick-sub, .aw-name, .aw-led-name, .aw-led-why, .aw-team-name, .tell-live-title, .tell-live-sub, .tell-res-text, .msg-text, .pv-title, .pv-sub')]
    .filter((e) => shown(e) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && getComputedStyle(e).textOverflow !== 'ellipsis')
    .map((e) => (e.id || e.className).toString().slice(0, 30) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  return { small, sideways: sideways > 1 ? sideways : 0, clipped, narrow };
};

// What a counselor must not see, read off the page as drawn (not off the markup): a director's control that takes room, a point, a place.
const LEAKS = () => {
  const vis = (e) => { if (!e || e.closest('[hidden]')) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const rows = ['more-director', 'tell-row', 'award-row', 'builder-row', 'history-row', 'members-row', 'counselors-row', 'reveal-row', 'games-live', 'gs-reveal', 'takeover-tell', 'takeover-award', 'takeover-reveal']
    .filter((id) => vis(document.getElementById(id)));
  const text = document.body.innerText || '';
  const words = [];
  [[/\b\d+\s?pts?\b/i, 'points'], [/\bpoints? (behind|ahead|back)\b/i, 'a gap'], [/\b\d+(st|nd|rd|th) place\b/i, 'a place'], [/\bCurrent standings\b/i, 'the standings']].forEach(([re, why]) => { const m = re.exec(text); if (m) words.push(why + ': ' + m[0]); });
  const ownerClass = document.body.classList.contains('setup-owner');
  return { rows, words, ownerClass };
};

async function openPage(browser, { camp, w, scheme, text, role, owner }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 360 ? 740 : 844 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', colorScheme: scheme });
  await ctx.addInitScript(({ camp, role }) => { try { localStorage.setItem('campScoreboardAuthHint', role); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) {} }, { camp, role });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
  await page.goto(BASE + '/index.html?now=3-1330&cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof APP_VERSION !== 'undefined' && !!document.getElementById('tab-btn-more') && typeof setMemberRole === 'function' && !!customElements.get('jelly-drawer'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (text !== 100) await page.addStyleTag({ content: 'html{font-size:' + text + '% !important}' });
  await page.addStyleTag({ content: '#sdk-banner{display:none!important}' });
  await page.evaluate(({ role, owner }) => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    const tp = document.getElementById('team-picker-overlay'); if (tp) tp.remove();
    const b = [...document.querySelectorAll('button')].find((x) => /just cheering|Neutral/.test(x.textContent)); if (b) b.click();
    authUser = { email: owner ? 'patricksimpson.fx@gmail.com' : 'jenn@example.com', emailVerified: true };
    setMemberRole(role);
    window.scrollTo = () => {};
    memberDirectory = { 'patricksimpson,fx@gmail,com': { role: 'editor', name: 'Patrick Simpson', addedBy: 'x', addedAt: 1 } }; memberDirectoryLoaded = true;
    const teams = state.teams.map((t) => t.id);
    state.config.games.slice(0, 8).forEach((g, i) => { state.results[g.id] = { medals: { gold: teams[i % teams.length], silver: teams[(i + 1) % teams.length], bronze: teams[(i + 2) % teams.length] }, savedAt: new Date().toISOString() }; });
    state.bonuses = {
      v1: { teamId: teams[1], category: 'verse', label: 'x', points: 4, at: new Date().toISOString(), day: 3 },
      q1: { teamId: teams[2], category: 'custom', label: 'Helped carry the canoes', points: 5, at: new Date().toISOString(), day: 3 },
    };
    state.announcements = { a1: { id: 'a1', text: 'Water break at the Snack Shack. Bring your bottle and a hat.', at: new Date().toISOString(), ttlMs: 3 * 3600000, by: 'Jenn' } };
    state.notice = { status: 'posted', eyebrow: '', title: 'Where your team cleans on Saturday morning', sub: '', signoff: '', zones: [], steps: [] };
    renderAll();
  }, { role, owner });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch();
  const rows = []; const bad = [];
  const note = (tag, what, r) => {
    const problems = [];
    if (r.small && r.small.length) problems.push('small ' + JSON.stringify(r.small.slice(0, 4)));
    if (r.sideways) problems.push('sideways +' + r.sideways);
    if (r.clipped && r.clipped.length) problems.push('clipped ' + JSON.stringify(r.clipped.slice(0, 3)));
    if (r.narrow && r.narrow.length) problems.push('squeezed ' + JSON.stringify(r.narrow.slice(0, 3)));
    if (r.extra && r.extra.length) problems.push(...r.extra);
    rows.push(tag + ' ' + what + ' ' + (problems.length ? 'ISSUES ' + problems.join(' | ') : 'ok'));
    if (problems.length) bad.push(tag + ' ' + what + ': ' + problems.join(' | '));
  };
  const camps = process.env.QUICK ? [process.env.QUICK] : ['junior', 'senior'];
  for (const camp of camps) for (const scheme of ['light', 'dark']) for (const w of [360, 390]) for (const text of [100, 130, 200]) {
    const tag = [camp, scheme, w, text].join('/');
    if (process.env.ONLY && !process.env.ONLY.split('/').every((p) => tag.split('/').includes(p))) continue;
    const shot = camp === 'junior' && w === 360 && text === 200 && scheme === 'light';
    const shotDark = camp === 'senior' && w === 390 && text === 100 && scheme === 'dark';

    // ───────────── a director (and the owner) ─────────────
    for (const owner of [false, true]) {
      if (owner && !(w === 390 && text === 100)) continue; // the owner differs only by a class and a few controls inside the builder
      const who = owner ? 'owner' : 'director';
      const { ctx, page, errs } = await openPage(browser, { camp, w, scheme, text, role: 'editor', owner });
      // More: the Director group
      await page.evaluate(() => showTab('more'));
      await page.waitForTimeout(350);
      note(tag, who + ' More', await page.evaluate(MEASURE, '#tab-more'));
      if (shot && !owner) await page.screenshot({ path: OUT + 'step24-more-director-200.png' });
      if (owner) {
        note(tag, 'owner is the owner outside a preview', { extra: (await page.evaluate(() => isOwner())) ? [] : ['isOwner() false'] });
      }
      if (!owner) {
        // Tell everyone: empty, then with every channel, a partial failure and Showing now
        await page.click('#tell-row'); await page.waitForTimeout(650);
        note(tag, 'Tell everyone (empty)', await page.evaluate(MEASURE, '#takeover-tell'));
        await page.evaluate(() => {
          pushConfigured = () => true; fbConnected = true;
          tell.d.text = 'Storm warning. Everyone come inside now and wait in your cabin until the all clear.';
          tell.d.banner = true; tell.d.pin = true; tell.d.buzz = true; tell.d.aud = 'team'; tell.d.team = state.teams[1].id; tell.d.urgent = true;
          tell.result = { items: [{ way: 'banner', ok: true, text: 'Banner posted' }, { way: 'buzz', ok: false, text: "Buzz didn't go: Couldn't reach the alert sender — check your connection" }], text: 'x', plan: {} };
          renderAll();
        });
        await page.waitForTimeout(450);
        note(tag, 'Tell everyone (everything on)', await page.evaluate(MEASURE, '#takeover-tell'));
        if (shot) await page.screenshot({ path: OUT + 'step24-tell-200.png' });
        if (shotDark) await page.screenshot({ path: OUT + 'step24-tell-dark.png' });
        await page.evaluate(() => { closeTool(); tell.d = tellFreshDraft(); tell.result = null; pushConfigured = () => false; });
        await page.waitForTimeout(350);
        // Award points
        await page.evaluate(() => { inDoubleBonusWindow = () => true; bonusDraft.teams = [state.teams[1].id, state.teams[2].id]; bonusDraft.points = '5'; bonusDraft.custom = 'Great teamwork'; showTab('more'); openTool('award', { from: 'more' }); });
        await page.waitForTimeout(650);
        note(tag, 'Award points', await page.evaluate(MEASURE, '#takeover-award'));
        if (shotDark) await page.screenshot({ path: OUT + 'step24-award-dark.png' });
        await page.evaluate(() => { closeTool(); bonusDraft.teams = []; bonusDraft.points = ''; bonusDraft.custom = ''; });
        await page.waitForTimeout(350);
        // What counselors see, and the way into the preview
        await page.evaluate(() => showTab('more'));
        await page.click('#counselors-row'); await page.waitForTimeout(600);
        note(tag, 'What counselors see', await page.evaluate(MEASURE, '#sheet-counselors'));
        if (shot) await page.screenshot({ path: OUT + 'step24-counselors-200.png' });

        // ───────────── PREVIEW AS A COUNSELOR ─────────────
        await page.click('#counselors-preview-btn'); await page.waitForTimeout(700);
        const geo = await page.evaluate(() => {
          const bar = document.getElementById('preview-bar'); const exit = document.getElementById('preview-exit');
          const b = bar.getBoundingClientRect(); const x = exit.getBoundingClientRect();
          const pv = parseFloat(document.documentElement.style.getPropertyValue('--pv-h') || '0');
          const hdr = document.getElementById('app-header').getBoundingClientRect();
          return { on: previewIsOn(), barH: b.height, pv, exitW: x.width, exitH: x.height, hdrTop: hdr.top, vh: window.innerHeight, cls: document.documentElement.className, focus: document.activeElement && document.activeElement.id, role: memberRole, canEdit: canEdit(), frame: !document.getElementById('preview-frame').hidden, bg: getComputedStyle(bar).backgroundColor, tc: (document.getElementById('dynamic-theme-color') || {}).content };
        });
        const g = [];
        if (!geo.on) g.push('the preview did not start');
        if (Math.abs(geo.barH - geo.pv) > 1.5) g.push(`--pv-h ${geo.pv} is not the bar ${geo.barH}`);
        if (Math.abs(geo.hdrTop - geo.pv) > 1.5) g.push(`the header sits at ${geo.hdrTop}, the bar ends at ${geo.pv}`);
        if (geo.exitW < 43.5 || geo.exitH < 43.5) g.push(`Exit is ${geo.exitW}x${geo.exitH}`);
        if (geo.barH > geo.vh * 0.36) g.push(`the bar takes ${Math.round(geo.barH)} of ${geo.vh}px`);
        if (geo.focus !== 'preview-exit') g.push('focus is on ' + geo.focus + ', not Exit');
        if (geo.role !== 'editor') g.push('memberRole moved to ' + geo.role);
        if (geo.canEdit) g.push('canEdit() is still true');
        if (!geo.frame) g.push('no frame');
        if (!/view-only/.test(geo.cls) || !/counselor-preview/.test(geo.cls)) g.push('classes: ' + geo.cls);
        note(tag, 'preview geometry', { extra: g });
        for (const t of ['now', 'games', 'chat', 'more']) {
          await page.evaluate((t) => showTab(t), t); await page.waitForTimeout(450);
          const m = await page.evaluate(MEASURE, null);
          const leak = await page.evaluate(LEAKS);
          m.extra = [];
          if (leak.rows.length) m.extra.push('director rows on screen: ' + leak.rows.join(','));
          if (leak.words.length) m.extra.push('leaks: ' + leak.words.join(' / '));
          if (leak.ownerClass) m.extra.push('body.setup-owner in a preview');
          // sticky: after scrolling the page the header must still sit under the bar
          note(tag, 'preview ' + t, m);
          if (shot && t === 'now') await page.screenshot({ path: OUT + 'step24-preview-now-200.png' });
          if (shotDark && t === 'games') await page.screenshot({ path: OUT + 'step24-preview-games-dark.png' });
        }
        // a game takeover and the sheets a counselor can open, in the preview
        await page.evaluate(() => { showTab('games'); const g = state.config.games.find((x) => state.results[x.id]); openGame(g.id, { from: 'games' }); });
        await page.waitForTimeout(650);
        const tk = await page.evaluate(MEASURE, '#takeover-game');
        const tkTop = await page.evaluate(() => ({ top: document.getElementById('takeover-game').getBoundingClientRect().top, pv: parseFloat(document.documentElement.style.getPropertyValue('--pv-h') || '0') }));
        tk.extra = Math.abs(tkTop.top - tkTop.pv) > 1.5 ? [`the takeover starts at ${tkTop.top}, the bar ends at ${tkTop.pv}`] : [];
        const leakG = await page.evaluate(LEAKS); if (leakG.words.length) tk.extra.push('leaks: ' + leakG.words.join(' / '));
        note(tag, 'preview game takeover', tk);
        if (shotDark) await page.screenshot({ path: OUT + 'step24-preview-game-dark.png' });
        await page.evaluate(() => closeGame()); await page.waitForTimeout(300);
        for (const id of ['team', 'verse', 'cleanup']) {
          await page.evaluate((id) => { showTab('more'); shellSheetOpen(id); }, id); await page.waitForTimeout(550);
          const open = await page.evaluate((id) => shell.sheets.includes(id), id);
          if (!open) { rows.push(tag + ' preview sheet ' + id + ' not offered to a counselor here (hidden or none)'); continue; }
          const sm = await page.evaluate(MEASURE, '#sheet-' + id);
          const sh = await page.evaluate((id) => { const s = document.querySelector('#sheet-' + id + ' .sheet').getBoundingClientRect(); return { top: s.top, pv: parseFloat(document.documentElement.style.getPropertyValue('--pv-h') || '0') }; }, id);
          sm.extra = sh.top < sh.pv - 1 ? [`the sheet reaches up to ${Math.round(sh.top)}, under the bar (${sh.pv})`] : [];
          const lk = await page.evaluate(LEAKS); if (lk.words.length) sm.extra.push('leaks: ' + lk.words.join(' / '));
          note(tag, 'preview sheet ' + id, sm);
          await page.evaluate((id) => shellSheetClose(id), id); await page.waitForTimeout(300);
        }
        // the doors that must stay shut
        const doors = await page.evaluate(() => { openTool('tell'); openTool('award'); openReveal(); openBuilder(); shellSheetOpen('members'); shellSheetOpen('history'); shellSheetOpen('counselors'); return { tool: toolOpenId(), reveal: revealRemoteIsOpen(), builder: builderOpen(), sheets: shell.sheets.slice() }; });
        note(tag, 'preview doors shut', { extra: (doors.tool || doors.reveal || doors.builder || doors.sheets.length) ? ['opened: ' + JSON.stringify(doors)] : [] });
        // Exit: back to More with What counselors see open again
        await page.evaluate(() => showTab('now')); await page.waitForTimeout(300);
        await page.click('#preview-exit'); await page.waitForTimeout(800);
        const after = await page.evaluate(() => ({ on: previewIsOn(), can: canEdit(), tab: activeTab(), sheets: shell.sheets.slice(), pv: document.documentElement.style.getPropertyValue('--pv-h'), barHidden: document.getElementById('preview-bar').hidden, cls: document.documentElement.className, tc: (document.getElementById('dynamic-theme-color') || {}).content }));
        const ex = [];
        if (after.on || !after.can) ex.push('Exit did not give the director back');
        if (after.tab !== 'more' || !after.sheets.includes('counselors')) ex.push('Exit landed on ' + after.tab + ' with ' + JSON.stringify(after.sheets));
        if (after.pv) ex.push('--pv-h left behind: ' + after.pv);
        if (!after.barHidden) ex.push('the bar is still up');
        if (/counselor-preview|view-only/.test(after.cls)) ex.push('classes left: ' + after.cls);
        note(tag, 'preview exit', { extra: ex });
      }
      if (errs.length) { rows.push(tag + ' ' + who + ' PAGE ERRORS ' + JSON.stringify(errs)); bad.push(tag + ' ' + who + ' page errors ' + JSON.stringify(errs)); }
      await ctx.close();
    }

    // ───────────── a counselor ─────────────
    if (w === 390 || text === 200) {
      const { ctx, page, errs } = await openPage(browser, { camp, w, scheme, text, role: 'viewer' });
      await page.waitForTimeout(300);
      const m = await page.evaluate(MEASURE, null);
      const lk = await page.evaluate(LEAKS);
      m.extra = [];
      if (lk.rows.length) m.extra.push('director rows on screen: ' + lk.rows.join(','));
      if (lk.words.length) m.extra.push('leaks: ' + lk.words.join(' / '));
      const banner = await page.evaluate(() => { const b = document.querySelector('#announcements .msg'); if (!b) return 'no banner'; const r = b.getBoundingClientRect(); const rm = b.querySelector('.msg-remove'); return { h: r.height, remove: !!rm, x: Math.round(b.querySelector('.msg-x').getBoundingClientRect().width) + 'x' + Math.round(b.querySelector('.msg-x').getBoundingClientRect().height) }; });
      if (banner === 'no banner' || banner.remove) m.extra.push('counselor banner: ' + JSON.stringify(banner));
      note(tag, 'counselor Now', m);
      if (shot) await page.screenshot({ path: OUT + 'step24-counselor-now-200.png' });
      await page.evaluate(() => showTab('more')); await page.waitForTimeout(350);
      const mm = await page.evaluate(MEASURE, '#tab-more'); const lk2 = await page.evaluate(LEAKS);
      mm.extra = lk2.rows.length ? ['director rows on screen: ' + lk2.rows.join(',')] : [];
      note(tag, 'counselor More', mm);
      // a counselor has no preview and cannot start one
      const can = await page.evaluate(() => { const ok = previewStart(); return { ok, on: previewIsOn(), viewRole: viewRole() }; });
      note(tag, 'counselor cannot preview', { extra: can.ok || can.on ? ['a counselor started a preview'] : [] });
      if (errs.length) { rows.push(tag + ' counselor PAGE ERRORS ' + JSON.stringify(errs)); bad.push(tag + ' counselor page errors ' + JSON.stringify(errs)); }
      await ctx.close();
    }
  }
  console.log(rows.join('\n'));
  console.log('\n' + (bad.length ? 'ISSUES (' + bad.length + '):\n' + bad.join('\n') : 'NO ISSUES'));
  await browser.close();
})();
