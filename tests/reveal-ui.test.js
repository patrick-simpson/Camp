// reveal-ui.js — the phones' SCREENS of the standings reveal (redesign §4.9, §4.10, §2.2; BUILD-PLAN Step 23): Now's
// live mirror, the frozen grid on Now and Games, the header strip, the Now tab's dot, the champion line, More's row and
// the Games link. Runs under both camp profiles (reveal-ui.senior.test.js evals this file: four teams, flag marks).
// The engine's own rules (what is confirmed, when it lets go) are reveal.test.js; the director's remote is
// reveal-remote.test.js. What these cases pin: the SECRECY rule (a counselor's screens read only revealView and so can
// never show a place, a point or a team the directors have not shown), the 3 s lag keyed to `sa`, that an idle repaint
// writes nothing, and that every hook the code names exists in index.html.

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const T0 = Date.parse('2027-06-23T23:31:00Z'); // a Wednesday, 7:31 PM EDT
const N = CAMP.teamCount;
const REAL = dbPath('revealPublic/real');
const REAL_PAINT = revealPaint;                 // reveal-ui.js's own, which the helper below puts back after the engine's reset
const realDateNow = Date.now;
function atTime(ms) { Date.now = () => ms; }

function ent(id, p, extra) {
  return Object.assign({ nm: 'Team ' + id, p, g: 0, s: 0, b: 0, v: 0, m: 0, c: 0 }, extra || {});
}
function mkCtl(o) {
  return Object.assign({
    v: 1, id: 'r1kz9fxq-4hd2', seq: 3, phase: 'live', cur: 1, shown: 2, teams: N, finale: false,
    at: T0 + 10000, sa: T0 + 10000, ca: T0, startedAt: T0, until: untilFor(T0, false),
  }, o || {});
}
// the first `shown` places, worst first (g0 = last place), one team per group, a name only that team has
function mkPub(shown) {
  const pub = {};
  for (let i = 0; i < shown; i++) {
    const tid = 't' + (N - 1 - i);
    pub['g' + i] = { place: N - i, e: { [tid]: ent(tid, 10 * (N - i), { nm: tname(tid), g: 2, s: 1, b: 1, v: 4, m: 3, c: 2 }) } };
  }
  return pub;
}

function resetReveal() {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
  if (revealRealRef && revealRealCb) { try { revealRealRef.off('value', revealRealCb); } catch (e) { /* ignore */ } }
  if (revealPracticeRef && revealPracticeCb) { try { revealPracticeRef.off('value', revealPracticeCb); } catch (e) { /* ignore */ } }
  revealStarted = false; revealDenied = false; revealPracticeDenied = false;
  revealRealRef = null; revealRealCb = null; revealPracticeRef = null; revealPracticeCb = null;
  confirmedReveal.real = null; confirmedReveal.practice = null;
  revealLoaded.real = false; revealLoaded.practice = false;
  revealLastSig = ''; revealLastRetireAt = 0; revealRetiring = false; revealExpiredId = null;
  revealResetCommands();
  localStorage.removeItem(lsKey(REVEAL_CACHE_KEY));
  localStorage.removeItem(lsKey(REVEAL_CHAMPION_KEY));
  revealPaint = REAL_PAINT;
  revealUi.ledger = {}; revealUi.once = {}; revealUi.lastLive = undefined;
}
// A signed-in phone of the given role, the camp's public node empty on a fake database, the screens live.
function bootUi(role) {
  resetReveal();
  freshState();
  const db = makeFakeRtdb();
  firebase = makeFakeFirebase(db);
  setMemberRole(role);
  serverTimeOffset = 0;
  fbConnected = true; remoteReady = true;
  state.ui.tab = 'now';
  return db;
}
function teardownUi() {
  resetReveal();
  Date.now = realDateNow;
  setMemberRole(null);
  firebase = undefined;
  fbConnected = false; remoteReady = false;
  state.ui.revealOpen = false;
}
// Put a reveal on the phone exactly as the server would have it, and let the screens paint it.
function showReveal(ctl, pub) {
  revealAccept('real', { ctl, pub: pub || null }, 'snapshot');
}
function el(id) { return document.getElementById(id); }
function rows(id) { return (el(id).innerHTML.match(/<div class="rv-row"[^>]*>/g) || []).map((r) => /data-state="([a-z]+)"/.exec(r)[1] + ':' + /data-key="([^"]+)"/.exec(r)[1]); }
// a team name with no digit in it, so "no number" can be asserted on text
function tname(tid) { return 'Zed' + 'abcdef'[Number(String(tid).slice(1))]; }

// Count every write the screens' roots take, so "an idle pass writes nothing" is a behaviour, not a source scan.
const WATCHED = ['now-reveal', 'now-reveal-started', 'now-reveal-count', 'now-reveal-list', 'now-reveal-remote', 'now-reveal-happening', 'now-reveal-hn-time',
  'now-reveal-hn-emoji', 'now-reveal-hn-label', 'now-reveal-hn-sub', 'tab-now', 'now-reveal-grid', 'now-reveal-grid-title', 'now-reveal-grid-sub',
  'now-reveal-grid-list', 'games-reveal-grid', 'games-reveal-grid-title', 'games-reveal-grid-sub', 'games-reveal-grid-list', 'now-champion',
  'now-champion-mark', 'now-champion-name', 'reveal-strip', 'reveal-strip-count', 'tab-dot-now', 'reveal-row', 'more-reveal-state', 'games-reveal-link'];
function watchWrites(ids) {
  const tally = { n: 0, what: [] };
  const undo = [];
  ids.forEach((id) => {
    const e = el(id);
    ['innerHTML', 'textContent'].forEach((p) => {
      const d = Object.getOwnPropertyDescriptor(e, p);
      Object.defineProperty(e, p, { configurable: true, get: d.get, set(v) { tally.n++; tally.what.push(id + '.' + p); d.set.call(e, v); } });
      undo.push(() => Object.defineProperty(e, p, d));
    });
    let hidden = e.hidden;
    Object.defineProperty(e, 'hidden', { configurable: true, get: () => hidden, set(v) { tally.n++; tally.what.push(id + '.hidden'); hidden = v; } });
    undo.push(() => { delete e.hidden; e.hidden = hidden; });
    const ds = e.dataset;
    e.dataset = new Proxy(ds, {
      set(t, k, v) { tally.n++; tally.what.push(id + '.data-' + String(k)); t[k] = v; return true; },
      deleteProperty(t, k) { tally.n++; tally.what.push(id + '.data-' + String(k)); delete t[k]; return true; },
    });
    undo.push(() => { e.dataset = ds; });
  });
  tally.stop = () => undo.forEach((u) => u());
  return tally;
}

// ── Now's live mirror ───────────────────────────────────────────────

test('a live reveal makes Now the mirror: still-to-come rows for the teams not shown, then the places shown, best first, each count in words', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  showReveal(mkCtl({ cur: 1, shown: 2, sa: T0 + 10000, at: T0 + 10000 }), mkPub(2));
  assert.equal(el('now-reveal').hidden, false, 'the mirror is up');
  assert.equal(el('tab-now').dataset.reveal, 'live', 'the one switch that puts the rest of Now away');
  const r = rows('now-reveal-list');
  assert.equal(r.length, N, 'one row per team, shown or still to come');
  assert.deepEqual(r.slice(0, N - 2), Array.from({ length: N - 2 }, (_, i) => 'still:still-' + i), 'the teams still to come first, no place numbers');
  assert.deepEqual(r.slice(N - 2), ['shown:g' + (N - 1), 'shown:g' + N], 'then the places shown, best first');
  const html = el('now-reveal-list').innerHTML;
  assert.ok(/<span>2 gold<\/span> · <span>1 silver<\/span> · <span>1 bronze<\/span>/.test(html), 'counts are words, each its own span');
  assert.ok(!/🥇|🥈|🥉|medal-disc|class="medal"/.test(html), 'never a medal disc');
  assert.equal((html.match(/data-onscreen/g) || []).length, 1, 'exactly one row is on the big screen');
  assert.ok(/data-key="g[0-9]+" data-state="shown" data-onscreen/.test(html));
  assert.equal(el('now-reveal-count').textContent, '2 of ' + N + ' shown');
  assert.equal(el('now-reveal-started').textContent, 'Started 7:31', 'a time, never a name');
  assert.ok(!/\bby\b/i.test(el('now-reveal-started').textContent));
  teardownUi();
});

test('the 3 s lag: the newest place is a "Look at the big screen" row where it will land, then the real row; Back never hides a place again', () => {
  bootUi('viewer');
  const sa = T0 + 10000;
  atTime(sa + 1000);
  showReveal(mkCtl({ cur: 1, shown: 2, sa, at: sa }), mkPub(2));
  let r = rows('now-reveal-list');
  assert.equal(r.filter((x) => x.indexOf('looking:') === 0).length, 1, 'one looking row');
  assert.deepEqual(r.slice(-2), ['looking:look', 'shown:g' + N], 'it sits between the teams still to come and the places shown');
  assert.equal(r.filter((x) => x.indexOf('still:') === 0).length, N - 2, 'the looking row stands in for one still-to-come team');
  const html = el('now-reveal-list').innerHTML;
  assert.ok(html.indexOf('Look at the big screen') >= 0 && html.indexOf('On the big screen now') >= 0);
  assert.ok(html.indexOf(tname('t' + (N - 2))) < 0, 'the withheld team is not in the markup at all');
  assert.equal(el('now-reveal-count').textContent, '1 of ' + N + ' shown', 'and the count does not include it');
  atTime(sa + 3100);
  revealTick('timer');
  r = rows('now-reveal-list');
  assert.deepEqual(r.slice(-2), ['shown:g' + (N - 1), 'shown:g' + N], 'three seconds later the place is a row');
  assert.ok(el('now-reveal-list').innerHTML.indexOf(tname('t' + (N - 2))) >= 0);
  // Back: cur moves to the earlier place, `sa` stays, so nothing is hidden and the tag moves
  showReveal(mkCtl({ cur: 0, shown: 2, sa, at: sa + 20000, seq: 5 }), mkPub(2));
  assert.equal(rows('now-reveal-list').filter((x) => x.indexOf('shown:') === 0).length, 2, 'both places stay');
  assert.ok(/data-key="g[0-9]+" data-state="shown" data-onscreen/.test(el('now-reveal-list').innerHTML) && (el('now-reveal-list').innerHTML.match(/data-onscreen/g) || []).length === 1);
  teardownUi();
});

test('a tie never shows in the count: still-to-come is one row per TEAM, a tie group is one row with every team and a "tie" tag', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  const pub = { g0: { place: N, e: { ['t' + (N - 1)]: ent('t' + (N - 1), 10, { nm: 'Lowa' }), ['t' + (N - 2)]: ent('t' + (N - 2), 10, { nm: 'Lowb' }) } } };
  showReveal(mkCtl({ cur: 0, shown: 1, sa: T0 + 10000 }), pub);
  assert.equal(rows('now-reveal-list').filter((x) => x.indexOf('still:') === 0).length, N - 2, 'two teams are shown: N-2 rows remain, whatever the group count');
  assert.ok(/<em class="rv-tie">tie<\/em>/.test(el('now-reveal-list').innerHTML));
  assert.equal(el('now-reveal-count').textContent, '2 of ' + N + ' shown');
  teardownUi();
});

test('your team is marked in its own row, and only there; a director\'s own team likewise; the remote opener is not offered to a counselor', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  state.followTeam = 't' + (N - 1);
  showReveal(mkCtl(), mkPub(2));
  const html = el('now-reveal-list').innerHTML;
  assert.equal((html.match(/rv-you/g) || []).length, 1, 'one "Your team" tag');
  const mineAt = html.indexOf('data-team="t' + (N - 1) + '"');
  assert.ok(mineAt >= 0 && html.slice(mineAt).indexOf('Your team') >= 0 && html.slice(0, mineAt).indexOf('Your team') < 0, 'in that team\'s row, after its mark and before no other');
  assert.equal(el('now-reveal-remote').hidden, true, 'a counselor is not offered the remote');
  state.followTeam = undefined;
  teardownUi();
});

test('what a row carries is laundered: a hostile team name is text, and a mark is the shipped crest or a flag, never a database string', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  const pub = mkPub(1);
  pub.g0.e['t' + (N - 1)].nm = '<img src=x onerror=alert(1)>';
  showReveal(mkCtl({ cur: 0, shown: 1 }), pub);
  const html = el('now-reveal-list').innerHTML;
  assert.ok(html.indexOf('<img src=x') < 0 && html.indexOf('&lt;img src=x') >= 0, 'escaped');
  assert.ok(!/<img[^>]*src="(?!images\/)/.test(html), 'every image is a shipped crest');
  // a node that is not exactly the shape yields no rows at all (fail closed)
  showReveal(Object.assign(mkCtl(), { id: 'bogus' }), mkPub(2));
  assert.equal(el('now-reveal').hidden, true, 'a foreign-shaped ctl is no reveal');
  teardownUi();
});

test('the mirror goes away at the final table, an ended reveal and an auto-ended one: Now is the ordinary Now with the grid under it', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  showReveal(mkCtl({ phase: 'table', cur: N - 1, shown: N, at: T0 + 50000, sa: T0 + 40000 }), mkPub(N));
  assert.equal(el('now-reveal').hidden, true);
  assert.ok(el('tab-now').dataset.reveal !== 'live');
  assert.equal(el('now-reveal-grid').hidden, false, 'the frozen grid takes its place');
  // forgotten live reveal: 61 minutes after its last command it counts as ended on every screen
  showReveal(mkCtl({ phase: 'live', cur: 1, shown: 2, at: T0 + 10000, sa: T0 + 10000 }), mkPub(2));
  assert.equal(el('now-reveal').hidden, false, 'live at +50 s');
  atTime(T0 + 10000 + 61 * 60 * 1000);
  revealTick('timer');
  assert.equal(el('now-reveal').hidden, true, 'a live reveal left alone for an hour is over');
  assert.equal(el('now-reveal-grid').hidden, false, 'and its places are the grid');
  teardownUi();
});

// ── the frozen grid ─────────────────────────────────────────────────

test('the grid: one row per revealed team (short name, counts on two lines, points), "Not revealed" for places an early End never showed, titled by the day', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  showReveal(mkCtl({ phase: 'ended', cur: 1, shown: 2, endKind: 'early', endedAt: T0 + 50000, at: T0 + 50000, sa: T0 + 10000 }), mkPub(2));
  ['now', 'games'].forEach((p) => {
    assert.equal(el(p + '-reveal-grid').hidden, false, p + ' shows the grid');
    const r = rows(p + '-reveal-grid-list');
    assert.equal(r.filter((x) => x.indexOf('unrevealed:') === 0).length, N - 2, 'one "Not revealed" row per team still hidden (a count of teams)');
    assert.equal(r.filter((x) => x.indexOf('shown:') === 0).length, 2);
    const html = el(p + '-reveal-grid-list').innerHTML;
    assert.ok(/<span>verse 4<\/span> · <span>cleanup 3<\/span> · <span>quick 2<\/span>/.test(html), 'the second line of the grid');
    assert.ok(html.indexOf('Not revealed') >= 0 && html.indexOf('Hidden until') < 0);
    assert.equal(el(p + '-reveal-grid-title').textContent, 'Tonight’s standings', 'before midnight');
    assert.equal(el(p + '-reveal-grid-sub').textContent, 'Revealed 7:31 PM · hides at 8 AM');
  });
  atTime(T0 + 6 * 3600 * 1000); // 1:31 AM
  revealTick('timer');
  assert.equal(el('now-reveal-grid-title').textContent, 'Last night’s standings', 'after midnight');
  teardownUi();
});

test('a director sees live standings, not the frozen grid; the mirror and the strip are theirs too', () => {
  bootUi('editor');
  atTime(T0 + 60000);
  showReveal(mkCtl({ phase: 'table', cur: N - 1, shown: N, at: T0 + 50000, sa: T0 + 40000 }), mkPub(N));
  assert.equal(el('now-reveal-grid').hidden, true);
  assert.equal(el('games-reveal-grid').hidden, true);
  showReveal(mkCtl({ cur: 1, shown: 2 }), mkPub(2));
  assert.equal(el('now-reveal').hidden, false, 'the same mirror as a counselor');
  teardownUi();
});

test('8 AM: the grid is emptied on its own (no snapshot, no render), an hidden tab included, and the champion line outlives it by name only', () => {
  bootUi('viewer');
  const until = untilFor(T0, false);
  atTime(until - 5000);
  showReveal(mkCtl({ phase: 'table', cur: N - 1, shown: N, finale: true, at: T0 + 50000, sa: T0 + 40000, until }), mkPub(N));
  assert.equal(el('now-reveal-grid').hidden, false);
  assert.equal(el('games-reveal-grid').hidden, false);
  assert.ok(el('now-reveal-grid-list').innerHTML.length > 0);
  state.ui.tab = 'chat';                                  // an inactive tab: nothing renders it
  atTime(until + 1000);
  revealTick('timer');                                    // the engine's own moment: no snapshot, no renderAll
  ['now', 'games'].forEach((p) => {
    assert.equal(el(p + '-reveal-grid').hidden, true, p + ' grid hidden at 8 AM');
    assert.equal(el(p + '-reveal-grid-list').innerHTML, '', p + ' grid emptied: no number is left on this phone\'s screen');
  });
  assert.equal(localStorage.getItem(lsKey(REVEAL_CACHE_KEY)), null, 'and none in its cache');
  assert.equal(el('now-champion').hidden, false, 'the crowned team\'s name is still there');
  assert.equal(el('now-champion-name').textContent, tname('t0'), 'by name');
  assert.ok(!/[0-9]/.test(el('now-champion-name').textContent + el('now-champion-mark').innerHTML.replace(/<[^>]*>/g, '')), 'no number, anywhere in its text');
  state.ui.tab = 'now';
  teardownUi();
});

// ── the strip, the dot, More, Games ─────────────────────────────────

test('the red strip shows on every tab but Now, only while places are being revealed, with the count patched in place; the dot rides the Now tab', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  state.ui.tab = 'games';
  showReveal(mkCtl({ cur: 1, shown: 2 }), mkPub(2));
  assert.equal(el('reveal-strip').hidden, false);
  assert.equal(el('reveal-strip-count').textContent, '2 of ' + N + ' shown');
  assert.equal(el('tab-dot-now').hidden, false, 'a reveal is live and you are elsewhere');
  state.ui.tab = 'now';
  renderRevealUi();
  assert.equal(el('reveal-strip').hidden, true, 'Now carries its own strip');
  assert.equal(el('tab-dot-now').hidden, true);
  state.ui.tab = 'more';
  showReveal(mkCtl({ phase: 'intro', cur: -1, shown: 0, at: T0 + 55000, sa: T0 + 55000 }), null);
  assert.equal(el('reveal-strip').hidden, false, 'live from the intro');
  assert.equal(el('reveal-strip-count').textContent, '', 'empty at the intro, so no separator dangles');
  showReveal(mkCtl({ phase: 'table', cur: N - 1, shown: N }), mkPub(N));
  assert.equal(el('reveal-strip').hidden, true, 'gone at the final table, on every tab');
  assert.equal(el('tab-dot-now').hidden, true);
  state.ui.tab = 'now';
  teardownUi();
});

test('More\'s row and Games\' link are directors\' only, in words, and never a count of screens', () => {
  bootUi('viewer');
  renderRevealUi();
  assert.equal(el('reveal-row').hidden, true, 'not a counselor\'s');
  assert.equal(el('games-reveal-link').hidden, true);
  setMemberRole('editor');
  atTime(T0 + 60000);
  renderRevealUi();
  assert.equal(el('reveal-row').hidden, !revealRemoteMayOpen());
  assert.equal(el('reveal-row').dataset.state, 'ready');
  assert.equal(el('more-reveal-state').textContent, 'Ready');
  showReveal(mkCtl({ cur: 1, shown: 2 }), mkPub(2));
  assert.equal(el('reveal-row').dataset.state, 'live');
  assert.equal(el('more-reveal-state').textContent, 'Live · 2 of ' + N + ' shown');
  assert.ok(!/screen[s ]*(open|connected|\d)/i.test(el('more-reveal-state').textContent), 'nothing about screens');
  showReveal(null);
  revealDenied = true;
  renderRevealUi();
  assert.equal(el('reveal-row').dataset.state, 'blocked');
  assert.equal(el('more-reveal-state').textContent, 'Not switched on yet');
  teardownUi();
});

test('the champion line is shown on Now to everyone but never beside the grid or over the live mirror, and ends with the camp week', () => {
  bootUi('viewer');
  const until = untilFor(T0, false);
  atTime(until + 60000);
  localStorage.setItem(lsKey(REVEAL_CHAMPION_KEY), JSON.stringify({ ver: 1, rid: 'r1kz9fxq-4hd2', at: until - 3600000, names: [{ id: 't0', name: 'Ferocious Foxes' }, { id: 't1', name: 'Turkey Dinner' }] }));
  renderRevealUi();
  assert.equal(el('now-champion').hidden, false);
  assert.equal(el('now-champion-name').textContent, 'Ferocious Foxes and Turkey Dinner');
  assert.ok(el('now-champion-mark').innerHTML.indexOf('data-team="t0"') >= 0 && el('now-champion-mark').innerHTML.indexOf('data-team="t1"') >= 0, 'one mark per team of a shared title');
  atTime(T0 + 60000);
  showReveal(mkCtl({ cur: 1, shown: 2 }), mkPub(2));
  assert.equal(el('now-champion').hidden, true, 'the surprise is not spoiled by a line over the live mirror');
  teardownUi();
});

test('a counselor with no reveal, and a hint-painted first frame, show nothing of the reveal at all', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  renderRevealUi();
  assert.equal(el('now-reveal').hidden, true);
  assert.equal(el('now-reveal-grid').hidden, true);
  assert.equal(el('now-champion').hidden, true);
  assert.equal(el('reveal-strip').hidden, true);
  assert.ok(el('tab-now').dataset.reveal !== 'live');
  assert.equal(el('now-reveal-list').innerHTML, '');
  teardownUi();
});

// ── secrecy ─────────────────────────────────────────────────────────

test('SECRECY: the phones\' screens read the reveal through revealView alone: no standings helper, no private freeze, no remote model', () => {
  const src = readFixture('../reveal-ui.js');
  const body = (name) => {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start > -1, name + ' exists');
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  ['renderRevealMirror', 'revealUiPaintGrid', 'renderRevealGrids', 'renderRevealChampion', 'renderRevealStrip', 'revealUiMirrorHtml', 'revealUiGridHtml', 'revealUiHappening']
    .forEach((fn) => {
      const code = body(fn).replace(/\/\/[^\n]*/g, '');
      assert.ok(!/medalCounts|rankTeamsByPoints|standingsVisible|bonusBreakdown|state\.results|state\.bonuses|revealFull|revealFreeze|revealRemoteModel|revealStartGate|confirmedReveal|revealRemoteView/.test(code),
        fn + ' reads no points helper, no private freeze and no confirmed store directly');
    });
  assert.ok(/revealLiveView\(\)/.test(body('renderRevealMirror')) && /revealGridView\(\)/.test(body('renderRevealGrids')) && /revealChampionLine\(\)/.test(body('renderRevealChampion')), 'the screens read the engine\'s view functions');
});

test('SECRECY: a counselor\'s phone never builds the remote\'s model, never opens the remote and never has it open on a forged history entry', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  let built = 0;
  const realModel = revealRemoteModel;
  revealRemoteModel = function () { built += 1; return realModel.apply(this, arguments); };
  try {
    showReveal(mkCtl({ cur: 1, shown: 2 }), mkPub(2));
    renderAll();
    assert.equal(built, 0, 'no remote model for a counselor');
    assert.equal(openReveal({ from: 'more' }), false, 'openReveal refuses');
    state.ui.revealOpen = true;                            // a stored flag, a forged entry
    renderAll();
    assert.equal(state.ui.revealOpen, false, 'renderAll puts it away');
    assert.equal(revealRemoteIsOpen(), false);
    assert.equal(built, 0);
  } finally { revealRemoteModel = realModel; }
  teardownUi();
});

test('SECRECY: nothing a viewer is shown while the newest place is held back mentions that place or any hidden team', () => {
  const db = bootUi('viewer');
  const sa = T0 + 10000;
  atTime(sa + 500);
  __sinkRec.on = true; __sinkRec.log.length = 0;
  showReveal(mkCtl({ cur: 1, shown: 2, sa, at: sa }), mkPub(2));
  const everything = __sinkRec.log.map((l) => l.text).join('\n') + '\n' + ['now-reveal-list', 'games-reveal-grid-list', 'now-reveal-grid-list'].map((id) => el(id).innerHTML).join('\n');
  __sinkRec.on = false;
  assert.ok(everything.indexOf(tname('t' + (N - 2))) < 0 && everything.indexOf('10 points') < 0 === true, 'the withheld place is not in any text the screens wrote');
  const words = everything.replace(/<[^>]*>/g, ' ');
  assert.ok(!new RegExp('\\b' + ordinal(N - 1) + '\\b').test(words), 'its place number is not written either');
  teardownUi();
});

// ── render stability ────────────────────────────────────────────────

test('an idle repaint of the screens writes nothing, with no reveal, a live one, and a finished one', () => {
  const states = [
    ['none', () => showReveal(null)],
    ['live', () => showReveal(mkCtl({ cur: 1, shown: 2, at: T0 + 10000, sa: T0 + 10000 }), mkPub(2))],
    ['table', () => showReveal(mkCtl({ phase: 'table', cur: N - 1, shown: N, at: T0 + 50000, sa: T0 + 40000 }), mkPub(N))],
  ];
  ['viewer', 'editor'].forEach((role) => {
    states.forEach(([label, set]) => {
      bootUi(role);
      atTime(T0 + 60000);
      set();
      renderRevealUi();
      const w = watchWrites(WATCHED);
      renderRevealUi();
      renderRevealUi();
      w.stop();
      assert.equal(w.n, 0, role + ' / ' + label + ': an unchanged reveal touches no node (' + w.what.slice(0, 5).join(', ') + ')');
      teardownUi();
    });
  });
});

test('a new place changes the list and its count and nothing else on the mirror', () => {
  bootUi('viewer');
  atTime(T0 + 60000);
  showReveal(mkCtl({ cur: 0, shown: 1, at: T0 + 10000, sa: T0 + 10000 }), mkPub(1));
  const w = watchWrites(WATCHED);
  showReveal(mkCtl({ cur: 1, shown: 2, seq: 5, at: T0 + 30000, sa: T0 + 30000 }), mkPub(2));
  atTime(T0 + 40000);
  revealTick('timer');
  w.stop();
  const touched = [...new Set(w.what)].sort();
  assert.deepEqual(touched.filter((x) => !/^(now-reveal-(list|count)|reveal-strip-count)\./.test(x)), [], 'only the list and the counts were written: ' + touched.join(', '));
  teardownUi();
});

test('rows are stable strings: keyed, no inline style, no animation class, no residue for a morph to trip over', () => {
  const v = { live: true, phase: 'live', id: 'x', startedAt: T0, until: T0 + 1e7, expired: false, finale: true, onScreen: 1, looking: false, remaining: 2, champion: [{ id: 't0', name: 'A' }],
    rows: [{ place: 1, tie: true, entries: [{ id: 't0', nm: 'A', p: 9, g: 1, s: 1, b: 1, v: 1, m: 1, c: 1 }, { id: 't1', nm: 'B', p: 9, g: 1, s: 1, b: 1, v: 1, m: 1, c: 1 }] }] };
  [revealUiMirrorHtml(v, 't1'), revealUiGridHtml(v, 't1')].forEach((html) => {
    const rowTags = html.match(/<div class="rv-row"[^>]*>/g) || [];
    assert.ok(rowTags.length >= 2 && rowTags.every((t) => /data-key="/.test(t)), 'every row is keyed');
    assert.ok(!/anim|transition|\bis-|joy-/.test(html.replace(/data-onscreen|data-champion/g, '')), 'no animation class');
    assert.equal((html.match(/style="/g) || []).length, (html.match(/<img[^>]*style="|<svg[^>]*style="|<span class="tm[^"]*"[^>]*style="/g) || []).length, 'the only inline styles are the marks\' own size variable');
  });
  assert.ok(/data-champion/.test(revealUiMirrorHtml(v, null)) && /rv-crown/.test(revealUiMirrorHtml(v, null)), 'a finale\'s 1st row wears the crown');
  assert.equal((revealUiMirrorHtml(v, 't1').match(/rv-you/g) || []).length, 1);
});

// ── markup pins ─────────────────────────────────────────────────────

test('every id the screens name is in index.html, and the new script is loaded after the engine it needs', () => {
  const src = readFixture('../reveal-ui.js');
  const html = readFixture('../index.html');
  const ids = new Set([...src.matchAll(/revealUiEl\('([^']+)'\)/g)].map((m) => m[1]));
  [...src.matchAll(/revealUiEl\(prefix \+ '(-[a-z-]+)'\)/g)].forEach((m) => ['now', 'games'].forEach((p) => ids.add(p + m[1])));
  [...src.matchAll(/(?:on|setTextIfChanged)\(\s*'([a-z-]+)'/g)].forEach((m) => ids.add(m[1]));
  ['reveal-practice-state', 'reveal-buzz-state'].forEach((i) => ids.add(i));
  assert.ok(ids.size > 25, 'the scan finds the hooks (' + ids.size + ')');
  const missing = [...ids].filter((id) => !new RegExp('id="' + id + '"').test(html));
  assert.deepEqual(missing, [], 'ids named in reveal-ui.js but absent from index.html');
  assert.ok(html.indexOf('reveal.js?v=') < html.indexOf('reveal-ui.js?v='), 'loaded after the engine');
  assert.ok(html.indexOf('reveal-ui.js?v=') < html.indexOf('setup-sync.js?v='), 'and before the setup engine');
});

test('without reveal.js the screens do nothing, and app.js runs without reveal-ui.js: every hook is typeof-guarded', () => {
  const vm = nodeRequire('vm');
  const { makeContext } = nodeRequire('./harness.js');
  [['reveal-ui.js'], ['reveal.js', 'reveal-ui.js']].forEach((without) => {
    let boot;
    assert.doesNotThrow(() => { boot = makeContext({ without, seeded: scheduleIsShared() }); }, 'loads without ' + without.join(' + '));
    assert.doesNotThrow(() => vm.runInContext('renderAll()', boot.ctx), 'a render without ' + without.join(' + '));
  });
  const app = readFixture('../app.js').replace(/\/\/[^\n]*/g, '');
  [...app.matchAll(/\b(renderRevealUi|renderRevealRemote|wireRevealUi|revealPaint|openReveal)\b\s*\(/g)].forEach((m) => {
    const before = app.slice(Math.max(0, m.index - 80), m.index);
    assert.ok(/typeof \w+ === 'function'|function (openReveal|renderRevealUi)\b|revealRemoteMayOpen/.test(before + m[0]) || m[1] === 'openReveal', 'a bare call to ' + m[1] + ' near: ' + before.slice(-50));
  });
});
