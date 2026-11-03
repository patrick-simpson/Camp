// The REAL client's Teams-screen writes against the PUBLISHED rules (BUILD-PLAN Step 25, session 1): the shipped scripts
// (tests/harness.js's vm and DOM stub, exactly as every unit test loads them) talk to the database emulator under
// database.rules.json through the same thin compat adapter reveal-client.mjs and director-tools-client.mjs use. Nothing here is
// a copy of the client's logic: a director's phone renames a team and takes the suggested short name and emoji, picks a
// colour, sets another team's colour from "Pick colours for the flagged teams", uploads a photo and removes it, and a backup
// full of hostile branding is cleaned before it can be sent — and every write is judged by the real rules. teams-fields.mjs
// proves the rules' side with hand-written values; this proves the client's own writes are what those rules accept.
// No rules change belongs to this step: state/teams/$i/{emoji,short,color,photoV} and teamPhotos/$tid were published in R1.
import { createRequire } from 'module';
import vm from 'vm';
import { harness, suite, NEW_RULES, ROOTS, ED, VW, ref, get, set, update, onValue, assertFails, sleep, bigPng } from './lib.mjs';

const require = createRequire(import.meta.url);
const { makeContext, clearAllTimers } = require('../harness.js');

const s = suite('teams — the real client\'s writes against the real rules');
const h = await harness('teams-client', NEW_RULES);
await h.members();

// firebase.database().ref(path) over a modular Database instance (values round-tripped through JSON so an object made in
// the page's vm realm is a plain object to the SDK). `set` joins update: the photo is one set() of { v, data }.
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

// One phone: a fresh page of the real scripts, signed in as `person` with `role`, its state listener's ref the emulator, and what
// the first pull confirmed (`server`: the whole state node as the server holds it) adopted as its baseline.
async function phone(R, person, role, server) {
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const { ctx, sandbox } = makeContext({ camp });
  const writes = [];
  sandbox.firebase = compatFirebase(h.as(person), writes);
  const run = (code) => vm.runInContext(code, ctx);
  run(`state = makeFreshState(); migrateState(state); normalizeSyncedState();
       window.scrollTo = () => {};
       authUser = ${JSON.stringify({ email: person.email })};
       setMemberRole(${JSON.stringify(role)}); memberName = 'Jenn';
       state.teams = ${JSON.stringify(server.teams)};
       fbRef = firebase.database().ref(dbPath('state'));
       fbConnKnown = true; fbConnected = true; remoteReady = true; dataEditPending = false; remoteRefetchPending = false;
       lastSyncedTree = syncedSnapshot();                       // what the first pull confirmed: only edits are sent from here
       clearTimeout(pushTimer); pushTimer = null;
       pushConfigured = () => false;
       askDialog = async () => 'keep';
       showToast = () => {};
       state.ui.view = 'settings'; state.ui.builderScreen = 'teams'; undoClear();`);
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
  p.fill = (name, value) => run(`document.getElementById('team-${name}').value = ${JSON.stringify(value)}`);
  p.stop = () => { try { run('clearTimeout(pushTimer); clearTimeout(pushConfigTimer);'); } catch (e) { /* ignore */ } };
  return p;
}

const val = async (db, path) => (await get(ref(db, path))).val();
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

for (const R of ROOTS) {
  const ed = () => h.as(ED);
  const state = (p) => val(ed(), `${R}/state/${p}`);
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const seed = async () => {
    // the roster as every device holds it after the first push: one whole array
    const { ctx } = makeContext({ camp });
    const teams = JSON.parse(vm.runInContext('JSON.stringify(makeFreshState().teams)', ctx));
    // arranged with the rules off (each case starts from the same server: a whole roster, no photos)
    await h.seed(async (db) => {
      await set(ref(db, `${R}/state/teams`), teams);
      await set(ref(db, `${R}/teamPhotos`), null);
    });
    return { teams };
  };

  await s.t(`${R}: a rename that takes the suggested short name and emoji is per-field paths, all accepted, and what the server holds`, async () => {
    const server = await seed();
    const d = await phone(R, ED, 'editor', server);
    d.run(`teamOpen('t0')`);
    d.fill('name', 'Mighty Hawks');
    d.run(`teamSave()`);
    if (!d.run('!!(teamUi.edit && teamUi.edit.ask)')) throw new Error('the rename question was not asked');
    d.run(`teamAnswerRename('suggest')`);
    await d.flush();
    const t0 = await state('teams/0');
    if (!t0 || t0.name !== 'Mighty Hawks' || t0.short !== 'Hawks' || t0.emoji !== '🦅') throw new Error('server team: ' + JSON.stringify(t0));
    const paths = d.writes.flatMap((w) => w.keys).filter((k) => k !== 'meta/lastDataChangeAt');
    if (!paths.length || !paths.every((k) => /^teams\/0\/(name|short|emoji)$/.test(k))) throw new Error('the paths sent were not per-field teams/0/*: ' + JSON.stringify(paths));
    if (d.run('Object.keys(stateQuarantine).length')) throw new Error('a write was refused and parked');
    d.stop();
  });

  await s.t(`${R}: a colour from the sheet, and another team's colour from "Pick colours for the flagged teams", are accepted`, async () => {
    const server = await seed();
    const d = await phone(R, ED, 'editor', server);
    d.run(`teamOpen('t1'); teamPickColor('indigo'); teamSave();`);
    d.run(`teamColorSet('t2', 'teal')`);
    await d.flush();
    if ((await state('teams/1/color')) !== 'indigo') throw new Error('t1 colour: ' + (await state('teams/1/color')));
    if ((await state('teams/2/color')) !== 'teal') throw new Error('t2 colour: ' + (await state('teams/2/color')));
    if (d.run('Object.keys(stateQuarantine).length')) throw new Error('a write was refused and parked');
    d.stop();
  });

  await s.t(`${R}: a photo upload is one set() of { v, data } then photoV, both accepted; a counselor reads the crest; the record carries the same version`, async () => {
    const server = await seed();
    const d = await phone(R, ED, 'editor', server);
    const big = bigPng(100000);
    const r = await d.run(`teamPhotoUpload('t0', ${JSON.stringify(big)}).then((x) => JSON.stringify(x))`);
    const res = JSON.parse(r);
    if (!res.ok) throw new Error('upload: ' + r);
    await d.flush();
    const node = await val(ed(), `${R}/teamPhotos/t0`);
    if (!node || node.v !== res.v || node.data !== big) throw new Error('teamPhotos/t0: ' + JSON.stringify(node).slice(0, 120));
    if ((await state('teams/0/photoV')) !== res.v) throw new Error('photoV: ' + (await state('teams/0/photoV')));
    const first = d.writes.find((w) => w.op === 'set');
    if (!first || !/teamPhotos\/t0$/.test(first.path) || first.keys.sort().join() !== 'data,v') throw new Error('the node was not written as { v, data }: ' + JSON.stringify(first && first.keys));
    const crest = await val(h.as(VW), `${R}/teamPhotos/t0/v`);
    if (crest !== res.v) throw new Error('a counselor could not read the crest version: ' + crest);
    // Replacing it: the version goes up, the node is the new picture.
    const r2 = JSON.parse(await d.run(`teamPhotoUpload('t0', ${JSON.stringify(PNG)}).then((x) => JSON.stringify(x))`));
    if (!r2.ok || !(r2.v > res.v)) throw new Error('replace: ' + JSON.stringify(r2));
    await d.flush();
    if ((await val(ed(), `${R}/teamPhotos/t0/data`)) !== PNG) throw new Error('the node did not take the new picture');
    d.stop();
  });

  await s.t(`${R}: Remove photo is a null photoV, accepted, and leaves the node (so Undo can put the version back)`, async () => {
    const server = await seed();
    const d = await phone(R, ED, 'editor', server);
    const res = JSON.parse(await d.run(`teamPhotoUpload('t0', ${JSON.stringify(PNG)}).then((x) => JSON.stringify(x))`));
    await d.flush();
    d.run(`teamOpen('t0'); teamPhotoRemove();`);
    await d.flush();
    if ((await state('teams/0/photoV')) !== null) throw new Error('photoV is still on the server');
    if ((await val(ed(), `${R}/teamPhotos/t0/v`)) !== res.v) throw new Error('the photo node should have stayed');
    d.run(`undoEntry(undoRecent()[0].id)`);
    await d.flush();
    if ((await state('teams/0/photoV')) !== res.v) throw new Error('Undo did not put the version back: ' + (await state('teams/0/photoV')));
    d.stop();
  });

  await s.t(`${R}: what the client refuses to send (a hostile short name or emoji, a photo over the cap or of another type) never reaches the database`, async () => {
    const server = await seed();
    const d = await phone(R, ED, 'editor', server);
    d.run(`teamOpen('t0')`);
    d.fill('short', '<b>Foxes</b>'); d.run('teamSave()');
    d.fill('short', 'Foxes'); d.fill('emoji', '"onmouseover="x'); d.run('teamSave()');
    const bad = [bigPng(100001), 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA" onerror="x'];
    for (const b of bad) {
      const x = JSON.parse(await d.run(`teamPhotoUpload('t0', ${JSON.stringify(b)}).then((x) => JSON.stringify(x))`));
      if (x.ok || x.reason !== 'format') throw new Error('a bad picture was not refused in the client: ' + JSON.stringify(x));
    }
    await sleep(80);
    if (d.writes.length) throw new Error('the phone wrote: ' + JSON.stringify(d.writes));
    d.stop();
  });

  await s.t(`${R}: a backup full of hostile branding is cleaned on the way in, so what is pushed is accepted and the server holds none of it`, async () => {
    const server = await seed();
    const d = await phone(R, ED, 'editor', server);
    const file = JSON.stringify(server.teams.map((t, i) => (i === 0
      ? Object.assign({}, t, { short: '<img src=x onerror=alert(1)>', emoji: '<script>', color: 'red" onerror="x', photoV: -5 })
      : Object.assign({}, t, { short: 'Tidy', emoji: '🐝', color: 'slate', photoV: 99 }))));
    d.run(`state.teams = teamsFromBackup(${file}); saveState();`);
    await d.flush();
    const teams = await state('teams');
    const t0 = teams[0], t1 = teams[1];
    if (t0.short !== undefined || t0.emoji !== undefined || t0.color !== undefined || t0.photoV !== undefined) throw new Error('hostile branding reached the server: ' + JSON.stringify(t0));
    if (t1.short !== 'Tidy' || t1.emoji !== '🐝' || t1.color !== 'slate') throw new Error('honest branding should have gone through: ' + JSON.stringify(t1));
    if (t1.photoV !== undefined) throw new Error('a backup\'s photo version must never be taken: ' + t1.photoV);
    if (d.run('Object.keys(stateQuarantine).length')) throw new Error('a write was refused and parked');
    d.stop();
  });

  await s.t(`${R}: a counselor's phone opens none of it and writes nothing; a raw counselor write of a team field or a photo is refused`, async () => {
    const server = await seed();
    const d = await phone(R, VW, 'viewer', server);
    d.run(`teamOpen('t0'); teamColorSet('t0', 'red'); teamPhotoRemove();`);
    const x = JSON.parse(await d.run(`teamPhotoUpload('t0', ${JSON.stringify(PNG)}).then((x) => JSON.stringify(x))`).catch(() => '{"ok":false}'));
    await sleep(60);
    if (d.run('!!teamUi.edit')) throw new Error('a counselor opened the team sheet');
    if (d.writes.some((w) => w.op === 'update')) throw new Error('a counselor phone wrote state: ' + JSON.stringify(d.writes));
    const vw = h.as(VW);
    await assertFails(set(ref(vw, `${R}/state/teams/0/color`), 'red'));
    await assertFails(set(ref(vw, `${R}/state/teams/0/short`), 'Hax'));
    await assertFails(set(ref(vw, `${R}/teamPhotos/t0`), { v: 1, data: PNG }));
    if (x.ok && (await val(ed(), `${R}/teamPhotos/t0`))) throw new Error('a counselor photo upload reached the database');
    d.stop();
  });
}

clearAllTimers();
await h.done();
s.finish();
