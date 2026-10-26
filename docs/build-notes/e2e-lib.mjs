// E2E helpers: RTDB-emulator namespace proxy, fake Google JWKS + ID-token minting,
// and a mock push service that VERIFIES the VAPID JWT and DECRYPTS the RFC 8291 body
// with node:crypto (independent of the Worker's WebCrypto implementation).
import http from 'node:http';
import crypto from 'node:crypto';

export const NS = 'camp-89cea-default-rtdb';
export const PROJECT = 'camp-89cea';

export function startNsProxy(port = 9001, target = 9000) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      u.searchParams.set('ns', NS);
      const fwd = http.request({ host: '127.0.0.1', port: target, method: req.method, path: u.pathname + u.search, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers); r.pipe(res);
      });
      fwd.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
      req.pipe(fwd);
    }).listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function makeIdp() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-kid-1';
  const jwk = publicKey.export({ format: 'jwk' });
  const jwks = { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };
  function mint(claims) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid, typ: 'JWT' };
    const body = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: now - 10, iat: now - 5, exp: now + 3600, ...claims };
    const data = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(body));
    const sig = crypto.sign('RSA-SHA256', Buffer.from(data), privateKey);
    return data + '.' + b64u(sig);
  }
  return { jwks, mint };
}

export function startJwks(jwks, port = 8790) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
      res.end(JSON.stringify(jwks));
    }).listen(port, '127.0.0.1', () => resolve(srv));
  });
}

// A fake browser subscription: P-256 key pair + auth secret.
export function makeUa() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, p256dh: b64u(ecdh.getPublicKey()), authB64: b64u(auth) };
}

function hkdf(salt, ikm, info, len) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
}

export function decrypt(ua, body) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = ua.ecdh.computeSecret(asPub);
  const uaPub = ua.ecdh.getPublicKey();
  const ikm = hkdf(ua.auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = pt.length - 1; while (end >= 0 && pt[end] === 0) end--;
  if (pt[end] !== 2) throw new Error('bad padding delimiter ' + pt[end]);
  return { rs, text: pt.subarray(0, end).toString('utf8') };
}

export function verifyVapid(authHeader, expectedAud) {
  const m = /^vapid t=([^,]+),\s*k=(.+)$/.exec(authHeader || '');
  if (!m) throw new Error('bad Authorization header: ' + authHeader);
  const [h, p, s] = m[1].split('.');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(Buffer.from(m[2], 'base64url').subarray(1, 33)), y: b64u(Buffer.from(m[2], 'base64url').subarray(33, 65)) }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(h + '.' + p), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (!ok) throw new Error('VAPID signature invalid');
  if (claims.aud !== expectedAud) throw new Error('aud ' + claims.aud + ' != ' + expectedAud);
  return { claims, key: m[2] };
}

// Mock push service. Endpoint path /p/<name>; per-name behaviour: 'ok' (201) | 'gone' (410) | 'busy' (503).
export function startPushMock(port, uas, behaviour = {}) {
  const got = [];
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const name = req.url.split('/').pop();
        const rec = { name, headers: req.headers, at: Date.now() };
        try {
          rec.vapid = verifyVapid(req.headers.authorization, `http://127.0.0.1:${port}`);
          rec.payload = JSON.parse(decrypt(uas[name], Buffer.concat(chunks)).text);
        } catch (e) { rec.error = String(e.message || e); }
        got.push(rec);
        const b = behaviour[name] || 'ok';
        res.writeHead(b === 'gone' ? 410 : b === 'busy' ? 503 : 201); res.end();
      });
    }).listen(port, '127.0.0.1', () => resolve({ srv, got }));
  });
}
