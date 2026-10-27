// The Realtime Database stand-in (tests/fake-rtdb.js) is itself test
// infrastructure, so it gets pinned: a sync test is only as honest as the fake
// behind it. Each rule here is one real RTDB behaviour this app has been bitten
// by (CLAUDE.md "Firebase Realtime Database gotcha").

const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 5));

test('writes are pruned like RTDB: nulls, empty objects and empty arrays vanish', async () => {
  const db = makeFakeRtdb();
  await db.ref('a').set({ keep: 1, gone: null, empty: {}, none: [], nested: { x: null, y: { z: [] } } });
  assert.deepEqual(db.serverTree(), { a: { keep: 1 } });
  await db.ref('a/keep').remove();
  assert.deepEqual(db.serverTree(), {}, 'the parent left empty is pruned too');
});

test('keys read back sorted; arrays come back as arrays only when mostly dense', async () => {
  const db = makeFakeRtdb();
  await db.ref('x').set({ b: 1, a: 2, 10: 3, 2: 4 });
  assert.deepEqual(Object.keys(db.serverGet('x')), ['2', '10', 'a', 'b'], 'integers first, numerically, then lexical');
  await db.ref('list').set(['a', 'b', 'c']);
  assert.ok(Array.isArray(db.serverGet('list')) && db.serverGet('list').length === 3);
  await db.ref('list2').set(['a', null, 'c']);
  assert.deepEqual(db.serverGet('list2'), ['a', null, 'c'], 'a hole in a mostly-full array reads back as null');
  await db.ref('sparse').set(['a', null, null, null, null, 'b']);
  assert.notOk(Array.isArray(db.serverGet('sparse')), 'sparse: an object, like the real thing');
  assert.deepEqual(db.serverGet('sparse'), { 0: 'a', 5: 'b' });
});

test('update() is multi-path, null deletes, and relative to the ref', async () => {
  const db = makeFakeRtdb();
  await db.ref('state').set({ results: { g1: { gold: 't0' }, g2: { gold: 't1' } }, meta: { n: 1 } });
  await db.ref('state').update({ 'results/g1': null, 'results/g3/gold': 't2', 'meta/n': 2 });
  assert.deepEqual(db.serverGet('state'), { meta: { n: 2 }, results: { g2: { gold: 't1' }, g3: { gold: 't2' } } });
});

test('value listeners: a first snapshot, then only real changes; off() stops them', async () => {
  const db = makeFakeRtdb();
  const seen = [];
  const cb = (snap) => seen.push(snap.val());
  db.ref('c').on('value', cb);
  assert.deepEqual(seen, [null], 'the first snapshot of an empty node is null');
  await db.ref('c').set({ a: 1 });
  await db.ref('c').set({ a: 1 }); // same value: no new event
  await db.ref('c/a').set(2);
  assert.deepEqual(seen, [null, { a: 1 }, { a: 2 }]);
  db.ref('c').off('value', cb);
  await db.ref('c').set({ a: 3 });
  assert.equal(seen.length, 3);
});

test('manualFirstSnapshot holds the first snapshot until the "network answers"', async () => {
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  db.serverSet('config', { version: 5 });
  const seen = [];
  db.ref('config').on('value', (s) => seen.push(s.val()));
  assert.deepEqual(seen, [], 'nothing before the first pull');
  db.deliverFirstSnapshots();
  assert.deepEqual(seen, [{ version: 5 }]);
});

test('.info/connected reports and flips; offline writes queue, listen optimistically, and replay in order', async () => {
  const db = makeFakeRtdb();
  const conn = [];
  db.ref('.info/connected').on('value', (s) => conn.push(s.val()));
  const local = [];
  db.ref('state').on('value', (s) => local.push(s.val()));
  db.goOffline();
  let acked = 0;
  const p1 = db.ref('state/a').set(1).then(() => { acked += 1; });
  const p2 = db.ref('state/b').set(2).then(() => { acked += 1; });
  await wait();
  assert.equal(acked, 0, 'an offline write is not acknowledged');
  assert.equal(db.pendingCount(), 2);
  assert.deepEqual(db.serverTree(), {}, 'and the server has not seen it');
  assert.deepEqual(local[local.length - 1], { a: 1, b: 2 }, 'but local listeners see the optimistic value');
  db.goOnline();
  await Promise.all([p1, p2]);
  assert.equal(acked, 2);
  assert.deepEqual(db.serverTree(), { state: { a: 1, b: 2 } });
  assert.deepEqual(conn, [true, false, true]);
});

test('refuse(path) rejects writes under it, and a queued refused write rolls back on replay', async () => {
  const db = makeFakeRtdb();
  db.refuse('state/locked');
  let err = null;
  await db.ref('state/locked/x').set(1).catch((e) => { err = e; });
  assert.ok(err && err.code === 'PERMISSION_DENIED');
  err = null;
  await db.ref('state').set({ locked: { x: 1 } }).catch((e) => { err = e; });
  assert.ok(err, 'a write ABOVE a refused path is refused too');
  await db.ref('state/open').set(1);
  assert.deepEqual(db.serverTree(), { state: { open: 1 } });

  db.goOffline();
  const queued = db.ref('state/other').set(1).then(() => 'ok', () => 'refused');
  db.refuse('state/other'); // the rules changed while the phone was offline
  db.goOnline();
  assert.equal(await queued, 'refused');
  assert.deepEqual(db.serverTree(), { state: { open: 1 } }, 'nothing of the refused write landed');
});

test('revokeRead cancels listeners terminally: error callback, never re-armed', async () => {
  const db = makeFakeRtdb();
  const events = [];
  db.ref('state').on('value', () => events.push('value'), () => events.push('cancelled'));
  db.revokeRead('state');
  await db.ref('state/a').set(1).catch(() => {});
  db.serverSet('state/a', 2);
  assert.deepEqual(events, ['value', 'cancelled']);
  assert.equal(db.listenerCount('state'), 0);
});

test('transaction: the update function sees null with no listener, and can abort', async () => {
  const db = makeFakeRtdb();
  let sawNull = false;
  const r = await db.ref('config').transaction((cur) => { sawNull = cur === null; return undefined; });
  assert.ok(sawNull && r.committed === false, 'abort on null commits nothing');
  const seeded = await db.ref('config').transaction((cur) => (cur === null ? { version: 5 } : undefined));
  assert.ok(seeded.committed);
  assert.deepEqual(db.serverGet('config'), { version: 5 });
  const again = await db.ref('config').transaction((cur) => (cur === null ? { version: 9 } : undefined));
  assert.ok(again.committed === false, 'with the node present (re-run on the server value) the seed aborts');
  assert.deepEqual(db.serverGet('config'), { version: 5 });
});

test('transaction contention: another client wins the race and the function re-runs on its value', async () => {
  const db = makeFakeRtdb();
  db.serverSet('c', { n: 1 });
  db.ref('c').on('value', () => {}); // cached, so the first run sees { n: 1 }
  const calls = [];
  db.contend('c', (d) => d.serverSet('c', { n: 10 }));
  const r = await db.ref('c').transaction((cur) => { calls.push(cur && cur.n); return { n: cur.n + 1 }; });
  assert.deepEqual(calls, [1, 10], 'run once on the cache, again on the server value');
  assert.ok(r.committed);
  assert.deepEqual(db.serverGet('c'), { n: 11 });
});

test('server timestamps resolve, and the serverTimeOffset ref reports', async () => {
  const db = makeFakeRtdb({ serverTimeOffset: 5000 });
  await db.ref('m').set({ at: { '.sv': 'timestamp' } });
  assert.equal(typeof db.serverGet('m').at, 'number');
  const offs = [];
  db.ref('.info/serverTimeOffset').on('value', (s) => offs.push(s.val()));
  assert.deepEqual(offs, [5000]);
});

test('writes through the fake carry plain data across the vm boundary', async () => {
  const db = makeFakeRtdb();
  await db.ref('x').set({ list: [1, 2, 3], n: { a: 'b' } });
  const out = db.serverGet('x');
  assert.deepEqual(out, { list: [1, 2, 3], n: { a: 'b' } });
  out.list.push(4);
  assert.deepEqual(db.serverGet('x').list, [1, 2, 3], 'a returned value is a copy, not the stored tree');
});
