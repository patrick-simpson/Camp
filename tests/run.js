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
const { makeContext, assert, AssertionError } = require('./harness');

const filter = process.argv[2] || '';
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

let passed = 0;
const failures = [];

async function main() {
  for (const file of files) {
    // A file named *.senior.test.js runs against the SENIOR camp profile —
    // the harness seeds campScoreboardActiveCamp before the scripts load,
    // which is the only moment the camp choice can happen (camps.js reads it
    // at load time). Everything else runs as junior, exactly as before.
    const { ctx, sandbox } = makeContext({ camp: file.includes('.senior.') ? 'senior' : 'junior' });
    const cases = [];
    sandbox.assert = assert;
    sandbox.test = (name, fn) => cases.push({ name, fn });
    // Test files load the app fresh, so a test that needs a clean slate can call
    // this instead of hand-clearing every synced key.
    sandbox.freshState = () => vm.runInContext('state = makeFreshState(); migrateState(state); normalizeSyncedState(); state', ctx);
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
      failures.push({ file, name: '(loading test file)', err: e });
      console.log(`\n${file}\n  \x1b[31m✗\x1b[0m (loading test file)\n      ${(e && e.message) || e}`);
      continue;
    }

    console.log(`\n${file}`);
    for (const { name, fn } of cases) {
      try {
        await fn();
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
      } catch (e) {
        failures.push({ file, name, err: e });
        console.log(`  \x1b[31m✗\x1b[0m ${name}`);
        console.log(`      ${e instanceof AssertionError ? e.message : (e && e.stack) || e}`);
      }
    }
  }

  console.log('');
  if (failures.length) {
    console.log(`\x1b[31m${failures.length} failed\x1b[0m, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\x1b[32m${passed} passed\x1b[0m (${files.length} file${files.length === 1 ? '' : 's'})`);
}

main();
