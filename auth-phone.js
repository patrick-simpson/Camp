// ── Phone sign-in (optional module) ──────────────────────────────
// Passwordless sign-in by phone number, as a backup to Google. app.js talks
// to this ONLY through the guarded window.CampPhone global — delete this
// file's <script> tag in index.html and the feature disappears cleanly (the
// Google button and email-link remain).
//
// KNOWN LIMIT, accepted on purpose (owner's call, 2026-07-25): the project
// stays on Firebase's free plan, which sends at most ~10 verification texts
// per day, project-wide. The cap line below says so up front, and the send
// handler turns the quota error into a plain "use Google" message.
//
// Flow: enter phone number → Firebase texts a 6-digit code → type the code →
// signed in (lands in onAuthStateChanged like any other sign-in). A member
// who will use phone sign-in must be on the list BY PHONE NUMBER (Settings →
// Who can sign in) — the rules identify a phone account by its number, since
// it has no email.
//
// Web phone auth requires a reCAPTCHA check (Firebase's abuse guard). We use
// the INVISIBLE variant against the #recaptcha-container in index.html, so
// most people never see it; occasionally it shows a challenge.

(function () {
  'use strict';

  function auth() { return firebase.auth(); }

  function showError(msg) {
    const errEl = document.getElementById('lock-error');
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
  }

  let verifier = null;         // the invisible reCAPTCHA, made once and reused
  let confirmation = null;     // the pending confirmationResult after a code is sent

  // Build (or reuse) the invisible reCAPTCHA verifier. Kept as a singleton —
  // re-creating it on the same container throws.
  function getVerifier() {
    if (verifier) return verifier;
    verifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', { size: 'invisible' });
    return verifier;
  }

  // After a failed send the reCAPTCHA token is spent — clear it so the next
  // attempt makes a fresh one instead of erroring on the stale widget.
  function resetVerifier() {
    if (!verifier) return;
    try { verifier.clear(); } catch (e) { /* ignore */ }
    verifier = null;
  }

  function sendErrorMessage(err) {
    const code = (err && err.code) || '';
    if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') {
      return "Today's sign-in texts are all used up — please use Google, or try again tomorrow.";
    }
    if (code === 'auth/invalid-phone-number' || code === 'auth/missing-phone-number') {
      return 'That phone number doesn\'t look right — include the area code.';
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Phone sign-in isn\'t switched on — please use Google.';
    }
    if (code === 'auth/network-request-failed') {
      return 'You look offline — sending the code needs an internet connection.';
    }
    if (code === 'auth/captcha-check-failed') {
      return 'The anti-robot check didn\'t pass — reload and try again, or use Google.';
    }
    return 'Couldn\'t send the code (' + (code || 'unknown error') + ') — please use Google.';
  }

  function verifyErrorMessage(err) {
    const code = (err && err.code) || '';
    if (code === 'auth/invalid-verification-code') return 'That code didn\'t match — check it and try again.';
    if (code === 'auth/code-expired') return 'That code expired — send a new one.';
    return 'Couldn\'t verify the code (' + (code || 'unknown error') + ') — try again.';
  }

  function mount(slotEl) {
    if (!slotEl) return;
    slotEl.innerHTML = `
      <div class="alt-method">
        <div class="alt-method-title">📱 Sign in with a phone number</div>
        <p class="alt-method-cap">Free plan: up to 10 texts a day for the whole camp.</p>
        <div class="alt-method-form" id="phone-step-number">
          <jelly-input class="form-input" id="phone-number" type="tel" inputmode="tel" placeholder="555-123-4567" label="Phone number"></jelly-input>
          <jelly-button id="phone-send" class="secondary-btn" variant="platinum" block>📲 Text me a code</jelly-button>
        </div>
        <div class="alt-method-form" id="phone-step-code" hidden>
          <jelly-input class="form-input" id="phone-code" type="text" inputmode="numeric" placeholder="6-digit code" label="Code from the text"></jelly-input>
          <jelly-button id="phone-verify" class="secondary-btn" variant="primary" block>Verify &amp; sign in</jelly-button>
          <button type="button" class="link-btn" id="phone-restart">Use a different number</button>
        </div>
        <p class="muted phone-status" id="phone-status" hidden></p>
      </div>`;

    const numberStep = slotEl.querySelector('#phone-step-number');
    const codeStep = slotEl.querySelector('#phone-step-code');
    const sendBtn = slotEl.querySelector('#phone-send');
    const verifyBtn = slotEl.querySelector('#phone-verify');
    const statusEl = slotEl.querySelector('#phone-status');

    function setStatus(msg) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.hidden = !msg;
    }

    sendBtn.addEventListener('click', () => {
      // phoneKey() lives in app.js (loaded first) — normalize the typed number
      // to the E.164 form Firebase and the member list both use.
      const e164 = (typeof phoneKey === 'function')
        ? phoneKey(slotEl.querySelector('#phone-number').value)
        : '';
      if (!e164) {
        showError('That doesn\'t look like a phone number — include the area code (e.g. 555-123-4567).');
        return;
      }
      const errEl = document.getElementById('lock-error');
      if (errEl) errEl.hidden = true;
      sendBtn.setAttribute('disabled', '');
      setStatus('Sending a code to ' + e164 + '…');
      let appVerifier;
      try {
        appVerifier = getVerifier();
      } catch (e) {
        sendBtn.removeAttribute('disabled');
        setStatus('');
        showError('Couldn\'t start the anti-robot check — reload and try again, or use Google.');
        return;
      }
      auth().signInWithPhoneNumber(e164, appVerifier)
        .then((result) => {
          confirmation = result;
          numberStep.hidden = true;
          codeStep.hidden = false;
          setStatus('📲 Code sent to ' + e164 + '. Enter it below.');
          const codeInput = slotEl.querySelector('#phone-code');
          if (codeInput && codeInput.focus) codeInput.focus();
        })
        .catch((err) => {
          sendBtn.removeAttribute('disabled');
          setStatus('');
          resetVerifier(); // the spent token can't be reused — start fresh next time
          showError(sendErrorMessage(err));
        });
    });

    verifyBtn.addEventListener('click', () => {
      if (!confirmation) { showError('Send yourself a code first.'); return; }
      const code = (slotEl.querySelector('#phone-code').value || '').replace(/\D/g, '');
      if (code.length < 6) { showError('Enter the 6-digit code from the text.'); return; }
      const errEl = document.getElementById('lock-error');
      if (errEl) errEl.hidden = true;
      verifyBtn.setAttribute('disabled', '');
      setStatus('Checking your code…');
      confirmation.confirm(code)
        .then(() => {
          // Signed in — onAuthStateChanged (app.js) takes over from here.
          setStatus('Signed in! One moment…');
        })
        .catch((err) => {
          verifyBtn.removeAttribute('disabled');
          setStatus('');
          showError(verifyErrorMessage(err));
        });
    });

    const restart = slotEl.querySelector('#phone-restart');
    if (restart) {
      restart.addEventListener('click', () => {
        confirmation = null;
        codeStep.hidden = true;
        numberStep.hidden = false;
        sendBtn.removeAttribute('disabled');
        setStatus('');
      });
    }
  }

  window.CampPhone = { mount };
})();
