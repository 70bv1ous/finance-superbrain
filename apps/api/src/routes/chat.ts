/**
 * Chat routes (Phase 8A — Intelligence Chat API).
 *
 * POST /v1/chat — accepts a natural-language trader query and returns a
 * structured, analyst-quality response backed by the intelligence layer.
 */

import type { FastifyInstance } from "fastify";
import type { AppServices } from "../lib/services.js";
import { processChat } from "../lib/chatService.js";

export const registerChatRoutes = async (
  server: FastifyInstance,
  services: AppServices,
): Promise<void> => {
  server.post("/v1/chat", async (request, reply) => {
    // ── API key guard ──────────────────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return reply.status(503).send({
        error:   "service_unavailable",
        message: "Intelligence service not configured.",
      });
    }

    // ── Input validation ───────────────────────────────────────────────────
    const body = request.body as { query?: unknown; session_id?: unknown };

    if (!body?.query || typeof body.query !== "string" || body.query.trim().length === 0) {
      return reply.status(400).send({
        error:   "invalid_request",
        message: "query is required and must be a non-empty string.",
      });
    }

    if (body.query.length > 2000) {
      return reply.status(400).send({
        error:   "invalid_request",
        message: "query must be 2000 characters or fewer.",
      });
    }

    // ── Delegate to service ────────────────────────────────────────────────
    const response = await processChat(
      {
        query:      body.query.trim(),
        session_id: typeof body.session_id === "string" ? body.session_id : undefined,
      },
      services.repository,
      apiKey,
      services.embeddingProvider,
    );

    return reply.status(200).send(response);
  });
};
