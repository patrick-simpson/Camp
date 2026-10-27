// A phone that ALREADY has a week cached boots through normalizeSyncedState and
// migrateState while app.js is still evaluating, i.e. before any top-level
// `const` declared further down the file exists. A helper that leans on such a
// const throws a TDZ error at load and the whole app is blank - and no other
// test sees it, because they all load with an empty cache and only later seed
// state. (The unknown-bracket guard's first version did exactly this.) These
// load the real scripts into a FRESH context with a populated cache.

const vm = nodeRequire('vm');
const { makeContext } = nodeRequire('./harness.js');

function cachedWeek(mutate) {
  freshState();
  const g = state.config.games.find((x) => x.format === 'tournament');
  state.brackets[g.id] = freshBracket();
  state.brackets[g.id].phase = 'semifinal';
  state.brackets.foreign = { kind: 'four', rounds: [{ a: 't0', b: 't1' }] };
  state.drafts[state.config.games[0].id] = { scores: { t0: 3 }, medals: {} };
  state.clocks[g.id] = { running: false, remaining: 100, duration: 300, round: 1 };
  state.picSetup.p = { source: 'own', words: ['a'] };
  state.live.l = { key: 't0|t1', inning: 2, hr: { t0: 1 } };
  state.identity = 'Lilly';
  if (mutate) mutate(state);
  return JSON.stringify(state);
}

function bootWith(json) {
  const { ctx } = makeContext({ storage: { [STORAGE_KEY]: json } });
  const get = (expr) => vm.runInContext(expr, ctx);
  return { ctx, get };
}

test('a phone with a bracket, a foreign bracket, drafts and clocks cached boots without throwing', () => {
  const json = cachedWeek();
  let boot;
  assert.doesNotThrow(() => { boot = bootWith(json); }, 'loading the scripts over a populated cache must not throw');
  assert.equal(boot.get('Object.keys(state.brackets).length'), 2, 'both brackets survived the load');
  assert.equal(boot.get('JSON.stringify(state.brackets.foreign)'), JSON.stringify({ kind: 'four', rounds: [{ a: 't0', b: 't1' }] }),
    'the foreign bracket was not healed on the way in');
  assert.equal(boot.get('state.brackets[Object.keys(state.brackets).find((k) => k !== "foreign")].phase'), 'semifinal');
});

test('a cached state with every synced map missing still loads (RTDB-pruned shapes)', () => {
  const json = cachedWeek((s) => { ['brackets', 'drafts', 'clocks', 'live', 'picSetup', 'bonuses', 'announcements'].forEach((k) => { delete s[k]; }); });
  assert.doesNotThrow(() => bootWith(json));
});
