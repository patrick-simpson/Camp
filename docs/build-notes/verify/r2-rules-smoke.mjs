// The R2 design pass's smoke of the candidate rules (big-screen branding in a shown place). Build session 1 folds these
// cases into tests/emulator/reveal.mjs; this file is the record of what the design was proven against.
// Run (database emulator up, npm install done in tests/emulator):
//   EMULATOR_PORT=9000 R1_RULES=<the R2 candidate> R1_FILE=<the rules live now, frozen> node docs/build-notes/verify/r2-rules-smoke.mjs
// The first half runs the candidate; the second half runs R1_FILE (default: tests/emulator/r1.rules.json, the frozen copy of
// the R1 file that build session 1 makes before regenerating) and proves a branded place is refused there and the same
// command without branding is accepted: the client's retry.
import { readFileSync } from 'fs';
const L = await import(new URL('../../../tests/emulator/lib.mjs', import.meta.url));
const { harness, suite, NEW_RULES, ROOTS, ED, VW, OWNER, ED2: ED2P, ref, get, set, update, assertFails, assertSucceeds, startPayload, nextPayload, group, entry } = L;
const LIVE_R1 = readFileSync(process.env.R1_FILE || new URL('../../../tests/emulator/r1.rules.json', import.meta.url), 'utf8');

const s = suite('R2 candidate smoke — branding in a shown place');
const png = (n) => 'data:image/jpeg;base64,' + 'A'.repeat(n - 23);
const brand = (over) => Object.assign({ k: 'teal', em: '🦅', pl: true, ph: png(19000) }, over || {});
const gWith = (k, b, n = 6) => ({ place: n - k, e: { ['t' + k]: Object.assign(entry(k), b) } });

async function fresh(rules, label) {
  const h = await harness(label, rules);
  await h.members();
  return h;
}

for (const R of ROOTS) {
  const h = await fresh(NEW_RULES, 'r2' + R.slice(0, 3));
  const ed = () => h.as(ED), vw = () => h.as(VW), anon = () => h.anon(), owner = () => h.as(OWNER);
  const ctl = async (mode = 'real') => (await get(ref(owner(), `${R}/revealPublic/${mode}/ctl`))).val();
  await s.t(`${R}: Start carries no branding; a branded g0 at the first Next is accepted and read anonymously`, async () => {
    await assertSucceeds(update(ref(ed(), R), startPayload('real')));
    const c = await ctl();
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', c, { group: gWith(0, brand()) })));
    const seen = (await get(ref(anon(), `${R}/revealPublic/real/pub/g0/e/t0`))).val();
    if (!seen || seen.em !== '🦅' || seen.pl !== true || seen.ph.length !== 19000 || seen.k !== 'teal') throw new Error(JSON.stringify(seen).slice(0, 200));
  });
  const bad = [
    ['a photo one character over the cap', { ph: png(20001) }],
    ['an external photo address', { ph: 'https://example.com/a.jpg' }],
    ['a quote-breakout photo', { ph: 'data:image/png;base64,AAA" onerror="x' }],
    ['an svg photo', { ph: 'data:image/svg+xml;base64,AAAA' }],
    ['a photo with a space', { ph: 'data:image/jpeg;base64,AA AA' }],
    ['an emoji with markup', { em: '<b>' }],
    ['an emoji with an apostrophe', { em: "a'b" }],
    ['an emoji of 17 characters', { em: 'x'.repeat(17) }],
    ['an empty emoji', { em: '' }],
    ['pl false', { pl: false }],
    ['pl as a string', { pl: 'true' }],
    ['an unknown field', { zz: 1 }],
    ['a colour that is not a palette-shaped id', { k: 'Teal!' }],
  ];
  for (const [what, b] of bad) {
    await s.t(`${R}: refused — ${what}`, async () => {
      const c = await ctl();
      await assertFails(update(ref(ed(), R), nextPayload('real', c, { group: gWith(c.shown, b) })));
    });
  }
  await s.t(`${R}: refused — branding for a place not shown yet (g2 while shown becomes 2)`, async () => {
    const c = await ctl();
    const p = nextPayload('real', c, { group: gWith(1, { em: '🦊' }) });
    p[`revealPublic/real/pub/g2`] = gWith(2, brand());
    await assertFails(update(ref(ed(), R), p));
  });
  await s.t(`${R}: refused — the same team's photo in a second group (t0 already in g0)`, async () => {
    const c = await ctl();
    const g = { place: 5, e: { t0: Object.assign(entry(0), { ph: png(1000) }) } };
    await assertFails(update(ref(ed(), R), nextPayload('real', c, { group: g })));
    // control: the very same write with t1 (a team in no other group) is not refused for its photo
    const g2 = { place: 5, e: { t1: Object.assign(entry(1), { ph: png(1000) }) } };
    const out = await L.outcome(() => update(ref(h.as(ED2P), R), nextPayload('real', c, { group: g2 })));
    if (out !== 'ok') throw new Error('control refused: ' + out);
    await h.seed(async (db) => { await set(ref(db, `${R}/revealPublic/real/ctl`), c); await set(ref(db, `${R}/revealPublic/real/pub/g1`), null); });
  });
  await s.t(`${R}: refused — a counselor, a stranger and an unverified director writing a branded place`, async () => {
    const c = await ctl();
    await assertFails(update(ref(vw(), R), nextPayload('real', c, { group: gWith(1, brand()) })));
    await assertFails(update(ref(anon(), R), nextPayload('real', c, { group: gWith(1, brand()) })));
    await assertFails(update(ref(h.asUnverified(ED), R), nextPayload('real', c, { group: gWith(1, brand()) })));
  });
  await s.t(`${R}: accepted — g1 with a photo for t1 (one per team), then g2 with no branding at all`, async () => {
    let c = await ctl();
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', c, { group: gWith(1, { k: 'blue', em: '🦊', ph: png(19999) }) })));
    c = await ctl();
    await assertSucceeds(update(ref(ed(), R), nextPayload('real', c)));
  });
  await s.t(`${R}: refused — branding inside revealFull (the private order keeps its shape)`, async () => {
    const full = (await get(ref(owner(), `${R}/revealFull/real`))).val();
    await assertFails(set(ref(ed(), `${R}/revealFull/real/g/g3/e/t3/em`), '🦅'));
    await assertFails(set(ref(ed(), `${R}/revealFull/real/g/g3/e/t3/ph`), png(100)));
    if (!full) throw new Error('no revealFull');
  });
  await s.t(`${R}: ANON still reads nothing else and writes nothing`, async () => {
    await assertFails(get(ref(anon(), `${R}/revealFull`)));
    await assertFails(get(ref(anon(), `${R}/state`)));
    await assertFails(set(ref(anon(), `${R}/revealPublic/real/pub/g0/e/t0/em`), '🦅'));
  });
  await h.done();

  // ── the rules live NOW (R1): what the switch-ON client meets before the owner publishes ──
  const o = await fresh(LIVE_R1, 'r1' + R.slice(0, 3));
  const oed = () => o.as(ED);
  const octl = async () => (await get(ref(o.as(OWNER), `${R}/revealPublic/real/ctl`))).val();
  await s.t(`${R} under R1: a branded place is refused; the SAME command without branding is accepted (the retry)`, async () => {
    await assertSucceeds(update(ref(oed(), R), startPayload('real')));
    const c = await octl();
    await assertFails(update(ref(oed(), R), nextPayload('real', c, { group: gWith(0, brand()) })));
    const after = await octl();
    if (after.seq !== c.seq) throw new Error('the refused write moved the ctl');
    await assertSucceeds(update(ref(oed(), R), nextPayload('real', c, { group: gWith(0, {}) })));
  });
  await s.t(`${R} under R1: a colour alone (k) was already accepted, em / pl / ph each refused alone`, async () => {
    let c = await octl();
    await assertFails(update(ref(oed(), R), nextPayload('real', c, { group: gWith(1, { em: '🦊' }) })));
    await assertFails(update(ref(oed(), R), nextPayload('real', c, { group: gWith(1, { pl: true }) })));
    await assertFails(update(ref(oed(), R), nextPayload('real', c, { group: gWith(1, { ph: png(500) }) })));
    await assertSucceeds(update(ref(oed(), R), nextPayload('real', c, { group: gWith(1, { k: 'teal' }) })));
  });
  await o.done();
}
s.finish();
