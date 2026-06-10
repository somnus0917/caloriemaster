/**
 * /api/records routes. All routes require auth and are scoped to
 * the logged-in user.
 */
import type { FastifyInstance } from "fastify";
import { handleApiError, sendError, ErrorCode } from "../errors.js";
import { requireAuth, requireAuthedUser } from "../auth/middleware.js";
import {
  createRecord,
  deleteRecord,
  getRecord,
  importRecords,
  listRecords,
  updateRecord,
} from "./service.js";
import { z } from "zod";

const ListQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function registerRecordRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/records", { preHandler: requireAuth }, async (request, reply) => {
    const user = requireAuthedUser(request);
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, ErrorCode.INVALID_REQUEST, "查询参数不合法");
    }
    try {
      const records = await listRecords(user.id, parsed.data);
      return reply.send({ records });
    } catch (err) {
      return handleApiError(reply, err);
    }
  });

  app.post("/api/records", { preHandler: requireAuth }, async (request, reply) => {
    const user = requireAuthedUser(request);
    try {
      const record = await createRecord(user.id, request.body);
      return reply.code(201).send({ record });
    } catch (err) {
      return handleApiError(reply, err);
    }
  });

  app.put("/api/records/:id", { preHandler: requireAuth }, async (request, reply) => {
    const user = requireAuthedUser(request);
    const { id } = request.params as { id: string };
    try {
      const record = await updateRecord(user.id, id, request.body);
      return reply.send({ record });
    } catch (err) {
      return handleApiError(reply, err);
    }
  });

  app.delete("/api/records/:id", { preHandler: requireAuth }, async (request, reply) => {
    const user = requireAuthedUser(request);
    const { id } = request.params as { id: string };
    try {
      const removed = await deleteRecord(user.id, id);
      return reply.send({ record: removed });
    } catch (err) {
      return handleApiError(reply, err);
    }
  });

  app.post("/api/records/import", { preHandler: requireAuth }, async (request, reply) => {
    const user = requireAuthedUser(request);
    try {
      const result = await importRecords(user.id, request.body);
      return reply.send(result);
    } catch (err) {
      return handleApiError(reply, err);
    }
  });

  app.get("/api/records/:id", { preHandler: requireAuth }, async (request, reply) => {
    const user = requireAuthedUser(request);
    const { id } = request.params as { id: string };
    const record = await getRecord(user.id, id);
    if (!record) {
      return sendError(reply, 404, ErrorCode.RECORD_NOT_FOUND, "记录不存在");
    }
    return reply.send({ record });
  });
}
