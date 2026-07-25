// ── Email-link sign-in (optional module) ─────────────────────────
// Passwordless sign-in for staff without a Google account: type an email,
// get a link, tap it, you're in. app.js talks to this ONLY through the
// guarded window.CampEmailLink global — delete this file's <script> tag in
// index.html and the feature disappears cleanly (the Google button remains).
//
// KNOWN LIMIT, accepted on purpose (owner's call, 2026-07-25): the project
// stays on Firebase's free plan, which sends at most FIVE sign-in-link
// emails per day, project-wide. The send handler below turns the quota
// error into a plain message pointing at Google sign-in instead of failing
// silently. Raising the limit means attaching billing (Blaze) — see
// IMPROVEMENTS.md.
//
// Flow notes:
// - sendSignInLinkToEmail parks the address in localStorage
//   (EMAIL_SIGNIN_KEY, defined in app.js) because the link may be opened in
//   a DIFFERENT browser (iOS Mail's in-app viewer, a desktop mail client) —
//   in that case we have to ask for the address again to complete sign-in.
// - completeSignInIfLink() runs at startAuth() time; a successful completion
//   lands in onAuthStateChanged like any other sign-in, then the oobCode is
//   stripped from the URL so a reload doesn't try to redeem it twice.

(function () {
  'use strict';

  function auth() { return firebase.auth(); }

  function showError(msg) {
    const errEl = document.getElementById('lock-error');
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
  }

  function sendErrorMessage(err) {
    const code = (err && err.code) || '';
    if (code === 'auth/quota-exceeded' || code === 'auth/too-many-requests') {
      return 'Daily email limit reached — use Google sign-in or try again tomorrow.';
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Email sign-in isn\'t switched on — use Google sign-in.';
    }
    if (code === 'auth/invalid-email') {
      return 'That doesn\'t look like an email address.';
    }
    if (code === 'auth/network-request-failed') {
      return 'You look offline — sending the link needs an internet connection.';
    }
    return 'Couldn\'t send the link (' + (code || 'unknown error') + ') — use Google sign-in.';
  }

  // If this page load IS an emailed link, finish the sign-in. Safe to call
  // unconditionally — it no-ops on a normal load.
  function completeSignInIfLink() {
    let href;
    try {
      href = location.href;
      if (!auth().isSignInWithEmailLink(href)) return;
    } catch (e) { return; }
    let email = null;
    try { email = localStorage.getItem(EMAIL_SIGNIN_KEY); } catch (e) { /* ignore */ }
    if (!email) {
      // Link opened in a different browser than the one that requested it.
      email = prompt('Almost there — confirm the email address this link was sent to:');
    }
    if (!email) {
      showError('Sign-in link not completed — the email address is needed to finish.');
      return;
    }
    auth().signInWithEmailLink(email.trim(), href)
      .then(() => {
        try { localStorage.removeItem(EMAIL_SIGNIN_KEY); } catch (e) { /* ignore */ }
        // Drop the one-time code from the address bar so a reload (or a
        // shared screenshot of the URL) can't try to redeem it again.
        history.replaceState(null, '', location.pathname);
      })
      .catch((err) => {
        const code = (err && err.code) || '';
        showError(code === 'auth/invalid-action-code'
          ? 'That sign-in link has expired or was already used — request a fresh one.'
          : 'The sign-in link didn\'t work (' + (code || 'unknown error') + ') — request a fresh one.');
        history.replaceState(null, '', location.pathname);
      });
  }

  // Render the "email me a link" mini-form into the sign-in panel's slot.
  // Re-rendering on every mount is fine — the panel only shows signed-out.
  // Rendered inside the shared "Alternative sign in" disclosure (see the sign-in
  // screen in index.html and showAuthScreen in app.js), so no <details> of its
  // own — just the titled method block with its free-plan cap line.
  function mount(slotEl) {
    if (!slotEl) return;
    slotEl.innerHTML = `
      <div class="alt-method">
        <div class="alt-method-title">✉️ Email me a sign-in link</div>
        <p class="alt-method-cap">Free plan: up to 5 email links a day for the whole camp.</p>
        <div class="alt-method-form">
          <jelly-input class="form-input" id="email-link-address" type="email" placeholder="name@example.com" label="Email"></jelly-input>
          <jelly-button id="email-link-send" class="secondary-btn" variant="platinum" block>📬 Email me a link</jelly-button>
          <p class="muted email-link-status" id="email-link-status" hidden></p>
        </div>
      </div>`;
    const sendBtn = slotEl.querySelector('#email-link-send');
    const statusEl = slotEl.querySelector('#email-link-status');
    sendBtn.addEventListener('click', () => {
      const email = (slotEl.querySelector('#email-link-address').value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('That doesn\'t look like an email address.');
        return;
      }
      const errEl = document.getElementById('lock-error');
      if (errEl) errEl.hidden = true;
      sendBtn.setAttribute('disabled', '');
      auth().sendSignInLinkToEmail(email, {
        url: location.origin + location.pathname, // must be on an authorized domain
        handleCodeInApp: true,
      }).then(() => {
        try { localStorage.setItem(EMAIL_SIGNIN_KEY, email); } catch (e) { /* ignore */ }
        statusEl.textContent = '📬 Sent! Open the email on THIS device and tap the link.';
        statusEl.hidden = false;
      }).catch((err) => {
        sendBtn.removeAttribute('disabled');
        showError(sendErrorMessage(err));
      });
    });
  }

  window.CampEmailLink = { completeSignInIfLink, mount };
})();
