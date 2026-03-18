import { operationQueueAlertReportSchema } from "@finance-superbrain/schemas";
import type { OperationQueueAlert, OperationQueueAlertReport } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";
import { buildOperationQueueReport } from "./operationQueueReport.js";
import { buildSystemWorkerServiceReport } from "./systemWorkerServiceReport.js";
import { buildSystemWorkerReport } from "./systemWorkerReport.js";

const buildAlert = (
  severity: OperationQueueAlert["severity"],
  signal: string,
  title: string,
  detail: string,
  recommendation: string,
): OperationQueueAlert => ({
  severity,
  signal,
  title,
  detail,
  recommendation,
});

export const buildOperationQueueAlertReport = async (
  repository: Repository,
  options: {
    limit?: number;
    queue_report?: Awaited<ReturnType<typeof buildOperationQueueReport>>;
    worker_report?: Awaited<ReturnType<typeof buildSystemWorkerReport>>;
    worker_service_report?: Awaited<ReturnType<typeof buildSystemWorkerServiceReport>>;
  } = {},
): Promise<OperationQueueAlertReport> => {
  const [report, workerReport, workerServiceReport] = await Promise.all([
    options.queue_report ??
      buildOperationQueueReport(repository, {
        limit: options.limit ?? 20,
      }),
    options.worker_report ??
      buildSystemWorkerReport(repository, {
        limit: options.limit ?? 20,
      }),
    options.worker_service_report ??
      buildSystemWorkerServiceReport(repository, {
        limit: options.limit ?? 20,
      }),
  ]);
  const alerts: OperationQueueAlert[] = [];

  if (report.counts.stale_running > 0) {
    alerts.push(
      buildAlert(
        "high",
        "stale_running",
        "Stale running jobs detected",
        `${report.counts.stale_running} running job(s) have already exceeded their lease window and may need worker recovery.`,
        "Inspect worker health and confirm the queue loop is still renewing leases for long-running jobs.",
      ),
    );
  }

  if (report.oldest_pending_age_ms !== null) {
    if (report.oldest_pending_age_ms >= 15 * 60 * 1000) {
      alerts.push(
        buildAlert(
          "high",
          "backlog_age",
          "Pending queue backlog is aging",
          `The oldest pending job has been waiting for ${Math.round(report.oldest_pending_age_ms / 60000)} minute(s).`,
          "Add worker capacity or reduce inline execution so queued work is drained more consistently.",
        ),
      );
    } else if (report.oldest_pending_age_ms >= 5 * 60 * 1000) {
      alerts.push(
        buildAlert(
          "medium",
          "backlog_age",
          "Pending jobs are waiting longer than expected",
          `The oldest pending job has been waiting for ${Math.round(report.oldest_pending_age_ms / 1000)} second(s).`,
          "Check whether the worker loop is running and whether high-cost jobs should be split or throttled.",
        ),
      );
    }
  }

  if (report.counts.pending >= 25) {
    alerts.push(
      buildAlert(
        report.counts.pending >= 100 ? "high" : "medium",
        "backlog_depth",
        "Queue depth is elevated",
        `${report.counts.pending} pending job(s) are currently waiting in the operation queue.`,
        "Increase worker throughput or shift more expensive jobs away from peak ingest windows.",
      ),
    );
  }

  if (report.counts.retry_scheduled > 0) {
    alerts.push(
      buildAlert(
        report.counts.retry_scheduled >= 5 ? "high" : report.counts.retry_scheduled >= 2 ? "medium" : "low",
        "retries",
        "Queued jobs are retrying",
        `${report.counts.retry_scheduled} pending job(s) are already on a retry path.`,
        "Inspect recent failures to confirm the errors are transient and not caused by a persistent integration issue.",
      ),
    );
  }

  if (report.counts.failed > 0) {
    alerts.push(
      buildAlert(
        report.counts.failed >= 5 ? "medium" : "low",
        "failed_jobs",
        "Failed jobs remain in queue history",
        `${report.counts.failed} job(s) have ended in a failed state and may need operator review.`,
        "Review recent failed job payloads and result summaries before the same workload is retried manually.",
      ),
    );
  }

  if (workerReport.counts.stale > 0) {
    alerts.push(
      buildAlert(
        workerReport.counts.stale >= 2 ? "high" : "medium",
        "stale_workers",
        "Worker heartbeats have gone stale",
        `${workerReport.counts.stale} worker(s) have stopped heartbeating within their expected runtime window.`,
        "Restart or inspect the worker service before queued jobs begin backing up behind stale leases.",
      ),
    );
  }

  if (report.counts.pending > 0 && workerReport.counts.active === 0) {
    alerts.push(
      buildAlert(
        "high",
        "worker_unavailable",
        "Queued work has no active worker",
        workerReport.counts.total === 0
          ? `${report.counts.pending} pending job(s) are waiting, but no operation worker has registered itself yet.`
          : `${report.counts.pending} pending job(s) are waiting while all registered workers are stale or stopped.`,
        "Start or recover an operation worker so queued jobs can be claimed and drained again.",
      ),
    );
  }

  if (
    workerServiceReport.counts.total > 0 &&
    report.counts.pending > 0 &&
    workerServiceReport.counts.active + workerServiceReport.counts.backing_off === 0
  ) {
    alerts.push(
      buildAlert(
        workerServiceReport.counts.failed > 0 || workerServiceReport.counts.stale > 0
          ? "high"
          : "medium",
        "worker_service_unavailable",
        "The worker service boundary is not healthy enough to own the queue",
        workerServiceReport.counts.failed > 0
          ? `${workerServiceReport.counts.failed} worker service(s) are marked failed while ${report.counts.pending} pending job(s) remain queued.`
          : workerServiceReport.counts.stale > 0
            ? `${workerServiceReport.counts.stale} worker service(s) have stale heartbeats while ${report.counts.pending} pending job(s) remain queued.`
            : `${report.counts.pending} pending job(s) are queued while all worker services are stopped.`,
        "Recover the supervised worker service or deploy a healthy replacement before queue backlog turns into prolonged stale recovery.",
      ),
    );
  }

  return operationQueueAlertReportSchema.parse({
    generated_at: report.generated_at,
    counts: {
      low: alerts.filter((alert) => alert.severity === "low").length,
      medium: alerts.filter((alert) => alert.severity === "medium").length,
      high: alerts.filter((alert) => alert.severity === "high").length,
    },
    alerts,
  });
};
