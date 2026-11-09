// Design pass for Part 2 (big-screen branding): the REAL TV page (current-standings.html + its scripts, served from the
// worktree) with the two Firebase SDK tags swapped for a tiny in-page fake, fed reveal nodes, then each frame's marks
// replaced by SPECIMENS of the new looks (a photo thumbnail, a coloured flag, the cleared number tile, an emoji tile with a
// picked colour) built exactly as BUILD SESSION 2's teamMark will build them, so the CSS half can be judged at real sizes.
// Usage: serve the worktree (python3 -m http.server 8971), then node docs/build-notes/verify/r2-design.cjs [outDir]
// (PORT=, SIZES=1280x720,1366x768,1920x1080, CAMPS=junior,senior). Prints, per tie, whether every name starts on one line
// and the frame fits; writes a screenshot per frame. No Firebase: the SDK tags are swapped for a fake; the alert sender is aborted.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'r2-design-shots');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:' + (process.env.PORT || 8971) + '/';

const FAKE = `(function () {
  var listeners = {}; var vals = { '.info/serverTimeOffset': 0, '.info/connected': true };
  function ref(p) { return { on: function (t, cb) { (listeners[p] = listeners[p] || []).push(cb); setTimeout(function () { cb({ val: function () { return vals[p] === undefined ? null : vals[p]; } }); }, 0); }, off: function () {} }; }
  window.firebase = { apps: [], initializeApp: function () { this.apps.push({}); }, database: function () { return { ref: ref, goOffline: function () {}, goOnline: function () {} }; } };
  window.__feed = function (p, v) { vals[p] = v; (listeners[p] || []).forEach(function (cb) { cb({ val: function () { return v; } }); }); };
})();`;

async function page(browser, w, h, camp) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.route('https://camp-alerts.patricksimpson-fx.workers.dev/**', (r) => r.abort());
  await p.route('**/*.firebaseio.com/**', (r) => r.abort());
  await p.route('https://www.gstatic.com/**', (r) => r.abort());
  await p.route('**/tv-fake-firebase.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await p.route('**/current-standings.html*', async (r) => {
    const res = await r.fetch();
    let html = await res.text();
    html = html.replace(/<script src="https:\/\/www\.gstatic\.com[^>]*><\/script>\s*/g, '').replace('<script src="firebase-config.js', '<script src="tv-fake-firebase.js"></script>\n  <script src="firebase-config.js');
    r.fulfill({ response: res, body: html, headers: Object.assign({}, res.headers(), { 'content-type': 'text/html' }) });
  });
  await p.goto(BASE + 'current-standings.html' + (camp === 'senior' ? '?camp=senior' : ''));
  await p.waitForTimeout(300);
  return p;
}

// Thumbnails made the way the director's phone will make them: the 346x480 shield-shaped photo, scaled to 240x333,
// flattened on the TV's paper, JPEG stepping down until it fits 20,000 characters.
async function thumbs(p) {
  return p.evaluate(async () => {
    const load = (s) => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = s; });
    const out = {};
    for (const [k, s] of [['crew', 'images/stalling-crew.jpg'], ['news', 'images/temu-patrick-news.jpg'], ['foxes', 'images/team-shields/ferocious-foxes.webp'], ['deere', 'images/team-shields/runaway-john-deeres.webp']]) {
      const img = await load(s);
      const full = document.createElement('canvas'); full.width = 346; full.height = 480;
      const sc = Math.max(346 / img.width, 480 / img.height);
      full.getContext('2d').drawImage(img, (346 - img.width * sc) / 2, (480 - img.height * sc) / 2, img.width * sc, img.height * sc);
      let url = null;
      outer: for (const [w, h] of [[240, 333], [200, 278], [173, 240]]) {
        for (const q of [0.72, 0.62, 0.52]) {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const x = c.getContext('2d'); x.fillStyle = '#f5efe2'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high'; x.drawImage(full, 0, 0, w, h);
          const u = c.toDataURL('image/jpeg', q);
          if (u.length <= 20000) { url = u; break outer; }
        }
      }
      out[k] = url;
    }
    return out;
  });
}

const NAMES = ['Ferocious Foxes', 'Methodic Mediocre Maples', 'Particularly Perilous Pumpkins', 'Patriotic Pilgrims', 'Runaway John Deeres', 'Turkey Dinner'];
const NAMES4 = ['Red Team', 'Blue Team', 'Green Team', 'Gold Team'];
const ent = (id, nm, p, o) => Object.assign({ nm, p, g: 2, s: 1, b: 1, v: 3, m: 2, c: 1 }, o || {});

let SEQ = 1;
function node(groups, o) {
  const now = Date.now();
  SEQ += 1;
  const ctl = Object.assign({ v: 1, seq: SEQ, id: 'r1kz9fxq-' + String(1000 + SEQ).slice(-4), phase: 'live', cur: 0, shown: 1, teams: 6, finale: false,
    at: now - (o.ago || 5000), sa: now - (o.ago || 5000), ca: now - 60000, startedAt: now - 600000, until: now + 3600e3 }, o.ctl || {});
  ['cur', 'shown', 'teams', 'phase', 'finale'].forEach((k) => { if (o[k] !== undefined) ctl[k] = o[k]; });
  const pub = {};
  groups.forEach((g, i) => { pub['g' + i] = g; });
  return { real: { ctl, pub } };
}

// The marks BUILD SESSION 2's teamMark(id, cls, brand) makes (see the spec): replaces every mark the frame drew.
async function specimen(p, plan) {
  await p.evaluate((plan) => {
    const SVG = 'http://www.w3.org/2000/svg';
    const make = (spec, cls) => {
      if (spec.kind === 'photo') { const i = document.createElement('img'); i.className = cls + ' tv-photo'; i.alt = ''; i.src = spec.src; return i; }
      if (spec.kind === 'flag') {
        const s = document.createElementNS(SVG, 'svg'); s.setAttribute('class', cls + ' tv-flag'); s.setAttribute('data-flag', spec.flag); s.setAttribute('viewBox', '0 0 32 32');
        if (spec.fill) s.style.setProperty('--flag-fill', spec.fill);
        const u = document.createElementNS(SVG, 'use'); u.setAttribute('href', '#flag-' + spec.shape); s.appendChild(u); return s;
      }
      const d = document.createElement('div'); d.className = cls + ' crest-tile'; d.setAttribute('aria-hidden', 'true');
      if (spec.num) { d.setAttribute('data-num', spec.text); const sp = document.createElement('span'); sp.textContent = spec.text; d.appendChild(sp); } else d.textContent = spec.text;
      if (spec.edge) { d.setAttribute('data-edge', ''); d.style.setProperty('--tile-edge', spec.edge); }
      return d;
    };
    const swap = (sel, cls, specs) => { document.querySelectorAll(sel).forEach((el, i) => { const s = specs[i % specs.length]; if (s) el.replaceWith(make(s, cls)); }); };
    swap('#hero-wrap .hero-shield', 'hero-shield', plan);
    swap('#board .row-crest', 'row-crest', plan);
    swap('#champ .champ-crest', 'champ-crest', plan);
    swap('#intro-shields > *', 'intro-crest', plan);
    swap('#wait-shields > *', 'wait-crest', plan);
  }, plan);
  await p.waitForTimeout(250);
}

(async () => {
  const browser = await chromium.launch();
  const sizes = (process.env.SIZES || '1280x720,1366x768,1920x1080').split(',').map((s) => s.split('x').map(Number));
  const report = [];
  for (const camp of (process.env.CAMPS || 'junior,senior').split(',')) {
    for (const [w, h] of sizes) {
      const p = await page(browser, w, h, camp);
      const th = await thumbs(p);
      const n = camp === 'senior' ? 4 : 6;
      const nm = camp === 'senior' ? NAMES4 : NAMES;
      const root = (camp === 'senior' ? 'seniorScoreboard' : 'campScoreboard') + '/revealPublic';
      // The specimen marks: a photo, the cleared number tile, the number tile with a picked colour, an emoji tile with a
      // picked colour, a coloured flag (senior's look for a team that is not cleared), and the printed look (unchanged).
      const PAL = { teal: '#0b7570', berry: '#b0306a', gold: '#8a6100', indigo: '#4338ca', pumpkin: '#b54708' };
      const plans = {
        photo: [{ kind: 'photo', src: th.crew }],
        mixed: [{ kind: 'photo', src: th.foxes }, { kind: 'tile', text: '2', num: true }, { kind: 'tile', text: '3', num: true, edge: PAL.teal },
          { kind: 'tile', text: '🦅', edge: PAL.berry }, { kind: 'photo', src: th.news }, { kind: 'tile', text: '6', num: true, edge: PAL.gold }],
        senior: [{ kind: 'flag', flag: 'red', shape: 'plain', fill: PAL.indigo }, { kind: 'tile', text: '2', num: true }, { kind: 'photo', src: th.deere }, { kind: 'tile', text: '🦊', edge: PAL.pumpkin }],
      };
      const plan = camp === 'senior' ? plans.senior : plans.mixed;
      const shots = [];
      const feed = async (v) => { await p.evaluate(([r, v]) => window.__feed(r, v), [root, v]); await p.waitForTimeout(900); };
      const shot = async (name) => { const f = path.join(OUT, `${camp}-${w}x${h}-${name}.png`); await p.screenshot({ path: f }); shots.push(f); };
      // a place alone, breakdown beat, as a photo, then each of the other looks
      for (const [label, spec] of [['hero-photo', plans.photo[0]], ['hero-tile', { kind: 'tile', text: '3', num: true }], ['hero-tile-colour', { kind: 'tile', text: '4', num: true, edge: PAL.teal }], ['hero-emoji', { kind: 'tile', text: '🦅', edge: PAL.berry }], ['hero-flag', { kind: 'flag', flag: 'blue', shape: 'swallow', fill: PAL.pumpkin }]]) {
        await feed(node([{ place: n, e: { t1: ent('t1', nm[1], 12) } }], { cur: 0, shown: 1, teams: n, ago: 5000 }));
        await specimen(p, [spec]);
        await shot(label);
      }
      // ties of 2, 3 and 6 (the breakdown beat)
      for (const k of [2, 3, n === 6 ? 6 : 4]) {
        const e = {}; for (let i = 0; i < k; i++) e['t' + i] = ent('t' + i, nm[i], 20);
        await feed(node([{ place: 1, e }], { cur: 0, shown: 1, teams: n, ago: 5000 }));
        await specimen(p, plan);
        await shot('tie' + k);
        // the names of a tie start on one line, whatever their marks; nothing leaves the screen
        const t = await p.evaluate(() => ({
          tops: [...document.querySelectorAll('#hero-wrap .hero-name')].map((x) => Math.round(x.getBoundingClientRect().top)),
          bottom: Math.max(...[...document.querySelectorAll('#hero-wrap .hero *')].map((x) => x.getBoundingClientRect().bottom)),
          right: Math.max(...[...document.querySelectorAll('#hero-wrap .hero *')].map((x) => x.getBoundingClientRect().right)),
          left: Math.min(...[...document.querySelectorAll('#hero-wrap .hero *')].map((x) => x.getBoundingClientRect().left)),
        }));
        report.push({ camp, w, h, tie: k, nameTops: [...new Set(t.tops)], fits: t.bottom <= h + 1 && t.right <= w + 1 && t.left >= -1, bottom: Math.round(t.bottom) });
      }
      // the board (docked) and the final table, every row a different look
      const groups = []; for (let i = 0; i < n; i++) groups.push({ place: n - i, e: { ['t' + i]: ent('t' + i, nm[i], 10 + 4 * i) } });
      await feed(node(groups, { cur: n - 1, shown: n, teams: n, ago: 9000 }));
      await specimen(p, plan);
      await shot('board');
      await feed(node(groups, { cur: n - 1, shown: n, teams: n, ago: 9000, phase: 'table', finale: true }));
      await specimen(p, plan);
      await shot('table');
      await feed(node(groups, { cur: n - 1, shown: n, teams: n, ago: 9000, phase: 'champion', finale: true }));
      await specimen(p, [plan[2]]);
      await shot('champion');
      // two champions sharing 1st, a photo beside a tile
      const both = [{ place: 1, e: { t0: ent('t0', nm[0], 30), t1: ent('t1', nm[1], 30) } }];
      await feed(node(both, { cur: 0, shown: 1, teams: n, ago: 9000, phase: 'champion', finale: true }));
      await specimen(p, [{ kind: 'photo', src: th.news }, { kind: 'tile', text: '2', num: true, edge: PAL.teal }]);
      await shot('champion-tie');
      // measure every mark on every frame: in the viewport, a tile square, a photo the shield's shape, and in a tie the
      // names' tops on one line
      const m = await p.evaluate(() => [...document.querySelectorAll('.crest-tile, .tv-photo')].map((el) => { const r = el.getBoundingClientRect(); return { c: el.className, w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; }));
      const off = m.filter((x) => x.r > w + 1 || x.b > h + 1);
      report.push({ camp, w, h, marks: m, offscreen: off.length });
      await p.close();
    }
  }
  console.log(JSON.stringify(report));
  await browser.close();
})();
