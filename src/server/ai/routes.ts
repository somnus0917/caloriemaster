/**
 * AI and Boohee proxy routes. Both endpoints are gated by:
 *   - requireAuth  (must be logged in)
 *   - per-user + per-IP rate limit
 *   - per-user daily quota (DB-backed)
 *
 * /api/recognize-food additionally:
 *   - caps the body at MAX_BODY_BYTES
 *   - validates the image data URL
 *   - always builds the upstream Qwen request server-side
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { ErrorCode, sendError } from "../errors.js";
import { requireAuth, requireAuthedUser } from "../auth/middleware.js";
import {
  DEFAULT_QWEN_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  MAX_BODY_BYTES,
  parseImageDataUrl,
  validateRecognizeBody,
} from "./validation.js";
import { getDb } from "../db/client.js";
import { aiUsage } from "../db/schema.js";
import { eq } from "drizzle-orm";

const FETCH_TIMEOUT_MS = 30_000;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function consumeAiQuota(userId: string, limit: number): Promise<
  | { ok: true; count: number }
  | { ok: false; count: number; limit: number }
> {
  const db = getDb();
  // Upsert and atomically bump the count, returning the new total.
  const rows = await db
    .insert(aiUsage)
    .values({ userId, date: todayUtc(), count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.date],
      set: { count: sql`${aiUsage.count} + 1` },
    })
    .returning({ count: aiUsage.count });
  const count = rows[0]?.count ?? 1;
  if (count > limit) {
    // Roll back the over-count so the next request doesn't carry the debt.
    await db
      .update(aiUsage)
      .set({ count: sql`${aiUsage.count} - 1` })
      .where(eq(aiUsage.userId, userId))
      .returning();
    return { ok: false, count: count - 1, limit };
  }
  return { ok: true, count };
}

export async function registerAiRoutes(
  app: FastifyInstance,
  limiters: { perUserPerMinute: { hit: (k: string) => { ok: true } | { ok: false; retryAfter: number } }; perIpPerMinute: { hit: (k: string) => { ok: true } | { ok: false; retryAfter: number } } },
): Promise<void> {
  const config = loadConfig();

  app.post(
    "/api/recognize-food",
    {
      preHandler: requireAuth,
      bodyLimit: MAX_BODY_BYTES,
    },
    async (request, reply) => {
      const user = requireAuthedUser(request);
      const ip = request.ip || "unknown";

      const userCheck = limiters.perUserPerMinute.hit(`u:${user.id}`);
      if (!userCheck.ok) {
        reply.header("Retry-After", String(userCheck.retryAfter));
        return sendError(reply, 429, ErrorCode.RATE_LIMITED, "请求过于频繁，请稍后再试");
      }
      const ipCheck = limiters.perIpPerMinute.hit(`ip:${ip}`);
      if (!ipCheck.ok) {
        reply.header("Retry-After", String(ipCheck.retryAfter));
        return sendError(reply, 429, ErrorCode.RATE_LIMITED, "请求过于频繁，请稍后再试");
      }
      const quota = await consumeAiQuota(user.id, config.AI_DAILY_QUOTA);
      if (!quota.ok) {
        return sendError(
          reply,
          429,
          ErrorCode.DAILY_QUOTA_EXCEEDED,
          `今日识别次数已达上限（${quota.limit} 次）`,
        );
      }

      if (!config.QWEN_API_KEY) {
        return sendError(reply, 503, ErrorCode.QWEN_NOT_CONFIGURED, "服务端未配置 QWEN_API_KEY");
      }

      const contentType = String(request.headers["content-type"] || "").toLowerCase();
      if (!contentType.startsWith("application/json")) {
        return sendError(reply, 415, ErrorCode.UNSUPPORTED_MEDIA, "Content-Type 必须为 application/json");
      }

      // Fastify's bodyLimit above guarantees we never read more than
      // MAX_BODY_BYTES. body is already parsed JSON.
      const validation = validateRecognizeBody(request.body);
      if (!validation.ok) {
        const status = validation.code === "UNSUPPORTED_MEDIA" ? 415 : 400;
        return sendError(reply, status, validation.code, validation.message);
      }

      const upstreamBody = {
        model: config.QWEN_MODEL || DEFAULT_QWEN_MODEL,
        messages: [
          { role: "system", content: DEFAULT_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${validation.mime};base64,${validation.base64}` },
              },
              { type: "text", text: "请分析这张食物图片，识别所有食物并估算热量。" },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      };

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      let upstream: Response;
      try {
        upstream = await fetch(config.QWEN_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.QWEN_API_KEY}`,
          },
          body: JSON.stringify(upstreamBody),
          signal: ac.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = (err as { name?: string })?.name === "AbortError";
        return sendError(
          reply,
          isTimeout ? 504 : 502,
          isTimeout ? ErrorCode.UPSTREAM_TIMEOUT : ErrorCode.UPSTREAM_ERROR,
          isTimeout ? "AI 服务超时" : "AI 服务暂时不可用",
        );
      }
      clearTimeout(timer);

      let upstreamJson: { choices?: Array<{ message?: { content?: string } }> };
      try {
        upstreamJson = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
      } catch {
        return sendError(reply, 502, ErrorCode.UPSTREAM_ERROR, "AI 服务返回数据无法解析");
      }
      const content = upstreamJson.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        return sendError(reply, 502, ErrorCode.UPSTREAM_ERROR, "AI 服务未返回识别结果");
      }
      return reply.send({ content });
    },
  );

  app.get(
    "/api/boohee",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = requireAuthedUser(request);
      if (!config.BOOHEE_API_KEY) {
        return sendError(reply, 503, ErrorCode.BOOHEE_NOT_CONFIGURED, "服务端未配置 BOOHEE_API_KEY");
      }
      const code = (request.query as { code?: string }).code;
      if (typeof code !== "string" || code.length === 0 || code.length > 100) {
        return sendError(reply, 400, ErrorCode.INVALID_REQUEST, "缺少 code 查询参数");
      }
      const target = `${config.BOOHEE_API_URL}/v1/food/detail?code=${encodeURIComponent(code)}&with_units=true&with_materials=true`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      let upstream: Response;
      try {
        upstream = await fetch(target, {
          method: "GET",
          headers: {
            "X-Api-Key": config.BOOHEE_API_KEY,
            "Content-Type": "application/json",
          },
          signal: ac.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = (err as { name?: string })?.name === "AbortError";
        return sendError(
          reply,
          isTimeout ? 504 : 502,
          isTimeout ? ErrorCode.UPSTREAM_TIMEOUT : ErrorCode.UPSTREAM_ERROR,
          isTimeout ? "营养数据库超时" : "营养数据库暂时不可用",
        );
      }
      clearTimeout(timer);
      // Sanitise the upstream payload to make sure we never echo API
      // keys or other sensitive headers.
      const body = await upstream.json().catch(() => ({}));
      void user;
      return reply.code(upstream.status).send(body);
    },
  );
}

void parseImageDataUrl;
