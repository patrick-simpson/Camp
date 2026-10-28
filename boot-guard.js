// Pre-paint lock guard. Runs before the page paints so we never flash the app,
// and never show a blank page: exactly one of #app / #lock-screen shows.
//
// This lives in its own file, rather than inline in index.html, for one reason:
// an inline <script> forces 'unsafe-inline' on the CSP's script-src, and that
// single token is what would let an injected <script> run. Externalizing it is
// what makes the policy worth having. A hash would work too, but it would have
// to be recomputed by hand on every edit of this file — and with no build step
// a stale hash is a dead site, so a file it is.
//
// It must stay a CLASSIC script (no type="module", no defer, no async) in
// <head>: those all defer execution until after the document parses, which is
// after first paint, which would reintroduce the flash this prevents.
//
// Sign-in itself resolves asynchronously (Firebase persists sessions in
// IndexedDB), so this guard runs on the cached hint from the LAST confirmed
// sign-in: an approved device paints the app immediately from local state while
// auth re-confirms in the background; anyone else gets the lock screen with no
// flash. The hint is convenience only — the database rules never consult it, so
// forging it shows an empty shell.
//
// Keep the storage key literals in sync with AUTH_HINT_KEY / THEME_HINT_KEY in
// app.js.
(function () {
  // Nothing legitimately embeds this app. Being framed means someone is trying
  // to get a signed-in editor to click something they can't see, so break out.
  // The CSP can't say this: frame-ancestors is ignored in a meta tag, and
  // GitHub Pages can't send headers.
  try {
    if (window.top !== window.self) { window.top.location = window.self.location; return; }
  } catch (e) {
    // Cross-origin parent: we can't even read top.location, which is itself the
    // answer. Stay blank rather than render inside their frame.
    document.documentElement.classList.add('locked');
    return;
  }
  try {
    // One-time cleanup of the retired PIN gate's keys (pre-2026-07-25).
    localStorage.removeItem('campScoreboardUnlocked');
    localStorage.removeItem('campScoreboardRole');
    localStorage.removeItem('campScoreboardEditEpoch');
    // An EXPLICIT Light/Dark choice (mirrored here by applyTheme() in app.js —
    // the choice itself lives inside the big state JSON, which only loads with
    // app.js). Setting data-jelly-mode now lets styles.css paint the right
    // palette from the first frame; without it a user whose choice differs from
    // the OS got the OS palette until boot(), then a flip. Auto leaves it unset.
    var theme = localStorage.getItem('campScoreboardTheme');
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-jelly-mode', theme);
    }
    var hint = localStorage.getItem('campScoreboardAuthHint');
    // An account on both camps keeps one single hint, which holds whichever camp it
    // was approved on last. The ledger entry for the ACTIVE camp is what this device
    // runs as (boot() reads the same entry), so it decides the role when it has one.
    // A device with no hint at all stays locked, exactly as before.
    try {
      var activeCamp = localStorage.getItem('campScoreboardActiveCamp') === 'senior' ? 'senior' : 'junior';
      var ledger = JSON.parse(localStorage.getItem('campScoreboardCampsHint') || 'null');
      var campRole = ledger && typeof ledger === 'object' ? ledger[activeCamp] : null;
      if (hint && (campRole === 'viewer' || campRole === 'editor')) hint = campRole;
    } catch (e) { /* the single hint stands */ }
    if (hint !== 'viewer' && hint !== 'editor') {
      document.documentElement.classList.add('locked');
    } else if (hint === 'viewer') {
      // Same class applyRoleClass() sets once boot() runs. Pre-paint, so the
      // editors' controls (the "Hide from viewers" rows) can't show to a viewer
      // in the gap before boot() — which only matters if the Jelly module fails
      // and the unstyled card bodies are visible.
      document.documentElement.classList.add('view-only');
    }
  } catch (e) {
    // Storage blocked: show the lock screen — sign-in will still work, it just
    // can't be remembered.
    document.documentElement.classList.add('locked');
  }
})();

// Second, independent guard (its own IIFE so the framing/lock logic above can
// never be affected by it): notice when vendor/jelly.js did not come up, and
// say so with html.jelly-failed. styles.css hides every not-yet-defined custom
// element to avoid a flash of unstyled controls while the deferred module
// loads; if the module NEVER loads, that hide would be permanent — including
// the Google sign-in button. Two ways it never loads: the request fails (flaky
// camp wifi, most likely right after a deploy when every phone reloads at once)
// or it can't be parsed (it uses class static blocks, which need iOS/iPadOS
// 16.4+, so iPhone 6s/7/SE1 and iPad Air 2/mini 4 are permanently affected).
// The class is withdrawn if the elements do appear after all (a slow fetch).
(function () {
  var root = document.documentElement;
  function defined() {
    return !!(window.customElements && window.customElements.get('jelly-button'));
  }
  // Every signal re-checks the one fact that matters, so a late runtime error
  // thrown from inside a module that DID load can't trip it.
  function check() { if (!defined()) root.classList.add('jelly-failed'); }
  try {
    // The module tag precedes this script in <head> and its fetch cannot have
    // finished yet, so both listeners attach in time.
    var tag = document.querySelector('script[src*="vendor/jelly.js"]');
    if (tag) tag.addEventListener('error', check);          // network failure
    window.addEventListener('error', function (e) {          // parse/evaluation failure
      if (/jelly\.js/.test((e && e.filename) || '')) check();
    });
    // A module script runs after the document has parsed and every parser-
    // blocking body script (the three Firebase SDKs, app.js, chat.js…) has
    // loaded, but BEFORE 'load' fires — so by 'load' the module has had its
    // chance, and elements still undefined means it failed, whether or not this
    // browser reported either error above (old Safari). This replaced a 4 s
    // timer that tripped on a merely SLOW load: card bodies and editor rows
    // flashed unstyled, then re-collapsed when the module landed (CLS 1.07).
    window.addEventListener('load', check);
    // Last-resort backstop for a request that HANGS (no error, and no 'load'
    // either, because the document can't finish). Generous for the same reason.
    setTimeout(check, 15000);
    if (window.customElements && window.customElements.whenDefined) {
      window.customElements.whenDefined('jelly-button').then(function () {
        root.classList.remove('jelly-failed');
      });
    }
  } catch (e) { /* a guard that can't run must never break the page */ }
})();

// Third, independent guard: switch the Google Fonts stylesheet on once it has
// loaded. index.html ships it as media="print" — a print-only stylesheet is
// fetched at low priority and NEVER blocks first paint, whereas a plain
// stylesheet <link> does (display=swap only governs the font FILES). With
// fonts.googleapis.com slow or filtered, the blocking form left the whole page
// — lock screen included — blank until that request timed out. The usual
// onload="this.media='all'" trick is an inline handler, which the CSP refuses,
// so it is done here. If the stylesheet never arrives the page simply keeps
// its system-ui fallback.
(function () {
  try {
    var link = document.getElementById('gfonts');
    if (!link) return;
    var on = function () { link.media = 'all'; };
    link.addEventListener('load', on);
    if (link.sheet) on(); // it finished before this script ran
  } catch (e) { /* a guard that can't run must never break the page */ }
})();
