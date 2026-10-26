// Phone alerts under the SENIOR profile: senior's printed day produces its
// own block catalog (two competition windows a day, the Legacy Game, the
// evening crowd games), every key still satisfies the rules, and the
// per-camp storage keys are namespaced away from junior's.

const KEY_RE = /^[a-z0-9-]{1,48}$/;

test('senior schedule blocks are all rules-valid', () => {
  const blocks = pushScheduleBlocks(DAY_SCHEDULE);
  assert.ok(Object.keys(blocks).length > 50, 'a full week of senior blocks');
  Object.keys(blocks).forEach((id) => {
    assert.ok(/^[a-z0-9-]{1,40}$/.test(id), `${id} is a legal block id`);
    assert.ok(KEY_RE.test(blocks[id].key), `${id}: ${blocks[id].key}`);
    assert.ok(blocks[id].label.length <= 120 && blocks[id].emoji.length <= 16);
  });
  assert.notOk(Object.values(blocks).some((b) => b.label === 'Welcome night'), 'untimed Sunday night is left out');
});

test('the senior catalog merges the twice-daily competition window', () => {
  const cat = pushBlockCatalog(DAY_SCHEDULE);
  const keys = cat.map((b) => b.key);
  assert.equal(new Set(keys).size, keys.length, 'one row per key');
  const comps = cat.find((b) => b.key === 'team-competitions');
  assert.equal(comps.when, 'Mon–Fri 9:45 AM · Mon–Fri 3:00 PM');
  assert.ok(keys.includes('hot-seat-let-s-make-a-deal'), 'curly quotes and ! fold away');
  assert.ok(keys.includes('free-time-below-the-tracks-exile'), 'the "— Snack Shack open" tail is decoration');
  assert.equal(cat.find((b) => b.key === 'legacy-game').when, 'Mon–Fri 4:50 PM');
  assert.equal(cat.find((b) => b.key === 'breakfast').when, 'Mon–Sat 8:00 AM');
  assert.equal(cat[0].key, 'arrival-registration', 'Sunday arrival comes first');
});

test('senior push storage is namespaced; the device id is shared', () => {
  pushSetOn(true);
  assert.equal(localStorage.getItem('campScoreboardPushOn:senior'), '1');
  assert.equal(localStorage.getItem('campScoreboardPushOn'), null, "junior's flag is untouched");
  assert.ok(pushIsOn());
  assert.notOk(pushIsOn('junior'));
  pushSetOn(false);
  pushStorePrefs({ lead: 15 });
  assert.ok(localStorage.getItem('campScoreboardPushPrefs:senior'));
  assert.equal(localStorage.getItem('campScoreboardPushPrefs'), null);
  assert.equal(pushRecordPath('senior', 'me@x,com', 'dev12345'), 'seniorScoreboard/push/me@x,com/dev12345');
  assert.equal(pushRecordPath('junior', 'me@x,com', 'dev12345'), 'campScoreboard/push/me@x,com/dev12345',
    'a cross-camp delete (sign-out) addresses the other root explicitly');
});

test('senior team names feed mention targeting', () => {
  freshState();
  memberDirectory = {};
  authUser = null;
  assert.deepEqual(pushMentionTargets('Gold team to the waterfront').teams, ['t3']);
  assert.deepEqual(pushMentionTargets('Red Team and Blue Team, line up').teams.sort(), ['t0', 't1']);
  memberDirectory = null;
});

test('senior prefs default the same as junior (the sender assumes one set of defaults)', () => {
  assert.deepEqual(normalizePushPrefs(null), {
    ch: { announcements: true, general: false, memes: false, photos: false },
    mention: true, director: true, blocksAll: false, blocks: {}, lead: 10,
  });
});
