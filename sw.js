/* NoMeh! service worker
 *
 * Responsibilities (product spec §3, §26, §39):
 *   - precache the application shell so the app opens with no network
 *   - versioned caches with cleanup of superseded versions
 *   - offline navigation for a hash-routed SPA
 *   - update detection, with the page deciding when to activate
 *
 * Bump CACHE_VERSION on every deploy. Nothing else needs to change.
 */

const CACHE_VERSION = 'v1.0.0';
const SHELL_CACHE  = `nomeh-shell-${CACHE_VERSION}`;
const VENDOR_CACHE = `nomeh-vendor-${CACHE_VERSION}`;
const RUNTIME_CACHE = `nomeh-runtime-${CACHE_VERSION}`;
const OWNED = [SHELL_CACHE, VENDOR_CACHE, RUNTIME_CACHE];

/* Local shell files. These are same-origin and must all cache successfully,
   otherwise the install is rejected and we keep the previous working version. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/tokens.css',
  './styles/app.css',
  './src/main.js',
  './src/core/router.js',
  './src/core/ui.js',
  './src/core/capabilities.js',
  './src/core/prefs.js',
  './src/db/dexie.js',
  './src/db/database.js',
  './src/db/repos.js',
  './src/engines/biomath.js',
  './src/engines/logparser.js',
  './src/engines/analytics.js',
  './src/features/onboarding.js',
  './src/features/today.js',
  './src/features/log.js',
  './src/features/timeline.js',
  './src/features/body.js',
  './src/features/settings.js',
  './src/features/backup.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

/* Third-party runtime dependencies. Cached best-effort: a CDN hiccup during
   install must not break the deploy, so failures here are tolerated and the
   runtime handler will cache them on first successful fetch instead. */
const VENDOR = [
  'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/modern/dexie.mjs'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);

    const vendor = await caches.open(VENDOR_CACHE);
    await Promise.all(VENDOR.map(async (url) => {
      try { await vendor.add(new Request(url, { cache: 'reload' })); }
      catch (err) { console.warn('[sw] vendor precache skipped:', url, err); }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('nomeh-') && !OWNED.includes(n))
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'version') {
    event.source?.postMessage({ type: 'version', version: CACHE_VERSION });
  }
});

function isSameOrigin(url) {
  return new URL(url, self.location.href).origin === self.location.origin;
}

/* Navigations always resolve to the cached shell. Routing is hash-based, so
   there is exactly one HTML document and no server rewrites are needed. */
async function handleNavigation(request) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      shell.put('./index.html', fresh.clone());
      return fresh;
    }
    throw new Error('bad status ' + fresh.status);
  } catch {
    return (await shell.match('./index.html')) ||
           (await shell.match('./')) ||
           new Response(
             '<!doctype html><meta charset=utf-8><title>NoMeh! offline</title>' +
             '<body style="background:#050507;color:#f2f4f7;font-family:system-ui;padding:32px">' +
             '<h1>Not cached yet</h1><p>Open NoMeh! once while online, then it will work offline.</p>',
             { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
           );
  }
}

/* Cache-first with a background refresh. The shell is small and versioned, so
   serving from cache first is what makes a cold start feel instant. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);

  const network = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  /* Deliberately not awaited: the cached copy is served immediately and the
     network response updates the cache for next time. */
  if (hit) { void network; return hit; }

  const res = await network;
  if (res) return res;
  return new Response('', { status: 504, statusText: 'Offline and not cached' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;                     // never cache writes
  if (request.url.startsWith('chrome-extension')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  const sameOrigin = isSameOrigin(request.url);
  const cacheName = sameOrigin
    ? SHELL_CACHE
    : (VENDOR.includes(request.url) ? VENDOR_CACHE : RUNTIME_CACHE);

  event.respondWith(staleWhileRevalidate(request, cacheName));
});
