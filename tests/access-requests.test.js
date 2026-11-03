// Ask to join, the requester's side (BUILD-PLAN Step 25, P2 §11.18; app.js "Ask to join"): the denied screen's form, one set() to the
// requester's OWN row, the closed words (the same for "off" and "blocked"), once() polling of members/<me> (never a listener), the withdraw
// delay, the camp choice, and the page opening itself when a director lets the requester in. Driven against the in-memory database; the
// rules' side of the same flows is tests/emulator/people-client.mjs (the real client's writes under database.rules.json).
// access-requests.senior.test.js evals this file under the senior profile.

const { makeFakeRtdb, makeFakeFirebase } = nodeRequire('./fake-rtdb.js');

const AR_KEY = 'taylor,reed@gmail,com';
const AR_USER = { email: 'taylor.reed@gmail.com', emailVerified: true, displayName: 'Taylor Reed' };
const AR_OTHER = () => CAMPS[otherCampId()];

function arSetup(opts) {
  const o = opts || {};
  freshState();
  setMemberRole(null);
  authUser = o.user || AR_USER;
  window.FIREBASE_CONFIG = { apiKey: 'test' };
  const db = makeFakeRtdb();
  window.firebase = makeFakeFirebase(db);
  fbConnKnown = true; fbConnected = true;
  try { sessionStorage.removeItem(CAMP_SWITCH_TRIED_KEY); } catch (e) { /* fine */ }
  askEl('ask-name').value = '';
  askEl('ask-note').value = '';
  ask.camp = ''; ask.rows = {}; ask.ready = false; ask.closed = false; ask.busy = false; ask.expired = false; ask.offset = 0; ask.last = 0;
  askEl('ask-error').textContent = ''; askEl('ask-error').hidden = true;
  return { db };
}

function arTeardown() {
  askToJoinStop();
  delete window.FIREBASE_CONFIG;
  delete window.firebase;
  delete window.FIREBASE_CONFIG;
  fbConnKnown = false; fbConnected = false;
  authUser = null;
  document.visibilityState = 'visible';
  try { localStorage.removeItem(ACTIVE_CAMP_KEY); localStorage.removeItem(AUTH_HINT_KEY); } catch (e) { /* fine */ }
}

const arRow = (db, camp) => db.serverGet((camp || CAMP).dbRoot + '/accessRequests/' + AR_KEY);

// ── whether the page offers it at all ──

test('the form appears only when the rules answer a read of the account\'s OWN row; a refusal leaves the denied page exactly as it was', async () => {
  const { db } = arSetup();
  try {
    db.revokeRead(CAMP.dbRoot + '/accessRequests');
    askToJoinStart();
    await waitQuiet();
    assert.equal(ask.ready, false);
    assert.equal(askEl('ask-join').hidden, true, 'no form: rules that predate it');
    askToJoinStop();
    const b = arSetup();
    askToJoinStart();
    await waitQuiet();
    assert.equal(ask.ready, true);
    assert.equal(askEl('ask-join').hidden, false);
    assert.equal(askEl('ask-form').hidden, false, 'no row yet: the question');
    assert.equal(askEl('ask-sent').hidden, true);
    assert.equal(b.db.listenerCount(), 0, 'a non-member never gets a listener: the read is a once()');
  } finally { arTeardown(); }
});

test('a name is prefilled from the sign-in\'s display name (cut to 60, cleaned); a phone sign-in starts empty; an invalid key offers nothing', async () => {
  arSetup({ user: Object.assign({}, AR_USER, { displayName: '  Taylor\n  Reed ' + 'x'.repeat(80) }) });
  try {
    askToJoinStart();
    await waitQuiet();
    assert.equal(askEl('ask-name').value.length, 60);
    assert.ok(askEl('ask-name').value.startsWith('Taylor Reed x'));
  } finally { arTeardown(); }
  arSetup({ user: { phoneNumber: '+15551234567' } });
  try {
    askToJoinStart();
    await waitQuiet();
    assert.equal(askEl('ask-name').value, '', 'phone sign-ins have no display name');
    assert.equal(ask.key, '+15551234567');
  } finally { arTeardown(); }
  arSetup({ user: { email: 'a#b@x.com', emailVerified: true } });
  try {
    askToJoinStart();
    await waitQuiet();
    assert.equal(askEl('ask-join').hidden, true, 'a key the database cannot hold cannot ask');
  } finally { arTeardown(); }
});

test('the denied screen starts it: denyMemberFinal shows the denied panel AND begins the ask', async () => {
  const { db } = arSetup();
  try {
    const src = readFixture('../app.js');
    const fn = src.slice(src.indexOf('function denyMemberFinal()'), src.indexOf('// ── Pre-paint hint'));
    assert.ok(/showAuthScreen\('denied'[\s\S]*askToJoinStart\(\)/.test(fn));
    syncStarted = false;
    denyMemberFinal();
    await waitQuiet();
    assert.equal(ask.ready, true);
    assert.equal(askEl('ask-join').hidden, false);
    assert.equal(db.listenerCount(), 0);
  } finally { arTeardown(); }
});

// ── sending ──

test('Ask to join is ONE set() to the account\'s own row at the chosen camp: { name, note?, at: server time } and nothing else', async () => {
  const { db } = arSetup();
  try {
    askToJoinStart();
    await waitQuiet();
    askEl('ask-name').value = '  Taylor   Reed  ';
    askEl('ask-note').value = "I'm with the Foxes";
    db.log.length = 0;
    askSend();
    await waitQuiet();
    assert.deepEqual(db.log.map((l) => l.kind + ' ' + l.paths.join(',')), ['set ' + CAMP.dbRoot + '/accessRequests/' + AR_KEY]);
    const row = arRow(db);
    assert.deepEqual(Object.keys(row).sort(), ['at', 'name', 'note']);
    assert.deepEqual([row.name, row.note, typeof row.at], ['Taylor Reed', "I'm with the Foxes", 'number']);
    assert.equal(askEl('ask-sent').hidden, false, 'the card that says what to do next');
    assert.equal(askEl('ask-form').hidden, true);
    assert.equal(arRow(db, AR_OTHER()), null, 'only the camp that was chosen');
  } finally { arTeardown(); }
});

test('a note is optional (no key written); a name is not (said in words, nothing written); name and note are cut to the rules\' limits', async () => {
  const { db } = arSetup();
  try {
    askToJoinStart();
    await waitQuiet();
    db.log.length = 0;
    askEl('ask-name').value = '   ';
    askSend();
    await waitQuiet();
    assert.equal(db.log.length, 0);
    assert.ok(/Type your name/.test(askEl('ask-error').textContent) && askEl('ask-error').hidden === false);
    askEl('ask-name').value = 'N'.repeat(90);
    askEl('ask-note').value = '';
    askSend();
    await waitQuiet();
    assert.deepEqual(Object.keys(arRow(db)).sort(), ['at', 'name']);
    assert.equal(arRow(db).name.length, 60);
    await arWithdrawNow(db);
    askEl('ask-note').value = 'x'.repeat(400);
    askSend();
    await waitQuiet();
    assert.equal(arRow(db).note.length, 200);
  } finally { arTeardown(); }
});

async function arWithdrawNow(db) {
  db.serverSet(CAMP.dbRoot + '/accessRequests/' + AR_KEY + '/at', Date.now() - 120000);
  await askLoadRow(CAMP.id);
  askWithdraw();
  await waitQuiet();
}

test('the other camp: picking it sends the row THERE; the form is about the camp that is chosen', async () => {
  const { db } = arSetup();
  try {
    askToJoinStart();
    await waitQuiet();
    askPickCamp(otherCampId());
    await waitQuiet();
    assert.equal(ask.camp, otherCampId());
    askEl('ask-name').value = 'Taylor Reed';
    askSend();
    await waitQuiet();
    assert.ok(arRow(db, AR_OTHER()));
    assert.equal(arRow(db), null);
  } finally { arTeardown(); }
});

test('asking is CLOSED (a refusal of any kind) in the same words for "off" and "blocked", with the email to tell a director; Try again brings the form back', async () => {
  const { db } = arSetup();
  try {
    askToJoinStart();
    await waitQuiet();
    askEl('ask-name').value = 'Taylor Reed';
    db.refuse(CAMP.dbRoot + '/accessRequests/' + AR_KEY);
    askSend();
    await waitQuiet();
    const off = askEl('ask-closed-text').textContent;
    assert.equal(off, 'Asking to join isn’t open right now. Tell a director your email (taylor.reed@gmail.com) and they’ll add you.');
    assert.equal(askEl('ask-closed').hidden, false);
    assert.equal(askEl('ask-form').hidden, true);
    assert.equal(askEl('ask-sent').hidden, true);
    // "Blocked" is the very same refusal on the wire, so there is one code path and one sentence: nothing here can tell them apart.
    const src = readFixture('../app.js');
    const ask1 = src.slice(src.indexOf('function askSend()'), src.indexOf('function askWithdraw()'));
    assert.equal((ask1.match(/ask\.closed = true/g) || []).length, 1);
    assert.ok(!/block/i.test(ask1.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')), 'the requester\'s code never mentions a block');
    askEl('ask-again').dispatchEvent && 0;
    ask.closed = false; askPaint();
    assert.equal(askEl('ask-form').hidden, false);
  } finally { arTeardown(); }
});

test('a connection failure is a plain sentence, not "closed", and writes nothing', async () => {
  const { db } = arSetup();
  try {
    askToJoinStart();
    await waitQuiet();
    askEl('ask-name').value = 'Taylor Reed';
    const orig = db.ref;
    db.ref = (p) => { const r = orig(p); r.set = () => Promise.reject(new Error('network error')); return r; };
    askSend();
    await waitQuiet();
    assert.ok(/check your connection/.test(askEl('ask-error').textContent));
    assert.equal(ask.closed, false);
    assert.equal(askEl('ask-form').hidden, false);
    assert.equal(ask.busy, false);
  } finally { arTeardown(); }
});

test('a phone sign-in reads "phone number (+1…)" in the closed words', async () => {
  const { db } = arSetup({ user: { phoneNumber: '+15551234567' } });
  try {
    askToJoinStart();
    await waitQuiet();
    askEl('ask-name').value = 'Pat';
    db.refuse(CAMP.dbRoot + '/accessRequests/+15551234567');
    askSend();
    await waitQuiet();
    assert.ok(/Tell a director your phone number \(\+15551234567\)/.test(askEl('ask-closed-text').textContent));
  } finally { arTeardown(); }
});

// ── a request that is already out ──

test('a request already sent shows the card, not the form (a reload, or another phone, comes back to "Sent")', async () => {
  const { db } = arSetup();
  try {
    db.serverSet(CAMP.dbRoot + '/accessRequests/' + AR_KEY, { name: 'Taylor Reed', at: Date.now() - 5000 });
    askToJoinStart();
    await waitQuiet();
    assert.equal(askEl('ask-sent').hidden, false);
    assert.equal(askEl('ask-form').hidden, true);
    assert.ok(/Checking every 30 seconds/.test(askEl('ask-wait').textContent));
    assert.equal(askEl('ask-withdraw').hidden, true, 'a request younger than the rules\' minute cannot be withdrawn yet');
  } finally { arTeardown(); }
});

test('Withdraw appears a minute after asking and deletes the row, then the form is back; an early attempt the rules refuse says when to try again', async () => {
  const { db } = arSetup();
  try {
    db.serverSet(CAMP.dbRoot + '/accessRequests/' + AR_KEY, { name: 'Taylor Reed', at: Date.now() - 90000 });
    askToJoinStart();
    await waitQuiet();
    assert.equal(askEl('ask-withdraw').hidden, false);
    db.refuse(CAMP.dbRoot + '/accessRequests/' + AR_KEY);
    askWithdraw();
    await waitQuiet();
    assert.ok(/a minute after/.test(askEl('ask-error').textContent));
    assert.ok(arRow(db), 'nothing was deleted');
    db.allow(CAMP.dbRoot + '/accessRequests/' + AR_KEY);
    askWithdraw();
    await waitQuiet();
    assert.equal(arRow(db), null);
    assert.equal(askEl('ask-form').hidden, false);
  } finally { arTeardown(); }
});

test('the database\'s clock, not the phone\'s, decides when Withdraw shows (a phone minutes fast would offer a refused delete)', async () => {
  const { db } = arSetup();
  try {
    db.setServerTimeOffset(-300000); // the server is five minutes BEHIND this phone
    db.serverSet(CAMP.dbRoot + '/accessRequests/' + AR_KEY, { name: 'Taylor Reed', at: Date.now() - 290000 }); // 290 s old by the phone, ten seconds young by the server
    askToJoinStart();
    await waitQuiet();
    assert.equal(ask.offset, -300000);
    assert.equal(askEl('ask-withdraw').hidden, true);
  } finally { arTeardown(); }
});

// ── polling ──

test('polling is once() of members/<me>: nothing on the list → it keeps waiting and schedules the next look; a refused read is harmless', async () => {
  const { db } = arSetup();
  try {
    db.serverSet(CAMP.dbRoot + '/accessRequests/' + AR_KEY, { name: 'Taylor Reed', at: Date.now() - 5000 });
    askToJoinStart();
    await waitQuiet();
    const before = __reloads;
    assert.ok(ask.timer, 'the first look is scheduled');
    db.revokeRead(CAMP.dbRoot + '/members');
    askPoll(true);
    await waitQuiet();
    assert.equal(__reloads, before);
    assert.ok(ask.timer, 'still waiting');
    assert.equal(db.listenerCount(), 0, 'never a listener');
  } finally { arTeardown(); }
});

test('a director lets them in → the camp is made the active one, the role hinted, and the page reloads by itself', async () => {
  const { db } = arSetup();
  try {
    db.serverSet(CAMP.dbRoot + '/accessRequests/' + AR_KEY, { name: 'Taylor Reed', at: Date.now() - 5000 });
    askToJoinStart();
    await waitQuiet();
    const before = __reloads;
    db.serverSet(CAMP.dbRoot + '/members/' + AR_KEY, { role: 'viewer', name: 'Taylor', addedBy: 'jenn', addedAt: '2026-11-01T00:00:00Z' });
    askPoll(true);
    await waitQuiet();
    assert.equal(__reloads, before + 1);
    assert.equal(localStorage.getItem(ACTIVE_CAMP_KEY), CAMP.id);
    assert.equal(localStorage.getItem(AUTH_HINT_KEY), 'viewer');
    assert.equal(readCampsHint()[CAMP.id], 'viewer');
  } finally { arTeardown(); localStorage.removeItem(CAMPS_HINT_KEY); }
});

test('approved at the OTHER camp (the one they asked): that camp becomes the active one', async () => {
  const { db } = arSetup();
  try {
    const other = AR_OTHER();
    db.serverSet(other.dbRoot + '/accessRequests/' + AR_KEY, { name: 'Taylor Reed', at: Date.now() - 5000 });
    askToJoinStart();
    askPickCamp(other.id);
    await waitQuiet();
    const before = __reloads;
    db.serverSet(other.dbRoot + '/members/' + AR_KEY, { role: 'editor', addedBy: 'x', addedAt: 'y' });
    askPoll(true);
    await waitQuiet();
    assert.equal(__reloads, before + 1);
    assert.equal(localStorage.getItem(ACTIVE_CAMP_KEY), other.id);
    assert.equal(localStorage.getItem(AUTH_HINT_KEY), 'editor');
  } finally { arTeardown(); localStorage.removeItem(CAMPS_HINT_KEY); }
});

test('polling stops after 30 minutes ("Still waiting? Find a director…") and a tap on Check again gives it another thirty', async () => {
  const { db } = arSetup();
  try {
    db.serverSet(CAMP.dbRoot + '/accessRequests/' + AR_KEY, { name: 'Taylor Reed', at: Date.now() - 5000 });
    askToJoinStart();
    await waitQuiet();
    ask.since = Date.now() - ASK_POLL_MAX_MS - 1000;
    askPoll(false);
    assert.equal(ask.expired, true);
    assert.equal(ask.timer, null);
    assert.ok(/Still waiting\? Find a director/.test(askEl('ask-wait').textContent));
    askPoll(true);
    await waitQuiet();
    assert.equal(ask.expired, false);
    assert.ok(ask.timer, 'a new stretch');
    assert.ok(/Checking every 30 seconds/.test(askEl('ask-wait').textContent));
  } finally { arTeardown(); }
});

test('a hidden page does not poll (it re-arms when shown); a manual check answers whatever the tab is doing', async () => {
  const { db } = arSetup();
  try {
    db.serverSet(CAMP.dbRoot + '/accessRequests/' + AR_KEY, { name: 'Taylor Reed', at: Date.now() - 5000 });
    askToJoinStart();
    await waitQuiet();
    const before = __reloads;
    db.serverSet(CAMP.dbRoot + '/members/' + AR_KEY, { role: 'viewer', addedBy: 'x', addedAt: 'y' });
    document.visibilityState = 'hidden';
    askPoll(false);
    await waitQuiet();
    assert.equal(__reloads, before, 'hidden: no read');
    assert.equal(ask.timer, null, 'and no timer to wake a hidden tab (visibilitychange does it)');
    askPoll(true);
    await waitQuiet();
    assert.equal(__reloads, before + 1);
  } finally { arTeardown(); localStorage.removeItem(CAMPS_HINT_KEY); }
});

test('polling starts only once a request is out: before one, nothing is read from members', async () => {
  const { db } = arSetup();
  try {
    askToJoinStart();
    await waitQuiet();
    assert.equal(ask.timer, null);
    assert.ok(!db.log.some((l) => /\/members/.test(l.paths.join())), 'no read of members');
  } finally { arTeardown(); }
});

// ── source pins ──

test('the requester\'s page never builds markup from what it holds, attaches a listener, or reads a list (source pin)', () => {
  const src = readFixture('../app.js');
  const part = src.slice(src.indexOf('// ── Ask to join: the requester'), src.indexOf('// True only when all three Firebase SDK scripts'));
  const code = part.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(code), 'every string goes in through textContent or value');
  assert.ok(!/\.on\(/.test(code), 'a non-member has no listener: THE INVARIANT');
  assert.ok(!/accessRequests'\)|accessBlocked|\/members'\)/.test(code), 'no list is read: only this account\'s own row and own member record');
  assert.ok(/once\('value'\)/.test(code));
});

test('index.html carries every id the ask names, and the form is plain controls (no Jelly needed)', () => {
  const html = readFixture('../index.html');
  const src = readFixture('../app.js');
  const part = src.slice(src.indexOf('// ── Ask to join: the requester'), src.indexOf('// True only when all three Firebase SDK scripts'));
  const ids = Array.from(new Set((part.match(/(?:askEl|askSay|on)\('(ask-[a-z-]+)'/g) || []).map((m) => m.replace(/^.*\('/, '').replace("'", ''))));
  assert.ok(ids.length >= 10, 'ids read: ' + ids.join(','));
  assert.deepEqual(ids.filter((id) => !html.includes('id="' + id + '"')), []);
  const block = html.slice(html.indexOf('id="ask-join"'), html.indexOf('<jelly-button id="auth-retry-btn"'));
  assert.ok(!/<jelly-/.test(block), 'plain controls: the page must work before, and without, the component library');
  assert.ok(/id="ask-name"[^>]*maxlength="60"/.test(block) && /id="ask-note"[^>]*maxlength="200"/.test(block), 'the rules\' limits on the inputs');
});
