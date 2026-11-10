// What's new notes under the SENIOR profile: the same checks as whats-new.test.js (which this evals), plus what differs by camp.
eval(readFixture('whats-new.test.js'));

test('senior: a note for the other camp is never read, and a note about electives is never read here', () => {
  assert.equal(CAMP.id, 'senior');
  const note = (camp) => ({ id: 'camp-note', at: '2026-01-01T00:00:00Z', for: 'everyone', text: 'A note.', camp });
  const who = { confirmed: true, role: 'viewer', owner: false, camp: CAMP.id, has: () => true };
  assert.ok(!whatsNewAudienceOk(note('junior'), who));
  assert.ok(whatsNewAudienceOk(note('senior'), who));
  assert.equal(WHATS_NEW_NEEDS.electives(), false, 'senior has no electives');
});
