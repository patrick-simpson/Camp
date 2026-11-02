// `state/brackets4` under R1 (setup-rebuild-spec §8.8 brackets4.mjs): the 4-team bracket's synced key,
// published ahead of its client (BUILD-PLAN Step 22). Refused under the pre-R1 rules (state accepts exactly
// SYNC_KEYS), accepted under the new ones — as a branch, never as a scalar.
import { harness, suite, NEW_RULES, OLD_RULES, ROOTS, ED, VW, ref, set, update, assertFails, assertSucceeds, outcome } from './lib.mjs';

const s = suite('brackets4 — the 4-team bracket key');
const bracket = { kind: 'bracket4', phase: 'semis', matches: { m0: { a: 't0', b: 't1' }, m1: { a: 't2', b: 't3' } } };

const run = async (label, rules) => {
  const h = await harness('b4-' + label, rules);
  await h.members();
  const R = 'seniorScoreboard';
  const out = {};
  out.create = await outcome(() => set(ref(h.as(ED), `${R}/state/brackets4/legacy-game`), bracket));
  out.field = await outcome(() => set(ref(h.as(ED), `${R}/state/brackets4/legacy-game/phase`), 'final'));
  out.scalar = await outcome(() => set(ref(h.as(ED), `${R}/state/brackets4`), 'oops'));
  out.number = await outcome(() => set(ref(h.as(ED), `${R}/state/brackets4`), 7));
  out.viewer = await outcome(() => set(ref(h.as(VW), `${R}/state/brackets4/x`), bracket));
  out.multi = await outcome(() => update(ref(h.as(ED), `${R}/state`), { 'brackets4/g2': bracket, 'results/g2/t0': { gold: 1 } }));
  out.junior = await outcome(() => set(ref(h.as(ED), 'campScoreboard/state/brackets4/g1'), bracket));
  await h.done();
  return out;
};
const before = await run('old', OLD_RULES);
const after = await run('new', NEW_RULES);
console.log('  pre-R1:', JSON.stringify(before));
console.log('  R1    :', JSON.stringify(after));

await s.t('under the pre-R1 rules a brackets4 write is refused (state accepts exactly SYNC_KEYS) — a new client quarantines it', async () => {
  if (before.create !== 'denied' || before.junior !== 'denied') throw new Error('allowed under old rules');
  if (before.multi !== 'denied') throw new Error('the whole multi-path update must be refused together');
});
await s.t('under R1 an editor writes a bracket tree, one field of it, and a multi-path update beside results, in both camps', async () => {
  if (after.create !== 'ok' || after.field !== 'ok' || after.multi !== 'ok' || after.junior !== 'ok') throw new Error(JSON.stringify(after));
});
await s.t('a scalar at brackets4 is refused (it must be a branch), and a viewer can never write it', async () => {
  if (after.scalar !== 'denied' || after.number !== 'denied' || after.viewer !== 'denied') throw new Error(JSON.stringify(after));
});
s.finish();
