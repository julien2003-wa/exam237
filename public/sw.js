// Exam237 — service worker (application installable, page hors ligne).
const CACHE = 'exam237-shell-v12';
// Les sujets enregistrés par les élèves Premium : ne jamais les effacer lors d'une mise à jour.
const KEEP = ['exam237-offline-v1'];
const SHELL = ['/offline.html', '/logo.png', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE && !KEEP.includes(key))
            .map(key => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Pages : toujours le réseau (jamais une vieille version), la page hors ligne en secours.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/offline.html')) || Response.error()));
    return;
  }

  // Images stables : d'abord le cache.
  if (/\.(?:png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        cached =>
          cached ||
          fetch(request).then(response => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => null);
            }
            return response;
          })
      )
    );
  }
});
