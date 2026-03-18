import { describe, expect, it } from "vitest";

import type { SystemWorkerServiceReport } from "@finance-superbrain/schemas";

import { evaluateWorkerServiceSupervisorStatus } from "./operationWorkerServiceSupervisorStatus.js";

const buildReport = (
  services: SystemWorkerServiceReport["services"],
): SystemWorkerServiceReport => ({
  generated_at: "2026-03-16T00:00:00.000Z",
  counts: {
    total: services.length,
    active: services.filter((service) => service.status === "active").length,
    backing_off: services.filter((service) => service.status === "backing_off").length,
    stale: services.filter((service) => service.status === "stale").length,
    stopped: services.filter((service) => service.status === "stopped").length,
    failed: services.filter((service) => service.status === "failed").length,
  },
  services,
});

describe("operation worker service supervisor status", () => {
  it("treats active services as live and ready", () => {
    const report = buildReport([
      {
        service_id: "worker-service-alpha",
        worker_id: "worker-alpha",
        lifecycle_state: "running",
        supported_operations: ["scheduled_evolution"],
        supervisor_pid: 123,
        supervisor_host: "host-a",
        supervisor_instance_id: "instance-a",
        invocation_mode: "current_runtime",
        supervisor_backoff_ms: 5_000,
        success_window_ms: 60_000,
        heartbeat_interval_ms: 5_000,
        max_restarts: 5,
        restart_count: 0,
        restart_streak: 0,
        current_restart_backoff_ms: null,
        started_at: "2026-03-16T00:00:00.000Z",
        updated_at: "2026-03-16T00:00:05.000Z",
        last_heartbeat_at: "2026-03-16T00:00:05.000Z",
        last_loop_started_at: null,
        last_loop_finished_at: null,
        last_loop_runtime_ms: null,
        last_exit_code: null,
        last_exit_signal: null,
        last_error_message: null,
        stopped_at: null,
        status: "active",
        stale_after_ms: 30_000,
        heartbeat_age_ms: 0,
        restart_due_at: null,
        remaining_restart_backoff_ms: null,
      },
    ]);

    expect(
      evaluateWorkerServiceSupervisorStatus(report, {
        mode: "liveness",
      }).ok,
    ).toBe(true);
    expect(
      evaluateWorkerServiceSupervisorStatus(report, {
        mode: "readiness",
      }).ok,
    ).toBe(true);
  });

  it("treats backing off services as live but not ready", () => {
    const report = buildReport([
      {
        service_id: "worker-service-alpha",
        worker_id: "worker-alpha",
        lifecycle_state: "backing_off",
        supported_operations: ["scheduled_evolution"],
        supervisor_pid: 123,
        supervisor_host: "host-a",
        supervisor_instance_id: "instance-a",
        invocation_mode: "current_runtime",
        supervisor_backoff_ms: 5_000,
        success_window_ms: 60_000,
        heartbeat_interval_ms: 5_000,
        max_restarts: 5,
        restart_count: 2,
        restart_streak: 2,
        current_restart_backoff_ms: 20_000,
        started_at: "2026-03-16T00:00:00.000Z",
        updated_at: "2026-03-16T00:00:05.000Z",
        last_heartbeat_at: "2026-03-16T00:00:05.000Z",
        last_loop_started_at: null,
        last_loop_finished_at: "2026-03-16T00:00:05.000Z",
        last_loop_runtime_ms: 500,
        last_exit_code: 1,
        last_exit_signal: null,
        last_error_message: "worker loop exited with code 1",
        stopped_at: null,
        status: "backing_off",
        stale_after_ms: 30_000,
        heartbeat_age_ms: 0,
        restart_due_at: "2026-03-16T00:00:25.000Z",
        remaining_restart_backoff_ms: 20_000,
      },
    ]);

    const liveness = evaluateWorkerServiceSupervisorStatus(report, {
      mode: "liveness",
    });
    const readiness = evaluateWorkerServiceSupervisorStatus(report, {
      mode: "readiness",
    });

    expect(liveness.ok).toBe(true);
    expect(liveness.reason).toBe("backing_off");
    expect(readiness.ok).toBe(false);
    expect(readiness.reason).toBe("backing_off");
  });

  it("fails when the target service is ambiguous without stable identity", () => {
    const report = buildReport([
      {
        service_id: "worker-service-alpha",
        worker_id: "worker-alpha",
        lifecycle_state: "running",
        supported_operations: ["scheduled_evolution"],
        supervisor_pid: 123,
        supervisor_host: "host-a",
        supervisor_instance_id: "instance-a",
        invocation_mode: "current_runtime",
        supervisor_backoff_ms: 5_000,
        success_window_ms: 60_000,
        heartbeat_interval_ms: 5_000,
        max_restarts: 5,
        restart_count: 0,
        restart_streak: 0,
        current_restart_backoff_ms: null,
        started_at: "2026-03-16T00:00:00.000Z",
        updated_at: "2026-03-16T00:00:05.000Z",
        last_heartbeat_at: "2026-03-16T00:00:05.000Z",
        last_loop_started_at: null,
        last_loop_finished_at: null,
        last_loop_runtime_ms: null,
        last_exit_code: null,
        last_exit_signal: null,
        last_error_message: null,
        stopped_at: null,
        status: "active",
        stale_after_ms: 30_000,
        heartbeat_age_ms: 0,
        restart_due_at: null,
        remaining_restart_backoff_ms: null,
      },
      {
        service_id: "worker-service-beta",
        worker_id: "worker-beta",
        lifecycle_state: "running",
        supported_operations: ["feed_pull"],
        supervisor_pid: 456,
        supervisor_host: "host-b",
        supervisor_instance_id: "instance-b",
        invocation_mode: "current_runtime",
        supervisor_backoff_ms: 5_000,
        success_window_ms: 60_000,
        heartbeat_interval_ms: 5_000,
        max_restarts: 5,
        restart_count: 0,
        restart_streak: 0,
        current_restart_backoff_ms: null,
        started_at: "2026-03-16T00:00:00.000Z",
        updated_at: "2026-03-16T00:00:05.000Z",
        last_heartbeat_at: "2026-03-16T00:00:05.000Z",
        last_loop_started_at: null,
        last_loop_finished_at: null,
        last_loop_runtime_ms: null,
        last_exit_code: null,
        last_exit_signal: null,
        last_error_message: null,
        stopped_at: null,
        status: "active",
        stale_after_ms: 30_000,
        heartbeat_age_ms: 0,
        restart_due_at: null,
        remaining_restart_backoff_ms: null,
      },
    ]);

    const result = evaluateWorkerServiceSupervisorStatus(report, {
      mode: "liveness",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ambiguous");
  });
});
