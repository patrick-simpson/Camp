// NOW'S RENDERERS (now-ui.js; redesign §3; BUILD-PLAN Step 17, build session 2). Runs under both camp profiles
// (now-ui.senior.test.js evals this file) and, through tests/run.js, against a camp whose schedule is edited here (the seeded
// passes). nowModel() is the picture as plain data (now-model.test.js pins it); these cases pin what is DRAWN from it:
//   - every kind of card paints its title, sub, notes and body from the model, and a counselor's markup carries no key, no
//     Score, no place numeral and no point (the model leaves them out; the renderer must not invent them);
//   - RENDER STABILITY per kind: a second, identical paint writes nothing; a tick between wake-ups writes only the minutes
//     left and the hairline; a block changing over rewrites what changed;
//   - the moment's keys are the SAME writers Award points calls (setCleanupPoints / setVersePoints: one entry per slot, the
//     deterministic id) behind the own-team guard, bounded by the section, and a stale or forged tap writes nothing;
//   - Take down puts the notice back to a draft with the 10-second Undo; Still on this writes only meta/overrun;
//   - the messages strip caps at a third of the screen and the rest ride #sheet-messages; Now's three sheets open only with
//     something to say;
//   - database strings are escaped and an emoji, link or colour that reaches markup passes its sanitizer;
//   - motion starts from diffs made here, never from a render (and a hidden or first paint animates nothing).

installSinks();
var SINKS = __sinkRec;
var INDEX_HTML = readFixture('../index.html');
var UI_SRC = readFixture('../now-ui.js');

var DOWS = [0, 1, 2, 3, 4, 5, 6];
var WED = 3;
var BASE_MS = Date.UTC(2026, 6, 22, 12, 0, 0);
var T = () => state.teams.map((t) => t.id);
var realOnRota = cleanupOnRota;
var realRotaTeams = cleanupTeams;
var realCampWeek = campWeek;
var realShowToast = showToast;
var realCampNow = campNow;
var realServerNow = serverNow;
var realAsk = typeof askDialog === 'function' ? askDialog : null;
var toasts = [];

function boot(role, team) {
  freshState();
  setMemberRole(role === undefined ? 'editor' : role);
  setMemberTeam(null);
  state.followTeam = team || null;
  state.identity = null;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false;
  state.bonuses = {}; state.results = {}; state.drafts = {}; state.brackets = {}; state.clocks = {}; state.meta.overrun = undefined;
  state.announcements = {};
  state.notice = defaultNotice();
  weatherData = null;
  setStandingsGuardThrows(false);
  counselorPreviewOn = false;
  cleanupOnRota = realOnRota; cleanupTeams = realRotaTeams; campWeek = realCampWeek;
  nowLast = null;
  nowUi.arriveKey = null; nowUi.painted = false; nowUi.p = null; nowUi.momentShown = false; nowUi.noticeShown = null; nowUi.statuses = {}; nowUi.flip.clear();
  annOverflow = { n: 0, html: '' };
  toasts = [];
  showToast = (m, o) => { toasts.push({ m: String(m), o }); return null; };
  state.ui.tab = 'now'; state.ui.gameId = null; state.ui.tool = null; state.ui.revealOpen = false; state.ui.view = 'home';
  shell.dirty.now = false;
  shell.sheets.slice().forEach((id) => shellSheetClose(id));
}
function done() {
  cleanupOnRota = realOnRota; cleanupTeams = realRotaTeams; campWeek = realCampWeek;
  showToast = realShowToast;
  campNow = realCampNow; serverNow = realServerNow;
  setStandingsGuardThrows(false);
  counselorPreviewOn = false;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  shell.sheets.slice().forEach((id) => shellSheetClose(id));
  state.ui.tab = 'now'; state.ui.gameId = null; state.ui.tool = null;
  setMemberTeam(null);
  setMemberRole(null);
  state.followTeam = undefined;
  state.announcements = {}; state.bonuses = {};
  nowLast = null;
  try { delete getComputedStyle; } catch (e) { /* none was set */ }
}
// A rota that is the same on both camps: breakfast the first team, lunch the second and third (Mon–Fri).
function stubRota() {
  cleanupOnRota = (d) => d >= 1 && d <= 5;
  cleanupTeams = (d, meal) => (d < 1 || d > 5 ? [] : meal === 'Breakfast' ? [T()[0]] : meal === 'Lunch' ? [T()[1], T()[2]] : []);
}
// The page's clock for this test: a tap re-renders through renderAll, which asks campNow / serverNow, so the picture a tap leaves
// behind is the one for the same minute.
function setClock(dow, minutes) {
  campNow = () => ({ dow, minutes });
  serverNow = () => BASE_MS + minutes * 60000;
}
function modelAt(dow, minutes, extra) {
  return nowModel(Object.assign({ now: { dow, minutes }, ms: BASE_MS + minutes * 60000 }, extra || {}));
}
// Paint the picture at a time exactly as nowRefresh does (the model is also the one a tap reads).
function paintAt(dow, minutes, extra) {
  setClock(dow, minutes);
  const m = modelAt(dow, minutes, extra);
  nowLast = m;
  renderNow(m);
  return m;
}
function el(id) { return document.getElementById(id); }
function html(id) { return el(id).innerHTML; }
function text(id) { return el(id).textContent; }
// What a person reads in a root written as markup (the stub keeps textContent apart from innerHTML).
function plain(id) { return html(id).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function kindTime(kind, dow) {
  const nb = nowBlocks(dow == null ? WED : dow).find((x) => x.kind === kind && !x.noTime);
  return nb ? { dow: dow == null ? WED : dow, minutes: nb.start + 3, nb } : null;
}
// the first games block of Wednesday that holds games (cloned up to `n` where the camp has fewer there)
function gamesBlockOf(dow, n) {
  const nb = nowBlocks(dow).find((x) => x.kind === 'games' && gamesForBlock(dow, x.b).length);
  assert.ok(nb, 'no games block with games on day ' + dow);
  let games = gamesForBlock(dow, nb.b);
  for (let i = games.length; i < (n || 0); i++) {
    const g0 = games[0];
    state.config.games.push(Object.assign({}, g0, { id: g0.id + '-t' + i, name: g0.name + ' ' + (i + 1), ord: (Number(g0.ord) || 0) + i + 1 }));
  }
  games = gamesForBlock(dow, nb.b);
  return { nb, games };
}
function medals(a, b, c) { return { medals: { gold: a, silver: b, bronze: c }, savedAt: new Date(BASE_MS).toISOString() }; }

// Every id of Now's own markup (the card and what hangs off it, the messages strip): counted for writes.
var NOW_IDS = [...new Set([...INDEX_HTML.matchAll(/id="((?:now-(?!reveal|champion)|announcements|sheet-(?:notice|messages|whos-where)|whos-where)[a-z-]*)"/g)].map((m) => m[1]))];
function watch(ids) {
  const counts = {};
  ids.forEach((id) => {
    const e = el(id);
    let h = e.innerHTML || '';
    let t = e.textContent || '';
    let hid = !!e.hidden;
    counts[id] = 0;
    Object.defineProperty(e, 'innerHTML', { get: () => h, set: (v) => { h = v; counts[id]++; }, configurable: true });
    Object.defineProperty(e, 'textContent', { get: () => t, set: (v) => { t = v; counts[id]++; }, configurable: true });
    Object.defineProperty(e, 'hidden', { get: () => hid, set: (v) => { hid = v; counts[id]++; }, configurable: true });
    const ds = Object.assign({}, e.dataset);
    e.dataset = new Proxy(ds, { set: (o, k, v) => { o[k] = v; counts[id]++; return true; }, deleteProperty: (o, k) => { delete o[k]; counts[id]++; return true; } });
  });
  return counts;
}
function moved(counts) { return Object.keys(counts).filter((k) => counts[k] > 0); }
function reset(counts) { Object.keys(counts).forEach((k) => { counts[k] = 0; }); }
function allNowMarkup() { return NOW_IDS.map((id) => html(id) + ' ' + text(id)).join(' ').replace(/\s+/g, ' '); }

// A button / row stand-in for the delegated taps: closest() answers the way the real DOM would for one row.
function keyBtn(row, pts) {
  return { dataset: { pts: String(pts) }, closest: (sel) => (/\.nm-team|\.aw-row/.test(sel) ? { dataset: row } : null) };
}

// ════════════════════════════════════════════════════════════════════
// every kind paints
// ════════════════════════════════════════════════════════════════════
test('the page: every id now-ui.js names is in index.html, and every markup id it paints is one the design pass drew', () => {
  const named = [...new Set([...UI_SRC.matchAll(/nowEl\('([a-z-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(named.length > 40, 'a real list: ' + named.length);
  named.forEach((id) => assert.ok(INDEX_HTML.includes('id="' + id + '"'), '#' + id + ' is not in index.html'));
  assert.ok(NOW_IDS.includes('now-card') && NOW_IDS.includes('now-moment-body') && NOW_IDS.includes('now-msgs-more'), 'the id sweep reaches the card, the moment and the strip');
});

test('games: every game is a row with its status, one open target, and no Score, key, place or tag a counselor has no use for', () => {
  boot('viewer', T()[0]);
  const { nb, games } = gamesBlockOf(WED, 3);
  state.results[games[0].id] = medals(T()[2], T()[1], T()[0]);
  const live = games[1];
  Object.assign(live, { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false });
  state.drafts[live.id] = { scores: { [T()[3]]: '9', [T()[0]]: '4' } };
  setStandingsGuardThrows(true); // a points reader reached by a counselor's markup would throw
  const m = paintAt(WED, nb.start + 10);
  assert.equal(el('now-card').dataset.kind, 'games');
  assert.equal(text('now-card-label'), m.card.title);
  assert.equal(text('now-card-left'), nowLeftText(m.clock));
  const body = html('now-card-body');
  assert.ok(/<div class="gr-list" role="list">/.test(body));
  assert.equal((body.match(/class="gr"/g) || []).length, games.length, 'one row per game');
  ['Done: ', 'Live: ', 'Not started: '].forEach((w) => assert.ok(body.includes(w), 'the status is a word as well as a mark: ' + w));
  assert.ok(/data-status="live"[^>]*>[\s\S]*?data-tag="live">Live</.test(body), 'the live tag');
  assert.ok(body.indexOf('data-status="live"') < body.indexOf('data-status="todo"') && body.indexOf('data-status="todo"') < body.indexOf('data-status="done"'), 'live first, then not started, then done');
  assert.equal((body.match(/data-open-game="/g) || []).length, games.length, 'ONE open target per row, the id escaped');
  assert.ok(/class="pd"/.test(body) && (body.match(/class="pd-c"/g) || []).length === 3, 'the podium has three medal winners');
  assert.ok(body.indexOf('data-place="1"') < body.indexOf('data-place="2"') && body.indexOf('data-place="2"') < body.indexOf('data-place="3"'), 'gold, silver, bronze');
  assert.ok(/data-kind="tally"/.test(body) && /Scores so far · team order/.test(body), 'a counselor\'s live tally says it is in team order');
  assert.ok(!/lb-pl|data-ranked|data-score-game|gr-score|gr-why/.test(body), 'no place numeral, no ranking, no Score for a counselor');
  const rows = [...body.matchAll(/class="lb-r" data-team="(t\d)"/g)].map((x) => x[1]);
  assert.deepEqual(rows, T().filter((id) => rows.includes(id)), 'roster order');
  assert.ok(el('now-todo').hidden && el('now-card-foot').hidden && el('now-moment').hidden, 'a counselor has no Still to do, no foot, no moment here');
  done();
});

test('games, a director: Score on the live and the next game, the ranked board, the sub that counts what is left', () => {
  boot('editor', null);
  const { nb, games } = gamesBlockOf(WED, 3);
  state.results[games[0].id] = medals(T()[2], T()[1], T()[0]);
  Object.assign(games[1], { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false });
  state.drafts[games[1].id] = { scores: { [T()[3]]: '9', [T()[0]]: '4' } };
  const m = paintAt(WED, nb.start + 10);
  const body = html('now-card-body');
  assert.ok(/data-ranked/.test(body) && /class="lb-pl">1</.test(body), 'a director\'s board is ranked');
  assert.equal((body.match(/data-score-game="/g) || []).length, 2, 'Score on the two games that are not done');
  assert.ok(/gr-score btn-gold"[^>]*data-score-game|gr-score btn-gold" data-score-game/.test(body), 'the live / next one is the gold one');
  assert.equal(plain('now-card-sub'), m.card.sub);
  assert.ok(/still to score/.test(plain('now-card-sub')));
  done();
});

test('games: a director on a team in the round gets the reason where Score would be, and never the button for it', () => {
  boot('editor', null);
  const { nb, games } = gamesBlockOf(WED, 2);
  const g = games[0];
  Object.assign(g, { format: 'tournament', roundOneMatchups: [[T()[0], T()[1]]], liveTracker: { innings: 3 } });
  state.brackets[g.id] = { phase: 'round1', round1: { pairs: [[T()[0], T()[1]]], winners: {} }, pool: [], matches: [], kind: undefined };
  setMemberTeam(T()[0]);
  const m = paintAt(WED, nb.start + 5);
  const row = m.body.rows.find((r) => r.id === g.id);
  if (row && row.score && row.score.why) {
    const body = html('now-card-body');
    assert.ok(body.includes('class="gr-why"') && body.includes(row.score.why), 'the own-team reason');
    const mine = body.slice(body.indexOf('data-key="g-' + g.id + '"'));
    assert.ok(!mine.slice(0, mine.indexOf('data-key="g-', 10) > 0 ? mine.indexOf('data-key="g-', 10) : undefined).includes('data-score-game'), 'no Score button on a round with my own team in it');
  }
  done();
});

test('a four-team bracket paints four cells in the order of play, my team marked, a team that lost struck, a place to be decided drawn empty', () => {
  boot('viewer', T()[0]);
  const { nb, games } = gamesBlockOf(WED, 1);
  const g = games[0];
  state.brackets4 = { [g.id]: { m: { s1: { a: T()[0], b: T()[3], winner: T()[0] }, s2: { a: T()[1], b: T()[2] }, third: {}, final: {} } } };
  paintAt(WED, nb.start + 5);
  const b = html('now-card-body');
  assert.equal((b.match(/class="b4-m"/g) || []).length, 4);
  assert.deepEqual([...b.matchAll(/data-slot="(\w+)"/g)].map((x) => x[1]), ['s1', 's2', 'third', 'final']);
  assert.ok(/data-status="done"/.test(b) && /data-status="live"/.test(b) && /data-tbd/.test(b));
  assert.ok(/class="b4-won">won</.test(b) && /data-lost/.test(b));
  assert.ok(/data-mine/.test(b));
  assert.ok(/class="nw-note" data-note="team"/.test(html('now-card-notes')), 'the line for my team rides the notes');
  done();
});

test('elective (junior): my station first, "Not Sam? Change", then the next blocks and a Who\'s where row; ask once; every station for a director', () => {
  if (!CAMP.features.electives) { return; }
  const when = kindTime('elective');
  boot('viewer', T()[0]);
  state.identity = undefined;
  let m = paintAt(when.dow, when.minutes);
  assert.equal(m.body.mode, 'ask');
  assert.ok(/es-ask-q/.test(html('now-card-body')) && /data-identity=""/.test(html('now-card-body')), 'the ask, with a way to say "just cheering"');
  assert.ok(el('now-card-over').hidden, 'no "Your station" line while asking');
  // a counselor who is on the sheet: the card is their station
  state.identity = null;
  const row = (electivesFor(when.dow)[when.nb.slot] || [])[0];
  assert.ok(row, 'a station to be at');
  const who = row[1][0];
  state.followTeam = nowTeamOfName(who) || T()[0];
  state.identity = who;
  m = paintAt(when.dow, when.minutes);
  assert.equal(m.body.mode, 'station');
  assert.equal(text('now-card-label'), row[0]);
  assert.ok(!el('now-card-over').hidden && text('now-card-over-text') === 'Your station');
  assert.ok(!el('now-card-change').hidden && /^Not \S+\? Change$/.test(text('now-card-change-text')));
  const b = html('now-card-body');
  assert.ok(/data-whos-where/.test(b) && /Who’s where/.test(b), "the Who's where row");
  assert.ok(/<h3 class="nw-h">Then<\/h3>/.test(b));
  assert.ok(el('now-card-bar').hidden === false, 'a timed block has its hairline');
  // a director sees every station inline
  setMemberRole('editor');
  state.identity = null;
  m = paintAt(when.dow, when.minutes);
  assert.equal(m.body.mode, 'all');
  assert.ok(/class="es-all"/.test(html('now-card-body')) && !/es-ask/.test(html('now-card-body')));
  assert.ok(/data-break/.test(html('now-card-body')) || m.body.onBreak.length === 0, 'the break list is the last row');
  done();
});

test('elective: the identity ask and the "Who\'s where" sheet — a tap sets the name (or none), the sheet lists every station and closes with its content', () => {
  if (!CAMP.features.electives) return;
  const when = kindTime('elective');
  boot('viewer', T()[0]);
  state.identity = undefined;
  paintAt(when.dow, when.minutes);
  nowSetIdentity('Sam');
  assert.equal(state.identity, 'Sam');
  nowSetIdentity('');
  assert.equal(state.identity, null, 'a blank is "just cheering"');
  state.identity = null;
  paintAt(when.dow, when.minutes);
  assert.equal(nowSheetAllowed('whos-where'), true);
  shellSheetOpen('whos-where');
  assert.ok(shell.sheets.includes('whos-where'));
  assert.ok(/Elective/.test(text('whos-where-when')));
  assert.ok(/es-st-name/.test(html('whos-where-body')));
  shellSheetClose('whos-where');
  paintAt(WED, 3 * 60); // not an elective any more
  assert.equal(nowSheetAllowed('whos-where'), false, 'a stale entry opens nothing');
  done();
});

test('meal: the dish is the answer, the cleanup team a note ("Your team is on cleanup"), the next block a run row', () => {
  const when = kindTime('meal');
  boot('viewer', null);
  stubRota();
  state.followTeam = cleanupTeams(when.dow, when.nb.meal)[0]; // the team on duty after this meal
  const m = paintAt(when.dow, when.minutes);
  assert.equal(el('now-card').dataset.kind, 'meal');
  if (m.body.dish && m.body.dish.text) assert.ok(html('now-card-sub').includes('class="nw-dish"') && html('now-card-sub').includes(esc(m.body.dish.text)));
  const notes = html('now-card-notes');
  assert.ok(/data-note="team"/.test(notes) && /Your team<\/b> is on cleanup after /.test(notes), 'mine says so');
  assert.ok(/data-mine/.test(notes));
  assert.ok(!el('now-next').hidden && /class="nr"/.test(html('now-next-list')));
  done();
});

test('Bible study: the verse, its reference, the song link only through safeVideoUrl, the week theme', () => {
  const when = kindTime('bible');
  boot('viewer', T()[0]);
  const m = paintAt(when.dow, when.minutes);
  if (m.card.kind !== 'bible') return; // a day with no verse reads as an activity (now-model.test.js)
  const b = html('now-card-body');
  assert.ok(/class="vs-text"/.test(b) || /class="vs-ref"/.test(b), 'the verse or its reference (senior\'s placeholder has no reference yet)');
  assert.ok(!/class="btn vs-song"/.test(b) || /href="https:\/\//.test(b), 'a song link is https only');
  const real = verseFor;
  verseFor = () => ({ text: 'A verse', ref: 'John 1:1', video: 'javascript:alert(1)' });
  paintAt(when.dow, when.minutes);
  assert.ok(!/javascript:/.test(html('now-card-body')) && !/vs-song/.test(html('now-card-body')), 'a script link is dropped, the verse stays');
  assert.ok(/A verse/.test(html('now-card-body')));
  verseFor = real;
  done();
});

test('meeting, arrival, send-off notice, the night, the morning and the gap between blocks each paint their own card', () => {
  boot('viewer', T()[0]);
  const seen = [];
  const meet = kindTime('meeting');
  if (meet) { paintAt(meet.dow, meet.minutes); assert.equal(el('now-card').dataset.kind, 'meeting'); seen.push('meeting'); }
  const arr = kindTime('arrival', 0);
  if (arr) {
    const am = paintAt(arr.dow, arr.minutes);
    assert.equal(el('now-card').dataset.kind, 'arrival');
    assert.ok(/nw-welcome/.test(html('now-card-body')), 'a counselor on a team is welcomed to it');
    if (am.later.length) assert.equal(text('now-later-h'), 'Today', 'Sunday lists its whole run sheet under Today');
    seen.push('arrival');
  }
  paintAt(WED, 23 * 60 + 30);
  assert.equal(el('now-card').dataset.kind, 'night');
  assert.equal(text('now-card-label'), 'Lights out');
  assert.ok(/<h3 class="nw-h">Tomorrow · /.test(html('now-card-body')), 'tomorrow\'s first three as run rows');
  assert.ok(el('now-next').hidden && el('now-later').hidden, 'no second list under the night card');
  paintAt(WED, 5 * 60);
  assert.equal(el('now-card').dataset.kind, 'night', 'before dawn it is still the night');
  paintAt(WED, 6 * 60 + 5);
  const first = nowBlocks(WED)[0];
  if (6 * 60 + 5 < first.start) { assert.equal(el('now-card').dataset.kind, 'morning'); assert.ok(/The day starts at /.test(plain('now-card-sub'))); seen.push('morning'); }
  // the send-off: the posted notice IS the card, and the strip leaves it out
  state.notice.status = 'posted';
  const off = kindTime('sendoff', 6);
  if (off) {
    setMemberRole('editor');
    const m = paintAt(off.dow, off.minutes);
    if (m.card.kind === 'notice') {
      assert.equal(el('now-card').dataset.kind, 'notice');
      assert.ok(/class="nb"/.test(html('now-card-body')), 'the notice markup');
      assert.ok(!el('now-card-down').hidden && !el('now-card-foot').hidden, 'a director can take it down from the card');
      assert.ok(el('now-notice').hidden, 'the strip leaves out what is the card');
      seen.push('notice');
    }
  }
  assert.ok(seen.length >= 2, 'at least two of these kinds exist in this camp: ' + seen.join(','));
  done();
});

test('between blocks, "Up next in N min" moves with the clock; before camp and after it say so; a week with no dates keeps the printed schedule', () => {
  boot('viewer', T()[0]);
  const bl = nowBlocks(WED);
  let gapAt = null;
  for (let i = 0; i + 1 < bl.length; i++) if (!bl[i].noTime && !bl[i + 1].noTime && bl[i + 1].start - bl[i].end >= 5) { gapAt = { m: bl[i].end + 1, next: bl[i + 1] }; break; }
  if (gapAt) {
    const m = paintAt(WED, gapAt.m);
    assert.equal(el('now-card').dataset.kind, 'between');
    assert.ok(/^Up next in /.test(text('now-card-label')));
    const later = nowModel({ now: { dow: WED, minutes: gapAt.m + 2 }, ms: BASE_MS + (gapAt.m + 2) * 60000 });
    nowLast = later; renderNowClock(later);
    assert.ok(/^Up next in /.test(text('now-card-label')) && text('now-card-label') !== nowTitleText(m), 'the minutes moved');
  }
  // dates set: a week in the future is "Camp starts …", one in the past "See you next year"
  campWeek = () => ({ start: '2030-07-21', phase: 'before' });
  let m = paintAt(WED, 10 * 60, { forced: false, date: '2030-07-10' });
  assert.equal(el('now-card').dataset.kind, 'none');
  assert.ok(/^Camp starts /.test(text('now-card-label')));
  m = paintAt(WED, 10 * 60, { forced: false, date: '2030-09-10' });
  assert.equal(el('now-card').dataset.kind, 'over');
  assert.equal(text('now-card-label'), 'See you next year');
  assert.ok(/wonderful week/.test(plain('now-card-sub')));
  campWeek = realCampWeek;
  setMemberRole('editor');
  m = paintAt(WED, 10 * 60, { forced: false, date: '2030-07-10' });
  done();
  // a director with no week: Set up the week
  boot('editor', null);
  campWeek = () => ({ start: '2030-07-21', phase: 'before' });
  paintAt(WED, 10 * 60, { forced: false, date: '2030-07-10' });
  assert.ok(/data-now-setup/.test(html('now-card-body')), 'a director is offered Set up the week');
  assert.ok(/Pick the camp/.test(plain('now-card-sub')));
  done();
});

test('Up next, Later today, Still to do today: the lists, Whole day on the last head shown, the director rows open the right takeover', () => {
  boot('editor', null);
  stubRota();
  const { nb, games } = gamesBlockOf(WED, 2);
  const after = nb.end + 10;
  const m = paintAt(WED, after);
  assert.ok(m.todo.length >= 1, 'a game left unscored shows as a row');
  assert.ok(!el('now-todo').hidden && /class="nr nr-act"/.test(html('now-todo-list')) && /data-todo="game"/.test(html('now-todo-list')));
  assert.ok(el('now-next-day').hidden !== el('now-later-day').hidden || el('now-later').hidden, '"Whole day" rides ONE list head');
  nowOpenTodo({ dataset: { todo: 'game', ref: games[0].id } });
  assert.equal(state.ui.gameId, games[0].id);
  assert.equal(state.ui.gameFrom, 'now', 'the labelled Back says Now');
  closeGame();
  // cleanup / verse rows go to Award points
  state.ui.tool = null;
  nowOpenTodo({ dataset: { todo: 'cleanup', ref: 'Lunch' } });
  assert.equal(state.ui.tool, 'award');
  state.ui.tool = null;
  nowLast = { todo: [{ todo: 'verse' }], card: { kind: 'activity' } };
  nowOpenTodoMore();
  assert.equal(state.ui.tool, 'award', 'N more after verse rows is Award points');
  state.ui.tool = null;
  nowLast = { todo: [{ todo: 'game' }], card: { kind: 'activity' } };
  nowOpenTodoMore();
  assert.equal(state.ui.tab, 'games', 'N more after a game row is the Games tab');
  state.ui.tab = 'now';
  done();
});

// ════════════════════════════════════════════════════════════════════
// RENDER STABILITY per kind
// ════════════════════════════════════════════════════════════════════
function kindScenes() {
  const scenes = [];
  const add = (name, dow, minutes, prep) => scenes.push({ name, dow, minutes, prep });
  const g = gamesBlockOf(WED, 3);
  add('games (a done row with a podium, a live tally, a not-started one)', WED, g.nb.start + 10, () => {
    state.results[g.games[0].id] = medals(T()[2], T()[1], T()[0]);
    Object.assign(g.games[1], { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false });
    state.drafts[g.games[1].id] = { scores: { [T()[3]]: '9', [T()[0]]: '4' } };
  });
  add('running over', WED, g.nb.end + 4, () => { Object.assign(g.games[1], { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false }); state.drafts[g.games[1].id] = { scores: { [T()[0]]: '4' } }; });
  if (CAMP.features.electives) { const e = kindTime('elective'); add('elective', e.dow, e.minutes, () => { state.identity = undefined; }); }
  [['meal', WED], ['bible', WED], ['meeting', WED], ['arrival', 0], ['activity', WED], ['bedtime', WED]].forEach(([k, d]) => { const t = kindTime(k, d); if (t) add(k, t.dow, t.minutes); });
  add('night', WED, 23 * 60 + 30);
  add('lunch cleanup moment', WED, (nowBlocks(WED).find((x) => x.kind === 'meal' && x.start > 11 * 60) || nowBlocks(WED)[0]).end + 5);
  const bs = kindTime('bible');
  if (bs) add('verse moment', bs.dow, bs.minutes);
  const off = kindTime('sendoff', 6);
  if (off) add('send-off notice', off.dow, off.minutes, () => { state.notice.status = 'posted'; });
  return scenes;
}

test('render stability, every kind: a second paint of the same picture writes nothing (counselor, and director with the moment keys)', () => {
  ['viewer', 'editor'].forEach((role) => {
    boot(role, T()[1]);
    stubRota();
    const scenes = kindScenes();
    scenes.forEach((s) => {
      if (s.prep) s.prep();
      const first = paintAt(s.dow, s.minutes);
      const counts = watch(NOW_IDS);
      const p = nowUi.p;
      paintAt(s.dow, s.minutes);
      assert.deepEqual(moved(counts), [], `${role} · ${s.name} (${first.card.kind}): an identical second paint wrote ${moved(counts).join(', ')}`);
      assert.equal(nowUi.p, p, 'and the hairline stayed');
      // the 30 s tick inside the same minute: a recompute that lands on the same picture
      nowTick({ now: { dow: s.dow, minutes: s.minutes }, ms: BASE_MS + s.minutes * 60000 });
      assert.deepEqual(moved(counts), [], `${role} · ${s.name}: a tick in the same minute wrote ${moved(counts).join(', ')}`);
      Object.keys(counts).forEach((id) => { delete el(id).innerHTML; delete el(id).textContent; delete el(id).hidden; });
    });
    done();
  });
});

test('the tick between wake-ups writes the minutes left and the hairline and nothing else; a wake-up is a full paint', () => {
  boot('viewer', T()[0]);
  const { nb } = gamesBlockOf(WED, 2);
  const start = nb.start + 10;
  const m0 = paintAt(WED, start);
  const counts = watch(NOW_IDS);
  const next = nowTick({ now: { dow: WED, minutes: start + 1 }, ms: BASE_MS + (start + 1) * 60000 });
  assert.equal(next, 'clock', 'inside a block it is the clock only');
  assert.deepEqual(moved(counts), ['now-card-left'], 'only the minutes left moved: ' + moved(counts));
  assert.ok(nowUi.p !== null);
  reset(counts);
  const full = nowTick({ now: { dow: WED, minutes: nb.end + 1 }, ms: BASE_MS + (nb.end + 1) * 60000 });
  assert.equal(full, 'full', 'the block\'s end is a wake-up');
  assert.ok(moved(counts).length > 3, 'and the card changed over');
  assert.ok(m0.wake.includes(nb.end));
  done();
});

test('a block changing over writes what changed and arrives; a first paint, a repeat and a paint with Now not on screen animate nothing', () => {
  boot('viewer', T()[0]);
  const plays = [];
  const realPlay = JellyMotion.play;
  JellyMotion.play = function (target, preset, frame, o) { plays.push({ target, preset, o }); return null; };
  try {
    const a = kindTime('meal');
    const b = kindTime('bible');
    paintAt(a.dow, a.minutes);
    assert.equal(plays.length, 0, 'the first paint is a plain write');
    paintAt(a.dow, a.minutes);
    assert.equal(plays.length, 0, 'a repeat animates nothing');
    paintAt(b.dow, b.minutes);
    assert.ok(plays.some((p) => p.target === el('now-card') && p.preset === 'arrive'), 'a block changing over arrives');
    assert.ok(Array.isArray(plays.find((p) => p.target === el('now-card')).o.calm), 'and its calm path is a fade (no transform)');
    plays.length = 0;
    shell.dirty.now = true; // the panel is arriving as a whole
    paintAt(a.dow, a.minutes);
    assert.equal(plays.length, 0, 'a paint that brings Now back into view is the panel\'s own arrival');
    shell.dirty.now = false;
    state.ui.gameId = state.config.games[0].id; // a takeover is up
    paintAt(b.dow, b.minutes);
    assert.equal(plays.length, 0, 'nothing animates under a takeover');
  } finally { JellyMotion.play = realPlay; state.ui.gameId = null; }
  done();
});

test('a game going Live to Done is remembered for its pop and its medals, and only once', () => {
  boot('viewer', T()[0]);
  const { nb, games } = gamesBlockOf(WED, 2);
  Object.assign(games[0], { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false });
  state.drafts[games[0].id] = { scores: { [T()[0]]: '4' } };
  paintAt(WED, nb.start + 5);
  assert.equal(nowUi.statuses[games[0].id], 'live');
  state.results[games[0].id] = medals(T()[0], T()[1], T()[2]);
  delete state.drafts[games[0].id];
  paintAt(WED, nb.start + 6);
  assert.equal(nowUi.statuses[games[0].id], 'done');
  assert.ok(nowUi.flip.has(games[0].id), 'queued until its podium is on screen');
  done();
});

// ════════════════════════════════════════════════════════════════════
// the moment: keys, the own-team guard, the one write path
// ════════════════════════════════════════════════════════════════════
function lunchMoment() {
  const nb = nowBlocks(WED).find((x) => x.kind === 'meal' && x.start > 11 * 60 && x.start < 14 * 60) || nowBlocks(WED).find((x) => x.kind === 'meal');
  return { nb, minutes: nb.end + 5 };
}

test('the cleanup moment: a tap on a key is setCleanupPoints — ONE entry under the deterministic id, 0 clears, the same slot Award points writes', () => {
  boot('editor', null);
  stubRota();
  const { nb, minutes } = lunchMoment();
  const meal = nb.meal;
  const m = paintAt(WED, minutes);
  assert.ok(m.moment && m.moment.kind === 'cleanup' && m.moment.max === 3);
  assert.ok(!el('now-moment').hidden && el('now-moment').dataset.moment === 'cleanup');
  assert.ok(!el('now-moment-secret').hidden && !el('now-moment-key').hidden, 'Points stay with directors / 3 = spotless');
  const rows = [...html('now-moment-body').matchAll(/class="nm-team" data-key="(c-t\d)" data-team="(t\d)"/g)];
  assert.deepEqual(rows.map((r) => r[2]), cleanupTeams(WED, meal), 'one row per team on the rota');
  assert.equal((html('now-moment-body').match(/class="aw-pt"/g) || []).length, 4 * rows.length, 'four keys (0–3) a team');
  const team = rows[0][2];
  nowTapKey(keyBtn({ team, key: 'c-' + team }, 2));
  const id = 'cleanup-' + team + '-' + WED + '-' + meal;
  assert.equal(state.bonuses[id] && state.bonuses[id].points, 2);
  assert.equal(Object.keys(state.bonuses).filter((k) => state.bonuses[k].category === 'cleanup').length, 1, 'one entry for the slot');
  assert.ok(/Saved · 2/.test(html('now-moment-body')), 'the row says what was saved');
  assert.ok(/aria-checked="true" data-pts="2"/.test(html('now-moment-body')));
  // Award points writes the same slot: a tap there replaces it, never adds
  const row = { dataset: { team, meal, key: 'c-' + meal + '-' + team } };
  state.ui.tool = 'award'; awardUi.dow = WED;
  awardTapKey({ dataset: { pts: '3' }, closest: (sel) => (sel === '.aw-row' ? row : null) });
  assert.equal(Object.keys(state.bonuses).filter((k) => state.bonuses[k].category === 'cleanup').length, 1, 'still ONE entry after Award points wrote the slot');
  assert.equal(state.bonuses[id].points, 3);
  state.ui.tool = null;
  paintAt(WED, minutes);
  nowTapKey(keyBtn({ team, key: 'c-' + team }, 0));
  assert.equal(state.bonuses[id], undefined, '0 clears the slot');
  done();
});

test('the moment keys are bounded and the own-team guard holds: a stale tap, a forged value, an unknown team and a locked row write nothing', () => {
  boot('editor', null);
  stubRota();
  const { nb, minutes } = lunchMoment();
  const m = paintAt(WED, minutes);
  const team = m.moment.teams[0].team;
  const other = m.moment.teams[1] ? m.moment.teams[1].team : null;
  nowTapKey(keyBtn({ team, key: 'c-' + team }, 9));
  nowTapKey(keyBtn({ team, key: 'c-' + team }, -1));
  nowTapKey(keyBtn({ team, key: 'c-' + team }, 4)); // cleanup stops at 3
  nowTapKey(keyBtn({ team: 'zzz', key: 'c-zzz' }, 2));
  nowTapKey(keyBtn({ team: T().find((id) => !m.moment.teams.some((t) => t.team === id)), key: 'c-x' }, 2));
  assert.deepEqual(state.bonuses, {}, 'nothing written for a value or a team the moment has no key for');
  // my own team: another director gives these
  setMemberTeam(team);
  const own = paintAt(WED, minutes);
  const mine = own.moment.teams.find((t) => t.team === team);
  assert.equal(mine.locked, true);
  const markup = html('now-moment-body');
  const slice = markup.slice(markup.indexOf('data-team="' + team + '"'), other ? markup.indexOf('data-team="' + other + '"') : undefined);
  assert.ok(/data-locked/.test(markup) && /aw-lock/.test(slice) && !/class="aw-pt"/.test(slice), 'a lock line, no keys');
  nowTapKey(keyBtn({ team, key: 'c-' + team }, 2));
  assert.deepEqual(state.bonuses, {}, 'the writer refuses the director\'s own team even when a tap arrives');
  assert.ok(toasts.some((t) => /another director/.test(t.m)), 'and says so');
  // a hint-painted director (the member record has not answered) has no keys, and a stale tap does nothing
  setMemberTeam(null);
  setMemberRole('editor', { provisional: true });
  const hint = paintAt(WED, minutes);
  assert.ok(hint.moment && hint.moment.max === undefined, 'a provisional director\'s moment has no keys');
  assert.ok(!/class="aw-pt"/.test(html('now-moment-body')) && el('now-moment-secret').hidden);
  nowLast = m; // a stale picture that still has keys
  nowTapKey(keyBtn({ team, key: 'c-' + team }, 2));
  assert.deepEqual(state.bonuses, {}, 'standingsVisible() is checked at call time');
  setMemberRole('editor');
  // the moment is over: a tap on a key that is no longer drawn writes nothing
  paintAt(WED, nb.end + 40);
  nowTapKey(keyBtn({ team, key: 'c-' + team }, 2));
  assert.deepEqual(state.bonuses, {});
  done();
});

test('the verse moment (Bible study, a confirmed director): six keys a team, the lock on my own, one write path, doubled keys show what a tap is worth', () => {
  const when = kindTime('bible');
  boot('editor', null);
  const m0 = paintAt(when.dow, when.minutes);
  if (m0.card.kind !== 'bible') { done(); return; }
  assert.ok(m0.moment && m0.moment.kind === 'verse' && m0.moment.max === 5);
  assert.equal(el('now-moment').dataset.moment, 'verse');
  assert.ok(el('now-moment-key').hidden, 'the "3 = spotless" key is the cleanup\'s');
  const team = T()[0];
  assert.equal((html('now-moment-body').match(/class="aw-pt"/g) || []).length, 6 * T().length);
  nowTapKey(keyBtn({ team, key: 'v-' + team }, 5));
  assert.equal(state.bonuses['verse-' + team + '-' + WED].points, 5, 'the deterministic id Award points and the Memory verse sheet use');
  nowTapKey(keyBtn({ team, key: 'v-' + team }, 6));
  assert.equal(state.bonuses['verse-' + team + '-' + WED].points, 5, 'verse stops at 5');
  const realDouble = inDoubleBonusWindow;
  inDoubleBonusWindow = () => true;
  paintAt(when.dow, when.minutes);
  assert.ok(/data-pts="5"[^>]*>10</.test(html('now-moment-body')), 'the 5 key reads 10 in the double-points window');
  assert.equal(state.bonuses['verse-' + team + '-' + WED].points, 5, 'the stored value stays 0–5');
  inDoubleBonusWindow = realDouble;
  // a counselor has no verse moment at all
  boot('viewer', T()[0]);
  paintAt(when.dow, when.minutes);
  assert.ok(el('now-moment').hidden && !/aw-pt/.test(html('now-moment-body')));
  done();
});

test('a counselor sees the cleanup moment as whose turn it is — the team, its counselors, "Your team" — and never a key or a number', () => {
  boot('viewer', T()[1]);
  stubRota();
  setStandingsGuardThrows(true);
  const { minutes } = lunchMoment();
  const m = paintAt(WED, minutes);
  assert.ok(m.moment, 'the moment is for everyone');
  assert.ok(!el('now-moment').hidden);
  const b = html('now-moment-body');
  assert.ok(/class="nm-name"/.test(b) && /class="nm-you">Your team</.test(b));
  assert.ok(!/aw-pt|nm-label|nm-saved|aw-lock|data-pts/.test(b));
  assert.ok(el('now-moment-secret').hidden && el('now-moment-key').hidden);
  done();
});

// ════════════════════════════════════════════════════════════════════
// SECRECY
// ════════════════════════════════════════════════════════════════════
test('SECRECY: a counselor\'s Now, walked through every kind of card with the points guard throwing, carries no point, place, key or director control', () => {
  boot('viewer', T()[0]);
  stubRota();
  setMemberTeam(T()[0]);
  const g = gamesBlockOf(WED, 3);
  state.bonuses = { 'cleanup-t0-3-Lunch': { teamId: T()[0], category: 'cleanup', points: 3, day: 3, meal: 'Lunch', at: new Date(BASE_MS).toISOString() }, 'verse-t0-3': { teamId: T()[0], category: 'verse', points: 5, day: 3, at: new Date(BASE_MS).toISOString() } };
  state.results[g.games[0].id] = medals(T()[2], T()[1], T()[0]);
  Object.assign(g.games[1], { format: 'tally', liveRankings: true, lowerWins: false, timeInput: false });
  state.drafts[g.games[1].id] = { scores: { [T()[3]]: '9', [T()[0]]: '4' } };
  state.notice.status = 'posted';
  setStandingsGuardThrows(true);
  const forbidden = [/class="aw-pt"|class="aw-pts|class="aw-row"|class="aw-lock"/, /nm-saved|nm-label|nm-key/, /class="lb-pl"|data-ranked/, /data-score-game|gr-score|gr-why/, /data-todo|nr-act/, /Points stay|3 = spotless|Still to do|Take down|Still on /, /\bpts?\b/i, /\bgiven\b/i];
  const times = [];
  for (let d = 0; d < 7; d++) for (let m = 0; m < 1440; m += 37) times.push([d, m]);
  g.nb && times.push([WED, g.nb.start + 5], [WED, g.nb.end + 4], [WED, lunchMoment().minutes]);
  const out = [];
  SINKS.log.length = 0;
  SINKS.on = true;
  try {
    times.forEach(([d, m]) => {
      paintAt(d, m);
      const markup = allNowMarkup();
      forbidden.forEach((re) => { if (re.test(markup)) out.push(`dow ${d} minute ${m}: ${re} in ${markup.match(re)[0]}`); });
      ['now-todo', 'now-card-foot', 'now-card-hold', 'now-card-down', 'now-notice-down', 'now-moment-secret', 'now-moment-key', 'now-todo-more'].forEach((id) => {
        if (!el(id).hidden) out.push(`dow ${d} minute ${m}: #${id} is shown to a counselor`);
      });
    });
  } finally { SINKS.on = false; }
  assert.deepEqual(out.slice(0, 5), [], 'what a counselor was shown');
  // the sinks: nothing the renderer wrote reads as a point, a sign or an ordinal place
  const leaks = SINKS.log.filter((e) => /\bpts?\b/i.test(e.text) && e.kind !== 'innerHTML');
  assert.deepEqual(leaks.map((e) => e.text.slice(0, 80)), []);
  // a director in a counselor preview is a counselor: the same walk
  setMemberRole('editor');
  counselorPreviewOn = true;
  times.filter((_, i) => i % 3 === 0).forEach(([d, m]) => {
    paintAt(d, m);
    const markup = allNowMarkup();
    forbidden.forEach((re) => assert.ok(!re.test(markup), `preview dow ${d} minute ${m}: ${re}`));
  });
  counselorPreviewOn = false;
  done();
});

test('a counselor\'s taps write nothing: a key, Still on this, Take down, and a stale model cannot make them', () => {
  boot('viewer', T()[0]);
  stubRota();
  const { minutes } = lunchMoment();
  paintAt(WED, minutes);
  const team = T()[1];
  const before = JSON.stringify(state);
  nowTapKey(keyBtn({ team, key: 'c-' + team }, 3));
  nowTakeDownNotice();
  assert.equal(nowHoldOverrun(), false);
  assert.equal(JSON.stringify(state), before, 'nothing changed');
  done();
});

// ════════════════════════════════════════════════════════════════════
// the foot: Still on this, Take down
// ════════════════════════════════════════════════════════════════════
test('Still on this: offered to a director while a block has ended with a game unscored; one tap writes only meta/overrun and +10 minutes', () => {
  boot('editor', null);
  const { nb } = gamesBlockOf(WED, 2);
  const m = paintAt(WED, nb.end + 3);
  assert.ok(m.card.hold && m.card.hold.can, 'the offer is in the model');
  assert.ok(!el('now-card-hold').hidden && !el('now-card-foot').hidden);
  assert.ok(/^Still on /.test(text('now-card-hold-text')) && /\+10 min/.test(text('now-card-hold-text')));
  assert.ok(/every phone’s Now/.test(text('now-card-hold-note')));
  const before = JSON.stringify(Object.assign({}, state, { meta: undefined, ui: undefined }));
  assert.equal(nowHoldOverrun(), true);
  assert.ok(state.meta.overrun && /^3:/.test(state.meta.overrun.key) && state.meta.overrun.until > BASE_MS + (nb.end + 3) * 60000, 'until is a server time, later than now');
  assert.equal(JSON.stringify(Object.assign({}, state, { meta: undefined, ui: undefined })), before, 'nothing else moved');
  done();
});

test('Take down: the posted notice goes back to a draft with a 10-second Undo that checks first; a counselor\'s tap does nothing', () => {
  boot('editor', null);
  state.notice.status = 'posted';
  paintAt(WED, 10 * 60);
  assert.ok(!el('now-notice').hidden && !el('now-notice-down').hidden, 'the strip, with Take down');
  assert.ok(text('now-notice-title').length > 0);
  nowTakeDownNotice();
  assert.equal(state.notice.status, 'draft');
  const undo = toasts.find((t) => t.o && t.o.action && t.o.action.label === 'Undo');
  assert.ok(undo, 'a toast with Undo');
  assert.equal(undo.o.duration, 10000, 'for ten seconds');
  undo.o.action.run();
  assert.equal(state.notice.status, 'posted', 'Undo puts it back');
  // somebody else changed it since: Undo leaves their version alone
  nowTakeDownNotice();
  const undo2 = toasts.filter((t) => t.o && t.o.action).pop();
  state.notice.title = 'Changed by someone';
  undo2.o.action.run();
  assert.equal(state.notice.status, 'draft', 'a notice edited meanwhile is not put back');
  boot('viewer', T()[0]);
  state.notice.status = 'posted';
  nowTakeDownNotice();
  assert.equal(state.notice.status, 'posted');
  done();
});

// ════════════════════════════════════════════════════════════════════
// the messages strip and the sheets
// ════════════════════════════════════════════════════════════════════
var postSeq = 0; // a dismissal is kept in localStorage by id: every post gets ids no earlier test dismissed
var posted = [];
function post(n) {
  const now = Date.now();
  postSeq++;
  posted = [];
  state.announcements = {};
  for (let i = 0; i < n; i++) {
    posted.push('p' + postSeq + '-' + i);
    state.announcements[posted[i]] = { id: posted[i], text: 'Banner ' + i, at: new Date(now - i * 1000).toISOString(), by: 'Jenn', ttlMs: 3600000 };
  }
}
function stripCount() { return (html('announcements').match(/class="msg"/g) || []).length; }

test('the strip holds three messages (the notice counts as one) and sends the rest behind "N more messages"; text size 130% holds one fewer', () => {
  boot('viewer', T()[0]);
  post(4);
  paintAt(WED, 10 * 60);
  assert.equal(stripCount(), 3);
  assert.equal(annOverflow.n, 1);
  assert.ok(!el('now-msgs-more').hidden && text('now-msgs-more-text') === '1 more message');
  state.notice.status = 'posted';
  paintAt(WED, 10 * 60);
  assert.ok(!el('now-notice').hidden);
  assert.equal(stripCount(), 2, 'the notice strip is one of the three');
  assert.equal(annOverflow.n, 2);
  assert.equal(text('now-msgs-more-text'), '2 more messages');
  getComputedStyle = () => ({ fontSize: '21px' }); // 130% text
  paintAt(WED, 10 * 60);
  assert.equal(stripCount(), 1, 'bigger text, one fewer');
  assert.equal(annOverflow.n, 3);
  delete getComputedStyle;
  post(2);
  state.notice.status = 'draft';
  paintAt(WED, 10 * 60);
  assert.equal(annOverflow.n, 0);
  assert.ok(el('now-msgs-more').hidden, 'no more row when everything fits');
  done();
});

test('#sheet-messages holds the overflow, opens only when there is some, dismissing in the strip pulls the next one up, and the sheet follows', () => {
  boot('viewer', T()[0]);
  post(5);
  paintAt(WED, 10 * 60);
  assert.equal(nowSheetAllowed('messages'), true);
  shellSheetOpen('messages');
  assert.ok(shell.sheets.includes('messages'));
  assert.ok(/Banner 3/.test(html('sheet-messages-body')) && /Banner 4/.test(html('sheet-messages-body')) && !/Banner 0/.test(html('sheet-messages-body')), 'the sheet has what the strip had no room for');
  dismissAnnouncement(posted[0]);
  paintAt(WED, 10 * 60);
  assert.ok(!/Banner 0/.test(html('announcements')) && /Banner 3/.test(html('announcements')), 'the next one is pulled up');
  assert.ok(/Banner 4/.test(html('sheet-messages-body')) && !/Banner 3/.test(html('sheet-messages-body')), 'the open sheet follows');
  post(2);
  paintAt(WED, 10 * 60);
  assert.ok(!shell.sheets.includes('messages'), 'nothing left over: the sheet closes itself');
  assert.equal(nowSheetAllowed('messages'), false);
  done();
});

test('the notice: a strip with the viewer\'s own team line and See all, the whole notice in #sheet-notice, and the sheet closes when it is taken down', () => {
  boot('viewer', T()[0]);
  state.notice.status = 'posted';
  const zone = state.notice.zones.find((z) => z.teamId === T()[0]) || state.notice.zones[0];
  state.notice.zones = [{ teamId: T()[0], place: zone ? zone.place || 'Dining hall' : 'Dining hall', note: 'tables and floor' }].concat(state.notice.zones.filter((z) => z.teamId !== T()[0]));
  paintAt(WED, 10 * 60);
  assert.ok(!el('now-notice').hidden);
  assert.ok(!el('now-notice-yours').hidden && /class="nn-words"/.test(html('now-notice-yours')) && /tables and floor/.test(html('now-notice-yours')));
  assert.ok(el('now-notice-down').hidden, 'a counselor cannot take it down');
  assert.equal(nowSheetAllowed('notice'), true);
  shellSheetOpen('notice');
  assert.ok(/class="nb"/.test(html('sheet-notice-body')) && /class="nb-yours"/.test(html('sheet-notice-body')));
  assert.ok(text('sheet-notice-title').length > 0);
  state.notice.status = 'draft';
  renderNowSheet('notice');
  assert.ok(!shell.sheets.includes('notice'), 'taken down meanwhile: the sheet closes');
  assert.equal(nowSheetAllowed('notice'), false);
  done();
});

test('the join bar rides the strip first for a director; "See who is asking" and the dismiss are the strip\'s own delegated taps, on the sheet too', () => {
  boot('editor', null);
  post(1);
  const real = peopleRequests;
  peopleRequests = () => [{ key: 'x@y,com', name: 'Taylor Reed', at: 1 }];
  try {
    paintAt(WED, 10 * 60);
    assert.ok(html('announcements').indexOf('data-kind="join"') < html('announcements').indexOf('data-kind="banner"'), 'the join bar first');
    const m = nowModel({ now: { dow: WED, minutes: 600 }, ms: BASE_MS });
    assert.equal(m.messages[0].kind, 'join');
    assert.equal(typeof annStripClick, 'function', 'one handler, shared with the sheet');
  } finally { peopleRequests = real; }
  done();
});

test('the notice as a preview (Tell everyone\'s, the builder\'s) is the strip Now shows — the same parts as the page\'s own — and the builder\'s adds what See all opens', () => {
  boot('editor', T()[0]);
  state.notice.status = 'draft';
  state.notice.zones = [{ teamId: T()[0], place: 'Dining hall', note: 'tables' }];
  assert.equal(noticeCardHtml(false), null, 'a draft is nothing on a phone');
  const strip = noticeCardHtml(true, undefined, { strip: true });
  const full = noticeCardHtml(true);
  assert.ok(strip.startsWith('<section class="msg nn" data-kind="notice">'), 'the strip');
  assert.ok(full.startsWith(strip) && /class="nb-preview"/.test(full) && /class="nb"/.test(full) && /nb-yours/.test(full), 'the builder\'s: the strip, then the whole notice');
  assert.ok(!/class="nb"/.test(strip), 'Tell\'s: the strip alone');
  // the strip's parts are the page\'s own (index.html's static #now-notice, which renderNowMessages patches in place)
  const staticStrip = INDEX_HTML.slice(INDEX_HTML.indexOf('id="now-notice"'), INDEX_HTML.indexOf('</section>', INDEX_HTML.indexOf('id="now-notice"')));
  const classes = (h) => new Set([...h.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const want = classes(staticStrip);
  const got = classes(strip);
  ['msg-remove', 'nn-down'].forEach((c) => want.delete(c)); // a director's Take down is not in a picture
  want.forEach((c) => assert.ok(got.has(c), 'the preview lacks .' + c));
  got.forEach((c) => assert.ok(want.has(c) || ['nn-mark', 'nn-words', 'tm', 'tm-shield', 'ico', 'flag', 'tm-tile'].includes(c), 'the preview has .' + c + ' which the page\'s strip does not'));
  // the member of the team named on the notice reads their own line first
  assert.ok(/nn-yours/.test(strip) && /tables/.test(strip));
  // a pin Tell everyone WOULD post has no team areas: the live notice's must not leak into its picture
  const pin = noticeCardHtml(true, tellPinnedNotice('Rain plan. Games move indoors.'), { strip: true });
  assert.ok(/Rain plan/.test(pin) && !/nn-yours/.test(pin) && !/Dining hall/.test(pin), 'the picture is of the notice it was handed');
  done();
});

// ════════════════════════════════════════════════════════════════════
// escaping and sanitizers
// ════════════════════════════════════════════════════════════════════
test('every database string is escaped: a team, a game, a station, a notice, a verse, a banner and a counselor name come out as text, and an emoji, link and colour pass their sanitizers', () => {
  const EVIL = '"><b id=pwn>x</b><script>';
  boot('editor', T()[0]);
  stubRota();
  state.teams[0].name = EVIL;
  state.teams[1].name = EVIL;
  const g = gamesBlockOf(WED, 3);
  g.games[0].name = EVIL; g.games[0].location = EVIL; g.games[0].emoji = '<img src=x onerror=1>';
  state.results[g.games[0].id] = medals(T()[0], T()[1], T()[2]);
  state.notice.status = 'posted'; state.notice.title = EVIL; state.notice.sub = EVIL;
  state.notice.zones = [{ teamId: T()[0], place: EVIL, note: EVIL }];
  state.notice.steps = [{ emoji: '<svg onload=1>', when: EVIL, items: [EVIL] }];
  state.announcements = { a: { id: 'a', text: EVIL, at: new Date().toISOString(), by: EVIL, ttlMs: 3600000 } };
  const times = [[WED, g.nb.start + 5], [WED, g.nb.end + 5], [WED, lunchMoment().minutes], [WED, 10 * 60]];
  const bs = kindTime('bible'); if (bs) times.push([bs.dow, bs.minutes]);
  const off = kindTime('sendoff', 6); if (off) times.push([off.dow, off.minutes]);
  times.forEach(([d, m]) => {
    paintAt(d, m);
    const markup = NOW_IDS.map((id) => html(id)).join(' ');
    assert.ok(!/<b id=pwn>|<script>|<img src=x|<svg onload/.test(markup), `dow ${d} minute ${m}: raw markup from a database string`);
  });
  paintAt(off ? off.dow : WED, off ? off.minutes : 600);
  shellSheetOpen('notice');
  assert.ok(!/<b id=pwn>|<script>/.test(html('sheet-notice-body')), 'the sheet too');
  assert.ok(!/<b id=pwn>/.test(html('sheet-messages-body')));
  done();
});

// ════════════════════════════════════════════════════════════════════
// the app survives without the file
// ════════════════════════════════════════════════════════════════════
test('without now-ui.js the app runs: no renderer, no throw, Now keeps the announcements and the shell fills nothing for its sheets', () => {
  const { makeContext } = nodeRequire('./harness.js');
  const c = makeContext({ camp: CAMP.id, without: ['now-ui.js'], seeded: scheduleIsShared() });
  const out = nodeRequire('vm').runInContext(`(function () {
    setMemberRole('viewer');
    state.ui.tab = 'now';
    renderAll();
    shellTick();
    shellSheetOpen('notice');
    return { renderNow: typeof renderNow, sheets: shell.sheets.slice(), allowed: shellSheetAllowed('whos-where') };
  })()`, c.ctx);
  assert.equal(out.renderNow, 'undefined');
  assert.deepEqual(out.sheets, [], 'a sheet nothing can fill does not open');
  assert.equal(out.allowed, false);
});
