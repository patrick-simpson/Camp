// The "Add to calendar" export (buildDayIcs) — setup-rebuild-spec S0e. A
// calendar app is a strict reader: a UID shared between two files silently
// overwrites the other's events, and an over-long line is dropped or mangled.
// Runs for both camps: ics.senior.test.js evals this same file under the
// senior profile.

const DOWS = [1, 2, 3, 4, 5];

function unfold(ics) { return ics.replace(/\r\n /g, ''); }
function octets(s) { return unescape(encodeURIComponent(s)).length; }
function uidsOf(ics) { return unfold(ics).split('\r\n').filter((l) => l.startsWith('UID:')).map((l) => l.slice(4)); }

test('every content line is at most 75 octets, in every day of the week', () => {
  DOWS.forEach((dow) => {
    const ics = buildDayIcs(dow);
    assert.ok(ics.endsWith('\r\n'), 'CRLF line endings, ending on one');
    ics.split('\r\n').forEach((line) => {
      assert.ok(octets(line) <= 75, `day ${dow}: ${octets(line)} octets in "${line}"`);
    });
  });
});

test('icsFold counts octets, never splits a character, and unfolds back exactly', () => {
  assert.equal(icsFold('short'), 'short');
  const plain = 'A'.repeat(200);
  const folded = icsFold(plain);
  assert.equal(folded.replace(/\r\n /g, ''), plain, 'unfolds to the original');
  folded.split('\r\n').forEach((l, i) => assert.ok(octets(l) <= 75, 'line ' + i + ' is ' + octets(l)));
  assert.equal(folded.split('\r\n')[0].length, 75, 'the first line takes all 75');
  assert.equal(folded.split('\r\n')[1].length, 75, 'a continuation is a space plus 74');
  // A 4-byte emoji straddling the limit moves whole to the next line.
  const edge = 'a'.repeat(73) + '🍳' + 'tail';
  const parts = icsFold(edge).split('\r\n');
  assert.equal(parts[0], 'a'.repeat(73), 'two octets would be left: the emoji does not fit');
  assert.equal(parts[1], ' 🍳tail');
  parts.forEach((l) => assert.notOk(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(l), 'no lone surrogate'));
  // Multi-byte text all the way down: 3-byte characters.
  const wide = '日'.repeat(60);
  icsFold(wide).split('\r\n').forEach((l) => assert.ok(octets(l) <= 75));
  assert.equal(icsFold(wide).replace(/\r\n /g, ''), wide);
});

test('a long description folds and unfolds to the full text', () => {
  const dow = 1;
  const dayId = state.config.days.find((d) => d.dow === dow).id;
  const session = DAY_SCHEDULE[dow].find((b) => b.type === 'games');
  assert.ok(session, 'precondition: Monday has a games block');
  state.config.games.push({
    id: 'ics-long', name: 'A game with a really quite exceedingly long name to push the line well past the limit',
    emoji: '🎯', dayId, session: session.start < 720 ? 'Morning' : 'Evening', format: 'placement', rules: [],
  });
  // Once the schedule is edited here a game is listed under the item it is LINKED to; a new one has no link yet,
  // which is what Put games on the schedule writes (the seeded pass runs this file with the schedule on).
  if (scheduleIsShared()) setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (d) => planForDow(d), CAMP).ops);
  const ics = buildDayIcs(dow);
  const desc = unfold(ics).split('\r\n').find((l) => l.startsWith('DESCRIPTION:') && l.includes('exceedingly'));
  assert.ok(desc, 'the games block names the game');
  assert.ok(/\r\n [^\r]/.test(ics), 'and at least one line was folded');
  assert.ok(desc.includes('push the line well past the limit'), 'nothing lost in the fold');
  state.config.games.pop();
});

test('UIDs are unique within a day and across the whole week', () => {
  const seen = new Set();
  DOWS.forEach((dow) => {
    const uids = uidsOf(buildDayIcs(dow));
    assert.ok(uids.length > 0, 'day ' + dow + ' has events');
    assert.equal(new Set(uids).size, uids.length, 'day ' + dow + ' repeats a UID');
    uids.forEach((u) => { assert.notOk(seen.has(u), u + ' appears on two days'); seen.add(u); });
  });
});

test('UIDs carry the camp, so the two camps\' exports can never overwrite each other', () => {
  uidsOf(buildDayIcs(2)).forEach((u) => {
    assert.ok(u.startsWith(CAMP.id + '-2-'), u);
    assert.ok(u.endsWith('@camp.patricksimpson.info'), u);
  });
  assert.notOk(uidsOf(buildDayIcs(2)).some((u) => u.startsWith('campday-')), 'the old shared shape is gone');
});

test('a UID is stable between exports (a re-import updates, never duplicates)', () => {
  assert.deepEqual(uidsOf(buildDayIcs(3)), uidsOf(buildDayIcs(3)));
});

test('two blocks starting together still get different UIDs', () => {
  const realDay = DAY_SCHEDULE[1];
  const clone = realDay.concat([Object.assign({}, realDay[0], { label: 'Twin' })]);
  DAY_SCHEDULE[1] = clone;
  try {
    const uids = uidsOf(buildDayIcs(1));
    assert.equal(new Set(uids).size, uids.length);
  } finally { DAY_SCHEDULE[1] = realDay; }
});

test('the calendar names itself after the camp', () => {
  const lines = unfold(buildDayIcs(1)).split('\r\n');
  assert.ok(lines.includes('X-WR-CALNAME:' + CAMP.label), CAMP.label);
});

// ── the whole week as one file (setup-rebuild-spec §12.4, step 15) ───────────────────────────────

const WK_START = '2027-07-18'; // a Sunday
const WK_NOW = new Date('2027-07-20T13:40:00Z'); // Tuesday 9:40 AM ET
const WK_DOWS = [0, 1, 2, 3, 4, 5, 6];
const wkLines = (ics) => unfold(ics).split('\r\n');
const wkProp = (ics, name) => wkLines(ics).filter((l) => l.startsWith(name + ':') || l.startsWith(name + ';'));

// The seeded pass (run.js) runs this file against a camp whose schedule is already edited here. Every helper below keeps
// it that way: wkSet / wkReset put back the seeded tree (not an empty one, which would switch the schedule OFF from the
// first week test on and quietly turn the rest of the pass into the plain one).
const ICS_SEEDED = scheduleIsShared();
function wkSeed(week) {
  setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP))));
  if (week) setupTree.meta.weekStart = week;
  setupRev++;
}
function wkSet(week) {
  if (ICS_SEEDED) { wkSeed(week); return; }
  setupTree = normalizeSetup(week ? { meta: { weekStart: week } } : {});
  setupRev++;
}
// The built-in week on purpose, in either pass (a test of what the printed copy does).
function wkOff(week) {
  setupTree = normalizeSetup(week ? { meta: { weekStart: week } } : {});
  setupRev++;
}
function wkReset() {
  if (ICS_SEEDED) wkSeed(null);
  else { setupTree = normalizeSetup({}); setupRev++; }
  setupEdited = {};
}

test('the helpers keep the pass what it says it is: the seeded run stays on the edited-here week, the plain run on the printed one', () => {
  wkSet(WK_START);
  assert.equal(scheduleIsShared(), ICS_SEEDED);
  wkReset();
  assert.equal(scheduleIsShared(), ICS_SEEDED);
  wkOff(WK_START);
  assert.equal(scheduleIsShared(), false, 'wkOff is the printed copy in either pass');
  wkReset();
});

test('no camp dates, no week file: it is null, and the sheet offers nothing for it', () => {
  wkReset();
  assert.equal(buildWeekIcs(), null);
  assert.equal(renderWeekIcsEntry(), '', 'the schedule sheet is exactly what it was before dates exist');
  const today = campDateStr().replace(/-/g, '');
  assert.ok(/^\d{8}$/.test(campDateForDow(3)) && campDateForDow(campNow().dow) === today, 'a day\'s date is still "this week" until dates are set');
});

test('a week file is well formed: one calendar, the camp\'s name and dates, the New York zone, one event per timed block of the week', () => {
  wkSet(WK_START);
  try {
    const ics = buildWeekIcs({ now: WK_NOW });
    assert.ok(ics.endsWith('\r\n'));
    const lines = wkLines(ics);
    assert.equal(lines[0], 'BEGIN:VCALENDAR');
    assert.equal(lines[lines.length - 2], 'END:VCALENDAR');
    assert.ok(lines.includes('VERSION:2.0'));
    assert.ok(lines.includes('PRODID:-//camp.patricksimpson.info//Camp Scoreboard//EN'));
    assert.ok(lines.includes('METHOD:PUBLISH'));
    assert.ok(lines.includes('X-WR-TIMEZONE:America/New_York'));
    assert.ok(lines.includes('X-WR-CALNAME:' + CAMP.label + ' · Jul 18–24\\, 2027'), 'the comma in the dates is escaped, as RFC 5545 asks of a TEXT value');
    const desc = lines.find((l) => l.startsWith('X-WR-CALDESC:'));
    assert.ok(desc.includes('snapshot') && desc.includes('Tue 9:40 AM') && desc.includes('delete the old camp events first'), 'the snapshot note is in the file too');
    assert.ok(lines.includes('TZID:America/New_York') && lines.filter((l) => l === 'BEGIN:VTIMEZONE').length === 1);
    const want = WK_DOWS.reduce((n, d) => n + scheduleForDow(d).filter((b) => !b.noTime).length, 0);
    assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, want, 'every timed block, nothing untimed (Lights out)');
    assert.equal(lines.filter((l) => l === 'END:VEVENT').length, want);
    ics.split('\r\n').forEach((line) => assert.ok(octets(line) <= 75, octets(line) + ' octets: ' + line));
  } finally { wkReset(); }
});

test('week file dates are the camp week\'s own (weekStart + dow), across a month and a year edge', () => {
  try {
    wkSet(WK_START);
    const ics = buildWeekIcs({ now: WK_NOW });
    const dtstarts = wkProp(ics, 'DTSTART').filter((l) => l.includes('TZID=America/New_York:2027'));
    assert.ok(dtstarts.some((l) => l.includes('20270718T')), 'Sunday is the 18th');
    assert.ok(dtstarts.some((l) => l.includes('20270724T')), 'Saturday is the 24th');
    assert.ok(!dtstarts.some((l) => l.includes('20270725T')), 'nothing falls outside the seven days');
    // Dec 26 2027 is a Sunday: Saturday is January 1, 2028.
    wkSet('2027-12-26');
    const yearEdge = buildWeekIcs({ now: WK_NOW });
    assert.ok(wkLines(yearEdge).includes('X-WR-CALNAME:' + CAMP.label + ' · Dec 26 – Jan 1\\, 2028'));
    assert.ok(wkProp(yearEdge, 'DTSTART').some((l) => l.includes('20280101T')), 'Saturday is New Year\'s Day');
    // DST ends Sunday Nov 7 2027: wall-clock times are written in the zone, so nothing shifts — the VTIMEZONE says why.
    wkSet('2027-11-07');
    const dst = buildWeekIcs({ now: WK_NOW });
    assert.ok(wkProp(dst, 'DTSTART').some((l) => l.includes('TZID=America/New_York:20271107T')), 'times stay wall-clock in New York');
    assert.ok(wkLines(dst).includes('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU') && wkLines(dst).includes('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU'), 'the zone carries both DST rules');
    assert.ok(!wkLines(dst).some((l) => /^DTSTART:.*Z$/.test(l) && l.includes('2027')), 'no UTC start times to be wrong across the change');
  } finally { wkReset(); }
});

test('week UIDs: unique in the file, carry camp + week + day, differ per week and per camp-day, stable between exports', () => {
  wkSet(WK_START);
  try {
    const uids = uidsOf(buildWeekIcs({ now: WK_NOW }));
    assert.ok(uids.length > 40);
    assert.equal(new Set(uids).size, uids.length, 'no UID twice (the old junior Tue/Thu duplicate is gone)');
    uids.forEach((u) => {
      assert.ok(u.startsWith(CAMP.id + '-' + WK_START + '-'), u);
      assert.ok(u.endsWith('@camp.patricksimpson.info'), u);
    });
    assert.deepEqual(uidsOf(buildWeekIcs({ now: new Date(WK_NOW.getTime() + 86400000) })), uids, 'a re-export a day later is the same events (so a re-import updates them)');
    wkSet('2027-07-25');
    const next = uidsOf(buildWeekIcs({ now: WK_NOW }));
    assert.ok(next.every((u) => u.includes('-2027-07-25-')) && next.every((u) => !uids.includes(u)), 'another week is other events');
  } finally { wkReset(); }
});

test('with the schedule edited here, a UID is camp + week + day + BLOCK id: a rename or a move keeps it, SEQUENCE and LAST-MODIFIED follow the edit', () => {
  wkSeed(WK_START);
  try {
    const lunch = planForDow(2).find((b) => b.label === 'Lunch');
    const before = buildWeekIcs({ now: WK_NOW });
    const uid = CAMP.id + '-' + WK_START + '-tue-' + lunch.id + '@camp.patricksimpson.info';
    assert.ok(uidsOf(before).includes(uid), 'tuesday lunch: ' + uid);
    assert.deepEqual(wkProp(before, 'SEQUENCE').filter((l) => l !== 'SEQUENCE:0'), [], 'never edited here: SEQUENCE 0');
    assert.deepEqual(wkProp(before, 'LAST-MODIFIED'), []);
    setupTree.typical[lunch.id].label = 'Midday meal'; setupTree.typical[lunch.id].start = 725; setupTree.typical[lunch.id].end = 755;
    setupRev++;
    setupEdited = { schedule: { at: Date.UTC(2027, 6, 20, 13, 30), byKey: 'jenn@example,com' } };
    const after = buildWeekIcs({ now: WK_NOW });
    assert.ok(uidsOf(after).includes(uid), 'the same UID after a rename and a move');
    const i = wkLines(after).indexOf('UID:' + uid);
    const ev = wkLines(after).slice(i, i + 9);
    assert.ok(ev.some((l) => l === 'SUMMARY:' + lunch.emoji + ' Midday meal') || ev.some((l) => l.startsWith('SUMMARY:') && l.includes('Midday meal')));
    assert.ok(ev.some((l) => l.startsWith('DTSTART;TZID=America/New_York:20270720T1205')), 'on Tuesday the 20th at 12:05');
    const seq = Number(ev.find((l) => l.startsWith('SEQUENCE:')).slice(9));
    assert.equal(seq, Math.floor((Date.UTC(2027, 6, 20, 13, 30) - (Date.UTC(2027, 6, 18) - 180 * 86400000)) / 60000), 'minutes from 180 days before the week to the edit');
    assert.ok(ev.includes('LAST-MODIFIED:20270720T133000Z'));
    setupEdited = { schedule: { at: Date.UTC(2027, 6, 20, 13, 31), byKey: 'jenn@example,com' } };
    const later = Number(wkLines(buildWeekIcs({ now: WK_NOW })).find((l) => l.startsWith('SEQUENCE:')).slice(9));
    assert.ok(later > seq, 'every edit raises it: a calendar that honours SEQUENCE updates in place');
  } finally { wkReset(); }
});

test('built-in camps keep position + start in the UID, so nothing claims a stability the printed week does not have', () => {
  wkOff(WK_START);
  try {
    const uids = uidsOf(buildWeekIcs({ now: WK_NOW }));
    assert.ok(uids.some((u) => /^[a-z]+-2027-07-18-tue-\d+-\d+@/.test(u)), 'junior Tue and Thu movie night no longer share a UID');
    assert.ok(!uids.some((u) => /-b-/.test(u)), 'no block ids while the schedule is the built-in copy');
  } finally { wkReset(); }
});

test('an event says what is in it: the games, the menu, who is on cleanup — plain text, escaped', () => {
  wkSeed(WK_START);
  try {
    const day = competitionDays().find((d) => d.dow === 3);
    const games = allGames().filter((g) => g.dayId === day.id);
    setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (dow) => planForDow(dow), CAMP).ops);
    const ics = unfold(buildWeekIcs({ now: WK_NOW }));
    const block = scheduleForDow(3).find((b) => b.type === 'games');
    const listed = gamesForBlock(3, block);
    assert.ok(listed.length > 0, 'the games block has games');
    const evIdx = ics.split('\r\n').findIndex((l) => l === 'UID:' + CAMP.id + '-' + WK_START + '-wed-' + planForDow(3).find((b) => b.label === block.label).id + '@camp.patricksimpson.info');
    const body = ics.split('\r\n').slice(evIdx, evIdx + 10).find((l) => l.startsWith('DESCRIPTION:'));
    assert.ok(body && body.startsWith('DESCRIPTION:Games: '), body);
    listed.forEach((g) => assert.ok(body.includes(icsEscape(g.name)), g.name + ' is named'));
    assert.ok(games.length >= listed.length);
    // A meal: the dish (where the kitchen has said) and the cleanup crew (where there is a rota).
    const meal = planForDow(1).find((b) => b.meal === 'lunch');
    const mi = ics.split('\r\n').findIndex((l) => l === 'UID:' + CAMP.id + '-' + WK_START + '-mon-' + meal.id + '@camp.patricksimpson.info');
    const mealDesc = (ics.split('\r\n').slice(mi, mi + 10).find((l) => l.startsWith('DESCRIPTION:')) || '');
    if (mealInfo(1, scheduleForDow(1).find((b) => b.label === 'Lunch'))) assert.ok(mealDesc.includes('On the menu: '), mealDesc);
    if (cleanupOnRota(1)) assert.ok(mealDesc.includes('Cleanup: '), mealDesc);
    else assert.equal(mealDesc, '', 'senior has neither a menu nor a rota yet: no description at all');
    assert.ok(!/\n(?!\s)/.test(ics.replace(/\r\n/g, '')), 'newlines inside a description are escaped as \\n');
  } finally { wkReset(); }
});

test('one day, or the days from today, are the same builder asked for fewer events', () => {
  wkSet(WK_START);
  try {
    const all = buildWeekIcs({ now: WK_NOW });
    const wed = buildWeekIcs({ now: WK_NOW, dows: [3] });
    const wedUids = uidsOf(wed);
    assert.ok(wedUids.length > 5 && wedUids.every((u) => u.includes('-wed-')));
    assert.ok(wedUids.every((u) => uidsOf(all).includes(u)), 'the same UIDs as the week file: importing both never duplicates');
    const from = buildWeekIcs({ now: WK_NOW, fromDow: 3 });
    const fromUids = uidsOf(from);
    assert.ok(fromUids.length < uidsOf(all).length);
    assert.ok(fromUids.every((u) => /-(wed|thu|fri|sat)-/.test(u)), 'Sunday to Tuesday are left out');
    // With dates set, the per-day button is that builder too (and so keeps one UID per event).
    assert.deepEqual(uidsOf(buildDayIcs(3)), wedUids);
    assert.ok(unfold(buildDayIcs(3)).includes('X-WR-CALNAME:' + CAMP.label + ' · Jul 18–24\\, 2027'));
  } finally { wkReset(); }
});

test('the schedule sheet offers the week once dates exist — and "only from today" only from the camp\'s Sunday on, never on it', () => {
  const realDate = campDateStr;
  const realNow = campNow;
  // [camp date, weekday]: the clock is stubbed whole, so this reads the same on any day it is run.
  const at = (date, dow) => { campDateStr = () => date; campNow = () => ({ dow, minutes: 600 }); return renderWeekIcsEntry(); };
  try {
    wkSet(WK_START);
    let html = at('2027-07-10', 6);
    assert.ok(html.includes('sched-ics-week-btn') && html.includes('Add the whole week to my calendar'));
    assert.ok(!html.includes('sched-ics-from-btn'), 'not before the week');
    assert.ok(html.includes('download it again and delete the old camp events first'), 'said in plain words, under the button');
    assert.ok(!at('2027-07-17', 6).includes('sched-ics-from-btn'), 'the Saturday BEFORE camp is "during" (the freeze window) but "from today" would be one day: not offered');
    assert.ok(!at('2027-07-18', 0).includes('sched-ics-from-btn'), 'on the Sunday it is the whole week: not offered twice');
    assert.ok(at('2027-07-19', 1).includes('sched-ics-from-btn'), 'Monday');
    html = at('2027-07-21', 3);
    assert.ok(html.includes('sched-ics-from-btn'), 'mid-week');
    assert.equal(at('2027-07-21', 3), html, 'an idle re-render is the same markup');
    assert.ok(at('2027-07-24', 6).includes('sched-ics-from-btn'), 'the last day');
    assert.ok(!at('2027-07-25', 0).includes('sched-ics-from-btn'), 'the Sunday after: nothing left of the week to pick from');
    assert.ok(!at('2027-07-26', 1).includes('sched-ics-from-btn'), 'after the week');
    // And what the button asks for is the days from that weekday on.
    at('2027-07-21', 3);
    const from = uidsOf(buildWeekIcs({ now: WK_NOW, fromDow: campNow().dow }));
    assert.ok(from.length && from.every((u) => /-(wed|thu|fri|sat)-/.test(u)));
  } finally { campDateStr = realDate; campNow = realNow; wkReset(); }
});

test('the file name carries the week and the moment it was made', () => {
  wkSet(WK_START);
  try {
    assert.equal(weekIcsFileName(WK_NOW), CAMP.id + '-camp-2027-07-18-saved-0720-0940.ics');
    assert.equal(icsSavedStamp(WK_NOW).text, 'Tue 9:40 AM');
    assert.equal(icsSavedStamp(new Date('2027-07-20T22:05:00Z')).text, 'Tue 6:05 PM');
    assert.equal(icsWeekLabel('2027-07-25'), 'Jul 25–31, 2027');
    assert.equal(icsWeekLabel('2028-01-30'), 'Jan 30 – Feb 5, 2028');
  } finally { wkReset(); }
});

test('an edit on the Schedule screen reaches the calendar file: the new time and name, a stable UID for a moved item, nothing for a skipped one', () => {
  freshState();
  setMemberRole('editor');
  setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP))));
  setupRev++;
  const dow = 3;
  const pick = planForDow(dow).find((b) => b.origin === 'typical' && b.type === 'activity' && !b.noTime && !b.meal && !b.teams);
  const uidFor = (ics) => unfold(ics).split('\r\n').filter((l) => l.startsWith('UID:')).filter((l) => l.indexOf(pick.id) !== -1);
  const before = buildDayIcs(dow);
  const uids0 = uidsOf(before);
  const r = schedCommit({ kind: 'edit', dk: 'wed', bid: pick.id, scope: 'day', item: { label: 'Archery', emoji: pick.emoji, start: pick.start + 15, end: pick.end + 15, type: pick.type }, label: 'x' });
  assert.equal(r.ok, true);
  const after = buildDayIcs(dow);
  assert.ok(/Archery/.test(unfold(after)), 'the new name');
  assert.equal(uidsOf(after).length, uids0.length);
  assert.deepEqual(uidsOf(after), uids0, 'moving or renaming an item never changes its UID: a re-import updates in place');
  schedCommit({ kind: 'remove', dk: 'wed', bid: pick.id, scope: 'day', label: 'x' });
  assert.equal(uidsOf(buildDayIcs(dow)).length, uids0.length - 1, 'a skipped item is not in the file');
  assert.ok(!/Archery/.test(unfold(buildDayIcs(dow))));
});
