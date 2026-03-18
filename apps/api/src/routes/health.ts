import type { FastifyInstance } from "fastify";
import { readinessResponseSchema } from "@finance-superbrain/schemas";

import { buildOperationQueueAlertReport } from "../lib/operationQueueAlertReport.js";
import { buildOperationQueueReport } from "../lib/operationQueueReport.js";
import { buildSystemIntegrationReport } from "../lib/systemIntegrationReport.js";
import { buildSystemIntegrationProbeReport } from "../lib/systemIntegrationProbeReport.js";
import { buildStoredSystemIntegrationProbeReport } from "../lib/systemIntegrationProbeReport.js";
import { resolveIntegrationProbeTimeoutMs } from "../lib/systemIntegrationProbeReport.js";
import { buildStoredSystemIntegrationGovernanceReport } from "../lib/systemIntegrationGovernanceReport.js";
import { buildSystemIntegrationTrendReport } from "../lib/systemIntegrationTrendReport.js";
import { buildSystemOperationalIncidentReport } from "../lib/systemOperationalIncidentReport.js";
import { buildSystemWorkerServiceReport } from "../lib/systemWorkerServiceReport.js";
import { buildSystemWorkerServiceTrendReport } from "../lib/systemWorkerServiceTrendReport.js";
import { buildSystemWorkerReport } from "../lib/systemWorkerReport.js";
import { buildSystemWorkerTrendReport } from "../lib/systemWorkerTrendReport.js";
import type { AppServices } from "../lib/services.js";

const countIntegrationProbeAlerts = (
  alerts: Array<{ signal: string }>,
) => ({
  stale_snapshots: alerts.filter((alert) => alert.signal === "probe_snapshot_stale").length,
  missing_snapshots: alerts.filter((alert) => alert.signal === "probe_snapshot_missing").length,
});

const runDependencyCheck = async (
  name: string,
  check: () => Promise<void>,
) => {
  const startedAt = Date.now();

  try {
    await check();
    return {
      name,
      status: "ready" as const,
      latency_ms: Date.now() - startedAt,
      detail: null,
    };
  } catch (error) {
    return {
      name,
      status: "degraded" as const,
      latency_ms: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : "Unknown dependency failure.",
    };
  }
};

export const registerHealthRoutes = async (
  server: FastifyInstance,
  services: AppServices,
) => {
  server.get("/health", async () => {
    const [
      recentRuns,
      queueReport,
      workerReport,
      workerServiceReport,
      workerServiceTrendReport,
      workerTrendReport,
      integrationReport,
      integrationProbeReport,
      integrationGovernanceReport,
      integrationTrendReport,
    ] =
      await Promise.all([
        services.repository.listOperationRuns({
          limit: 10,
        }),
        buildOperationQueueReport(services.repository, {
          limit: 20,
        }),
        buildSystemWorkerReport(services.repository, {
          limit: 20,
        }),
        buildSystemWorkerServiceReport(services.repository, {
          limit: 20,
        }),
        buildSystemWorkerServiceTrendReport(services.repository, {
          window_hours: 24,
          bucket_hours: 4,
          recent_limit: 12,
        }),
        buildSystemWorkerTrendReport(services.repository, {
          window_hours: 24,
          bucket_hours: 4,
          recent_limit: 12,
        }),
        buildSystemIntegrationReport(services.repository, {
          limit: 12,
        }),
        buildStoredSystemIntegrationProbeReport(services.repository),
        buildStoredSystemIntegrationGovernanceReport(services.repository),
        buildSystemIntegrationTrendReport(services.repository, {
          window_hours: 24,
          bucket_hours: 4,
          recent_limit: 12,
        }),
      ]);
    const queueAlerts = await buildOperationQueueAlertReport(services.repository, {
      limit: 20,
      queue_report: queueReport,
      worker_report: workerReport,
      worker_service_report: workerServiceReport,
    });
    const incidentReport = await buildSystemOperationalIncidentReport(services.repository, {
      limit: 20,
      queue_alert_report: queueAlerts,
      worker_trend_report: workerTrendReport,
      worker_service_report: workerServiceReport,
      worker_service_trend_report: workerServiceTrendReport,
      integration_report: integrationReport,
      integration_probe_report: integrationProbeReport,
      integration_governance_report: integrationGovernanceReport,
      integration_trend_report: integrationTrendReport,
    });
    const latestRun = recentRuns[0] ?? null;
    const latestFailure =
      latestRun?.status === "failed"
        ? latestRun
        : recentRuns.find((run) => run.status === "failed") ?? null;
    const latestRunRecovered =
      !latestFailure ||
      (latestRun !== null &&
        latestRun.status !== "failed" &&
        latestRun.finished_at.localeCompare(latestFailure.finished_at) > 0);
    const hasServiceBoundary = workerServiceReport.counts.total > 0;
    const workerBacklogBlocked =
      (queueReport.counts.pending > 0 || queueReport.counts.running > 0) &&
      workerReport.counts.active === 0;
    const workerServiceBacklogBlocked =
      hasServiceBoundary &&
      (queueReport.counts.pending > 0 || queueReport.counts.running > 0) &&
      workerServiceReport.counts.active + workerServiceReport.counts.backing_off === 0;
    const ok =
      latestRunRecovered &&
      queueReport.counts.stale_running === 0 &&
      workerReport.counts.stale === 0 &&
      workerServiceReport.counts.stale === 0 &&
      workerServiceReport.counts.failed === 0 &&
      !workerBacklogBlocked &&
      !workerServiceBacklogBlocked &&
      integrationReport.counts.critical === 0;
    const highestWorkerStatus =
      workerReport.counts.stale > 0
        ? "stale"
        : workerReport.counts.active > 0
          ? "active"
          : workerReport.counts.stopped > 0
            ? "stopped"
            : null;
    const highestWorkerServiceStatus =
      workerServiceReport.counts.failed > 0
        ? "failed"
        : workerServiceReport.counts.stale > 0
          ? "stale"
          : workerServiceReport.counts.backing_off > 0
            ? "backing_off"
            : workerServiceReport.counts.active > 0
              ? "active"
              : workerServiceReport.counts.stopped > 0
                ? "stopped"
                : null;
    const highestIntegrationSeverity =
      integrationReport.counts.critical > 0
        ? "critical"
        : integrationReport.counts.degraded > 0
          ? "degraded"
          : integrationReport.counts.healthy > 0
            ? "healthy"
            : null;
    const throttledGovernanceStates = integrationGovernanceReport.states.filter(
      (state) => state.action === "throttle",
    );
    const suppressedGovernanceStates = integrationGovernanceReport.states.filter(
      (state) => state.action === "suppress",
    );
    const highestIncidentSeverity =
      incidentReport.incidents.find((incident) => incident.severity === "high")?.severity ??
      incidentReport.incidents.find((incident) => incident.severity === "medium")?.severity ??
      incidentReport.incidents.find((incident) => incident.severity === "low")?.severity ??
      null;
    const integrationProbeAlertCounts = countIntegrationProbeAlerts(
      integrationProbeReport.alerts,
    );
    const highestWorkerServiceAlertSeverity =
      workerServiceTrendReport.alerts.find((alert) => alert.severity === "high")?.severity ??
      workerServiceTrendReport.alerts.find((alert) => alert.severity === "medium")?.severity ??
      workerServiceTrendReport.alerts.find((alert) => alert.severity === "low")?.severity ??
      null;
    const nextWorkerServiceRestartDueAt = workerServiceReport.services
      .map((service) => service.restart_due_at)
      .filter((dueAt): dueAt is string => dueAt !== null)
      .sort((left, right) => left.localeCompare(right))[0] ?? null;
    const maxWorkerServiceRemainingBackoffMs = workerServiceReport.services.reduce<number | null>(
      (current, service) => {
        if (service.remaining_restart_backoff_ms === null) {
          return current;
        }

        return current === null
          ? service.remaining_restart_backoff_ms
          : Math.max(current, service.remaining_restart_backoff_ms);
      },
      null,
    );

    return {
      ok: ok && incidentReport.counts.high === 0,
      service: "finance-superbrain-api",
      operation_monitoring: {
        recent_run_count: recentRuns.length,
        latest_run_at: latestRun?.finished_at ?? null,
        latest_failure_at: latestFailure?.finished_at ?? null,
        latest_failure_operation: latestFailure?.operation_name ?? null,
      },
      queue_monitoring: {
        pending_jobs: queueReport.counts.pending,
        running_jobs: queueReport.counts.running,
        retry_scheduled_jobs: queueReport.counts.retry_scheduled,
        stale_running_jobs: queueReport.counts.stale_running,
        active_leases: queueReport.active_leases,
        oldest_pending_age_ms: queueReport.oldest_pending_age_ms,
        alert_counts: queueAlerts.counts,
        highest_alert_severity:
          queueAlerts.alerts.find((alert) => alert.severity === "high")?.severity ??
          queueAlerts.alerts.find((alert) => alert.severity === "medium")?.severity ??
          queueAlerts.alerts.find((alert) => alert.severity === "low")?.severity ??
          null,
      },
      worker_monitoring: {
        registered_workers: workerReport.counts.total,
        active_workers: workerReport.counts.active,
        stale_workers: workerReport.counts.stale,
        stopped_workers: workerReport.counts.stopped,
        highest_status: highestWorkerStatus,
        latest_heartbeat_at: workerReport.workers[0]?.last_heartbeat_at ?? null,
        backlog_blocked: workerBacklogBlocked,
        recent_error_stops: workerTrendReport.counts.error_stops,
        recent_abandoned_jobs: workerTrendReport.counts.abandoned,
        trend_alert_count: workerTrendReport.alerts.length,
      },
      worker_service_monitoring: {
        registered_services: workerServiceReport.counts.total,
        active_services: workerServiceReport.counts.active,
        backing_off_services: workerServiceReport.counts.backing_off,
        stale_services: workerServiceReport.counts.stale,
        failed_services: workerServiceReport.counts.failed,
        stopped_services: workerServiceReport.counts.stopped,
        highest_status: highestWorkerServiceStatus,
        latest_heartbeat_at: workerServiceReport.services[0]?.last_heartbeat_at ?? null,
        next_restart_due_at: nextWorkerServiceRestartDueAt,
        max_remaining_restart_backoff_ms: maxWorkerServiceRemainingBackoffMs,
        backlog_blocked: workerServiceBacklogBlocked,
        recent_scheduled_restarts: workerServiceTrendReport.counts.scheduled_restarts,
        recent_ownership_conflicts: workerServiceTrendReport.counts.ownership_conflicts,
        recent_failures: workerServiceTrendReport.counts.failed,
        backoff_unavailable_alerts: workerServiceTrendReport.alerts.filter(
          (alert) => alert.signal === "backoff_unavailable",
        ).length,
        restart_storm_alerts: workerServiceTrendReport.alerts.filter(
          (alert) => alert.signal === "restart_storm",
        ).length,
        boundary_instability_alerts: workerServiceTrendReport.alerts.filter(
          (alert) => alert.signal === "boundary_instability",
        ).length,
        trend_alert_count: workerServiceTrendReport.alerts.length,
        highest_alert_severity: highestWorkerServiceAlertSeverity,
      },
      integration_monitoring: {
        healthy_integrations: integrationReport.counts.healthy,
        degraded_integrations: integrationReport.counts.degraded,
        critical_integrations: integrationReport.counts.critical,
        highest_severity: highestIntegrationSeverity,
        alert_count: integrationReport.alerts.length,
        latest_incident_at: integrationReport.recent_incidents[0]?.updated_at ?? null,
        recent_retry_scheduled: integrationTrendReport.slices.reduce(
          (total, slice) => total + slice.counts.retry_scheduled,
          0,
        ),
        recent_non_retryable_failures: integrationTrendReport.slices.reduce(
          (total, slice) => total + slice.counts.non_retryable_failures,
          0,
        ),
        trend_alert_count: integrationTrendReport.alerts.length,
      },
      integration_governance_monitoring: {
        throttled_integrations: throttledGovernanceStates.length,
        suppressed_integrations: suppressedGovernanceStates.length,
        highest_action:
          suppressedGovernanceStates.length > 0
            ? "suppress"
            : throttledGovernanceStates.length > 0
              ? "throttle"
              : "allow",
        stale_states: integrationGovernanceReport.states.filter(
          (state) =>
            new Date().getTime() - new Date(state.checked_at).getTime() >
            integrationGovernanceReport.freshness_ms,
        ).length,
        alert_count: integrationGovernanceReport.alerts.length,
      },
      integration_probe_monitoring: {
        configured_targets: integrationProbeReport.configured_target_count,
        ready_targets: integrationProbeReport.ready_target_count,
        degraded_targets: integrationProbeReport.degraded_target_count,
        unknown_targets: integrationProbeReport.unknown_target_count,
        highest_provider_status:
          integrationProbeReport.degraded_target_count > 0
            ? "degraded"
            : integrationProbeReport.ready_target_count > 0
              ? "ready"
              : "unknown",
        highest_snapshot_status:
          integrationProbeAlertCounts.missing_snapshots > 0
            ? "missing"
            : integrationProbeAlertCounts.stale_snapshots > 0
              ? "stale"
              : "fresh",
        stale_snapshots: integrationProbeAlertCounts.stale_snapshots,
        missing_snapshots: integrationProbeAlertCounts.missing_snapshots,
        alert_count: integrationProbeReport.alerts.length,
      },
      incident_monitoring: {
        low: incidentReport.counts.low,
        medium: incidentReport.counts.medium,
        high: incidentReport.counts.high,
        open_incidents: incidentReport.incidents.length,
        highest_severity: highestIncidentSeverity,
      },
    };
  });

  server.get("/ready", async (_request, reply) => {
    const [repositoryStatus, embeddingStatus, integrationProbeReport] = await Promise.all([
      runDependencyCheck("repository", async () => {
        await services.repository.listModelVersions();
      }),
      runDependencyCheck("embedding_provider", async () => {
        await services.embeddingProvider.embedText("finance-superbrain readiness");
      }),
      buildSystemIntegrationProbeReport({
        timeout_ms: resolveIntegrationProbeTimeoutMs(process.env.INTEGRATION_PROBE_TIMEOUT_MS),
      }),
    ]);
    const probeDependencies = integrationProbeReport.summaries.map((summary) => ({
      name: `${summary.integration}_provider`,
      status: summary.highest_status,
      latency_ms: null,
      detail:
        summary.configured_targets === 0
          ? `No ${summary.integration} probe URLs configured.`
          : `${summary.ready_targets}/${summary.configured_targets} ${summary.integration} probe target(s) responded successfully.`,
    }));
    const marketDataStatus = {
      name: "market_data_provider",
      status: "unknown" as const,
      latency_ms: null,
      detail:
        "Active probe skipped because market-data providers require prediction and event context.",
    };
    const payload = readinessResponseSchema.parse({
      ok:
        repositoryStatus.status === "ready" &&
        embeddingStatus.status === "ready" &&
        probeDependencies.every((dependency) => dependency.status !== "degraded"),
      service: "finance-superbrain-api",
      checked_at: new Date().toISOString(),
      dependencies: [repositoryStatus, embeddingStatus, marketDataStatus, ...probeDependencies],
    });

    reply.code(payload.ok ? 200 : 503);
    return payload;
  });
};
