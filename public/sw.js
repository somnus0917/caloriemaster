/**
 * CalorieMaster Service Worker
 *
 * Strategy: cache-first for same-origin shell assets (HTML/CSS/JS/manifest),
 * bypass cache for cross-origin API calls (Qwen / 薄荷).
 * - install: precache the application shell
 * - fetch: cache-first → network fallback → 503 for navigation when offline
 */
const CACHE_NAME = "caloriemaster-v1";
const SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
];

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

  // Skip cross-origin API calls (Qwen / 薄荷) — go straight to network.
  if (
    url.host.includes("dashscope.aliyuncs.com") ||
    url.host.includes("boohee.com")
  ) {
    return;
  }

  // Same-origin: cache-first.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((response) => {
          if (
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline navigation fallback: return cached index.html so SPA
          // routing can still work.
          if (req.mode === "navigate") return caches.match("/index.html");
          return new Response("", { status: 504, statusText: "Offline" });
        });
    }),
  );
});
