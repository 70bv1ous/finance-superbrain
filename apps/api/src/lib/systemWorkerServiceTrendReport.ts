import { systemWorkerServiceTrendReportSchema } from "@finance-superbrain/schemas";
import type {
  SystemWorkerServiceTrendAlert,
  SystemWorkerServiceTrendBucket,
  SystemWorkerServiceTrendReport,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";
import { buildSystemWorkerServiceReport } from "./systemWorkerServiceReport.js";

const buildAlert = (
  severity: SystemWorkerServiceTrendAlert["severity"],
  signal: string,
  title: string,
  detail: string,
  recommendation: string,
): SystemWorkerServiceTrendAlert => ({
  severity,
  signal,
  title,
  detail,
  recommendation,
});

const initializeBucket = (
  bucketStartedAt: Date,
  bucketMs: number,
): SystemWorkerServiceTrendBucket => ({
  bucket_started_at: bucketStartedAt.toISOString(),
  bucket_finished_at: new Date(bucketStartedAt.getTime() + bucketMs).toISOString(),
  started: 0,
  ownership_conflicts: 0,
  loop_exits: 0,
  scheduled_restarts: 0,
  stopped: 0,
  failed: 0,
});

export const buildSystemWorkerServiceTrendReport = async (
  repository: Repository,
  options: {
    window_hours?: number;
    bucket_hours?: number;
    recent_limit?: number;
  } = {},
): Promise<SystemWorkerServiceTrendReport> => {
  const generatedAt = new Date();
  const windowHours = Math.max(1, options.window_hours ?? 24);
  const bucketHours = Math.max(1, Math.min(windowHours, options.bucket_hours ?? 4));
  const bucketMs = bucketHours * 60 * 60 * 1000;
  const windowStartedAt = new Date(generatedAt.getTime() - windowHours * 60 * 60 * 1000);
  const bucketCount = Math.max(1, Math.ceil(windowHours / bucketHours));
  const recentLimit = Math.max(1, Math.min(100, options.recent_limit ?? 12));

  const [events, serviceReport, bucketSummaries] = await Promise.all([
    repository.listOperationWorkerServiceEvents({
      limit: recentLimit,
      occurred_after: windowStartedAt.toISOString(),
      occurred_before: generatedAt.toISOString(),
    }),
    buildSystemWorkerServiceReport(repository, {
      limit: 20,
      as_of: generatedAt.toISOString(),
    }),
    repository.getOperationWorkerServiceEventSummary({
      window_started_at: windowStartedAt.toISOString(),
      as_of: generatedAt.toISOString(),
      bucket_hours: bucketHours,
    }),
  ]);

  const bucketSummaryByStart = new Map(
    bucketSummaries.map((bucket) => [bucket.bucket_started_at, bucket] as const),
  );
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const initialized = initializeBucket(
      new Date(windowStartedAt.getTime() + index * bucketMs),
      bucketMs,
    );
    return bucketSummaryByStart.get(initialized.bucket_started_at) ?? initialized;
  });

  const counts = buckets.reduce(
    (totals, bucket) => ({
      started: totals.started + bucket.started,
      ownership_conflicts: totals.ownership_conflicts + bucket.ownership_conflicts,
      loop_exits: totals.loop_exits + bucket.loop_exits,
      scheduled_restarts: totals.scheduled_restarts + bucket.scheduled_restarts,
      stopped: totals.stopped + bucket.stopped,
      failed: totals.failed + bucket.failed,
    }),
    {
      started: 0,
      ownership_conflicts: 0,
      loop_exits: 0,
      scheduled_restarts: 0,
      stopped: 0,
      failed: 0,
    },
  );
  const hottestRestartBucket = buckets.reduce<SystemWorkerServiceTrendBucket | null>(
    (current, bucket) =>
      current === null || bucket.scheduled_restarts > current.scheduled_restarts
        ? bucket
        : current,
    null,
  );
  const hottestFailureBucket = buckets.reduce<SystemWorkerServiceTrendBucket | null>(
    (current, bucket) =>
      current === null || bucket.failed > current.failed
        ? bucket
        : current,
    null,
  );

  const alerts: SystemWorkerServiceTrendAlert[] = [];

  if (counts.failed > 0) {
    alerts.push(
      buildAlert(
        counts.failed >= 2 ? "high" : "medium",
        "service_failures",
        "Worker services are failing",
        `${counts.failed} worker service failure event(s) were recorded in the last ${windowHours} hour(s).`,
        "Inspect the supervisor boundary and worker loop crash causes before deployment ownership becomes unreliable.",
      ),
    );
  }

  if (counts.scheduled_restarts >= 3) {
    alerts.push(
      buildAlert(
        counts.scheduled_restarts >= 6 ? "high" : "medium",
        "restart_churn",
        "Worker service restart churn is elevated",
        `${counts.scheduled_restarts} scheduled worker-service restart(s) were recorded in the last ${windowHours} hour(s).`,
        "Review restart loops, deployment restarts, and worker crash causes before queue supervision becomes intermittent.",
      ),
    );
  }

  if (
    hottestRestartBucket !== null &&
    hottestRestartBucket.scheduled_restarts >= 3
  ) {
    alerts.push(
      buildAlert(
        hottestRestartBucket.scheduled_restarts >= 5 ? "high" : "medium",
        "restart_storm",
        "Worker service restart storm detected",
        `${hottestRestartBucket.scheduled_restarts} scheduled worker-service restart(s) landed in the bucket starting ${hottestRestartBucket.bucket_started_at}.`,
        "Inspect the supervisor boundary for crash loops or rollout churn before the worker service starts flapping faster than operators can safely recover it.",
      ),
    );
  }

  if (counts.ownership_conflicts > 0) {
    alerts.push(
      buildAlert(
        counts.ownership_conflicts >= 2 ? "high" : "medium",
        "ownership_conflicts",
        "Worker service ownership conflicts were detected",
        `${counts.ownership_conflicts} worker-service ownership conflict event(s) were recorded in the last ${windowHours} hour(s).`,
        "Review duplicate supervisor launches, service_id reuse, and deployment ownership so only one fresh supervisor controls each worker service boundary.",
      ),
    );
  }

  if (
    serviceReport.counts.backing_off + serviceReport.counts.stale > 0 &&
    (counts.scheduled_restarts >= 3 ||
      serviceReport.counts.failed > 0 ||
      (hottestFailureBucket !== null && hottestFailureBucket.failed > 0))
  ) {
    alerts.push(
      buildAlert(
        serviceReport.counts.failed > 0 ||
          serviceReport.counts.backing_off >= 2 ||
          serviceReport.counts.stale >= 2
          ? "high"
          : "medium",
        "boundary_instability",
        "Worker service supervision is unstable",
        `${serviceReport.counts.backing_off} worker service(s) are currently backing off and ${serviceReport.counts.stale} are stale while the recent trend window recorded ${counts.scheduled_restarts} scheduled restart(s) and ${counts.failed} failure event(s).`,
        "Treat the worker-service boundary as unstable until restart churn, crash exits, and supervisor ownership issues are brought back under control.",
      ),
    );
  }

  if (
    serviceReport.counts.active === 0 &&
    serviceReport.counts.failed === 0 &&
    serviceReport.counts.stale === 0 &&
    serviceReport.counts.backing_off > 0
  ) {
    const nextRestartDueAt = serviceReport.services
      .map((service) => service.restart_due_at)
      .filter((dueAt): dueAt is string => dueAt !== null)
      .sort((left, right) => left.localeCompare(right))[0] ?? null;
    const maxRemainingBackoffMs = serviceReport.services.reduce<number | null>(
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
      `${serviceReport.counts.backing_off} worker service(s) are currently backing off with no active supervisor boundary available.`,
    ];

    if (nextRestartDueAt !== null) {
      detailParts.push(`The next restart is due at ${nextRestartDueAt}.`);
    }

    if (maxRemainingBackoffMs !== null) {
      detailParts.push(
        `The longest remaining restart backoff is ${maxRemainingBackoffMs} ms.`,
      );
    }

    alerts.push(
      buildAlert(
        "high",
        "backoff_unavailable",
        "All worker services are backing off",
        detailParts.join(" "),
        "Treat queued execution as temporarily unavailable until a supervisor clears restart backoff or the crashing worker loop is fixed.",
      ),
    );
  }

  if (serviceReport.counts.failed > 0) {
    alerts.push(
      buildAlert(
        "high",
        "failed_boundary",
        "The worker service boundary is failed right now",
        `${serviceReport.counts.failed} worker service(s) are currently marked failed.`,
        "Recover or redeploy the failed worker service before depending on scheduled or queued execution.",
      ),
    );
  } else if (serviceReport.counts.stale > 0) {
    alerts.push(
      buildAlert(
        serviceReport.counts.stale >= 2 ? "high" : "medium",
        "stale_boundary",
        "The worker service boundary is stale right now",
        `${serviceReport.counts.stale} worker service(s) currently have stale heartbeats.`,
        "Inspect the service supervisor and deployment lifecycle so runtime ownership becomes trustworthy again.",
      ),
    );
  }

  return systemWorkerServiceTrendReportSchema.parse({
    generated_at: generatedAt.toISOString(),
    window_hours: windowHours,
    bucket_hours: bucketHours,
    counts,
    buckets,
    recent_events: events.slice(0, recentLimit),
    alerts,
  });
};
