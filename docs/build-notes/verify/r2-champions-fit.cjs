// Does the champions' frame fit a 16:9 screen with 1, 2, 3, 4 and 6 champions (a shared title), both camps, the camp's own
// marks? Two junior champions ran off the top and the bottom of every screen before the R2 design pass's .champ-shields rules.
// Usage: serve the worktree (python3 -m http.server 8971), then node docs/build-notes/verify/r2-champions-fit.cjs (PORT=).
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const FAKE = `(function () {
  var listeners = {}; var vals = { '.info/serverTimeOffset': 0, '.info/connected': true };
  function ref(p) { return { on: function (t, cb) { (listeners[p] = listeners[p] || []).push(cb); setTimeout(function () { cb({ val: function () { return vals[p] === undefined ? null : vals[p]; } }); }, 0); }, off: function () {} }; }
  window.firebase = { apps: [], initializeApp: function () { this.apps.push({}); }, database: function () { return { ref: ref, goOffline: function () {}, goOnline: function () {} }; } };
  window.__feed = function (p, v) { vals[p] = v; (listeners[p] || []).forEach(function (cb) { cb({ val: function () { return v; } }); }); };
})();`;
(async () => {
  const b = await chromium.launch();
  const out = [];
  for (const camp of ['junior', 'senior']) for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]]) for (const k of [1, 2, 3, 4, 6]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.route('https://camp-alerts.patricksimpson-fx.workers.dev/**', (r) => r.abort());
    await p.route('**/*.firebaseio.com/**', (r) => r.abort());
    await p.route('https://www.gstatic.com/**', (r) => r.abort());
    await p.route('**/tv-fake-firebase.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
    await p.route('**/current-standings.html*', async (r) => {
      const res = await r.fetch();
      let html = await res.text();
      html = html.replace(/<script src="https:\/\/www\.gstatic\.com[^>]*><\/script>\s*/g, '').replace('<script src="firebase-config.js', '<script src="tv-fake-firebase.js"></script>\n  <script src="firebase-config.js');
      r.fulfill({ response: res, body: html });
    });
    await p.goto('http://localhost:' + (process.env.PORT || 8971) + '/current-standings.html' + (camp === 'senior' ? '?camp=senior' : ''));
    await p.waitForTimeout(200);
    const now = Date.now();
    const names = camp === 'senior' ? ['Red Team', 'Blue Team', 'Green Team', 'Gold Team'] : ['Ferocious Foxes', 'Methodic Mediocre Maples', 'Particularly Perilous Pumpkins', 'Patriotic Pilgrims', 'Runaway John Deeres', 'Turkey Dinner'];
    if (camp === 'senior' && k > 4) { await p.close(); continue; }
    const e = {}; for (let i = 0; i < k; i++) e['t' + i] = { nm: names[i], p: 30, g: 2, s: 1, b: 1, v: 0, m: 0, c: 0 };
    const node = { real: { ctl: { v: 1, id: 'r1kz9fxq-9999', seq: 5, phase: 'champion', cur: 0, shown: 1, teams: camp === 'senior' ? 4 : 6, finale: true, at: now - 9000, sa: now - 9000, ca: now - 60000, startedAt: now - 600000, until: now + 3600e3 }, pub: { g0: { place: 1, e } } } };
    await p.evaluate(([r, v]) => window.__feed(r, v), [(camp === 'senior' ? 'seniorScoreboard' : 'campScoreboard') + '/revealPublic', node]);
    await p.waitForTimeout(1200);
    const m = await p.evaluate(() => {
      const els = [...document.querySelectorAll('#champ *')];
      return { bottom: Math.round(Math.max(...els.map((x) => x.getBoundingClientRect().bottom))), top: Math.round(Math.min(...els.map((x) => x.getBoundingClientRect().top))) };
    });
    out.push({ camp, w, h, k, top: m.top, bottom: m.bottom, fits: m.bottom <= h && m.top >= 0 });
    if (!(m.bottom <= h && m.top >= 0)) await p.screenshot({ path: path.join(os.tmpdir(), `champ-${camp}-${w}x${h}-${k}.png`) });
    await p.close();
  }
  console.log(out.map((x) => `${x.camp} ${x.w}x${x.h} champions=${x.k} top=${x.top} bottom=${x.bottom} ${x.fits ? 'fits' : 'CLIPPED'}`).join('\n'));
  await b.close();
})();
