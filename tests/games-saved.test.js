// The game takeover's podium writes and its "Saved" line against the in-memory database in tests/fake-rtdb.js, through the app's real
// fbRef (Step 18, build session 2). games-tab.test.js pins the model with hand-set sync variables; these cases run the REAL push:
//   - a pick and a clear are ONE leaf each on the server (`drafts/<game>/medals/<medal>`), and a pick another phone wrote to a different
//     medal at the same time is still there afterwards;
//   - "Saved … everyone's phone has it" is true only once the server has acknowledged the write: Saving… until the ack, saved after it,
//     offline while the connection is down (and saved when it returns), refused when the rules turn the path away;
//   - a second director's save is not overwritten by a stale picker.
// Runs under both camp profiles (games-saved.senior.test.js evals this file).

const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');
const GS_PATH = dbPath('state');
const gsServer = (db) => db.serverTree()[CAMP.dbRoot].state;
const gsT = () => state.teams.map((t) => t.id);
// the server hands keys back sorted: compare what they say, not the order
const gsSame = (a, b, msg) => assert.equal(JSON.stringify(syncCanon(a)), JSON.stringify(syncCanon(b)), msg || 'the same');
const gsLine = () => document.getElementById('game-saved');
var gsCelebrated = [];
var gsRealCelebrate = celebrate;

async function gsBoot() {
  freshState();
  setMemberRole('editor');
  setMemberTeam(null);
  state.followTeam = undefined;
  const db = makeFakeRtdb();
  const ref = db.ref(GS_PATH);
  await ref.set(syncedSnapshot());
  const snap = await ref.once('value');
  fbRef = ref;
  remoteReady = true;
  pendingWrites = 0;
  dataEditPending = false;
  clearTimeout(pushTimer); pushTimer = null;
  clearTimeout(pushConfigTimer); pushConfigTimer = null;
  applyingRemote = false;
  stateQuarantine = {};
  stateBisecting = false; stateBisectQueue = []; stateBisectHeld = false;
  delete state._quarantine;
  fbConnKnown = true; fbConnected = true;
  applyRemoteState(snap.val());
  clearTimeout(pushTimer); pushTimer = null;
  pushState();
  await waitUntil(() => pendingWrites === 0 && !stateBisecting, 'the first push to be acknowledged');
  await waitQuiet();
  db.log.length = 0;
  gsCelebrated = [];
  celebrate = (id) => { gsCelebrated.push(id); }; // a canvas the stub DOM cannot draw
  return db;
}
function gsTeardown() {
  celebrate = gsRealCelebrate;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  fbRef = null; remoteReady = false; pendingWrites = 0; dataEditPending = false;
  stateQuarantine = {}; stateBisecting = false; stateBisectQueue = []; stateBisectHeld = false;
  delete state._quarantine;
  state.ui.gameId = null;
  setMemberRole(null);
}
function gsPodium(db) {
  const g = { id: 'gs-' + Math.random().toString(36).slice(2, 7), dayId: state.config.days[0].id, session: 'Morning', format: 'placement', name: 'Podium', emoji: '', location: '', headline: '', rules: [] };
  state.config.games.push(g);
  return g;
}

test('a pick and a clear are one leaf each on the server, and a pick another phone made to a different medal survives', async () => {
  const db = await gsBoot();
  try {
    const g = gsPodium();
    const t = gsT();
    podiumPick(g.id, 'gold', t[0]);
    await waitQuiet();
    assert.deepEqual(gsServer(db).drafts[g.id].medals, { gold: t[0] }, 'one leaf');
    // another director's phone writes silver straight into the database while this one clears gold
    await db.ref(GS_PATH + '/drafts/' + g.id + '/medals/silver').set(t[1]);
    podiumPick(g.id, 'gold', t[0]); // the same key again: a clear
    await waitQuiet();
    assert.deepEqual(gsServer(db).drafts[g.id].medals, { silver: t[1] }, 'gold is gone, the other phone\'s silver is not touched');
    // and this phone picks bronze for a third team: both phones' leaves are in the draft
    podiumPick(g.id, 'gold', t[2]);
    await waitQuiet();
    gsSame(gsServer(db).drafts[g.id].medals, { gold: t[2], silver: t[1] });
    const writes = db.log.filter((l) => l.paths.some((p) => p.includes('drafts/'))).map((l) => l.paths.filter((p) => p.includes('drafts/')).join(','));
    assert.ok(writes.every((w) => /\/medals\/(gold|silver|bronze)$/.test(w) && !w.includes(',')), 'never the whole draft: ' + writes.join(' | '));
  } finally { gsTeardown(); }
});

test('"Saved" is said only once the server has it: Saving… until the acknowledgement, then saved', async () => {
  const db = await gsBoot();
  try {
    const g = gsPodium();
    const t = gsT();
    state.ui.gameId = g.id;
    podiumPick(g.id, 'gold', t[1]); podiumPick(g.id, 'silver', t[0]); podiumPick(g.id, 'bronze', t[2]);
    await waitQuiet();
    assert.equal(podiumSave(g.id).ok, true);
    assert.deepEqual(gsCelebrated, [t[1]]);
    assert.equal(gameResultState(g.id), 'saving', 'written on this phone, not yet acknowledged');
    assert.equal(gsServer(db).results && gsServer(db).results[g.id], undefined, 'and not on the server');
    renderSavedResult(document.getElementById('entry-area'), g, state.results[g.id]);
    assert.equal(gsLine().dataset.state, 'saving');
    assert.equal(gsLine().querySelector('span').textContent, 'Saving…');
    await waitQuiet(); // the debounce, the push and its acknowledgement
    gsSame(gsServer(db).results[g.id].medals, { gold: t[1], silver: t[0], bronze: t[2] }, 'the server has it');
    assert.equal(gameResultState(g.id), 'saved');
    assert.equal(gsLine().dataset.state, 'saved', 'the acknowledgement repainted the line');
    assert.ok(/^Saved .* · everyone’s phone has it$/.test(gsLine().querySelector('span').textContent), gsLine().querySelector('span').textContent);
    assert.equal(gsServer(db).drafts && gsServer(db).drafts[g.id], undefined, 'the draft went with it');
  } finally { gsTeardown(); }
});

test('offline it says so, and says "Saved" when the connection returns and the write goes through', async () => {
  const db = await gsBoot();
  try {
    const g = gsPodium();
    const t = gsT();
    state.ui.gameId = g.id;
    db.goOffline(); fbConnected = false;
    podiumPick(g.id, 'gold', t[0]); podiumPick(g.id, 'silver', t[1]); podiumPick(g.id, 'bronze', t[2]);
    podiumSave(g.id);
    renderSavedResult(document.getElementById('entry-area'), g, state.results[g.id]);
    assert.equal(gameResultState(g.id), 'offline');
    assert.equal(gsLine().dataset.state, 'offline');
    assert.ok(/Saved on this phone · it sends when you’re back online/.test(gsLine().querySelector('span').textContent));
    assert.equal(gsServer(db).results && gsServer(db).results[g.id], undefined);
    db.goOnline(); fbConnected = true; updateSyncIndicator();
    assert.equal(gsLine().dataset.state, 'saving', 'back online, the queued write is going up');
    await waitQuiet();
    assert.ok(gsServer(db).results[g.id], 'the queued result reached the server');
    assert.equal(gsLine().dataset.state, 'saved');
  } finally { gsTeardown(); }
});

test('a result the rules turn away says so (the bar at the top has Retry), and never says "Saved"', async () => {
  const db = await gsBoot();
  try {
    const g = gsPodium();
    const t = gsT();
    state.ui.gameId = g.id;
    db.refuse(GS_PATH + '/results/' + g.id);
    podiumPick(g.id, 'gold', t[0]); podiumPick(g.id, 'silver', t[1]); podiumPick(g.id, 'bronze', t[2]);
    podiumSave(g.id);
    renderSavedResult(document.getElementById('entry-area'), g, state.results[g.id]);
    await waitUntil(() => ('results/' + g.id) in stateQuarantine, 'the refused result to be parked');
    await waitQuiet();
    assert.equal(gameResultState(g.id), 'refused');
    assert.equal(gsLine().dataset.state, 'refused');
    assert.ok(/Not saved yet/.test(gsLine().querySelector('span').textContent) && /Retry/.test(gsLine().querySelector('span').textContent));
    assert.notOk(/everyone/.test(gsLine().querySelector('span').textContent));
  } finally { gsTeardown(); }
});

test('a second director saved first: a stale picker neither picks nor saves over their result', async () => {
  const db = await gsBoot();
  try {
    const g = gsPodium();
    const t = gsT();
    state.ui.gameId = g.id;
    podiumPick(g.id, 'gold', t[0]); podiumPick(g.id, 'silver', t[1]); podiumPick(g.id, 'bronze', t[2]);
    await waitQuiet();
    // the other director's phone saves a different podium and removes the draft
    const theirs = { medals: { gold: t[3], silver: t[2], bronze: t[1] }, savedAt: '2026-07-22T15:00:00.000Z' };
    await db.ref(GS_PATH + '/results/' + g.id).set(theirs);
    await db.ref(GS_PATH + '/drafts/' + g.id).set(null);
    applyRemoteState((await db.ref(GS_PATH).once('value')).val()); // the snapshot the listener would deliver
    await waitQuiet();
    gsSame(state.results[g.id].medals, theirs.medals, 'their result is the one on this phone now');
    assert.equal(podiumSave(g.id).problem, 'unavailable', 'a Save tap from the stale picker does nothing');
    assert.equal(podiumPick(g.id, 'gold', t[0]).problem, 'unavailable');
    await waitQuiet();
    gsSame(gsServer(db).results[g.id].medals, theirs.medals, 'and the server still has theirs');
  } finally { gsTeardown(); }
});
