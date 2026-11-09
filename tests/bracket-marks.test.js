// THE OLDER BRACKET VIEWS WEAR A TEAM'S MARK, AND AN IDLE RENDER MUTATES NOTHING (Step 29 finish).
// The kicking team, the ladder tracker, the free-pick and bye chips and the call-up's winner keys draw a team through
// bracketMarkHtml (a junior shield camp's mark is its emoji, so no <img> is re-created by a rebuild; a flag or tile is
// the real mark). The six-team summary is written through setLiveHtmlIfChanged, so a snapshot that changes nothing
// leaves its shields alone. And the winner keys are plain buttons with every data-winner hook.

function countingContainer() {
  let html = '';
  let writes = 0;
  const c = {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; writes++; },
    writes: () => writes,
  };
  return c;
}

function started(name) {
  freshState();
  setMemberRole('editor');
  const g = state.config.games.find((x) => x.id === name);
  assert.ok(g, 'the sandbox game exists');
  return g;
}

test('the call-up: winner keys are plain buttons carrying data-winner and the team mark; copy is a quiet line', () => {
  started('jeb-ball');
  const html = matchupCalloutHTML('t0', 't1');
  assert.ok(!/<jelly-button/.test(html), 'no Jelly button is left in the call-up');
  const keys = [...html.matchAll(/<button type="button" class="btn winner-btn" data-winner="(t\d)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['t0', 't1']);
  assert.ok(/class="winner-mark"/.test(html) && /class="btn-quiet copy-matchup-btn"/.test(html));
  assert.equal(matchupCalloutHTML('t0', 't1'), html, 'the same call-up is the same markup: nothing to rebuild');
});

test('the kicking team, the ladder and the chips draw the team mark, not a bare emoji', () => {
  const g = started('kangaroo-kickball');
  const k = liveTrackerHTML(g, 't0', 't1', false);
  assert.ok(/id="live-kicking-team"><span class="live-kicking-mark" data-team="t\d">/.test(k), 'the kicking team carries its mark slot');
  assert.equal(liveTrackerHTML(g, 't0', 't1', false), k, 'an idle repaint of the tracker is the same markup');
  const ladder = started('ladder-ball');
  const l = ladderMatchHTML(ladder, 't0', 't1');
  assert.ok(/class="ladder-mark"/.test(l) && !/🪜/.test(l));
  assert.equal(ladderMatchHTML(ladder, 't0', 't1'), l);
});

test('the kicking-team refresh rewrites the mark only when the team changes (the shipped guard)', () => {
  const src = readFixture('../app.js');
  assert.ok(/mk\.dataset\.team !== kid\) \{ mk\.innerHTML = bracketMarkHtml\(kid, 22\)/.test(src), 'the mark is rewritten only for a different team');
  assert.ok(/nm\.textContent = teamName\(kid\)/.test(src), 'the name is text');
});

test('the six-team summary: a second render with nothing changed writes nothing; a change writes again', () => {
  const g = started('jeb-ball');
  state.brackets[g.id] = {
    phase: 'summary', pool: [], selectedPair: [],
    matches: [{ winner: 't0', loser: 't3' }, { winner: 't1', loser: 't4' }, { winner: 't2', loser: 't5' }],
    byeTeamId: 't0',
    semifinal: { a: 't1', b: 't2', winner: 't1', loser: 't2' },
    championship: { a: 't0', b: 't1', winner: 't0', loser: 't1' },
  };
  const c = countingContainer();
  renderTournament(c, g);
  assert.equal(c.writes(), 1, 'the first render writes the summary');
  assert.ok(/Game results/.test(c.innerHTML) && /id="bracket-body"/.test(c.innerHTML));
  renderTournament(c, g);
  renderTournament(c, g);
  assert.equal(c.writes(), 1, 'an idle snapshot renders the summary again and writes nothing');
  state.brackets[g.id].championship.winner = 't1';
  state.brackets[g.id].championship.loser = 't0';
  renderTournament(c, g);
  assert.equal(c.writes(), 2, 'a different winner is a different summary');
  // a replaced game object (a remote snapshot) rebuilds, so the handlers never write into an orphan
  renderTournament(c, Object.assign({}, g));
  assert.equal(c.writes(), 3);
});
