// auth-email-link.js is an optional classic script the harness doesn't load
// with the app, so evaluate it here (it only needs EMAIL_SIGNIN_KEY from
// app.js and the DOM stub) and exercise mount().

(0, eval)(readFixture('../auth-email-link.js'));

function mountedHTML() {
  const slot = document.createElement('div');
  window.CampEmailLink.mount(slot);
  return slot.innerHTML;
}

test('email-link sign-in is offered in a normal browser', () => {
  navigator.standalone = undefined;
  const html = mountedHTML();
  assert.ok(html.includes('id="email-link-send"'), 'the form is there');
  assert.ok(html.includes('5 email links'), 'with the free-plan cap line');
});

test('the installed iOS Home Screen app is told to use Google or phone instead (no form, no wasted email)', () => {
  navigator.standalone = true;
  const html = mountedHTML();
  navigator.standalone = undefined;
  assert.notOk(html.includes('email-link-send'), 'no send button — each send burns a shared daily email');
  assert.ok(html.includes('Safari'), 'says why');
  assert.ok(html.includes('Google or phone sign-in'), 'and what to use instead');
});

test('navigator.standalone=false (iOS Safari tab) still gets the form', () => {
  navigator.standalone = false;
  const html = mountedHTML();
  navigator.standalone = undefined;
  assert.ok(html.includes('id="email-link-send"'));
});
