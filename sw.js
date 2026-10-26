// Notification-only service worker.
//
// This worker exists for two reasons, both about notifications:
//  1. Chrome on Android refuses the `new Notification()` constructor from
//     page JS ("Illegal constructor") and requires
//     ServiceWorkerRegistration.showNotification() instead — and iOS (16.4+,
//     installed-to-home-screen) only supports notifications through a service
//     worker registration too. app.js's maybeNativeNotification() calls
//     reg.showNotification() when this registration is available.
//  2. Phone alerts (Web Push — see push.js and push-worker/): a push arrives
//     HERE while Camp is closed, and this worker turns it into the
//     notification. iOS revokes push permission from a site whose pushes ever
//     show nothing, so the push handler below ALWAYS shows one, even for a
//     payload it can't read.
//
// ⚠️ Deliberately NO 'fetch' handler. This worker must never intercept
// network requests — the site's whole deploy/auto-reload scheme rides on
// plain HTTP caching plus ?v= cache-busting (see CLAUDE.md), and a caching
// service worker could pin stale code mid-camp. Do not add one.
//
// It is registered as sw.js?v=<PUSH_SW_VERSION>[&push=<Worker URL>]
// (push.js), with updateViaCache:'none' so every update check refetches it.
// The push= parameter is how this file learns where the alert sender lives —
// it can't read push.js — for the one request it ever makes itself
// (pushsubscriptionchange, below).
//
// Kill switch, should this worker ever need to be retired: replace this file
// with one whose activate handler runs self.registration.unregister() and
// deploy — every client drops the registration on its next check.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ── Push payload → notification ───────────────────────────────────
// Pure (no globals — `now` is passed in) so tests can load this file with a
// stub `self` and check it. The payload is JSON the sender encrypted for this
// device, but it's still treated as untrusted shape: every field is typed,
// capped, and defaulted, so a sender bug can never become a silent push.
const CAMP_PUSH_KINDS = ['announcement', 'mention', 'channel', 'alert', 'urgent', 'block', 'test'];
const CAMP_PUSH_FALLBACK = { title: 'Camp', body: 'Something new — tap to open.' };

function campNotificationFromPayload(payload, now) {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  if (!p || !str(p.title, 80)) {
    // Unreadable or empty: still a notification (see the header), just a
    // generic one that opens the app.
    return {
      title: CAMP_PUSH_FALLBACK.title,
      options: {
        body: (p && str(p.body, 300)) || CAMP_PUSH_FALLBACK.body,
        tag: 'camp-push',
        icon: 'apple-touch-icon.png',
        badge: 'apple-touch-icon.png',
        data: { open: '', camp: '', kind: '' },
        vibrate: [200, 100, 200],
      },
      payload: { kind: '', camp: '', title: CAMP_PUSH_FALLBACK.title, body: CAMP_PUSH_FALLBACK.body, open: '', urgent: false, tag: 'camp-push' },
    };
  }
  const kind = CAMP_PUSH_KINDS.includes(p.kind) ? p.kind : '';
  const urgent = p.urgent === true || kind === 'urgent';
  const title = str(p.title, 80);
  const body = str(p.body, 300);
  // The tag collapses duplicates: the page's own in-app notification for the
  // same chat message uses the same 'chat-<msgId>', so a backgrounded open
  // app plus a push still show ONE notification.
  const tag = typeof p.tag === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(p.tag) ? p.tag : 'camp-' + (kind || 'push');
  const open = typeof p.open === 'string' && /^(chat:[a-z0-9_-]{1,32}|schedule)$/.test(p.open) ? p.open : '';
  const camp = p.camp === 'junior' || p.camp === 'senior' ? p.camp : '';
  const ts = Number(p.ts);
  const options = {
    body,
    tag,
    // renotify needs a tag (it always has one here). Director alerts buzz
    // again even when replacing an earlier one; chat updates stay quiet.
    renotify: urgent || kind === 'alert',
    requireInteraction: urgent,
    icon: 'apple-touch-icon.png',
    badge: 'apple-touch-icon.png',
    data: { open, camp, kind },
    vibrate: urgent ? [400, 150, 400, 150, 400] : [200, 100, 200],
  };
  if (Number.isFinite(ts) && ts > 0) options.timestamp = ts;
  else if (Number.isFinite(now) && now > 0) options.timestamp = now;
  return { title, options, payload: { kind, camp, title, body, open, urgent, tag } };
}

const CAMP_CHAT_KINDS = ['announcement', 'mention', 'channel'];

self.addEventListener('push', (event) => {
  let raw = null;
  try { raw = event.data ? event.data.json() : null; } catch (e) { raw = null; }
  const n = campNotificationFromPayload(raw, Date.now());
  const show = self.registration.showNotification(n.title, n.options)
    // A rejected showNotification (an option this browser dislikes) must
    // still end in SOMETHING on screen — see the header.
    .catch(() => self.registration.showNotification(CAMP_PUSH_FALLBACK.title, { body: n.options.body || CAMP_PUSH_FALLBACK.body, tag: n.options.tag }));
  // Tell any open Camp tab, so a director alert also shows in-app.
  const tell = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((wins) => wins.forEach((w) => { try { w.postMessage({ type: 'camp-push', payload: n.payload }); } catch (e) { /* closing tab */ } }))
    .catch(() => {});
  // Home-screen badge for chat (a dot — the real count is the page's job
  // once it opens).
  let badge = Promise.resolve();
  try {
    if (CAMP_CHAT_KINDS.includes(n.payload.kind) && self.navigator && self.navigator.setAppBadge) {
      badge = self.navigator.setAppBadge().catch(() => {});
    }
  } catch (e) { /* unsupported */ }
  event.waitUntil(Promise.all([show, tell, badge]));
});

// Tapping a notification focuses the already-open scoreboard tab and tells
// it what to open (a chat channel, the schedule) — or opens a fresh one with
// ?open=… for the page to act on once it has signed in.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const open = typeof data.open === 'string' ? data.open : '';
  const camp = typeof data.camp === 'string' ? data.camp : '';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // The app itself, not the presenter pages that share this scope.
      const isApp = (w) => {
        try { return !/\/(current-standings|stalling)\.html$/.test(new URL(w.url).pathname); } catch (e) { return true; }
      };
      const win = wins.find((w) => 'focus' in w && isApp(w));
      if (win) {
        if (open) { try { win.postMessage({ type: 'camp-open', open, camp }); } catch (e) { /* focus still helps */ } }
        return win.focus().catch(() => {});
      }
      let url = './';
      if (open) url += '?open=' + encodeURIComponent(open) + (camp ? '&camp=' + encodeURIComponent(camp) : '');
      return self.clients.openWindow(url);
    })
  );
});

// ── Subscription rotation ─────────────────────────────────────────
// Browsers occasionally replace a push subscription on their own. The new
// endpoint has to reach the sender or this phone silently stops getting
// alerts until Camp is next opened (push.js's self-heal also repairs it then).
// Best-effort: the page is the real backstop.
function campPushServiceUrl() {
  try {
    const u = new URL(self.location.href).searchParams.get('push') || '';
    const parsed = new URL(u);
    const local = parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(parsed.hostname);
    if (parsed.protocol !== 'https:' && !local) return '';
    return (parsed.origin + parsed.pathname).replace(/\/+$/, '');
  } catch (e) { return ''; }
}

function campB64url(buf) {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const base = campPushServiceUrl();
    const oldSub = event.oldSubscription || null;
    if (!base || !oldSub || !oldSub.endpoint) return; // nothing to match the record by
    let sub = event.newSubscription || null;
    if (!sub) {
      const key = oldSub.options && oldSub.options.applicationServerKey;
      if (!key) return;
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    await fetch(base + '/resubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldEndpoint: oldSub.endpoint,
        endpoint: sub.endpoint,
        p256dh: campB64url(sub.getKey('p256dh')),
        auth: campB64url(sub.getKey('auth')),
      }),
    });
  })().catch(() => { /* the page's self-heal repairs it on next open */ }));
});
