import { createHash } from "node:crypto";

import type {
  AppServices,
} from "./services.js";
import { z } from "zod";
import {
  autoScoreRequestSchema,
  benchmarkReplaySnapshotRequestSchema,
  benchmarkTrustRefreshRequestSchema,
  calibrationSnapshotRequestSchema,
  evolutionCycleRequestSchema,
  feedPullRequestSchema,
  historicalHighConfidenceSeedRequestSchema,
  integrationGovernanceRefreshRequestSchema,
  integrationProbeSnapshotRequestSchema,
  type JsonValue,
  moltCycleRequestSchema,
  operationJobEnqueueRequestSchema,
  promotionCycleRequestSchema,
  selfAuditRequestSchema,
  type OperationJobEnqueueRequest,
  type OperationJobRecord,
  type OperationRunStatus,
  type SystemIntegration,
  type SystemIntegrationGovernanceReport,
  type SystemOperationName,
  transcriptPullRequestSchema,
  walkForwardReplaySnapshotRequestSchema,
} from "@finance-superbrain/schemas";

import { resolveHeartbeatIntervalMs, startAsyncHeartbeat } from "./asyncHeartbeat.js";
import { autoScorePredictions } from "./autoScorePredictions.js";
import { captureBenchmarkReplaySnapshot } from "./benchmarkReplaySnapshot.js";
import { refreshBenchmarkTrust } from "./benchmarkTrustRefresh.js";
import { captureCalibrationSnapshot } from "./captureCalibrationSnapshot.js";
import { runCoreHighConfidenceSeed } from "./coreHighConfidenceSeed.js";
import { runScheduledEvolution } from "./evolutionSchedule.js";
import { ingestFeedBatch } from "./feedIngestion.js";
import { isExternalIntegrationError } from "./integrationErrors.js";
import { runEvolutionCycle } from "./runEvolutionCycle.js";
import { runMoltCycle } from "./runMoltCycle.js";
import { runPromotionCycle } from "./runPromotionCycle.js";
import { runTrackedOperation } from "./operationRuns.js";
import { runSelfAudit } from "./runSelfAudit.js";
import {
  getSystemIntegrationGovernanceState,
  IntegrationGovernanceSuppressedError,
  buildSystemIntegrationGovernanceReport,
} from "./systemIntegrationGovernanceReport.js";
import {
  buildStoredSystemIntegrationProbeReport,
  captureSystemIntegrationProbeReport,
} from "./systemIntegrationProbeReport.js";
import { buildSystemIntegrationTrendReport } from "./systemIntegrationTrendReport.js";
import { ingestTranscriptBatch } from "./transcriptIngestion.js";
import { captureWalkForwardReplaySnapshot } from "./walkForwardReplaySnapshot.js";
import {
  cpiIntelligencePayloadSchema,
  runCpiIntelligenceOperation,
} from "../intelligence/cpiLiveOperation.js";
import {
  fomcIntelligencePayloadSchema,
  runFomcIntelligenceOperation,
} from "../intelligence/fomcLiveOperation.js";
import {
  nfpIntelligencePayloadSchema,
  runNfpIntelligenceOperation,
} from "../intelligence/nfpLiveOperation.js";

export type OperationRunSummary = Record<string, string | number | boolean | null>;

type OperationDefinition<Payload, Result> = {
  parse: (payload: Record<string, unknown>) => Payload;
  execute: (services: AppServices, payload: Payload) => Promise<Result>;
  summarize: (result: Result) => OperationRunSummary;
  status_from_result?: (result: Result) => OperationRunStatus;
  lock_scope: (payload: Payload) => string;
  lease_ttl_ms?: number;
  retryable?: (error: unknown) => boolean;
  retry_delay_seconds?: (input: {
    error: unknown;
    job: OperationJobRecord;
    default_retry_delay_seconds: number;
  }) => number | null;
};

const scheduledEvolutionPayloadSchema = z.object({
  as_of: z.iso.datetime().optional(),
});

const defaultRetryDelaySeconds = 60;
const maxIntegrationRetryDelaySeconds = 15 * 60;
const operationIntegrationMap: Partial<Record<SystemOperationName, SystemIntegration>> = {
  feed_pull: "feed",
  transcript_pull: "transcript",
};

const buildHashedScope = (prefix: string, payload: unknown) =>
  `${prefix}:${createHash("sha1").update(JSON.stringify(payload)).digest("hex")}`;

const normalizeIntegrationProbeSnapshotPayload = (payload: Record<string, unknown>) => {
  const parsed = integrationProbeSnapshotRequestSchema.parse(payload);
  const integrations = [...new Set(parsed.integrations)].sort((left, right) =>
    left.localeCompare(right),
  ) as SystemIntegration[];

  return {
    ...parsed,
    integrations,
  };
};

const normalizeIntegrationGovernanceRefreshPayload = (payload: Record<string, unknown>) => {
  const parsed = integrationGovernanceRefreshRequestSchema.parse(payload);
  const integrations = [...new Set(parsed.integrations)].sort((left, right) =>
    left.localeCompare(right),
  ) as SystemIntegration[];

  return {
    ...parsed,
    integrations,
  };
};

const resolveQueuedAvailableAt = (
  requestedAvailableAt: string | undefined,
  delaySeconds: number | null,
) => {
  const nowMs = Date.now();
  const requestedMs = requestedAvailableAt ? new Date(requestedAvailableAt).getTime() : nowMs;
  const delayMs = Math.max(0, delaySeconds ?? 0) * 1000;

  return new Date(Math.max(nowMs + delayMs, requestedMs)).toISOString();
};

const resolveIntegrationRetryDelaySeconds = (input: {
  error: unknown;
  job: OperationJobRecord;
  default_retry_delay_seconds: number;
}) => {
  if (!isExternalIntegrationError(input.error)) {
    return input.default_retry_delay_seconds;
  }

  if (input.error.retry_after_seconds !== null) {
    return Math.max(1, Math.min(maxIntegrationRetryDelaySeconds, input.error.retry_after_seconds));
  }

  const attemptMultiplier = Math.max(1, input.job.attempt_count);
  return Math.min(
    maxIntegrationRetryDelaySeconds,
    input.default_retry_delay_seconds * 2 ** Math.max(0, attemptMultiplier - 1),
  );
};

const operationDefinitions: Record<SystemOperationName, OperationDefinition<any, any>> = {
  auto_score: {
    parse: (payload) => autoScoreRequestSchema.parse(payload),
    execute: (services, payload) => autoScorePredictions(services, payload),
    summarize: (response) => ({
      processed: response.processed,
      scored_items: response.items.length,
      errors: response.errors.length,
      lessons_created: response.items.filter((item: { lesson: unknown }) => item.lesson !== null)
        .length,
    }),
    status_from_result: (response) => (response.errors.length ? "partial" : "success"),
    lock_scope: () => "global",
  },
  calibration_snapshot: {
    parse: (payload) => calibrationSnapshotRequestSchema.parse(payload),
    execute: (services, payload) => captureCalibrationSnapshot(services.repository, payload),
    summarize: (response) => ({
      sample_count: response.sample_count,
      average_total_score: response.average_total_score,
      horizon_count: response.report.horizons.length,
    }),
    lock_scope: (payload) => payload.as_of ?? "latest",
  },
  benchmark_snapshot: {
    parse: (payload) => benchmarkReplaySnapshotRequestSchema.parse(payload),
    execute: (services, payload) => captureBenchmarkReplaySnapshot(services.repository, payload),
    summarize: (response) => ({
      benchmark_pack_id: response.benchmark_pack_id,
      selected_case_count: response.selected_case_count,
      family_count: response.family_count,
      model_count: response.report.model_count,
    }),
    lock_scope: (payload) => payload.benchmark_pack_id,
  },
  walk_forward_snapshot: {
    parse: (payload) => walkForwardReplaySnapshotRequestSchema.parse(payload),
    execute: (services, payload) => captureWalkForwardReplaySnapshot(services.repository, payload),
    summarize: (response) => ({
      benchmark_pack_id: response.benchmark_pack_id,
      eligible_case_count: response.eligible_case_count,
      window_count: response.window_count,
      family_count: response.family_count,
    }),
    lock_scope: (payload) => payload.benchmark_pack_id,
    lease_ttl_ms: 45 * 60 * 1000,
  },
  integration_probe_snapshot: {
    parse: normalizeIntegrationProbeSnapshotPayload,
    execute: (services, payload) =>
      captureSystemIntegrationProbeReport(services.repository, payload),
    summarize: (response) => ({
      refreshed_integrations: response.summaries.length,
      configured_target_count: response.configured_target_count,
      ready_target_count: response.ready_target_count,
      degraded_target_count: response.degraded_target_count,
      unknown_target_count: response.unknown_target_count,
    }),
    status_from_result: (response) =>
      response.degraded_target_count > 0 || response.unknown_target_count > 0
        ? "partial"
        : "success",
    lock_scope: (payload) => `integration-probe:${payload.integrations.join(",")}`,
    lease_ttl_ms: 5 * 60 * 1000,
  },
  integration_governance_refresh: {
    parse: normalizeIntegrationGovernanceRefreshPayload,
    execute: async (services, payload) => {
      const [integrationProbeReport, integrationTrendReport] = await Promise.all([
        buildStoredSystemIntegrationProbeReport(services.repository, {
          integrations: payload.integrations,
          timeout_ms: payload.timeout_ms,
        }),
        buildSystemIntegrationTrendReport(services.repository, {
          window_hours: 24,
          bucket_hours: 4,
          recent_limit: 12,
        }),
      ]);

      return buildSystemIntegrationGovernanceReport(services.repository, {
        integrations: payload.integrations,
        refresh: true,
        freshness_ms: payload.freshness_ms,
        timeout_ms: payload.timeout_ms,
        integration_probe_report: integrationProbeReport,
        integration_trend_report: integrationTrendReport,
      });
    },
    summarize: (response: SystemIntegrationGovernanceReport) => ({
      refreshed_integrations: response.states.length,
      throttled_integrations: response.states.filter((state) => state.action === "throttle").length,
      suppressed_integrations: response.states.filter((state) => state.action === "suppress").length,
      alert_count: response.alerts.length,
    }),
    status_from_result: (response: SystemIntegrationGovernanceReport) =>
      response.alerts.some((alert) => alert.severity === "critical")
        ? "partial"
        : "success",
    lock_scope: (payload) => `integration-governance:${payload.integrations.join(",")}`,
    lease_ttl_ms: 5 * 60 * 1000,
  },
  feed_pull: {
    parse: (payload) => feedPullRequestSchema.parse(payload),
    execute: (services, payload) => ingestFeedBatch(services, payload),
    summarize: (response) => ({
      ingested_sources: response.ingested_sources,
      ingested_events: response.ingested_events,
      duplicate_sources: response.duplicate_sources,
      feed_count: response.results
        .map((item: { feed_url: string }) => item.feed_url)
        .filter((value: string, index: number, values: string[]) => values.indexOf(value) === index)
        .length,
    }),
    status_from_result: (response) => (response.duplicate_sources > 0 ? "partial" : "success"),
    lock_scope: (payload) =>
      buildHashedScope("feed-pull", {
        feeds: payload.feeds.map((feed: { url: string }) => feed.url),
        parse_events: payload.parse_events,
      }),
    lease_ttl_ms: 20 * 60 * 1000,
    retryable: (error) => isExternalIntegrationError(error) ? error.retryable : true,
    retry_delay_seconds: resolveIntegrationRetryDelaySeconds,
  },
  transcript_pull: {
    parse: (payload) => transcriptPullRequestSchema.parse(payload),
    execute: (services, payload) => ingestTranscriptBatch(services, payload),
    summarize: (response) => ({
      ingested_sources: response.ingested_sources,
      ingested_events: response.ingested_events,
      duplicate_sources: response.duplicate_sources,
      item_count: response.results.length,
    }),
    status_from_result: (response) => (response.duplicate_sources > 0 ? "partial" : "success"),
    lock_scope: (payload) =>
      buildHashedScope("transcript-pull", {
        items: payload.items.map((item: { url: string }) => item.url),
        parse_events: payload.parse_events,
      }),
    lease_ttl_ms: 20 * 60 * 1000,
    retryable: (error) => isExternalIntegrationError(error) ? error.retryable : true,
    retry_delay_seconds: resolveIntegrationRetryDelaySeconds,
  },
  high_confidence_seed: {
    parse: (payload) => historicalHighConfidenceSeedRequestSchema.parse(payload),
    execute: (services, payload) => runCoreHighConfidenceSeed(services, payload),
    summarize: (response) => ({
      scanned_reviewed_cases: response.scanned_reviewed_cases,
      candidate_count: response.candidate_count,
      promoted_count: response.promoted_count,
      skipped_count: response.skipped_count,
      prioritized_regime_count: response.prioritized_regimes.length,
    }),
    lock_scope: (payload) => payload.benchmark_pack_id ?? "historical-library",
  },
  benchmark_trust_refresh: {
    parse: (payload) => benchmarkTrustRefreshRequestSchema.parse(payload),
    execute: (services, payload) => refreshBenchmarkTrust(services, payload),
    summarize: (response) => ({
      benchmark_pack_id: response.benchmark_pack_id,
      promoted_count: response.seed.promoted_count,
      warning_delta: response.delta.warning_count,
      high_confidence_delta: response.delta.high_confidence_cases,
      selected_case_count:
        response.benchmark_snapshot?.selected_case_count ?? response.after.selected_case_count,
    }),
    lock_scope: (payload) => payload.benchmark_pack_id,
    lease_ttl_ms: 45 * 60 * 1000,
  },
  self_audit: {
    parse: (payload) => selfAuditRequestSchema.parse(payload),
    execute: (services, payload) => runSelfAudit(services, payload),
    summarize: (response) => ({
      processed_predictions: response.auto_score.processed,
      auto_score_errors: response.auto_score.errors.length,
      snapshot_captured: response.calibration_snapshot !== null,
      model_count: response.model_comparison.versions.length,
    }),
    status_from_result: (response) => (response.auto_score.errors.length ? "partial" : "success"),
    lock_scope: (payload) => payload.as_of ?? "latest",
    lease_ttl_ms: 45 * 60 * 1000,
  },
  evolution_cycle: {
    parse: (payload) => evolutionCycleRequestSchema.parse(payload),
    execute: (services, payload) => runEvolutionCycle(services, payload),
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
    lock_scope: (payload) => payload.benchmark_pack_id ?? "default",
    lease_ttl_ms: 60 * 60 * 1000,
  },
  promotion_cycle: {
    parse: (payload) => promotionCycleRequestSchema.parse(payload),
    execute: (services, payload) => runPromotionCycle(services.repository, payload),
    summarize: (response) => ({
      processed: response.processed,
      passed: response.passed,
      failed: response.failed,
      candidate_count: response.candidates.length,
    }),
    status_from_result: (response) =>
      response.failed > 0 && response.passed > 0 ? "partial" : "success",
    lock_scope: (payload) => payload.benchmark_pack_id ?? payload.case_pack,
    lease_ttl_ms: 60 * 60 * 1000,
  },
  molt_cycle: {
    parse: (payload) => moltCycleRequestSchema.parse(payload),
    execute: (services, payload) => runMoltCycle(services.repository, payload),
    summarize: (response) => ({
      generated: response.generated,
      hardened: response.hardened,
      held: response.held,
      skipped: response.skipped,
      item_count: response.items.length,
    }),
    status_from_result: (response) =>
      response.held > 0 && response.hardened > 0 ? "partial" : "success",
    lock_scope: (payload) => payload.benchmark_pack_id ?? payload.case_pack,
    lease_ttl_ms: 60 * 60 * 1000,
  },
  scheduled_evolution: {
    parse: (payload) => scheduledEvolutionPayloadSchema.parse(payload),
    execute: (services, payload) => runScheduledEvolution(services, payload),
    summarize: (response) => ({
      ran: response.ran,
      due_self_audit: response.due.self_audit,
      due_benchmark_snapshot: response.due.benchmark_snapshot,
      due_walk_forward_snapshot: response.due.walk_forward_snapshot,
      due_trust_refresh: response.due.benchmark_trust_refresh,
      due_molt_cycle: response.due.molt_cycle,
      seeded_high_confidence_cases: response.trust_refresh?.seed.promoted_count ?? 0,
      trust_warning_delta: response.trust_refresh?.delta.warning_count ?? 0,
      walk_forward_window_count: response.result?.walk_forward_snapshot?.window_count ?? 0,
      hardened_shells: response.result?.molt_cycle?.hardened ?? 0,
    }),
    lock_scope: () => "default",
    lease_ttl_ms: 60 * 60 * 1000,
  },
  cpi_intelligence: {
    parse: (payload) => cpiIntelligencePayloadSchema.parse(payload),
    execute: (services, payload) => runCpiIntelligenceOperation(services, payload),
    summarize: (result) => ({
      period: result.period,
      cluster_id: result.cluster_id,
      analog_count: result.analog_count,
      prediction_count: result.prediction_count,
      explanation_count: result.explanation_count,
      memory_case_id: result.memory_case_id,
      verdict: result.verdict,
      store_size: result.store_size,
    }),
    lock_scope: (payload) => `cpi:${payload.cpi_release.period}`,
    lease_ttl_ms: 5 * 60 * 1000,
  },
  fomc_intelligence: {
    parse: (payload) => fomcIntelligencePayloadSchema.parse(payload),
    execute: (services, payload) => runFomcIntelligenceOperation(services, payload),
    summarize: (result) => ({
      period: result.period,
      cluster_id: result.cluster_id,
      analog_count: result.analog_count,
      prediction_count: result.prediction_count,
      explanation_count: result.explanation_count,
      memory_case_id: result.memory_case_id,
      verdict: result.verdict,
      store_size: result.store_size,
    }),
    lock_scope: (payload) => `fomc:${payload.fomc_decision.period}`,
    lease_ttl_ms: 5 * 60 * 1000,
  },
  nfp_intelligence: {
    parse: (payload) => nfpIntelligencePayloadSchema.parse(payload),
    execute: (services, payload) => runNfpIntelligenceOperation(services, payload),
    summarize: (result) => ({
      period: result.period,
      cluster_id: result.cluster_id,
      analog_count: result.analog_count,
      prediction_count: result.prediction_count,
      explanation_count: result.explanation_count,
      memory_case_id: result.memory_case_id,
      verdict: result.verdict,
      store_size: result.store_size,
    }),
    lock_scope: (payload) => `nfp:${payload.nfp_release.period}`,
    lease_ttl_ms: 5 * 60 * 1000,
  },
};

const getOperationDefinition = <Name extends SystemOperationName>(operationName: Name) =>
  operationDefinitions[operationName];

export const parseOperationJobPayload = (
  operationName: SystemOperationName,
  payload: Record<string, unknown>,
) => getOperationDefinition(operationName).parse(payload);

export const buildOperationLockScope = (
  operationName: SystemOperationName,
  payload: Record<string, unknown>,
) => {
  const definition = getOperationDefinition(operationName);
  return definition.lock_scope(definition.parse(payload));
};

export const enqueueOperationJobRequest = async (
  services: AppServices,
  request: {
    operation_name: OperationJobEnqueueRequest["operation_name"];
    payload?: OperationJobEnqueueRequest["payload"];
    idempotency_key?: OperationJobEnqueueRequest["idempotency_key"];
    max_attempts?: number;
    available_at?: string;
  },
  triggeredBy: OperationJobRecord["triggered_by"],
) => {
  const parsedRequest = operationJobEnqueueRequestSchema.parse(request);
  const parsedPayload = parseOperationJobPayload(
    parsedRequest.operation_name,
    parsedRequest.payload,
  );
  const integration = operationIntegrationMap[parsedRequest.operation_name];
  const governanceState = integration
    ? await getSystemIntegrationGovernanceState(services.repository, integration)
    : null;

  if (governanceState?.action === "suppress") {
    throw new IntegrationGovernanceSuppressedError(governanceState);
  }

  return services.repository.enqueueOperationJob({
    operation_name: parsedRequest.operation_name,
    triggered_by: triggeredBy,
    payload: parsedPayload as Record<string, JsonValue>,
    idempotency_key: parsedRequest.idempotency_key ?? null,
    max_attempts: parsedRequest.max_attempts,
    available_at:
      governanceState?.action === "throttle"
        ? resolveQueuedAvailableAt(
            parsedRequest.available_at,
            governanceState.retry_delay_seconds,
          )
        : parsedRequest.available_at ?? new Date().toISOString(),
  });
};

export const processNextOperationJob = async (
  services: AppServices,
  options: {
    worker_id: string;
    as_of?: string;
    lease_ttl_ms?: number;
    heartbeat_interval_ms?: number;
    supported_operations?: SystemOperationName[];
    retry_delay_seconds?: number;
  },
) => {
  const now = options.as_of ?? new Date().toISOString();
  const requestedLeaseTtlMs = options.lease_ttl_ms ?? 30 * 60 * 1000;
  const claimed = await services.repository.claimNextOperationJob({
    worker_id: options.worker_id,
    as_of: now,
    lease_expires_at: new Date(new Date(now).getTime() + requestedLeaseTtlMs).toISOString(),
    supported_operations: options.supported_operations,
  });

  if (!claimed) {
    return null;
  }

  const definition = getOperationDefinition(claimed.operation_name);
  const parsedPayload = definition.parse(claimed.payload);
  const integration = operationIntegrationMap[claimed.operation_name];

  if (integration) {
    const governanceState = await getSystemIntegrationGovernanceState(
      services.repository,
      integration,
    );

    if (governanceState.action !== "allow") {
      const deferredAt = new Date().toISOString();
      const deferred = await services.repository.deferOperationJob({
        id: claimed.id,
        worker_id: options.worker_id,
        deferred_at: deferredAt,
        available_at: resolveQueuedAvailableAt(
          claimed.available_at,
          governanceState.retry_delay_seconds,
        ),
        error_message: governanceState.detail,
        result_summary: {
          governance_action: governanceState.action,
          governance_reason: governanceState.reason,
          integration,
          retry_delay_seconds: governanceState.retry_delay_seconds,
        },
      });

      return {
        job: deferred ?? claimed,
        retry_scheduled: true,
      };
    }
  }

  const resolvedLeaseTtlMs = definition.lease_ttl_ms ?? requestedLeaseTtlMs;
  const heartbeatIntervalMs = resolveHeartbeatIntervalMs(
    resolvedLeaseTtlMs,
    options.heartbeat_interval_ms,
  );
  const jobHeartbeat = startAsyncHeartbeat({
    interval_ms: heartbeatIntervalMs,
    label: `operation-job:${claimed.id}`,
    on_heartbeat: async () => {
      const heartbeatAt = new Date().toISOString();
      const heartbeat = await services.repository.heartbeatOperationJob({
        id: claimed.id,
        worker_id: options.worker_id,
        heartbeat_at: heartbeatAt,
        lease_expires_at: new Date(
          new Date(heartbeatAt).getTime() + resolvedLeaseTtlMs,
        ).toISOString(),
      });

      if (!heartbeat) {
        console.warn(`Lost job heartbeat for queued operation ${claimed.id}`);
      }
    },
  });

  try {
    const result = await runTrackedOperation(
      {
        repository: services.repository,
        operation_name: claimed.operation_name,
        triggered_by: "internal",
        metadata: {
          job_id: claimed.id,
          queued_trigger: claimed.triggered_by,
          attempt_count: claimed.attempt_count,
        },
        summarize: definition.summarize,
        status_from_result: definition.status_from_result,
        lease: {
          scope_key: definition.lock_scope(parsedPayload),
          owner: `job:${claimed.id}`,
          ttl_ms: resolvedLeaseTtlMs,
          heartbeat_interval_ms: heartbeatIntervalMs,
        },
      },
      () => definition.execute(services, parsedPayload),
    );

    const completed = await services.repository.completeOperationJob({
      id: claimed.id,
      worker_id: options.worker_id,
      finished_at: new Date().toISOString(),
      result_summary: definition.summarize(result),
    });

    return {
      job: completed ?? claimed,
      result,
      retry_scheduled: false,
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const retryable = definition.retryable ? definition.retryable(error) : true;
    const retryDelaySeconds = definition.retry_delay_seconds
      ? definition.retry_delay_seconds({
          error,
          job: claimed,
          default_retry_delay_seconds: options.retry_delay_seconds ?? defaultRetryDelaySeconds,
        })
      : options.retry_delay_seconds ?? defaultRetryDelaySeconds;
    const retryAt =
      retryable && claimed.attempt_count < claimed.max_attempts && retryDelaySeconds !== null
        ? new Date(new Date(finishedAt).getTime() + retryDelaySeconds * 1000).toISOString()
        : null;
    const failed = await services.repository.failOperationJob({
      id: claimed.id,
      worker_id: options.worker_id,
      finished_at: finishedAt,
      error_message: error instanceof Error ? error.message : "Unknown queued operation failure.",
      retry_at: retryAt,
      result_summary: {
        retryable,
        retry_delay_seconds: retryAt ? retryDelaySeconds : null,
        error_name: error instanceof Error ? error.name : "UnknownError",
        ...(isExternalIntegrationError(error)
          ? {
              integration: error.integration,
              status_code: error.status_code,
              retry_after_seconds: error.retry_after_seconds,
            }
          : {}),
      },
    });

    return {
      job: failed ?? claimed,
      error,
      retry_scheduled: Boolean(retryAt),
    };
  } finally {
    await jobHeartbeat.stop();
  }
};

export const drainOperationJobs = async (
  services: AppServices,
  options: {
    worker_id: string;
    max_jobs?: number;
    heartbeat_interval_ms?: number;
    supported_operations?: SystemOperationName[];
    retry_delay_seconds?: number;
  },
) => {
  const results: Array<{
    job: OperationJobRecord;
    retry_scheduled: boolean;
    error?: unknown;
  }> = [];
  const maxJobs = Math.max(1, options.max_jobs ?? 25);
  const abandoned = await services.repository.abandonStaleOperationJobs({
    as_of: new Date().toISOString(),
    supported_operations: options.supported_operations,
    limit: maxJobs,
  });

  for (let index = 0; index < maxJobs; index += 1) {
    const next = await processNextOperationJob(services, {
      worker_id: options.worker_id,
      heartbeat_interval_ms: options.heartbeat_interval_ms,
      supported_operations: options.supported_operations,
      retry_delay_seconds: options.retry_delay_seconds,
    });

    if (!next) {
      break;
    }

    results.push({
      job: next.job,
      retry_scheduled: next.retry_scheduled,
      ...(next.error ? { error: next.error } : {}),
    });
  }

  return {
    abandoned: abandoned.length,
    processed: results.length,
    completed: results.filter((item) => item.job.status === "completed").length,
    failed: results.filter((item) => item.job.status === "failed").length,
    retried: results.filter((item) => item.retry_scheduled).length,
    results,
  };
};
