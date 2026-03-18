import { dashboardOperationalResponseSchema } from "@finance-superbrain/schemas";
import type { DashboardOperationalResponse } from "@finance-superbrain/schemas";

import { buildOperationQueueAlertReport } from "./operationQueueAlertReport.js";
import { buildOperationQueueReport } from "./operationQueueReport.js";
import type { Repository } from "./repository.types.js";
import { buildSystemIntegrationReport } from "./systemIntegrationReport.js";
import { buildStoredSystemIntegrationProbeReport } from "./systemIntegrationProbeReport.js";
import { buildStoredSystemIntegrationGovernanceReport } from "./systemIntegrationGovernanceReport.js";
import { buildSystemIntegrationTrendReport } from "./systemIntegrationTrendReport.js";
import { buildSystemOperationReport } from "./systemOperationReport.js";
import { buildSystemOperationalIncidentReport } from "./systemOperationalIncidentReport.js";
import { buildSystemWorkerServiceReport } from "./systemWorkerServiceReport.js";
import { buildSystemWorkerServiceTrendReport } from "./systemWorkerServiceTrendReport.js";
import { buildSystemWorkerReport } from "./systemWorkerReport.js";
import { buildSystemWorkerTrendReport } from "./systemWorkerTrendReport.js";

export const buildDashboardOperational = async (
  repository: Repository,
): Promise<DashboardOperationalResponse> => {
  const [
    operations,
    queue,
    workers,
    workerServices,
    workerServiceTrends,
    workerTrends,
    integrations,
    integrationProbes,
    integrationTrends,
  ] =
    await Promise.all([
      buildSystemOperationReport(repository, { limit: 40 }),
      buildOperationQueueReport(repository, { limit: 20 }),
      buildSystemWorkerReport(repository, { limit: 10 }),
      buildSystemWorkerServiceReport(repository, { limit: 10 }),
      buildSystemWorkerServiceTrendReport(repository, {
        window_hours: 24,
        bucket_hours: 4,
        recent_limit: 12,
      }),
      buildSystemWorkerTrendReport(repository, {
        window_hours: 24,
        bucket_hours: 4,
        recent_limit: 12,
      }),
      buildSystemIntegrationReport(repository, { limit: 10 }),
      buildStoredSystemIntegrationProbeReport(repository),
      buildSystemIntegrationTrendReport(repository, {
        window_hours: 24,
        bucket_hours: 4,
        recent_limit: 12,
      }),
    ]);

  const integrationGovernance = await buildStoredSystemIntegrationGovernanceReport(repository);

  const queueAlerts = await buildOperationQueueAlertReport(repository, {
    limit: 20,
    queue_report: queue,
    worker_report: workers,
    worker_service_report: workerServices,
  });

  const incidents = await buildSystemOperationalIncidentReport(repository, {
    limit: 20,
    queue_alert_report: queueAlerts,
    worker_trend_report: workerTrends,
    worker_service_report: workerServices,
    worker_service_trend_report: workerServiceTrends,
    integration_report: integrations,
    integration_governance_report: integrationGovernance,
    integration_probe_report: integrationProbes,
    integration_trend_report: integrationTrends,
  });

  return dashboardOperationalResponseSchema.parse({
    generated_at: new Date().toISOString(),
    operations,
    queue,
    queue_alerts: queueAlerts,
    incidents,
    workers,
    worker_services: workerServices,
    worker_service_trends: workerServiceTrends,
    worker_trends: workerTrends,
    integrations,
    integration_probes: integrationProbes,
    integration_governance: integrationGovernance,
    integration_trends: integrationTrends,
  });
};
