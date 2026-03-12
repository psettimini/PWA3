/* ============================================================
   sw.js — Service Worker PERFORMANCE OPTIMIZADO
   ============================================================ */

const CACHE_VERSION = 'gastos-pwa-v1.1.0';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const CDN_CACHE = `${CACHE_VERSION}-cdn`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
];

/* PERF: CDN assets que se cachean para carga rápida offline/repetida */
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

/* Dominios CDN conocidos y confiables */
const TRUSTED_CDN_ORIGINS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) =>
        cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' })))
      ),
      /* PERF: pre-cachear CDN assets durante install */
      caches.open(CDN_CACHE).then((cache) =>
        Promise.allSettled(
          CDN_ASSETS.map((url) =>
            fetch(url, { mode: 'cors' }).then((res) => {
              if (res && res.ok) return cache.put(url, res);
            })
          )
        )
      )
    ]).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => ![STATIC_CACHE, CDN_CACHE, RUNTIME_CACHE].includes(k))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isTrustedCDN(url) {
  return TRUSTED_CDN_ORIGINS.some((origin) => url.href.startsWith(origin));
}

function isStaticAsset(req) {
  const dest = req.destination;
  return ['style', 'script', 'image', 'font', 'document'].includes(dest);
}

/* Network first (para navegación principal) */
async function networkFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && req.method === 'GET') {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: false });
    if (cached) return cached;
    throw err;
  }
}

/* Stale-while-revalidate (assets estáticos del mismo origen) */
async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req, { ignoreSearch: false });
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok && req.method === 'GET') cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || fetchPromise || Response.error();
}

/* PERF: Cache-first para CDN assets (cambian muy poco, máxima velocidad) */
async function cdnCacheFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(req);
  if (cached) {
    /* Revalidar en background sin bloquear */
    fetch(req, { mode: 'cors' }).then((res) => {
      if (res && res.ok) cache.put(req, res);
    }).catch(() => {});
    return cached;
  }
  /* No en cache — fetch y guardar */
  try {
    const fresh = await fetch(req, { mode: 'cors' });
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  /* PERF: CDN assets → cache-first con revalidación en background */
  if (isTrustedCDN(url)) {
    event.respondWith(cdnCacheFirst(req));
    return;
  }

  /* No cache para Google Apps Script API u otros cross-origin dinámicos */
  if (!isSameOrigin(url)) {
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  if (isStaticAsset(req)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
