// The two-camp architecture (camps.js): junior must be BYTE-IDENTICAL to the
// single-camp app it grew out of — same Firebase paths, same localStorage
// keys, same week data — while senior is a self-consistent sibling. This
// file runs in the default (junior) context; senior's own context runs in
// week.senior.test.js.

// ── Junior identity pins: the refactor must not have renamed anything ──

test('junior is the default and active camp', () => {
  assert.equal(activeCampId(), 'junior');
  assert.equal(CAMP.id, 'junior');
});

test('junior Firebase paths are the original literals', () => {
  // The published security rules gate these exact strings; a rename would
  // silently cut every existing device off from its data.
  assert.equal(dbPath('state'), 'campScoreboard/state');
  assert.equal(dbPath('config'), 'campScoreboard/config');
  assert.equal(dbPath('members'), 'campScoreboard/members');
  assert.equal(dbPath('members/patricksimpson,fx@gmail,com'), 'campScoreboard/members/patricksimpson,fx@gmail,com');
  assert.equal(dbPath('presence/abc'), 'campScoreboard/presence/abc');
  assert.equal(dbPath('changelog'), 'campScoreboard/changelog');
});

test('junior localStorage keys are unchanged (suffix is empty)', () => {
  // Every junior device has its week cached under these exact keys; a
  // rename would look like a wiped scoreboard.
  assert.equal(lsKey('campScoreboardV2'), 'campScoreboardV2');
  assert.equal(STORAGE_KEY, 'campScoreboardV2');
  assert.equal(DAY_RANK_KEY, 'campScoreboardDayRanks');
  assert.equal(CHANGE_DISMISS_KEY, 'campScoreboardDismissedChanges');
  assert.equal(ANNOUNCE_DISMISS_KEY, 'campScoreboardDismissedAnnouncements');
});

test('the junior week data survived the move to camps.js verbatim', () => {
  // fixtures-junior-week.json was dumped from the code BEFORE the move
  // (2026-07-25). Deep-equality here proves the cut-paste changed nothing.
  const fix = JSON.parse(readFixture('fixtures-junior-week.json'));
  // Top-level consts live in the context's global LEXICAL scope (not on
  // globalThis), so name them explicitly — exactly the set the dump captured.
  const live = {
    DAY_SCHEDULE, SCHED_DAYS, TEAM_EMOJI, TEAM_SHIELD, TEAM_ACCENT, TEAM_ABBREV,
    DEFAULT_TEAM_NAMES, DEFAULT_COUNSELORS, OLD_PLACEHOLDER_TEAM_NAMES,
    OLD_PLACEHOLDER_COUNSELORS, TEAM_COUNSELORS, SEED_COUNSELORS, ELECTIVES,
    STATION_EMOJI, ELECTIVE_SLOT_MIN, MEALS, MEAL_CLEANUP_SCHEDULE,
    MEMORY_VERSE_THEME, MEMORY_VERSES, defaultNotice: defaultNotice(),
  };
  Object.keys(fix).forEach((name) => {
    assert.deepEqual(live[name], fix[name], `${name} must be byte-identical to the pre-move snapshot`);
  });
});

test('junior profile shape: six teams, shields, electives on', () => {
  assert.equal(CAMP.teamCount, 6);
  assert.equal(CAMP.crestNoun, 'shield');
  assert.ok(CAMP.features.electives);
  assert.equal(CAMP.defaultTeamNames.length, 6);
  assert.equal(Object.keys(CAMP.teamEmoji).length, 6);
  assert.ok(CAMP.defaultConfig().games.length >= 19, 'junior seeds the full catalog');
});

// ── The senior profile, inspected from here (data only — the senior
//    CONTEXT, with app.js running against it, is week.senior.test.js) ──

test('senior profile shape: four teams, flags, no electives', () => {
  const sr = CAMPS.senior;
  assert.equal(sr.teamCount, 4);
  assert.equal(sr.crestNoun, 'flag');
  assert.notOk(sr.features.electives, 'no electives at senior camp');
  assert.equal(sr.defaultTeamNames.length, 4);
  assert.deepEqual(Object.keys(sr.teamEmoji).sort(), ['t0', 't1', 't2', 't3']);
  assert.deepEqual(Object.keys(sr.teamAccent).sort(), ['t0', 't1', 't2', 't3']);
  assert.deepEqual(sr.teamCrest, {}, 'no flag artwork yet — emoji fallback');
  assert.deepEqual(sr.electives, {});
  assert.deepEqual(sr.mealCleanupSchedule, {}, 'rota TBA until filled');
  assert.deepEqual(sr.seedCounselors, [], 'no printed senior roster yet');
});

test('senior and junior never share a database root or storage namespace', () => {
  assert.equal(CAMPS.junior.dbRoot, 'campScoreboard');
  assert.equal(CAMPS.senior.dbRoot, 'seniorScoreboard');
  assert.notOk(CAMPS.senior.dbRoot.includes(CAMPS.junior.dbRoot), 'senior is a SIBLING, not a child');
  assert.equal(CAMPS.junior.storageSuffix, '');
  assert.ok(CAMPS.senior.storageSuffix.length > 0, 'senior keys are namespaced');
});

test('the senior seeded config is internally consistent', () => {
  const cfg = CAMPS.senior.defaultConfig();
  assert.equal(cfg.version, 5, 'must match the migration ceiling so junior one-shots never fire on senior data');
  const dayIds = new Set(cfg.days.map((d) => d.id));
  const gameIds = cfg.games.map((g) => g.id);
  assert.equal(gameIds.length, new Set(gameIds).size, 'game ids unique');
  cfg.games.forEach((g) => {
    assert.ok(dayIds.has(g.dayId), `${g.id} points at a real day`);
    assert.ok(cfg.sessions.includes(g.session), `${g.id} session is real`);
    assert.ok(['placement', 'tally', 'tournament'].includes(g.format), `${g.id} format known`);
    assert.ok(Array.isArray(g.rules) && g.rules.length, `${g.id} has rules sections`);
    assert.equal(g.format, 'placement', 'placeholders are placement — the one format that works at any team count');
  });
  // Patrick's call: the big daily events are all SCORED games.
  ['legacy-game', 'hot-seat', 'lets-make-a-deal'].forEach((base) => {
    cfg.days.forEach((d) => {
      assert.ok(gameIds.includes(base + '-' + d.id), `${base} seeded on ${d.name}`);
    });
  });
});

test('the senior notice draft covers each senior team exactly once, as a DRAFT', () => {
  const n = CAMPS.senior.defaultNotice();
  assert.equal(n.status, 'draft', 'seeding must never post a card by itself');
  assert.deepEqual(n.zones.map((z) => z.teamId).sort(), ['t0', 't1', 't2', 't3']);
});

test('senior verse placeholders cover every camp day (the card renders them)', () => {
  [1, 2, 3, 4, 5].forEach((dow) => {
    const v = CAMPS.senior.memoryVerses[dow];
    assert.ok(v && typeof v.text === 'string' && v.text.length, `day ${dow} has a verse object`);
  });
  assert.ok(CAMPS.senior.memoryVerseTheme.title);
});

test('senior schedule blocks are ordered and typed like junior ones', () => {
  // Same structural walk week.test.js does for junior — the banner code
  // assumes contiguous, ordered blocks with known types.
  const sched = CAMPS.senior.daySchedule;
  [0, 1, 2, 3, 4, 5, 6].forEach((dow) => {
    const blocks = sched[dow];
    assert.ok(Array.isArray(blocks) && blocks.length, `dow ${dow} has blocks`);
    blocks.forEach((b, i) => {
      assert.ok(b.start < b.end, `dow ${dow} block ${i} start<end`);
      assert.ok(['activity', 'games', 'elective'].includes(b.type), `dow ${dow} block ${i} type`);
      assert.notOk(b.type === 'elective', 'senior has no elective blocks');
      if (i > 0) assert.ok(b.start >= blocks[i - 1].start, `dow ${dow} blocks ordered`);
    });
    assert.equal(blocks[blocks.length - 1].end, 24 * 60, `dow ${dow} runs to midnight`);
  });
  const monday = sched[1];
  assert.ok(monday.some((b) => b.type === 'games' && b.label === 'Legacy Game'), 'the Legacy Game is on the schedule');
  assert.equal(monday.filter((b) => b.type === 'games').length, 4, 'two competition blocks + Legacy Game + evening crowd games');
});

// ── Camp switching (junior context; the senior side mirrors it) ──

test('the camps hint only ever reads back as real roles', () => {
  localStorage.removeItem(CAMPS_HINT_KEY);
  assert.deepEqual(readCampsHint(), {});
  writeCampsHint('junior', 'editor');
  writeCampsHint('senior', 'viewer');
  assert.deepEqual(readCampsHint(), { junior: 'editor', senior: 'viewer' });
  assert.ok(hasBothCamps());
  writeCampsHint('senior', null); // revoked there
  assert.deepEqual(readCampsHint(), { junior: 'editor' });
  assert.notOk(hasBothCamps());
  writeCampsHint('junior', 'garbage'); // junk never becomes a role
  assert.deepEqual(readCampsHint(), {});
  localStorage.setItem(CAMPS_HINT_KEY, 'not json');
  assert.deepEqual(readCampsHint(), {}, 'corrupt hint reads as empty');
  localStorage.removeItem(CAMPS_HINT_KEY);
});

test('switchCamp sets the key, hands over the role hint, and reloads', () => {
  const before = __reloads || 0;
  writeCampsHint('senior', 'viewer');
  switchCamp('senior');
  assert.equal(localStorage.getItem(ACTIVE_CAMP_KEY), 'senior');
  assert.equal(localStorage.getItem(AUTH_HINT_KEY), 'viewer', 'destination camp paints with ITS role');
  assert.equal(__reloads, before + 1, 'a camp switch is always a reload');
  // Cleanup for later tests in this file (the context itself stays junior —
  // the profile was chosen at load time).
  localStorage.removeItem(ACTIVE_CAMP_KEY);
  localStorage.removeItem(AUTH_HINT_KEY);
  localStorage.removeItem(CAMPS_HINT_KEY);
});

test('switchCamp refuses unknown camps and the current camp', () => {
  const before = __reloads || 0;
  switchCamp('junior');   // already here
  switchCamp('winter');   // not a camp
  assert.equal(__reloads || 0, before, 'no reloads');
  assert.equal(localStorage.getItem(ACTIVE_CAMP_KEY), null);
});

test('clearLocalData wipes BOTH camps and the camp-selection keys', () => {
  localStorage.setItem('campScoreboardV2', '{}');
  localStorage.setItem('campScoreboardV2:senior', '{}');
  localStorage.setItem('campScoreboardDayRanks:senior', '{}');
  localStorage.setItem(CAMPS_HINT_KEY, '{"junior":"editor"}');
  localStorage.setItem(ACTIVE_CAMP_KEY, 'senior');
  localStorage.setItem(CAMP_ASKED_KEY, '1');
  clearLocalData();
  ['campScoreboardV2', 'campScoreboardV2:senior', 'campScoreboardDayRanks:senior',
   CAMPS_HINT_KEY, ACTIVE_CAMP_KEY, CAMP_ASKED_KEY].forEach((k) => {
    assert.equal(localStorage.getItem(k), null, `${k} must be cleared`);
  });
});

test('the camp question is asked once, then the last choice is remembered', () => {
  // "Remember my last choice" (owner's revised call): the picker fires only
  // on the FIRST discovery of a second camp; after that the active-camp key
  // is the memory and switching lives in Settings.
  localStorage.removeItem(CAMP_ASKED_KEY);
  writeCampsHint('junior', 'editor');
  writeCampsHint('senior', 'viewer');

  campPickerAsked = false;
  maybeShowCampPicker();
  assert.equal(localStorage.getItem(CAMP_ASKED_KEY), '1', 'the one-time ask is recorded');

  campPickerAsked = false; // a later page load
  const overlay = document.getElementById('camp-picker-overlay');
  overlay.removeAttribute('open');
  let opened = false;
  overlay.setAttribute = (name) => { if (name === 'open') opened = true; };
  maybeShowCampPicker();
  assert.notOk(opened, 'already answered once — never auto-asks again');

  localStorage.removeItem(CAMP_ASKED_KEY);
  localStorage.removeItem(CAMPS_HINT_KEY);
  campPickerAsked = false;
});

// ── The unified Members drawer (one row per person, both camps) ───

test('mergeMemberLists folds both camps into one row per person', () => {
  const rows = mergeMemberLists({
    junior: {
      'pat@x,com': { role: 'editor', name: 'Pat' },
      'jr,only@x,com': { role: 'viewer', name: 'Junior Only' },
      'pending-brody-ab12': { role: 'viewer', name: 'Brody' },
    },
    senior: {
      'pat@x,com': { role: 'viewer', name: 'Pat' },
      'sr,only@x,com': { role: 'editor' }, // no name — shows the identity
    },
  });
  assert.equal(rows.length, 4, 'Pat appears once, not twice');
  const pat = rows.find((r) => r.key === 'pat@x,com');
  assert.equal(pat.camps.junior.role, 'editor', 'roles stay independent per camp');
  assert.equal(pat.camps.senior.role, 'viewer');
  const jr = rows.find((r) => r.key === 'jr,only@x,com');
  assert.equal(jr.camps.senior, null, 'no senior record → null, renders as None');
  const names = rows.map((r) => (r.camps.junior && r.camps.junior.name) || (r.camps.senior && r.camps.senior.name) || identityFromKey(r.key));
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'sorted by display name');
});

test('mergeMemberLists tolerates a missing camp list (single-camp view)', () => {
  const rows = mergeMemberLists({ junior: { 'a@x,com': { role: 'viewer' } }, senior: null });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].camps.senior, null);
  assert.deepEqual(mergeMemberLists({ junior: null, senior: null }), [], 'nothing → empty');
});

test('campMembersPath writes to the right root for each camp', () => {
  assert.equal(campMembersPath('junior', 'a@x,com'), 'campScoreboard/members/a@x,com');
  assert.equal(campMembersPath('senior', 'a@x,com'), 'seniorScoreboard/members/a@x,com');
});

test('campRoleOf knows this camp live and the other camp from the probe/hint', () => {
  setMemberRole('editor');
  assert.equal(campRoleOf('junior'), 'editor', 'active camp = live role');
  otherCampRole = null;
  localStorage.removeItem(CAMPS_HINT_KEY);
  assert.equal(campRoleOf('senior'), null, 'unknown until probed');
  writeCampsHint('senior', 'viewer');
  assert.equal(campRoleOf('senior'), 'viewer', 'falls back to the cached hint');
  otherCampRole = 'editor';
  assert.equal(campRoleOf('senior'), 'editor', 'the live probe result wins');
  otherCampRole = null;
  localStorage.removeItem(CAMPS_HINT_KEY);
});
