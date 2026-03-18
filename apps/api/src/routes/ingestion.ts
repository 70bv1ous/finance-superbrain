import type { FastifyInstance } from "fastify";
import {
  coreHistoricalCorpusIngestionRequestSchema,
  creditHistoricalIngestionRequestSchema,
  energyHistoricalIngestionRequestSchema,
  historicalCaseLibraryItemSchema,
  earningsHistoricalIngestionRequestSchema,
  feedPullRequestSchema,
  historicalCaseLibraryIngestionRequestSchema,
  historicalHighConfidencePromotionRequestSchema,
  historicalCaseLibraryReviewRequestSchema,
  historicalIngestRequestSchema,
  type JsonValue,
  liveTranscriptProviderSchema,
  macroHistoricalIngestionRequestSchema,
  policyHistoricalIngestionRequestSchema,
  transcriptPullRequestSchema,
} from "@finance-superbrain/schemas";

import { ingestFeedBatch } from "../lib/feedIngestion.js";
import { ingestCoreHistoricalCorpus } from "../lib/coreHistoricalCorpus.js";
import { ingestCreditHistoricalCases } from "../lib/creditHistoricalLoader.js";
import { ingestEnergyHistoricalCases } from "../lib/energyHistoricalLoader.js";
import { ingestEarningsHistoricalCases } from "../lib/earningsHistoricalLoader.js";
import {
  HistoricalHighConfidencePromotionError,
  promoteHistoricalCaseToHighConfidence,
} from "../lib/historicalCaseConfidence.js";
import {
  reviewHistoricalCaseLibraryItem,
  ingestHistoricalCaseLibrary,
  listHistoricalCaseLibrary,
} from "../lib/historicalCaseLibrary.js";
import { ingestHistoricalCases } from "../lib/historicalIngest.js";
import { ingestLiveTranscriptWebhook } from "../lib/liveWebhookIngestion.js";
import { verifyLiveWebhookRequest } from "../lib/liveWebhookSecurity.js";
import { ingestMacroHistoricalCases } from "../lib/macroHistoricalLoader.js";
import { ingestPolicyHistoricalCases } from "../lib/policyHistoricalLoader.js";
import {
  resolveOperationTrigger,
  resolveRequestIdempotencyKey,
  resolveRouteExecutionMode,
  shouldQueueRouteExecution,
} from "../lib/routeExecutionMode.js";
import type { AppServices } from "../lib/services.js";
import { IntegrationGovernanceSuppressedError } from "../lib/systemIntegrationGovernanceReport.js";
import { ingestTranscriptBatch } from "../lib/transcriptIngestion.js";
import { enqueueOperationJobRequest } from "../lib/operationJobs.js";

const resolveRequestedExecutionMode = (request: { query?: unknown }) =>
  resolveRouteExecutionMode((request.query as { execution?: string } | undefined)?.execution);

const shouldQueueIngestionRoute = (request: { query?: unknown }, envFlag: string) =>
  shouldQueueRouteExecution({
    requested_mode: resolveRequestedExecutionMode(request),
    durable_by_default: true,
    env_flag: process.env[envFlag],
  });

const enqueueIngestionOperation = async (
  services: AppServices,
  request: { headers: Record<string, unknown> },
  operation_name: "feed_pull" | "transcript_pull",
  payload: Record<string, JsonValue>,
) => {
  const idempotencyKey = resolveRequestIdempotencyKey(request.headers);

  return enqueueOperationJobRequest(
    services,
    {
      operation_name,
      payload,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    },
    resolveOperationTrigger(request),
  );
};

const sendIntegrationSuppressed = (
  reply: { status: (code: number) => { send: (body: Record<string, unknown>) => unknown } },
  error: IntegrationGovernanceSuppressedError,
) =>
  reply.status(503).send({
    error: "integration_suppressed",
    message: error.message,
    integration: error.integration,
    retry_delay_seconds: error.retry_delay_seconds,
    governance: error.state,
  });

export const registerIngestionRoutes = async (
  server: FastifyInstance,
  services: AppServices,
) => {
  server.post("/v1/ingestion/historical/batch", async (request, reply) => {
    const parsedRequest = historicalIngestRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const result = await ingestHistoricalCases(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.post("/v1/ingestion/historical/library", async (request, reply) => {
    const parsedRequest = historicalCaseLibraryIngestionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const result = await ingestHistoricalCaseLibrary(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.post("/v1/ingestion/historical/core-corpus", async (request, reply) => {
    const parsedRequest = coreHistoricalCorpusIngestionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const result = await ingestCoreHistoricalCorpus(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.post("/v1/ingestion/historical/macro-calendar", async (request, reply) => {
    const parsedRequest = macroHistoricalIngestionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const result = await ingestMacroHistoricalCases(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.post("/v1/ingestion/historical/earnings", async (request, reply) => {
    const parsedRequest = earningsHistoricalIngestionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const result = await ingestEarningsHistoricalCases(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.post("/v1/ingestion/historical/energy", async (request, reply) => {
    const parsedRequest = energyHistoricalIngestionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const result = await ingestEnergyHistoricalCases(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.post("/v1/ingestion/historical/credit-banking", async (request, reply) => {
    const parsedRequest = creditHistoricalIngestionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const result = await ingestCreditHistoricalCases(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.post("/v1/ingestion/historical/policy-fx", async (request, reply) => {
    const parsedRequest = policyHistoricalIngestionRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const result = await ingestPolicyHistoricalCases(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.get("/v1/ingestion/historical/library", async (request) => {
    const query = (request.query as {
      limit?: string;
      case_pack?: string;
      case_ids?: string;
      case_quality?: string;
      needs_review?: string;
      reviewer?: string;
    } | undefined) ?? {};
    const rawLimit = Number(query.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, rawLimit)) : 50;
    const caseIds = query.case_ids
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const caseQualities = query.case_quality
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) as Array<"draft" | "reviewed" | "high_confidence"> | undefined;
    const needsReview =
      query.needs_review === undefined ? undefined : query.needs_review.toLowerCase() === "true";

    return listHistoricalCaseLibrary(services.repository, {
      limit,
      case_pack: query.case_pack?.trim() || undefined,
      case_ids: caseIds?.length ? caseIds : undefined,
      case_qualities:
        caseQualities?.length
          ? caseQualities
          : needsReview === true
            ? ["draft"]
            : needsReview === false
              ? ["reviewed", "high_confidence"]
              : undefined,
      reviewer: query.reviewer?.trim() || undefined,
    });
  });

  server.get("/v1/ingestion/historical/library/:caseId", async (request, reply) => {
    const caseId = (request.params as { caseId: string }).caseId;
    const item = await services.repository.getHistoricalCaseLibraryItem(caseId);

    if (!item) {
      return reply.status(404).send({
        error: "not_found",
        message: `Historical library case not found: ${caseId}`,
      });
    }

    return historicalCaseLibraryItemSchema.parse(item);
  });

  server.post("/v1/ingestion/historical/library/:caseId/review", async (request, reply) => {
    const caseId = (request.params as { caseId: string }).caseId;
    const parsedRequest = historicalCaseLibraryReviewRequestSchema.safeParse(request.body);

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
      const result = await reviewHistoricalCaseLibraryItem(services, caseId, parsedRequest.data);
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Historical library case not found")) {
        return reply.status(404).send({
          error: "not_found",
          message: error.message,
        });
      }

      throw error;
    }
  });

  server.post(
    "/v1/ingestion/historical/library/:caseId/promote-high-confidence",
    async (request, reply) => {
      const caseId = (request.params as { caseId: string }).caseId;
      const parsedRequest = historicalHighConfidencePromotionRequestSchema.safeParse(
        request.body,
      );

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
        const result = await promoteHistoricalCaseToHighConfidence(
          services,
          caseId,
          parsedRequest.data,
        );
        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof HistoricalHighConfidencePromotionError) {
          return reply.status(409).send({
            error: "promotion_blocked",
            message: error.message,
            candidate: error.candidate,
          });
        }

        if (error instanceof Error && error.message.includes("Historical library case not found")) {
          return reply.status(404).send({
            error: "not_found",
            message: error.message,
          });
        }

        throw error;
      }
    },
  );

  server.post("/v1/ingestion/feeds/pull", async (request, reply) => {
    const parsedRequest = feedPullRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (shouldQueueIngestionRoute(request, "QUEUE_DEFAULT_FEED_PULL")) {
      let job;

      try {
        job = await enqueueIngestionOperation(
          services,
          request,
          "feed_pull",
          parsedRequest.data as Record<string, JsonValue>,
        );
      } catch (error) {
        if (error instanceof IntegrationGovernanceSuppressedError) {
          return sendIntegrationSuppressed(reply, error);
        }

        throw error;
      }

      return reply.status(202).send(job);
    }

    const result = await ingestFeedBatch(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.post("/v1/ingestion/transcripts/pull", async (request, reply) => {
    const parsedRequest = transcriptPullRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (shouldQueueIngestionRoute(request, "QUEUE_DEFAULT_TRANSCRIPT_PULL")) {
      let job;

      try {
        job = await enqueueIngestionOperation(
          services,
          request,
          "transcript_pull",
          parsedRequest.data as Record<string, JsonValue>,
        );
      } catch (error) {
        if (error instanceof IntegrationGovernanceSuppressedError) {
          return sendIntegrationSuppressed(reply, error);
        }

        throw error;
      }

      return reply.status(202).send(job);
    }

    const result = await ingestTranscriptBatch(services, parsedRequest.data);
    return reply.status(201).send(result);
  });

  server.post("/v1/ingestion/live/webhooks/:provider", async (request, reply) => {
    const provider = liveTranscriptProviderSchema.safeParse(
      (request.params as { provider: string }).provider,
    );

    if (!provider.success) {
      return reply.status(400).send({
        error: "invalid_provider",
        message: "Unsupported live transcript provider.",
      });
    }

    const verification = verifyLiveWebhookRequest(provider.data, request.headers);

    if (!verification.ok) {
      return reply.status(verification.status_code).send({
        error: verification.status_code === 401 ? "unauthorized" : "configuration_error",
        message: verification.message,
      });
    }

    try {
      const result = await ingestLiveTranscriptWebhook(services, provider.data, request.body);
      return reply.status(result.chunk_appended ? 201 : 202).send(result);
    } catch (error) {
      return reply.status(400).send({
        error: "invalid_request",
        message: error instanceof Error ? error.message : "Failed to ingest live transcript webhook.",
      });
    }
  });
};
