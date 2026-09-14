// SmartMaps service worker.
//
// The app has no backend, so once these files are cached the whole planner runs
// with no connection at all — patient list, weekly clustering, guided calling,
// route links. Only geocoding a NEW address and drawing map tiles need Google,
// and those requests are deliberately left alone (never cached, never faked).

const VERSION = 'v1';
const SHELL_CACHE = `smartmaps-shell-${VERSION}`;
const ASSET_CACHE = `smartmaps-assets-${VERSION}`;

// Resolved against the SW's own location, so this works under /smartmaps/.
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('smartmaps-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything cross-origin (Google Maps, geocoding) goes straight to the network.
  // Caching map data would both break freshness and bloat storage.
  if (url.origin !== self.location.origin) return;

  // Page loads: network first so a deploy is picked up promptly, falling back to
  // the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return resp;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Build assets are content-hashed, so a cache hit is always correct.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((resp) => {
          if (resp.ok && resp.type === 'basic') {
            const copy = resp.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(request, copy));
          }
          return resp;
        })
    )
  );
});
