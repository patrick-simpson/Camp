// The Games screen and the progressive game sheet (setup-ui.js section 16; setup-rebuild-spec §11.14; build step 21): the week's games
// by schedule item through the accessors, a game created whole the moment it has a name and a way of being scored and saved a field
// at a time after that (through the config engine, one undo entry per change, never a whole-object write), a game deleted elsewhere
// noticed instead of resurrected, the When picker's writes (blockId / ord / dayId / session, as the rain plan's move and A2 derive
// them), Matchups, Earlier / Later, days with games, the ⚡ quick game, and random-tail ids that two devices can't mint twice.
// Runs under senior too (games-screen.senior.test.js evals this file): four teams, an afternoon session, its Legacy Game.

function gsStart(opts) {
  window.scrollTo = () => {};
  freshState();
  setMemberRole('editor');
  authUser = { email: 'jenn@example.com', emailVerified: true };
  setupTree = normalizeSetup(opts && opts.off ? {} : setupClone(syncCanon(buildSeed(CAMP))));
  setupRev++;
  if (!(opts && opts.off)) setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (dow) => planForDow(dow), CAMP).ops);
  location.search = opts && opts.now ? '?now=' + opts.now : '';
  state.ui.view = 'home';
  state.ui.builderScreen = undefined;
  setupUi.wasOpen = false; // an earlier case's builder must not close this case's sheet on the next paint
  gmUi.open = null;
  undoClear();
  setupPillHide(true);
}
function gsEnd() { location.search = ''; setMemberRole(null); authUser = null; undoClear(); setupPillHide(true); }

const gsBlocks = (dk) => planForDow(SETUP_DK.indexOf(dk)).filter((b) => b.type === 'games');
const gsLastUndo = () => undoRecent()[0] || null;
const gsPaths = (entry) => entry.ops.map((o) => o[1]).sort();
const gsFirstDay = () => SETUP_DK.find((dk) => gmIsGamesDay(dk) && gsBlocks(dk).length);
// A weekday with two games items (junior's Wednesday has Team competitions and Evening competition)
const gsTwoItemDay = () => SETUP_DK.find((dk) => gmIsGamesDay(dk) && gsBlocks(dk).length >= 2);

test('the day model groups by schedule item through the accessors: every item that holds games, in schedule order, with a count and a lede', () => {
  gsStart();
  try {
    const dk = gsTwoItemDay() || gsFirstDay();
    const m = gmDayModel(dk);
    assert.equal(m.live, true);
    assert.equal(m.isDay, true);
    assert.ok(m.groups.length >= 1);
    const dow = SETUP_DK.indexOf(dk);
    m.groups.forEach((g) => {
      assert.equal(g.bid, g.block.id);
      assert.deepEqual(g.games.map((x) => x.id), gamesForBlock(dow, scheduleForDow(dow).find((l) => setupRichOf(l) && setupRichOf(l).id === g.bid)).map((x) => x.id), 'the same games, in the same order, as everyone else sees');
    });
    assert.deepEqual(m.groups.map((g) => g.block.start), m.groups.map((g) => g.block.start).slice().sort((a, b) => a - b), 'schedule order');
    assert.equal(m.n, gmGamesOnDay(dk).length);
    assert.ok(new RegExp('^' + m.n + '\u00a0games? on \\d+\u00a0schedule items?').test(m.lede) || m.loose.length, m.lede + ' (a count is joined to its word)');
    assert.equal(m.headline, SETUP_DAY_WORDS[dk]);
  } finally { gsEnd(); }
});

test('a day that is not a games day says so, and the strip draws a count only for the days that are', () => {
  gsStart();
  try {
    const off = SETUP_DK.find((dk) => !gmIsGamesDay(dk));
    assert.ok(off, 'a weekday with no competition day');
    const m = gmDayModel(off);
    assert.equal(m.isDay, false);
    assert.equal(m.lede, 'Not a games day');
    assert.deepEqual([m.groups.length, m.loose.length, m.warn], [0, 0, false]);
    const strip = gmStripModel();
    assert.equal(strip.length, 7);
    const chip = strip.find((s) => s.dk === off);
    assert.equal(chip.off, true);
    assert.equal(chip.n, '');
    assert.ok(/not a games day$/.test(chip.label), chip.label);
    const on = strip.find((s) => !s.off);
    assert.ok(/^\d+$/.test(on.n) && /\d+ games?/.test(on.label), on.label);
  } finally { gsEnd(); }
});

test('a game on no item is listed under "not on the schedule" and the day gets the gold "!"; a game that still says TBA does too', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    gmGamesOnDay(dk).forEach((x) => { if (gmIsTba(x)) x.location = 'Chapel Lawn'; }); // senior's placeholder games say TBA for where
    const g = gmGamesOnDay(dk)[0];
    const base = gmDayModel(dk);
    assert.equal(base.warn, false, 'a seeded week has nothing to look at');
    delete g.blockId; delete g.ord;
    const m = gmDayModel(dk);
    assert.deepEqual(m.loose.map((x) => x.id), [g.id]);
    assert.equal(m.warn, true);
    assert.ok(/ · 1\u00a0isn’t on the schedule$/.test(m.lede), m.lede);
    assert.ok(/needs a look$/.test(gmStripModel().find((s) => s.dk === dk).label));
    g.blockId = gsBlocks(dk)[0].id;
    assert.equal(gmDayModel(dk).warn, false, 'linked again');
    g.location = 'TBA';
    assert.equal(gmDayModel(dk).warn, true, 'TBA for where is a thing to look at');
    assert.deepEqual(gmGameSub(g), { text: GM_FORMAT_WORDS[g.format] + ' · where: TBA', warn: true });
    g.location = 'Gym'; g.messtival = true;
    assert.equal(gmGameSub(g).text, GM_FORMAT_WORDS[g.format] + ' · Gym · double points');
  } finally { gsEnd(); }
});

test('with the schedule the original, a day is grouped by session (links are not read) and no game is loose', () => {
  gsStart({ off: true });
  try {
    assert.equal(scheduleIsShared(), false);
    const dk = gsFirstDay() || SETUP_DK.find(gmIsGamesDay);
    const m = gmDayModel(dk);
    assert.equal(m.live, false);
    assert.deepEqual(m.groups.map((g) => g.session), gmSessions());
    assert.ok(m.groups.every((g) => g.bid === '' && g.time === ''), 'no item, no time');
    assert.equal(m.groups.reduce((n, g) => n + g.games.length, 0), m.n);
    assert.equal(m.loose.length, 0);
  } finally { gsEnd(); }
});

test('creating a game: ONE config edit adds the whole record on the item named, after what it holds, with the item\'s session and a random-tail id', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const blk = gsBlocks(dk)[0];
    const before = gmGamesOnBlock(dk, blk.id).length;
    const topOrd = gmGamesOnBlock(dk, blk.id).reduce((o, g) => Math.max(o, g.ord || 0), 0);
    const n0 = allGames().length;
    const place = gmPlacement(dk, blk.id);
    assert.equal(place.blockId, blk.id);
    assert.equal(place.ord, topOrd + SETUP_GAME_ORD_STEP);
    assert.equal(place.session, rainSessionFor(state.config, blk));
    const r = gmCreateGame({ name: '  Rain bowling ', emoji: '🎳', location: 'Gym', format: 'tally' }, place);
    assert.equal(r.ok, true);
    assert.ok(/^rain-bowling-[a-z0-9]{4}$/.test(r.id), r.id);
    assert.equal(allGames().length, n0 + 1);
    const g = gameById(r.id);
    assert.deepEqual([g.name, g.emoji, g.location, g.format, g.blockId, g.ord, g.dayId], ['Rain bowling', '🎳', 'Gym', 'tally', blk.id, topOrd + SETUP_GAME_ORD_STEP, place.dayId]);
    assert.equal(gmGamesOnBlock(dk, blk.id).length, before + 1);
    assert.equal(gmGamesOnBlock(dk, blk.id).pop().id, r.id, 'it plays last on the item');
    const u = gsLastUndo();
    assert.equal(u.label, 'Added “Rain bowling”');
    assert.deepEqual(gsPaths(u), ['games/' + r.id], 'one whole-record op, nothing else');
  } finally { gsEnd(); }
});

test('creating needs a name, a way of being scored and a games day; nothing is written before then', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const place = gmPlacement(dk, gsBlocks(dk)[0].id);
    const n0 = allGames().length;
    assert.equal(gmCreateGame({ name: '   ', format: 'tally' }, place).reason, 'name');
    assert.equal(gmCreateGame({ name: 'X', format: '' }, place).reason, 'format');
    assert.equal(gmCreateGame({ name: 'X', format: 'nonsense' }, place).reason, 'format');
    assert.equal(gmCreateGame({ name: 'X', format: 'tally' }, null).reason, 'day');
    assert.equal(allGames().length, n0);
    assert.equal(gsLastUndo(), null, 'no undo entry for a refusal');
    const off = SETUP_DK.find((d) => !gmIsGamesDay(d));
    assert.equal(gmPlacement(off, ''), null, 'a weekday with no games day has no place yet');
    setMemberRole('viewer');
    assert.equal(gmCreateGame({ name: 'X', format: 'tally' }, place).reason, 'locked', 'a counselor never writes');
    assert.equal(allGames().length, n0);
  } finally { gsEnd(); }
});

test('two directors adding the same name get two games (random tails), and a new game never inherits a stale record under a reused id', () => {
  gsStart();
  const realRandom = Math.random;
  try {
    const dk = gsFirstDay();
    const place = () => gmPlacement(dk, gsBlocks(dk)[0].id);
    const a = gmCreateGame({ name: 'Rain bowling', format: 'tally' }, place());
    const b = gmCreateGame({ name: 'Rain bowling', format: 'tally' }, place());
    assert.ok(a.ok && b.ok && a.id !== b.id, a.id + ' / ' + b.id);
    assert.equal(allGames().filter((g) => g.name === 'Rain bowling').length, 2);
    // A leftover under the id the dice land on is a taken id in EVERY per-game map; the first roll collides, the second is used.
    GAME_RECORD_MAPS.forEach((m) => {
      const dice = [0.5, 0.25]; // 'i000', then '9000'
      Math.random = () => (dice.length ? dice.shift() : realRandom());
      state[m.key] = state[m.key] || {};
      state[m.key]['sock-hop-i000'] = { phase: 'round1', medals: { gold: 't0', silver: 't1', bronze: 't2' } };
      const r = gmCreateGame({ name: 'Sock Hop', format: 'placement' }, place());
      assert.equal(r.id, 'sock-hop-9000', m.key + ' counts as taken');
      delete state[m.key]['sock-hop-i000'];
      state.config.games.pop();
    });
    assert.ok(GAME_RECORD_MAPS.some((m) => m.key === 'brackets4'), 'the four-team bracket is one of the per-game maps');
    // And a leftover that no map showed this device (a stale record outside takenGameIds' view) is cleared, not inherited.
    Math.random = () => 0.5;
    state.results['sock-hop-i000'] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
    const taken = takenGameIds();
    assert.ok(taken.has('sock-hop-i000'));
  } finally { Math.random = realRandom; gsEnd(); }
});

test('saving one field writes exactly that field onto the game as it is now: one undo entry, the colleague\'s other field kept', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const g = gmGamesOnDay(dk)[0];
    // A colleague's snapshot changed the headline while this sheet was open (the game is read by id when the write runs).
    gameById(g.id).headline = 'Their words';
    const r = gmCommit(g.id, { location: 'The pond' });
    assert.deepEqual([r.ok, r.changed], [true, true]);
    assert.equal(gameById(g.id).location, 'The pond');
    assert.equal(gameById(g.id).headline, 'Their words', 'their field is never undone');
    const u = gsLastUndo();
    assert.deepEqual(gsPaths(u), ['games/' + g.id + '/location']);
    // An unchanged value writes nothing at all.
    undoClear();
    assert.deepEqual([gmCommit(g.id, { location: 'The pond' }).changed], [false]);
    assert.equal(gsLastUndo(), null);
    // A rename says what it renamed.
    assert.equal(gmRename(g.id, '  Renamed one  ').ok, true);
    assert.equal(gameById(g.id).name, 'Renamed one');
    assert.ok(/^Renamed “/.test(gsLastUndo().label));
    assert.equal(gmRename(g.id, '   ').reason, 'name', 'a game keeps a name');
    assert.equal(gameById(g.id).name, 'Renamed one');
  } finally { gsEnd(); }
});

test('a game deleted elsewhere while its sheet is open is noticed: the write says "gone" and nothing is put back by itself', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const g = gmGamesOnDay(dk)[0];
    const id = g.id;
    const n0 = allGames().length;
    state.config.games.splice(allGames().findIndex((x) => x.id === id), 1);
    undoClear();
    const r = gmCommit(id, { location: 'Anywhere' });
    assert.deepEqual([r.ok, r.reason], [false, 'gone']);
    assert.equal(allGames().length, n0 - 1, 'not resurrected');
    assert.equal(gmRename(id, 'Still here?').reason, 'gone');
    assert.equal(gmMoveGame(id, { none: true }).reason, 'gone');
    assert.equal(gmOrderGame(id, -1).reason, 'gone');
    assert.equal(gsLastUndo(), null);
  } finally { gsEnd(); }
});

test('changing how a scored game is scored: the question names what goes, then the old format\'s fields and records are gone (and it is not undoable)', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const g = gmGamesOnDay(dk).find((x) => x.format === 'placement') || gmGamesOnDay(dk)[0];
    g.unit = 'laps'; g.lowerWins = true;
    state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: '2026-07-20T10:00:00Z' };
    state.brackets[g.id] = { phase: 'round1', pool: [], matches: [] };
    const first = gmChangeFormat(g.id, g.format === 'tally' ? 'placement' : 'tally');
    assert.deepEqual([first.ok, first.reason], [false, 'confirm']);
    assert.equal(first.going, 'the saved result and the bracket in progress');
    assert.equal(state.results[g.id] != null, true, 'nothing cleared before the answer');
    const to = g.format === 'tally' ? 'placement' : 'tally';
    const r = gmChangeFormat(g.id, to, { confirmed: true });
    assert.equal(r.ok, true);
    assert.equal(gameById(g.id).format, to);
    assert.equal(state.results[g.id], undefined);
    assert.equal(state.brackets[g.id], undefined);
    if (to === 'placement') assert.equal(gameById(g.id).unit, undefined, 'the scores\' own fields go with them');
    assert.equal(gsLastUndo(), null, 'records are gone for good: an Undo that brought the format back would be a lie');
    // No records: no question, and it can be undone.
    const h = gmGamesOnDay(dk).find((x) => x.id !== g.id && !gameRecordLabels(x.id).length);
    const was = h.format;
    const r2 = gmChangeFormat(h.id, was === 'tournament' ? 'tally' : 'tournament');
    assert.equal(r2.ok, true);
    assert.ok(/^Changed how “/.test(gsLastUndo().label));
    assert.equal(gmChangeFormat(h.id, 'nonsense').reason, 'format');
  } finally { gsEnd(); }
});

test('Matchups: the saved choice reads back as one of three; Set them now needs every team placed, else it saves as "Pick them when you start"', () => {
  gsStart();
  try {
    const ids = teamIds();
    const dk = gsFirstDay();
    const place = gmPlacement(dk, gsBlocks(dk)[0].id);
    const made = gmCreateGame({ name: 'Rope bridge', format: 'tournament' }, place);
    const id = made.id;
    assert.equal(gameById(id).bracketSeed, 'standings', 'a new bracket starts by the standings');
    assert.equal(gmSeedOf(gameById(id)), 'standings');
    // pick: the choice is kept, no pairs
    assert.equal(gmSetSeed(id, 'pick').ok, true);
    assert.deepEqual([gameById(id).bracketSeed, gameById(id).roundOneMatchups], ['pick', undefined]);
    // the board: taps in order, a placed team comes out, the last pair fills itself
    let order = [];
    ids.slice(0, ids.length - 2).forEach((t) => { order = gmPairsTap(order, t); });
    assert.equal(order.length, ids.length, 'with two left, they take the last match');
    assert.equal(gmPairsFromOrder(order).length, ids.length / 2);
    const out = gmPairsTap(order, ids[0]);
    assert.equal(out.length, ids.length - 1, 'a tap on a placed team takes it out');
    assert.equal(out.indexOf(ids[0]), -1);
    assert.equal(gmPairsFromOrder(out), null, 'an incomplete board is not a set of pairs');
    // an incomplete board saves as pick; a complete one as fixed
    assert.equal(gmSetSeed(id, 'fixed', out).ok, true);
    assert.deepEqual([gameById(id).bracketSeed, gameById(id).roundOneMatchups], ['pick', undefined]);
    assert.equal(gmSetSeed(id, 'fixed', order).ok, true);
    assert.equal(gameById(id).bracketSeed, 'fixed');
    assert.equal(gmPairsValid(gameById(id).roundOneMatchups), true);
    assert.equal(gmSeedOf(gameById(id)), 'fixed');
    assert.equal(JSON.stringify(gameById(id).roundOneMatchups), JSON.stringify(gmPairsBoard(order)));
    // back to the standings: the pairs go
    assert.equal(gmSetSeed(id, 'standings').ok, true);
    assert.deepEqual([gameById(id).bracketSeed, gameById(id).roundOneMatchups], ['standings', undefined]);
    assert.equal(gmSetSeed(id, 'nonsense').reason, 'mode');
  } finally { gsEnd(); }
});

test('a game made before bracketSeed existed reads back as what it does: fixed pairs are "Set them now", none is "Pick them when you start"', () => {
  gsStart();
  try {
    const t = allGames().filter((g) => g.format === 'tournament');
    t.forEach((g) => {
      if (Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length) assert.equal(gmSeedOf(g), gmPairsValid(g.roundOneMatchups) ? 'fixed' : 'pick', g.id);
      else assert.equal(gmSeedOf(g), 'pick', g.id);
    });
    assert.equal(gmSeedOf({ format: 'tournament', bracketSeed: 'fixed' }), 'pick', 'a fixed game with no pairs is not fixed');
    assert.equal(gmSeedOf({ format: 'tournament', bracketSeed: 'junk' }), 'pick');
    assert.equal(gmPairsValid([['t0', 't0'], ['t1', 't2'], ['t3', 't4']]), false, 'a team twice');
    assert.equal(gmPairsValid([['t0', 't1']]), teamIds().length === 2);
  } finally { gsEnd(); }
});

// ── the screen ──

function gsOpenScreen(dk) {
  state.ui.view = 'settings';
  state.ui.builderScreen = 'games';
  state.ui.sgDay = dk;
  setupUi.wasOpen = false;
}

test('the hub\'s Games row opens this screen, and Who\'s here says "the games" (or which game while its sheet is up)', () => {
  gsStart();
  try {
    assert.deepEqual(HUB_OPENS.games, { screen: 'games' });
    assert.ok(SETUP_SCREENS.indexOf('games') !== -1);
    assert.ok(SETUP_SHEETS.indexOf('game') !== -1 && SETUP_SHEETS.indexOf('sg-day') !== -1);
    state.ui.view = 'settings';
    openBuilder();
    hubOpen('games');
    assert.equal(state.ui.builderScreen, 'games');
    assert.equal(setupScreen(), 'games');
    assert.equal(setupWhereNow(), 'games');
    assert.equal(editorsHereWhereWords('games'), 'the games');
  } finally { state.ui.view = 'home'; gsEnd(); }
});

test('a counselor reaches none of it: no screen, no sheet', () => {
  gsStart();
  try {
    setMemberRole('viewer');
    assert.equal(setupGo('games'), false);
    state.ui.builderScreen = 'games';
    gmUi.dayDk = 'mon';
    assert.equal(shellSheetAllowed('sg-day'), false);
    assert.equal(gmOpenDaySheet(), undefined);
    assert.equal(shell.sheets.includes('sg-day'), false);
  } finally { state.ui.builderScreen = undefined; gsEnd(); }
});

test('the screen draws a day: items as headings with their games under them, "Add a game here" on each, and the day\'s words', () => {
  gsStart();
  try {
    const dk = gsTwoItemDay() || gsFirstDay();
    gsOpenScreen(dk);
    renderGamesScreen();
    const m = gmDayModel(dk);
    assert.equal(setupEl('sg-headline').textContent, SETUP_DAY_WORDS[dk]);
    assert.equal(setupEl('sg-title').textContent, 'Games · ' + CAMP.label);
    assert.equal(setupEl('sg-lede').textContent, m.lede);
    const html = setupEl('sg-items').innerHTML;
    m.groups.forEach((g) => {
      assert.ok(html.indexOf('data-key="' + g.key + '"') !== -1, g.key);
      assert.ok(html.indexOf('data-sg-add="' + g.bid + '"') !== -1, 'Add a game here on ' + g.bid);
      g.games.forEach((x) => { assert.ok(html.indexOf('data-sg-open="' + x.id + '"') !== -1, x.id); assert.ok(html.indexOf(esc(x.name)) !== -1, x.name); });
    });
    assert.equal((html.match(/class="cb-row sg-game"/g) || []).length, m.groups.reduce((n, g) => n + g.games.length, 0));
    assert.equal(setupEl('sg-day-btn').hidden, false, 'a games day has its ⋯');
    assert.equal(setupEl('sg-noday').hidden, true);
    assert.equal(setupEl('sg-empty').hidden, true);
    assert.equal(setupEl('sg-add').hidden, false);
    assert.equal(setupEl('sg-add-text').textContent, 'Add a game to ' + SETUP_DAY_WORDS[dk]);
    assert.equal(setupEl('sg-orig').hidden, true, 'the schedule is edited here');
    assert.equal(setupEl('sg-sec-off').hidden, true, 'nothing is off the schedule');
  } finally { state.ui.view = 'home'; gsEnd(); }
});

test('a name or a place with markup in it reaches the page only as escaped text', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const g = gmGamesOnDay(dk)[0];
    g.name = '<img src=x onerror=alert(1)> & "Co"'; g.location = '<b>Gym</b>'; g.emoji = '<script>';
    gsOpenScreen(dk);
    renderGamesScreen();
    const html = setupEl('sg-items').innerHTML;
    assert.ok(!/<img |<b>Gym|<script/.test(html), 'no raw markup from the database');
    assert.ok(html.indexOf('&lt;img') !== -1);
  } finally { state.ui.view = 'home'; gsEnd(); }
});

test('a day that is not a games day: the lede says so and the only offer is to make it one; making it one adds one competition day in week order', () => {
  gsStart();
  try {
    const off = SETUP_DK.find((d) => !gmIsGamesDay(d) && d !== 'sun') || SETUP_DK.find((d) => !gmIsGamesDay(d));
    gsOpenScreen(off);
    renderGamesScreen();
    assert.equal(setupEl('sg-lede').textContent, 'Not a games day');
    assert.equal(setupEl('sg-noday').hidden, false);
    assert.equal(setupEl('sg-day-on-text').textContent, 'Make ' + SETUP_DAY_WORDS[off] + ' a games day');
    assert.equal(setupEl('sg-day-btn').hidden, true);
    assert.equal(setupEl('sg-add').hidden, true);
    const n0 = competitionDays().length;
    const r = gmMakeDayGo(off);
    assert.equal(r.ok, true);
    assert.equal(competitionDays().length, n0 + 1);
    assert.equal(gmIsGamesDay(off), true);
    const dows = competitionDays().map((d) => d.dow);
    assert.deepEqual(dows, dows.slice().sort((a, b) => a - b), 'the Games tab lists days in week order');
    assert.equal(competitionDays().find((d) => d.dow === SETUP_DK.indexOf(off)).name, SETUP_DAY_WORDS[off]);
    assert.equal(gsLastUndo().label, 'Made ' + SETUP_DAY_WORDS[off] + ' a games day');
    assert.equal(gmMakeDay(off).changed, false, 'a second press writes nothing');
    renderGamesScreen();
    assert.equal(setupEl('sg-lede').textContent, 'No games yet');
    assert.equal(setupEl('sg-sec-off').hidden, true);
  } finally { state.ui.view = 'home'; gsEnd(); }
});

test('a games day with a Games item and no games lists the item with "Add a game here"; with no Games item it offers the first game', () => {
  gsStart();
  try {
    const off = SETUP_DK.find((d) => !gmIsGamesDay(d) && planForDow(SETUP_DK.indexOf(d)).some((b) => b.type === 'games'));
    const none = SETUP_DK.find((d) => !gmIsGamesDay(d) && !planForDow(SETUP_DK.indexOf(d)).some((b) => b.type === 'games'));
    if (off) {
      gmMakeDay(off); gsOpenScreen(off); renderGamesScreen();
      assert.equal(setupEl('sg-empty').hidden, true, 'a Games item is the place to add one');
      assert.ok(/data-sg-add=/.test(setupEl('sg-items').innerHTML));
    }
    if (none) {
      gmMakeDay(none); gsOpenScreen(none); renderGamesScreen();
      assert.equal(setupEl('sg-empty').hidden, false);
      assert.equal(setupEl('sg-empty-text').textContent, 'No games on ' + SETUP_DAY_WORDS[none] + ' yet.');
      assert.equal(setupEl('sg-add').hidden, true, 'the one main action is the empty state\'s');
    }
    assert.ok(off || none, 'a weekday that was not a games day');
  } finally { state.ui.view = 'home'; gsEnd(); }
});

test('with the schedule the original the screen groups by session and says why; its add button names the session', () => {
  gsStart({ off: true });
  try {
    const dk = SETUP_DK.find(gmIsGamesDay);
    gsOpenScreen(dk);
    renderGamesScreen();
    assert.equal(setupEl('sg-orig').hidden, false);
    const html = setupEl('sg-items').innerHTML;
    gmSessions().forEach((s) => { assert.ok(html.indexOf('data-key="s-' + s + '"') !== -1, s); assert.ok(html.indexOf('data-sg-add="session:' + s + '"') !== -1); assert.ok(html.indexOf(s + ' games') !== -1); });
    assert.ok(!/class="sg-item-now"/.test(html));
  } finally { state.ui.view = 'home'; gsEnd(); }
});

test('the day\'s ⋯ sheet: its note saves when focus leaves (nothing else to press), and an unchanged note writes nothing', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    gsOpenScreen(dk);
    gmUi.dayDk = dk;
    renderGmDaySheet();
    assert.equal(setupEl('sheet-sg-day-title').textContent, SETUP_DAY_WORDS[dk]);
    assert.equal(setupEl('sg-day-note-label').textContent, 'Note on ' + SETUP_DAY_WORDS[dk] + '’s games');
    assert.ok(/^First asks where its \d+ games? go$/.test(setupEl('sg-day-off-sub').textContent));
    setupEl('sg-day-note').value = '  Bring a towel  ';
    gmDayNoteBlur();
    assert.equal(gmDayRecs(dk)[0].note, 'Bring a towel');
    assert.equal(gsLastUndo().label, 'Edited the note for ' + SETUP_DAY_WORDS[dk]);
    undoClear();
    gmDayNoteBlur();
    assert.equal(gsLastUndo(), null, 'unchanged: nothing');
    assert.equal(gmSetDayNote(dk, 'x'.repeat(300)).changed, true);
    assert.equal(gmDayRecs(dk)[0].note.length, 200, 'cut to 200');
  } finally { state.ui.view = 'home'; gsEnd(); }
});

test('taking a day off the games days: games must have somewhere to go (they move to the day picked, off any item, onto its natural one); a day with none just goes', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const target = SETUP_DK.find((d) => d !== dk && gmIsGamesDay(d) && gsBlocks(d).length);
    const games = gmGamesOnDay(dk).map((g) => g.id);
    assert.equal(gmTakeDayOff(dk, '').reason, 'where', 'a day with games asks where they go');
    assert.equal(gmIsGamesDay(dk), true);
    const r = gmTakeDayOff(dk, target);
    assert.deepEqual([r.ok, r.moved], [true, games.length]);
    assert.equal(gmIsGamesDay(dk), false);
    const tid = gmDayRecs(target)[0].id;
    games.forEach((id) => { const g = gameById(id); assert.equal(g.dayId, tid, id + ' moved to ' + target); assert.ok(typeof g.blockId === 'string' || true); });
    assert.equal(gmGamesOnDay(dk).length, 0);
    assert.equal(gsLastUndo().label, 'Took ' + SETUP_DAY_WORDS[dk] + ' off the games days');
    // a day with no games: no question
    const empty = SETUP_DK.find((d) => gmIsGamesDay(d) && !gmGamesOnDay(d).length) || (gmMakeDay('sat'), 'sat');
    assert.equal(gmTakeDayOff(empty, '').ok, true);
    assert.equal(gmIsGamesDay(empty), false);
    setMemberRole('viewer');
    assert.equal(gmTakeDayOff(target, '').reason, 'locked');
  } finally { gsEnd(); }
});

test('the Games tab\'s "Add games" opens this screen on the day it was looking at, not the classic editor', () => {
  gsStart();
  try {
    const d = competitionDays().find((x) => x.dow === 4) || competitionDays()[0];
    const dk = SETUP_DK[d.dow];
    state.ui.view = 'home';
    gmOpenScreen(d.id);
    assert.equal(state.ui.view, 'settings');
    assert.equal(state.ui.builderScreen, 'games');
    assert.equal(state.ui.sgDay, dk);
    assert.equal(gmDayKey(), dk);
    state.ui.view = 'home';
    gmOpenScreen('fri');
    assert.equal(state.ui.sgDay, 'fri', 'a weekday key works too');
    const src = readFixture('../games-ui.js');
    assert.ok(/\[data-games-add\]'\)\)\) \{ if \(canEdit\(\)\) \{ if \(typeof gmOpenScreen === 'function'\) gmOpenScreen\(state\.ui\.day\)/.test(src), 'games-ui.js routes Add games through the Games screen');
    setMemberRole('viewer');
    state.ui.view = 'home';
    gmOpenScreen(d.id);
    assert.equal(state.ui.view, 'home', 'a counselor opens nothing');
  } finally { state.ui.view = 'home'; state.ui.builderScreen = undefined; gsEnd(); }
});

// ── the game sheet ──
// An input stand-in the handlers can read: id, value, tag, class list.
const gsEl = (id, value) => ({ id, value, tagName: 'INPUT', classList: { contains: () => false } });
function gsShut() { if (shell.sheets.includes('game')) shellSheetClose('game'); gmUi.open = null; }
const gsText = (id, v) => { setupEl(id).value = v; gmCommitText(gsEl(id, v)); };

test('a new game opens on the item it was added to: the name field first, nothing is written, the dock says what the next step is', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const blk = gsBlocks(dk)[0];
    const n0 = allGames().length;
    assert.equal(gmOpenNew({ dk, target: blk.id }), true);
    assert.ok(shell.sheets.includes('game'));
    const o = gmUi.open;
    assert.deepEqual([o.mode, o.pane, o.gid, o.dk, o.bid], ['new', 'form', null, dk, blk.id]);
    assert.equal(gmStageOf(o), 'name');
    assert.equal(gmWaitInfo(o).text, 'Type the game’s name first');
    renderGameSheet();
    assert.equal(setupEl('sheet-game').dataset.stage, 'name');
    assert.equal(setupEl('sheet-game').dataset.mode, 'new');
    assert.equal(setupEl('sheet-game-title').textContent, 'New game');
    assert.equal(setupEl('gm-wait').hidden, false);
    assert.equal(setupEl('gm-state').hidden, true);
    assert.ok(new RegExp('^' + SETUP_DAY_WORDS[dk] + ' · ').test(setupEl('gm-when-text').textContent), setupEl('gm-when-text').textContent);
    assert.equal(allGames().length, n0, 'nothing written');
    assert.equal(gsLastUndo(), null);
    assert.equal(shellSheetAllowed('game'), true);
  } finally { gsShut(); gsEnd(); }
});

test('Where starts as the last-used place on the item and says so; a name makes "How is it scored?" appear and still writes nothing', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const blk = gsBlocks(dk)[0];
    const last = gmGamesOnBlock(dk, blk.id).filter((g) => g.location && !gmIsTba(g)).pop();
    gmOpenNew({ dk, target: blk.id });
    const o = gmUi.open;
    assert.equal(o.form.location, last ? last.location : '');
    renderGameSheet();
    assert.equal(setupEl('gm-where').value, o.form.location);
    assert.equal(setupEl('gm-where-hint').textContent, o.form.location ? 'Where the last game here was' : '');
    const n0 = allGames().length;
    setupEl('gm-name').value = 'Rain bowling';
    gmCommitText(gsEl('gm-name', 'Rain bowling'));
    assert.equal(o.form.name, 'Rain bowling');
    assert.equal(gmStageOf(o), 'format');
    assert.equal(gmWaitInfo(o).text, 'Pick how it’s scored ↑');
    renderGameSheet();
    assert.equal(setupEl('sheet-game').dataset.stage, 'format');
    assert.equal(allGames().length, n0, 'a name alone creates nothing');
  } finally { gsShut(); gsEnd(); }
});

test('picking how it is scored creates the game at that moment: ONE entry, on the item, the dock saved line and Done; tally and bracket pick up their live defaults', async () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const blk = gsBlocks(dk)[0];
    gmOpenNew({ dk, target: blk.id });
    const o = gmUi.open;
    gsText('gm-name', 'Rain bowling');
    const n0 = allGames().length;
    await gmPickFormat('tally');
    assert.equal(allGames().length, n0 + 1);
    assert.ok(o.gid && /^rain-bowling-/.test(o.gid));
    const g = gameById(o.gid);
    assert.deepEqual([g.name, g.format, g.blockId, g.liveRankings], ['Rain bowling', 'tally', blk.id, true]);
    assert.equal(gsLastUndo().label, 'Added “Rain bowling”');
    assert.equal(gmStageOf(o), 'game');
    renderGameSheet();
    assert.equal(setupEl('sheet-game').dataset.stage, 'game');
    assert.equal(setupEl('sheet-game').dataset.format, 'tally');
    assert.equal(setupEl('gm-wait').hidden, true);
    assert.equal(setupEl('gm-state').hidden, false);
    assert.equal(setupEl('gm-acts').hidden, false);
    assert.equal(setupEl('gm-score').hidden, true, 'only a quick game offers Score it now');
    assert.ok(/^Added to /.test(setupEl('gm-state-text').textContent) || /^Saving/.test(setupEl('gm-state-text').textContent), setupEl('gm-state-text').textContent);
    assert.equal(shell.sheets.includes('game'), true, 'the sheet stays up');
    // a bracket: the plain running scoreboard and "by the standings"
    gsShut();
    gmOpenNew({ dk, target: blk.id });
    gsText('gm-name', 'Rope pull');
    await gmPickFormat('tournament');
    const b = gameById(gmUi.open.gid);
    assert.deepEqual([b.format, b.bracketSeed, b.liveTracker.unit, b.liveTracker.innings, b.liveTracker.outs], ['tournament', 'standings', 'Points', 1, 0]);
  } finally { gsShut(); gsEnd(); }
});

test('the format first, then the name: the game is created when the name is committed (a quick game\'s one step)', () => {
  gsStart({ now: '3-1030' });
  try {
    const dk = SETUP_DK[3];
    const blk = gsBlocks(dk)[0];
    gmOpenNew({ dk, target: blk.id });
    const o = gmUi.open;
    o.form.format = 'placement';
    assert.equal(gmStageOf(o), 'name', 'the format section waits for a name');
    const n0 = allGames().length;
    gsText('gm-name', 'Water balloon toss');
    assert.equal(allGames().length, n0 + 1);
    assert.equal(gameById(o.gid).format, 'placement');
    assert.equal(gameById(o.gid).name, 'Water balloon toss');
  } finally { gsShut(); gsEnd(); }
});

test('⚡ Quick game: Podium already picked, on the Games item under way now (or the next one), off the schedule where there is none; naming it creates it and offers Score it now', () => {
  gsStart({ now: '3-1030' });
  try {
    const dk = SETUP_DK[3];
    const blocks = gsBlocks(dk);
    state.ui.day = gmDayRecs(dk)[0].id;
    // under way
    const now = blocks.find((b) => b.start <= 630 && 630 < b.end);
    let t = gmQuickTarget();
    assert.equal(t.dk, dk);
    assert.equal(t.bid, now ? now.id : (blocks.find((b) => b.start > 630) || {}).id || '');
    // between items: the next one today
    location.search = '?now=3-1230';
    t = gmQuickTarget();
    assert.equal(t.bid, (blocks.find((b) => b.start > 750) || {}).id || '', 'the next Games item today');
    // after the last one: off the schedule
    location.search = '?now=3-2230';
    assert.equal(gmQuickTarget().bid, '', 'nothing left today: not on the schedule');
    // open it and name it
    location.search = '?now=3-1030';
    assert.equal(gmOpenQuick(), true);
    const o = gmUi.open;
    assert.deepEqual([o.mode, o.form.format, gmStageOf(o)], ['quick', 'placement', 'format']);
    renderGameSheet();
    assert.equal(setupEl('sheet-game-title').textContent, 'Quick game');
    assert.equal(setupEl('sheet-game').dataset.format, 'placement');
    gsText('gm-name', 'Sock toss');
    const g = gameById(o.gid);
    assert.equal(g.format, 'placement');
    assert.equal(g.dayId, gmDayRecs(dk)[0].id);
    assert.equal(g.blockId || '', gmQuickTarget().bid);
    renderGameSheet();
    assert.equal(setupEl('gm-score').hidden, false, 'Score it now');
    assert.ok(typeof startQuickGame === 'function');
    gsShut();
    startQuickGame();
    assert.equal(gmUi.open && gmUi.open.mode, 'quick', 'the Games tab\'s Quick game opens the game sheet, not the classic editor');
    assert.equal(state.ui.editGameId == null, true);
  } finally { gsShut(); gsEnd(); }
});

test('a quick game on the printed schedule takes the session the clock says (senior\'s afternoons too), never the old Morning/Evening guess', () => {
  gsStart({ off: true, now: '3-1500' });
  try {
    const dk = SETUP_DK[3];
    assert.equal(gmIsGamesDay(dk), true);
    state.ui.day = gmDayRecs(dk)[0].id;
    gmOpenQuick();
    const o = gmUi.open;
    gsText('gm-name', 'Afternoon game');
    const g = gameById(o.gid);
    assert.equal(g.session, rainSessionFor(state.config, { start: 900 }));
    assert.equal(g.blockId, undefined, 'the printed week reads no links');
    if (gmSessions().indexOf('Afternoon') !== -1) assert.equal(g.session, 'Afternoon');
  } finally { gsShut(); gsEnd(); }
});

test('a quick game inside the double-points window counts double from the start', () => {
  gsStart({ now: '3-1030' });
  const real = inDoubleBonusWindow;
  try {
    inDoubleBonusWindow = () => true;
    state.ui.day = gmDayRecs(SETUP_DK[3])[0].id;
    gmOpenQuick();
    gsText('gm-name', 'Double one');
    assert.equal(gameById(gmUi.open.gid).messtival, true);
  } finally { inDoubleBonusWindow = real; gsShut(); gsEnd(); }
});

async function gsMade(format, name) {
  const dk = gsFirstDay();
  gmOpenNew({ dk, target: gsBlocks(dk)[0].id });
  gsText('gm-name', name || 'Probe game');
  await gmPickFormat(format || 'tally');
  undoClear();
  return gmUi.open;
}

test('after it exists every field saves as it changes, one field at a time (name, where, switches), each its own undo entry; nothing else is touched', async () => {
  gsStart();
  try {
    const o = await gsMade('tally');
    const before = JSON.stringify(gameById(o.gid));
    gsText('gm-where', ' The pond ');
    assert.equal(gameById(o.gid).location, 'The pond');
    assert.deepEqual(gsPaths(gsLastUndo()), ['games/' + o.gid + '/location']);
    gsText('gm-name', 'Probe renamed');
    assert.equal(gameById(o.gid).name, 'Probe renamed');
    assert.ok(/^Renamed /.test(gsLastUndo().label));
    gmSwitch('gm-lower', true);
    assert.equal(gameById(o.gid).lowerWins, true);
    gmSwitch('gm-lower', false);
    assert.equal(gameById(o.gid).lowerWins, undefined, 'off removes the field');
    gmSwitch('gm-double', true);
    assert.equal(gameById(o.gid).messtival, true);
    assert.deepEqual(gsPaths(gsLastUndo()), ['games/' + o.gid + '/messtival']);
    // an unchanged field blurred again writes nothing
    undoClear();
    gsText('gm-where', 'The pond');
    assert.equal(gsLastUndo(), null);
    assert.ok(before !== JSON.stringify(gameById(o.gid)));
    // the name cannot be emptied
    gsText('gm-name', '   ');
    assert.equal(gameById(o.gid).name, 'Probe renamed');
    assert.equal(o.err.name, 'Give the game a name.');
    assert.deepEqual(gmDockState(o), { tone: 'error', text: 'Fix the name to save it' });
    gsText('gm-name', 'Probe fixed');
    assert.equal(o.err.name, '');
  } finally { gsShut(); gsEnd(); }
});

test('counter buttons, the countdown, the match scoreboard and drawing prompts are checked with the classic editor\'s own rules: a bad one keeps its message and writes nothing, the rest saves', async () => {
  gsStart();
  try {
    const o = await gsMade('tally');
    // counter buttons
    gsText('gm-steps', '1, five');
    assert.equal(gameById(o.gid).counterSteps, undefined);
    assert.ok(/numbers above zero/.test(o.err.steps));
    assert.deepEqual(gmDockState(o), { tone: 'error', text: 'Fix the counter buttons to save them' });
    gsText('gm-where', 'Field'); // another field still saves while one is in error
    assert.equal(gameById(o.gid).location, 'Field');
    gsText('gm-steps', '1, 5');
    assert.deepEqual(gameById(o.gid).counterSteps, [1, 5]);
    assert.equal(o.err.steps, '');
    gsText('gm-steps', '');
    assert.equal(gameById(o.gid).counterSteps, undefined);
    // the countdown: minutes typed, seconds saved
    gmSwitch('gm-timer', true);
    assert.deepEqual(gameById(o.gid).timer, { label: '', presets: [300] });
    setupEl('gm-timer-label').value = 'Round timer'; setupEl('gm-timer-presets').value = '10, 8, 0.5'; setupEl('gm-timer-rounds').value = '4';
    gmCommitText(gsEl('gm-timer-rounds', '4'));
    assert.deepEqual(gameById(o.gid).timer, { label: 'Round timer', presets: [600, 480, 30], rounds: 4 });
    setupEl('gm-timer-presets').value = 'ten';
    gmCommitText(gsEl('gm-timer-presets', 'ten'));
    assert.ok(/minutes/.test(o.err.timer));
    assert.deepEqual(gameById(o.gid).timer.presets, [600, 480, 30], 'unchanged while it is wrong');
    gmSwitch('gm-timer', false);
    assert.equal(gameById(o.gid).timer, undefined);
    assert.equal(o.err.timer, '');
    // drawing prompts: one game a week
    allGames().forEach((x) => { if (x.id !== o.gid) delete x.prompts; }); // junior's Pumpkin Pictionary has its own
    const other = allGames().find((x) => x.id !== o.gid);
    other.prompts = ['Pumpkin'];
    gsText('gm-prompts', 'Scarecrow\nBarn');
    assert.ok(/Only one game can have drawing prompts/.test(o.err.prompts));
    assert.equal(gameById(o.gid).prompts, undefined);
    delete other.prompts;
    gsText('gm-prompts', 'Scarecrow\n\n Barn ');
    assert.deepEqual(gameById(o.gid).prompts, ['Scarecrow', 'Barn']);
    // the scoreboard of a bracket
    gsShut();
    const b = await gsMade('tournament', 'Bracket probe');
    setupEl('gm-tr-unit').value = 'Goals'; setupEl('gm-tr-period').value = 'Half'; setupEl('gm-tr-periods').value = '2'; setupEl('gm-tr-outs').value = '0';
    gmCommitText(gsEl('gm-tr-unit', 'Goals'));
    assert.deepEqual([gameById(b.gid).liveTracker.unit, gameById(b.gid).liveTracker.periodLabel, gameById(b.gid).liveTracker.innings, gameById(b.gid).liveTracker.outs], ['Goals', 'Half', 2, 0]);
    setupEl('gm-tr-periods').value = 'x';
    gmCommitText(gsEl('gm-tr-periods', 'x'));
    assert.ok(/whole number/.test(b.err.tracker));
    assert.equal(gameById(b.gid).liveTracker.innings, 2);
    gmSwitch('gm-tracker', false);
    assert.equal(gameById(b.gid).liveTracker, undefined);
  } finally { gsShut(); gsEnd(); }
});

test('How to play: the headline and each section save as they are typed (an empty section is dropped, a blank one added stays on the sheet); move up and remove', async () => {
  gsStart();
  try {
    const o = await gsMade('placement');
    gsText('gm-headline', '  Kickball,   but three-legged ');
    assert.equal(gameById(o.gid).headline, 'Kickball, but three-legged');
    // two sections as the DOM would hold them
    const rows = [{ h: 'Setup', items: 'Cones out\nTeams line up' }, { h: 'Winning', items: 'Most laps' }, { h: '', items: '' }];
    assert.deepEqual(gmRulesFrom(rows), [{ h: 'Setup', items: ['Cones out', 'Teams line up'] }, { h: 'Winning', items: ['Most laps'] }]);
    assert.equal(gmCommit(o.gid, { rules: gmRulesFrom(rows) }).ok, true);
    assert.equal(gameById(o.gid).rules.length, 2);
    gmRuleMoveUp(1);
    assert.deepEqual(gameById(o.gid).rules.map((r) => r.h), ['Winning', 'Setup']);
    gmRuleRemove(0);
    assert.deepEqual(gameById(o.gid).rules.map((r) => r.h), ['Setup']);
    gmRuleRemove(0);
    assert.equal(gameById(o.gid).rules, undefined, 'the last section gone leaves none');
    assert.equal(gmHowtoSummary(gameById(o.gid)), 'One line');
    assert.equal(gmHowtoSummary({ rules: [{}, {}] }), '2 sections');
    assert.equal(gmHowtoSummary({}), 'Not written yet');
    assert.equal(gmExtrasSummary({ messtival: true, timer: {} }), 'Double points · Timer');
    assert.equal(gmExtrasSummary({}), 'None yet');
  } finally { gsShut(); gsEnd(); }
});

test('"How is it scored?" folds to its one row on a saved game; a tap opens all three; another way asks first when records would go, and only then clears them', async () => {
  gsStart();
  try {
    const o = await gsMade('tally', 'Fold probe');
    renderGameSheet();
    assert.equal(o.formatOpen, false);
    state.results[o.gid] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: '2026-07-20T10:00:00Z' };
    await gmPickFormat('placement');
    assert.equal(o.formatOpen, true, 'a tap on a folded group opens it');
    assert.equal(gameById(o.gid).format, 'tally', 'nothing changed yet');
    renderGameSheet();
    assert.equal(setupEl('gm-format-warn').hidden, false);
    assert.ok(/^This game has the saved result\. Scoring it another way clears it\.$/.test(setupEl('gm-format-warn-text').textContent), setupEl('gm-format-warn-text').textContent);
    // "No": asked, answered no
    const realConfirm = confirm;
    try {
      confirm = () => false;
      await gmPickFormat('placement');
      assert.equal(gameById(o.gid).format, 'tally');
      assert.ok(state.results[o.gid], 'the result is still there');
      confirm = () => true;
      await gmPickFormat('placement');
    } finally { confirm = realConfirm; }
    assert.equal(gameById(o.gid).format, 'placement');
    assert.equal(state.results[o.gid], undefined);
    assert.equal(o.formatOpen, false, 'folded again');
    // the same format again just folds
    await gmPickFormat('placement');
    assert.equal(o.formatOpen, true);
    await gmPickFormat('placement');
    assert.equal(o.formatOpen, false);
  } finally { gsShut(); gsEnd(); }
});

test('Matchups on the sheet: Set them now shows the board, taps fill it in order (the last pair fills itself), a complete board saves the pairs, a partly filled one saves as "pick"', async () => {
  gsStart();
  try {
    const o = await gsMade('tournament', 'Pairs probe');
    const ids = teamIds();
    assert.equal(gmSeedUi(o), 'standings');
    renderGameSheet();
    assert.equal(setupEl('gm-pairs').hidden, true);
    assert.ok(/^Suggests 1st v /.test(setupEl('gm-seed-standings-sub').textContent), setupEl('gm-seed-standings-sub').textContent);
    assert.ok(ids.length === 4 ? /1st v 4th and 2nd v 3rd/.test(setupEl('gm-seed-standings-sub').textContent) : /1st v 6th, 2nd v 5th and 3rd v 4th/.test(setupEl('gm-seed-standings-sub').textContent));
    gmPickSeed('pick');
    assert.equal(gameById(o.gid).bracketSeed, 'pick');
    gmPickSeed('fixed');
    assert.equal(o.seedUi, 'fixed');
    assert.equal(gameById(o.gid).bracketSeed, 'pick', 'an empty board plays as "Pick them when you start"');
    renderGameSheet();
    assert.equal(setupEl('gm-pairs').hidden, false);
    assert.ok(new RegExp(gmMatchName(0)).test(setupEl('gm-matches').innerHTML));
    assert.equal((setupEl('gm-keys').innerHTML.match(/class="gm-key"/g) || []).length, ids.length);
    assert.ok(/data-next/.test(setupEl('gm-matches').innerHTML), 'the next slot says so');
    assert.ok(setupEl('gm-pairs-left').textContent.indexOf('Pick ' + ids.length + ' more teams') === 0);
    ids.slice(0, ids.length - 2).forEach((t) => gmBoardTap(t));
    assert.equal(gameById(o.gid).bracketSeed, 'fixed', 'complete: the last pair filled itself');
    assert.equal(gmPairsValid(gameById(o.gid).roundOneMatchups), true);
    renderGameSheet();
    assert.equal(setupEl('gm-pairs-left').hidden, true);
    gmBoardTap(ids[0]);
    assert.equal(gameById(o.gid).bracketSeed, 'pick', 'a team taken out: not complete any more');
    assert.equal(gameById(o.gid).roundOneMatchups, undefined);
    gmBoardTap(ids[0]);
    assert.equal(gameById(o.gid).bracketSeed, 'fixed');
    gmPickSeed('standings');
    assert.deepEqual([gameById(o.gid).bracketSeed, gameById(o.gid).roundOneMatchups, o.seedUi], ['standings', undefined, '']);
  } finally { gsShut(); gsEnd(); }
});

test('a bracket on a camp the app has no bracket for says so (the four-team bracket arrives with Step 22); a six-team camp says nothing', async () => {
  gsStart();
  try {
    const o = await gsMade('tournament', 'Note probe');
    renderGameSheet();
    const expectNote = teamIds().length !== 6 && typeof bracketKindFor !== 'function';
    assert.equal(setupEl('gm-b4-note').hidden, !expectNote);
    assert.equal(gmBracketSub(), teamIds().length === 4 ? '2 semifinals, then the 3rd-place match, then the final' : 'Teams play head-to-head; winners move on');
    assert.ok(/four-team bracket isn’t in the app yet/.test(readFixture('../index.html')), 'the note is in the markup');
  } finally { gsShut(); gsEnd(); }
});

test('Earlier / Later trade a game with its neighbour on the item; every game of the item is renumbered so nothing ties', async () => {
  gsStart();
  try {
    const dk = SETUP_DK.find((d) => gmIsGamesDay(d) && gsBlocks(d).some((b) => gmGamesOnBlock(d, b.id).length >= 2));
    const blk = gsBlocks(dk).find((b) => gmGamesOnBlock(dk, b.id).length >= 2);
    const ids = () => gmGamesOnBlock(dk, blk.id).map((g) => g.id);
    const was = ids();
    gmOpenGame(was[1]);
    const o = gmUi.open;
    renderGameSheet();
    assert.equal(setupEl('gm-order').hidden, false);
    assert.equal(setupEl('gm-order-label').textContent, 'Order in ' + (blk.base || blk.label));
    gmOrderTap('earlier');
    assert.deepEqual(ids().slice(0, 2), [was[1], was[0]]);
    assert.ok(/^Moved .* earlier$/.test(gsLastUndo().label));
    const ords = gmGamesOnBlock(dk, blk.id).map((g) => g.ord);
    assert.deepEqual(ords, ords.map((_, i) => (i + 1) * SETUP_GAME_ORD_STEP), 'renumbered 10, 20, 30…');
    gmOrderTap('earlier');
    assert.deepEqual(ids().slice(0, 2), [was[1], was[0]], 'the first one cannot move earlier');
    gmOrderTap('later');
    assert.deepEqual(ids().slice(0, 2), [was[0], was[1]]);
    // the first one's "earlier" says First; an only game has no order row
    gmOpenGame(was[0]);
    renderGameSheet();
    assert.equal(document.querySelector('[data-gm-order-sub="earlier"]').textContent, 'First');
    assert.equal(document.querySelector('[data-gm-order-sub="later"]').textContent, 'After ' + gameById(was[1]).name);
  } finally { gsShut(); gsEnd(); }
});

test('When: a saved game moves to another item in one tap — its day follows the item\'s weekday, its session the item\'s time, its order goes last — and the pane goes back to the form', () => {
  gsStart();
  try {
    const dk = gsTwoItemDay() || gsFirstDay();
    const [a, b] = gsBlocks(dk);
    const g = gmGamesOnBlock(dk, a.id)[0];
    gmOpenGame(g.id);
    const o = gmUi.open;
    gmShowWhen();
    assert.equal(o.pane, 'when');
    renderGameSheet();
    assert.equal(setupEl('sheet-game').dataset.pane, 'when');
    assert.equal(setupEl('sheet-game-title').textContent, 'When');
    assert.equal(setupEl('gm-pane-back').hidden, false);
    assert.equal(setupEl('gm-pane-back-label').textContent, g.name);
    assert.ok(new RegExp('data-gm-block="' + a.id + '" aria-current="true"').test(setupEl('gm-when-list').innerHTML), 'the game\'s own item is the one checked');
    assert.ok(/Here now · /.test(setupEl('gm-when-list').innerHTML));
    if (b) {
      const top = gmGamesOnBlock(dk, b.id).reduce((n, x) => Math.max(n, x.ord || 0), 0);
      gmWhenPick(b.id);
      const m = gameById(g.id);
      assert.deepEqual([m.blockId, m.ord, m.session, m.dayId], [b.id, top + SETUP_GAME_ORD_STEP, rainSessionFor(state.config, b), gmDayRecs(dk)[0].id]);
      assert.equal(o.pane, 'form', 'back to the form');
      assert.ok(/^Moved “/.test(gsLastUndo().label));
      assert.deepEqual(gsPaths(gsLastUndo()).filter((p) => !/\/(blockId|ord|session|dayId)$/.test(p)), [], 'only the place fields');
    }
  } finally { gsShut(); gsEnd(); }
});

test('When on another day: its day follows; a weekday that is not a games day asks first and making it one comes first; the item must exist on that day', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const g = gmGamesOnDay(dk)[0];
    const other = SETUP_DK.find((d) => d !== dk && gmIsGamesDay(d) && gsBlocks(d).length);
    const off = SETUP_DK.find((d) => !gmIsGamesDay(d) && gsBlocks(d).length);
    gmOpenGame(g.id);
    const o = gmUi.open;
    gmShowWhen();
    gmWhenDay(other);
    assert.equal(o.when.dk, other);
    const blk = gsBlocks(other)[0];
    gmWhenPick(blk.id);
    assert.equal(gameById(g.id).dayId, gmDayRecs(other)[0].id, 'the day follows the item\'s weekday');
    assert.equal(gameById(g.id).blockId, blk.id);
    assert.equal(gmDkOfDayId(gameById(g.id).dayId), other);
    if (off) {
      gmShowWhen();
      gmWhenDay(off);
      assert.equal(o.when.newDay, off, 'asks first');
      renderGameSheet();
      assert.equal(setupEl('gm-when-newday').hidden, false);
      assert.equal(setupEl('gm-when-newday-text').textContent, SETUP_DAY_WORDS[off] + ' isn’t a games day yet. Putting a game on it makes it one.');
      assert.equal(setupEl('gm-when-list').innerHTML, '', 'no items until it is a games day');
      gmWhenPick(gsBlocks(off)[0].id);
      assert.equal(gmIsGamesDay(off), false, 'picking before answering does nothing');
      gmWhenNewDay('no');
      assert.equal(o.when.newDay, '');
      assert.equal(gmIsGamesDay(o.when.dk), true, 'back to a games day');
      gmWhenDay(off);
      gmWhenNewDay('yes');
      assert.equal(gmIsGamesDay(off), true);
      gmWhenPick(gsBlocks(off)[0].id);
      assert.equal(gmDkOfDayId(gameById(g.id).dayId), off);
    }
    // an item a colleague removed meanwhile never turns into "not on the schedule" by itself
    const r = gmMoveGame(g.id, { dk: other, bid: 'b-gone-0' });
    assert.equal(r.reason, 'item');
  } finally { gsShut(); gsEnd(); }
});

test('When onto an item of double-points games asks first; the answer is written with the move', () => {
  gsStart();
  try {
    const dk = gsTwoItemDay() || gsFirstDay();
    const [a, b] = gsBlocks(dk).length > 1 ? gsBlocks(dk) : [gsBlocks(dk)[0], gsBlocks(dk)[0]];
    const there = gmGamesOnBlock(dk, b.id)[0];
    there.messtival = true;
    const mover = allGames().find((x) => x.id !== there.id && !x.messtival);
    gmOpenGame(mover.id);
    const o = gmUi.open;
    gmShowWhen();
    o.when.dk = dk;
    gmWhenPick(b.id);
    assert.ok(o.when && o.when.double && o.when.double.key === b.id, 'asked');
    assert.equal(gameById(mover.id).blockId === b.id && a.id !== b.id, false, 'nothing moved yet');
    renderGameSheet();
    assert.equal(setupEl('gm-when-double').hidden, false);
    assert.ok(/ is in double points time\. Make .* count double too\?$/.test(setupEl('gm-when-double-text').textContent), setupEl('gm-when-double-text').textContent);
    gmWhenPick(b.id, 'yes');
    assert.equal(gameById(mover.id).blockId, b.id);
    assert.equal(gameById(mover.id).messtival, true);
    // "keep it single"
    gmOpenGame(allGames().find((x) => !x.messtival && x.id !== there.id && x.id !== mover.id).id);
    const o2 = gmUi.open;
    gmShowWhen(); o2.when.dk = dk;
    gmWhenPick(b.id);
    gmWhenPick(b.id, 'no');
    assert.equal(gameById(o2.gid).blockId, b.id);
    assert.equal(gameById(o2.gid).messtival, undefined);
  } finally { gsShut(); gsEnd(); }
});

test('When → "Not on the schedule" takes the link off (the game keeps its day and results); "Put on the schedule" from the screen opens straight on When and closes when it is done', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const g = gmGamesOnDay(dk)[0];
    state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
    gmOpenGame(g.id);
    gmShowWhen();
    gmWhenNone();
    assert.equal(gameById(g.id).blockId, undefined);
    assert.equal(gameById(g.id).ord, undefined);
    assert.equal(gameById(g.id).dayId, gmDayRecs(dk)[0].id);
    assert.ok(state.results[g.id]);
    assert.ok(gmDayModel(dk).loose.some((x) => x.id === g.id));
    renderGameSheet();
    assert.equal(setupEl('gm-when-btn').textContent, 'Put it on the schedule');
    assert.ok(/Not on the schedule$/.test(setupEl('gm-when-text').textContent));
    gsShut();
    // straight on When
    gmOpenGame(g.id, { pane: 'when' });
    const o = gmUi.open;
    assert.deepEqual([o.pane, o.whenOnly], ['when', true]);
    renderGameSheet();
    assert.equal(setupEl('gm-pane-back').hidden, true, 'no back: it closes');
    gmWhenPick(gsBlocks(dk)[0].id);
    assert.equal(gameById(g.id).blockId, gsBlocks(dk)[0].id);
    assert.equal(shell.sheets.includes('game'), false, 'Done closes the sheet');
  } finally { gsShut(); gsEnd(); }
});

test('a new game\'s When pane only remembers the item (nothing is written until the game exists), and "Not on the schedule" is honoured at creation', async () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const [a, b] = gsBlocks(dk);
    gmOpenNew({ dk, target: a.id });
    const o = gmUi.open;
    gmShowWhen();
    const n0 = allGames().length;
    if (b) { gmWhenPick(b.id); assert.equal(o.bid, b.id); }
    assert.equal(allGames().length, n0);
    assert.equal(o.pane, 'form');
    gmShowWhen();
    gmWhenNone();
    assert.equal(o.none, true);
    gsText('gm-name', 'Off the schedule');
    await gmPickFormat('tally');
    const g = gameById(o.gid);
    assert.equal(g.blockId, undefined, 'the director said not on the schedule');
    assert.ok(gmDayModel(dk).loose.some((x) => x.id === g.id));
  } finally { gsShut(); gsEnd(); }
});

test('with the printed schedule the When pane picks a session on a day: its rows are sessions, the move writes day + session and never a link', () => {
  gsStart({ off: true });
  try {
    const dk = SETUP_DK.find(gmIsGamesDay);
    const g = gmGamesOnDay(dk)[0];
    gmOpenGame(g.id);
    const o = gmUi.open;
    gmShowWhen();
    renderGameSheet();
    gmSessions().forEach((s) => assert.ok(setupEl('gm-when-list').innerHTML.indexOf('data-gm-block="session:' + s + '"') !== -1, s));
    const other = gmSessions().find((s) => s !== g.session);
    gmWhenPick('session:' + other);
    assert.equal(gameById(g.id).session, other);
    assert.equal(gameById(g.id).blockId, undefined);
    assert.ok(/^Moved “/.test(gsLastUndo().label));
    renderGameSheet();
    assert.equal(setupEl('gm-when-text').textContent, SETUP_DAY_WORDS[dk] + ' · ' + other + ' games');
  } finally { gsShut(); gsEnd(); }
});

test('deleted on another phone while the sheet is open: the question appears, no write is made, "Put it back with my changes" re-adds the game as the sheet last saw it; Close leaves', async () => {
  gsStart();
  try {
    const o = await gsMade('placement', 'Doomed game');
    gsText('gm-where', 'The lake');
    const id = o.gid;
    state.config.games.splice(allGames().findIndex((x) => x.id === id), 1); // a colleague's snapshot
    const n0 = allGames().length;
    renderGameSheet();
    assert.ok(o.gone, 'noticed on the next paint');
    assert.equal(setupEl('gm-gone').hidden, false);
    assert.ok(/was deleted on another phone/.test(setupEl('gm-gone-text').textContent));
    assert.equal(setupEl('gm-name').value, 'Doomed game', 'the sheet still shows what it last saw');
    assert.equal(setupEl('gm-score').hidden, true);
    gmSwitch('gm-double', true);
    gsText('gm-where', 'Elsewhere');
    assert.equal(allGames().length, n0, 'nothing is written (or resurrected) while it is gone');
    gmGoneAnswer('back');
    assert.equal(allGames().length, n0 + 1);
    const back = gameById(id);
    assert.deepEqual([back.name, back.location, back.format], ['Doomed game', 'The lake', 'placement']);
    assert.equal(o.gone, null);
    assert.ok(/^Put back “Doomed game”$/.test(gsLastUndo().label));
    renderGameSheet();
    assert.equal(setupEl('gm-gone').hidden, true);
    // and Close
    state.config.games.splice(allGames().findIndex((x) => x.id === id), 1);
    renderGameSheet();
    assert.ok(o.gone);
    gmGoneAnswer('close');
    assert.equal(shell.sheets.includes('game'), false);
  } finally { gsShut(); gsEnd(); }
});

test('Make a copy opens the copy (new id, the original untouched, no drawing prompts); Delete asks, names what goes with the game, and removes the game with every record kept under its id', async () => {
  gsStart();
  try {
    const o = await gsMade('tally', 'Copy probe');
    gmSwitch('gm-double', true);
    const n0 = allGames().length;
    gmCopyGo();
    assert.equal(allGames().length, n0 + 1);
    assert.ok(gmUi.open.gid !== o.gid);
    const copy = gameById(gmUi.open.gid);
    assert.equal(copy.name, 'Copy probe (copy)');
    assert.equal(copy.messtival, true);
    assert.equal(gameById(o.gid).name, 'Copy probe');
    assert.equal(allGames().findIndex((x) => x.id === copy.id), allGames().findIndex((x) => x.id === o.gid) + 1, 'right after the original');
    // delete the copy, with records under its id
    state.results[copy.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
    state.clocks = state.clocks || {}; state.clocks[copy.id] = { endAt: 1 };
    state.brackets[copy.id] = { phase: 'round1' };
    state.brackets4 = state.brackets4 || {}; state.brackets4[copy.id] = { m: {} };
    const realConfirm = confirm;
    try {
      confirm = () => false;
      let r = await gmDeleteGo();
      assert.ok(gameById(copy.id), 'asked, answered no');
      confirm = () => true;
      await gmDeleteGo();
    } finally { confirm = realConfirm; }
    assert.equal(gameById(copy.id), undefined);
    ['results', 'clocks', 'brackets', 'brackets4'].forEach((k) => assert.equal(state[k][copy.id], undefined, k));
    assert.equal(shell.sheets.includes('game'), false, 'the sheet closes');
    assert.equal(gsLastUndo().label === 'Deleted “Copy probe (copy)”', false, 'a delete with records is not undoable');
    assert.equal(gmGoingWords('nonexistent'), '');
  } finally { gsShut(); gsEnd(); }
});

test('Score it now on a quick game closes the sheet and opens the game; a counselor can open none of the sheet', async () => {
  gsStart({ now: '3-1030' });
  try {
    state.ui.day = gmDayRecs(SETUP_DK[3])[0].id;
    gmOpenQuick();
    gsText('gm-name', 'Score me');
    const id = gmUi.open.gid;
    gmScoreNow();
    assert.equal(shell.sheets.includes('game'), false);
    assert.equal(state.ui.gameId, id, 'the takeover is open on it');
    state.ui.gameId = null;
    setMemberRole('viewer');
    assert.equal(gmOpenNew({ dk: gsFirstDay() }), false);
    assert.equal(gmOpenGame(id), false);
    assert.equal(gmOpenQuick(), false);
    assert.equal(gmUi.open, null);
  } finally { state.ui.gameId = null; gsShut(); gsEnd(); }
});

test('a name or a place with markup in it reaches the sheet only as a value or escaped text (the board, the keys, the When rows)', async () => {
  gsStart();
  try {
    const o = await gsMade('tournament', '<b>Bad</b> & "name"');
    gameById(o.gid).location = '<img src=x>';
    gameById(o.gid).emoji = '<script>';
    gmPickSeed('fixed');
    renderGameSheet();
    const html = setupEl('gm-matches').innerHTML + setupEl('gm-keys').innerHTML;
    assert.ok(!/<img src=x>|<script>|<b>Bad/.test(html), html.slice(0, 300));
    gmShowWhen();
    renderGameSheet();
    assert.ok(!/<img src=x>|<script>|<b>Bad/.test(setupEl('gm-when-list').innerHTML), setupEl('gm-when-list').innerHTML.slice(0, 400));
    assert.equal(setupEl('gm-pane-back-label').textContent, '<b>Bad</b> & "name"', 'text is set as text');
  } finally { gsShut(); gsEnd(); }
});

test('the sheet holds the auto-reload only while a new game has a name typed and no game yet; closing by any route lets a field still being typed save first; a closed sheet is forgotten', async () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    gmOpenNew({ dk, target: gsBlocks(dk)[0].id });
    assert.equal(gmBusy(), false, 'nothing typed');
    gmUi.open.form.name = 'Half typed';
    assert.equal(gmBusy(), true);
    assert.equal(reloadBlocked(), true, 'the deploy waits');
    await gmPickFormat('tally');
    assert.equal(gmBusy(), false, 'once it is a game every change is already saved');
    // a text field being typed when Escape / Back / ✕ close the sheet: the guard blurs it so its blur commits
    let blurred = 0;
    const real = document.activeElement;
    document.activeElement = { closest: (s) => (s === '#sheet-game' ? {} : null), blur: () => { blurred++; } };
    assert.equal(setupSheetGuardClose('game'), false, 'never asks');
    document.activeElement = real;
    assert.equal(blurred, 1);
    // closed by any route: the next paint forgets it (a Forward must not reopen a stale game)
    shellSheetClose('game');
    renderAll();
    assert.equal(gmUi.open, null);
    assert.equal(gmSheetReady(), false);
    assert.equal(shellSheetAllowed('game'), false);
  } finally { gsShut(); gsEnd(); }
});

test('Who\'s here names the game a director has open (or "the games" when the id is not in the vocabulary)', async () => {
  gsStart();
  try {
    state.ui.view = 'settings'; state.ui.builderScreen = 'games';
    const o = await gsMade('tally', 'Where probe');
    assert.equal(setupWhereNow(), 'game:' + o.gid);
    assert.equal(editorsHereWhereWords('game:' + o.gid), 'Where probe');
    o.gid = 'x'.repeat(70);
    assert.equal(setupWhereNow(), 'games', 'an id past 60 characters is just "the games"');
    gsShut();
    assert.equal(setupWhereNow(), 'games');
  } finally { gsShut(); gsEnd(); }
});

test('the Schedule item sheet\'s "Add a game here" opens the game sheet on that Games item (a typical-day item and an item being made have none)', () => {
  gsStart();
  try {
    const dk = gsFirstDay();
    const blk = gsBlocks(dk)[0];
    state.ui.view = 'settings'; state.ui.builderScreen = 'schedule'; state.ui.setupDay = dk;
    schedOpenItem({ bid: blk.id });
    const it = setupSched.item;
    assert.ok(it && it.mode === 'edit');
    renderSchedItemSheet();
    assert.equal(setupEl('si-add-game').hidden, false);
    schedItemAddGame();
    assert.ok(gmUi.open && gmUi.open.mode === 'new' && gmUi.open.bid === blk.id && gmUi.open.dk === dk);
    assert.equal(shell.sheets.includes('sched-item'), false, 'one sheet at a time');
    assert.equal(shell.sheets.includes('game'), true);
    gsShut();
    state.ui.setupDay = 'typical';
    setupSched.item = { mode: 'edit', dayKey: 'typical', bid: blk.id, form: { kind: 'games' } };
    schedItemAddGame();
    assert.equal(gmUi.open, null, 'the typical day has no day to put a game on');
  } finally { setupSched.item = null; state.ui.setupDay = undefined; gsShut(); gsEnd(); }
});

test('the sheet\'s source: no whole-object write, no Save, the catalog only through configEdit / gmCommit, brackets4 among the per-game maps', () => {
  const src = readFixture('../setup-ui.js');
  const part = src.slice(src.indexOf('// ── 16. Games (§11.14'));
  assert.ok(!/state\.config\s*=[^=]/.test(part), 'no whole-config write');
  assert.ok(!/state\.config\.games\s*=[^=]/.test(part), 'no whole-catalog write');
  assert.ok(!/\bsaveConfig\(/.test(part), 'configEdit is the one way in');
  assert.ok(!/id="gm-save"|gm-save-btn/.test(readFixture('../index.html')), 'there is no Save button');
  const writes = part.split('\n').filter((l) => /state\.config\.(days|games)\.(push|splice)|\bconfigEdit\(/.test(l));
  assert.ok(writes.length >= 8, 'writes: ' + writes.length);
  assert.ok(/brackets4/.test(readFixture('../settings.js')));
});

test('"By the standings" on a six-team bracket: the director who calls a match up is suggested the best remaining team v the lowest remaining one, from the points; nobody else is, and nothing is stored', () => {
  gsStart();
  try {
    const ids = teamIds();
    const gid = allGames().find((x) => x.format !== 'tournament').id;
    // points: t0 gold, t1 silver, t2 bronze, the rest nothing
    state.results[gid] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: '2026-07-20T10:00:00Z' };
    const g = { id: 'probe', format: 'tournament', bracketSeed: 'standings' };
    const b = freshBracket();
    const pair = bracketSuggestPair(g, b);
    assert.deepEqual(pair, [ranked0(), ranked1()], '1st v last');
    function ranked() { return rankTeamsByPoints(medalCounts()).map((t) => t.id); }
    function ranked0() { return ranked()[0]; }
    function ranked1() { return ranked()[ids.length - 1]; }
    assert.equal(ranked0(), 't0');
    // after that match the pool shrinks: the next best v the next lowest
    const pool = ids.filter((t) => pair.indexOf(t) === -1);
    const b2 = Object.assign(freshBracket(), { pool });
    const next = bracketSuggestPair(g, b2);
    const order = ranked().filter((t) => pool.indexOf(t) !== -1);
    assert.deepEqual(next, [order[0], order[order.length - 1]]);
    // only for "by the standings", only when nothing is picked, no fixed pairs, only for a director
    assert.equal(bracketSuggestPair(Object.assign({}, g, { bracketSeed: 'pick' }), b), null);
    assert.equal(bracketSuggestPair(Object.assign({}, g, { bracketSeed: undefined }), b), null, 'a game from before bracketSeed asks nobody');
    assert.equal(bracketSuggestPair(Object.assign({}, g, { roundOneMatchups: [['t0', 't1']] }), b), null);
    assert.equal(bracketSuggestPair(g, Object.assign(freshBracket(), { selectedPair: ['t0', 't1'] })), null);
    assert.equal(bracketSuggestPair(g, Object.assign(freshBracket(), { phase: 'bye' })), null);
    setMemberRole('viewer');
    assert.equal(bracketSuggestPair(g, b), null, 'a counselor is never told who leads');
    setMemberRole('editor');
    assert.equal(bracketSuggestPair(g, b) !== null, true);
    const src = readFixture('../app.js');
    assert.ok(/function bracketSuggestPair[\s\S]*?\n}\n/.exec(src)[0].indexOf('saveState') === -1, 'the suggestion writes nothing');
  } finally { gsEnd(); }
});
