import type { FastifyInstance } from "fastify";
import {
  createStoredPredictionsRequestSchema,
  postmortemResponseSchema,
  predictionDetailSchema,
  predictionOutcomeSchema,
  scorePredictionRequestSchema,
  storedPredictionsResponseSchema,
  storedPredictionSchema,
} from "@finance-superbrain/schemas";

import { generateCalibratedPredictionSet } from "../lib/analogs.js";
import { createPostmortem } from "../lib/createPostmortem.js";
import { buildLessonMemoryText } from "../lib/lessonMemory.js";
import { scorePrediction } from "../lib/scorePrediction.js";
import type { AppServices } from "../lib/services.js";

export const registerPredictionRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.post("/v1/events/:eventId/predictions", async (request, reply) => {
    const eventId = (request.params as { eventId: string }).eventId;
    const event = await services.repository.getEvent(eventId);

    if (!event) {
      return reply.status(404).send({ error: "not_found", message: "Event not found." });
    }

    const parsedRequest = createStoredPredictionsRequestSchema.safeParse(request.body ?? {});

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const generatedPredictions = (
      await generateCalibratedPredictionSet(services.repository, {
        event,
        horizons: parsedRequest.data.horizons,
        model_version: parsedRequest.data.model_version,
      })
    ).predictions;

    const storedPredictions = await Promise.all(
      generatedPredictions.map((prediction) =>
        services.repository.createPrediction(event.id, {
          ...prediction,
          model_version: parsedRequest.data.model_version,
        }),
      ),
    );

    return reply.status(201).send(storedPredictionsResponseSchema.parse({
      predictions: storedPredictions.map((prediction) => storedPredictionSchema.parse(prediction)),
    }));
  });

  server.get("/v1/predictions/:predictionId", async (request, reply) => {
    const predictionId = (request.params as { predictionId: string }).predictionId;
    const prediction = await services.repository.getPrediction(predictionId);

    if (!prediction) {
      return reply.status(404).send({ error: "not_found", message: "Prediction not found." });
    }

    const detail = {
      prediction,
      outcome: await services.repository.getOutcomeByPredictionId(predictionId),
      postmortem: await services.repository.getPostmortemByPredictionId(predictionId),
    };

    return reply.status(200).send(predictionDetailSchema.parse(detail));
  });

  server.post("/v1/predictions/:predictionId/score", async (request, reply) => {
    const predictionId = (request.params as { predictionId: string }).predictionId;
    const prediction = await services.repository.getPrediction(predictionId);

    if (!prediction) {
      return reply.status(404).send({ error: "not_found", message: "Prediction not found." });
    }

    const parsedRequest = scorePredictionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const outcome = scorePrediction(prediction, parsedRequest.data);
    await services.repository.saveOutcome(outcome);
    await services.repository.updatePredictionStatus(predictionId, "scored");

    return reply.status(201).send(predictionOutcomeSchema.parse(outcome));
  });

  server.post("/v1/predictions/:predictionId/postmortem", async (request, reply) => {
    const predictionId = (request.params as { predictionId: string }).predictionId;
    const prediction = await services.repository.getPrediction(predictionId);
    const outcome = await services.repository.getOutcomeByPredictionId(predictionId);

    if (!prediction) {
      return reply.status(404).send({ error: "not_found", message: "Prediction not found." });
    }

    if (!outcome) {
      return reply.status(409).send({
        error: "missing_outcome",
        message: "Score the prediction before requesting a post-mortem.",
      });
    }

    const response = createPostmortem(prediction, outcome);
    await services.repository.savePostmortem(response.postmortem);
    const lessonEmbedding = await services.embeddingProvider.embedText(
      buildLessonMemoryText({
        prediction,
        postmortem: response.postmortem,
        lesson: response.lesson,
      }),
    );
    await services.repository.saveLesson(response.lesson, lessonEmbedding);
    await services.repository.updatePredictionStatus(predictionId, "reviewed");

    return reply.status(201).send(postmortemResponseSchema.parse(response));
  });
};
