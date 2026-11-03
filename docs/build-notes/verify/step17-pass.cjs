// BUILD-PLAN Step 17 — the Playwright pass over the REAL Now tab (the real scripts, the real renderers, Firebase blocked).
//
//   serve the worktree:   python3 -m http.server 8975 &      (kill it afterwards)
//   run:                  BASE=http://localhost:8975/ node docs/build-notes/verify/step17-pass.cjs
//   narrow it:            CAMPS=junior ROLES=counselor WIDTHS=360 SCHEMES=light TEXTS=100 ONLY=podium,reveal-live SHOTS=1 node …
//
// What it checks, for BOTH camps x counselor / director / director-on-a-team / owner x 360 and 390 px x light and dark x 100, 130 and 200%
// text (calm motion on, so the measuring never catches a spring mid-flight):
//   - EVERY KIND of card, found by scanning the model over the whole week (the clock is `?now=<dow>-<hhmm>`, campNowOverride(): the one
//     debug door, changing only what this device draws): games (done / live / not started, the podium, the tally, the 4-team bracket),
//     elective (station, break, the ask, every station), meal, cleanup and verse moments, Bible study, meeting, worship, activity, bedtime,
//     arrival, send-off (with the posted notice as the card), between, morning, night, none, over;
//   - the messages strip (the notice + banners, "N more"), the three sheets (notice, messages, who's where);
//   - the PODIUM strip at 360 with the widest podium and 20-character team names (CAMP_SHORT_MAX), at every text size;
//   - a LONG "Running over" (44 minutes past its block, with a live game; and held by a director) at every text size;
//   - the REVEAL on the new Now: the live mirror puts the Now card / lists / notice strip away (banners stay), the frozen grid sits with
//     the Now card, the champion line shows a name and no number, and none of them leak a point to a counselor;
//   - for each view: no tap target under 44x44, no sideways scroll, nothing sticking out of its card, no squeezed text, no page error;
//   - a counselor's Now holds no director control and no number (a leak scan over its text).
// `SHOTS=1` writes a screenshot per scenario (100% text, 390 px, light) under SHOT_DIR. Prints a list of problems; exit code 1 if any.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8975/';
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/step17-shots/';
const list = (v, d) => (process.env[v] ? process.env[v].split(',') : d);
const CAMPS = list('CAMPS', ['junior', 'senior']);
const ROLES = list('ROLES', ['counselor', 'director', 'director-team', 'owner']);
const WIDTHS = list('WIDTHS', ['360', '390']).map(Number);
const SCHEMES = list('SCHEMES', ['light', 'dark']);
const TEXTS = list('TEXTS', ['100', '130', '200']).map(Number);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
if (process.env.SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

// ── in the page ──────────────────────────────────────────────────────────────────────────────────────────────
// Installed once per page. Everything a scenario needs is a function of the camp's own data, so both camps run the same script.
const INSTALL = () => {
  const T = () => state.teams.map((t) => t.id);
  const day = (d) => nowBlocks(d);
  window.__np = {
    // the clock for a scenario (the same door a developer uses: ?now=)
    at(dow, minutes) { history.replaceState(null, '', location.pathname + '?now=' + dow + '-' + String(Math.floor(minutes / 60)).padStart(2, '0') + String(minutes % 60).padStart(2, '0')); },
    reset(role, camp) {
      document.querySelectorAll('jelly-dialog[open]').forEach((d) => d.removeAttribute('open'));
      const tp = document.getElementById('team-picker-overlay'); if (tp) tp.remove();
      ['sdk-banner'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
      shell.sheets.slice().forEach((id) => shellSheetClose(id));
      state.results = {}; state.drafts = {}; state.brackets = {}; state.brackets4 = {}; state.clocks = {}; state.bonuses = {};
      state.meta.overrun = undefined; state.announcements = {}; state.notice = defaultNotice();
      state.teams.forEach((t, i) => { delete t.short; });
      try { (0, eval)('authUser = null'); } catch (e) { /* none */ }
      if (role === 'counselor') { setMemberRole('viewer'); setMemberTeam(null); state.followTeam = T()[0]; state.identity = camp === 'junior' ? 'Sam' : null; }
      else {
        if (role === 'owner') (0, eval)("authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: true, uid: 'owner' }");
        setMemberRole('editor'); setMemberTeam(role === 'director-team' ? T()[1] : null); state.followTeam = role === 'director-team' ? T()[1] : T()[0]; state.identity = null;
      }
      // the same rota on both camps (senior's is empty until a director fills it in), so the cleanup moment is seen on both
      (0, eval)("cleanupOnRota = (d) => d >= 1 && d <= 5; cleanupTeams = (d, meal) => (d < 1 || d > 5 ? [] : meal === 'Breakfast' ? [state.teams[0].id] : meal === 'Lunch' ? [state.teams[1].id, state.teams[2].id] : [])");
      weatherData = null;
    },
    games(dow) { // a games block's games: one done, one live (a tally), the rest not started
      const nb = day(dow).find((x) => x.kind === 'games' && gamesForBlock(dow, x.b).length);
      const gs = nb ? gamesForBlock(dow, nb.b) : [];
      const t = T();
      if (gs[0]) state.results[gs[0].id] = { medals: { gold: t[2], silver: t[0], bronze: t[1] }, savedAt: new Date().toISOString() };
      if (gs[1]) { Object.assign(gs[1], { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false }); state.drafts[gs[1].id] = { scores: { [t[3 % t.length]]: '48', [t[0]]: '41', [t[2]]: '36' } }; }
      return { nb, gs };
    },
    // the first (dow, minute) at which the model has each distinct picture; the middle of the week first
    scan() {
      const seen = {};
      const ms = Date.now();
      [3, 2, 4, 1, 5, 0, 6].forEach((dow) => {
        for (let m = 0; m < 1440; m += 5) {
          let mod; try { mod = nowModel({ now: { dow, minutes: m }, ms, forced: true }); } catch (e) { continue; }
          const c = mod.card; if (!c) continue;
          const sig = c.kind + (mod.moment ? ':m-' + mod.moment.kind : '') + (c.over ? ':over' : '');
          if (!seen[sig]) seen[sig] = { sig, dow, minutes: m, kind: c.kind, moment: mod.moment ? mod.moment.kind : null };
        }
      });
      return Object.values(seen);
    },
    names20() { // the widest names the camp allows (CAMP_SHORT_MAX = 20), full names AND short names
      const w = ['WWWWWWWWWWWWWWWWWWWW', 'Magnificent Mammoths', 'MMMMM MMMMM MMMMM MMM', 'Wonderful Wobbly Wolf'].map((s) => s.slice(0, 20));
      state.teams.forEach((t, i) => { t.name = w[i % w.length]; t.short = w[i % w.length]; });
    },
  };
};

// ── the measuring (in the page) ──────────────────────────────────────────────────────────────────────────────
const MEASURE = (sel) => {
  const shown = (e) => { if (e.closest('[hidden]')) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const root = document.querySelector(sel || '#tab-now');
  const out = { small: [], overflow: [], sideways: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), clipped: [] };
  const tgt = 'button, a[href], [role="tab"], [role="radio"], [role="button"], summary';
  root.querySelectorAll(tgt).forEach((el) => {
    if (!shown(el) || el.closest('#setup')) return;
    let r = el.getBoundingClientRect();
    if (el.classList.contains('gr-hit')) r = el.closest('.gr').getBoundingClientRect(); // ONE stretched target over the row
    if (Math.min(r.width, r.height) < 43.5) out.small.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + '.' + String(el.className).split(' ')[0] + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"');
  });
  const W = window.innerWidth;
  root.querySelectorAll('*').forEach((e) => {
    if (!shown(e)) return;
    const r = e.getBoundingClientRect();
    if (r.right > W + 1.5 && !e.closest('.daypick, .chat-tabs, [data-scroll]')) out.clipped.push((e.className && e.className.baseVal === undefined ? e.className : e.tagName).toString().split(' ')[0] + ' right ' + Math.round(r.right) + ' > ' + W);
  });
  const textSel = '.nw-label, .nw-sub, .gr-name, .gr-sub, .pd-nm, .lb-nm, .b4-nm, .nr-title, .nr-sub, .nm-name, .nm-who, .es-st-who, .nn-title, .nb-place, .nb-team, .vs-text, .nw-row-t, .nw-welcome-t, .lb-cap, .rv-title, .rv-row, .nm-label, .aw-name';
  root.querySelectorAll(textSel).forEach((e) => {
    if (!shown(e)) return;
    const r = e.getBoundingClientRect();
    const card = e.closest('.nw-card, .nw-sec, .msg, .now-reveal, .reveal-grid, .nm, .nb');
    if (card) { const c = card.getBoundingClientRect(); if (r.right > c.right + 1 || r.left < c.left - 1) out.overflow.push((e.className + ' "' + e.textContent.trim().slice(0, 18) + '" sticks out ' + Math.round(Math.max(r.right - c.right, c.left - r.left)))); }
    const clamp = getComputedStyle(e).webkitLineClamp;
    if (getComputedStyle(e).overflow === 'visible' && e.scrollWidth > e.clientWidth + 1) out.overflow.push(e.className + ' "' + e.textContent.trim().slice(0, 18) + '" ' + e.scrollWidth + '>' + e.clientWidth);
    if (clamp && clamp !== 'none' && e.scrollWidth > e.clientWidth + 1) out.overflow.push(e.className + ' (clamped) scrolls sideways ' + e.scrollWidth + '>' + e.clientWidth);
    if (r.width < 70 && e.textContent.trim().length > 14 && !e.classList.contains('pd-nm')) out.overflow.push(e.className + ' squeezed ' + Math.round(r.width) + 'px');
  });
  root.querySelectorAll('.gr').forEach((g) => {
    const s = g.querySelector('.gr-score'); const n = g.querySelector('.gr-name');
    if (s && n && shown(s)) { const a = s.getBoundingClientRect(); const b = n.getBoundingClientRect(); if (a.left < b.right - 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) out.overflow.push('Score overlaps ' + n.textContent.trim().slice(0, 18)); }
  });
  // the podium: three cells inside the row, none sticking out of it, the disc and the name both in view
  root.querySelectorAll('.pd').forEach((pd) => {
    if (!shown(pd)) return;
    const p = pd.getBoundingClientRect();
    pd.querySelectorAll('.pd-c').forEach((c) => {
      const r = c.getBoundingClientRect();
      if (r.left < p.left - 1 || r.right > p.right + 1) out.overflow.push('podium cell outside its strip');
      const disc = c.querySelector('.pd-disc').getBoundingClientRect();
      if (disc.right > r.right + 0.5 || disc.left < r.left - 0.5) out.overflow.push('podium disc outside its cell');
      const nm = c.querySelector('.pd-nm'); const nr = nm.getBoundingClientRect();
      if (nr.right > r.right + 0.5 || nr.left < r.left - 0.5) out.overflow.push('podium name outside its cell');
      const lh = parseFloat(getComputedStyle(nm).lineHeight) || 16;
      if (nr.height > lh * 3 + 2) out.overflow.push('podium name taller than three lines: ' + Math.round(nr.height));
    });
  });
  return out;
};

// What a counselor must never read on Now (a leak scan over the text a person sees) and never be offered.
const COUNSELOR_LEAK = () => {
  const root = document.getElementById('tab-now');
  const shown = (e) => { if (e.closest('[hidden]')) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const bad = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; const texts = [];
  // (the notice's own words are a director's copy — "nothing left behind" — so they are not scanned for the gap word; its structure is)
  while ((n = walk.nextNode())) { if (n.parentElement && shown(n.parentElement) && !n.parentElement.closest('.nb-signoff, .nb-items, .nb-place small, .nn-sub, .nb-yours-p small') && n.textContent.trim()) texts.push(n.textContent.trim()); }
  const all = texts.join(' | ');
  [[/\bpts?\b/i, 'points'], [/(^|[\s(])[+−-]\d+\b/, 'a signed number'], [/\b\d+(st|nd|rd|th)\b/i, 'an ordinal place'], [/\b(trail|trails|trailing|behind|ahead)\b/i, 'a gap word']]
    .forEach(([re, why]) => { const m = re.exec(all.replace(/\d{1,2}:\d\d/g, '')); if (m) bad.push(why + ': ' + all.slice(Math.max(0, m.index - 30), m.index + 40)); });
  ['.aw-pt', '[data-score-game]', '[data-todo]', '.lb-pl', '[data-ranked]', '#now-card-hold', '#now-card-down', '#now-notice-down', '.nm-saved', '[data-now-setup]'].forEach((s) => {
    [...root.querySelectorAll(s)].filter(shown).forEach(() => bad.push('a director control is shown: ' + s));
  });
  return bad;
};

// ── the scenarios ────────────────────────────────────────────────────────────────────────────────────────────
// Each: { n, camp?, roles?, at: [dow, minutes] | 'scan:<sig>', setup(): string (page JS), sheet?, roles? }
function buildScenarios(camp, scan) {
  const S = [];
  const add = (s) => S.push(Object.assign({ roles: null, text: TEXTS }, s));
  // every distinct card the model draws, by scan; games rows carry a done + a live + a not-started game
  scan.forEach((sc) => {
    const setup = [];
    if (sc.kind === 'games' || sc.kind === 'over' && false) setup.push('__np.games(' + sc.dow + ')');
    if (sc.kind === 'meal') setup.push("state.followTeam = cleanupTeams(" + sc.dow + ", 'Lunch')[0] || state.followTeam");
    if (sc.kind === 'sendoff') setup.push("state.notice.status = 'draft'");
    add({ n: 'kind:' + sc.sig, at: [sc.dow, sc.minutes], setup: setup.join(';') });
  });
  // the same games card the other way round: nothing scored yet, and the 4-team bracket (senior's Legacy Game)
  add({ n: 'games-none-scored', at: 'games', setup: '' });
  if (camp === 'senior') {
    add({ n: 'games-bracket4', at: 'games', setup: "const g = state.config.games.find((x) => /legacy/i.test(x.name)) || gamesForBlock(3, nowBlocks(3).find((x) => x.kind === 'games').b)[0]; const t = state.teams.map((x) => x.id); state.brackets4 = { [g.id]: { m: { s1: { a: t[0], b: t[3], winner: t[0] }, s2: { a: t[1], b: t[2] }, third: {}, final: {} } } }; g.format = 'tournament'" });
  }
  // the send-off: the posted notice IS the card
  add({ n: 'sendoff-notice', at: [6, 9 * 60], setup: "state.notice.status = 'posted'" });
  // electives (junior): my station, the ask, every station, a counselor on break
  if (camp === 'junior') {
    add({ n: 'elective-station', at: 'elective', roles: ['counselor'], setup: "state.identity = 'Sam'" });
    add({ n: 'elective-ask', at: 'elective', roles: ['counselor'], setup: 'state.identity = undefined' });
    add({ n: 'elective-whos-where', at: 'elective', roles: ['counselor'], setup: "state.identity = 'Sam'", sheet: 'whos-where' });
  }
  // messages: the posted notice strip + three banners, and the sheet that holds the rest
  const banners = "state.notice.status = 'posted'; state.announcements = {}; [['a1','Water break at the Snack Shack after Axe Throwing. Bring bottles.'],['a2','Supper moves to 5:30. The kitchen is running late.'],['a3','Lost and found is on the porch until Friday.'],['a4','Sunscreen is in the blue bin by the dock.']].forEach(([id,t],i)=>{state.announcements[id]={id,text:t,at:new Date(Date.now()-i*1000).toISOString(),by:'Jenn',ttlMs:3600000};})";
  add({ n: 'messages-strip', at: 'games', setup: banners });
  add({ n: 'messages-sheet', at: 'games', setup: banners, sheet: 'messages' });
  add({ n: 'notice-sheet', at: 'games', setup: "state.notice.status = 'posted'", sheet: 'notice' });
  // the podium at its widest: three medal winners, every name 20 characters of the widest letters (360 is where it is tightest)
  add({ n: 'podium-20', at: 'games', setup: '__np.names20(); __np.games(3)', podium: true });
  // a LONG "Running over": 44 minutes past the block with a game still live, and one a director held
  add({ n: 'running-over-44', at: 'over44', setup: '', over: true });
  add({ n: 'running-over-held', at: 'over10', setup: '', over: 'held' });
  return S;
}

// resolve a symbolic time to [dow, minutes] in the page
const RESOLVE = ({ at }) => {
  if (Array.isArray(at)) return at;
  const blocks = (d) => nowBlocks(d);
  if (at === 'games') { for (const d of [3, 2, 4, 1, 5]) { const nb = blocks(d).find((x) => x.kind === 'games' && gamesForBlock(d, x.b).length); if (nb) return [d, nb.b.start + 5]; } }
  if (at === 'elective') { for (const d of [3, 2, 4, 1, 5]) { const nb = blocks(d).find((x) => x.kind === 'elective'); if (nb) return [d, nb.b.start + 5]; } }
  // as long past the block as the card can be held: 44 minutes, or one before the next games block starts (nowGamesCap)
  if (at === 'over44') { for (const d of [3, 2, 4, 1, 5]) { const bl = blocks(d); const nb = bl.find((x) => x.kind === 'games' && gamesForBlock(d, x.b).length); if (nb) return [d, Math.min(nb.end + 44, nowGamesCap(bl, nb) - 1)]; } }
  // a hold with room left: 10 minutes past the block, the button still has something to add
  if (at === 'over10') { for (const d of [3, 2, 4, 1, 5]) { const bl = blocks(d); const nb = bl.find((x) => x.kind === 'games' && gamesForBlock(d, x.b).length); if (nb) return [d, Math.min(nb.end + 10, nowGamesCap(bl, nb) - 1)]; } }
  return [3, 10 * 60 + 30];
};

(async () => {
  const browser = await chromium.launch();
  const problems = []; let views = 0; const seenScenarios = new Set();
  for (const camp of CAMPS) for (const role of ROLES) for (const w of WIDTHS) for (const scheme of SCHEMES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York' });
    await ctx.addInitScript(({ camp, role }) => { try { localStorage.setItem('campScoreboardAuthHint', role === 'counselor' ? 'viewer' : 'editor'); if (camp === 'senior') localStorage.setItem('campScoreboardActiveCamp', 'senior'); } catch (e) { /* none */ } }, { camp, role });
    const page = await ctx.newPage();
    const tag0 = `${camp} ${role} ${w} ${scheme}`;
    page.on('pageerror', (e) => problems.push(tag0 + ' pageerror ' + String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|ERR_FAILED/.test(m.text())) problems.push(tag0 + ' console ' + m.text().slice(0, 200)); });
    await page.route(/gstatic\.com|googleapis\.com|firebaseio\.com|open-meteo/, (r) => r.abort());
    await page.goto(BASE + 'index.html?now=3-1030', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof setMemberRole === 'function' && typeof nowModel === 'function' && !!customElements.get('jelly-drawer'), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate(INSTALL);
    await page.addStyleTag({ content: '#sdk-banner, #hdr-pill, jelly-toaster, #sync-status-footer { display: none !important; } jelly-dialog { display: none !important; }' });
    const scan = await page.evaluate(() => { __np.reset('director', CAMP.id); return __np.scan(); });
    const scenarios = buildScenarios(camp, scan).filter((s) => !ONLY || ONLY.some((o) => s.n.includes(o)));
    for (const sc of scenarios) {
      if (sc.roles && !sc.roles.includes(role)) continue;
      const at = await page.evaluate(RESOLVE, sc);
      await page.evaluate(({ role, camp, at, setup }) => {
        __np.reset(role, camp);
        __np.at(at[0], at[1]);
        if (setup) (0, eval)(setup.replace(/\bconst /g, 'var ').replace(/\blet /g, 'var '));
      }, { role, camp, at, setup: sc.setup });
      // a long Running over: the games block ended minutes ago and EITHER a game in it is still Live (the card holds itself; no
      // "Still on this" is offered, nothing is left to ask for) OR a director said "Still on this" (nothing live: the button has room to add)
      if (sc.over) {
        await page.evaluate(({ at, held }) => {
          const bl = nowBlocks(at[0]);
          const nb = bl.find((x) => x.kind === 'games' && gamesForBlock(at[0], x.b).length);
          const gs = gamesForBlock(at[0], nb.b);
          if (held) state.meta.overrun = { key: at[0] + ':' + nb.id, until: serverNow() + 20 * 60000 };
          else { const g = gs[gs.length - 1]; Object.assign(g, { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false }); state.drafts[g.id] = { scores: { [state.teams[0].id]: '3', [state.teams[1].id]: '2' } }; }
        }, { at, held: sc.over === 'held' });
      }
      for (const text of sc.text) {
        await page.evaluate((t) => { document.documentElement.style.fontSize = t === 100 ? '' : t + '%'; renderAll(); }, text);
        await page.waitForTimeout(120);
        if (sc.sheet) { await page.evaluate((id) => { shellSheetOpen(id); renderAll(); }, sc.sheet); await page.waitForTimeout(150); }
        const m = await page.evaluate(MEASURE, sc.sheet ? '#sheet-' + sc.sheet : '#tab-now'); views++;
        const tag = `${sc.n} | ${camp} ${role} ${w} ${scheme} ${text}%`;
        const model = await page.evaluate(() => ({ kind: document.getElementById('now-card').dataset.kind, over: document.getElementById('now-card').hasAttribute('data-over'), left: document.getElementById('now-card-left').textContent, hold: !document.getElementById('now-card-hold').hidden }));
        if (m.small.length) problems.push(tag + ' small: ' + m.small.join(' | '));
        if (m.sideways) problems.push(tag + ' sideways ' + m.sideways + 'px');
        if (m.clipped.length) problems.push(tag + ' sticks out of the screen: ' + [...new Set(m.clipped)].slice(0, 4).join(' | '));
        if (m.overflow.length) problems.push(tag + ' overflow: ' + [...new Set(m.overflow)].slice(0, 5).join(' | '));
        if (sc.over && !(model.kind === 'games' && model.over && /min over/.test(model.left))) problems.push(tag + ' the long Running over is not on the card: ' + JSON.stringify(model));
        if (sc.over === 'held' && role !== 'counselor' && !model.hold) problems.push(tag + ' a director\'s held card has no Still on this button');
        if (sc.over && role === 'counselor' && model.hold) problems.push(tag + ' a counselor was offered Still on this');
        if (role === 'counselor' && text === 100) { const leak = await page.evaluate(COUNSELOR_LEAK); if (leak.length) problems.push(tag + ' LEAK ' + leak.join(' | ')); }
        if (sc.sheet) await page.evaluate((id) => shellSheetClose(id), sc.sheet);
        if (process.env.SHOTS && text === (Number(process.env.SHOT_TEXT) || 100) && w === (Number(process.env.SHOT_W) || 390) && scheme === (process.env.SHOT_SCHEME || 'light') && (role === 'counselor' || role === 'director') && camp === CAMPS[0]) {
          await page.evaluate(() => window.scrollTo(0, 0));
          if (sc.sheet) { await page.evaluate((id) => shellSheetOpen(id), sc.sheet); await page.waitForTimeout(600); } // let the sheet land
          await page.screenshot({ path: `${SHOT_DIR}${camp}-${role}-${sc.n.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: !sc.sheet });
          if (sc.sheet) await page.evaluate((id) => shellSheetClose(id), sc.sheet);
        }
        seenScenarios.add(camp + ' ' + sc.n);
      }
    }
    // ── the reveal on the new Now (a counselor's mirror, the frozen grid, the champion line) ──
    if (!ONLY || ONLY.some((o) => 'reveal'.includes(o) || o.startsWith('reveal'))) {
      for (const phase of ['live', 'grid', 'champion']) {
        const tag = `reveal-${phase} | ${camp} ${role} ${w} ${scheme}`;
        await page.evaluate(({ role, camp }) => { __np.reset(role, camp); __np.at(3, 10 * 60 + 30); }, { role, camp });
        const info = await page.evaluate(({ phase }) => {
          // the server's clock is this phone's clock; a reveal started a minute ago, the newest place shown 20 s ago (past the phone's 3 s hold)
          serverTimeOffset = 0; serverOffsetKnown = true;
          const T0 = serverNow(); const N = CAMP.teamCount;
          const ent = (id, p) => ({ nm: teamName(id), p, g: 1, s: 1, b: 0, v: 4, m: 2, c: 3 });
          const pub = (shown) => { const o = {}; for (let i = 0; i < shown; i++) { const tid = 't' + (N - 1 - i); o['g' + i] = { place: N - i, e: { [tid]: ent(tid, 10 * (N - i)) } }; } return o; };
          const ctl = (o) => Object.assign({ v: 1, id: 'r1kz9fxq-4hd2', seq: 3, phase: 'live', cur: 1, shown: 2, teams: N, finale: false, at: T0 - 20000, sa: T0 - 20000, ca: T0 - 60000, startedAt: T0 - 60000, until: untilFor(T0, false) }, o || {});
          const node = phase === 'live' ? { ctl: ctl(), pub: pub(2) } : { ctl: ctl({ phase: 'table', cur: N - 1, shown: N, finale: phase === 'champion', at: T0 - 20000, sa: T0 - 30000 }), pub: pub(N) };
          revealAccept('real', node, 'snapshot');
          renderAll();
          const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; };
          return {
            mirror: vis('now-reveal'), grid: vis('now-reveal-grid'), champ: vis('now-champion'), attr: document.getElementById('tab-now').dataset.reveal || '',
            card: vis('now-card'), todo: vis('now-todo'), next: vis('now-next'), later: vis('now-later'), notice: vis('now-notice'),
            champName: (document.getElementById('now-champion-name') || {}).textContent || '',
          };
        }, { phase });
        if (phase === 'live') {
          if (!info.mirror || info.attr !== 'live') problems.push(tag + ' the live mirror is not up: ' + JSON.stringify(info));
          if (info.card || info.todo || info.next || info.later || info.notice) problems.push(tag + ' the Now card / lists are not put away under the mirror: ' + JSON.stringify(info));
          if (info.champ) problems.push(tag + ' the champion line shows over the live mirror');
        } else if (phase === 'grid') {
          if (role === 'counselor' && !info.grid) problems.push(tag + ' a counselor has no frozen grid: ' + JSON.stringify(info));
          if (info.mirror) problems.push(tag + ' the mirror is still up after the table');
          if (!info.card) problems.push(tag + ' the Now card is not shown with the grid: ' + JSON.stringify(info));
          if (info.champ && info.grid) problems.push(tag + ' the champion line shows beside the grid');
        } else if (phase === 'champion') {
          // the reveal's table is the grid; the champion line outlives it (name only) once the grid has gone at 8 AM
          await page.evaluate(() => { const T0 = serverNow(); serverTimeOffset = (confirmedReveal.real.ctl.until + 1000) - Date.now(); revealTick('timer'); renderAll(); });
          const c = await page.evaluate(() => { const e = document.getElementById('now-champion'); const g = document.getElementById('now-reveal-grid'); return { champ: !!e && !e.hidden && getComputedStyle(e).display !== 'none', name: (document.getElementById('now-champion-name') || {}).textContent || '', mark: ((document.getElementById('now-champion-mark') || {}).textContent || ''), grid: !!g && !g.hidden && getComputedStyle(g).display !== 'none' }; });
          if (!c.champ || !c.name) problems.push(tag + ' the champion line is not there after the grid went: ' + JSON.stringify(c));
          if (/\d/.test(c.name + c.mark)) problems.push(tag + ' a number in the champion line: ' + c.name);
          if (c.grid) problems.push(tag + ' the grid outlived its 8 AM');
        }
        for (const text of TEXTS) {
          await page.evaluate((t) => { document.documentElement.style.fontSize = t === 100 ? '' : t + '%'; renderAll(); }, text);
          await page.waitForTimeout(100);
          const m = await page.evaluate(MEASURE); views++;
          const t2 = `${tag} ${text}%`;
          if (process.env.SHOTS && text === (Number(process.env.SHOT_TEXT) || 100) && w === (Number(process.env.SHOT_W) || 390) && scheme === (process.env.SHOT_SCHEME || 'light') && (role === 'counselor' || role === 'director') && camp === CAMPS[0]) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: `${SHOT_DIR}${camp}-${role}-reveal_${phase}.png`, fullPage: true });
          }
          if (m.small.length) problems.push(t2 + ' small: ' + m.small.join(' | '));
          if (m.sideways) problems.push(t2 + ' sideways ' + m.sideways + 'px');
          if (m.clipped.length) problems.push(t2 + ' sticks out: ' + [...new Set(m.clipped)].slice(0, 4).join(' | '));
          if (m.overflow.length) problems.push(t2 + ' overflow: ' + [...new Set(m.overflow)].slice(0, 5).join(' | '));
          if (role === 'counselor' && text === 100 && phase !== 'champion') {
            // the reveal's own places are public ONCE SHOWN, so only a director control or a point is a leak here
            const leak = await page.evaluate(() => { const root = document.getElementById('tab-now'); const bad = []; ['.aw-pt', '[data-score-game]', '[data-todo]', '#now-card-hold', '#now-card-down', '.nm-saved', '[data-now-setup]'].forEach((s) => { [...root.querySelectorAll(s)].forEach((e) => { if (!e.closest('[hidden]') && getComputedStyle(e).display !== 'none') bad.push(s); }); }); const txt = root.innerText || ''; if (/\bpts?\b/i.test(txt)) bad.push('the word pts'); return bad; });
            if (leak.length) problems.push(tag + ' LEAK ' + leak.join(','));
          }
        }
        await page.evaluate(() => { confirmedReveal.real = null; revealLoaded.real = false; localStorage.removeItem(lsKey(REVEAL_CACHE_KEY)); localStorage.removeItem(lsKey(REVEAL_CHAMPION_KEY)); serverTimeOffset = 0; renderAll(); });
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(views + ' views checked, ' + seenScenarios.size + ' scenarios');
  console.log(problems.length ? [...new Set(problems)].join('\n') : 'no problems');
  process.exit(problems.length ? 1 : 0);
})();
