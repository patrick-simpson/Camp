// reveal-core.js — the standings reveal's pure rules (places, when a reveal
// hides, the fail-closed reader, the big screen's frame). Runs under both camp
// profiles (reveal-core.senior.test.js evals this file): nothing in it is junior
// or senior specific, but a camp has four or six teams, so the full-reveal
// helpers size themselves from CAMP.teamCount.

const T0 = Date.parse('2027-06-23T23:30:00Z'); // a Wednesday evening, 7:30 PM EDT
const N = CAMP.teamCount;

// One revealed team row, in the public node's compact shape.
function ent(id, p, extra) {
  return Object.assign({ nm: 'Team ' + id, p, g: 0, s: 0, b: 0, v: 0, m: 0, c: 0 }, extra || {});
}

// A well-formed ctl; every field overridable.
function mkCtl(o) {
  return Object.assign({
    v: 1, id: 'r1kz9fxq-4hd2', seq: 3, phase: 'live', cur: 1, shown: 2, teams: N, finale: false,
    at: T0 + 10000, sa: T0 + 10000, ca: T0, startedAt: T0, until: untilFor(T0, false),
  }, o || {});
}

// pub for the first `shown` places of a camp with N teams, worst place first
// (g0 = last place), one team per group, points 10 × place-from-the-bottom.
function mkPub(shown) {
  const pub = {};
  for (let i = 0; i < shown; i++) {
    const tid = 't' + (N - 1 - i);
    pub['g' + i] = { place: N - i, e: { [tid]: ent(tid, 10 * (N - i), { nm: 'Team ' + tid, g: 1 }) } };
  }
  return pub;
}

// ── Places ───────────────────────────────────────────────────────────

test('groupPlaces: equal points share a place and the next place skips', () => {
  const g = groupPlaces([ent('a', 30), ent('b', 20), ent('c', 20), ent('d', 5)]);
  assert.deepEqual(g.map((x) => x.place), [1, 2, 4]);
  assert.deepEqual(g.map((x) => x.entries.length), [1, 2, 1]);
});

test('groupPlaces: inside a tie, golds then silvers then bronzes then name', () => {
  const g = groupPlaces([
    ent('a', 20, { nm: 'Zed', g: 1 }), ent('b', 20, { nm: 'Amy', g: 2 }),
    ent('c', 20, { nm: 'Bea', g: 1, s: 1 }), ent('d', 20, { nm: 'Abe', g: 1, s: 1 }),
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].entries.map((e) => e.nm), ['Amy', 'Abe', 'Bea', 'Zed']);
});

test('groupPlaces: empty and junk input give no groups, not a throw', () => {
  [null, undefined, 'x', 7, {}, [], [null, 3, 'x']].forEach((bad) => {
    assert.deepEqual(groupPlaces(bad), [], JSON.stringify(bad));
  });
});

// ── When a reveal hides ──────────────────────────────────────────────

test('untilFor: 08:00 camp time the day after the start, DST-safe', () => {
  // Wednesday 7:30 PM EDT → Thursday 8:00 AM EDT
  assert.equal(untilFor(Date.parse('2027-06-23T23:30:00Z'), false), Date.parse('2027-06-24T12:00:00Z'));
  // after midnight still runs to 8 AM the NEXT calendar day (Thursday 12:30 AM → Friday)
  assert.equal(untilFor(Date.parse('2027-06-24T04:30:00Z'), false), Date.parse('2027-06-25T12:00:00Z'));
  // spring forward: Saturday 2027-03-13 evening → Sunday 08:00 EDT (the clocks moved at 2 AM)
  assert.equal(untilFor(Date.parse('2027-03-14T00:30:00Z'), false), Date.parse('2027-03-14T12:00:00Z'));
  // fall back: Saturday 2027-11-06 evening → Sunday 08:00 EST
  assert.equal(untilFor(Date.parse('2027-11-07T00:30:00Z'), false), Date.parse('2027-11-07T13:00:00Z'));
});

test('untilFor: a practice lasts two hours; nonsense is NaN', () => {
  assert.equal(untilFor(T0, true), T0 + 2 * 3600 * 1000);
  [0, -5, NaN, null, undefined, 'x', Infinity].forEach((bad) => assert.ok(Number.isNaN(untilFor(bad, false)), String(bad)));
});

// ── Normalisers ──────────────────────────────────────────────────────

test('normalizeRevealCtl accepts a well-formed ctl and keeps only known fields', () => {
  const c = normalizeRevealCtl(Object.assign(mkCtl(), { by: 'Patrick', startedBy: 'p@x', extra: { a: 1 } }));
  assert.ok(c);
  assert.deepEqual(Object.keys(c).sort(), ['at', 'ca', 'cur', 'finale', 'id', 'phase', 'sa', 'seq', 'shown', 'startedAt', 'teams', 'until', 'v'].sort());
  assert.equal(c.finale, false);
});

test('normalizeRevealCtl refuses anything that is not exactly this schema', () => {
  const bad = [
    null, 'x', [], {},
    mkCtl({ v: 2 }), mkCtl({ v: 0 }), mkCtl({ v: '1' }),
    mkCtl({ id: 'nope' }), mkCtl({ id: 'R1KZ9FXQ-4HD2' }),
    mkCtl({ phase: 'applause' }), mkCtl({ phase: undefined }),
    mkCtl({ cur: 2, shown: 2 }), mkCtl({ cur: 7 }), mkCtl({ cur: -2 }), mkCtl({ cur: 1.5 }),
    mkCtl({ shown: 9 }), mkCtl({ teams: 0 }), mkCtl({ teams: 7 }),
    mkCtl({ at: 'now' }), mkCtl({ sa: NaN }), mkCtl({ startedAt: 0 }), mkCtl({ until: T0 - 1 }),
    mkCtl({ seq: -1 }),
  ];
  bad.forEach((b, i) => assert.equal(normalizeRevealCtl(b), null, 'case ' + i + ' ' + JSON.stringify(b)));
});

test('normalizeRevealCtl clamps an until that sits implausibly far out', () => {
  const c = normalizeRevealCtl(mkCtl({ until: T0 + 400 * 24 * 3600 * 1000 }));
  assert.equal(c.until, T0 + 33 * 3600 * 1000);
});

test('normalizeRevealPub drops what is not exactly the shape and launders names', () => {
  const pub = {
    g0: { place: 3, e: { t2: ent('t2', 10, { nm: 'Pump\u0000kins\n  Patch', by: 'Patrick', k: 'gold' }) } },
    g1: { place: 9, e: { t1: ent('t1', 5) } },                       // place out of range
    g2: { place: 2, e: { t9: ent('t9', 5) } },                       // not a team id
    g3: { place: 2, e: { t3: Object.assign(ent('t3', 5), { p: 'lots' }) } }, // bad number
    g4: 'nope', g9: { place: 1, e: { t0: ent('t0', 1) } }, junk: { place: 1, e: {} },
    g5: { place: 1, e: { t5: ent('t5', 1, { nm: '   ' }) } },        // nothing left of the name
  };
  const g = normalizeRevealPub(pub);
  assert.equal(g.length, 1);
  assert.equal(g[0].idx, 0);
  assert.equal(g[0].entries[0].nm, 'Pump kins Patch');
  assert.equal(g[0].entries[0].k, 'gold');
  assert.deepEqual(Object.keys(g[0].entries[0]).sort(), ['b', 'c', 'g', 'id', 'k', 'm', 'nm', 'p', 's', 'v']);
  assert.deepEqual(normalizeRevealPub(null), []);
  assert.deepEqual(normalizeRevealPub([1, 2]), []);
});

test('a name is cut to 30 units without splitting an emoji, markup stays plain text', () => {
  const long = 'A'.repeat(29) + '🦊🦊';
  const g = normalizeRevealPub({ g0: { place: 1, e: { t0: ent('t0', 1, { nm: long }) } } });
  const nm = g[0].entries[0].nm;
  assert.ok(nm.length <= 30);
  assert.ok(!/[\ud800-\udbff]$/.test(nm), 'no half an emoji');
  const inert = normalizeRevealPub({ g0: { place: 1, e: { t0: ent('t0', 1, { nm: '<img src=x onerror=alert(1)>' }) } } });
  assert.equal(inert[0].entries[0].nm, '<img src=x onerror=alert(1)>', 'kept as text for the caller to esc()');
  const badKey = normalizeRevealPub({ g0: { place: 1, e: { t0: ent('t0', 1, { k: 'gold"onload="x' }) } } });
  assert.equal(badKey[0].entries[0].k, undefined, 'a colour key that is not a plain word is dropped');
});

// ── revealView: fail closed ──────────────────────────────────────────

test('revealView gives nothing for missing, denied, foreign, too-new or clockless input', () => {
  const now = T0 + 20000;
  assert.equal(revealView(null, null, now, 'viewer'), null);
  assert.equal(revealView(undefined, mkPub(2), now, 'viewer'), null);
  assert.equal(revealView(mkCtl(), mkPub(2), now, 'viewer', { denied: true }), null, 'listener refused');
  assert.equal(revealView(mkCtl({ v: 2 }), mkPub(2), now, 'viewer'), null, 'a newer schema is not guessed at');
  assert.equal(revealView(mkCtl({ epoch: 'w2027' }), mkPub(2), now, 'viewer', { epoch: 'w2028' }), null, 'another camp year');
  assert.equal(revealView(mkCtl({ epoch: 'w2027' }), mkPub(2), now, 'viewer', { epoch: '' }), null, 'a legacy week against a new-year reveal');
  assert.equal(revealView(mkCtl(), mkPub(2), null, 'viewer'), null, 'no usable clock');
  assert.equal(revealView(mkCtl(), mkPub(2), NaN, 'viewer'), null);
  assert.equal(revealView(mkCtl(), mkPub(2), () => undefined, 'viewer'), null);
  assert.ok(revealView(mkCtl({ epoch: 'w2027' }), mkPub(2), now, 'viewer', { epoch: 'w2027' }), 'same year reads');
  assert.ok(revealView(mkCtl({ epoch: 'w2027' }), mkPub(2), now, 'tv'), 'the TV cannot read the epoch, so it does not check it');
  assert.ok(revealView(mkCtl(), mkPub(2), now, 'viewer', { epoch: '' }), 'legacy week, legacy reveal');
});

test('revealView reads serverNow at call time, not when the view was built', () => {
  let clock = T0 + 20000;
  const ctl = mkCtl();
  assert.equal(revealView(ctl, mkPub(2), () => clock, 'viewer').expired, false);
  clock = ctl.until; // the instant it hides
  assert.equal(revealView(ctl, mkPub(2), () => clock, 'viewer').expired, true);
});

test('revealView: the grid is gone at 08:00 and an expired view carries no row', () => {
  const ctl = mkCtl({ phase: 'ended', cur: 1, shown: 2 });
  assert.equal(revealView(ctl, mkPub(2), ctl.until - 1, 'viewer').rows.length, 2, 'one ms before 8 AM it is still there');
  const v = revealView(ctl, mkPub(2), ctl.until, 'viewer');
  assert.equal(v.expired, true);
  assert.equal(v.live, false);
  assert.deepEqual(v.rows, []);
  assert.equal(v.remaining, 0);
  assert.equal(v.onScreen, null);
  assert.equal(v.champion, null, 'not a finale: nothing outlives the hide');
});

test('the champion line outlives the hide, by name only, and never carries a number', () => {
  const pub = {};
  const ctl = mkCtl({ finale: true, phase: 'table', cur: N - 1, shown: N, at: T0 + 60000, sa: T0 + 60000 });
  for (let i = 0; i < N; i++) {
    const tid = 't' + i;
    pub['g' + i] = { place: N - i, e: { [tid]: ent(tid, 100 + i, { nm: 'Team ' + tid, g: 3, s: 2, b: 1, v: 4, m: 5, c: 6 }) } };
  }
  const later = ctl.until + 1000;
  const v = revealView(ctl, pub, later, 'viewer');
  assert.equal(v.expired, true);
  assert.deepEqual(v.champion, [{ id: 't' + (N - 1), name: 'Team t' + (N - 1) }]);
  const json = JSON.stringify(v.champion);
  ['"p"', '"g"', '"s"', '"b"', '"v"', '"m"', '"c"', '100', '10'].forEach((frag) => assert.ok(!json.includes(frag), 'champion leaks ' + frag));
  // not a finale: no champion even with a first place shown
  assert.equal(revealView(Object.assign({}, ctl, { finale: false }), pub, later, 'viewer').champion, null);
  // a champion exists only once 1st place has been SHOWN
  assert.equal(revealView(mkCtl({ finale: true, shown: 2, cur: 1 }), mkPub(2), T0 + 20000, 'tv').champion, null);
});

// ── revealView: what a phone may see ─────────────────────────────────

test('revealView lists only published places, best first, ties as one row', () => {
  const pub = {
    g0: { place: 4, e: { t3: ent('t3', 5) } },
    g1: { place: 2, e: { t1: ent('t1', 20, { nm: 'B' }), t2: ent('t2', 20, { nm: 'A', g: 1 }) } },
  };
  const v = revealView(mkCtl({ cur: 1, shown: 2, teams: N }), pub, T0 + 60000, 'tv');
  assert.deepEqual(v.rows.map((r) => r.place), [2, 4]);
  assert.equal(v.rows[0].tie, true);
  assert.deepEqual(v.rows[0].entries.map((e) => e.nm), ['A', 'B']);
  assert.equal(v.rows[1].tie, false);
});

test('revealView ignores a group beyond ctl.shown (a place that was never published)', () => {
  const pub = mkPub(3); // g0, g1, g2 …
  const v = revealView(mkCtl({ shown: 2, cur: 1 }), pub, T0 + 60000, 'tv');
  assert.equal(v.rows.length, 2, 'g2 is not shown yet, so it is not drawn even though the node holds it');
  assert.ok(!JSON.stringify(v).includes('Team t' + (N - 3)), 'its name appears nowhere');
});

test('remaining counts teams, never groups, so a tie cannot be inferred', () => {
  const pub = { g0: { place: 5, e: { t4: ent('t4', 5), t5: ent('t5', 5) } } }; // a tie for 5th: one group, two teams
  const v = revealView(mkCtl({ cur: 0, shown: 1, teams: 6 }), pub, T0 + 60000, 'tv');
  assert.equal(v.rows.length, 1);
  assert.equal(v.remaining, 4);
});

test('a phone holds the newest place back for 3 s after it is shown, and only that one', () => {
  const ctl = mkCtl({ cur: 1, shown: 2, sa: T0 + 50000, at: T0 + 50000 });
  const pub = mkPub(2);
  const during = revealView(ctl, pub, ctl.sa + 1000, 'viewer');
  assert.equal(during.looking, true);
  assert.equal(during.rows.length, 1, 'the older place stays visible; only shown-1 is withheld');
  assert.equal(during.onScreen, null, 'no row is lit while it is held back');
  assert.equal(during.remaining, N - 1, 'the withheld place still counts as to come');
  const edge = revealView(ctl, pub, ctl.sa + 2999, 'viewer');
  assert.equal(edge.looking, true);
  const after = revealView(ctl, pub, ctl.sa + 3000, 'viewer');
  assert.equal(after.looking, false);
  assert.equal(after.rows.length, 2);
  assert.equal(after.onScreen, N - 1, 'the place the big screen is on');
  // the big screen and the remote never lag
  assert.equal(revealView(ctl, pub, ctl.sa + 1000, 'tv').rows.length, 2);
  assert.equal(revealView(ctl, pub, ctl.sa + 1000, 'remote').rows.length, 2);
  // a director's own phone is a phone: it lags like a counselor's
  assert.equal(revealView(ctl, pub, ctl.sa + 1000, 'editor').rows.length, 1);
});

test('the lag keys off sa: Back, the table, End and a reload never re-hide a place already shown', () => {
  const sa = T0 + 50000;
  const pub = mkPub(3);
  const later = sa + 20000; // well past the window for the newest place
  [
    mkCtl({ phase: 'live', cur: 1, shown: 3, sa, at: later - 1000 }),          // Back: cur drops, shown keeps
    mkCtl({ phase: 'table', cur: 2, shown: 3, sa, at: later - 1000 }),          // the final table
    mkCtl({ phase: 'ended', endKind: 'early', cur: 2, shown: 3, sa, at: later - 500, endedAt: later - 500 }), // End
  ].forEach((ctl, i) => {
    const v = revealView(ctl, pub, later, 'viewer');
    assert.equal(v.rows.length, 3, 'case ' + i);
    assert.equal(v.looking, false, 'case ' + i);
  });
  // a reload one second after Back, when sa is long past: nothing hides
  assert.equal(revealView(mkCtl({ cur: 0, shown: 3, sa, at: later }), pub, later + 1000, 'viewer').rows.length, 3);
});

test('revealView: a reveal nobody ended counts as ended after 15 min (champion, table) or 60 min (intro, live)', () => {
  const min = 60 * 1000;
  const at = T0 + 5 * min;
  const pub = mkPub(2);
  const cases = [
    ['live', 59, true], ['live', 61, false], ['intro', 59, true], ['intro', 61, false],
    ['table', 14, true], ['table', 16, false], ['champion', 14, true], ['champion', 16, false],
  ];
  cases.forEach(([phase, minutes, running]) => {
    const ctl = mkCtl({ phase, at, sa: at, cur: phase === 'intro' ? -1 : 1, shown: phase === 'intro' ? 0 : 2 });
    const v = revealView(ctl, phase === 'intro' ? {} : pub, at + minutes * min, 'viewer');
    assert.equal(v.phase, running ? phase : 'ended', phase + ' phase at +' + minutes + ' min');
    // `live` is what takes Now over on a phone: intro, live and champion only. The
    // final table is an ordinary section under the normal Now.
    assert.equal(v.live, running && phase !== 'table', phase + ' live at +' + minutes + ' min');
  });
  // the grid itself still follows `until`, not the auto-end
  const idle = revealView(mkCtl({ phase: 'live', at, sa: at }), pub, at + 90 * min, 'viewer');
  assert.equal(idle.live, false);
  assert.equal(idle.rows.length, 2, 'rows stay until 8 AM');
});

test('revealView reads no standings field outside rows (nothing else carries points)', () => {
  const v = revealView(mkCtl(), mkPub(2), T0 + 60000, 'viewer');
  const rest = Object.assign({}, v); delete rest.rows;
  assert.ok(!/"[pgsbvmc]":/.test(JSON.stringify(rest)), 'a points-shaped key outside rows: ' + JSON.stringify(rest));
});

// ── tvFrame ──────────────────────────────────────────────────────────

test('tvFrame is waiting for everything it should not show', () => {
  const now = T0 + 20000;
  const pub = mkPub(2);
  const waiting = (f, why) => { assert.equal(f.mode, 'waiting', why); assert.deepEqual(f.groups, [], why + ' (no groups)'); };
  waiting(tvFrame(null, null, now), 'no ctl');
  waiting(tvFrame(mkCtl({ v: 2 }), pub, now), 'too new');
  waiting(tvFrame(mkCtl(), pub, null), 'no server offset yet');
  waiting(tvFrame(mkCtl({ phase: 'ended' }), pub, now), 'ended');
  waiting(tvFrame(mkCtl(), pub, mkCtl().until), 'past until');
  waiting(tvFrame(mkCtl({ phase: 'live', at: T0 }), pub, T0 + 61 * 60 * 1000), 'auto-ended');
  waiting(tvFrame(mkCtl(), pub, now, { denied: true }), 'listener refused');
});

test('tvFrame: intro, then a place walks name, score, breakdown, then docks', () => {
  const at = T0 + 100000;
  const ctl = (o) => mkCtl(Object.assign({ phase: 'live', cur: 1, shown: 2, at, sa: at }, o || {}));
  const pub = mkPub(2);
  assert.equal(tvFrame(mkCtl({ phase: 'intro', cur: -1, shown: 0 }), {}, at).mode, 'intro');
  const f0 = tvFrame(ctl(), pub, at + 500);
  assert.deepEqual([f0.mode, f0.heroIdx, f0.beat, f0.docked, f0.fresh], ['hero', 1, 'name', 1, true]);
  assert.equal(tvFrame(ctl(), pub, at + 2999).beat, 'name');
  assert.equal(tvFrame(ctl(), pub, at + 3000).beat, 'score');
  assert.equal(tvFrame(ctl(), pub, at + 4499).beat, 'score');
  const f45 = tvFrame(ctl(), pub, at + 4500);
  assert.deepEqual([f45.beat, f45.fresh], ['breakdown', false]);
  assert.equal(tvFrame(ctl(), pub, at + 7999).mode, 'hero');
  const docked = tvFrame(ctl(), pub, at + 8000);
  assert.deepEqual([docked.mode, docked.heroIdx, docked.beat, docked.docked], ['board', -1, null, 2]);
  assert.equal(docked.groups.length, 2);
  assert.equal(tvFrame(ctl({ seq: 9 }), pub, at + 500).seq, 9, 'animations key off seq');
});

test('tvFrame: a late joiner gets the current frame with no confetti once the moment has passed', () => {
  const at = T0 + 100000;
  const f = tvFrame(mkCtl({ phase: 'live', cur: 1, shown: 2, at, sa: at }), mkPub(2), at + 6000);
  assert.equal(f.mode, 'hero');
  assert.equal(f.fresh, false);
  assert.equal(f.elapsed, 6000);
});

test('tvFrame: champion and the final table show every published place', () => {
  const at = T0 + 100000;
  const pub = mkPub(3);
  const champ = tvFrame(mkCtl({ phase: 'champion', finale: true, cur: 2, shown: 3, at, sa: at }), pub, at + 1000);
  assert.deepEqual([champ.mode, champ.docked, champ.fresh], ['champion', 3, true]);
  const table = tvFrame(mkCtl({ phase: 'table', cur: 2, shown: 3, at, sa: at }), pub, at + 1000);
  assert.deepEqual([table.mode, table.docked], ['table', 3]);
});

test('tvFrame never shows a group beyond shown and falls back to the board for a half-written command', () => {
  const at = T0 + 100000;
  // cur=1 but only g0 is published (a write landed in pieces): no hero, the board as it stands
  const f = tvFrame(mkCtl({ phase: 'live', cur: 1, shown: 2, at, sa: at }), mkPub(1), at + 500);
  assert.equal(f.mode, 'board');
  assert.equal(f.groups.length, 1);
  const hostile = tvFrame(mkCtl({ phase: 'live', cur: 0, shown: 1, at, sa: at }), mkPub(3), at + 500);
  assert.equal(hostile.groups.length, 1, 'g1 and g2 sit beyond shown');
});

// ── Purity ───────────────────────────────────────────────────────────

test('reveal-core is pure: declarations only, no DOM, storage, network or clock of its own', () => {
  const src = readFixture('../reveal-core.js');
  const code = src.replace(/\/\/.*$/gm, '');
  assert.notOk(/\b(document|window|localStorage|sessionStorage|firebase|fetch|XMLHttpRequest|navigator|location)\b/.test(code),
    'no DOM, storage or network access in code');
  assert.notOk(/\b(Date\.now|new Date\(\)|setTimeout|setInterval|Math\.random)\b/.test(code),
    'time comes in as an argument, never read here (an 8 AM hide must not depend on a cached clock)');
  assert.notOk(/^(?!\s*(\/\/|const |let |function |\}|\s))\S/m.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'only top-level declarations and comments');
});
