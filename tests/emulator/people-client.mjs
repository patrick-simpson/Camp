// The REAL client's People and Ask-to-join writes against the PUBLISHED rules (BUILD-PLAN Step 25, session 2): the shipped scripts (tests/harness.js's
// vm and DOM stub, as every unit test loads them) talk to the database emulator under database.rules.json through the same thin compat adapter the
// other *-client suites use. Nothing here is a copy of the client's logic. A walk-up's phone asks to join (refused while asking is closed, in words;
// accepted once a director's phone has switched it on through the real setup commit), a director's phone sees the request through its real editor-only
// query, lets the person in, and the walk-up's own page finds the new member record by polling; Link, Not now and Block follow the order the rules
// need; a blocked identity is refused with the very same words; the requester withdraws after the rules' minute; Put people on teams writes one row at
// a time; Add people is one multi-path update; a counselor's phone and the owner row write nothing. access-requests.mjs proves the rules' side with
// hand-written values; this proves the client's own writes are what those rules accept.
// No rules change belongs to this step: accessRequests, accessBlocked and setup/meta/joinOpen were published in R1.
import { createRequire } from 'module';
import vm from 'vm';
import { query, orderByChild, limitToLast, runTransaction, remove } from 'firebase/database';
import { harness, suite, NEW_RULES, ROOTS, ED, VW, OWNER, ref, get, set, update, onValue, assertFails, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const { makeContext } = require('../harness.js');

const s = suite('people — the real client\'s writes against the real rules');
const h = await harness('people-client', NEW_RULES);
await h.members();

const WALK = { email: 'taylor.reed@gmail.com', key: 'taylor,reed@gmail,com' };
const OTHER_WALK = { email: 'quinn.moss@gmail.com', key: 'quinn,moss@gmail,com' };

// firebase.database().ref(path) over a modular Database instance (values round-tripped through JSON so an object made in the page's vm realm is a
// plain object to the SDK). Adds what People needs beyond the other suites' adapter: remove, transaction, and the requests query.
function compatFirebase(db, log) {
  const wrap = (snap) => ({
    key: snap.key, val: () => snap.val(), exists: () => snap.exists(), child: (p) => wrap(snap.child(p)),
    forEach: (fn) => { snap.forEach((c) => fn(wrap(c))); },
  });
  const unsubs = new Map();
  const queryOf = (path, r) => ({
    on(type, cb, errCb) { unsubs.set(cb, onValue(r, (snap) => cb(wrap(snap)), (e) => { if (errCb) errCb(e); })); return cb; },
    off(type, cb) { const u = unsubs.get(cb); if (u) { u(); unsubs.delete(cb); } },
    once() { return get(r).then(wrap); },
    orderByChild: (f) => queryOf(path, query(ref(db, path), orderByChild(f))),
    limitToLast: (n) => queryOf(path, query(r, limitToLast(n))),
  });
  const refOf = (path) => {
    const r = ref(db, path);
    const q = queryOf(path, r);
    return Object.assign(q, {
      path,
      child: (p) => refOf(path + '/' + p),
      update(values) { const plain = JSON.parse(JSON.stringify(values)); log.push({ op: 'update', path, keys: Object.keys(plain) }); return update(r, plain); },
      set(value) { const plain = JSON.parse(JSON.stringify(value)); log.push({ op: 'set', path, keys: Object.keys(plain) }); return set(r, plain); },
      remove() { log.push({ op: 'remove', path }); return remove(r); },
      transaction(fn) { log.push({ op: 'transaction', path }); return runTransaction(r, (cur) => fn(cur === undefined ? null : cur)).then((res) => ({ committed: res.committed, snapshot: wrap(res.snapshot) })); },
    });
  };
  const database = () => ({ ref: refOf });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  return { database, apps: [{}] };
}

// One phone: a fresh page of the real scripts, signed in as `person`. A director's (role 'editor') has the real setup listener and requests query running
// against the emulator; a counselor's has neither; a walk-up's has no role at all (the denied screen).
async function phone(R, person, role) {
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const { ctx, sandbox } = makeContext({ camp });
  const writes = [];
  sandbox.firebase = compatFirebase(h.as(person), writes);
  const run = (code) => vm.runInContext(code, ctx);
  run(`window.scrollTo = () => {}; window.FIREBASE_CONFIG = { apiKey: 'test' };
       authUser = ${JSON.stringify({ email: person.email, emailVerified: true, displayName: 'Taylor Reed' })};
       fbConnKnown = true; fbConnected = true; showToast = () => {};
       ${role ? `setMemberRole(${JSON.stringify(role)}); syncStarted = true;` : 'setMemberRole(null);'}`);
  const p = { ctx, run, writes };
  p.until = async (code, why, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (run(code)) return; await sleep(25); }
    throw new Error('timed out waiting for ' + (why || code));
  };
  p.directory = async () => {
    const dir = (await get(ref(h.as(ED), `${R}/members`))).val() || {};
    run(`memberDirectory = ${JSON.stringify(dir)}; memberDirectoryLoaded = true;`);
  };
  p.listen = async () => {
    run('initSetupSync(); peopleRequestsAttach();');
    await p.until('setupReady === true', 'the first setup snapshot');
    await p.until('pplReq.loaded === true', 'the first request snapshot');
  };
  p.stop = () => { try { run('askToJoinStop(); peopleRequestsDetach(); clearTimeout(setupPushTimer);'); } catch (e) { /* ignore */ } };
  return p;
}

const val = async (db, path) => (await get(ref(db, path))).val();

for (const R of ROOTS) {
  const ed = () => h.as(ED);
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const cleanSlate = async () => {
    await h.seed(async (db) => {
      await set(ref(db, `${R}/accessRequests`), null);
      await set(ref(db, `${R}/accessBlocked`), null);
      await set(ref(db, `${R}/setup`), null);
      await set(ref(db, `${R}/members/${WALK.key}`), null);
      await set(ref(db, `${R}/members/${OTHER_WALK.key}`), null);
      await set(ref(db, `${R}/members/pending-taylor-ab12c`), { role: 'viewer', name: 'Taylor', teamId: 't0', addedBy: 'seed', addedAt: '2026-11-02' });
      await set(ref(db, `${R}/members/pending-boss-qq1w2`), { role: 'editor', name: 'Taylor Boss', teamId: 't1', addedBy: 'seed', addedAt: '2026-11-02' });
    });
  };
  const switchAsking = async (on) => {
    const d = await phone(R, ED, 'editor');
    await d.listen();
    const r = d.run(`peopleSetAsking(${on})`);
    if (!r.ok) throw new Error('the switch was refused in the client: ' + JSON.stringify(r));
    d.run('flushSetupPush()');
    await d.until('setupPending === 0 && !setupPushTimer', 'the switch to be acknowledged');
    d.stop();
  };

  await s.t(`${R}: closed → the walk-up's ask is refused and said in the closed words; the director switches asking on through the real setup commit; the same phone's second try is accepted`, async () => {
    await cleanSlate();
    const w = await phone(R, WALK, null);
    w.run(`askToJoinStart()`);
    await w.until('ask.ready === true', 'the own-row read to be allowed');
    w.run(`askEl('ask-name').value = 'Taylor Reed'; askEl('ask-note').value = "I'm with the Foxes"; askSend();`);
    await w.until('ask.closed === true', 'the refusal');
    const words = w.run(`askEl('ask-closed-text').textContent`);
    if (!/^Asking to join isn’t open right now\. Tell a director your email \(taylor\.reed@gmail\.com\) and they’ll add you\.$/.test(words)) throw new Error('closed words: ' + words);
    if (await val(ed(), `${R}/accessRequests/${WALK.key}`) !== null) throw new Error('a row landed while closed');
    await switchAsking(true);
    if (await val(ed(), `${R}/setup/meta/joinOpen`) !== true) throw new Error('joinOpen is not true on the server');
    w.run(`ask.closed = false; askPaint(); askSend();`);
    await w.until(`ask.rows[CAMP.id] && ask.rows[CAMP.id].at > 0`, 'the request to be read back');
    const row = await val(ed(), `${R}/accessRequests/${WALK.key}`);
    if (!row || row.name !== 'Taylor Reed' || row.note !== "I'm with the Foxes" || typeof row.at !== 'number' || Object.keys(row).length !== 3) throw new Error('row: ' + JSON.stringify(row));
    if (w.writes.filter((x) => x.op === 'set').length !== 2) throw new Error('the walk-up wrote exactly two sets (refused, then accepted): ' + JSON.stringify(w.writes));
    w.stop();
  });

  await s.t(`${R}: a director's phone sees it through the real editor-only query; a counselor's phone attaches nothing and the rules refuse its read`, async () => {
    const d = await phone(R, ED, 'editor');
    await d.listen();
    await d.until(`peopleRequests().length === 1`, 'the request to arrive');
    const seen = JSON.parse(d.run(`JSON.stringify(peopleRequests())`));
    if (seen[0].key !== WALK.key || seen[0].name !== 'Taylor Reed' || seen[0].note !== "I'm with the Foxes") throw new Error('seen: ' + JSON.stringify(seen));
    d.stop();
    const v = await phone(R, VW, 'viewer');
    v.run('peopleRequestsAttach()');
    if (v.run('pplReq.ref') !== null) throw new Error('a counselor attached the listener');
    await assertFails(get(ref(h.as(VW), `${R}/accessRequests`)));
    v.stop();
  });

  await s.t(`${R}: Let in creates the member, then deletes the request; the walk-up's own poll finds the record and opens the camp by itself`, async () => {
    const d = await phone(R, ED, 'editor');
    await d.directory();
    await d.listen();
    const res = await d.run(`peopleLetIn(peopleRequests()[0], { name: 'Taylor R.', role: 'viewer', teamId: 't0' })`);
    if (!res.ok) throw new Error('let in: ' + JSON.stringify(res));
    const rec = await val(ed(), `${R}/members/${WALK.key}`);
    if (!rec || rec.role !== 'viewer' || rec.name !== 'Taylor R.' || rec.teamId !== 't0') throw new Error('record: ' + JSON.stringify(rec));
    if (await val(ed(), `${R}/accessRequests/${WALK.key}`) !== null) throw new Error('the request is still there');
    d.stop();
    // the walk-up's page: its request row is gone with the approval, so it polls the camp it asked (the page remembered the row it sent)
    const w = await phone(R, WALK, null);
    w.run(`askToJoinStart(); ask.ready = true; ask.rows[CAMP.id] = { name: 'Taylor Reed', at: Date.now() - 1000 }; askPoll(true);`);
    await w.until('__reloads === 1', 'the page to reload itself');
    if (w.run('localStorage.getItem(ACTIVE_CAMP_KEY)') !== camp) throw new Error('the camp was not made the active one');
    w.stop();
  });

  await s.t(`${R}: Block writes accessBlocked first, then deletes the request; a blocked identity is refused the very same way; unblocking lets them ask again`, async () => {
    await cleanSlate();
    await h.seed((db) => set(ref(db, `${R}/setup/meta/joinOpen`), true));
    await h.seed((db) => set(ref(db, `${R}/accessRequests/${OTHER_WALK.key}`), { name: 'Quinn Moss', at: Date.now() - 1000 }));
    const d = await phone(R, ED, 'editor');
    await d.directory();
    await d.listen();
    const res = await d.run(`peopleBlock(peopleRequests().find((r) => r.key === ${JSON.stringify(OTHER_WALK.key)}))`);
    if (!res.ok) throw new Error('block: ' + JSON.stringify(res));
    const b = await val(ed(), `${R}/accessBlocked/${OTHER_WALK.key}`);
    if (!b || b.byKey !== ED.key || typeof b.at !== 'number') throw new Error('block record: ' + JSON.stringify(b));
    if (await val(ed(), `${R}/accessRequests/${OTHER_WALK.key}`) !== null) throw new Error('the request is still listed');
    const list = await d.run('peopleLoadBlocked()');
    if (list.status !== 'ok' || list.rows.length !== 1) throw new Error('blocked list: ' + JSON.stringify(list));
    const q = await phone(R, OTHER_WALK, null);
    q.run(`askToJoinStart()`);
    await q.until('ask.ready === true', 'the own-row read');
    q.run(`askEl('ask-name').value = 'Quinn Moss'; askSend();`);
    await q.until('ask.closed === true', 'the refusal');
    const words = q.run(`askEl('ask-closed-text').textContent`);
    if (!/^Asking to join isn’t open right now\./.test(words)) throw new Error('words: ' + words);
    const un = await d.run(`peopleUnblock(${JSON.stringify(OTHER_WALK.key)})`);
    if (!un.ok) throw new Error('unblock: ' + JSON.stringify(un));
    q.run(`ask.closed = false; askPaint(); askSend();`);
    await q.until(`ask.rows[CAMP.id] && ask.rows[CAMP.id].at > 0`, 'the request after the unblock');
    q.stop(); d.stop();
  });

  await s.t(`${R}: Link moves a pending row to the requester's key (create, delete, then the request); a Director row needs the typed address; Not now deletes`, async () => {
    await cleanSlate();
    await h.seed((db) => set(ref(db, `${R}/setup/meta/joinOpen`), true));
    await h.seed((db) => set(ref(db, `${R}/accessRequests/${WALK.key}`), { name: 'Taylor Reed', note: "I'm with the Foxes", at: Date.now() - 1000 }));
    const d = await phone(R, ED, 'editor');
    await d.directory();
    await d.listen();
    const bad = await d.run(`peopleLink(peopleRequests()[0], 'pending-boss-qq1w2', {})`);
    if (bad.ok || bad.reason !== 'confirm') throw new Error('a Director row linked without the typed address: ' + JSON.stringify(bad));
    if (await val(ed(), `${R}/members/${WALK.key}`) !== null) throw new Error('something was written');
    const ok = await d.run(`peopleLink(peopleRequests()[0], 'pending-taylor-ab12c', {})`);
    if (!ok.ok) throw new Error('link: ' + JSON.stringify(ok));
    const rec = await val(ed(), `${R}/members/${WALK.key}`);
    if (!rec || rec.name !== 'Taylor' || rec.teamId !== 't0' || rec.role !== 'viewer') throw new Error('linked record: ' + JSON.stringify(rec));
    if (await val(ed(), `${R}/members/pending-taylor-ab12c`) !== null || await val(ed(), `${R}/accessRequests/${WALK.key}`) !== null) throw new Error('the pending row or the request is still there');
    await h.seed((db) => set(ref(db, `${R}/accessRequests/${OTHER_WALK.key}`), { name: 'Quinn Moss', at: Date.now() - 1000 }));
    await d.until(`peopleRequests().some((r) => r.key === ${JSON.stringify(OTHER_WALK.key)})`, 'the second request');
    const nn = await d.run(`peopleNotNow(peopleRequests().find((r) => r.key === ${JSON.stringify(OTHER_WALK.key)}))`);
    if (!nn.ok || await val(ed(), `${R}/accessRequests/${OTHER_WALK.key}`) !== null) throw new Error('not now: ' + JSON.stringify(nn));
    d.stop();
  });

  await s.t(`${R}: the requester withdraws after the rules' minute (a young row is refused, in words) and can ask again at once`, async () => {
    await cleanSlate();
    await h.seed((db) => set(ref(db, `${R}/setup/meta/joinOpen`), true));
    const w = await phone(R, WALK, null);
    w.run(`askToJoinStart()`);
    await w.until('ask.ready === true', 'the own-row read');
    w.run(`askEl('ask-name').value = 'Taylor Reed'; askSend();`);
    await w.until(`ask.rows[CAMP.id] && ask.rows[CAMP.id].at > 0`, 'the request');
    w.run(`askWithdraw()`);
    await w.until(`!ask.busy && askEl('ask-error').hidden === false`, 'the young delete to be refused');
    if (!/a minute after/.test(w.run(`askEl('ask-error').textContent`))) throw new Error('words');
    if (await val(ed(), `${R}/accessRequests/${WALK.key}`) === null) throw new Error('a young row was deleted');
    await h.seed((db) => set(ref(db, `${R}/accessRequests/${WALK.key}/at`), Date.now() - 61000));
    w.run(`askWithdraw()`);
    await w.until(`ask.rows[CAMP.id] === null`, 'the delete');
    if (await val(ed(), `${R}/accessRequests/${WALK.key}`) !== null) throw new Error('the row is still there');
    w.run(`askEl('ask-error').hidden = true; askSend();`);
    await w.until(`ask.rows[CAMP.id] && ask.rows[CAMP.id].at > 0`, 'the request again');
    w.stop();
  });

  await s.t(`${R}: Put people on teams writes one row at a time; Add people is one multi-path update of pending rows; every write accepted`, async () => {
    await cleanSlate();
    const d = await phone(R, ED, 'editor');
    await d.directory();
    d.run(`state.teams = ${JSON.stringify((await val(ed(), `${R}/state/teams`)) || JSON.parse(vm.runInContext('JSON.stringify(makeFreshState().teams)', d.ctx)))}`);
    const t = await d.run(`peopleSaveTeams([{ key: 'pending-taylor-ab12c', name: 'Taylor', teamId: 't1' }, { key: ${JSON.stringify(VW.key)}, name: 'Vw', teamId: 't0' }, { key: 'pending-boss-qq1w2', name: 'Boss', teamId: '' }])`);
    if (!t.ok || t.saved !== 3) throw new Error('teams: ' + JSON.stringify(t));
    if ((await val(ed(), `${R}/members/pending-taylor-ab12c/teamId`)) !== 't1' || (await val(ed(), `${R}/members/${VW.key}/teamId`)) !== 't0') throw new Error('team leaves');
    if ((await val(ed(), `${R}/members/pending-boss-qq1w2/teamId`)) !== null) throw new Error('a cleared team is a removal');
    d.writes.length = 0;
    const parsed = `peopleParseLines('Cam, Foxes\\nQuinn\\nVw, Maples', peopleRows(memberDirectory), state.teams)`;
    const a = await d.run(`peopleAddLines(${parsed}, 'viewer')`);
    if (!a.ok || a.added !== 2) throw new Error('add lines: ' + JSON.stringify(a));
    if (d.writes.filter((x) => x.op === 'update').length !== 1) throw new Error('not ONE update: ' + JSON.stringify(d.writes));
    const dir = await val(ed(), `${R}/members`);
    const cam = Object.keys(dir).find((k) => dir[k].name === 'Cam');
    if (!cam || !/^pending-cam-/.test(cam) || dir[cam].role !== 'viewer') throw new Error('Cam: ' + JSON.stringify(dir[cam]));
    d.stop();
  });

  await s.t(`${R}: a counselor's phone and the owner row: the client writes nothing, and the same writes by hand are refused`, async () => {
    const v = await phone(R, VW, 'viewer');
    await v.directory();
    const r1 = await v.run(`peopleSaveTeams([{ key: ${JSON.stringify(VW.key)}, name: 'Vw', teamId: 't2' }])`);
    const r2 = v.run(`peopleSetAsking(true)`);
    if (r1.reason !== 'readonly' || r2.reason !== 'readonly' || v.writes.length) throw new Error('a counselor wrote: ' + JSON.stringify([r1, r2, v.writes]));
    await assertFails(set(ref(h.as(VW), `${R}/members/${VW.key}/teamId`), 't2'));
    await assertFails(set(ref(h.as(VW), `${R}/setup/meta/joinOpen`), true));
    const d = await phone(R, ED, 'editor');
    await d.directory();
    const o = await d.run(`peopleSavePerson(OWNER_MEMBER_KEY, { teamId: 't0' })`);
    if (o.reason !== 'owner' || d.writes.length) throw new Error('the owner row was touched: ' + JSON.stringify([o, d.writes]));
    await assertFails(set(ref(h.as(ED), `${R}/members/${OWNER.key}/teamId`), 't0'));
    v.stop(); d.stop();
  });

  await s.t(`${R}: a director of both camps hears about the other camp's waiting requests once; the Blocked list is one read`, async () => {
    const other = ROOTS.find((x) => x !== R);
    await h.seed((db) => set(ref(db, `${other}/accessRequests/${OTHER_WALK.key}`), { name: 'Quinn Moss', at: Date.now() - 1000 }));
    const d = await phone(R, ED, 'editor');
    d.run(`var __heard = []; onOtherCampRequests = (n) => __heard.push(n);`);
    await d.listen();
    // the first time this device meets the second camp its role is known only AFTER the listener attached (probeOtherCamp): the probe it sets off must still count
    await d.until('pplReq.other.probed === false && pplReq.loaded === true', 'the listener with the other camp unknown');
    d.run(`otherCampProbed = false; probeOtherCamp();`);
    await d.until('otherCampRole === "editor"', 'the other camp\'s role');
    await d.until(`__heard.length === 1`, 'the other camp\'s count');
    if (d.run(`__heard[0]`) !== 1) throw new Error('count');
    d.stop();
    await h.seed((db) => set(ref(db, `${other}/accessRequests`), null));
  });
}
await h.done();
s.finish();
