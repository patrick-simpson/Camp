// The week builder (settings.js) — the state rules behind its render path.
// renderAll runs on every remote snapshot, and the builder used to rebuild its
// whole tab shell and all five cards each time: the page jumped to the top, the
// tab pill re-sprang from Games, and a phone froze for about a second. The
// visible effects need a browser (the Playwright pass); these pin the rules the
// fix rests on — a kept shell, an untouched unchanged card, and drafts that
// can neither strand a phone's sync nor silently vanish.

function fakeEl(extra) {
  const el = {
    innerHTML: '', hidden: false, value: '', dataset: {}, attrs: {}, listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    setAttribute(name, v) { this.attrs[name] = String(v); },
    querySelector: () => null,
    querySelectorAll: () => [],
    fire(type, detail) { (this.listeners[type] || []).forEach((fn) => fn({ detail, target: this })); },
  };
  return Object.assign(el, extra);
}

// A #settings-view whose shell writes are counted, handing back stable fake
// tabs/cards once the shell exists — enough to drive renderSettings and the
// handlers it wires (the shared stub's addEventListener is a no-op).
function mountBuilder() {
  const cards = {};
  SETTINGS_TABS.forEach((t) => { cards[t.key] = fakeEl(); });
  const tabs = fakeEl();
  const updated = fakeEl();
  const back = fakeEl();
  // The reminder slot every non-games panel carries (syncUnsavedNotes).
  const notes = SETTINGS_TABS.filter((t) => t.key !== 'games').map(() => fakeEl());
  let html = '';
  const view = fakeEl({ shellWrites: 0 });
  Object.defineProperty(view, 'innerHTML', {
    get: () => html,
    set: (v) => { html = v; view.shellWrites += 1; },
  });
  view.querySelectorAll = (sel) => (view.shellWrites && sel === '.settings-unsaved' ? notes : []);
  view.querySelector = (sel) => {
    if (!view.shellWrites) return null;
    if (sel === 'jelly-tabs.settings-tabs') return tabs;
    if (sel === '.settings-updated') return updated;
    const m = /\[data-settings-card="(\w+)"\]/.exec(sel);
    return m ? cards[m[1]] : null;
  };
  const realGet = document.getElementById;
  document.getElementById = (id) => (id === 'settings-view' ? view : id === 'settings-back-btn' ? back : realGet(id));
  window.scrollTo = () => {};
  return { view, tabs, cards, updated, back, notes, unmount: () => { document.getElementById = realGet; } };
}

function openBuilderOn(tab) {
  freshState();
  setMemberRole('editor');
  state.ui.view = 'settings';
  state.ui.settingsTab = tab;
  state.ui.editGameId = null;
  gameDraft = null;
  gameDraftFor = null;
}

// A manual clock in place of the context's timers: the idle prefill, the joy
// press delay and the card-opening class all hang off setTimeout.
function withFakeTimers(fn) {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  let now = 0, nextId = 0;
  const queue = new Map();
  globalThis.setTimeout = (cb, ms) => { queue.set(++nextId, { at: now + (ms || 0), cb }); return nextId; };
  globalThis.clearTimeout = (id) => { queue.delete(id); };
  const clock = {
    pending: () => queue.size,
    advance(ms) {
      now += ms;
      [...queue].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)
        .forEach(([id, t]) => { if (queue.delete(id)) t.cb(); });
    },
  };
  try { return fn(clock); } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
}

function withJellyTabs(fn) {
  globalThis.customElements = { get: (name) => (name === 'jelly-tabs' ? function JellyTabs() {} : undefined) };
  builderPrefillTimer = 0; // a slice queued on a previous fake clock never fires
  try { return withFakeTimers(fn); } finally { delete globalThis.customElements; builderPrefillTimer = 0; }
}

test('the tab shell is built once; later renders only set what changed', () => {
  openBuilderOn('days');
  const b = mountBuilder();
  try {
    renderSettings();
    assert.equal(b.view.shellWrites, 1, 'first render builds the shell');
    renderSettings();
    renderSettings();
    assert.equal(b.view.shellWrites, 1, 'a re-render keeps the same jelly-tabs (no re-spring, no scroll clamp)');
    state.ui.settingsTab = 'teams';
    renderSettings();
    assert.equal(b.view.shellWrites, 1, 'a programmatic tab change does not rebuild the shell either');
    assert.equal(b.tabs.getAttribute('value'), 'teams', '...it just moves the tabs value');
  } finally { b.unmount(); }
});

test('an unchanged card is not rewritten; a changed one is', () => {
  openBuilderOn('days');
  const b = mountBuilder();
  try {
    withJellyTabs(() => {
      renderSettings();
      const first = b.cards.days.innerHTML;
      assert.ok(first.includes('Days ('), 'the active card was filled');
      let writes = 0;
      let html = first;
      Object.defineProperty(b.cards.days, 'innerHTML', { get: () => html, set: (v) => { html = v; writes += 1; } });
      renderSettings();
      assert.equal(writes, 0, 'nothing changed ⇒ the card (and its Jelly controls) are left alone');
      state.config.days.push({ id: 'd-test', name: 'Bonus day', dow: null, note: '' });
      renderSettings();
      assert.equal(writes, 1, 'a real change is written');
    });
  } finally { b.unmount(); }
});

test('only the active card renders while the tab bar exists; a hidden one fills when shown', () => {
  openBuilderOn('games');
  const b = mountBuilder();
  try {
    withJellyTabs(() => {
      renderSettings();
      assert.ok(b.cards.games.innerHTML.includes('new-game-btn'), 'active card filled');
      assert.equal(b.cards.notice.innerHTML, '', 'hidden cards are not built on every renderAll');
      b.tabs.fire('change', { value: 'notice' });
      assert.equal(state.ui.settingsTab, 'notice');
      assert.ok(b.cards.notice.innerHTML.includes('notice-post-btn'), 'shown card filled by the tab change itself');
    });
  } finally { b.unmount(); }
});

test('without the Jelly module every card is still filled (no tab bar to reveal them)', () => {
  openBuilderOn('teams');
  const b = mountBuilder();
  try {
    renderSettings(); // the harness has no customElements — same as html.jelly-failed
    SETTINGS_TABS.forEach((t) => assert.ok(b.cards[t.key].innerHTML.length > 0, t.key + ' filled'));
  } finally { b.unmount(); }
});

test('a score landing does not change the Games list markup (dots are patched in place)', () => {
  openBuilderOn('games');
  const card = fakeEl();
  renderGamesTab(card);
  const before = card.innerHTML;
  assert.ok(before.includes('class="result-dot"'), 'every row carries its (hidden) dot');
  const g = state.config.games[0];
  state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: 'x' };
  renderGamesTab(card);
  assert.equal(card.innerHTML, before, 'same markup ⇒ ~70 Jelly controls are not rebuilt for a result dot');
});

test('switching tabs keeps an open game editor and its unsaved draft', () => {
  openBuilderOn('games');
  const b = mountBuilder();
  try {
    state.ui.editGameId = state.config.games[0].id;
    renderSettings();
    gameDraft.name = 'Half-typed name';
    assert.ok(builderDirty(), 'precondition: dirty');
    b.tabs.fire('change', { value: 'days' });
    assert.equal(state.ui.settingsTab, 'days');
    assert.equal(state.ui.editGameId, state.config.games[0].id, 'editor still open behind the Games tab');
    assert.equal(gameDraft.name, 'Half-typed name', 'draft kept — no silent discard');
    assert.ok(builderDirty(), 'still dirty, so remote merges and auto-reload keep holding off');
    b.tabs.fire('change', { value: 'games' });
    assert.equal(gameDraft.name, 'Half-typed name', 'and it is there on return');
  } finally { b.unmount(); }
});

test('Back to scoreboard with a dirty draft asks; Cancel keeps it, OK drops it', () => {
  openBuilderOn('games');
  const b = mountBuilder();
  const realConfirm = globalThis.confirm;
  try {
    state.ui.editGameId = state.config.games[0].id;
    renderSettings();
    gameDraft.name = 'Half-typed name';
    b.tabs.fire('change', { value: 'teams' });

    let asked = null;
    globalThis.confirm = (msg) => { asked = msg; return false; };
    b.back.fire('click');
    assert.ok(asked && asked.includes('Half-typed name'), 'names the game, since the editor may be on another tab: ' + asked);
    assert.equal(state.ui.view, 'settings', 'Cancel stays in the builder');
    assert.equal(state.ui.settingsTab, 'games', '...on the Games tab, where the draft is');
    assert.ok(gameDraft, 'draft kept');

    globalThis.confirm = () => true;
    b.back.fire('click');
    assert.equal(state.ui.view, 'home');
    assert.equal(state.ui.editGameId, null);
    assert.equal(gameDraft, null, 'no draft stranded behind the closed builder');
    assert.notOk(editorMidEntry(), 'so this phone keeps adopting other editors\' scores');
  } finally { globalThis.confirm = realConfirm; b.unmount(); }
});

test('a clean Back asks nothing', () => {
  openBuilderOn('games');
  const b = mountBuilder();
  const realConfirm = globalThis.confirm;
  try {
    state.ui.editGameId = state.config.games[0].id;
    renderSettings();
    let asked = 0;
    globalThis.confirm = () => { asked += 1; return true; };
    b.back.fire('click');
    assert.equal(asked, 0);
    assert.equal(state.ui.view, 'home');
  } finally { globalThis.confirm = realConfirm; b.unmount(); }
});

test('a draft stranded behind a closed builder never counts as mid-entry', () => {
  openBuilderOn('games');
  state.ui.editGameId = state.config.games[0].id;
  ensureGameDraft();
  gameDraft.name += 'X';
  assert.ok(builderDirty());
  state.ui.view = 'home'; // however it got closed
  assert.notOk(builderDirty(), 'builderDirty is about an OPEN editor');
  assert.notOk(editorMidEntry());
});

test('losing editor access closes the builder AND drops the draft', () => {
  openBuilderOn('games');
  state.ui.editGameId = state.config.games[0].id;
  ensureGameDraft();
  gameDraft.name += 'X';
  setMemberRole('viewer');
  renderAll();
  assert.equal(state.ui.view, 'home');
  assert.equal(gameDraft, null);
  assert.equal(state.ui.editGameId, null);
  setMemberRole('editor');
});

test('a clean open editor picks up another editor\'s change to that game', () => {
  openBuilderOn('games');
  const g = state.config.games[0];
  state.ui.editGameId = g.id;
  ensureGameDraft();
  const draftBefore = gameDraft;
  // The same game echoed back key-sorted by RTDB is NOT a change.
  state.config.games[0] = JSON.parse(JSON.stringify(syncCanon(g)));
  ensureGameDraft();
  assert.equal(gameDraft, draftBefore, 'a key-order-only echo keeps the draft');
  state.config.games[0] = Object.assign({}, state.config.games[0], { headline: 'Changed elsewhere' });
  ensureGameDraft();
  assert.equal(gameDraft.headline, 'Changed elsewhere', 'clean draft refreshed — Save can no longer revert it');
  assert.notOk(JSON.stringify(gameDraft) !== gameDraftSnapshot, 'and it is still clean');
});

test('a dirty editor keeps the user\'s edits over a remote change', () => {
  openBuilderOn('games');
  state.ui.editGameId = state.config.games[0].id;
  ensureGameDraft();
  gameDraft.name = 'Mine';
  state.config.games[0] = Object.assign({}, state.config.games[0], { headline: 'Changed elsewhere' });
  ensureGameDraft();
  assert.equal(gameDraft.name, 'Mine', 'typed edits are never thrown away by a sync');
});

test('a config echo of this device\'s own edit does not re-render; a real change does', () => {
  freshState();
  setMemberRole('editor');
  const wasStarted = appStarted;
  appStarted = true;
  const realRenderAll = renderAll;
  let renders = 0;
  renderAll = () => { renders += 1; };
  try {
    state.config.days.push({ id: 'd-new', name: 'New day', dow: null, note: '' });
    // What RTDB hands back: keys sorted, the null dropped.
    applyRemoteConfig(JSON.parse(JSON.stringify(syncCanon(state.config))));
    assert.equal(renders, 0, 'own echo: no second full rebuild');
    const changed = JSON.parse(JSON.stringify(state.config));
    changed.days[0].name = 'Renamed elsewhere';
    applyRemoteConfig(changed);
    assert.equal(renders, 1, 'somebody else\'s edit still renders');
  } finally { renderAll = realRenderAll; appStarted = wasStarted; remoteJustApplied = false; }
});

test('a remote copy of the notice leaves an unchanged Notice card alone, and its kept listeners edit the live notice', () => {
  openBuilderOn('notice');
  const card = fakeEl();
  const addStep = fakeEl();
  const realGet = document.getElementById;
  document.getElementById = (id) => (id === 'notice-add-step' ? addStep : realGet(id));
  window.scrollTo = () => {};
  try {
    renderNoticeTab(card);
    let writes = 0;
    let html = card.innerHTML;
    Object.defineProperty(card, 'innerHTML', { get: () => html, set: (v) => { html = v; writes += 1; } });
    state.notice = JSON.parse(JSON.stringify(state.notice)); // what a remote snapshot hands over
    renderNoticeTab(card);
    assert.equal(writes, 0, 'same notice in a new object: no rebuild (a Notice rebuild is ~5k px of Jelly controls)');
    const before = state.notice.steps.length;
    addStep.fire('click');
    assert.equal(state.notice.steps.length, before + 1, 'the listener wired to the OLD object edited the live notice, not an orphan');
  } finally { document.getElementById = realGet; }
});

test('pasted restore text and its error survive a rebuild; a good import clears them', () => {
  openBuilderOn('data');
  restoreDraft = { text: '', error: '' };
  tryImport('{"not":"a backup"}');
  assert.ok(restoreDraft.error, 'error remembered');
  restoreDraft.text = '{"not":"a backup"}';
  const card = fakeEl();
  const ta = document.getElementById('restore-textarea');
  const errEl = document.getElementById('restore-error');
  ta.value = '';
  errEl.textContent = '';
  errEl.hidden = true;
  renderDataTab(card); // a (re)written card starts empty...
  assert.equal(ta.value, '{"not":"a backup"}', '...and gets the pasted text put back');
  assert.ok(errEl.textContent.startsWith("That doesn't") && !errEl.hidden, '...and the message, still showing');
  // The paste is NOT in the markup: typing must never make the card differ,
  // or the next unrelated renderAll would rebuild it under the user's fingers.
  const markup = card.innerHTML;
  restoreDraft.text = 'something else typed';
  restoreDraft.error = '';
  card.innerHTML = markup; // what the live card still holds
  card.__dom = markup;
  let rewrote = false;
  Object.defineProperty(card, 'innerHTML', { get: () => markup, set: () => { rewrote = true; } });
  renderDataTab(card);
  assert.notOk(rewrote, 'typing alone never rebuilds the Data card');
  tryImport(backupJSON());
  assert.equal(restoreDraft.text, '');
  assert.equal(restoreDraft.error, '');
});

test('"Last edited" is camp time, not the device\'s zone', () => {
  openBuilderOn('days');
  const b = mountBuilder();
  try {
    state.config.updatedAt = '2026-07-20T22:30:00Z';
    renderSettings();
    assert.ok(b.updated.innerHTML.includes('Jul 20, 6:30pm ET'), b.updated.innerHTML);
  } finally { b.unmount(); }
});

test('the card rise-in only runs while a card is opening, never on un-hide', () => {
  // A CSS animation restarts whenever an element goes display:none → shown, so
  // a rule keyed to [open] alone replayed on every open card each time the
  // builder or chat takeover closed.
  const css = readFixture('../styles.css');
  assert.notOk(/collapsible-card\[open\]\s*>\s*\*:not\(\[slot="header"\]\)\s*\{\s*animation:\s*joy-rise/.test(css),
    'joy-rise must be gated on the transient .card-opening class');
  assert.ok(/collapsible-card\.card-opening\[open\]\s*>\s*\*:not\(\[slot="header"\]\)\s*\{\s*animation:\s*joy-rise/.test(css));
});

// ── Review follow-ups ────────────────────────────────────────────

// A tiny element with a real class set, for the delegated joy handlers.
function classEl(extra) {
  const set = new Set();
  const el = {
    classes: set,
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) },
    closest() { return el; },
  };
  return Object.assign(el, extra);
}

// Run the document-level listeners app.js registered at load, over elements.
function withJoyDom(fn) {
  const els = [];
  const realAll = document.querySelectorAll;
  document.querySelectorAll = (sel) => (sel === '.joy-pressed' ? els.filter((e) => e.classes.has('joy-pressed')) : []);
  const fire = (type, ev) => (__docListeners[type] || []).forEach((h) => h(ev || {}));
  const mk = () => { const e = classEl(); els.push(e); return e; };
  try { return withFakeTimers((clock) => fn({ fire, mk, clock })); } finally { document.querySelectorAll = realAll; }
}

test('a quick tap pops from rest; the press never paints (no 93% snap)', () => {
  withJoyDom(({ fire, mk, clock }) => {
    const btn = mk();
    fire('pointerdown', { target: btn, clientX: 10, clientY: 10 });
    clock.advance(40);
    assert.notOk(btn.classes.has('joy-pressed'), 'not yet pressed inside the delay');
    fire('pointerup');
    assert.ok(btn.classes.has('joy-pop-quick'), 'pop starts at scale(1), not at the pressed 0.93');
    assert.notOk(btn.classes.has('joy-pop') || btn.classes.has('joy-pressed'));
    clock.advance(460);
    assert.notOk(btn.classes.has('joy-pop-quick'), 'and clears itself');
  });
});

test('a held press shows after the delay and pops from the pressed scale on release', () => {
  withJoyDom(({ fire, mk, clock }) => {
    const btn = mk();
    fire('pointerdown', { target: btn, clientX: 10, clientY: 10 });
    clock.advance(JOY_PRESS_DELAY_MS + 1);
    assert.ok(btn.classes.has('joy-pressed'));
    fire('pointerup');
    assert.notOk(btn.classes.has('joy-pressed'));
    assert.ok(btn.classes.has('joy-pop') && !btn.classes.has('joy-pop-quick'));
  });
});

test('a touch that turns into a scroll never shrinks the row', () => {
  withJoyDom(({ fire, mk, clock }) => {
    const row = mk();
    fire('pointerdown', { target: row, clientX: 10, clientY: 100 });
    fire('pointermove', { clientX: 10, clientY: 100 + JOY_PRESS_SLOP_PX }); // within slop: still a press
    assert.ok(joyPress, 'a jitter inside the slop keeps the press pending');
    fire('pointermove', { clientX: 10, clientY: 100 + JOY_PRESS_SLOP_PX + 4 });
    assert.equal(joyPress, null, 'travel past the slop calls it off');
    clock.advance(500);
    assert.equal(row.classes.size, 0, 'the delay timer was cancelled — nothing ever painted');
    assert.equal(clock.pending(), 0);
  });
});

test('a press already showing eases back (joy-release) when the touch becomes a scroll or cancels', () => {
  withJoyDom(({ fire, mk, clock }) => {
    const row = mk();
    fire('pointerdown', { target: row, clientX: 10, clientY: 100 });
    clock.advance(JOY_PRESS_DELAY_MS + 1);
    fire('pointermove', { clientX: 10, clientY: 140 });
    assert.notOk(row.classes.has('joy-pressed'));
    assert.ok(row.classes.has('joy-release'), 'eased, not snapped');
    clock.advance(200);
    assert.notOk(row.classes.has('joy-release'));

    const row2 = mk();
    fire('pointerdown', { target: row2, clientX: 10, clientY: 100 });
    fire('pointercancel');
    clock.advance(500);
    assert.equal(row2.classes.size, 0, 'a cancelled touch leaves nothing behind');
  });
});

test('a card only gets .card-opening when ITS toggle opens it, and only briefly', () => {
  // Behavioural twin of the stylesheet check above: the class is what the CSS
  // rise-in is keyed to, so a toggle from anything else must not add it.
  withFakeTimers((clock) => {
    const toggle = __docListeners.toggle[0];
    assert.ok(toggle, 'app.js registers the capture-phase toggle listener');
    const card = classEl({ matches: (sel) => sel === 'jelly-collapsible.collapsible-card', hasAttribute: (n) => n === 'open' });
    toggle({ target: card });
    assert.ok(card.classes.has('card-opening'));
    clock.advance(300);
    toggle({ target: card }); // re-armed, not stacked
    clock.advance(500);
    assert.ok(card.classes.has('card-opening'), 'the second toggle restarted the 700ms window');
    clock.advance(300);
    assert.notOk(card.classes.has('card-opening'), 'and it comes off, so un-hiding never replays the rise');

    const closed = classEl({ matches: () => true, hasAttribute: () => false });
    toggle({ target: closed });
    assert.notOk(closed.classes.has('card-opening'), 'a card that CLOSED does not rise');
    const details = classEl({ matches: () => false, hasAttribute: () => true });
    toggle({ target: details });
    assert.notOk(details.classes.has('card-opening'), 'a <details> inside a card does not re-run the card');
  });
});

test('the quick-tap pop keyframes start at rest', () => {
  const css = readFixture('../styles.css');
  assert.ok(/@keyframes joy-pop-quick\s*\{\s*0%\s*\{\s*transform:\s*scale\(1\)/.test(css));
});

test('Back to scoreboard puts the scoreboard back where it was scrolled', () => {
  freshState();
  setMemberRole('editor');
  const b = mountBuilder();
  const scrolls = [];
  try {
    window.scrollTo = (x, y) => scrolls.push([x, y]);
    window.scrollY = 700;
    openBuilder('games');
    assert.equal(builderReturnY, 700, 'remembered when the builder opened (the page collapses behind it)');
    window.scrollY = 0;
    scrolls.length = 0;
    b.back.fire('click');
    assert.equal(state.ui.view, 'home');
    assert.deepEqual(scrolls[scrolls.length - 1], [0, 700], 'positional scrollTo — instant, no smooth-scroll CSS');
  } finally { window.scrollY = 0; window.scrollTo = () => {}; b.unmount(); }
});

test('a new tab pill is snapped home; a user\'s own tap keeps the spring', () => {
  openBuilderOn('days');
  const b = mountBuilder();
  const seg = { pillTarget: 120, pillX: 0, pillXVelocity: 9, frames: 0, requestFrame() { this.frames += 1; } };
  b.tabs.shadowRoot = { querySelector: (sel) => (sel === 'jelly-segmented' ? seg : null) };
  try {
    renderSettings();
    assert.equal(seg.pillX, 120, 'first placement: no wobble over the Games label');
    assert.equal(seg.pillXVelocity, 0);
    assert.ok(seg.frames >= 1, 'a frame is requested so the snap paints');
    seg.pillX = 40; seg.pillXVelocity = 3;
    state.ui.settingsTab = 'teams';
    renderSettings();
    assert.equal(seg.pillX, 120, 'a programmatic tab change settles too');
    seg.pillX = 40; seg.pillXVelocity = 3;
    b.tabs.fire('change', { value: 'notice' });
    assert.equal(seg.pillX, 40, 'the person tapped it: the spring is theirs to enjoy');
    // Not a number yet (segments not upgraded): leave it alone.
    const before = JSON.stringify(seg);
    seg.pillTarget = undefined;
    settleBuilderTabPill(b.tabs);
    assert.equal(JSON.stringify(seg), before.replace('"pillTarget":120,', ''));
  } finally { b.unmount(); }
});

test('a refresh keeps the disclosure open; a different game starts closed', () => {
  openBuilderOn('games');
  const [g1, g2] = state.config.games;
  state.ui.editGameId = g1.id;
  ensureGameDraft();
  extrasOpen = true;
  state.config.games[0] = Object.assign({}, g1, { headline: 'Changed elsewhere' });
  ensureGameDraft(); // clean draft refreshed from the remote edit
  assert.equal(gameDraft.headline, 'Changed elsewhere');
  assert.equal(extrasOpen, true, 'the editor did not slam its extras shut under the user');
  state.ui.editGameId = g2.id;
  ensureGameDraft();
  assert.equal(extrasOpen, false, 'a different game is a new view');
});

test('validation says so where the person is looking: below Save, scrolled into view', () => {
  openBuilderOn('games');
  state.ui.editGameId = 'new';
  ensureGameDraft();
  gameDraft.name = '';
  const scrolled = [];
  const errEl = fakeEl({ hidden: true, textContent: '', scrollIntoView: (o) => scrolled.push(o) });
  const realGet = document.getElementById;
  document.getElementById = (id) => (id === 'gd-error' ? errEl : realGet(id));
  try {
    saveGameDraft();
    assert.equal(errEl.hidden, false);
    assert.equal(errEl.textContent, 'Give the game a name.');
    assert.deepEqual(scrolled, [{ block: 'nearest' }], 'the minimum scroll that reveals it — Save itself does not move');
  } finally { document.getElementById = realGet; }
  const src = readFixture('../settings.js');
  assert.ok(src.indexOf('id="gd-error"') > src.indexOf('id="gd-save-btn"'), 'the message element is below Save in the markup');
});

test('hidden cards are built one per idle slice after the active card, then left alone', () => {
  openBuilderOn('games');
  const b = mountBuilder();
  try {
    withJellyTabs((clock) => {
      renderSettings();
      assert.equal(b.cards.days.innerHTML, '', 'nothing hidden is built inside renderAll');
      assert.equal(clock.pending(), 1, 'one idle slice is queued');
      clock.advance(200);
      assert.ok(b.cards.days.innerHTML.length > 0, 'first slice: the next tab along');
      assert.equal(b.cards.teams.innerHTML, '', 'one card per slice, so no single long task');
      for (let i = 0; i < 6; i += 1) clock.advance(200);
      ['days', 'teams', 'notice', 'data'].forEach((k) => assert.ok(b.cards[k].innerHTML.length > 0, k + ' pre-built'));
      assert.equal(clock.pending(), 0, 'the chain ends by itself');
      // A later renderAll (a score landing) refreshes the active card only.
      b.cards.days.innerHTML = 'SENTINEL';
      renderSettings();
      assert.equal(b.cards.days.innerHTML, 'SENTINEL', 'a built hidden card is not rewritten by renderAll');
      assert.equal(clock.pending(), 0, 'and nothing is re-queued');
    });
  } finally { b.unmount(); }
});

test('the idle prefill stops if the builder was closed meanwhile', () => {
  openBuilderOn('games');
  const b = mountBuilder();
  try {
    withJellyTabs((clock) => {
      renderSettings();
      state.ui.view = 'home';
      clock.advance(500);
      assert.equal(b.cards.days.innerHTML, '', 'nothing built behind a closed builder');
      assert.equal(clock.pending(), 0);
    });
  } finally { b.unmount(); }
});

test('an unsaved game is flagged on the other tabs, with a link back to it', () => {
  openBuilderOn('games');
  const b = mountBuilder();
  try {
    withJellyTabs(() => {
      state.ui.editGameId = state.config.games[0].id;
      renderSettings();
      b.notes.forEach((n) => assert.equal(n.innerHTML, '', 'clean editor: no reminder'));
      gameDraft.name = 'Half-typed name';
      b.tabs.fire('change', { value: 'days' });
      b.notes.forEach((n) => {
        assert.ok(n.innerHTML.includes('Unsaved changes to &quot;Half-typed name&quot;') || n.innerHTML.includes('Unsaved changes to "Half-typed name"'), n.innerHTML);
        assert.ok(n.innerHTML.includes('data-act="unsaved-go"'));
      });
      // Tapping the link goes back to Games, editor and draft intact.
      const go = { closest: (sel) => (sel === '[data-act="unsaved-go"]' ? {} : null) };
      b.notes[0].listeners.click[0]({ target: go });
      assert.equal(state.ui.settingsTab, 'games');
      assert.equal(b.tabs.getAttribute('value'), 'games');
      assert.equal(gameDraft.name, 'Half-typed name');
      // A tap on some other part of the note does nothing.
      state.ui.settingsTab = 'days';
      b.notes[0].listeners.click[0]({ target: { closest: () => null } });
      assert.equal(state.ui.settingsTab, 'days');
      // Discarding the draft clears the reminders.
      gameDraft.name = state.config.games[0].name;
      gameDraftSnapshot = JSON.stringify(gameDraft);
      renderSettings();
      b.notes.forEach((n) => assert.equal(n.innerHTML, ''));
    });
  } finally { b.unmount(); }
});
