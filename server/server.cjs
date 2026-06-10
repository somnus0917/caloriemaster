/**
 * CalorieMaster production preview server.
 *
 * Security model:
 * - Serves ONLY the Vite build output in `dist/`.
 * - Refuses to serve any file outside `dist/`, including hidden dotfiles.
 * - API keys live in the local .env file (which is .gitignored) and are
 *   exposed to the browser ONLY through the /api/* proxy endpoints
 *   defined in server/api.cjs. The browser never sees the raw keys.
 * - SPA fallback to `dist/index.html` only for GET requests with
 *   `Accept: text/html` and without a file extension, so that real
 *   asset paths (e.g. `/assets/index-abc123.js`) and API-style paths
 *   (`/foo.json`) get a proper 404 instead of HTML.
 */

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { readEnv, createApiRouter } = require("./api.cjs");

const DIST_DIR = path.resolve(__dirname, "..", "dist");
const PORT = Number(process.env.PORT) || 8000;

const HOSTNAME = process.env.HOSTNAME || "127.0.0.1";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  `http://${HOSTNAME}:${PORT},http://localhost:${PORT}`
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function send(res, status, body, contentType, extraHeaders = {}) {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(body);
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        send(res, 500, "Internal server error", "text/plain; charset=utf-8");
        return;
      }
      send(res, 200, data, contentType);
    });
  });
}

function isSafePath(resolvedPath) {
  const relative = path.relative(DIST_DIR, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep);
  if (parts.some((p) => p.startsWith("."))) return false;
  return true;
}

function hasFileExtension(pathname) {
  const last = pathname.split("/").pop() || "";
  return last.includes(".");
}

async function handleRequest(req, res) {
  if (!isOriginAllowed(req)) {
    send(res, 403, "Forbidden: origin not allowed", "text/plain; charset=utf-8");
    return;
  }

  // /api/* proxy: handled by the shared router (reads .env for keys).
  // The router accepts its own methods (GET/POST), so we route here first
  // BEFORE the static-file method check rejects anything that isn't
  // GET/HEAD.
  if ((req.url || "").startsWith("/api/")) {
    const env = readEnv();
    const api = createApiRouter(env);
    await api(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
    return;
  }

  const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname || "/");
  } catch (_) {
    send(res, 400, "Bad request", "text/plain; charset=utf-8");
    return;
  }

  const safePath = pathname.replace(/^\/+/, "") || "index.html";
  const resolved = path.normalize(path.join(DIST_DIR, safePath));
  if (!isSafePath(resolved)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  const accept = req.headers.accept || "";
  const wantsHtml = accept.includes("text/html");
  if (wantsHtml && !hasFileExtension(safePath)) {
    const indexPath = path.join(DIST_DIR, "index.html");
    if (!isSafePath(indexPath)) {
      send(res, 403, "Forbidden", "text/plain; charset=utf-8");
      return;
    }
    serveFile(req, res, indexPath);
    return;
  }

  serveFile(req, res, resolved);
}

function ensureDist() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(
      `Error: build output not found at ${DIST_DIR}. Run \`npm run build\` first.`,
    );
    process.exit(1);
  }
}

ensureDist();
http.createServer(handleRequest).listen(PORT, HOSTNAME, () => {
  const env = readEnv();
  const hasQwen = Boolean(env.QWEN_API_KEY);
  const hasBoohee = Boolean(env.BOOHEE_API_KEY);
  console.log(`CalorieMaster production server: http://${HOSTNAME}:${PORT}`);
  console.log(`Serving only files inside: ${DIST_DIR}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(
    `API keys: Qwen ${hasQwen ? "loaded" : "MISSING"}, Boohee ${hasBoohee ? "loaded" : "MISSING"} (from .env)`,
  );
  if (!hasQwen) {
    console.warn(
      "  → Add QWEN_API_KEY to .env to enable AI recognition.",
    );
  }
});
