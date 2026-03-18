import type { FastifyInstance } from "fastify";
import { createSourceRequestSchema, storedEventSchema, storedSourceSchema } from "@finance-superbrain/schemas";

import { parseFinanceEvent } from "../lib/parseFinanceEvent.js";
import type { AppServices } from "../lib/services.js";

export const registerSourceRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.post("/v1/sources", async (request, reply) => {
    const parsedRequest = createSourceRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const source = await services.repository.createSource(parsedRequest.data);
    return reply.status(201).send(storedSourceSchema.parse(source));
  });

  server.post("/v1/sources/:sourceId/parse", async (request, reply) => {
    const sourceId = (request.params as { sourceId: string }).sourceId;
    const source = await services.repository.getSource(sourceId);

    if (!source) {
      return reply.status(404).send({ error: "not_found", message: "Source not found." });
    }

    const parsedEvent = parseFinanceEvent(source);
    const storedEvent = await services.repository.createEvent(source.id, parsedEvent);

    return reply.status(201).send(storedEventSchema.parse(storedEvent));
  });
};
