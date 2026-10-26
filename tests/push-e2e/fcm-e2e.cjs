// Real-browser subscription (headful Chromium, real FCM endpoint) → seeded into the
// emulator → /notify via the Worker running in workerd → Google's push service.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
(async () => {
  const lib = await import(path.join(__dirname, 'lib.mjs'));
  const idp = lib.makeIdp(); const jwksSrv = await lib.startJwks(idp.jwks, 8790);
  const DB = 'http://127.0.0.1:9000', NS = '?ns=camp-89cea-default-rtdb', H = { Authorization: 'Bearer owner', 'content-type': 'application/json' };
  const put = (p, v) => fetch(`${DB}/${p}.json${NS}`, { method: 'PUT', headers: H, body: JSON.stringify(v) }).then((r) => r.json());
  const get = (p) => fetch(`${DB}/${p}.json${NS}`, { headers: H }).then((r) => r.json());
  const W = 'http://localhost:8787';
  const vapid = await (await fetch(W + '/vapid-key')).json();
  console.log('vapid-key ok', vapid.ok, vapid.publicKey.length);
  // browser
  const site = path.join(__dirname, 'site');
  const srv = http.createServer((req, res) => { const f = path.join(site, req.url === '/' ? 'index.html' : req.url.split('?')[0]); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, {'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html'}); res.end(fs.readFileSync(f)); }).listen(8766);
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'profile-fcm'), { headless: false });
  await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:8766' });
  const page = await ctx.newPage(); await page.goto('http://localhost:8766/');
  const sub = await page.evaluate(async (key) => {
    const reg = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready;
    const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe();
    function u(b){const p='='.repeat((4-b.length%4)%4);const s=atob((b+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));}
    return (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u(key) })).toJSON();
  }, vapid.publicKey);
  console.log('browser endpoint host', new URL(sub.endpoint).host);
  const root = 'campScoreboard';
  await put(`${root}/members`, {
    'dir@camp,org': { role: 'editor', name: 'Dana Director', addedBy: 'x', addedAt: 'x' },
    'cara@camp,org': { role: 'viewer', name: 'Cara Counselor', teamId: 't2', addedBy: 'x', addedAt: 'x' },
  });
  await put(`${root}/push/cara@camp,org/devCara0001`, { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, at: Date.now(), label: 'Chromium', prefs: { ch: { announcements: true, general: false, memes: false, photos: false }, mention: true, director: true, blocksAll: false, lead: 10 } });
  const msgId = '-Ntest' + Date.now();
  await put(`${root}/chat/announcements/${msgId}`, { at: Date.now(), byKey: 'dir@camp,org', name: 'Dana', text: 'Supper is moved to 5:30 — bring water bottles! ☀️' });
  const tok = idp.mint({ sub: 'u-dir', email: 'dir@camp.org', email_verified: true });
  const call = (body) => fetch(W + '/notify', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json', Origin: 'http://localhost:8080' }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
  console.log('chat notify →', JSON.stringify(await call({ camp: 'junior', kind: 'chat', ch: 'announcements', msgId })));
  console.log('duplicate   →', JSON.stringify(await call({ camp: 'junior', kind: 'chat', ch: 'announcements', msgId })));
  console.log('alert       →', JSON.stringify(await call({ camp: 'junior', kind: 'alert', text: 'Everyone to the Tabernacle in 5 minutes', audience: 'all', urgent: true })));
  console.log('pushAlerts  →', JSON.stringify(await get(`${root}/pushAlerts`)).slice(0, 300));
  console.log('lastError   →', JSON.stringify(await get('pushServer/lastError')));
  await ctx.close(); srv.close(); jwksSrv.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
