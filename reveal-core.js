// ── reveal-core.js — the standings reveal's pure rules ──────────────────
// Everything about HOW a reveal is read, decided and timed, with no DOM, no
// storage, no network and nothing read from app state, so the phone, the big
// screen and the director's remote can all call the same code and a test can
// run it in a bare vm. Nothing here runs at load; it needs camp-core.js
// (etParts, etWallToEpoch) loaded first, and every name is deliberately
// specific because classic scripts share one global scope.
//
// The shape it reads (redesign spec §4.3) lives in the database at
// <root>/revealPublic/<mode>:  { ctl, pub }.
//   ctl  one small record of where the reveal is (phase, which place is on the
//        big screen, how many are published, when it started and when it hides)
//   pub  the places published so far: pub.g0 = { place: 6, e: { t5: {…} } } …
//        ONLY groups below ctl.shown ever exist there, so no unrevealed place is
//        in the node at all.
//
// THE RULE EVERY FUNCTION HERE FOLLOWS: fail CLOSED. A missing, foreign-shaped,
// too-new, expired or other-year reveal yields nothing to show, never a guess,
// because what it would show is the standings, and counselors are not meant to
// see those before the directors reveal them. Everything a database string can
// become (names, colour keys) is laundered here once, so no screen has to.

const REVEAL_SCHEMA = 1;                       // ctl.v this build can read
const REVEAL_PHASES = ['intro', 'live', 'champion', 'table', 'ended'];
const REVEAL_MAX_GROUPS = 6;                   // groups g0…g5 (six teams: the most a camp has)
const REVEAL_NAME_MAX = 30;                    // a team's name as frozen into the public node
const REVEAL_LOOK_MS = 3000;                   // phones lag the big screen by this, for a NEW place only
const REVEAL_BEAT_SCORE_MS = 3000;             // big screen: name alone, then place + score
const REVEAL_BEAT_BREAKDOWN_MS = 4500;         // … then the medal / bonus breakdown
const REVEAL_BEAT_DOCK_MS = 8000;              // … then the team docks into the board
const REVEAL_AUTO_END_SHORT_MS = 15 * 60 * 1000; // champion / table left idle this long counts as ended
const REVEAL_AUTO_END_LONG_MS = 60 * 60 * 1000;  // intro / live left idle this long counts as ended
const REVEAL_PRACTICE_MS = 2 * 60 * 60 * 1000;   // a practice runs for at most this (the rules cap it at 3 h)
const REVEAL_UNTIL_MAX_MS = 33 * 60 * 60 * 1000; // no `until` can sit further than this past the start
const REVEAL_ID_RE = /^r[a-z0-9]{6,12}-[a-z0-9]{4}$/;
const REVEAL_GROUP_KEY_RE = /^g([0-5])$/;
const REVEAL_TEAM_KEY_RE = /^t[0-5]$/;
const REVEAL_COLOR_KEY_RE = /^[a-z]{2,12}$/;
const REVEAL_EPOCH_RE = /^[A-Za-z0-9_-]{1,24}$/;

function revealInt(v, lo, hi) {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}
function revealMs(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e14 ? v : null;
}
// A team's name as it rides in the public node: control characters become
// spaces, runs of space collapse, the result is cut to REVEAL_NAME_MAX UTF-16
// units (never mid-surrogate-pair) and trimmed. Plain text only: whoever puts it
// in markup still esc()s it. '' when nothing usable is left.
function revealCleanName(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let s = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > REVEAL_NAME_MAX) {
    s = s.slice(0, REVEAL_NAME_MAX);
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
    s = s.trim();
  }
  return s;
}

// ── Places ───────────────────────────────────────────────────────────
// Ranked entries → groups. `entries` are rows already in RANK ORDER (best
// first: the app's rankTeamsByPoints order), each { id, nm, p, g, s, b, … }:
// p total points; g/s/b gold/silver/bronze counts. Equal POINTS share a place
// (competition ranking: 1, 2, 2, 4), and inside a tie the entries are ordered by
// golds, then silvers, then bronzes, then name, so a tie always reads the same
// on every screen. Returns [{ place, entries }] best place first. Ported from the
// TV page's own groupPlaces, which only ever saw points; this one owns the
// tie-order rule so the phone, the remote and the TV cannot disagree.
function groupPlaces(entries) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
  const groups = [];
  let i = 0;
  while (i < list.length) {
    const pts = list[i].p;
    const tie = [list[i]];
    let j = i + 1;
    while (j < list.length && list[j].p === pts) { tie.push(list[j]); j++; }
    tie.sort(revealCompareEntries);
    groups.push({ place: i + 1, entries: tie });
    i = j;
  }
  return groups;
}

function revealCompareEntries(a, b) {
  if ((b.g || 0) !== (a.g || 0)) return (b.g || 0) - (a.g || 0);
  if ((b.s || 0) !== (a.s || 0)) return (b.s || 0) - (a.s || 0);
  if ((b.b || 0) !== (a.b || 0)) return (b.b || 0) - (a.b || 0);
  return String(a.nm || a.id || '').localeCompare(String(b.nm || b.id || ''));
}

// ── When a reveal hides ──────────────────────────────────────────────
// A real reveal's grid stays on phones until 08:00 camp time the NEXT calendar
// day after it started (a reveal begun after midnight still runs to 8 AM that
// next day); a practice lives for two hours. Eastern wall time through
// camp-core's DST-safe maths, so both clock changes land right. NaN for a
// start that isn't a real time.
function untilFor(startedAt, practice) {
  const t = revealMs(Number(startedAt));
  if (t === null) return NaN;
  if (practice) return t + REVEAL_PRACTICE_MS;
  const p = etParts(t);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const two = (n) => (n < 10 ? '0' : '') + n;
  const ymd = next.getUTCFullYear() + '-' + two(next.getUTCMonth() + 1) + '-' + two(next.getUTCDate());
  return etWallToEpoch(ymd, 8 * 60);
}

// ── Normalisers ──────────────────────────────────────────────────────
// What a snapshot hands back is whatever a director's device wrote (the rules
// fix the shape, but they are not versioned with this code), so every consumer
// reads the node only through these. Both return null for anything that is not
// exactly this build's shape; neither throws; neither keeps a field it does not
// know, so nothing extra a hostile or newer writer adds can reach a screen.
function normalizeRevealCtl(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.v !== REVEAL_SCHEMA) return null;                // a newer schema is not guessed at
  if (typeof raw.id !== 'string' || !REVEAL_ID_RE.test(raw.id)) return null;
  if (REVEAL_PHASES.indexOf(raw.phase) < 0) return null;
  const seq = revealInt(raw.seq, 0, 1000000);
  const cur = revealInt(raw.cur, -1, REVEAL_MAX_GROUPS - 1);
  const shown = revealInt(raw.shown, 0, REVEAL_MAX_GROUPS);
  const teams = revealInt(raw.teams, 1, REVEAL_MAX_GROUPS);
  const at = revealMs(raw.at);
  const sa = revealMs(raw.sa);
  const startedAt = revealMs(raw.startedAt);
  const until = revealMs(raw.until);
  if (seq === null || cur === null || shown === null || teams === null) return null;
  if (at === null || sa === null || startedAt === null || until === null) return null;
  if (cur >= shown) return null;                           // cur names a group that is published
  if (until <= startedAt) return null;
  const ctl = {
    v: REVEAL_SCHEMA, id: raw.id, seq, phase: raw.phase, cur, shown, teams,
    finale: raw.finale === true, at, sa, startedAt,
    until: Math.min(until, startedAt + REVEAL_UNTIL_MAX_MS),
  };
  const ca = revealMs(raw.ca);
  if (ca !== null) ctl.ca = ca;
  const endedAt = revealMs(raw.endedAt);
  if (endedAt !== null) ctl.endedAt = endedAt;
  if (raw.endKind === 'done' || raw.endKind === 'early') ctl.endKind = raw.endKind;
  if (typeof raw.epoch === 'string' && REVEAL_EPOCH_RE.test(raw.epoch)) ctl.epoch = raw.epoch;
  return ctl;
}

// pub → [{ idx, place, entries:[{ id, nm, k, p, g, s, b, v, m, c }] }] sorted by
// idx (the order places were revealed: lowest place first). A group or an entry
// that is not exactly the shape is dropped, not repaired. Never null: no
// usable group is simply [].
function normalizeRevealPub(raw) {
  const out = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach((key) => {
    const m = REVEAL_GROUP_KEY_RE.exec(key);
    const grp = raw[key];
    if (!m || !grp || typeof grp !== 'object') return;
    const place = revealInt(grp.place, 1, REVEAL_MAX_GROUPS);
    if (place === null || !grp.e || typeof grp.e !== 'object') return;
    const entries = [];
    Object.keys(grp.e).forEach((tid) => {
      const e = grp.e[tid];
      if (!REVEAL_TEAM_KEY_RE.test(tid) || !e || typeof e !== 'object') return;
      const nm = revealCleanName(e.nm);
      const p = revealInt(e.p, -99999, 99999);
      const g = revealInt(e.g, 0, 99), s = revealInt(e.s, 0, 99), b = revealInt(e.b, 0, 99);
      const v = revealInt(e.v, -99999, 99999), mm = revealInt(e.m, -99999, 99999), c = revealInt(e.c, -99999, 99999);
      if (!nm || p === null || g === null || s === null || b === null || v === null || mm === null || c === null) return;
      const row = { id: tid, nm, p, g, s, b, v, m: mm, c };
      if (typeof e.k === 'string' && REVEAL_COLOR_KEY_RE.test(e.k)) row.k = e.k;
      entries.push(row);
    });
    if (!entries.length) return;
    entries.sort(revealCompareEntries);
    out.push({ idx: Number(m[1]), place, entries });
  });
  out.sort((a, b) => a.idx - b.idx);
  return out;
}

// ── Reading a reveal ─────────────────────────────────────────────────
// A reveal whose last command is this old is treated as over (DISPLAY only; the
// grid itself still follows `until`). "End the reveal" is the step most likely
// to be forgotten, and a stuck "Live" would take over Now for the whole camp.
function revealEffectivePhase(ctl, now) {
  if (!ctl) return 'ended';
  if (ctl.phase === 'ended') return 'ended';
  const limit = ctl.phase === 'champion' || ctl.phase === 'table' ? REVEAL_AUTO_END_SHORT_MS : REVEAL_AUTO_END_LONG_MS;
  return now - ctl.at > limit ? 'ended' : ctl.phase;
}

function revealNow(serverNow) {
  const t = typeof serverNow === 'function' ? serverNow() : serverNow;
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

// The ONLY thing a viewer's screen reads about the standings. (ctl, pub) are the
// raw node values for ONE child (a phone only ever passes `real`); `serverNow`
// is a number or a function returning one, and is read HERE, at call time, so an
// 8 AM hide can never depend on a cached value; `role` is 'viewer' | 'editor'
// (phones: the newest place is held back for REVEAL_LOOK_MS after it is shown, so
// the room hears it from the big screen first) or 'remote' | 'tv' (no lag: they
// ARE the big screen). opts: { denied: true } when the listener was refused;
// { epoch } to ignore a reveal from another camp year (omit it where the epoch
// can't be known, the TV).
//
// Returns null — nothing — for no/denied/foreign/too-new/other-year data or no
// usable clock. For an expired reveal it returns a CLOSED view (no rows, nothing
// live) whose only content is `champion`, which outlives the 8 AM hide by
// design (the whole camp saw the crowning; it carries a name and no number).
// Otherwise:
//   { live, phase, rawPhase, id, seq, startedAt, until, expired:false, finale,
//     rows:[{ place, tie, entries }] best place first (revealed only),
//     onScreen  the place the big screen is on, or null,
//     looking   true while the newest place is held back (3 s),
//     remaining teams not yet revealed (teams minus revealed entries, so a
//               tie can't be inferred from a group count),
//     champion  [{ id, name }] when a finale's 1st place has been shown, or null }
function revealView(ctl, pub, serverNow, role, opts) {
  const o = opts || {};
  if (o.denied) return null;
  const c = normalizeRevealCtl(ctl);
  if (!c) return null;
  if (o.epoch !== undefined && (c.epoch || '') !== (o.epoch || '')) return null;
  const now = revealNow(serverNow);
  if (now === null) return null;
  const groups = normalizeRevealPub(pub).filter((g) => g.idx < c.shown);
  const lag = (role === 'viewer' || role === 'editor') && c.shown > 0 && now < c.sa + REVEAL_LOOK_MS;
  const visible = lag ? groups.filter((g) => g.idx !== c.shown - 1) : groups;
  const rows = visible.map((g) => ({ place: g.place, tie: g.entries.length > 1, entries: g.entries }))
    .sort((a, b) => a.place - b.place);
  let champion = null;
  if (c.finale) {
    const first = rows.find((r) => r.place === 1);
    if (first) champion = first.entries.map((e) => ({ id: e.id, name: e.nm }));
  }
  if (now >= c.until) {
    return {
      live: false, phase: 'ended', rawPhase: c.phase, id: c.id, seq: c.seq, startedAt: c.startedAt, until: c.until,
      expired: true, finale: c.finale, rows: [], onScreen: null, looking: false, remaining: 0, champion,
    };
  }
  const phase = revealEffectivePhase(c, now);
  const revealed = rows.reduce((n, r) => n + r.entries.length, 0);
  let onScreen = null;
  if (!lag && (phase === 'live' || phase === 'champion')) {
    const g = groups.find((x) => x.idx === c.cur) || (phase === 'champion' ? groups.find((x) => x.idx === c.shown - 1) : null);
    if (g) onScreen = g.place;
  }
  return {
    live: phase === 'intro' || phase === 'live' || phase === 'champion',
    phase, rawPhase: c.phase, id: c.id, seq: c.seq, startedAt: c.startedAt, until: c.until, expired: false,
    finale: c.finale, rows, onScreen, looking: lag, remaining: Math.max(0, c.teams - revealed), champion,
  };
}

// ── What the big screen should be showing ────────────────────────────
// A pure function of (ctl, pub, serverNow): { mode, heroIdx, beat, docked, seq,
// elapsed, fresh, groups }. mode is waiting | intro | hero | board | champion |
// table; heroIdx the group index in the spotlight (−1 when none); beat which
// part of a place's moment this is ('name' alone for 3 s, 'score' with the place
// and points, 'breakdown' from 4.5 s) or null; docked how many places are
// already in the board; `fresh` true while the place is inside its first 3 s (the
// only time a late joiner gets confetti); `groups` the revealed places in the
// order they were revealed, ready to draw. Waiting means the same as a null
// revealView: nothing to show, so nothing is shown. The big screen never lags
// (it is the source) and never reads the epoch (it cannot).
function tvFrame(ctl, pub, serverNow, opts) {
  const waiting = { mode: 'waiting', heroIdx: -1, beat: null, docked: 0, seq: 0, elapsed: 0, fresh: false, groups: [] };
  const o = opts || {};
  if (o.denied) return waiting;
  const c = normalizeRevealCtl(ctl);
  const now = revealNow(serverNow);
  if (!c || now === null) return waiting;
  if (now >= c.until) return waiting;
  const phase = revealEffectivePhase(c, now);
  if (phase === 'ended') return waiting;
  const groups = normalizeRevealPub(pub).filter((g) => g.idx < c.shown);
  const elapsed = Math.max(0, now - c.at);
  const frame = { mode: 'intro', heroIdx: -1, beat: null, docked: 0, seq: c.seq, elapsed, fresh: false, groups };
  if (phase === 'intro') return frame;
  if (phase === 'champion') { frame.mode = 'champion'; frame.docked = groups.length; frame.fresh = elapsed < REVEAL_BEAT_SCORE_MS; return frame; }
  if (phase === 'table') { frame.mode = 'table'; frame.docked = groups.length; return frame; }
  // live: one place's moment, measured from the command that put it on screen
  if (c.cur < 0 || !groups.some((g) => g.idx === c.cur)) {
    // Nothing published at `cur` (a half-written command): show the board as it stands.
    frame.mode = 'board'; frame.docked = groups.length; return frame;
  }
  if (elapsed < REVEAL_BEAT_DOCK_MS) {
    frame.mode = 'hero';
    frame.heroIdx = c.cur;
    frame.docked = c.cur;
    frame.beat = elapsed < REVEAL_BEAT_SCORE_MS ? 'name' : elapsed < REVEAL_BEAT_BREAKDOWN_MS ? 'score' : 'breakdown';
    frame.fresh = elapsed < REVEAL_BEAT_SCORE_MS;
  } else {
    frame.mode = 'board';
    frame.docked = c.cur + 1;
  }
  return frame;
}
