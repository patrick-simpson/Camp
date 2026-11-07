// Live phone-alert simulation (BUILD-PLAN Step 27; the owner approved it Tue Nov 3, 2026).
// Three pretend phones, each a real Mozilla push address held by device.mjs, enrolled through the REAL
// camp app in Chromium (only PushManager.subscribe/getSubscription are stubbed to hand the app that
// address), signed in as the owner and two temporary test logins on the owner's Gmail.
// Prints no email, token or member data beyond the two test logins' own names.
//
//   node sim.mjs send <who...>          email a sign-in link (who = owner | alpha | bravo)
//   LINK=... node sim.mjs signin <who>  finish the sign-in in that pretend phone's own browser profile
//   node sim.mjs members-add            the owner adds the two test logins to junior camp as counselors
//   node sim.mjs run                    enrol all three phones and run every alert test
//   node sim.mjs cleanup                remove test messages, pretend phones, test members (and test sign-ins)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { Device } from './device.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SITE = 'https://camp.patricksimpson.info/';
const ORIGIN = 'https://camp.patricksimpson.info';
const SENDER = 'https://camp-alerts.patricksimpson-fx.workers.dev';
const WHO = {
  owner: { email: 'patricksimpson.fx@gmail.com', name: null, team: null },
  alpha: { email: 'patricksimpson.fx+campa@gmail.com', name: 'Alpha Tester', team: 't0' },
  bravo: { email: 'patricksimpson.fx+campb@gmail.com', name: 'Bravo Tester', team: 't1' },
};
const TAG = 'Test, please ignore';
const [phase, ...args] = process.argv.slice(2);
const log = (...a) => console.log(...a);
const keyOf = (email) => email.trim().toLowerCase().replaceAll('.', ',');

function apiKey() {
  const src = fs.readFileSync(new URL('../../firebase-config.js', import.meta.url).pathname, 'utf8');
  return (src.match(/apiKey:\s*"([^"]+)"/) || [])[1];
}

export async function open(who, opts = {}) {
  const ctx = await chromium.launchPersistentContext(path.join(DIR, 'profiles', who), { viewport: { width: 390, height: 844 } });
  await ctx.grantPermissions(['notifications'], { origin: ORIGIN });
  if (opts.sub) {
    await ctx.addInitScript((sub) => {
      const b64ToBuf = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
      // Headless Chromium reports Notification.permission as 'denied' even after the permission is granted
      // (requestPermission() and permissions.query() both say granted). A real phone's value is what the person
      // tapped; the pretend phone 'tapped Allow'.
      try { Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true }); } catch (e) { /* fine */ }
      let current = null;
      const make = (o) => ({
        endpoint: sub.endpoint, expirationTime: null,
        options: { userVisibleOnly: true, applicationServerKey: o && o.applicationServerKey ? new Uint8Array(o.applicationServerKey).buffer : null },
        getKey: (n) => (n === 'p256dh' ? b64ToBuf(sub.keys.p256dh) : n === 'auth' ? b64ToBuf(sub.keys.auth) : null),
        toJSON: () => ({ endpoint: sub.endpoint, expirationTime: null, keys: sub.keys }),
        unsubscribe: async () => { current = null; return true; },
      });
      if (typeof PushManager !== 'undefined') {
        PushManager.prototype.subscribe = async function (o) { current = make(o); return current; };
        PushManager.prototype.getSubscription = async function () { return current; };
      }
    }, opts.sub);
  }
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('pageerror', (e) => log(`  [${who} page error]`, String(e && e.message || e).slice(0, 160)));
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  return { ctx, page };
}

export async function ready(page, who, { push = false, owner = false } = {}, ms = 90000) {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({
      camp: typeof CAMP !== 'undefined' ? CAMP.id : '?',
      signedIn: typeof authUser !== 'undefined' && !!authUser,
      confirmed: typeof memberRoleConfirmed !== 'undefined' && memberRoleConfirmed,
      role: typeof memberRole !== 'undefined' ? memberRole : null,
      remote: typeof remoteReady !== 'undefined' && remoteReady,
      pushReady: typeof pushSyncReady !== 'undefined' && pushSyncReady,
      owner: typeof isOwner === 'function' && isOwner(),
      v: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?',
    })).catch(() => null);
    if (s && s.signedIn && s.confirmed && s.remote && (!push || s.pushReady) && (!owner || s.owner)) return s;
    if (Date.now() - t0 > ms) { log(`  ${who} not ready:`, JSON.stringify(s)); throw new Error(who + ' not ready'); }
    await page.waitForTimeout(500);
  }
}

async function sendLinks(list) {
  const key = apiKey();
  for (const who of list) {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Referer: SITE },
      body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email: WHO[who].email, continueUrl: SITE, canHandleCodeInApp: true }),
    });
    log(`  link for ${who}: HTTP ${r.status}`);
  }
}

async function signin(who) {
  const link = process.env.LINK;
  if (!link) throw new Error('LINK not set');
  const { ctx, page } = await open(who);
  await page.evaluate((email) => {
    localStorage.setItem('campScoreboardEmailForSignIn', email);
    localStorage.setItem('campScoreboardActiveCamp', 'junior');
    localStorage.setItem('campScoreboardCampAsked', '1');
  }, WHO[who].email);
  const u = new URL(link);
  const target = u.hostname === 'camp.patricksimpson.info' ? link
    : SITE + '?' + ['apiKey', 'oobCode', 'mode', 'lang'].map((k) => (u.searchParams.get(k) ? `${k}=${encodeURIComponent(u.searchParams.get(k))}` : '')).filter(Boolean).join('&');
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < 60000) {
    s = await page.evaluate(() => ({ signedIn: typeof authUser !== 'undefined' && !!authUser, confirmed: typeof memberRoleConfirmed !== 'undefined' && memberRoleConfirmed })).catch(() => null);
    if (s && s.signedIn) break;
    await page.waitForTimeout(500);
  }
  log(`  ${who} signed in: ${!!(s && s.signedIn)} (member confirmed: ${!!(s && s.confirmed)})`);
  await ctx.close();
}

async function membersAdd() {
  const { ctx, page } = await open('owner');
  try {
    await ready(page, 'owner', { owner: true });
    const out = await page.evaluate(async (list) => {
      const res = [];
      for (const p of list) {
        const ref = firebase.database().ref(dbPath('members/' + p.key));
        await ref.set(memberRecord('viewer', p.name, p.team));
        res.push(p.name + ': ' + ((await ref.once('value')).exists() ? 'added' : 'MISSING'));
      }
      return res;
    }, ['alpha', 'bravo'].map((w) => ({ key: keyOf(WHO[w].email), name: WHO[w].name, team: WHO[w].team })));
    log('  ' + out.join(' · '));
  } finally { await ctx.close(); }
}

// ── the run ──────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (devices) => Object.fromEntries(devices.map((d) => [d.name, d.got.length]));
async function collect(devices, ms, start) {
  start = start || mark(devices);
  await sleep(ms);
  const got = {}; for (const d of devices) got[d.name] = d.got.slice(start[d.name]);
  return got;
}

async function run() {
  const vapid = (await (await fetch(SENDER + '/vapid-key')).json()).publicKey;
  const dev = { owner: new Device('owner'), alpha: new Device('alpha'), bravo: new Device('bravo') };
  for (const d of Object.values(dev)) await d.connect(vapid);
  log('  three pretend phones hold real Mozilla push addresses');
  const ph = {};
  for (const w of ['owner', 'alpha', 'bravo']) ph[w] = await open(w, { sub: dev[w].subscription() });
  const results = [];
  const record = (name, expect, got, check) => {
    const who = Object.keys(got).filter((k) => got[k].length);
    const ok = JSON.stringify(who.sort()) === JSON.stringify([...expect].sort()) && (!check || check(got));
    const detail = Object.fromEntries(Object.entries(got).filter(([, v]) => v.length).map(([k, v]) => [k, v.map((r) => ({ kind: r.json && r.json.kind, title: r.json && r.json.title, body: r.json && String(r.json.body || '').slice(0, 80), secs: null }))]));
    results.push({ name, expect, got: who, ok, detail });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: expected ${expect.join(', ') || 'nobody'}, got ${who.join(', ') || 'nobody'}`);
    for (const [k, v] of Object.entries(detail)) log(`        ${k}: ${v.map((x) => `[${x.kind}] ${x.title} — ${x.body}`).join(' | ')}`);
  };
  try {
    for (const w of ['owner', 'alpha', 'bravo']) {
      const s = await ready(ph[w].page, w, { push: true, owner: w === 'owner' });
      log(`  ${w}: v${s.v}, ${s.role}${s.owner ? ' (owner)' : ''}, camp ${s.camp}`);
    }
    // Enrol each phone through the real app (pushEnable), with the prefs each test needs.
    const enrol = async (w, setup) => ph[w].page.evaluate(async (setup) => {
      if (setup.directorOff) pushStorePrefs({ director: false });
      if (setup.bellMemes && typeof chatSubscribed === 'function' && !chatSubscribed('memes')) toggleChatSub('memes');
      await pushEnable();
      const key = identityKey(authUser); const did = pushDeviceId(false);
      const snap = await firebase.database().ref(pushRecordPath(CAMP.id, key, did)).once('value');
      const v = snap.val() || {};
      return { status: pushStatus(), saved: snap.exists(), host: v.endpoint ? new URL(v.endpoint).host : '', team: v.team || '', prefs: v.prefs || null };
    }, setup);
    const e = { owner: await enrol('owner', {}), alpha: await enrol('alpha', { directorOff: true }), bravo: await enrol('bravo', { bellMemes: true }) };
    for (const [w, r] of Object.entries(e)) log(`  enrolled ${w}: status ${r.status}, record saved ${r.saved}, push host ${r.host}, team ${r.team || '—'}, director alerts ${r.prefs && r.prefs.director}, memes ${r.prefs && r.prefs.ch && r.prefs.ch.memes}`);
    const D = Object.values(dev);
    const T = 30000;

    // 0. "Send a test" from each phone reaches only that phone.
    for (const w of ['owner', 'alpha', 'bravo']) {
      const t = Date.now(); const m0 = mark(D);
      await ph[w].page.evaluate(() => pushSendTest());
      const got = await collect(D, 12000, m0);
      record(`test from ${w}'s phone`, [w], got, (g) => g[w][0] && g[w][0].json && g[w][0].json.kind === 'test');
      if (got[w][0]) results[results.length - 1].secs = Math.round((got[w][0].at - t) / 100) / 10;
    }

    const chatSend = async (w, ch, text) => ph[w].page.evaluate(async ({ ch, text }) => {
      showTab('chat'); openChat(ch);
      await new Promise((r) => setTimeout(r, 400));
      const box = document.getElementById('chat-input'); box.value = text;
      sendChatMessage(ch);
    }, { ch, text });

    // 1. A counselor posts in Announcements: everyone else hears it.
    let t = Date.now(); let mc = mark(D);
    await chatSend('alpha', 'announcements', `${TAG} (announcements check)`);
    let got = await collect(D, T, mc);
    record('Announcements message from a counselor', ['owner', 'bravo'], got);

    // 2. The owner names Bravo's team in General: only Bravo's phone (a team mention).
    const teamWord = await ph.owner.page.evaluate(() => teamShort('t1'));
    await sleep(1500); mc = mark(D);
    await chatSend('owner', 'general', `${TAG}: ${teamWord} team check`);
    got = await collect(D, T, mc);
    record(`General message naming ${teamWord}`, ['bravo'], got);

    // 3. The owner posts in Memes, which only Bravo follows.
    await sleep(1500); mc = mark(D);
    await chatSend('owner', 'memes', `${TAG} (followed-channel check)`);
    got = await collect(D, T, mc);
    record('Memes message (only Bravo follows Memes)', ['bravo'], got);

    // 4–6. Tell everyone's Buzz (the same direct pushSendAlert Tell everyone calls).
    const buzz = (o) => ph.owner.page.evaluate((o) => pushSendAlert(o), o);
    let m0 = mark(D);
    let r = await buzz({ text: `${TAG} (buzz everyone check)`, audience: 'all', urgent: false });
    got = await collect(D, T, m0);
    record('Buzz to everyone, not urgent (Alpha turned director alerts off)', ['owner', 'bravo'], got);
    log('        sender said:', JSON.stringify(r));
    await sleep(11000);
    m0 = mark(D);
    r = await buzz({ text: `${TAG} (urgent team check)`, audience: 't0', urgent: true });
    got = await collect(D, T, m0);
    record("Urgent buzz to Alpha's team (urgent ignores the opt-out)", ['alpha'], got, (g) => g.alpha[0] && g.alpha[0].json && g.alpha[0].json.kind === 'urgent');
    log('        sender said:', JSON.stringify(r));
    await sleep(11000);
    m0 = mark(D);
    r = await buzz({ text: `${TAG} (directors check)`, audience: 'editors', urgent: false });
    got = await collect(D, T, m0);
    record('Buzz to directors only', ['owner'], got);
    log('        sender said:', JSON.stringify(r));

    // 7. A practice reveal buzzes nobody (Start, then End at once: a practice's End deletes its nodes).
    const mp = mark(D);
    const pr = await ph.owner.page.evaluate(async () => {
      revealSetRemoteOpen(true);
      await new Promise((res) => setTimeout(res, 11000)); // the Start gate waits 10 s after a connection change
      const s = await revealStart({ quiet: true, practice: true }); // practice: true, or it is a REAL reveal (found the hard way)
      await new Promise((res) => setTimeout(res, 1500));
      const e = await revealEnd({ quiet: true });
      revealSetRemoteOpen(false);
      return { start: s && { ok: s.ok, code: s.code }, end: e && { ok: e.ok, code: e.code } };
    });
    got = await collect(D, 20000, mp);
    record('Practice reveal Start and End', [], got);
    log('        reveal said:', JSON.stringify(pr));

    const status = await (await fetch(SENDER + '/health')).json().catch(() => null);
    log('  sender health:', JSON.stringify(status).slice(0, 300));
    for (const d of D) if (d.errors.length) log(`  ${d.name} errors:`, d.errors.join(' | '));
  } finally {
    fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(results, null, 1));
    const passed = results.filter((x) => x.ok).length;
    log(`\n  ${passed} of ${results.length} checks passed`);
    for (const w of Object.keys(ph)) await ph[w].ctx.close().catch(() => {});
    for (const d of Object.values(dev)) await d.close().catch(() => {});
  }
}

async function cleanup() {
  const out = [];
  // Each test login turns its alerts off (deletes its own device record) and then deletes its own sign-in.
  for (const w of ['alpha', 'bravo']) {
    const { ctx, page } = await open(w);
    try {
      await page.waitForTimeout(6000);
      const r = await page.evaluate(async () => {
        const res = {};
        try { if (typeof pushRemoveRecord === 'function') { await pushRemoveRecord(CAMP.id); res.device = 'removed'; } } catch (e) { res.device = 'failed ' + (e && e.code); }
        try { if (authUser) { await firebase.auth().currentUser.delete(); res.signin = 'deleted'; } else res.signin = 'not signed in'; } catch (e) { res.signin = 'failed ' + (e && e.code); }
        return res;
      });
      out.push(`${w}: device ${r.device}, sign-in ${r.signin}`);
    } catch (e) { out.push(`${w}: ${e.message}`); } finally { await ctx.close(); }
  }
  const { ctx, page } = await open('owner');
  try {
    await ready(page, 'owner', { owner: true });
    const r = await page.evaluate(async ({ keys, tag }) => {
      const res = { messages: 0, members: [], device: '' };
      for (const ch of ['announcements', 'general', 'memes']) {
        const snap = await firebase.database().ref(dbPath('chat/' + ch)).limitToLast(30).once('value');
        const del = [];
        snap.forEach((c) => { const v = c.val() || {}; if (String(v.text || '').startsWith(tag)) del.push(c.key); });
        for (const id of del) { await firebase.database().ref(dbPath('chat/' + ch + '/' + id)).remove(); res.messages += 1; }
      }
      for (const k of keys) { await firebase.database().ref(dbPath('members/' + k)).remove(); res.members.push((await firebase.database().ref(dbPath('members/' + k)).once('value')).exists() ? 'STILL THERE' : 'removed'); }
      try { await pushRemoveRecord(CAMP.id); res.device = 'removed'; } catch (e) { res.device = 'failed'; }
      for (const k of keys) {
        const snap = await firebase.database().ref(dbPath('push/' + k)).once('value').catch(() => null);
        res['left ' + k.slice(0, 22)] = snap ? (snap.exists() ? 'device records remain' : 'none') : 'not readable';
      }
      return res;
    }, { keys: ['alpha', 'bravo'].map((w) => keyOf(WHO[w].email)), tag: TAG });
    out.push('owner: ' + JSON.stringify(r));
  } finally { await ctx.close(); }
  out.forEach((l) => log('  ' + l));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) (async () => {
  if (phase === 'send') return sendLinks(args);
  if (phase === 'signin') return signin(args[0]);
  if (phase === 'members-add') return membersAdd();
  if (phase === 'run') return run();
  if (phase === 'cleanup') return cleanup();
  if (phase === 'signin-delete') return;
  throw new Error('unknown phase ' + phase);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

// Sign a test login in with a fresh link and delete its sign-in at once (Firebase wants a recent sign-in for that).
export async function signinAndDelete(who) {
  if (who === 'owner') throw new Error('never the owner');
  const link = process.env.LINK; if (!link) throw new Error('LINK not set');
  const { ctx, page } = await open(who);
  await page.evaluate((email) => { localStorage.setItem('campScoreboardEmailForSignIn', email); }, WHO[who].email);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  let res = 'not signed in';
  for (let i = 0; i < 80; i++) {
    const s = await page.evaluate(async (email) => {
      const u = typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser;
      if (!u) return null;
      if (String(u.email || '').toLowerCase() !== email) return 'wrong account';
      try { await u.delete(); return 'deleted'; } catch (e) { return 'failed ' + (e && e.code); }
    }, WHO[who].email).catch(() => null);
    if (s) { res = s; break; }
    await page.waitForTimeout(500);
  }
  log(`  ${who}: sign-in ${res}`);
  await ctx.close();
}
if (isMain && phase === 'signin-delete') signinAndDelete(args[0]).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
