// restoreIndex / restoreBody under R1 (setup-rebuild-spec §8.8 restore.mjs): an auto point can be
// created and retired, nothing is editable in place, `pinned` is write-once, and last year's
// archive, a pre-wizard point or a pinned one can never be deleted — index alone, body alone, or
// both in one update (sec-F2). The two kinds that matter most are also the owner's to create (Q8).
import { harness, suite, NEW_RULES, ROOTS, OWNER, ED, VW, ref, set, get, update, remove, TS, assertFails, assertSucceeds } from './lib.mjs';

const s = suite('restore points — create, retire, pin, protect');
const h = await harness('restore', NEW_RULES);
await h.members();
const ed = () => h.as(ED), owner = () => h.as(OWNER), vw = () => h.as(VW);
const row = (byKey, over) => Object.assign({ at: TS(), byKey, kind: 'auto', label: 'Before a change', bytes: 1200, hash: 'abcd1234' }, over || {});
const BODY = JSON.stringify({ setup: { meta: { schema: 1 } } });

for (const R of ROOTS) {
  const idx = (id) => `${R}/restoreIndex/${id}`, body = (id) => `${R}/restoreBody/${id}`;
  const both = (db, id, over, by) => update(ref(db, R), { [`restoreIndex/${id}`]: row(by || ED.key, over), [`restoreBody/${id}`]: BODY });

  await s.t(`${R}: an editor creates an auto point (index + body together) and a viewer can't read or write any`, async () => {
    await assertSucceeds(both(ed(), 'rp-aaa1-k3f9'));
    await assertSucceeds(get(ref(ed(), idx('rp-aaa1-k3f9'))));
    await assertFails(get(ref(vw(), R + '/restoreIndex')));
    await assertFails(get(ref(vw(), body('rp-aaa1-k3f9'))));
    await assertFails(both(vw(), 'rp-vvv1-k3f9', {}, VW.key));
    await assertFails(get(ref(h.anon(), R + '/restoreIndex')));
  });

  await s.t(`${R}: an unpinned auto point can be deleted for retention (index and body, in one update)`, async () => {
    await assertSucceeds(update(ref(ed(), R), { 'restoreIndex/rp-aaa1-k3f9': null, 'restoreBody/rp-aaa1-k3f9': null }));
  });

  await s.t(`${R}: a point can't be edited in place (a rewrite, a lone label change) — only created or deleted`, async () => {
    await assertSucceeds(both(ed(), 'rp-bbb1-k3f9'));
    await assertFails(set(ref(ed(), idx('rp-bbb1-k3f9')), row(ED.key, { label: 'Renamed' })));
    await assertFails(set(ref(ed(), idx('rp-bbb1-k3f9') + '/label'), 'Renamed'));
    await assertFails(set(ref(ed(), body('rp-bbb1-k3f9')), '{}'));
  });

  await s.t(`${R}: byKey must be the writer's own key, the stamp server time, kind/ids/sizes pinned`, async () => {
    await assertFails(both(ed(), 'rp-spoof-k3f9', {}, VW.key));
    await assertFails(set(ref(ed(), idx('rp-late-k3f9')), row(ED.key, { at: 1000 })));
    await assertFails(set(ref(ed(), idx('bad-id')), row(ED.key)));
    await assertFails(set(ref(ed(), idx('rp-kind-k3f9')), row(ED.key, { kind: 'mystery' })));
    await assertFails(set(ref(ed(), idx('rp-huge-k3f9')), row(ED.key, { bytes: 900001 })));
    await assertFails(set(ref(ed(), idx('rp-hash-k3f9')), row(ED.key, { hash: 'XYZ' })));
    await assertFails(set(ref(ed(), idx('rp-extra-k3f9')), row(ED.key, { surprise: 1 })));
    await assertFails(set(ref(ed(), body('rp-bigbody-k3f9')), 'x'.repeat(900001)));
  });

  await s.t(`${R}: pinned is set ONCE to true; unset, set to false, or re-set is refused; a pinned point can't be deleted`, async () => {
    await assertSucceeds(both(ed(), 'rp-pin-k3f9'));
    await assertSucceeds(set(ref(ed(), idx('rp-pin-k3f9') + '/pinned'), true));
    await assertFails(set(ref(ed(), idx('rp-pin-k3f9') + '/pinned'), false));
    await assertFails(remove(ref(ed(), idx('rp-pin-k3f9') + '/pinned')));
    await assertFails(set(ref(ed(), idx('rp-pin-k3f9') + '/pinned'), true));              // already there: write-once
    await assertFails(remove(ref(ed(), idx('rp-pin-k3f9'))));                              // index alone
    await assertFails(remove(ref(ed(), body('rp-pin-k3f9'))));                             // body alone
    await assertFails(update(ref(ed(), R), { 'restoreIndex/rp-pin-k3f9': null, 'restoreBody/rp-pin-k3f9': null })); // both
    await assertFails(set(ref(ed(), idx('rp-fresh-k3f9') + '/pinned'), true));              // can't pin a row that doesn't exist
  });

  await s.t(`${R}: an archive and a pre-wizard point are the OWNER's to create, and nobody can delete them (index, body, both)`, async () => {
    for (const kind of ['archive', 'pre-wizard']) {
      const id = `rp-${kind}-k3f9`;
      await assertFails(both(ed(), id, { kind }));                                         // a non-owner director can't create one
      await assertSucceeds(both(owner(), id, { kind }, OWNER.key));                        // the owner can
      await assertFails(remove(ref(owner(), idx(id))));                                    // not even the owner deletes it
      await assertFails(remove(ref(ed(), body(id))));
      await assertFails(update(ref(ed(), R), { [`restoreIndex/${id}`]: null, [`restoreBody/${id}`]: null }));
      await assertFails(update(ref(owner(), R), { [`restoreIndex/${id}`]: null, [`restoreBody/${id}`]: null }));
    }
  });

  await s.t(`${R}: every other kind is any editor's (manual, pre-seed, pre-delete, pre-import, pre-restore)`, async () => {
    for (const kind of ['manual', 'pre-seed', 'pre-delete', 'pre-import', 'pre-restore']) {
      await assertSucceeds(both(ed(), `rp-${kind}-k3f9`, { kind }));
    }
  });
}
await h.done();
s.finish();
