/**
 * Security tests for the production preview server.
 *
 * These spawn the server, hit it with HTTP requests, and assert that
 * sensitive files are NOT served and that routing behaves correctly.
 */
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import http from "node:http";

const TEST_PORT = 8765;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess: ChildProcess | null = null;
let distReady = false;

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(BASE, (res) => {
          res.resume();
          resolve();
        });
        req.on("error", reject);
        req.setTimeout(500, () => req.destroy(new Error("timeout")));
      });
      distReady = true;
      return;
    } catch {
      await delay(200);
    }
  }
  throw new Error("Server did not start");
}

function fetchStatus(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${BASE}${path}`,
      { headers },
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
    req.setTimeout(2000, () => req.destroy(new Error("timeout")));
  });
}

beforeAll(async () => {
  serverProcess = spawn("node", ["server/server.cjs"], {
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.includes("ENOENT") || text.includes("not found")) {
      // dist not built yet — that's fine, tests will skip
    }
  });
  try {
    await waitForServer();
  } catch (err) {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      serverProcess = null;
    }
    throw err;
  }
}, 30000);

afterAll(() => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
});

describe("production server security", () => {
  it("serves the index page at /", async () => {
    if (!distReady) return;
    const res = await fetchStatus("/", { Accept: "text/html" });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toMatch(/<div id="root">/);
  });

  it("refuses to serve /.env", async () => {
    if (!distReady) return;
    const res = await fetchStatus("/.env");
    expect(res.status).toBe(403);
    expect(res.body).not.toMatch(/QWEN_API_KEY/);
  });

  it("refuses to serve /server/server.js (server source)", async () => {
    if (!distReady) return;
    const res = await fetchStatus("/server/server.js");
    // Either 403 (explicitly forbidden) or 404 (file not in dist) is
    // acceptable — what matters is that the source code is not returned.
    expect([403, 404]).toContain(res.status);
    expect(res.body).not.toMatch(/require/);
  });

  it("refuses to serve /.git/config", async () => {
    if (!distReady) return;
    const res = await fetchStatus("/.git/config");
    expect(res.status).toBe(403);
    expect(res.body).not.toMatch(/\[core\]/);
  });

  it("does not serve the source index.html at the project root via traversal", async () => {
    if (!distReady) return;
    const res = await fetchStatus("/index.html", { Accept: "text/html" });
    // /index.html is technically inside dist after a build; verify it is
    // actually the built artifact (contains #root), not the source file.
    expect(res.status).toBe(200);
    expect(res.body).toContain("<div id=\"root\">");
    expect(res.body).not.toContain("<style>");
  });

  it("returns 404 for missing assets instead of HTML", async () => {
    if (!distReady) return;
    const res = await fetchStatus("/assets/does-not-exist.js");
    expect(res.status).toBe(404);
    expect(res.contentType).toContain("text/plain");
  });
});
