// THE SIX-TEAM BRACKET, PINNED FIRST (setup-rebuild-spec S6b, BUILD-PLAN Step 22).
//
// The six-team wizard (round 1 -> bye -> championship -> final -> results) is moving onto shared pure helpers so
// the four-team bracket can reuse what is common. This file was written BEFORE that extraction, against the click
// handlers as they were: every case drives the REAL wizard (renderTournament and its renderBracket* steps) through
// stub buttons, so it describes what a director sees and what lands in state, not how the code is arranged. It has
// to stay green, unchanged, through the extraction. (Cases the extraction adds are in the "extracted" half at the end
// and in bracket4.test.js.)
//
// What is pinned: the fresh bracket, Start, free-pick and fixed-order round 1 (pool, selectedPair, the match record,
// undo), the bye (who is suggested, with and without confirmed points; Back to Round 1), the championship game, the
// final, the summary and Save Result (the result's exact shape, doubling, medalCounts, the live tally cleared),
// Cancel, Clear result, the own-team guard, the "needs exactly 6 teams" guard, what spectators read
// (currentMatchupOf / nextMatchupOf / upcomingMatchups / findNextMatchupFor / gameRowStatus), the per-game sync
// write, and a seeded random walk over the whole flow.

// ── the driver: the real wizard, with stub buttons ──────────────────────────────────────────────────────────────

const BTN_IDS = ['cancel-bracket-btn', 'undo-match-btn', 'undo-to-round1-btn', 'save-bracket-btn', 'start-bracket-btn'];

function wizard(g) {
  const bodyEl = document.getElementById('bracket-body');
  const realQuery = bodyEl.querySelector;
  const realAll = bodyEl.querySelectorAll;
  const realGet = document.getElementById;
  const realRenderAll = renderAll;
  const realConfirm = confirm;
  const realCelebrate = celebrate;
  const w = { g, renders: 0, celebrated: [], asked: [], answer: true, live: null, container: null };
  const fake = (key, fn) => ({ dataset: { winner: key, teamId: key }, addEventListener(t, h) { if (t === 'click') w.live[fn][key] = h; } });
  BTN_IDS.forEach((id) => {
    const el = realGet(id);
    el.addEventListener = (t, h) => { if (t === 'click') el.__click = h; };
  });
  bodyEl.querySelectorAll = (sel) => {
    const h = bodyEl.innerHTML;
    if (sel === '.winner-btn') return [...h.matchAll(/class="winner-btn"[^>]*data-winner="([^"]+)"/g)].map((m) => fake(m[1], 'winner'));
    if (sel === '.tiebreak-chip') return [...h.matchAll(/class="team-chip tiebreak-chip[^"]*" data-team-id="([^"]+)"/g)].map((m) => fake(m[1], 'tie'));
    if (sel === '.team-chip') return [...h.matchAll(/class="team-chip[^"]*" data-team-id="([^"]+)"/g)].map((m) => fake(m[1], 'chip'));
    return realAll.call(bodyEl, sel);
  };
  bodyEl.querySelector = (sel) => {
    if (sel === '#seed-suggest-btn') {
      return /id="seed-suggest-btn"/.test(bodyEl.innerHTML) ? { addEventListener(t, h) { if (t === 'click') w.live.suggest = h; } } : null;
    }
    return realQuery.call(bodyEl, sel);
  };
  renderAll = () => { w.renders += 1; };
  confirm = (msg) => { w.asked.push(String(msg)); return w.answer; };
  celebrate = (id) => { w.celebrated.push(id); };

  w.render = () => {
    w.live = { winner: {}, chip: {}, tie: {} };
    BTN_IDS.forEach((id) => { realGet(id).__click = null; });
    // A render that writes (round 1 with an empty pool moves itself on to the bye and calls renderAll) is followed by
    // the repaint renderAll would have done, so the view the director sees is the settled one.
    for (let i = 0; i < 4; i++) {
      const before = w.renders;
      bodyEl.innerHTML = '';
      w.container = {};
      renderTournament(w.container, g);
      if (w.renders === before) break;
    }
    return w;
  };
  w.html = () => String(w.container.innerHTML || '') + ' ' + String(bodyEl.innerHTML || '');
  w.has = (id) => w.html().indexOf('id="' + id + '"') !== -1;
  w.press = (id) => { bracketTapReset(); const el = realGet(id); assert.ok(el.__click, 'a button #' + id + ' is bound'); el.__click(); return w.render(); };
  w.winner = (team) => { bracketTapReset(); const h = w.live.winner[team]; assert.ok(h, 'a winner button for ' + team + ' in: ' + bodyEl.innerHTML); h(); return w.render(); };
  w.chip = (team) => { const h = w.live.chip[team]; assert.ok(h, 'a team chip for ' + team); h(); return w.render(); };
  w.bye = (team) => { bracketTapReset(); const h = w.live.tie[team]; assert.ok(h, 'a bye chip for ' + team); h(); return w.render(); };
  w.suggest = () => { assert.ok(w.live.suggest, 'a suggestion button'); w.live.suggest(); return w.render(); };
  w.winners = () => Object.keys(w.live.winner);
  w.b = () => state.brackets[g.id];
  w.done = () => {
    renderAll = realRenderAll; confirm = realConfirm; celebrate = realCelebrate;
    bodyEl.querySelector = realQuery; bodyEl.querySelectorAll = realAll; document.getElementById = realGet;
    BTN_IDS.forEach((id) => { const el = realGet(id); el.addEventListener = () => {}; el.__click = null; });
  };
  return w;
}

// Run a body against a started wizard and always put the globals back.
function withWizard(g, fn) {
  const w = wizard(g);
  try { return fn(w); } finally { w.done(); }
}

function tournament(name) {
  freshState();
  bracketTapReset(); // the double-tap guard (see its cases at the end of this file) is per device: a new test starts with no recent tap
  setMemberRole('editor');
  const g = state.config.games.find((x) => x.id === (name || 'jeb-ball'));
  assert.ok(g && g.format === 'tournament', 'the sandbox game exists');
  delete state.brackets[g.id];
  return g;
}

// A saved result for some OTHER game, so the standings differ: { team: medal }.
function seedPoints(spec) {
  const other = state.config.games.find((x) => x.format !== 'tournament');
  const medals = { gold: spec.gold, silver: spec.silver, bronze: spec.bronze };
  state.results[other.id] = { medals, savedAt: new Date().toISOString() };
  return other;
}

// Play round 1 of a free-pick bracket: pairs are [winner, loser].
function playRound1(w, results) {
  results.forEach(([win, lose]) => { w.chip(win); w.chip(lose); w.winner(win); });
}

// ── the fresh bracket and Start ─────────────────────────────────────────────────────────────────────────────────

test('freshBracket: round 1, every team in the pool, nothing recorded', () => {
  freshState();
  assert.deepEqual(freshBracket(), {
    phase: 'round1', pool: ['t0', 't1', 't2', 't3', 't4', 't5'], selectedPair: [], matches: [], byeTeamId: null, semifinal: null, championship: null,
  });
});

test('Start Bracket writes a fresh bracket, clears the game\'s live tally, and saves', () => {
  const g = tournament();
  state.live[g.id] = { key: 't0|t1', inning: 2, outs: 1, half: 0, hr: { t0: 3 } };
  withWizard(g, (w) => {
    w.render();
    assert.ok(w.has('start-bracket-btn'), 'the Start card shows with no bracket');
    assert.ok(/Three first-round matches/.test(w.html()));
    assert.notOk(state.brackets[g.id]);
    w.press('start-bracket-btn');
    assert.deepEqual(state.brackets[g.id], freshBracket(), 'the bracket is exactly the fresh one');
    assert.notOk(state.live[g.id], 'a new bracket starts with a clean tally');
    assert.ok(w.renders > 0, 'and the page repaints');
    assert.ok(/Round 1 — Match 1 of 3/.test(w.html()));
  });
});

test('the step bar names the five steps and marks where the bracket is', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    w.render();
    ['Round 1', 'Bye', 'Championship', 'Final', 'Results'].forEach((s) => assert.ok(w.html().indexOf('>' + s + '<') !== -1, s));
    assert.ok(/wizard-step active">Round 1</.test(w.html()));
    state.brackets[g.id].phase = 'semifinal';
    state.brackets[g.id].byeTeamId = 't2';
    state.brackets[g.id].semifinal = { a: 't0', b: 't1', winner: null, loser: null };
    w.render();
    assert.ok(/wizard-step done">Round 1</.test(w.html()) && /wizard-step done">Bye</.test(w.html()));
    assert.ok(/wizard-step active">Championship</.test(w.html()));
  });
});

// ── round 1, free pick ──────────────────────────────────────────────────────────────────────────────────────────

test('free pick: taps build the pair in the order tapped, a third is ignored, a tapped team comes out', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    w.render();
    assert.ok(/Pick the two teams to call up next/.test(w.html()));
    assert.deepEqual(w.winners(), [], 'no winner buttons until two are picked');
    w.chip('t3');
    assert.deepEqual(w.b().selectedPair, ['t3']);
    w.chip('t0');
    assert.deepEqual(w.b().selectedPair, ['t3', 't0']);
    assert.deepEqual(w.winners().sort(), ['t0', 't3'], 'both teams get a winner button');
    w.chip('t5');
    assert.deepEqual(w.b().selectedPair, ['t3', 't0'], 'a third team is ignored');
    w.chip('t3');
    assert.deepEqual(w.b().selectedPair, ['t0'], 'tapping a picked team puts it back');
    w.chip('t4');
    assert.deepEqual(w.b().selectedPair, ['t0', 't4']);
  });
});

test('free pick: a winner is recorded as { a, b, winner, loser } in pick order, the pool shrinks, the pair clears, data is stamped', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  state.meta.lastDataChangeAt = undefined;
  withWizard(g, (w) => {
    w.render();
    w.chip('t3'); w.chip('t0');
    w.winner('t0');
    assert.deepEqual(w.b().matches, [{ a: 't3', b: 't0', winner: 't0', loser: 't3' }]);
    assert.deepEqual(w.b().pool, ['t1', 't2', 't4', 't5']);
    assert.deepEqual(w.b().selectedPair, []);
    assert.equal(w.b().phase, 'round1');
    assert.ok(state.meta.lastDataChangeAt, 'a recorded match is real scoreboard activity');
    assert.ok(/Match 2 of 3/.test(w.html()));
    assert.ok(/Completed:/.test(w.html()) && /def\./.test(w.html()), 'the completed list names it');
    assert.ok(w.has('undo-match-btn'));
  });
});

test('free pick: Undo last match puts both teams back at the END of the pool and leaves a pair in progress alone', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    w.render();
    w.chip('t3'); w.chip('t0'); w.winner('t0');
    w.chip('t1');
    w.press('undo-match-btn');
    assert.deepEqual(w.b().matches, []);
    assert.deepEqual(w.b().pool, ['t1', 't2', 't4', 't5', 't3', 't0'], 'a, then b, appended');
    assert.deepEqual(w.b().selectedPair, ['t1'], 'the half-picked pair is not cleared');
    assert.notOk(w.has('undo-match-btn'), 'nothing left to undo');
  });
});

test('free pick: the third match empties the pool and the next render moves on to the bye (a render-time write, as today)', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    w.render();
    playRound1(w, [['t0', 't3'], ['t1', 't4']]);
    assert.equal(w.b().phase, 'round1');
    assert.deepEqual(w.b().pool, ['t2', 't5']);
    w.chip('t2'); w.chip('t5');
    w.winner('t5');
    assert.deepEqual(w.b().pool, []);
    assert.equal(w.b().phase, 'bye', 'the render after the last match writes the new phase');
    assert.ok(/Who gets the bye\?/.test(w.html()));
    assert.deepEqual(w.b().matches.map((m) => m.winner), ['t0', 't1', 't5']);
  });
});

test('"By the standings": a director is suggested the best remaining team against the lowest, and one tap calls them up', () => {
  const g = tournament();
  g.bracketSeed = 'standings';
  seedPoints({ gold: 't2', silver: 't4', bronze: 't0' });
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    w.render();
    assert.ok(w.has('seed-suggest-btn'), 'the suggestion shows');
    // t2 leads (7), t4 next (5), t0 (3); the others are on 0 and come in roster order: t1, t3, t5 - the LAST of those is t5.
    assert.ok(/Suggested by the points/.test(w.html()));
    w.suggest();
    assert.deepEqual(w.b().selectedPair, ['t2', 't5']);
    assert.notOk(w.has('seed-suggest-btn'), 'a pair already called up has no suggestion');
  });
});

test('"By the standings" suggests nothing to a screen without confirmed points, to fixed pairs, or on another seed', () => {
  const g = tournament();
  g.bracketSeed = 'standings';
  seedPoints({ gold: 't2', silver: 't4', bronze: 't0' });
  state.brackets[g.id] = freshBracket();
  assert.ok(bracketSuggestPair(g, state.brackets[g.id]));
  setMemberRole('editor', { provisional: true });
  assert.equal(bracketSuggestPair(g, state.brackets[g.id]), null, 'a hinted editor has no points to judge by');
  setMemberRole('viewer');
  assert.equal(bracketSuggestPair(g, state.brackets[g.id]), null);
  setMemberRole('editor');
  g.bracketSeed = 'pick';
  assert.equal(bracketSuggestPair(g, state.brackets[g.id]), null);
  g.bracketSeed = 'standings';
  g.roundOneMatchups = [['t0', 't1'], ['t2', 't3'], ['t4', 't5']];
  assert.equal(bracketSuggestPair(g, state.brackets[g.id]), null, 'fixed pairs have no choice to suggest');
});

// ── round 1, fixed order ────────────────────────────────────────────────────────────────────────────────────────

test('fixed order: the preset pairs are walked in order, shown up front, and a tap records THAT pair', () => {
  const g = tournament('kangaroo-kickball');
  assert.deepEqual(g.roundOneMatchups, [['t0', 't3'], ['t1', 't4'], ['t2', 't5']]);
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    w.render();
    assert.ok(/Match order/.test(w.html()) && /mo-current/.test(w.html()) && /NOW/.test(w.html()));
    assert.deepEqual(w.winners().sort(), ['t0', 't3'], 'the first preset pair is up');
    assert.deepEqual(currentMatchupOf(g, w.b()), ['t0', 't3']);
    assert.deepEqual(nextMatchupOf(g, w.b()), ['t1', 't4'], 'the on-deck pair is known');
    w.winner('t3');
    assert.deepEqual(w.b().matches, [{ a: 't0', b: 't3', winner: 't3', loser: 't0' }]);
    assert.deepEqual(w.b().pool, ['t1', 't2', 't4', 't5']);
    assert.deepEqual(w.b().selectedPair, []);
    assert.ok(/Match 2 of 3/.test(w.html()) && /won/.test(w.html()));
    assert.deepEqual(currentMatchupOf(g, w.b()), ['t1', 't4']);
    w.winner('t1');
    assert.deepEqual(currentMatchupOf(g, w.b()), ['t2', 't5']);
    assert.equal(nextMatchupOf(g, w.b()), null, 'nothing after the last preset pair');
    w.winner('t2');
    assert.equal(w.b().phase, 'bye');
    assert.deepEqual(w.b().matches.map((m) => m.winner), ['t3', 't1', 't2']);
  });
});

test('fixed order: Undo last match steps back one pair', () => {
  const g = tournament('kangaroo-kickball');
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    w.render();
    assert.notOk(w.has('undo-match-btn'), 'nothing to undo yet');
    w.winner('t0');
    assert.ok(w.has('undo-match-btn'));
    w.press('undo-match-btn');
    assert.deepEqual(w.b().matches, []);
    assert.deepEqual(w.b().pool, ['t1', 't2', 't4', 't5', 't0', 't3']);
    assert.deepEqual(currentMatchupOf(g, w.b()), ['t0', 't3'], 'the same pair is up again');
  });
});

// ── the bye ─────────────────────────────────────────────────────────────────────────────────────────────────────

function toBye(w, g) {
  w.render();
  playRound1(w, [['t0', 't3'], ['t1', 't4'], ['t2', 't5']]);
  assert.equal(w.b().phase, 'bye');
}

test('the bye: the Round 1 winner with the fewest points is suggested; a tie suggests nobody', () => {
  const g = tournament();
  seedPoints({ gold: 't0', silver: 't1', bronze: 't5' }); // t0 7, t1 5, t5 3: winners t0 7, t1 5, t2 0
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    toBye(w, g);
    assert.ok(/The app suggests <strong>[^<]+<\/strong> — but you decide/.test(w.html()), w.html());
    assert.ok(w.html().indexOf(teamName('t2')) !== -1);
    assert.ok(/suggested-chip/.test(w.html()) && /⭐/.test(w.html()), 'one chip is starred');
    assert.ok(/0 pts this week · suggested/.test(w.html()) && /7 pts this week/.test(w.html()) && /5 pts this week/.test(w.html()));
  });
  // Two winners tied for the fewest: pick whoever you like.
  const g2 = tournament();
  seedPoints({ gold: 't0', silver: 't4', bronze: 't5' }); // winners t0 7, t1 0, t2 0
  state.brackets[g2.id] = freshBracket();
  withWizard(g2, (w) => {
    toBye(w, g2);
    assert.ok(/tied for the fewest, so pick whoever you like/.test(w.html()));
    assert.notOk(/suggested-chip/.test(w.html()));
  });
});

test('the bye: a screen without confirmed points shows the picker with no numbers and no suggestion', () => {
  const g = tournament();
  seedPoints({ gold: 't0', silver: 't1', bronze: 't5' });
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    toBye(w, g);
    setMemberRole('editor', { provisional: true });
    w.render();
    assert.ok(/show once your sign-in is confirmed/.test(w.html()));
    assert.notOk(/pts this week|suggested/.test(w.html()), 'never the zeros medalCounts() returns to it');
    assert.deepEqual(Object.keys(w.live.tie), ['t0', 't1', 't2'], 'the winners can still be picked');
  });
});

test('choosing the bye: the others meet in the championship game, in the order they won, and the phase moves on', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  state.meta.lastDataChangeAt = undefined;
  withWizard(g, (w) => {
    toBye(w, g);
    w.bye('t1');
    assert.equal(w.b().byeTeamId, 't1');
    assert.deepEqual(w.b().semifinal, { a: 't0', b: 't2', winner: null, loser: null });
    assert.equal(w.b().phase, 'semifinal');
    assert.equal(w.b().championship, null);
    assert.ok(state.meta.lastDataChangeAt);
    assert.ok(/Championship Game/.test(w.html()) && /has the bye/.test(w.html()));
  });
});

test('Back to Round 1 from the bye takes the last match back and re-pools its teams', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    toBye(w, g);
    w.press('undo-to-round1-btn');
    assert.equal(w.b().phase, 'round1');
    assert.deepEqual(w.b().matches.map((m) => m.winner), ['t0', 't1']);
    assert.deepEqual(w.b().pool, ['t2', 't5'], 'a then b of the undone match');
    assert.ok(/Match 3 of 3/.test(w.html()));
  });
});

// ── the championship game, the final, the summary ───────────────────────────────────────────────────────────────

function toSemifinal(w, g) {
  toBye(w, g);
  w.bye('t2');
  assert.equal(w.b().phase, 'semifinal');
}

test('the championship game: the winner meets the bye team in the final; the loser has the bronze', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  state.meta.lastDataChangeAt = undefined;
  withWizard(g, (w) => {
    toSemifinal(w, g);
    assert.deepEqual(currentMatchupOf(g, w.b()), ['t0', 't1']);
    assert.equal(nextMatchupOf(g, w.b()), null);
    w.winner('t1');
    assert.deepEqual(w.b().semifinal, { a: 't0', b: 't1', winner: 't1', loser: 't0' });
    assert.deepEqual(w.b().championship, { a: 't2', b: 't1', winner: null, loser: null });
    assert.equal(w.b().phase, 'championship');
    assert.ok(/<h3>Final<\/h3>/.test(w.html()));
    assert.ok(new RegExp('takes the bronze medal').test(w.html()) && w.html().indexOf(teamName('t0')) !== -1);
    assert.ok(/\(\+3 pts\)/.test(w.html()), 'a director sees what the bronze is worth');
    assert.deepEqual(currentMatchupOf(g, w.b()), ['t2', 't1']);
  });
});

test('the final: the winner and loser are recorded and the bracket reaches its summary', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    toSemifinal(w, g);
    w.winner('t1');
    w.winner('t2');
    assert.deepEqual(w.b().championship, { a: 't2', b: 't1', winner: 't2', loser: 't1' });
    assert.equal(w.b().phase, 'summary');
    assert.equal(currentMatchupOf(g, w.b()), null, 'nothing waits on a winner at the summary');
    assert.ok(/Game results/.test(w.html()) && w.has('save-bracket-btn'));
    assert.ok(/Eliminated in Round 1:/.test(w.html()));
    ['t3', 't4', 't5'].forEach((id) => assert.ok(w.html().indexOf(teamName(id)) !== -1, id + ' is listed as eliminated'));
  });
});

test('Save Result: the exact result record, the bracket and tally gone, standings fed, the winner celebrated', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  state.live[g.id] = { key: 't2|t1', inning: 1, outs: 0, half: 0, hr: { t2: 2 } };
  state.meta.lastDataChangeAt = undefined;
  withWizard(g, (w) => {
    toSemifinal(w, g);
    w.winner('t1');
    w.winner('t2');
    const before = medalCounts();
    assert.equal(before.t2.points, 0);
    w.press('save-bracket-btn');
    const r = state.results[g.id];
    assert.deepEqual(Object.keys(r).sort(), ['medals', 'savedAt'], 'exactly these two fields');
    assert.deepEqual(r.medals, { gold: 't2', silver: 't1', bronze: 't0' });
    assert.ok(!Number.isNaN(Date.parse(r.savedAt)));
    assert.notOk(state.brackets[g.id], 'the bracket is deleted');
    assert.notOk(state.live[g.id], 'and so is its live tally');
    assert.ok(state.meta.lastDataChangeAt);
    assert.deepEqual(w.celebrated, ['t2']);
    const after = medalCounts();
    assert.equal(after.t2.gold, 1); assert.equal(after.t2.points, MEDAL_POINTS.gold);
    assert.equal(after.t1.silver, 1); assert.equal(after.t1.points, MEDAL_POINTS.silver);
    assert.equal(after.t0.bronze, 1); assert.equal(after.t0.points, MEDAL_POINTS.bronze);
    ['t3', 't4', 't5'].forEach((id) => assert.equal(after[id].points, 0, id + ' got nothing'));
  });
});

test('a messtival game pays double, in the summary chips and in medalCounts', () => {
  const g = tournament();
  g.messtival = true;
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    toSemifinal(w, g);
    w.winner('t1');
    assert.ok(new RegExp('\\(\\+' + MEDAL_POINTS.bronze * 2 + ' pts\\)').test(w.html()), 'the bronze note doubles');
    w.winner('t2');
    assert.ok(w.html().indexOf('+' + MEDAL_POINTS.gold * 2 + ' pts') !== -1, 'the summary chips double');
    w.press('save-bracket-btn');
    const c = medalCounts();
    assert.equal(c.t2.points, MEDAL_POINTS.gold * 2);
    assert.equal(c.t1.points, MEDAL_POINTS.silver * 2);
    assert.equal(c.t0.points, MEDAL_POINTS.bronze * 2);
    assert.equal(c.t2.gold, 1, 'medal COUNTS stay raw');
  });
});

test('the points chips are directors\' only: a screen without confirmed points shows the medals and no numbers', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    toSemifinal(w, g);
    w.winner('t1');
    setMemberRole('editor', { provisional: true });
    w.render();
    assert.notOk(/pts\)/.test(w.html()), 'no worth in the bronze note');
    state.brackets[g.id].phase = 'summary';
    state.brackets[g.id].championship = { a: 't2', b: 't1', winner: 't2', loser: 't1' };
    w.render();
    assert.ok(/🥇/.test(w.html()));
    assert.notOk(/medal-points|\+\d+ pts/.test(w.html()));
  });
});

// ── cancel, clear, the guards ───────────────────────────────────────────────────────────────────────────────────

test('Cancel this bracket asks first; yes deletes the bracket and the tally, no keeps both', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  state.live[g.id] = { key: 't0|t1', inning: 1, outs: 0, half: 0, hr: {} };
  withWizard(g, (w) => {
    w.render();
    w.answer = false;
    w.press('cancel-bracket-btn');
    assert.ok(state.brackets[g.id] && state.live[g.id], 'declined: nothing changed');
    assert.ok(/Cancel this bracket\? Nothing will be saved/.test(w.asked[0]));
    w.answer = true;
    w.press('cancel-bracket-btn');
    assert.notOk(state.brackets[g.id]);
    assert.notOk(state.live[g.id]);
    assert.ok(w.has('start-bracket-btn'), 'the Start card is back');
  });
});

test('Clear result takes the points off and brings back no bracket (asked first, and only a director can)', async () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    toSemifinal(w, g);
    w.winner('t1'); w.winner('t2'); w.press('save-bracket-btn');
  });
  assert.ok(state.results[g.id]);
  assert.equal(medalCounts().t2.points, MEDAL_POINTS.gold);
  state.ui.gameId = g.id;
  const realAsk = askDialog;
  const realRender = renderAll;
  renderAll = () => {};
  try {
    askDialog = async () => 'cancel';
    assert.equal(await gamesChangeResult(), false);
    assert.ok(state.results[g.id], 'declined: kept');
    askDialog = async () => 'clear';
    setMemberRole('viewer');
    assert.equal(await gamesChangeResult(), false, 'a viewer cannot');
    assert.ok(state.results[g.id]);
    setMemberRole('editor');
    assert.equal(await gamesChangeResult(), true);
  } finally { askDialog = realAsk; renderAll = realRender; }
  assert.notOk(state.results[g.id], 'the result is cleared');
  assert.equal(medalCounts().t2.points, 0, 'its points come off the standings');
  assert.notOk(state.brackets[g.id], 'no bracket comes back');
  assert.notOk(state.brackets4 && state.brackets4[g.id], 'and no four-team one either');
});

// CHANGED ON PURPOSE (Step 22, session 2): a roster of four used to be refused here like any other size. It is now the four-team
// bracket's (renderTournament hands it to renderBracketFour: bracket.senior.test.js runs it), so the wizard's refusal is for the
// sizes that still have no bracket.
test('the six-team wizard refuses any other roster size and says how many teams there are', () => {
  [5, 3, 2].forEach((n) => {
    const g = tournament();
    state.teams = state.teams.slice(0, n);
    withWizard(g, (w) => {
      w.render();
      assert.ok(new RegExp('needs exactly 6 teams — you have ' + n).test(w.html()), w.html());
      assert.notOk(w.has('start-bracket-btn'), 'no Start card');
      assert.notOk(state.brackets[g.id], 'no bracket was created');
    });
  });
});

test('the own-team guard: an editor on a team in a match gets no winner buttons for it, and does for other matches', () => {
  const g = tournament('kangaroo-kickball');
  state.brackets[g.id] = freshBracket();
  setMemberTeam('t0');
  withWizard(g, (w) => {
    w.render();
    assert.deepEqual(w.winners(), [], 't0 plays the first preset match');
    assert.ok(/read-only for you/.test(w.html()), 'the reason is said');
    state.brackets[g.id].matches.push({ a: 't0', b: 't3', winner: 't3', loser: 't0' });
    state.brackets[g.id].pool = ['t1', 't2', 't4', 't5'];
    w.render();
    assert.deepEqual(w.winners().sort(), ['t1', 't4'], 'the next match is theirs to record');
  });
  setMemberTeam(null);
});

// ── what spectators and the Now card read ───────────────────────────────────────────────────────────────────────

test('currentMatchupOf / nextMatchupOf / upcomingMatchups / findNextMatchupFor follow the six-team phases', () => {
  const g = tournament();
  assert.equal(currentMatchupOf(g, null), null);
  const b = freshBracket();
  state.brackets[g.id] = b;
  assert.equal(currentMatchupOf(g, b), null, 'free pick with nobody called up');
  b.selectedPair = ['t4', 't1'];
  assert.deepEqual(currentMatchupOf(g, b), ['t4', 't1']);
  assert.equal(nextMatchupOf(g, b), null, 'a free-pick round 1 has no known next pair');
  assert.deepEqual(upcomingMatchups(g).map((s) => [s.aId, s.bId]), [['t4', 't1']]);
  assert.deepEqual(findNextMatchupFor('t4'), { game: g, opponentId: 't1' });
  assert.equal(findNextMatchupFor('t0'), null);
  b.phase = 'semifinal';
  b.byeTeamId = 't2';
  b.semifinal = { a: 't0', b: 't1', winner: null, loser: null };
  assert.deepEqual(currentMatchupOf(g, b), ['t0', 't1']);
  b.semifinal.winner = 't1'; b.semifinal.loser = 't0';
  assert.equal(currentMatchupOf(g, b), null, 'a decided semifinal waits on nothing');
  b.phase = 'championship';
  b.championship = { a: 't2', b: 't1', winner: null, loser: null };
  assert.deepEqual(currentMatchupOf(g, b), ['t2', 't1']);
  state.results[g.id] = { medals: { gold: 't2', silver: 't1', bronze: 't0' }, savedAt: new Date().toISOString() };
  assert.equal(findNextMatchupFor('t2'), null, 'a saved game has no next matchup');
});

test('gameRowStatus: a bracket in progress is live, a summary or a stale bracket on a changed format is not, a result is done', () => {
  const g = tournament();
  assert.equal(gameRowStatus(g), 'todo');
  state.brackets[g.id] = freshBracket();
  assert.equal(gameRowStatus(g), 'live');
  state.brackets[g.id].phase = 'summary';
  assert.equal(gameRowStatus(g), 'todo', 'a finished bracket that is not saved yet is not "live"');
  state.brackets[g.id].phase = 'round1';
  g.format = 'tally';
  assert.equal(gameRowStatus(g), 'todo', 'the stale bracket of a changed format does not pin it live');
  g.format = 'tournament';
  state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: new Date().toISOString() };
  assert.equal(gameRowStatus(g), 'done');
});

test('a viewer reads the live matchup through renderLiveWatch, with the six-team phase words', () => {
  const g = tournament('musical-chairs');
  g.liveTracker = null;
  const b = freshBracket();
  b.phase = 'semifinal'; b.byeTeamId = 't2';
  b.semifinal = { a: 't0', b: 't1', winner: null, loser: null };
  b.matches = [{ a: 't0', b: 't3', winner: 't0', loser: 't3' }, { a: 't1', b: 't4', winner: 't1', loser: 't4' }, { a: 't2', b: 't5', winner: 't2', loser: 't5' }];
  state.brackets[g.id] = b;
  setMemberRole('viewer');
  const el = document.createElement('div');
  renderLiveWatch(el, g);
  assert.ok(/Live now · Championship game/.test(el.innerHTML), el.innerHTML);
  assert.ok(/Completed:/.test(el.innerHTML) && /def\./.test(el.innerHTML));
  assert.notOk(/winner-btn|save-bracket/.test(el.innerHTML), 'a spectator can record nothing');
  b.phase = 'championship';
  b.semifinal.winner = 't1'; b.semifinal.loser = 't0';
  b.championship = { a: 't2', b: 't1', winner: null, loser: null };
  renderLiveWatch(el, g);
  assert.ok(/Live now · Final/.test(el.innerHTML));
});

// ── sync, normalize, prune ──────────────────────────────────────────────────────────────────────────────────────

test('a six-team bracket syncs as one write per GAME (brackets/<gid>), and a cleared one as its deletion', () => {
  const g = tournament();
  const a = syncedSnapshot();
  state.brackets[g.id] = freshBracket();
  const b = syncedSnapshot();
  assert.deepEqual(Object.keys(computeSyncUpdates(a, b)), ['brackets/' + g.id]);
  state.brackets[g.id].phase = 'bye';
  const c = syncedSnapshot();
  assert.deepEqual(Object.keys(computeSyncUpdates(b, c)), ['brackets/' + g.id]);
  delete state.brackets[g.id];
  assert.deepEqual(computeSyncUpdates(c, syncedSnapshot()), { ['brackets/' + g.id]: null });
});

test('normalizeBracket heals what RTDB prunes of a six-team bracket (pool, pair, matches, bye, rounds, phase)', () => {
  const b = normalizeBracket({ pool: ['t0', 't1'] });
  assert.deepEqual(b, { pool: ['t0', 't1'], selectedPair: [], matches: [], phase: 'round1', byeTeamId: null, semifinal: null, championship: null });
  assert.equal(normalizeBracket({ phase: 'summary', semifinal: { winner: 't1' } }).phase, 'summary');
});

test('a six-team bracket never reads a four-team record as its own, and never heals one', () => {
  // The four-team bracket's shape ({ at, m: { s1, s2 } }) must reach the six-team code as an unknown bracket: nothing
  // stamped on it, nothing rendered as a round 1.
  const four = { at: 1700000000000, m: { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } } };
  assert.equal(bracketKnown(four), false);
  const copy = JSON.parse(JSON.stringify(four));
  assert.deepEqual(normalizeBracket(copy), four);
  assert.deepEqual(copy, four, 'untouched');
});

test('deleting a game, or changing its format, drops its bracket along with the rest of what it holds', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  state.live[g.id] = { key: 't0|t1', inning: 1, outs: 0, half: 0, hr: {} };
  assert.deepEqual(gameRecordLabels(g.id).sort(), ['the bracket in progress', 'the live match'].sort());
  clearGameRecords(g.id);
  assert.notOk(state.brackets[g.id]);
  assert.notOk(state.live[g.id]);
  // an orphan (its game is gone) is pruned with the rest
  state.brackets['ghost-game'] = freshBracket();
  pruneOrphanedGameData();
  assert.notOk(state.brackets['ghost-game']);
});

// ── a seeded random walk over the whole flow ────────────────────────────────────────────────────────────────────

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('fuzz: a random walk of taps, undos and back-steps never breaks the six-team invariants, and always ends in a valid result', () => {
  const ids = ['t0', 't1', 't2', 't3', 't4', 't5'];
  for (let seed = 1; seed <= 24; seed++) {
    const rnd = lcg(seed * 7919);
    const g = tournament(seed % 2 ? 'jeb-ball' : 'kangaroo-kickball');
    if (seed % 3 === 0) g.messtival = true;
    state.brackets[g.id] = freshBracket();
    withWizard(g, (w) => {
      w.render();
      let guard = 0;
      while (state.brackets[g.id] && guard++ < 200) {
        const b = w.b();
        // invariants at every step
        const inMatches = [].concat(...b.matches.map((m) => [m.a, m.b]));
        assert.equal(new Set(inMatches.concat(b.pool)).size, 6, 'seed ' + seed + ': every team is in exactly one place (' + JSON.stringify(b) + ')');
        assert.equal(inMatches.length + b.pool.length, 6, 'seed ' + seed + ': nobody twice');
        assert.ok(b.matches.every((m) => m.winner !== m.loser && [m.a, m.b].includes(m.winner) && [m.a, m.b].includes(m.loser)));
        if (b.phase === 'round1') {
          const pre = Array.isArray(g.roundOneMatchups) && g.roundOneMatchups.length;
          if (b.matches.length && rnd() < 0.25) { w.press('undo-match-btn'); continue; }
          if (pre) { w.winner(pre ? w.winners()[Math.floor(rnd() * 2)] : null); continue; }
          if (w.b().selectedPair.length === 2) { w.winner(w.b().selectedPair[Math.floor(rnd() * 2)]); continue; }
          const free = b.pool.filter((id) => !b.selectedPair.includes(id));
          w.chip(free[Math.floor(rnd() * free.length)]);
        } else if (b.phase === 'bye') {
          if (rnd() < 0.2) { w.press('undo-to-round1-btn'); continue; }
          const winners = Object.keys(w.live.tie);
          assert.equal(winners.length, 3, 'seed ' + seed + ': three Round 1 winners to choose a bye from');
          w.bye(winners[Math.floor(rnd() * 3)]);
        } else if (b.phase === 'semifinal') {
          assert.ok(b.byeTeamId && b.semifinal && ![b.semifinal.a, b.semifinal.b].includes(b.byeTeamId));
          w.winner(w.winners()[Math.floor(rnd() * 2)]);
        } else if (b.phase === 'championship') {
          assert.equal(b.championship.a, b.byeTeamId, 'the bye team waits in the final');
          assert.equal(b.championship.b, b.semifinal.winner);
          w.winner(w.winners()[Math.floor(rnd() * 2)]);
        } else {
          assert.equal(b.phase, 'summary');
          w.press('save-bracket-btn');
        }
      }
      assert.ok(guard < 200, 'seed ' + seed + ': the walk ends');
      const r = state.results[g.id];
      assert.ok(r, 'seed ' + seed + ': a result was saved');
      const m = [r.medals.gold, r.medals.silver, r.medals.bronze];
      assert.equal(new Set(m).size, 3, 'seed ' + seed + ': three different medalists');
      assert.ok(m.every((id) => ids.includes(id)));
      const c = medalCounts();
      const total = ids.reduce((s, id) => s + c[id].points, 0);
      assert.equal(total, (MEDAL_POINTS.gold + MEDAL_POINTS.silver + MEDAL_POINTS.bronze) * (g.messtival ? 2 : 1), 'seed ' + seed + ': the standings took exactly this game\'s medals');
    });
  }
});

// ── the extracted helpers, called directly (added with the extraction; the cases above never changed) ─────────────

test('the six-team helpers: each does one thing to the bracket and refuses what cannot be', () => {
  const b = freshBracket();
  assert.deepEqual(sixPick(b, 't1'), ['t1']);
  assert.deepEqual(sixPick(b, 't2'), ['t1', 't2']);
  assert.deepEqual(sixPick(b, 't3'), ['t1', 't2'], 'no third');
  assert.deepEqual(sixPick(b, 't1'), ['t2'], 'a picked team comes out');

  assert.equal(sixRecordMatch(b, 't1', 't1', 't1'), null, 'a team does not play itself');
  assert.equal(sixRecordMatch(b, 't1', 't2', 't4'), null, 'the winner played');
  assert.equal(sixRecordMatch(b, '', 't2', 't2'), null);
  assert.deepEqual(b.matches, [], 'a refusal changes nothing');
  assert.deepEqual(sixRecordMatch(b, 't1', 't2', 't2'), { a: 't1', b: 't2', winner: 't2', loser: 't1' });
  assert.deepEqual(b.pool, ['t0', 't3', 't4', 't5']);
  assert.deepEqual(b.selectedPair, []);

  assert.deepEqual(sixUndoMatch(b), { a: 't1', b: 't2', winner: 't2', loser: 't1' });
  assert.deepEqual(b.pool, ['t0', 't3', 't4', 't5', 't1', 't2']);
  assert.equal(sixUndoMatch(b), null, 'nothing to take back');
  assert.deepEqual(b.pool, ['t0', 't3', 't4', 't5', 't1', 't2']);

  const c = Object.assign(freshBracket(), { matches: [{ a: 't0', b: 't3', winner: 't0', loser: 't3' }, { a: 't1', b: 't4', winner: 't1', loser: 't4' }, { a: 't2', b: 't5', winner: 't5', loser: 't2' }], pool: [], phase: 'bye' });
  assert.equal(sixChooseBye(c, 't3'), false, 'a team that lost cannot have the bye');
  assert.equal(c.phase, 'bye');
  assert.equal(sixChooseBye(c, 't1'), true);
  assert.deepEqual([c.byeTeamId, c.semifinal, c.phase], ['t1', { a: 't0', b: 't5', winner: null, loser: null }, 'semifinal']);
  assert.equal(sixRecordSemifinal(c, 't2'), false, 'only a team in the game wins it');
  assert.equal(sixRecordSemifinal(c, 't5'), true);
  assert.deepEqual(c.championship, { a: 't1', b: 't5', winner: null, loser: null });
  assert.equal(c.phase, 'championship');
  assert.equal(sixRecordFinal(c, 't0'), false);
  assert.equal(sixRecordFinal(c, 't1'), true);
  assert.equal(c.phase, 'summary');
  assert.deepEqual(sixMedals(c), { gold: 't1', silver: 't5', bronze: 't0' });
  assert.equal(sixBackToRound1(c).phase, 'round1');
  assert.deepEqual(c.matches.map((m) => m.winner), ['t0', 't1'], 'and the last match is taken back with it');
});

test('finishBracket saves one result record for either kind, retires its node and the tally, and celebrates the winner', () => {
  const g = tournament();
  state.brackets4 = state.brackets4 || {};
  state.brackets[g.id] = freshBracket();
  state.live[g.id] = { key: 't0|t1', inning: 1, outs: 0, half: 0, hr: {} };
  const realRender = renderAll; const realCelebrate = celebrate;
  const won = [];
  renderAll = () => {}; celebrate = (id) => won.push(id);
  try {
    finishBracket(g, 'six', { gold: 't0', silver: 't1', bronze: 't2' });
    assert.deepEqual(Object.keys(state.results[g.id]).sort(), ['medals', 'savedAt'], 'a six-team result carries no path');
    assert.notOk(state.brackets[g.id]); assert.notOk(state.live[g.id]);
    delete state.results[g.id];
    state.brackets4[g.id] = { at: 1, m: { s1: { a: 't0', b: 't1' } } };
    state.brackets[g.id] = freshBracket(); // a six-team leftover must not be touched by a four-team finish
    const path = { at: 1, m: { s1: { a: 't0', b: 't1', winner: 't0' } } };
    finishBracket(g, 'four', { gold: 't3', silver: 't2', bronze: 't1' }, path);
    assert.deepEqual(state.results[g.id].medals, { gold: 't3', silver: 't2', bronze: 't1' });
    assert.deepEqual(state.results[g.id].path, path, 'the finished bracket stays on the result');
    assert.notOk(state.brackets4[g.id]);
    assert.ok(state.brackets[g.id], 'only the finished kind\'s node is cleared');
    assert.deepEqual(won, ['t0', 't3']);
  } finally { renderAll = realRender; celebrate = realCelebrate; }
});

// ── Step 22, session 2: Undo at every step, and the stale-tap guard (added after the pin; the cases above are untouched) ─────────

// The wizard driver captures a click for each button it knows by id; the three Undo buttons are new.
['undo-bye-btn', 'undo-semifinal-btn', 'undo-final-btn'].forEach((id) => BTN_IDS.push(id));

test('the three new six-team helpers each take back exactly one step, and refuse what has moved on', () => {
  const c = Object.assign(freshBracket(), { matches: [{ a: 't0', b: 't3', winner: 't0', loser: 't3' }, { a: 't1', b: 't4', winner: 't1', loser: 't4' }, { a: 't2', b: 't5', winner: 't5', loser: 't2' }], pool: [], phase: 'bye' });
  assert.equal(sixChooseBye(c, 't1'), true);
  assert.equal(sixRecordSemifinal(c, 't5'), true);
  assert.equal(sixRecordFinal(c, 't1'), true);
  // back, one step at a time, in the order they were played
  assert.equal(sixBackToBye(c), false, 'the championship game has a winner: its result comes back first');
  assert.equal(sixUndoSemifinal(c), false, 'the final has a winner: its result comes back first');
  assert.equal(sixUndoFinal(c), true);
  assert.deepEqual([c.phase, c.championship.winner, c.championship.loser, c.championship.a, c.championship.b], ['championship', null, null, 't1', 't5']);
  assert.equal(sixUndoFinal(c), false, 'nothing to take back twice');
  assert.equal(sixUndoSemifinal(c), true);
  assert.deepEqual([c.phase, c.semifinal, c.championship], ['semifinal', { a: 't0', b: 't5', winner: null, loser: null }, null]);
  assert.equal(sixUndoSemifinal(c), false);
  assert.equal(sixBackToBye(c), true);
  assert.deepEqual([c.phase, c.byeTeamId, c.semifinal, c.championship], ['bye', null, null, null]);
  assert.equal(sixBackToBye(c), false);
  assert.deepEqual(c.matches.map((m) => m.winner), ['t0', 't1', 't5'], 'the three round-1 winners are as they were');
  assert.equal(sixChooseBye(c, 't5'), true, 'and the bye can be chosen again');
});

test('Undo at every step through the wizard: the final, the championship game, the bye, round 1 - each back to exactly what was there before', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    toSemifinal(w, g);
    const snaps = {};
    snaps.semifinal = clone6(w.b());
    w.winner('t1');
    snaps.championship = clone6(w.b());
    w.winner('t2');
    assert.equal(w.b().phase, 'summary');
    assert.ok(w.has('undo-final-btn'), 'the summary can take the final back');
    w.press('undo-final-btn');
    assert.deepEqual(w.b(), snaps.championship, 'back at the final, as it was before it was played');
    assert.ok(/<h3>Final<\/h3>/.test(w.html()) && w.has('undo-semifinal-btn'));
    w.press('undo-semifinal-btn');
    assert.deepEqual(w.b(), snaps.semifinal, 'back at the championship game, as it was before it was played');
    assert.ok(/Championship Game/.test(w.html()) && w.has('undo-bye-btn'));
    w.press('undo-bye-btn');
    assert.equal(w.b().phase, 'bye');
    assert.equal(w.b().byeTeamId, null);
    assert.ok(/Who gets the bye\?/.test(w.html()));
    w.bye('t0'); // a different bye this time
    assert.equal(w.b().byeTeamId, 't0');
    assert.deepEqual(w.b().semifinal, { a: 't1', b: 't2', winner: null, loser: null });
  });
});

test('the own-team guard on the new Undo buttons: a director on a team in the match leaves taking its result back to another director', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  withWizard(g, (w) => {
    toSemifinal(w, g);
    w.winner('t1'); // championship game t0 v t1 recorded; the final is t2 v t1
    assert.ok(w.has('undo-semifinal-btn'));
    setMemberTeam('t0');
    w.render();
    assert.notOk(w.has('undo-semifinal-btn'), 't0 played the championship game');
    setMemberTeam('t4');
    w.render();
    assert.ok(w.has('undo-semifinal-btn'), 'a director on a team that is not in it may');
    setMemberTeam(null);
  });
});

// A bracket as it is stored, for comparing "as it was".
function clone6(b) { return JSON.parse(JSON.stringify(b)); }

test('a stale tap is ignored, said and repainted: the screen was drawn before another phone recorded the match', () => {
  const g = tournament();
  state.brackets[g.id] = freshBracket();
  const realToast = showToast; const said = [];
  showToast = (m) => { said.push(String(m)); };
  try {
    withWizard(g, (w) => {
      w.render();
      w.chip('t0'); w.chip('t3');
      const handler = w.live.winner.t0; // the screen's winner button, drawn for the pair t0 v t3
      // another phone records that very match; this phone's snapshot replaces the bracket under the screen
      const other = clone6(state.brackets[g.id]);
      sixRecordMatch(other, 't0', 't3', 't3');
      state.brackets[g.id] = other;
      const before = clone6(other);
      const renders = w.renders;
      bracketTapReset(); // the stale screen's tap comes later than the device's own last one: this is the stale-screen guard, not the double-tap one
      handler();
      assert.deepEqual(state.brackets[g.id], before, 'nothing was recorded, on the live bracket or any copy');
      assert.ok(said.some((m) => /already recorded|moved on/.test(m)) || said.length === 1, said.join('|'));
      assert.ok(w.renders > renders, 'and the screen repaints');
    });
    // a tap on the bye screen after the bracket moved on
    state.brackets[g.id] = freshBracket();
    withWizard(g, (w) => {
      toBye(w, g);
      const chip = w.live.tie.t0;
      sixChooseBye(state.brackets[g.id], 't1'); // another phone chose the bye
      const before = clone6(state.brackets[g.id]);
      said.length = 0;
      bracketTapReset();
      chip();
      assert.deepEqual(state.brackets[g.id], before, 'the first choice stands');
      assert.equal(said.length, 1);
    });
    // Save Result after the result was saved (a second tap, or another phone) saves nothing twice
    state.brackets[g.id] = freshBracket();
    withWizard(g, (w) => {
      toSemifinal(w, g); w.winner('t1'); w.winner('t2');
      const press = realGet2('save-bracket-btn').__click;
      state.results[g.id] = { medals: { gold: 't5', silver: 't4', bronze: 't3' }, savedAt: 'other phone' };
      press();
      assert.equal(state.results[g.id].savedAt, 'other phone', 'the saved result is not replaced');
      assert.deepEqual(w.celebrated, [], 'and nothing is celebrated again');
    });
  } finally { showToast = realToast; }
});
function realGet2(id) { return document.getElementById(id); }

test('a stale fixed-order tap records nothing: the match on screen is not the match the bracket is at', () => {
  const g = tournament('kangaroo-kickball');
  state.brackets[g.id] = freshBracket();
  const realToast = showToast; showToast = () => {};
  try {
    withWizard(g, (w) => {
      w.render();
      const handler = w.live.winner.t0; // pair t0 v t3 is on screen
      const other = clone6(state.brackets[g.id]);
      sixRecordMatch(other, 't0', 't3', 't3'); // another phone already recorded it
      state.brackets[g.id] = other;
      const before = clone6(other);
      bracketTapReset();
      handler();
      assert.deepEqual(state.brackets[g.id], before, 'the next pair is not given the first one\'s winner');
    });
  } finally { showToast = realToast; }
});

// ── function review of Step 22 ──────────────────────────────────────────────────────────────────────────────────

test('a quick second tap on a six-team winner button is ignored and said: the next pair is not recorded with the first one\'s team', () => {
  const g = tournament('kangaroo-kickball');
  state.brackets[g.id] = freshBracket();
  const realToast = showToast; const said = []; showToast = (m) => { said.push(String(m)); };
  try {
    withWizard(g, (w) => {
      w.render();
      bracketTapReset();
      w.live.winner.t0(); // the first tap: pair t0 v t3 is recorded
      assert.equal(state.brackets[g.id].matches.length, 1);
      w.render();
      const second = Object.keys(w.live.winner)[0]; // the next pair's first winner button sits at the same spot
      assert.ok(second, 'the next pair is on screen');
      w.live.winner[second](); // the double tap's second tap, no reset
      assert.equal(state.brackets[g.id].matches.length, 1, 'recorded nothing');
      assert.ok(said.some((m) => /came right after the last one, so it was ignored/.test(m)), said.join('|'));
      bracketTapLast.record -= BRACKET_TAP_SETTLE_MS + 1;
      w.live.winner[second]();
      assert.equal(state.brackets[g.id].matches.length, 2, 'a moment later it is recorded');
    });
  } finally { showToast = realToast; }
});

test('a four-team record under a six-team camp reads as nothing: no live game, no matchups, no alert (fourRead needs exactly four teams)', () => {
  const g = tournament();
  const stray = { at: 1, m: { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } } };
  state.brackets4[g.id] = stray;
  assert.equal(teamIds().length, 6);
  assert.equal(fourRead(stray, teamIds()), null);
  assert.equal(fourPhase(stray, teamIds()), 'broken');
  assert.ok(gameRowStatus(g) !== 'live', 'not live');
  assert.deepEqual(upcomingMatchups(g), []);
  assert.ok(fourRead(stray, ['t0', 't1', 't2', 't3']), 'the same record reads on a four-team roster');
  delete state.brackets4[g.id];
});
