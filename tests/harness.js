// ── Test harness ─────────────────────────────────────────────────
// This project has no build step, no package.json, and no framework — so the
// tests don't introduce any. `node tests/run.js` loads the REAL deployed
// app.js/defaults.js/settings.js into a Node `vm` context with a small DOM stub
// and asserts against the actual functions the site ships.
//
// Nothing here is referenced by index.html: the tests/ directory is never
// served, and adding to it cannot change what the browser loads.
//
// Why a vm context rather than require(): app.js is a plain browser script with
// no exports, and its top level runs real work (state load + migration). Each
// test file gets a FRESH context so one file's mutations can't leak into
// another's. Because `let`/`const` at the top level of a vm script land in the
// context's global lexical scope, test files can reference `state`,
// `medalCounts`, `SYNC_KEYS`, … directly, exactly as app.js's own code does.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// Load order mirrors the <script> tags at the bottom of index.html.
const APP_FILES = ['defaults.js', 'camp-core.js', 'reveal-core.js', 'camps.js', 'app.js', 'settings.js', 'chat.js', 'push.js'];

const noop = () => {};

// Every context makeContext has built, so clearAllTimers() can cancel the
// timers of any of them (a test may build a second context of its own, as the
// hint-paint case does, and run.js only holds the first).
const liveTimerClearers = new Set();
function clearAllTimers() {
  for (const clear of liveTimerClearers) clear();
  liveTimerClearers.clear();
}

// Minimal stand-in for one DOM element: enough that render functions called
// incidentally (e.g. by saveState → renderAll paths) no-op instead of throwing.
// Tests assert on state and return values, never on rendered markup — anything
// that needs real layout belongs in the Playwright pass (see CLAUDE.md).
//
// THE SINK RECORDER. `rec` is the context's one recorder ({ on, log }). While
// rec.on is true, every way text leaves the app through the DOM is appended to
// rec.log as { kind, text }: an innerHTML or textContent assignment,
// insertAdjacentHTML, and the attributes that carry human words (title,
// aria-label, label, alt, placeholder…). The function-level sinks (toasts,
// notifications, share, clipboard, chimes) are wrapped by installSinks (below).
// The secrecy tests use it to prove that nothing a counselor can hear or read
// carries points, places or gaps — a stub DOM that records nothing would let a
// "+7 pts (now 23)" toast pass unseen. Off by default (`on` false), so every other
// test pays one boolean check per write and logs nothing.
const TEXT_ATTRS = new Set(['title', 'aria-label', 'label', 'alt', 'placeholder', 'aria-description', 'aria-valuetext']);

function stubEl(rec) {
  const kids = new Map();
  const note = (kind, v) => { if (rec && rec.on && v !== '' && v != null) rec.log.push({ kind, text: String(v) }); };
  let inner = '';
  let text = '';
  const el = {
    hidden: false, value: '', checked: false,
    className: '',
    dataset: {}, children: [], files: null, isContentEditable: false, tagName: 'DIV',
    get innerHTML() { return inner; },
    set innerHTML(v) { inner = v; note('innerHTML', v); },
    get textContent() { return text; },
    set textContent(v) { text = v; note('textContent', v); },
    style: { setProperty: noop, removeProperty: noop, getPropertyValue: () => '' },
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    appendChild: noop, remove: noop, replaceWith: noop, focus: noop, blur: noop, click: noop,
    insertAdjacentHTML: (pos, html) => note('insertAdjacentHTML', html),
    setAttribute: (name, v) => { if (TEXT_ATTRS.has(name)) note('attr:' + name, v); },
    getAttribute: () => null, removeAttribute: noop,
    hasAttribute: () => false, toggleAttribute: noop, closest: () => null,
    // Same memoized-stub rule as document.querySelector (see makeContext).
    querySelector: (sel) => {
      if (!kids.has(sel)) kids.set(sel, stubEl(rec));
      return kids.get(sel);
    },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  return el;
}

function makeContext(opts) {
  const rec = { on: false, log: [] }; // the sink recorder (see stubEl)
  const store = new Map();
  // Camp selection happens at script-load time (camps.js reads localStorage
  // before app.js runs), so a senior-context test seeds the key up front:
  // makeContext({ camp: 'senior' }).
  if (opts && opts.camp === 'senior') store.set('campScoreboardActiveCamp', 'senior');
  // A phone that already has a week cached: localStorage entries present BEFORE
  // the scripts load, which is when normalizeSyncedState/migrateState first run
  // over them (top-level `const`s further down a file are not initialised yet).
  // makeContext({ storage: { campScoreboardV2: '{...}' } }).
  if (opts && opts.storage) Object.keys(opts.storage).forEach((k) => store.set(k, String(opts.storage[k])));
  // Lookups return a memoized stub rather than null: the render functions are
  // written against a page where their container always exists, so handing back
  // an element (the same one each time, like the real DOM) lets tests call the
  // render path — including via saveState → renderAll — without every function
  // needing a defensive null check it doesn't need in the browser.
  const byId = new Map();
  const bySelector = new Map();
  const docListeners = {};
  const doc = {
    documentElement: stubEl(rec),
    body: stubEl(rec),
    head: stubEl(rec),
    activeElement: null,
    hidden: false,
    visibilityState: 'visible',
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, stubEl(rec));
      return byId.get(id);
    },
    querySelector: (sel) => {
      if (!bySelector.has(sel)) bySelector.set(sel, stubEl(rec));
      return bySelector.get(sel);
    },
    querySelectorAll: () => [],
    createElement: () => stubEl(rec),
    createElementNS: () => stubEl(rec),
    // Recorded (never fired by the harness itself) so a test can reach the
    // delegated handlers app.js registers on `document` at load — the joy-press
    // pointer handlers, the card `toggle` listener — by type: __docListeners.
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener: noop,
  };

  // Every timer the app starts inside this context, so __clearTimers can cancel
  // the ones a file leaves behind (the handle is dropped when it fires).
  const pendingTimers = new Set();
  const realSetTimeout = setTimeout;
  const realClearTimeout = clearTimeout;
  const trackedSetTimeout = (fn, ms, ...args) => {
    const handle = realSetTimeout(() => {
      pendingTimers.delete(handle);
      if (typeof fn === 'function') fn(...args);
    }, ms);
    pendingTimers.add(handle);
    return handle;
  };
  const trackedClearTimeout = (handle) => {
    pendingTimers.delete(handle);
    realClearTimeout(handle);
  };
  const sandbox = {
    console,
    document: doc,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      key: (i) => [...store.keys()][i],
      get length() { return store.size; },
    },
    location: {
      search: '', href: 'http://localhost/index.html', pathname: '/index.html', origin: 'http://localhost',
      // switchCamp / signOutAndClear end in a reload; tests count them.
      reload: () => { sandbox.__reloads = (sandbox.__reloads || 0) + 1; },
    },
    navigator: { userAgent: 'node', share: undefined, onLine: true },
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop, removeEventListener: noop }),
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, scrollY: 0, scrollX: 0,
    crypto: require('crypto').webcrypto,
    // Per-tab storage (the camp-switch loop guard lives here).
    sessionStorage: (() => {
      const ss = new Map();
      return {
        getItem: (k) => (ss.has(k) ? ss.get(k) : null),
        setItem: (k, v) => ss.set(k, String(v)),
        removeItem: (k) => ss.delete(k),
        clear: () => ss.clear(),
      };
    })(),
    indexedDB: { open: () => ({}), deleteDatabase: noop },
    // Timers are tracked so the runner can cancel whatever a file left pending
    // (see __clearTimers): a rAF-to-setTimeout chain or a toast timer that a
    // scenario starts would otherwise keep Node's event loop alive after every
    // case has passed, and the run would hang until killed.
    setTimeout: trackedSetTimeout, clearTimeout: trackedClearTimeout,
    // Timers that would otherwise keep the process alive forever (the 30s
    // render loop, the 500ms clock ticker, the sync idle retry) are inert here;
    // tests drive those code paths by calling the tick functions directly.
    setInterval: () => 0,
    clearInterval: noop,
    requestAnimationFrame: (cb) => trackedSetTimeout(cb, 0),
    cancelAnimationFrame: noop,
    fetch: () => Promise.reject(new Error('tests make no network calls')),
    // Destructive flows all gate on confirm(). Tests auto-accept so the code
    // under test actually runs; nothing here touches anything outside the
    // context's own `state` and stubbed localStorage.
    confirm: () => true,
    alert: noop,
    prompt: () => null,
    addEventListener: noop,
    removeEventListener: noop,
    // Deliberately absent, so the app takes its no-sync / no-audio / no-notify
    // branches unless a test stubs them: firebase, AudioContext, Notification.
    __localStorageStore: store,
    __sinkRec: rec,
    // What is in the page's top-level nodes RIGHT NOW (the sink log only sees
    // writes, and a render that skips an unchanged node writes nothing, so markup
    // left behind by an earlier render — say a demoted director's — would never
    // show up there). { kind: 'innerHTML', text } entries, same shape as the log.
    __domSweep: () => [...byId.values(), ...bySelector.values()]
      .map((e) => ({ kind: 'innerHTML', text: String(e.innerHTML || '') + ' ' + String(e.textContent || '') }))
      .filter((e) => e.text.trim()),
    __docListeners: docListeners,
    __reloads: 0,
    // Cancels every timer this context still has pending. run.js calls it when
    // a file's cases are done, so a leftover chain can't hold the process open.
    __clearTimers: () => {
      for (const handle of pendingTimers) realClearTimeout(handle);
      pendingTimers.clear();
    },
  };
  liveTimerClearers.add(sandbox.__clearTimers);
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  APP_FILES.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });

  // The function-level half of the sink recorder: wraps the app's own ways of
  // making noise (showToast, maybeNativeNotification, copyTextToClipboard, the
  // chimes) and stands up recording versions of the browser's (Notification,
  // navigator.share / clipboard, jellyToast). A test calls installSinks() once,
  // then turns recording on around the scenario: __sinkRec.on = true. The
  // wrapped app functions still run the original afterwards.
  sandbox.installSinks = () => {
    const wrapGlobal = (name, kind, textOf) => {
      const orig = vm.runInContext(name, ctx);
      sandbox['__sink_' + name] = function (...args) {
        if (rec.on) rec.log.push({ kind, text: String(textOf(args)) });
        return orig.apply(this, args);
      };
      vm.runInContext(`${name} = __sink_${name}`, ctx);
    };
    wrapGlobal('showToast', 'toast', (a) => a[0]);
    wrapGlobal('maybeNativeNotification', 'notification', (a) => a[0] + ' ' + a[1]);
    wrapGlobal('copyTextToClipboard', 'copy', (a) => a[0]);
    ['playAlertChime', 'playMineChime', 'playHighScore', 'playAlarm'].forEach((n) => wrapGlobal(n, 'chime', () => n));
    const NotificationStub = function (title, o) { if (rec.on) rec.log.push({ kind: 'Notification', text: title + ' ' + ((o && o.body) || '') }); };
    NotificationStub.permission = 'granted';
    NotificationStub.requestPermission = () => Promise.resolve('granted');
    sandbox.Notification = NotificationStub;
    sandbox.navigator.share = (d) => { if (rec.on) rec.log.push({ kind: 'share', text: String((d && (d.text || d.title)) || '') }); return Promise.resolve(); };
    sandbox.navigator.clipboard = { writeText: (t) => { if (rec.on) rec.log.push({ kind: 'clipboard', text: String(t) }); return Promise.resolve(); } };
    sandbox.jellyToast = (msg) => { if (rec.on) rec.log.push({ kind: 'jellyToast', text: String(msg) }); return null; };
  };
  return { ctx, sandbox };
}

// ── Assertions (injected into each test context) ──────────────────

class AssertionError extends Error {}

function fail(msg) { throw new AssertionError(msg); }

function show(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

const assert = {
  ok(v, msg) { if (!v) fail(msg || `expected truthy, got ${show(v)}`); },
  notOk(v, msg) { if (v) fail(msg || `expected falsy, got ${show(v)}`); },
  equal(actual, expected, msg) {
    if (actual !== expected) fail(msg ? `${msg} — expected ${show(expected)}, got ${show(actual)}` : `expected ${show(expected)}, got ${show(actual)}`);
  },
  deepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) fail(msg ? `${msg} — expected ${e}, got ${a}` : `expected ${e}, got ${a}`);
  },
  throws(fn, msg) {
    try { fn(); } catch (e) { return; }
    fail(msg || 'expected the call to throw');
  },
  doesNotThrow(fn, msg) {
    try { fn(); } catch (e) { fail(`${msg || 'expected no throw'} — threw ${e && e.message}`); }
  },
};

module.exports = { makeContext, clearAllTimers, assert, AssertionError };
