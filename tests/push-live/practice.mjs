// The practice check, done right: revealStart({ practice: true }) then End; a listening pretend phone must get nothing.
import { Device } from './device.mjs';
import { open, ready } from './sim.mjs';
const SENDER = 'https://camp-alerts.patricksimpson-fx.workers.dev';
const vapid = (await (await fetch(SENDER + '/vapid-key')).json()).publicKey;
const d = new Device('owner'); await d.connect(vapid);
const { ctx, page } = await open('owner', { sub: d.subscription() });
await ready(page, 'owner', { push: true, owner: true });
console.log('  enrolled:', await page.evaluate(async () => { await pushEnable(); return pushStatus(); }));
// control first: a directors' buzz must arrive, so silence below means something
await new Promise((r) => setTimeout(r, 11000));
let n0 = d.got.length;
await page.evaluate(() => pushSendAlert({ text: 'Test, please ignore (control before the practice check)', audience: 'editors', urgent: false }));
await new Promise((r) => setTimeout(r, 8000));
console.log('  control buzz arrived:', d.got.length > n0);
n0 = d.got.length;
const pr = await page.evaluate(async () => {
  revealSetRemoteOpen(true);
  await new Promise((res) => setTimeout(res, 11000));
  const s = await revealStart({ quiet: true, practice: true });
  await new Promise((res) => setTimeout(res, 1500));
  const mode = typeof revealRemoteMode === 'function' ? revealRemoteMode() : '?';
  const e = await revealEnd({ quiet: true });
  revealSetRemoteOpen(false);
  return { start: s && { ok: s.ok, mode: s.mode, code: s.code }, remoteModeAtEnd: mode, end: e && { ok: e.ok, code: e.code } };
});
console.log('  practice:', JSON.stringify(pr));
await new Promise((r) => setTimeout(r, 25000));
const after = d.got.slice(n0);
console.log('  alerts during and after the practice:', after.length ? after.map((g) => g.json && g.json.title).join(' | ') : 'none');
await page.evaluate(async () => { try { await pushRemoveRecord(CAMP.id); } catch (e) {} });
await ctx.close(); await d.close(); process.exit(0);
