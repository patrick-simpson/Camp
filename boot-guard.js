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
// Keep the storage key literal in sync with AUTH_HINT_KEY in app.js.
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
    var hint = localStorage.getItem('campScoreboardAuthHint');
    if (hint !== 'viewer' && hint !== 'editor') {
      document.documentElement.classList.add('locked');
    }
  } catch (e) {
    // Storage blocked: show the lock screen — sign-in will still work, it just
    // can't be remembered.
    document.documentElement.classList.add('locked');
  }
})();
