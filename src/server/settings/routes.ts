/**
 * /api/settings routes.
 */
import type { FastifyInstance } from "fastify";
import { handleApiError } from "../errors.js";
import { requireAuth, requireAuthedUser } from "../auth/middleware.js";
import { getOrCreateSettings, updateSettings } from "./service.js";

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", { preHandler: requireAuth }, async (request, reply) => {
    const user = requireAuthedUser(request);
    try {
      const settings = await getOrCreateSettings(user.id);
      return reply.send({ settings });
    } catch (err) {
      return handleApiError(reply, err);
    }
  });

  app.put("/api/settings", { preHandler: requireAuth }, async (request, reply) => {
    const user = requireAuthedUser(request);
    try {
      const body = (request.body ?? {}) as Parameters<typeof updateSettings>[1];
      const settings = await updateSettings(user.id, body);
      return reply.send({ settings });
    } catch (err) {
      return handleApiError(reply, err);
    }
  });
}
