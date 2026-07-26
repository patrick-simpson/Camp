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
