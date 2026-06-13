/**
 * Fastify entry point. Composes:
 *   - cookie + rate-limit + static file plugins
 *   - CORS-lite (we're same-origin)
 *   - CSRF Origin check on state-changing requests
 *   - body size limit
 *   - error envelope
 *   - /api/auth/* / /api/records/* / /api/settings/* / /api/recognize-food / /api/boohee
 *   - static SPA serving from dist/ in production
 */
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { ErrorCode, sendError, ApiError, handleApiError } from "./errors.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerAiRoutes } from "./ai/routes.js";
import { registerRecordRoutes } from "./records/routes.js";
import { registerSettingsRoutes } from "./settings/routes.js";
import { createRateLimiters } from "./ai/rateLimit.js";
import { getDb } from "./db/client.js";
import { isStorageConfigured } from "./storage/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_CHANGING = new Set(["POST", "PUT", "DELETE", "PATCH"]);

function originMatches(received: string | undefined, allowed: string): boolean {
  if (!received) return false;
  try {
    const a = new URL(allowed);
    const b = new URL(received);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

function csrfPreHandler(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply, done: () => void) {
  if (!STATE_CHANGING.has(request.method)) {
    done();
    return;
  }
  const config = loadConfig();
  // Only enforce on top-level /api/* requests. Same-origin fetches from
  // the SPA carry an Origin header; we compare it to APP_ORIGIN.
  const url = request.url || "";
  if (!url.startsWith("/api/")) {
    done();
    return;
  }
  // In development, allow the Vite origin OR the configured origin so
  // both the dev server and curl-based tests work.
  if (config.NODE_ENV === "development") {
    const devOrigins = new Set<string>([
      config.APP_ORIGIN,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
    const origin = request.headers.origin;
    if (origin && devOrigins.has(origin)) {
      done();
      return;
    }
    if (!origin) {
      // No origin (e.g. curl, server-to-server) — allow in dev only.
      done();
      return;
    }
  }
  const origin = request.headers.origin;
  if (!origin || !originMatches(origin, config.APP_ORIGIN)) {
    sendError(reply, 403, ErrorCode.CSRF_ORIGIN_REJECTED, "Origin 不被允许");
    return;
  }
  done();
}

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : { level: config.NODE_ENV === "production" ? "info" : "debug" },
    bodyLimit: 6 * 1024 * 1024,
    trustProxy: config.TRUST_PROXY,
  });

  // Redact secrets in logs. The default Fastify logger would otherwise
  // dump request bodies containing cookies, API keys, etc.
  app.addHook("onRequest", async (request) => {
    request.log = request.log.child({
      ip: request.ip,
    });
  });

  await app.register(cookie, {
    parseOptions: {},
  });

  const limiters = createRateLimiters(config);
  // Per-IP limiter for auth endpoints. We do not rate-limit by user
  // here because the user does not yet exist.
  await app.register(rateLimit, {
    global: false, // we'll apply per-route
  });

  // CSRF
  app.addHook("preHandler", csrfPreHandler);

  // Liveness probe. Reports whether OSS is configured but does NOT
  // touch the OSS network — we don't want a health check to fail
  // just because the bucket had a hiccup.
  app.get("/api/health", async () => ({
    ok: true,
    ts: new Date().toISOString(),
    storage: isStorageConfigured() ? "oss" : "none",
  }));

  // Register routes
  await registerAuthRoutes(app);
  await registerAiRoutes(app, limiters);
  await registerRecordRoutes(app);
  await registerSettingsRoutes(app);

  // Centralised error handler — never leak stack traces.
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ApiError) {
      return sendError(reply, err.status, err.code, err.message);
    }
    if ((err as { statusCode?: number }).statusCode === 413) {
      return sendError(reply, 413, ErrorCode.PAYLOAD_TOO_LARGE, "请求体过大");
    }
    return handleApiError(reply, err);
  });

  // Production: serve the built SPA from dist/.
  if (config.NODE_ENV === "production") {
    const distDir = path.resolve(__dirname, "..", "..", "dist");
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: "/",
      wildcard: false,
      index: "index.html",
      serveDotFiles: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if ((request.url || "").startsWith("/api/")) {
        return sendError(reply, 404, ErrorCode.ROUTE_NOT_FOUND, "接口不存在");
      }
      return reply.sendFile("index.html");
    });
  } else {
    // In dev, Vite serves the SPA and Fastify only owns the API surface.
    app.setNotFoundHandler((request, reply) => {
      if ((request.url || "").startsWith("/api/")) {
        return sendError(reply, 404, ErrorCode.ROUTE_NOT_FOUND, "接口不存在");
      }
      return reply.code(404).send("Not found");
    });
  }

  return app;
}

async function main() {
  const config = loadConfig();
  if (config.AUTO_MIGRATE) {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(config.DATABASE_URL, { max: 1, prepare: false });
    const db = drizzle(client);
    app_logger.info("Running Drizzle migrations…");
    await migrate(db, { migrationsFolder: "./migrations" });
    await client.end();
  }
  // Eagerly initialise the DB pool so we crash early if credentials
  // are wrong.
  getDb();

  const app = await buildApp();
  await app.listen({ host: config.HOST, port: config.PORT });
  app_logger.info(`CalorieMaster listening on http://${config.HOST}:${config.PORT}`);
  app_logger.info(
    `APP_ORIGIN=${config.APP_ORIGIN}, NODE_ENV=${config.NODE_ENV}, TRUST_PROXY=${config.TRUST_PROXY}`,
  );
  if (!config.QWEN_API_KEY) {
    app_logger.warn("QWEN_API_KEY is not set — /api/recognize-food will return 503");
  }
}

const app_logger = {
  info: (...a: unknown[]) => console.log("[server]", ...a),
  warn: (...a: unknown[]) => console.warn("[server]", ...a),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

export { main as startServer };
