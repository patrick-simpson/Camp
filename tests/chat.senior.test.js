// Camp Chat under the SENIOR profile: same four channels, senior team
// names/short names feed the mention scanner, and the seen-map key is
// namespaced away from junior's.

test('senior camp has the same four channels', () => {
  assert.deepEqual(chatChannels().map((c) => c.id), ['announcements', 'general', 'memes', 'photos']);
});

test('senior team names and colors are mentionable', () => {
  freshState();
  const targets = chatMentionTargets();
  const labels = targets.map((t) => t.label);
  assert.ok(labels.includes('Red Team'), 'senior team full name');
  assert.ok(labels.includes('Gold'), 'senior short name (TEAM_ABBREV)');
  const hits = mentionScan('huge win for the gold team tonight', targets);
  assert.ok(hits.some((h) => h.kind === 'team' && h.teamId === 't3'), '"gold" pings the Gold team');
});

test('senior "Red" (the capitalised-team-word rule): Red and "red team" ping, "a red shirt" and "feeling blue" do not', () => {
  freshState();
  const targets = chatMentionTargets();
  const teamsOf = (text) => mentionScan(text, targets).filter((h) => h.kind === 'team').map((h) => h.teamId);
  assert.deepEqual(teamsOf('Red meet at the flagpole'), ['t0']);
  assert.deepEqual(teamsOf('go red team'), ['t0']);
  assert.deepEqual(teamsOf('Red Team won'), ['t0'], 'the full name, in any case');
  assert.deepEqual(teamsOf('a red shirt'), []);
  assert.deepEqual(teamsOf('feeling blue today'), []);
  assert.deepEqual(teamsOf('gold star for everyone'), [], '"gold" in an ordinary sentence no longer pings the Gold team');
});

test('a senior counselor following Blue gets pinged on "Blue"', () => {
  freshState();
  state.followTeam = 't1';
  const hits = mentionScan('Blue meet at the waterfront', chatMentionTargets());
  assert.ok(mentionIsMine(hits));
  state.followTeam = null;
});

test('the senior seen map is namespaced', () => {
  assert.equal(lsKey('campScoreboardChatSeen'), 'campScoreboardChatSeen:senior');
});
