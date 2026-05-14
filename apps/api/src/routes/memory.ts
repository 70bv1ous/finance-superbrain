import type { FastifyInstance } from "fastify";

import { buildMemoryConnections } from "../lib/memoryConnections.js";
import type { AppServices } from "../lib/services.js";

export const registerMemoryRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.get("/v1/memory/connections", async (request) => {
    const rawLimit = Number((request.query as { limit?: string }).limit ?? "24");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.trunc(rawLimit), 50)) : 24;

    return buildMemoryConnections(services.repository, limit);
  });
};
