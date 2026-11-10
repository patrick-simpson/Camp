// The REAL client for export-replay.mjs: the shipped scripts, loaded through tests/harness.js (the same vm +
// DOM stub every unit test uses), over tests/fake-rtdb.js preloaded with a camp's exported data. Nothing here is a
// copy of app logic: `boot()` runs what a phone does after sign-in (three engines through their first pull) and
// `ctx.run(code)` evaluates code in the page's own global scope. Every database call the client makes goes through
// a recording wrapper, so the caller gets the writes in the order the server applied them (to replay under the
// real rules) and the reads (to check the rules let the client make them).
import { createRequire } from 'module';
import vm from 'vm';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { makeContext, clearAllTimers } = require('../harness.js');
const { makeFakeRtdb, makeFakeFirebase } = require('../fake-rtdb.js');
const PAGE = fs.readFileSync(new URL('./replay-page.js', import.meta.url), 'utf8');

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v !== null && typeof v === 'object';

// What the real SDK would reject in a value (it throws; the fake silently prunes). JSON.stringify would hide all of
// these, so the check runs on the live value before it is cloned. Returns a list of "path: problem" strings.
export function sdkProblems(value, base = '') {
  const out = [];
  const walk = (v, p) => {
    if (v === undefined) { out.push(`${p || '/'}: undefined`); return; }
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') { out.push(`${p || '/'}: ${typeof v}`); return; }
    if (typeof v === 'number' && !Number.isFinite(v)) { out.push(`${p || '/'}: ${v}`); return; }
    if (typeof v === 'string' && v.length > 10 * 1024 * 1024) { out.push(`${p || '/'}: string over 10 MB`); return; }
    if (isObj(v)) {
      if (v['.sv'] === 'timestamp' && Object.keys(v).length === 1) return;
      Object.keys(v).forEach((k) => {
        if (/[.$#[\]/\u0000-\u001f\u007f]/.test(k) || Buffer.byteLength(k) > 768) out.push(`${p}/${k}: invalid key`);
        else walk(v[k], p + '/' + k);
      });
    }
  };
  walk(value, base);
  return out;
}

// A ref that records every write the client makes (and every read it attaches), then forwards it unchanged.
// `rec` = { phase, writes: [], reads: [], problems: [] }.
function recordingRef(ref, rec) {
  const note = (w) => { w.phase = rec.phase; w.n = rec.writes.length; rec.writes.push(w); return w; };
  const bad = (what, path, value) => sdkProblems(value).forEach((p) => rec.problems.push({ phase: rec.phase, what, path, problem: p }));
  return new Proxy(ref, {
    get(target, key) {
      const v = target[key];
      if (key === 'child') return (p) => recordingRef(target.child(p), rec);
      if (key === 'parent') return v ? recordingRef(v, rec) : v;
      if (key === 'set') return (value) => { bad('set', target.path, value); note({ kind: 'set', path: target.path, value: clone(value) }); return target.set(value); };
      if (key === 'remove') return () => { note({ kind: 'remove', path: target.path }); return target.remove(); };
      if (key === 'update') {
        return (values) => {
          Object.keys(values || {}).forEach((k) => bad('update', target.path + '/' + k, values[k]));
          note({ kind: 'update', path: target.path, values: clone(values) });
          return target.update(values);
        };
      }
      if (key === 'transaction') {
        return (fn, cb, applyLocally) => {
          let seen, out;
          const wrapped = (cur) => { seen = clone(cur); const r = fn(cur); out = clone(r); if (r !== undefined) bad('transaction', target.path, r); return r; };
          const p = target.transaction(wrapped, cb, applyLocally);
          // recorded when it COMMITS (a transaction is applied a tick after the call; sets and updates are applied at
          // the call), so the list is in the order the server applied them
          return p.then((res) => { if (res && res.committed) note({ kind: 'transaction', path: target.path, seen: seen === undefined ? null : seen, out }); return res; });
        };
      }
      if (key === 'on') return (type, cb, errCb) => { rec.reads.push({ phase: rec.phase, path: target.path, how: 'on' }); return target.on(type, cb, errCb); };
      if (key === 'once') return (...a) => { rec.reads.push({ phase: rec.phase, path: target.path, how: 'once' }); return target.once(...a); };
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

function recordingFirebase(db, rec) {
  const database = () => ({ ref: (p) => recordingRef(db.ref(p), rec) });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  return { database };
}

// The paths the client engines read, relative to the camp root. Everything else in an export (chat, photos,
// presence, push devices, the changelog) is not touched by what these taps run, and chat alone can be megabytes.
export const LOAD_KEYS = ['state', 'config', 'setup', 'pushSchedule', 'restoreIndex', 'restoreBody', 'members', 'campers', 'teamPhotos'];

export function bootable(root) {
  const out = {};
  LOAD_KEYS.forEach((k) => { if (root && root[k] !== undefined) out[k] = root[k]; });
  return out;
}

// One phone. opts: { camp: 'junior'|'senior', root: the camp's data, email, role, name, weekStart }.
export async function bootClient(opts) {
  const { ctx, sandbox } = makeContext({ camp: opts.camp });
  const dbRoot = vm.runInContext('CAMP.dbRoot', ctx);
  const db = makeFakeRtdb({ manualFirstSnapshot: true });
  const rec = { phase: 'boot', writes: [], reads: [], problems: [] };
  Object.keys(bootable(opts.root)).forEach((k) => db.serverSet(dbRoot + '/' + k, opts.root[k]));
  sandbox.__rrDb = db;
  sandbox.firebase = recordingFirebase(db, rec);
  vm.runInContext(PAGE, ctx, { filename: 'replay-page.js' });
  const members = {};
  const raw = (opts.root && opts.root.members) || {};
  Object.keys(raw).forEach((k) => { const m = raw[k]; if (m && typeof m === 'object') members[k] = { role: m.role, name: m.name, teamId: m.teamId }; });
  const run = (code) => vm.runInContext(code, ctx);
  const call = async (fn, ...args) => {
    sandbox.__rrArgs = args;
    return vm.runInContext(`${fn}(...__rrArgs)`, ctx);
  };
  const client = {
    ctx, sandbox, db, rec, dbRoot, run, call,
    phase: (p) => { rec.phase = p; },
    // what the server holds at the camp root now (the part the client engines read)
    tree: () => db.serverGet(dbRoot) || {},
    stop: () => { try { vm.runInContext("clearTimeout(setupPushTimer); clearTimeout(pushTimer); clearTimeout(pushConfigTimer);", ctx); } catch (e) { /* ignore */ } clearAllTimers(); },
  };
  await call('rrBoot', { email: opts.email, role: opts.role, name: opts.name, members });
  return client;
}
