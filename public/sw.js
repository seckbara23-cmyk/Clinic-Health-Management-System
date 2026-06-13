// CHMS service worker — app shell + offline navigation fallback ONLY.
// It must NEVER cache API or Supabase responses (no medical/billing/PII data
// touches this cache). Operational DATA caching is handled separately by the
// React-Query IndexedDB persister with a strict allowlist.
//
// CACHE_VERSION MUST match src/lib/offline/config.ts. Bump both together — the
// activate handler purges every cache that doesn't match the current version.
const CACHE_VERSION = 1
const SHELL_CACHE = `chms-shell-v${CACHE_VERSION}`
const OFFLINE_URL = '/offline'
const PRECACHE = [OFFLINE_URL, '/icons/icon.svg', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Let the page trigger an immediate update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Only ever touch same-origin requests. Cross-origin (Supabase REST/Realtime/
  // auth) and any /api/* request are passed straight through — never cached.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Navigations: network-first, fall back to the cached offline page when down.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r ?? new Response('Offline', { status: 503 })),
      ),
    )
    return
  }

  // Static build assets + icons: cache-first with background refresh.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
            }
            return res
          })
          .catch(() => cached)
        return cached ?? network
      }),
    )
  }
})
