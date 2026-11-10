// The OWNER-only acts (decision Q8, setup-rebuild-spec §8.8 owner-only.mjs): turning a section on or off,
// the new-year wizard's claim, the epoch pair, and the archive / pre-wizard restore kinds. No new role is
// added — the member record's shape is untouched; the rules compare the caller to ONE literal, the same
// key the members rule already makes immutable.
//
// It also RECORDS, rather than assumes, what a non-owner director's DELETE of these does. `.validate`
// isn't evaluated for a delete, so a delete is gated only by the node's `.write` (editor): the printed
// RECORDED lines are what CLAUDE.md quotes (§1.4 limit b).
import { harness, suite, NEW_RULES, ROOTS, OWNER, ED, VW, PHONE_OWNER_LOOKALIKE, ref, set, get, update, remove, runTransaction, TS, assertFails, assertSucceeds, outcome } from './lib.mjs';
import { buildSeed } from './camp-data.mjs';

const s = suite('owner-only — Q8, the acts only the owner can do');
const h = await harness('owner', NEW_RULES);
await h.members({ [PHONE_OWNER_LOOKALIKE]: { role: 'editor', name: 'Phone Director', addedBy: 'seed', addedAt: '2026-11-02' } });
const owner = () => h.as(OWNER), ed = () => h.as(ED), vw = () => h.as(VW), phone = () => h.asPhone(PHONE_OWNER_LOOKALIKE);
const SEEDS = { campScoreboard: buildSeed('junior'), seniorScoreboard: buildSeed('senior') };
const point = (by, kind) => ({ at: TS(), byKey: by, kind, label: 'A point', bytes: 100, hash: 'abcd1234' });
const clone = (x) => JSON.parse(JSON.stringify(x));
const RECORDED = [];

for (const R of ROOTS) {
  const P = (p) => `${R}/setup/${p}`;
  const reset = () => h.seed(async (db) => { await remove(ref(db, `${R}/setup`)); await remove(ref(db, `${R}/state/meta`)); await remove(ref(db, `${R}/restoreIndex`)); await remove(ref(db, `${R}/restoreBody`)); });

  await s.t(`${R}: OWNER — A1's whole-setup transaction, on true then false, a claim created and updated`, async () => {
    await reset();
    const seed = clone(SEEDS[R]);
    seed.meta.seeded = { at: TS(), byKey: OWNER.key, from: 'camps.js@v196' };
    await assertSucceeds(runTransaction(ref(owner(), P('')), (cur) => (cur === null ? seed : undefined)));
    await assertSucceeds(set(ref(owner(), P('meta/on/meals')), false));
    await assertSucceeds(set(ref(owner(), P('meta/on/meals')), true));
    await assertSucceeds(set(ref(owner(), P('meta/wizard')), { step: 1, byKey: OWNER.key, at: TS(), fromEpoch: 'legacy' }));
    await assertSucceeds(set(ref(owner(), P('meta/wizard/step')), 2));
    await assertSucceeds(set(ref(owner(), P('meta/wizard/archiveId')), 'rp-archive-pre20270601-k3f9'));
    await assertSucceeds(set(ref(owner(), P('meta/wizard/answers')), '{"weekStart":"2027-07-18"}'));
  });

  await s.t(`${R}: OWNER — the wizard commit's shape: setup epoch + state epoch + epochAt in ONE atomic root update`, async () => {
    await assertSucceeds(update(ref(owner(), R), {
      'setup/meta/epoch': 'w20270718', 'setup/meta/epochAt': TS(),
      'state/meta/epoch': 'w20270718', 'state/meta/epochAt': TS(),
    }));
    await assertSucceeds(update(ref(owner(), R), { 'setup/meta/epoch': 'w20270718-2', 'state/meta/epoch': 'w20270718-2' }));
  });

  await s.t(`${R}: OWNER — an archive and a pre-wizard restore point`, async () => {
    for (const kind of ['archive', 'pre-wizard']) {
      await assertSucceeds(update(ref(owner(), R), { [`restoreIndex/rp-${kind}-aaaa`]: point(OWNER.key, kind), [`restoreBody/rp-${kind}-aaaa`]: '{}' }));
    }
  });

  await s.t(`${R}: NON-OWNER director — A1's transaction is refused as a whole (nothing lands)`, async () => {
    await reset();
    const seed = clone(SEEDS[R]);
    await assertFails(runTransaction(ref(ed(), P('')), (cur) => (cur === null ? seed : undefined)));
    const back = (await get(ref(owner(), P('')))).val();
    if (back !== null) throw new Error('part of the seed landed');
  });

  await s.t(`${R}: NON-OWNER director — turning a section on, off or on again is refused; the rest of setup is theirs`, async () => {
    await h.seed((db) => set(ref(db, P('')), { meta: { schema: 1, on: { schedule: true }, weekStart: '2027-07-18' }, days: { mon: { typical: true } } }));
    await assertFails(set(ref(ed(), P('meta/on/meals')), true));                       // absent -> on
    await assertFails(set(ref(ed(), P('meta/on/schedule')), false));                   // on -> off
    await assertFails(update(ref(ed(), P('meta/on')), { schedule: false, meals: true }));
    await assertSucceeds(set(ref(ed(), P('meta/weekStart')), '2027-07-25'));            // ordinary meta is any editor's
    await assertSucceeds(set(ref(ed(), P('meta/finaleDow')), 5));
    await assertSucceeds(set(ref(ed(), P('days/mon/tag')), 'Competition day 1'));
  });

  await s.t(`${R}: NON-OWNER director — an UNCHANGED on / epoch carried in a whole-node write is accepted`, async () => {
    await h.seed((db) => update(ref(db, R), { 'setup/meta/on/schedule': true, 'setup/meta/epoch': 'w20270718', 'setup/meta/epochAt': 1700000000000, 'state/meta/epoch': 'w20270718', 'state/meta/epochAt': 1700000000000 }));
    await assertSucceeds(set(ref(ed(), P('meta')), { schema: 1, on: { schedule: true }, epoch: 'w20270718', epochAt: 1700000000000, weekStart: '2027-07-25' }));
    await assertSucceeds(update(ref(ed(), `${R}/state/meta`), { epoch: 'w20270718', epochAt: 1700000000000, lastDataChangeAt: '2027-07-19T10:00:00Z' }));
    await assertSucceeds(set(ref(ed(), `${R}/state/meta/lastDataChangeAt`), '2027-07-19T11:00:00Z'));
    await assertFails(set(ref(ed(), P('meta')), { schema: 1, on: { schedule: false }, epoch: 'w20270718', epochAt: 1700000000000 })); // changes `on`
    await assertFails(set(ref(ed(), P('meta')), { schema: 1, on: { schedule: true }, epoch: 'w20271010', epochAt: 1700000000000 })); // changes the epoch
  });

  await s.t(`${R}: NON-OWNER director — a wizard claim (create or update) and the epoch pair are refused; the commit refuses as a whole`, async () => {
    await h.seed((db) => remove(ref(db, P('meta/wizard'))));
    await assertFails(set(ref(ed(), P('meta/wizard')), { step: 1, byKey: ED.key, at: TS(), fromEpoch: 'legacy' }));
    await h.seed((db) => set(ref(db, P('meta/wizard')), { step: 1, byKey: OWNER.key, at: 1700000000000, fromEpoch: 'legacy' }));
    await assertFails(set(ref(ed(), P('meta/wizard/step')), 2));
    await assertFails(set(ref(ed(), P('meta/wizard/answers')), '{}'));
    await assertFails(set(ref(ed(), P('meta/epoch')), 'w20271010'));
    await assertFails(set(ref(ed(), `${R}/state/meta/epochAt`), TS()));
    await assertFails(update(ref(ed(), R), { 'setup/meta/epoch': 'w20271010', 'setup/meta/epochAt': TS(), 'state/meta/epoch': 'w20271010', 'state/meta/epochAt': TS() }));
    const m = (await get(ref(owner(), P('meta/epoch')))).val();
    if (m !== 'w20270718') throw new Error('the refused commit changed the epoch to ' + m);
  });

  await s.t(`${R}: NON-OWNER director — an archive / pre-wizard point is refused; a manual one is accepted`, async () => {
    for (const kind of ['archive', 'pre-wizard']) {
      await assertFails(update(ref(ed(), R), { [`restoreIndex/rp-${kind}-bbbb`]: point(ED.key, kind), [`restoreBody/rp-${kind}-bbbb`]: '{}' }));
    }
    await assertSucceeds(update(ref(ed(), R), { 'restoreIndex/rp-manual-bbbb': point(ED.key, 'manual'), 'restoreBody/rp-manual-bbbb': '{}' }));
  });

  await s.t(`${R}: VIEWER — refused as before (every write above)`, async () => {
    await assertFails(set(ref(vw(), P('meta/on/schedule')), true));
    await assertFails(set(ref(vw(), P('meta/wizard')), { step: 1, byKey: VW.key, at: TS(), fromEpoch: 'legacy' }));
    await assertFails(set(ref(vw(), `${R}/state/meta/epoch`), 'w20271010'));
    await assertFails(update(ref(vw(), R), { 'restoreIndex/rp-manual-cccc': point(VW.key, 'manual'), 'restoreBody/rp-manual-cccc': '{}' }));
  });

  await s.t(`${R}: a PHONE sign-in is never the owner — a phone director is an ordinary director`, async () => {
    // The owner literal is an email key, not an E.164 number, so no real phone token can equal it
    // (Firebase will not mint a phone_number claim of that shape). A phone-keyed editor works as an editor...
    await h.seed((db) => remove(ref(db, P('meta/wizard'))));
    await assertSucceeds(set(ref(phone(), P('meta/weekStart')), '2027-08-01'));
    await assertFails(set(ref(phone(), P('meta/on/meals')), true));
    await assertFails(set(ref(phone(), P('meta/wizard')), { step: 1, byKey: PHONE_OWNER_LOOKALIKE, at: TS(), fromEpoch: 'legacy' }));
    await assertFails(set(ref(phone(), `${R}/state/meta/epoch`), 'w20271010'));
    // ...and an UNVERIFIED email carrying the owner's address is not the owner either
    await assertFails(set(ref(h.asUnverified(OWNER), P('meta/on/meals')), true));
  });

  await s.t(`${R}: RECORDED — what a non-owner director's DELETE of these does (a delete skips .validate; .write is editor)`, async () => {
    await h.seed((db) => update(ref(db, R), {
      'setup/meta/on/schedule': true, 'setup/meta/epoch': 'w20270718', 'setup/meta/epochAt': 1700000000000,
      'state/meta/epoch': 'w20270718', 'state/meta/epochAt': 1700000000000,
      'setup/meta/wizard': { step: 1, byKey: OWNER.key, at: 1700000000000, fromEpoch: 'legacy' },
    }));
    const probes = {
      'delete setup/meta/on/schedule': () => remove(ref(ed(), P('meta/on/schedule'))),
      'delete setup/meta/epoch': () => remove(ref(ed(), P('meta/epoch'))),
      'delete state/meta/epoch': () => remove(ref(ed(), `${R}/state/meta/epoch`)),
      'delete setup/meta/wizard': () => remove(ref(ed(), P('meta/wizard'))),
      'delete setup/meta/on (whole)': () => remove(ref(ed(), P('meta/on'))),
    };
    for (const [name, fn] of Object.entries(probes)) {
      const r = await outcome(fn);
      RECORDED.push(`${R}: non-owner ${name} -> ${r.toUpperCase()}`);
      s.note(`RECORDED ${R}: non-owner ${name} -> ${r.toUpperCase()}`);
      // Observed 2026-11-02: ALLOWED, as setup-rebuild-spec §1.4 limit b predicted. Pinned so a change
      // (a stricter rule, a different emulator) is noticed and CLAUDE.md's R1 checklist is updated.
      if (r !== 'ok') throw new Error(`behaviour changed: ${name} is now ${r} — update CLAUDE.md's recorded limit`);
    }
  });
}
await h.done();
console.log('\nRECORDED (copy into CLAUDE.md §R1 checklist):');
RECORDED.forEach((l) => console.log('  ' + l));
s.finish();
