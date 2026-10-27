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
  localStorage.setItem(THEME_HINT_KEY, 'dark'); // the pre-paint mirror of the theme choice
  localStorage.setItem('campWeatherCache', '{}'); // public data — may stay

  clearLocalData();

  [STORAGE_KEY, DAY_RANK_KEY, CHANGE_DISMISS_KEY, ANNOUNCE_DISMISS_KEY,
   AUTH_HINT_KEY, EMAIL_SIGNIN_KEY, THEME_HINT_KEY].forEach((k) => {
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

// ── Camp switching on denial (the senior-only counselor's first sign-in) ──

// A tiny firebase stub: enough for denyMember()'s other-camp probe. The
// harness deliberately ships no firebase, so each test installs what it needs.
function stubFirebaseProbe(recordsByPath) {
  globalThis.firebase = {
    apps: [{}],
    database: () => ({
      ref: (path) => ({
        once: () => (path in recordsByPath
          ? Promise.resolve({ val: () => recordsByPath[path] })
          : Promise.reject(new Error('permission denied'))),
      }),
    }),
  };
}

test('denied here but approved at the other camp → auto-switch, exactly once', async () => {
  sessionStorage.removeItem(CAMP_SWITCH_TRIED_KEY);
  localStorage.removeItem(ACTIVE_CAMP_KEY);
  const before = __reloads;
  authUser = { email: 'senior.only@example.com' };
  stubFirebaseProbe({ 'seniorScoreboard/members/senior,only@example,com': { role: 'viewer', name: 'Sam' } });

  denyMember();
  await Promise.resolve().then(() => {}).then(() => {}); // let the probe's microtasks drain

  assert.equal(localStorage.getItem(ACTIVE_CAMP_KEY), 'senior', 'the device flipped to the camp that knows them');
  assert.equal(__reloads, before + 1, 'the switch is a reload');
  assert.equal(sessionStorage.getItem(CAMP_SWITCH_TRIED_KEY), '1', 'the one-shot guard is armed');
  assert.deepEqual(readCampsHint(), { senior: 'viewer' }, 'the hint remembers where they belong');

  // Denied AGAIN after the bounce (revoked there too, or a race): the guard
  // must stop a reload loop and land on the plain denial screen.
  stubFirebaseProbe({});
  denyMember();
  await Promise.resolve().then(() => {}).then(() => {});
  assert.equal(__reloads, before + 1, 'no second bounce — the loop guard held');

  delete globalThis.firebase;
  sessionStorage.removeItem(CAMP_SWITCH_TRIED_KEY);
  localStorage.removeItem(ACTIVE_CAMP_KEY);
  localStorage.removeItem(CAMPS_HINT_KEY);
  authUser = null;
  setMemberRole('editor'); // restore what earlier tests in this file expect
});

test('the camp-bounce guard is re-armed by approval and by sign-out', async () => {
  // A senior-only counselor is bounced once (guard armed, reload into senior).
  // Approval there must clear the guard — otherwise a later sign-out lands on
  // junior with the guard still set and the counselor is turned away without
  // the senior probe ever running ("lock-out until the PWA is killed").
  sessionStorage.removeItem(CAMP_SWITCH_TRIED_KEY);
  localStorage.removeItem(ACTIVE_CAMP_KEY);
  authUser = { email: 'senior.only@example.com' };
  const seniorPath = 'seniorScoreboard/members/senior,only@example,com';
  stubFirebaseProbe({ [seniorPath]: { role: 'viewer', name: 'Sam' } });
  const tick = () => Promise.resolve().then(() => {}).then(() => {});

  const before = __reloads;
  denyMember();
  await tick();
  assert.equal(__reloads, before + 1, 'first sign-in bounces');
  assert.equal(sessionStorage.getItem(CAMP_SWITCH_TRIED_KEY), '1');

  // Landed in senior, approved: the guard has done its job. (The app-start
  // steps need a real DOM; stub them — only the guard is under test.)
  const real = { startApp, startSync, probeOtherCamp, maybeShowCampPicker };
  startApp = startSync = probeOtherCamp = maybeShowCampPicker = () => {};
  onMemberSnapshot({ val: () => ({ role: 'viewer', name: 'Sam' }) });
  Object.assign(globalThis, real);
  assert.equal(sessionStorage.getItem(CAMP_SWITCH_TRIED_KEY), null, 'approval clears the one-shot guard');

  // A DENIED snapshot must not clear it — that is the loop guard for
  // denied-in-both (it is also why clearLocalData must not touch it).
  sessionStorage.setItem(CAMP_SWITCH_TRIED_KEY, '1');
  stubFirebaseProbe({});
  onMemberSnapshot({ val: () => null });
  await tick();
  assert.equal(sessionStorage.getItem(CAMP_SWITCH_TRIED_KEY), '1', 'a denial keeps the guard armed');

  // Sign out → fresh start → the next senior-only sign-in bounces again.
  localStorage.removeItem(ACTIVE_CAMP_KEY);
  authUser = { email: 'senior.only@example.com' };
  stubFirebaseProbe({ [seniorPath]: { role: 'viewer', name: 'Sam' } });
  globalThis.firebase.auth = () => ({ signOut: () => Promise.resolve() });
  finishSignOut();
  await tick();
  assert.equal(sessionStorage.getItem(CAMP_SWITCH_TRIED_KEY), null, 'sign-out clears the guard');

  authUser = { email: 'senior.only@example.com' };
  stubFirebaseProbe({ [seniorPath]: { role: 'viewer', name: 'Sam' } });
  const mid = __reloads;
  denyMember();
  await tick();
  assert.equal(localStorage.getItem(ACTIVE_CAMP_KEY), 'senior', 'the second sign-in is bounced to senior');
  assert.ok(__reloads > mid, 'and reloads into it');

  delete globalThis.firebase;
  sessionStorage.removeItem(CAMP_SWITCH_TRIED_KEY);
  localStorage.removeItem(ACTIVE_CAMP_KEY);
  localStorage.removeItem(CAMPS_HINT_KEY);
  authUser = null;
  setMemberRole('editor');
});

test('denied at BOTH camps → the denial screen, no reload', async () => {
  sessionStorage.removeItem(CAMP_SWITCH_TRIED_KEY);
  const before = __reloads;
  authUser = { email: 'stranger@example.com' };
  stubFirebaseProbe({}); // every probe refused

  denyMember();
  await Promise.resolve().then(() => {}).then(() => {});

  assert.equal(__reloads, before, 'no bounce anywhere');
  assert.equal(localStorage.getItem(ACTIVE_CAMP_KEY), null, 'still junior');
  assert.notOk(canEdit(), 'denyMemberFinal cleared the role');

  delete globalThis.firebase;
  authUser = null;
  setMemberRole('editor');
});

test('the other-camp probe records the second camp and its role', async () => {
  localStorage.removeItem(CAMPS_HINT_KEY);
  otherCampProbed = false;
  authUser = { email: 'both@example.com' };
  stubFirebaseProbe({ 'seniorScoreboard/members/both@example,com': { role: 'editor' } });

  probeOtherCamp();
  await Promise.resolve().then(() => {}).then(() => {});

  assert.equal(otherCampRole, 'editor');
  assert.deepEqual(readCampsHint().senior, 'editor');
  assert.notOk(hasBothCamps(), 'only once THIS camp also writes its hint');
  setAuthHint('editor'); // what onMemberSnapshot does for the active camp
  assert.ok(hasBothCamps(), 'now the picker has something to ask about');

  // Probe is one-shot per load: a second call never re-reads.
  stubFirebaseProbe({}); // would record null if it ran
  probeOtherCamp();
  await Promise.resolve().then(() => {}).then(() => {});
  assert.equal(readCampsHint().senior, 'editor', 'unchanged — the probe did not re-run');

  delete globalThis.firebase;
  otherCampProbed = false;
  otherCampRole = null;
  authUser = null;
  localStorage.removeItem(CAMPS_HINT_KEY);
  localStorage.removeItem(AUTH_HINT_KEY);
  setMemberRole('editor');
});

// ── The members drawer only ever CREATES (never overwrites) ───────

// A fake member database. transaction() follows RTDB's contract: the updater
// sees the current value (null when absent) and returning undefined aborts.
// set() records an unconditional overwrite, which is what these paths must
// never do to an existing record.
function fakeMemberDb(initial) {
  const data = Object.assign({}, initial);
  const sets = [];
  globalThis.firebase = {
    apps: [{}],
    database: () => ({
      ref: (path) => ({
        set: (v) => { sets.push(path); data[path] = v; return Promise.resolve(); },
        remove: () => { delete data[path]; return Promise.resolve(); },
        transaction: (fn) => {
          const next = fn(path in data ? data[path] : null);
          if (next === undefined) return Promise.resolve({ committed: false });
          data[path] = next;
          return Promise.resolve({ committed: true });
        },
      }),
    }),
  };
  return { data, sets };
}

// Drive bindMemberList's "Add someone" button the way the drawer does: fill
// the form stubs, capture the click handler, fire it, and report what showed.
async function submitMemberAdd(form, lists) {
  const el = (id) => document.getElementById(id);
  el('member-add-id').value = form.id;
  el('member-add-name').value = form.name || '';
  el('member-add-role').value = form.role || 'viewer';
  el('member-add-camps').value = form.camps || 'active';
  el('member-add-team').value = form.team || '';
  const err = el('member-add-error');
  err.hidden = true; err.textContent = '';
  let handler = null;
  el('member-add-btn').addEventListener = (type, fn) => { if (type === 'click') handler = fn; };
  const toasts = [];
  const realToast = showToast;
  showToast = (m) => { toasts.push(m); };
  const body = document.createElement('div');
  bindMemberList(body, identityKey(authUser), lists);
  handler();
  await new Promise((r) => setTimeout(r, 0));
  showToast = realToast;
  return { error: err.hidden ? '' : err.textContent, toasts };
}

test('planMemberAdd writes only the camps where the key is absent', () => {
  const here = CAMP.id, there = otherCampId();
  const lists = { [here]: { 'sam@example,com': { role: 'editor' } }, [there]: {} };
  const base = { pending: false, bothCamps: false, myKey: 'me@example,com', lists };

  assert.deepEqual(planMemberAdd({ ...base, key: 'new@example,com' }), { camps: [here] });
  assert.deepEqual(planMemberAdd({ ...base, key: 'new@example,com', bothCamps: true }), { camps: [here, there] });
  assert.ok(planMemberAdd({ ...base, key: 'sam@example,com' }).error, 'already on the list → refused');
  assert.deepEqual(planMemberAdd({ ...base, key: 'sam@example,com', bothCamps: true }), { camps: [there] },
    '"both camps" on someone already here grants only the other camp');
  assert.ok(planMemberAdd({ ...base, key: 'me@example,com' }).error, 'your own key is refused');
  assert.deepEqual(planMemberAdd({ ...base, key: 'pending-sam-abc12', pending: true, bothCamps: true }),
    { camps: [here] }, 'a pending row stays single-camp');
});

test('re-adding someone already on the list changes nothing (no demotion, name/team kept)', async () => {
  setMemberRole('editor');
  authUser = { email: 'dir@example.com' };
  const sam = { role: 'editor', name: 'Sam', teamId: 't2', addedBy: 'x', addedAt: 'y' };
  const db = fakeMemberDb({ [campMembersPath(CAMP.id, 'sam@example,com')]: sam });
  const lists = { [CAMP.id]: { 'sam@example,com': sam }, [otherCampId()]: null };

  // The form defaults — Viewer, no name, no team — would have replaced Sam's
  // record with a bare viewer one.
  const out = await submitMemberAdd({ id: 'Sam@Example.com' }, lists);

  assert.ok(out.error.includes('Already on the list'), 'the editor is told why: ' + out.error);
  assert.equal(db.sets.length, 0, 'nothing was overwritten');
  assert.deepEqual(db.data[campMembersPath(CAMP.id, 'sam@example,com')], sam, 'Sam is exactly as he was');

  // The race the drawer's own lists can't see: another editor added Sam since
  // this drawer loaded, so lists says "absent" but the database says otherwise.
  const stale = { [CAMP.id]: {}, [otherCampId()]: null };
  const raced = await submitMemberAdd({ id: 'sam@example.com' }, stale);
  assert.ok(raced.error.includes('Already on the list'), 'the transaction aborts on an existing key');
  assert.deepEqual(db.data[campMembersPath(CAMP.id, 'sam@example,com')], sam, 'still untouched');

  delete globalThis.firebase;
  authUser = null;
});

test('adding a new person still works, and "both camps" grants only the missing camp', async () => {
  setMemberRole('editor');
  authUser = { email: 'dir@example.com' };
  const here = CAMP.id, there = otherCampId();
  const db = fakeMemberDb({});
  setMemberRole('editor');
  const lists = { [here]: {}, [there]: {} };

  const added = await submitMemberAdd({ id: 'New.Kid@example.com', name: 'Kid', role: 'editor', team: 't1' }, lists);
  assert.equal(added.error, '');
  const rec = db.data[campMembersPath(here, 'new,kid@example,com')];
  assert.equal(rec.role, 'editor');
  assert.equal(rec.name, 'Kid');
  assert.equal(rec.teamId, 't1');
  assert.equal(db.data[campMembersPath(there, 'new,kid@example,com')], undefined, 'this camp only');

  // Already here, absent there: "Both camps" must leave the existing record alone.
  const sam = { role: 'editor', name: 'Sam', teamId: 't2', addedBy: 'x', addedAt: 'y' };
  db.data[campMembersPath(here, 'sam@example,com')] = sam;
  const granted = await submitMemberAdd({ id: 'sam@example.com', camps: 'both' },
    { [here]: { 'sam@example,com': sam }, [there]: {} });
  assert.equal(granted.error, '');
  assert.deepEqual(db.data[campMembersPath(here, 'sam@example,com')], sam, 'the existing camp is untouched');
  assert.equal(db.data[campMembersPath(there, 'sam@example,com')].role, 'viewer', 'the missing camp is granted');

  delete globalThis.firebase;
  authUser = null;
});

test('an editor cannot add (demote) their own account from the add form', async () => {
  setMemberRole('editor');
  authUser = { email: 'Dir@Example.com' };
  const db = fakeMemberDb({});
  const out = await submitMemberAdd({ id: 'dir@example.com' }, { [CAMP.id]: {}, [otherCampId()]: null });
  assert.ok(out.error.includes('your own account'), out.error);
  assert.equal(Object.keys(db.data).length, 0, 'nothing written');
  delete globalThis.firebase;
  authUser = null;
});

test('converting a pending row refuses an existing member or yourself, and never overwrites', async () => {
  setMemberRole('editor');
  authUser = { email: 'dir@example.com' };
  const sam = { role: 'editor', name: 'Sam', teamId: 't2', addedBy: 'x', addedAt: 'y' };
  const pendingRec = { role: 'viewer', name: 'Sammy', teamId: 't0', addedBy: 'x', addedAt: 'y' };
  const db = fakeMemberDb({
    [campMembersPath(CAMP.id, 'sam@example,com')]: sam,
    [campMembersPath(CAMP.id, 'pending-sammy-abc12')]: pendingRec,
  });
  const lists = { [CAMP.id]: { 'sam@example,com': sam, 'pending-sammy-abc12': pendingRec } };
  const toasts = [];
  const realToast = showToast, realPrompt = prompt;
  showToast = (m) => { toasts.push(m); };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // Pointed at somebody already listed (list says so).
  prompt = () => 'sam@example.com';
  convertPendingMember('pending-sammy-abc12', pendingRec, lists);
  await tick();
  assert.ok(toasts.pop().includes('Already on the list'));
  assert.deepEqual(db.data[campMembersPath(CAMP.id, 'sam@example,com')], sam, 'Sam untouched');
  assert.ok(db.data[campMembersPath(CAMP.id, 'pending-sammy-abc12')], 'the pending row is kept');

  // Their own account.
  prompt = () => 'DIR@example.com';
  convertPendingMember('pending-sammy-abc12', pendingRec, lists);
  await tick();
  assert.ok(toasts.pop().includes('your own account'));

  // The race: the list is stale, the database already has Sam → transaction aborts,
  // and the pending row must NOT be removed.
  prompt = () => 'sam@example.com';
  convertPendingMember('pending-sammy-abc12', pendingRec, { [CAMP.id]: {} });
  await tick();
  assert.ok(toasts.pop().includes('Already on the list'));
  assert.deepEqual(db.data[campMembersPath(CAMP.id, 'sam@example,com')], sam, 'still untouched');
  assert.ok(db.data[campMembersPath(CAMP.id, 'pending-sammy-abc12')], 'pending row survives the aborted create');

  // The happy path still converts: new key written, placeholder removed.
  prompt = () => 'sammy@example.com';
  convertPendingMember('pending-sammy-abc12', pendingRec, lists);
  await tick();
  const made = db.data[campMembersPath(CAMP.id, 'sammy@example,com')];
  assert.ok(made && made.name === 'Sammy' && made.teamId === 't0', 'converted record carries name and team');
  assert.equal(db.data[campMembersPath(CAMP.id, 'pending-sammy-abc12')], undefined, 'placeholder removed');

  showToast = realToast; prompt = realPrompt;
  delete globalThis.firebase;
  authUser = null;
});

// ── Google sign-in always shows the account chooser ───────────────

test('the Google button asks for the account chooser (so "use a different account" can work)', () => {
  let click = null;
  document.getElementById('google-signin-btn').addEventListener = (type, fn) => { if (type === 'click') click = fn; };
  sdkLoadFailed = false;
  wireAuthScreen();
  assert.ok(click, 'the button is wired');

  let provider = null;
  class FakeProvider { setCustomParameters(p) { this.params = p; } }
  globalThis.firebase = {
    apps: [{}],
    auth: Object.assign(() => ({ signInWithPopup: (p) => { provider = p; return Promise.resolve(); } }),
      { GoogleAuthProvider: FakeProvider }),
  };
  click();
  assert.ok(provider instanceof FakeProvider, 'a Google provider was used');
  assert.deepEqual(provider.params, { prompt: 'select_account' });
  delete globalThis.firebase;
});
