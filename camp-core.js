// ── camp-core.js — pure helpers the app AND the TV page share ──────────
// Loaded by index.html (before app.js) and by current-standings.html. It holds
// code that has to behave identically on both pages, so there is one copy
// instead of two that drift: Eastern-time maths, the double-points window, and
// the sanitizers every database string passes through before it becomes markup
// or an image address.
//
// Strictly PURE and side-effect-free: no DOM, no storage, no network, nothing
// read from app state, and nothing here runs at load. That is what lets the TV
// page (which has no app state) load it, and what lets tests run it in a bare
// vm. Everything is a plain top-level declaration (classic script, shared global
// scope), so every name below is deliberately specific.

// ── Eastern time ─────────────────────────────────────────────────────
// Camp runs on Eastern time whatever the device's own zone is. The same maths
// the alert sender uses (push-worker/worker.js — it is pasted into Cloudflare, so
// it keeps its own copy; a change to the DST logic belongs in both).
const CAMP_TIME_ZONE = 'America/New_York';
const CAMP_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CAMP_HOUR_MS = 3600 * 1000;

// An Intl formatter is expensive to build, so one is made lazily and reused.
// hourCycle h23 so midnight is 00, never 24.
let campEtFormat = null;
function etParts(ms) {
  if (!campEtFormat) {
    campEtFormat = new Intl.DateTimeFormat('en-US', {
      timeZone: CAMP_TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  const o = {};
  for (const p of campEtFormat.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') o[p.type] = Number(p.value);
  }
  if (o.hour === 24) o.hour = 0;
  return o; // { year, month, day, hour, minute, second }
}

// How far Eastern wall-clock time is from UTC at `ms` (−4h in July, −5h in January).
function etOffsetMs(ms) {
  const p = etParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// An Eastern wall-clock time → epoch ms. `ymd` is 'YYYY-MM-DD'; `minutes` is
// minutes after that day's midnight and MAY run past 1439 (Date.UTC rolls it
// into later days, so "Thursday 5 PM" of a week that starts on a Sunday is
// etWallToEpoch(sunday, 4 * 1440 + 17 * 60)). Guess with EST, then correct with
// the real offset twice: the second pass settles a guess that straddles a DST
// change. A wall time that doesn't exist (2:30 AM on spring-forward day) lands an
// hour later; one that happens twice (1:30 AM on fall-back day) picks EST.
// NaN for anything that isn't a real calendar date or a finite number.
function etWallToEpoch(ymd, minutes) {
  const m = CAMP_YMD_RE.exec(String(ymd));
  if (!m || !Number.isFinite(minutes)) return NaN;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const day = new Date(Date.UTC(y, mo - 1, d));
  // 2026-02-31 would roll into March; a date that can't exist is a typo, not a Monday.
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return NaN;
  const wall = Date.UTC(y, mo - 1, d, 0, Math.floor(minutes));
  let t = wall + 5 * CAMP_HOUR_MS;
  for (let i = 0; i < 2; i++) t = wall - etOffsetMs(t);
  return t;
}

// ── The double-points window ─────────────────────────────────────────
// Summer 2026's rule (Patrick's call, Thu evening 2026-07-23): everything from
// Thursday 5pm ET through the end of Friday counts DOUBLE, except meal cleanup.
// Games are doubled by their own `messtival` flag; this window doubles the OTHER
// point sources (verse recitals and custom bonuses) by entry timestamp, at
// computation time, so it is retroactive and needs no ledger edits.
const DOUBLE_BONUS_START = Date.parse('2026-07-23T21:00:00Z'); // Thu 5:00pm ET
const DOUBLE_BONUS_END = Date.parse('2026-07-25T04:00:00Z');   // Fri midnight ET (00:00 Sat, ET)
// The window every existing week lives under. A week that has not been through
// the new-year setup (no epoch) is pinned to exactly this, whatever dates the
// setup data later says, so summer 2026's standings can never shift.
const DOUBLE_WINDOW_LEGACY = Object.freeze({ start: DOUBLE_BONUS_START, end: DOUBLE_BONUS_END });

function campIntInRange(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }

// The window a week doubles points in, as {start, end} epoch ms (end exclusive),
// or null for "no doubling".
//   { epoch, weekStart, double }
//   epoch     '' / absent ⇒ the legacy week ⇒ DOUBLE_WINDOW_LEGACY, whatever else is passed.
//   weekStart the camp week's Sunday, 'YYYY-MM-DD'.
//   double    { fromDow, fromMin, toDow, toMin }: offsets from that Sunday in camp
//             time. toDow may be 7 (the FOLLOWING Sunday 00:00 = "the end of Saturday").
// A new-year week with no usable dates doubles nothing rather than guessing.
function doubleWindowFor(o) {
  if (!o || !o.epoch) return DOUBLE_WINDOW_LEGACY;
  const d = o.double;
  if (!d || !CAMP_YMD_RE.test(String(o.weekStart))) return null;
  if (!campIntInRange(d.fromDow, 0, 7) || !campIntInRange(d.toDow, 0, 7)) return null;
  if (!campIntInRange(d.fromMin, 0, 1439) || !campIntInRange(d.toMin, 0, 1439)) return null;
  const start = etWallToEpoch(o.weekStart, d.fromDow * 1440 + d.fromMin);
  const end = etWallToEpoch(o.weekStart, d.toDow * 1440 + d.toMin);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

// True when `ms` is inside `win` (a doubleWindowFor result, which may be null).
function inDoubleWindow(win, ms) {
  return !!win && ms >= win.start && ms < win.end;
}

// Does this bonus entry count double? Meal cleanup never does. An entry with no
// readable timestamp doesn't either (Date.parse → NaN compares false).
function bonusIsDouble(b, win) {
  if (!b || b.category === 'cleanup') return false;
  return inDoubleWindow(win, Date.parse(b.at || ''));
}

// The game ids that still exist in a week config, as a Set, or null when there
// is no config to judge by (a page that hasn't received it yet must count every
// result rather than drop them all). A result whose game was deleted — an import
// or restore can leave one behind — has no game to clear it from, so standings
// skip it.
function liveGameIdSet(config) {
  if (!config || !config.games) return null;
  const arr = Array.isArray(config.games)
    ? config.games
    : Object.keys(config.games).sort().map((k) => config.games[k]); // RTDB can round-trip an array as an object
  const ids = new Set();
  arr.forEach((g) => { if (g && typeof g.id === 'string' && g.id) ids.add(g.id); });
  return ids;
}

// ── Sanitizers ───────────────────────────────────────────────────────
// Every database string that becomes markup or an image address goes through
// one of these, on every page, with this one copy of the code. A page's own CSP
// is the second wall; these are the first. They never throw and never return
// HTML: text comes back as plain text for the caller to esc() (or assign with
// textContent), and an address comes back whole or not at all.

// An emoji for a team: at most 16 UTF-16 units once markup characters, quotes,
// backticks and control characters are removed (a family emoji is 11), else the
// fallback. A payload like <img src=x onerror=…> is far longer than that and
// falls back; a short one loses its brackets and is only ever text anyway.
const CAMP_EMOJI_MAX = 16;
function safeEmoji(v, fallback) {
  const fb = typeof fallback === 'string' ? fallback : '';
  if (typeof v !== 'string') return fb;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[<>&"'`\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim();
  return s && s.length <= CAMP_EMOJI_MAX ? s : fb;
}

// A team's short name (tight spaces): trimmed, whitespace collapsed, control
// characters gone, cut to 20 units (never mid-surrogate-pair). Plain text — the
// caller still esc()s it into markup.
const CAMP_SHORT_MAX = 20;
function safeShort(v, fallback) {
  const fb = typeof fallback === 'string' ? fallback : '';
  if (typeof v !== 'string') return fb;
  // eslint-disable-next-line no-control-regex
  let s = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > CAMP_SHORT_MAX) {
    s = s.slice(0, CAMP_SHORT_MAX);
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1); // don't leave half an emoji
    s = s.trim();
  }
  return s || fb;
}

// A team colour as the CSS custom properties the accent rules read, or ''.
// `color` is a palette id (looked up in `palette`: id → {l, d}, light/dark hex)
// or a legacy '#rrggbb'; `legacyHex` is the camp's old single accent, used when
// `color` is absent or unusable. Only hex digits ever reach the style string.
const CAMP_HEX_RE = /^#[0-9a-fA-F]{6}$/;
function safeColorVars(color, legacyHex, palette) {
  const both = (hex) => `--team-accent-l:${hex};--team-accent-d:${hex}`;
  if (typeof color === 'string') {
    if (CAMP_HEX_RE.test(color)) return both(color);
    if (palette && /^[a-z]{2,12}$/.test(color) && Object.prototype.hasOwnProperty.call(palette, color)) {
      const sw = palette[color];
      if (sw && CAMP_HEX_RE.test(sw.l) && CAMP_HEX_RE.test(sw.d)) return `--team-accent-l:${sw.l};--team-accent-d:${sw.d}`;
    }
  }
  return typeof legacyHex === 'string' && CAMP_HEX_RE.test(legacyHex) ? both(legacyHex) : '';
}

// An image address for a team crest, or null. Only two shapes pass, and each
// must match IN FULL: an inline PNG/JPEG data URL, or one of the crests shipped
// in images/team-shields/. A prefix check ('data:image/…') is not enough — a
// value like  data:image/png;base64,AAA" onerror="…  passes it and breaks out of
// the attribute. External URLs and javascript: are refused outright, because an
// <img src> is the one place a database string becomes an outbound request.
// Set the result with img.src = …, never by concatenating it into markup.
const CAMP_CREST_DATA_RE = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const CAMP_CREST_SHIPPED_RE = /^images\/team-shields\/[a-z0-9-]+\.(?:webp|png)(?:\?v=\d+)?$/;
function safeCrestSrc(v) {
  if (typeof v !== 'string') return null;
  return CAMP_CREST_DATA_RE.test(v) || CAMP_CREST_SHIPPED_RE.test(v) ? v : null;
}

// A verse video address: https only, a real dotted host (no credentials, no
// port tricks), no whitespace or quote characters, a sane length. Returns the
// address unchanged, or null. Regex-only so it behaves the same in a bare vm.
const CAMP_VIDEO_URL_RE = /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d{1,5})?(?:[/?#][^\s"'<>\\]*)?$/;
function safeVideoUrl(v) {
  return typeof v === 'string' && v.length <= 500 && CAMP_VIDEO_URL_RE.test(v) ? v : null;
}
