// Replaces the old Bankhead Hunt service worker: clears its caches, unregisters itself and reloads open windows,
// so an installed copy stops serving the old app and shows the "moved to Stand Point" page instead.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
