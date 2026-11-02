// The page shell (index.html / boot-guard.js / styles.css) never runs under the
// harness — it has no CSS engine and no real module loader — so the behavior is
// verified in a browser (Playwright). These pin the few text-level invariants a
// careless edit would silently break; each exists because the alternative is a
// shell that looks fine on a desktop and is dead on a phone.

const CSS = readFixture('../styles.css');
const GUARD = readFixture('../boot-guard.js');
const INDEX = readFixture('../index.html');

test('the not-yet-defined hide is time-limited and keeps its original specificity', () => {
  // :where() is load-bearing: it keeps the hide at (0,1,0), the same as the old
  // bare `:not(:defined)`, so the per-element pre-upgrade fallbacks
  // (jelly-tabs, jelly-drawer[open]…) still out-rank
  // it. The plain `html:not(.jelly-failed) :not(:defined)` form is (0,2,1) and
  // hides every card header on a cold load.
  assert.ok(CSS.includes(':where(html:not(.jelly-failed)) :not(:defined) {'), 'the hide is wrapped in :where()');
  assert.notOk(/^html:not\(\.jelly-failed\)\s+:not\(:defined\)/m.test(CSS), 'no un-wrapped (higher-specificity) form');
  assert.notOk(/^:not\(:defined\)\s*\{/m.test(CSS), 'and no permanent, unconditional hide');
});

test('a failed module still leaves a usable sign-in button and readable sections', () => {
  assert.ok(/html\.jelly-failed jelly-button:not\(:defined\)\s*\{[^}]*display:\s*inline-block/.test(CSS));
  assert.ok(/html\.jelly-failed jelly-button\[block\]:not\(:defined\)\s*\{[^}]*display:\s*block/.test(CSS));
  // The home cards no longer fold open (no jelly-collapsible, no accordion), so there
  // is no pre-upgrade body hide left to gate: nothing may re-introduce one.
  assert.notOk(/jelly-(accordion|collapsible)/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')), 'no accordion / collapsible rules');
});

test('boot-guard.js detects a module that never came up, in its own IIFE', () => {
  assert.ok(GUARD.includes("jelly-failed"), 'it sets the class');
  assert.ok(GUARD.includes('script[src*="vendor/jelly.js"]'), 'network failure: the module tag\'s error event');
  assert.ok(GUARD.includes("addEventListener('error'"), 'parse failure: the window error event');
  // 'load' is the real "the module has had its chance" signal: a module script
  // runs after the document and every parser-blocking body script, but before
  // 'load'. The old 4 s timer tripped on a merely slow load (card bodies + editor
  // rows flashed, then re-collapsed: CLS 1.07); the timer left is only the
  // backstop for a request that HANGS, so it must stay long.
  assert.ok(/addEventListener\('load', check\)/.test(GUARD), "after 'load' an undefined module is a failed one");
  const m = /setTimeout\(check, (\d+)\)/.exec(GUARD);
  assert.ok(m, 'backstop timer');
  assert.ok(+m[1] >= 15000, 'and it is long enough not to mistake a slow load for a failed one');
  assert.ok(GUARD.includes("whenDefined('jelly-button')"), 'and the class is withdrawn if the elements do appear');
  assert.equal((GUARD.match(/^\(function \(\) \{/gm) || []).length, 3, 'the jelly guard and the fonts guard are SEPARATE IIFEs from the lock/framing guard');
});

test('boot paints no half-built shell, in the right palette, with a stable background', () => {
  // The palette: boot-guard sets data-jelly-mode pre-paint from the mirrored
  // choice, and styles.css must honour it from the first frame.
  assert.ok(GUARD.includes("setAttribute('data-jelly-mode', theme)"), 'the guard applies an explicit choice pre-paint');
  assert.ok(CSS.includes(':root[data-jelly-mode="dark"] body'), 'the dark tokens answer to the pre-paint attribute');
  assert.ok(CSS.includes(':root:not([data-jelly-mode]) body:not(.light-theme):not(.dark-theme)'),
    'and the OS-dark block yields to an explicit Light');
  // The --color-bg fallbacks ARE Jelly's own defaults, so its tokens landing is
  // not a colour change; and nothing fades the body (a fade left inherited text
  // mid-transition against already-flipped surfaces, and made the token landing
  // visible).
  assert.equal((CSS.match(/--color-bg: var\(--jelly-color-background-default, #ffffff\)/g) || []).length, 1);
  assert.equal((CSS.match(/--color-bg: var\(--jelly-color-background-default, #181b1d\)/g) || []).length, 2);
  assert.notOk(/--jelly-color-background-default, #(f4f6f9|10141c)/.test(CSS), 'no off-palette --color-bg fallback');
  const bodyRule = /^body \{[^}]*\}/m.exec(CSS);
  assert.ok(bodyRule && !/transition/.test(bodyRule[0].replace(/\/\*[\s\S]*?\*\//g, '')), 'body has no colour transition');
  assert.ok(/html\.theme-switching \*[^{]*\{[^}]*transition:\s*none\s*!important/.test(CSS), 'a flip suspends transitions');
});

test('the Google Fonts stylesheet does not block first paint', () => {
  // A plain stylesheet <link> is render-blocking: with fonts.googleapis.com slow
  // the whole page (lock screen included) stayed blank. media="print" is
  // non-blocking; boot-guard.js flips it on load (an inline onload= is refused
  // by the CSP).
  const tag = /<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/.exec(INDEX);
  assert.ok(tag, 'the fonts <link> exists');
  assert.ok(/media="print"/.test(tag[0]), 'it is non-blocking (media="print")');
  assert.ok(/id="gfonts"/.test(tag[0]), 'and addressable by the guard');
  assert.ok(GUARD.includes("getElementById('gfonts')") && GUARD.includes("link.media = 'all'"), 'the guard switches it on once loaded');
  assert.notOk(/\sonload=/i.test(INDEX.replace(/<!--[\s\S]*?-->/g, '')), 'no inline handler — the CSP forbids it');
});

test('a viewer-hinted device is view-only from the first frame', () => {
  assert.ok(/hint === 'viewer'[\s\S]{0,400}classList\.add\('view-only'\)/.test(GUARD),
    "the guard applies the same class applyRoleClass() does");
});

test('a failed module leaves sheets closable, and Appearance is plain buttons that need no module', () => {
  const APP = readFixture('../app.js');
  assert.ok(/jelly-drawer:not\(:defined\)\[open\]::before,\s*jelly-dialog:not\(:defined\)\[open\]::before\s*\{[^}]*Close/.test(CSS),
    'the pre-upgrade sheet carries a visible Close bar');
  // Both fallbacks must stand down the moment the component exists, or they
  // would fight (and double-fire with) the real drawer / segmented control.
  assert.ok(/customElements\.get\('jelly-drawer'\)\) return;\s*\n\s*const open = /.test(APP), 'outside-tap / Close-bar dismissal is gated on the drawer being undefined');
  // The dismissal rule itself, with duck-typed sheets (top edge at y=100).
  const sheet = (kids) => ({ contains: (t) => t === sheet1 || kids.includes(t), getBoundingClientRect: () => ({ top: 100 }) });
  const content = {};
  const sheet1 = sheet([content]);
  const other = { contains: (t) => t === other, getBoundingClientRect: () => ({ top: 400 }) };
  assert.equal(failedModuleSheetsToClose([sheet1], {}, 300).length, 1, 'a tap outside the sheet closes it');
  assert.equal(failedModuleSheetsToClose([sheet1, other], {}, 300).length, 2, 'and every open sheet');
  assert.deepEqual(failedModuleSheetsToClose([sheet1], content, 120), [], 'a tap on its content closes nothing');
  assert.deepEqual(failedModuleSheetsToClose([sheet1], sheet1, 130), [sheet1], 'a tap on the Close bar (top 52px of the sheet itself) closes just that sheet');
  assert.deepEqual(failedModuleSheetsToClose([sheet1, other], sheet1, 120), [sheet1], 'not the other open sheet');
  assert.deepEqual(failedModuleSheetsToClose([sheet1], sheet1, 200), [], 'a tap on the sheet itself below the bar is not a dismissal');
  assert.deepEqual(failedModuleSheetsToClose([], {}, 0), [], 'nothing open, nothing to close');
  // Theme, Calm motion and Camp are radio-group <button>s in More (wireSegs), so a
  // failed module leaves them working with no fallback at all.
  assert.ok(/id="theme-toggle" role="radiogroup"/.test(INDEX) && /class="seg-btn" role="radio"/.test(INDEX), 'Appearance is plain radio buttons');
  assert.notOk(/jelly-segmented/.test(INDEX.replace(/<!--[\s\S]*?-->/g, '')), 'no jelly-segmented left in the page');
});

test('the TV page (current-standings.js) does not flash the sign-in overlay for a healthy, fast approval', () => {
  const TV = readFixture('../current-standings.js'); // the page's script moved out of the HTML in Step 2
  assert.ok(/var CHECK_OVERLAY_DELAY_MS = \d{4}/.test(TV), "'checking' waits before it covers the page");
  assert.ok(/if \(checkTimer\) \{ clearTimeout\(checkTimer\)/.test(TV), 'any later mode cancels the pending overlay');
  assert.ok(/function paintAuthOverlay\(/.test(TV), "and 'signin' / 'denied' still paint immediately");
});

test('boot-guard.js stays a classic, blocking <script> in <head> (or the app flashes before it locks)', () => {
  const tag = /<script\s+src="boot-guard\.js\?v=\d+"><\/script>/.exec(INDEX);
  assert.ok(tag, 'a plain classic script tag: no type=module, defer or async');
  assert.ok(tag.index < INDEX.indexOf('</head>'), 'and it is in <head>');
});

// ── Calm motion (redesign D0): no motion media queries, calm painted pre-paint ──

// Every motion rule answers to the ONE switch, html.calm-motion (jelly-motion.js
// decides it; boot-guard.js paints it). A @media (prefers-reduced-motion) query
// left in styles.css would be a second, disagreeing answer: the OS setting is
// already inside calmMotion(), and "Off" must not be able to un-calm it.
test('styles.css has no motion media query left; every animation rule answers to html.calm-motion', () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.notOk(/prefers-reduced-motion/.test(css), 'no @media (prefers-reduced-motion …) in any form');
  const rules = [...css.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)];
  // Whole selectors only: 'html.calm-motion .toast-out' must not stand in for
  // '.toast' (a substring search once accepted exactly that).
  const calmCounterparts = new Set();
  rules.forEach(([, sel]) => sel.split(',').map((x) => x.trim()).forEach((x) => {
    if (x.startsWith('html.calm-motion ')) calmCounterparts.add(x.slice('html.calm-motion '.length));
  }));
  const unguarded = [];
  rules.forEach(([, sel, body]) => {
    const m = /(?:^|[;\s])animation:\s*([^;]*)/.exec(body);
    if (!m || /^none\b/.test(m[1].trim())) return;
    sel.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      if (s.startsWith('html:not(.calm-motion)') || s.startsWith('html.calm-motion')) return;
      if (calmCounterparts.has(s)) return; // its calm counterpart (the same whole selector) switches it off
      unguarded.push(s);
    });
  });
  // Tap sparkles are spawned by joyBurst(), which spawns nothing while calm.
  assert.deepEqual(unguarded.filter((s) => s !== '.joy-p'), [], 'these animate while calm: ' + unguarded.join(' | '));
  assert.ok(/html\.calm-motion \.lock-box\.shake \{ animation: none; \}/.test(CSS), 'the old unguarded lock-shake is gated too');
  assert.notOk(/transition:\s*all/.test(css), 'and transition: all stays banned');
});

// Runs the REAL boot-guard.js against a stub page. `os` = the phone's reduce-motion
// setting; `storage` seeds localStorage; `blocked` makes storage throw.
function runGuard({ os, storage, blocked }) {
  const vmm = nodeRequire('vm');
  const classes = new Set(); const attrs = {};
  const store = new Map(Object.entries(storage || {}));
  const sb = {
    document: {
      documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } },
      querySelector: () => null, getElementById: () => null,
    },
    localStorage: blocked ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
      : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    setTimeout: () => 0,
    addEventListener: () => {},
    matchMedia: (q) => ({ matches: /reduced-motion/.test(q) ? !!os : false }),
  };
  sb.window = sb; sb.top = sb; sb.self = sb;
  vmm.runInContext(GUARD, vmm.createContext(sb), { filename: 'boot-guard.js' });
  return { classes, attrs };
}

test('boot-guard paints the first frame calm for the OS setting or a calm last session, and never otherwise', () => {
  const plain = runGuard({ os: false, storage: {} });
  assert.notOk(plain.classes.has('calm-motion')); assert.equal(plain.attrs['data-jelly-motion'], undefined);
  const os = runGuard({ os: true, storage: {} });
  assert.ok(os.classes.has('calm-motion'), 'a phone set to reduce motion is calm on a first-ever visit');
  assert.equal(os.attrs['data-jelly-motion'], 'reduce', "and Jelly's own components start calm too");
  const last = runGuard({ os: false, storage: { campScoreboardCalmLast: 'battery-saver' } });
  assert.ok(last.classes.has('calm-motion'), 'the last session was calm: this frame is too');
  assert.equal(last.attrs['data-jelly-motion'], 'reduce');
  const off = runGuard({ os: true, storage: { campScoreboardCalmMotion: 'off' } });
  assert.ok(off.classes.has('calm-motion'), 'the OS beats a stored Off here as everywhere');
  const blocked = runGuard({ os: true, blocked: true });
  assert.ok(blocked.classes.has('calm-motion'), 'blocked storage still honours the OS setting');
  assert.ok(blocked.classes.has('locked'), '(and still locks, as before)');
});

// A deploy bumps every ?v= together (CLAUDE.md's checklist). One missed bump
// strands phones on a mix of builds, and the new script is the easiest to
// forget: jelly-motion.js is the fifteenth, setup-sync.js the sixteenth, setup-ui.js the seventeenth.
test('index.html: the seventeen versioned assets share ONE ?v=, which is APP_VERSION, and jelly-motion.js loads between camps.js and app.js', () => {
  const refs = [...INDEX.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\?v=(\d+))"/g)]
    .filter((m) => !/^https?:/.test(m[1]) && !/manifest\.json|apple-touch-icon/.test(m[1]));
  const files = refs.map((m) => m[1].split('?')[0]);
  assert.deepEqual(files, ['vendor/jelly.js', 'styles.css', 'boot-guard.js', 'firebase-config.js', 'defaults.js', 'camp-core.js',
    'reveal-core.js', 'camps.js', 'jelly-motion.js', 'app.js', 'setup-sync.js', 'settings.js', 'setup-ui.js', 'chat.js', 'push.js', 'auth-phone.js', 'auth-email-link.js'],
  'every code asset, in load order');
  const versions = [...new Set(refs.map((m) => m[2]))];
  assert.equal(versions.length, 1, 'one number on all of them: ' + versions.join(', '));
  assert.equal(+versions[0], APP_VERSION, 'and it is APP_VERSION (it drives the auto-reload check)');
});

// jelly-motion.js is the one script app.js cannot do without at LOAD (it calls
// JellyMotion.busySource at top level). The ?v= test above catches a wrong
// number; these catch the tag or the file going missing, and prove the app
// survives it anyway (chat.js and push.js are typeof-guarded the same way).
test('jelly-motion.js has its tag in index.html and exists on disk', () => {
  assert.ok(/<script\s+src="jelly-motion\.js\?v=\d+"><\/script>/.test(INDEX), 'a plain classic script tag');
  assert.ok(readFixture('../jelly-motion.js').includes('G.JellyMotion = JM'), 'and the file it names is there and publishes the global');
});

test('app.js still boots when jelly-motion.js never loaded: a no-op stand-in, nothing calm, the same storage keys', () => {
  const vm = nodeRequire('vm');
  const { makeContext } = nodeRequire('./harness.js');
  let boot;
  assert.doesNotThrow(() => { boot = makeContext({ without: ['jelly-motion.js'] }); }, 'app.js, settings.js, chat.js and push.js all load');
  const get = (expr) => vm.runInContext(expr, boot.ctx);
  assert.equal(get('calmMotion()'), false);
  assert.equal(get('calmReason()'), null);
  assert.equal(get('JellyMotion.pref()'), 'auto');
  assert.equal(get('JellyMotion.press(null, {})'), null);
  assert.equal(get('JellyMotion.release(null)'), null);
  assert.doesNotThrow(() => get('renderAll()'), 'a render with the stand-in');
  const MOTION = readFixture('../jelly-motion.js');
  assert.equal(get('JellyMotion.keys.pref'), /PREF_KEY = '([^']+)'/.exec(MOTION)[1], 'the stand-in names the real switch key (clearLocalData wipes it)');
  assert.equal(get('JellyMotion.keys.last'), /LAST_KEY = '([^']+)'/.exec(MOTION)[1]);
  // and with the real file present the stand-in is never installed
  assert.ok(JellyMotion.presets && JellyMotion.presets.wobble, 'the normal context has the real JellyMotion, not the stand-in');
});

test('the calm keys in boot-guard.js are the literals jelly-motion.js writes', () => {
  const MOTION = readFixture('../jelly-motion.js');
  const last = /LAST_KEY = '([^']+)'/.exec(MOTION)[1];
  assert.ok(GUARD.includes("'" + last + "'"), 'the guard reads ' + last);
  assert.equal(last, 'campScoreboardCalmLast');
  assert.equal(/PREF_KEY = '([^']+)'/.exec(MOTION)[1], 'campScoreboardCalmMotion');
});

test('the frame\'s roots are where the shell expects them: chat in its tab, the game in a takeover, no leftovers', () => {
  const tab = (id) => INDEX.slice(INDEX.indexOf('id="' + id + '"'));
  const between = (a, b) => INDEX.slice(INDEX.indexOf('id="' + a + '"'), INDEX.indexOf('id="' + b + '"'));
  assert.ok(between('tab-chat', 'tab-more').includes('id="chat-view"'), '#chat-view lives inside the Chat tab (it moved out of Now)');
  assert.notOk(between('tab-now', 'tab-games').includes('chat-view'), 'Now no longer carries the chat takeover');
  assert.notOk(/id="chat-card"|id="game-view"/.test(INDEX), 'the home chat card and the appended game view are gone');
  assert.ok(/id="takeover-game-body"/.test(INDEX) && /id="takeover-game-back-label"/.test(INDEX), 'the game takeover has its body and its labelled back');
  ['now', 'games', 'chat', 'more'].forEach((t) => {
    assert.ok(INDEX.includes('id="tab-btn-' + t + '"') && INDEX.includes('id="tab-' + t + '"'), t + ' has its button and its panel');
  });
  assert.ok(between('tab-now', 'tab-games').includes('id="now-banner"') && between('tab-now', 'tab-games').includes('id="live-home"'),
    'Now hosts today\'s banner and live home unchanged');
  assert.notOk(/chat-open/.test(CSS) || /chat-open/.test(readFixture('../app.js')) || /chat-open/.test(readFixture('../chat.js')), 'no body.chat-open anywhere: chat is a tab');
});
