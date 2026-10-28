// Theme handling: what applyTheme() puts on the page, what it mirrors for the
// pre-paint guard, and how Auto follows the OS. The visible result (palette,
// fades, flashes) is only checkable in a browser; these pin the state-level
// rules each fix rests on, with a recording stub for the classList calls.

// applyTheme() announces itself to Jelly with a window CustomEvent, which the
// stub window doesn't have.
window.CustomEvent = function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; };
window.dispatchEvent = () => true;

function recordClasses(el) {
  const calls = { toggled: {}, added: [], removed: [] };
  el.classList = {
    toggle: (c, on) => { calls.toggled[c] = !!on; },
    add: (c) => calls.added.push(c),
    remove: (c) => calls.removed.push(c),
    contains: () => false,
  };
  return calls;
}

function osScheme(dark) {
  const listeners = [];
  window.matchMedia = () => ({
    matches: dark,
    addEventListener: (type, fn) => { if (type === 'change') listeners.push(fn); },
    addListener: () => {},
    removeEventListener: () => {},
  });
  return { flip: (nowDark) => { dark = nowDark; listeners.forEach((fn) => fn()); }, listeners };
}

function themeKey() { return localStorage.getItem(THEME_HINT_KEY); }

test('Auto never sets body.dark-theme, even on a dark OS (the @media block owns Auto)', () => {
  // A stale dark-theme class from Auto + dark OS is what stranded the dark
  // tokens (podium rows, gold text, shadows) after the OS flipped to light:
  // the class outranks the media block and nothing re-ran applyTheme.
  osScheme(true);
  state.theme = null;
  const body = recordClasses(document.body);
  applyTheme();
  assert.equal(body.toggled['dark-theme'], false, 'Auto + OS dark: the class stays off');
  assert.equal(body.toggled['light-theme'], false);
});

test('an explicit choice still sets its class, whatever the OS says', () => {
  osScheme(false);
  state.theme = 'dark';
  let body = recordClasses(document.body);
  applyTheme();
  assert.equal(body.toggled['dark-theme'], true);
  osScheme(true);
  state.theme = 'light';
  body = recordClasses(document.body);
  applyTheme();
  assert.equal(body.toggled['dark-theme'], false);
  assert.equal(body.toggled['light-theme'], true);
});

test('an explicit choice is mirrored for the pre-paint guard; Auto removes the mirror', () => {
  osScheme(false);
  setTheme('dark');
  assert.equal(themeKey(), 'dark');
  setTheme('light');
  assert.equal(themeKey(), 'light');
  setTheme('auto');
  assert.equal(themeKey(), null, 'Auto = no key, so the guard leaves the palette to the OS');
});

test('the mirror key is the literal boot-guard.js reads', () => {
  assert.equal(THEME_HINT_KEY, 'campScoreboardTheme');
  assert.ok(readFixture('../boot-guard.js').includes("localStorage.getItem('campScoreboardTheme')"),
    'boot-guard.js reads the same key applyTheme() writes');
});

test('the theme-color meta tracks an OS flip while on Auto', () => {
  const os = osScheme(false);
  state.theme = null;
  appliedLook = null;
  watchOsColorScheme();
  assert.equal(os.listeners.length, 1, 'one change listener is registered');
  applyTheme();
  const meta = document.getElementById('dynamic-theme-color');
  assert.equal(meta.content, '#ffffff', 'light OS: light chrome');
  os.flip(true);
  assert.equal(meta.content, '#181b1d', 'OS went dark: the no-media meta (which beats the media metas) follows');
  os.flip(false);
  assert.equal(meta.content, '#ffffff', 'and back');
});

test('an explicit choice ignores an OS flip', () => {
  const os = osScheme(false);
  state.theme = 'light';
  appliedLook = null;
  watchOsColorScheme();
  applyTheme();
  const meta = document.getElementById('dynamic-theme-color');
  os.flip(true);
  assert.equal(meta.content, '#ffffff', 'Light stays light when the phone goes dark');
});

test('a real flip suspends colour transitions; the first paint and a no-op re-apply do not', () => {
  osScheme(false);
  state.theme = null;
  appliedLook = null;
  const root = recordClasses(document.documentElement);
  applyTheme(); // first call: the initial paint, not a flip
  assert.deepEqual(root.added, [], 'initial apply starts no suspension');
  applyTheme(); // same look again (init() calls it after boot())
  assert.deepEqual(root.added, [], 'a re-apply that changes nothing starts none');
  state.theme = 'dark';
  applyTheme(); // light -> dark
  assert.deepEqual(root.added, ['theme-switching'], 'light -> dark suspends transitions');
  state.theme = null; // Auto on a light OS = light again
  applyTheme();
  assert.equal(root.added.length, 2, 'and so does dark -> light');
  state.theme = 'light'; // light -> light (Auto -> explicit Light): nothing changes on screen
  applyTheme();
  assert.equal(root.added.length, 2, 'a choice that lands on the same look is not a flip');
});

// ── Pre-paint hints (boot-guard.js runs before first paint) ─────────────
// boot-guard is loaded here on its own, against a stub document, so the classes
// it paints before boot() can be read back. A dual-role account's single hint
// holds whichever camp it was approved on last; the active camp's ledger entry
// is the role this device actually runs as.
function paintedByBootGuard(entries) {
  const store = new Map(entries);
  const classes = new Set();
  const root = {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
  };
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: {
      documentElement: root, head: { appendChild() {} }, getElementById: () => null, querySelector: () => null,
      querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, classList: { add() {} } }),
      addEventListener() {}, readyState: 'loading',
    },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {},
    customElements: { whenDefined: () => Promise.resolve(), get: () => undefined },
  };
  sb.window = sb; sb.self = sb; sb.top = sb;
  const ctx = nodeRequire('vm').createContext(sb);
  nodeRequire('vm').runInContext(readFixture('../boot-guard.js'), ctx, { filename: 'boot-guard.js' });
  return [...classes];
}

test('pre-paint: a dual-role account paints the ACTIVE camp\'s role, not the last camp it was approved on', () => {
  const both = JSON.stringify({ junior: 'viewer', senior: 'editor' });
  assert.ok(paintedByBootGuard([['campScoreboardAuthHint', 'editor'], ['campScoreboardCampsHint', both]]).includes('view-only'),
    'junior (the default camp) is a counselor there, whatever the single hint says');
  assert.deepEqual(paintedByBootGuard([['campScoreboardAuthHint', 'viewer'], ['campScoreboardActiveCamp', 'senior'], ['campScoreboardCampsHint', both]]), [],
    'senior: a director there, so no view-only class');
  assert.deepEqual(paintedByBootGuard([]), ['locked'], 'no hint at all stays locked');
  assert.deepEqual(paintedByBootGuard([['campScoreboardAuthHint', 'viewer']]), ['view-only'], 'a single-camp viewer is unchanged');
});
