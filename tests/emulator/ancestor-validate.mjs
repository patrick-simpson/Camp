// The ancestor-`.validate` question (setup-rebuild-spec §8.1, §8.6). CLAUDE.md records that RTDB does NOT
// evaluate an ancestor's `.validate` for a deeper write (the known `state/<unknown>/<child>` hole); a
// reviewer's emulator run saw ancestor validates evaluated on the merged data instead. R1 is written so it
// DOES NOT DEPEND on which is true: every block field carries its own anchor, and the record-level
// `hasChildren` is defence in depth. This suite
//   1. runs the one-line probe in the EMULATOR and prints what it says (the live database gets the same
//      probe from a browser console before R1, §8.6, and CLAUDE.md records both answers), and
//   2. proves the design claim: with every record-level `.validate` AND every `teams` node validate STRIPPED
//      out of the rules (so only the leaf anchors are left), a field write into a deleted block / camper /
//      day / patch is still refused, a team flag included (its `$tid` leaf carries the block anchor too — the
//      teams node's own validate is exactly an ancestor of that leaf).
import { harness, suite, NEW_RULES, ROOTS, ED, ref, set, get, update, remove, assertFails, assertSucceeds, outcome } from './lib.mjs';

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
  strip(r.setup.typical.$bid.teams);
  strip(r.setup.dayBlocks.$dk.$bid.teams);
  strip(r.setup.patches.$dk.$bid.teams);
}
const h = await harness('ancestor-leaf-only', JSON.stringify(rules));
await h.members();
const ed = () => h.as(ED);
await s.t(`record-level and teams-node validates stripped from ${stripped} nodes (both camps)`, async () => { if (stripped !== 16) throw new Error('expected 16 stripped, got ' + stripped); });

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
  await s.t(`${R}: ...a team flag into a deleted or never-existing block (typical, one-off, patch); a flag into a real block still lands`, async () => {
    await h.seed((db) => remove(ref(db, P('typical/b-team-comp-600'))));
    await assertFails(set(ref(ed(), P('typical/b-gone-123/teams/t0')), true));
    await assertFails(set(ref(ed(), P('typical/b-gone-123/teams')), { t0: true, t1: true }));
    await assertFails(set(ref(ed(), P('dayBlocks/sat/b-sat-gone-540/teams/t0')), true));
    await assertFails(set(ref(ed(), P('patches/mon/b-gone-123/teams/t1')), true));   // mon uses the typical day, but the block is gone
    await assertFails(set(ref(ed(), P('patches/mon/b-gone-123/teams')), { t1: true }));
    for (const gone of ['typical/b-gone-123', 'dayBlocks/sat/b-sat-gone-540', 'patches/mon/b-gone-123']) {
      if ((await get(ref(ed(), P(gone)))).exists()) throw new Error(gone + ' was resurrected as a half block');
    }
    // controls: a real typical block takes a flag, and a patch for it on a typical day too (and not on an own day)
    await assertSucceeds(set(ref(ed(), P('typical/b-team-comp-600')), block));
    await assertSucceeds(set(ref(ed(), P('typical/b-team-comp-600/teams/t0')), true));
    await assertSucceeds(set(ref(ed(), P('patches/tue/b-team-comp-600/teams/t1')), true));
    await assertFails(set(ref(ed(), P('patches/sat/b-team-comp-600/teams/t1')), true));   // sat is its own day (typical: false)
    await assertSucceeds(remove(ref(ed(), P('patches/tue/b-team-comp-600'))));
  });
  await s.t(`${R}: ...and a camper's name or ord`, async () => {
    await assertFails(set(ref(ed(), `${R}/campers/t0/c-abc123def4/name`), 'Zombie'));
    await assertFails(set(ref(ed(), `${R}/campers/t0/c-abc123def4/ord`), 5));
  });
}
await h.done();
s.finish();
