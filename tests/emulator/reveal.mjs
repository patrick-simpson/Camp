// The standings reveal's rules, run for the first time (app-shell-redesign-spec §4.4, BUILD-PLAN Step 10).
// `revealPublic` is the ONE path in either camp that a person with no sign-in may read — the big-screen
// page has no login — so this suite is the proof that "readable by anyone" means exactly that and no
// more: nothing else is readable, nothing at all is writable without a director's sign-in, no unrevealed
// place can sit in the public node, two remotes can't both win a race, a real reveal can't be erased
// before its 08:00 `until`, and a practice can never touch the real one.
import { harness, suite, NEW_RULES, OLD_RULES, ROOTS, OWNER, ED, ED2, VW, NOBODY, ref, set, get, update, remove, TS, sleep, assertFails, assertSucceeds, outcome, RID, startPayload, nextPayload, group, entry } from './lib.mjs';

const s = suite('reveal — the public path, the commands, the shape, the delete');
const h = await harness('reveal', NEW_RULES);
await h.members();
const ed = () => h.as(ED), ed2 = () => h.as(ED2), vw = () => h.as(VW), owner = () => h.as(OWNER), anon = () => h.anon();
const val = async (db, path) => (await get(ref(db, path))).val();
const clear = (R) => h.seed(async (db) => { await remove(ref(db, `${R}/revealPublic`)); await remove(ref(db, `${R}/revealFull`)); });
const ctlOf = (R, mode = 'real') => val(owner(), `${R}/revealPublic/${mode}/ctl`);

for (const R of ROOTS) {
  const pub = `${R}/revealPublic`;
  await clear(R);

  // ── Anonymous ──────────────────────────────────────────────────────────────
  await s.t(`${R}: ANON reads revealPublic and revealPublic/real/ctl — null before any Start`, async () => {
    await assertSucceeds(get(ref(anon(), pub)));
    await assertSucceeds(get(ref(anon(), `${pub}/real/ctl`)));
    await assertSucceeds(get(ref(anon(), `${pub}/practice`)));
    if ((await val(anon(), pub)) !== null) throw new Error('expected null');
  });
  await s.t(`${R}: ANON reads nothing else — revealFull, the camp root, state, config, members, chat, setup, campers`, async () => {
    for (const p of ['revealFull', 'revealFull/real', '', 'state', 'config', 'members', 'chat', 'chat/general', 'chatPhotos', 'setup', 'campers', 'push', 'presence', 'changelog', 'pushSchedule', 'restoreIndex']) {
      await assertFails(get(ref(anon(), p ? `${R}/${p}` : R)));
    }
    await assertFails(get(ref(anon(), 'campScoreboard')));
    await assertFails(get(ref(anon(), 'seniorScoreboard')));
    await assertFails(get(ref(anon(), '/')));
  });
  await s.t(`${R}: ANON writes and deletes NOTHING — not revealPublic, real, practice, ctl, pub, nor a multi-path update`, async () => {
    await assertFails(update(ref(anon(), R), startPayload('real')));
    await assertFails(update(ref(anon(), R), startPayload('practice')));
    await assertFails(set(ref(anon(), `${pub}/real`), { ctl: {} }));
    await assertFails(set(ref(anon(), `${pub}/practice/ctl/seq`), 2));
    await assertFails(set(ref(anon(), `${R}/revealFull/real`), { r: RID }));
    await assertFails(remove(ref(anon(), `${pub}/real`)));
    await assertFails(remove(ref(anon(), `${pub}/practice`)));
    await assertFails(remove(ref(anon(), pub)));
    await assertFails(set(ref(anon(), `${R}/state/x`), 1));
  });
  await s.t(`${R}: a signed-in counselor, a non-member and an unverified email write nothing here either (and read no revealFull)`, async () => {
    await assertFails(update(ref(vw(), R), startPayload('real', { by: VW.key })));
    await assertFails(update(ref(h.as(NOBODY), R), startPayload('real', { by: NOBODY.key })));
    await assertFails(update(ref(h.asUnverified(ED), R), startPayload('real')));
    await assertFails(set(ref(vw(), `${pub}/practice/ctl/seq`), 1));
    await assertFails(get(ref(vw(), `${R}/revealFull`)));
    await assertFails(get(ref(h.as(NOBODY), `${R}/revealFull`)));
    await assertSucceeds(get(ref(vw(), pub)));                                          // counselors read the public feed like anyone
  });

  // ── Editor: Start, commands, races ─────────────────────────────────────────
  await s.t(`${R}: a director's Start is accepted (public ctl + the private full order, one atomic update)`, async () => {
    await assertSucceeds(update(ref(ed(), R), startPayload('real')));
    const ctl = await ctlOf(R);
    if (ctl.seq !== 1 || ctl.shown !== 0 || ctl.phase !== 'intro') throw new Error('Start did not land');
    if ((await val(owner(), `${R}/revealFull/real/r`)) !== RID) throw new Error('revealFull missing');
    await assertSucceeds(get(ref(ed(), `${R}/revealFull`)));                            // directors read the order
  });
  await s.t(`${R}: what an anonymous reader sees after Start: the ctl and no place — and still no revealFull`, async () => {
    const seen = await val(anon(), pub);
    if (!seen.real.ctl || seen.real.pub) throw new Error('unexpected public content: ' + JSON.stringify(seen));
    if (JSON.stringify(seen).includes(ED.key)) throw new Error('a member key leaked into the public node');
    await assertFails(get(ref(anon(), `${R}/revealFull/real`)));
  });
  await s.t(`${R}: Next reveals ONE place; a stale seq, the same seq twice, and shown +2 are refused (the two-remotes race)`, async () => {
    const cur = await ctlOf(R);
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { ctl: { seq: cur.seq } })));            // stale seq
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { ctl: { seq: cur.seq + 2 } })));        // skipped seq
    await assertFails(update(ref(ed(), R), Object.assign(nextPayload('real', cur, { shown: 2 }), {           // +2
      [`revealPublic/real/pub/g0`]: group(0) })));
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur)));                                     // the winner
    await assertFails(update(ref(ed2(), R), nextPayload('real', cur)));                                       // the loser (same old ctl)
    const now = await ctlOf(R);
    if (now.seq !== 2 || now.shown !== 1) throw new Error('state after the race: ' + JSON.stringify(now));
    const pubNow = await val(anon(), `${pub}/real/pub`);
    if (Object.keys(pubNow).join() !== 'g0') throw new Error('public places: ' + Object.keys(pubNow));
  });
  await s.t(`${R}: Back and phase commands keep \`sa\`; Next refreshes it`, async () => {
    let cur = await ctlOf(R);
    await sleep(50);
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur, { shown: cur.shown, ctl: { phase: 'live', cur: cur.cur } }))); // same shown: a phase command
    let after = await ctlOf(R);
    if (after.sa !== cur.sa) throw new Error('sa moved on a command that showed nothing');
    if (after.at === cur.at || after.seq !== cur.seq + 1) throw new Error('at/seq did not advance');
    cur = after;
    await sleep(50);
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur)));                                     // Next: shown grows
    after = await ctlOf(R);
    if (after.sa === cur.sa || after.shown !== cur.shown + 1) throw new Error('sa did not refresh on Next');
    // a command that does NOT grow shown but tries to move sa is refused; one that grows shown with a stale sa too
    cur = after;
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { shown: cur.shown, ctl: { sa: TS() } })));
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { ctl: { sa: cur.sa } })));
    // Back: cur steps back, shown never decreases
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur, { shown: cur.shown, ctl: { cur: cur.cur - 1 } })));
    await assertFails(update(ref(ed(), R), nextPayload('real', await ctlOf(R), { shown: cur.shown - 1, ctl: { cur: 0 } })));
  });
  await s.t(`${R}: \`at\` must be server time; \`ca\`, \`startedAt\`, \`until\` and \`finale\` can't change inside a reveal`, async () => {
    const cur = await ctlOf(R);
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { shown: cur.shown, ctl: { at: Date.now() - 5000 } })));
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { shown: cur.shown, ctl: { ca: cur.ca + 1 } })));
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { shown: cur.shown, ctl: { startedAt: Date.now() - 1000 } })));
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { shown: cur.shown, ctl: { until: cur.until + 3600e3 } })));
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { shown: cur.shown, ctl: { finale: !cur.finale } })));
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { shown: cur.shown, ctl: { id: 'rzzzzzzz-aaaa' } })));   // a different id is a Start, not a command
  });
  await s.t(`${R}: a group published EARLY (g5 while shown is 3) is refused, and so is rewriting g0 inside the same reveal`, async () => {
    const cur = await ctlOf(R);
    if (cur.shown < 2) throw new Error('setup: expected a couple of places shown, got ' + cur.shown);
    await assertFails(update(ref(ed(), R), { [`revealPublic/real/pub/g5`]: group(5) }));
    await assertFails(update(ref(ed(), R), { [`revealPublic/real/pub/g${cur.shown}`]: group(cur.shown) }));       // the NEXT place, without moving shown
    await assertFails(update(ref(ed(), R), { [`revealPublic/real/pub/g0`]: group(0) }));                          // a published place can't be rewritten
    await assertFails(set(ref(ed(), `${pub}/real/pub/g0/e/t0/nm`), 'Renamed'));
    await assertFails(update(ref(ed(), R), Object.assign(nextPayload('real', cur, { shown: cur.shown }), { [`revealPublic/real/pub/g5`]: group(5) })));
  });
  await s.t(`${R}: the whole reveal runs to the end: every place, then champion, table, ended — and nothing after ended`, async () => {
    let cur = await ctlOf(R);
    while (cur.shown < 6) { await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur))); cur = await ctlOf(R); }
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur, { shown: 6, ctl: { phase: 'champion', cur: 5 } })));
    cur = await ctlOf(R);
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur, { shown: 6, ctl: { phase: 'table', cur: 5 } })));
    cur = await ctlOf(R);
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur, { shown: 6, ctl: { phase: 'ended', cur: 5, endedAt: TS(), endKind: 'done' } })));
    cur = await ctlOf(R);
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { shown: 6, ctl: { phase: 'live' } })));       // an ended reveal can't be revived
    await assertFails(update(ref(ed(), R), nextPayload('real', cur, { shown: 6, ctl: { endKind: 'early' } })));
    const all = await val(anon(), `${pub}/real/pub`);
    if (Object.keys(all).length !== 6) throw new Error('not all six places public');
  });
  await s.t(`${R}: a NEW Start with a new id replaces the previous reveal (and wipes its places); Start with a stale or future \`ca\` is refused`, async () => {
    await assertFails(update(ref(ed(), R), startPayload('real', { id: 'r2abcdef-9zz1', ctl: { ca: Date.now() - 120000 } })));     // an offline-queued tap replayed later
    await assertFails(update(ref(ed(), R), startPayload('real', { id: 'r2abcdef-9zz1', ctl: { ca: Date.now() + 120000 } })));
    await assertFails(update(ref(ed(), R), startPayload('real', { id: 'r2abcdef-9zz1', ctl: { seq: 2 } })));                     // a Start is seq 1
    await assertFails(update(ref(ed(), R), startPayload('real', { id: 'r2abcdef-9zz1', ctl: { shown: 1, cur: 0 } })));           // and shows nothing
    await assertFails(update(ref(ed(), R), startPayload('real', { id: 'r2abcdef-9zz1', ctl: { phase: 'live' } })));
    await assertFails(update(ref(ed(), R), startPayload('real', { id: 'r2abcdef-9zz1', ctl: { startedAt: Date.now() - 5000 } })));
    await assertFails(update(ref(ed(), R), startPayload('real', { id: 'r2abcdef-9zz1', ctl: { sa: Date.now() - 5000 } })));
    await assertSucceeds(update(ref(ed2(), R), startPayload('real', { id: 'r2abcdef-9zz1', by: ED2.key })));
    const ctl = await ctlOf(R);
    if (ctl.id !== 'r2abcdef-9zz1' || ctl.shown !== 0) throw new Error('replace failed');
    if ((await val(anon(), `${pub}/real/pub`)) !== null) throw new Error('the previous places survived a new Start');
  });

  // ── Shape ──────────────────────────────────────────────────────────────────
  await s.t(`${R}: ctl refuses by / startedBy / name / any unknown field; group and entry refuse extras`, async () => {
    for (const bad of [{ by: 'jenn' }, { startedBy: ED.key }, { name: 'Jenn' }, { member: ED.key }, { extra: 1 }]) {
      await assertFails(update(ref(ed(), R), startPayload('practice', { id: 'r3abcdef-1aa1', ctl: bad })));
    }
    await clear(R);
    await assertSucceeds(update(ref(ed(), R), startPayload('real')));
    const cur = await ctlOf(R);
    const bad = (g) => assertFails(update(ref(ed(), R), nextPayload('real', cur, { group: g })));
    await bad(Object.assign(group(0), { by: 'x' }));
    await bad({ place: 6, e: { t0: Object.assign(entry(0), { startedBy: ED.key }) } });
    await bad({ place: 6, e: { t0: Object.assign(entry(0), { name: 'Jenn' }) } });
    await bad({ place: 6, e: { t0: Object.assign(entry(0), { counselor: 'Jenn' }) } });
    await bad({ place: 6, e: { t6: entry(0) } });                                                 // t6
    await bad({ place: 7, e: { t0: entry(0) } });                                                 // place 7
    await bad({ place: 0, e: { t0: entry(0) } });
    await bad({ place: 6, e: { t0: Object.assign(entry(0), { p: '15' }) } });                     // a string where a number is required
    await bad({ place: 6, e: { t0: Object.assign(entry(0), { g: 100 }) } });
    await bad({ place: 6, e: { t0: Object.assign(entry(0), { p: 100000 }) } });
    await bad({ place: 6, e: { t0: (({ nm, ...rest }) => rest)(entry(0)) } });                    // an entry without nm
    await bad({ place: 6, e: { t0: Object.assign(entry(0), { nm: 'x'.repeat(31) }) } });          // a 31-character name
    await bad({ place: 6, e: { t0: Object.assign(entry(0), { nm: '' }) } });
    await bad({ place: 6, e: { t0: Object.assign(entry(0), { k: 'Gold!' }) } });
    await bad({ place: 6, e: {} });
    await bad({ place: 6 });
    await bad({ e: { t0: entry(0) } });
    await assertFails(update(ref(ed(), R), Object.assign(nextPayload('real', cur), { [`revealPublic/real/pub/g6`]: group(0) })));    // g6
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur, { group: { place: 6, e: { t0: Object.assign(entry(0), { nm: 'x'.repeat(30) }), t1: entry(1) } } }))); // a tie: two entries, 30-char name
  });
  await s.t(`${R}: teams 7, shown 7, cur 6, a string seq, and an unknown phase are refused; a real until over 48 h and a practice until over 3 h too`, async () => {
    await clear(R);
    const start = (mode, ctl) => update(ref(ed(), R), startPayload(mode, { id: 'r4abcdef-2bb2', ctl }));
    await assertFails(start('real', { teams: 7 }));
    await assertFails(start('real', { teams: 1 }));
    await assertFails(start('real', { seq: '1' }));
    await assertFails(start('real', { phase: 'party' }));
    await assertFails(start('real', { v: 10 }));
    await assertFails(start('real', { finale: 'yes' }));
    await assertFails(start('real', { id: 'not-an-id' }));
    await assertFails(start('real', { until: Date.now() + 49 * 3600e3 }));                         // a real reveal can't outlive 48 h
    await assertFails(start('real', { until: Date.now() - 1000 }));                                // nor start already expired
    await assertFails(start('practice', { until: Date.now() + 4 * 3600e3 }));                      // a practice can't outlive 3 h
    await assertFails(start('practice', { until: Date.now() + 3 * 3600e3 + 60e3 }));
    await assertFails(start('real', { epoch: 'e'.repeat(25) }));
    await assertFails(update(ref(ed(), R), { [`revealPublic/live`]: startPayload('real')['revealPublic/real'] }));                 // a third mode
    await assertSucceeds(start('real', { until: Date.now() + 47 * 3600e3, epoch: 'w20270718', finale: true }));
    await assertSucceeds(start('practice', { until: Date.now() + 2.9 * 3600e3 }));
  });

  // ── Delete ─────────────────────────────────────────────────────────────────
  await s.t(`${R}: an editor's delete of REAL before until is refused — directly, as a whole-revealPublic delete, and in a multi-path update`, async () => {
    await clear(R);
    await assertSucceeds(update(ref(ed(), R), startPayload('real')));
    await assertFails(remove(ref(ed(), `${pub}/real`)));
    await assertFails(remove(ref(ed(), pub)));
    await assertFails(set(ref(ed(), pub), null));
    await assertFails(update(ref(ed(), R), { 'revealPublic/real': null, 'revealFull/real': null }));
    await assertFails(remove(ref(ed2(), `${pub}/real/ctl`)));                                       // nor by deleting its ctl
    await assertFails(remove(ref(vw(), `${pub}/real`)));
    if (!(await ctlOf(R))) throw new Error('the real reveal was erased early');
  });
  await s.t(`${R}: ...after until (server clock) it is accepted — the expired node is seeded with rules disabled`, async () => {
    await h.seed((db) => update(ref(db, R), {
      'revealPublic/real/ctl/until': Date.now() - 1000,
    }));
    await assertSucceeds(update(ref(ed(), R), { 'revealPublic/real': null, 'revealFull/real': null }));
    if ((await val(owner(), `${pub}/real`)) !== null) throw new Error('not deleted');
    // and the whole-node delete once expired
    await clear(R);
    await h.seed((db) => update(ref(db, R), startPayload('real', { ctl: { at: Date.now(), sa: Date.now(), startedAt: Date.now(), until: Date.now() - 5000 } })));
    await assertSucceeds(remove(ref(ed2(), pub)));
  });
  await s.t(`${R}: a PRACTICE can be deleted any time by an editor (and never by a counselor); the real one is untouched`, async () => {
    await clear(R);
    await assertSucceeds(update(ref(ed(), R), startPayload('real')));
    await assertSucceeds(update(ref(ed(), R), startPayload('practice', { id: 'r5abcdef-3cc3' })));
    await assertFails(remove(ref(vw(), `${pub}/practice`)));
    await assertSucceeds(update(ref(ed(), R), { 'revealPublic/practice': null, 'revealFull/practice': null }));    // End practice
    if ((await val(anon(), `${pub}/practice`)) !== null || (await val(owner(), `${R}/revealFull/practice`)) !== null) throw new Error('practice survived');
    if (!(await ctlOf(R))) throw new Error('real reveal gone');
  });
  await s.t(`${R}: the OWNER (the new-year wizard) can clear a real reveal at any time; a non-owner director cannot`, async () => {
    await assertFails(remove(ref(ed(), pub)));
    await assertSucceeds(update(ref(owner(), R), { 'revealPublic/real': null, 'revealFull/real': null }));
    await assertSucceeds(update(ref(ed(), R), startPayload('real')));
    await assertSucceeds(remove(ref(owner(), pub)));
  });

  // ── revealFull ─────────────────────────────────────────────────────────────
  await s.t(`${R}: revealFull — a counselor can't read it; r must equal the ctl id; startedBy must be the writer's key`, async () => {
    await clear(R);
    await assertFails(update(ref(ed(), R), startPayload('real', { full: { r: 'rzzzzzzz-aaaa' } })));                // r != ctl id
    await assertFails(update(ref(ed(), R), startPayload('real', { by: ED2.key })));                                 // startedBy is not me
    await assertFails(update(ref(ed(), R), startPayload('real', { full: { startedBy: VW.key } })));
    await assertFails(update(ref(ed(), R), startPayload('real', { full: { extra: 1 } })));
    await assertFails(update(ref(ed(), R), startPayload('real', { full: { n: 7 } })));
    await assertFails(update(ref(ed(), R), startPayload('real', { full: { g: { g0: { place: 6, e: { t0: Object.assign(entry(0), { name: 'x' }) } } } } })));
    await assertFails(update(ref(vw(), R), { 'revealFull/real': startPayload('real', { by: VW.key })['revealFull/real'] }));
    await assertSucceeds(update(ref(ed(), R), startPayload('real')));
    await assertFails(get(ref(vw(), `${R}/revealFull/real`)));
    await assertFails(get(ref(vw(), `${R}/revealFull/real/g/g5`)));                                                 // the whole order, even one place of it
    await assertSucceeds(get(ref(ed(), `${R}/revealFull/real/g/g5`)));
    // a second director may carry the first one's startedBy unchanged, but can't write a key that isn't their own
    await assertFails(set(ref(ed2(), `${R}/revealFull/real/startedBy`), VW.key));
    await assertSucceeds(set(ref(ed2(), `${R}/revealFull/real/startedBy`), ED.key));
  });

  // ── Practice isolation ─────────────────────────────────────────────────────
  await s.t(`${R}: a PRACTICE Start, Next, Next and End leaves \`real\` byte-identical`, async () => {
    await clear(R);
    await assertSucceeds(update(ref(ed(), R), startPayload('real')));
    let cur = await ctlOf(R);
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', cur)));
    const realBefore = JSON.stringify([await val(owner(), `${pub}/real`), await val(owner(), `${R}/revealFull/real`)]);
    await assertSucceeds(update(ref(ed(), R), startPayload('practice', { id: 'r6abcdef-4dd4' })));
    let p = await ctlOf(R, 'practice');
    await assertSucceeds(update(ref(ed(), R), nextPayload('practice', p)));
    p = await ctlOf(R, 'practice');
    await assertSucceeds(update(ref(ed(), R), nextPayload('practice', p)));
    await assertFails(update(ref(ed(), R), { 'revealPublic/practice/ctl/seq': 99 }));                                // still guarded
    await assertSucceeds(update(ref(ed(), R), { 'revealPublic/practice': null, 'revealFull/practice': null }));
    const realAfter = JSON.stringify([await val(owner(), `${pub}/real`), await val(owner(), `${R}/revealFull/real`)]);
    if (realBefore !== realAfter) throw new Error('the real reveal changed under a practice');
  });
}

// ── inert until published ──
const old = await harness('reveal-old', OLD_RULES);
await old.members();
await s.t('under the pre-R1 rules the public path does not exist: an unauthenticated read is DENIED (the proof R1 is live is that it answers null)', async () => {
  for (const R of ROOTS) {
    if ((await outcome(() => get(ref(old.anon(), `${R}/revealPublic`)))) !== 'denied') throw new Error('allowed under old rules');
    if ((await outcome(() => get(ref(old.as(ED), `${R}/revealFull`)))) !== 'denied') throw new Error('revealFull readable under old rules');
    if ((await outcome(() => update(ref(old.as(ED), R), startPayload('real')))) !== 'denied') throw new Error('Start accepted under old rules');
  }
  const live = await harness('reveal-live-check', NEW_RULES);
  for (const R of ROOTS) {
    const r = await outcome(() => get(ref(live.anon(), `${R}/revealPublic`)));
    if (r !== 'ok') throw new Error('R1 should answer an anonymous read of revealPublic with null, got ' + r);
  }
  await live.done();
});
await old.done();
await h.done();
s.finish();
