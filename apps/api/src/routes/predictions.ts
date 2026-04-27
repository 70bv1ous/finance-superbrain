import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  createStoredPredictionsRequestSchema,
  postmortemResponseSchema,
  predictionDetailSchema,
  predictionOutcomeSchema,
  sharedReviewNoteSchema,
  saveReviewNoteRequestSchema,
  scorePredictionRequestSchema,
  storedPredictionsResponseSchema,
  storedPredictionSchema,
} from "@finance-superbrain/schemas";

import { generateCalibratedPredictionSet } from "../lib/analogs.js";
import { createPostmortem } from "../lib/createPostmortem.js";
import { buildLessonMemoryText } from "../lib/lessonMemory.js";
import { scorePrediction } from "../lib/scorePrediction.js";
import type { AppServices } from "../lib/services.js";
import { requireWorkspaceSession, resolveWorkspaceSession } from "../lib/workspaceAuth.js";

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

    const event = await services.repository.getEvent(prediction.event_id);

    if (!event) {
      return reply.status(500).send({
        error: "prediction_event_missing",
        message: "Prediction event context is missing.",
      });
    }

    const source = await services.repository.getSource(event.source_id);

    if (!source) {
      return reply.status(500).send({
        error: "prediction_source_missing",
        message: "Prediction source context is missing.",
      });
    }

    const detail = {
      prediction,
      outcome: await services.repository.getOutcomeByPredictionId(predictionId),
      postmortem: await services.repository.getPostmortemByPredictionId(predictionId),
      event,
      source,
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

    const workspaceSession = await resolveWorkspaceSession(request, services);
    const workspace = await services.repository.getOrCreateDefaultWorkspace();
    const updatedAt = new Date().toISOString();
    const investigations = await services.repository.listSharedInvestigations({
      workspace_id: workspace.id,
      limit: 64,
    });

    const matchingInvestigations = investigations.filter((investigation) =>
      investigation.prediction_ids.includes(predictionId),
    );

    for (const investigation of matchingInvestigations) {
      const { steps, ...investigationInput } = investigation;
      const actorUserId =
        workspaceSession.authenticated && workspaceSession.user
          ? workspaceSession.user.id
          : investigation.last_actor_user_id;
      const nextSteps = steps.map((step) =>
        step.id.includes(predictionId)
          ? {
              ...step,
              status: "reviewed" as const,
              updated_at: updatedAt,
            }
          : step,
      );

      await services.repository.saveSharedInvestigation({
        ...investigationInput,
        status: "reviewed",
        last_actor_user_id: actorUserId,
        updated_at: updatedAt,
      });
      await services.repository.replaceSharedInvestigationSteps({
        investigation_id: investigation.id,
        steps: nextSteps,
      });

      if (workspaceSession.authenticated && workspaceSession.user) {
        await services.repository.saveWorkspaceActivity({
          id: randomUUID(),
          workspace_id: workspace.id,
          actor_user_id: workspaceSession.user.id,
          kind: "investigation_updated",
          investigation_id: investigation.id,
          studio_run_id: null,
          prediction_id: predictionId,
          detail: `Investigation ${investigation.title} completed the review loop.`,
          metadata: {
            status: "reviewed",
            source: "postmortem",
          },
          created_at: updatedAt,
        });
      }
    }

    return reply.status(201).send(postmortemResponseSchema.parse(response));
  });

  server.post("/v1/predictions/:predictionId/review-notes", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const predictionId = (request.params as { predictionId: string }).predictionId;
    const prediction = await services.repository.getPrediction(predictionId);

    if (!prediction) {
      return reply.status(404).send({ error: "not_found", message: "Prediction not found." });
    }

    const parsed = saveReviewNoteRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const note = await services.repository.saveSharedReviewNote({
      workspace_id: session.workspace.id,
      prediction_id: predictionId,
      note: parsed.data.note,
      owner_user_id: session.user.id,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "review_note_saved",
      investigation_id: null,
      studio_run_id: null,
      prediction_id: predictionId,
      detail: `Review notes saved for prediction ${predictionId}.`,
      metadata: {},
      created_at: new Date().toISOString(),
    });

    return reply.status(201).send(note);
  });

  server.get("/v1/predictions/:predictionId/review-notes", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const predictionId = (request.params as { predictionId: string }).predictionId;
    const note = await services.repository.getSharedReviewNote({
      workspace_id: session.workspace.id,
      prediction_id: predictionId,
    });

    return reply.status(200).send(note ? sharedReviewNoteSchema.parse(note) : null);
  });
};
