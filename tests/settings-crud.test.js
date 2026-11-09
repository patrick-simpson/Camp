// What is left of settings.js after Step 30 removed the classic builder: the per-game record maps every screen clears or prunes
// through (GAME_RECORD_MAPS, clearGameRecords, gameRecordLabels, takenGameIds, pruneOrphanedGameData), the id maker, and that nothing
// here can mint or remove a team. (The editors' own paths are pinned where they live now: games-screen.test.js, teams-screen.test.js.)
//
// Tests assert on state and return values, never on markup (see CLAUDE.md).

function crudSetup() {
  window.scrollTo = () => {};
  freshState();
  setMemberRole('editor');
  return state.config.games;
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

test('clearGameRecords, gameRecordLabels and takenGameIds cover every per-game map, brackets4 included', () => {
  crudSetup();
  const gid = state.config.games[0].id;
  seedRecords(gid);
  state.brackets4 = state.brackets4 || {};
  state.brackets4[gid] = { at: 1, m: {} };
  assert.ok(GAME_RECORD_MAPS.some((m) => m.key === 'brackets4'));
  assert.ok(gameRecordLabels(gid).includes('the saved result') && gameRecordLabels(gid).includes('the game clock'));
  assert.equal(gameRecordLabels(gid).filter((l) => l === 'the bracket in progress').length, 1, 'said once for both bracket kinds');
  state.results['leftover-id'] = { medals: {} };
  assert.ok(takenGameIds().has('leftover-id') && takenGameIds().has(gid), 'a new id can never land on a leftover record');
  const id = makeId('Rain Bowling!', takenGameIds());
  assert.ok(/^rain-bowling-[a-z0-9]{4}$/.test(id), id);
  clearGameRecords(gid);
  assert.deepEqual(recordsFor(gid), []);
  assert.equal(state.brackets4[gid], undefined);
});

test('nothing in the builder can mint or remove a team any more', () => {
  const src = readFixture('../settings.js');
  assert.ok(typeof deleteTeam === 'undefined' && typeof removeTeamEverywhere === 'undefined' && typeof teamRefs === 'undefined');
  assert.notOk(/'t-'\s*\+\s*Date\.now/.test(src), 'no t-<timestamp> team ids (isTeamId and the rules refuse them)');
  assert.notOk(/state\.teams\.(push|splice)\(/.test(src), 'the builder never changes how many teams there are');
});

