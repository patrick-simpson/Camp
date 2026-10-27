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
