import type { FastifyInstance } from "fastify";
import {
  benchmarkPackComposeRequestSchema,
  benchmarkPackListResponseSchema,
  benchmarkRegressionReportSchema,
  benchmarkReplaySnapshotHistoryResponseSchema,
  benchmarkTrustRefreshHistoryResponseSchema,
  benchmarkStabilityReportSchema,
  benchmarkTrendReportSchema,
  calibrationHistoryResponseSchema,
  growthPressureActionPlanListResponseSchema,
  growthPressureAlertHistoryResponseSchema,
  historicalHighConfidenceCandidateReportSchema,
  historicalCaseLibraryReplayRequestSchema,
  historicalReplayRequestSchema,
  lineageHistoryResponseSchema,
  operationLeaseListResponseSchema,
  type OperationRunRecord,
  promotionHistoryResponseSchema,
  operationQueueAlertReportSchema,
  operationQueueReportSchema,
  systemOperationalIncidentReportSchema,
  systemIntegrationReportSchema,
  systemIntegrationProbeReportSchema,
  systemIntegrationGovernanceReportSchema,
  systemIntegrationTrendReportSchema,
  systemWorkerServiceReportSchema,
  systemWorkerServiceTrendReportSchema,
  systemWorkerReportSchema,
  systemWorkerTrendReportSchema,
  type OperationRunStatus,
  type OperationRunTrigger,
  systemOperationReportSchema,
  walkForwardRegressionReportSchema,
  walkForwardRegimeRegressionReportSchema,
  walkForwardRegimeTrendReportSchema,
  walkForwardReplayRequestSchema,
  walkForwardReplayResponseSchema,
  walkForwardReplaySnapshotHistoryResponseSchema,
  walkForwardTrendReportSchema,
} from "@finance-superbrain/schemas";

import { buildCalibrationReport } from "../lib/calibrationReport.js";
import {
  composeHistoricalBenchmarkPack,
  listBenchmarkPackDefinitions,
} from "../lib/benchmarkPackComposer.js";
import { buildBenchmarkRegressionReport } from "../lib/benchmarkRegressionReport.js";
import { buildBenchmarkStabilityReport } from "../lib/benchmarkStabilityReport.js";
import { buildBenchmarkTrendReport } from "../lib/benchmarkTrendReport.js";
import { buildEvolutionTrendReport } from "../lib/evolutionTrendReport.js";
import { buildGrowthPressureAlertReport } from "../lib/growthPressureAlerts.js";
import { buildHistoricalHighConfidenceCandidateReport } from "../lib/historicalCaseConfidence.js";
import { buildHistoricalReplayRequestFromLibrary } from "../lib/historicalCaseLibrary.js";
import { buildHistoricalLibraryCoverageReport } from "../lib/historicalLibraryCoverageReport.js";
import { buildHistoricalLibraryGapReport } from "../lib/historicalLibraryGapReport.js";
import { buildHistoricalReplayDiagnostics } from "../lib/historicalReplayDiagnostics.js";
import { runHistoricalReplayBenchmark } from "../lib/historicalReplay.js";
import { buildModelLineageReport } from "../lib/modelLineageReport.js";
import { buildOperationQueueAlertReport } from "../lib/operationQueueAlertReport.js";
import { buildOperationQueueReport } from "../lib/operationQueueReport.js";
import { buildSystemIntegrationReport } from "../lib/systemIntegrationReport.js";
import {
  buildStoredSystemIntegrationProbeReport,
  captureSystemIntegrationProbeReport,
} from "../lib/systemIntegrationProbeReport.js";
import {
  buildStoredSystemIntegrationGovernanceReport,
  buildSystemIntegrationGovernanceReport,
} from "../lib/systemIntegrationGovernanceReport.js";
import { buildSystemIntegrationTrendReport } from "../lib/systemIntegrationTrendReport.js";
import { buildSystemWorkerServiceReport } from "../lib/systemWorkerServiceReport.js";
import { buildSystemWorkerServiceTrendReport } from "../lib/systemWorkerServiceTrendReport.js";
import { buildSystemWorkerReport } from "../lib/systemWorkerReport.js";
import { buildSystemWorkerTrendReport } from "../lib/systemWorkerTrendReport.js";
import { buildModelComparisonReport } from "../lib/modelComparisonReport.js";
import { buildPromotionAnalyticsReport } from "../lib/promotionAnalyticsReport.js";
import { buildPromotionPatternAnalyticsReport } from "../lib/promotionPatternAnalyticsReport.js";
import { buildSystemOperationReport } from "../lib/systemOperationReport.js";
import { buildSystemOperationalIncidentReport } from "../lib/systemOperationalIncidentReport.js";
import { buildWalkForwardRegressionReport } from "../lib/walkForwardRegressionReport.js";
import { buildWalkForwardRegimeRegressionReport } from "../lib/walkForwardRegimeRegressionReport.js";
import { buildWalkForwardRegimeTrendReport } from "../lib/walkForwardRegimeTrendReport.js";
import { runWalkForwardReplay } from "../lib/walkForwardReplay.js";
import { buildWalkForwardTrendReport } from "../lib/walkForwardTrendReport.js";
import type { AppServices } from "../lib/services.js";

type GrowthAlertStatus = "open" | "acknowledged" | "snoozed" | "handled" | "resolved";
type GrowthActionStatus = "pending" | "approved" | "blocked" | "executed" | "skipped";

export const registerMetricRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.get("/v1/metrics/system/operations", async (request) => {
    const query = (request.query as {
      limit?: string;
      operation_name?: string;
      status?: string;
      triggered_by?: string;
    } | undefined) ?? {};
    const rawLimit = Number(query.limit ?? 40);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 40;
    const operation_names = query.operation_name
      ? query.operation_name.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;
    const statuses = query.status
      ? query.status.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;
    const triggered_by = query.triggered_by
      ? query.triggered_by.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;

    return systemOperationReportSchema.parse(
      await buildSystemOperationReport(services.repository, {
        limit,
        operation_names: operation_names as OperationRunRecord["operation_name"][] | undefined,
        statuses: statuses as OperationRunStatus[] | undefined,
        triggered_by: triggered_by as OperationRunTrigger[] | undefined,
      }),
    );
  });

  server.get("/v1/metrics/system/queue", async (request) => {
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 20;

    return operationQueueReportSchema.parse(
      await buildOperationQueueReport(services.repository, { limit }),
    );
  });

  server.get("/v1/metrics/system/queue-alerts", async (request) => {
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 20;

    return operationQueueAlertReportSchema.parse(
      await buildOperationQueueAlertReport(services.repository, { limit }),
    );
  });

  server.get("/v1/metrics/system/incidents", async (request) => {
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 20;

    return systemOperationalIncidentReportSchema.parse(
      await buildSystemOperationalIncidentReport(services.repository, { limit }),
    );
  });

  server.get("/v1/metrics/system/workers", async (request) => {
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 20;

    return systemWorkerReportSchema.parse(
      await buildSystemWorkerReport(services.repository, { limit }),
    );
  });

  server.get("/v1/metrics/system/worker-services", async (request) => {
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 20;

    return systemWorkerServiceReportSchema.parse(
      await buildSystemWorkerServiceReport(services.repository, { limit }),
    );
  });

  server.get("/v1/metrics/system/worker-service-trends", async (request) => {
    const query = (request.query as {
      window_hours?: string;
      bucket_hours?: string;
      recent_limit?: string;
    } | undefined) ?? {};
    const rawWindowHours = Number(query.window_hours ?? 24);
    const rawBucketHours = Number(query.bucket_hours ?? 4);
    const rawRecentLimit = Number(query.recent_limit ?? 12);

    return systemWorkerServiceTrendReportSchema.parse(
      await buildSystemWorkerServiceTrendReport(services.repository, {
        window_hours: Number.isFinite(rawWindowHours)
          ? Math.max(1, Math.min(24 * 14, rawWindowHours))
          : 24,
        bucket_hours: Number.isFinite(rawBucketHours)
          ? Math.max(1, Math.min(24, rawBucketHours))
          : 4,
        recent_limit: Number.isFinite(rawRecentLimit)
          ? Math.max(1, Math.min(100, rawRecentLimit))
          : 12,
      }),
    );
  });

  server.get("/v1/metrics/system/worker-trends", async (request) => {
    const query = (request.query as {
      window_hours?: string;
      bucket_hours?: string;
      recent_limit?: string;
    } | undefined) ?? {};
    const rawWindowHours = Number(query.window_hours ?? 24);
    const rawBucketHours = Number(query.bucket_hours ?? 4);
    const rawRecentLimit = Number(query.recent_limit ?? 12);

    return systemWorkerTrendReportSchema.parse(
      await buildSystemWorkerTrendReport(services.repository, {
        window_hours: Number.isFinite(rawWindowHours)
          ? Math.max(1, Math.min(24 * 14, rawWindowHours))
          : 24,
        bucket_hours: Number.isFinite(rawBucketHours)
          ? Math.max(1, Math.min(24, rawBucketHours))
          : 4,
        recent_limit: Number.isFinite(rawRecentLimit)
          ? Math.max(1, Math.min(100, rawRecentLimit))
          : 12,
      }),
    );
  });

  server.get("/v1/metrics/system/integrations", async (request) => {
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 12);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 12;

    return systemIntegrationReportSchema.parse(
      await buildSystemIntegrationReport(services.repository, { limit }),
    );
  });

  server.get("/v1/metrics/system/integration-probes", async (request) => {
    const query = (request.query as {
      timeout_ms?: string;
      refresh?: string;
    } | undefined) ?? {};
    const rawTimeout = Number(query.timeout_ms ?? 5000);
    const timeoutMs = Number.isFinite(rawTimeout) ? Math.max(250, Math.min(30_000, rawTimeout)) : 5_000;

    return systemIntegrationProbeReportSchema.parse(
      query.refresh === "true"
        ? await captureSystemIntegrationProbeReport(services.repository, {
            timeout_ms: timeoutMs,
          })
        : await buildStoredSystemIntegrationProbeReport(services.repository, {
            timeout_ms: timeoutMs,
          }),
    );
  });

  server.get("/v1/metrics/system/integration-governance", async (request) => {
    const query = (request.query as {
      refresh?: string;
      freshness_ms?: string;
    } | undefined) ?? {};

    return systemIntegrationGovernanceReportSchema.parse(
      query.refresh === "true"
        ? await buildSystemIntegrationGovernanceReport(services.repository, {
            refresh: true,
            freshness_ms: query.freshness_ms ? Number(query.freshness_ms) : undefined,
          })
        : await buildStoredSystemIntegrationGovernanceReport(services.repository, {
            freshness_ms: query.freshness_ms ? Number(query.freshness_ms) : undefined,
          }),
    );
  });

  server.get("/v1/metrics/system/integration-trends", async (request) => {
    const query = (request.query as {
      window_hours?: string;
      bucket_hours?: string;
      recent_limit?: string;
    } | undefined) ?? {};
    const rawWindowHours = Number(query.window_hours ?? 24);
    const rawBucketHours = Number(query.bucket_hours ?? 4);
    const rawRecentLimit = Number(query.recent_limit ?? 12);

    return systemIntegrationTrendReportSchema.parse(
      await buildSystemIntegrationTrendReport(services.repository, {
        window_hours: Number.isFinite(rawWindowHours)
          ? Math.max(1, Math.min(24 * 14, rawWindowHours))
          : 24,
        bucket_hours: Number.isFinite(rawBucketHours)
          ? Math.max(1, Math.min(24, rawBucketHours))
          : 4,
        recent_limit: Number.isFinite(rawRecentLimit)
          ? Math.max(1, Math.min(100, rawRecentLimit))
          : 12,
      }),
    );
  });

  server.get("/v1/metrics/system/leases", async (request) => {
    const query = (request.query as {
      limit?: string;
      active_only?: string;
      operation_name?: string;
    } | undefined) ?? {};
    const rawLimit = Number(query.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 20;
    const operation_names = query.operation_name
      ? query.operation_name.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;

    return operationLeaseListResponseSchema.parse({
      leases: await services.repository.listOperationLeases({
        limit,
        active_only: query.active_only === "false" ? false : true,
        operation_names: operation_names as OperationRunRecord["operation_name"][] | undefined,
      }),
    });
  });

  server.get("/v1/metrics/calibration", async () =>
    buildCalibrationReport(services.repository));

  server.get("/v1/metrics/calibration/history", async (request) => {
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(60, rawLimit)) : 10;

    return calibrationHistoryResponseSchema.parse({
      snapshots: await services.repository.listCalibrationSnapshots(limit),
    });
  });

  server.get("/v1/metrics/benchmarks/history", async (request) => {
    const query = (request.query as { limit?: string; benchmark_pack_id?: string } | undefined) ?? {};
    const rawLimit = Number(query.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(60, rawLimit)) : 10;

    return benchmarkReplaySnapshotHistoryResponseSchema.parse({
      snapshots: await services.repository.listBenchmarkReplaySnapshots({
        limit,
        benchmark_pack_id: query.benchmark_pack_id,
      }),
    });
  });

  server.get("/v1/metrics/benchmarks/trust-history", async (request) => {
    const query = (request.query as { limit?: string; benchmark_pack_id?: string } | undefined) ?? {};
    const rawLimit = Number(query.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(60, rawLimit)) : 10;

    return benchmarkTrustRefreshHistoryResponseSchema.parse({
      refreshes: await services.repository.listBenchmarkTrustRefreshes({
        limit,
        benchmark_pack_id: query.benchmark_pack_id,
      }),
    });
  });

  server.get("/v1/metrics/benchmarks/trends", async (request) =>
    benchmarkTrendReportSchema.parse(
      await buildBenchmarkTrendReport(services.repository, {
        benchmark_pack_id:
          (request.query as { benchmark_pack_id?: string } | undefined)?.benchmark_pack_id,
      }),
    ));

  server.get("/v1/metrics/benchmarks/regressions", async (request) =>
    benchmarkRegressionReportSchema.parse(
      await buildBenchmarkRegressionReport(services.repository, {
        benchmark_pack_id:
          (request.query as { benchmark_pack_id?: string } | undefined)?.benchmark_pack_id,
      }),
    ));

  server.get("/v1/metrics/benchmarks/stability", async (request) =>
    benchmarkStabilityReportSchema.parse(
      await buildBenchmarkStabilityReport(services.repository, {
        benchmark_pack_id:
          (request.query as { benchmark_pack_id?: string } | undefined)?.benchmark_pack_id,
      }),
    ));

  server.get("/v1/metrics/walk-forward/history", async (request) => {
    const query = (request.query as { limit?: string; benchmark_pack_id?: string } | undefined) ?? {};
    const rawLimit = Number(query.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(60, rawLimit)) : 10;

    return walkForwardReplaySnapshotHistoryResponseSchema.parse({
      snapshots: await services.repository.listWalkForwardReplaySnapshots({
        limit,
        benchmark_pack_id: query.benchmark_pack_id,
      }),
    });
  });

  server.get("/v1/metrics/walk-forward/trends", async (request) =>
    walkForwardTrendReportSchema.parse(
      await buildWalkForwardTrendReport(services.repository, {
        benchmark_pack_id:
          (request.query as { benchmark_pack_id?: string } | undefined)?.benchmark_pack_id,
      }),
    ));

  server.get("/v1/metrics/walk-forward/regimes", async (request) =>
    walkForwardRegimeTrendReportSchema.parse(
      await buildWalkForwardRegimeTrendReport(services.repository, {
        benchmark_pack_id:
          (request.query as { benchmark_pack_id?: string } | undefined)?.benchmark_pack_id,
      }),
    ));

  server.get("/v1/metrics/walk-forward/regressions", async (request) =>
    walkForwardRegressionReportSchema.parse(
      await buildWalkForwardRegressionReport(services.repository, {
        benchmark_pack_id:
          (request.query as { benchmark_pack_id?: string } | undefined)?.benchmark_pack_id,
      }),
    ));

  server.get("/v1/metrics/walk-forward/regime-regressions", async (request) =>
    walkForwardRegimeRegressionReportSchema.parse(
      await buildWalkForwardRegimeRegressionReport(services.repository, {
        benchmark_pack_id:
          (request.query as { benchmark_pack_id?: string } | undefined)?.benchmark_pack_id,
      }),
    ));

  server.get("/v1/metrics/models", async () =>
    buildModelComparisonReport(services.repository));

  server.get("/v1/metrics/historical-library", async (request) => {
    const rawTop = Number((request.query as { top?: string } | undefined)?.top ?? 8);
    const top = Number.isFinite(rawTop) ? Math.max(3, Math.min(20, rawTop)) : 8;

    return buildHistoricalLibraryCoverageReport(services.repository, { top });
  });

  server.get("/v1/metrics/historical-library/gaps", async () =>
    buildHistoricalLibraryGapReport(services.repository));

  server.get("/v1/metrics/historical-library/high-confidence-candidates", async (request) => {
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 8);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 8;

    return historicalHighConfidenceCandidateReportSchema.parse(
      await buildHistoricalHighConfidenceCandidateReport(services.repository, {
        limit,
      }),
    );
  });

  server.get("/v1/metrics/lineage", async () =>
    buildModelLineageReport(services.repository));

  server.get("/v1/metrics/lineage/history", async (request) => {
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(60, rawLimit)) : 10;

    return lineageHistoryResponseSchema.parse({
      snapshots: await services.repository.listLineageSnapshots(limit),
    });
  });

  server.get("/v1/metrics/evolution/trends", async () =>
    buildEvolutionTrendReport(services.repository));

  server.get("/v1/metrics/evolution/alerts", async (request) => {
    const query =
      (request.query as { benchmark_pack_id?: string } | undefined) ?? {};

    return buildGrowthPressureAlertReport(services.repository, {
      benchmark_pack_id: query.benchmark_pack_id,
    });
  });

  server.get("/v1/metrics/evolution/alerts/history", async (request) => {
    const query = (request.query as {
      limit?: string;
      family?: string;
      status?: string;
    } | undefined) ?? {};
    const rawLimit = Number(query.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 20;
    const statuses = query.status
      ? query.status
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean) as GrowthAlertStatus[]
      : undefined;

    return growthPressureAlertHistoryResponseSchema.parse({
      alerts: await services.repository.listGrowthPressureAlerts({
        limit,
        family: query.family?.trim() || undefined,
        statuses,
      }),
    });
  });

  server.get("/v1/metrics/evolution/actions", async (request) => {
    const query = (request.query as {
      limit?: string;
      family?: string;
      status?: string;
    } | undefined) ?? {};
    const rawLimit = Number(query.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 20;
    const statuses = query.status
      ? query.status
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean) as GrowthActionStatus[]
      : undefined;

    return growthPressureActionPlanListResponseSchema.parse({
      actions: await services.repository.listGrowthPressureActionPlans({
        limit,
        family: query.family?.trim() || undefined,
        statuses,
      }),
    });
  });

  server.get("/v1/metrics/promotions", async (request) => {
    const query = (
      request.query as
        | { limit?: string; benchmark_pack_id?: string; has_walk_forward?: string }
        | undefined
    ) ?? {};
    const rawLimit = Number(query.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 10;
    const hasWalkForward =
      query.has_walk_forward === undefined
        ? undefined
        : query.has_walk_forward.toLowerCase() === "true";

    return promotionHistoryResponseSchema.parse({
      evaluations: await services.repository.listPromotionEvaluations({
        limit,
        benchmark_pack_id: query.benchmark_pack_id,
        has_walk_forward: hasWalkForward,
      }),
    });
  });

  server.get("/v1/metrics/promotions/analytics", async () =>
    buildPromotionAnalyticsReport(services.repository));

  server.get("/v1/metrics/promotions/patterns", async () =>
    buildPromotionPatternAnalyticsReport(services.repository));

  server.get("/v1/metrics/replay/benchmark-packs", async () =>
    benchmarkPackListResponseSchema.parse(listBenchmarkPackDefinitions()));

  server.post("/v1/metrics/replay/benchmark-packs/compose", async (request, reply) => {
    const parsedRequest = benchmarkPackComposeRequestSchema.safeParse(request.body ?? {});

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const composition = await composeHistoricalBenchmarkPack(
      services.repository,
      parsedRequest.data,
    );

    if (parsedRequest.data.strict_quotas && !composition.quotas_met) {
      return reply.status(409).send({
        error: "benchmark_pack_incomplete",
        message: "The requested benchmark pack does not satisfy its domain quotas.",
        composition,
      });
    }

    return reply.status(200).send(composition);
  });

  server.post("/v1/metrics/replay/benchmark-packs/run", async (request, reply) => {
    const parsedRequest = benchmarkPackComposeRequestSchema.safeParse(request.body ?? {});

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const composition = await composeHistoricalBenchmarkPack(
      services.repository,
      parsedRequest.data,
    );

    if (parsedRequest.data.strict_quotas && !composition.quotas_met) {
      return reply.status(409).send({
        error: "benchmark_pack_incomplete",
        message: "The requested benchmark pack does not satisfy its domain quotas.",
        composition,
      });
    }

    return reply.status(200).send(
      await runHistoricalReplayBenchmark(services.repository, composition.replay_request),
    );
  });

  server.post("/v1/metrics/replay", async (request, reply) => {
    const parsedRequest = historicalReplayRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    return reply.status(200).send(
      await runHistoricalReplayBenchmark(services.repository, parsedRequest.data),
    );
  });

  server.post("/v1/metrics/replay/library", async (request, reply) => {
    const parsedRequest = historicalCaseLibraryReplayRequestSchema.safeParse(request.body);

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
      const replayRequest = await buildHistoricalReplayRequestFromLibrary(
        services.repository,
        parsedRequest.data,
      );

      return reply.status(200).send(
        await runHistoricalReplayBenchmark(services.repository, replayRequest),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("No historical library cases")) {
        return reply.status(404).send({
          error: "no_cases",
          message: error.message,
        });
      }

      throw error;
    }
  });

  server.post("/v1/metrics/replay/diagnostics", async (request, reply) => {
    const parsedRequest = historicalReplayRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    return reply.status(200).send(
      await buildHistoricalReplayDiagnostics(services.repository, parsedRequest.data),
    );
  });

  server.post("/v1/metrics/replay/walk-forward", async (request, reply) => {
    const parsedRequest = walkForwardReplayRequestSchema.safeParse(request.body ?? {});

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
        walkForwardReplayResponseSchema.parse(
          await runWalkForwardReplay(services.repository, parsedRequest.data),
        ),
      );
    } catch (error) {
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
