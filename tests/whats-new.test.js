// What's new notes (owner's answer of Nov 9, 2026; CLAUDE.md "What's new notes"). Runs under both camps
// (whats-new.senior.test.js evals this file). The model (whatsNewDue) is pure over the clock and the phone's memory, so the pacing
// is walked on a fake clock: before `at`, waking hours at 6:59 / 7:00 / 20:59 / 21:00 camp time across both clock changes, one an
// hour per phone, a phone that first opens weeks later, the stay, staleness and the cap. Then the role filter (who may read which
// note), the strip's own rules (last, room, reveal, preview), render stability, Show me, and a blocked store.

const HOUR = 3600000;
const etMs = (ymd, h, m) => etWallToEpoch(ymd, h * 60 + (m || 0));
const NOON = etMs('2026-12-01', 12);
const mkNote = (id, over) => Object.assign({ id, at: new Date(NOON - 40 * 86400000).toISOString(), for: 'everyone', text: 'A short note about ' + id + '.' }, over || {});
const WHO = (over) => Object.assign({ confirmed: true, role: 'viewer', owner: false, camp: CAMP.id, has: () => true }, over || {});
const due = (notes, mem, now, who, may) => whatsNewDue(notes, mem, now, who || WHO(), { mayRelease: may !== false });

test('the shipped list: every note is well formed, unique, plain English, with a Show me only to a place that exists', () => {
  const ids = new Set();
  CHANGES.forEach((n) => {
    assert.ok(/^[a-z0-9-]{3,40}$/.test(n.id), n.id);
    assert.ok(!ids.has(n.id), 'unique ' + n.id); ids.add(n.id);
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
  assert.equal(CHANGES.length, 14);
  assert.ok(CHANGES.every((n) => n.at === WHATS_NEW_SHIPPED_AT), 'the deploy stamps one constant');
});

test('pacing: nothing before `at`, then the oldest due note, then one an hour', () => {
  const a = mkNote('aaa', { at: new Date(NOON - 3 * HOUR).toISOString() });
  const b = mkNote('bbb', { at: new Date(NOON - 2 * HOUR).toISOString() });
  const notes = [b, a];
  assert.equal(due(notes, null, NOON - 4 * HOUR).release, null, 'before either shipped');
  assert.equal(due(notes, null, NOON).release.id, 'aaa', 'the oldest due first, whatever the list order');
  let mem = { last: NOON, n: { aaa: { s: NOON } } };
  let p = due(notes, mem, NOON + 59 * 60000);
  assert.equal(p.release, null, 'not before an hour has passed on this phone');
  assert.equal(p.current.id, 'aaa', 'the released one is still the current');
  p = due(notes, mem, NOON + HOUR);
  assert.equal(p.release.id, 'bbb', 'an hour later the next one');
  assert.equal(p.current.id, 'aaa');
});

test('pacing: a mayRelease of false releases nothing but keeps showing the current note', () => {
  const mem = { last: NOON - 5 * HOUR, n: { aaa: { s: NOON - HOUR } } };
  const p = due([mkNote('aaa'), mkNote('bbb')], mem, NOON, WHO(), false);
  assert.equal(p.release, null); assert.equal(p.current.id, 'aaa');
});

test('waking hours: 6:59 no, 7:00 yes, 20:59 yes, 21:00 no, across both clock changes', () => {
  ['2026-11-02', '2026-11-01', '2026-11-08', '2027-03-14', '2027-03-15', '2027-07-20', '2027-11-07'].forEach((d) => {
    const n = [mkNote('aaa', { at: new Date(etMs(d, 0) - 86400000 * 3).toISOString() })];
    assert.equal(due(n, null, etMs(d, 6, 59)).release, null, d + ' 6:59');
    assert.equal(due(n, null, etMs(d, 7, 0)).release.id, 'aaa', d + ' 7:00');
    assert.equal(due(n, null, etMs(d, 20, 59)).release.id, 'aaa', d + ' 20:59');
    assert.equal(due(n, null, etMs(d, 21, 0)).release, null, d + ' 21:00');
  });
});

test('a phone that first opens weeks later is handed the catch-up set one an hour, oldest first, and a refresh in between never speeds it up', () => {
  const notes = ['nn1', 'nn2', 'nn3', 'nn4'].map((id, i) => mkNote(id, { at: new Date(NOON - 60 * 86400000 + i * 60000).toISOString() }));
  let mem = { last: 0, n: {} };
  const seen = [];
  for (let t = NOON; t < NOON + 5 * HOUR && seen.length < 4; t += 10 * 60000) {
    const p = due(notes, mem, t);
    if (p.release) { seen.push(p.release.id); mem = { last: t, n: Object.assign({}, mem.n, { [p.release.id]: { s: t } }) }; }
  }
  assert.deepEqual(seen, ['nn1', 'nn2', 'nn3', 'nn4']);
});

test('a shown note stays four awake hours, or until it is dismissed; the next release replaces it', () => {
  const n = [mkNote('aaa')];
  const rel = etMs('2026-12-01', 18);
  const mem = { last: rel, n: { aaa: { s: rel } } };
  assert.equal(due(n, mem, etMs('2026-12-01', 20, 59)).current.id, 'aaa', 'still up before the stay is spent');
  assert.equal(due(n, mem, etMs('2026-12-02', 7, 0)).current.id, 'aaa', 'the night does not spend it: 3 awake hours so far');
  assert.equal(due(n, mem, etMs('2026-12-02', 8, 1)).current, null, 'after four awake hours it is gone');
  assert.equal(due(n, { last: rel, n: { aaa: { s: rel, d: 1 } } }, rel + 60000).current, null, 'dismissed');
  const two = [mkNote('aaa'), mkNote('bbb')];
  const p = due(two, { last: rel, n: { aaa: { s: rel } } }, rel + HOUR);
  assert.equal(p.release.id, 'bbb');
});

test('stale and capped: a note a year old never comes; a camp week that is over takes its older notes with it; beyond ten the oldest are skipped', () => {
  const old = mkNote('old', { at: new Date(NOON - 366 * 86400000).toISOString() });
  assert.equal(due([old], null, NOON).release, null);
  const early = mkNote('early', { at: new Date(NOON - 30 * 86400000).toISOString() });
  const late = mkNote('late', { at: new Date(NOON - 2 * 86400000).toISOString() });
  assert.equal(due([early, late], null, NOON, WHO({ afterEnd: NOON - 10 * 86400000 })).release.id, 'late', 'a note that shipped before a camp week that is over is left out, a newer one is not');
  assert.equal(due([early], null, NOON, WHO({ afterEnd: NOON - 5 * 86400000 })).release, null, 'shipped before a week that is over');
  const many = Array.from({ length: 13 }, (_, i) => mkNote('m' + String(i).padStart(2, '0'), { at: new Date(NOON - 90 * 86400000 + i * 60000).toISOString() }));
  const q = due(many, null, NOON);
  assert.deepEqual(q.skip, ['m00', 'm01', 'm02'], 'the oldest beyond ten are skipped');
  assert.equal(q.release.id, 'm03', 'and the oldest kept one is next');
  assert.equal(due(many, { last: 0, n: { m00: { k: 1 } } }, NOON).release.id, 'm03');
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
});

// ── on the page ──────────────────────────────────────────────────────
const realNowFn = Date.now;
let CLOCK = NOON;
function boot(role, opts) {
  opts = opts || {};
  freshState();
  localStorage.removeItem(WHATS_NEW_KEY);
  counselorPreviewOn = false;
  tabWriter = true;
  setMemberRole(role);
  state.ui.tab = 'now'; state.ui.gameId = null; state.ui.tool = null; state.ui.revealOpen = false; state.ui.view = 'home';
  shell.dirty.now = false;
  authUser = { email: 'jenn@example.com' };
  state.announcements = {};
  CLOCK = opts.at || NOON;
  Date.now = () => CLOCK;
  const wrap = document.getElementById('announcements');
  wrap.__html = undefined; wrap.__dom = undefined; wrap.hidden = true; wrap.innerHTML = '';
  return wrap;
}
function done() { Date.now = realNowFn; setMemberRole(null); authUser = null; localStorage.removeItem(WHATS_NEW_KEY); state.announcements = {}; }
function keys(wrap) { return (wrap.innerHTML.match(/data-key="wn-[a-z0-9-]+"/g) || []).map((s) => s.slice(13, -1)); }
const mem = () => JSON.parse(localStorage.getItem(WHATS_NEW_KEY) || 'null');
const rows = [];

test('the page: a counselor gets the counselor notes, one an hour, in the strip, and never a director\'s', () => {
  const wrap = boot('viewer');
  const seen = [];
  try {
    for (let i = 0; i < 12; i++) {
      renderAnnouncements();
      const k = keys(wrap);
      assert.ok(k.length <= 1, 'one at a time');
      if (k.length && !seen.includes(k[0])) seen.push(k[0]);
      CLOCK += HOUR;
      if (!isAwakeHours(CLOCK)) CLOCK = etMs('2026-12-02', 7, 5) + (i - 5) * HOUR; // never into the night
    }
    seen.forEach((id) => assert.ok(['counselors', 'everyone'].includes(CHANGES.find((c) => c.id === id).for), id + ' is for counselors'));
    assert.ok(seen.includes('four-tabs'), 'the first counselor note comes first');
    assert.ok(!seen.includes('tell-everyone') && !seen.includes('new-year-setup') && !seen.includes('score-from-games'));
  } finally { done(); }
});

test('the page: a director reads the director notes, never the counselor or the owner ones; the owner reads the owner\'s too', () => {
  const run = (role, owner) => {
    const wrap = boot(role);
    const real = isOwner;
    isOwner = () => !!owner;
    const seen = [];
    try {
      for (let i = 0; i < 40; i++) {
        renderAnnouncements();
        keys(wrap).forEach((k) => { if (!seen.includes(k)) seen.push(k); });
        CLOCK += HOUR + 60000;
        if (!isAwakeHours(CLOCK)) CLOCK = etMs('2026-12-0' + (2 + (i % 5)), 7, 5);
      }
    } finally { isOwner = real; done(); }
    return seen;
  };
  const dir = run('editor', false);
  assert.ok(dir.includes('set-up-the-week') || dir.includes('score-from-games'), 'directors get notes: ' + dir);
  assert.ok(!dir.includes('four-tabs') && !dir.includes('new-year-setup') && !dir.includes('games-tab-results'));
  const own = run('editor', true);
  assert.ok(own.includes('new-year-setup'), 'the owner reads the owner\'s note: ' + own);
});

test('the page: a section switched off in What counselors see hides its note; a hinted phone and a counselor preview read nothing', () => {
  let wrap = boot('viewer');
  try {
    state.meta.hiddenCards = { competitions: true };
    renderAnnouncements(); CLOCK += 2 * HOUR; renderAnnouncements(); CLOCK += 2 * HOUR; renderAnnouncements(); CLOCK += 2 * HOUR; renderAnnouncements();
    assert.ok(!(mem() && mem().n['games-tab-results']), 'Games is off: nobody reads about the Games tab');
    state.meta.hiddenCards = {};
  } finally { done(); }
  wrap = boot('viewer');
  try {
    setMemberRole('viewer', { provisional: true });
    renderAnnouncements();
    assert.equal(keys(wrap).length, 0, 'a hint-painted phone');
    setMemberRole('editor');
    counselorPreviewOn = true;
    renderAnnouncements();
    assert.equal(keys(wrap).length, 0, 'a preview never draws a note (it is this phone\'s own reading list)');
    assert.equal(mem(), null, 'and releases nothing');
  } finally { counselorPreviewOn = false; done(); }
});

test('the page: it rides LAST in the strip, behind a banner and the join bar, never behind "N more", and not at all with no room', () => {
  const wrap = boot('viewer');
  try {
    state.announcements = { a1: { id: 'a1', text: 'Supper at six', at: new Date(CLOCK).toISOString(), ttlMs: 3600000, by: 'Jenn' } };
    renderAnnouncements();
    const html = wrap.innerHTML;
    assert.ok(html.indexOf('data-key="ann-a1"') >= 0 && html.indexOf('data-key="wn-') > html.indexOf('ann-a1'), 'after the banner');
    assert.equal(annOverflow.n, 0, 'the note is never counted in "N more messages"');
    // no room: three banners fill the cap of three
    boot('viewer');
    const w2 = document.getElementById('announcements');
    state.announcements = {};
    ['a', 'b', 'c'].forEach((x, i) => { state.announcements[x] = { id: x, text: 'Banner ' + x, at: new Date(CLOCK - i * 1000).toISOString(), ttlMs: 3600000, by: 'Jenn' }; });
    renderAnnouncements();
    assert.equal(keys(w2).length, 0, 'the strip is full: no note');
    assert.equal(mem(), null, 'and nothing was released for a note that was never drawn');
  } finally { done(); }
});

test('the page: a live reveal and the quiet hours show no note; a takeover over Now releases nothing', () => {
  let wrap = boot('viewer', { at: etMs('2026-12-01', 22) });
  try {
    renderAnnouncements();
    assert.equal(keys(wrap).length, 0, 'at 10 PM');
    wrap = boot('viewer');
    state.ui.gameId = 'g1';
    const real = shellTakeoverOpen;
    shellTakeoverOpen = () => true;
    try { renderAnnouncements(); } finally { shellTakeoverOpen = real; }
    assert.equal(keys(wrap).length, 0, 'under a takeover');
    assert.equal(mem(), null);
    state.ui.gameId = null;
    wrap = boot('viewer');
    const realLive = revealLiveView;
    revealLiveView = () => ({ live: true });
    try { renderAnnouncements(); } finally { revealLiveView = realLive; }
    assert.equal(keys(wrap).length, 0, 'a reveal is live');
  } finally { done(); }
});

test('the page: an idle repaint writes nothing, a dismissal sticks for that note only and survives a reload, Show me opens its place', () => {
  const wrap = boot('viewer');
  try {
    renderAnnouncements();
    const first = keys(wrap)[0];
    assert.ok(first, 'a note is up');
    const before = wrap.innerHTML;
    let writes = 0;
    const realSet = localStorage.setItem;
    localStorage.setItem = function () { writes++; return realSet.apply(this, arguments); };
    try { renderAnnouncements(); renderAnnouncements(); } finally { localStorage.setItem = realSet; }
    assert.equal(writes, 0, 'an idle render writes no memory');
    assert.equal(wrap.innerHTML, before, 'nor the strip');
    assert.ok(/data-wn-x="/.test(before) && /aria-label="Dismiss this note on this phone"/.test(before));
    // Show me
    const note = CHANGES.find((c) => c.id === first);
    if (note.show) {
      assert.ok(/data-wn-show=/.test(before), 'Show me is drawn while the place can be opened');
      let went = null;
      const real = WHATS_NEW_SHOW[note.show.to].go;
      WHATS_NEW_SHOW[note.show.to].go = () => { went = note.show.to; };
      try { annStripClick({ target: { closest: (s) => (s === '[data-wn-show]' ? { dataset: { wnShow: first } } : null) } }); } finally { WHATS_NEW_SHOW[note.show.to].go = real; }
      assert.equal(went, note.show.to, 'the shell door was asked');
      assert.ok(mem().n[first].d, 'and the note is read');
    } else {
      whatsNewEnd(first);
    }
    assert.ok(mem().n[first].d === 1, 'dismissed on this phone');
    renderAnnouncements();
    assert.ok(!keys(wrap).includes(first), 'it does not come back, even after a reload (the memory is in storage)');
    assert.equal(JSON.parse(localStorage.getItem(WHATS_NEW_KEY)).n[first].d, 1);
    // Show me is refused where the place cannot be opened
    const gated = CHANGES.find((c) => c.show && c.show.to === 'tell');
    CLOCK = CLOCK; setMemberRole('viewer');
    assert.equal(WHATS_NEW_SHOW.tell.ok(), false, 'a counselor cannot open Tell everyone');
    assert.ok(!/data-wn-show/.test(whatsNewHtml(gated)), 'so no Show me is drawn');
  } finally { done(); }
});

test('the page: sign-out keeps the memory (or every note would come back), the old badge key is only wiped, nothing touches the database', () => {
  boot('viewer');
  try {
    renderAnnouncements();
    const raw = localStorage.getItem(WHATS_NEW_KEY);
    assert.ok(raw);
    const stub = { ref() { throw new Error('a note never reads or writes the database'); } };
    const realRef = fbRef; fbRef = stub;
    try { renderAnnouncements(); CLOCK += 2 * HOUR; renderAnnouncements(); } finally { fbRef = realRef; }
    clearLocalData();
    assert.ok(localStorage.getItem(WHATS_NEW_KEY), 'clearLocalData keeps the reading list');
    assert.equal(WHATS_NEW_KEY, 'campScoreboardWhatsNew', 'device-wide, no camp suffix');
    assert.ok(!/lsKey/.test(String(whatsNewWrite)));
  } finally { done(); }
});

test('the page: a blocked store shows nothing and loops nothing; the app runs with CHANGES empty', () => {
  const wrap = boot('viewer');
  const realGet = localStorage.getItem; const realSet = localStorage.setItem;
  try {
    localStorage.getItem = () => { throw new Error('blocked'); };
    localStorage.setItem = () => { throw new Error('blocked'); };
    renderAnnouncements(); renderAnnouncements();
    assert.equal(keys(wrap).length, 0);
  } finally { localStorage.getItem = realGet; localStorage.setItem = realSet; }
  // a store that reads but cannot write: a release is never drawn
  const w2 = boot('viewer');
  try {
    localStorage.setItem = () => { throw new Error('full'); };
    renderAnnouncements();
    assert.equal(keys(w2).length, 0, 'no draw without a remembered release');
  } finally { localStorage.setItem = realSet; }
  const saved = CHANGES.splice(0, CHANGES.length);
  try {
    const w3 = boot('editor');
    renderAnnouncements();
    assert.equal(keys(w3).length, 0);
    assert.equal(w3.hidden, true);
  } finally { CHANGES.push(...saved); done(); }
});

test('escaping: a note\'s words and ids are escaped on the way into markup', () => {
  const html = whatsNewHtml({ id: 'x-1', text: '<b>"hi" & bye</b>', at: '2026-01-01T00:00:00Z', for: 'everyone', show: { to: 'games', where: 'the "Games" tab' } });
  assert.ok(!html.includes('<b>') && html.includes('&lt;b&gt;'));
  assert.ok(!/aria-label="Show me the "Games"/.test(html));
});
