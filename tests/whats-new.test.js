// What's new notes (owner's answer of Nov 9, 2026, item 9; CLAUDE.md "What's new notes"). Runs under both camps
// (whats-new.senior.test.js evals this file). A note is live for ONE HOUR from its `at`, by the server's clock, and never again.
// The model (whatsNewDue) is pure over the clock and this phone's dismissals, so the hour is walked to the millisecond on a fake
// clock; then the role filter, the strip's own rules (after the banners, room, overflow into Messages, reveal, preview, giving way,
// sdkLoadFailed, the arrival paint), render stability, Show me, and the memory.

const HOUR = 3600000;
const etMs = (ymd, h, m) => etWallToEpoch(ymd, h * 60 + (m || 0));
const AT = etMs('2026-12-01', 12);
const mkNote = (id, over) => Object.assign({ id, at: new Date(AT).toISOString(), for: 'everyone', text: 'A short note about ' + id + '.' }, over || {});
const WHO = (over) => Object.assign({ confirmed: true, role: 'viewer', owner: false, camp: CAMP.id, has: () => true }, over || {});
const live = (notes, now, who, gone) => whatsNewDue(notes, gone || null, now, who || WHO()).map((n) => n.id);

test('the shipped lists: every note is well formed, plain English, with a Show me only to a place that exists; no id is ever reused', () => {
  const ids = new Set();
  const all = CHANGES.map((n) => n.id).concat(WHATS_NEW_RETIRED);
  all.forEach((id) => {
    assert.ok(/^[a-z0-9-]{3,40}$/.test(id), id);
    assert.ok(!ids.has(id), 'unique across CHANGES and WHATS_NEW_RETIRED: ' + id); ids.add(id);
  });
  assert.ok(Object.isFrozen(WHATS_NEW_RETIRED), 'the retired list is frozen');
  ['four-tabs', 'score-from-games', 'games-tab-results', 'reveal-remote', 'chat-tab', 'tell-everyone', 'phone-alerts', 'award-points',
    'reveal-on-now', 'set-up-the-week', 'preview-counselor', 'days-and-backup', 'new-year-setup', 'remove-tells-followers'].forEach((id) => assert.ok(WHATS_NEW_RETIRED.includes(id), 'v215 id kept: ' + id));
  CHANGES.forEach((n) => {
    assert.ok(Number.isFinite(Date.parse(n.at)), 'at ' + n.id);
    assert.ok(['everyone', 'counselors', 'directors', 'owner'].includes(n.for), 'for ' + n.id);
    assert.ok(!n.camp || ['junior', 'senior'].includes(n.camp));
    (n.needs || []).forEach((k) => assert.equal(typeof WHATS_NEW_NEEDS[k], 'function', 'gate ' + k));
    assert.ok(n.text.length <= 60, n.id + ' is short: ' + n.text.length);
    assert.ok(!/[!]/.test(n.text) && !/'/.test(n.text), n.id + ': no exclamation mark, curly apostrophes');
    assert.ok(!/\b(update|updates|feature|features|version)\b/i.test(n.text), n.id + ' has no jargon');
    assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(n.text), n.id + ' has no emoji');
    assert.ok(!/\d|\bplaces?\b/i.test(n.text), n.id + ' names no point or place');
    if (n.show) { assert.ok(WHATS_NEW_SHOW[n.show.to], 'show ' + n.id); assert.ok(n.show.where && n.show.where.length < 30); }
  });
  // The v215 catch-up set's hour is over: nothing of it is still shipped.
  assert.ok(!CHANGES.some((n) => WHATS_NEW_RETIRED.includes(n.id)), 'a retired id is not in CHANGES');
});

test('the hour: nothing before `at`, live from `at`, still live at +59:59.999, gone at +60:00, and never again', () => {
  const n = [mkNote('aaa')];
  assert.deepEqual(live(n, AT - 1), [], 'a millisecond early');
  assert.deepEqual(live(n, AT), ['aaa'], 'at `at`');
  assert.deepEqual(live(n, AT + HOUR - 1), ['aaa'], 'last millisecond of the hour');
  assert.deepEqual(live(n, AT + HOUR), [], 'the hour is over');
  [AT + 5 * HOUR, AT + 30 * 86400000, AT + 400 * 86400000, etMs('2026-12-02', 8), etMs('2027-07-20', 12)].forEach((t) => assert.deepEqual(live(n, t), [], 'never again at ' + t));
  assert.deepEqual(live(n, NaN), [], 'no clock, no note');
  assert.deepEqual(live(n, AT + 1000, WHO(), new Set(['aaa'])), [], 'dismissed on this phone');
});

test('the hour has no waking-hours rule: an update that goes live at night has its notes live at night', () => {
  const at = etMs('2026-12-01', 23, 30);
  const n = [mkNote('aaa', { at: new Date(at).toISOString() })];
  assert.deepEqual(live(n, at + 10 * 60000), ['aaa']);
  assert.deepEqual(live(n, etMs('2026-12-02', 7, 0)), [], 'and nobody opening the phone at 7 AM sees it');
});

test('two notes of one update are live together; with overlapping hours the newer update comes first; the same-time ones keep list order', () => {
  const older = mkNote('old-one', { at: new Date(AT - 30 * 60000).toISOString() });
  const a = mkNote('aaa'); const b = mkNote('bbb');
  assert.deepEqual(live([a, b], AT + 1000), ['aaa', 'bbb'], 'both, in CHANGES order');
  assert.deepEqual(live([older, a, b], AT + 1000), ['aaa', 'bbb', 'old-one'], 'the newer update first');
  assert.deepEqual(live([older, a, b], AT + 40 * 60000), ['aaa', 'bbb'], 'the older hour ended first');
  assert.deepEqual(live([a, b], AT + 1000, WHO(), { aaa: 1 }), ['bbb'], 'a dismissal is per note');
});

test('who may read a note: the role, the camp, the gates, a confirmed answer', () => {
  const N = (over) => mkNote('xxx', over);
  assert.ok(whatsNewAudienceOk(N({ for: 'everyone' }), WHO()));
  assert.ok(whatsNewAudienceOk(N({ for: 'everyone' }), WHO({ role: 'editor' })));
  assert.ok(whatsNewAudienceOk(N({ for: 'counselors' }), WHO()));
  assert.ok(!whatsNewAudienceOk(N({ for: 'counselors' }), WHO({ role: 'editor' })));
  assert.ok(whatsNewAudienceOk(N({ for: 'directors' }), WHO({ role: 'editor' })));
  assert.ok(!whatsNewAudienceOk(N({ for: 'directors' }), WHO()), 'a counselor never reads a director note');
  assert.ok(!whatsNewAudienceOk(N({ for: 'owner' }), WHO({ role: 'editor' })), 'a director is not the owner');
  assert.ok(whatsNewAudienceOk(N({ for: 'owner' }), WHO({ role: 'editor', owner: true })));
  assert.ok(!whatsNewAudienceOk(N({ for: 'everyone' }), WHO({ confirmed: false })), 'a hint-painted phone reads nothing');
  const other = CAMP.id === 'junior' ? 'senior' : 'junior';
  assert.ok(!whatsNewAudienceOk(N({ camp: other }), WHO()), 'the other camp\'s note');
  assert.ok(whatsNewAudienceOk(N({ camp: CAMP.id }), WHO()));
  assert.ok(!whatsNewAudienceOk(N({ needs: ['games'] }), WHO({ has: (k) => k !== 'games' })), 'a screen this phone cannot open');
  assert.ok(!whatsNewAudienceOk(N({ for: 'nobody' }), WHO()) && !whatsNewAudienceOk(null, WHO()));
  assert.deepEqual(live([N({ for: 'directors' }), N({ id: 'yyy' })], AT + 1, WHO()), ['yyy']);
});

// ── on the page ──────────────────────────────────────────────────────
const realNowFn = Date.now;
const savedChanges = CHANGES.slice();
let CLOCK = AT + 60000;
function boot(role, notes) {
  freshState();
  localStorage.removeItem(WHATS_NEW_KEY);
  whatsNewGone = null;
  CHANGES.length = 0;
  (notes || [mkNote('aaa'), mkNote('bbb')]).forEach((n) => CHANGES.push(n));
  counselorPreviewOn = false;
  sdkLoadFailed = false;
  tabWriter = true;
  setMemberRole(role);
  serverTimeOffset = 0; serverOffsetKnown = true;
  state.ui.tab = 'now'; state.ui.gameId = null; state.ui.tool = null; state.ui.revealOpen = false; state.ui.view = 'home';
  shell.dirty.now = false;
  authUser = { email: 'jenn@example.com' };
  state.announcements = {};
  CLOCK = AT + 60000;
  Date.now = () => CLOCK;
  const wrap = document.getElementById('announcements');
  wrap.__html = undefined; wrap.__dom = undefined; wrap.hidden = true; wrap.innerHTML = '';
  return wrap;
}
function done() {
  Date.now = realNowFn; setMemberRole(null); authUser = null; localStorage.removeItem(WHATS_NEW_KEY); whatsNewGone = null;
  state.announcements = {}; sdkLoadFailed = false; counselorPreviewOn = false; serverTimeOffset = 0;
  CHANGES.length = 0; savedChanges.forEach((n) => CHANGES.push(n));
}
function keys(wrap) { return (wrap.innerHTML.match(/data-key="wn-[a-z0-9-]+"/g) || []).map((s) => s.slice(13, -1)); }
const mem = () => JSON.parse(localStorage.getItem(WHATS_NEW_KEY) || 'null');
const banner = (id, i) => ({ id, text: 'Banner ' + id, at: new Date(CLOCK - (i || 0) * 1000).toISOString(), ttlMs: 3600000, by: 'Jenn' });

test('the page: both notes of the update show together in the strip during the hour, then leave on the next paint after it, and never return', () => {
  const wrap = boot('viewer');
  try {
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb']);
    assert.equal(wrap.hidden, false);
    CLOCK = AT + HOUR - 1; renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb'], 'the last millisecond');
    CLOCK = AT + HOUR; renderAnnouncements();
    assert.deepEqual(keys(wrap), [], 'the hour is over');
    assert.equal(wrap.hidden, true);
    CLOCK = AT + 40 * 86400000; renderAnnouncements();
    assert.deepEqual(keys(wrap), [], 'never again');
  } finally { done(); }
});

test('the page: the SERVER clock decides, so a phone whose own clock is wrong cannot stretch or cut the hour; no known server clock, no note', () => {
  const wrap = boot('viewer');
  try {
    // The phone runs 3 hours fast: its own time says the hour is over, the server's says it is not.
    CLOCK = AT + 3 * HOUR + 60000; serverTimeOffset = -3 * HOUR;
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb'], 'a fast phone still sees the note the server says is live');
    // The phone runs 3 hours slow: its own time says the note has not shipped.
    CLOCK = AT - 2 * HOUR; serverTimeOffset = 2 * HOUR + 60000;
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb'], 'a slow phone sees it too');
    // The server says it is over though the phone says it is not.
    CLOCK = AT + 10 * 60000; serverTimeOffset = 2 * HOUR;
    renderAnnouncements();
    assert.deepEqual(keys(wrap), [], 'a slow-clock phone cannot keep a note alive');
    serverTimeOffset = 0; serverOffsetKnown = false; CLOCK = AT + 60000;
    renderAnnouncements();
    assert.deepEqual(keys(wrap), [], 'a phone that has not learned the server clock fails closed');
    serverOffsetKnown = true; renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb']);
  } finally { done(); }
});

test('the page: a director reads the director notes, never the counselor or the owner ones; the owner reads the owner\'s too', () => {
  const notes = [mkNote('for-all'), mkNote('for-kids', { for: 'counselors' }), mkNote('for-dirs', { for: 'directors' }), mkNote('for-owner', { for: 'owner' })];
  const run = (role, owner) => {
    const wrap = boot(role, notes);
    const real = isOwner;
    isOwner = () => !!owner;
    try { renderAnnouncements(); return keys(wrap); } finally { isOwner = real; done(); }
  };
  assert.deepEqual(run('viewer', false), ['for-all', 'for-kids']);
  assert.deepEqual(run('editor', false), ['for-all', 'for-dirs']);
  assert.deepEqual(run('editor', true), ['for-all', 'for-dirs', 'for-owner']);
});

test('the page: a section switched off hides its note; a hinted phone, a failed sign-in service and a counselor preview read nothing', () => {
  let wrap = boot('viewer', [mkNote('gam', { needs: ['games'] }), mkNote('aaa')]);
  try {
    state.meta.hiddenCards = { competitions: true };
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa'], 'Games is off: nobody reads about the Games tab');
    state.meta.hiddenCards = {};
  } finally { done(); }
  wrap = boot('viewer');
  try {
    setMemberRole('viewer', { provisional: true });
    renderAnnouncements();
    assert.equal(keys(wrap).length, 0, 'a hint-painted phone');
    setMemberRole('editor');
    sdkLoadFailed = true;
    renderAnnouncements();
    assert.equal(keys(wrap).length, 0, 'sdkLoadFailed: a director\'s phone reads as a viewer, no note is spent on it');
    sdkLoadFailed = false;
    counselorPreviewOn = true;
    renderAnnouncements();
    assert.equal(keys(wrap).length, 0, 'a preview never draws a note (it is this phone\'s own reading list)');
    assert.equal(mem(), null, 'and writes nothing');
    counselorPreviewOn = false;
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb'], 'and the notes are still there once it ends');
  } finally { done(); }
});

test('the page: they ride LAST, after the banners and the join bar, and count as ONE message against the cap', () => {
  const wrap = boot('viewer');
  try {
    state.announcements = { a1: banner('a1') };
    renderAnnouncements();
    const html = wrap.innerHTML;
    assert.ok(html.indexOf('data-key="ann-a1"') >= 0 && html.indexOf('data-key="wn-aaa"') > html.indexOf('ann-a1') && html.indexOf('data-key="wn-bbb"') > html.indexOf('wn-aaa'), 'after the banner');
    assert.equal(annOverflow.n, 0, 'two banners-worth of notes fit beside one banner: the cap counts the notes as one');
    // The cap of three holds three messages: two banners + the notes.
    state.announcements = { a1: banner('a1', 0), a2: banner('a2', 1) };
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb'], 'two banners and the notes');
    // Three banners fill the strip: every note goes behind "N more messages", after them.
    state.announcements = { a1: banner('a1', 0), a2: banner('a2', 1), a3: banner('a3', 2) };
    renderAnnouncements();
    assert.deepEqual(keys(wrap), [], 'the strip is full of banners');
    assert.equal(annOverflow.n, 2, 'the notes are counted in "N more messages"');
    assert.ok(annOverflow.html.indexOf('data-key="wn-aaa"') >= 0 && annOverflow.html.indexOf('data-key="wn-bbb"') > annOverflow.html.indexOf('wn-aaa'), 'and are in the Messages sheet');
    assert.equal(mem(), null, 'drawing a note writes nothing');
    // Four banners: one is already behind "more"; the notes come after it.
    state.announcements.a4 = banner('a4', 3);
    renderAnnouncements();
    assert.equal(annOverflow.n, 3);
    assert.ok(annOverflow.html.indexOf('ann-a') < annOverflow.html.indexOf('wn-aaa'), 'banners first, notes after');
    // Dismissed from the sheet's copy: gone from the overflow.
    whatsNewEnd('aaa'); renderAnnouncements();
    assert.equal(annOverflow.n, 2);
  } finally { done(); }
});

test('the page: the strip is measured STRICTLY: notes that do not fit within a third of the window go behind "more", and the banner always shows', () => {
  const wrap = boot('viewer');
  const tab = document.getElementById('tab-now');
  const realBox = tab.getBoundingClientRect;
  const realCS = globalThis.getComputedStyle;
  const realCreate = document.createElement;
  try {
    // A hand-made layout: every message is 100px tall in a 360px column; the window is 600px, so the budget is 200px.
    tab.getBoundingClientRect = () => ({ top: 0, left: 0, right: 360, bottom: 900, width: 360, height: 900 });
    globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0', rowGap: '0', fontSize: '16px' });
    window.innerHeight = 600;
    document.createElement = function () {
      const el = realCreate.apply(document, arguments);
      el.getBoundingClientRect = () => ({ top: 0, bottom: 0, width: 360, height: 0 });
      Object.defineProperty(el, 'children', { configurable: true, get() { return (el.__kids = el.__kids || String(el.innerHTML).split('data-key=').slice(1).map((_, i) => ({ getBoundingClientRect: () => ({ bottom: (i + 1) * 100 }) }))); } });
      return el;
    };
    state.announcements = { a1: banner('a1') };
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa'], 'one banner and ONE note fit in 200px');
    assert.equal(annOverflow.n, 1, 'the other note is behind "more"');
    assert.ok(annOverflow.html.indexOf('wn-bbb') >= 0);
    state.announcements = {};
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb'], 'with no banner both fit');
    window.innerHeight = 250; // budget 83px: not even one 100px note
    renderAnnouncements();
    assert.deepEqual(keys(wrap), [], 'a note never takes more than a third of the screen (no "the newest always shows" exception)');
    assert.equal(annOverflow.n, 2, 'but it is not lost: both wait in Messages');
  } finally { tab.getBoundingClientRect = realBox; globalThis.getComputedStyle = realCS; document.createElement = realCreate; window.innerHeight = 844; done(); }
});

test('the page: it gives way to a notice that IS the Now card, a cleanup or verse moment and a held block, and comes back after', () => {
  const wrap = boot('viewer');
  const real = nowLast;
  try {
    [{ card: { kind: 'notice' } }, { card: { kind: 'games' }, moment: { kind: 'cleanup' } }, { card: { kind: 'games', over: true } }, { card: { kind: 'meal', hold: { x: 1 } } }].forEach((m, i) => {
      nowLast = m;
      renderAnnouncements();
      assert.deepEqual(keys(wrap), [], 'gives way ' + i);
      assert.equal(annOverflow.n, 0, 'and goes nowhere else ' + i);
    });
    nowLast = { card: { kind: 'activity' } };
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb'], 'back with the ordinary card');
  } finally { nowLast = real; done(); }
});

test('the page: a live reveal shows no note; a takeover and another tab draw none in the strip', () => {
  let wrap = boot('viewer');
  try {
    const realLive = revealLiveView;
    revealLiveView = () => ({ live: true });
    try { renderAnnouncements(); } finally { revealLiveView = realLive; }
    assert.equal(keys(wrap).length, 0, 'a reveal is live');
    assert.equal(annOverflow.n, 0);
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb'], 'and the notes are there when it ends');
  } finally { done(); }
});

test('the page: a note new to a paint while Now was on screen unfolds; on the arrival paint nothing moves; an idle paint moves nothing', () => {
  const wrap = boot('viewer', [mkNote('aaa', { at: new Date(AT + 600000).toISOString() }), mkNote('bbb', { at: new Date(AT + 600000).toISOString() })]);
  const realMoving = annPaintMoving;
  let moved = 0;
  wrap.animate = () => ({});
  annPaintMoving = function () { moved++; return realMoving.apply(this, arguments); };
  try {
    renderAnnouncements();
    assert.equal(moved, 0, 'before the hour starts there is nothing to draw');
    CLOCK = AT + 700000;
    shell.dirty.now = true; // the paint that brings Now into view
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['aaa', 'bbb']);
    assert.equal(moved, 0, 'the arrival paint is a plain write: the notes are part of the panel');
    renderAnnouncements();
    assert.equal(moved, 0, 'an idle repaint moves nothing');
    wrap.innerHTML = ''; wrap.__html = undefined; wrap.__dom = undefined;
    shell.dirty.now = false;
    renderAnnouncements();
    assert.equal(moved, 1, 'a note new to a paint while Now was already on screen moves in (even before the first server snapshot)');
  } finally { annPaintMoving = realMoving; delete wrap.animate; done(); }
});

test('the page: an idle repaint with a banner and a note writes nothing and measures nothing again (annFit keeps its measurements)', () => {
  const wrap = boot('viewer', [mkNote('aaa')]);
  const tab = document.getElementById('tab-now');
  const realBox = tab.getBoundingClientRect;
  const realCS = globalThis.getComputedStyle;
  const realCreate = document.createElement;
  let made = 0;
  try {
    tab.getBoundingClientRect = () => ({ top: 0, left: 0, right: 360, bottom: 900, width: 360, height: 900 });
    globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0', rowGap: '0', fontSize: '16px' });
    document.createElement = function () { made++; return realCreate.apply(document, arguments); };
    state.announcements = { a1: banner('a1') };
    renderAnnouncements();
    assert.ok(made >= 1, 'the first paint measured');
    const before = wrap.innerHTML;
    made = 0;
    let writes = 0;
    const realSet = localStorage.setItem;
    localStorage.setItem = function () { writes++; return realSet.apply(this, arguments); };
    try { renderAnnouncements(); renderAnnouncements(); } finally { localStorage.setItem = realSet; }
    assert.equal(made, 0, 'no new measurement: a measurement is a write to the page');
    assert.equal(writes, 0);
    assert.equal(wrap.innerHTML, before);
    assert.ok(/data-key="wn-aaa"/.test(before) && /data-key="ann-a1"/.test(before));
  } finally { tab.getBoundingClientRect = realBox; globalThis.getComputedStyle = realCS; document.createElement = realCreate; done(); }
});

test('the page: a dismissal is per note and per phone, is written as v2, survives a reload, a blocked store still hides it for the page\'s life, Show me opens its place', () => {
  const wrap = boot('viewer', [mkNote('aaa', { needs: ['games'], show: { to: 'games', where: 'the Games tab' } }), mkNote('bbb')]);
  try {
    renderAnnouncements();
    const html = wrap.innerHTML;
    assert.ok(/data-wn-x="aaa"/.test(html) && /aria-label="Dismiss this note on this phone"/.test(html));
    assert.ok(/data-wn-show="aaa"/.test(html), 'Show me is drawn while the place can be opened');
    let went = null;
    const real = WHATS_NEW_SHOW.games.go;
    WHATS_NEW_SHOW.games.go = () => { went = 'games'; };
    try { annStripClick({ target: { closest: (s) => (s === '[data-wn-show]' ? { dataset: { wnShow: 'aaa' } } : null) } }); } finally { WHATS_NEW_SHOW.games.go = real; }
    assert.equal(went, 'games', 'the shell door was asked');
    assert.deepEqual(mem(), { v: 2, d: { aaa: 1 } }, 'only the dismissal is remembered');
    assert.deepEqual(keys(wrap), ['bbb'], 'the other note stays');
    whatsNewGone = null; // a reload reads the store again
    renderAnnouncements();
    assert.deepEqual(keys(wrap), ['bbb'], 'it does not come back after a reload');
    // A store that cannot be written: the note is still gone for this page.
    const realSet = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('full'); };
    try { whatsNewEnd('bbb'); renderAnnouncements(); } finally { localStorage.setItem = realSet; }
    assert.deepEqual(keys(wrap), [], 'hidden for the page\'s life');
    // Show me is refused where the place cannot be opened.
    setMemberRole('viewer');
    assert.equal(WHATS_NEW_SHOW.tell.ok(), false, 'a counselor cannot open Tell everyone');
    assert.ok(!/data-wn-show/.test(whatsNewHtml({ id: 'zzz', at: AT, for: 'everyone', text: 'x', show: { to: 'tell', where: 'Tell everyone' } })), 'so no Show me is drawn');
  } finally { done(); }
});

test('the memory: v1 and junk read as empty; ids no longer in CHANGES are dropped on write; a blocked store reads empty and loops nothing', () => {
  boot('viewer');
  try {
    localStorage.setItem(WHATS_NEW_KEY, JSON.stringify({ v: 1, last: 5, n: { aaa: { d: 1 } } }));
    whatsNewGone = null;
    assert.equal(whatsNewDismissed().size, 0, 'the old pacing memory is not a dismissal');
    localStorage.setItem(WHATS_NEW_KEY, '{not json');
    whatsNewGone = null;
    assert.equal(whatsNewDismissed().size, 0);
    localStorage.setItem(WHATS_NEW_KEY, JSON.stringify({ v: 2, d: { aaa: 1, gone: 1 } }));
    whatsNewGone = null;
    assert.ok(whatsNewDismissed().has('aaa'));
    whatsNewEnd('bbb');
    assert.deepEqual(mem(), { v: 2, d: { aaa: 1, bbb: 1 } }, 'an id that left CHANGES is dropped');
    const realGet = localStorage.getItem;
    localStorage.getItem = () => { throw new Error('blocked'); };
    whatsNewGone = null;
    try { assert.equal(whatsNewDismissed().size, 0); renderAnnouncements(); } finally { localStorage.getItem = realGet; }
  } finally { done(); }
});

test('the page: sign-out keeps the memory, the old badge key is only wiped, nothing touches the database', () => {
  boot('viewer');
  try {
    renderAnnouncements();
    whatsNewEnd('aaa');
    const raw = localStorage.getItem(WHATS_NEW_KEY);
    assert.ok(raw);
    const stub = { ref() { throw new Error('a note never reads or writes the database'); } };
    const realRef = fbRef; fbRef = stub;
    try { renderAnnouncements(); CLOCK += 10 * 60000; renderAnnouncements(); } finally { fbRef = realRef; }
    clearLocalData();
    assert.equal(localStorage.getItem(WHATS_NEW_KEY), raw, 'clearLocalData keeps the dismissals');
    assert.equal(WHATS_NEW_KEY, 'campScoreboardWhatsNew', 'device-wide, no camp suffix');
  } finally { done(); }
});

test('the app runs with CHANGES empty (what ships between updates): no strip, nothing hidden wrongly', () => {
  const wrap = boot('editor', []);
  try {
    renderAnnouncements();
    assert.equal(keys(wrap).length, 0);
    assert.equal(wrap.hidden, true);
    assert.equal(annOverflow.n, 0);
  } finally { done(); }
});

test('escaping: a note\'s words and ids are escaped on the way into markup', () => {
  const html = whatsNewHtml({ id: 'x-1', text: '<b>"hi" & bye</b>', at: '2026-01-01T00:00:00Z', for: 'everyone', show: { to: 'games', where: 'the "Games" tab' } });
  assert.ok(!html.includes('<b>') && html.includes('&lt;b&gt;'));
  assert.ok(!/aria-label="Show me the "Games"/.test(html));
});
