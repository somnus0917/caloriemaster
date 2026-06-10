/**
 * CalorieMaster Service Worker
 *
 * 策略：仅缓存 HTML/CSS/JS/manifest 这类静态壳资源，图片走网络。
 * - install: 预缓存应用壳
 * - fetch: cache-first（命中则返回缓存）→ network fallback → 失败时返回 offline 提示
 *
 * 注意：API 调用（Qwen / 薄荷）始终走网络，不缓存。
 */
const CACHE_NAME = "caloriemaster-v1";
const SHELL_URLS = [
  "./",
  "./index.html",
  "./boohee-foods.js",
  "./manifest.json",
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

  // 跳过跨域 API 调用（Qwen / 薄荷），让浏览器直接走网络
  if (
    url.host.includes("dashscope.aliyuncs.com") ||
    url.host.includes("boohee.com")
  ) {
    return;
  }

  // 同源请求：cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((response) => {
          // 仅缓存成功的同源 GET
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
          // 离线兜底：返回 index.html，让 SPA 路由能继续工作
          if (req.mode === "navigate") return caches.match("./index.html");
        });
    }),
  );
});