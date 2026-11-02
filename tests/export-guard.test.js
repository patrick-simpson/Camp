// A Firebase console export of the database holds members' emails, phone numbers and the chat. It must never reach git.
// The console saves one as <project>-default-rtdb-export.json (tests/emulator/README.md's example is camp-export.json), so the
// repo's .gitignore files have to cover THOSE names, not only the ones a script writes. These pin three things:
//   1. the names an owner will really have are ignored, at the repo root and in the places the README sends them;
//   2. the patterns don't swallow the tooling that legitimately has "export" in its name;
//   3. nothing already tracked is, or looks like, a database export (a renamed one is caught by what is inside it).
// Needs git and a work tree; without them it says so (a tarball of the repo has nothing to protect).
const cp = nodeRequire('child_process');
const nodePath = nodeRequire('path');
const nodeFs = nodeRequire('fs');
const REPO = nodePath.resolve(nodePath.dirname(nodeRequire.resolve('./harness.js')), '..');
const git = (args) => cp.spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
const inWorkTree = () => { const r = git(['rev-parse', '--is-inside-work-tree']); return !r.error && r.status === 0 && r.stdout.trim() === 'true'; };
const ignored = (p) => git(['check-ignore', '-q', '--no-index', p]).status === 0;

test('the names a console export really has are ignored (git check-ignore), wherever it is dropped', () => {
  if (!inWorkTree()) { console.log('      (skipped: not inside a git work tree)'); return; }
  const names = ['camp-89cea-default-rtdb-export.json', 'camp-export.json', 'synthetic-clean.export.json', 'my-export-2026-11-02.json', 'export.json'];
  const dirs = ['', 'tests/', 'tests/emulator/', 'docs/', 'push-worker/'];
  const loose = [];
  dirs.forEach((d) => names.forEach((n) => { if (!ignored(d + n)) loose.push(d + n); }));
  assert.ok(loose.length === 0, 'not ignored (an export saved here would be swept up by `git add -A`): ' + loose.join(', '));
  assert.ok(ignored('exports/anything.json') && ignored('tests/emulator/exports/anything.json'), 'an exports/ folder is not ignored');
});

test('the ignore patterns do not hide the replay tooling', () => {
  if (!inWorkTree()) { console.log('      (skipped: not inside a git work tree)'); return; }
  ['tests/emulator/export-replay.mjs', 'tests/emulator/make-synthetic-export.mjs', 'tests/export-guard.test.js', 'tests/emulator/README.md', 'database.rules.json']
    .forEach((p) => assert.ok(!ignored(p), p + ' would be ignored: it is tooling, not an export'));
});

test('no tracked file is a database export (by name, or by what is inside it)', () => {
  if (!inWorkTree()) { console.log('      (skipped: not inside a git work tree)'); return; }
  const listed = git(['ls-files', '-z']);
  assert.ok(listed.status === 0, 'git ls-files failed');
  const files = listed.stdout.split('\0').filter(Boolean);
  assert.ok(files.length > 50, 'git ls-files returned almost nothing: the guard would be vacuous');
  const byName = files.filter((f) => /export[^/]*\.json$/i.test(f));
  assert.ok(byName.length === 0, 'tracked, and named like an export: ' + byName.join(', '));
  // a renamed export still has the camps' root keys, or a camp root's own members + state
  const looksLike = [];
  files.filter((f) => /\.json$/i.test(f)).forEach((f) => {
    let v; try { v = JSON.parse(nodeFs.readFileSync(nodePath.join(REPO, f), 'utf8')); } catch (e) { return; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    const k = Object.keys(v);
    if (k.includes('campScoreboard') || k.includes('seniorScoreboard') || (k.includes('members') && k.includes('state'))) looksLike.push(f);
  });
  assert.ok(looksLike.length === 0, 'tracked JSON that looks like a database export (camp root keys inside): ' + looksLike.join(', '));
});
