import type { FastifyInstance } from "fastify";
import {
  applyReplayTuningRequestSchema,
  applyReplayTuningResponseSchema,
  createModelVersionRequestSchema,
  listModelVersionsResponseSchema,
  replayPromotionRequestSchema,
  storedPromotionEvaluationSchema,
  storedModelVersionSchema,
} from "@finance-superbrain/schemas";

import { applyHistoricalReplayTuning } from "../lib/applyHistoricalReplayTuning.js";
import { evaluateReplayPromotion } from "../lib/evaluateReplayPromotion.js";
import type { AppServices } from "../lib/services.js";

export const registerModelRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.post("/v1/models", async (request, reply) => {
    const parsedRequest = createModelVersionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const model = await services.repository.saveModelVersion(parsedRequest.data);
    return reply.status(201).send(storedModelVersionSchema.parse(model));
  });

  server.get("/v1/models", async () =>
    listModelVersionsResponseSchema.parse({
      models: await services.repository.listModelVersions(),
    }));

  server.get("/v1/models/:modelVersion", async (request, reply) => {
    const modelVersion = (request.params as { modelVersion: string }).modelVersion;
    const model = await services.repository.getModelVersion(modelVersion);

    if (!model) {
      return reply.status(404).send({ error: "not_found", message: "Model version not found." });
    }

    return reply.status(200).send(storedModelVersionSchema.parse(model));
  });

  server.post("/v1/models/:modelVersion/tune-from-replay", async (request, reply) => {
    const modelVersion = (request.params as { modelVersion: string }).modelVersion;
    const parsedRequest = applyReplayTuningRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    return reply.status(201).send(
      applyReplayTuningResponseSchema.parse(
        await applyHistoricalReplayTuning(services.repository, modelVersion, parsedRequest.data),
      ),
    );
  });

  server.post("/v1/models/:modelVersion/promotion-gate", async (request, reply) => {
    const modelVersion = (request.params as { modelVersion: string }).modelVersion;
    const parsedRequest = replayPromotionRequestSchema.safeParse(request.body ?? {});

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    try {
      return reply.status(200).send(
        storedPromotionEvaluationSchema.parse(
          await evaluateReplayPromotion(services.repository, modelVersion, parsedRequest.data),
        ),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Benchmark pack") &&
        error.message.includes("incomplete")
      ) {
        return reply.status(409).send({
          error: "benchmark_pack_incomplete",
          message: error.message,
        });
      }

      if (
        error instanceof Error &&
        (error.message.includes("Insufficient dated cases") ||
          error.message.includes("Walk-forward validation"))
      ) {
        return reply.status(409).send({
          error: "walk_forward_unavailable",
          message: error.message,
        });
      }

      throw error;
    }
  });
};
