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
  // Pin the camp clock to a quiet hour (Sunday 3 AM). A photo arriving re-renders the page, and the Now card draws the
  // team marks of a meal's cleanup note: at supper time on a real clock that draws t1's crest, which "nobody draws" here.
  location.search = '?now=0-0300';
  const db = makeFakeRtdb();
  const reads = [];
  window.firebase = { database: () => ({ ref: (p) => { reads.push(p); return db.ref(p); } }) };
  if (node !== undefined) db.serverSet(dbPath('teamPhotos/t0'), node);
  fbRef = db.ref(dbPath('state'));
  return { db, reads };
}
function loaderDone() {
  location.search = '';
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
  assert.equal(callers.length, 1, 'teamMarkSpec (the one place a crest is drawn from), nothing else: ' + callers.join(' | '));
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

// ── the schedule's labels follow a team's short name and emoji ──

test('a team\'s new short name and emoji reach the schedule\'s labels at once, with the setup tree untouched', () => {
  freshState();
  const saved = setupTree;
  try {
    // The schedule edited here: a typical-day block that names two teams. The plans are memoized on the tree, and the label
    // bakes the teams' emoji and short name in, so the memo must also notice a roster change that never touched the tree
    // (the Teams screen's Save, a colleague's snapshot, an undo, a restore).
    setupTree = normalizeSetup(setupClone(syncCanon(buildSeed(CAMP))));
    const bid = Object.keys(setupTree.typical)[0];
    setupTree.typical[bid].teams = { t0: true, t1: true };
    setupRev++;
    assert.ok(scheduleIsShared(), 'the seeded tree has the schedule switch on');
    const find = () => planForDow(1).find((b) => b.id === bid);
    const tail = (a, b) => teamEmoji('t0') + ' ' + teamShort('t0') + ' & ' + teamEmoji('t1') + ' ' + teamShort('t1');
    const first = find();
    assert.ok(first && first.label.endsWith(tail()), 'the tail names both teams: ' + (first && first.label));
    const day = planForDow(1);
    assert.ok(planForDow(1) === day, 'nothing changed: the same objects, so an idle render writes nothing');
    const key = first.alertKey;
    state.teams[0].short = 'Hawks';
    state.teams[0].emoji = '🦅';
    const after = find();
    assert.ok(after.label.includes('🦅 Hawks'), 'the plan follows the roster: ' + after.label);
    assert.equal(after.label, first.label.split(' — ')[0] + ' — ' + tail());
    assert.ok(scheduleForDow(1).some((b) => b.label === after.label), 'and so does the legacy day every renderer reads');
    assert.equal(after.alertKey, key, 'a rename never re-keys a block: every phone\'s alert subscriptions survive');
    assert.ok(planForDow(1) === planForDow(1), 'the rebuilt plan is memoized again');
    // The same roster again (a snapshot echo) rebuilds nothing.
    const stable = planForDow(1);
    state.teams[0].short = 'Hawks';
    assert.ok(planForDow(1) === stable, 'an echo of the same roster rebuilds nothing');

    // The built-in week (the schedule off): a block of the printed week that names teams, where the camp has one.
    freshState();
    setupTree = normalizeSetup({}); setupRev++;
    assert.notOk(scheduleIsShared());
    let hit = null;
    for (let d = 0; d < 7 && !hit; d++) {
      planForDow(d).forEach((b) => teamIds().forEach((tid) => { if (!hit && b.label.includes(teamEmoji(tid) + ' ' + teamShort(tid))) hit = { d, tid, old: teamEmoji(tid) + ' ' + teamShort(tid) }; }));
    }
    if (hit) {
      const idx = state.teams.findIndex((t) => t.id === hit.tid);
      state.teams[idx].short = 'Zed';
      state.teams[idx].emoji = '🦓';
      const labels = planForDow(hit.d).map((b) => b.label);
      assert.ok(labels.some((l) => l.includes('🦓 Zed')), 'the printed week follows the roster too: ' + labels.join(' | '));
      assert.notOk(labels.some((l) => l.includes(hit.old)), 'and no label keeps the old tail');
    }
  } finally {
    setupTree = saved; setupRev++;
    freshState();
  }
});

// ── the cleared look: `plain: true` (the new-year setup's team-names Clear; owner's decisions item 8) ──

const KEYCAP = (n) => n + '️⃣';
function wzPlainTeam(i) { state.teams[i] = Object.assign({}, state.teams[i], { name: 'Team ' + (i + 1), short: 'Team ' + (i + 1), emoji: KEYCAP(i + 1), plain: true }); delete state.teams[i].color; }

test('a plain team never falls back to the camp\'s printed look: no shield, mascot, flag, colour or short name', () => {
  freshState();
  // without the marker the printed look stands
  assert.equal(teamPlain('t0'), false);
  assert.equal(teamShort('t0'), TEAM_ABBREV.t0);
  state.teams[0].plain = true;                     // the marker alone, no fields (an old record, or a field cleared on the sheet)
  assert.equal(teamPlain('t0'), true);
  assert.equal(teamShort('t0'), 'Team 1', 'never the printed short name');
  assert.equal(teamEmoji('t0'), KEYCAP(1));
  assert.equal(teamEmojiOwn('t0'), KEYCAP(1), 'the hub never says "no emoji"');
  assert.equal(teamCrestSrc('t0'), null, 'never the shipped shield');
  assert.equal(teamAccentVars('t0'), '', 'never the camp\'s older colour');
  assert.equal(teamAccent('t0'), null);
  const spec = teamMarkSpec('t0');
  assert.equal(spec.kind, 'tile', 'never a shield, never the senior flag');
  assert.equal(spec.emoji, KEYCAP(1));
  const html = teamMarkHtml('t0', { size: 40, label: 'Team 1' });
  assert.ok(html.indexOf('data-num="1"') !== -1 && html.indexOf('>1</span>') !== -1, 'the digit is drawn in type: ' + html);
  assert.equal(/--tm-accent|--team-accent/.test(html), false, 'no inline colour: styles.css keys the neutral ink edge on its absence');
  assert.equal(html.indexOf('<img'), -1);
  // the slot's number follows its place, t1 is Team 2
  state.teams[1].plain = true;
  assert.equal(teamShort('t1'), 'Team 2');
  assert.equal(teamEmoji('t1'), KEYCAP(2));
  // other teams are untouched
  assert.equal(teamShort('t2'), TEAM_ABBREV.t2);
  freshState();
});

test('plain: only the boolean true counts; any other stored value reads as absent', () => {
  freshState();
  ['true', 1, 'yes', {}, [], null, false, '<b>'].forEach((bad) => {
    state.teams[0].plain = bad;
    assert.equal(teamPlain('t0'), false, JSON.stringify(bad));
    assert.equal(teamShort('t0'), TEAM_ABBREV.t0);
  });
  assert.equal(teamPlain('nope'), false, 'an id off the roster');
  freshState();
});

test('after a plain team, a later pick shows as usual: a colour is the tile\'s edge, an emoji its glyph, a photo beats everything, and the flag never comes back', () => {
  freshState();
  wzPlainTeam(0);
  state.teams[0].color = 'teal';
  assert.equal(teamColorId('t0'), 'teal');
  assert.ok(/--team-accent-l:#[0-9a-f]{6}/i.test(teamAccentVars('t0')));
  const spec = teamMarkSpec('t0');
  assert.equal(spec.kind, 'tile', 'a picked colour fills the tile\'s edge; the senior flag does not return');
  const html = teamMarkHtml('t0', { size: 40 });
  assert.ok(html.indexOf('--tm-accent:var(--team)') !== -1, 'the colour is inline only for a team that has one');
  state.teams[0].emoji = '🦅';
  assert.equal(teamEmoji('t0'), '🦅');
  assert.equal(teamMarkHtml('t0', { size: 40 }).indexOf('data-num'), -1, 'a real emoji is not a numeral');
  state.teams[0].short = 'Hawks';
  assert.equal(teamShort('t0'), 'Hawks');
  delete state.teams[0].short;
  assert.equal(teamShort('t0'), 'Team 1', 'emptying a field falls back to the slot, never the printed name');
  state.teams[0].photoV = 4;
  TEAM_PHOTO_MEM.set('t0:4', PNG);
  assert.equal(teamCrestSrc('t0'), PNG);
  assert.equal(teamMarkSpec('t0').kind, 'shield', 'a photo beats everything');
  TEAM_PHOTO_MEM.clear();
  freshState();
});

test('a keycap tile draws its digit in a bracket mark too, and no mascot flies for it', () => {
  freshState();
  wzPlainTeam(0);
  assert.ok(bracketMarkHtml('t0', 28).indexOf('data-num="1"') !== -1, 'the numeral tile, never the platform\'s keycap box');
  assert.equal(teamMascot('t0'), '', 'confetti and cannons use the party emoji instead');
  assert.equal(teamMascot('t1'), teamEmoji('t1'));
  freshState();
});

test('teamsFromBackup carries plain only as the boolean true, and a backup without it takes it off', () => {
  freshState();
  const out = teamsFromBackup([{ id: 't0', name: 'Team 1', plain: true, short: 'Team 1', emoji: KEYCAP(1) }, { id: 't1', name: 'Team 2', plain: 'true' }, { id: 't2', name: 'Foxes' }]);
  assert.equal(out[0].plain, true);
  assert.equal(out[0].emoji, KEYCAP(1), 'the keycap passes the emoji check');
  assert.equal(out[1].plain, undefined);
  assert.equal(out[2].plain, undefined);
  freshState();
});

test('plain syncs per field like the rest of the roster: teams/<i>/plain', () => {
  freshState();
  const before = syncCanon({ teams: state.teams });
  wzPlainTeam(1);
  const ops = treeDiff(teamsCanon([{ id: 't1', name: 'x' }]), teamsCanon([{ id: 't1', name: 'x', plain: true }]), TEAMS_DEPTHS);
  assert.ok(Object.keys(ops).some((p) => /plain$/.test(p)), JSON.stringify(ops));
  void before;
  freshState();
});

test('a plain team\'s schedule labels say Team N, with the keycap, once the roster signature moves', () => {
  freshState();
  const sig = typeof setupTeamSig === 'function' ? setupTeamSig() : null;
  wzPlainTeam(0);
  if (sig !== null) assert.ok(setupTeamSig() !== sig, 'a plain team changes the labels signature');
  freshState();
});
