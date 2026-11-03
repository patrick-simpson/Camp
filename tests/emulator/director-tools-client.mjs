// The REAL client's Tell everyone and Award points writes against the PUBLISHED rules (BUILD-PLAN Step 24): the shipped
// scripts (tests/harness.js's vm and DOM stub, exactly as every unit test loads them) talk to the database emulator under
// database.rules.json through the same thin compat adapter reveal-client.mjs uses (firebase.database().ref(path).update /
// on / once). Nothing here is a copy of the client's logic: a director's phone sends a banner, pins the notice, takes both
// down, awards verse and cleanup points and records, files and removes quick points, and every write it makes is judged by the
// real rules. No rules change belongs to Step 24 — this proves none is needed: `state/announcements`, `state/notice` and
// `state/bonuses` are branches the rules only require to stay branches, so the new `day` field on a custom bonus and the
// whole-notice write are accepted, and a counselor's phone (and a raw counselor write) is refused.
import { createRequire } from 'module';
import vm from 'vm';
import { harness, suite, NEW_RULES, ROOTS, ED, VW, ref, get, update, onValue, assertFails, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const { makeContext, clearAllTimers } = require('../harness.js');

const s = suite('director tools — the real client\'s writes against the real rules');
const h = await harness('director-tools', NEW_RULES);
await h.members();

// firebase.database().ref(path) over a modular Database instance (values round-tripped through JSON so an object made in
// the page's vm realm is a plain object to the SDK).
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
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  return { database };
}

// One phone: a fresh page of the real scripts, signed in as `person` with `role`, its state listener's ref the emulator.
async function phone(R, person, role) {
  const camp = R === 'seniorScoreboard' ? 'senior' : 'junior';
  const { ctx, sandbox } = makeContext({ camp });
  const writes = [];
  sandbox.firebase = compatFirebase(h.as(person), writes);
  const run = (code) => vm.runInContext(code, ctx);
  run(`state = makeFreshState(); migrateState(state); normalizeSyncedState();
       authUser = ${JSON.stringify({ email: person.email })};
       setMemberRole(${JSON.stringify(role)}); memberName = 'Jenn';
       fbRef = firebase.database().ref(dbPath('state'));
       fbConnected = true; remoteReady = true; dataEditPending = false; remoteRefetchPending = false;
       lastSyncedTree = syncedSnapshot();                       // what the first pull confirmed: only edits are sent from here
       clearTimeout(pushTimer); pushTimer = null;
       pushConfigured = () => false;                            // phone alerts are dark: a buzz is not part of the database's story
       askDialog = async () => 'replace';
       showToast = () => {};`);
  const p = { ctx, run, writes };
  p.until = async (code, why, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (run(code)) return; await sleep(25); }
    throw new Error('timed out waiting for ' + (why || code));
  };
  // every debounced push has gone out and been acknowledged
  p.flush = async () => {
    run('flushPendingPush()');
    await p.until('pushTimer == null && pendingWrites === 0 && !dataEditPending', 'the push to be acknowledged');
  };
  p.stop = () => { try { run('clearTimeout(pushTimer); clearTimeout(pushConfigTimer);'); } catch (e) { /* ignore */ } };
  return p;
}

const val = async (db, path) => (await get(ref(db, path))).val();

for (const R of ROOTS) {
  const state = (p) => val(h.as(ED), `${R}/state/${p}`);

  await s.t(`${R}: Tell everyone's banner and pinned notice are accepted, and are what the server holds`, async () => {
    const d = await phone(R, ED, 'editor');
    d.run(`openTool('tell', { from: 'more' }); tell.d = tellFreshDraft(); tell.loaded = true;
           tell.d.text = 'Rain plan. Games move to the gym after lunch.'; tell.d.pin = true; tell.d.ttl = '3h';`);
    const r = await d.run('tellSend().then(() => "sent")');
    if (r !== 'sent') throw new Error('send: ' + r);
    await d.flush();
    const id = d.run('Object.keys(state.announcements)[0]');
    const ann = await state(`announcements/${id}`);
    if (!ann || ann.text !== 'Rain plan. Games move to the gym after lunch.' || ann.ttlMs !== 3 * 3600000 || ann.by !== 'Jenn') throw new Error('announcement: ' + JSON.stringify(ann));
    const notice = await state('notice');
    if (!notice || notice.status !== 'posted' || notice.title !== 'Rain plan' || notice.sub !== 'Games move to the gym after lunch.') throw new Error('notice: ' + JSON.stringify(notice));
    if (d.run('tellComposerBusy()')) throw new Error('the composer still busy after a fully good send');
    d.stop();
  });

  await s.t(`${R}: Take down — the banner leaves (a null write) and the notice goes back to a draft, both accepted`, async () => {
    const d = await phone(R, ED, 'editor');
    // this phone has to know what the server holds (the first pull), or it would diff against an empty state
    const srv = await state('');
    d.run(`state.announcements = ${JSON.stringify(srv.announcements || {})}; state.notice = ${JSON.stringify(srv.notice)}; normalizeSyncedState();
           lastSyncedTree = syncedSnapshot(); openTool('tell', { from: 'more' });`);
    const id = d.run('Object.keys(state.announcements)[0]');
    if (!id) throw new Error('precondition: a banner is up');
    d.run(`tellTakeDown('banner', ${JSON.stringify(id)})`);
    d.run(`tellTakeDown('notice')`);
    await d.flush();
    if ((await state(`announcements/${id}`)) !== null) throw new Error('the banner is still on the server');
    if ((await state('notice/status')) !== 'draft') throw new Error('the notice is not a draft: ' + (await state('notice/status')));
    d.stop();
  });

  await s.t(`${R}: Award points' writes are accepted: a verse slot, a cleanup slot, a custom bonus FILED UNDER A DAY, their removal and a 0`, async () => {
    const d = await phone(R, ED, 'editor');
    d.run(`state.bonuses = {}; lastSyncedTree = syncedSnapshot();
           campNow = () => ({ dow: 3, minutes: 780 }); openTool('award', { from: 'more' });`);
    const t0 = d.run('state.teams[0].id');
    d.run(`awardTapKey({ dataset: { pts: '4' }, closest: (sel) => sel === '.aw-row' ? { dataset: { team: ${JSON.stringify(t0)}, key: 'v-x' } } : sel === '#award-verse-list' ? {} : null })`);
    d.run(`awardTapKey({ dataset: { pts: '3' }, closest: (sel) => sel === '.aw-row' ? { dataset: { team: ${JSON.stringify(t0)}, key: 'c-x', meal: 'Lunch' } } : null })`);
    d.run(`bonusDraft.teams = [${JSON.stringify(t0)}]; bonusDraft.points = '5'; bonusDraft.custom = 'Helped carry the canoes'; awardAdd();`);
    d.run(`bonusDraft.teams = [${JSON.stringify(t0)}]; bonusDraft.points = '2'; bonusDraft.sign = -1; bonusDraft.custom = 'Late'; awardAdd();`);
    await d.flush();
    const b = await state('bonuses');
    const v = b[`verse-${t0}-3`], c = b[`cleanup-${t0}-3-Lunch`];
    if (!v || v.points !== 4 || v.category !== 'verse' || v.day !== 3) throw new Error('verse: ' + JSON.stringify(v));
    if (!c || c.points !== 3 || c.category !== 'cleanup' || c.meal !== 'Lunch') throw new Error('cleanup: ' + JSON.stringify(c));
    const custom = Object.entries(b).filter(([, x]) => x.category === 'custom');
    if (custom.length !== 2 || !custom.every(([, x]) => x.day === 3 && typeof x.at === 'string')) throw new Error('custom: ' + JSON.stringify(custom));
    if (!custom.some(([, x]) => x.points === 5) || !custom.some(([, x]) => x.points === -2)) throw new Error('custom points: ' + JSON.stringify(custom));
    // a 0 clears the verse slot, a removal deletes a ledger entry: both null writes
    d.run(`awardTapKey({ dataset: { pts: '0' }, closest: (sel) => sel === '.aw-row' ? { dataset: { team: ${JSON.stringify(t0)}, key: 'v-x' } } : sel === '#award-verse-list' ? {} : null })`);
    d.run(`removeBonusEntry(${JSON.stringify(custom[0][0])})`);
    await d.flush();
    const after = await state('bonuses');
    if (after[`verse-${t0}-3`] !== undefined) throw new Error('the verse slot was not cleared');
    if (after[custom[0][0]] !== undefined) throw new Error('the entry was not removed');
    if (!after[`cleanup-${t0}-3-Lunch`]) throw new Error('the cleanup slot should have stayed');
    d.stop();
  });

  await s.t(`${R}: a counselor's phone writes nothing (its own guards), and a raw counselor write of any of the three is refused by the rules`, async () => {
    const d = await phone(R, VW, 'viewer');
    d.run(`openTool('tell', { from: 'more' }); openTool('award', { from: 'more' })`);
    if (d.run('toolOpenId()')) throw new Error('a counselor opened a director tool');
    d.run(`tell.d.text = 'Hi'; tellSend(); state.bonuses = {}; bonusDraft.teams = ['t0']; bonusDraft.points = '5'; awardAdd();`);
    await sleep(60);
    if (d.writes.length) throw new Error('a counselor phone wrote: ' + JSON.stringify(d.writes));
    const vw = h.as(VW);
    const at = new Date().toISOString();
    await assertFails(update(ref(vw, `${R}/state`), { 'announcements/zz': { id: 'zz', text: 'x', at, ttlMs: 3600000 } }));
    await assertFails(update(ref(vw, `${R}/state`), { notice: { status: 'posted', title: 'x', sub: '' } }));
    await assertFails(update(ref(vw, `${R}/state`), { 'bonuses/zz': { teamId: 't0', category: 'custom', label: 'x', points: 5, at, day: 3 } }));
    d.stop();
  });

  // Now's own writes (BUILD-PLAN Step 17): a key in the cleanup moment is the Award points slot writer, "Still on this" is ONE per-field
  // meta path (state/meta/overrun, which the rules accept because state/meta only has to be a branch), Take down is the notice's status.
  const NOW_PAGE = `campNow = () => ({ dow: 3, minutes: NOW_MIN }); serverNow = () => NOW_MS;
    cleanupOnRota = (d) => d >= 1 && d <= 5; cleanupTeams = (d, meal) => (d >= 1 && d <= 5 && meal === 'Lunch' ? [state.teams[1].id] : []);`;
  const nowAt = (min) => NOW_PAGE.replace('NOW_MIN', String(min)).replace('NOW_MS', String(Date.UTC(2026, 6, 22, 12, 0, 0) + min * 60000));

  await s.t(`${R}: Now's writes are accepted: a key in the cleanup moment, Still on this (state/meta/overrun) and Take down of the notice`, async () => {
    const d = await phone(R, ED, 'editor');
    const srv = await state('');
    d.run(`state.notice = ${JSON.stringify((srv && srv.notice) || null)}; state.bonuses = ${JSON.stringify((srv && srv.bonuses) || {})}; state.meta = ${JSON.stringify((srv && srv.meta) || {})};
           normalizeSyncedState(); lastSyncedTree = syncedSnapshot(); appStarted = true;`);
    // 1. the cleanup moment, just after lunch: a tap on a key
    const lunchEnd = d.run(`nowBlocks(3).find((x) => x.meal === 'Lunch').end`);
    d.run(nowAt(lunchEnd + 5));
    d.run(`nowRefresh()`);
    const team = d.run(`nowLast.moment && nowLast.moment.teams[0].team`);
    if (!team) throw new Error('precondition: a cleanup moment with a team on it');
    d.run(`nowTapKey({ dataset: { pts: '2' }, closest: () => ({ dataset: { team: ${JSON.stringify(team)}, key: 'c-x' } }) })`);
    // 2. Still on this: a games block that ended with a game still to score
    const gamesEnd = d.run(`nowBlocks(3).find((x) => x.kind === 'games' && gamesForBlock(3, x.b).length).end`);
    d.run(nowAt(gamesEnd + 3));
    d.run(`nowRefresh()`);
    if (!d.run('nowHoldOverrun()')) throw new Error('the offer was not there: ' + JSON.stringify(d.run('nowLast.card.hold')));
    // 3. the notice: posted by a director's writer, taken down from Now
    d.run(`setNoticeStatus('posted')`);
    await d.flush();
    if ((await state('notice/status')) !== 'posted') throw new Error('precondition: the notice is posted');
    d.run(`nowTakeDownNotice()`);
    await d.flush();
    const b = await state('bonuses');
    const e = b && b[`cleanup-${team}-3-Lunch`];
    if (!e || e.points !== 2 || e.category !== 'cleanup' || e.meal !== 'Lunch' || e.day !== 3) throw new Error('cleanup slot: ' + JSON.stringify(e));
    const ov = await state('meta/overrun');
    if (!ov || typeof ov.key !== 'string' || !/^3:/.test(ov.key) || !Number.isFinite(ov.until)) throw new Error('overrun: ' + JSON.stringify(ov));
    if ((await state('notice/status')) !== 'draft') throw new Error('the notice is not a draft: ' + (await state('notice/status')));
    d.stop();
  });

  await s.t(`${R}: a counselor's Now writes nothing — a key, Still on this, Take down — and a raw counselor write of state/meta/overrun is refused`, async () => {
    const d = await phone(R, VW, 'viewer');
    const lunchEnd = d.run(`nowBlocks(3).find((x) => x.meal === 'Lunch').end`);
    d.run(nowAt(lunchEnd + 5));
    d.run(`nowRefresh(); state.notice.status = 'posted';`);
    d.run(`nowTapKey({ dataset: { pts: '3' }, closest: () => ({ dataset: { team: state.teams[1].id, key: 'c-x' } }) }); nowHoldOverrun(); nowTakeDownNotice();`);
    await sleep(60);
    if (d.writes.length) throw new Error('a counselor phone wrote: ' + JSON.stringify(d.writes));
    await assertFails(update(ref(h.as(VW), `${R}/state`), { 'meta/overrun': { key: '3:x', until: Date.now() + 60000 } }));
    d.stop();
  });

  await s.t(`${R}: a director in a counselor PREVIEW writes nothing — every director act refused, the server untouched — and writes again after Exit`, async () => {
    const d = await phone(R, ED, 'editor');
    const srv = await state('');
    d.run(`state.announcements = ${JSON.stringify((srv && srv.announcements) || {})}; state.notice = ${JSON.stringify(srv && srv.notice)}; state.bonuses = ${JSON.stringify((srv && srv.bonuses) || {})}; normalizeSyncedState();
           lastSyncedTree = syncedSnapshot(); appStarted = true; campNow = () => ({ dow: 3, minutes: 780 });`);
    if (!d.run('previewStart()')) throw new Error('the preview did not start for a confirmed director');
    const before = JSON.stringify(await state(''));
    const t0 = d.run('state.teams[0].id');
    // everything a director can do, asked of a phone that is previewing (the screens refuse to open; the writers refuse too)
    d.run(`openTool('tell', { from: 'more' }); openTool('award', { from: 'more' }); openBuilder('games');
           postBanner('Lightning. Everyone inside.', 3600000); setNoticeStatus('posted'); toggleCardHidden('verse');
           setVersePoints(${JSON.stringify(t0)}, 3, 4); setCleanupPoints(${JSON.stringify(t0)}, 3, 'Lunch', 3);
           bonusDraft.teams = [${JSON.stringify(t0)}]; bonusDraft.points = '5'; bonusDraft.category = 'custom'; bonusDraft.custom = 'Spirit'; bonusAddFromDraft({ day: 3 });
           const first = Object.keys(state.announcements || {})[0]; if (first) takeDownBanner(first);
           deleteGame(state.config.games[state.config.games.length - 1].id);
           saveState();`);
    await d.flush();
    await sleep(80);
    if (d.writes.length) throw new Error('a previewing phone wrote: ' + JSON.stringify(d.writes));
    if (JSON.stringify(await state('')) !== before) throw new Error('the server moved under a preview');
    // Exit gives the director's writers back: the same slot, through the same writer, now lands
    d.run('previewStop()');
    d.run(`setVersePoints(${JSON.stringify(t0)}, 3, 4); saveState();`);
    await d.flush();
    const v = (await state('bonuses')) || {};
    if (!v[`verse-${t0}-3`] || v[`verse-${t0}-3`].points !== 4) throw new Error('after Exit the verse write did not land: ' + JSON.stringify(v));
    d.stop();
  });
}

clearAllTimers();
await h.done();
s.finish();
