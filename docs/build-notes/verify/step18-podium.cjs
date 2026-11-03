// Step 18, build session 2: the game takeover's podium picker, its Save, the saved result and Next game, in a REAL browser.
//   node step18-podium.cjs [baseUrl]      (SHOTS=1 writes screenshots to OUT, default the OS temp dir + /shots18p/; QUICK=1: 390 light 100% only;
//                                          CAMPS=junior or CAMPS=senior runs one camp; TEXTS=200 or TEXTS=100,200 limits the text sizes)
// Serve the worktree first: python3 -m http.server 8963 (Firebase is blocked; the role is set in the page, as the other passes do).
// PART 1 (views): for each camp, role (director / director on a team / counselor), width (360 / 390), theme and text size (100 / 130 / 200 %) it
// opens a podium game's takeover and walks the picker through its states (nothing picked, gold and silver picked, all three, saved), with the
// WIDEST podium: three teams named with 20 characters (a long word, and the 20 widest letters). It reports console errors, tap targets under
// 44x44, sideways scroll, a key whose name runs out of its box, and for a counselor that no picker / Save / number is on the page.
// PART 2 (behaviour, junior director 390): later rows wait; a pick opens the next row and names the taken team in the others; the SAME nodes
// stay (identity, so the next row cross-fades and focus stays); the same key again clears; per-leaf draft writes; a snapshot that moves a pick
// patches in place; Save well goes to the missing row; Save writes and moves focus to Next game; "Saving…" becomes "Saved … everyone's phone has it"
// only when the server confirms; Next game opens the next game and ONE Back leaves; Change the result asks first (Keep it / Clear it and pick
// again); calm motion creates no transform keyframe for a pick.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = (process.argv[2] || 'http://127.0.0.1:8963').replace(/\/$/, '');
const OUT = (process.env.OUT || require('os').tmpdir()) + '/shots18p/';
if (process.env.SHOTS) fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const say = (m) => { problems.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

const LONG_WORD = 'Supercalifragilistic'; // 20 characters, no break opportunity
const WIDE = 'WWWWWWWWWWWWWWWWWWWW'; // 20 of the widest letter
const SPACED = 'Particularly Perilous'; // 21: two words

async function open(browser, { camp, role, team, w, scheme, text, wide }) {
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
  const info = await page.evaluate(({ role, team, text, wide, LONG_WORD, WIDE, SPACED }) => {
    const sdk = document.getElementById('sdk-banner'); if (sdk) sdk.remove();
    document.documentElement.style.fontSize = text + '%';
    setMemberRole(role);
    const ids = state.teams.map((t) => t.id);
    if (wide) { // the widest podium: three teams with 20-character names
      [LONG_WORD, WIDE, SPACED].forEach((nm, i) => { state.teams[i].short = nm.slice(0, 20); state.teams[i].name = nm === SPACED ? 'Particularly Perilous Pumpkins' : nm; });
    }
    // podium games of the camp: the first two with no result are the ones under test, one more finished
    const pods = state.config.games.filter((g) => g.format !== 'tournament' && g.format !== 'tally');
    pods.forEach((g) => { delete state.results[g.id]; delete state.drafts[g.id]; });
    const fin = pods[pods.length - 1];
    state.results[fin.id] = { medals: { gold: ids[0], silver: ids[1], bronze: ids[2] }, savedAt: new Date().toISOString() };
    state.bonuses = {};
    if (team) { setMemberTeam(ids[0]); state.followTeam = ids[0]; }
    state.ui.tab = 'games'; state.ui.day = pods[0].dayId; shellStamp(); renderAll();
    return { pod: pods[0].id, pod2: pods[1] ? pods[1].id : null, fin: fin.id, ids };
  }, { role, team, text, wide, LONG_WORD, WIDE, SPACED });
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: '#sdk-banner{display:none!important}' });
  return { ctx, page, errors, info };
}

// Targets under 44x44, sideways scroll, a key's name that runs out of its box — inside the takeover.
async function audit(page, label) {
  const r = await page.evaluate(() => {
    const root = document.getElementById('takeover-game');
    const small = [];
    root.querySelectorAll('button, a[href], input, select, textarea, summary').forEach((el) => {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || !b.width || !b.height) return;
      if (el.closest('[hidden]')) return;
      if (b.width < 43.5 || b.height < 43.5) small.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
    });
    const sideways = root.scrollWidth > root.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1;
    const clipped = [];
    root.querySelectorAll('.pp-nm, .pp-medal, .pp-pts, .pp-wait, .pp-taken, .gres-nm, .gres-s-nm, .gd-left, .gd-go-t, .gd-go-s, .gd-back, .gd-save, .gsv').forEach((el) => {
      if (el.closest('[hidden]') || el.hidden) return;
      const b = el.getBoundingClientRect(); if (!b.width) return;
      const cs = getComputedStyle(el);
      const wide = el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible';
      const tall = el.classList.contains('pp-nm') && el.scrollHeight > el.clientHeight + 1; // the two-line clamp cut a name
      if (wide || tall) clipped.push((el.className || el.id).toString().slice(0, 24) + (tall ? ' (cut by the line clamp: ' + el.textContent.trim().slice(0, 22) + ')' : ' wider than its box'));
    });
    // a key must keep its text inside the key
    const spill = [];
    root.querySelectorAll('.pp-team').forEach((k) => {
      if (k.closest('[hidden]')) return;
      const kb = k.getBoundingClientRect();
      k.querySelectorAll('.pp-nm').forEach((n) => { const nb = n.getBoundingClientRect(); if (nb.right > kb.right + 1 || nb.left < kb.left - 1) spill.push(n.textContent.trim().slice(0, 22)); });
    });
    return { small, sideways, clipped, spill };
  });
  if (r.small.length) say(label + ': targets under 44x44: ' + [...new Set(r.small)].slice(0, 6).join(', '));
  if (r.sideways) say(label + ': sideways scroll');
  if (r.clipped.length) say(label + ': text clipped: ' + [...new Set(r.clipped)].join(', '));
  if (r.spill.length) say(label + ': a name spills out of its key: ' + [...new Set(r.spill)].join(', '));
}

async function pickKey(page, medal, team) {
  await page.evaluate(({ medal, team }) => document.querySelector(`#podium-picker .pp-row[data-medal="${medal}"] [data-team="${team}"]`).scrollIntoView({ block: 'center' }), { medal, team });
  await page.click(`#podium-picker .pp-row[data-medal="${medal}"] [data-team="${team}"]`);
  await page.waitForTimeout(250);
}

(async () => {
  const browser = await chromium.launch();
  const quick = !!process.env.QUICK;
  const camps = process.env.CAMPS ? process.env.CAMPS.split(',') : ['junior', 'senior'];
  const configs = [];
  for (const camp of camps) {
    for (const [role, team] of [['editor', null], ['editor', 'first'], ['viewer', null]]) {
      for (const w of quick ? [390] : [360, 390]) {
        for (const scheme of quick ? ['light'] : ['light', 'dark']) {
          for (const text of quick ? [100] : (process.env.TEXTS ? process.env.TEXTS.split(',').map(Number) : [100, 130, 200])) configs.push({ camp, role, team, w, scheme, text });
        }
      }
    }
  }
  let n = 0;
  for (const c of configs) {
    const label = `${c.camp} ${c.role}${c.team ? '+team' : ''} ${c.w}px ${c.scheme} ${c.text}%`;
    // the widest podium and a normal one: the extreme names only at 100 and 200 %, to keep the pass to minutes
    for (const wide of (c.text === 130 ? [false] : [true])) {
      const { ctx, page, errors, info } = await open(browser, Object.assign({ wide }, c));
      const L = label + (wide ? ' wide' : '');
      if (c.role === 'viewer') {
        // a counselor: the live podium line, a finished game's winners — and nothing a director has
        await page.evaluate((id) => { const ids = state.teams.map((t) => t.id); state.drafts[id] = { medals: { gold: ids[0] } }; openGame(id, { from: 'games' }); }, info.pod);
        await page.waitForTimeout(700);
        const live = await page.evaluate(() => {
          const t = document.getElementById('takeover-game');
          const out = [];
          if (t.querySelector('#podium-picker, .pp-team, #game-save')) out.push('a picker or a Save');
          if (!document.getElementById('takeover-game-dock').hidden) out.push('a dock');
          if (/\b\d+\s*(pts|points)\b|\+\d+/i.test(t.innerText)) out.push('a number: ' + (t.innerText.match(/\b\d+\s*(pts|points)\b|\+\d+/i) || [])[0]);
          return out;
        });
        if (live.length) say(L + ': counselor, a podium being scored: ' + live.join(', '));
        await audit(page, L + ' (counselor live)');
        await page.evaluate((id) => { openGame(id, { from: 'games' }); }, info.fin);
        await page.waitForTimeout(600);
        const fin = await page.evaluate(() => {
          const t = document.getElementById('takeover-game');
          const out = [];
          if (t.querySelectorAll('.gres-r').length !== 3) out.push('the winners are missing');
          if (t.querySelector('.gres-pts, #game-saved, #game-change, #game-save')) out.push('a director control or a point');
          if (!document.getElementById('takeover-game-dock').hidden) out.push('a dock');
          if (/\b\d+\s*(pts|points)\b|\+\d+/i.test(t.innerText)) out.push('a number');
          return out;
        });
        if (fin.length) say(L + ': counselor, a finished game: ' + fin.join(', '));
        await audit(page, L + ' (counselor result)');
        if (process.env.SHOTS && c.text === 100 && wide) await page.screenshot({ path: OUT + L.replace(/[ %+]/g, '_') + '.png' });
      } else {
        await page.evaluate((id) => { openGame(id, { from: 'games' }); }, info.pod);
        await page.waitForTimeout(800);
        const ids = info.ids;
        const hasPicker = await page.evaluate(() => !!document.querySelector('#podium-picker') && !document.querySelector('#takeover-game jelly-select'));
        if (!hasPicker) say(L + ': the picker is not there (or a dropdown is)');
        await audit(page, L + ' (nothing picked)');
        if (process.env.SHOTS && c.text === 100 && wide) await page.screenshot({ path: OUT + L.replace(/[ %+]/g, '_') + '_empty.png' });
        await pickKey(page, 'gold', ids[0]);
        await pickKey(page, 'silver', ids[1]);
        await audit(page, L + ' (gold, silver)');
        if (process.env.SHOTS && c.text === 100 && wide) await page.screenshot({ path: OUT + L.replace(/[ %+]/g, '_') + '_two.png' });
        await pickKey(page, 'bronze', ids[2]);
        await audit(page, L + ' (all three)');
        const gold = await page.evaluate(() => /btn-gold/.test(document.getElementById('game-save').className));
        if (!gold) say(L + ': the Save is not gold with three picked');
        await page.click('#game-save');
        await page.waitForTimeout(800);
        const saved = await page.evaluate(() => ({ rows: document.querySelectorAll('#takeover-game .gres-r').length, line: !!document.getElementById('game-saved'), dock: document.getElementById('takeover-game-dock').textContent.replace(/\s+/g, ' ').trim() }));
        if (saved.rows !== 3 || !saved.line) say(L + ': after Save: ' + JSON.stringify(saved));
        await audit(page, L + ' (saved)');
        if (process.env.SHOTS && c.text === 100 && wide) await page.screenshot({ path: OUT + L.replace(/[ %+]/g, '_') + '_saved.png' });
      }
      if (errors.length) say(L + ': console errors: ' + errors.slice(0, 2).join(' | '));
      n++;
      await ctx.close();
    }
  }
  console.log(`${n} views audited`);

  // ── behaviour, junior director at 390 ──
  if (camps.includes('junior')) {
    console.log('behaviour (junior director, 390 light)');
    const { ctx, page, errors, info } = await open(browser, { camp: 'junior', role: 'editor', team: null, w: 390, scheme: 'light', text: 100, wide: false });
    const ids = info.ids;
    const q = (s) => page.evaluate((s) => { const e = document.querySelector(s); return e && e.textContent.replace(/\s+/g, ' ').trim(); }, s);
    const attr = (s, a) => page.evaluate(({ s, a }) => { const e = document.querySelector(s); return e && e.getAttribute(a); }, { s, a });
    await page.evaluate((id) => openGame(id, { from: 'games' }), info.pod);
    await page.waitForTimeout(800);
    // 1. the first state
    const waits = await page.$$eval('#podium-picker .pp-row', (r) => r.map((x) => x.hasAttribute('data-wait')));
    if (waits.join() === 'false,true,true') ok('only gold is open: silver and bronze wait'); else say('waiting rows: ' + waits.join());
    const waitingKeys = await page.$$eval('#podium-picker .pp-row[data-wait] .pp-team', (k) => k.every((x) => x.getAttribute('aria-disabled') === 'true'));
    if (waitingKeys) ok('a waiting row is all disabled'); else say('a waiting row has an enabled key');
    const well = await page.evaluate(() => { const b = document.getElementById('game-save'); return [b.getAttribute('aria-disabled'), b.textContent.trim()]; });
    if (well[0] === 'true' && well[1] === 'Pick gold, silver and bronze') ok('Save is the dashed well: "' + well[1] + '"'); else say('save well: ' + well);
    // 2. tapping a waiting key does nothing but say why
    await page.evaluate(({ id }) => { window.__before = JSON.stringify(state.drafts[id] || null); }, { id: info.pod });
    await page.evaluate((t) => document.querySelector(`#podium-picker .pp-row[data-medal="silver"] [data-team="${t}"]`).click(), ids[0]);
    await page.waitForTimeout(250);
    const same = await page.evaluate((id) => window.__before === JSON.stringify(state.drafts[id] || null), info.pod);
    if (same) ok('a tap on a waiting key writes nothing'); else say('a waiting key wrote a pick');
    // 3. the Save well goes to the row still to pick
    await page.evaluate(() => { const b = document.querySelector('#takeover-game-body'); b.scrollTop = b.scrollHeight; });
    await page.click('#game-save', { force: true }); // Playwright reads aria-disabled as "not enabled": the well is a real tap target
    await page.waitForTimeout(600);
    const goldInView = await page.evaluate(() => { const r = document.querySelector('#podium-picker .pp-row[data-medal="gold"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    if (goldInView) ok('a tap on the well scrolls to the row still to pick (gold)'); else say('the well did not bring gold into view');
    const focused = await page.evaluate(() => { const a = document.activeElement; return a && a.closest && a.closest('.pp-row') ? a.closest('.pp-row').dataset.medal : null; });
    if (focused === 'gold') ok('and focuses its first free key'); else say('focus after the well: ' + focused);
    // 4. a pick: the next row opens, the taken team is named, the NODES stay
    await page.evaluate(() => { document.querySelectorAll('#podium-picker .pp-team').forEach((k, i) => { k.__tag = i; }); });
    const base = await page.evaluate(() => JSON.stringify(syncCanonTree(syncedSnapshot())));
    await pickKey(page, 'gold', ids[3]);
    const st = await page.evaluate((ids) => ({
      pressed: document.querySelector(`#podium-picker .pp-row[data-medal="gold"] [data-team="${ids[3]}"]`).getAttribute('aria-pressed'),
      wait: [...document.querySelectorAll('#podium-picker .pp-row')].map((r) => r.hasAttribute('data-wait')).join(),
      taken: document.querySelector(`#podium-picker .pp-row[data-medal="silver"] [data-team="${ids[3]}"]`).getAttribute('data-taken'),
      takenTab: document.querySelector(`#podium-picker .pp-row[data-medal="silver"] [data-team="${ids[3]}"] .pp-taken`).textContent.trim(),
      label: document.querySelector(`#podium-picker .pp-row[data-medal="silver"] [data-team="${ids[3]}"]`).getAttribute('aria-label'),
      tags: [...document.querySelectorAll('#podium-picker .pp-team')].every((k, i) => k.__tag === i),
      save: document.getElementById('game-save').textContent.trim(),
    }), ids);
    if (st.pressed === 'true' && st.wait === 'false,false,true' && st.taken === 'gold' && /has gold/.test(st.takenTab) && /, has gold$/.test(st.label)) ok('a pick: pressed, silver opens, the team is "has gold" in the other rows'); else say('after a gold pick: ' + JSON.stringify(st));
    if (st.tags) ok('every key is the SAME node after the pick (patched, not rebuilt)'); else say('the keys were re-created by a pick');
    if (st.save === 'Pick silver and bronze') ok('Save says what is missing: "' + st.save + '"'); else say('save text: ' + st.save);
    // 5. the same key again clears; per-leaf draft writes
    await pickKey(page, 'gold', ids[3]);
    const cleared = await page.evaluate((ids) => ({ pressed: document.querySelector(`#podium-picker .pp-row[data-medal="gold"] [data-team="${ids[3]}"]`).getAttribute('aria-pressed'), wait: [...document.querySelectorAll('#podium-picker .pp-row')].map((r) => r.hasAttribute('data-wait')).join() }), ids);
    if (cleared.pressed === 'false' && cleared.wait === 'false,true,true') ok('the same key again clears it (silver and bronze wait again)'); else say('clear: ' + JSON.stringify(cleared));
    await pickKey(page, 'gold', ids[3]);
    await pickKey(page, 'silver', ids[0]);
    const leaves = await page.evaluate((base) => Object.keys(computeSyncUpdates(JSON.parse(base), syncCanonTree(syncedSnapshot()))).filter((k) => k.startsWith('drafts/')), base);
    if (leaves.length === 2 && leaves.every((k) => /\/medals\/(gold|silver)$/.test(k))) ok('the draft is written per leaf: ' + leaves.join(', ')); else say('draft paths: ' + leaves.join(', '));
    // 6. another director moves a pick (a snapshot swaps state.drafts): patched in place
    await page.evaluate(({ id, ids }) => { state.drafts = JSON.parse(JSON.stringify(state.drafts)); state.drafts[id].medals.silver = ids[4]; renderAll(); }, { id: info.pod, ids });
    await page.waitForTimeout(300);
    const moved = await page.evaluate((ids) => ({
      silver: document.querySelector(`#podium-picker .pp-row[data-medal="silver"] [data-team="${ids[4]}"]`).getAttribute('aria-pressed'),
      old: document.querySelector(`#podium-picker .pp-row[data-medal="silver"] [data-team="${ids[0]}"]`).getAttribute('aria-pressed'),
      tags: [...document.querySelectorAll('#podium-picker .pp-team')].every((k, i) => k.__tag === i),
    }), ids);
    if (moved.silver === 'true' && moved.old === 'false' && moved.tags) ok('a pick moved by another director is patched in place'); else say('remote move: ' + JSON.stringify(moved));
    // 7. complete, Save: the result, the line, Next game; focus
    await pickKey(page, 'bronze', ids[0]);
    const gold = await page.evaluate(() => { const b = document.getElementById('game-save'); return [b.getAttribute('aria-disabled'), b.textContent.trim(), /btn-gold/.test(b.className)]; });
    if (gold[0] === null && gold[1] === 'Save result' && gold[2]) ok('three picked: the gold Save result'); else say('complete save: ' + gold);
    await page.evaluate(() => { document.getElementById('game-save').focus(); });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const after = await page.evaluate((id) => ({
      result: !!state.results[id], draft: !!state.drafts[id],
      winners: [...document.querySelectorAll('#takeover-game .gres-r')].map((r) => r.dataset.place + ':' + r.dataset.team).join(),
      line: document.getElementById('game-saved') && document.getElementById('game-saved').textContent.trim(),
      state: document.getElementById('game-saved') && document.getElementById('game-saved').dataset.state,
      dock: document.getElementById('takeover-game-dock').textContent.replace(/\s+/g, ' ').trim(),
      focus: document.activeElement && document.activeElement.id,
    }), info.pod);
    if (after.result && !after.draft && after.winners === `1:${ids[3]},2:${ids[4]},3:${ids[0]}`) ok('Save wrote the result and cleared the draft: ' + after.winners); else say('after save: ' + JSON.stringify(after));
    if (after.state === 'offline' && /Saved on this phone/.test(after.line)) ok('no sync on this phone: "' + after.line + '"'); else say('saved line (no sync): ' + after.state + ' / ' + after.line);
    if (/Next game/.test(after.dock) && /Back to \w+ games/.test(after.dock) && /games? left/.test(after.dock)) ok('the dock after Save: ' + after.dock); else say('dock: ' + after.dock);
    if (after.focus === 'game-next') ok('the keyboard focus moved to Next game'); else say('focus after Save: ' + after.focus);
    // 8. "Saved" only when the server confirms
    const seq = await page.evaluate((id) => {
      const out = [];
      const keep = { fbRef, fbConnKnown, fbConnected, confirmedTree };
      fbRef = {}; fbConnKnown = true; fbConnected = true; confirmedTree = syncCanonTree({ results: {} });
      gamesSavedRefresh();
      out.push(document.getElementById('game-saved').dataset.state + ' | ' + document.getElementById('game-saved').textContent.trim());
      confirmedTree = syncCanonTree({ results: { [id]: JSON.parse(JSON.stringify(state.results[id])) } });
      gamesSavedRefresh();
      out.push(document.getElementById('game-saved').dataset.state + ' | ' + document.getElementById('game-saved').textContent.trim());
      fbConnected = false;
      gamesSavedRefresh();
      out.push(document.getElementById('game-saved').dataset.state + ' | ' + document.getElementById('game-saved').textContent.trim());
      Object.assign(window, {}); fbRef = keep.fbRef; fbConnKnown = keep.fbConnKnown; fbConnected = keep.fbConnected; confirmedTree = keep.confirmedTree;
      gamesSavedRefresh();
      return out;
    }, info.pod);
    if (/^saving \| Saving…$/.test(seq[0]) && /^saved \| Saved \d{1,2}:\d\d [AP]M · everyone’s phone has it$/.test(seq[1]) && /^offline \| Saved on this phone · it sends/.test(seq[2])) ok('saving → saved → offline: ' + seq.join('  →  ')); else say('saved line states: ' + JSON.stringify(seq));
    await audit(page, 'saved (junior 390)');
    // 9. Next game opens the next game; one Back leaves
    const nextId = await attr('#game-next', 'data-next-game');
    await page.click('#game-next');
    await page.waitForTimeout(800);
    const cur = await page.evaluate(() => state.ui.gameId);
    if (nextId && cur === nextId) ok('Next game opens the next game'); else say('Next opened ' + cur + ' not ' + nextId);
    const picker2 = await page.evaluate(() => !!document.querySelector('#podium-picker') || !!document.querySelector('#takeover-game .gres-r') || !!document.querySelector('#takeover-game-body'));
    if (picker2) ok('and it has its own entry area');
    await page.click('#takeover-game [data-takeover-back]');
    await page.waitForTimeout(600);
    if (await page.evaluate(() => !state.ui.gameId)) ok('ONE Back leaves the takeover'); else say('Back did not leave');
    // 10. Change the result: asked first
    await page.evaluate((id) => openGame(id, { from: 'games' }), info.pod);
    await page.waitForTimeout(700);
    await page.click('#game-change');
    await page.waitForTimeout(600);
    const dlg = await page.evaluate(() => { const d = document.getElementById('ask-dialog'); return d && d.hasAttribute('open') ? { title: document.getElementById('ask-title').textContent, btns: [...document.querySelectorAll('#ask-actions .btn')].map((b) => b.textContent.trim()) } : null; });
    if (dlg && /^Change the result for /.test(dlg.title) && dlg.btns.join() === 'Clear it and pick again,Keep it') ok('Change the result asks first: ' + dlg.btns.join(' / ')); else say('change dialog: ' + JSON.stringify(dlg));
    if (process.env.SHOTS) await page.screenshot({ path: OUT + 'change-dialog.png' });
    await page.evaluate(() => [...document.querySelectorAll('#ask-actions .btn')].find((b) => /Keep it/.test(b.textContent)).click());
    await page.waitForTimeout(500);
    if (await page.evaluate((id) => !!state.results[id], info.pod)) ok('Keep it keeps the result'); else say('Keep it cleared the result');
    await page.click('#game-change');
    await page.waitForTimeout(500);
    await page.evaluate(() => [...document.querySelectorAll('#ask-actions .btn')].find((b) => /Clear it/.test(b.textContent)).click());
    await page.waitForTimeout(700);
    const back = await page.evaluate((id) => ({ result: !!state.results[id], picker: !!document.querySelector('#podium-picker .pp-row'), save: document.getElementById('game-save') && document.getElementById('game-save').textContent.trim() }), info.pod);
    if (!back.result && back.picker && back.save === 'Pick gold, silver and bronze') ok('Clear it brings the picker back'); else say('after Clear: ' + JSON.stringify(back));
    // 11. calm motion: a pick creates no transform keyframe
    await page.evaluate(() => { setCalmPref('on'); window.__tf = []; const real = Element.prototype.animate; Element.prototype.animate = function (kf, o) { try { if (JSON.stringify(kf).includes('transform')) window.__tf.push(this.className || this.tagName); } catch (e) { /* none */ } return real.call(this, kf, o); }; });
    await page.waitForTimeout(300);
    await pickKey(page, 'gold', ids[1]);
    await pickKey(page, 'silver', ids[2]);
    const tf = await page.evaluate(() => window.__tf);
    if (!tf.length) ok('calm motion: no transform keyframe for two picks'); else say('calm motion made transform keyframes: ' + tf.join(', '));
    await page.evaluate(() => { setCalmPref('off'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__tf = []; });
    await pickKey(page, 'bronze', ids[3]);
    const tf2 = await page.evaluate(() => window.__tf);
    if (tf2.length) ok('motion on: a pick moves (' + [...new Set(tf2)].join(', ') + ')'); else say('motion on: nothing moved on a pick');
    if (errors.length) say('behaviour: console errors: ' + errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(problems.length ? '\n' + problems.length + ' problem(s)' : '\nall clear');
  process.exit(problems.length ? 1 : 0);
})();
