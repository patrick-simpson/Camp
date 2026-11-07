// The REAL client's new-year wizard against the PUBLISHED rules (BUILD-PLAN Step 28, build session 1). The shipped scripts (tests/harness.js's vm and
// DOM stub, a camp whose every section is edited here, as the seeded unit tests load it) talk to the database emulator under database.rules.json
// through the same thin compat adapter the other *-client suites use. Nothing here is a copy of the client's logic:
//   - the OWNER's phone starts the wizard (the claim is a transaction on setup/meta/wizard), picks a date, saves last year (a pre-wizard point and a
//     pinned archive point, read back), and presses the clear: ONE atomic multi-path update at the camp root, carrying the epoch pair, the scoreboard,
//     the week's settings, campers, both reveal nodes and every open request — every path accepted, nothing of members/* in it. Then Undo the new-year
//     setup, one more atomic update: the scores, the legacy epoch (deleted) and the week's dates are back. Both camps. The rules judge every write.
//   - a NON-OWNER DIRECTOR and a COUNSELOR: the client itself refuses (nothing is sent), and the exact payloads the owner's phone sent — the claim, the
//     archive and pre-wizard points, the clear, the undo — are replayed by hand from their connections: each is refused, and the clear and the undo are
//     refused AS A WHOLE (the camp is byte-for-byte what it was). One owner-only path in an update takes the rest of it with it.
//   - the counselors' teams follow the clear as per-member updates (the owner row skipped); a hand-seeded member row with no addedBy is refused on its own
//     and listed, and takes nothing else with it.
// No rules change belongs to this step. Mutation-check: weaken `setup/meta/wizard`'s OWNER clauses, or `state/meta/epoch`'s, and the non-owner cases go red.
import { createRequire } from 'module';
import vm from 'vm';
import { onValue, query, orderByChild, limitToLast } from 'firebase/database';
import { harness, suite, NEW_RULES, ROOTS, OWNER, ED, ED2, VW, ref, get, set, update, runTransaction, assertFails, sleep, startPayload, outcome } from './lib.mjs';

const require = createRequire(import.meta.url);
const { makeContext } = require('../harness.js');

const s = suite('wizard — the real client\'s new-year setup against the real rules');
const h = await harness('wizard-client', NEW_RULES);
const BROKEN = 'broken@x,com';
await h.members({ [BROKEN]: { role: 'viewer', name: 'Broken', teamId: 't0' } }); // hand-seeded: no addedBy / addedAt

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
      update(values) { const plain = JSON.parse(JSON.stringify(values)); log.push({ op: 'update', path, values: plain }); return update(r, plain); },
      set(value) { const plain = JSON.parse(JSON.stringify(value)); log.push({ op: 'set', path, value: plain }); return set(r, plain); },
      transaction(fn) {
        log.push({ op: 'transaction', path });
        return runTransaction(r, (cur) => {
          const v = fn(cur === undefined ? null : cur);
          if (v !== undefined) log.push({ op: 'transaction-value', path, value: JSON.parse(JSON.stringify(v)) });
          return v;
        }, { applyLocally: false }).then((res) => ({ committed: res.committed, snapshot: wrap(res.snapshot) }));
      },
    });
  };
  const database = () => ({ ref: refOf });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  return { database, apps: [{}] };
}

const jstr = (x) => JSON.stringify(x);
const val = async (db, path) => (await get(ref(db, path))).val();
const fail = (m) => { throw new Error(m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function phone(R, person, role) {
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const { ctx, sandbox } = makeContext({ camp, seeded: 'all' });
  const writes = [];
  sandbox.firebase = compatFirebase(h.as(person), writes);
  const run = (code) => vm.runInContext(code, ctx);
  run(`window.scrollTo = () => {}; window.FIREBASE_CONFIG = { apiKey: 'test' };
       var __toasts = []; showToast = (m) => { __toasts.push(String(m)); };
       authUser = ${jstr({ email: person.email, emailVerified: true, displayName: 'Test' })};
       fbConnKnown = true; fbConnected = true; rpWaitMs = 6000;
       memberDirectory = { ${jstr(OWNER.key)}: { role: 'editor', name: 'Patrick' } }; memberDirectoryLoaded = true;
       setMemberRole(${jstr(role)}); syncStarted = true;`);
  const p = { ctx, run, writes };
  p.until = async (code, why, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (run(code)) return; await sleep(25); }
    throw new Error('timed out waiting for ' + (why || code));
  };
  // last year's data on the phone (the same JSON goes to the server): scored games, a bonus, a posted notice, a counselor typed on a team
  p.arrange = () => run(`(function () {
    const g = allGames();
    state.results = { [g[0].id]: { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 1 }, [g[1].id]: { medals: { gold: 't1', silver: 't0', bronze: 't2' }, savedAt: 2 } };
    state.bonuses = { b1: { teamId: 't1', category: 'custom', label: 'Spirit', points: 5, at: '2026-07-23T22:00:00.000Z' } };
    state.announcements = {};
    state.notice = Object.assign({}, state.notice, { status: 'posted', title: 'Cleanup', intro: 'Go' });
    state.teams[0].counselor = 'Last Year Lee';
    state.meta.lastDataChangeAt = '2026-07-24T20:00:00.000Z';
  })()`);
  p.snapshot = () => ({ state: JSON.parse(run('JSON.stringify(syncedSnapshot())')), config: JSON.parse(run('JSON.stringify(configForSync(state.config))')), setup: JSON.parse(run('JSON.stringify(setupCanon(setupTree))')) });
  p.attach = async () => {
    run(`fbRef = firebase.database().ref(dbPath('state')); fbConfigRef = firebase.database().ref(dbPath('config')); setupRef = firebase.database().ref(dbPath('setup'));
         fbRef.on('value', (snap) => handleRemoteSnapshot(snap.val())); attachConfigListener(); attachSetupListener();`);
    await p.until('remoteReady && configReady && setupReady', 'all three engines to pass their first pull');
    await sleep(150);
  };
  p.stop = () => { try { run('clearTimeout(pushTimer); clearTimeout(pushConfigTimer); clearTimeout(setupPushTimer); clearTimeout(wizardAnswersTimer)'); } catch (e) { /* ignore */ } };
  return p;
}

// What the camp holds, as one comparable string (the members and everything else, whole): the owner's view.
// (the root itself is nobody's to read: rules grant per child)
const CAMP_NODES = ['state', 'config', 'setup', 'members', 'campers', 'accessRequests', 'revealPublic', 'revealFull', 'restoreIndex', 'restoreBody'];
const wholeCamp = async (R) => jstr(await Promise.all(CAMP_NODES.map((k) => val(h.as(OWNER), `${R}/${k}`))));
const wholeDiff = async (R, before) => { const now = JSON.parse(await wholeCamp(R)); const was = JSON.parse(before); return CAMP_NODES.filter((k, i) => jstr(now[i]) !== jstr(was[i])).join(','); };

for (const R of ROOTS) {
  const owner = () => h.as(OWNER);
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const seedServer = async (p) => {
    const snap = p.snapshot();
    await h.seed(async (db) => {
      for (const k of ['state', 'config', 'setup', 'restoreIndex', 'restoreBody', 'campers', 'accessRequests', 'revealPublic', 'revealFull', 'editorsHere']) await set(ref(db, `${R}/${k}`), null);
      await set(ref(db, `${R}/state`), snap.state);
      await set(ref(db, `${R}/config`), snap.config);
      await set(ref(db, `${R}/setup`), snap.setup);
      await set(ref(db, `${R}/campers`), { t0: { 'c-aaaaaa0001': { name: 'Kid', ord: 10 } } });
      await set(ref(db, `${R}/accessRequests`), { 'new@x,com': { name: 'New Person', at: 1700000000000 }, 'new2@x,com': { name: 'Two', at: 1700000000001 } });
      await update(ref(db, R), startPayload('real'));
      for (const [k, t] of [[ED2.key, 't1'], [VW.key, 't2']]) await set(ref(db, `${R}/members/${k}/teamId`), t);
    });
  };
  let captured = null;

  await s.t(`${R}: the OWNER's phone — start, a date, save last year (read back), the clear, then Undo: every write accepted by the published rules`, async () => {
    const p = await phone(R, OWNER, 'editor');
    p.arrange();
    await seedServer(p);
    await p.attach();
    const ok = (r, what) => { if (!r || !r.ok) fail(what + ': ' + jstr(r)); return r; };
    ok(await p.run(`wizardStart({ campRunning: false })`), 'start');
    await p.until(`wizardModel().state === 'mine'`, 'the claim to arrive as mine');
    const claim = await val(owner(), `${R}/setup/meta/wizard`);
    if (!claim || claim.step !== 1 || claim.byKey !== OWNER.key || claim.fromEpoch !== 'legacy') fail('claim: ' + jstr(claim));
    p.run(`wizardAnswer({ weekStart: '2027-07-18', double: 'same' })`);
    ok(await p.run(`wizardSetStep(3)`), 'step 3');
    const arch = ok(await p.run(`wizardArchive()`), 'archive');
    const point = await val(owner(), `${R}/restoreIndex/${arch.rid}`);
    if (!point || point.kind !== 'archive' || point.pinned !== true) fail('archive row: ' + jstr(point));
    await p.until(`wizardModel().claim && wizardModel().claim.archiveId === ${jstr(arch.rid)}`, 'the claim to carry the archive id');
    ok(await p.run(`wizardSetStep(4)`), 'step 4');
    await p.until(`wizardModel().claim.step === 4`, 'step 4 in the claim');
    const clear = ok(await p.run(`wizardClear({ campRunning: false })`), 'clear');
    // what the database holds now
    if (await val(owner(), `${R}/state/results`) !== null) fail('last year\'s results are still there');
    if (await val(owner(), `${R}/state/bonuses`) !== null) fail('last year\'s bonuses are still there');
    if (await val(owner(), `${R}/state/meta/epoch`) !== clear.epoch) fail('state epoch');
    if (await val(owner(), `${R}/setup/meta/epoch`) !== clear.epoch) fail('setup epoch');
    if (await val(owner(), `${R}/setup/meta/weekStart`) !== '2027-07-18') fail('weekStart');
    if (await val(owner(), `${R}/setup/meta/wizard`) !== null) fail('the claim was not released by the commit');
    for (const k of ['campers', 'accessRequests', 'revealPublic', 'revealFull']) if (await val(owner(), `${R}/${k}`) !== null) fail(k + ' was not cleared');
    if ((await val(owner(), `${R}/state/notice/status`)) !== 'draft') fail('the notice is not a draft');
    if ((await val(owner(), `${R}/state/teams/0/counselor`)) != null) fail('the typed counselor name is still there');
    const members = await val(owner(), `${R}/members`);
    if (!members[OWNER.key] || same(members[OWNER.key], null)) fail('the owner row is gone');
    if (members[ED2.key].teamId !== undefined || members[VW.key].teamId !== undefined) fail('a counselor kept a team: ' + jstr(members[VW.key]));
    if (members[ED2.key].role !== 'editor' || members[VW.key].role !== 'viewer') fail('a role changed');
    if (members[BROKEN].teamId !== 't0') fail('the incomplete row cannot have been written');
    if (!clear.members.failed.some((m) => m.key === BROKEN)) fail('the refused member row was not listed: ' + jstr(clear.members));
    if (!clear.members.incomplete.some((m) => m.key === BROKEN)) fail('the preflight did not warn about it: ' + jstr(clear.members));
    s.note(`${camp}: ${clear.counts.results} results, ${clear.counts.requests} requests cleared; epoch ${clear.epoch}; ${clear.members.cleared} member teams taken off, ${clear.members.failed.length} refused row listed`);
    // the one atomic update, from the phone's own log
    const rootUpdates = p.writes.filter((w) => w.op === 'update' && w.path === R && w.values && w.values['state/meta/epoch'] === clear.epoch);
    if (rootUpdates.length !== 1) fail('expected ONE atomic root update with the epoch, saw ' + rootUpdates.length);
    if (Object.keys(rootUpdates[0].values).some((k) => /^members/.test(k))) fail('a member row is in the atomic update');
    const clearValues = rootUpdates[0].values;
    // then Undo the new-year setup
    await p.until('pendingWritesTotal() === 0 && !hasUnconfirmedLocalWork()', 'the phone to be quiet');
    const undo = ok(await p.run(`wizardUndo(${jstr(arch.rid)})`), 'undo');
    if (undo.epoch !== '') fail('undo epoch ' + undo.epoch);
    if (Object.keys(await val(owner(), `${R}/state/results`) || {}).length !== 2) fail('the scores did not come back');
    if ((await val(owner(), `${R}/state/meta/epoch`)) !== null) fail('the legacy epoch is not back (the key must be deleted)');
    if ((await val(owner(), `${R}/setup/meta/epoch`)) !== null) fail('setup epoch not deleted');
    if ((await val(owner(), `${R}/setup/meta/weekStart`)) != null) fail('the dates did not go back');
    if ((await val(owner(), `${R}/state/notice/status`)) !== 'posted') fail('the notice did not come back');
    if ((await val(owner(), `${R}/state/teams/0/counselor`)) !== 'Last Year Lee') fail('the typed counselor did not come back');
    const undoUpdates = p.writes.filter((w) => w.op === 'update' && w.path === R && w.values && 'state/meta/epoch' in w.values && w.values['state/meta/epoch'] === null);
    if (undoUpdates.length !== 1) fail('expected ONE atomic undo update, saw ' + undoUpdates.length);
    captured = {
      claim: p.writes.find((w) => w.op === 'transaction-value' && /setup\/meta\/wizard$/.test(w.path)),
      points: p.writes.filter((w) => w.op === 'update' && w.path === R && w.values && Object.keys(w.values).some((k) => /^restoreIndex\/rp-(archive|pre-wizard)/.test(k))).map((w) => w.values),
      clear: clearValues,
      undo: undoUpdates[0].values,
    };
    p.stop();
  });

  for (const [label, who, role] of [['a NON-OWNER director', ED, 'editor'], ['a COUNSELOR', VW, 'viewer']]) {
    await s.t(`${R}: ${label} — the client sends nothing, and every payload the owner's phone sent is refused by the rules (the clear and the undo as a whole)`, async () => {
      const p = await phone(R, who, role);
      p.arrange();
      await seedServer(p);
      await p.attach();
      const n = p.writes.length;
      for (const call of [`wizardStart({ campRunning: false })`, `wizardTakeOver({ force: true })`, `wizardArchive()`, `wizardClear({ campRunning: false })`, `wizardUndo('rp-archive-pre-20261106-abcd')`]) {
        const r = await p.run(call);
        if (!r || r.ok !== false) fail(call + ' was not refused in the client: ' + jstr(r));
      }
      if (p.writes.length !== n) fail('the client wrote: ' + jstr(p.writes.slice(n).map((w) => w.op + ' ' + w.path)));
      if (!captured) fail('nothing was captured from the owner\'s run');
      const db = who === ED ? h.as(ED) : h.as(VW);
      // the phone's own first-snapshot work (a push its attach queued) is finished before the camp is measured: it is not what is under test
      await p.until('pendingWritesTotal() === 0 && !hasUnconfirmedLocalWork() && !pushTimer', 'the phone to be quiet');
      await new Promise((r) => setTimeout(r, 700));
      const camp0 = await wholeCamp(R);
      // the claim, the way the client writes it
      await assertFails(runTransaction(ref(db, `${R}/setup/meta/wizard`), () => captured.claim.value));
      await assertFails(set(ref(db, `${R}/setup/meta/wizard`), captured.claim.value));
      // the archive and pre-wizard points
      for (const pts of captured.points) await assertFails(update(ref(db, R), pts));
      // the commit and the undo, as a whole
      await assertFails(update(ref(db, R), captured.clear));
      if (await wholeCamp(R) !== camp0) fail('the clear landed in part: ' + await wholeDiff(R, camp0));
      // An undo that puts a YEAR's epoch back (an archive of a later year) writes owner-only values: refused as a whole.
      const toYear = Object.assign({}, captured.undo, { 'state/meta/epoch': 'w20260101', 'setup/meta/epoch': 'w20260101' });
      await assertFails(update(ref(db, R), toYear));
      if (await wholeCamp(R) !== camp0) fail('the undo to a year\'s epoch landed in part: ' + await wholeDiff(R, camp0));
      // the epoch pair on its own, and the clear without it (a director's ordinary clean-up paths): the epoch is what the rules hold back
      await assertFails(update(ref(db, R), { 'state/meta/epoch': 'w20270405', 'state/meta/epochAt': { '.sv': 'timestamp' } }));
      await assertFails(update(ref(db, R), { 'setup/meta/epoch': 'w20270405', 'setup/meta/epochAt': { '.sv': 'timestamp' } }));
      if (await wholeCamp(R) !== camp0) fail('something landed: ' + await wholeDiff(R, camp0));
      // RECORDED, not asserted either way (setup-rebuild-spec §1.4 limit b, owner-only.mjs): `.validate` is not evaluated for a DELETE, so the undo of a
      // LEGACY-epoch archive — which only DELETES the epoch pair — is not refused to a director who sends it by hand. The app refuses it before sending
      // (above); the rules cannot. The data it puts back is the owner's own archive, and every director could already delete these keys.
      const legacyUndo = await outcome(() => update(ref(db, R), captured.undo));
      s.note(`${camp}: RECORDED — ${role === 'editor' ? 'a non-owner director' : 'a counselor'}'s hand-sent undo of a legacy-epoch archive: ${legacyUndo}`);
      if (role === 'viewer' && legacyUndo !== 'denied') fail('a counselor\'s undo was not refused: ' + legacyUndo);
      p.stop();
    });
  }

  await s.t(`${R}: the owner's PHONE-account lookalike (a phone sign-in is never the owner) cannot claim or commit either`, async () => {
    const claim = captured && captured.claim;
    if (!claim) fail('nothing captured');
    await assertFails(runTransaction(ref(h.asPhone('+15555550123'), `${R}/setup/meta/wizard`), () => claim.value));
  });
}

await h.done();
s.finish();
