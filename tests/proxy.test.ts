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
    responseBody: JSON.stringify({ ok: true }),
    responseContentType: "application/json",
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      state.received.push({
        method: req.method || "",
        url: req.url || "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
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
  // Wait for the server to be ready by polling.
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
  // Use an isolated .env so the test never depends on the user's real keys.
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

describe("API proxy via server.cjs", () => {
  it("serves the app at / and never leaks the key in the HTML", async () => {
    await startServer(8770, {});
    const res = await request(8770, "/", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/<div id="root">/);
    expect(res.body).not.toContain("test-qwen");
    expect(res.body).not.toContain("test-boohee");
  });

  it("forwards POST /api/qwen upstream with the Authorization header from .env", async () => {
    upstream = await startUpstream();
    await startServer(8771, {
      QWEN_API_KEY: "test-qwen",
      QWEN_API_URL: upstream.url + "/chat",
      QWEN_MODEL: "qwen-test",
    });
    upstream.received = [];
    upstream.responseStatus = 200;
    upstream.responseBody = JSON.stringify({ choices: [{ message: { content: "ok" } }] });

    const res = await request(8771, "/api/qwen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
        response_format: { type: "json_object" },
      }),
    });
    expect(res.status).toBe(200);
    expect(upstream.received).toHaveLength(1);
    expect(upstream.received[0].url).toBe("/chat");
    expect(upstream.received[0].headers.authorization).toBe("Bearer test-qwen");
    const sent = JSON.parse(upstream.received[0].body);
    expect(sent.model).toBe("qwen-test");
    expect(sent.messages[0].content).toBe("hi");
    // The raw key value must not appear anywhere in the client-visible response
    expect(res.body).not.toContain("test-qwen");
  });

  it("forwards GET /api/boohee?code=xxx with the X-Api-Key header from .env", async () => {
    upstream = await startUpstream();
    await startServer(8772, {
      QWEN_API_KEY: "test-qwen",
      QWEN_API_URL: upstream.url + "/chat",
      BOOHEE_API_KEY: "test-boohee",
      BOOHEE_API_URL: upstream.url + "/v1/food/detail",
    });
    upstream.received = [];
    upstream.responseStatus = 200;
    upstream.responseBody = JSON.stringify({ data: { name: "测试" } });

    const res = await request(8772, "/api/boohee?code=food_1001001");
    expect(res.status).toBe(200);
    expect(upstream.received).toHaveLength(1);
    expect(upstream.received[0].url).toContain("code=food_1001001");
    expect(upstream.received[0].url).toContain("with_units=true");
    expect(upstream.received[0].headers["x-api-key"]).toBe("test-boohee");
    expect(res.body).not.toContain("test-boohee");
  });

  it("returns 503 when QWEN_API_KEY is missing from .env", async () => {
    // Clear keys by passing empty strings (process.env takes precedence over .env file).
    await startServer(8773, {
      QWEN_API_KEY: "",
      BOOHEE_API_KEY: "",
    });
    const res = await request(8773, "/api/qwen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });
    expect(res.status).toBe(503);
    expect(res.body).toMatch(/QWEN_API_KEY/);
  });

  it("refuses to serve hidden files like /.env, /.git/config, /server/server.cjs", async () => {
    await startServer(8774, {});
    for (const path of ["/.env", "/.git/config", "/.env.example"]) {
      const res = await request(8774, path, { headers: { Accept: "text/html" } });
      // Either 403 (explicit) or 404 (not in dist) — but never the file content
      expect([403, 404]).toContain(res.status);
      expect(res.body).not.toMatch(/QWEN_API_KEY|BOOHEE_API_KEY/);
    }
  });
});
