// Games on the schedule (setup-rebuild-spec §5.8, §10.3, §10.4; build step 15 / "S5a"). A game carries a
// `blockId` — the schedule item it is played in — and an `ord` inside it. "Put games on the schedule" (A2)
// writes the printed pairing down once (the Morning / Evening rule, plus the rules that fix senior's Afternoon
// games and junior's Team Skits), touching ONLY games that have no place yet. Runs under the senior profile too
// (games-blocks.senior.test.js evals this file).

const GB_DOWS = [0, 1, 2, 3, 4, 5, 6];
const gbClone = (v) => JSON.parse(JSON.stringify(v));

// A block as planForDow returns it, for the pure rules.
function gbBlock(id, start, end, label, type, extra) {
  return Object.assign({ id, dk: 'mon', start, end, label, base: label, emoji: '🙂', type: type || 'activity', alertKey: id, origin: 'typical', ord: 0 }, extra || {});
}

function gbPlan(config) {
  return setupGameAttachments(config, (dow) => planForDow(dow), CAMP);
}

// ── the oracle table, game by game (§10.3) ───────────────────────────

test('A2 oracle: every default game lands on the printed block the spec names — none unscheduled', () => {
  const config = CAMP.defaultConfig();
  const plan = gbPlan(config);
  assert.deepEqual(plan.unplaced, [], 'every game has a place');
  assert.equal(plan.ops.length, config.games.length, CAMP.id === 'junior' ? '22 of 22' : '25 of 25');
  const where = {};
  plan.ops.forEach((op) => {
    const g = config.games.find((x) => x.id === op.id);
    const dow = config.days.find((d) => d.id === g.dayId).dow;
    const b = planForDow(dow).find((x) => x.id === op.blockId);
    assert.ok(b, op.id + ' names a block that exists on its day');
    where[op.id] = [b.start, setupHeadLabel(b.label)];
  });
  config.games.forEach((g) => {
    let want;
    if (CAMP.id === 'junior') {
      if (g.id === 'team-skits') want = [1140, 'Team Skits'];            // Friday 7:00 PM, an activity block: Happening Now is unchanged
      else if (g.session === 'Morning') want = [600, 'Team competitions'];
      else want = [1080, 'Evening competition'];
    } else if (/^team-comp-am-/.test(g.id)) want = [585, 'Team competitions'];     // 9:45
    else if (/^team-comp-pm-/.test(g.id)) want = [900, 'Team competitions'];       // 3:00 PM
    else if (/^legacy-game-/.test(g.id)) want = [1010, 'Legacy Game'];             // 4:50 PM, never the 4:40 "Cool down" block
    else want = [1130, '“Hot Seat” & “Let’s Make a Deal!”'];                       // 6:50 PM
    assert.deepEqual(where[g.id], want, g.id);
  });
});

test('A2: ord counts up inside each block, in the catalog\'s order, from 10', () => {
  const config = CAMP.defaultConfig();
  const plan = gbPlan(config);
  const byBlock = {};
  plan.ops.forEach((op) => { (byBlock[op.blockId + '@' + config.games.find((g) => g.id === op.id).dayId] = byBlock[op.blockId + '@' + config.games.find((g) => g.id === op.id).dayId] || []).push(op.ord); });
  Object.keys(byBlock).forEach((k) => {
    assert.deepEqual(byBlock[k], byBlock[k].map((_, i) => 10 * (i + 1)), k);
  });
});

test('A2 is idempotent: once placed, a second run writes nothing', () => {
  const config = CAMP.defaultConfig();
  setupApplyGameAttachments(config, gbPlan(config).ops);
  assert.deepEqual(gbPlan(config).ops, []);
  assert.ok(config.games.every((g) => typeof g.blockId === 'string' && Number.isFinite(g.ord)));
});

test('A2 never touches an attached game: a rain-plan move or a hand attachment survives', () => {
  const config = CAMP.defaultConfig();
  const day = config.days.find((d) => d.dow === 2);
  const first = config.games.find((g) => g.dayId === day.id && g.session === 'Morning');
  const lunch = planForDow(2).find((b) => b.label === 'Lunch');
  first.blockId = lunch.id; first.ord = 777; // moved by hand onto lunch
  const plan = gbPlan(config);
  assert.ok(!plan.ops.some((o) => o.id === first.id), 'left exactly where it was put');
  assert.equal(first.blockId, lunch.id);
  assert.equal(first.ord, 777);
  setupApplyGameAttachments(config, plan.ops);
  assert.equal(first.blockId, lunch.id);
  assert.equal(first.ord, 777);
});

test('A2 re-homes a game whose block no longer exists on its day, and orders it after what the block already holds', () => {
  const config = CAMP.defaultConfig();
  setupApplyGameAttachments(config, gbPlan(config).ops);
  const day = config.days.find((d) => d.dow === 1);
  const morning = config.games.filter((g) => g.dayId === day.id && g.session === 'Morning');
  assert.ok(morning.length >= 1);
  const dangling = morning[0];
  const keptOrd = morning.slice(1).map((g) => g.ord);
  dangling.blockId = 'b-a-block-that-was-deleted-1';
  const plan = gbPlan(config);
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].id, dangling.id);
  assert.equal(plan.ops[0].ord, (keptOrd.length ? Math.max.apply(null, keptOrd) : 0) + 10, 'after the games already there');
  // A blockId that exists, but only on ANOTHER weekday (a Sunday-only item), does not resolve on this game's day either.
  const sundayOnly = planForDow(0)[0];
  assert.ok(sundayOnly && sundayOnly.origin === 'own');
  dangling.blockId = sundayOnly.id;
  assert.ok(gbPlan(config).ops.some((o) => o.id === dangling.id), 'a block of another day is not this day\'s block');
});

test('A2: a game on no known day, or whose session no rule reaches, is listed as unplaced, never guessed', () => {
  const config = CAMP.defaultConfig();
  config.games.push({ id: 'orphan', name: 'Orphan', emoji: '🙂', dayId: 'd99', session: 'Morning', format: 'placement', rules: [] });
  const day = config.days.find((d) => d.dow === 1);
  config.games.push({ id: 'night-game', name: 'Moonlight Tag', emoji: '🌙', dayId: day.id, session: 'Night', format: 'placement', rules: [] });
  const plan = gbPlan(config);
  assert.deepEqual(plan.unplaced.sort((a, b) => (a.id < b.id ? -1 : 1)), [{ id: 'night-game', why: 'rule' }, { id: 'orphan', why: 'day' }]);
  assert.ok(!plan.ops.some((o) => o.id === 'orphan' || o.id === 'night-game'));
});

test('A2 rules: a timed block named for the game beats a games block that merely contains it, then the session', () => {
  const blocks = [
    gbBlock('b-prep-540', 540, 600, 'Prepare for Skit Night', 'activity'),
    gbBlock('b-games-600', 600, 700, 'Team competitions', 'games'),
    gbBlock('b-skit-night-900', 900, 960, 'Skit Night', 'activity'),
    gbBlock('b-big-games-1100', 1100, 1200, 'Skit Night finale games', 'games'),
    gbBlock('b-lights-1320', 1320, 1440, 'Skit Night', 'activity', { noTime: true }),
  ];
  const home = (game) => setupGameHome(game, blocks, CAMP);
  assert.equal(home({ id: 'a', name: 'Skit Night', session: 'Evening' }).id, 'b-skit-night-900', 'rule 1: a timed block whose head label IS the name (not the untimed one)');
  assert.equal(home({ id: 'b', name: 'finale', session: 'Morning' }).id, 'b-big-games-1100', 'rule 2: a games block whose head label contains the name');
  assert.equal(home({ id: 'c', name: 'Something else', session: 'Morning' }).id, 'b-games-600', 'rule 3: Morning is the first games block before noon');
  assert.equal(home({ id: 'd', name: 'Something else', session: 'Evening' }).id, 'b-big-games-1100', 'Evening is the first games block from 5:00 PM');
  assert.equal(home({ id: 'e', name: 'Something else', session: 'Afternoon' }), null, 'no games block between noon and 5:00 PM');
  assert.equal(home({ id: 'f', name: 'Something else', session: 'Night' }), null);
  assert.equal(home({ id: 'g', name: '', session: 'Morning' }).id, 'b-games-600', 'a nameless game still has its session');
  const override = { gameBlockOverrides: { h: 'b-big-games-1100' } };
  assert.equal(setupGameHome({ id: 'h', name: 'Skit Night', session: 'Morning' }, blocks, override).id, 'b-big-games-1100', 'the camp profile\'s override wins');
  assert.equal(setupGameHome({ id: 'h', name: 'Skit Night', session: 'Morning' }, blocks, { gameBlockOverrides: { h: 'b-nope' } }).id, 'b-skit-night-900', 'an override that names a block the day lacks is ignored');
});

test('A2 rules: Afternoon prefers the games block that names the game\'s first word, curly quotes read as straight', () => {
  const blocks = [
    gbBlock('b-a-900', 900, 1000, 'Team competitions', 'games'),
    gbBlock('b-b-1010', 1010, 1050, 'Legacy Game', 'games'),
    gbBlock('b-c-1130', 1130, 1155, '“Hot Seat” & “Let’s Make a Deal!”', 'games'),
  ];
  assert.equal(setupGameHome({ id: 'x', name: 'Team Competition (Afternoon)', session: 'Afternoon' }, blocks, CAMP).id, 'b-a-900');
  assert.equal(setupGameHome({ id: 'y', name: 'Legacy Game', session: 'Afternoon' }, blocks, CAMP).id, 'b-b-1010');
  assert.equal(setupGameHome({ id: 'z', name: "Let's Make a Deal", session: 'Evening' }, blocks, CAMP).id, 'b-c-1130', 'a straight apostrophe finds the curly one');
  assert.equal(setupGameHome({ id: 'w', name: 'Zebra Race', session: 'Afternoon' }, blocks, CAMP).id, 'b-a-900', 'no word match: the first of them');
});

test('setupApplyGameAttachments sets exactly blockId and ord, and ignores an id that is gone', () => {
  const config = { games: [{ id: 'g1', name: 'One', rules: [{ h: 'x', items: [] }] }] };
  const before = gbClone(config.games[0]);
  assert.equal(setupApplyGameAttachments(config, [{ id: 'g1', blockId: 'b-x-1', ord: 10 }, { id: 'ghost', blockId: 'b-y-2', ord: 20 }]), 1);
  assert.deepEqual(config.games[0], Object.assign(before, { blockId: 'b-x-1', ord: 10 }));
  assert.equal(setupApplyGameAttachments(null, [{ id: 'g1', blockId: 'b', ord: 1 }]), 0);
});

test('a game saved in the builder keeps its link: the draft is the game, blockId and ord ride along', () => {
  const config = CAMP.defaultConfig();
  setupApplyGameAttachments(config, gbPlan(config).ops);
  const g = config.games[0];
  const draft = toEditableDraft(g);
  assert.equal(draft.blockId, g.blockId, 'the editable draft carries the link');
  assert.equal(draft.ord, g.ord);
});

// ── what the accessors do with the links ─────────────────────────────

function gbOn() {
  freshState();
  setupTree = normalizeSetup(syncCanon(buildSeed(CAMP)));
  setupRev++;
}
function gbOff() {
  setupTree = normalizeSetup({});
  setupRev++;
  freshState();
}

test('off, gamesForBlock is the long-standing Morning / Evening rule whatever links the games carry', () => {
  gbOff();
  assert.equal(scheduleIsShared(), false);
  const day = competitionDays().find((d) => d.dow === 2);
  const morning = allGames().filter((g) => g.dayId === day.id && g.session === 'Morning');
  const games = scheduleForDow(2).find((b) => b.type === 'games' && b.start < 720);
  state.config.games.forEach((g) => { g.blockId = 'b-nowhere-1'; g.ord = 1; }); // links are ignored while the schedule is the built-in copy
  assert.deepEqual(gamesForBlock(2, games), morning);
  const meal = scheduleForDow(2).find((b) => b.label === 'Lunch');
  assert.deepEqual(gamesForBlock(2, meal), []);
});

test('on, each game is listed under exactly one block of its day, and nothing is unscheduled', () => {
  gbOn();
  setupApplyGameAttachments(state.config, gbPlan(state.config).ops);
  let listed = 0;
  competitionDays().forEach((d) => {
    const seen = {};
    gamesForDay(d.dow).forEach((x) => x.games.forEach((g) => { seen[g.id] = (seen[g.id] || 0) + 1; }));
    const mine = allGames().filter((g) => g.dayId === d.id);
    mine.forEach((g) => assert.equal(seen[g.id], 1, g.id + ' appears under exactly one block'));
    listed += mine.length;
    assert.deepEqual(unscheduledGames(d.dow), [], d.name + ' has no unscheduled game');
  });
  assert.equal(listed, allGames().length);
  gbOff();
});

test('on, the games of a block come in ord order (ties by catalog position), under any kind of block', () => {
  gbOn();
  setupApplyGameAttachments(state.config, gbPlan(state.config).ops);
  const full = gamesForDay(2).find((x) => x.games.length >= 2);
  assert.ok(full, 'Tuesday has a block with two games');
  const block = full.block;
  const [a, b] = full.games;
  assert.deepEqual(gamesForBlock(2, block).slice(0, 2).map((g) => g.id), [a.id, b.id]);
  a.ord = 500; b.ord = 5;
  assert.deepEqual(gamesForBlock(2, block).slice(0, 2).map((g) => g.id), [b.id, a.id], 'ord decides');
  b.ord = 500;
  assert.deepEqual(gamesForBlock(2, block).slice(0, 2).map((g) => g.id), [a.id, b.id], 'equal ord falls back to catalog order');
  // An activity block can hold a game too (junior's Team Skits; a game the rain plan moved onto lunch).
  const lunch = scheduleForDow(2).find((x) => x.label === 'Lunch');
  a.blockId = planForDow(2).find((x) => x.label === 'Lunch').id;
  assert.deepEqual(gamesForBlock(2, lunch).map((g) => g.id), [a.id]);
  assert.ok(!gamesForBlock(2, block).some((g) => g.id === a.id), 'and it left its old block');
  gbOff();
});

test('on, a game whose block was removed or skipped for its day is unscheduled, not lost', () => {
  gbOn();
  setupApplyGameAttachments(state.config, gbPlan(state.config).ops);
  const day = competitionDays().find((d) => d.dow === 2);
  const mine = allGames().filter((g) => g.dayId === day.id && g.session === 'Morning');
  const blockId = mine[0].blockId;
  // Tuesday cancels that block for the day (a patch on the typical item).
  setupTree.patches.tue = Object.assign({}, setupTree.patches.tue, { [blockId]: { off: true } });
  setupRev++;
  assert.ok(!planForDow(2).some((b) => b.id === blockId));
  assert.ok(planForDow(2).skipped.some((b) => b.id === blockId));
  assert.deepEqual(unscheduledGames(2).map((g) => g.id).sort(), mine.map((g) => g.id).sort(), 'the hub can name every game that lost its place');
  assert.ok(planForDow(3).some((b) => b.id === blockId), 'other days are untouched');
  assert.deepEqual(unscheduledGames(3), [], 'Wednesday still has its block');
  gbOff();
});

test('off, a game the Morning / Evening rule does not reach is unscheduled (senior Afternoon, junior Team Skits), and on it is not', () => {
  gbOff();
  const stranded = [].concat(...competitionDays().map((d) => unscheduledGames(d.dow))).map((g) => g.id);
  if (CAMP.id === 'senior') assert.equal(stranded.filter((id) => /^(team-comp-pm|legacy-game)-/.test(id)).length, 10, '10 of 25: Afternoon games were shown nowhere');
  else assert.deepEqual(stranded, ['team-skits'], 'junior Team Skits was shown nowhere');
  gbOn();
  setupApplyGameAttachments(state.config, gbPlan(state.config).ops);
  assert.deepEqual([].concat(...competitionDays().map((d) => unscheduledGames(d.dow))), [], 'A2 fixes both');
  gbOff();
});

test('gamesForBlock refuses a block that did not come from an accessor, rather than guess', () => {
  gbOn();
  setupApplyGameAttachments(state.config, gbPlan(state.config).ops);
  const copy = Object.assign({}, scheduleForDow(2).find((x) => x.type === 'games'));
  const viaHeuristic = gamesForBlock(2, copy);
  assert.ok(Array.isArray(viaHeuristic), 'a copy falls back to the printed rule (never throws)');
  assert.deepEqual(gamesForBlock(2, null), []);
  gbOff();
});

// ── Put games on the schedule, the button ────────────────────────────

test('putGamesOnSchedule: refused while the schedule is the built-in copy, or for a counselor; otherwise one config edit', () => {
  gbOff();
  setMemberRole('editor');
  assert.equal(putGamesOnSchedule().reason, 'off');
  setMemberRole('viewer');
  assert.equal(putGamesOnSchedule().reason, 'readonly');
  setMemberRole('editor');
  gbOn();
  const stamp = state.config.updatedAt;
  const r = putGamesOnSchedule();
  assert.equal(r.ok, true);
  assert.equal(r.attached, allGames().length);
  assert.deepEqual(r.unplaced, []);
  assert.ok(allGames().every((g) => typeof g.blockId === 'string'));
  assert.ok(state.config.updatedAt !== stamp, 'saveConfig ran: the config engine will send one transaction');
  const again = putGamesOnSchedule();
  assert.equal(again.ok, true);
  assert.equal(again.noop, true, 'nothing left to place');
  setMemberRole(null);
  gbOff();
});
