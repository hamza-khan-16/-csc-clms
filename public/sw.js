/**
 * CSC LMS Service Worker
 * Caches schedule and leaves pages + static assets for offline viewing.
 */

const CACHE_VERSION = "csc-lms-v2";
const ASSET_CACHE   = `${CACHE_VERSION}-assets`;
const PAGE_CACHE    = `${CACHE_VERSION}-pages`;

const OFFLINE_PAGES = ["/dashboard", "/leaves", "/schedule", "/proxies"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(PAGE_CACHE)
      .then((cache) => cache.addAll(OFFLINE_PAGES).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("csc-lms-") && k !== ASSET_CACHE && k !== PAGE_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Only same-origin
  if (url.origin !== self.location.origin) return;

  // Skip API, server functions — always need fresh data
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_server/") ||
    url.hostname.includes("supabase.co")
  ) return;

  // Static assets — Cache-first
  if (
    url.pathname.startsWith("/_build/") ||
    url.pathname.startsWith("/fonts/") ||
    /\.(js|css|woff2?|png|jpg|svg|ico)$/.test(url.pathname)
  ) {
    e.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          // Fix: clone BEFORE reading, return the clone, cache the original
          if (response.ok) {
            const toCache = response.clone();
            cache.put(request, toCache);
          }
          return response;
        } catch {
          return Response.error();
        }
      })
    );
    return;
  }

  // Page navigations — Network-first with cache fallback
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((response) => {
          // Fix: clone first, cache the clone, return original
          if (response.ok) {
            const toCache = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, toCache));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match("/dashboard");
          return fallback ?? Response.error();
        })
    );
  }
});
