// A pretend phone for the live alert simulation. It gets a REAL alert address from
// Mozilla's push service (the one Firefox uses, over its WebSocket protocol), holds the
// phone's own encryption keys, and decrypts every alert the camp sender sends
// (RFC 8291 / RFC 8188 aes128gcm) — exactly what a browser does before showing it.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => new Uint8Array(Buffer.from(String(s), 'base64url'));
const hkdf = (salt, ikm, info, len) => new Uint8Array(crypto.hkdfSync('sha256', ikm, salt, info, len));

export function decryptAes128gcm(body, uaPrivate, uaPublic, auth) {
  body = new Uint8Array(body);
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.slice(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.slice(0, ct.length - 16)), d.final()]);
  let end = plain.length - 1; while (end >= 0 && plain[end] === 0) end--;      // strip padding
  if (plain[end] !== 2) throw new Error('bad record delimiter');
  return plain.slice(0, end).toString('utf8');
}

export class Device {
  constructor(name) {
    this.name = name;
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    this.priv = ecdh.getPrivateKey(); this.pub = ecdh.getPublicKey();       // 65-byte uncompressed
    this.auth = crypto.randomBytes(16);
    this.p256dh = b64u(this.pub); this.authB64 = b64u(this.auth);
    this.channelID = crypto.randomUUID();
    this.got = []; this.errors = []; this.waiters = [];
  }
  connect(vapidKey) {
    return new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket('wss://push.services.mozilla.com');
      const t = setTimeout(() => reject(new Error(this.name + ': push service did not answer')), 20000);
      ws.onopen = () => ws.send(JSON.stringify({ messageType: 'hello', use_webpush: true, broadcasts: {} }));
      ws.onerror = (e) => this.errors.push('ws error ' + (e.message || e.type));
      ws.onclose = (e) => { this.closed = e.code; };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.messageType === 'hello') {
          const reg = { messageType: 'register', channelID: this.channelID };
          if (vapidKey) reg.key = vapidKey;                       // like a browser given applicationServerKey
          ws.send(JSON.stringify(reg));
        } else if (m.messageType === 'register') {
          clearTimeout(t);
          if (m.status !== 200) return reject(new Error(this.name + ': register status ' + m.status));
          this.endpoint = m.pushEndpoint; resolve(this);
        } else if (m.messageType === 'notification') {
          ws.send(JSON.stringify({ messageType: 'ack', updates: [{ channelID: m.channelID, version: m.version, code: 100 }] }));
          let text = null, json = null;
          try {
            text = m.data ? decryptAes128gcm(fromB64u(m.data), this.priv, this.pub, this.auth) : '';
            try { json = JSON.parse(text); } catch (e) { /* plain text payload */ }
          } catch (e) { this.errors.push('decrypt: ' + e.message); }
          const rec = { at: Date.now(), text, json };
          this.got.push(rec);
          this.waiters.splice(0).forEach((w) => w(rec));
        } else if (m.messageType === 'ping') {
          ws.send('{}');
        }
      };
    });
  }
  // The shape a browser's PushSubscription.toJSON() gives, for the page stub.
  subscription() { return { endpoint: this.endpoint, keys: { p256dh: this.p256dh, auth: this.authB64 } }; }
  next(ms = 30000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      this.waiters.push((r) => { clearTimeout(t); resolve(r); });
    });
  }
  async close() {
    try { this.ws.send(JSON.stringify({ messageType: 'unregister', channelID: this.channelID })); } catch (e) { /* closing anyway */ }
    await new Promise((r) => setTimeout(r, 300));
    try { this.ws.close(); } catch (e) { /* fine */ }
  }
}
