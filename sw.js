// CoachAI service worker — minimal scope:
//   1. Pre-cache a tiny shell (offline page + logos) so we can always show
//      a branded "sin conexión" screen instead of the browser's ugly error.
//   2. For navigation requests (HTML pages), try network first; if it fails,
//      fall back to the cached offline.html.
//   3. Everything else (API, JS, CSS, images) passes straight through to the
//      network — no aggressive caching to avoid stale-app problems.
//
// We deliberately do NOT cache index.html or runtime scripts. The app is
// single-file and updates often; caching the shell would mean some users see
// an old build for hours after a deploy. Keep updates instant.

const CACHE = 'coachai-shell-v2';
const SHELL = [
  '/offline.html',
  '/logo.png',
  '/logo-icon.png',
  // Fotos ambientales de Mi Alimentación V2 (assets propios, inmutables —
  // si algún día cambian, renombrar archivo + bump de CACHE). ~460KB total.
  '/img/alim/desayuno-1.webp', '/img/alim/desayuno-2.webp', '/img/alim/desayuno-3.webp',
  '/img/alim/almuerzo-1.webp', '/img/alim/almuerzo-2.webp', '/img/alim/almuerzo-3.webp',
  '/img/alim/merienda-1.webp', '/img/alim/merienda-2.webp', '/img/alim/merienda-3.webp',
  '/img/alim/cena-1.webp',     '/img/alim/cena-2.webp',     '/img/alim/cena-3.webp',
  '/img/home/home-hero.webp',  '/img/home/fcard-ai.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL))
      .catch(err => console.warn('[sw] precache failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Drop any old cache versions when we bump CACHE name
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Assets inmutables propios (/img/: fotos de alimentación + fondos del home):
  // cache-first — precacheados en install y, si faltara alguno, se cachea al
  // primer uso. Son la ÚNICA excepción al pass-through: si alguna vez cambian,
  // se renombra el archivo + bump de CACHE (nunca se pisan in-place).
  if (req.method === 'GET') {
    let path = '';
    try { const u = new URL(req.url); if (u.origin === self.location.origin) path = u.pathname; } catch (e) {}
    if (path.startsWith('/img/')) {
      event.respondWith(
        caches.match(req).then(hit => hit || fetch(req).then(resp => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return resp;
        }))
      );
      return;
    }
  }

  // Only intercept top-level navigation (HTML pages). Everything else
  // (CSS/JS/api) goes to the network with no SW involvement.
  if (req.mode !== 'navigate') return;

  event.respondWith(
    fetch(req).catch(() => caches.match('/offline.html'))
  );
});

// ── Web Push ────────────────────────────────────────────────────────────────
// Show a notification when a push arrives (incluso con la app cerrada). El
// payload viaja como JSON: { title, body, url, tag, icon }. Si por algún motivo
// no hay payload, mostramos un fallback genérico (los navegadores EXIGEN mostrar
// algo sí o sí cuando hay permiso, por eso userVisibleOnly:true del lado cliente).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'CoachAI';
  const options = {
    body: data.body || '',
    icon: data.icon || '/logo-icon.png',
    badge: data.badge || '/logo-icon.png',
    tag: data.tag || undefined,           // misma tag = reemplaza, no apila
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación: enfocar la pestaña/PWA si ya está abierta, si no,
// abrir la app en la URL que mandó el payload.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.focus(); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
