// SCORE ENTRY'S AND THE SIX-TEAM SUMMARY'S SAVE LIVE IN THE TAKEOVER DOCK (Step 29 finish, item C).
// gamesDock tones `tally` and `six` draw like the podium's and the four-team bracket's: the dashed well naming what is missing,
// then the gold Save, then (after the save) the Next game dock. The writers are tallySave / sixSaveResult, which resolve the game
// when the tap fires and refuse a stale form.

function tallyG(scores, id) {
  freshState();
  setMemberRole('editor');
  const g = state.config.games.find((x) => x.id === (id || 'axe-throwing'));
  assert.equal(g.format, 'tally');
  delete state.results[g.id];
  state.drafts[g.id] = { scores: scores || {}, medals: {} };
  return g;
}

test('the tally dock: the dashed well says what is missing, then the gold Save', () => {
  const g = tallyG({});
  assert.deepEqual(gamesDock(g.id).save, { ready: false, label: 'Type the scores first', target: 'scores' });
  state.drafts[g.id].scores = { t0: '5' };
  assert.equal(gamesDock(g.id).save.label, 'Pick silver and bronze');
  state.drafts[g.id].scores = { t0: '5', t1: '4' };
  assert.equal(gamesDock(g.id).save.label, 'Pick bronze, then save');
  state.drafts[g.id].scores = { t0: '5', t1: '4', t2: '3' };
  const d = gamesDock(g.id);
  assert.ok(d.save.ready && d.save.label === 'Save result');
  assert.equal(d.note, '3 of ' + teamIds().length + ' teams have a score', 'while a team has no score, one small line says how many do');
  assert.ok(/<p class="gd-left" id="game-save-note">3 of /.test(gamesDockHtml(d)) && /btn-gold gd-save" id="game-save" data-tone="tally"/.test(gamesDockHtml(d)));
  teamIds().forEach((id, i) => { state.drafts[g.id].scores[id] = String(10 - i); });
  assert.equal(gamesDock(g.id).note, '', 'every team scored: no note');
});

test('the tally dock reads the medals the form shows: a pick that repeats a team keeps the well', () => {
  const g = tallyG({ t0: '9', t1: '8', t2: '7' });
  state.drafts[g.id].medals = { silver: 't0' }; // the director picked silver = the team the scores put in gold
  const d = gamesDock(g.id);
  assert.equal(d.save.ready, false);
  assert.equal(d.save.label, 'Each medal needs a different team');
  assert.equal(d.save.target, 'silver');
  assert.ok(/aria-disabled="true">Each medal needs a different team</.test(gamesDockHtml(d)));
  assert.equal(tallySave(g.id).ok, false);
  assert.notOk(state.results[g.id], 'nothing saved');
});

test('tallySave writes the old Save Result record, refuses a second save and a viewer', () => {
  const g = tallyG({ t0: '9', t1: '8', t2: '7' });
  const realCelebrate = celebrate; const got = []; celebrate = (id) => got.push(id);
  try {
    setMemberRole('viewer');
    assert.equal(tallySave(g.id).ok, false, 'a counselor saves nothing');
    setMemberRole('editor');
    const r = tallySave(g.id);
    assert.ok(r.ok);
    assert.deepEqual(state.results[g.id].medals, { gold: 't0', silver: 't1', bronze: 't2' });
    assert.deepEqual(state.results[g.id].scores, { t0: 9, t1: 8, t2: 7 });
    assert.notOk(state.drafts[g.id], 'the draft is gone');
    assert.deepEqual(got, ['t0']);
    state.results[g.id].savedAt = 'first';
    state.drafts[g.id] = { scores: { t0: '1', t1: '2', t2: '3' }, medals: {} }; // a stale form that still holds a complete draft
    const again = tallySave(g.id);
    assert.equal(again.ok, false, 'a stale form never overwrites');
    assert.equal(again.problem, 'unavailable', 'refused for the saved result, not for an incomplete draft');
    assert.equal(state.results[g.id].savedAt, 'first');
    assert.deepEqual(state.results[g.id].medals, { gold: 't0', silver: 't1', bronze: 't2' });
    assert.equal(gamesDock(g.id).tone === 'tally', false, 'after the save the dock is the Next game dock');
  } finally { celebrate = realCelebrate; }
});

test('a counselor gets no dock for a tally or a bracket Results step', () => {
  const g = tallyG({ t0: '9', t1: '8', t2: '7' });
  setMemberRole('viewer');
  assert.equal(gamesDock(g.id), null);
});

test('the six-team dock appears at Results only and its Save writes the bracket result', () => {
  freshState();
  setMemberRole('editor');
  const g = state.config.games.find((x) => x.id === 'jeb-ball');
  delete state.results[g.id];
  assert.equal(gamesDock(g.id), null, 'no bracket, no dock');
  state.brackets[g.id] = freshBracket();
  assert.equal(gamesDock(g.id), null, 'before Results neither bracket has a dock');
  state.brackets[g.id] = {
    phase: 'summary', pool: [], selectedPair: [],
    matches: [{ winner: 't0', loser: 't3' }, { winner: 't1', loser: 't4' }, { winner: 't2', loser: 't5' }], byeTeamId: 't0',
    semifinal: { a: 't1', b: 't2', winner: 't1', loser: 't2' }, championship: { a: 't0', b: 't1', winner: 't0', loser: 't1' },
  };
  const d = gamesDock(g.id);
  assert.equal(d.tone, 'six');
  assert.ok(/id="save-bracket-btn" data-kind="six"/.test(gamesDockHtml(d)));
  const realCelebrate = celebrate; celebrate = () => {};
  try {
    assert.ok(sixSaveResult(g).ok);
    assert.deepEqual(state.results[g.id].medals, { gold: 't0', silver: 't1', bronze: 't2' });
    assert.notOk(state.brackets[g.id], 'the bracket is retired');
    const realToast = showToast; showToast = () => {};
    try { assert.equal(sixSaveResult(g).ok, false, 'a second tap saves nothing'); } finally { showToast = realToast; }
  } finally { celebrate = realCelebrate; }
});

test('the dock taps: the dashed well never saves, the gold one does, data-kind routes the bracket Saves', () => {
  const src = readFixture('../games-ui.js');
  assert.ok(/dataset\.kind === 'six'\) gamesSixSaveTap\(b\); else gamesFourSaveTap\(b\)/.test(src));
  assert.ok(/else if \(tally\) gamesTallySaveTap\(b\)/.test(src));
  assert.ok(/aria-disabled'\) === 'true'/.test(src) && /gamesTallyGoto\(d\.save\.target\)/.test(src));
});
