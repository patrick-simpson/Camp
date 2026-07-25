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

// ── Notice board (the big top-of-page card) ──────────────────────

test('a database that has never had a notice gets the example as a DRAFT', () => {
  freshState();
  delete state.notice;
  normalizeSyncedState();
  assert.equal(state.notice.status, 'draft', 'seeding must never post a card by itself');
  assert.equal(noticeCardHtml(false), null, 'and nothing renders');
  assert.ok(state.notice.zones.length && state.notice.steps.length, 'the example has content to edit');
});

test('the seeded example covers every team exactly once', () => {
  const ids = makeFreshState().teams.map((t) => t.id);
  const assigned = defaultNotice().zones.map((z) => z.teamId);
  assigned.forEach((id) => assert.ok(ids.includes(id), `zone names unknown team "${id}"`));
  assert.equal(new Set(assigned).size, assigned.length, 'a team is listed twice');
  ids.forEach((id) => assert.ok(assigned.includes(id), `no area for team "${id}" — somebody has nowhere to go`));
  defaultNotice().zones.forEach((z) => assert.ok(z.place, `team ${z.teamId} has no place`));
});

test('the example sends campers to their area before the cabins', () => {
  // Campers are NOT to go up to the cabins after breakfast — they go straight
  // to their team's area, and only head up once the Tabernacle is set.
  const order = defaultNotice().steps.map((s) => s.when.toLowerCase());
  const area = order.findIndex((w) => w.includes('after breakfast'));
  const cabins = order.findIndex((w) => w.startsWith('cabins'));
  const gone = order.findIndex((w) => w.includes('campers have gone'));
  assert.ok(area >= 0 && cabins >= 0 && gone >= 0, 'expected all three stages');
  assert.ok(area < cabins, 'team areas come before the cabins');
  assert.ok(cabins < gone, 'the cabins are packed before the after-departure jobs');
});

// Posting is editor-only (see setNoticeStatus), so these run as an editor —
// via the auth test seam, not localStorage (roles come from the member
// record now, never from the device).
setMemberRole('editor');

test('a draft renders nowhere, a posted notice renders everything', () => {
  freshState();
  const n = noticeBoard();
  assert.equal(n.status, 'draft');
  assert.equal(noticeCardHtml(false), null, 'draft: invisible');
  assert.ok(noticeCardHtml(true), 'but the builder can still preview it');

  setNoticeStatus('posted');
  const html = noticeCardHtml(false);
  assert.ok(html, 'posted: visible');
  assert.ok(html.includes(esc(n.title)));
  assert.ok(html.includes(esc(n.signoff)));
  n.zones.forEach((z) => assert.ok(html.includes(esc(z.place)), `${z.place} missing`));
  n.steps.forEach((st) => {
    assert.ok(html.includes(esc(st.when)), `step "${st.when}" missing`);
    st.items.forEach((i) => assert.ok(html.includes(esc(i)), `"${i}" missing`));
  });
});

test('an empty posted notice stays hidden rather than showing a bare box', () => {
  freshState();
  state.notice = { status: 'posted', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] };
  assert.equal(noticeCardHtml(false), null);
});

test('only editors can post or take down a notice', () => {
  freshState();
  setMemberRole('viewer');
  setNoticeStatus('posted');
  assert.equal(noticeBoard().status, 'draft', 'a viewer must not be able to post to every phone');
  setMemberRole('editor');
  setNoticeStatus('posted');
  assert.equal(noticeBoard().status, 'posted');
  setNoticeStatus('nonsense');
  assert.equal(noticeBoard().status, 'posted', 'an unknown status is ignored');
});

test('a posted notice calls out the team you follow', () => {
  freshState();
  setNoticeStatus('posted');
  state.followTeam = noticeBoard().zones[0].teamId;
  assert.ok(noticeCardHtml(false).includes('notice-yours'), 'your own line is spelled out');
  assert.ok(noticeCardHtml(false).includes('notice-row-you'), 'and your row is marked');

  state.followTeam = null;
  const neutral = noticeCardHtml(false);
  assert.notOk(neutral.includes('notice-yours'), 'nothing personal for a neutral viewer');
  assert.notOk(neutral.includes('notice-row-you'));
});

test('a notice survives a roster that no longer matches', () => {
  freshState();
  setNoticeStatus('posted');
  state.teams = [{ id: noticeBoard().zones[0].teamId, name: 'Only Team Left' }];
  const html = noticeCardHtml(false);
  assert.ok(html.includes('Only Team Left'), 'the team that still exists is listed');
  assert.equal((html.match(/notice-row/g) || []).length, 1, 'deleted teams are skipped, not rendered blank');
});

test('a team with no place set is left off the list', () => {
  freshState();
  setNoticeStatus('posted');
  const n = noticeBoard();
  n.zones.forEach((z, i) => { if (i > 0) z.place = ''; });
  assert.equal((noticeCardHtml(false).match(/notice-row/g) || []).length, 1);
});

test('a renamed team is named correctly, and everything is escaped', () => {
  freshState();
  setNoticeStatus('posted');
  const n = noticeBoard();
  state.teams.find((t) => t.id === n.zones[0].teamId).name = 'The <Renamed> Crew';
  n.title = '<script>alert(1)</script>';
  const html = noticeCardHtml(false);
  assert.ok(html.includes('The &lt;Renamed&gt; Crew'), 'live name, HTML-escaped');
  assert.notOk(html.includes('<script>'), 'nothing an editor types can inject markup');
});

test('normalizeNotice heals every shape a sync round-trip can produce', () => {
  freshState();
  // RTDB prunes the empty strings and arrays right out of the object.
  state.notice = { status: 'posted' };
  normalizeSyncedState();
  const n = state.notice;
  assert.deepEqual(n.zones, []);
  assert.deepEqual(n.steps, []);
  ['eyebrow', 'title', 'sub', 'signoff'].forEach((k) => assert.equal(n[k], ''));
  assert.doesNotThrow(() => noticeCardHtml(true), 'and it still renders');

  // Junk / half-shaped rows are dropped or coerced rather than trusted.
  state.notice = {
    status: 'posted',
    zones: [null, { teamId: 't0' }, 'nope'],
    steps: [{ when: 'Do things' }, null],
  };
  normalizeSyncedState();
  assert.equal(state.notice.zones.length, 1);
  assert.equal(state.notice.zones[0].place, '');
  assert.equal(state.notice.steps.length, 1);
  assert.deepEqual(state.notice.steps[0].items, []);

  state.notice = { status: 'wat' };
  normalizeSyncedState();
  assert.equal(state.notice.status, 'draft', 'an unknown status falls back to invisible');
});

test('the notice travels with the rest of synced state', () => {
  freshState();
  assert.ok(SYNC_KEYS.includes('notice'), 'it has to reach the other phones');
  assert.ok(SYNC_SINGLETONS.includes('notice'), 'and is written whole, not per-child');
  const up = computeSyncUpdates(
    { notice: { status: 'draft' } },
    { notice: { status: 'posted' } },
  );
  assert.deepEqual(Object.keys(up), ['notice']);
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
