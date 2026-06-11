/**
 * Centralised environment parsing with Zod. Loaded exactly once at
 * server startup; subsequent code imports `config` instead of reading
 * `process.env` ad-hoc.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const NODE_ENV = z.enum(["development", "production", "test"]).default("development");

const ConfigSchema = z
  .object({
    NODE_ENV,
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default("0.0.0.0"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    /**
     * Single page origin. Used for CSRF Origin/Referer checks and to
     * scope the session cookie. In development the SPA is served by
     * Vite on 5173, so APP_ORIGIN must be that.
     */
    APP_ORIGIN: z.string().url(),
    /**
     * When behind Caddy / Nginx / Cloudflare, set to `true` so Fastify
     * trusts the X-Forwarded-* headers (req.ip, req.protocol).
     */
    TRUST_PROXY: z
      .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
      .default("false")
      .transform((v) => v === "true" || v === "1"),

    SESSION_COOKIE_NAME: z.string().min(1).default("caloriemaster_session"),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    QWEN_API_KEY: z.string().default(""),
    QWEN_MODEL: z.string().default("qwen3-vl-flash"),
    QWEN_API_URL: z
      .string()
      .url()
      .default("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),

    BOOHEE_API_KEY: z.string().default(""),
    BOOHEE_API_URL: z.string().url().default("https://api.boohee.com"),

    /**
     * Aliyun OSS. All values live only on the server. The keys MUST
     * never be exposed via `VITE_` or any other prefix that the
     * Vite bundler would inline into the client.
     */
    OSS_REGION: z.string().default(""),
    OSS_BUCKET: z.string().default(""),
    /** Public endpoint used for signed GET URLs the browser loads from. */
    OSS_PUBLIC_ENDPOINT: z
      .string()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined))
      .pipe(z.string().url().optional()),
    /** Optional internal endpoint (same-region ECS) used for upload/delete. */
    OSS_INTERNAL_ENDPOINT: z
      .string()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined))
      .pipe(z.string().url().optional()),
    OSS_ACCESS_KEY_ID: z.string().default(""),
    OSS_ACCESS_KEY_SECRET: z.string().default(""),
    OSS_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),

    AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(5),
    AI_DAILY_QUOTA: z.coerce.number().int().min(1).default(100),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    AI_IP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),

    /**
     * Run Drizzle migrations automatically on startup. Off in production
     * to avoid surprising schema changes; on in dev / test for DX.
     */
    AUTO_MIGRATE: z
      .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
      .default("false")
      .transform((v) => v === "true" || v === "1"),
  })
  .refine(
    (c) => c.NODE_ENV === "development" || c.QWEN_API_KEY.length > 0 || c.NODE_ENV === "test",
    {
      // We allow missing QWEN key in development/test so contributors can
      // poke the API surface without burning real credits. Production
      // must have it configured.
      path: ["QWEN_API_KEY"],
      message: "QWEN_API_KEY is required in production",
    },
  )
  .refine(
    (c) => {
      // If the user wants image storage, they must configure OSS.
      // We only treat OSS as "required" when at least one variable
      // is set — if no OSS vars are provided we still let the app
      // boot (image features degrade to "no image" only).
      const anyOssVar = c.OSS_REGION || c.OSS_BUCKET || c.OSS_ACCESS_KEY_ID;
      if (!anyOssVar) return true;
      if (c.NODE_ENV === "test") return true;
      return Boolean(c.OSS_REGION && c.OSS_BUCKET && c.OSS_ACCESS_KEY_ID && c.OSS_ACCESS_KEY_SECRET);
    },
    {
      path: ["OSS_ACCESS_KEY_SECRET"],
      message:
        "OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET must all be set together",
    },
  );

export type AppConfig = z.infer<typeof ConfigSchema>;

let _config: AppConfig | null = null;
let _envFileLoaded = false;

function loadLocalEnvFile(): void {
  if (_envFileLoaded) return;
  _envFileLoaded = true;
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    loadLocalEnvFile();
  }
  if (_config) return _config;
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  _config = parsed.data;
  return _config;
}

export function resetConfigForTests(): void {
  _config = null;
}
