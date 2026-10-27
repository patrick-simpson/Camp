// The open game view, the home Big Board and the game clock: what a render
// that changes nothing may skip, what it must never skip, and which writes are
// (and aren't) worth confetti. Markup and motion are checked in a browser;
// these pin the rules the fixes rest on.

// ── setLiveHtmlIfChanged ─────────────────────────────────────────

test('identical markup is skipped even after the tick or a goal changed the DOM', () => {
  const el = { innerHTML: '' };
  const g = { id: 'g' };
  assert.ok(setLiveHtmlIfChanged(el, '<div class="big-board">0</div>', [g]), 'first write happens');
  // The 500 ms tick rewrote the digits / a goal appended cannons. setHtmlIfChanged
  // would read that as "DOM altered" and rebuild — wiping the cannons.
  el.innerHTML = '<div class="big-board">0<span class="board-cannon"></span></div>';
  assert.notOk(setLiveHtmlIfChanged(el, '<div class="big-board">0</div>', [g]), 'kept as is');
  assert.ok(el.innerHTML.includes('board-cannon'), 'the cannon is still flying');
});

test('clock digits are not part of the comparison — the tick owns them', () => {
  const el = { innerHTML: '' };
  const clock = (t) => `<span class="board-clock" data-game-clock data-game-id="g">${t}</span>`;
  setLiveHtmlIfChanged(el, clock('1:23'), []);
  assert.notOk(setLiveHtmlIfChanged(el, clock('1:19'), []), 'a running clock alone never forces a rebuild');
  assert.ok(setLiveHtmlIfChanged(el, clock('0:00').replace('board-clock"', 'board-clock board-clock-zero"'), []),
    'but its markup changing (hitting zero) does');
});

test('a replaced held object forces a rebuild, so no listener writes into an orphan', () => {
  const el = { innerHTML: '' };
  const g = { id: 'g' };
  setLiveHtmlIfChanged(el, '<p>x</p>', [g]);
  assert.notOk(setLiveHtmlIfChanged(el, '<p>x</p>', [g]));
  const copy = { id: 'g' };
  assert.ok(setLiveHtmlIfChanged(el, '<p>x</p>', [copy]), 'a fresh copy of the game (remote config) rebuilds');
  assert.ok(setLiveHtmlIfChanged(el, '<p>y</p>', [copy]), 'different markup always rebuilds');
});

// ── The tally form outliving a render ────────────────────────────

// A minimal stand-in for the entry area: a node whose listeners can be fired,
// and elements whose markup is parsed into such nodes — so a test can type
// into, tap and pick from a form that SURVIVED a render, the way a person does.
function fireable(props) {
  const ls = {};
  return Object.assign({ addEventListener: (t, fn) => { ls[t] = fn; }, fire: (t) => ls[t] && ls[t]() }, props);
}

function fakeArea(parse) {
  let html = '';
  let found = {};
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; found = parse(v); },
    querySelectorAll: (sel) => found[sel] || [],
    querySelector: (sel) => {
      const m = /^input\[data-team-id="(.+)"\]$/.exec(sel);
      if (m) return (found['.score-input-row input'] || []).find((i) => i.dataset.teamId === m[1]) || null;
      return (found[sel] || [])[0] || null;
    },
  };
}

function parseMedals(html) {
  const medals = [];
  const re = /<jelly-select data-medal="([^"]+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const v = / value="([^"]*)"/.exec(m[2]);
    medals.push(fireable({ dataset: { medal: m[1] }, value: v ? v[1] : '' }));
  }
  return { '[data-medal]': medals };
}

function parseTally(html) {
  const inputs = [];
  const counters = [];
  const re = /data-team-id="([^"]+)" value="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) inputs.push(fireable({ dataset: { teamId: m[1] }, value: m[2] }));
  html.split('class="counter-btn-row" data-team-id="').slice(1).forEach((seg) => {
    const row = { dataset: { teamId: seg.slice(0, seg.indexOf('"')) } };
    const rowHtml = seg.slice(0, seg.indexOf('</div>'));
    const b = /class="counter-btn (?:plus|minus)"[^>]*data-delta="(-?\d+)"/g;
    let x;
    while ((x = b.exec(rowHtml))) counters.push(fireable({ dataset: { delta: x[1] }, closest: () => row }));
  });
  return { '.score-input-row input': inputs, '.counter-btn': counters };
}

function fakeForm() {
  const el = fakeArea(parseTally);
  return { el, inputs: { get all() { return el.querySelectorAll('.score-input-row input'); } } };
}

// #tally-medals as the real page has it: writing its markup creates the three
// children updateTallyMedals looks up, so an in-place update is distinguishable
// from a rebuild by node identity.
function fakeMedalWrap() {
  let html = '';
  let kids = null;
  return {
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v;
      kids = { '#tally-ranking': fakeArea(() => ({})), '#tally-heading': fakeArea(() => ({})), '#tally-picker': fakeArea(parseMedals) };
    },
    querySelector: (sel) => (kids && kids[sel]) || null,
    querySelectorAll: (sel) => (kids ? kids['#tally-picker'].querySelectorAll(sel) : []),
    picker: () => kids && kids['#tally-picker'],
  };
}

// Run fn with the ids the tally / placement handlers look up on `document`
// answered by fakes whose listeners the test can fire.
function withEntryDom(fn) {
  const real = document.getElementById;
  const dom = { medals: fakeMedalWrap(), save: fireable({}), err: { hidden: true, textContent: '' }, placement: fakeArea(parseMedals) };
  document.getElementById = (id) => ({
    'tally-medals': dom.medals, 'save-result-btn': dom.save, 'entry-error': dom.err, 'placement-medals': dom.placement,
  }[id] || real(id));
  try { return fn(dom); } finally { document.getElementById = real; }
}

function tallyGame(scores, id) {
  freshState();
  setMemberRole('editor');
  const g = id ? state.config.games.find((x) => x.id === id)
    : state.config.games.find((x) => x.format === 'tally' && !x.counterSteps) || state.config.games.find((x) => x.format === 'tally');
  delete state.results[g.id];
  state.drafts[g.id] = { scores: scores || { t0: '5' }, medals: {} };
  return g;
}

// A remote snapshot replaces state.drafts with a fresh copy of itself
// (applyRemoteState does exactly this for any non-echo change elsewhere); a
// kept form's handlers must write into THIS one, not the one it was built from.
function swapDrafts() {
  const old = state.drafts;
  state.drafts = JSON.parse(JSON.stringify(state.drafts));
  return old;
}

test('a snapshot that changes nothing on the form keeps it — and typing still saves', () => {
  const g = tallyGame();
  const { el, inputs } = fakeForm();
  renderTally(el, g);
  assert.ok(inputs.all.length >= 2, 'the form rendered its score fields');
  const before = inputs.all[0];

  swapDrafts();
  renderTally(el, g);
  assert.ok(inputs.all[0] === before, 'same markup → not rebuilt');

  // The kept field's listener must write into the CURRENT draft, not the one
  // the form was built from — otherwise the score is silently never saved.
  const t1 = inputs.all.find((i) => i.dataset.teamId === 't1');
  t1.value = '7';
  t1.fire('input');
  assert.equal(state.drafts[g.id].scores.t1, '7', 'typed score lands in the live draft');
});

test('a +N tap on a kept form lands in the live draft, not an orphaned one', () => {
  const g = tallyGame({ t0: '12' }, 'axe-throwing');
  const { el, inputs } = fakeForm();
  withEntryDom(() => {
    renderTally(el, g);
    const buttons = el.querySelectorAll('.counter-btn');
    assert.ok(buttons.length > 0, 'the counter form rendered');
    const orphan = swapDrafts()[g.id];
    renderTally(el, g);
    assert.ok(el.querySelectorAll('.counter-btn')[0] === buttons[0], 'the form was kept');
    const plus = el.querySelectorAll('.counter-btn').filter((b) => b.closest().dataset.teamId === 't1' && Number(b.dataset.delta) > 0).pop();
    plus.fire('click');
    assert.equal(state.drafts[g.id].scores.t1, plus.dataset.delta, 'the tap is in the live draft');
    assert.equal(orphan.scores.t1, undefined, 'and not in the one the form was built from');
    assert.equal(inputs.all.find((i) => i.dataset.teamId === 't1').value, plus.dataset.delta, 'the field shows it');
  });
});

test('Save on a kept form saves what is in the live draft', () => {
  const g = tallyGame({ t0: '9', t1: '8', t2: '7' }, 'axe-throwing');
  const { el, inputs } = fakeForm();
  const realCelebrate = celebrate;
  celebrate = () => {}; // confetti needs a canvas
  try {
    withEntryDom((dom) => {
      renderTally(el, g);
      swapDrafts();
      renderTally(el, g);
      const t3 = inputs.all.find((i) => i.dataset.teamId === 't3');
      t3.value = '6';
      t3.fire('input');
      dom.save.fire('click');
      assert.ok(state.results[g.id], 'the result was saved');
      assert.equal(state.results[g.id].scores.t3, 6, 'including the score typed after the snapshot');
      assert.equal(state.results[g.id].scores.t0, 9);
    });
  } finally { celebrate = realCelebrate; }
});

test('a medal pick on a kept tally picker lands in the live draft', () => {
  const g = tallyGame({ t0: '9', t1: '8', t2: '7' }, 'axe-throwing');
  const { el } = fakeForm();
  withEntryDom((dom) => {
    renderTally(el, g);
    const gold = dom.medals.picker().querySelectorAll('[data-medal]')[0];
    assert.equal(gold.value, 't0', 'auto-picked from the scores');
    const orphan = swapDrafts()[g.id];
    renderTally(el, g);
    assert.ok(dom.medals.picker().querySelectorAll('[data-medal]')[0] === gold, 'the picker was kept');
    gold.value = 't4';
    gold.fire('change');
    assert.equal(state.drafts[g.id].medals.gold, 't4', 'the pick is in the live draft');
    assert.notOk(orphan.medals.gold, 'not in the orphan');
  });
});

test('auto-picks that move with the scores update the selects in place', () => {
  const g = tallyGame({ t0: '9', t1: '8', t2: '7' }, 'axe-throwing');
  const { el, inputs } = fakeForm();
  withEntryDom((dom) => {
    renderTally(el, g);
    const picker = dom.medals.picker();
    const gold = picker.querySelectorAll('[data-medal]')[0];
    const html = picker.innerHTML;
    const t1 = inputs.all.find((i) => i.dataset.teamId === 't1');
    t1.value = '20';
    t1.fire('input');
    assert.ok(dom.medals.picker() === picker && picker.querySelectorAll('[data-medal]')[0] === gold, 'no rebuild of the three selects');
    assert.equal(picker.innerHTML, html, 'markup untouched');
    assert.equal(gold.value, 't1', 'gold moved to the new leader');
  });
});

test('a kept form whose field drifted from the draft is rebuilt to show the truth', () => {
  const g = tallyGame();
  const { el, inputs } = fakeForm();
  renderTally(el, g);
  // This phone typed 6; then a snapshot put the score back to 5 — the markup
  // matches what the form was built with, but the field still says 6.
  inputs.all.find((i) => i.dataset.teamId === 't0').value = '6';
  state.drafts[g.id].scores.t0 = '5';
  renderTally(el, g);
  assert.equal(inputs.all.find((i) => i.dataset.teamId === 't0').value, '5', 'rebuilt from the draft');
});

function placementGame() {
  freshState();
  setMemberRole('editor');
  const g = state.config.games.find((x) => x.format === 'placement');
  delete state.results[g.id];
  state.drafts[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' } };
  return g;
}

test('a podium pick on a kept placement form lands in the live draft', () => {
  const g = placementGame();
  const el = fakeArea(parseMedals);
  withEntryDom(() => {
    renderPlacement(el, g);
    const gold = el.querySelectorAll('[data-medal]')[0];
    assert.equal(gold.value, 't0');
    const orphan = swapDrafts()[g.id];
    renderPlacement(el, g);
    assert.ok(el.querySelectorAll('[data-medal]')[0] === gold, 'identical draft → the form is kept');
    gold.value = 't3';
    gold.fire('change');
    assert.equal(state.drafts[g.id].medals.gold, 't3', 'the pick is in the live draft');
    assert.equal(orphan.medals.gold, 't0', 'the orphan is untouched');
  });
});

test('a placement form whose select drifted from the draft is rebuilt', () => {
  const g = placementGame();
  const el = fakeArea(parseMedals);
  renderPlacement(el, g);
  const gold = el.querySelectorAll('[data-medal]')[0];
  gold.value = 't5'; // picked on screen …
  state.drafts[g.id].medals.gold = 't0'; // … then a snapshot put it back
  renderPlacement(el, g);
  const now = el.querySelectorAll('[data-medal]')[0];
  assert.ok(now !== gold && now.value === 't0', 'rebuilt from the draft');
});

// ── Celebrations and the "Data last updated" stamp ───────────────

const clockGame = { id: 'cg', timer: { label: 'Game clock', presets: [600] } };

function quietSetup() {
  freshState();
  state.config.games.push(clockGame);
  state.clocks = {};
  state.meta.lastDataChangeAt = 'before';
  joyLastCelebrateAt = 0;
  dataEditPending = false;
  serverTimeOffset = 0;
  fbRef = null;
  setMemberRole('editor');
}

test('clock Start / Pause / Reset is guarded but neither stamped nor celebrated', () => {
  ['start', 'pause', 'reset'].forEach((act) => {
    quietSetup();
    applyClockAction(clockGame, act);
    assert.equal(state.meta.lastDataChangeAt, 'before', act + ' must not move "Data last updated"');
    assert.equal(joyLastCelebrateAt, 0, act + ' must not throw confetti');
    assert.ok(dataEditPending, act + ' is still an unpushed write to guard');
  });
  releaseWakeLock(); // Start asked for one
});

test('the buzzer settling a clock at 0:00 throws no confetti on the editor\'s phone', () => {
  quietSetup();
  state.clocks.cg = { running: true, endAt: serverNow() - 800, remaining: 0, duration: 600000, round: 1 };
  const real = playAlarm;
  playAlarm = () => {};
  try { tickBoardClocks(); } finally { playAlarm = real; }
  assert.notOk(state.clocks.cg.running, 'the clock was settled');
  assert.equal(joyLastCelebrateAt, 0, 'no celebration without a tap');
  assert.equal(state.meta.lastDataChangeAt, 'before');
});

test('only a goal going up celebrates on the live tracker; every change is still stamped', () => {
  quietSetup();
  const g = { id: 'lt' };
  setLiveMatch(g, { key: 'a|b', inning: 2, hr: {} }, { celebrate: false });
  assert.equal(joyLastCelebrateAt, 0, 'inning / outs / goal − / Reset tally: no confetti');
  assert.ok(state.meta.lastDataChangeAt !== 'before', 'but it is live-score data, so it is stamped');
  setLiveMatch(g, { key: 'a|b', inning: 2, hr: { a: 1 } }, { celebrate: true });
  assert.ok(joyLastCelebrateAt > 0, 'a goal celebrates');
});

test('a plain touchData() is unchanged: stamped and celebrated', () => {
  quietSetup();
  touchData();
  assert.ok(state.meta.lastDataChangeAt !== 'before', 'stamped');
  assert.ok(joyLastCelebrateAt > 0);
});

// ── Background renders wait for a focused field ──────────────────

function countRenders(fn) {
  const real = renderAll;
  let n = 0;
  renderAll = () => { n++; };
  try { fn(); } finally { renderAll = real; }
  return n;
}

test('a background render is held while a field is focused, then paid off', () => {
  renderOwed = false;
  document.activeElement = { tagName: 'INPUT' };
  assert.equal(countRenders(() => renderAllWhenIdle()), 0, 'the focused score field is not rebuilt under the thumb');
  assert.ok(renderOwed);
  assert.equal(countRenders(() => idleRetryTick()), 0, 'still focused — still owed');

  document.activeElement = null;
  assert.equal(countRenders(() => idleRetryTick()), 1, 'focus left — rendered once');
  assert.notOk(renderOwed);
  assert.equal(countRenders(() => idleRetryTick()), 0, 'and only once');
});

test('an open Jelly select holds it too; a tapped Jelly button does not', () => {
  renderOwed = false;
  document.activeElement = { tagName: 'JELLY-SELECT' };
  assert.equal(countRenders(() => renderAllWhenIdle()), 0);
  document.activeElement = { tagName: 'JELLY-BUTTON' };
  assert.equal(countRenders(() => renderAllWhenIdle()), 1, 'a button is not typing');
  document.activeElement = null;
  renderOwed = false;
});

test('a clock hitting zero while a score is being typed does not steal the field', () => {
  quietSetup();
  state.clocks.cg = { running: true, endAt: serverNow() - 800, remaining: 0, duration: 600000, round: 1 };
  document.activeElement = { tagName: 'INPUT' };
  const real = playAlarm;
  playAlarm = () => {};
  let renders;
  try { renders = countRenders(() => tickBoardClocks()); } finally { playAlarm = real; }
  assert.equal(renders, 0, 'held');
  assert.notOk(state.clocks.cg.running, 'the clock is still stopped right away');
  document.activeElement = null;
  renderOwed = false;
});

test('focus alone is what editorMidEntry adds over fieldFocused', () => {
  dataEditPending = false; pushTimer = null; pushConfigTimer = null;
  document.activeElement = { tagName: 'TEXTAREA' };
  assert.ok(fieldFocused() && editorMidEntry());
  document.activeElement = null;
  dataEditPending = true;
  assert.notOk(fieldFocused(), 'a queued write is not a focused field');
  assert.ok(editorMidEntry(), 'but editorMidEntry still guards it');
  dataEditPending = false;
});

// ── Clocks are born in their final state ─────────────────────────

test('renderAll paints the urgency classes onto a clock it just rebuilt', () => {
  quietSetup();
  state.clocks.cg = { running: true, endAt: serverNow() + 8000, remaining: 0, duration: 600000, round: 1 };
  const classes = new Set();
  const board = { classList: { toggle: (c, on) => (on ? classes.add('board:' + c) : classes.delete('board:' + c)) } };
  const el = {
    dataset: { gameId: 'cg' }, textContent: '',
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    closest: () => board,
  };
  const realQSA = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel === '[data-game-clock]' ? [el] : []);
  try { renderAll(); } finally { document.querySelectorAll = realQSA; }
  assert.ok(classes.has('clock-final-ten'), 'red heartbeat from the first frame');
  assert.ok(classes.has('board:board-final-ten'), 'and the board glow');
  assert.equal(el.textContent, '0:08');
});

// ── Panels a render leaves alone ─────────────────────────────────

// An element that counts how many times its markup was written.
function countingWrites(el) {
  let html = '';
  const c = { writes: 0 };
  Object.defineProperty(el, 'innerHTML', { configurable: true, get: () => html, set: (v) => { html = v; c.writes++; } });
  return c;
}

test('renderGameView builds the head once per game, and again only when the game changes', () => {
  freshState();
  setMemberRole('editor');
  const [a, b] = state.config.games.filter((x) => x.format === 'placement');
  const view = document.getElementById('game-view');
  const w = countingWrites(view);
  const back = document.getElementById('back-btn');
  let wired = 0;
  back.addEventListener = () => { wired++; };

  state.ui.gameId = a.id;
  renderGameView();
  assert.equal(w.writes, 1, 'built on open');
  assert.equal(wired, 1);
  const head = view.__headHtml;
  renderGameView();
  renderGameView();
  assert.equal(w.writes, 1, 'unchanged renders leave the back pill, title and open rules alone');
  assert.equal(wired, 1, 'and do not re-wire Back');
  assert.ok(view.__headHtml === head);

  state.ui.gameId = b.id;
  renderGameView();
  assert.equal(w.writes, 2, 'a different game is a different head');

  state.ui.gameId = null;
  renderGameView();
  assert.equal(view.__headHtml, null, 'closing forgets it, so the next open plays the entrance');
  state.ui.gameId = b.id;
  renderGameView();
  assert.equal(w.writes, 3, 'reopened → built afresh');
});

test('the Pictionary tools survive a render that changes nothing — a running lap included', () => {
  freshState();
  setMemberRole('editor');
  const g = state.config.games.find((x) => x.prompts);
  state.picSetup = { [g.id]: { source: 'numbered', words: [] } };
  state.ui.picTeam = 't0';
  const wrap = { innerHTML: '' };
  const real = bindPicRound;
  let binds = 0;
  bindPicRound = () => { binds++; };
  try {
    renderTools(wrap, g);
    renderTools(wrap, g);
    assert.equal(binds, 1, 'unchanged → the buttons are not rebuilt');

    const w = liveWatches[g.id];
    w.running = true;
    w.startAt = Date.now() - 1000;
    renderTools(wrap, g);
    assert.equal(binds, 2, 'starting a lap changes the panel');
    w.startAt -= 7000; // seven more seconds on the stopwatch readouts
    renderTools(wrap, g);
    assert.equal(binds, 2, 'the readouts are the 100 ms tick\'s — a running lap is not rebuilt under the Stop button');

    w.running = false;
    renderTools(wrap, g);
    assert.equal(binds, 3, 'stopping rebuilds');
  } finally { bindPicRound = real; liveWatches[g.id].running = false; }
});

test('the home Live-now strip is rewritten only when what it shows changes', () => {
  freshState();
  setMemberRole('editor');
  const g = state.config.games.find((x) => x.id === 'axe-throwing');
  state.ui.gameId = null;
  state.drafts[g.id] = { scores: { t0: '4', t1: '2' }, medals: {} };
  const wrap = document.getElementById('live-home');
  const w = countingWrites(wrap);
  delete wrap.__liveKey; delete wrap.__liveHolds;
  renderLiveHome();
  assert.equal(w.writes, 1, 'first paint');
  renderLiveHome();
  renderLiveHome();
  assert.equal(w.writes, 1, 'idle renders keep the cards (their pulse phase, a press in flight)');
  state.drafts[g.id].scores.t0 = '9';
  renderLiveHome();
  assert.equal(w.writes, 2, 'a new score is a rewrite');
});

test('the not-started bracket card is kept by idle renders; a started bracket forgets the key', () => {
  freshState();
  setMemberRole('editor');
  const g = state.config.games.find((x) => x.format === 'tournament');
  delete state.brackets[g.id];
  const el = {};
  const w = countingWrites(el);
  const start = document.getElementById('start-bracket-btn');
  let wired = 0;
  start.addEventListener = () => { wired++; };
  renderTournament(el, g);
  renderTournament(el, g);
  assert.equal(w.writes, 1, 'the Start card is written once');
  assert.equal(wired, 1);
  state.brackets[g.id] = freshBracket();
  renderTournament(el, g);
  assert.equal(el.__liveKey, null, 'a started bracket rebuilds each time, so nothing may compare against the old card');
  delete state.brackets[g.id];
  renderTournament(el, g);
  assert.equal(wired, 2, 'cancelling brings the card back (and wires its button)');
});

// The cannons and the score pop live INSIDE the board, so a render that has to
// rebuild the board would cut them off; they are lifted and set back down.
function flyingBoard(gid, host, opts) {
  const o = opts || {};
  const cannonAnim = { playState: 'running', currentTime: 420 };
  const popAnim = { playState: 'running', currentTime: 90 };
  const cannon = { getAnimations: () => [cannonAnim] };
  const pop = { getAnimations: () => [popAnim], closest: () => ({ dataset: { boardCol: 't1' } }) };
  const board = {
    dataset: { boardGame: gid }, isConnected: true, closest: () => host,
    querySelectorAll: (sel) => (sel === '.board-cannon' ? [cannon] : sel === '[data-board-col] .score-pop' ? (o.noPop ? [] : [pop]) : []),
  };
  return { board, cannon, cannonAnim, popAnim };
}

function replacementBoard(gid) {
  const added = [];
  const popEl = { classList: { contains: () => false, add: (c) => added.push(c) }, getAnimations: () => [popAnim0] };
  const popAnim0 = { currentTime: 0 };
  const col = { dataset: { boardCol: 't1' }, querySelector: () => popEl };
  return {
    board: { dataset: { boardGame: gid }, appended: [], appendChild(p) { this.appended.push(p); }, querySelectorAll: (sel) => (sel === '[data-board-col]' ? [col] : []) },
    added, popAnim0,
  };
}

test('holdBoardCelebrations sets in-flight cannons and the score pop onto the board that replaced theirs', () => {
  const host = { boards: [] };
  host.querySelectorAll = () => host.boards;
  const old = flyingBoard('g1', host);
  const next = replacementBoard('g1');
  const realQSA = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel === '.big-board[data-board-game]' ? [old.board] : []);
  try {
    const setDown = holdBoardCelebrations();
    old.board.isConnected = false; // the render threw the board away …
    host.boards = [next.board]; // … and built a new one in the same place
    old.cannonAnim.currentTime = 0; // the cannon would restart from nothing
    setDown();
    assert.ok(next.board.appended[0] === old.cannon, 'the same cannon flies on');
    assert.equal(old.cannonAnim.currentTime, 420, 'from where it was');
    assert.deepEqual(next.added, ['score-pop'], 'the score pop continues on the same team');
    assert.equal(next.popAnim0.currentTime, 90);
  } finally { document.querySelectorAll = realQSA; }
});

test('holdBoardCelebrations leaves a board that was not rebuilt, and never crosses games or places', () => {
  const realQSA = document.querySelectorAll;
  const run = (setup) => {
    const host = { boards: [] };
    host.querySelectorAll = () => host.boards;
    const old = flyingBoard('g1', host, { noPop: true });
    document.querySelectorAll = (sel) => (sel === '.big-board[data-board-game]' ? [old.board] : []);
    const setDown = holdBoardCelebrations();
    setup(old, host);
    setDown();
    return old;
  };
  try {
    const kept = replacementBoard('g1');
    run((old, host) => { host.boards = [kept.board]; }); // board still connected
    assert.equal(kept.board.appended.length, 0, 'a board the render left alone keeps its own');

    const other = replacementBoard('g2');
    run((old, host) => { old.board.isConnected = false; host.boards = [other.board]; });
    assert.equal(other.board.appended.length, 0, 'another game\'s board gets nothing');

    const elsewhere = replacementBoard('g1'); // e.g. the game view's board vs the home one
    run((old) => { old.board.isConnected = false; }); // nothing in THIS host
    assert.equal(elsewhere.board.appended.length, 0, 'the home board\'s volley never lands in the game view');

    const finished = flyingBoard('g1', {}, { noPop: true });
    finished.cannonAnim.playState = 'finished';
    document.querySelectorAll = (sel) => (sel === '.big-board[data-board-game]' ? [finished.board] : []);
    const next = replacementBoard('g1');
    const host = { querySelectorAll: () => [next.board] };
    finished.board.closest = () => host;
    const setDown = holdBoardCelebrations();
    finished.board.isConnected = false;
    setDown();
    assert.equal(next.board.appended.length, 0, 'a cannon that already landed is not revived');
  } finally { document.querySelectorAll = realQSA; }
});

// ── Source-level guards (layout-dependent behaviour lives in Playwright) ──

test('the game view head and the live panels are not rebuilt by every render', () => {
  const src = readFixture('../app.js');
  const body = (name) => {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start > -1, name + ' exists');
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  assert.ok(/view\.__headHtml !== headHtml/.test(body('renderGameView')), 'head rebuilt only when it changes');
  assert.notOk(/\bview\.innerHTML = html\b/.test(body('renderGameView')), 'no unconditional whole-view rewrite');
  ['renderLiveHome', 'renderLiveWatch', 'renderLiveTallyWatch', 'renderResult', 'renderTally', 'renderPlacement']
    .forEach((fn) => assert.ok(body(fn).includes('setLiveHtmlIfChanged('), fn + ' skips unchanged rebuilds'));
  assert.ok(/paintBoardClocks\(\);\s*$/.test(body('renderAll')), 'renderAll ends by painting the clocks');
  assert.notOk(/if \(settled\) renderAll\(\)/.test(src), 'the clock settle no longer renders under a focused field');
});

test('the zero-clock flash ends, and stops entirely under reduced motion', () => {
  const css = readFixture('../styles.css');
  assert.notOk(/\.tool-box\.alarming\s*\{[^}]*infinite/.test(css), 'no endless strobe');
  const reduce = css.split('@media (prefers-reduced-motion: reduce)').slice(1).map((s) => s.slice(0, s.indexOf('\n}\n')));
  assert.ok(reduce.some((b) => /\.tool-box\.alarming\s*\{\s*animation:\s*none/.test(b)), 'reduced motion turns it off');
});

test('the viewer note no longer points at a PIN that does not exist', () => {
  const src = readFixture('../app.js');
  assert.notOk(/score PIN to run it/.test(src));
});
