self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  const txt = e.data ? e.data.text() : '(none)';
  e.waitUntil(self.clients.matchAll({includeUncontrolled:true}).then((cs) => { cs.forEach((c) => c.postMessage({got: txt})); return self.registration.showNotification('probe', {body: txt}); }));
});
