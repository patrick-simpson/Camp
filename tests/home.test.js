// Home-screen panels that re-render on every snapshot and every 30 s tick:
// the rain hint must not rebuild the Happening-now bar, idle renders must not
// rewrite plain panels (that drops selected text), a points-pulse must survive
// the next render, toasts are capped and plain text, and the announcement
// composer's live <input> survives a banner change. The visible effect of each
// is only checkable in a browser; these pin the rules the fixes rest on.

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

// ── Happening now: the rain hint is patched, never part of the shape ──

test('splitNowBanner: the bar value and the rain hint never change the shape', () => {
  const main = (v, hint, label) => `<div class="now-main"><div class="now-body"><div class="now-label">${label || 'Worship'}</div>${hint}</div></div>` +
    `<jelly-progress class="now-progress" size="small" value="${v}" max="100" aria-hidden="true"></jelly-progress>`;
  const wx = (t) => `<div class="now-wx">🌧️ ${t}</div>`;
  const a = splitNowBanner(main(40, wx('60% chance of rain near 8pm')));
  const b = splitNowBanner(main(41, wx('60% chance of rain this hour')));
  const c = splitNowBanner(main(42, ''));
  assert.equal(a.shape, b.shape, 'the hint text changing at an hour rollover is not a new shape');
  assert.equal(a.shape, c.shape, 'the hint appearing or clearing is not a new shape');
  assert.equal(a.value, '40');
  assert.equal(c.value, '42');
  assert.equal(b.wx, wx('60% chance of rain this hour'));
  assert.equal(c.wx, '');
  assert.notOk(splitNowBanner(main(42, '', 'Dinner')).shape === c.shape, 'a different block IS a new shape (the bar refills for it)');
  const none = splitNowBanner(null);
  assert.equal(none.shape, '');
  assert.equal(none.value, null);
});

test('nowBannerHtml: a rain hint that moves mid-block leaves the banner shape alone', () => {
  const realNow = campNow;
  const realWx = weatherData;
  try {
    campNow = () => ({ dow: 0, minutes: 900 }); // Sunday 3pm — a timed block with a bar
    const date = campDateStr();
    const forecast = (byHour) => {
      const byTime = {};
      for (let h = 0; h < 24; h++) byTime[`${date}T${String(h).padStart(2, '0')}:00`] = { temp: 60, code: 3, precip: byHour[h] == null ? 10 : byHour[h] };
      return { dates: [date], byTime, at: Date.now() };
    };
    const at = (byHour) => { weatherData = forecast(byHour); return splitNowBanner(nowBannerHtml(0, 900)); };
    const dry = at({});
    const now = at({ 15: 60 });
    const later = at({ 16: 70 });
    assert.ok(dry.value != null, 'precondition: this block has a progress bar');
    assert.equal(dry.wx, '');
    assert.ok(/this hour/.test(now.wx), now.wx);
    assert.ok(/near 4pm/.test(later.wx), later.wx);
    assert.equal(now.shape, dry.shape);
    assert.equal(later.shape, dry.shape);
  } finally {
    campNow = realNow;
    weatherData = realWx;
  }
});

// renderNowBanner against a hand-rolled banner: the stub DOM can't tell a kept
// node from a re-created one, so this fake counts exactly what the render does.
function fakeNowBanner() {
  const bar = { v: '40', sets: 0, getAttribute(k) { return k === 'value' ? this.v : null }, setAttribute(k, v) { if (k === 'value') { this.v = v; this.sets++; } } };
  const body = { inserted: [], insertAdjacentHTML(pos, html) { this.inserted.push({ pos, html }); } };
  const banner = { hidden: false, wx: null, bar, body };
  banner.querySelector = (sel) => {
    if (!banner.innerHTML) return null; // nothing built yet (or cleared)
    if (sel === 'jelly-progress.now-progress') return bar;
    if (sel === '.now-wx') return banner.wx;
    if (sel === '.now-body') return body;
    return null;
  };
  const writes = countWrites(banner);
  return { banner, bar, body, writes };
}

test('renderNowBanner patches the bar and the rain hint in place, rebuilding only for a new block', () => {
  const realGet = document.getElementById;
  const realHtml = nowBannerHtml;
  const realBoard = homeBoardGame;
  const realNow = campNow;
  const { banner, bar, body, writes } = fakeNowBanner();
  const page = (v, wx, label) => `<div class="now-main"><div class="now-body"><div class="now-label">${label || 'Worship'}</div>${wx || ''}</div></div>` +
    `<jelly-progress class="now-progress" size="small" value="${v}" max="100" aria-hidden="true"></jelly-progress>`;
  const wx = (t) => `<div class="now-wx">🌧️ ${t}</div>`;
  let html = '';
  let board = false;
  document.getElementById = (id) => (id === 'now-banner' ? banner : realGet.call(document, id));
  nowBannerHtml = () => html;
  homeBoardGame = () => (board ? { id: 'g' } : null);
  campNow = () => ({ dow: 0, minutes: 900 });
  try {
    html = page(40);
    renderNowBanner();
    assert.equal(writes(), 1, 'first paint builds the markup');

    html = page(41);
    renderNowBanner();
    assert.equal(writes(), 1, 'only the elapsed value moved: nudge the live bar');
    assert.equal(bar.v, '41');

    html = page(42, wx('60% chance of rain this hour'));
    renderNowBanner();
    assert.equal(writes(), 1, 'a hint appearing does not rebuild the bar');
    assert.deepEqual(body.inserted.map((i) => i.pos), ['beforeend']);
    assert.equal(body.inserted[0].html, wx('60% chance of rain this hour'));

    banner.wx = { outerHTML: wx('60% chance of rain this hour'), removed: false, remove() { this.removed = true; } };
    const node = banner.wx;
    html = page(42, wx('70% chance of rain near 4pm'));
    renderNowBanner();
    assert.equal(writes(), 1, 'a hint changing does not rebuild the bar');
    assert.equal(node.outerHTML, wx('70% chance of rain near 4pm'), 'the hint is replaced in place');

    const sets = bar.sets;
    renderNowBanner();
    assert.equal(bar.sets, sets, 'nothing moved: nothing touched');
    assert.equal(body.inserted.length, 1);

    html = page(43);
    renderNowBanner();
    assert.ok(node.removed, 'a cleared hint is removed in place');
    assert.equal(writes(), 1);

    // A live match's Big Board hides the banner, and the bar must survive that.
    board = true;
    renderNowBanner();
    assert.equal(banner.hidden, true);
    assert.equal(writes(), 1, 'hiding keeps the markup — a cleared bar refilled from empty when it came back');
    board = false;
    html = page(44);
    renderNowBanner();
    assert.equal(banner.hidden, false);
    assert.equal(writes(), 1, 'same block on return: the kept bar is nudged, not re-created');
    assert.equal(bar.v, '44');

    html = page(5, '', 'Dinner');
    renderNowBanner();
    assert.equal(writes(), 2, 'a different block IS a rebuild');
  } finally {
    document.getElementById = realGet;
    nowBannerHtml = realHtml;
    homeBoardGame = realBoard;
    campNow = realNow;
  }
});

// ── Idle renders leave plain panels alone ──

test('the home panels that rebuild on every snapshot go through the guard', () => {
  const src = readFixture('../app.js');
  const body = (name) => {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start > -1, name + ' exists');
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  ['renderNoticeBoard', 'renderMyElectives', 'renderCatchupHint', 'renderStandings']
    .forEach((fn) => assert.ok(body(fn).includes('setHtmlIfChanged('), fn + ' skips unchanged rebuilds'));
  assert.notOk(/innerHTML\s*=/.test(body('renderNoticeBoard')), 'the notice card is never assigned directly');
  assert.notOk(/tbody\.innerHTML/.test(body('renderStandings')), 'standings rows are never assigned directly');
});

test('the posted notice card is not rewritten when nothing changed', () => {
  freshState();
  setMemberRole('editor');
  setNoticeStatus('posted');
  const writes = countWrites(document.getElementById('notice-board'));
  renderNoticeBoard();
  renderNoticeBoard();
  renderNoticeBoard();
  assert.equal(writes(), 1, 'one paint, then nothing');
  noticeBoard().title = 'A different headline';
  renderNoticeBoard();
  assert.equal(writes(), 2, 'a real change still repaints');
  setMemberRole(null);
});

test('My electives is not rewritten when nothing changed', () => {
  freshState();
  const realNow = campNow;
  try {
    campNow = () => ({ dow: 1, minutes: 600 });
    state.identity = 'Zac'; // on Monday's elective sheet
    const writes = countWrites(document.getElementById('my-electives-card'));
    renderMyElectives();
    renderMyElectives();
    assert.equal(writes(), 1);
    state.identity = null;
    renderMyElectives();
    assert.equal(document.getElementById('my-electives-card').hidden, true, 'no identity: the card hides');
  } finally {
    campNow = realNow;
    state.identity = null;
  }
});

function giveSomePoints() {
  freshState();
  setMemberRole('editor'); // the standings panels are directors' (standings secrecy); secrecy.test.js pins what a counselor sees
  state.config.games.slice(0, 3).forEach((g, i) => {
    state.results[g.id] = { medals: { gold: 't' + (i % 3), silver: 't' + ((i + 1) % 3), bronze: 't' + ((i + 2) % 3) }, savedAt: '2026-07-20T12:00:00Z' };
  });
  lastPointsByTeam = null;
  remoteJustApplied = false;
  Object.keys(pointsPulseUntil).forEach((k) => delete pointsPulseUntil[k]);
}

test('the standings table and catch-up hint are not rewritten by a render that changes nothing', () => {
  giveSomePoints();
  const tbody = countWrites(document.getElementById('standings-tbody'));
  const hint = countWrites(document.getElementById('catchup-hint'));
  renderStandings();
  renderStandings();
  renderStandings();
  assert.equal(tbody(), 1, 'rows built once');
  assert.equal(hint(), 1, 'hint built once');
  state.bonuses.pts1 = { id: 'pts1', teamId: 't0', category: 'custom', label: 'x', points: 4, at: '2026-07-20T12:05:00Z' };
  renderStandings();
  assert.equal(tbody(), 2, 'a points change still repaints the rows');
});

test('a points-pulse is held through the next render, then ends by itself', () => {
  giveSomePoints();
  const tbody = document.getElementById('standings-tbody');
  renderStandings(); // baseline: the first render never pulses
  assert.notOk(tbody.innerHTML.includes('points-pulse'));

  state.bonuses.pulse1 = { id: 'pulse1', teamId: 't0', category: 'custom', label: 'x', points: 3, at: '2026-07-20T12:05:00Z' };
  remoteJustApplied = true;
  renderStandings();
  assert.ok(tbody.innerHTML.includes('points-pulse'), 'the remote change pulses its row');

  const writes = countWrites(tbody, true);
  renderStandings(); // an unrelated snapshot / the 30 s tick lands inside the 0.6 s fade
  assert.ok(tbody.innerHTML.includes('points-pulse'), 'still pulsing — the animation is not cut off');
  assert.equal(writes(), 0, 'and the animating rows were not re-created');

  pointsPulseUntil.t0 = Date.now() - 1; // the window has passed
  renderStandings();
  assert.notOk(tbody.innerHTML.includes('points-pulse'), 'the class ends so the next change can pulse again');
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

// ── Announcement composer ──

test('a remote announcement swaps the banners and leaves the open composer alone', () => {
  freshState();
  setMemberRole('editor');
  const wrap = document.getElementById('announcements');
  wrap.__lastHtml = undefined;
  wrap.__lastComposerKey = undefined;
  wrap.hidden = true;
  announceComposerOpen = true;
  try {
    renderAnnouncements(); // first paint builds the composer
    const painted = wrap.innerHTML;
    assert.ok(painted.includes('announce-input'), 'precondition: the composer is up');

    const inserted = [];
    wrap.insertAdjacentHTML = (pos, html) => inserted.push({ pos, html });
    state.announcements = { a1: { id: 'a1', text: 'Dinner moved to six', at: new Date().toISOString(), ttlMs: 3600000, by: 'X' } };
    renderAnnouncements();
    assert.equal(wrap.innerHTML, painted, 'the composer markup was not rewritten, so its <input> keeps caret, focus and IME');
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].pos, 'afterbegin', 'banners sit above the composer');
    assert.ok(inserted[0].html.includes('Dinner moved to six'));

    renderAnnouncements(); // the 30 s tick: identical markup
    assert.equal(inserted.length, 1, 'nothing more to do');

    announceComposerOpen = false; // closing it is a real composer change
    renderAnnouncements();
    assert.notOk(wrap.innerHTML === painted, 'then it rebuilds');
    assert.ok(wrap.innerHTML.includes('announce-open-btn'));
  } finally {
    announceComposerOpen = false;
    state.announcements = {};
    setMemberRole(null);
    delete wrap.insertAdjacentHTML;
  }
});

test('the full-rebuild path restores focus and caret even with an empty draft, and rebuilds if the composer is gone', () => {
  freshState();
  setMemberRole('editor');
  const wrap = document.getElementById('announcements');
  wrap.__lastHtml = undefined;
  wrap.__lastBanners = undefined;
  wrap.__lastComposerKey = undefined;
  wrap.hidden = true;
  const realGet = document.getElementById;
  const input = {
    value: '', selectionStart: 3, selectionEnd: 5, focused: 0, range: null,
    focus() { this.focused++; },
    setSelectionRange(a, b) { this.range = [a, b]; },
  };
  document.getElementById = (id) => (id === 'announce-input' ? input : realGet.call(document, id));
  announceComposerOpen = true;
  try {
    renderAnnouncements();
    const first = wrap.innerHTML;
    assert.ok(first.includes('announce-input'), 'precondition: composer up');
    assert.equal(input.focused, 0, 'not focused, so the rebuild does not grab focus');

    // The composer closes while the (empty) box has focus: a real rebuild.
    document.activeElement = input;
    announceComposerOpen = false;
    renderAnnouncements();
    assert.equal(input.focused, 1, 'focus restored without a draft to carry');
    assert.deepEqual(input.range, [3, 5], 'caret restored');
    document.activeElement = null;

    // A banner-only change takes the in-place path only while the composer
    // node is really there; if it isn't, the whole strip is rebuilt.
    const realQuery = wrap.querySelector;
    wrap.querySelector = () => null;
    const before = wrap.innerHTML;
    state.announcements = { a2: { id: 'a2', text: 'Bring a towel', at: new Date().toISOString(), ttlMs: 3600000, by: 'X' } };
    renderAnnouncements();
    assert.ok(wrap.innerHTML !== before && wrap.innerHTML.includes('Bring a towel'), 'no composer node: rebuilt rather than patched');
    wrap.querySelector = realQuery;
  } finally {
    document.getElementById = realGet;
    document.activeElement = null;
    announceComposerOpen = false;
    state.announcements = {};
    setMemberRole(null);
  }
});

// ── Day-tab pill ──

test('settleDayTabPill snaps the pill onto its target at creation, and again after the re-sync', async () => {
  const seg = { pillX: -123, pillTarget: 62, pillXVelocity: 9, reflecting: false, frames: 0, requestFrame() { this.frames++; } };
  const tabs = { shadowRoot: { querySelector: (sel) => (sel === 'jelly-segmented' ? seg : null) } };
  settleDayTabPill(tabs);
  assert.equal(seg.pillX, 62, 'no spring from the first tab');
  assert.equal(seg.pillXVelocity, 0);
  assert.ok(seg.frames > 0, 'repaints at the new spot');
  seg.pillTarget = 124; // the segmented's own corrected sync lands a microtask later
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(seg.pillX, 124);
  assert.doesNotThrow(() => settleDayTabPill(null));
  assert.doesNotThrow(() => settleDayTabPill({}));
  assert.doesNotThrow(() => settleDayTabPill({ shadowRoot: { querySelector: () => ({}) } }), 'an element that is not a jelly-segmented is left alone');
});

test('the pill snap is creation-only — the change handler never calls it', () => {
  const src = readFixture('../app.js');
  const start = src.indexOf('function renderDayTabs(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.ok(body.includes('settleDayTabPill(tabs)'), 'a freshly built tab bar is settled');
  const handler = body.slice(body.indexOf("addEventListener('change'"), body.indexOf('settleDayTabPill(tabs)'));
  assert.ok(handler.length > 0 && !handler.includes('settleDayTabPill'), 'the spring is the point of a tap');
});
