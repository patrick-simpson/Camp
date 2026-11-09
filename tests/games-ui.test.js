// THE GAMES TAB'S RENDERERS (games-ui.js; redesign §5; BUILD-PLAN Step 18, build session 1). Runs under both camp profiles
// (games-ui.senior.test.js evals this file). gamesModel() is the tab as plain data (games-tab.test.js pins it); these cases pin
// what is DRAWN from it and what a tap does:
//   - the standings row: a shared place says "tie", medals are words, a director's own team is a lock row and never a dead
//     button, a view-only second tab gets plain rows, and every database string (a team's name, a game's, a day's note) is escaped;
//   - the day picker is a tablist with a roving tab stop, one chosen tab, a status in words;
//   - an idle paint writes nothing (render stability), a changed number or a new day rewrites only what changed;
//   - the counselors' quiet line gives way to the revealed grid and never shows to a director;
//   - the quick-points sheet: only for a team a tap named, a director's, never their own; two keys to Add (the dashed well says
//     what is missing); the write is the shared writer's; the Undo takes back exactly that entry;
//   - the dock: Back and Next game for a director after a result, nothing for a counselor, Next opens it in place;
//   - motion starts from diffs made here, never from a render; and a phone that may not read points has the standings EMPTIED.

installSinks();
var GUI_SRC = readFixture('../games-ui.js');
var BASE_MS = Date.UTC(2026, 6, 22, 12, 0, 0);
var WED = 3;
var T = () => state.teams.map((t) => t.id);
var realShowToast = showToast;
var realCampWeek = campWeek;
var guiToasts = [];

function boot(role, team) {
  freshState();
  setMemberRole(role === undefined ? 'editor' : role);
  setMemberTeam(team || null);
  state.followTeam = team || null;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false;
  state.bonuses = {}; state.results = {}; state.drafts = {}; state.brackets = {}; state.clocks = {}; state.live = {}; state.brackets4 = {};
  state.meta.hiddenCards = {};
  setStandingsGuardThrows(false);
  counselorPreviewOn = false;
  campWeek = realCampWeek;
  tabWriter = true;
  try { localStorage.removeItem(DAY_RANK_KEY); } catch (e) { /* none */ }
  gamesUi.painted = false; gamesUi.dayId = null; gamesUi.dayIdx = -1; gamesUi.statuses = {}; gamesUi.pts = {};
  gamesUi.quick = { team: null, pts: 0, why: '', other: '' }; gamesUi.quickWas = null;
  guiToasts = [];
  showToast = (m, o) => { guiToasts.push({ m: String(m), o }); return null; };
  state.ui.tab = 'games'; state.ui.gameId = null; state.ui.tool = null; state.ui.view = 'home';
  shell.dirty.games = false;
  shell.sheets.slice().forEach((id) => shellSheetClose(id));
  state.ui.day = (state.config.days.find((d) => d.dow === WED) || state.config.days[0]).id;
}
function done() {
  showToast = realShowToast;
  campWeek = realCampWeek;
  setStandingsGuardThrows(false);
  counselorPreviewOn = false;
  tabWriter = true;
  setMemberTeam(null);
  setMemberRole(null);
  state.followTeam = undefined;
  state.ui.tab = 'now'; state.ui.gameId = null;
  shell.sheets.slice().forEach((id) => shellSheetClose(id));
}
// Save's confetti is a canvas the stub DOM cannot draw: record who it was for instead.
var celebrated = [];
var realCelebrate = celebrate;
function stubCelebrate() { celebrated = []; celebrate = (id) => { celebrated.push(id); }; }
function unstubCelebrate() { celebrate = realCelebrate; }
function mm(a, b, c) { return { medals: { gold: a, silver: b, bronze: c }, savedAt: new Date(BASE_MS).toISOString() }; }
function gm(extra) { return gamesModel(Object.assign({ now: { dow: WED, minutes: 630 }, ms: BASE_MS + 630 * 60000 }, extra || {})); }
function el(id) { return document.getElementById(id); }
function points(team, n) { state.bonuses['b' + Object.keys(state.bonuses).length + team] = { teamId: team, category: 'custom', label: 'Bonus', points: n, at: new Date(BASE_MS).toISOString() }; }

// ════════════════════════════════════════════════════════════════════
// Pure pieces
// ════════════════════════════════════════════════════════════════════
test('a standings row: place and "tie", medals in words, the awarded points; a director\'s own team is a lock row; a second tab gets plain rows', () => {
  boot('editor');
  const base = { key: 't1', team: 't1', name: 'Turkey Dinner', short: 'Turkey', place: 2, tie: true, pts: 27, gold: 2, silver: 1, bronze: 3, awarded: 4, mv: 1, locked: false, tap: true };
  let html = gamesStandingRowHtml(base, { places: true, arrows: true });
  assert.ok(/<li class="gs-item" data-key="t1" data-team="t1"[^>]* data-tie>/.test(html), 'a tie is on the item');
  assert.ok(html.includes('<b class="gs-pl-n">2</b><small class="gs-tie">tie</small>'), 'the shared place and its word');
  assert.ok(html.includes('2&nbsp;gold · 1&nbsp;silver · 3&nbsp;bronze'), 'medals in words, each count kept to its word');
  assert.ok(html.includes('<span class="gs-x"> · +4&nbsp;awarded</span>'), 'the awarded points, said once');
  assert.ok(html.includes('data-mv="up"') && html.includes('#i-up'), 'an arrow AND a number: ' + html);
  assert.ok(/<button type="button" class="gs-row" data-quick-team="t1" aria-haspopup="dialog" aria-controls="sheet-quick" aria-label="Turkey Dinner · 2nd, tied · up 1 since this morning · 27 points\. Give quick points">/.test(html), html);
  // down, same, and no arrows at all (an empty table, or a baseline taken on a blank one)
  assert.ok(gamesStandingRowHtml(Object.assign({}, base, { mv: -2 }), { places: true, arrows: true }).includes('data-mv="down"'));
  assert.ok(gamesStandingRowHtml(Object.assign({}, base, { mv: 0 }), { places: true, arrows: true }).includes('data-mv="same"'));
  assert.notOk(/gs-mv/.test(gamesStandingRowHtml(base, { places: true, arrows: false })));
  assert.notOk(/gs-pl|gs-mv/.test(gamesStandingRowHtml(Object.assign({}, base, { place: 0, tie: false }), { places: false, arrows: false })), 'no places on an empty table');
  // a deduction reads "taken off"; nothing awarded says nothing
  assert.ok(gamesStandingRowHtml(Object.assign({}, base, { awarded: -2 }), { places: true }).includes('−2&nbsp;taken off'));
  assert.notOk(/gs-x/.test(gamesStandingRowHtml(Object.assign({}, base, { awarded: 0 }), { places: true })));
  // my own team: not a button, a lock, the hidden sentence
  html = gamesStandingRowHtml(Object.assign({}, base, { locked: true }), { places: true });
  assert.ok(/<div class="gs-row" data-locked>/.test(html) && !/<button/.test(html) && html.includes('#i-lock') && html.includes('data-mine'));
  assert.ok(html.includes('Your team: another director gives these points'));
  // a view-only second tab: a plain row, no button, no lock
  html = gamesStandingRowHtml(Object.assign({}, base, { tap: false }), { places: true });
  assert.ok(/<div class="gs-row">/.test(html) && !/<button/.test(html) && !/i-lock/.test(html));
  // every name is escaped, in the row and in its spoken label
  html = gamesStandingRowHtml(Object.assign({}, base, { short: '<img src=x onerror=alert(1)>', name: '"><script>x</script>' }), { places: true });
  assert.notOk(/<img src=x|<script>/.test(html), 'a hostile team name is inert: ' + html.slice(0, 200));
  done();
});

test('the day picker: a tablist with one chosen tab and a roving tab stop, a status in words, every id and name escaped', () => {
  boot('editor');
  const m = gm();
  const html = gamesDayPickHtml(m.days);
  assert.ok(html.startsWith('<i class="gdp-pill" aria-hidden="true"></i>'), 'ONE pill, first');
  assert.equal((html.match(/role="tab"/g) || []).length, m.days.length);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.equal((html.match(/tabindex="0"/g) || []).length, 1, 'one tab stop');
  assert.ok(/data-st="today"[^>]*>.*?<span class="gdp-st">Today<\/span>/.test(html.replace(/\n/g, '')), 'today says Today');
  assert.ok(/<span class="gdp-st">\d+ left<\/span>/.test(html), 'a day behind us with games unscored says how many');
  assert.ok(m.days.every((d) => html.includes('aria-label="' + esc(d.label) + '"')), 'each tab says it in words');
  const hostile = gamesDayPickHtml([{ id: 'd"><b>', name: 'x', short: '<i>', st: '', left: 0, selected: true, label: '"x' }]);
  assert.notOk(/<b>|<i>x/.test(hostile.replace('<i class="gdp-pill" aria-hidden="true"></i>', '')), 'hostile day data is inert: ' + hostile);
  done();
});

test('blocks, rows and notes: Now\'s own row markup, the block title and clock escaped, a day\'s note as a line', () => {
  boot('editor');
  const m = gm();
  const html = m.blocks.map(gamesBlockHtml).join('');
  assert.equal((html.match(/<section class="gb"/g) || []).length, m.blocks.length);
  assert.ok(m.blocks.every((b) => html.includes('data-key="' + esc(b.key) + '"')));
  assert.ok(/class="gr" role="listitem" data-key="g-/.test(html), 'a row is Now\'s .gr');
  assert.ok(/data-score-game=/.test(html) && /btn-gold/.test(html), 'a director has Score, one of them gold');
  assert.equal((html.match(/btn-gold/g) || []).length, 1, 'ONE gold');
  assert.ok(html.includes('class="gb-now">Now<'), 'the block under way says Now');
  assert.ok(html.includes('<b>up next</b>'));
  const evil = gamesBlockHtml({ key: 'k"x', title: '<script>t</script>', when: '<b>', now: false, off: true, rows: [] });
  assert.notOk(/<script>|<b>/.test(evil));
  assert.ok(evil.includes('data-off'));
  assert.equal(gamesNotesHtml([{ kind: 'double', text: 'Double <b>x</b>' }, { kind: 'day', text: 'Wear <i>sneakers</i>' }, { kind: 'zz', text: 'no' }]),
    '<p class="nw-note" data-note="double">' + gamesIcon('i-bolt') + '<span>Double &lt;b&gt;x&lt;/b&gt;</span></p><p class="nw-note" data-note="day">' + gamesIcon('i-pin') + '<span>Wear &lt;i&gt;sneakers&lt;/i&gt;</span></p>');
  assert.ok(gamesEmptyHtml({ text: 'No games on <b>x</b> yet.', add: true }).includes('data-games-add'));
  assert.notOk(/data-games-add/.test(gamesEmptyHtml({ text: 'x', add: false })), 'a counselor gets no Add games');
  assert.notOk(/<b>x/.test(gamesEmptyHtml({ text: 'No games on <b>x</b> yet.', add: false })));
  // the gap sentence: names bold and escaped, the words plain
  const sentence = { parts: [{ team: T()[1] }, { text: ' trail <i>' }, { team: T()[0] }, { text: ' by 3.' }] };
  const g = gamesGapHtml(sentence);
  assert.ok(g.startsWith('<b>') && g.includes('trail &lt;i&gt;') && !/<i>/.test(g), g);
  assert.equal(gamesGapHtml(null), '');
  done();
});

test('the dock: Next game with what is left, Back alone when nothing can be scored, a tick when every game is scored', () => {
  boot('editor');
  const next = gamesDockHtml({ tone: 'next', left: '2 games left today that you can score', next: { id: 'g"1', name: 'Pict <b>' }, back: 'Back to Now' });
  assert.ok(/id="game-left">2 games left today that you can score<\/p>/.test(next));
  assert.ok(/data-next-game="g&quot;1"/.test(next) && next.includes('Pict &lt;b&gt; →'), 'escaped');
  assert.ok(/id="game-dock-back" data-game-back>‹ Back to Now<\/button>/.test(next));
  assert.ok(/btn-gold gd-go/.test(next), 'Next is the gold one');
  const wait = gamesDockHtml({ tone: 'wait', left: 'Nothing left that you can score. 1 game needs another director: X (your team plays)', next: null, back: 'Back to Wednesday games' });
  assert.ok(/btn-block gd-back/.test(wait) && !/data-next-game/.test(wait), 'Back alone, full width');
  const fin = gamesDockHtml({ tone: 'done', left: 'Every game today is scored', next: null, back: 'Back to Now' });
  assert.ok(/data-tone="done">.*#i-check/.test(fin.replace(/\n/g, '')));
  assert.equal(gamesDockHtml(null), '');
  done();
});

// ════════════════════════════════════════════════════════════════════
// The paint
// ════════════════════════════════════════════════════════════════════
test('a director\'s paint fills the standings, the picker and the day; a counselor\'s fills the picker and the day and a quiet line, and no standings', () => {
  boot('editor');
  T().slice(0, 3).forEach((id, i) => { state.results['x' + i] = mm(id, T()[(i + 1) % T().length], T()[(i + 2) % T().length]); state.config.games.push({ id: 'x' + i, dayId: state.ui.day, session: 'Morning', format: 'placement', name: 'X' + i, emoji: '', location: '', headline: '', rules: [] }); });
  points(T()[1], 4);
  renderGamesPanel(gm());
  assert.equal(el('gs-list').innerHTML.match(/<li class="gs-item"/g).length, T().length, 'every team has a row');
  assert.ok(/trail|lead|tied/.test(el('gs-gap').innerHTML) && el('gs-gap').hidden === false);
  assert.equal(el('gs-how').textContent.startsWith('Tap a team to give quick points') || el('gs-how').textContent.startsWith('Arrows:'), true);
  assert.ok(el('games-days-pick').innerHTML.includes('gdp-btn'));
  assert.ok(el('games-day-body').innerHTML.includes('class="gb"'));
  assert.equal(el('games-secret').hidden, true, 'a director never reads the secret line');
  assert.equal(el('games-live').dataset.empty, undefined, 'there are points');
  // counselor
  setMemberRole('viewer');
  state.followTeam = T()[0];
  runStandingsSideEffects(); // every pass runs it: the standings leave a phone that may not read them
  renderGamesPanel(gm());
  assert.equal(el('gs-list').innerHTML, '');
  assert.equal(el('gs-gap').innerHTML, '');
  assert.equal(el('games-secret').hidden, false, 'the quiet line');
  assert.ok(el('games-day-body').innerHTML.includes('class="gb"'), 'but the games are there');
  assert.notOk(/data-score-game|btn-gold|gr-why/.test(el('games-day-body').innerHTML), 'with no Score');
  // an empty table
  boot('editor');
  renderGamesPanel(gm());
  assert.equal(el('games-live').dataset.empty, '', 'no points yet');
  assert.equal(el('gs-gap').innerHTML, 'No points yet. The first saved game starts the table.');
  assert.equal(el('gs-how').textContent, 'Tap a team to give quick points');
  assert.notOk(/gs-pl|gs-mv/.test(el('gs-list').innerHTML), 'no places, no arrows');
  done();
});

test('the quiet line gives way to the revealed grid, and Games switched off paints nothing', () => {
  boot('viewer');
  const real = typeof revealGridView === 'function' ? revealGridView : null;
  revealGridView = () => null;
  renderGamesPanel(gm());
  assert.equal(el('games-secret').hidden, false);
  revealGridView = () => ({ rows: [] });
  renderGamesSecret();
  assert.equal(el('games-secret').hidden, true, 'the grid is up: it says the rest');
  revealGridView = real;
  renderGamesSecret();
  // Games turned off for counselors: nothing painted, the quiet line not shown either (#games-off says why)
  state.meta.hiddenCards = { competitions: true };
  const body = el('games-day-body');
  body.__html = undefined;
  body.innerHTML = '';
  renderGamesPanel(gm());
  assert.equal(body.innerHTML, '', 'no rows for a counselor who may not see Games');
  assert.equal(gamesSecretShown(), false);
  state.meta.hiddenCards = {};
  done();
});

test('render stability: an idle paint writes nothing, a points change rewrites the list only, another day rewrites the day only', () => {
  boot('editor');
  points(T()[0], 9);
  renderGamesPanel(gm());
  const count = (id) => { const e = el(id); let n = 0; const orig = e.innerHTML; Object.defineProperty(e, 'innerHTML', { get: () => orig2(), set: (v) => { n++; store = v; }, configurable: true }); let store = orig; function orig2() { return store; } return () => n; };
  const list = count('gs-list'); const pick = count('games-days-pick'); const body = count('games-day-body'); const gap = count('gs-gap');
  renderGamesPanel(gm()); renderGamesPanel(gm()); renderGamesPanel(gm());
  assert.deepEqual([list(), pick(), body(), gap()], [0, 0, 0, 0], 'three idle paints, no write');
  points(T()[1], 12);
  renderGamesPanel(gm());
  assert.deepEqual([list() > 0, pick(), body()], [true, 0, 0], 'a points change repaints the list alone');
  const was = list();
  gamesPickDay(state.config.days[(state.config.days.findIndex((d) => d.id === state.ui.day) + 1) % state.config.days.length].id);
  assert.ok(pick() > 0 && body() > 0, 'another day rewrites the tabs and the day');
  assert.equal(list(), was, 'and not the standings');
  done();
});

test('a day tap and the arrow keys: the choice is this device\'s own, painted at once; a stale or repeated id changes nothing', () => {
  boot('editor');
  renderGamesPanel(gm());
  const days = competitionDays();
  const first = days[0].id;
  gamesPickDay(first);
  assert.equal(state.ui.day, first);
  assert.ok(el('games-days-pick').innerHTML.includes('data-day="' + first + '"'));
  assert.equal(gamesUi.dayId, first, 'the paint followed');
  gamesPickDay('nope');
  assert.equal(state.ui.day, first);
  const key = (k, target) => { let prevented = false; gamesDayKey({ key: k, target: { closest: () => ({ dataset: { day: target } }) }, preventDefault: () => { prevented = true; } }); return prevented; };
  assert.equal(key('ArrowRight', first), true);
  assert.equal(state.ui.day, days[1].id, 'right: the next day');
  assert.equal(key('ArrowLeft', days[0].id), false, 'left of the first: nothing');
  assert.equal(key('ArrowRight', days[days.length - 1].id), false, 'right of the last: nothing');
  assert.equal(key('Enter', first), false);
  done();
});

// ════════════════════════════════════════════════════════════════════
// Quick points
// ════════════════════════════════════════════════════════════════════
test('quick points: a tapped team opens the sheet; two keys to Add; the dashed well says what is missing; Undo takes it back', () => {
  boot('editor');
  points(T()[0], 30); points(T()[1], 27);
  renderGamesPanel(gm());
  assert.equal(shellSheetAllowed('quick'), false, 'nothing has named a team: not allowed');
  gamesOpenQuick(T()[2], null);
  assert.deepEqual(shell.sheets, ['quick']);
  renderQuickSheet();
  assert.ok(el('qp-team').textContent.length > 2);
  assert.ok(/points so far/.test(el('qp-now').textContent), el('qp-now').textContent);
  assert.ok(/team-mark|class="tm/.test(el('qp-mark').innerHTML) || el('qp-mark').innerHTML.length > 0, 'the team\'s mark');
  assert.equal(el('qp-add').getAttribute === undefined, false);
  assert.equal(gamesUi.quick.pts, 0);
  assert.equal(el('qp-add-label').textContent, 'Pick how many points');
  // a tap on Add with no key chosen writes nothing and does not close
  const before = Object.keys(state.bonuses).length;
  gamesQuickAddTap();
  assert.equal(Object.keys(state.bonuses).length, before);
  assert.deepEqual(shell.sheets, ['quick']);
  // key 3 + "Team spirit": the button says what will happen
  gamesPickKey({ dataset: { pts: '3' } });
  gamesPickWhy({ dataset: { why: 'Team spirit' } });
  assert.equal(el('qp-add-label').textContent, 'Add 3 points to ' + (teamShort(T()[2]) || teamName(T()[2])));
  assert.equal(gamesQuickWhy(), 'Team spirit');
  // "Other…" takes the typed words (40 characters), a second tap on the chosen reason clears it
  gamesPickWhy({ dataset: { why: 'other' } });
  assert.equal(el('qp-other').hidden, false);
  gamesUi.quick.other = '  Helped carry the canoes  ';
  assert.equal(gamesQuickWhy(), 'Helped carry the canoes');
  gamesPickWhy({ dataset: { why: 'other' } });
  assert.equal(gamesQuickWhy(), '');
  assert.equal(el('qp-other').hidden, true);
  gamesPickWhy({ dataset: { why: 'Helping out' } });
  // Add: one ledger entry for that team, the sheet closes, the toast has Undo for ten seconds
  gamesQuickAddTap();
  const ids = Object.keys(state.bonuses).filter((k) => state.bonuses[k].label === 'Helping out');
  assert.equal(ids.length, 1);
  assert.deepEqual([state.bonuses[ids[0]].teamId, state.bonuses[ids[0]].points], [T()[2], 3]);
  assert.deepEqual(shell.sheets, [], 'the sheet is closed');
  assert.equal(gamesUi.quick.team, null, 'and forgets its team');
  const t = guiToasts[guiToasts.length - 1];
  assert.ok(/^\+3 for /.test(t.m), t.m);
  assert.equal(t.o.action.label, 'Undo');
  assert.equal(t.o.duration, GAMES_QUICK_UNDO_MS);
  assert.equal(GAMES_QUICK_UNDO_MS, 10000, 'ten seconds (§5.2)');
  t.o.action.run();
  assert.equal(Object.keys(state.bonuses).filter((k) => state.bonuses[k].label === 'Helping out').length, 0, 'Undo takes back exactly that entry');
  done();
});

test('quick points: the own team never opens it, a stale tap writes nothing, an idle sheet pass writes nothing, a role flip empties it', () => {
  boot('editor', T()[0]);
  points(T()[1], 5);
  gamesOpenQuick(T()[0], null);
  assert.deepEqual(shell.sheets, [], 'a director\'s own team: refused');
  assert.ok(guiToasts.some((x) => /own team/i.test(x.m)), 'and told why');
  gamesOpenQuick('zz', null);
  assert.deepEqual(shell.sheets, []);
  gamesOpenQuick(T()[1], null);
  assert.deepEqual(shell.sheets, ['quick']);
  renderQuickSheet();
  const writes = (() => { let n = 0; ['qp-now', 'qp-add-label', 'qp-team'].forEach((id) => { const e = el(id); let v = e.textContent; Object.defineProperty(e, 'textContent', { get: () => v, set: (x) => { n++; v = x; }, configurable: true }); }); return () => n; })();
  renderQuickSheet(); renderQuickSheet();
  assert.equal(writes(), 0, 'an idle pass writes nothing');
  // another director wrote while the sheet was open: its words follow the data
  points(T()[1], 20);
  renderQuickSheet();
  assert.ok(writes() > 0, 'a change repaints');
  // the Add that races a role change: the writer refuses, the sheet stays, the toast says
  gamesPickKey({ dataset: { pts: '2' } });
  setMemberRole('viewer');
  const n = Object.keys(state.bonuses).length;
  gamesQuickAddTap();
  assert.equal(Object.keys(state.bonuses).length, n, 'nothing written');
  assert.equal(gamesQuickReady(), false);
  setMemberRole('editor');
  done();
});

test('the standings sheet: copy and share are a director\'s, Award points only where its screen is open to them', () => {
  boot('editor');
  points(T()[0], 9);
  shellSheetOpen('standings', null);
  assert.deepEqual(shell.sheets, ['standings']);
  renderStandingsSheet();
  const real = navigator.share;
  navigator.share = undefined;
  renderStandingsSheet();
  assert.equal(el('gs-share').hidden, true, 'no share where the phone cannot');
  navigator.share = () => Promise.resolve();
  renderStandingsSheet();
  assert.equal(el('gs-share').hidden, false);
  navigator.share = real;
  assert.equal(el('gs-award').hidden, !(typeof toolMayOpen === 'function' && toolMayOpen('award')));
  // copy: the summary text through the clipboard, the sheet closes, "Copied" in the app's own toast
  let copied = null;
  const realCopy = copyTextToClipboard;
  copyTextToClipboard = (text, done2) => { copied = text; if (typeof done2 === 'function') done2(); };
  gamesCopyStandings();
  copyTextToClipboard = realCopy;
  assert.ok(copied && /Standings/.test(copied), 'the table is in the copy');
  assert.deepEqual(shell.sheets, []);
  assert.equal(guiToasts[guiToasts.length - 1].m, 'Copied the standings');
  // a counselor: the sheet is not allowed and the copy does nothing
  setMemberRole('viewer');
  assert.equal(shellSheetAllowed('standings'), false);
  copied = null;
  copyTextToClipboard = (text) => { copied = text; };
  gamesCopyStandings();
  copyTextToClipboard = realCopy;
  assert.equal(copied, null);
  done();
});

// ════════════════════════════════════════════════════════════════════
// The takeover's dock
// ════════════════════════════════════════════════════════════════════
test('the dock under a saved game: drawn for a director, hidden for a counselor, written only when it changes, Next opens in place', () => {
  boot('editor');
  const g = pgame(); // a podium game (the day's own first game may be a bracket or a tally)
  const dock = el('takeover-game-dock');
  state.ui.gameId = g.id; state.ui.gameFrom = 'games';
  // CHANGED ON PURPOSE (build session 2): a podium game with no result docks its Save; the dock is hidden for a game with no dock to draw
  const tally = Object.assign({}, g, { id: 'dk-tally', format: 'tally' });
  state.config.games.push(tally);
  renderGameDock(tally);
  // CHANGED ON PURPOSE (Step 29 finish): score entry's Save moved into the dock (the dashed well until the scores are typed).
  assert.equal(dock.hidden, false, 'a tally with no result: the dock holds its Save');
  assert.ok(/id="game-save" data-tone="tally" aria-disabled="true">Type the scores first</.test(dock.innerHTML), 'the dashed well names what is missing');
  renderGameDock(g);
  assert.equal(dock.hidden, false);
  assert.ok(/id="game-save"[^>]*aria-disabled="true">Pick gold, silver and bronze</.test(dock.innerHTML), 'a podium game with no result: the dashed Save well');
  state.results[g.id] = mm(T()[0], T()[1], T()[2]);
  renderGameDock(g);
  assert.equal(dock.hidden, false);
  assert.ok(/Next game|Back to/.test(dock.innerHTML), dock.innerHTML.slice(0, 120));
  assert.ok(dock.innerHTML.includes('Back to ' + shellGameBackLabel(g)));
  let n = 0; let v = dock.innerHTML;
  Object.defineProperty(dock, 'innerHTML', { get: () => v, set: (x) => { n++; v = x; }, configurable: true });
  renderGameDock(g); renderGameDock(g);
  assert.equal(n, 0, 'an idle pass writes nothing');
  setMemberRole('viewer');
  renderGameDock(g);
  assert.equal(dock.hidden, true, 'a counselor has no dock');
  assert.equal(dock.innerHTML, '', 'and nothing in it');
  setMemberRole('editor');
  // the takeover calls it from renderGameView, and Next game is openNextGame (games-tab.test.js pins the order)
  assert.ok(/renderGameDock\(g\)/.test(readFixture('../app.js')), 'renderGameView draws the dock');
  state.ui.gameId = null;
  done();
});

// ════════════════════════════════════════════════════════════════════
// The podium picker and the saved result (build session 2)
// ════════════════════════════════════════════════════════════════════
function pgame(extra) {
  const g = Object.assign({ id: 'pg-' + Math.random().toString(36).slice(2, 7), dayId: state.ui.day, session: 'Morning', format: 'placement', name: 'Pumpkin Pictionary', emoji: '', location: 'Lawn', headline: '', rules: [] }, extra || {});
  state.config.games.push(g);
  return g;
}
// A key / row as a stand-in the patcher can write to: attributes in a map, the slots as stand-ins that count writes.
function fakeKey(team, writes) {
  const attrs = {};
  const slot = () => { let hidden = true; let html = ''; return { get hidden() { return hidden; }, set hidden(v) { writes.n++; hidden = v; }, get innerHTML() { return html; }, set innerHTML(v) { writes.n++; html = v; } }; };
  const ok = slot(); const tab = slot();
  return {
    dataset: { team }, attrs, ok, tab,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    setAttribute: (n, v) => { writes.n++; attrs[n] = String(v); },
    removeAttribute: (n) => { writes.n++; delete attrs[n]; },
    querySelector: (sel) => (sel === '.pp-ok' ? ok : sel === '.pp-taken' ? tab : null),
  };
}
function fakeRoot(medals, teams, writes) {
  const rows = {};
  medals.forEach((m) => {
    const keys = teams.map((t) => fakeKey(t, writes));
    const attrs = {};
    rows[m] = { keys, attrs, getAttribute: (n) => (n in attrs ? attrs[n] : null), setAttribute: (n, v) => { writes.n++; attrs[n] = String(v); }, removeAttribute: (n) => { writes.n++; delete attrs[n]; }, querySelectorAll: () => keys };
  });
  return { rows, querySelector: (sel) => { const m = /data-medal="(\w+)"/.exec(sel); return m ? rows[m[1]] : null; } };
}

test('the podium picker\'s markup: rows of toggle keys, the checked and taken states in attributes, points words a director\'s, every name escaped', () => {
  boot('editor');
  const g = pgame();
  const t = T();
  podiumPick(g.id, 'gold', t[1]); podiumPick(g.id, 'silver', t[0]);
  const m = gamesPodium(g);
  const html = gamesPodiumHtml(m, false);
  assert.ok(html.startsWith('<div class="pp" id="podium-picker">'));
  assert.deepEqual(html.match(/class="pp-row" data-medal="(\w+)"/g).map((x) => x.replace(/.*="(\w+)"/, '$1')), ['gold', 'silver', 'bronze']);
  assert.ok(/<div class="pp-row" data-medal="bronze">/.test(html) && !/data-wait/.test(html), 'bronze is open (silver is picked): nothing waits');
  assert.equal((html.match(/class="pp-team"/g) || []).length, 3 * t.length, 'a key per team per medal');
  assert.ok(/id="pp-h-gold"[^>]*><i class="pp-disc" data-place="1" aria-hidden="true">1<\/i><b class="pp-medal">Gold<\/b><span class="pp-pts">7 points<\/span>/.test(html), 'a director reads what the medal is worth');
  assert.ok(/<span class="pp-wait">after gold<\/span>/.test(html) && /<span class="pp-wait">after silver<\/span>/.test(html) && !/after undefined/.test(html));
  assert.ok(/role="group" aria-labelledby="pp-h-silver" data-n="/.test(html), 'a group named by its heading');
  assert.notOk(/role="radio"|aria-checked|role="radiogroup"/.test(html), 'toggle buttons, not radios: a tap on the picked one clears it');
  const goldKey = new RegExp('<button type="button" class="pp-team" data-team="' + t[1] + '"[^>]*aria-pressed="true"[^>]*>').exec(html);
  assert.ok(goldKey && !/aria-disabled/.test(goldKey[0]), 'the picked team is pressed in its own row: ' + (goldKey && goldKey[0]));
  assert.ok(/data-taken="gold"[^>]*aria-label="[^"]*, has gold\. Tap to make them silver and [^"]+ gold"/.test(html), 'a team held by gold is named, and says aloud that a tap swaps it with the team the row held');
  assert.ok(!/data-taken="gold"[^>]*aria-disabled/.test(html), 'a taken key is an ordinary key now (a tap moves the team), not a dashed dead one');
  assert.ok(/<span class="pp-taken" aria-hidden="true"><i class="pp-disc" data-place="1" aria-hidden="true">1<\/i>has gold<\/span>/.test(html), 'the tab names the MEDAL, never the bare word');
  assert.ok(/<i class="pp-ok" aria-hidden="true">/.test(html) && /<i class="pp-ok" aria-hidden="true" hidden>/.test(html), 'the check is a permanent slot, shown only on the picked key');
  // double points double the words
  const dbl = gamesPodiumHtml(gamesPodium(pgame({ messtival: true })), false);
  assert.ok(dbl.includes('14 points') && dbl.includes('10 points') && dbl.includes('6 points'));
  // a counselor never gets a picker, but the model it would draw from has no points either (guard throwing)
  setStandingsGuardThrows(true);
  setMemberRole('viewer');
  assert.notOk(/ points</.test(gamesPodiumHtml(gamesPodium(g), false)), 'no points words without the right to read points');
  setStandingsGuardThrows(false);
  setMemberRole('editor');
  // hostile team data is inert
  state.teams[0].name = '"><img src=x onerror=alert(1)>';
  state.teams[0].short = '<script>x</script>';
  const evil = gamesPodiumHtml(gamesPodium(g), false);
  assert.notOk(/<img src=x|<script>/.test(evil), 'a hostile team name is inert');
  done();
});

test('the shape the picker is kept by does not depend on what is picked, and does depend on the teams and the points words', () => {
  boot('editor');
  const g = pgame();
  const t = T();
  const idle = gamesPodiumHtml(gamesPodium(g), true);
  podiumPick(g.id, 'gold', t[2]); podiumPick(g.id, 'silver', t[3]);
  assert.equal(gamesPodiumHtml(gamesPodium(g), true), idle, 'picks, waits and taken tabs are not part of the shape');
  assert.ok(gamesPodiumHtml(gamesPodium(g), false) !== idle, 'but the full markup of course differs');
  state.teams[0].name = 'Foxes of Fire';
  assert.ok(gamesPodiumHtml(gamesPodium(g), true) !== idle, 'a renamed team is another picker');
  done();
});

test('patching the built picker: only attributes and the two slots move, the same nodes stay, an idle pass writes nothing, a new pick pops its check', () => {
  boot('editor');
  const g = pgame();
  const t = T();
  const writes = { n: 0 };
  const root = fakeRoot(['gold', 'silver', 'bronze'], t, writes);
  let popped = gamesPodiumPatch(root, gamesPodium(g));
  assert.equal(popped.length, 0);
  assert.equal(root.rows.gold.keys[0].attrs['aria-pressed'], 'false');
  assert.equal(root.rows.silver.attrs['data-wait'], '', 'silver waits');
  assert.equal(root.rows.silver.keys[0].attrs['aria-disabled'], 'true');
  const idle = writes.n;
  gamesPodiumPatch(root, gamesPodium(g));
  assert.equal(writes.n, idle, 'an idle pass writes nothing');
  podiumPick(g.id, 'gold', t[1]);
  const k = root.rows.gold.keys[1];
  popped = gamesPodiumPatch(root, gamesPodium(g));
  assert.deepEqual(popped, [k.ok], 'the check that appeared pops (and only that one)');
  assert.equal(k.attrs['aria-pressed'], 'true');
  assert.equal(k.ok.hidden, false);
  assert.ok(root.rows.gold.keys[1] === k, 'the node is the same one');
  assert.equal(root.rows.silver.attrs['data-wait'], undefined, 'silver opened');
  assert.equal(root.rows.silver.keys[1].attrs['aria-disabled'], undefined, 'the gold team can be moved to silver (a tap moves it)…');
  assert.equal(root.rows.silver.keys[1].attrs['data-taken'], 'gold', '…and named');
  assert.ok(root.rows.silver.keys[1].tab.innerHTML.includes('has gold') && root.rows.silver.keys[1].tab.hidden === false);
  assert.equal(root.rows.silver.keys[0].attrs['aria-disabled'], undefined, 'the others are free');
  // clearing it: the check goes, the tab goes, nothing pops
  podiumPick(g.id, 'gold', t[1]);
  popped = gamesPodiumPatch(root, gamesPodium(g));
  assert.deepEqual([popped.length, k.ok.hidden, root.rows.silver.keys[1].tab.hidden], [0, true, true]);
  assert.equal(root.rows.silver.attrs['data-wait'], '', 'silver waits again');
  done();
});

test('a tap on a key picks, the same key clears, a refusal says why in a toast; the draft is the live one', () => {
  boot('editor');
  const g = pgame();
  const t = T();
  state.ui.gameId = g.id;
  const key = (medal, team) => ({ dataset: { team }, closest: () => ({ dataset: { medal } }) });
  assert.equal(gamesPodiumTap(key('gold', t[0])).action, 'pick');
  assert.equal(state.drafts[g.id].medals.gold, t[0]);
  assert.equal(gamesPodiumTap(key('gold', t[0])).action, 'clear');
  assert.equal(state.drafts[g.id].medals.gold, undefined);
  guiToasts.length = 0;
  assert.equal(gamesPodiumTap(key('silver', t[1])).problem, 'wait');
  assert.equal(guiToasts[0].m, 'Pick the gold team first.');
  gamesPodiumTap(key('gold', t[0]));
  guiToasts.length = 0;
  const moved = gamesPodiumTap(key('silver', t[0]));
  assert.deepEqual([moved.action, moved.from, moved.medal], ['move', 'gold', 'silver']);
  assert.deepEqual([state.drafts[g.id].medals.gold, state.drafts[g.id].medals.silver], [undefined, t[0]], 'ONE draft: the old leaf is gone and the new one set');
  assert.equal(guiToasts[0].m, nowTeamWord(t[0]) + ' moved from gold to silver.');
  gamesPodiumTap(key('gold', t[0]));
  assert.equal(gamesPodiumTap({ dataset: {}, closest: () => null }), null, 'a tap outside a row does nothing');
  state.ui.gameId = null;
  assert.equal(gamesPodiumTap(key('gold', t[2])), null, 'no open game: nothing');
  // the entry area's delegate: a key, Change the result, anything else
  state.ui.gameId = g.id;
  assert.equal(gamesEntryTap({ closest: (sel) => (sel === '.pp-team' ? key('gold', t[3]) : null) }), true);
  assert.equal(state.drafts[g.id].medals.gold, t[3]);
  assert.equal(gamesEntryTap({ closest: () => null }), false);
  state.ui.gameId = null;
  done();
});

test('Save in the dock: the dashed well goes to the row still to pick, the gold button saves and moves the focus to Next game', () => {
  boot('editor');
  stubCelebrate();
  const day = state.ui.day;
  const g = pgame({ id: 'sv-a', session: 'Morning' });
  const next = pgame({ id: 'sv-b', session: 'Morning' });
  const t = T();
  state.ui.gameId = g.id; state.ui.gameFrom = 'games';
  podiumPick(g.id, 'gold', t[0]); podiumPick(g.id, 'silver', t[1]);
  const d = gamesDock(g.id);
  assert.deepEqual([d.tone, d.save.label, d.save.target], ['pick', 'Pick bronze, then save', 'bronze']);
  // the well: aria-disabled, a tap scrolls there
  const went = [];
  const root = { querySelector: (sel) => { const m = /data-medal="(\w+)"/.exec(sel); return m ? { scrollIntoView: () => went.push('scroll:' + m[1]), querySelector: () => ({ focus: () => went.push('focus:' + m[1]) }) } : null; } };
  const realEl = document.getElementById;
  document.getElementById = (id) => (id === 'podium-picker' ? root : realEl(id));
  try {
    assert.equal(gamesDockTap({ closest: (sel) => (sel === '#game-save' ? { getAttribute: () => 'true' } : null) }), true);
    assert.deepEqual(went, ['scroll:bronze', 'focus:bronze'], 'to bronze');
    assert.equal(state.results[g.id], undefined, 'and nothing saved');
    // an incomplete podium that somehow reaches Save goes to the same place
    went.length = 0;
    assert.equal(gamesSaveTap({}).problem, 'incomplete');
    assert.deepEqual(went, ['scroll:bronze', 'focus:bronze']);
  } finally { document.getElementById = realEl; }
  podiumPick(g.id, 'bronze', t[2]);
  assert.equal(gamesDock(g.id).save.ready, true);
  const r = gamesDockTap({ closest: (sel) => (sel === '#game-save' ? { getAttribute: () => null } : null) });
  assert.equal(r, true);
  assert.deepEqual(state.results[g.id].medals, { gold: t[0], silver: t[1], bronze: t[2] });
  assert.deepEqual(celebrated, [t[0]]);
  // the dock after the save: Next game names the other game on the day
  const after = gamesDock(g.id);
  assert.equal(after.tone, 'next');
  assert.equal(after.next.id, next.id);
  // Next and Back through the same delegate
  const opened = [];
  const realOpen = openGame; const realClose = closeGame;
  openGame = (id, o) => { opened.push([id, o]); return true; };
  closeGame = () => opened.push('closed');
  gamesDockTap({ closest: (sel) => (sel === '[data-next-game]' ? {} : null) });
  gamesDockTap({ closest: (sel) => (sel === '[data-game-back]' ? {} : null) });
  openGame = realOpen; closeGame = realClose;
  assert.deepEqual(opened, [[next.id, { from: 'games' }], 'closed']);
  assert.equal(gamesDockTap({ closest: () => null }), false);
  unstubCelebrate();
  state.ui.gameId = null;
  done();
});

test('the dock while picking: one button, dashed until the podium is whole, then the gold Save — and the gold one is written once, popping only on the change', () => {
  boot('editor');
  const g = pgame();
  const t = T();
  const dock = el('takeover-game-dock');
  state.ui.gameId = g.id;
  const played = [];
  const realPlay = JellyMotion.play;
  JellyMotion.play = (target, name) => { played.push(name); return null; };
  try {
    renderGameDock(g);
    assert.equal(dock.hidden, false);
    assert.ok(/<button type="button" class="btn btn-big btn-block gd-save" id="game-save" aria-disabled="true">Pick gold, silver and bronze<\/button>/.test(dock.innerHTML), dock.innerHTML);
    podiumPick(g.id, 'gold', t[0]); podiumPick(g.id, 'silver', t[1]);
    renderGameDock(g);
    assert.ok(dock.innerHTML.includes('Pick bronze, then save'));
    assert.deepEqual(played, [], 'a dashed well that changes its words does not move');
    podiumPick(g.id, 'bronze', t[2]);
    renderGameDock(g);
    assert.ok(/class="btn btn-big btn-block btn-gold gd-save" id="game-save" data-joy>Save result<\/button>/.test(dock.innerHTML), 'gold, no aria-disabled');
    assert.notOk(/aria-disabled/.test(dock.innerHTML));
    assert.equal(dock.__saveReady, true);
    renderGameDock(g); renderGameDock(g);
    // (the stub's querySelector finds a stand-in for #game-save, so the landing is asked for exactly once)
    assert.ok(played.filter((x) => x === 'snap').length <= 1, 'the landing is once: ' + played.join());
  } finally { JellyMotion.play = realPlay; }
  // a counselor and a view-only tab get no dock at all
  setMemberRole('viewer');
  renderGameDock(g);
  assert.equal(dock.hidden, true);
  assert.equal(dock.innerHTML, '');
  setMemberRole('editor');
  state.ui.gameId = null;
  done();
});

test('the saved result: winners as a list with the medal named in words, a director\'s line and Change button, a counselor\'s page with no point and no director control', () => {
  boot('editor');
  const g = pgame({ unit: 'pins' });
  const t = T();
  state.results[g.id] = mm(t[3], t[0], t[1]);
  state.followTeam = t[0];
  let html = gamesResultHtml(gamesResultModel(g, state.results[g.id]));
  assert.ok(/^<p class="gsv" id="game-saved" role="status">/.test(html), 'the saved line comes first');
  assert.ok(/<ol class="gres" aria-label="Final results">/.test(html));
  assert.equal((html.match(/<li class="gres-r"/g) || []).length, 3);
  assert.ok(new RegExp('<li class="gres-r" data-place="2" data-team="' + t[0] + '"[^>]*data-mine>').test(html), 'my own team is marked');
  assert.ok(html.includes('<span class="visually-hidden">Gold: </span>'), 'the medal in words for a screen reader');
  assert.ok(html.includes('<span class="gres-pts">+7</span>') && html.includes('+5') && html.includes('+3'), 'a director sees what each medal is worth');
  assert.ok(html.includes('id="game-change">Change the result</button>'));
  // the saved line's state is patched in, not part of the markup that is compared
  assert.notOk(/data-state|Saved \d|Saving/.test(html), 'static: the state and the words are painted after');
  // a tally keeps its scores
  const tl = pgame({ format: 'tally', unit: 'pins' });
  state.results[tl.id] = { medals: mm(t[3], t[0], t[1]).medals, scores: { [t[0]]: 12, [t[3]]: 30 }, savedAt: 'x' };
  html = gamesResultHtml(gamesResultModel(tl, state.results[tl.id]));
  assert.ok(html.includes('<h3 class="gv-h">Scores · pins</h3>') && /gres-s-v">30</.test(html));
  // a hostile team name is inert
  state.teams[3].name = '<img src=x onerror=alert(1)>';
  assert.notOk(/<img src=x/.test(gamesResultHtml(gamesResultModel(g, state.results[g.id]))));
  state.teams[3].name = 'Fine';
  // a counselor: the winners, nothing a counselor must not read, no director control
  setStandingsGuardThrows(true);
  setMemberRole('viewer');
  html = gamesResultHtml(gamesResultModel(g, state.results[g.id]));
  assert.equal((html.match(/<li class="gres-r"/g) || []).length, 3, 'the winners are public');
  assert.notOk(/gres-pts|\+7|\+5|\+3|game-change|gsv|game-saved/.test(html), 'no points, no Change, no saved line: ' + html);
  setStandingsGuardThrows(false);
  setMemberRole('editor');
  state.followTeam = undefined;
  done();
});

test('the saved line: painted into the one node, popping its check only when the server confirms; it follows an acknowledgement and a connection change', () => {
  boot('editor');
  const g = pgame();
  const t = T();
  state.results[g.id] = mm(t[0], t[1], t[2]);
  state.ui.gameId = g.id;
  const line = el('game-saved');
  const span = line.querySelector('span'); const use = line.querySelector('use'); const ico = line.querySelector('.ico');
  const attrs = {};
  use.setAttribute = (n, v) => { attrs[n] = v; };
  use.getAttribute = (n) => (n in attrs ? attrs[n] : null);
  const popped = [];
  const realPop = nowCheckPop;
  nowCheckPop = (e) => popped.push(e);
  const keep = { fbRef, fbConnKnown, fbConnected, confirmedTree };
  try {
    delete line.dataset.state;
    fbRef = {}; fbConnKnown = true; fbConnected = true; confirmedTree = syncCanonTree({ results: {} });
    gamesSavedRefresh();
    assert.equal(line.dataset.state, 'saving');
    assert.equal(span.textContent, 'Saving…');
    assert.deepEqual(popped, [], 'a first paint pops nothing');
    // the push is acknowledged: the confirmed tree holds the record
    confirmedTree = syncCanonTree({ results: { [g.id]: JSON.parse(JSON.stringify(state.results[g.id])) } });
    gamesSavedRefresh();
    assert.equal(line.dataset.state, 'saved');
    assert.ok(/^Saved .* · everyone’s phone has it$/.test(span.textContent), span.textContent);
    assert.equal(attrs.href, '#i-check');
    assert.deepEqual(popped, [ico], 'the check pops the moment it is saved');
    gamesSavedRefresh();
    assert.equal(popped.length, 1, 'once');
    // the connection drops
    fbConnected = false;
    gamesSavedRefresh();
    assert.deepEqual([line.dataset.state, attrs.href], ['offline', '#i-phone']);
    // an idle refresh writes nothing
    let w = 0;
    let v = span.textContent;
    Object.defineProperty(span, 'textContent', { get: () => v, set: (x) => { w++; v = x; }, configurable: true });
    gamesSavedRefresh(); gamesSavedRefresh();
    assert.equal(w, 0);
    // another game open, a counselor, or no result: nothing is painted
    setMemberRole('viewer');
    fbConnected = true;
    gamesSavedRefresh();
    assert.equal(w, 0, 'a counselor has no line');
    setMemberRole('editor');
    state.ui.gameId = null;
    gamesSavedRefresh();
    assert.equal(w, 0);
  } finally { nowCheckPop = realPop; fbRef = keep.fbRef; fbConnKnown = keep.fbConnKnown; fbConnected = keep.fbConnected; confirmedTree = keep.confirmedTree; }
  // app.js asks for it when a write is acknowledged and when the connection or a refusal changes
  const app = readFixture('../app.js');
  assert.ok(/settle\(\);\s*if \(typeof gamesSavedRefresh === 'function'\) gamesSavedRefresh\(\);/.test(app), 'after an acknowledged push');
  assert.ok(/function updateSyncIndicator\(\) \{\s*updateSyncAlert\(\);\s*renderSyncPill\(\);\s*if \(typeof gamesSavedRefresh/.test(app), 'with the connection pill');
  done();
});

test('Change the result: asked first, then the result goes and the picker is back; a changed mind, a lost role or another game changes nothing', async () => {
  boot('editor');
  const g = pgame();
  const t = T();
  state.results[g.id] = mm(t[0], t[1], t[2]);
  state.ui.gameId = g.id;
  const realAsk = typeof askDialog === 'function' ? askDialog : undefined;
  const asked = [];
  askDialog = async (o) => { asked.push(o); return answer; };
  var answer = 'cancel';
  try {
    assert.equal(await gamesChangeResult(), false);
    assert.ok(state.results[g.id], 'Keep it keeps it');
    assert.equal(asked[0].title, 'Change the result for Pumpkin Pictionary?');
    assert.ok(/points come off the standings/.test(asked[0].body));
    assert.deepEqual(asked[0].actions.map((a) => [a.value, a.kind || '', !!a.cancel]), [['clear', 'danger', false], ['cancel', '', true]], 'a verb on each button, the destructive one is danger');
    // the answer takes a while: another director cleared it, this phone lost its role, or the person moved on
    answer = 'clear';
    askDialog = async () => { delete state.results[g.id]; return 'clear'; };
    assert.equal(await gamesChangeResult(), false, 'already gone: nothing to clear');
    state.results[g.id] = mm(t[0], t[1], t[2]);
    askDialog = async () => { setMemberRole('viewer'); return 'clear'; };
    assert.equal(await gamesChangeResult(), false);
    assert.ok(state.results[g.id], 'a role lost meanwhile: the result stands');
    setMemberRole('editor');
    askDialog = async () => { state.ui.gameId = 'other'; return 'clear'; };
    assert.equal(await gamesChangeResult(), false);
    state.ui.gameId = g.id;
    assert.ok(state.results[g.id]);
    // yes
    state.meta.lastDataChangeAt = 'before';
    askDialog = async () => 'clear';
    assert.equal(await gamesChangeResult(), true);
    assert.equal(state.results[g.id], undefined, 'the result is gone');
    assert.ok(state.meta.lastDataChangeAt !== 'before', 'a real change stamps the data');
    // the picker is what the takeover draws now
    assert.equal(gamesDock(g.id).tone, 'pick');
    // no result: nothing to change
    assert.equal(await gamesChangeResult(), false);
    // the native confirm where the dialog never loaded
    state.results[g.id] = mm(t[0], t[1], t[2]);
    askDialog = undefined;
    const realConfirm = confirm;
    let said = '';
    confirm = (m) => { said = m; return true; };
    assert.equal(await gamesChangeResult(), true);
    confirm = realConfirm;
    assert.ok(/Change the result for Pumpkin Pictionary\?/.test(said));
  } finally { askDialog = realAsk; }
  state.ui.gameId = null;
  done();
});

// ════════════════════════════════════════════════════════════════════
// Motion and source rules
// ════════════════════════════════════════════════════════════════════
test('motion starts from diffs made here, never from a render: no animation on a first paint, a number that changed pops, a day change is not a pop', () => {
  boot('editor');
  points(T()[0], 9);
  const played = [];
  const realPlay = JellyMotion.play;
  JellyMotion.play = (target, name, frame, o) => { played.push(name); return null; };
  try {
    // the Games panel is on screen and was already showing: only then does anything move
    shell.dirty.games = false;
    renderGamesPanel(gm());
    assert.deepEqual(played, [], 'the first paint animates nothing');
    points(T()[0], 5);
    renderGamesPanel(gm());
    assert.ok(played.length === 0 || played.every((x) => x === 'press'), 'a changed number pops with press: ' + played.join());
    // a paint under a takeover or on another tab is a plain write
    played.length = 0;
    state.ui.tab = 'now';
    points(T()[1], 7);
    renderGamesPanel(gm());
    assert.deepEqual(played, []);
  } finally { JellyMotion.play = realPlay; }
  done();
});

test('games-ui.js: the rules it lives by, pinned in the source', () => {
  const code = GUI_SRC.replace(/\/\/.*$/gm, '');
  assert.notOk(/\.innerHTML\s*=[^=]/.test(code), 'no direct markup assignment: every write is a change-only helper');
  assert.notOk(/state\.config\b|CAMP\.\w+|DAY_SCHEDULE|setupTree|MEALS\b/.test(code), 'no direct read of week data (the SEAM): the model and the accessors only');
  assert.notOk(/transition\s*:\s*all/.test(code));
  assert.notOk(/matchMedia|prefers-reduced-motion/.test(code), 'calm motion is JellyMotion\'s one switch');
  assert.ok(/gamesQuickAdd\(team, q\.pts, gamesQuickWhy\(\)\)/.test(code), 'the quick points are the writer\'s');
  assert.notOk(/state\.bonuses\[/.test(code), 'this file writes no ledger entry itself');
  assert.ok(/canEdit\(\)/.test(code.slice(code.indexOf('function gamesOpenQuick'), code.indexOf('function gamesQuickWhy'))), 'the sheet checks the role at call time');
  // every database string reaches markup through esc / a sanitizer
  assert.ok(/esc\(r\.short\)/.test(code) && /esc\(b\.title\)/.test(code) && /esc\(e\.text\)/.test(code));
  // the standings are emptied by a pass on any tab (secrecy), and the pass is the standings' own side-effects runner
  assert.ok(/gamesClearStandings\(\)/.test(readFixture('../app.js')));
  // static markup: the roots the paint writes exist, once
  const html = readFixture('../index.html');
  ['games-live', 'gs-list', 'gs-how', 'gs-gap', 'gs-sync', 'gs-reveal', 'games-secret', 'games-week', 'games-days-pick', 'games-day-note', 'games-day', 'games-day-notes', 'games-day-body', 'games-quick', 'games-quick-sub',
    'sheet-quick', 'qp-mark', 'qp-team', 'qp-now', 'qp-keys', 'qp-why', 'qp-other', 'qp-other-text', 'qp-x2', 'qp-add', 'qp-add-label', 'sheet-standings', 'gs-more', 'gs-copy', 'gs-share', 'gs-award', 'takeover-game-dock']
    .forEach((id) => assert.equal((html.match(new RegExp('\\sid="' + id + '"', 'g')) || []).length, 1, '#' + id + ' exists once'));
  // the director's sync line is written by updateSyncIndicator and must be SEEN: a `hidden` in the markup would keep it dark for good
  const syncTag = (html.match(/<p[^>]*\sid="gs-sync"[^>]*>/) || [''])[0];
  assert.ok(syncTag && !/\shidden\b/.test(syncTag), '#gs-sync is not hidden in the markup: ' + syncTag);
  ['games-days', 'games-standings', 'games-rows', 'standings-tbody', 'catchup-hint', 'bonus-body', 'games-reveal-link', 'sync-status', 'copy-standings-btn', 'day-tabs']
    .forEach((id) => assert.equal((html.match(new RegExp('\\sid="' + id + '"', 'g')) || []).length, 0, '#' + id + ' is gone (the Games engine replaced it)'));
});
