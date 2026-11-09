// The standings reveal, end to end, in real browsers (BUILD-PLAN Step 23's live check, run locally).
//
//   Two director phones (the shipped app, signed in through the Auth emulator) are remotes; a
//   counselor phone (the shipped app, a viewer) mirrors; and a SIGNED-OUT browser is the big screen
//   (the shipped current-standings.html). Everything talks to a LOCAL Realtime Database emulator
//   that holds the REAL database.rules.json. Nothing in the repo is changed to point at it: this
//   script serves the worktree itself, and for the test only (a) swaps in a firebase-config.js that
//   sends the SDK to the emulators and (b) lets the pages' own CSP reach them. The Firebase SDK
//   files are the pinned 10.12.0 builds, checked against the hashes in the pages' <script> tags.
//
//   Opt-in (needs Playwright, npm and Java, like the rest of tests/emulator):
//     cd tests/emulator && npm install
//     npx firebase emulators:start --only auth,database --project camp-89cea &
//     node reveal-e2e.cjs            # exit code 0 = every check held
//   Needs: `playwright` resolvable from here (npm i -D playwright, or a global one with
//   NODE_PATH=$(npm root -g)), and `curl` once to fetch the SDK files (or SDK_DIR pointing at them).
//   E2E_SHOTS=<dir> writes a screenshot of every context when a check fails.
//   BRAND=1         R2 (big-screen branding): the shipped reveal.js already has REVEAL_BRANDING_LIVE ON, so this adds
//                   the looks: three teams
//                   carry a look (a colour + emoji, a cleared number tile, a photo) and extra checks follow each shown
//                   place onto the big screen and into the public node.
//   OLD_RULES=1     with BRAND=1: load the rules that were live before R2 (tests/emulator/r1.rules.json) instead of
//                   database.rules.json, to prove the fallback: the old rules refuse the branded place once, the remote
//                   sends it plain, and the whole reveal still plays, with the printed look on the big screen.
//
//   What it proves (each a numbered check below): a Start, three places, a simultaneous press by
//   both remotes (one wins), Back, End early; the big screen signed out the whole time and never
//   reading or writing anything but revealPublic; the counselor three seconds behind a new place
//   and keeping the grid; an anonymous read of revealPublic showing only the places shown so far;
//   a practice that plays on the big screen but never reaches the counselor; a real Start taking
//   the big screen over from a practice; and the practice leaving no trace at its End.
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('reveal-e2e needs Playwright: npm i -D playwright (or NODE_PATH=$(npm root -g)).');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..', '..');
const DB = 'http://127.0.0.1:9000';
const AUTH = 'http://127.0.0.1:9099';
const NS = 'camp-89cea-default-rtdb';           // the namespace the shipped databaseURL names
const CAMP_ROOT = 'campScoreboard';
const SDK_FILES = ['firebase-app-compat', 'firebase-auth-compat', 'firebase-database-compat'];
const BRAND = !!process.env.BRAND;
const OLD_RULES = !!process.env.OLD_RULES;
const SDK_DIR = process.env.SDK_DIR || path.join(os.tmpdir(), 'camp-e2e-sdk-10.12.0');

const ED1 = { email: 'ed@x.com', key: 'ed@x,com', name: 'Ed One' };
const ED2 = { email: 'ed2@x.com', key: 'ed2@x,com', name: 'Ed Two' };
const VW = { email: 'vw@x.com', key: 'vw@x,com', name: 'Vee Counselor', teamId: 't1' };

// Six teams, distinct names, no ties: 1st t0 19 · 2nd t1 17 · 3rd t2 15 · 4th t4 11 · 5th t3 10 · 6th t5 3.
const TEAMS = [['t0', 'Foxes'], ['t1', 'Turkeys'], ['t2', 'Maples'], ['t3', BRAND ? 'Team 4' : 'Pumpkins'], ['t4', 'Pilgrims'], ['t5', 'Deersz']];
const NAME = Object.fromEntries(TEAMS);
const ORDER = ['t5', 't3', 't4', 't2', 't1', 't0'];   // the order places are revealed: 6th first

// ── tiny runner ──────────────────────────────────────────────────────
let passed = 0;
const failed = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { failed.push(name); console.log('  \x1b[31m✗\x1b[0m ' + name + (detail !== undefined ? '\n      ' + String(detail).slice(0, 400) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms) {
  const deadline = Date.now() + (ms || 30000);
  for (;;) {
    let v;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() > deadline) throw new Error('timed out waiting for ' + what);
    await sleep(60);
  }
}

// ── the database emulator, over REST ─────────────────────────────────
async function admin(method, p, body) {
  if (!/\.json(\?|$)/.test(p)) p = p === '/' ? '/.json' : p + '.json';
  const res = await fetch(DB + p + (p.includes('?') ? '&' : '?') + 'ns=' + NS, {
    method, headers: { Authorization: 'Bearer owner' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(method + ' ' + p + ' → ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}
// What a stranger with the address sees: no token at all.
async function anon(p) {
  const res = await fetch(DB + p + '?ns=' + NS);
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, body };
}

function defaultConfig() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'defaults.js'), 'utf8'), ctx);
  return vm.runInContext('JSON.parse(JSON.stringify(defaultConfig()))', ctx);
}

// A real PNG made here (a smooth gradient, small enough for the 100,000-character photo rule), so the director's phone has a photo to turn into a thumbnail.
function makePng(w, h) {
  const zlib = require('zlib');
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { const o = y * (w * 3 + 1); for (let x = 0; x < w; x++) { raw[o + 1 + x * 3] = (y * 255 / h) | 0; raw[o + 2 + x * 3] = 120; raw[o + 3 + x * 3] = 90; } }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
// The looks the BRAND run gives three teams: 6th (t5) a colour and an emoji, 4th (t4) a photo, 5th (t3) cleared (number tile).
const LOOK = { t5: { color: 'teal', emoji: '🦊' }, t4: { photoV: 1 }, t3: { plain: true, emoji: '4\uFE0F\u20E3' } };

async function seed() {
  await admin('PUT', '/.settings/rules.json', JSON.parse(fs.readFileSync(OLD_RULES ? path.join(ROOT, 'tests', 'emulator', 'r1.rules.json') : path.join(ROOT, 'database.rules.json'), 'utf8')));
  await admin('DELETE', '/');
  const rec = (role, who, extra) => Object.assign({ role, name: who.name, addedBy: 'e2e', addedAt: '2026-11-02' }, extra || {});
  const config = defaultConfig();
  const games = config.games.filter((g) => !g.messtival).slice(0, 5).map((g) => g.id);
  const medals = [['t0', 't1', 't2'], ['t0', 't2', 't3'], ['t1', 't0', 't4'], ['t3', 't4', 't5'], ['t2', 't1', 't4']];
  const results = {};
  games.forEach((id, i) => { results[id] = { medals: { gold: medals[i][0], silver: medals[i][1], bronze: medals[i][2] } }; });
  await admin('PUT', '/' + CAMP_ROOT, {
    members: {
      [ED1.key]: rec('editor', ED1), [ED2.key]: rec('editor', ED2),
      [VW.key]: rec('viewer', VW, { teamId: VW.teamId }),
    },
    config,
    state: { ...(BRAND ? { meta: { epoch: 'w20270101', epochAt: 1798761600000 } } : {}), teams: TEAMS.map(([id, name]) => Object.assign({ id, name }, BRAND ? LOOK[id] || {} : {})), results },
    ...(BRAND ? { teamPhotos: { t4: { v: 1, data: makePng(240, 333) } } } : {}),
  });
}

// ── a local static server (the worktree), plus the test-only swaps ───
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };
function emulatorConfig() {
  const real = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');
  return real + `
;(function () { // test only: send the SDK to the local emulators (the shipped config is untouched)
  if (!window.firebase || !firebase.initializeApp) return;
  var orig = firebase.initializeApp;
  firebase.initializeApp = function () {
    var app = orig.apply(this, arguments);
    try { if (typeof app.auth === 'function') app.auth().useEmulator('${AUTH}', { disableWarnings: true }); } catch (e) {}
    try { app.database().useEmulator('127.0.0.1', 9000); } catch (e) {}
    return app;
  };
})();
`;
}
function serve() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || /\/(\.git|node_modules|tests)\//.test(rel)) { res.writeHead(404); res.end(); return; }
    if (rel === '/firebase-config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'] }); res.end(emulatorConfig()); return; }
    fs.readFile(file, (err, data) => {
      if (!err && BRAND && rel === '/reveal.js') data = Buffer.from(data.toString('utf8').replace('let REVEAL_BRANDING_LIVE = false;', 'let REVEAL_BRANDING_LIVE = true;')); // test only: a no-op now the shipped switch is on, kept so an older checkout still runs
      if (err) { res.writeHead(404); res.end('not found'); return; }
      let body = data;
      if (rel.endsWith('.html')) {
        // test only: let the page's own CSP reach the local emulators (everything else in it stays as shipped)
        // (the directive inside the CSP meta tag, not a mention of it in a comment above)
        body = Buffer.from(data.toString('utf8').replace(/(<meta http-equiv="Content-Security-Policy" content="[^"]*?)connect-src /, '$1connect-src http://127.0.0.1:9000 ws://127.0.0.1:9000 http://127.0.0.1:9099 '));
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// The pinned SDK builds, verified against the integrity attributes the pages actually carry.
function loadSdk() {
  fs.mkdirSync(SDK_DIR, { recursive: true });
  const pages = ['index.html', 'current-standings.html'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const out = {};
  SDK_FILES.forEach((f) => {
    const file = path.join(SDK_DIR, f + '.js');
    if (!fs.existsSync(file)) execFileSync('curl', ['-sS', '--fail', '-m', '60', '-o', file, 'https://www.gstatic.com/firebasejs/10.12.0/' + f + '.js']);
    const body = fs.readFileSync(file);
    const hash = 'sha384-' + crypto.createHash('sha384').update(body).digest('base64');
    const tag = new RegExp(f + '\\.js"\\s+integrity="([^"]+)"').exec(pages);
    check('the pinned ' + f + ' build matches the hash the page carries', !!tag && tag[1] === hash, tag ? tag[1] + ' vs ' + hash : 'no tag');
    out[f] = body;
  });
  return out;
}

// ── browser contexts ─────────────────────────────────────────────────
async function newPhone(browser, base, sdk, who, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', permissions: [] });
  const page = await ctx.newPage();
  page.__name = name;
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e.message || e)));
  if (process.env.E2E_DEBUG) page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('    [' + name + ' console.' + m.type() + '] ' + m.text().slice(0, 300)); });
  await route(page, sdk);
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0), name + ' firebase app', 30000);
  await page.evaluate(async (tok) => {
    const cred = firebase.auth.GoogleAuthProvider.credential(tok);
    await firebase.auth().signInWithCredential(cred);
  }, JSON.stringify({ sub: 'uid-' + who.email, email: who.email, email_verified: true }));
  await until(() => page.evaluate(() => typeof appStarted !== 'undefined' && appStarted === true && memberRoleConfirmed === true), name + ' approved', 30000);
  await dismissDialogs(page);
  return page;
}

async function route(page, sdk) {
  await page.route('**/*', (r) => {
    const url = r.request().url();
    const m = /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.0\/([a-z-]+)\.js$/.exec(url);
    if (m && sdk[m[1]]) return r.fulfill({ status: 200, contentType: 'application/javascript', body: sdk[m[1]] });
    if (/^http:\/\/127\.0\.0\.1:(9000|9099)\//.test(url) || /^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return r.continue();
    return r.abort();   // fonts, weather, anything else off the machine
  });
}

// A fresh phone may open a team / camp question over everything; put it away.
async function dismissDialogs(page) {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => {
      const d = [...document.querySelectorAll('jelly-dialog')].find((x) => x.hasAttribute('open') && x.id !== 'ask-dialog');
      return d ? d.id || 'dialog' : '';
    });
    if (!open) return;
    await page.keyboard.press('Escape');
    await sleep(250);
  }
}

async function answerAsk(page, label, ms) {
  const btn = page.locator('#ask-actions .btn', { hasText: label }).first();
  try { await btn.waitFor({ state: 'visible', timeout: ms || 2500 }); } catch (e) { return false; }
  await btn.click();
  return true;
}

async function openRemote(page) {
  await page.click('#tabbar .tab[data-tab="more"]');
  await until(() => page.evaluate(() => { const r = document.getElementById('reveal-row'); return r && !r.hidden; }), 'the Run the reveal row', 15000);
  await page.click('#reveal-row');
  await until(() => page.evaluate(() => { const t = document.getElementById('takeover-reveal'); return t && !t.hidden; }), 'the remote', 15000);
}
const phase = (page) => page.getAttribute('#takeover-reveal', 'data-phase');
const goState = (page) => page.getAttribute('#reveal-go', 'data-state');
async function waitGo(page, what) {
  await until(async () => (await goState(page)) === 'ready', (page.__name || '') + ' big button ready (' + what + ')', 40000);
}

// Toasts live in a shadow root (innerText can't see them): record what the page asks showToast to say.
async function recordToasts(page) {
  await page.evaluate(() => {
    if (window.__toasts) return;
    window.__toasts = [];
    const orig = showToast;
    showToast = function (m) { window.__toasts.push(String(m)); return orig.apply(this, arguments); };
  });
}
const toastsOf = (page) => page.evaluate(() => window.__toasts || []);
const dump = (page) => page.evaluate(() => ({
  phase: (document.getElementById('takeover-reveal') || {}).dataset && document.getElementById('takeover-reveal').dataset.phase,
  mode: document.getElementById('takeover-reveal').dataset.mode,
  go: document.getElementById('reveal-go').innerText.replace(/\s+/g, ' '), goState: document.getElementById('reveal-go').dataset.state,
  ask: [...document.querySelectorAll('#ask-dialog, #ask-actions .btn')].map((x) => x.id || x.innerText).join(' / '),
  toasts: window.__toasts || [],
}));

// ── observers ────────────────────────────────────────────────────────
const tvState = (page) => page.evaluate(() => {
  const el = (id) => document.getElementById(id);
  const intro = el('intro');
  return {
    waiting: !el('waiting').hidden, stage: !el('screen').hidden, practice: !el('tv-practice').hidden,
    introUp: !!intro && intro.style.display !== 'none' && !el('screen').hidden,
    hero: ((document.querySelector('.hero-place') || {}).textContent || '').trim(),
    heroName: ((document.querySelector('.hero-name') || {}).textContent || '').trim(),
    rows: [...document.querySelectorAll('#board .row .nm')].map((e) => e.textContent.trim()),
    final: el('board').classList.contains('final'), finale: el('finale').classList.contains('show'),
    status: el('wait-status-text').textContent,
    mark: (() => { const m = [...document.querySelectorAll('.hero-shield')].pop(); if (!m) return null; return { tag: m.tagName.toLowerCase(), cls: m.getAttribute('class') || '', src: (m.getAttribute('src') || '').slice(0, 24), num: m.getAttribute('data-num') !== null ? (m.textContent || '').trim() : '', text: (m.textContent || '').trim(), edge: m.style.getPropertyValue('--tile-edge'), fill: m.style.getPropertyValue('--flag-fill') }; })(),
  };
});
const phoneState = (page) => page.evaluate(() => {
  const el = (id) => document.getElementById(id);
  return {
    live: el('tab-now').dataset.reveal === 'live',
    mirror: !el('now-reveal').hidden, list: el('now-reveal-list').innerText,
    grid: !el('now-reveal-grid').hidden, gridText: el('now-reveal-grid-list').innerText,
    practiceInMemory: typeof confirmedReveal !== 'undefined' && !!confirmedReveal.practice,
    body: document.body.innerText,
  };
});
const nodeOf = async (mode) => (await anon('/' + CAMP_ROOT + '/revealPublic/' + mode + '.json')).body;
const placeWords = (n) => ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][n];

// ── the run ──────────────────────────────────────────────────────────
(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const pages = {};
  try {
    console.log('\n── Standings reveal, end to end (shipped pages, real rules, local emulators) ──');
    const sdk = loadSdk();
    try { await admin('GET', '/.json?shallow=true'); } catch (e) { throw new Error('the database emulator is not answering at ' + DB + ' (npx firebase emulators:start --only auth,database --project camp-89cea): ' + e.message); }
    await seed();
    check('the real database.rules.json is loaded in the emulator, and a stranger is refused everything but revealPublic', await (async () => {
      const state = await anon('/' + CAMP_ROOT + '/state.json');
      const members = await anon('/' + CAMP_ROOT + '/members.json');
      const full = await anon('/' + CAMP_ROOT + '/revealFull.json');
      const pub = await anon('/' + CAMP_ROOT + '/revealPublic.json');
      return state.status === 401 && members.status === 401 && full.status === 401 && pub.status === 200 && pub.body === null;
    })());

    browser = await chromium.launch();
    // The big screen: signed out, in its own context, the shipped page.
    const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
    const tv = await tvCtx.newPage();
    pages.tv = tv;
    const tvRequests = [];
    tv.on('request', (r) => tvRequests.push(r.url()));
    tv.on('websocket', (w) => tvRequests.push(w.url()));
    const tvErrors = [];
    tv.on('pageerror', (e) => tvErrors.push(String(e.message || e)));
    if (process.env.E2E_DEBUG) tv.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('    [tv console.' + m.type() + '] ' + m.text().slice(0, 300)); });
    await route(tv, sdk);
    await tv.goto(base + '/current-standings.html', { waitUntil: 'domcontentloaded' });
    await until(async () => (await tvState(tv)).status === 'Connected · this screen is ready', 'the big screen to say it is ready', 30000);
    let s = await tvState(tv);
    check('1. signed out, the big screen says "Waiting for the directors…" and "Connected · this screen is ready"', s.waiting && !s.stage && /Waiting for the directors/.test(await tv.textContent('.wait-title')), JSON.stringify(s));

    const A = pages.a = await newPhone(browser, base, sdk, ED1, 'remote A');
    const B = pages.b = await newPhone(browser, base, sdk, ED2, 'remote B');
    const C = pages.c = await newPhone(browser, base, sdk, VW, 'counselor');
    const c0 = await phoneState(C);
    check('2. before any reveal the counselor sees no mirror, no grid and none of the teams\' names in it', !c0.live && !c0.mirror && !c0.grid && TEAMS.every(([, n]) => c0.list.indexOf(n) < 0), JSON.stringify(c0).slice(0, 300));

    // ── a real reveal: Start ──
    await openRemote(A);
    await waitGo(A, 'Start');
    check('3. a director\'s remote opens on the ready screen', (await phase(A)) === 'ready');
    await A.click('#reveal-go');
    await answerAsk(A, /start anyway/i);
    await until(async () => (await phase(A)) === 'intro', 'the remote at its intro', 20000);
    await until(async () => (await tvState(tv)).introUp, 'the big screen at its intro', 15000);
    s = await tvState(tv);
    check('4. Start: the big screen leaves Waiting for the intro, untagged', s.stage && !s.waiting && !s.practice && s.introUp, JSON.stringify(s));
    await until(async () => (await phoneState(C)).live, 'the counselor\'s mirror', 15000);
    const c1 = await phoneState(C);
    check('5. the counselor\'s Now turns into the live mirror, with no team\'s name or place in it yet', c1.mirror && TEAMS.every(([, n]) => c1.list.indexOf(n) < 0) && !/Look at the big screen/.test(c1.list), c1.list.slice(0, 200));
    let pub = await nodeOf('real');
    check('6. the public node holds a ctl and no place at all', !!pub && !!pub.ctl && pub.ctl.phase === 'intro' && !pub.pub && !JSON.stringify(pub).includes('@') && !JSON.stringify(pub).includes(ED1.name), JSON.stringify(pub).slice(0, 300));
    const full = await anon('/' + CAMP_ROOT + '/revealFull.json');
    check('7. the complete order is NOT readable without a sign-in (revealFull)', full.status === 401, full.status);

    // ── reveal three places (two remotes; the third is pressed by both at once) ──
    await openRemote(B);
    await until(async () => (await phase(B)) === 'intro', 'remote B following A\'s Start', 20000);
    check('8. a second director\'s remote follows the same reveal', (await phase(B)) === 'intro');

    async function revealOn(page, n) {
      const tid = ORDER[n - 1], word = placeWords(7 - n);
      await waitGo(page, 'place ' + n);
      const t0 = Date.now();
      await page.click('#reveal-go');
      const [tTv, tPhone] = await Promise.all([
        until(async () => { const x = await tvState(tv); return x.hero.indexOf(word) >= 0 && x.heroName.indexOf(NAME[tid]) >= 0; }, 'the big screen showing ' + word, 20000).then(() => Date.now()),
        until(async () => (await phoneState(C)).list.indexOf(NAME[tid]) >= 0, 'the counselor showing ' + word, 25000).then(() => Date.now()),
      ]);
      return { tTv: tTv - t0, tPhone: tPhone - t0 };
    }
    // the first place: counselor lag and the "Look at the big screen" row
    const looked = { seen: false };
    const watcher = (async () => { for (let i = 0; i < 120; i++) { if (/Look at the big screen/.test((await phoneState(C)).list)) { looked.seen = true; return; } await sleep(50); } })();
    const t1 = await revealOn(A, 1);
    await watcher;
    check('9. place 1 (6th): the big screen shows it at once; the counselor\'s phone is about three seconds behind, and says "Look at the big screen" meanwhile',
      looked.seen && t1.tPhone - t1.tTv >= 2200 && t1.tPhone - t1.tTv <= 7000, JSON.stringify({ looked, t1 }));
    pub = await nodeOf('real');
    const hidden1 = JSON.stringify(pub);
    check('10. the public node holds 6th place only — no other team\'s name, no member key', pub.ctl.shown === 1 && Object.keys(pub.pub).length === 1 && TEAMS.filter(([id]) => id !== 't5').every(([, n]) => hidden1.indexOf(n) < 0) && hidden1.indexOf('@') < 0, hidden1.slice(0, 400));
    if (BRAND) {
      s = await tvState(tv);
      const e6 = pub.pub.g0.e.t5;
      if (!OLD_RULES) {
        check('B1. 6th place (a picked colour and emoji on a junior team that keeps its shield): its public entry carries k and em, and the big screen still draws the shield (the phones order)', e6.k === 'teal' && e6.em === '🦊' && !('ph' in e6) && !('pl' in e6) && !!s.mark && s.mark.tag === 'img' && /images\/team-shields\//.test(s.mark.src), JSON.stringify({ e6, mark: s.mark }));
      } else {
        const plainOk = e6.k === undefined && e6.em === undefined;
        check('B1. under the OLD rules the branded place was refused once and went out plain: the whole place is there, with no look, and the big screen draws the printed look', plainOk && pub.ctl.shown === 1 && !!s.mark && s.mark.tag === 'img', JSON.stringify({ e6, mark: s.mark }));
      }
    }

    await revealOn(B, 2);   // the other director reveals 5th
    if (BRAND) {
      pub = await nodeOf('real');
      s = await tvState(tv);
      const e5 = pub.pub.g1 && pub.pub.g1.e && pub.pub.g1.e.t3;
      if (!OLD_RULES) {
        check('B2. 5th place (cleared team): the public entry carries pl and its keycap, and the big screen draws its number tile, not the printed shield', !!e5 && e5.pl === true && /^4\uFE0F?\u20E3$/.test(e5.em || '') && !!s.mark && s.mark.tag === 'div' && s.mark.num === '4', JSON.stringify({ e5, mark: s.mark }));
      } else {
        check('B2. under the OLD rules 5th place still went out (plain) and the big screen draws the printed look', !!e5 && e5.pl === undefined && e5.em === undefined && !!s.mark && s.mark.tag === 'img' && /images\/team|\/images\//.test(s.mark.src + (await tv.evaluate(() => (document.querySelector('.hero-shield:last-of-type') || {}).src || ''))), JSON.stringify({ e5, mark: s.mark }));
      }
    }
    // 4th place: BOTH remotes press at the same moment
    await Promise.all([waitGo(A, 'place 3'), waitGo(B, 'place 3')]);
    await Promise.all([recordToasts(A), recordToasts(B)]);
    await Promise.all([A.click('#reveal-go'), B.click('#reveal-go')]);
    await until(async () => (await nodeOf('real')).ctl.shown >= 3, 'the third place', 20000);
    await sleep(2500);
    pub = await nodeOf('real');
    check('11. both remotes pressing Reveal at the same moment shows exactly ONE place (the other is refused, nothing is skipped)', pub.ctl.shown === 3 && pub.ctl.cur === 2, JSON.stringify(pub.ctl));
    const said = (await toastsOf(A)).concat(await toastsOf(B));
    check('12. the loser is told, in words, that another director already showed it', said.some((t) => /already showed 4th place/i.test(t)), said.join(' | '));
    s = await tvState(tv);
    check('13. the big screen is on 4th place (Patriotic Pilgrims here: Pilgrims)', /4th/.test(s.hero) && s.heroName.indexOf(NAME.t4) >= 0, JSON.stringify(s));
    if (BRAND) {
      pub = await nodeOf('real');
      const e4 = pub.pub.g2.e.t4;
      const photoElsewhere = JSON.stringify([pub.pub.g0, pub.pub.g1]).indexOf('data:image') >= 0;
      if (!OLD_RULES) await until(async () => { const m = (await tvState(tv)).mark; return !!m && m.tag === 'img' && /tv-photo/.test(m.cls); }, 'the big screen to draw 4th place\'s photo', 8000);
      s = await tvState(tv);
      if (!OLD_RULES) {
        check('B3. 4th place (a photo): its entry carries a small JPEG made on the director\'s phone (at most 20,000 characters), no earlier place carries one, and the big screen draws it as the mark', !!e4 && typeof e4.ph === 'string' && /^data:image\/jpeg;base64,/.test(e4.ph) && e4.ph.length <= 20000 && !photoElsewhere && !!s.mark && s.mark.tag === 'img' && /tv-photo/.test(s.mark.cls) && /^data:image\/jpeg/.test(s.mark.src), JSON.stringify({ len: e4 && e4.ph && e4.ph.length, mark: s.mark, photoElsewhere, a: await A.evaluate(() => ({ thumbs: [...revealThumbs.keys()], mem: [...TEAM_PHOTO_MEM.keys()], v: teamPhotoVersion('t4'), open: revealRemoteOpenFlag, tries: revealThumbTries })), b: await B.evaluate(() => ({ thumbs: [...revealThumbs.keys()], mem: [...TEAM_PHOTO_MEM.keys()], open: revealRemoteOpenFlag })) }));
      } else {
        check('B3. under the OLD rules 4th place went out with no photo, and the reveal carried on', !!e4 && e4.ph === undefined && !photoElsewhere && !!s.mark && s.mark.tag === 'img' && !/tv-photo/.test(s.mark.cls), JSON.stringify({ e4, mark: s.mark }));
      }
    }
    await until(async () => { const l = (await phoneState(C)).list; return l.indexOf(NAME.t4) >= 0; }, 'the counselor to catch up to 4th', 15000);
    const c3 = await phoneState(C);
    pub = await nodeOf('real');
    const only3 = JSON.stringify(pub);
    check('14. the counselor shows 6th, 5th and 4th; an anonymous read of the node shows only those three — not 3rd, 2nd or 1st',
      [NAME.t5, NAME.t3, NAME.t4].every((n) => c3.list.indexOf(n) >= 0) && [NAME.t2, NAME.t1, NAME.t0].every((n) => c3.list.indexOf(n) < 0 && only3.indexOf(n) < 0) && Object.keys(pub.pub).length === 3,
      c3.list.slice(0, 300) + ' || ' + only3.slice(0, 300));

    // ── Back ──
    await waitGo(A, 'Back');
    await until(async () => (await A.getAttribute('#reveal-back', 'data-state')) === 'ready', 'Back ready', 30000);
    await A.click('#reveal-back');
    await until(async () => { const x = await tvState(tv); return /5th/.test(x.hero); }, 'the big screen stepping back to 5th', 20000);
    pub = await nodeOf('real');
    await sleep(3500);
    const c4 = await phoneState(C);
    check('15. Back: the big screen shows 5th again; the node keeps all three places; the counselor still shows all three',
      pub.ctl.cur === 1 && pub.ctl.shown === 3 && Object.keys(pub.pub).length === 3 && [NAME.t5, NAME.t3, NAME.t4].every((n) => c4.list.indexOf(n) >= 0), JSON.stringify(pub.ctl) + ' || ' + c4.list.slice(0, 200));

    // ── End early ──
    await A.click('#reveal-end');
    await answerAsk(A, /end the reveal/i);
    await until(async () => (await nodeOf('real')).ctl.phase === 'ended', 'the node to say ended', 20000);
    await until(async () => (await tvState(tv)).waiting, 'the big screen back to Waiting', 20000);
    s = await tvState(tv);
    check('16. End early: the big screen goes back to Waiting', s.waiting && !s.stage && !s.practice, JSON.stringify(s));
    await until(async () => (await phoneState(C)).grid, 'the counselor\'s frozen grid', 20000);
    const c5 = await phoneState(C);
    check('17. the counselor keeps a frozen grid of the three places shown, with the rest "Not revealed" — and no live mirror',
      c5.grid && !c5.live && [NAME.t5, NAME.t3, NAME.t4].every((n) => c5.gridText.indexOf(n) >= 0) && [NAME.t2, NAME.t1, NAME.t0].every((n) => c5.gridText.indexOf(n) < 0) && (c5.gridText.match(/Not revealed/g) || []).length === 3, c5.gridText.slice(0, 300));
    pub = await nodeOf('real');
    check('18. an anonymous read after the End still shows only the three places shown', Object.keys(pub.pub).length === 3 && [NAME.t2, NAME.t1, NAME.t0].every((n) => JSON.stringify(pub).indexOf(n) < 0));

    // ── a practice: on the big screen, never on the counselor's phone ──
    await B.click('#takeover-reveal .tk-back');       // B back out to More, so the practice switch is a fresh act
    await openRemote(B);
    await until(async () => (await phase(B)) === 'ended' || (await phase(B)) === 'ready', 'remote B at its ready screen', 15000);
    await B.click('#reveal-practice');
    await until(async () => (await B.getAttribute('#takeover-reveal', 'data-mode')) === 'practice', 'remote B in practice mode', 15000);
    await waitGo(B, 'practice Start');
    await B.click('#reveal-go');
    await answerAsk(B, /start a practice|start anyway/i);
    await until(async () => (await phase(B)) === 'intro', 'the practice at its intro', 20000);
    await until(async () => (await tvState(tv)).practice, 'the Practice tag on the big screen', 20000);
    s = await tvState(tv);
    check('19. a practice plays on the big screen, tagged Practice', s.stage && s.practice && s.introUp, JSON.stringify(s));
    await waitGo(B, 'practice place 1');
    await B.click('#reveal-go');
    await until(async () => { const x = await tvState(tv); return x.practice && /6th/.test(x.hero) && x.heroName.indexOf(NAME.t5) >= 0; }, 'the practice\'s first place on the big screen (the REAL standings)', 20000);
    await sleep(3500);
    const c6 = await phoneState(C);
    const pubAll = (await anon('/' + CAMP_ROOT + '/revealPublic.json')).body;
    check('20. the counselor\'s phone never sees the practice: nothing in memory, nothing on screen, its frozen grid untouched',
      !c6.practiceInMemory && c6.grid && !c6.live && !/practice/i.test(c6.gridText) && (c6.gridText.match(/Not revealed/g) || []).length === 3 && !!pubAll.practice && !!pubAll.real, JSON.stringify({ mem: c6.practiceInMemory, grid: c6.grid, live: c6.live }));
    check('21. the practice\'s node is public while it plays but holds only the one place shown', Object.keys(pubAll.practice.pub || {}).length === 1, JSON.stringify(pubAll.practice).slice(0, 300));

    // ── a real Start takes the big screen over from the practice ──
    await A.click('#takeover-reveal .tk-back');
    await openRemote(A);
    // A's remote follows B's running practice (a live practice is what a remote shows), which offers the real Start
    await until(async () => (await A.getAttribute('#takeover-reveal', 'data-mode')) === 'practice' && (await A.evaluate(() => !document.getElementById('reveal-offer').hidden)), 'the real Start offered on A\'s remote', 20000);
    await recordToasts(A);
    await A.click('#reveal-start-real');
    const askedNew = await answerAsk(A, /start a new reveal/i);
    const askedAny = await answerAsk(A, /start anyway/i, 1500);
    try { await until(async () => (await nodeOf('real')).ctl.phase === 'intro', 'the new real reveal', 20000); }
    catch (e) { throw new Error(e.message + ' — ' + JSON.stringify({ askedNew, askedAny, a: await dump(A), node: await nodeOf('real') }).slice(0, 700)); }
    await until(async () => { const x = await tvState(tv); return x.stage && !x.practice && x.introUp; }, 'the big screen switching to the real reveal', 15000);
    s = await tvState(tv);
    check('22. a real Start during a practice takes the big screen over at once (no Practice tag, the intro)', s.stage && !s.practice && s.introUp, JSON.stringify(s));
    const pubAll2 = (await anon('/' + CAMP_ROOT + '/revealPublic.json')).body;
    check('23. the practice stays in its own child; the new real reveal starts with no place at all', !!pubAll2.practice && !pubAll2.real.pub && pubAll2.real.ctl.phase === 'intro', JSON.stringify(pubAll2).slice(0, 300));
    await until(async () => { const c = await phoneState(C); return c.live && !c.grid; }, 'the counselor to move to the new reveal (the old grid is gone)', 20000);
    const c7 = await phoneState(C);
    check('24. the counselor\'s old grid vanishes at once and the new mirror shows none of the old places', c7.mirror && !c7.grid && [NAME.t5, NAME.t3, NAME.t4].every((n) => c7.list.indexOf(n) < 0), c7.list.slice(0, 200));

    // ── End the real one: the practice is on screen again; then End the practice ──
    await waitGo(A, 'place 1 of the new reveal');
    await A.click('#reveal-go');
    await until(async () => (await nodeOf('real')).ctl.shown === 1, 'one place in the new reveal', 20000);
    await sleep(1000);
    await A.click('#reveal-end');
    await answerAsk(A, /end the reveal/i);
    await until(async () => (await nodeOf('real')).ctl.phase === 'ended', 'the real reveal ended', 20000);
    await until(async () => (await tvState(tv)).practice, 'the practice back on the big screen', 20000);
    s = await tvState(tv);
    check('25. when the real reveal ends, the practice that is still playing is on the big screen again, tagged', s.stage && s.practice, JSON.stringify(s));
    await B.click('#reveal-end');
    await answerAsk(B, /end practice/i);
    await until(async () => !(await anon('/' + CAMP_ROOT + '/revealPublic/practice.json')).body, 'the practice node to be deleted', 20000);
    await until(async () => (await tvState(tv)).waiting, 'the big screen back to Waiting', 20000);
    s = await tvState(tv);
    const finalPub = (await anon('/' + CAMP_ROOT + '/revealPublic.json')).body;
    check('26. End practice: its places are gone from the public node and the big screen is Waiting (the real reveal\'s node is untouched)', s.waiting && !s.practice && finalPub && !finalPub.practice && !!finalPub.real, JSON.stringify(finalPub).slice(0, 200));
    const full2 = await anon('/' + CAMP_ROOT + '/revealFull.json');
    check('27. revealFull is still refused to a stranger at the end', full2.status === 401);

    // ── the big screen stayed anonymous and read-only the whole time ──
    const hosts = [...new Set(tvRequests.map((u) => { try { const x = new URL(u); return x.protocol + '//' + x.host; } catch (e) { return u; } }))];
    check('28. the big screen only ever talked to this server, the SDK host and the database emulator — no sign-in service',
      hosts.every((h) => /^(http:\/\/127\.0\.0\.1:\d+|ws:\/\/127\.0\.0\.1:9000|https:\/\/www\.gstatic\.com)$/.test(h)) && !tvRequests.some((u) => /identitytoolkit|securetoken|accounts\.google|googleapis|:9099/.test(u)), hosts.join(' '));
    const tvScripts = await tv.evaluate(() => [...document.scripts].map((x) => x.src).filter((x) => /gstatic/.test(x)));
    check('29. it loaded exactly the app and database SDKs (no Auth SDK) and has no stored sign-in', tvScripts.length === 2 && !tvScripts.some((x) => /auth/.test(x)) && (await tv.evaluate(async () => typeof firebase === 'undefined' || typeof firebase.auth === 'undefined')) && (await tv.evaluate(async () => !(indexedDB.databases ? (await indexedDB.databases()).some((d) => /firebase/i.test(d.name)) : false))), tvScripts.join(','));
    check('30. no page threw', tvErrors.length === 0 && Object.values(pages).every((p) => !p.__errors || p.__errors.length === 0), tvErrors.concat(...Object.values(pages).map((p) => p.__errors || [])).join(' | '));
  } catch (e) {
    failed.push('the run itself: ' + (e && e.message));
    console.log('\n  \x1b[31m✗ ' + (e && e.stack || e) + '\x1b[0m');
    if (process.env.E2E_SHOTS) {
      fs.mkdirSync(process.env.E2E_SHOTS, { recursive: true });
      for (const [k, p] of Object.entries(pages)) { try { await p.screenshot({ path: path.join(process.env.E2E_SHOTS, 'fail-' + k + '.png') }); } catch (e2) { /* ignore */ } }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  console.log('\n' + (failed.length ? '\x1b[31m' + failed.length + ' failed\x1b[0m, ' : '') + '\x1b[' + (failed.length ? '0' : '32') + 'm' + passed + ' passed\x1b[0m');
  console.log(failed.length ? 'UNSAFE' : 'SAFE');
  process.exit(failed.length ? 1 : 0);
})();
