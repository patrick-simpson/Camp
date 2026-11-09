// The overlay surfaces: the full-schedule sheet, the new-version banner, the
// Members drawer, the lock screen and the picker dialogs. Layout and animation
// are only visible in a browser (see the Playwright passes in CLAUDE.md); what
// is pinned here is the state-level behaviour each fix rests on, plus a few
// source checks for CSS/vendor rules where a one-word regression (a bare `1fr`,
// `align-items: center`) would quietly bring a glitch back.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull one rule's declaration block out of the stylesheet by its exact selector.
function cssRule(css, selector) {
  const i = css.indexOf('\n' + selector + ' {');
  assert.ok(i > -1, selector + ' has a rule');
  return css.slice(i, css.indexOf('}', i));
}

// innerHTML that counts how many times it was written.
function countingEl(el) {
  const c = { writes: 0, html: '' };
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get: () => c.html,
    set: (v) => { c.writes++; c.html = v; },
  });
  return c;
}

// ── Full-schedule sheet ──────────────────────────────────────────

test('an unchanged schedule timeline is not rewritten on every render and tick', () => {
  // renderAll and the 30 s tick both call this while the sheet is open.
  // Rewriting identical markup re-created the calendar button, dropped a text
  // selection and replayed the day tap's rise-in from invisible.
  const body = document.getElementById('schedule-body');
  const c = countingEl(body);
  scheduleDay = 1;
  renderScheduleBody();
  assert.equal(c.writes, 1, 'first render writes');
  renderScheduleBody();
  renderScheduleBody();
  assert.equal(c.writes, 1, 'an identical re-render leaves the DOM alone');
  scheduleDay = 2;
  renderScheduleBody();
  assert.equal(c.writes, 2, 'a different day is written');
  assert.ok(/Tuesday|Tue/i.test(c.html), 'and it is that day');
});

test('a saved game result still reaches an open schedule sheet', () => {
  state.results = {};
  const body = document.getElementById('schedule-body');
  const c = countingEl(body);
  const g = state.config.games.find((x) => dayById(x.dayId));
  scheduleDay = dayById(g.dayId).dow;
  renderScheduleBody();
  const before = c.writes;
  state.results[g.id] = { medals: { gold: 't0', silver: 't1', bronze: 't2' }, savedAt: new Date().toISOString() };
  renderScheduleBody();
  state.results = {};
  assert.ok(c.writes > before, 'the played-✓ chip is a markup change, so it is written');
});

test('the schedule day chips are built once; a tap only moves `selected`', () => {
  // Rebuilding all seven on every tap destroyed the focused chip (keyboard and
  // screen-reader users dropped to <body>) and the tapped chip's own animation.
  const wrap = document.getElementById('schedule-days');
  const c = countingEl(wrap);
  const chips = SCHED_DAYS.map((d) => {
    const chip = { dataset: { dow: String(d.dow) }, sel: false, listeners: {} };
    chip.toggleAttribute = (name, on) => { if (name === 'selected') chip.sel = !!on; };
    chip.addEventListener = (type, fn) => { chip.listeners[type] = fn; };
    return chip;
  });
  wrap.querySelectorAll = () => chips;
  wrap.querySelector = () => chips[0];
  const realStagger = joyStagger;
  joyStagger = () => {};
  try {
    scheduleDay = 3;
    renderScheduleDays();
    assert.equal(c.writes, 1, 'built on first show');
    assert.ok(!/selected/.test(c.html), 'the markup carries no selected state; it is applied in place');
    assert.deepEqual(chips.map((x) => x.sel), [false, false, false, true, false, false, false]);
    chips.forEach((x) => assert.ok(x.listeners.click, 'every chip is wired'));

    chips[6].listeners.click(); // tap Saturday
    assert.equal(scheduleDay, 6);
    assert.deepEqual(chips.map((x) => x.sel), [false, false, false, false, false, false, true], 'selection moved in place');
    assert.equal(c.writes, 1, 'the tap rebuilt nothing');

    renderScheduleDays(); // re-open the sheet
    assert.equal(c.writes, 1, 'nor does showing it again');
  } finally { joyStagger = realStagger; }
});

test('closing the schedule from a swipe continues from the drag offset', async () => {
  const sheet = scheduleOverlayEl().querySelector('.schedule-sheet');
  const props = {};
  sheet.style = {
    transform: 'translateY(200px)',
    setProperty: (k, v) => { props[k] = v; },
    removeProperty: (k) => { delete props[k]; },
  };
  closeSchedule(200);
  assert.equal(props['--drag'], '200px', 'the slide-out keyframes get the offset');
  assert.equal(sheet.style.transform, '', 'inline transform cleared so the animation owns the sheet');
  await sleep(260);
  assert.notOk('--drag' in props, 'removed when the sheet is hidden — a later close must not inherit it');
});

test('closing the schedule from a click or key ignores the event argument', () => {
  // closeSchedule is also a click listener: its first argument is an Event.
  const sheet = scheduleOverlayEl().querySelector('.schedule-sheet');
  const props = {};
  sheet.style = { transform: '', setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } };
  closeSchedule({ type: 'click', clientY: 400 });
  closeSchedule(undefined);
  closeSchedule(0);
  closeSchedule(-5);
  assert.notOk('--drag' in props, 'only a positive number is a drag offset');
});

test('a cancelled header drag springs back instead of leaving the sheet stuck', async () => {
  const header = scheduleOverlayEl().querySelector('.schedule-header');
  const sheet = scheduleOverlayEl().querySelector('.schedule-sheet');
  const on = {};
  header.addEventListener = (type, fn) => { on[type] = fn; };
  const props = {};
  sheet.style = { transform: '', transition: '', setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } };
  wireSchedule();
  assert.ok(on.touchcancel, 'touchcancel is handled (touchend never comes when the OS takes the gesture)');

  on.touchstart({ touches: [{ clientY: 100 }] });
  assert.equal(sheet.style.transition, 'none');
  on.touchmove({ touches: [{ clientY: 160 }] });
  assert.equal(sheet.style.transform, 'translateY(60px)');
  on.touchcancel();
  assert.equal(sheet.style.transform, '', 'back at rest');
  assert.notOk('--drag' in props, 'a cancel is never a dismiss');

  // A short release eases back; a long one hands its offset to closeSchedule.
  on.touchstart({ touches: [{ clientY: 100 }] });
  on.touchmove({ touches: [{ clientY: 150 }] });
  on.touchend();
  assert.equal(sheet.style.transform, '');
  assert.ok(/transform/.test(sheet.style.transition), 'the spring-back has a transition (the sheet has none at rest)');
  on.touchstart({ touches: [{ clientY: 100 }] });
  on.touchmove({ touches: [{ clientY: 320 }] });
  on.touchend();
  assert.equal(props['--drag'], '220px', 'a swipe past the threshold dismisses from where the finger let go');
  await sleep(260);
});

test('schedule sheet CSS: seven day chips fit, fixed height, drag-aware slide-out', () => {
  const css = readFixture('../styles.css');
  assert.ok(/\.schedule-days \{[^}]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/.test(css),
    'a bare 1fr floors each track at the chip\'s min-content and Saturday falls off a phone');
  assert.ok(/jelly-chip\.sched-day-chip::part\(main\) \{[^}]*padding-inline: 0/.test(css));
  assert.ok(/jelly-chip\.sched-day-chip \{[^}]*text-align: center/.test(css));
  const sheet = cssRule(css, '.schedule-sheet');
  assert.ok(/\n  height: 90dvh;/.test(sheet), 'a fixed height, or short days move the chip row out from under the finger');
  assert.ok(/@keyframes sched-slide-out \{\s*from \{ transform: translateY\(var\(--drag, 0px\)\); \}/.test(css),
    'the slide-out starts at the drag offset');
});

// ── New-version banner ───────────────────────────────────────────

function fakeBanner() {
  const on = {};
  return { on, addEventListener: (type, fn) => { on[type] = fn; } };
}

test('tapping the "Update ready" pill asks before throwing unfinished work away', () => {
  const realConfirm = confirm;
  let asked = 0;
  let answer = false;
  confirm = () => { asked++; return answer; };
  try {
    window.__reloads = 0;
    const pill = fakeBanner();
    pill.__go = 'reload';
    wirePill(pill);

    pendingWrites = 1; // an unconfirmed score: the auto-reload is holding for it
    pill.on.click();
    assert.equal(asked, 1, 'asked');
    assert.equal(window.__reloads, 0, 'declined: nothing reloaded');
    answer = true;
    pill.on.click();
    assert.equal(window.__reloads, 1, 'accepted: reloads');

    pendingWrites = 0; // a quiet page just reloads
    const before = asked;
    pill.on.click();
    assert.equal(asked, before, 'no question when nothing is at stake');
    assert.equal(window.__reloads, 2);
  } finally { confirm = realConfirm; pendingWrites = 0; }
});

test('the pill samples "unfinished work" at press, before a tap moves focus', () => {
  // A tap on the pill blurs the chat composer, and chatComposerBusy() only
  // counts a FOCUSED composer — so by click time the draft looked safe to drop.
  const realConfirm = confirm;
  let asked = 0;
  confirm = () => { asked++; return false; };
  try {
    window.__reloads = 0;
    const pill = fakeBanner();
    pill.__go = 'reload';
    wirePill(pill);
    pendingWrites = 1;
    pill.on.pointerdown();
    pendingWrites = 0; // focus moved, the composer stopped counting
    pill.on.click();
    assert.equal(asked, 1, 'still asked');
    assert.equal(window.__reloads, 0);
    // The press memory is one-shot: a later keyboard activation of a quiet page isn't asked.
    pill.on.click();
    assert.equal(asked, 1);
    assert.equal(window.__reloads, 1);
  } finally { confirm = realConfirm; pendingWrites = 0; }
});

test('an Offline / Reconnecting pill never reloads: its tap only says what is happening', () => {
  const toasts = [];
  const realToast = showToast;
  showToast = (m) => toasts.push(m);
  try {
    window.__reloads = 0;
    const pill = fakeBanner();
    pill.__go = 'say';
    pill.__say = 'You are offline.';
    wirePill(pill);
    pill.on.click();
    assert.equal(window.__reloads, 0);
    assert.deepEqual(toasts, ['You are offline.']);
  } finally { showToast = realToast; }
});

test('the status pill: what it says, in what order, and when it is simply absent', () => {
  const save = { sdk: sdkLoadFailed, nv: newVersionSeen, den: syncDenied, known: fbConnKnown, conn: fbConnected, since: fbOfflineSince };
  try {
    sdkLoadFailed = false; newVersionSeen = false; syncDenied = false; fbConnKnown = false; fbConnected = false; fbOfflineSince = 0;
    assert.equal(syncPillModel(), null, 'nothing wrong: no pill at all');
    fbConnKnown = true; fbConnected = true;
    assert.equal(syncPillModel(), null, 'connected: no pill');
    fbConnected = false; fbOfflineSince = Date.now();
    if (syncEnabled()) assert.equal(syncPillModel().tone, 'wait', 'just dropped: Reconnecting');
    fbOfflineSince = Date.now() - PILL_WAIT_MS - 1;
    if (syncEnabled()) assert.equal(syncPillModel().tone, 'offline', 'for a while: Offline, saved on this phone');
    newVersionSeen = true;
    assert.equal(syncPillModel().tone, 'update', 'a new version outranks the connection line');
    assert.equal(syncPillModel().act, 'reload');
    sdkLoadFailed = true;
    assert.equal(syncPillModel().tone, 'error', 'a failed SDK outranks everything');
    assert.equal(syncPillModel().act, 'reload');
  } finally {
    sdkLoadFailed = save.sdk; newVersionSeen = save.nv; syncDenied = save.den; fbConnKnown = save.known; fbConnected = save.conn; fbOfflineSince = save.since;
  }
});

test('the SDK pill lives on the sign-in screen only; the app has the header pill instead', () => {
  const css = readFixture('../styles.css');
  const src = readFixture('../app.js');
  assert.ok(/\.update-banner \{[^}]*z-index: 10002/.test(css), 'above the lock screen');
  assert.ok(/if \(!appStarted\) showSdkDownBanner\(\)/.test(src), 'the bar is the lock screen\'s only');
  assert.notOk(/has-update-banner|update-banner-alert|showUpdateBanner|wireReloadBanner/.test(src.replace(/\/\/.*$/gm, '')), 'the bottom update bar is gone from app.js');
  assert.notOk(/has-update-banner|update-banner-alert|#update-banner/.test(css), 'and from the stylesheet');
  assert.notOk(/chat-open/.test(css), 'chat is a tab: no body.chat-open rule is left to go stale');
});

// The bottom strip is now the toaster alone, on the tab bar. Pin the ORDER, so a
// later edit to one offset can't quietly put a tap target under another.
test('the toaster clears the tab bar, the chat composer and a takeover\'s dock, on tabs, in chat and over a takeover', () => {
  const css = readFixture('../styles.css');
  const num = (re, unit) => {
    const m = css.match(re);
    assert.ok(m, 'rule present: ' + re);
    return unit === 'px' ? parseFloat(m[1]) / 16 : parseFloat(m[1]);
  };
  const composer = 58 / 16; // the sticky composer's height, in rem
  const tabs = css.match(/\njelly-toaster\[position="bottom"\] \{[^}]*bottom: calc\(var\(--tabbar-h\) \+ var\(--s-3\)\)/);
  assert.ok(tabs, 'on a tab: just above the tab bar');
  const chat = num(/body:has\(#app\[data-tab="chat"\]\) jelly-toaster\[position="bottom"\] \{[^}]*bottom: calc\(var\(--tabbar-h\) \+ ([\d.]+)px/, 'px');
  assert.ok(chat > composer, 'in chat, toasts clear the composer');
  const kb = num(/body\.kb-open:has\(#app\[data-tab="chat"\]\) jelly-toaster\[position="bottom"\] \{[^}]*bottom: calc\(var\(--kb-h, 0px\) \+ ([\d.]+)px/, 'px');
  assert.ok(kb > composer, 'typing in chat: the toasts ride the keyboard, clear of the composer');
  assert.ok(/body:has\(\.takeover:not\(\[hidden\]\) > \.tk-dock:not\(\[hidden\]\)\) jelly-toaster\[position="bottom"\] \{[^}]*bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 104px\)/.test(css),
    'over a takeover with a dock, clear of the dock');
});

// ── Members drawer ───────────────────────────────────────────────

function fakeMembersBody(fields) {
  const els = {};
  Object.keys(fields).forEach((sel) => { els[sel] = { value: fields[sel] }; });
  els['#member-add-error'] = { hidden: true, textContent: '' };
  return { els, querySelector: (sel) => els[sel] || null };
}

test('the history sheet opens at one size, loading or loaded', () => {
  const css = readFixture('../styles.css');
  assert.ok(/#history-overlay::part\(sheet\) \{[^}]*min-height: 82dvh/.test(css),
    'the skeleton sheet used to be ~300px and jumped ~360px taller when the fetch landed');
});

// ── Lock screen ──────────────────────────────────────────────────

test('the lock screen scrolls and is top-anchored, so it neither clips nor jumps', () => {
  const css = readFixture('../styles.css');
  const i = css.indexOf('html.locked .lock-screen {');
  assert.ok(i > -1);
  const rule = css.slice(i, css.indexOf('\n}', i));
  assert.ok(/overflow-y: auto/.test(rule), 'a box taller than the screen must scroll (#app is display:none, nothing else can)');
  assert.ok(/align-items: flex-start/.test(rule), 'centring re-centres the stack on every height change and clips top and bottom equally');
  assert.notOk(/align-items: center/.test(rule));
  assert.ok(/\.lock-box \{[^}]*margin: 0 auto/.test(css));
  assert.ok(/@media \(min-width: 700px\) \{\s*html\.locked \.lock-screen \{\s*padding-top: max\(1\.5rem, min\(14vh, 4rem\)\)/.test(css),
    'on wide screens the top offset is capped so the open disclosure fits an 800px window');
});

test('an error re-show of the sign-in panel keeps the alternative sign-in forms', () => {
  // mount() replaces the slot's innerHTML: a Google "popup blocked" error used
  // to wipe a half-typed number and reset a phone flow waiting on its code.
  const slotPhone = document.getElementById('alt-phone-slot');
  const slotEmail = document.getElementById('alt-email-slot');
  const mounts = [];
  window.CampPhone = { mount: (el) => mounts.push('phone') };
  window.CampEmailLink = { mount: (el) => mounts.push('email') };
  try {
    slotPhone.firstElementChild = {};
    slotEmail.firstElementChild = {};
    showAuthScreen('signin', { error: 'Your browser blocked the sign-in window' });
    assert.deepEqual(mounts, [], 'forms already there: left alone');

    showAuthScreen('signin'); // first paint / after sign-out: a clean form
    assert.deepEqual(mounts, ['phone', 'email'], 'a plain show still remounts, so a shared phone starts fresh');

    mounts.length = 0;
    slotPhone.firstElementChild = null;
    slotEmail.firstElementChild = null;
    showAuthScreen('signin', { error: 'offline' });
    assert.deepEqual(mounts, ['phone', 'email'], 'an error show on an empty slot still builds the form');
  } finally {
    delete window.CampPhone;
    delete window.CampEmailLink;
    slotPhone.firstElementChild = undefined;
    slotEmail.firstElementChild = undefined;
  }
});

// ── Picker dialog ────────────────────────────────────────────────

test('a close the person chose plays the exit animation; a hand-off does not', () => {
  const calls = [];
  const overlay = {
    localName: 'jelly-dialog',
    hasAttribute: () => true,
    removeAttribute: (a) => calls.push('removeAttribute:' + a),
    set open(v) { calls.push('open=' + v); },
  };
  globalThis.customElements = { get: (n) => (n === 'jelly-dialog' ? function () {} : undefined) };
  try {
    closeOverlayAnimated(overlay);
    assert.deepEqual(calls, ['open=false'], 'the component\'s animated close');

    calls.length = 0;
    globalThis.customElements = { get: () => undefined }; // jelly not upgraded yet: `.open` would be a dead expando
    closeOverlayAnimated(overlay);
    assert.deepEqual(calls, ['removeAttribute:open'], 'falls back to the attribute');

    calls.length = 0;
    closeOverlayAnimated({ localName: 'jelly-dialog', hasAttribute: () => false, removeAttribute: () => calls.push('x'), set open(v) { calls.push('y'); } });
    assert.deepEqual(calls, [], 'an already-closed dialog is left alone');
  } finally { delete globalThis.customElements; }

  // closeTeamPicker (used by hand-offs) stays the instant attribute removal.
  const pickerEl = teamPickerOverlayEl();
  const realRemove = pickerEl.removeAttribute;
  let removed = 0;
  pickerEl.removeAttribute = () => { removed++; };
  try {
    closeTeamPicker();
    assert.equal(removed, 1);
  } finally { pickerEl.removeAttribute = realRemove; }
});

test('the picker holds its size when moving from the team step to the identity step', () => {
  const sizes = { '.team-picker-title': 40, '.team-picker-hint': 60, '#team-picker-options': 380 };
  const els = {};
  Object.keys(sizes).forEach((sel) => {
    els[sel] = { offsetHeight: sizes[sel], style: {} };
  });
  const realQuery = document.querySelector;
  document.querySelector = (sel) => els[sel] || null;
  try {
    holdPickerHeight(true);
    assert.equal(els['#team-picker-options'].style.minHeight, '380px');
    assert.equal(els['.team-picker-hint'].style.minHeight, '60px');
    assert.equal(els['.team-picker-title'].style.minHeight, '40px');
    holdPickerHeight(false); // a fresh open
    Object.keys(els).forEach((sel) => assert.equal(els[sel].style.minHeight, '', sel + ' released'));
  } finally { document.querySelector = realQuery; }
});

// ── Drawer / dialog scrim (vendor/jelly.js local patch) ──────────

test('the jelly drawer and dialog fade their scrim in and out', () => {
  // The host flips display:none -> block and opacity 0 -> 1 in one style
  // recalc, so the CSS transition never ran: the dim popped in at full strength
  // and vanished in a single frame. The vendored copy animates it with WAAPI.
  const src = readFixture('../vendor/jelly.js');
  assert.equal((src.match(/jellyScrimFade\(this, !0,/g) || []).length, 2, 'fade in: dialog + drawer afterOpen');
  assert.equal((src.match(/jellyScrimFade\(this, !1,/g) || []).length, 2, 'fade out: dialog + drawer animated close');
  assert.equal((src.match(/jellyScrimClosed\(this\)/g) || []).length, 2, 'both afterClose paths stamp the hand-off clock');
  assert.ok(/getAnimations\?\.\(\)\.forEach\(\(a\) => a\.cancel\(\)\)/.test(src),
    'a previous close\'s held end state is cancelled, or a reopened overlay would have no scrim');
});

test('a hand-off only keeps the scrim when the closing one was still showing', () => {
  // Settings -> Members closes by removeAttribute (scrim still at full strength,
  // so the next overlay must NOT fade in again). The camp picker's animated
  // close has faded its scrim to 0 by afterClose, so the team picker it opens
  // must fade in from there, or the dim pops in at full strength in one frame.
  const src = readFixture('../vendor/jelly.js');
  const vm = nodeRequire('vm');
  const block = src.slice(src.indexOf('let jellyScrimClosedAt'), src.indexOf('class Oi extends'));
  assert.ok(block.includes('jellyScrimFade'), 'extracted the scrim helpers');
  let now = 1000;
  const sandbox = { performance: { now: () => now }, F: () => false };
  vm.createContext(sandbox);
  vm.runInContext(block + '\nthis.fade = jellyScrimFade; this.closed = jellyScrimClosed;', sandbox);
  const overlay = () => {
    const calls = [];
    const backdrop = { animate: (frames) => { calls.push(frames); }, getAnimations: () => [] };
    return { calls, shadowRoot: { querySelector: () => backdrop } };
  };
  // animated close -> next open fades in
  let a = overlay(); let b = overlay();
  sandbox.fade(a, false, 300);
  now += 300; // the exit animation finishes, then afterClose
  sandbox.closed(a);
  now += 5;
  sandbox.fade(b, true, 300);
  assert.equal(b.calls.length, 1, 'next overlay fades its scrim in after an animated close');
  // removeAttribute close (no fade started) -> next open keeps the dim
  a = overlay(); b = overlay();
  now += 1000;
  sandbox.closed(a);
  now += 5;
  sandbox.fade(b, true, 300);
  assert.equal(b.calls.length, 0, 'hand-off after an instant close keeps the scrim continuous');
  // afterClose forced early (mid-fade) leaves the scrim visible -> still a hand-off
  a = overlay(); b = overlay();
  now += 1000;
  sandbox.fade(a, false, 300);
  now += 50;
  sandbox.closed(a);
  now += 5;
  sandbox.fade(b, true, 300);
  assert.equal(b.calls.length, 0, 'a close cut short mid-fade still counts as a hand-off');
  // reopening the same overlay clears a stale fade stamp
  a = overlay();
  sandbox.fade(a, false, 300);
  sandbox.fade(a, true, 300);
  assert.equal(a.jellyScrimFadeEnd, 0);
});
