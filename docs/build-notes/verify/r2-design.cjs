// Big-screen branding, the design check: the REAL TV page (current-standings.html + its scripts, served from the worktree)
// with the two Firebase SDK tags swapped for a tiny in-page fake, fed reveal nodes whose shown places carry a team's own look
// (a photo thumbnail, a picked colour, an emoji, a cleared team's number), drawn by the page's own teamMark. Every frame is
// measured: a tie's names start on ONE line whatever the marks (a photo beside shipped shields, a tile beside shields, flags,
// three and six on one place), a photo is never a bigger mark than a shield, and the hero, the crowning (one champion with a
// photo, a shared title of 2-6) and the final table fit the screen. A design review found a photo or a tile beside junior's
// shields 55-83px low and a lone photo champion off both edges of a 720p projector: run this after any change to the marks.
// Usage: serve the worktree (python3 -m http.server 8971), then node docs/build-notes/verify/r2-design.cjs [outDir]
// (PORT=, SIZES=1280x720,1366x768,1920x1080, CAMPS=junior,senior). Prints a line per frame ("CLIPPED" or a tie whose
// spread is not 0 is a failure, and the exit code says so); writes a screenshot per frame. No Firebase: the SDK tags are
// swapped for a fake; the alert sender is aborted.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'r2-design-shots');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:' + (process.env.PORT || 8971) + '/';
const FAKE = `(function () {
  var listeners = {}; var vals = { '.info/serverTimeOffset': 0, '.info/connected': true };
  function ref(p) { return { on: function (t, cb) { (listeners[p] = listeners[p] || []).push(cb); setTimeout(function () { cb({ val: function () { return vals[p] === undefined ? null : vals[p]; } }); }, 0); }, off: function () {} }; }
  window.firebase = { apps: [], initializeApp: function () { this.apps.push({}); }, database: function () { return { ref: ref, goOffline: function () {}, goOnline: function () {} }; } };
  window.__feed = function (p, v) { vals[p] = v; (listeners[p] || []).forEach(function (cb) { cb({ val: function () { return v; } }); }); };
})();`;
async function page(browser, w, h, camp, rm) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: rm ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  await p.route('https://camp-alerts.patricksimpson-fx.workers.dev/**', (r) => r.abort());
  await p.route('**/*.firebaseio.com/**', (r) => r.abort());
  await p.route('https://www.gstatic.com/**', (r) => r.abort());
  await p.route('**/tv-fake-firebase.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await p.route('**/current-standings.html*', async (r) => {
    const res = await r.fetch(); let html = await res.text();
    html = html.replace(/<script src="https:\/\/www\.gstatic\.com[^>]*><\/script>\s*/g, '').replace('<script src="firebase-config.js', '<script src="tv-fake-firebase.js"></script>\n  <script src="firebase-config.js');
    r.fulfill({ response: res, body: html, headers: Object.assign({}, res.headers(), { 'content-type': 'text/html' }) });
  });
  await p.goto(BASE + 'current-standings.html' + (camp === 'senior' ? '?camp=senior' : ''));
  await p.waitForTimeout(300);
  p.__ctx = ctx;
  return p;
}
async function thumbs(p) {
  return p.evaluate(async () => {
    const load = (s) => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = s; });
    const out = {};
    for (const [k, s] of [['crew', 'images/stalling-crew.jpg'], ['news', 'images/temu-patrick-news.jpg']]) {
      const img = await load(s);
      const full = document.createElement('canvas'); full.width = 346; full.height = 480;
      const sc = Math.max(346 / img.width, 480 / img.height);
      full.getContext('2d').drawImage(img, (346 - img.width * sc) / 2, (480 - img.height * sc) / 2, img.width * sc, img.height * sc);
      let url = null;
      outer: for (const [w, h] of [[240, 333], [200, 278], [173, 240]]) for (const q of [0.72, 0.62, 0.52]) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.fillStyle = '#f5efe2'; x.fillRect(0, 0, w, h); x.drawImage(full, 0, 0, w, h);
        const u = c.toDataURL('image/jpeg', q); if (u.length <= 20000) { url = u; break outer; }
      }
      out[k] = url;
    }
    return out;
  });
}
const NAMES = ['Ferocious Foxes', 'Methodic Mediocre Maples', 'Particularly Perilous Pumpkins', 'Patriotic Pilgrims', 'Runaway John Deeres', 'Turkey Dinner'];
const NAMES4 = ['Red Team', 'Blue Team', 'Green Team', 'Gold Team'];
const ent = (nm, p, o) => Object.assign({ nm, p, g: 2, s: 1, b: 1, v: 3, m: 2, c: 1 }, o || {});
let SEQ = 1;
function node(groups, o) {
  const now = Date.now(); SEQ += 1;
  const ctl = { v: 1, seq: SEQ, id: 'r1kz9fxq-' + String(1000 + SEQ).slice(-4), phase: o.phase || 'live', cur: o.cur, shown: o.shown, teams: o.teams, finale: !!o.finale,
    at: now - (o.ago || 5000), sa: now - (o.ago || 5000), ca: now - 60000, startedAt: now - 600000, until: now + 3600e3 };
  const pub = {}; groups.forEach((g, i) => { pub['g' + i] = g; });
  return { real: { ctl, pub } };
}
(async () => {
  const browser = await chromium.launch();
  const sizes = (process.env.SIZES || '1280x720,1366x768,1920x1080').split(',').map((s) => s.split('x').map(Number));
  const lines = [];
  for (const camp of (process.env.CAMPS || 'junior,senior').split(',')) for (const [w, h] of sizes) {
    const p = await page(browser, w, h, camp);
    const th = await thumbs(p);
    const n = camp === 'senior' ? 4 : 6; const nm = camp === 'senior' ? NAMES4 : NAMES;
    const root = (camp === 'senior' ? 'seniorScoreboard' : 'campScoreboard') + '/revealPublic';
    const feed = async (v, wait) => { await p.evaluate(([r, v]) => window.__feed(r, v), [root, v]); await p.waitForTimeout(wait || 900); };
    const shot = async (name) => p.screenshot({ path: path.join(OUT, `${camp}-${w}x${h}-${name}.png`) });
    const looks = { photo: { ph: th.crew }, photo2: { ph: th.news }, tile: { pl: true, em: '3️⃣' }, teal: { k: 'teal' }, berry: { pl: true, em: '5️⃣', k: 'berry' }, eagle: { em: '🦅', k: 'indigo' }, plain: {} };
    // ties: name tops (breakdown beat)
    const ties = camp === 'senior'
      ? { 'photo+flag': ['photo', 'plain'], 'tile+flag': ['tile', 'plain'], 'flags': ['plain', 'plain'], 'tie3': ['photo', 'tile', 'teal'], 'tie4': ['photo', 'plain', 'tile', 'eagle'] }
      : { 'photo+shield': ['photo', 'plain'], 'tile+shield': ['tile', 'plain'], 'shields': ['plain', 'plain'], 'teal+shield': ['teal', 'plain'], 'tie3': ['photo', 'plain', 'plain'], 'tie3b': ['tile', 'plain', 'photo2'], 'tie6': ['photo', 'plain', 'plain', 'tile', 'plain', 'eagle'], 'shields6': ['plain', 'plain', 'plain', 'plain', 'plain', 'plain'] };
    for (const [label, list] of Object.entries(ties)) {
      const e = {}; list.forEach((lk, i) => { e['t' + i] = ent(nm[i], 20, looks[lk]); });
      await feed(node([{ place: 1, e }], { cur: 0, shown: 1, teams: n, ago: 5000 }));
      const t = await p.evaluate(() => {
        const all = [...document.querySelectorAll('#hero-wrap .hero *')].map((x) => x.getBoundingClientRect()).filter((r) => r.width || r.height);
        return { tops: [...document.querySelectorAll('#hero-wrap .hero-name')].map((x) => Math.round(x.getBoundingClientRect().top)),
          marks: [...document.querySelectorAll('#hero-wrap .hero-shield')].map((x) => { const r = x.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }),
          bottom: Math.round(Math.max(...all.map((r) => r.bottom))), top: Math.round(Math.min(...all.map((r) => r.top))), right: Math.round(Math.max(...all.map((r) => r.right))), left: Math.round(Math.min(...all.map((r) => r.left))) };
      });
      const spread = Math.max(...t.tops) - Math.min(...t.tops);
      const fits = t.bottom <= h && t.right <= w && t.left >= 0 && t.top >= 0;
      lines.push(`${camp} ${w}x${h} tie ${label}: tops=[${t.tops}] spread=${spread} marks=[${t.marks}] top=${t.top} bottom=${t.bottom} ${fits ? 'fits' : 'CLIPPED'}`);
      await shot('tie-' + label);
    }
    // solo hero: photo vs plain sizes
    for (const lk of ['photo', 'plain', 'tile', 'teal', 'eagle', 'berry']) {
      await feed(node([{ place: n, e: { t1: ent(nm[1], 12, looks[lk]) } }], { cur: 0, shown: 1, teams: n, ago: 5000 }));
      const t = await p.evaluate(() => { const m = document.querySelector('#hero-wrap .hero-shield'); const r = m.getBoundingClientRect(); const all = [...document.querySelectorAll('#hero-wrap .hero *')].map((x) => x.getBoundingClientRect()); return { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(Math.max(...all.map((r) => r.bottom))), top: Math.round(Math.min(...all.map((r) => r.top))) }; });
      lines.push(`${camp} ${w}x${h} solo ${lk}: mark=${t.w}x${t.h} top=${t.top} bottom=${t.bottom} ${t.bottom <= h && t.top >= 0 ? 'fits' : 'CLIPPED'}`);
      await shot('solo-' + lk);
    }
    // champions 1..4 with photos
    const champs = camp === 'senior' ? { photo1: ['photo'], plain1: ['plain'], teal1: ['teal'], 'photo+flag': ['photo', 'plain'], photos2: ['photo', 'photo2'], c3: ['photo', 'plain', 'tile'], c4: ['photo', 'photo2', 'plain', 'teal'] }
      : { photo1: ['photo'], plain1: ['plain'], teal1: ['teal'], tile1: ['tile'], 'photo+shield': ['photo', 'plain'], photos2: ['photo', 'photo2'], c3: ['photo', 'plain', 'tile'], c4: ['photo', 'photo2', 'plain', 'teal'], c6: ['photo', 'photo2', 'plain', 'teal', 'tile', 'plain'] };
    for (const [label, list] of Object.entries(champs)) {
      const e = {}; list.forEach((lk, i) => { e['t' + i] = ent(nm[i], 30, looks[lk]); });
      await feed(node([{ place: 1, e }], { cur: 0, shown: 1, teams: n, ago: 9000, phase: 'champion', finale: true }), 1300);
      const m = await p.evaluate(() => { const els = [...document.querySelectorAll('#champ *')].map((x) => x.getBoundingClientRect()).filter((r) => r.width || r.height); return { bottom: Math.round(Math.max(...els.map((r) => r.bottom))), top: Math.round(Math.min(...els.map((r) => r.top))) }; });
      lines.push(`${camp} ${w}x${h} champ ${label}: top=${m.top} bottom=${m.bottom} ${m.bottom <= h && m.top >= 0 ? 'fits' : 'CLIPPED'}`);
      await shot('champ-' + label);
    }
    // board with every look
    const order = camp === 'senior' ? ['photo', 'teal', 'tile', 'eagle'] : ['photo', 'teal', 'tile', 'eagle', 'plain', 'berry'];
    const groups = []; for (let i = 0; i < n; i++) groups.push({ place: n - i, e: { ['t' + i]: ent(nm[i], 10 + 4 * i, looks[order[i]]) } });
    await feed(node(groups, { cur: n - 1, shown: n, teams: n, ago: 9000, phase: 'table', finale: true }));
    await shot('table');
    const b = await p.evaluate(() => { const els = [...document.querySelectorAll('#board *')].map((x) => x.getBoundingClientRect()).filter((r) => r.width || r.height); return { bottom: Math.round(Math.max(...els.map((r) => r.bottom))), top: Math.round(Math.min(...els.map((r) => r.top))) }; });
    lines.push(`${camp} ${w}x${h} table: top=${b.top} bottom=${b.bottom} ${b.bottom <= h && b.top >= 0 ? 'fits' : 'CLIPPED'}`);
    await p.__ctx.close();
  }
  console.log(lines.join('\n'));
  await browser.close();
  const bad = lines.filter((l) => /CLIPPED/.test(l) || (/ spread=/.test(l) && !/ spread=0 /.test(l)));
  if (bad.length) { console.error(bad.length + ' frame(s) failed'); process.exitCode = 1; }
})();
