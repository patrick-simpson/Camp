// Camp Chat's pure core: mention detection (the feature's whole point —
// counselors and teams get pinged when NAMED, no @ syntax), the escaped
// mention rendering, unread math, and the RTDB-pruning heals. The Firebase
// flows (push, child_added, lightbox fetch) are exercised headless against
// a stubbed database and live against the real one.

// ── Channels ───────────────────────────────────────────────────────

test('the four channels exist, in order, with stable ids', () => {
  assert.deepEqual(chatChannels().map((c) => c.id), ['announcements', 'general', 'memes', 'photos'],
    'ids are the contract with the security rules — labels can change, ids cannot');
  chatChannels().forEach((c) => {
    assert.ok(c.label && c.short && c.emoji, `${c.id} fully labeled`);
  });
  assert.equal(chatChannelById('memes').label, 'Memes');
  assert.equal(chatChannelById('nope'), null);
});

// ── normalizeChatMsg: every RTDB-prunable shape heals ──────────────

test('normalizeChatMsg heals whatever a sync round-trip can produce', () => {
  const full = normalizeChatMsg('m1', { at: 5, byKey: 'a@b,co', name: 'Pat', text: 'hi', thumb: 'data:image/jpeg;base64,x', photoId: 'p1' });
  assert.deepEqual(full, { id: 'm1', at: 5, byKey: 'a@b,co', name: 'Pat', text: 'hi', thumb: 'data:image/jpeg;base64,x', photoId: 'p1' });
  [null, undefined, 'junk', 42, []].forEach((raw) => {
    const m = normalizeChatMsg('x', raw);
    assert.equal(typeof m.text, 'string', `text is a string for ${JSON.stringify(raw)}`);
    assert.equal(typeof m.at, 'number');
    assert.equal(m.thumb, '');
  });
  assert.equal(normalizeChatMsg('x', { at: 'soon' }).at, 0, 'junk timestamp → 0, sorts first, never NaN');
  assert.equal(normalizeChatMsg('x', { text: 7 }).text, '', 'non-string text is dropped, not stringified');
});

// ── mentionScan: the matching rules ────────────────────────────────

const T = [
  { label: 'Jovi', lower: 'jovi', kind: 'person', key: 'jovi@x,com' },
  { label: 'Sofia', lower: 'sofia', kind: 'person', key: 'sofia@x,com' },
  { label: 'TJ', lower: 'tj', kind: 'person', key: 'tj@x,com' },
  { label: 'Turkey Dinner', lower: 'turkey dinner', kind: 'team', teamId: 't1' },
  { label: 'Turkey', lower: 'turkey', kind: 'team', teamId: 't1' },
  { label: 'Pilgrims', lower: 'pilgrims', kind: 'team', teamId: 't4' },
];

test('mentionScan finds whole words, any case, with punctuation around them', () => {
  assert.equal(mentionScan('great job jovi!', T).length, 1);
  assert.equal(mentionScan('JOVI, that was amazing', T)[0].key, 'jovi@x,com');
  assert.equal(mentionScan('(tj) is up next', T)[0].label, 'TJ');
  assert.deepEqual(mentionScan('nothing to see here', T), []);
  assert.deepEqual(mentionScan('', T), []);
});

test('mentionScan never matches inside longer words', () => {
  assert.deepEqual(mentionScan('sofias bag is in the hall', T), [], 'Sofia inside "sofias" is not a mention');
  assert.deepEqual(mentionScan('adjovial mood today', T), []);
  assert.deepEqual(mentionScan('turkeys everywhere', T), []);
});

test('the longest label wins at the same spot', () => {
  const hits = mentionScan('Turkey Dinner won the relay', T);
  assert.equal(hits.length, 1, 'one hit, not "Turkey Dinner" plus "Turkey"');
  assert.equal(hits[0].label, 'Turkey Dinner');
});

test('multiple distinct mentions all land, sorted by position', () => {
  const hits = mentionScan('jovi tell the pilgrims that sofia has the cooler', T);
  assert.deepEqual(hits.map((h) => h.label), ['Jovi', 'Pilgrims', 'Sofia']);
  assert.ok(hits[0].start < hits[1].start && hits[1].start < hits[2].start);
});

test('chatMentionTargets pulls from the directory, printed lists, teams, and abbrevs', () => {
  memberDirectory = {
    'sarah,k@x,com': { role: 'viewer', name: 'Sarah Kim' },
    'tj@x,com': { role: 'viewer', name: 'TJ' },
  };
  const targets = chatMentionTargets();
  const labels = targets.map((t) => t.label);
  assert.ok(labels.includes('Sarah Kim'), 'full member name');
  assert.ok(labels.includes('Sarah'), 'first name too — campers say "Sarah", not "Sarah Kim"');
  assert.ok(labels.includes('TJ'), 'two-letter names from the known lists still count');
  assert.ok(labels.includes('Alysa'), 'printed counselor list (TEAM_COUNSELORS)');
  assert.ok(labels.includes(state.teams[0].name), 'team names');
  assert.ok(labels.includes('Foxes'), 'team short names (TEAM_ABBREV)');
  memberDirectory = null;
});

// ── mentionIsMine: who gets pinged ─────────────────────────────────

test('a mention is mine when it names me or my team', () => {
  memberName = 'Jovi';
  setMemberTeam('t2');
  state.followTeam = 't2';
  assert.ok(mentionIsMine([{ kind: 'person', label: 'Jovi', key: null }]), 'my name');
  assert.ok(mentionIsMine([{ kind: 'team', label: 'Maples', teamId: 't2' }]), 'my team');
  assert.notOk(mentionIsMine([{ kind: 'person', label: 'Sofia', key: 'sofia@x,com' }]), 'someone else');
  assert.notOk(mentionIsMine([{ kind: 'team', label: 'Foxes', teamId: 't0' }]), 'another team');
  assert.notOk(mentionIsMine([]), 'no mentions');

  setMemberTeam(null);
  state.followTeam = 't4';
  assert.ok(mentionIsMine([{ kind: 'team', label: 'Pilgrims', teamId: 't4' }]),
    'a FOLLOWED team counts too, not just an assigned one');

  memberName = null;
  state.followTeam = null;
});

// ── renderChatText: mention spans compose with escaping ────────────

test('message text is escaped, mentions wrapped, injection impossible', () => {
  const text = '<script>alert(1)</script> nice one jovi & co';
  const hits = mentionScan(text, T);
  const html = renderChatText(text, hits);
  assert.notOk(html.includes('<script>'), 'raw tags never survive');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped instead');
  assert.ok(html.includes('<span class="chat-mention">jovi</span>') ||
            html.includes('<span class="chat-mention chat-mention-you">jovi</span>'), 'the mention is wrapped');
  assert.ok(html.includes('&amp; co'), 'ampersands escaped outside spans too');
  assert.equal(renderChatText('plain words', []), 'plain words');
});

test('a mention of ME renders with the louder style', () => {
  memberName = 'Jovi';
  const hits = mentionScan('jovi come to the office', T);
  assert.ok(renderChatText('jovi come to the office', hits).includes('chat-mention-you'));
  memberName = null;
});

// ── Unread math ────────────────────────────────────────────────────

test('countUnread counts other people\'s messages after lastSeen', () => {
  const list = [
    { id: 'a', at: 100, byKey: 'me@x,com' },
    { id: 'b', at: 200, byKey: 'her@x,com' },
    { id: 'c', at: 300, byKey: 'him@x,com' },
  ];
  assert.equal(countUnread(list, 0, 'me@x,com'), 2, 'my own messages never count');
  assert.equal(countUnread(list, 250, 'me@x,com'), 1);
  assert.equal(countUnread(list, 300, 'me@x,com'), 0, 'seen right up to the last one');
  assert.equal(countUnread([], 0, 'me@x,com'), 0);
  assert.equal(countUnread(null, 0, 'me@x,com'), 0, 'a pruned channel is empty, not a crash');
});

test('the seen map survives junk and stays per-camp keyed', () => {
  localStorage.setItem(lsKey('campScoreboardChatSeen'), 'not json');
  assert.deepEqual(readChatSeen(), {}, 'corrupt map reads as empty');
  markChannelSeen('general');
  assert.ok(readChatSeen().general > 0, 'seen stamp recorded');
  assert.equal(lsKey('campScoreboardChatSeen'), 'campScoreboardChatSeen', 'junior key is the bare literal');
  localStorage.removeItem(lsKey('campScoreboardChatSeen'));
});

test('signing out wipes the chat seen map along with everything else', () => {
  localStorage.setItem('campScoreboardChatSeen', '{"general":1}');
  localStorage.setItem('campScoreboardChatSeen:senior', '{"memes":1}');
  clearLocalData();
  assert.equal(localStorage.getItem('campScoreboardChatSeen'), null);
  assert.equal(localStorage.getItem('campScoreboardChatSeen:senior'), null, 'both camps');
});

// ── The alert routing (no firebase needed — pure decisions) ────────

test('chatPreviewOf shows text or the photo placeholder', () => {
  assert.equal(chatPreviewOf({ name: 'Pat', text: 'hello', byKey: 'p@x,com' }), 'Pat: hello');
  assert.equal(chatPreviewOf({ name: 'Pat', text: '', byKey: 'p@x,com' }), 'Pat: 📷 Photo');
  assert.ok(chatPreviewOf({ name: '', text: 'hi', byKey: 'p@x,com' }).includes('p@x.com'), 'no name → identity');
});

test('chat is not gated on canEdit — viewers can open it', () => {
  setMemberRole('viewer');
  state.ui.chatOpen = false;
  openChat('general');
  assert.ok(state.ui.chatOpen, 'a viewer opened chat');
  assert.equal(state.ui.chatChannel, 'general');
  closeChat();
  assert.notOk(state.ui.chatOpen);
  setMemberRole('editor');
});

test('hide-from-viewers is the chat kill switch', () => {
  setMemberRole('viewer');
  state.meta.hiddenCards = { chat: true };
  state.ui.chatOpen = false;
  openChat('general');
  assert.notOk(state.ui.chatOpen, 'a viewer cannot open hidden chat');
  setMemberRole('editor');
  openChat('general');
  assert.ok(state.ui.chatOpen, 'editors always can');
  closeChat();
  state.meta.hiddenCards = {};
});

test('the chat card key is hideable like every other card', () => {
  assert.ok(HIDEABLE_CARDS.includes('chat'));
});

// ── Channel subscriptions (every-message alerts, device-local) ─────

test('announcements is subscribed by default; everything else is opt-in', () => {
  localStorage.removeItem(lsKey('campScoreboardChatSubs'));
  assert.ok(chatSubscribed('announcements'), 'auto-subscribed (owner\'s call)');
  assert.notOk(chatSubscribed('general'));
  assert.notOk(chatSubscribed('memes'));
  assert.notOk(chatSubscribed('photos'));
});

test('toggling a subscription sticks, and announcements can be muted', () => {
  localStorage.removeItem(lsKey('campScoreboardChatSubs'));
  toggleChatSub('memes');
  assert.ok(chatSubscribed('memes'), 'subscribed');
  toggleChatSub('memes');
  assert.notOk(chatSubscribed('memes'), 'muted again');
  toggleChatSub('announcements');
  assert.notOk(chatSubscribed('announcements'), 'the default-on channel can still be muted');
  localStorage.removeItem(lsKey('campScoreboardChatSubs'));
});

test('corrupt subscription data reads as the defaults', () => {
  localStorage.setItem(lsKey('campScoreboardChatSubs'), 'not json');
  assert.ok(chatSubscribed('announcements'));
  assert.notOk(chatSubscribed('general'));
  localStorage.removeItem(lsKey('campScoreboardChatSubs'));
});

test('signing out wipes subscriptions too', () => {
  localStorage.setItem('campScoreboardChatSubs', '{"memes":true}');
  localStorage.setItem('campScoreboardChatSubs:senior', '{"general":true}');
  clearLocalData();
  assert.equal(localStorage.getItem('campScoreboardChatSubs'), null);
  assert.equal(localStorage.getItem('campScoreboardChatSubs:senior'), null);
});

// ── The 15-minute announcements banner strip ───────────────────────

test('recent announcements-channel messages ride the banner strip, then age out', () => {
  const now = serverNow();
  chatMsgs.announcements = [
    normalizeChatMsg('fresh', { at: now - 60 * 1000, byKey: 'jovi@x,com', name: 'Jovi', text: 'Lunch moved to noon' }),
    normalizeChatMsg('stale', { at: now - 20 * 60 * 1000, byKey: 'jovi@x,com', name: 'Jovi', text: 'Old news' }),
    normalizeChatMsg('photo', { at: now - 2 * 60 * 1000, byKey: 'jovi@x,com', name: 'Jovi', thumb: 'data:image/jpeg;base64,x', photoId: 'p' }),
  ];
  const banners = chatAnnouncementBanners();
  const ids = banners.map((b) => b.id);
  assert.ok(ids.includes('fresh'), 'a minute-old message shows');
  assert.notOk(ids.includes('stale'), '20 minutes old has aged out (15-minute window)');
  assert.ok(ids.includes('photo'), 'photo messages show too');
  const photoBanner = banners.find((b) => b.id === 'photo');
  assert.ok(photoBanner.text.includes('📷'), 'with a pointer into chat');
  banners.forEach((b) => {
    assert.ok(b.fromChat, 'marked as chat-sourced (no remove-for-everyone button)');
    assert.ok(!isNaN(Date.parse(b.at)), 'ISO timestamp for the shared banner renderer');
  });
  chatMsgs.announcements = [];
});

test('a dismissed banner stays dismissed — same set as regular announcements', () => {
  const now = serverNow();
  chatMsgs.announcements = [normalizeChatMsg('d1', { at: now, byKey: 'j@x,com', name: 'J', text: 'hello' })];
  dismissAnnouncement('d1');
  assert.deepEqual(chatAnnouncementBanners(), []);
  chatMsgs.announcements = [];
  localStorage.removeItem(ANNOUNCE_DISMISS_KEY);
});

// ── Links in messages ──────────────────────────────────────────────

test('http links become tappable, everything else stays escaped', () => {
  const html = renderChatText('schedule at https://camp.patricksimpson.info/x?a=1&b=2 <b>now</b>', []);
  assert.ok(html.includes('<a class="chat-link"'), 'link rendered');
  assert.ok(html.includes('target="_blank"') && html.includes('rel="noopener noreferrer"'), 'safe link attrs');
  assert.ok(html.includes('a=1&amp;b=2'), 'URL ampersands escaped in both attr and label');
  assert.notOk(html.includes('<b>'), 'markup around it still escaped');
  assert.equal(renderChatText('no links here', []), 'no links here');
  const withMention = renderChatText('jovi see https://example.com/x', mentionScan('jovi see https://example.com/x', [
    { label: 'Jovi', lower: 'jovi', kind: 'person', key: 'j@x,com' }]));
  assert.ok(withMention.includes('chat-mention') && withMention.includes('chat-link'), 'mentions and links compose');
});

// ── Author names come from the directory, not the message ──────────
// A message's `name` is whatever the sender's device wrote; only `byKey` is
// rules-validated. So the directory is the source of truth for display.

test('a spoofed name on a message loses to the directory record', () => {
  memberDirectory = {
    'mallory@x,com': { role: 'viewer', name: 'Mallory' },
    'patricksimpson,fx@gmail,com': { role: 'editor', name: 'Patrick' },
  };
  const spoof = normalizeChatMsg('s1', {
    at: 1000, byKey: 'mallory@x,com', name: 'Patrick', text: 'everyone to the lake now',
  });
  assert.equal(chatAuthorName(spoof), 'Mallory', 'renders as who actually sent it');
  assert.ok(chatBubbleHTML('general', spoof).includes('Mallory'), 'the bubble shows the real name');
  assert.notOk(chatBubbleHTML('general', spoof).includes('>Patrick<'), 'and never the claimed one');
  assert.equal(chatPreviewOf(spoof), 'Mallory: everyone to the lake now', 'card preview too');
  memberDirectory = null;
});

test('a current member with no name on file shows as their identity, not a claim', () => {
  memberDirectory = { 'nameless@x,com': { role: 'viewer' } };
  const msg = normalizeChatMsg('s2', { at: 1000, byKey: 'nameless@x,com', name: 'Patrick', text: 'hi' });
  assert.equal(chatAuthorName(msg), identityFromKey('nameless@x,com'));
  memberDirectory = null;
});

test('a departed member keeps the name stored on their old messages', () => {
  memberDirectory = { 'still,here@x,com': { role: 'viewer', name: 'Here' } };
  const old = normalizeChatMsg('s3', { at: 1000, byKey: 'gone@x,com', name: 'Jordan', text: 'bye' });
  assert.equal(chatAuthorName(old), 'Jordan', 'history stays readable instead of printing a raw email');
  memberDirectory = null;
});

test('with no directory at all, the stored name is the fallback, then the key', () => {
  memberDirectory = null;
  assert.equal(chatAuthorName(normalizeChatMsg('s4', { at: 1, byKey: 'a@x,com', name: 'Amy', text: 'x' })), 'Amy');
  assert.equal(chatAuthorName(normalizeChatMsg('s5', { at: 1, byKey: 'a@x,com', text: 'x' })), identityFromKey('a@x,com'));
  assert.equal(chatAuthorName(null), 'Someone');
});
