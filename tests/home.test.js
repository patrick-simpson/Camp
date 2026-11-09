// Home-screen panels that re-render on every snapshot and every 30 s tick:
// idle renders must not rewrite plain panels (that drops selected text), what the
// standings do besides being drawn runs on every pass and draws nothing, toasts are capped and plain text,
// and a banner strip writes only when it changed. The visible effect of each
// is only checkable in a browser; these pin the rules the fixes rest on. (The
// Now card's own render stability is now-ui.test.js's.)

// Counts innerHTML writes on a stub element (the stub's innerHTML is a plain
// property, so an accessor makes every rewrite observable).
function countWrites(el, keepStamp) {
  let html = el.innerHTML || '';
  let writes = 0;
  if (!keepStamp) { // forget what setHtmlIfChanged last wrote, so the first render counts
    el.__html = undefined;
    el.__dom = undefined;
  }
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set: (v) => { html = v; writes++; },
    configurable: true,
  });
  return () => writes;
}

// ── Idle renders leave plain panels alone ──

test('the home panels that rebuild on every snapshot go through the guard', () => {
  const src = readFixture('../app.js') + '\n' + readFixture('../games-ui.js');
  const body = (name) => {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start > -1, name + ' exists');
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  ['gamesPaintStandings', 'gamesPaintPicker', 'gamesPaintDay']
    .forEach((fn) => assert.ok(/setHtmlIfChanged\(|paintKeyedList\(/.test(body(fn)), fn + ' skips unchanged rebuilds'));
  assert.notOk(/\.innerHTML\s*=[^=]/.test(body('gamesPaintStandings') + body('gamesPaintPicker') + body('gamesPaintDay')), 'the Games panels never assign markup directly');
  // §13.9: what the standings DO (the change history, the point alerts, the day baseline) draws nothing
  const side = body('runStandingsSideEffects');
  assert.notOk(/getElementById|querySelector|innerHTML|textContent|\.hidden/.test(side), 'runStandingsSideEffects touches no DOM');
});

function giveSomePoints() {
  freshState();
  setMemberRole('editor'); // the standings panel is directors' (standings secrecy); secrecy.test.js pins what a counselor sees
  state.config.games.slice(0, 3).forEach((g, i) => {
    state.results[g.id] = { medals: { gold: 't' + (i % 3), silver: 't' + ((i + 1) % 3), bronze: 't' + ((i + 2) % 3) }, savedAt: '2026-07-20T12:00:00Z' };
  });
  lastPointsByTeam = null;
  remoteJustApplied = false;
  try { localStorage.removeItem(DAY_RANK_KEY); } catch (e) { /* none */ }
}

test('the standings list and gap sentence are not rewritten by a render that changes nothing', () => {
  giveSomePoints();
  const list = countWrites(document.getElementById('gs-list'));
  const gap = countWrites(document.getElementById('gs-gap'));
  renderGamesPanel(gamesModel());
  renderGamesPanel(gamesModel());
  renderGamesPanel(gamesModel());
  assert.equal(list(), 1, 'rows built once');
  assert.equal(gap(), 1, 'sentence built once');
  state.bonuses.pts1 = { id: 'pts1', teamId: 't0', category: 'custom', label: 'x', points: 4, at: '2026-07-20T12:05:00Z' };
  renderGamesPanel(gamesModel());
  assert.equal(list(), 2, 'a points change still repaints the rows');
});

test('the standings side effects run without the Games tab: the day baseline, the alert for a change from another phone, nothing drawn', () => {
  giveSomePoints();
  const list = countWrites(document.getElementById('gs-list'));
  const alerts = [];
  const realNotify = notifyPointChanges;
  notifyPointChanges = (changed) => { alerts.push(changed); };
  try {
    runStandingsSideEffects(); // baseline: the first pass raises nothing
    assert.deepEqual(alerts, []);
    const snap = JSON.parse(localStorage.getItem(DAY_RANK_KEY));
    assert.equal(snap.date, campDateStr(), 'the day\'s baseline was taken on the first pass');
    assert.ok(snap.places && typeof snap.flat === 'boolean');
    state.bonuses.pulse1 = { id: 'pulse1', teamId: 't0', category: 'custom', label: 'x', points: 3, at: '2026-07-20T12:05:00Z' };
    remoteJustApplied = true;
    runStandingsSideEffects();
    assert.equal(alerts.length, 1, 'a change that arrived from elsewhere is alerted');
    assert.deepEqual(alerts[0].map((c) => [c.team.id, c.delta]), [['t0', 3]]);
    assert.equal(remoteJustApplied, false, 'and the flag is spent');
    runStandingsSideEffects();
    assert.equal(alerts.length, 1, 'a pass with nothing new alerts nothing');
    assert.equal(list(), 0, 'and not one pass wrote the standings list');
    // a phone that may not read points computes nothing and forgets what it had
    setMemberRole('viewer');
    setStandingsGuardThrows(true);
    try { runStandingsSideEffects(); } finally { setStandingsGuardThrows(false); }
    assert.equal(lastPointsByTeam, null);
  } finally { notifyPointChanges = realNotify; setMemberRole(null); }
});

// ── Toasts ──

test('a burst of toasts is capped at three visible, oldest dismissed first', () => {
  const made = [];
  window.jellyToast = (msg) => {
    const t = { msg, isConnected: true, click() { this.isConnected = false; } };
    made.push(t);
    return t;
  };
  liveToasts.length = 0;
  try {
    for (let i = 0; i < 6; i++) showToast('toast ' + i);
    assert.equal(made.filter((t) => t.isConnected).length, TOAST_MAX_VISIBLE);
    assert.deepEqual(made.filter((t) => t.isConnected).map((t) => t.msg), ['toast 3', 'toast 4', 'toast 5']);
    // One the viewer already dismissed doesn't count against the cap.
    made[5].isConnected = false;
    showToast('toast 6');
    assert.deepEqual(made.filter((t) => t.isConnected).map((t) => t.msg), ['toast 3', 'toast 4', 'toast 6']);
  } finally {
    delete window.jellyToast;
    liveToasts.length = 0;
  }
});

test('the toast cap drops other teams first, never your own and never the one just raised', () => {
  const made = [];
  window.jellyToast = (msg) => {
    const t = { msg, isConnected: true, click() { this.isConnected = false; } };
    made.push(t);
    return t;
  };
  liveToasts.length = 0;
  const visible = () => made.filter((t) => t.isConnected).map((t) => t.msg);
  const mine = { mine: true };
  try {
    showToast('a mine', mine);
    showToast('b');
    showToast('c');
    showToast('d'); // over the cap: b is the oldest that isn't mine
    assert.deepEqual(visible(), ['a mine', 'c', 'd']);
    showToast('e mine', mine);
    assert.deepEqual(visible(), ['a mine', 'd', 'e mine']);
    showToast('f mine', mine);
    showToast('g mine', mine); // only mine left among the older ones: the oldest of them goes
    assert.deepEqual(visible(), ['e mine', 'f mine', 'g mine']);
    showToast('h'); // an ordinary toast over three mine: the new one stays
    assert.deepEqual(visible(), ['f mine', 'g mine', 'h']);
  } finally {
    delete window.jellyToast;
    liveToasts.length = 0;
  }
});

test('point alerts share one toast, the followed team keeps its own, and nothing is HTML-escaped', () => {
  freshState();
  setMemberRole('editor'); // point alerts are directors' (standings secrecy)
  const shown = [];
  const natives = [];
  const realToast = showToast;
  const realNative = maybeNativeNotification;
  showToast = (msg, opts) => shown.push({ msg, mine: !!(opts && opts.mine) });
  maybeNativeNotification = (title, body, tag) => natives.push({ title, body, tag });
  try {
    state.notify = true;
    state.followTeam = 't1';
    state.teams.find((t) => t.id === 't0').name = "Pete's Pandas & Co";
    const t = (id) => state.teams.find((x) => x.id === id);
    notifyPointChanges([
      { team: t('t0'), delta: 5, total: 12 },
      { team: t('t1'), delta: 3, total: 9 },
      { team: t('t2'), delta: -2, total: 4 },
    ]);
    assert.equal(shown.length, 2, 'one toast for the two other teams, one for mine: ' + JSON.stringify(shown));
    assert.ok(shown[0].msg.includes("Pete's Pandas & Co +5") && shown[0].msg.includes(' -2'), shown[0].msg);
    assert.notOk(shown[0].mine);
    assert.ok(shown[1].mine && shown[1].msg.startsWith('Your team scored! '), shown[1].msg);
    assert.equal(natives.length, 1, 'the OS notification is for the followed team only');
    assert.notOk(/&(amp|#39|lt|gt|quot);/.test(shown.map((s) => s.msg).concat(natives.map((n) => n.body)).join(' ')), 'plain text sinks must not show entities');

    // A single other team keeps the familiar one-line format.
    shown.length = 0;
    state.followTeam = null;
    notifyPointChanges([{ team: t('t0'), delta: 5, total: 12 }]);
    assert.equal(shown.length, 1);
    assert.ok(/Pete's Pandas & Co \+5 pts \(now 12\)$/.test(shown[0].msg), shown[0].msg);

    // Past three teams the short names keep it to a few lines on a phone.
    shown.length = 0;
    notifyPointChanges(state.teams.map((team) => ({ team, delta: 1, total: 1 })));
    assert.equal(shown.length, 1);
    assert.ok(shown[0].msg.includes(TEAM_ABBREV.t3), shown[0].msg);
    assert.notOk(shown[0].msg.includes('Methodic Mediocre Maples'), 'full names are for three teams or fewer');
  } finally {
    showToast = realToast;
    maybeNativeNotification = realNative;
    state.notify = false;
    state.followTeam = null;
  }
});

test('up-next alerts are plain text too', () => {
  freshState();
  const shown = [];
  const realToast = showToast;
  showToast = (msg) => shown.push(msg);
  try {
    state.notify = true;
    state.teams.find((t) => t.id === 't0').name = "Pete's Pandas & Co";
    notifyMatchupChanges([{ game: { id: 'gx', name: "Let's Go <Ball>" }, aId: 't0', bId: 't1' }]);
    assert.equal(shown.length, 1);
    assert.ok(shown[0].includes("Pete's Pandas & Co") && shown[0].includes("Let's Go <Ball>"), shown[0]);
  } finally {
    showToast = realToast;
    state.notify = false;
  }
});

// ── Message banners (Now's strip) ──
// The old inline composer (and its keyboard-preserving node swap) is gone: a banner is written by Tell everyone
// (tell.js). What is left of this panel is a list that re-renders on every snapshot and every 30 s tick, so the
// same rules as every other home panel apply: write only a change, wire once, never rebuild what did not move.

test('Now\'s strip draws every banner with messageHtml, and an idle re-render writes nothing', () => {
  freshState();
  setMemberRole('editor');
  const wrap = document.getElementById('announcements');
  wrap.__html = undefined;
  wrap.__dom = undefined;
  wrap.hidden = true;
  const writes = countWrites(wrap, true);
  try {
    state.announcements = { a1: { id: 'a1', text: 'Dinner moved to six', at: new Date().toISOString(), ttlMs: 3600000, by: 'Jenn' } };
    renderAnnouncements();
    assert.equal(writes(), 1, 'the first paint writes the banner');
    assert.equal(wrap.hidden, false, 'and shows the strip');
    assert.ok(wrap.innerHTML.includes('Dinner moved to six') && wrap.innerHTML.includes('class="msg"'), 'a .msg, the one banner markup');
    assert.ok(wrap.innerHTML.includes('Take down for everyone'), 'a director may take a synced banner down from here');
    assert.notOk(/announce-(input|form|open-btn|post-btn)/.test(wrap.innerHTML), 'no composer in the strip any more');
    assert.equal(wrap.innerHTML, [...liveAnnouncements(), ].map((a) => messageHtml(a, { editor: true })).join(''), 'exactly what messageHtml writes');
    renderAnnouncements(); // the 30 s tick
    assert.equal(writes(), 1, 'identical markup is not rewritten');
    state.announcements = {};
    renderAnnouncements();
    assert.equal(wrap.hidden, true, 'no banner: the strip is hidden, even for a director (the composer link is gone)');
  } finally {
    state.announcements = {};
    setMemberRole(null);
  }
});

test('a counselor sees the same banner with no Remove, and a chat-sourced one never has one', () => {
  freshState();
  const a = { id: 'a1', text: 'Bring a towel', at: new Date().toISOString(), ttlMs: 3600000, by: 'Jenn' };
  const viewer = messageHtml(a, { editor: false });
  assert.notOk(viewer.includes('msg-remove'), 'a counselor cannot take a banner down');
  assert.ok(viewer.includes('msg-x') && viewer.includes('Dismiss this announcement on this phone'), 'but can dismiss it on this phone');
  const chat = messageHtml(Object.assign({}, a, { fromChat: true }), { editor: true });
  assert.ok(chat.includes('data-kind="chat"') && chat.includes('Announcements chat'), 'a chat message reads as one');
  assert.notOk(chat.includes('msg-remove'), 'delete it in chat instead');
  const preview = messageHtml(a, { editor: true, preview: true });
  assert.ok(/Now · Jenn/.test(preview), 'the preview says "Now"');
  assert.notOk(preview.includes('msg-remove'), 'and never offers Remove');
  const hostile = messageHtml({ id: 'x"><i', text: '<img src=x onerror=alert(1)>', at: new Date().toISOString(), by: '<b>' }, { editor: true });
  assert.notOk(/<img|<b>|<i[ >]/.test(hostile.replace(/<svg[\s\S]*?<\/svg>/g, '')), 'every database string is escaped');
});

test('a banner is written by postBanner and taken down by takeDownBanner: directors only, no render, no save', () => {
  freshState();
  setMemberRole('viewer');
  assert.equal(postBanner('hi', 3600000), null, 'a counselor cannot post');
  setMemberRole('editor');
  try {
    assert.equal(postBanner('   ', 3600000), null, 'nothing to say');
    const id = postBanner('  Water break  ', 3 * 3600000);
    const a = state.announcements[id];
    assert.equal(a.text, 'Water break', 'trimmed');
    assert.equal(a.ttlMs, 3 * 3600000);
    assert.ok(Number.isFinite(Date.parse(a.at)), 'stamped with its time');
    assert.equal(postBanner('x'.repeat(400), 0) && Object.values(state.announcements).pop().text.length, BANNER_MAX, 'cut to the message limit');
    assert.equal(Object.values(state.announcements).pop().ttlMs, ANNOUNCE_DEFAULT_TTL_MS, 'a missing duration is the one-hour default');
    assert.ok(liveAnnouncements().some((x) => x.id === id));
    assert.equal(takeDownBanner(id), true);
    assert.equal(takeDownBanner(id), false, 'a second take down finds nothing');
    setMemberRole('viewer');
    assert.equal(takeDownBanner(Object.keys(state.announcements)[0]), false, 'and a counselor cannot take one down');
  } finally {
    state.announcements = {};
    setMemberRole(null);
  }
});

// ── Day picker ──

test('the day picker rewrites nothing when nothing changed, and the chosen day is this device\'s own', () => {
  freshState();
  setMemberRole('editor');
  const track = countWrites(document.getElementById('games-days-pick'));
  state.ui.day = state.config.days[0].id;
  renderGamesPanel(gamesModel());
  renderGamesPanel(gamesModel());
  assert.equal(track(), 1, 'the tabs are written once');
  const other = state.config.days[1].id;
  gamesPickDay(other);
  assert.equal(state.ui.day, other, 'a tap chooses the day');
  assert.equal(track(), 2, 'and rewrites the tabs once');
  gamesPickDay(other);
  gamesPickDay('not-a-day');
  assert.equal(track(), 2, 'a repeat tap and a stale id change nothing');
  assert.equal(state.ui.day, other);
  setMemberRole(null);
});

test('Now hosts the Now engine (card, runs, messages strip); Games hosts the day tabs; More hosts the rest; renderAll gives each to ITS tab only', () => {
  const src = readFixture('../app.js');
  const panel = src.slice(src.indexOf('const SHELL_PANELS = {'), src.indexOf('const SHELL_ALWAYS'));
  const part = (from, to) => panel.slice(panel.indexOf(from), panel.indexOf(to));
  const now = part('now: {', 'games: {');
  ['nowRefresh', 'nowTick', 'renderAnnouncements'].forEach((fn) => assert.ok(now.includes(fn + '('), fn + ' renders with Now'));
  // The old Now sections are DELETED, not just unwired (Step 17): the Now card paints from nowModel().
  ['renderNoticeBoard', 'renderNowBanner', 'splitNowBanner', 'renderFollowCard', 'renderMyElectives', 'renderLiveHome', 'homeBoardGame', 'liveHomeGames']
    .forEach((fn) => assert.notOk(new RegExp('\\b' + fn + '\\b').test(src), fn + ' is gone from app.js (the Now engine replaced it)'));
  ['gamesRefresh', 'renderMemoryVerse', 'renderMealCleanup', 'renderFooter']
    .forEach((fn) => assert.notOk(now.includes(fn + '('), fn + ' left Now'));
  // The old Games cards are DELETED too (Step 18): the Games tab paints from gamesModel().
  ['renderDayTabs', 'renderBonuses', 'bindBonusEntry', 'renderCatchupHint', 'renderStandings', 'dayGamesHTML', 'wireDayPanels', 'settleDayTabPill']
    .forEach((fn) => assert.notOk(new RegExp('\\b' + fn + '\\b').test(src.replace(/\/\/.*$/gm, '')), fn + ' is gone from app.js (the Games engine replaced it)'));
  const games = part('games: {', 'chat: {');
  assert.ok(games.includes('gamesRefresh('), 'the Games panel renders with Games');
  assert.ok(part('more: {', '};').includes('renderMore()'), 'More renders its volatile lines');
  // The reading sheets render while they are open, whatever tab is under them.
  assert.ok(/function renderShellSheets\(\)[\s\S]*shellSheetFill/.test(src));
  assert.ok(/function shellSheetFill[\s\S]*renderMemoryVerse\(\)[\s\S]*renderMealCleanup\(\)/.test(src));
  const all = src.slice(src.indexOf('function renderAll() {'), src.indexOf('// ── Week builder'));
  assert.notOk(/renderNowBanner\(\)|renderLiveHome\(\)|renderDayTabs\(\)|gamesRefresh\(\)/.test(all), 'renderAll no longer renders them unconditionally');
  assert.ok(all.includes('renderShellTabs()'));
  const always = src.slice(src.indexOf('const SHELL_ALWAYS'), src.indexOf('function renderTab('));
  assert.ok(/pruneExpiredAnnouncements\(\)/.test(always), 'announcement pruning still runs on every pass');
  assert.ok(/runStandingsSideEffects\(\)/.test(always), 'and so do the standings\' side effects (§13.9)');
});

