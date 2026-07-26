// Behavioural tests against the REAL ruleset, in the Realtime Database
// emulator. This is the thing the repo's zero-dep tests can't do: they check
// the file's shape, this checks what the rules actually permit.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { ref, set, get, update, remove, push, child, serverTimestamp } from 'firebase/database';

const RULES = readFileSync('./database.rules.json', 'utf8');
let pass = 0, fail = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); pass++; results.push(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; results.push(`  \x1b[31m✗\x1b[0m ${name}\n      ${String(e.message).split('\n')[0].slice(0, 160)}`); }
}

const env = await initializeTestEnvironment({
  projectId: 'camp-test',
  database: { rules: RULES, host: '127.0.0.1', port: 9000 },
});

const EDITOR = 'ed@x.com', EDITOR_KEY = 'ed@x,com';
const VIEWER = 'vw@x.com', VIEWER_KEY = 'vw@x,com';
const OWNER_KEY = 'patricksimpson,fx@gmail,com';
const STRANGER = 'no@x.com';

await env.clearDatabase();

// Seed the member lists with rules disabled.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.database();
  await set(ref(db, 'campScoreboard/members'), {
    [EDITOR_KEY]: { role: 'editor', name: 'Ed', addedBy: 'seed', addedAt: '2026-07-26' },
    [VIEWER_KEY]: { role: 'viewer', name: 'Vw', addedBy: 'seed', addedAt: '2026-07-26' },
    [OWNER_KEY]: { role: 'editor', name: 'Patrick', addedBy: 'console', addedAt: '2026-07-25' },
  });
  await set(ref(db, 'seniorScoreboard/members'), {
    [OWNER_KEY]: { role: 'editor', name: 'Patrick', addedBy: 'console', addedAt: '2026-07-25' },
  });
  await set(ref(db, 'campScoreboard/state'), { teams: [{ id: 't0', name: 'Foxes' }] });
});

const as = (email, verified = true) =>
  env.authenticatedContext(email.replace(/\W/g, ''), { email, email_verified: verified }).database();
const anon = () => env.unauthenticatedContext().database();

const msg = (byKey, over = {}) => ({ at: Date.now(), byKey, name: 'X', text: 'hello', ...over });
// The client sends ONE atomic update: content + a chatRate stamp. Positive
// tests must send the same way or the rate rule (correctly) refuses them.
const gap = () => new Promise((r) => setTimeout(r, 1100));
const send = async (db, key, path, value) => {
  await gap();
  return update(ref(db, 'campScoreboard'), { [path]: value, [`chatRate/${key}`]: serverTimestamp() });
};

console.log('\n── Baseline: the boundary as documented ──');
await t('a stranger reads nothing', () => assertFails(get(ref(anon(), 'campScoreboard/state'))));
await t('a stranger writes nothing', () => assertFails(set(ref(anon(), 'campScoreboard/state/x'), 1)));
await t('a signed-in NON-member reads nothing', () => assertFails(get(ref(as(STRANGER), 'campScoreboard/state'))));
await t('a non-member cannot add themselves', () =>
  assertFails(set(ref(as(STRANGER), 'campScoreboard/members/no@x,com'), { role: 'editor', addedBy: 'me', addedAt: 'x' })));
await t('a viewer reads state', () => assertSucceeds(get(ref(as(VIEWER), 'campScoreboard/state'))));
await t('a viewer CANNOT write state', () => assertFails(set(ref(as(VIEWER), 'campScoreboard/state/teams'), [])));
await t('an editor writes state', () => assertSucceeds(set(ref(as(EDITOR), 'campScoreboard/state/teams'), [{ id: 't0', name: 'F' }])));
await t('an UNVERIFIED email is not a member', () => assertFails(get(ref(as(EDITOR, false), 'campScoreboard/state'))));
await t('nobody may touch the owner record', () =>
  assertFails(set(ref(as(EDITOR), `campScoreboard/members/${OWNER_KEY}/role`), 'viewer')));
await t('a junior editor cannot read senior data', () => assertFails(get(ref(as(EDITOR), 'seniorScoreboard/state'))));
await t('a junior editor cannot write senior data', () => assertFails(set(ref(as(EDITOR), 'seniorScoreboard/state/x'), 1)));

console.log('\n── Chat: identity binding and moderation ──');
await t('a viewer CAN post (chat is deliberately not editor-gated)', () =>
  assertSucceeds(send(as(VIEWER), VIEWER_KEY, 'chat/general/m1', msg(VIEWER_KEY))));
await t('nobody can post AS someone else', () =>
  assertFails(set(ref(as(VIEWER), 'campScoreboard/chat/general/m2'), msg(EDITOR_KEY))));
await t('a message cannot be edited after posting', () =>
  assertFails(set(ref(as(VIEWER), 'campScoreboard/chat/general/m1'), msg(VIEWER_KEY, { text: 'rewritten' }))));
await t('an author deletes their own message', () =>
  assertSucceeds(remove(ref(as(VIEWER), 'campScoreboard/chat/general/m1'))));
await t('an editor deletes anyone\'s message', async () => {
  await env.withSecurityRulesDisabled((c) => set(ref(c.database(), 'campScoreboard/chat/general/m3'), msg(VIEWER_KEY)));
  await assertSucceeds(remove(ref(as(EDITOR), 'campScoreboard/chat/general/m3')));
});
await t('a viewer cannot delete someone else\'s message', async () => {
  await env.withSecurityRulesDisabled((c) => set(ref(c.database(), 'campScoreboard/chat/general/m4'), msg(EDITOR_KEY)));
  await assertFails(remove(ref(as(VIEWER), 'campScoreboard/chat/general/m4')));
});
await t('a fifth channel does not exist', () =>
  assertFails(set(ref(as(EDITOR), 'campScoreboard/chat/secret/m1'), msg(EDITOR_KEY))));
await t('unknown fields on a message are refused', () =>
  assertFails(set(ref(as(VIEWER), 'campScoreboard/chat/general/m5'), msg(VIEWER_KEY, { evil: 'x' }))));
await t('an oversized message is refused', () =>
  assertFails(set(ref(as(VIEWER), 'campScoreboard/chat/general/m6'), msg(VIEWER_KEY, { text: 'x'.repeat(2001) }))));

console.log('\n── The two fixes just added to the ruleset ──');
await t('an external image URL cannot be stored as a thumb', () =>
  assertFails(set(ref(as(VIEWER), 'campScoreboard/chat/general/b1'),
    msg(VIEWER_KEY, { thumb: 'https://attacker.example/beacon.gif' }))));
await t('an inline JPEG thumb is fine', () =>
  assertSucceeds(send(as(VIEWER), VIEWER_KEY, 'chat/general/b2', msg(VIEWER_KEY, { thumb: 'data:image/jpeg;base64,/9j/4AAQ' }))));
await t('THE APP-FREEZE: an out-of-range timestamp is refused', () =>
  assertFails(set(ref(as(VIEWER), 'campScoreboard/chat/general/b3'), msg(VIEWER_KEY, { at: 1e308 }))));
await t('a far-future timestamp is refused', () =>
  assertFails(set(ref(as(VIEWER), 'campScoreboard/chat/general/b4'),
    msg(VIEWER_KEY, { at: Date.now() + 86400000 }))));
await t('a normal timestamp still passes', () =>
  assertSucceeds(send(as(VIEWER), VIEWER_KEY, 'chat/general/b5', msg(VIEWER_KEY, { at: Date.now() }))));
await t('a photo tagged with a bogus channel is refused', () =>
  assertFails(set(ref(as(VIEWER), 'campScoreboard/chatPhotos/p1'),
    { at: Date.now(), byKey: VIEWER_KEY, ch: 'nowhere', data: 'data:image/jpeg;base64,x' })));
await t('a photo in a real channel is fine', () =>
  assertSucceeds(send(as(VIEWER), VIEWER_KEY, 'chatPhotos/p2', { at: Date.now(), byKey: VIEWER_KEY, ch: 'photos', data: 'data:image/jpeg;base64,x' })));
await t('changelog rejects unknown fields', () =>
  assertFails(push(ref(as(EDITOR), 'campScoreboard/changelog'),
    { at: 'x', teamId: 't0', team: 'F', delta: 1, before: 0, after: 1, reason: 'r', junk: 'x' })));
await t('a real changelog entry still writes', () =>
  assertSucceeds(push(ref(as(EDITOR), 'campScoreboard/changelog'),
    { at: new Date().toISOString(), teamId: 't0', team: 'F', delta: 1, before: 0, after: 1, reason: 'r', by: 'Ed', byKey: EDITOR_KEY })));
await t('a viewer cannot read the changelog', () => assertFails(get(ref(as(VIEWER), 'campScoreboard/changelog'))));

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
await env.cleanup();
process.exit(fail ? 1 : 0);
