// The two helpers tests wait with (tests/harness.js: waitUntil, waitQuiet) and the acknowledgement counter behind them
// (tests/fake-rtdb.js: inflight). A test that waits for the clock instead of for the app loses whenever the process stalls;
// these are what it waits with instead, so they are pinned here: they must resolve as soon as the thing is true, never
// early (a chain of acknowledgements, each setting off the next write), never on a timer the test means to catch
// pending, and they must say what they were waiting for when the deadline passes.

const { makeFakeRtdb, inflight } = nodeRequire('./fake-rtdb.js');

const real = setTimeout; // the sandbox's, which tracks what the app starts
const rawSleep = (ms) => new Promise((r) => real(r, ms));

test('waitUntil resolves as soon as the condition holds, returns its value, and checks it at once', async () => {
  let n = 0;
  const t0 = Date.now();
  assert.equal(await waitUntil(() => 'yes'), 'yes', 'already true: no waiting');
  setTimeout(() => { n = 7; }, 30);
  assert.equal(await waitUntil(() => n, 'n to become 7'), 7);
  assert.ok(Date.now() - t0 < 5000, 'and it did not run to its deadline');
});

test('waitUntil accepts an async condition', async () => {
  let ready = false;
  setTimeout(() => { ready = true; }, 10);
  await waitUntil(async () => { await rawSleep(1); return ready; }, 'ready');
  assert.equal(ready, true);
});

test('waitUntil names what it was waiting for when the deadline passes', async () => {
  let message = '';
  try { await waitUntil(() => false, 'the moon to be made of cheese', 40); } catch (e) { message = e.message; }
  assert.ok(/timed out waiting for the moon to be made of cheese/.test(message), message);
});

test('waitQuiet waits out every short app timer, including one that a timer starts', async () => {
  const order = [];
  setTimeout(() => { order.push('a'); setTimeout(() => order.push('b'), 25); }, 25);
  assert.deepEqual(order, []);
  await waitQuiet();
  assert.deepEqual(order, ['a', 'b'], 'the second timer was started by the first, after waitQuiet began, and was still waited for');
});

test('waitQuiet waits for a whole chain of acknowledgements, each setting off the next write', async () => {
  const db = makeFakeRtdb();
  const ref = db.ref('chain');
  let landed = 0;
  const step = () => { landed += 1; return landed < 6 ? ref.set({ n: landed }).then(step) : null; };
  ref.set({ n: 0 }).then(step);
  assert.ok(inflight() > 0, 'the first acknowledgement is on its way');
  await waitQuiet();
  assert.equal(landed, 6, 'all six links ran: a fixed sleep covering the chain is a bet; this is not');
  assert.equal(inflight(), 0, 'and nothing is owed any more');
  assert.equal(db.serverGet('chain').n, 5, 'the last write landed');
});

test('waitQuiet does not wait for a long timer (a toast, the motion sampler), nor for a write an offline database is only holding', async () => {
  const handle = setTimeout(() => {}, 2500);
  const db = makeFakeRtdb();
  db.goOffline();
  db.ref('held').set({ x: 1 });
  assert.equal(db.pendingCount(), 1);
  assert.equal(inflight(), 0, 'queued for goOnline(), not in flight');
  const t0 = Date.now();
  await waitQuiet();
  assert.ok(Date.now() - t0 < 1500, 'returned long before the 2.5 s timer');
  clearTimeout(handle);
  db.goOnline();
  await waitQuiet();
  assert.equal(db.serverGet('held').x, 1, 'and once it is online, the held write is acknowledged and waited for');
});

test('waitQuiet times out naming the timers that would not settle', async () => {
  const handle = setTimeout(() => {}, 900);
  let message = '';
  try { await waitQuiet(60); } catch (e) { message = e.message; }
  clearTimeout(handle);
  assert.ok(/timed out waiting for 1 app timer\(s\) \(delays 900 ms\)/.test(message), message);
});
