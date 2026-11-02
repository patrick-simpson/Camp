// The ancestor-`.validate` question (setup-rebuild-spec §8.1, §8.6). CLAUDE.md records that RTDB does NOT
// evaluate an ancestor's `.validate` for a deeper write (the known `state/<unknown>/<child>` hole); a
// reviewer's emulator run saw ancestor validates evaluated on the merged data instead. R1 is written so it
// DOES NOT DEPEND on which is true: every block field carries its own anchor, and the record-level
// `hasChildren` is defence in depth. This suite
//   1. runs the one-line probe in the EMULATOR and prints what it says (the live database gets the same
//      probe from a browser console before R1, §8.6, and CLAUDE.md records both answers), and
//   2. proves the design claim: with every record-level `.validate` STRIPPED out of the rules (so only the
//      leaf anchors are left), a field write into a deleted block / camper / day / patch is still refused.
import { harness, suite, NEW_RULES, ROOTS, ED, ref, set, update, remove, assertFails, assertSucceeds, outcome } from './lib.mjs';

const s = suite('ancestor-validate — the design must not depend on it');

// ── 1. the probe ────────────────────────────────────────────────────────────
const probeEnv = await harness('ancestor-probe', NEW_RULES);
await probeEnv.members();
const probe = await outcome(() => set(ref(probeEnv.as(ED), 'campScoreboard/state/zzz-probe/x'), 1));
s.note(`PROBE (emulator): editor writes campScoreboard/state/zzz-probe/x = 1  ->  ${probe.toUpperCase()}`);
s.note(probe === 'denied'
  ? 'the emulator EVALUATES ancestor .validate on a deeper write (state/$other:false refused it)'
  : 'the emulator does NOT evaluate ancestor .validate on a deeper write (the known hole: a stray state key lands)');
await probeEnv.done();

// ── 2. leaf anchors alone ───────────────────────────────────────────────────
const rules = JSON.parse(NEW_RULES);
let stripped = 0;
const strip = (node) => { if (node && node['.validate']) { delete node['.validate']; stripped++; } };
for (const R of ROOTS) {
  const r = rules.rules[R];
  strip(r.setup.typical.$bid);
  strip(r.setup.dayBlocks.$dk.$bid);
  strip(r.setup.days.$dk);
  strip(r.campers.$tid.$cid);
  strip(r.setup.meals.$dk.$meal);
}
const h = await harness('ancestor-leaf-only', JSON.stringify(rules));
await h.members();
const ed = () => h.as(ED);
await s.t(`record-level validates stripped from ${stripped} nodes (both camps)`, async () => { if (stripped !== 10) throw new Error('expected 10 stripped, got ' + stripped); });

for (const R of ROOTS) {
  const P = (p) => `${R}/setup/${p}`;
  const block = { start: 600, end: 660, label: 'Team competitions', emoji: '🏅', type: 'games', ord: 10 };
  await h.seed((db) => set(ref(db, P('')), { meta: { schema: 1, on: { schedule: true } }, days: { mon: { typical: true }, tue: { typical: true }, sat: { typical: false } }, typical: { 'b-team-comp-600': block } }));
  await h.seed((db) => remove(ref(db, P('typical/b-team-comp-600'))));
  await s.t(`${R}: LEAF ANCHORS ALONE refuse a field write into a deleted typical block (label, end, start, a {start,end} move, a lone label)`, async () => {
    await assertFails(set(ref(ed(), P('typical/b-team-comp-600/label')), 'Zombie'));
    await assertFails(set(ref(ed(), P('typical/b-team-comp-600/end')), 700));
    await assertFails(set(ref(ed(), P('typical/b-team-comp-600/type')), 'games'));
    await assertFails(set(ref(ed(), P('typical/b-team-comp-600/start')), 700));
    await assertFails(update(ref(ed(), P('typical/b-team-comp-600')), { start: 700, end: 760 }));
    await assertFails(update(ref(ed(), P('typical/b-team-comp-600')), { label: 'Only a label' }));
    await assertSucceeds(set(ref(ed(), P('typical/b-team-comp-600')), block));          // a whole record is still fine
    await assertSucceeds(set(ref(ed(), P('typical/b-team-comp-600/label')), 'Renamed'));
  });
  await s.t(`${R}: ...a one-off, a deleted day, a meal and a patch for a deleted typical block`, async () => {
    await assertFails(set(ref(ed(), P('dayBlocks/sat/b-sat-brunch-540/label')), 'Zombie'));
    await assertFails(set(ref(ed(), P('days/wed/tag')), 'Competition day 3'));
    await assertFails(set(ref(ed(), P('meals/mon/lunch/emoji')), '🌯'));
    await h.seed((db) => remove(ref(db, P('typical/b-team-comp-600'))));
    await assertFails(set(ref(ed(), P('patches/tue/b-team-comp-600/label')), 'Orphan'));
    await assertFails(set(ref(ed(), P('patches/tue/b-team-comp-600/teams')), { t0: true }));
  });
  await s.t(`${R}: ...and a camper's name or ord`, async () => {
    await assertFails(set(ref(ed(), `${R}/campers/t0/c-abc123def4/name`), 'Zombie'));
    await assertFails(set(ref(ed(), `${R}/campers/t0/c-abc123def4/ord`), 5));
  });
}
await h.done();
s.finish();
