// ── Camp Chat ─────────────────────────────────────────────────────
// Four channels (camps.js CHAT_CHANNELS), every signed-in member can post
// (viewers included — chat is deliberately NOT canEdit()-gated), photos
// compressed client-side and stored in the database, automatic mention
// alerts for counselor names and team names.
//
// Chat is a SELF-CONTAINED layer beside the scoreboard: messages live at
// <dbRoot>/chat/<channelId>/<msgId> and full-size photos at
// <dbRoot>/chatPhotos/<photoId> — sibling nodes to state/config/members,
// NEVER inside synced state (a chat's volume would bloat every device's
// localStorage snapshot and the per-path diff push). In-memory only here.
//
// The one invariant borrowed from the sync layer: chat listeners attach
// only AFTER membership is confirmed (initChatSync is called from
// initSync), and a chat listener error degrades CHAT ONLY — it must never
// touch fbRef/syncDenied; the terminal-read rule belongs to the state
// listener alone. Until the security rules grow the chat blocks, every
// read here is refused and the card just says chat isn't available yet.
//
// Loaded after app.js/settings.js: classic scripts share the global
// lexical scope, so this file reads app.js helpers (esc, showToast,
// maybeNativeNotification, loadImage, canvasToJpeg, serverNow, dbPath…)
// directly, and app.js calls back in through typeof-guarded hooks.

// Messages kept per channel on every device. THE bandwidth knob: each page
// load re-downloads this window per channel (thumbs included), so raising
// it raises every device's data use — see CLAUDE.md before touching.
const CHAT_WINDOW = 50;

const CHAT_TEXT_MAX = 2000;     // chars of message text
const CHAT_THUMB_MAX = 24000;   // chars of inline thumbnail data URL (~18KB)
const CHAT_PHOTO_MAX = 400000;  // chars of full-size photo data URL (~300KB)
const CHAT_SEEN_KEY = 'campScoreboardChatSeen'; // per-camp via lsKey()
const CHAT_SUBS_KEY = 'campScoreboardChatSubs'; // per-camp via lsKey(); {ch: bool}
const CHAT_BANNER_MS = 15 * 60 * 1000; // announcements-channel messages ride the top banner this long
// Smallest gap between two sends from this device. Deliberately a little
// LONGER than the 1000ms floor the security rules enforce, so a real person
// typing fast is stopped politely here and never has a message refused by the
// server. The rules are the actual control; this is the courtesy layer.
const CHAT_MIN_SEND_MS = 1200;
let chatLastSendAt = 0;

let chatMsgs = {};        // channelId -> [{id, at, byKey, name, text, thumb, photoId}] sorted by at
let chatReady = {};       // channelId -> true once the initial backlog has fully arrived
let chatDenied = false;   // rules refused chat (not pasted yet, or revoked)
let chatSyncStarted = false;
let chatViewBuiltFor = null; // which channel the full view DOM was last built for

function chatChannels() {
  return (typeof CAMP !== 'undefined' && CAMP.chatChannels) || [];
}

function chatChannelById(id) {
  return chatChannels().find((c) => c.id === id) || null;
}

// ── Message shape ─────────────────────────────────────────────────
// Heals everything RTDB pruning or a partial write can produce (the
// empty-fields gotcha — see CLAUDE.md): every field comes back typed.
function normalizeChatMsg(id, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(id || ''),
    at: chatSafeAt(r.at),
    byKey: typeof r.byKey === 'string' ? r.byKey : '',
    name: typeof r.name === 'string' ? r.name : '',
    text: typeof r.text === 'string' ? r.text : '',
    thumb: chatSafeImageSrc(r.thumb),
    photoId: chatSafePhotoId(r.photoId),
  };
}

// A message timestamp, clamped to something a Date can hold and a camp can
// believe. This is load-bearing: chatAnnouncementBanners does
// `new Date(at).toISOString()`, which THROWS RangeError past year 275760, and
// it runs inside renderAnnouncements → renderAll. One announcements message
// carrying a wild `at` would therefore take the whole app down on every
// device, with no way to delete it from a UI that can no longer render. The
// rules cap the type but not the range, so the clamp lives here too.
// Clamping the future also stops such a message pinning itself to the banner
// strip and the unread badge forever.
function chatSafeAt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const now = (typeof serverNow === 'function' ? serverNow() : Date.now());
  return Math.min(n, now + 5 * 60 * 1000); // small allowance for clock skew
}

// An image field only ever renders if it's an inline data: image. Our sender
// only produces those and the rules validate the prefix, but this is the
// choke point that matters: an off-scheme URL in an <img src> would silently
// report every viewer's IP, User-Agent and read-time to whoever wrote it. Two
// independent layers, because the rules aren't versioned in this repo.
function chatSafeImageSrc(val) {
  return (typeof val === 'string' && /^data:image\/(jpeg|png|gif|webp);base64,/i.test(val)) ? val : '';
}

// photoId is concatenated into a database path. Push ids are [A-Za-z0-9_-];
// anything else could reshape the path or throw on RTDB's illegal key chars.
function chatSafePhotoId(val) {
  return (typeof val === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(val)) ? val : '';
}

// ── Sync (called from initSync, after membership confirmed) ───────
function initChatSync() {
  if (chatSyncStarted || !chatChannels().length) return;
  chatSyncStarted = true;
  chatChannels().forEach((c) => {
    const ch = c.id;
    chatMsgs[ch] = chatMsgs[ch] || [];
    try {
      const ref = firebase.database().ref(dbPath('chat/' + ch)).limitToLast(CHAT_WINDOW);
      ref.on('child_added', (snap) => onChatMsgAdded(ch, snap), () => {
        // Rules refused (not pasted yet / access changed): chat-only degrade.
        chatDenied = true;
        renderChatCard();
        if (chatOpenNow()) renderChatView(true);
      });
      ref.on('child_removed', (snap) => onChatMsgRemoved(ch, snap));
      // RTDB fires the whole initial backlog as child_added BEFORE this
      // once() resolves — the clean boundary between "history" (counts as
      // unread, never toasts) and "live" (runs the alert path).
      ref.once('value').then(() => {
        chatReady[ch] = true;
        renderChatCard();
        if (chatOpenNow() && state.ui.chatChannel === ch) renderChatView(true);
      }).catch(() => { /* the child_added error handler already spoke */ });
    } catch (e) { /* no firebase — card shows the sync-off note */ }
  });
}

function onChatMsgAdded(ch, snap) {
  const msg = normalizeChatMsg(snap.key, snap.val());
  const list = chatMsgs[ch] = chatMsgs[ch] || [];
  if (list.some((m) => m.id === msg.id)) return; // replay echo — already have it
  list.push(msg);
  list.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  // The window slides: once past CHAT_WINDOW the oldest fell off the query,
  // keep memory bounded the same way.
  if (list.length > CHAT_WINDOW) list.splice(0, list.length - CHAT_WINDOW);
  if (chatReady[ch]) {
    notifyChatMessage(ch, msg);
    if (chatViewingChannel() === ch) {
      markChannelSeen(ch);
      appendChatBubble(ch, msg);
    }
  }
  // Announcements-channel messages also ride the top banner strip for 15
  // minutes (renderAnnouncements merges chatAnnouncementBanners in).
  if (ch === 'announcements' && typeof renderAnnouncements === 'function') renderAnnouncements();
  renderChatCard();
}

function onChatMsgRemoved(ch, snap) {
  const list = chatMsgs[ch] = chatMsgs[ch] || [];
  const i = list.findIndex((m) => m.id === snap.key);
  if (i > -1) list.splice(i, 1);
  renderChatCard();
  if (ch === 'announcements' && typeof renderAnnouncements === 'function') renderAnnouncements();
  if (chatViewingChannel() === ch) renderChatView(true);
}

// ── Sending ───────────────────────────────────────────────────────
function chatSendAllowed() {
  const now = Date.now(); // device clock is right for a device-local gap
  if (now - chatLastSendAt < CHAT_MIN_SEND_MS) return false;
  chatLastSendAt = now;
  return true;
}

function chatDisplayName() {
  return memberName || state.identity || identityLabel(authUser) || 'Someone';
}

// Every send is ONE atomic multi-path update at the camp root, carrying the
// content plus a `chatRate/<myKey>` stamp. The rules require that stamp to
// advance and refuse a create whose previous stamp is under a second old —
// which is what actually caps a flood, since a client-side gap is just a
// variable an attacker can skip. Atomic also means a photo and its message
// land together or not at all, which the old photo-then-message pair couldn't
// promise.
//
// The fallback exists because the ruleset is pasted into the console BY HAND,
// so the code and the rules are never in step for long. Under rules that don't
// know about chatRate yet, the stamp is refused and the whole update fails —
// so we retry once without it. That makes this deploy safe to ship BEFORE the
// paste, and once the paste lands the retry simply stops happening.
function chatAtomicSend(updates, rateKey) {
  const rootRef = () => firebase.database().ref(CAMP.dbRoot);
  return rootRef().update(updates).catch((err) => {
    const withoutStamp = {};
    Object.keys(updates).forEach((k) => { if (k !== rateKey) withoutStamp[k] = updates[k]; });
    return rootRef().update(withoutStamp).catch(() => { throw err; });
  });
}

// Who a message is FROM, for display. `byKey` is the only trustworthy field on
// a message — the rules validate it against the sender's authenticated
// identity — while `name` is just a string that sender's device chose, so any
// signed-in member could otherwise post under someone else's name. So the
// member directory wins: it's editor-maintained and keyed by that same byKey.
// A current member with no name on file shows as their email/phone rather than
// whatever they claimed (which also nudges an editor into filling the name in).
// The stored name survives only as the fallback for someone since REMOVED from
// the list — they can no longer post, and the alternative would be printing a
// departed counselor's raw email into camp chat history.
// The directory lands asynchronously (and changes when an editor renames
// someone), so bubbles built before it arrives are showing fallbacks. app.js
// calls this from the members listener to rebuild them with the real names.
function onMemberDirectoryChanged() {
  renderChatCard();
  if (chatOpenNow()) renderChatView(true);
}

function chatDirectoryRecord(key) {
  // hasOwnProperty, not a bare lookup: a byKey of 'constructor' or '__proto__'
  // would otherwise return an inherited object and read as a real member.
  if (!memberDirectoryLoaded || !memberDirectory || !key) return null;
  if (!Object.prototype.hasOwnProperty.call(memberDirectory, key)) return null;
  const rec = memberDirectory[key];
  return rec && typeof rec === 'object' ? rec : null;
}

// Is this name already taken by someone still on the list? Guards the one
// remaining route back to the claimed name (below).
function chatNameIsInDirectory(name) {
  const want = String(name).trim().toLowerCase();
  if (!want || !memberDirectory) return false;
  return Object.keys(memberDirectory).some((k) => {
    const rec = memberDirectory[k];
    return rec && typeof rec.name === 'string' && rec.name.trim().toLowerCase() === want;
  });
}

function chatAuthorName(msg) {
  if (!msg) return 'Someone';
  const key = msg.byKey || '';
  const rec = chatDirectoryRecord(key);
  if (rec) return (typeof rec.name === 'string' && rec.name.trim()) || identityFromKey(key) || 'Someone';
  // No directory at all (still loading, or the read failed): fail CLOSED.
  // Trusting `name` here would restore spoofing for the whole session, so
  // show the identity the rules DID validate instead.
  if (!memberDirectoryLoaded || !memberDirectory) return identityFromKey(key) || 'Someone';
  // Directory loaded, key absent ⇒ this person has LEFT the member list. Their
  // stored name keeps history readable instead of printing a raw email — but
  // only if it isn't the name of someone still here, which would let a member
  // plant messages as "Patrick" now and have them go live once they're removed.
  const claim = String(msg.name || '').trim();
  if (claim && !chatNameIsInDirectory(claim)) return claim;
  return identityFromKey(key) || 'Someone';
}

function sendChatMessage(ch) {
  const input = document.getElementById('chat-input');
  const text = ((input && input.value) || '').trim().slice(0, CHAT_TEXT_MAX);
  if (!text) return;
  const myKey = identityKey(authUser);
  if (!myKey || typeof firebase === 'undefined') { showToast("Couldn't send — you're not signed in."); return; }
  if (!chatSendAllowed()) return; // a double-tap shouldn't post twice
  const msg = {
    at: firebase.database.ServerValue.TIMESTAMP,
    byKey: myKey,
    name: String(chatDisplayName()).slice(0, 60),
    text,
  };
  if (input) input.value = '';
  const id = firebase.database().ref(dbPath('chat/' + ch)).push().key;
  const rateKey = 'chatRate/' + myKey;
  chatAtomicSend({ ['chat/' + ch + '/' + id]: msg, [rateKey]: firebase.database.ServerValue.TIMESTAMP }, rateKey)
    .catch(() => {
      if (input && !input.value) input.value = text; // give the words back
      showToast("Couldn't send — check your connection and try again.");
    });
}

// Photo first, message second: a half-failure leaves an orphaned photo
// (harmless, invisible) rather than a message pointing at nothing.
function sendChatPhoto(ch, file) {
  const myKey = identityKey(authUser);
  if (!file || !myKey || typeof firebase === 'undefined') return;
  if (!chatSendAllowed()) return;
  const btn = document.getElementById('chat-photo-btn');
  if (btn) btn.setAttribute('disabled', '');
  makeChatImages(file)
    .then(({ full, thumb }) => {
      const photoId = firebase.database().ref(dbPath('chatPhotos')).push().key;
      const msgId = firebase.database().ref(dbPath('chat/' + ch)).push().key;
      const rateKey = 'chatRate/' + myKey;
      // One update: the full image, the message that points at it, and the
      // rate stamp. Either all three land or none do, so there is no window
      // where a message references a photo that isn't there.
      return chatAtomicSend({
        ['chatPhotos/' + photoId]: { byKey: myKey, at: firebase.database.ServerValue.TIMESTAMP, ch, data: full },
        ['chat/' + ch + '/' + msgId]: {
          at: firebase.database.ServerValue.TIMESTAMP,
          byKey: myKey,
          name: String(chatDisplayName()).slice(0, 60),
          thumb,
          photoId,
        },
        [rateKey]: firebase.database.ServerValue.TIMESTAMP,
      }, rateKey);
    })
    .catch(() => showToast("Couldn't send the photo — try a different one, or check your connection."))
    .then(() => { if (btn) btn.removeAttribute('disabled'); });
}

function chatBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Draw the image at (max maxDim px, never upscaled) and step the JPEG
// quality down until the data URL fits the cap — the rules enforce the
// same cap server-side, so an oversized write would be refused anyway.
function shrinkToDataUrl(img, maxDim, cap, startQuality) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const tryQuality = (q) => canvasToJpeg(canvas, q)
    .then(chatBlobToDataUrl)
    .then((url) => {
      if (url.length <= cap || q <= 0.25) return url;
      return tryQuality(q - 0.15);
    });
  return tryQuality(startQuality);
}

function makeChatImages(file) {
  return loadImage(file).then((img) => Promise.all([
    shrinkToDataUrl(img, 1280, CHAT_PHOTO_MAX, 0.7),
    shrinkToDataUrl(img, 320, CHAT_THUMB_MAX, 0.6),
  ]).then(([full, thumb]) => ({ full, thumb })));
}

function deleteChatMessage(ch, msg) {
  if (!confirm('Delete this message for everyone?')) return;
  firebase.database().ref(dbPath('chat/' + ch + '/' + msg.id)).remove()
    .then(() => {
      // Best-effort: the photo is invisible without its message anyway.
      if (msg.photoId) firebase.database().ref(dbPath('chatPhotos/' + msg.photoId)).remove().catch(() => {});
    })
    .catch(() => showToast("Couldn't delete — only your own messages (editors can delete any)."));
}

// Editor housekeeping: empties a channel AND its photos (the storage that
// actually costs space). Double confirm — this is for after camp week.
function clearChatChannel(ch) {
  if (!canEdit()) return;
  const c = chatChannelById(ch);
  if (!confirm(`Clear ALL messages in ${c ? c.label : ch}? This is for cleaning up after camp.`)) return;
  if (!confirm('Really clear the whole channel for everyone? This cannot be undone.')) return;
  firebase.database().ref(dbPath('chat/' + ch)).remove()
    // Collect the photo keys a page at a time. An RTDB query returns whole
    // child nodes, and each of these carries a ~300KB image — clearing a busy
    // Photo Dump in one query would download tens of megabytes just to read
    // the keys off it. shallow() isn't available in the JS SDK, so page
    // instead: 200 keys per round trip until a page comes back short.
    .then(() => {
      const removeBatch = () => firebase.database().ref(dbPath('chatPhotos'))
        .orderByChild('ch').equalTo(ch).limitToFirst(200).once('value')
        .then((snap) => {
          const updates = {};
          let n = 0;
          snap.forEach((child) => { updates[child.key] = null; n++; });
          if (!n) return null;
          return firebase.database().ref(dbPath('chatPhotos')).update(updates)
            .then(() => (n === 200 ? removeBatch() : null)); // a short page is the last one
        });
      return removeBatch();
    })
    .then(() => { chatMsgs[ch] = []; showToast('Channel cleared', { mine: true }); renderChatView(true); renderChatCard(); })
    .catch(() => showToast("Couldn't clear the channel — are you still an editor?"));
}

// ── Mentions ──────────────────────────────────────────────────────
// AUTOMATIC: no @ syntax. The dictionary is every name the app knows —
// member names (and their first names), the printed counselor lists, team
// names and short names — and matching is word-boundary, case-insensitive,
// longest-match-wins. Pure functions below take the dictionary as an
// argument so the tests can drive them without any globals.

function chatMentionTargets() {
  const targets = [];
  const seen = new Set();
  const add = (label, kind, extra) => {
    const clean = String(label || '').trim();
    if (clean.length < 3) return; // "TJ" is 2 chars — see the abbrev add below
    const dedupeKey = kind + ':' + clean.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    targets.push(Object.assign({ label: clean, lower: clean.toLowerCase(), kind }, extra || {}));
  };
  // People: the live directory first (real names), then the printed lists.
  Object.keys(memberDirectory || {}).forEach((key) => {
    const rec = memberDirectory[key] || {};
    if (!rec.name) return;
    add(rec.name, 'person', { key });
    add(String(rec.name).trim().split(/\s+/)[0], 'person', { key }); // first name
  });
  Object.keys(TEAM_COUNSELORS || {}).forEach((tid) => {
    (TEAM_COUNSELORS[tid] || []).forEach((n) => add(n, 'person', {}));
  });
  // Short person names (TJ, Zac) matter more than the 3-char floor — allow
  // 2-char names from the known lists only (never from free text).
  Object.keys(memberDirectory || {}).forEach((key) => {
    const rec = memberDirectory[key] || {};
    const first = String(rec.name || '').trim().split(/\s+/)[0];
    if (first.length === 2) {
      const dk = 'person:' + first.toLowerCase();
      if (!seen.has(dk)) { seen.add(dk); targets.push({ label: first, lower: first.toLowerCase(), kind: 'person', key }); }
    }
  });
  Object.keys(TEAM_COUNSELORS || {}).forEach((tid) => {
    (TEAM_COUNSELORS[tid] || []).forEach((n) => {
      if (String(n).trim().length === 2) {
        const dk = 'person:' + String(n).trim().toLowerCase();
        if (!seen.has(dk)) { seen.add(dk); targets.push({ label: String(n).trim(), lower: String(n).trim().toLowerCase(), kind: 'person' }); }
      }
    });
  });
  // Teams: full names + short names.
  (state.teams || []).forEach((t) => add(t.name, 'team', { teamId: t.id }));
  Object.keys(TEAM_ABBREV || {}).forEach((tid) => add(TEAM_ABBREV[tid], 'team', { teamId: tid }));
  return targets;
}

function chatIsWordChar(c) {
  return !!c && /[a-z0-9]/i.test(c);
}

// All non-overlapping mention hits in `text`: word-boundary, case-
// insensitive, longer labels beat shorter ones at the same spot (so
// "Patriotic Pilgrims" wins over a member named "Pat").
function mentionScan(text, targets) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  if (!raw || !targets || !targets.length) return [];
  const candidates = [];
  targets.forEach((t) => {
    let from = 0;
    while (from <= lower.length - t.lower.length) {
      const i = lower.indexOf(t.lower, from);
      if (i === -1) break;
      const before = raw[i - 1];
      const after = raw[i + t.lower.length];
      if (!chatIsWordChar(before) && !chatIsWordChar(after)) {
        candidates.push({ start: i, end: i + t.lower.length, label: t.label, kind: t.kind, key: t.key || null, teamId: t.teamId || null });
      }
      from = i + 1;
    }
  });
  // Longest first, then earliest — then keep whatever doesn't overlap.
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept = [];
  candidates.forEach((c) => {
    if (!kept.some((k) => c.start < k.end && k.start < c.end)) kept.push(c);
  });
  return kept.sort((a, b) => a.start - b.start);
}

// Does any hit point at THIS device's person or team?
function mentionIsMine(hits) {
  const myKey = identityKey(authUser);
  const myNames = [memberName, state.identity].filter(Boolean).map((n) => String(n).toLowerCase());
  const myFirsts = myNames.map((n) => n.split(/\s+/)[0]);
  return (hits || []).some((h) => {
    if (h.kind === 'person') {
      if (h.key && myKey && h.key === myKey) return true;
      const l = h.label.toLowerCase();
      return myNames.includes(l) || myFirsts.includes(l);
    }
    return h.teamId && (h.teamId === memberTeamId || h.teamId === state.followTeam);
  });
}

// A plain text segment → escaped HTML with http(s) links made tappable.
// Splits on the RAW string, escapes each piece separately (URL included —
// it lands in both the attribute and the label already escaped).
function chatLinkifySegment(raw) {
  const parts = String(raw).split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((p, i) => (i % 2
    ? `<a class="chat-link" href="${esc(p)}" target="_blank" rel="noopener noreferrer">${esc(p)}</a>`
    : esc(p))).join('');
}

// Escaped HTML with mention spans + tappable links. Walks the RAW string
// segment by segment, escaping each piece separately — never regex over
// escaped HTML.
function renderChatText(text, hits) {
  const raw = String(text || '');
  if (!hits || !hits.length) return chatLinkifySegment(raw);
  let html = '';
  let pos = 0;
  hits.forEach((h) => {
    html += chatLinkifySegment(raw.slice(pos, h.start));
    const mine = mentionIsMine([h]);
    html += `<span class="chat-mention${mine ? ' chat-mention-you' : ''}">${esc(raw.slice(h.start, h.end))}</span>`;
    pos = h.end;
  });
  html += chatLinkifySegment(raw.slice(pos));
  return html;
}

// ── Unread tracking (per device, per camp via lsKey) ──────────────
function readChatSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(lsKey(CHAT_SEEN_KEY)) || '{}');
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (e) { return {}; }
}

function markChannelSeen(ch) {
  const seen = readChatSeen();
  seen[ch] = serverNow();
  try { localStorage.setItem(lsKey(CHAT_SEEN_KEY), JSON.stringify(seen)); } catch (e) { /* fine */ }
  renderChatCard();
  renderChatBadges();
}

// Pure: how many of `list` arrived after `lastSeen` from someone else.
function countUnread(list, lastSeen, myKey) {
  return (list || []).filter((m) => m.at > (lastSeen || 0) && m.byKey !== myKey).length;
}

function unreadCount(ch) {
  return countUnread(chatMsgs[ch], readChatSeen()[ch], identityKey(authUser));
}

function unreadTotal() {
  return chatChannels().reduce((n, c) => n + unreadCount(c.id), 0);
}

// ── Channel subscriptions (device-local, per camp) ────────────────
// Subscribing to a channel means EVERY new message there alerts you, not
// just mentions. Announcements is subscribed by default — the owner's
// call — and any channel can be toggled from the bell in the chat header.
function readChatSubs() {
  try {
    const v = JSON.parse(localStorage.getItem(lsKey(CHAT_SUBS_KEY)) || '{}');
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (e) { return {}; }
}

function chatSubscribed(ch) {
  const subs = readChatSubs();
  return ch in subs ? !!subs[ch] : ch === 'announcements'; // default: announcements only
}

function toggleChatSub(ch) {
  const subs = readChatSubs();
  subs[ch] = !chatSubscribed(ch);
  try { localStorage.setItem(lsKey(CHAT_SUBS_KEY), JSON.stringify(subs)); } catch (e) { /* fine */ }
  const c = chatChannelById(ch);
  showToast(subs[ch]
    ? `🔔 You'll get an alert for every message in ${c ? c.short : ch}.`
    : `🔕 ${c ? c.short : ch} muted — you'll still get an alert when someone mentions you.`,
    { mine: subs[ch] });
  renderChatView(true);
}

// ── The announcements banner strip ────────────────────────────────
// A message posted in the Announcements channel also rides the top-of-app
// banner area (like a regular 📣 announcement) for 15 minutes, dismissible
// per device through the same dismissed set. renderAnnouncements (app.js)
// merges these in; the 30s interval ages them out.
function chatAnnouncementBanners() {
  const cutoff = serverNow() - CHAT_BANNER_MS;
  const dismissed = dismissedAnnouncements();
  return (chatMsgs.announcements || [])
    .filter((m) => m.at > cutoff && !dismissed.includes(m.id))
    .map((m) => ({
      id: m.id,
      text: m.text || '📷 Photo (open Chat to see it)',
      at: new Date(m.at).toISOString(),
      by: chatAuthorName(m),
      fromChat: true, // renderAnnouncements: no "remove for everyone" (delete it in chat)
    }));
}

// ── Alerts (post-backlog messages only) ───────────────────────────
function chatViewingChannel() {
  return (chatOpenNow() && !document.hidden) ? state.ui.chatChannel : null;
}

function chatPreviewOf(msg) {
  const name = chatAuthorName(msg);
  const what = msg.text ? msg.text.slice(0, 90) : '📷 Photo';
  return `${name}: ${what}`;
}

function notifyChatMessage(ch, msg) {
  const myKey = identityKey(authUser);
  if (msg.byKey && myKey && msg.byKey === myKey) return; // my own echo
  const viewing = chatViewingChannel() === ch;
  const preview = chatPreviewOf(msg);
  const c = chatChannelById(ch);
  if (ch === 'announcements' && chatSubscribed(ch)) {
    // An announcement is for everyone (subscribed by default) — same
    // treatment as the announcement banner alerts (toast + OS notification
    // + bright chime + buzz).
    if (!viewing) showToast('📣 ' + preview);
    if (state.notify) {
      maybeNativeNotification('📣 Chat announcement', preview, 'camp-chat-ann-' + msg.id);
      playMineChime();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
    return;
  }
  // A subscribed channel alerts on every message; everything else only
  // when your name or team comes up. Mentions win the louder styling.
  const hits = mentionScan(msg.text, chatMentionTargets());
  const mentioned = mentionIsMine(hits);
  if (mentioned) {
    if (!viewing) showToast(`💬 ${chatAuthorName(msg)} mentioned you: ${(msg.text || '').slice(0, 80)}`, { mine: true });
    if (state.notify) {
      maybeNativeNotification('💬 You were mentioned in Chat', preview, 'camp-chat-men-' + msg.id);
      if (navigator.vibrate) navigator.vibrate(150);
    }
    return;
  }
  if (chatSubscribed(ch)) {
    if (!viewing) showToast(`${c ? c.emoji : '💬'} ${preview}`);
    if (state.notify) {
      maybeNativeNotification(`${c ? c.emoji + ' ' : ''}Chat · ${c ? c.short : ch}`, preview, 'camp-chat-sub-' + msg.id);
      if (navigator.vibrate) navigator.vibrate(150);
    }
  }
  // Everything else: the unread badge (renderChatCard, from the caller).
}

// ── Open / close (device-local, like state.ui.day) ────────────────
function chatOpenNow() {
  return !!(state.ui && state.ui.chatOpen);
}

function chatHiddenFromMe() {
  return !canEdit() && typeof cardHiddenFromViewers === 'function' && cardHiddenFromViewers('chat');
}

function openChat(ch) {
  if (!chatChannels().length || chatHiddenFromMe()) return;
  state.ui.chatOpen = true;
  state.ui.chatChannel = chatChannelById(ch) ? ch : (state.ui.chatChannel || 'general');
  if (state.ui.view === 'settings') state.ui.view = 'home'; // one takeover at a time
  saveState();
  chatViewBuiltFor = null; // force a fresh build
  renderAll();
  markChannelSeen(state.ui.chatChannel);
}

function closeChat() {
  state.ui.chatOpen = false;
  saveState();
  chatViewBuiltFor = null;
  renderAll();
}

// ── Rendering ─────────────────────────────────────────────────────
function chatRelativeTime(atMs) {
  if (!atMs) return '';
  const mins = Math.max(0, Math.round((serverNow() - atMs) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 60 * 24) return Math.round(mins / 60) + 'h ago';
  return formatEasternStamp(new Date(atMs).toISOString()) || '';
}

// The home card: latest message + unread badge (static markup lives in
// index.html so the hide-from-viewers switch wires up like every card's).
function renderChatCard() {
  const card = document.getElementById('chat-card');
  if (!card) return;
  if (!chatChannels().length) { card.hidden = true; return; }
  // applyCardVisibility owns `hidden` for hide-from-viewers; only reveal here.
  if (!chatHiddenFromMe()) card.hidden = false;
  const preview = document.getElementById('chat-card-preview');
  const badge = document.getElementById('chat-card-badge');
  if (badge) {
    const n = unreadTotal();
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : String(n);
  }
  if (!preview) return;
  if (chatDenied) {
    preview.textContent = "Chat isn't available yet — the database rules need updating.";
    return;
  }
  if (!syncEnabled()) {
    preview.textContent = 'Chat needs live sync, which is off on this device.';
    return;
  }
  let latest = null;
  let latestCh = null;
  chatChannels().forEach((c) => {
    (chatMsgs[c.id] || []).forEach((m) => { if (!latest || m.at > latest.at) { latest = m; latestCh = c; } });
  });
  const ready = chatChannels().some((c) => chatReady[c.id]);
  preview.textContent = latest
    ? `${latestCh ? latestCh.emoji + ' ' : ''}${chatPreviewOf(latest)} · ${chatRelativeTime(latest.at)}`
    : (ready ? 'No messages yet — start the conversation!' : 'Loading…');
  // Home-screen icon badge (installed PWAs on platforms that support it) —
  // best-effort and silent everywhere else.
  try {
    if (navigator.setAppBadge) {
      const n = unreadTotal();
      if (n) navigator.setAppBadge(n);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    }
  } catch (e) { /* fine */ }
}

function renderChatBadges() {
  chatChannels().forEach((c) => {
    const b = document.querySelector(`.chat-tab-badge[data-ch="${c.id}"]`);
    if (b) {
      const n = unreadCount(c.id);
      b.hidden = n === 0;
      b.textContent = n > 99 ? '99+' : String(n);
    }
  });
}

function chatDayStamp(atMs) {
  if (!atMs) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, weekday: 'long', month: 'short', day: 'numeric' })
    .format(new Date(atMs));
  return parts;
}

function chatTimeStamp(atMs) {
  if (!atMs) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: CAMP_TZ, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(atMs)).toLowerCase();
}

function chatBubbleHTML(ch, msg) {
  const myKey = identityKey(authUser);
  const mine = !!(myKey && msg.byKey === myKey);
  const canDelete = mine || canEdit();
  const hits = mentionScan(msg.text, chatMentionTargets());
  const textHTML = msg.text ? `<p class="chat-bubble-text">${renderChatText(msg.text, hits)}</p>` : '';
  const thumbHTML = msg.thumb
    ? `<button type="button" class="chat-thumb-btn" data-photo-id="${esc(msg.photoId)}" aria-label="Open photo">
        <img class="chat-thumb" src="${esc(msg.thumb)}" alt="Photo from ${esc(chatAuthorName(msg))}" loading="lazy" decoding="async"></button>`
    : '';
  return `<div class="chat-bubble${mine ? ' chat-bubble-mine' : ''}" data-msg-id="${esc(msg.id)}">
    <div class="chat-bubble-head">
      <span class="chat-bubble-name">${esc(chatAuthorName(msg))}</span>
      <span class="chat-bubble-time">${esc(chatTimeStamp(msg.at))}</span>
      ${canDelete ? `<button type="button" class="chat-delete-btn" aria-label="Delete message">✕</button>` : ''}
    </div>
    ${thumbHTML}
    ${textHTML}
  </div>`;
}

function chatListHTML(ch) {
  if (chatDenied) return `<p class="muted chat-note">Chat isn't available yet — the database rules need updating (ask Patrick).</p>`;
  if (!syncEnabled()) return `<p class="muted chat-note">Chat needs live sync, which is off on this device.</p>`;
  if (!chatReady[ch]) {
    return '<div class="history-skeleton">' +
      [80, 60, 75].map((w) => `<div class="skeleton-row" style="width:${w}%"><jelly-skeleton style="height:3rem"></jelly-skeleton></div>`).join('') +
      '</div>';
  }
  const list = chatMsgs[ch] || [];
  if (!list.length) return `<p class="muted chat-note">No messages here yet — say hi! 👋</p>`;
  let html = '';
  let lastDay = '';
  list.forEach((m) => {
    const day = chatDayStamp(m.at);
    if (day && day !== lastDay) {
      html += `<div class="chat-day-sep"><span>${esc(day)}</span></div>`;
      lastDay = day;
    }
    html += chatBubbleHTML(ch, m);
  });
  return html;
}

// Full rebuild only on open/channel-switch/structural change — a rebuild
// mid-typing would eat the composer text, and renderAll runs on every
// synced update. Live messages append incrementally (appendChatBubble).
function renderChatView(force) {
  const view = document.getElementById('chat-view');
  if (!view) return;
  const ch = state.ui.chatChannel || 'general';
  if (!force && chatViewBuiltFor === ch) { renderChatBadges(); return; }
  chatViewBuiltFor = ch;
  const c = chatChannelById(ch) || chatChannels()[0] || { id: ch, label: ch, emoji: '💬' };

  const tabs = chatChannels().map((t) => `
    <button type="button" class="chat-tab${t.id === ch ? ' chat-tab-active' : ''}" data-ch="${t.id}">
      <span class="chat-tab-emoji">${t.emoji}</span> ${esc(t.short)}
      <span class="chat-tab-badge" data-ch="${t.id}" hidden></span>
    </button>`).join('');

  const subbed = chatSubscribed(ch);
  view.innerHTML = `
    <div class="chat-head">
      <button id="chat-back-btn" class="back-pill"><span class="back-pill-arrow" aria-hidden="true">←</span> Camp</button>
      <h2 class="chat-title">${c.emoji} ${esc(c.label)}</h2>
      <button id="chat-sub-btn" class="chat-sub-btn${subbed ? ' chat-sub-on' : ''}"
        title="${subbed ? 'Subscribed — every message here alerts you' : 'Muted — only mentions alert you'}"
        aria-label="${subbed ? 'Unsubscribe from this channel' : 'Subscribe to this channel'}">${subbed ? '🔔' : '🔕'}</button>
      ${canEdit() ? '<button id="chat-clear-btn" class="link-btn danger-link chat-clear-btn" title="Clear this channel">🧹</button>' : ''}
    </div>
    <div class="chat-tabs">${tabs}</div>
    <div id="chat-list" class="chat-list">${chatListHTML(ch)}</div>
    <div class="chat-composer">
      <input type="file" id="chat-photo-input" accept="image/*" hidden>
      <button type="button" id="chat-photo-btn" class="chat-photo-btn" aria-label="Send a photo">📷</button>
      <input type="text" id="chat-input" class="chat-text-input" placeholder="Message ${esc(c.short)}…" maxlength="${CHAT_TEXT_MAX}" autocomplete="off">
      <button type="button" id="chat-send-btn" class="chat-send-btn" aria-label="Send">➤</button>
    </div>`;

  renderChatBadges();
  wireChatView(ch);
  chatScrollToBottom();
}

function wireChatView(ch) {
  const view = document.getElementById('chat-view');
  const back = document.getElementById('chat-back-btn');
  if (back) back.addEventListener('click', closeChat);
  view.querySelectorAll('.chat-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ui.chatChannel = btn.dataset.ch;
      saveState();
      renderChatView(true);
      markChannelSeen(btn.dataset.ch);
    });
  });
  const send = document.getElementById('chat-send-btn');
  if (send) send.addEventListener('click', () => sendChatMessage(ch));
  const input = document.getElementById('chat-input');
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(ch); });
  const photoBtn = document.getElementById('chat-photo-btn');
  const photoInput = document.getElementById('chat-photo-input');
  if (photoBtn && photoInput) {
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
      if (photoInput.files && photoInput.files[0]) sendChatPhoto(ch, photoInput.files[0]);
      photoInput.value = '';
    });
  }
  const clearBtn = document.getElementById('chat-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', () => clearChatChannel(ch));
  const subBtn = document.getElementById('chat-sub-btn');
  if (subBtn) subBtn.addEventListener('click', () => toggleChatSub(ch));
  wireChatBubbles(view, ch);
}

function wireChatBubbles(scope, ch) {
  scope.querySelectorAll('.chat-delete-btn').forEach((btn) => {
    if (btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener('click', () => {
      const el = btn.closest('.chat-bubble');
      const msg = (chatMsgs[ch] || []).find((m) => m.id === (el && el.dataset.msgId));
      if (msg) deleteChatMessage(ch, msg);
    });
  });
  scope.querySelectorAll('.chat-thumb-btn').forEach((btn) => {
    if (btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener('click', () => openChatLightbox(btn.dataset.photoId));
  });
}

function chatScrollToBottom() {
  const list = document.getElementById('chat-list');
  if (list) list.scrollTop = list.scrollHeight;
}

function appendChatBubble(ch, msg) {
  const list = document.getElementById('chat-list');
  if (!list || chatViewBuiltFor !== ch) return;
  // The first message replaces the "say hi" placeholder rather than
  // stacking under it.
  const note = list.querySelector('.chat-note');
  if (note) note.remove();
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const prev = (chatMsgs[ch] || []).filter((m) => m.id !== msg.id).pop();
  const day = chatDayStamp(msg.at);
  if (!prev || chatDayStamp(prev.at) !== day) {
    list.insertAdjacentHTML('beforeend', `<div class="chat-day-sep"><span>${esc(day)}</span></div>`);
  }
  list.insertAdjacentHTML('beforeend', chatBubbleHTML(ch, msg));
  wireChatBubbles(list, ch);
  if (nearBottom) chatScrollToBottom();
}

// ── Photo lightbox (tap a thumbnail → fetch the full image once) ──
function openChatLightbox(photoId) {
  const box = document.getElementById('chat-lightbox');
  if (!box || !chatSafePhotoId(photoId)) return; // never build a path from an unvetted id
  box.innerHTML = '<div class="chat-lightbox-spinner">📷 Loading…</div>';
  box.hidden = false;
  const close = () => { box.hidden = true; box.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  box.onclick = close;
  document.addEventListener('keydown', onKey);
  firebase.database().ref(dbPath('chatPhotos/' + photoId)).once('value')
    .then((snap) => {
      const rec = snap.val();
      if (box.hidden) return; // closed while loading
      const src = chatSafeImageSrc(rec && rec.data); // same data:-only guard as the thumbs
      if (src) {
        box.innerHTML = `<img class="chat-lightbox-img" src="${esc(src)}" alt="Full-size photo">`;
      } else {
        box.innerHTML = '<div class="chat-lightbox-spinner">This photo is gone.</div>';
      }
    })
    .catch(() => { if (!box.hidden) box.innerHTML = '<div class="chat-lightbox-spinner">Couldn\'t load the photo.</div>'; });
}

// ── Wiring (called once from init() via typeof guard) ─────────────
function wireChat() {
  const main = document.getElementById('chat-card-main');
  if (main) main.addEventListener('click', () => openChat(state.ui.chatChannel || 'general'));
  // Coming back to the tab while a channel is open counts as reading it.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && chatOpenNow()) markChannelSeen(state.ui.chatChannel);
  });
}
