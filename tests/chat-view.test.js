// Chat view regressions from the 2026-10-27 glitch sweep (v183, Playwright at
// 320-430px). Everything that can be checked without layout is pinned here: the
// "sync is off" vs "loading" distinction, drafts, the in-place shell update that
// keeps the composer/pill alive, own-send + photo pinning, the lightbox race and,
// since chat became the Chat tab, that the view survives tab switches (the
// shell owns Back and scroll: tests/tabs.test.js). The pure-CSS fixes (tab strip not
// squashed, badge on the corner, toast rail clear of the composer) need real
// layout and were verified in Chromium — see the commit message.

const flush = () => new Promise((r) => setTimeout(r, 0));

function chatStubs() {
  return {
    view: document.getElementById('chat-view'),
    list: document.getElementById('chat-list'),
    input: document.getElementById('chat-input'),
  };
}

// ── cold start: "Loading…" until sync is DEFINITIVELY off ──

test('"sync is off" is only said when sync really is off, not while it is still starting', () => {
  const saved = { cfg: window.FIREBASE_CONFIG, fbRef, sdkLoadFailed, syncDenied };
  try {
    window.FIREBASE_CONFIG = { apiKey: 'k' };
    fbRef = null; sdkLoadFailed = false; syncDenied = false;
    chatDenied = false; chatReady = {};
    assert.notOk(chatSyncOff(), 'cold start, sync not started yet');
    assert.ok(chatListHTML('general').includes('skeleton'), 'an open view shows the skeleton, not the sentence');
    sdkLoadFailed = true;
    assert.ok(chatSyncOff(), 'SDK never loaded → really off');
    assert.ok(chatListHTML('general').includes('live sync'));
    sdkLoadFailed = false; syncDenied = true;
    assert.ok(chatSyncOff(), 'rules cancelled a listener → really off');
    syncDenied = false;
    window.FIREBASE_CONFIG = null;
    assert.ok(chatSyncOff(), 'no Firebase config on this device → local only, really off');
    window.FIREBASE_CONFIG = { apiKey: 'k' };
    fbRef = {};
    assert.notOk(chatSyncOff(), 'sync is up');
  } finally {
    window.FIREBASE_CONFIG = saved.cfg;
    fbRef = saved.fbRef; sdkLoadFailed = saved.sdkLoadFailed; syncDenied = saved.syncDenied;
    chatReady = {};
  }
});

test('the SDK failing refreshes a built chat (the built view is not re-rendered by renderAll)', () => {
  const saved = { cfg: window.FIREBASE_CONFIG, fbRef, sdkLoadFailed, built: chatViewBuiltFor };
  const calls = [];
  const realStatus = globalThis.renderChatStatus, realView = globalThis.renderChatView;
  try {
    window.FIREBASE_CONFIG = { apiKey: 'k' };
    fbRef = null; sdkLoadFailed = true;
    chatViewBuiltFor = 'general';
    globalThis.renderChatStatus = () => calls.push('status');
    globalThis.renderChatView = (force) => calls.push('view:' + !!force);
    onChatSyncStateChanged();
    assert.deepEqual(calls, ['status', 'view:true']);
    calls.length = 0;
    chatViewBuiltFor = null; // the Chat tab was never opened: there is no view to refresh
    onChatSyncStateChanged();
    assert.deepEqual(calls, ['status']);
  } finally {
    globalThis.renderChatStatus = realStatus; globalThis.renderChatView = realView;
    chatViewBuiltFor = saved.built;
    window.FIREBASE_CONFIG = saved.cfg; fbRef = saved.fbRef; sdkLoadFailed = saved.sdkLoadFailed;
  }
});

test('attaching chat sync swaps a stale "sync is off" view for the loading state at once', () => {
  const savedFb = globalThis.firebase, savedStarted = chatSyncStarted, savedBuilt = chatViewBuiltFor;
  const calls = [];
  const realStatus = globalThis.renderChatStatus, realView = globalThis.renderChatView;
  const ref = { limitToLast: () => ref, on: () => {}, once: () => new Promise(() => {}) };
  try {
    globalThis.firebase = { database: () => ({ ref: () => ref }) };
    globalThis.renderChatStatus = () => calls.push('status');
    globalThis.renderChatView = (force) => calls.push('view:' + !!force);
    chatSyncStarted = false;
    chatViewBuiltFor = 'general';
    initChatSync();
    assert.deepEqual(calls, ['status', 'view:true'], 'refreshed once, after the listeners are attached');
    calls.length = 0;
    initChatSync(); // idempotent: a second call attaches nothing and repaints nothing
    assert.deepEqual(calls, []);
    chatSyncStarted = false;
    chatViewBuiltFor = null;
    initChatSync();
    assert.deepEqual(calls, ['status'], 'a chat tab never opened only needs its badge refreshed');
  } finally {
    globalThis.firebase = savedFb; chatSyncStarted = savedStarted; chatViewBuiltFor = savedBuilt;
    globalThis.renderChatStatus = realStatus; globalThis.renderChatView = realView;
  }
});

// ── banner by-line never flashes the sender's raw email ──

test('a chat announcement banner has no by-line until the member directory loads', () => {
  const saved = { dir: memberDirectory, loaded: memberDirectoryLoaded };
  try {
    chatMsgs.announcements = [normalizeChatMsg('b1', { at: serverNow() - 60000, byKey: 'sam@camp,test', name: 'Sam', text: 'Lunch moved' })];
    memberDirectory = null; memberDirectoryLoaded = false;
    assert.equal(chatAnnouncementBanners()[0].by, '', 'not the fail-closed raw email');
    memberDirectory = { 'sam@camp,test': { role: 'editor', name: 'Sam Director' } }; memberDirectoryLoaded = true;
    assert.equal(chatAnnouncementBanners()[0].by, 'Sam Director');
  } finally {
    memberDirectory = saved.dir; memberDirectoryLoaded = saved.loaded;
    chatMsgs.announcements = [];
  }
});

// ── own message + photo pinning ──

test("a message I just sent scrolls into view even from higher up; someone else's does not yank me", () => {
  const { list } = chatStubs();
  chatViewBuiltFor = 'general';
  chatMsgs.general = [];
  Object.assign(list, { scrollHeight: 3000, scrollTop: 500, clientHeight: 600 });
  try {
    appendChatBubble('general', normalizeChatMsg('theirs', { at: serverNow(), byKey: 'kim@camp,test', name: 'Kim', text: 'hi' }));
    assert.equal(list.scrollTop, 500, "a reader scrolled up stays put when someone else posts");
    chatOwnSendIds.add('mine');
    appendChatBubble('general', normalizeChatMsg('mine', { at: serverNow(), byKey: 'me@camp,test', name: 'Me', text: 'reply' }));
    assert.equal(list.scrollTop, 3000, 'my own send is brought into view');
    list.scrollTop = 500;
    appendChatBubble('general', normalizeChatMsg('other-device', { at: serverNow(), byKey: 'me@camp,test', name: 'Me', text: 'from my phone' }));
    assert.equal(list.scrollTop, 500, 'the same account on another device is not an own-send here');
  } finally {
    chatOwnSendIds.clear(); chatViewBuiltFor = null; chatMsgs.general = [];
  }
});

test('own-send ids are released once the send settles, and a refusal parks the words as that channel\'s draft', async () => {
  const savedFb = globalThis.firebase, savedTimeout = globalThis.setTimeout, savedUser = authUser;
  const realTimeout = savedTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0); // the 1.2 s send spacing isn't under test
  let reject = true;
  globalThis.firebase = {
    database: Object.assign(() => ({ ref: () => ({ push: () => ({ key: '-Mnew' + Math.random().toString(36).slice(2, 7) }), update: () => (reject ? Promise.reject(new Error('refused')) : Promise.resolve()) }) }), { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } }),
  };
  try {
    authUser = { email: 'me@camp.test', emailVerified: true };
    chatLastSendAt = 0; chatLastAckAt = 0; chatSendTail = Promise.resolve();
    const { input } = chatStubs();
    state.ui.chatChannel = 'memes'; // they've already moved on from #general
    input.value = '';
    chatDrafts = {};
    document.getElementById('chat-input').value = 'typed in general';
    sendChatMessage('general');
    assert.equal(input.value, '', 'the composer clears on send');
    assert.equal(chatOwnSendIds.size, 1, 'tracked while in flight');
    await new Promise((r) => realTimeout(r, 60));
    assert.equal(chatOwnSendIds.size, 0, 'released after the refusal');
    assert.equal(chatDrafts.general, 'typed in general', 'the words wait in the channel they were typed for');
    // and a good send leaves no draft or id behind
    reject = false;
    chatLastSendAt = 0; chatSendTail = Promise.resolve();
    document.getElementById('chat-input').value = 'all good';
    sendChatMessage('memes');
    await new Promise((r) => realTimeout(r, 60));
    assert.equal(chatOwnSendIds.size, 0);
    assert.notOk(chatDrafts.memes, 'a sent message is not a draft');
  } finally {
    globalThis.setTimeout = savedTimeout; globalThis.firebase = savedFb; authUser = savedUser;
    chatDrafts = {}; chatSendTail = Promise.resolve(); chatOwnSendIds.clear();
    state.ui.chatChannel = 'general';
  }
});

test('a thumbnail that decodes late re-pins the list to the bottom, unless the reader has scrolled', () => {
  const { list } = chatStubs();
  const handlers = {};
  const img = { complete: false, listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; } };
  const realQSA = list.querySelectorAll, realAdd = list.addEventListener;
  list.querySelectorAll = (sel) => (sel === '.chat-thumb' ? [img] : []);
  list.addEventListener = (ev, fn) => { handlers[ev] = fn; };
  list.__chatPinWired = false;
  try {
    Object.assign(list, { scrollHeight: 500, scrollTop: 0, clientHeight: 400 });
    chatScrollToBottom();
    assert.equal(list.scrollTop, 500);
    list.scrollHeight = 2400; // the thumbnail decoded and pushed the content down
    img.listeners.load();
    assert.equal(list.scrollTop, 2400, 'still pinned → follows the image growth');
    // a reader who touches the list is never fought
    list.scrollHeight = 500; chatScrollToBottom();
    handlers.wheel();
    list.scrollTop = 120; list.scrollHeight = 2400;
    img.listeners.load();
    assert.equal(list.scrollTop, 120, 'reading up during a slow load is not snapped back down');
    // an already-decoded image gets no listener at all
    img.complete = true; img.listeners = {};
    chatScrollToBottom();
    assert.equal(Object.keys(img.listeners).length, 0);
  } finally {
    list.querySelectorAll = realQSA; list.addEventListener = realAdd;
  }
});

// ── the shell is built once per open and then updated IN PLACE ──

test('a forced render of a built view updates it in place (composer, pill and strip are kept)', () => {
  const { view, input, list } = chatStubs();
  setMemberRole('viewer');
  state.ui.chatChannel = 'general';
  chatViewBuiltFor = 'general';
  view.dataset.chatShell = chatShellSig();
  view.innerHTML = 'SHELL-NODES';
  list.innerHTML = '';
  input.value = 'half-typed in general';
  chatDrafts = {};
  try {
    renderChatView(true); // directory arrived / bell toggled / backlog flip — same channel
    assert.equal(view.innerHTML, 'SHELL-NODES', 'the shell was not torn down and rebuilt');
    assert.equal(input.value, 'half-typed in general', 'the composer node and its text are untouched');
    // switch channel: the composer is shared, so drafts park and restore per channel
    state.ui.chatChannel = 'memes';
    renderChatView(true);
    assert.equal(view.innerHTML, 'SHELL-NODES', 'a channel switch is in place too');
    assert.equal(chatViewBuiltFor, 'memes');
    assert.equal(chatDrafts.general, 'half-typed in general', 'the old channel\'s draft was parked');
    assert.equal(input.value, '', 'memes starts with its own (empty) draft');
    assert.ok(input.placeholder.includes('Memes'), 'placeholder follows the channel');
    input.value = 'a meme caption';
    state.ui.chatChannel = 'general';
    renderChatView(true);
    assert.equal(input.value, 'half-typed in general', 'back in general the draft is back');
    assert.equal(chatDrafts.memes, 'a meme caption');
    // a role change rebuilds (the 🧹 button depends on it) — and keeps the draft
    setMemberRole('editor');
    renderChatView(true);
    assert.ok(view.innerHTML !== 'SHELL-NODES', 'viewer → editor needs the clear button, so it rebuilds');
    assert.equal(input.value, 'half-typed in general', 'with the text carried over');
  } finally {
    chatViewBuiltFor = null; chatDrafts = {}; view.dataset.chatShell = ''; input.value = '';
    setMemberRole('editor');
  }
});

test('a forced render that changes nothing does not touch the message list (no thumbnail blink)', () => {
  const { view } = chatStubs();
  const real = globalThis.setHtmlIfChanged;
  const savedFb = fbRef;
  let wrote = 0;
  fbRef = {}; // sync up, so the list shows messages rather than the "sync is off" note
  setMemberRole('viewer');
  state.ui.chatChannel = 'general';
  chatViewBuiltFor = 'general';
  view.dataset.chatShell = chatShellSig();
  chatReady.general = true;
  chatMsgs.general = [normalizeChatMsg('m1', { at: serverNow(), byKey: 'kim@camp,test', name: 'Kim', text: 'hi' })];
  try {
    globalThis.setHtmlIfChanged = (el, html) => { const r = real(el, html); if (r) wrote += 1; return r; };
    renderChatView(true);
    assert.equal(wrote, 1, 'the first render writes the list');
    renderChatView(true); // e.g. a members snapshot that changed no names
    renderChatView(true);
    assert.equal(wrote, 1, 'identical markup is left alone');
    chatMsgs.general.push(normalizeChatMsg('m2', { at: serverNow(), byKey: 'kim@camp,test', name: 'Kim', text: 'again' }));
    renderChatView(true);
    assert.equal(wrote, 2, 'a real change still renders');
  } finally {
    globalThis.setHtmlIfChanged = real;
    fbRef = savedFb;
    chatViewBuiltFor = null; chatMsgs.general = []; chatReady = {}; view.dataset.chatShell = '';
    setMemberRole('editor');
  }
});

test('leaving the Chat tab and coming back keeps the half-typed message, in the same composer', () => {
  const { input } = chatStubs();
  setMemberRole('viewer');
  chatDrafts = {};
  try {
    openChat('general');
    input.value = 'a long half-written reply';
    chatSetDraft('general', input.value); // what the input event does
    showTab('now');
    assert.equal(chatDrafts.general, 'a long half-written reply');
    assert.ok(chatHasDraft(), 'the shell will not send someone home over it');
    openChat('general');
    assert.equal(input.value, 'a long half-written reply', 'the composer node was never rebuilt');
    chatSetDraft('general', '');
    assert.notOk('general' in chatDrafts, 'an empty draft is dropped, not stored');
  } finally {
    showTab('now'); chatDrafts = {}; input.value = '';
    setMemberRole('editor');
  }
});

test('the open channel\'s tab is centred into view when the strip scrolls and it is clipped', () => {
  const { view } = chatStubs();
  const strip = view.querySelector('.chat-tabs');
  const tab = strip.querySelector('.chat-tab-active');
  Object.assign(strip, { scrollWidth: 447, clientWidth: 290, scrollLeft: 0 });
  strip.getBoundingClientRect = () => ({ left: 16, right: 306, width: 290 });
  tab.getBoundingClientRect = () => ({ left: 373, right: 463, width: 90 });
  chatRevealActiveTab(view);
  assert.equal(strip.scrollLeft, (373 - 16) - (290 - 90) / 2, 'centred by rects');
  strip.scrollLeft = 0;
  tab.getBoundingClientRect = () => ({ left: 100, right: 190, width: 90 });
  chatRevealActiveTab(view);
  assert.equal(strip.scrollLeft, 0, 'already fully visible → left alone');
  strip.scrollWidth = 290; // fits: nothing to scroll
  tab.getBoundingClientRect = () => ({ left: 373, right: 463, width: 90 });
  chatRevealActiveTab(view);
  assert.equal(strip.scrollLeft, 0);
});

// ── lightbox race ──

test('a late lightbox response cannot replace the photo now on screen', async () => {
  const saved = globalThis.firebase;
  const resolvers = {};
  globalThis.firebase = { database: () => ({ ref: (p) => ({ once: () => new Promise((res) => { resolvers[p] = res; }) }) }) };
  const rec = (d) => ({ val: () => ({ data: 'data:image/jpeg;base64,' + d }) });
  try {
    const box = document.getElementById('chat-lightbox');
    openChatLightbox('photoA');
    box.onclick();                 // close A before it loads
    openChatLightbox('photoB');
    resolvers[dbPath('chatPhotos/photoB')](rec('BBBB'));
    await flush();
    assert.ok(box.innerHTML.includes('BBBB'), 'B is showing');
    resolvers[dbPath('chatPhotos/photoA')](rec('AAAA')); // A answers late
    await flush();
    assert.ok(box.innerHTML.includes('BBBB') && !box.innerHTML.includes('AAAA'), 'A did not overwrite B');
    box.onclick();
  } finally {
    globalThis.firebase = saved;
  }
});

// ── the Chat tab (phone Back and scroll are the shell's: tests/tabs.test.js) ──

test('chat files no history entry of its own, and has no back pill or popstate listener', () => {
  const src = readFixture('../chat.js');
  assert.notOk(/campChat|chatHistoryPush|chatHistoryPop|chatHistoryEntry|popstate/.test(src), 'the shell\'s history rules cover the Chat tab');
  assert.notOk(/chat-back-btn|closeChat|chatSavedScrollY/.test(src), 'no back pill, no close, no saved page scroll');
  assert.ok(/id="chat-send-btn"[^>]*>Send</.test(src), 'a gold Send, as a word');
  assert.ok(src.includes('#i-camera'), 'and the camera icon, not an emoji');
});

test('a message arriving while another tab shows still lands in the built list, and the tab bar counts it', () => {
  setMemberRole('viewer');
  const realStatus = globalThis.renderChatStatus;
  const calls = [];
  try {
    chatViewBuiltFor = 'general'; chatReady = { general: true }; chatMsgs.general = [];
    const appended = [];
    const realAppend = globalThis.appendChatBubble;
    globalThis.appendChatBubble = (ch, m) => appended.push(m.id);
    globalThis.renderChatStatus = () => calls.push('status');
    state.ui.tab = 'now'; // not looking at chat
    onChatMsgAdded('general', { key: 'm1', val: () => ({ at: serverNow(), byKey: 'sam@camp,test', name: 'Sam', text: 'hello' }) });
    assert.deepEqual(appended, ['m1'], 'drawn while hidden, or it would be missing on return');
    assert.ok(calls.includes('status'), 'the tab badge is refreshed');
    globalThis.appendChatBubble = realAppend;
  } finally {
    globalThis.renderChatStatus = realStatus;
    chatViewBuiltFor = null; chatMsgs.general = []; chatReady = {};
    setMemberRole('editor');
  }
});

test('the SDK-failure path in app.js still tells chat (source pin for the typeof-guarded hook)', () => {
  // The guarded call is invisible to every other test: a rename on either side
  // would silently bring back the stuck "Loading…" list after a definitive
  // SDK failure. Run the real onSdkLoadFailed with the view built and watch it land.
  const saved = { cfg: window.FIREBASE_CONFIG, fbRef, sdkLoadFailed, appStarted, built: chatViewBuiltFor };
  const calls = [];
  const realStatus = globalThis.renderChatStatus, realView = globalThis.renderChatView;
  try {
    window.FIREBASE_CONFIG = { apiKey: 'k' };
    fbRef = null; appStarted = true;
    chatViewBuiltFor = 'general';
    globalThis.renderChatStatus = () => calls.push('status');
    globalThis.renderChatView = (force) => calls.push('view:' + !!force);
    onSdkLoadFailed('x');
    assert.ok(sdkLoadFailed);
    assert.ok(calls.includes('status') && calls.includes('view:true'), 'chat was refreshed: ' + calls.join(','));
  } finally {
    globalThis.renderChatStatus = realStatus; globalThis.renderChatView = realView;
    chatViewBuiltFor = saved.built;
    window.FIREBASE_CONFIG = saved.cfg; fbRef = saved.fbRef; sdkLoadFailed = saved.sdkLoadFailed; appStarted = saved.appStarted;
    setMemberRole('editor');
  }
});

test('the Chat panel remembers its list scroll while the tab is away, and lands on the newest message otherwise', () => {
  const list = document.getElementById('chat-list');
  const realBottom = globalThis.chatScrollToBottom;
  let bottoms = 0;
  try {
    chatViewBuiltFor = 'general';
    globalThis.chatScrollToBottom = () => { bottoms += 1; };
    Object.assign(list, { scrollTop: 120, scrollHeight: 2000, clientHeight: 500 });
    chatOnTabHidden(); // the reader had scrolled up
    list.scrollTop = 0; // a hidden panel forgets
    chatOnTabShown();
    assert.equal(list.scrollTop, 120, 'put back');
    assert.equal(bottoms, 0);
    Object.assign(list, { scrollTop: 1480, scrollHeight: 2000, clientHeight: 500 });
    chatOnTabHidden(); // at the bottom
    list.scrollTop = 0;
    chatOnTabShown();
    assert.equal(bottoms, 1, 'a reader who was at the bottom comes back to the newest message');
  } finally {
    globalThis.chatScrollToBottom = realBottom;
    chatViewBuiltFor = null;
  }
});
