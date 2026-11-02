// `<root>/campers` under R1 (setup-rebuild-spec §8.8 campers.mjs): minors' first names. EDITOR-only
// read — a counselor is refused at the root, per team and per leaf — and every container is a branch.
import { harness, suite, NEW_RULES, OLD_RULES, ROOTS, ED, VW, NOBODY, ref, set, get, update, remove, assertFails, assertSucceeds, outcome } from './lib.mjs';

const s = suite('campers — editor-only names');
const h = await harness('campers', NEW_RULES);
await h.members();
const ed = () => h.as(ED), vw = () => h.as(VW);

for (const R of ROOTS) {
  const P = (p) => `${R}/campers${p ? '/' + p : ''}`;
  await s.t(`${R}: an editor creates a whole camper and reads it back`, async () => {
    await assertSucceeds(set(ref(ed(), P('t0/c-abc123def4')), { name: 'Ava', ord: 10 }));
    await assertSucceeds(get(ref(ed(), P('t0'))));
    await assertSucceeds(update(ref(ed(), P('t0/c-abc123def4')), { name: 'Avery', ord: 20 }));
  });
  await s.t(`${R}: a viewer is refused at the root, per team and per leaf (read AND write); strangers too`, async () => {
    for (const p of ['', 't0', 't0/c-abc123def4', 't0/c-abc123def4/name']) {
      await assertFails(get(ref(vw(), P(p))));
      await assertFails(get(ref(h.as(NOBODY), P(p))));
      await assertFails(get(ref(h.anon(), P(p))));
    }
    await assertFails(set(ref(vw(), P('t0/c-vwvwvw0001')), { name: 'Nope', ord: 1 }));
  });
  await s.t(`${R}: a name write into a DELETED camper is refused (the anchor pair), and a rename into a live one works`, async () => {
    await h.seed((db) => remove(ref(db, P('t0/c-abc123def4'))));
    await assertFails(set(ref(ed(), P('t0/c-abc123def4/name')), 'Zombie'));
    await assertFails(set(ref(ed(), P('t0/c-abc123def4/ord')), 5));
    await assertSucceeds(set(ref(ed(), P('t0/c-abc123def4')), { name: 'Ava', ord: 10 }));
    await assertSucceeds(set(ref(ed(), P('t0/c-abc123def4/name')), 'Ava B.'));
  });
  await s.t(`${R}: a scalar at campers, at a team, or at a camper is refused (sec-F9); so is a huge string`, async () => {
    await assertFails(set(ref(ed(), P()), 'x'));
    await assertFails(set(ref(ed(), P('t0')), 'x'));
    await assertFails(set(ref(ed(), P('t0/c-abc123def4')), 'x'));
    await assertFails(set(ref(ed(), P('t0')), 'x'.repeat(100000)));
    await assertFails(set(ref(ed(), P('t0/c-abc123def5')), { name: 'x'.repeat(41), ord: 1 }));
  });
  await s.t(`${R}: unknown children, bad team and camper ids, and a missing ord are refused`, async () => {
    await assertFails(set(ref(ed(), P('t0/c-abc123def6')), { name: 'Ava', ord: 1, age: 9 }));
    await assertFails(set(ref(ed(), P('t0/c-abc123def6')), { name: 'Ava' }));
    await assertFails(set(ref(ed(), P('team0/c-abc123def6')), { name: 'Ava', ord: 1 }));
    await assertFails(set(ref(ed(), P('t0/camper-1')), { name: 'Ava', ord: 1 }));
  });
}
const old = await harness('campers-old', OLD_RULES);
await old.members();
await s.t('under the pre-R1 rules the node does not exist for anyone (inert until the paste)', async () => {
  for (const R of ROOTS) {
    if ((await outcome(() => get(ref(old.as(ED), `${R}/campers`)))) !== 'denied') throw new Error('read allowed');
    if ((await outcome(() => set(ref(old.as(ED), `${R}/campers/t0/c-abc123def4`), { name: 'A', ord: 1 }))) !== 'denied') throw new Error('write allowed');
  }
});
await old.done();
await h.done();
s.finish();
