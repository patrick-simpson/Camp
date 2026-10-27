// The owner row in Settings → Who can sign in (setup-rebuild-spec S0c, rules#5).
// The security rules refuse EVERY client write to the owner's member key in both
// camps (the lockout anchor), so the drawer used to offer switches that could
// only ever fail with "Change refused". The row is read-only now, for the owner
// and for every other editor.

const OWNER_RULES = JSON.parse(readFixture('../database.rules.json')).rules;

function renderDrawer(lists, me) {
  authUser = me;
  const body = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  renderMemberList(body, lists);
  return body.innerHTML;
}

// The markup of one member row, by key.
function rowOf(html, key) {
  const start = html.indexOf('data-member-key="' + key + '"');
  assert.ok(start > -1, 'row for ' + key + ' is rendered');
  const next = html.indexOf('class="member-row', start + 10);
  return html.slice(start, next > -1 ? next : html.length);
}

const SOMEONE = { email: 'director@example.com' };
const lists = () => ({
  junior: {
    [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick', addedBy: 'console', addedAt: '2026-07-25T00:00:00Z' },
    'dana@example,com': { role: 'viewer', name: 'Dana', teamId: 't1', addedBy: 'x', addedAt: '2026-07-25T00:00:00Z' },
  },
  senior: {
    [OWNER_MEMBER_KEY]: { role: 'editor', name: 'Patrick', addedBy: 'console', addedAt: '2026-07-25T00:00:00Z' },
    'dana@example,com': { role: 'editor', name: 'Dana', addedBy: 'x', addedAt: '2026-07-25T00:00:00Z' },
  },
});

test('OWNER_MEMBER_KEY is the literal the rules protect, in both camps', () => {
  ['campScoreboard', 'seniorScoreboard'].forEach((root) => {
    const w = OWNER_RULES[root].members.$memberKey['.write'];
    assert.ok(w.includes(`$memberKey != '${OWNER_MEMBER_KEY}'`),
      root + ': the client constant must equal the key the rules refuse writes to');
  });
  assert.equal(OWNER_MEMBER_KEY, emailKey('patricksimpson.fx@gmail.com'), 'and it is the owner address, key-encoded');
});

test('another editor sees the owner row read-only: no switches, no team, no remove', () => {
  setMemberRole('editor');
  const row = rowOf(renderDrawer(lists(), SOMEONE), OWNER_MEMBER_KEY);
  assert.ok(row.includes('Owner · managed in the Firebase console'), row);
  ['member-access', 'member-team', 'member-role', 'member-remove', 'member-controls'].forEach((c) =>
    assert.notOk(row.includes(c), 'the owner row has no ' + c));
});

test('the owner sees their own row the same way, still marked as them', () => {
  setMemberRole('editor');
  const row = rowOf(renderDrawer(lists(), { email: 'Patricksimpson.FX@gmail.com' }), OWNER_MEMBER_KEY);
  assert.ok(row.includes('Owner · managed in the Firebase console'));
  assert.ok(row.includes('(you)'));
  assert.notOk(row.includes("another editor has to change"), 'the generic self sentence would be wrong here');
  assert.notOk(row.includes('member-access'));
});

test('everyone else keeps their per-camp switches and team select', () => {
  setMemberRole('editor');
  const row = rowOf(renderDrawer(lists(), SOMEONE), 'dana@example,com');
  assert.ok(row.includes('member-access'), 'access switches still render');
  assert.ok(row.includes('member-team'), 'team select still renders');
  assert.notOk(row.includes('Owner ·'));
});

test('the add form and the convert flow refuse the owner key before any write', () => {
  const plan = planMemberAdd({ key: OWNER_MEMBER_KEY, pending: false, bothCamps: true, myKey: 'x@y,com', lists: {} });
  assert.ok(plan.error && /owner/i.test(plan.error), String(plan.error));
  assert.notOk(plan.camps);
  const why = memberConvertRefusal(OWNER_MEMBER_KEY, 'x@y,com', {});
  assert.ok(/owner/i.test(why), why);
  assert.equal(memberConvertRefusal('someone@e,com', 'x@y,com', {}), '', 'a normal key is still accepted');
});

test('a bulk roster write can never target the owner key', () => {
  // The only bulk member write today is the seed list (pending rows). Their
  // keys can't be an email, so they can't be the owner's — and S7/S8 bulk
  // writes must stay per-row and skip OWNER_MEMBER_KEY (see its comment).
  for (let i = 0; i < 50; i += 1) assert.ok(pendingKey('Patrick') !== OWNER_MEMBER_KEY);
  assert.ok(isPendingKey(pendingKey('Patrick')));
  assert.notOk(isPendingKey(OWNER_MEMBER_KEY));
});
