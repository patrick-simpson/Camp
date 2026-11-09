// The Games tab's engine — gamesModel() and what hangs off it (redesign §5; BUILD-PLAN Step 18, build session 1). Runs under both camp
// profiles (games-tab.senior.test.js evals this file) and, through tests/run.js, against a camp whose schedule is already edited here
// (the seeded pass). What these cases pin: the STATUS truth table of a game (a result, a bracket, a draft, a synced clock, and the
// things that look live but are not); the day picker's words (Done / Today / "2 left") across the camp week's phases; the blocks a
// day's games are listed under, the "up next" mark and the ONE gold Score; the order Next game walks a day in, skipping a round the
// director's own team plays; the places being reveal-core's groupPlaces over the app's own ranking (so a tie reads as it does on the
// remote and the big screen); that a counselor's model holds no point, no place and no leader; and the quick-points write.

var DOWS = [0, 1, 2, 3, 4, 5, 6];
var BASE_MS = Date.UTC(2026, 6, 22, 12, 0, 0); // Wednesday 22 July 2026, noon UTC
var WED = 3;
var T = () => state.teams.map((t) => t.id);
var realCampWeek = campWeek;

function boot(role, team) {
  freshState();
  setMemberRole(role === undefined ? 'editor' : role);
  setMemberTeam(team || null);
  state.followTeam = team || null;
  state.identity = undefined;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false;
  state.bonuses = {}; state.results = {}; state.drafts = {}; state.brackets = {}; state.clocks = {}; state.live = {}; state.brackets4 = {};
  state.meta.hiddenCards = {};
  state.announcements = {};
  setStandingsGuardThrows(false);
  counselorPreviewOn = false;
  campWeek = realCampWeek;
  try { localStorage.removeItem(DAY_RANK_KEY); } catch (e) { /* none */ }
}
function done() {
  setStandingsGuardThrows(false);
  counselorPreviewOn = false;
  campWeek = realCampWeek;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  setMemberTeam(null);
  setMemberRole(null);
  state.followTeam = undefined;
}
function at(dow, minutes, extra) {
  return gamesModel(Object.assign({ now: { dow, minutes }, ms: BASE_MS + minutes * 60000 }, extra || {}));
}
function medals(a, b, c) { return { medals: { gold: a, silver: b, bronze: c }, savedAt: new Date(BASE_MS).toISOString() }; }
function dayOf(dow) { return competitionDays().find((d) => d.dow === dow); }
function rowsOf(m) { return [].concat(...m.blocks.map((b) => b.rows)); }
// A game of our own on a day: placement by default. It carries no schedule link, so on a camp edited here it is "not on the schedule".
function addGame(dayId, id, format, extra) {
  const g = Object.assign({ id, dayId, session: 'Morning', format, name: id.toUpperCase(), location: 'Field', emoji: '🎯', headline: 'h', rules: [] }, extra || {});
  state.config.games.push(g);
  return g;
}
function pointsFor(team, n) {
  state.bonuses['b-' + team + '-' + n + '-' + Object.keys(state.bonuses).length] = { teamId: team, category: 'custom', label: 'Bonus', points: n, at: new Date(BASE_MS).toISOString() };
}
function nowCtxAt(dow, minutes) { return nowCtx({ now: { dow, minutes }, ms: BASE_MS + minutes * 60000 }); }

// ════════════════════════════════════════════════════════════════════
// The status of a game: a truth table
// ════════════════════════════════════════════════════════════════════
test('status: a result, a bracket, a draft, a running synced clock — and what only looks live — as a truth table', () => {
  boot('editor');
  const day = dayOf(WED).id;
  const tt = addGame(day, 'tt-t', 'tournament');
  const tl = addGame(day, 'tt-l', 'tally');
  const pl = addGame(day, 'tt-p', 'placement', { timer: { presets: [300] } });
  const ctx = nowCtxAt(WED, 630);
  const ms = ctx.ms;
  const status = (g) => gamesRow(ctx, g).status;
  const clear = () => { state.results = {}; state.brackets = {}; state.brackets4 = {}; state.drafts = {}; state.clocks = {}; state.live = {}; };
  const known = { phase: 'round1', matches: [] };
  const rows = [
    // [what, set up, expected for tt (bracket game), tl (tally), pl (podium)]
    ['nothing at all', () => {}, 'todo', 'todo', 'todo'],
    ['a result beats everything else', () => { state.results[tt.id] = medals(T()[0], T()[1], T()[2]); state.results[tl.id] = medals(T()[0], T()[1], T()[2]); state.results[pl.id] = medals(T()[0], T()[1], T()[2]); state.brackets[tt.id] = known; state.drafts[pl.id] = { medals: { gold: T()[0] } }; }, 'done', 'done', 'done'],
    ['a started six-team bracket', () => { state.brackets[tt.id] = known; }, 'live', 'todo', 'todo'],
    ['a bracket on a game that is no longer a bracket game (a format change left it behind)', () => { state.brackets[tl.id] = known; state.brackets[pl.id] = known; }, 'todo', 'todo', 'todo'],
    ['a bracket past its last round (the summary) is a finished bracket, not a live one', () => { state.brackets[tt.id] = { phase: 'summary', matches: [] }; }, 'todo', 'todo', 'todo'],
    ['a bracket this build cannot read is not guessed at', () => { state.brackets[tt.id] = { kind: 'newer', phase: 'xx' }; }, 'todo', 'todo', 'todo'],
    // a four-team record is a bracket only where the camp has four teams: under a six-team roster it is a stray (fourRead needs exactly four)
    ['a four-team bracket (Step 22\'s node)', () => { state.brackets4[tt.id] = { m: { s1: { a: T()[0], b: T()[1] }, s2: { a: T()[2], b: T()[3] } } }; }, T().length === 4 ? 'live' : 'todo', 'todo', 'todo'],
    ['a four-team bracket with only one semifinal is one this build cannot read (fourRead), so it is not guessed at either', () => { state.brackets4[tt.id] = { m: { s1: { a: T()[0], b: T()[1] } } }; }, 'todo', 'todo', 'todo'],
    ['a draft with a score', () => { state.drafts[tl.id] = { scores: { [T()[0]]: '9' } }; state.drafts[pl.id] = { scores: { [T()[1]]: '3' } }; }, 'todo', 'live', 'live'],
    ['a draft with only blank scores', () => { state.drafts[tl.id] = { scores: { [T()[0]]: '  ', [T()[1]]: '' } }; }, 'todo', 'todo', 'todo'],
    ['a draft with a medal picked', () => { state.drafts[pl.id] = { medals: { gold: T()[2] } }; }, 'todo', 'todo', 'live'],
    ['a draft with every medal blank', () => { state.drafts[pl.id] = { medals: { gold: '', silver: '', bronze: '' } }; }, 'todo', 'todo', 'todo'],
    ['a synced clock running with time left', () => { [tt, tl, pl].forEach((g) => { state.clocks[g.id] = { running: true, endAt: ms + 60000, remaining: 0, duration: 300000 }; }); }, 'live', 'live', 'live'],
    ['a synced clock that ran out (running, endAt in the past) is not live', () => { [tt, tl, pl].forEach((g) => { state.clocks[g.id] = { running: true, endAt: ms - 1000, remaining: 0, duration: 300000 }; }); }, 'todo', 'todo', 'todo'],
    ['a paused clock is not live', () => { [tt, tl, pl].forEach((g) => { state.clocks[g.id] = { running: false, endAt: 0, remaining: 120000, duration: 300000 }; }); }, 'todo', 'todo', 'todo'],
    ['a stray live-match tally with no bracket is not live by itself', () => { [tt, tl, pl].forEach((g) => { state.live[g.id] = { key: 'a|b', inning: 2, outs: 1, half: 0, hr: { a: 3 } }; }); }, 'todo', 'todo', 'todo'],
  ];
  rows.forEach(([what, set, a, b, c]) => {
    clear();
    set();
    assert.deepEqual([status(tt), status(tl), status(pl)], [a, b, c], what);
  });
  // the live line is said per format: a round, "N of M teams in", "Clock running", "Being scored"
  clear();
  state.brackets[tt.id] = known;
  assert.equal(gamesRow(ctx, tt).line, 'Round 1');
  tl.liveRankings = true;
  state.drafts[tl.id] = { scores: { [T()[0]]: '4', [T()[1]]: '9' } };
  assert.equal(gamesRow(ctx, tl).line, '2 of ' + T().length + ' teams in');
  state.drafts = {}; state.clocks[pl.id] = { running: true, endAt: ms + 60000, remaining: 0, duration: 300000 };
  assert.equal(gamesRow(ctx, pl).line, 'Clock running');
  state.clocks = {}; state.drafts[pl.id] = { medals: { gold: T()[0] } };
  assert.equal(gamesRow(ctx, pl).line, 'Being scored', 'and a podium draft never says which team is picked');
  assert.ok(!JSON.stringify(gamesRow(nowCtx({ now: { dow: WED, minutes: 630 } }), pl)).includes(T()[0]), 'nor holds it');
  done();
});

// ════════════════════════════════════════════════════════════════════
// The day picker
// ════════════════════════════════════════════════════════════════════
test('day picker: Done / Today / "N left" across the camp week, and the note when another day is chosen', () => {
  boot('editor');
  const days = competitionDays();
  assert.ok(days.length >= 5);
  const wed = dayOf(WED);
  const mon = dayOf(1);
  const stOf = (m, id) => m.days.find((d) => d.id === id);
  // no dates anywhere: the weekday decides (the printed week runs)
  let m = at(WED, 630);
  assert.deepEqual(m.days.map((d) => d.id), days.map((d) => d.id), 'one segment per competition day, in order');
  assert.equal(stOf(m, wed.id).st, 'today');
  assert.equal(stOf(m, wed.id).label, wed.name + ', today');
  assert.equal(stOf(m, mon.id).st, 'left', 'Monday is behind us with games unscored');
  assert.equal(stOf(m, mon.id).left, gamesForDayId(mon.id).length);
  assert.equal(stOf(m, dayOf(4).id).st, '', 'a day still to come says nothing');
  assert.equal(stOf(m, mon.id).label, mon.name + ', ' + gamesForDayId(mon.id).length + (gamesForDayId(mon.id).length === 1 ? ' game left' : ' games left'));
  // finishing every game of Monday: Done (and "Done" also beats "Today" on a day that is finished)
  gamesForDayId(mon.id).forEach((g) => { state.results[g.id] = medals(T()[0], T()[1], T()[2]); });
  m = at(WED, 630);
  assert.equal(stOf(m, mon.id).st, 'done');
  assert.equal(stOf(m, mon.id).label, mon.name + ', every game done');
  gamesForDayId(wed.id).forEach((g) => { state.results[g.id] = medals(T()[0], T()[1], T()[2]); });
  assert.equal(stOf(at(WED, 630), wed.id).st, 'done');
  state.results = {};
  // a day with no games has no status at all
  const bare = Object.assign({}, dayOf(2), { id: 'd-bare', name: 'Bare', dow: 2 });
  state.config.days.push(bare);
  assert.equal(stOf(at(WED, 630), 'd-bare').st, '');
  state.config.days.pop();
  // Sunday has nothing behind it; Saturday has the whole week
  assert.ok(at(0, 600).days.every((d) => d.st !== 'left'), 'Sunday: nothing is overdue yet');
  assert.ok(at(6, 600).days.filter((d) => d.total).every((d) => d.st === 'left'), 'Saturday: every unscored day is behind us');
  // with the camp week's dates: before and after it nothing is "today"
  campWeek = () => ({ start: '2026-07-19', phase: 'during' });
  m = at(WED, 630, { date: '2026-07-22' });
  assert.equal(stOf(m, wed.id).st, 'today');
  m = at(WED, 630, { date: '2026-07-10' });
  assert.ok(m.days.every((d) => d.st !== 'today' && d.st !== 'left'), 'before camp: nothing is today or overdue');
  assert.equal(m.dayNote, '', 'and no "not today" note, since no day is today');
  m = at(WED, 630, { date: '2026-08-05' });
  assert.ok(m.days.every((d) => d.st !== 'today'), 'after camp: nothing is today');
  assert.ok(m.days.filter((d) => d.total).every((d) => d.st === 'left'), 'and every unscored day is behind us');
  campWeek = realCampWeek;
  // the chosen day is the device's own (state.ui.day), opening on today; another day carries the note
  state.ui.day = wed.id;
  m = at(WED, 630);
  assert.equal(m.day.id, wed.id);
  assert.equal(m.day.today, true);
  assert.equal(m.dayNote, '');
  state.ui.day = dayOf(4).id;
  m = at(WED, 630);
  assert.equal(m.day.id, dayOf(4).id);
  assert.equal(m.dayNote, dayOf(4).name + ' · not today');
  assert.equal(m.days.filter((d) => d.selected).length, 1);
  state.ui.day = 'a-day-that-is-gone';
  assert.equal(at(WED, 630).day.id, wed.id, 'a stale choice falls back to today');
  assert.equal(at(0, 600).day.id, days[0].id, 'and, with no day today, to the first');
  done();
});

// ════════════════════════════════════════════════════════════════════
// The blocks a day lists its games under
// ════════════════════════════════════════════════════════════════════
test('blocks: the schedule\'s own blocks by time with the run-sheet clock, the games on no block last, never a game twice', () => {
  boot('editor');
  DOWS.filter((d) => dayOf(d)).forEach((dow) => {
    state.ui.day = dayOf(dow).id;
    const m = at(dow, 630);
    const ids = [];
    rowsOf(m).forEach((r) => ids.push(r.id));
    assert.equal(new Set(ids).size, ids.length, 'day ' + dow + ': no game is listed twice');
    assert.equal(ids.length, gamesForDayId(dayOf(dow).id).length, 'day ' + dow + ': every game of the day is listed');
    const timed = m.blocks.filter((b) => b.when);
    assert.ok(timed.every((b) => /^\d{1,2}:\d{2}–\d{1,2}:\d{2}( PM)?$/.test(b.when)), 'the bare clock: ' + timed.map((b) => b.when));
    const idx = m.blocks.findIndex((b) => b.off);
    if (idx >= 0) assert.equal(idx, m.blocks.length - 1, '"Not on the schedule" comes last');
    m.blocks.forEach((b) => assert.ok(b.title && b.key, 'a block has a title and a key'));
  });
  state.ui.day = dayOf(WED).id;
  const m = at(WED, 630);
  const first = m.blocks[0];
  assert.ok(/^\d{1,2}:\d{2}–\d{1,2}:\d{2}$/.test(first.when) || first.off || !first.when);
  assert.equal(gamesWhen(600, 705), '10:00–11:45');
  assert.equal(gamesWhen(1080, 1125), '6:00–6:45 PM');
  assert.equal(gamesWhen(585, 740), '9:45–12:20');
  assert.equal(gamesWhen(null, 740), '');
  done();
});

test('blocks: a day no schedule item holds falls back to the session names; games left over are "Not on the schedule"', () => {
  boot('editor');
  const day = Object.assign({}, dayOf(WED), { id: 'd-odd', name: 'Oddday', dow: 6 }); // Saturday has no games block
  state.config.days.push(day);
  addGame('d-odd', 'odd-a', 'placement', { session: 'Morning' });
  addGame('d-odd', 'odd-b', 'placement', { session: 'Evening' });
  addGame('d-odd', 'odd-c', 'placement', { session: 'Evening' });
  state.ui.day = 'd-odd';
  const m = at(6, 630);
  assert.deepEqual(m.blocks.map((b) => [b.title, b.rows.length, b.off]), [['Morning', 1, false], ['Evening', 2, false]]);
  assert.ok(m.blocks.every((b) => b.when === ''), 'a session has no clock');
  // a game with no day at all (dow missing) is still listed, never lost
  state.config.days[state.config.days.length - 1].dow = undefined;
  assert.equal(rowsOf(at(WED, 630)).length, 3);
  state.config.days.pop();
  // On the real Wednesday a game on no block sits under "Not on the schedule", after the blocks
  const stray = addGame(dayOf(WED).id, 'stray', 'placement', { session: 'Afternoon' });
  state.ui.day = dayOf(WED).id;
  const w = at(WED, 630);
  const last = w.blocks[w.blocks.length - 1];
  if (scheduleIsShared()) {
    assert.equal(last.off, true, 'the games on no block are the last group');
    assert.equal(last.title, 'Not on the schedule');
    assert.ok(last.rows.some((r) => r.id === stray.id), 'the stray game is listed there');
  } else {
    // The printed week links no game to a block, so "Not on the schedule" would be untrue: the leftovers keep their session's name.
    assert.ok(w.blocks.every((b) => !b.off), 'no "Not on the schedule" group while the schedule is not edited here');
    assert.equal(last.title, 'Afternoon');
    assert.ok(last.rows.some((r) => r.id === stray.id), 'the stray game is under its session');
  }
  done();
});

test('blocks: with the printed week, a day\'s Afternoon games sit under "Afternoon" after the blocks, never under "Not on the schedule" (the owner\'s Use the original week again)', () => {
  boot('editor');
  if (scheduleIsShared()) { done(); return; } // the edited schedule links every game to a block: pinned by the case above
  DOWS.filter((d) => dayOf(d)).forEach((dow) => {
    state.ui.day = dayOf(dow).id;
    const m = at(dow, 630);
    assert.ok(m.blocks.every((b) => !b.off), 'day ' + dow + ': no group says the games are off the schedule');
    const ids = rowsOf(m).map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, 'day ' + dow + ': no game twice');
    assert.equal(ids.length, gamesForDayId(dayOf(dow).id).length, 'day ' + dow + ': every game listed');
  });
  done();
});

test('blocks: a day with no games names it, a director gets Add games and a quick game, a counselor neither', () => {
  boot('editor');
  const bare = Object.assign({}, dayOf(2), { id: 'd-bare', name: 'Bareday', dow: 2 });
  state.config.days.push(bare);
  state.ui.day = 'd-bare';
  let m = at(WED, 630);
  assert.deepEqual(m.empty, { text: 'No games on Bareday yet.', add: true });
  assert.equal(m.quick, null, 'nothing to add a one-off to yet');
  assert.deepEqual(m.blocks, []);
  state.ui.day = dayOf(WED).id;
  m = at(WED, 630);
  assert.equal(m.empty, null);
  assert.deepEqual(m.quick, { sub: 'Add a one-off game to ' + dayOf(WED).name });
  setMemberRole('viewer');
  assert.equal(at(WED, 630).quick, null, 'a counselor gets no quick game');
  state.ui.day = 'd-bare';
  assert.deepEqual(at(WED, 630).empty, { text: 'No games on Bareday yet.', add: false });
  state.config.days.pop();
  state.config.days = [];
  state.ui.day = null;
  m = at(WED, 630);
  assert.equal(m.day, null);
  assert.deepEqual(m.days, []);
  assert.equal(m.empty.add, false);
  done();
});

test('rows: "up next" is today\'s first game not yet started from the block under way on; ONE gold Score, the live game\'s first', () => {
  boot('editor');
  state.ui.day = dayOf(WED).id;
  const flat = (m) => rowsOf(m);
  const m0 = at(WED, 610); // inside the morning block
  const rows = flat(m0);
  assert.ok(rows.length >= 2);
  assert.equal(rows.filter((r) => r.next).length, 1, 'exactly one up next');
  assert.equal(rows.find((r) => r.next).id, rows[0].id, 'the first game of the block under way');
  assert.deepEqual(rows.filter((r) => r.score && r.score.gold).map((r) => r.id), [rows[0].id], 'one gold Score: the one up next');
  assert.ok(rows.every((r) => r.score && r.score.why === null), 'a director can score every row');
  assert.ok(m0.blocks[0].now, 'the block under way is marked');
  assert.ok(m0.blocks.slice(1).every((b) => !b.now));
  // a live game takes the gold from the one up next
  const live = rows[1];
  state.drafts[live.id] = { scores: { [T()[0]]: '5' }, medals: { gold: T()[0] } };
  const m1 = at(WED, 610);
  const r1 = flat(m1);
  assert.equal(r1.find((r) => r.id === live.id).status, 'live');
  assert.deepEqual(r1.filter((r) => r.score && r.score.gold).map((r) => r.id), [live.id], 'the live game has the one gold');
  assert.equal(r1.filter((r) => r.next).length, 1);
  // a game finished is never "up next"; the mark moves to the next one still to start
  state.results[rows[0].id] = medals(T()[0], T()[1], T()[2]);
  const r2 = flat(at(WED, 610));
  assert.equal(r2.find((r) => r.id === rows[0].id).status, 'done');
  assert.equal(r2.find((r) => r.id === rows[0].id).score, null, 'a done row has no Score (the row itself opens it to fix)');
  assert.ok(r2.find((r) => r.next).status === 'todo');
  // after the block ended, up next is in a later block; before the day it is the first game; another day has no marks at all
  state.results = {}; state.drafts = {};
  const later = at(WED, 1090);
  assert.ok(later.blocks.length >= 1);
  const lr = flat(later);
  assert.ok(lr.filter((r) => r.next).every((r) => r.status === 'todo'));
  state.ui.day = dayOf(4).id;
  const other = at(WED, 610);
  assert.ok(flat(other).every((r) => !r.next), 'another day: nothing is up next');
  assert.ok(flat(other).every((r) => !r.score || !r.score.gold), 'and no gold');
  assert.ok(other.blocks.every((b) => !b.now), 'nor a block under way');
  // a counselor's rows: the same games, no Score, nothing about whom a director is scoring
  state.ui.day = dayOf(WED).id;
  setMemberRole('viewer');
  const cr = flat(at(WED, 610));
  assert.ok(cr.every((r) => r.score === null), 'no Score for a counselor');
  assert.equal(cr.filter((r) => r.next).length, 1, 'but the same up next');
  done();
});

// ════════════════════════════════════════════════════════════════════
// Next game
// ════════════════════════════════════════════════════════════════════
// A day of our own, with bracket games whose first matchups we choose, so the own-team guard has something to skip.
function nextDay() {
  const day = Object.assign({}, dayOf(WED), { id: 'd-next', name: 'Nextday', dow: 6, note: '' });
  state.config.days.push(day);
  const ids = T();
  const a = addGame('d-next', 'nx-a', 'placement', { session: 'Morning' });
  const b = addGame('d-next', 'nx-b', 'tournament', { session: 'Morning', roundOneMatchups: [[ids[0], ids[1]], [ids[2], ids[3]]] });
  const c = addGame('d-next', 'nx-c', 'tally', { session: 'Morning' });
  const d = addGame('d-next', 'nx-d', 'tournament', { session: 'Evening', roundOneMatchups: [[ids[0], ids[2]]] });
  const e = addGame('d-next', 'nx-e', 'placement', { session: 'Evening' });
  state.ui.day = 'd-next';
  return { a, b, c, d, e };
}
test('Next game: the rest of the block, then the later blocks, wrapping round; a round with my own team in it is skipped and named', () => {
  boot('editor');
  const { a, b, c, d, e } = nextDay();
  const nx = (g) => gamesNextAfter(g.id, { now: { dow: WED, minutes: 630 }, ms: BASE_MS });
  // The walk order: Morning (a, b, c) then Evening (d, e) — each game's next is the one after it
  assert.equal(nx(a).game.id, b.id);
  assert.equal(nx(b).game.id, c.id);
  assert.equal(nx(c).game.id, d.id);
  assert.equal(nx(d).game.id, e.id);
  assert.equal(nx(e).game.id, a.id, 'the last wraps round to the first still unscored');
  assert.equal(nx(a).left, 4, 'every other game is still to score');
  // finishing games takes them out of the walk
  state.results[b.id] = medals(T()[0], T()[1], T()[2]);
  assert.equal(nx(a).game.id, c.id, 'a done game is passed over');
  assert.equal(nx(a).left, 3);
  state.results[a.id] = medals(T()[0], T()[1], T()[2]);
  state.results[c.id] = medals(T()[0], T()[1], T()[2]);
  assert.equal(nx(a).game.id, d.id);
  // a director on a team: the games whose next round has that team in it are skipped, and named as waiting
  state.results = {};
  setMemberTeam(T()[0]); // plays nx-b's first matchup and nx-d's
  let n = nx(a);
  assert.equal(n.game.id, c.id, 'b (my team plays round 1) is skipped');
  assert.deepEqual(n.waiting.map((w) => w.id), [b.id, d.id]);
  assert.equal(n.left, 2, 'c and e are what I can score');
  assert.equal(gameBlockedForMe(b), true);
  assert.equal(gameBlockedForMe(a), false, 'a podium game is not guarded');
  assert.equal(gameBlockedForMe(c), false, 'nor a tally');
  setMemberTeam(T()[4] || T()[3]);
  assert.equal(nx(a).game.id, b.id, 'a team that plays neither is not held back');
  // once c and e are scored, only the guarded games remain: nothing left that I can score
  setMemberTeam(T()[0]);
  state.results[a.id] = medals(T()[1], T()[2], T()[3]);
  state.results[c.id] = medals(T()[1], T()[2], T()[3]);
  state.results[e.id] = medals(T()[1], T()[2], T()[3]);
  n = nx(a);
  assert.equal(n.game, null);
  assert.equal(n.left, 0);
  assert.deepEqual(n.waiting.map((w) => w.name), [b.name, d.name]);
  assert.equal(n.allDone, false);
  // a bracket under way: its CURRENT matchup decides, not the first one
  state.brackets[b.id] = { phase: 'round1', matches: [{ winner: T()[0], loser: T()[1] }] };
  assert.deepEqual(gameRoundTeams(b), [T()[2], T()[3]], 'the second fixed matchup is the current round');
  assert.equal(gameBlockedForMe(b), false, 'so my team (Foxes) is not in it now');
  // every game scored: the day is done
  Object.keys(state.brackets).forEach((k) => delete state.brackets[k]);
  [a, b, c, d, e].forEach((g) => { state.results[g.id] = medals(T()[1], T()[2], T()[3]); });
  n = nx(a);
  assert.equal(n.game, null);
  assert.equal(n.allDone, true);
  setMemberTeam(null);
  done();
});

test('Next game: the dock says what is left, what needs another director, and when the day is done — and Next opens it in place', () => {
  boot('editor');
  const { a, b, c, d, e } = nextDay();
  const opts = { now: { dow: WED, minutes: 630 }, ms: BASE_MS };
  // CHANGED ON PURPOSE (build session 2): a podium game with no result now has the dock's Save; a bracket has none until its Results step; a tally docks its Save too (Step 29 finish)
  assert.equal(gamesDock(a.id, opts).tone, 'pick', 'a podium game with no result docks its Save');
  assert.equal(gamesDock(b.id, opts), null, 'a bracket has no dock until it has a result');
  assert.equal(gamesDock(c.id, opts).tone, 'tally', 'a tally docks its Save (CHANGED ON PURPOSE, Step 29 finish: it was a body button)');
  state.results[a.id] = medals(T()[1], T()[2], T()[3]);
  state.ui.gameId = a.id; state.ui.gameFrom = 'games';
  let dock = gamesDock(a.id, opts);
  assert.equal(dock.tone, 'next');
  assert.equal(dock.left, '4 games left on Nextday that you can score', 'a day that is not today names the day');
  assert.deepEqual(dock.next, { id: b.id, name: b.name });
  assert.equal(dock.back, 'Back to Nextday games');
  // today's day says "today"
  const wedGames = gamesForDayId(dayOf(WED).id);
  state.results[wedGames[0].id] = medals(T()[1], T()[2], T()[3]);
  state.ui.gameFrom = 'now';
  dock = gamesDock(wedGames[0].id, opts);
  assert.ok(/ today that you can score$/.test(dock.left) || dock.tone !== 'next', dock.left);
  assert.equal(dock.back, 'Back to Now');
  // my team plays the rest: "Nothing left that you can score. 1 game needs another director: …"
  setMemberTeam(T()[0]);
  [c, e].forEach((g) => { state.results[g.id] = medals(T()[1], T()[2], T()[3]); });
  state.results[d.id] = medals(T()[1], T()[2], T()[3]);
  dock = gamesDock(a.id, opts);
  assert.equal(dock.tone, 'wait');
  assert.equal(dock.left, 'Nothing left that you can score. 1 game needs another director: ' + b.name + ' (your team plays)');
  assert.equal(dock.next, null);
  delete state.results[d.id];
  dock = gamesDock(a.id, opts);
  assert.equal(dock.left, 'Nothing left that you can score. 2 games need another director: ' + b.name + ' and ' + d.name + ' (your team plays)');
  setMemberTeam(null);
  [a, b, c, d, e].forEach((g) => { state.results[g.id] = medals(T()[1], T()[2], T()[3]); });
  dock = gamesDock(a.id, opts);
  assert.deepEqual([dock.tone, dock.left, dock.next], ['done', 'Every game on Nextday is scored', null]);
  // the dock is a director's: a counselor gets nothing
  setMemberRole('viewer');
  assert.equal(gamesDock(a.id, opts), null);
  setMemberRole('editor');
  // Next opens the next game with the SAME labelled back (the shell replaces the history entry: tabs.test.js pins the plan)
  delete state.results[b.id];
  state.ui.gameId = a.id; state.ui.gameFrom = 'games';
  const opened = [];
  const realOpen = openGame;
  openGame = (id, o) => { opened.push([id, o]); return true; };
  assert.equal(openNextGame(), true);
  openGame = realOpen;
  assert.deepEqual(opened, [[b.id, { from: 'games' }]]);
  // nothing left to open: it asks for no game (a stale tap)
  state.results[b.id] = medals(T()[1], T()[2], T()[3]);
  openGame = (id) => { opened.push(['x', id]); return true; };
  assert.equal(openNextGame(), false);
  openGame = realOpen;
  assert.equal(opened.length, 1);
  state.ui.gameId = null;
  done();
});

// ════════════════════════════════════════════════════════════════════
// The directors' standings
// ════════════════════════════════════════════════════════════════════
function standings(extra) { return at(WED, 630, extra).standings; }
test('standings: places are reveal-core\'s groupPlaces over the app\'s own ranking — the grouping the remote and the big screen use', () => {
  boot('editor');
  const t = T();
  // a table with a tie in the middle and a three-way tie at the foot
  const layouts = [
    () => { state.results = {}; pointsFor(t[0], 30); pointsFor(t[1], 27); pointsFor(t[2], 27); pointsFor(t[3], 10); },
    () => { pointsFor(t[3], 5); pointsFor(t[4] || t[0], 5); },
    () => { state.results = { x1: medals(t[1], t[0], t[2]) }; state.config.games.push({ id: 'x1', dayId: dayOf(WED).id, session: 'Morning', format: 'placement', name: 'X1', emoji: 'x', location: '', headline: '', rules: [] }); },
    () => { state.bonuses = {}; t.forEach((id) => pointsFor(id, 7)); }, // everyone level at the top
  ];
  layouts.forEach((set, i) => {
    set();
    const st = standings();
    const tv = groupPlaces(revealFreezeRows());
    const expected = [];
    tv.forEach((gr) => gr.entries.forEach((e) => expected.push([e.id, gr.place, gr.entries.length > 1])));
    assert.deepEqual(st.rows.map((r) => [r.team, r.place, r.tie]), expected, 'layout ' + i + ': the same places, the same order inside a tie');
    // equal points share a place and a tie says so; the next place skips (1, 2, 2, 4)
    const places = st.rows.map((r) => r.place);
    st.rows.forEach((r, k) => { if (k && r.pts === st.rows[k - 1].pts) assert.equal(r.place, st.rows[k - 1].place); });
    assert.deepEqual(places, places.slice().sort((x, y) => x - y), 'best place first');
  });
  // the tie order is golds, then silvers, then bronzes, then name
  boot('editor');
  state.results = {};
  state.config.games.push({ id: 'x2', dayId: dayOf(WED).id, session: 'Morning', format: 'placement', name: 'X2', emoji: 'x', location: '', headline: '', rules: [] });
  state.results.x2 = medals(t[1], t[2], t[3]); // t1 gold (7), t2 silver (5), t3 bronze (3)
  pointsFor(t[2], 2); // t2: 7 as well, from a bonus: ties t1 on points but with no gold
  const st = standings();
  const top = st.rows.filter((r) => r.pts === 7).map((r) => r.team);
  assert.deepEqual(top, [t[1], t[2]], 'level on points: the gold ahead of the bonus');
  assert.equal(st.rows[0].place, 1);
  assert.equal(st.rows[1].place, 1);
  assert.ok(st.rows[0].tie && st.rows[1].tie);
  done();
});

test('standings: a complete tie is ordered by the same cleaned name the reveal\'s freeze uses, so a director\'s phone and the big screen agree', () => {
  boot('editor');
  const t = T();
  // Leading spaces (and a name over 30 characters) are cut by the freeze's name; compared raw they would sort a different way.
  state.teams[0].name = '  Zed';
  state.teams[1].name = 'Yak';
  state.teams[2].name = 'M'.repeat(30) + 'Z';
  state.teams[3].name = 'M'.repeat(30) + 'A';
  t.forEach((id) => pointsFor(id, 7)); // every team level on points and medals: only the name decides
  const st = standings();
  const tv = [].concat(...groupPlaces(revealFreezeRows()).map((gr) => gr.entries.map((e) => e.id)));
  assert.deepEqual(st.rows.map((r) => r.team), tv, 'the same order on the Games tab as in the freeze');
  assert.ok(st.rows.findIndex((r) => r.team === t[1]) < st.rows.findIndex((r) => r.team === t[0]), 'Yak before Zed once the spaces are cleaned');
  assert.equal(standingsTieName({ id: t[0], name: '  Zed' }), 'Zed');
  assert.equal(standingsTieName({ id: t[2], name: '' }), 'Team 3', 'no usable name: Team N by position, as the freeze says it');
  done();
});

test('standings: the day baseline is not taken from a cache — with sync attached it waits for the first server snapshot, then holds all day', () => {
  boot('editor');
  const t = T();
  const realRef = fbRef, realReady = remoteReady, realFailed = sdkLoadFailed, realCfg = window.FIREBASE_CONFIG;
  try {
    pointsFor(t[0], 30); pointsFor(t[1], 20); pointsFor(t[2], 10);
    fbRef = {}; remoteReady = false; // sync is attached and the server has said nothing yet: this week is only the cache
    let st = standings();
    assert.equal(st.arrows, false, 'no arrows from a baseline nobody could trust');
    assert.equal(localStorage.getItem(DAY_RANK_KEY), null, 'and nothing stored to carry the cache\'s places all day');
    remoteReady = true; // the first snapshot landed
    standings(); // the render it triggers takes the baseline: t0 1st, t1 2nd, t2 3rd
    assert.ok(localStorage.getItem(DAY_RANK_KEY), 'taken once the server has spoken');
    pointsFor(t[2], 25);
    st = standings();
    assert.equal(st.arrows, true);
    assert.equal(st.rows.find((r) => r.team === t[2]).mv, 2, 'a real move against the real morning');
    // a baseline already stored for today is the day's, snapshot or not (a reload after a connection drop)
    remoteReady = false;
    assert.equal(standings().arrows, true, 'a stored baseline for today is returned at once');
    // No sync attached: the local copy is the week and the baseline is taken at once
    boot('editor');
    fbRef = null; remoteReady = false; window.FIREBASE_CONFIG = undefined;
    pointsFor(t[0], 30);
    standings();
    assert.ok(localStorage.getItem(DAY_RANK_KEY), 'local-only: the baseline is taken now');
    // Sync configured but the SDK never loaded: the same, the cache is all there will be
    boot('editor');
    window.FIREBASE_CONFIG = { apiKey: 'x' }; sdkLoadFailed = false;
    pointsFor(t[0], 30);
    standings();
    assert.equal(localStorage.getItem(DAY_RANK_KEY), null, 'sync expected but not attached yet: wait for it');
    sdkLoadFailed = true;
    standings();
    assert.ok(localStorage.getItem(DAY_RANK_KEY), 'the SDK failed: take it from what the phone has');
  } finally { fbRef = realRef; remoteReady = realReady; sdkLoadFailed = realFailed; window.FIREBASE_CONFIG = realCfg; }
  done();
});

test('standings: an empty table has no places and no arrows, a baseline taken on an empty table keeps the arrows off, a real one moves them', () => {
  boot('editor');
  const t = T();
  let st = standings();
  assert.equal(st.empty, true);
  assert.equal(st.arrows, false);
  assert.deepEqual(st.rows.map((r) => r.team), t, 'roster order, not name order');
  assert.ok(st.rows.every((r) => r.place === 0 && !r.tie && r.mv === 0));
  assert.equal(st.gap, null);
  assert.equal(st.sentence, null);
  // points arrive after a baseline taken while nobody had any: no arrows that day
  pointsFor(t[2], 10); pointsFor(t[1], 4);
  st = standings();
  assert.equal(st.empty, false);
  assert.equal(st.arrows, false, 'moved since a blank table says nothing');
  assert.ok(st.rows.every((r) => r.mv === 0));
  // a baseline taken with points: a place gained is an up arrow, a place lost a down arrow, by SHARED places
  boot('editor');
  pointsFor(t[0], 30); pointsFor(t[1], 20); pointsFor(t[2], 10);
  standings(); // takes the baseline: t0 1st, t1 2nd, t2 3rd, the rest level at 4th
  pointsFor(t[2], 25); // t2 is now 35: first; t0 second; t1 third
  st = standings();
  assert.equal(st.arrows, true);
  const mv = (id) => st.rows.find((r) => r.team === id).mv;
  assert.equal(mv(t[2]), 2, 'up two');
  assert.equal(mv(t[0]), -1, 'down one');
  assert.equal(mv(t[1]), -1);
  assert.equal(mv(t[3]), 0, 'a team that did not move has none');
  // a tie that formed is not a move for the team that did not change places
  boot('editor');
  pointsFor(t[0], 30); pointsFor(t[1], 20); pointsFor(t[2], 20);
  standings();
  pointsFor(t[3], 40); // t3 jumps in front; t1 and t2 stay level at 3rd (place 3)
  st = standings();
  assert.equal(st.rows.find((r) => r.team === t[1]).place, 3);
  assert.equal(st.rows.find((r) => r.team === t[1]).mv, -1, 'it was tied for 2nd, now tied for 3rd');
  assert.equal(st.rows.find((r) => r.team === t[3]).mv, 3, 'last place to first: up three');
  // an older stored baseline (positions only) is taken afresh rather than misread
  boot('editor');
  localStorage.setItem(DAY_RANK_KEY, JSON.stringify({ date: campDateStr(), ranks: { [t[0]]: 3 } }));
  pointsFor(t[0], 5);
  st = standings();
  assert.ok(st.rows.every((r) => r.mv === 0), 'no places in it, so a fresh baseline: nothing has moved');
  // a corrupt one too
  localStorage.setItem(DAY_RANK_KEY, '{nope');
  assert.doesNotThrow(() => standings());
  done();
});

test('standings: medals in numbers for the renderer, +N awarded only when Award points move the total, a director\'s own team is locked', () => {
  boot('editor');
  const t = T();
  state.config.games.push({ id: 'x3', dayId: dayOf(WED).id, session: 'Morning', format: 'placement', name: 'X3', emoji: 'x', location: '', headline: '', rules: [] });
  state.results.x3 = medals(t[0], t[1], t[2]);
  state.bonuses = {
    v1: { teamId: t[0], category: 'verse', points: 4, day: 3, at: new Date(BASE_MS).toISOString() },
    c1: { teamId: t[1], category: 'cleanup', points: 2, day: 3, meal: 'Lunch', at: new Date(BASE_MS).toISOString() },
    q1: { teamId: t[1], category: 'custom', label: 'Bonus', points: -3, at: new Date(BASE_MS).toISOString() },
  };
  let st = standings();
  const r0 = st.rows.find((r) => r.team === t[0]);
  const r1 = st.rows.find((r) => r.team === t[1]);
  const r3 = st.rows.find((r) => r.team === t[3]);
  assert.deepEqual([r0.gold, r0.silver, r0.bronze, r0.awarded, r0.pts], [1, 0, 0, 4, MEDAL_POINTS.gold + 4]);
  assert.deepEqual([r1.gold, r1.silver, r1.bronze, r1.awarded, r1.pts], [0, 1, 0, -1, MEDAL_POINTS.silver - 1], 'cleanup 2 and a deduction of 3 = -1 awarded');
  assert.equal(r3.awarded, 0, 'nothing awarded: no "+N awarded" to say');
  assert.ok(st.rows.every((r) => r.tap === true && r.locked === false), 'a director with no team can give any team points');
  setMemberTeam(t[1]);
  st = standings();
  assert.deepEqual(st.rows.filter((r) => r.locked).map((r) => r.team), [t[1]], 'a director on a team: that row is locked, never a button');
  assert.ok(st.rows.filter((r) => !r.locked).every((r) => r.tap));
  setMemberTeam(null);
  // a director's view-only second tab sees the table but cannot give points: no taps at all
  tabWriter = false;
  st = standings();
  assert.ok(st && st.rows.every((r) => !r.tap && !r.locked), 'a second tab reads, never gives');
  tabWriter = true;
  done();
});

test('standings: the gap sentence — who trails whom, how many golds put them in front, about my own team when I am on one', () => {
  boot('editor');
  const t = T();
  const say = () => { const s = standings(); return s.sentence && s.sentence.text; };
  assert.equal(say(), null, 'no points yet: no sentence');
  pointsFor(t[0], 30); pointsFor(t[1], 27);
  const nm = (id) => teamShort(id) || teamName(id);
  assert.equal(say(), `${nm(t[1])} trail ${nm(t[0])} by 3. One gold for ${nm(t[1])} would put them in front.`);
  pointsFor(t[2], 27);
  const s2 = standings().sentence;
  const named = s2.parts.filter((p) => p.team).map((p) => p.team);
  assert.deepEqual(named.slice(0, 2).sort(), [t[1], t[2]].sort(), 'the two level for second, in the order the tie puts them');
  assert.equal(named[2], t[0], 'the team names are parts, for the renderer to bold');
  assert.ok(s2.text.endsWith(` trail ${nm(t[0])} by 3. One gold for either would put them in front.`), s2.text);
  // a bigger gap needs more golds (7 each); an exact multiple only ties
  boot('editor');
  pointsFor(t[0], 30); pointsFor(t[1], 16);
  assert.equal(say(), `${nm(t[1])} trail ${nm(t[0])} by 14. Two golds for ${nm(t[1])} would tie them.`);
  boot('editor');
  pointsFor(t[0], 30); pointsFor(t[1], 17);
  assert.equal(say(), `${nm(t[1])} trail ${nm(t[0])} by 13. Two golds for ${nm(t[1])} would put them in front.`);
  // for a director on a team (or following one) the sentence is about that team
  boot('editor', t[3]);
  pointsFor(t[0], 30); pointsFor(t[1], 27); pointsFor(t[3], 12);
  assert.equal(say(), `${nm(t[3])} trail ${nm(t[0])} by 18. Three golds for ${nm(t[3])} would put them in front.`);
  // my team leads: it says so
  boot('editor', t[0]);
  pointsFor(t[0], 30); pointsFor(t[1], 27);
  assert.equal(say(), `${nm(t[0])} lead ${nm(t[1])} by 3.`);
  // level at the top
  boot('editor');
  pointsFor(t[0], 30); pointsFor(t[1], 30);
  assert.ok(/ are tied on points\. The next medal breaks it\.$/.test(say()), say());
  assert.deepEqual(standings().sentence.parts.filter((p) => p.team).map((p) => p.team).sort(), [t[0], t[1]].sort());
  // the double-points window doubles what a gold is worth (14), and the sentence says so
  boot('editor');
  pointsFor(t[0], 30); pointsFor(t[1], 17);
  const realDouble = inDoubleBonusWindow;
  inDoubleBonusWindow = () => true;
  assert.equal(say(), `${nm(t[1])} trail ${nm(t[0])} by 13. One double-points gold for ${nm(t[1])} would put them in front.`);
  inDoubleBonusWindow = realDouble;
  done();
});

// ════════════════════════════════════════════════════════════════════
// A counselor's Games tab
// ════════════════════════════════════════════════════════════════════
test('a counselor\'s model holds no point, no place and no leader — walked over every day and minute with the points guard throwing, and in a preview', () => {
  boot('viewer', T()[0]);
  setMemberTeam(T()[0]);
  const wedGames = gamesForDayId(dayOf(WED).id);
  state.results[wedGames[0].id] = medals(T()[2], T()[1], T()[0]);
  state.drafts[wedGames[1].id] = { scores: { [T()[3]]: '9', [T()[0]]: '4' }, medals: { gold: T()[4] || T()[3] } };
  state.bonuses = { b1: { teamId: T()[0], category: 'custom', label: 'Bonus', points: 5, at: new Date(BASE_MS).toISOString() } };
  setStandingsGuardThrows(true);
  // A medal's place on a finished game's podium is public (the winners are); nothing else here carries a place or a point.
  const bad = ['pts', 'place', 'silver', 'bronze', 'awarded', 'mv', 'locked', 'tap', 'sentence', 'gap', 'gold'];
  const walk = (v, where) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, where + '[' + i + ']'));
    if (v && typeof v === 'object') Object.keys(v).forEach((k) => {
      assert.ok(!bad.includes(k) || v[k] === null || v[k] === undefined || v[k] === false, `${where}.${k}: a director's field in a counselor's model`);
      if (k !== 'podium') walk(v[k], where + '.' + k);
    });
  };
  const walkDays = (step) => competitionDays().forEach((d) => {
    state.ui.day = d.id;
    for (let mins = 0; mins < 1440; mins += step) {
      const m = at(d.dow, mins);
      walk(m, `day ${d.dow} minute ${mins}`);
      assert.equal(m.standings, null);
      assert.equal(m.secret, true, 'the one quiet line a counselor reads');
      assert.ok(rowsOf(m).every((r) => r.score === null), 'no Score');
    }
  });
  walkDays(97);
  // a live tally is in roster order for a counselor — the order says who leads
  const g = wedGames[2] || wedGames[1];
  Object.assign(g, { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false });
  state.drafts[g.id] = { scores: { [T()[3]]: '9', [T()[0]]: '4', [T()[1]]: '12' } };
  state.ui.day = dayOf(WED).id;
  const row = rowsOf(at(WED, 630)).find((r) => r.id === g.id);
  assert.equal(row.board.kind, 'tally');
  assert.deepEqual(row.board.rows.map((r) => r.team), [T()[0], T()[1], T()[3]], 'roster order');
  assert.ok(row.board.rows.every((r) => !('place' in r)));
  // a director in a counselor preview is a counselor: the same walk, the same guard, no director's gold
  setMemberRole('editor');
  counselorPreviewOn = true;
  walkDays(131);
  assert.equal(at(WED, 630).director, false);
  assert.equal(at(WED, 630).points, false);
  counselorPreviewOn = false;
  setStandingsGuardThrows(false);
  assert.ok(at(WED, 630).standings, 'and back to a director\'s own screen it is there again');
  done();
});

test('a counselor with Games switched off gets nothing computed; a director\'s own screen still has it all', () => {
  boot('viewer');
  state.meta.hiddenCards = { competitions: true };
  let m = at(WED, 630);
  assert.equal(m.off, true);
  assert.deepEqual([m.days, m.blocks, m.notes], [[], [], []]);
  assert.equal(m.standings, null);
  setMemberRole('editor');
  m = at(WED, 630);
  assert.equal(m.off, false);
  assert.ok(m.blocks.length && m.standings);
  counselorPreviewOn = true;
  assert.equal(at(WED, 630).off, true, 'a preview honours the switch as a counselor\'s phone does');
  counselorPreviewOn = false;
  done();
});

test('notes: the double-points line names the games when only some are doubled; a day\'s own notes follow', () => {
  boot('editor');
  const day = dayOf(WED);
  const games = gamesForDayId(day.id);
  state.ui.day = day.id;
  assert.ok(at(WED, 630).notes.every((n) => n.kind !== 'double' || games.some((g) => g.messtival)));
  games.forEach((g) => { g.messtival = true; });
  assert.deepEqual(at(WED, 630).notes[0], { kind: 'double', text: 'Double points until the end of Friday' });
  games[0].messtival = false;
  assert.equal(at(WED, 630).notes[0].text, 'Double points until the end of Friday: ' + games.slice(1).map((g) => g.name).join(', '));
  games.forEach((g) => { g.messtival = false; });
  day.note = 'Wear sneakers\n\n  Bring water  ';
  assert.deepEqual(at(WED, 630).notes, [{ kind: 'day', text: 'Wear sneakers' }, { kind: 'day', text: 'Bring water' }]);
  day.note = '';
  done();
});

// ════════════════════════════════════════════════════════════════════
// Quick points
// ════════════════════════════════════════════════════════════════════
test('quick points: one ledger entry through the shared writer, Undo takes back exactly it, the own team and a counselor are refused', () => {
  boot('editor');
  const t = T();
  const keep = JSON.stringify(bonusDraft);
  bonusDraft.teams = [t[3]]; bonusDraft.points = '9'; bonusDraft.custom = 'Award points form';
  const form = JSON.stringify(bonusDraft);
  let r = gamesQuickAdd(t[2], 3, 'Team spirit');
  assert.equal(r.ok, true);
  assert.equal(r.ids.length, 1);
  const e = state.bonuses[r.ids[0]];
  assert.deepEqual([e.teamId, e.category, e.label, e.points], [t[2], 'custom', 'Team spirit', 3]);
  assert.ok(e.at && Number.isFinite(Date.parse(e.at)), 'stamped now, so the double window counts by its own time');
  assert.equal(JSON.stringify(bonusDraft), form, 'the Award points form on the shared draft is not disturbed');
  assert.equal(r.counted, 3);
  assert.equal(standings().rows.find((x) => x.team === t[2]).pts, 3);
  // no reason: the writer's own default label
  r = gamesQuickAdd(t[1], 5, '   ');
  assert.equal(state.bonuses[r.ids[0]].label, 'Bonus');
  // a reason is cut to 40 characters
  r = gamesQuickAdd(t[1], 1, 'x'.repeat(60));
  assert.equal(state.bonuses[r.ids[0]].label.length, 40);
  // inside the double-points window it counts twice (by its own timestamp) — the result says so for the toast
  const realWindow = inDoubleBonusWindow;
  inDoubleBonusWindow = () => true;
  assert.equal(gamesQuickAdd(t[0], 2, '').counted, 4);
  inDoubleBonusWindow = realWindow;
  // only the keys the sheet offers, only a camp team
  assert.deepEqual([gamesQuickAdd(t[0], 4, '').problem, gamesQuickAdd(t[0], 0, '').problem, gamesQuickAdd('zz', 1, '').problem], ['points', 'points', 'team']);
  // Undo takes back exactly that entry and nothing else
  const before = Object.keys(state.bonuses).length;
  r = gamesQuickAdd(t[0], 2, 'Helping out');
  assert.equal(Object.keys(state.bonuses).length, before + 1);
  assert.equal(gamesQuickUndo(r.ids), 1);
  assert.equal(Object.keys(state.bonuses).length, before);
  assert.equal(gamesQuickUndo(r.ids), 0, 'a second Undo finds nothing to take back');
  // the own team: refused before any write, and Undo refuses to remove it either
  setMemberTeam(t[0]);
  const n = Object.keys(state.bonuses).length;
  assert.equal(gamesQuickAdd(t[0], 2, '').problem, 'own-team');
  assert.equal(Object.keys(state.bonuses).length, n);
  const other = gamesQuickAdd(t[1], 2, '');
  assert.equal(other.ok, true, 'another team is fine');
  setMemberTeam(null);
  // a counselor, a preview and a view-only second tab write nothing
  [() => setMemberRole('viewer'), () => { setMemberRole('editor'); counselorPreviewOn = true; }, () => { counselorPreviewOn = false; tabWriter = false; }].forEach((mode) => {
    mode();
    const k = Object.keys(state.bonuses).length;
    assert.equal(gamesQuickAdd(t[2], 2, '').problem, 'not-director');
    assert.equal(Object.keys(state.bonuses).length, k);
  });
  tabWriter = true;
  setMemberRole('editor');
  // what the sheet says about a team
  boot('editor');
  pointsFor(t[0], 30); pointsFor(t[1], 27); pointsFor(t[2], 27);
  assert.equal(gamesQuickInfo(t[0]).now, '1st · 30 points so far');
  assert.equal(gamesQuickInfo(t[1]).now, '2nd, tied · 27 points so far');
  assert.ok(/^4th(, tied)? · 0 points so far$/.test(gamesQuickInfo(t[3]).now), gamesQuickInfo(t[3]).now); // junior: level with two others at the foot; senior: alone
  assert.equal(gamesQuickInfo('zz'), null);
  setMemberRole('viewer');
  assert.equal(gamesQuickInfo(t[0]), null, 'a counselor is told nothing');
  bonusDraft = JSON.parse(keep);
  done();
});

// ════════════════════════════════════════════════════════════════════
// The podium picker (redesign §5.5; BUILD-PLAN Step 18, build session 2)
// ════════════════════════════════════════════════════════════════════
function podiumGame(extra) {
  const g = addGame(dayOf(WED).id, 'pp-' + Math.random().toString(36).slice(2, 7), 'placement', extra);
  return g;
}
function rowOf(m, medal) { return m.rows.find((r) => r.medal === medal); }
function keyOf(m, medal, team) { return rowOf(m, medal).teams.find((k) => k.team === team); }

test('podium: three rows, later rows wait for the medal above, a taken team is named and a tap moves it, a picked one clears', () => {
  boot('editor');
  const g = podiumGame();
  const t = T();
  let m = gamesPodium(g);
  assert.deepEqual(m.rows.map((r) => [r.medal, r.place, r.word]), [['gold', 1, 'Gold'], ['silver', 2, 'Silver'], ['bronze', 3, 'Bronze']]);
  assert.ok(m.rows.every((r) => r.teams.length === t.length && r.teams.every((k, i) => k.team === t[i])), 'a key per team, in roster order');
  assert.deepEqual(m.rows.map((r) => r.wait), [false, true, true], 'nothing picked: only gold is open');
  assert.deepEqual(m.rows.map((r) => r.waitFor), [null, 'gold', 'silver']);
  assert.ok(rowOf(m, 'silver').teams.every((k) => k.disabled && !k.picked && !k.taken), 'a waiting row is all disabled, none "taken"');
  assert.equal(m.save.label, 'Pick gold, silver and bronze');
  assert.deepEqual([m.save.ready, m.save.target], [false, 'gold']);
  // pick gold: gold's team is picked there and TAKEN (named) in the other rows; silver opens
  assert.equal(podiumPick(g.id, 'gold', t[3]).ok, true);
  m = gamesPodium(g);
  assert.deepEqual([keyOf(m, 'gold', t[3]).picked, keyOf(m, 'gold', t[3]).disabled], [true, false]);
  const inSilver = keyOf(m, 'silver', t[3]);
  assert.deepEqual([inSilver.taken, inSilver.disabled, inSilver.picked], ['gold', false, false], 'the same team is "has gold" in the next row, and a tap there moves it');
  assert.ok(/, has gold\. Tap to make them silver$/.test(inSilver.label), 'and its spoken label says so: ' + inSilver.label);
  assert.deepEqual(m.rows.map((r) => r.wait), [false, false, true], 'silver is open now, bronze waits for silver');
  assert.equal(rowOf(m, 'bronze').waitFor, 'silver');
  assert.equal(m.save.label, 'Pick silver and bronze');
  // silver, then bronze: complete
  assert.equal(podiumPick(g.id, 'silver', t[0]).ok, true);
  assert.equal(gamesPodium(g).save.label, 'Pick bronze, then save');
  assert.equal(podiumPick(g.id, 'bronze', t[1]).ok, true);
  m = gamesPodium(g);
  assert.deepEqual([m.save.label, m.save.ready, m.save.target], ['Save result', true, null]);
  assert.deepEqual(m.rows.map((r) => r.pick), [t[3], t[0], t[1]]);
  // a team that holds one medal is named in the other two rows (never the bare word: the tab names the medal)
  assert.deepEqual(rowOf(m, 'bronze').teams.filter((k) => k.taken).map((k) => [k.team, k.taken]), [[t[0], 'silver'], [t[3], 'gold']], 'in roster order');
  // re-tap clears: the key is free again, the row below waits again only if it holds nothing
  assert.deepEqual(podiumPick(g.id, 'bronze', t[1]), { ok: true, action: 'clear', medal: 'bronze', team: t[1] });
  m = gamesPodium(g);
  assert.equal(rowOf(m, 'bronze').pick, null);
  assert.equal(keyOf(m, 'bronze', t[1]).disabled, false);
  assert.equal(m.save.label, 'Pick bronze, then save');
  done();
});

test('podium: a pick can only go where it may — a taken team, a waiting row, a stranger, a second director\'s result — and says why', () => {
  boot('editor');
  const g = podiumGame();
  const t = T();
  assert.deepEqual(podiumPick(g.id, 'silver', t[0]), { ok: false, problem: 'wait' }, 'silver waits for gold');
  assert.equal(state.drafts[g.id], undefined, 'and a refusal writes nothing');
  assert.equal(podiumPick(g.id, 'gold', t[0]).ok, true);
  // a team holding another medal MOVES (design pass: a dead key that says "has gold" was the one control that refused): both leaves in one update
  assert.equal(podiumPick(g.id, 'bronze', t[0]).problem, 'wait', 'a waiting row refuses even a team that holds a medal');
  assert.deepEqual(podiumPick(g.id, 'silver', t[0]), { ok: true, action: 'move', medal: 'silver', team: t[0], from: 'gold' });
  assert.deepEqual(podiumPicks(g), { gold: null, silver: t[0], bronze: null });
  assert.deepEqual(state.drafts[g.id].medals, { silver: t[0] }, 'the gold leaf is gone, not blank');
  assert.equal(podiumPick(g.id, 'gold', t[0]).from, 'silver', 'and back up again in one tap');
  assert.equal(podiumPick(g.id, 'bronze', t[1]).problem, 'wait', 'bronze waits for silver');
  assert.equal(podiumPick(g.id, 'gold', 'zz').problem, 'unknown');
  assert.equal(podiumPick(g.id, 'platinum', t[1]).problem, 'unknown');
  assert.equal(podiumPick('nope', 'gold', t[1]).problem, 'unavailable');
  // a bracket or a tally is not a podium game
  const tl = addGame(dayOf(WED).id, 'pp-tally', 'tally');
  const tt = addGame(dayOf(WED).id, 'pp-bracket', 'tournament');
  assert.equal(podiumPick(tl.id, 'gold', t[0]).problem, 'unavailable');
  assert.equal(podiumPick(tt.id, 'gold', t[0]).problem, 'unavailable');
  // a result exists (another director saved first): the stale form saves nothing and changes nothing
  state.results[g.id] = medals(t[2], t[3], t[4] || t[0]);
  assert.equal(podiumPick(g.id, 'silver', t[1]).problem, 'unavailable');
  assert.equal(podiumSave(g.id).problem, 'unavailable');
  assert.deepEqual(state.results[g.id].medals.gold, t[2], 'the first director\'s result stands');
  // a counselor, a counselor preview and a view-only second tab write nothing
  delete state.results[g.id];
  [() => setMemberRole('viewer'), () => { setMemberRole('editor'); counselorPreviewOn = true; }, () => { counselorPreviewOn = false; tabWriter = false; }].forEach((mode) => {
    mode();
    const before = JSON.stringify(state.drafts);
    assert.equal(podiumPick(g.id, 'silver', t[1]).problem, 'unavailable');
    assert.equal(podiumSave(g.id).problem, 'unavailable');
    assert.equal(JSON.stringify(state.drafts), before);
  });
  tabWriter = true;
  setMemberRole('editor');
  done();
});

test('podium: a director on a team picks their own team like anyone else (a podium is one act with no round to withhold)', () => {
  boot('editor', T()[0]);
  const g = podiumGame();
  assert.equal(podiumPick(g.id, 'gold', T()[0]).ok, true);
  assert.equal(gamesPodium(g).rows[0].pick, T()[0]);
  setMemberTeam(null);
  done();
});

test('podium: the draft is read defensively — a stale team id is no pick, a team written to two medals keeps its first, junk is ignored', () => {
  boot('editor');
  const g = podiumGame();
  const t = T();
  state.drafts[g.id] = { medals: { gold: t[0], silver: t[0], bronze: 'gone' } };
  assert.deepEqual(podiumPicks(g), { gold: t[0], silver: null, bronze: null }, 'two directors wrote one team to two medals: gold keeps it; a stale id is nothing');
  state.drafts[g.id] = { medals: { gold: 7, silver: { a: 1 }, bronze: null } };
  assert.deepEqual(podiumPicks(g), { gold: null, silver: null, bronze: null });
  state.drafts[g.id] = 'garbage';
  assert.deepEqual(podiumPicks(g), { gold: null, silver: null, bronze: null });
  delete state.drafts[g.id];
  assert.deepEqual(podiumPicks(g), { gold: null, silver: null, bronze: null });
  // a hole (gold cleared by one director while silver and bronze stayed): the row holding a pick never waits, so it can still be cleared
  state.drafts[g.id] = { medals: { silver: t[1], bronze: t[2] } };
  const m = gamesPodium(g);
  assert.deepEqual(m.rows.map((r) => r.wait), [false, false, false]);
  assert.equal(m.save.label, 'Pick gold, then save');
  assert.equal(keyOf(m, 'gold', t[1]).taken, 'silver', 'and a team held by a LATER medal is named in the row above as well');
  assert.deepEqual(podiumPick(g.id, 'gold', t[1]), { ok: true, action: 'move', medal: 'gold', team: t[1], from: 'silver' });
  assert.equal(state.drafts[g.id].medals.gold, t[1]);
  assert.ok(!('silver' in state.drafts[g.id].medals) && state.drafts[g.id].medals.bronze === t[2]);
  assert.equal(podiumPick(g.id, 'gold', t[1]).action, 'clear');
  done();
});

test('podium: the points words are a director\'s, doubled for a double-points game; a counselor\'s model holds none', () => {
  boot('editor');
  const g = podiumGame();
  assert.deepEqual(gamesPodium(g).rows.map((r) => r.pts), [7, 5, 3]);
  const dbl = podiumGame({ messtival: true });
  assert.deepEqual(gamesPodium(dbl).rows.map((r) => r.pts), [14, 10, 6], 'Messtival pays double, as medalCounts does');
  setStandingsGuardThrows(true);
  setMemberRole('viewer');
  assert.deepEqual(gamesPodium(g).rows.map((r) => r.pts), [null, null, null], 'no points for a phone that may not read them');
  setStandingsGuardThrows(false);
  setMemberRole('editor');
  counselorPreviewOn = true;
  assert.deepEqual(gamesPodium(g).rows.map((r) => r.pts), [null, null, null], 'nor in a counselor preview');
  counselorPreviewOn = false;
  done();
});

test('podium: drafts are written PER LEAF — two directors picking different medals at once both land, a clear is a delete of one leaf', () => {
  boot('editor');
  const g = podiumGame();
  const t = T();
  const snap = () => syncCanonTree(syncedSnapshot());
  let before = snap();
  podiumPick(g.id, 'gold', t[0]);
  let up = computeSyncUpdates(before, snap());
  assert.deepEqual(Object.keys(up).filter((k) => k.startsWith('drafts/')), ['drafts/' + g.id + '/medals/gold'], 'one leaf, not the whole draft: ' + JSON.stringify(up));
  assert.equal(up['drafts/' + g.id + '/medals/gold'], t[0]);
  before = snap();
  podiumPick(g.id, 'silver', t[1]);
  up = computeSyncUpdates(before, snap());
  assert.deepEqual(Object.keys(up).filter((k) => k.startsWith('drafts/')), ['drafts/' + g.id + '/medals/silver'], 'a second pick is a second leaf: gold is not re-sent');
  before = snap();
  podiumPick(g.id, 'silver', t[1]); // the same key again
  up = computeSyncUpdates(before, snap());
  assert.deepEqual(up['drafts/' + g.id + '/medals/silver'], null, 'a clear removes that one leaf');
  assert.equal(Object.keys(up).filter((k) => k.startsWith('drafts/')).length, 1);
  // the counselors' "Being scored" line: a draft with a medal is Live, a cleared one is not
  const ctx = nowCtxAt(WED, 630);
  assert.equal(gamesRow(ctx, g).status, 'live');
  podiumPick(g.id, 'gold', t[0]);
  assert.equal(gamesRow(ctx, g).status, 'todo', 'an emptied draft is a blank one');
  done();
});

// Save's confetti is a canvas the stub DOM cannot draw: record who it was for instead.
var celebrated = [];
var realCelebrate = celebrate;
function stubCelebrate() { celebrated = []; celebrate = (id) => { celebrated.push(id); }; }
function unstubCelebrate() { celebrate = realCelebrate; }

test('podium: Save writes the result the old button wrote, removes the draft, stamps the data, refuses an incomplete podium and a second save', () => {
  boot('editor');
  stubCelebrate();
  const g = podiumGame();
  const t = T();
  podiumPick(g.id, 'gold', t[2]); podiumPick(g.id, 'silver', t[0]);
  state.meta.lastDataChangeAt = 'before';
  assert.deepEqual(podiumSave(g.id), { ok: false, problem: 'incomplete', target: 'bronze' });
  assert.equal(state.results[g.id], undefined, 'nothing saved');
  assert.equal(state.meta.lastDataChangeAt, 'before');
  podiumPick(g.id, 'bronze', t[1]);
  const r = podiumSave(g.id);
  assert.equal(r.ok, true);
  assert.deepEqual(celebrated, [t[2]], 'the confetti is for the gold team');
  assert.deepEqual(state.results[g.id].medals, { gold: t[2], silver: t[0], bronze: t[1] });
  assert.ok(/^\d{4}-\d\d-\d\dT/.test(state.results[g.id].savedAt), 'stamped');
  assert.equal(state.drafts[g.id], undefined, 'the draft is gone');
  assert.ok(state.meta.lastDataChangeAt !== 'before', 'a real save stamps "data last updated"');
  assert.equal(medalCounts()[t[2]].points >= 7, true, 'the points are in the standings');
  assert.equal(podiumSave(g.id).problem, 'unavailable', 'a second tap saves nothing');
  // the saved game's dock is the Next game dock
  assert.ok(['next', 'wait', 'done'].includes(gamesDock(g.id).tone));
  unstubCelebrate();
  done();
});

test('podium: after Save the dock offers Next game (skipping a round my own team plays), and Back names where this game was opened from', () => {
  boot('editor');
  stubCelebrate();
  const day = dayOf(WED).id;
  const g1 = addGame(day, 'sv-1', 'placement', { session: 'Morning' });
  const g2 = addGame(day, 'sv-2', 'placement', { session: 'Morning' });
  state.ui.gameId = g1.id; state.ui.gameFrom = 'now';
  const opts = { now: { dow: WED, minutes: 630 }, ms: BASE_MS + 630 * 60000 };
  assert.equal(gamesDock(g1.id, opts).tone, 'pick', 'picking: the Save');
  const t = T();
  podiumPick(g1.id, 'gold', t[0]); podiumPick(g1.id, 'silver', t[1]); podiumPick(g1.id, 'bronze', t[2]);
  assert.equal(gamesDock(g1.id, opts).save.ready, true);
  podiumSave(g1.id);
  const d = gamesDock(g1.id, opts);
  assert.equal(d.tone, 'next');
  assert.ok(d.left.includes(' left today that you can score') || /that you can score$/.test(d.left), d.left);
  assert.equal(d.back, 'Back to Now');
  assert.ok(d.next && d.next.id !== g1.id, 'Next game names another game: ' + JSON.stringify(d.next));
  state.ui.gameId = null;
  unstubCelebrate();
  done();
});

test('the saved result: winners as plain data; points and the saved line are a director\'s; the own team is marked; a tally keeps its scores', () => {
  boot('editor');
  const g = podiumGame({ unit: 'pins' });
  const t = T();
  const res = medals(t[3], t[0], t[1]);
  state.results[g.id] = res; // the saved line reads the game's own result
  let r = gamesResultModel(g, res);
  assert.deepEqual(r.places.map((p) => [p.place, p.medal, p.word, p.team, p.pts, p.mine]), [[1, 'gold', 'Gold', t[3], 7, false], [2, 'silver', 'Silver', t[0], 5, false], [3, 'bronze', 'Bronze', t[1], 3, false]]);
  assert.equal(r.change, true);
  assert.ok(r.saved && r.saved.text.length > 3);
  assert.equal(r.scores, null, 'a podium game has no scores');
  // double points
  assert.deepEqual(gamesResultModel(podiumGame({ messtival: true }), res).places.map((p) => p.pts), [14, 10, 6]);
  // my team
  state.followTeam = t[0];
  assert.equal(gamesResultModel(g, res).places.find((p) => p.team === t[0]).mine, true);
  state.followTeam = undefined;
  // a tally result keeps its scores, in the game's order
  const tl = addGame(dayOf(WED).id, 'sv-tally', 'tally', { unit: 'pins' });
  r = gamesResultModel(tl, { medals: res.medals, scores: { [t[0]]: 12, [t[1]]: 30, [t[2]]: 7 }, savedAt: res.savedAt });
  assert.equal(r.scores.cap, 'Scores · pins');
  assert.deepEqual(r.scores.rows.map((x) => [x.team, x.v]), [[t[1], '30'], [t[0], '12'], [t[2], '7']]);
  const low = addGame(dayOf(WED).id, 'sv-low', 'tally', { unit: 'seconds', lowerWins: true });
  r = gamesResultModel(low, { medals: res.medals, scores: { [t[0]]: 12, [t[1]]: 30 }, savedAt: res.savedAt });
  assert.equal(r.scores.cap, 'Scores · seconds · lowest wins');
  assert.deepEqual(r.scores.rows.map((x) => x.team), [t[0], t[1]]);
  // junk in a result never throws: a medal with no team is not a row
  assert.equal(gamesResultModel(g, { medals: { gold: t[0] }, savedAt: 'x' }).places.length, 1);
  assert.equal(gamesResultModel(g, {}).places.length, 0);
  // a counselor: the winners, no points, no saved line, no Change
  setStandingsGuardThrows(true);
  setMemberRole('viewer');
  r = gamesResultModel(g, res);
  assert.deepEqual(r.places.map((p) => p.pts), [null, null, null]);
  assert.deepEqual([r.saved, r.change], [null, false]);
  assert.equal(r.places.length, 3, 'the winners are public');
  setStandingsGuardThrows(false);
  setMemberRole('editor');
  counselorPreviewOn = true;
  r = gamesResultModel(g, res);
  assert.deepEqual([r.places.map((p) => p.pts), r.saved, r.change], [[null, null, null], null, false], 'a preview is exactly a counselor\'s');
  counselorPreviewOn = false;
  done();
});

test('the saved line is "Saved" only once the server has it: saving → saved, offline, no sync, refused', () => {
  boot('editor');
  const g = podiumGame();
  const t = T();
  state.results[g.id] = medals(t[0], t[1], t[2]);
  const keep = { fbRef, fbConnKnown, fbConnected, confirmedTree, q: stateQuarantine };
  try {
    fbRef = null;
    assert.equal(gameResultState(g.id), 'offline', 'a device with no sync keeps it on the phone');
    assert.equal(gameSavedWords('offline', state.results[g.id].savedAt), 'Saved on this phone');
    fbRef = {}; fbConnKnown = true; fbConnected = true; confirmedTree = syncCanonTree({ results: {} });
    assert.equal(gameResultState(g.id), 'saving', 'connected, but the server has not confirmed it yet');
    assert.equal(gameSavedWords('saving'), 'Saving…');
    confirmedTree = syncCanonTree({ results: { [g.id]: JSON.parse(JSON.stringify(state.results[g.id])) } });
    assert.equal(gameResultState(g.id), 'saved', 'the confirmed tree holds this very record');
    assert.ok(/^Saved \d{1,2}:\d\d [AP]M · everyone’s phone has it$/.test(gameSavedWords('saved', state.results[g.id].savedAt)), gameSavedWords('saved', state.results[g.id].savedAt));
    assert.equal(gameSavedWords('saved', undefined), 'Saved · everyone’s phone has it', 'an old result with no stamp has no time');
    confirmedTree = syncCanonTree({ results: { [g.id]: medals(t[3], t[1], t[2]) } });
    assert.equal(gameResultState(g.id), 'saving', 'someone else\'s different record is not ours');
    fbConnected = false;
    assert.equal(gameResultState(g.id), 'offline', 'no connection: it sends when you are back');
    assert.ok(/it sends when you’re back online$/.test(gameSavedWords('offline', 'x')));
    fbConnected = true;
    stateQuarantine = { ['results/' + g.id]: state.results[g.id] };
    assert.equal(gameResultState(g.id), 'refused');
    assert.ok(/Retry/.test(gameSavedWords('refused')));
    delete state.results[g.id];
    stateQuarantine = {};
    assert.equal(gameResultState(g.id), null, 'no result, no line');
  } finally { fbRef = keep.fbRef; fbConnKnown = keep.fbConnKnown; fbConnected = keep.fbConnected; confirmedTree = keep.confirmedTree; stateQuarantine = keep.q; }
  done();
});

test('gamesOrdinal reads 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st', () => {
  assert.deepEqual([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111].map(gamesOrdinal), ['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
});
