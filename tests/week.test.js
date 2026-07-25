// The week's DATA: the printed schedule (DAY_SCHEDULE), the default game
// catalog (defaults.js), and the rotas that hang off them. These are the parts
// of the project that get hand-edited most, and a typo here is invisible until
// somebody's phone shows the wrong thing — so the checks are structural.

const DOWS = [0, 1, 2, 3, 4, 5, 6];

test('every schedule day has blocks, in order, with real durations', () => {
  DOWS.forEach((dow) => {
    const blocks = DAY_SCHEDULE[dow];
    assert.ok(Array.isArray(blocks) && blocks.length, `dow ${dow} has no schedule`);
    let prevStart = -1;
    blocks.forEach((b, i) => {
      const where = `dow ${dow} block ${i} (${b.label})`;
      assert.ok(b.label, `${where}: missing label`);
      assert.ok(b.emoji, `${where}: missing emoji`);
      assert.equal(typeof b.start, 'number', `${where}: start must be minutes-from-midnight`);
      assert.equal(typeof b.end, 'number', `${where}: end must be minutes-from-midnight`);
      assert.ok(b.start >= 0 && b.start <= 1440, `${where}: start ${b.start} out of range`);
      assert.ok(b.end > b.start, `${where}: ends at or before it starts`);
      assert.ok(b.end <= 1440, `${where}: end ${b.end} past midnight`);
      assert.ok(b.start >= prevStart, `${where}: starts before the block above it — the "up next" lookup walks this list in order`);
      prevStart = b.start;
    });
  });
});

test('the Happening Now banner survives every minute of every day', () => {
  // renderNowBanner runs on load and every 30 seconds on every device, for the
  // whole week — a throw here is a blank banner (or worse) at some hour nobody
  // tested by hand. Walk all seven days at one-minute resolution.
  DOWS.forEach((dow) => {
    for (let m = 0; m <= 1440; m++) {
      try {
        const html = nowBannerHtml(dow, m);
        assert.ok(html === null || typeof html === 'string', `dow ${dow} ${m}: odd return`);
      } catch (e) {
        assert.ok(false, `nowBannerHtml(${dow}, ${m}) threw: ${e && e.message}`);
      }
    }
  });
});

test('clock and range formatting read the way the schedule sheet prints them', () => {
  assert.equal(schedClock(0), '12:00');
  assert.equal(schedClock(hm(9, 5), true), '9:05am');
  assert.equal(schedClock(hm(12, 0), true), '12:00pm');
  assert.equal(schedClock(hm(13, 30), true), '1:30pm');
  assert.equal(schedClock(1440, true), '12:00am');
  assert.equal(schedRange(hm(10, 0), hm(11, 45)), '10:00–11:45am', 'one am/pm suffix when both ends share it');
  assert.equal(schedRange(hm(11, 30), hm(13, 0)), '11:30am–1:00pm', 'both suffixes when it straddles noon');
});

test('campNow honors the ?now= testing override', () => {
  location.search = '?now=5-1030';
  assert.deepEqual(campNow(), { dow: 5, minutes: hm(10, 30) });
  location.search = '?now=0-730&other=1';
  assert.deepEqual(campNow(), { dow: 0, minutes: hm(7, 30) });
  location.search = '';
  const real = campNow();
  assert.ok(real.dow >= 0 && real.dow <= 6);
  assert.ok(real.minutes >= 0 && real.minutes < 1440);
});

// ── Default catalog ──────────────────────────────────────────────

test('the default catalog is internally consistent', () => {
  const c = defaultConfig();
  const dayIds = new Set(c.days.map((d) => d.id));
  const seen = new Set();
  const formats = ['tournament', 'tally', 'placement'];

  assert.ok(c.days.length, 'no days');
  assert.ok(c.games.length, 'no games');
  c.days.forEach((d) => {
    assert.ok(d.id && d.name, `day ${JSON.stringify(d)} missing id/name`);
    assert.ok(d.dow >= 0 && d.dow <= 6, `day ${d.id} has an impossible dow`);
  });

  c.games.forEach((g) => {
    assert.notOk(seen.has(g.id), `duplicate game id "${g.id}" — results are keyed by id, so a duplicate silently shares scores`);
    seen.add(g.id);
    assert.ok(g.name, `game ${g.id} has no name`);
    assert.ok(dayIds.has(g.dayId), `game ${g.id} points at unknown day "${g.dayId}"`);
    assert.ok(c.sessions.includes(g.session), `game ${g.id} has session "${g.session}", not in ${JSON.stringify(c.sessions)}`);
    assert.ok(formats.includes(g.format), `game ${g.id} has unknown format "${g.format}"`);
    assert.ok(Array.isArray(g.rules), `game ${g.id} rules must be an array`);
    g.rules.forEach((sec, i) => {
      assert.ok(Array.isArray(sec.items), `game ${g.id} rules[${i}].items must be an array`);
    });
    if (g.timer) {
      assert.ok(Array.isArray(g.timer.presets) && g.timer.presets.length, `game ${g.id} timer has no presets`);
      g.timer.presets.forEach((p) => assert.ok(typeof p === 'number' && p > 0, `game ${g.id} has a bad timer preset ${p}`));
    }
    if (g.counterSteps) {
      assert.ok(Array.isArray(g.counterSteps) && g.counterSteps.length, `game ${g.id} counterSteps must be a non-empty array`);
    }
  });
});

test('every game has a format badge to render', () => {
  defaultConfig().games.forEach((g) => {
    assert.ok(FORMAT_BADGES[g.format], `no badge defined for format "${g.format}" (game ${g.id})`);
  });
});

test('a fresh state migrates cleanly and lands on a real day', () => {
  const s = makeFreshState();
  migrateState(s);
  assert.ok(s.config.days.some((d) => d.id === s.ui.day), 'the selected day must exist in the catalog');
  assert.equal(migrateState(s), false, 'migration must be idempotent — a second pass changes nothing');
});

test('migrateState repairs a config mangled by a sync round-trip', () => {
  const s = makeFreshState();
  delete s.config.games[0].rules;      // RTDB pruned an empty rules array
  delete s.config.sessions;           // …and the sessions list
  s.config.games[1].day = 2;          // legacy numeric day from an old build
  delete s.config.games[1].dayId;
  assert.ok(migrateState(s));
  assert.deepEqual(s.config.games[0].rules, []);
  assert.deepEqual(s.config.sessions, ['Morning', 'Evening']);
  assert.equal(s.config.games[1].dayId, 'd2');
  assert.notOk('day' in s.config.games[1]);
});

test('defaultDay picks today when the week covers it', () => {
  const c = defaultConfig();
  location.search = '?now=3-1200'; // Wednesday
  assert.equal(defaultDay(c), c.days.find((d) => d.dow === 3).id);
  location.search = '?now=6-1200'; // Saturday — no competition day
  assert.equal(defaultDay(c), c.days[0].id, 'falls back to the first day');
  location.search = '';
});

// ── Rotas that reference team ids ────────────────────────────────

test('the meal-cleanup rota only names real teams', () => {
  const ids = new Set(makeFreshState().teams.map((t) => t.id));
  Object.entries(MEAL_CLEANUP_SCHEDULE).forEach(([day, meals]) => {
    Object.entries(meals).forEach(([meal, assigned]) => {
      assert.ok(MEAL_CLEANUP_MEALS.includes(meal), `day ${day} has unknown meal "${meal}"`);
      const teams = Array.isArray(assigned) ? assigned : [assigned];
      teams.forEach((t) => assert.ok(ids.has(t), `day ${day} ${meal} is assigned to unknown team "${t}"`));
    });
  });
});

test('findNextCleanupFor walks forward from now and stops at the end of the week', () => {
  freshState();
  location.search = '?now=1-0000'; // Monday, before breakfast
  const next = findNextCleanupFor(cleanupTeamForTest());
  assert.ok(next && next.day >= 1, 'should find a duty later in the week');
  location.search = '?now=6-1200'; // Saturday — the week's meals are done
  assert.equal(findNextCleanupFor(cleanupTeamForTest()), null);
  location.search = '';
});

function cleanupTeamForTest() {
  const first = Object.values(MEAL_CLEANUP_SCHEDULE)[0];
  const assigned = first && Object.values(first)[0];
  return Array.isArray(assigned) ? assigned[0] : assigned;
}

test('every memory verse day is a real camp day', () => {
  Object.keys(MEMORY_VERSES).forEach((dow) => {
    assert.ok(DAY_NAMES[dow], `MEMORY_VERSES has a verse for dow ${dow}, which is not a camp day`);
  });
});

// ── Cleanup call (send-off morning) ──────────────────────────────

test('the cleanup call covers every team exactly once', () => {
  const ids = makeFreshState().teams.map((t) => t.id);
  const assigned = CLEANUP_CALL.zones.map((z) => z.teamId);
  assigned.forEach((id) => assert.ok(ids.includes(id), `cleanup zone names unknown team "${id}"`));
  assert.equal(new Set(assigned).size, assigned.length, 'a team is listed twice');
  ids.forEach((id) => assert.ok(assigned.includes(id), `no cleanup area for team "${id}" — somebody has nowhere to go`));
  CLEANUP_CALL.zones.forEach((z) => assert.ok(z.place, `team ${z.teamId} has no place`));
});

test('the cleanup call shows only in its own window', () => {
  assert.ok(cleanupCallActive(6, hm(7, 48)), 'Saturday morning: showing');
  assert.ok(cleanupCallActive(6, hm(9, 29)), 'still showing right up to send-off');
  assert.ok(cleanupCallActive(6, hm(10, 30)),
    'and after it — the last stage is counselors\' work once the campers have left');
  assert.notOk(cleanupCallActive(6, hm(12, 0)), 'gone by midday');
  assert.notOk(cleanupCallActive(6, hm(14, 0)), 'gone for the rest of Saturday');
  [0, 1, 2, 3, 4, 5].forEach((dow) => {
    assert.notOk(cleanupCallActive(dow, hm(8, 0)), `must not show on dow ${dow}`);
  });
});

test('the cleanup call spells out the running order, not just the zones', () => {
  freshState();
  const html = cleanupCallHtml(6, hm(7, 48));
  assert.ok(CLEANUP_CALL.steps.length, 'there should be steps to show');
  CLEANUP_CALL.steps.forEach((s) => {
    assert.ok(s.when && s.items.length, `step "${s.when}" is empty`);
    assert.ok(html.includes(esc(s.when)), `step "${s.when}" is missing from the card`);
    s.items.forEach((i) => assert.ok(html.includes(esc(i)), `"${i}" is missing from the card`));
  });
  assert.ok(html.includes(esc(CLEANUP_CALL.signoff)), 'the sign-off line is missing');
});

test('the cleanup order sends campers to their area before the cabins', () => {
  // Campers are NOT to go up to the cabins after breakfast — they go straight
  // to their team's area, and only head up once the Tabernacle is set. Getting
  // this order backwards on the card sends everyone to the wrong place.
  const order = CLEANUP_CALL.steps.map((s) => s.when.toLowerCase());
  const area = order.findIndex((w) => w.includes('after breakfast'));
  const cabins = order.findIndex((w) => w.startsWith('cabins'));
  const gone = order.findIndex((w) => w.includes('campers have gone'));
  assert.ok(area >= 0 && cabins >= 0 && gone >= 0, 'expected all three stages');
  assert.ok(area < cabins, 'team areas come before the cabins');
  assert.ok(cabins < gone, 'the cabins are packed before the after-departure jobs');
});

test('the cleanup call renders every assignment, and nothing outside the window', () => {
  freshState();
  const html = cleanupCallHtml(6, hm(7, 48));
  assert.ok(html, 'expected markup on Saturday morning');
  CLEANUP_CALL.zones.forEach((z) => {
    assert.ok(html.includes(esc(z.place)), `${z.place} is missing from the card`);
    assert.ok(html.includes(esc(teamName(z.teamId))), `${teamName(z.teamId)} is missing from the card`);
  });
  assert.equal(cleanupCallHtml(3, hm(8, 0)), null, 'no markup midweek');
});

test('the cleanup call calls out the team you follow', () => {
  freshState();
  state.followTeam = CLEANUP_CALL.zones[0].teamId;
  assert.ok(cleanupCallHtml(6, hm(7, 48)).includes('cleanup-yours'), 'your own line is spelled out');
  assert.ok(cleanupCallHtml(6, hm(7, 48)).includes('cleanup-row-you'), 'and your row is marked');

  state.followTeam = null;
  const neutral = cleanupCallHtml(6, hm(7, 48));
  assert.notOk(neutral.includes('cleanup-yours'), 'nothing personal for a neutral viewer');
  assert.notOk(neutral.includes('cleanup-row-you'));
});

test('the cleanup call survives a roster that no longer matches', () => {
  freshState();
  state.teams = [{ id: CLEANUP_CALL.zones[0].teamId, name: 'Only Team Left' }];
  const html = cleanupCallHtml(6, hm(7, 48));
  assert.ok(html.includes('Only Team Left'), 'the team that still exists is listed');
  assert.equal((html.match(/cleanup-row/g) || []).length, 1, 'deleted teams are skipped, not rendered blank');

  state.teams = [];
  assert.equal(cleanupCallHtml(6, hm(7, 48)), null, 'no roster at all → no card');
});

test('a renamed team is named correctly on the cleanup card', () => {
  freshState();
  const zone = CLEANUP_CALL.zones[0];
  state.teams.find((t) => t.id === zone.teamId).name = 'The <Renamed> Crew';
  const html = cleanupCallHtml(6, hm(7, 48));
  assert.ok(html.includes('The &lt;Renamed&gt; Crew'), 'live name, HTML-escaped');
});

// ── Announcements expire on their own ────────────────────────────

test('an announcement expires ttlMs after it was posted', () => {
  const at = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // half an hour ago
  assert.notOk(announcementExpired({ at, ttlMs: 60 * 60 * 1000 }), 'a 1h notice is still live at 30m');
  assert.ok(announcementExpired({ at, ttlMs: 10 * 60 * 1000 }), 'a 10m notice is long gone');
});

test('an announcement with a pruned or junk ttl falls back to an hour', () => {
  const at = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  assert.notOk(announcementExpired({ at }), 'missing ttlMs → the 1h default');
  assert.notOk(announcementExpired({ at, ttlMs: 0 }), 'RTDB prunes 0 → the 1h default');
  assert.ok(announcementExpired({ at: 'not a date' }), 'an unparseable stamp counts as expired, never forever-live');
  assert.ok(announcementExpired({}));
});

test('announcements from before the purge cutoff never come back', () => {
  const at = new Date(ANNOUNCE_PURGE_BEFORE - 1000).toISOString();
  assert.ok(announcementExpired({ at, ttlMs: 99 * 60 * 60 * 1000 }));
});

// ── Calendar export ──────────────────────────────────────────────

test('a schedule day exports as a well-formed calendar', () => {
  const ics = buildDayIcs(1);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'), 'must open as a VCALENDAR');
  assert.ok(ics.trim().endsWith('END:VCALENDAR'));
  const begins = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const ends = (ics.match(/END:VEVENT/g) || []).length;
  assert.equal(begins, ends, 'every VEVENT must be closed');
  assert.ok(begins > 0, 'Monday should export at least one event');
});

test('ics text escaping protects the separators', () => {
  assert.equal(icsEscape('a,b'), 'a\\,b');
  assert.equal(icsEscape('a;b'), 'a\\;b');
  assert.equal(icsEscape('a\nb'), 'a\\nb');
  assert.equal(icsEscape('a\\b'), 'a\\\\b');
});
