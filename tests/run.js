#!/usr/bin/env node
// Test runner:  node tests/run.js  [name-filter]
//
// Every *.test.js file in this directory gets its own freshly-loaded copy of the
// app (see harness.js), so a test that mutates `state` can't affect any other
// file. Exit code is non-zero if anything fails, so this drops straight into a
// pre-commit hook or CI later on.
//
// A test callback may return a promise (async tests) — the runner awaits it.
// Files run strictly one after another so output never interleaves.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeContext, clearAllTimers, assert, AssertionError } = require('./harness');

const filter = process.argv[2] || '';
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

// The SEEDED pass (setup-rebuild-spec §10.4, build step 15): these files run a second time against a camp whose
// schedule is already edited here (makeContext({ seeded: true }): the seed is the setup tree, the games sit on their
// schedule items). Passing proves the accessors' "on" half renders everything exactly as the built-in half did.
// Each runs as junior and, where the file has a .senior twin, as senior. A redesign test joins the list when it
// ships (step 17 added now-model; step 18 adds games-tab).
// SEEDED=all runs every file seeded (a probe for which tests still assume an empty setup tree).
const SEEDED_FILES = [
  'week', 'push', 'chat', 'ics', 'tabs', 'frame', 'shell', 'home', 'render-stability', 'game-view', 'secrecy', 'motion', 'overlays', 'boot-cache', 'backup',
  'reveal-ui', 'reveal-remote', 'preview', 'tell', 'award', 'now-model',
];
const seededAll = process.env.SEEDED === 'all';
const plain = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && !f.includes('.senior.'));
const seededJobs = process.env.SEEDED === 'off' ? [] : [].concat(...plain
  .filter((f) => seededAll || SEEDED_FILES.indexOf(f.replace('.test.js', '')) !== -1)
  .filter((f) => !filter || f.includes(filter))
  .map((f) => {
    const twin = f.replace('.test.js', '.senior.test.js');
    const out = [{ file: f, camp: 'junior' }];
    if (fs.existsSync(path.join(__dirname, twin))) out.push({ file: twin, camp: 'senior' });
    return out;
  }));

// The SEEDED-ALL pass (build step 19): the files whose output a menu, a rota, a verse or an elective list could change run a
// third time with the four smaller sections ON as well (makeContext({ seeded: 'all' }) — what the page holds once the owner has
// turned everything on). Passing proves the sections' "on" half shows exactly what the built-in half did, on both camps.
// Award points reads the verse, the rota and the meal times, so it runs here as well as seeded; Tell everyone reads none of them but
// is the director's other live tool, and both camps run with every section on.
const SEEDED_ALL_FILES = ['week', 'ics', 'push', 'chat', 'home', 'tabs', 'shell', 'render-stability', 'secrecy', 'frame', 'tell', 'award', 'now-model'];
const seededAllJobs = seededJobs.filter((j) => SEEDED_ALL_FILES.indexOf(j.file.replace('.senior', '').replace('.test.js', '')) !== -1);

let passed = 0;
const failures = [];

async function main() {
  const jobs = files.map((file) => ({ file, camp: file.includes('.senior.') ? 'senior' : 'junior', seeded: false }))
    .concat(seededJobs.map((j) => Object.assign({ seeded: true }, j)))
    .concat(seededAllJobs.map((j) => Object.assign({}, j, { seeded: 'all' })));
  for (const { file, camp, seeded } of jobs) {
    // A file named *.senior.test.js runs against the SENIOR camp profile —
    // the harness seeds campScoreboardActiveCamp before the scripts load,
    // which is the only moment the camp choice can happen (camps.js reads it
    // at load time). Everything else runs as junior, exactly as before.
    const { ctx, sandbox } = makeContext({ camp, seeded });
    const label = seeded === 'all' ? file + ' (seeded, every section)' : seeded ? file + ' (seeded)' : file;
    const cases = [];
    sandbox.assert = assert;
    sandbox.test = (name, fn) => cases.push({ name, fn });
    // Test files load the app fresh, so a test that needs a clean slate can call
    // this instead of hand-clearing every synced key.
    sandbox.freshState = () => vm.runInContext('state = makeFreshState(); migrateState(state); normalizeSyncedState(); state', ctx);
    if (seeded) {
      // A fresh state in a seeded camp still has its games on their schedule items (what the config snapshot brings).
      sandbox.freshState = () => vm.runInContext(
        'state = makeFreshState(); migrateState(state); normalizeSyncedState(); setupApplyGameAttachments(state.config, setupGameAttachments(state.config, (dow) => planForDow(dow), CAMP).ops); state', ctx);
    }
    // Fixture files (e.g. the pre-move junior-week snapshot) live next to the tests.
    // Normalize CRLF: a Windows checkout can carry CRLF, and the source-pin
    // tests slice bodies on '\n}\n' — with CRLF they run to end of file.
    sandbox.readFixture = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\r\n/g, '\n');
    // The phone-alert Worker (push-worker/worker.js) is an ES module that runs
    // on Cloudflare, not a browser script, so its tests load it in Node's MAIN
    // realm instead of this vm context, and use node:crypto to check its output
    // independently. Do the crypto/typed-array work in the main realm and pass
    // only plain strings/objects across.
    sandbox.nodeRequire = require;
    sandbox.importModule = (rel) => import(require('url').pathToFileURL(path.join(__dirname, rel)).href);

    try {
      vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), ctx, { filename: file });
    } catch (e) {
      failures.push({ file: label, name: '(loading test file)', err: e });
      console.log(`\n${label}\n  \x1b[31m✗\x1b[0m (loading test file)\n      ${(e && e.message) || e}`);
      continue;
    }

    console.log(`\n${label}`);
    for (const { name, fn } of cases) {
      try {
        await fn();
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
      } catch (e) {
        failures.push({ file: label, name, err: e });
        console.log(`  \x1b[31m✗\x1b[0m ${name}`);
        console.log(`      ${e instanceof AssertionError ? e.message : (e && e.stack) || e}`);
      }
    }
    // The file is finished: cancel every timer its scenarios left running (the
    // file's own context and any second one it built), or Node keeps the
    // process alive after every case has passed.
    clearAllTimers();
  }

  console.log('');
  if (failures.length) {
    console.log(`\x1b[31m${failures.length} failed\x1b[0m, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\x1b[32m${passed} passed\x1b[0m (${files.length} file${files.length === 1 ? '' : 's'}${seededJobs.length ? ' + ' + seededJobs.length + ' seeded + ' + seededAllJobs.length + ' seeded-all' : ''})`);
}

main();
