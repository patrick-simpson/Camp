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
  // Card bodies stay readable on a failed load by the pre-upgrade `display: none`
  // simply not applying — NOT by a `display: block` override. That override sat
  // at (0,3,2) and out-ranked `html.view-only .card-visibility-row` / `.card-desc`
  // / `.standings-hint`, so a viewer on a failed load saw the editors' controls.
  assert.ok(CSS.includes(':where(html:not(.jelly-failed)) jelly-collapsible:not(:defined) > :not([slot="header"]) {'),
    'the body hide is gated on :where(html:not(.jelly-failed)), at its original specificity');
  assert.notOk(/^html\.jelly-failed jelly-collapsible:not\(:defined\) > :not\(\[slot="header"\]\)/m.test(CSS),
    'and no high-specificity display:block override remains to trample the view-only hides');
  assert.notOk(/^jelly-collapsible:not\(:defined\) > :not\(\[slot="header"\]\)\s*\{/m.test(CSS),
    'and no un-gated hide, which would blank every card body on a failed load');
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
  // The pre-upgrade accordion header stack is a failed-module fallback ONLY.
  // On a normal load the global :not(:defined) hide keeps it invisible until the
  // module (which releases DOMContentLoaded, and with it boot()) has run — a
  // visible stack of five bare headers was shoved ~620px down by the real
  // content on every open (CLS 0.43).
  assert.ok(/^html\.jelly-failed jelly-accordion:not\(:defined\)\s*\{[^}]*visibility:\s*visible/m.test(CSS),
    'the accordion header stack is gated on html.jelly-failed');
  assert.ok(/^html\.jelly-failed jelly-collapsible:not\(:defined\)\s*\{[^}]*visibility:\s*visible/m.test(CSS),
    'and so are the collapsible headers');
  assert.notOk(/^jelly-(accordion|collapsible):not\(:defined\)\s*\{/m.test(CSS),
    'no ungated rule re-paints the shell before the module is defined');
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

test('a failed module leaves sheets closable and Appearance tappable (touch phones have no Escape)', () => {
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
  assert.ok(/customElements\.get\('jelly-segmented'\)\) return;[\s\S]{0,160}#theme-toggle jelly-segment/.test(APP), 'the Appearance fallback is gated on the segmented control being undefined');
});

test('current-standings.html does not flash the sign-in overlay for a healthy, fast approval', () => {
  const TV = readFixture('../current-standings.html');
  assert.ok(/var CHECK_OVERLAY_DELAY_MS = \d{4}/.test(TV), "'checking' waits before it covers the page");
  assert.ok(/if \(checkTimer\) \{ clearTimeout\(checkTimer\)/.test(TV), 'any later mode cancels the pending overlay');
  assert.ok(/function paintAuthOverlay\(/.test(TV), "and 'signin' / 'denied' still paint immediately");
});

test('boot-guard.js stays a classic, blocking <script> in <head> (or the app flashes before it locks)', () => {
  const tag = /<script\s+src="boot-guard\.js\?v=\d+"><\/script>/.exec(INDEX);
  assert.ok(tag, 'a plain classic script tag: no type=module, defer or async');
  assert.ok(tag.index < INDEX.indexOf('</head>'), 'and it is in <head>');
});
