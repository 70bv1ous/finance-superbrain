import type { FastifyInstance } from "fastify";
import {
  benchmarkReplaySnapshotRequestSchema,
  benchmarkTrustRefreshRequestSchema,
  autoScoreRequestSchema,
  calibrationSnapshotRequestSchema,
  evolutionCycleRequestSchema,
  evolutionScheduleUpdateRequestSchema,
  growthPressureActionDecisionRequestSchema,
  growthPressureAlertAcknowledgeRequestSchema,
  growthPressureAlertHandleRequestSchema,
  growthPressureAlertSnoozeRequestSchema,
  growthPressurePolicyListResponseSchema,
  growthPressurePolicyUpsertRequestSchema,
  historicalHighConfidenceSeedRequestSchema,
  moltCycleRequestSchema,
  operationJobEnqueueRequestSchema,
  operationJobListResponseSchema,
  type JsonValue,
  promotionCycleRequestSchema,
  selfAuditRequestSchema,
  type OperationRunStatus,
  type SystemOperationName,
  walkForwardReplaySnapshotRequestSchema,
} from "@finance-superbrain/schemas";

import { autoScorePredictions } from "../lib/autoScorePredictions.js";
import { captureBenchmarkReplaySnapshot } from "../lib/benchmarkReplaySnapshot.js";
import { refreshBenchmarkTrust } from "../lib/benchmarkTrustRefresh.js";
import { captureCalibrationSnapshot } from "../lib/captureCalibrationSnapshot.js";
import { runCoreHighConfidenceSeed } from "../lib/coreHighConfidenceSeed.js";
import {
  acknowledgeGrowthPressureAlert,
  approveGrowthPressureActionPlan,
  blockGrowthPressureActionPlan,
  handleGrowthPressureAlert,
  snoozeGrowthPressureAlert,
} from "../lib/growthPressureManagement.js";
import {
  saveGrowthPressurePolicy,
} from "../lib/growthPressurePolicies.js";
import {
  resolveEvolutionScheduleConfig,
  runScheduledEvolution,
  saveEvolutionScheduleConfig,
} from "../lib/evolutionSchedule.js";
import {
  buildOperationLockScope,
  enqueueOperationJobRequest,
} from "../lib/operationJobs.js";
import { OperationLeaseConflictError, runTrackedOperation } from "../lib/operationRuns.js";
import {
  resolveOperationTrigger,
  resolveRequestIdempotencyKey,
  resolveRouteExecutionMode,
  shouldQueueRouteExecution,
} from "../lib/routeExecutionMode.js";
import { runEvolutionCycle } from "../lib/runEvolutionCycle.js";
import { runMoltCycle } from "../lib/runMoltCycle.js";
import { runPromotionCycle } from "../lib/runPromotionCycle.js";
import { runSelfAudit } from "../lib/runSelfAudit.js";
import { IntegrationGovernanceSuppressedError } from "../lib/systemIntegrationGovernanceReport.js";
import { captureWalkForwardReplaySnapshot } from "../lib/walkForwardReplaySnapshot.js";
import type { AppServices } from "../lib/services.js";

const runApiOperation = <Result>(
  services: AppServices,
  config: {
    operation_name: SystemOperationName;
    triggered_by?: "api" | "script";
    metadata?: Record<string, string | number | boolean | null>;
    summarize?: (result: Result) => Record<string, string | number | boolean | null>;
    status_from_result?: (result: Result) => OperationRunStatus;
    summarize_error?: (error: unknown) => Record<string, string | number | boolean | null>;
    lease_scope?: string;
    lease_ttl_ms?: number;
  },
  operation: () => Promise<Result>,
) =>
  runTrackedOperation(
    {
      repository: services.repository,
      triggered_by: config.triggered_by ?? "api",
      ...config,
      lease: config.lease_scope
        ? {
            scope_key: config.lease_scope,
            ttl_ms: config.lease_ttl_ms,
          }
        : undefined,
    },
    operation,
  );

const resolveRequestedExecutionMode = (request: { query?: unknown }) =>
  resolveRouteExecutionMode((request.query as { execution?: string } | undefined)?.execution);

const shouldQueueHeavyRoute = (request: { query?: unknown }, envFlag: string) =>
  shouldQueueRouteExecution({
    requested_mode: resolveRequestedExecutionMode(request),
    durable_by_default: true,
    env_flag: process.env[envFlag],
  });

const enqueueRouteOperation = async (
  services: AppServices,
  request: { headers: Record<string, unknown> },
  operation_name: SystemOperationName,
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

const sendOperationLocked = (
  reply: { status: (code: number) => { send: (body: Record<string, unknown>) => unknown } },
  error: OperationLeaseConflictError,
) =>
  reply.status(409).send({
    error: "operation_locked",
    message: error.message,
    operation_name: error.operation_name,
    scope_key: error.scope_key,
  });

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

export const registerOperationRoutes = async (
  server: FastifyInstance,
  services: AppServices,
) => {
  server.post("/v1/operations/jobs", async (request, reply) => {
    const parsedRequest = operationJobEnqueueRequestSchema.safeParse(request.body ?? {});

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    let job;

    try {
      job = await enqueueOperationJobRequest(
        services,
        parsedRequest.data,
        resolveOperationTrigger(request),
      );
    } catch (error) {
      if (error instanceof IntegrationGovernanceSuppressedError) {
        return sendIntegrationSuppressed(reply, error);
      }

      throw error;
    }

    return reply.status(202).send(job);
  });

  server.get("/v1/operations/jobs", async (request) => {
    const query = (request.query as {
      limit?: string;
      operation_name?: string;
      status?: string;
    } | undefined) ?? {};
    const rawLimit = Number(query.limit ?? 40);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 40;
    const operation_names = query.operation_name
      ? query.operation_name.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;
    const statuses = query.status
      ? query.status.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;

    return operationJobListResponseSchema.parse({
      jobs: await services.repository.listOperationJobs({
        limit,
        operation_names: operation_names as SystemOperationName[] | undefined,
        statuses: statuses as ("pending" | "running" | "completed" | "failed")[] | undefined,
      }),
    });
  });

  server.get("/v1/operations/jobs/:jobId", async (request, reply) => {
    const jobId = (request.params as { jobId: string }).jobId;
    const job = await services.repository.getOperationJob(jobId);

    if (!job) {
      return reply.status(404).send({
        error: "not_found",
        message: "Operation job not found.",
      });
    }

    return reply.status(200).send(job);
  });

  server.get("/v1/operations/evolution/alert-policies", async () =>
    growthPressurePolicyListResponseSchema.parse({
      policies: await services.repository.listGrowthPressurePolicies(),
    }));

  server.post("/v1/operations/evolution/alert-policies", async (request, reply) => {
    const parsedRequest = growthPressurePolicyUpsertRequestSchema.safeParse(request.body ?? {});

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const policy = await saveGrowthPressurePolicy(services.repository, parsedRequest.data);
    return reply.status(200).send(policy);
  });

  server.get("/v1/operations/evolution-schedule", async () =>
    resolveEvolutionScheduleConfig(services.repository));

  server.post("/v1/operations/evolution-schedule", async (request, reply) => {
    const parsedRequest = evolutionScheduleUpdateRequestSchema.safeParse(request.body ?? {});

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const schedule = await saveEvolutionScheduleConfig(services.repository, parsedRequest.data);
    return reply.status(200).send(schedule);
  });

  server.post("/v1/operations/evolution-schedule/run", async (request, reply) => {
    const parsedBody = (request.body ?? {}) as { as_of?: string };

    if (parsedBody.as_of && Number.isNaN(Date.parse(parsedBody.as_of))) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: [
          {
            path: "as_of",
            message: "Invalid ISO datetime.",
          },
        ],
      });
    }

    if (shouldQueueHeavyRoute(request, "QUEUE_DEFAULT_SCHEDULED_EVOLUTION")) {
      let job;

      try {
        job = await enqueueRouteOperation(
          services,
          request,
          "scheduled_evolution",
          {
          ...(parsedBody.as_of ? { as_of: parsedBody.as_of } : {}),
          },
        );
      } catch (error) {
        if (error instanceof IntegrationGovernanceSuppressedError) {
          return sendIntegrationSuppressed(reply, error);
        }

        throw error;
      }

      return reply.status(202).send(job);
    }

    try {
      const result = await runApiOperation(
        services,
        {
          operation_name: "scheduled_evolution",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            as_of: parsedBody.as_of ?? null,
          },
          summarize: (response) => ({
            ran: response.ran,
            due_self_audit: response.due.self_audit,
            due_benchmark_snapshot: response.due.benchmark_snapshot,
            due_walk_forward_snapshot: response.due.walk_forward_snapshot,
            due_trust_refresh: response.due.benchmark_trust_refresh,
            due_molt_cycle: response.due.molt_cycle,
            seeded_high_confidence_cases:
              response.trust_refresh?.seed.promoted_count ?? 0,
            trust_warning_delta: response.trust_refresh?.delta.warning_count ?? 0,
            walk_forward_window_count:
              response.result?.walk_forward_snapshot?.window_count ?? 0,
            hardened_shells: response.result?.molt_cycle?.hardened ?? 0,
          }),
          lease_scope: buildOperationLockScope("scheduled_evolution", {
            ...(parsedBody.as_of ? { as_of: parsedBody.as_of } : {}),
          }),
          lease_ttl_ms: 60 * 60 * 1000,
        },
        () =>
          runScheduledEvolution(services, {
            as_of: parsedBody.as_of,
          }),
      );
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      throw error;
    }
  });

  server.post("/v1/operations/evolution/alerts/:alertId/acknowledge", async (request, reply) => {
    const alertId = (request.params as { alertId: string }).alertId;
    const parsedRequest = growthPressureAlertAcknowledgeRequestSchema.safeParse(request.body ?? {});

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
      const alert = await acknowledgeGrowthPressureAlert(services.repository, alertId);
      return reply.status(200).send(alert);
    } catch (error) {
      return reply.status(404).send({
        error: "not_found",
        message: error instanceof Error ? error.message : "Alert not found.",
      });
    }
  });

  server.post("/v1/operations/evolution/alerts/:alertId/snooze", async (request, reply) => {
    const alertId = (request.params as { alertId: string }).alertId;
    const parsedRequest = growthPressureAlertSnoozeRequestSchema.safeParse(request.body ?? {});

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
      const alert = await snoozeGrowthPressureAlert(
        services.repository,
        alertId,
        parsedRequest.data.duration_hours,
      );
      return reply.status(200).send(alert);
    } catch (error) {
      return reply.status(404).send({
        error: "not_found",
        message: error instanceof Error ? error.message : "Alert not found.",
      });
    }
  });

  server.post("/v1/operations/evolution/alerts/:alertId/handle", async (request, reply) => {
    const alertId = (request.params as { alertId: string }).alertId;
    const parsedRequest = growthPressureAlertHandleRequestSchema.safeParse(request.body ?? {});

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
      const alert = await handleGrowthPressureAlert(services.repository, alertId);
      return reply.status(200).send(alert);
    } catch (error) {
      return reply.status(404).send({
        error: "not_found",
        message: error instanceof Error ? error.message : "Alert not found.",
      });
    }
  });

  server.post("/v1/operations/evolution/actions/:actionId/approve", async (request, reply) => {
    const actionId = (request.params as { actionId: string }).actionId;
    const parsedRequest = growthPressureActionDecisionRequestSchema.safeParse(request.body ?? {});

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
      const plan = await approveGrowthPressureActionPlan(
        services.repository,
        actionId,
        parsedRequest.data.operator_note,
      );
      return reply.status(200).send(plan);
    } catch (error) {
      return reply.status(404).send({
        error: "not_found",
        message: error instanceof Error ? error.message : "Action plan not found.",
      });
    }
  });

  server.post("/v1/operations/evolution/actions/:actionId/block", async (request, reply) => {
    const actionId = (request.params as { actionId: string }).actionId;
    const parsedRequest = growthPressureActionDecisionRequestSchema.safeParse(request.body ?? {});

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
      const plan = await blockGrowthPressureActionPlan(
        services.repository,
        actionId,
        parsedRequest.data.operator_note,
      );
      return reply.status(200).send(plan);
    } catch (error) {
      return reply.status(404).send({
        error: "not_found",
        message: error instanceof Error ? error.message : "Action plan not found.",
      });
    }
  });

  server.post("/v1/operations/auto-score", async (request, reply) => {
    const parsedRequest = autoScoreRequestSchema.safeParse(request.body ?? {});

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
      const result = await runApiOperation(
        services,
        {
          operation_name: "auto_score",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            as_of: parsedRequest.data.as_of ?? null,
            create_postmortems: parsedRequest.data.create_postmortems,
          },
          summarize: (response) => ({
            processed: response.processed,
            scored_items: response.items.length,
            errors: response.errors.length,
            lessons_created: response.items.filter((item) => item.lesson !== null).length,
          }),
          status_from_result: (response) => (response.errors.length ? "partial" : "success"),
          lease_scope: buildOperationLockScope(
            "auto_score",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
        },
        () => autoScorePredictions(services, parsedRequest.data),
      );
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      throw error;
    }
  });

  server.post("/v1/operations/calibration-snapshot", async (request, reply) => {
    const parsedRequest = calibrationSnapshotRequestSchema.safeParse(request.body ?? {});

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
      const snapshot = await runApiOperation(
        services,
        {
          operation_name: "calibration_snapshot",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            as_of: parsedRequest.data.as_of ?? null,
          },
          summarize: (response) => ({
            sample_count: response.sample_count,
            average_total_score: response.average_total_score,
            horizon_count: response.report.horizons.length,
          }),
          lease_scope: buildOperationLockScope(
            "calibration_snapshot",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
        },
        () => captureCalibrationSnapshot(services.repository, parsedRequest.data),
      );
      return reply.status(201).send(snapshot);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      throw error;
    }
  });

  server.post("/v1/operations/benchmark-snapshot", async (request, reply) => {
    const parsedRequest = benchmarkReplaySnapshotRequestSchema.safeParse(request.body ?? {});

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
      const snapshot = await runApiOperation(
        services,
        {
          operation_name: "benchmark_snapshot",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            benchmark_pack_id: parsedRequest.data.benchmark_pack_id,
            strict_quotas: parsedRequest.data.strict_quotas,
          },
          summarize: (response) => ({
            benchmark_pack_id: response.benchmark_pack_id,
            selected_case_count: response.selected_case_count,
            family_count: response.family_count,
            model_count: response.report.model_count,
          }),
          lease_scope: buildOperationLockScope(
            "benchmark_snapshot",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
          lease_ttl_ms: 45 * 60 * 1000,
        },
        () =>
          captureBenchmarkReplaySnapshot(
            services.repository,
            parsedRequest.data,
          ),
      );
      return reply.status(201).send(snapshot);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      if (
        error instanceof Error &&
        ((error.message.includes("Benchmark pack") &&
          error.message.includes("incomplete")) ||
          error.message.includes("No active model families") ||
          error.message.includes("No historical library cases") ||
          error.message.includes("benchmark composer could not find"))
      ) {
        return reply.status(409).send({
          error:
            error.message.includes("Benchmark pack") &&
            error.message.includes("incomplete")
              ? "benchmark_pack_incomplete"
              : "benchmark_unavailable",
          message: error.message,
        });
      }

      throw error;
    }
  });

  server.post("/v1/operations/walk-forward-snapshot", async (request, reply) => {
    const parsedRequest = walkForwardReplaySnapshotRequestSchema.safeParse(request.body ?? {});

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
      const snapshot = await runApiOperation(
        services,
        {
          operation_name: "walk_forward_snapshot",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            benchmark_pack_id: parsedRequest.data.benchmark_pack_id,
            training_mode: parsedRequest.data.training_mode,
          },
          summarize: (response) => ({
            benchmark_pack_id: response.benchmark_pack_id,
            eligible_case_count: response.eligible_case_count,
            window_count: response.window_count,
            family_count: response.family_count,
          }),
          lease_scope: buildOperationLockScope(
            "walk_forward_snapshot",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
          lease_ttl_ms: 45 * 60 * 1000,
        },
        () =>
          captureWalkForwardReplaySnapshot(
            services.repository,
            parsedRequest.data,
          ),
      );
      return reply.status(201).send(snapshot);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      if (
        error instanceof Error &&
        (error.message.includes("No active model families") ||
          error.message.includes("Insufficient dated cases") ||
          error.message.includes("Walk-forward validation could not form any windows"))
      ) {
        return reply.status(409).send({
          error: "walk_forward_unavailable",
          message: error.message,
        });
      }

      throw error;
    }
  });

  server.post("/v1/operations/historical-library/seed-high-confidence", async (request, reply) => {
    const parsedRequest = historicalHighConfidenceSeedRequestSchema.safeParse(request.body ?? {});

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
      const result = await runApiOperation(
        services,
        {
          operation_name: "high_confidence_seed",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            benchmark_pack_id: parsedRequest.data.benchmark_pack_id,
            dry_run: parsedRequest.data.dry_run,
            limit: parsedRequest.data.limit,
          },
          summarize: (response) => ({
            scanned_reviewed_cases: response.scanned_reviewed_cases,
            candidate_count: response.candidate_count,
            promoted_count: response.promoted_count,
            skipped_count: response.skipped_count,
            prioritized_regime_count: response.prioritized_regimes.length,
          }),
          lease_scope: buildOperationLockScope(
            "high_confidence_seed",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
        },
        () => runCoreHighConfidenceSeed(services, parsedRequest.data),
      );
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      throw error;
    }
  });

  server.post("/v1/operations/benchmark-trust-refresh", async (request, reply) => {
    const parsedRequest = benchmarkTrustRefreshRequestSchema.safeParse(request.body ?? {});

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (shouldQueueHeavyRoute(request, "QUEUE_DEFAULT_BENCHMARK_TRUST_REFRESH")) {
      const job = await enqueueRouteOperation(
        services,
        request,
        "benchmark_trust_refresh",
        parsedRequest.data as Record<string, JsonValue>,
      );

      return reply.status(202).send(job);
    }

    try {
      const result = await runApiOperation(
        services,
        {
          operation_name: "benchmark_trust_refresh",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            benchmark_pack_id: parsedRequest.data.benchmark_pack_id,
            dry_run: parsedRequest.data.dry_run,
          },
          summarize: (response) => ({
            benchmark_pack_id: response.benchmark_pack_id,
            promoted_count: response.seed.promoted_count,
            warning_delta: response.delta.warning_count,
            high_confidence_delta: response.delta.high_confidence_cases,
            selected_case_count:
              response.benchmark_snapshot?.selected_case_count ?? response.after.selected_case_count,
          }),
          lease_scope: buildOperationLockScope(
            "benchmark_trust_refresh",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
          lease_ttl_ms: 45 * 60 * 1000,
        },
        () => refreshBenchmarkTrust(services, parsedRequest.data),
      );
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      throw error;
    }
  });

  server.post("/v1/operations/self-audit", async (request, reply) => {
    const parsedRequest = selfAuditRequestSchema.safeParse(request.body ?? {});

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
      const result = await runApiOperation(
        services,
        {
          operation_name: "self_audit",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            as_of: parsedRequest.data.as_of ?? null,
            capture_snapshot: parsedRequest.data.capture_snapshot,
            create_postmortems: parsedRequest.data.create_postmortems,
          },
          summarize: (response) => ({
            processed_predictions: response.auto_score.processed,
            auto_score_errors: response.auto_score.errors.length,
            snapshot_captured: response.calibration_snapshot !== null,
            model_count: response.model_comparison.versions.length,
          }),
          status_from_result: (response) =>
            response.auto_score.errors.length ? "partial" : "success",
          lease_scope: buildOperationLockScope(
            "self_audit",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
          lease_ttl_ms: 45 * 60 * 1000,
        },
        () => runSelfAudit(services, parsedRequest.data),
      );
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      throw error;
    }
  });

  server.post("/v1/operations/evolution-cycle", async (request, reply) => {
    const parsedRequest = evolutionCycleRequestSchema.safeParse(request.body ?? {});

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
      const result = await runApiOperation(
        services,
        {
          operation_name: "evolution_cycle",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            benchmark_pack_id: parsedRequest.data.benchmark_pack_id ?? null,
            run_molt_cycle: parsedRequest.data.run_molt_cycle ?? true,
          },
          summarize: (response) => ({
            processed_predictions: response.self_audit.auto_score.processed,
            benchmark_case_count: response.benchmark_snapshot?.selected_case_count ?? 0,
            walk_forward_window_count: response.walk_forward_snapshot?.window_count ?? 0,
            hardened_shells: response.molt_cycle?.hardened ?? 0,
            held_shells: response.molt_cycle?.held ?? 0,
            open_growth_alerts: response.growth_pressure.counts.open,
          }),
          status_from_result: (response) =>
            response.self_audit.auto_score.errors.length ? "partial" : "success",
          lease_scope: buildOperationLockScope(
            "evolution_cycle",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
          lease_ttl_ms: 60 * 60 * 1000,
        },
        () => runEvolutionCycle(services, parsedRequest.data),
      );
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      throw error;
    }
  });

  server.post("/v1/operations/promotion-cycle", async (request, reply) => {
    const parsedRequest = promotionCycleRequestSchema.safeParse(request.body ?? {});

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
      const result = await runApiOperation(
        services,
        {
          operation_name: "promotion_cycle",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            benchmark_pack_id: parsedRequest.data.benchmark_pack_id ?? null,
            case_pack: parsedRequest.data.case_pack,
            promote_on_pass: parsedRequest.data.promote_on_pass,
          },
          summarize: (response) => ({
            processed: response.processed,
            passed: response.passed,
            failed: response.failed,
            candidate_count: response.candidates.length,
          }),
          status_from_result: (response) =>
            response.failed > 0 && response.passed > 0 ? "partial" : "success",
          lease_scope: buildOperationLockScope(
            "promotion_cycle",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
          lease_ttl_ms: 60 * 60 * 1000,
        },
        () => runPromotionCycle(services.repository, parsedRequest.data),
      );
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

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

      throw error;
    }
  });

  server.post("/v1/operations/molt-cycle", async (request, reply) => {
    const parsedRequest = moltCycleRequestSchema.safeParse(request.body ?? {});

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
      const result = await runApiOperation(
        services,
        {
          operation_name: "molt_cycle",
          triggered_by: resolveOperationTrigger(request),
          metadata: {
            benchmark_pack_id: parsedRequest.data.benchmark_pack_id ?? null,
            case_pack: parsedRequest.data.case_pack,
          },
          summarize: (response) => ({
            generated: response.generated,
            hardened: response.hardened,
            held: response.held,
            skipped: response.skipped,
            item_count: response.items.length,
          }),
          status_from_result: (response) =>
            response.held > 0 && response.hardened > 0 ? "partial" : "success",
          lease_scope: buildOperationLockScope(
            "molt_cycle",
            parsedRequest.data as unknown as Record<string, unknown>,
          ),
          lease_ttl_ms: 60 * 60 * 1000,
        },
        () => runMoltCycle(services.repository, parsedRequest.data),
      );
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof OperationLeaseConflictError) {
        return sendOperationLocked(reply, error);
      }

      throw error;
    }
  });
};
