// The REAL client's Campers writes against the PUBLISHED rules (BUILD-PLAN Step 25, session 3): the shipped scripts (tests/harness.js's vm and DOM stub,
// as every unit test loads them) talk to the database emulator under database.rules.json through the same thin compat adapter the other *-client suites
// use. Nothing here is a copy of the client's logic. campers.mjs proves the RULES' side with hand-written values (editor-only read and write, the
// name/ord anchor pair, scalars and unknown children refused); this proves the CLIENT's own writes are what those rules accept, and that its listener
// and its refusals behave against them:
//   - a director's phone attaches the real editor-only listener and reads the list; Add is ONE multi-path update of whole { name, ord } records with
//     c-<10 base36> ids, 300 names at once and a 40-character name included; Rename, Move (one update: delete + create, same id) and Remove are
//     accepted, and the screen's Undo (the same record put back) too;
//   - a rename sent from a stale view of a camper another director has since moved is REFUSED by the anchor pair (the rules' protection against a
//     resurrected camper), and the client says so in words rather than throwing;
//   - names typed with no signal are held in memory and the moment the connection is back they go in one update per team, accepted;
//   - a counselor's phone (and a director in a counselor preview) attaches nothing, writes nothing, and the rules refuse the same reads and writes by
//     hand; a director's demotion drops the list from memory;
//   - the client never writes anywhere but the camper node.
// No rules change belongs to this step: `campers` was published in R1.
import { createRequire } from 'module';
import vm from 'vm';
import { onValue, remove } from 'firebase/database';
import { harness, suite, NEW_RULES, ROOTS, ED, VW, ref, get, set, update, assertFails, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const { makeContext } = require('../harness.js');

const s = suite('campers — the real client\'s writes against the real rules');
const h = await harness('campers-client', NEW_RULES);
await h.members();

// firebase.database().ref(path) over a modular Database instance (values round-tripped through JSON so an object made in the page's vm realm is a plain
// object to the SDK). `off` with no callback detaches every listener of the ref, as the real SDK's does.
function compatFirebase(db, log) {
  const wrap = (snap) => ({
    key: snap.key, val: () => snap.val(), exists: () => snap.exists(), child: (p) => wrap(snap.child(p)),
    forEach: (fn) => { snap.forEach((c) => fn(wrap(c))); },
  });
  const refOf = (path) => {
    const r = ref(db, path);
    const unsubs = [];
    return {
      path,
      child: (p) => refOf(path + '/' + p),
      on(type, cb, errCb) { unsubs.push(onValue(r, (snap) => cb(wrap(snap)), (e) => { if (errCb) errCb(e); })); return cb; },
      off() { while (unsubs.length) unsubs.pop()(); },
      once() { return get(r).then(wrap); },
      update(values) { const plain = JSON.parse(JSON.stringify(values)); log.push({ op: 'update', path, keys: Object.keys(plain), values: plain }); return update(r, plain); },
      set(value) { const plain = JSON.parse(JSON.stringify(value)); log.push({ op: 'set', path, value: plain }); return set(r, plain); },
      remove() { log.push({ op: 'remove', path }); return remove(r); },
    };
  };
  const database = () => ({ ref: refOf });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  return { database, apps: [{}] };
}

// One phone: a fresh page of the real scripts, signed in as `person`. A director's (role 'editor') asks for the list the way a camper-showing screen does
// (campersWant); a counselor's does the same and must get nothing.
async function phone(R, person, role) {
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const { ctx, sandbox } = makeContext({ camp });
  const writes = [];
  sandbox.firebase = compatFirebase(h.as(person), writes);
  const run = (code) => vm.runInContext(code, ctx);
  run(`window.scrollTo = () => {}; window.FIREBASE_CONFIG = { apiKey: 'test' };
       authUser = ${JSON.stringify({ email: person.email, emailVerified: true, displayName: 'Test' })};
       fbConnKnown = true; fbConnected = true; showToast = () => {};
       setMemberRole(${JSON.stringify(role)}); syncStarted = true;`);
  const p = { ctx, run, writes };
  p.until = async (code, why, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (run(code)) return; await sleep(25); }
    throw new Error('timed out waiting for ' + (why || code));
  };
  p.listen = async () => { run('campersWant(true)'); await p.until('campersMem.loaded === true', 'the first camper snapshot'); };
  p.stop = () => { try { run('campersWant(false); clearTimeout(setupPushTimer)'); } catch (e) { /* ignore */ } };
  return p;
}

const val = async (db, path) => (await get(ref(db, path))).val();
const jstr = (x) => JSON.stringify(x);

for (const R of ROOTS) {
  const ed = () => h.as(ED);
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const clean = () => h.seed((db) => set(ref(db, `${R}/campers`), null));
  const P = (p) => `${R}/campers${p ? '/' + p : ''}`;

  await s.t(`${R}: a director's phone attaches the real listener and reads the list; Add is ONE multi-path update of whole { name, ord } records the rules accept`, async () => {
    await clean();
    const d = await phone(R, ED, 'editor');
    await d.listen();
    if (d.run('campersStatus()') !== 'ok' || d.run('campersTotal()') !== 0) throw new Error('an empty node reads as an empty, loaded list');
    d.writes.length = 0;
    const r = await d.run(`campersAdd('t0', ['Maya', 'Eli', 'Ava R.', 'Ava R.'])`);
    if (!r.ok || r.added !== 4) throw new Error('add: ' + jstr(r));
    if (d.writes.length !== 1 || d.writes[0].op !== 'update' || d.writes[0].path !== `${R}/campers`) throw new Error('not ONE update at the camper node: ' + jstr(d.writes));
    const stored = await val(ed(), P('t0'));
    const ids = Object.keys(stored);
    if (ids.length !== 4 || !ids.every((id) => /^c-[a-z0-9]{10}$/.test(id))) throw new Error('ids: ' + ids.join());
    ids.forEach((id) => { if (Object.keys(stored[id]).sort().join() !== 'name,ord') throw new Error('a camper write is always { name, ord }: ' + jstr(stored[id])); });
    const sorted = ids.map((id) => stored[id]).sort((a, b) => a.ord - b.ord);
    if (sorted.map((c) => c.name).join('|') !== 'Maya|Eli|Ava R.|Ava R.' || sorted.map((c) => c.ord).join() !== '10,20,30,40') throw new Error('names / positions: ' + jstr(sorted));
    await d.until(`campersCount('t0') === 4`, 'the listener to read them back');
    if (jstr(d.run(`campersFor('t0').map((c) => c.name)`)) !== jstr(['Maya', 'Eli', 'Ava R.', 'Ava R.'])) throw new Error('read back');
    d.stop();
  });

  await s.t(`${R}: a name of exactly 40 characters, markup typed as a name, and 300 names in one update are all accepted; a 41st character is cut by the client, never refused by the rules`, async () => {
    await clean();
    const d = await phone(R, ED, 'editor');
    await d.listen();
    const forty = 'x'.repeat(40);
    const r1 = await d.run(`campersAdd('t1', [${jstr(forty)}, ${jstr('y'.repeat(55))}, '<img src=x onerror=alert(1)>'])`);
    if (!r1.ok) throw new Error('long and hostile names: ' + jstr(r1));
    const names = Object.values(await val(ed(), P('t1'))).map((c) => c.name).sort();
    if (!names.includes(forty) || !names.includes('y'.repeat(40)) || !names.includes('<img src=x onerror=alert(1)>')) throw new Error('names: ' + jstr(names));
    const many = Array.from({ length: 300 }, (_, i) => 'N' + i);
    const r2 = await d.run(`campersAdd('t0', ${jstr(many)})`);
    if (!r2.ok || r2.added !== 300) throw new Error('300 names: ' + jstr(r2));
    if (Object.keys(await val(ed(), P('t0'))).length !== 300) throw new Error('300 records');
    d.stop();
  });

  await s.t(`${R}: Rename writes one name leaf; Move is ONE update (delete here, create there, same id, a position at the end); Remove deletes; Undo puts the same record back — all accepted`, async () => {
    await clean();
    await h.seed((db) => set(ref(db, P('t0')), { 'c-aaaaaa0001': { name: 'Maya', ord: 10 }, 'c-aaaaaa0002': { name: 'Eli', ord: 20 } }));
    await h.seed((db) => set(ref(db, P('t1')), { 'c-bbbbbb0001': { name: 'Grace', ord: 10 } }));
    const d = await phone(R, ED, 'editor');
    await d.listen();
    d.writes.length = 0;
    let r = await d.run(`campersRename('t0', 'c-aaaaaa0001', 'Maya L.')`);
    if (!r.ok || d.writes.length !== 1 || d.writes[0].op !== 'set' || d.writes[0].path !== `${R}/campers/t0/c-aaaaaa0001/name`) throw new Error('rename: ' + jstr([r, d.writes]));
    d.writes.length = 0;
    r = await d.run(`campersMove('t0', 'c-aaaaaa0002', 't1', { name: 'Eli K.' })`);
    if (!r.ok || d.writes.length !== 1 || d.writes[0].op !== 'update') throw new Error('move: ' + jstr([r, d.writes]));
    if (jstr(Object.keys(d.writes[0].values).sort()) !== jstr(['t0/c-aaaaaa0002', 't1/c-aaaaaa0002'])) throw new Error('move paths: ' + jstr(d.writes[0].values));
    if (await val(ed(), P('t0/c-aaaaaa0002')) !== null) throw new Error('still on the old team');
    const moved = await val(ed(), P('t1/c-aaaaaa0002'));
    if (moved.name !== 'Eli K.' || moved.ord !== 20) throw new Error('moved record: ' + jstr(moved));
    await d.until(`campersFind('t1', 'c-aaaaaa0002') !== null`, 'the move to come back');
    d.writes.length = 0;
    r = await d.run(`campersRemove('t1', 'c-bbbbbb0001')`);
    if (!r.ok || d.writes[0].op !== 'remove') throw new Error('remove: ' + jstr(r));
    if (await val(ed(), P('t1/c-bbbbbb0001')) !== null) throw new Error('not removed');
    r = await d.run(`campersPut('t1', 'c-bbbbbb0001', { name: 'Grace', ord: 10 })`);
    if (!r.ok || jstr(await val(ed(), P('t1/c-bbbbbb0001'))) !== jstr({ name: 'Grace', ord: 10 })) throw new Error('undo: ' + jstr(r));
    d.stop();
  });

  await s.t(`${R}: a rename sent from a stale view of a camper another director moved is REFUSED by the rules (the anchor pair) and the client says so in words`, async () => {
    await clean();
    await h.seed((db) => set(ref(db, P('t0')), { 'c-aaaaaa0001': { name: 'Maya', ord: 10 } }));
    const d = await phone(R, ED, 'editor');
    await d.listen();
    // another director moves her; this phone's view is frozen as it was
    d.run(`campersMem.ref.off('value'); campersMem.ref = null;`);
    await h.seed(async (db) => { await set(ref(db, P('t0/c-aaaaaa0001')), null); await set(ref(db, P('t1/c-aaaaaa0001')), { name: 'Maya', ord: 10 }); });
    if (d.run(`campersFind('t0', 'c-aaaaaa0001') === null`)) throw new Error('the stale view should still hold her');
    const r = await d.run(`campersRename('t0', 'c-aaaaaa0001', 'Zombie')`);
    if (r.ok || r.reason !== 'refused') throw new Error('the rules should refuse a name into a deleted camper: ' + jstr(r));
    if (!/refused/.test(d.run(`campersWhy(${jstr(r)})`))) throw new Error('words');
    if (await val(ed(), P('t0')) !== null) throw new Error('a deleted camper was resurrected');
    if ((await val(ed(), P('t1/c-aaaaaa0001'))).name !== 'Maya') throw new Error('her new record was touched');
    d.stop();
  });

  await s.t(`${R}: names typed with no signal are held in memory — nothing sent, nothing in storage — and go in one update per team, accepted, the moment the connection is back`, async () => {
    await clean();
    const d = await phone(R, ED, 'editor');
    await d.listen();
    d.run('fbConnected = false');
    d.writes.length = 0;
    const a = await d.run(`campersAdd('t0', ['Held A', 'Held B'])`);
    const b = await d.run(`campersAdd('t1', ['Held C'])`);
    if (!a.ok || a.held !== 2 || b.held !== 1 || d.writes.length) throw new Error('held: ' + jstr([a, b, d.writes]));
    if (await val(ed(), P()) !== null) throw new Error('something reached the server while "offline"');
    const stored = d.run(`[...Array(localStorage.length).keys()].map((i) => localStorage.getItem(localStorage.key(i))).join('|')`);
    if (/Held [ABC]/.test(stored)) throw new Error('a held name reached storage');
    d.run('fbConnected = true; campersOnConnect()');
    await d.until('campersHeldCount() === 0', 'the held names to be sent');
    if (d.writes.filter((w) => w.op === 'update').length !== 2) throw new Error('one update per team: ' + jstr(d.writes));
    const t0 = Object.values(await val(ed(), P('t0'))).map((c) => c.name).sort().join();
    const t1 = Object.values(await val(ed(), P('t1'))).map((c) => c.name).join();
    if (t0 !== 'Held A,Held B' || t1 !== 'Held C') throw new Error('stored: ' + t0 + ' / ' + t1);
    d.stop();
  });

  await s.t(`${R}: a counselor's phone attaches nothing and writes nothing; the rules refuse the same reads and writes by hand; so does a director in a counselor preview`, async () => {
    await clean();
    await h.seed((db) => set(ref(db, P('t0')), { 'c-aaaaaa0001': { name: 'Maya', ord: 10 } }));
    const v = await phone(R, VW, 'viewer');
    v.run('campersWant(true)');
    if (v.run('campersMem.ref') !== null) throw new Error('a counselor attached the listener');
    await sleep(150);
    if (v.run('campersTotal()') !== 0 || jstr(v.run(`campersFor('t0')`)) !== '[]') throw new Error('a counselor read a name');
    const r = await v.run(`campersAdd('t0', ['Nope'])`);
    const r2 = await v.run(`campersRemove('t0', 'c-aaaaaa0001')`);
    if (r.reason !== 'readonly' || r2.reason !== 'readonly' || v.writes.length) throw new Error('a counselor wrote: ' + jstr([r, r2, v.writes]));
    for (const p of ['', 't0', 't0/c-aaaaaa0001', 't0/c-aaaaaa0001/name']) await assertFails(get(ref(h.as(VW), P(p))));
    await assertFails(set(ref(h.as(VW), P('t0/c-vwvwvw0001')), { name: 'Nope', ord: 1 }));
    await assertFails(set(ref(h.as(VW), P('t0/c-aaaaaa0001/name')), 'Nope'));
    v.stop();
    // a director previewing as a counselor: canEdit() is false, so the same phone reads and writes nothing
    const d = await phone(R, ED, 'editor');
    await d.listen();
    d.run('counselorPreviewOn = true');
    if (d.run('campersTotal()') !== 0) throw new Error('a preview read a name');
    d.writes.length = 0;
    const pr = await d.run(`campersAdd('t0', ['Nope'])`);
    if (pr.reason !== 'readonly' || d.writes.length) throw new Error('a preview wrote: ' + jstr([pr, d.writes]));
    d.stop();
  });

  await s.t(`${R}: a demotion drops the list and anything held from memory; the client wrote only under the camper node all along`, async () => {
    await clean();
    await h.seed((db) => set(ref(db, P('t0')), { 'c-aaaaaa0001': { name: 'Zyxwvu', ord: 10 } }));
    const d = await phone(R, ED, 'editor');
    await d.listen();
    d.run('fbConnected = false');
    await d.run(`campersAdd('t0', ['Quillon'])`);
    d.run(`setMemberRole('viewer')`);
    if (d.run('campersMem.loaded') !== false || d.run('campersHeldCount()') !== 0 || d.run('campersMem.ref') !== null) throw new Error('names still held after a demotion');
    if (/Zyxwvu|Quillon/.test(d.run('JSON.stringify({ m: campersMem, u: campersUi })'))) throw new Error('a name is still in memory');
    if (d.writes.some((w) => !(w.path === `${R}/campers` || w.path.startsWith(`${R}/campers/`)))) throw new Error('a write outside the camper node: ' + jstr(d.writes));
    d.stop();
  });
}
await h.done();
s.finish();
