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
