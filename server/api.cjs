/**
 * CalorieMaster API proxy.
 *
 * Reads API keys from the local .env file (which is .gitignored) and
 * forwards Qwen / 薄荷 calls so the browser never has to see the keys.
 *
 * Used by:
 *   - server/server.cjs (production preview)
 *   - vite.config.ts (development server plugin)
 *
 * Endpoints:
 *   POST /api/qwen     body: { messages, response_format? }
 *   GET  /api/boohee?code=xxx
 *
 * The browser only talks to /api/* on its own origin, so the keys are
 * never embedded in the JS bundle and never leave the server process.
 */

const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const DEFAULT_QWEN_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_QWEN_MODEL = "qwen3-vl-flash";
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function pipeUpstream(res, upstreamRes) {
  const contentType =
    upstreamRes.headers.get("content-type") || "application/json; charset=utf-8";
  res.writeHead(upstreamRes.status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  return upstreamRes.arrayBuffer().then((buf) => res.end(Buffer.from(buf)));
}

function createApiRouter(env) {
  const qwenKey = env.QWEN_API_KEY || "";
  const qwenUrl = env.QWEN_API_URL || DEFAULT_QWEN_API_URL;
  const qwenModel = env.QWEN_MODEL || DEFAULT_QWEN_MODEL;
  const booheeKey = env.BOOHEE_API_KEY || "";
  const booheeBase = env.BOOHEE_API_URL || DEFAULT_BOOHEE_API_URL;

  async function handleQwen(req, res) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    if (!qwenKey) {
      sendJson(res, 503, {
        error:
          "QWEN_API_KEY not configured. Add it to .env on the server (file is gitignored).",
      });
      return true;
    }
    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      sendJson(res, 400, { error: "Failed to read request body" });
      return true;
    }
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8") || "{}");
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }
    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      sendJson(res, 400, { error: "Missing 'messages' array" });
      return true;
    }
    const body = {
      model: qwenModel,
      messages: payload.messages,
      ...(payload.response_format ? { response_format: payload.response_format } : {}),
    };
    let upstream;
    try {
      upstream = await fetch(qwenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${qwenKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      sendJson(res, 502, { error: `Upstream error: ${err.message}` });
      return true;
    }
    await pipeUpstream(res, upstream);
    return true;
  }

  async function handleBoohee(req, res) {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    if (!booheeKey) {
      sendJson(res, 503, {
        error:
          "BOOHEE_API_KEY not configured. Add it to .env on the server (file is gitignored).",
      });
      return true;
    }
    const url = new URL(req.url, "http://localhost");
    const code = url.searchParams.get("code");
    if (!code) {
      sendJson(res, 400, { error: "Missing 'code' query parameter" });
      return true;
    }
    const target = `${booheeBase}/v1/food/detail?code=${encodeURIComponent(
      code,
    )}&with_units=true&with_materials=true`;
    let upstream;
    try {
      upstream = await fetch(target, {
        method: "GET",
        headers: {
          "X-Api-Key": booheeKey,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      sendJson(res, 502, { error: `Upstream error: ${err.message}` });
      return true;
    }
    await pipeUpstream(res, upstream);
    return true;
  }

  return async function handle(req, res) {
    const url = req.url || "";
    if (url.startsWith("/api/qwen")) return handleQwen(req, res);
    if (url.startsWith("/api/boohee")) return handleBoohee(req, res);
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
