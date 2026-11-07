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
//
// And one more, for the four smaller sections (step 19): the first write into a section with nothing in it (senior's menus,
// a cleared rota) is a coarse `meals` / `cleanup` / `verses` / `electives` op carrying the whole container — it would
// overwrite a colleague's first write beside it, and an undo of it would take the colleague's with it. Those are cut to the
// records a later edit would have written (a create stops at the RECORD, never below it: a field op into an absent record
// is dropped by setupApplyOps). An op that DELETES a whole container (the last dish of a day) is cut the same way, to the
// records that went, so a colleague's dish beside it is not taken with it; `was` is the canonical tree before the edit.
const SETUP_RECORD_DEPTH = {
  meals: 3, cleanup: 3,
  verses: (p) => (p[1] === 'days' ? 3 : 2),
  electives: (p) => (p[1] === 'slots' ? (p[5] === 'people' ? 7 : 5) : 3),
};
function setupExpandCreate(path, value, out, was) {
  const parts = path.split('/');
  const d = SETUP_RECORD_DEPTH[parts[0]];
  const depth = typeof d === 'function' ? d(parts) : d;
  if (!depth || parts.length >= depth) { out[path] = value; return; }
  const kids = value === null ? syncValueAt(was, path) : value;
  if (!setupIsMap(kids)) { out[path] = value; return; }
  Object.keys(kids).forEach((k) => setupExpandCreate(path + '/' + k, value === null ? null : kids[k], out, was));
}

function setupTreeDiff(prev, cur) {
  const raw = treeDiff(prev, cur, SETUP_DEPTHS);
  const ops = {};
  const before = syncCanon(prev) || {};
  Object.keys(raw).forEach((p) => setupExpandCreate(p, raw[p], ops, before));
  if (ops.meta === undefined) return ops;
  const whole = ops.meta;
  delete ops.meta;
  if (whole === null) { // meta removed outright: every field that was there, one null each
    const was = before.meta;
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
  // A station is written WHOLE (SETUP_DEPTHS: `electives/stations/<st>` is the leaf, name and emoji together), so it has no
  // field ops to anchor; naming it a record here made an edit of an existing station read as a collision and be dropped
  // ("another director removed this item"). Slots are the records with fields (`…/<st>/ord`, `…/people/<p>`).
  if (parts[0] === 'electives') return parts[1] === 'slots' ? 5 : 0;
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
  setupAdoptNewSnapshot(remote);
}

// A snapshot after the first can carry ANOTHER camp year's epoch than the one this phone last confirmed (the new-year setup
// ran while this phone was open, or Undo the new-year setup put the old year back): its unconfirmed edits are the old year's,
// so they are STRANDED as a download, never applied to the new one (§6.4.4 / §6.11, as the state and config engines do), and
// last year's clashes and undo history go. Otherwise an ordinary adopt (rebasing unsent edits). An empty node is the console
// wipe's business (the caller handles it), not an epoch change.
function setupAdoptNewSnapshot(remote) {
  const remoteCanon = setupCanon(remote || {});
  if (setupBase && Object.keys(remoteCanon).length) {
    const from = epochOfTree(setupBase);
    const to = epochOfTree(remoteCanon);
    if (from !== to) {
      const local = setupCanon(setupTree);
      const mine = directorTab() ? setupTreeDiff(setupBase, local) : {}; // directorTab, not canEdit: a counselor preview must never make a director's phone drop its unconfirmed week
      setupStrand(mine, local, from, to);
      setupForgetLastYear();
      adoptSetup(remote, {});
      return true;
    }
  }
  adoptSetup(remote);
  return false;
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
      const mine = directorTab() ? setupTreeDiff(setupBase, local) : {}; // directorTab, not canEdit: a counselor preview must never make this phone drop its unconfirmed week
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
    if (!directorTab()) { adoptSetup(remote, {}); return; } // a viewer / read-only tab has no edits of its own to keep (a preview is not one)
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
  if (!directorTab()) return false;
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

// When a section was last changed (server ms, or this device's estimate for its own edit), or 0 — the .ics
// file's LAST-MODIFIED and the seed of its SEQUENCE.
function setupEditedAt(section) {
  const e = setupEdited[section];
  return e && typeof e.at === 'number' ? e.at : 0;
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
  if (!setupRef || !setupReady || setupDenied || setupWriteRefused || !directorTab()) return; // work already made goes out in a preview too
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
      if (e && e.code === 'PERMISSION_DENIED' && directorTab()) { startSetupBisect(diff, prev, settle); return; }
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
  if (typeof peopleRequestsOnRoleChange === 'function') peopleRequestsOnRoleChange(prev, next);
  if (typeof campersOnRoleChange === 'function') campersOnRoleChange(prev, next);
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
  if (rpFlushing || !directorTab() || !restoreOnline()) return; // a point already saved waits in the outbox whatever the screen shows
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
  const tops = fits ? treeDiff(teamsCanon(state.teams), teamsCanon(teamsFromBackup(pt)), TEAMS_DEPTHS) : {};
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
    stateEdit(label, () => { state.teams = teamsFromBackup(setupClone(body.state.teams)); }, { undo: false });
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

// ════════════════════════════════════════════════════════════════════
// 5. The schedule as data (setup-rebuild-spec §5.4–5.6, §10 — build step 15 / "S5a")
// ════════════════════════════════════════════════════════════════════
// Four things live here, in this order: the PURE schedule maths (slug, ids, resolveDay,
// renderLabel, legacyBlock — the one function every schedule consumer goes through), the
// SEED (camps.js's printed week → setup data, deterministic), the memoized plans the
// app.js accessors read once a camp's schedule is edited here, and Edit the week here
// (A1) with Put games on the schedule (A2). Nothing below runs at load and nothing in it
// writes until the OWNER presses A1: `meta/on/schedule` is the switch, and while it is
// off every accessor returns the camps.js constant itself.

const SETUP_SEED_SECTIONS = ['schedule'];            // what a plain buildSeed(camp) seeds: the schedule. The other four sections (step 19) are asked for by name
const SETUP_HEAD_SLUG = 24;                          // a block id's slug is cut to this (§5.5): published ids stay <= 40 characters
const SETUP_BLOCK_TYPES = ['activity', 'games', 'elective'];

// ── ids and labels ───────────────────────────────────────────────────

// lowercase, runs of non-alphanumerics -> one '-', cut to `max`, edge dashes trimmed (§5.5).
function setupSlug(s, max) {
  const slug = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  return slug || 'block';
}

// The part of a label that names the BLOCK: text before ' — ' or ' (' (push.js's pushHeadLabel; a test pins the two equal).
function setupHeadLabel(label) {
  const s = String(label == null ? '' : label);
  const cuts = [s.indexOf(' — '), s.indexOf(' (')].filter((i) => i >= 0);
  return (cuts.length ? s.slice(0, Math.min.apply(null, cuts)) : s).trim();
}

// The phone-reminder key of a block: today's, for every seeded block (alertKey = pushBlockKey(label)).
function setupAlertKey(label) {
  return typeof pushBlockKey === 'function' ? pushBlockKey(label) : setupSlug(setupHeadLabel(label), 48);
}

// The SEED's ids: `b-<slug>-<start>` for a typical block, `b-<dk>-<slug>-<start>` for a day's own (a collision inside one
// container gets -2, -3…). Seeding is deterministic so a second run mints the same ids; a block created by hand uses setupMintNewId.
function setupMintId(dk, label, start, taken) {
  const base = 'b-' + (dk ? dk + '-' : '') + setupSlug(setupHeadLabel(label), SETUP_HEAD_SLUG) + '-' + start;
  let id = base;
  for (let n = 2; taken[id]; n++) id = base + '-' + n;
  taken[id] = true;
  return id;
}

// A block CREATED here (an added item, a rain-plan one-off, the items of a copied day) gets `b-` + 8 random base36
// characters (§5.5), never the slug id the seed uses: two directors adding the same-named item at the same minute
// can't mint one id and merge their fields, and the id publishes as `<dk>-<id>` = 14 characters, so no name can push
// it past the 40 the pushSchedule rule allows (a slug id on a long own-day name plus one collision suffix could).
function setupMintNewId(taken) {
  let id;
  do { id = 'b-' + Math.random().toString(36).slice(2, 10).padEnd(8, '0'); } while (taken[id]);
  taken[id] = true;
  return id;
}

function setupTeamSlot(id) {
  const n = Number(String(id).slice(1));
  return Number.isInteger(n) ? n : 99;
}

// {t1:true,…} as ids in slot order (anything that isn't a team id is dropped).
function setupTeamList(teams) {
  const t = setupMapOf(teams);
  return Object.keys(t).filter((id) => /^t[0-9]$/.test(id) && t[id] === true).sort((a, b) => setupTeamSlot(a) - setupTeamSlot(b));
}

// "🦃 Turkey, 🍁 Maples & 🚜 John Deeres": camps.js's joinTeamAbbrevs, with the emoji and short name given.
function setupJoinTeams(ids, emojiOf, shortOf) {
  const items = ids.map((id) => emojiOf(id) + ' ' + shortOf(id));
  if (items.length < 2) return items.join('');
  return items.slice(0, -1).join(', ') + ' & ' + items[items.length - 1];
}

// A block's label as the schedule shows it: a block with `teams` ends with its team tail.
function renderLabel(b) {
  const ids = setupTeamList(b && b.teams);
  return ids.length ? b.label + ' — ' + setupJoinTeams(ids, teamEmoji, teamShort) : b.label;
}

// A block this build can place: whole-minute start/end in range, a non-empty label. A partial record
// (a race between two directors' field writes) is skipped by the readers and listed by the hub.
function validBlock(b) {
  return setupIsMap(b) && Number.isInteger(b.start) && b.start >= 0 && b.start <= 1439
    && Number.isInteger(b.end) && b.end >= 1 && b.end <= 1440 && b.end > b.start
    && typeof b.label === 'string' && b.label.length > 0;
}

// Exactly today's DAY_SCHEDULE entry — same fields, same key order (a rendered label, a sanitized emoji, an
// unknown type read as an activity).
function legacyBlock(b) {
  const o = {
    start: b.start,
    end: b.end,
    label: renderLabel(b),
    emoji: safeEmoji(b.emoji, '🕒'),
    type: SETUP_BLOCK_TYPES.indexOf(b.type) !== -1 ? b.type : 'activity',
  };
  if (b.slot === 0 || b.slot === 1 || b.slot === 2) o.slot = b.slot;
  if (b.noTime === true) o.noTime = true;
  return o;
}

// Does a patch say anything the typical block doesn't? (An equal-to-typical field is not a change, §5.4.)
function setupPatchDiffers(p, t) {
  return Object.keys(setupMapOf(p)).some((k) => k !== 'off' && JSON.stringify(syncCanon(p[k])) !== JSON.stringify(syncCanon(t[k])));
}

// One day of the shared schedule, as rich blocks sorted by (start, ord, id) — a total order, so every device
// agrees on which block Happening Now finds first. `origin`: typical | changed | oneoff | own. `.skipped` lists
// what was cancelled for the day, `.broken` the partial records (§5.6).
function resolveDay(tree, dow) {
  const t = setupIsMap(tree) ? tree : {};
  const dk = SETUP_DK[dow];
  const out = [];
  const skipped = [];
  const broken = [];
  const day = setupMapOf(setupMapOf(t.days)[dk]);
  if (day.typical === true) {
    const typical = setupMapOf(t.typical);
    const patches = setupMapOf(setupMapOf(t.patches)[dk]);
    Object.keys(typical).forEach((id) => {
      if (!setupIsMap(typical[id])) { broken.push({ id, dk }); return; }
      const p = setupMapOf(patches[id]);
      const b = Object.assign({ id, dk, origin: setupPatchDiffers(p, typical[id]) ? 'changed' : 'typical' }, typical[id], p);
      if (!validBlock(b)) { broken.push(b); return; }
      if (b.off === true) { b.origin = 'skipped'; skipped.push(b); return; }
      out.push(b);
    });
  }
  const own = setupMapOf(setupMapOf(t.dayBlocks)[dk]);
  Object.keys(own).forEach((id) => {
    if (!setupIsMap(own[id])) { broken.push({ id, dk }); return; }
    const b = Object.assign({ id, dk, origin: day.typical === true ? 'oneoff' : 'own' }, own[id]);
    if (!validBlock(b)) { broken.push(b); return; }
    if (b.off === true) { b.origin = 'skipped'; skipped.push(b); return; }
    out.push(b);
  });
  out.sort((a, b) => (a.start - b.start) || ((Number(a.ord) || 0) - (Number(b.ord) || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  out.skipped = skipped;
  out.broken = broken;
  return out;
}

// The rich block the accessors hand out (planForDow): everything the schedule screen, the publisher and the
// calendar file need, with the label RENDERED and the stored one kept as `base`.
function setupRichBlock(b) {
  const l = legacyBlock(b);
  const r = { id: b.id, dk: b.dk, origin: b.origin, start: l.start, end: l.end, label: l.label, base: b.label, emoji: l.emoji, type: l.type };
  if (l.slot !== undefined) r.slot = l.slot;
  if (l.noTime) r.noTime = true;
  const teams = setupTeamList(b.teams);
  if (teams.length) r.teams = teams.reduce((o, id) => { o[id] = true; return o; }, {});
  if (b.meal === 'breakfast' || b.meal === 'lunch' || b.meal === 'supper') r.meal = b.meal;
  r.alertKey = typeof b.alertKey === 'string' && /^[a-z0-9-]{1,48}$/.test(b.alertKey) ? b.alertKey : setupAlertKey(l.label);
  if (b.overlapOk === true) r.overlapOk = true;
  r.ord = Number(b.ord) || 0;
  return r;
}

// ── the seed ─────────────────────────────────────────────────────────

// "emoji short" -> team id, for the camp's own teams: how a label's team tail is recognised.
function setupSeedTeamLookup(camp) {
  const out = {};
  Object.keys((camp && camp.teamEmoji) || {}).forEach((id) => { out[camp.teamEmoji[id] + ' ' + camp.teamAbbrev[id]] = id; });
  return out;
}

// A printed label as { label, teams? }: a tail that joinTeams(ids in slot order) reproduces EXACTLY becomes `teams`
// (the junior morning meeting); any other tail stays plain label text.
function setupSeedLabel(label, camp, lookup) {
  const at = String(label).indexOf(' — ');
  if (at < 0) return { label };
  const tail = String(label).slice(at + 3);
  const ids = tail.split(/, | & /).map((item) => lookup[item]);
  if (!ids.length || ids.some((id) => !id) || new Set(ids).size !== ids.length) return { label };
  ids.sort((a, b) => setupTeamSlot(a) - setupTeamSlot(b));
  if (setupJoinTeams(ids, (id) => camp.teamEmoji[id], (id) => camp.teamAbbrev[id]) !== tail) return { label };
  return { label: String(label).slice(0, at), teams: ids.reduce((o, id) => { o[id] = true; return o; }, {}) };
}

// A printed block as the seed stores it (no id, no ord yet).
function setupSeedRecord(raw, camp, lookup) {
  const s = setupSeedLabel(raw.label, camp, lookup);
  const rec = { start: raw.start, end: raw.end, label: s.label, emoji: raw.emoji, type: raw.type };
  if (raw.slot !== undefined) rec.slot = raw.slot;
  if (raw.noTime) rec.noTime = true;
  const meal = typeof legacyMealOf === 'function' ? legacyMealOf(raw.label) : null;
  if (meal) rec.meal = meal.toLowerCase();
  if (s.teams) rec.teams = s.teams;
  rec.alertKey = setupAlertKey(raw.label);
  return rec;
}

function setupSeedSameShape(t, d) {
  return t.start === d.start && t.end === d.end && t.type === d.type && t.slot === d.slot && !!t.noTime === !!d.noTime
    && setupHeadLabel(t.label) === setupHeadLabel(d.label) && !(t.teams && !d.teams);
}

const setupSeedRound = (n) => Math.round(n * 1000) / 1000;

// The schedule section of the seed (§10.2). Monday is the typical day; Tuesday to Friday become patches (a different
// tail, emoji or team group), `off` patches (a typical item that day doesn't have) and one-offs (an item typical
// doesn't have). A day with no weekday blocks, and Sunday and Saturday, are their own.
function setupSeedSchedule(camp) {
  const sched = (camp && camp.daySchedule) || {};
  const tags = {};
  ((camp && camp.schedDays) || []).forEach((d) => { tags[d.dow] = d.tag; });
  const placeholders = (camp && camp.placeholderDays) || [];
  const lookup = setupSeedTeamLookup(camp);
  const out = { days: {}, typical: {}, patches: {}, dayBlocks: {} };
  const taken = {};
  const typical = []; // [{ id, rec }] in Monday's order
  (sched[1] || []).forEach((raw, i) => {
    const rec = setupSeedRecord(raw, camp, lookup);
    rec.ord = 10 * i;
    const id = setupMintId('', raw.label, raw.start, taken);
    out.typical[id] = rec;
    typical.push({ id, rec });
  });
  for (let dow = 0; dow < 7; dow++) {
    const dk = SETUP_DK[dow];
    const arr = sched[dow] || [];
    const usesTypical = dow >= 1 && dow <= 5 && arr.length > 0 && typical.length > 0;
    const day = { typical: usesTypical };
    if (tags[dow]) day.tag = tags[dow];
    if (placeholders.indexOf(dow) !== -1) day.placeholder = true;
    out.days[dk] = day;
    // The printed week overlaps on purpose in a few places (junior's cabin movie nights run over "Prepare for bed" and the
    // devotional): of each overlapping pair of timed items the longer is marked `overlapOk` (§5.2), so the hub and the
    // Schedule screen start by warning about nothing the camp meant.
    const okIdx = new Set();
    arr.forEach((a, i) => arr.forEach((b, j) => {
      if (j <= i || a.noTime || b.noTime || !(a.start < b.end && b.start < a.end)) return;
      const la = a.end - a.start;
      const lb = b.end - b.start;
      okIdx.add(la > lb ? i : lb > la ? j : j);
    }));
    const dayTaken = Object.assign({}, taken); // an own id must not collide with a typical one: both publish as <dk>-<id>
    const used = {};
    const patch = {};
    const oneOffs = [];
    let pending = [];        // one-offs waiting for the next matched block, to be given an ord between its neighbours
    let prevOrd = null;
    const flush = (nextOrd) => {
      const m = pending.length;
      if (!m) return;
      const lo = prevOrd !== null ? prevOrd : (nextOrd !== null ? nextOrd - 10 : 0);
      const hi = nextOrd !== null ? nextOrd : lo + 10;
      pending.forEach((p, j) => { p.rec.ord = setupSeedRound(lo + (hi - lo) * (j + 1) / (m + 1)); });
      pending = [];
    };
    arr.forEach((raw, i) => {
      const rec = setupSeedRecord(raw, camp, lookup);
      if (okIdx.has(i)) rec.overlapOk = true;
      if (!usesTypical) {
        rec.ord = 10 * i;
        (out.dayBlocks[dk] = out.dayBlocks[dk] || {})[setupMintId(dk, raw.label, raw.start, dayTaken)] = rec;
        return;
      }
      const free = typical.filter((t) => !used[t.id] && setupSeedSameShape(t.rec, rec));
      const hit = free.find((t) => t.rec.label === rec.label && t.rec.emoji === rec.emoji && JSON.stringify(t.rec.teams) === JSON.stringify(rec.teams)) || free[0];
      if (hit) {
        used[hit.id] = true;
        flush(hit.rec.ord);
        prevOrd = hit.rec.ord;
        const p = {};
        if (rec.label !== hit.rec.label) p.label = rec.label;
        if (rec.emoji !== hit.rec.emoji) p.emoji = rec.emoji;
        if (rec.teams && JSON.stringify(rec.teams) !== JSON.stringify(hit.rec.teams)) p.teams = rec.teams;
        if (rec.overlapOk && !hit.rec.overlapOk) p.overlapOk = true;
        if (Object.keys(p).length) patch[hit.id] = p;
        return;
      }
      const one = { rec, id: setupMintId(dk, raw.label, raw.start, dayTaken) };
      pending.push(one);
      oneOffs.push(one);
    });
    flush(null);
    if (usesTypical) {
      typical.forEach((t) => { if (!used[t.id]) patch[t.id] = { off: true }; });
      if (Object.keys(patch).length) out.patches[dk] = patch;
      oneOffs.forEach((o) => { (out.dayBlocks[dk] = out.dayBlocks[dk] || {})[o.id] = o.rec; });
    }
  }
  return out;
}

// ── the other four sections' seeds (§10.2, step 19) ──────────────────

const SETUP_MEAL_KEYS = ['breakfast', 'lunch', 'supper'];

// Menus: MEALS[dow][meal] -> meals/<dk>/<meal> { dish, emoji? }. A dish the rules would refuse (empty, over 80) is cut or left out.
function setupSeedMeals(camp) {
  const out = {};
  const meals = (camp && camp.meals) || {};
  Object.keys(meals).forEach((dow) => {
    const dk = SETUP_DK[Number(dow)];
    if (!dk) return;
    SETUP_MEAL_KEYS.forEach((m) => {
      const e = meals[dow] && meals[dow][m];
      const dish = e && typeof e.dish === 'string' ? e.dish.trim().slice(0, 80) : '';
      if (!dish) return;
      const rec = { dish };
      if (typeof e.emoji === 'string' && e.emoji) rec.emoji = e.emoji;
      (out[dk] = out[dk] || {})[m] = rec;
    });
  });
  return out;
}

// Verses: the theme and one per competition day. Nothing the rules would refuse (no words, a video that is not https).
function setupSeedVerses(camp) {
  const out = {};
  const th = camp && camp.memoryVerseTheme;
  if (th && typeof th.text === 'string' && th.text.trim()) {
    out.theme = { text: th.text.trim().slice(0, 600), title: String(th.title || '').slice(0, 80), ref: String(th.ref || '').slice(0, 80) };
  }
  const days = {};
  const verses = (camp && camp.memoryVerses) || {};
  Object.keys(verses).forEach((dow) => {
    const dk = SETUP_DK[Number(dow)];
    const v = verses[dow];
    if (!dk || !v || typeof v.text !== 'string' || !v.text.trim()) return;
    const rec = { text: v.text.trim().slice(0, 600), ref: String(v.ref || '').slice(0, 80) };
    if (typeof safeVideoUrl === 'function' && safeVideoUrl(v.video) && v.video.length <= 300) rec.video = v.video;
    days[dk] = rec;
  });
  if (Object.keys(days).length) out.days = days;
  return out;
}

// The cleanup rota: MEAL_CLEANUP_SCHEDULE[dow][Meal] (a team id or a pair) -> cleanup/<dk>/<meal>/<tid>: true.
function setupSeedCleanup(camp) {
  const out = {};
  const rota = (camp && camp.mealCleanupSchedule) || {};
  Object.keys(rota).forEach((dow) => {
    const dk = SETUP_DK[Number(dow)];
    if (!dk || !rota[dow]) return;
    SETUP_MEAL_KEYS.forEach((m) => {
      [].concat(rota[dow][m.charAt(0).toUpperCase() + m.slice(1)] || []).forEach((tid) => {
        if (typeof tid !== 'string' || !/^t[0-9]$/.test(tid)) return;
        if (!out[dk]) out[dk] = {};
        if (!out[dk][m]) out[dk][m] = {};
        out[dk][m][tid] = true;
      });
    });
  });
  return out;
}

// Electives (junior only): the station list, then per day and slot the stations in the printed order, each with its people as
// typed names (`n-<slug>`; a director links one to a member later). Senior (no electives) writes nothing.
function setupSeedElectives(camp) {
  if (!(camp && camp.features && camp.features.electives)) return {};
  const stations = {};
  const byName = {};
  const emoji = camp.stationEmoji || {};
  const mint = (name) => {
    if (byName[name]) return byName[name];
    const base = 'st-' + setupSlug(name, 30);
    let id = base;
    let n = 2;
    while (stations[id]) id = base + '-' + n++;
    byName[name] = id;
    const rec = { name: String(name).slice(0, 60) };
    if (typeof emoji[name] === 'string' && emoji[name]) rec.emoji = emoji[name];
    stations[id] = rec;
    return id;
  };
  const slots = {};
  const days = camp.electives || {};
  Object.keys(days).forEach((dow) => {
    const dk = SETUP_DK[Number(dow)];
    if (!dk) return;
    (days[dow] || []).forEach((list, slot) => {
      (list || []).forEach((pair, j) => {
        const id = mint(pair[0]);
        const people = {};
        (pair[1] || []).forEach((name, k) => {
          const base = 'n-' + setupSlug(name, 40);
          let pid = base;
          let c = 2;
          while (people[pid]) pid = base + '-' + c++;
          people[pid] = { name: String(name).slice(0, 60), ord: 10 * (k + 1) };
        });
        const rec = { ord: 10 * (j + 1) };
        if (Object.keys(people).length) rec.people = people;
        if (!slots[dk]) slots[dk] = {};
        if (!slots[dk]['s' + slot]) slots[dk]['s' + slot] = {};
        slots[dk]['s' + slot][id] = rec;
      });
    });
  });
  // A station nobody stands at on any day is still on the list a director picks from.
  Object.keys(emoji).forEach((name) => mint(name));
  const out = {};
  if (Object.keys(stations).length) out.stations = stations;
  if (Object.keys(slots).length) out.slots = slots;
  return out;
}

// The whole seed: `{ meta: { schema, on }, days, typical, patches, dayBlocks, meals, verses, cleanup, electives }` for the
// sections asked for (default: the schedule alone). PURE and deterministic — the camps.js constants only, never the member
// directory or device state (`meta.seeded` is added by mergeSeed, at write time). A section with nothing to seed (senior's
// menus and rota, its electives) is still switched on: absence means empty.
function buildSeed(camp, sections) {
  const want = (sections || SETUP_SEED_SECTIONS).filter((s) => SETUP_SECTIONS.indexOf(s) !== -1);
  const out = { meta: { schema: SETUP_SCHEMA, on: {} } };
  if (want.indexOf('schedule') !== -1) {
    Object.assign(out, setupSeedSchedule(camp));
    out.meta.on.schedule = true;
  }
  [['meals', setupSeedMeals], ['verses', setupSeedVerses], ['cleanup', setupSeedCleanup], ['electives', setupSeedElectives]].forEach(([s, seedOf]) => {
    if (want.indexOf(s) === -1) return;
    const sub = seedOf(camp);
    if (Object.keys(sub).length) out[s] = sub;
    out.meta.on[s] = true;
  });
  return out;
}


// The camp's Sunday, setup/meta/weekStart, when it is a real date (always read: `meta` exists before any section is on);
// null when absent or not a Sunday the rules would accept.
function setupWeekStart() {
  const v = setupTree && setupTree.meta ? setupTree.meta.weekStart : null;
  if (typeof v !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(v)) return null;
  return typeof isValidWeekStart === 'function' && !isValidWeekStart(v) ? null : v;
}

// ── the plans the accessors read ─────────────────────────────────────

// Is this camp's schedule edited here, and in a schema this build can read? Off (or a newer schema) = the built-in
// week, everywhere.
function setupScheduleLive() {
  return setupSectionLive('schedule');
}
// The same question for any section (schedule, meals, verses, cleanup, electives): its switch is on and the schema is one
// this build reads. Off (or a newer schema) = the camps.js copy, everywhere.
function setupSectionLive(section) {
  return setupOn(section) && !setupSchemaTooNew();
}

const SETUP_RICH_OF = new WeakMap(); // a legacy block an accessor handed out -> the rich block it came from
let setupPlanMemo = null;            // the live tree's plans, rebuilt only when the tree (or its revision, or a team's short name / emoji) changes
let setupBuiltInMemo = null;         // the built-in week resolved the same way (planForDow while the schedule is off)
let setupBuiltInTreeMemo = null;     // …and the seeded tree it was resolved from (the Schedule screen's read-only preview reads it)

// What a team's tail in a label reads from: the roster's ids, short names and emojis. renderLabel bakes teamEmoji /
// teamShort into every label it builds, so a plan memoized on the tree alone kept the OLD "🦃 Turkey" in Happening
// Now, the schedule sheet, the calendar file and the published schedule after a director renamed a team and took the
// suggested short name (the Teams screen, a colleague's snapshot, an undo, a restore all change state.teams without
// touching the setup tree). Both memos carry this signature and rebuild when it moves. The raw record fields are
// compared, not the laundered ones: the same strings give the same labels, and it is cheap enough for every call.
function setupTeamSig() {
  const ts = typeof state !== 'undefined' && state && Array.isArray(state.teams) ? state.teams : [];
  let s = '';
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    s += (t ? String(t.id) + '\u0001' + String(t.short === undefined ? '' : t.short) + '\u0001' + String(t.emoji === undefined ? '' : t.emoji) : '') + '\u0002';
  }
  return s;
}

function setupBuildPlans(tree) {
  const rich = [];
  const legacy = [];
  const week = {};
  for (let dow = 0; dow < 7; dow++) {
    const resolved = resolveDay(tree, dow);
    const r = resolved.map(setupRichBlock);
    r.skipped = resolved.skipped.map(setupRichBlock);
    r.broken = resolved.broken;
    const l = resolved.map(legacyBlock);
    l.forEach((b, i) => SETUP_RICH_OF.set(b, r[i]));
    rich.push(r);
    legacy.push(l);
    week[dow] = l;
  }
  const days = SETUP_DK.map((dk, dow) => ({
    dow,
    short: SETUP_DAY_WORDS[dk].slice(0, 3),
    full: SETUP_DAY_WORDS[dk],
    tag: typeof setupMapOf(setupMapOf(tree.days)[dk]).tag === 'string' ? setupMapOf(tree.days)[dk].tag : '',
  }));
  return { rich, legacy, week, days };
}

// The live tree's plans: the same objects until the tree changes (render-stability: an idle re-render must not see
// new block objects). Keyed on the tree's identity AND its revision — a test (or a restore) may swap the tree whole.
function setupLivePlans() {
  const m = setupPlanMemo;
  const sig = setupTeamSig();
  if (m && m.tree === setupTree && m.rev === setupRev && m.sig === sig) return m;
  setupPlanMemo = Object.assign(setupBuildPlans(setupTree), { tree: setupTree, rev: setupRev, sig });
  return setupPlanMemo;
}

// The built-in week, seed-resolved (the same function over a built-in tree, cached once): what planForDow answers
// while the schedule is off, so the Schedule screen can preview it with real block ids.
function setupBuiltInTree() {
  if (!setupBuiltInTreeMemo) setupBuiltInTreeMemo = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['schedule']))));
  return setupBuiltInTreeMemo;
}
function setupBuiltInPlans() {
  const sig = setupTeamSig();
  if (!setupBuiltInMemo || setupBuiltInMemo.sig !== sig) setupBuiltInMemo = Object.assign(setupBuildPlans(setupBuiltInTree()), { sig });
  return setupBuiltInMemo;
}

// The accessors' three reads (app.js's SEAM block calls these behind typeof guards).
function setupPlanOf(dow, shared) { return (shared ? setupLivePlans() : setupBuiltInPlans()).rich[dow] || []; }
function setupLegacyDay(dow) { return setupLivePlans().legacy[dow] || []; }
function setupLegacyWeek() { return setupLivePlans().week; }
function setupWeekDays() { return setupLivePlans().days; }
// The rich block behind a block an accessor returned (null for any other object — a copy, a raw literal).
function setupRichOf(block) { return block && typeof block === 'object' ? (SETUP_RICH_OF.get(block) || null) : null; }

// ── A2: Put games on the schedule (§10.3) ────────────────────────────
// A game's `blockId` links it to the schedule item it is played in (config.games[].blockId, with `ord` the order
// inside the item). The Morning / Evening rule the schedule sheet used to apply is the fallback that reproduces
// the printed pairing; this writes it down once so it can be moved by hand (the rain plan), and so senior's
// Afternoon games and junior's Team Skits finally show somewhere.

const SETUP_GAME_ORD_STEP = 10;

// A name or label as the rules compare it: lower case, curly quotes straightened, spaces collapsed.
function setupNameKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

// The block a game belongs on (§10.3, first rule that applies wins), or null. `blocks`: the game's day, rich, in
// schedule order. 0) the camp profile's override; 1) a TIMED block whose head label is the game's name; 2) a games
// block whose head label contains the name; 3) by session — Morning: the first games block before 12:00,
// Afternoon: the games blocks from 12:00 to 4:59 PM that name the game's first word (else the first of them),
// Evening: the first games block from 5:00 PM.
function setupGameHome(game, blocks, camp) {
  const over = camp && camp.gameBlockOverrides && camp.gameBlockOverrides[game.id];
  if (over) { const hit = blocks.find((b) => b.id === over); if (hit) return hit; }
  const name = setupNameKey(game.name);
  const head = (b) => setupNameKey(setupHeadLabel(b.label));
  const timed = blocks.filter((b) => !b.noTime);
  if (name) {
    const same = timed.find((b) => head(b) === name);
    if (same) return same;
    const within = timed.find((b) => b.type === 'games' && head(b).indexOf(name) !== -1);
    if (within) return within;
  }
  const games = timed.filter((b) => b.type === 'games');
  if (game.session === 'Morning') return games.find((b) => b.start < 720) || null;
  if (game.session === 'Evening') return games.find((b) => b.start >= 1020) || null;
  if (game.session === 'Afternoon') {
    const pm = games.filter((b) => b.start >= 720 && b.start < 1020);
    const first = (name.match(/[a-z0-9]+/) || [''])[0];
    return (first && pm.find((b) => head(b).indexOf(first) !== -1)) || pm[0] || null;
  }
  return null;
}

// What A2 would write. `config`: { days, games }; `resolve(dow)`: that weekday's rich blocks. Only games with no
// `blockId`, or one that does not resolve on the game's day, are touched — never an attached game's link or `ord`,
// so a rain-plan move or a hand-made attachment survives any number of off / on cycles (sync-F2). `ord` goes after
// what the block already holds, in the catalog's current order. Returns { ops: [{ id, blockId, ord }],
// unplaced: [{ id, why: 'day' | 'rule' }] } and changes nothing.
function setupGameAttachments(config, resolve, camp) {
  const games = Array.isArray(config && config.games) ? config.games : [];
  const days = Array.isArray(config && config.days) ? config.days : [];
  const dowOf = (g) => { const d = days.find((x) => x && x.id === g.dayId); return d && Number.isInteger(d.dow) && d.dow >= 0 && d.dow <= 6 ? d.dow : -1; };
  const blocksOf = {};
  const blocks = (dow) => blocksOf[dow] || (blocksOf[dow] = resolve(dow) || []);
  const cursor = {}; // `${dow}/${blockId}` -> the highest ord the block holds so far
  const attached = (g, dow) => dow >= 0 && typeof g.blockId === 'string' && blocks(dow).some((b) => b.id === g.blockId);
  games.forEach((g) => {
    const dow = dowOf(g);
    if (attached(g, dow)) {
      const k = dow + '/' + g.blockId;
      cursor[k] = Math.max(cursor[k] || 0, Number.isFinite(g.ord) ? g.ord : 0);
    }
  });
  const ops = [];
  const unplaced = [];
  games.forEach((g) => {
    if (!g || typeof g.id !== 'string') return;
    const dow = dowOf(g);
    if (attached(g, dow)) return;
    if (dow < 0) { unplaced.push({ id: g.id, why: 'day' }); return; }
    const home = setupGameHome(g, blocks(dow), camp);
    if (!home) { unplaced.push({ id: g.id, why: 'rule' }); return; }
    const k = dow + '/' + home.id;
    cursor[k] = (cursor[k] || 0) + SETUP_GAME_ORD_STEP;
    ops.push({ id: g.id, blockId: home.id, ord: cursor[k] });
  });
  return { ops, unplaced };
}

// Apply those ops to a config in place (the config engine's push then sends exactly games/<id>/blockId and /ord).
function setupApplyGameAttachments(config, ops) {
  let n = 0;
  (ops || []).forEach((op) => {
    const g = ((config && config.games) || []).find((x) => x && x.id === op.id);
    if (!g) return;
    g.blockId = op.blockId;
    g.ord = op.ord;
    n++;
  });
  return n;
}

// The hub's "Put games on the schedule", and the second half of Edit the week here: one config edit (the config
// engine sends one transaction) for every game that has no place yet. Needs the schedule edited here — the links name
// its blocks — and an editable catalog. Never undoable by itself: the `pre-seed` restore point covers A1's run of it.
function putGamesOnSchedule() {
  const refuse = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  if (!canEdit()) return refuse('readonly');
  if (!setupScheduleLive()) return refuse('off');
  if (typeof configEditable === 'function' && !configEditable()) return refuse('loading');
  const plan = setupGameAttachments(state.config, (dow) => planForDow(dow), CAMP);
  if (!plan.ops.length) return { ok: true, noop: true, attached: 0, unplaced: plan.unplaced };
  setupApplyGameAttachments(state.config, plan.ops);
  saveConfig();
  return { ok: true, attached: plan.ops.length, unplaced: plan.unplaced };
}

// One game, just created (the classic builder's Add game and the ⚡ quick game both end in saveGameDraft): put it on
// its natural block at once, by A2's own rules, so it shows in the schedule, the calendar file and every counselor's
// view instead of on no item until somebody finds "Put games on the schedule". Called INSIDE the config edit that adds
// the game, so the game goes up whole with its link. Touches only this game: a game taken off the schedule on
// purpose (no blockId either) is never put back by someone else adding one. A duplicate carries its original's link
// (the copy is a clone), so it needs none. Returns true when it was placed.
function setupAttachNewGame(config, game) {
  if (!setupScheduleLive() || !config || !game || typeof game.blockId === 'string') return false;
  const placed = { days: config.days, games: (config.games || []).filter((g) => g === game || (g && typeof g.blockId === 'string')) };
  const op = setupGameAttachments(placed, (dow) => planForDow(dow), CAMP).ops.find((o) => o.id === game.id);
  if (!op) return false;
  game.blockId = op.blockId;
  game.ord = op.ord;
  return true;
}

// ── A1: Edit the week here, and Use the original week again (§10.1) — the OWNER's ────────────────
// The switch is `meta/on/<section>`: absent = never turned on, false = turned off (data kept), true = the
// subtree is the whole truth. Only the owner presses it (the rules refuse anyone else, and the app shows the
// button to nobody else): isOwner() is the sign-in, never anything stored on the device.

// What the transaction writes: for each requested section — never turned on: its seeded subtree AND the switch;
// turned off before: ONLY the switch (the data, edited or deliberately empty, comes back exactly as it was);
// already on: nothing. `meta.schema` is set, `meta.seeded` when anything was seeded, and every other field
// (weekStart, meta/edited stamps, a live wizard claim) is copied unchanged — the rules accept an unchanged stamp
// (NOWKEEP / SELFKEEP), which is what lets A1 run after anyone has edited anything. Returns undefined (the
// transaction aborts) when nothing would change, so a second press writes nothing. PURE: `info.at` is the server's
// timestamp placeholder in production and a number in a test.
function mergeSeed(cur, seed, sections, info) {
  const out = setupIsMap(cur) ? setupClone(cur) : {};
  if (!setupIsMap(out.meta)) out.meta = {};
  const meta = out.meta;
  if (typeof meta.schema === 'number' && meta.schema > SETUP_SCHEMA) return undefined; // a newer build wrote this: never downgrade it
  if (!setupIsMap(meta.on)) meta.on = {};
  const on = meta.on;
  let changed = false;
  let seeded = false;
  (sections || []).forEach((s) => {
    if (SETUP_SECTIONS.indexOf(s) === -1 || on[s] === true) return;
    if (on[s] === false) { on[s] = true; changed = true; return; }
    (RP_SETUP_KEYS[s] || []).forEach((k) => {
      if (seed && seed[k] !== undefined) out[k] = setupClone(seed[k]); else delete out[k];
    });
    on[s] = true;
    changed = true;
    seeded = true;
  });
  if (!changed) return undefined;
  meta.schema = SETUP_SCHEMA;
  if (seeded) meta.seeded = { at: info.at, byKey: info.byKey, from: info.from };
  return out;
}

// Edit the week here. Returns { ok:true, turnedOn, seeded, attach } or { ok:false, reason, … } — reasons, each said
// BEFORE anything is written: owner (message), loading, denied, schema, tab, offline, already ("You already turned
// this on" — also what a second device sees), camp-week (the freeze: a camp week is running), ask-camp-week (no date
// is set, so the caller must ask "Is a camp week running right now?" and pass campRunning), restore-point (the
// `pre-seed` point is the safety net and is required), failed, refused. `opts`: { campRunning: bool, overrideCampWeek:
// bool (the owner ticked "I know a camp week is running") }.
async function setupTurnOn(sections, opts) {
  const o = opts || {};
  const refuse = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  // Any of the five sections; the electives only where the camp has them (senior has none, so nothing can turn them on).
  const want = (sections || SETUP_SEED_SECTIONS).filter((s) => SETUP_SECTIONS.indexOf(s) !== -1 && (s !== 'electives' || setupHasElectives()));
  if (!want.length) return refuse('none');
  const gate = ownerGate('turn on editing');
  if (!gate.ok) return refuse('owner', { message: gate.reason });
  if (!setupRef || !setupReady) return refuse('loading');
  if (setupDenied || setupWriteRefused) return refuse('denied');
  if (setupSchemaTooNew()) return refuse('schema');
  if (!tabMayPush('setup')) return refuse('tab'); // a view-only second tab never writes
  if (!restoreOnline()) return refuse('offline');
  const off = want.filter((s) => !setupOn(s));
  if (!off.length) return refuse('already');
  if (!o.overrideCampWeek) {
    const wk = campWeek();
    if (wk.phase === 'during') return refuse('camp-week');
    if (wk.phase === 'unset') {
      if (o.campRunning === undefined) return refuse('ask-camp-week');
      if (o.campRunning === true) return refuse('camp-week');
    }
  }
  const key = identityKey(authUser);
  if (!key) return refuse('owner', { message: ownerGate('turn on editing').reason });
  // The safety net first, and only when something is being seeded for the first time: what A1 writes OUTSIDE
  // setup (the games' links) is covered by this point, and a restore never flips the switch itself.
  const first = off.filter((s) => (setupTree.meta.on || {})[s] === undefined);
  if (first.length) {
    const rp = await restoreSave('pre-seed', 'Before turning on editing', { requireOnline: true });
    if (!rp.ok) return refuse('restore-point', { why: rp.reason });
  }
  const seed = buildSeed(CAMP, off);
  const info = { at: firebase.database.ServerValue.TIMESTAMP, byKey: key, from: 'camps.js@v' + APP_VERSION };
  setupPending++;
  setupNotify('sync');
  let res;
  try {
    res = await setupRef.transaction((cur) => mergeSeed(cur, seed, off, info), null, false);
  } catch (e) {
    return refuse(e && e.code === 'PERMISSION_DENIED' ? 'refused' : 'failed', { code: e && e.code });
  } finally {
    setupPending = Math.max(0, setupPending - 1);
    setupNotify('sync');
  }
  if (typeof setupIdleTick === 'function') setupIdleTick(); // the commit's own snapshot was turned away while this write was in flight: re-read it NOW, so the switch shows at once
  if (!res || !res.committed) return refuse('already'); // another device pressed it first
  // A2 in the same flow, against the tree that was just written: the games that have no place yet get one (a
  // catalog that is not editable yet is left for the hub's Put games on the schedule).
  let attach = null;
  if (off.indexOf('schedule') !== -1 && canEdit() && (typeof configEditable !== 'function' || configEditable())) { // only the schedule has games to place
    const tree = normalizeSetup(setupClone(res.snapshot.val()));
    const plan = setupGameAttachments(state.config, (dow) => resolveDay(tree, dow).map(setupRichBlock), CAMP);
    if (plan.ops.length) { setupApplyGameAttachments(state.config, plan.ops); saveConfig(); }
    attach = { attached: plan.ops.length, unplaced: plan.unplaced };
  }
  return { ok: true, turnedOn: off, seeded: first, attach };
}

// Use the original week again: the switch goes false, instantly on every device, and every edit is KEPT (Edit the
// week here brings it back). One ordinary setup commit, owner-only through the engine's own gate, no undo entry
// (pressing the other button is the undo).
function setupUseOriginal(sections) {
  const gate = ownerGate('switch back to the original week');
  if (!gate.ok) return { ok: false, reason: 'owner', message: gate.reason };
  const want = (sections || SETUP_SEED_SECTIONS).filter((s) => SETUP_SECTIONS.indexOf(s) !== -1 && setupOn(s));
  if (!want.length) return { ok: false, reason: 'already' };
  const r = commitSetup((d) => { want.forEach((s) => { d.meta.on[s] = false; }); }, { undo: false, ownerWhat: 'switch back to the original week' });
  return r.ok ? { ok: true, turnedOff: want } : r;
}

// ── 8. Schedule editing (§11.5): the mutators the Schedule screen's sheets commit ─────────────────
// Everything here is PURE over a draft tree (commitSetup hands the mutator a COPY and diffs it), so a test drives
// each rule with a plain object and the screens only gather the answers. The fields an item has, in the order a
// patch or a record lists them; `alertKey` and `ord` are set when a record is made and never edited here (a rename
// keeps its reminder key unless the director says "start fresh", §11.5).

const SCHED_FIELDS = ['label', 'emoji', 'start', 'end', 'type', 'slot', 'meal', 'noTime', 'teams', 'overlapOk'];
const SCHED_FIELD_WORDS = { label: 'name', emoji: 'emoji', start: 'start time', end: 'end time', type: 'kind', slot: 'elective', meal: 'meal', noTime: 'time setting', teams: 'teams', overlapOk: 'overlap setting' };
const SCHED_GAP_MIN = 15;     // a gap this long between two items shows "Add something" (phone)
const SCHED_STEP = 5;         // minutes: the item sheet's time inputs, and every move

// A value as the stored tree compares it: absent and false are the same for the flags, a teams map by its ids.
function schedNorm(field, v) {
  if (field === 'noTime' || field === 'overlapOk') return v === true;
  if (field === 'teams') { const ids = setupTeamList(v); return ids.length ? ids.join(',') : ''; }
  return v === undefined || v === null ? '' : v;
}

// The stored record of a day's item, wherever it lives: { where: 'dayBlocks' | 'typical' | null, rec, patch, typical }.
// `rec` is what the schedule resolves to (typical + patch, or the own record).
function schedFind(tree, dk, bid) {
  const t = setupIsMap(tree) ? tree : {};
  const own = setupMapOf(setupMapOf(t.dayBlocks)[dk])[bid];
  if (setupIsMap(own)) return { where: 'dayBlocks', rec: own, patch: null, typical: null };
  const typ = setupMapOf(t.typical)[bid];
  if (setupIsMap(typ) && setupMapOf(setupMapOf(t.days)[dk]).typical === true) {
    const patch = setupMapOf(setupMapOf(t.patches)[dk])[bid];
    return { where: 'typical', rec: Object.assign({}, typ, setupMapOf(patch)), patch: setupMapOf(patch), typical: typ };
  }
  if (setupIsMap(typ) && !dk) return { where: 'typical', rec: typ, patch: null, typical: typ };
  return { where: null, rec: null, patch: null, typical: null };
}

// Every block id in use anywhere (typical or any day's own): a new id must be free in all of them, because a
// typical id and an own id both publish as `<dk>-<id>`.
function schedTakenIds(tree) {
  const taken = {};
  Object.keys(setupMapOf(tree.typical)).forEach((id) => { taken[id] = true; });
  Object.keys(setupMapOf(tree.dayBlocks)).forEach((dk) => Object.keys(setupMapOf(tree.dayBlocks[dk])).forEach((id) => { taken[id] = true; }));
  return taken;
}

// The stored record for an item sheet's fields. `item`: { label, emoji, start, end, type ('activity' | 'games' |
// 'elective'), slot?, meal?, noTime?, teams? ({t0:true} | ids), overlapOk? }. Optional fields are left out, never null.
function schedRecord(item, extra) {
  const rec = { start: item.start, end: item.end, label: String(item.label).trim(), emoji: item.emoji, type: SETUP_BLOCK_TYPES.indexOf(item.type) !== -1 ? item.type : 'activity' };
  if (rec.type === 'elective' && (item.slot === 0 || item.slot === 1 || item.slot === 2)) rec.slot = item.slot;
  if (item.meal === 'breakfast' || item.meal === 'lunch' || item.meal === 'supper') rec.meal = item.meal;
  if (item.noTime === true) rec.noTime = true;
  const ids = Array.isArray(item.teams) ? item.teams : setupTeamList(item.teams);
  if (ids.length) rec.teams = ids.reduce((o, id) => { o[id] = true; return o; }, {});
  if (item.overlapOk === true) rec.overlapOk = true;
  return Object.assign(rec, extra || {});
}

// Does one day's item need a field a patch cannot carry? A patch can set a value or fall back to the typical one,
// but it cannot REMOVE a typical field (a meal, an elective slot, the teams): "Just Tuesday" is not offered for such
// a change and the sheet says why. Returns the field words, or ''.
function schedUnpatchable(typical, item) {
  const rec = schedRecord(item);
  const bad = ['meal', 'slot', 'teams'].filter((f) => schedNorm(f, typical[f]) !== '' && schedNorm(f, rec[f]) === '');
  return bad.map((f) => SCHED_FIELD_WORDS[f]).join(' and ');
}

// Which of the sheet's fields differ from a stored record (as the schedule resolves it)?
function schedChanged(rec, item) {
  const next = schedRecord(item);
  return SCHED_FIELDS.filter((f) => schedNorm(f, rec[f]) !== schedNorm(f, next[f]));
}

function schedPutField(target, f, next) {
  if (f === 'noTime' || f === 'overlapOk') { if (next[f] === true) target[f] = true; else delete target[f]; return; }
  if (next[f] === undefined) delete target[f]; else target[f] = setupClone(next[f]);
}

// ord for a new item: after everything its container holds, so same-start ties read in the order they were added.
function schedNextOrd(draft, dk, scope) {
  let top = -10;
  const take = (m) => Object.keys(setupMapOf(m)).forEach((id) => { const o = Number(m[id] && m[id].ord); if (Number.isFinite(o) && o > top) top = o; });
  if (scope === 'typical') take(draft.typical);
  else take(setupMapOf(draft.dayBlocks)[dk]);
  return top + 10;
}

// Add an item. scope 'typical' puts it on the typical day (every day that follows it gets it); scope 'day' makes it
// that day's own (a one-off on a day that follows the typical day, a plain item on an own day). Returns the new id.
function schedAddMutate(draft, p) {
  const rec = schedRecord(p.item, { alertKey: setupAlertKey(p.item.label) });
  const scope = p.scope === 'typical' ? 'typical' : 'day';
  rec.ord = schedNextOrd(draft, p.dk, scope);
  const id = setupMintNewId(schedTakenIds(draft));
  if (scope === 'typical') draft.typical[id] = rec;
  else { draft.dayBlocks[p.dk] = setupMapOf(draft.dayBlocks[p.dk]); draft.dayBlocks[p.dk][id] = rec; }
  return id;
}

// Save an edit of an item that exists. p: { dk, bid, item, scope: 'typical' | 'day', changeOwn: [dk…] }.
//   a one-off or an own item  → its record, whatever the scope
//   scope 'typical'           → typical/<bid>, and the patches on those fields go with it: the seen day's, and the days
//                               in `changeOwn` ("Change Wednesday too"); every other patch is that day keeping its own
//   scope 'day'               → patches/<dk>/<bid> carrying only what differs from the typical item (a field set back
//                               to the typical value is dropped from the patch: "Back to the usual")
// Returns { ok } or { ok:false, reason: 'gone' | 'unpatchable', fields }.
function schedEditMutate(draft, p) {
  const found = schedFind(draft, p.dk, p.bid);
  if (!found.where) return { ok: false, reason: 'gone' };
  const next = schedRecord(p.item);
  if (found.where === 'dayBlocks') {
    const rec = draft.dayBlocks[p.dk][p.bid];
    SCHED_FIELDS.forEach((f) => schedPutField(rec, f, next));
    if (p.alertKey) rec.alertKey = p.alertKey;
    return { ok: true };
  }
  if (p.scope === 'typical' || !p.dk) {
    // What the director changed is measured against what the seen day RESOLVES to (typical + its own patch): a day's
    // patched field that the sheet left alone must not be written into the typical day.
    const changed = SCHED_FIELDS.filter((f) => schedNorm(f, found.rec[f]) !== schedNorm(f, next[f]));
    const rec = draft.typical[p.bid];
    changed.forEach((f) => schedPutField(rec, f, next));
    if (p.alertKey) rec.alertKey = p.alertKey; // "No, start fresh": a new reminder key for a renamed item (a patch cannot carry one)
    const dks = [p.dk].concat(p.changeOwn || []).filter(Boolean);
    dks.forEach((dk) => {
      const patch = setupMapOf(draft.patches[dk])[p.bid];
      if (!setupIsMap(patch)) return;
      changed.forEach((f) => { delete patch[f]; });
    });
    return { ok: true };
  }
  const bad = schedUnpatchable(found.typical, p.item);
  if (bad) return { ok: false, reason: 'unpatchable', fields: bad };
  draft.patches[p.dk] = setupMapOf(draft.patches[p.dk]);
  const patch = setupIsMap(draft.patches[p.dk][p.bid]) ? draft.patches[p.dk][p.bid] : {};
  SCHED_FIELDS.forEach((f) => {
    if (schedNorm(f, next[f]) === schedNorm(f, found.typical[f])) { delete patch[f]; return; }
    if (f === 'noTime' || f === 'overlapOk') patch[f] = next[f] === true;
    else patch[f] = setupClone(next[f]);
  });
  if (Object.keys(patch).length) draft.patches[p.dk][p.bid] = patch; else delete draft.patches[p.dk][p.bid];
  return { ok: true };
}

// Move other items of a day (the ripple that follows "Push later items back"): { id: { start, end } }. An own or one-off
// item keeps its times on its record, a typical item as a patch on that day (dropped when it equals the typical time),
// and from the typical day (dk '') on the typical record.
function schedMovesMutate(draft, dk, moves) {
  Object.keys(moves || {}).forEach((id) => {
    const f = schedFind(draft, dk, id);
    const m = moves[id];
    if (f.where === 'dayBlocks') { draft.dayBlocks[dk][id].start = m.start; draft.dayBlocks[dk][id].end = m.end; return; }
    if (f.where !== 'typical') return;
    if (!dk) { draft.typical[id].start = m.start; draft.typical[id].end = m.end; return; }
    draft.patches[dk] = setupMapOf(draft.patches[dk]);
    const patch = setupIsMap(draft.patches[dk][id]) ? draft.patches[dk][id] : {};
    ['start', 'end'].forEach((k) => { if (m[k] === f.typical[k]) delete patch[k]; else patch[k] = m[k]; });
    if (Object.keys(patch).length) draft.patches[dk][id] = patch; else delete draft.patches[dk][id];
  });
}

// Take an item out. scope 'day' on a typical item = skipped that day (patches/<dk>/<bid>/off, "Bring back" undoes it);
// scope 'typical' = removed from every day (its patches go with it). An own or one-off item is deleted.
function schedRemoveMutate(draft, p) {
  const found = schedFind(draft, p.dk, p.bid);
  if (!found.where) return { ok: false, reason: 'gone' };
  if (found.where === 'dayBlocks') { delete draft.dayBlocks[p.dk][p.bid]; return { ok: true }; }
  if (p.scope === 'typical' || !p.dk) {
    delete draft.typical[p.bid];
    Object.keys(setupMapOf(draft.patches)).forEach((dk) => { if (setupIsMap(draft.patches[dk])) delete draft.patches[dk][p.bid]; });
    return { ok: true };
  }
  draft.patches[p.dk] = setupMapOf(draft.patches[p.dk]);
  draft.patches[p.dk][p.bid] = Object.assign(setupMapOf(draft.patches[p.dk][p.bid]), { off: true });
  return { ok: true };
}

// Bring back what a day skipped.
function schedBringBackMutate(draft, p) {
  const own = setupMapOf(setupMapOf(draft.dayBlocks)[p.dk])[p.bid];
  if (setupIsMap(own)) { delete own.off; return { ok: true }; }
  const patch = setupMapOf(setupMapOf(draft.patches)[p.dk])[p.bid];
  if (!setupIsMap(patch)) return { ok: false, reason: 'gone' };
  delete patch.off;
  return { ok: true };
}

// Which days an "Every day like Tuesday" save reaches, and which keep their own value. `fields`: the changed field
// names. { change: [dk…] (days that follow the typical day and show the item, in week order — the seen day first is NOT
// special), keep: [{ dk, fields: [word…] }] }.
function schedScopeInfo(tree, bid, fields) {
  const change = [];
  const keep = [];
  SETUP_DK.forEach((dk) => {
    if (setupMapOf(setupMapOf(tree.days)[dk]).typical !== true) return;
    const patch = setupMapOf(setupMapOf(tree.patches)[dk])[bid];
    if (setupIsMap(patch) && patch.off === true) return; // skipped that day: nothing to change
    const own = fields.filter((f) => setupIsMap(patch) && patch[f] !== undefined);
    if (own.length) keep.push({ dk, fields: own });
    else change.push(dk);
  });
  return { change, keep };
}

// "Mon–Fri" / "Mon, Tue, Thu, Fri" for a list of day keys (a run of three or more reads as a range).
function schedDaysWords(dks) {
  const idx = dks.map((dk) => SETUP_DK.indexOf(dk)).filter((i) => i >= 0).sort((a, b) => a - b);
  const short = (i) => SETUP_DAY_WORDS[SETUP_DK[i]].slice(0, 3);
  const out = [];
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    if (j - i >= 2) out.push(short(idx[i]) + '–' + short(idx[j]));
    else for (let k = i; k <= j; k++) out.push(short(idx[k]));
    i = j + 1;
  }
  return out.join(', ');
}

// Items of a resolved day (rich blocks) that a candidate time would overlap: timed items only, an item marked
// `overlapOk` never counts, and the candidate itself is left out by id.
function schedOverlaps(blocks, cand) {
  if (cand.noTime) return [];
  return (blocks || []).filter((b) => b.id !== cand.id && !b.noTime && !b.overlapOk && b.start < cand.end && cand.start < b.end);
}

// Ripple a move down the day. `blocks`: the day's rich blocks in time order; the item `id` moves by `delta` minutes
// and so does everything that starts at or after the item's OLD start (later items keep their order and lengths). An
// item that runs until the end of the day is elastic: its start moves, its end stays 1440, and it shrinks to at least
// 5 minutes. Any other item that would end after midnight (or start before 00:00) is not moved and is listed in
// `nofit`, so a ripple can never produce end > 1440. Returns { moves: { id: { start, end } }, nofit: [block…] }.
function schedRipple(blocks, id, delta, opts) {
  const list = (blocks || []).filter((b) => !b.noTime).slice().sort((a, b) => a.start - b.start);
  const me = list.find((b) => b.id === id);
  const moves = {};
  const nofit = [];
  if (!me) return { moves, nofit };
  const o = opts || {};
  const from = me.start;
  list.forEach((b) => {
    if (b.id !== id && b.start < from) return;
    if (b.id === id && o.skipSelf) return;
    const start = b.start + delta;
    if (b.end === 1440 && start >= 0 && start <= 1440 - SCHED_STEP) { moves[b.id] = { start, end: 1440 }; return; }
    const end = b.end + delta;
    if (start < 0 || end > 1440) { nofit.push(b); return; }
    moves[b.id] = { start, end };
  });
  return { moves, nofit };
}

// The time gaps worth an "Add something" row: between two timed items, SCHED_GAP_MIN or longer.
function schedGaps(blocks) {
  const list = (blocks || []).filter((b) => !b.noTime).slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  let reach = null;
  list.forEach((b) => {
    if (reach !== null && b.start - reach >= SCHED_GAP_MIN) out.push({ start: reach, end: b.start });
    reach = reach === null ? b.end : Math.max(reach, b.end);
  });
  return out;
}

// Give a day its own schedule: its resolved items become `dayBlocks/<dk>` WITH THE SAME ids (so attached games and
// alert keys don't move), the day stops following the typical day and its patches go, in ONE commit. An item the
// day skipped is simply not copied. `blocks`: the day's rich blocks (planForDow).
function schedOwnMutate(draft, dk, blocks) {
  draft.dayBlocks[dk] = setupMapOf(draft.dayBlocks[dk]);
  (blocks || []).forEach((b) => {
    if (b.origin === 'oneoff' || b.origin === 'own') return; // already its own
    const rec = schedRecord({ label: b.base, emoji: b.emoji, start: b.start, end: b.end, type: b.type, slot: b.slot, meal: b.meal, noTime: b.noTime, teams: b.teams, overlapOk: b.overlapOk }, { alertKey: b.alertKey, ord: b.ord });
    draft.dayBlocks[dk][b.id] = rec;
  });
  draft.days[dk] = Object.assign(setupMapOf(draft.days[dk]), { typical: false });
  delete draft.patches[dk];
}

// Make a day follow the typical day again: the day's own items go (games on them are re-homed by the caller first).
function schedFollowMutate(draft, dk) {
  draft.days[dk] = Object.assign(setupMapOf(draft.days[dk]), { typical: true });
  delete draft.dayBlocks[dk];
}

// Clear a day's changes (patches and one-offs) and leave it following the typical day.
function schedClearMutate(draft, dk) {
  delete draft.patches[dk];
  delete draft.dayBlocks[dk];
}

// Copy items onto an EMPTY own day from another day's resolved items (new ids, same reminder keys).
function schedCopyIntoMutate(draft, dk, blocks) {
  draft.dayBlocks[dk] = setupMapOf(draft.dayBlocks[dk]);
  const taken = schedTakenIds(draft);
  (blocks || []).forEach((b, i) => {
    const rec = schedRecord({ label: b.base, emoji: b.emoji, start: b.start, end: b.end, type: b.type, slot: b.slot, meal: b.meal, noTime: b.noTime, teams: b.teams, overlapOk: b.overlapOk }, { alertKey: b.alertKey, ord: 10 * i });
    draft.dayBlocks[dk][setupMintNewId(taken)] = rec;
  });
}

// The games that sit on the given schedule items of a weekday, in the catalog (config.games). `ids`: block ids.
function schedGamesOn(config, ids, dayIds) {
  const set = {};
  ids.forEach((i) => { set[i] = true; });
  return ((config && config.games) || []).filter((g) => g && set[g.blockId] && (!dayIds || dayIds.indexOf(g.dayId) !== -1));
}

// The commit the screens call. `p.kind`: add | edit | remove | bring | own | follow | clear | copy. Returns commitSetup's
// result plus { id } for an add; { ok:false, reason } says why nothing was written. The restore point for the
// destructive ones is the CALLER's (it is async and may need the director's answer first).
function schedCommit(p) {
  let outcome = { ok: true };
  let newId = null;
  const mutate = (draft) => {
    let r;
    switch (p.kind) {
      case 'add': newId = schedAddMutate(draft, p); r = { ok: true }; break;
      case 'edit': r = schedEditMutate(draft, p); break;
      case 'remove': r = schedRemoveMutate(draft, p); break;
      case 'bring': r = schedBringBackMutate(draft, p); break;
      case 'own': schedOwnMutate(draft, p.dk, p.blocks); r = { ok: true }; break;
      case 'follow': schedFollowMutate(draft, p.dk); r = { ok: true }; break;
      case 'clear': schedClearMutate(draft, p.dk); r = { ok: true }; break;
      case 'copy': schedCopyIntoMutate(draft, p.dk, p.blocks); r = { ok: true }; break;
      default: r = { ok: false, reason: 'kind' };
    }
    // The ripple follows the scope: "Every day like Tuesday" moves the typical items, "Just Tuesday" Tuesday's.
    if (r.ok && p.moves && (p.kind === 'add' || p.kind === 'edit')) schedMovesMutate(draft, p.scope === 'typical' || !p.dk ? '' : p.dk, p.moves);
    outcome = r;
    return r.ok ? undefined : false;
  };
  // The item must still be there: the sheet says where it found it (`where`, as it was when the sheet opened), so one a
  // colleague removed since is refused by name ("Pat removed this item") instead of being resurrected half-made.
  const expect = [];
  if (p.kind === 'edit' || p.kind === 'remove' || p.kind === 'bring') {
    const where = p.where || schedFind(setupTree, p.dk, p.bid).where;
    if (where === 'dayBlocks') expect.push('dayBlocks/' + p.dk + '/' + p.bid);
    else if (where === 'typical') expect.push('typical/' + p.bid);
  }
  const res = commitSetup(mutate, { label: p.label, expect });
  if (!res.ok && res.reason === 'cancelled' && outcome && !outcome.ok) return Object.assign({}, res, { reason: outcome.reason, fields: outcome.fields });
  return newId ? Object.assign(res, { id: newId }) : res;
}

// ── 9. The rain plan (§11.6): staged changes for ONE day, the draft's shape, the Done check ─────────
// A plan is { dk, epoch, at, items: { <setup path>: { base, staged } }, games: { <gid>: { base, staged } } }. For every staged
// field the value it had when it was staged (`base`) is kept beside the new one (`staged`, null = delete), so Done can
// tell a field a colleague changed since from one only this device touched (sync-F4). Nothing here writes: the screen
// builds a plan with these, shows it through rainView, and rainCommit sends it as ONE commit.

const RAIN_DRAFT_KEY = 'campSetupRainDraft';  // lsKey()'d; wiped by clearLocalData
const RAIN_DRAFT_STALE_MS = 12 * 3600 * 1000;  // "Finish or discard yesterday's rain plan?"
const RAIN_BUSY_MS = 2 * 60 * 1000;            // the panel holds a reload only while it was touched this recently

function rainPlanNew(dk, epoch, at) {
  return { dk, epoch: epoch || '', at: at || Date.now(), items: {}, games: {} };
}

// What a path holds right now (null = absent), canonical.
function rainBaseAt(tree, path) {
  return setupValueAt(setupCanon(tree), path);
}

// Where a day's field lives: an own or one-off item keeps it on its record, a typical item as a patch.
function rainPath(tree, dk, bid, field) {
  const own = setupIsMap(setupMapOf(setupMapOf(tree.dayBlocks)[dk])[bid]);
  return (own ? 'dayBlocks/' : 'patches/') + dk + '/' + bid + '/' + field;
}

// Stage `value` at `path`. The base stays the FIRST one seen; a field put back to its base leaves the plan.
function rainStage(plan, tree, path, value, group) {
  const was = plan.items[path];
  const base = was ? was.base : rainBaseAt(tree, path);
  const staged = value === undefined ? null : value;
  if (JSON.stringify(syncCanon(base)) === JSON.stringify(syncCanon(staged))) delete plan.items[path];
  else {
    plan.items[path] = { base, staged };
    // `g` ties the fields one action staged together (a swap moves two items): putting one back puts its partner back too.
    const g = group || (was && was.g);
    if (g) plan.items[path].g = g;
  }
  return plan;
}

// Stage fields of one item: { start, end } or { off: true }. `rich`: the item's rich block.
function rainStageFields(plan, tree, dk, bid, fields, group) {
  Object.keys(fields).forEach((f) => rainStage(plan, tree, rainPath(tree, dk, bid, f), fields[f], group));
  return plan;
}

// Put one item back as planned: every staged field of it leaves the plan, and so does anything staged by the same action
// (the other half of a swap), or the day would be left with a half-swap.
function rainUnstage(plan, dk, bid) {
  const groups = {};
  Object.keys(plan.items).forEach((p) => {
    const parts = p.split('/');
    if (parts[1] === dk && parts[2] === bid && plan.items[p].g) groups[plan.items[p].g] = true;
  });
  Object.keys(plan.items).forEach((p) => {
    const parts = p.split('/');
    if ((parts[1] === dk && parts[2] === bid) || (plan.items[p].g && groups[plan.items[p].g])) delete plan.items[p];
  });
  return plan;
}

function rainIsStaged(plan, dk, bid) {
  return Object.keys(plan.items).some((p) => { const parts = p.split('/'); return parts[1] === dk && parts[2] === bid; });
}

// The tree with the plan applied (a copy).
function rainStagedTree(tree, plan) {
  const t = setupClone(tree);
  Object.keys(plan.items).forEach((p) => setupSetPath(t, p, plan.items[p].staged));
  return normalizeSetup(t);
}

// The day before and after the plan, as rich blocks. `skipped` is what the plan skips (and what was skipped already).
function rainView(tree, plan, dow) {
  const mk = (t) => { const r = resolveDay(t, dow); const out = r.map(setupRichBlock); out.skipped = r.skipped.map(setupRichBlock); return out; };
  return { before: mk(tree), after: mk(rainStagedTree(tree, plan)) };
}

// ── what a swap / a nudge does, as { id: { start, end } } (null: it cannot be done) ──
const rainLen = (b) => b.end - b.start;
function rainTimed(blocks) { return (blocks || []).filter((b) => !b.noTime).slice().sort((a, b) => a.start - b.start || a.end - b.end); }

// Each takes the other's start AND end: nothing else moves and nothing overlaps.
function rainSwapSlots(a, b) {
  return { [a.id]: { start: b.start, end: b.end }, [b.id]: { start: a.start, end: a.end } };
}
// Each takes the other's start and keeps its own length. null when one would run past midnight.
function rainSwapLengths(a, b) {
  const ae = b.start + rainLen(a);
  const be = a.start + rainLen(b);
  if (ae > 1440 || be > 1440) return null;
  return { [a.id]: { start: b.start, end: ae }, [b.id]: { start: a.start, end: be } };
}
// Swap with the timed neighbour (dir -1 earlier, +1 later); each keeps its length and the pair keeps its span.
// null when there is no such neighbour.
function rainNudge(blocks, id, dir) {
  const list = rainTimed(blocks);
  const i = list.findIndex((b) => b.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return null;
  const x = dir < 0 ? list[j] : list[i]; // the earlier of the two
  const y = dir < 0 ? list[i] : list[j]; // the later
  const gap = Math.max(0, y.start - x.end);
  const ys = x.start;
  const ye = ys + rainLen(y);
  const xs = ye + gap;
  const xe = xs + rainLen(x);
  if (xe > 1440) return null;
  return { [y.id]: { start: ys, end: ye }, [x.id]: { start: xs, end: xe } };
}

// Change time: the item to a new start/end (end 1440 = until the end of the day); `ripple` carries everything after it.
// { moves, nofit } — nofit lists the items a ripple left alone because they would not fit before midnight.
function rainRetime(blocks, id, start, end, ripple) {
  const me = (blocks || []).find((b) => b.id === id);
  if (!me) return { moves: {}, nofit: [] };
  if (!ripple) return { moves: { [id]: { start, end } }, nofit: [] };
  const r = schedRipple(blocks, id, start - me.start, { skipSelf: true });
  r.moves[id] = { start, end };
  return r;
}

// ── the summary ──
// Lines for Done, in day order: { kind: 'time' | 'skip' | 'add' | 'game', … }.
function rainChanges(tree, plan, dow, config, dayIdsOf) {
  const v = rainView(tree, plan, dow);
  const after = {};
  v.after.forEach((b) => { after[b.id] = b; });
  const lines = [];
  v.before.forEach((b) => {
    const a = after[b.id];
    if (!a) lines.push({ kind: 'skip', id: b.id, label: b.label, emoji: b.emoji, start: b.start });
    else if (a.start !== b.start || a.end !== b.end) lines.push({ kind: 'time', id: b.id, label: a.label, emoji: a.emoji, start: a.start, end: a.end, was: { start: b.start, end: b.end } });
  });
  const beforeIds = {};
  v.before.forEach((b) => { beforeIds[b.id] = true; });
  v.after.forEach((b) => { if (!beforeIds[b.id]) lines.push({ kind: 'add', id: b.id, label: b.label, emoji: b.emoji, start: b.start, end: b.end }); });
  lines.sort((a, b) => (a.start - b.start) || (a.id < b.id ? -1 : 1));
  Object.keys(plan.games || {}).forEach((gid) => {
    const g = ((config && config.games) || []).find((x) => x && x.id === gid);
    const to = plan.games[gid].staged;
    if (g && to) lines.push({ kind: 'game', id: gid, label: g.name, emoji: g.emoji, to });
  });
  return { lines, before: v.before, after: v.after };
}

// The verdict Done always says: overlaps among timed items not marked on purpose, and any new gap of 45+ minutes the
// plan opened. [{ kind: 'overlap', a, b } | { kind: 'gap', start, end }], empty = "Nothing overlaps".
function rainVerdict(before, after) {
  const out = [];
  const list = rainTimed(after);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (b.start >= a.end) break;
      if (a.overlapOk || b.overlapOk) continue;
      out.push({ kind: 'overlap', a, b, start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) });
    }
  }
  const had = schedGaps(before).filter((g) => g.end - g.start >= 45).map((g) => g.start + '-' + g.end);
  schedGaps(after).filter((g) => g.end - g.start >= 45 && had.indexOf(g.start + '-' + g.end) === -1).forEach((g) => out.push({ kind: 'gap', start: g.start, end: g.end }));
  return out;
}

// Done's first check: every staged field's stored base against what the tree holds NOW (a colleague may have changed
// it since). [{ path, mine, theirs, label }] — nothing written until each is answered Keep his / Use yours.
function rainClashes(tree, plan) {
  const now = setupCanon(tree);
  const out = [];
  Object.keys(plan.items).forEach((path) => {
    const cur = setupValueAt(now, path);
    if (JSON.stringify(syncCanon(cur)) === JSON.stringify(syncCanon(plan.items[path].base))) return;
    if (JSON.stringify(syncCanon(cur)) === JSON.stringify(syncCanon(plan.items[path].staged))) return; // they did the same thing
    out.push({ path, mine: plan.items[path].staged, theirs: cur, base: plan.items[path].base });
  });
  return out;
}

// The commit's mutator: the staged values written, a patch field equal to the typical item's dropped (a swap back is
// "Back to the usual", not a patch), and a patch emptied of every field removed. `keep`: paths whose clash was answered
// "Keep his" (left as the tree has them).
function rainCommitMutate(draft, plan, keep) {
  const skip = {};
  (keep || []).forEach((p) => { skip[p] = true; });
  Object.keys(plan.items).forEach((p) => { if (!skip[p]) setupSetPath(draft, p, plan.items[p].staged); });
  Object.keys(plan.items).forEach((p) => {
    const parts = p.split('/');
    if (parts[0] !== 'patches' || parts.length !== 4) return;
    const typ = setupMapOf(draft.typical)[parts[2]];
    const patch = setupMapOf(setupMapOf(draft.patches)[parts[1]])[parts[2]];
    if (!setupIsMap(typ) || !setupIsMap(patch)) return;
    if (parts[3] !== 'off' && patch[parts[3]] !== undefined && schedNorm(parts[3], patch[parts[3]]) === schedNorm(parts[3], typ[parts[3]])) delete patch[parts[3]];
  });
}

// The competition sessions a target item belongs to (config.sessions, else Morning / Evening): the bucket the game's
// `session` is set to when it moves onto an item.
function rainSessionFor(config, block) {
  const sessions = Array.isArray(config && config.sessions) && config.sessions.length ? config.sessions : ['Morning', 'Evening'];
  if (!block) return null;
  if (sessions.indexOf('Afternoon') !== -1) return block.start < 720 ? 'Morning' : block.start < 1020 ? 'Afternoon' : 'Evening';
  return block.start < 720 ? (sessions.indexOf('Morning') !== -1 ? 'Morning' : sessions[0]) : (sessions.indexOf('Evening') !== -1 ? 'Evening' : sessions[sessions.length - 1]);
}

// Stage one game's move: `to` = { blockId, dayId, dow, session, ord, messtival? } or { blockId: null } (not on the schedule).
function rainStageGame(plan, game, to) {
  const was = plan.games[game.id];
  const base = was ? was.base : { blockId: game.blockId === undefined ? null : game.blockId, dayId: game.dayId, session: game.session, ord: Number.isFinite(game.ord) ? game.ord : null, messtival: game.messtival === true };
  const same = (to.blockId || null) === base.blockId && (to.blockId === null || (to.dayId === base.dayId && (to.messtival === undefined || to.messtival === base.messtival)));
  if (same) delete plan.games[game.id];
  else plan.games[game.id] = { base, staged: to };
  return plan;
}

// Apply the plan's game moves to a config in place (the config engine's push then sends exactly the fields that
// changed). `keepGames`: ids whose move was answered "Keep his".
function rainApplyGames(config, plan, keepGames) {
  const skip = {};
  (keepGames || []).forEach((g) => { skip[g] = true; });
  let n = 0;
  Object.keys(plan.games || {}).forEach((gid) => {
    if (skip[gid]) return;
    const g = ((config && config.games) || []).find((x) => x && x.id === gid);
    if (!g) return;
    const to = plan.games[gid].staged;
    if (!to.blockId) { delete g.blockId; delete g.ord; n++; return; }
    g.blockId = to.blockId;
    g.ord = to.ord;
    if (to.dayId) g.dayId = to.dayId;
    if (to.session) g.session = to.session;
    if (to.messtival !== undefined) { if (to.messtival) g.messtival = true; else delete g.messtival; }
    n++;
  });
  return n;
}

// Games whose stored link no longer matches what the plan assumed (a colleague moved them since): the same
// Keep his / Use yours question as a time.
function rainGameClashes(config, plan) {
  const out = [];
  Object.keys(plan.games || {}).forEach((gid) => {
    const g = ((config && config.games) || []).find((x) => x && x.id === gid);
    if (!g) return;
    const b = plan.games[gid].base;
    const cur = { blockId: g.blockId === undefined ? null : g.blockId, dayId: g.dayId };
    if (cur.blockId !== b.blockId || cur.dayId !== b.dayId) out.push({ gid, game: g, theirs: cur });
  });
  return out;
}

// ── 10. Meals, verses, cleanup, electives (§5.2, §9.2, §11.10–11.13 — build step 19) ───────────────
// The four smaller sections of the week. The READERS are pure over a tree and memoized for the accessors in app.js's SEAM
// block (the same objects until the tree changes: render-stability), the HELPERS are pure (fill evenly, the fairness line,
// "nearly the same name"), and the MUTATORS are ordinary commitSetup calls — each refused ("off") until the owner turns
// its section on, so nothing in here changes what anyone sees until then.

function setupHasElectives() {
  return !!(CAMP && CAMP.features && CAMP.features.electives);
}

const SETUP_MEAL_NAMES = { breakfast: 'Breakfast', lunch: 'Lunch', supper: 'Supper' };

// A typed elective person's id ('n-' + slug) as opposed to a member key (an email or a +phone, which can never look like this).
function setupIsTypedPerson(pid) {
  return /^n-[a-z0-9-]+$/.test(String(pid));
}

// ── readers (pure over a tree) ──

// meals/<dk>/<meal> as { dish, emoji? }, or null (no record, or no dish: the rules want one). The emoji is laundered here
// because the schedule sheet writes it into markup.
function setupMealRecord(tree, dk, meal) {
  const rec = setupMapOf(setupMapOf(tree && tree.meals)[dk])[meal];
  if (!setupIsMap(rec) || typeof rec.dish !== 'string' || !rec.dish.trim()) return null;
  const emoji = safeEmoji(rec.emoji, '');
  return emoji ? { dish: rec.dish, emoji } : { dish: rec.dish };
}

// cleanup/<dk>/<meal> as team ids in slot order — only the camp's own teams (an id past the roster is the hub's problem, not a name).
function setupCleanupIds(tree, dk, meal) {
  return setupTeamList(setupMapOf(setupMapOf(setupMapOf(tree && tree.cleanup)[dk])[meal])).filter((id) => setupTeamSlot(id) < CAMP.teamCount);
}

// Is this day on the rota at all? A day with a team on any meal is; an untracked day says nothing (as the printed rota did).
function setupCleanupTracked(tree, dk) {
  return SETUP_MEAL_KEYS.some((m) => setupCleanupIds(tree, dk, m).length > 0);
}

function setupVerseTheme(tree) {
  const t = setupMapOf(setupMapOf(tree && tree.verses).theme);
  if (typeof t.text !== 'string' || !t.text.trim()) return null;
  return { title: typeof t.title === 'string' ? t.title : '', text: t.text, ref: typeof t.ref === 'string' ? t.ref : '' };
}

// verses/days/<dk> as { text, ref, video? } — the video only when it is a plain https link (re-checked here, whatever the rules let in).
function setupVerseDay(tree, dk) {
  const v = setupMapOf(setupMapOf(setupMapOf(tree && tree.verses).days)[dk]);
  if (typeof v.text !== 'string' || !v.text.trim()) return null;
  const out = { text: v.text, ref: typeof v.ref === 'string' ? v.ref : '' };
  const video = safeVideoUrl(v.video);
  if (video) out.video = video;
  return out;
}

// The stations a director can pick from, by name: [{ id, name, emoji }].
function setupElectiveStations(tree) {
  const st = setupMapOf(setupMapOf(tree && tree.electives).stations);
  return Object.keys(st).filter((id) => setupIsMap(st[id]) && typeof st[id].name === 'string' && st[id].name.trim())
    .map((id) => ({ id, name: st[id].name, emoji: safeEmoji(st[id].emoji, '') }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.id < b.id ? -1 : 1));
}

// The name to show for one elective person: a member's own name from the directory (it follows a rename), else the name
// typed with them. One spelling per counselor (respellCounselorText): "Lilly" reads "Lily" wherever it was typed.
function setupPersonName(pid, rec) {
  const dir = typeof memberDirectory !== 'undefined' && memberDirectory && typeof memberDirectory === 'object' ? memberDirectory : null;
  const mem = !setupIsTypedPerson(pid) && dir && setupIsMap(dir[pid]) && typeof dir[pid].name === 'string' && dir[pid].name.trim() ? dir[pid].name.trim() : '';
  const raw = mem || (setupIsMap(rec) && typeof rec.name === 'string' ? rec.name : '');
  return respellCounselorText(raw.slice(0, 60));
}

// One slot of one day: [{ id, name, emoji, ord, people: [{ pid, name, ord, typed }] }] in (ord, id) order.
function setupElectiveRows(tree, dk, slot) {
  const stations = setupMapOf(setupMapOf(tree && tree.electives).stations);
  const inSlot = setupMapOf(setupMapOf(setupMapOf(setupMapOf(tree && tree.electives).slots)[dk])['s' + slot]);
  const byOrd = (a, b) => (Number(a.ord) || 0) - (Number(b.ord) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return Object.keys(inSlot).filter((id) => setupIsMap(inSlot[id]) && setupIsMap(stations[id]) && typeof stations[id].name === 'string' && stations[id].name.trim())
    .map((id) => {
      const ppl = setupMapOf(inSlot[id].people);
      return {
        id, name: stations[id].name, emoji: safeEmoji(stations[id].emoji, ''), ord: inSlot[id].ord,
        people: Object.keys(ppl).filter((pid) => setupIsMap(ppl[pid]) && typeof ppl[pid].name === 'string')
          .map((pid) => ({ pid, name: setupPersonName(pid, ppl[pid]), ord: ppl[pid].ord, id: pid, typed: setupIsTypedPerson(pid) }))
          .sort(byOrd),
      };
    }).sort(byOrd);
}

// The derived reads the accessors share, built once per (tree, revision, member directory).
let setupSecMemo = null;
function setupSecs() {
  const dir = typeof memberDirectory !== 'undefined' ? memberDirectory : null;
  const m = setupSecMemo;
  if (m && m.tree === setupTree && m.rev === setupRev && m.dir === dir) return m;
  const tree = setupTree;
  const meals = {};
  const cleanup = {};
  const verses = { theme: setupVerseTheme(tree), days: {} };
  const electives = { byDow: {}, emoji: {}, names: [], keys: {} };
  for (let dow = 0; dow < 7; dow++) {
    const dk = SETUP_DK[dow];
    SETUP_MEAL_KEYS.forEach((meal) => {
      const rec = setupMealRecord(tree, dk, meal);
      if (rec) (meals[dow] = meals[dow] || {})[meal] = rec;
    });
    cleanup[dow] = { tracked: setupCleanupTracked(tree, dk), meals: {} };
    SETUP_MEAL_KEYS.forEach((meal) => { cleanup[dow].meals[meal] = setupCleanupIds(tree, dk, meal); });
    const vd = setupVerseDay(tree, dk);
    if (vd) verses.days[dow] = vd;
    // The legacy shape, [slot -> [[station, [names], [keys]], …]], with a third list the legacy rows don't have: the member
    // key of each name ('' for a typed one), which is how a signed-in counselor's own station is found by key before name.
    const day = [];
    for (let slot = 0; slot < 3; slot++) {
      day[slot] = setupElectiveRows(tree, dk, slot).map((r) => [r.name, r.people.map((p) => p.name), r.people.map((p) => (p.typed ? '' : p.pid))]);
      day[slot].forEach((row) => row[1].forEach((n) => { if (n && electives.names.indexOf(n) === -1) electives.names.push(n); }));
    }
    while (day.length && !day[day.length - 1].length) day.pop();
    if (day.length) electives.byDow[dow] = day;
  }
  setupElectiveStations(tree).forEach((s) => { if (s.emoji && !electives.emoji[s.name]) electives.emoji[s.name] = s.emoji; });
  setupSecMemo = { tree, rev: setupRev, dir, meals, cleanup, verses, electives };
  return setupSecMemo;
}

// The accessors' reads (app.js SEAM block calls these behind typeof guards).
function setupMealFor(dow, meal) { return (setupSecs().meals[dow] || {})[meal] || null; }
function setupCleanupOnRota(dow) { return !!(setupSecs().cleanup[dow] || {}).tracked; }
function setupCleanupFor(dow, meal) { return ((setupSecs().cleanup[dow] || { meals: {} }).meals[String(meal).toLowerCase()]) || null; }
function setupVerseThemeNow() { return setupSecs().verses.theme; }
function setupVerseFor(dow) { return setupSecs().verses.days[dow] || null; }
function setupElectivesOf(dow) { return setupSecs().electives.byDow[dow] || null; }
function setupStationEmoji(name) { return setupSecs().electives.emoji[name] || ''; }
function setupElectiveNames() { return setupSecs().electives.names; }

// ── helpers (pure) ──

// "Fill evenly" (§11.12): which teams clean which meal. `input`:
//   { teams: ['t0',…], redo: bool, slots: [{ day, meal, want: 1, have: ['t5'] }] }
// in the order the days come; `have` is what the rota already holds (kept unless `redo`), `want` how many teams that meal
// takes (a Friday with pairs says 2). The rules it keeps, in this order of importance: every team within one of every other
// (the lowest count goes next), no team twice in a day, no team on the same meal two days running — a rule that cannot be
// kept for a slot is dropped for that slot alone and the slot is reported in `relaxed`. Deterministic: the same input is
// the same rota. Returns { slots: [{ day, meal, teams }], counts, spread, relaxed: ['mon lunch'] }.
function rotaFillEvenly(input) {
  const teams = ((input && input.teams) || []).slice();
  const redo = !!(input && input.redo);
  const slots = ((input && input.slots) || []).map((s) => ({
    day: s.day, meal: s.meal, want: Math.max(1, Number(s.want) || 1),
    teams: redo ? [] : [].concat(s.have || []).filter((t, i, a) => teams.indexOf(t) !== -1 && a.indexOf(t) === i),
  }));
  const counts = {};
  teams.forEach((t) => { counts[t] = 0; });
  slots.forEach((s) => s.teams.forEach((t) => { counts[t]++; }));
  const lastUse = {};
  const relaxed = [];
  // The teams on the same meal the day before slot j (the nearest earlier slot of that meal on another day).
  const beforeOf = (j) => {
    for (let k = j - 1; k >= 0; k--) if (slots[k].meal === slots[j].meal && slots[k].day !== slots[j].day) return slots[k].teams;
    return [];
  };
  slots.forEach((s, i) => {
    while (s.teams.length < s.want) {
      const today = {};
      slots.forEach((o) => { if (o.day === s.day) o.teams.forEach((t) => { today[t] = true; }); });
      const prev = {};
      beforeOf(i).forEach((t) => { prev[t] = true; });
      // How many of the day's later, still-unfilled meals a team could still take: the team with the fewest goes first, so a
      // team that cannot repeat Thursday's supper is not left for Friday's supper.
      const room = (t) => slots.filter((o, j) => j > i && o.day === s.day && o.teams.length < o.want && beforeOf(j).indexOf(t) === -1).length;
      const pick = (noDay, noRun) => teams.filter((t) => s.teams.indexOf(t) === -1 && !(noDay && today[t]) && !(noRun && prev[t]))
        .sort((a, b) => counts[a] - counts[b] || room(a) - room(b) || (lastUse[a] === undefined ? -1 : lastUse[a]) - (lastUse[b] === undefined ? -1 : lastUse[b]) || teams.indexOf(a) - teams.indexOf(b))[0];
      let t = pick(true, true);
      if (t === undefined) { t = pick(true, false); if (t !== undefined && relaxed.indexOf(s.day + ' ' + s.meal) === -1) relaxed.push(s.day + ' ' + s.meal); }
      if (t === undefined) { t = pick(false, false); if (t !== undefined && relaxed.indexOf(s.day + ' ' + s.meal) === -1) relaxed.push(s.day + ' ' + s.meal); }
      if (t === undefined) break; // fewer teams than the slot wants
      s.teams.push(t);
      counts[t]++;
      lastUse[t] = i;
    }
  });
  const all = teams.map((t) => counts[t]);
  return { slots: slots.map((s) => ({ day: s.day, meal: s.meal, teams: s.teams.slice() })), counts, spread: all.length ? Math.max.apply(null, all) - Math.min.apply(null, all) : 0, relaxed };
}

// The fairness line under the rota (§11.12): "Each team cleans 2–3 times. Maples clean twice on Thursday."
// `slots`: [{ day: 'thu', meal, teams }]; `nameOf(tid)` the team's short name; `dayName(dk)` the day's word.
function rotaFairness(slots, teamIds, nameOf, dayName) {
  const counts = {};
  teamIds.forEach((t) => { counts[t] = 0; });
  const perDay = {};
  (slots || []).forEach((s) => (s.teams || []).forEach((t) => {
    if (counts[t] === undefined) return;
    counts[t]++;
    const k = t + '/' + s.day;
    perDay[k] = (perDay[k] || 0) + 1;
  }));
  const all = teamIds.map((t) => counts[t]);
  const min = all.length ? Math.min.apply(null, all) : 0;
  const max = all.length ? Math.max.apply(null, all) : 0;
  const notes = [];
  const none = teamIds.filter((t) => counts[t] === 0);
  if (none.length) notes.push(none.map(nameOf).join(', ') + (none.length === 1 ? ' isn’t' : ' aren’t') + ' on the rota yet.');
  Object.keys(perDay).forEach((k) => {
    if (perDay[k] < 2) return;
    const [t, d] = k.split('/');
    notes.push(nameOf(t) + ' clean ' + (perDay[k] === 2 ? 'twice' : perDay[k] + ' times') + ' on ' + dayName(d) + '.');
  });
  const line = !max ? 'Nobody is on the rota yet.' : 'Each team cleans ' + (min === max ? min + (min === 1 ? ' time' : ' times') : min + '–' + max + ' times') + '.';
  return { min, max, counts, line, notes, text: [line].concat(notes).join(' ') };
}

// Two names that are probably one person (§11.13 "Sophie → Sofia?"): not the same once counselors' spellings are merged
// (those never need a link), but one letter apart, or the same consonants in the same order from the same first letter.
function setupNameSkeleton(n) {
  const s = String(n || '').toLowerCase().replace(/[^a-z]/g, '').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/y/g, 'i');
  return s.charAt(0) + s.slice(1).replace(/[aeiou]/g, '');
}
function setupNamesNear(a, b) {
  const x = String(canonicalCounselorName(String(a || '').trim())).toLowerCase();
  const y = String(canonicalCounselorName(String(b || '').trim())).toLowerCase();
  if (!x || !y || x === y || x.length < 3 || y.length < 3) return false;
  if (Math.abs(x.length - y.length) <= 1) {
    let d = 0;
    if (x.length === y.length) { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++; if (d <= 1) return true; }
    else {
      const [lo, hi] = x.length < y.length ? [x, y] : [y, x];
      for (let i = 0; i < hi.length; i++) if (hi.slice(0, i) + hi.slice(i + 1) === lo) return true;
    }
  }
  return x.charAt(0) === y.charAt(0) && setupNameSkeleton(x) === setupNameSkeleton(y);
}

// A name as it is compared: counselors' spellings merged, lower case. The first word of a longer name ("Sofia Reed") likewise.
function setupNameCanon(s) {
  return String(canonicalCounselorName(String(s == null ? '' : s).trim())).toLowerCase();
}
function setupFirstCanon(s) {
  return setupNameCanon(String(s == null ? '' : s).trim().split(/\s+/)[0]);
}

// The member (from the directory: [{ key, name }]) a typed name is probably, or null. An exact name is no problem — a
// counselor is found by name already — so only a miss is flagged, in this order: a member listed with a LONGER name that
// starts with the typed one ("Sofia" / "Sofia Reed": the name matches nobody's sign-in, so a Link is worth offering; two
// members sharing that first name are ambiguous, so none is offered) beats a near spelling ("Sophie" ≈ "Sofia"), which is
// only looked for when no first name matched — an exact first name must never be hijacked by a near one.
function setupNearMember(name, members) {
  const list = (members || []).filter((m) => m && m.name);
  const want = setupNameCanon(name);
  if (list.some((m) => setupNameCanon(m.name) === want)) return null;
  const sameFirst = list.filter((m) => setupFirstCanon(m.name) === want);
  if (sameFirst.length) return sameFirst.length === 1 ? sameFirst[0] : null;
  return list.find((m) => setupNamesNear(name, m.name) || setupNamesNear(name, String(m.name).trim().split(/\s+/)[0])) || null;
}
// How the Link row and the hub say which member: their first name for a near spelling, their whole name when the typed one is
// already their first name ("Sofia looks like Sofia Reed", not "Sofia looks like Sofia").
function setupNearLabel(name, member) {
  const full = String(member && member.name || '').trim();
  return setupFirstCanon(full) === setupNameCanon(name) ? full : full.split(/\s+/)[0];
}

// The printed menus, verses, rota and stations as a tree: what a section's screen previews, read-only, while the section is
// the original (the same data the owner's Turn on would seed).
let setupBuiltInSecMemo = null;
function setupBuiltInSections() {
  if (!setupBuiltInSecMemo) setupBuiltInSecMemo = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP, ['meals', 'verses', 'cleanup', 'electives']))));
  return setupBuiltInSecMemo;
}

// ── mutators: every one is a commitSetup (one undo entry, one push), refused "off" until the section's switch is on ──

function setupCap(s, n) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
}

// A meal's dish and emoji. An empty dish removes the record (the rules want a dish; an emoji alone is not a menu).
function mealsSetMutate(d, dk, meal, dish, emoji) {
  const text = setupCap(dish, 80);
  const day = setupMapOf(d.meals[dk]);
  d.meals[dk] = day;
  if (!text) { delete day[meal]; return; }
  const rec = { dish: text };
  const e = safeEmoji(emoji, '');
  if (e) rec.emoji = e;
  day[meal] = rec;
}
function mealsSet(dk, meal, dish, emoji, label) {
  if (SETUP_DK.indexOf(dk) === -1 || SETUP_MEAL_KEYS.indexOf(meal) === -1) return { ok: false, reason: 'cancelled' };
  return commitSetup((d) => mealsSetMutate(d, dk, meal, dish, emoji), { label: label || (SETUP_DAY_WORDS[dk] + ' ' + meal + ': ' + (setupCap(dish, 40) || 'no dish')) });
}
// Copy one day's menu over another's (the target's own dishes are replaced).
function mealsCopyDay(fromDk, toDk) {
  if (fromDk === toDk) return { ok: false, reason: 'cancelled' };
  return commitSetup((d) => { d.meals[toDk] = setupClone(setupMapOf(d.meals[fromDk])); }, { label: 'Copied ' + SETUP_DAY_WORDS[fromDk] + '’s menu to ' + SETUP_DAY_WORDS[toDk] });
}

// The theme verse, or one day's: `rec` { text, ref, title?, video? }; no words removes it. Returns commitSetup's result or
// { ok: false, reason: 'text' | 'video' } before anything is written (the form says which).
function versesRecord(rec, theme) {
  const text = setupCap(rec && rec.text, 600);
  const ref = setupCap(rec && rec.ref, 80);
  const title = setupCap(rec && rec.title, 80);
  const video = setupCap(rec && rec.video, 300);
  if (!text) return (ref || title || video) ? { error: 'text' } : { empty: true };
  if (!theme && video && !(safeVideoUrl(video) && /^https:\/\//.test(video))) return { error: 'video' };
  const out = { text };
  if (ref) out.ref = ref;
  if (theme && title) out.title = title;
  if (!theme && video) out.video = video;
  return { rec: out };
}
function versesSetTheme(rec) {
  const r = versesRecord(rec, true);
  if (r.error) return { ok: false, reason: r.error };
  return commitSetup((d) => { if (r.empty) delete d.verses.theme; else d.verses.theme = r.rec; }, { label: 'Theme verse' });
}
function versesSetDay(dk, rec) {
  if (SETUP_DK.indexOf(dk) === -1) return { ok: false, reason: 'cancelled' };
  const r = versesRecord(rec, false);
  if (r.error) return { ok: false, reason: r.error };
  return commitSetup((d) => { d.verses.days = setupMapOf(d.verses.days); if (r.empty) delete d.verses.days[dk]; else d.verses.days[dk] = r.rec; }, { label: SETUP_DAY_WORDS[dk] + '’s verse' });
}

// The teams on one meal's cleanup (a set, replaced whole): none removes the meal. The rules take only t0–t9 and `true`.
function cleanupSetMutate(d, dk, meal, ids) {
  const day = setupMapOf(d.cleanup[dk]);
  d.cleanup[dk] = day;
  const set = {};
  [].concat(ids || []).forEach((id) => { if (/^t[0-9]$/.test(id) && setupTeamSlot(id) < CAMP.teamCount) set[id] = true; });
  if (Object.keys(set).length) day[meal] = set; else delete day[meal];
}
function cleanupSet(dk, meal, ids, label) {
  if (SETUP_DK.indexOf(dk) === -1 || SETUP_MEAL_KEYS.indexOf(meal) === -1) return { ok: false, reason: 'cancelled' };
  return commitSetup((d) => cleanupSetMutate(d, dk, meal, ids), { label: label || (SETUP_DAY_WORDS[dk] + ' ' + meal + ' cleanup') });
}
// Apply a fill-evenly result ([{ day, meal, teams }]) as ONE commit.
function cleanupApply(slots, label) {
  return commitSetup((d) => { (slots || []).forEach((s) => cleanupSetMutate(d, s.day, s.meal, s.teams)); }, { label: label || 'Filled the cleanup rota evenly' });
}

// Stations. The id is `st-` + slug(name) (§5.5), a number added when it is taken.
function electiveStationNewId(tree, name) {
  const have = setupMapOf(setupMapOf(tree && tree.electives).stations);
  const base = 'st-' + setupSlug(name, 30);
  let id = base;
  let n = 2;
  while (have[id]) id = base + '-' + n++;
  return id;
}
function electiveStationAdd(name, emoji) {
  const text = setupCap(name, 60);
  if (!text) return { ok: false, reason: 'name' };
  const id = electiveStationNewId(setupTree, text);
  const r = commitSetup((d) => {
    d.electives.stations = setupMapOf(d.electives.stations);
    const rec = { name: text };
    const e = safeEmoji(emoji, '');
    if (e) rec.emoji = e;
    d.electives.stations[id] = rec;
  }, { label: 'Added the ' + text + ' station' });
  return Object.assign(r, { id });
}
// A new station that goes straight into one slot of one day ("Add a station" on an elective): ONE commit, one undo entry.
function electiveStationAddToSlot(name, emoji, dk, slot) {
  const text = setupCap(name, 60);
  if (!text) return { ok: false, reason: 'name' };
  const id = electiveStationNewId(setupTree, text);
  const r = commitSetup((d) => {
    d.electives.stations = setupMapOf(d.electives.stations);
    const rec = { name: text };
    const e = safeEmoji(emoji, '');
    if (e) rec.emoji = e;
    d.electives.stations[id] = rec;
    const sl = electiveSlotAt(d, dk, slot);
    sl[id] = { ord: electiveNextOrd(sl) };
  }, { label: 'Added the ' + text + ' station on ' + SETUP_DAY_WORDS[dk] + ', elective ' + (slot + 1) });
  return Object.assign(r, { id });
}
function electiveStationEdit(id, name, emoji) {
  const text = setupCap(name, 60);
  if (!text) return { ok: false, reason: 'name' };
  return commitSetup((d) => {
    const rec = setupMapOf(d.electives.stations)[id];
    if (!setupIsMap(rec)) return false;
    rec.name = text;
    const e = safeEmoji(emoji, '');
    if (e) rec.emoji = e; else delete rec.emoji;
  }, { label: 'Changed the ' + text + ' station', expect: ['electives/stations/' + id] });
}
// Remove a station from the list AND from every slot that holds it (one commit, one undo).
function electiveStationRemove(id) {
  const was = setupMapOf(setupMapOf(setupTree.electives).stations)[id];
  return commitSetup((d) => {
    delete setupMapOf(d.electives.stations)[id];
    Object.keys(setupMapOf(d.electives.slots)).forEach((dk) => Object.keys(setupMapOf(d.electives.slots[dk])).forEach((s) => { delete setupMapOf(d.electives.slots[dk][s])[id]; }));
  }, { label: 'Removed the ' + (was && was.name ? was.name : 'elective') + ' station' });
}

function electiveSlotKey(slot) { return 's' + slot; }
function electiveSlotAt(d, dk, slot) {
  d.electives.slots = setupMapOf(d.electives.slots);
  d.electives.slots[dk] = setupMapOf(d.electives.slots[dk]);
  d.electives.slots[dk][electiveSlotKey(slot)] = setupMapOf(d.electives.slots[dk][electiveSlotKey(slot)]);
  return d.electives.slots[dk][electiveSlotKey(slot)];
}
const electiveNextOrd = (map) => 10 + Math.max(0, ...Object.keys(map).map((k) => Number(setupMapOf(map[k]).ord) || 0));

function electiveSlotAddStation(dk, slot, stId) {
  const st = setupMapOf(setupMapOf(setupTree.electives).stations)[stId];
  return commitSetup((d) => {
    const sl = electiveSlotAt(d, dk, slot);
    if (sl[stId]) return false;
    sl[stId] = { ord: electiveNextOrd(sl) };
  }, { label: (st && st.name ? st.name : 'A station') + ' on ' + SETUP_DAY_WORDS[dk] + ', elective ' + (slot + 1), expect: ['electives/stations/' + stId] });
}
function electiveSlotRemoveStation(dk, slot, stId) {
  const st = setupMapOf(setupMapOf(setupTree.electives).stations)[stId];
  return commitSetup((d) => { delete electiveSlotAt(d, dk, slot)[stId]; }, { label: (st && st.name ? st.name : 'A station') + ' off ' + SETUP_DAY_WORDS[dk] + ', elective ' + (slot + 1) });
}
// A person at a station: a member (their key, name from the list) or a typed name (`n-<slug>`). Nothing happens when they're
// already there.
function electivePersonId(person, taken) {
  if (person && person.key) return String(person.key).slice(0, 200);
  const base = 'n-' + setupSlug(person && person.name, 40);
  let id = base;
  let n = 2;
  while (taken && taken[id]) id = base + '-' + n++;
  return id;
}
function electivePersonAdd(dk, slot, stId, person) {
  const name = setupCap(person && person.name, 60);
  if (!name) return { ok: false, reason: 'name' };
  return commitSetup((d) => {
    const row = electiveSlotAt(d, dk, slot)[stId];
    if (!setupIsMap(row)) return false;
    row.people = setupMapOf(row.people);
    const pid = electivePersonId(person, row.people);
    if (row.people[pid] && person.key) return false;
    // The same name typed twice at one station is a double tap, not two people — compared with the spellings merged
    // ("Lilly" beside "Lily" is one person), and a typed first name where a member with that first name already stands
    // is that member. (A member added where the typed name stands is allowed: Link then merges the two.)
    const want = setupNameCanon(name);
    if (Object.keys(row.people).some((k) => {
      const have = String(setupMapOf(row.people[k]).name || '');
      return setupNameCanon(have) === want || (!person.key && !setupIsTypedPerson(k) && setupFirstCanon(have) === want);
    })) return false;
    row.people[pid] = { name, ord: electiveNextOrd(row.people) };
  }, { label: name + ' at ' + (((setupMapOf(setupTree.electives).stations || {})[stId] || {}).name || 'a station') + ', ' + SETUP_DAY_WORDS[dk], expect: ['electives/slots/' + dk + '/' + electiveSlotKey(slot) + '/' + stId] });
}
function electivePersonRemove(dk, slot, stId, pid) {
  const rec = setupMapOf(setupMapOf(setupMapOf(setupMapOf(setupMapOf(setupTree.electives).slots)[dk])[electiveSlotKey(slot)])[stId]).people;
  const name = setupMapOf(rec)[pid] ? setupMapOf(rec)[pid].name : 'Someone';
  return commitSetup((d) => { const row = electiveSlotAt(d, dk, slot)[stId]; if (!setupIsMap(row)) return false; delete setupMapOf(row.people)[pid]; },
    { label: name + ' off ' + SETUP_DAY_WORDS[dk] + '’s ' + (((setupMapOf(setupTree.electives).stations || {})[stId] || {}).name || 'station') });
}
// "Same as Monday": the day's three slots become a copy of another day's.
function electiveCopyDay(fromDk, toDk) {
  if (fromDk === toDk) return { ok: false, reason: 'cancelled' };
  return commitSetup((d) => { d.electives.slots = setupMapOf(d.electives.slots); d.electives.slots[toDk] = setupClone(setupMapOf(d.electives.slots[fromDk])); },
    { label: SETUP_DAY_WORDS[toDk] + '’s electives: same as ' + SETUP_DAY_WORDS[fromDk] });
}
// Link a typed name to a member: everywhere the typed person stands, the member's key takes the place (same order).
function electiveLinkPerson(pid, member) {
  if (!setupIsTypedPerson(pid) || !member || !member.key) return { ok: false, reason: 'cancelled' };
  const name = setupCap(member.name, 60) || 'Someone';
  return commitSetup((d) => {
    let n = 0;
    Object.keys(setupMapOf(d.electives.slots)).forEach((dk) => Object.keys(d.electives.slots[dk]).forEach((s) => Object.keys(setupMapOf(d.electives.slots[dk][s])).forEach((st) => {
      const row = d.electives.slots[dk][s][st];
      const ppl = setupMapOf(row.people);
      if (!ppl[pid]) return;
      if (!ppl[member.key]) ppl[member.key] = { name, ord: ppl[pid].ord };
      delete ppl[pid];
      row.people = ppl;
      n++;
    })));
    if (!n) return false;
  }, { label: 'Linked ' + name + ' to their sign-in' });
}

// ════════════════════════════════════════════════════════════════════
// ── 11. THE NEW-YEAR WIZARD (P2 §11.3, §7.3, §6.11 — build step 28, session 1: the engine) ──────────────
// ════════════════════════════════════════════════════════════════════
// Five steps (When is camp? · What carries over · Save last year · Clear the scoreboard · Next steps). OWNER-ONLY
// (decision Q8): every entry point asks isOwner() and the rules refuse the claim and the commit from anyone else.
// The screens are session 2 (setup-ui.js); everything they need is here, as functions that say a reason instead of
// throwing, so a caller always has a sentence to show.
//
//   THE CLAIM  setup/meta/wizard = { step, byKey, at, fromEpoch, archiveId?, answers? }, always written whole by a
//              transaction. `answers` is a JSON string (≤ 2,000 chars) holding the device that drives the wizard
//              (`dev`: how a reload knows the claim is its own), the step-1/2 answers and nothing else. A second device,
//              or a director who is not the owner, reads the claim and Watches; the owner's other device may Take over once
//              the driver has been idle 15 minutes (the claim's `at` is refreshed by every step, answer and tap).
//   THE ARCHIVE  step 3: a `pre-wizard` point and a pinned `archive` point, READ BACK and compared (length and hash) before
//              anything can be cleared. Idempotent (an archiveId already in the claim is verified and reused or replaced).
//   THE CLEAR  step 4: ONE atomic multi-path update at the camp root with exactly the paths wizardClearUpdate lists —
//              never members/*. Any refused path refuses all of it. Members' teams follow, one small update each.
//   UNDO  wizardUndo: the newest archive's data AND epoch back in one atomic update (owner-only).
// Nothing here runs until the owner acts; with no claim and no epoch every other engine is untouched.

const WIZARD_IDLE_MS = 15 * 60 * 1000;     // Take over appears only when the driver has been idle this long
const WIZARD_TOUCH_MS = 60 * 1000;         // a tap refreshes the claim's `at` at most this often
const WIZARD_ANSWER_MS = 10 * 1000;        // a changed answer reaches the claim at most this often
const WIZARD_BUSY_MS = 2 * 60 * 1000;      // an open wizard touched in the last 2 minutes holds the auto-reload
const WIZARD_UNDO_DAYS = 14;               // the hub's Undo is offered this long after a run (Past years: while it is the newest archive)
const WIZARD_DRAFT_KEY = 'campWizardDraft';   // lsKey()'d; wiped by clearLocalData and by a new epoch
const WIZARD_DEVICE_KEY = 'campWizardDevice'; // device-wide (like the push device id): which phone drives a claim
const WIZARD_ITEMS = ['schedule', 'games', 'teams', 'counselors', 'photos', 'cleanup', 'meals', 'verses', 'stations', 'stationPeople', 'memberTeams'];
// Step 2's defaults (§11.3): Keep what is a setting, Clear what belongs to last year's people.
const WIZARD_CARRY_DEFAULTS = Object.freeze({ schedule: 'keep', games: 'keep', teams: 'keep', counselors: 'clear', photos: 'clear', cleanup: 'keep', meals: 'clear', verses: 'clear', stations: 'keep', stationPeople: 'clear', memberTeams: 'clear' });
const WIZARD_STATE_CLEAR = ['results', 'brackets', 'brackets4', 'drafts', 'picRounds', 'picSetup', 'bonuses', 'live', 'clocks', 'announcements'];
const WIZARD_DOUBLE_SAME_LEGACY = Object.freeze({ fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 }); // Thursday 5:00 PM until the end of Friday (camp-core's legacy window)
const WIZARD_EPOCH_RE = /^w20[0-9]{6}(-[2-9])?$/;

let wizardCommitInFlight = false;   // the clear (or the undo) is on the wire: all three engines hold their pushes
let wizardOpenNow = false;          // the wizard screen is up on this device (setup-ui.js tells us)
let wizardTouchedAt = 0;            // the last tap on it (the auto-reload holds for 2 minutes after)
let wizardDraft = null;             // { answers, preWizard?, done? } — the memory copy of the device draft
let wizardClaimWroteAt = 0;         // when this device last wrote the claim (a tap refreshes at most once a minute)
let wizardAnswersSentAt = 0;
let wizardAnswersTimer = null;
let wizardAnswersDirty = false;

function wizardHoldsPushes() { return wizardCommitInFlight; }
function wizardBusy() { return wizardCommitInFlight || (wizardOpenNow && Date.now() - wizardTouchedAt < WIZARD_BUSY_MS); }
function wizardSetOpen(on) { wizardOpenNow = !!on; if (on) wizardTouchedAt = Date.now(); }

// The held pushes (an undecided tab's flags, set by tabMayPush while the commit was out) go now: the server's new year is
// adopted, so each diff is against it and sends nothing of last year's.
function wizardReleaseHolds() {
  wizardCommitInFlight = false;
  if (tabWriter !== true) return;
  if (tabHeldState) { tabHeldState = false; pushState(); }
  if (tabHeldConfig) { tabHeldConfig = false; pushConfig(); }
  if (tabHeldSetup) { tabHeldSetup = false; pushSetup(); }
}

function wizardDeviceId() {
  try {
    let id = localStorage.getItem(WIZARD_DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(WIZARD_DEVICE_KEY, id);
    }
    return id;
  } catch (e) { return typeof presenceId === 'string' ? presenceId : 'device-unknown'; }
}

// ── answers (pure) ───────────────────────────────────────────────────

function wizardIsSunday(ymd) {
  if (typeof ymd !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && t.getUTCDay() === 0;
}

function wizardDoubleOk(d) {
  return setupIsMap(d) && Number.isInteger(d.fromDow) && d.fromDow >= 0 && d.fromDow <= 6 && Number.isInteger(d.toDow) && d.toDow >= 0 && d.toDow <= 7
    && Number.isInteger(d.fromMin) && d.fromMin >= 0 && d.fromMin <= 1439 && Number.isInteger(d.toMin) && d.toMin >= 0 && d.toMin <= 1439
    && d.toDow * 1440 + d.toMin > d.fromDow * 1440 + d.fromMin;
}

// What a claim, a draft or a typed form says, as exactly this shape: { weekStart ('' until a Sunday is picked), double ('same' |
// 'none' | a window), carry (every item 'keep' | 'clear') }. Unknown fields drop; a junk value takes its default.
function wizardNormAnswers(raw) {
  const r = setupIsMap(raw) ? raw : {};
  const carry = {};
  WIZARD_ITEMS.forEach((k) => {
    const v = setupIsMap(r.carry) ? r.carry[k] : undefined;
    carry[k] = v === 'keep' || v === 'clear' ? v : WIZARD_CARRY_DEFAULTS[k];
  });
  const dbl = r.double === 'none' ? 'none' : (wizardDoubleOk(r.double) ? { fromDow: r.double.fromDow, fromMin: r.double.fromMin, toDow: r.double.toDow, toMin: r.double.toMin } : 'same');
  return { weekStart: wizardIsSunday(r.weekStart) ? r.weekStart : '', double: dbl, carry };
}

// The double window the new week gets, as setup/meta/double would hold it (null = none). "Same" is last year's: in the legacy
// epoch the printed Thursday 5 PM to the end of Friday, else whatever the week held.
function wizardDoubleValue(choice, cur) {
  if (choice === 'none') return null;
  if (wizardDoubleOk(choice)) return setupClone(choice);
  if (!cur || !cur.epoch) return setupClone(WIZARD_DOUBLE_SAME_LEGACY);
  return wizardDoubleOk(cur.double) ? setupClone(cur.double) : null;
}

// ── the claim (pure reads) ───────────────────────────────────────────

// The claim as a tree holds it, or null: exactly this shape, junk dropped. `dev` is read out of the answers.
function wizardClaimOf(tree) {
  const w = tree && tree.meta ? tree.meta.wizard : null;
  if (!setupIsMap(w)) return null;
  const step = Number(w.step);
  const at = Number(w.at);
  if (!Number.isInteger(step) || step < 1 || step > 5 || typeof w.byKey !== 'string' || !isFinite(at) || at <= 0) return null;
  if (typeof w.fromEpoch !== 'string' || !w.fromEpoch || w.fromEpoch.length > 40) return null;
  let ans = null;
  if (typeof w.answers === 'string' && w.answers.length <= 2000) { try { ans = JSON.parse(w.answers); } catch (e) { ans = null; } }
  return {
    step, byKey: w.byKey, at, fromEpoch: w.fromEpoch,
    archiveId: typeof w.archiveId === 'string' && RP_ID_RE.test(w.archiveId) ? w.archiveId : '',
    dev: setupIsMap(ans) && typeof ans.dev === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(ans.dev) ? ans.dev : '',
    answers: wizardNormAnswers(ans),
  };
}

// The claim value written (always whole). `at` is the server's clock.
function wizardClaimValue(c) {
  const ans = JSON.stringify(Object.assign({ dev: c.dev }, wizardNormAnswers(c.answers)));
  const out = { step: c.step, byKey: c.byKey, at: firebase.database.ServerValue.TIMESTAMP, fromEpoch: c.fromEpoch, answers: ans };
  if (c.archiveId) out.archiveId = c.archiveId;
  return out;
}

function wizardCurrentEpoch() { return (state.meta && typeof state.meta.epoch === 'string' && state.meta.epoch) || 'legacy'; }

// Who has the wizard, for the screen: { state, claim, idleMs, canTakeOver, byName }.
//   none      nobody started one (or the claim is a leftover from another camp year: `stale`, the owner may start over)
//   mine      this device drives it (a reload resumes here)
//   other     the owner's other device drives it and was touched recently: Watch, or Take over once idle 15 minutes
//   watching  not the owner: a read-only line, never a control
function wizardModel(nowMs) {
  const claim = wizardClaimOf(setupTree);
  if (!claim) return { state: 'none', claim: null, idleMs: 0, canTakeOver: false, byName: '' };
  const now = isFinite(nowMs) ? nowMs : serverNow();
  const idleMs = Math.max(0, now - claim.at);
  const byName = setupEditorName(claim.byKey);
  if (claim.fromEpoch !== wizardCurrentEpoch()) return { state: 'stale', claim, idleMs, canTakeOver: isOwner(), byName };
  if (!isOwner()) return { state: 'watching', claim, idleMs, canTakeOver: false, byName };
  if (claim.dev && claim.dev === wizardDeviceId()) return { state: 'mine', claim, idleMs, canTakeOver: false, byName };
  return { state: 'other', claim, idleMs, canTakeOver: idleMs >= WIZARD_IDLE_MS, byName };
}

// ── the device draft (§5.11, ux-R5) ──────────────────────────────────

function wizardDraftRead() {
  if (wizardDraft) return wizardDraft;
  let d = null;
  try { d = JSON.parse(localStorage.getItem(lsKey(WIZARD_DRAFT_KEY)) || 'null'); } catch (e) { d = null; }
  wizardDraft = setupIsMap(d) && d.v === 1
    ? { answers: wizardNormAnswers(d.answers), preWizard: typeof d.preWizard === 'string' && RP_ID_RE.test(d.preWizard) ? d.preWizard : '', done: setupIsMap(d.done) ? d.done : null }
    : { answers: wizardNormAnswers({}), preWizard: '', done: null };
  return wizardDraft;
}

function wizardDraftWrite() {
  const d = wizardDraftRead();
  try { localStorage.setItem(lsKey(WIZARD_DRAFT_KEY), JSON.stringify({ v: 1, answers: d.answers, preWizard: d.preWizard, done: d.done })); } catch (e) { /* private mode: the claim still holds the answers */ }
}

// A new camp year (or a sign-out) forgets it: app.js epochDeviceReset calls this.
function wizardDraftForget() {
  wizardDraft = null;
  clearTimeout(wizardAnswersTimer); wizardAnswersTimer = null; wizardAnswersDirty = false;
  try { localStorage.removeItem(lsKey(WIZARD_DRAFT_KEY)); } catch (e) { /* fine */ }
}

// The answers in force: this device's draft; with none, a claim's.
function wizardAnswers() { return wizardDraftRead().answers; }

// ── the gates ────────────────────────────────────────────────────────

// Every refusal is said BEFORE anything is written: owner, loading, denied, schema, tab, offline.
function wizardGate() {
  const g = ownerGate('set up the new year');
  if (!g.ok) return { reason: 'owner', message: g.reason };
  if (!setupRef || !setupReady) return { reason: 'loading' };
  if (setupDenied || setupWriteRefused) return { reason: 'denied' };
  if (setupSchemaTooNew()) return { reason: 'schema' };
  if (!tabMayPush('setup')) return { reason: 'tab' }; // a view-only second tab never writes
  if (!restoreOnline()) return { reason: 'offline' };
  return null;
}

// The freeze (§10.6): not inside a camp week, unless the owner says so in words.
function wizardFreeze(o) {
  if (o.overrideCampWeek) return null;
  const wk = campWeek();
  if (wk.phase === 'during') return { reason: 'camp-week' };
  if (wk.phase === 'unset') {
    if (o.campRunning === undefined) return { reason: 'ask-camp-week' };
    if (o.campRunning === true) return { reason: 'camp-week' };
  }
  return null;
}

async function wizardTxn(fn) {
  setupPending++;
  setupNotify('sync');
  try {
    return await setupRef.child('meta/wizard').transaction(fn, null, false);
  } finally {
    setupPending = Math.max(0, setupPending - 1);
    setupNotify('sync');
    if (typeof setupIdleTick === 'function') setupIdleTick(); // the claim's own snapshot was turned away while it was in flight: read it now
  }
}

// Update MY claim by a mutator over its parsed form ({} → the new fields); refused when it is not mine any more. One at a
// time, in the order asked (an answer's send and the step change after it must not race, and a later step that checks the
// engines are quiet waits for the claim writes still out: wizardSettled).
let wizardChain = Promise.resolve();
function wizardSettled() { return wizardChain; }
function wizardClaimUpdate(mutate) {
  const run = wizardChain.then(() => wizardClaimUpdateNow(mutate));
  wizardChain = run.then(() => {}, () => {});
  return run;
}
async function wizardClaimUpdateNow(mutate) {
  const dev = wizardDeviceId();
  const gate = wizardGate();
  if (gate) return Object.assign({ ok: false }, gate);
  let seen = null;
  let res;
  try {
    res = await wizardTxn((cur) => {
      const c = wizardClaimOf({ meta: { wizard: cur } });
      seen = c;
      if (!c || c.dev !== dev || c.fromEpoch !== wizardCurrentEpoch()) return undefined;
      return wizardClaimValue(Object.assign({}, c, mutate(c), { dev }));
    });
  } catch (e) { return { ok: false, reason: e && e.code === 'PERMISSION_DENIED' ? 'refused' : 'failed', code: e && e.code }; }
  if (!res || !res.committed) return { ok: false, reason: seen && seen.dev !== dev ? 'not-mine' : 'gone' };
  wizardClaimWroteAt = Date.now();
  return { ok: true, claim: wizardClaimOf({ meta: { wizard: res.snapshot.val() } }) };
}

// ── starting, resuming, taking over, leaving ─────────────────────────

// Start the new-year setup, or resume it on the device that already drives it. If the camp's schedule isn't edited here
// yet, the first action is A1 for the schedule (with its pre-seed point): one front door (ux-R4).
// → { ok, started | resumed } or { ok:false, reason } — owner, loading, denied, schema, tab, offline, other (the claim
// belongs to the owner's other device: `model` says how long it has been idle), camp-week, ask-camp-week, a1 (A1 said
// no: `a1` is its reason), failed, refused. `opts`: { campRunning, overrideCampWeek }.
async function wizardStart(opts) {
  const o = opts || {};
  const refuse = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  const gate = wizardGate();
  if (gate) return refuse(gate.reason, gate);
  const model = wizardModel();
  if (model.state === 'mine') { wizardTouchedAt = Date.now(); return { ok: true, resumed: true, claim: model.claim }; }
  if (model.state === 'other') return refuse('other', { model });
  const frozen = wizardFreeze(o);
  if (frozen) return refuse(frozen.reason);
  if (!setupOn('schedule')) {
    const r = await setupTurnOn(['schedule'], { campRunning: o.campRunning, overrideCampWeek: o.overrideCampWeek });
    if (!r.ok && r.reason !== 'already') return refuse('a1', { a1: r.reason, message: r.message });
  }
  const dev = wizardDeviceId();
  const key = identityKey(authUser);
  const fromEpoch = wizardCurrentEpoch();
  const val = wizardClaimValue({ step: 1, byKey: key, fromEpoch, answers: wizardAnswers(), dev, archiveId: '' });
  let res;
  try {
    res = await wizardTxn((cur) => {
      const c = wizardClaimOf({ meta: { wizard: cur } });
      if (c && c.fromEpoch === fromEpoch) return undefined; // somebody holds a live claim: never overwritten from here
      return val; // none, or a leftover from another year
    });
  } catch (e) { return refuse(e && e.code === 'PERMISSION_DENIED' ? 'refused' : 'failed', { code: e && e.code }); }
  if (!res || !res.committed) {
    const now = wizardClaimOf({ meta: { wizard: res && res.snapshot ? res.snapshot.val() : null } });
    if (now && now.dev === dev) { wizardTouchedAt = Date.now(); return { ok: true, resumed: true, claim: now }; }
    return refuse('other', { model: wizardModel() });
  }
  wizardClaimWroteAt = Date.now();
  wizardTouchedAt = Date.now();
  return { ok: true, started: true, claim: wizardClaimOf({ meta: { wizard: res.snapshot.val() } }) };
}

// Take the wizard over from the owner's other device. Allowed once that driver has been idle 15 minutes (`opts.force`: the
// owner's own "Take over anyway", for a phone that is gone). The answers made there come with it (`inherited`); the screen
// asks "Use these / Start over". The step and the archive carry over.
async function wizardTakeOver(opts) {
  const o = opts || {};
  const gate = wizardGate();
  if (gate) return Object.assign({ ok: false }, gate);
  const model = wizardModel();
  if (model.state === 'none') return { ok: false, reason: 'gone' };
  if (model.state === 'mine') return { ok: true, claim: model.claim, already: true };
  if (model.state === 'other' && !model.canTakeOver && !o.force) return { ok: false, reason: 'busy', model };
  const dev = wizardDeviceId();
  const key = identityKey(authUser);
  const fromEpoch = wizardCurrentEpoch();
  let taken = null;
  let res;
  try {
    res = await wizardTxn((cur) => {
      const c = wizardClaimOf({ meta: { wizard: cur } });
      if (!c) return undefined;
      taken = c;
      return wizardClaimValue(Object.assign({}, c, { byKey: key, dev, fromEpoch: c.fromEpoch === fromEpoch ? c.fromEpoch : fromEpoch, step: c.fromEpoch === fromEpoch ? c.step : 1 }));
    });
  } catch (e) { return { ok: false, reason: e && e.code === 'PERMISSION_DENIED' ? 'refused' : 'failed', code: e && e.code }; }
  if (!res || !res.committed || !taken) return { ok: false, reason: 'gone' };
  const d = wizardDraftRead();
  d.answers = taken.answers; // inherit what the other device chose
  wizardDraftWrite();
  wizardClaimWroteAt = Date.now();
  wizardTouchedAt = Date.now();
  return { ok: true, claim: wizardClaimOf({ meta: { wizard: res.snapshot.val() } }), inherited: taken.answers, from: model.state };
}

// Give the claim up (Cancel, or Start over on a stale one): the claim goes, the device draft stays.
async function wizardRelease() {
  const model = wizardModel();
  if (model.state === 'none') return { ok: true, noop: true };
  if (model.state !== 'mine' && model.state !== 'stale') return { ok: false, reason: 'not-mine' };
  const gate = wizardGate();
  if (gate) return Object.assign({ ok: false }, gate);
  try {
    const res = await wizardTxn((cur) => (cur === null ? undefined : null));
    return { ok: true, released: !!(res && res.committed) };
  } catch (e) { return { ok: false, reason: e && e.code === 'PERMISSION_DENIED' ? 'refused' : 'failed', code: e && e.code }; }
}

// May the wizard go to step `n`? 1 → 2 needs the camp's Sunday; → 4 needs a verified archive in the claim. Pure.
function wizardCanGo(n, claim, answers) {
  if (!Number.isInteger(n) || n < 1 || n > 4) return { ok: false, reason: 'step' };
  if (n >= 2 && !wizardNormAnswers(answers).weekStart) return { ok: false, reason: 'dates' };
  if (n >= 4 && !(claim && claim.archiveId)) return { ok: false, reason: 'archive' };
  return { ok: true };
}

// Move to a step (Back is allowed until step 4 runs). The answers go with it, whole.
async function wizardSetStep(n) {
  const model = wizardModel();
  if (model.state !== 'mine') return { ok: false, reason: 'not-mine' };
  const can = wizardCanGo(n, model.claim, wizardAnswers());
  if (!can.ok) return can;
  wizardTouchedAt = Date.now();
  clearTimeout(wizardAnswersTimer); wizardAnswersTimer = null; wizardAnswersDirty = false;
  const answers = wizardAnswers();
  return wizardClaimUpdate(() => ({ step: n, answers }));
}

// An answer changed: kept on this device at once and in the claim at most every 10 s (a step change or wizardFlushAnswers
// sends it sooner), so a reload resumes with it and a Take over inherits it. `patch` is a partial of the answers shape.
function wizardAnswer(patch) {
  const d = wizardDraftRead();
  const p = setupIsMap(patch) ? patch : {};
  d.answers = wizardNormAnswers({
    weekStart: p.weekStart !== undefined ? p.weekStart : d.answers.weekStart,
    double: p.double !== undefined ? p.double : d.answers.double,
    carry: Object.assign({}, d.answers.carry, setupIsMap(p.carry) ? p.carry : {}),
  });
  wizardDraftWrite();
  wizardTouchedAt = Date.now();
  wizardAnswersDirty = true;
  const wait = WIZARD_ANSWER_MS - (Date.now() - wizardAnswersSentAt);
  if (wait <= 0) { wizardFlushAnswers(); return d.answers; }
  if (!wizardAnswersTimer) wizardAnswersTimer = setTimeout(() => { wizardAnswersTimer = null; wizardFlushAnswers(); }, wait);
  return d.answers;
}

async function wizardFlushAnswers() {
  clearTimeout(wizardAnswersTimer); wizardAnswersTimer = null;
  if (!wizardAnswersDirty) return { ok: true, noop: true };
  if (wizardModel().state !== 'mine') return { ok: false, reason: 'not-mine' };
  wizardAnswersDirty = false;
  wizardAnswersSentAt = Date.now();
  const answers = wizardAnswers();
  const r = await wizardClaimUpdate(() => ({ answers }));
  if (!r.ok) wizardAnswersDirty = true;
  return r;
}

// Any tap on the wizard: this device is awake (the reload holds) and the claim's `at` is refreshed at most once a minute, so
// Take over only ever appears for a driver who really left.
function wizardTouch() {
  wizardTouchedAt = Date.now();
  if (Date.now() - wizardClaimWroteAt < WIZARD_TOUCH_MS || wizardModel().state !== 'mine') return Promise.resolve({ ok: true, noop: true });
  wizardClaimWroteAt = Date.now();
  return wizardClaimUpdate(() => ({}));
}

// "Start over" after a Take over: back to the defaults and the first step.
async function wizardStartOver() {
  const d = wizardDraftRead();
  d.answers = wizardNormAnswers({});
  d.preWizard = '';
  wizardDraftWrite();
  const answers = d.answers;
  return wizardClaimUpdate(() => ({ step: 1, answers, archiveId: '' }));
}

// This phone's own writes (a push a tap just queued, an acknowledgement on its way) are finished before a step that insists the
// engines are quiet looks: wait for them, a few seconds at most (a parked refusal never clears: the step then says busy).
async function wizardWaitQuiet(ms) {
  const end = Date.now() + (ms || 8000);
  for (;;) {
    flushPendingPush();
    if (pendingWritesTotal() === 0 && !hasUnconfirmedLocalWork() && !setupBisecting && !setupPushTimer) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 60));
  }
}

// ── step 3: save last year (§7.3) ────────────────────────────────────

// The year the outgoing week was: its Sunday's year, else the year of its last scored change, else this year.
function wizardOutgoingYear() {
  const ws = typeof setupWeekStart === 'function' ? setupWeekStart() : null;
  if (ws) return ws.slice(0, 4);
  const last = state.meta && state.meta.lastDataChangeAt;
  const y = typeof last === 'string' ? last.slice(0, 4) : (typeof last === 'number' && isFinite(last) ? String(new Date(last).getUTCFullYear()) : '');
  return /^20\d\d$/.test(y) ? y : campDateStr().slice(0, 4);
}

// "Ferocious Foxes won with 211 points" — for the archive's note. Directors only (the points guard); '' with nothing scored.
function wizardChampionNote() {
  if (!standingsVisible()) return '';
  const counts = medalCounts();
  const ranked = rankTeamsByPoints(counts);
  const top = ranked[0];
  if (!top || !(counts[top.id] && counts[top.id].points > 0)) return '';
  const n = counts[top.id].points;
  const tied = ranked[1] && counts[ranked[1].id] && counts[ranked[1].id].points === n;
  return (tied ? 'Tied for first with ' + n + ' points' : String(top.name || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 60) + ' won with ' + n + ' points').slice(0, 200);
}

// What a body (or the live state) holds that step 3's receipt and step 4's list count. Pure over a state-like object.
function wizardCounts(st, notice) {
  const s = setupIsMap(st) ? st : {};
  const size = (v) => (setupIsMap(v) ? Object.keys(v).length : 0);
  const n = setupIsMap(notice) ? notice : (setupIsMap(s.notice) ? s.notice : null);
  return {
    results: size(s.results),
    bonuses: size(s.bonuses),
    announcements: size(s.announcements),
    brackets: size(s.brackets) + size(s.brackets4),
    noticePosted: !!(n && n.status === 'posted'),
  };
}

async function wizardVerifyArchive(rid) {
  try { return await restoreVerify(rid); } catch (e) { return { ok: false, reason: 'offline' }; }
}

// Step 3. Fresh reads first (what is saved is what the server holds), then: an archiveId already in the claim that still
// verifies against the data is REUSED; otherwise the `pre-wizard` point (once per run) and a pinned `archive` point are
// written, the archive READ BACK and compared (length and hash), and its id recorded in the claim. Back-then-Next, a reload,
// a failed read-back's Try again and a Take over all land here, so a create-only rule can never strand the wizard.
// → { ok, rid, reused?, label, note, counts } or { ok:false, reason: owner | not-mine | busy | offline | save | verify | claim }.
async function wizardArchive() {
  const model = wizardModel();
  if (!isOwner()) return { ok: false, reason: 'owner', message: ownerGate('set up the new year').reason };
  if (model.state !== 'mine') return { ok: false, reason: 'not-mine' };
  const gate = wizardGate();
  if (gate) return Object.assign({ ok: false }, gate);
  await wizardFlushAnswers(); // the answers reach the claim first
  await wizardSettled();
  await wizardWaitQuiet();
  const pre = await restorePreflight();
  if (!pre.ok) return { ok: false, reason: pre.reason };
  const claim = wizardModel().claim;
  if (claim && claim.archiveId) {
    const v = await wizardVerifyArchive(claim.archiveId);
    if (v.ok && v.row.hash === restoreHash(restoreBodyObject())) {
      return { ok: true, rid: claim.archiveId, reused: true, label: v.row.label, note: v.row.note, counts: wizardCounts(v.body.state) };
    }
  }
  const body = restoreBodyObject();
  const d = wizardDraftRead();
  if (!d.preWizard) {
    const p = await restoreSave('pre-wizard', 'Before the new-year setup', { requireOnline: true, body });
    if (!p.ok) return { ok: false, reason: p.reason === 'offline' ? 'offline' : 'save', detail: p.reason };
    d.preWizard = p.rid;
    wizardDraftWrite();
  }
  const year = wizardOutgoingYear();
  const label = year + ' week (' + CAMP.id + ')';
  const note = wizardChampionNote();
  const rid = restoreArchiveId(body.epoch, campDateStr());
  const a = await restoreSave('archive', label, { requireOnline: true, id: rid, note, pinned: true, body });
  if (!a.ok) return { ok: false, reason: a.reason === 'offline' ? 'offline' : 'save', detail: a.reason };
  const v = await wizardVerifyArchive(rid);
  if (!v.ok) return { ok: false, reason: 'verify', detail: v.reason, rid };
  const c = await wizardClaimUpdate(() => ({ archiveId: rid }));
  if (!c.ok) return { ok: false, reason: 'claim', detail: c.reason };
  return { ok: true, rid, reused: false, label, note, counts: wizardCounts(v.body.state) };
}

// ── step 4: the clear ────────────────────────────────────────────────

// The new epoch: w<YYYYMMDD> in camp time, `-2`… when that is today's own and already taken.
function wizardNewEpoch(ymd, cur) {
  const base = 'w' + String(ymd || campDateStr()).replace(/-/g, '');
  if (cur !== base) return base;
  for (let i = 2; i <= 9; i++) if (cur !== base + '-' + i) return base + '-' + i;
  return base + '-9';
}

// The updates of step 4, root-relative — EXACTLY what the clear writes, never members/*. PURE over `inp`:
//   { answers, newEpoch, ts (the server timestamp placeholder), state (teams, notice, meta, results…), tree (the canonical setup
//     tree), config, curMeta ({epoch, double}), requestKeys, nowIso }
// → { ok, updates, counts, problems:[] } (a roster that is not whole, or no Sunday picked, refuses: nothing is half-built).
function wizardClearUpdate(inp) {
  const a = wizardNormAnswers(inp.answers);
  const carry = a.carry;
  const st = setupIsMap(inp.state) ? inp.state : {};
  const tree = setupIsMap(inp.tree) ? inp.tree : {};
  const problems = [];
  if (!a.weekStart) problems.push('dates');
  const teams = Array.isArray(st.teams) ? st.teams : null;
  if (!teams || !rosterIsWhole(teams)) problems.push('teams');
  if (problems.length) return { ok: false, problems, updates: {}, counts: wizardCounts(st) };
  const u = {};
  WIZARD_STATE_CLEAR.forEach((k) => { u['state/' + k] = null; });
  u['state/meta/lastDataChangeAt'] = null;
  u['state/meta/epoch'] = inp.newEpoch;
  u['state/meta/epochAt'] = inp.ts;
  if (setupIsMap(st.notice) && st.notice.status === 'posted') u['state/notice/status'] = 'draft';
  // Teams, per field (a colleague's rename elsewhere is not overwritten by a whole roster).
  teams.forEach((t, i) => {
    const p = 'state/teams/' + i + '/';
    if (carry.counselors === 'clear' && t.counselor !== undefined && t.counselor !== '') u[p + 'counselor'] = null;
    if (carry.photos === 'clear' && t.photoV !== undefined) u[p + 'photoV'] = null;
    if (carry.teams === 'clear') {
      const dflt = DEFAULT_TEAM_NAMES[i];
      if (dflt !== undefined && t.name !== dflt) u[p + 'name'] = dflt;
      ['short', 'emoji', 'color'].forEach((f) => { if (t[f] !== undefined) u[p + f] = null; });
    }
  });
  // The week's own settings.
  const meta = setupIsMap(tree.meta) ? tree.meta : {};
  u['setup/meta/epoch'] = inp.newEpoch;
  u['setup/meta/epochAt'] = inp.ts;
  u['setup/meta/weekStart'] = a.weekStart;
  u['setup/meta/double'] = wizardDoubleValue(a.double, inp.curMeta);
  u['setup/meta/wizard'] = null;
  // What carries over. A section that is off is the original week, which can't be emptied: Clear turns it on, empty.
  let schedule = tree;
  if (carry.schedule === 'clear') {
    const seed = buildSeed(CAMP, ['schedule']);
    RP_SETUP_KEYS.schedule.forEach((k) => { u['setup/' + k] = seed[k] !== undefined ? setupClone(seed[k]) : null; });
    schedule = normalizeSetup(setupClone(Object.assign({}, tree, seed)));
  }
  const on = setupIsMap(meta.on) ? meta.on : {};
  const empty = (s, paths) => {
    paths.forEach((p) => { u[p] = null; });
    if (on[s] !== true) u['setup/meta/on/' + s] = true;
  };
  if (carry.meals === 'clear') empty('meals', ['setup/meals']);
  if (carry.verses === 'clear') empty('verses', ['setup/verses']);
  if (carry.cleanup === 'clear') empty('cleanup', ['setup/cleanup']);
  if (CAMP.features && CAMP.features.electives) {
    if (carry.stations === 'clear') empty('electives', ['setup/electives']);
    else if (carry.stationPeople === 'clear') {
      const slots = setupIsMap(tree.electives) && setupIsMap(tree.electives.slots) ? tree.electives.slots : {};
      Object.keys(slots).forEach((dk) => Object.keys(setupMapOf(slots[dk])).forEach((sl) => Object.keys(setupMapOf(slots[dk][sl])).forEach((stId) => {
        const rec = slots[dk][sl][stId];
        if (setupIsMap(rec) && rec.people !== undefined) u['setup/electives/slots/' + dk + '/' + sl + '/' + stId + '/people'] = null;
      })));
      if (on.electives !== true) u['setup/meta/on/electives'] = true;
    }
  }
  // Games: the app's own catalog, or the kept one with a link wherever the schedule no longer holds it.
  if (carry.games === 'clear' || carry.schedule === 'clear') {
    const cfg = carry.games === 'clear' ? configForSync(CAMP.defaultConfig()) : setupClone(configForSync(inp.config));
    const resolve = (dow) => resolveDay(schedule, dow).map(setupRichBlock);
    const plan = setupGameAttachments(cfg, resolve, CAMP);
    if (plan.ops.length) setupApplyGameAttachments(cfg, plan.ops);
    cfg.updatedAt = inp.nowIso;
    u.config = cfg;
  }
  // Everything else the year held.
  u.campers = null;
  u.revealPublic = null;
  u.revealFull = null;
  (inp.requestKeys || []).forEach((k) => { u['accessRequests/' + k] = null; });
  const counts = wizardCounts(st);
  counts.requests = (inp.requestKeys || []).length;
  return { ok: true, updates: u, counts, problems: [] };
}

// A preflight read of the member list: who has a team (the counselors' teams follow the clear) and which rows are incomplete
// (the rules validate a whole member record, so one row missing role / addedBy / addedAt would refuse its own write). Never in the
// atomic update (sec-F4).
async function wizardMembersPreflight() {
  try {
    const snap = await restoreRootRef().child('members').once('value');
    const v = snap.val();
    const withTeam = [];
    const incomplete = [];
    if (setupIsMap(v)) {
      Object.keys(v).forEach((k) => {
        const r = v[k];
        if (k === OWNER_MEMBER_KEY || !setupIsMap(r)) return;
        const name = typeof r.name === 'string' && r.name ? r.name.slice(0, 60) : identityFromKey(k);
        if (typeof r.role !== 'string' || typeof r.addedBy !== 'string' || r.addedAt === undefined || r.addedAt === null) incomplete.push({ key: k, name });
        if (r.teamId) withTeam.push({ key: k, name });
      });
    }
    return { ok: true, withTeam, incomplete };
  } catch (e) { return { ok: false, reason: 'offline', withTeam: [], incomplete: [] }; }
}

// Best-effort, after the clear: one small update per member with a team, the owner skipped (rules#5). A row that refuses is
// listed, never retried in a loop. → { cleared, failed: [{ key, name }] }
async function wizardTakeMembersOff(list) {
  const out = { cleared: 0, failed: [] };
  for (const m of list || []) {
    if (!m || m.key === OWNER_MEMBER_KEY) continue;
    try { await restoreRootRef().update({ ['members/' + m.key + '/teamId']: null }); out.cleared++; } catch (e) { out.failed.push({ key: m.key, name: m.name }); }
  }
  return out;
}

// Adopt what the server holds after the clear or the undo: state, config and setup read with once() and taken as the new
// confirmed baselines (nothing is unsent, so nothing is lost), the setup tree through the epoch-aware adopt.
async function wizardAdoptFresh() {
  const [st, cf, su] = await Promise.all([
    fbRef ? fbRef.once('value') : null,
    fbConfigRef ? fbConfigRef.once('value') : null,
    setupRef ? setupRef.once('value') : null,
  ]);
  if (st) handleRemoteSnapshot(st.val() || {});
  if (cf && cf.val()) applyRemoteConfig(cf.val());
  if (su) setupAdoptNewSnapshot(su.val());
}

// Step 4. Re-checks everything, then the one atomic update. → { ok, epoch, counts, members: { cleared, failed, incomplete },
// archiveId } or { ok:false, reason }: owner · not-mine · dates · teams · camp-week · ask-camp-week · loading · denied · tab · offline ·
// busy (something of this phone's is unsent) · archive (not saved and checked yet) · requests · refused (nothing changed) · failed.
// `opts`: { campRunning, overrideCampWeek }.
async function wizardClear(opts) {
  const o = opts || {};
  const refuse = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  if (wizardCommitInFlight) return refuse('busy');
  const gate = wizardGate();
  if (gate) return refuse(gate.reason, gate);
  const model = wizardModel();
  if (model.state !== 'mine') return refuse('not-mine');
  const frozen = wizardFreeze(o);
  if (frozen) return refuse(frozen.reason);
  await wizardFlushAnswers();
  await wizardSettled();
  await wizardWaitQuiet();
  if (!wizardClaimOf(setupTree) || !wizardClaimOf(setupTree).archiveId) return refuse('archive');
  // 1. Caught up, and the archive still matches the data (sync-F18a): anything written since step 3 gets a fresh point first.
  const pre = await restorePreflight();
  if (!pre.ok) return refuse(pre.reason === 'busy' ? 'busy' : pre.reason);
  let archiveId = model.claim.archiveId;
  const v = await wizardVerifyArchive(archiveId);
  if (!v.ok || v.row.hash !== restoreHash(restoreBodyObject())) {
    const fresh = await wizardArchive();
    if (!fresh.ok) return refuse('archive', { detail: fresh.reason });
    archiveId = fresh.rid;
  }
  const claim = wizardModel().claim;
  if (!claim || claim.archiveId !== archiveId) return refuse('not-mine');
  // 2. The things the update needs from the server.
  let requestKeys = [];
  try {
    const rs = await restoreRootRef().child('accessRequests').once('value');
    requestKeys = setupIsMap(rs.val()) ? Object.keys(rs.val()).filter((k) => /^[^.#$\[\]\/]{1,200}$/.test(k)) : [];
  } catch (e) { return refuse('requests'); }
  const members = await wizardMembersPreflight();
  if (!members.ok) return refuse('offline');
  // 3. Nothing of this phone's in flight, and the answers are the claim's (the draft is newer: it is what the screen shows).
  const answers = wizardAnswers();
  const plan = wizardClearUpdate({
    answers, newEpoch: wizardNewEpoch(campDateStr(), (state.meta && state.meta.epoch) || ''), ts: firebase.database.ServerValue.TIMESTAMP,
    state, tree: setupCanon(setupTree), config: state.config,
    curMeta: { epoch: (state.meta && state.meta.epoch) || '', double: setupTree.meta && setupTree.meta.double },
    requestKeys, nowIso: new Date().toISOString(),
  });
  if (!plan.ok) return refuse(plan.problems[0], { problems: plan.problems });
  if (pendingWritesTotal() > 0 || hasUnconfirmedLocalWork() || setupBisecting) return refuse('busy');
  const carryMembers = answers.carry.memberTeams === 'clear' ? members.withTeam : [];
  wizardCommitInFlight = true; // all three engines hold their pushes from here
  setupPending++;
  setupNotify('sync');
  try {
    try {
      await restoreRootRef().update(plan.updates);
    } catch (e) {
      return refuse(e && e.code === 'PERMISSION_DENIED' ? 'refused' : 'failed', { code: e && e.code }); // nothing changed
    }
    try { await wizardAdoptFresh(); } catch (e) { /* the live listeners bring the new year in; the commit itself is done */ }
  } finally {
    setupPending = Math.max(0, setupPending - 1);
    setupNotify('sync');
    wizardReleaseHolds();
  }
  if (typeof pushRepublishSchedule === 'function') { try { pushRepublishSchedule({ force: true }); } catch (e) { /* alerts catch up on the next editor load */ } }
  // 4. Then, best-effort, the counselors' teams.
  const moved = await wizardTakeMembersOff(carryMembers);
  const epoch = plan.updates['state/meta/epoch'];
  const done = { epoch, at: Date.now(), archiveId, counts: plan.counts, members: { cleared: moved.cleared, failed: moved.failed, incomplete: members.incomplete } };
  const d = wizardDraftRead();
  d.done = { epoch, at: done.at, archiveId, counts: plan.counts, cleared: moved.cleared, failed: moved.failed.length };
  d.preWizard = '';
  wizardDraftWrite();
  setupNotify('tree');
  return Object.assign({ ok: true }, done);
}

// ── Undo the new-year setup (§7.3, sync-F7) ──────────────────────────

// The newest archive is offered while no newer one exists and the epoch it was taken under is not the one in force. → { rid, row,
// days (since the run), recent (inside the hub's 14 days) } or null. Reads the list: online only.
async function wizardUndoOffer() {
  let rows;
  try { rows = await restoreList(); } catch (e) { return null; }
  const row = rows.find((r) => r.kind === 'archive');
  if (!row) return null;
  if ((row.epoch || '') === ((state.meta && state.meta.epoch) || '')) return null; // taken under this year's own epoch: nothing to undo
  const days = Math.floor(Math.max(0, serverNow() - ((state.meta && state.meta.epochAt) || row.at)) / 86400000);
  return { rid: row.rid, row, days, recent: days <= WIZARD_UNDO_DAYS };
}

// The updates of the undo: root-relative, PURE over the archive's body. Every archived state section including the scores, the
// epoch pair back to the archived values (DELETED for the legacy epoch, which re-enables the 2026 constant pin), the setup
// sections and the week's own settings, the games. Members' teams, campers, requests and the reveal nodes stay as they are.
function wizardUndoUpdate(body, ctx) {
  const st = setupIsMap(body.state) ? body.state : {};
  const setup = setupIsMap(body.setup) ? body.setup : {};
  const wk = setupIsMap(setup.meta) ? setup.meta : {};
  const stMeta = setupIsMap(st.meta) ? st.meta : {};
  const u = {};
  WIZARD_STATE_CLEAR.forEach((k) => { u['state/' + k] = st[k] !== undefined ? setupClone(st[k]) : null; });
  if (setupIsMap(st.notice)) u['state/notice'] = setupClone(st.notice);
  if (Array.isArray(st.teams) && rosterIsWhole(st.teams)) {
    u['state/teams'] = teamsFromBackup(setupClone(st.teams)).map((t, i) => (teamPhotoVValid(st.teams[i] && st.teams[i].photoV) ? Object.assign({}, t, { photoV: st.teams[i].photoV }) : t));
  }
  const epoch = typeof body.epoch === 'string' && WIZARD_EPOCH_RE.test(body.epoch) ? body.epoch : null;
  const epochAt = typeof stMeta.epochAt === 'number' && stMeta.epochAt > 0 ? stMeta.epochAt : null;
  u['state/meta/epoch'] = epoch;
  u['state/meta/epochAt'] = epoch ? epochAt : null;
  u['state/meta/lastDataChangeAt'] = stMeta.lastDataChangeAt !== undefined ? stMeta.lastDataChangeAt : null;
  SETUP_SECTIONS.forEach((s) => {
    RP_SETUP_KEYS[s].forEach((k) => { u['setup/' + k] = setup[k] !== undefined ? setupClone(setup[k]) : null; });
    const wasOn = (body.sectionsOn || []).indexOf(s) !== -1;
    const nowOn = ctx && ctx.on && ctx.on[s] === true;
    if (wasOn) { if (!nowOn) u['setup/meta/on/' + s] = true; }
    else if (nowOn) u['setup/meta/on/' + s] = RP_SETUP_KEYS[s].some((k) => setup[k] !== undefined) ? false : null; // off again; never "turned off" if it was never on (that would stop its first seed)
  });
  u['setup/meta/epoch'] = epoch;
  u['setup/meta/epochAt'] = epoch ? epochAt : null;
  ['weekStart', 'double', 'finaleDow'].forEach((f) => { u['setup/meta/' + f] = wk[f] !== undefined ? setupClone(wk[f]) : null; });
  u['setup/meta/wizard'] = null;
  u.config = configForSync(setupClone(body.config));
  return u;
}

// Undo the new-year setup: owner-only, the restore preconditions (a director's writer tab, online, nothing in flight, fresh reads), a
// `pre-restore` point, then ONE atomic root update. Every device sees an epoch change and runs the §6.11 reset and stranding.
// → { ok, epoch (the one back in force, '' = legacy), pre } or { ok:false, reason }: owner · not-newest · nothing · verify ·
// pre-restore · busy · offline · refused · failed.
async function wizardUndo(rid) {
  const refuse = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  const g = ownerGate('undo the new-year setup');
  if (!g.ok) return refuse('owner', { message: g.reason });
  if (wizardCommitInFlight) return refuse('busy');
  const gate = wizardGate();
  if (gate) return refuse(gate.reason, gate);
  const offer = await wizardUndoOffer();
  if (!offer) return refuse('nothing');
  if (offer.rid !== rid) return refuse('not-newest');
  await wizardWaitQuiet();
  const pre = await restorePreflight();
  if (!pre.ok) return refuse(pre.reason);
  const v = await wizardVerifyArchive(rid);
  if (!v.ok) return refuse('verify', { detail: v.reason });
  const saved = await restoreSave('pre-restore', 'Before undoing the new-year setup', { requireOnline: true });
  if (!saved.ok) return refuse(saved.reason === 'offline' ? 'offline' : 'pre-restore', { detail: saved.reason });
  const updates = wizardUndoUpdate(v.body, { on: setupTree.meta && setupTree.meta.on });
  if (pendingWritesTotal() > 0 || hasUnconfirmedLocalWork() || setupBisecting) return refuse('busy');
  wizardCommitInFlight = true;
  setupPending++;
  setupNotify('sync');
  try {
    try { await restoreRootRef().update(updates); }
    catch (e) { return refuse(e && e.code === 'PERMISSION_DENIED' ? 'refused' : 'failed', { code: e && e.code }); }
    try { await wizardAdoptFresh(); } catch (e) { /* the listeners bring it in */ }
  } finally {
    setupPending = Math.max(0, setupPending - 1);
    setupNotify('sync');
    wizardReleaseHolds();
  }
  if (typeof pushRepublishSchedule === 'function') { try { pushRepublishSchedule({ force: true }); } catch (e) { /* catches up */ } }
  setupNotify('tree');
  return { ok: true, epoch: updates['state/meta/epoch'] || '', pre: saved.rid };
}

// ════════════════════════════════════════════════════════════════════
// PEOPLE: who is on the list, who is asking to join, who is blocked (setup-rebuild-spec §11.8, §11.18 — Step 25)
// ════════════════════════════════════════════════════════════════════
// The data half of the People screen (setup-ui.js section 14) and of the denied screen's Ask to join (app.js). Same data as the
// retired Members drawer (<root>/members, through the same createMemberIfAbsent / memberRecord / planMemberAdd), plus the two
// nodes R1 published for walk-ups:
//   <root>/accessRequests/<key> = { name ≤ 60, note? ≤ 200, at: server time }   a signed-in NON-member writes their OWN row, only
//        while a director has switched asking on (setup/meta/joinOpen), not blocked, at most one write a minute; editors read the
//        list and may delete any row; the requester may delete theirs a minute after asking.
//   <root>/accessBlocked/<key> = { at, byKey }                                  editors only.
// Everything a requester typed is UNTRUSTED (sec-F8): names and notes are cleaned and cut to the rules' limits on the way in
// (pplNormRequest) and escaped on the way out (esc(), setup-ui.js). The list is an editor-only `.on('value')` over the 25 newest
// rows (`.indexOn: ['at']`) that degrades only itself; a refused read never touches fbRef / syncDenied. A non-member never gets a
// listener (THE INVARIANT): the requester side polls with once() (app.js).

const PPL_NAME_MAX = 60;
const PPL_NOTE_MAX = 200;
const PPL_WINDOW = 25;                       // the editor listener's limitToLast
const PPL_THROTTLE_MS = 60000;               // the rules' floor between asks, and before a requester may withdraw
const PPL_ASKING_NAG_MS = 7 * 24 * 3600 * 1000; // the hub nags when asking has been on this long (a lower bound: see pplAskingLongOn)

const pplReq = {
  ref: null,        // the attached query, or null
  list: [],         // the requests, newest first: [{ key, name, note, at }]
  loaded: false,    // the first snapshot arrived
  denied: false,    // the read was refused (rules that predate it): the feature is just absent
  seen: null,       // keys already shown to this device, so a toast says "just arrived" only for a new one
  other: { n: 0, probed: false },  // the OTHER camp's count (a director of both camps), read once
  blocked: { status: 'idle', rows: [] }, // the Blocked sheet's one-shot read
};

// ── pure helpers ─────────────────────────────────────────────────────

// What a requester (or a typed line) wrote, as a name or a note: control characters out, runs of space folded, cut to the limit.
function peopleClean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// A name compared as the directory compares it: one spelling per counselor (Lilly = Lily), case-blind, spaces folded.
function peopleNameKey(name) {
  const t = peopleClean(name, 200);
  return (typeof canonicalCounselorName === 'function' ? canonicalCounselorName(t) : t).toLowerCase();
}

function peopleFirst(name) {
  const w = peopleClean(name, 200).split(' ')[0] || '';
  return (typeof canonicalCounselorName === 'function' ? canonicalCounselorName(w) : w).toLowerCase();
}

// One snapshot child → a request, or null when it is not one the rules could have let in (a key that is neither an email nor a
// phone, no name, no time). `at` is clamped like chat's: a wild number must never reach date maths.
function pplNormRequest(key, v) {
  const k = String(key || '');
  if (!(k.indexOf('@') !== -1 || k.charAt(0) === '+') || k.length > 200 || !isValidMemberKey(k) || isPendingKey(k)) return null;
  if (!v || typeof v !== 'object') return null;
  const name = peopleClean(v.name, PPL_NAME_MAX);
  if (!name) return null;
  const now = Date.now();
  let at = typeof v.at === 'number' && isFinite(v.at) ? v.at : 0;
  if (at > now + 86400000) at = now;
  if (at < 0) at = 0;
  const note = typeof v.note === 'string' ? peopleClean(v.note, PPL_NOTE_MAX) : '';
  return note ? { key: k, name, note, at } : { key: k, name, at };
}

// The text of a typed email or phone as a member key ('' when it is neither). The same reading the Members drawer's add form has.
function peopleKeyFromTyped(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  let key = '';
  if (t.indexOf('@') !== -1) key = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? emailKey(t) : '';
  else key = phoneKey(t);
  return key && isValidMemberKey(key) ? key : '';
}

const pplNorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// The team a word names, by its name or short name, case-blind: "foxes", "Ferocious Foxes", "fox" for Foxes. '' when none or when two
// teams answer to it (never a guess).
function peopleTeamByWord(word, teams) {
  const w = pplNorm(word);
  if (!w) return '';
  const hits = [];
  (teams || []).forEach((t) => {
    if (!t || typeof t.id !== 'string') return;
    const full = pplNorm(t.name);
    const short = pplNorm(typeof teamShort === 'function' ? teamShort(t.id) : '');
    const last = pplNorm(String(t.name || '').trim().split(/\s+/).pop());
    const stem = (x) => x.replace(/(?:es|s)$/, '');
    const same = (x) => x && (x === w || (w.length > 2 && stem(x) === stem(w)));
    if (same(full) || same(short) || same(last)) hits.push(t.id);
  });
  return hits.length === 1 ? hits[0] : '';
}

// The one team a free-text note names ("I'm with the Foxes"): a whole word of it that is a team's short name, the last word of its name or
// its whole name. '' when none or when two are named.
function peopleTeamInText(text, teams) {
  const words = String(text || '').toLowerCase().match(/[a-z0-9’']+/g) || [];
  if (!words.length) return '';
  const found = {};
  for (let i = 0; i < words.length; i++) {
    const one = peopleTeamByWord(words[i], teams);
    if (one) found[one] = true;
    if (i + 1 < words.length) { const two = peopleTeamByWord(words[i] + ' ' + words[i + 1], teams); if (two) found[two] = true; }
  }
  const ids = Object.keys(found);
  return ids.length === 1 ? ids[0] : '';
}

// The directory as plain rows (the screen, the hub and the tests read the same shape). `dir` is memberDirectory; `myKey` marks your own.
function peopleRows(dir, myKey) {
  const d = dir && typeof dir === 'object' ? dir : {};
  return Object.keys(d).filter((k) => d[k] && typeof d[k] === 'object').map((key) => {
    const r = d[key];
    const name = peopleClean(r.name, PPL_NAME_MAX) || identityFromKey(key);
    return {
      key, name, role: r.role === 'editor' ? 'editor' : 'viewer', teamId: isTeamId(r.teamId) ? r.teamId : '',
      pending: isPendingKey(key), owner: key === OWNER_MEMBER_KEY, self: !!myKey && key === myKey,
      phone: key.charAt(0) === '+', hasName: !!peopleClean(r.name, PPL_NAME_MAX),
      addedAt: r.addedAt,
    };
  });
}

// Rows by team (this camp's own order), then the people on no team. A person on an id the camp doesn't have counts as on no team.
// Inside a group directors come first, then by name; "Not on a team" keeps the owner and directors at the top the same way.
function peopleGroups(rows, teams) {
  const ids = (teams || []).filter((t) => t && typeof t.id === 'string').map((t) => t.id);
  const by = (a, b) => (a.owner === b.owner ? 0 : a.owner ? -1 : 1) || (a.role === b.role ? 0 : a.role === 'editor' ? -1 : 1) || a.name.localeCompare(b.name);
  const groups = (teams || []).filter((t) => t && typeof t.id === 'string').map((t) => ({ team: t, rows: rows.filter((r) => r.teamId === t.id).sort(by) }));
  const none = rows.filter((r) => ids.indexOf(r.teamId) === -1).sort(by);
  return { groups, none };
}

// "Is this someone already on the list?" (ux-R8): the pending rows (people we know by name, with no sign-in yet) that might be the
// requester — the same first name first, then the team the note names, never an auto-guess. At most eight, each with team and role.
function peopleCandidates(req, rows, teams) {
  const first = peopleFirst(req && req.name);
  const hint = peopleTeamInText(req && req.note, teams);
  const pend = (rows || []).filter((r) => r.pending);
  const out = [];
  const add = (r, why) => { if (!out.some((o) => o.key === r.key)) out.push({ key: r.key, name: r.name, teamId: r.teamId, role: r.role, why }); };
  if (first) pend.filter((r) => peopleFirst(r.name) === first).forEach((r) => add(r, 'name'));
  if (hint) pend.filter((r) => r.teamId === hint).forEach((r) => add(r, 'team'));
  return out.slice(0, 8);
}

// The name that goes into the directory is what chat trusts, so a likely clash is said before it is written: another member whose
// whole name is the same, or a lone first name that is another member's first name ("There's already a Patrick").
function peopleNameClash(name, rows, exceptKey) {
  const key = peopleNameKey(name);
  if (!key) return null;
  const single = key.indexOf(' ') === -1;
  const hit = (rows || []).find((r) => {
    if (r.key === exceptKey) return false;
    const rk = peopleNameKey(r.name);
    if (rk === key) return true;
    const rSingle = rk.indexOf(' ') === -1;
    return (single || rSingle) && peopleFirst(r.name) === peopleFirst(name);
  });
  return hit || null;
}

// Pasted or typed lines ("Cam, Foxes"), resolved against the list and the camp's teams: each is new (a pending row), an update (an
// existing person put on a team), already there, a repeat, or empty. The team is matched case-blind on name or short name; a team
// word that matches none says so and the person is added with no team.
function peopleParseLines(text, rows, teams) {
  const out = [];
  const seen = {};
  String(text == null ? '' : text).split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const i = line.indexOf(',');
    const name = peopleClean(i < 0 ? line : line.slice(0, i), PPL_NAME_MAX);
    const word = i < 0 ? '' : peopleClean(line.slice(i + 1), 60);
    const row = { line: peopleClean(line, 200), name, word, teamId: '', status: 'new', key: '', note: '' };
    if (!name) { row.status = 'empty'; out.push(row); return; }
    row.teamId = word ? peopleTeamByWord(word, teams) : '';
    if (word && !row.teamId) row.note = 'No team matched';
    const nk = peopleNameKey(name);
    const have = (rows || []).find((r) => !r.owner && peopleNameKey(r.name) === nk);
    if (seen[nk]) row.status = 'repeat';
    else if (have) {
      row.key = have.key;
      row.status = row.teamId && have.teamId !== row.teamId ? 'update' : 'same';
      if (row.status === 'same' && row.teamId && have.teamId === row.teamId) row.note = 'Already on this team';
    }
    seen[nk] = true;
    out.push(row);
  });
  return { rows: out, add: out.filter((r) => r.status === 'new'), update: out.filter((r) => r.status === 'update') };
}

// Put people on teams: the rows whose chosen team differs from what the list has, as { key, name, teamId ('' = off every team) }.
function peopleTeamChanges(rows, picks) {
  const out = [];
  (rows || []).forEach((r) => {
    if (r.owner || !Object.prototype.hasOwnProperty.call(picks || {}, r.key)) return;
    const want = isTeamId(picks[r.key]) ? picks[r.key] : '';
    if (want !== r.teamId) out.push({ key: r.key, name: r.name, teamId: want });
  });
  return out;
}

// Who is asking right now, newest first: the listener's list minus a key that has since become a member (a request left behind by a
// director who approved it on another device) — never a row for someone already in.
function peopleRequests() {
  const dir = memberDirectory && typeof memberDirectory === 'object' ? memberDirectory : {};
  return pplReq.list.filter((r) => !Object.prototype.hasOwnProperty.call(dir, r.key));
}

// Has asking been on for more than a week? joinOpen carries no time of its own, but turning it on stamps `meta/edited/week`, and
// nothing newer has touched the week's fields: so while it is on, the stamp is a LOWER BOUND on how long it has been on.
function pplAskingLongOn(nowMs) {
  const at = typeof setupEditedAt === 'function' ? setupEditedAt('week') : 0;
  return pplAskingOn() && at > 0 && Number(nowMs) - at > PPL_ASKING_NAG_MS;
}

function pplAskingOn() {
  return !!(setupTree && setupTree.meta && setupTree.meta.joinOpen === true);
}

// ── the requests listener (editor devices only) ───────────────────────

function pplMayListen() {
  return directorTab() && memberRoleConfirmed && restoreHasFirebase() && typeof syncStarted !== 'undefined' && syncStarted === true;
}

// Called after approval (initSync) and when a viewer is promoted. One `.on('value')` over the 25 newest rows; the rules carry the
// `at` index. A refusal (rules that predate it) is this feature's alone.
function peopleRequestsAttach() {
  if (pplReq.ref || !pplMayListen()) return;
  try {
    const q = firebase.database().ref(dbPath('accessRequests')).orderByChild('at').limitToLast(PPL_WINDOW);
    pplReq.ref = q;
    q.on('value', (snap) => {
      const list = [];
      if (snap && typeof snap.forEach === 'function') snap.forEach((c) => { const r = pplNormRequest(c.key, c.val()); if (r) list.push(r); });
      list.sort((a, b) => b.at - a.at);
      const had = pplReq.seen;
      const fresh = had ? list.filter((r) => !had[r.key + '|' + r.at]) : [];
      pplReq.seen = {};
      list.forEach((r) => { pplReq.seen[r.key + '|' + r.at] = true; });
      pplReq.list = list;
      pplReq.loaded = true;
      pplReq.denied = false;
      setupNotify('requests');
      if (fresh.length && typeof onAccessRequestsArrived === 'function') onAccessRequestsArrived(fresh);
      else if (typeof onAccessRequestsChanged === 'function') onAccessRequestsChanged();
    }, () => {
      pplReq.ref = null; pplReq.list = []; pplReq.loaded = false; pplReq.denied = true; pplReq.seen = null;
      setupNotify('requests');
      if (typeof onAccessRequestsChanged === 'function') onAccessRequestsChanged();
    });
  } catch (e) { pplReq.ref = null; }
  peopleOtherCampProbe();
}

function peopleRequestsDetach() {
  if (pplReq.ref) { try { pplReq.ref.off('value'); } catch (e) { /* ignore */ } }
  pplReq.ref = null; pplReq.list = []; pplReq.loaded = false; pplReq.seen = null;
  pplReq.other = { n: 0, probed: false };
  pplReq.blocked = { status: 'idle', rows: [] };
}

// A demotion or removal drops the list and the listener; a promotion (once the role is set) starts it.
function peopleRequestsOnRoleChange(prev, next) {
  if (prev === 'editor' && next !== 'editor') { peopleRequestsDetach(); setupNotify('requests'); if (typeof onAccessRequestsChanged === 'function') onAccessRequestsChanged(); }
  if (next === 'editor' && prev !== 'editor' && typeof Promise !== 'undefined') Promise.resolve().then(peopleRequestsAttach);
}

// A director of BOTH camps hears, once at load, about the other camp's waiting requests ("1 person is asking to join Senior camp").
// One read of an editor-only node: refused for anyone who is not a director there, which is harmless and says nothing.
function peopleOtherCampProbe() {
  if (pplReq.other.probed || typeof campRoleOf !== 'function' || campRoleOf(otherCampId()) !== 'editor') return;
  pplReq.other.probed = true;
  try {
    firebase.database().ref(CAMPS[otherCampId()].dbRoot + '/accessRequests').orderByChild('at').limitToLast(PPL_WINDOW).once('value').then((snap) => {
      let n = 0;
      if (snap && typeof snap.forEach === 'function') snap.forEach((c) => { if (pplNormRequest(c.key, c.val())) n++; });
      pplReq.other.n = n;
      if (n) { setupNotify('requests'); if (typeof onAccessRequestsChanged === 'function') onAccessRequestsChanged(); if (typeof onOtherCampRequests === 'function') onOtherCampRequests(n); }
    }).catch(() => {});
  } catch (e) { /* the count just stays 0 */ }
}

// ── acting on the list (every one: Promise<{ ok, reason? }>, never throws) ───────────────────────

// Why an action cannot even start: a viewer's phone, no connection ("Needs a connection" — a person's decision about access
// must not queue behind a dead signal and land minutes later).
function pplGuard() {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  if (!restoreOnline()) return { ok: false, reason: 'offline' };
  return null;
}

function pplMembersRef(key) { return firebase.database().ref(dbPath('members/' + key)); }
function pplRequestRef(key) { return firebase.database().ref(dbPath('accessRequests/' + key)); }

// The switch at the top of People (setup/meta/joinOpen). An ordinary setup commit (the week's own field), no undo entry: it is a
// setting somebody may flip back on the same screen.
function peopleSetAsking(on) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  return commitSetup((d) => { d.meta.joinOpen = on === true; }, { label: on ? 'Let people ask to join' : 'Stop people asking to join', undo: false });
}

// Let someone in from their request: create the member record where none exists, THEN delete the request (a failure part-way
// keeps the request, never loses the person). The role defaults to Counselor (a viewer); a team is optional.
async function peopleLetIn(req, o) {
  const g = pplGuard();
  if (g) return g;
  const key = req && req.key;
  if (!key || !isValidMemberKey(key) || isPendingKey(key)) return { ok: false, reason: 'invalid' };
  if (key === OWNER_MEMBER_KEY) return { ok: false, reason: 'owner' };
  const role = o && o.role === 'editor' ? 'editor' : 'viewer';
  const name = peopleClean(o && o.name, PPL_NAME_MAX) || peopleClean(req.name, PPL_NAME_MAX);
  const teamId = o && isTeamId(o.teamId) && (state.teams || []).some((t) => t && t.id === o.teamId) ? o.teamId : '';
  try {
    const created = await createMemberIfAbsent(pplMembersRef(key), memberRecord(role, name, teamId));
    try { await pplRequestRef(key).remove(); } catch (e) { return { ok: true, already: !created, requestLeft: true }; }
    return { ok: true, already: !created, invite: created ? inviteText(key, role) : '' };
  } catch (e) { return { ok: false, reason: 'refused' }; }
}

// "Link": the requester IS a pending row the directors typed (a name and a team, no sign-in yet). The record moves to the
// requester's key (create-then-delete, absent-only), then the request goes. Linking to a Director-role row asks for the
// requester's email or phone typed again (`confirm`), so a stranger who typed a director's first name cannot be handed the role.
async function peopleLink(req, pendKey, o) {
  const g = pplGuard();
  if (g) return g;
  const key = req && req.key;
  if (!key || !isValidMemberKey(key) || isPendingKey(key)) return { ok: false, reason: 'invalid' };
  if (key === OWNER_MEMBER_KEY) return { ok: false, reason: 'owner' };
  const dir = memberDirectory && typeof memberDirectory === 'object' ? memberDirectory : {};
  const rec = isPendingKey(pendKey) ? dir[pendKey] : null;
  if (!rec || typeof rec !== 'object') return { ok: false, reason: 'gone' };
  const role = rec.role === 'editor' ? 'editor' : 'viewer';
  if (role === 'editor' && peopleKeyFromTyped(o && o.confirm) !== key) return { ok: false, reason: 'confirm' };
  try {
    const created = await createMemberIfAbsent(pplMembersRef(key), memberRecord(role, rec.name, rec.teamId));
    if (!created) return { ok: false, reason: 'exists' };
    await pplMembersRef(pendKey).remove();
    try { await pplRequestRef(key).remove(); } catch (e) { return { ok: true, requestLeft: true, invite: inviteText(key, role) }; }
    return { ok: true, invite: inviteText(key, role) };
  } catch (e) { return { ok: false, reason: 'refused' }; }
}

async function peopleNotNow(req) {
  const g = pplGuard();
  if (g) return g;
  if (!req || !isValidMemberKey(req.key)) return { ok: false, reason: 'invalid' };
  try { await pplRequestRef(req.key).remove(); return { ok: true }; } catch (e) { return { ok: false, reason: 'refused' }; }
}

// Block first, then delete the request, so a re-ask cannot slip in between. The block is the director's own word on one identity.
async function peopleBlock(req) {
  const g = pplGuard();
  if (g) return g;
  if (!req || !isValidMemberKey(req.key) || isPendingKey(req.key)) return { ok: false, reason: 'invalid' };
  if (req.key === OWNER_MEMBER_KEY) return { ok: false, reason: 'owner' };
  try {
    await firebase.database().ref(dbPath('accessBlocked/' + req.key)).set({ at: firebase.database.ServerValue.TIMESTAMP, byKey: identityKey(authUser) });
    try { await pplRequestRef(req.key).remove(); } catch (e) { /* the block stands; the request is just still listed */ }
    pplReq.blocked.status = 'idle'; // the list read is stale now
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'refused' }; }
}

async function peopleUnblock(key) {
  const g = pplGuard();
  if (g) return g;
  if (!key || !isValidMemberKey(key)) return { ok: false, reason: 'invalid' };
  try {
    await firebase.database().ref(dbPath('accessBlocked/' + key)).remove();
    pplReq.blocked.rows = pplReq.blocked.rows.filter((r) => r.key !== key);
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'refused' }; }
}

// The Blocked sheet's list: ONE read when the sheet opens (never a listener), held in memory only.
async function peopleLoadBlocked() {
  if (!canEdit() || !restoreHasFirebase()) { pplReq.blocked = { status: 'nosync', rows: [] }; return pplReq.blocked; }
  pplReq.blocked.status = 'loading';
  try {
    const snap = await firebase.database().ref(dbPath('accessBlocked')).once('value');
    const rows = [];
    if (snap && typeof snap.forEach === 'function') snap.forEach((c) => {
      const v = c.val();
      if (isValidMemberKey(c.key) && !isPendingKey(c.key) && v && typeof v === 'object') rows.push({ key: c.key, at: typeof v.at === 'number' ? v.at : 0, byKey: typeof v.byKey === 'string' ? v.byKey : '' });
    });
    rows.sort((a, b) => b.at - a.at);
    pplReq.blocked = { status: 'ok', rows };
  } catch (e) { pplReq.blocked = { status: 'denied', rows: [] }; }
  return pplReq.blocked;
}

// A person's record, the fields that changed, one atomic update at their row: { name?, teamId? ('' = off the team), role? }. Your
// own role and the owner's row are never written from here (the rules refuse the owner; your own access is another director's job).
async function peopleSavePerson(key, patch) {
  const g = pplGuard();
  if (g) return g;
  if (!key || !isValidMemberKey(key)) return { ok: false, reason: 'invalid' };
  if (key === OWNER_MEMBER_KEY) return { ok: false, reason: 'owner' };
  const p = patch || {};
  const up = {};
  if (typeof p.name === 'string') { const n = peopleClean(p.name, PPL_NAME_MAX); if (!n) return { ok: false, reason: 'name' }; up.name = n; }
  if (typeof p.teamId === 'string') up.teamId = isTeamId(p.teamId) ? p.teamId : null; // RTDB has no "present but empty" string
  if (p.role !== undefined) {
    if (key === identityKey(authUser)) return { ok: false, reason: 'self' };
    if (p.role !== 'viewer' && p.role !== 'editor') return { ok: false, reason: 'invalid' };
    up.role = p.role;
  }
  if (!Object.keys(up).length) return { ok: true, nothing: true };
  try { await pplMembersRef(key).update(up); return { ok: true }; } catch (e) { return { ok: false, reason: 'refused' }; }
}

// Put people on teams: the changed rows, one row at a time, so a refused row is listed and the rest are saved (ux-R9). Resolves
// { ok, saved: n, failed: [{ key, name }] }.
async function peopleSaveTeams(changes) {
  const g = pplGuard();
  if (g) return g;
  let saved = 0;
  const failed = [];
  for (const c of changes || []) {
    if (!c || !isValidMemberKey(c.key) || c.key === OWNER_MEMBER_KEY) { failed.push({ key: c && c.key, name: c && c.name }); continue; }
    try { await pplMembersRef(c.key).update({ teamId: isTeamId(c.teamId) ? c.teamId : null }); saved++; } catch (e) { failed.push({ key: c.key, name: c.name }); }
  }
  return { ok: failed.length === 0, saved, failed };
}

// Remove one person from THIS camp (their access ends the moment it saves). Never your own row, never the owner's.
async function peopleRemove(key) {
  const g = pplGuard();
  if (g) return g;
  if (!key || !isValidMemberKey(key)) return { ok: false, reason: 'invalid' };
  if (key === OWNER_MEMBER_KEY) return { ok: false, reason: 'owner' };
  if (key === identityKey(authUser)) return { ok: false, reason: 'self' };
  try { await pplMembersRef(key).remove(); return { ok: true }; } catch (e) { return { ok: false, reason: 'refused' }; }
}

// "+ Add people": pending rows for the lines that are new and a team for the lines that name someone already here, in ONE multi-path
// update. `parsed` is peopleParseLines' answer.
async function peopleAddLines(parsed, role) {
  const g = pplGuard();
  if (g) return g;
  const patch = {};
  let added = 0, moved = 0;
  ((parsed && parsed.add) || []).forEach((r) => { patch[pendingKey(r.name)] = memberRecord(role === 'editor' ? 'editor' : 'viewer', r.name, r.teamId); added++; });
  ((parsed && parsed.update) || []).forEach((r) => { if (isValidMemberKey(r.key) && r.key !== OWNER_MEMBER_KEY && isTeamId(r.teamId)) { patch[r.key + '/teamId'] = r.teamId; moved++; } });
  if (!added && !moved) return { ok: true, added: 0, moved: 0 };
  try { await firebase.database().ref(dbPath('members')).update(patch); return { ok: true, added, moved }; } catch (e) { return { ok: false, reason: 'refused' }; }
}

// One person with a sign-in (the old add form): an email or phone, a name, a role, a team and, for a director of both camps,
// whether to add the other camp too. Only ever CREATES (planMemberAdd + createMemberIfAbsent): someone already on the list keeps their
// role, name and team. Resolves { ok, key, camps, invite } or { ok: false, reason, message }.
async function peopleAddMember(o) {
  const g = pplGuard();
  if (g) return g;
  const raw = String(o && o.id || '').trim();
  const name = peopleClean(o && o.name, PPL_NAME_MAX);
  const role = o && o.role === 'editor' ? 'editor' : 'viewer';
  const teamId = o && isTeamId(o.teamId) ? o.teamId : '';
  let key, pending = false;
  if (!raw) {
    if (!name) return { ok: false, reason: 'input', message: 'Give at least a name — or an email or phone number to let them sign in.' };
    key = pendingKey(name); pending = true;
  } else if (raw.indexOf('@') !== -1) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { ok: false, reason: 'input', message: 'That doesn’t look like an email address.' };
    key = emailKey(raw);
  } else {
    key = phoneKey(raw);
    if (!key) return { ok: false, reason: 'input', message: 'That doesn’t look like a phone number. Include the area code (for example 555-123-4567).' };
  }
  if (!isValidMemberKey(key)) return { ok: false, reason: 'input', message: 'That address has a character the database can’t use as a key. Try another.' };
  // The lists the plan needs: this camp's live directory, and the other camp's only when asked (a one-shot read).
  const lists = {};
  lists[CAMP.id] = memberDirectory || {};
  if (o && o.bothCamps && !pending) {
    try { lists[otherCampId()] = (await firebase.database().ref(CAMPS[otherCampId()].dbRoot + '/members').once('value')).val() || {}; } catch (e) { return { ok: false, reason: 'refused' }; }
  }
  const plan = planMemberAdd({ key, pending, bothCamps: !!(o && o.bothCamps), myKey: identityKey(authUser), lists });
  if (plan.error) return { ok: false, reason: 'input', message: plan.error };
  try {
    const wrote = await Promise.all(plan.camps.map((cid) => createMemberIfAbsent(
      firebase.database().ref(campMembersPath(cid, key)), cid === CAMP.id ? memberRecord(role, name, teamId) : memberRecord(role, name))));
    if (!wrote.some(Boolean)) return { ok: false, reason: 'input', message: 'Already on the list — open their row to change their access.' };
    return { ok: true, key, pending, camps: plan.camps, invite: pending ? '' : inviteText(key, role) };
  } catch (e) { return { ok: false, reason: 'refused' }; }
}

// A pending row gets its real sign-in: create-then-delete, absent-only, exactly the Members drawer's convert (typed text, no prompt()).
async function peopleAddSignIn(pendKey, typed) {
  const g = pplGuard();
  if (g) return g;
  const dir = memberDirectory && typeof memberDirectory === 'object' ? memberDirectory : {};
  const rec = isPendingKey(pendKey) ? dir[pendKey] : null;
  if (!rec) return { ok: false, reason: 'gone' };
  const key = peopleKeyFromTyped(typed);
  if (!key) return { ok: false, reason: 'input', message: String(typed || '').indexOf('@') !== -1 || !String(typed || '').trim() ? 'That doesn’t look like an email address or a phone number.' : 'That doesn’t look like a phone number — include the area code.' };
  const refusal = memberConvertRefusal(key, identityKey(authUser), { [CAMP.id]: dir });
  if (refusal) return { ok: false, reason: 'input', message: refusal };
  const role = rec.role === 'editor' ? 'editor' : 'viewer';
  try {
    const created = await createMemberIfAbsent(pplMembersRef(key), memberRecord(role, rec.name, rec.teamId));
    if (!created) return { ok: false, reason: 'exists' };
    await pplMembersRef(pendKey).remove();
    return { ok: true, key, invite: inviteText(key, role) };
  } catch (e) { return { ok: false, reason: 'refused' }; }
}

// "This is the same person as…" (ux-R8): a pending row folds into a signed-in member. The team is carried over only when the
// member has none (a person's own team is not overwritten), then the pending row goes.
async function peopleSameAs(pendKey, memberKey) {
  const g = pplGuard();
  if (g) return g;
  const dir = memberDirectory && typeof memberDirectory === 'object' ? memberDirectory : {};
  const pend = isPendingKey(pendKey) ? dir[pendKey] : null;
  const mem = dir[memberKey];
  if (!pend || !mem || isPendingKey(memberKey) || memberKey === OWNER_MEMBER_KEY) return { ok: false, reason: 'gone' };
  try {
    if (isTeamId(pend.teamId) && !isTeamId(mem.teamId)) await pplMembersRef(memberKey).update({ teamId: pend.teamId });
    await pplMembersRef(pendKey).remove();
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'refused' }; }
}

// One person's access at ONE camp, for a director of both (None / Counselor / Director): None removes that camp's record, a role on
// an existing record sets it, a role where there is none creates it (the name carried over; teams are per camp so not the team).
async function peopleSetCampAccess(key, campId, value) {
  const g = pplGuard();
  if (g) return g;
  if (!CAMPS[campId] || !key || !isValidMemberKey(key)) return { ok: false, reason: 'invalid' };
  if (key === OWNER_MEMBER_KEY) return { ok: false, reason: 'owner' };
  if (key === identityKey(authUser)) return { ok: false, reason: 'self' };
  if (campRoleOf(campId) !== 'editor') return { ok: false, reason: 'readonly' };
  const ref = firebase.database().ref(campMembersPath(campId, key));
  try {
    if (value === 'none') { await ref.remove(); return { ok: true }; }
    if (value !== 'viewer' && value !== 'editor') return { ok: false, reason: 'invalid' };
    const cur = (await ref.once('value')).val();
    if (cur && typeof cur === 'object') { await ref.child('role').set(value); return { ok: true }; }
    const nm = ((memberDirectory && memberDirectory[key]) || {}).name;
    const made = await createMemberIfAbsent(ref, memberRecord(value, nm));
    return made ? { ok: true } : { ok: false, reason: 'exists' };
  } catch (e) { return { ok: false, reason: 'refused' }; }
}

// How a refusal reads, in words every caller shares.
const PPL_WHY = {
  readonly: 'Only directors can change who’s on the list.',
  offline: 'Needs a connection.',
  owner: 'The owner is managed in the Firebase console.',
  self: 'Another director has to change your own access.',
  invalid: 'That isn’t something the list can hold.',
  gone: 'That person is no longer in the list.',
  exists: 'Already on the list.',
  confirm: 'That doesn’t match the requester’s email or phone.',
  name: 'Give them a name first.',
  refused: 'The database refused that — are you still a director?',
};
function peopleWhy(res) {
  return (res && res.message) || PPL_WHY[res && res.reason] || PPL_WHY.refused;
}

// ════════════════════════════════════════════════════════════════════
// CAMPERS: first names per team, directors only (setup-rebuild-spec §11.9, P12 — Step 25)
// ════════════════════════════════════════════════════════════════════
// Minors' names. The one place they exist on a device is THIS section's `campersMem`, in memory, for a director with a camper-showing
// screen open; the rules make the node editor-only (`<root>/campers/<tid>/<cid> = { name ≤ 40, ord }`, both required, so a rename racing a
// move cannot resurrect a camper). The rules of this section, each pinned by tests/campers.test.js with a source scan AND a runtime sweep:
//   - nothing here touches localStorage, sessionStorage, IndexedDB or the console; nothing here is in `state`, `SYNC_KEYS`, a backup, a restore
//     point, an undo entry (Camper edits are undoable from a line on the open screen, a closure in memory), a chat mention, a push payload or the TV page;
//   - the listener is an editor-only `.on('value')` on `campers`, attached only while the hub, Campers, People or Teams is open (those show counts or
//     names; setup-ui.js campersSync decides), detached the moment none is, dropped on a demotion, and its refusal sets `denied` and degrades campers
//     only — it never touches fbRef / syncDenied;
//   - what a snapshot holds is normalized on read (campersNorm): unknown teams, bad ids, nameless or ord-less rows are dropped, never rendered;
//   - names typed while the signal is gone are HELD in memory on that open screen and sent the moment `.info/connected` is true (campersOnConnect);
//     closing the screen with names still waiting asks first (setup-ui.js). Every other action needs a connection.

const CAMPERS_NAME_MAX = 40;        // the rules' limit
const CAMPERS_ADD_MAX = 300;        // names in one Add (a whole camp's list is ~100)
const CAMPERS_ORD_STEP = 10;
const CAMPERS_TEAM_RE = /^t[0-9]$/;
const CAMPERS_ID_RE = /^c-[a-z0-9]{6,20}$/;

const campersMem = {
  ref: null,        // the attached listener, or null
  tree: {},         // { tid: [{ id, name, ord }] } sorted, normalized
  loaded: false,    // the first snapshot arrived
  denied: false,    // the read was refused: campers is just absent
  held: [],         // names typed while offline: [{ tid, names: [] }]
  heldNote: '',     // why the last flush stopped, in words
  busy: 0,          // writes in flight
  flushing: false,
};

// ── pure helpers ─────────────────────────────────────────────────────

// A typed name as the list holds it: control characters out, runs of space folded, cut to 40.
function campersCleanName(s) {
  return peopleClean(s, CAMPERS_NAME_MAX);
}

// "First names, one per line or separated by commas": { names, cut } — `cut` counts the names that were longer than the rules allow.
// Duplicates stay (two Avas are two campers; the caption says to add a last initial).
function campersParseNames(text) {
  const names = [];
  let cut = 0;
  String(text == null ? '' : text).split(/[\n\r,;]+/).forEach((part) => {
    const folded = String(part).replace(/\s+/g, ' ').trim();
    if (!folded) return;
    if (folded.length > CAMPERS_NAME_MAX) cut++;
    const n = campersCleanName(folded);
    if (n) names.push(n);
  });
  return { names: names.slice(0, CAMPERS_ADD_MAX), cut, over: names.length > CAMPERS_ADD_MAX };
}

// What a snapshot hands back, as the screens may read it. A shape this build does not know is dropped, never guessed at.
function campersNorm(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).forEach((tid) => {
    const team = raw[tid];
    if (!CAMPERS_TEAM_RE.test(tid) || !team || typeof team !== 'object') return;
    const rows = [];
    Object.keys(team).forEach((cid) => {
      const r = team[cid];
      if (!CAMPERS_ID_RE.test(cid) || !r || typeof r !== 'object') return;
      const name = campersCleanName(r.name);
      if (!name || typeof r.ord !== 'number' || !isFinite(r.ord)) return;
      rows.push({ id: cid, name, ord: r.ord });
    });
    rows.sort((a, b) => (a.ord - b.ord) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1));
    if (rows.length) out[tid] = rows;
  });
  return out;
}

// `c-` and ten random base36 characters (the rules want 6–20 of [a-z0-9]); `taken` is a set of ids already in use.
function campersMintId(taken) {
  for (let i = 0; i < 25; i++) {
    const id = 'c-' + (Math.random().toString(36).slice(2) + '0000000000').slice(0, 10);
    if (!taken || !taken[id]) return id;
  }
  return 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function campersTakenIds() {
  const taken = {};
  Object.keys(campersMem.tree).forEach((tid) => campersMem.tree[tid].forEach((c) => { taken[c.id] = true; }));
  return taken;
}

// The next position at the end of a team's list (steps of 10, so a hand-edit can slot one between two).
function campersNextOrd(tid) {
  const rows = campersMem.tree[tid] || [];
  return rows.length ? rows[rows.length - 1].ord + CAMPERS_ORD_STEP : CAMPERS_ORD_STEP;
}

function campersTeamOk(tid) {
  return typeof tid === 'string' && CAMPERS_TEAM_RE.test(tid) && (state.teams || []).some((t) => t && t.id === tid);
}

function campersFind(tid, cid) {
  return (campersMem.tree[tid] || []).find((c) => c.id === cid) || null;
}

// ── reading (directors, while a camper-showing screen holds the listener) ───────────────────────

// [] for anyone who may not edit (a counselor's phone, a director's view-only second tab, a counselor preview) and until the first snapshot.
function campersFor(tid) {
  if (!canEdit() || !campersMem.loaded) return [];
  return (campersMem.tree[tid] || []).map((c) => ({ id: c.id, name: c.name, ord: c.ord }));
}

function campersCount(tid) {
  return canEdit() && campersMem.loaded ? (campersMem.tree[tid] || []).length : 0;
}

function campersTotal() {
  if (!canEdit() || !campersMem.loaded) return 0;
  return Object.keys(campersMem.tree).reduce((n, tid) => n + campersMem.tree[tid].length, 0);
}

// loading | ok | denied | nosync — what a screen says while it waits or cannot have the list.
function campersStatus() {
  if (!restoreHasFirebase()) return 'nosync';
  if (campersMem.denied) return 'denied';
  return campersMem.loaded ? 'ok' : 'loading';
}

// ── the listener ─────────────────────────────────────────────────────

function campersMayListen() {
  return canEdit() && memberRoleConfirmed && restoreHasFirebase() && typeof syncStarted !== 'undefined' && syncStarted === true;
}

function campersAttach() {
  if (campersMem.ref || !campersMayListen()) return;
  try {
    const r = firebase.database().ref(dbPath('campers'));
    campersMem.ref = r;
    r.on('value', (snap) => {
      campersMem.tree = campersNorm(snap && typeof snap.val === 'function' ? snap.val() : null);
      campersMem.loaded = true;
      campersMem.denied = false;
      setupNotify('campers');
    }, () => {
      campersMem.ref = null; campersMem.tree = {}; campersMem.loaded = false; campersMem.denied = true;
      setupNotify('campers');
    });
  } catch (e) { campersMem.ref = null; }
}

// The names go with the listener. Held (not yet sent) names are NOT dropped here: they are the open screen's own and wait for the signal.
function campersDetach() {
  if (campersMem.ref) { try { campersMem.ref.off('value'); } catch (e) { /* ignore */ } }
  campersMem.ref = null;
  campersMem.tree = {};
  campersMem.loaded = false;
  campersMem.denied = false;
}

// A screen that shows camper counts or names asks for the list; any other screen lets it go.
function campersWant(on) {
  if (on) campersAttach(); else if (campersMem.ref || campersMem.loaded || campersMem.denied) campersDetach();
}

// A demotion drops everything at once, held names included (a phone that may not edit must not keep a minor's name in memory).
function campersOnRoleChange(prev, next) {
  if (prev === 'editor' && next !== 'editor') { campersDetach(); campersMem.held = []; campersMem.heldNote = ''; setupNotify('campers'); }
  if (next === 'editor' && prev !== 'editor' && typeof Promise !== 'undefined') Promise.resolve().then(() => setupNotify('campers'));
}

// ── acting on the list (every one: Promise<{ ok, reason? }>, never throws) ───────────────────────

function campersGuard(needOnline) {
  if (!canEdit()) return { ok: false, reason: 'readonly' };
  if (!restoreHasFirebase()) return { ok: false, reason: 'nosync' };
  if (needOnline && !restoreOnline()) return { ok: false, reason: 'offline' };
  return null;
}

function campersRoot() { return firebase.database().ref(dbPath('campers')); }

// A write, counted while it is in flight (the deploy's auto-reload waits for it).
async function campersWrite(fn) {
  campersMem.busy++;
  try { await fn(); return { ok: true }; } catch (e) { return { ok: false, reason: 'refused' }; } finally { campersMem.busy--; }
}

// ONE multi-path update of whole `{ name, ord }` records under a team (the rules want both, so a rename racing a move cannot resurrect a camper).
async function campersSend(tid, names) {
  const taken = campersTakenIds();
  const base = campersNextOrd(tid);
  const patch = {};
  names.forEach((n, i) => { const id = campersMintId(taken); taken[id] = true; patch[tid + '/' + id] = { name: n, ord: base + i * CAMPERS_ORD_STEP }; });
  const res = await campersWrite(() => campersRoot().update(patch));
  return res.ok ? { ok: true, added: names.length } : res;
}

// "+ Add": offline the names are held in memory on the open screen and go the moment the signal is back; online they go at once.
async function campersAdd(tid, names) {
  const g = campersGuard(false);
  if (g) return g;
  if (!campersTeamOk(tid)) return { ok: false, reason: 'team' };
  const clean = (Array.isArray(names) ? names : []).map(campersCleanName).filter(Boolean).slice(0, CAMPERS_ADD_MAX);
  if (!clean.length) return { ok: true, added: 0 };
  if (!restoreOnline()) {
    campersMem.held.push({ tid, names: clean });
    campersMem.heldNote = '';
    setupNotify('campers');
    return { ok: true, held: clean.length };
  }
  return campersSend(tid, clean);
}

function campersHeldCount() {
  return campersMem.held.reduce((n, h) => n + h.names.length, 0);
}

// The held names, for the screen that shows them waiting: [{ tid, name }].
function campersHeldList() {
  const out = [];
  campersMem.held.forEach((h) => h.names.forEach((n) => out.push({ tid: h.tid, name: n })));
  return out;
}

function campersDiscardHeld() {
  campersMem.held = [];
  campersMem.heldNote = '';
  setupNotify('campers');
}

// The signal is back (app.js, beside editorsHereOnConnect): send what was typed while it was gone, oldest first, stopping at a refusal.
async function campersFlushHeld() {
  if (campersMem.flushing || !campersMem.held.length || !canEdit() || !restoreOnline()) return { ok: true, sent: 0 };
  campersMem.flushing = true;
  let sent = 0;
  let failed = null;
  try {
    for (const h of campersMem.held.slice()) {
      const r = await campersSend(h.tid, h.names);
      if (!r.ok) { failed = r; break; }
      campersMem.held = campersMem.held.filter((x) => x !== h);
      sent += h.names.length;
    }
  } finally { campersMem.flushing = false; }
  campersMem.heldNote = failed ? campersWhy(failed) : '';
  setupNotify('campers');
  if (sent && typeof onCampersFlushed === 'function') onCampersFlushed(sent);
  return failed ? Object.assign({ sent }, failed) : { ok: true, sent };
}

function campersOnConnect() {
  if (campersMem.held.length) campersFlushHeld();
}

// A held name or a write in flight holds the deploy's auto-reload (a reload would lose both: nothing is stored).
function campersBusy() {
  return campersMem.held.length > 0 || campersMem.busy > 0;
}

async function campersRename(tid, cid, name) {
  const g = campersGuard(true);
  if (g) return g;
  const cur = campersFind(tid, cid);
  if (!cur) return { ok: false, reason: 'gone' };
  const n = campersCleanName(name);
  if (!n) return { ok: false, reason: 'name' };
  if (n === cur.name) return { ok: true, nothing: true };
  return campersWrite(() => campersRoot().child(tid + '/' + cid + '/name').set(n));
}

// One atomic update: the camper is deleted from the old team and created, with its name and a position at the end (or `o.ord`, an undo
// putting it back where it was), on the new one — under the same id. `o.name` renames in the same breath, so a move and a rename are ONE
// write that never leaves the camper under a name the list has already replaced.
async function campersMove(tid, cid, toTid, o) {
  const g = campersGuard(true);
  if (g) return g;
  if (!campersTeamOk(toTid)) return { ok: false, reason: 'team' };
  const cur = campersFind(tid, cid);
  if (!cur) return { ok: false, reason: 'gone' };
  const name = o && o.name !== undefined ? campersCleanName(o.name) : cur.name;
  if (!name) return { ok: false, reason: 'name' };
  if (toTid === tid) return { ok: true, nothing: true };
  const ord = o && typeof o.ord === 'number' && isFinite(o.ord) ? o.ord : campersNextOrd(toTid);
  const patch = {};
  patch[tid + '/' + cid] = null;
  patch[toTid + '/' + cid] = { name, ord };
  return campersWrite(() => campersRoot().update(patch));
}

async function campersRemove(tid, cid) {
  const g = campersGuard(true);
  if (g) return g;
  if (!campersFind(tid, cid)) return { ok: false, reason: 'gone' };
  return campersWrite(() => campersRoot().child(tid + '/' + cid).remove());
}

// Undo of a removal (the open screen's line, in memory): the same whole record, back under the same id.
async function campersPut(tid, cid, rec) {
  const g = campersGuard(true);
  if (g) return g;
  if (!campersTeamOk(tid) || !CAMPERS_ID_RE.test(String(cid))) return { ok: false, reason: 'team' };
  const n = campersCleanName(rec && rec.name);
  if (!n || !rec || typeof rec.ord !== 'number' || !isFinite(rec.ord)) return { ok: false, reason: 'name' };
  return campersWrite(() => campersRoot().child(tid + '/' + cid).set({ name: n, ord: rec.ord }));
}

const CAMPERS_WHY = {
  readonly: 'Only directors can change the camper lists.',
  offline: 'Needs a connection.',
  nosync: 'Needs the camp database.',
  team: 'That team isn’t on this camp.',
  gone: 'That camper isn’t on the list any more — someone may have moved or removed them.',
  name: 'Give them a name first.',
  refused: 'The database refused that — are you still a director?',
};
function campersWhy(res) {
  return (res && res.message) || CAMPERS_WHY[res && res.reason] || CAMPERS_WHY.refused;
}

setupLoadCache();
