// TOWER Service Worker
//
// Philosophy: Tower is an admin dashboard. Stale data is worse than no data.
// We do NOT cache API responses. We DO precache the shell so the app can
// boot offline (and display "Sin conexión" via the network failure path).
//
// Versioning: bump CACHE_VERSION to invalidate the precache on next deploy.

const CACHE_VERSION = 'tower-v11';
const PRECACHE = [
  '/tower/',
  '/tower/index.html',
  '/tower/manifest.json',
  '/tower/icon-192.png',
  '/tower/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('tower-') && k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Same-origin only
  if (url.origin !== self.location.origin) return;

  // API: network-only, never cached. If offline → fail (the page handles it).
  if (url.pathname.startsWith('/api/')) {
    return; // let browser handle it natively
  }

  // Navigations (HTML): network-first, fall back to cached shell.
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Update the cached shell on every successful navigation
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/tower/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/tower/index.html').then((r) => r || caches.match('/tower/')))
    );
    return;
  }

  // Static assets (icons, manifest, etc.): stale-while-revalidate
  if (req.method === 'GET' && url.pathname.startsWith('/tower/')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        return cached || (await network) || new Response('', { status: 504 });
      })
    );
    return;
  }
});
