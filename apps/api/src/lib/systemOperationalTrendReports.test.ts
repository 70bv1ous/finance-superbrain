import { describe, expect, it } from "vitest";

import { InMemoryRepository } from "./InMemoryRepository.js";
import { buildSystemIntegrationTrendReport } from "./systemIntegrationTrendReport.js";
import { buildSystemWorkerTrendReport } from "./systemWorkerTrendReport.js";

describe("system operational trend reports", () => {
  it("counts worker events across high-volume windows without relying on capped recent scans", async () => {
    const repository = new InMemoryRepository();
    const base = new Date(Date.now() - 12 * 60 * 60 * 1000);

    await repository.saveOperationWorkerEvent({
      worker_id: "worker-high-volume",
      event_type: "started",
      occurred_at: base.toISOString(),
      lifecycle_state: "running",
      cycle_processed: null,
      cycle_completed: null,
      cycle_failed: null,
      cycle_retried: null,
      cycle_abandoned: null,
      error_message: null,
      metadata: {},
    });

    for (let index = 0; index < 650; index += 1) {
      const occurredAt = new Date(base.getTime() + (index + 1) * 60_000).toISOString();
      await repository.saveOperationWorkerEvent({
        worker_id: "worker-high-volume",
        event_type: "cycle",
        occurred_at: occurredAt,
        lifecycle_state: "running",
        cycle_processed: 1,
        cycle_completed: 1,
        cycle_failed: 0,
        cycle_retried: 0,
        cycle_abandoned: 0,
        error_message: null,
        metadata: {},
      });
    }

    const report = await buildSystemWorkerTrendReport(repository, {
      window_hours: 24,
      bucket_hours: 24,
      recent_limit: 12,
    });

    expect(report.counts.started).toBe(1);
    expect(report.counts.cycles).toBe(650);
    expect(report.counts.processed).toBe(650);
    expect(report.counts.completed).toBe(650);
  });

  it("counts integration retry and failure trends across high-volume windows without truncation", async () => {
    const repository = new InMemoryRepository();
    const base = new Date(Date.now() - 6 * 60 * 60 * 1000);

    for (let index = 0; index < 520; index += 1) {
      const availableAt = new Date(base.getTime() + index * 1_000).toISOString();
      const leaseUntil = new Date(base.getTime() + index * 1_000 + 60_000).toISOString();
      const retryAt = new Date(base.getTime() + 48 * 60 * 60 * 1000 + index * 1_000).toISOString();
      const job = await repository.enqueueOperationJob({
        operation_name: "feed_pull",
        triggered_by: "script",
        payload: {},
        max_attempts: 3,
        available_at: availableAt,
      });

      await repository.claimNextOperationJob({
        worker_id: "worker-feed-high-volume",
        as_of: availableAt,
        lease_expires_at: leaseUntil,
        supported_operations: ["feed_pull"],
      });

      await repository.failOperationJob({
        id: job.id,
        worker_id: "worker-feed-high-volume",
        finished_at: availableAt,
        error_message: "feed provider returned 503",
        retry_at: retryAt,
        result_summary: {
          integration: "feed",
          retryable: true,
          status_code: 503,
          retry_delay_seconds: 120,
        },
      });
    }

    for (let index = 0; index < 180; index += 1) {
      const availableAt = new Date(base.getTime() + 600_000 + index * 1_000).toISOString();
      const leaseUntil = new Date(base.getTime() + 600_000 + index * 1_000 + 60_000).toISOString();
      const job = await repository.enqueueOperationJob({
        operation_name: "transcript_pull",
        triggered_by: "script",
        payload: {},
        max_attempts: 1,
        available_at: availableAt,
      });

      await repository.claimNextOperationJob({
        worker_id: "worker-transcript-high-volume",
        as_of: availableAt,
        lease_expires_at: leaseUntil,
        supported_operations: ["transcript_pull"],
      });

      await repository.failOperationJob({
        id: job.id,
        worker_id: "worker-transcript-high-volume",
        finished_at: availableAt,
        error_message: "transcript page returned 404",
        result_summary: {
          integration: "transcript",
          retryable: false,
          status_code: 404,
        },
      });
    }

    const report = await buildSystemIntegrationTrendReport(repository, {
      window_hours: 24,
      bucket_hours: 24,
      recent_limit: 12,
    });

    const feed = report.slices.find((slice) => slice.integration === "feed");
    const transcript = report.slices.find((slice) => slice.integration === "transcript");

    expect(feed?.counts.retry_scheduled).toBe(520);
    expect(feed?.counts.failed).toBe(0);
    expect(transcript?.counts.non_retryable_failures).toBe(180);
    expect(
      report.alerts.some(
        (alert) => alert.integration === "feed" && alert.signal === "retry_storm",
      ),
    ).toBe(true);
    expect(
      report.alerts.some(
        (alert) => alert.integration === "transcript" && alert.signal === "non_retryable_failures",
      ),
    ).toBe(true);
  });
});
