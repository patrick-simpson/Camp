// The classic week builder's create / edit / delete paths (settings.js), pinned
// BEFORE the setup rebuild touches them (setup-rebuild-spec S0b, "pin first").
// Every one of these writes the synced config and the score state in one go, so
// a quiet change in what they leave behind — a clock nobody can stop, a bracket
// under the wrong format — only shows up mid-week.
//
// Tests assert on state and return values, never on markup (see CLAUDE.md).

function crudSetup() {
  window.scrollTo = () => {}; // an open builder scrolls on a view change
  freshState();
  setMemberRole('editor');
  state.ui.view = 'settings';
  state.ui.editGameId = null;
  gameDraft = null;
  gameDraftFor = null;
  return state.config.games;
}

// A game open in the editor, as the person would have it, then saved.
function openDraft(gameId) {
  state.ui.editGameId = gameId;
  ensureGameDraft();
  return gameDraft;
}

function withConfirm(answer, fn) {
  const real = globalThis.confirm;
  const asked = [];
  globalThis.confirm = (msg) => { asked.push(msg); return typeof answer === 'function' ? answer(msg) : answer; };
  try { fn(asked); } finally { globalThis.confirm = real; }
  return asked;
}

// Everything the app can hold under one game id.
function seedRecords(gid) {
  state.results[gid] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
  state.brackets[gid] = { phase: 'round1', pool: ['t0', 't1'], matches: [], byeTeamId: null };
  state.drafts[gid] = { scores: { t0: 3 }, medals: {} };
  state.live[gid] = { key: 't0-t1', inning: 1, hr: { t0: 1 } };
  state.clocks[gid] = { running: true, endAt: Date.now() + 60000, remaining: 0, duration: 300, round: 1 };
  state.picSetup[gid] = { source: 'own', words: ['a'] };
}

function recordsFor(gid) {
  return ['results', 'brackets', 'drafts', 'live', 'clocks', 'picSetup'].filter((k) => state[k] && state[k][gid]);
}

// ── validateGameDraft ────────────────────────────────────────────

test('validateGameDraft: a name and a format are required', () => {
  crudSetup();
  assert.equal(validateGameDraft({ name: '  ', format: 'placement' }), 'Give the game a name.');
  assert.equal(validateGameDraft({ name: 'X', format: null }), 'Pick a format.');
  assert.equal(validateGameDraft({ name: 'X', format: 'placement' }), null);
});

test('validateGameDraft: only one game may carry drawing prompts', () => {
  crudSetup();
  const drawing = state.config.games.find((g) => Array.isArray(g.prompts) && g.prompts.length);
  assert.ok(drawing, 'precondition: the default week has a drawing game');
  const err = validateGameDraft({ id: 'another', name: 'Another', format: 'placement', prompts: 'Cat\nDog' });
  assert.ok(err && err.includes(drawing.name), String(err));
  assert.equal(validateGameDraft({ id: drawing.id, name: drawing.name, format: 'placement', prompts: 'Cat\nDog' }), null,
    'the drawing game itself may keep its prompts');
  assert.equal(validateGameDraft({ id: 'another', name: 'Another', format: 'placement', prompts: '  ' }), null);
});

test('validateGameDraft: tally counter buttons must be positive numbers', () => {
  crudSetup();
  const tally = (counterSteps) => validateGameDraft({ name: 'T', format: 'tally', counterSteps });
  assert.equal(tally('1, 5'), null);
  assert.equal(tally(''), null, 'blank = the default +1');
  assert.ok(tally('0'));
  assert.ok(tally('1, x'));
  assert.ok(tally('1,,5'), 'an empty slot is refused rather than skipped');
  assert.ok(tally('-3'));
});

test('validateGameDraft: timer presets and rounds', () => {
  crudSetup();
  const timer = (presets, rounds) => validateGameDraft({ name: 'T', format: 'placement', timer: { presets, rounds } });
  assert.equal(timer('5, 3', ''), null);
  assert.equal(timer('5', '4'), null);
  assert.ok(timer('', ''), 'a timer needs at least one preset');
  assert.ok(timer('five', ''));
  assert.ok(timer('0', ''));
  assert.ok(timer('5', '0'), 'rounds is blank or a whole number >= 1');
  assert.ok(timer('5', 'x'));
  assert.ok(timer('5', '2.5'));
});

test('validateGameDraft: scoreboard periods and outs on a bracket game', () => {
  crudSetup();
  const lt = (innings, outs) => validateGameDraft({ name: 'B', format: 'tournament', liveTracker: { innings, outs } });
  assert.equal(lt('2', '3'), null);
  assert.equal(lt('', ''), null);
  assert.equal(lt('2', '0'), null, 'zero outs is allowed');
  assert.ok(lt('0', ''), 'periods must be at least 1');
  assert.ok(lt('abc', ''));
  assert.ok(lt('1', 'x'));
});

// ── saveGameDraft ────────────────────────────────────────────────

test('saveGameDraft: a new game gets a slug id that dodges existing games AND result keys', () => {
  const games = crudSetup();
  state.ui.editGameId = 'new';
  ensureGameDraft();
  Object.assign(gameDraft, { name: '  Sock Hop  ', format: 'placement', emoji: '' });
  const before = games.length;
  saveGameDraft();
  assert.equal(state.config.games.length, before + 1);
  const made = state.config.games[state.config.games.length - 1];
  assert.equal(made.id, 'sock-hop');
  assert.equal(made.name, 'Sock Hop', 'trimmed');
  assert.equal(made.emoji, '🏕️', 'default emoji when none is typed');
  assert.equal(state.ui.editGameId, null, 'the editor closes');
  assert.equal(gameDraft, null, 'and the draft is dropped');

  // A leftover result under the slug (an orphan from another week) is a taken id too.
  state.results['sock-hop-2'] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
  state.ui.editGameId = 'new';
  ensureGameDraft();
  Object.assign(gameDraft, { name: 'Sock Hop', format: 'placement' });
  saveGameDraft();
  assert.equal(state.config.games[state.config.games.length - 1].id, 'sock-hop-3');
});

test('saveGameDraft: validation errors save nothing', () => {
  const games = crudSetup();
  state.ui.editGameId = 'new';
  ensureGameDraft();
  gameDraft.name = ''; // and no format
  const before = JSON.stringify(games);
  saveGameDraft();
  assert.equal(JSON.stringify(state.config.games), before);
  assert.equal(state.ui.editGameId, 'new', 'still in the editor');
  assert.ok(gameDraft, 'draft kept');
});

test('saveGameDraft: text-mode fields are parsed back to real shapes', () => {
  crudSetup();
  state.ui.editGameId = 'new';
  ensureGameDraft();
  Object.assign(gameDraft, {
    name: 'Candy Count', format: 'tally', unit: 'pieces', counterSteps: '1, 5, 10',
    timer: { label: ' Round ', presets: '5, 2.5', rounds: '3' },
    rules: [{ h: ' Setup ', items: ' one \n\n two ' }, { h: '', items: '' }, { h: 'Only a heading', items: '' }],
    messtival: false,
  });
  saveGameDraft();
  const g = state.config.games.find((x) => x.id === 'candy-count');
  assert.deepEqual(g.counterSteps, [1, 5, 10]);
  assert.deepEqual(g.timer, { label: 'Round', presets: [300, 150], rounds: 3 });
  assert.deepEqual(g.rules, [{ h: 'Setup', items: ['one', 'two'] }, { h: 'Only a heading', items: [] }],
    'an entirely empty section is dropped');
  assert.notOk('messtival' in g, 'an unticked double-points flag is not stored');
});

test('saveGameDraft: a single timer round is not stored; prompts become lines', () => {
  crudSetup();
  // The default week already has its one drawing game; free the slot first.
  state.config.games.forEach((g) => { delete g.prompts; });
  state.ui.editGameId = 'new';
  ensureGameDraft();
  Object.assign(gameDraft, {
    name: 'Draw Off', format: 'placement', prompts: 'Cat\n Dog \n',
    timer: { label: '', presets: '2', rounds: '1' },
  });
  saveGameDraft();
  const g = state.config.games.find((x) => x.id === 'draw-off');
  assert.deepEqual(g.prompts, ['Cat', 'Dog']);
  assert.deepEqual(g.timer.presets, [120]);
  assert.notOk('rounds' in g.timer);
});

test('saveGameDraft: fields that belong to another format are stripped', () => {
  crudSetup();
  const tally = state.config.games.find((g) => g.format === 'tally' && g.unit);
  openDraft(tally.id);
  gameDraft.format = 'placement';
  withConfirm(true, () => saveGameDraft());
  const g = state.config.games.find((x) => x.id === tally.id);
  assert.equal(g.format, 'placement');
  ['unit', 'counterSteps', 'lowerWins', 'timeInput', 'liveRankings'].forEach((k) =>
    assert.notOk(k in g, k + ' belongs to score entry'));

  const bracket = state.config.games.find((x) => x.format === 'tournament');
  openDraft(bracket.id);
  gameDraft.format = 'tally';
  withConfirm(true, () => saveGameDraft());
  const b = state.config.games.find((x) => x.id === bracket.id);
  ['liveTracker', 'ladderScoring', 'roundOneMatchups'].forEach((k) => assert.notOk(k in b, k + ' belongs to brackets'));
});

test('saveGameDraft: the bracket scoreboard settings come back as numbers', () => {
  crudSetup();
  const bracket = state.config.games.find((x) => x.format === 'tournament' && x.liveTracker);
  if (!bracket) return; // no live-tracked bracket in this camp's catalog
  openDraft(bracket.id);
  gameDraft.liveTracker.innings = '3';
  gameDraft.liveTracker.outs = '2';
  gameDraft.liveTracker.unit = '  ';
  saveGameDraft();
  const t = state.config.games.find((x) => x.id === bracket.id).liveTracker;
  assert.equal(t.innings, 3);
  assert.equal(t.outs, 2);
  assert.equal(t.unit, 'Points', 'blank unit falls back');
});

test('saveGameDraft: an edit replaces the game in place, keeping its id and position', () => {
  const games = crudSetup();
  const idx = 3;
  const id = games[idx].id;
  openDraft(id);
  gameDraft.name = 'Renamed';
  saveGameDraft();
  assert.equal(state.config.games[idx].id, id);
  assert.equal(state.config.games[idx].name, 'Renamed');
});

test('saveGameDraft: the same format keeps every record and asks nothing', () => {
  crudSetup();
  const gid = state.config.games[0].id;
  seedRecords(gid);
  openDraft(gid);
  gameDraft.name += '!';
  const asked = withConfirm(true, () => saveGameDraft());
  assert.equal(asked.length, 0);
  assert.equal(recordsFor(gid).length, 6, 'nothing recorded for the game is touched by a rename');
});

test('saveGameDraft: a format change names EVERYTHING it clears, then clears all of it', () => {
  crudSetup();
  const gid = state.config.games.find((g) => g.format === 'placement').id;
  seedRecords(gid);
  openDraft(gid);
  gameDraft.format = 'tally';
  const asked = withConfirm(true, () => saveGameDraft());
  assert.equal(asked.length, 1, 'one confirm, not one per record');
  ['saved result', 'bracket in progress', 'score entry in progress', 'live match', 'game clock', 'drawing-words'].forEach((w) =>
    assert.ok(asked[0].includes(w), 'the confirm names ' + w + ': ' + asked[0]));
  assert.deepEqual(recordsFor(gid), [], 'result, bracket, draft, live match, clock and drawing setup all gone');
  assert.equal(state.config.games.find((g) => g.id === gid).format, 'tally');
});

test('saveGameDraft: declining the format-change confirm changes nothing', () => {
  crudSetup();
  const gid = state.config.games.find((g) => g.format === 'placement').id;
  seedRecords(gid);
  openDraft(gid);
  gameDraft.format = 'tally';
  withConfirm(false, () => saveGameDraft());
  assert.equal(recordsFor(gid).length, 6);
  assert.equal(state.config.games.find((g) => g.id === gid).format, 'placement', 'the game keeps its format');
  assert.equal(state.ui.editGameId, gid, 'the editor stays open for another go');
});

test('saveGameDraft: a format change on a game with no records asks nothing', () => {
  crudSetup();
  const gid = state.config.games.find((g) => g.format === 'placement').id;
  assert.deepEqual(recordsFor(gid), []);
  openDraft(gid);
  gameDraft.format = 'tally';
  const asked = withConfirm(true, () => saveGameDraft());
  assert.equal(asked.length, 0);
});

test('saveGameDraft: one game\'s format change leaves the other games\' records alone', () => {
  crudSetup();
  const [a, b] = state.config.games.filter((g) => g.format === 'placement');
  seedRecords(a.id);
  seedRecords(b.id);
  openDraft(a.id);
  gameDraft.format = 'tally';
  withConfirm(true, () => saveGameDraft());
  assert.deepEqual(recordsFor(a.id), []);
  assert.equal(recordsFor(b.id).length, 6);
});

// ── duplicateGame / deleteGame ───────────────────────────────────

test('duplicateGame copies the SAVED game right after it, without drawing prompts', () => {
  crudSetup();
  const drawing = state.config.games.find((g) => Array.isArray(g.prompts) && g.prompts.length);
  const at = state.config.games.indexOf(drawing);
  const n = state.config.games.length;
  openDraft(drawing.id);
  duplicateGame();
  assert.equal(state.config.games.length, n + 1);
  const copy = state.config.games[at + 1];
  assert.equal(copy.name, drawing.name + ' (copy)');
  assert.ok(copy.id !== drawing.id, 'a fresh id');
  assert.notOk('prompts' in copy, 'only one drawing-prompts game is supported per week');
  assert.equal(state.ui.editGameId, copy.id, 'the copy opens in the editor');
  assert.equal(gameDraftFor, copy.id, 'and the render built a fresh draft for the copy, not the original');
  assert.notOk(builderDirty(), 'which starts clean');
});

test('duplicateGame with unsaved edits asks first; declining copies nothing', () => {
  crudSetup();
  const id = state.config.games[0].id;
  const n = state.config.games.length;
  openDraft(id);
  gameDraft.name = 'Half typed';
  const asked = withConfirm(false, () => duplicateGame());
  assert.equal(asked.length, 1);
  assert.equal(state.config.games.length, n);
  assert.equal(gameDraft.name, 'Half typed', 'draft untouched');
});

test('duplicateGame: a copy of a copy gets a fresh id each time', () => {
  crudSetup();
  const id = state.config.games[0].id;
  openDraft(id);
  duplicateGame();
  openDraft(id);
  duplicateGame();
  const ids = state.config.games.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'ids stay unique');
});

test('deleteGame removes the game and EVERY record under its id, clock included', () => {
  crudSetup();
  const gid = state.config.games[2].id;
  const n = state.config.games.length;
  seedRecords(gid);
  state.ui.gameId = gid;
  const asked = withConfirm(true, () => deleteGame(gid));
  assert.equal(asked.length, 1);
  assert.equal(state.config.games.length, n - 1);
  assert.notOk(state.config.games.some((g) => g.id === gid));
  assert.deepEqual(recordsFor(gid), [], 'a running clock with no game to settle it would be orphaned forever');
  assert.equal(state.ui.gameId, null, 'the open game view lets go of it');
  assert.equal(state.ui.editGameId, null);
});

test('deleteGame: the confirm warns about a result and an in-progress bracket', () => {
  crudSetup();
  const gid = state.config.games[2].id;
  seedRecords(gid);
  const asked = withConfirm(false, () => deleteGame(gid));
  assert.ok(/saved result/.test(asked[0]) && /bracket is in progress/.test(asked[0]), asked[0]);
  assert.ok(state.config.games.some((g) => g.id === gid), 'declined: still there');
  assert.equal(recordsFor(gid).length, 6, 'and so are its records');
});

test('deleteGame leaves other games\' records alone and ignores an unknown id', () => {
  crudSetup();
  const [a, b] = state.config.games;
  seedRecords(a.id);
  seedRecords(b.id);
  withConfirm(true, () => { deleteGame(a.id); deleteGame('no-such-game'); });
  assert.equal(recordsFor(b.id).length, 6);
});

// ── pruneOrphanedGameData ────────────────────────────────────────

test('pruneOrphanedGameData drops every map\'s orphans (clocks too), keeps live games', () => {
  crudSetup();
  const keep = state.config.games[0].id;
  seedRecords(keep);
  seedRecords('gone-game');
  state.ui.gameId = 'gone-game';
  pruneOrphanedGameData();
  assert.deepEqual(recordsFor('gone-game'), []);
  assert.equal(recordsFor(keep).length, 6);
  assert.equal(state.ui.gameId, null);
});

test('restoring the default catalog also drops a custom game\'s clock', () => {
  crudSetup();
  state.config.games.push({ id: 'my-custom', name: 'Custom', dayId: state.config.days[0].id, session: 'Morning', format: 'placement', rules: [] });
  seedRecords('my-custom');
  withConfirm(true, () => restoreDefaults());
  assert.deepEqual(recordsFor('my-custom'), []);
});

// ── Days ─────────────────────────────────────────────────────────

test('deleteDay is refused while the day still has games (no confirm, no change)', () => {
  crudSetup();
  const day = state.config.days.find((d) => state.config.games.some((g) => g.dayId === d.id));
  const n = state.config.days.length;
  const asked = withConfirm(true, () => deleteDay(day.id));
  assert.equal(asked.length, 0);
  assert.equal(state.config.days.length, n);
});

test('deleteDay removes an empty day and moves the viewed day off it', () => {
  crudSetup();
  state.config.days.push({ id: 'd-empty', name: 'Empty day', dow: null, note: '' });
  state.ui.day = 'd-empty';
  withConfirm(true, () => deleteDay('d-empty'));
  assert.notOk(state.config.days.some((d) => d.id === 'd-empty'));
  assert.equal(state.ui.day, state.config.days[0].id);
});

test('deleteDay declined keeps the day', () => {
  crudSetup();
  state.config.days.push({ id: 'd-empty', name: 'Empty day', dow: null, note: '' });
  withConfirm(false, () => deleteDay('d-empty'));
  assert.ok(state.config.days.some((d) => d.id === 'd-empty'));
});

// ── Reorder ──────────────────────────────────────────────────────

// A card whose reorder buttons can be clicked, for the wire* functions.
function reorderCard(selector, buttons) {
  const real = { listeners: [] };
  const els = buttons.map((dataset) => ({
    dataset,
    addEventListener(type, fn) { if (type === 'click') real.listeners.push({ dataset, fn }); },
  }));
  const card = {
    querySelectorAll: (sel) => (sel === selector ? els : []),
    querySelector: () => null,
  };
  return { card, click: (i) => real.listeners[i].fn() };
}

test('moveItem swaps neighbours and ignores the ends', () => {
  const a = [1, 2, 3];
  moveItem(a, 0, 1); assert.deepEqual(a, [2, 1, 3]);
  moveItem(a, 0, -1); assert.deepEqual(a, [2, 1, 3], 'up from the top: nothing');
  moveItem(a, 2, 1); assert.deepEqual(a, [2, 1, 3], 'down from the bottom: nothing');
});

test('game Move up/down swaps within the same day and session group; the group edge is a no-op', () => {
  crudSetup();
  const day = state.config.days[0];
  const sess = state.config.games.find((x) => x.dayId === day.id).session;
  const group = state.config.games.filter((g) => g.dayId === day.id && g.session === sess);
  assert.ok(group.length >= 2, 'precondition: a day/session with two games');
  const [first, second] = group;
  const down = reorderCard('.reorder-btn[data-game-id]', [{ gameId: first.id, dir: '1' }]);
  wireGameRows(down.card);
  down.click(0);
  const order = state.config.games.map((g) => g.id);
  assert.ok(order.indexOf(second.id) < order.indexOf(first.id), 'the pair swapped');
  // `second` is now first in its group: Move up has no neighbour.
  const before = JSON.stringify(order);
  const up = reorderCard('.reorder-btn[data-game-id]', [{ gameId: second.id, dir: '-1' }]);
  wireGameRows(up.card);
  up.click(0);
  assert.equal(JSON.stringify(state.config.games.map((g) => g.id)), before);
});

test('day Move up/down reorders the days and writes the config', () => {
  crudSetup();
  const [d0, d1] = state.config.days;
  const { card, click } = reorderCard('.reorder-btn[data-day-id]', [{ dayId: d0.id, dir: '1' }]);
  wireDaysTab(card);
  const before = state.config.updatedAt;
  click(0);
  assert.equal(state.config.days[0].id, d1.id);
  assert.equal(state.config.days[1].id, d0.id);
  assert.ok(state.config.updatedAt >= before);
});
