// `<root>/setup` under the R1 rules (setup-rebuild-spec §8.8 setup.mjs): the seeded week of BOTH
// camps is accepted, viewers read but can't write, and every way to resurrect half a deleted
// record, patch a day that doesn't use the typical day, forge a stamp, or drop a scalar where a
// tree belongs is refused.
import { harness, suite, NEW_RULES, OLD_RULES, ROOTS, OWNER, ED, ED2, VW, NOBODY, ref, set, get, update, remove, runTransaction, TS, assertFails, assertSucceeds, outcome } from './lib.mjs';
import { buildSeed, ALL_SECTIONS } from './camp-data.mjs';

const s = suite('setup — seeded weeks, anchors, patches, stamps, shapes');
const h = await harness('setup', NEW_RULES);
await h.members();

const SEEDS = { campScoreboard: buildSeed('junior'), seniorScoreboard: buildSeed('senior') };
// Step 20's switches: the same, with meals, verses, cleanup and (junior) electives seeded too
const SEEDS_ALL = { campScoreboard: buildSeed('junior', ALL_SECTIONS), seniorScoreboard: buildSeed('senior', ALL_SECTIONS) };
const owner = () => h.as(OWNER), ed = () => h.as(ED), vw = () => h.as(VW);
const block = (over) => Object.assign({ start: 600, end: 660, label: 'Team competitions', emoji: '🏅', type: 'games', ord: 10 }, over || {});
// a small valid tree to arrange state for refusal cases (rules disabled)
const base = () => ({
  meta: { schema: 1, on: { schedule: true } },
  days: { mon: { typical: true }, tue: { typical: true }, sat: { typical: false } },
  typical: { 'b-team-comp-600': block({ alertKey: 'team-competitions' }) },
  patches: { tue: { 'b-team-comp-600': { label: 'Team competitions — Tue' } } },
  dayBlocks: { sat: { 'b-sat-brunch-540': block({ start: 540, end: 600, label: 'Brunch' }) } },
});

for (const R of ROOTS) {
  const P = (p) => `${R}/setup${p ? '/' + p : ''}`;
  const camp = R === 'campScoreboard' ? 'junior' : 'senior';

  await s.t(`${camp}: the seeded week is accepted whole (A1's transaction, run as the owner)`, async () => {
    await h.seed((db) => remove(ref(db, P())));
    const seed = SEEDS[R];
    seed.meta.seeded = { at: TS(), byKey: OWNER.key, from: 'camps.js@v196' };
    // a transaction is how A1 seeds: it only writes into a node that is still empty
    await assertSucceeds(runTransaction(ref(owner(), P()), (cur) => (cur === null ? seed : undefined)));
    const back = (await get(ref(owner(), P('typical')))).val();
    if (Object.keys(back).length !== Object.keys(seed.typical).length) throw new Error('typical day did not round-trip');
  });

  await s.t(`${camp}: the ALL-sections seed (Step 20: meals, verses, cleanup${camp === 'junior' ? ', electives' : ''}) is accepted whole, and a non-owner's copy is refused`, async () => {
    await h.seed((db) => remove(ref(db, P())));
    const seed = JSON.parse(JSON.stringify(SEEDS_ALL[R]));
    for (const k of ['meals', 'verses', 'cleanup'].concat(camp === 'junior' ? ['electives'] : [])) if (!seed.meta.on[k]) throw new Error(k + ' is not in the all-sections seed');
    seed.meta.seeded = { at: TS(), byKey: OWNER.key, from: 'camps.js@v200' };
    await assertFails(set(ref(ed(), P()), JSON.parse(JSON.stringify(seed))));
    await assertSucceeds(runTransaction(ref(owner(), P()), (cur) => (cur === null ? seed : undefined)));
    const back = (await get(ref(owner(), P()))).val();
    if (camp === 'junior' && !(back.electives && back.electives.stations && back.electives.slots)) throw new Error('junior electives (stations and slots) did not round-trip');
    if (!back.meals && camp === 'junior') throw new Error('junior meals did not round-trip');
  });

  await s.t(`${camp}: ...and the same seed written by a NON-owner director is refused (meta/on is the owner's)`, async () => {
    await h.seed((db) => remove(ref(db, P())));
    const seed = JSON.parse(JSON.stringify(SEEDS[R]));
    await assertFails(set(ref(ed(), P()), seed));
  });

  await s.t(`${camp}: a non-owner director CAN edit a section the owner already turned on, field by field`, async () => {
    await h.seed((db) => set(ref(db, P()), JSON.parse(JSON.stringify(SEEDS[R]))));
    const first = Object.keys(SEEDS[R].typical)[0];
    await assertSucceeds(set(ref(ed(), P(`typical/${first}/label`)), 'Renamed by a director'));
    await assertSucceeds(set(ref(ed(), P('meals/mon/breakfast/dish')), 'Pancakes'));
    await assertSucceeds(set(ref(ed(), P('meta/weekStart')), '2027-07-25'));
  });

  await s.t(`${camp}: a viewer reads setup but can't write a thing; a non-member reads nothing`, async () => {
    await assertSucceeds(get(ref(vw(), P('typical'))));
    await assertFails(set(ref(vw(), P('meta/weekStart')), '2027-07-25'));
    await assertFails(set(ref(vw(), P('days/mon/tag')), 'x'));
    await assertFails(get(ref(h.as(NOBODY), P())));
    await assertFails(get(ref(h.anon(), P())));
    await assertFails(set(ref(h.anon(), P('meta/weekStart')), '2027-07-25'));
  });

  // ── anchors: a field write into a deleted record must never recreate half of it ──
  await s.t(`${camp}: a field write into a DELETED typical block is refused (label, end, a {start,end} move)`, async () => {
    await h.seed((db) => set(ref(db, P()), base()));
    await h.seed((db) => remove(ref(db, P('typical/b-team-comp-600'))));
    await assertFails(set(ref(ed(), P('typical/b-team-comp-600/label')), 'Zombie'));
    await assertFails(set(ref(ed(), P('typical/b-team-comp-600/end')), 700));
    await assertFails(update(ref(ed(), P('typical/b-team-comp-600')), { start: 700, end: 760 })); // a time move lands without label
    await assertFails(update(ref(ed(), P('typical/b-team-comp-600')), { label: 'Only a label' }));
  });

  await s.t(`${camp}: a whole-record create is accepted, and a field write into the live record works`, async () => {
    await assertSucceeds(set(ref(ed(), P('typical/b-team-comp-600')), block({ alertKey: 'team-competitions' })));
    await assertSucceeds(update(ref(ed(), P('typical/b-team-comp-600')), { start: 610, end: 670 }));
    await assertSucceeds(set(ref(ed(), P('typical/b-team-comp-600/label')), 'Team competitions!'));
  });

  await s.t(`${camp}: a field write into a DELETED one-off (dayBlocks) is refused`, async () => {
    await h.seed((db) => remove(ref(db, P('dayBlocks/sat/b-sat-brunch-540'))));
    await assertFails(set(ref(ed(), P('dayBlocks/sat/b-sat-brunch-540/label')), 'Zombie'));
    await assertFails(set(ref(ed(), P('dayBlocks/sat/b-sat-brunch-540/off')), true));
  });

  await s.t(`${camp}: a patch for a DELETED typical block is refused — including a team patch`, async () => {
    await h.seed((db) => set(ref(db, P()), base()));
    await h.seed((db) => remove(ref(db, P('typical/b-team-comp-600'))));
    await assertFails(set(ref(ed(), P('patches/tue/b-team-comp-600/label')), 'Orphan'));
    await assertFails(set(ref(ed(), P('patches/tue/b-team-comp-600/teams')), { t0: true, t3: true }));
    await assertFails(set(ref(ed(), P('patches/tue/b-team-comp-600/off')), true));
  });

  await s.t(`${camp}: a patch for a day that does NOT use the typical day is refused (sync-F16b); a live one works`, async () => {
    await h.seed((db) => set(ref(db, P()), base()));
    await assertFails(set(ref(ed(), P('patches/sat/b-team-comp-600/label')), 'Sat is its own day'));
    await assertFails(set(ref(ed(), P('patches/wed/b-team-comp-600/label')), 'Wed has no day record'));
    await assertSucceeds(set(ref(ed(), P('patches/tue/b-team-comp-600/label')), 'Team competitions — Tuesday'));
    await assertSucceeds(set(ref(ed(), P('patches/tue/b-team-comp-600/teams')), { t0: true, t3: true, t4: true })); // same depth as `start`
    await assertSucceeds(set(ref(ed(), P('patches/tue/b-team-comp-600/off')), true));
    await assertFails(set(ref(ed(), P('patches/tue/b-team-comp-600/alertKey')), 'x')); // a patch never carries one
  });

  await s.t(`${camp}: a field write into a deleted DAY is refused`, async () => {
    await h.seed((db) => remove(ref(db, P('days/tue'))));
    await assertFails(set(ref(ed(), P('days/tue/tag')), 'Competition day 2'));
    await assertFails(set(ref(ed(), P('days/tue/placeholder')), true));
    await assertSucceeds(set(ref(ed(), P('days/tue')), { typical: true, tag: 'Competition day 2' }));
  });

  // ── stamps ──
  await s.t(`${camp}: meta/edited needs server time and the writer's own key when WRITTEN`, async () => {
    await h.seed((db) => set(ref(db, P()), base()));
    await assertSucceeds(set(ref(ed(), P('meta/edited/schedule')), { at: TS(), byKey: ED.key }));
    await assertFails(set(ref(ed(), P('meta/edited/meals')), { at: Date.now() - 5000, byKey: ED.key }));   // a client clock
    await assertFails(set(ref(ed(), P('meta/edited/meals')), { at: TS(), byKey: ED2.key }));               // someone else's key
    await assertFails(set(ref(ed(), P('meta/edited/bogus')), { at: TS(), byKey: ED.key }));                // not a section
  });

  await s.t(`${camp}: a whole-setup transaction carrying existing edit stamps and a live wizard claim is accepted (owner)`, async () => {
    await h.seed((db) => set(ref(db, P()), Object.assign(base(), {
      meta: { schema: 1, on: { schedule: true }, edited: { schedule: { at: 1700000000000, byKey: ED2.key } },
        wizard: { step: 2, byKey: OWNER.key, at: 1700000001000, fromEpoch: 'legacy' } },
    })));
    await assertSucceeds(runTransaction(ref(owner(), P()), (cur) => {
      if (!cur) return {};                                                       // first run sees no cache; the SDK re-runs with the server's copy
      cur.meta.on.meals = true;                                                  // A1 for a second section ...
      cur.meta.edited.meals = { at: TS(), byKey: OWNER.key };                    // ... stamps its own edit with server time ...
      return cur;                                                                // ... and carries ED2's stamp and the live claim unchanged
    }));
    const m = (await get(ref(owner(), P('meta')))).val();
    if (m.edited.schedule.at !== 1700000000000 || m.edited.schedule.byKey !== ED2.key) throw new Error('someone else\'s stamp was rewritten');
    if (!m.wizard || m.wizard.step !== 2) throw new Error('the live claim was lost');
  });

  await s.t(`${camp}: a wizard claim with fromEpoch 'legacy' is accepted, with '' refused (sync-F19)`, async () => {
    await h.seed((db) => remove(ref(db, P('meta/wizard'))));
    await assertFails(set(ref(owner(), P('meta/wizard')), { step: 1, byKey: OWNER.key, at: TS(), fromEpoch: '' }));
    await assertSucceeds(set(ref(owner(), P('meta/wizard')), { step: 1, byKey: OWNER.key, at: TS(), fromEpoch: 'legacy' }));
  });

  // ── shapes ──
  await s.t(`${camp}: a scalar or a 100,000-char string at a container is refused (sec-F9)`, async () => {
    await h.seed((db) => set(ref(db, P()), base()));
    const big = 'x'.repeat(100000);
    for (const path of ['typical', 'meals', 'patches', 'dayBlocks', 'cleanup', 'verses', 'electives', 'days']) {
      await assertFails(set(ref(ed(), P(path)), 'hello'));
      await assertFails(set(ref(ed(), P(path)), 7));
      await assertFails(set(ref(ed(), P(path)), big));
    }
    for (const path of ['meals/mon', 'dayBlocks/sat', 'patches/tue', 'cleanup/mon', 'cleanup/mon/lunch', 'electives/slots/mon', 'electives/stations']) {
      await assertFails(set(ref(ed(), P(path)), big));
      await assertFails(set(ref(ed(), P(path)), true));
    }
    await assertFails(set(ref(ed(), P('typical/b-team-comp-600')), big));
  });

  await s.t(`${camp}: unknown children are refused at every named level ($other)`, async () => {
    await h.seed((db) => set(ref(db, P()), base()));
    await assertFails(set(ref(ed(), P('surprise')), { a: 1 }));
    await assertFails(set(ref(ed(), P('meta/surprise')), 1));
    await assertFails(set(ref(ed(), P('days/mon/surprise')), 1));
    await assertFails(set(ref(ed(), P('typical/b-team-comp-600/surprise')), 1));
    await assertFails(update(ref(ed(), P('typical/b-team-comp-600')), { surprise: 1 }));
    await assertFails(set(ref(ed(), P('dayBlocks/sat/b-sat-brunch-540/surprise')), 1));
    await assertFails(set(ref(ed(), P('meals/mon/breakfast')), { dish: 'Eggs', surprise: 1 }));
    await assertFails(set(ref(ed(), P('verses/theme')), { text: 'x', surprise: 1 }));
  });

  await s.t(`${camp}: ids, dates and ranges are pinned (bad day key, bad block id, end before start, hostile emoji)`, async () => {
    await assertFails(set(ref(ed(), P('days/monday')), { typical: true }));
    await assertFails(set(ref(ed(), P('typical/not-a-block-id')), block()));
    await assertFails(set(ref(ed(), P('typical/b-bad-end-600')), block({ start: 600, end: 540 })));
    await assertFails(set(ref(ed(), P('typical/b-bad-time-600')), block({ start: 1500 })));
    await assertFails(set(ref(ed(), P('typical/b-bad-emoji-600')), block({ emoji: '<img src=x onerror=1>' })));
    await assertFails(set(ref(ed(), P('typical/b-bad-type-600')), block({ type: 'party' })));
    await assertFails(set(ref(ed(), P('meals/mon/brunch')), { dish: 'Eggs' }));
    await assertFails(set(ref(ed(), P('meals/mon/lunch')), { dish: 'Wraps', emoji: '"><script>' }));
    await assertFails(set(ref(ed(), P('cleanup/mon/lunch/team9')), true));
    await assertFails(set(ref(ed(), P('verses/days/mon')), { text: 'x', video: 'http://insecure.example/v' }));
    await assertSucceeds(set(ref(ed(), P('typical/b-good-one-600')), block()));
    await assertSucceeds(set(ref(ed(), P('meals/mon/lunch')), { dish: 'Wraps', emoji: '🌯' }));
  });
}

// ── inert until published ──
const old = await harness('setup-old', OLD_RULES);
await old.members();
await s.t('under the pre-R1 rules every setup read and write is refused for everyone (inert until the paste)', async () => {
  for (const R of ROOTS) {
    for (const who of [old.as(OWNER), old.as(VW), old.anon()]) {
      if ((await outcome(() => get(ref(who, `${R}/setup`)))) !== 'denied') throw new Error('read not denied under pre-R1 rules');
    }
    if ((await outcome(() => set(ref(old.as(OWNER), `${R}/setup/meta/weekStart`), '2027-07-25'))) !== 'denied') throw new Error('write not denied');
  }
});
await old.done();
await h.done();
s.finish();
