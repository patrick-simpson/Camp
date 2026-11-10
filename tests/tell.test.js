// tell.js — TELL EVERYONE (redesign §7.2, mockup 10; BUILD-PLAN Step 24). Runs under both camp profiles
// (tell.senior.test.js evals this file: four teams, flag marks). What these cases pin: the channel combinations (banner,
// the pinned notice, buzz) and what each puts where; what a PARTIAL failure says and does; the notice replace rule and
// an Undo that puts the previous notice back only if it is unchanged; quick alerts (Urgent ticked); a Buzz that is
// disabled with its reason until phone alerts are live and never armed by accident; a draft that survives a re-render
// and a closed composer; that the auto-update waits (reloadBlocked) while a message is being typed or sent; and that a
// counselor reaches none of it. Nothing here waits on the clock: every send is awaited through its own promise.

// Phone alerts are live since Step 27 (push.js's PUSH_SERVICE_URL is set), so this file switches them OFF by default
// and each case that wants them says live(true): every case below states the state it is about.
pushConfigured = () => false;
let toasts = [];
let asked = [];
let answer = 'replace';
let sent = [];
let buzzResult = null;
let gate = null;               // a promise a test holds a buzz open with

showToast = (m, o) => { toasts.push({ m: String(m), o: o || null }); };
askDialog = async (o) => { asked.push(o); return answer; };
pushSendAlert = async (o) => {
  sent.push(o);
  if (gate) await gate;
  return buzzResult || { ok: true, sent: 3, queued: 0, failed: 0 };
};

function el(id) { return document.getElementById(id); }
function live(on) { pushConfigured = on ? () => true : () => false; }

function boot(role, opts) {
  opts = opts || {};
  freshState();
  setMemberRole(role === undefined ? 'editor' : role);
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  dataEditPending = false;
  toasts = []; asked = []; answer = 'replace'; sent = []; buzzResult = null; gate = null;
  tell.d = tellFreshDraft(); tell.loaded = true; tell.result = null; tell.sending = 0; tell.returnToDraft = false;
  localStorage.removeItem(TELL_DRAFT_KEY);
  state.announcements = {};
  state.ui.tool = null;
  live(false);
  fbConnected = true;
  authUser = { email: 'jenn@example.com' };
  memberName = 'Jenn';
}
function done() {
  live(false);
  state.announcements = {};
  state.ui.tool = null;
  tell.d = tellFreshDraft();
  tell.result = null;
  localStorage.removeItem(TELL_DRAFT_KEY);
  clearTimeout(pushTimer); pushTimer = null; clearTimeout(pushConfigTimer); pushConfigTimer = null;
  setMemberRole(null);
  authUser = null;
  memberName = null;
}
function type(text) { tell.d.text = text; }
function undoOf(t) { return t && t.o && t.o.action; }
function lastUndo() { return undoOf([...toasts].reverse().find((t) => undoOf(t))); }
function posted() { return Object.values(state.announcements || {}); }


// Counts every innerHTML / textContent write to an element (the stub keeps them as plain properties, so an accessor
// makes each rewrite observable), for the idle-render checks below.
function countAllWrites(ids) {
  const counts = {};
  ids.forEach((id) => {
    const e = document.getElementById(id);
    let html = e.innerHTML || '';
    let text = e.textContent || '';
    counts[id] = 0;
    Object.defineProperty(e, 'innerHTML', { get: () => html, set: (v) => { html = v; counts[id]++; }, configurable: true });
    Object.defineProperty(e, 'textContent', { get: () => text, set: (v) => { text = v; counts[id]++; }, configurable: true });
  });
  return counts;
}

// ── the pure pieces ─────────────────────────────────────────────────

test('the first sentence is the notice title and the rest the line under it; a line break ends the title too', () => {
  assert.deepEqual(tellSplit('Supper moves to 5:30. The kitchen is running late.'), { title: 'Supper moves to 5:30', rest: 'The kitchen is running late.' });
  assert.deepEqual(tellSplit('Come inside now'), { title: 'Come inside now', rest: '' }, 'no sentence end: the whole message is the title');
  assert.deepEqual(tellSplit('Lightning! Everyone inside. Stay away from windows.'), { title: 'Lightning!', rest: 'Everyone inside. Stay away from windows.' }, '! and ? stay');
  assert.deepEqual(tellSplit('Water break\nBring your bottle'), { title: 'Water break', rest: 'Bring your bottle' });
  assert.deepEqual(tellSplit('   '), { title: '', rest: '' });
  assert.deepEqual(tellSplit('It is 2.5 miles. Walk.'), { title: 'It is 2.5 miles', rest: 'Walk.' }, 'a decimal point is not a sentence end');
});

test('a pinned notice is a whole, posted card that survives normalizeNotice unchanged', () => {
  boot();
  const n = tellPinnedNotice('Rain plan. Games move indoors.');
  assert.deepEqual(n, { status: 'posted', eyebrow: '', title: 'Rain plan', sub: 'Games move indoors.', signoff: '', zones: [], steps: [] });
  const saved = state.notice;
  state.notice = tellClone(n);
  assert.equal(tellCanon(normalizeNotice()), tellCanon(n), 'normalizing it changes nothing');
  state.notice = saved;
  assert.ok(tellNoticeHasContent(n) && !tellNoticeHasContent({ status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] }));
  done();
});

test('the Send button says what will happen, for every combination', () => {
  const d = (o) => Object.assign(tellFreshDraft(), { text: 'x', aud: 'everyone' }, o);
  assert.equal(tellSendLabel(d({}), false), 'Send to everyone');
  assert.equal(tellSendLabel(d({ banner: false, pin: true }), false), 'Pin the notice');
  assert.equal(tellSendLabel(d({ pin: true }), false), 'Send + pin the notice');
  assert.equal(tellSendLabel(d({}), true), 'Send + buzz everyone');
  assert.equal(tellSendLabel(d({ aud: 'directors' }), true), 'Send + buzz directors');
  assert.equal(tellSendLabel(d({ banner: false }), true), 'Buzz everyone');
  assert.equal(tellSendLabel(d({ banner: false, pin: true }), true), 'Pin + buzz everyone');
  assert.equal(tellSendLabel(d({ pin: true }), true), 'Send + pin + buzz everyone');
  boot();
  const t1 = state.teams[1];
  assert.equal(tellSendLabel(d({ aud: 'team', team: t1.id }), true), 'Send + buzz ' + (teamShort(t1.id) || t1.name), 'a team by its short name, no "the" before it');
  done();
});

test('a team chip tap repaints the chips, so a keyboard user\'s focus goes back onto the chip that took its place', () => {
  boot();
  openTool('tell', { from: 'more' });
  const id = state.teams[1].id;
  const focused = [];
  const fresh = document.querySelector('#tell-teams .tell-team[data-team="' + id + '"]');
  fresh.focus = () => focused.push(id);
  const chip = { dataset: { team: id } };
  const prev = document.activeElement;
  try {
    document.activeElement = null; // a pointer tap that never focused the chip (Safari)
    tellSetTeam(id, chip);
    assert.deepEqual(focused, []);
    assert.equal(tell.d.team, id);
    document.activeElement = chip; // keyboard / switch
    tellSetTeam(id, chip);
    assert.deepEqual(focused, [id]);
  } finally { document.activeElement = prev; }
  done();
});

test('Send is the dashed well naming what is missing, in the order a director meets it', () => {
  boot();
  assert.equal(tellModel().label, 'Type a message first');
  type('Hello');
  tell.d.banner = false;
  assert.equal(tellModel().label, 'Tick a way to reach people');
  tell.d.banner = true;
  assert.equal(tellModel().ready, true);
  assert.equal(tellModel().label, 'Send to everyone');
  live(true);
  tell.d.buzz = true; tell.d.aud = 'team';
  assert.equal(tellModel().label, 'Pick a team to buzz', 'a team buzz with no team picked');
  tell.d.team = state.teams[0].id;
  assert.equal(tellModel().ready, true);
  tell.sending = 1;
  assert.equal(tellModel().label, 'Sending…');
  assert.equal(tellModel().ready, false, 'never twice at once');
  tell.sending = 0;
  done();
});

test('"ends in 38 min": the time left, in the words a director reads', () => {
  assert.equal(tellLeft(38 * 60000 - 1000), 'ends in 38 min');
  assert.equal(tellLeft(30 * 1000), 'ends in 1 min');
  assert.equal(tellLeft(0), 'ending now');
  assert.equal(tellLeft(2 * 3600000 + 10 * 60000), 'ends in 2 h 10 min');
  assert.equal(tellLeft(3 * 3600000), 'ends in 3 h');
  assert.equal(tellLeft(30 * 3600000), 'ends in 1 day');
});

// ── Buzz: disabled with its reason until phone alerts are live ───────

test('Buzz is disabled with its reason while phone alerts are not live (as before Step 27, or if the sender is ever disconnected), and offline', () => {
  boot();
  assert.equal(tellBuzzState().available, false);
  assert.equal(tellBuzzState().reason, "Phone alerts aren’t switched on yet");
  live(true);
  assert.equal(tellBuzzState().available, true);
  fbConnected = false;
  assert.equal(tellBuzzState().available, false);
  assert.equal(tellBuzzState().reason, 'No signal: buzzing needs a connection');
  fbConnected = true;
  done();
});

test('a tapped Buzz tick with no phone alerts says why and stays off; once live it ticks; going offline DISARMS it', () => {
  boot();
  openTool('tell', { from: 'more' });
  tellToggle('buzz');
  assert.equal(tell.d.buzz, false);
  assert.equal(toasts.pop().m, "Phone alerts aren’t switched on yet");
  live(true);
  tellToggle('buzz');
  assert.equal(tell.d.buzz, true, 'ticked now');
  fbConnected = false;
  tellPaint();
  assert.equal(tell.d.buzz, false, 'the connection dropped: disarmed, not just greyed');
  fbConnected = true;
  tellPaint();
  assert.equal(tell.d.buzz, false, 'and it stays off when the connection comes back: nothing arms by accident');
  done();
});

// ── quick alerts ────────────────────────────────────────────────────

test('a quick alert fills the message and ticks Banner all day + Buzz everyone + Urgent (Send is the next tap)', () => {
  boot();
  live(true);
  openTool('tell', { from: 'more' });
  type('half typed');
  tellQuick('inside');
  const d = tell.d;
  assert.equal(d.text, 'Come inside now');
  assert.equal(d.banner, true);
  assert.equal(d.ttl, 'day');
  assert.equal(d.buzz, true);
  assert.equal(d.aud, 'everyone');
  assert.equal(d.urgent, true, 'a quick alert is an urgent one');
  assert.equal(d.pin, false);
  assert.equal(tellModel().label, 'Send + buzz everyone');
  assert.equal(tellModel().ready, true, 'one more tap');
  done();
});

test('without phone alerts a quick alert is the banner all day and nothing rings (and never carries Urgent)', () => {
  boot();
  openTool('tell', { from: 'more' });
  tellQuick('dining');
  assert.equal(tell.d.text, 'All to the Dining Hall');
  assert.equal(tell.d.ttl, 'day');
  assert.equal(tell.d.buzz, false);
  assert.equal(tell.d.urgent, false);
  assert.equal(tellModel().label, 'Send to everyone');
  tell.d.pin = true;
  tellQuick('stay');
  assert.equal(tell.d.pin, false, 'a quick alert is never a pin');
  tellQuick('nonsense');
  assert.equal(tell.d.text, 'Stay where you are', 'an unknown quick alert changes nothing');
  assert.equal(Object.keys(TELL_QUICK).length, 3);
  assert.deepEqual(Object.values(TELL_QUICK).map((q) => q.text), ['Come inside now', 'All to the Dining Hall', 'Stay where you are']);
  done();
});

test('the quick alerts in index.html carry the same words as the constant the owner can change', () => {
  const html = readFixture('../index.html');
  Object.keys(TELL_QUICK).forEach((k) => {
    const m = new RegExp('data-quick="' + k + '"[^>]*>([^<]+)<').exec(html);
    assert.ok(m, k + ' button exists');
    assert.equal(m[1], TELL_QUICK[k].text, k + ': the button and the message say the same words (so aria-pressed can tell)');
  });
});

// ── channel combinations ────────────────────────────────────────────

test('banner only: one announcement with its duration, the notice untouched, the composer closes, one Undo toast', async () => {
  boot();
  openTool('tell', { from: 'more' });
  const notice0 = tellCanon(state.notice);
  type('Water break at the Snack Shack');
  tell.d.ttl = '3h';
  await tellSend();
  assert.equal(posted().length, 1);
  const a = posted()[0];
  assert.equal(a.text, 'Water break at the Snack Shack');
  assert.equal(a.ttlMs, 3 * 3600000);
  assert.equal(a.by, 'Jenn');
  assert.equal(tellCanon(state.notice), notice0, 'the notice was not touched');
  assert.equal(sent.length, 0, 'and nothing buzzed');
  assert.equal(state.ui.tool, null, 'a send that fully worked closes the composer');
  assert.equal(tell.d.text, '', 'and clears the draft');
  assert.equal(localStorage.getItem(TELL_DRAFT_KEY), null, 'on the device too');
  const t = toasts[toasts.length - 1];
  assert.equal(t.m, 'Banner posted');
  assert.equal(t.o.duration, 10000, 'a 10-second Undo');
  assert.equal(t.o.action.label, 'Undo');
  assert.equal(asked.length, 0, 'no question for a banner');
  assert.ok(liveAnnouncements().some((x) => x.id === a.id));
  done();
});

test('a send while offline says it is only saved on this phone and when it goes out; Undo is still there, and online it is unchanged', async () => {
  boot();
  const realSync = syncEnabled;
  syncEnabled = () => true; // sync is set up; the connection is what is missing
  try {
    openTool('tell', { from: 'more' });
    type('Come inside now');
    fbConnected = false;
    await tellSend();
    assert.equal(posted().length, 1, 'the banner is written (to this phone\'s queue)');
    const t = toasts[toasts.length - 1];
    assert.equal(t.m, 'Banner saved on this phone. It goes out when you’re back online.', 'never plain "posted"');
    assert.equal(t.o.action.label, 'Undo', 'and the 10-second Undo stays');
    // a pin and a banner together, offline: one line each, then the one sentence
    openTool('tell', { from: 'more' });
    state.notice = { status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] };
    type('Rain plan. Games move to the gym.');
    tell.d.pin = true;
    await tellSend();
    assert.equal(toasts[toasts.length - 1].m, 'Banner saved on this phone · Notice saved on this phone. It goes out when you’re back online.');
    // Try again on a banner that failed to post says the same when it lands offline
    tell.result = { items: [{ way: 'banner', ok: false, text: "Banner didn’t post" }], text: 'Water break', plan: { text: 'Water break', banner: { ttlMs: 3600000 }, pin: null, buzz: null } };
    await tellRetry('banner');
    assert.equal(toasts[toasts.length - 1].m, 'Banner saved on this phone. It goes out when you’re back online.');
    // connected: the plain words, as before
    fbConnected = true;
    state.announcements = {};
    openTool('tell', { from: 'more' });
    type('Water break');
    await tellSend();
    assert.equal(toasts[toasts.length - 1].m, 'Banner posted');
    // sync not set up at all (local only): nothing is "going out", so nothing says so
    syncEnabled = () => false;
    fbConnected = false;
    openTool('tell', { from: 'more' });
    type('Local only');
    await tellSend();
    assert.equal(toasts[toasts.length - 1].m, 'Banner posted');
  } finally { syncEnabled = realSync; fbConnected = true; }
  done();
});

test('pin only: the first sentence becomes the title, the rest the intro; the notice is posted whole; no banner', async () => {
  boot();
  state.notice = { status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] }; // an empty notice: no question
  openTool('tell', { from: 'more' });
  type('Rain plan. Games move to the gym after lunch.');
  tell.d.banner = false;
  tell.d.pin = true;
  assert.equal(tellModel().label, 'Pin the notice');
  await tellSend();
  assert.equal(asked.length, 0, 'an empty notice has nothing to lose');
  assert.equal(state.notice.status, 'posted');
  assert.equal(state.notice.title, 'Rain plan');
  assert.equal(state.notice.sub, 'Games move to the gym after lunch.');
  assert.equal(posted().length, 0, 'no banner');
  assert.ok(noticePosted());
  assert.equal(toasts[toasts.length - 1].m, 'Notice pinned');
  done();
});

test('banner + pin + buzz: all three go, the buzz carries the words, the audience and Urgent, and the report is one line each', async () => {
  boot();
  live(true);
  state.notice = { status: 'draft', eyebrow: '', title: '', sub: '', signoff: '', zones: [], steps: [] };
  openTool('tell', { from: 'more' });
  type('Storm warning. Everyone inside.');
  tell.d.pin = true; tell.d.buzz = true; tell.d.urgent = true; tell.d.ttl = 'day';
  assert.equal(tellModel().label, 'Send + pin + buzz everyone');
  await tellSend();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { text: 'Storm warning. Everyone inside.', audience: 'all', urgent: true });
  assert.equal(posted()[0].ttlMs, 24 * 3600000);
  assert.equal(state.notice.title, 'Storm warning');
  assert.equal(toasts[toasts.length - 1].m, 'Banner posted · Notice pinned · Buzz sent to 3 phones');
  assert.equal(state.ui.tool, null);
  done();
});

test('buzz audiences: everyone is "all", directors are "editors", a team is its id; Urgent follows its switch', async () => {
  boot();
  live(true);
  const send = async (patch) => {
    openTool('tell', { from: 'more' });
    type('Heads up');
    Object.assign(tell.d, { banner: false, buzz: true }, patch);
    await tellSend();
  };
  await send({ aud: 'everyone' });
  await send({ aud: 'directors', urgent: true });
  const tid = state.teams[2].id;
  await send({ aud: 'team', team: tid });
  assert.deepEqual(sent.map((s) => [s.audience, s.urgent]), [['all', false], ['editors', true], [tid, false]]);
  assert.equal(posted().length, 0, 'buzz only writes no banner');
  assert.equal(toasts.filter((t) => t.o && t.o.action).length, 0, 'and a buzz alone has nothing to undo');
  done();
});

// ── partial failure ─────────────────────────────────────────────────

test('a buzz that did not go leaves the banner posted, says so per channel, keeps the composer, and Try again re-sends ONLY the buzz', async () => {
  boot();
  live(true);
  openTool('tell', { from: 'more' });
  type('Come inside now');
  tell.d.buzz = true; tell.d.urgent = true;
  buzzResult = { ok: false, error: "Couldn't reach the alert sender — check your connection." };
  await tellSend();
  assert.equal(posted().length, 1, 'the banner is up');
  assert.equal(state.ui.tool, 'tell', 'the composer stays: a send that did not fully work is not closed over');
  const items = tell.result.items;
  assert.deepEqual(items.map((i) => [i.way, i.ok]), [['banner', true], ['buzz', false]]);
  assert.equal(items[0].text, 'Banner posted');
  assert.equal(items[1].text, "Buzz didn’t go: couldn't reach the alert sender — check your connection");
  assert.equal(tell.d.banner, false, 'the banner is un-ticked so a second Send cannot post it twice');
  assert.equal(tell.d.buzz, true, 'the buzz stays ticked for Try again');
  assert.equal(tell.d.text, 'Come inside now', 'and the words stay');
  assert.ok(lastUndo(), 'the banner that did go is still undoable');
  assert.ok(/data-tell-retry="buzz"/.test(tellResultHtml(items)) && !/data-tell-retry="banner"/.test(tellResultHtml(items)), 'Try again only on the failed channel');
  // the box is edited meanwhile: Try again sends the words it was sent with
  type('something else');
  buzzResult = null;
  await tellRetry('buzz');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].text, 'Come inside now', 'the same words, not the edited box');
  assert.equal(posted().length, 1, 'and no second banner');
  assert.equal(tell.result, null, 'everything went: the report clears');
  assert.equal(state.ui.tool, null, 'and the composer closes');
  done();
});

test('a buzz that reached nobody is a warning, not a success: nobody has phone alerts on yet', async () => {
  boot();
  live(true);
  openTool('tell', { from: 'more' });
  type('Hello team');
  tell.d.buzz = true; tell.d.aud = 'team'; tell.d.team = state.teams[1].id;
  buzzResult = { ok: true, sent: 0, queued: 0, failed: 0 };
  await tellSend();
  assert.equal(tell.result.items[1].ok, false);
  assert.ok(/Buzz reached no phones: nobody on .+ has phone alerts on yet/.test(tell.result.items[1].text), tell.result.items[1].text);
  assert.equal(state.ui.tool, 'tell');
  done();
});

test('a sender that is not configured, or a call that throws, is a plain sentence and never an exception', async () => {
  boot();
  live(true);
  openTool('tell', { from: 'more' });
  type('Hello');
  tell.d.buzz = true; tell.d.banner = false;
  buzzResult = { ok: false, error: 'not-configured' };
  await tellSend();
  assert.equal(tell.result.items[0].text, "Buzz didn’t go: phone alerts aren’t switched on yet");
  const real = pushSendAlert;
  pushSendAlert = async () => { throw new Error('boom'); };
  await tellRetry('buzz');
  pushSendAlert = real;
  assert.equal(tell.result.items[0].text, "Buzz didn’t go: it did not go through");
  done();
});

test('Try again after the connection dropped says so instead of sending', async () => {
  boot();
  live(true);
  openTool('tell', { from: 'more' });
  type('Hello');
  tell.d.buzz = true; tell.d.banner = false;
  buzzResult = { ok: false, error: 'nope' };
  await tellSend();
  fbConnected = false;
  await tellRetry('buzz');
  assert.equal(sent.length, 1, 'nothing sent');
  assert.equal(tell.result.items[0].text, "Buzz didn’t go: no signal: buzzing needs a connection");
  fbConnected = true;
  done();
});

// ── the notice replace rule ─────────────────────────────────────────

test('pinning over a notice that says something asks first, naming it and whether it is a draft or posted', async () => {
  boot();
  state.notice = { status: 'posted', eyebrow: '', title: 'Where your team cleans', sub: '', signoff: '', zones: [], steps: [] };
  openTool('tell', { from: 'more' });
  type('Pizza at five.');
  tell.d.banner = false; tell.d.pin = true;
  answer = 'cancel';
  await tellSend();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, 'Replace the notice “Where your team cleans”?');
  assert.ok(/on every phone right now/.test(asked[0].body), 'a posted notice says it is up');
  assert.deepEqual(asked[0].actions.map((a) => [a.label, a.value, a.kind || '', !!a.cancel]), [['Replace it', 'replace', 'gold', false], ['Not now', 'cancel', '', true]]);
  assert.equal(state.notice.title, 'Where your team cleans', 'Not now: nothing was written');
  assert.equal(state.ui.tool, 'tell', 'and the composer is as it was');
  assert.equal(tell.d.text, 'Pizza at five.', 'with the draft');
  // a DRAFT notice is asked about too ("any content, draft or posted")
  state.notice = { status: 'draft', eyebrow: '', title: 'Saturday plan', sub: '', signoff: '', zones: [], steps: [] };
  answer = 'replace';
  await tellSend();
  assert.equal(asked.length, 2);
  assert.ok(/draft nobody else sees/.test(asked[1].body));
  assert.equal(state.notice.title, 'Pizza at five', 'Replace it: pinned');
  done();
});

test('declining the replace question stops the WHOLE send: no banner, no buzz', async () => {
  boot();
  live(true);
  state.notice = { status: 'draft', eyebrow: '', title: 'Saturday plan', sub: '', signoff: '', zones: [], steps: [] };
  openTool('tell', { from: 'more' });
  type('Everyone to the field.');
  tell.d.pin = true; tell.d.buzz = true;
  answer = 'cancel';
  await tellSend();
  assert.equal(posted().length, 0);
  assert.equal(sent.length, 0);
  assert.equal(state.notice.title, 'Saturday plan');
  done();
});

// ── Undo ────────────────────────────────────────────────────────────

test('Undo takes the banner down and puts the previous notice back when it is still what Tell everyone wrote', async () => {
  boot();
  const prev = { status: 'draft', eyebrow: 'Send-off', title: 'Saturday plan', sub: 'Cabins first.', signoff: '', zones: [], steps: [{ emoji: '', when: 'Morning', items: ['Strip beds'] }] };
  state.notice = tellClone(prev);
  openTool('tell', { from: 'more' });
  type('Rain plan. Games move indoors.');
  tell.d.pin = true;
  await tellSend();
  assert.equal(posted().length, 1);
  assert.equal(state.notice.title, 'Rain plan');
  lastUndo().run();
  assert.equal(posted().length, 0, 'the banner is gone');
  assert.equal(tellCanon(state.notice), tellCanon(prev), 'the previous notice is back, steps and all');
  assert.equal(toasts[toasts.length - 1].m, 'Undone');
  done();
});

test("Undo never overwrites a colleague's later edit of the notice, and says so", async () => {
  boot();
  const prev = { status: 'draft', eyebrow: '', title: 'Saturday plan', sub: '', signoff: '', zones: [], steps: [] };
  state.notice = tellClone(prev);
  openTool('tell', { from: 'more' });
  type('Rain plan. Games move indoors.');
  tell.d.pin = true;
  await tellSend();
  state.notice.sub = 'Bring ponchos.'; // another director edits the pinned notice meanwhile
  lastUndo().run();
  assert.equal(state.notice.title, 'Rain plan', 'their notice stands');
  assert.equal(state.notice.sub, 'Bring ponchos.');
  assert.equal(posted().length, 0, 'the banner still comes down');
  assert.ok(/Someone changed the notice since, so it stays as it is\./.test(toasts[toasts.length - 1].m), toasts[toasts.length - 1].m);
  done();
});

test('Undo compares RTDB-canonical forms: a snapshot pruning the empty fields is no "change"', async () => {
  boot();
  state.notice = { status: 'draft', eyebrow: '', title: 'Old', sub: '', signoff: '', zones: [], steps: [] };
  openTool('tell', { from: 'more' });
  type('Rain plan. Games move indoors.');
  tell.d.banner = false; tell.d.pin = true;
  await tellSend();
  state.notice = { status: 'posted', title: 'Rain plan', sub: 'Games move indoors.' }; // what the server hands back: empties pruned
  lastUndo().run();
  assert.equal(state.notice.title, 'Old', 'still recognised as ours, so restored');
  done();
});

test('Undo with the banner already taken down by someone else is quiet, and a counselor phone cannot undo at all', async () => {
  boot();
  openTool('tell', { from: 'more' });
  type('Water break');
  await tellSend();
  const undo = lastUndo();
  delete state.announcements[posted()[0].id];
  undo.run();
  assert.equal(toasts[toasts.length - 1].m, 'Undone');
  openTool('tell', { from: 'more' });
  type('Second');
  await tellSend();
  const undo2 = lastUndo();
  setMemberRole('viewer');
  undo2.run();
  assert.equal(posted().length, 1, 'a demoted phone cannot take it down');
  done();
});

// ── Showing now / Take down ─────────────────────────────────────────

test('Showing now lists every banner still up and the posted notice, a banner dismissed on THIS phone included', () => {
  boot();
  const at = new Date().toISOString();
  state.announcements = {
    a1: { id: 'a1', text: 'Water break', at, ttlMs: 3600000, by: 'Jenn' },
    a2: { id: 'a2', text: 'Old one', at: '2026-08-01T10:00:00Z', ttlMs: 3600000, by: 'X' },
  };
  state.notice = { status: 'posted', eyebrow: '', title: 'Where your team cleans', sub: '', signoff: '', zones: [], steps: [] };
  dismissAnnouncement('a1');
  const rows = tellShowingNow(Date.parse(at) + 20 * 60000); // twenty minutes after it was posted
  assert.deepEqual(rows.map((r) => [r.key, r.kind]), [['ann-a1', 'banner'], ['notice', 'notice']], 'the expired one is not up; the dismissed one is');
  assert.equal(rows[0].sub, 'Banner · ends in 40 min');
  assert.equal(rows[1].sub, 'Big notice · on every phone');
  assert.equal(tellRowSub(rows), 'Up now: a banner and the notice');
  assert.equal(tellRowSub(rows.slice(0, 1)), 'Up now: a banner');
  assert.equal(tellRowSub(rows.slice(1)), 'Up now: the notice');
  assert.equal(tellRowSub([rows[0], Object.assign({}, rows[0], { key: 'ann-b' })]), 'Up now: 2 banners');
  assert.equal(tellRowSub([]), '');
  const html = tellShowingHtml(rows);
  assert.ok(/data-tell-down="banner" data-id="a1"/.test(html) && /data-tell-down="notice"/.test(html));
  state.notice = { status: 'draft', eyebrow: '', title: 'Where your team cleans', sub: '', signoff: '', zones: [], steps: [] };
  assert.deepEqual(tellShowingNow().map((r) => r.kind), ['banner'], 'a draft notice is not showing');
  localStorage.removeItem(ANNOUNCE_DISMISS_KEY);
  done();
});

test('Take down: a banner leaves every phone, the notice goes back to a draft, each with a 10-second Undo that checks first', () => {
  boot();
  const at = new Date().toISOString();
  state.announcements = { a1: { id: 'a1', text: 'Water break', at, ttlMs: 3600000, by: 'Jenn' } };
  state.notice = { status: 'posted', eyebrow: '', title: 'Plan', sub: 'x', signoff: '', zones: [], steps: [] };
  openTool('tell', { from: 'more' });
  tellTakeDown('banner', 'a1');
  assert.equal(posted().length, 0);
  assert.equal(toasts[toasts.length - 1].m, 'Banner taken down');
  assert.equal(toasts[toasts.length - 1].o.duration, 10000);
  lastUndo().run();
  assert.equal(posted().length, 1, 'Undo puts it back');
  tellTakeDown('notice');
  assert.equal(state.notice.status, 'draft', 'the notice is back to a draft (setNoticeStatus)');
  assert.equal(state.notice.title, 'Plan', 'with its content');
  const undo = lastUndo();
  state.notice.sub = 'edited since';
  undo.run();
  assert.equal(state.notice.status, 'draft', 'edited since: Undo leaves it down');
  tellTakeDown('banner', 'nope');
  tellTakeDown('notice');
  assert.equal(state.notice.status, 'draft', 'taking down what is not up does nothing');
  done();
});

test('Undo of a banner take-down does not bring back one that has expired meanwhile', () => {
  boot();
  state.announcements = { a1: { id: 'a1', text: 'Water break', at: new Date(Date.now() - 7200000).toISOString() , ttlMs: 3 * 3600000, by: 'Jenn' } };
  openTool('tell', { from: 'more' });
  tellTakeDown('banner', 'a1');
  state.announcements.a1 = undefined; delete state.announcements.a1;
  const undo = lastUndo();
  const real = Date.now;
  Date.now = () => real() + 4 * 3600000;
  try { undo.run(); } finally { Date.now = real; }
  assert.equal(posted().length, 0, 'expired: stays down');
  done();
});

// ── the draft ───────────────────────────────────────────────────────

test('the draft survives a re-render, a tab trip and a closed-and-reopened composer', () => {
  boot();
  openTool('tell', { from: 'more' });
  type('Bring a towel');
  tell.d.ttl = '3h'; tell.d.pin = true;
  tellChanged();
  renderAll();
  assert.equal(tell.d.text, 'Bring a towel', 'a re-render does not touch it');
  showTab('games');
  assert.equal(state.ui.tool, null, 'a tab trip closes the takeover');
  assert.equal(tell.d.text, 'Bring a towel');
  showTab('more');
  openTool('tell', { from: 'more' });
  assert.equal(tell.d.text, 'Bring a towel', 'reopened: the same draft');
  assert.equal(tell.d.ttl, '3h');
  assert.equal(tell.d.pin, true);
  done();
});

test('the draft is kept on the device, comes back after a reload — without the ticks that cannot be taken back — and is wiped at sign-out', () => {
  boot();
  live(true);
  openTool('tell', { from: 'more' });
  type('Half typed alert');
  tell.d.buzz = true; tell.d.urgent = true; tell.d.aud = 'directors'; tell.d.ttl = 'day'; tell.d.pin = true;
  tellSaveDraft();
  const raw = JSON.parse(localStorage.getItem(TELL_DRAFT_KEY));
  assert.deepEqual(raw, { v: 1, text: 'Half typed alert', banner: true, ttl: 'day', pin: true }, 'the words and the two safe ticks only');
  // a reload: a fresh draft, the saved one read the first time the composer opens
  tell.d = tellFreshDraft(); tell.loaded = false;
  state.ui.tool = null; renderAll();
  openTool('tell', { from: 'more' });
  assert.equal(tell.d.text, 'Half typed alert');
  assert.equal(tell.d.ttl, 'day');
  assert.equal(tell.d.pin, true);
  assert.equal(tell.d.buzz, false, 'Buzz is never restored');
  assert.equal(tell.d.urgent, false);
  clearLocalData();
  assert.equal(localStorage.getItem(TELL_DRAFT_KEY), null, 'sign-out wipes it');
  // junk in storage is ignored, never thrown
  localStorage.setItem(TELL_DRAFT_KEY, '{"v":1,"text":' + JSON.stringify('x'.repeat(500)) + ',"ttl":"forever","banner":"yes","pin":1}');
  tell.d = tellFreshDraft(); tell.loaded = false;
  tellLoadDraft();
  assert.equal(tell.d.text.length, TELL_MAX, 'cut to the limit');
  assert.equal(tell.d.ttl, '1h', 'an unknown duration is ignored');
  assert.equal(tell.d.banner, true);
  assert.equal(tell.d.pin, false);
  localStorage.setItem(TELL_DRAFT_KEY, 'not json');
  tell.d = tellFreshDraft(); tell.loaded = false;
  assert.doesNotThrow(() => tellLoadDraft());
  done();
});

test('typing saves the draft as it goes and clearing the box removes it', () => {
  boot();
  openTool('tell', { from: 'more' });
  tellOnInput({ value: 'Typing…', style: {} });
  assert.equal(tell.d.text, 'Typing…');
  assert.equal(JSON.parse(localStorage.getItem(TELL_DRAFT_KEY)).text, 'Typing…');
  tellOnInput({ value: '', style: {} });
  assert.equal(localStorage.getItem(TELL_DRAFT_KEY), null);
  tellOnInput({ value: 'y'.repeat(400), style: {} });
  assert.equal(tell.d.text.length, 280, 'the message limit');
  done();
});

// ── the auto-update waits ───────────────────────────────────────────

test('reloadBlocked: a message typed in the open composer, a focused box and a send still going out all hold the auto-update', async () => {
  boot();
  assert.equal(reloadBlocked(), false);
  assert.equal(tellComposerBusy(), false);
  openTool('tell', { from: 'more' });
  assert.equal(reloadBlocked(), false, 'open and empty: nothing to lose');
  type('Half typed');
  assert.equal(tellComposerBusy(), true);
  assert.equal(reloadBlocked(), true, 'a half-typed message holds the reload');
  assert.equal(editorMidEntry(), true, 'and a remote snapshot is not adopted over it');
  assert.equal(shellHasUnsentWork(), true, 'and a long absence does not send the director home');
  closeTool();
  assert.equal(reloadBlocked(), false, 'closed: the draft is kept on the device, so it does not hold a reload');
  // a focused empty box
  tell.d.text = '';
  openTool('tell', { from: 'more' });
  document.activeElement = { id: 'tell-text', tagName: 'TEXTAREA' };
  assert.equal(tellComposerBusy(), true, 'focused');
  document.activeElement = null;
  // a send in flight
  live(true);
  type('Come inside now');
  tell.d.buzz = true; tell.d.banner = false;
  let release;
  gate = new Promise((r) => { release = r; });
  const p = tellSend();
  await waitUntil(() => sent.length === 1, 'the buzz to start');
  closeTool();
  assert.equal(tellComposerBusy(), true, 'still sending, composer closed or not');
  assert.equal(reloadBlocked(), true);
  release();
  await p;
  assert.equal(tellComposerBusy(), false, 'all answered');
  assert.equal(reloadBlocked(), false);
  assert.ok(/tellComposerBusy\(\)/.test(readFixture('../app.js').slice(readFixture('../app.js').indexOf('function reloadBlocked()'), readFixture('../app.js').indexOf('function reloadWhenSafe()'))), 'reloadBlocked names it');
  done();
});

test('a second Send while one is going out does nothing (never two banners from a double tap)', async () => {
  boot();
  live(true);
  openTool('tell', { from: 'more' });
  type('Hello');
  tell.d.buzz = true;
  let release;
  gate = new Promise((r) => { release = r; });
  const p = tellSend();
  await waitUntil(() => sent.length === 1, 'the buzz to start');
  await tellSend();
  assert.equal(sent.length, 1);
  assert.equal(posted().length, 1);
  release();
  await p;
  assert.equal(posted().length, 1);
  done();
});

// ── who may use it ──────────────────────────────────────────────────

test('a counselor reaches none of it: no row, no takeover, no send, no take down', async () => {
  boot('viewer');
  assert.equal(toolMayOpen('tell'), false);
  assert.equal(openTool('tell', { from: 'more' }), false);
  state.ui.tool = 'tell';
  renderAll();
  assert.equal(state.ui.tool, null, 'a stored open composer is dropped for a counselor');
  type('Hi');
  await tellSend();
  assert.equal(posted().length, 0);
  state.announcements = { a1: { id: 'a1', text: 'x', at: new Date().toISOString(), ttlMs: 3600000 } };
  tellTakeDown('banner', 'a1');
  assert.equal(posted().length, 1, 'a counselor cannot take a banner down');
  assert.equal(el('tell-row').hidden, true, 'More has no row for them');
  done();
});

test('a director gets the row, and a demoted phone loses the open composer', () => {
  boot();
  renderAll();
  assert.equal(el('tell-row').hidden, false);
  openTool('tell', { from: 'more' });
  assert.equal(state.ui.tool, 'tell');
  setMemberRole('viewer');
  renderAll();
  assert.equal(state.ui.tool, null);
  assert.equal(el('tell-row').hidden, true);
  done();
});

test('More\'s row says what is up now, and the plain line when nothing is', () => {
  boot();
  tellPaintMoreRow();
  assert.equal(el('tell-row-sub').textContent, 'Banner, buzz phones or the big notice');
  state.announcements = { a1: { id: 'a1', text: 'Water break', at: new Date().toISOString(), ttlMs: 3600000, by: 'Jenn' } };
  tellPaintMoreRow();
  assert.equal(el('tell-row-sub').textContent, 'Up now: a banner');
  assert.equal(el('tell-row').dataset.live, 'true');
  state.announcements = {};
  tellPaintMoreRow();
  assert.equal(el('tell-row').dataset.live, undefined);
  done();
});

// ── the shell: one takeover at a time, on the history stack ──────────

test('the composer is a takeover on the shell\'s stack: one entry, one at a time, Back closes it onto the tab it came from', () => {
  boot();
  state.ui.tab = 'more';
  assert.deepEqual(shellSnap().ov, []);
  openTool('tell', { from: 'more' });
  assert.deepEqual(shellSnap().ov, [{ k: 'tell', from: 'more' }]);
  assert.equal(shellTakeoverOpen(), true);
  assert.deepEqual(shellSnapFromRaw({ campShell: 1, tab: 'more', ov: [{ k: 'tell', from: 'more' }] }).ov, [{ k: 'tell', from: 'more' }], 'a history entry may name it');
  assert.deepEqual(shellSnapFromRaw({ campShell: 1, tab: 'more', ov: [{ k: 'tell', from: 'elsewhere' }] }).ov, [{ k: 'tell' }], 'an unknown from is dropped');
  assert.equal(shellToolBackLabel(), 'More');
  const plan = shellHistPlan({ tab: 'more', ov: [] }, shellSnap());
  assert.deepEqual(plan.map((p) => p.op), ['push'], 'opening files ONE history entry');
  shellApply({ tab: 'more', ov: [] }); // the phone's Back
  assert.equal(state.ui.tool, null);
  openTool('tell', { from: 'more' });
  openGame(state.config.games[0].id, { from: 'now' });
  assert.equal(state.ui.tool, null, 'one takeover at a time: a game replaces it');
  openTool('tell', { from: 'more' });
  assert.equal(state.ui.gameId, null, 'and the composer replaces a game');
  assert.equal(shellHasUnsentWork(), false);
  state.ui.tool = 'tell'; openReveal && openReveal({ from: 'more' });
  assert.equal(state.ui.tool, null, 'the reveal remote also replaces it');
  done();
});

test('every id tell.js names exists in index.html, and the script loads after push.js (its Buzz is pushSendAlert)', () => {
  const html = readFixture('../index.html');
  const src = readFixture('../tell.js');
  const ids = [...new Set([...src.matchAll(/tellEl\('([^']+)'\)/g)].map((m) => m[1]))];
  const missing = ids.filter((id) => !html.includes('id="' + id + '"'));
  assert.deepEqual(missing, [], 'ids named in tell.js but absent from index.html');
  assert.ok(html.indexOf('push.js?v=') < html.indexOf('tell.js?v='));
  assert.ok(html.indexOf('tell.js?v=') < html.indexOf('auth-phone.js?v='));
});

test('without tell.js the app runs and More shows no Tell everyone row: every hook is typeof-guarded', () => {
  const { makeContext } = nodeRequire('./harness.js');
  const vm = nodeRequire('vm');
  let boot2;
  assert.doesNotThrow(() => { boot2 = makeContext({ without: ['tell.js'], camp: CAMP.id, seeded: scheduleIsShared() }); }, 'the scripts load without it');
  const get = (expr) => vm.runInContext(expr, boot2.ctx);
  assert.equal(get("typeof renderTellEveryone"), 'undefined');
  assert.equal(get("toolMayOpen('tell')"), false);
  assert.equal(get("openTool('tell')"), false);
  assert.doesNotThrow(() => get('renderAll()'));
  assert.equal(get('reloadBlocked()'), false);
});

test('database strings are escaped everywhere the composer writes markup', () => {
  boot();
  const hostile = '<img src=x onerror=alert(1)>"\'&';
  state.announcements = { a1: { id: 'a1', text: hostile, at: new Date().toISOString(), ttlMs: 3600000, by: '<b>x</b>' } };
  state.notice = { status: 'posted', eyebrow: '', title: hostile, sub: '', signoff: '', zones: [], steps: [] };
  const rows = tellShowingHtml(tellShowingNow());
  assert.notOk(/<img/.test(rows) || /<b>/.test(rows), 'Showing now');
  assert.ok(rows.includes('&lt;img'));
  type(hostile);
  tell.d.pin = true;
  const prev = tellPreviewHtml().replace(/<svg[\s\S]*?<\/svg>/g, '');
  assert.notOk(/<img/.test(prev), 'the preview');
  assert.notOk(/<img/.test(tellResultHtml([{ way: 'buzz', ok: false, text: hostile }])), 'the report');
  done();
});

test('the preview draws the notice card then the banner, written by the same functions the real strip uses', () => {
  boot();
  assert.equal(tellPreviewHtml(), '', 'nothing to show for an empty message');
  type('Rain plan. Games move indoors.');
  assert.equal(tellPreviewHtml(), messageHtml({ id: 'preview', text: 'Rain plan. Games move indoors.', at: new Date().toISOString(), by: 'Jenn' }, { preview: true }).replace(/> ?\d+:\d\d [AP]M/, ''), 'banner only: exactly messageHtml in preview mode');
  tell.d.pin = true;
  const both = tellPreviewHtml();
  assert.ok(both.indexOf('class="msg nn"') > -1 && both.indexOf('class="msg nn"') < both.indexOf('class="msg" data-kind="banner"'), 'the notice strip first, then the banner (Now\'s order)');
  assert.ok(!both.includes('nb-preview') && !both.includes('class="nb"'), 'Now shows the strip; See all is the builder\'s preview');
  assert.ok(both.includes('Rain plan') && both.includes('Games move indoors.'));
  tell.d.banner = false;
  assert.notOk(tellPreviewHtml().includes('class="msg"'), 'pin only: no banner');
  tell.d.pin = false;
  assert.equal(tellPreviewHtml(), '', 'neither way ticked: nothing to preview');
  done();
});

test('an idle re-render of the open composer writes nothing (render stability): every list and line is written only when it changes', () => {
  boot();
  state.announcements = { a1: { id: 'a1', text: 'Water break', at: new Date().toISOString(), ttlMs: 3600000, by: 'Jenn' } };
  openTool('tell', { from: 'more' });
  type('Rain plan. Games move indoors.');
  tell.d.pin = true;
  tellPaint();
  const ids = ['tell-showing-list', 'tell-preview-body', 'tell-result-list', 'tell-teams', 'tell-send-label', 'tell-count', 'tell-buzz-sub', 'tell-quick-what',
    'tell-pin-title', 'tell-pin-rest', 'tell-pin-replace-text', 'tell-urgent-state', 'takeover-tell-back-label', 'tell-row-sub'];
  const writes = countAllWrites(ids);
  renderAll();
  renderAll();
  tellTick();
  assert.deepEqual(Object.entries(writes).filter(([, n]) => n), [], 'nothing rewritten by an idle render');
  type('Rain plan. Games move indoors tonight.');
  renderAll();
  assert.ok(writes['tell-preview-body'] > 0 && writes['tell-count'] > 0, 'but a change is written');
  done();
});
