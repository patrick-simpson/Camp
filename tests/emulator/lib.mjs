// Shared helpers for the R1 emulator suites (BUILD-PLAN Step 10). Each suite is a plain
// script: `node setup.mjs` against a running database emulator (see README.md), prints
// pass/fail per case and exits non-zero on any failure.
//
// The suites that compare two rulesets (compat-*) run the SAME scenario against
// `pre-r1.rules.json` (the ruleset published before R1 — a frozen copy) and
// `../../database.rules.json` (the R1 file) and print SAFE / UNSAFE in the fallback.mjs
// style. Each ruleset gets its own emulator namespace, so nothing leaks between them.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { ref, set, get, update, remove, serverTimestamp, runTransaction, onValue } from 'firebase/database';
import { setLogLevel } from 'firebase/app';

setLogLevel('error'); // a refused write logs a FIREBASE WARNING per call; the suites assert the refusal themselves

export { ref, set, get, update, remove, serverTimestamp, runTransaction, onValue, assertFails, assertSucceeds };

// R1_RULES=/path/to/candidate.json runs a suite against a different file (how the suites themselves are
// mutation-checked: weaken one clause, expect a red suite)
export const NEW_RULES = readFileSync(process.env.R1_RULES || new URL('../../database.rules.json', import.meta.url), 'utf8');
export const OLD_RULES = readFileSync(new URL('./pre-r1.rules.json', import.meta.url), 'utf8');
export const ROOTS = ['campScoreboard', 'seniorScoreboard'];

// People. Keys are what the rules compute from a verified email: lowercase, every dot a comma.
export const OWNER = { email: 'patricksimpson.fx@gmail.com', key: 'patricksimpson,fx@gmail,com' };
export const ED = { email: 'ed@x.com', key: 'ed@x,com' };           // a director who is NOT the owner
export const ED2 = { email: 'ed2@x.com', key: 'ed2@x,com' };        // a second director
export const VW = { email: 'vw@x.com', key: 'vw@x,com' };           // a counselor (viewer)
export const NOBODY = { email: 'nobody@x.com', key: 'nobody@x,com' }; // signed in, on no list
export const PHONE_OWNER_LOOKALIKE = '+15555550123';

let counter = 0;

// One emulator namespace per call (a fresh database), with both camps' member lists seeded.
export async function harness(label, rules) {
  const env = await initializeTestEnvironment({
    projectId: `camp-r1-${label}-${Date.now().toString(36)}-${counter++}`,
    database: { rules, host: '127.0.0.1', port: 9000 },
  });
  await env.clearDatabase();
  const h = {
    env,
    // rules disabled: arrange state the rules would not let a client build
    seed: (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.database())),
    as: (p) => env.authenticatedContext(p.email.replace(/\W/g, ''), { email: p.email, email_verified: true }).database(),
    asUnverified: (p) => env.authenticatedContext('u' + p.email.replace(/\W/g, ''), { email: p.email, email_verified: false }).database(),
    asPhone: (phone) => env.authenticatedContext('ph' + phone.replace(/\W/g, ''), { phone_number: phone }).database(),
    anon: () => env.unauthenticatedContext().database(),
    async members(extra) {
      await h.seed(async (db) => {
        for (const R of ROOTS) {
          const rec = (role, name) => ({ role, name, addedBy: 'seed', addedAt: '2026-11-02' });
          await set(ref(db, `${R}/members`), Object.assign({
            [OWNER.key]: rec('editor', 'Patrick'),
            [ED.key]: rec('editor', 'Ed'),
            [ED2.key]: rec('editor', 'Ed Two'),
            [VW.key]: rec('viewer', 'Vw'),
          }, extra || {}));
        }
      });
    },
    done: () => env.cleanup(),
  };
  return h;
}

// A tiny runner in the repo's emulator style: t(name, fn), then finish().
export function suite(title) {
  let pass = 0, fail = 0;
  const lines = [];
  console.log(`\n── ${title} ──`);
  return {
    async t(name, fn) {
      try { await fn(); pass++; lines.push(`  \x1b[32m✓\x1b[0m ${name}`); console.log(lines[lines.length - 1]); }
      catch (e) {
        fail++;
        lines.push(`  \x1b[31m✗\x1b[0m ${name}`);
        console.log(`${lines[lines.length - 1]}\n      ${String(e.message || e).split('\n')[0].slice(0, 220)}`);
      }
    },
    note(msg) { console.log(`  \x1b[36m·\x1b[0m ${msg}`); },
    finish() {
      console.log(`\n${pass} passed, ${fail} failed`);
      console.log(fail ? '\n\x1b[31mUNSAFE\x1b[0m — do not publish.' : '\n\x1b[32mSAFE\x1b[0m');
      process.exit(fail ? 1 : 0);
    },
    get failed() { return fail; },
  };
}

// Run one operation and say what happened, without throwing: 'ok' | 'denied' | 'error:<msg>'.
export async function outcome(fn) {
  try { await fn(); return 'ok'; }
  catch (e) { return /permission_denied|PERMISSION_DENIED|denied/i.test(String(e && (e.code || e.message))) ? 'denied' : 'error:' + String(e && e.message).slice(0, 80); }
}

export const TS = serverTimestamp;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 100,000-char PNG data URL that satisfies the crest regex (base64 charset only)
export const bigPng = (n) => 'data:image/png;base64,' + 'A'.repeat(n - 22);

// ── the standings reveal's payloads (app-shell-redesign-spec §4.3 / §4.5), as a director's phone writes them ──
export const RID = 'r1kz9fxq-4hd2';
export const entry = (i) => ({ nm: ['Pumpkins', 'Maples', 'Foxes', 'Turkey', 'Pilgrims', 'John Deeres'][i], k: 'gold', p: 30 - 3 * i, g: 1, s: 1, b: 1, v: 1, m: 1, c: 0 });
// group k (0 = the LAST place, the first one revealed) holds one team; place counts down from N
export const group = (k, n = 6) => ({ place: n - k, e: { ['t' + k]: entry(k) } });
export const allGroups = (n = 6) => Object.fromEntries(Array.from({ length: n }, (_, k) => ['g' + k, group(k, n)]));
export function startPayload(mode = 'real', over = {}) {
  const id = over.id || RID;
  const ctl = Object.assign({ v: 1, id, seq: 1, phase: 'intro', cur: -1, shown: 0, teams: 6, finale: false,
    at: serverTimestamp(), sa: serverTimestamp(), ca: Date.now(), startedAt: serverTimestamp(),
    until: Date.now() + (mode === 'practice' ? 2 * 3600e3 : 30 * 3600e3) }, over.ctl || {});
  return {
    [`revealPublic/${mode}`]: { ctl, pub: null },
    [`revealFull/${mode}`]: Object.assign({ r: id, n: 6, frozenAt: serverTimestamp(), lastScoreAt: Date.now() - 60000, startedBy: over.by || ED.key, g: allGroups(6) }, over.full || {}),
  };
}
// Next: ctl + (when shown grows) the next group, from a current ctl read back from the database
export function nextPayload(mode, cur, over = {}) {
  const shown = over.shown !== undefined ? over.shown : cur.shown + 1;
  // `sa` moves only when a place is shown; `over.ctl` is applied last so a test can break any field
  const ctl = Object.assign({}, cur, { seq: cur.seq + 1, phase: 'live', cur: shown - 1, shown, at: serverTimestamp(),
    sa: shown > cur.shown ? serverTimestamp() : cur.sa }, over.ctl || {});
  const out = { [`revealPublic/${mode}/ctl`]: ctl };
  if (shown > cur.shown) out[`revealPublic/${mode}/pub/g${shown - 1}`] = over.group || group(shown - 1);
  return out;
}
