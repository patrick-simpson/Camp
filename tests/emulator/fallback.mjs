// Deploy-order safety: the new client sends an atomic update that INCLUDES a
// chatRate stamp. Under the rules that are published right now, that node
// doesn't exist, so the whole update is refused. The client retries once
// without the stamp — this proves that retry actually lands.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { ref, set, update, serverTimestamp } from 'firebase/database';

const VK = 'vw@x,com', V = 'vw@x.com';
async function scenario(rulesFile, label) {
  const env = await initializeTestEnvironment({
    projectId: 'camp-fb-' + label,
    database: { rules: readFileSync(rulesFile, 'utf8'), host: '127.0.0.1', port: 9000 },
  });
  await env.withSecurityRulesDisabled((c) => set(ref(c.database(), 'campScoreboard/members'), {
    [VK]: { role: 'viewer', name: 'Vw', addedBy: 's', addedAt: 'x' },
  }));
  const db = env.authenticatedContext('vw', { email: V, email_verified: true }).database();
  const msg = { at: serverTimestamp(), byKey: VK, name: 'X', text: 'hi' };
  const withStamp = { 'chat/general/f1': msg, [`chatRate/${VK}`]: serverTimestamp() };
  const withoutStamp = { 'chat/general/f2': msg };

  let stampWorks = true;
  try { await update(ref(db, 'campScoreboard'), withStamp); } catch (e) { stampWorks = false; }
  let plainWorks = true;
  try { await update(ref(db, 'campScoreboard'), withoutStamp); } catch (e) { plainWorks = false; }
  console.log(`${label.padEnd(12)} stamped-send=${String(stampWorks).padEnd(5)} fallback-send=${plainWorks}`);
  await env.cleanup();
  return { stampWorks, plainWorks };
}

const oldR = await scenario('old.rules.json', 'PUBLISHED');
const newR = await scenario('database.rules.json', 'NEW');
const ok = (!oldR.stampWorks && oldR.plainWorks)   // today: fallback carries it
        && (newR.stampWorks && !newR.plainWorks);  // after paste: stamp required
console.log(ok
  ? '\n\x1b[32mSAFE\x1b[0m — chat works before the paste (via fallback) and after it (via the stamp).'
  : '\n\x1b[31mUNSAFE\x1b[0m — deploy order matters, do not ship.');
process.exit(ok ? 0 : 1);
