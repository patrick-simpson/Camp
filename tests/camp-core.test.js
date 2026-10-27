// camp-core.js — the pure helpers the app and the TV page share: Eastern-time
// maths, the double-points window, and the sanitizers. The harness loads the
// real file ahead of app.js, so these call the shipped functions directly.

const ISO = (s) => Date.parse(s);

// ── Eastern time ─────────────────────────────────────────────────────

test('etWallToEpoch: July is UTC-4, January UTC-5, minutes past a day roll over', () => {
  assert.equal(etWallToEpoch('2026-07-23', 17 * 60), ISO('2026-07-23T21:00:00Z'), 'Thu 5 PM EDT');
  assert.equal(etWallToEpoch('2027-01-11', 9 * 60), ISO('2027-01-11T14:00:00Z'), '9 AM EST');
  assert.equal(etWallToEpoch('2027-07-18', 0), ISO('2027-07-18T04:00:00Z'), 'midnight');
  assert.equal(etWallToEpoch('2027-07-18', 1440 + 60), ISO('2027-07-19T05:00:00Z'), 'minutes past 1439 are the next day');
  assert.equal(etWallToEpoch('2027-07-18', 4 * 1440 + 17 * 60), ISO('2027-07-22T21:00:00Z'), 'Thursday 5 PM of a week that starts on this Sunday');
});

test('etWallToEpoch across both DST changes', () => {
  assert.equal(etWallToEpoch('2026-03-08', 60), ISO('2026-03-08T06:00:00Z'), '1:00 AM EST before spring-forward');
  assert.equal(etWallToEpoch('2026-03-08', 180), ISO('2026-03-08T07:00:00Z'), '3:00 AM EDT after it');
  assert.equal(etWallToEpoch('2026-03-08', 150), ISO('2026-03-08T07:30:00Z'), "2:30 AM doesn't exist: lands an hour later");
  assert.equal(etWallToEpoch('2026-11-01', 0), ISO('2026-11-01T04:00:00Z'), 'midnight EDT on fall-back day');
  assert.equal(etWallToEpoch('2026-11-01', 90), ISO('2026-11-01T06:30:00Z'), '1:30 AM happens twice: picks EST');
  assert.equal(etWallToEpoch('2026-11-01', 180), ISO('2026-11-01T08:00:00Z'), '3:00 AM EST after it');
  assert.equal(etWallToEpoch('2026-11-01', 1440), ISO('2026-11-02T05:00:00Z'), 'the next midnight is EST');
});

test('etWallToEpoch refuses what is not a real date or number', () => {
  ['', null, undefined, '2026-7-4', '07/04/2026', '2026-02-31', '2026-13-01', '2026-00-10', 'tomorrow'].forEach((bad) => {
    assert.ok(Number.isNaN(etWallToEpoch(bad, 0)), `date ${JSON.stringify(bad)}`);
  });
  [NaN, Infinity, undefined, 'x'].forEach((bad) => {
    assert.ok(Number.isNaN(etWallToEpoch('2026-07-23', bad)), `minutes ${String(bad)}`);
  });
  assert.ok(Number.isFinite(etWallToEpoch('2028-02-29', 0)), 'a leap day is real');
});

// The alert sender (push-worker/worker.js) is pasted into Cloudflare and keeps
// its own copy of this maths. The two must never disagree about when an Eastern
// wall time is, or a "5:00 PM" alert and a "5:00 PM" double window drift apart.
test('etWallToEpoch agrees with the alert sender across three years of days and every DST edge', async () => {
  const W = (await importModule('../push-worker/worker.js')).default._test;
  const minutes = [0, 59, 60, 90, 119, 120, 121, 150, 180, 600, 1020, 1439, 1440, 1440 + 150, 7 * 1440];
  let checked = 0;
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2029, 0, 1); t += 86400000) {
    const d = new Date(t);
    const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    minutes.forEach((m) => {
      assert.equal(etWallToEpoch(ymd, m), W.etWallToEpoch(ymd, m), `${ymd} +${m} min`);
      checked++;
    });
  }
  assert.ok(checked > 16000);
});

// ── The double-points window ─────────────────────────────────────────

const LEGACY_START = ISO('2026-07-23T21:00:00Z');
const LEGACY_END = ISO('2026-07-25T04:00:00Z');
const SEEDED_RELATIVE = { fromDow: 4, fromMin: 1020, toDow: 6, toMin: 0 };

test('legacy pin: the constants are exactly summer 2026 and the app reads them through camp-core', () => {
  setMemberRole('editor'); // bonusCountsDouble is a points reader: directors only (standings secrecy)
  assert.equal(DOUBLE_BONUS_START, LEGACY_START, 'Thu 5 PM ET');
  assert.equal(DOUBLE_BONUS_END, LEGACY_END, 'Fri midnight ET (00:00 Sat)');
  assert.equal(DOUBLE_WINDOW_LEGACY.start, LEGACY_START);
  assert.equal(DOUBLE_WINDOW_LEGACY.end, LEGACY_END);
  assert.ok(Object.isFrozen(DOUBLE_WINDOW_LEGACY), 'nothing can nudge the legacy window');
  const at = (ms) => ({ category: 'custom', at: new Date(ms).toISOString() });
  [[LEGACY_START - 1, false], [LEGACY_START, true], [LEGACY_END - 1, true], [LEGACY_END, false]].forEach(([ms, want]) => {
    assert.equal(bonusCountsDouble(at(ms)), want, 'app.js bonusCountsDouble at ' + new Date(ms).toISOString());
    assert.equal(bonusIsDouble(at(ms), DOUBLE_WINDOW_LEGACY), want, 'camp-core bonusIsDouble at ' + new Date(ms).toISOString());
  });
  assert.equal(inDoubleBonusWindow(), Date.now() >= LEGACY_START && Date.now() < LEGACY_END, 'the notice follows the same window');
});

test('bonusIsDouble: cleanup never doubles, junk timestamps never double, no window means no doubling', () => {
  const win = DOUBLE_WINDOW_LEGACY;
  const inside = new Date(LEGACY_START + 3600000).toISOString();
  assert.equal(bonusIsDouble({ category: 'verse', at: inside }, win), true);
  assert.equal(bonusIsDouble({ category: 'custom', at: inside }, win), true);
  assert.equal(bonusIsDouble({ category: 'cleanup', at: inside }, win), false, 'meal cleanup is exempt');
  [null, undefined, {}, { at: '' }, { at: 'garbage' }, { at: null }, { category: 'verse' }].forEach((b) => {
    assert.equal(bonusIsDouble(b, win), false, JSON.stringify(b));
  });
  assert.equal(bonusIsDouble({ category: 'verse', at: inside }, null), false, 'a null window (no doubling)');
  assert.equal(bonusIsDouble({ category: 'verse', at: inside }, undefined), false);
});

test('doubleWindowFor: a legacy week (no epoch) is pinned to the constants whatever else is passed', () => {
  assert.equal(doubleWindowFor({ epoch: '', weekStart: '2027-07-18', double: SEEDED_RELATIVE }), DOUBLE_WINDOW_LEGACY);
  assert.equal(doubleWindowFor({ weekStart: '2027-07-18', double: { fromDow: 1, fromMin: 0, toDow: 2, toMin: 0 } }), DOUBLE_WINDOW_LEGACY);
  assert.equal(doubleWindowFor({}), DOUBLE_WINDOW_LEGACY);
  assert.equal(doubleWindowFor(null), DOUBLE_WINDOW_LEGACY);
  assert.equal(doubleWindowFor(undefined), DOUBLE_WINDOW_LEGACY);
});

test('doubleWindowFor: the seeded relative window resolved against Sunday 2026-07-19 equals the constants to the millisecond', () => {
  const w = doubleWindowFor({ epoch: 'w20260719', weekStart: '2026-07-19', double: SEEDED_RELATIVE });
  assert.equal(w.start, LEGACY_START);
  assert.equal(w.end, LEGACY_END);
});

test('doubleWindowFor: a new-year week resolves in camp time, across DST, and toDow 7 is the following Sunday', () => {
  // Week starting Sun 2027-03-07; DST starts Sun 2027-03-14 at 2:00 AM.
  const w = doubleWindowFor({ epoch: 'w20270307', weekStart: '2027-03-07', double: { fromDow: 6, fromMin: 20 * 60, toDow: 7, toMin: 4 * 60 } });
  assert.equal(w.start, ISO('2027-03-14T01:00:00Z'), 'Sat 8 PM is still EST');
  assert.equal(w.end, ISO('2027-03-14T08:00:00Z'), 'Sun 4 AM is EDT, past the jump');
  const summer = doubleWindowFor({ epoch: 'w20270718', weekStart: '2027-07-18', double: SEEDED_RELATIVE });
  assert.equal(summer.start, ISO('2027-07-22T21:00:00Z'));
  assert.equal(summer.end, ISO('2027-07-24T04:00:00Z'));
  const end7 = doubleWindowFor({ epoch: 'w20270718', weekStart: '2027-07-18', double: { fromDow: 4, fromMin: 1020, toDow: 7, toMin: 0 } });
  assert.equal(end7.end, ISO('2027-07-25T04:00:00Z'), 'toDow 7 = the following Sunday 00:00');
});

test('doubleWindowFor: a new-year week with missing or unusable dates doubles nothing', () => {
  const ok = { epoch: 'w20270718', weekStart: '2027-07-18', double: SEEDED_RELATIVE };
  assert.ok(doubleWindowFor(ok), 'control');
  [
    { ...ok, double: undefined },
    { ...ok, double: null },
    { ...ok, weekStart: undefined },
    { ...ok, weekStart: '2027-02-30' },
    { ...ok, weekStart: 'next sunday' },
    { ...ok, double: { ...SEEDED_RELATIVE, fromDow: 8 } },
    { ...ok, double: { ...SEEDED_RELATIVE, toDow: -1 } },
    { ...ok, double: { ...SEEDED_RELATIVE, fromMin: 1440 } },
    { ...ok, double: { ...SEEDED_RELATIVE, toMin: 'x' } },
    { ...ok, double: { ...SEEDED_RELATIVE, fromDow: 1.5 } },
    { ...ok, double: { fromDow: 4, fromMin: 1020, toDow: 4, toMin: 1020 } },
    { ...ok, double: { fromDow: 5, fromMin: 0, toDow: 4, toMin: 0 } },
  ].forEach((o) => assert.equal(doubleWindowFor(o), null, JSON.stringify(o)));
});

test('liveGameIdSet: ids of the games that exist; null (not empty) when there is no config to judge by', () => {
  assert.deepEqual([...liveGameIdSet({ games: [{ id: 'a' }, { id: 'b' }, null, { name: 'no id' }, { id: '' }] })], ['a', 'b']);
  assert.deepEqual([...liveGameIdSet({ games: { 1: { id: 'b' }, 0: { id: 'a' } } })], ['a', 'b'], 'RTDB can round-trip an array as an object');
  assert.equal(liveGameIdSet(null), null);
  assert.equal(liveGameIdSet({}), null);
  assert.equal(liveGameIdSet({ games: null }), null);
  assert.equal(liveGameIdSet({ games: [] }).size, 0, 'a real, empty catalog is not "unknown"');
});

// ── Sanitizers ───────────────────────────────────────────────────────

test('safeEmoji keeps real emoji (including long ZWJ sequences) and refuses markup', () => {
  ['🦊', '🏕️', '👨‍👩‍👧‍👦', '🏳️‍🌈', '1️⃣', '🇺🇸'].forEach((e) => assert.equal(safeEmoji(e, 'F'), e, e));
  assert.equal(safeEmoji('  🦊  ', 'F'), '🦊', 'trimmed');
  assert.equal(safeEmoji('<img src=x onerror=alert(1)>', 'F'), 'F', 'a payload is far past 16 units once its brackets go');
  assert.equal(safeEmoji('"><script>alert(1)</script>', 'F'), 'F');
  assert.ok(!/[<>&"'`]/.test(safeEmoji('<b>x', 'F')), 'a short one keeps no markup characters');
  assert.equal(safeEmoji('<>&"\'`', 'F'), 'F', 'nothing left means the fallback');
  assert.equal(safeEmoji('🦊\u0000\n', 'F'), '🦊', 'control characters go');
  assert.equal(safeEmoji('x'.repeat(17), 'F'), 'F', 'over 16 units');
  assert.equal(safeEmoji('x'.repeat(16), 'F'), 'x'.repeat(16));
  [undefined, null, 5, {}, [], ''].forEach((v) => assert.equal(safeEmoji(v, 'F'), 'F', String(v)));
  assert.equal(safeEmoji(undefined), '', 'no fallback given is an empty string, never undefined');
});

test('safeShort bounds a short name and returns plain text', () => {
  assert.equal(safeShort('Foxes', 'F'), 'Foxes');
  assert.equal(safeShort('  John \n\t Deersz ', 'F'), 'John Deersz', 'whitespace collapsed');
  assert.equal(safeShort('a'.repeat(40), 'F'), 'a'.repeat(20), 'cut to 20');
  assert.equal(safeShort('a'.repeat(19) + '🦊', 'F'), 'a'.repeat(19), 'never half an emoji');
  assert.equal(safeShort('Q&A <b>', 'F'), 'Q&A <b>', 'plain text: the caller esc()s it into markup');
  assert.equal(safeShort('\u0000\u0001', 'F'), 'F');
  [undefined, null, 5, {}, ''].forEach((v) => assert.equal(safeShort(v, 'F'), 'F', String(v)));
});

test('safeColorVars emits only palette swatches or hex digits', () => {
  const palette = { red: { l: '#b42318', d: '#ff8a80' }, bad: { l: 'red; background:url(x)', d: '#ff8a80' } };
  assert.equal(safeColorVars('red', '#111111', palette), '--team-accent-l:#b42318;--team-accent-d:#ff8a80');
  assert.equal(safeColorVars('#aBc123', null, palette), '--team-accent-l:#aBc123;--team-accent-d:#aBc123', 'a legacy hex is the same in both themes');
  assert.equal(safeColorVars(undefined, '#e2672b', palette), '--team-accent-l:#e2672b;--team-accent-d:#e2672b', 'no colour yet: the camp accent');
  assert.equal(safeColorVars('nope', '#e2672b', palette), '--team-accent-l:#e2672b;--team-accent-d:#e2672b', 'unknown id: the camp accent');
  assert.equal(safeColorVars('bad', '#e2672b', palette), '--team-accent-l:#e2672b;--team-accent-d:#e2672b', 'a corrupted swatch is not trusted');
  ['red;x', '#fff', '#12345g', 'url(javascript:1)', '__proto__', 'constructor', 'toString'].forEach((c) => {
    assert.equal(safeColorVars(c, null, palette), '', `${c} with no usable fallback`);
  });
  assert.equal(safeColorVars('red', 'junk', null), '', 'no palette, no valid fallback');
});

test('safeCrestSrc: a whole inline PNG/JPEG or a shipped crest, nothing else', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal(safeCrestSrc(png), png);
  assert.equal(safeCrestSrc('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
  assert.equal(safeCrestSrc('images/team-shields/ferocious-foxes.webp?v=5'), 'images/team-shields/ferocious-foxes.webp?v=5');
  assert.equal(safeCrestSrc('images/team-shields/turkey-dinner.webp'), 'images/team-shields/turkey-dinner.webp');
  [
    'data:image/png;base64,AAAA" onerror="alert(1)',            // quote-breakout: passes a prefix check
    'data:image/png;base64,AAAA\' onerror=\'alert(1)',
    'data:image/png;base64,AAAA onerror=alert(1)',
    'data:image/png;base64,AAAA>',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',              // svg can script
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,',                                    // empty body
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'https://evil.example/pixel.png',                            // an outbound request
    '//evil.example/pixel.png',
    'http://evil.example/x.png',
    'images/team-shields/../../app.js',
    'images/team-shields/x.webp" onerror="1',
    '/images/team-shields/ferocious-foxes.webp',
    'images/other/ferocious-foxes.webp',
    '',
    undefined, null, 5, {}, [],
  ].forEach((bad) => assert.equal(safeCrestSrc(bad), null, String(bad)));
});

test('safeVideoUrl: https only, a real host, no quotes, whitespace or credentials', () => {
  assert.equal(safeVideoUrl('https://www.youtube.com/embed/abc123?rel=0'), 'https://www.youtube.com/embed/abc123?rel=0');
  assert.equal(safeVideoUrl('https://youtu.be/abc123'), 'https://youtu.be/abc123');
  [
    'http://www.youtube.com/embed/abc', 'javascript:alert(1)', 'data:text/html,x', '//youtube.com/x',
    'https://user:pw@youtube.com/x', 'https://localhost/x', 'https://youtube.com/x y', 'https://youtube.com/x"onload="1',
    'https://youtube.com/<script>', 'https://', 'https://.com', '', undefined, null, 7,
    'https://youtube.com/' + 'a'.repeat(500),
  ].forEach((bad) => assert.equal(safeVideoUrl(bad), null, String(bad).slice(0, 60)));
});

test('camp-core is pure: it declares helpers and constants and nothing runs at load', () => {
  const src = readFixture('../camp-core.js');
  assert.notOk(/\b(document|window|localStorage|sessionStorage|firebase|fetch|XMLHttpRequest|navigator|location)\b/.test(src.replace(/\/\/.*$/gm, '')),
    'no DOM, storage or network access in code');
  assert.notOk(/^(?!\s*(\/\/|const |let |function |\}|\s))\S/m.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'only top-level declarations and comments');
});
