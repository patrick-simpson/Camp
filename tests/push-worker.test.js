// The phone-alert sender (push-worker/worker.js) runs on Cloudflare, not in the
// browser, so unlike every other test file this one doesn't exercise the vm
// copy of the app: it loads the Worker module in Node's MAIN realm (via the
// runner's importModule hook) and drives it through `_test`.
//
// The two things that would fail SILENTLY in production are checked against
// an independent implementation, never against the Worker's own code run
// backwards: the RFC 8291 encryption is decrypted with node:crypto (and pinned
// byte-for-byte to the RFC's own worked example), and the VAPID signature is
// verified with node:crypto in the raw r||s form push services expect.
//
// No network: every fetch goes to an in-memory fake that speaks enough of the
// Realtime Database REST dialect (ETags, if-match, shallow, multi-path PATCH,
// server timestamps and increments), Google's token and key endpoints, and
// push services whose answer each test chooses.
//
// Realm rule: typed arrays, Responses and crypto all come from the main realm
// (MAIN / Buffer / node:crypto); this file only passes plain values across.

const MAIN = nodeRequire('vm').runInThisContext('globalThis');
const { Response, Request, URL, URLSearchParams } = MAIN;
const { Buffer } = nodeRequire('buffer');
const nodeCrypto = nodeRequire('crypto');

const workerModule = importModule('../push-worker/worker.js');
let T = null;
async function load() {
  if (!T) T = (await workerModule).default._test;
  return T;
}

const DB_HOST = 'camp-89cea-default-rtdb.firebaseio.com';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const WORKER = 'https://camp-alerts.example.workers.dev';
const SITE = 'https://camp.patricksimpson.info';
const NOW = Date.UTC(2027, 6, 20, 15, 0, 0); // Tue Jul 20 2027, 11:00 AM Eastern

const ALICE = 'alice@camp,org';   // editor, team t1
const BOB = 'bob,smith@camp,org'; // viewer, team t2
const CARL = '+15551234567';      // viewer (phone account), team t3

// ── Keys, made once ─────────────────────────────────────────────────────

const SA_KEYS = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA_JSON = {
  type: 'service_account', project_id: 'camp-89cea', private_key_id: 'sa-key-1',
  private_key: SA_KEYS.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'firebase-adminsdk-x@camp-89cea.iam.gserviceaccount.com',
  token_uri: TOKEN_URI,
};
const ID_KEYS = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const OTHER_KEYS = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ID_JWK = Object.assign(ID_KEYS.publicKey.export({ format: 'jwk' }), { kid: 'kid-1', alg: 'RS256', use: 'sig' });

const b64u = (x) => Buffer.from(x).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

function idToken(claims, opts) {
  const o = opts || {};
  const now = Math.floor((o.now || NOW) / 1000);
  const header = o.header || { alg: 'RS256', kid: 'kid-1', typ: 'JWT' };
  const body = Object.assign({
    iss: 'https://securetoken.google.com/camp-89cea', aud: 'camp-89cea', auth_time: now - 100,
    user_id: 'u1', sub: 'u1', iat: now - 10, exp: now + 3600,
  }, claims);
  const input = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(body));
  const sig = header.alg === 'RS256' ? b64u(nodeCrypto.sign('sha256', Buffer.from(input), o.key || ID_KEYS.privateKey)) : '';
  return input + '.' + sig;
}
const tokenFor = (email) => idToken({ email, email_verified: true });

// ── A fake Realtime Database (REST) ────────────────────────────────────

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const segs = (p) => String(p).split('/').filter(Boolean);

// RTDB never stores null or an empty object; the fake prunes the same way.
function prune(v) {
  if (Array.isArray(v)) return v.map(prune);
  if (!isObj(v)) return v;
  for (const k of Object.keys(v)) {
    const c = prune(v[k]);
    if (c == null || (isObj(c) && !Object.keys(c).length)) delete v[k]; else v[k] = c;
  }
  return Object.keys(v).length ? v : null;
}

function makeDb(initial, net) {
  const db = { root: clone(initial) || {}, log: [] };
  db.get = (path) => {
    let n = db.root;
    for (const k of segs(path)) {
      if (!isObj(n) && !Array.isArray(n)) return null;
      if (!Object.prototype.hasOwnProperty.call(n, k)) return null;
      n = n[k];
    }
    return n === undefined ? null : clone(n);
  };
  db.set = (path, v) => {
    const s = segs(path);
    if (!s.length) { db.root = prune(clone(v)) || {}; return; }
    if (!isObj(db.root)) db.root = {};
    let n = db.root;
    for (let i = 0; i < s.length - 1; i++) {
      if (!isObj(n[s[i]])) n[s[i]] = {};
      n = n[s[i]];
    }
    if (v == null) delete n[s[s.length - 1]]; else n[s[s.length - 1]] = clone(v);
    db.root = prune(db.root) || {};
  };
  const etagOf = (v) => 'e' + nodeCrypto.createHash('sha1').update(JSON.stringify(v == null ? null : v)).digest('base64');
  db.etagOf = (path) => etagOf(db.get(path));
  const resolveSv = (v, cur) => {
    if (isObj(v) && v['.sv'] === 'timestamp') return net.now;
    if (isObj(v) && isObj(v['.sv']) && typeof v['.sv'].increment === 'number') return (typeof cur === 'number' ? cur : 0) + v['.sv'].increment;
    if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = resolveSv(v[k], isObj(cur) ? cur[k] : undefined); return o; }
    return v;
  };
  const json = (status, body, headers) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: headers || {} });
  db.fetch = async (url, init, h) => {
    const u = new URL(url);
    const path = u.pathname.replace(/\.json$/, '').split('/').filter(Boolean).map(decodeURIComponent).join('/');
    const method = (init && init.method) || 'GET';
    db.log.push({ method, path, shallow: u.searchParams.get('shallow') === 'true' });
    if (db.down) return json(503, { error: 'unavailable' });
    if (h.authorization !== 'Bearer ' + net.dbToken) return json(401, { error: 'Permission denied' });
    const cur = db.get(path);
    if (method === 'GET') {
      let v = cur;
      if (u.searchParams.get('shallow') === 'true' && isObj(v)) {
        const o = {};
        for (const k of Object.keys(v)) o[k] = isObj(v[k]) || Array.isArray(v[k]) ? true : v[k];
        v = o;
      }
      return json(200, v, h['x-firebase-etag'] === 'true' ? { ETag: etagOf(cur) } : {});
    }
    // A rival's write landing between our read and our write: the hook runs
    // before the if-match check, exactly where a real race would.
    if (db.beforeWrite) await db.beforeWrite(method, path);
    const now = db.get(path);
    if (h['if-match'] !== undefined && h['if-match'] !== etagOf(now)) return json(412, now, { ETag: etagOf(now) });
    const silent = u.searchParams.get('print') === 'silent';
    if (method === 'PUT') db.set(path, resolveSv(JSON.parse(init.body), now));
    else if (method === 'PATCH') {
      const body = JSON.parse(init.body);
      for (const k of Object.keys(body)) { const p = path + '/' + k; db.set(p, resolveSv(body[k], db.get(p))); }
    } else if (method === 'DELETE') db.set(path, null);
    else return json(405, { error: 'method' });
    return silent ? new Response(null, { status: 204 }) : json(200, db.get(path));
  };
  return db;
}

// ── The fake internet ───────────────────────────────────────────────────

function lowerHeaders(h) {
  const o = {};
  if (h) for (const k of Object.keys(h)) o[k.toLowerCase()] = h[k];
  return o;
}

function makeNet(data) {
  const net = {
    now: NOW, dbToken: 'tok-1', calls: 0, jwksFetches: 0, tokenMints: 0, assertions: [],
    jwksKeys: [ID_JWK], pushes: [], pushStatus: {}, subs: {},
  };
  net.db = makeDb(data || {}, net);
  net.fetch = async (url, init) => {
    net.calls++;
    const u = new URL(url);
    const h = lowerHeaders(init && init.headers);
    if (u.host === DB_HOST) return net.db.fetch(url, init, h);
    if (url === TOKEN_URI) {
      const params = new URLSearchParams(init.body);
      const [hh, pp, ss] = params.get('assertion').split('.');
      const ok = nodeCrypto.verify('sha256', Buffer.from(hh + '.' + pp), SA_KEYS.publicKey, fromB64u(ss));
      net.assertions.push({ ok, grant: params.get('grant_type'), header: JSON.parse(fromB64u(hh)), claims: JSON.parse(fromB64u(pp)) });
      if (!ok || net.refuseKey) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 });
      net.tokenMints++;
      return new Response(JSON.stringify({ access_token: net.dbToken, expires_in: 3599, token_type: 'Bearer' }), { status: 200 });
    }
    if (url === JWKS_URL) {
      net.jwksFetches++;
      return new Response(JSON.stringify({ keys: net.jwksKeys }), { status: 200, headers: { 'Cache-Control': 'public, max-age=3600' } });
    }
    // Anything else is a push service.
    net.pushes.push({ url, host: u.host, headers: h, body: Buffer.from(init.body) });
    const st = net.pushStatus[url];
    const status = typeof st === 'function' ? await st(url) : (st || 201);
    return new Response(status === 201 ? null : '{"reason":"BadJwtToken"}', { status });
  };
  return net;
}

// A real subscription: a P-256 key pair and auth secret, exactly what a
// browser's PushManager hands out — so deliveries can actually be decrypted.
function device(net, opts) {
  const o = opts || {};
  const ecdh = nodeCrypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const endpoint = o.endpoint || `https://fcm.googleapis.com/fcm/send/${o.id || nodeCrypto.randomBytes(6).toString('hex')}`;
  net.subs[endpoint] = { ecdh, auth };
  const rec = { endpoint, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth), at: NOW, label: 'Phone', prefs: o.prefs || { mention: true } };
  if (o.team) rec.team = o.team;
  return rec;
}

// RFC 8291 decryption, written against node:crypto alone.
function decrypt(net, push) {
  const sub = net.subs[push.url];
  const body = push.body;
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const uaPub = sub.ecdh.getPublicKey();
  const shared = sub.ecdh.computeSecret(asPub);
  const ikm = Buffer.from(nodeCrypto.hkdfSync('sha256', shared, sub.auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const dc = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce);
  dc.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([dc.update(ct.subarray(0, ct.length - 16)), dc.final()]);
  return { rs, idlen, delimiter: pt[pt.length - 1], payload: JSON.parse(pt.subarray(0, pt.length - 1).toString('utf8')) };
}

function baseMembers() {
  return {
    [ALICE]: { role: 'editor', name: 'Alice', teamId: 't1', addedBy: 'x', addedAt: 1 },
    [BOB]: { role: 'viewer', name: 'Bob', teamId: 't2', addedBy: 'x', addedAt: 1 },
    [CARL]: { role: 'viewer', name: 'Carl', teamId: 't3', addedBy: 'x', addedAt: 1 },
  };
}

// A whole camp: members, their phones, the network, and a call helper that
// counts the subrequests of every single invocation.
function world(opts) {
  const o = opts || {};
  const net = makeNet();
  const data = { campScoreboard: { members: o.members || baseMembers(), push: {} }, seniorScoreboard: { members: { [ALICE]: { role: 'editor', name: 'Alice S', addedBy: 'x', addedAt: 1 } } } };
  net.db.root = data;
  const env = Object.assign({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA_JSON) }, o.env || {});
  const cache = T.newCache();
  const w = { net, env, cache, perCall: [] };
  w.deps = () => {
    const counter = { n: 0 };
    w.perCall.push(counter);
    return { fetch: (u, i) => { counter.n++; return net.fetch(u, i); }, now: () => net.now, cache };
  };
  w.addDevice = (camp, key, id, devOpts) => {
    const rec = device(net, Object.assign({ id }, devOpts || {}));
    net.db.set(`${camp}/push/${key}/${id}`, rec);
    return rec;
  };
  w.request = async (method, path, body, headers) => {
    const init = { method, headers: Object.assign({}, headers || {}) };
    if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    const res = await T.handleRequest(new Request(WORKER + path, init), env, w.deps());
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, headers: res.headers, text, json };
  };
  w.notify = (asEmail, body) => w.request('POST', '/notify', body, { Authorization: 'Bearer ' + tokenFor(asEmail), Origin: SITE });
  w.cron = async () => T.runCron(env, w.deps());
  w.maxCalls = () => Math.max(0, ...w.perCall.map((c) => c.n));
  return w;
}

const unescape = (html) => html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function rejects(promise, check) {
  try { await promise; } catch (e) { if (check) check(e); return; }
  throw new Error('expected a rejection');
}

// ── Encoding & identity ─────────────────────────────────────────────────

test('the module is a Workers handler; test internals stay invisible to the runtime', async () => {
  await load();
  const handler = (await workerModule).default;
  assert.deepEqual(Object.keys(handler), ['fetch', 'scheduled']);
  assert.equal(typeof handler.fetch, 'function');
  assert.equal(typeof handler.scheduled, 'function');
  assert.equal(Object.getOwnPropertyDescriptor(handler, '_test').enumerable, false);
});

test('base64url round-trips every byte value and length, and refuses the other alphabet', async () => {
  const W = await load();
  for (let n = 0; n < 70; n++) {
    const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
    const enc = W.b64urlEncode(new MAIN.Uint8Array(bytes));
    assert.equal(enc, bytes.toString('base64url'), `length ${n} matches node`);
    assert.equal(Buffer.from(W.b64urlDecode(enc)).toString('hex'), bytes.toString('hex'));
  }
  assert.equal(Buffer.from(W.b64urlDecode('_-8=')).toString('hex'), 'ffef', 'padding tolerated');
  assert.throws(() => W.b64urlDecode('ab+/'), 'standard-alphabet characters are not base64url');
  assert.throws(() => W.b64urlDecode('a'), 'impossible length');
});

test('time-prefixed ids sort by time and decode back', async () => {
  const W = await load();
  const a = W.timeKey(NOW), b = W.timeKey(NOW + 1), c = W.timeKey(NOW + 60000);
  assert.ok(a < b && b < c, 'lexicographic order is time order');
  assert.equal(W.timeFromKey(a + 'xyz'), NOW);
  assert.ok(Number.isNaN(W.timeFromKey('!!!!!!!!')));
});

test('identity keys follow the rules: verified email, else phone, else nobody', async () => {
  const W = await load();
  assert.equal(W.emailKey('  Pat.Q.Simpson@Gmail.com '), 'pat,q,simpson@gmail,com', 'every dot, lowercased, trimmed');
  assert.equal(W.identityKeyFromClaims({ email: 'Bob.Smith@camp.org', email_verified: true }), BOB);
  assert.equal(W.identityKeyFromClaims({ email: 'bob@camp.org', email_verified: false }), '', 'an unverified email is nobody');
  assert.equal(W.identityKeyFromClaims({ email: 'bob@camp.org', email_verified: 'true' }), '', 'only boolean true counts');
  assert.equal(W.identityKeyFromClaims({ email: 'bob@camp.org', email_verified: false, phone_number: CARL }), CARL, 'falls through to the phone');
  assert.equal(W.identityKeyFromClaims({ phone_number: CARL }), CARL, 'phone as-is');
  assert.equal(W.identityKeyFromClaims({ phone_number: '555-1234' }), '', 'not E.164');
  assert.equal(W.identityKeyFromClaims({}), '');
  assert.equal(W.identityFromKey(BOB), 'bob.smith@camp.org');
  assert.equal(W.identityFromKey(CARL), CARL);
});

test('device prefs heal every shape RTDB can prune, with the agreed defaults', async () => {
  const W = await load();
  const d = W.normalizePrefs(undefined);
  assert.deepEqual(d, { ch: { announcements: true, general: false, memes: false, photos: false }, mention: true, director: true, blocksAll: false, blocks: {}, lead: 10 });
  const p = W.normalizePrefs({ ch: { announcements: false, memes: true }, mention: false, director: false, blocksAll: true, blocks: { supper: true, 'Bad Key': true, lunch: false }, lead: 15 });
  assert.deepEqual(p, { ch: { announcements: false, general: false, memes: true, photos: false }, mention: false, director: false, blocksAll: true, blocks: { supper: true }, lead: 15 });
  assert.equal(W.normalizePrefs({ lead: 7 }).lead, 10, 'only 5/10/15');
  assert.equal(W.normalizePrefs({ lead: '5' }).lead, 10, 'a string is not a lead');
  assert.deepEqual(W.normalizePrefs({ ch: 'junk', blocks: ['x'] }).ch.announcements, true);
});

test('notification text is cut by code point, never through an emoji', async () => {
  const W = await load();
  const s = '😀'.repeat(100);
  const c = W.clip(s, 10);
  assert.equal(Array.from(c).length, 10);
  assert.ok(c.endsWith('…'));
  assert.ok(!/[\ud800-\udbff]$/.test(c.slice(0, -1)), 'no orphaned surrogate');
  assert.equal(W.clip('  a \n\n b  ', 50), 'a b');
  assert.equal(W.clip('line one\n\n\n\nline two', 50, true), 'line one\n\nline two');
});

// ── Encryption & VAPID, checked independently ───────────────────────────

test('encryption reproduces RFC 8291 Appendix A byte-for-byte', async () => {
  const W = await load();
  const asPub = fromB64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const privateKey = await nodeCrypto.webcrypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    x: b64u(asPub.subarray(1, 33)), y: b64u(asPub.subarray(33)),
  }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const body = await W.encryptPayload(
    fromB64u('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    { privateKey, publicRaw: new MAIN.Uint8Array(asPub) },
    fromB64u('DGv6ra1nlYgDCS1FRnbzlw'));
  assert.equal(b64u(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('a non-ASCII payload decrypts with an independent node:crypto implementation', async () => {
  const W = await load();
  const net = makeNet();
  const rec = device(net, { id: 'dev-x' });
  const ictx = W.makeInvocation({}, { fetch: net.fetch, now: () => NOW, cache: W.newCache() });
  const eph = await W.ephemeralKey(ictx);
  const text = JSON.stringify({ title: '🍽️ Café — Crème brûlée', body: 'Ünïcödé ✓ 日本語' });
  const body = await W.encryptPayload(W.utf8(text), rec.p256dh, rec.auth, eph);
  const out = decrypt(net, { url: rec.endpoint, body: Buffer.from(body) });
  assert.equal(out.rs, 4096);
  assert.equal(out.idlen, 65);
  assert.equal(out.delimiter, 2, 'last-record delimiter');
  assert.equal(JSON.stringify(out.payload), text);
  // Same invocation, same ephemeral key — but a fresh salt per message.
  const again = Buffer.from(await W.encryptPayload(W.utf8(text), rec.p256dh, rec.auth, eph));
  assert.ok(!again.subarray(0, 16).equals(Buffer.from(body).subarray(0, 16)), 'salt differs per message');
  await rejects(W.encryptPayload(W.utf8('x'), 'A'.repeat(87), rec.auth, eph));
});

test('VAPID JWT verifies with node:crypto (ieee-p1363) and carries the right claims; one per push origin', async () => {
  const W = await load();
  const w = world();
  w.addDevice('campScoreboard', BOB, 'bob-phone-1', { prefs: { ch: { general: true } } });
  w.addDevice('campScoreboard', CARL, 'carl-phone-1', { prefs: { ch: { general: true } } });
  w.addDevice('campScoreboard', BOB, 'bob-iphone-1', { endpoint: 'https://web.push.apple.com/QAbc123', prefs: { ch: { general: true } } });
  w.net.db.set('campScoreboard/chat/general/m1', { at: NOW - 1000, byKey: ALICE, name: 'Alice', text: 'Lunch!' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'general', msgId: 'm1' });
  assert.equal(r.status, 200);
  assert.equal(r.json.sent, 3);
  const key = (await w.request('GET', '/vapid-key')).json.publicKey;
  const raw = fromB64u(key);
  assert.equal(raw.length, 65);
  const pub = nodeCrypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)) }, format: 'jwk' });
  const byHost = {};
  for (const p of w.net.pushes) {
    const m = /^vapid t=([^,]+), k=(\S+)$/.exec(p.headers.authorization);
    assert.ok(m, 'vapid t=…, k=… header');
    assert.equal(m[2], key, 'k is the published public key');
    const [h, c, s] = m[1].split('.');
    assert.ok(nodeCrypto.verify('sha256', Buffer.from(h + '.' + c), { key: pub, dsaEncoding: 'ieee-p1363' }, fromB64u(s)), 'ES256 signature verifies');
    assert.equal(fromB64u(s).length, 64, 'raw r||s, not DER');
    assert.deepEqual(JSON.parse(fromB64u(h)), { typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(fromB64u(c));
    assert.equal(claims.aud, new URL(p.url).origin);
    assert.equal(claims.sub, SITE);
    assert.equal(claims.exp, Math.floor(NOW / 1000) + 12 * 3600);
    assert.equal(p.headers['content-encoding'], 'aes128gcm');
    assert.equal(p.headers['content-type'], 'application/octet-stream');
    (byHost[p.host] = byHost[p.host] || new Set()).add(m[1]);
  }
  assert.equal(byHost['fcm.googleapis.com'].size, 1, 'one JWT reused for the same origin');
  assert.equal(byHost['web.push.apple.com'].size, 1);
  assert.ok([...byHost['fcm.googleapis.com']][0] !== [...byHost['web.push.apple.com']][0], 'a different JWT per origin');
});

// ── Caller authentication ───────────────────────────────────────────────

test('Firebase ID tokens: the good one passes, every forgery and mistake is refused', async () => {
  const W = await load();
  const net = makeNet();
  const cache = W.newCache();
  const ictx = () => W.makeInvocation({}, { fetch: net.fetch, now: () => net.now, cache });
  const claims = await W.verifyIdToken(ictx(), tokenFor('alice@camp.org'));
  assert.equal(claims.email, 'alice@camp.org');
  assert.equal(net.jwksFetches, 1);
  await W.verifyIdToken(ictx(), tokenFor('alice@camp.org'));
  assert.equal(net.jwksFetches, 1, 'keys are cached');
  const now = Math.floor(NOW / 1000);
  const cases = [
    ['aud', idToken({ aud: 'other-project' })],
    ['iss', idToken({ iss: 'https://securetoken.google.com/other-project' })],
    ['exp', idToken({ exp: now - 1 })],
    ['iat', idToken({ iat: now + 3600 })],
    ['auth_time', idToken({ auth_time: now + 3600 })],
    ['sub', idToken({ sub: '' })],
    ['signature', idToken({}, { key: OTHER_KEYS.privateKey })],
    ['alg', idToken({}, { header: { alg: 'none', typ: 'JWT' } })],
    ['alg', idToken({}, { header: { alg: 'HS256', kid: 'kid-1' } })],
    ['shape', 'not.a.token.at.all'],
  ];
  for (const [why, tok] of cases) {
    await rejects(W.verifyIdToken(ictx(), tok), (e) => {
      assert.equal(e.status, 401, why);
      assert.equal(e.why, why);
    });
  }
  // Tampering with a signed payload breaks the signature.
  const good = tokenFor('alice@camp.org').split('.');
  const forged = b64u(JSON.stringify(Object.assign(JSON.parse(fromB64u(good[1])), { email: 'bob.smith@camp.org' })));
  await rejects(W.verifyIdToken(ictx(), [good[0], forged, good[2]].join('.')), (e) => assert.equal(e.why, 'signature'));
});

test('an unknown key id refetches the published keys once, then is refused', async () => {
  const W = await load();
  const net = makeNet();
  const cache = W.newCache();
  const ictx = () => W.makeInvocation({}, { fetch: net.fetch, now: () => net.now, cache });
  await W.verifyIdToken(ictx(), tokenFor('alice@camp.org'));
  assert.equal(net.jwksFetches, 1);
  const stranger = idToken({ email: 'alice@camp.org', email_verified: true }, { header: { alg: 'RS256', kid: 'kid-new' } });
  await rejects(W.verifyIdToken(ictx(), stranger), (e) => assert.equal(e.why, 'kid'));
  assert.equal(net.jwksFetches, 1, 'not within a minute of the last fetch (forged kids cannot hammer Google)');
  net.now += 61000;
  // Google rotated: the new key appears on the refetch.
  net.jwksKeys = [ID_JWK, Object.assign({}, ID_JWK, { kid: 'kid-new' })];
  await W.verifyIdToken(ictx(), stranger);
  assert.equal(net.jwksFetches, 2, 'refetched exactly once');
  const nobody = idToken({}, { header: { alg: 'RS256', kid: 'kid-gone' } });
  net.now += 61000;
  const one = ictx();
  await rejects(W.verifyIdToken(one, nobody));
  await rejects(W.verifyIdToken(one, nobody));
  assert.equal(net.jwksFetches, 3, 'at most one refetch per invocation');
});

test('/notify: no token, unverified email, and non-members are all refused', async () => {
  await load();
  const w = world();
  const body = { camp: 'junior', kind: 'test' };
  let r = await w.request('POST', '/notify', body, { Origin: SITE });
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'no-auth');
  r = await w.request('POST', '/notify', body, { Authorization: 'Bearer ' + idToken({ email: 'alice@camp.org', email_verified: false }) });
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'no-identity', 'unverified email without a phone is nobody');
  r = await w.notify('stranger@camp.org', body);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'not-member');
  assert.equal(r.json.ok, false);
  assert.ok(r.json.message.length > 10, 'plain-English message');
  r = await w.request('POST', '/notify', body, { Authorization: 'Bearer ' + idToken({ phone_number: CARL }) });
  assert.equal(r.status, 404, 'a phone member gets through to the test route (no devices yet)');
  assert.equal(r.json.error, 'no-device');
});

// ── Recipient truth tables ──────────────────────────────────────────────

function deviceRec(id, prefs, extra) {
  return Object.assign({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'B' + 'a'.repeat(86), auth: 'c'.repeat(22), at: NOW, prefs }, extra || {});
}
// Device ids must be 8+ characters (the rules' regex); these read as a1, b2…
const dev = (s) => s + '-device';
const ids = (list) => list.map((t) => t.d.replace(/-device$/, '')).sort();

test('chat recipients: announcements default on, mentions beat channels, author and ex-members excluded', async () => {
  const W = await load();
  const members = Object.assign(baseMembers(), { 'dee@camp,org': { role: 'viewer', name: 'Dee' } });
  const push = {
    [ALICE]: { [dev('a1')]: deviceRec('a1', {}) },
    [BOB]: { [dev('b1')]: deviceRec('b1', undefined), [dev('b2')]: deviceRec('b2', { ch: { announcements: false } }) },
    [CARL]: { [dev('c1')]: deviceRec('c1', { ch: { general: true } }), [dev('c2')]: deviceRec('c2', { mention: false, ch: { general: true } }) },
    'dee@camp,org': { [dev('d1')]: deviceRec('d1', { ch: { general: true } }, { team: 't5' }) },
    'gone@camp,org': { [dev('g1')]: deviceRec('g1', { ch: { announcements: true, general: true } }) },
    [BOB + 'x']: { short: deviceRec('zz', {}) },
  };

  let r = W.chatRecipients({ ch: 'announcements', authorKey: ALICE, members, push, mentionKeys: [], mentionTeams: [] });
  assert.deepEqual(ids(r.announcement), ['b1', 'c1', 'c2', 'd1'], 'default on; explicit off respected; author + removed member out');

  r = W.chatRecipients({ ch: 'announcements', authorKey: ALICE, members, push, mentionKeys: [BOB], mentionTeams: [] });
  assert.deepEqual(ids(r.mention), ['b2'], 'muted announcements still hear a mention');

  r = W.chatRecipients({ ch: 'general', authorKey: ALICE, members, push, mentionKeys: [BOB, 'gone@camp,org', ALICE], mentionTeams: [] });
  assert.deepEqual(ids(r.mention), ['b1', 'b2'], 'mention by key (non-members and the author ignored)');
  assert.deepEqual(ids(r.channel), ['c1', 'c2', 'd1'], 'channel subscribers');

  r = W.chatRecipients({ ch: 'general', authorKey: ALICE, members, push, mentionKeys: [], mentionTeams: ['t3', 't5'] });
  assert.deepEqual(ids(r.mention), ['c1', 'd1'], 'team mention via member.teamId (c1) and device team (d1)');
  assert.deepEqual(ids(r.channel), ['c2'], 'mention:false falls back to the channel sub');

  r = W.chatRecipients({ ch: 'memes', authorKey: ALICE, members, push, mentionKeys: [], mentionTeams: [] });
  assert.equal(r.announcement.length + r.mention.length + r.channel.length, 0, 'nobody subscribed to memes');

  // The same browser registered under two people buzzes once, for the best reason.
  const shared = 'https://fcm.googleapis.com/fcm/send/shared';
  const push2 = { [BOB]: { [dev('x1')]: deviceRec('x', { ch: { general: true } }, { endpoint: shared }) }, [CARL]: { [dev('x2')]: deviceRec('y', {}, { endpoint: shared }) } };
  r = W.chatRecipients({ ch: 'general', authorKey: ALICE, members, push: push2, mentionKeys: [CARL], mentionTeams: [] });
  assert.equal(r.mention.length + r.channel.length, 1, 'one delivery per device');
  assert.equal(r.mention.length, 1);
});

test('alert recipients: audiences, sender included, urgent ignores the director switch', async () => {
  const W = await load();
  const members = baseMembers();
  const push = {
    [ALICE]: { [dev('a1')]: deviceRec('a1', {}) },
    [BOB]: { [dev('b1')]: deviceRec('b1', { director: false }), [dev('b2')]: deviceRec('b2', {}) },
    [CARL]: { [dev('c1')]: deviceRec('c1', {}), short: deviceRec('c9', {}) },
  };
  assert.deepEqual(ids(W.alertRecipients({ audience: 'all', urgent: false, members, push })), ['a1', 'b2', 'c1'], 'sender included; director:false respected');
  assert.deepEqual(ids(W.alertRecipients({ audience: 'all', urgent: true, members, push })), ['a1', 'b1', 'b2', 'c1'], 'urgent comes through regardless');
  assert.deepEqual(ids(W.alertRecipients({ audience: 'editors', urgent: false, members, push })), ['a1']);
  assert.deepEqual(ids(W.alertRecipients({ audience: 't3', urgent: false, members, push })), ['c1']);
  assert.deepEqual(ids(W.alertRecipients({ audience: 't9', urgent: true, members, push })), []);
});

test('block recipients: the chosen lead only, every-block or the specific block', async () => {
  const W = await load();
  const members = baseMembers();
  const push = {
    [ALICE]: { [dev('a1')]: deviceRec('a1', { blocks: { supper: true }, lead: 10 }) },
    [BOB]: { [dev('b1')]: deviceRec('b1', { blocksAll: true, lead: 5 }), [dev('b2')]: deviceRec('b2', { blocksAll: true }) },
    [CARL]: { [dev('c1')]: deviceRec('c1', { blocks: { breakfast: true }, lead: 10 }) },
  };
  const supper = { key: 'supper' };
  const g = W.blockRecipients({ due: [{ block: supper, lead: 10 }, { block: supper, lead: 5 }, { block: supper, lead: 15 }], members, push });
  assert.deepEqual(g.map(ids), [['a1', 'b2'], ['b1'], []]);
});

// ── Eastern time & the schedule window ──────────────────────────────────

test('Eastern wall clock → epoch in July, January and across both DST changes', async () => {
  const W = await load();
  assert.equal(W.etWallToEpoch('2027-07-19', 17 * 60), Date.UTC(2027, 6, 19, 21, 0), 'July is UTC−4');
  assert.equal(W.etWallToEpoch('2027-01-11', 9 * 60), Date.UTC(2027, 0, 11, 14, 0), 'January is UTC−5');
  assert.equal(W.etWallToEpoch('2027-07-18', 0), Date.UTC(2027, 6, 18, 4, 0), 'midnight');
  assert.equal(W.etWallToEpoch('2027-07-18', 1440 + 60), Date.UTC(2027, 6, 19, 5, 0), 'minutes past a day roll over');
  assert.equal(W.etWallToEpoch('2026-03-08', 60), Date.UTC(2026, 2, 8, 6, 0), '1:00 AM EST before spring-forward');
  assert.equal(W.etWallToEpoch('2026-03-08', 180), Date.UTC(2026, 2, 8, 7, 0), '3:00 AM EDT after it');
  assert.equal(W.etWallToEpoch('2026-11-01', 0), Date.UTC(2026, 10, 1, 4, 0), 'midnight EDT on fall-back day');
  assert.equal(W.etWallToEpoch('2026-11-01', 180), Date.UTC(2026, 10, 1, 8, 0), '3:00 AM EST after it');
  assert.equal(W.formatEtTime(Date.UTC(2027, 6, 19, 21, 0)), '5:00 PM');
  assert.equal(W.formatEtTime(Date.UTC(2027, 6, 19, 4, 5)), '12:05 AM');
  assert.equal(W.formatEtTime(Date.UTC(2027, 6, 19, 16, 30)), '12:30 PM');
  assert.ok(W.isValidWeekStart('2027-07-18'));
  assert.notOk(W.isValidWeekStart('2027-07-19'), 'a Monday');
  assert.notOk(W.isValidWeekStart('2027-02-30'));
  assert.notOk(W.isValidWeekStart(null));
});

test('cron window: first run never backfills, a stall catches up at most 5 minutes, a corrupt future is ignored', async () => {
  const W = await load();
  const now = Date.UTC(2027, 6, 19, 20, 0);
  assert.deepEqual(W.cronWindow(now, undefined), { from: now, to: now + 60000, upTo: now + 60000 });
  assert.deepEqual(W.cronWindow(now, now - 20000), { from: now - 20000, to: now + 60000, upTo: now + 60000 });
  assert.equal(W.cronWindow(now, now - 3600000).from, now - 300000);
  assert.equal(W.cronWindow(now, now + 86400000).from, now, 'a day in the future is corruption');
  assert.equal(W.cronWindow(now, now + 90000).upTo, now + 90000, 'never moves the window backwards');
});

test('due blocks: each lead fires once, (from, to] edges exact', async () => {
  const W = await load();
  const blocks = {
    'd1-1020-5': { dow: 1, start: 1020, label: 'Supper', emoji: '🍽️', key: 'supper' },
    'd1-1035-6': { dow: 1, start: 1035, label: 'Evening service', emoji: '⛪', key: 'evening-service' },
    'bad id!': { dow: 1, start: 1020, label: 'x', emoji: '', key: 'x' },
    'd9-0-0': { dow: 9, start: 0, label: 'x', emoji: '', key: 'x' },
  };
  const start = Date.UTC(2027, 6, 19, 21, 0);
  const at = (lead) => start - lead * 60000;
  let due = W.dueBlocks(blocks, '2027-07-18', at(10) - 60000, at(10));
  assert.deepEqual(due.map((d) => [d.blockId, d.lead, d.date]), [['d1-1020-5', 10, '2027-07-19']], 'to is inclusive');
  assert.equal(due[0].startMs, start);
  assert.equal(W.dueBlocks(blocks, '2027-07-18', at(10), at(10) + 60000).length, 0, 'from is exclusive');
  due = W.dueBlocks(blocks, '2027-07-18', at(15) - 1, at(5));
  assert.deepEqual(due.map((d) => d.lead + ':' + d.block.key).sort(), ['10:supper', '15:supper', '5:supper'], 'the three supper moments, 16:45–16:55');
  due = W.dueBlocks(blocks, '2027-07-18', at(15) - 1, at(5) + 15 * 60000);
  assert.deepEqual(due.map((d) => d.lead + ':' + d.block.key).sort(),
    ['10:evening-service', '10:supper', '15:evening-service', '15:supper', '5:evening-service', '5:supper'], 'and evening service (5:15) at 5:00–5:10');
  assert.equal(W.dueBlocks(blocks, '2027-07-25', at(10) - 60000, at(10)).length, 0, 'a different week');
});

// ── Payloads ────────────────────────────────────────────────────────────

test('payloads: titles and bodies by kind, Eastern times, never over the size cap', async () => {
  const W = await load();
  const msg = { at: NOW, byKey: ALICE, name: 'Mallory', text: 'Hey   everyone,\nmeet at the flagpole' };
  let p = W.chatPayload({ camp: 'junior', kind: 'announcement', ch: 'announcements', msgId: 'm1', msg, name: 'Alice', now: NOW });
  assert.deepEqual(p, { v: 1, camp: 'junior', kind: 'announcement', title: '📣 Announcements', body: 'Alice: Hey everyone, meet at the flagpole', tag: 'chat-m1', ts: NOW, open: 'chat:announcements', urgent: false });
  p = W.chatPayload({ camp: 'junior', kind: 'channel', ch: 'photos', msgId: 'm2', msg: { at: NOW, photoId: 'p1', text: '' }, name: 'Alice', now: NOW });
  assert.equal(p.title, '📸 Photos');
  assert.equal(p.body, 'Alice: 📷 Photo');
  p = W.chatPayload({ camp: 'senior', kind: 'mention', ch: 'general', msgId: 'm3', msg: { at: NOW, text: 'x'.repeat(500) }, name: 'Alice', now: NOW });
  assert.equal(p.title, '💬 Alice mentioned you');
  assert.equal(Array.from(p.body).length, 140);
  p = W.alertPayload({ camp: 'junior', id: 'A1', name: 'Alice', text: 'Storm coming', urgent: true, now: NOW });
  assert.equal(p.title, '🚨 URGENT — Alice');
  assert.equal(p.kind, 'urgent');
  assert.equal(p.urgent, true);
  assert.equal(p.tag, 'alert-A1');
  const item = { blockId: 'd1-1020-5', block: { label: 'Supper', emoji: '🍽️', key: 'supper' }, lead: 10, startMs: Date.UTC(2027, 6, 19, 21, 0), date: '2027-07-19' };
  p = W.blockPayload({ camp: 'junior', item, now: item.startMs - 11 * 60000 + 30000 });
  assert.equal(p.title, '🍽️ Supper');
  assert.equal(p.body, 'Starts at 5:00 PM (in 10 min)');
  assert.equal(p.tag, 'block-d1-1020-5-2027-07-19');
  assert.equal(p.open, 'schedule');
  assert.equal(W.blockPayload({ camp: 'junior', item, now: item.startMs - 3 * 60000 }).body, 'Starts at 5:00 PM (in 3 min)', 'a late alert tells the truth');
  p = W.testPayload({ camp: 'junior', now: NOW });
  assert.equal(p.title, W.TEST_TITLE);
  assert.equal(p.tag, 'test-' + NOW);
  const huge = W.makePayload({ camp: 'junior', kind: 'alert', title: '\u0001'.repeat(500), body: '\u0001'.repeat(5000) + '😀'.repeat(5000), tag: 't', ts: NOW });
  assert.ok(Buffer.byteLength(JSON.stringify(huge)) <= W.PAYLOAD_LIMIT);
});

// ── /notify end to end ─────────────────────────────────────────────────

test('/notify chat: the right people, the right words (from the directory, not the message), decryptable', async () => {
  await load();
  const w = world();
  w.addDevice('campScoreboard', ALICE, 'alice-phone', { prefs: { ch: { general: true } } });
  w.addDevice('campScoreboard', BOB, 'bob-phone-1', { prefs: { mention: true } });
  w.addDevice('campScoreboard', CARL, 'carl-phone-1', { prefs: { ch: { general: true } } });
  w.net.db.set('campScoreboard/chat/general/-Nmsg1', { at: NOW - 2000, byKey: ALICE, name: 'Mallory the impostor', text: 'Bob, café at 3 ☕' });
  const r = await w.notify('Alice@Camp.org', { camp: 'junior', kind: 'chat', ch: 'general', msgId: '-Nmsg1', mentionKeys: [BOB] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  assert.deepEqual(r.json, { ok: true, sent: 2, failed: 0, removed: 0, queued: 0, batches: [] });
  const byUrl = {};
  for (const p of w.net.pushes) byUrl[p.url] = p;
  assert.ok(!byUrl['https://fcm.googleapis.com/fcm/send/alice-phone'], 'the author is never buzzed');
  const bob = byUrl['https://fcm.googleapis.com/fcm/send/bob-phone-1'];
  const bobMsg = decrypt(w.net, bob).payload;
  assert.equal(bobMsg.kind, 'mention');
  assert.equal(bobMsg.title, '💬 Alice mentioned you', 'name from the member directory');
  assert.equal(bobMsg.body, 'Bob, café at 3 ☕');
  assert.equal(bobMsg.tag, 'chat--Nmsg1');
  assert.equal(bobMsg.open, 'chat:general');
  assert.equal(bob.headers.urgency, 'high');
  assert.equal(bob.headers.ttl, '21600');
  const carl = byUrl['https://fcm.googleapis.com/fcm/send/carl-phone-1'];
  const carlMsg = decrypt(w.net, carl).payload;
  assert.equal(carlMsg.kind, 'channel');
  assert.equal(carlMsg.title, '💬 General');
  assert.equal(carlMsg.body, 'Alice: Bob, café at 3 ☕');
  assert.equal(carl.headers.urgency, 'normal');
  assert.ok(w.maxCalls() <= 45);

  // Again for the same message: deduped, nothing sent.
  w.net.pushes = [];
  const again = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'general', msgId: '-Nmsg1' });
  assert.equal(again.json.duplicate, true);
  assert.equal(again.json.sent, 0);
  assert.equal(w.net.pushes.length, 0);
});

test('/notify chat: only the author can announce, the message must exist, old messages are not re-announced', async () => {
  await load();
  const w = world();
  w.addDevice('campScoreboard', CARL, 'carl-phone-1', { prefs: { ch: { general: true } } });
  w.net.db.set('campScoreboard/chat/general/m1', { at: NOW - 1000, byKey: ALICE, text: 'hi' });
  w.net.db.set('campScoreboard/chat/general/old', { at: NOW - 2 * 3600 * 1000, byKey: ALICE, text: 'hi' });
  let r = await w.notify('bob.smith@camp.org', { camp: 'junior', kind: 'chat', ch: 'general', msgId: 'm1' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'not-author');
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'general', msgId: 'nope' });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'no-message');
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'secret', msgId: 'm1' });
  assert.equal(r.json.error, 'bad-channel');
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'general', msgId: 'a/b' });
  assert.equal(r.json.error, 'bad-msg');
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'general', msgId: 'old' });
  assert.equal(r.json.stale, true);
  assert.equal(w.net.pushes.length, 0);
  r = await w.notify('alice@camp.org', { camp: 'middle', kind: 'chat' });
  assert.equal(r.json.error, 'bad-camp');
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'spam' });
  assert.equal(r.json.error, 'bad-kind');
});

test('/notify alert: editors only, rate limited, audited with counts, urgent cuts through', async () => {
  await load();
  const w = world();
  w.addDevice('campScoreboard', ALICE, 'alice-phone', {});
  w.addDevice('campScoreboard', BOB, 'bob-phone-1', { prefs: { director: false } });
  w.addDevice('campScoreboard', CARL, 'carl-phone-1', {});
  let r = await w.notify('bob.smith@camp.org', { camp: 'junior', kind: 'alert', text: 'hi', audience: 'all', urgent: false });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'not-editor');

  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'alert', text: '  Bring water bottles  ', audience: 'all', urgent: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.sent, 2, 'Alice (sender included) + Carl; Bob muted director alerts');
  const log = w.net.db.get('campScoreboard/pushAlerts');
  const ids = Object.keys(log);
  assert.equal(ids.length, 1);
  assert.equal(ids[0], r.json.alertId);
  const rec = log[ids[0]];
  assert.equal(rec.text, 'Bring water bottles');
  assert.equal(rec.byKey, ALICE);
  assert.equal(rec.byName, 'Alice');
  assert.equal(rec.audience, 'all');
  assert.equal(rec.urgent, false);
  assert.equal(rec.sent, 2);
  assert.equal(rec.at, NOW);
  const p = decrypt(w.net, w.net.pushes[0]).payload;
  assert.equal(p.title, '📢 Alice');
  assert.equal(p.body, 'Bring water bottles');
  assert.equal(p.tag, 'alert-' + ids[0]);
  assert.equal(w.net.pushes[0].headers.ttl, String(12 * 3600));

  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'alert', text: 'again', audience: 'all', urgent: true });
  assert.equal(r.status, 429, 'one alert per 10 s');
  assert.equal(r.json.error, 'rate');

  w.net.now += 10001;
  w.net.pushes = [];
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'alert', text: 'Lightning — everyone inside', audience: 'all', urgent: true });
  assert.equal(r.json.sent, 3, 'urgent reaches Bob too');
  const u = decrypt(w.net, w.net.pushes[0]).payload;
  assert.equal(u.title, '🚨 URGENT — Alice');
  assert.equal(u.urgent, true);
  assert.equal(w.net.pushes[0].headers.ttl, String(2 * 3600));

  w.net.now += 10001;
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'alert', text: '', audience: 'all' });
  assert.equal(r.json.error, 'bad-text');
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'alert', text: 'x'.repeat(301), audience: 'all' });
  assert.equal(r.json.error, 'bad-text');
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'alert', text: 'x', audience: 'parents' });
  assert.equal(r.json.error, 'bad-audience');
  w.net.pushes = [];
  r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'alert', text: 'Team 3 to the dock', audience: 't3' });
  assert.equal(r.json.sent, 1);
  assert.equal(w.net.pushes[0].url, 'https://fcm.googleapis.com/fcm/send/carl-phone-1');
});

test('/notify test: only your own phones (or the one named), rate limited', async () => {
  await load();
  const w = world();
  w.addDevice('campScoreboard', BOB, 'bob-phone-1', {});
  w.addDevice('campScoreboard', BOB, 'bob-tablet-1', {});
  w.addDevice('campScoreboard', CARL, 'carl-phone-1', {});
  let r = await w.notify('bob.smith@camp.org', { camp: 'junior', kind: 'test' });
  assert.equal(r.json.sent, 2);
  assert.ok(w.net.pushes.every((p) => p.url.includes('bob-')));
  const p = decrypt(w.net, w.net.pushes[0]);
  assert.equal(p.payload.kind, 'test');
  assert.equal(w.net.pushes[0].headers.ttl, '600');
  r = await w.notify('bob.smith@camp.org', { camp: 'junior', kind: 'test', deviceId: 'bob-tablet-1' });
  assert.equal(r.status, 429, 'one test per 5 s');
  w.net.now += 5001;
  w.net.pushes = [];
  r = await w.notify('bob.smith@camp.org', { camp: 'junior', kind: 'test', deviceId: 'bob-tablet-1' });
  assert.equal(r.json.sent, 1);
  assert.equal(w.net.pushes[0].url, 'https://fcm.googleapis.com/fcm/send/bob-tablet-1');
  r = await w.notify('bob.smith@camp.org', { camp: 'junior', kind: 'test', deviceId: 'carl-phone-1' });
  assert.equal(r.status, 404, "someone else's device is not yours");
});

// ── Batching, the outbox, the budget ────────────────────────────────────

function crowd(w, n, prefs) {
  const members = baseMembers();
  for (let i = 0; i < n; i++) members[`kid${i}@camp,org`] = { role: 'viewer', name: `Kid ${i}`, addedBy: 'x', addedAt: 1 };
  w.net.db.set('campScoreboard/members', members);
  for (let i = 0; i < n; i++) w.addDevice('campScoreboard', `kid${i}@camp,org`, `kid-phone-${i}`, { prefs: prefs || {} });
}

test('25 recipients with PUSH_BATCH 20: 20 inline + one batch of 5, drained exactly once', async () => {
  await load();
  const w = world();
  crowd(w, 25);
  w.net.db.set('campScoreboard/chat/announcements/m1', { at: NOW, byKey: ALICE, text: 'Swim test at 2' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'announcements', msgId: 'm1' });
  assert.equal(r.json.sent, 20);
  assert.equal(r.json.queued, 5);
  assert.equal(r.json.batches.length, 1);
  assert.equal(w.net.pushes.length, 20);
  const outbox = w.net.db.get('pushServer/outbox');
  const id = r.json.batches[0];
  assert.deepEqual(Object.keys(outbox), [id]);
  assert.ok(id.length >= 32 && /^[A-Za-z0-9_-]+$/.test(id), 'a long, url-safe capability');
  assert.equal(outbox[id].targets.length, 5);
  assert.equal(outbox[id].camp, 'junior');
  assert.equal(outbox[id].attempts, 0);
  assert.ok(w.maxCalls() <= 45);

  const d = await w.request('POST', '/drain', { batch: id }, { Origin: SITE });
  assert.equal(d.status, 200, d.text);
  assert.equal(d.json.claimed, true);
  assert.equal(d.json.sent, 5);
  assert.equal(w.net.pushes.length, 25);
  assert.equal(new Set(w.net.pushes.map((p) => p.url)).size, 25, 'every phone exactly once');
  assert.equal(w.net.db.get('pushServer/outbox'), null);
  const d2 = await w.request('POST', '/drain', { batch: id });
  assert.equal(d2.status, 404, 'already done');
  const d3 = await w.request('POST', '/drain', { batch: 'short' });
  assert.equal(d3.status, 404);
});

test('two drains racing for one batch: exactly one wins the claim', async () => {
  const W = await load();
  const w = world({ env: { PUSH_BATCH: '1' } });
  crowd(w, 2);
  w.net.db.set('campScoreboard/chat/announcements/m1', { at: NOW, byKey: ALICE, text: 'x' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'announcements', msgId: 'm1' });
  const id = r.json.batches[0];
  // The loser's claim must fail: let a rival delete the batch between our read and our claim.
  // A rival claims the batch between our read and our conditional delete.
  w.net.db.beforeWrite = async (method, path) => {
    if (method === 'DELETE' && path === `pushServer/outbox/${id}`) { w.net.db.beforeWrite = null; w.net.db.set(path, null); }
  };
  const before = w.net.pushes.length;
  const lost = await w.request('POST', '/drain', { batch: id });
  assert.equal(lost.status, 200);
  assert.equal(lost.json.claimed, false, 'lost the claim: someone else is sending it');
  assert.equal(lost.json.sent, 0);
  assert.equal(w.net.pushes.length, before, 'and so sent nothing');
});

test('the subrequest counter never passes 45, whatever PUSH_BATCH says', async () => {
  const W = await load();
  const w = world({ env: { PUSH_BATCH: '40' } });
  crowd(w, 60);
  w.net.db.set('campScoreboard/chat/announcements/m1', { at: NOW, byKey: ALICE, text: 'All hands' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'announcements', msgId: 'm1' });
  assert.equal(r.json.sent + r.json.queued, 60);
  assert.ok(w.maxCalls() <= 45, `used ${w.maxCalls()}`);
  for (const id of r.json.batches) {
    const d = await w.request('POST', '/drain', { batch: id });
    assert.equal(d.status, 200);
  }
  assert.equal(new Set(w.net.pushes.map((p) => p.url)).size, 60, 'everyone, eventually, once');
  assert.ok(w.maxCalls() <= 45);
  // And the counter itself refuses the 46th call.
  const ictx = W.makeInvocation({}, { fetch: async () => new Response('{}'), now: () => NOW, cache: W.newCache() });
  for (let i = 0; i < 45; i++) await ictx.fetch('https://example.com/');
  await rejects(ictx.fetch('https://example.com/'), (e) => assert.equal(e.code, 'busy'));
});

test('dead subscriptions are removed only if the record still holds the failed endpoint', async () => {
  await load();
  const w = world();
  const gone = w.addDevice('campScoreboard', BOB, 'bob-phone-1', { prefs: { ch: { general: true } } });
  const moved = w.addDevice('campScoreboard', CARL, 'carl-phone-1', { prefs: { ch: { general: true } } });
  w.net.pushStatus[gone.endpoint] = 410;
  // Carl's phone re-subscribes while the 404 is in flight: new endpoint, same record.
  w.net.pushStatus[moved.endpoint] = async () => {
    w.net.db.set('campScoreboard/push/' + CARL + '/carl-phone-1/endpoint', 'https://fcm.googleapis.com/fcm/send/carl-new');
    return 404;
  };
  w.net.db.set('campScoreboard/chat/general/m1', { at: NOW, byKey: ALICE, text: 'x' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'general', msgId: 'm1' });
  assert.equal(r.json.failed, 2);
  assert.equal(r.json.removed, 1);
  assert.equal(w.net.db.get(`campScoreboard/push/${BOB}/bob-phone-1`), null, 'dead and unchanged: removed');
  assert.equal(w.net.db.get(`campScoreboard/push/${CARL}/carl-phone-1/endpoint`), 'https://fcm.googleapis.com/fcm/send/carl-new', 're-subscribed: kept');
});

test('transient failures retry with backoff (not handed to the client); permanent ones are reported', async () => {
  const W = await load();
  const w = world();
  const flaky = w.addDevice('campScoreboard', BOB, 'bob-phone-1', { prefs: { ch: { general: true } } });
  const apple = w.addDevice('campScoreboard', CARL, 'carl-phone-1', { endpoint: 'https://web.push.apple.com/QXYZ', prefs: { ch: { general: true } } });
  w.net.pushStatus[flaky.endpoint] = 503;
  w.net.pushStatus[apple.endpoint] = 403;
  w.net.db.set('campScoreboard/chat/general/m1', { at: NOW, byKey: ALICE, text: 'x' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'general', msgId: 'm1' });
  assert.equal(r.json.sent, 0);
  assert.equal(r.json.queued, 1);
  assert.equal(r.json.failed, 1);
  assert.deepEqual(r.json.batches, [], 'a retry is the cron’s job, after its backoff');
  assert.deepEqual(r.json.errors, [{ status: 403, host: 'web.push.apple.com' }]);
  const outbox = w.net.db.get('pushServer/outbox');
  const [id] = Object.keys(outbox);
  assert.equal(outbox[id].attempts, 1);
  assert.equal(outbox[id].due, NOW + 60000);
  assert.equal(W.timeFromKey(id), NOW + 60000, 'due time readable from the id');
  const le = w.net.db.get('pushServer/lastError');
  assert.equal(le.status, 403);
  assert.equal(le.host, 'web.push.apple.com');

  // The cron takes it after its due time + grace; it fails twice more and is dropped.
  w.net.now = NOW + 60000 + 21000;
  let c = await w.cron();
  assert.equal(c.tally.queued, 1, 'second failure: re-queued');
  const [id2] = Object.keys(w.net.db.get('pushServer/outbox'));
  assert.equal(w.net.db.get('pushServer/outbox/' + id2).attempts, 2);
  w.net.now = W.timeFromKey(id2) + 21000;
  c = await w.cron();
  assert.equal(c.tally.failed, 1, 'third strike: dropped');
  assert.equal(w.net.db.get('pushServer/outbox'), null);
  assert.equal(w.net.pushes.filter((p) => p.url === flaky.endpoint).length, 3, 'three tries in all');

  // And the status page says so, in words.
  const page = await w.request('GET', '/');
  assert.ok(page.text.includes('web.push.apple.com refused a notification (HTTP 403'), 'push-service refusal surfaced');
});

test('an expired batch is dropped, not delivered late', async () => {
  await load();
  const w = world({ env: { PUSH_BATCH: '1' } });
  crowd(w, 2);
  w.net.db.set('campScoreboard/chat/announcements/m1', { at: NOW, byKey: ALICE, text: 'x' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'announcements', msgId: 'm1' });
  w.net.now = NOW + 7 * 3600 * 1000;
  const d = await w.request('POST', '/drain', { batch: r.json.batches[0] });
  assert.equal(d.json.claimed, true);
  assert.equal(d.json.sent, 0);
  assert.equal(d.json.failed, 1);
  assert.equal(w.net.pushes.length, 1, 'only the original inline send');
});

test('an alert bigger than one batch keeps its audit counts accurate through the drains', async () => {
  await load();
  const w = world({ env: { PUSH_BATCH: '2' } });
  crowd(w, 5);
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'alert', text: 'Pizza!', audience: 'all' });
  assert.equal(r.json.sent, 2);
  assert.equal(r.json.queued, 3);
  for (const id of r.json.batches) await w.request('POST', '/drain', { batch: id });
  const rec = w.net.db.get(`campScoreboard/pushAlerts/${r.json.alertId}`);
  assert.equal(rec.sent, 5, 'inline + drained');
  assert.equal(rec.failed, 0);
});

test('a drained batch skips people removed since, and follows a re-subscribed phone', async () => {
  await load();
  const w = world({ env: { PUSH_BATCH: '1' } });
  crowd(w, 3);
  w.net.db.set('campScoreboard/chat/announcements/m1', { at: NOW, byKey: ALICE, text: 'x' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'announcements', msgId: 'm1' });
  const batches = r.json.batches.map((id) => w.net.db.get('pushServer/outbox/' + id));
  const [removedKey, movedKey] = batches.map((b) => b.targets[0].k);
  w.net.db.set(`campScoreboard/members/${removedKey}`, null);
  const moved = device(w.net, { id: 'moved-phone' });
  const movedDevice = batches[1].targets[0].d;
  w.net.db.set(`campScoreboard/push/${movedKey}/${movedDevice}`, Object.assign(w.net.db.get(`campScoreboard/push/${movedKey}/${movedDevice}`), { endpoint: moved.endpoint, p256dh: moved.p256dh, auth: moved.auth }));
  w.net.pushes = [];
  for (const id of r.json.batches) await w.request('POST', '/drain', { batch: id });
  assert.deepEqual(w.net.pushes.map((p) => p.url), [moved.endpoint]);
  assert.equal(decrypt(w.net, w.net.pushes[0]).payload.kind, 'announcement', 'encrypted for the NEW keys');
});

// ── HTTP surface ────────────────────────────────────────────────────────

test('CORS: preflight, allowed origin echoed, other sites refused', async () => {
  await load();
  const w = world();
  let r = await w.request('OPTIONS', '/notify', undefined, { Origin: SITE, 'Access-Control-Request-Method': 'POST' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  assert.equal(r.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS');
  assert.equal(r.headers.get('access-control-allow-headers'), 'Authorization,Content-Type');
  assert.equal(r.headers.get('access-control-max-age'), '86400');
  r = await w.request('OPTIONS', '/notify', undefined, { Origin: 'https://evil.example' });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await w.request('POST', '/drain', { batch: 'x'.repeat(30) }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'bad-origin');
  const w2 = world({ env: { ALLOWED_ORIGINS: 'http://localhost:8000, https://camp.patricksimpson.info/' } });
  r = await w2.request('GET', '/health', undefined, { Origin: 'http://localhost:8000' });
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8000');
});

test('unknown routes 404, oversized bodies 413, junk bodies 400 — always the JSON error shape', async () => {
  await load();
  const w = world();
  for (const [m, p] of [['GET', '/nope'], ['GET', '/notify'], ['POST', '/health'], ['PUT', '/notify'], ['DELETE', '/']]) {
    const r = await w.request(m, p, m === 'POST' ? {} : undefined);
    assert.equal(r.status, 404, `${m} ${p}`);
    assert.deepEqual(Object.keys(r.json), ['ok', 'error', 'message']);
    assert.equal(r.json.ok, false);
  }
  let r = await w.request('POST', '/notify', JSON.stringify({ camp: 'junior', kind: 'test', pad: 'x'.repeat(17000) }));
  assert.equal(r.status, 413);
  assert.equal(r.json.error, 'too-large');
  r = await w.request('POST', '/notify', '{not json');
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'bad-json');
  r = await w.request('POST', '/notify', '[1,2]');
  assert.equal(r.json.error, 'bad-json');
  r = await w.request('POST', '/notify', '');
  assert.equal(r.json.error, 'bad-json');
});

test('/vapid-key: made once, stored, and a race between two isolates settles on one key', async () => {
  await load();
  const w = world();
  const a = await w.request('GET', '/vapid-key', undefined, { Origin: SITE });
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('access-control-allow-origin'), SITE);
  assert.equal(fromB64u(a.json.publicKey).length, 65);
  const stored = w.net.db.get('pushServer/vapid');
  assert.equal(stored.publicKey, a.json.publicKey);
  assert.deepEqual(Object.keys(stored.privateJwk).sort(), ['crv', 'd', 'kty', 'x', 'y']);
  w.cache.vapid = null; // a new isolate: reads it back, never regenerates
  const b = await w.request('GET', '/vapid-key');
  assert.equal(b.json.publicKey, a.json.publicKey);

  // The race: another isolate writes its key between our read and our write.
  const w2 = world();
  const rival = world();
  const rivalKey = (await rival.request('GET', '/vapid-key')).json.publicKey;
  const rivalRec = rival.net.db.get('pushServer/vapid');
  w2.net.db.beforeWrite = async (method, path) => {
    if (path === 'pushServer/vapid') { w2.net.db.beforeWrite = null; w2.net.db.set(path, rivalRec); }
  };
  const c = await w2.request('GET', '/vapid-key');
  assert.equal(c.json.publicKey, rivalKey, 'the loser adopts the winner');
  assert.equal(w2.net.db.get('pushServer/vapid').publicKey, rivalKey);
});

test('/health and the status page: honest when broken, all green when working, never print the secret', async () => {
  await load();
  const broken = world({ env: { FIREBASE_SERVICE_ACCOUNT: '' } });
  let h = await broken.request('GET', '/health');
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, false);
  assert.equal(h.json.configured, false);
  assert.equal(h.json.error, 'not-configured');
  let page = await broken.request('GET', '/');
  assert.ok(page.text.includes('❌'));
  assert.ok(page.text.includes('FIREBASE_SERVICE_ACCOUNT'));
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');

  page = await world({ env: { FIREBASE_SERVICE_ACCOUNT: '{"type": "service_acc' } }).request('GET', '/');
  assert.ok(unescape(page.text).includes("isn't a complete key file"));
  const other = Object.assign({}, SA_JSON, { project_id: 'someone-else' });
  page = await world({ env: { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(other) } }).request('GET', '/');
  assert.ok(page.text.includes('someone-else'), 'names the wrong project');
  const refused = world();
  refused.net.refuseKey = true;
  page = await refused.request('GET', '/');
  assert.ok(page.text.includes('Google refused the key (Invalid JWT Signature.)'));

  const w = world();
  h = await w.request('GET', '/health');
  assert.equal(h.json.configured, true);
  assert.equal(h.json.vapid, true);
  assert.equal(h.json.cronLastRun, null);
  assert.equal(h.json.ok, true);
  assert.equal(typeof h.json.version, 'string');
  assert.equal(h.json.time, NOW);
  page = await w.request('GET', '/');
  assert.ok(page.text.includes('The schedule timer has never run'));
  await w.cron();
  w.net.now += 2 * 60000;
  page = await w.request('GET', '/');
  assert.ok(page.text.includes('Schedule timer last ran 2 minutes ago'));
  assert.ok(page.text.includes('Everything is working.'));
  assert.ok(page.text.includes('Eastern'));
  assert.ok(!page.text.includes('BEGIN PRIVATE KEY') && !page.text.includes(SA_JSON.client_email) && !page.text.includes('tok-1'), 'no secrets');
  // The admin assertion was a proper RS256 service-account JWT.
  const a = w.net.assertions[0];
  assert.ok(a.ok);
  assert.equal(a.grant, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(a.claims.iss, SA_JSON.client_email);
  assert.equal(a.claims.aud, TOKEN_URI);
  assert.equal(a.claims.exp - a.claims.iat, 3600);
  assert.ok(a.claims.scope.includes('firebase.database') && a.claims.scope.includes('userinfo.email'));
  assert.equal(w.net.tokenMints, 1, 'the access token is cached across requests');
});

test('test-only overrides are ignored unless the database is on this machine', async () => {
  const W = await load();
  const prod = W.readConfig({ DB_ADMIN_TOKEN: 'owner', JWKS_URL: 'https://evil.example/keys' });
  assert.equal(prod.adminToken, '');
  assert.ok(prod.jwksUrl.startsWith('https://www.googleapis.com/'));
  const local = W.readConfig({ FIREBASE_DB_URL: 'http://127.0.0.1:9000/?ns=camp-test', DB_ADMIN_TOKEN: 'owner', JWKS_URL: 'http://127.0.0.1:9099/keys' });
  assert.equal(local.adminToken, 'owner');
  assert.equal(local.jwksUrl, 'http://127.0.0.1:9099/keys');
  assert.deepEqual(local.dbParams, [['ns', 'camp-test']]);
  assert.equal(W.readConfig({ FIREBASE_DB_URL: 'http://evil.example' }).dbBase, 'https://camp-89cea-default-rtdb.firebaseio.com', 'no plain http to a real host');
  assert.equal(W.readConfig({ PUSH_BATCH: '500' }).pushBatch, 40);
  assert.equal(W.readConfig({ PUSH_BATCH: '0' }).pushBatch, 1);
  assert.equal(W.readConfig({ VAPID_SUBJECT: 'camp' }).vapidSubject, 'https://camp.patricksimpson.info', 'must be https: or mailto:');
});

test('/resubscribe swaps the endpoint in both camps and keeps every preference', async () => {
  await load();
  const w = world();
  const rec = w.addDevice('campScoreboard', BOB, 'bob-phone-1', { prefs: { blocksAll: true, lead: 15 }, team: 't2' });
  w.net.db.set(`seniorScoreboard/push/${ALICE}/alice-phone-9`, Object.assign({}, rec, { prefs: { mention: false } }));
  w.addDevice('campScoreboard', CARL, 'carl-phone-1', {});
  const fresh = device(w.net, { id: 'bob-new' });
  let r = await w.request('POST', '/resubscribe', { oldEndpoint: rec.endpoint, endpoint: fresh.endpoint, p256dh: fresh.p256dh, auth: fresh.auth }, { Origin: SITE });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { ok: true, updated: 2 });
  const bob = w.net.db.get(`campScoreboard/push/${BOB}/bob-phone-1`);
  assert.equal(bob.endpoint, fresh.endpoint);
  assert.equal(bob.p256dh, fresh.p256dh);
  assert.deepEqual(bob.prefs, { blocksAll: true, lead: 15 });
  assert.equal(bob.team, 't2');
  assert.equal(w.net.db.get(`seniorScoreboard/push/${ALICE}/alice-phone-9/endpoint`), fresh.endpoint);
  assert.ok(w.net.db.get(`campScoreboard/push/${CARL}/carl-phone-1/endpoint`) !== fresh.endpoint, 'other phones untouched');
  r = await w.request('POST', '/resubscribe', { oldEndpoint: rec.endpoint, endpoint: 'http://insecure', p256dh: fresh.p256dh, auth: fresh.auth });
  assert.equal(r.status, 400);
  r = await w.request('POST', '/resubscribe', { oldEndpoint: 'https://nobody', endpoint: fresh.endpoint, p256dh: fresh.p256dh, auth: fresh.auth });
  assert.deepEqual(r.json, { ok: true, updated: 0 });
});

// ── The cron ────────────────────────────────────────────────────────────

const SUPPER_START = Date.UTC(2027, 6, 19, 21, 0); // Mon Jul 19 2027, 5:00 PM Eastern

function scheduleWorld() {
  const w = world();
  w.net.db.set('campScoreboard/pushSchedule', {
    weekStart: '2027-07-18', at: NOW, by: ALICE,
    blocks: {
      'd1-1020-5': { dow: 1, start: 1020, label: 'Supper', emoji: '🍽️', key: 'supper' },
      'd1-420-0': { dow: 1, start: 420, label: 'Breakfast', emoji: '🥞', key: 'breakfast' },
    },
  });
  w.addDevice('campScoreboard', ALICE, 'alice-phone', { prefs: { blocks: { supper: true }, lead: 10 } });
  w.addDevice('campScoreboard', BOB, 'bob-phone-1', { prefs: { blocksAll: true, lead: 5 } });
  w.addDevice('campScoreboard', CARL, 'carl-phone-1', { prefs: { blocks: { breakfast: true } } });
  return w;
}

test('cron: a block alert goes out once, at its lead, in Eastern words', async () => {
  await load();
  const w = scheduleWorld();
  w.net.db.set('pushServer/cron/junior', { upTo: SUPPER_START - 11 * 60000, lastRun: SUPPER_START - 12 * 60000 });
  w.net.now = SUPPER_START - 11 * 60000;
  const c = await w.cron();
  assert.ok(c.used <= 45);
  assert.equal(w.net.pushes.length, 1);
  assert.equal(w.net.pushes[0].url, 'https://fcm.googleapis.com/fcm/send/alice-phone');
  const p = decrypt(w.net, w.net.pushes[0]).payload;
  assert.equal(p.title, '🍽️ Supper');
  assert.equal(p.body, 'Starts at 5:00 PM (in 10 min)');
  assert.equal(p.tag, 'block-d1-1020-5-2027-07-19');
  assert.equal(p.kind, 'block');
  assert.equal(w.net.pushes[0].headers.ttl, '660');
  assert.equal(w.net.db.get('pushServer/cron/junior/lastRun'), w.net.now);
  assert.equal(w.net.db.get('pushServer/cron/junior/upTo'), w.net.now + 60000);

  // The next tick a minute later doesn't repeat it.
  w.net.now += 60000;
  await w.cron();
  assert.equal(w.net.pushes.length, 1);
  // Bob's lead-5 alert comes at its own time.
  w.net.now = SUPPER_START - 6 * 60000;
  await w.cron();
  w.net.now += 60000;
  await w.cron();
  assert.equal(w.net.pushes.length, 2);
  assert.equal(w.net.pushes[1].url, 'https://fcm.googleapis.com/fcm/send/bob-phone-1');
  assert.equal(decrypt(w.net, w.net.pushes[1]).payload.body, 'Starts at 5:00 PM (in 5 min)');
});

test('cron: the first run ever does not backfill alerts that are already past', async () => {
  await load();
  const w = scheduleWorld();
  w.net.now = SUPPER_START - 8 * 60000; // the lead-10 moment was 2 minutes ago
  await w.cron();
  assert.equal(w.net.pushes.length, 0);
  assert.equal(w.net.db.get('pushServer/cron/junior/upTo'), w.net.now + 60000);
});

test('cron: outside camp week it reads one tiny value and writes only the heartbeat', async () => {
  await load();
  const w = scheduleWorld();
  w.net.now = Date.UTC(2027, 8, 1, 16, 0);
  w.net.db.log = [];
  await w.cron();
  const reads = w.net.db.log.filter((l) => l.method === 'GET').map((l) => l.path);
  assert.ok(!reads.some((p) => p.includes('pushSchedule/blocks')), 'blocks never read');
  assert.ok(!reads.some((p) => p.endsWith('/push') || p.endsWith('/members')), 'nobody looked up');
  const writes = w.net.db.log.filter((l) => l.method !== 'GET');
  assert.equal(writes.length, 1, 'one heartbeat write for both camps');
  assert.deepEqual(w.net.db.get('pushServer/cron'), { junior: { lastRun: w.net.now }, senior: { lastRun: w.net.now } });
  assert.equal(w.net.pushes.length, 0);
});

test('cron: drains batches nobody drained (after the grace period), leaves fresh ones to the client', async () => {
  const W = await load();
  const w = world({ env: { PUSH_BATCH: '1' } });
  crowd(w, 2);
  w.net.db.set('campScoreboard/chat/announcements/m1', { at: NOW, byKey: ALICE, text: 'x' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'announcements', msgId: 'm1' });
  assert.equal(r.json.batches.length, 1);
  w.net.now = NOW + 5000;
  await w.cron();
  assert.equal(w.net.pushes.length, 1, 'the client still has 20 s to drain it');
  w.net.now = NOW + 21000;
  const c = await w.cron();
  assert.equal(c.tally.sent, 1);
  assert.equal(w.net.pushes.length, 2);
  assert.equal(w.net.db.get('pushServer/outbox'), null);
});

test('cron maintenance (minute 17): prunes old markers and ex-members’ phones — never on an empty member list', async () => {
  await load();
  const w = world();
  const t = Date.UTC(2027, 6, 20, 15, 17, 0);
  w.net.now = t;
  w.net.db.set('pushServer/sent/junior', { 'c-old': t - 4 * 86400000, 'c-new': t - 3600000 });
  w.net.db.set('pushServer/rate/junior', { [ALICE]: t - 2 * 86400000, [BOB]: t - 1000 });
  w.addDevice('campScoreboard', BOB, 'bob-phone-1', {});
  w.net.db.set(`campScoreboard/push/gone@camp,org/gone-phone-1`, device(w.net, { id: 'gone-phone-1' }));
  // Senior's member list reads as empty: its device records must survive.
  w.net.db.set('seniorScoreboard/members', null);
  w.net.db.set(`seniorScoreboard/push/${ALICE}/alice-phone-1`, device(w.net, { id: 'alice-phone-1' }));
  w.net.db.set('pushServer/outbox/bad key!', { junk: true });
  await w.cron();
  assert.deepEqual(Object.keys(w.net.db.get('pushServer/sent/junior')), ['c-new']);
  assert.deepEqual(Object.keys(w.net.db.get('pushServer/rate/junior')), [BOB]);
  assert.equal(w.net.db.get('campScoreboard/push/gone@camp,org'), null);
  assert.ok(w.net.db.get(`campScoreboard/push/${BOB}/bob-phone-1`));
  assert.ok(w.net.db.get(`seniorScoreboard/push/${ALICE}/alice-phone-1`), 'not pruned on an empty list');
  assert.equal(w.net.db.get('pushServer/outbox'), null);

  // Any other minute: no maintenance.
  w.net.db.set('pushServer/sent/junior', { 'c-old': t - 4 * 86400000 });
  w.net.now = t + 60000;
  await w.cron();
  assert.ok(w.net.db.get('pushServer/sent/junior/c-old'));
});

test('cron, worst minute: cold isolate + outbox backlog + a block due for 60 phones stays in budget and loses nothing', async () => {
  const W = await load();
  const w = world();
  crowd(w, 60, { blocksAll: true, lead: 10 });
  w.net.db.set('campScoreboard/chat/announcements/m1', { at: NOW, byKey: ALICE, text: 'Big news' });
  const r = await w.notify('alice@camp.org', { camp: 'junior', kind: 'chat', ch: 'announcements', msgId: 'm1' });
  assert.equal(r.json.batches.length, 2, '40 phones parked in two batches nobody drains');
  // Tuesday 11:10 AM block → its lead-10 alert is due at exactly NOW.
  w.net.db.set('campScoreboard/pushSchedule', { weekStart: '2027-07-18', at: NOW, by: ALICE, blocks: { 'd2-670-3': { dow: 2, start: 670, label: 'Rec time', emoji: '⚽', key: 'rec-time' } } });
  w.net.db.set('pushServer/cron/junior', { upTo: NOW - 30000, lastRun: NOW - 30000 });
  w.net.now = NOW + 25000;
  w.cache.oauth = null; w.cache.jwks = null; w.cache.vapid = null; w.cache.vapidJwt.clear(); // a fresh isolate
  const before = w.net.pushes.length;
  const c = await w.cron();
  assert.ok(c.used <= 45, `used ${c.used}`);
  assert.ok(w.net.pushes.length - before <= 20, 'never more than PUSH_BATCH sends in one run');
  assert.equal(w.net.db.get('pushServer/cron/junior/lastRun'), w.net.now, 'heartbeat written');
  const advanced = w.net.db.get('pushServer/cron/junior/upTo') === w.net.now + 60000;
  const queuedBlocks = Object.values(w.net.db.get('pushServer/outbox') || {}).filter((b) => b.payload.kind === 'block')
    .reduce((n, b) => n + (Array.isArray(b.targets) ? b.targets.length : Object.keys(b.targets).length), 0);
  const sentBlocks = w.net.pushes.slice(before).filter((p) => decrypt(w.net, p).payload.kind === 'block').length;
  assert.ok(advanced ? sentBlocks + queuedBlocks === 60 : sentBlocks === 0, 'every block alert sent or parked — or the window stays open for next minute');
  // Keep ticking: within a few minutes every phone has both notifications, once each.
  for (let i = 0; i < 8; i++) { w.net.now += 60000; await w.cron(); }
  const kinds = {};
  for (const p of w.net.pushes) { const k = decrypt(w.net, p).payload.kind; kinds[k] = (kinds[k] || 0) + 1; }
  assert.equal(kinds.announcement, 60);
  assert.equal(kinds.block, 60);
  assert.equal(new Set(w.net.pushes.filter((p) => decrypt(w.net, p).payload.kind === 'block').map((p) => p.url)).size, 60, 'no phone twice');
  assert.equal(w.net.db.get('pushServer/outbox'), null, 'outbox empty');
  // Phones reached on a later minute are told the truth about how soon it starts.
  const bodies = new Set(w.net.pushes.map((p) => decrypt(w.net, p).payload).filter((p) => p.kind === 'block').map((p) => p.body));
  // (Here the older announcement backlog drains first, so the block alerts
  // go out a few minutes after their moment.)
  assert.ok([...bodies].every((b) => /^Starts at 11:10 AM \(in ([5-9]|10) min\)$/.test(b)), [...bodies].join(' | '));
  assert.ok(![...bodies].includes('Starts at 11:10 AM (in 10 min)'), `a late send is re-worded: ${[...bodies].join(' | ')}`);
});

test('cron keeps its heartbeat even when Firebase is failing', async () => {
  await load();
  const w = scheduleWorld();
  const orig = w.net.db.fetch;
  w.net.db.fetch = async (url, init, h) => (String(url).includes('pushSchedule') ? new Response('{"error":"x"}', { status: 500 }) : orig(url, init, h));
  // The Worker logs the failure (that's what Cloudflare's log view shows);
  // keep it out of the test output, and put it back however the test ends.
  const logged = [];
  const realError = MAIN.console.error;
  MAIN.console.error = (...a) => logged.push(a.join(' '));
  let c;
  try { c = await w.cron(); } finally { MAIN.console.error = realError; }
  assert.equal(logged.length, 2, 'one log line per camp');
  assert.ok(c.used <= 45);
  assert.equal(w.net.db.get('pushServer/cron/junior/lastRun'), NOW);
  assert.equal(w.net.db.get('pushServer/cron/junior/upTo'), null, 'the window does not move on a failed pass');
});
