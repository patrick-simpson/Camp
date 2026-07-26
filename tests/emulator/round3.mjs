// Round-3 rules: changelog byKey pin, presence re-key, state/config sealing.
// The point of this file is the POSITIVE cases — a rules mistake here breaks
// scoring mid-camp, and refused writes only console.warn.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { ref, set, get, update, remove, push, serverTimestamp } from 'firebase/database';

const env = await initializeTestEnvironment({
  projectId: 'camp-r3',
  database: { rules: readFileSync('./database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 },
});
await env.clearDatabase();
const EK = 'ed@x,com', E = 'ed@x.com', VK = 'vw@x,com', V = 'vw@x.com';
await env.withSecurityRulesDisabled((c) => set(ref(c.database(), 'campScoreboard/members'), {
  [EK]: { role: 'editor', name: 'Ed', addedBy: 's', addedAt: 'x' },
  [VK]: { role: 'viewer', name: 'Vw', addedBy: 's', addedAt: 'x' },
}));
const as = (e) => env.authenticatedContext(e.replace(/\W/g, ''), { email: e, email_verified: true }).database();
let pass = 0, fail = 0; const out = [];
const t = async (n, f) => { try { await f(); pass++; out.push(`  \x1b[32m✓\x1b[0m ${n}`); }
  catch (e) { fail++; out.push(`  \x1b[31m✗\x1b[0m ${n}\n      ${String(e.message).split('\n')[0].slice(0,150)}`); } };

console.log('\n── state: the writes the app actually makes MUST still work ──');
// This is exactly the shape pushState() sends: one bundled per-path update().
await t('a bundled per-path score push (the real shape) still lands', () =>
  assertSucceeds(update(ref(as(E), 'campScoreboard/state'), {
    'results/g2': { t0: 3, t1: 1 },
    'clocks/g2': { endAt: Date.now() + 60000 },
    'meta/lastDataChangeAt': new Date().toISOString(),
  })));
await t('a whole-node state set still lands (restore-from-backup)', () =>
  assertSucceeds(set(ref(as(E), 'campScoreboard/state'), {
    teams: [{ id: 't0', name: 'Foxes' }], results: {}, meta: { lastDataChangeAt: 'x' },
  })));
await t('deleting a key still works (RTDB prunes empties)', () =>
  assertSucceeds(set(ref(as(E), 'campScoreboard/state/results'), null)));
await t('every SYNC_KEY is individually writable', async () => {
  for (const k of ['teams','results','brackets','drafts','picRounds','picSetup','bonuses','live','meta','clocks','announcements','notice']) {
    await assertSucceeds(set(ref(as(E), 'campScoreboard/state/' + k), { probe: true }));
  }
});
await t('an UNKNOWN top-level state key is refused', () =>
  assertFails(set(ref(as(E), 'campScoreboard/state'), { teams: [], junk: { a: 1 } })));
await t('a multi-megabyte STRING dropped at a state key is refused', () =>
  assertFails(set(ref(as(E), 'campScoreboard/state/results'), 'x'.repeat(50000))));

console.log('\n── config ──');
await t('a real config set still lands', () =>
  assertSucceeds(set(ref(as(E), 'campScoreboard/config'), {
    version: 5, updatedAt: new Date().toISOString(), sessions: {}, days: [{ id: 'd1' }], games: [{ id: 'g1' }],
  })));
await t('a config with an UNKNOWN key is refused (sealed)', () =>
  assertFails(set(ref(as(E), 'campScoreboard/config'), {
    version: 5, updatedAt: 'x', sessions: {}, days: [], games: [], stray: 1,
  })));
await t('a config with a scalar where a branch belongs is refused', () =>
  assertFails(set(ref(as(E), 'campScoreboard/config'), {
    version: 5, updatedAt: 'x', sessions: {}, days: 'not-a-list', games: [],
  })));

console.log('\n── changelog attribution ──');
const entry = (over = {}) => ({ at: new Date().toISOString(), teamId: 't0', team: 'F', delta: 1,
  before: 0, after: 1, reason: 'r', by: 'Ed', byKey: EK, ...over });
await t('an honest entry still writes', () => assertSucceeds(push(ref(as(E), 'campScoreboard/changelog'), entry())));
await t('an entry attributed to ANOTHER editor is refused', () =>
  assertFails(push(ref(as(E), 'campScoreboard/changelog'), entry({ byKey: 'someone,else@x,com' }))));
await t('an entry with NO byKey is refused', async () => {
  const e = entry(); delete e.byKey;
  await assertFails(push(ref(as(E), 'campScoreboard/changelog'), e));
});
await t('a viewer still cannot write the changelog at all', () =>
  assertFails(push(ref(as(V), 'campScoreboard/changelog'), entry({ by: 'Vw', byKey: VK }))));

console.log('\n── presence ──');
await t('I can claim my own presence row', () =>
  assertSucceeds(set(ref(as(V), `campScoreboard/presence/${VK}/dev1`), { at: serverTimestamp() })));
await t('I cannot write into SOMEONE ELSE\'s row', () =>
  assertFails(set(ref(as(V), `campScoreboard/presence/${EK}/dev2`), { at: serverTimestamp() })));
await t('I cannot DELETE someone else\'s row', () =>
  assertFails(remove(ref(as(V), `campScoreboard/presence/${EK}`))));
await t('I can remove my own (this is what onDisconnect fires)', () =>
  assertSucceeds(remove(ref(as(V), `campScoreboard/presence/${VK}/dev1`))));
await t('a self-declared role is refused — the field is gone', () =>
  assertFails(set(ref(as(V), `campScoreboard/presence/${VK}/dev3`), { at: serverTimestamp(), role: 'editor' })));
await t('a backdated presence stamp is refused', () =>
  assertFails(set(ref(as(V), `campScoreboard/presence/${VK}/dev4`), { at: 1 })));
await t('the old flat shape can no longer be written', () =>
  assertFails(set(ref(as(V), 'campScoreboard/presence/some-random-uuid'), { role: 'viewer', at: serverTimestamp() })));
await t('every member can still READ presence (the chip)', () =>
  assertSucceeds(get(ref(as(V), 'campScoreboard/presence'))));

console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
await env.cleanup();
process.exit(fail ? 1 : 0);
