// The auth gate's pure parts: the email→key contract the security rules
// depend on, the role plumbing behind canEdit(), the member-record shape,
// and what signing out wipes off a device. The Firebase flows themselves
// (popup, member listener) are exercised against the real site — these pin
// the pieces a typo could silently break.

// ── emailKey: the contract shared with the security rules ─────────

test('emailKey lowercases, trims, and replaces EVERY dot', () => {
  // The rules compute the same key with .replace('.', ','), which in the
  // RTDB rules language replaces ALL occurrences. JS .replace would only
  // catch the first dot — and silently lock out any multi-dot address,
  // including the owner's own. This is THE regression to catch.
  assert.equal(emailKey('  Patrick.Simpson.FX@Gmail.COM '), 'patrick,simpson,fx@gmail,com');
  assert.equal(emailKey('a.b.c.d@e.f.co'), 'a,b,c,d@e,f,co');
  assert.equal(emailKey('nodots@example'), 'nodots@example');
  assert.equal(emailKey(''), '');
  assert.equal(emailKey(null), '');
});

test('identityFromKey round-trips a key back to something displayable', () => {
  assert.equal(identityFromKey('patrick,simpson,fx@gmail,com'), 'patrick.simpson.fx@gmail.com');
  assert.equal(identityFromKey(identityKey({ email: 'Some.Name@Example.Org' })), 'some.name@example.org');
  assert.equal(identityFromKey('+15551234567'), '+15551234567', 'a phone key shows as-is');
});

// ── Phone identity — the E.164 contract shared with the rules ─────

test('phoneKey normalizes typed numbers to the E.164 Firebase reports', () => {
  // Firebase reports auth.token.phone_number as E.164 (+1555…); a number an
  // editor types into the member list has to normalize to the exact same thing
  // or that person is silently locked out.
  assert.equal(phoneKey('555-123-4567'), '+15551234567', 'bare US 10-digit → +1');
  assert.equal(phoneKey('(555) 123-4567'), '+15551234567', 'punctuation stripped');
  assert.equal(phoneKey('15551234567'), '+15551234567', 'leading 1 → +1');
  assert.equal(phoneKey('+1 555 123 4567'), '+15551234567', 'already +1, spaces gone');
  assert.equal(phoneKey('+15551234567'), '+15551234567', 'idempotent on what Firebase reports');
  assert.equal(phoneKey('+44 20 7946 0958'), '+442079460958', 'a full international number is kept');
  assert.equal(phoneKey('123'), '', 'too short → empty (rejected)');
  assert.equal(phoneKey(''), '', 'empty → empty');
});

test('identityKey picks email first, then phone', () => {
  assert.equal(identityKey({ email: 'A.B@X.com' }), 'a,b@x,com');
  assert.equal(identityKey({ phoneNumber: '+15551234567' }), '+15551234567');
  assert.equal(identityKey({ email: 'a@b.co', phoneNumber: '+15551234567' }), 'a@b,co', 'email wins when both present');
  assert.equal(identityKey({}), '', 'neither → empty (denied)');
  assert.equal(identityKey(null), '');
});

test('identityLabel is the human-readable email or phone', () => {
  assert.equal(identityLabel({ email: 'a@b.co' }), 'a@b.co');
  assert.equal(identityLabel({ phoneNumber: '+15551234567' }), '+15551234567');
  assert.equal(identityLabel(null), '');
});

test('a phone member and an email member both round-trip key → display', () => {
  // What the Members UI relies on to show a stored key back to an editor.
  assert.equal(identityFromKey(phoneKey('555-123-4567')), '+15551234567');
  assert.equal(identityFromKey(emailKey('Coach.Mike@example.com')), 'coach.mike@example.com');
});

// ── canEdit: the one function every editor-only surface asks ──────

test('canEdit answers only to a confirmed editor role', () => {
  setMemberRole(null);
  assert.notOk(canEdit(), 'unresolved → view-only');
  setMemberRole('viewer');
  assert.notOk(canEdit(), 'viewer → view-only');
  setMemberRole('editor');
  assert.ok(canEdit(), 'editor → can edit');
  setMemberRole('garbage');
  assert.notOk(canEdit(), 'an unknown role is never an editor');
  setMemberRole('edit'); // the OLD role string — must not grant anything
  assert.notOk(canEdit(), 'the retired PIN-era role string grants nothing');
  setMemberRole('editor');
});

// ── memberRecord: what the Members UI writes ──────────────────────

test('memberRecord builds exactly what the rules validate', () => {
  const r = memberRecord('editor', ' Pat ');
  assert.equal(r.role, 'editor');
  assert.equal(r.name, 'Pat', 'name is trimmed');
  assert.ok(typeof r.addedBy === 'string' && r.addedBy.length, 'addedBy is always a string');
  assert.ok(!isNaN(Date.parse(r.addedAt)), 'addedAt is a parseable timestamp');
});

test('memberRecord addedBy is the signed-in identity (email or phone)', () => {
  authUser = { email: 'director@example.com' };
  assert.equal(memberRecord('viewer').addedBy, 'director@example.com');
  authUser = { phoneNumber: '+15551234567' };
  assert.equal(memberRecord('viewer').addedBy, '+15551234567');
  authUser = null;
  assert.equal(memberRecord('viewer').addedBy, 'unknown');
});

test('memberRecord omits an empty name instead of writing null', () => {
  // The rules validate name as a string when present; RTDB rejects null
  // fields inside a set(). Absent is the only safe spelling of "no name".
  assert.notOk('name' in memberRecord('viewer', ''), 'empty string → omitted');
  assert.notOk('name' in memberRecord('viewer', '   '), 'whitespace → omitted');
  assert.notOk('name' in memberRecord('viewer', null), 'null → omitted');
});

test('memberRecord never writes a role outside viewer/editor', () => {
  assert.equal(memberRecord('editor').role, 'editor');
  assert.equal(memberRecord('viewer').role, 'viewer');
  assert.equal(memberRecord('admin').role, 'viewer', 'unknown roles collapse to viewer');
  assert.equal(memberRecord(undefined).role, 'viewer');
});

// ── The pre-paint hint ─────────────────────────────────────────────

test('the auth hint only ever reads back as a real role', () => {
  setAuthHint('editor');
  assert.equal(authHintRole(), 'editor');
  setAuthHint('viewer');
  assert.equal(authHintRole(), 'viewer');
  localStorage.setItem(AUTH_HINT_KEY, '1'); // a forged/legacy value
  assert.equal(authHintRole(), null, 'junk in the hint never becomes a role');
  clearAuthHint();
  assert.equal(authHintRole(), null);
});

// ── Sign-out: what leaves the device ──────────────────────────────

test('clearLocalData wipes the camp data a signed-out device must not keep', () => {
  const store = __localStorageStore;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ teams: [], results: {} }));
  localStorage.setItem(DAY_RANK_KEY, '{"date":"x","ranks":{}}');
  localStorage.setItem(CHANGE_DISMISS_KEY, '[]');
  localStorage.setItem(ANNOUNCE_DISMISS_KEY, '[]');
  localStorage.setItem(AUTH_HINT_KEY, 'editor');
  localStorage.setItem(EMAIL_SIGNIN_KEY, 'someone@example.com');
  localStorage.setItem('campWeatherCache', '{}'); // public data — may stay

  clearLocalData();

  [STORAGE_KEY, DAY_RANK_KEY, CHANGE_DISMISS_KEY, ANNOUNCE_DISMISS_KEY,
   AUTH_HINT_KEY, EMAIL_SIGNIN_KEY].forEach((k) => {
    assert.equal(localStorage.getItem(k), null, `${k} must be cleared`);
  });
  assert.ok(store.has('campWeatherCache'), 'the forecast is not personal — it may stay');
});

// ── The retired PIN gate must actually be gone ─────────────────────

test('no PIN machinery survives in the shipped code', () => {
  ['PIN_KDF_ITERATIONS', 'VIEW_PIN_HASH', 'EDIT_PIN_HASH', 'derivePinHash',
   'pinRole', 'handlePinComplete', 'isUnlocked', 'currentRole'].forEach((name) => {
    assert.equal(typeof globalThis[name], 'undefined', `${name} should be deleted`);
  });
});
