const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8000;

// 仅下发非敏感配置；API key 必须由用户在浏览器弹窗中输入并保存到 localStorage。
// 这样可以避免把 key 通过 /env-config.js 暴露给浏览器扩展、devtools 等。
const ENV_KEYS = [
  "QWEN_API_URL",
  "QWEN_MODEL",
  "DAILY_GOAL",
  "DAILY_LIMIT",
];

// 允许的请求来源。默认仅允许本地开发；部署到生产时请设置 ALLOWED_ORIGINS。
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:8000,http://127.0.0.1:8000"
).split(",").map((s) => s.trim()).filter(Boolean);

function isOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 同源或 curl 类请求不带 Origin，放行
  return ALLOWED_ORIGINS.includes(origin);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

function buildPublicEnv() {
  const localEnv = parseEnvFile(path.join(ROOT, ".env"));
  return ENV_KEYS.reduce((env, key) => {
    const value = process.env[key] || localEnv[key];
    if (value) env[key] = value;
    return env;
  }, {});
}

function send(res, status, content, contentType) {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  };
  if (contentType.startsWith("text/html")) {
    headers["X-Content-Type-Options"] = "nosniff";
  }
  res.writeHead(status, headers);
  res.end(content);
}

function serveStatic(req, res) {
  if (!isOriginAllowed(req)) {
    send(res, 403, "Forbidden: origin not allowed", "text/plain; charset=utf-8");
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/env-config.js") {
    const env = buildPublicEnv();
    send(
      res,
      200,
      `window.__CALORIE_MASTER_ENV__ = ${JSON.stringify(env)};\n`,
      "application/javascript; charset=utf-8",
    );
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, requestedPath));
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".md": "text/markdown; charset=utf-8",
    };
    send(res, 200, data, contentTypes[ext] || "application/octet-stream");
  });
}

http.createServer(serveStatic).listen(PORT, () => {
  console.log(`CalorieMaster running at http://localhost:${PORT}`);
  console.log("Loaded non-sensitive presets from .env when present.");
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log("API keys must be entered by the user in the setup modal.");
});
