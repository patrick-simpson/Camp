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

test('tapping the update banner asks before throwing unfinished work away', () => {
  const realConfirm = confirm;
  let asked = 0;
  let answer = false;
  confirm = () => { asked++; return answer; };
  try {
    window.__reloads = 0;
    const bar = fakeBanner();
    wireReloadBanner(bar);

    pendingWrites = 1; // an unconfirmed score: the auto-reload is holding for it
    bar.on.click();
    assert.equal(asked, 1, 'asked');
    assert.equal(window.__reloads, 0, 'declined: nothing reloaded');
    answer = true;
    bar.on.click();
    assert.equal(window.__reloads, 1, 'accepted: reloads');

    pendingWrites = 0; // a quiet page just reloads
    const before = asked;
    bar.on.click();
    assert.equal(asked, before, 'no question when nothing is at stake');
    assert.equal(window.__reloads, 2);
  } finally { confirm = realConfirm; pendingWrites = 0; }
});

test('the banner samples "unfinished work" at press, before a tap moves focus', () => {
  // A tap on the banner blurs the chat composer, and chatComposerBusy() only
  // counts a FOCUSED composer — so by click time the draft looked safe to drop.
  const realConfirm = confirm;
  let asked = 0;
  confirm = () => { asked++; return false; };
  try {
    window.__reloads = 0;
    const bar = fakeBanner();
    wireReloadBanner(bar);
    pendingWrites = 1;
    bar.on.pointerdown();
    pendingWrites = 0; // focus moved, the composer stopped counting
    bar.on.click();
    assert.equal(asked, 1, 'still asked');
    assert.equal(window.__reloads, 0);
    // The press memory is one-shot: a later keyboard activation of a quiet page isn't asked.
    bar.on.click();
    assert.equal(asked, 1);
    assert.equal(window.__reloads, 1);
  } finally { confirm = realConfirm; pendingWrites = 0; }
});

test('the update banner is lifted clear of the chat composer and reserves footer room', () => {
  const css = readFixture('../styles.css');
  assert.ok(/body\.chat-open \.update-banner-alert,\s*body\.chat-open \.update-banner \{[^}]*bottom: calc\(5\.5rem/.test(css),
    'both banner flavours (the SDK pill shares .update-banner) move above the sticky composer');
  assert.ok(/body\.has-update-banner \.app-footer \{[^}]*padding-bottom/.test(css));
  assert.ok(/body:has\(#update-banner\) #sdk-banner \{[^}]*bottom: calc\(6\.5rem/.test(css), 'the SDK pill stacks above the update bar instead of hiding behind it');
  const src = readFixture('../app.js');
  assert.ok(/classList\.add\('has-update-banner'\)/.test(src));
});

// ── Members drawer ───────────────────────────────────────────────

function fakeMembersBody(fields) {
  const els = {};
  Object.keys(fields).forEach((sel) => { els[sel] = { value: fields[sel] }; });
  els['#member-add-error'] = { hidden: true, textContent: '' };
  return { els, querySelector: (sel) => els[sel] || null };
}

test('the Add form survives a drawer rebuild; a successful add clears it', () => {
  const body = fakeMembersBody({
    '#member-add-id': 'new@example.com', '#member-add-name': 'Alex', '#member-add-role': 'editor',
    '#member-add-camps': 'both', '.member-add-team': 't3',
  });
  body.els['#member-add-error'].hidden = false;
  body.els['#member-add-error'].textContent = 'Already on the list';
  const draft = readMemberAddDraft(body);
  assert.deepEqual(draft, { id: 'new@example.com', name: 'Alex', role: 'editor', camps: 'both', team: 't3', error: 'Already on the list' });

  // The rebuild: a brand-new form in its defaults.
  const fresh = fakeMembersBody({
    '#member-add-id': '', '#member-add-name': '', '#member-add-role': 'viewer', '#member-add-camps': 'active', '.member-add-team': '',
  });
  restoreMemberAddDraft(fresh, draft);
  assert.equal(fresh.els['#member-add-id'].value, 'new@example.com');
  assert.equal(fresh.els['#member-add-name'].value, 'Alex');
  assert.equal(fresh.els['#member-add-role'].value, 'editor');
  assert.equal(fresh.els['#member-add-camps'].value, 'both');
  assert.equal(fresh.els['.member-add-team'].value, 't3');
  assert.equal(fresh.els['#member-add-error'].hidden, false, 'and the refusal message');

  resetMemberAddForm(fresh);
  assert.equal(fresh.els['#member-add-id'].value, '');
  assert.equal(fresh.els['#member-add-role'].value, 'viewer', 'back to the defaults');
  assert.equal(fresh.els['#member-add-camps'].value, 'active');
  assert.equal(fresh.els['.member-add-team'].value, '');
  assert.equal(fresh.els['#member-add-error'].hidden, true);

  assert.equal(readMemberAddDraft({ querySelector: () => null }), null, 'no form yet (first fill) -> nothing to carry');
  assert.doesNotThrow(() => restoreMemberAddDraft(fresh, null));
});

// A members body with one row whose controls record their listeners.
function fakeMemberRow(key, controls) {
  const row = {
    dataset: { memberKey: key },
    querySelector: (sel) => controls[sel] || null,
    querySelectorAll: (sel) => (sel === '.member-access' ? controls.access || [] : []),
  };
  return { querySelectorAll: (sel) => (sel === '.member-row' ? [row] : []), querySelector: () => null };
}

test('a role or team change on an existing member does not rebuild the whole drawer', async () => {
  // Re-creating every row's segmented + select froze the page ~1 s at 40
  // members and wiped the Add form. The control already shows the new value;
  // the record the row's closure holds is patched so later actions read it.
  const realRender = renderMembers;
  const realFirebase = globalThis.firebase;
  let renders = 0;
  renderMembers = () => { renders++; };
  const writes = [];
  globalThis.firebase = { database: () => ({ ref: (p) => ({
    set: (v) => { writes.push(['set', p, v]); return Promise.resolve(); },
    remove: () => { writes.push(['remove', p]); return Promise.resolve(); },
  }) }) };
  try {
    const on = {};
    const seg = { dataset: { campId: 'junior' }, addEventListener: (t, fn) => { on.access = fn; } };
    const sel = { value: 't2', addEventListener: (t, fn) => { on.team = fn; } };
    const body = fakeMemberRow('pat@example,com', { access: [seg], '.member-team': sel });
    const lists = { junior: { 'pat@example,com': { role: 'viewer', name: 'Pat', teamId: 't1' } }, senior: null };
    bindMemberList(body, 'me@example,com', lists);

    on.access({ detail: { value: 'editor' } });
    await sleep(5);
    assert.equal(writes.length, 1);
    assert.equal(lists.junior['pat@example,com'].role, 'editor', 'the held record is patched in place');
    assert.equal(renders, 0, 'no rebuild after a role change');

    on.team();
    await sleep(5);
    assert.equal(lists.junior['pat@example,com'].teamId, 't2');
    sel.value = '';
    on.team();
    await sleep(5);
    assert.notOk('teamId' in lists.junior['pat@example,com'], 'clearing the team removes it from the held record too');
    assert.equal(renders, 0, 'nor after a team change');

    // Removing someone changes which rows exist, so that one still refreshes.
    on.access({ detail: { value: 'none' } });
    await sleep(5);
    assert.equal(renders, 1, 'a removal rebuilds');
  } finally {
    renderMembers = realRender;
    globalThis.firebase = realFirebase;
  }
});

test('a refused role write still rebuilds, to put the control back', async () => {
  const realRender = renderMembers;
  const realFirebase = globalThis.firebase;
  let renders = 0;
  renderMembers = () => { renders++; };
  globalThis.firebase = { database: () => ({ ref: () => ({ set: () => Promise.reject(new Error('PERMISSION_DENIED')) }) }) };
  try {
    const on = {};
    const seg = { dataset: { campId: 'junior' }, addEventListener: (t, fn) => { on.access = fn; } };
    const lists = { junior: { 'pat@example,com': { role: 'viewer', name: 'Pat' } }, senior: null };
    bindMemberList(fakeMemberRow('pat@example,com', { access: [seg] }), 'me@example,com', lists);
    on.access({ detail: { value: 'editor' } });
    await sleep(5);
    assert.equal(renders, 1);
    assert.equal(lists.junior['pat@example,com'].role, 'viewer', 'and the held record was not patched');
  } finally {
    renderMembers = realRender;
    globalThis.firebase = realFirebase;
  }
});

test('the history and members sheets open at one size, loading or loaded', () => {
  const css = readFixture('../styles.css');
  assert.ok(/#history-overlay::part\(sheet\),\s*#members-overlay::part\(sheet\) \{[^}]*min-height: 82dvh/.test(css),
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
