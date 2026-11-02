// Readiness gate for the owner's two big switches (BUILD-PLAN Step 16: Edit the week here / schedule, and Step 20:
// meals, verses, cleanup, electives). One command, one verdict per camp:
//
//     CAMP_EXPORT=/path/to/camp-export.json node export-replay.mjs
//
// The input is what the Firebase console's Realtime Database "Export JSON" writes at the database root (the two camp
// roots `campScoreboard` and `seniorScoreboard`; anything else in it is ignored), or an export taken at ONE camp's root
// (detected; say which camp with CAMP_EXPORT_CAMP=junior|senior if the team count can't tell). The export holds members'
// emails, phone numbers and chat: keep it OUTSIDE the repo, never commit it, delete it after. This script never prints
// a value from it (paths and counts only; a printed difference is scrubbed of anything that looks like an email or a phone).
//
// For EACH camp in the export it:
//   1. loads that camp's data into the database emulator with the rules bypassed, exactly as exported;
//   2. drives the REAL client (the shipped scripts, tests/harness.js + tests/fake-rtdb.js, preloaded with the same data),
//      signed in as the owner, through what the owner's taps run: setupTurnOn(['schedule']) (Step 16: the pre-seed restore
//      point, the seed, meta/on/schedule, A2's attachments of the games), the hub's "Put games on the schedule", the
//      alert publisher, then meals / verses / cleanup / electives (Step 20), recording every database write in order;
//   3. replays those writes against the emulator under the REAL database.rules.json as the owner (each must be ACCEPTED)
//      and the owner-only ones as a non-owner director (each must be REFUSED); the reads the client makes are checked
//      too, and the emulator's resulting tree must equal the one the client's own database ended with;
//   4. SEEDED FIDELITY on the real data: a fresh client loaded from the emulator before and after, compared on the
//      schedule (all seven days), the Happening-now banner for every minute of the week, the schedule sheet, the calendar
//      files, the games each block lists, the alert publisher's blocks, meals, verses, cleanup, electives, staff names —
//      with only the documented intended differences allowed (replay-fidelity.mjs lists them); anything else is printed;
//   5. "Use the original week again" for every section, replays it, and requires the SAME comparison to equal the
//      "before" set exactly; then "Edit the week here" again must bring the "after" set back exactly;
//   6. reports state/teams (ids t0…t(N-1), N = 6 junior / 4 senior: Step 25's pre-ship check) and any games the seed would
//      leave "not on the schedule", and the rota slots that read TBA.
//
// Exit code 0 only when every check of every camp passes. Needs the database emulator on 127.0.0.1:9000 (README.md).
//
// Self-test: REPLAY_MUTATE=<refused-write|seed-block|rollback-leak|owner-only-open> deliberately breaks one thing so the
// harness can be seen to go red (see README.md); with it set the exit code is inverted ONLY by you reading the verdict.
import fs from 'fs';
import net from 'net';
import { harness, NEW_RULES, OWNER, ED, VW, ref, set, get, update, remove, runTransaction, outcome } from './lib.mjs';
import { bootClient, bootable, LOAD_KEYS } from './replay-client.mjs';
import { compare, equalSnapshots, summarize, scrub, REQUIRED_MATCHERS, REQUIRED_PREFIXES } from './replay-fidelity.mjs';

const EXPORT_PATH = process.env.CAMP_EXPORT || '/tmp/claude-0/-home-user-Camp/0f7c2075-f70d-5c41-9f9f-e6ae084416ea/scratchpad/exports/camp-export.json';
const ONLY = (process.env.CAMP_ONLY || '').toLowerCase();
const MUTATE = process.env.REPLAY_MUTATE || '';
const VERBOSE = !!process.env.REPLAY_VERBOSE;
const ROOTS = { junior: 'campScoreboard', senior: 'seniorScoreboard' };
const TEAMS = { junior: 6, senior: 4 };
const PLACEHOLDER_WEEK = '2027-07-18'; // a Sunday in the future: the real week is set on the Camp week screen
const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`, yellow = (s) => `\x1b[33m${s}\x1b[0m`;

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// A path for the terminal: a member's key (an email or a phone) is never printed.
const safePath = (p) => String(p).split('/').map((s) => (/@|^\+\d/.test(s) ? '‹member›' : s)).join('/');
const isObj = (v) => v !== null && typeof v === 'object';

// RTDB's stored form for comparison: empties pruned, a list is an index-keyed map, keys sorted.
function canon(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { const c = canon(x); if (c !== undefined) o[i] = c; }); return Object.keys(o).length ? o : undefined; }
  if (isObj(v)) { const o = {}; Object.keys(v).sort().forEach((k) => { const c = canon(v[k]); if (c !== undefined) o[k] = c; }); return Object.keys(o).length ? o : undefined; }
  return v;
}
// Paths where two canonical trees differ. A server timestamp is the clock of whichever database resolved it (the client's
// stand-in and the emulator), so two epoch-millisecond numbers within ten minutes are the same moment.
function treeDiff(a, b, path = '', out = []) {
  if (out.length > 20) return out;
  const epoch = (x) => typeof x === 'number' && x > 1e12;
  if (epoch(a) && epoch(b) && Math.abs(a - b) < 600000) return out;
  if (isObj(a) && isObj(b)) {
    new Set(Object.keys(a).concat(Object.keys(b))).forEach((k) => treeDiff(a[k], b[k], path + '/' + k, out));
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path || '/');
  return out;
}

// A camp root big enough to need care (chat photos): written per child, and per grandchild when a child is large.
async function seedRoot(db, R, node) {
  const size = (v) => JSON.stringify(v).length;
  const put = async (path, value) => {
    if (isObj(value) && !Array.isArray(value) && size(value) > 4e6) { for (const k of Object.keys(value)) await put(path + '/' + k, value[k]); return; }
    await set(ref(db, path), value);
  };
  for (const k of Object.keys(node)) await put(R + '/' + k, node[k]);
}
const showFindings = (findings, max = 8) => `(${summarize(findings)})\n` + findings.slice(0, max).map((f) => `${f.key}\n   before: ${f.before}\n   after:  ${f.after}${f.why || ''}`).join('\n') + (findings.length > max ? `\n… and ${findings.length - max} more` : '');
const readKeys = async (h, R, keys) => {
  const out = {};
  await h.seed(async (db) => { for (const k of keys) { const v = (await get(ref(db, R + '/' + k))).val(); if (v !== null) out[k] = v; } });
  return out;
};

// ── the export ─────────────────────────────────────────────────────────────────────────────────────────────────
function loadExport(file) {
  if (!fs.existsSync(file)) {
    console.error(red(`No export at ${file}`) + `\nTake one in the Firebase console (Realtime Database → Data → ⋮ → Export JSON), save it OUTSIDE the repo, and run:\n  CAMP_EXPORT=/path/to/camp-export.json node export-replay.mjs`);
    process.exit(2);
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    // (JSON.parse's own message quotes a snippet of the file, which could be a member's address: say only where)
    console.error(red('That file is not valid JSON') + (/position (\d+)/.exec(String(e && e.message)) ? ' (it breaks at character ' + /position (\d+)/.exec(e.message)[1] + ')' : '') + '. Export again from the console: Realtime Database → Data → ⋮ → Export JSON.');
    process.exit(2);
  }
  const found = {};
  const hasRoot = Object.keys(ROOTS).some((c) => raw && isObj(raw[ROOTS[c]]));
  if (hasRoot) {
    Object.keys(ROOTS).forEach((c) => { if (isObj(raw[ROOTS[c]])) found[c] = raw[ROOTS[c]]; });
  } else if (isObj(raw) && ['state', 'config', 'members'].some((k) => k in raw)) {
    // an export taken at ONE camp's root: which camp? say so, or let the team count decide
    let camp = (process.env.CAMP_EXPORT_CAMP || '').toLowerCase();
    if (!camp) {
      const teams = raw.state && raw.state.teams;
      const n = Array.isArray(teams) ? teams.filter(Boolean).length : isObj(teams) ? Object.keys(teams).length : 0;
      camp = n === 4 ? 'senior' : n === 6 ? 'junior' : '';
    }
    if (!ROOTS[camp]) { console.error(red('This looks like an export of one camp\'s root, but the camp is not clear. Set CAMP_EXPORT_CAMP=junior or senior.')); process.exit(2); }
    found[camp] = raw;
    console.log(dim(`(an export of one camp's root, taken as ${camp})`));
  } else {
    console.error(red('Neither campScoreboard nor seniorScoreboard is in that file, and it does not look like one camp\'s root.'));
    process.exit(2);
  }
  return found;
}

class Stop extends Error {}

// ── one camp ───────────────────────────────────────────────────────────────────────────────────────────────────
async function runCamp(campId, node) {
  const R = ROOTS[campId];
  const checks = [];
  const notes = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? green('✓') : red('✗')} ${name}${!ok && detail ? '\n      ' + String(detail).split('\n').join('\n      ') : ''}`); return !!ok; };
  const note = (s) => { notes.push(s); console.log(`  ${yellow('·')} ${s}`); };
  const rules = NEW_RULES;
  const h = await harness('replay-' + campId, rules);
  // one connection per identity for the whole run (a context per call opens hundreds and the emulator starts to rate-limit)
  const dbs = {};
  const as = (p) => dbs[p.key] || (dbs[p.key] = h.as(p));
  let owner = null, week = PLACEHOLDER_WEEK;
  const clients = [];
  try {
    // 0. what is in the export, by name and count only
    const members = isObj(node.members) ? Object.keys(node.members).length : 0;
    const results = isObj(node.state && node.state.results) ? Object.keys(node.state.results).length : 0;
    const games = Array.isArray(node.config && node.config.games) ? node.config.games.length : isObj(node.config && node.config.games) ? Object.keys(node.config.games).length : 0;
    console.log(dim(`  export: ${Object.keys(node).sort().join(', ')} — ${members} members, ${games} games, ${results} results; setup ${node.setup ? 'PRESENT' : 'absent'}`));
    if (node.setup) note('the export already has a setup node: Edit the week here has been pressed on this camp before; this run starts from it');
    if (node.pushSchedule && /^20\d\d-\d\d-\d\d$/.test(String(node.pushSchedule.weekStart || ''))) week = node.pushSchedule.weekStart;
    if (node.setup && node.setup.meta && /^20\d\d-\d\d-\d\d$/.test(String(node.setup.meta.weekStart || ''))) week = node.setup.meta.weekStart;
    if (process.env.REPLAY_WEEK) week = process.env.REPLAY_WEEK;

    // 1. the emulator holds exactly the export (plus two fake accounts for the refusal and read probes, and the owner's
    //    record if the file lacks it — said out loud)
    const seed = clone(node);
    seed.members = seed.members || {};
    if (!seed.members[OWNER.key]) { seed.members[OWNER.key] = { role: 'editor', name: 'Owner', addedBy: 'replay', addedAt: '2026-01-01' }; note('the export has no owner member record: one was added to the emulator for this run'); }
    seed.members[ED.key] = { role: 'editor', name: 'Probe director', addedBy: 'replay', addedAt: '2026-01-01' };
    seed.members[VW.key] = { role: 'viewer', name: 'Probe counselor', addedBy: 'replay', addedAt: '2026-01-01' };
    await h.seed((db) => remove(ref(db, R)));
    await h.seed((db) => seedRoot(db, R, seed));
    const back = await readKeys(h, R, ['state', 'config', 'members']);
    check('the emulator holds the export (state, config, members read back)', ['state', 'config', 'members'].every((k) => node[k] === undefined || JSON.stringify(canon(back[k])) === JSON.stringify(canon(k === 'members' ? seed.members : node[k]))),
      'a part of the export did not survive the load (a key RTDB refuses?)');

    // 2. fidelity "before": a fresh counselor phone loaded from the emulator, nothing turned on
    const snapshotOf = async (label) => {
      const tree = await readKeys(h, R, LOAD_KEYS);
      const c = await bootClient({ camp: campId, root: tree, email: 'counselor@example.com', role: 'viewer', name: 'Counselor' });
      const snap = await c.call('rrSnapshot', { weekStart: week });
      c.stop();
      return snap;
    };
    const A = await snapshotOf('before');
    check('before: the camp is on the built-in week (nothing edited here yet)', A.shared === 'false', 'the schedule switch is already on in this export');

    // 3. the owner's phone, over a fake database holding the same data
    owner = await bootClient({ camp: campId, root: bootable(seed), email: OWNER.email, role: 'editor', name: 'Patrick' });
    clients.push(owner);
    const facts = await owner.call('rrOwnerFacts');
    check('the client treats this sign-in as the owner (isOwner, a confirmed director)', facts.owner === true, JSON.stringify(facts));
    const teamCount = TEAMS[campId];

    // the replay queue: every write the client made, in order, replayed as the owner under the real rules
    let replayed = 0;
    const counts = {};
    const refusals = [];
    const nonOwnerFails = [];
    const divergent = [];
    const rel = (p) => (p === R ? '' : String(p).replace(new RegExp('^' + R + '/'), ''));
    const writePaths = (w) => (w.kind === 'update' ? Object.keys(w.values).map((k) => [rel(w.path), k].filter(Boolean).join('/')) : [rel(w.path)]);
    const ownerOnly = (w) => {
      if (w.kind === 'transaction') return rel(w.path) === 'setup' && /turn-on/.test(w.phase);
      return writePaths(w).some((p) => /^setup\/meta\/(on|epoch|epochAt|wizard)(\/|$)/.test(p) || /^state\/meta\/(epoch|epochAt)(\/|$)/.test(p));
    };
    const send = async (db, w) => {
      let lastCur;
      const o = await outcome(async () => {
        if (w.kind === 'set') await set(ref(db, w.path), w.value);
        else if (w.kind === 'update') await update(ref(db, w.path), w.values);
        else if (w.kind === 'remove') await remove(ref(db, w.path));
        else await runTransaction(ref(db, w.path), (cur) => { lastCur = cur; return clone(w.out); }, { applyLocally: false });
      });
      return { o, lastCur };
    };
    const replay = async (phase, client = owner, who = OWNER, sink = refusals) => {
      const todo = client.rec.writes.filter((w) => w.phase === phase && !w.sent);
      todo.forEach((w) => { w.sent = true; });
      for (const w of todo.concat(phase === 'boot' && client === owner && MUTATE === 'refused-write' ? [{ kind: 'set', path: `${R}/members/${OWNER.key}/role`, value: 'viewer', phase: 'selftest' }] : [])) {
        const label = `${w.phase}: ${w.kind} ${safePath(rel(w.path) || '(camp root)')}${w.kind === 'update' ? ' {' + Object.keys(w.values).map(safePath).join(', ') + '}' : ''}`;
        if (who === OWNER && ownerOnly(w)) {
          // a non-owner director first, against the tree as it stands: must be REFUSED, which leaves it untouched (if it is
          // wrongly accepted the tree is put back, so the owner's replay below still runs on the real state)
          const pre = await readKeys(h, R, LOAD_KEYS);
          const r = await send(as(ED), w);
          if (r.o !== 'denied') {
            nonOwnerFails.push(`${label} -> ${scrub(r.o, 120)}`);
            await h.seed(async (db) => { for (const k of LOAD_KEYS) await set(ref(db, R + '/' + k), pre[k] === undefined ? null : pre[k]); });
          } else if (VERBOSE) console.log(dim(`    non-owner refused: ${label}`));
        }
        const r = await send(as(who), w);
        if (who === OWNER) { replayed++; counts[w.phase] = (counts[w.phase] || 0) + 1; }
        if (r.o !== 'ok') sink.push(`${label} -> ${scrub(r.o, 120)}`);
        else if (VERBOSE) console.log(dim(`    accepted: ${label}`));
        if (w.kind === 'transaction' && r.o === 'ok' && w.seen !== null && JSON.stringify(treeDiff(canon(w.seen), canon(r.lastCur))) !== '[]') {
          divergent.push(`${label}: the emulator's value when this ran differed from the client's at ${treeDiff(canon(w.seen), canon(r.lastCur)).slice(0, 3).map(safePath).join(', ')}`);
        }
      }
    };
    const step = async (name, phase, fn) => {
      owner.phase(phase);
      const out = await fn();
      await replay(phase);
      return out;
    };

    // boot: what the owner's phone writes on its own when it loads this data
    await replay('boot');
    const bootWrites = owner.rec.writes.filter((w) => w.phase === 'boot').length;
    if (bootWrites) note(`the phone itself wrote ${bootWrites} thing(s) while loading (${owner.rec.writes.filter((w) => w.phase === 'boot').map((w) => safePath(rel(w.path) || 'camp root') + (w.kind === 'update' ? ' {' + Object.keys(w.values).slice(0, 3).map(safePath).join(', ') + '}' : '')).join('; ')}); replayed like the rest`);

    // Step 16: Edit the week here, schedule
    const tap = async (sections, phase) => {
      let r = await step('turn on', phase, () => owner.call('rrTurnOn', sections, { campRunning: false }));
      if (r && r.reason === 'camp-week') {
        note(`${phase}: the client refused ("a camp week is running" — this run's date falls inside the week ${week}); pressed with the owner's override`);
        r = await step('turn on', phase, () => owner.call('rrTurnOn', sections, { campRunning: false, overrideCampWeek: true }));
      }
      return r;
    };
    const t1 = await tap(['schedule'], 'turn-on-schedule');
    if (!check('Step 16: Edit the week here (schedule) went through', t1 && t1.ok === true, JSON.stringify(t1) + (t1 && t1.reason === 'already' ? '\nthis camp\'s schedule is already edited here' : ''))) throw new Stop();
    const placed = t1 && t1.attach ? t1.attach.attached : 0;
    const put = await step('put games', 'put-games', () => owner.call('rrPutGames'));
    check("A2's second door, the hub's \"Put games on the schedule\", has nothing left to do", put && put.ok && (put.noop || put.attached === 0), JSON.stringify(put));
    await owner.call('rrSetWeek', week);
    const pub = await step('publish', 'publish', () => owner.call('rrPublish'));
    check(`the alert publisher writes the week (forced on: PUSH_SERVICE_URL is blank until phone alerts go live)`, pub && pub.published === true, JSON.stringify(pub));
    // Step 20: the other four sections
    const t2 = await tap(['meals', 'verses', 'cleanup', 'electives'], 'turn-on-rest');
    check(`Step 20: meals, verses, cleanup${facts.hasElectives ? ', electives' : ' (the camp has no electives)'} went through`, t2 && t2.ok === true, JSON.stringify(t2));
    const sections = (await owner.call('rrOwnerFacts')).on;
    check('every section the camp has is now on', ['schedule', 'meals', 'verses', 'cleanup'].concat(facts.hasElectives ? ['electives'] : []).every((s) => sections.includes(s)), sections.join(','));
    const place = await owner.call('rrPlacement');

    // 4. fidelity "after"
    if (MUTATE === 'seed-block') {
      const tree = await readKeys(h, R, ['setup']);
      const first = Object.keys((tree.setup || {}).typical || {})[0];
      await h.seed((db) => update(ref(db, R + '/setup/typical/' + first), { start: 1 + (tree.setup.typical[first].start % 600) }));
      note('REPLAY_MUTATE=seed-block: one seeded block\'s start was moved in the emulator');
    }
    const B = await snapshotOf('after');
    const cmp = compare(A, B, { camp: campId, weekStart: week });
    const matchedLines = Object.keys(cmp.matched).map((m) => `${cmp.matched[m]} × ${m}`);
    check(`seeded fidelity: ${cmp.total} things compared, ${cmp.diffs} differ, every difference is a documented intended one`, cmp.findings.length === 0,
      showFindings(cmp.findings));
    matchedLines.forEach((l) => console.log(dim(`      allowed: ${l}`)));
    const missing = REQUIRED_MATCHERS.filter((m) => !cmp.matched[m]).concat(REQUIRED_PREFIXES.filter((p) => !Object.keys(cmp.matched).some((m) => m.startsWith(p))));
    check('the comparison saw the edited week (the switch, calendar UIDs and alert ids all changed, as intended)', missing.length === 0, 'not seen: ' + missing.join('; '));

    // 5. back, and forth again
    const ALL = ['schedule', 'meals', 'verses', 'cleanup', 'electives'];
    const back1 = await step('use original', 'use-original', () => owner.call('rrUseOriginal', MUTATE === 'rollback-leak' ? ALL.filter((x) => x !== 'schedule') : ALL));
    check('"Use the original week again" for every section went through', back1 && back1.ok === true, JSON.stringify(back1));
    const C = await snapshotOf('rollback');
    const rb = equalSnapshots(A, C);
    check(`the rollback: all ${rb.total} things are exactly what they were before`, rb.findings.length === 0, showFindings(rb.findings));
    const t3 = await tap(ALL, 'turn-on-again');
    check('"Edit the week here" again brings the edits back, writing only the switches (no second restore point)', t3 && t3.ok === true && (t3.seeded || []).length === 0, JSON.stringify(t3));
    const D = await snapshotOf('again');
    const again = equalSnapshots(B, D);
    check(`turning it back on restores the edited week exactly (${again.total} things equal to the first "after")`, again.findings.length === 0, showFindings(again.findings));

    // 3 (end). the replay's verdict, over EVERYTHING the client wrote (boot, both turn-ons, the publisher, the rollback, the turn-on again)
    check(`all ${replayed} database writes the client made were ACCEPTED under the real rules (${Object.keys(counts).map((k) => k + ' ' + counts[k]).join(', ')})`, refusals.length === 0, refusals.join('\n'));
    const ownerWrites = owner.rec.writes.filter(ownerOnly).length;
    check(`the ${ownerWrites} owner-only write(s) were REFUSED to a non-owner director`, nonOwnerFails.length === 0 && ownerWrites >= 3, nonOwnerFails.join('\n') || 'no owner-only write was seen: the harness did not exercise the owner clauses');
    check('every transaction ran in the emulator on the same value the client saw (the replay is faithful)', divergent.length === 0, divergent.join('\n'));
    check('no write carried a value the real SDK would throw on (undefined, NaN, a bad key)', owner.rec.problems.length === 0, owner.rec.problems.slice(0, 5).map((p) => `${p.phase}: ${p.what} ${safePath(p.path)} ${p.problem}`).join('\n'));

    // reads the client made: the engines' three paths must be readable by the owner, and by a director and a counselor
    const readPaths = Array.from(new Set(owner.rec.reads.map((r) => rel(r.path)))).sort();
    const readFails = [];
    for (const p of readPaths) {
      if (!p) continue;
      const o1 = await outcome(() => get(ref(as(OWNER), R + '/' + p)));
      if (o1 !== 'ok') readFails.push(`owner cannot read ${safePath(p)} -> ${o1}`);
      if (['state', 'config', 'setup'].includes(p)) {
        for (const [who, P] of [['director', ED], ['counselor', VW]]) { const o2 = await outcome(() => get(ref(as(P), R + '/' + p))); if (o2 !== 'ok') readFails.push(`${who} cannot read ${p} -> ${o2}`); }
      }
    }
    check(`the ${readPaths.length} path(s) the client reads (${readPaths.map(safePath).join(', ')}) are readable under the real rules`, readFails.length === 0, readFails.join('\n'));

    // the tree the emulator ended with must be the tree the client's database ended with
    const compareKeys = ['state', 'config', 'setup', 'pushSchedule', 'restoreIndex', 'restoreBody'];
    const emu = await readKeys(h, R, compareKeys);
    const bad = [];
    compareKeys.forEach((k) => { const d = treeDiff(canon(owner.db.serverGet(R + '/' + k)), canon(emu[k]), '/' + k); if (d.length) bad.push(...d.slice(0, 4)); });
    check("the emulator's data after the replay equals the client database's (state, config, setup, pushSchedule, restore points)", bad.length === 0, bad.map(safePath).join('\n'));

    // 7. Another director edits the week once it is on: the app's own mutators, signed in as a non-owner director, every
    //    write replayed as that director under the real rules (the section screens' field writes, stamps included)
    const edTree = await readKeys(h, R, LOAD_KEYS);
    const dir = await bootClient({ camp: campId, root: edTree, email: ED.email, role: 'editor', name: 'Probe director' });
    clients.push(dir);
    const edRefusals = [];
    await replay('boot', dir, ED, edRefusals);
    dir.phase('edits');
    const edits = await dir.call('rrEdits', week);
    await replay('edits', dir, ED, edRefusals);
    const edWrites = dir.rec.writes.length;
    console.log(dim(`      edits made: ${edits.done.join('; ')}`));
    check(`a non-owner director's ${edits.done.length} edit(s) after the owner turned it on wrote ${edWrites - dir.rec.writes.filter((w) => w.phase === 'boot').length} thing(s), all ACCEPTED under the real rules`,
      edits.failed.length === 0 && edRefusals.length === 0 && edits.done.length >= 5,
      edits.failed.map((f) => `${f.what}: ${f.why}`).concat(edRefusals).concat(edits.done.length < 5 ? ['fewer than 5 edits ran: the harness did not exercise the sections'] : []).join('\n'));
    edits.skipped.forEach((sk) => note(`not exercised: ${sk.what} (${sk.why})`));
    const edBad = [];
    const edEmu = await readKeys(h, R, ['setup']);
    treeDiff(canon(dir.db.serverGet(R + '/setup')), canon(edEmu.setup), '/setup').forEach((d) => edBad.push(d));
    check("the emulator's setup tree after the director's edits equals the director's own (nothing was dropped or reshaped)", edBad.length === 0, edBad.map(safePath).join('\n'));
    check('no director write carried a value the real SDK would throw on', dir.rec.problems.length === 0, dir.rec.problems.slice(0, 5).map((p) => `${p.phase}: ${p.what} ${safePath(p.path)} ${p.problem}`).join('\n'));

    // 6. teams and placement
    const teams = node.state && node.state.teams;
    const list = Array.isArray(teams) ? teams.filter(Boolean) : isObj(teams) ? Object.keys(teams).sort().map((k) => teams[k]) : [];
    const ids = list.map((t) => (t && t.id) || '?').sort();
    const want = Array.from({ length: teamCount }, (_, i) => 't' + i).sort();
    if (!list.length) note(`state/teams is not in the export: the camp uses its seeded ${teamCount} teams`);
    else check(`state/teams ids are exactly t0…t${teamCount - 1} (Step 25's pre-ship check): ${ids.join(' ')}`, JSON.stringify(ids) === JSON.stringify(want), `expected ${want.join(' ')}`);
    if (place.unscheduled.length) note(`${place.unscheduled.length} game(s) are on NO schedule item after the seed (the hub's "Put games on the schedule" lists them; place them by hand): ` + place.unscheduled.map((g) => `${g.name} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][g.dow]} ${g.session})`).join(', '));
    else note('every game sits on a schedule item after the seed');
    if (place.tba.length) note(`${place.tba.length} meal-cleanup slot(s) read TBA (${place.tba.filter((t) => t.dow === 1).map((t) => t.meal).join('/') || 'none on Monday'} …): ${campId === 'senior' ? "senior's rota is empty by design" : 'the printed rota leaves them open'}`);
    note(`A2 placed ${placed} game(s) on first press`);
  } catch (e) {
    if (e instanceof Stop) { /* the check above said why */ } else check('the harness ran to the end', false, (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e)).replace(/[\w.+-]+@[\w-]+(?:[.,][\w-]+)+/g, '‹member›'));
  } finally {
    clients.forEach((c) => c.stop());
    await h.done();
  }
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  return { campId, ok, failed: checks.filter((c) => !c.ok).map((c) => c.name), checks: checks.length, notes };
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────
const emulatorUp = () => new Promise((resolve) => { const s = net.connect(9000, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
if (!(await emulatorUp())) {
  console.error(red('The database emulator is not running on 127.0.0.1:9000.') + '\nIn another terminal:  cd tests/emulator && npm install && npx firebase emulators:start --only database --project camp-test\n(README.md has the whole recipe.)');
  process.exit(2);
}
const found = loadExport(EXPORT_PATH);
const camps = Object.keys(ROOTS).filter((c) => found[c] && (!ONLY || ONLY === c));
if (!camps.length) { console.error(red('Nothing to run: no camp in the export matches CAMP_ONLY=' + ONLY)); process.exit(2); }
console.log(`Export replay — ${camps.join(' + ')}${MUTATE ? yellow('   [self-test: REPLAY_MUTATE=' + MUTATE + ']') : ''}`);
const results = [];
for (const c of camps) {
  console.log(`\n── ${c} camp ──`);
  results.push(await runCamp(c, found[c]));
}
const missingCamps = Object.keys(ROOTS).filter((c) => !found[c]);
console.log('\n── verdict ──');
results.forEach((r) => console.log(`${r.ok ? green('READY') : red('NOT READY')}  ${r.campId}: ${r.ok ? `${r.checks} checks passed` : `${r.failed.length} of ${r.checks} checks failed — ${r.failed.join('; ')}`}`));
if (missingCamps.length) console.log(yellow(`NOTE  ${missingCamps.join(' + ')} not in this export: ${missingCamps.length === 2 ? 'nothing was' : 'it was not'} checked. Step 16 presses both camps; export the whole database.`));
const all = results.every((r) => r.ok);
console.log(all
  ? (missingCamps.length ? yellow(`\nREADY for ${camps.join(' + ')} only: ${missingCamps.join(' + ')} was NOT checked.`) : green('\nREADY: every check passed. Safe to press Edit the week here.'))
  : red('\nNOT READY: fix the findings above before pressing Edit the week here.'));
process.exit(all ? 0 : 1);
