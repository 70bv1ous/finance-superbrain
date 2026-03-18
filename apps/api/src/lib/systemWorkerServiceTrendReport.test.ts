import { describe, expect, it } from "vitest";

import { InMemoryRepository } from "./InMemoryRepository.js";
import { buildSystemWorkerServiceTrendReport } from "./systemWorkerServiceTrendReport.js";

describe("systemWorkerServiceTrendReport", () => {
  it("summarizes worker service restart churn and failure events", async () => {
    const repository = new InMemoryRepository();
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
    const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();

    await repository.saveOperationWorkerServiceEvent({
      service_id: "worker-service-primary",
      worker_id: "worker-primary",
      event_type: "started",
      occurred_at: tenMinutesAgo,
      lifecycle_state: "running",
      scheduled_restart: null,
      restart_count: 0,
      restart_streak: 0,
      loop_runtime_ms: null,
      exit_code: null,
      exit_signal: null,
      error_message: null,
      metadata: {},
    });

    await repository.saveOperationWorkerServiceEvent({
      service_id: "worker-service-primary",
      worker_id: "worker-secondary",
      event_type: "ownership_conflict",
      occurred_at: fiveMinutesAgo,
      lifecycle_state: "starting",
      scheduled_restart: null,
      restart_count: 0,
      restart_streak: 0,
      loop_runtime_ms: null,
      exit_code: null,
      exit_signal: null,
      error_message: "worker service worker-service-primary is already owned by host-alpha pid 123",
      metadata: {
        attempted_supervisor_host: "host-beta",
        conflicting_supervisor_host: "host-alpha",
      },
    });

    await repository.saveOperationWorkerServiceEvent({
      service_id: "worker-service-primary",
      worker_id: "worker-primary",
      event_type: "loop_exit",
      occurred_at: fiveMinutesAgo,
      lifecycle_state: "backing_off",
      scheduled_restart: true,
      restart_count: 1,
      restart_streak: 1,
      loop_runtime_ms: 500,
      exit_code: 1,
      exit_signal: null,
      error_message: "worker loop exited with code 1",
      metadata: {},
    });

    await repository.saveOperationWorkerServiceEvent({
      service_id: "worker-service-primary",
      worker_id: "worker-primary",
      event_type: "failed",
      occurred_at: oneMinuteAgo,
      lifecycle_state: "failed",
      scheduled_restart: false,
      restart_count: 1,
      restart_streak: 1,
      loop_runtime_ms: null,
      exit_code: null,
      exit_signal: null,
      error_message: "worker restart limit exceeded",
      metadata: {},
    });

    await repository.upsertOperationWorkerService({
      service_id: "worker-service-primary",
      worker_id: "worker-primary",
      lifecycle_state: "failed",
      supported_operations: ["scheduled_evolution"],
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 5_000,
      max_restarts: 4,
      restart_count: 1,
      restart_streak: 1,
      heartbeat_at: oneMinuteAgo,
      started_at: tenMinutesAgo,
      last_error_message: "worker restart limit exceeded",
      stopped_at: oneMinuteAgo,
    });

    const report = await buildSystemWorkerServiceTrendReport(repository, {
      window_hours: 24,
      bucket_hours: 24,
      recent_limit: 10,
    });

    expect(report.counts.started).toBe(1);
    expect(report.counts.ownership_conflicts).toBe(1);
    expect(report.counts.loop_exits).toBe(1);
    expect(report.counts.scheduled_restarts).toBe(1);
    expect(report.counts.failed).toBe(1);
    expect(report.alerts.some((alert) => alert.signal === "ownership_conflicts")).toBe(true);
    expect(report.alerts.some((alert) => alert.signal === "service_failures")).toBe(true);
    expect(report.alerts.some((alert) => alert.signal === "failed_boundary")).toBe(true);
  });

  it("escalates restart storms when the supervisor boundary is backing off repeatedly", async () => {
    const repository = new InMemoryRepository();
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60_000).toISOString();
    const ninetySecondsAgo = new Date(now.getTime() - 90_000).toISOString();
    const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();

    for (const occurredAt of [twoMinutesAgo, ninetySecondsAgo, oneMinuteAgo]) {
      await repository.saveOperationWorkerServiceEvent({
        service_id: "worker-service-storm",
        worker_id: "worker-storm",
        event_type: "loop_exit",
        occurred_at: occurredAt,
        lifecycle_state: "backing_off",
        scheduled_restart: true,
        restart_count: 3,
        restart_streak: 3,
        loop_runtime_ms: 750,
        exit_code: 1,
        exit_signal: null,
        error_message: "worker loop exited with code 1",
        metadata: {},
      });
    }

    await repository.upsertOperationWorkerService({
      service_id: "worker-service-storm",
      worker_id: "worker-storm",
      lifecycle_state: "backing_off",
      supported_operations: ["scheduled_evolution"],
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 5_000,
      max_restarts: 4,
      restart_count: 3,
      restart_streak: 3,
      heartbeat_at: oneMinuteAgo,
      started_at: twoMinutesAgo,
      last_error_message: "recent worker crash",
    });

    const report = await buildSystemWorkerServiceTrendReport(repository, {
      window_hours: 24,
      bucket_hours: 24,
      recent_limit: 10,
    });

    expect(report.counts.scheduled_restarts).toBe(3);
    expect(report.alerts.some((alert) => alert.signal === "restart_storm")).toBe(true);
    expect(report.alerts.some((alert) => alert.signal === "boundary_instability")).toBe(true);
  });

  it("flags worker execution as unavailable when every service is only backing off", async () => {
    const repository = new InMemoryRepository();
    const now = new Date();
    const tenSecondsAgo = new Date(now.getTime() - 10_000).toISOString();

    await repository.upsertOperationWorkerService({
      service_id: "worker-service-backoff-only",
      worker_id: "worker-backoff-only",
      lifecycle_state: "backing_off",
      supported_operations: ["scheduled_evolution"],
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 5_000,
      max_restarts: 4,
      restart_count: 2,
      restart_streak: 2,
      current_restart_backoff_ms: 45_000,
      heartbeat_at: now.toISOString(),
      started_at: tenSecondsAgo,
      last_loop_finished_at: now.toISOString(),
      last_error_message: "worker loop exited with code 1",
    });

    const report = await buildSystemWorkerServiceTrendReport(repository, {
      window_hours: 24,
      bucket_hours: 24,
      recent_limit: 10,
    });

    const alert = report.alerts.find((candidate) => candidate.signal === "backoff_unavailable");

    expect(alert).toBeDefined();
    expect(alert?.severity).toBe("high");
    expect(alert?.detail).toContain("no active supervisor boundary available");
    expect(alert?.detail).toContain("The next restart is due at");
  });
});
