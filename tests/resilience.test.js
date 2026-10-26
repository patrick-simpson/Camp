// Failure handling for the two third-party systems the app leans on at the
// worst moments: the Firebase SDK scripts (three cross-origin requests on camp
// wifi) and the browser's IndexedDB (Pictionary photos). Both used to turn an
// ordinary hiccup into lost data or a silently dead feature.

// ── Firebase SDK failed to load ───────────────────────────────────

// The state a returning, approved editor's phone is in when boot() runs:
// painted from the hint, cache on disk, startAuth() about to confirm.
function seedReturningEditor() {
  window.FIREBASE_CONFIG = { apiKey: 'test-key' };
  localStorage.setItem(AUTH_HINT_KEY, 'editor');
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ marker: 'offline-scores' }));
  setMemberRole('editor');
  appStarted = true; // boot() already painted from the hint
  sdkLoadFailed = false;
}

function cleanupSdkTest() {
  delete globalThis.firebase;
  delete window.FIREBASE_CONFIG;
  localStorage.removeItem(AUTH_HINT_KEY);
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(SDK_RETRIES_KEY);
  sdkLoadFailed = false;
  authUser = null;
  setMemberRole('editor');
}

test('firebaseSdkReady needs app + auth + database', () => {
  delete globalThis.firebase;
  assert.notOk(firebaseSdkReady(), 'no SDK');
  globalThis.firebase = { apps: [], auth: () => ({}) };
  assert.notOk(firebaseSdkReady(), 'database-compat missing');
  globalThis.firebase = { apps: [], database: () => ({}) };
  assert.notOk(firebaseSdkReady(), 'auth-compat missing');
  globalThis.firebase = { apps: [], auth: () => ({}), database: () => ({}) };
  assert.ok(firebaseSdkReady());
  delete globalThis.firebase;
});

test('SDK missing its database script: a hint-painted editor goes read-only, keeping cache and hint', () => {
  seedReturningEditor();
  // app-compat and auth-compat loaded, database-compat did not.
  globalThis.firebase = { apps: [], auth: () => ({ onAuthStateChanged: () => { throw new Error('must not subscribe'); } }) };
  const before = __reloads;

  startAuth();

  assert.notOk(canEdit(), 'an editor session that can never sync must not be editable');
  assert.equal(memberRole, 'viewer');
  assert.equal(localStorage.getItem(AUTH_HINT_KEY), 'editor', 'the hint is kept — the next good load paints as before');
  assert.ok(localStorage.getItem(STORAGE_KEY), 'the cached camp data (offline scores) is NOT wiped');
  assert.ok(sdkLoadFailed);
  assert.equal(__reloads, before, 'no reload is forced on the spot');
  cleanupSdkTest();
});

test('SDK entirely missing with a production config is a failure, not "local dev"', () => {
  seedReturningEditor();
  delete globalThis.firebase;
  startAuth();
  assert.notOk(canEdit(), 'no longer an editable app that silently never syncs');
  assert.equal(localStorage.getItem(AUTH_HINT_KEY), 'editor');
  cleanupSdkTest();
});

test('no Firebase config at all (local dev) still just runs the app', () => {
  delete window.FIREBASE_CONFIG;
  delete globalThis.firebase;
  setMemberRole('editor');
  appStarted = true;
  startAuth();
  assert.ok(canEdit(), 'local dev keeps working as before');
  assert.notOk(sdkLoadFailed);
  cleanupSdkTest();
});

test('a failed SDK says so in the sync indicator and offers a tap-to-reload bar', () => {
  seedReturningEditor();
  globalThis.firebase = { apps: [], auth: () => ({}) };
  const real = { getElementById: document.getElementById, createElement: document.createElement };
  const status = real.getElementById('sync-status');
  const appended = [];
  document.getElementById = (id) => (id === 'sdk-banner' ? (appended.find((b) => b.id === id) || null) : real.getElementById(id));
  document.createElement = () => { const b = real.createElement(); b.type = ''; return b; };
  document.body.appendChild = (el) => appended.push(el);

  startAuth();
  startAuth(); // a second failure must not stack a second bar

  assert.ok(status.textContent.includes('read-only'), 'indicator: ' + status.textContent);
  assert.equal(appended.length, 1, 'exactly one bar');
  assert.equal(appended[0].id, 'sdk-banner');
  assert.ok(appended[0].textContent.includes('Tap to reload'));

  document.getElementById = real.getElementById;
  document.createElement = real.createElement;
  document.body.appendChild = () => {};
  cleanupSdkTest();
});

test('the member-ref catch never wipes data or claims the account is not on the list', () => {
  seedReturningEditor();
  authUser = null;
  // database-compat half-loaded: database() itself throws.
  globalThis.firebase = { apps: [{}], auth: () => ({}), database: () => { throw new TypeError('firebase.database is not a function'); } };

  const realWarn = console.warn;
  console.warn = () => {}; // the catch logs the cause; keep test output clean
  handleAuthUser({ email: 'director@example.com' });
  console.warn = realWarn;

  assert.ok(localStorage.getItem(STORAGE_KEY), 'cached state survives');
  assert.equal(localStorage.getItem(AUTH_HINT_KEY), 'editor', 'hint survives');
  assert.notOk(canEdit(), 'but the unconfirmed session is read-only');
  assert.ok(sdkLoadFailed);
  cleanupSdkTest();
});

test('retries are bounded, wait for the network, and survive a hidden→visible cycle', () => {
  seedReturningEditor();
  globalThis.firebase = { apps: [], auth: () => ({}) };
  const handlers = { online: [], visibilitychange: [] };
  const realW = window.addEventListener, realD = document.addEventListener;
  window.addEventListener = (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); };
  document.addEventListener = (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); };

  const before = __reloads;
  startAuth();
  assert.equal(handlers.online.length, 1);
  assert.equal(handlers.visibilitychange.length, 1);

  // Going hidden must not spend the retry; offline must not either.
  document.hidden = true;
  handlers.visibilitychange[0]();
  navigator.onLine = false;
  document.hidden = false;
  handlers.visibilitychange[0]();
  assert.equal(__reloads, before, 'nothing fired while hidden or offline');

  navigator.onLine = true;
  handlers.visibilitychange[0]();
  assert.equal(__reloads, before + 1, 'visible + online → one reload');
  assert.equal(sessionStorage.getItem(SDK_RETRIES_KEY), '1');
  handlers.online[0](); // the other trigger racing it must not double-fire
  assert.equal(__reloads, before + 1);

  // After the budget is spent, no automatic retry is armed at all.
  sdkLoadFailed = false;
  sessionStorage.setItem(SDK_RETRIES_KEY, String(SDK_MAX_RETRIES));
  handlers.online.length = 0; handlers.visibilitychange.length = 0;
  startAuth();
  assert.equal(handlers.online.length, 0, 'bounded: no listener once the budget is spent');
  assert.equal(handlers.visibilitychange.length, 0);

  window.addEventListener = realW; document.addEventListener = realD;
  document.hidden = false;
  cleanupSdkTest();
});

test('a loaded SDK resets the retry budget', () => {
  window.FIREBASE_CONFIG = { apiKey: 'test-key' };
  sessionStorage.setItem(SDK_RETRIES_KEY, '2');
  globalThis.firebase = {
    apps: [{}],
    auth: () => ({ onAuthStateChanged: () => {} }),
    database: () => ({}),
  };
  startAuth();
  assert.equal(sessionStorage.getItem(SDK_RETRIES_KEY), null);
  assert.notOk(sdkLoadFailed);
  cleanupSdkTest();
});

// ── Pictionary photo store (IndexedDB) ────────────────────────────

// A small fake IndexedDB: requests succeed on a later tick, the transaction
// completes (or aborts) after its request, and a connection can be killed.
function fakeIndexedDB(opts) {
  const o = Object.assign({ failOpens: 0, abortWrites: false }, opts || {});
  const fake = { opens: 0, conns: [], data: new Map(), failOpens: o.failOpens, abortWrites: o.abortWrites };
  fake.indexedDB = {
    open() {
      fake.opens++;
      const req = {};
      setTimeout(() => {
        if (fake.failOpens > 0) { fake.failOpens--; req.error = new Error('open failed'); req.onerror(); return; }
        const db = {
          dead: false, closed: false,
          close() { db.closed = true; },
          transaction() {
            if (db.dead) throw new Error('InvalidStateError: connection is closing');
            const tx = {};
            tx.objectStore = () => {
              const wrap = (run, isWrite) => (...args) => {
                const r = {};
                setTimeout(() => {
                  r.result = run(...args);
                  if (r.onsuccess) r.onsuccess();
                  if (isWrite && fake.abortWrites) { tx.error = new Error('QuotaExceededError'); if (tx.onabort) tx.onabort(); }
                  else if (tx.oncomplete) tx.oncomplete();
                }, 0);
                return r;
              };
              return {
                put: wrap((v, k) => { fake.data.set(k, v); return k; }, true),
                get: wrap((k) => fake.data.get(k), false),
                delete: wrap((k) => { fake.data.delete(k); }, true),
                clear: wrap(() => { fake.data.clear(); }, true),
              };
            };
            return tx;
          },
        };
        fake.conns.push(db);
        req.result = db;
        req.onsuccess();
      }, 0);
      return req;
    },
    deleteDatabase() {},
  };
  return fake;
}

function resetPhotoDb() { photoDBPromise = null; photoDBConn = null; }

test('a photo write resolves only after its transaction commits', async () => {
  resetPhotoDb();
  const fake = fakeIndexedDB({ abortWrites: true });
  indexedDB = fake.indexedDB;
  let outcome = 'pending';
  await putPhoto('pic:t0:0', 'blob').then(() => { outcome = 'saved'; }, () => { outcome = 'rejected'; });
  assert.equal(outcome, 'rejected', 'an aborted transaction is a failure, not a saved photo');

  resetPhotoDb();
  const ok = fakeIndexedDB();
  indexedDB = ok.indexedDB;
  await putPhoto('pic:t0:0', 'blob');
  assert.equal(await getPhoto('pic:t0:0'), 'blob', 'and a committed one round-trips');
});

test('a dead connection is replaced transparently (one retry on a fresh one)', async () => {
  resetPhotoDb();
  const fake = fakeIndexedDB();
  indexedDB = fake.indexedDB;
  await putPhoto('a', 1);
  assert.equal(fake.opens, 1);

  fake.conns[0].dead = true; // iOS drops the connection while the app sits in the background
  await putPhoto('b', 2);
  assert.equal(fake.opens, 2, 'reopened instead of failing against the dead handle');
  assert.ok(fake.conns[0].closed, 'the dead connection was closed');
  assert.equal(fake.data.get('b'), 2);
  assert.equal(await getPhoto('a'), 1);
  assert.equal(fake.opens, 2, 'the fresh connection is cached again');
});

test('the browser closing or invalidating a connection makes the next op reopen', async () => {
  resetPhotoDb();
  const fake = fakeIndexedDB();
  indexedDB = fake.indexedDB;
  await putPhoto('a', 1);
  fake.conns[0].onclose(); // abnormal close event
  await putPhoto('b', 2);
  assert.equal(fake.opens, 2, 'onclose forgets the connection');

  fake.conns[1].onversionchange(); // another tab upgrading/deleting the db
  assert.ok(fake.conns[1].closed, 'we step aside so the other tab is not blocked');
  await putPhoto('c', 3);
  assert.equal(fake.opens, 3);
});

test('a failed open is not cached forever', async () => {
  resetPhotoDb();
  const fake = fakeIndexedDB({ failOpens: 2 }); // the first attempt AND its one retry fail
  indexedDB = fake.indexedDB;
  let failed = false;
  await putPhoto('a', 1).catch(() => { failed = true; });
  assert.ok(failed, 'both attempts failed → the error surfaces');
  await putPhoto('a', 1); // storage is back
  assert.equal(fake.data.get('a'), 1, 'the next call tries again instead of replaying the old failure');
});

test('a concurrent op that already reopened keeps its connection when a stale one fails', async () => {
  resetPhotoDb();
  const fake = fakeIndexedDB();
  indexedDB = fake.indexedDB;
  await putPhoto('a', 1);
  const stale = fake.conns[0];
  stale.dead = true;
  await putPhoto('b', 2); // reopens → conns[1]
  const fresh = fake.conns[1];
  // A straggler that was holding the OLD connection fails now.
  dropPhotoDB(stale);
  assert.notOk(fresh.closed, 'the fresh connection is not closed by a stale failure');
  await putPhoto('c', 3);
  assert.equal(fake.opens, 2, 'and is still the cached one');
});
