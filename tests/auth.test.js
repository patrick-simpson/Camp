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

// ── The copy-and-send invite ──────────────────────────────────────

test('inviteText tailors the message to how they sign in and what they can do', () => {
  const emailEditor = inviteText(emailKey('coach@example.com'), 'editor');
  assert.ok(emailEditor.includes('coach@example.com'), 'names the email');
  assert.ok(/Continue with Google/.test(emailEditor), 'points an email member at Google');
  assert.ok(/enter scores/.test(emailEditor), 'an editor is told they can enter scores');

  const phoneViewer = inviteText(phoneKey('555-123-4567'), 'viewer');
  assert.ok(phoneViewer.includes('+15551234567'), 'names the normalized phone number');
  assert.ok(/phone number/.test(phoneViewer), 'points a phone member at phone sign-in');
  assert.ok(/see all the scores/.test(phoneViewer), 'a viewer is told they can watch');
  assert.notOk(/Continue with Google/.test(phoneViewer), 'no Google line for a phone member');
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

// ── Teams on accounts: who's on which team, and what that blocks ──

test('memberRecord carries a teamId, and omits a junk one', () => {
  assert.equal(memberRecord('viewer', 'Cam', 't0').teamId, 't0');
  assert.notOk('teamId' in memberRecord('viewer', 'Cam', ''), 'no team → omitted, never null');
  assert.notOk('teamId' in memberRecord('viewer', 'Cam', null));
  assert.notOk('teamId' in memberRecord('viewer', 'Cam', 'nope'), 'a non-team string is not stored');
});

test('canScoreRound only guards people who are ON a team', () => {
  setMemberRole('editor');
  setMemberTeam(null);
  assert.ok(canScoreRound('t0'), 'an unassigned editor scores everything');
  assert.ok(canScoreRound('t0', 't1'));

  setMemberTeam('t2');
  assert.ok(canScoreRound('t0', 't1'), 'a round without their team is theirs to run');
  assert.notOk(canScoreRound('t2'), 'their own team is not');
  assert.notOk(canScoreRound('t0', 't2'), 'nor a matchup their team is in');
  assert.notOk(canScoreRound('t2', 't3'), 'either side of the matchup counts');

  setMemberRole('viewer');
  assert.notOk(canScoreRound('t0'), 'a viewer scores nothing, team or no team');
  setMemberRole('editor');
  setMemberTeam(null);
});

test('blockedByOwnTeam distinguishes "guarded" from "just not an editor"', () => {
  setMemberRole('viewer');
  setMemberTeam('t2');
  assert.notOk(blockedByOwnTeam('t2'), 'a viewer sees the normal view-only UI, not the guard note');
  setMemberRole('editor');
  assert.ok(blockedByOwnTeam('t2'), 'an assigned editor gets the explanation');
  assert.notOk(blockedByOwnTeam('t3'));
  setMemberTeam(null);
  assert.notOk(blockedByOwnTeam('t2'));
});

test('the own-team guard actually refuses the point writes, not just the buttons', () => {
  setMemberRole('editor');
  setMemberTeam('t1');
  state.bonuses = {};
  setVersePoints('t1', 1, 5);
  assert.equal(Object.keys(state.bonuses).length, 0, 'their own team earns nothing from them');
  setCleanupPoints('t1', 1, 'Breakfast', 3);
  assert.equal(Object.keys(state.bonuses).length, 0);
  setVersePoints('t3', 1, 5);
  assert.equal(Object.keys(state.bonuses).length, 1, 'another team is fine');
  state.bonuses = {};
  setMemberTeam(null);
});

// ── Pending members (a name + team, no sign-in yet) ───────────────

test('a pending key can never collide with a real sign-in identity', () => {
  // If a pending key could equal an identityKey, whoever signed in with that
  // identity would inherit the placeholder row. Email keys always contain '@';
  // phone keys always start with '+'. A pending key must have neither.
  ['Alysa', 'TJ', 'Mary-Kate O\'Brien', '  ', '', 'a@b.com', '+15551234567'].forEach((n) => {
    const k = pendingKey(n);
    assert.ok(isPendingKey(k), `${k} is recognizable as pending`);
    assert.notOk(k.includes('@'), `${k} must not look like an email key`);
    assert.notOk(k.startsWith('+'), `${k} must not look like a phone key`);
    assert.ok(/^[a-z0-9-]+$/.test(k), `${k} is a legal RTDB key`);
  });
  assert.notOk(isPendingKey('patrick,simpson,fx@gmail,com'));
  assert.notOk(isPendingKey('+15551234567'));
});

test('two people with the same name get distinct pending keys', () => {
  assert.notOk(pendingKey('Sam') === pendingKey('Sam'), 'the random tail keeps them apart');
});

// ── The one-tap counselor seed ────────────────────────────────────

test('the seed list covers every team with real names', () => {
  const teamIds = SEED_COUNSELORS.map(([id]) => id);
  assert.equal(teamIds.length, new Set(teamIds).size, 'no team listed twice');
  teamIds.forEach((id) => assert.ok(isTeamId(id), `${id} is a team id`));
  SEED_COUNSELORS.forEach(([, names]) => {
    assert.ok(names.length > 0);
    names.forEach((n) => assert.ok(n && n.trim() === n, `"${n}" is a clean name`));
  });
});

test('seeding is idempotent — matched by name, however they signed up', () => {
  const all = missingSeedCounselors({});
  assert.equal(all.length, SEED_COUNSELORS.reduce((n, [, names]) => n + names.length, 0));

  // Someone already there as a pending row, and someone who has since been
  // given a real email — neither should be offered again.
  const members = {
    'pending-alysa-ab12': { role: 'viewer', name: 'Alysa', teamId: 't0' },
    'cam@example,com': { role: 'viewer', name: 'cam', teamId: 't0' },
  };
  const left = missingSeedCounselors(members);
  assert.equal(left.length, all.length - 2, 'both are recognized');
  assert.notOk(left.some((c) => c.name === 'Alysa'));
  assert.notOk(left.some((c) => c.name.toLowerCase() === 'cam'), 'name match is case-insensitive');
  assert.equal(missingSeedCounselors(null).length, all.length, 'a pruned/empty list is safe');
});

// ── Counselor names come from the directory, with a fallback ──────

test('teamStaffNames reads the live directory and stays sorted', () => {
  memberDirectory = {
    'zac@example,com': { role: 'viewer', name: 'Zac', teamId: 't1' },
    'pending-bria-xy99': { role: 'viewer', name: 'Bria', teamId: 't1' },
    'abby@example,com': { role: 'viewer', name: 'Abby', teamId: 't4' },
    'nobody@example,com': { role: 'editor', name: 'Director' }, // no team
  };
  assert.deepEqual(teamStaffNames('t1'), ['Bria', 'Zac']);
  assert.deepEqual(teamStaffNames('t4'), ['Abby']);
  assert.deepEqual(teamStaffNames('t2'), [], 'nobody assigned → empty, so the fallback wins');
  memberDirectory = null;
  assert.deepEqual(teamStaffNames('t1'), [], 'directory not loaded → empty');
});

test('counselorName prefers the directory, falls back to the typed text', () => {
  state.teams[2].counselor = 'Jovi/Brody/Josh (A)';
  memberDirectory = null;
  assert.equal(counselorName('t2'), 'Jovi/Brody/Josh (A)', 'before the directory loads');
  memberDirectory = {
    'jovi@example,com': { role: 'viewer', name: 'Jovi', teamId: 't2' },
    'josh@example,com': { role: 'editor', name: 'Josh', teamId: 't2' },
  };
  assert.equal(counselorName('t2'), 'Josh, Jovi', 'assigned staff win, alphabetically');
  assert.equal(counselorName('t0'), state.teams[0].counselor, 'an unassigned team keeps its text');
  memberDirectory = null;
});

test('a member with no name shows their sign-in identity as the counselor', () => {
  memberDirectory = { 'coach,mike@example,com': { role: 'viewer', teamId: 't3' } };
  assert.equal(counselorName('t3'), 'coach.mike@example.com');
  memberDirectory = null;
});

// ── Auto-following the team your account says you're on ───────────

test('an account with a team answers the picker for you', () => {
  state.followTeam = undefined;
  state.identity = undefined;
  setMemberTeam(null);
  assert.notOk(adoptMemberTeam(), 'nothing to adopt without an assignment');

  memberName = 'Bria';
  setMemberTeam('t1');
  assert.ok(adoptMemberTeam(), 'it answered the question');
  assert.equal(state.followTeam, 't1');
  assert.equal(state.identity, 'Bria', 'a name the electives data knows is adopted too');

  // A hand-picked team loses to the account — otherwise a counselor keeps
  // seeing someone else's team as "yours".
  state.followTeam = 't4';
  adoptMemberTeam();
  assert.equal(state.followTeam, 't1');

  memberName = 'Someone Nobody Lists';
  state.identity = undefined;
  adoptMemberTeam();
  assert.equal(state.identity, null, 'a name the electives data has never heard of is left unset');

  memberName = null;
  setMemberTeam(null);
  state.followTeam = null;
  state.identity = null;
});
