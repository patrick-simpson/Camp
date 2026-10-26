// ── Phone alerts (Web Push) ───────────────────────────────────────
// Real notifications that reach a phone when Camp is CLOSED: new
// Announcements, someone naming you or your team in chat, every message in a
// channel you've belled, the schedule blocks you pick (N minutes before), and
// alerts a director sends from here. Signed-in members only.
//
// How it fits together (the full design lives in push-worker/README.md):
//   - This file subscribes the phone (the browser's PushManager) and writes
//     one record per (person, device) at <dbRoot>/push/<myKey>/<deviceId> —
//     the endpoint, its two encryption keys, and what this phone wants to
//     hear about. The rules let ONLY that person write or read it.
//   - A small Cloudflare Worker on the free plan (push-worker/) is the
//     sender. Firebase stays on the free Spark plan, so there are no Cloud
//     Functions: the page tells the Worker "I just posted message X" and the
//     Worker reads the message itself (it never trusts what we say about it),
//     decides who should buzz, and sends. Its one-a-minute cron does the
//     schedule-block reminders and retries.
//   - sw.js shows the notification. It has to: iOS revokes push permission
//     from a site whose pushes ever arrive without one.
//
// Self-contained like chat.js: loaded after it, and every hook from app.js
// and chat.js is typeof-guarded, so deleting the <script> tag leaves the app
// exactly as it was (minus the drawer's contents).
//
// THE invariant, inherited from the sync layer: no database ref is touched
// until membership is confirmed. initPush() is called from initSync() (the
// approved path) and flips pushSyncReady; every read/write below checks it.
// Reads here are all one-shot once() calls — a refused once() is harmless,
// unlike the state listener's terminal .on().

// The Worker's address, e.g. 'https://camp-alerts.<account>.workers.dev'
// (no trailing slash). BLANK ⇒ the whole feature is dormant: nothing is
// registered or written, and the drawer says alerts aren't connected yet.
// When you fill this in, ALSO add the same origin to connect-src in the
// Content-Security-Policy in index.html — otherwise the browser silently
// blocks every request to it (the drawer's sender line will say so).
const PUSH_SERVICE_URL = '';

// Part of the service worker's registration URL (sw.js?v=N). Bump it when
// sw.js changes in a way an already-installed worker must pick up promptly —
// a new script URL is a new worker, installed on the next page load.
const PUSH_SW_VERSION = 2;

const PUSH_ON_KEY = 'campScoreboardPushOn';         // per camp via lsKey(): '1' ⇒ this phone has alerts on here
const PUSH_PREFS_KEY = 'campScoreboardPushPrefs';   // per camp via lsKey(): the prefs except chat channels
// One random id per BROWSER, shared by both camps and deliberately not wiped
// on sign-out: it isn't camp data, it's this phone's name for itself. (The
// records it keys ARE deleted on sign-out — see pushSignOut.)
const PUSH_DEVICE_KEY = 'campScoreboardPushDevice';
const PUSH_VAPID_KEY = 'campScoreboardPushVapid';   // the sender's public key, last seen (public — not wiped)
const PUSH_OPEN_KEY = 'campPushOpen';               // sessionStorage: a tap target carried across a camp switch
const PUSH_LEADS = [5, 10, 15];
const PUSH_ALERT_MAX = 300;
const PUSH_BLOCK_KEY_RE = /^[a-z0-9-]{1,48}$/;
const PUSH_TEAM_RE = /^t[0-9]$/;
// The friendly line on a test notification lives in the WORKER (it composes
// every payload); this is only what the page says while one is on its way.

let pushSyncReady = false;     // membership confirmed — refs may be touched
let pushBusy = false;          // an enable/disable is in flight
let pushNeedsReconnect = false; // flag says on, but the phone lost its subscription
let pushCspBlocked = false;    // the page's CSP refused a request to the Worker
let pushPendingOpen = null;    // { open, camp } from a notification tap, handled once the app is up
let pushPrefsTimer = null;
let pushVapidPrefetch = null;  // Promise<string> — fetched when the drawer opens, so the tap stays short
let pushReconnectToastShown = false;
// What the director has typed into the alert composer. Kept here, not just in
// the DOM, so a drawer re-render (enable, a pref saved…) never eats it.
let pushAlertDraft = { text: '', audience: 'all', urgent: false };
let pushAlertResult = '';      // the "Sent to 17 phones" line under the composer
let pushSending = false;
// Server-side things the drawer shows; undefined = not loaded yet.
let pushWeekStart;             // R/pushSchedule/weekStart (string | null)
let pushHealth;                // GET /health result (object | null = unreachable)

// ════════════════════════════════════════════════════════════════════
// Pure helpers (no DOM, no network) — pinned by tests/push.test.js
// ════════════════════════════════════════════════════════════════════

// Clip a string to `max` UTF-16 units without ever splitting an emoji in
// half (a lone surrogate is what a naive slice would leave behind).
function pushClip(s, max) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

// The part of a schedule label that names the BLOCK, without its decoration:
// "Snack and campfire — TJ" and "Snack and campfire — Ella" are the same
// thing to subscribe to, as are the two morning-meeting variants (different
// team groups in the parentheses' tail).
function pushHeadLabel(label) {
  const s = String(label == null ? '' : label);
  const cuts = [s.indexOf(' — '), s.indexOf(' (')].filter((i) => i >= 0);
  return (cuts.length ? s.slice(0, Math.min.apply(null, cuts)) : s).trim();
}

// The stable key a block is subscribed by. Shared by every occurrence of the
// "same" block across the week, and by both the published schedule and every
// phone's prefs — so it must stay deterministic. Must satisfy the rules'
// /^[a-z0-9-]{1,48}$/.
function pushBlockKey(label) {
  const key = pushHeadLabel(label).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return key || 'block';
}

// The week as plain data the Worker can use — it can't run camps.js, so an
// editor's device publishes this. Untimed blocks (lights out, "camp's over")
// have nothing to remind anyone about and are left out.
function pushScheduleBlocks(daySchedule) {
  const out = {};
  for (let dow = 0; dow <= 6; dow++) {
    const day = (daySchedule && daySchedule[dow]) || [];
    day.forEach((b, i) => {
      if (!b || b.noTime) return;
      const start = Number(b.start);
      if (!Number.isInteger(start) || start < 0 || start >= 1440) return;
      out[`d${dow}-${start}-${i}`] = {
        dow,
        start,
        label: pushClip(String(b.label || '').trim(), 120) || 'Schedule block',
        emoji: pushClip(String(b.emoji || '').trim(), 16) || '🕒',
        key: pushBlockKey(b.label),
      };
    });
  }
  return out;
}

const PUSH_DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// 1020 → "5:00 PM". Camp time is the only time the schedule knows.
function pushClock(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// [1,2,3,4,5] → "Mon–Fri"; [0,6] → "Sun, Sat"; all seven → "Daily".
function pushDayRange(dows) {
  const d = Array.from(new Set(dows)).sort((a, b) => a - b);
  if (d.length === 7) return 'Daily';
  const runs = [];
  d.forEach((x) => {
    const run = runs[runs.length - 1];
    if (run && x === run[run.length - 1] + 1) run.push(x);
    else runs.push([x]);
  });
  return runs.map((r) => (r.length >= 3
    ? `${PUSH_DAY_SHORT[r[0]]}–${PUSH_DAY_SHORT[r[r.length - 1]]}`
    : r.map((x) => PUSH_DAY_SHORT[x]).join(', '))).join(', ');
}

// "Sun–Thu 8:00 PM · Fri 9:00 PM" — every time a block happens, grouped by
// clock time so the line stays short.
function pushWhenText(occurrences) {
  const byStart = new Map();
  (occurrences || []).forEach((o) => {
    if (!byStart.has(o.start)) byStart.set(o.start, []);
    byStart.get(o.start).push(o.dow);
  });
  return [...byStart.entries()]
    .sort((a, b) => Math.min.apply(null, a[1]) - Math.min.apply(null, b[1]) || a[0] - b[0])
    .map(([start, dows]) => `${pushDayRange(dows)} ${pushClock(start)}`)
    .join(' · ');
}

// The drawer's list of subscribable blocks: one row per KEY, in order of
// first appearance Sunday → Saturday, labeled by the head label and emoji of
// that first occurrence.
function pushBlockCatalog(daySchedule) {
  const rows = new Map();
  const blocks = pushScheduleBlocks(daySchedule);
  // Object key order is insertion order (non-integer keys), i.e. Sun..Sat and
  // each day's array order — exactly "first appearance".
  Object.keys(blocks).forEach((id) => {
    const b = blocks[id];
    if (!rows.has(b.key)) {
      rows.set(b.key, { key: b.key, label: pushHeadLabel(b.label) || b.label, emoji: b.emoji, occ: [] });
    }
    rows.get(b.key).occ.push({ dow: b.dow, start: b.start });
  });
  return [...rows.values()].map((r) => ({ key: r.key, label: r.label, emoji: r.emoji, when: pushWhenText(r.occ) }));
}

function pushChannelIds() {
  return ((typeof CAMP !== 'undefined' && CAMP.chatChannels) || []).map((c) => c.id);
}

// Every field typed, whatever RTDB pruning or an older build left behind.
// The Worker runs the same defaults, so a missing field means the same thing
// on both sides: announcements on, other channels off, mentions on, director
// alerts on, no schedule blocks, 10 minutes' warning.
function normalizePushPrefs(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rch = r.ch && typeof r.ch === 'object' && !Array.isArray(r.ch) ? r.ch : {};
  const ch = {};
  pushChannelIds().forEach((id) => {
    ch[id] = typeof rch[id] === 'boolean' ? rch[id] : id === 'announcements';
  });
  const blocks = {};
  if (r.blocks && typeof r.blocks === 'object' && !Array.isArray(r.blocks)) {
    Object.keys(r.blocks).forEach((k) => {
      if (r.blocks[k] === true && PUSH_BLOCK_KEY_RE.test(k)) blocks[k] = true;
    });
  }
  const lead = Number(r.lead);
  return {
    ch,
    mention: typeof r.mention === 'boolean' ? r.mention : true,
    director: typeof r.director === 'boolean' ? r.director : true,
    blocksAll: typeof r.blocksAll === 'boolean' ? r.blocksAll : false,
    blocks,
    lead: PUSH_LEADS.includes(lead) ? lead : 10,
  };
}

// The record written at <dbRoot>/push/<myKey>/<deviceId>. Shape is a
// contract with database.rules.json AND the Worker — see the rules test that
// re-implements the validate rules against this output.
function pushDeviceRecord(sub, prefs, team, label) {
  const p = normalizePushPrefs(prefs);
  const outPrefs = { ch: p.ch, mention: p.mention, director: p.director, blocksAll: p.blocksAll, lead: p.lead };
  // RTDB drops an empty object anyway; leaving it out keeps the written
  // record and the read-back one identical, which the self-heal compares.
  if (Object.keys(p.blocks).length) outPrefs.blocks = p.blocks;
  const hasFirebase = typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue;
  const rec = {
    endpoint: String((sub && sub.endpoint) || ''),
    p256dh: String((sub && sub.p256dh) || ''),
    auth: String((sub && sub.auth) || ''),
    at: hasFirebase ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
    prefs: outPrefs,
  };
  const lbl = pushClip(String(label || '').trim(), 40);
  if (lbl) rec.label = lbl;
  if (typeof team === 'string' && PUSH_TEAM_RE.test(team)) rec.team = team;
  return rec;
}

// Who a chat message names, for the Worker's mention alerts: member keys and
// team ids. Uses chat.js's own scanner and dictionary, so a phone buzzes for
// exactly the words that highlight in the bubble. A person hit carries a key
// when it came from the live directory; printed-roster names (and first names
// two members share) are resolved through the directory by name, the same
// label match mentionIsMine() makes on the receiving device. The Worker
// ignores keys that aren't members, so a stale match can't reach a stranger.
function pushMentionTargets(text) {
  const none = { keys: [], teams: [] };
  if (!text || typeof mentionScan !== 'function' || typeof chatMentionTargets !== 'function') return none;
  let hits;
  try { hits = mentionScan(text, chatMentionTargets()); } catch (e) { return none; }
  const keys = new Set();
  const teams = new Set();
  const dir = (typeof memberDirectory !== 'undefined' && memberDirectory) || {};
  hits.forEach((h) => {
    if (h.kind === 'person') {
      if (h.key) keys.add(h.key);
      const want = String(h.label || '').trim().toLowerCase();
      if (!want) return;
      Object.keys(dir).forEach((k) => {
        const name = String((dir[k] && dir[k].name) || '').trim().toLowerCase();
        if (name && (name === want || name.split(/\s+/)[0] === want)) keys.add(k);
      });
    } else if (h.kind === 'team' && h.teamId && PUSH_TEAM_RE.test(h.teamId)) {
      teams.add(h.teamId);
    }
  });
  const me = typeof identityKey === 'function' && typeof authUser !== 'undefined' ? identityKey(authUser) : '';
  if (me) keys.delete(me);
  return { keys: [...keys].slice(0, 30), teams: [...teams].slice(0, 10) };
}

// 'YYYY-MM-DD' that is a real calendar date AND a Sunday — the camp week's
// first day. (The Worker counts dow 0..6 from it.)
function isValidWeekStart(s) {
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && dt.getUTCDay() === 0;
}

// "Jul 18–24" / "Jul 30 – Aug 5" for the week starting on that Sunday.
function pushWeekLabel(weekStart) {
  if (!isValidWeekStart(weekStart)) return '';
  const [y, mo, d] = weekStart.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo - 1, d));
  const end = new Date(Date.UTC(y, mo - 1, d + 6));
  const mon = (dt) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }).format(dt);
  return mon(start) === mon(end)
    ? `${mon(start)} ${start.getUTCDate()}–${end.getUTCDate()}`
    : `${mon(start)} ${start.getUTCDate()} – ${mon(end)} ${end.getUTCDate()}`;
}

// Can THIS browser get phone alerts, and if not, what's the one thing to say?
// 'unsupported' | 'ios-needs-install' | 'ios-too-old' | 'denied' | 'ready'.
// `env` overrides the real globals (tests); normally omitted.
function pushEnvironment(env) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const e = Object.assign({
    ua: String(nav.userAgent || ''),
    maxTouchPoints: Number(nav.maxTouchPoints) || 0,
    standalone: nav.standalone === true ||
      (typeof matchMedia === 'function' && !!matchMedia('(display-mode: standalone)').matches),
    hasSW: !!nav.serviceWorker,
    hasPush: typeof PushManager !== 'undefined',
    permission: typeof Notification !== 'undefined' ? Notification.permission : null,
  }, env || {});
  // iPadOS asks for the desktop site, so an iPad says "Macintosh" — the touch
  // points are the tell.
  const ipadAsMac = /Macintosh/.test(e.ua) && e.maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(e.ua) || ipadAsMac;
  if (ios) {
    // "CPU iPhone OS 16_4" on phones; desktop-mode iPads only say "Version/16.4".
    const m = ipadAsMac ? /Version\/(\d+)[._](\d+)/.exec(e.ua) : /OS (\d+)[._](\d+)/.exec(e.ua);
    if (m && (+m[1] < 16 || (+m[1] === 16 && +m[2] < 4))) return 'ios-too-old';
    // Safari in a tab has no PushManager at all; only the Home Screen app does.
    if (!e.standalone) return 'ios-needs-install';
  }
  if (!e.hasSW || !e.hasPush || e.permission === null) return 'unsupported';
  if (e.permission === 'denied') return 'denied';
  return 'ready';
}

function pushIsIOS() {
  const ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(navigator.maxTouchPoints) > 1);
}

// A human name for this device in "your devices" (≤ 40 chars).
function pushDeviceLabel(ua, touchPoints) {
  const u = String(ua == null ? ((typeof navigator !== 'undefined' && navigator.userAgent) || '') : ua);
  const touch = touchPoints == null ? Number((typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0) : touchPoints;
  if (/iPhone/.test(u)) return 'iPhone';
  if (/iPad/.test(u) || (/Macintosh/.test(u) && touch > 1)) return 'iPad';
  if (/Android/.test(u)) return /Mobile/.test(u) ? 'Android phone' : 'Android tablet';
  if (/CrOS/.test(u)) return 'Chromebook';
  if (/Macintosh|Mac OS X/.test(u)) return 'Mac';
  if (/Windows/.test(u)) return 'Windows computer';
  if (/Linux/.test(u)) return 'Linux computer';
  return 'This device';
}

// JSON with object keys sorted at every level — "the same data" compares
// equal however RTDB happened to order it on the way back.
function pushStableJson(v) {
  if (Array.isArray(v)) return '[' + v.map(pushStableJson).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + pushStableJson(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// Unpadded base64url, by hand rather than via btoa/atob: no binary-string
// detour, and the same code runs in the test harness (which has neither).
const PUSH_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function pushB64url(buf) {
  if (!buf) return '';
  const b = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += PUSH_B64[(n >> 18) & 63] + PUSH_B64[(n >> 12) & 63];
    if (i + 1 < b.length) out += PUSH_B64[(n >> 6) & 63];
    if (i + 2 < b.length) out += PUSH_B64[n & 63];
  }
  return out;
}

// Throws on anything that isn't base64url (standard +/ and = padding are
// tolerated, since that's what a hand-pasted key might carry).
function pushB64urlToBytes(s) {
  const clean = String(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) throw new Error('not base64url');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let j = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | PUSH_B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 255;
    }
  }
  return out;
}

// A VAPID public key is an uncompressed P-256 point: 65 bytes, leading 0x04.
function pushValidVapidKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(key)) return false;
  try {
    const b = pushB64urlToBytes(key);
    return b.length === 65 && b[0] === 4;
  } catch (e) { return false; }
}

function pushAudienceLabel(audience) {
  if (audience === 'all') return 'Everyone';
  if (audience === 'editors') return 'Directors only';
  if (PUSH_TEAM_RE.test(String(audience || '')) && typeof teamName === 'function') {
    const t = (typeof state !== 'undefined' && state.teams || []).find((x) => x.id === audience);
    return t ? `${teamEmoji(audience)} ${t.name} counselors` : 'One team';
  }
  return 'Everyone';
}

// ════════════════════════════════════════════════════════════════════
// Device-local state
// ════════════════════════════════════════════════════════════════════

function pushConfigured() {
  return /^https:\/\/[^\s/]+/.test(PUSH_SERVICE_URL) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(PUSH_SERVICE_URL);
}

function pushServiceBase() {
  return PUSH_SERVICE_URL.replace(/\/+$/, '');
}

function pushOnKeyFor(campId) {
  const c = (typeof CAMPS !== 'undefined' && CAMPS[campId]) || CAMP;
  return PUSH_ON_KEY + c.storageSuffix;
}

function pushIsOn(campId) {
  try { return localStorage.getItem(pushOnKeyFor(campId || CAMP.id)) === '1'; } catch (e) { return false; }
}

function pushSetOn(on, campId) {
  try {
    if (on) localStorage.setItem(pushOnKeyFor(campId || CAMP.id), '1');
    else localStorage.removeItem(pushOnKeyFor(campId || CAMP.id));
  } catch (e) { /* storage blocked — the drawer will just read "off" */ }
}

function pushOnInOtherCamp() {
  return Object.keys(CAMPS).some((cid) => cid !== CAMP.id && pushIsOn(cid));
}

// This browser's device id, minted on first need. `mint === false` only
// reads (sign-out shouldn't invent an id just to delete nothing).
function pushDeviceId(mint) {
  try {
    const have = localStorage.getItem(PUSH_DEVICE_KEY);
    if (have && /^[A-Za-z0-9_-]{8,64}$/.test(have)) return have;
    if (mint === false) return null;
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const id = pushB64url(bytes.buffer); // 24 url-safe chars
    localStorage.setItem(PUSH_DEVICE_KEY, id);
    return id;
  } catch (e) { return null; }
}

function pushReadStoredPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(lsKey(PUSH_PREFS_KEY)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}

function pushStorePrefs(patch) {
  const next = Object.assign({}, pushReadStoredPrefs(), patch);
  delete next.ch; // channels live in chat.js's subscription map — one source of truth
  try { localStorage.setItem(lsKey(PUSH_PREFS_KEY), JSON.stringify(next)); } catch (e) { /* fine */ }
}

// This phone's prefs as they should be written: the stored ones, plus the
// chat bells (chat.js owns those — the drawer's channel switches and the 🔔 in
// the chat header are the same setting).
function pushCurrentPrefs() {
  const ch = {};
  pushChannelIds().forEach((id) => {
    ch[id] = typeof chatSubscribed === 'function' ? chatSubscribed(id) : id === 'announcements';
  });
  return normalizePushPrefs(Object.assign({}, pushReadStoredPrefs(), { ch }));
}

// The team used for team-mention alerts: the one on the account, else the one
// this device follows.
function pushMyTeam() {
  const t = (typeof memberTeamId !== 'undefined' && memberTeamId) ||
    (typeof state !== 'undefined' && state.followTeam) || '';
  return PUSH_TEAM_RE.test(String(t)) ? t : '';
}

function pushRecordPath(campId, myKey, deviceId) {
  const c = (typeof CAMPS !== 'undefined' && CAMPS[campId]) || CAMP;
  return c.dbRoot + '/push/' + myKey + '/' + deviceId;
}

// ════════════════════════════════════════════════════════════════════
// Small async utilities
// ════════════════════════════════════════════════════════════════════

// An Error with a code, so pushErrorMessage can say something useful.
function pushErr(code, message) {
  const e = new Error(message || code);
  e.pushCode = code;
  return e;
}

// Resolve/reject like `p`, or reject with `code` after `ms`. The underlying
// work keeps going — RTDB in particular will still deliver a queued write
// once the phone is back online.
function pushWithTimeout(p, ms, code) {
  let timer;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(pushErr(code || 'timeout')), ms); }),
  ]);
}

// One plain-English sentence for any failure in this file. Never silent:
// every user-initiated path ends in a toast or a result line.
function pushErrorMessage(err) {
  const code = (err && (err.pushCode || err.code)) || '';
  const server = err && err.serverError;
  if (server === 'not-editor') return 'Only directors can send alerts.';
  if (server === 'not-member') return "The alert sender doesn't think you're on the camp list. Try signing out and back in.";
  if (server === 'rate') return 'Give it a few seconds between sends.';
  if (err && err.serverMessage) return err.serverMessage;
  switch (code) {
    case 'unsupported': return "This browser can't get phone alerts.";
    case 'sw-timeout': return "This phone didn't finish setting up alerts. Close Camp completely, reopen it, and try again.";
    case 'sw-failed': return "This phone couldn't start the alerts helper. Close Camp completely, reopen it, and try again.";
    case 'vapid': return "Couldn't reach the alert sender — check your connection and try again.";
    case 'subscribe': return 'This phone refused to set up alerts. Check that notifications are allowed for Camp, then try again.';
    case 'save-timeout': return "Couldn't save — check your connection and try again.";
    case 'not-signed-in': return "You're not signed in — sign in again and retry.";
    case 'network': return pushCspBlocked
      ? "The site's security settings are blocking the alert sender (see the note under Camp week)."
      : "Couldn't reach the alert sender — check your connection.";
    case 'timeout': return 'The alert sender took too long to answer — try again in a moment.';
    case 'PERMISSION_DENIED': case 'permission_denied':
      return "The database refused — phone alerts may not be switched on in the rules yet (ask Patrick).";
    default: return 'Something went wrong with phone alerts — try again in a moment.';
  }
}

// fetch() with a deadline. A dead connection must end in a message, not a
// spinner that never stops.
function pushFetch(url, opts, ms) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, ms || 15000);
  return fetch(url, Object.assign({}, opts, ctrl ? { signal: ctrl.signal } : {}))
    .catch((e) => { throw pushErr(e && e.name === 'AbortError' ? 'timeout' : 'network', String(e && e.message)); })
    .finally(() => clearTimeout(timer));
}

function pushIdToken() {
  try {
    const u = typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser;
    if (!u) return Promise.reject(pushErr('not-signed-in'));
    return u.getIdToken();
  } catch (e) { return Promise.reject(pushErr('not-signed-in')); }
}

// POST JSON to the Worker; resolves with its JSON body, rejects with an Error
// carrying serverError/serverMessage when it said no.
async function pushPost(path, body, withAuth) {
  const headers = { 'Content-Type': 'application/json' };
  if (withAuth) headers.Authorization = 'Bearer ' + await pushIdToken();
  const res = await pushFetch(pushServiceBase() + path, { method: 'POST', headers, body: JSON.stringify(body) }, 20000);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON — handled below */ }
  if (!res.ok || !data || data.ok === false) {
    const err = pushErr('http-' + res.status, (data && data.message) || 'HTTP ' + res.status);
    err.serverError = data && data.error;
    err.serverMessage = data && typeof data.message === 'string' ? data.message : '';
    throw err;
  }
  return data;
}

async function pushGet(path, ms) {
  const res = await pushFetch(pushServiceBase() + path, { method: 'GET', cache: 'no-store' }, ms || 10000);
  let data = null;
  try { data = await res.json(); } catch (e) { /* handled below */ }
  if (!res.ok || !data) throw pushErr('http-' + res.status);
  return data;
}

// The Worker answers /notify with up to 20 sends done inline and the rest
// parked as outbox batches; poking /drain for each gets them out now instead
// of on the next cron minute. Fire-and-forget: the cron is the backstop, so a
// failure here only means a few seconds' delay.
function pushDrainBatches(ids) {
  if (!Array.isArray(ids) || !pushConfigured()) return;
  ids.slice(0, 50).forEach((id) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) return;
    try {
      fetch(pushServiceBase() + '/drain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: id }),
      }).catch(() => { /* the cron drains it */ });
    } catch (e) { /* the cron drains it */ }
  });
}

// The sender's public key. Prefers the copy prefetched when the drawer
// opened, so the tap → subscribe chain doesn't wait on the network (iOS is
// strict about how long a tap's "user activation" lasts).
function pushVapidKey() {
  if (!pushVapidPrefetch) pushPrefetchVapid();
  return pushVapidPrefetch.catch(() => {
    pushVapidPrefetch = null; // retry once, fresh
    pushPrefetchVapid();
    return pushVapidPrefetch;
  });
}

function pushPrefetchVapid() {
  pushVapidPrefetch = pushGet('/vapid-key', 12000)
    .then((data) => {
      if (!pushValidVapidKey(data && data.publicKey)) throw pushErr('vapid');
      return data.publicKey;
    })
    .catch((e) => { throw e && e.pushCode === 'network' ? e : pushErr('vapid'); });
  pushVapidPrefetch.catch(() => {}); // a failed prefetch isn't an error until someone needs it
  return pushVapidPrefetch;
}

// ════════════════════════════════════════════════════════════════════
// Service worker
// ════════════════════════════════════════════════════════════════════

// sw.js?v=2[&push=<Worker URL>] — the worker can't read this file, so the
// one thing it needs (where to report a rotated subscription) rides in its
// own URL.
function pushSwUrl() {
  return 'sw.js?v=' + PUSH_SW_VERSION + (pushConfigured() ? '&push=' + encodeURIComponent(pushServiceBase()) : '');
}

// Called from app.js init() in place of the old bare register('sw.js').
// updateViaCache:'none' makes every update check fetch sw.js fresh, so a
// deploy reaches the worker without waiting out the HTTP cache.
function pushRegisterServiceWorker() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return Promise.resolve(null);
  try {
    return navigator.serviceWorker.register(pushSwUrl(), { scope: './', updateViaCache: 'none' })
      .catch((e) => { console.warn('[push] service worker registration failed', e); return null; });
  } catch (e) { return Promise.resolve(null); }
}

function pushSameScript(scriptURL, want) {
  try { return new URL(scriptURL).href === new URL(want, location.href).href; } catch (e) { return false; }
}

// Register (a no-op when already current) and wait until the ACTIVE worker is
// the one at today's URL. Subscribing through an older worker would bind the
// subscription to a script that may not have the push handler yet.
function pushRegistration() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return Promise.reject(pushErr('unsupported'));
  const want = pushSwUrl();
  return Promise.resolve(navigator.serviceWorker.register(want, { scope: './', updateViaCache: 'none' }))
    .catch(() => { throw pushErr('sw-failed'); })
    .then((reg) => {
      const current = () => reg.active && pushSameScript(reg.active.scriptURL, want);
      if (current()) return reg;
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          clearInterval(poll);
          if (ok) resolve(reg); else reject(pushErr('sw-timeout'));
        };
        const watch = (sw) => {
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (current()) finish(true);
            else if (sw.state === 'redundant' && !reg.installing && !reg.waiting && !current()) finish(false);
          });
        };
        watch(reg.installing);
        watch(reg.waiting);
        reg.addEventListener('updatefound', () => watch(reg.installing));
        // Belt and braces: statechange can land before we listen.
        const poll = setInterval(() => { if (current()) finish(true); }, 250);
        const timer = setTimeout(() => finish(current()), 10000);
      });
    });
}

// The existing registration only — for paths that must never install a
// worker as a side effect (sign-out, pref saves).
function pushExistingRegistration() {
  try {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker || !navigator.serviceWorker.getRegistration) {
      return Promise.resolve(null);
    }
    return navigator.serviceWorker.getRegistration().catch(() => null);
  } catch (e) { return Promise.resolve(null); }
}

// {endpoint, p256dh, auth} from a PushSubscription, base64url-encoded by us
// (toJSON's padding differs between browsers; the rules allow none).
function pushSubKeys(sub) {
  const endpoint = sub && sub.endpoint;
  const p256dh = sub && sub.getKey ? pushB64url(sub.getKey('p256dh')) : '';
  const auth = sub && sub.getKey ? pushB64url(sub.getKey('auth')) : '';
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1024 ||
      !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) {
    throw pushErr('subscribe', 'unexpected subscription shape');
  }
  return { endpoint, p256dh, auth };
}

// Does this subscription belong to the sender's current key? A subscription
// made under a different key can never be delivered to, so it gets replaced.
function pushSubMatchesKey(sub, key) {
  try {
    const have = sub && sub.options && sub.options.applicationServerKey;
    if (have) return pushB64url(have) === key;
  } catch (e) { /* fall through to the cached copy */ }
  let cached = null;
  try { cached = localStorage.getItem(PUSH_VAPID_KEY); } catch (e) { /* fine */ }
  return !cached || cached === key;
}

// Registration → key → subscription, reusing a good existing subscription.
async function pushSubscribe() {
  const reg = await pushRegistration();
  if (!reg.pushManager) throw pushErr('unsupported');
  const key = await pushVapidKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !pushSubMatchesKey(sub, key)) {
    try { await sub.unsubscribe(); } catch (e) { /* replaced below either way */ }
    sub = null;
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushB64urlToBytes(key) });
    } catch (e) {
      throw pushErr('subscribe', String(e && e.message));
    }
  }
  try { localStorage.setItem(PUSH_VAPID_KEY, key); } catch (e) { /* fine */ }
  return sub;
}

async function pushUnsubscribeBrowser() {
  const reg = await pushExistingRegistration();
  const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
  if (sub) await sub.unsubscribe();
}

// The permission prompt, in either API shape (old Safari used a callback).
function pushRequestPermission() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    try {
      const p = Notification.requestPermission(done);
      if (p && typeof p.then === 'function') p.then(done, () => done(Notification.permission));
    } catch (e) { done(Notification.permission); }
  });
}

// ════════════════════════════════════════════════════════════════════
// The device record
// ════════════════════════════════════════════════════════════════════

// Write (or rewrite) this phone's record in the active camp. A timeout is NOT
// a failure here: RTDB holds the write and delivers it when the phone is back
// online, so the caller treats 'save-timeout' as "will finish later".
// (Both of these turn a synchronous throw — ref() throws on a key with an
// RTDB-illegal character — into a rejection, so every caller's one .catch
// covers it.)
function pushSaveRecord(sub) {
  try {
    const myKey = identityKey(authUser);
    const deviceId = pushDeviceId();
    if (!myKey || !deviceId) return Promise.reject(pushErr('not-signed-in'));
    const rec = pushDeviceRecord(pushSubKeys(sub), pushCurrentPrefs(), pushMyTeam(), pushDeviceLabel());
    return pushWithTimeout(firebase.database().ref(pushRecordPath(CAMP.id, myKey, deviceId)).set(rec), 10000, 'save-timeout');
  } catch (e) { return Promise.reject(e); }
}

function pushRemoveRecord(campId, deviceId) {
  try {
    const myKey = typeof authUser !== 'undefined' ? identityKey(authUser) : '';
    const dev = deviceId || pushDeviceId(false);
    if (!myKey || !dev || typeof firebase === 'undefined') return Promise.resolve();
    return pushWithTimeout(firebase.database().ref(pushRecordPath(campId || CAMP.id, myKey, dev)).remove(), 8000, 'save-timeout');
  } catch (e) { return Promise.reject(e); }
}

// Is what's stored the same as what we'd write now? (`at` aside.)
function pushRecordMatches(have, want) {
  if (!have || typeof have !== 'object') return false;
  return have.endpoint === want.endpoint && have.p256dh === want.p256dh && have.auth === want.auth &&
    (have.team || '') === (want.team || '') && (have.label || '') === (want.label || '') &&
    pushStableJson(normalizePushPrefs(have.prefs)) === pushStableJson(normalizePushPrefs(want.prefs));
}

// Called by chat.js when a 🔔 bell flips, and by the drawer's switches.
// Coalesced, so flicking through five switches is one write.
function pushPrefsChanged() {
  if (!pushConfigured() || !pushSyncReady || !pushIsOn()) return;
  clearTimeout(pushPrefsTimer);
  pushPrefsTimer = setTimeout(pushRewriteRecord, 600);
}

async function pushRewriteRecord() {
  try {
    const reg = await pushExistingRegistration();
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    if (!sub) {
      pushNeedsReconnect = true;
      renderPushDrawerIfOpen();
      return;
    }
    await pushSaveRecord(sub);
  } catch (e) {
    if (e && e.pushCode === 'save-timeout') return; // queued — lands when back online
    console.warn('[push] saving prefs failed', e);
    showToast("Couldn't save your alert settings — check your connection and try again.");
  }
}

// ════════════════════════════════════════════════════════════════════
// Flows the drawer's buttons run
// ════════════════════════════════════════════════════════════════════

function pushSetBusy(on) {
  pushBusy = !!on;
  const body = document.getElementById('alerts-body');
  if (!body || !body.querySelectorAll) return;
  body.querySelectorAll('[data-pa-busy]').forEach((b) => {
    if (on) b.setAttribute('disabled', ''); else b.removeAttribute('disabled');
  });
}

// "Turn on phone alerts" (and "Reconnect"). MUST run straight from the tap.
async function pushEnable() {
  if (pushBusy || !pushConfigured() || !pushSyncReady) return;
  if (pushEnvironment() !== 'ready') {
    renderPushDrawerIfOpen();
    return;
  }
  // Permission FIRST, before any other await: iOS only shows the prompt from
  // inside the tap that asked for it, and every await spends a little of that
  // tap's "user activation".
  let perm;
  try { perm = await pushRequestPermission(); } catch (e) { perm = Notification.permission; }
  if (perm !== 'granted') {
    showToast(perm === 'denied'
      ? 'Notifications are blocked for Camp — the steps to allow them are in Phone alerts.'
      : 'No problem — tap the button again whenever you want alerts.');
    renderPushDrawerIfOpen();
    return;
  }
  pushSetBusy(true);
  try {
    const sub = await pushSubscribe();
    try {
      await pushSaveRecord(sub);
      showToast('📲 Phone alerts are on for this phone.', { mine: true });
    } catch (e) {
      if (!e || e.pushCode !== 'save-timeout') throw e;
      // Held by RTDB until the connection is back — the self-heal on the next
      // open double-checks it landed.
      showToast('📲 Alerts will finish turning on when this phone is back online.');
    }
    pushSetOn(true);
    pushNeedsReconnect = false;
  } catch (e) {
    console.warn('[push] enable failed', e);
    showToast(pushErrorMessage(e));
  } finally {
    pushSetBusy(false);
    renderPushDrawerIfOpen();
  }
}

async function pushDisable() {
  if (pushBusy) return;
  pushSetBusy(true);
  try {
    let removed = true;
    try { await pushRemoveRecord(CAMP.id); } catch (e) { removed = false; }
    const otherOn = pushOnInOtherCamp();
    if (!removed && otherOn) {
      // The browser subscription is shared with the other camp, so it can't
      // be dropped — and with the record still here this phone would keep
      // buzzing. Say so rather than pretend.
      showToast("Couldn't turn alerts off — check your connection and try again.");
      return;
    }
    pushSetOn(false);
    pushNeedsReconnect = false;
    // One subscription per browser serves both camps; only drop it when no
    // camp on this phone still wants it. A dropped subscription also stops a
    // record we failed to delete — the sender cleans up dead endpoints.
    if (!otherOn) { try { await pushUnsubscribeBrowser(); } catch (e) { /* the record is gone — nothing is sent to it */ } }
    showToast('🔕 Phone alerts are off for this phone.');
  } finally {
    pushSetBusy(false);
    renderPushDrawerIfOpen();
  }
}

async function pushSendTest() {
  if (pushBusy) return;
  pushSetBusy(true);
  try {
    const res = await pushPost('/notify', { camp: CAMP.id, kind: 'test', deviceId: pushDeviceId(false) || undefined }, true);
    pushDrainBatches(res.batches);
    const n = (Number(res.sent) || 0) + (Number(res.queued) || 0);
    showToast(n
      ? '✅ Test sent — it should buzz in a few seconds.'
      : "The sender couldn't find this phone. Turn alerts off and on again.", { mine: !!n });
  } catch (e) {
    console.warn('[push] test failed', e);
    showToast(pushErrorMessage(e));
  } finally {
    pushSetBusy(false);
  }
}

// The one-tap reconnect, offered when the subscription vanished (iOS drops
// them now and then; re-subscribing needs a tap there).
function pushOfferReconnect() {
  renderPushDrawerIfOpen();
  if (pushReconnectToastShown) return;
  pushReconnectToastShown = true;
  const text = '📲 Phone alerts stopped on this phone — tap here to reconnect.';
  if (window.jellyToast) {
    try {
      const el = window.jellyToast(text, { tone: 'warning', duration: 0 });
      if (el && el.addEventListener) el.addEventListener('click', () => { pushEnable(); });
      return;
    } catch (e) { /* fall back to the plain toast */ }
  }
  showToast('📲 Phone alerts stopped on this phone — reconnect in Settings → Phone alerts.');
}

// ════════════════════════════════════════════════════════════════════
// Hooks called from app.js / chat.js (all typeof-guarded there)
// ════════════════════════════════════════════════════════════════════

// From initSync(), right after initChatSync(): membership is confirmed.
// Called INSIDE initSync's try block, whose catch turns sync off — so
// nothing here may throw synchronously; everything async reports itself.
function initPush() {
  if (pushSyncReady) return;
  pushSyncReady = true;
  try {
    // A notification tap that opened (or switched) the app: act on it now the
    // app has painted. Deferred a tick so the first renderAll lands first.
    if (pushPendingOpen) {
      const p = pushPendingOpen;
      pushPendingOpen = null;
      setTimeout(() => { try { pushHandleOpen(p.open, p.camp); } catch (e) { console.warn('[push] open failed', e); } }, 0);
    }
    if (!pushConfigured() || typeof firebase === 'undefined') return;
    pushSelfHeal().catch((e) => console.warn('[push] self-heal failed', e));
    if (typeof canEdit === 'function' && canEdit()) {
      pushMaybeRepublishSchedule().catch((e) => console.warn('[push] schedule republish failed', e));
    }
  } catch (e) { console.warn('[push] init failed', e); }
}

// On every approved load: if this phone had alerts on, make sure they still
// work — permission, worker, subscription, record — and quietly repair what
// drifted (a new endpoint after an OS update, a renamed team, a lost record).
async function pushSelfHeal() {
  if (!pushIsOn()) return;
  if (typeof Notification === 'undefined' || !navigator.serviceWorker) return;
  const perm = Notification.permission;
  if (perm === 'denied') {
    // They blocked us in the OS. Tidy up without a fuss; the drawer explains.
    pushSetOn(false);
    pushRemoveRecord(CAMP.id).catch(() => {});
    return;
  }
  if (perm !== 'granted') { pushNeedsReconnect = true; pushOfferReconnect(); return; }
  const reg = await pushRegistration();
  let sub = reg.pushManager ? await reg.pushManager.getSubscription() : null;
  if (!sub && !pushIsIOS()) {
    // Chrome & co. will re-subscribe without a tap once permission is granted.
    try { sub = await pushSubscribe(); } catch (e) { sub = null; }
  }
  if (!sub) { pushNeedsReconnect = true; pushOfferReconnect(); return; }
  const myKey = identityKey(authUser);
  const deviceId = pushDeviceId();
  if (!myKey || !deviceId) return;
  const want = pushDeviceRecord(pushSubKeys(sub), pushCurrentPrefs(), pushMyTeam(), pushDeviceLabel());
  const snap = await pushWithTimeout(firebase.database().ref(pushRecordPath(CAMP.id, myKey, deviceId)).once('value'), 15000);
  if (!pushRecordMatches(snap.val(), want)) {
    await pushSaveRecord(sub).catch((e) => { if (!e || e.pushCode !== 'save-timeout') throw e; });
  }
}

// From signOutAndClear(), BEFORE firebase signOut — afterwards the rules
// refuse the delete. Bounded at 3s so a dead connection can't trap anyone in
// a half-signed-out state. Never rejects.
function pushSignOut() {
  const work = (async () => {
    const tasks = [];
    if (pushConfigured() && typeof firebase !== 'undefined' && typeof authUser !== 'undefined' && authUser) {
      Object.keys(CAMPS).forEach((cid) => {
        if (cid === CAMP.id || pushIsOn(cid)) tasks.push(pushRemoveRecord(cid).catch(() => {}));
      });
    }
    // A shared phone must not keep getting the last person's alerts.
    tasks.push(pushUnsubscribeBrowser().catch(() => {}));
    await Promise.all(tasks);
  })();
  return pushWithTimeout(work, 3000)
    .catch(() => {})
    .then(() => { Object.keys(CAMPS).forEach((cid) => pushSetOn(false, cid)); });
}

// From chat.js after a message (or photo) has landed: ask the Worker to
// alert everyone who should hear about it. Never blocks or fails the send —
// at worst a phone doesn't buzz and the unread badge catches them up.
function pushNotifyChat(ch, msgId, text) {
  if (!pushConfigured() || !pushSyncReady) return Promise.resolve(null);
  if (typeof msgId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(msgId)) return Promise.resolve(null);
  let targets = { keys: [], teams: [] };
  try { targets = pushMentionTargets(text); } catch (e) { /* send without mentions */ }
  return pushPost('/notify', {
    camp: CAMP.id, kind: 'chat', ch, msgId, mentionKeys: targets.keys, mentionTeams: targets.teams,
  }, true)
    .then((res) => { pushDrainBatches(res && res.batches); return res; })
    .catch((e) => { console.warn('[push] chat notify failed', e); return null; });
}

// ════════════════════════════════════════════════════════════════════
// The published schedule (editors)
// ════════════════════════════════════════════════════════════════════

function pushPublishSchedule(weekStart) {
  return pushWithTimeout(firebase.database().ref(dbPath('pushSchedule')).set({
    weekStart,
    at: firebase.database.ServerValue.TIMESTAMP,
    by: identityKey(authUser),
    blocks: pushScheduleBlocks(DAY_SCHEDULE),
  }), 10000, 'save-timeout');
}

// The schedule is code (camps.js), so a deploy can change it. The first
// editor device to load a new build republishes — no tap — keeping the
// week the director already set. A week that was never set stays unset:
// there'd be nothing to remind anyone about.
async function pushMaybeRepublishSchedule() {
  const snap = await pushWithTimeout(firebase.database().ref(dbPath('pushSchedule')).once('value'), 15000);
  const cur = snap.val();
  pushWeekStart = cur && isValidWeekStart(cur.weekStart) ? cur.weekStart : null;
  renderPushWeekStatus();
  if (!pushWeekStart || !canEdit()) return;
  if (pushStableJson(cur.blocks || {}) === pushStableJson(pushScheduleBlocks(DAY_SCHEDULE))) return;
  await pushPublishSchedule(pushWeekStart);
}

// ════════════════════════════════════════════════════════════════════
// Notification taps and messages from sw.js
// ════════════════════════════════════════════════════════════════════

// A tap on a notification lands here with what to open: 'chat:<channel>' or
// 'schedule'. A notification from the OTHER camp switches camps first (the
// usual set-key-and-reload), carrying the target across in sessionStorage —
// but only into a camp this account is known to be on, so a stale alert can
// never bounce anyone into a denial screen.
function pushHandleOpen(open, camp) {
  const target = String(open || '');
  if (!/^(chat:[a-z0-9_-]{1,32}|schedule)$/.test(target)) return;
  if (camp && typeof CAMPS !== 'undefined' && CAMPS[camp] && camp !== CAMP.id) {
    const role = typeof readCampsHint === 'function' ? readCampsHint()[camp] : null;
    if ((role === 'editor' || role === 'viewer') && typeof switchCamp === 'function') {
      try { sessionStorage.setItem(PUSH_OPEN_KEY, JSON.stringify({ open: target, camp })); } catch (e) { /* opens the camp, not the channel */ }
      switchCamp(camp);
    }
    return; // never open the other camp's thing inside this one
  }
  if (target === 'schedule') {
    if (typeof openSchedule === 'function') openSchedule();
    return;
  }
  const ch = target.slice(5);
  if (typeof openChat === 'function' && (typeof chatChannelById !== 'function' || chatChannelById(ch))) openChat(ch);
}

function onPushServiceWorkerMessage(e) {
  const msg = e && e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'camp-open') {
    if (typeof appStarted !== 'undefined' && appStarted && pushSyncReady) pushHandleOpen(msg.open, msg.camp);
    else pushPendingOpen = { open: msg.open, camp: msg.camp };
    return;
  }
  if (msg.type !== 'camp-push') return;
  const p = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
  if (p.camp && p.camp !== CAMP.id) return; // the other camp's alert — the OS notification covers it
  // Chat kinds already toast from chat.js's own listener; only director
  // alerts need an in-app voice here (the OS notification shows too).
  if (p.kind !== 'alert' && p.kind !== 'urgent') return;
  const text = `${String(p.title || '📢 Alert').slice(0, 80)}: ${String(p.body || '').slice(0, 300)}`;
  if (p.kind === 'urgent' && window.jellyToast) {
    try { window.jellyToast(text, { tone: 'danger', duration: 0 }); } catch (err) { showToast(text, { mine: true }); }
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
  } else {
    showToast(text, { mine: true });
  }
}

function pushClearBadge() {
  try { if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {}); } catch (e) { /* unsupported */ }
}

// Read (and strip) ?open=… from a cold start via a notification tap, plus a
// target carried across a camp switch. Runs at load; acted on in initPush.
(function pushReadLaunchTarget() {
  try {
    const params = new URLSearchParams(location.search || '');
    const open = params.get('open');
    if (open) {
      pushPendingOpen = { open, camp: params.get('camp') || '' };
      params.delete('open');
      params.delete('camp');
      const qs = params.toString();
      if (typeof history !== 'undefined' && history.replaceState) {
        history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + (location.hash || ''));
      }
    }
  } catch (e) { /* no URL API — the tap just opens the app */ }
  try {
    const carried = sessionStorage.getItem(PUSH_OPEN_KEY);
    if (carried) {
      sessionStorage.removeItem(PUSH_OPEN_KEY);
      const c = JSON.parse(carried);
      if (c && c.camp === CAMP.id) pushPendingOpen = { open: c.open, camp: '' };
    }
  } catch (e) { /* fine */ }
})();

// From app.js init(): the Settings row, the worker's messages, the badge.
// init() wires the whole app in sequence, so this must never throw out.
function wirePush() {
  try {
    const row = document.getElementById('alerts-row');
    if (row) row.addEventListener('click', openPushDrawer);
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        try { onPushServiceWorkerMessage(e); } catch (err) { console.warn('[push] message failed', err); }
      });
    }
    // Opening the app is "seeing" whatever the badge was for; chat re-applies
    // its real unread count on its next render.
    pushClearBadge();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pushClearBadge(); });
    // A CSP that doesn't list the Worker blocks every request with nothing but
    // a console line. Catch it, so the drawer can name the actual problem.
    document.addEventListener('securitypolicyviolation', (e) => {
      try {
        if (pushConfigured() && String(e.blockedURI || '').startsWith(new URL(pushServiceBase()).origin)) {
          pushCspBlocked = true;
        }
      } catch (err) { /* fine */ }
    });
  } catch (e) { console.warn('[push] wiring failed', e); }
}

// ════════════════════════════════════════════════════════════════════
// The drawer (Settings → 📲 Phone alerts)
// ════════════════════════════════════════════════════════════════════

function pushDrawerEl() {
  return document.getElementById('alerts-overlay');
}

function pushDrawerOpen() {
  const d = pushDrawerEl();
  return !!(d && d.hasAttribute && d.hasAttribute('open'));
}

function renderPushDrawerIfOpen() {
  if (pushDrawerOpen()) renderPushDrawer();
}

// Same hand-off as openMembers: let the Settings drawer finish closing
// before this one opens, so their scroll-lock/inert bookkeeping never overlap.
function openPushDrawer() {
  const s = document.getElementById('settings-overlay');
  const overlay = pushDrawerEl();
  if (!overlay) return;
  pushAlertResult = '';
  renderPushDrawer();
  pushRefreshServerBits();
  const openNow = () => overlay.setAttribute('open', '');
  if (s && s.hasAttribute('open') && customElements.get('jelly-drawer')) {
    s.addEventListener('close', openNow, { once: true });
    s.removeAttribute('open');
  } else {
    if (s) s.removeAttribute('open');
    openNow();
  }
}

// What the status card should say.
function pushStatus() {
  if (!pushConfigured()) return 'dormant';
  if (typeof firebase === 'undefined') return 'nosync';
  const env = pushEnvironment();
  if (env === 'denied' || env === 'unsupported' || env === 'ios-needs-install' || env === 'ios-too-old') return env;
  if (!pushSyncReady) return 'connecting';
  if (!pushIsOn()) return 'off';
  if (pushNeedsReconnect || Notification.permission !== 'granted') return 'reconnect';
  return 'on';
}

// Fetch the things only the server knows, then patch them into the open
// drawer in place (a full re-render would reset whatever is being typed).
function pushRefreshServerBits() {
  if (!pushConfigured() || !pushSyncReady || typeof firebase === 'undefined') return;
  try {
    const st = pushStatus();
    if (st === 'off' || st === 'reconnect') pushPrefetchVapid();
    firebase.database().ref(dbPath('pushSchedule/weekStart')).once('value')
      .then((snap) => { const v = snap.val(); pushWeekStart = isValidWeekStart(v) ? v : null; })
      .catch(() => { pushWeekStart = null; })
      .then(renderPushWeekStatus);
    if (pushIsOn()) pushLoadDevices();
    if (typeof canEdit === 'function' && canEdit()) {
      pushLoadRecentAlerts();
      pushHealth = undefined;
      renderPushHealth();
      pushGet('/health', 8000)
        .then((h) => { pushHealth = h && typeof h === 'object' ? h : null; })
        .catch(() => { pushHealth = null; })
        .then(renderPushHealth);
    }
  } catch (e) {
    // A throw here would stop the drawer opening at all; the lines it was
    // filling just stay on "Loading…".
    console.warn('[push] refreshing the drawer failed', e);
  }
}

// ── Rendering ─────────────────────────────────────────────────────

function pushSwitchHTML(attrs, checked, disabled, label) {
  return `<jelly-switch size="small" ${attrs} ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} label="${esc(label)}"></jelly-switch>`;
}

function pushRowHTML(label, hint, control, extraClass) {
  return `<div class="pa-row${extraClass ? ' ' + extraClass : ''}">
    <span class="pa-row-text"><span class="pa-row-label">${label}</span>${hint ? `<span class="pa-row-hint">${hint}</span>` : ''}</span>
    ${control}
  </div>`;
}

function pushStatusHTML(st) {
  const editor = typeof canEdit === 'function' && canEdit();
  const ios = pushIsIOS();
  switch (st) {
    case 'dormant':
      return editor
        ? `<p class="pa-lead">Not connected yet</p>
           <p class="pa-note">The alert sender — a small, free Cloudflare service — needs setting up first; push-worker/README.md walks through it. Until then, alerts only reach phones with Camp open.</p>`
        : `<p class="pa-lead">Coming soon</p>
           <p class="pa-note">For now, alerts reach your phone while Camp is open.</p>`;
    case 'nosync':
      return `<p class="pa-lead">Phone alerts need live sync, which is off on this device.</p>`;
    case 'unsupported':
      return `<p class="pa-lead">This browser can't get phone alerts</p>
        <p class="pa-note">On iPhone, open Camp in Safari and add it to your Home Screen. On Android, use Chrome.</p>`;
    case 'ios-too-old':
      return `<p class="pa-lead">Phone alerts need iOS 16.4 or newer</p>
        <p class="pa-note">Update in Settings → General → Software Update, then come back here.</p>`;
    case 'ios-needs-install':
      return `<p class="pa-lead">On iPhone, alerts only work from the Home Screen</p>
        <ol class="pa-steps">
          <li>Tap <strong>Share</strong> <span aria-hidden="true">⬆️</span> in Safari's toolbar.</li>
          <li>Choose <strong>Add to Home Screen</strong>.</li>
          <li>Open <strong>Camp</strong> from the new icon on your Home Screen.</li>
          <li>Come back to Settings → Phone alerts.</li>
        </ol>`;
    case 'denied': {
      const iphone = '<li><strong>iPhone:</strong> Settings → Notifications → Camp → Allow Notifications.</li>';
      const android = '<li><strong>Android:</strong> tap the lock icon next to the address → Notifications → Allow. (Installed app: long-press its icon → App info → Notifications.)</li>';
      return `<p class="pa-lead">Notifications are blocked for Camp on this phone</p>
        <ul class="pa-steps">${ios ? iphone : (/Android/.test(navigator.userAgent) ? android : iphone + android)}</ul>
        <p class="pa-note">Then come back here and turn alerts on.</p>`;
    }
    case 'connecting':
      return `<p class="pa-lead">Connecting…</p><p class="pa-note">One moment — Camp is still signing in.</p>`;
    case 'off':
      return `<p class="pa-lead">Get a buzz even when Camp is closed</p>
        <p class="pa-note">Announcements, someone mentioning you or your team, director alerts, and any schedule blocks you pick.</p>
        <jelly-button id="pa-enable" data-pa-busy variant="primary" block ${pushBusy ? 'disabled' : ''}>Turn on phone alerts</jelly-button>`;
    case 'reconnect':
      return `<p class="pa-lead">⚠️ Alerts on this phone stopped working</p>
        <p class="pa-note">Phones sometimes drop the connection after an update. One tap fixes it.</p>
        <jelly-button id="pa-enable" data-pa-busy variant="primary" block ${pushBusy ? 'disabled' : ''}>Reconnect phone alerts</jelly-button>
        <button type="button" id="pa-disable" class="link-btn pa-off-link">Turn alerts off instead</button>`;
    case 'on':
    default:
      // The test is the action people want; turning off is a quiet link, not
      // a second button of equal weight.
      return `<p class="pa-lead">✅ Alerts are on for this phone</p>
        <div class="pa-actions">
          <jelly-button id="pa-test" data-pa-busy size="small" variant="platinum" ${pushBusy ? 'disabled' : ''}>Send me a test</jelly-button>
          <button type="button" id="pa-disable" data-pa-busy class="link-btn pa-off-link">Turn off on this phone</button>
        </div>
        <div id="pa-devices" class="pa-devices"></div>`;
  }
}

function pushPrefsHTML() {
  const prefs = pushCurrentPrefs();
  const channels = (CAMP.chatChannels || []);
  const ordered = channels.slice().sort((a, b) => (a.id === 'announcements' ? -1 : b.id === 'announcements' ? 1 : 0));
  const chatRows = ordered.map((c) => pushRowHTML(
    `${c.emoji} ${esc(c.short)}`, '',
    pushSwitchHTML(`data-pa-pref="ch" data-ch="${esc(c.id)}"`, prefs.ch[c.id], false, `Every message in ${c.short}`),
  )).join('') +
    pushRowHTML('🙋 Mentions of me or my team', '',
      pushSwitchHTML('data-pa-pref="mention"', prefs.mention, false, 'When someone mentions me or my team')) +
    pushRowHTML('📢 Director alerts', '🚨 Urgent ones always come through',
      pushSwitchHTML('data-pa-pref="director"', prefs.director, false, 'Director alerts'));

  const catalog = pushBlockCatalog(DAY_SCHEDULE);
  // Each "Mon–Fri 5:00 PM" piece stays on one line; the list breaks between
  // pieces, never inside a time.
  const whenHTML = (when) => when.split(' · ').map((seg) => `<span class="pa-when">${esc(seg)}</span>`).join(' · ');
  const blockRows = catalog.map((b) => pushRowHTML(
    `${esc(b.emoji)} ${esc(b.label)}`, whenHTML(b.when),
    pushSwitchHTML(`data-pa-pref="block" data-key="${esc(b.key)}"`, prefs.blocksAll || !!prefs.blocks[b.key], prefs.blocksAll, b.label),
    'pa-block-row' + (prefs.blocksAll ? ' pa-row-off' : ''),
  )).join('');

  return `<section class="pa-section">
    <h3 class="pa-heading">What buzzes this phone</h3>
    <p class="pa-group">Chat</p>
    <div class="pa-list">${chatRows}</div>
    <p class="pa-foot">A channel that's on buzzes for every message — the same setting as its 🔔 bell in Chat.</p>
    <p class="pa-group">Schedule</p>
    <div class="pa-list">
      <div class="pa-row pa-row-lead">
        <span class="pa-row-text"><span class="pa-row-label">How early</span></span>
        <jelly-segmented id="pa-lead" size="small" label="How many minutes before a block" value="${prefs.lead}">
          <jelly-segment value="5">5 min</jelly-segment>
          <jelly-segment value="10">10 min</jelly-segment>
          <jelly-segment value="15">15 min</jelly-segment>
        </jelly-segmented>
      </div>
      ${pushRowHTML('Every schedule block', '', pushSwitchHTML('data-pa-pref="blocksAll"', prefs.blocksAll, false, 'Every schedule block'))}
    </div>
    <p class="pa-foot" id="pa-week-note" hidden></p>
    <div class="pa-list pa-blocks">${blockRows}</div>
  </section>`;
}

function pushComposerHTML() {
  const d = pushAlertDraft;
  const teams = ((typeof state !== 'undefined' && state.teams) || []).filter((t) => PUSH_TEAM_RE.test(t.id));
  const audiences = [['all', 'Everyone'], ['editors', 'Directors only']]
    .concat(teams.map((t) => [t.id, `${teamEmoji(t.id)} ${t.name} counselors`]));
  if (!audiences.some((a) => a[0] === d.audience)) d.audience = 'all';
  return `<section class="pa-section">
    <h3 class="pa-heading">📢 Send an alert</h3>
    <p class="pa-note">Goes to phones with alerts on, even with Camp closed.</p>
    <jelly-textarea id="pa-alert-text" class="form-textarea pa-alert-text" rows="3" label="Alert message"
      placeholder="e.g. Everyone to the Tabernacle at 7 — bring a flashlight" value="${esc(d.text)}"></jelly-textarea>
    <p class="pa-count" id="pa-alert-count">${d.text.length}/${PUSH_ALERT_MAX}</p>
    <div class="pa-list">
      <div class="pa-row pa-row-audience">
        <span class="pa-row-text"><span class="pa-row-label">Send to</span></span>
        <jelly-select id="pa-audience" size="small" label="Who gets the alert" value="${esc(d.audience)}">
          ${audiences.map(([v, l]) => `<jelly-option value="${esc(v)}">${esc(l)}</jelly-option>`).join('')}
        </jelly-select>
      </div>
      ${pushRowHTML('🚨 Urgent', 'Rings through even on phones that muted director alerts',
        pushSwitchHTML('id="pa-urgent"', d.urgent, false, 'Urgent'))}
    </div>
    <jelly-button id="pa-send" variant="${d.urgent ? 'rose' : 'primary'}" block ${pushSending ? 'disabled' : ''}>${d.urgent ? '🚨 Send urgent alert' : 'Send alert'}</jelly-button>
    <p class="pa-result" id="pa-alert-result" aria-live="polite"${pushAlertResult ? '' : ' hidden'}>${esc(pushAlertResult)}</p>
    <p class="pa-group">Recent</p>
    <div id="pa-recent" class="pa-recent"><p class="pa-note">Loading…</p></div>
  </section>`;
}

function pushWeekHTML() {
  return `<section class="pa-section">
    <h3 class="pa-heading">🗓️ Camp week</h3>
    <div class="form-field pa-week-field">
      <label class="form-label" for="pa-week-input">Starts on (a Sunday)</label>
      <div class="pa-week-row">
        <input type="date" id="pa-week-input" class="form-input pa-week-input" value="${esc(pushWeekStart || '')}">
        <jelly-button id="pa-week-save" size="small" variant="primary">Save</jelly-button>
      </div>
    </div>
    <p class="pa-note" id="pa-week-status">Loading…</p>
    <p class="pa-note" id="pa-health">Checking the sender…</p>
  </section>`;
}

function renderPushDrawer() {
  const body = document.getElementById('alerts-body');
  if (!body) return;
  try {
    const st = pushStatus();
    const editor = typeof canEdit === 'function' && canEdit();
    const live = pushConfigured() && pushSyncReady && typeof firebase !== 'undefined';
    body.innerHTML = `
      <div class="pa-card pa-status pa-status-${esc(st)}">${pushStatusHTML(st)}</div>
      ${st === 'on' ? pushPrefsHTML() : ''}
      ${editor && live ? pushComposerHTML() + pushWeekHTML() : ''}`;
    wirePushDrawer(body);
    renderPushWeekStatus();
    renderPushHealth();
    renderPushRecent();
    renderPushDevices();
  } catch (e) {
    // The drawer is the only place this can surface — never let it throw out.
    console.warn('[push] drawer render failed', e);
    body.innerHTML = '<p class="muted">Phone alerts hit a snag — close this and try again.</p>';
  }
}

// The week line (in the composer section) + the schedule note (in prefs).
function renderPushWeekStatus() {
  const status = document.getElementById('pa-week-status');
  const note = document.getElementById('pa-week-note');
  const input = document.getElementById('pa-week-input');
  if (input && pushWeekStart && !input.value && document.activeElement !== input) input.value = pushWeekStart;
  const label = pushWeekLabel(pushWeekStart);
  let over = false;
  if (pushWeekStart && typeof campDateStr === 'function') {
    const [y, mo, d] = pushWeekStart.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, mo - 1, d + 6)).toISOString().slice(0, 10);
    over = campDateStr() > lastDay;
  }
  if (status) {
    status.textContent = pushWeekStart === undefined ? 'Loading…'
      : !pushWeekStart ? 'Not set — schedule alerts are off until you pick the Sunday camp starts.'
        : over ? `Last set for ${label} — that week is over. Pick next camp's Sunday when it's time.`
          : `Schedule alerts are live for ${label}.`;
  }
  if (note) {
    note.hidden = pushWeekStart === undefined || (!!pushWeekStart && !over);
    note.textContent = 'Schedule alerts start once a director sets the camp week.';
  }
}

function renderPushHealth() {
  const el = document.getElementById('pa-health');
  if (!el) return;
  if (pushHealth === undefined) { el.textContent = 'Sender: checking…'; return; }
  if (pushHealth === null) {
    el.textContent = pushCspBlocked
      ? `Sender: ❌ blocked by this site's security policy — add ${pushServiceBase()} to connect-src in index.html.`
      : "Sender: ❌ can't reach it right now.";
    return;
  }
  const h = pushHealth;
  if (!h.configured) { el.textContent = "Sender: ❌ running, but not connected to Firebase — see push-worker/README.md."; return; }
  const now = Number(h.time) || Date.now();
  const last = Number(h.cronLastRun) || 0;
  if (!last) { el.textContent = "Sender: ⚠️ online, but its schedule timer has never run — add the cron trigger."; return; }
  const mins = Math.max(0, Math.round((now - last) / 60000));
  if (mins > 5) { el.textContent = `Sender: ⚠️ online, but its timer last ran ${mins} min ago.`; return; }
  el.textContent = `Sender: ✅ online · timer ran ${mins < 1 ? 'just now' : mins + ' min ago'}`;
}

let pushRecentRows; // undefined = loading, null = failed, [] = none
function pushLoadRecentAlerts() {
  pushRecentRows = undefined;
  firebase.database().ref(dbPath('pushAlerts')).orderByKey().limitToLast(5).once('value')
    .then((snap) => {
      const v = snap.val() || {};
      pushRecentRows = Object.keys(v).sort().reverse().map((k) => v[k]).filter((r) => r && typeof r === 'object');
    })
    .catch(() => { pushRecentRows = null; })
    .then(renderPushRecent);
}

function pushAlertTime(at) {
  const n = Number(at);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
      .format(new Date(Math.min(n, 8.64e15)));
  } catch (e) { return ''; }
}

function renderPushRecent() {
  const el = document.getElementById('pa-recent');
  if (!el) return;
  if (pushRecentRows === undefined) { el.innerHTML = '<p class="pa-note">Loading…</p>'; return; }
  if (pushRecentRows === null) { el.innerHTML = '<p class="pa-note">Couldn\'t load recent alerts.</p>'; return; }
  if (!pushRecentRows.length) { el.innerHTML = '<p class="pa-note">No alerts sent yet.</p>'; return; }
  el.innerHTML = pushRecentRows.map((r) => {
    const sent = Number(r.sent) || 0;
    const failed = Number(r.failed) || 0;
    const counts = `${sent} phone${sent === 1 ? '' : 's'}${failed ? `, ${failed} missed` : ''}`;
    const who = typeof r.byName === 'string' && r.byName.trim() ? '— ' + r.byName.trim().slice(0, 60) : '';
    return `<div class="pa-alert">
      <div class="pa-alert-meta">${r.urgent === true ? '<span class="pa-urgent-tag">Urgent</span>' : ''}<span>${esc(pushAlertTime(r.at))}</span></div>
      <p class="pa-alert-body">${esc(String(r.text || '').slice(0, PUSH_ALERT_MAX))}</p>
      <p class="pa-alert-by">${esc([who, pushAudienceLabel(r.audience), counts].filter(Boolean).join(' · '))}</p>
    </div>`;
  }).join('');
}

// This person's OTHER phones with alerts on — mostly so an old phone can be
// cleared off. Hidden when this is the only one (nearly everyone).
let pushDevices; // undefined = loading/none to show
function pushLoadDevices() {
  const myKey = identityKey(authUser);
  if (!myKey) return;
  firebase.database().ref(dbPath('push/' + myKey)).once('value')
    .then((snap) => { pushDevices = snap.val() || {}; })
    .catch(() => { pushDevices = undefined; })
    .then(renderPushDevices);
}

function renderPushDevices() {
  const el = document.getElementById('pa-devices');
  if (!el) return;
  const mine = pushDeviceId(false);
  const others = Object.keys(pushDevices || {}).filter((id) => id !== mine && pushDevices[id] && typeof pushDevices[id] === 'object');
  if (!others.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<p class="pa-group">Also getting your alerts</p>` + others.map((id) => `
    <div class="pa-device">
      <span>${esc(String(pushDevices[id].label || 'Another device').slice(0, 40))}</span>
      <button type="button" class="link-btn danger-link pa-device-remove" data-device="${esc(id)}">Remove</button>
    </div>`).join('');
  el.querySelectorAll('.pa-device-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.device;
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id || '')) return;
      btn.setAttribute('disabled', '');
      pushRemoveRecord(CAMP.id, id)
        .then(() => { delete pushDevices[id]; renderPushDevices(); showToast('Removed — that device won\'t get alerts any more.'); })
        .catch(() => { btn.removeAttribute('disabled'); showToast("Couldn't remove it — check your connection."); });
    });
  });
}

// ── Wiring ────────────────────────────────────────────────────────

function wirePushDrawer(body) {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('pa-enable', 'click', () => { pushEnable(); });
  on('pa-disable', 'click', () => {
    if (confirm('Turn off phone alerts on this phone?')) pushDisable();
  });
  on('pa-test', 'click', () => { pushSendTest(); });

  // Preference switches. Attribute reads, not .checked: the element may not
  // have upgraded yet, and a pre-upgrade property would shadow the accessor.
  body.querySelectorAll('jelly-switch[data-pa-pref]').forEach((sw) => {
    sw.addEventListener('change', () => {
      const checked = sw.hasAttribute('checked');
      const kind = sw.dataset.paPref;
      if (kind === 'ch') {
        if (typeof setChatSub === 'function') setChatSub(sw.dataset.ch, checked);
      } else if (kind === 'block') {
        const blocks = Object.assign({}, normalizePushPrefs(pushReadStoredPrefs()).blocks);
        if (checked) blocks[sw.dataset.key] = true; else delete blocks[sw.dataset.key];
        pushStorePrefs({ blocks });
      } else if (kind === 'mention' || kind === 'director' || kind === 'blocksAll') {
        pushStorePrefs({ [kind]: checked });
        if (kind === 'blocksAll') pushSyncBlockRows(body, checked);
      }
      pushPrefsChanged();
    });
  });
  on('pa-lead', 'change', (e) => {
    const lead = Number((e.detail && e.detail.value) || (e.target && e.target.value));
    if (!PUSH_LEADS.includes(lead)) return;
    pushStorePrefs({ lead });
    pushPrefsChanged();
  });

  // Composer.
  const text = document.getElementById('pa-alert-text');
  if (text) {
    const cap = () => {
      // jelly-textarea has no maxlength attribute; cap its inner field once
      // it exists, and trim anything pasted past the limit regardless.
      const inner = text.shadowRoot && text.shadowRoot.querySelector('textarea');
      if (inner) inner.maxLength = PUSH_ALERT_MAX;
    };
    if (window.customElements && customElements.whenDefined) customElements.whenDefined('jelly-textarea').then(cap).catch(() => {});
    text.addEventListener('input', () => {
      let v = String(text.value || '');
      if (v.length > PUSH_ALERT_MAX) { v = v.slice(0, PUSH_ALERT_MAX); text.value = v; }
      pushAlertDraft.text = v;
      const count = document.getElementById('pa-alert-count');
      if (count) count.textContent = `${v.length}/${PUSH_ALERT_MAX}`;
    });
  }
  on('pa-audience', 'change', (e) => {
    const v = String((e.target && e.target.value) || 'all');
    pushAlertDraft.audience = v;
  });
  on('pa-urgent', 'change', (e) => {
    pushAlertDraft.urgent = !!(e.target && e.target.hasAttribute('checked'));
    const send = document.getElementById('pa-send');
    if (send) {
      send.setAttribute('variant', pushAlertDraft.urgent ? 'rose' : 'primary');
      send.textContent = pushAlertDraft.urgent ? '🚨 Send urgent alert' : 'Send alert';
    }
  });
  on('pa-send', 'click', () => { pushSendAlert(); });

  // Camp week.
  on('pa-week-save', 'click', () => {
    const input = document.getElementById('pa-week-input');
    pushSaveWeekStart(input ? input.value : '');
  });
}

// "Every schedule block" on ⇒ each block row shows on and can't be changed
// (their own choices are kept underneath for when it goes back off).
function pushSyncBlockRows(body, all) {
  const chosen = normalizePushPrefs(pushReadStoredPrefs()).blocks;
  body.querySelectorAll('jelly-switch[data-pa-pref="block"]').forEach((sw) => {
    sw.toggleAttribute('checked', all || !!chosen[sw.dataset.key]);
    sw.toggleAttribute('disabled', all);
    const row = sw.closest && sw.closest('.pa-row');
    if (row) row.classList.toggle('pa-row-off', all);
  });
}

async function pushSendAlert() {
  if (pushSending) return;
  if (!(typeof canEdit === 'function' && canEdit())) { showToast('Only directors can send alerts.'); return; }
  const text = String(pushAlertDraft.text || '').trim().slice(0, PUSH_ALERT_MAX);
  if (!text) { showToast('Type the alert first.'); return; }
  const audience = pushAlertDraft.audience || 'all';
  const urgent = !!pushAlertDraft.urgent;
  const who = pushAudienceLabel(audience);
  if (urgent && !confirm(`Send an URGENT alert to ${who}? It rings through even on phones that muted director alerts.`)) return;
  if (!urgent && audience === 'all' && !confirm("Send this alert to everyone's phone?")) return;
  pushSending = true;
  const send = document.getElementById('pa-send');
  if (send) send.setAttribute('disabled', '');
  pushSetResult('Sending…');
  try {
    const res = await pushPost('/notify', { camp: CAMP.id, kind: 'alert', text, audience, urgent }, true);
    pushDrainBatches(res.batches);
    const n = (Number(res.sent) || 0) + (Number(res.queued) || 0);
    const failed = Number(res.failed) || 0;
    pushSetResult(n
      ? `✅ Sent to ${n} phone${n === 1 ? '' : 's'}${failed ? ` · ${failed} couldn't be reached` : ''}.`
      : `Nobody in "${who}" has phone alerts on yet — nothing was sent.`);
    pushAlertDraft = { text: '', audience, urgent: false };
    pushResetComposer();
    pushLoadRecentAlerts();
  } catch (e) {
    console.warn('[push] alert failed', e);
    pushSetResult('❌ ' + pushErrorMessage(e));
  } finally {
    pushSending = false;
    const btn = document.getElementById('pa-send');
    if (btn) btn.removeAttribute('disabled');
  }
}

// Clear the composer in place after a send (a full re-render would also
// rebuild every switch above it and jump the scroll position).
function pushResetComposer() {
  const text = document.getElementById('pa-alert-text');
  if (text) text.value = '';
  const count = document.getElementById('pa-alert-count');
  if (count) count.textContent = `0/${PUSH_ALERT_MAX}`;
  const urgent = document.getElementById('pa-urgent');
  if (urgent) urgent.removeAttribute('checked');
  const send = document.getElementById('pa-send');
  if (send) { send.setAttribute('variant', 'primary'); send.textContent = 'Send alert'; }
}

function pushSetResult(text) {
  pushAlertResult = text;
  const el = document.getElementById('pa-alert-result');
  if (el) { el.textContent = text; el.hidden = !text; }
}

async function pushSaveWeekStart(value) {
  if (!(typeof canEdit === 'function' && canEdit())) return;
  if (!isValidWeekStart(value)) {
    showToast(value ? 'Pick a Sunday — the camp week starts on Sunday.' : 'Pick the Sunday camp starts first.');
    return;
  }
  const btn = document.getElementById('pa-week-save');
  if (btn) btn.setAttribute('disabled', '');
  try {
    await pushPublishSchedule(value);
    pushWeekStart = value;
    showToast(`🗓️ Schedule alerts are set for ${pushWeekLabel(value)}.`, { mine: true });
  } catch (e) {
    if (e && e.pushCode === 'save-timeout') {
      pushWeekStart = value;
      showToast('🗓️ Saved on this phone — it will reach everyone when you\'re back online.');
    } else {
      console.warn('[push] saving the week failed', e);
      showToast(pushErrorMessage(e));
    }
  } finally {
    if (btn) btn.removeAttribute('disabled');
    renderPushWeekStatus();
  }
}
