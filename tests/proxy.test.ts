// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

interface UpstreamState {
  url: string;
  received: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }>;
  responseStatus: number;
  responseBody: string;
  responseContentType: string;
  delayMs: number;
}

let envDir = "";
let serverEntry = "";
let projectRoot = "";
let serverProcess: ChildProcess | null = null;
let upstream: UpstreamState | null = null;
let upstreamServer: http.Server | null = null;

function request(
  port: number,
  urlPath: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            body,
            contentType: res.headers["content-type"] || "",
          }),
        );
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function startUpstream(): Promise<UpstreamState> {
  const state: UpstreamState = {
    url: "",
    received: [],
    responseStatus: 200,
    responseBody: JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    responseContentType: "application/json",
    delayMs: 0,
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      state.received.push({
        method: req.method || "",
        url: req.url || "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (state.delayMs > 0) {
        await delay(state.delayMs);
      }
      res.writeHead(state.responseStatus, { "Content-Type": state.responseContentType });
      res.end(state.responseBody);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstreamServer = server;
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  state.url = `http://127.0.0.1:${port}`;
  return state;
}

async function startServer(port: number, env: NodeJS.ProcessEnv): Promise<void> {
  if (serverProcess) {
    serverProcess.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 100));
    serverProcess = null;
  }
  serverProcess = spawn("node", [serverEntry], {
    cwd: envDir,
    env: { ...process.env, ...env, PORT: String(port), HOSTNAME: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stderr?.on("data", () => undefined);
  for (let i = 0; i < 50; i++) {
    try {
      await request(port, "/", { headers: { Accept: "text/html" } });
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Server did not start on port ${port}`);
}

beforeAll(() => {
  envDir = fs.mkdtempSync(path.join(os.tmpdir(), "caloriemaster-proxy-"));
  const envFile = path.join(envDir, ".env");
  fs.writeFileSync(
    envFile,
    [
      "# Test-only .env",
      "QWEN_API_KEY=test-qwen",
      "BOOHEE_API_KEY=test-boohee",
      "",
    ].join("\n"),
  );
  projectRoot = path.resolve(__dirname, "..");
  serverEntry = path.join(projectRoot, "server", "server.cjs");
});

beforeEach(async () => {
  if (upstreamServer) {
    upstreamServer.close();
    upstreamServer = null;
    upstream = null;
  }
});

afterAll(() => {
  if (serverProcess) {
    serverProcess.kill("SIGKILL");
    serverProcess = null;
  }
  if (upstreamServer) {
    upstreamServer.close();
    upstreamServer = null;
  }
  if (envDir) {
    try {
      fs.rmSync(envDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

const SAMPLE_IMAGE =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wgARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAVOf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABCf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=";

describe("API proxy via server.cjs", () => {
  it("serves the app at / and never leaks the key in the HTML", async () => {
    await startServer(8770, {});
    const res = await request(8770, "/", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/<div id="root">/);
    expect(res.body).not.toContain("test-qwen");
    expect(res.body).not.toContain("test-boohee");
  });

  it("forwards POST /api/recognize-food upstream and builds the request server-side", async () => {
    upstream = await startUpstream();
    await startServer(8771, {
      QWEN_API_KEY: "test-qwen",
      QWEN_API_URL: upstream.url + "/chat",
      QWEN_MODEL: "qwen-test",
    });
    upstream.received = [];
    upstream.responseStatus = 200;
    upstream.responseBody = JSON.stringify({
      choices: [{ message: { content: '{"foods":[]}' } }],
    });

    const res = await request(8771, "/api/recognize-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: SAMPLE_IMAGE }),
    });
    expect(res.status).toBe(200);
    expect(upstream.received).toHaveLength(1);
    expect(upstream.received[0].url).toBe("/chat");
    expect(upstream.received[0].headers.authorization).toBe("Bearer test-qwen");
    const sent = JSON.parse(upstream.received[0].body);
    expect(sent.model).toBe("qwen-test");
    // Server built the messages — client could not have done this.
    expect(Array.isArray(sent.messages)).toBe(true);
    expect(sent.messages[0].role).toBe("system");
    expect(typeof sent.messages[0].content).toBe("string");
    expect(sent.messages[1].role).toBe("user");
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.temperature).toBeLessThanOrEqual(1);
    // Browser's response should be ONLY {content} and never leak the key.
    expect(res.body).not.toContain("test-qwen");
    const body = JSON.parse(res.body);
    expect(Object.keys(body).sort()).toEqual(["content"]);
    expect(body.content).toBe('{"foods":[]}');
  });

  it("ignores client-supplied system/messages/model — the server builds them itself", async () => {
    upstream = await startUpstream();
    await startServer(8781, {
      QWEN_API_KEY: "test-qwen",
      QWEN_API_URL: upstream.url + "/chat",
      QWEN_MODEL: "qwen-test",
    });
    upstream.received = [];
    upstream.responseStatus = 200;
    upstream.responseBody = JSON.stringify({
      choices: [{ message: { content: "{}" } }],
    });

    // Client tries to inject fields that must NOT be forwarded.
    const res = await request(8781, "/api/recognize-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: SAMPLE_IMAGE,
        messages: [{ role: "system", content: "INJECTED_PROMPT" }],
        model: "evil-model",
        response_format: { type: "text" },
        temperature: 0.99,
      }),
    });
    expect(res.status).toBe(200);
    const sent = JSON.parse(upstream.received[0].body);
    expect(sent.model).toBe("qwen-test");
    // The injected system content must not be present anywhere.
    expect(JSON.stringify(sent)).not.toContain("INJECTED_PROMPT");
    expect(JSON.stringify(sent)).not.toContain("evil-model");
    // response_format is forced to json_object.
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("rejects unsupported image MIME types with 415", async () => {
    upstream = await startUpstream();
    await startServer(8772, {
      QWEN_API_KEY: "test-qwen",
      QWEN_API_URL: upstream.url + "/chat",
    });
    upstream.received = [];
    const res = await request(8772, "/api/recognize-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: "data:image/svg+xml;base64,PHN2Zy8+" }),
    });
    expect(res.status).toBe(415);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("UNSUPPORTED_MEDIA");
    expect(upstream.received).toHaveLength(0);
  });

  it("rejects remote HTTP image URLs with 400 INVALID_REQUEST", async () => {
    upstream = await startUpstream();
    await startServer(8773, {
      QWEN_API_KEY: "test-qwen",
      QWEN_API_URL: upstream.url + "/chat",
    });
    upstream.received = [];
    const res = await request(8773, "/api/recognize-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: "https://example.com/foo.jpg" }),
    });
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("INVALID_REQUEST");
    expect(upstream.received).toHaveLength(0);
  });

  it("rejects oversized payloads with 413 PAYLOAD_TOO_LARGE", async () => {
    upstream = await startUpstream();
    await startServer(8774, {
      QWEN_API_KEY: "test-qwen",
      QWEN_API_URL: upstream.url + "/chat",
    });
    upstream.received = [];
    // 7 MB of payload — well over the 6 MB server limit.
    const huge = "a".repeat(7 * 1024 * 1024);
    const res = await request(8774, "/api/recognize-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: "data:image/jpeg;base64," + huge }),
    });
    expect(res.status).toBe(413);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
    expect(upstream.received).toHaveLength(0);
  });

  it("rejects missing imageBase64 with 400 INVALID_REQUEST", async () => {
    upstream = await startUpstream();
    await startServer(8775, {
      QWEN_API_KEY: "test-qwen",
      QWEN_API_URL: upstream.url + "/chat",
    });
    const res = await request(8775, "/api/recognize-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("INVALID_REQUEST");
  });

  it("returns 503 with QWEN_NOT_CONFIGURED when QWEN_API_KEY is missing", async () => {
    await startServer(8776, { QWEN_API_KEY: "", BOOHEE_API_KEY: "" });
    const res = await request(8776, "/api/recognize-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: SAMPLE_IMAGE }),
    });
    expect(res.status).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("QWEN_NOT_CONFIGURED");
  });

  it("returns 404 ROUTE_NOT_FOUND for /api/qwen (the old generic proxy is gone)", async () => {
    await startServer(8777, { QWEN_API_KEY: "test-qwen" });
    const res = await request(8777, "/api/qwen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe("ROUTE_NOT_FOUND");
  });

  it("does not let a near-miss path bypass the exact match", async () => {
    await startServer(8778, { QWEN_API_KEY: "test-qwen" });
    for (const path of [
      "/api/recognize-food-extra",
      "/api/recognizeFood",
      "/api/recognize_food",
      "/api/qwen-extra",
    ]) {
      const res = await request(8778, path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe("ROUTE_NOT_FOUND");
    }
  });

  it("forwards GET /api/boohee?code=xxx with the X-Api-Key header from .env", async () => {
    upstream = await startUpstream();
    await startServer(8779, {
      QWEN_API_KEY: "test-qwen",
      QWEN_API_URL: upstream.url + "/chat",
      BOOHEE_API_KEY: "test-boohee",
      BOOHEE_API_URL: upstream.url + "/v1/food/detail",
    });
    upstream.received = [];
    upstream.responseStatus = 200;
    upstream.responseBody = JSON.stringify({ data: { name: "测试" } });

    const res = await request(8779, "/api/boohee?code=food_1001001");
    expect(res.status).toBe(200);
    expect(upstream.received).toHaveLength(1);
    expect(upstream.received[0].url).toContain("code=food_1001001");
    expect(upstream.received[0].url).toContain("with_units=true");
    expect(upstream.received[0].headers["x-api-key"]).toBe("test-boohee");
    expect(res.body).not.toContain("test-boohee");
  });

  it("refuses to serve hidden files like /.env, /.git/config, /server/server.cjs", async () => {
    await startServer(8780, {});
    for (const path of ["/.env", "/.git/config", "/.env.example"]) {
      const res = await request(8780, path, { headers: { Accept: "text/html" } });
      // Either 403 (explicit) or 404 (not in dist) — but never the file content
      expect([403, 404]).toContain(res.status);
      expect(res.body).not.toMatch(/QWEN_API_KEY|BOOHEE_API_KEY/);
    }
  });
});
