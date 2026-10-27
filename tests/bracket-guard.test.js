// A bracket this build can't read (setup-rebuild-spec S0f). A newer build may
// store a bracket of another shape; the one thing an older phone must never do
// is "heal" it into a six-team round 1 and push that back over everyone's copy.
// The card says "needs the newest version", and nothing is written or thrown.

function foreignBracket() {
  return { kind: 'four', rounds: [{ a: 't0', b: 't1' }, { a: 't2', b: 't3' }], phase: 'semis' };
}

function tournamentGame() {
  return state.config.games.find((g) => g.format === 'tournament');
}

function setupGuard() {
  freshState();
  const g = tournamentGame();
  state.brackets[g.id] = foreignBracket();
  return g;
}

function mountEl() {
  const el = document.createElement('div');
  const btn = { listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } };
  el.querySelector = (sel) => (sel === '#bracket-reload-btn' ? btn : null);
  el.__btn = btn;
  return el;
}

test('bracketKnown: the six-team shapes are known, everything foreign is not', () => {
  assert.ok(bracketKnown(freshBracket()));
  assert.ok(bracketKnown({ phase: 'summary', matches: [{ a: 't0', b: 't1', winner: 't0' }] }));
  assert.ok(bracketKnown({ phase: 'round1', pool: ['t0'] }), 'RTDB-pruned of its empty arrays');
  assert.ok(bracketKnown({ pool: ['t0', 't1'] }), 'a missing phase is healed, as before');
  assert.ok(bracketKnown({}), 'an empty object is a bracket RTDB pruned bare (healed as before)');
  assert.notOk(bracketKnown({ kind: 'four' }), 'any kind');
  assert.notOk(bracketKnown({ kind: '' }), 'even an empty one');
  assert.notOk(bracketKnown({ phase: 'semis' }), 'a phase this build cannot place');
  assert.notOk(bracketKnown({ rounds: [1, 2] }), 'keys with none of the six-team fields');
  assert.notOk(bracketKnown(null));
  assert.notOk(bracketKnown([]));
  assert.notOk(bracketKnown('round1'));
});

test('normalizeBracket and normalizeSyncedState leave a foreign bracket byte-identical', () => {
  const g = setupGuard();
  const before = JSON.stringify(state.brackets[g.id]);
  normalizeBracket(state.brackets[g.id]);
  normalizeSyncedState();
  assert.equal(JSON.stringify(state.brackets[g.id]), before, 'no pool/matches/phase stamped on it');
});

test('the tree a push would write still carries the foreign bracket exactly as it was', () => {
  const g = setupGuard();
  normalizeSyncedState();
  assert.equal(JSON.stringify(syncedSnapshot().brackets[g.id]), JSON.stringify(foreignBracket()),
    'a heal would have pushed pool/matches/selectedPair over the other version\'s bracket');
});

test('renderTournament shows the reload card for it: no throw, no write, no controls', () => {
  const g = setupGuard();
  setMemberRole('editor');
  const before = JSON.stringify(state.brackets);
  const realSave = saveState;
  let saves = 0;
  saveState = () => { saves += 1; };
  try {
    const el = mountEl();
    assert.doesNotThrow(() => renderTournament(el, g));
    assert.ok(/needs the newest version/.test(el.innerHTML), el.innerHTML);
    assert.notOk(/start-bracket-btn|cancel-bracket-btn|winner/i.test(el.innerHTML), 'nothing that could write');
    assert.equal(JSON.stringify(state.brackets), before, 'bracket untouched');
    assert.equal(saves, 0, 'nothing saved');
    // An idle re-render leaves the card be.
    const written = el.innerHTML;
    el.innerHTML = 'SENTINEL';
    renderTournament(el, g);
    assert.equal(el.innerHTML, 'SENTINEL', 'unchanged card is not rewritten');
    assert.ok(written.length > 0);
  } finally { saveState = realSave; }
});

test('a viewer sees the same card instead of a live view', () => {
  const g = setupGuard();
  setMemberRole('viewer');
  const el = mountEl();
  assert.doesNotThrow(() => renderLiveWatch(el, g));
  assert.ok(/needs the newest version/.test(el.innerHTML));
  assert.equal(JSON.stringify(state.brackets[g.id]), JSON.stringify(foreignBracket()));
});

test('it never shows as a live game on the home screen or in the upcoming matchups', () => {
  const g = setupGuard();
  assert.notOk(liveHomeGames().some((x) => x.id === g.id));
  assert.deepEqual(upcomingMatchups(g), []);
  assert.doesNotThrow(() => renderAll());
});

test('a foreign bracket that looks like a live round 1 is still not a live matchup', () => {
  const g = setupGuard();
  // phase + selectedPair would read as "Team A vs Team B on the court" if the
  // guard in upcomingMatchups were missing (normalizeBracket leaves it as found).
  state.brackets[g.id] = { kind: 'four', phase: 'round1', selectedPair: ['t0', 't1'] };
  assert.deepEqual(upcomingMatchups(g), []);
});

test('an editor can clear an unreadable bracket (confirmed); a viewer gets no such control', () => {
  const g = setupGuard();
  setMemberRole('viewer');
  const viewerEl = mountEl();
  renderLiveWatch(viewerEl, g);
  assert.notOk(/bracket-clear-btn/.test(viewerEl.innerHTML), 'viewers cannot clear it');

  setMemberRole('editor');
  const el = mountEl();
  const clearBtn = { listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } };
  const reloadBtn = el.__btn;
  el.querySelector = (sel) => (sel === '#bracket-reload-btn' ? reloadBtn : sel === '#bracket-clear-btn' ? clearBtn : null);
  renderTournament(el, g);
  assert.ok(/bracket-clear-btn/.test(el.innerHTML), 'editors get the control');
  const realConfirm = confirm;
  const realSave = saveState;
  let saves = 0;
  saveState = () => { saves += 1; };
  try {
    confirm = () => false;
    clearBtn.listeners.click();
    assert.ok(state.brackets[g.id], 'declining the confirm keeps it');
    confirm = () => true;
    clearBtn.listeners.click();
    assert.equal(state.brackets[g.id], undefined, 'confirmed: the bracket is gone');
    assert.equal(saves, 1, 'and the delete is saved (so it syncs)');
  } finally { confirm = realConfirm; saveState = realSave; }
});

test('Reload now reloads (guarded like the update bar), and is not a state write', () => {
  const g = setupGuard();
  setMemberRole('editor');
  const el = mountEl();
  renderTournament(el, g);
  const before = __reloads;
  const beforeState = JSON.stringify(state.brackets);
  el.__btn.listeners.click();
  assert.equal(__reloads, before + 1, 'the page was reloaded');
  assert.equal(JSON.stringify(state.brackets), beforeState);
});

test('a real six-team bracket still renders its steps', () => {
  freshState();
  setMemberRole('editor');
  const g = tournamentGame();
  state.brackets[g.id] = freshBracket();
  const el = mountEl();
  el.querySelector = () => null;
  renderTournament(el, g);
  assert.ok(el.innerHTML.includes('bracket-steps'), 'the wizard is untouched');
  assert.notOk(/needs the newest version/.test(el.innerHTML));
});
