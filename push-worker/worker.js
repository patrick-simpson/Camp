// ── camp-alerts: the phone-alert sender (Cloudflare Worker) ───────────────
// The camp site is static (GitHub Pages) and Firebase stays on the free Spark
// plan, which has no Cloud Functions — so nothing on our side can wake a
// CLOSED phone. Web Push can, but it needs a server that holds a signing key
// and encrypts each message for each phone. This Worker is that server, on
// Cloudflare's FREE plan (no credit card). It is the only server-side code in
// the project; the setup guide for a non-programmer is README.md beside it.
//
// What it does:
//   • POST /notify  — a signed-in member's phone asks it to fan a chat message,
//                     a director alert, or a test out to everyone it concerns.
//   • every minute  — the Cron Trigger sends "Supper starts in 10 min"
//                     schedule alerts and retries anything that didn't go.
//   • POST /drain, /resubscribe, GET /vapid-key, /health, / — plumbing.
//
// It reads and writes Firebase with ADMIN access (a Google service account),
// which bypasses the security rules — so every request is checked here
// instead: the caller's Firebase ID token is verified, their member record
// must exist, a chat notify must come from the message's real author, alerts
// need the editor role. The rules still protect everything a CLIENT writes;
// `pushServer/` (this Worker's private state) has no client rule at all, so
// the root deny-all covers it.
//
// ── The free plan's limits shape everything below ──
//   • 50 subrequests (fetch() calls) per invocation. We hold ourselves to 45
//     (SUBREQUEST_CAP) and every fetch goes through one counter (ictx.fetch),
//     so a bug can't creep past the limit and get the invocation killed
//     half-way through a send.
//   • 10 ms of CPU per invocation. Encrypting one push costs ~0.15–0.8 ms, so
//     one invocation sends at most PUSH_BATCH (20) phones and parks the rest
//     in an outbox; the client then asks for each parked batch in its own
//     request (POST /drain), each with a fresh 10 ms, and the cron is the
//     backstop for anything nobody drained.
//   • Inside Workers, Date.now() only advances across I/O. It is fine for
//     timestamps and deadlines; never use it to measure CPU.
//
// Runtime: Cloudflare workerd. Web APIs ONLY — fetch, crypto.subtle,
// TextEncoder, atob/btoa, Intl, URL, Response. No npm, no Node built-ins, no
// Buffer/process. One file, so it can be pasted straight into the dashboard's
// code editor. The tests (tests/push-worker.test.js) load this exact file in
// Node 22, which has the same globals, and drive it through `_test` (a
// non-enumerable property on the handler — invisible to the runtime).

// Bump when the Worker changes, so /health and the status page say which copy
// is pasted into Cloudflare.
const VERSION = '2026-10-26.1';

// Camp id → Firebase root. Hardcoded on purpose (camps.js is browser code the
// Worker can't load); the two roots are a contract with database.rules.json.
const CAMPS = { junior: 'campScoreboard', senior: 'seniorScoreboard' };

// The four chat channels — the ids are a contract with the rules and with
// camps.js CHAT_CHANNELS; the short names/emoji are what a notification shows.
const CHANNELS = {
  announcements: { short: 'Announcements', emoji: '📣' },
  general: { short: 'General', emoji: '💬' },
  memes: { short: 'Memes', emoji: '😂' },
  photos: { short: 'Photos', emoji: '📸' },
};

// The test notification's wording, in one place so it's easy to change. One
// line is picked at random per test — rotating camp jokes, the owner's pick
// (2026-10-26). Add or swap lines freely; keep each under ~120 characters so
// it fits a lock-screen preview without being cut off.
const TEST_TITLE = '✅ Phone alerts are working';
const TEST_BODIES = [
  '🐿️ The camp squirrels have inspected this phone and approve.',
  "🔥 This is only a test. The s'mores supply is fine.",
  '🕊️ Message delivered. The carrier pigeons may finally rest.',
  '🦟 Good news: this alert got through. Bad news: so did the mosquitoes.',
  '🛶 Ahoy! Your phone is officially on the camp buzz list.',
  "🍫 Test complete. Nobody touched the counselors' secret snack stash. Probably.",
  '🔦 Flashlight check, bug spray check, phone alerts check.',
  '🎒 This phone has been sorted into Team Gets-The-Alerts.',
  '🌲 A tree fell in the forest, and this time you heard it.',
  '🏕️ Testing, testing… is this thing on? It is! Carry on.',
];

const DEFAULTS = {
  FIREBASE_DB_URL: 'https://camp-89cea-default-rtdb.firebaseio.com',
  FIREBASE_PROJECT_ID: 'camp-89cea',
  ALLOWED_ORIGINS: 'https://camp.patricksimpson.info',
  VAPID_SUBJECT: 'https://camp.patricksimpson.info',
  PUSH_BATCH: 20,
};

const SUBREQUEST_CAP = 45;          // hard ceiling per invocation (the plan allows 50)
const BODY_LIMIT = 16 * 1024;       // request bodies; a real one is a few hundred bytes
const PAYLOAD_LIMIT = 3000;         // bytes of notification JSON before encryption
const RECORD_SIZE = 4096;           // RFC 8188 rs; our one record is always smaller
const TZ = 'America/New_York';      // camp time — every time a person sees is Eastern
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email';

const TTL_CHAT = 6 * 3600;          // a chat message older than this isn't worth buzzing
const TTL_ALERT = 12 * 3600;
const TTL_URGENT = 2 * 3600;        // urgent means NOW; two hours late it's noise
const TTL_TEST = 600;
const RATE_ALERT_MS = 10 * 1000;    // one director alert per sender per 10 s
const RATE_TEST_MS = 5 * 1000;      // one test per sender per 5 s
const MAX_ATTEMPTS = 3;             // a delivery that fails transiently 3 times is dropped
const RETRY_STEP_MS = MINUTE;       // retry n waits n minutes
const CRON_GRACE_MS = 20 * 1000;    // the client drains its own batches; the cron waits this long first
const CRON_RESERVE = 16;            // subrequests the outbox pass leaves for schedule + heartbeat (1 + 2 camps × CRON_CAMP_COST)
const STALE_CHAT_MS = HOUR;         // /notify for an older message is refused (markers get pruned)
const LEADS = [5, 10, 15];          // "how early" choices, minutes before a block
const SENT_KEEP_MS = 3 * DAY;       // chat dedupe markers
const RATE_KEEP_MS = DAY;
const LAST_ERROR_SHOW_MS = 3 * DAY; // how long the status page mentions a push-service refusal

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MSG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const P256DH_RE = /^[A-Za-z0-9_-]{80,100}$/;
const AUTH_RE = /^[A-Za-z0-9_-]{16,32}$/;
const BLOCK_ID_RE = /^[a-z0-9-]{1,40}$/;
const BLOCK_KEY_RE = /^[a-z0-9-]{1,48}$/;
const TEAM_RE = /^t[0-9]$/;
const BATCH_ID_RE = /^[A-Za-z0-9_-]{24,64}$/;
const ALERT_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const WEEK_START_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Characters Realtime Database refuses in a key. Anything headed into a path
// that didn't come out of the database itself is checked against this.
const RTDB_KEY_BAD_RE = /[.#$[\]/\u0000-\u001f\u007f]/;

// ── Small utilities ───────────────────────────────────────────────────────

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function hasOwn(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
function utf8(s) { return ENC.encode(String(s)); }
function utf8Decode(b) { return DEC.decode(b); }

function concatBytes(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function toBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  throw new TypeError('expected bytes');
}

function b64urlEncode(bytes) {
  const b = toBytes(bytes);
  let s = '';
  // Chunked so a large buffer can't blow the argument limit of apply().
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(str)) throw new TypeError('not base64url');
  let s = str.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (s.length % 4 === 1) throw new TypeError('not base64url');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Firebase push-id alphabet, in ASCII order — so ids that start with an
// 8-character time prefix sort by time. Alert ids use it so the client's
// "recent alerts" (orderByKey/limitToLast) comes back newest-last for free;
// outbox batch ids use it so the cron can see a batch's due time from a
// shallow listing without downloading the batch.
const ID_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

function timeKey(ms) {
  let n = Math.max(0, Math.floor(ms));
  let s = '';
  for (let i = 0; i < 8; i++) { s = ID_CHARS.charAt(n % 64) + s; n = Math.floor(n / 64); }
  return s;
}

function timeFromKey(id) {
  if (typeof id !== 'string' || id.length < 8) return NaN;
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const c = ID_CHARS.indexOf(id[i]);
    if (c < 0) return NaN;
    n = n * 64 + c;
  }
  return n;
}

function randomChars(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (let i = 0; i < n; i++) s += ID_CHARS[b[i] & 63];
  return s;
}

// Notification text: control characters out, whitespace tidied, and cut by
// CODE POINT (an emoji is two UTF-16 units; slicing between them leaves a
// broken character on the lock screen). Chat snippets fold to one line;
// director alerts keep their line breaks.
function cleanText(s, keepLines) {
  let t = String(s == null ? '' : s).replace(/\r\n?/g, '\n');
  t = t.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
  if (keepLines) t = t.replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  else t = t.replace(/\s+/g, ' ');
  return t.trim();
}

function clip(s, max, keepLines) {
  const t = cleanText(s, keepLines);
  const cps = Array.from(t);
  return cps.length <= max ? t : cps.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…';
}

// ── Identity (mirrors app.js and database.rules.json exactly) ────────────

// RTDB forbids '.' in keys, so the members list is keyed by the email with
// every dot turned into a comma. replaceAll — the rules' .replace() replaces
// ALL dots, and a first-dot-only version would lock out multi-dot addresses.
function emailKey(email) {
  return String(email || '').trim().toLowerCase().replaceAll('.', ',');
}

function identityFromKey(key) {
  const k = String(key || '');
  return k[0] === '+' ? k : k.replaceAll(',', '.');
}

// Same OR as the rules: a VERIFIED email wins; otherwise a phone number (phone
// accounts are inherently verified); otherwise nobody. An unverified email is
// never an identity — anyone can create a Firebase account claiming any
// address.
function identityKeyFromClaims(c) {
  if (!isObj(c)) return '';
  if (typeof c.email === 'string' && c.email && c.email_verified === true) {
    const k = emailKey(c.email);
    return k && !RTDB_KEY_BAD_RE.test(k) ? k : '';
  }
  if (typeof c.phone_number === 'string' && /^\+[0-9]{4,20}$/.test(c.phone_number)) return c.phone_number;
  return '';
}

// Who a notification says something is FROM. Only the editor-maintained
// member directory is trusted (same rule as chat.js chatAuthorName): the
// `name` a sender's device wrote onto a chat message is never read.
function memberName(members, key) {
  const m = hasOwn(members, key) && isObj(members[key]) ? members[key] : null;
  const n = m && typeof m.name === 'string' ? clip(m.name, 60) : '';
  return n || identityFromKey(key);
}

// ── Device preferences (MUST agree with push.js normalizePushPrefs) ──────
// RTDB prunes false-y shapes (an empty `blocks`, a missing `ch`), so every
// reader heals first. Default-on fields use `!== false`, default-off `=== true`.
function normalizePrefs(raw) {
  const r = isObj(raw) ? raw : {};
  const ch = isObj(r.ch) ? r.ch : {};
  const blocks = {};
  if (isObj(r.blocks)) {
    for (const k of Object.keys(r.blocks)) if (BLOCK_KEY_RE.test(k) && r.blocks[k] === true) blocks[k] = true;
  }
  return {
    ch: {
      announcements: ch.announcements !== false,
      general: ch.general === true,
      memes: ch.memes === true,
      photos: ch.photos === true,
    },
    mention: r.mention !== false,
    director: r.director !== false,
    blocksAll: r.blocksAll === true,
    blocks,
    lead: LEADS.includes(r.lead) ? r.lead : 10,
  };
}

// A device record → the five things a send needs, or null if it can't be a
// real subscription (the rules validate these on write, but a record written
// before a rules change — or by the Worker's own admin hand — gets no such
// check, so nothing is trusted to be well-formed).
function deviceTarget(memberKey, deviceId, rec) {
  if (!isObj(rec) || !DEVICE_ID_RE.test(deviceId)) return null;
  const e = rec.endpoint, p = rec.p256dh, a = rec.auth;
  if (typeof e !== 'string' || !e.startsWith('https://') || e.length > 1024) return null;
  if (typeof p !== 'string' || !P256DH_RE.test(p)) return null;
  if (typeof a !== 'string' || !AUTH_RE.test(a)) return null;
  try { new URL(e); } catch (err) { return null; }
  return { k: memberKey, d: deviceId, e, p, a };
}

// Every device of every CURRENT member. A removed counselor's leftover
// records are skipped here, which is what makes removal take effect at once
// (the hourly tidy-up deletes them later).
function eachDevice(push, members, fn) {
  if (!isObj(push) || !isObj(members)) return;
  for (const memberKey of Object.keys(push)) {
    if (!hasOwn(members, memberKey) || !isObj(members[memberKey])) continue;
    const devices = push[memberKey];
    if (!isObj(devices)) continue;
    for (const deviceId of Object.keys(devices)) {
      const target = deviceTarget(memberKey, deviceId, devices[deviceId]);
      if (target) fn(memberKey, members[memberKey], devices[deviceId], target);
    }
  }
}

// ── Recipient selection (pure; the truth tables live in the tests) ───────

const CHAT_RANK = { announcement: 3, mention: 2, channel: 1 };

// One delivery per DEVICE, never two. Keyed by endpoint rather than record:
// the same browser can be left registered under two people (a shared phone
// whose sign-out cleanup failed), and it should still buzz once — with the
// most important reason.
function chatRecipients({ ch, authorKey, members, push, mentionKeys, mentionTeams }) {
  const keys = new Set(Array.isArray(mentionKeys) ? mentionKeys : []);
  const teams = new Set(Array.isArray(mentionTeams) ? mentionTeams : []);
  const best = new Map(); // endpoint -> { kind, target }
  eachDevice(push, members, (memberKey, member, rec, target) => {
    if (memberKey === authorKey) return;          // never buzz the author about their own message
    const prefs = normalizePrefs(rec.prefs);
    let kind = '';
    if (ch === 'announcements' && prefs.ch.announcements) kind = 'announcement';
    else if (prefs.mention && (keys.has(memberKey)
      || (typeof rec.team === 'string' && TEAM_RE.test(rec.team) && teams.has(rec.team))
      || (typeof member.teamId === 'string' && teams.has(member.teamId)))) kind = 'mention';
    else if (prefs.ch[ch] === true) kind = 'channel';
    if (!kind) return;
    const had = best.get(target.e);
    if (!had || CHAT_RANK[kind] > CHAT_RANK[had.kind]) best.set(target.e, { kind, target });
  });
  const out = { announcement: [], mention: [], channel: [] };
  for (const { kind, target } of best.values()) out[kind].push(target);
  return out;
}

// Director alerts. The sender's own phones are INCLUDED (it confirms the alert
// went out). Urgent ignores the "director alerts" switch — that switch exists
// to mute chatter, not emergencies.
function alertRecipients({ audience, urgent, members, push }) {
  const seen = new Map();
  eachDevice(push, members, (memberKey, member, rec, target) => {
    if (audience === 'editors' && member.role !== 'editor') return;
    if (TEAM_RE.test(audience) && member.teamId !== audience) return;
    if (!urgent && !normalizePrefs(rec.prefs).director) return;
    if (!seen.has(target.e)) seen.set(target.e, target);
  });
  return [...seen.values()];
}

// Schedule alerts: for each (block, lead) that's due, every device whose lead
// is that lead and that wants that block. A device has exactly one lead, so it
// can only ever match one of a block's three due moments.
function blockRecipients({ due, members, push }) {
  const groups = due.map(() => new Map());
  eachDevice(push, members, (memberKey, member, rec, target) => {
    const prefs = normalizePrefs(rec.prefs);
    due.forEach((item, i) => {
      if (prefs.lead !== item.lead) return;
      if (!prefs.blocksAll && !prefs.blocks[item.block.key]) return;
      if (!groups[i].has(target.e)) groups[i].set(target.e, target);
    });
  });
  return groups.map((g) => [...g.values()]);
}

// ── Eastern time ──────────────────────────────────────────────────────────
// Intl formatters are expensive to build (the CPU budget is 10 ms), so one is
// made per isolate and reused. hourCycle h23 so midnight is 00, never 24.
let ET_FORMAT = null;
function etFormatter() {
  if (!ET_FORMAT) {
    ET_FORMAT = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  return ET_FORMAT;
}

function etParts(ms) {
  const o = {};
  for (const p of etFormatter().formatToParts(new Date(ms))) {
    if (p.type !== 'literal') o[p.type] = Number(p.value);
  }
  if (o.hour === 24) o.hour = 0;
  return o; // { year, month, day, hour, minute, second }
}

// How far Eastern wall-clock time is from UTC at `ms` (e.g. −4h in July).
function etOffsetMs(ms) {
  const p = etParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// An Eastern wall-clock time → epoch ms. Guess with EST, then correct with
// the real offset twice: the second pass settles the guesses that straddle a
// DST change. Minutes past 1439 roll into later days (Date.UTC normalizes).
// A wall time that doesn't exist (2:30 AM on spring-forward day) lands an
// hour later; one that happens twice (1:30 AM on fall-back day) picks EST.
function etWallToEpoch(ymd, minutes) {
  const m = WEEK_START_RE.exec(String(ymd));
  if (!m || !Number.isFinite(minutes)) return NaN;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, Math.floor(minutes));
  let t = wall + 5 * HOUR;
  for (let i = 0; i < 2; i++) t = wall - etOffsetMs(t);
  return t;
}

// "5:00 PM" — built from parts rather than Intl's own 12-hour output, which
// puts a narrow no-break space before PM on current ICU versions.
function formatEtTime(ms) {
  const p = etParts(ms);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatEtDateTime(ms) {
  const p = etParts(ms);
  return `${MONTHS[p.month - 1]} ${p.day}, ${formatEtTime(ms)}`;
}

function parseYmd(ymd) {
  const m = WEEK_START_RE.exec(String(ymd));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y, mo, d, t };
}

function addDaysYmd(ymd, n) {
  const p = parseYmd(ymd);
  if (!p) return '';
  return new Date(p.t + n * DAY).toISOString().slice(0, 10);
}

// The camp week's Sunday: a real calendar date AND a Sunday (blocks carry a
// day-of-week counted from it, so any other day would shift every alert).
function isValidWeekStart(s) {
  const p = parseYmd(s);
  return !!p && new Date(p.t).getUTCDay() === 0;
}

// ── Schedule math (pure) ──────────────────────────────────────────────────

// Which slice of time this tick is responsible for. `upTo` is where the last
// tick stopped. The first run ever starts at NOW (it must not backfill alerts
// for blocks that are long gone), a stalled cron catches up at most five
// minutes (an alert that late is worse than none), and the window reaches one
// minute ahead because the cron only ticks once a minute — sending up to a
// minute early beats up to a minute late. A stored upTo far in the future can
// only be corruption; trusting it would silence every alert until then.
function cronWindow(now, upTo) {
  let from = typeof upTo === 'number' && Number.isFinite(upTo) && upTo <= now + 2 * MINUTE ? upTo : now;
  from = Math.max(from, now - 5 * MINUTE);
  const to = now + MINUTE;
  return { from, to, upTo: Math.max(from, to) };
}

function validBlock(id, b) {
  return BLOCK_ID_RE.test(id) && isObj(b)
    && Number.isInteger(b.dow) && b.dow >= 0 && b.dow <= 6
    && Number.isInteger(b.start) && b.start >= 0 && b.start <= 1439
    && typeof b.key === 'string' && BLOCK_KEY_RE.test(b.key);
}

// Every (block, lead) whose alert moment falls in (from, to]. The UTC-only
// prefilter keeps Intl (the expensive part) away from all but the handful of
// blocks within an hour or two of now: Eastern is UTC−4 or −5, so a block's
// true start is within [guess+4h, guess+5h] of its wall time read as UTC.
function dueBlocks(blocks, weekStart, from, to) {
  const out = [];
  const ws = parseYmd(weekStart);
  if (!ws || !isObj(blocks)) return out;
  for (const id of Object.keys(blocks).sort()) {
    const b = blocks[id];
    if (!validBlock(id, b)) continue;
    const guess = ws.t + b.dow * DAY + b.start * MINUTE;
    if (guess + 5 * HOUR - 5 * MINUTE <= from || guess + 4 * HOUR - 15 * MINUTE > to) continue;
    const date = addDaysYmd(weekStart, b.dow);
    const startMs = etWallToEpoch(date, b.start);
    for (const lead of LEADS) {
      const at = startMs - lead * MINUTE;
      if (at > from && at <= to) out.push({ blockId: id, block: b, lead, startMs, date });
    }
  }
  return out;
}

// ── Notification payloads ─────────────────────────────────────────────────
// The JSON inside every encrypted push. sw.js turns it into the notification;
// `tag` is shared with the page's own in-app notifications so an open app and
// a push collapse into ONE notification on the device.
function makePayload(f) {
  const p = {
    v: 1,
    camp: f.camp,
    kind: f.kind,
    title: clip(f.title, 80),
    body: clip(f.body, 300, f.keepLines),
    tag: String(f.tag || '').slice(0, 120),
    ts: Number.isFinite(f.ts) ? Math.floor(f.ts) : 0,
    open: f.open || '',
    urgent: f.urgent === true,
  };
  // The fields are capped well under the limit; this is the belt to those
  // braces — the encrypted record has to fit in one 4096-byte record.
  while (utf8(JSON.stringify(p)).length > PAYLOAD_LIMIT && p.body) {
    p.body = clip(p.body, Math.max(1, Array.from(p.body).length - 40), f.keepLines);
    if (p.body === '…') p.body = '';
  }
  return p;
}

function chatSnippet(msg) {
  const text = clip(msg && msg.text, 140);
  if (text) return text;
  if (msg && (msg.thumb || msg.photoId)) return '📷 Photo';
  return 'New message';
}

function chatPayload({ camp, kind, ch, msgId, msg, name, now }) {
  const info = CHANNELS[ch];
  const snippet = chatSnippet(msg);
  const at = msg && Number.isFinite(msg.at) && msg.at <= now + DAY ? msg.at : now;
  let title, body;
  if (kind === 'announcement') { title = '📣 Announcements'; body = `${name}: ${snippet}`; }
  else if (kind === 'mention') { title = `💬 ${name} mentioned you`; body = snippet; }
  else { title = `${info.emoji} ${info.short}`; body = `${name}: ${snippet}`; }
  return makePayload({ camp, kind, title, body, tag: `chat-${msgId}`, ts: at, open: `chat:${ch}`, urgent: false });
}

function alertPayload({ camp, id, name, text, urgent, now }) {
  return makePayload({
    camp, kind: urgent ? 'urgent' : 'alert',
    title: urgent ? `🚨 URGENT — ${name}` : `📢 ${name}`,
    body: text, keepLines: true, tag: `alert-${id}`, ts: now, open: '', urgent,
  });
}

// "Starts at 5:00 PM (in 10 min)". The minutes shown are the lead the person
// chose unless the alert is genuinely late (a backlog) — then the truth. It
// is worked out again when a parked batch is finally sent (drainBatch), so
// "in 10 min" never arrives seven minutes before the start.
function blockBody(startMs, lead, now) {
  const actual = Math.round((startMs - now) / MINUTE);
  const shown = Math.abs(actual - lead) <= 1 ? lead : actual;
  const when = shown <= 0 ? 'starting now' : `in ${shown} min`;
  return `Starts at ${formatEtTime(startMs)} (${when})`;
}

function blockPayload({ camp, item, now }) {
  const b = item.block;
  const label = typeof b.label === 'string' && b.label.trim() ? b.label : 'Next on the schedule';
  const emoji = typeof b.emoji === 'string' ? b.emoji : '';
  return makePayload({
    camp, kind: 'block', title: `${emoji} ${label}`,
    body: blockBody(item.startMs, item.lead, now),
    tag: `block-${item.blockId}-${item.date}`, ts: now, open: 'schedule', urgent: false,
  });
}

function testPayload({ camp, now }) {
  const body = TEST_BODIES[Math.floor(Math.random() * TEST_BODIES.length)] || TEST_BODIES[0];
  return makePayload({ camp, kind: 'test', title: TEST_TITLE, body, tag: `test-${now}`, ts: now, open: '', urgent: false });
}

function normalizePayload(raw, camp) {
  if (!isObj(raw)) return null;
  const kinds = ['announcement', 'mention', 'channel', 'alert', 'urgent', 'block', 'test'];
  if (!kinds.includes(raw.kind) || typeof raw.title !== 'string' || typeof raw.tag !== 'string') return null;
  return makePayload({
    camp, kind: raw.kind, title: raw.title, body: typeof raw.body === 'string' ? raw.body : '',
    keepLines: true, tag: raw.tag, ts: raw.ts, open: typeof raw.open === 'string' ? raw.open : '',
    urgent: raw.urgent === true,
  });
}

// ── Errors ────────────────────────────────────────────────────────────────
// Every failure a caller can see is an HttpError with a stable code and a
// plain-English message (the app shows the message as a toast).

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// The sender itself isn't set up right. `reason` is for the status page,
// which explains the exact fix; callers only need to know it's not ready.
class ConfigError extends HttpError {
  constructor(reason, message) { super(503, 'not-configured', message); this.reason = reason; }
}

// Ran out of the per-invocation subrequest allowance.
class BudgetError extends HttpError {
  constructor() { super(503, 'busy', 'The alert sender is busy — try again in a minute.'); }
}

// Firebase said no (or couldn't be reached).
class DbError extends HttpError {
  constructor(status, detail) {
    super(502, 'firebase', "The alert sender couldn't reach the camp database. Try again in a minute.");
    this.dbStatus = status;
    this.detail = String(detail || '').slice(0, 200);
  }
}

// ── Configuration ─────────────────────────────────────────────────────────

function isLocalHost(host) {
  return host === '127.0.0.1' || host === 'localhost';
}

function readConfig(env) {
  const e = env || {};
  let db;
  try { db = new URL(String(e.FIREBASE_DB_URL || DEFAULTS.FIREBASE_DB_URL).trim()); } catch (err) { db = new URL(DEFAULTS.FIREBASE_DB_URL); }
  const local = isLocalHost(db.hostname);
  // Plain http is only ever right for the local emulator.
  if (db.protocol !== 'https:' && !(local && db.protocol === 'http:')) db = new URL(DEFAULTS.FIREBASE_DB_URL);
  const subject = String(e.VAPID_SUBJECT || '').trim();
  const batch = Math.floor(Number(e.PUSH_BATCH));
  return {
    dbBase: db.origin + db.pathname.replace(/\/+$/, ''),
    // The emulator addresses a namespace by query string (?ns=…); keep it on every request.
    dbParams: [...db.searchParams.entries()],
    local,
    projectId: String(e.FIREBASE_PROJECT_ID || DEFAULTS.FIREBASE_PROJECT_ID).trim(),
    origins: String(e.ALLOWED_ORIGINS || DEFAULTS.ALLOWED_ORIGINS).split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    vapidSubject: /^(https:|mailto:)/.test(subject) ? subject : DEFAULTS.VAPID_SUBJECT,
    pushBatch: Number.isFinite(batch) ? Math.min(40, Math.max(1, batch)) : DEFAULTS.PUSH_BATCH,
    serviceAccount: e.FIREBASE_SERVICE_ACCOUNT,
    // TEST-ONLY overrides. Honored only against a database on this machine, so
    // a stray variable in production can never swap the admin credential or
    // the keys that sign-ins are checked against.
    adminToken: local && e.DB_ADMIN_TOKEN ? String(e.DB_ADMIN_TOKEN) : '',
    jwksUrl: local && e.JWKS_URL ? String(e.JWKS_URL) : GOOGLE_JWKS_URL,
  };
}

// ── One invocation ────────────────────────────────────────────────────────
// Everything an invocation needs travels in `ictx`: config, the subrequest
// counter, the send allowance, per-invocation memos. `deps` lets the tests
// substitute fetch, the clock and the isolate cache without touching globals.

// What survives between requests in one isolate (Cloudflare recycles
// isolates freely, so every entry is an optimization, never a requirement).
// Only plain values and CryptoKeys live here — a promise or Response made
// while serving one request can't be safely awaited by another.
function newCache() {
  return { oauth: null, saKey: null, jwks: null, vapid: null, vapidJwt: new Map() };
}
const ISOLATE_CACHE = newCache();

function makeInvocation(env, deps) {
  const d = deps || {};
  const cfg = readConfig(env);
  const rawFetch = d.fetch || ((url, init) => fetch(url, init));
  const ictx = {
    cfg,
    cache: d.cache || ISOLATE_CACHE,
    now: d.now || (() => Date.now()),
    used: 0,
    cap: SUBREQUEST_CAP,
    sendsLeft: cfg.pushBatch,
    memo: { members: {}, memberKeys: {}, push: {} },
    // THE door every network call goes through. The count is taken at call
    // time, synchronously, so parallel sends can't race past the cap.
    fetch(url, init) {
      if (ictx.used >= ictx.cap) return Promise.reject(new BudgetError());
      ictx.used++;
      try { return Promise.resolve(rawFetch(url, init)); } catch (e) { return Promise.reject(e); }
    },
    left() { return ictx.cap - ictx.used; },
  };
  return ictx;
}

// ── Google service account → admin access token ──────────────────────────

function parseServiceAccount(raw, cfg) {
  if (raw == null || !String(raw).trim()) {
    throw new ConfigError('secret-missing', 'The FIREBASE_SERVICE_ACCOUNT secret has not been added to the Worker yet.');
  }
  let sa;
  try { sa = JSON.parse(String(raw)); } catch (e) {
    throw new ConfigError('secret-unparsable', "The FIREBASE_SERVICE_ACCOUNT secret isn't a complete key file.");
  }
  if (!isObj(sa) || typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string'
      || !/BEGIN PRIVATE KEY/.test(sa.private_key)) {
    throw new ConfigError('secret-incomplete', 'The FIREBASE_SERVICE_ACCOUNT secret is missing its client_email or private_key.');
  }
  if (typeof sa.project_id === 'string' && sa.project_id && cfg && sa.project_id !== cfg.projectId) {
    const err = new ConfigError('wrong-project', `The key belongs to the Firebase project "${sa.project_id}", but this sender works with "${cfg.projectId}".`);
    err.project = sa.project_id;
    throw err;
  }
  const tokenUri = typeof sa.token_uri === 'string' && sa.token_uri.startsWith('https://') ? sa.token_uri : GOOGLE_TOKEN_URI;
  return {
    email: sa.client_email,
    // A key pasted with its "\n"s still escaped is the commonest paste accident.
    pem: sa.private_key.replace(/\\n/g, '\n'),
    tokenUri,
    id: (typeof sa.private_key_id === 'string' && sa.private_key_id) || sa.client_email,
  };
}

function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signJwt(header, claims, key, algorithm) {
  const input = b64urlEncode(utf8(JSON.stringify(header))) + '.' + b64urlEncode(utf8(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign(algorithm, key, utf8(input));
  return input + '.' + b64urlEncode(new Uint8Array(sig));
}

async function adminToken(ictx) {
  if (ictx.cfg.adminToken) return ictx.cfg.adminToken;
  if (!ictx.tokenPromise) {
    ictx.tokenPromise = mintAdminToken(ictx);
    // A failed mint must not stick: the next caller in this invocation retries.
    ictx.tokenPromise.catch(() => { ictx.tokenPromise = null; });
  }
  return ictx.tokenPromise;
}

async function mintAdminToken(ictx) {
  const sa = parseServiceAccount(ictx.cfg.serviceAccount, ictx.cfg);
  const now = ictx.now();
  const hit = ictx.cache.oauth;
  if (hit && hit.id === sa.id && hit.exp > now) return hit.token;

  let key = ictx.cache.saKey && ictx.cache.saKey.id === sa.id ? ictx.cache.saKey.key : null;
  if (!key) {
    try {
      key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    } catch (e) {
      throw new ConfigError('secret-bad-key', "The private key inside FIREBASE_SERVICE_ACCOUNT couldn't be read.");
    }
    ictx.cache.saKey = { id: sa.id, key };
  }
  const iat = Math.floor(now / 1000);
  const assertion = await signJwt({ alg: 'RS256', typ: 'JWT' },
    { iss: sa.email, scope: OAUTH_SCOPE, aud: sa.tokenUri, iat, exp: iat + 3600 }, key, 'RSASSA-PKCS1-v1_5');

  let res;
  try {
    res = await ictx.fetch(sa.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + assertion,
    });
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    const err = new HttpError(503, 'unavailable', "The alert sender couldn't reach Google just now. Try again in a minute.");
    err.reason = 'google-unreachable';
    throw err;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body.access_token !== 'string') {
    const why = body && (body.error_description || body.error) ? String(body.error_description || body.error).slice(0, 160) : `HTTP ${res.status}`;
    if (res.status >= 500) {
      const err = new HttpError(503, 'unavailable', "Google's sign-in service is having trouble. Try again in a minute.");
      err.reason = 'google-unreachable';
      throw err;
    }
    const err = new ConfigError('google-refused', `Google refused the service-account key (${why}).`);
    err.why = why;
    throw err;
  }
  const life = Number(body.expires_in) > 600 ? Number(body.expires_in) : 3600;
  // Refresh five minutes early so a token never expires between our check and Firebase's.
  ictx.cache.oauth = { id: sa.id, token: body.access_token, exp: now + (life - 300) * 1000 };
  return body.access_token;
}

// ── Realtime Database over REST ───────────────────────────────────────────

function dbUrl(cfg, path, query) {
  const segs = String(path).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const u = new URL(cfg.dbBase + '/' + segs + '.json');
  for (const [k, v] of cfg.dbParams) u.searchParams.set(k, v);
  if (query) for (const k of Object.keys(query)) u.searchParams.set(k, query[k]);
  return u.toString();
}

// One request. `etag: true` asks for the value's ETag (conditional writes);
// `ifMatch` makes a PUT/DELETE conditional — 412 means another writer got
// there first, which callers treat as "lost the race", not as an error.
async function dbRequest(ictx, method, path, opts) {
  const o = opts || {};
  const headers = { Authorization: 'Bearer ' + await adminToken(ictx) };
  if (o.etag) headers['X-Firebase-ETag'] = 'true';
  if (o.ifMatch) headers['if-match'] = o.ifMatch;
  let body;
  if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body); }
  let res;
  try {
    res = await ictx.fetch(dbUrl(ictx.cfg, path, o.query), { method, headers, body });
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    throw new DbError(0, e && e.message);
  }
  if (res.status === 412 && o.ifMatch) {
    await res.text().catch(() => '');
    return { conflict: true, value: undefined, etag: res.headers.get('ETag') };
  }
  if (!res.ok) throw new DbError(res.status, await res.text().catch(() => ''));
  // Without the ETag a conditional write can't be made safely. Refuse loudly
  // rather than guess: a made-up ETag would read as "someone else won" and
  // silently drop a send.
  if (o.etag && !res.headers.get('ETag')) { await res.text().catch(() => ''); throw new DbError(res.status, 'response had no ETag'); }
  const text = await res.text();
  let value = null;
  if (text) { try { value = JSON.parse(text); } catch (e) { throw new DbError(res.status, 'unreadable response'); } }
  return { conflict: false, value, etag: res.headers.get('ETag') };
}

async function dbGet(ictx, path, query) { return (await dbRequest(ictx, 'GET', path, { query })).value; }
async function dbGetTagged(ictx, path) { return dbRequest(ictx, 'GET', path, { etag: true }); }
async function dbPut(ictx, path, body, ifMatch) { return dbRequest(ictx, 'PUT', path, { body, ifMatch, query: ifMatch ? undefined : { print: 'silent' } }); }
async function dbPatch(ictx, path, body) { return dbRequest(ictx, 'PATCH', path, { body, query: { print: 'silent' } }); }
async function dbDelete(ictx, path, ifMatch) { return dbRequest(ictx, 'DELETE', path, { ifMatch }); }

// Create-if-absent, atomically: read with an ETag, write only if that ETag
// still holds. True if WE created it.
async function claimMarker(ictx, path, value) {
  const { value: had, etag } = await dbGetTagged(ictx, path);
  if (had != null) return false;
  const r = await dbPut(ictx, path, value, etag);
  return !r.conflict;
}

// Per-invocation memos: /notify, the outbox and the schedule pass can all
// want the same camp's member list or device records; read each once.
async function campMembers(ictx, camp) {
  if (!hasOwn(ictx.memo.members, camp)) {
    const v = await dbGet(ictx, `${CAMPS[camp]}/members`);
    ictx.memo.members[camp] = isObj(v) ? v : {};
  }
  return ictx.memo.members[camp];
}

async function campMemberKeys(ictx, camp) {
  if (hasOwn(ictx.memo.members, camp)) return new Set(Object.keys(ictx.memo.members[camp]));
  if (!hasOwn(ictx.memo.memberKeys, camp)) {
    const v = await dbGet(ictx, `${CAMPS[camp]}/members`, { shallow: 'true' });
    ictx.memo.memberKeys[camp] = new Set(isObj(v) ? Object.keys(v) : []);
  }
  return ictx.memo.memberKeys[camp];
}

async function campPush(ictx, camp) {
  if (!hasOwn(ictx.memo.push, camp)) {
    const v = await dbGet(ictx, `${CAMPS[camp]}/push`);
    ictx.memo.push[camp] = isObj(v) ? v : {};
  }
  return ictx.memo.push[camp];
}

// ── Caller authentication (Firebase ID tokens) ───────────────────────────
// The client sends `Authorization: Bearer <firebase.auth().currentUser.getIdToken()>`.
// Checked against Google's published signing keys, exactly as the Admin SDK would.

function parseMaxAge(cc) {
  const m = /max-age=(\d+)/.exec(String(cc || ''));
  const s = m ? Number(m[1]) : 3600;
  return Math.min(6 * 3600, Math.max(60, s));
}

async function fetchJwks(ictx) {
  const unavailable = () => new HttpError(503, 'unavailable', "The alert sender couldn't check your sign-in just now. Try again in a minute.");
  let res;
  try { res = await ictx.fetch(ictx.cfg.jwksUrl, { headers: { Accept: 'application/json' } }); } catch (e) {
    if (e instanceof BudgetError) throw e;
    throw unavailable();
  }
  if (!res.ok) { await res.text().catch(() => ''); throw unavailable(); }
  const body = await res.json().catch(() => null);
  const keys = new Map();
  for (const k of body && Array.isArray(body.keys) ? body.keys : []) {
    if (!isObj(k) || k.kty !== 'RSA' || typeof k.kid !== 'string' || typeof k.n !== 'string' || typeof k.e !== 'string') continue;
    if (k.alg && k.alg !== 'RS256') continue;
    try {
      keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    } catch (e) { /* one malformed key must not lose the others */ }
  }
  const now = ictx.now();
  return { keys, fetchedAt: now, exp: now + parseMaxAge(res.headers.get('Cache-Control')) * 1000 };
}

// An unknown `kid` usually means Google rotated keys since we cached them, so
// it triggers one refetch — but at most once per invocation and once a
// minute per isolate, so a stream of forged kids can't become a stream of
// requests to Google (or burn our subrequest budget).
async function jwksKey(ictx, kid) {
  const now = ictx.now();
  const set = ictx.cache.jwks;
  const fresh = !!set && set.exp > now;
  if (fresh && set.keys.has(kid)) return set.keys.get(kid);
  if (fresh && (ictx.jwksRefetched || now - set.fetchedAt < MINUTE)) return null;
  ictx.jwksRefetched = true;
  const next = await fetchJwks(ictx);
  ictx.cache.jwks = next;
  return next.keys.get(kid) || null;
}

async function verifyIdToken(ictx, token) {
  const bad = (why) => {
    const e = new HttpError(401, 'bad-token', 'Your sign-in has expired or is invalid — reload the app (or sign out and back in) and try again.');
    e.why = why;
    return e;
  };
  if (typeof token !== 'string' || token.length > 8192) throw bad('shape');
  const parts = token.split('.');
  if (parts.length !== 3) throw bad('shape');
  let header, claims, sig;
  try {
    header = JSON.parse(utf8Decode(b64urlDecode(parts[0])));
    claims = JSON.parse(utf8Decode(b64urlDecode(parts[1])));
    sig = b64urlDecode(parts[2]);
  } catch (e) { throw bad('decode'); }
  // Only RS256: "alg":"none" and HS256-with-the-public-key are the classic
  // forgeries, and both die here before any key is looked at.
  if (!isObj(header) || header.alg !== 'RS256') throw bad('alg');
  if (typeof header.kid !== 'string' || !header.kid) throw bad('kid');
  const key = await jwksKey(ictx, header.kid);
  if (!key) throw bad('kid');
  let ok = false;
  try { ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, utf8(parts[0] + '.' + parts[1])); } catch (e) { ok = false; }
  if (!ok) throw bad('signature');
  const now = Math.floor(ictx.now() / 1000);
  const project = ictx.cfg.projectId;
  if (!isObj(claims)) throw bad('claims');
  if (claims.aud !== project) throw bad('aud');
  if (claims.iss !== 'https://securetoken.google.com/' + project) throw bad('iss');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw bad('exp');
  if (typeof claims.iat !== 'number' || claims.iat > now + 300) throw bad('iat');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw bad('sub');
  if (typeof claims.auth_time !== 'number' || claims.auth_time > now + 300) throw bad('auth_time');
  return claims;
}

// Token → identity key → member record. Returns everything the routes need.
async function authenticate(ictx, request, camp) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'no-auth', 'Sign in to the camp app first, then try again.');
  const claims = await verifyIdToken(ictx, m[1]);
  const key = identityKeyFromClaims(claims);
  if (!key) throw new HttpError(401, 'no-identity', "Your sign-in doesn't include a verified email or phone number.");
  const members = await campMembers(ictx, camp);
  if (!hasOwn(members, key) || !isObj(members[key])) {
    throw new HttpError(403, 'not-member', "You're not on this camp's list of people who can sign in.");
  }
  return { key, member: members[key], members };
}

// ── VAPID: the sender's own signing key ──────────────────────────────────
// Push services only accept messages signed by the key a phone subscribed
// with, so this pair is made ONCE and kept forever in pushServer/vapid.
// Regenerating it would silently orphan every phone's subscription.

async function importVapid(rec) {
  const corrupt = () => new ConfigError('vapid-corrupt', 'The saved sender key in Firebase (pushServer/vapid) is damaged.');
  if (!isObj(rec) || typeof rec.publicKey !== 'string' || !isObj(rec.privateJwk)) throw corrupt();
  let raw;
  try { raw = b64urlDecode(rec.publicKey); } catch (e) { throw corrupt(); }
  const j = rec.privateJwk;
  if (raw.length !== 65 || raw[0] !== 4 || j.kty !== 'EC' || j.crv !== 'P-256'
      || typeof j.d !== 'string' || j.x !== b64urlEncode(raw.subarray(1, 33)) || j.y !== b64urlEncode(raw.subarray(33))) {
    throw corrupt();
  }
  try {
    const privateKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, d: j.d, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { publicKey: rec.publicKey, privateKey };
  } catch (e) { throw corrupt(); }
}

async function ensureVapid(ictx) {
  if (ictx.cache.vapid) return ictx.cache.vapid;
  if (!ictx.vapidPromise) {
    ictx.vapidPromise = loadOrCreateVapid(ictx);
    ictx.vapidPromise.catch(() => { ictx.vapidPromise = null; });
  }
  return ictx.vapidPromise;
}

async function loadOrCreateVapid(ictx) {
  const { value, etag } = await dbGetTagged(ictx, 'pushServer/vapid');
  let rec = value;
  if (rec == null) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const mine = { publicKey: b64urlEncode(raw), privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, createdAt: ictx.now() };
    // Conditional on the location still being empty: two cold isolates racing
    // here must end up agreeing on ONE key, so the loser adopts the winner's.
    const put = await dbPut(ictx, 'pushServer/vapid', mine, etag);
    rec = put.conflict ? await dbGet(ictx, 'pushServer/vapid') : mine;
  }
  const v = await importVapid(rec);
  ictx.cache.vapid = v;
  return v;
}

// One JWT per push-service origin, reused for 11 of its 12 hours: signing is
// CPU we'd otherwise spend per phone. Sends run in parallel, so twenty phones
// on the same service would all miss the cache at once and sign twenty times;
// the in-flight signature is shared within the invocation to stop that.
function vapidAuthorization(ictx, vapid, audience) {
  const ck = audience + '|' + vapid.publicKey;
  const hit = ictx.cache.vapidJwt.get(ck);
  if (hit && hit.exp - HOUR > ictx.now()) return Promise.resolve(hit.header);
  if (!ictx.jwtPending) ictx.jwtPending = new Map();
  if (!ictx.jwtPending.has(ck)) {
    const p = signVapidJwt(ictx, vapid, audience, ck);
    ictx.jwtPending.set(ck, p);
    p.then(() => ictx.jwtPending.delete(ck), () => ictx.jwtPending.delete(ck));
  }
  return ictx.jwtPending.get(ck);
}

async function signVapidJwt(ictx, vapid, audience, ck) {
  const now = ictx.now();
  const exp = Math.floor(now / 1000) + 12 * 3600;
  const jwt = await signJwt({ typ: 'JWT', alg: 'ES256' }, { aud: audience, exp, sub: ictx.cfg.vapidSubject },
    vapid.privateKey, { name: 'ECDSA', hash: 'SHA-256' });
  const header = `vapid t=${jwt}, k=${vapid.publicKey}`;
  if (ictx.cache.vapidJwt.size > 50) ictx.cache.vapidJwt.clear();
  ictx.cache.vapidJwt.set(ck, { header, exp: exp * 1000 });
  return header;
}

// ── Web Push encryption (RFC 8291 + RFC 8188 aes128gcm, one record) ──────

// One ephemeral ECDH key pair per invocation, shared by its recipients. Safe:
// each recipient's shared secret differs (their key differs), and a fresh
// random salt per message makes every content key unique anyway. It saves a
// key generation per phone out of the 10 ms budget.
async function ephemeralKey(ictx) {
  if (!ictx.ephemeral) {
    ictx.ephemeral = (async () => {
      const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      return { privateKey: kp.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    })();
  }
  return ictx.ephemeral;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

async function encryptPayload(plaintext, p256dh, authSecret, eph, saltIn) {
  const uaPublic = b64urlDecode(p256dh);
  const auth = b64urlDecode(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || auth.length !== 16) throw new TypeError('bad subscription keys');
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, concatBytes(utf8('WebPush: info\0'), uaPublic, eph.publicRaw), 32);
  const salt = saltIn ? toBytes(saltIn) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 = "last record" delimiter; no padding.
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concatBytes(toBytes(plaintext), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, RECORD_SIZE, false);
  head[20] = eph.publicRaw.length;
  return concatBytes(head, eph.publicRaw, ct);
}

// ── Sending, the outbox, and retries ─────────────────────────────────────
// A "job" is one payload to many devices: { payload, ttl, urgency, created,
// attempts, alert?, targets: [{k,d,e,p,a}] }. `created` is when the message
// was made (TTL counts from it, across retries); `attempts` is how many times
// these targets have already failed transiently.

function newTally() { return { sent: 0, failed: 0, removed: 0, queued: 0, batches: [], errors: [], unhandled: 0 }; }

function addTally(into, t) {
  into.sent += t.sent; into.failed += t.failed; into.removed += t.removed; into.queued += t.queued;
  into.unhandled += t.unhandled;
  into.batches.push(...t.batches); into.errors.push(...t.errors);
  return into;
}

function tallyBody(t, extra) {
  const body = { ok: true, sent: t.sent, failed: t.failed + t.unhandled, removed: t.removed, queued: t.queued, batches: t.batches.slice() };
  const seen = new Set();
  const errors = [];
  for (const e of t.errors) {
    const k = e.status + '|' + e.host;
    if (!seen.has(k) && errors.length < 10) { seen.add(k); errors.push({ status: e.status, host: e.host }); }
  }
  if (errors.length) body.errors = errors;
  return Object.assign(body, extra || {});
}

function ttlLeft(job, now) {
  return Math.floor(job.ttl - (now - job.created) / 1000);
}

function classifyPushStatus(status) {
  if (status === 200 || status === 201 || status === 202) return 'ok';
  if (status === 404 || status === 410) return 'dead';         // the phone unsubscribed / reinstalled
  if (status === 429 || status >= 500) return 'transient';
  return 'permanent';                                          // 400/401/403/413…: this message will never go
}

// Cut jobs into outbox batches of ≤ size targets each. Ids start with the
// batch's due time (see timeKey) and carry 24 random characters after it —
// the id doubles as the capability for POST /drain, so it must be unguessable.
function packBatches(camp, jobs, size, due) {
  const out = [];
  for (const job of jobs) {
    for (let i = 0; i < job.targets.length; i += size) {
      const batch = {
        camp, due, created: job.created, attempts: job.attempts, payload: job.payload,
        ttl: job.ttl, urgency: job.urgency, targets: job.targets.slice(i, i + size),
      };
      if (job.alert) batch.alert = job.alert;
      if (job.block) batch.block = job.block;
      out.push({ id: timeKey(due) + randomChars(24), batch });
    }
  }
  return out;
}

async function writeOutbox(ictx, packed) {
  const patch = {};
  for (const { id, batch } of packed) patch[id] = batch;
  await dbPatch(ictx, 'pushServer/outbox', patch);
}

// Group flat {job, t} items back into jobs (with `attempts` adjusted).
function regroup(items, attemptsDelta) {
  const by = new Map();
  for (const it of items) {
    let j = by.get(it.job);
    if (!j) { j = Object.assign({}, it.job, { attempts: it.job.attempts + attemptsDelta, targets: [] }); by.set(it.job, j); }
    j.targets.push(it.t);
  }
  return [...by.values()];
}

async function sendOne(ictx, vapid, eph, it, now, plain) {
  const { job, t } = it;
  let url;
  try { url = new URL(t.e); } catch (e) { return { it, outcome: 'permanent', status: 0, host: 'invalid-endpoint' }; }
  const host = url.host;
  let body;
  try {
    body = await encryptPayload(plain, t.p, t.a, eph);
  } catch (e) {
    // Malformed subscription keys: no retry will ever fix this message.
    return { it, outcome: 'permanent', status: 0, host };
  }
  try {
    const authorization = await vapidAuthorization(ictx, vapid, url.origin);
    const res = await ictx.fetch(t.e, {
      method: 'POST',
      headers: {
        TTL: String(Math.max(0, ttlLeft(job, now))),
        Urgency: job.urgency === 'high' ? 'high' : 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: authorization,
      },
      body,
    });
    // Read (and so release) the body: an unread response holds its
    // connection open, and Workers allow only six at a time.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    return { it, outcome: classifyPushStatus(res.status), status: res.status, host, detail };
  } catch (e) {
    return { it, outcome: 'transient', status: 0, host };
  }
}

// Remove a dead subscription — but only if the record still holds the
// endpoint that failed. Between our send and now, the phone may have
// re-subscribed (new endpoint, same device record); deleting that would turn
// its alerts off. ETag-conditional, so the check and the delete are one act.
async function removeDeadDevice(ictx, camp, t) {
  const path = `${CAMPS[camp]}/push/${t.k}/${t.d}`;
  const { value, etag } = await dbGetTagged(ictx, path);
  if (!isObj(value) || value.endpoint !== t.e) return false;
  const r = await dbDelete(ictx, path, etag);
  return !r.conflict;
}

// Send what this invocation can afford inline; park the rest in the outbox.
// `opts.keep` = subrequests the CALLER still needs afterwards (an alert's
// count update, the cron's heartbeat). Never throws for a delivery problem —
// those are counted — only for budget/config trouble before anything went.
async function deliverJobs(ictx, camp, jobs, opts) {
  const keep = (opts && opts.keep) || 0;
  const tally = newTally();
  const now = ictx.now();

  // Anything that has outlived its TTL isn't sent at all: "Supper in 10 min"
  // an hour after supper is worse than silence.
  const items = [];
  for (const job of jobs) {
    if (!job.targets.length) continue;
    if (ttlLeft(job, now) <= 0) { tally.failed += job.targets.length; continue; }
    for (const t of job.targets) items.push({ job, t });
  }
  if (!items.length) return tally;

  const vapid = await ensureVapid(ictx);

  // Inline sends get whatever budget is left after: what the caller keeps,
  // one write to re-queue transient failures, and — only if not everything
  // fits — one write to park the overflow.
  let n = Math.min(items.length, ictx.sendsLeft, Math.max(0, ictx.left() - keep - 1));
  if (n < items.length) n = Math.min(items.length, ictx.sendsLeft, Math.max(0, ictx.left() - keep - 2));
  const inline = items.slice(0, n);
  const overflow = items.slice(n);

  // Park the overflow FIRST: if this invocation then dies mid-send (CPU), the
  // rest is already safe in the outbox.
  if (overflow.length) {
    if (ictx.left() - keep >= 1) {
      const packed = packBatches(camp, regroup(overflow, 0), ictx.cfg.pushBatch, now);
      try {
        await writeOutbox(ictx, packed);
        tally.queued += overflow.length;
        for (const p of packed) tally.batches.push(p.id);
      } catch (e) {
        if (!(e instanceof BudgetError)) console.error('camp-alerts: outbox write failed', e && e.message);
        tally.unhandled += overflow.length;
      }
    } else {
      tally.unhandled += overflow.length;
    }
  }
  if (!inline.length) return tally;

  const eph = await ephemeralKey(ictx);
  const plain = new Map();
  for (const job of jobs) plain.set(job, utf8(JSON.stringify(job.payload)));
  ictx.sendsLeft -= inline.length;
  const outcomes = await Promise.all(inline.map((it) => sendOne(ictx, vapid, eph, it, now, plain.get(it.job))));

  const dead = [], retry = [], refused = [];
  for (const o of outcomes) {
    if (o.outcome === 'ok') tally.sent++;
    else if (o.outcome === 'dead') { tally.failed++; dead.push(o.it.t); }
    else if (o.outcome === 'transient') retry.push(o.it);
    else { tally.failed++; tally.errors.push({ status: o.status, host: o.host }); refused.push(o); }
  }

  // Transient trouble (429, 5xx, network): try again later with backoff,
  // three strikes and out. Uses the write reserved above.
  if (retry.length) {
    const again = retry.filter((it) => it.job.attempts + 1 < MAX_ATTEMPTS);
    tally.failed += retry.length - again.length;
    if (again.length) {
      const jobsAgain = regroup(again, 1);
      const packed = [];
      for (const j of jobsAgain) packed.push(...packBatches(camp, [j], ictx.cfg.pushBatch, now + RETRY_STEP_MS * j.attempts));
      try {
        if (ictx.left() - keep < 1) throw new BudgetError();
        await writeOutbox(ictx, packed);
        tally.queued += again.length;
      } catch (e) {
        if (!(e instanceof BudgetError)) console.error('camp-alerts: retry write failed', e && e.message);
        tally.failed += again.length;
      }
    }
  }

  // Tidy dead subscriptions with what's left (two subrequests each). If the
  // budget is short we simply skip — the next send to that phone retries it.
  const pairs = Math.max(0, Math.floor((ictx.left() - keep) / 2));
  await Promise.all(dead.slice(0, pairs).map((t) => removeDeadDevice(ictx, camp, t)
    .then((ok) => { if (ok) tally.removed++; })
    .catch((e) => { if (!(e instanceof BudgetError)) console.warn('camp-alerts: cleanup failed', e && e.message); })));

  // A push service refusing outright (403 from Apple is nearly always a
  // VAPID problem) is recorded so the status page can say so in plain words.
  if (refused.length && ictx.left() - keep >= 1) {
    const r = refused[0];
    const reason = cleanText(r.detail || '').slice(0, 160);
    await dbPut(ictx, 'pushServer/lastError', { at: now, status: r.status, host: r.host, reason }).catch(() => {});
  }
  return tally;
}

// An alert's audit record counts phones as deliveries finish — inline ones
// now, drained batches later. Server-side increments, so concurrent drains
// can't lose each other's counts.
async function bumpAlertCounts(ictx, camp, alertId, tally) {
  const failed = tally.failed + tally.unhandled;
  if (!alertId || (!tally.sent && !failed)) return;
  const patch = {};
  if (tally.sent) patch.sent = { '.sv': { increment: tally.sent } };
  if (failed) patch.failed = { '.sv': { increment: failed } };
  try { await dbPatch(ictx, `${CAMPS[camp]}/pushAlerts/${alertId}`, patch); } catch (e) {
    if (!(e instanceof BudgetError)) console.warn('camp-alerts: alert count update failed', e && e.message);
  }
}

function normalizeBatch(raw) {
  if (!isObj(raw) || !hasOwn(CAMPS, raw.camp)) return null;
  const list = Array.isArray(raw.targets) ? raw.targets : isObj(raw.targets) ? Object.values(raw.targets) : [];
  const targets = list.filter((t) => isObj(t) && typeof t.k === 'string' && t.k && !RTDB_KEY_BAD_RE.test(t.k)
    && typeof t.d === 'string' && DEVICE_ID_RE.test(t.d))
    .map((t) => ({ k: t.k, d: t.d, e: String(t.e || ''), p: String(t.p || ''), a: String(t.a || '') }));
  const payload = normalizePayload(raw.payload, raw.camp);
  if (!targets.length || !payload) return null;
  const num = (v, dflt) => (Number.isFinite(v) ? v : dflt);
  return {
    camp: raw.camp,
    due: num(raw.due, 0),
    created: num(raw.created, 0),
    attempts: Math.min(MAX_ATTEMPTS, Math.max(0, Math.floor(num(raw.attempts, 0)))),
    payload,
    ttl: Math.min(28 * 86400, Math.max(0, Math.floor(num(raw.ttl, TTL_CHAT)))),
    urgency: raw.urgency === 'high' ? 'high' : 'normal',
    alert: typeof raw.alert === 'string' && ALERT_ID_RE.test(raw.alert) ? raw.alert : '',
    block: isObj(raw.block) && Number.isFinite(raw.block.startMs) && LEADS.includes(raw.block.lead)
      ? { startMs: raw.block.startMs, lead: raw.block.lead } : null,
    targets,
  };
}

// Claim and send one outbox batch. The claim is a conditional DELETE: only
// one of (the client's /drain, a second /drain, the cron) can win it, so a
// batch is never sent twice. The price is at-most-once — if the invocation
// dies after claiming, those phones miss that one notification. For
// notifications that's the right trade: a missed buzz beats a double one.
async function drainBatch(ictx, id, keepAfter) {
  const path = `pushServer/outbox/${id}`;
  const { value, etag } = await dbGetTagged(ictx, path);
  if (value == null) return { found: false };
  const batch = normalizeBatch(value);
  if (!batch) {
    // Unreadable (a hand edit, a format from a future version): discard it
    // rather than trip over it every minute forever.
    await dbDelete(ictx, path, etag).catch(() => {});
    return { found: true, claimed: false, invalid: true };
  }
  const now = ictx.now();
  if (batch.due > now + 5000) return { found: true, claimed: false, early: true };

  // Read who is still a member and where their phones are NOW, before
  // claiming (a failed read then leaves the batch for the next try). A target
  // whose person was removed, or whose phone turned alerts off, is dropped;
  // one whose phone re-subscribed is sent to its NEW endpoint.
  const expired = ttlLeft(batch, now) <= 0;
  let targets = [];
  if (!expired) {
    const keys = await campMemberKeys(ictx, batch.camp);
    const push = await campPush(ictx, batch.camp);
    const seen = new Set();
    for (const t of batch.targets) {
      if (!keys.has(t.k) || !isObj(push[t.k])) continue;
      const fresh = deviceTarget(t.k, t.d, push[t.k][t.d]);
      if (fresh && !seen.has(fresh.e)) { seen.add(fresh.e); targets.push(fresh); }
    }
  }

  // Load the signing key before claiming too: a config problem found after
  // the claim would lose the batch.
  if (!expired && targets.length) await ensureVapid(ictx);

  const claim = await dbDelete(ictx, path, etag);
  if (claim.conflict) return { found: true, claimed: false };

  let tally = newTally();
  if (expired) tally.failed += batch.targets.length;
  else {
    const payload = batch.block && batch.payload.kind === 'block'
      ? Object.assign({}, batch.payload, { body: blockBody(batch.block.startMs, batch.block.lead, now) })
      : batch.payload;
    tally = await deliverJobs(ictx, batch.camp, [{
      payload, ttl: batch.ttl, urgency: batch.urgency, created: batch.created,
      attempts: batch.attempts, alert: batch.alert, block: batch.block, targets,
    }], { keep: (keepAfter || 0) + (batch.alert ? 1 : 0) });
  }
  if (batch.alert) await bumpAlertCounts(ictx, batch.camp, batch.alert, tally);
  return { found: true, claimed: true, tally };
}

// ── HTTP plumbing ─────────────────────────────────────────────────────────

function corsFor(cfg, origin) {
  const headers = { Vary: 'Origin' };
  const allowed = !!origin && cfg.origins.includes(origin);
  if (allowed) headers['Access-Control-Allow-Origin'] = origin;
  return { headers, allowed };
}

function jsonResponse(status, body, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors ? cors.headers : {}),
  });
}

function errorResponse(e, cors) {
  if (e instanceof HttpError) {
    if (e.status >= 500) console.error('camp-alerts:', e.code, e.reason || '', e.message, e.dbStatus || '');
    return jsonResponse(e.status, { ok: false, error: e.code, message: e.message }, cors);
  }
  console.error('camp-alerts: unexpected', e && e.stack ? e.stack : e);
  return jsonResponse(500, { ok: false, error: 'internal', message: 'Something went wrong in the alert sender. Try again in a minute.' }, cors);
}

// Bodies are capped while streaming, so a huge upload is refused without
// being buffered (and without spending CPU on it).
async function readJsonBody(request) {
  const tooBig = () => new HttpError(413, 'too-large', 'That request is too large.');
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw tooBig();
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) { try { await reader.cancel(); } catch (e) { /* already closed */ } throw tooBig(); }
      chunks.push(value);
    }
  }
  let parsed;
  try { parsed = JSON.parse(utf8Decode(concatBytes(...chunks))); } catch (e) {
    throw new HttpError(400, 'bad-json', "That request wasn't readable.");
  }
  if (!isObj(parsed)) throw new HttpError(400, 'bad-json', "That request wasn't readable.");
  return parsed;
}

function campFrom(body) {
  if (typeof body.camp !== 'string' || !hasOwn(CAMPS, body.camp)) throw new HttpError(400, 'bad-camp', 'Unknown camp.');
  return body.camp;
}

// One rate slot per sender per camp, shared by alerts and tests (each checks
// its own window against it). Conditional, so two requests in the same
// instant can't both get through.
async function takeRateSlot(ictx, camp, key, windowMs, message) {
  const path = `pushServer/rate/${camp}/${key}`;
  const now = ictx.now();
  const { value, etag } = await dbGetTagged(ictx, path);
  // A stamp from the future can only be a clock or data accident; ignore it
  // rather than lock the person out until then.
  if (typeof value === 'number' && value <= now + MINUTE && now - value < windowMs) throw new HttpError(429, 'rate', message);
  const r = await dbPut(ictx, path, now, etag);
  if (r.conflict) throw new HttpError(429, 'rate', message);
}

function cleanKeys(list, max) {
  if (!Array.isArray(list)) return [];
  return list.filter((k) => typeof k === 'string' && k.length > 0 && k.length <= 200 && !RTDB_KEY_BAD_RE.test(k)).slice(0, max);
}

// ── POST /notify ──────────────────────────────────────────────────────────

async function notifyChat(ictx, caller, camp, body) {
  const ch = body.ch;
  const msgId = body.msgId;
  if (typeof ch !== 'string' || !hasOwn(CHANNELS, ch)) throw new HttpError(400, 'bad-channel', 'Unknown chat channel.');
  if (typeof msgId !== 'string' || !MSG_ID_RE.test(msgId)) throw new HttpError(400, 'bad-msg', 'Unknown chat message.');
  const msg = await dbGet(ictx, `${CAMPS[camp]}/chat/${ch}/${msgId}`);
  if (!isObj(msg)) throw new HttpError(404, 'no-message', "That message isn't in the chat (it may have been deleted).");
  // Only the author can announce their own message — otherwise any member
  // could re-buzz everyone about anything.
  if (msg.byKey !== caller.key) throw new HttpError(403, 'not-author', 'Only the person who sent a message can send its alert.');
  const now = ictx.now();
  // Dedupe markers are pruned after three days; this keeps an old message
  // from ever being re-announced once its marker is gone.
  if (typeof msg.at === 'number' && msg.at < now - STALE_CHAT_MS) return tallyBody(newTally(), { stale: true });
  if (!(await claimMarker(ictx, `pushServer/sent/${camp}/c-${msgId}`, now))) return tallyBody(newTally(), { duplicate: true });

  const push = await campPush(ictx, camp);
  const groups = chatRecipients({
    ch, authorKey: caller.key, members: caller.members, push,
    mentionKeys: cleanKeys(body.mentionKeys, 30),
    mentionTeams: cleanKeys(body.mentionTeams, 10).filter((t) => TEAM_RE.test(t)),
  });
  const name = memberName(caller.members, caller.key);
  // Most important first, so if anything has to wait in the outbox it's the
  // every-message channel alerts.
  const jobs = ['announcement', 'mention', 'channel'].filter((kind) => groups[kind].length).map((kind) => ({
    payload: chatPayload({ camp, kind, ch, msgId, msg, name, now }),
    ttl: TTL_CHAT, urgency: kind === 'channel' ? 'normal' : 'high', created: now, attempts: 0, targets: groups[kind],
  }));
  return tallyBody(await deliverJobs(ictx, camp, jobs, { keep: 0 }));
}

async function notifyAlert(ictx, caller, camp, body) {
  if (caller.member.role !== 'editor') throw new HttpError(403, 'not-editor', 'Only directors can send alerts.');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || Array.from(text).length > 300) throw new HttpError(400, 'bad-text', 'An alert needs 1 to 300 characters of text.');
  const audience = body.audience == null ? 'all' : body.audience;
  if (!(audience === 'all' || audience === 'editors' || (typeof audience === 'string' && TEAM_RE.test(audience)))) {
    throw new HttpError(400, 'bad-audience', 'Unknown audience for that alert.');
  }
  const urgent = body.urgent === true;
  await takeRateSlot(ictx, camp, caller.key, RATE_ALERT_MS, 'Please wait a few seconds before sending another alert.');

  const push = await campPush(ictx, camp);
  const targets = alertRecipients({ audience, urgent, members: caller.members, push });
  const now = ictx.now();
  const id = timeKey(now) + randomChars(12);
  const name = memberName(caller.members, caller.key);
  // The audit record goes in BEFORE anything is sent, so an alert that went
  // out is always on the list even if this invocation dies part-way; counts
  // arrive as increments as deliveries finish.
  await dbPut(ictx, `${CAMPS[camp]}/pushAlerts/${id}`, {
    at: now, byKey: caller.key, byName: name, text: clip(text, 300, true), audience, urgent, sent: 0, failed: 0,
  });
  const tally = await deliverJobs(ictx, camp, [{
    payload: alertPayload({ camp, id, name, text, urgent, now }),
    ttl: urgent ? TTL_URGENT : TTL_ALERT, urgency: 'high', created: now, attempts: 0, alert: id, targets,
  }], { keep: 1 });
  await bumpAlertCounts(ictx, camp, id, tally);
  return tallyBody(tally, { alertId: id });
}

async function notifyTest(ictx, caller, camp, body) {
  const want = body.deviceId;
  if (want != null && want !== '' && !(typeof want === 'string' && DEVICE_ID_RE.test(want))) {
    throw new HttpError(400, 'bad-device', 'Unknown device.');
  }
  const mine = await dbGet(ictx, `${CAMPS[camp]}/push/${caller.key}`);
  const targets = [];
  const seen = new Set();
  if (isObj(mine)) {
    for (const d of Object.keys(mine)) {
      if (want && d !== want) continue;
      const t = deviceTarget(caller.key, d, mine[d]);
      if (t && !seen.has(t.e)) { seen.add(t.e); targets.push(t); }
    }
  }
  if (!targets.length) {
    throw new HttpError(404, 'no-device', want
      ? "This phone isn't signed up for alerts yet — turn phone alerts on first."
      : "No phones are signed up for alerts on your account yet.");
  }
  await takeRateSlot(ictx, camp, caller.key, RATE_TEST_MS, 'Wait a few seconds before sending another test.');
  const now = ictx.now();
  return tallyBody(await deliverJobs(ictx, camp, [{
    payload: testPayload({ camp, now }), ttl: TTL_TEST, urgency: 'high', created: now, attempts: 0, targets,
  }], { keep: 0 }));
}

async function routeNotify(ictx, request, body) {
  const camp = campFrom(body);
  if (!['chat', 'alert', 'test'].includes(body.kind)) throw new HttpError(400, 'bad-kind', 'Unknown kind of alert.');
  const caller = await authenticate(ictx, request, camp);
  if (body.kind === 'chat') return notifyChat(ictx, caller, camp, body);
  if (body.kind === 'alert') return notifyAlert(ictx, caller, camp, body);
  return notifyTest(ictx, caller, camp, body);
}

// ── POST /drain ───────────────────────────────────────────────────────────
// No sign-in: the random batch id IS the capability (only /notify's caller
// ever sees it), and all a caller can do with it is send a batch that was
// going to be sent anyway.
async function routeDrain(ictx, request, body) {
  const id = body.batch;
  if (typeof id !== 'string' || !BATCH_ID_RE.test(id)) throw new HttpError(404, 'no-batch', 'That batch is already done.');
  const r = await drainBatch(ictx, id, 0);
  if (!r.found) throw new HttpError(404, 'no-batch', 'That batch is already done.');
  if (!r.claimed) return tallyBody(newTally(), { claimed: false });
  return tallyBody(r.tally, { claimed: true });
}

// ── POST /resubscribe ─────────────────────────────────────────────────────
// Called by the service worker's `pushsubscriptionchange`, which runs with no
// page and no sign-in. Knowing the old endpoint (a secret only that browser,
// its push service and this Worker hold) is the capability. Each record is
// replaced with an ETag-conditional PUT so a record deleted or re-written in
// the meantime is left alone, and prefs/label/team are kept as they were.
async function routeResubscribe(ictx, request, body) {
  const { oldEndpoint, endpoint, p256dh, auth } = body;
  const okEndpoint = (s) => typeof s === 'string' && s.startsWith('https://') && s.length <= 1024;
  if (!okEndpoint(oldEndpoint) || !okEndpoint(endpoint) || typeof p256dh !== 'string' || !P256DH_RE.test(p256dh)
      || typeof auth !== 'string' || !AUTH_RE.test(auth)) {
    throw new HttpError(400, 'bad-subscription', "That subscription isn't valid.");
  }
  let updated = 0;
  for (const camp of Object.keys(CAMPS)) {
    const push = await campPush(ictx, camp);
    const hits = [];
    for (const k of Object.keys(push)) {
      if (!isObj(push[k])) continue;
      for (const d of Object.keys(push[k])) {
        if (DEVICE_ID_RE.test(d) && isObj(push[k][d]) && push[k][d].endpoint === oldEndpoint) hits.push([k, d]);
      }
    }
    for (const [k, d] of hits.slice(0, 4)) {
      if (ictx.left() < 2) break;
      const path = `${CAMPS[camp]}/push/${k}/${d}`;
      const { value, etag } = await dbGetTagged(ictx, path);
      if (!isObj(value) || value.endpoint !== oldEndpoint) continue;
      const next = Object.assign({}, value, { endpoint, p256dh, auth, at: { '.sv': 'timestamp' } });
      const r = await dbPut(ictx, path, next, etag);
      if (!r.conflict) updated++;
    }
  }
  return { ok: true, updated };
}

// ── GET /vapid-key, /health, / ────────────────────────────────────────────

async function routeVapidKey(ictx) {
  const v = await ensureVapid(ictx);
  return { ok: true, publicKey: v.publicKey };
}

// The real end-to-end check behind both /health and the status page: mint
// the admin token, read the cron heartbeat, make sure the VAPID key exists.
async function runChecks(ictx, wantLastError) {
  const out = { configured: false, vapid: false, cronLastRun: null, problem: null, vapidProblem: null, lastError: null };
  try {
    const cron = await dbGet(ictx, 'pushServer/cron');
    out.configured = true;
    let last = null;
    if (isObj(cron)) for (const camp of Object.keys(CAMPS)) {
      const t = isObj(cron[camp]) ? cron[camp].lastRun : null;
      if (Number.isFinite(t) && (last == null || t > last)) last = t;
    }
    out.cronLastRun = last;
  } catch (e) {
    out.problem = e;
    return out;
  }
  try { await ensureVapid(ictx); out.vapid = true; } catch (e) { out.vapidProblem = e; }
  if (wantLastError) {
    try {
      const le = await dbGet(ictx, 'pushServer/lastError');
      if (isObj(le) && Number.isFinite(le.at) && ictx.now() - le.at < LAST_ERROR_SHOW_MS) out.lastError = le;
    } catch (e) { /* the page still shows everything else */ }
  }
  return out;
}

async function routeHealth(ictx) {
  const c = await runChecks(ictx, false);
  const body = { ok: c.configured && c.vapid, version: VERSION, configured: c.configured, vapid: c.vapid, cronLastRun: c.cronLastRun, time: ictx.now() };
  const p = c.problem || c.vapidProblem;
  if (p) {
    body.error = p instanceof HttpError ? p.code : 'internal';
    body.message = p instanceof HttpError ? p.message : 'Something went wrong in the alert sender.';
  }
  return body;
}

// A problem → [headline, what to do], in plain words. Never echoes a secret:
// only our own messages and Google's short error text are shown.
function explainProblem(e, cfg) {
  const reason = e && (e.reason || '');
  const fixSecret = 'In Cloudflare: open the camp-alerts Worker → Settings → Variables and Secrets, and set the secret FIREBASE_SERVICE_ACCOUNT to the WHOLE downloaded key file (setup guide, step 4).';
  if (reason === 'secret-missing') return ['Not connected to Firebase — the key secret is missing', fixSecret];
  if (reason === 'secret-unparsable') return ["Not connected to Firebase — the key secret isn't a complete key file", 'Paste the entire file again, from the very first { to the very last }. ' + fixSecret];
  if (reason === 'secret-incomplete' || reason === 'secret-bad-key') return ["Not connected to Firebase — the key secret isn't a Firebase service-account key", 'Generate a fresh key in Firebase (Project settings → Service accounts → Generate new private key) and paste that file. ' + fixSecret];
  if (reason === 'wrong-project') return [`Not connected to Firebase — that key is for a different project (“${e.project}”)`, `Generate the key from the Firebase project “${cfg.projectId}” instead, then paste it into the secret.`];
  if (reason === 'google-refused') return [`Not connected to Firebase — Google refused the key (${e.why || 'no reason given'})`, 'The key was probably deleted or replaced. Generate a new key in Firebase and paste it into the secret.'];
  if (reason === 'google-unreachable') return ["Couldn't reach Google just now", 'Usually temporary — reload this page in a minute.'];
  if (reason === 'vapid-corrupt') return ['The saved sender key in Firebase is damaged', 'In the Firebase console → Realtime Database → Data, delete pushServer → vapid. A new one is made automatically; everyone then needs to turn phone alerts on again.'];
  if (e instanceof DbError) {
    if (e.dbStatus === 401 || e.dbStatus === 403) return [`Firebase refused the sender (HTTP ${e.dbStatus})`, 'The key works but has no database access. Generate it from the camp project: Firebase → Project settings → Service accounts → Generate new private key.'];
    if (e.dbStatus === 404) return ['The Firebase database address is wrong', 'Remove the FIREBASE_DB_URL variable from the Worker (the built-in address is correct).'];
    return ["Couldn't reach the Firebase database", 'Usually temporary — reload this page in a minute.'];
  }
  if (e instanceof BudgetError) return ['The sender was too busy to finish the check', 'Reload this page in a minute.'];
  return ['Something unexpected went wrong', 'Reload this page in a minute. If it keeps happening, send a screenshot of this page to whoever maintains the site.'];
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The page a non-programmer opens to see if everything works. It is PUBLIC
// (no sign-in), so it shows only the sender's own health — never camp data,
// counts, dates or anything from the secret.
async function routeStatusPage(ictx, url) {
  const c = await runChecks(ictx, true);
  const now = ictx.now();
  const lines = [['ok', 'Sender is running', `Version ${VERSION}.`]];
  if (c.configured) lines.push(['ok', 'Connected to Firebase', '']);
  else { const [h, fix] = explainProblem(c.problem, ictx.cfg); lines.push(['bad', h, fix]); }
  if (c.configured) {
    if (c.vapid) lines.push(['ok', 'Sender key ready', '']);
    else { const [h, fix] = explainProblem(c.vapidProblem, ictx.cfg); lines.push(['bad', h, fix]); }
    if (c.cronLastRun == null) {
      lines.push(['bad', 'The schedule timer has never run', 'Add the Cron Trigger: Worker → Settings → Trigger Events → Add → Cron Triggers → enter * * * * * (setup guide, step 5). Then wait two minutes and reload.']);
    } else {
      const mins = Math.max(0, Math.floor((now - c.cronLastRun) / MINUTE));
      const ago = mins === 0 ? 'less than a minute ago' : mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
      if (mins <= 5) lines.push(['ok', `Schedule timer last ran ${ago}`, '']);
      else lines.push(['bad', `Schedule timer last ran ${ago} (${formatEtDateTime(c.cronLastRun)})`, 'It should run every minute. Check the Cron Trigger is still there: Worker → Settings → Trigger Events.']);
    }
    if (c.lastError) {
      const le = c.lastError;
      const apple = String(le.host || '').endsWith('push.apple.com');
      const hint = (le.status === 403 || le.status === 401)
        ? (apple ? 'A 403 from Apple almost always means the sender key or VAPID_SUBJECT is wrong. If you changed VAPID_SUBJECT, it must start with https:// or mailto:.' : 'This usually means the sender key or VAPID_SUBJECT is wrong.')
        : 'If this keeps happening, send a screenshot of this page to whoever maintains the site.';
      lines.push(['warn', `At ${formatEtDateTime(le.at)} Eastern, ${le.host || 'a push service'} refused a notification (HTTP ${le.status}${le.reason ? ': ' + le.reason : ''})`, hint]);
    }
  }
  const icon = { ok: '✅', bad: '❌', warn: '⚠️' };
  const items = lines.map(([kind, head, fix]) => `<li class="${kind}"><span class="i">${icon[kind]}</span><div><b>${escHtml(head)}</b>${fix ? `<p>${escHtml(fix)}</p>` : ''}</div></li>`).join('');
  const allGood = lines.every(([k]) => k === 'ok');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Camp alerts sender</title>
<style>
:root{color-scheme:light dark;--bg:#fafaf7;--fg:#1d1d1b;--muted:#6b6b66;--line:#e2e2dc;--bad:#b3261e;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ededea;--muted:#a3a39d;--line:#33332f;--bad:#ff8a80;--warn:#f5c26b}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.4rem;margin:0 0 4px}.sum{margin:0 0 20px;color:var(--muted)}
ul{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
li{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.i{flex:none;width:1.5em}li p{margin:4px 0 0;color:var(--muted)}li.bad b{color:var(--bad)}li.warn b{color:var(--warn)}
code{font-size:.95em;word-break:break-all}footer{margin-top:20px;color:var(--muted);font-size:.9rem}
</style></head><body><main>
<h1>📲 Camp alerts sender</h1>
<p class="sum">${allGood ? 'Everything is working.' : 'Something needs attention — see the ❌ lines below.'}</p>
<ul>${items}</ul>
<footer><p>Checked at ${escHtml(formatEtTime(now))} Eastern. Reload this page to check again.</p>
<p>This sender's address (give it to whoever maintains the camp site): <code>${escHtml(url.origin)}</code></p></footer>
</main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    },
  });
}

const POST_ROUTES = { '/notify': routeNotify, '/drain': routeDrain, '/resubscribe': routeResubscribe };

async function handleRequest(request, env, deps) {
  const ictx = makeInvocation(env, deps);
  const origin = request.headers.get('Origin');
  const cors = corsFor(ictx.cfg, origin);
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: Object.assign({
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          'Access-Control-Max-Age': '86400',
        }, cors.headers),
      });
    }
    if (method === 'GET' && path === '/') return await routeStatusPage(ictx, url);
    if (method === 'GET' && path === '/health') return jsonResponse(200, await routeHealth(ictx), cors);
    if (method === 'GET' && path === '/vapid-key') return jsonResponse(200, await routeVapidKey(ictx), cors);
    if (method === 'POST' && hasOwn(POST_ROUTES, path)) {
      // A browser on some other site: refuse before doing any work. (No Origin
      // at all is a non-browser caller, which CORS doesn't apply to.)
      if (origin && !cors.allowed) throw new HttpError(403, 'bad-origin', 'Requests from that website are not accepted.');
      const body = await readJsonBody(request);
      return jsonResponse(200, await POST_ROUTES[path](ictx, request, body), cors);
    }
    throw new HttpError(404, 'not-found', 'Nothing here.');
  } catch (e) {
    return errorResponse(e, cors);
  }
}

// ── The every-minute cron ─────────────────────────────────────────────────

// 1. Outbox backstop: batches nobody drained (the client got their ids but
// went offline, or a retry's backoff is up). Oldest first; each must leave
// CRON_RESERVE subrequests for the schedule pass and the heartbeat.
// A batch costs up to 7 subrequests before its first send (read, member
// keys, devices, VAPID key, claim, and the re-queue write deliverJobs keeps);
// never start one without that much headroom above the reserve.
const CRON_BATCH_MIN = 8;

async function cronOutbox(ictx, total) {
  if (ictx.left() <= CRON_RESERVE + CRON_BATCH_MIN) return;
  const listing = await dbGet(ictx, 'pushServer/outbox', { shallow: 'true' });
  if (!isObj(listing)) return;
  const now = ictx.now();
  const ready = Object.keys(listing)
    .filter((id) => BATCH_ID_RE.test(id) && timeFromKey(id) <= now - CRON_GRACE_MS)
    .sort();
  for (const id of ready) {
    if (ictx.sendsLeft <= 0 || ictx.left() <= CRON_RESERVE + CRON_BATCH_MIN) break;
    try {
      const r = await drainBatch(ictx, id, CRON_RESERVE);
      if (r.tally) addTally(total, r.tally);
    } catch (e) {
      if (e instanceof BudgetError) break;
      console.error('camp-alerts: cron drain failed', e && e.message);
    }
  }
}

// 2. Schedule alerts for one camp. Writes into `beat` (the heartbeat patch)
// instead of writing itself, so both camps cost one write a minute.
// `reserve` = subrequests that must still be there afterwards (the other
// camp's pass and the heartbeat); every step checks it first, so a busy
// minute degrades to "try this camp again next minute", never to a lost
// heartbeat.
// weekStart, blocks, cron state, members, push, the VAPID key on a cold
// isolate, one outbox write.
const CRON_CAMP_COST = 7;

async function cronSchedule(ictx, camp, beat, total, reserve) {
  const now = ictx.now();
  const root = CAMPS[camp];
  const need = (n) => { if (ictx.left() - reserve < n) throw new BudgetError(); };
  beat[`${camp}/lastRun`] = now;
  need(1);
  const weekStart = await dbGet(ictx, `${root}/pushSchedule/weekStart`);
  if (!isValidWeekStart(weekStart)) return;
  // Outside camp week (with a day of slack each side) the cron does nothing
  // but this one tiny read — the rest of the year costs next to nothing.
  const ws = etWallToEpoch(weekStart, 0);
  if (now < ws - DAY || now > ws + 8 * DAY) return;

  need(CRON_CAMP_COST - 1);
  const [blocks, state] = await Promise.all([
    dbGet(ictx, `${root}/pushSchedule/blocks`),
    dbGet(ictx, `pushServer/cron/${camp}`),
  ]);
  const win = cronWindow(now, isObj(state) ? state.upTo : null);
  const due = dueBlocks(blocks, weekStart, win.from, win.to);
  if (due.length) {
    const [members, push] = await Promise.all([campMembers(ictx, camp), campPush(ictx, camp)]);
    const groups = blockRecipients({ due, members, push });
    const jobs = [];
    due.forEach((item, i) => {
      if (!groups[i].length) return;
      jobs.push({
        payload: blockPayload({ camp, item, now }),
        ttl: Math.max(60, Math.ceil((item.startMs - now) / 1000)),
        urgency: 'high', created: now, attempts: 0, targets: groups[i],
        block: { startMs: item.startMs, lead: item.lead },
      });
    });
    const tally = await deliverJobs(ictx, camp, jobs, { keep: reserve });
    addTally(total, tally);
    // Something neither sent nor safely queued: leave the window where it
    // was, so the next minute covers these blocks again. A repeat is
    // harmless — the same tag replaces the notification on the phone.
    if (tally.unhandled) return;
  }
  beat[`${camp}/upTo`] = win.upTo;
}

// 3. Hourly tidy-up (Eastern minute 17 — off the hour, when nothing else is
// scheduled). Pure housekeeping, so it only runs on budget nobody else needed.
async function cronMaintenance(ictx) {
  const now = ictx.now();
  for (const camp of Object.keys(CAMPS)) {
    if (ictx.left() < 8) return;
    const sent = await dbGet(ictx, `pushServer/sent/${camp}`);
    const oldSent = {};
    if (isObj(sent)) for (const k of Object.keys(sent)) if (!(Number(sent[k]) > now - SENT_KEEP_MS)) oldSent[k] = null;
    if (Object.keys(oldSent).length) await dbPatch(ictx, `pushServer/sent/${camp}`, oldSent);

    const rate = await dbGet(ictx, `pushServer/rate/${camp}`);
    const oldRate = {};
    if (isObj(rate)) for (const k of Object.keys(rate)) if (!(Number(rate[k]) > now - RATE_KEEP_MS)) oldRate[k] = null;
    if (Object.keys(oldRate).length) await dbPatch(ictx, `pushServer/rate/${camp}`, oldRate);

    // Device records of people no longer on the member list. NEVER when the
    // list reads empty: that is a read problem, not a camp with no staff, and
    // acting on it would switch off everybody's alerts.
    const keys = await campMemberKeys(ictx, camp);
    if (!keys.size) continue;
    const pushKeys = await dbGet(ictx, `${CAMPS[camp]}/push`, { shallow: 'true' });
    const gone = {};
    if (isObj(pushKeys)) for (const k of Object.keys(pushKeys)) if (!keys.has(k)) gone[k] = null;
    if (Object.keys(gone).length) await dbPatch(ictx, `${CAMPS[camp]}/push`, gone);
  }
  // Outbox entries whose id isn't one of ours can never be drained; drop them.
  if (ictx.left() < 2) return;
  const listing = await dbGet(ictx, 'pushServer/outbox', { shallow: 'true' });
  const junk = {};
  if (isObj(listing)) for (const id of Object.keys(listing)) if (!BATCH_ID_RE.test(id) || !Number.isFinite(timeFromKey(id))) junk[id] = null;
  if (Object.keys(junk).length) await dbPatch(ictx, 'pushServer/outbox', junk);
}

async function runCron(env, deps) {
  const ictx = makeInvocation(env, deps);
  const total = newTally();
  const beat = {};
  const now = ictx.now();
  try { await cronOutbox(ictx, total); } catch (e) { console.error('camp-alerts: cron outbox', e && e.message); }
  const camps = Object.keys(CAMPS);
  for (const camp of camps) beat[`${camp}/lastRun`] = now;
  for (let i = 0; i < camps.length; i++) {
    // 1 for the heartbeat, plus a full pass for each camp still to come.
    const reserve = 1 + (camps.length - 1 - i) * CRON_CAMP_COST;
    try { await cronSchedule(ictx, camps[i], beat, total, reserve); } catch (e) {
      if (!(e instanceof BudgetError)) console.error('camp-alerts: cron schedule', camps[i], e && e.message);
      else console.warn('camp-alerts: cron schedule deferred (busy)', camps[i]);
    }
  }
  // The heartbeat: one write for both camps. The status page reads lastRun
  // to tell a non-programmer whether the Cron Trigger is set up.
  try { await dbPatch(ictx, 'pushServer/cron', beat); } catch (e) { console.error('camp-alerts: heartbeat', e && e.message); }
  if (etParts(now).minute === 17) {
    try { await cronMaintenance(ictx); } catch (e) { console.error('camp-alerts: maintenance', e && e.message); }
  }
  return { tally: total, used: ictx.used, beat };
}

// ── Entry points ──────────────────────────────────────────────────────────

const handler = {
  fetch(request, env, ctx) {
    return handleRequest(request, env, null);
  },
  scheduled(controller, env, ctx) {
    const p = runCron(env, null).catch((e) => console.error('camp-alerts: cron crashed', e && e.stack ? e.stack : e));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
    return p;
  },
};

// Internals for tests/push-worker.test.js. Non-enumerable, so the Workers
// runtime (which looks for fetch/scheduled) never sees it.
Object.defineProperty(handler, '_test', {
  enumerable: false,
  value: {
    VERSION, CAMPS, CHANNELS, SUBREQUEST_CAP, PAYLOAD_LIMIT, TEST_TITLE,
    handleRequest, runCron, makeInvocation, newCache, readConfig,
    b64urlEncode, b64urlDecode, utf8, timeKey, timeFromKey, clip,
    emailKey, identityFromKey, identityKeyFromClaims, memberName, normalizePrefs, deviceTarget,
    chatRecipients, alertRecipients, blockRecipients,
    etWallToEpoch, etOffsetMs, formatEtTime, isValidWeekStart, addDaysYmd, cronWindow, dueBlocks,
    makePayload, chatPayload, alertPayload, blockPayload, testPayload,
    verifyIdToken, adminToken, ensureVapid, vapidAuthorization, encryptPayload, ephemeralKey,
    deliverJobs, packBatches, drainBatch, classifyPushStatus, BudgetError, HttpError,
  },
});

export default handler;
