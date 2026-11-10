// NEW CLIENT x PRE-R1 RULES (setup-rebuild-spec §8.5, second row; §8.8 compat-new-client-old-rules.mjs):
// the code can deploy before the paste. Until R1 is published every new node answers Permission denied
// to everyone; the client must treat that as "not available yet" and carry on — scoring, chat and the
// week config untouched. This suite lists, for each thing the new client will do, what the PUBLISHED
// rules say and what R1 says: the new-node operations must be refused cleanly before and accepted after,
// and the everyday operations must behave the same under both.
import { harness, suite, NEW_RULES, OLD_RULES, R1_FROZEN, ROOTS, OWNER, ED, VW, ref, set, get, update, remove, onValue, TS, outcome, bigPng, startPayload, nextPayload, group, entry } from './lib.mjs';

async function run(label, rules) {
  const h = await harness('newc-' + label, rules);
  await h.members();
  const res = {};
  for (const R of ROOTS) {
    const ed = h.as(ED), vw = h.as(VW), owner = h.as(OWNER);
    const op = async (name, fn) => { res[`${R}: ${name}`] = await outcome(fn); };
    const iso = '2027-07-19T10:00:00Z';
    // ---- new nodes: refused before R1 ("not available yet"), accepted after ----
    await op('read setup (a counselor)', () => get(ref(vw, `${R}/setup`)));
    await op('read setup/meta (a director)', () => get(ref(ed, `${R}/setup/meta`)));
    await op('read campers (a director)', () => get(ref(ed, `${R}/campers`)));
    await op('read restoreIndex (a director)', () => get(ref(ed, `${R}/restoreIndex`)));
    await op('write a restore point (a director)', () => update(ref(ed, R), { 'restoreIndex/rp-aaa1-k3f9': { at: TS(), byKey: ED.key, kind: 'auto', label: 'x', bytes: 1, hash: 'abcd1234' }, 'restoreBody/rp-aaa1-k3f9': '{}' }));
    await op('write a camper (a director)', () => set(ref(ed, `${R}/campers/t0/c-abc123def4`), { name: 'Ava', ord: 1 }));
    await op('write a team photo (a director)', () => set(ref(ed, `${R}/teamPhotos/t0`), { v: 1, data: bigPng(500) }));
    await op('write my "also here" row (a director)', () => set(ref(ed, `${R}/editorsHere/${ED.key}/dev12345abcd`), { at: TS(), v: 196 }));
    await op('write a setup field (a director)', () => set(ref(ed, `${R}/setup/meta/weekStart`), '2027-07-18'));
    await op('state/brackets4 (a director)', () => set(ref(ed, `${R}/state/brackets4/g1`), { phase: 'semis' }));
    await op('pushSchedule WITH rev and src (a director)', () => set(ref(ed, `${R}/pushSchedule`), {
      weekStart: '2027-07-18', at: TS(), by: 'Ed', rev: 3, src: 'abcd1234',
      blocks: { 'mon-b1': { dow: 1, start: 480, label: 'Breakfast', emoji: '🍳', key: 'breakfast' } } }));
    await op('read revealPublic with no sign-in', () => get(ref(h.anon(), `${R}/revealPublic`)));
    await op('write revealPublic/real (a director)', () => update(ref(ed, R), startPayload('real')));
    await op('read revealFull (a director)', () => get(ref(ed, `${R}/revealFull`)));
    // ---- everyday traffic: identical under both ----
    await op('everyday: state/meta/lastDataChangeAt (a director)', () => set(ref(ed, `${R}/state/meta/lastDataChangeAt`), iso));
    await op('everyday: a team branding field (a director)', () => set(ref(ed, `${R}/state/teams/0/emoji`), '🦊'));
    await op('everyday: chat message + stamp (a counselor)', () => update(ref(vw, R), { 'chat/general/m1': { at: TS(), byKey: VW.key, name: 'Vw', text: 'hi' }, [`chatRate/${VW.key}`]: TS() }));
    await op('everyday: read members (a counselor)', () => get(ref(vw, `${R}/members`)));
    await op('everyday: presence {at} (a counselor)', () => set(ref(vw, `${R}/presence/${VW.key}/dev12345abcd`), { at: TS() }));

    // ---- the invariant that makes "deploy first" safe: a denied setup listener never hurts the state listener ----
    const got = await new Promise((resolve) => {
      const seen = { state: false, setupDenied: false };
      const done = () => { if (seen.state && (seen.setupDenied || rules === NEW_RULES)) resolve(seen); };
      onValue(ref(ed, `${R}/state`), () => { seen.state = true; done(); }, () => { seen.state = false; });
      onValue(ref(ed, `${R}/setup`), () => { seen.setupOk = true; if (rules === NEW_RULES) done(); }, () => { seen.setupDenied = true; done(); });
      setTimeout(() => resolve(seen), 4000);
    });
    res[`${R}: listeners: state delivers while setup is ${rules === OLD_RULES ? 'denied' : 'allowed'}`] =
      got.state && (rules === OLD_RULES ? got.setupDenied : got.setupOk) ? 'ok' : 'WRONG ' + JSON.stringify(got);
  }
  await h.done();
  return res;
}

const s = suite('compat-new-client-old-rules — the code can deploy before the paste');
const before = await run('pre', OLD_RULES);
const after = await run('r1', NEW_RULES);
// what each new-node operation must say before R1; everything else must be identical and 'ok'
const REFUSED_BEFORE = (n) => /^(?:\w+): (read setup|read campers|read restoreIndex|write a restore point|write a camper|write a team photo|write my "also here"|write a setup field|state\/brackets4|pushSchedule WITH rev|read revealPublic|write revealPublic|read revealFull)/.test(n);
for (const name of Object.keys(before)) {
  await s.t(`${name}  [pre-R1: ${before[name]}  R1: ${after[name]}]`, async () => {
    if (name.includes('listeners:')) { if (before[name] !== 'ok') throw new Error(before[name]); return; }
    if (REFUSED_BEFORE(name)) {
      if (before[name] !== 'denied') throw new Error(`should be refused cleanly before R1, got ${before[name]}`);
      if (after[name] !== 'ok') throw new Error(`should work after R1, got ${after[name]}`);
    } else if (before[name] !== after[name] || before[name] !== 'ok') {
      throw new Error(`everyday traffic must be identical and accepted: pre-R1 ${before[name]}, R1 ${after[name]}`);
    }
  });
}
// ── R2 (big-screen branding): the client with the switch ON meets the rules live BEFORE R2 (r1.rules.json), then R2 ──
// A branded place is refused before and accepted after; the same command without branding (the client's retry) and every
// everyday reveal command are identical under both; a colour alone was already accepted by R1.
async function reveal(label, rules) {
  const h = await harness('newc-r2-' + label, rules);
  await h.members();
  const res = {};
  for (const R of ROOTS) {
    const ed = h.as(ED);
    const op = async (name, fn) => { res[`${R}: ${name}`] = await outcome(fn); };
    const ctl = async () => (await get(ref(h.as(OWNER), `${R}/revealPublic/real/ctl`))).val();
    const g = (k, extra) => ({ place: 6 - k, e: { ['t' + k]: Object.assign(entry(k), extra) } });
    await op('a Start', () => update(ref(ed, R), startPayload('real')));
    let c = await ctl();
    await op('a branded place (em, pl, ph)', () => update(ref(ed, R), nextPayload('real', c, { group: g(0, { em: '\u{1F989}', pl: true, ph: 'data:image/jpeg;base64,' + 'A'.repeat(900) }) })));
    c = await ctl();
    await op('the same place, plain (the retry)', () => update(ref(ed, R), nextPayload('real', c, { group: g(0, {}) })));
    c = await ctl();
    await op('a place with a colour alone', () => update(ref(ed, R), nextPayload('real', c, { group: g(1, { k: 'teal' }) })));
    c = await ctl();
    await op('the next plain place', () => update(ref(ed, R), nextPayload('real', c)));
  }
  await h.done();
  return res;
}
const r2Before = await reveal('r1', R1_FROZEN);
const r2After = await reveal('r2', NEW_RULES);
for (const name of Object.keys(r2Before)) {
  await s.t(`R2: ${name}  [R1: ${r2Before[name]}  R2: ${r2After[name]}]`, async () => {
    if (name.includes('a branded place')) {
      if (r2Before[name] !== 'denied') throw new Error('should be refused cleanly before R2, got ' + r2Before[name]);
      if (r2After[name] !== 'ok') throw new Error('should work after R2, got ' + r2After[name]);
    } else if (r2Before[name] !== 'ok' || r2After[name] !== 'ok') {
      throw new Error(`identical and accepted under both: R1 ${r2Before[name]}, R2 ${r2After[name]}`);
    }
  });
}
s.finish();
