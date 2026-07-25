#!/usr/bin/env node
// Test runner:  node tests/run.js  [name-filter]
//
// Every *.test.js file in this directory gets its own freshly-loaded copy of the
// app (see harness.js), so a test that mutates `state` can't affect any other
// file. Exit code is non-zero if anything fails, so this drops straight into a
// pre-commit hook or CI later on.

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

files.forEach((file) => {
  const { ctx, sandbox } = makeContext();
  const cases = [];
  sandbox.assert = assert;
  sandbox.test = (name, fn) => cases.push({ name, fn });
  // Test files load the app fresh, so a test that needs a clean slate can call
  // this instead of hand-clearing every synced key.
  sandbox.freshState = () => vm.runInContext('state = makeFreshState(); migrateState(state); normalizeSyncedState(); state', ctx);

  try {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), ctx, { filename: file });
  } catch (e) {
    failures.push({ file, name: '(loading test file)', err: e });
    return;
  }

  console.log(`\n${file}`);
  cases.forEach(({ name, fn }) => {
    try {
      fn();
      passed++;
      console.log(`  [32m✓[0m ${name}`);
    } catch (e) {
      failures.push({ file, name, err: e });
      console.log(`  [31m✗[0m ${name}`);
      console.log(`      ${e instanceof AssertionError ? e.message : (e && e.stack) || e}`);
    }
  });
});

console.log('');
if (failures.length) {
  console.log(`[31m${failures.length} failed[0m, ${passed} passed`);
  process.exit(1);
}
console.log(`[32m${passed} passed[0m (${files.length} file${files.length === 1 ? '' : 's'})`);
