'use strict';
// An in-memory stand-in for the Firebase Realtime Database web SDK, just
// faithful enough that sync tests can drive the app's REAL listeners and
// writers instead of hand-rolled one-method stubs (setup-rebuild-spec S0i).
// Load it from a test file with:
//     const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');
//
// What it reproduces, because each one has bitten this app:
//   - RTDB storage rules: null/undefined values and empty objects/arrays are
//     PRUNED on write, arrays become index-keyed maps and come back as arrays
//     only when the keys are integers and more than half are present, keys
//     read back in sorted order. (CLAUDE.md "Realtime Database gotcha".)
//   - `value` listeners: first snapshot, then one per real change; `off`;
//     a read refused by the rules cancels the listener TERMINALLY (error
//     callback, never re-armed) - revokeRead().
//   - set / update (multi-path, null deletes) / remove / transaction, each
//     returning a promise; local listeners fire optimistically on a write.
//   - `.info/connected` and `.info/serverTimeOffset`; goOffline() queues every
//     write in memory (the real SDK's offline queue is memory-only too) and
//     goOnline() replays the queue in order.
//   - injected per-path refusals: refuse(prefix) rejects writes under a path
//     with PERMISSION_DENIED; an offline-queued write that is refused on
//     replay rolls back.
//   - transaction contention: contend(path, fn) lets "another client" write
//     between a transaction's first read and its commit, so the update
//     function is re-run on the new server value (and may abort by returning
//     undefined, as the real SDK does).
//
// Queries: orderByChild / limitToLast / limitToFirst / equalTo on a ref, read with on("value") or once() (a listener sees
// the windowed subset; snapshot.forEach walks it in query order). Not reproduced: auth, priority, onDisconnect, size
// limits. First-snapshot timing is under test control: construct with
// { manualFirstSnapshot: true } and call deliverFirstSnapshots() when the
// "network answers", to test what the app does BEFORE its first pull.

// Every acknowledgement (a write's promise, a refusal, a transaction's run) is delivered a macrotask after the call, as
// the real SDK's is. They are counted while they are on their way so a test can wait for "everything acknowledged"
// instead of guessing at a delay: `inflight()` is how many are still pending, across every fake database. (The
// harness's waitQuiet() reads it; a chain of acknowledgements, each setting off the next write, is otherwise invisible.)
let inflightAcks = 0;
function later(fn) {
  inflightAcks += 1;
  setTimeout(() => { inflightAcks -= 1; fn(); }, 0);
}
const inflight = () => inflightAcks;

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v !== null && typeof v === 'object';
const split = (p) => String(p || '').split('/').filter(Boolean);

// ── stored form ──────────────────────────────────────────────────

// What RTDB would keep for `v` (undefined when it prunes to nothing).
function toStored(v) {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => { const s = toStored(x); if (s !== undefined) o[i] = s; });
    return Object.keys(o).length ? sortKeys(o) : undefined;
  }
  if (isObj(v)) {
    const o = {};
    Object.keys(v).forEach((k) => { const s = toStored(v[k]); if (s !== undefined) o[k] = s; });
    return Object.keys(o).length ? sortKeys(o) : undefined;
  }
  return v;
}

// RTDB lists integer-looking keys numerically first, then the rest lexically.
function sortKeys(o) {
  const out = {};
  Object.keys(o).sort((a, b) => {
    const ai = /^(0|[1-9]\d*)$/.test(a), bi = /^(0|[1-9]\d*)$/.test(b);
    if (ai && bi) return Number(a) - Number(b);
    if (ai) return -1;
    if (bi) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }).forEach((k) => { out[k] = o[k]; });
  return out;
}

// What a reader gets back: index-keyed maps rebuilt into arrays (RTDB's rule:
// all keys integers, and more than half of 0..max present).
function fromStored(v) {
  if (!isObj(v)) return v;
  const keys = Object.keys(v);
  const out = {};
  keys.forEach((k) => { out[k] = fromStored(v[k]); });
  if (keys.length && keys.every((k) => /^(0|[1-9]\d*)$/.test(k))) {
    const max = Math.max(...keys.map(Number));
    // The SDK's exact rule (ChildrenNode.val): an array when maxKey < 2 * numKeys.
    if (max < 2 * keys.length) {
      const arr = [];
      for (let i = 0; i <= max; i += 1) arr.push(out[i] === undefined ? null : out[i]);
      return arr;
    }
  }
  return out;
}

function getAt(tree, parts) {
  let cur = tree;
  for (const p of parts) {
    if (!isObj(cur) || cur[p] === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

// Mutates `tree` (stored form): write `value` (stored form or undefined = delete)
// at `parts`, pruning parents left empty.
function setAt(tree, parts, value) {
  if (!parts.length) return;
  const [head, ...rest] = parts;
  if (!rest.length) {
    if (value === undefined) delete tree[head]; else tree[head] = value;
    return;
  }
  if (!isObj(tree[head])) {
    if (value === undefined) return;
    tree[head] = {};
  }
  setAt(tree[head], rest, value);
  if (isObj(tree[head]) && !Object.keys(tree[head]).length) delete tree[head];
}

function denied(path) {
  const e = new Error('PERMISSION_DENIED: Permission denied (' + path + ')');
  e.code = 'PERMISSION_DENIED';
  return e;
}

// ── the database ─────────────────────────────────────────────────

function makeFakeRtdb(opts) {
  const o = opts || {};
  let server = {};
  let online = true;
  let serverTimeOffset = o.serverTimeOffset || 0;
  let held = !!o.manualFirstSnapshot; // first snapshots wait for deliverFirstSnapshots()
  const listeners = [];   // { parts, cb, errCb, last, started }
  const pending = [];     // queued while offline: { kind, apply, finish, parts[] }
  const refusals = [];    // path prefixes (parts) whose writes are refused
  const readDenials = []; // path prefixes whose reads are refused
  const contenders = [];  // { parts, fn } one-shot, run mid-transaction
  const db = { log: [], now: () => Date.now() + serverTimeOffset };

  // Server tree + the queued (optimistic) writes on top of it.
  function view() {
    const t = clone(server) || {};
    pending.forEach((p) => { if (p.optimistic) p.optimistic(t); });
    return t;
  }

  function valueAt(parts) {
    if (parts[0] === '.info') {
      if (parts[1] === 'connected') return online;
      if (parts[1] === 'serverTimeOffset') return serverTimeOffset;
      return null;
    }
    return getAt(view(), parts);
  }

  // `order` (a query's result): the child keys in query order, so forEach walks them as the SDK does.
  function snapshotOf(parts, stored, order) {
    const val = stored === undefined ? null : fromStored(clone(stored));
    const kids = () => (isObj(stored) ? (order || Object.keys(stored)) : []);
    return {
      key: parts.length ? parts[parts.length - 1] : null,
      val: () => clone(val),
      exists: () => val !== null,
      child: (p) => snapshotOf(parts.concat(split(p)), getAt(stored, split(p))),
      forEach: (fn) => { const ks = kids(); for (let i = 0; i < ks.length; i += 1) { if (fn(snapshotOf(parts.concat([ks[i]]), stored[ks[i]])) === true) return true; } return false; },
      numChildren: () => kids().length,
      hasChildren: () => kids().length > 0,
    };
  }

  // A query (orderByChild / limitToLast / limitToFirst): the children sorted by the child's value (then key), cut to the
  // window. Only what the app uses; a value listener sees the windowed subset, so a row that falls out of the window is gone.
  function shapeQuery(stored, q) {
    if (!isObj(stored)) return { stored: undefined, order: [] };
    let keys = Object.keys(stored);
    if (q.child) {
      const at = (k) => { const v = isObj(stored[k]) ? stored[k][q.child] : undefined; return v === undefined ? null : v; };
      keys.sort((a, b) => { const x = at(a), y = at(b); return x === y ? (a < b ? -1 : a > b ? 1 : 0) : (x === null ? -1 : y === null ? 1 : x < y ? -1 : 1); });
    }
    if (q.equalTo !== undefined) keys = keys.filter((k) => isObj(stored[k]) && stored[k][q.child] === q.equalTo);
    if (q.last) keys = keys.slice(-q.last);
    if (q.first) keys = keys.slice(0, q.first);
    const out = {};
    keys.forEach((k) => { out[k] = stored[k]; });
    return { stored: keys.length ? out : undefined, order: keys };
  }

  function fire() {
    listeners.slice().forEach((l) => {
      if (held && !l.started) return;
      let v = valueAt(l.parts);
      let order;
      if (l.query) { const sh = shapeQuery(v, l.query); v = sh.stored; order = sh.order; }
      const sig = JSON.stringify(v === undefined ? null : v) + (order ? '|' + order.join(',') : '');
      if (l.started && sig === l.last) return;
      l.started = true;
      l.last = sig;
      l.cb(snapshotOf(l.parts, v, order));
    });
  }

  function isRefused(parts) {
    return refusals.some((r) => r.every((seg, i) => parts[i] === seg) && parts.length >= r.length) ||
      refusals.some((r) => parts.length < r.length && parts.every((seg, i) => r[i] === seg)); // a write ABOVE a refused path
  }

  // Every ServerValue.TIMESTAMP of ONE write is the same moment, like the real server (one update stamping two epochs must
  // write equal values: `ts` is that write's single, lazily taken reading of the clock).
  function resolveSv(v, ts) {
    ts = ts || {};
    if (isObj(v)) {
      if (v['.sv'] === 'timestamp') { if (ts.n === undefined) ts.n = db.now(); return ts.n; }
      Object.keys(v).forEach((k) => { v[k] = resolveSv(v[k], ts); });
    }
    return v;
  }

  // Run one write through refusal, offline queueing and listener firing.
  // `apply(tree)` mutates a stored-form tree; `touchedPaths` are the paths it writes.
  function enqueueWrite(kind, touchedPaths, apply) {
    db.log.push({ kind, paths: touchedPaths.map((p) => p.join('/')) });
    return new Promise((resolve, reject) => {
      if (touchedPaths.some(isRefused)) { later(() => reject(denied(touchedPaths[0].join('/')))); return; }
      if (!online) {
        pending.push({
          kind,
          touched: touchedPaths,
          optimistic: apply,
          commit: () => { apply(server); },
          resolve,
          reject,
        });
        fire(); // the SDK raises local events for an optimistic write straight away
        return;
      }
      apply(server);
      fire();
      later(resolve);
    });
  }

  function makeQuery(parts, q) {
    const base = makeRef(parts);
    const next = (more) => makeQuery(parts, Object.assign({}, q, more));
    const run = (stored) => { const sh = shapeQuery(stored, q); return snapshotOf(parts, sh.stored, sh.order); };
    return {
      orderByChild: (f) => next({ child: f }),
      limitToLast: (n) => next({ last: n }),
      limitToFirst: (n) => next({ first: n }),
      equalTo: (v) => next({ equalTo: v }),
      on(type, cb, errCb) {
        if (type !== 'value') throw new Error('fake-rtdb: only "value" listeners are supported');
        if (readDenials.some((d) => d.every((seg, i) => parts[i] === seg))) {
          if (errCb) later(() => errCb(denied(parts.join('/'))));
          return cb;
        }
        listeners.push({ parts, cb, errCb, last: null, started: false, query: q });
        if (!held) fire();
        return cb;
      },
      off(type, cb) {
        for (let i = listeners.length - 1; i >= 0; i -= 1) {
          const l = listeners[i];
          if (l.query === q && (!cb || l.cb === cb)) listeners.splice(i, 1);
        }
      },
      once() {
        return new Promise((resolve, reject) => {
          const go = () => {
            if (readDenials.some((d) => d.every((seg, i) => parts[i] === seg))) { reject(denied(parts.join('/'))); return; }
            resolve(run(valueAt(parts)));
          };
          if (online) go(); else pending.push({ kind: 'read', touched: [], run: go });
        });
      },
      ref: base,
    };
  }

  function makeRef(parts) {
    const ref = {
      key: parts.length ? parts[parts.length - 1] : null,
      path: parts.join('/'),
      toString: () => '/' + parts.join('/'),
      child: (p) => makeRef(parts.concat(split(p))),
      get parent() { return parts.length ? makeRef(parts.slice(0, -1)) : null; },

      // Queries: orderByChild(f) with limitToLast(n) / limitToFirst(n) / equalTo(v), read through on('value') or once('value').
      orderByChild: (f) => makeQuery(parts, { child: f }),
      limitToLast: (n) => makeQuery(parts, { last: n }),
      limitToFirst: (n) => makeQuery(parts, { first: n }),

      on(type, cb, errCb) {
        if (type !== 'value') throw new Error('fake-rtdb: only "value" listeners are supported');
        if (readDenials.some((d) => d.every((seg, i) => parts[i] === seg))) {
          if (errCb) later(() => errCb(denied(parts.join('/'))));
          return cb;
        }
        listeners.push({ parts, cb, errCb, last: null, started: false });
        if (!held) fire();
        return cb;
      },
      off(type, cb) {
        for (let i = listeners.length - 1; i >= 0; i -= 1) {
          const l = listeners[i];
          if (l.parts.join('/') === parts.join('/') && (!cb || l.cb === cb)) listeners.splice(i, 1);
        }
      },
      once() {
        return new Promise((resolve, reject) => {
          const go = () => {
            if (readDenials.some((d) => d.every((seg, i) => parts[i] === seg))) { reject(denied(parts.join('/'))); return; }
            resolve(snapshotOf(parts, valueAt(parts)));
          };
          if (online || parts[0] === '.info') go(); else pending.push({ kind: 'read', touched: [], run: go });
        });
      },

      set(value) {
        const stored = toStored(resolveSv(clone(value)));
        return enqueueWrite('set', [parts], (t) => setAt(t, parts, stored));
      },
      remove() {
        return enqueueWrite('remove', [parts], (t) => setAt(t, parts, undefined));
      },
      // Multi-path update: keys are paths relative to this ref; null deletes.
      update(values) {
        const svTs = {};
        const entries = Object.keys(values || {}).map((k) => [parts.concat(split(k)), toStored(resolveSv(clone(values[k]), svTs))]);
        return enqueueWrite('update', entries.map((e) => e[0]), (t) => entries.forEach(([p, v]) => setAt(t, p, v)));
      },

      // Promise-returning transaction (applyLocally is accepted and ignored:
      // the app always passes false, and the fake never shows the intermediate
      // value). The update function sees the CACHED value on its first run -
      // null when nothing is listening at or above this path, exactly the
      // case the spec's "abort on null" rule is about.
      transaction(fn) {
        db.log.push({ kind: 'transaction', paths: [parts.join('/')] });
        return new Promise((resolve, reject) => {
          const run = () => {
            if (isRefused(parts)) { reject(denied(parts.join('/'))); return; }
            const cached = listeners.some((l) => l.parts.length <= parts.length && l.parts.every((seg, i) => parts[i] === seg));
            let seen = cached ? valueAt(parts) : undefined;
            let next = fn(seen === undefined ? null : fromStored(clone(seen)));
            for (let i = contenders.length - 1; i >= 0; i -= 1) {
              if (contenders[i].parts.join('/') === parts.join('/')) {
                const c = contenders.splice(i, 1)[0];
                c.fn(db); // another client writes now
              }
            }
            for (let tries = 0; tries < 25; tries += 1) {
              const nowServer = getAt(server, parts);
              if (next === undefined) { resolve({ committed: false, snapshot: snapshotOf(parts, nowServer) }); return; }
              if (JSON.stringify(nowServer === undefined ? null : nowServer) === JSON.stringify(seen === undefined ? null : seen)) {
                const stored = toStored(resolveSv(clone(next))); // a transaction may return ServerValue.TIMESTAMP, like set / update
                setAt(server, parts, stored);
                fire();
                resolve({ committed: true, snapshot: snapshotOf(parts, stored) });
                return;
              }
              // The server moved since the function last ran: run it again on the real value.
              seen = nowServer;
              next = fn(seen === undefined ? null : fromStored(clone(seen)));
            }
            reject(new Error('fake-rtdb: transaction kept losing the race'));
          };
          if (online) later(run); else pending.push({ kind: 'txn', touched: [parts], run });
        });
      },
    };
    return ref;
  }

  // ── test controls ──────────────────────────────────────────────

  db.ref = (path) => makeRef(split(path));

  // Another client wrote `value` at `path` (or deleted it with null).
  db.serverSet = (path, value) => { setAt(server, split(path), toStored(clone(value))); fire(); };
  db.serverGet = (path) => { const v = getAt(server, split(path)); return v === undefined ? null : fromStored(clone(v)); };
  db.serverTree = () => fromStored(clone(server)) || {};

  db.goOffline = () => { online = false; fire(); };
  db.goOnline = () => {
    online = true;
    const queue = pending.splice(0, pending.length);
    queue.forEach((p) => {
      if (p.run) { p.run(); return; }
      if (p.touched.some(isRefused)) { p.reject(denied(p.touched[0].join('/'))); return; } // rolls back: dropped from the queue
      p.commit();
      later(p.resolve);
    });
    fire();
  };
  db.isOnline = () => online;
  db.pendingCount = () => pending.length;

  db.setServerTimeOffset = (ms) => { serverTimeOffset = ms; fire(); };

  // Writes under `path` are refused with PERMISSION_DENIED (and anything that
  // writes ABOVE it, like a whole-node set).
  db.refuse = (path) => { refusals.push(split(path)); };
  db.allow = (path) => {
    const p = split(path).join('/');
    for (let i = refusals.length - 1; i >= 0; i -= 1) if (refusals[i].join('/') === p) refusals.splice(i, 1);
  };

  // A read at `path` is refused from now on; listeners already attached there
  // are cancelled the way the SDK cancels them: error callback, then gone for
  // good (the app treats that as terminal).
  db.revokeRead = (path) => {
    const parts = split(path);
    readDenials.push(parts);
    listeners.slice().forEach((l) => {
      if (parts.every((seg, i) => l.parts[i] === seg)) {
        listeners.splice(listeners.indexOf(l), 1);
        if (l.errCb) l.errCb(denied(l.parts.join('/')));
      }
    });
  };

  // `fn(db)` runs once, between the next transaction on `path` reading its
  // value and committing - i.e. another client wins the race.
  db.contend = (path, fn) => { contenders.push({ parts: split(path), fn }); };

  // Release the first snapshots held by { manualFirstSnapshot: true }.
  db.deliverFirstSnapshots = () => { held = false; fire(); };
  db.holdFirstSnapshots = () => { held = true; };

  db.listenerCount = (path) => listeners.filter((l) => path === undefined || l.parts.join('/') === split(path).join('/')).length;

  return db;
}

// A `firebase` global shape for code that calls firebase.database().ref(...)
// and ServerValue.TIMESTAMP, backed by one fake database.
function makeFakeFirebase(db) {
  const database = () => ({ ref: (p) => db.ref(p) });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  return { database };
}

module.exports = { makeFakeRtdb, makeFakeFirebase, toStored, fromStored, inflight };
