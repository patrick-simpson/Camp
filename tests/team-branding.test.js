// A team's own branding (BUILD-PLAN Step 25, P2 §5.7.1 / §11.7): the optional fields short, emoji, color and photoV
// of state.teams[i], read per field with the camp's constant as the fallback, every one laundered on the way out; the
// uploaded photo's loader (only a crest that is about to be drawn, one once() per photoV, never a listener, cleaned like
// the rules clean it); and what a backup or a restore point may carry in. team-branding.senior.test.js evals this file.

const { makeFakeRtdb } = nodeRequire('./fake-rtdb.js');
const APP = readFixture('../app.js');
const SETTINGS = readFixture('../settings.js');
const SETUP_SYNC = readFixture('../setup-sync.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD';

// ── the fields, per field, with the constant as the fallback ──

test('short and emoji come from the record when it has them, per field, else from the camp constant', () => {
  freshState();
  const id = 't0';
  assert.equal(teamShort(id), TEAM_ABBREV[id]);
  assert.equal(teamEmoji(id), TEAM_EMOJI[id]);
  state.teams[0].short = 'Hawks';
  assert.equal(teamShort(id), 'Hawks');
  assert.equal(teamEmoji(id), TEAM_EMOJI[id], 'the emoji is still the constant: each field falls back on its own');
  state.teams[0].emoji = '🦅';
  assert.equal(teamEmoji(id), '🦅');
  delete state.teams[0].short;
  assert.equal(teamShort(id), TEAM_ABBREV[id]);
  // A team the camp has no constants for, with a record of its own.
  state.teams.push({ id: 't9', name: 'Extra', counselor: '', short: 'X', emoji: '🐙' });
  assert.equal(teamShort('t9'), 'X');
  assert.equal(teamEmoji('t9'), '🐙');
  freshState();
});

test('a hostile short name or emoji from the database falls back or is cut, never reaches markup', () => {
  freshState();
  ['<img src=x onerror=alert(1)>', 42, null, {}, ['a'], '   ', ''].forEach((bad) => {
    state.teams[0].emoji = bad;
    assert.equal(teamEmoji('t0'), TEAM_EMOJI.t0, 'emoji ' + JSON.stringify(bad));
  });
  ['a<b>c', '"><script>x</script>'].forEach((short) => {
    state.teams[0].emoji = short;
    assert.notOk(/[<>"'&]/.test(teamEmoji('t0')), 'a short payload loses its markup characters: ' + teamEmoji('t0'));
  });
  state.teams[0].short = 'A name far too long for a tight space, really';
  assert.ok(teamShort('t0').length <= 20, 'cut to 20');
  [42, null, {}, '', '   '].forEach((bad) => {
    state.teams[0].short = bad;
    assert.equal(teamShort('t0'), TEAM_ABBREV.t0, 'short ' + JSON.stringify(bad));
  });
  freshState();
});

// ── the validity checks the Teams screen and the backup cleaner share (the rules' own limits) ──

test('the branding validity checks mirror the published rules', () => {
  assert.ok(teamShortValid('Foxes') && teamShortValid('A'.repeat(20)) && teamShortValid("John Deer's"));
  ['', 'A'.repeat(21), 'a<b', 'a>b', 'a&b', 'a"b', 42, null, undefined, 'tab\there'].forEach((bad) => assert.notOk(teamShortValid(bad), JSON.stringify(bad)));
  assert.ok(teamEmojiValid('🦊') && teamEmojiValid('🏳️') && teamEmojiValid('👨‍👩‍👧‍👦'));
  ['', 'a'.repeat(17), 'a<b', "a'b", 'a"b', 'a&b', 7, null].forEach((bad) => assert.notOk(teamEmojiValid(bad), JSON.stringify(bad)));
  Object.keys(CAMP_TEAM_PALETTE).forEach((c) => assert.ok(teamColorValid(c), c));
  ['', 'Red', 'constructor', '__proto__', 'red;x', 7, null, 'x'.repeat(13)].forEach((bad) => assert.notOk(teamColorValid(bad), JSON.stringify(bad)));
  assert.ok(teamPhotoVValid(0) && teamPhotoVValid(1730000000000));
  [-1, NaN, Infinity, '5', null, undefined].forEach((bad) => assert.notOk(teamPhotoVValid(bad), JSON.stringify(bad)));
});

// ── the crest: an uploaded photo > the shipped shield > the flag / emoji ──

test('teamCrestSrc: the uploaded photo wins once THIS version is on the device, then the shield', () => {
  freshState();
  const shield = safeCrestSrc(TEAM_SHIELD.t0);
  assert.equal(teamCrestSrc('t0'), shield || null, 'no photo: the camp\'s own crest, or none');
  state.teams[0].photoV = 5;
  assert.equal(teamCrestSrc('t0'), shield || null, 'a photoV with no photo here yet shows the shield meanwhile');
  TEAM_PHOTO_MEM.set('t0:5', PNG);
  assert.equal(teamCrestSrc('t0'), PNG, 'the photo, once it is here');
  state.teams[0].photoV = 6;
  assert.equal(teamCrestSrc('t0'), shield || null, 'a newer version is not the one we hold: never show the old one as if current');
  state.teams[0].photoV = 5;
  TEAM_PHOTO_MEM.set('t0:5', 'data:image/png;base64,AAAA" onerror="alert(1)');
  assert.equal(teamCrestSrc('t0'), shield || null, 'a quote-breakout in memory is refused at the accessor too');
  TEAM_PHOTO_MEM.set('t0:5', 'https://tracker.example/pixel.png');
  assert.equal(teamCrestSrc('t0'), shield || null, 'an external image is refused');
  TEAM_PHOTO_MEM.clear();
  freshState();
});

test('a photo gives a camp with only flags (senior) or emoji a shield-style mark', () => {
  freshState();
  state.teams[1].photoV = 9;
  TEAM_PHOTO_MEM.set('t1:9', JPG);
  const spec = teamMarkSpec('t1');
  assert.equal(spec.kind, 'shield');
  assert.equal(spec.src, JPG);
  assert.ok(teamMarkHtml('t1', { size: 40 }).includes('src="' + JPG + '"'));
  TEAM_PHOTO_MEM.clear();
  freshState();
});

// ── the loader ──

// A device whose IndexedDB answers at once (a dict). The harness's own stub never answers, which is what the
// "an IndexedDB that never answers" case below relies on.
function fakeIdb() {
  const data = new Map();
  const tx = {};
  const wrap = (run) => (...a) => { const r = {}; setTimeout(() => { r.result = run(...a); if (r.onsuccess) r.onsuccess(); if (tx.oncomplete) tx.oncomplete(); }, 0); return r; };
  tx.objectStore = () => ({ put: wrap((v, k) => { data.set(k, v); return k; }), get: wrap((k) => data.get(k)) });
  const idb = { open() { const req = {}; setTimeout(() => { req.result = { close() {}, transaction: () => tx }; req.onsuccess(); }, 0); return req; } };
  return { idb, data };
}
let savedIdb = null;
function useIdb(f) { if (!savedIdb) savedIdb = { idb: indexedDB }; indexedDB = f.idb; photoDBPromise = null; photoDBConn = null; }
function restoreIdb() { if (savedIdb) { indexedDB = savedIdb.idb; savedIdb = null; photoDBPromise = null; photoDBConn = null; } }

function loaderDb(node) {
  const db = makeFakeRtdb();
  const reads = [];
  window.firebase = { database: () => ({ ref: (p) => { reads.push(p); return db.ref(p); } }) };
  if (node !== undefined) db.serverSet(dbPath('teamPhotos/t0'), node);
  fbRef = db.ref(dbPath('state'));
  return { db, reads };
}
function loaderDone() {
  restoreIdb();
  fbRef = null;
  delete window.firebase;
  TEAM_PHOTO_MEM.clear();
  teamPhotoAsked.clear();
  freshState();
}

test('only a crest that is about to be drawn is fetched, once per version, with one once() and no listener', async () => {
  freshState();
  const idb = fakeIdb();
  useIdb(idb);
  const { db, reads } = loaderDb({ v: 7, data: PNG });
  state.teams[0].photoV = 7;
  state.teams[1].photoV = 3;
  // Nothing draws a crest yet: nothing is read.
  await waitQuiet();
  assert.deepEqual(reads, [], 'a team whose crest nobody draws is never fetched');
  teamMarkHtml('t0', { size: 34 }); // the header / the sheet draws t0's mark
  teamMarkHtml('t0', { size: 52 });
  teamMarkHtml('t0', { size: 34 });
  await waitUntil(() => TEAM_PHOTO_MEM.has('t0:7'), 'the photo to arrive');
  assert.deepEqual(reads, [dbPath('teamPhotos/t0')], 'one read for the team drawn, none for the other');
  assert.equal(db.listenerCount(dbPath('teamPhotos/t0')), 0, 'never a listener');
  assert.equal(teamCrestSrc('t0'), PNG);
  teamMarkHtml('t0', { size: 34 });
  await waitQuiet();
  assert.equal(reads.length, 1, 'a held photo is not asked for again');
  // A new version is a new ask.
  state.teams[0].photoV = 8;
  db.serverSet(dbPath('teamPhotos/t0'), { v: 8, data: JPG });
  teamMarkHtml('t0', { size: 34 });
  await waitUntil(() => TEAM_PHOTO_MEM.has('t0:8'), 'the newer photo to arrive');
  assert.equal(reads.length, 2);
  assert.notOk(TEAM_PHOTO_MEM.has('t0:7'), 'only the newest version is kept in memory');
  assert.equal(teamCrestSrc('t0'), JPG);
  await waitUntil(() => idb.data.get(teamPhotoIdbKey('t0', 8)) === JPG, 'the photo to be kept on the device');
  loaderDone();
});

test('a photo already on the device is used without asking the server, and a tampered one is not trusted', async () => {
  freshState();
  const idb = fakeIdb();
  useIdb(idb);
  idb.data.set(teamPhotoIdbKey('t0', 5), PNG);
  const { reads } = loaderDb({ v: 5, data: JPG });
  state.teams[0].photoV = 5;
  teamMarkHtml('t0', { size: 34 });
  await waitUntil(() => TEAM_PHOTO_MEM.has('t0:5'), 'the device\'s own copy');
  await waitQuiet();
  assert.deepEqual(reads, [], 'no network read');
  assert.equal(teamCrestSrc('t0'), PNG);
  TEAM_PHOTO_MEM.clear(); teamPhotoAsked.clear();
  idb.data.set(teamPhotoIdbKey('t0', 5), 'data:image/png;base64,AAAA" onerror="alert(1)');
  teamMarkHtml('t0', { size: 34 });
  await waitUntil(() => TEAM_PHOTO_MEM.has('t0:5'), 'the server copy after a bad local one');
  assert.equal(reads.length, 1);
  assert.equal(teamCrestSrc('t0'), JPG);
  loaderDone();
});

test('an IndexedDB that never answers does not keep the server from being asked', async () => {
  freshState();
  const { reads } = loaderDb({ v: 5, data: PNG }); // the harness's own IndexedDB stub never answers
  state.teams[0].photoV = 5;
  teamMarkHtml('t0', { size: 34 });
  await waitUntil(() => TEAM_PHOTO_MEM.has('t0:5'), 'the photo after the wait');
  assert.equal(reads.length, 1);
  loaderDone();
});

test('nothing is asked before the member check has approved the device (fbRef is null), and a later render asks', async () => {
  freshState();
  useIdb(fakeIdb());
  const { reads } = loaderDb({ v: 4, data: PNG });
  fbRef = null;
  state.teams[0].photoV = 4;
  teamMarkHtml('t0', { size: 34 });
  await waitQuiet();
  assert.deepEqual(reads, [], 'not approved: no read');
  assert.notOk(teamPhotoAsked.has('t0:4'), 'and not recorded as asked, so it is not lost');
  fbRef = {};
  teamMarkHtml('t0', { size: 34 });
  await waitUntil(() => TEAM_PHOTO_MEM.has('t0:4'), 'the photo once approved');
  loaderDone();
});

test('what the database holds is laundered like the rules would: the full data URL, the version, the size cap', async () => {
  freshState();
  useIdb(fakeIdb());
  const bad = [
    ['a quote breakout', { v: 2, data: 'data:image/png;base64,AAAA" onerror="alert(1)' }],
    ['an external image', { v: 2, data: 'https://tracker.example/pixel.png' }],
    ['an SVG', { v: 2, data: 'data:image/svg+xml;base64,PHN2Zz4=' }],
    ['a number', { v: 2, data: 42 }],
    ['another version', { v: 3, data: PNG }],
    ['over the cap', { v: 2, data: 'data:image/png;base64,' + 'A'.repeat(100000) }],
    ['a bare string', 'data:image/png;base64,AAAA'],
    ['nothing', null],
  ];
  for (const [what, node] of bad) {
    const { reads } = loaderDb(node === null ? undefined : node);
    teamPhotoAsked.clear(); TEAM_PHOTO_MEM.clear();
    state.teams[0].photoV = 2;
    teamMarkHtml('t0', { size: 34 });
    await waitUntil(() => reads.length === 1, 'the read for ' + what);
    await waitQuiet();
    assert.equal(TEAM_PHOTO_MEM.size, 0, what + ' is not kept');
    assert.equal(teamCrestSrc('t0'), safeCrestSrc(TEAM_SHIELD.t0) || null, what + ': the shield / emoji stays');
  }
  loaderDone();
});

test('a refused read is final for that version; a dropped connection is asked about again', async () => {
  freshState();
  useIdb(fakeIdb());
  const db = makeFakeRtdb();
  let n = 0, code = 'PERMISSION_DENIED';
  window.firebase = { database: () => ({ ref: () => ({ once: () => { n++; return Promise.reject(Object.assign(new Error('x'), { code })); } }) }) };
  fbRef = db.ref(dbPath('state'));
  state.teams[0].photoV = 1;
  teamMarkHtml('t0', { size: 34 });
  await waitUntil(() => n === 1, 'the refused read');
  await waitQuiet();
  teamMarkHtml('t0', { size: 34 });
  await waitQuiet();
  assert.equal(n, 1, 'denied: not asked again');
  teamPhotoAsked.clear();
  code = 'NETWORK_ERROR';
  teamMarkHtml('t0', { size: 34 });
  await waitUntil(() => n === 2, 'the second read');
  await waitQuiet();
  teamMarkHtml('t0', { size: 34 });
  await waitUntil(() => n === 3, 'asked again after a network error');
  loaderDone();
});

test('the photo is kept under a per-camp, per-version key and only crest-drawing code asks for it', () => {
  assert.equal(teamPhotoIdbKey('t2', 123), 'team:' + CAMP.id + ':t2:123');
  const callers = APP.split('\n').filter((l) => /teamPhotoNeed\(/.test(l) && !/^function teamPhotoNeed/.test(l));
  assert.equal(callers.length, 2, 'teamMarkSpec and the Your team card, nothing else: ' + callers.join(' | '));
  assert.ok(!/once\(['"]value['"]\)[^;]*teamPhotos/.test(SETUP_SYNC) && !/teamPhotos/.test(SETTINGS), 'the classic builder and the setup engine never read the photos');
});

// ── a backup or a restore point only carries well-formed branding in ──

test('teamsFromBackup keeps name and counselor, takes only valid branding, and never a photo version', () => {
  freshState();
  state.teams[0].photoV = 11;
  const file = [
    { id: 't0', name: 'Foxes', counselor: 'Pat', short: 'Fox', emoji: '🦊', color: 'pumpkin', photoV: 99 },
    { id: 't1', name: 'Hawks', counselor: '', short: '<b>', emoji: '<img>', color: 'red;x', photoV: 3, extra: 'kept as is' },
    null, 'junk',
  ];
  const out = teamsFromBackup(file);
  assert.deepEqual(out[0], { id: 't0', name: 'Foxes', counselor: 'Pat', short: 'Fox', emoji: '🦊', color: 'pumpkin', photoV: 11 }, 'the LIVE photo version stays, the file\'s is dropped');
  assert.deepEqual(out[1], { id: 't1', name: 'Hawks', counselor: '', extra: 'kept as is' }, 'invalid branding is dropped, nothing else is touched');
  assert.equal(out[2], null);
  assert.equal(out[3], 'junk');
  assert.equal(teamsFromBackup(undefined), undefined);
  assert.deepEqual(file[0].photoV, 99, 'the input is not mutated');
  freshState();
});

test('a backup file and a restore point both go through it', () => {
  assert.ok(/state\.teams = teamsFromBackup\(src\.teams\)/.test(SETTINGS), 'tryImport');
  assert.ok(/state\.teams = teamsFromBackup\(setupClone\(body\.state\.teams\)\)/.test(SETUP_SYNC), 'restoreApply');
  assert.ok(/teamsCanon\(teamsFromBackup\(pt\)\)/.test(SETUP_SYNC), 'the preview says what it will really change');
});
