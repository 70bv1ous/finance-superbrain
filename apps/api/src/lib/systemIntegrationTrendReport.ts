import { systemIntegrationTrendReportSchema } from "@finance-superbrain/schemas";
import type {
  OperationJobRecord,
  SystemIntegration,
  SystemIntegrationAlert,
  SystemIntegrationIncident,
  SystemIntegrationTrendBucket,
  SystemIntegrationTrendReport,
  SystemIntegrationTrendSlice,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

const integrationOperations: Array<{
  integration: SystemIntegration;
  operation_name: "feed_pull" | "transcript_pull";
}> = [
  {
    integration: "feed",
    operation_name: "feed_pull",
  },
  {
    integration: "transcript",
    operation_name: "transcript_pull",
  },
];

const buildAlert = (
  integration: SystemIntegration,
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

const isRetryScheduled = (job: OperationJobRecord) => job.status === "pending" && job.attempt_count > 0;

const isNonRetryableFailure = (job: OperationJobRecord) =>
  job.status === "failed" && job.result_summary.retryable === false;

const isStaleRecovered = (job: OperationJobRecord) =>
  job.status === "failed" &&
  typeof job.error_message === "string" &&
  job.error_message.includes("lease expired");

const buildIncident = (job: OperationJobRecord): SystemIntegrationIncident => ({
  id: job.id,
  integration: job.operation_name === "feed_pull" ? "feed" : "transcript",
  operation_name: job.operation_name as "feed_pull" | "transcript_pull",
  status: job.status,
  retryable: typeof job.result_summary.retryable === "boolean" ? job.result_summary.retryable : null,
  status_code:
    typeof job.result_summary.status_code === "number" ? job.result_summary.status_code : null,
  attempt_count: job.attempt_count,
  updated_at: job.updated_at,
  error_message: job.error_message,
});

const initializeBucket = (bucketStartedAt: Date, bucketMs: number): SystemIntegrationTrendBucket => ({
  bucket_started_at: bucketStartedAt.toISOString(),
  bucket_finished_at: new Date(bucketStartedAt.getTime() + bucketMs).toISOString(),
  completed: 0,
  failed: 0,
  retry_scheduled: 0,
  non_retryable_failures: 0,
  stale_recovered: 0,
});

const deriveTrendSignal = (
  buckets: SystemIntegrationTrendBucket[],
): SystemIntegrationTrendSlice["trend_signal"] => {
  const latest = buckets[buckets.length - 1];
  const prior = buckets.length > 1 ? buckets[buckets.length - 2] : null;

  if (!latest) {
    return "quiet";
  }

  const latestPressure =
    latest.retry_scheduled + latest.failed + latest.non_retryable_failures + latest.stale_recovered;

  if (!prior) {
    return latestPressure > 0 ? "stable" : "quiet";
  }

  const priorPressure =
    prior.retry_scheduled + prior.failed + prior.non_retryable_failures + prior.stale_recovered;

  if (latestPressure === 0 && priorPressure === 0) {
    return "quiet";
  }

  if (latestPressure > priorPressure) {
    return "worsening";
  }

  if (latestPressure < priorPressure) {
    return "recovering";
  }

  return "stable";
};

export const buildSystemIntegrationTrendReport = async (
  repository: Repository,
  options: {
    window_hours?: number;
    bucket_hours?: number;
    recent_limit?: number;
  } = {},
): Promise<SystemIntegrationTrendReport> => {
  const generatedAt = new Date();
  const windowHours = Math.max(1, options.window_hours ?? 24);
  const bucketHours = Math.max(1, Math.min(windowHours, options.bucket_hours ?? 4));
  const bucketMs = bucketHours * 60 * 60 * 1000;
  const windowStartedAt = new Date(generatedAt.getTime() - windowHours * 60 * 60 * 1000);
  const bucketCount = Math.max(1, Math.ceil(windowHours / bucketHours));
  const recentLimit = Math.max(1, Math.min(100, options.recent_limit ?? 12));

  const jobs = await repository.listOperationJobs({
    limit: recentLimit,
    operation_names: integrationOperations.map((item) => item.operation_name),
    updated_after: windowStartedAt.toISOString(),
    updated_before: generatedAt.toISOString(),
  });
  const bucketSummaries = await repository.getOperationIntegrationTrendSummary({
    window_started_at: windowStartedAt.toISOString(),
    as_of: generatedAt.toISOString(),
    bucket_hours: bucketHours,
  });

  const slices: SystemIntegrationTrendSlice[] = integrationOperations.map((integrationOperation) => {
    const summariesByStart = new Map(
      bucketSummaries
        .filter((bucket) => bucket.operation_name === integrationOperation.operation_name)
        .map((bucket) => [bucket.bucket_started_at, bucket] as const),
    );
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const initialized = initializeBucket(new Date(windowStartedAt.getTime() + index * bucketMs), bucketMs);
      return summariesByStart.get(initialized.bucket_started_at) ?? initialized;
    });

    return {
      integration: integrationOperation.integration,
      operation_name: integrationOperation.operation_name,
      counts: buckets.reduce(
        (totals, bucket) => ({
          completed: totals.completed + bucket.completed,
          failed: totals.failed + bucket.failed,
          retry_scheduled: totals.retry_scheduled + bucket.retry_scheduled,
          non_retryable_failures: totals.non_retryable_failures + bucket.non_retryable_failures,
          stale_recovered: totals.stale_recovered + bucket.stale_recovered,
        }),
        {
          completed: 0,
          failed: 0,
          retry_scheduled: 0,
          non_retryable_failures: 0,
          stale_recovered: 0,
        },
      ),
      trend_signal: deriveTrendSignal(buckets),
      latest_incident_at:
        jobs
          .filter((job) => job.operation_name === integrationOperation.operation_name)
          .filter((job) => job.error_message !== null || isRetryScheduled(job))
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]
          ?.updated_at ?? null,
      buckets,
    };
  });

  const alerts: SystemIntegrationAlert[] = [];

  for (const slice of slices) {
    if (slice.counts.non_retryable_failures > 0) {
      alerts.push(
        buildAlert(
          slice.integration,
          slice.counts.non_retryable_failures >= 2 ? "critical" : "degraded",
          "non_retryable_failures",
          "Permanent integration failures are accumulating",
          `${slice.counts.non_retryable_failures} non-retryable ${slice.integration} failure(s) were recorded in the last ${windowHours} hour(s).`,
          "Review provider responses and source URLs because these failures likely need operator intervention rather than queue retries.",
        ),
      );
    }

    if (slice.counts.retry_scheduled >= 3) {
      alerts.push(
        buildAlert(
          slice.integration,
          slice.counts.retry_scheduled >= 5 ? "critical" : "degraded",
          "retry_storm",
          "Integration retries are building over time",
          `${slice.counts.retry_scheduled} ${slice.integration} retry scheduling event(s) were recorded in the last ${windowHours} hour(s).`,
          "Check upstream dependency health and queue throughput before retries pile into a prolonged backlog.",
        ),
      );
    }

    if (slice.counts.stale_recovered > 0) {
      alerts.push(
        buildAlert(
          slice.integration,
          "degraded",
          "stale_recovered",
          "Integration work had to be recovered after lease expiry",
          `${slice.counts.stale_recovered} ${slice.integration} job(s) were auto-abandoned after stale recovery in the last ${windowHours} hour(s).`,
          "Inspect worker stability and integration response times to confirm heartbeats and lease renewal are keeping pace with long-running calls.",
        ),
      );
    }
  }

  const recentIncidents = jobs
    .filter((job) => job.error_message !== null || isRetryScheduled(job))
    .slice(0, recentLimit)
    .map(buildIncident);

  return systemIntegrationTrendReportSchema.parse({
    generated_at: generatedAt.toISOString(),
    window_hours: windowHours,
    bucket_hours: bucketHours,
    slices,
    alerts,
    recent_incidents: recentIncidents,
  });
};
