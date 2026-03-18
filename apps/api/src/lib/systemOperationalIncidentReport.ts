import { systemOperationalIncidentReportSchema } from "@finance-superbrain/schemas";
import type {
  OperationQueueAlert,
  OperationQueueAlertReport,
  SystemIntegrationAlert,
  SystemIntegrationGovernanceReport,
  SystemIntegrationProbeReport,
  SystemIntegrationReport,
  SystemIntegrationTrendReport,
  SystemOperationalIncident,
  SystemOperationalIncidentReport,
  SystemWorkerServiceReport,
  SystemWorkerServiceTrendAlert,
  SystemWorkerServiceTrendReport,
  SystemWorkerTrendAlert,
  SystemWorkerTrendReport,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";
import { buildOperationQueueAlertReport } from "./operationQueueAlertReport.js";
import { buildStoredSystemIntegrationGovernanceReport } from "./systemIntegrationGovernanceReport.js";
import { buildStoredSystemIntegrationProbeReport } from "./systemIntegrationProbeReport.js";
import { buildSystemIntegrationReport } from "./systemIntegrationReport.js";
import { buildSystemIntegrationTrendReport } from "./systemIntegrationTrendReport.js";
import { buildSystemWorkerServiceReport } from "./systemWorkerServiceReport.js";
import { buildSystemWorkerServiceTrendReport } from "./systemWorkerServiceTrendReport.js";
import { buildSystemWorkerTrendReport } from "./systemWorkerTrendReport.js";

const severityRank: Record<SystemOperationalIncident["severity"], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const buildIncident = (
  source: SystemOperationalIncident["source"],
  severity: SystemOperationalIncident["severity"],
  signal: string,
  title: string,
  detail: string,
  recommendation: string,
): SystemOperationalIncident => ({
  source,
  severity,
  signal,
  title,
  detail,
  recommendation,
});

const mapQueueAlert = (alert: OperationQueueAlert): SystemOperationalIncident =>
  buildIncident(
    "queue",
    alert.severity,
    alert.signal,
    alert.title,
    alert.detail,
    alert.recommendation,
  );

const mapWorkerTrendAlert = (alert: SystemWorkerTrendAlert): SystemOperationalIncident =>
  buildIncident(
    "worker",
    alert.severity,
    alert.signal,
    alert.title,
    alert.detail,
    alert.recommendation,
  );

const mapWorkerServiceTrendAlert = (
  alert: SystemWorkerServiceTrendAlert,
): SystemOperationalIncident =>
  buildIncident(
    "worker_service",
    alert.severity,
    alert.signal,
    alert.title,
    alert.detail,
    alert.recommendation,
  );

const mapIntegrationAlert = (alert: SystemIntegrationAlert): SystemOperationalIncident =>
  buildIncident(
    "integration",
    alert.severity === "critical" ? "high" : alert.severity === "degraded" ? "medium" : "low",
    `${alert.integration}_${alert.signal}`,
    `${alert.integration} | ${alert.title}`,
    alert.detail,
    alert.recommendation,
  );

const mapIntegrationProbeAlert = (alert: SystemIntegrationAlert): SystemOperationalIncident =>
  buildIncident(
    "integration",
    alert.severity === "critical" ? "high" : alert.severity === "degraded" ? "medium" : "low",
    `${alert.integration}_${alert.signal}`,
    `${alert.integration} | ${alert.title}`,
    alert.detail,
    alert.recommendation,
  );

const mapIntegrationGovernanceAlert = (
  alert: SystemIntegrationAlert,
): SystemOperationalIncident =>
  buildIncident(
    "integration",
    alert.severity === "critical" ? "high" : alert.severity === "degraded" ? "medium" : "low",
    `${alert.integration}_${alert.signal}`,
    `${alert.integration} | ${alert.title}`,
    alert.detail,
    alert.recommendation,
  );

const dedupeIncidents = (incidents: SystemOperationalIncident[]) => {
  const deduped = new Map<string, SystemOperationalIncident>();

  for (const incident of incidents) {
    const key = `${incident.source}:${incident.signal}:${incident.detail}`;
    const current = deduped.get(key);

    if (!current || severityRank[incident.severity] > severityRank[current.severity]) {
      deduped.set(key, incident);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    const severityDelta = severityRank[right.severity] - severityRank[left.severity];

    if (severityDelta !== 0) {
      return severityDelta;
    }

    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }

    return left.title.localeCompare(right.title);
  });
};

const buildWorkerServiceIncidents = (
  report: SystemWorkerServiceReport,
): SystemOperationalIncident[] => {
  const incidents: SystemOperationalIncident[] = [];
  const failedServices = report.services.filter((service) => service.status === "failed");
  const staleServices = report.services.filter((service) => service.status === "stale");
  const strainedBackoffServices = report.services.filter(
    (service) =>
      service.status === "backing_off" &&
      service.restart_streak >= Math.max(2, Math.ceil(service.max_restarts / 2)),
  );
  const activeOrBackingOff = report.counts.active + report.counts.backing_off;

  if (failedServices.length > 0) {
    incidents.push(
      buildIncident(
        "worker_service",
        "high",
        "failed_services",
        "Worker service supervision has failed",
        `${failedServices.length} worker service(s) are in a failed lifecycle state, including ${failedServices
          .slice(0, 3)
          .map((service) => service.service_id)
          .join(", ")}.`,
        "Recover or redeploy the failed worker service boundary before relying on queue drain or scheduled operations.",
      ),
    );
  }

  if (staleServices.length > 0) {
    incidents.push(
      buildIncident(
        "worker_service",
        activeOrBackingOff === 0 ? "high" : "medium",
        "stale_services",
        "Worker service heartbeats are stale",
        `${staleServices.length} worker service(s) have stale heartbeats, which suggests the supervisor boundary is no longer reliably reporting runtime state.`,
        "Inspect the worker service runtime and restart the stale supervisors so deployment ownership becomes trustworthy again.",
      ),
    );
  }

  if (strainedBackoffServices.length > 0) {
    const highestRestartStreak = Math.max(
      ...strainedBackoffServices.map((service) => service.restart_streak),
    );
    incidents.push(
      buildIncident(
        "worker_service",
        activeOrBackingOff === 0 || highestRestartStreak >= 3 ? "high" : "medium",
        "restart_backoff",
        "Worker services are churning through restart backoff",
        `${strainedBackoffServices.length} worker service(s) are in restart backoff with restart streaks up to ${highestRestartStreak}.`,
        "Inspect worker loop crash causes and deployment restarts before the service boundary turns intermittent or exhausts its restart budget.",
      ),
    );
  }

  if (
    report.counts.active === 0 &&
    report.counts.failed === 0 &&
    report.counts.stale === 0 &&
    report.counts.backing_off > 0
  ) {
    const nextRestartDueAt = report.services
      .map((service) => service.restart_due_at)
      .filter((dueAt): dueAt is string => dueAt !== null)
      .sort((left, right) => left.localeCompare(right))[0] ?? null;
    const maxRemainingBackoffMs = report.services.reduce<number | null>(
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
    const detailParts = [
      `${report.counts.backing_off} worker service(s) are currently backing off with no active supervisor boundary available.`,
    ];

    if (nextRestartDueAt !== null) {
      detailParts.push(`The next restart is due at ${nextRestartDueAt}.`);
    }

    if (maxRemainingBackoffMs !== null) {
      detailParts.push(`The longest remaining backoff is ${maxRemainingBackoffMs} ms.`);
    }

    incidents.push(
      buildIncident(
        "worker_service",
        "high",
        "backoff_unavailable",
        "All worker services are backing off",
        detailParts.join(" "),
        "Treat the queued worker boundary as temporarily unavailable until restart backoff clears or the crashing supervisor path is repaired.",
      ),
    );
  }

  return incidents;
};

export const buildSystemOperationalIncidentReport = async (
  repository: Repository,
  options: {
    limit?: number;
    queue_alert_report?: OperationQueueAlertReport;
    worker_trend_report?: SystemWorkerTrendReport;
    worker_service_report?: SystemWorkerServiceReport;
    worker_service_trend_report?: SystemWorkerServiceTrendReport;
    integration_report?: SystemIntegrationReport;
    integration_governance_report?: SystemIntegrationGovernanceReport;
    integration_probe_report?: SystemIntegrationProbeReport;
    integration_trend_report?: SystemIntegrationTrendReport;
  } = {},
): Promise<SystemOperationalIncidentReport> => {
  const [
    queueAlertReport,
    workerTrendReport,
    workerServiceReport,
    workerServiceTrendReport,
    integrationReport,
    integrationProbeReport,
    integrationGovernanceReport,
    integrationTrendReport,
  ] = await Promise.all([
    options.queue_alert_report ?? buildOperationQueueAlertReport(repository, { limit: options.limit ?? 20 }),
    options.worker_trend_report ??
      buildSystemWorkerTrendReport(repository, {
        window_hours: 24,
        bucket_hours: 4,
        recent_limit: Math.max(12, options.limit ?? 20),
      }),
    options.worker_service_report ?? buildSystemWorkerServiceReport(repository, { limit: options.limit ?? 20 }),
    options.worker_service_trend_report ??
      buildSystemWorkerServiceTrendReport(repository, {
        window_hours: 24,
        bucket_hours: 4,
        recent_limit: Math.max(12, options.limit ?? 20),
      }),
    options.integration_report ?? buildSystemIntegrationReport(repository, { limit: options.limit ?? 12 }),
    options.integration_probe_report ?? buildStoredSystemIntegrationProbeReport(repository),
    options.integration_governance_report ?? buildStoredSystemIntegrationGovernanceReport(repository),
    options.integration_trend_report ??
      buildSystemIntegrationTrendReport(repository, {
        window_hours: 24,
        bucket_hours: 4,
        recent_limit: Math.max(12, options.limit ?? 20),
      }),
  ]);

  const incidents = dedupeIncidents([
    ...queueAlertReport.alerts.map(mapQueueAlert),
    ...workerTrendReport.alerts.map(mapWorkerTrendAlert),
    ...buildWorkerServiceIncidents(workerServiceReport),
    ...workerServiceTrendReport.alerts.map(mapWorkerServiceTrendAlert),
    ...integrationReport.alerts.map(mapIntegrationAlert),
    ...integrationGovernanceReport.alerts.map(mapIntegrationGovernanceAlert),
    ...integrationProbeReport.alerts.map(mapIntegrationProbeAlert),
    ...integrationTrendReport.alerts.map(mapIntegrationAlert),
  ]).slice(0, Math.max(1, options.limit ?? 20));

  return systemOperationalIncidentReportSchema.parse({
    generated_at: new Date().toISOString(),
    counts: {
      low: incidents.filter((incident) => incident.severity === "low").length,
      medium: incidents.filter((incident) => incident.severity === "medium").length,
      high: incidents.filter((incident) => incident.severity === "high").length,
    },
    incidents,
  });
};
