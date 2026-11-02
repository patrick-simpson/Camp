// `<root>/editorsHere` under R1 (setup-rebuild-spec §8.8 editors-here.mjs): the builder's "Jenn is also
// here" row. Editor-only both ways, pinned to the writer's own key and to server time, one write a
// second. Presence — the old home of this idea — is untouched under both rulesets (sec-F7).
import { harness, suite, NEW_RULES, OLD_RULES, ROOTS, ED, ED2, VW, ref, set, get, update, remove, TS, sleep, assertFails, assertSucceeds } from './lib.mjs';

const s = suite('editorsHere — also here, editors only');
const h = await harness('here', NEW_RULES);
await h.members();
const ed = () => h.as(ED), vw = () => h.as(VW);
const DEV = 'dev12345abcd';

for (const R of ROOTS) {
  const P = (key, d) => `${R}/editorsHere/${key}/${d || DEV}`;
  await s.t(`${R}: an editor writes their own row (at, v, where) and can delete it`, async () => {
    await assertSucceeds(set(ref(ed(), P(ED.key)), { at: TS(), v: 196, where: 'schedule:tue' }));
    await assertSucceeds(get(ref(ed(), `${R}/editorsHere`)));
    await assertSucceeds(remove(ref(ed(), P(ED.key))));
  });
  await s.t(`${R}: another editor's key is refused; so is a viewer's own key; a stranger's`, async () => {
    await assertFails(set(ref(ed(), P(ED2.key)), { at: TS(), v: 1 }));
    await assertFails(set(ref(vw(), P(VW.key)), { at: TS(), v: 1 }));
    await assertFails(set(ref(h.anon(), P(ED.key)), { at: TS(), v: 1 }));
    await assertFails(remove(ref(ed(), P(ED2.key))));
  });
  await s.t(`${R}: a viewer can't read the list (or a single row)`, async () => {
    await h.seed((db) => set(ref(db, P(ED.key)), { at: Date.now() - 10000, v: 1 }));
    await assertFails(get(ref(vw(), `${R}/editorsHere`)));
    await assertFails(get(ref(vw(), P(ED.key))));
    await assertFails(get(ref(h.anon(), `${R}/editorsHere`)));
  });
  await s.t(`${R}: a write without a fresh server-time at is refused; ids, location and extras are pinned`, async () => {
    await h.seed((db) => remove(ref(db, P(ED.key))));
    await assertFails(set(ref(ed(), P(ED.key)), { at: Date.now() - 60000, v: 1 }));
    await assertFails(set(ref(ed(), P(ED.key)), { v: 1 }));
    await assertFails(set(ref(ed(), P(ED.key)), { at: TS(), v: 1, extra: 1 }));
    await assertFails(set(ref(ed(), P(ED.key)), { at: TS(), v: 1, where: 'a/b' }));       // a / in `where`
    await assertFails(set(ref(ed(), P(ED.key)), { at: TS(), v: 100000 }));
    await assertFails(set(ref(ed(), P(ED.key, 'short')), { at: TS(), v: 1 }));             // device id under 8 chars
  });
  await s.t(`${R}: a second write inside one second is refused; after a second it works`, async () => {
    await assertSucceeds(set(ref(ed(), P(ED.key)), { at: TS(), v: 1 }));
    await assertFails(set(ref(ed(), P(ED.key)), { at: TS(), v: 2 }));
    await sleep(1100);
    await assertSucceeds(set(ref(ed(), P(ED.key)), { at: TS(), v: 3 }));
  });
  await s.t(`${R}: presence {at} is unchanged — a member still writes their own row, nobody else's`, async () => {
    await assertSucceeds(set(ref(vw(), `${R}/presence/${VW.key}/dev12345abcd`), { at: TS() }));
    await assertFails(set(ref(vw(), `${R}/presence/${ED.key}/dev12345abcd`), { at: TS() }));
    await assertFails(set(ref(vw(), `${R}/presence/${VW.key}/dev12345abcd`), { at: TS(), role: 'editor' }));
  });
}
// presence behaves the same under the pre-R1 rules (SAFE both ways)
const old = await harness('here-old', OLD_RULES);
await old.members();
await s.t('presence {at} under the pre-R1 rules is the same: own row yes, someone else\'s and a role field no', async () => {
  const R = 'campScoreboard';
  await assertSucceeds(set(ref(old.as(VW), `${R}/presence/${VW.key}/dev12345abcd`), { at: TS() }));
  await assertFails(set(ref(old.as(VW), `${R}/presence/${ED.key}/dev12345abcd`), { at: TS() }));
  await assertFails(set(ref(old.as(VW), `${R}/presence/${VW.key}/dev12345abcd`), { at: TS(), role: 'editor' }));
});
await old.done();
await h.done();
s.finish();
