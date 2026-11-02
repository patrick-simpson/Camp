// Owner-only gating (setup-rebuild-spec decision Q8, build step 14 / "S4").
// The two big switches — Edit the week here, the new-year setup, Undo the new-year
// setup — belong to the owner alone. The rules enforce it; these helpers are the
// client half: who the owner IS (from the sign-in, never from anything stored on the
// device), what name the other directors read in their place, and the refusal that
// comes back BEFORE a write. Steps 15, 19 and 28 extend this file as each owner-only
// button arrives; the engine's own refusals (meta/on, epoch, wizard, archive points)
// are pinned in setup-sync.test.js and restore.test.js.

const OO_RULES = JSON.parse(readFixture('../database.rules.json')).rules;
const OO_OWNER = { email: 'Patricksimpson.FX@gmail.com', emailVerified: true };
const OO_DIRECTOR = { email: 'director@example.com', emailVerified: true };

function ooReset() {
  authUser = null;
  setMemberRole(null);
  memberDirectory = null;
  memberDirectoryLoaded = false;
}

test('isOwner() is the sign-in, not a role: only the owner key, as a confirmed editor', () => {
  ooReset();
  assert.equal(isOwner(), false, 'nobody signed in');
  authUser = OO_OWNER;
  assert.equal(isOwner(), false, 'signed in but the member record has not answered');
  setMemberRole('editor', { provisional: true });
  assert.equal(isOwner(), false, 'a role painted from the stored hint proves nothing');
  setMemberRole('editor');
  assert.equal(isOwner(), true, 'the owner, once their editor record answers');
  setMemberRole('viewer');
  assert.equal(isOwner(), false, 'a viewer is never the owner (the owner row is an editor, so this is a forged state)');
  setMemberRole('editor');
  authUser = OO_DIRECTOR;
  assert.equal(isOwner(), false, 'another director');
  authUser = { phoneNumber: '+15551234567' };
  assert.equal(isOwner(), false, 'a phone sign-in never matches the owner email key');
  authUser = { email: 'patricksimpson.fx@gmail.com', emailVerified: false };
  assert.equal(isOwner(), false, 'the rules need a verified address, so the client does not offer what they refuse');
  ooReset();
});

test('nothing on the device can make a phone the owner: a forged hint, camps ledger or role flag changes nothing', () => {
  ooReset();
  authUser = OO_DIRECTOR;
  localStorage.setItem(AUTH_HINT_KEY, 'editor');
  localStorage.setItem('campScoreboardCampsHint', JSON.stringify({ junior: 'editor', senior: 'editor' }));
  localStorage.setItem('campScoreboardOwner', '1');
  setMemberRole('editor');
  assert.equal(isOwner(), false);
  assert.equal(ownerGate('turn on editing').ok, false);
  ooReset();
});

test('ownerName() is the owner row\'s first name, and falls back to "the owner" without one', () => {
  ooReset();
  assert.equal(ownerName(), 'the owner', 'no directory yet');
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick Simpson' } };
  assert.equal(ownerName(), 'the owner', 'a directory that has not ARRIVED is not trusted (fail closed)');
  memberDirectoryLoaded = true;
  assert.equal(ownerName(), 'Patrick', 'the first name');
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor' } };
  assert.equal(ownerName(), 'the owner', 'no name on the row');
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: '   ' } };
  assert.equal(ownerName(), 'the owner', 'a blank name');
  memberDirectory = { 'someone@example,com': { role: 'editor', name: 'Patrick' } };
  assert.equal(ownerName(), 'the owner', 'another member named Patrick is not the owner');
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: 'P'.repeat(80) } };
  assert.equal(ownerName().length, 30, 'cut to something a sentence can hold');
  memberDirectory = {};
  assert.equal(ownerName(), 'the owner', 'the owner row absent');
  ooReset();
});

test('the refusal names the owner, before any write: "Only Patrick can …"', () => {
  ooReset();
  setMemberRole('editor');
  authUser = OO_DIRECTOR;
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick' } };
  memberDirectoryLoaded = true;
  assert.deepEqual(ownerGate('turn on editing'), { ok: false, reason: 'Only Patrick can turn on editing.' });
  const toasts = [];
  const real = showToast;
  showToast = (m) => toasts.push(m);
  try {
    assert.equal(requireOwner('start the new-year setup'), false);
    assert.deepEqual(toasts, ['Only Patrick can start the new-year setup.']);
    authUser = OO_OWNER;
    assert.equal(requireOwner('start the new-year setup'), true);
    assert.equal(toasts.length, 1, 'the owner is told nothing');
  } finally { showToast = real; }
  memberDirectory = null;
  memberDirectoryLoaded = false;
  authUser = OO_DIRECTOR;
  assert.equal(ownerGate('turn on editing').reason, 'Only the owner can turn on editing.', 'the word, never a guess, with no directory');
  ooReset();
});

test('the sentence the other directors read: "Patrick turns on editing." / "The owner turns on editing."', () => {
  ooReset();
  assert.equal(ownerSays('turns on editing'), 'The owner turns on editing.');
  memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick' } };
  memberDirectoryLoaded = true;
  assert.equal(ownerSays('turns on editing'), 'Patrick turns on editing.');
  ooReset();
});

test('body.setup-owner follows isOwner() on every role paint (the CSS shows owner-only controls only under it)', () => {
  ooReset();
  const toggles = [];
  const body = document.body;
  const realToggle = body.classList.toggle;
  body.classList.toggle = (name, on) => { toggles.push([name, !!on]); };
  try {
    authUser = OO_DIRECTOR;
    setMemberRole('editor');
    applyRoleClass();
    assert.deepEqual(toggles[toggles.length - 1], ['setup-owner', false]);
    authUser = OO_OWNER;
    applyRoleClass();
    assert.deepEqual(toggles[toggles.length - 1], ['setup-owner', true]);
    setMemberRole('viewer');
    applyRoleClass();
    assert.deepEqual(toggles[toggles.length - 1], ['setup-owner', false], 'a demotion takes the class away');
  } finally { body.classList.toggle = realToggle; }
  ooReset();
});

test('the owner literal here is the one both camps\' rules use for OWNER (and the members row)', () => {
  ['campScoreboard', 'seniorScoreboard'].forEach((root) => {
    const on = OO_RULES[root].setup.meta.on.$s['.validate'];
    assert.ok(on.includes("'" + OWNER_MEMBER_KEY + "' === auth.token.email"), root + ': meta/on is owner-only, by this key');
  });
});

test('the engine refuses every setup field the rules make owner-only (SETUP_OWNER_META covers each one), before any write', () => {
  ['campScoreboard', 'seniorScoreboard'].forEach((root) => {
    const meta = OO_RULES[root].setup.meta;
    const ownerFields = Object.keys(meta).filter((k) => !k.startsWith('.') && JSON.stringify(meta[k]).includes("'" + OWNER_MEMBER_KEY + "' === auth.token"));
    assert.ok(ownerFields.length >= 4, root + ': found ' + ownerFields.join(','));
    ownerFields.forEach((f) => assert.ok(SETUP_OWNER_META.includes(f), root + ': meta/' + f + ' is owner-only in the rules but the client would offer it'));
    ownerFields.forEach((f) => assert.equal(setupIsOwnerPath('meta/' + f + '/x'), true));
  });
  assert.equal(setupIsOwnerPath('meta/weekStart'), false, 'the week dates are any director\'s');
  assert.equal(setupIsOwnerPath('typical/b-x-1/start'), false);
});

// ── The hub's owner-only rendering contract (Step 14; Steps 15, 19 and 28 add their buttons here) ──
test('every owner-only control in the Set up the week markup starts hidden, and CSS removes it unless body.setup-owner (and the sentence others read, for the owner)', () => {
  const html = readFixture('../index.html');
  const css = readFixture('../styles.css');
  const tags = html.match(/<[a-z]+[^>]*\bdata-owner-only\b[^>]*>/g) || [];
  assert.ok(tags.length >= 7, 'the door button, the Owner menu group, its four rows and Advanced: ' + tags.length);
  tags.forEach((t) => assert.ok(/\shidden[\s>]/.test(t), 'starts hidden, so a slip in a renderer cannot show it: ' + t.slice(0, 70)));
  assert.ok(/body:not\(\.setup-owner\) \[data-owner-only\][\s\S]{0,120}display:\s*none\s*!important/.test(css), 'CSS removes them for everyone but the owner, whatever `hidden` says');
  assert.ok(/body\.setup-owner \[data-not-owner\]/.test(css), 'and removes the "Patrick turns on editing" sentence for the owner');
  // The owner's menu rows are exactly the four switches, and none is wired to anything but SETUP_OWNER_ACTIONS.
  ['new-year', 'undo-new-year', 'original', 'advanced'].forEach((a) => assert.ok(new RegExp('data-setup-act="' + a + '" data-owner-only hidden').test(html), a));
  assert.deepEqual(Object.keys(SETUP_OWNER_ACTIONS), [], 'no owner action is built yet: Step 15 adds original / advanced, Step 28 the wizard');
  assert.deepEqual(Object.keys(HUB_DOOR_ACTIONS).filter((k) => HUB_DOOR_ACTIONS[k]), [], 'and no front-door button either');
});

test('a non-owner director is never offered an owner control by any path: the sentence, the menu, the door click and the menu tap', () => {
  ooReset();
  authUser = OO_DIRECTOR;
  setMemberRole('editor');
  const saveDoor = HUB_DOOR_ACTIONS.original;
  const saveOwn = SETUP_OWNER_ACTIONS.original;
  try {
    let ran = 0;
    HUB_DOOR_ACTIONS.original = () => { ran++; };
    SETUP_OWNER_ACTIONS.original = { run: () => { ran++; }, why: () => '' };
    memberDirectory = { [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick Simpson' } };
    memberDirectoryLoaded = true;
    const door = hubDoor(hubView());
    assert.equal(door.ownerText, 'Patrick turns on editing.', 'the owner\'s name, from the member directory');
    paintHubDoor(door);
    assert.equal(document.getElementById('hub-door-btn').hidden, true);
    assert.equal(document.getElementById('hub-door-owner').hidden, false);
    setupMenuAct('original');
    assert.equal(ran, 0, 'the tap is re-checked against isOwner(), whatever the markup shows');
    renderSetupMenuRows();
    assert.equal(document.querySelector('[data-setup-act="original"]').hidden, true);
  } finally {
    HUB_DOOR_ACTIONS.original = saveDoor;
    if (saveOwn) SETUP_OWNER_ACTIONS.original = saveOwn; else delete SETUP_OWNER_ACTIONS.original;
    ooReset();
  }
});
