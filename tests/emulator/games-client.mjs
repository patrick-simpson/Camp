// The REAL client's Games writes against the PUBLISHED rules (BUILD-PLAN Step 21, build session 2): the shipped scripts (tests/harness.js's vm and DOM
// stub, a camp whose schedule is already edited here, as every seeded unit test loads it) talk to the database emulator under database.rules.json
// through the same thin compat adapter the other *-client suites use. Nothing here is a copy of the client's logic. The Games screen and its sheet
// write the week's catalog ONLY through the config engine (one transaction on `<root>/config` carrying the field ops of the edit), so this proves
// the transactions the new engine sends are what the rules accept, on both camps, and that the client's own bookkeeping agrees afterwards:
//   - a game added through the sheet (name, then how it is scored) is ONE transaction that stores the whole record with a random-tail id, and the
//     phone has nothing unconfirmed afterwards; every later field (where, counter buttons, double points, a scoreboard) is its own transaction;
//   - a bracket's Matchups (fixed pairs as arrays of team ids, then back to "by the standings", which removes them), a move through When
//     (blockId + dayId + session + ord, then off the schedule, which removes two fields), Earlier / Later (a renumbering of the item's games),
//     a copy, a delete, a day made a games day with its note, and a day taken off with its games moved — all accepted;
//   - the ⚡ quick game, opened and named through the real sheet, lands on the item and is accepted;
//   - two directors at once: different fields of one game BOTH land (the transaction applies each phone's ops to the server's current value),
//     two directors adding "Rain bowling" at once make TWO games, and a game one director deleted is NOT resurrected by the other's open sheet
//     (the write is refused in the client, the server is untouched);
//   - a counselor's phone: the engine refuses every one of these in the client (nothing is sent), and the rules refuse the same writes by hand.
// No rules change belongs to this step: `config` only has to stay a branch with its five typed keys, which is what the classic editor has always
// written. Mutation-check: weaken `config/.write` to a viewer and the counselor cases turn red; add `.validate` on games/$i/ord and the move cases do.
import { createRequire } from 'module';
import vm from 'vm';
import { onValue, query, orderByChild, limitToLast } from 'firebase/database';
import { harness, suite, NEW_RULES, ROOTS, ED, ED2, VW, ref, get, set, update, remove, runTransaction, assertFails, assertSucceeds, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const { makeContext } = require('../harness.js');

const s = suite('games — the real client\'s writes against the real rules');
const h = await harness('games-client', NEW_RULES);
await h.members();

// firebase.database().ref(path) over a modular Database instance (values round-tripped through JSON so an object made in the page's vm realm is a plain
// object to the SDK). `transaction` is what the config engine writes with; `off` with no callback detaches every listener of the ref.
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
      set(value) { const plain = JSON.parse(JSON.stringify(value)); log.push({ op: 'set', path }); return set(r, plain); },
      remove() { log.push({ op: 'remove', path }); return remove(r); },
      transaction(fn) { log.push({ op: 'transaction', path }); return runTransaction(r, (cur) => fn(cur === undefined ? null : cur), { applyLocally: false }).then((res) => ({ committed: res.committed, snapshot: wrap(res.snapshot) })); },
    });
  };
  const database = () => ({ ref: refOf });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  return { database, apps: [{}] };
}

const jstr = (x) => JSON.stringify(x);
const val = async (db, path) => (await get(ref(db, path))).val();
const fail = (m) => { throw new Error(m); };

// One phone: a fresh page of the real scripts on a camp whose schedule is edited here, signed in as `person`, with the real config listener attached.
async function phone(R, person, role, name) {
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const { ctx, sandbox } = makeContext({ camp, seeded: true });
  const writes = [];
  sandbox.firebase = compatFirebase(h.as(person), writes);
  sandbox.confirm = () => true; // askDialog's native fallback: "yes" to a delete
  const run = (code) => vm.runInContext(code, ctx);
  run(`window.scrollTo = () => {}; window.FIREBASE_CONFIG = { apiKey: 'test' };
       var __toasts = []; showToast = (m) => { __toasts.push(String(m)); };
       authUser = ${jstr({ email: person.email, emailVerified: true, displayName: name || 'Test' })};
       fbConnKnown = true; fbConnected = true;
       setMemberRole(${jstr(role)}); syncStarted = true; remoteReady = true;`);
  const p = { ctx, run, writes, name };
  p.until = async (code, why, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (run(code)) return; await sleep(25); }
    throw new Error('timed out waiting for ' + (why || code));
  };
  p.attach = async () => {
    run(`fbConfigRef = firebase.database().ref(dbPath('config')); attachConfigListener();`);
    await p.until('configReady === true', 'the first config snapshot');
  };
  // everything this phone has asked for has been sent, acknowledged and rebased: nothing unconfirmed, nothing pending
  p.settle = async () => {
    run('flushPendingPush()');
    await p.until('pendingConfigWrites === 0 && !pushConfigTimer && Object.keys(cfgUnconfirmed()).length === 0', 'the config push to be acknowledged');
  };
  p.toasts = () => run('__toasts.slice()');
  p.transactions = () => writes.filter((w) => w.op === 'transaction' && /\/config$/.test(w.path)).length;
  p.stop = () => { try { run('clearTimeout(pushConfigTimer); clearTimeout(setupPushTimer)'); } catch (e) { /* ignore */ } };
  return p;
}

const game = async (R, id) => ((await val(h.as(ED), `${R}/config/games`)) || []).find((g) => g && g.id === id) || null;
const games = async (R) => ((await val(h.as(ED), `${R}/config/games`)) || []).filter(Boolean);

// The sheet, driven the way a finger does: type a name, commit it (blur), tap a way of scoring. `gmCommitText` takes an element stand-in.
const typeInto = (p, id, text) => p.run(`(function () { const e = { id: ${jstr(id)}, value: ${jstr(text)}, tagName: 'INPUT', classList: { contains: () => false } }; setupEl(${jstr(id)}).value = ${jstr(text)}; gmCommitText(e); })()`);

// An item a new game can go on, and the weekday it is on: the first day with a Games item, from the phone's own plan.
const firstGamesDay = (p) => p.run(`(function () { const dk = SETUP_DK.find((d) => gmIsGamesDay(d) && planForDow(SETUP_DK.indexOf(d)).some((b) => b.type === 'games')); return { dk, items: planForDow(SETUP_DK.indexOf(dk)).filter((b) => b.type === 'games').map((b) => b.id) }; })()`);

for (const R of ROOTS) {
  const ed = () => h.as(ED);
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  // A clean config node, seeded from what a seeded phone holds itself (so the server and the client agree about every link), per case.
  const reseed = async () => {
    const probe = makeContext({ camp, seeded: true });
    const cfg = JSON.parse(vm.runInContext('JSON.stringify(configForSync(state.config))', probe.ctx));
    await h.seed((db) => set(ref(db, `${R}/config`), cfg));
    return cfg;
  };

  await s.t(`${R}: the sheet's first valid moment is ONE transaction that stores the whole record on the item with a random-tail id; every later field is its own transaction; nothing is left unconfirmed`, async () => {
    await reseed();
    const d = await phone(R, ED, 'editor', 'Ed');
    await d.attach();
    const { dk, items } = firstGamesDay(d);
    const before = (await games(R)).length;
    d.run(`gmOpenNew({ dk: ${jstr(dk)}, target: ${jstr(items[0])} })`);
    typeInto(d, 'gm-name', 'Rain bowling');
    if (d.transactions() !== 0) fail('a name alone writes nothing (it is not a game yet)');
    await d.run(`gmPickFormat('tally')`);
    await d.settle();
    if (d.transactions() !== 1) fail('creating is ONE transaction, saw ' + d.transactions());
    const gid = d.run('gmUi.open.gid');
    const g = await game(R, gid);
    if (!g || !/^rain-bowling-[a-z0-9]{4}$/.test(g.id)) fail('a random-tail id: ' + (g && g.id));
    if (g.name !== 'Rain bowling' || g.format !== 'tally' || g.blockId !== items[0] || !Number.isFinite(g.ord) || !g.session || !g.dayId) fail('the record: ' + jstr(g));
    if ((await games(R)).length !== before + 1) fail('one game added');
    // field by field
    const n0 = d.transactions();
    typeInto(d, 'gm-where', 'Under the oak'); await d.settle();
    typeInto(d, 'gm-steps', '1, 5'); await d.settle();
    d.run(`gmSwitch('gm-double', true)`); await d.settle();
    d.run(`gmSwitch('gm-tracker', true)`); await d.settle();
    if (d.transactions() - n0 !== 4) fail('four fields, four transactions: ' + (d.transactions() - n0));
    const g2 = await game(R, gid);
    if (g2.location !== 'Under the oak' || jstr(g2.counterSteps) !== jstr([1, 5]) || g2.messtival !== true || !g2.liveTracker) fail('fields: ' + jstr(g2));
    if (g2.name !== 'Rain bowling' || g2.blockId !== items[0]) fail('nothing else was touched');
    // switching one off removes the field from the server
    d.run(`gmSwitch('gm-double', false)`); await d.settle();
    if ((await game(R, gid)).messtival !== undefined) fail('off removes the field');
    if (d.toasts().some((t) => /couldn.t save/i.test(t))) fail('a save failed: ' + d.toasts().join(' | '));
    d.stop();
  });

  await s.t(`${R}: a bracket's Matchups (fixed pairs, then back to the standings) and a change of how it is scored are accepted; the pairs are arrays of this camp's own team ids`, async () => {
    await reseed();
    const d = await phone(R, ED, 'editor', 'Ed');
    await d.attach();
    const { dk, items } = firstGamesDay(d);
    d.run(`gmOpenNew({ dk: ${jstr(dk)}, target: ${jstr(items[0])} })`);
    typeInto(d, 'gm-name', 'Rope pull');
    await d.run(`gmPickFormat('tournament')`);
    await d.settle();
    const gid = d.run('gmUi.open.gid');
    let g = await game(R, gid);
    if (g.format !== 'tournament' || g.bracketSeed !== 'standings' || !g.liveTracker) fail('a bracket starts by the standings with the plain scoreboard: ' + jstr(g));
    const ids = d.run('teamIds()');
    const order = ids.slice().reverse();
    const r = d.run(`gmSetSeed(${jstr(gid)}, 'fixed', ${jstr(order)})`);
    if (!r.ok) fail('seed: ' + jstr(r));
    await d.settle();
    g = await game(R, gid);
    const pairs = Array.isArray(g.roundOneMatchups) ? g.roundOneMatchups : Object.values(g.roundOneMatchups || {});
    if (g.bracketSeed !== 'fixed' || pairs.length !== ids.length / 2 || !pairs.every((p) => Object.values(p).length === 2 && Object.values(p).every((t) => ids.includes(t)))) fail('pairs: ' + jstr(g.roundOneMatchups));
    if (new Set(pairs.flatMap((p) => Object.values(p))).size !== ids.length) fail('every team exactly once');
    d.run(`gmSetSeed(${jstr(gid)}, 'standings')`);
    await d.settle();
    g = await game(R, gid);
    if (g.bracketSeed !== 'standings' || g.roundOneMatchups !== undefined) fail('back to the standings removes the pairs: ' + jstr(g));
    // a bracket becomes a podium game: the bracket-only fields go with the old way of scoring (no records under it, so no question)
    const c = await d.run(`gmChangeFormat(${jstr(gid)}, 'placement')`);
    if (!c.ok) fail('format: ' + jstr(c));
    await d.settle();
    g = await game(R, gid);
    if (g.format !== 'placement' || g.bracketSeed !== undefined || g.liveTracker !== undefined) fail('the old format\'s fields are gone: ' + jstr(g));
    d.stop();
  });

  await s.t(`${R}: When (blockId + dayId + session + ord, then off the schedule), Earlier / Later, a copy and a delete are accepted, and the client agrees with the server afterwards`, async () => {
    await reseed();
    const d = await phone(R, ED, 'editor', 'Ed');
    await d.attach();
    // a game and its neighbour on one item (the seeded week holds two or more on its Games items)
    const target = d.run(`(function () { for (const dk of SETUP_DK) { if (!gmIsGamesDay(dk)) continue; for (const b of planForDow(SETUP_DK.indexOf(dk))) { if (gmGamesOnBlock(dk, b.id).length >= 2) return { dk, bid: b.id, ids: gmGamesOnBlock(dk, b.id).map((g) => g.id) }; } } return null; })()`);
    if (!target) fail('the seeded week has no item with two games');
    const [first, second] = target.ids;
    const r1 = d.run(`gmOrderGame(${jstr(second)}, -1)`);
    if (!r1.ok) fail('earlier: ' + jstr(r1));
    await d.settle();
    // one block id serves every weekday that follows the typical day, so the item's games are the ones on that day
    const dayId = d.run(`gmDayRecs(${jstr(target.dk)})[0].id`);
    const ords = (await games(R)).filter((g) => g.blockId === target.bid && g.dayId === dayId).sort((a, b) => a.ord - b.ord).map((g) => g.id);
    if (ords[0] !== second || ords[1] !== first) fail('order on the server: ' + ords.join());
    // move it to another item (or off the schedule when the day has one)
    const other = d.run(`(function () { const dk = ${jstr(target.dk)}; const b = planForDow(SETUP_DK.indexOf(dk)).find((x) => x.type === 'games' && x.id !== ${jstr(target.bid)}); return b ? b.id : ''; })()`);
    if (other) {
      const m = d.run(`gmMoveGame(${jstr(second)}, { dk: ${jstr(target.dk)}, bid: ${jstr(other)} }, { double: 'no' })`);
      if (!m.ok) fail('move: ' + jstr(m));
      await d.settle();
      const g = await game(R, second);
      if (g.blockId !== other || !Number.isFinite(g.ord) || !g.session || !g.dayId) fail('moved: ' + jstr(g));
    }
    const off = d.run(`gmMoveGame(${jstr(second)}, { none: true })`);
    if (!off.ok) fail('off the schedule: ' + jstr(off));
    await d.settle();
    let g = await game(R, second);
    if (g.blockId !== undefined || g.ord !== undefined) fail('taking a game off the schedule removes blockId and ord: ' + jstr(g));
    if (!g.dayId) fail('it keeps its day');
    // a copy and a delete
    const cp = d.run(`gmDuplicate(${jstr(first)})`);
    if (!cp.ok) fail('copy: ' + jstr(cp));
    await d.settle();
    const copy = await game(R, cp.id);
    if (!copy || !/ \(copy\)$/.test(copy.name) || copy.id === first) fail('the copy: ' + jstr(copy));
    const del = await d.run(`gmDeleteGame(${jstr(cp.id)})`);
    if (!del.ok) fail('delete: ' + jstr(del));
    await d.settle();
    if (await game(R, cp.id)) fail('the copy is gone from the server');
    // the phone and the server hold the same catalog
    const server = jstr((await games(R)).map((x) => x.id));
    const phoneIds = jstr(d.run('state.config.games.map((x) => x.id)'));
    if (server !== phoneIds) fail('catalogs differ:\n' + server + '\n' + phoneIds);
    if (d.toasts().some((t) => /couldn.t save/i.test(t))) fail('a save failed: ' + d.toasts().join(' | '));
    d.stop();
  });

  await s.t(`${R}: making a weekday a games day (with its note) and taking one off with its games moved are accepted and leave nothing unconfirmed`, async () => {
    await reseed();
    const d = await phone(R, ED, 'editor', 'Ed');
    await d.attach();
    const off = d.run(`SETUP_DK.find((dk) => !gmIsGamesDay(dk))`);
    if (!off) fail('the seeded camp has a weekday that is not a games day');
    const days0 = (await val(ed(), `${R}/config/days`)).filter(Boolean).length;
    const mk = d.run(`gmMakeDay(${jstr(off)})`);
    if (!mk.ok || !mk.changed) fail('make: ' + jstr(mk));
    await d.settle();
    const days1 = (await val(ed(), `${R}/config/days`)).filter(Boolean);
    const rec = days1.find((x) => x.id === mk.id);
    if (days1.length !== days0 + 1 || !rec || rec.name !== d.run(`SETUP_DAY_WORDS[${jstr(off)}]`)) fail('the day: ' + jstr(rec));
    const sorted = days1.map((x) => x.dow);
    if (jstr(sorted) !== jstr(sorted.slice().sort((a, b) => a - b))) fail('days stay in week order: ' + sorted.join());
    const note = d.run(`gmSetDayNote(${jstr(off)}, 'Rain plan: gym')`);
    if (!note.ok) fail('note: ' + jstr(note));
    await d.settle();
    if ((await val(ed(), `${R}/config/days`)).filter(Boolean).find((x) => x.id === mk.id).note !== 'Rain plan: gym') fail('the note');
    // a game that lives on the first games day moves to the new one when that day is taken off
    const first = d.run(`SETUP_DK.find((dk) => gmIsGamesDay(dk) && dk !== ${jstr(off)} && gmGamesOnDay(dk).length)`);
    const n = d.run(`gmGamesOnDay(${jstr(first)}).length`);
    const t = d.run(`gmTakeDayOff(${jstr(first)}, ${jstr(off)})`);
    if (!t.ok || t.moved !== n) fail('take off: ' + jstr(t));
    await d.settle();
    const dayId = rec.id;
    const moved = (await games(R)).filter((g) => g.dayId === dayId).length;
    if (moved !== n) fail('every game moved to the other day: ' + moved + ' of ' + n);
    if ((await val(ed(), `${R}/config/days`)).filter(Boolean).some((x) => x.dow === d.run(`gmDow(${jstr(first)})`))) fail('the day is off the server');
    // nothing was lost: every game still has a day that exists
    const ids = new Set((await val(ed(), `${R}/config/days`)).filter(Boolean).map((x) => x.id));
    if ((await games(R)).some((g) => !ids.has(g.dayId))) fail('a game was left on a day that is gone');
    d.stop();
  });

  await s.t(`${R}: the ⚡ quick game, named through the real sheet, lands on the item and is accepted`, async () => {
    await reseed();
    const d = await phone(R, ED, 'editor', 'Ed');
    await d.attach();
    const dk = firstGamesDay(d).dk;
    d.run(`state.ui.day = gmDayRecs(${jstr(dk)})[0].id; location.search = '?now=' + SETUP_DK.indexOf(${jstr(dk)}) + '-1030'`);
    if (!d.run('gmOpenQuick()')) fail('the quick game opened');
    typeInto(d, 'gm-name', 'Sock toss');
    await d.settle();
    const gid = d.run('gmUi.open.gid');
    const g = await game(R, gid);
    if (!g || g.format !== 'placement' || !g.dayId || !g.session) fail('the quick game: ' + jstr(g));
    if (d.transactions() !== 1) fail('one transaction for the quick game, saw ' + d.transactions());
    d.stop();
  });

  await s.t(`${R}: two directors at once: different fields of ONE game both land; two "Rain bowling"s are two games; a game one deleted is NOT resurrected by the other's open sheet`, async () => {
    await reseed();
    const a = await phone(R, ED, 'editor', 'Ed');
    const b = await phone(R, ED2, 'editor', 'Ed Two');
    await a.attach();
    await b.attach();
    const gid = a.run('state.config.games[0].id');
    // both edit the same game's different fields before either has heard of the other's
    a.run(`gmCommit(${jstr(gid)}, { location: 'North field' }, 'Edited')`);
    b.run(`gmCommit(${jstr(gid)}, { headline: 'Bring water' }, 'Edited')`);
    await Promise.all([a.settle(), b.settle()]);
    const g = await game(R, gid);
    if (g.location !== 'North field' || g.headline !== 'Bring water') fail('both fields landed: ' + jstr([g.location, g.headline]));
    await a.until(`gameById(${jstr(gid)}).headline === 'Bring water'`, 'the other director\'s field to arrive');
    await b.until(`gameById(${jstr(gid)}).location === 'North field'`, 'the first director\'s field to arrive');
    // the same name typed on both phones at once: two games
    const { dk, items } = firstGamesDay(a);
    const n0 = (await games(R)).length;
    for (const p of [a, b]) {
      p.run(`gmOpenNew({ dk: ${jstr(dk)}, target: ${jstr(items[0])} })`);
      typeInto(p, 'gm-name', 'Rain bowling');
    }
    await Promise.all([a, b].map((p) => p.run(`gmPickFormat('placement')`)));
    await Promise.all([a.settle(), b.settle()]);
    const added = (await games(R)).filter((x) => /^rain-bowling-/.test(x.id));
    if (added.length !== 2 || added[0].id === added[1].id || (await games(R)).length !== n0 + 2) fail('two games: ' + added.map((x) => x.id).join());
    // deleted elsewhere: a deletes a game b has open in its sheet; b's next edit is refused in the client, nothing is resurrected
    const victim = added[0].id;
    b.run(`gmOpenGame(${jstr(victim)})`);
    const del = await a.run(`gmDeleteGame(${jstr(victim)})`);
    if (!del || !del.ok) fail('the delete: ' + jstr(del) + ' ' + a.toasts().join(' | '));
    await a.settle();
    if (await game(R, victim)) fail('the delete did not reach the server');
    await b.until(`!gameById(${jstr(victim)})`, 'the delete to reach the other phone');
    const tx = b.transactions();
    const r = b.run(`gmCommit(${jstr(victim)}, { location: 'Nowhere' })`);
    if (r.ok || r.reason !== 'gone') fail('the engine refuses a write to a game that is gone: ' + jstr(r));
    await sleep(500);
    if (b.transactions() !== tx) fail('nothing was sent');
    if (await game(R, victim)) fail('the game must stay deleted');
    a.stop(); b.stop();
  });

  await s.t(`${R}: a counselor's phone: the engine refuses every Games write in the client (nothing is sent) and the rules refuse the same writes by hand; a director's raw write of the same shapes is accepted`, async () => {
    const cfg = await reseed();
    const c = await phone(R, VW, 'viewer', 'Vw');
    await c.attach();
    const gid = cfg.games[0].id;
    const dk = c.run('SETUP_DK.find((dk) => gmIsGamesDay(dk))');
    const attempts = [
      `gmCommit(${jstr(gid)}, { location: 'Mine' })`, `gmSetSeed(${jstr(gid)}, 'standings')`, `gmMoveGame(${jstr(gid)}, { none: true })`,
      `gmOrderGame(${jstr(gid)}, 1)`, `gmDuplicate(${jstr(gid)})`, `gmMakeDay('sat')`, `gmSetDayNote(${jstr(dk)}, 'x')`, `gmTakeDayOff(${jstr(dk)}, '')`,
      `gmCreateGame({ name: 'Sneaky', emoji: '', location: '', format: 'placement' }, { dayId: 'x', session: 'Morning' })`,
    ];
    for (const code of attempts) {
      const r = c.run(code);
      if (r && r.ok === true) fail('a counselor\'s phone did it: ' + code);
    }
    await sleep(500);
    if (c.writes.some((w) => w.op !== 'noop')) fail('a counselor sent something: ' + jstr(c.writes));
    if (jstr((await games(R)).map((g) => g.location)) !== jstr(cfg.games.map((g) => g.location))) fail('the server changed');
    // and by hand: the rules
    await assertFails(set(ref(h.as(VW), `${R}/config/games/0/location`), 'By hand'));
    await assertFails(set(ref(h.as(VW), `${R}/config/days/0/note`), 'By hand'));
    await assertFails(runTransaction(ref(h.as(VW), `${R}/config`), (cur) => cur));
    // a director's raw writes of the shapes the Games engine sends: field leaves, a new whole record, a removed field
    const E = h.as(ED);
    await assertSucceeds(set(ref(E, `${R}/config/games/0/bracketSeed`), 'fixed'));
    await assertSucceeds(set(ref(E, `${R}/config/games/0/roundOneMatchups`), [['t0', 't1'], ['t2', 't3']]));
    await assertSucceeds(set(ref(E, `${R}/config/games/0/blockId`), 'b-x-600'));
    await assertSucceeds(set(ref(E, `${R}/config/games/0/ord`), 30));
    await assertSucceeds(set(ref(E, `${R}/config/games/0/blockId`), null));
    await assertSucceeds(set(ref(E, `${R}/config/days/0/note`), 'Rain plan: gym'));
    c.stop();
  });
}

await h.done();
s.finish();
