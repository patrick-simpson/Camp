// S2a — a refused path is quarantined, never a wedge (setup-rebuild-spec §6.2 #1).
//
// pushState is ONE atomic multi-path update(): a single path the rules refuse
// refused the whole batch, and the old handler re-sent that same batch on every
// push for the rest of the session with only a console.warn. Now, on
// PERMISSION_DENIED (and only then), the batch is re-sent one path at a time:
// what the server takes advances the confirmed baseline like an ack, what is
// refused ALONE is parked in stateQuarantine (persisted as state._quarantine),
// named on the sync line, and offered Retry / Discard. Driven against the
// in-memory database in tests/fake-rtdb.js through the app's real fbRef.

const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');
const STATE_PATH = dbPath('state'); // the active camp's root, so the senior twin runs the same file
const serverState = (db) => db.serverTree()[CAMP.dbRoot].state;
const wait = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 5 : ms));
const res = (n) => ({ medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'v' + n });
const clone = (v) => JSON.parse(JSON.stringify(v));

let toasts = [];
showToast = (m) => { toasts.push(m); };
// console is the runner's real one: capture warnings only inside a test, and put it back.
async function withWarns(fn) {
  const real = console.warn;
  const out = [];
  console.warn = (...a) => { out.push(a.map(String).join(' ')); };
  try { await fn(out); } finally { console.warn = real; }
}

// A fake database with the current (fresh) week on the server, adopted as this
// device's confirmed baseline — i.e. an editor on a connected phone.
async function boot(opts) {
  freshState();
  setMemberRole('editor');
  toasts = [];
  const db = makeFakeRtdb(opts);
  const ref = db.ref(STATE_PATH);
  await ref.set(syncedSnapshot());
  const snap = await ref.once('value');
  fbRef = ref;
  remoteReady = true;
  pendingWrites = 0;
  dataEditPending = false;
  clearTimeout(pushTimer); pushTimer = null;
  clearTimeout(pushConfigTimer); pushConfigTimer = null;
  applyingRemote = false;
  document.activeElement = null;
  stateQuarantine = {};
  stateBisecting = false;
  stateBisectQueue = [];
  stateBisectHeld = false;
  delete state._quarantine;
  applyRemoteState(snap.val());
  // Adopting a first snapshot seeds the secrecy defaults (one debounced write):
  // send it now so each test starts with nothing owed.
  clearTimeout(pushTimer);
  pushTimer = null;
  pushState();
  await settled();
  db.log.length = 0;
  return db;
}

function teardown() {
  // A debounced push left pending would fire into the NEXT test's database (the app's timer outlives the case).
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  fbRef = null;
  remoteReady = false;
  pendingWrites = 0;
  dataEditPending = false;
  stateQuarantine = {};
  stateBisecting = false;
  stateBisectQueue = [];
  stateBisectHeld = false;
  delete state._quarantine;
  setMemberRole(null);
}

// Record every payload handed to update(), in order, and let a test react to one.
function spyOn(ref, hook) {
  const sent = [];
  const wrapped = Object.assign({}, ref, {
    update(u) {
      sent.push(clone(u));
      const forced = hook ? hook(u) : undefined;
      return forced !== undefined ? forced : ref.update(u);
    },
  });
  return { ref: wrapped, sent };
}

const paths = (u) => Object.keys(u).sort();
// touchData() stamps meta/lastDataChangeAt into every batch; it is never what a test is about.
const content = (u) => paths(u).filter((p) => p !== 'meta/lastDataChangeAt');
// Every state write acknowledged (and any refusal bisected) — waited for, not guessed at: a bounded poll of ~80 ms gave up
// early when the process stalled and the next assertion saw a write still in flight.
const settled = async () => { await waitUntil(() => pendingWrites === 0 && !stateBisecting, 'every state write to be acknowledged'); await wait(2); };
const persisted = () => JSON.parse(localStorage.getItem(STORAGE_KEY));

test('a refused path is parked, and the rest of its batch still reaches the server', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gA = res(1);
    state.results.gB = res(1);
    state.results.gC = res(1);
    touchData(); pushState();
    await settled();
    const server = serverState(db);
    assert.ok(server.results.gA && server.results.gC, 'the paths the rules accept advanced: ' + JSON.stringify(server.results));
    assert.equal(server.results.gB, undefined, 'the refused path never landed');
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB']);
    assert.deepEqual(stateQuarantine['results/gB'], res(1), 'the refused value is what is parked');
    assert.ok(confirmedTree.results.gA && confirmedTree.results.gC, 'accepted paths advanced the confirmed baseline, as an ack does');
    assert.equal(confirmedTree.results.gB, undefined, 'the parked path is NOT confirmed');
    assert.ok(lastSyncedTree.results.gB, 'but it is treated as sent, so it is not retried forever');
    assert.equal(pendingWrites, 0);
    assert.equal(stateBisecting, false);
    assert.ok(toasts.some((t) => t.includes('couldn’t be saved')), 'a newly parked change says so once: ' + toasts.join('|'));
  } finally { teardown(); }
});

test('scores keep syncing with a poisoned path present, and the parked path is not re-sent', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB']);
    const before = db.log.length;
    state.results.gD = res(2);
    touchData(); pushState();
    await settled();
    assert.ok(serverState(db).results.gD, 'a later score went straight through');
    const later = db.log.slice(before).map((l) => l.paths.join(','));
    assert.equal(later.length, 1, 'one clean write, no bisect: ' + later.join(' | '));
    assert.notOk(later.join(',').includes('gB'), 'the parked path stayed out of every later batch');
  } finally { teardown(); }
});

test('the quarantine is persisted in the same STORAGE_KEY write, and loads back', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    const stored = persisted();
    assert.deepEqual(stored._quarantine, { 'results/gB': res(1) }, 'the cache carries the refused value');
    assert.ok(stored.results.gB, 'next to the score it belongs to');
    assert.equal(stored._syncBase.results.gB, undefined, 'while the confirmed baseline does not have it');
    // "Reload": the module-level set is rebuilt from the cache.
    state = stored;
    stateQuarantine = readQuarantine();
    assert.deepEqual(stateQuarantine, { 'results/gB': res(1) });
    // A hand-edited / foreign entry never loads.
    state._quarantine = { 'results/gB': 1, 'nothing/x': 2, 'config/games': 3 };
    assert.deepEqual(Object.keys(readQuarantine()), ['results/gB']);
  } finally { teardown(); }
});

test('backups never carry the quarantine', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    assert.ok(state._quarantine, 'state holds it');
    assert.notOk(backupJSON().includes('_quarantine'), 'backupJSON lists its keys; this is not one of them');
  } finally { teardown(); }
});

test('sync-F15: a path that changed since the refused batch is skipped, and its newer value goes out next', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    const spy = spyOn(db.ref(STATE_PATH));
    fbRef = spy.ref;
    state.results.gA = res(1);
    state.results.gB = res(1);
    state.results.gC = res(1);
    touchData(); pushState(); // the whole batch is in flight, and will be refused
    state.results.gC = res(2); // a tap lands before the refusal comes back
    touchData();
    await settled();
    assert.ok(serverState(db).results.gA, 'the unchanged path was retried and saved');
    assert.notOk(spy.sent.slice(1).some((u) => 'results/gC' in u), 'the bisect did not retry gC at all: ' + JSON.stringify(spy.sent));
    pushState(); // what the tap's own debounce does a moment later
    await settled();
    const cWrites = spy.sent.filter((u) => 'results/gC' in u).map((u) => u['results/gC'].savedAt);
    assert.deepEqual(cWrites, ['v1', 'v2'], 'the refused batch carried v1; only v2 went after it');
    assert.equal(serverState(db).results.gC.savedAt, 'v2', 'the newer value is what the server ends up with');
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB']);
  } finally { teardown(); }
});

test('sync-F15: a push made mid-bisect is held, runs after it, and the newer value lands last', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    let tapped = false;
    let heldSendCount = -1;
    const spy = spyOn(db.ref(STATE_PATH), (u) => {
      // The retry of gA is the first single-path send; tap gC (not yet retried) right then.
      if (!tapped && paths(u).join() === 'results/gA') {
        tapped = true;
        state.results.gC = res(2);
        touchData();
        const n = spy.sent.length;
        pushState(); // what the 400 ms debounce does
        heldSendCount = spy.sent.length - n;
      }
    });
    fbRef = spy.ref;
    state.results.gA = res(1);
    state.results.gB = res(1);
    state.results.gC = res(1);
    touchData(); pushState();
    await settled();
    assert.ok(tapped, 'the scenario ran');
    assert.equal(heldSendCount, 0, 'pushState sent nothing while the bisect was running');
    assert.equal(stateBisectHeld, false, 'and the held push has since run');
    const order = spy.sent.filter((u) => 'results/gC' in u).map((u) => u['results/gC'].savedAt);
    assert.deepEqual(order.slice(-1), ['v2'], 'the newest value is the LAST one sent: ' + order.join(','));
    assert.notOk(order.slice(1).includes('v1'), 'the old value was never re-sent after the tap');
    assert.equal(serverState(db).results.gC.savedAt, 'v2');
  } finally { teardown(); }
});

test('while a bisect runs it counts as an unconfirmed write: no adopt, no auto-reload', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    const seen = [];
    const spy = spyOn(db.ref(STATE_PATH), (u) => {
      if (paths(u).length === 1) seen.push({ reload: reloadBlocked(), adopt: canAdoptRemote(), unsynced: hasUnsyncedWork() });
    });
    fbRef = spy.ref;
    state.results.gA = res(1);
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    assert.ok(seen.length >= 2, 'the single-path retries ran');
    seen.forEach((s) => {
      assert.equal(s.reload, true, 'a deploy reload waits for the bisect');
      assert.equal(s.adopt, false, 'a stale reconnect snapshot is not adopted over it');
      assert.equal(s.unsynced, true, 'camp switch / sign-out are warned');
    });
    assert.equal(reloadBlocked(), false, 'and it all lets go once the bisect has ended');
    assert.equal(canAdoptRemote(), true);
  } finally { teardown(); }
});

test('any other failure keeps the original handling: baseline restored, nothing parked, same batch re-sent', async () => {
  const db = await boot();
  await withWarns(async (warns) => {
  try {
    let fail = true;
    const spy = spyOn(db.ref(STATE_PATH), () => (fail ? Promise.reject(Object.assign(new Error('network'), { code: 'unavailable' })) : undefined));
    fbRef = spy.ref;
    const prev = clone(lastSyncedTree);
    state.results.gA = res(1);
    touchData(); pushState();
    await settled();
    assert.deepEqual(lastSyncedTree, prev, 'the baseline went back, so the same change is re-diffed');
    assert.equal(pendingWrites, 0);
    assert.equal(stateBisecting, false, 'no bisect for a network error');
    assert.deepEqual(stateQuarantine, {});
    assert.equal(spy.sent.length, 1, 'no per-path retries');
    assert.ok(warns.some((w) => w.includes('sync push failed')), 'still the original console.warn');
    // Same for an error with no code at all, and a synchronous throw.
    fail = false;
    pushState();
    await settled();
    assert.equal(spy.sent.length, 2);
    assert.deepEqual(content(spy.sent[1]), ['results/gA'], 'the next push re-sent exactly the failed change');
    assert.ok(serverState(db).results.gA);
    fbRef = Object.assign({}, db.ref(STATE_PATH), { update() { throw new Error('illegal key'); } });
    lastSyncedTree = clone(prev);
    state.results.gE = res(1);
    pushState();
    assert.equal(pendingWrites, 0, 'a synchronous throw still settles');
    assert.deepEqual(lastSyncedTree.results, prev.results);
    assert.deepEqual(stateQuarantine, {});
  } finally { teardown(); }
  });
});

test('a connection that drops mid-bisect hands the unreached paths back to the diff', async () => {
  const db = await boot();
  await withWarns(async () => {
  try {
    db.refuse(STATE_PATH + '/results/gB');
    const spy = spyOn(db.ref(STATE_PATH), (u) => (paths(u).join() === 'results/gB'
      ? Promise.reject(Object.assign(new Error('gone'), { code: 'unavailable' })) : undefined));
    fbRef = spy.ref;
    state.results.gA = res(1);
    state.results.gB = res(1);
    state.results.gC = res(1);
    touchData(); pushState();
    await settled();
    assert.ok(serverState(db).results.gA, 'gA went before the drop');
    assert.deepEqual(stateQuarantine, {}, 'gB was not refused alone, so it is not parked');
    assert.equal(pendingWrites, 0);
    assert.equal(stateBisecting, false);
    const owed = content(computeSyncUpdates(lastSyncedTree, syncedSnapshot()));
    assert.deepEqual(owed, ['results/gB', 'results/gC'], 'the next push re-sends exactly what never got through');
  } finally { teardown(); }
  });
});

test('two refused batches in flight are bisected one after the other, and both settle', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    db.refuse(STATE_PATH + '/bonuses/bX');
    state.results.gA = res(1);
    state.results.gB = res(1);
    touchData(); pushState();
    state.bonuses.bX = { teamId: 't0', category: 'x', label: 'x', points: 1, at: 'x' };
    state.bonuses.bY = { teamId: 't1', category: 'x', label: 'y', points: 1, at: 'x' };
    touchData(); pushState(); // the second batch goes out before the first refusal returns
    assert.equal(pendingWrites, 2);
    await settled();
    assert.deepEqual(Object.keys(stateQuarantine).sort(), ['bonuses/bX', 'results/gB']);
    const server = serverState(db);
    assert.ok(server.results.gA && server.bonuses.bY, 'the accepted path of each batch landed');
    assert.equal(pendingWrites, 0);
    assert.equal(stateBisecting, false);
    assert.deepEqual(stateBisectQueue, []);
  } finally { teardown(); }
});

test('more than 50 refused paths are halved, not retried one by one', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/g77');
    for (let i = 0; i < 120; i++) state.results['g' + i] = res(i);
    touchData(); pushState();
    await settled();
    const server = serverState(db).results;
    assert.equal(Object.keys(server).length, 119, 'everything but the poisoned path got through');
    assert.deepEqual(Object.keys(stateQuarantine), ['results/g77']);
    assert.ok(db.log.length < 60, 'bisected, not 120 single writes: ' + db.log.length + ' writes');
    assert.equal(pendingWrites, 0);
  } finally { teardown(); }
});

test('a batch that is refused as a whole (every path) parks them all and still settles', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results');
    state.results.gA = res(1);
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    assert.deepEqual(Object.keys(stateQuarantine).sort(), ['results/gA', 'results/gB']);
    assert.equal(pendingWrites, 0);
    assert.equal(stateBisecting, false);
    fbConnKnown = true; fbConnected = true; syncDenied = false; sdkLoadFailed = false;
    updateSyncIndicator();
    assert.ok(document.getElementById('gs-sync').innerHTML.includes('2 changes couldn’t be saved'));
  } finally { fbConnKnown = false; fbConnected = false; teardown(); }
});

test('Retry re-queues the parked paths, and clears the line once the rules accept them', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB']);
    // Still refused: Retry parks it again (and says so), with no wedge.
    toasts = [];
    retryQuarantined();
    await settled();
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB'], 'refused again, parked again');
    assert.ok(toasts.some((t) => t.includes('couldn’t be saved')), 'and the person is told it failed again');
    // The rules are fixed (published). Retry now goes through.
    db.allow(STATE_PATH + '/results/gB');
    retryQuarantined();
    await settled();
    assert.deepEqual(stateQuarantine, {}, 'the line clears itself');
    assert.ok(serverState(db).results.gB, 'and the score is on the server');
    assert.ok(confirmedTree.results.gB, 'confirmed');
    assert.equal(persisted()._quarantine, undefined, 'and gone from the cache');
  } finally { teardown(); }
});

test('Retry sends the CURRENT value, which may have moved on since the refusal', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    state.results.gB = res(2); // corrected before retrying (this push is held back from the server by the same refusal)
    db.allow(STATE_PATH + '/results/gB');
    retryQuarantined();
    await settled();
    assert.equal(serverState(db).results.gB.savedAt, 'v2');
    assert.deepEqual(stateQuarantine, {});
  } finally { teardown(); }
});

test('Retry before the first snapshot does nothing but say so', async () => {
  await boot();
  try {
    stateQuarantine = { 'results/gB': res(1) };
    remoteReady = false;
    toasts = [];
    retryQuarantined();
    assert.ok(toasts.some((t) => t.includes('Not connected')));
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB'], 'nothing was cleared');
  } finally { teardown(); }
});

test('Discard puts the confirmed value back in state AND baseline, and sends nothing', async () => {
  const db = await boot();
  try {
    // A confirmed result gA, then an edit of it that the rules refuse, plus a brand-new refused one.
    state.results.gA = res(1);
    touchData(); pushState();
    await settled();
    assert.equal(confirmedTree.results.gA.savedAt, 'v1');
    db.refuse(STATE_PATH + '/results/gA');
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gA = res(2);
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    assert.deepEqual(Object.keys(stateQuarantine).sort(), ['results/gA', 'results/gB']);
    const writes = db.log.length;
    discardQuarantined();
    assert.equal(state.results.gA.savedAt, 'v1', 'the edit is undone, back to what the server holds');
    assert.equal(state.results.gB, undefined, 'the brand-new one is gone');
    assert.deepEqual(stateQuarantine, {});
    assert.equal(persisted()._quarantine, undefined);
    assert.deepEqual(computeSyncUpdates(lastSyncedTree, syncedSnapshot()), {}, 'baseline and state agree: nothing to re-send');
    pushState();
    await settled();
    assert.equal(db.log.length, writes, 'no write at all: a discard is local');
  } finally { teardown(); }
});

test('declining the Discard confirm keeps everything', async () => {
  const db = await boot();
  const realConfirm = confirm;
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    confirm = () => false;
    discardQuarantined();
    assert.ok(state.results.gB, 'the score is still there');
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB']);
  } finally { confirm = realConfirm; teardown(); }
});

test('Discard prunes the parents a deleted leaf leaves empty', () => {
  freshState();
  state.live.g1 = { key: 't0|t1', inning: 1, hr: { t0: 2 } };
  state.live.g2 = { key: 't0|t1', inning: 1, hr: { t0: 2 } };
  setStatePath('live/g1/hr/t0', null);
  assert.deepEqual(state.live.g1, { key: 't0|t1', inning: 1 }, 'hr went with its last child');
  setStatePath('live/g1/key', null); setStatePath('live/g1/inning', null);
  assert.equal(state.live.g1, undefined, 'and the emptied game node went too');
  assert.ok(state.live.g2, 'a sibling is untouched');
  setStatePath('results/never/there/x', null); // a delete of nothing builds nothing
  assert.equal(state.results.never, undefined);
  setStatePath('bonuses/b1', { teamId: 't0', points: 2 });
  assert.equal(state.bonuses.b1.points, 2, 'a value is written (and copied)');
  setStatePath('teams', null);
  assert.ok(state.teams.length, 'a roster is never emptied');
});

test('adopting a snapshot keeps parked edits on top and does not forget them', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    // Somebody else saves a different result; the live listener hands it to this idle phone.
    const server = clone(serverState(db));
    server.results = Object.assign({}, server.results, { gD: res(9) });
    handleRemoteSnapshot(server);
    assert.ok(state.results.gD, 'their result arrived');
    assert.ok(state.results.gB, 'the refused score was not wiped by the adopt');
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB'], 'and is still named');
    assert.equal(confirmedTree.results.gB, undefined, 'it is still unconfirmed');
    assert.ok(confirmedTree.results.gD, 'while their result is confirmed');
    assert.ok(lastSyncedTree.results.gB, 'and still treated as sent, so the next push does not repeat it');
    assert.deepEqual(computeSyncUpdates(lastSyncedTree, syncedSnapshot()), {});
    assert.ok(hasUnconfirmedLocalWork(), 'sign-out still warns about it');
  } finally { teardown(); }
});

test('a snapshot in which the server already agrees clears the parked path', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    const server = clone(serverState(db));
    server.results = Object.assign({}, server.results, { gB: res(1) }); // another device saved the same result
    handleRemoteSnapshot(server);
    assert.deepEqual(stateQuarantine, {});
    assert.equal(persisted()._quarantine, undefined);
  } finally { teardown(); }
});

test('the sync line names what was refused, escaped, with Retry and Discard — and never a value', async () => {
  const db = await boot();
  try {
    const g = state.config.games[0];
    const realName = g.name;
    g.name = 'Kick<b>ball';
    db.refuse(STATE_PATH + '/results/' + g.id);
    state.results[g.id] = { medals: { gold: 't3', silver: 't0', bronze: 't1' }, savedAt: 'v1', scores: { t3: 987654 } };
    touchData(); pushState();
    await settled();
    fbConnKnown = true; fbConnected = true; syncDenied = false; sdkLoadFailed = false;
    updateSyncIndicator();
    const html = document.getElementById('gs-sync').innerHTML;
    const foot = document.getElementById('sync-status-footer').innerHTML;
    assert.equal(html, foot, 'both copies of the line say it');
    assert.ok(html.includes('1 change couldn’t be saved'), html);
    assert.ok(html.includes('Kick&lt;b&gt;ball → result'), 'game and part, escaped: ' + html);
    assert.notOk(html.includes('<b>'), 'a game name is never markup');
    assert.ok(html.includes('data-sync-quarantine="retry"') && html.includes('data-sync-quarantine="discard"'));
    assert.notOk(html.includes('987654') || html.includes('gold'), 'no points or places on the line');
    assert.notOk(html.includes('Synced'), 'never "Synced" while a score is unsaved');
    g.name = realName;
    // Cleared: the ordinary line is back.
    stateQuarantine = {};
    updateSyncIndicator();
    assert.equal(document.getElementById('gs-sync').textContent, 'Synced');
  } finally { fbConnKnown = false; fbConnected = false; teardown(); }
});

test('the card line says Offline first, the top bar still carries the parked edit, and a blocked or failed connection outranks both lines', async () => {
  await boot();
  try {
    const line = () => document.getElementById('gs-sync');
    const bar = () => document.getElementById('sync-alert');
    stateQuarantine = { 'results/gB': res(1) };
    fbConnKnown = true; fbConnected = false; syncDenied = false; sdkLoadFailed = false;
    updateSyncIndicator();
    assert.ok(line().textContent.includes('Offline'), 'new scores are not uploading: say so first');
    assert.equal(bar().hidden, false, 'while the top bar still names the refused edit');
    assert.ok(bar().innerHTML.includes('1 change unsaved'));
    fbConnected = true;
    updateSyncIndicator();
    assert.ok(line().innerHTML.includes('couldn’t be saved'), 'online, the card line names it too');
    syncDenied = true;
    updateSyncIndicator();
    assert.ok(line().textContent.includes('Sync blocked'), 'a revoked login is the bigger problem');
    syncDenied = false; sdkLoadFailed = true;
    updateSyncIndicator();
    assert.ok(line().textContent.includes('Couldn’t connect'));
  } finally { fbConnKnown = false; fbConnected = false; syncDenied = false; sdkLoadFailed = false; teardown(); }
});

test('the top bar is an editor-only surface: shown with the line, hidden when cleared, never for a viewer', async () => {
  await boot();
  let restoreToggle = () => {};
  try {
    const bar = () => document.getElementById('sync-alert');
    const roomCalls = [];
    const cl = document.body.classList; // the stub's toggle is a no-op: record what the page was asked to reserve
    const realToggle = cl.toggle;
    restoreToggle = () => { cl.toggle = realToggle; };
    cl.toggle = (name, force) => { roomCalls.push([name, force]); };
    fbConnKnown = true; fbConnected = true;
    stateQuarantine = { 'results/gB': res(1), 'results/gC': res(1) };
    updateSyncIndicator();
    assert.equal(bar().hidden, false);
    assert.ok(bar().innerHTML.includes('2 changes unsaved'), bar().innerHTML);
    assert.deepEqual(roomCalls.slice(-1)[0], ['has-sync-alert', true], 'the page reserves room for it');
    assert.ok(bar().innerHTML.includes('data-sync-quarantine="retry"') && bar().innerHTML.includes('data-sync-quarantine="discard"'));
    assert.notOk(bar().innerHTML.includes('gold'), 'labels only, never a place');
    setMemberRole('viewer');
    updateSyncIndicator();
    assert.equal(bar().hidden, true, 'a counselor is never shown it');
    assert.deepEqual(roomCalls.slice(-1)[0], ['has-sync-alert', false]);
    setMemberRole('editor');
    stateQuarantine = {};
    updateSyncIndicator();
    assert.equal(bar().hidden, true, 'and it is gone the moment nothing is parked');
  } finally { restoreToggle(); fbConnKnown = false; fbConnected = false; teardown(); }
});

test('the park toast says where Retry and Discard are', async () => {
  const db = await boot();
  try {
    db.refuse(STATE_PATH + '/results/gB');
    state.results.gB = res(1);
    touchData(); pushState();
    await settled();
    assert.ok(toasts.some((t) => t.includes('top of the screen')), toasts.join('|'));
  } finally { teardown(); }
});

test('a view-only device never quarantines: no park, no toast, no line, the original quiet handling', async () => {
  const db = await boot();
  try {
    setMemberRole('viewer');
    db.refuse(STATE_PATH); // the rules refuse every write from a viewer
    await withWarns(async (warns) => {
      state.meta.hiddenCards = Object.assign({}, state.meta.hiddenCards, { chat: true }); // any stray synced diff
      touchData(); pushState();
      await settled();
      assert.ok(warns.some((w) => w.includes('sync push failed')), 'logged, as before: ' + warns.join('|'));
    });
    assert.deepEqual(stateQuarantine, {});
    assert.equal(persisted()._quarantine, undefined);
    assert.deepEqual(toasts, [], 'a counselor is told nothing');
    assert.equal(stateBisecting, false);
    assert.equal(pendingWrites, 0);
    assert.equal(lastSyncedTree.meta.hiddenCards && lastSyncedTree.meta.hiddenCards.chat, undefined, 'baseline restored: the stray diff is simply re-diffed later');
    fbConnKnown = true; fbConnected = true;
    updateSyncIndicator();
    assert.equal(document.getElementById('sync-alert').hidden, true);
  } finally { fbConnKnown = false; fbConnected = false; teardown(); }
});

test('quarantineLabel reads in words for every synced area, and a removed game', () => {
  freshState();
  const g = state.config.games[0];
  assert.equal(quarantineLabel('results/' + g.id), g.name + ' → result');
  assert.equal(quarantineLabel('brackets/' + g.id), g.name + ' → bracket');
  assert.equal(quarantineLabel('live/' + g.id + '/hr/t0'), g.name + ' → live score');
  assert.equal(quarantineLabel('drafts/' + g.id + '/scores/t1'), g.name + ' → draft scores');
  assert.equal(quarantineLabel('results/long-gone'), 'Result', 'a game that left the week is just "Result"');
  assert.equal(quarantineLabel('bonuses/b1'), 'Bonus points');
  assert.equal(quarantineLabel('teams'), 'Team names');
  assert.equal(quarantineLabel('notice'), 'Notice board');
  assert.equal(quarantineLabel('meta/hiddenCards/chat'), 'Camp settings');
});

test('the delegated click on the sync line runs Retry and Discard', async () => {
  await boot();
  const realConfirm = confirm;
  try {
    stateQuarantine = { 'results/gB': res(1) };
    state.results.gB = res(1);
    const click = (which) => onSyncStatusClick({ target: { closest: () => ({ dataset: { syncQuarantine: which } }) } });
    let asked = 0;
    confirm = () => { asked++; return false; };
    click('discard');
    assert.equal(asked, 1, 'Discard asks first');
    toasts = [];
    remoteReady = false;
    click('retry');
    assert.ok(toasts.some((t) => t.includes('Not connected')), 'Retry ran');
    onSyncStatusClick({ target: { closest: () => null } }); // a click on the line itself: ignored
    onSyncStatusClick({});
  } finally { confirm = realConfirm; teardown(); }
});

// ── A reload while a path is parked: through the REAL first-snapshot merge ──
// The cache comes back as app.js's load code builds it: the stored state with
// its _quarantine and _syncBase, `confirmedTree` still null (only the first
// adopt sets it), the confirmed tree as the boot baseline.
function reloadFromCache() {
  state = persisted();
  stateQuarantine = readQuarantine();
  confirmedTree = null;
  bootHadConfirmedBase = !!readConfirmedTree();
  bootSyncedTree = readConfirmedTree() || syncedSnapshot();
  lastSyncedTree = null;
  remoteReady = false;
  stateBisecting = false;
  stateBisectQueue = [];
  stateBisectHeld = false;
  quarantineAutoRetried = {};
  pendingWrites = 0;
  dataEditPending = false;
  applyingRemote = false;
}

async function parkResult(db, gid) {
  db.refuse(STATE_PATH + '/results/' + gid);
  state.results[gid] = res(1);
  touchData(); pushState();
  await settled();
  assert.deepEqual(Object.keys(stateQuarantine), ['results/' + gid], 'precondition: parked');
}

test('RELOAD while parked and still refused: the merge re-sends the path and re-parks it, with no second toast', async () => {
  const db = await boot();
  try {
    await parkResult(db, 'gB');
    const ref = db.ref(STATE_PATH);
    reloadFromCache();
    const spy = spyOn(ref);
    fbRef = spy.ref;
    toasts = [];
    handleRemoteSnapshot((await ref.once('value')).val());
    await settled();
    assert.ok(spy.sent.some((u) => content(u).includes('results/gB')), 'the parked path was re-sent: ' + JSON.stringify(spy.sent.map(paths)));
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB'], 'and re-parked while the rules still refuse it');
    assert.ok(state.results.gB, 'the score is still on screen');
    assert.equal((confirmedTree.results || {}).gB, undefined, 'the baseline does not claim the server holds it');
    assert.equal(persisted()._quarantine['results/gB'].savedAt, 'v1');
    assert.ok(hasUnconfirmedLocalWork(), 'sign-out still warns about it');
    assert.equal((serverState(db).results || {}).gB, undefined);
    assert.notOk(toasts.some((t) => t.includes('couldn’t be saved')), 'a path that was already parked is not announced again: ' + toasts.join('|'));
  } finally { teardown(); }
});

test('RELOAD while parked and the rules now accept it: the merge saves it and the line clears', async () => {
  const db = await boot();
  try {
    await parkResult(db, 'gB');
    db.allow(STATE_PATH + '/results/gB'); // the rules were fixed meanwhile
    const ref = db.ref(STATE_PATH);
    reloadFromCache();
    fbRef = ref;
    handleRemoteSnapshot((await ref.once('value')).val());
    await settled();
    assert.equal(serverState(db).results.gB.savedAt, 'v1', 'it reached the server');
    assert.deepEqual(stateQuarantine, {});
    assert.equal(persisted()._quarantine, undefined);
    assert.ok(confirmedTree.results.gB, 'and is confirmed');
    assert.notOk(hasUnconfirmedLocalWork());
  } finally { teardown(); }
});

test('RELOAD: somebody else saved the same game meanwhile — their version wins, the parked one is dropped and the toast is true', async () => {
  const db = await boot();
  try {
    await parkResult(db, 'gB');
    db.allow(STATE_PATH + '/results/gB');
    await db.ref(STATE_PATH + '/results/gB').set(Object.assign(res(9), { savedAt: 'theirs' })); // another device
    db.refuse(STATE_PATH + '/results/gB');
    const ref = db.ref(STATE_PATH);
    reloadFromCache();
    const spy = spyOn(ref);
    fbRef = spy.ref;
    toasts = [];
    handleRemoteSnapshot((await ref.once('value')).val());
    await settled();
    assert.equal(state.results.gB.savedAt, 'theirs', 'this phone shows their version, as the toast says');
    assert.deepEqual(stateQuarantine, {});
    assert.notOk(spy.sent.some((u) => content(u).includes('results/gB')), 'and the older value was not sent over it');
    assert.ok(toasts.some((t) => t.includes('kept their version')), toasts.join('|'));
    assert.equal(persisted()._quarantine, undefined);
  } finally { teardown(); }
});

test('RELOAD: the week was reset elsewhere — last week\'s refused result is not carried into it', async () => {
  const db = await boot();
  try {
    state.results.gA = res(1); // a confirmed result, so the reset visibly removes something
    touchData(); pushState();
    await settled();
    await parkResult(db, 'gB');
    const server = clone(serverState(db));
    delete server.results; // New week (reset) on another device
    const ref = db.ref(STATE_PATH);
    reloadFromCache();
    const spy = spyOn(ref);
    fbRef = spy.ref;
    handleRemoteSnapshot(server);
    await settled();
    assert.equal(state.results.gB, undefined, 'the new week starts clean');
    assert.deepEqual(stateQuarantine, {});
    assert.notOk(spy.sent.some((u) => content(u).includes('results/gB')), 'nothing old was re-sent into it');
  } finally { teardown(); }
});

// ── The server wins when it moved past a parked path (a live snapshot) ──
test('a live snapshot after a reset elsewhere drops the parked path instead of laying it over the new week', async () => {
  const db = await boot();
  try {
    state.results.gA = res(1);
    touchData(); pushState();
    await settled();
    await parkResult(db, 'gB');
    const server = clone(serverState(db));
    delete server.results;
    toasts = [];
    handleRemoteSnapshot(server);
    assert.equal(state.results.gB, undefined);
    assert.deepEqual(stateQuarantine, {});
    assert.equal(persisted()._quarantine, undefined);
    assert.ok(toasts.some((t) => t.includes('replaced by a newer one')), toasts.join('|'));
    fbConnKnown = true; fbConnected = true;
    updateSyncIndicator();
    assert.equal(document.getElementById('sync-alert').hidden, true, 'the bar went with it');
  } finally { fbConnKnown = false; fbConnected = false; teardown(); }
});

test('a live snapshot that changes the same record drops the parked path; one that changes a neighbour keeps it', async () => {
  const db = await boot();
  try {
    await parkResult(db, 'gB');
    let server = clone(serverState(db));
    server.results = Object.assign({}, server.results, { gD: res(9) }); // a neighbour
    handleRemoteSnapshot(server);
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB'], 'an unrelated result does not disturb it');
    assert.ok(state.results.gB && state.results.gD);
    server = clone(server);
    server.results.gB = Object.assign(res(9), { savedAt: 'theirs' }); // the same record
    toasts = [];
    handleRemoteSnapshot(server);
    assert.equal(state.results.gB.savedAt, 'theirs');
    assert.deepEqual(stateQuarantine, {});
    assert.ok(toasts.some((t) => t.includes('replaced by a newer one')));
  } finally { teardown(); }
});

// ── One quiet automatic retry per parked path ──
test('a parked path gets one silent automatic retry: accepted, the bar clears; refused, nothing new is said', async () => {
  const db = await boot();
  try {
    await parkResult(db, 'gB');
    assert.ok(quarantineRetryTimer, 'a retry is scheduled when something is parked');
    clearTimeout(quarantineRetryTimer); quarantineRetryTimer = null;
    // Still refused: re-parked, no new toast, and no second automatic retry.
    toasts = [];
    autoRetryQuarantined();
    await settled();
    assert.deepEqual(Object.keys(stateQuarantine), ['results/gB']);
    assert.deepEqual(toasts, [], 'silent');
    assert.equal(quarantineAutoRetried['results/gB'], true);
    scheduleQuarantineAutoRetry();
    assert.equal(quarantineRetryTimer, null, 'one retry per path, then it waits for a human');
    // Accepted this time (but the flag already spent, so drive it by hand): the same
    // rebase-and-push clears the path through the ack.
    delete quarantineAutoRetried['results/gB'];
    db.allow(STATE_PATH + '/results/gB');
    autoRetryQuarantined();
    await settled();
    assert.deepEqual(stateQuarantine, {});
    assert.equal(serverState(db).results.gB.savedAt, 'v1');
    assert.deepEqual(quarantineAutoRetried, {}, 'the mark leaves with the path, so a later refusal is retried afresh');
  } finally { clearTimeout(quarantineRetryTimer); quarantineRetryTimer = null; teardown(); }
});

test('the automatic retry keeps the parked path in place while it runs (no flicker) and does nothing without a connection or an editor', async () => {
  const db = await boot();
  try {
    await parkResult(db, 'gB');
    clearTimeout(quarantineRetryTimer); quarantineRetryTimer = null;
    let sawParkedDuring = null;
    const spy = spyOn(db.ref(STATE_PATH), (u) => { sawParkedDuring = Object.keys(stateQuarantine); });
    fbRef = spy.ref;
    autoRetryQuarantined();
    await settled();
    assert.deepEqual(sawParkedDuring, ['results/gB'], 'still parked while the retry is in flight');
    // No connection / not an editor: no mark, no send.
    delete quarantineAutoRetried['results/gB'];
    const n = spy.sent.length;
    remoteReady = false; autoRetryQuarantined(); remoteReady = true;
    setMemberRole('viewer'); autoRetryQuarantined(); setMemberRole('editor');
    assert.equal(spy.sent.length, n);
    assert.deepEqual(quarantineAutoRetried, {});
  } finally { clearTimeout(quarantineRetryTimer); quarantineRetryTimer = null; teardown(); }
});
