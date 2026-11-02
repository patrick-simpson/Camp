// `<root>/accessRequests` and `accessBlocked` under R1 (setup-rebuild-spec §8.8 access-requests.mjs):
// the ONLY node a non-member can write — and it is closed until a director sets setup/meta/joinOpen.
// Measured bypasses of the first draft are pinned here: delete-and-recreate inside the 60 s throttle,
// and a leaf write to `note` that dodges the server-time stamp (sec-F1).
import { harness, suite, NEW_RULES, ROOTS, ED, VW, NOBODY, ref, set, get, update, remove, TS, assertFails, assertSucceeds } from './lib.mjs';

const s = suite('access requests — walk-ups ask, directors decide');
const h = await harness('access', NEW_RULES);
await h.members();
const WALK = { email: 'walkup@x.com', key: 'walkup@x,com' };
const OTHER = { email: 'other.person@x.com', key: 'other,person@x,com' };
const ed = () => h.as(ED), vw = () => h.as(VW), walk = () => h.as(WALK);
const req = (over) => Object.assign({ name: 'Walk Up', at: TS() }, over || {});

for (const R of ROOTS) {
  const P = (p) => `${R}/accessRequests/${p}`;

  await s.t(`${R}: with joinOpen ABSENT every create is refused (R1 opens no stranger-writable surface)`, async () => {
    await assertFails(set(ref(walk(), P(WALK.key)), req()));
    await assertFails(set(ref(h.anon(), P(WALK.key)), req()));
  });

  await s.t(`${R}: joinOpen false is closed too; only an editor can open it (a walk-up and a viewer cannot)`, async () => {
    await assertFails(set(ref(walk(), `${R}/setup/meta/joinOpen`), true));
    await assertFails(set(ref(vw(), `${R}/setup/meta/joinOpen`), true));
    await assertSucceeds(set(ref(ed(), `${R}/setup/meta/joinOpen`), false));
    await assertFails(set(ref(walk(), P(WALK.key)), req()));
    await assertSucceeds(set(ref(ed(), `${R}/setup/meta/joinOpen`), true));
  });

  await s.t(`${R}: with it open, a signed-in NON-member creates their OWN row — not another's, not unverified`, async () => {
    await assertFails(set(ref(walk(), P(OTHER.key)), req()));                                  // someone else's key
    await assertFails(set(ref(h.asUnverified(WALK), P(WALK.key)), req()));                     // an unverified email
    await assertFails(set(ref(h.anon(), P(WALK.key)), req()));
    await assertFails(set(ref(walk(), P(WALK.key)), req({ at: Date.now() - 5000 })));           // a client clock
    await assertFails(set(ref(walk(), P(WALK.key)), req({ extra: 1 })));                       // unknown field
    await assertFails(set(ref(walk(), P(WALK.key)), req({ name: '' })));
    await assertSucceeds(set(ref(walk(), P(WALK.key)), req()));
    await assertSucceeds(get(ref(walk(), P(WALK.key))));                                      // and reads it back
  });

  await s.t(`${R}: a second write inside 60 s is refused; so is a LEAF write to note (it would skip the stamp)`, async () => {
    await assertFails(set(ref(walk(), P(WALK.key)), req({ name: 'Walk Up Again' })));
    await assertFails(set(ref(walk(), P(WALK.key) + '/note'), 'let me in!'));
    await assertFails(update(ref(walk(), P(WALK.key)), { note: 'let me in!' }));
  });

  await s.t(`${R}: delete-then-recreate inside the throttle is refused (the requester can't delete a young row)`, async () => {
    await assertFails(remove(ref(walk(), P(WALK.key))));
    await assertFails(set(ref(walk(), P(WALK.key)), null));
  });

  await s.t(`${R}: after 60 s the requester may delete (and re-ask); an editor may delete any row at any time`, async () => {
    await h.seed((db) => set(ref(db, P(WALK.key) + '/at'), Date.now() - 61000));
    await assertSucceeds(remove(ref(walk(), P(WALK.key))));
    await assertSucceeds(set(ref(walk(), P(WALK.key)), req()));
    await assertSucceeds(remove(ref(ed(), P(WALK.key))));
  });

  await s.t(`${R}: another non-member can't read it; a viewer can't read the list; an editor reads the list`, async () => {
    await assertSucceeds(set(ref(walk(), P(WALK.key)), req()));
    await assertFails(get(ref(h.as(NOBODY), P(WALK.key))));
    await assertFails(get(ref(h.as(NOBODY), `${R}/accessRequests`)));
    await assertFails(get(ref(vw(), `${R}/accessRequests`)));
    await assertFails(get(ref(walk(), `${R}/accessRequests`)));                               // the requester sees their own row only
    await assertSucceeds(get(ref(ed(), `${R}/accessRequests`)));
  });

  await s.t(`${R}: a BLOCKED identity can't ask; editors block and unblock; a member can't create a request`, async () => {
    await h.seed((db) => remove(ref(db, P(WALK.key))));
    await assertFails(set(ref(walk(), `${R}/accessBlocked/${WALK.key}`), { at: TS(), byKey: WALK.key }));  // can't block yourself out of spite
    await assertSucceeds(set(ref(ed(), `${R}/accessBlocked/${WALK.key}`), { at: TS(), byKey: ED.key }));
    await assertFails(set(ref(walk(), P(WALK.key)), req()));
    await assertFails(get(ref(vw(), `${R}/accessBlocked`)));
    await assertFails(set(ref(ed(), `${R}/accessBlocked/${OTHER.key}`), { at: TS(), byKey: VW.key }));      // byKey is the writer's
    await assertSucceeds(remove(ref(ed(), `${R}/accessBlocked/${WALK.key}`)));
    await assertSucceeds(set(ref(walk(), P(WALK.key)), req()));
    await assertFails(set(ref(vw(), P(VW.key)), req({ name: 'Vw' })));                         // already a member
    await assertFails(set(ref(ed(), P(ED.key)), req({ name: 'Ed' })));
  });
}
await h.done();
s.finish();
