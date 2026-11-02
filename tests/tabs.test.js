// The shell's behaviour (redesign §2, §13; BUILD-PLAN Step 13): four tabs, the
// takeovers and sheets over them, dirty render, scroll memory, and the history
// stack that makes the phone's Back do the obvious thing. The harness has no
// layout and no real history, so this file stands up a small fake of each (a
// history with real entries and an asynchronous go(), stateful tab buttons, a
// scroll position) and drives the shell's real functions through them.

const flush = () => new Promise((r) => setTimeout(r, 5));

// ── fakes ───────────────────────────────────────────────────────────

function fakeHistory(initial) {
  const h = {
    entries: [{ state: initial || null }],
    i: 0,
    get state() { return h.entries[h.i].state; },
    pushState(s) { h.entries.length = h.i + 1; h.entries.push({ state: s }); h.i += 1; },
    replaceState(s) { h.entries[h.i].state = s; },
    // Asynchronous like the real thing: the popstate comes a beat later.
    go(n) {
      setTimeout(() => {
        h.i = Math.max(0, Math.min(h.entries.length - 1, h.i + n));
        if (popHandler) popHandler({ state: h.state });
      }, 0);
    },
    // The person's Back button.
    back() { h.go(-1); },
  };
  return h;
}

let popHandler = null;
const winHandlers = {};
const tabClicks = {};
const tabBtns = ['now', 'games', 'chat', 'more'].map((t) => {
  const attrs = new Map([['aria-selected', t === 'now' ? 'true' : 'false']]);
  return {
    dataset: { tab: t },
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    setAttribute: (n, v) => attrs.set(n, String(v)),
    addEventListener: (ev, fn) => { if (ev === 'click') tabClicks[t] = fn; },
  };
});
const appAttrs = new Map();
const classes = new Set();
let scrolls = [];

function installFakes() {
  const realGet = document.getElementById.bind(document);
  const app = realGet('app');
  app.getAttribute = (n) => (appAttrs.has(n) ? appAttrs.get(n) : null);
  app.setAttribute = (n, v) => appAttrs.set(n, String(v));
  document.body.classList = {
    add: (c) => classes.add(c), remove: (c) => classes.delete(c),
    toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c),
  };
  const realAll = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel === '#tabbar .tab' ? tabBtns : realAll(sel));
  window.addEventListener = (ev, fn) => { winHandlers[ev] = fn; if (ev === 'popstate') popHandler = fn; };
  window.scrollTo = (a, b) => {
    const y = typeof a === 'object' ? a.top : b;
    scrolls.push(y);
    window.scrollY = y;
  };
}
installFakes();
wireShell();

function reset() {
  freshState();
  setMemberRole('editor');
  shell.cur = null; shell.root = null; shell.sheets.length = 0; shell.q.length = 0; shell.busy = false;
  shell.dirty = { now: true, games: true, chat: true, more: true };
  shell.scroll = { now: 0, games: 0, chat: 0, more: 0 };
  state.ui.tab = 'now'; state.ui.gameId = null; state.ui.view = 'home';
  appAttrs.clear(); classes.clear(); scrolls = [];
  window.scrollY = 0;
  tabBtns.forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === 'now' ? 'true' : 'false'));
  globalThis.history = fakeHistory();
  globalThis.history.replaceState(shellEntryState({ tab: 'now', ov: [] }), '');
  shell.cur = { tab: 'now', ov: [] };
  renderAll();
}

const gid = () => allGames()[0].id;
const gid2 = () => allGames()[1].id;
const keys = () => history.entries.slice(0, history.i + 1).map((e) => (e.state ? shellSnapKey(shellSnapFromRaw(e.state)) : 'foreign'));

// ── the pure rules ──────────────────────────────────────────────────

test('every entry is a pure function of the top of the stack: Now, then the tab, then one per overlay', () => {
  assert.deepEqual(shellChain({ tab: 'now', ov: [] }).map(shellSnapKey), ['now|']);
  assert.deepEqual(shellChain({ tab: 'chat', ov: [] }).map(shellSnapKey), ['now|', 'chat|']);
  assert.deepEqual(shellChain({ tab: 'games', ov: [{ k: 'game', id: 'g1' }] }).map(shellSnapKey), ['now|', 'games|', 'games|game:g1']);
  assert.deepEqual(shellChain({ tab: 'now', ov: [{ k: 'game', id: 'g1' }, { k: 'sheet', id: 'team' }] }).map(shellSnapKey),
    ['now|', 'now|game:g1', 'now|game:g1,sheet:team']);
});

test('the plan from one snapshot to another: push, pop, and replace for a one-for-one swap', () => {
  const N = { tab: 'now', ov: [] };
  const G = { tab: 'games', ov: [] };
  const C = { tab: 'chat', ov: [] };
  const game = (id) => ({ tab: 'now', ov: [{ k: 'game', id }] });
  const ops = (a, b) => shellHistPlan(a, b).map((o) => o.op + (o.n ? o.n : ''));
  assert.deepEqual(ops(N, N), [], 'nothing to do');
  assert.deepEqual(ops(N, G), ['push'], 'leaving Now pushes ONE entry');
  assert.deepEqual(ops(G, C), ['replace'], 'tab to tab never stacks');
  assert.deepEqual(ops(G, N), ['back1'], 'returning to Now pops it');
  assert.deepEqual(ops(N, game('a')), ['push'], 'a takeover pushes');
  assert.deepEqual(ops(game('a'), N), ['back1']);
  assert.deepEqual(ops(game('a'), game('b')), ['replace'], '"Next game" replaces the takeover\'s entry');
  assert.deepEqual(ops({ tab: 'games', ov: [{ k: 'game', id: 'a' }] }, N), ['back2'], 'a takeover over a tab unwinds both');
  assert.deepEqual(ops(game('a'), { tab: 'games', ov: [] }), ['replace'], 'close the takeover and go to a tab: one pop, one push');
  assert.deepEqual(ops({ tab: 'games', ov: [{ k: 'game', id: 'a' }] }, C), ['back2', 'push'], 'two pops and a push go through Back');
  // A cold open: the entry the browser is on isn't ours, so it is tagged Now and the rest is pushed on top.
  assert.deepEqual(ops(null, game('a')), ['replace', 'push']);
  assert.deepEqual(ops(null, { tab: 'chat', ov: [{ k: 'sheet', id: 'team' }] }), ['replace', 'push', 'push']);
  assert.deepEqual(ops(null, N), ['replace']);
});

test('a history entry is validated like any stored input: exactly this shape or nothing', () => {
  assert.equal(shellSnapFromRaw(null), null);
  assert.equal(shellSnapFromRaw({ campChat: 1 }), null, "an older build's entry is not ours");
  assert.equal(shellSnapFromRaw({ campShell: 2, tab: 'now' }), null);
  assert.deepEqual(shellSnapFromRaw({ campShell: 1, tab: 'bogus', ov: 'x' }), { tab: 'now', ov: [] });
  const s = shellSnapFromRaw({ campShell: 1, tab: 'games', ov: [{ k: 'game', id: 'g<1>' }, { k: 'game', id: 'g1', from: 'games' }, { k: 'x' }, null, { k: 'sheet', id: 'Team!' }] });
  assert.deepEqual(s, { tab: 'games', ov: [{ k: 'game', id: 'g1', from: 'games' }] }, 'markup-ish ids, unknown kinds and junk are dropped');
});

test('deep-link targets: every tab, game:<id>, reveal and alert:<id> resolve; junk does not', () => {
  assert.deepEqual(shellParseTarget('#games'), { tab: 'games' });
  assert.deepEqual(shellParseTarget('more'), { tab: 'more' });
  assert.deepEqual(shellParseTarget('chat'), { tab: 'chat' });
  assert.deepEqual(shellParseTarget('chat:memes'), { tab: 'chat', channel: 'memes' });
  assert.deepEqual(shellParseTarget('game:g12'), { tab: 'now', game: 'g12' });
  assert.deepEqual(shellParseTarget('reveal'), { tab: 'now' }, 'the live mirror is on Now');
  assert.deepEqual(shellParseTarget('alert:abc-1'), { tab: 'now' });
  assert.deepEqual(shellParseTarget('schedule'), { tab: 'now', sheet: 'schedule' });
  ['', 'settings', 'game:', 'game:<x>', 'chat:../x', 'alert:', 'javascript:alert(1)', null].forEach((t) => {
    assert.equal(shellParseTarget(t), null, String(t));
  });
});

// ── switching ───────────────────────────────────────────────────────

test('tapping a tab shows it: the one data-tab switch, the buttons\' aria-selected, a saved choice', () => {
  reset();
  assert.equal(appAttrs.get('data-tab'), 'now');
  tabClicks.games();
  assert.equal(activeTab(), 'games');
  assert.equal(appAttrs.get('data-tab'), 'games');
  assert.deepEqual(tabBtns.map((b) => b.getAttribute('aria-selected')), ['false', 'true', 'false', 'false']);
  assert.equal(state.ui.tab, 'games');
  assert.ok(JSON.parse(localStorage.getItem(STORAGE_KEY)).ui.tab === 'games', 'device-local, saved with the rest of ui');
  assert.notOk(showTab('bogus'), 'an unknown tab is refused');
  assert.equal(activeTab(), 'games');
});

test('a hidden tab does not re-render on every snapshot; it catches up when shown', () => {
  reset();
  const n = { now: 0, games: 0, chat: 0, more: 0 };
  const real = {};
  Object.keys(n).forEach((t) => { real[t] = SHELL_PANELS[t].render; SHELL_PANELS[t].render = () => { n[t] += 1; }; });
  const realStandings = renderStandings;
  let standings = 0;
  renderStandings = () => { standings += 1; };
  try {
    renderAll(); renderAll(); renderAll(); // three snapshots land while Now is showing
    assert.deepEqual(n, { now: 3, games: 0, chat: 0, more: 0 }, 'only the visible tab renders');
    assert.equal(standings, 3, 'a renderer with side effects (the change history) runs whatever tab shows');
    assert.ok(shell.dirty.games && shell.dirty.chat && shell.dirty.more && !shell.dirty.now);
    showTab('games');
    assert.deepEqual(n, { now: 3, games: 1, chat: 0, more: 0 }, 'Games rendered once, when shown');
    assert.ok(shell.dirty.now && !shell.dirty.games, 'and now Now is the stale one');
    renderAll(); renderAll();
    assert.equal(n.games, 3);
    assert.equal(n.now, 3, 'Now waited');
    showTab('now');
    assert.equal(n.now, 4, 'and caught up in one pass');
    // the clock's own tick: the visible tab only
    let ticks = 0;
    const realTick = SHELL_PANELS.now.tick;
    SHELL_PANELS.now.tick = () => { ticks += 1; };
    SHELL_PANELS.games.tick = () => { ticks += 100; };
    shellTick();
    assert.equal(ticks, 1);
    SHELL_PANELS.now.tick = realTick;
  } finally {
    Object.keys(n).forEach((t) => { SHELL_PANELS[t].render = real[t]; });
    renderStandings = realStandings;
  }
});

test('a tab remembers its own scroll; leaving and coming back puts it back, and a re-tap glides to the top', () => {
  reset();
  window.scrollY = 420; winHandlers.scroll();
  assert.equal(shell.scroll.now, 420);
  showTab('games');
  assert.equal(window.scrollY, 0, 'Games starts at the top');
  window.scrollY = 75; winHandlers.scroll();
  showTab('more');
  window.scrollY = 10; winHandlers.scroll();
  showTab('now');
  assert.equal(window.scrollY, 420, 'Now is back where it was');
  showTab('games');
  assert.equal(window.scrollY, 75);
  scrolls = [];
  showTab('games'); // the tab you are on
  assert.equal(scrolls.length, 1, 're-tapping scrolls');
  assert.equal(scrolls[0], 0, 'to the top');
  assert.equal(activeTab(), 'games');
});

test('a takeover or the builder collapsing the page never overwrites a tab\'s saved scroll', () => {
  reset();
  window.scrollY = 300; winHandlers.scroll();
  openGame(gid());
  window.scrollY = 0; winHandlers.scroll(); // the browser clamped the page while it shrank / the takeover scrolls itself
  assert.equal(shell.scroll.now, 300, 'Now keeps its slot under a takeover');
  closeGame();
  assert.equal(shell.scroll.now, 300, 'and closing it does not move the page');
});

test('the header\'s hairline appears only once the page has moved', () => {
  reset();
  const header = document.getElementById('app-header');
  const seen = [];
  header.classList = { toggle: (c, on) => seen.push(c + ':' + !!on), add() {}, remove() {}, contains: () => false };
  window.scrollY = 0; winHandlers.scroll();
  window.scrollY = 40; winHandlers.scroll();
  assert.deepEqual(seen, ['is-scrolled:false', 'is-scrolled:true']);
});

// ── history ─────────────────────────────────────────────────────────

test('leaving Now files one entry; tab to tab replaces it; back to Now pops it; Back on Now leaves the app', async () => {
  reset();
  assert.deepEqual(keys(), ['now|']);
  showTab('games');
  assert.deepEqual(keys(), ['now|', 'games|'], 'one entry for leaving Now');
  showTab('chat');
  assert.deepEqual(keys(), ['now|', 'chat|'], 'moving between tabs does not stack');
  showTab('more');
  assert.deepEqual(keys(), ['now|', 'more|']);
  assert.equal(history.entries.length, 2);
  showTab('now');
  await flush();
  assert.equal(history.i, 0, 'we went back to the base entry');
  assert.equal(activeTab(), 'now');
  assert.equal(history.entries[0].state.tab, 'now', 'Back on Now has nothing of ours left to pop');
});

test('the phone\'s Back from a tab returns to Now', async () => {
  reset();
  showTab('chat');
  history.back();
  await flush();
  assert.equal(activeTab(), 'now', 'Back left the tab');
  assert.equal(appAttrs.get('data-tab'), 'now');
  assert.equal(shell.cur.tab, 'now');
  assert.equal(history.i, 0);
});

test('a game takeover pushes an entry; Back closes it and lands where it was opened; Next game replaces', async () => {
  reset();
  showTab('games');
  openGame(gid());
  assert.equal(state.ui.gameId, gid());
  assert.equal(state.ui.gameFrom, 'games', 'the back names the tab it was opened from');
  assert.deepEqual(keys(), ['now|', 'games|', 'games|game:' + gid()]);
  assert.ok(classes.has('takeover-open'), 'the tab bar steps away');
  // Next game: the takeover's entry is replaced, so Back after three games in a row still lands on Games.
  openGame(gid2());
  assert.deepEqual(keys(), ['now|', 'games|', 'games|game:' + gid2()], 'replaced, not stacked');
  assert.equal(history.entries.length, 3);
  history.back();
  await flush();
  assert.equal(state.ui.gameId, null, 'Back closed the takeover');
  assert.equal(activeTab(), 'games', 'and landed on the tab underneath');
  assert.notOk(classes.has('takeover-open'));
  assert.deepEqual(keys(), ['now|', 'games|']);
});

test('the labelled back button and the phone\'s Back agree', async () => {
  reset();
  openGame(gid());
  assert.deepEqual(keys(), ['now|', 'now|game:' + gid()]);
  closeGame(); // the ‹ Now button
  await flush();
  assert.equal(state.ui.gameId, null);
  assert.equal(history.i, 0, 'it popped its own entry: the stack did not grow');
  assert.equal(history.entries.length, 2, 'the entry above is simply unreachable now');
  assert.deepEqual(keys(), ['now|']);
});

test('the back label always names a fixed place', () => {
  reset();
  const g = allGames()[0];
  state.ui.gameFrom = 'now';
  assert.equal(shellGameBackLabel(g), 'Now');
  state.ui.gameFrom = 'games';
  assert.equal(shellGameBackLabel(g), dayById(g.dayId).name + ' games');
  state.ui.gameFrom = 'more';
  assert.equal(shellGameBackLabel(g), 'More');
  state.ui.gameFrom = 'bogus';
  assert.equal(shellGameBackLabel(g), 'Now', 'an unknown origin falls back to Now');
});

test('a game opened cold (a deep link, a notification) tags Now underneath, so the label and Back agree', async () => {
  freshState(); setMemberRole('editor');
  globalThis.history = fakeHistory(); // the browser's entry is not ours
  shell.cur = null; shell.root = null; shell.sheets.length = 0; shell.q.length = 0; shell.busy = false;
  state.ui.tab = 'now'; state.ui.gameId = null; state.ui.view = 'home';
  assert.ok(shellOpenTarget('game:' + gid()));
  assert.equal(state.ui.gameId, gid());
  assert.deepEqual(keys(), ['now|', 'now|game:' + gid()], 'base replaced with Now, the takeover pushed');
  history.back();
  await flush();
  assert.equal(state.ui.gameId, null);
  assert.equal(activeTab(), 'now');
  assert.equal(history.i, 0);
});

test('cold deep links: #games, #chat, #more and game:<id> each land on their own tab with Now underneath', async () => {
  const boot = (hash) => {
    freshState(); setMemberRole('editor');
    globalThis.history = fakeHistory();
    location.hash = hash;
    shell.cur = null; shell.root = null; shell.sheets.length = 0; shell.q.length = 0; shell.busy = false;
    state.ui = { day: state.ui.day, gameId: null };
    shellBoot();
    renderAll();
  };
  try {
    boot('#games');
    assert.equal(activeTab(), 'games');
    assert.deepEqual(keys(), ['now|', 'games|']);
    assert.equal(history.state && history.state.campShell, 1);
    boot('#chat:memes');
    assert.equal(activeTab(), 'chat');
    assert.equal(state.ui.chatChannel, 'memes');
    boot('#more');
    assert.equal(activeTab(), 'more');
    boot('#game:' + gid());
    assert.equal(state.ui.gameId, gid());
    assert.deepEqual(keys(), ['now|', 'now|game:' + gid()]);
    boot('#game:nope');
    assert.equal(state.ui.gameId, null, 'a game this week does not have just opens Now');
    assert.equal(activeTab(), 'now');
    boot('#reveal');
    assert.equal(activeTab(), 'now');
    boot('#alert:abc');
    assert.equal(activeTab(), 'now');
    boot('#nonsense');
    assert.equal(activeTab(), 'now');
  } finally {
    location.hash = '';
  }
});

test('a same-page link that only changes the #fragment is a deep link too, and the stack is re-planned from the new entry', async () => {
  reset();
  showTab('more');
  location.hash = '#game:' + gid();
  history.pushState(null, ''); // the browser files an entry that is not ours
  winHandlers.hashchange();
  location.hash = '';
  assert.equal(state.ui.gameId, gid(), 'the takeover opened');
  assert.equal(activeTab(), 'now');
  assert.deepEqual(keys().slice(-2), ['now|', 'now|game:' + gid()], 'the new entry is tagged Now, the takeover pushed on top (what was beneath stays beneath)');
  history.back();
  await flush();
  assert.equal(state.ui.gameId, null);
  assert.equal(activeTab(), 'now');
  // junk is dropped quietly (and the fragment is stripped either way)
  location.hash = '#bogus';
  winHandlers.hashchange();
  location.hash = '';
});

test('a reload restores the tab within ten minutes and opens on Now after that', () => {
  const boot = (ageMs, tab) => {
    freshState(); setMemberRole('editor');
    globalThis.history = fakeHistory(shellEntryState({ tab, ov: [] }));
    shell.cur = null; shell.root = null; shell.sheets.length = 0; shell.q.length = 0; shell.busy = false;
    state.ui = { day: state.ui.day, gameId: null, tab, shellAt: Date.now() - ageMs };
    shellBoot();
    renderAll();
  };
  boot(60 * 1000, 'chat');
  assert.equal(activeTab(), 'chat', 'a minute away: where you were');
  assert.deepEqual(keys(), ['chat|'], 'the stack is left exactly as the browser has it');
  boot(11 * 60 * 1000, 'chat');
  assert.equal(activeTab(), 'now', 'eleven minutes away: Now');
  boot(60 * 1000, 'bogus');
  assert.equal(activeTab(), 'now', 'a corrupt tab reads as Now');
});

test('a game left open yesterday (or one the week no longer has) does not greet anyone on boot', () => {
  const boot = (ui) => {
    freshState(); setMemberRole('editor');
    globalThis.history = fakeHistory();
    shell.cur = null; shell.root = null; shell.sheets.length = 0; shell.q.length = 0; shell.busy = false;
    state.ui = Object.assign({ day: state.ui.day }, ui);
    shellBoot();
  };
  boot({ gameId: gid(), tab: 'now', shellAt: Date.now() - 60 * 1000, gameDow: campNow().dow });
  assert.equal(state.ui.gameId, gid(), 'same camp day, a minute ago: restored');
  boot({ gameId: gid(), tab: 'now', shellAt: Date.now() - 60 * 1000, gameDow: (campNow().dow + 3) % 7 });
  assert.equal(state.ui.gameId, null, 'another camp day: not restored');
  boot({ gameId: 'gone', tab: 'now', shellAt: Date.now() - 60 * 1000, gameDow: campNow().dow });
  assert.equal(state.ui.gameId, null, 'a game that left the week: not restored');
  boot({ gameId: gid(), tab: 'now', shellAt: Date.now() - 20 * 60 * 1000, gameDow: campNow().dow });
  assert.equal(state.ui.gameId, null, 'twenty minutes away: not restored');
  boot({ chatOpen: true, tab: 'now', shellAt: Date.now() - 1000 });
  assert.equal(state.ui.tab, 'chat', "a build before the Chat tab stored chatOpen: that maps to the tab");
  assert.notOk('chatOpen' in state.ui);
});

test('coming back after ten minutes reopens on Now; a half-written message or typing in progress keeps everything', () => {
  reset();
  showTab('chat');
  openGame(gid());
  shell.hiddenAt = Date.now() - 5 * 60 * 1000;
  let ticks = 0;
  const realTick = shellTick;
  shellTick = () => { ticks += 1; };
  try { shellResume(); } finally { shellTick = realTick; }
  assert.equal(ticks, 1, 'waking runs the time-driven pass (a frozen iOS page fires no interval)');
  assert.equal(activeTab(), 'chat', 'five minutes: nothing moves');
  assert.equal(state.ui.gameId, gid());
  // away long, but a reply is half-written
  chatDrafts = { general: 'on my way, save me a seat' };
  shell.hiddenAt = Date.now() - 30 * 60 * 1000;
  shellResume();
  assert.equal(activeTab(), 'chat', 'an unsent message is never thrown away');
  assert.equal(state.ui.gameId, gid());
  chatDrafts = {};
  shell.hiddenAt = Date.now() - 30 * 60 * 1000;
  shellResume();
  assert.equal(activeTab(), 'now', 'thirty minutes, nothing typed: Now');
  assert.equal(state.ui.gameId, null, 'takeover closed');
  assert.equal(shell.scroll.now, 0);
});

// ── builder, sheets, chat, keyboard ─────────────────────────────────

test('the week builder is a takeover too: it files an entry, Back closes it, and the tab it came from gets its scroll back', async () => {
  reset();
  showTab('more');
  window.scrollY = 180; winHandlers.scroll();
  openBuilder();
  assert.equal(builderOpen(), true);
  assert.equal(shell.root, 'builder');
  assert.equal(appAttrs.get('data-tab'), 'now', 'the builder lives inside the Now panel until it moves out');
  assert.deepEqual(keys(), ['now|', 'more|', 'more|builder:']);
  assert.equal(shell.scroll.more, 180);
  history.back();
  await flush();
  assert.equal(builderOpen(), false, 'Back closed it');
  assert.equal(activeTab(), 'more', 'and returned to More');
  assert.equal(window.scrollY, 180, 'at the same place');
});

test('Back out of a builder with an unsaved game editor asks first, and "no" keeps it', async () => {
  reset();
  openBuilder();
  const realDirty = builderDirty, realConfirm = globalThis.confirm, realSettings = renderSettings;
  let asked = 0;
  try {
    globalThis.renderSettings = () => {}; // the real one needs an open editor behind the dirty flag
    globalThis.builderDirty = () => true;
    globalThis.confirm = () => { asked += 1; return false; };
    history.back();
    await flush();
    assert.equal(asked, 1);
    assert.equal(builderOpen(), true, 'still open');
    assert.deepEqual(keys(), ['now|', 'now|builder:'], 'the entry was put straight back');
    globalThis.confirm = () => true;
    history.back();
    await flush();
    assert.equal(builderOpen(), false);
  } finally {
    globalThis.builderDirty = realDirty; globalThis.confirm = realConfirm; globalThis.renderSettings = realSettings;
  }
});

test('the schedule sheet is on the stack: it files an entry and Back closes it', async () => {
  reset();
  const realClose = closeSchedule;
  const closed = [];
  closeSchedule = function () { closed.push(1); shellSheetClose('schedule'); };
  try {
    shellSheetOpen('schedule');
    assert.deepEqual(keys(), ['now|', 'now|sheet:schedule']);
    history.back();
    await flush();
    assert.deepEqual(shell.sheets, [], 'Back closed the sheet');
    assert.equal(closed.length, 1, 'through the sheet\'s own close, so its motion plays');
    assert.equal(history.i, 0);
  } finally { closeSchedule = realClose; }
});

test('Chat is a tab: openChat switches to it on the channel asked for, and Back leaves it', async () => {
  reset();
  setMemberRole('viewer');
  openChat('memes');
  assert.equal(activeTab(), 'chat');
  assert.equal(state.ui.chatChannel, 'memes');
  assert.ok(chatOpenNow());
  assert.deepEqual(keys(), ['now|', 'chat|'], 'one entry');
  openChat('general'); // already there (a notification tap): no second entry
  assert.deepEqual(keys(), ['now|', 'chat|']);
  assert.equal(state.ui.chatChannel, 'general');
  history.back();
  await flush();
  assert.equal(activeTab(), 'now');
  assert.notOk(chatOpenNow(), 'Back left the Chat tab');
});

test('a takeover over the Chat tab is not "chat open": nothing counts as read behind it', () => {
  reset();
  setMemberRole('viewer');
  openChat('general');
  assert.ok(chatOpenNow());
  openGame(gid(), { from: 'chat' });
  assert.notOk(chatOpenNow());
  closeGame();
  assert.ok(chatOpenNow());
  assert.equal(shellGameBackLabel(allGames()[0]), 'Chat', 'and a game opened from Chat comes back to Chat');
});

test('a counselor the editors hid chat from keeps the tab and is told it is off', () => {
  reset();
  setMemberRole('viewer');
  state.meta.hiddenCards = { chat: true };
  try {
    const view = document.getElementById('chat-view');
    view.dataset.chatShell = '';
    showTab('chat');
    assert.ok(/turned off/i.test(String(view.innerHTML)));
    assert.equal(activeTab(), 'chat', 'the four tabs never change shape');
    assert.notOk(chatBuilt(), 'and no composer was built');
  } finally {
    state.meta.hiddenCards = {};
    document.getElementById('chat-view').dataset.chatShell = '';
    setMemberRole('editor');
  }
});

test('the chat tab\'s unread count is patched in place, capped, and named for screen readers', () => {
  reset();
  const badge = document.getElementById('tab-badge-chat');
  const btn = document.getElementById('tab-btn-chat');
  const attrs = new Map();
  btn.getAttribute = (n) => (attrs.has(n) ? attrs.get(n) : null);
  btn.setAttribute = (n, v) => attrs.set(n, v);
  const realUnread = unreadTotal;
  try {
    unreadTotal = () => 3;
    renderTabBadges();
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, '3');
    assert.equal(attrs.get('aria-label'), 'Chat, 3 unread', 'never colour or a number alone');
    unreadTotal = () => 140;
    renderTabBadges();
    assert.equal(badge.textContent, '99+');
    unreadTotal = () => 0;
    renderTabBadges();
    assert.equal(badge.hidden, true);
    assert.equal(attrs.get('aria-label'), 'Chat');
  } finally { unreadTotal = realUnread; }
});

test('the keyboard rule: the tab bar steps away on a text field, not on a chip, and returns after a beat', async () => {
  reset();
  const field = (tagName, extra) => Object.assign({ tagName, isContentEditable: false, type: 'text' }, extra);
  document.activeElement = field('INPUT');
  assert.ok(textEntryFocused());
  document.activeElement = field('TEXTAREA');
  assert.ok(textEntryFocused());
  document.activeElement = field('JELLY-INPUT');
  assert.ok(textEntryFocused());
  document.activeElement = field('DIV', { isContentEditable: true });
  assert.ok(textEntryFocused());
  document.activeElement = field('JELLY-BUTTON');
  assert.notOk(textEntryFocused(), 'a tapped button is not typing');
  document.activeElement = field('INPUT', { type: 'checkbox' });
  assert.notOk(textEntryFocused());
  // It is NOT fieldFocused(): the chat composer must count here (that one says no inside #chat-view).
  const input = field('INPUT', { closest: (sel) => (sel === '#chat-view' ? {} : null) });
  document.activeElement = input;
  assert.notOk(fieldFocused(), 'chat does not defer scoreboard updates');
  assert.ok(textEntryFocused(), 'but it does hide the tab bar');
  shellSyncKeyboard();
  assert.ok(classes.has('kb-open'), 'at once on focus');
  document.activeElement = field('JELLY-BUTTON');
  shellSyncKeyboard(); // focusout
  assert.ok(classes.has('kb-open'), 'not yet: moving between fields must not flicker the bar');
  await new Promise((r) => setTimeout(r, 160));
  assert.notOk(classes.has('kb-open'), 'gone after a beat');
  document.activeElement = null;
});

test('the keyboard height rides on a CSS variable from the visual viewport', () => {
  const props = {};
  const realStyle = document.documentElement.style;
  document.documentElement.style = { setProperty: (k, v) => { props[k] = v; }, removeProperty() {} };
  window.visualViewport = { height: 500, offsetTop: 0 };
  window.innerHeight = 844;
  try {
    shellSyncViewport();
    assert.equal(props['--kb-h'], '344px');
    window.visualViewport = { height: 844, offsetTop: 0 };
    shellSyncViewport();
    assert.equal(props['--kb-h'], '0px');
  } finally {
    document.documentElement.style = realStyle;
    delete window.visualViewport;
  }
});

test('a deep link closes what is stacked over the tabs before it goes there', async () => {
  reset();
  openGame(gid());
  assert.ok(shellOpenTarget('chat:general'));
  assert.equal(state.ui.gameId, null, 'the takeover closed');
  assert.equal(activeTab(), 'chat');
  assert.notOk(shellOpenTarget('chat:no-such-channel'), 'an unknown channel is refused quietly');
  assert.notOk(shellOpenTarget('game:not-a-game'));
  assert.ok(shellOpenTarget('reveal'));
  assert.equal(activeTab(), 'now');
  await flush();
});

test('the push layer routes the new targets through the shell and still refuses unknown ones', () => {
  reset();
  pushHandleOpen('game:' + gid(), '');
  assert.equal(state.ui.gameId, gid());
  pushHandleOpen('alert:abc', '');
  assert.equal(activeTab(), 'now');
  assert.equal(state.ui.gameId, null);
  pushHandleOpen('chat:general', '');
  assert.equal(activeTab(), 'chat');
  const before = activeTab();
  pushHandleOpen('game:<script>', '');
  pushHandleOpen('settings', '');
  assert.equal(activeTab(), before, 'junk is ignored');
});

test('sw.js needs no change for the new targets: nothing sends them yet and the unknown-target fallback opens Now', () => {
  // The sender (push-worker) emits chat:<ch>, schedule or nothing, and sw.js's
  // payload validator drops any other `open` to '' — which opens the app on Now,
  // exactly where reveal and alert:<id> land anyway. When Step 23 starts sending
  // `reveal`, sw.js's regex and PUSH_SW_VERSION change together with the Worker.
  const sw = readFixture('../sw.js');
  assert.ok(/\(chat:\[a-z0-9_-\]\{1,32\}\|schedule\)/.test(sw), 'the allowlist is still chat + schedule');
  const worker = readFixture('../push-worker/worker.js');
  assert.notOk(/open: ['`](reveal|game:|alert:)/.test(worker), 'and the Worker sends none of the new targets');
});
