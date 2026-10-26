// A week-config change that arrives from another device (applyRemoteConfig)
// must not be logged to the changelog by THIS device. Points depend on config
// (a game's double-points flag, a deleted game's result), so such a change moves
// totals — and renderStandings used to read that as a local edit and push
// "Points updated" entries under every online editor's own name.

function setUpEditorWithLog() {
  setMemberRole('editor');
  authUser = { email: 'bob@example.com' };
  memberName = 'Bob';
  appStarted = true;
  const pushed = [];
  globalThis.firebase = { database: () => ({ ref: () => ({ push: (v) => { pushed.push(v); return Promise.resolve(); } }) }) };
  fbRef = {};
  return pushed;
}

function tearDown() {
  fbRef = null;
  delete globalThis.firebase;
  authUser = null;
  memberName = null;
  clPrevSnap = null;
  lastPointsByTeam = null;
  remoteJustApplied = false;
}

// A scored game that is NOT already double points, so flipping the flag moves totals.
function seedScoredGame() {
  freshState();
  const g = state.config.games.find((x) => !x.messtival);
  g.messtival = false;
  state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: '2026-07-20T12:00:00Z' };
  return g;
}

test('a remote config change that moves points is NOT logged by this device', () => {
  const pushed = setUpEditorWithLog();
  const g = seedScoredGame();
  renderStandings(); // baseline render (the first render is never logged)
  assert.equal(pushed.length, 0);

  // Editor A turns on double points for that game; the config arrives here.
  const remote = JSON.parse(JSON.stringify(state.config));
  remote.games.find((x) => x.id === g.id).messtival = true;
  const before = medalCounts().t0.points;
  applyRemoteConfig(remote);

  assert.ok(medalCounts().t0.points > before, 'precondition: the change really moved the points');
  assert.equal(pushed.length, 0, 'no changelog entries written under this editor\'s name: ' + JSON.stringify(pushed));

  // ...and the baseline advanced, so the NEXT local edit diffs against the new totals.
  state.results[g.id].medals = { gold: 't1', silver: 't0', bronze: 't2' };
  renderStandings();
  assert.ok(pushed.length > 0, 'a genuine local change is still logged');
  pushed.forEach((e) => assert.equal(e.byKey, 'bob@example,com'));
  tearDown();
});

test('a LOCAL config edit still logs (the originating device is the one that records it)', () => {
  const pushed = setUpEditorWithLog();
  const g = seedScoredGame();
  renderStandings();

  g.messtival = true; // what the week builder does to this device's own config
  renderStandings();
  assert.ok(pushed.length >= 1, 'the editor who made the change logs it');
  tearDown();
});

test('an unchanged remote config re-render sets nothing', () => {
  const pushed = setUpEditorWithLog();
  seedScoredGame();
  renderStandings();
  applyRemoteConfig(JSON.parse(JSON.stringify(state.config)));
  assert.equal(pushed.length, 0);
  assert.notOk(remoteJustApplied, 'no render happened, so no stale remote flag is left armed');
  tearDown();
});
