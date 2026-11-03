// The Now engine — blockKind and nowModel() (redesign §3.1–3.5; BUILD-PLAN Step 17, build session 1). Runs under both camp
// profiles (now-model.senior.test.js evals this file) and, through tests/run.js, against a camp whose schedule is already
// edited here (the seeded pass). What these cases pin: that a block's KIND comes from the data (type, the Meal tag) and falls
// back to the label rules; that every minute of every day is a block or a named empty state, with no throw; the moment
// windows; the running-over rules (a live game, a director's "Still on this", the 45-minute cap, never past the next games
// block); the personalisation (my team, my station first, my cleanup duty); that a counselor's model carries no point and no
// place; and that the wake-up list names every minute at which the picture changes.

var DOWS = [0, 1, 2, 3, 4, 5, 6];
var KINDS = ['games', 'elective', 'meal', 'bible', 'meeting', 'worship', 'bedtime', 'arrival', 'sendoff', 'activity'];

function kindsOf(dow) {
  return scheduleForDow(dow).map((b) => [b.label, blockKind(b, dow)]);
}
function kindOf(dow, headStart) {
  const hit = scheduleForDow(dow).find((b) => String(b.label).toLowerCase().indexOf(headStart.toLowerCase()) === 0);
  assert.ok(hit, 'no block "' + headStart + '" on day ' + dow);
  return blockKind(hit, dow);
}

test('blockKind: every block of every day has one of the ten kinds', () => {
  DOWS.forEach((dow) => kindsOf(dow).forEach(([label, k]) => assert.ok(KINDS.includes(k), `dow ${dow} "${label}" -> ${k}`)));
});

test('blockKind: junior reads the explicit fields first and the label rules after', () => {
  if (CAMP.id !== 'junior') return;
  assert.equal(kindOf(1, 'Team competitions'), 'games');
  assert.equal(kindOf(1, 'Evening competition'), 'games');
  assert.equal(kindOf(1, 'Elective 1'), 'elective');
  assert.equal(kindOf(1, 'Breakfast'), 'meal');
  assert.equal(kindOf(1, 'Lunch'), 'meal');
  assert.equal(kindOf(1, 'Supper'), 'meal');
  assert.equal(kindOf(1, 'Bible study'), 'bible');
  assert.equal(kindOf(1, 'Rising bell'), 'meeting');
  assert.equal(kindOf(1, 'Evening service'), 'worship');
  assert.equal(kindOf(1, 'Prepare for evening service'), 'activity', 'preparing for a service is not the service');
  assert.equal(kindOf(1, 'Prepare for Elective 1'), 'activity');
  assert.equal(kindOf(1, 'Team time'), 'activity');
  assert.equal(kindOf(1, 'Cabin time & clean up'), 'activity');
  assert.equal(kindOf(1, 'Snack Shack break'), 'activity');
  assert.equal(kindOf(1, 'Snack and campfire'), 'activity');
  assert.equal(kindOf(1, 'Prepare for bed'), 'bedtime');
  assert.equal(kindOf(1, 'Cabin devotional'), 'bedtime');
  assert.equal(kindOf(1, 'Lights out'), 'bedtime');
  assert.equal(kindOf(5, 'Team Skits'), 'activity');
  assert.equal(kindOf(5, 'Boys cabin pillow fight'), 'activity');
});

test('blockKind: junior Sunday is the arrival up to the worship service, Saturday is the send-off', () => {
  if (CAMP.id !== 'junior') return;
  assert.equal(kindOf(0, 'Registration'), 'arrival');
  assert.equal(kindOf(0, 'Welcome to camp'), 'arrival');
  assert.equal(kindOf(0, 'Supper'), 'meal', 'a meal stays a meal');
  assert.equal(kindOf(0, 'Team assignments'), 'arrival');
  assert.equal(kindOf(0, 'Prepare for worship service'), 'arrival', 'still before the first worship block');
  assert.equal(kindOf(0, 'Worship service'), 'worship');
  assert.equal(kindOf(0, 'Snack and campfire'), 'activity', 'after the worship it is an ordinary evening');
  assert.equal(kindOf(0, 'Cabin devotional'), 'bedtime');
  assert.equal(kindOf(0, 'Lights out'), 'bedtime');
  assert.equal(kindOf(6, 'Rising bell'), 'meeting', 'a label rule beats the weekday');
  assert.equal(kindOf(6, 'Breakfast'), 'meal');
  assert.equal(kindOf(6, 'Cabin time & campground cleanup'), 'sendoff');
  assert.equal(kindOf(6, 'Meet in Tabernacle'), 'sendoff');
  assert.equal(kindOf(6, "Camp's over"), 'sendoff');
});

test('blockKind: senior has no electives and a Sunday with no worship block', () => {
  if (CAMP.id !== 'senior') return;
  assert.equal(kindOf(1, 'Team competitions'), 'games');
  assert.equal(kindOf(1, 'Legacy Game'), 'games');
  assert.equal(kindOf(1, 'Wake up'), 'meeting');
  assert.equal(kindOf(1, 'Morning Bible study'), 'bible');
  assert.equal(kindOf(1, 'Lunch'), 'meal');
  assert.equal(kindOf(1, 'Evening worship'), 'worship');
  assert.equal(kindOf(1, 'Campfire / waterfront worship'), 'worship');
  assert.equal(kindOf(1, 'Cabin devotions'), 'bedtime');
  assert.equal(kindOf(1, 'Lights out'), 'bedtime');
  assert.equal(kindOf(1, 'Free time below the tracks'), 'activity', 'free time is an activity');
  assert.equal(kindOf(1, 'Cool down'), 'activity');
  assert.equal(kindOf(0, 'Arrival & registration'), 'arrival');
  assert.equal(kindOf(0, 'Welcome night'), 'arrival', 'no worship block on Sunday: all of it is the arrival');
  assert.equal(kindOf(6, 'Wake up'), 'meeting');
  // an elective type that somehow reached a camp without electives is an ordinary block
  assert.equal(blockKind({ start: 700, end: 740, label: 'Elective 1', type: 'elective', slot: 0 }, 1), 'activity');
});

test('blockKind: the Meal tag makes a meal of a block the label does not, and junk never throws', () => {
  const real = blockMeal;
  blockMeal = (b) => (b && b.label === 'Zed' ? 'Supper' : real(b));
  assert.equal(blockKind({ label: 'Zed', start: 1065, end: 1130 }, 2), 'meal', 'the item\'s own tag decides, whatever its label says');
  blockMeal = real;
  assert.equal(blockKind({ label: 'Zed', start: 1065, end: 1130 }, 2), 'activity');
  if (CAMP.id === 'senior') assert.equal(kindOf(1, 'Supper and free time'), 'activity', 'untagged, senior\'s supper reads as an ordinary block');
  assert.equal(blockKind(null, 1), 'activity');
  assert.equal(blockKind(undefined, 99), 'activity');
  assert.equal(blockKind({}, 'x'), 'activity');
  assert.equal(blockKind({ label: 'Bible study — with Sam', start: 540, end: 585 }, 3), 'bible', 'the tail is not read');
  assert.equal(blockKind({ label: 'Whatever', start: 0, end: 5, noTime: true }, 2), 'bedtime', 'a block with no time is the end of the day');
});


// ════════════════════════════════════════════════════════════════════
// nowModel
// ════════════════════════════════════════════════════════════════════
var CARD_KINDS = KINDS.concat(['between', 'morning', 'night', 'none', 'over', 'notice']);
var BASE_MS = Date.UTC(2026, 6, 22, 12, 0, 0);
var T = () => state.teams.map((t) => t.id);
var LAST = () => T()[T().length - 1];
var realOnRota = cleanupOnRota;
var realRotaTeams = cleanupTeams;
var realCampWeek = campWeek;
var realMealInfo = mealInfo;

function boot(role, team) {
  freshState();
  setMemberRole(role === undefined ? 'editor' : role);
  setMemberTeam(null);
  state.followTeam = team || null;
  state.identity = undefined;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false;
  state.bonuses = {}; state.results = {}; state.drafts = {}; state.brackets = {}; state.clocks = {}; state.meta.overrun = undefined;
  state.announcements = {};
  weatherData = null;
  setStandingsGuardThrows(false);
  counselorPreviewOn = false;
  cleanupOnRota = realOnRota; cleanupTeams = realRotaTeams; campWeek = realCampWeek;
  state.notice = defaultNotice();
  nowLast = null;
}
function done() {
  cleanupOnRota = realOnRota; cleanupTeams = realRotaTeams; campWeek = realCampWeek;
  setStandingsGuardThrows(false);
  counselorPreviewOn = false;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  setMemberTeam(null);
  setMemberRole(null);
  state.followTeam = undefined;
  nowLast = null;
}
// A rota that is the same on both camps: breakfast the first team, lunch the second and third, supper nobody (Mon–Fri).
function stubRota() {
  cleanupOnRota = (d) => d >= 1 && d <= 5;
  cleanupTeams = (d, meal) => (d < 1 || d > 5 ? [] : meal === 'Breakfast' ? [T()[0]] : meal === 'Lunch' ? [T()[1], T()[2]] : []);
}
function at(dow, minutes, extra) {
  return nowModel(Object.assign({ now: { dow, minutes }, ms: BASE_MS + minutes * 60000 }, extra || {}));
}
// What the picture is made of, without what moves with the clock alone (clock), the strip (messages) or the wake list itself.
function sigOf(m) {
  return JSON.stringify([m.card, m.block, m.moment, m.body, m.next, m.later, m.laterHeading, m.todo, m.todoMore, m.wholeDay, m.reveal, m.week, m.basis]);
}
// the first games block of a day that holds games, with its games (cloned up to `n` when the camp has fewer there)
function gamesBlockOf(dow, n) {
  const nb = nowBlocks(dow).find((x) => x.kind === 'games' && gamesForBlock(dow, x.b).length);
  assert.ok(nb, 'no games block with games on day ' + dow);
  let games = gamesForBlock(dow, nb.b);
  for (let i = games.length; i < (n || 0); i++) {
    const g0 = games[0];
    state.config.games.push(Object.assign({}, g0, { id: g0.id + '-t' + i, name: g0.name + ' ' + (i + 1), ord: (Number(g0.ord) || 0) + i + 1 }));
  }
  games = gamesForBlock(dow, nb.b);
  return { nb, games };
}
function medals(a, b, c) { return { medals: { gold: a, silver: b, bronze: c }, savedAt: new Date(BASE_MS).toISOString() }; }
var WED = 3;

test('nowModel: every minute of every day is a block or a named empty state, nothing throws, and the picture changes only at a wake-up', () => {
  boot('editor', null); // a director with no team: the richest model; nothing is running, so no card is held
  stubRota(); // a rota whose windows end inside a block on both camps (senior's own is empty), so the cleanup window's end must be a wake-up
  // Every minute against the printed week; the seeded passes (the same week as data) every third, which still checks that a
  // wake-up lies between any two minutes whose pictures differ (the printed week is the exact walk) and keeps the suite's time.
  const step = scheduleIsShared() ? 3 : 1;
  let walked = 0;
  DOWS.forEach((dow) => {
    let prev = null;
    let prevSig = null;
    let prevM = -1;
    for (let m = 0; m < 1440; m += step) {
      const model = at(dow, m);
      walked++;
      const where = `dow ${dow} minute ${m}`;
      assert.ok(CARD_KINDS.includes(model.card.kind), `${where}: card kind ${model.card.kind}`);
      assert.ok(typeof model.card.title === 'string' && model.card.title.length, `${where}: a card with no title`);
      if (model.block) {
        assert.ok(m >= model.block.start && m < model.block.end, `${where}: the card's block does not hold the minute`);
        assert.equal(model.block.id, model.block.id);
      } else {
        assert.ok(['between', 'morning', 'night', 'arrival', 'none', 'over'].includes(model.card.kind), `${where}: no block and kind ${model.card.kind}`);
      }
      const c = model.clock;
      assert.ok(c.left === null || c.left >= 0, where);
      assert.ok(c.progress === null || (c.progress >= 0 && c.progress <= 1), where);
      assert.ok(model.later.length <= (dow === 0 ? 40 : 3), `${where}: Later today has ${model.later.length}`);
      assert.ok(model.wake.length && model.wake[model.wake.length - 1] === 1440, where);
      assert.ok(model.wake.every((w, i) => w > m && (i === 0 || w > model.wake[i - 1])), `${where}: wake list not ascending and after now`);
      JSON.stringify(model);
      const sig = sigOf(model);
      if (prev && sig !== prevSig) assert.ok(prev.wake.some((w) => w > prevM && w <= m), `${where}: the picture changed since minute ${prevM} but no wake-up lies in between (${prev.wake.slice(0, 6)}…)`);
      prev = model;
      prevSig = sig;
      prevM = m;
    }
  });
  assert.equal(walked, 7 * Math.ceil(1440 / step));
  done();
});

test('nowModel: a counselor on a team, walked every 7th minute with the points guard throwing, holds no point and no place', () => {
  boot('viewer', T()[0]);
  setMemberTeam(T()[0]);
  stubRota();
  state.bonuses = { 'cleanup-t0-3-Lunch': { teamId: T()[0], category: 'cleanup', points: 3, day: 3, meal: 'Lunch', at: new Date(BASE_MS).toISOString() }, 'verse-t0-3': { teamId: T()[0], category: 'verse', points: 5, day: 3, at: new Date(BASE_MS).toISOString() } };
  const gb = gamesBlockOf(WED, 2);
  state.results[gb.games[0].id] = medals(T()[2], T()[1], T()[0]);
  state.drafts[gb.games[1].id] = { scores: { [T()[3]]: '9', [T()[0]]: '4' } };
  setStandingsGuardThrows(true); // a points reader reached by a counselor's model throws
  const bad = ['pts', 'given', 'locked', 'secret', 'max', 'mult', 'stillToScore'];
  const walk = (v, where) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, where + '[' + i + ']'));
    if (v && typeof v === 'object') Object.keys(v).forEach((k) => {
      assert.ok(!bad.includes(k) || v[k] === null || v[k] === undefined, `${where}.${k}: a director's field in a counselor's model`);
      walk(v[k], where + '.' + k);
    });
  };
  DOWS.forEach((dow) => {
    for (let m = 0; m < 1440; m += 7) {
      const model = at(dow, m);
      walk(model, `dow ${dow} minute ${m}`);
      assert.equal(model.todo.length, 0);
      assert.ok(!model.moment || model.moment.kind === 'cleanup', 'a counselor has no verse moment');
      assert.equal(model.card.hold, null);
      assert.equal(model.card.down, false);
    }
  });
  // a director in a counselor preview is a counselor: the same walk, the same guard
  setMemberRole('editor');
  counselorPreviewOn = true;
  DOWS.forEach((dow) => {
    for (let m = 0; m < 1440; m += 11) {
      const model = at(dow, m);
      walk(model, `preview dow ${dow} minute ${m}`);
      assert.equal(model.todo.length, 0);
      assert.equal(model.card.hold, null);
      assert.ok(model.messages.every((x) => !x.canRemove && !x.canTakeDown));
    }
  });
  counselorPreviewOn = false;
  setMemberRole('viewer');
  // the live tally of that game (competitions with a draft): roster order, no place numerals, scores public
  const m = at(WED, gb.nb.start + 5);
  const live = m.body.rows.find((r) => r.status === 'live');
  assert.ok(live, 'the drafted game is live');
  gb.games[1].liveRankings = true;
  const board = at(WED, gb.nb.start + 5).body.rows.find((r) => r.status === 'live').board;
  if (board) {
    assert.equal(board.ranked, false);
    assert.deepEqual(board.rows.map((r) => r.team), T().filter((id) => board.rows.some((r) => r.team === id)), 'roster order');
    assert.ok(board.rows.every((r) => !('place' in r)));
  }
  done();
});

test('nowModel: the empty states are named — none, over, between, morning, night, the arrival countdown', () => {
  boot('viewer', T()[0]);
  // no camp week set up and no blocks that day
  const realSched = scheduleForDow;
  scheduleForDow = (d) => (d === 4 ? [] : realSched(d));
  let m = at(4, 600);
  assert.equal(m.card.kind, 'none');
  assert.equal(m.card.title, 'No camp week is set up yet');
  assert.equal(m.body.cta, null, 'a counselor is not offered the setup');
  assert.equal(m.wholeDay, false);
  campWeek = () => ({ start: '2027-07-18', phase: 'during' });
  m = at(4, 600, { date: '2027-07-21' });
  assert.equal(m.card.title, 'Nothing is planned for today');
  scheduleForDow = realSched;
  // before the week: "Camp starts Sunday, July 18", the Saturday before included; a ?now= preview ignores the dates
  m = at(WED, 600, { date: '2027-07-17' });
  assert.equal(m.card.kind, 'none');
  assert.equal(m.card.title, 'Camp starts Sunday, July 18');
  assert.equal(at(WED, 600, { date: '2027-07-20' }).card.kind, 'games');
  assert.equal(at(WED, 600, { date: '2027-07-17', forced: true }).card.kind, 'games');
  // after it: See you next year (the Sunday after is already over)
  m = at(WED, 600, { date: '2027-07-25' });
  assert.equal(m.card.kind, 'over');
  assert.equal(m.card.title, 'See you next year');
  assert.equal(at(WED, 600, { date: '2027-07-24' }).card.kind, 'games', 'Saturday is still in the week');
  campWeek = realCampWeek;
  // before the first block: Sunday counts down to it, other days are Good morning after 6 and Lights out before
  const first = nowBlocks(0)[0];
  m = at(0, first.start - 90);
  assert.equal(m.card.kind, 'arrival');
  assert.equal(m.card.title, 'Camp starts today');
  assert.equal(m.clock.untilNext, 90);
  assert.equal(m.body.countdown.start, first.start);
  assert.equal(m.next.start, first.start, 'Up next is the first block');
  assert.equal(m.laterHeading, 'Today');
  assert.equal(at(WED, 3 * 60).card.kind, 'night');
  assert.equal(at(WED, 3 * 60).body.heading, 'Today');
  assert.equal(at(WED, 6 * 60 + 30).card.kind, 'morning');
  assert.equal(at(WED, 6 * 60 + 30).card.title, 'Good morning');
  assert.equal(at(WED, 6 * 60 + 30).body.rows.length, 3);
  assert.equal(at(WED, 6 * 60 + 30).next, null, 'the first three are the card\'s own rows');
  // after the last block: tomorrow's first three
  const lastEnd = Math.max(...nowBlocks(WED).map((x) => x.end));
  const night = at(WED, 23 * 60 + 30);
  assert.equal(night.card.kind, 'night');
  assert.equal(night.card.title, 'Lights out');
  assert.equal(night.card.k, 'Tonight');
  assert.equal(night.body.heading, 'Tomorrow');
  assert.deepEqual(night.body.rows.map((r) => r.title), nowBlocks(4).slice(0, 3).map((x) => x.head));
  assert.equal(night.next, null);
  assert.equal(night.later.length, 0);
  assert.ok(lastEnd <= 1440);
  // the gap between two blocks (a day with a hole in it)
  scheduleForDow = (d) => (d === 4 ? realSched(4).filter((b) => !(b.start >= 720 && b.start < 750)) : realSched(d));
  const day = nowBlocks(4);
  const gapStart = day.find((x, i) => day[i + 1] && day[i + 1].start > x.end);
  assert.ok(gapStart, 'the day has a gap now');
  const g = at(4, gapStart.end + 3);
  assert.equal(g.card.kind, 'between');
  assert.equal(g.card.title, 'Up next');
  assert.equal(g.body.rows[0].start, day[gapStart.i + 1].start);
  assert.equal(g.clock.untilNext, day[gapStart.i + 1].start - (gapStart.end + 3));
  assert.equal(g.next, null);
  assert.equal(g.later.length, 3);
  scheduleForDow = realSched;
  done();
});

test('nowModel: the saturday send-off is the card, its last block is the over card, a posted notice becomes the send-off card', () => {
  boot('editor', T()[0]);
  const blocks = nowBlocks(6);
  const send = blocks.find((x) => x.kind === 'sendoff' && !x.noTime);
  const over = blocks.find((x) => x.kind === 'sendoff' && x.noTime);
  assert.ok(send && over);
  assert.equal(at(6, send.start).card.kind, 'sendoff');
  assert.equal(at(6, over.start).card.kind, 'over');
  assert.equal(at(6, over.start).card.title, 'See you next year');
  assert.equal(at(6, over.start).body.champion, null, 'no champion remembered on this phone');
  // post the notice: the send-off block shows it as the card, your team's assignment first; the strip then leaves it out
  state.notice.status = 'posted';
  state.notice.title = 'Cleanup plan';
  state.notice.zones = [{ teamId: T()[1], place: 'Chapel', note: '' }, { teamId: T()[0], place: 'Dining hall', note: 'tables' }];
  const m = at(6, send.start);
  assert.equal(m.card.kind, 'notice');
  assert.equal(m.card.title, 'Cleanup plan');
  assert.equal(m.card.down, true, 'a director may take it down from here');
  assert.equal(m.body.notice.yours.place, 'Dining hall');
  assert.ok(m.body.notice.zones.find((z) => z.team === T()[0]).mine);
  assert.equal(m.messages.filter((x) => x.kind === 'notice').length, 0);
  // on any other day it is a strip, not the card
  const wed = at(WED, 600);
  assert.equal(wed.card.kind, 'games');
  assert.equal(wed.messages.filter((x) => x.kind === 'notice').length, 1);
  done();
});

test('nowModel: the cleanup moment is the 30 minutes after a meal, with the teams on the rota and nothing else', () => {
  boot('viewer', T()[3]);
  stubRota();
  const meals = nowBlocks(WED).filter((x) => x.meal && !x.noTime);
  assert.ok(meals.length >= 2, 'both camps have a breakfast and a lunch');
  meals.forEach((nb) => {
    const expect = nb.meal === 'Breakfast' ? [T()[0]] : nb.meal === 'Lunch' ? [T()[1], T()[2]] : [];
    for (let m = nb.end - 2; m < nb.end + 33; m++) {
      const mom = at(WED, m).moment;
      const inside = m >= nb.end && m < nb.end + 30 && expect.length;
      if (!inside) { assert.ok(!mom || mom.meal !== nb.meal, `minute ${m} after ${nb.meal}: ${mom && mom.meal}`); continue; }
      assert.ok(mom && mom.kind === 'cleanup' && mom.meal === nb.meal, `minute ${m} is inside ${nb.meal}'s window`);
      assert.deepEqual(mom.teams.map((t) => t.team), expect);
      assert.equal(mom.title, nb.meal + ' cleanup');
      assert.equal(mom.until, nb.end + 30);
      assert.ok(mom.teams.every((t) => typeof t.who === 'string' && !('pts' in t) && !('locked' in t)), 'a counselor sees whose turn it is');
    }
  });
  // not during the meal itself, and the meal card names the team on cleanup after it (my team in bold)
  const lunch = meals.find((x) => x.meal === 'Lunch');
  const during = at(WED, lunch.start + 1);
  assert.equal(during.moment, null);
  assert.equal(during.card.kind, 'meal');
  assert.deepEqual(during.card.notes.filter((n) => n.kind === 'team').map((n) => n.lead), [teamName(T()[1]), teamName(T()[2])]);
  state.followTeam = T()[2];
  const mine = at(WED, lunch.start + 1).card.notes.find((n) => n.mine);
  assert.equal(mine.lead, 'Your team');
  assert.equal(mine.rest, ' is on cleanup after lunch');
  // a camp whose rota is empty says nothing: no moment, no note, at any minute
  cleanupOnRota = realOnRota; cleanupTeams = () => [];
  cleanupOnRota = () => true;
  for (let m = 0; m < 1440; m += 5) { const x = at(WED, m); assert.equal(x.moment, null); assert.equal(x.card.notes.filter((n) => n.kind === 'team').length, 0); }
  done();
});

test('nowModel: a director sees the cleanup keys with the lock on their own team; the verse moment is a confirmed director\'s alone', () => {
  boot('editor', T()[0]);
  setMemberTeam(T()[0]);
  stubRota();
  state.bonuses = { 'cleanup-t0-3-Breakfast': { teamId: T()[0], category: 'cleanup', points: 2, day: 3, meal: 'Breakfast', at: new Date(BASE_MS).toISOString() } };
  const bf = nowBlocks(WED).find((x) => x.meal === 'Breakfast');
  const mom = at(WED, bf.end + 1).moment;
  assert.equal(mom.kind, 'cleanup');
  assert.equal(mom.secret, true);
  assert.equal(mom.max, 3);
  assert.equal(mom.teams[0].locked, true, 'the breakfast team is the director\'s own');
  assert.equal(mom.teams[0].pts, 2);
  setMemberTeam(LAST());
  const mom2 = at(WED, bf.end + 1).moment;
  assert.equal(mom2.teams[0].locked, false);
  assert.equal(mom2.teams[0].pts, 2);
  // verse: Bible study, six keys' worth of teams, the day's stored points
  const bible = nowBlocks(WED).find((x) => x.kind === 'bible');
  assert.ok(bible);
  state.bonuses['verse-t1-3'] = { teamId: T()[1], category: 'verse', points: 4, day: 3, at: new Date(BASE_MS).toISOString() };
  // senior's Bible study starts the minute breakfast ends: look past breakfast's cleanup window, which takes the panel first
  const vm = Math.max(bible.start + 5, ...nowBlocks(WED).filter((x) => x.meal).map((x) => x.end + 30).filter((e) => e > bible.start && e < bible.end));
  const v = at(WED, vm);
  assert.equal(v.card.kind, 'bible');
  assert.ok(v.body.verse.text, 'the verse (senior\'s is a placeholder with no reference yet)');
  assert.equal(v.moment.kind, 'verse');
  assert.equal(v.moment.max, 5);
  assert.deepEqual(v.moment.teams.map((t) => t.team), T());
  assert.equal(v.moment.teams.find((t) => t.team === T()[1]).pts, 4);
  assert.equal(v.moment.teams.find((t) => t.team === LAST()).locked, true, 'the director\'s own team is locked');
  assert.equal(v.moment.teams.find((t) => t.team === T()[2]).locked, false);
  setMemberTeam(T()[1]);
  assert.equal(at(WED, vm).moment.teams.find((t) => t.team === T()[1]).locked, true);
  // a counselor, a hint-painted phone and a counselor preview get the verse and no moment
  setMemberRole('viewer');
  assert.equal(at(WED, vm).moment, null);
  assert.equal(at(WED, vm).body.verse.ref, v.body.verse.ref);
  setMemberRole('editor');
  counselorPreviewOn = true;
  assert.equal(at(WED, vm).moment, null);
  counselorPreviewOn = false;
  setMemberRole('editor', { provisional: true });
  assert.equal(at(WED, vm).moment, null, 'a hinted director has not been confirmed: no points');
  setStandingsGuardThrows(true);
  const hinted = at(WED, bf.end + 1).moment;
  assert.ok(hinted && hinted.kind === 'cleanup' && hinted.teams.every((x) => !('pts' in x) && !('locked' in x)) && !('secret' in hinted) && !('max' in hinted), 'a hinted director sees whose turn it is, not the keys');
  setStandingsGuardThrows(false);
  counselorPreviewOn = true;
  setMemberRole('editor');
  const pv = at(WED, bf.end + 1).moment;
  assert.ok(pv && !('secret' in pv) && pv.teams.every((x) => !('pts' in x)), 'a counselor preview shows the cleanup panel as a counselor sees it');
  counselorPreviewOn = false;
  // no verse for the day: the block is an ordinary one
  const realVerse = verseFor;
  verseFor = () => NO_VERSE;
  assert.equal(at(WED, vm).card.kind, 'activity');
  verseFor = realVerse;
  done();
});


test('nowModel: a live game past its block keeps the card — capped 45 minutes, never past the next games block', () => {
  boot('viewer', T()[0]);
  DOWS.forEach((dow) => {
    const day = nowBlocks(dow);
    day.filter((x) => x.kind === 'games').forEach((nb) => {
      const next = day.find((x) => x !== nb && x.kind === 'games' && x.start >= nb.end);
      const cap = nowGamesCap(day, nb);
      assert.equal(cap, next ? Math.min(nb.end + 45, next.start) : nb.end + 45, `day ${dow} ${nb.head}: the cap`);
    });
  });
  const dow = WED;
  const gb = gamesBlockOf(dow, 1);
  const nb = gb.nb;
  const cap = nowGamesCap(nowBlocks(dow), nb);
  // nothing live: the clock moves on at the block's end
  assert.equal(at(dow, nb.end).card.over, false);
  assert.ok(at(dow, nb.end).block.id !== nb.id, 'the clock has moved on');
  // a game with a score in its draft is Live
  state.drafts[gb.games[0].id] = { scores: { [T()[0]]: '3' } };
  assert.equal(gameRowStatus(gb.games[0], BASE_MS), 'live');
  assert.equal(at(dow, nb.end - 1).card.over, false, 'still inside the block: an ordinary card');
  for (let m = nb.end; m < cap; m++) {
    const x = at(dow, m);
    assert.equal(x.block.id, nb.id, `minute ${m} is held`);
    assert.equal(x.card.kind, 'games');
    assert.equal(x.card.over, true);
    assert.equal(x.card.k, 'Running over');
    assert.equal(x.block.overrun.by, 'live');
    assert.equal(x.clock.over, m - nb.end);
    assert.equal(x.clock.left, null);
    assert.equal(x.clock.progress, 1);
    assert.ok(/^Still going/.test(x.card.sub), x.card.sub);
    assert.equal(x.moment, null, 'no moment on a held card');
  }
  assert.equal(nowLeftText(at(dow, nb.end + 7).clock), '7 min over');
  const first = nowBlocks(dow).find((x) => x.start >= nb.end);
  assert.equal(at(dow, nb.end + 2).next.id, first.id, 'the next block shows as Up next as usual');
  assert.equal(at(dow, cap).card.over, false, 'the cap ends it');
  assert.ok(!at(dow, cap).block || at(dow, cap).block.id !== nb.id);
  // the game is scored: nothing holds the card any more
  state.results[gb.games[0].id] = medals(T()[0], T()[1], T()[2]);
  assert.equal(at(dow, nb.end + 1).card.over, false);
  // a clock still running counts as live, a finished one does not
  delete state.results[gb.games[0].id];
  delete state.drafts[gb.games[0].id];
  state.clocks[gb.games[0].id] = { running: true, endAt: BASE_MS + (nb.end + 5) * 60000 + 600000 };
  assert.equal(at(dow, nb.end + 1).card.over, true);
  state.clocks[gb.games[0].id] = { running: true, endAt: BASE_MS };
  assert.equal(at(dow, nb.end + 1).card.over, false);
  // a bracket left behind by a format change is not live
  state.clocks = {};
  const g = gb.games[0];
  state.brackets[g.id] = { phase: 'round1', matches: [] };
  const fmt = g.format;
  g.format = 'tally';
  assert.equal(gameRowStatus(g, BASE_MS), 'todo', 'only a tournament counts its bracket');
  g.format = 'tournament';
  assert.equal(gameRowStatus(g, BASE_MS), 'live');
  g.format = fmt;
  done();
});

test('nowModel: "Still on this" — a director\'s word holds the card, +10 minutes a tap, never past the cap, display only', () => {
  boot('editor', null);
  const dow = WED;
  const gb = gamesBlockOf(dow, 1);
  const nb = gb.nb;
  const cap = nowGamesCap(nowBlocks(dow), nb);
  const key = dow + ':' + nb.id;
  // offered on the card the clock moved on to, while something is still to score; not when everything is scored
  let x = at(dow, nb.end + 1);
  assert.deepEqual(x.card.hold, { key, name: nb.head, can: true, held: false, cap });
  assert.equal(x.card.over, false);
  state.results[gb.games[0].id] = medals(T()[0], T()[1], T()[2]);
  gamesForBlock(dow, nb.b).forEach((g) => { state.results[g.id] = state.results[gb.games[0].id]; });
  assert.equal(at(dow, nb.end + 1).card.hold, null, 'every game is scored: nothing to hold');
  state.results = {};
  assert.equal(at(dow, nb.end - 1).card.hold, null, 'not before the block has ended');
  assert.equal(at(dow, cap).card.hold, null, 'not past the cap');
  // the word is a stamp in state.meta.overrun; it holds the card until its server time
  const ms0 = BASE_MS + (nb.end + 1) * 60000;
  state.meta.overrun = { key, until: ms0 + 4 * 60000 };
  x = at(dow, nb.end + 1);
  assert.equal(x.card.over, true);
  assert.equal(x.block.overrun.by, 'director');
  assert.equal(at(dow, nb.end + 4).card.over, true);
  assert.equal(at(dow, nb.end + 5).card.over, false, 'its time is up');
  assert.ok(at(dow, nb.end + 1).wake.includes(nb.end + 5), 'the minute it runs out is a wake-up');
  assert.equal(at(dow, nb.end + 1).card.hold.held, true);
  // somebody else's key, a junk stamp and a stamp for another day hold nothing
  state.meta.overrun = { key: dow + ':other', until: ms0 + 600000 };
  assert.equal(at(dow, nb.end + 1).card.over, false);
  state.meta.overrun = { key, until: 'soon' };
  assert.equal(at(dow, nb.end + 1).card.over, false);
  state.meta.overrun = 'junk';
  assert.equal(at(dow, nb.end + 1).card.over, false);
  // a tap writes one meta field, +10 minutes, and no other block moves
  delete state.meta.overrun;
  const opts = { now: { dow, minutes: nb.end + 1 }, ms: ms0 };
  const before = JSON.stringify(state.results) + JSON.stringify(state.config);
  assert.equal(nowHoldOverrun(opts), true);
  assert.deepEqual(state.meta.overrun, { key, until: ms0 + 600000 });
  assert.equal(JSON.stringify(state.results) + JSON.stringify(state.config), before);
  assert.equal(nowHoldOverrun(opts), true, 'each tap adds ten more');
  assert.equal(state.meta.overrun.until, ms0 + 1200000);
  let taps = 2;
  while (nowHoldOverrun(opts) && taps < 20) taps++;
  assert.ok(state.meta.overrun.until <= ms0 + (cap - (nb.end + 1)) * 60000, 'never past the cap');
  assert.equal(nowHoldOverrun(opts), false, 'at the cap there is nothing to add');
  assert.equal(at(dow, nb.end + 1).card.hold.can, false);
  // a counselor cannot tap; neither can a director who is only previewing
  delete state.meta.overrun;
  setMemberRole('viewer');
  assert.equal(nowHoldOverrun(opts), false);
  assert.equal(state.meta.overrun, undefined);
  setMemberRole('editor');
  counselorPreviewOn = true;
  assert.equal(nowHoldOverrun(opts), false);
  counselorPreviewOn = false;
  // the stamp rides the existing per-field meta diff (no whole-meta write)
  const up = computeSyncUpdates({ meta: {} }, { meta: { overrun: { key, until: 5 } } });
  assert.deepEqual(Object.keys(up), ['meta/overrun']);
  done();
});

test('nowModel: Up next and Later today — the first block starting at or after this one ends, then three; Sunday lists the whole day', () => {
  boot('viewer', T()[0]);
  const day = nowBlocks(1);
  const cur = day[2];
  const m = at(1, cur.start + 1);
  assert.equal(m.next.id, day.find((x) => x.start >= cur.end).id);
  assert.deepEqual(m.later.map((r) => r.id), day.slice(day.indexOf(day.find((x) => x.start >= cur.end)) + 1).slice(0, 3).map((x) => x.id));
  assert.equal(m.laterHeading, 'Later today');
  assert.equal(m.next.time, schedClock(m.next.start, false));
  // Tuesday's overlapping evening (a movie night over the wind-down): the card is the first block listed, Up next the one after it ends
  if (CAMP.id === 'junior') {
    const tue = nowBlocks(2);
    const movie = tue.find((x) => /movie night/i.test(x.head));
    const x = at(2, movie.start + 2);
    assert.equal(x.block.id, movie.id);
    assert.equal(x.next.start, movie.end, 'Up next skips what the movie night overlaps');
  }
  const sunDay = nowBlocks(0);
  const sun = at(0, sunDay[0].start + 1);
  assert.equal(sun.laterHeading, 'Today');
  const sunAfter = sunDay.find((x) => x.start >= sunDay[0].end);
  assert.equal(sun.later.length, sunDay.length - 1 - sunDay.indexOf(sunAfter), 'Sunday\'s run sheet is not cut at three rows');
  // the last block of the day has no Up next
  const lastBlock = nowBlocks(WED).slice(-1)[0];
  const end = at(WED, lastBlock.start + 1);
  assert.equal(end.next, null);
  assert.equal(end.later.length, 0);
  done();
});

test('nowModel: personalisation — my team on the rows, the morning meeting, the welcome, the notes under a title', () => {
  boot('viewer', T()[1]);
  stubRota();
  // Up next shows who is on cleanup after a meal; my team in bold words
  const lunch = nowBlocks(WED).find((x) => x.meal === 'Lunch');
  const before = nowBlocks(WED)[lunch.i - 1];
  let x = at(WED, before.start + 1);
  const rows = [x.next].concat(x.later);
  const row = rows.find((r) => r && r.id === lunch.id);
  assert.ok(row, 'lunch is within the next four rows of the block before it');
  assert.equal(row.sub.text, 'Your team is on cleanup');
  assert.equal(row.sub.mine, true);
  assert.equal(row.mine, true);
  state.followTeam = T()[3];
  x = at(WED, before.start + 1);
  const other = [x.next].concat(x.later).find((r) => r && r.id === lunch.id);
  assert.equal(other.sub.text, nowJoinNames([nowTeamWord(T()[1]), nowTeamWord(T()[2])]) + ' on cleanup');
  assert.equal(other.sub.mine, false);
  // the meal during: the dish, with its emoji, from mealFor
  const mealWord = lunch.head.toLowerCase();
  const dish = mealInfo(WED, lunch.b);
  if (dish) assert.deepEqual(at(WED, lunch.start + 1).body.dish, { emoji: dish.emoji || '', text: dish.dish });
  // the morning meeting (junior): the day's group of teams and "your team meets today"
  if (CAMP.id === 'junior') {
    const meeting = nowBlocks(2).find((b) => b.kind === 'meeting');
    assert.deepEqual(meeting.teams, ['t0', 't3', 't4'], 'Tuesday: Foxes, Pumpkins, Pilgrims');
    state.followTeam = 't0';
    x = at(2, meeting.start + 1);
    assert.equal(x.card.kind, 'meeting');
    assert.equal(x.card.sub, "Laura's cottage · Foxes, Pumpkins and Pilgrims");
    assert.equal(x.body.youMeet, true);
    assert.equal(at(1, nowBlocks(1).find((b) => b.kind === 'meeting').start + 1).body.youMeet, false, "Monday's group is the other three");
    assert.equal(x.card.title, 'Rising bell, shower & morning meeting');
  } else {
    const wake = nowBlocks(WED).find((b) => b.kind === 'meeting');
    assert.equal(at(WED, wake.start + 1).card.sub, null, 'a Wake up block is a plain card');
  }
  // Sunday's welcome for a counselor on a team; a label's note under the title
  state.followTeam = T()[0];
  const assign = nowBlocks(0).find((b) => /^team assignments/i.test(b.head));
  if (assign) {
    const w = at(0, assign.start + 1);
    assert.equal(w.card.kind, 'arrival');
    assert.equal(w.body.welcome.team, T()[0]);
    assert.deepEqual(w.body.welcome.meet, { title: assign.head, time: schedClock(assign.start, false), place: assign.place });
  }
  const camp = nowBlocks(1).find((b) => /^snack and campfire/i.test(b.head));
  if (camp) assert.ok(/^with [A-Z]/.test(at(1, camp.start + 1).card.sub), 'a name in the tail reads "with …"');
  const free = nowBlocks(1).find((b) => /^free time/i.test(b.head));
  if (free) assert.equal(at(1, free.start + 1).card.sub, 'Snack Shack open', 'a note in the tail is the sub');
  // the rain hint rides every card as plain data; the double-points line only the games card
  weatherData = { dates: [campDateStr()], byTime: {}, at: Date.now() };
  const h = Math.floor((nowBlocks(WED)[0].start + 5) / 60);
  weatherData.byTime[campDateStr() + 'T' + String(h).padStart(2, '0') + ':00'] = { temp: 60, code: 61, precip: 70 };
  // the clock is the model's argument: the hour comes from the minute asked for, never from the wall clock
  assert.deepEqual(at(WED, nowBlocks(WED)[0].start + 5).card.notes.filter((n) => n.kind === 'rain'), [{ kind: 'rain', text: '70% chance of rain this hour' }]);
  weatherData = null;
  done();
});

test('nowModel: electives (junior) — my station first, on break, the ask with no identity, every station for a director', () => {
  if (!CAMP.features.electives) {
    boot('viewer', T()[0]);
    for (let m = 0; m < 1440; m += 10) assert.ok(at(WED, m).card.kind !== 'elective', 'senior has no electives');
    done();
    return;
  }
  boot('viewer', 't0');
  const dow = 1;
  const blocks = nowBlocks(dow).filter((b) => b.kind === 'elective');
  assert.equal(blocks.length, 3);
  const slot0 = electivesFor(dow)[0];
  const row = slot0.find((r) => r[1].length > 1);
  const me = row[1][0];
  const mate = row[1][1];
  state.identity = me;
  state.followTeam = nowTeamOfName(me) || 't0';
  let x = at(dow, blocks[0].start + 3);
  assert.equal(x.card.kind, 'elective');
  assert.equal(x.card.tag, 'Elective 1');
  assert.equal(x.body.mode, 'station');
  assert.equal(x.card.title, row[0]);
  assert.deepEqual(x.card.lead, { text: 'Your station', change: me });
  assert.equal(x.card.sub, 'with ' + nowJoinNames(row[1].filter((n) => n !== me)));
  assert.equal(x.body.station.with.find((w) => w.name === mate).team, nowTeamOfName(mate));
  assert.equal(x.body.stations.find((s) => s.mine).station, row[0], 'the station list marks mine');
  assert.ok(x.body.then.length >= 1 && x.body.then.length <= 3);
  assert.ok(x.body.then.every((r) => !/^prepare/i.test(r.title)), '"Then" skips the preparing blocks');
  assert.equal(x.body.count.stations, slot0.length);
  // a later elective slot where I am on break
  const slotOf = (s) => electivesFor(dow)[s].find(electiveRowHasMe);
  const breakSlot = [0, 1, 2].find((s) => !slotOf(s));
  if (breakSlot !== undefined) {
    const b = at(dow, blocks[breakSlot].start + 1);
    assert.equal(b.body.mode, 'break');
    assert.equal(b.card.title, "You're on break");
    assert.equal(b.card.lead.text, 'Your station');
  }
  // the rows: my station on an elective row of Up next / Later today
  const before = nowBlocks(dow)[blocks[0].i - 1];
  const rowsNow = [at(dow, before.start + 1).next].concat(at(dow, before.start + 1).later).filter(Boolean);
  const er = rowsNow.find((r) => r.id === blocks[0].id);
  // The person's own answer is the row's title (mockup 03): their station, with the slot and who they are with under it, quiet.
  assert.ok(er && er.mine && er.title === row[0], 'the station is the title of my row');
  assert.equal(er.sub.text, 'Elective 1 · with ' + nowJoinNames(row[1].filter((n) => n !== me)));
  assert.equal(er.sub.mine, false, 'the sub is quiet: the title is the answer');
  // no identity yet: the ask, with the team's counselors; a skipped identity (null) and a director get every station
  state.identity = undefined;
  state.followTeam = 't0';
  x = at(dow, blocks[0].start + 3);
  assert.equal(x.body.mode, 'ask');
  assert.deepEqual(x.body.ask.names, teamRoster('t0'));
  assert.equal(x.card.title, 'Elective 1');
  assert.equal(x.card.lead, null);
  state.identity = null;
  assert.equal(at(dow, blocks[0].start + 3).body.mode, 'all');
  state.identity = 'Zed';
  assert.equal(at(dow, blocks[0].start + 3).body.mode, 'all', 'a name on no sheet says nothing about breaks');
  state.identity = undefined;
  setMemberRole('editor');
  assert.equal(at(dow, blocks[0].start + 3).body.mode, 'all', 'a director is not asked');
  assert.equal(at(dow, blocks[0].start + 3).body.stations.length, slot0.length);
  // the spelling merge: Lilly on this phone is Lily on the sheet
  state.identity = 'Lilly';
  const lily = [0, 1, 2].map((s) => electivesFor(dow)[s].find((r) => r[1].includes('Lily'))).find(Boolean);
  if (lily) assert.equal(at(dow, blocks[[0, 1, 2].findIndex((s) => electivesFor(dow)[s].includes(lily))].start + 1).body.mode, 'station');
  done();
});


test('nowModel: a games block — live first, then not started, then done, a podium of the medal winners, Score for directors only', () => {
  boot('viewer', T()[0]);
  const { nb, games } = gamesBlockOf(WED, 3);
  const [g0, g1, g2] = games;
  state.results[g0.id] = medals(T()[2], T()[1], T()[0]);
  state.drafts[g1.id] = { scores: { [T()[3]]: '9' } };
  let m = at(WED, nb.start + 10);
  assert.equal(m.card.kind, 'games');
  assert.deepEqual(m.body.rows.map((r) => r.id), [g1.id, g2.id, g0.id], 'live, not started, done');
  assert.deepEqual(m.body.rows.map((r) => r.status), ['live', 'todo', 'done']);
  assert.deepEqual(m.body.rows.map((r) => r.next), [false, true, false], 'the first not-started game says up next');
  const done0 = m.body.rows[2];
  assert.deepEqual(done0.podium.map((c) => [c.place, c.team, c.mine]), [[1, T()[2], false], [2, T()[1], false], [3, T()[0], true]]);
  assert.equal(done0.mine, true, 'my team is on the podium');
  assert.ok(/^finished /.test(done0.line));
  assert.equal(m.body.rows[1].podium, null);
  assert.ok(m.body.rows.every((r) => r.score === null), 'a counselor has no Score');
  assert.equal(m.body.stillToScore, null);
  assert.equal(m.card.sub, null, 'a counselor is not told how many are left to score');
  // a placement game being judged says so and shows nobody the picked teams (a tally game with live rankings has its board)
  if (g1.format === 'placement') {
    assert.equal(m.body.rows[0].board, null);
    assert.equal(m.body.rows[0].line, 'Being scored');
  } else assert.ok(m.body.rows[0].line === 'Being scored' || (m.body.rows[0].board && m.body.rows[0].board.kind === 'tally'));
  // a junk result (a team the camp does not have) keeps only the medals it can name
  state.results[g0.id] = { medals: { gold: 'zz', silver: T()[1], bronze: 7 }, savedAt: 'x' };
  assert.deepEqual(at(WED, nb.start + 10).body.rows[2].podium.map((c) => c.team), [T()[1]]);
  state.results[g0.id] = medals(T()[2], T()[1], T()[0]);
  // a director: Score on every row that is not done, ONE gold (the live game's: §8.1 rule 3), "2 of 3 games still to score"
  setMemberRole('editor');
  m = at(WED, nb.start + 10);
  assert.equal(m.body.stillToScore, 2);
  assert.equal(m.card.sub, '2 of 3 games still to score');
  assert.deepEqual(m.body.rows.map((r) => r.score && r.score.gold), [true, false, null], 'one gold Score: the live game; the one up next is outlined');
  assert.ok(m.body.rows.every((r) => !r.score || r.score.why === null), 'a placement or tally game is not guarded at the game level');
  state.results[g1.id] = medals(T()[0], T()[1], T()[2]);
  state.results[g2.id] = medals(T()[0], T()[1], T()[2]);
  assert.equal(at(WED, nb.start + 10).body.stillToScore, 0);
  assert.equal(at(WED, nb.start + 10).card.sub, null);
  done();
});

test('nowModel: a live tally is in roster order for a counselor and ranked for a director; a live match is the pair and the next pair', () => {
  boot('viewer', T()[0]);
  const { nb, games } = gamesBlockOf(WED, 2);
  const g = games[0];
  const keep = { format: g.format, liveRankings: g.liveRankings, lowerWins: g.lowerWins, timeInput: g.timeInput };
  Object.assign(g, { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false });
  state.drafts[g.id] = { scores: { [T()[3]]: '9', [T()[0]]: '4', [T()[1]]: '12' } };
  let b = at(WED, nb.start + 1).body.rows.find((r) => r.id === g.id).board;
  assert.equal(b.kind, 'tally');
  assert.equal(b.ranked, false);
  assert.equal(b.cap, '3 of ' + T().length + ' in');
  assert.deepEqual(b.rows.map((r) => r.team), [T()[0], T()[1], T()[3]], 'roster order: the leader is not shown');
  assert.deepEqual(b.rows.map((r) => r.v), ['4', '12', '9'], 'the scores themselves are public');
  assert.ok(b.rows.every((r) => !('place' in r)));
  assert.equal(b.rows[0].mine, true);
  setMemberRole('editor');
  b = at(WED, nb.start + 1).body.rows.find((r) => r.id === g.id).board;
  assert.equal(b.ranked, true);
  assert.deepEqual(b.rows.map((r) => r.team), [T()[1], T()[3], T()[0]], 'a director sees the order');
  assert.deepEqual(b.rows.map((r) => r.place), [1, 2, 3]);
  // a bracket game: the pair playing, my team outlined, the next pair when the order is fixed
  delete state.drafts[g.id];
  Object.assign(g, { format: 'tournament', liveRankings: false, roundOneMatchups: [[T()[0], T()[1]], [T()[2], T()[3]], [T()[3], T()[1]]] });
  state.brackets[g.id] = { phase: 'round1', matches: [] };
  setMemberRole('viewer');
  let row = at(WED, nb.start + 1).body.rows.find((r) => r.id === g.id);
  assert.equal(row.status, 'live');
  assert.equal(row.board.kind, 'match');
  assert.deepEqual(row.board.sides.map((x) => x.team), [T()[0], T()[1]]);
  assert.deepEqual(row.board.sides.map((x) => x.mine), [true, false]);
  assert.equal(row.board.cap, 'Round 1');
  assert.deepEqual(row.board.next, [T()[2], T()[3]]);
  assert.equal(row.mine, true);
  // "Foxes play first" on the Up next row of the block before it, when my team is in the first matchup
  const before = nowBlocks(WED)[nb.i - 1];
  const pre = at(WED, before.start + 1);
  const hit = [pre.next].concat(pre.later).find((r) => r && r.id === nb.id);
  if (hit) assert.ok(/play first/.test(hit.sub.text) && hit.sub.mine, hit.sub.text);
  // a director on a team in the live round is told, in place of Score, that another director scores it
  setMemberRole('editor');
  setMemberTeam(T()[0]);
  row = at(WED, nb.start + 1).body.rows.find((r) => r.id === g.id);
  assert.deepEqual(row.score, { gold: true, why: 'Your team plays · another director scores' });
  setMemberTeam(T()[4] || T()[3]);
  assert.equal(at(WED, nb.start + 1).body.rows.find((r) => r.id === g.id).score.why, null);
  Object.assign(g, keep);
  done();
});

test('nowModel: the four-team bracket reads state.brackets4 (Step 22\'s shape) as four cells, derives 3rd place and the final, and tells my team what is next', () => {
  boot('viewer', T()[0]);
  const { nb, games } = gamesBlockOf(WED, 1);
  const g = games[0];
  g.format = 'tournament';
  assert.equal(nowBracket4(nowCtx(), g), null, 'no such bracket: nothing');
  state.brackets4 = { [g.id]: { at: 1, m: { s1: { a: T()[0], b: T()[1], winner: T()[0] }, s2: { a: T()[2], b: T()[3] } } } };
  assert.equal(gameRowStatus(g, BASE_MS), 'live');
  let b = at(WED, nb.start + 1).body.bracket4;
  assert.deepEqual(b.cells.map((c) => [c.slot, c.status, c.next]), [['s1', 'done', false], ['s2', 'live', false], ['third', 'todo', true], ['final', 'todo', false]]);
  assert.deepEqual(b.cells[0].teams.map((t) => [t.team, t.won, t.lost, t.mine]), [[T()[0], true, false, true], [T()[1], false, true, false]]);
  assert.deepEqual(b.cells[2].teams.map((t) => [t.team, t.tbd]), [[T()[1], ''], ['', 'Semifinal 2 loser']], 'third place: the semifinal losers, as far as they are known');
  assert.deepEqual(b.cells[3].teams.map((t) => [t.team, t.tbd]), [[T()[0], ''], ['', 'Semifinal 2 winner']]);
  assert.equal(b.note.rest, ' plays in the final next · 3rd place match first');
  assert.equal(b.note.mine, true);
  const card = at(WED, nb.start + 1).card;
  assert.ok(card.notes.some((n) => n.kind === 'team' && /3rd place match first/.test(n.rest)));
  const b4row = at(WED, nb.start + 1).body.rows.find((r) => r.id === g.id);
  assert.equal(b4row.status, 'live');
  assert.equal(b4row.line, 'Semifinal 2', 'the match under way, named as its cell is');
  setMemberRole('editor');
  setMemberTeam(T()[2]);
  assert.equal(at(WED, nb.start + 1).body.rows.find((r) => r.id === g.id).score.why, 'Your team plays · another director scores', 'own-team guard per match');
  setMemberTeam(T()[0]);
  assert.equal(at(WED, nb.start + 1).body.rows.find((r) => r.id === g.id).score.why, null, 'the director\'s team is not in the match under way');
  setMemberTeam(null);
  setMemberRole('viewer');
  state.followTeam = T()[1];
  assert.equal(at(WED, nb.start + 1).body.bracket4.note.rest, ' plays the 3rd place match next');
  state.followTeam = T()[2];
  assert.equal(at(WED, nb.start + 1).body.bracket4.note.rest, ' plays in semifinal 2');
  state.followTeam = T()[0];
  state.brackets4[g.id].m.s2.winner = T()[3];
  b = at(WED, nb.start + 1).body.bracket4;
  assert.deepEqual(b.cells.map((c) => c.status), ['done', 'done', 'live', 'todo']);
  assert.deepEqual(b.cells[3].teams.map((t) => t.team), [T()[0], T()[3]]);
  assert.deepEqual(b.cells[2].teams.map((t) => t.team), [T()[1], T()[2]]);
  // junk never throws and never names a team the camp does not have
  state.brackets4 = { [g.id]: { m: { s1: { a: 'zz', b: T()[1], winner: 'zz' }, s2: 'x' } } };
  assert.equal(at(WED, nb.start + 1).body.bracket4, null, 'a bracket this build cannot read (fourRead) shows nothing, and never a team the camp does not have');
  assert.equal(gameRowStatus(g, BASE_MS), 'todo', 'and it is not a live game');
  // a recorded match that disagrees with its semifinals: nothing is live and no team is told what is next, until a director settles it
  state.brackets4 = { [g.id]: { m: { s1: { a: T()[0], b: T()[1], winner: T()[0] }, s2: { a: T()[2], b: T()[3], winner: T()[2] }, third: { a: T()[1], b: T()[3], winner: T()[1] } } } };
  state.followTeam = T()[0];
  state.brackets4[g.id].m.s1.winner = T()[1]; // someone changed the first semifinal after the 3rd-place match was played
  b = at(WED, nb.start + 1).body.bracket4;
  assert.equal(b.hold, true);
  assert.ok(b.cells.every((c) => c.status !== 'live') && b.note === null);
  state.brackets4 = { [g.id]: { m: [] } };
  assert.equal(at(WED, nb.start + 1).body.bracket4, null);
  state.brackets4 = { [g.id]: 'junk' };
  assert.equal(at(WED, nb.start + 1).body.bracket4, null);
  delete state.brackets4;
  done();
});


// ════════════════════════════════════════════════════════════════════
// the messages strip, Still to do today, the tick
// ════════════════════════════════════════════════════════════════════
function banner(id, text, agoMs) {
  state.announcements[id] = { id, text, at: new Date(Date.now() - agoMs).toISOString(), by: 'Jenn', ttlMs: 3600000 };
}

test('nowModel: the messages strip — the posted notice with my team\'s line, the join bar for a director, banners newest first', () => {
  boot('viewer', T()[0]);
  assert.deepEqual(at(WED, 600).messages, [], 'a draft notice and no banners: nothing');
  state.notice.status = 'posted';
  state.notice.title = 'Saturday cleanup';
  state.notice.sub = 'Everyone helps';
  state.notice.zones = [{ teamId: T()[0], place: 'Dining hall', note: 'tables and floor' }, { teamId: T()[1], place: 'Chapel', note: '' }];
  banner('a1', 'Lunch is in the pavilion', 5 * 60000);
  banner('a2', 'Bring a hat', 1 * 60000);
  banner('a3', 'Old news', 20 * 60000);
  const realChat = chatMsgs.announcements;
  chatMsgs.announcements = [{ id: 'c1', at: Date.now() - 3 * 60000, byKey: 'x', text: 'Cabin 3 has a surprise' }, { id: 'c0', at: Date.now() - 20 * 60 * 1000, byKey: 'x', text: 'too old for the strip' }];
  let m = at(WED, 600);
  assert.deepEqual(m.messages.map((x) => x.kind + ':' + (x.id || x.key)), ['notice:notice', 'banner:a2', 'chat:c1', 'banner:a1', 'banner:a3']);
  assert.deepEqual(m.messages[0], { kind: 'notice', key: 'notice', title: 'Saturday cleanup', sub: 'Everyone helps', yours: { team: T()[0], place: 'Dining hall', note: 'tables and floor' }, canTakeDown: false });
  assert.ok(m.messages.slice(1).every((x) => x.canRemove === false), 'a counselor removes nothing');
  assert.equal(m.messages[2].text, 'Cabin 3 has a surprise');
  // a phone that dismissed one does not see it again
  dismissAnnouncement('a2');
  assert.deepEqual(at(WED, 600).messages.map((x) => x.id || x.key), ['notice', 'c1', 'a1', 'a3']);
  // a director: Take down on the notice, Remove for everyone on a synced banner (never a chat one), the join bar between
  setMemberRole('editor');
  pplReq.list = [{ key: 'new@x', at: 1, name: 'Taylor Reed' }];
  m = at(WED, 600);
  assert.deepEqual(m.messages.map((x) => x.kind), ['notice', 'join', 'chat', 'banner', 'banner']);
  assert.equal(m.messages[0].canTakeDown, true);
  assert.equal(m.messages[1].text, 'Taylor Reed is asking to join');
  assert.deepEqual(m.messages.filter((x) => x.kind !== 'notice' && x.kind !== 'join').map((x) => x.canRemove), [false, true, true]);
  pplReq.list = [{ key: 'a', at: 1, name: 'A' }, { key: 'b', at: 2, name: 'B' }];
  assert.equal(at(WED, 600).messages[1].text, '2 people are asking to join');
  pplReq.list = [];
  // an expired banner never shows, a banner with a missing text is not a message
  state.announcements.a1.at = new Date(Date.now() - 2 * 3600000).toISOString();
  state.announcements.junk = { id: 'junk', at: new Date().toISOString() };
  assert.ok(!at(WED, 600).messages.some((x) => x.id === 'a1' || x.id === 'junk'));
  // the model leaves the notice out of the strip when it IS the card
  state.notice.status = 'draft';
  assert.ok(!at(WED, 600).messages.some((x) => x.kind === 'notice'));
  chatMsgs.announcements = realChat;
  dismissAnnouncement('a2');
  done();
});

test('nowModel: Still to do today — what the day\'s moments left, for directors, oldest first, three rows then "N more"', () => {
  boot('editor', null);
  stubRota();
  const gb = gamesBlockOf(WED, 3);
  const nb = gb.nb;
  const ids = gb.games.map((g) => g.id);
  // the morning's moments are done (verse for everyone, breakfast cleanup), so only the games can be left: the list holds three rows
  const give = () => {
    T().forEach((id) => { state.bonuses['verse-' + id + '-3'] = { teamId: id, category: 'verse', points: 1, day: 3, at: new Date(BASE_MS).toISOString() }; });
    state.bonuses['cleanup-t0-3-Breakfast'] = { teamId: T()[0], category: 'cleanup', points: 2, day: 3, meal: 'Breakfast', at: new Date(BASE_MS).toISOString() };
  };
  give();
  // before the block ends: no game row; after: one row per game with no result, opening that game
  assert.ok(!at(WED, nb.end - 1).todo.some((r) => r.todo === 'game'));
  let m = at(WED, nb.end + 1);
  assert.deepEqual(m.todo.filter((r) => r.todo === 'game').map((r) => r.ref).sort(), ids.slice().sort());
  const r0 = m.todo.find((r) => r.todo === 'game');
  assert.equal(r0.sub, 'Not scored yet');
  assert.equal(r0.key, 'todo-game-' + r0.ref);
  state.results[ids[0]] = medals(T()[0], T()[1], T()[2]);
  assert.ok(!at(WED, nb.end + 1).todo.some((r) => r.ref === ids[0]), 'scored: gone');
  // the breakfast cleanup, once its window is over with no points; the director's own team cannot be awarded by them
  state.bonuses = {};
  const bf = nowBlocks(WED).find((x) => x.meal === 'Breakfast');
  assert.ok(!at(WED, bf.end + 29).todo.some((r) => r.todo === 'cleanup'), 'still inside the window');
  m = at(WED, bf.end + 30);
  const c = m.todo.find((r) => r.todo === 'cleanup' && r.ref === 'Breakfast');
  assert.ok(c, 'the window is over');
  assert.equal(c.title, 'Breakfast cleanup points');
  assert.equal(c.sub, nowTeamWord(T()[0]) + ' · Not given yet');
  assert.equal(c.key, 'todo-cleanup-3-breakfast');
  state.bonuses['cleanup-t0-3-Breakfast'] = { teamId: T()[0], category: 'cleanup', points: 2, day: 3, meal: 'Breakfast', at: new Date(BASE_MS).toISOString() };
  assert.ok(!at(WED, bf.end + 30).todo.some((r) => r.ref === 'Breakfast'), 'given: gone');
  delete state.bonuses['cleanup-t0-3-Breakfast'];
  setMemberTeam(T()[0]);
  assert.ok(!at(WED, bf.end + 30).todo.some((r) => r.ref === 'Breakfast'), 'a team the director is on is another director\'s to award');
  setMemberTeam(null);
  // Bible study: nobody given → "Not given yet", some → "N of M teams given", all → gone
  const bible = nowBlocks(WED).find((x) => x.kind === 'bible');
  assert.ok(!at(WED, bible.end - 1).todo.some((r) => r.todo === 'verse'));
  assert.equal(at(WED, bible.end).todo.find((r) => r.todo === 'verse').sub, 'Not given yet');
  state.bonuses['verse-t0-3'] = { teamId: T()[0], category: 'verse', points: 3, day: 3, at: new Date(BASE_MS).toISOString() };
  state.bonuses['verse-t1-3'] = { teamId: T()[1], category: 'verse', points: 5, day: 3, at: new Date(BASE_MS).toISOString() };
  assert.equal(at(WED, bible.end).todo.find((r) => r.todo === 'verse').sub, '2 of ' + T().length + ' teams given');
  T().forEach((id) => { state.bonuses['verse-' + id + '-3'] = { teamId: id, category: 'verse', points: 1, day: 3, at: new Date(BASE_MS).toISOString() }; });
  assert.ok(!at(WED, bible.end).todo.some((r) => r.todo === 'verse'));
  state.bonuses = {};
  // the weekend is no competition: no cleanup or verse rows
  assert.ok(!at(0, 23 * 60).todo.some((r) => r.todo === 'cleanup' || r.todo === 'verse'));
  // people asking to join close the list: with everything else done the join row is the whole list
  gamesForDay(WED).forEach((x) => x.games.forEach((g) => { state.results[g.id] = medals(T()[0], T()[1], T()[2]); }));
  give();
  state.bonuses['cleanup-t1-3-Lunch'] = { teamId: T()[1], category: 'cleanup', points: 1, day: 3, meal: 'Lunch', at: new Date(BASE_MS).toISOString() };
  state.bonuses['cleanup-t2-3-Lunch'] = { teamId: T()[2], category: 'cleanup', points: 1, day: 3, meal: 'Lunch', at: new Date(BASE_MS).toISOString() };
  assert.deepEqual(at(WED, 23 * 60).todo, [], 'a finished day leaves nothing to do');
  pplReq.list = [{ key: 'new@x', at: 1, name: 'Taylor Reed' }];
  assert.deepEqual(at(WED, 23 * 60).todo, [{ key: 'todo-join', todo: 'join', ref: '', title: 'Taylor Reed is asking to join', sub: 'People' }]);
  pplReq.list = [];
  // no overflow beyond three
  state.bonuses = {};
  state.results = {};
  const many = at(WED, 23 * 60);
  assert.equal(many.todo.length, 3);
  assert.ok(many.todoMore >= 1);
  // not for a counselor, a preview, or (points rows) a director who is not confirmed yet
  setMemberRole('viewer');
  assert.deepEqual([at(WED, 23 * 60).todo, at(WED, 23 * 60).todoMore], [[], 0]);
  setMemberRole('editor');
  counselorPreviewOn = true;
  assert.deepEqual([at(WED, 23 * 60).todo, at(WED, 23 * 60).todoMore], [[], 0]);
  counselorPreviewOn = false;
  setMemberRole('editor', { provisional: true });
  setStandingsGuardThrows(true);
  const hint = at(WED, 23 * 60);
  assert.ok(hint.todo.every((r) => r.todo === 'game'), 'a hinted director gets the unscored games and reads no points');
  setStandingsGuardThrows(false);
  done();
});

test('nowModel: the tick — a full picture at a wake-up or a new day, otherwise the clock part and the strip; nothing without a renderer', () => {
  boot('viewer', T()[0]);
  const calls = [];
  const realNow = nowModel;
  renderNow = (m) => calls.push('full');
  renderNowClock = (m) => calls.push('clock:' + m.clock.left);
  renderNowMessages = (m) => calls.push('messages');
  const tick = (dow, minutes) => nowTick({ now: { dow, minutes }, ms: BASE_MS + minutes * 60000 });
  // a block with no wake-up inside it (no full hour, no window's end), so only its end is one
  const nb = nowBlocks(WED).find((b) => !b.noTime && b.end - b.start >= 5 && at(WED, b.start + 1).wake[0] === b.end);
  assert.ok(nb, 'a block with nothing inside');
  assert.equal(tick(WED, nb.start + 1), 'full', 'the first tick paints the whole picture');
  assert.deepEqual(calls.splice(0), ['full']);
  assert.equal(tick(WED, nb.start + 1), 'clock');
  assert.deepEqual(calls.splice(0), ['clock:' + (nb.end - nb.start - 1), 'messages']);
  assert.equal(tick(WED, nb.start + 2), 'clock', 'a minute later inside the block: only the clock');
  assert.deepEqual(calls.splice(0), ['clock:' + (nb.end - nb.start - 2), 'messages']);
  assert.equal(nowLast.clock.left, nb.end - nb.start - 2);
  assert.equal(tick(WED, nb.end - 1), 'clock');
  calls.length = 0;
  assert.equal(tick(WED, nb.end), 'full', 'the block ends: a new card');
  assert.deepEqual(calls.splice(0), ['full']);
  assert.equal(tick(WED + 1, nb.end), 'full', 'a new day');
  calls.length = 0;
  assert.equal(tick(WED + 1, nb.end - 5), 'full', 'the clock went back (a ?now= preview was changed)');
  calls.length = 0;
  // a banner whose time is up leaves the strip on a clock tick (no wake-up needed)
  banner('b1', 'short lived', 0);
  state.announcements.b1.ttlMs = 61 * 1000;
  assert.equal(tick(WED + 1, nb.end - 5), 'clock');
  // the shell's panels call it only when a renderer exists
  let n = 0;
  nowModel = (o) => { n++; return realNow(o); };
  const realCampNowFn = campNow;
  campNow = () => ({ dow: WED, minutes: nb.start + 1 });
  nowLast = null;
  calls.length = 0;
  SHELL_PANELS.now.render();
  assert.equal(n, 1, 'render: a full picture');
  assert.ok(calls.includes('full'));
  SHELL_PANELS.now.tick();
  assert.equal(n, 1, 'the tick, a moment later in the same minute: the clock part only');
  renderNow = undefined; renderNowClock = undefined; renderNowMessages = undefined;
  n = 0;
  SHELL_PANELS.now.render();
  SHELL_PANELS.now.tick();
  assert.equal(n, 0, 'without a renderer the model is never computed: the page is as it was');
  campNow = realCampNowFn;
  nowModel = realNow;
  done();
});

test('nowModel: a live reveal is named so the renderer can put the rest away, and the model reads nothing of it', () => {
  boot('viewer', T()[0]);
  assert.equal(at(WED, 600).reveal, null);
  const realLive = revealLiveView;
  revealLiveView = () => ({ live: true, rows: [{ secret: 'never read' }] });
  const m = at(WED, 600);
  assert.deepEqual(m.reveal, { live: true });
  assert.ok(JSON.stringify(m).indexOf('never read') < 0);
  revealLiveView = realLive;
  done();
});


test('nowModel: whatever a snapshot hands back (junk results, brackets, drafts, clocks, meta, banners), the model never throws', () => {
  boot('editor', T()[0]);
  stubRota();
  const gb = gamesBlockOf(WED, 3);
  const [g0, g1, g2] = gb.games;
  const junk = [null, 'z', 5, [], [1], {}, { medals: null }, { medals: 'x' }, { medals: { gold: {} } }, { scores: 'abc', medals: [] }];
  junk.forEach((a, i) => {
    state.results = { [g0.id]: a, [g1.id]: junk[(i + 3) % junk.length] };
    state.drafts = { [g2.id]: junk[(i + 5) % junk.length] };
    state.brackets = { [g1.id]: junk[(i + 1) % junk.length] };
    state.brackets4 = { [g0.id]: junk[(i + 2) % junk.length], [g2.id]: { m: { s1: junk[i], s2: { a: [], b: {}, winner: 5 }, third: 'x', final: null } } };
    state.clocks = { [g1.id]: junk[(i + 4) % junk.length] };
    state.meta.overrun = junk[(i + 6) % junk.length];
    state.announcements = { a: junk[i], b: { id: 'b', text: 5, at: 'never' } };
    state.bonuses = { x: junk[i] === null ? {} : junk[i], y: { category: 'verse', day: 'x', points: 'y' } };
    [g0, g1, g2].forEach((g) => { g.format = ['tournament', 'tally', 'placement'][i % 3]; });
    [[WED, gb.nb.start + 1], [WED, gb.nb.end + 3], [WED, 12 * 60 + 40], [WED, 8 * 60 + 40], [2, 8 * 60 + 5], [6, 11 * 60], [0, 15 * 60]].forEach(([d, m]) => {
      assert.doesNotThrow(() => { JSON.stringify(at(d, m)); }, `junk ${i} at ${d}:${m}`);
    });
  });
  // a day, a week and a notice that are not what the code expects
  state.notice = { status: 'posted', zones: 'x', steps: [null, 5, { items: [1] }], title: 7 };
  assert.doesNotThrow(() => at(6, 9 * 60 + 40));
  state.teams = [];
  assert.doesNotThrow(() => at(WED, 12 * 60 + 40));
  done();
});


// ════════════════════════════════════════════════════════════════════
// What counselors see (More → Director): a section the directors switched off is not on Now either
// ════════════════════════════════════════════════════════════════════
var HIDDEN_ALL = () => ({ competitions: true, verse: true, cleanup: true, chat: true });

// A counselor's model with every switch off, every 5th minute of the week: no games card, rows or podium (a games block is a plain
// activity), no verse (Bible study is a plain activity), no cleanup line, note or moment — and nothing else about the day changes.
function walkHidden(label) {
  stubRota();
  const gb = gamesBlockOf(WED, 3);
  state.results[gb.games[0].id] = medals(T()[2], T()[1], T()[0]);
  state.drafts[gb.games[1].id] = { scores: { [T()[3]]: '9' } };
  state.meta.hiddenCards = HIDDEN_ALL();
  let games = 0; let verses = 0; let meals = 0;
  DOWS.forEach((dow) => {
    for (let m = 0; m < 1440; m += 5) {
      const x = at(dow, m);
      const where = `${label} dow ${dow} minute ${m}`;
      assert.ok(x.card.kind !== 'games', where + ': a games card');
      assert.ok((x.body.rows || []).every((r) => !('status' in r)) && !x.body.stillToScore && !x.body.bracket4 && !('total' in x.body), where + ': game rows (a run row has no status)');
      assert.ok(!x.card.notes.some((n) => n.kind === 'double'), where + ': the double-points note belongs to a games card');
      assert.equal(x.card.over, false, where + ': "Running over" is a games card\'s');
      assert.equal(x.moment, null, where + ': a moment (the cleanup panel is switched off; the verse keys are a director\'s)');
      assert.ok(!x.body.verse, where + ': a verse');
      assert.ok(!x.body.duty || x.body.duty.length === 0, where + ': cleanup duty');
      assert.ok(!x.card.notes.some((n) => n.kind === 'team' && /cleanup/.test(n.rest || '')), where + ': a cleanup note');
      [x.next].concat(x.later, x.body.then || [], x.body.rows || []).filter(Boolean).forEach((r) => {
        assert.ok(!r.sub || !/on cleanup|play first| and \d+ more$/.test(r.sub.text), where + ': a row says ' + (r.sub && r.sub.text));
        assert.ok(r.kind !== 'games', where + ': a games row');
      });
      if (x.block && nowBlocks(dow).find((b) => b.id === x.block.id && b.b.type === 'games')) games++;
      if (x.block && x.block.kind === 'activity' && /bible/i.test(x.block.title)) verses++;
      if (x.card.kind === 'meal') meals++;
    }
  });
  assert.ok(games > 0 && meals > 0, 'the walk met a games block and a meal: ' + games + ' / ' + meals);
  return verses;
}

test('nowModel: with Games, Memory verse and Meal cleanup switched off a counselor\'s Now shows none of them, and a director\'s own Now shows all', () => {
  boot('viewer', T()[0]);
  setMemberTeam(T()[0]);
  const verses = walkHidden('counselor');
  state.drafts = {}; // the walk left a game live (a live game past its block holds the card, and a held card has no moment)
  // Bible study is the plain card (a verse needs its switch)
  assert.ok(verses > 0 || !nowBlocks(WED).some((b) => b.kind === 'bible'), 'Bible study drew as an activity');
  // the same week, switched ON for a director: the model is what it was before any switch existed
  const gb = gamesBlockOf(WED, 1);
  const lunch = nowBlocks(WED).find((x) => x.kind === 'meal' && x.meal === 'Lunch');
  const bible = nowBlocks(WED).find((x) => x.kind === 'bible');
  setMemberRole('editor');
  const sig = (hid) => { state.meta.hiddenCards = hid; return [at(WED, gb.nb.start + 1), at(WED, lunch.end + 1), at(WED, (bible ? bible.start : 540) + 3)].map(sigOf).join('|'); };
  assert.equal(sig({ competitions: true, verse: true, cleanup: true }), sig({}), 'a director is shown every section whatever the switches say');
  state.meta.hiddenCards = { competitions: true, verse: true, cleanup: true };
  assert.equal(at(WED, gb.nb.start + 1).card.kind, 'games');
  assert.ok(at(WED, lunch.end + 1).moment && at(WED, lunch.end + 1).moment.kind === 'cleanup');
  // one switch at a time: Games off leaves the verse and the cleanup alone, and the other way round
  setMemberRole('viewer');
  state.meta.hiddenCards = { competitions: true };
  assert.equal(at(WED, gb.nb.start + 1).card.kind, 'activity');
  assert.ok(at(WED, lunch.end + 1).moment, 'cleanup is still shown');
  state.meta.hiddenCards = { cleanup: true };
  assert.equal(at(WED, gb.nb.start + 1).card.kind, 'games', 'Games is still shown');
  assert.equal(at(WED, lunch.end + 1).moment, null);
  if (bible && verseFor(WED) && String(verseFor(WED).text || verseFor(WED).ref || '').trim()) {
    state.meta.hiddenCards = { verse: true };
    assert.equal(at(WED, bible.start + 3).card.kind, 'activity');
    state.meta.hiddenCards = {};
    assert.equal(at(WED, bible.start + 3).card.kind, 'bible');
  }
  done();
});

test('nowModel: a counselor PREVIEW honours the switches as a counselor\'s phone does; leaving it gives the director every section back', () => {
  boot('editor', null);
  state.meta.hiddenCards = HIDDEN_ALL();
  stubRota();
  const gb = gamesBlockOf(WED, 1);
  assert.equal(at(WED, gb.nb.start + 1).card.kind, 'games');
  counselorPreviewOn = true;
  assert.equal(at(WED, gb.nb.start + 1).card.kind, 'activity');
  assert.ok(!('total' in at(WED, gb.nb.start + 1).body), 'no game rows');
  counselorPreviewOn = false;
  assert.equal(at(WED, gb.nb.start + 1).card.kind, 'games');
  done();
});

test('nowModel: a game on a hidden Games card is not held, offered or named: no "Running over", no hold, no Up next game names', () => {
  boot('viewer', T()[0]);
  const gb = gamesBlockOf(WED, 1);
  state.drafts[gb.games[0].id] = { scores: { [T()[0]]: '3' } };
  assert.equal(at(WED, gb.nb.end + 2).card.over, true, 'visible: the live game holds the card');
  state.meta.hiddenCards = { competitions: true };
  const x = at(WED, gb.nb.end + 2);
  assert.equal(x.card.over, false);
  assert.ok(!x.block || x.block.id !== gb.nb.id, 'the clock moved on: a hidden section holds nothing');
  const before = nowBlocks(WED)[gb.nb.i - 1];
  if (before) assert.ok(!/ and \d+ more|play first/.test(((at(WED, before.start + 1).next || {}).sub || {}).text || ''), 'Up next names no game');
  done();
});

// ════════════════════════════════════════════════════════════════════
// A director's second, view-only tab (canEdit() false, the person still a confirmed director)
// ════════════════════════════════════════════════════════════════════
test('nowModel: the cleanup moment in a director\'s view-only second tab says only whose turn it is — no keys, no lock, no points — as the verse moment does', () => {
  boot('editor', null);
  stubRota();
  const lunch = nowBlocks(WED).find((x) => x.kind === 'meal' && x.meal === 'Lunch');
  const writer = at(WED, lunch.end + 2).moment;
  assert.ok(writer && writer.secret === true && writer.max === 3 && writer.teams.every((t) => t.locked === false && t.pts === 0), 'a writer tab has the keys');
  const realTab = tabWriter;
  try {
    tabWriter = false;
    assert.equal(canEdit(), false);
    assert.equal(standingsVisible(), true, 'the person is still a director');
    const ro = at(WED, lunch.end + 2).moment;
    assert.ok(ro && ro.kind === 'cleanup' && ro.teams.length === writer.teams.length, 'whose turn it is still shows');
    assert.ok(ro.secret === undefined && ro.max === undefined, 'no secret line, no keys');
    assert.ok(ro.teams.every((t) => !('locked' in t) && !('pts' in t)), 'no lock and no points on a row');
    const bible = nowBlocks(WED).find((x) => x.kind === 'bible');
    if (bible) { const vm = at(WED, bible.start + 3).moment; assert.ok(!vm || vm.kind === 'cleanup', 'the verse moment is not there either'); }
  } finally { tabWriter = realTab; }
  done();
});

// ════════════════════════════════════════════════════════════════════
// A games block held past the start of the next block
// ════════════════════════════════════════════════════════════════════
test('nowModel: while a games block is held, Up next is the first block that has NOT ended — one already under way says so — and Later today follows it', () => {
  boot('viewer', T()[0]);
  let crossed = 0;
  DOWS.forEach((dow) => {
    const day = nowBlocks(dow);
    day.filter((x) => x.kind === 'games' && !x.noTime && gamesForBlock(dow, x.b).length).forEach((nb) => {
      const g = gamesForBlock(dow, nb.b)[0];
      state.drafts = { [g.id]: { scores: { [T()[0]]: '3' } } }; // a live game holds the card
      const cap = nowGamesCap(day, nb);
      for (let m = nb.end; m < cap; m++) {
        const x = at(dow, m);
        const where = `dow ${dow} ${nb.head} minute ${m}`;
        assert.equal(x.card.over, true, where);
        const after = day.slice(day.indexOf(nb) + 1).find((b) => b.end > m);
        if (!after) { assert.equal(x.next, null, where); continue; }
        assert.equal(x.next && x.next.id, after.id, where + ': Up next is the first block not yet ended');
        assert.ok(x.next.start >= 0 && after.end > m, where);
        const started = after.start <= m;
        assert.equal(/^Already started/.test((x.next.sub && x.next.sub.text) || ''), started, where + ': "Already started" exactly when it is under way');
        assert.ok(x.later.every((r) => day.find((b) => b.id === r.id).start > day.find((b) => b.id === after.id).start - 1 && r.id !== after.id), where + ': Later today follows Up next');
        assert.ok(x.later.every((r) => day.find((b) => b.id === r.id).end > m), where + ': nothing that has ended');
        assert.ok(x.card.sub.indexOf(after.head) > 0, where + ': Still going names it');
        assert.equal(/has started$/.test(x.card.sub), started, where);
        if (started) crossed++;
      }
    });
  });
  state.drafts = {};
  assert.ok(crossed > 0 || CAMP.id === 'senior', 'a hold ran into the next block somewhere in the week (junior\'s Team competitions into lunch)');
  // a block held but not run into: Up next is the very block it always was
  const gb = gamesBlockOf(WED, 1);
  state.drafts[gb.games[0].id] = { scores: { [T()[0]]: '3' } };
  const nextBlock = nowBlocks(WED).find((x) => x.start >= gb.nb.end);
  assert.equal(at(WED, gb.nb.end + 1).next.id, nextBlock.id);
  done();
});
