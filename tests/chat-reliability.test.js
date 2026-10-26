// Chat reliability regressions from the 2026-10-26 audit (RESULTS-G3.md). The
// failures were reproduced with the real Firebase SDK against the emulator
// and in Chromium; these pin the fixed behaviour at the function level.

function msgSnap(id, at, extra) {
  return { key: id, val: () => Object.assign({ at, byKey: 'someone,else@x,com', name: 'Someone', text: 'hi ' + id }, extra || {}) };
}

function withSpies(names, fn) {
  const saved = {};
  const calls = {};
  names.forEach((n) => {
    saved[n] = globalThis[n];
    calls[n] = 0;
    globalThis[n] = function () { calls[n] += 1; };
  });
  try { return fn(calls); } finally { names.forEach((n) => { globalThis[n] = saved[n]; }); }
}

function fillChannel(ch, n, startAt) {
  chatMsgs[ch] = [];
  for (let i = 0; i < n; i++) chatMsgs[ch].push(normalizeChatMsg('m' + String(i).padStart(3, '0'), { at: startAt + i * 1000, byKey: 'a@b,c', name: 'A', text: 't' }));
}

// ── chat#1: one send at a time ──

test('a second message waits for the first to be acknowledged (no 1-second-floor refusal)', async () => {
  const pending = [];
  const savedFirebase = globalThis.firebase;
  globalThis.firebase = {
    database: () => ({ ref: () => ({ update: () => new Promise((resolve) => pending.push(resolve)) }) }),
  };
  try {
    chatSendTail = Promise.resolve();
    chatLastAckAt = 0;
    chatAtomicSend({ 'chat/general/a': { text: 'photo' } }, 'chatRate/me');
    chatAtomicSend({ 'chat/general/b': { text: 'caption' } }, 'chatRate/me');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(pending.length, 1, 'the caption must not hit the server while the photo is still uploading');
  } finally {
    pending.forEach((resolve) => resolve());
    globalThis.firebase = savedFirebase;
    chatSendTail = Promise.resolve();
  }
});

// ── chat#4: a window back-fill is not a new message ──

test('an old message re-entering a full channel is not announced again', () => {
  const now = serverNow();
  fillChannel('general', 49, now - 3600 * 1000);
  chatReady.general = true;
  withSpies(['notifyChatMessage'], (calls) => {
    onChatMsgAdded('general', msgSnap('older', now - 7200 * 1000)); // sorts before everything ⇒ back-fill
    assert.equal(calls.notifyChatMessage, 0, 'no toast/chime/notification for a 2-hour-old message');
    onChatMsgAdded('general', msgSnap('fresh', now));
    assert.equal(calls.notifyChatMessage, 1, 'a genuinely new message still alerts');
  });
  chatMsgs.general = [];
});

// ── chat#3: drawn even while the tab is in the background ──

test('a message arriving while the open chat is in the background is still drawn, but not marked read', () => {
  const now = serverNow();
  chatMsgs.general = [];
  chatReady.general = true;
  state.ui.chatOpen = true;
  state.ui.chatChannel = 'general';
  chatViewBuiltFor = 'general';
  document.hidden = true;
  try {
    withSpies(['appendChatBubble', 'markChannelSeen', 'notifyChatMessage'], (calls) => {
      onChatMsgAdded('general', msgSnap('bg1', now));
      assert.equal(calls.appendChatBubble, 1, 'otherwise it is missing when they come back');
      assert.equal(calls.markChannelSeen, 0, 'nobody was looking, so it stays unread');
    });
  } finally {
    document.hidden = false;
    state.ui.chatOpen = false;
    chatViewBuiltFor = null;
    chatMsgs.general = [];
  }
});

// ── chat#2: the sliding window must not rebuild the view ──

test('the oldest message sliding out of a full channel does not rebuild the open view', () => {
  fillChannel('general', 50, serverNow() - 60000);
  state.ui.chatOpen = true;
  state.ui.chatChannel = 'general';
  chatViewBuiltFor = 'general';
  try {
    withSpies(['renderChatView'], (calls) => {
      onChatMsgRemoved('general', { key: 'm000' });
      assert.equal(calls.renderChatView, 0, 'a full rebuild wiped the half-typed message every time');
    });
    assert.equal(chatMsgs.general.length, 49);
  } finally {
    state.ui.chatOpen = false;
    chatViewBuiltFor = null;
    chatMsgs.general = [];
  }
});

// ── chat#6: reading a message marks it read ──

test('marking a channel seen covers the newest message even when serverNow() lags its stamp', () => {
  const now = serverNow();
  chatMsgs.general = [normalizeChatMsg('x', { at: now + 2000, byKey: 'a@b,c', name: 'A', text: 'hi' })];
  markChannelSeen('general');
  assert.ok(readChatSeen().general >= now + 2000);
  assert.equal(countUnread(chatMsgs.general, readChatSeen().general, 'me'), 0);
  chatMsgs.general = [];
});

// ── chat#5 / pages#4: the announcement composer survives the 30 s tick ──

test('the 30-second refresh leaves the announcement composer alone when nothing changed', () => {
  setMemberRole('editor');
  try {
    announceComposerOpen = true;
    renderAnnouncements();
    const wrap = document.getElementById('announcements');
    wrap.innerHTML = 'LIVE-NODES';            // stand-in for the nodes an editor is typing into
    renderAnnouncements();                    // the tick
    assert.equal(wrap.innerHTML, 'LIVE-NODES', 'identical markup must not be rebuilt');
  } finally {
    announceComposerOpen = false;
    setMemberRole(null);
  }
});
