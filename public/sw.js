/**
 * CSC LMS Service Worker
 * Caches the schedule and leaves pages + static assets for offline viewing.
 * Strategy: Cache-first for assets, Network-first with cache fallback for pages.
 */

const CACHE_VERSION = "csc-lms-v1";
const ASSET_CACHE   = `${CACHE_VERSION}-assets`;
const PAGE_CACHE    = `${CACHE_VERSION}-pages`;

// Pages to pre-cache and serve offline
const OFFLINE_PAGES = ["/dashboard", "/leaves", "/schedule", "/proxies"];

// ── Install: pre-cache offline pages ──────────────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(PAGE_CACHE).then((cache) =>
      cache.addAll(OFFLINE_PAGES).catch(() => {})
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ────────────────────────────────────────────────
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

// ── Fetch: Network-first for navigations, Cache-first for assets ───────────────
self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip Supabase API, auth, and server functions — always need fresh data
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_server/") ||
    url.hostname.includes("supabase.co")
  ) return;

  // Static assets (JS, CSS, fonts, images) — Cache-first
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
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return cached ?? Response.error();
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
          if (response.ok) {
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached ?? caches.match("/dashboard") ?? Response.error();
        })
    );
  }
});
