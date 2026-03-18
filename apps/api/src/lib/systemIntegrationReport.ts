import { systemIntegrationReportSchema } from "@finance-superbrain/schemas";
import type {
  OperationJobRecord,
  SystemIntegrationAlert,
  SystemIntegrationHealth,
  SystemIntegrationIncident,
  SystemIntegrationReport,
} from "@finance-superbrain/schemas";

import type { OperationIntegrationQueueSummary, Repository } from "./repository.types.js";

const integrationOperationNames: OperationIntegrationQueueSummary["operation_name"][] = [
  "feed_pull",
  "transcript_pull",
];

const mapIntegrationName = (operationName: OperationIntegrationQueueSummary["operation_name"]) =>
  operationName === "feed_pull" ? "feed" : "transcript";

const parseNullableBoolean = (value: unknown) => (typeof value === "boolean" ? value : null);

const parseNullableStatusCode = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const buildAlert = (
  integration: SystemIntegrationHealth["integration"],
  severity: SystemIntegrationAlert["severity"],
  signal: string,
  title: string,
  detail: string,
  recommendation: string,
): SystemIntegrationAlert => ({
  integration,
  severity,
  signal,
  title,
  detail,
  recommendation,
});

const resolveSeverity = (
  summary: OperationIntegrationQueueSummary["counts"],
): SystemIntegrationHealth["severity"] => {
  if (
    summary.stale_running > 0 ||
    summary.non_retryable_failures >= 2 ||
    summary.retry_scheduled >= 5
  ) {
    return "critical";
  }

  if (
    summary.failed > 0 ||
    summary.retry_scheduled > 0 ||
    summary.stale_recovered > 0
  ) {
    return "degraded";
  }

  return "healthy";
};

const buildIntegrationAlerts = (
  integration: SystemIntegrationHealth["integration"],
  summary: OperationIntegrationQueueSummary["counts"],
): SystemIntegrationAlert[] => {
  const alerts: SystemIntegrationAlert[] = [];

  if (summary.stale_running > 0) {
    alerts.push(
      buildAlert(
        integration,
        "critical",
        "stale_running",
        "Integration jobs are stuck in running state",
        `${summary.stale_running} ${integration} job(s) have outlived their lease window and may need worker recovery.`,
        "Inspect the worker loop and confirm lease heartbeats are still reaching the repository during external calls.",
      ),
    );
  }

  if (summary.retry_scheduled >= 3) {
    alerts.push(
      buildAlert(
        integration,
        summary.retry_scheduled >= 5 ? "critical" : "degraded",
        "retry_storm",
        "Integration retries are building up",
        `${summary.retry_scheduled} ${integration} job(s) are already queued for retry.`,
        "Check the upstream provider and worker throughput before retries cascade into backlog growth.",
      ),
    );
  }

  if (summary.non_retryable_failures > 0) {
    alerts.push(
      buildAlert(
        integration,
        summary.non_retryable_failures >= 2 ? "critical" : "degraded",
        "non_retryable_failures",
        "Permanent integration failures detected",
        `${summary.non_retryable_failures} ${integration} job(s) failed in a way the queue will not retry automatically.`,
        "Review provider responses and source URLs because these failures likely need operator or ingestion-path fixes.",
      ),
    );
  }

  if (summary.stale_recovered > 0) {
    alerts.push(
      buildAlert(
        integration,
        "degraded",
        "stale_recovered",
        "Recovered stale integration jobs",
        `${summary.stale_recovered} ${integration} job(s) had to be auto-abandoned after their lease expired.`,
        "Confirm worker supervision is stable and that long-running integration jobs are still heartbeating correctly.",
      ),
    );
  }

  return alerts;
};

const buildIncident = (job: OperationJobRecord): SystemIntegrationIncident | null => {
  if (
    job.operation_name !== "feed_pull" &&
    job.operation_name !== "transcript_pull"
  ) {
    return null;
  }

  if (job.error_message === null && !(job.status === "pending" && job.attempt_count > 0)) {
    return null;
  }

  return {
    id: job.id,
    integration: mapIntegrationName(job.operation_name),
    operation_name: job.operation_name,
    status: job.status,
    retryable: parseNullableBoolean(job.result_summary.retryable),
    status_code: parseNullableStatusCode(job.result_summary.status_code),
    attempt_count: job.attempt_count,
    updated_at: job.updated_at,
    error_message: job.error_message,
  };
};

export const buildSystemIntegrationReport = async (
  repository: Repository,
  options: {
    limit?: number;
    as_of?: string;
  } = {},
): Promise<SystemIntegrationReport> => {
  const generatedAt = options.as_of ?? new Date().toISOString();
  const incidentLimit = Math.max(1, options.limit ?? 12);
  const [summaryRows, latestJobs, recentJobs] = await Promise.all([
    repository.getOperationIntegrationQueueSummary({
      as_of: generatedAt,
    }),
    repository.getLatestOperationJobsByOperation({
      operation_names: integrationOperationNames,
    }),
    repository.listOperationJobs({
      limit: Math.max(incidentLimit * 6, 24),
      operation_names: integrationOperationNames,
    }),
  ]);

  const summaryByOperation = new Map(
    summaryRows.map((row) => [row.operation_name, row] as const),
  );
  const latestJobByOperation = new Map(
    latestJobs.map((job) => [job.operation_name, job] as const),
  );

  const integrations: SystemIntegrationHealth[] = integrationOperationNames.map((operationName) => {
    const summary = summaryByOperation.get(operationName) ?? {
      operation_name: operationName,
      counts: {
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        retry_scheduled: 0,
        stale_running: 0,
        retryable_failures: 0,
        non_retryable_failures: 0,
        stale_recovered: 0,
      },
      latest_job_at: null,
      latest_failure_at: null,
    };
    const latestJob = latestJobByOperation.get(operationName) ?? null;

    return {
      integration: mapIntegrationName(operationName),
      operation_name: operationName,
      severity: resolveSeverity(summary.counts),
      total_jobs: summary.counts.total,
      pending_jobs: summary.counts.pending,
      running_jobs: summary.counts.running,
      completed_jobs: summary.counts.completed,
      failed_jobs: summary.counts.failed,
      retry_scheduled_jobs: summary.counts.retry_scheduled,
      stale_running_jobs: summary.counts.stale_running,
      retryable_failures: summary.counts.retryable_failures,
      non_retryable_failures: summary.counts.non_retryable_failures,
      stale_recovered_jobs: summary.counts.stale_recovered,
      latest_job_at: summary.latest_job_at,
      latest_failure_at: summary.latest_failure_at,
      latest_status: latestJob?.status ?? null,
      latest_attempt_count: latestJob?.attempt_count ?? null,
      latest_error_message: latestJob?.error_message ?? null,
      latest_status_code: latestJob
        ? parseNullableStatusCode(latestJob.result_summary.status_code)
        : null,
    };
  });

  const alerts = integrations.flatMap((integration) =>
    buildIntegrationAlerts(integration.integration, {
      total: integration.total_jobs,
      pending: integration.pending_jobs,
      running: integration.running_jobs,
      completed: integration.completed_jobs,
      failed: integration.failed_jobs,
      retry_scheduled: integration.retry_scheduled_jobs,
      stale_running: integration.stale_running_jobs,
      retryable_failures: integration.retryable_failures,
      non_retryable_failures: integration.non_retryable_failures,
      stale_recovered: integration.stale_recovered_jobs,
    }),
  );

  const recent_incidents = recentJobs
    .map(buildIncident)
    .filter((incident): incident is SystemIntegrationIncident => incident !== null)
    .slice(0, incidentLimit);

  return systemIntegrationReportSchema.parse({
    generated_at: generatedAt,
    counts: {
      healthy: integrations.filter((integration) => integration.severity === "healthy").length,
      degraded: integrations.filter((integration) => integration.severity === "degraded").length,
      critical: integrations.filter((integration) => integration.severity === "critical").length,
    },
    integrations,
    alerts,
    recent_incidents,
  });
};
