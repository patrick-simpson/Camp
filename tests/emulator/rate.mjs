// Does the rate limit actually work — and, just as important, does normal
// sending still work? The client sends one ATOMIC multi-path update.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { ref, set, update, push, remove, serverTimestamp } from 'firebase/database';

const env = await initializeTestEnvironment({
  projectId: 'camp-rate',
  database: { rules: readFileSync('./database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 },
});
await env.clearDatabase();
const VK = 'vw@x,com', V = 'vw@x.com', EK = 'ed@x,com', E = 'ed@x.com';
await env.withSecurityRulesDisabled((c) => set(ref(c.database(), 'campScoreboard/members'), {
  [VK]: { role: 'viewer', name: 'Vw', addedBy: 's', addedAt: 'x' },
  [EK]: { role: 'editor', name: 'Ed', addedBy: 's', addedAt: 'x' },
}));
const as = (e) => env.authenticatedContext(e.replace(/\W/g, ''), { email: e, email_verified: true }).database();

let pass = 0, fail = 0; const out = [];
const t = async (n, f) => { try { await f(); pass++; out.push(`  \x1b[32m✓\x1b[0m ${n}`); }
  catch (e) { fail++; out.push(`  \x1b[31m✗\x1b[0m ${n}\n      ${String(e.message).split('\n')[0].slice(0,170)}`); } };

// Exactly what the client will do: one update at the camp root.
const sendText = (db, key, ch, id, text = 'hi') => update(ref(db, 'campScoreboard'), {
  [`chat/${ch}/${id}`]: { at: serverTimestamp(), byKey: key, name: 'X', text },
  [`chatRate/${key}`]: serverTimestamp(),
});
const sendPhoto = (db, key, ch, pid, id) => update(ref(db, 'campScoreboard'), {
  [`chatPhotos/${pid}`]: { at: serverTimestamp(), byKey: key, ch, data: 'data:image/jpeg;base64,x' },
  [`chat/${ch}/${id}`]: { at: serverTimestamp(), byKey: key, name: 'X', thumb: 'data:image/jpeg;base64,y', photoId: pid },
  [`chatRate/${key}`]: serverTimestamp(),
});

await t('a normal message still sends', () => assertSucceeds(sendText(as(V), VK, 'general', 'r1')));
await t('a second message one millisecond later is REFUSED', () => assertFails(sendText(as(V), VK, 'general', 'r2')));
await t('...and so is the third, and the fourth (a flood gets nothing)', async () => {
  await assertFails(sendText(as(V), VK, 'general', 'r3'));
  await assertFails(sendText(as(V), VK, 'general', 'r4'));
});
await t('a DIFFERENT member is unaffected by my throttle', () => assertSucceeds(sendText(as(E), EK, 'general', 'r5')));
await t('after the interval passes, sending works again', async () => {
  await new Promise((r) => setTimeout(r, 1100));
  await assertSucceeds(sendText(as(V), VK, 'general', 'r6'));
});
await t('posting WITHOUT stamping the rate node is refused (no opting out)', () =>
  assertFails(set(ref(as(E), 'campScoreboard/chat/general/r7'),
    { at: serverTimestamp(), byKey: EK, name: 'X', text: 'sneaky' })));
await t('I cannot backdate my own rate node to clear the throttle', () =>
  assertFails(set(ref(as(V), `campScoreboard/chatRate/${VK}`), Date.now() - 999999)));
await t('I cannot reset SOMEONE ELSE\'s rate node', () =>
  assertFails(set(ref(as(V), `campScoreboard/chatRate/${EK}`), serverTimestamp())));
await t('deleting a message needs NO stamp (moderation is never throttled)', async () => {
  await env.withSecurityRulesDisabled((c) => set(ref(c.database(), 'campScoreboard/chat/general/r8'),
    { at: Date.now(), byKey: VK, name: 'X', text: 'x' }));
  await assertSucceeds(remove(ref(as(E), 'campScoreboard/chat/general/r8')));
});
await t('an editor can still clear a whole channel', () =>
  assertSucceeds(remove(ref(as(E), 'campScoreboard/chat/general'))));
await t('a photo send (photo + message + stamp, atomic) works', async () => {
  await new Promise((r) => setTimeout(r, 1100));
  await assertSucceeds(sendPhoto(as(V), VK, 'photos', 'pid1', 'r9'));
});
await t('a photo flood is refused too', () => assertFails(sendPhoto(as(V), VK, 'photos', 'pid2', 'r10')));
await t('a bare chatPhotos write with no message cannot skip the throttle', () =>
  assertFails(set(ref(as(V), 'campScoreboard/chatPhotos/pid3'),
    { at: serverTimestamp(), byKey: VK, ch: 'photos', data: 'data:image/jpeg;base64,x' })));

console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
await env.cleanup();
process.exit(fail ? 1 : 0);
