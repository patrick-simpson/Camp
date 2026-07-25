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
const APP_FILES = ['defaults.js', 'app.js', 'settings.js'];

const noop = () => {};

// Minimal stand-in for one DOM element: enough that render functions called
// incidentally (e.g. by saveState → renderAll paths) no-op instead of throwing.
// Tests assert on state and return values, never on rendered markup — anything
// that needs real layout belongs in the Playwright pass (see CLAUDE.md).
function stubEl() {
  const kids = new Map();
  const el = {
    hidden: false, innerHTML: '', textContent: '', className: '', value: '', checked: false,
    dataset: {}, children: [], files: null, isContentEditable: false, tagName: 'DIV',
    style: { setProperty: noop, removeProperty: noop, getPropertyValue: () => '' },
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    appendChild: noop, insertAdjacentHTML: noop, remove: noop, focus: noop, blur: noop, click: noop,
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    hasAttribute: () => false, toggleAttribute: noop, closest: () => null,
    // Same memoized-stub rule as document.querySelector (see makeContext).
    querySelector: (sel) => {
      if (!kids.has(sel)) kids.set(sel, stubEl());
      return kids.get(sel);
    },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  return el;
}

function makeContext() {
  const store = new Map();
  // Lookups return a memoized stub rather than null: the render functions are
  // written against a page where their container always exists, so handing back
  // an element (the same one each time, like the real DOM) lets tests call the
  // render path — including via saveState → renderAll — without every function
  // needing a defensive null check it doesn't need in the browser.
  const byId = new Map();
  const bySelector = new Map();
  const doc = {
    documentElement: stubEl(),
    body: stubEl(),
    head: stubEl(),
    activeElement: null,
    hidden: false,
    visibilityState: 'visible',
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, stubEl());
      return byId.get(id);
    },
    querySelector: (sel) => {
      if (!bySelector.has(sel)) bySelector.set(sel, stubEl());
      return bySelector.get(sel);
    },
    querySelectorAll: () => [],
    createElement: stubEl,
    createElementNS: stubEl,
    addEventListener: noop,
    removeEventListener: noop,
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
    location: { search: '', href: 'http://localhost/index.html', pathname: '/index.html', origin: 'http://localhost' },
    navigator: { userAgent: 'node', share: undefined, onLine: true },
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop, removeEventListener: noop }),
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, scrollY: 0, scrollX: 0,
    crypto: require('crypto').webcrypto,
    setTimeout, clearTimeout,
    // Timers that would otherwise keep the process alive forever (the 30s
    // render loop, the 500ms clock ticker, the sync idle retry) are inert here;
    // tests drive those code paths by calling the tick functions directly.
    setInterval: () => 0,
    clearInterval: noop,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
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
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  APP_FILES.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
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

module.exports = { makeContext, assert, AssertionError };
