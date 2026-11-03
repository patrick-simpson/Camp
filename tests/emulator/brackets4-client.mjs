// The REAL client's four-team bracket writes against the PUBLISHED rules (BUILD-PLAN Step 22, build sessions 1 and 2): the shipped scripts
// (tests/harness.js's vm and DOM stub, exactly as every unit test loads them) talk to the database emulator under database.rules.json
// through the same thin compat adapter the other *-client suites use. Nothing here is a copy of the client's logic: a director's phone starts a
// bracket, records the semifinals, the 3rd-place match and the final, takes one back, saves the result — and every write is judged by the real
// rules. brackets4.mjs proves the rules' side with hand-written values (a branch, never a scalar); this proves the CLIENT's own writes are what
// those rules accept, and what makes the per-match diff worth having:
//   - Start is ONE write of brackets4/<gid> (whole); a recorded match is ONE path, brackets4/<gid>/m/<match>, beside the data stamp; Undo is that
//     match's deletion; none of it is refused or parked;
//   - two directors on two phones record the two semifinals at once and BOTH land (a whole-bracket write would put the stale half of each back);
//   - Save Result is one multi-path update: results/<gid> (medals + the finished bracket as `path`) and brackets4/<gid>: null together, and a
//     counselor's phone reads the result and the winner;
//   - a semifinal changed from a stale phone after the 3rd-place match was played lands (last write wins for THAT match), every phone that adopts
//     it reads a RE-CHECK, no medal can be saved from it, and the director's Re-check answer is accepted and brings the bracket back in line;
//   - a counselor's phone: the client refuses (nothing is sent) and the rules refuse the same write by hand;
//   - on the junior camp (six teams) the client refuses to start one, with nothing sent.
// No rules change belongs to this step: state/brackets4 was published as a branch gate in R1, and results/<gid> is a branch too (so `path` is free).
// Mutation-check: weaken state/brackets4/.validate to refuse an object, or the editor write on state, and the director cases turn red.
import { createRequire } from 'module';
import vm from 'vm';
import { harness, suite, NEW_RULES, ROOTS, ED, ED2, VW, ref, get, set, update, onValue, assertFails, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const { makeContext } = require('../harness.js');

const s = suite('brackets4 — the real client\'s writes against the real rules');
const h = await harness('brackets4-client', NEW_RULES);
await h.members();

// firebase.database().ref(path) over a modular Database instance (values round-tripped through JSON so an object made in the page's vm realm is a
// plain object to the SDK). Every write is logged with its keys, so a case can say WHICH paths one push carried.
function compatFirebase(db, log) {
  const wrap = (snap) => ({ key: snap.key, val: () => snap.val(), exists: () => snap.exists(), child: (p) => wrap(snap.child(p)) });
  const unsubs = new Map();
  const refOf = (path) => {
    const r = ref(db, path);
    return {
      path,
      child: (p) => refOf(path + '/' + p),
      on(type, cb, errCb) { unsubs.set(cb, onValue(r, (snap) => cb(wrap(snap)), (e) => { if (errCb) errCb(e); })); return cb; },
      off(type, cb) { const u = unsubs.get(cb); if (u) { u(); unsubs.delete(cb); } },
      once() { return get(r).then(wrap); },
      update(values) {
        const plain = JSON.parse(JSON.stringify(values));
        log.push({ op: 'update', path, keys: Object.keys(plain), values: plain });
        return update(r, plain);
      },
      set(value) {
        const plain = JSON.parse(JSON.stringify(value));
        log.push({ op: 'set', path, keys: Object.keys(plain), values: plain });
        return set(r, plain);
      },
    };
  };
  const database = () => ({ ref: refOf });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  return { database };
}

const jstr = (x) => JSON.stringify(x);
const val = async (db, path) => (await get(ref(db, path))).val();

// One phone: a fresh page of the real scripts, signed in as `person` with `role`, its state ref the emulator, and what the first pull confirmed
// (`server`: the state node as the server holds it) adopted as its baseline.
async function phone(R, person, role, server) {
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const { ctx, sandbox } = makeContext({ camp });
  const writes = [];
  sandbox.firebase = compatFirebase(h.as(person), writes);
  const run = (code) => vm.runInContext(code, ctx);
  run(`state = makeFreshState(); migrateState(state); normalizeSyncedState();
       window.scrollTo = () => {};
       authUser = ${jstr({ email: person.email })};
       setMemberRole(${jstr(role)}); memberName = 'Jenn';
       state.teams = ${jstr(server.teams)};
       fbRef = firebase.database().ref(dbPath('state'));
       fbConnKnown = true; fbConnected = true; remoteReady = true; dataEditPending = false; remoteRefetchPending = false;
       applyRemoteState(${jstr(server)});                          // the first pull: the server's tree is the confirmed baseline
       clearTimeout(pushTimer); pushTimer = null;
       pushConfigured = () => false;
       showToast = () => {};
       celebrate = () => {};`);
  const p = { ctx, run, writes };
  p.until = async (code, why, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (run(code)) return; await sleep(25); }
    throw new Error('timed out waiting for ' + (why || code));
  };
  p.flush = async () => {
    run('flushPendingPush()');
    await p.until('pushTimer == null && pendingWrites === 0 && !dataEditPending && !stateBisecting', 'the push to be acknowledged');
  };
  // adopt what the server holds now (a snapshot landing on this phone)
  p.pull = (tree) => run(`applyRemoteState(${jstr(tree)})`);
  p.game = () => run(`gameById('legacy-game-d1')`) && 'legacy-game-d1';
  p.stop = () => { try { run('clearTimeout(pushTimer); clearTimeout(pushConfigTimer);'); } catch (e) { /* ignore */ } };
  return p;
}

const GID = 'legacy-game-d1';
const stateOf = async (R) => (await val(h.as(ED), `${R}/state`)) || {};

for (const R of ROOTS) {
  const ed = () => h.as(ED);
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  // The roster as every device holds it after the first push, and no leftovers from the last case.
  const seed = async () => {
    const { ctx } = makeContext({ camp });
    const teams = JSON.parse(vm.runInContext('JSON.stringify(makeFreshState().teams)', ctx));
    await h.seed(async (db) => {
      await set(ref(db, `${R}/state`), null);
      await set(ref(db, `${R}/state/teams`), teams);
    });
    return { teams };
  };

  if (camp === 'junior') {
    await s.t(`${R}: six teams cannot start a four-team bracket: the client refuses with the count, and sends nothing`, async () => {
      const server = await seed();
      const d = await phone(R, ED, 'editor', server);
      const r = d.run(`JSON.stringify(fourStartGame({ id: ${jstr(GID)} }, [['t0', 't1'], ['t2', 't3']]))`);
      const res = JSON.parse(r);
      if (res.ok || res.reason !== 'teams' || res.count !== 6) throw new Error(r);
      await sleep(150);
      if (d.writes.length) throw new Error('something was sent: ' + jstr(d.writes));
      if ((await stateOf(R)).brackets4) throw new Error('the server holds a bracket');
      d.stop();
    });
    continue;
  }

  const start = (d) => d.run(`JSON.stringify(fourStartGame(gameById(${jstr(GID)}), [['t0', 't3'], ['t1', 't2']]))`);
  const tap = (d, k, w) => d.run(`JSON.stringify(fourRecordTap(gameById(${jstr(GID)}), ${jstr(k)}, ${jstr(w)}))`);
  const paths = (d) => d.writes.flatMap((w) => w.keys);

  await s.t(`${R}: Start is one write of brackets4/<gid>; a recorded match is ONE path under it; Undo is that match's deletion; all accepted, nothing parked`, async () => {
    const server = await seed();
    const d = await phone(R, ED, 'editor', server);
    if (!JSON.parse(start(d)).ok) throw new Error('start refused');
    await d.flush();
    const b = await val(ed(), `${R}/state/brackets4/${GID}`);
    if (!b || !b.m || b.m.s1.a !== 't0' || b.m.s1.b !== 't3' || b.m.s2.a !== 't1' || b.m.s2.b !== 't2' || !(b.at > 0)) throw new Error('server bracket: ' + jstr(b));
    if (!d.writes[0].keys.includes('brackets4')) {
      if (!d.writes[0].keys.some((k) => k === `brackets4/${GID}`)) throw new Error('the bracket was not written as brackets4/<gid>: ' + jstr(d.writes[0].keys));
    }
    d.writes.length = 0;
    if (!JSON.parse(tap(d, 's1', 't0')).ok) throw new Error('s1 refused');
    await d.flush();
    const p1 = paths(d).filter((k) => k !== 'meta/lastDataChangeAt');
    if (p1.length !== 1 || p1[0] !== `brackets4/${GID}/m/s1`) throw new Error('a recorded match is one path: ' + jstr(p1));
    const s1 = await val(ed(), `${R}/state/brackets4/${GID}/m/s1`);
    if (s1.winner !== 't0' || s1.a !== 't0' || s1.b !== 't3' || !(s1.at > 0)) throw new Error('s1 on the server: ' + jstr(s1));
    tap(d, 's2', 't1'); tap(d, 'third', 't3');
    await d.flush();
    const third = await val(ed(), `${R}/state/brackets4/${GID}/m/third`);
    if (!third || third.winner !== 't3' || third.a !== 't3' || third.b !== 't2') throw new Error('third on the server (it keeps the two teams that played): ' + jstr(third));
    d.writes.length = 0;
    const u = JSON.parse(d.run(`JSON.stringify(fourUndoTap(gameById(${jstr(GID)})))`));
    if (!u.ok || u.match !== 'third') throw new Error('undo: ' + jstr(u));
    await d.flush();
    const p2 = paths(d).filter((k) => k !== 'meta/lastDataChangeAt');
    if (p2.length !== 1 || p2[0] !== `brackets4/${GID}/m/third`) throw new Error('Undo is the match\'s deletion: ' + jstr(p2));
    if ((await val(ed(), `${R}/state/brackets4/${GID}/m/third`)) !== null) throw new Error('the 3rd-place match is still on the server');
    if (d.run('Object.keys(stateQuarantine).length')) throw new Error('a write was refused and parked');
    d.stop();
  });

  await s.t(`${R}: two phones' writes to DIFFERENT matches of one bracket both land (one path per match); the SAME match from two phones is last-write-wins, nothing else moves`, async () => {
    const server = await seed();
    const a = await phone(R, ED, 'editor', server);
    start(a); tap(a, 's1', 't0');
    await a.flush();
    const base = await stateOf(R);           // Semifinal 1 recorded; the bracket is mid-way
    const p = await phone(R, ED, 'editor', base);
    const q = await phone(R, ED2, 'editor', base);
    p.writes.length = 0; q.writes.length = 0;
    tap(p, 's2', 't2');                      // phone p records Semifinal 2 ...
    // ... while phone q, from the same base, re-records Semifinal 1 the other way (what a stale screen's tap does): a different match path
    q.run(`state.brackets4[${jstr(GID)}].m.s1.winner = 't3'; state.brackets4[${jstr(GID)}].m.s1.at = Date.now(); touchData(); saveState();`);
    await Promise.all([p.flush(), q.flush()]);
    const m = await val(ed(), `${R}/state/brackets4/${GID}/m`);
    if (m.s2.winner !== 't2') throw new Error('phone p\'s Semifinal 2 was lost: ' + jstr(m));
    if (m.s1.winner !== 't3') throw new Error('phone q\'s Semifinal 1 was lost: ' + jstr(m));
    const pk = paths(p).filter((k) => k !== 'meta/lastDataChangeAt');
    const qk = paths(q).filter((k) => k !== 'meta/lastDataChangeAt');
    if (jstr(pk) !== jstr([`brackets4/${GID}/m/s2`]) || jstr(qk) !== jstr([`brackets4/${GID}/m/s1`])) throw new Error('each phone sent only its own match: ' + jstr([pk, qk]));
    // the same match from two phones, same base: one winner stands, and no other match was touched
    const server2 = await seed();
    const a2 = await phone(R, ED, 'editor', server2);
    start(a2); tap(a2, 's1', 't0');
    await a2.flush();
    const base2 = await stateOf(R);
    const r = await phone(R, ED, 'editor', base2);
    const t = await phone(R, ED2, 'editor', base2);
    tap(r, 's2', 't1'); tap(t, 's2', 't2');
    await Promise.all([r.flush(), t.flush()]);
    const m2 = await val(ed(), `${R}/state/brackets4/${GID}/m`);
    if (!['t1', 't2'].includes(m2.s2.winner) || m2.s1.winner !== 't0' || m2.third || m2.final) throw new Error('same-match race: ' + jstr(m2));
    [a, p, q, a2, r, t].forEach((x) => x.stop());
  });

  await s.t(`${R}: the whole flow — Save Result is ONE update with results/<gid> and brackets4/<gid>: null; a counselor reads the podium; medals fall out of the result`, async () => {
    const server = await seed();
    const d = await phone(R, ED, 'editor', server);
    start(d);
    ['s1:t3', 's2:t1', 'third:t0', 'final:t3'].forEach((st) => { const [k, w] = st.split(':'); if (!JSON.parse(tap(d, k, w)).ok) throw new Error(st + ' refused'); });
    await d.flush();
    const mid = await val(ed(), `${R}/state/brackets4/${GID}/m`);
    if (!mid || !mid.s1 || !mid.s2 || !mid.third || !mid.final || mid.final.winner !== 't3') throw new Error('the four matches were not on the server before Save Result: ' + jstr(mid));
    d.writes.length = 0;
    const r = JSON.parse(d.run(`JSON.stringify(fourSaveResult(gameById(${jstr(GID)})))`));
    if (!r.ok) throw new Error('save: ' + jstr(r));
    await d.flush();
    const one = d.writes.find((w) => w.keys.includes(`results/${GID}`));
    if (!one) throw new Error('no write carried the result: ' + jstr(d.writes.map((w) => w.keys)));
    if (!one.keys.includes(`brackets4/${GID}`) || one.values[`brackets4/${GID}`] !== null) throw new Error('the bracket\'s deletion was not in the SAME update: ' + jstr(one.keys));
    const res = await val(ed(), `${R}/state/results/${GID}`);
    if (!res || res.medals.gold !== 't3' || res.medals.silver !== 't1' || res.medals.bronze !== 't0') throw new Error('result: ' + jstr(res));
    if (!res.path || !res.path.m || res.path.m.final.winner !== 't3' || res.path.m.third.winner !== 't0') throw new Error('the finished bracket (path): ' + jstr(res.path));
    if ((await val(ed(), `${R}/state/brackets4/${GID}`)) !== null) throw new Error('the bracket is still on the server');
    // a counselor reads it
    const seen = await val(h.as(VW), `${R}/state/results/${GID}/medals/gold`);
    if (seen !== 't3') throw new Error('a counselor could not read the podium: ' + seen);
    // another director's phone adopts it and its own standings carry the medals
    const e = await phone(R, ED2, 'editor', await stateOf(R));
    const pts = JSON.parse(e.run('JSON.stringify(medalCounts())'));
    if (pts.t3.gold !== 1 || pts.t1.silver !== 1 || pts.t0.bronze !== 1 || pts.t2.points !== 0) throw new Error('medalCounts after adopting: ' + jstr(pts));
    if (d.run('Object.keys(stateQuarantine).length')) throw new Error('a write was refused and parked');
    // a late tap from a phone that had not heard yet: ignored in the client, nothing sent
    const late = await phone(R, ED2, 'editor', server);
    late.run(`state.brackets4 = ${jstr({ [GID]: { at: 1, m: { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } } } })}`);
    late.run(`state.results[${jstr(GID)}] = { medals: { gold: 't3', silver: 't1', bronze: 't0' }, savedAt: new Date().toISOString() }`);
    late.writes.length = 0;
    const lt = JSON.parse(tap(late, 's1', 't0'));
    if (lt.ok || lt.reason !== 'saved') throw new Error('a late tap was not ignored: ' + jstr(lt));
    await sleep(120);
    if (late.writes.length) throw new Error('a late tap sent something: ' + jstr(late.writes));
    [d, e, late].forEach((x) => x.stop());
  });

  await s.t(`${R}: a semifinal changed from a stale phone after the 3rd-place match: it lands, every phone reads a RE-CHECK, no medal can be saved, and Re-check settles it`, async () => {
    const server = await seed();
    const a = await phone(R, ED, 'editor', server);
    start(a);
    ['s1:t0', 's2:t1', 'third:t3'].forEach((st) => { const [k, w] = st.split(':'); tap(a, k, w); });
    await a.flush();
    // a stale phone (it still shows Semifinal 1 as undecided: its own local copy never heard) records Semifinal 1 the other way
    const stale = await phone(R, ED2, 'editor', server);
    stale.run(`state.brackets4 = ${jstr({ [GID]: { at: 1, m: { s1: { a: 't0', b: 't3' }, s2: { a: 't1', b: 't2' } } } })}; lastSyncedTree = syncedSnapshot();`);
    if (!JSON.parse(tap(stale, 's1', 't3')).ok) throw new Error('the stale phone could not record');
    await stale.flush();
    const m = await val(ed(), `${R}/state/brackets4/${GID}/m`);
    if (m.s1.winner !== 't3' || !m.third) throw new Error('the server after the stale write: ' + jstr(m));
    // a phone that now adopts the server tree reads a re-check
    const c = await phone(R, ED, 'editor', await stateOf(R));
    const phase = c.run(`fourPhase(state.brackets4[${jstr(GID)}], teamIds())`);
    if (phase !== 'recheck') throw new Error('phase: ' + phase);
    const rc = JSON.parse(c.run(`JSON.stringify(fourRead(state.brackets4[${jstr(GID)}], teamIds()).recheck)`));
    if (rc.semi !== 's1' || rc.now !== 't3' || rc.was !== 't0' || rc.match !== 'third') throw new Error('recheck: ' + jstr(rc));
    const noMedal = JSON.parse(c.run(`JSON.stringify(fourSaveResult(gameById(${jstr(GID)})))`));
    if (noMedal.ok) throw new Error('a medal was saved from a bracket that disagrees with itself');
    if ((await val(ed(), `${R}/state/results/${GID}`)) !== null) throw new Error('a result is on the server');
    c.writes.length = 0;
    const fix = JSON.parse(c.run(`JSON.stringify(fourResolveTap(gameById(${jstr(GID)}), 'back'))`));
    if (!fix.ok) throw new Error('Re-check refused: ' + jstr(fix));
    await c.flush();
    const after = await val(ed(), `${R}/state/brackets4/${GID}/m`);
    if (after.s1.winner !== 't0') throw new Error('Semifinal 1 was not put back: ' + jstr(after.s1));
    if (c.run(`fourPhase(state.brackets4[${jstr(GID)}], teamIds())`) !== 'final') throw new Error('the bracket carries on at the final');
    if (c.run('Object.keys(stateQuarantine).length')) throw new Error('a write was refused and parked');
    [a, stale, c].forEach((x) => x.stop());
  });

  await s.t(`${R}: Reopen the final is ONE update (the result deleted, the bracket back without its final), the final can be played again and saved; a stray left under a saved result is discarded with one deletion`, async () => {
    const server = await seed();
    const d = await phone(R, ED, 'editor', server);
    start(d);
    ['s1:t3', 's2:t1', 'third:t0', 'final:t3'].forEach((st) => { const [k, w] = st.split(':'); if (!JSON.parse(tap(d, k, w)).ok) throw new Error(st + ' refused'); });
    if (!JSON.parse(d.run(`JSON.stringify(fourSaveResult(gameById(${jstr(GID)})))`)).ok) throw new Error('save refused');
    await d.flush();
    if (d.run(`fourCanReopen(gameById(${jstr(GID)}))`) !== true) throw new Error('a saved four-team result cannot be reopened');
    d.writes.length = 0;
    const r = JSON.parse(d.run(`JSON.stringify(fourReopen(gameById(${jstr(GID)})))`));
    if (!r.ok) throw new Error('reopen: ' + jstr(r));
    await d.flush();
    const one = d.writes.find((w) => w.keys.includes(`results/${GID}`));
    if (!one || one.values[`results/${GID}`] !== null) throw new Error('the result was not deleted: ' + jstr(d.writes.map((w) => w.keys)));
    if (!one.keys.some((k) => k === `brackets4/${GID}` || k.startsWith(`brackets4/${GID}/`))) throw new Error('the bracket was not written in the SAME update: ' + jstr(one.keys));
    if ((await val(ed(), `${R}/state/results/${GID}`)) !== null) throw new Error('the result is still on the server');
    const m = await val(ed(), `${R}/state/brackets4/${GID}/m`);
    if (!m || !m.s1 || !m.s2 || !m.third || m.final || m.s1.winner !== 't3' || m.third.winner !== 't0') throw new Error('the reopened bracket: ' + jstr(m));
    if (d.run(`fourPhase(state.brackets4[${jstr(GID)}], teamIds())`) !== 'final') throw new Error('the bracket is not back at the final');
    if (d.run('Object.keys(stateQuarantine).length')) throw new Error('a write was refused and parked');
    // the other team wins the final this time, and the new result is saved
    if (!JSON.parse(tap(d, 'final', 't1')).ok) throw new Error('final refused');
    // (t1 is in the semifinal that t1 won: the final is the two semifinal winners, t3 and t1)
    if (!JSON.parse(d.run(`JSON.stringify(fourSaveResult(gameById(${jstr(GID)})))`)).ok) throw new Error('second save refused');
    await d.flush();
    const res = await val(ed(), `${R}/state/results/${GID}`);
    if (!res || res.medals.gold !== 't1' || res.medals.silver !== 't3' || res.medals.bronze !== 't0') throw new Error('the new result: ' + jstr(res));
    // a stray bracket under a saved result (a phone that had not heard yet): listed, and Discard is one deletion that leaves the result alone
    await set(ref(ed(), `${R}/state/brackets4/${GID}/m/final`), { a: 't3', b: 't1', winner: 't3', at: 9 });
    const e = await phone(R, ED2, 'editor', await stateOf(R));
    const notes = JSON.parse(e.run('JSON.stringify(bracketNotes())'));
    if (notes.late.length !== 1 || notes.late[0].id !== GID) throw new Error('bracketNotes: ' + jstr(notes));
    e.writes.length = 0;
    if (!JSON.parse(e.run(`JSON.stringify(discardLateBracket(${jstr(GID)}))`)).ok) throw new Error('discard refused');
    await e.flush();
    const sent = e.writes.flatMap((w) => w.keys).filter((k) => k !== 'meta/lastDataChangeAt');
    if (sent.some((k) => k.startsWith('results'))) throw new Error('Discard touched the result: ' + jstr(sent));
    if ((await val(ed(), `${R}/state/brackets4/${GID}`)) !== null) throw new Error('the stray is still on the server');
    if (!(await val(ed(), `${R}/state/results/${GID}/medals`))) throw new Error('the result went with it');
    if (e.run('Object.keys(stateQuarantine).length')) throw new Error('a write was refused and parked');
    // and a counselor's phone cannot reopen or discard
    const v = await phone(R, VW, 'viewer', await stateOf(R));
    v.writes.length = 0;
    const vr = JSON.parse(v.run(`JSON.stringify([fourReopen(gameById(${jstr(GID)})), discardLateBracket(${jstr(GID)})])`));
    if (vr[0].ok || vr[1].ok) throw new Error('a counselor reopened or discarded: ' + jstr(vr));
    await sleep(120);
    if (v.writes.length) throw new Error('a counselor\'s phone sent something: ' + jstr(v.writes));
    [d, e, v].forEach((x) => x.stop());
  });

  await s.t(`${R}: a counselor's phone: the client refuses (nothing is sent) and the rules refuse the same writes by hand`, async () => {
    const server = await seed();
    const a = await phone(R, ED, 'editor', server);
    start(a);
    await a.flush();
    const v = await phone(R, VW, 'viewer', await stateOf(R));
    v.writes.length = 0;
    const r1 = JSON.parse(tap(v, 's1', 't0'));
    const r2 = JSON.parse(v.run(`JSON.stringify(fourStartGame(gameById('other-game'), [['t0', 't3'], ['t1', 't2']]))`));
    if (r1.ok || r1.reason !== 'readonly' || r2.ok || r2.reason !== 'readonly') throw new Error(jstr([r1, r2]));
    await sleep(120);
    if (v.writes.length) throw new Error('a counselor\'s phone sent something: ' + jstr(v.writes));
    await assertFails(set(ref(h.as(VW), `${R}/state/brackets4/${GID}/m/s1/winner`), 't0'));
    await assertFails(set(ref(h.as(VW), `${R}/state/brackets4/other-game`), { at: 1, m: {} }));
    if ((await val(ed(), `${R}/state/brackets4/${GID}/m/s1/winner`)) !== null) throw new Error('the server changed');
    [a, v].forEach((x) => x.stop());
  });
}

s.finish();
