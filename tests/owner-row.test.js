// The owner's member row (setup-rebuild-spec S0c, rules#5). The security rules refuse EVERY client write to the owner's member key
// in both camps (the lockout anchor): the client constant equals the rules' literal, and the add / convert paths refuse the key
// before any write. (The Who can sign in drawer that rendered the row read-only was retired in Step 30; People's own rows are in
// people-screen.test.js.)

const OWNER_RULES = JSON.parse(readFixture('../database.rules.json')).rules;

const SOMEONE = { email: 'director@example.com' };

test('OWNER_MEMBER_KEY is the literal the rules protect, in both camps', () => {
  ['campScoreboard', 'seniorScoreboard'].forEach((root) => {
    const w = OWNER_RULES[root].members.$memberKey['.write'];
    assert.ok(w.includes(`$memberKey != '${OWNER_MEMBER_KEY}'`),
      root + ': the client constant must equal the key the rules refuse writes to');
  });
  assert.equal(OWNER_MEMBER_KEY, emailKey('patricksimpson.fx@gmail.com'), 'and it is the owner address, key-encoded');
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
