import { systemWorkerTrendReportSchema } from "@finance-superbrain/schemas";
import type {
  SystemWorkerTrendAlert,
  SystemWorkerTrendBucket,
  SystemWorkerTrendReport,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";
import { buildSystemWorkerReport } from "./systemWorkerReport.js";

const buildAlert = (
  severity: SystemWorkerTrendAlert["severity"],
  signal: string,
  title: string,
  detail: string,
  recommendation: string,
): SystemWorkerTrendAlert => ({
  severity,
  signal,
  title,
  detail,
  recommendation,
});

const initializeBucket = (
  bucketStartedAt: Date,
  bucketMs: number,
): SystemWorkerTrendBucket => ({
  bucket_started_at: bucketStartedAt.toISOString(),
  bucket_finished_at: new Date(bucketStartedAt.getTime() + bucketMs).toISOString(),
  started: 0,
  stopped: 0,
  error_stops: 0,
  cycles: 0,
  processed: 0,
  completed: 0,
  failed: 0,
  retried: 0,
  abandoned: 0,
});

export const buildSystemWorkerTrendReport = async (
  repository: Repository,
  options: {
    window_hours?: number;
    bucket_hours?: number;
    recent_limit?: number;
  } = {},
): Promise<SystemWorkerTrendReport> => {
  const generatedAt = new Date();
  const windowHours = Math.max(1, options.window_hours ?? 24);
  const bucketHours = Math.max(1, Math.min(windowHours, options.bucket_hours ?? 4));
  const bucketMs = bucketHours * 60 * 60 * 1000;
  const windowStartedAt = new Date(generatedAt.getTime() - windowHours * 60 * 60 * 1000);
  const bucketCount = Math.max(1, Math.ceil(windowHours / bucketHours));
  const recentLimit = Math.max(1, Math.min(100, options.recent_limit ?? 12));

  const [events, workerReport] = await Promise.all([
    repository.listOperationWorkerEvents({
      limit: recentLimit,
      occurred_after: windowStartedAt.toISOString(),
      occurred_before: generatedAt.toISOString(),
    }),
    buildSystemWorkerReport(repository, {
      limit: 20,
      as_of: generatedAt.toISOString(),
    }),
  ]);
  const bucketSummaries = await repository.getOperationWorkerEventSummary({
    window_started_at: windowStartedAt.toISOString(),
    as_of: generatedAt.toISOString(),
    bucket_hours: bucketHours,
  });
  const bucketSummaryByStart = new Map(
    bucketSummaries.map((bucket) => [bucket.bucket_started_at, bucket] as const),
  );
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const initialized = initializeBucket(new Date(windowStartedAt.getTime() + index * bucketMs), bucketMs);
    return bucketSummaryByStart.get(initialized.bucket_started_at) ?? initialized;
  });

  const counts = buckets.reduce(
    (totals, bucket) => ({
      started: totals.started + bucket.started,
      stopped: totals.stopped + bucket.stopped,
      error_stops: totals.error_stops + bucket.error_stops,
      cycles: totals.cycles + bucket.cycles,
      processed: totals.processed + bucket.processed,
      completed: totals.completed + bucket.completed,
      failed: totals.failed + bucket.failed,
      retried: totals.retried + bucket.retried,
      abandoned: totals.abandoned + bucket.abandoned,
    }),
    {
      started: 0,
      stopped: 0,
      error_stops: 0,
      cycles: 0,
      processed: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      abandoned: 0,
    },
  );

  const alerts: SystemWorkerTrendAlert[] = [];

  if (counts.error_stops >= 2) {
    alerts.push(
      buildAlert(
        "high",
        "error_stops",
        "Workers are stopping with errors",
        `${counts.error_stops} worker stop event(s) in the last ${windowHours} hour(s) included an error message.`,
        "Inspect worker-loop logs and upstream failures before restart churn turns into prolonged queue backlog.",
      ),
    );
  } else if (counts.error_stops === 1) {
    alerts.push(
      buildAlert(
        "medium",
        "error_stops",
        "A worker stopped with an error recently",
        `One worker stop event in the last ${windowHours} hour(s) carried an error message.`,
        "Review the latest worker stop and confirm the supervised worker service recovered cleanly.",
      ),
    );
  }

  if (counts.started >= 3 && counts.started >= counts.cycles + 1) {
    alerts.push(
      buildAlert(
        "medium",
        "restart_churn",
        "Worker restarts are elevated",
        `${counts.started} worker start event(s) were recorded in the last ${windowHours} hour(s), which suggests restart churn relative to completed cycles.`,
        "Check worker-service supervision and deployment restarts so worker capacity stays predictable.",
      ),
    );
  }

  if (counts.abandoned > 0) {
    alerts.push(
      buildAlert(
        counts.abandoned >= 3 ? "high" : "medium",
        "abandoned_jobs",
        "Workers are leaving stale jobs behind",
        `${counts.abandoned} queued job(s) had to be auto-abandoned during worker cycles in the last ${windowHours} hour(s).`,
        "Investigate long-running job heartbeats, worker crashes, or external integrations that stall beyond lease renewal windows.",
      ),
    );
  }

  if (counts.retried >= 5) {
    alerts.push(
      buildAlert(
        counts.retried >= 10 ? "high" : "medium",
        "retry_pressure",
        "Worker retry pressure is elevated",
        `${counts.retried} retry scheduling event(s) were recorded by worker cycles in the last ${windowHours} hour(s).`,
        "Inspect integration health and queue growth together to confirm retries are still transient rather than systemic.",
      ),
    );
  }

  if (workerReport.counts.stale > 0) {
    alerts.push(
      buildAlert(
        workerReport.counts.stale >= 2 ? "high" : "medium",
        "stale_workers",
        "Worker heartbeat state is stale right now",
        `${workerReport.counts.stale} worker(s) are currently stale even after the recent trend window was considered.`,
        "Recover or restart stale workers so queue supervision matches the worker history trend.",
      ),
    );
  }

  return systemWorkerTrendReportSchema.parse({
    generated_at: generatedAt.toISOString(),
    window_hours: windowHours,
    bucket_hours: bucketHours,
    counts,
    buckets,
    recent_events: events.slice(0, recentLimit),
    alerts,
  });
};
