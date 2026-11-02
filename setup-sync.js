// ════════════════════════════════════════════════════════════════════
// THE SETUP ENGINE (setup-rebuild-spec §6.4, §6.7, §7.2, §7.4 — build step 14 / "S4")
// ════════════════════════════════════════════════════════════════════
// Camp week facts that used to be JavaScript in camps.js — the schedule, the menus,
// the verses, the cleanup rota, the elective stations — become DATA under
// `<root>/setup`, edited by directors in the "Set up the week" screens. This file is
// the engine under those screens: it cloned the config engine's DESIGN (id-keyed
// field ops against a persisted confirmed baseline; a three-way first-snapshot merge;
// rebase on receipt, never stash), not its code, so the sync tests that poke the
// state and config engines' globals stay the safety net for those.
//
// IT IS DARK. Nothing here changes what a counselor or a director sees until a
// director acts: the engine attaches ONE read-only listener (post-approval, like
// every ref), never seeds, and writes only inside commitSetup. A section's switch
// (`meta/on/<section>`) is the OWNER's alone and nothing in this step turns one on,
// so every commit into schedule, meals, verses, cleanup or electives is refused
// ("off") until Step 15 ships Edit the week here. Only the always-on `week` fields
// (weekStart, double, finaleDow, joinOpen) and the restore points can be written.
//
// Loaded after app.js (it uses app.js's globals) and before settings.js; every hook
// in app.js is typeof-guarded, so deleting its <script> tag leaves a running app.
//
// Sections of this file:
//   1. the tree: normalizeSetup, canonical form, depths and anchors, applying ops
//   2. the engine: cache + persistSetup(), listener, first snapshot (three-way merge),
//      later snapshots (rebase), commitSetup, push, refusals (bisect + quarantine),
//      clashes and the Put-it-back list, undo, accounting, the sync line
//   3. restore points and Backups v3
//   4. "also here" (editorsHere) and the Devices list

const SETUP_KEY = 'campScoreboardSetupV1';   // lsKey()'d; wiped by clearLocalData
const SETUP_SCHEMA = 1;                      // the highest meta/schema this build understands
const SETUP_DK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SETUP_DAY_WORDS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const SETUP_SECTIONS = ['schedule', 'meals', 'verses', 'cleanup', 'electives'];
const SETUP_PUSH_MS = 300;                   // coalesce rapid edits (spec §6.4.2 step 6)
let setupPushMs = SETUP_PUSH_MS;             // (a test shortens it: the suite waits on this timer a few hundred times)
const SETUP_STALE_MS = 36 * 60 * 60 * 1000;  // unconfirmed longer than this asks before it is sent
const SETUP_CLASH_MAX = 30;
const SETUP_BISECT_SINGLES = 40;             // a refused batch up to this long is re-sent path by path; longer is halved first
// The meta fields only the owner may change (rules: OWNER / OWNERKEEP). A non-owner's
// commit that touches one is refused here, before anything is written.
const SETUP_OWNER_META = ['on', 'epoch', 'epochAt', 'wizard', 'seeded'];
// meta fields that belong to the "week" stamp (the schedule's dates and flags).
const SETUP_WEEK_META = ['weekStart', 'double', 'finaleDow', 'joinOpen'];

// ── 1. The tree ──────────────────────────────────────────────────────

function setupIsMap(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function setupClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// An object, or — for the array an RTDB read may hand back for integer-keyed children —
// the same thing as a map; anything else is empty.
function setupMapOf(v) {
  if (setupIsMap(v)) return v;
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => { if (x !== null && x !== undefined) o[i] = x; });
    return o;
  }
  return {};
}

// Heal what RTDB prunes (CLAUDE.md "Realtime Database gotcha"), in place, after every
// load, adopt and merge. STRUCTURE ONLY: it makes the containers exist and puts the
// seven day records in memory, and it NEVER rewrites a stored value — a "repaired"
// value would show up in the next diff and be pushed as an edit nobody made (setupCanon
// below drops the in-memory fillers from both sides of every diff, so they can't).
// Bad values are skipped where they are read, and the hub lists them.
//
// One deliberate difference from the spec's wording: a patch whose typical block no
// longer exists is NOT deleted from memory here. Dropping it would put a delete of
// `patches/<dk>/<bid>` into the next diff (the server still holds it) — exactly the
// invented edit this function must never make. Readers skip an orphan patch instead
// (setupLivePatches), and the rules refuse a write into one anyway.
function normalizeSetup(t) {
  const tree = setupIsMap(t) ? t : {};
  ['meta', 'days', 'typical', 'patches', 'dayBlocks', 'meals', 'verses', 'cleanup', 'electives'].forEach((k) => {
    tree[k] = setupMapOf(tree[k]);
  });
  ['on', 'skip', 'edited'].forEach((k) => { tree.meta[k] = setupMapOf(tree.meta[k]); });
  tree.verses.days = setupMapOf(tree.verses.days);
  tree.electives.stations = setupMapOf(tree.electives.stations);
  tree.electives.slots = setupMapOf(tree.electives.slots);
  SETUP_DK.forEach((dk) => {
    const d = tree.days[dk];
    tree.days[dk] = setupIsMap(d) ? d : { typical: false, tag: '' };
  });
  ['patches', 'dayBlocks', 'meals', 'cleanup'].forEach((k) => {
    Object.keys(tree[k]).forEach((dk) => { tree[k][dk] = setupMapOf(tree[k][dk]); });
  });
  return tree;
}

// A day record that says nothing the absence of one doesn't ("its own day, no tag").
function setupIsDefaultDay(d) {
  return setupIsMap(d) && d.typical === false && (d.tag === undefined || d.tag === '') &&
    Object.keys(d).every((k) => k === 'typical' || k === 'tag');
}

// The form every diff and merge runs on: RTDB-canonical (empties pruned, keys sorted)
// MINUS what is not an edit — the in-memory default day records, and `meta/edited/*`
// (stamps added at push time and never part of the diffed tree, §6.4.3).
function setupCanon(tree) {
  const t = setupClone(tree || {});
  if (setupIsMap(t.meta)) delete t.meta.edited;
  if (setupIsMap(t.days)) Object.keys(t.days).forEach((dk) => { if (setupIsDefaultDay(t.days[dk])) delete t.days[dk]; });
  return syncCanon(t) || {};
}

// How far treeDiff recurses before a value is one leaf, per top-level key (§6.4.2):
//   meta/<field>  (double, seeded, wizard are leaves; on/skip are leaves one level down)
//   days/<dk>/<field>   typical/<bid>/<field>   dayBlocks/<dk>/<bid>/<field>
//   patches/<dk>/<bid>/<field>   (teams is a leaf)   meals/<dk>/<meal> whole
//   cleanup/<dk>/<meal>/<tid>   verses/theme and verses/days/<dk> whole
//   electives/stations/<st> whole;
//   electives/slots/<dk>/<slot>/<st>/ord and …/<st>/people/<p> whole
const SETUP_DEPTHS = {
  meta: (p) => (p[1] === 'on' || p[1] === 'skip' || p[1] === 'edited' ? p.length >= 3 : p.length >= 2),
  days: 3,
  typical: 3,
  dayBlocks: 4,
  patches: 4,
  meals: 3,
  cleanup: 4,
  verses: (p) => (p[1] === 'days' ? p.length >= 3 : p.length >= 2),
  electives: (p) => {
    if (p[1] === 'slots') return p[5] === 'people' ? p.length >= 7 : p.length >= 6;
    return p.length >= 3; // stations/<st>
  },
};

// treeDiff over the setup tree, with ONE addition: `meta` is always diffed to per-field
// leaves. With no `meta` on one side treeDiff emits a single coarse `meta` op carrying
// the whole object — which slips past every gate keyed on the path (the owner-only
// fields, the section switch) and, with the `meta/edited/<section>` stamp pushSetup adds,
// makes an update() with an ancestor AND a descendant path, which the SDK throws on.
// Every diff of the setup tree goes through here, so no caller ever sees the coarse op.
function setupTreeDiff(prev, cur) {
  const ops = treeDiff(prev, cur, SETUP_DEPTHS);
  if (ops.meta === undefined) return ops;
  const whole = ops.meta;
  delete ops.meta;
  if (whole === null) { // meta removed outright: every field that was there, one null each
    const was = (syncCanon(prev) || {}).meta;
    Object.keys(setupIsMap(was) ? was : {}).forEach((k) => { ops['meta/' + k] = null; });
  } else if (setupIsMap(whole)) {
    Object.keys(whole).forEach((k) => { ops['meta/' + k] = whole[k]; });
  } else ops.meta = whole; // not a shape the tree ever holds; leave it for the caller's refusal paths
  return ops;
}

function setupDiff(a, b) {
  return setupTreeDiff(setupCanon(a), setupCanon(b));
}

// How many path segments name a RECORD whose existence a field write needs (the rules'
// ANCHOR: every field of a block requires its start AND label to exist). 0 = none.
function setupRecordDepth(parts) {
  if (parts[0] === 'typical') return 2;
  if (parts[0] === 'dayBlocks') return 3;
  if (parts[0] === 'electives') return parts[1] === 'slots' ? 5 : parts[1] === 'stations' ? 3 : 0;
  return 0;
}

// A patch field may only be written for a typical block that EXISTS, on a day that USES
// the typical day (the rules' PANCHOR, §8.1). '' = fine, else why not.
function setupPatchAnchor(tree, dk, bid) {
  const t = syncValueAt(tree, 'typical/' + bid);
  if (!setupIsMap(t) || t.start === undefined || t.label === undefined) return 'block';
  if (syncValueAt(tree, 'days/' + dk + '/typical') !== true) return 'day';
  return '';
}

// applyOpsSafe for this tree's shapes (spec §6.1): applies treeDiff-style ops to a
// CANONICAL tree, except a field op whose record is absent (it would resurrect a half
// record, and the rules refuse it anyway) — those are returned in `dropped`, with
// `why: 'block' | 'day'` for a patch. A whole-record create that meets a DIFFERENT
// record under the same id is a collision, dropped (identical content is simply
// already true). `opts.overwrite` is for a deliberate "Use mine". Canonical in,
// canonical out.
function setupApplyOps(tree, ops, opts) {
  const overwrite = !!(opts && opts.overwrite);
  const dropped = [];
  const apply = {};
  Object.keys(ops).forEach((path) => {
    const parts = path.split('/');
    const val = ops[path];
    if (parts[0] === 'patches' && parts.length >= 3 && val !== null) {
      const why = setupPatchAnchor(tree, parts[1], parts[2]);
      if (why) dropped.push({ path, value: val, record: 'patches/' + parts[1] + '/' + parts[2], why });
      else apply[path] = val;
      return;
    }
    if (parts[0] === 'patches' && parts.length === 2 && val !== null && setupIsMap(val)) {
      const keep = {};
      Object.keys(val).forEach((bid) => {
        const why = setupPatchAnchor(tree, parts[1], bid);
        if (why) dropped.push({ path: path + '/' + bid, value: val[bid], record: path + '/' + bid, why });
        else keep[bid] = val[bid];
      });
      if (Object.keys(keep).length) apply[path] = keep;
      return;
    }
    const depth = setupRecordDepth(parts);
    if (depth && parts.length >= depth) {
      const record = parts.slice(0, depth).join('/');
      if (parts.length === depth) {
        if (val !== null && !overwrite) {
          const cur = syncValueAt(tree, path);
          if (cur !== undefined) {
            if (JSON.stringify(cur) !== JSON.stringify(syncCanon(val))) dropped.push({ path, value: val, record: path, collide: true });
            return; // identical: the tree already says it
          }
        }
      } else if (syncValueAt(tree, record) === undefined) {
        if (val !== null) dropped.push({ path, value: val, record });
        return; // (a field delete into a record that is gone is not news)
      }
    }
    apply[path] = val;
  });
  return { tree: setupCanon(applySyncPaths(tree, apply)), dropped };
}

// In-place write of `value` (null deletes, pruning what empties) at a slash path of a
// working tree — what a commit's mutate and "Use mine" / Undo use.
function setupSetPath(tree, path, value) {
  const parts = path.split('/');
  const chain = [];
  let node = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!setupIsMap(node[parts[i]])) {
      if (value === null || value === undefined) return;
      node[parts[i]] = {};
    }
    chain.push([node, parts[i]]);
    node = node[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) {
    delete node[last];
    for (let i = chain.length - 1; i >= 0; i--) { // prune what the delete emptied, but never a top-level container
      const [parent, key] = chain[i];
      if (i === 0 || Object.keys(parent[key]).length) break;
      delete parent[key];
    }
  } else node[last] = setupClone(value);
}

// Replace a working tree's whole content with `next`'s (the object identity stays).
function setupReplaceTree(tree, next) {
  Object.keys(tree).forEach((k) => { delete tree[k]; });
  Object.keys(next).forEach((k) => { tree[k] = next[k]; });
  return tree;
}

// The canonical form of a value, with null for "absent" (what setupValueAt returns).
function setupCanonVal(v) {
  const c = syncCanon(v);
  return c === undefined ? null : c;
}

// A value at a slash path of a canonical tree, as a copy (null = absent).
function setupValueAt(tree, path) {
  const v = syncValueAt(tree, path);
  return v === undefined ? null : setupClone(v);
}

// Which stamp a path belongs to (`meta/edited/<section>`): week | schedule | meals |
// verses | cleanup | electives — or '' for a path that is not an edit of a section
// (the switches, the epoch, the wizard claim, the seed record).
function setupSectionOf(path) {
  const top = String(path).split('/')[0];
  const second = String(path).split('/')[1];
  if (top === 'meta') return SETUP_WEEK_META.indexOf(second) !== -1 ? 'week' : '';
  if (top === 'days' || top === 'typical' || top === 'patches' || top === 'dayBlocks') return 'schedule';
  if (SETUP_SECTIONS.indexOf(top) !== -1) return top;
  return '';
}

function setupIsOwnerPath(path) {
  const parts = String(path).split('/');
  return parts[0] === 'meta' && SETUP_OWNER_META.indexOf(parts[1]) !== -1;
}

// Keep the live OBJECT of every subtree whose content didn't change when `next`
// replaces `prev` (an echo of my own write, a colleague's edit elsewhere): open sheets,
// the builder and the render-stability rules all lean on identity per record. `next`
// is a fresh tree and is changed in place.
function setupKeepRefs(prev, next) {
  if (!setupIsMap(prev) || !setupIsMap(next)) return next;
  Object.keys(next).forEach((k) => {
    const a = prev[k];
    const b = next[k];
    if (a === undefined || !setupIsMap(a) || !setupIsMap(b)) return;
    if (JSON.stringify(syncCanon(a)) === JSON.stringify(syncCanon(b))) next[k] = a;
    else next[k] = setupKeepRefs(a, b);
  });
  return next;
}

// ── Words for a path (toasts, clashes, the sync line) ─────────────────
const SETUP_FIELD_WORDS = {
  start: 'starts', end: 'ends', label: 'name', emoji: 'emoji', type: 'kind', slot: 'slot', noTime: 'untimed',
  meal: 'meal', ord: 'order', alertKey: 'reminder', teams: 'teams', overlapOk: 'overlap OK', off: 'cancelled',
  dish: 'dish', text: 'text', ref: 'reference', video: 'video', name: 'name', tag: 'tag', typical: 'schedule',
  title: 'title',
};

function setupClock(min) {
  if (typeof min !== 'number') return String(min);
  if (min >= 1440) return 'end of day';
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM');
}

// "Tuesday · Swim · starts" — `trees` are canonical trees to look names up in.
function setupWhat(path, ...trees) {
  const parts = String(path).split('/');
  const pick = (p) => { for (const t of trees) { const v = syncValueAt(t, p); if (v !== undefined) return v; } return undefined; };
  const day = (dk) => SETUP_DAY_WORDS[dk] || dk;
  const field = (f) => (f ? ' · ' + (SETUP_FIELD_WORDS[f] || f) : '');
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  switch (parts[0]) {
    case 'typical': return 'Typical day · ' + (pick('typical/' + parts[1] + '/label') || parts[1]) + field(parts[2]);
    case 'dayBlocks': return day(parts[1]) + ' · ' + (pick('dayBlocks/' + parts[1] + '/' + parts[2] + '/label') || parts[2]) + field(parts[3]);
    case 'patches': return day(parts[1]) + ' only · ' + (pick('typical/' + parts[2] + '/label') || parts[2]) + field(parts[3]);
    case 'days': return day(parts[1]) + field(parts[2]);
    case 'meals': return day(parts[1]) + ' · ' + cap(parts[2] || 'meals');
    case 'cleanup': return day(parts[1]) + ' · ' + cap(parts[2] || 'cleanup') + ' cleanup' + (parts[3] ? ' · ' + (typeof teamName === 'function' ? teamName(parts[3]) : parts[3]) : '');
    case 'verses': return parts[1] === 'days' ? day(parts[2]) + ' · verse' : 'Memory verse theme';
    case 'electives': {
      if (parts[1] === 'stations') return 'Elective · ' + (pick('electives/stations/' + parts[2] + '/name') || parts[2]);
      return day(parts[2]) + ' · electives';
    }
    case 'meta': return parts[1] === 'weekStart' ? 'Camp week · start date' : parts[1] === 'on' ? 'Editing here · ' + (parts[2] || '') : 'Camp week · ' + (parts[1] || 'setup');
    default: return String(path);
  }
}

// A value as words: minutes as clock times, a flag as yes/no, text quoted.
function setupShow(path, v) {
  if (v === null || v === undefined) return 'nothing';
  const f = String(path).split('/').pop();
  if (typeof v === 'number' && (f === 'start' || f === 'end')) return setupClock(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v === '' ? 'blank' : '“' + (v.length > 40 ? v.slice(0, 40) + '…' : v) + '”';
  if (typeof v === 'object') { const j = JSON.stringify(v); return j.length > 40 ? j.slice(0, 40) + '…' : j; }
  return String(v);
}

// ── 2. The engine ────────────────────────────────────────────────────

// Globals (§6.4.1). `setupBase` is the tree the server last CONFIRMED to this phone
// (canonical, persisted); `setupLast` what the server will hold once what is in flight
// lands (optimistic, canonical); `setupTree` the live tree readers and builders hold.
let setupRef = null;            // <root>/setup — attached post-approval (initSetupSync) and read-only until a director acts
let setupReady = false;         // the first snapshot has been processed: pushes may flow
let setupDenied = false;        // the setup read was refused (rules not published / access changed). Never touches fbRef/syncDenied
let setupWriteRefused = false;  // every path of a refused batch was refused: the rules for setup/* are not published
let setupTree = normalizeSetup({});
let setupBase = null;
let setupBaseAt = 0;            // when the server last confirmed anything to this phone
let setupBootBase = null;       // the base this page loaded with (a wipe is judged against it)
let setupLast = null;
let setupPending = 0;           // pushes handed to the server and not yet answered (offline: stays up)
let setupPushTimer = null;      // an edit is queued but unsent
let setupRefetchOwed = false;   // a snapshot arrived while a write was in flight: re-read (never replay) when quiet
let setupBisecting = false;     // a refused batch is being re-sent path by path
let setupBisectQueue = [];
let setupBisectHeld = false;    // a push was asked for mid-bisect
let setupQuarantine = {};       // path -> the value the rules refused (null = a delete)
let setupClashes = [];          // clashes and put-it-back notes (persisted, <= SETUP_CLASH_MAX)
let setupRev = 0;               // bumps on every change of the tree (cheap "did it change" for renderers)
let setupEdited = {};           // meta/edited as the server last said it (+ my estimate): who changed which section
let setupPersistOwed = false;   // a cache write was asked for while this tab's writer decision was pending
let setupFocus = null;          // { path, value } the builder field that has focus (§6.4.9)
let setupFocusOwed = {};        // path -> { theirs, mine }: a colleague's change that landed under a focused field
const setupListeners = [];

// The one hook UI layers use to repaint (the hub, the sync line, the sheets). Kinds:
// 'sync' (connection / pending / quarantine changed), 'tree' (the data changed),
// 'commit' (this device committed), 'clashes', 'here' (who else has the builder open changed). A listener that throws never stops the engine.
function onSetupEvent(fn) {
  setupListeners.push(fn);
  return () => { const i = setupListeners.indexOf(fn); if (i !== -1) setupListeners.splice(i, 1); };
}

function setupNotify(kind) {
  setupListeners.slice().forEach((fn) => { try { fn(kind); } catch (e) { console.warn('setup listener failed', e); } });
}

// Which sections are being edited here (meta/on/<section> === true). `week` is always on.
function setupOn(section) {
  if (section === 'week') return true;
  return !!(setupTree && setupTree.meta && setupTree.meta.on && setupTree.meta.on[section] === true);
}

// A node written by a NEWER build than this one: readers fall back to the built-in week
// and the hub says "update to see this" rather than guess at fields it doesn't know.
function setupSchemaTooNew() {
  const v = setupTree && setupTree.meta && setupTree.meta.schema;
  return typeof v === 'number' && v > SETUP_SCHEMA;
}

// Has this camp ever had Edit the week here pressed? (A seed record exists.)
function setupSeeded() {
  return !!(setupTree && setupTree.meta && setupIsMap(setupTree.meta.seeded));
}

// A patch row is live only while its typical block exists (see normalizeSetup): readers
// use this instead of reading `patches` raw.
function setupLivePatches(dk) {
  const out = {};
  const day = (setupTree.patches && setupTree.patches[dk]) || {};
  Object.keys(day).forEach((bid) => {
    const t = setupTree.typical && setupTree.typical[bid];
    if (setupIsMap(t) && t.start !== undefined && t.label !== undefined) out[bid] = day[bid];
  });
  return out;
}

// ── the cache ────────────────────────────────────────────────────────

function setupCachePayload() {
  return {
    v: 1,
    tree: setupCanon(setupTree),
    base: setupBase,
    baseAt: setupBaseAt,
    epoch: epochOfTree(setupBase || {}),
    clashes: setupClashes.slice(-SETUP_CLASH_MAX),
    quarantine: setupQuarantine,
  };
}

// THE writer of the setup cache — the only setItem of this key anywhere (tests scan for
// others), and a no-op unless this tab owns the cache (§6.9): a second editor tab is
// view-only and must not write the cache its sibling's unconfirmed edits live in. While
// the tab's writer decision is pending the write is owed and made the moment it is
// decided a writer (decideTabWriter → setupOnTabDecided). The tree and its confirmed
// base go in ONE setItem, so the pair can never disagree: a failed write (quota)
// leaves the previous consistent pair, so a stale cache can't pass for a deletion.
function persistSetup() {
  if (tabWriter !== true) {
    if (tabWriter === null) setupPersistOwed = true;
    return false;
  }
  try {
    localStorage.setItem(lsKey(SETUP_KEY), JSON.stringify(setupCachePayload()));
    return true;
  } catch (e) {
    console.warn('setup cache write failed (private mode or quota?)', e);
    return false;
  }
}

// Called at script load: a returning device on dead Wi-Fi paints the EDITED week.
// Runs once, at the very end of this file (after every const it uses is initialised —
// tests/boot-cache.test.js is the reason for that rule).
function setupLoadCache() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(lsKey(SETUP_KEY)) || 'null'); } catch (e) { c = null; }
  if (!c || c.v !== 1 || !setupIsMap(c.tree)) return;
  setupTree = normalizeSetup(setupClone(c.tree));
  setupBase = setupIsMap(c.base) ? c.base : null;
  setupBaseAt = Number(c.baseAt) || 0;
  setupBootBase = setupBase;
  setupLast = setupBase ? setupClone(setupBase) : null;
  setupClashes = Array.isArray(c.clashes) ? c.clashes.filter((n) => n && typeof n.id === 'string').slice(-SETUP_CLASH_MAX) : [];
  setupQuarantine = {};
  if (setupIsMap(c.quarantine)) {
    Object.keys(c.quarantine).forEach((p) => { if (SETUP_DEPTHS[p.split('/')[0]] !== undefined) setupQuarantine[p] = c.quarantine[p] === undefined ? null : c.quarantine[p]; });
  }
}

// The tab writer decision landed (app.js decideTabWriter): a writer makes the cache
// write that was owed and sends the push that was held.
function setupOnTabDecided(writer) {
  if (!writer) { setupPersistOwed = false; return; }
  if (setupPersistOwed) { setupPersistOwed = false; persistSetup(); }
}

// ── listener ─────────────────────────────────────────────────────────

// Attached from initSync, i.e. only after membership was approved (THE INVARIANT):
// under the locked rules a listener attached early would be cancelled, and a cancelled
// read is terminal. Every member reads setup; only an editor ever writes it. A
// refusal degrades the setup engine ONLY — it must never touch fbRef or syncDenied.
function initSetupSync() {
  if (setupRef) return;
  if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey) return;
  try {
    setupRef = firebase.database().ref(dbPath('setup'));
    attachSetupListener();
  } catch (e) {
    console.warn('setup sync init failed, staying on the built-in week', e);
    setupRef = null;
  }
}

function attachSetupListener() {
  setupRef.on('value', (snap) => {
    onSetupSnapshot(snap.val());
  }, (err) => {
    console.warn('Firebase setup read failed, staying on the built-in week', err);
    setupRef = null;
    setupDenied = true;
    setupReady = false;
    setupNotify('sync');
    if (typeof updateSyncIndicator === 'function') updateSyncIndicator();
  });
}

function onSetupSnapshot(remote) {
  if (!setupReady) { processFirstSetup(remote); return; }
  // Adopt only when nothing is in flight; otherwise the snapshot is the server's
  // PREVIOUS value re-firing on reconnect, and adopting it would revert what is queued.
  // RTDB fires `value` again only when the server data changes, so a turned-away
  // snapshot is gone: remember a read is owed and re-read (never replay) when quiet.
  if (setupPending > 0 || setupBisecting) { deferSetupSnapshot(); return; }
  if (!remote && setupBase && Object.keys(setupBase).length) { setupStrandWiped(); adoptSetup(remote, {}); return; }
  adoptSetup(remote);
}

function deferSetupSnapshot() {
  setupRefetchOwed = true;
  if (typeof armIdleRetry === 'function') armIdleRetry();
}

function setupRefetchIsOwed() {
  return setupRefetchOwed;
}

// The once-a-second idle tick (app.js idleRetryTick) pays the owed re-read.
function setupIdleTick() {
  if (!setupRefetchOwed) return;
  if (setupPending > 0 || setupBisecting) return;
  if (!setupRef) { setupRefetchOwed = false; return; }
  setupRefetchOwed = false;
  setupRef.once('value')
    .then((snap) => onSetupSnapshot(snap.val()))
    .catch(() => { /* offline — the live listener fires again on reconnect */ });
}

// ── the first snapshot (§6.4.4) ──────────────────────────────────────

// Three cases once the server has spoken. This device never had a base: plain adopt
// (and for an empty node that is just "not set up yet" — the engine NEVER seeds by
// itself; Edit the week here does). It had one and the epoch moved (a new camp year):
// its unconfirmed paths are last year's, stranded as a download, never applied. It had
// one and may have unconfirmed work: the three-way merge, per path. An EMPTY node on a
// device that has seen content is a deliberate wipe (the console): adopt the empty
// node and keep the old copy only as a download, never re-seed from the cache.
function processFirstSetup(remote) {
  setupReady = true;
  setupDenied = false;
  const remoteCanon = setupCanon(remote || {});
  if (setupBase) {
    const fromEpoch = epochOfTree(setupBase);
    const toEpoch = epochOfTree(remoteCanon);
    if (fromEpoch !== toEpoch) {
      const local = setupCanon(setupTree);
      const mine = canEdit() ? setupTreeDiff(setupBase, local) : {};
      setupStrand(mine, local, fromEpoch, toEpoch);
      setupForgetLastYear();
      adoptSetup(remote, {});
      return;
    }
    if (!remote && Object.keys(setupBase).length) {
      setupStrandWiped();
      adoptSetup(remote, {});
      return;
    }
    if (firstSetupMerge(remote)) return;
    if (!canEdit()) { adoptSetup(remote, {}); return; } // a viewer / read-only tab has no edits of its own to keep
  }
  adoptSetup(remote);
}

// base = the tree the server last confirmed to this phone; mine = what this phone
// changed since (treeDiff, still unconfirmed); theirs = what everyone else changed on
// the server since. Keep every path of mine nobody else touched and push exactly those;
// the same path changed on both sides keeps the SERVER's value (the loser is listed for
// "Use mine" and gets a synthetic undo entry); a kept op whose record the server deleted
// goes to the Put-it-back list instead of being pushed into a refusal. Returns false
// when there is nothing of mine to protect (the caller adopts plainly).
function firstSetupMerge(remote) {
  if (!canEdit()) return false;
  const base = setupBase;
  const localCanon = setupCanon(setupTree);
  const mine = setupTreeDiff(base, localCanon);
  const minePaths = Object.keys(mine);
  if (!minePaths.length) return false;
  const remoteCanon = setupCanon(remote || {});
  const theirs = setupTreeDiff(base, remoteCanon);
  const theirPaths = Object.keys(theirs);
  // A record the server deleted is not a clash with an edit INSIDE it: that edit is
  // dropped by setupApplyOps and offered back under "Put it back".
  const recordDeleted = (q) => theirs[q] === null && setupRecordDepth(q.split('/')) === q.split('/').length;
  const keep = {};
  const clashed = [];
  minePaths.forEach((p) => {
    if (JSON.stringify(setupValueAt(remoteCanon, p)) === JSON.stringify(setupCanonVal(mine[p]))) return; // the server already says it
    const clash = theirPaths.some((q) => syncPathsOverlap(p, q) && !(recordDeleted(q) && p.startsWith(q + '/')));
    if (clash) clashed.push(p); else keep[p] = mine[p];
  });
  let kept = keep;
  if (Object.keys(kept).length && setupBaseAt && Date.now() - setupBaseAt > SETUP_STALE_MS) {
    const when = typeof formatEasternStamp === 'function' ? formatEasternStamp(new Date(setupBaseAt).toISOString()) : '';
    const n = Object.keys(kept).length;
    if (!confirm(`This phone has ${n} change${n === 1 ? '' : 's'} to the week setup saved${when ? ' since ' + when : ''} that never reached the server. Send ${n === 1 ? 'it' : 'them'} now?`)) kept = {};
  }
  adoptSetup(remote, kept);
  setupRecordClashes(clashed, mine, localCanon, remoteCanon, remote || {});
  pushSetup(); // whatever now differs from the new base (my kept paths); a no-op when nothing does
  return true;
}

// ── adopting a snapshot (§6.4.5) ─────────────────────────────────────

// Adopt `remote` with this phone's UNSENT edits laid over it — rebase on receipt, never
// stash. `mineOps` supplies the ops to lay over (the first merge's kept set, `{}` for
// "take the server verbatim"); by default it is every edit made but not yet pushed
// (treeDiff(setupLast, tree): the 300 ms window). Parked (refused) values the server
// hasn't moved past stay laid over too, and are treated as sent. Returns true when the
// tree changed. An echo — the snapshot equals what this device already believes the
// server holds (its own write coming back) — keeps every live object and repaints nothing.
function adoptSetup(remote, mineOps) {
  const remoteCanon = setupCanon(remote || {});
  setupEditedFromRemote(remote);
  if (mineOps === undefined && setupLast && JSON.stringify(remoteCanon) === JSON.stringify(setupLast)) {
    if (JSON.stringify(setupBase) !== JSON.stringify(remoteCanon)) { setupBase = remoteCanon; setupBaseAt = Date.now(); persistSetup(); }
    return false;
  }
  const localCanon = setupCanon(setupTree);
  const beforeJson = JSON.stringify(localCanon);
  const unsent = mineOps !== undefined ? mineOps : (setupLast ? setupTreeDiff(setupLast, localCanon) : {});
  // A parked path the server has moved past (somebody changed the same value, or deleted
  // the record it lives in) is dropped: the server's version wins, as in the first merge.
  const parked = {};
  Object.keys(setupQuarantine).forEach((p) => {
    if (!setupSuperseded(p, remoteCanon, setupBase)) parked[p] = setupQuarantine[p]; else delete setupQuarantine[p];
  });
  const r = setupApplyOps(remoteCanon, Object.assign({}, unsent, parked));
  const next = normalizeSetup(setupClone(r.tree));
  Object.keys(parked).forEach((p) => { // a parked value that didn't survive the lay-over is gone from quarantine too
    const kept = setupValueAt(r.tree, p);
    if (JSON.stringify(kept) !== JSON.stringify(setupCanonVal(parked[p]))) delete setupQuarantine[p];
  });
  const prevTree = setupTree;
  setupBase = remoteCanon;
  setupBaseAt = Date.now();
  setupLast = Object.keys(setupQuarantine).length ? setupCanon(applySyncPaths(remoteCanon, setupQuarantine)) : remoteCanon;
  const changed = JSON.stringify(setupCanon(next)) !== beforeJson;
  if (changed) {
    setupHoldFocused(localCanon, setupCanon(next));
    setupTree = setupKeepRefs(prevTree, next);
    setupRev++;
  }
  persistSetup();
  if (r.dropped.length) setupNoteDropped(r.dropped, localCanon);
  // What survived on top of the server's tree is re-sent by the next push.
  if (setupRef && Object.keys(setupTreeDiff(setupLast, setupCanon(setupTree))).length) scheduleSetupPush();
  setupNotify(changed ? 'tree' : 'sync');
  if (changed && typeof appStarted !== 'undefined' && appStarted && typeof renderAllWhenIdle === 'function') {
    // A change from ELSEWHERE: the data is applied; only the repaint waits for a focused field.
    // (It does not touch `remoteJustApplied`: nothing in the setup tree moves points yet.)
    renderAllWhenIdle();
  }
  return changed;
}

// Did the server move past a parked path since it last confirmed anything to this
// phone (the same value changed, or an ancestor record deleted)?
function setupSuperseded(path, serverTree, prevTree) {
  if (!prevTree) return false;
  const key = (t, p) => { const v = syncCanon(syncValueAt(t, p)); return v === undefined ? 'null' : JSON.stringify(v); };
  const parts = path.split('/');
  if (key(serverTree, path) !== key(prevTree, path)) return true;
  for (let i = 1; i < parts.length; i++) {
    const q = parts.slice(0, i).join('/');
    if (key(prevTree, q) !== 'null' && key(serverTree, q) === 'null') return true;
  }
  return false;
}

function setupEditedFromRemote(remote) {
  const e = remote && remote.meta && remote.meta.edited;
  const out = {};
  if (setupIsMap(e)) {
    Object.keys(e).forEach((s) => {
      const r = e[s];
      if (setupIsMap(r) && typeof r.at === 'number' && typeof r.byKey === 'string') out[s] = { at: r.at, byKey: r.byKey };
    });
  }
  setupEdited = out;
}

// The synthetic estimate this device shows for its own stamp (display only: the real
// one is the server's time, written at push).
function setupMarkEdited(paths) {
  const key = identityKey(authUser);
  if (!key) return;
  paths.forEach((p) => {
    const s = setupSectionOf(p);
    if (s) setupEdited[s] = { at: serverNow(), byKey: key };
  });
}

// Who last changed a section, and when — for "Patrick removed this item" and the hub's
// "also changed" lines. Names fail CLOSED (see setupEditorName).
function setupEditedBy(section) {
  const e = setupEdited[section];
  return e ? { at: e.at, byKey: e.byKey, name: setupEditorName(e.byKey) } : null;
}

// A director's name from the member directory, for sentences ("Patrick changed this").
// Editor-maintained, so it is the source of truth; with no directory yet — or a key
// that isn't an editor — it says "Another director" rather than trusting anything a
// device wrote (the chatAuthorName rule). Your own key is "You".
function setupEditorName(key) {
  if (!key) return 'Another director';
  if (identityKey(authUser) === key) return 'You';
  if (!memberDirectoryLoaded || !memberDirectory || !Object.prototype.hasOwnProperty.call(memberDirectory, key)) return 'Another director';
  const rec = memberDirectory[key];
  if (!rec || rec.role !== 'editor') return 'Another director';
  const first = typeof rec.name === 'string' ? rec.name.trim().split(/\s+/)[0] : '';
  return first ? first.slice(0, 30) : 'Another director';
}

// ── wiped / stranded work ────────────────────────────────────────────

function setupStrand(mine, localCanon, fromEpoch, toEpoch) {
  const changes = Object.keys(mine).map((p) => ({
    path: 'setup/' + p, what: setupWhat(p, localCanon), value: mine[p] === undefined ? null : mine[p],
  }));
  if (!changes.length) return false;
  const kept = addStranded({
    at: new Date().toISOString(),
    from: fromEpoch || 'legacy',
    to: toEpoch || 'legacy',
    lastSyncedAt: setupBaseAt ? new Date(setupBaseAt).toISOString() : null,
    changes,
  });
  const n = changes.length;
  showToast(`⚠️ This phone had ${n} change${n === 1 ? '' : 's'} to the week setup from last camp week that never synced. ${n === 1 ? 'It wasn’t' : 'They weren’t'} added to this week. ` +
    (kept ? `Download ${n === 1 ? 'it' : 'them'} from the bar at the top of the page.` : 'This phone is out of room to keep them, so download them now.'));
  if (typeof updateSyncIndicator === 'function') updateSyncIndicator();
  return true;
}

// The server's setup node is gone although this phone had content confirmed: somebody
// cleared it on purpose (the console). Adopt the empty node; keep what this phone held
// only as a download ("Download my setup" is the stranded bar), never re-seed from it.
function setupStrandWiped() {
  const old = setupBase && Object.keys(setupBase).length ? setupBase : setupCanon(setupTree);
  const changes = Object.keys(old).map((k) => ({ path: 'setup/' + k, what: 'The week setup · ' + k, value: old[k] }));
  if (!changes.length) return;
  addStranded({
    at: new Date().toISOString(), from: epochOfTree(old) || 'legacy', to: 'legacy',
    lastSyncedAt: setupBaseAt ? new Date(setupBaseAt).toISOString() : null, changes,
  });
  showToast('⚠️ The week setup was cleared on the server, so this phone went back to the original week. What it held can be downloaded from the bar at the top of the page.');
  if (typeof updateSyncIndicator === 'function') updateSyncIndicator();
}

// Last camp year's clashes and undo history mean nothing in the new one.
function setupForgetLastYear() {
  setupClashes = [];
  setupQuarantine = {};
  undoClear();
}

// ── clashes and the Put-it-back list (§6.4.6, §6.4.5) ────────────────
// Entries (persisted with the cache, <= SETUP_CLASH_MAX):
//   clash    { id, kind:'clash', domain:'setup', path, mine, theirs, what, byKey, at }
//            the same path changed on both sides while I was offline; the server's value
//            won. Use mine (a normal commit, with undo) / Dismiss.
//   putback  { id, kind:'putback', domain:'setup', record, name, value, ops, why?, collide?, at }
//            an edit of mine hit a record somebody deleted (or a patch whose block/day is
//            gone). Put it back with my changes / Discard.

function setupNoteId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function setupClashList() {
  return setupClashes.slice();
}

function setupSetClashes(list) {
  setupClashes = list.slice(-SETUP_CLASH_MAX);
  persistSetup();
  setupNotify('clashes');
}

function setupDismissClash(id) {
  setupSetClashes(setupClashes.filter((n) => n.id !== id));
}

function setupRecordClashes(paths, mine, localCanon, remoteCanon, remote) {
  if (!paths.length) return;
  const added = paths.map((p) => {
    const by = remote && remote.meta && remote.meta.edited && remote.meta.edited[setupSectionOf(p)];
    return {
      id: setupNoteId(), kind: 'clash', domain: 'setup', path: p, mine: mine[p], theirs: setupValueAt(remoteCanon, p),
      what: setupWhat(p, localCanon, remoteCanon), byKey: by && typeof by.byKey === 'string' ? by.byKey : '', at: new Date().toISOString(),
    };
  });
  setupSetClashes(setupClashes.filter((n) => !(n.kind === 'clash' && added.some((a) => a.path === n.path))).concat(added));
  // The synthetic entry changes MINE into THEIRS, so Undo (which puts `before` back where
  // the value still equals `after`) brings my offline edit back (spec §7.1, sync-F10).
  added.forEach((a) => undoRecord('Bring back your offline change to ' + a.what, [['setup', a.path, a.mine, a.theirs]], { quiet: true }));
  const who = [...new Set(added.map((a) => setupEditorName(a.byKey)))];
  const whose = who.length === 1 && who[0] !== 'Another director' && who[0] !== 'You' ? who[0] + '’s' : 'someone else’s';
  showToast(`⚠️ ${added.length} change${added.length === 1 ? '' : 's'} you made offline clashed with ${whose} — kept theirs. Set up the week can bring ${added.length === 1 ? 'it' : 'them'} back.`);
}

// Edits dropped because their record is gone on the server: one Put-it-back entry per record.
function setupNoteDropped(dropped, localCanon) {
  const byRecord = {};
  dropped.forEach((d) => { (byRecord[d.record] = byRecord[d.record] || []).push(d); });
  const added = [];
  Object.keys(byRecord).forEach((record) => {
    const ops = byRecord[record];
    const rec = setupValueAt(localCanon, record);
    const first = ops[0];
    // A bare reorder of something that is gone isn't worth a question.
    if (ops.every((d) => /\/ord$/.test(d.path))) return;
    const name = (rec && (rec.label || rec.name || rec.dish)) || setupWhat(record, localCanon).split(' · ').pop();
    if (setupClashes.some((n) => n.kind === 'putback' && n.record === record && JSON.stringify(n.ops) === JSON.stringify(ops.map((d) => ({ path: d.path, value: d.value }))))) return;
    added.push({
      id: setupNoteId(), kind: 'putback', domain: 'setup', record, name, value: rec,
      ops: ops.map((d) => ({ path: d.path, value: d.value })), at: new Date().toISOString(),
      ...(first.collide ? { collide: true } : {}), ...(first.why ? { why: first.why } : {}),
    });
  });
  if (!added.length) return;
  setupSetClashes(setupClashes.filter((n) => !(n.kind === 'putback' && added.some((a) => a.record === n.record))).concat(added));
  const quoted = added.map((a) => '“' + a.name + '”').join(', ');
  showToast(`⚠️ ${quoted} ${added.length === 1 ? 'was' : 'were'} removed while you were editing. Set up the week can put ${added.length === 1 ? 'it' : 'them'} back with your changes.`);
}

// "Use mine": write my offline value over the server's, as a normal commit with undo.
function setupUseMine(id) {
  const note = setupClashes.find((n) => n.id === id && n.kind === 'clash');
  if (!note) return { ok: false, reason: 'gone' };
  const r = commitSetup((draft) => { setupSetPath(draft, note.path, note.mine); }, {
    label: 'Used your version of ' + note.what, section: setupSectionOf(note.path),
  });
  if (r.ok) setupDismissClash(id);
  return r;
}

// "Put it back with my changes": re-create the whole record (with the edits that hit
// it). A collision (two phones minted one id) re-creates it under a fresh id; a patch
// whose day became its own can't be put back here — the change is made on that day.
function setupPutBack(id) {
  const note = setupClashes.find((n) => n.id === id && n.kind === 'putback');
  if (!note) return { ok: false, reason: 'gone' };
  if (note.why === 'day') return { ok: false, reason: 'day', message: 'That day has its own schedule now — open it and make the change there.' };
  const parts = note.record.split('/');
  let record = note.record;
  const there = syncValueAt(setupCanon(setupTree), record) !== undefined;
  const rekey = there && note.collide && (parts[0] === 'typical' || parts[0] === 'dayBlocks');
  if (there && parts[0] !== 'patches' && !rekey) { setupDismissClash(id); return { ok: true, already: true }; }
  const r = commitSetup((draft) => {
    let value = note.value;
    if (!value) return false;
    if (parts[0] === 'patches') { // a patch row goes back as the fields I had changed
      value = Object.assign({}, setupValueAt(setupCanon(draft), record) || {});
      note.ops.forEach((o) => { value[o.path.split('/').pop()] = o.value; });
    } else if (rekey) {
      parts[parts.length - 1] = 'b-' + Math.random().toString(36).slice(2, 10);
      record = parts.join('/');
    }
    setupSetPath(draft, record, value);
    return undefined;
  }, { label: (note.collide ? 'Added “' : 'Put back “') + note.name + '”', section: setupSectionOf(note.record) });
  if (r.ok) setupDismissClash(id);
  return r;
}

// ── focused fields (§6.4.9) ──────────────────────────────────────────
// Every builder input carries data-bind="setup:<path>". The data of an adopted snapshot
// applies at once, but a changed path overlapping the FOCUSED input's bind must not be
// written into the input under the director's thumb: the engine records it, and the
// field shows "Patrick just changed this to 2:30 PM — Use his / Keep yours". The value
// is recorded when the field GAINS focus (sync-F3), so a bare tap-and-blur — or tabbing
// across the Meals grid — writes NOTHING: setupFocusOut says "nothing changed" and the
// caller does not commit. Only a field the director really changed becomes a write.
function setupFocusIn(path) {
  setupFocus = { path, value: setupValueAt(setupCanon(setupTree), path) };
}

function setupFocusOut(path, typed) {
  const focus = setupFocus && setupFocus.path === path ? setupFocus : null;
  const owed = setupFocusOwed[path] || null;
  setupFocus = null;
  delete setupFocusOwed[path];
  const before = focus ? focus.value : null;
  const changed = JSON.stringify(before === undefined ? null : before) !== JSON.stringify(typed === undefined ? null : typed);
  return { changed, owed };
}

function setupHoldFocused(oldCanon, newCanon) {
  if (!setupFocus) return;
  const p = setupFocus.path;
  const a = JSON.stringify(setupValueAt(oldCanon, p));
  const b = JSON.stringify(setupValueAt(newCanon, p));
  if (a !== b) setupFocusOwed[p] = { theirs: setupValueAt(newCanon, p), mine: setupFocus.value };
}

// ── committing (§6.4.2) ──────────────────────────────────────────────

// May the tree be edited right now? Yes once the first snapshot has been processed;
// before that only on a device holding a confirmed baseline (its edit is kept and
// three-way merged when the snapshot lands), and whenever no snapshot can ever come
// that could replace an edit (sync isn't configured: local-only). A refused read or
// refused writes (the rules for setup/* not published) is NOT editable: the hub says
// "Editing the week here isn't available yet".
function setupEditable() {
  if (setupDenied || setupWriteRefused) return false;
  if (setupReady) return true;
  if (!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey)) return true;
  return !!setupBase;
}

// The one write path of the tree. `mutate(draft)` edits a COPY of the live tree (it
// returns false to cancel); the diff against the live tree is the edit.
//   opts.label   plain words for the undo entry ("Moved Swim to 3:00 PM on Tue")
//   opts.undo    false = no undo entry (a restore: restore points cover it)
//   opts.quiet   no toast on the undo entry (Undo itself, a synthetic entry)
//   opts.expect  record paths this edit assumes exist ('typical/b-swim-900'): one that a
//                colleague removed refuses it ("Patrick removed this item")
//   opts.turningOn  the section's own data may be written although its switch is not on
//                (Edit the week here seeds the section; owner only)
// Returns { ok:true, ops, entry } or { ok:false, reason, … } — reasons: readonly, loading,
// cancelled, removed (paths / dropped), off (section), owner (message). A refusal writes
// nothing and says nothing; the caller words it.
function commitSetup(mutate, opts) {
  const o = opts || {};
  const refuse = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  if (!canEdit()) return refuse('readonly');
  if (!setupEditable()) return refuse('loading');
  const before = setupCanon(setupTree);
  // Existence check: an edit into an item a colleague already removed.
  const gone = (o.expect || []).filter((p) => syncValueAt(before, p) === undefined);
  if (gone.length) {
    const by = setupEditedBy(setupSectionOf(gone[0])) ;
    return refuse('removed', { paths: gone, byName: by ? by.name : 'Another director' });
  }
  const draft = setupClone(setupTree);
  if (mutate(draft) === false) return refuse('cancelled');
  normalizeSetup(draft);
  const after = setupCanon(draft);
  const ops = setupTreeDiff(before, after);
  const paths = Object.keys(ops);
  if (!paths.length) return { ok: true, noop: true, ops: {} }; // a bare focus-and-blur, an identical value: nothing to send, stamp or undo
  // Owner-only fields (the switches, the epoch, the wizard claim, the seed): refused
  // here, before any write, with the sentence the director reads.
  if (paths.some(setupIsOwnerPath)) {
    const gate = ownerGate(o.ownerWhat || 'change that');
    if (!gate.ok) return refuse('owner', { message: gate.reason });
  }
  // A section whose switch is off is the built-in copy: nothing is edited into it.
  const closed = paths.map(setupSectionOf).find((s) => s && !setupOn(s) && !o.turningOn);
  if (closed) return refuse('off', { section: closed });
  // The rules' anchors, said first: a field into a record that is gone, a patch for a
  // block that is gone or a day that is its own.
  const applied = setupApplyOps(before, ops);
  if (applied.dropped.length) return refuse('removed', { dropped: applied.dropped, byName: (setupEditedBy(setupSectionOf(applied.dropped[0].path)) || {}).name || 'Another director' });
  restoreAutoForEdit(); // "Before Jenn's edits, 3:05 PM": the body is captured NOW, before this edit is applied
  let entry = null;
  if (o.undo !== false) {
    entry = undoRecord(o.label || 'Changed the week setup', paths.map((p) => ['setup', p, setupValueAt(before, p), ops[p]]), o);
  }
  setupTree = setupKeepRefs(setupTree, draft);
  setupMarkEdited(paths);
  setupRev++;
  persistSetup(); // immediately — tree and base in ONE setItem — so a force-quit right after a tap is safe
  scheduleSetupPush();
  setupNotify('commit');
  if (typeof appStarted !== 'undefined' && appStarted && typeof renderAllWhenIdle === 'function') renderAllWhenIdle();
  return { ok: true, ops, entry };
}

// ── pushing (§6.4.3) ─────────────────────────────────────────────────

function scheduleSetupPush() {
  if (!setupRef) return;
  clearTimeout(setupPushTimer);
  // Null the handle when it fires so `setupPushTimer !== null` is an accurate "an edit is
  // queued but unsent" (editorMidEntry and the reload guard read it).
  setupPushTimer = setTimeout(() => { setupPushTimer = null; pushSetup(); }, setupPushMs);
}

// `meta/edited/<section>`: who changed a section and when — added at PUSH time with the
// server's clock, and never part of the diffed tree.
function setupStamps(diff) {
  const key = identityKey(authUser);
  const out = {};
  if (!key || typeof firebase === 'undefined' || !firebase.database || !firebase.database.ServerValue) return out;
  [...new Set(Object.keys(diff).map(setupSectionOf).filter(Boolean))].forEach((s) => {
    out['meta/edited/' + s] = { at: firebase.database.ServerValue.TIMESTAMP, byKey: key };
  });
  return out;
}

// One multi-path update of exactly what changed since the server last acknowledged. The
// gate: a ref, the FIRST PULL (never push before it: a stale cache would wipe everyone's
// newer setup), no refusal of the read, an editor, and a tab that owns the cache.
function pushSetup() {
  if (!setupRef || !setupReady || setupDenied || setupWriteRefused || !canEdit()) return;
  if (!tabMayPush('setup')) return; // undecided tabs hold (and remember); a read-only tab has no edits of its own
  if (setupBisecting) { setupBisectHeld = true; return; }
  if (!setupLast) return;
  const cur = setupCanon(setupTree);
  const prev = setupLast;
  const diff = setupTreeDiff(prev, cur);
  if (!Object.keys(diff).length) return;
  const updates = Object.assign({}, diff, setupStamps(diff));
  setupLast = cur;
  setupPending++;
  setupNotify('sync');
  const settle = () => { setupPending = Math.max(0, setupPending - 1); setupNotify('sync'); if (typeof updateSyncIndicator === 'function') updateSyncIndicator(); };
  // update() can throw SYNCHRONOUSLY (an illegal key from a hand-edited backup); without the
  // catch the counter would stay raised and block every reload.
  try {
    setupRef.update(updates).then(() => {
      setupBase = applySyncPaths(setupBase || {}, diff); // the server holds these paths now (acks arrive in order, so this composes)
      setupBaseAt = Date.now();
      persistSetup();
      setupPruneQuarantine();
      settle();
    }, (e) => {
      // ONLY a rules refusal is quarantined, and only for an editor (the person who typed it
      // and can Retry or Discard). Every other failure (a dropped connection) keeps the diff.
      if (e && e.code === 'PERMISSION_DENIED' && canEdit()) { startSetupBisect(diff, prev, settle); return; }
      console.warn('setup push failed', e);
      setupLast = prev; // re-diffed (and re-sent) next time
      showToast('Couldn’t save the week setup — check your connection and try again.');
      settle();
    });
  } catch (e) {
    console.warn('setup push threw', e);
    setupLast = prev;
    settle();
  }
}

// ── refused writes: bisect and quarantine (§6.4.7) — never a silent wedge ─
// One atomic update() is refused as a whole when ANY path breaks a rule. On
// PERMISSION_DENIED (only) the batch is re-sent one path at a time (halved first beyond
// SETUP_BISECT_SINGLES): paths the server takes advance the confirmed base exactly like
// an ack; a path refused alone is parked in setupQuarantine (persisted), treated as
// sent, and named on the sync line with Retry / Discard. If EVERY path of a batch of
// two or more is refused and none is explained by a missing record, the rules for
// setup/* are not published: setupWriteRefused turns the editing off with that sentence.

function startSetupBisect(updates, prev, settle) {
  setupBisectQueue.push({ updates, prev, settle });
  if (setupBisecting) return;
  setupBisecting = true;
  runSetupBisects().catch((e) => { console.warn('setup bisect failed', e); });
}

async function runSetupBisects() {
  try {
    while (setupBisectQueue.length) {
      const job = setupBisectQueue.shift();
      try { await bisectSetupBatch(job); } catch (e) { console.warn('setup bisect failed', e); } finally { job.settle(); }
    }
  } finally {
    setupBisecting = false;
    if (setupBisectHeld) { setupBisectHeld = false; pushSetup(); }
  }
}

// Is the LIVE local value at `path` still `value`? (A path whose value moved on since the
// refused batch is left to the next normal push.)
function setupValueIs(path, value) {
  const live = setupValueAt(setupCanon(setupTree), path);
  const want = syncCanon(value);
  return JSON.stringify(live) === JSON.stringify(want === undefined ? null : want);
}

async function bisectSetupBatch(job) {
  const updates = job.updates;
  const open = new Set(Object.keys(updates));
  let attempted = 0;
  let parked = 0;
  let explained = 0;
  const send = async (group) => {
    const sub = {};
    group.forEach((p) => { if (setupValueIs(p, updates[p])) sub[p] = updates[p]; else open.delete(p); });
    if (!Object.keys(sub).length) return true;
    try {
      await setupRef.update(sub);
    } catch (e) {
      if (e && e.code === 'PERMISSION_DENIED') return false;
      throw e; // a dropped connection etc.: the finally below hands the rest back to the diff
    }
    setupBase = applySyncPaths(setupBase || {}, sub);
    setupBaseAt = Date.now();
    persistSetup();
    Object.keys(sub).forEach((p) => open.delete(p));
    return true;
  };
  const park = (p) => {
    open.delete(p);
    attempted++;
    if (!(p in setupQuarantine)) parked++;
    if (setupExplainRefusal(p)) explained++;
    setupQuarantine[p] = updates[p] === undefined ? null : updates[p];
    setupQuarantineChanged();
  };
  const settleGroup = async (group) => {
    if (group.length > SETUP_BISECT_SINGLES) {
      const mid = group.length >> 1;
      for (const half of [group.slice(0, mid), group.slice(mid)]) {
        if (!(await send(half))) await settleGroup(half);
      }
      return;
    }
    for (const p of group) {
      if (!open.has(p)) continue;
      if (!(await send([p]))) park(p); else attempted++;
    }
  };
  try {
    await settleGroup(Object.keys(updates));
  } catch (e) {
    console.warn('setup push failed', e);
  } finally {
    // Whatever the bisect never reached goes back into the diff, as a failed push does.
    if (open.size && setupLast) {
      const back = {};
      open.forEach((p) => { back[p] = setupValueAt(job.prev, p); });
      setupLast = setupCanon(applySyncPaths(setupLast, back));
    }
  }
  if (attempted >= 2 && parked === attempted && !explained) {
    setupWriteRefused = true; // every path refused, none for a vanished record: the rules aren't published
    Object.keys(setupQuarantine).forEach((p) => { delete setupQuarantine[p]; });
    setupQuarantineChanged();
  }
  setupPruneQuarantine();
  if (parked) showToast('⚠️ A change couldn’t be saved. Retry or Discard it from the red bar at the top of the screen.');
}

// Why the rules would refuse `path` even with the rules published: its record (or, for a
// patch, its block / day) is gone on the server. '' = no such reason.
function setupExplainRefusal(path) {
  const base = setupBase || {};
  const parts = path.split('/');
  if (parts[0] === 'patches' && parts.length >= 3) {
    const why = setupPatchAnchor(base, parts[1], parts[2]);
    return why === 'block' ? 'its item was removed from the typical day' : why === 'day' ? 'that day follows its own schedule now' : '';
  }
  const depth = setupRecordDepth(parts);
  if (depth && parts.length > depth && syncValueAt(base, parts.slice(0, depth).join('/')) === undefined) return 'it was removed';
  return '';
}

function setupQuarantineChanged() {
  persistSetup();
  setupNotify('sync');
  if (typeof updateSyncIndicator === 'function') updateSyncIndicator();
}

// Parked paths whose local value now equals what the server confirmed: the retry got
// through, somebody else's snapshot replaced it, or Discard restored it.
function setupPruneQuarantine() {
  if (!setupBase) return;
  let changed = false;
  Object.keys(setupQuarantine).forEach((p) => {
    const mine = setupValueAt(setupCanon(setupTree), p);
    if (JSON.stringify(setupValueAt(setupBase, p)) === JSON.stringify(mine)) { delete setupQuarantine[p]; changed = true; }
  });
  if (changed) setupQuarantineChanged();
}

function setupParkedCount() {
  return Object.keys(setupQuarantine).length;
}

// What is parked, in words: "Tuesday · Supper · starts". One line; the rest counted.
function setupParkedWords() {
  const names = [];
  Object.keys(setupQuarantine).forEach((p) => {
    const w = setupWhat(p, setupCanon(setupTree), setupBase || {});
    if (names.indexOf(w) === -1) names.push(w);
  });
  return names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) + ' more' : '');
}

// Retry: put every parked path back into the diff (its baseline becomes what the server
// holds) and push now. What goes out is the CURRENT local value.
function retrySetupQuarantine() {
  if (!canEdit()) return false;
  const paths = Object.keys(setupQuarantine);
  if (!paths.length && !setupWriteRefused) return false;
  if (!setupRef || !setupReady) { showToast('Not connected yet. Try again in a moment.'); return false; }
  if (setupLast && setupBase) {
    const back = {};
    paths.forEach((p) => { back[p] = setupValueAt(setupBase, p); });
    setupLast = setupCanon(applySyncPaths(setupLast, back));
  }
  // "Rules not published": no path was parked (there would have been dozens), so everything this phone changed
  // since the server last confirmed is still unsent. Measure the next push from there.
  if (setupWriteRefused && setupBase) setupLast = setupClone(setupBase);
  setupQuarantine = {};
  setupWriteRefused = false;
  setupQuarantineChanged();
  pushSetup(); // held until a running bisect ends
  return true;
}

// Discard: put each parked path back to the value the server confirmed, in the live tree
// AND the diff baseline, so nothing is re-sent. Asked first — the director typed those.
function discardSetupQuarantine(opts) {
  if (!canEdit()) return false;
  const paths = Object.keys(setupQuarantine);
  if (!paths.length) return false;
  if (!setupBase) { showToast('Not connected yet. Try again in a moment.'); return false; }
  const n = paths.length;
  if (!(opts && opts.confirmed) && !confirm(`Discard ${n === 1 ? 'the change' : 'these ' + n + ' changes'} that couldn’t be saved? The week goes back to what is saved.`)) return false;
  const draft = setupClone(setupTree);
  const back = {};
  paths.forEach((p) => { back[p] = setupValueAt(setupBase, p); setupSetPath(draft, p, back[p]); });
  normalizeSetup(draft);
  setupTree = setupKeepRefs(setupTree, draft);
  if (setupLast) setupLast = setupCanon(applySyncPaths(setupLast, back));
  setupQuarantine = {};
  setupRev++;
  setupQuarantineChanged();
  setupNotify('tree');
  if (typeof appStarted !== 'undefined' && appStarted && typeof renderAll === 'function') renderAll();
  return true;
}

// The header's red bar, for a parked setup path (app.js updateSyncAlert / setup-ui's copy).
function setupQuarantineBarHtml() {
  const n = setupParkedCount();
  return `<span class="sync-alert-text">⚠️ ${n} change${n === 1 ? '' : 's'} unsaved: <em>${esc(setupParkedWords())}</em></span>` +
    '<span class="sync-quarantine-actions">' +
    '<button type="button" class="link-btn sync-quarantine-btn" data-setup-quarantine="retry">Retry</button> ' +
    '<button type="button" class="link-btn danger-link sync-quarantine-btn" data-setup-quarantine="discard">Discard</button>' +
    '</span>';
}

// ── undo (§7.1): the `setup` domain ──────────────────────────────────
// Undo puts `before` back ONLY where the value still equals `after`; a change somebody
// made since is left alone and said out loud (undoEntry does the talking). The undo is
// itself a commit through this engine, so it syncs, survives offline, and becomes a new
// "Undid: …" entry. A path whose record is gone is returned as dropped ("left").
UNDO_DOMAINS.setup = {
  valueAt: (path) => setupValueAt(setupCanon(setupTree), path),
  what: (path) => setupWhat(path, setupCanon(setupTree)),
  apply: (changes, label) => {
    const before = setupCanon(setupTree);
    const r = setupApplyOps(before, changes);
    const res = commitSetup((draft) => { setupReplaceTree(draft, normalizeSetup(setupClone(r.tree))); }, { label, quiet: true });
    if (!res.ok) return Object.keys(changes);
    return r.dropped.map((d) => d.path);
  },
};

// ── accounting (§6.5): one number for every guard ────────────────────

function setupPendingCount() {
  return setupPending;
}

// An edit is typed/queued but unsent, or a push is held by an undecided tab.
function setupBusy() {
  return setupPushTimer != null;
}

// What this phone changed that the server hasn't confirmed ({} when none, or when it has
// no baseline to measure against).
function setupUnconfirmed() {
  return setupBase ? setupTreeDiff(setupBase, setupCanon(setupTree)) : {};
}

function setupHasUnconfirmed() {
  // A restore point queued offline (the 4 s fallback) is work too: sign-out / a camp switch wipe the outbox.
  return Object.keys(setupUnconfirmed()).length > 0 || setupParkedCount() > 0 || restoreOutboxCount() > 0;
}

// pagehide / visibilitychange: iOS suspends setTimeout when the phone locks, so a setup
// edit right before locking would strand its 300 ms push.
function flushSetupPush() {
  if (setupPushTimer) { clearTimeout(setupPushTimer); setupPushTimer = null; pushSetup(); }
}

// A device that stops being an editor keeps no setup undo (app.js clears the stack) and
// is not typing into the builder any more.
function setupOnRoleChange(prev, next) {
  if (prev === 'editor' && next !== 'editor') { setupFocus = null; setupFocusOwed = {}; }
  if (typeof editorsHereOnRoleChange === 'function') editorsHereOnRoleChange(prev, next);
}

// ── the sync line (the builder frame's `#setup-sync[data-tone]`) ─────
// One pure function of the engine's state, in the five tones the markup draws:
//   saved | saving | offline | error | off
// "Needs a connection" and a REFUSED write are never said with the same words: offline is
// calm and heals itself, a refusal is red and waits for a person (§6.8).
function setupSyncConfigured() {
  return !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) && !sdkLoadFailed;
}

function setupSyncLine() {
  if (!setupSyncConfigured()) return { tone: 'off', text: 'This device only — changes aren’t shared', act: '' };
  if (setupDenied) return { tone: 'off', text: 'Editing the week here isn’t available yet', act: '' };
  if (setupWriteRefused) return { tone: 'error', text: 'Editing the week here isn’t available yet — the database rules haven’t been updated', act: 'details' };
  const unsent = Object.keys(setupUnconfirmed()).length;
  if (fbConnKnown && !fbConnected) {
    return { tone: 'offline', text: unsent ? `Offline — ${unsent} change${unsent === 1 ? '' : 's'} will save when you’re back` : 'Offline — changes will save when you’re back', act: '' };
  }
  if (setupRef && !setupReady) return { tone: 'saving', text: 'Connecting…', act: '' }; // the first pull hasn't landed: "Saved" would be a guess
  const parked = setupParkedCount();
  if (parked) return { tone: 'error', text: `Couldn’t save ${parked === 1 ? setupParkedWords() : parked + ' changes'}`, act: 'details' };
  if (setupPending > 0 || setupPushTimer != null || setupBisecting) return { tone: 'saving', text: 'Saving…', act: '' };
  return { tone: 'saved', text: 'Saved', act: '' };
}

// ── 3. Restore points and Backups v3 (§7.2, §7.4) ────────────────────
// A restore point is a SHARED, durable copy of the week: <root>/restoreBody/<rid> holds
// ONE JSON string (so RTDB can neither prune nor array-coerce it) and
// <root>/restoreIndex/<rid> the list row. Both are written in ONE multi-path update at the
// camp root, never listened to (an editor's `once()` when the screen opens), and any
// editor can restore from one. The body EXCLUDES campers, members, chat, presence, push
// data and photos. The rules (published, Step 11) make `archive`, `pre-wizard` and every
// pinned point undeletable by anyone, and `archive` / `pre-wizard` creatable only by the
// owner; the client says so first.
//   body  { app, camp, at, epoch, appVersion, config, setup (minus the owner-only meta and
//           the stamps), sectionsOn, state: { teams, results, … , picSetup (modes only) } }
// `sectionsOn` is one field beyond the spec's body: the rule "a section that wasn't on in
// the point isn't offered" needs to know, and `meta/on` is deliberately not in the body.
const RP_APP = 'campScoreboardV3';
const RP_KINDS = ['auto', 'manual', 'pre-seed', 'pre-delete', 'pre-import', 'pre-restore', 'pre-wizard', 'archive'];
const RP_OWNER_KINDS = ['archive', 'pre-wizard'];
const RP_BODY_MAX = 900000;               // the rules' limit on a body string, in characters
const RP_WAIT_MS = 4000;                  // a point that can't be written in this long goes to the outbox
const RP_AUTO_MIN_MS = 5 * 60 * 1000;     // one automatic point per device per 5 minutes (pre-* kinds are exempt)
const RP_AUTO_IDLE_MS = 20 * 60 * 1000;   // the first setup commit after 20 minutes without a point on this device
const RP_KEEP_AUTO = 40;                  // newest unpinned auto / pre-* points kept (pre-wizard and archives never count)
const RP_KEEP_MANUAL = 20;                // unpinned manual points kept (the UI asks to delete one first)
const RP_OUTBOX_KEY = 'campSetupRpOutbox';
const RP_OUTBOX_MAX = 3;
const RP_ID_RE = /^rp-[a-z0-9-]{4,48}$/;
const RP_SECTIONS = ['schedule', 'games', 'teams', 'notice', 'scores']; // the sheet's checkboxes (data-rp-section)
const RP_STATE_KEYS = ['teams', 'results', 'brackets', 'brackets4', 'drafts', 'picRounds', 'bonuses', 'live', 'clocks', 'announcements', 'notice', 'meta'];
const RP_SCORE_KEYS = ['results', 'brackets', 'brackets4', 'drafts', 'picRounds', 'bonuses', 'live', 'clocks'];
const RP_SETUP_KEYS = { schedule: ['days', 'typical', 'patches', 'dayBlocks'], meals: ['meals'], verses: ['verses'], cleanup: ['cleanup'], electives: ['electives'] };
let rpWaitMs = RP_WAIT_MS;                // (a test shortens it)
let rpLastAt = 0;                         // when this device last wrote any point
let rpLastAutoAt = 0;
let rpFlushing = false;

function restoreRootRef() {
  return firebase.database().ref(CAMP.dbRoot);
}

function restoreHasFirebase() {
  return typeof firebase !== 'undefined' && !!firebase.database && !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);
}

function restoreOnline() {
  return restoreHasFirebase() && fbConnKnown && fbConnected;
}

function restoreNewId() {
  return 'rp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

// The year archive's id: rp-archive-<outgoing epoch>-<4 random> (or rp-archive-pre-<YYYYMMDD>-… for the
// first wizard run, when the legacy epoch has none). The random tail means a retried or re-taken step
// never collides with its own earlier write.
function restoreArchiveId(epoch, date) {
  const stem = epoch ? String(epoch).toLowerCase().replace(/[^a-z0-9-]/g, '') : 'pre-' + String(date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  return ('rp-archive-' + stem).slice(0, 43) + '-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

// What the week is, as of now. EXCLUDES campers, members, chat, presence, push, photos.
function restoreBodyObject() {
  const setup = setupCanon(setupTree);
  if (setup.meta) {
    SETUP_OWNER_META.concat(['edited']).forEach((k) => { delete setup.meta[k]; });
    if (!Object.keys(setup.meta).length) delete setup.meta;
  }
  const st = {};
  RP_STATE_KEYS.forEach((k) => { if (state[k] !== undefined && state[k] !== null) st[k] = setupClone(state[k]); });
  if (state.picSetup) st.picSetup = setupClone(picSetupForSync(state.picSetup)); // the modes only — never the words
  return {
    app: RP_APP,
    camp: CAMP.id,
    at: new Date().toISOString(),
    epoch: (state.meta && state.meta.epoch) || '',
    appVersion: APP_VERSION,
    config: setupClone(configForSync(state.config)),
    setup,
    sectionsOn: SETUP_SECTIONS.filter(setupOn),
    state: st,
  };
}

// The content fingerprint, EXCLUDING `at` and `appVersion` (two points of the same data hash the same).
function restoreHash(body) {
  return fnv1a(JSON.stringify(Object.assign({}, body, { at: undefined, appVersion: undefined })));
}

// A point read back from the database is whatever any editor's device wrote: type-check it before it
// can reach a render or a write.
function restoreParseBody(str) {
  if (typeof str !== 'string' || !str) return { ok: false, reason: 'missing' };
  let body;
  try { body = JSON.parse(str); } catch (e) { return { ok: false, reason: 'unreadable' }; }
  if (!setupIsMap(body) || body.app !== RP_APP) return { ok: false, reason: 'unreadable' };
  if (body.camp !== CAMP.id) return { ok: false, reason: 'other-camp', camp: body.camp }; // never another camp's point
  // The catalog must be what the restore reads it as: arrays (the legacy import refuses anything else).
  // A hand-edited file whose `games` is a string would otherwise preview as "N games" and, ticked,
  // replace the catalog with an empty one.
  if (!setupIsMap(body.config) || !Array.isArray(body.config.games) || !Array.isArray(body.config.days)) return { ok: false, reason: 'unreadable' };
  body.setup = setupIsMap(body.setup) ? body.setup : {};
  body.state = setupIsMap(body.state) ? body.state : {};
  body.sectionsOn = Array.isArray(body.sectionsOn) ? body.sectionsOn.filter((s) => SETUP_SECTIONS.indexOf(s) !== -1) : [];
  body.epoch = typeof body.epoch === 'string' ? body.epoch : '';
  return { ok: true, body };
}

// ── the list ─────────────────────────────────────────────────────────

function restoreCleanRow(rid, v) {
  if (!RP_ID_RE.test(rid) || !setupIsMap(v) || RP_KINDS.indexOf(v.kind) === -1) return null;
  return {
    rid,
    at: Number(v.at) || 0,
    byKey: typeof v.byKey === 'string' ? v.byKey.slice(0, 200) : '',
    kind: v.kind,
    label: typeof v.label === 'string' ? v.label.slice(0, 120) : '',
    note: typeof v.note === 'string' ? v.note.slice(0, 200) : '',
    bytes: Number(v.bytes) || 0,
    hash: typeof v.hash === 'string' ? v.hash : '',
    epoch: typeof v.epoch === 'string' ? v.epoch.slice(0, 40) : '',
    pinned: v.pinned === true,
  };
}

// Newest first. `once()`, never a listener: nothing holds this node open.
async function restoreList() {
  const snap = await restoreRootRef().child('restoreIndex').once('value');
  const v = snap.val();
  const rows = [];
  if (setupIsMap(v)) Object.keys(v).forEach((rid) => { const r = restoreCleanRow(rid, v[rid]); if (r) rows.push(r); });
  return rows.sort((a, b) => (b.at - a.at) || (a.rid < b.rid ? 1 : a.rid > b.rid ? -1 : 0));
}

// May the app delete this point? The rules say no to archives, pre-wizard points and every pinned one.
function restoreDeletable(row) {
  return !!row && !row.pinned && RP_OWNER_KINDS.indexOf(row.kind) === -1;
}

// Retention (§7.2): the newest 40 unpinned auto / pre-* points stay (never pre-wizard, never an archive,
// never a pinned one); unpinned manual points are capped at 20, and the UI asks to delete one FIRST.
function restoreRetentionPlan(rows) {
  const newestFirst = rows.slice().sort((a, b) => (b.at - a.at) || (a.rid < b.rid ? 1 : -1));
  const auto = newestFirst.filter((r) => !r.pinned && (r.kind === 'auto' || (r.kind.indexOf('pre-') === 0 && r.kind !== 'pre-wizard')));
  const manual = newestFirst.filter((r) => !r.pinned && r.kind === 'manual');
  return { toDelete: auto.slice(RP_KEEP_AUTO).map((r) => r.rid), manualCount: manual.length, manualFull: manual.length >= RP_KEEP_MANUAL };
}

// The creating device deletes the oldest beyond the limit: body + index in ONE update.
async function restoreRetain() {
  const plan = restoreRetentionPlan(await restoreList());
  if (!plan.toDelete.length) return plan;
  const gone = {};
  plan.toDelete.forEach((rid) => { gone['restoreIndex/' + rid] = null; gone['restoreBody/' + rid] = null; });
  await restoreRootRef().update(gone);
  return plan;
}

async function restoreDelete(rid) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  const row = (await restoreList()).find((r) => r.rid === rid);
  if (!row) return { ok: false, reason: 'missing' };
  if (!restoreDeletable(row)) return { ok: false, reason: 'kept' }; // "Kept points can't be deleted from the app"
  await restoreRootRef().update({ ['restoreIndex/' + rid]: null, ['restoreBody/' + rid]: null });
  return { ok: true };
}

// "Name and keep": pinned is WRITE-ONCE (the rules refuse unpinning), and it can't change a point's label.
async function restorePin(rid) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  if (!RP_ID_RE.test(rid)) return { ok: false, reason: 'id' };
  await restoreRootRef().child('restoreIndex/' + rid + '/pinned').set(true);
  return { ok: true };
}

async function restoreRead(rid) {
  if (!RP_ID_RE.test(rid)) return { ok: false, reason: 'id' };
  const snap = await restoreRootRef().child('restoreBody/' + rid).once('value');
  return restoreParseBody(snap.val());
}

// Read-back verification (the wizard's archive): the body is there, parses, and matches what the index
// row says — its length and its hash.
async function restoreVerify(rid) {
  const [rowSnap, bodySnap] = await Promise.all([
    restoreRootRef().child('restoreIndex/' + rid).once('value'),
    restoreRootRef().child('restoreBody/' + rid).once('value'),
  ]);
  const row = restoreCleanRow(rid, rowSnap.val());
  const str = bodySnap.val();
  if (!row || typeof str !== 'string') return { ok: false, reason: 'missing' };
  const parsed = restoreParseBody(str);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (row.bytes !== str.length || row.hash !== restoreHash(parsed.body)) return { ok: false, reason: 'mismatch' };
  return { ok: true, row, body: parsed.body };
}

// ── writing a point ──────────────────────────────────────────────────

function rpOutboxRead() {
  try {
    const a = JSON.parse(localStorage.getItem(lsKey(RP_OUTBOX_KEY)) || '[]');
    return Array.isArray(a) ? a.filter((e) => e && typeof e.rid === 'string' && setupIsMap(e.row) && typeof e.body === 'string') : [];
  } catch (e) { return []; }
}

function rpOutboxWrite(list) {
  try {
    if (list.length) localStorage.setItem(lsKey(RP_OUTBOX_KEY), JSON.stringify(list));
    else localStorage.removeItem(lsKey(RP_OUTBOX_KEY));
  } catch (e) { /* quota: best effort — the SDK's own queue may still deliver it */ }
}

function restoreOutboxCount() {
  return rpOutboxRead().length;
}

function rpOutboxAdd(entry) {
  const list = rpOutboxRead().filter((e) => e.rid !== entry.rid).concat(entry);
  rpOutboxWrite(list.slice(-RP_OUTBOX_MAX)); // newest kept
}

function rpOutboxDrop(rid) {
  const list = rpOutboxRead();
  if (list.some((e) => e.rid === rid)) rpOutboxWrite(list.filter((e) => e.rid !== rid));
}

// Save a point of `kind`. Resolves { ok:true, rid, queued? } or { ok:false, reason } (readonly, owner,
// kind, label, too-big, offline, refused, manual-full). The body is captured SYNCHRONOUSLY, before the
// first await, so an automatic point taken just before an edit holds the pre-edit week. Waiting at
// most 4 s: a point that can't be written in that time goes to the outbox (<= 3, newest kept) and is
// uploaded on reconnect, and the action goes ahead (local undo covers it) — except where
// `opts.requireOnline` (the wizard, a restore, Edit the week here the first time, "Start this section
// again": nothing may proceed without the point).
//   opts: body (a pre-built one), id, note, pinned, requireOnline, skipCap
async function restoreSave(kind, label, opts) {
  const o = opts || {};
  const refuse = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  if (RP_KINDS.indexOf(kind) === -1) return refuse('kind');
  if (RP_OWNER_KINDS.indexOf(kind) !== -1 && !isOwner()) return refuse('owner', { message: ownerGate('do that').reason });
  if (!canEdit()) return refuse('readonly');
  const text = String(label || '').trim().slice(0, 120);
  if (!text) return refuse('label');
  const body = o.body || restoreBodyObject();
  const str = JSON.stringify(body);
  if (str.length > RP_BODY_MAX) return refuse('too-big');
  const rid = o.id || restoreNewId();
  const key = identityKey(authUser);
  if (!RP_ID_RE.test(rid)) return refuse('id');
  if (!restoreHasFirebase() || !key) return refuse('offline'); // a device with no sync has nowhere to keep one
  const row = { kind, label: text, bytes: str.length, hash: restoreHash(body) };
  if (o.note) row.note = String(o.note).slice(0, 200);
  if (body.epoch) row.epoch = String(body.epoch).slice(0, 40);
  if (o.pinned) row.pinned = true;
  if (kind === 'manual' && !o.skipCap && restoreOnline()) {
    try { if (restoreRetentionPlan(await restoreList()).manualFull) return refuse('manual-full'); } catch (e) { /* can't tell: let the write decide */ }
  }
  if (o.requireOnline && !restoreOnline()) return refuse('offline');
  // This device now has a point in flight: a second automatic one must not follow it (an import's pre-import
  // point and the setup commit that comes right after it). Given back if the write comes to nothing.
  const prevAt = rpLastAt;
  rpLastAt = Date.now();
  let write;
  try {
    write = restoreRootRef().update({
      ['restoreIndex/' + rid]: Object.assign({ at: firebase.database.ServerValue.TIMESTAMP, byKey: key }, row),
      ['restoreBody/' + rid]: str,
    });
  } catch (e) { rpLastAt = prevAt; return refuse('refused'); }
  const result = await Promise.race([
    write.then(() => 'ok', (e) => ({ error: e })),
    new Promise((resolve) => setTimeout(() => resolve('slow'), rpWaitMs)),
  ]);
  if (result === 'ok') {
    rpLastAt = Date.now();
    if (kind === 'auto') rpLastAutoAt = rpLastAt;
    if (kind !== 'manual' && kind !== 'archive') restoreRetain().catch(() => {}); // the creating device trims the oldest
    return { ok: true, rid, kind };
  }
  if (result === 'slow') {
    if (o.requireOnline) { rpLastAt = prevAt; return refuse('offline'); }
    rpOutboxAdd({ rid, row, body: str });
    write.then(() => { rpOutboxDrop(rid); }, () => {});
    return { ok: true, rid, kind, queued: true };
  }
  rpLastAt = prevAt;
  return refuse('refused', { code: result.error && result.error.code });
}

// A point that was waiting for a connection: send it now, once. Idempotent — a rid that already exists
// on the server (the SDK's own queue delivered it) is just dropped from the outbox.
async function restoreFlushOutbox() {
  if (rpFlushing || !canEdit() || !restoreOnline()) return;
  const list = rpOutboxRead();
  const key = identityKey(authUser);
  if (!list.length || !key) return;
  rpFlushing = true;
  try {
    for (const e of list) {
      try {
        const there = (await restoreRootRef().child('restoreIndex/' + e.rid).once('value')).exists();
        if (!there) {
          await restoreRootRef().update({
            ['restoreIndex/' + e.rid]: Object.assign({ at: firebase.database.ServerValue.TIMESTAMP, byKey: key }, e.row),
            ['restoreBody/' + e.rid]: e.body,
          });
        }
        rpOutboxDrop(e.rid);
      } catch (err) {
        if (err && err.code === 'PERMISSION_DENIED') rpOutboxDrop(e.rid); // refused for good (e.g. an owner-only kind): don't retry forever
        else break; // the connection dropped again: the rest wait
      }
    }
  } finally { rpFlushing = false; }
}

// A point taken automatically before the first setup commit after 20 idle minutes ("Before Jenn's
// edits, 3:05 PM"), throttled to one per 5 minutes per device. Fire-and-forget: the edit goes ahead.
// Called by commitSetup before it applies anything.
function restoreAutoForEdit() {
  const now = Date.now();
  if (now - rpLastAt < RP_AUTO_IDLE_MS || now - rpLastAutoAt < RP_AUTO_MIN_MS) return;
  if (!restoreOnline() || !setupRef || !setupReady) return;
  let when = '';
  try { when = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(now)); } catch (e) { when = ''; }
  const first = typeof memberName === 'string' && memberName.trim() ? memberName.trim().split(/\s+/)[0] : 'a director';
  rpLastAutoAt = now; // claim the slot now: the write is async
  restoreSave('auto', 'Before ' + first + '’s edits' + (when ? ', ' + when : '')).catch(() => {});
}

// Any other automatic point (pre-seed, pre-delete, pre-import…), exempt from the 5-minute throttle.
function restoreAuto(kind, label, opts) {
  return restoreSave(kind, label, opts).catch(() => ({ ok: false, reason: 'refused' }));
}

// ── what a restore would change ──────────────────────────────────────

function restoreYearOf(body) {
  const y = body && typeof body.at === 'string' ? body.at.slice(0, 4) : '';
  return /^20\d\d$/.test(y) ? y : 'earlier';
}

// The current setup, minus what a restore never touches (the owner-only meta and the stamps).
function restoreSetupNow() {
  const cur = setupCanon(setupTree);
  if (cur.meta) {
    SETUP_OWNER_META.forEach((k) => { delete cur.meta[k]; });
    if (!Object.keys(cur.meta).length) delete cur.meta;
  }
  return cur;
}

// The setup tree a restore of `body` would leave: each offered section replaced by the point's (absent in
// the point = empty then), the week's own fields put back when the point has them. Never `meta/on`,
// `epoch`, `epochAt`, `wizard`, `seeded` or `edited`. A section is offered only if it was on in the point
// AND is on now (a restore must not write into the built-in copy, and must not leave a section on the
// data it was off for).
function restoreSetupTarget(body) {
  const cur = restoreSetupNow();
  const target = setupClone(cur);
  const pointOn = body.sectionsOn || [];
  const offered = SETUP_SECTIONS.filter((s) => pointOn.indexOf(s) !== -1 && setupOn(s));
  offered.forEach((s) => {
    RP_SETUP_KEYS[s].forEach((k) => {
      if (body.setup[k] !== undefined) target[k] = setupClone(body.setup[k]); else delete target[k];
    });
  });
  const week = body.setup.meta && setupIsMap(body.setup.meta) ? body.setup.meta : {};
  const weekFields = SETUP_WEEK_META.filter((f) => week[f] !== undefined);
  weekFields.forEach((f) => { target.meta = target.meta || {}; target.meta[f] = setupClone(week[f]); });
  return { cur, target: setupCanon(target), offered, weekFields };
}

// The target with the owner-only meta (on, epoch, epochAt, wizard, seeded) put back from the CURRENT tree:
// a restore replaces the sections, and carries those through untouched (it never writes them).
function restoreMergedSetup(curFull, target) {
  const out = setupClone(target);
  const keep = {};
  SETUP_OWNER_META.forEach((k) => { if (curFull.meta && curFull.meta[k] !== undefined) keep[k] = curFull.meta[k]; });
  if (Object.keys(keep).length || out.meta) out.meta = Object.assign({}, out.meta, keep);
  return out;
}

// Words for a set of setup ops: "Tuesday's schedule (4 items) · menus · verses".
function restoreSummarizeSetup(ops) {
  const days = {};
  const other = [];
  Object.keys(ops).forEach((p) => {
    const parts = p.split('/');
    if (parts[0] === 'dayBlocks' || parts[0] === 'patches') { const d = parts[1]; days[d] = (days[d] || 0) + 1; return; }
    if (parts[0] === 'typical') { days.typical = (days.typical || 0) + 1; return; }
    if (parts[0] === 'days') { days[parts[1]] = (days[parts[1]] || 0) + 1; return; }
    const word = { meals: 'menus', verses: 'verses', cleanup: 'cleanup rota', electives: 'electives', meta: 'week dates' }[parts[0]];
    if (word && other.indexOf(word) === -1) other.push(word);
  });
  const out = Object.keys(days).map((d) => (d === 'typical' ? 'the typical day' : (SETUP_DAY_WORDS[d] || d) + '’s schedule') + ' (' + days[d] + ' item' + (days[d] === 1 ? '' : 's') + ')');
  return out.concat(other).join(' · ');
}

// A game that isn't in the point must STILL survive a Games restore if anything is recorded under it
// (a result, a bracket of either kind, a draft, a live match, a clock): Games without Scores never costs
// a result (sync-F8). Returns the merged config and the kept games.
function restoreGameHasRecords(gid) {
  return ['results', 'brackets', 'brackets4', 'drafts', 'live', 'clocks'].some((k) => state[k] && state[k][gid]);
}

function restoreMergeGames(pointConfig) {
  const merged = setupClone(pointConfig);
  merged.games = cfgList(merged.games);
  merged.days = cfgList(merged.days);
  const cur = state.config || {};
  const pointIds = new Set(merged.games.map((g) => g && g.id));
  const kept = cfgList(cur.games).filter((g) => g && !pointIds.has(g.id) && restoreGameHasRecords(g.id));
  merged.games = merged.games.concat(setupClone(kept));
  const dayIds = new Set(merged.days.map((d) => d && d.id));
  kept.forEach((g) => { // a kept game stays visible: its day comes along when the point has no such day
    if (g.dayId && !dayIds.has(g.dayId)) {
      const d = cfgList(cur.days).find((x) => x && x.id === g.dayId);
      if (d) { merged.days.push(setupClone(d)); dayIds.add(d.id); }
    }
  });
  return { config: merged, kept };
}

function restoreTeamsFit(pointTeams) {
  if (!rosterIsWhole(pointTeams)) return false;
  const have = (state.teams || []).map((t) => t.id).sort().join(',');
  return pointTeams.map((t) => t.id).sort().join(',') === have && new Set(pointTeams.map((t) => t.id)).size === pointTeams.length;
}

// What ticking each box would do, computed locally against what is current — so the sheet can say
// "Tuesday's schedule (4 items) · 2 games · team names" before anything is written. Pure: it reads state.
function restorePreview(body) {
  const out = { sections: {}, kept: [], notOffered: [], epochNote: '' };
  if ((body.epoch || '') !== ((state.meta && state.meta.epoch) || '')) out.epochNote = 'This is from the ' + restoreYearOf(body) + ' week, not this one.';
  // Schedule and week
  const t = restoreSetupTarget(body);
  const ops = setupTreeDiff(t.cur, t.target);
  out.sections.schedule = { offered: t.offered.length > 0 || t.weekFields.length > 0, count: Object.keys(ops).length, summary: restoreSummarizeSetup(ops) };
  SETUP_SECTIONS.forEach((s) => {
    const was = (body.sectionsOn || []).indexOf(s) !== -1;
    const is = setupOn(s);
    if (is && !was) out.notOffered.push({ section: s, reason: 'point-off', text: 'This point is from before this section was edited here. Going back to the original week is the owner’s switch.' });
    else if (was && !is) out.notOffered.push({ section: s, reason: 'now-off', text: 'This section is showing the original week right now, so there is nothing to put back.' });
  });
  // Games
  const g = restoreMergeGames(body.config);
  const gops = treeDiff(cfgCanon(state.config), cfgCanon(g.config), CFG_DEPTHS);
  const gids = {};
  Object.keys(gops).filter((p) => !cfgIsOrderPath(p)).forEach((p) => { gids[p.split('/').slice(0, 2).join('/')] = true; });
  const gcount = Object.keys(gids).length;
  out.sections.games = { offered: true, count: gcount, summary: gcount ? gcount + ' game' + (gcount === 1 ? '' : 's') + ' or day' + (gcount === 1 ? '' : 's') : '' };
  out.kept = g.kept.map((k) => ({ id: k.id, name: k.name || k.id, why: typeof gameRecordLabels === 'function' ? gameRecordLabels(k.id).join(' and ') : 'scores' }));
  // Teams
  const pt = body.state.teams;
  const fits = restoreTeamsFit(pt);
  const tops = fits ? treeDiff(teamsCanon(state.teams), teamsCanon(pt), TEAMS_DEPTHS) : {};
  const tids = {};
  Object.keys(tops).forEach((p) => { tids[p.split('/')[1]] = true; });
  out.sections.teams = { offered: fits, count: Object.keys(tids).length, summary: Object.keys(tids).length ? 'team names' : '', reason: fits ? '' : 'differ' };
  // Notice (and announcements)
  const noticeNow = JSON.stringify(syncCanon({ n: state.notice, a: state.announcements }) || {});
  const noticePt = JSON.stringify(syncCanon({ n: body.state.notice, a: body.state.announcements }) || {});
  out.sections.notice = { offered: body.state.notice !== undefined || body.state.announcements !== undefined, count: noticeNow === noticePt ? 0 : 1, summary: noticeNow === noticePt ? '' : 'the notice board' };
  // Scores: left alone unless this is ticked (decision Q23), then hold-to-confirm
  let sc = 0;
  RP_SCORE_KEYS.filter((k) => SYNC_KEYS.indexOf(k) !== -1).forEach((k) => {
    const cur = state[k] && typeof state[k] === 'object' ? state[k] : {};
    const pv = setupIsMap(body.state[k]) ? body.state[k] : {};
    sc += Object.keys(Object.assign({}, cur, pv)).filter((id) => JSON.stringify(syncCanon(cur[id])) !== JSON.stringify(syncCanon(pv[id]))).length;
  });
  out.sections.scores = { offered: true, count: sc, summary: sc ? sc + ' saved score' + (sc === 1 ? '' : 's') + ' would change' : '', needsHold: true };
  return out;
}

// ── putting a point back ─────────────────────────────────────────────

// Step 0 (sync-F8): the preview and the pre-restore point must come from the SERVER, not a stale local
// copy, and nothing of this phone's may be in flight. Reads state, config and setup with once() and adopts
// them (nothing is unsent, so adopting loses nothing).
async function restorePreflight() {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  if (!restoreOnline()) return { ok: false, reason: 'offline' };
  flushPendingPush();
  const busy = () => pendingWritesTotal() > 0 || hasUnconfirmedLocalWork() || restoreOutboxCount() > 0 || setupBisecting;
  if (busy()) return { ok: false, reason: 'busy' };
  try {
    const [st, cf, su] = await Promise.all([
      fbRef ? fbRef.once('value') : null,
      fbConfigRef ? fbConfigRef.once('value') : null,
      setupRef ? setupRef.once('value') : null,
    ]);
    if (busy()) return { ok: false, reason: 'busy' };
    if (st && st.val()) handleRemoteSnapshot(st.val());
    if (cf && cf.val()) applyRemoteConfig(cf.val());
    if (su) adoptSetup(su.val(), {});
  } catch (e) {
    return { ok: false, reason: 'offline' };
  }
  return { ok: true };
}

// Put `picks` ({schedule, games, teams, notice, scores: bool}) of `body` back, each THROUGH ITS ENGINE as a
// diff, so other sections and other editors' unrelated work are untouched:
//   schedule  one commitSetup with undo:false
//   games     configEdit (the config engine's field ops -> one transaction) — keeping every game that has
//             anything recorded under it; pruneOrphanedGameData runs ONLY when Scores is ticked
//   teams     stateEdit  /  notice, scores   saveState after normalizeSyncedState (today's tryImport path)
// Never writes meta/on, epoch, edited, wizard or seeded. Scores need `opts.confirmed` (the hold-to-
// confirm). `body.camp` must be this camp (restoreParseBody refuses another camp's point).
async function restoreApply(body, picks, opts) {
  const o = opts || {};
  const refuse = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  if (!body || body.camp !== CAMP.id) return refuse('other-camp');
  const want = RP_SECTIONS.filter((s) => picks && picks[s]);
  if (!want.length) return refuse('nothing');
  if (want.indexOf('scores') !== -1 && !o.confirmed) return refuse('confirm');
  const pre = await restorePreflight();
  if (!pre.ok) return refuse(pre.reason);
  if (want.indexOf('games') !== -1 && !configEditable()) return refuse('loading');
  const preview = restorePreview(body); // (after the re-read: it is computed from what the server holds)
  const blocked = want.filter((s) => !preview.sections[s] || !preview.sections[s].offered);
  if (blocked.length) return refuse('not-offered', { sections: blocked });
  // The pre-restore point comes first, online, from what the server holds now.
  const saved = await restoreSave('pre-restore', 'Before putting back “' + String(o.label || 'a restore point').slice(0, 60) + '”', { requireOnline: true });
  if (!saved.ok) return refuse(saved.reason === 'offline' ? 'offline' : 'pre-restore', { detail: saved.reason });
  const applied = [];
  const label = 'Put back ' + String(o.label || 'a restore point');
  if (want.indexOf('schedule') !== -1) {
    const t = restoreSetupTarget(body);
    const r = commitSetup((draft) => { setupReplaceTree(draft, normalizeSetup(restoreMergedSetup(setupCanon(draft), t.target))); }, { label, undo: false });
    if (!r.ok) return refuse('schedule', { detail: r.reason, applied });
    applied.push('schedule');
  }
  if (want.indexOf('games') !== -1) {
    const g = restoreMergeGames(body.config);
    configEdit(label, () => { state.config = g.config; migrateState(state); }, { undo: false });
    applied.push('games');
  }
  if (want.indexOf('teams') !== -1) {
    stateEdit(label, () => { state.teams = setupClone(body.state.teams); }, { undo: false });
    applied.push('teams');
  }
  if (want.indexOf('notice') !== -1) {
    if (setupIsMap(body.state.notice)) { state.notice = setupClone(body.state.notice); normalizeNotice(); }
    if (setupIsMap(body.state.announcements)) state.announcements = setupClone(body.state.announcements);
    applied.push('notice');
  }
  if (want.indexOf('scores') !== -1) {
    RP_SCORE_KEYS.filter((k) => SYNC_KEYS.indexOf(k) !== -1).forEach((k) => { state[k] = setupIsMap(body.state[k]) ? setupClone(body.state[k]) : {}; });
    if (setupIsMap(body.state.picSetup)) { // the modes only: the words on this device are never overwritten
      Object.keys(body.state.picSetup).forEach((gid) => {
        const src = body.state.picSetup[gid] && body.state.picSetup[gid].source;
        if (src === undefined) return;
        state.picSetup = state.picSetup || {};
        state.picSetup[gid] = Object.assign({ words: [] }, state.picSetup[gid], { source: src });
      });
    }
    applied.push('scores');
  }
  if (want.some((s) => s === 'notice' || s === 'scores')) {
    normalizeSyncedState();
    if (want.indexOf('scores') !== -1 && typeof pruneOrphanedGameData === 'function') pruneOrphanedGameData(); // ONLY with Scores ticked
    touchData({ celebrate: false });
    saveState();
  }
  if (typeof refreshBuilderCards === 'function') refreshBuilderCards();
  if (typeof appStarted !== 'undefined' && appStarted) renderAll();
  return { ok: true, applied, kept: preview.kept, pre: saved.rid };
}

// ── Backups v3 (§7.4) ────────────────────────────────────────────────
// backupJSON() is now the restore-point body plus `exportedAt`: it INCLUDES camp, setup, notice, meta,
// clocks and brackets4, and still never campers (or members, chat, photos). tryImport (settings.js)
// accepts v2 as before, refuses another camp's backup unless "copy from the other camp" is ticked
// (then only Schedule, Games and Teams), shape-checks teams, restores announcements (dropped before),
// writes a `pre-import` point first and applies through the engines.

function backupObject() {
  return Object.assign(restoreBodyObject(), { exportedAt: new Date().toISOString() });
}

// The parts of a v3 backup that are not the v2 flat keys: the setup data (only sections that are on here
// AND were on in the backup), the notice board and announcements (not in "copy from the other camp"). Never
// `meta`: it carries the epoch.
function restoreImportExtras(parsed, copyMode) {
  const st = setupIsMap(parsed.state) ? parsed.state : {};
  if (!copyMode) {
    if (setupIsMap(st.notice)) { state.notice = setupClone(st.notice); normalizeNotice(); }
    if (setupIsMap(st.announcements)) state.announcements = setupClone(st.announcements);
  }
  if (setupIsMap(parsed.setup) && setupEditable() && canEdit()) {
    const body = { setup: parsed.setup, sectionsOn: Array.isArray(parsed.sectionsOn) ? parsed.sectionsOn : [], camp: CAMP.id };
    const t = restoreSetupTarget(body);
    if (t.offered.length || t.weekFields.length) {
      commitSetup((draft) => { setupReplaceTree(draft, normalizeSetup(restoreMergedSetup(setupCanon(draft), t.target))); },
        { label: 'Restored a backup', undo: false });
    }
  }
}

// A device back online sends the point that was waiting in the outbox.
onSetupEvent((kind) => { if (kind === 'sync' && fbConnected && rpOutboxRead().length) restoreFlushOutbox().catch(() => {}); });

// ── 4. "Also here" (editorsHere) and the Devices list (§6.7) ─────────
// Which directors have Set up the week open right now, and where in it. A SEPARATE node from
// presence (which stays `{at}` and untouched — the footer chip is unchanged):
//   <root>/editorsHere/<memberKey>/<deviceId> = { at, v, where? }
// editor-read, key-pinned to the writer, `at === now` on every write and a 1 s floor per row, so
// viewers neither write nor receive it and only editor devices hold its listener. `where` is a
// short vocabulary ([a-z0-9:_-]{1,60}, never blank — it is REMOVED, not emptied, on leaving).
// No heartbeat: a ghost row lasts until the server notices the dead socket. Under rules that
// predate it the writes are refused and swallowed (the feature just shows nobody).
//
// DARK (the owner's rule for Step 14: nothing writes unless a director acts): a row exists only
// while this device has Set up the week open — editorsHereStart() when it opens, ...Move() on every
// screen or sheet change, ...Stop() when it closes. The spec wanted a row from every editor device
// on every connect (so a Devices row with no match reads "older than this build"); that is one
// switch, EDITORS_HERE_EAGER, for the step that turns the setup screens on. Until then a Devices
// row with no editorsHere row says its build is UNKNOWN, not old.
const EDITORS_HERE_MIN_MS = 1200;          // sits above the rules' 1000 ms floor, so a real person is never refused
const EDITORS_HERE_EAGER = false;          // true = a row on every connect of every editor device (spec §6.7)
const EDITORS_HERE_WHERE_RE = /^[a-z0-9:_-]{1,60}$/;
const DEVICES_FRESH_MS = 10 * 60 * 1000;   // a presence row older than this isn't a device that is here
let ehMinMs = EDITORS_HERE_MIN_MS;         // (a test shortens it)
let ehActive = false;                      // Set up the week is open on this device
let ehRef = null;                          // the editorsHere listener's ref
let ehTree = null;                         // what that listener last said (editor devices only)
let ehWhere = '';                          // where this device is, as last asked
let ehRowLive = false;                     // my row exists (set, not yet removed)
let ehLastWriteAt = 0;
let ehTimer = null;                        // the trailing write that honours the floor
let ehRetried = false;                     // one retry per run of refusals (see ehRefused)

function ehMyKey() {
  return identityKey(authUser);
}

function ehMayWrite() {
  // memberRoleConfirmed: a HINTED editor (a stale hint on a demoted director's phone) paints the shell
  // before the member record answers; nothing attaches or writes on that guess (the Step 3 rule —
  // editorsHereOnConnect runs after approval and starts everything that was waiting).
  return canEdit() && memberRoleConfirmed && restoreHasFirebase() && !!ehMyKey() && typeof presenceId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(presenceId);
}

function ehRowRef() {
  return firebase.database().ref(dbPath('editorsHere/' + ehMyKey() + '/' + presenceId));
}

// Is `where` something the rules would take? ('' = nowhere in particular.)
function editorsHereWhereOk(where) {
  return where === '' || EDITORS_HERE_WHERE_RE.test(where);
}

// ── writing my row ───────────────────────────────────────────────────

function ehWriteNow() {
  clearTimeout(ehTimer);
  ehTimer = null;
  if (!ehMayWrite() || !(ehActive || EDITORS_HERE_EAGER)) return;
  const TS = firebase.database.ServerValue.TIMESTAMP;
  ehLastWriteAt = Date.now();
  const ok = () => { ehRetried = false; };
  try {
    const ref = ehRowRef();
    if (!ehRowLive) {
      // The first write of a connection: the row, and its removal when the socket drops. onDisconnect
      // doesn't survive a dropped socket, so every (re)connect comes through here again.
      if (typeof ref.onDisconnect === 'function') ref.onDisconnect().remove().catch(() => {});
      const row = { at: TS, v: APP_VERSION };
      if (ehWhere) row.where = ehWhere;
      ehRowLive = true;
      ref.set(row).then(ok, () => { ehRowLive = false; ehRefused(); }); // a refused create is no row: the retry creates it
    } else {
      ref.update({ at: TS, where: ehWhere || null }).then(ok, ehRefused); // `where` removed, never blank
    }
  } catch (e) { /* the feature just shows nobody */ }
}

// The floor above is measured between this device's SEND times, but the rules compare the SERVER's
// stamps: uneven latency (0.8 s on one write, 0.1 s on the next) can land two under a second apart
// and the second is refused. One retry a beat later, carrying the LATEST place; a second refusal in a
// row (rules that predate the feature) is swallowed for good — the feature just shows nobody.
function ehRefused() {
  if (ehRetried || !(ehActive || EDITORS_HERE_EAGER)) return;
  ehRetried = true;
  clearTimeout(ehTimer);
  ehTimer = setTimeout(ehWriteNow, ehMinMs + 300);
}

// At most one write per row per EDITORS_HERE_MIN_MS: a quick run of screen changes is coalesced
// into one trailing write carrying the LAST place, never a refusal.
function ehSchedule() {
  if (!ehMayWrite() || !(ehActive || EDITORS_HERE_EAGER)) return;
  const wait = ehLastWriteAt + ehMinMs - Date.now();
  if (wait <= 0) { ehWriteNow(); return; }
  if (!ehTimer) ehTimer = setTimeout(ehWriteNow, wait);
}

// Set up the week was opened on this device (the hub, `where` = 'hub'). Director devices only.
function editorsHereStart(where) {
  if (!canEdit()) return false; // a viewer or a view-only tab neither writes nor listens
  ehActive = true;
  ehRetried = false;
  ehWhere = editorsHereWhereOk(where || '') ? (where || '') : '';
  attachEditorsHere();
  ehSchedule();
  setupNotify('here');
  return true;
}

// A screen or sheet changed inside the builder.
function editorsHereMove(where) {
  if (!ehActive && !EDITORS_HERE_EAGER) return false;
  const w = where || '';
  if (!editorsHereWhereOk(w)) return false;
  if (w === ehWhere && ehRowLive) return true;
  ehWhere = w;
  ehSchedule();
  return true;
}

// The builder closed (or this device stopped being a director): the row goes, and so does the listener.
// (Eager mode keeps the row for the whole connection and only removes `where`.)
function editorsHereStop() {
  const wasActive = ehActive;
  ehActive = false;
  ehWhere = '';
  clearTimeout(ehTimer);
  ehTimer = null;
  if (EDITORS_HERE_EAGER && ehRowLive && ehMayWrite()) { ehSchedule(); return; }
  if (ehRowLive && restoreHasFirebase() && ehMyKey()) {
    try { ehRowRef().remove().catch(() => {}); } catch (e) { /* ignore */ }
  }
  ehRowLive = false;
  detachEditorsHere();
  if (wasActive) setupNotify('here');
}

// Every (re)connect: the row and its onDisconnect handler need registering afresh. Called from
// app.js's .info/connected handler beside registerPresence(); nothing happens unless the builder is open.
function editorsHereOnConnect() {
  ehRowLive = false;
  if (!ehActive && !EDITORS_HERE_EAGER) return;
  // Not only eager mode: a reload (or the auto-reload on a deploy) with Set up the week open starts
  // the builder at the first render, BEFORE sign-in resolves — editorsHereStart found no identity and
  // attached nothing, so this, after approval, is the listener's first chance. (attach checks itself.)
  if (canEdit()) attachEditorsHere();
  ehSchedule();
}

// ── listening (editor devices only) ──────────────────────────────────

function attachEditorsHere() {
  if (ehRef || !ehMayWrite()) return;
  try {
    ehRef = firebase.database().ref(dbPath('editorsHere'));
    ehRef.on('value', (snap) => {
      ehTree = snap.val();
      setupNotify('here');
    }, () => {
      // Refused (rules that predate it, or access changed): this feature only. Never fbRef/syncDenied.
      ehTree = null;
      ehRef = null;
      setupNotify('here');
    });
  } catch (e) { ehRef = null; }
}

function detachEditorsHere() {
  if (ehRef) { try { ehRef.off('value'); } catch (e) { /* ignore */ } }
  ehRef = null;
  ehTree = null;
}

// A demotion or removal: the row goes and the listener with it (setupOnRoleChange, from setMemberRole).
function editorsHereOnRoleChange(prev, next) {
  if (prev === 'editor' && next !== 'editor') {
    ehActive = false;
    clearTimeout(ehTimer);
    ehTimer = null;
    if (ehRowLive && restoreHasFirebase() && ehMyKey()) { try { ehRowRef().remove().catch(() => {}); } catch (e) { /* ignore */ } }
    ehRowLive = false;
    ehWhere = '';
    detachEditorsHere();
  }
}

// ── reading ──────────────────────────────────────────────────────────

// A director's name for display: the member directory's (editor-maintained), failing CLOSED to
// "Another director" like chatAuthorName — never anything the writing device claimed. Only keys whose
// directory role is editor are shown at all, once the directory has arrived.
function ehEditorKeyShown(key) {
  if (!memberDirectoryLoaded || !memberDirectory) return true; // can't tell yet: the node is editor-read, so its writers were editors
  const rec = Object.prototype.hasOwnProperty.call(memberDirectory, key) ? memberDirectory[key] : null;
  return !!rec && rec.role === 'editor';
}

// Words for a `where`: "Tuesday's schedule", "this item", "Rain bowling".
function editorsHereWhereWords(where) {
  const parts = String(where || '').split(':');
  const day = (dk) => SETUP_DAY_WORDS[dk] || dk;
  switch (parts[0]) {
    case 'hub': return 'the checklist';
    case 'week': return 'the camp week';
    case 'schedule': return parts[1] === 'typical' ? 'the typical day' : parts[1] ? day(parts[1]) + '’s schedule' : 'the schedule';
    case 'item': return 'an item on ' + (day(parts[1]) || 'the schedule');
    case 'rain': return day(parts[1]) + '’s rain plan';
    case 'games': return 'the games';
    case 'game': {
      const g = typeof allGames === 'function' ? allGames().find((x) => x.id === parts[1]) : null;
      return g ? g.name : 'a game';
    }
    case 'teams': return 'the teams';
    case 'team': return typeof teamName === 'function' ? teamName(parts[1]) : 'a team';
    case 'people': return 'the people list';
    case 'campers': return 'the campers';
    case 'meals': return 'the menus';
    case 'verses': return 'the memory verses';
    case 'cleanup': return 'the cleanup rota';
    case 'electives': return 'the electives';
    case 'wizard': return 'the new-year setup';
    case 'restore': return 'the restore points';
    default: return 'the setup';
  }
}

function ehAgo(at) {
  const ms = serverNow() - Number(at || 0);
  if (!(ms > 0)) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  return Math.floor(m / 60) + ' h ago';
}

// Everybody else who has Set up the week open, newest first. This device's own row is skipped;
// another device of the same director is "You (another device)".
function editorsHereList() {
  const out = [];
  if (!canEdit() || !setupIsMap(ehTree)) return out;
  const me = ehMyKey();
  Object.keys(ehTree).forEach((key) => {
    const devices = ehTree[key];
    if (!setupIsMap(devices) || !ehEditorKeyShown(key)) return;
    Object.keys(devices).forEach((device) => {
      const r = devices[device];
      if (!setupIsMap(r) || typeof r.at !== 'number') return;
      if (key === me && device === presenceId) return;
      const where = typeof r.where === 'string' && editorsHereWhereOk(r.where) ? r.where : '';
      out.push({
        key, device, at: r.at, v: typeof r.v === 'number' ? r.v : null, where,
        mine: key === me, name: key === me ? 'You (another device)' : setupEditorName(key),
        words: where ? editorsHereWhereWords(where) : 'the setup', ago: ehAgo(r.at),
      });
    });
  });
  return out.sort((a, b) => b.at - a.at);
}

// The header: up to three initials, or the phone's "Jenn is also here" (tap → "Jenn · Tuesday's schedule · 2 min ago").
function editorsHereHeader() {
  const rows = editorsHereList();
  const names = [...new Set(rows.map((r) => r.name))];
  const faces = names.slice(0, 3).map((n) => (n === 'You (another device)' ? 'Y' : n === 'Another director' ? 'D' : n.charAt(0).toUpperCase()));
  let text = '';
  if (names.length === 1) text = names[0] === 'You (another device)' ? 'You are also here on another device' : names[0] + ' is also here';
  else if (names.length === 2) text = names[0] + ' and ' + names[1] + ' are also here';
  else if (names.length > 2) text = names[0] + ' and ' + (names.length - 1) + ' others are also here';
  return { count: rows.length, faces, text, rows: rows.map((r) => ({ name: r.name, text: r.name + ' · ' + r.words + ' · ' + r.ago })) };
}

// On a matching screen: "Jenn is also editing Tuesday — changes merge field by field". In a sheet for the same
// item: "Jenn is editing this item too". `where` is this device's own.
function editorsHereOn(where) {
  const same = editorsHereList().filter((r) => r.where === where && r.where !== '');
  if (!same.length) return '';
  const names = [...new Set(same.map((r) => r.name))];
  const who = names.length === 1 ? names[0] : names.length === 2 ? names[0] + ' and ' + names[1] : names[0] + ' and ' + (names.length - 1) + ' others';
  if (/^item:/.test(where)) return who + (names.length === 1 ? ' is' : ' are') + ' editing this item too';
  return who + (names.length === 1 ? ' is' : ' are') + ' also editing ' + editorsHereWhereWords(where) + ' — changes merge field by field';
}

// ── Devices (the hub's ⋯ menu) ───────────────────────────────────────
// Director devices only: presence rows (at within 10 minutes) of members whose directory role is editor, each
// matched to its editorsHere row by DEVICE ID and grouped by build. A hint, never a gate: "2 director devices
// are on an older version — they update when reopened". (Old VIEWER builds don't matter: they never write
// setup or config.)
function devicesList() {
  const out = { rows: [], byBuild: {}, older: 0, unknown: 0, total: 0, lede: 'No other director devices are here right now' };
  if (!canEdit() || !setupIsMap(presenceRows)) return out;
  const me = ehMyKey();
  const now = serverNow();
  Object.keys(presenceRows).forEach((key) => {
    const devices = presenceRows[key];
    if (!setupIsMap(devices) || typeof devices.at === 'number') return; // the old flat shape is ignored, as presenceDeviceCount does
    if (!memberDirectoryLoaded || !memberDirectory || !ehEditorKeyShown(key)) return; // role-less: not a director device as far as this phone can tell
    Object.keys(devices).forEach((device) => {
      const p = devices[device];
      if (!setupIsMap(p) || typeof p.at !== 'number') return;
      if (now - p.at > DEVICES_FRESH_MS) return;
      const here = setupIsMap(ehTree) && setupIsMap(ehTree[key]) && setupIsMap(ehTree[key][device]) ? ehTree[key][device] : null;
      const v = here && typeof here.v === 'number' ? here.v : null;
      // `older` is a claim only when the row's own build is known — or when every editor device writes one (eager).
      const older = v !== null ? v < APP_VERSION : EDITORS_HERE_EAGER;
      out.rows.push({
        key, device, at: p.at, v, older, unknown: v === null && !EDITORS_HERE_EAGER,
        mine: key === me && device === presenceId, name: key === me ? 'You' : setupEditorName(key), ago: ehAgo(p.at),
      });
      const label = v === null ? 'unknown' : String(v);
      out.byBuild[label] = (out.byBuild[label] || 0) + 1;
      if (older) out.older++;
      if (v === null && !EDITORS_HERE_EAGER) out.unknown++;
    });
  });
  out.total = out.rows.length;
  out.rows.sort((a, b) => b.at - a.at);
  out.lede = out.older
    ? out.older + ' director device' + (out.older === 1 ? ' is' : 's are') + ' on an older version — ' + (out.older === 1 ? 'it updates' : 'they update') + ' when reopened'
    : (out.total ? 'Every director device here is up to date' + (out.unknown ? ' as far as we can tell' : '') : 'No other director devices are here right now');
  return out;
}

setupLoadCache();
