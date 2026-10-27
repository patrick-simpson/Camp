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
// Sends handed to Firebase (or still compressing a photo) that haven't settled.
// The deploy auto-reload waits on this (chatComposerBusy, via app.js's
// reloadBlocked): the SDK's write queue lives in memory, and the composer is
// cleared the moment a message is sent, so a reload mid-send would lose it
// with nowhere to give the words back.
let chatSendsInFlight = 0;
let chatPhotosInFlight = 0;         // keeps 📷 disabled across a view rebuild
let chatSendTail = Promise.resolve(); // sends go out one after another (chatAtomicSend)
let chatLastAckAt = 0;                // device time the previous send was acknowledged

let chatMsgs = {};        // channelId -> [{id, at, byKey, name, text, thumb, photoId}] sorted by at
let chatReady = {};       // channelId -> true once the initial backlog has fully arrived
let chatDenied = false;   // rules refused chat (not pasted yet, or revoked)
let chatSyncStarted = false;
let chatViewBuiltFor = null; // which channel the full view DOM was last built for
// Half-typed messages by channel, IN MEMORY ONLY (never localStorage: a draft
// must not outlive a sign-out). The composer node now survives a channel switch
// (updateChatShell), and this carries each channel's text across switches and
// across closing the chat.
let chatDrafts = {};
// Push ids of messages THIS device just sent and that haven't settled. Lets
// appendChatBubble bring my own message into view even when I'd scrolled up to
// reply to something older — by id, not byKey, so the same account on a second
// device doesn't get yanked to the bottom too.
const chatOwnSendIds = new Set();
let chatSavedScrollY = 0;     // home-page scroll to restore when chat closes
let chatHistoryEntry = false; // a history entry of ours is on top (phone Back closes chat)
let chatLightboxSeq = 0;      // which lightbox open is current (late responses check it)
let chatLightboxOnKey = null; // the open lightbox's Escape handler

function chatChannels() {
  return (typeof CAMP !== 'undefined' && CAMP.chatChannels) || [];
}

function chatChannelById(id) {
  return chatChannels().find((c) => c.id === id) || null;
}

// "Sync is off" has to mean off for good. fbRef is only assigned once sign-in
// and the membership read finish, so on every cold start there's a stretch where
// syncEnabled() is false just because sync hasn't STARTED — and saying "off" then
// was false (and alarming: the whole message list read it on a reload with the
// chat persisted open). Genuinely off = no Firebase config on this device, the
// SDK never loaded, or the rules cancelled a listener; anything else is "loading".
function chatSyncOff() {
  if (syncEnabled()) return false;
  const cfg = window.FIREBASE_CONFIG;
  return !(cfg && cfg.apiKey) || !!sdkLoadFailed || !!syncDenied;
}

// app.js calls this (typeof-guarded) when the SDK definitively fails, so a
// "Loading…" card/list becomes the real sentence instead of waiting for the
// next 30 s tick (the open view isn't re-rendered by renderAll).
function onChatSyncStateChanged() {
  renderChatCard();
  if (chatOpenNow()) renderChatView(true);
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
  // The card or an open view may still be showing "sync is off" from before this
  // point (the SDK failed, retried and recovered): swap it for the loading state
  // now, not at the first backlog. A no-op when it already says Loading… —
  // updateChatShell writes through setHtmlIfChanged.
  renderChatCard();
  if (chatOpenNow()) renderChatView(true);
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
  // A live message that sorts FIRST isn't new: it's the window back-filling
  // (a delete or a refused send in a full channel pulls the 51st-newest
  // message back in as child_added). Announcing it would re-alert an old
  // message and append it at the bottom out of order. A genuinely new
  // message never sorts before everything already in the window.
  const backfill = !!chatReady[ch] && list.length > 1 && list[0].id === msg.id;
  // Drawn whenever its channel is the one built on screen — even with the tab
  // in the background, or it would be missing on return (and already marked
  // read). Only marking it seen needs the person to actually be looking.
  const shownHere = chatOpenNow() && chatViewBuiltFor === ch;
  if (chatReady[ch] && !backfill) {
    notifyChatMessage(ch, msg);
    if (shownHere) appendChatBubble(ch, msg);
    if (chatViewingChannel() === ch) markChannelSeen(ch);
  } else if (backfill && shownHere) {
    renderChatView(true); // lands at the top; the composer is carried across
  }
  // Announcements-channel messages also ride the top banner strip for 15
  // minutes (renderAnnouncements merges chatAnnouncementBanners in).
  if (ch === 'announcements' && typeof renderAnnouncements === 'function') renderAnnouncements();
  renderChatCard();
  renderChatBadges();
}

function onChatMsgRemoved(ch, snap) {
  const list = chatMsgs[ch] = chatMsgs[ch] || [];
  const i = list.findIndex((m) => m.id === snap.key);
  if (i > -1) list.splice(i, 1);
  // Remove just that bubble. In a full channel EVERY new message first
  // removes the oldest (the limitToLast window slides), and a full rebuild
  // here wiped the half-typed message and dropped the keyboard each time.
  if (chatOpenNow() && chatViewBuiltFor === ch) removeChatBubble(snap.key);
  renderChatCard();
  renderChatBadges();
  if (ch === 'announcements' && typeof renderAnnouncements === 'function') renderAnnouncements();
}

function removeChatBubble(id) {
  const listEl = document.getElementById('chat-list');
  if (!listEl) return;
  const bubble = Array.from(listEl.children || []).find((el) =>
    el.classList && el.classList.contains('chat-bubble') && el.dataset && el.dataset.msgId === id);
  if (!bubble) return;
  const before = bubble.previousElementSibling;
  const after = bubble.nextElementSibling;
  bubble.remove();
  // A day separator with no messages left under it goes too.
  if (before && before.classList.contains('chat-day-sep') && (!after || after.classList.contains('chat-day-sep'))) before.remove();
  if (!listEl.querySelector('.chat-bubble')) renderChatView(true); // emptied ⇒ show the "say hi" note
}

// ── Sending ───────────────────────────────────────────────────────
function chatSendAllowed() {
  const now = Date.now(); // device clock is right for a device-local gap
  if (now - chatLastSendAt < CHAT_MIN_SEND_MS) {
    // Never a silent no-op — a swallowed tap reads as a dead send button.
    showToast('One moment — sending a little too fast.');
    return false;
  }
  // Stamped again on the write ACK (chatAtomicSend). The server measures from
  // the PREVIOUS write's server timestamp, this measures from the client's own
  // clock: a slow photo compress could otherwise make the device think the gap
  // had elapsed when the server saw less, and the send would be refused.
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
  // Spacing runs on a MONOTONIC clock: a phone whose wall clock gets
  // corrected backwards mid-session would otherwise stall every later send
  // by the size of the jump. Clamped to [0, CHAT_MIN_SEND_MS] either way.
  const mono = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const stamp = () => { chatLastAckAt = mono(); chatLastSendAt = Date.now(); };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  const withoutStamp = {};
  Object.keys(updates).forEach((k) => { if (k !== rateKey) withoutStamp[k] = updates[k]; });
  // ONE send at a time, each starting a full CHAT_MIN_SEND_MS after the
  // previous one was acknowledged. The rules measure the 1 s floor from the
  // previous write's SERVER time, so a caption typed while a photo is still
  // uploading — or three messages queued while offline and replayed on
  // reconnect — used to arrive back to back and be refused, words and all
  // (reproduced against the emulator, 2026-10-26). Retry once after a beat
  // with the stamp (same push id, so never a duplicate); the stamp-less
  // attempt is only a last resort for a ruleset that predates chatRate.
  const go = () => wait(Math.min(CHAT_MIN_SEND_MS, chatLastAckAt ? chatLastAckAt + CHAT_MIN_SEND_MS - mono() : 0))
    .then(() => rootRef().update(updates)).then(stamp)
    .catch((err) => wait(CHAT_MIN_SEND_MS)
      .then(() => rootRef().update(updates)).then(stamp)
      .catch(() => rootRef().update(withoutStamp).then(stamp))
      .catch(() => { throw err; }));
  const p = chatSendTail.then(go, go);
  chatSendTail = p.catch(() => {});
  return p;
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
  chatSetDraft(ch, '');
  const id = firebase.database().ref(dbPath('chat/' + ch)).push().key;
  const rateKey = 'chatRate/' + myKey;
  if (chatSendsInFlight > 0) showToast('⏳ Sending right after the previous one…');
  chatSendsInFlight += 1;
  chatOwnSendIds.add(id);
  chatAtomicSend({ ['chat/' + ch + '/' + id]: msg, [rateKey]: firebase.database.ServerValue.TIMESTAMP }, rateKey)
    .then(() => chatNotifyPhones(ch, id, text), () => {
      // Look the composer up NOW: a refusal arrives after the optimistic
      // message was removed again, which may have rebuilt the view — the
      // element captured at send time could be detached by then.
      const box = document.getElementById('chat-input');
      if (box && state.ui.chatChannel === ch && !box.value) { box.value = text; chatSetDraft(ch, text); } // give the words back
      else if (!chatDrafts[ch]) chatSetDraft(ch, text); // they've moved on: the draft waits in that channel
      showToast("Couldn't send — check your connection and try again.");
    })
    .then(() => { chatOwnSendIds.delete(id); chatSendsInFlight = Math.max(0, chatSendsInFlight - 1); });
}

// True while a reload would cost someone their words: a message is being
// typed (focused, non-empty composer) or a send hasn't settled yet. Only a
// FOCUSED composer counts, so a stray character left behind can't hold a
// phone on an old build forever. Called (typeof-guarded) from app.js.
function chatComposerBusy() {
  const input = document.getElementById('chat-input');
  const typing = !!(input && document.activeElement === input && String(input.value || '').trim());
  return typing || chatSendsInFlight > 0;
}

// Once a message has landed, ask the phone-alert sender to buzz whoever
// should hear about it (push.js; optional, so typeof-guarded). Fire and
// forget — a push problem must never look like a failed send.
function chatNotifyPhones(ch, msgId, text) {
  try {
    if (typeof pushNotifyChat === 'function') pushNotifyChat(ch, msgId, text || '');
  } catch (e) { console.warn('[chat] phone alert request failed', e); }
}

// Photo first, message second: a half-failure leaves an orphaned photo
// (harmless, invisible) rather than a message pointing at nothing.
function sendChatPhoto(ch, file) {
  const myKey = identityKey(authUser);
  if (!file || !myKey || typeof firebase === 'undefined') return;
  if (!chatSendAllowed()) return;
  const btn = document.getElementById('chat-photo-btn');
  if (btn) btn.setAttribute('disabled', '');
  chatSendsInFlight += 1;
  chatPhotosInFlight += 1;
  makeChatImages(file)
    .then(({ full, thumb }) => {
      const photoId = firebase.database().ref(dbPath('chatPhotos')).push().key;
      const msgId = firebase.database().ref(dbPath('chat/' + ch)).push().key;
      const rateKey = 'chatRate/' + myKey;
      chatOwnSendIds.add(msgId);
      const settled = () => chatOwnSendIds.delete(msgId);
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
      }, rateKey).then(() => { settled(); chatNotifyPhones(ch, msgId, ''); }, (err) => { settled(); throw err; });
    })
    .catch(() => showToast("Couldn't send the photo — try a different one, or check your connection."))
    .then(() => {
      chatSendsInFlight = Math.max(0, chatSendsInFlight - 1);
      chatPhotosInFlight = Math.max(0, chatPhotosInFlight - 1);
      // The view may have been rebuilt meanwhile — re-enable the CURRENT button.
      const now = document.getElementById('chat-photo-btn');
      if (now && !chatPhotosInFlight) now.removeAttribute('disabled');
    });
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
        .orderByChild('ch').equalTo(ch).limitToFirst(25).once('value')
        .then((snap) => {
          const updates = {};
          let n = 0;
          snap.forEach((child) => { updates[child.key] = null; n++; });
          if (!n) return null;
          return firebase.database().ref(dbPath('chatPhotos')).update(updates)
            .then(() => (n === 25 ? removeBatch() : null)); // a short page is the last one
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
  // Both the name as typed and its merged spelling: a member row still reading
  // "Alysa" must catch a message that says "Alyssa" (see canonicalCounselorName).
  const myNames = [];
  [memberName, state.identity].filter(Boolean).forEach((n) => {
    myNames.push(String(n).toLowerCase(), String(canonicalCounselorName(n)).toLowerCase());
  });
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
  // serverNow() can run a little BEHIND a message's server stamp (the offset
  // misses the handshake's one-way latency), which would leave the message
  // being read counted as unread. Never mark less than the newest message on
  // screen — capped just past now, so a skewed future `at` can't pre-mark
  // the next minute of messages as seen.
  const shown = chatMsgs[ch] || [];
  const newest = shown.length ? Math.min(shown[shown.length - 1].at || 0, serverNow() + 5000) : 0;
  seen[ch] = Math.max(serverNow(), newest);
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

// The one writer of the subscription map. Phone alerts (push.js) use these
// same subscriptions for "every message in this channel", so a change here —
// from the 🔔 bell or from the Phone alerts drawer — also rewrites this
// phone's push record (pushPrefsChanged, typeof-guarded: push.js is optional).
function setChatSub(ch, on) {
  if (!chatChannelById(ch)) return;
  const subs = readChatSubs();
  subs[ch] = !!on;
  try { localStorage.setItem(lsKey(CHAT_SUBS_KEY), JSON.stringify(subs)); } catch (e) { /* fine */ }
  if (typeof pushPrefsChanged === 'function') pushPrefsChanged();
}

function toggleChatSub(ch) {
  const on = !chatSubscribed(ch);
  setChatSub(ch, on);
  const c = chatChannelById(ch);
  showToast(on
    ? `🔔 You'll get an alert for every message in ${c ? c.short : ch}.`
    : `🔕 ${c ? c.short : ch} muted — you'll still get an alert when someone mentions you.`,
    { mine: on });
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
      // Until the member directory lands chatAuthorName fails closed to the
      // sender's raw email — a banner that flashed it then flipped to a name.
      // An empty by-line is simply omitted by renderAnnouncements, and the
      // members listener's renderAll() fills the name in.
      by: memberDirectoryLoaded ? chatAuthorName(m) : '',
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
  // Every OS notification below is tagged 'chat-<msgId>' — the SAME tag the
  // phone-alert push for this message carries (push.js / sw.js), so a phone
  // with Camp open in the background plus a push shows ONE notification.
  if (ch === 'announcements' && chatSubscribed(ch)) {
    // An announcement is for everyone (subscribed by default) — same
    // treatment as the announcement banner alerts (toast + OS notification
    // + bright chime + buzz).
    if (!viewing) showToast('📣 ' + preview);
    if (state.notify) {
      maybeNativeNotification('📣 Chat announcement', preview, 'chat-' + msg.id);
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
      maybeNativeNotification('💬 You were mentioned in Chat', preview, 'chat-' + msg.id);
      if (navigator.vibrate) navigator.vibrate(150);
    }
    return;
  }
  if (chatSubscribed(ch)) {
    if (!viewing) showToast(`${c ? c.emoji : '💬'} ${preview}`);
    if (state.notify) {
      maybeNativeNotification(`${c ? c.emoji + ' ' : ''}Chat · ${c ? c.short : ch}`, preview, 'chat-' + msg.id);
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
  // The takeover hides the rest of the page, so the document collapses to the
  // chat's height and the browser clamps scrollY to 0 — remember where the
  // person was so closeChat can put them back at the Chat card.
  if (!chatOpenNow()) chatSavedScrollY = (typeof window !== 'undefined' && window.scrollY) || 0;
  chatParkDraft();
  // Push the Back entry BEFORE the page collapses: the browser files the
  // current scroll position with the entry it's leaving, and a Back (which
  // restores that position) would otherwise restore the clamped 0.
  chatHistoryPush();
  state.ui.chatOpen = true;
  state.ui.chatChannel = chatChannelById(ch) ? ch : (state.ui.chatChannel || 'general');
  if (state.ui.view === 'settings') state.ui.view = 'home'; // one takeover at a time
  saveState();
  chatViewBuiltFor = null; // force a fresh build
  renderAll();
  markChannelSeen(state.ui.chatChannel);
}

// Whatever is in the composer is that channel's draft, kept for when the view
// is rebuilt (closing and reopening chat, or a notification tap that jumps
// channels) — the person's half-typed reply shouldn't die with the DOM.
function chatParkDraft() {
  const input = document.getElementById('chat-input');
  if (chatViewBuiltFor && input) chatSetDraft(chatViewBuiltFor, input.value || '');
}

function closeChat() {
  chatParkDraft();
  state.ui.chatOpen = false;
  saveState();
  chatViewBuiltFor = null;
  renderAll();
  // Layout is synchronous after renderAll (the home panels write through
  // setHtmlIfChanged, so their heights are intact), so this lands correctly.
  if (chatSavedScrollY && typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
    window.scrollTo(0, chatSavedScrollY); // positional form: no smooth-scroll CSS here, so it's instant
  }
  chatSavedScrollY = 0;
  chatHistoryPop();
}

// ── Phone Back closes the chat ────────────────────────────────────
// The takeover is in-page state with no history entry, so Android Back / an iOS
// edge-swipe left Camp altogether instead of closing it. Opening pushes one
// entry (same URL); the popstate listener (wireChat) closes the chat when it's
// popped; closing from the ← Camp pill pops it back off so the stack never
// grows. Chat only — settings and game detail still have no entry of their own.
function chatHistoryPush() {
  if (typeof history === 'undefined' || !history.pushState || chatHistoryEntry) return;
  try { history.pushState({ campChat: 1 }, ''); chatHistoryEntry = true; } catch (e) { /* no history API: Back just leaves, as before */ }
}

function chatHistoryPop() {
  if (!chatHistoryEntry) return;
  chatHistoryEntry = false;
  try { history.back(); } catch (e) { /* fine */ }
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
  // renderAll can close the chat without us (editors hid the card, or the
  // builder took over); our history entry would then sit on top and the next
  // phone Back would visibly do nothing. Hand it back. Idempotent with
  // closeChat's own pop (the flag drops first), and runs on every renderAll
  // and the 30 s tick, so a stale entry never lingers.
  if (!chatOpenNow() && chatHistoryEntry) chatHistoryPop();
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
  if (chatSyncOff()) {
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
  if (chatSyncOff()) return `<p class="muted chat-note">Chat needs live sync, which is off on this device.</p>`;
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

// The view is BUILT once per open (head, tabs, list, composer) and after that a
// forced render only UPDATES it in place: the active tab, title, bell, the
// composer placeholder and the list's contents. Rebuilding the whole shell on
// every channel tap / bell toggle / directory update re-created the ← Camp pill
// (replaying its slide-in), reset the tab strip's scroll, and detached the
// focused composer — which iOS won't re-focus outside a tap, so the keyboard
// dropped. renderAll runs on every synced update, so a non-forced call is a
// no-op while the channel is already built; live messages append incrementally
// (appendChatBubble).
function renderChatView(force) {
  const view = document.getElementById('chat-view');
  if (!view) return;
  const ch = chatCurrentChannel();
  if (!force && chatViewBuiltFor === ch) { renderChatBadges(); return; }
  const c = chatChannelById(ch) || chatChannels()[0] || { id: ch, label: ch, short: ch, emoji: '💬' };
  const prev = chatViewBuiltFor;
  // The 🧹 button is the one shell part that depends on who's looking, so a
  // role change rebuilds rather than patches.
  const live = prev && view.dataset.chatShell === chatShellSig()
    && document.getElementById('chat-list') && document.getElementById('chat-input');
  if (live) updateChatShell(view, ch, c, prev);
  else buildChatShell(view, ch, c, prev);
}

function chatShellSig() {
  return canEdit() ? 'editor' : 'viewer';
}

// Read at call time by every handler wired once per build: the composer and
// header outlive a channel switch now, so a handler closing over the build-time
// channel would post to the wrong one.
function chatCurrentChannel() {
  return state.ui.chatChannel || 'general';
}

function chatSetDraft(ch, text) {
  if (text) chatDrafts[ch] = text;
  else delete chatDrafts[ch];
}

function chatBellAttrs(subbed) {
  return {
    icon: subbed ? '🔔' : '🔕',
    title: subbed ? 'Subscribed — every message here alerts you' : 'Muted — only mentions alert you',
    label: subbed ? 'Unsubscribe from this channel' : 'Subscribe to this channel',
  };
}

// The header names the open channel by its SHORT label: the full "Announcements
// & Important Info" was ellipsized at every phone width between the pill, the
// bell and (for editors) the broom.
function paintChatHeader(view, ch, c) {
  const title = view.querySelector('.chat-title');
  const text = `${c.emoji} ${c.short}`;
  if (title && title.textContent !== text) title.textContent = text;
  const bell = view.querySelector('#chat-sub-btn');
  if (bell) {
    const subbed = chatSubscribed(ch);
    const a = chatBellAttrs(subbed);
    bell.classList.toggle('chat-sub-on', subbed);
    bell.title = a.title;
    bell.setAttribute('aria-label', a.label);
    if (bell.textContent !== a.icon) bell.textContent = a.icon;
  }
}

// Centre the open channel's tab when the strip is scrollable and the tab is
// clipped (by rects, not scrollIntoView, which would scroll the page too).
function chatRevealActiveTab(view) {
  const strip = view.querySelector('.chat-tabs');
  const tab = strip && strip.querySelector('.chat-tab-active');
  if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return;
  const s = strip.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  if (t.left >= s.left && t.right <= s.right) return; // already fully in view
  strip.scrollLeft += (t.left - s.left) - (s.width - t.width) / 2;
}

function updateChatShell(view, ch, c, prev) {
  const list = document.getElementById('chat-list');
  const input = document.getElementById('chat-input');
  const sameCh = prev === ch;
  // A same-channel refresh (directory arrived, a back-fill, the view emptied)
  // keeps the person's place in the history; a channel switch lands on the
  // newest message.
  const keepScroll = sameCh && (list.scrollHeight - list.scrollTop - list.clientHeight >= 80)
    ? list.scrollTop : null;
  if (!sameCh) {
    // The composer is shared by every channel: park this channel's draft and
    // bring the target's back.
    chatSetDraft(prev, input.value);
    input.value = chatDrafts[ch] || '';
  }
  chatViewBuiltFor = ch;
  paintChatHeader(view, ch, c);
  view.querySelectorAll('.chat-tab').forEach((t) => t.classList.toggle('chat-tab-active', t.dataset.ch === ch));
  input.placeholder = `Message ${c.short}…`;
  // setHtmlIfChanged: a forced render that changes nothing (a members snapshot
  // that didn't touch names) must not re-create the bubbles — every thumbnail
  // would re-decode and blink.
  const changed = setHtmlIfChanged(list, chatListHTML(ch));
  if (changed) wireChatBubbles(list, ch);
  renderChatBadges();
  chatRevealActiveTab(view);
  if (changed || !sameCh) {
    if (keepScroll != null) list.scrollTop = keepScroll;
    else chatScrollToBottom();
  }
}

function buildChatShell(view, ch, c, prev) {
  // Reached on open, and when the shell is gone or the viewer's role changed.
  // A rebuild of the SAME channel must still not cost the person their
  // keyboard, caret or place in the history.
  const sameCh = prev === ch;
  const oldInput = sameCh ? document.getElementById('chat-input') : null;
  const oldList = sameCh ? document.getElementById('chat-list') : null;
  const carry = oldInput ? {
    value: oldInput.value || '',
    focused: document.activeElement === oldInput,
    start: oldInput.selectionStart, end: oldInput.selectionEnd,
  } : null;
  const keepScroll = oldList && (oldList.scrollHeight - oldList.scrollTop - oldList.clientHeight >= 80)
    ? oldList.scrollTop : null;
  chatViewBuiltFor = ch;

  // The label is visually hidden under 480px (styles.css) but stays in the
  // DOM so the tab keeps its accessible name.
  const tabs = chatChannels().map((t) => `
    <button type="button" class="chat-tab${t.id === ch ? ' chat-tab-active' : ''}" data-ch="${t.id}">
      <span class="chat-tab-emoji">${t.emoji}</span><span class="chat-tab-label">${esc(t.short)}</span>
      <span class="chat-tab-badge" data-ch="${t.id}" hidden></span>
    </button>`).join('');

  const subbed = chatSubscribed(ch);
  const bell = chatBellAttrs(subbed);
  const listHTML = chatListHTML(ch);
  view.innerHTML = `
    <div class="chat-head">
      <button id="chat-back-btn" class="back-pill"><span class="back-pill-arrow" aria-hidden="true">←</span> Camp</button>
      <h2 class="chat-title">${c.emoji} ${esc(c.short)}</h2>
      <button id="chat-sub-btn" class="chat-sub-btn${subbed ? ' chat-sub-on' : ''}"
        title="${bell.title}"
        aria-label="${bell.label}">${bell.icon}</button>
      ${canEdit() ? '<button id="chat-clear-btn" class="link-btn danger-link chat-clear-btn" title="Clear this channel">🧹</button>' : ''}
    </div>
    <div class="chat-tabs">${tabs}</div>
    <div id="chat-list" class="chat-list">${listHTML}</div>
    <div class="chat-composer">
      <input type="file" id="chat-photo-input" accept="image/*" hidden>
      <button type="button" id="chat-photo-btn" class="chat-photo-btn" aria-label="Send a photo">📷</button>
      <input type="text" id="chat-input" class="chat-text-input" placeholder="Message ${esc(c.short)}…" maxlength="${CHAT_TEXT_MAX}" autocomplete="off">
      <button type="button" id="chat-send-btn" class="chat-send-btn" aria-label="Send">➤</button>
    </div>`;
  view.dataset.chatShell = chatShellSig();
  // Seed setHtmlIfChanged's cache so the first in-place update compares against
  // what's actually on screen instead of rewriting it once.
  const builtList = document.getElementById('chat-list');
  if (builtList) { builtList.__html = listHTML; builtList.__dom = builtList.innerHTML; }

  renderChatBadges();
  wireChatView(ch);
  const input = document.getElementById('chat-input');
  if (input) {
    const text = carry ? carry.value : (chatDrafts[ch] || '');
    if (text) input.value = text;
    if (carry && carry.focused) {
      input.focus();
      try { if (carry.start != null) input.setSelectionRange(carry.start, carry.end); } catch (e) { /* fine */ }
    }
  }
  const photoBtn = document.getElementById('chat-photo-btn');
  if (photoBtn && chatPhotosInFlight) photoBtn.setAttribute('disabled', '');
  chatRevealActiveTab(view);
  const listEl = document.getElementById('chat-list');
  if (listEl && keepScroll != null) listEl.scrollTop = keepScroll;
  else chatScrollToBottom();
}

// Wired ONCE per build, and the composer / header outlive a channel switch
// (updateChatShell), so everything here resolves the channel at call time via
// chatCurrentChannel(). Only the bubbles close over `ch`, and the list is
// rewired whenever its channel changes.
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
  if (send) {
    send.addEventListener('click', () => sendChatMessage(chatCurrentChannel()));
    // Pressing the button must not steal focus from the input: on Android the
    // keyboard dropped after every message and had to be re-opened with a tap.
    // preventDefault on pointerdown/mousedown keeps focus where it was; the
    // click still fires. (mousedown covers browsers without pointer events.)
    send.addEventListener('pointerdown', (e) => e.preventDefault());
    send.addEventListener('mousedown', (e) => e.preventDefault());
  }
  const input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(chatCurrentChannel()); });
    input.addEventListener('input', () => chatSetDraft(chatCurrentChannel(), input.value));
  }
  const photoBtn = document.getElementById('chat-photo-btn');
  const photoInput = document.getElementById('chat-photo-input');
  if (photoBtn && photoInput) {
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
      if (photoInput.files && photoInput.files[0]) sendChatPhoto(chatCurrentChannel(), photoInput.files[0]);
      photoInput.value = '';
    });
  }
  const clearBtn = document.getElementById('chat-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', () => clearChatChannel(chatCurrentChannel()));
  const subBtn = document.getElementById('chat-sub-btn');
  if (subBtn) subBtn.addEventListener('click', () => toggleChatSub(chatCurrentChannel()));
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

// Pin the list to its newest message. A thumbnail has no intrinsic size until
// it decodes, so a pin made right after inserting one is stale a moment later:
// the image grows and pushes the newest messages thousands of px below the fold
// (a 50-photo channel opened ~2600px short). So each thumb still loading re-pins
// when it lands — but only while the person hasn't scrolled since, or reading
// up through a slow load would snap them back down.
function chatScrollToBottom() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  list.scrollTop = list.scrollHeight;
  list.__chatPinned = true;
  if (!list.__chatPinWired) {
    list.__chatPinWired = true;
    const unpin = () => { list.__chatPinned = false; };
    ['touchstart', 'wheel', 'pointerdown'].forEach((ev) => list.addEventListener(ev, unpin, { passive: true }));
  }
  list.querySelectorAll('.chat-thumb').forEach((img) => {
    if (img.complete) return;
    const repin = () => { if (list.__chatPinned) list.scrollTop = list.scrollHeight; };
    img.addEventListener('load', repin, { once: true });
    img.addEventListener('error', repin, { once: true });
  });
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
  // My own message always scrolls into view — replying from higher up the
  // history otherwise cleared the composer and showed nothing happening.
  if (nearBottom || chatOwnSendIds.has(msg.id)) chatScrollToBottom();
}

// ── Photo lightbox (tap a thumbnail → fetch the full image once) ──
function openChatLightbox(photoId) {
  const box = document.getElementById('chat-lightbox');
  if (!box || !chatSafePhotoId(photoId)) return; // never build a path from an unvetted id
  box.innerHTML = '<div class="chat-lightbox-spinner">📷 Loading…</div>';
  box.hidden = false;
  // The box is shared by every open, so a late response must check it's still
  // the one being shown: tap A (slow), close, tap B — A's answer used to land
  // on top of B. The previous open's Escape handler goes too (a reopen without
  // a close would otherwise leave it listening).
  const mine = ++chatLightboxSeq;
  if (chatLightboxOnKey) document.removeEventListener('keydown', chatLightboxOnKey);
  const close = () => { box.hidden = true; box.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  chatLightboxOnKey = onKey;
  box.onclick = close;
  document.addEventListener('keydown', onKey);
  firebase.database().ref(dbPath('chatPhotos/' + photoId)).once('value')
    .then((snap) => {
      const rec = snap.val();
      if (box.hidden || mine !== chatLightboxSeq) return; // closed (or replaced) while loading
      const src = chatSafeImageSrc(rec && rec.data); // same data:-only guard as the thumbs
      if (src) {
        box.innerHTML = `<img class="chat-lightbox-img" src="${esc(src)}" alt="Full-size photo">`;
      } else {
        box.innerHTML = '<div class="chat-lightbox-spinner">This photo is gone.</div>';
      }
    })
    .catch(() => { if (!box.hidden && mine === chatLightboxSeq) box.innerHTML = '<div class="chat-lightbox-spinner">Couldn\'t load the photo.</div>'; });
}

// ── Wiring (called once from init() via typeof guard) ─────────────
function wireChat() {
  const main = document.getElementById('chat-card-main');
  if (main) main.addEventListener('click', () => openChat(state.ui.chatChannel || 'general'));
  // Coming back to the tab while a channel is open counts as reading it.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && chatOpenNow()) markChannelSeen(state.ui.chatChannel);
  });
  // Phone Back closes the chat (chatHistoryPush). Our entry carries
  // {campChat:1}; popping to one without it while chat is open means Back.
  if (typeof history !== 'undefined' && history.pushState) {
    chatHistoryEntry = !!(history.state && history.state.campChat);
    window.addEventListener('popstate', (e) => {
      const mine = !!(e.state && e.state.campChat);
      chatHistoryEntry = mine;
      if (!mine && chatOpenNow()) closeChat();
    });
    // Reloaded with the chat persisted open: give Back something to pop.
    if (chatOpenNow() && !chatHistoryEntry) chatHistoryPush();
  }
}
