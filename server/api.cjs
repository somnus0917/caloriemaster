/**
 * CalorieMaster API proxy.
 *
 * Reads API keys from the local .env file (which is .gitignored) and
 * forwards the food-recognition call to Qwen, plus the optional
 * 薄荷 (Boohee) detail lookup. The browser never sees the keys.
 *
 * Used by:
 *   - server/server.cjs (production preview)
 *   - vite.config.ts (development server plugin)
 *
 * Endpoints:
 *   POST /api/recognize-food   body: { imageBase64: "data:image/...;base64,..." }
 *   GET  /api/boohee?code=xxx
 *
 * SECURITY BOUNDARY
 * -----------------
 *  - The browser can ONLY influence the food-recognition request by
 *    sending an image. Model name, system prompt, generation params
 *    and message structure are fixed in this file (and in
 *    server/validation.cjs).
 *  - The browser cannot trigger arbitrary Qwen calls. The previous
 *    generic /api/qwen proxy has been removed.
 *  - The browser cannot set messages, prompt, or model name.
 *  - There is NO authentication or rate limit on /api/*. See README
 *    for deployment guidance.
 */

const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const {
  MAX_BODY_BYTES,
  parseImageDataUrl,
  validateRecognizeBody,
  buildUpstreamRequest,
  DEFAULT_QWEN_MODEL,
  DEFAULT_SYSTEM_PROMPT,
} = require("./validation.cjs");

const DEFAULT_QWEN_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_BOOHEE_API_URL = "https://api.boohee.com";
const FETCH_TIMEOUT_MS = 30000;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function readEnv() {
  // process.env wins; .env supplies the rest (and is gitignored).
  const envPath = path.resolve(process.cwd(), ".env");
  const file = readEnvFile(envPath);
  return { ...file, ...process.env };
}

function sendJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function readBodyWithLimit(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        // We can't reliably write a response after destroying the
        // socket, so resolve with a typed error and let the handler
        // emit the JSON response before the connection is torn down.
        req.removeAllListeners("end");
        req.removeAllListeners("error");
        req.resume();
        // Best-effort: stop accepting further bytes.
        try { req.pause(); } catch { /* noop */ }
        resolve({
          ok: false,
          code: "PAYLOAD_TOO_LARGE",
          message: "上传图片过大，请重新选择或压缩图片",
        });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      resolve({ ok: true, body: Buffer.concat(chunks) });
    });
    req.on("error", (err) => reject(err));
  });
}

function createApiRouter(env) {
  const qwenKey = env.QWEN_API_KEY || "";
  const qwenUrl = env.QWEN_API_URL || DEFAULT_QWEN_API_URL;
  const qwenModel = env.QWEN_MODEL || DEFAULT_QWEN_MODEL;
  const systemPrompt = env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  const booheeKey = env.BOOHEE_API_KEY || "";
  const booheeBase = env.BOOHEE_API_URL || DEFAULT_BOOHEE_API_URL;

  // Pathname helper. The router only matches exact pathnames — no more
  // startsWith — so /api/recognize-food-anything or /api/qwen-extra
  // fall through to a 404.
  function getPathname(req) {
    const raw = req.url || "/";
    // req.url is always a path + query on the local proxy server.
    const qIndex = raw.indexOf("?");
    return qIndex === -1 ? raw : raw.slice(0, qIndex);
  }

  async function handleRecognizeFood(req, res) {
    if (req.method !== "POST") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "仅支持 POST 请求");
      return true;
    }
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      sendError(res, 415, "UNSUPPORTED_MEDIA", "Content-Type 必须为 application/json");
      return true;
    }
    if (!qwenKey) {
      sendError(
        res,
        503,
        "QWEN_NOT_CONFIGURED",
        "服务端未配置 QWEN_API_KEY，请在 .env 中填写后重启服务",
      );
      return true;
    }
    let bodyResult;
    try {
      bodyResult = await readBodyWithLimit(req, MAX_BODY_BYTES);
    } catch (err) {
      sendError(res, 400, "INVALID_REQUEST", "请求体读取失败");
      return true;
    }
    if (!bodyResult.ok) {
      sendError(res, 413, bodyResult.code, bodyResult.message);
      return true;
    }
    let payload;
    try {
      const text = bodyResult.body.toString("utf8") || "{}";
      payload = JSON.parse(text);
    } catch (err) {
      sendError(res, 400, "INVALID_REQUEST", "请求体不是合法 JSON");
      return true;
    }
    const validation = validateRecognizeBody(payload);
    if (!validation.ok) {
      const status = validation.code === "UNSUPPORTED_MEDIA" ? 415 : 400;
      sendError(res, status, validation.code, validation.message);
      return true;
    }
    const upstreamBody = buildUpstreamRequest(
      `data:${validation.mime};base64,${validation.base64}`,
      { QWEN_MODEL: qwenModel, SYSTEM_PROMPT: systemPrompt },
    );
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(qwenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${qwenKey}`,
        },
        body: JSON.stringify(upstreamBody),
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err && err.name === "AbortError";
      if (isTimeout) {
        sendError(res, 504, "UPSTREAM_TIMEOUT", "AI 服务超时，请稍后再试");
      } else {
        sendError(res, 502, "UPSTREAM_ERROR", "AI 服务暂时不可用，请稍后再试");
      }
      return true;
    }
    clearTimeout(timer);

    // Always extract the model content and return only that — never
    // leak upstream headers, error bodies, or the key to the browser.
    let upstreamJson;
    try {
      upstreamJson = await upstream.json();
    } catch (err) {
      sendError(res, 502, "UPSTREAM_ERROR", "AI 服务返回数据无法解析");
      return true;
    }
    if (!upstream.ok) {
      const status = upstream.status === 401 || upstream.status === 403 ? 502 : 502;
      sendError(res, status, "UPSTREAM_ERROR", "AI 服务返回错误");
      return true;
    }
    const content =
      upstreamJson &&
      upstreamJson.choices &&
      upstreamJson.choices[0] &&
      upstreamJson.choices[0].message &&
      typeof upstreamJson.choices[0].message.content === "string"
        ? upstreamJson.choices[0].message.content
        : "";
    if (!content) {
      sendError(res, 502, "UPSTREAM_ERROR", "AI 服务未返回识别结果");
      return true;
    }
    sendJson(res, 200, { content });
    return true;
  }

  async function handleBoohee(req, res) {
    if (req.method !== "GET") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "仅支持 GET 请求");
      return true;
    }
    if (!booheeKey) {
      sendError(
        res,
        503,
        "BOOHEE_NOT_CONFIGURED",
        "服务端未配置 BOOHEE_API_KEY",
      );
      return true;
    }
    const url = new URL(req.url, "http://localhost");
    const code = url.searchParams.get("code");
    if (!code) {
      sendError(res, 400, "INVALID_REQUEST", "缺少 code 查询参数");
      return true;
    }
    const target = `${booheeBase}/v1/food/detail?code=${encodeURIComponent(
      code,
    )}&with_units=true&with_materials=true`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(target, {
        method: "GET",
        headers: {
          "X-Api-Key": booheeKey,
          "Content-Type": "application/json",
        },
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err && err.name === "AbortError";
      if (isTimeout) {
        sendError(res, 504, "UPSTREAM_TIMEOUT", "营养数据库超时");
      } else {
        sendError(res, 502, "UPSTREAM_ERROR", "营养数据库暂时不可用");
      }
      return true;
    }
    clearTimeout(timer);
    sendJson(res, upstream.status, await upstream.json().catch(() => ({})));
    return true;
  }

  return async function handle(req, res) {
    const pathname = getPathname(req);
    if (pathname === "/api/recognize-food") return handleRecognizeFood(req, res);
    if (pathname === "/api/boohee") return handleBoohee(req, res);
    if (pathname.startsWith("/api/")) {
      sendError(res, 404, "ROUTE_NOT_FOUND", "接口不存在");
      return true;
    }
    return false;
  };
}

module.exports = {
  readEnv,
  readEnvFile,
  createApiRouter,
  DEFAULT_QWEN_API_URL,
  DEFAULT_QWEN_MODEL,
  DEFAULT_BOOHEE_API_URL,
};
