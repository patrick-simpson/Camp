// Many fake phones on a mock HTTPS push service that VERIFIES the VAPID JWT and
// DECRYPTS every body with node:crypto — exercising the Worker in workerd end to end:
// chat (announcement / mention / channel / author excluded), batching + /drain,
// dead subscriptions (410), director audiences, and the cron schedule alerts.
import https from 'node:https'; import fs from 'node:fs'; import path from 'node:path';
import * as lib from './lib.mjs';
const T = path.join(path.dirname(new URL(import.meta.url).pathname), 'tls');
const idp = lib.makeIdp(); const jwksSrv = await lib.startJwks(idp.jwks, 8790);
const DB = 'http://127.0.0.1:9000', NS = '?ns=camp-89cea-default-rtdb', H = { Authorization: 'Bearer owner', 'content-type': 'application/json' };
const put = (p, v) => fetch(`${DB}/${p}.json${NS}`, { method: 'PUT', headers: H, body: JSON.stringify(v) }).then((r) => r.json());
const get = (p) => fetch(`${DB}/${p}.json${NS}`, { headers: H }).then((r) => r.json());
const del = (p) => fetch(`${DB}/${p}.json${NS}`, { method: 'DELETE', headers: H });
const W = 'http://localhost:8787';
const PORT = 8443, ORIGIN = `https://127.0.0.1:${PORT}`;
const got = []; const behaviour = {}; const uas = {};
const srv = https.createServer({ key: fs.readFileSync(T + '/srv.key'), cert: fs.readFileSync(T + '/srv.crt') }, (req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const name = req.url.split('/').pop(); const rec = { name, ttl: req.headers.ttl, urgency: req.headers.urgency };
    try { rec.vapid = lib.verifyVapid(req.headers.authorization, ORIGIN).claims; rec.payload = JSON.parse(lib.decrypt(uas[name], Buffer.concat(chunks)).text); } catch (e) { rec.error = String(e.message || e); }
    got.push(rec); const b = behaviour[name] || 'ok'; res.writeHead(b === 'gone' ? 410 : b === 'busy' ? 503 : 201); res.end();
  });
}).listen(PORT, '127.0.0.1');
const root = 'campScoreboard';
for (const p of ['members', 'push', 'chat', 'pushSchedule', 'pushAlerts']) await del(`${root}/${p}`);
await del('pushServer/sent'); await del('pushServer/outbox'); await del('pushServer/rate'); await del('pushServer/cron');
const members = { 'dir@camp,org': { role: 'editor', name: 'Dana Director', addedBy: 'x', addedAt: 'x' } };
const pushTree = {};
const prefs = (o) => ({ ch: { announcements: true, general: false, memes: false, photos: false }, mention: true, director: true, blocksAll: false, lead: 10, ...o });
function phone(key, dev, p, team) { const ua = lib.makeUa(); uas[dev] = ua; (pushTree[key] = pushTree[key] || {})[dev] = { endpoint: `${ORIGIN}/p/${dev}`, p256dh: ua.p256dh, auth: ua.authB64, at: Date.now(), label: 'Phone', prefs: p, ...(team ? { team } : {}) }; }
for (let i = 0; i < 26; i++) { const key = `c${i}@camp,org`; members[key] = { role: 'viewer', name: `Counselor ${i}`, teamId: 't' + (i % 6), addedBy: 'x', addedAt: 'x' }; phone(key, `dev${String(i).padStart(5, '0')}x`, prefs(i === 3 ? { ch: { announcements: false } } : {})); }
phone('dir@camp,org', 'devDirector1', prefs({}));
phone('c5@camp,org', 'devC5second', prefs({ ch: { announcements: true, general: true }, blocksAll: true }));  // second device of c5
phone('c7@camp,org', 'devC7blocks', prefs({ blocks: { supper: true }, lead: 15 }));
phone('ghost@camp,org', 'devGhost001', prefs({}));  // NOT a member any more
behaviour['dev00009x'] = 'gone';
await put(`${root}/members`, members); await put(`${root}/push`, pushTree);
const tok = (email) => idp.mint({ sub: 'u-' + email, email, email_verified: true });
const call = (body, who = 'dir@camp.org') => fetch(W + '/notify', { method: 'POST', headers: { Authorization: 'Bearer ' + tok(who), 'content-type': 'application/json', Origin: 'http://localhost:8080' }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
const drain = (batch) => fetch(W + '/drain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batch }) }).then((r) => r.json());
const settle = () => new Promise((r) => setTimeout(r, 400));
const summary = (label) => { const errs = got.filter((g) => g.error); console.log(label, 'deliveries', got.length, 'errors', errs.length, errs.slice(0, 2).map((e) => e.name + ':' + e.error).join(' | ')); };

// 1. announcement from the director → every member device except author's, except c3 (opted out), except ghost
let msgId = '-Ann' + Date.now();
await put(`${root}/chat/announcements/${msgId}`, { at: Date.now(), byKey: 'dir@camp,org', name: 'Dana', text: 'Supper moved to 5:30 — bring water! ☀️ ñ' });
let [st, r] = await call({ camp: 'junior', kind: 'chat', ch: 'announcements', msgId });
console.log('announce', st, JSON.stringify(r));
for (const b of r.batches || []) console.log('drain', JSON.stringify(await drain(b)));
await settle(); summary('after announcement:');
const names = new Set(got.map((g) => g.name));
console.log('  director own device got it?', names.has('devDirector1'), '| c3 opted-out got it?', names.has('dev00003x'), '| ghost got it?', names.has('devGhost001'), '| c5 both devices?', names.has('dev00005x') && names.has('devC5second'));
console.log('  sample payload', JSON.stringify(got.find((g) => g.payload)?.payload), 'ttl', got[0]?.ttl, 'urgency', got[0]?.urgency, 'vapid sub', got[0]?.vapid?.sub);
console.log('  dead sub removed?', (await get(`${root}/push/c9@camp,org`)) === null);
// 2. general channel message from c1 mentioning "Counselor 4" and team t2's short name? use member name
got.length = 0; msgId = '-Gen' + Date.now();
await put(`${root}/chat/general/${msgId}`, { at: Date.now(), byKey: 'c1@camp,org', name: 'C1', text: 'Has anyone seen Counselor 4?' });
[st, r] = await call({ camp: 'junior', kind: 'chat', ch: 'general', msgId, mentionKeys: ['c4@camp,org', 'nobody@x,com'], mentionTeams: [] }, 'c1@camp.org');
await settle(); console.log('general', st, JSON.stringify(r), '→', got.map((g) => g.name + ':' + g.payload?.kind).join(', '));
// 3. non-author trying to notify someone else's message
[st, r] = await call({ camp: 'junior', kind: 'chat', ch: 'general', msgId: msgId }, 'c2@camp.org'); console.log('non-author', st, r.error);
// 4. viewer trying a director alert
[st, r] = await call({ camp: 'junior', kind: 'alert', text: 'hi', audience: 'all', urgent: false }, 'c2@camp.org'); console.log('viewer alert', st, r.error);
// 5. team alert to t2
got.length = 0; await new Promise((r) => setTimeout(r, 10500));
[st, r] = await call({ camp: 'junior', kind: 'alert', text: 'Team t2 to the lake', audience: 't2', urgent: false });
await settle(); console.log('team alert', st, JSON.stringify(r), '→', got.map((g) => g.name).sort().join(','));
// 6. test alert to own device
got.length = 0; await new Promise((r) => setTimeout(r, 10500));
[st, r] = await call({ camp: 'junior', kind: 'test' }); await settle(); console.log('test', st, JSON.stringify(r), '→', got.map((g) => g.payload?.body).join(' | '));
// 7. cron schedule alert: a block starting 10 min from now (ET), week containing today
const now = new Date(); const et = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
const g = (t) => et.find((p) => p.type === t).value; const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(g('weekday'));
const today = `${g('year')}-${g('month')}-${g('day')}`; const sun = new Date(Date.UTC(+g('year'), +g('month') - 1, +g('day') - dow)).toISOString().slice(0, 10);
const startMin = +g('hour') * 60 + +g("minute") + 11; const startMin15 = startMin + 5;
await put(`${root}/pushSchedule`, { weekStart: sun, at: Date.now(), by: 'dir@camp,org', blocks: { [`d${dow}-${startMin}-0`]: { dow, start: startMin, label: 'Campfire — Ella', emoji: '🔥', key: 'campfire' }, [`d${dow}-${startMin15}-1`]: { dow, start: startMin15, label: 'Supper', emoji: '🍽️', key: 'supper' } } });
got.length = 0;
const cr = await fetch(W + '/__scheduled?cron=*+*+*+*+*'); console.log('cron trigger', cr.status, (await cr.text()).slice(0, 80));
await new Promise((r) => setTimeout(r, 1500));
console.log('cron deliveries →', got.map((g) => g.name + ':' + g.payload?.title + ' / ' + g.payload?.body).join(' | '));
console.log('cron state', JSON.stringify(await get('pushServer/cron')));
got.length = 0; await fetch(W + '/__scheduled?cron=*+*+*+*+*'); await new Promise((r) => setTimeout(r, 1000));
console.log('second cron run (must not repeat):', got.length);
summary('overall:');
srv.close(); jwksSrv.close(); process.exit(0);
