// Re-renders that change nothing must not touch the DOM. renderAll runs on
// every remote snapshot and the 30-second tick; rebuilding identical markup
// re-creates Jelly components (their canvases repaint from scratch, the
// now-banner's progress bar refilled from empty twice a minute) and image
// elements (the team shield blinked). The visible effect is only checkable in
// a browser; these pin the rule the fix rests on.

function fakeEl() {
  // innerHTML here is a plain property, so "the DOM changed" is simulated by
  // writing it directly — exactly what a chip toggling `selected` looks like
  // to setHtmlIfChanged (its light-DOM serialization moves).
  return { innerHTML: '' };
}

test('identical markup is written once, then skipped', () => {
  const el = fakeEl();
  assert.ok(setHtmlIfChanged(el, '<p>a</p>'), 'first write happens');
  assert.notOk(setHtmlIfChanged(el, '<p>a</p>'), 'same markup again is a no-op');
  assert.ok(setHtmlIfChanged(el, '<p>b</p>'), 'changed markup is written');
  assert.equal(el.innerHTML, '<p>b</p>');
});

test('a DOM changed by something else is rebuilt even when the markup matches', () => {
  const el = fakeEl();
  setHtmlIfChanged(el, '<jelly-chip selected>Mon</jelly-chip>');
  // The chip toggled itself off on a tap that didn't change the chosen day.
  el.innerHTML = '<jelly-chip>Mon</jelly-chip>';
  assert.ok(setHtmlIfChanged(el, '<jelly-chip selected>Mon</jelly-chip>'), 'rebuilt back to the true state');
  assert.equal(el.innerHTML, '<jelly-chip selected>Mon</jelly-chip>');
});

test('a panel cleared by another code path is refilled', () => {
  const el = fakeEl();
  setHtmlIfChanged(el, '<p>banner</p>');
  el.innerHTML = ''; // e.g. a panel whose markup another code path cleared
  assert.ok(setHtmlIfChanged(el, '<p>banner</p>'));
});

test('the home panels that re-render on every snapshot go through the guard', () => {
  const src = readFixture('../app.js');
  const body = (name) => {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start > -1, name + ' exists');
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  ['renderMemoryVerse', 'renderMealCleanup', 'renderTeamSheet']
    .forEach((fn) => assert.ok(body(fn).includes('setHtmlIfChanged('), fn + ' skips unchanged rebuilds'));
  // The Games tab's panels (games-ui.js): the day tabs, the day's blocks and the standings list write through the guard.
  const ui = readFixture('../games-ui.js');
  ['gamesPaintPicker', 'gamesPaintDay', 'gamesPaintStandings'].forEach((fn) => {
    const start = ui.indexOf('function ' + fn + '(');
    assert.ok(start > -1 && /setHtmlIfChanged\(|paintKeyedList\(/.test(ui.slice(start, ui.indexOf('\n}\n', start))), fn + ' skips unchanged rebuilds');
  });
  // The frame's volatile lines are text nodes patched in place, never rewritten.
  ['renderHeader', 'renderSyncPill', 'renderMoreFoot', 'renderAlertsState']
    .forEach((fn) => assert.ok(/setTextIfChanged\(|setHiddenIfChanged\(/.test(body(fn)), fn + ' patches in place'));
  assert.ok(body('paintTeamMark').includes('setHtmlIfChanged('), 'a team mark is written only when it would change');
  // The Now card's hairline is nudged in place, never refilled, when only the elapsed time moved (now-ui.test.js pins it by behaviour).
  assert.ok(/fill\.style\.setProperty\('--p'/.test(readFixture('../now-ui.js')));
});

// ── the frame's volatile lines, by behaviour (the source-text pin above can't see a
// regression that keeps the helper call and writes something else beside it) ──

// Count every write a property takes on a memoized stub element; returns a restore.
function countWrites(id, prop, tally, key) {
  const el = document.getElementById(id);
  const had = Object.prototype.hasOwnProperty.call(el, prop);
  const desc = Object.getOwnPropertyDescriptor(el, prop);
  let v = el[prop];
  Object.defineProperty(el, prop, { configurable: true, get: () => v, set: (x) => { v = x; tally[key] = (tally[key] || 0) + 1; } });
  return () => { delete el[prop]; if (had && desc) Object.defineProperty(el, prop, desc); el[prop] = v; };
}

test('a connection flicker writes the pill and nothing else: the identity block and the team mark are left alone', () => {
  freshState();
  setMemberRole('viewer');
  memberName = 'Sam';
  state.followTeam = 't1';
  const saveNv = newVersionSeen;
  newVersionSeen = false;
  renderHeader(); // settle: the shield is drawn once
  const w = {};
  const undo = [
    countWrites('hdr-mark', 'innerHTML', w, 'mark'),
    countWrites('hdr-name', 'textContent', w, 'name'),
    countWrites('hdr-sub', 'textContent', w, 'sub'),
    countWrites('hdr-who', 'textContent', w, 'who'),
    countWrites('hdr-pill-text', 'textContent', w, 'pillText'),
    countWrites('hdr-pill', 'hidden', w, 'pillHidden'),
  ];
  try {
    renderHeader();
    assert.deepEqual(w, {}, 'an idle render writes nothing at all: ' + JSON.stringify(w));
    newVersionSeen = true; // the pill appears
    renderHeader();
    assert.equal(w.pillText, 1);
    assert.equal(w.pillHidden, 1);
    assert.equal(w.mark || 0, 0, 'the shield is not re-created by a pill flip');
    assert.equal((w.name || 0) + (w.sub || 0) + (w.who || 0), 0, 'nor is any identity text rewritten');
    renderHeader();
    renderHeader();
    assert.equal(w.pillText, 1, 'the same pill twice is one write');
    newVersionSeen = false; // and goes
    renderHeader();
    assert.equal(w.pillHidden, 2);
    assert.equal(w.mark || 0, 0);
  } finally { undo.forEach((u) => u()); newVersionSeen = saveNv; }
});

test('More\'s volatile lines change without touching a segmented control', () => {
  freshState();
  setMemberRole('editor');
  const sets = { n: 0 };
  const fake = (id, values) => {
    const attrs = values.map(() => new Map());
    const btns = values.map((v, i) => ({
      dataset: { value: v },
      getAttribute: (n) => (attrs[i].has(n) ? attrs[i].get(n) : null),
      setAttribute: (n, x) => { sets.n += 1; attrs[i].set(n, String(x)); },
    }));
    document.getElementById(id).querySelectorAll = () => btns;
    return btns;
  };
  const theme = fake('theme-toggle', ['light', 'auto', 'dark']);
  const calm = fake('calm-toggle', ['auto', 'on', 'off']);
  const camp = fake('camp-switch', ['junior', 'senior']);
  renderMore(); // paints each control once
  assert.ok(sets.n > 0, 'the first pass paints the segments');
  assert.equal(theme.filter((b) => b.getAttribute('aria-checked') === 'true').length, 1);
  const base = sets.n;
  renderMore();
  assert.equal(sets.n, base, 'an idle render writes no segment attribute');
  // The things that change under More while it is open: the alerts verdict, presence, the account line.
  state.notify = !state.notify;
  renderMore();
  state.notify = !state.notify;
  renderMore();
  presenceCount = 3; // eslint-disable-line no-undef
  renderMore();
  assert.equal(sets.n, base, 'alerts / presence changes rewrite their own text, never a control under a thumb');
  // And a real change repaints exactly the control it belongs to.
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  renderMore();
  assert.ok(sets.n > base, 'a theme change does repaint the theme control');
  assert.equal(calm.length + camp.length, 5);
});

test('no CSS rule animates every property', () => {
  // `transition: all` on a chip made its line-height and visibility animate
  // each time a panel was rebuilt — a twitch on every score anyone saved.
  const css = readFixture('../styles.css');
  assert.notOk(/transition:\s*all\b/.test(css), 'name the properties a transition is for');
});

test('a snapshot while the Chat tab shows leaves its built view alone, and Now\'s roots are not written at all', () => {
  freshState();
  setMemberRole('viewer');
  const writes = { chat: 0, list: 0, banner: 0 };
  const count = (el, key) => {
    let html = '';
    Object.defineProperty(el, 'innerHTML', { configurable: true, get: () => html, set: (v) => { html = v; writes[key] += 1; } });
  };
  count(document.getElementById('chat-view'), 'chat');
  count(document.getElementById('chat-list'), 'list');
  count(document.getElementById('now-banner'), 'banner');
  try {
    state.ui.tab = 'chat';
    chatViewBuiltFor = null;
    renderAll(); // builds the chat view once
    const built = { ...writes };
    assert.ok(built.chat >= 1, 'built on first show');
    chatViewBuiltFor = 'general'; // (the stub DOM has no real children to compare against)
    renderAll(); renderAll(); renderAll();
    assert.equal(writes.chat, built.chat, 'three more snapshots: the view is not rebuilt');
    assert.equal(writes.banner, 0, 'and Now\'s banner is never written while Chat shows');
  } finally {
    state.ui.tab = 'now'; chatViewBuiltFor = null;
    setMemberRole('editor');
  }
});
