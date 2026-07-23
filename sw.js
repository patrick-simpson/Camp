// Notification-only service worker.
//
// This worker exists for exactly one reason: Chrome on Android refuses the
// `new Notification()` constructor from page JS ("Illegal constructor") and
// requires ServiceWorkerRegistration.showNotification() instead — and iOS
// (16.4+, installed-to-home-screen) only supports notifications through a
// service worker registration too. app.js's maybeNativeNotification() calls
// reg.showNotification() when this registration is available.
//
// ⚠️ Deliberately NO 'fetch' handler. This worker must never intercept
// network requests — the site's whole deploy/auto-reload scheme rides on
// plain HTTP caching plus ?v= cache-busting (see CLAUDE.md), and a caching
// service worker could pin stale code mid-camp. Do not add one.
//
// Kill switch, should this worker ever need to be retired: replace this file
// with one whose activate handler runs self.registration.unregister() and
// deploy — every client drops the registration on its next check.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Tapping a notification focuses the already-open scoreboard tab (or opens
// a fresh one if none is left).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => 'focus' in w);
      return win ? win.focus() : self.clients.openWindow('./');
    })
  );
});
