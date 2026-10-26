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
  // (jelly-collapsible headers, jelly-tabs, jelly-drawer[open]…) still out-rank
  // it. The plain `html:not(.jelly-failed) :not(:defined)` form is (0,2,1) and
  // hides every card header on a cold load.
  assert.ok(CSS.includes(':where(html:not(.jelly-failed)) :not(:defined) {'), 'the hide is wrapped in :where()');
  assert.notOk(/^html:not\(\.jelly-failed\)\s+:not\(:defined\)/m.test(CSS), 'no un-wrapped (higher-specificity) form');
  assert.notOk(/^:not\(:defined\)\s*\{/m.test(CSS), 'and no permanent, unconditional hide');
});

test('a failed module still leaves a usable sign-in button and readable cards', () => {
  assert.ok(/html\.jelly-failed jelly-button:not\(:defined\)\s*\{[^}]*display:\s*inline-block/.test(CSS));
  assert.ok(/html\.jelly-failed jelly-button\[block\]:not\(:defined\)\s*\{[^}]*display:\s*block/.test(CSS));
  assert.ok(/html\.jelly-failed jelly-collapsible:not\(:defined\) > :not\(\[slot="header"\]\)\s*\{[^}]*display:\s*block/.test(CSS));
});

test('boot-guard.js detects a module that never came up, in its own IIFE', () => {
  assert.ok(GUARD.includes("jelly-failed"), 'it sets the class');
  assert.ok(GUARD.includes('script[src*="vendor/jelly.js"]'), 'network failure: the module tag\'s error event');
  assert.ok(GUARD.includes("addEventListener('error'"), 'parse failure: the window error event');
  assert.ok(GUARD.includes('setTimeout(check, 4000)'), 'backstop timer');
  assert.ok(GUARD.includes("whenDefined('jelly-button')"), 'and the class is withdrawn if the elements do appear');
  assert.equal((GUARD.match(/^\(function \(\) \{/gm) || []).length, 2, 'the new guard is a SEPARATE IIFE from the lock/framing guard');
});

test('boot-guard.js stays a classic, blocking <script> in <head> (or the app flashes before it locks)', () => {
  const tag = /<script\s+src="boot-guard\.js\?v=\d+"><\/script>/.exec(INDEX);
  assert.ok(tag, 'a plain classic script tag: no type=module, defer or async');
  assert.ok(tag.index < INDEX.indexOf('</head>'), 'and it is in <head>');
});
