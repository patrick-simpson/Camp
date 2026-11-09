// The REAL client against the PUBLISHED rules: reveal.js (the shipped scripts, loaded through tests/harness.js's
// vm and DOM stub, exactly as every unit test loads them) talks straight to the database emulator under
// database.rules.json, through a thin adapter from the SDK's modular API to the compat shape the app calls
// (firebase.database().ref(path).on / off / once / update, ServerValue.TIMESTAMP). Nothing here is a copy of the
// client's logic: the writes below are the ones a director's phone makes, judged by the real rules, and the reads
// are the ones a counselor's phone makes.
//
// reveal.mjs proves the RULES with hand-written payloads; this proves the CLIENT writes what the rules accept (every
// command of the state machine, a Start, a practice, the retirement) and refuses to write what they refuse (the CAS
// race, a stale Start). A mutation check belongs to this file: weaken one builder clause in reveal.js (a stale `sa`,
// a missing `pub: null`) and a case here turns red, with an unchanged unit suite for the model.
import { createRequire } from 'module';
import vm from 'vm';
import { harness, suite, NEW_RULES, R1_FROZEN, ROOTS, ED, ED2, VW, ref, get, update, onValue, serverTimestamp, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const { makeContext, clearAllTimers } = require('../harness.js');

const s = suite('reveal-client — the real client\'s writes against the real rules');
const h = await harness('reveal-client', NEW_RULES);
await h.members();
// the rules that were live before R2: the client with the branding switch ON must still run a whole reveal against them
const hOld = await harness('reveal-client-r1', R1_FROZEN);
await hOld.members();

// firebase.database().ref(path) over a modular Database instance. Values are round-tripped through JSON so an object made in
// the page's vm realm is a plain object to the SDK; the timestamp placeholder survives as {'.sv':'timestamp'}.
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
        log.push({ path, keys: Object.keys(plain), values: plain });
        return update(r, plain);
      },
    };
  };
  const database = () => ({ ref: refOf });
  database.ServerValue = { TIMESTAMP: serverTimestamp() };
  return { database };
}

const SENTINEL = [971, 863, 752, 641, 533, 427];
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

// One phone: a fresh page of the real scripts, signed in as `person` with `role`, its `firebase` the emulator under real rules.
async function phone(R, person, role, hh = h) {
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const { ctx, sandbox } = makeContext({ camp });
  const writes = [];
  sandbox.firebase = compatFirebase(hh.as(person), writes);
  const run = (code) => vm.runInContext(code, ctx);
  run(`state = makeFreshState(); migrateState(state); normalizeSyncedState();
       authUser = ${JSON.stringify({ email: person.email })};
       setMemberRole(${JSON.stringify(role)});
       fbConnected = true; remoteReady = true; dataEditPending = false; remoteRefetchPending = false;
       clearTimeout(pushTimer); pushTimer = null;`);
  const p = { ctx, run, writes, R, person };
  // a wait on a CONDITION with a generous deadline, never a guess at a delay
  p.until = async (code, why, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (run(code)) return; await sleep(25); }
    throw new Error('timed out waiting for ' + (why || code));
  };
  p.standings = (points) => run(`(function () {
    state.results = {}; state.bonuses = {};
    state.teams.forEach((t, i) => { t.name = ${JSON.stringify(NAMES)}[i]; state.bonuses['b' + i] = { teamId: t.id, category: 'custom', label: 'x', points: ${JSON.stringify(points)}[i], at: Date.parse('2026-01-01') }; });
  })()`);
  p.skew = (ms) => run(`serverTimeOffset = ${ms}; serverOffsetKnown = true`);   // this phone's idea of the server's clock: moves the recharge, never the server
  p.boot = async () => {
    run('initReveal()');
    await p.until('revealLoaded.real', 'the first answer for the real node');
    return p;
  };
  p.stop = () => { try { run('clearTimeout(revealTimer); clearTimeout(pushTimer); clearTimeout(pushConfigTimer);'); } catch (e) { /* ignore */ } };
  return p;
}

const val = async (db, path) => (await get(ref(db, path))).val();
const clear = (R) => h.seed(async (db) => { await update(ref(db, R), { revealPublic: null, revealFull: null }); });

for (const R of ROOTS) {
  const teams = R === 'seniorScoreboard' ? 4 : 6;
  const pts = SENTINEL.slice(0, teams);
  const pub = `${R}/revealPublic`;
  const anon = () => h.anon();
  await clear(R);

  await s.t(`${R}: a director's Start is accepted by the real rules: ctl, no place, the private order, the key only in revealFull`, async () => {
    const d = await phone(R, ED, 'editor');
    d.standings(pts);
    await d.boot();
    d.skew(0);
    const r = await d.run('revealStart({ quiet: true })');
    if (!r.ok) throw new Error('Start refused: ' + JSON.stringify(r));
    const seen = await val(anon(), pub);
    if (!seen.real.ctl || seen.real.pub) throw new Error('unexpected public content: ' + JSON.stringify(seen));
    if (JSON.stringify(seen).includes(ED.key)) throw new Error('a member key is in the public node');
    if (seen.real.ctl.phase !== 'intro' || seen.real.ctl.shown !== 0 || seen.real.ctl.teams !== teams) throw new Error('ctl: ' + JSON.stringify(seen.real.ctl));
    const full = await val(h.as(ED), `${R}/revealFull/real`);
    if (full.startedBy !== ED.key || full.r !== seen.real.ctl.id || full.n !== teams) throw new Error('revealFull: ' + JSON.stringify(full).slice(0, 200));
    if (!(await d.run('revealFullFor("real") && revealFullFor("real").n === ' + teams))) throw new Error('the director\'s phone should hold its own freeze');
    d.stop();
  });

  await s.t(`${R}: every command of the state machine is accepted: each place, a Back, the replay, the table, End; the client follows the server each time`, async () => {
    const d = await phone(R, ED, 'editor');
    d.standings(pts);
    await d.boot();
    let skew = 0;
    const press = async (action) => {
      skew += 6000;                                          // the beat is over for this phone: the button is ready
      d.skew(skew);
      const r = await d.run(`revealRun(${JSON.stringify(action)}, { quiet: true })`);
      if (!r.ok) throw new Error(action + ' refused: ' + JSON.stringify(r) + ' ctl ' + JSON.stringify(await val(anon(), `${pub}/real/ctl`)));
      const server = await val(anon(), `${pub}/real`);
      const mine = d.run('JSON.stringify(confirmedReveal.real)');
      if (JSON.stringify(JSON.parse(mine).ctl) !== JSON.stringify(server.ctl)) throw new Error('the phone does not follow the server after ' + action);
      return server;
    };
    let node = await val(anon(), `${pub}/real`);
    if (node && node.ctl && node.ctl.phase !== 'ended') { /* the previous case left a live intro: replace it */ }
    d.skew(0);
    const st = await d.run('revealStart({ quiet: true })');
    if (!st.ok) throw new Error('Start: ' + JSON.stringify(st));
    node = await press('next');                              // the last place
    if (node.ctl.shown !== 1 || Object.keys(node.pub).join() !== 'g0') throw new Error('after the first place: ' + JSON.stringify(node));
    node = await press('next');
    node = await press('back');
    if (node.ctl.cur !== 0 || node.ctl.shown !== 2) throw new Error('Back: ' + JSON.stringify(node.ctl));
    node = await press('next');                              // the replay publishes nothing new
    if (Object.keys(node.pub).length !== 2) throw new Error('the replay published a place');
    for (let k = 2; k < teams; k++) node = await press('next');
    if (Object.keys(node.pub).length !== teams) throw new Error('not every place is public');
    node = await press('next');                              // a Wednesday: the final table (no crowning)
    if (node.ctl.phase !== 'table') throw new Error('expected the table, got ' + node.ctl.phase);
    node = await press('back');
    node = await press('next');
    node = await press('end');
    if (node.ctl.phase !== 'ended' || node.ctl.endKind !== 'done') throw new Error('End: ' + JSON.stringify(node.ctl));
    const after = await d.run('revealNext({ quiet: true })');
    if (after.ok || after.code !== 'ended') throw new Error('an ended reveal took a command: ' + JSON.stringify(after));
    d.stop();
  });

  await s.t(`${R}: the finale crowns the champions between the last place and the table, and an End from there is early`, async () => {
    const d = await phone(R, ED, 'editor');
    d.standings(pts);
    await d.boot();
    // today is whatever weekday the emulator's machine says: make it the finale day without touching the real clock
    d.run(`finaleDow = () => revealDowOf(serverNow()); campWeek = () => ({ start: null, phase: 'unset' });`);
    d.skew(0);
    let r = await d.run('revealStart({ quiet: true })');
    if (!r.ok) throw new Error('Start: ' + JSON.stringify(r));
    if ((await val(anon(), `${pub}/real/ctl/finale`)) !== true) throw new Error('the ctl should say finale');
    let skew = 0;
    for (let k = 0; k < teams + 1; k++) {                    // every place, then the crowning
      skew += 6000; d.skew(skew);
      r = await d.run('revealNext({ quiet: true })');
      if (!r.ok) throw new Error('Next #' + k + ': ' + JSON.stringify(r));
    }
    if ((await val(anon(), `${pub}/real/ctl/phase`)) !== 'champion') throw new Error('expected champion');
    skew += 6000; d.skew(skew);
    r = await d.run('revealNext({ quiet: true })');
    if (!r.ok || (await val(anon(), `${pub}/real/ctl/phase`)) !== 'table') throw new Error('expected the table: ' + JSON.stringify(r));
    skew += 6000; d.skew(skew);
    r = await d.run('revealBack({ quiet: true })');
    if (!r.ok || (await val(anon(), `${pub}/real/ctl/phase`)) !== 'champion') throw new Error('Back from the table should land on the champions: ' + JSON.stringify(r));
    r = await d.run('revealEnd({ quiet: true })');
    if (!r.ok || (await val(anon(), `${pub}/real/ctl/endKind`)) !== 'early') throw new Error('End from the champions is early: ' + JSON.stringify(r));
    d.stop();
  });

  await s.t(`${R}: two remotes press at once: the rules let one win, the other is refused, says so and follows`, async () => {
    const a = await phone(R, ED, 'editor');
    const b = await phone(R, ED2, 'editor');
    a.standings(pts); b.standings(pts);
    await a.boot();
    await b.boot();
    a.skew(0);
    const st = await a.run('revealStart({ quiet: true })');
    if (!st.ok) throw new Error('Start: ' + JSON.stringify(st));
    await b.until('revealRemoteView("real") && revealRemoteView("real").phase === "intro"', 'the second director to see the Start');
    // both pass the intro (no beat), both send at the same moment
    const [ra, rb] = await Promise.all([a.run('revealNext({ quiet: true })'), b.run('revealNext({ quiet: true })')]);
    const wins = [ra, rb].filter((r) => r.ok).length;
    if (wins !== 1) throw new Error('exactly one of two simultaneous Next presses may win: ' + JSON.stringify([ra, rb]));
    const loser = ra.ok ? rb : ra;
    if (loser.code !== 'refused') throw new Error('the loser should be told it was refused: ' + JSON.stringify(loser));
    const ctl = await val(anon(), `${pub}/real/ctl`);
    if (ctl.seq !== 2 || ctl.shown !== 1) throw new Error('the node moved by more than one command: ' + JSON.stringify(ctl));
    for (const p of [a, b]) await p.until(`confirmedReveal.real && confirmedReveal.real.ctl.seq === 2`, 'both phones to follow the server');
    a.stop(); b.stop();
  });

  await s.t(`${R}: a practice writes only its own nodes, never touches real, and End deletes both of its nodes`, async () => {
    const d = await phone(R, ED, 'editor');
    d.standings(pts);
    await d.boot();
    d.skew(0);
    let r = await d.run('revealStart({ quiet: true })');
    if (!r.ok) throw new Error('real Start: ' + JSON.stringify(r));
    const realBefore = JSON.stringify([await val(h.as(ED), `${pub}/real`), await val(h.as(ED), `${R}/revealFull/real`)]);
    const from = d.writes.length;
    await d.until('revealLoaded.practice', 'the practice listener');
    r = await d.run('revealStart({ practice: true, quiet: true })');
    if (!r.ok) throw new Error('practice Start: ' + JSON.stringify(r));
    d.skew(6000);
    r = await d.run('revealRun("next", { mode: "practice", quiet: true })');
    if (!r.ok) throw new Error('practice Next: ' + JSON.stringify(r));
    const seen = await val(anon(), `${pub}/practice`);
    if (!seen || seen.ctl.shown !== 1 || Object.keys(seen.pub).join() !== 'g0') throw new Error('a practice at its first place holds exactly one: ' + JSON.stringify(seen));
    d.skew(12000);
    r = await d.run('revealRun("end", { mode: "practice", quiet: true })');
    if (!r.ok) throw new Error('practice End: ' + JSON.stringify(r));
    const keys = d.writes.slice(from).flatMap((w) => w.keys);
    keys.forEach((k) => { if (!/^reveal(Public|Full)\/practice(\/|$)/.test(k)) throw new Error('a practice wrote outside its own nodes: ' + k); });
    if ((await val(anon(), `${pub}/practice`)) !== null || (await val(h.as(ED), `${R}/revealFull/practice`)) !== null) throw new Error('End practice left a node behind');
    const realAfter = JSON.stringify([await val(h.as(ED), `${pub}/real`), await val(h.as(ED), `${R}/revealFull/real`)]);
    if (realBefore !== realAfter) throw new Error('the real reveal changed under a practice');
    d.stop();
  });

  await s.t(`${R}: a Start the client sends with a stale ca (an offline-queued tap) is refused by the rules, and the client says so`, async () => {
    const d = await phone(R, ED, 'editor');
    d.standings(pts);
    await d.boot();
    d.skew(-120000);                                         // this phone's clock thinks it is two minutes earlier than the server
    const r = await d.run('revealStart({ quiet: true })');
    if (r.ok || r.code !== 'refused') throw new Error('a two-minute-old ca must be refused: ' + JSON.stringify(r));
    if (!/Start again/.test(r.message)) throw new Error('the sentence: ' + r.message);
    d.stop();
  });

  await s.t(`${R}: a counselor's phone mirrors only what is shown (three seconds behind a new place), reads no practice and no revealFull, and keeps the grid after End`, async () => {
    await clear(R);
    const d = await phone(R, ED, 'editor');
    const c = await phone(R, VW, 'viewer');
    d.standings(pts);
    await d.boot();
    await c.boot();
    d.skew(0);
    let r = await d.run('revealStart({ quiet: true })');
    if (!r.ok) throw new Error('Start: ' + JSON.stringify(r));
    if (!c.run('revealMirrorView() && revealMirrorView().live')) await c.until('revealMirrorView() && revealMirrorView().live', 'the Start to reach a counselor');
    if (c.run('revealMirrorView().rows.length') !== 0) throw new Error('nothing is shown yet');
    r = await d.run('revealNext({ quiet: true })');
    if (!r.ok) throw new Error('Next: ' + JSON.stringify(r));
    await c.until('confirmedReveal.real && confirmedReveal.real.ctl.shown === 1', 'the first place to arrive');
    // inside the 3 s window the counselor's screen holds the newest place back; after it, it appears
    // (and this phone has never learned the server's clock, so it holds the place back whatever its own clock says)
    const look = c.run('revealMirrorView()');
    if (!look.looking || look.rows.length !== 0) throw new Error('the newest place must wait for the big screen');
    c.run('serverTimeOffset = 4000; serverOffsetKnown = true');
    if (c.run('revealMirrorView().rows.length') !== 1) throw new Error('after the look, the place is on the phone');
    // a counselor reads no practice and no private order
    if (c.run('confirmedReveal.practice') !== null) throw new Error('a counselor holds a practice');
    let denied = false;
    try { await get(ref(h.as(VW), `${R}/revealFull/real`)); } catch (e) { denied = /permission[_ ]denied/i.test(String(e.code || '') + ' ' + String(e.message || e)); if (!denied) throw e; }
    if (!denied) throw new Error('a counselor read the private order');
    // End: the grid stays until 8 AM
    d.skew(6000);
    r = await d.run('revealEnd({ quiet: true })');
    if (!r.ok) throw new Error('End: ' + JSON.stringify(r));
    await c.until('confirmedReveal.real && confirmedReveal.real.ctl.phase === "ended"', 'the End to arrive');
    c.run('serverTimeOffset = 10000');
    if (!c.run('revealGridView() && revealGridView().rows.length === 1')) throw new Error('the grid should stay on the counselor phone after End');
    // what an anonymous reader sees agrees: only the one place
    const publicNow = JSON.stringify(await val(anon(), pub));
    for (let i = 0; i < teams - 1; i++) if (publicNow.includes(NAMES[i]) || publicNow.includes(String(pts[i]))) throw new Error('a hidden team is in the public node: ' + NAMES[i]);
    d.stop(); c.stop();
  });

  await s.t(`${R}: retireExpiredReveal: refused by the server (and swallowed) before until, accepted after, and a director's phone then holds no node`, async () => {
    await clear(R);
    const d = await phone(R, ED, 'editor');
    d.standings(pts);
    await d.boot();
    d.skew(0);
    let r = await d.run('revealStart({ quiet: true })');
    if (!r.ok) throw new Error('Start: ' + JSON.stringify(r));
    d.skew(6000);
    r = await d.run('revealEnd({ quiet: true })');
    if (!r.ok) throw new Error('End: ' + JSON.stringify(r));
    // this phone's clock runs a day fast: it believes the reveal has expired and sends the delete; the SERVER says no
    d.run(`serverTimeOffset = 40 * 3600 * 1000; revealLastRetireAt = 0;`);
    const sent = d.run('retireExpiredReveal()');
    if (!sent.sent) throw new Error('the phone should have tried: ' + JSON.stringify(sent));
    await d.until('!revealRetiring', 'the refused retirement to settle');
    if ((await val(anon(), `${pub}/real`)) === null) throw new Error('a real reveal was deleted before its until (the server clock)');
    // the expired node (seeded: rules disabled): an honest phone's delete is accepted
    await h.seed((db) => update(ref(db, R), { 'revealPublic/real/ctl/until': Date.now() - 1000 }));
    d.run(`serverTimeOffset = 0; revealLastRetireAt = 0;`);
    await d.until('confirmedReveal.real && confirmedReveal.real.ctl.until < Date.now()', 'the phone to see the expiry');
    const sent2 = d.run('retireExpiredReveal()');
    if (!sent2.sent) throw new Error('an expired node should be retired: ' + JSON.stringify(sent2));
    await d.until('confirmedReveal.real === null', 'the node to be gone');
    if ((await val(anon(), `${pub}/real`)) !== null || (await val(h.as(ED), `${R}/revealFull/real`)) !== null) throw new Error('retire left something behind');
    // a counselor never retires anything
    d.stop();
  });
}

// ── R2: a team's own look in a shown place (owner's decisions item 7) ─────────────────────────────────────
// The switch REVEAL_BRANDING_LIVE ships ON (owner's decisions item 10; the cases still set it explicitly, and the OFF case turns it off). They prove the three pairings:
// ON under R2 (the look only in shown places), OFF under R2 (writes identical to before), ON under the rules live
// before R2 (a refused branded place is retried plain; the whole reveal, the crowning and End still run).
const THUMB = 'data:image/jpeg;base64,' + 'A'.repeat(1500);
const OWL = '\u{1F989}';
function giveLooks(d, teams) {
  d.run(`(function () {
    state.teams.forEach((t, i) => {
      if (i === ${teams} - 1) t.emoji = ${JSON.stringify(OWL)};               // the first place shown: a look R1 knows nothing about
      if (i === 0) { t.color = 'teal'; t.photoV = 3; TEAM_PHOTO_MEM.set(t.id + ':3', ${JSON.stringify(THUMB)}); revealThumbs.set(t.id, { v: 3, data: ${JSON.stringify(THUMB)} }); }
      if (i === 1) { t.plain = true; t.emoji = '2\\uFE0F\\u20E3'; }
    });
  })()`);
}
for (const R of ROOTS) {
  const teams = R === 'seniorScoreboard' ? 4 : 6;
  const pts = SENTINEL.slice(0, teams);
  const pub = `${R}/revealPublic`;
  const anon = () => h.anon();
  await clear(R);
  await s.t(`${R}: switch ON under R2 — every place goes through; a look appears only in the place its team is shown in; never at Start, never in revealFull`, async () => {
    const d = await phone(R, ED, 'editor');
    d.standings(pts); giveLooks(d, teams);
    await d.boot();
    if (d.run('REVEAL_BRANDING_LIVE') !== true) throw new Error('the shipped switch is not ON');
    d.run('REVEAL_BRANDING_LIVE = true');
    d.skew(0);
    let r = await d.run('revealStart({ quiet: true })');
    if (!r.ok) throw new Error('Start: ' + JSON.stringify(r));
    const atStart = JSON.stringify(await val(anon(), pub));
    if (/"(em|pl|ph)"/.test(atStart) || atStart.includes(THUMB)) throw new Error('a look was public at Start');
    let skew = 0;
    for (let k = 0; k < teams; k++) {
      skew += 6000; d.skew(skew);
      r = await d.run('revealNext({ quiet: true })');
      if (!r.ok) throw new Error('Next #' + k + ': ' + JSON.stringify(r));
      const text = JSON.stringify(await val(anon(), pub));
      if (k < teams - 1 && text.includes(THUMB)) throw new Error('the photo of a team still hidden is public after place ' + k);
    }
    const node = await val(anon(), `${pub}/real/pub`);
    const e0 = node['g' + (teams - 1)].e.t0, eFirst = node.g0.e['t' + (teams - 1)];
    if (e0.k !== 'teal' || e0.ph !== THUMB) throw new Error('the shown team\'s look: ' + JSON.stringify(e0).slice(0, 120));
    if (eFirst.em !== OWL) throw new Error('the first place\'s own emoji: ' + JSON.stringify(eFirst));
    const full = JSON.stringify(await val(h.as(ED), `${R}/revealFull/real`));
    if (/"(em|pl|ph)"/.test(full) || full.includes(THUMB)) throw new Error('revealFull carries a look');
    if (d.run('revealBrandRefused') !== false) throw new Error('the switch fell back against R2');
    d.stop();
  });
  await clear(R);
  await s.t(`${R}: switch OFF under R2 — the writes carry no look at all (what the client wrote before R2)`, async () => {
    const d = await phone(R, ED, 'editor');
    d.standings(pts); giveLooks(d, teams);
    await d.boot();
    d.run('REVEAL_BRANDING_LIVE = false');
    d.skew(0);
    let r = await d.run('revealStart({ quiet: true })');
    if (!r.ok) throw new Error('Start: ' + JSON.stringify(r));
    let skew = 0;
    for (let k = 0; k < 2; k++) { skew += 6000; d.skew(skew); r = await d.run('revealNext({ quiet: true })'); if (!r.ok) throw new Error('Next: ' + JSON.stringify(r)); }
    if (/"(k|em|pl|ph)"/.test(JSON.stringify(d.writes.map((w) => w.values)))) throw new Error('a look was written with the switch off');
    d.stop();
  });
  await clear(R);
  await s.t(`${R}: switch ON under the rules live BEFORE R2 — the branded place is refused once and sent plain; the crowning and End still run`, async () => {
    const hoc = () => hOld.anon();
    await hOld.seed(async (db) => { await update(ref(db, R), { revealPublic: null, revealFull: null }); });
    const d = await phone(R, ED, 'editor', hOld);
    d.standings(pts); giveLooks(d, teams);
    await d.boot();
    d.run(`REVEAL_BRANDING_LIVE = true; finaleDow = () => revealDowOf(serverNow()); campWeek = () => ({ start: null, phase: 'unset' });`);
    d.skew(0);
    let r = await d.run('revealStart({ quiet: true })');
    if (!r.ok) throw new Error('Start: ' + JSON.stringify(r));
    let skew = 0;
    for (let k = 0; k < teams + 1; k++) {                    // every place, then the crowning
      skew += 6000; d.skew(skew);
      r = await d.run('revealNext({ quiet: true })');
      if (!r.ok) throw new Error('Next #' + k + ': ' + JSON.stringify(r));
    }
    const sends = d.writes.filter((w) => w.keys.some((k) => /\/pub\/g\d$/.test(k)));
    const branded = sends.filter((w) => /"(em|pl|ph)"/.test(JSON.stringify(w.values)));
    if (branded.length !== 1) throw new Error('exactly one branded send (refused), got ' + branded.length);
    if (sends.length !== teams + 1) throw new Error('one retry in all: ' + sends.length + ' place sends for ' + teams + ' places');
    if (d.run('revealBrandRefused') !== true) throw new Error('the page should have stopped branding');
    if ((await val(hoc(), `${R}/revealPublic/real/ctl/phase`)) !== 'champion') throw new Error('expected the crowning');
    skew += 6000; d.skew(skew);
    r = await d.run('revealNext({ quiet: true })');
    skew += 6000; d.skew(skew);
    r = await d.run('revealEnd({ quiet: true })');
    if (!r.ok) throw new Error('End: ' + JSON.stringify(r));
    const text = JSON.stringify(await val(hoc(), `${R}/revealPublic`));
    if (/"(em|pl|ph)"/.test(text)) throw new Error('a look is public under the old rules');
    d.stop();
  });
}

for (const p of []) p.stop();
clearAllTimers();
await h.done();
await hOld.done();
s.finish();
