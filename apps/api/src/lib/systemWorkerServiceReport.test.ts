import { describe, expect, it } from "vitest";

import { InMemoryRepository } from "./InMemoryRepository.js";
import { buildSystemWorkerServiceReport } from "./systemWorkerServiceReport.js";

describe("system worker service report", () => {
  it("classifies active, backing-off, stale, and failed supervisor services", async () => {
    const repository = new InMemoryRepository();
    const now = new Date();
    const nowIso = now.toISOString();
    const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();

    await repository.upsertOperationWorkerService({
      service_id: "service-active",
      worker_id: "worker-a",
      lifecycle_state: "running",
      supported_operations: ["scheduled_evolution"],
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 5_000,
      max_restarts: 10,
      heartbeat_at: nowIso,
      started_at: nowIso,
    });

    await repository.upsertOperationWorkerService({
      service_id: "service-backoff",
      worker_id: "worker-b",
      lifecycle_state: "backing_off",
      supported_operations: ["feed_pull"],
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 5_000,
      max_restarts: 10,
      restart_count: 2,
      restart_streak: 2,
      current_restart_backoff_ms: 20_000,
      heartbeat_at: nowIso,
      started_at: nowIso,
      last_error_message: "recent worker crash",
    });

    await repository.upsertOperationWorkerService({
      service_id: "service-stale",
      worker_id: "worker-c",
      lifecycle_state: "running",
      supported_operations: ["transcript_pull"],
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 5_000,
      max_restarts: 10,
      heartbeat_at: oneMinuteAgo,
      started_at: oneMinuteAgo,
    });

    await repository.upsertOperationWorkerService({
      service_id: "service-failed",
      worker_id: "worker-d",
      lifecycle_state: "failed",
      supported_operations: ["benchmark_trust_refresh"],
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 5_000,
      max_restarts: 10,
      heartbeat_at: nowIso,
      started_at: nowIso,
      stopped_at: nowIso,
      last_error_message: "restart limit exceeded",
    });

    const report = await buildSystemWorkerServiceReport(repository, {
      as_of: nowIso,
      limit: 10,
    });

    expect(report.counts.total).toBe(4);
    expect(report.counts.active).toBe(1);
    expect(report.counts.backing_off).toBe(1);
    expect(report.counts.stale).toBe(1);
    expect(report.counts.failed).toBe(1);
    expect(report.services.find((service) => service.service_id === "service-stale")?.status).toBe(
      "stale",
    );
    expect(
      report.services.find((service) => service.service_id === "service-backoff")?.status,
    ).toBe("backing_off");
    const backingOffService = report.services.find(
      (service) => service.service_id === "service-backoff",
    );
    expect(backingOffService?.current_restart_backoff_ms).toBe(20_000);
    expect(backingOffService?.remaining_restart_backoff_ms).toBe(20_000);
    expect(backingOffService?.restart_due_at).toBe(
      new Date(now.getTime() + 20_000).toISOString(),
    );
    expect(
      report.services.find((service) => service.service_id === "service-active")
        ?.remaining_restart_backoff_ms,
    ).toBeNull();
    expect(
      report.services.find((service) => service.service_id === "service-active")?.restart_due_at,
    ).toBeNull();
  });
});
