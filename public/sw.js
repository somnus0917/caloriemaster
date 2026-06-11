/**
 * CalorieMaster Service Worker
 *
 * Strategy:
 *   - install: precache the app shell (index.html, manifest).
 *   - fetch:
 *       * GET /api/*        → always go to network (never cache)
 *       * GET other same-origin → cache-first with stale-while-revalidate
 *
 * The SW is intentionally minimal: the app is mostly a thin client
 * talking to the server. Caching API responses would break the auth
 * and isolation guarantees.
 */
const CACHE_NAME = "caloriemaster-v2";
const SHELL_URLS = ["./", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache or short-circuit API traffic — the server is the source
  // of truth and must always see credentialed requests.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Skip cross-origin traffic (Aliyun OSS image bytes etc.). The
  // browser's normal network stack handles these.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Cache-first with stale-while-revalidate for same-origin GETs.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(req, response.clone()).catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? networkFetch;
    }),
  );
});