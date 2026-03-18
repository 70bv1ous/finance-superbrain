import type { FastifyInstance } from "fastify";
import {
  eventAnalogsResponseSchema,
  generatePredictionRequestSchema,
  generatePredictionResponseSchema,
  parseEventRequestSchema,
  parsedEventSchema,
} from "@finance-superbrain/schemas";

import { findEventAnalogs, generateCalibratedPredictionSet } from "../lib/analogs.js";
import { parseFinanceEvent } from "../lib/parseFinanceEvent.js";
import type { AppServices } from "../lib/services.js";

export const registerEventRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.post("/v1/events/parse", async (request, reply) => {
    const parsedRequest = parseEventRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const parsedEvent = parseFinanceEvent(parsedRequest.data);
    const validatedResponse = parsedEventSchema.parse(parsedEvent);

    return reply.status(200).send(validatedResponse);
  });

  server.post("/v1/predictions/generate", async (request, reply) => {
    const parsedRequest = generatePredictionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const generated = await generateCalibratedPredictionSet(services.repository, parsedRequest.data);

    const validatedResponse = generatePredictionResponseSchema.parse(generated);

    return reply.status(200).send(validatedResponse);
  });

  server.get("/v1/events/:eventId/analogs", async (request, reply) => {
    const eventId = (request.params as { eventId: string }).eventId;
    const event = await services.repository.getEvent(eventId);

    if (!event) {
      return reply.status(404).send({ error: "not_found", message: "Event not found." });
    }

    const analogs = await findEventAnalogs(services.repository, event);

    return reply.status(200).send(
      eventAnalogsResponseSchema.parse({
        event_id: event.id,
        analogs,
      }),
    );
  });
};
