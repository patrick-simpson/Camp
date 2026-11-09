// reveal-ui.js + app.js's shell — the DIRECTOR'S REMOTE (redesign §4.2, §4.8; mockups 06, 07, 07b, 07c). Runs under both camp
// profiles (reveal-remote.senior.test.js evals this file). What the engine knows (the state machine, the compare-and-set, the
// recharge) is reveal.test.js; these cases pin what the remote SHOWS and DOES with it: how it is opened and closed through the
// shell's history, which panel and which dock state each phase paints, that the mini TV is tvFrame, that the ladder keeps the
// hidden places hidden, the masked peek, every confirm, the refused-tap wobble, and that an idle repaint writes nothing.

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const T0 = Date.parse('2027-06-23T23:31:00Z'); // a Wednesday, 7:31 PM EDT
const N = CAMP.teamCount;
const REAL_PAINT = revealPaint;
const realDateNow = Date.now;
let nowT = T0;
let toasts = [];
showToast = (m) => { toasts.push(String(m)); };
const realAsk = askDialog;
let asked = [];
let answers = [];
askDialog = async (o) => { asked.push(o); return answers.length ? answers.shift() : (o.actions.find((a) => !a.cancel) || {}).value; };

function el(id) { return document.getElementById(id); }
function tname(tid) { return 'Zed' + 'abcdef'[Number(String(tid).slice(1))]; }

function mkCtl(o) {
  return Object.assign({
    v: 1, id: 'r1kz9fxq-4hd2', seq: 3, phase: 'live', cur: 1, shown: 2, teams: N, finale: false,
    at: T0 - 20000, sa: T0 - 20000, ca: T0 - 600000, startedAt: T0 - 600000, until: untilFor(T0, false),
  }, o || {});
}
// groups in REVEAL order (idx 0 = last place), one team per group, a letter-only name per team and distinctive points
const PTS = [971, 863, 752, 641, 533, 427];
function groupsOf(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const tid = 't' + (n - 1 - i);
    out.push({ idx: i, place: n - i, entries: [{ id: tid, nm: tname(tid), p: PTS[n - 1 - i], g: 1, s: 1, b: 1, v: 1, m: 1, c: 1 }] });
  }
  return out;
}
function pubOf(shown) {
  const pub = {};
  groupsOf(N).slice(0, shown).forEach((g) => { pub['g' + g.idx] = { place: g.place, e: { [g.entries[0].id]: Object.assign({}, g.entries[0], { id: undefined }) } }; delete pub['g' + g.idx].e[g.entries[0].id].id; });
  return pub;
}

function resetReveal() {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
  if (revealUi.timer) { clearTimeout(revealUi.timer); revealUi.timer = null; }
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
  revealUi.ledger = {}; revealUi.once = {}; revealUi.lastLive = undefined; revealUi.seq = null; revealUi.peekOk = true;
  revealUi.go = { state: '', big: '', key: '' };
  state.ui.revealOpen = false; state.ui.revealFrom = undefined; state.ui.gameId = null;
}
async function bootDirector(role) {
  resetReveal();
  freshState();
  nowT = T0;
  Date.now = () => nowT;
  const db = makeFakeRtdb();
  db.now = () => nowT;
  firebase = makeFakeFirebase(db);
  setMemberRole(role || 'editor');
  authUser = { email: 'jenn@example.com' };
  serverTimeOffset = 0; serverOffsetKnown = true;
  fbConnected = true; remoteReady = true;
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false; pendingWrites = 0; remoteRefetchPending = false;
  state.results = {}; state.bonuses = {};
  state.teams.forEach((t, i) => { state.bonuses['b' + i] = { teamId: t.id, category: 'custom', label: 'x', points: PTS[i], at: Date.parse('2026-01-01') }; });
  state.ui.tab = 'more';
  toasts = []; asked = []; answers = [];
  initReveal();
  await waitQuiet();
  theDb = db; globalThis.__rvDb = db;
  return db;
}
function afterDirector() {
  authUser = null;
  resetReveal();
  Date.now = realDateNow;
  setMemberRole(null);
  firebase = undefined;
  fbConnected = false; remoteReady = false;
}
// A reveal exactly as the server holds it, in the fake database AND the confirmed store (the engine re-reads the node when
// the remote opens, so a node the database does not hold would be replaced by nothing), plus the director's private freeze.
let theDb = null;
async function setNode(ctlOver, shown, o) {
  o = o || {};
  const mode = o.mode || 'real';
  const ctl = mkCtl(Object.assign({ cur: shown - 1, shown }, ctlOver || {}));
  const groups = o.freeze ? revealFreezeGroups(revealFreezeRows()) : groupsOf(N);
  const g = {};
  groups.forEach((x, i) => { g['g' + i] = revealGroupWire(x); });
  theDb.serverSet(dbPath('revealPublic/' + mode), { ctl, pub: shown ? Object.fromEntries(Object.keys(g).slice(0, shown).map((k) => [k, g[k]])) : null });
  theDb.serverSet(dbPath('revealFull/' + mode), o.full === false ? null : { r: ctl.id, n: groups.length, frozenAt: T0, startedBy: o.by || identityKey(authUser), g });
  if (o.full === false) revealForgetFull(mode);
  // Wait for the listener's delivery itself, not for the clock to go quiet: a countdown timer on a frozen test clock re-arms
  // for ever (the engine's own warning about frozen clocks), and production time always moves on.
  await waitUntil(() => confirmedReveal[mode] && confirmedReveal[mode].ctl.id === ctl.id && confirmedReveal[mode].ctl.seq === ctl.seq, 'the listener to deliver the node');
  if (o.full !== false) await revealFetchFull(mode);
  revealLoaded.real = true; revealLoaded.practice = true;
  renderRevealUi();
  return ctl;
}
// Opens the remote and lets the engine's own opening reads (the whole public node, the private order) land before a test
// writes a node, or one of them would replace it with what the database held a moment earlier.
async function openRemote() {
  openReveal({ from: 'more' });
  await waitQuiet();
}
// every game today has a result, so a Start has nothing to warn about
function scoreEveryGameToday() {
  state.results = {};
  gamesForDay(revealDowOf(serverNow())).forEach((x) => x.games.forEach((g) => { state.results[g.id] = { placements: {} }; }));
}
async function clearNode(mode) {
  theDb.serverSet(dbPath('revealPublic/' + (mode || 'real')), null);
  await waitUntil(() => !confirmedReveal[mode || 'real'], 'the listener to deliver the removal');
}
function text(id) { return el(id).textContent; }
function data(id, k) { return el(id).dataset[k]; }

// ── how the remote is opened and closed: the shell ──────────────────

test('a director opens the remote from More: one history entry, labelled back, the takeover is up and the engine keeps the screen awake', async () => {
  await bootDirector();
  assert.equal(openReveal({ from: 'more' }), true);
  assert.equal(state.ui.revealOpen, true);
  assert.equal(revealRemoteIsOpen(), true);
  assert.equal(shellTakeoverOpen(), true, 'a takeover is up (the tab bar slides away, the page is inert)');
  assert.deepEqual(shellSnap().ov, [{ k: 'reveal', from: 'more' }]);
  assert.equal(shellRevealBackLabel(), 'More');
  assert.equal(el('takeover-reveal').hidden, false, 'painted');
  assert.equal(text('takeover-reveal-back-label'), 'More');
  assert.equal(revealRemoteOpen(), true, 'the engine knows the remote is open (wake lock, the private freeze)');
  closeReveal();
  assert.equal(state.ui.revealOpen, false);
  assert.equal(shellTakeoverOpen(), false);
  assert.equal(revealRemoteOpen(), false, 'closing lets the screen sleep and drops the private order');
  state.ui.revealFrom = 'games'; assert.equal(shellRevealBackLabel(), 'Games');
  state.ui.revealFrom = 'now'; assert.equal(shellRevealBackLabel(), 'Now');
  afterDirector();
});

test('the history is derived from state: opening pushes ONE entry on top of the tab, Back pops it, a snapshot without it closes the remote', async () => {
  await bootDirector();
  state.ui.tab = 'more';
  const from = { tab: 'more', ov: [] };
  const want = { tab: 'more', ov: [{ k: 'reveal', from: 'more' }] };
  assert.deepEqual(shellHistPlan(from, want).map((o) => o.op), ['push'], 'one push');
  assert.deepEqual(shellHistPlan(want, from).map((o) => o.op), ['back'], 'one pop');
  assert.deepEqual(shellHistPlan(null, want).map((o) => o.op), ['replace', 'push', 'push'], 'opened cold: tag Now, then the tab, then the remote');
  const s = shellSnapFromRaw({ campShell: 1, tab: 'more', ov: [{ k: 'reveal', from: 'more' }, { k: 'reveal', from: 'bogus' }] });
  assert.deepEqual(s.ov[0], { k: 'reveal', from: 'more' });
  assert.equal(s.ov[1].from, undefined, 'an unknown tab is dropped from the entry');
  openReveal({ from: 'more' });
  shellApply({ tab: 'more', ov: [] });                     // the phone's Back
  assert.equal(state.ui.revealOpen, false, 'Back closes the remote');
  shellApply(want);                                        // Forward
  assert.equal(state.ui.revealOpen, true, 'and Forward reopens it for a director');
  closeReveal();
  afterDirector();
});

test('one takeover at a time: opening a game closes the remote and opening the remote closes the game', async () => {
  await bootDirector();
  const g = allGames()[0];
  openReveal({ from: 'games' });
  openGame(g.id, { from: 'games' });
  assert.equal(state.ui.revealOpen, false);
  assert.equal(state.ui.gameId, g.id);
  openReveal({ from: 'games' });
  assert.equal(state.ui.gameId, null);
  assert.equal(state.ui.revealOpen, true);
  closeReveal();
  afterDirector();
});

test('the `reveal` deep link opens the remote for a director over Now and does nothing but land on Now for a counselor', async () => {
  await bootDirector();
  assert.deepEqual(shellParseTarget('#reveal'), { tab: 'now', reveal: true });
  assert.equal(shellOpenTarget('#reveal'), true);
  assert.equal(state.ui.tab, 'now');
  assert.equal(state.ui.revealOpen, true);
  assert.equal(shellRevealBackLabel(), 'Now');
  closeReveal();
  setMemberRole('viewer');
  assert.equal(shellOpenTarget('#reveal'), true);
  assert.equal(state.ui.revealOpen, false, 'a counselor is not given a remote');
  assert.equal(state.ui.tab, 'now');
  afterDirector();
});

test('a demotion (or a second tab) closes an open remote at the next render, and a long absence closes it unless a reveal is live', async () => {
  await bootDirector();
  openReveal({ from: 'more' });
  setMemberRole('viewer');
  renderAll();
  assert.equal(state.ui.revealOpen, false, 'a demoted director\'s remote is put away');
  setMemberRole('editor');
  await openRemote();
  shell.hiddenAt = Date.now() - 20 * 60 * 1000;
  shellResume();
  assert.equal(state.ui.revealOpen, false, 'back after twenty minutes with nothing live: Now, takeover closed');
  await openRemote();
  await setNode({}, 2);
  shell.hiddenAt = Date.now() - 20 * 60 * 1000;
  shellResume();
  assert.equal(state.ui.revealOpen, true, 'but a live reveal keeps the remote (the lock screen must not send a director home mid-show)');
  assert.equal(shellHasUnsentWork(), true);
  closeReveal();
  afterDirector();
});

test('the remote closes on Escape like the game, and the roof follows it (the status bar is the camp blue while it is up)', async () => {
  const src = readFixture('../app.js');
  assert.ok(/else if \(!top && revealRemoteIsOpen\(\)\) closeReveal\(\)/.test(src), 'Escape closes the remote');
  assert.ok(/#takeover-reveal \[data-takeover-back\]/.test(src), 'its labelled back is wired');
  const ui = readFixture('../reveal-ui.js');
  assert.ok(/revealUiRoofSync\(\)/.test(ui) && /shell\.roof !== roofUp\(\)/.test(ui), 'the chrome colour is re-derived when the takeover shows or hides');
  assert.ok(/class="takeover is-roof reveal-remote"/.test(readFixture('../index.html')), 'a roof takeover');
});

// ── what each phase paints ──────────────────────────────────────────

test('the stage follows the phase: ready, intro, a place, the crown, the table, ended; the chip says it in words', async () => {
  await bootDirector();
  await openRemote();
  assert.equal(data('takeover-reveal', 'phase'), 'ready');
  assert.equal(data('reveal-chip', 'tone'), 'ready'); assert.equal(text('reveal-chip-text'), 'Ready');
  await setNode({ phase: 'intro', cur: -1, shown: 0, at: T0 - 1000 }, 0); renderRevealRemote();
  assert.equal(data('takeover-reveal', 'phase'), 'intro');
  assert.equal(data('reveal-chip', 'tone'), 'live'); assert.equal(text('reveal-chip-text'), 'Live');
  await setNode({}, 2); renderRevealRemote();
  assert.equal(data('takeover-reveal', 'phase'), 'live');
  assert.equal(text('reveal-count'), '2 of ' + N + ' shown');
  await setNode({ phase: 'champion', cur: N - 1, shown: N, finale: true }, N); renderRevealRemote();
  assert.equal(data('takeover-reveal', 'phase'), 'champion');
  await setNode({ phase: 'table', cur: N - 1, shown: N, finale: true }, N); renderRevealRemote();
  assert.equal(data('takeover-reveal', 'phase'), 'table');
  await setNode({ phase: 'ended', endedAt: T0 - 5000, endKind: 'done', cur: N - 1, shown: N }, N); renderRevealRemote();
  assert.equal(data('takeover-reveal', 'phase'), 'ended');
  assert.equal(data('reveal-chip', 'tone'), 'ended'); assert.equal(text('reveal-chip-text'), 'Ended');
  assert.equal(el('reveal-ended').hidden, false);
  assert.equal(text('reveal-ended-title'), 'Last reveal ended 7:30 PM');
  assert.equal(text('reveal-ended-sub'), 'Counselors see it until 8 AM tomorrow');
  revealDenied = true; renderRevealRemote();
  assert.equal(data('takeover-reveal', 'phase'), 'off', 'rules not published');
  assert.equal(text('reveal-chip-text'), 'Not on yet');
  closeReveal();
  afterDirector();
});

test('the dock: every button state of mockup 07c, in words, and neither button ever takes `disabled`', async () => {
  await bootDirector();
  await openRemote();
  const go = () => [data('reveal-go', 'state'), text('reveal-go-k'), text('reveal-go-m'), data('reveal-go', 'face') || ''];
  const back = () => [data('reveal-back', 'state'), text('reveal-back-sub')];
  // ready (a place has been shown and the beat is over)
  await setNode({ at: T0 - 20000 }, 2); renderRevealRemote();
  assert.deepEqual(go(), ['ready', 'Reveal', ordinal(N - 2) + ' place', '']);
  assert.deepEqual(back(), ['ready', 'show ' + ordinal(N) + ' again']);
  // recharging: the wait is on the face and Back is locked for the same beat (the clock is put back into the beat)
  nowT = T0 - 20000 + 1200; renderRevealRemote();
  assert.equal(data('reveal-go', 'state'), 'charging');
  assert.equal(text('reveal-go-k'), 'Showing the name… 2');
  assert.equal(text('reveal-go-m'), ordinal(N - 2) + ' place next');
  assert.deepEqual(back(), ['locked', 'after the score']);
  nowT = T0 - 20000 + 3500; renderRevealRemote();
  assert.equal(text('reveal-go-k'), 'Showing the score… 1');
  nowT = T0 - 20000 + 4600; renderRevealRemote();
  assert.equal(data('reveal-go', 'state'), 'ready', 'ready again at 4.5 s');
  // the crown on a finale, then the table
  nowT = T0;
  await setNode({ phase: 'live', cur: N - 1, shown: N, finale: true, at: T0 - 20000 }, N); renderRevealRemote();
  assert.deepEqual(go().slice(0, 3), ['ready', dayLabel(finaleDow()) + ' finale', 'Crown the champions']);
  assert.equal(data('reveal-go', 'face'), 'crown');
  await setNode({ phase: 'champion', cur: N - 1, shown: N, finale: true, at: T0 - 20000 }, N); renderRevealRemote();
  assert.deepEqual(go().slice(0, 3), ['ready', 'Next', 'Show the final table']);
  assert.deepEqual(back(), ['ready', 'show 1st again']);
  await setNode({ phase: 'table', cur: N - 1, shown: N, finale: true, at: T0 - 20000 }, N); renderRevealRemote();
  assert.deepEqual(go().slice(0, 3), ['ready', 'All places shown', 'End the reveal']);
  assert.deepEqual(back(), ['ready', 'champions']);
  // offline: both buttons say why, and nothing can be sent
  fbConnected = false; renderRevealRemote();
  assert.deepEqual(go().slice(0, 3), ['offline', 'Reconnecting…', 'Your taps would not reach the big screen']);
  assert.equal(data('reveal-back', 'state'), 'offline');
  fbConnected = true;
  // at the first place Back is pressed flat, and places that are not loaded yet say so rather than offer a tap that fails
  await setNode({ cur: 0 }, 1); renderRevealRemote();
  assert.equal(data('reveal-back', 'state'), 'first');
  await setNode({ at: T0 - 20000 }, 2, { full: false }); renderRevealRemote();
  assert.equal(data('reveal-go', 'state'), 'blocked');
  assert.equal(text('reveal-go-k'), 'Loading the places…');
  // aria-disabled, never the disabled attribute
  const src = readFixture('../reveal-ui.js');
  assert.ok(!/toggleAttribute\('disabled'[^)]*\)/.test(src.slice(src.indexOf('function revealUiPaintDock'), src.indexOf('function revealUiPaintRoof'))), 'the dock never takes disabled');
  closeReveal();
  afterDirector();
});

test('a tie reads "(tie)" on the big button and a tie row has several teams under one place', async () => {
  await bootDirector();
  await openRemote();
  // a two-team tie for 2nd; the places before it are shown, so the next one to reveal is the tie
  const rows = [];
  for (let i = 0; i < N; i++) rows.push({ id: 't' + i, nm: tname('t' + i), p: i === 1 || i === 2 ? 800 : PTS[i], g: i === 1 ? 1 : 0, s: 0, b: 0, v: 0, m: 0, c: 0 });
  const groups = groupPlaces(rows).slice().reverse();      // reveal order: the last place first, the tie second to last
  const tieAt = groups.findIndex((x) => x.entries.length === 2);
  assert.equal(tieAt, groups.length - 2, 'the freeze has a tie for 2nd');
  const g = {};
  groups.forEach((x, i) => { g['g' + i] = revealGroupWire(x); });
  const shown = tieAt;
  const ctl = mkCtl({ cur: shown - 1, shown, at: T0 - 20000 });
  theDb.serverSet(dbPath('revealPublic/real'), { ctl, pub: Object.fromEntries(Object.keys(g).slice(0, shown).map((k) => [k, g[k]])) });
  theDb.serverSet(dbPath('revealFull/real'), { r: ctl.id, n: groups.length, frozenAt: T0, startedBy: identityKey(authUser), g });
  await waitUntil(() => confirmedReveal.real && confirmedReveal.real.ctl.seq === ctl.seq, 'the node');
  await revealFetchFull('real');
  renderRevealUi();
  assert.equal(text('reveal-go-m'), '2nd place (tie)');
  assert.ok(/<em class="rv-tie">tie<\/em>/.test(el('reveal-ladder').innerHTML), 'the next row carries the tie tag');
  closeReveal();
  afterDirector();
});

test('the mini TV is tvFrame: waiting, intro, a place\'s hero (the name alone, then the score), the docked board, the champions, the final table', async () => {
  await bootDirector();
  await openRemote();
  assert.equal(data('reveal-tv', 'frame'), 'waiting');
  assert.equal(text('reveal-tv-now'), 'Waiting for the directors…');
  await setNode({ phase: 'intro', cur: -1, shown: 0, at: T0 - 1000 }, 0); renderRevealRemote();
  assert.equal(data('reveal-tv', 'frame'), 'intro');
  await setNode({ at: T0 - 1000, sa: T0 - 1000 }, 2); renderRevealRemote();
  assert.equal(data('reveal-tv', 'frame'), 'hero');
  assert.equal(data('reveal-tv', 'beat'), 'name', 'the name alone for the first three seconds');
  assert.equal(text('mtv-hero-place'), ordinal(N - 1) + ' place');
  assert.equal(text('mtv-hero-name'), tname('t' + (N - 2)));
  assert.equal(text('reveal-tv-now'), ordinal(N - 1) + ' place on the big screen');
  nowT = T0 - 1000 + 3500; renderRevealRemote();
  assert.equal(data('reveal-tv', 'beat'), 'score');
  assert.equal(text('mtv-hero-points'), String(PTS[N - 2]));
  nowT = T0 - 1000 + 5000; renderRevealRemote();
  assert.equal(data('reveal-tv', 'beat'), 'breakdown');
  assert.equal(text('mtv-hero-break'), '1 gold · 1 silver · 1 bronze');
  nowT = T0 - 1000 + 9000; renderRevealRemote();
  assert.equal(data('reveal-tv', 'frame'), 'board', 'then the team docks into the board');
  assert.ok(el('mtv-board').innerHTML.indexOf(tname('t' + (N - 1))) >= 0 && el('mtv-board').innerHTML.indexOf(tname('t' + (N - 2))) >= 0);
  nowT = T0;
  await setNode({ phase: 'champion', cur: N - 1, shown: N, finale: true, at: T0 - 1000 }, N); renderRevealRemote();
  assert.equal(data('reveal-tv', 'frame'), 'champion');
  assert.equal(text('mtv-champ-name'), tname('t0'));
  await setNode({ phase: 'table', cur: N - 1, shown: N, at: T0 - 1000 }, N); renderRevealRemote();
  assert.equal(data('reveal-tv', 'frame'), 'table');
  assert.equal(text('mtv-board-title'), 'Final standings');
  await setNode({ phase: 'ended', endedAt: T0 - 500 }, N); renderRevealRemote();
  assert.equal(data('reveal-tv', 'frame'), 'waiting', 'ended goes back to waiting, like the big screen');
  closeReveal();
  afterDirector();
});

test('the mini TV is a picture of the big screen: a shown place draws its own look (photo, colour, number tile), Waiting and the intro the printed look, hostile values inert', async () => {
  await bootDirector();
  await openRemote();
  const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const brand = (g, o) => { g.entries[0] = Object.assign({}, g.entries[0], o); };
  // Waiting and the intro: the camp's printed marks, whatever any team has picked
  await setNode({ phase: 'intro', cur: -1, shown: 0, at: T0 - 1000 }, 0); renderRevealRemote();
  assert.ok(!/tm-photo|data-num/.test(el('mtv-intro-marks').innerHTML + el('mtv-wait-marks').innerHTML), 'no team look before a place is shown');
  // a shown place: the node carries the look in its entry
  const ctl = mkCtl({ cur: 0, shown: 1, at: T0 - 1000, sa: T0 - 1000 });
  const top = groupsOf(N)[0];
  const e0 = top.entries[0];
  const wire = (extra) => ({ place: top.place, e: { [e0.id]: Object.assign({ nm: e0.nm, p: e0.p, g: 1, s: 1, b: 1, v: 1, m: 1, c: 1 }, extra) } });
  const put = async (extra) => {
    theDb.serverSet(dbPath('revealPublic/real'), { ctl: Object.assign({}, ctl, { seq: ctl.seq + 1 }), pub: { g0: wire(extra) } });
    ctl.seq += 1;
    await waitUntil(() => confirmedReveal.real && confirmedReveal.real.ctl.seq === ctl.seq, 'the node');
    renderRevealRemote();
    return el('mtv-hero-marks').innerHTML;
  };
  let h = await put({ ph: PHOTO });
  assert.ok(/class="tm tm-shield tm-photo"/.test(h) && h.indexOf(PHOTO) > 0, 'a photo is the mark');
  h = await put({ pl: true, em: '4\uFE0F\u20E3', k: 'teal' });
  assert.ok(/tm-tile" data-num="4"/.test(h) && /--tm-accent:#[0-9a-f]{6}/i.test(h) && !/<img/.test(h), 'a cleared team is its number tile with its colour edge, no shield');
  h = await put({ k: 'purple' });
  assert.ok(/<img class="tm tm-shield"/.test(h) || /data-flag/.test(h), 'a colour alone keeps the printed shield or flag');
  h = await put({ ph: 'https://evil.example/x.png', k: 'red"><script>', em: '<b>x</b>', pl: 'yes' });
  assert.ok(!/evil|<script|<b>/.test(h), 'hostile values never reach the markup: ' + h);
  closeReveal();
  afterDirector();
});

test('the ladder: 1st at the top, hidden places named by place and nothing else, ONE masked next row, shown places with their team', async () => {
  await bootDirector();
  await openRemote();
  await setNode({ at: T0 - 20000 }, 2); renderRevealRemote();
  const html = el('reveal-ladder').innerHTML;
  const keys = (html.match(/<div class="rv-row"[^>]*>/g) || []).map((r) => /data-state="([a-z]+)"/.exec(r)[1]);
  assert.deepEqual(keys, [].concat(Array(N - 3).fill('hidden'), ['next', 'shown', 'shown']), 'best place first: hidden, the masked next, then what is on the big screen');
  const hiddenRows = (html.match(/data-state="hidden"[\s\S]*?<\/div>/g) || []).join('');
  PTS.slice(0, N - 3).forEach((p) => assert.ok(hiddenRows.indexOf(String(p)) < 0, 'a hidden place carries no points'));
  for (let i = 0; i < N - 3; i++) assert.ok(hiddenRows.indexOf(tname('t' + i)) < 0, 'a hidden place carries no team');
  assert.ok(/Hidden until you reveal it/.test(html));
  assert.ok(/Up next · only on this phone/.test(html) && /Press and hold to peek/.test(html), 'the next row is masked');
  assert.equal((html.match(/data-onscreen/g) || []).length, 1, 'one row on the big screen');
  assert.ok(/rv-os">On the big screen now/.test(html));
  assert.ok(!/rv-you|rv-medals/.test(html), 'the compact ladder carries no counts');
  closeReveal();
  afterDirector();
});

test('before the private order is read the ladder shows hidden rows with no place numbers and no peek, rather than guess', async () => {
  await bootDirector();
  await openRemote();
  await setNode({ at: T0 - 20000 }, 2, { full: false }); renderRevealRemote();
  const keys = (el('reveal-ladder').innerHTML.match(/data-state="([a-z]+)"/g) || []).map((x) => x.slice(12, -1));
  assert.deepEqual(keys, [].concat(Array(N - 2).fill('hidden'), ['shown', 'shown']));
  assert.ok(el('reveal-ladder').innerHTML.indexOf('data-state="next"') < 0, 'nothing to peek at yet');
  closeReveal();
  afterDirector();
});

test('the peek: the masked row shows while held and is masked again at once during the big screen\'s beat and when a new command lands; the LIST holds the attribute', async () => {
  await bootDirector();
  await openRemote();
  await setNode({ at: T0 - 20000 }, 2); renderRevealRemote();
  assert.equal(revealUi.peekOk, true, 'the beat is over');
  revealUiPeek(true);
  assert.equal('peek' in el('reveal-ladder').dataset, true, 'peeking: the list carries data-peek');
  const rowsBefore = el('reveal-ladder').innerHTML;
  assert.ok(rowsBefore.indexOf(tname('t' + (N - 3))) >= 0, 'the next team is in the row (a director\'s own phone)');
  revealUiPeek(false);
  assert.equal('peek' in el('reveal-ladder').dataset, false);
  assert.equal(el('reveal-ladder').innerHTML, rowsBefore, 'peeking never changes the row\'s markup (a rewrite would cut the hold off)');
  // during the beat the mask cannot be lifted, and the row says so
  await setNode({ at: T0 - 1000, seq: 9 }, 3); renderRevealRemote();
  assert.equal(revealUi.peekOk, false);
  revealUiPeek(true);
  assert.equal('peek' in el('reveal-ladder').dataset, false, 'a hold during a beat does nothing');
  assert.ok(/Masked while the big screen plays/.test(el('reveal-ladder').innerHTML));
  // a peek in progress is put away when a new command lands
  nowT = T0 + 9000; renderRevealRemote();
  revealUiPeek(true);
  assert.equal('peek' in el('reveal-ladder').dataset, true);
  await setNode({ at: nowT - 20000, seq: 10 }, 3); renderRevealRemote();
  nowT = T0;
  closeReveal();
  afterDirector();
});

test('the ready screen: the checks say what they found (a warning for an unscored game, never a gate), the switches say their state in words', async () => {
  const realCfg = pushConfigured;
  pushConfigured = () => false;                               // phone alerts not live (as before Step 27)
  await bootDirector();
  await openRemote();
  renderRevealRemote();
  assert.equal(data('reveal-check-phone', 'tone'), 'ok');
  assert.equal(text('reveal-check-phone-title'), 'This phone is up to date');
  assert.equal(text('reveal-screen-path'), CAMP.id === 'senior' ? 'current-standings.html?camp=senior' : 'current-standings.html');
  assert.equal(text('reveal-practice-state'), 'Off');
  assert.equal(data('reveal-opt-buzz', 'off'), '', 'Buzz is greyed until phone alerts are live');
  assert.equal(text('reveal-buzz-sub'), 'Phone alerts are not switched on yet.');
  assert.equal(text('reveal-buzz-state'), 'Off');
  pendingWrites = 2; renderRevealRemote();
  assert.equal(data('reveal-check-phone', 'tone'), 'wait', 'a phone with scores still to send is not caught up');
  assert.equal(text('reveal-check-phone-sub'), 'Sending scores…');
  assert.equal(data('reveal-go', 'state'), 'blocked');
  assert.equal(text('reveal-go-k'), 'Waiting for this phone to catch up…');
  pendingWrites = 0;
  const g = gamesForDay(revealDowOf(serverNow()));
  const names = [].concat(...g.map((x) => x.games.map((y) => y.name || y.id)));
  renderRevealRemote();
  if (names.length) {
    assert.equal(data('reveal-check-scored', 'tone'), 'warn');
    assert.ok(text('reveal-check-scored-title').indexOf(names.length === 1 ? names[0] : names.length + ' games') === 0, text('reveal-check-scored-title'));
  }
  revealSetPractice(true); renderRevealRemote();
  assert.equal(data('takeover-reveal', 'mode'), 'practice');
  assert.equal(text('reveal-chip-text'), 'Practice');
  assert.equal(text('reveal-go-m'), 'Start a practice');
  assert.equal(text('reveal-practice-state'), 'On');
  assert.equal(text('reveal-buzz-sub'), 'Practice runs never buzz phones.');
  assert.equal(data('reveal-opt-buzz', 'off'), '');
  closeReveal();
  afterDirector();
  pushConfigured = realCfg;
});

test('another director\'s reveal says who started it, by first name from the member list and never from the public node; the starter\'s own phone says nothing', async () => {
  await bootDirector();
  memberDirectory = { 'pat@example,com': { role: 'editor', name: 'Pat Jones' } }; memberDirectoryLoaded = true;
  await openRemote();
  await setNode({ at: T0 - 20000 }, 2, { by: 'pat@example,com' }); renderRevealRemote();
  assert.equal(el('reveal-started').hidden, false);
  assert.equal(text('reveal-started'), 'Started by Pat at 7:21 PM');
  await setNode({ at: T0 - 20000 }, 2, { by: 'stranger@example,com' }); renderRevealRemote();
  assert.equal(text('reveal-started'), 'Started by another director at 7:21 PM');
  await setNode({ at: T0 - 20000 }, 2, { by: identityKey(authUser) }); renderRevealRemote();
  assert.equal(el('reveal-started').hidden, true);
  const pubText = JSON.stringify(confirmedReveal.real);
  assert.ok(pubText.indexOf('pat@example') < 0, 'the public node carries no member key');
  memberDirectory = null; memberDirectoryLoaded = false;
  closeReveal();
  afterDirector();
});

test('"Scores changed since you started" shows at the intro only, with Start again', async () => {
  await bootDirector();
  await openRemote();
  await setNode({ phase: 'intro', cur: -1, shown: 0, at: T0 - 1000 }, 0, { freeze: true }); renderRevealRemote();
  assert.equal(el('reveal-stale').hidden, true, 'the freeze is still tonight\'s standings');
  state.bonuses.b0.points += 100;                           // a score saved after the freeze
  renderRevealRemote();
  assert.equal(el('reveal-stale').hidden, false);
  await setNode({ phase: 'live', cur: 0, shown: 1 }, 1, { freeze: true }); renderRevealRemote();
  assert.equal(el('reveal-stale').hidden, true, 'never once a place is out');
  closeReveal();
  afterDirector();
});

test('the screen\'s own clock: the countdown\'s next second, the end of every beat and the quiet window after a reconnect each re-arm one timer', async () => {
  await bootDirector();
  await openRemote();
  await setNode({ at: T0 - 1200 }, 2);
  const m = revealRemoteModel();
  const wait = revealUiNextMoment(m);
  assert.ok(wait > 0 && wait <= 1100, 'the next second of the name countdown: ' + wait);
  const lateModel = Object.assign({}, m, { charge: { left: 0, total: 4500, kind: null, secs: 0 } });
  assert.ok(revealUiNextMoment(lateModel) > 0, 'the beat boundaries are moments too');
  await setNode({ at: T0 - 60000 }, 2);
  assert.equal(revealUiNextMoment(revealRemoteModel()), null, 'a place long on screen needs no timer');
  closeReveal();
  assert.equal(revealUi.timer, null, 'and closing the remote clears it');
  afterDirector();
});

test('an idle repaint of the open remote writes nothing, in every stage', async () => {
  await bootDirector();
  await openRemote();
  const ids = [...new Set([...readFixture('../reveal-ui.js').matchAll(/revealUiEl\('([^']+)'\)/g)].map((m) => m[1]))].filter((i) => /^(takeover-reveal|reveal-|mtv-)/.test(i));
  const stages = [
    ['ready', async () => { await clearNode('real'); }],
    ['intro', () => setNode({ phase: 'intro', cur: -1, shown: 0, at: T0 - 20000 }, 0)],
    ['live', () => setNode({ at: T0 - 20000 }, 3)],
    ['champion', () => setNode({ phase: 'champion', cur: N - 1, shown: N, finale: true, at: T0 - 20000 }, N)],
    ['ended', () => setNode({ phase: 'ended', endedAt: T0 - 20000, at: T0 - 20000 }, N)],
  ];
  for (const [label, set] of stages) {
    await set();
    renderRevealRemote();
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
      e.dataset = new Proxy(ds, { set(t, k, v) { tally.n++; tally.what.push(id + '.data-' + String(k)); t[k] = v; return true; }, deleteProperty(t, k) { tally.n++; tally.what.push(id + '.data-' + String(k)); delete t[k]; return true; } });
      undo.push(() => { e.dataset = ds; });
    });
    renderRevealRemote(); renderRevealRemote();
    undo.forEach((u) => u());
    assert.equal(tally.n, 0, label + ': an unchanged remote touches no node (' + tally.what.slice(0, 5).join(', ') + ')');
  }
  closeReveal();
  afterDirector();
});

// ── the taps ────────────────────────────────────────────────────────

test('Start: a real Start over last night\'s asks first, a practice never does, and "Keep tonight\'s" sends nothing', async () => {
  await bootDirector();
  await openRemote();
  scoreEveryGameToday();
  // a practice: nothing real is replaced, so nothing is asked
  revealSetPractice(true);
  let r = await revealUiStartFlow(revealRemoteModel());
  assert.equal(asked.length, 0, 'a practice over nothing asks nothing');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(confirmedReveal.practice && confirmedReveal.practice.ctl.phase, 'intro');
  assert.equal(confirmedReveal.real, null, 'a practice never touches real');
  r = await revealEnd({ mode: 'practice', quiet: true });
  assert.equal(r.ok, true);
  assert.equal(confirmedReveal.practice, null, 'End practice deletes it');
  revealSetPractice(false);
  // a real Start over a finished reveal asks, and "Keep tonight's" sends nothing
  await setNode({ phase: 'ended', endedAt: T0 - 20000, at: T0 - 20000, cur: N - 1 }, N); renderRevealRemote();
  assert.equal(data('takeover-reveal', 'phase'), 'ended');
  const idBefore = confirmedReveal.real.ctl.id;
  answers = ['keep'];
  r = await revealUiStartFlow(revealRemoteModel());
  assert.equal(r.code, 'cancelled');
  assert.equal(asked[0].title, 'Start a new reveal?');
  assert.deepEqual(asked[0].actions.map((a) => a.label), ['Keep tonight’s', 'Start a new reveal']);
  assert.equal(confirmedReveal.real.ctl.id, idBefore, 'nothing was written');
  answers = ['start'];
  asked = [];
  r = await revealUiStartFlow(revealRemoteModel());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(confirmedReveal.real.ctl.id !== idBefore, 'a new reveal replaced it');
  assert.equal(confirmedReveal.real.ctl.phase, 'intro');
  closeReveal();
  afterDirector();
});

test('while a practice plays the remote follows it, so it offers the real Start: the practice stays, the real reveal starts, last night\'s grid asks first', async () => {
  await bootDirector();
  await openRemote();
  scoreEveryGameToday();
  assert.equal(el('reveal-offer').hidden, true, 'no practice, no offer');
  revealSetPractice(true);
  let r = await revealUiStartFlow(revealRemoteModel());
  assert.equal(r.ok, true, JSON.stringify(r));
  renderRevealRemote();
  assert.equal(data('takeover-reveal', 'mode'), 'practice', 'a live practice is what the remote follows');
  assert.equal(el('reveal-offer').hidden, false, 'so the real Start is one tap away');
  assert.ok(/id="reveal-start-real">Start the real reveal</.test(readFixture('../index.html')), 'a verb on the button');
  const practiceId = confirmedReveal.practice.ctl.id;
  asked = [];
  r = await revealUiStartReal();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(asked.length, 0, 'nothing real to replace: nothing is asked');
  assert.equal(confirmedReveal.real.ctl.phase, 'intro', 'the real reveal started');
  assert.equal(confirmedReveal.practice.ctl.id, practiceId, 'the practice stays in its own child, untouched');
  renderRevealRemote();
  assert.equal(data('takeover-reveal', 'mode'), 'real', 'the remote now follows the real reveal (real wins)');
  assert.equal(el('reveal-offer').hidden, true, 'and the offer is gone');
  closeReveal();
  afterDirector();

  // last night's reveal is still on counselors' phones: the real Start asks first, and "Keep tonight's" sends nothing
  await bootDirector();
  await openRemote();
  scoreEveryGameToday();
  await setNode({ phase: 'ended', endedAt: T0 - 20000, at: T0 - 20000, cur: N - 1 }, N);
  revealSetPractice(true);
  r = await revealUiStartFlow(revealRemoteModel());
  assert.equal(r.ok, true, JSON.stringify(r));
  renderRevealRemote();
  assert.equal(el('reveal-offer').hidden, false);
  const lastNight = confirmedReveal.real.ctl.id;
  asked = []; answers = ['keep'];
  r = await revealUiStartReal();
  assert.equal(r.code, 'cancelled');
  assert.equal(asked[0].title, 'Start a new reveal?');
  assert.equal(confirmedReveal.real.ctl.id, lastNight, 'nothing was written');
  closeReveal();
  afterDirector();
});

test('Start with a game that has no score asks "Start anyway?" and "Not now" leaves the screen as it was; Start again skips every question', async () => {
  await bootDirector();
  await openRemote();
  const games = [].concat(...gamesForDay(revealDowOf(serverNow())).map((x) => x.games));
  if (!games.length) { closeReveal(); afterDirector(); return; }
  state.results = {};
  answers = ['wait'];
  let r = await revealUiStartFlow(revealRemoteModel());
  assert.equal(r.code, 'cancelled');
  assert.equal(asked.length, 1);
  assert.ok(/no score yet/.test(asked[0].title));
  assert.deepEqual(asked[0].actions.map((a) => a.label), ['Not now', 'Start anyway']);
  assert.equal(confirmedReveal.real, null, 'nothing started');
  asked = []; answers = ['start'];
  r = await revealUiStartFlow(revealRemoteModel());
  assert.equal(r.ok, true, JSON.stringify(r));
  asked = [];
  r = await revealUiStartFlow(revealRemoteModel(), { again: true });
  assert.equal(asked.length, 0, 'Start again after "scores changed" asks nothing');
  assert.equal(r.ok, true);
  closeReveal();
  afterDirector();
});

test('a tap during the wait sends nothing, wobbles the button once and says why; End asks first and "Keep showing" ends nothing', async () => {
  await bootDirector();
  await openRemote();
  await setNode({ at: T0 - 1000 }, 2); renderRevealRemote();
  let wobbled = 0;
  const realRefused = revealUiRefused;
  revealUiRefused = () => { wobbled += 1; };
  try {
    const before = JSON.stringify(confirmedReveal.real);
    const r = await revealUiGo({ clientX: 10, clientY: 10 });
    assert.equal(r.code, 'wait');
    assert.equal(wobbled, 1, 'one wobble');
    assert.ok(toasts.some((t) => /^Wait \d s\. The big screen is still showing /.test(t)), toasts.join(' | '));
    assert.equal(JSON.stringify(confirmedReveal.real), before, 'nothing was sent');
    await revealUiBack();
    assert.equal(wobbled, 2, 'Back is locked for the same beat');
    // End: a question first
    answers = ['keep'];
    let e = await revealUiEndFlow(revealRemoteModel());
    assert.equal(e.code, 'cancelled');
    assert.equal(asked[asked.length - 1].title, 'End the reveal?');
    assert.ok(/Counselors keep the places shown so far until 8 AM tomorrow\. The big screen goes back to waiting\./.test(asked[asked.length - 1].body), asked[asked.length - 1].body);
    assert.deepEqual(asked[asked.length - 1].actions.map((a) => a.label), ['Keep showing', 'End the reveal']);
    assert.equal(confirmedReveal.real.ctl.phase, 'live');
    answers = ['end'];
    e = await revealUiEndFlow(revealRemoteModel());
    assert.equal(e.ok, true, JSON.stringify(e));
    assert.equal(confirmedReveal.real.ctl.phase, 'ended', 'a real End keeps the places for the counselors');
    assert.ok(confirmedReveal.real.pub, 'and deletes nothing');
  } finally { revealUiRefused = realRefused; }
  closeReveal();
  afterDirector();
});

test('a Start that can never work is never silent: the dock says why before the tap, the tap says it in a toast and wobbles, and nothing is sent (teams, no sign-in, no clock, a view-only tab)', async () => {
  const db = await bootDirector();
  await openRemote();
  renderRevealRemote();
  const sent = () => db.log ? db.log.length : 0;
  const keepIds = state.teams.map((t) => t.id);
  let wobbled = 0;
  const realRefused = revealUiRefused;
  revealUiRefused = () => { wobbled += 1; };
  const dockWords = () => [data('reveal-go', 'state'), text('reveal-go-k')];
  const tap = async () => { toasts = []; const r = await revealUiGo({}); return r; };
  try {
    assert.equal(revealStartGate().startWhy, null, 'a healthy phone has nothing in the way');
    // teams: an id the rules cannot take (the open team-id question), too few, too many
    state.teams.forEach((t, i) => { t.id = i === 0 ? 'team-a' : keepIds[i]; });
    assert.equal(revealStartGate().startWhy, 'teams');
    assert.equal(revealStartGate().canStart, false, 'the gate says so, so the dock cannot look ready');
    renderRevealRemote();
    assert.deepEqual(dockWords(), ['blocked', 'The teams need fixing first']);
    let r = await tap();
    assert.equal(r.code, 'teams');
    assert.ok(toasts.some((t) => /needs 2 to 6 teams with ids t0 to t5\. Ask /.test(t)), toasts.join(' | '));
    assert.equal(wobbled, 1, 'the button wobbles');
    const real = state.teams.slice();
    state.teams = [real[0], real[1]].map((t, i) => Object.assign({}, t, { id: 't' + i }));
    assert.equal(revealStartGate().startWhy, null, 'two teams t0, t1 is a camp the reveal can run');
    state.teams = [real[0]].map((t) => Object.assign({}, t, { id: 't0' }));
    assert.equal(revealStartGate().startWhy, 'teams', 'one team is not a reveal');
    state.teams = real.concat(real).map((t, i) => Object.assign({}, t, { id: 't' + (i % 6) }));
    assert.equal(revealStartGate().startWhy, 'teams', 'more than six is not either');
    state.teams = real;
    real.forEach((t, i) => { t.id = keepIds[i]; });
    assert.equal(revealStartGate().startWhy, null);
    // no sign-in identity
    authUser = null;
    assert.equal(revealStartGate().startWhy, 'no-identity');
    renderRevealRemote();
    assert.deepEqual(dockWords(), ['blocked', 'Sign in again to start']);
    r = await tap();
    assert.equal(r.code, 'no-identity');
    assert.ok(toasts.some((t) => /isn’t signed in/.test(t)), toasts.join(' | '));
    assert.equal(wobbled, 2);
    authUser = { email: 'jenn@example.com' };
    // no usable clock (belt and braces: the clock can't really be NaN, but the block is a pure function of it)
    assert.equal(revealStartBlock(NaN), 'clock');
    assert.equal(revealStartBlock(T0), null);
    assert.ok(/clock/.test(revealWhyWords('clock')));
    // a view-only second tab, and a phone whose role is not confirmed yet, say so too (they used to say nothing)
    tabWriter = false;
    renderRevealRemote();
    r = await tap();
    assert.equal(r.code, 'view-only');
    assert.ok(toasts.some((t) => /view-only/.test(t)), toasts.join(' | '));
    assert.equal(wobbled, 3);
    tabWriter = true;
    memberRoleConfirmed = false;
    r = await tap();
    assert.equal(r.code, 'viewer');
    assert.ok(toasts.some((t) => /Still checking/.test(t)), toasts.join(' | '));
    assert.equal(wobbled, 4);
    memberRoleConfirmed = true;
    assert.equal(sent(), 0, 'nothing was sent by any of them');
    // and every one of those codes is in the wobble list
    ['teams', 'clock', 'no-identity', 'viewer', 'view-only', 'no-sync'].forEach((c) => assert.ok(REVEAL_UI_REFUSED.includes(c), c));
    renderRevealRemote();
    assert.equal(dockWords()[0] === 'blocked' && /fixing|Sign in|clock/.test(dockWords()[1]), false, 'healthy again: the dock is not stuck on a reason');
  } finally { revealUiRefused = realRefused; state.teams.forEach((t, i) => { t.id = keepIds[i]; }); authUser = { email: 'jenn@example.com' }; tabWriter = true; memberRoleConfirmed = true; }
  closeReveal();
  afterDirector();
});

test('a slow acknowledgement says the last tap may still arrive; a dropped connection says taps would not reach the big screen', async () => {
  await bootDirector();
  await openRemote();
  await setNode({ at: T0 - 20000 }, 2); renderRevealRemote();
  assert.equal(data('reveal-go', 'state'), 'ready');
  revealInFlightSince.real = Date.now() - REVEAL_ACK_SLOW_MS - 1000;      // a command with no answer for over 12 s
  renderRevealRemote();
  assert.deepEqual([data('reveal-go', 'state'), text('reveal-go-k'), text('reveal-go-m')], ['offline', 'Reconnecting…', 'Your last tap may still arrive']);
  assert.equal(data('reveal-back', 'state'), 'offline', 'Back is locked as well');
  fbConnected = false;
  renderRevealRemote();
  assert.equal(text('reveal-go-m'), 'Your taps would not reach the big screen', 'with the socket down nothing leaves this phone');
  fbConnected = true;
  revealInFlightSince.real = 0;
  renderRevealRemote();
  assert.equal(data('reveal-go', 'state'), 'ready');
  closeReveal();
  afterDirector();
});

test('the big button does what its face says: Start, a place, the crown, the table, End', async () => {
  await bootDirector();
  await openRemote();
  scoreEveryGameToday();
  let r = await revealUiGo({});
  assert.equal(r.ok, true, 'Start: ' + JSON.stringify(r));
  assert.equal(confirmedReveal.real.ctl.phase, 'intro');
  for (let i = 0; i < N; i++) {
    nowT += 5000;
    r = await revealUiGo({});
    assert.equal(r.ok, true, 'a place ' + i + ': ' + JSON.stringify(r));
  }
  assert.equal(confirmedReveal.real.ctl.shown, N, 'every place is out');
  nowT += 5000;
  r = await revealUiGo({});                                 // "Show the final table" (a Wednesday: no crowning)
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(confirmedReveal.real.ctl.phase, 'table');
  nowT += 5000;
  answers = ['end'];
  r = await revealUiGo({});
  assert.equal(r.ok, true);
  assert.equal(confirmedReveal.real.ctl.phase, 'ended');
  assert.equal(confirmedReveal.real.ctl.endKind, 'done');
  closeReveal();
  afterDirector();
});

test('calm motion: a refused tap is a 200 ms dim (an attribute the CSS answers), never a transform', async () => {
  await bootDirector();
  await openRemote();
  JellyMotion.setPref('on');
  assert.equal(calmMotion(), true);
  const plays = [];
  const realPlay = JellyMotion.play;
  JellyMotion.play = (...a) => { plays.push(a[1]); return null; };
  try {
    const btn = el('reveal-go');
    revealUiRefused(btn);
    assert.equal('refused' in btn.dataset, true, 'the dim');
    assert.equal(plays.length, 0, 'no spring was started');
  } finally { JellyMotion.play = realPlay; JellyMotion.setPref('auto'); }
  closeReveal();
  afterDirector();
});

test('the remote\'s source: no inline animation, the engine\'s commands only, and every database string reaches markup through esc / textContent', () => {
  const src = readFixture('../reveal-ui.js');
  const code = src.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/innerHTML\s*=\s*(?!html|'')/.test(code.replace(/root\.innerHTML = html/g, '')), 'no raw innerHTML assignment but the keyed list\'s');
  assert.ok(!/\.style\.(transform|transition|animation)/.test(code), 'no inline motion style');
  assert.ok(!/firebase\.|\.ref\(|\.update\(|\.set\(/.test(code), 'the screens never touch the database: they call the engine');
  assert.ok(/revealNext\(\)|revealBack\(\)|revealEnd\(|revealStart\(/.test(code), 'and only through its commands');
});
