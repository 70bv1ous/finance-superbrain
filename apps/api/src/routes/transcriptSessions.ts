import type { FastifyInstance } from "fastify";
import {
  createTranscriptChunkRequestSchema,
  createTranscriptSessionRequestSchema,
  transcriptSessionAnalysisSchema,
  transcriptSessionDetailSchema,
  storedTranscriptSessionSchema,
} from "@finance-superbrain/schemas";

import { appendChunkAndAnalyze } from "../lib/liveTranscriptSessions.js";
import type { AppServices } from "../lib/services.js";

export const registerTranscriptSessionRoutes = async (
  server: FastifyInstance,
  services: AppServices,
) => {
  server.post("/v1/transcript-sessions", async (request, reply) => {
    const parsedRequest = createTranscriptSessionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const session = await services.repository.createTranscriptSession(parsedRequest.data);
    return reply.status(201).send(storedTranscriptSessionSchema.parse(session));
  });

  server.get("/v1/transcript-sessions/:sessionId", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = await services.repository.getTranscriptSession(sessionId);

    if (!session) {
      return reply.status(404).send({ error: "not_found", message: "Transcript session not found." });
    }

    const chunks = await services.repository.listTranscriptSessionChunks(sessionId);
    const latestAnalysis = await services.repository.getLatestTranscriptSessionAnalysis(sessionId);

    return reply.status(200).send(
      transcriptSessionDetailSchema.parse({
        session,
        chunk_count: chunks.length,
        latest_analysis: latestAnalysis,
      }),
    );
  });

  server.get("/v1/transcript-sessions/:sessionId/analysis", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = await services.repository.getTranscriptSession(sessionId);

    if (!session) {
      return reply.status(404).send({ error: "not_found", message: "Transcript session not found." });
    }

    const latestAnalysis = await services.repository.getLatestTranscriptSessionAnalysis(sessionId);

    if (!latestAnalysis) {
      return reply.status(404).send({
        error: "not_found",
        message: "Transcript session has no analysis yet.",
      });
    }

    return reply.status(200).send(transcriptSessionAnalysisSchema.parse(latestAnalysis));
  });

  server.post("/v1/transcript-sessions/:sessionId/chunks", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = await services.repository.getTranscriptSession(sessionId);

    if (!session) {
      return reply.status(404).send({ error: "not_found", message: "Transcript session not found." });
    }

    const parsedRequest = createTranscriptChunkRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (session.status === "closed") {
      return reply.status(409).send({
        error: "session_closed",
        message: "Transcript session is already closed.",
      });
    }

    const analysis = await appendChunkAndAnalyze(services.repository, session, parsedRequest.data);
    return reply.status(201).send(transcriptSessionAnalysisSchema.parse(analysis));
  });

  server.post("/v1/transcript-sessions/:sessionId/close", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = await services.repository.updateTranscriptSessionStatus(sessionId, "closed");

    if (!session) {
      return reply.status(404).send({ error: "not_found", message: "Transcript session not found." });
    }

    const chunks = await services.repository.listTranscriptSessionChunks(sessionId);
    const latestAnalysis = await services.repository.getLatestTranscriptSessionAnalysis(sessionId);

    return reply.status(200).send(
      transcriptSessionDetailSchema.parse({
        session,
        chunk_count: chunks.length,
        latest_analysis: latestAnalysis,
      }),
    );
  });
};
