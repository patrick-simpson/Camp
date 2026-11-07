// The frame's pieces (BUILD-PLAN Step 13, session B): teamMark, the header, More
// absorbing the Settings drawer, What counselors see, and the three drawers that
// ride the shell's history stack. Layout is only visible in a browser (the
// Playwright target pass); what is pinned here is the state behind each piece and
// the source rules a one-word regression would quietly break.

const APP = readFixture('../app.js');
const INDEX = readFixture('../index.html');
const CSS = readFixture('../styles.css');

// ── teamMark ────────────────────────────────────────────────────────

test('teamMark: a shield when the camp ships one, else a flag with a shape, else an emoji tile', () => {
  const spec = teamMarkSpec('t0');
  if (CAMP.id === 'junior') {
    assert.equal(spec.kind, 'shield', 'junior has shield artwork for every team');
    assert.ok(/^<img class="tm tm-shield" data-team="t0" src="images\//.test(teamMarkHtml('t0', { size: 34 })));
    assert.ok(/width="34" height="47"/.test(teamMarkHtml('t0', { size: 34 })), 'the shield keeps its 480:667 shape');
  } else {
    assert.equal(spec.kind, 'flag', 'senior has no artwork yet: a flag');
    const shapes = teamIds().map((id) => teamMarkSpec(id).shape);
    assert.equal(new Set(shapes).size, teamIds().length, 'every team gets its own SHAPE (colour alone fails under colour-blindness)');
    assert.ok(/data-flag="red"/.test(teamMarkHtml('t0')) && /<use href="#flag-plain"/.test(teamMarkHtml('t0')));
  }
  // A team the camp knows nothing about: the emoji tile, never a broken image.
  const saveShield = CAMP.teamCrest; const saveFlag = CAMP.teamFlag;
  const tile = (() => { try { return teamMarkSpec('t9'); } finally { /* restored below */ } })();
  assert.equal(tile.kind, 'tile');
  assert.ok(/class="tm tm-tile"/.test(teamMarkHtml('t9')) && !/<img/.test(teamMarkHtml('t9')));
  assert.equal(CAMP.teamCrest, saveShield); assert.equal(CAMP.teamFlag, saveFlag);
});

test('teamMark: hostile input stays inert (a label is escaped, a colour that is not hex never reaches style)', () => {
  const html = teamMarkHtml('t0', { size: 52, label: '"><script>x</script>' });
  assert.notOk(/<script/.test(html));
  const tile = teamMarkHtml('t9', { label: 'a"b' });
  assert.notOk(/--tm-accent/.test(tile), 'no accent colour for an unknown team');
});

test('paintTeamMark writes only when the mark would change, so the <img> is never re-created', () => {
  const el = { innerHTML: '' };
  assert.equal(paintTeamMark(el, 't0', { size: 34 }), true, 'first paint');
  const first = el.innerHTML;
  assert.equal(paintTeamMark(el, 't0', { size: 34 }), false, 'a re-render of the same mark writes nothing');
  assert.equal(el.innerHTML, first);
  assert.equal(paintTeamMark(el, 't0', { size: 52 }), true, 'a different size is a different mark');
  assert.equal(paintTeamMark(el, 't1', { size: 52 }), true, 'and so is a different team');
});

// ── the header ──────────────────────────────────────────────────────

test('the header says who you are: the team and your name for a counselor, the camp and your role for a director with no team', () => {
  freshState();
  setMemberRole('viewer');
  memberName = 'Sam';
  state.followTeam = 't1';
  const camp = String(CAMP.label).replace(/\bCamp\b/, 'camp'); // sentence case, as the frame writes it (§8.2)
  const m = headerModel();
  assert.equal(m.teamId, 't1');
  assert.equal(m.name, teamName('t1'));
  assert.ok(m.sub.startsWith('Sam'), m.sub);
  assert.ok(m.sub.includes(camp), 'the camp is named, in sentence case: ' + m.sub);
  assert.equal(m.who, 'Sam · ' + teamShort('t1'), 'the right-hand line is you and your team');
  setMemberRole('editor');
  state.followTeam = null;
  memberName = 'Jenn';
  const d = headerModel();
  assert.equal(d.teamId, null, 'a director with no team gets the camp mark');
  assert.equal(d.name, camp, 'with no team the headline is the camp, so a director on both camps never loses which one this is');
  // A weekend has no day label (the header drops an empty part, it never ends on a dangling separator).
  assert.equal(d.sub, ['Jenn', 'Director', dayLabel(campNow().dow)].filter(Boolean).join(' · '));
  memberName = null;
  assert.equal(headerModel().sub.startsWith('Director'), true, 'with no name on file the role stands alone: never a guess from the email');
  assert.equal(headerModel().name, camp);
  memberName = null;
});

test('the game takeover has its own status strip: the header covers it and #app is inert under it, so Retry / Discard and the pill are mirrored in', () => {
  freshState();
  setMemberRole('editor');
  const el = (id) => document.getElementById(id);
  const saveQ = stateQuarantine; const saveNv = newVersionSeen;
  try {
    stateQuarantine = { 'results/gX': { at: 1 } };
    newVersionSeen = true;
    updateSyncAlert();
    renderSyncPill();
    assert.equal(el('sync-alert').hidden, false);
    assert.equal(el('tk-sync-alert').hidden, false, 'a refused score is told in the takeover too');
    assert.equal(el('tk-sync-alert').innerHTML, el('sync-alert').innerHTML, 'the same bar, same buttons');
    assert.ok(/data-sync-quarantine="retry"/.test(el('tk-sync-alert').innerHTML) && /data-sync-quarantine="discard"/.test(el('tk-sync-alert').innerHTML));
    assert.equal(el('tk-pill').hidden, false);
    assert.equal(el('tk-pill-text').textContent, el('hdr-pill-text').textContent, 'the pill says the same thing');
    assert.equal(el('takeover-game-status').hidden, false, 'the strip shows while either is up');
    stateQuarantine = {};
    newVersionSeen = false;
    updateSyncAlert();
    renderSyncPill();
    assert.equal(el('tk-sync-alert').hidden, true);
    assert.equal(el('takeover-game-status').hidden, !(el('tk-pill') && !el('tk-pill').hidden), 'and goes away with them');
  } finally { stateQuarantine = saveQ; newVersionSeen = saveNv; updateSyncAlert(); renderSyncPill(); }
  // The markup: inside the takeover (not #app, which is inert under it), ahead of its body, and wired.
  const tk = INDEX.slice(INDEX.indexOf('<section id="takeover-game"'), INDEX.indexOf('id="takeover-game-dock"'));
  assert.ok(tk.indexOf('id="takeover-game-status"') > tk.indexOf('class="tk-head"') && tk.indexOf('id="takeover-game-status"') < tk.indexOf('id="takeover-game-body"'), 'between the head and the body, in flow');
  assert.ok(/id="tk-sync-alert"/.test(tk) && /id="tk-pill"/.test(tk));
  assert.ok(/\['gs-sync', 'sync-status-footer', 'sync-alert', 'tk-sync-alert', 'setup-sync-alert'\]/.test(APP), 'its Retry / Discard clicks reach onSyncStatusClick (the Set up the week copy too)');
  assert.ok(/wirePill\(document\.getElementById\('tk-pill'\)\)/.test(APP), 'its pill asks before a reload, like the header one');
});

test('the header never carries a number: no points, no place, whoever you are', () => {
  freshState();
  seedPoints();
  [['viewer', 't0'], ['editor', 't0'], ['viewer', null]].forEach(([role, team]) => {
    setMemberRole(role);
    state.followTeam = team;
    const m = headerModel();
    assert.notOk(/\b\d+(st|nd|rd|th)\b|\bpts?\b|points/i.test(m.name + ' ' + m.sub + ' ' + m.who), role + ': ' + JSON.stringify(m));
  });
});
function seedPoints() {
  const ids = teamIds();
  state.results = {};
  state.config.games.slice(0, 3).forEach((g, i) => {
    state.results[g.id] = { medals: { gold: ids[i % ids.length], silver: ids[(i + 1) % ids.length], bronze: ids[(i + 2) % ids.length] }, savedAt: '2026-07-20T12:00:00Z' };
  });
}

// ── More ────────────────────────────────────────────────────────────

function fakeSeg(values) {
  const btns = values.map((v) => {
    const attrs = new Map();
    return { dataset: { value: v }, getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null), setAttribute: (n, x) => attrs.set(n, String(x)) };
  });
  return { btns, querySelectorAll: () => btns };
}

test('a segmented control is its aria-checked, with one tab stop on the chosen button', () => {
  const seg = fakeSeg(['light', 'auto', 'dark']);
  paintSeg(seg, 'dark');
  assert.deepEqual(seg.btns.map((b) => b.getAttribute('aria-checked')), ['false', 'false', 'true']);
  assert.deepEqual(seg.btns.map((b) => b.getAttribute('tabindex')), ['-1', '-1', '0']);
  paintSeg(seg, 'auto');
  assert.deepEqual(seg.btns.map((b) => b.getAttribute('aria-checked')), ['false', 'true', 'false']);
  assert.doesNotThrow(() => paintSeg(null, 'x'));
});

test('More keeps every id the Settings drawer had, on the row that took its place', () => {
  ['builder-row', 'history-row', 'members-row', 'alerts-row', 'signout-btn', 'theme-toggle', 'calm-toggle', 'calm-reason', 'camp-switch', 'account-label', 'sound-toggle']
    .forEach((id) => assert.equal((INDEX.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id + ' exists exactly once'));
  assert.notOk(/id="settings-overlay"|id="settings-btn"|id="app-footer"/.test(INDEX), 'the gear drawer and the footer line are gone');
  // The Director group is hidden for a counselor in code AND in CSS.
  assert.ok(/html\.view-only #more-director \{\s*display: none;/.test(CSS));
  assert.ok(/setHiddenIfChanged\(document\.getElementById\('more-director'\), !editor\)/.test(APP));
});

test('More only ever holds what exists today: the Tell everyone and Award points rows stay hidden until their tools are wired', () => {
  const dir = INDEX.slice(INDEX.indexOf('id="more-director"'), INDEX.indexOf('id="more-camp"'));
  ['counselors-see', 'builder', 'history', 'members'].forEach((k) => assert.ok(dir.includes('data-more-row="' + k + '"'), k));
  assert.ok(/data-more-row="reveal" data-state="ready" hidden/.test(dir), 'Run the reveal stays built but hidden until Step 23');
  // Step 24's two rows exist (the design pass) and ship hidden until the tool they open is wired: never a dead row.
  ['tell', 'award'].forEach((k) => assert.ok(new RegExp('data-more-row="' + k + '" hidden').test(dir), k + ' row is built but hidden until its takeover is wired'));
});

test('the Alerts row says what actually reaches the phone, in plain words', () => {
  freshState();
  state.notify = false;
  assert.equal(alertsStateLine(), 'Off');
  state.notify = true;
  assert.equal(alertsStateLine(), 'Only while Camp is open');
  const realStatus = globalThis.pushStatus;
  try {
    globalThis.pushStatus = () => 'on';
    assert.ok(/reaches you even with Camp closed/.test(alertsStateLine()));
    globalThis.pushStatus = () => 'reconnect';
    assert.ok(/reconnect/i.test(alertsStateLine()));
  } finally { if (realStatus) globalThis.pushStatus = realStatus; else delete globalThis.pushStatus; }
  state.notify = false;
});

// ── What counselors see ─────────────────────────────────────────────

test('What counselors see: four switches on the existing hiddenCards keys, standings a locked rule', () => {
  const sheet = INDEX.slice(INDEX.indexOf('id="sheet-counselors"'), INDEX.indexOf('<!-- ── FULL WEEK SCHEDULE'));
  const keys = [...sheet.matchAll(/data-hide-card="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['competitions', 'verse', 'cleanup', 'chat']);
  keys.forEach((k) => assert.ok(HIDEABLE_CARDS.includes(k) && !SECRET_CARDS.includes(k), k));
  assert.ok(/is-locked[\s\S]*Standings and points[\s\S]*Secret until you reveal them/.test(sheet));
  assert.equal((INDEX.match(/class="hide-card-toggle"/g) || []).length, 4, 'no switch is left on a home card');
  assert.notOk(/data-hide-card="(standings|bonus)"/.test(INDEX));
});

test('a switch is ON when counselors can see the section, and its word says so', () => {
  freshState();
  setMemberRole('editor');
  const sw = { checked: false, toggleAttribute(n, on) { this.checked = on; }, hasAttribute() { return this.checked; } };
  const word = { textContent: '' };
  const realQuery = document.querySelector;
  document.querySelector = (sel) => {
    if (sel === '.hide-card-toggle[data-hide-card="verse"]') return sw;
    if (sel === '[data-hide-state="verse"]') return word;
    return realQuery.call(document, sel);
  };
  try {
    state.meta.hiddenCards = {};
    applyCardVisibility();
    assert.equal(sw.checked, true, 'shown: switch on');
    assert.equal(word.textContent, 'Shown');
    state.meta.hiddenCards = { verse: true };
    applyCardVisibility();
    assert.equal(sw.checked, false, 'hidden from counselors: switch off');
    assert.equal(word.textContent, 'Hidden');
  } finally { document.querySelector = realQuery; state.meta.hiddenCards = {}; }
});

test('a hidden Memory verse is not on a counselor\'s More, cannot be opened by a deep link, and closes if open', () => {
  freshState();
  state.meta.hiddenCards = { verse: true };
  setMemberRole('viewer');
  assert.equal(shellSheetAllowed('verse'), false);
  assert.equal(shellSheetAllowed('cleanup'), true, 'cleanup is not hidden');
  setMemberRole('editor');
  assert.equal(shellSheetAllowed('verse'), true, 'a director always may');
  setMemberRole('viewer');
  ['members', 'history', 'counselors'].forEach((id) => assert.equal(shellSheetAllowed(id), false, id + ' is directors only'));
  state.meta.hiddenCards = {};
});

// ── the drawers on the shell's stack ────────────────────────────────

function fakeDrawer() {
  const d = { open: false, listeners: {} };
  d.setAttribute = (n) => { if (n === 'open') d.open = true; };
  d.removeAttribute = (n) => { if (n === 'open') { d.open = false; (d.listeners.close || []).forEach((f) => f()); } };
  d.hasAttribute = (n) => n === 'open' && d.open;
  d.addEventListener = (ev, fn) => { (d.listeners[ev] = d.listeners[ev] || []).push(fn); };
  return d;
}

test('Alerts, Change history and Who can sign in are sheets on the history stack: one entry each, Back closes them', () => {
  const drawers = { 'alerts-overlay': fakeDrawer(), 'history-overlay': fakeDrawer(), 'members-overlay': fakeDrawer() };
  const realGet = document.getElementById;
  document.getElementById = (id) => drawers[id] || realGet.call(document, id);
  const saveSheets = shell.sheets.slice(); const saveCur = shell.cur;
  const realReconcile = shellReconcile;
  let reconciles = 0;
  shellReconcile = () => { reconciles++; };
  try {
    shell.sheets.length = 0;
    setMemberRole('editor');
    shellSheetOpen('members');
    assert.equal(drawers['members-overlay'].open, true, 'opened');
    assert.deepEqual(shell.sheets, ['members'], 'and filed on the stack');
    assert.deepEqual(shellSnap().ov.map((o) => o.k + ':' + o.id), ['sheet:members']);
    // The drawer's own ✕ / backdrop / Escape report back through its close event.
    wireMore();
    drawers['members-overlay'].removeAttribute('open'); // what the component does on ✕
    assert.deepEqual(shell.sheets, [], 'its entry left the stack with it');
    // Back (a popstate to a snapshot without the sheet) closes it through shellApply.
    shellSheetOpen('history');
    assert.equal(drawers['history-overlay'].open, true);
    shellSheetClose('history');
    assert.equal(drawers['history-overlay'].open, false, 'closing from the stack closes the drawer');
    // A counselor can never open the directors' drawers, however it is asked.
    setMemberRole('viewer');
    shellSheetOpen('members');
    assert.equal(drawers['members-overlay'].open, false);
    assert.deepEqual(shell.sheets, []);
    shellSheetOpen('alerts'); // everyone's
    assert.equal(drawers['alerts-overlay'].open, true);
    shellSheetClose('alerts');
  } finally {
    shellReconcile = realReconcile;
    document.getElementById = realGet;
    shell.sheets.length = 0; saveSheets.forEach((s) => shell.sheets.push(s)); shell.cur = saveCur;
  }
  assert.ok(reconciles >= 4, 'each open and close reconciled the history stack');
});

test('the old gear drawer and the hand-off between drawers are gone', () => {
  const src = APP.replace(/\/\/.*$/gm, '');
  assert.notOk(/settingsOverlayEl|openSettings|closeSettings|settings-overlay/.test(src), 'app.js');
  assert.notOk(/settings-overlay/.test(readFixture('../push.js')), 'push.js');
  assert.ok(/shellSheetOpen\('alerts'\)/.test(readFixture('../push.js')), 'Alerts opens through the shell');
});

// ── the Your team sheet ─────────────────────────────────────────────

test('the Your team sheet never shows a number, and says what is set by the account', () => {
  const body = APP.slice(APP.indexOf('function renderTeamSheet()'), APP.indexOf('function wireTeamSheetActions'));
  assert.notOk(/medalCounts|rankTeamsByPoints|standingsVisible|points|pts/.test(body), 'no reader of standings is reachable from the sheet');
  assert.ok(/Your team is set by your account/.test(body));
  assert.ok(/CAMP\.features\.electives/.test(body), '"Not you? Change" exists only where electives do');
});

// ── the 44px rule reaches what moved into the frame ─────────────────

test('the 44px target rule: switches, the chips that moved into Games and the sheets, "How to play", lone text links', () => {
  assert.ok(/jelly-switch \{[^}]*--jelly-switch-height: var\(--target\)/.test(CSS), 'a switch is 44px tall (the component\'s own large preset is 40)');
  assert.ok(/jelly-chip:is\(\.bonus-meal-chip, \.bonus-cat-chip, \.bonus-team-chip, \.verse-day-chip, \.pts-btn\) \{[^}]*height: var\(--target\);[^}]*min-width: var\(--target\)/.test(CSS),
    'the component fixes its host at 30 / 36px: an outer rule on the host beats its :host');
  assert.ok(/\.rules-details summary \{[^}]*min-height: var\(--target\)/.test(CSS), '"How to play"');
  assert.ok(/\.quick-game-btn,\s*#clear-result-btn,[\s\S]*?\{[^}]*min-height: var\(--target\)/.test(CSS), 'lone text links');
  assert.ok(/\.tk-head \{[^}]*flex-wrap: wrap/.test(CSS) && /\.tk-titles \{[^}]*flex: 1 1 13rem/.test(CSS), 'a long back label sends the title under it instead of to three lines');
});

test('the Alerts sheet\'s pop-ups switch is the same state as the Notify me button, and keeps More\'s verdict in step', () => {
  assert.ok(/notifySw\.addEventListener\('change', toggleNotify\)/.test(APP), 'a tap on the switch flips state.notify');
  const body = APP.slice(APP.indexOf('function updateNotifyButton()'), APP.indexOf('// changes: [{ team, delta, total }]'));
  assert.ok(/getElementById\('notify-toggle'\)[\s\S]*toggleAttribute\('checked', !!state\.notify\)/.test(body), 'the switch follows the state');
  assert.ok(/renderAlertsState\(\)/.test(body), 'and so does the Alerts row line');
});
