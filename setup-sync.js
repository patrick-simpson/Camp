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
//   3. restore points and Backups v3        (added in the next commit)
//   4. "also here" (editorsHere) and Devices (added in the one after)

const SETUP_KEY = 'campScoreboardSetupV1';   // lsKey()'d; wiped by clearLocalData
const SETUP_SCHEMA = 1;                      // the highest meta/schema this build understands
const SETUP_DK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SETUP_DAY_WORDS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const SETUP_SECTIONS = ['schedule', 'meals', 'verses', 'cleanup', 'electives'];
const SETUP_PUSH_MS = 300;                   // coalesce rapid edits (spec §6.4.2 step 6)
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

function setupDiff(a, b) {
  return treeDiff(setupCanon(a), setupCanon(b), SETUP_DEPTHS);
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
// 'commit' (this device committed), 'clashes'. A listener that throws never stops the engine.
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
      const mine = canEdit() ? treeDiff(setupBase, local, SETUP_DEPTHS) : {};
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
  const mine = treeDiff(base, localCanon, SETUP_DEPTHS);
  const minePaths = Object.keys(mine);
  if (!minePaths.length) return false;
  const remoteCanon = setupCanon(remote || {});
  const theirs = treeDiff(base, remoteCanon, SETUP_DEPTHS);
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
  const unsent = mineOps !== undefined ? mineOps : (setupLast ? treeDiff(setupLast, localCanon, SETUP_DEPTHS) : {});
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
  if (setupRef && Object.keys(treeDiff(setupLast, setupCanon(setupTree), SETUP_DEPTHS)).length) scheduleSetupPush();
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
  const ops = treeDiff(before, after, SETUP_DEPTHS);
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
  setupPushTimer = setTimeout(() => { setupPushTimer = null; pushSetup(); }, SETUP_PUSH_MS);
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
  const diff = treeDiff(prev, cur, SETUP_DEPTHS);
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
  return setupBase ? treeDiff(setupBase, setupCanon(setupTree), SETUP_DEPTHS) : {};
}

function setupHasUnconfirmed() {
  return Object.keys(setupUnconfirmed()).length > 0 || setupParkedCount() > 0;
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
  const parked = setupParkedCount();
  if (parked) return { tone: 'error', text: `Couldn’t save ${parked === 1 ? setupParkedWords() : parked + ' changes'}`, act: 'details' };
  if (setupPending > 0 || setupPushTimer != null || setupBisecting) return { tone: 'saving', text: 'Saving…', act: '' };
  return { tone: 'saved', text: 'Saved', act: '' };
}

setupLoadCache();
