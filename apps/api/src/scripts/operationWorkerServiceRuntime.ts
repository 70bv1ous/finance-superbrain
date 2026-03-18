import { randomUUID } from "node:crypto";

import type {
  OperationWorkerServiceRecord,
  OperationWorkerServiceEventRecord,
  SystemOperationName,
} from "@finance-superbrain/schemas";

import { resolveHeartbeatIntervalMs, startAsyncHeartbeat } from "../lib/asyncHeartbeat.js";
import {
  resolveOperationWorkerServiceHost,
  resolveOperationWorkerServiceId,
} from "../lib/operationWorkerServiceIdentity.js";
import {
  resolveOperationWorkerServiceRemainingBackoffMs,
  resolveOperationWorkerServiceRestartDueAt,
  resolveOperationWorkerServiceStaleAfterMs,
} from "../lib/operationWorkerServiceHealth.js";
import { resolveOperationWorkerServiceRestartStreak } from "../lib/operationWorkerServiceRestartPolicy.js";
import type { Repository } from "../lib/repository.types.js";

const minimumServiceHeartbeatIntervalMs = 1_000;

type WorkerServiceReporterOptions = {
  service_id: string;
  worker_id: string;
  supported_operations?: SystemOperationName[];
  supervisor_pid?: number | null;
  supervisor_host?: string | null;
  supervisor_instance_id?: string | null;
  invocation_mode?: string | null;
  supervisor_backoff_ms: number;
  success_window_ms: number;
  heartbeat_interval_ms?: number;
  max_restarts: number;
};

type WorkerServiceState = {
  service_id: string;
  worker_id: string;
  lifecycle_state: "starting" | "running" | "backing_off" | "stopping" | "stopped" | "failed";
  supported_operations?: SystemOperationName[];
  supervisor_pid: number | null;
  supervisor_host: string | null;
  supervisor_instance_id: string | null;
  invocation_mode: string | null;
  supervisor_backoff_ms: number;
  success_window_ms: number;
  heartbeat_interval_ms: number;
  max_restarts: number;
  restart_count: number;
  restart_streak: number;
  current_restart_backoff_ms: number | null;
  started_at: string;
  heartbeat_at: string;
  last_loop_started_at?: string | null;
  last_loop_finished_at?: string | null;
  last_loop_runtime_ms?: number | null;
  last_exit_code?: number | null;
  last_exit_signal?: string | null;
  last_error_message?: string | null;
  stopped_at?: string | null;
};

const resolveServiceHeartbeatIntervalMs = (
  supervisorBackoffMs: number,
  successWindowMs: number,
  requestedIntervalMs?: number,
) => {
  if (requestedIntervalMs !== undefined) {
    return Math.max(minimumServiceHeartbeatIntervalMs, Math.floor(requestedIntervalMs));
  }

  const basisMs = Math.max(supervisorBackoffMs, successWindowMs, 15_000);

  return Math.max(
    minimumServiceHeartbeatIntervalMs,
    resolveHeartbeatIntervalMs(basisMs, Math.floor(basisMs / 2)),
  );
};

const isFreshActiveService = (
  service: OperationWorkerServiceRecord,
  asOf = new Date(),
) => {
  if (service.lifecycle_state === "stopped" || service.lifecycle_state === "failed") {
    return false;
  }

  const staleAfterMs = resolveOperationWorkerServiceStaleAfterMs(service);
  const heartbeatAgeMs = Math.max(
    0,
    asOf.getTime() - new Date(service.last_heartbeat_at).getTime(),
  );

  return heartbeatAgeMs <= staleAfterMs;
};

export class OperationWorkerServiceOwnershipError extends Error {
  readonly service_id: string;
  readonly conflicting_service: OperationWorkerServiceRecord;

  constructor(service: OperationWorkerServiceRecord) {
    super(
      `Worker service ${service.service_id} is already owned by an active supervisor (${service.supervisor_host ?? "unknown-host"} pid ${service.supervisor_pid ?? "unknown-pid"}).`,
    );
    this.name = "OperationWorkerServiceOwnershipError";
    this.service_id = service.service_id;
    this.conflicting_service = service;
  }
}

export class OperationWorkerServiceBackoffActiveError extends Error {
  readonly service_id: string;
  readonly backoff_until: string;
  readonly remaining_backoff_ms: number;
  readonly existing_service: OperationWorkerServiceRecord;

  constructor(service: OperationWorkerServiceRecord, backoffUntil: string, remainingBackoffMs: number) {
    super(
      `Worker service ${service.service_id} is still inside restart backoff until ${backoffUntil}.`,
    );
    this.name = "OperationWorkerServiceBackoffActiveError";
    this.service_id = service.service_id;
    this.backoff_until = backoffUntil;
    this.remaining_backoff_ms = remainingBackoffMs;
    this.existing_service = service;
  }
}

export const createOperationWorkerServiceReporter = (
  repository: Repository,
  options: WorkerServiceReporterOptions,
) => {
  const startedAt = new Date().toISOString();
  const heartbeatIntervalMs = resolveServiceHeartbeatIntervalMs(
    options.supervisor_backoff_ms,
    options.success_window_ms,
    options.heartbeat_interval_ms,
  );

  let state: WorkerServiceState = {
    service_id: options.service_id,
    worker_id: options.worker_id,
    lifecycle_state: "starting",
    supported_operations: options.supported_operations,
    supervisor_pid: options.supervisor_pid ?? process.pid,
    supervisor_host: options.supervisor_host ?? resolveOperationWorkerServiceHost(),
    supervisor_instance_id: options.supervisor_instance_id ?? randomUUID(),
    invocation_mode: options.invocation_mode ?? null,
    supervisor_backoff_ms: options.supervisor_backoff_ms,
    success_window_ms: options.success_window_ms,
    heartbeat_interval_ms: heartbeatIntervalMs,
    max_restarts: options.max_restarts,
    restart_count: 0,
    restart_streak: 0,
    current_restart_backoff_ms: null,
    started_at: startedAt,
    heartbeat_at: startedAt,
    last_loop_started_at: null,
    last_loop_finished_at: null,
    last_loop_runtime_ms: null,
    last_exit_code: null,
    last_exit_signal: null,
    last_error_message: null,
    stopped_at: null,
  };

  let heartbeatHandle: ReturnType<typeof startAsyncHeartbeat> | null = null;

  const persist = async (patch: Partial<WorkerServiceState> = {}) => {
    state = {
      ...state,
      ...patch,
      heartbeat_at: patch.heartbeat_at ?? state.heartbeat_at,
    };

    await repository.upsertOperationWorkerService({
      service_id: state.service_id,
      worker_id: state.worker_id,
      lifecycle_state: state.lifecycle_state,
      supported_operations: state.supported_operations,
      supervisor_pid: state.supervisor_pid,
      supervisor_host: state.supervisor_host,
      supervisor_instance_id: state.supervisor_instance_id,
      invocation_mode: state.invocation_mode,
      supervisor_backoff_ms: state.supervisor_backoff_ms,
      success_window_ms: state.success_window_ms,
      heartbeat_interval_ms: state.heartbeat_interval_ms,
      max_restarts: state.max_restarts,
      restart_count: state.restart_count,
      restart_streak: state.restart_streak,
      current_restart_backoff_ms: state.current_restart_backoff_ms,
      started_at: state.started_at,
      heartbeat_at: state.heartbeat_at,
      last_loop_started_at: state.last_loop_started_at,
      last_loop_finished_at: state.last_loop_finished_at,
      last_loop_runtime_ms: state.last_loop_runtime_ms,
      last_exit_code: state.last_exit_code,
      last_exit_signal: state.last_exit_signal,
      last_error_message: state.last_error_message,
      stopped_at: state.stopped_at,
    });
  };

  const saveEvent = async (input: {
    event_type: OperationWorkerServiceEventRecord["event_type"];
    occurred_at?: string;
    scheduled_restart?: boolean | null;
    loop_runtime_ms?: number | null;
    exit_code?: number | null;
    exit_signal?: string | null;
    error_message?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  }) => {
    await repository.saveOperationWorkerServiceEvent({
      service_id: state.service_id,
      worker_id: state.worker_id,
      event_type: input.event_type,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      lifecycle_state: state.lifecycle_state,
      scheduled_restart: input.scheduled_restart ?? null,
      restart_count: state.restart_count,
      restart_streak: state.restart_streak,
      loop_runtime_ms: input.loop_runtime_ms ?? null,
      exit_code: input.exit_code ?? null,
      exit_signal: input.exit_signal ?? null,
      error_message: input.error_message ?? null,
      metadata: input.metadata ?? {},
    });
  };

  return {
    service_id: options.service_id,
    heartbeat_interval_ms: heartbeatIntervalMs,
    start: async () => {
      const existing = await repository.getOperationWorkerService(state.service_id);
      const sameOwner =
        existing !== null &&
        ((existing.supervisor_instance_id !== null &&
          state.supervisor_instance_id !== null &&
          existing.supervisor_instance_id === state.supervisor_instance_id) ||
          (existing.supervisor_pid !== null &&
            existing.supervisor_host !== null &&
            existing.supervisor_pid === state.supervisor_pid &&
            existing.supervisor_host === state.supervisor_host));

      const remainingBackoffMs =
        existing !== null && existing.lifecycle_state === "backing_off"
          ? resolveOperationWorkerServiceRemainingBackoffMs(existing)
          : 0;
      const backoffUntil =
        existing !== null && existing.lifecycle_state === "backing_off"
          ? resolveOperationWorkerServiceRestartDueAt(existing)
          : null;

      if (
        existing !== null &&
        existing.lifecycle_state === "backing_off" &&
        existing.current_restart_backoff_ms !== null &&
        backoffUntil !== null &&
        remainingBackoffMs > 0 &&
        !sameOwner
      ) {
        throw new OperationWorkerServiceBackoffActiveError(
          existing,
          backoffUntil,
          remainingBackoffMs,
        );
      }

      if (existing && isFreshActiveService(existing) && !sameOwner) {
        await saveEvent({
          event_type: "ownership_conflict",
          error_message: `worker service ${state.service_id} is already owned by ${existing.supervisor_host ?? "unknown-host"} pid ${existing.supervisor_pid ?? "unknown-pid"}`,
          metadata: {
            attempted_supervisor_pid: state.supervisor_pid,
            attempted_supervisor_host: state.supervisor_host ?? "unknown-host",
            attempted_supervisor_instance_id: state.supervisor_instance_id ?? "unknown-instance",
            attempted_worker_id: state.worker_id,
            attempted_invocation_mode: state.invocation_mode ?? "unspecified",
            conflicting_supervisor_pid: existing.supervisor_pid,
            conflicting_supervisor_host: existing.supervisor_host ?? "unknown-host",
            conflicting_supervisor_instance_id:
              existing.supervisor_instance_id ?? "unknown-instance",
            conflicting_worker_id: existing.worker_id,
            conflicting_invocation_mode: existing.invocation_mode ?? "unspecified",
            conflicting_last_heartbeat_at: existing.last_heartbeat_at,
          },
        });
        throw new OperationWorkerServiceOwnershipError(existing);
      }

      const heartbeatAt = new Date().toISOString();
      await persist({
        lifecycle_state: "starting",
        heartbeat_at: heartbeatAt,
        current_restart_backoff_ms: null,
        stopped_at: null,
      });

      heartbeatHandle = startAsyncHeartbeat({
        interval_ms: heartbeatIntervalMs,
        label: `operation-worker-service:${options.service_id}`,
        on_heartbeat: async () => {
          await persist({
            heartbeat_at: new Date().toISOString(),
          });
        },
      });

      await persist({
        lifecycle_state: "running",
        heartbeat_at: new Date().toISOString(),
        current_restart_backoff_ms: null,
        stopped_at: null,
      });
      await saveEvent({
        event_type: "started",
        metadata: {
          heartbeat_interval_ms: heartbeatIntervalMs,
          max_restarts: state.max_restarts,
          success_window_ms: state.success_window_ms,
          supervisor_backoff_ms: state.supervisor_backoff_ms,
          supervisor_pid: state.supervisor_pid,
          supervisor_host: state.supervisor_host ?? "unknown-host",
          supervisor_instance_id: state.supervisor_instance_id ?? "unknown-instance",
          invocation_mode: state.invocation_mode ?? "unspecified",
        },
      });
    },
    markLoopStart: async () => {
      const started_at = new Date().toISOString();
      await persist({
        lifecycle_state: "running",
        heartbeat_at: started_at,
        current_restart_backoff_ms: null,
        last_loop_started_at: started_at,
        stopped_at: null,
      });

      return started_at;
    },
    recordLoopExit: async (input: {
      finished_at?: string;
      runtime_ms: number;
      exit_code: number | null;
      exit_signal: NodeJS.Signals | null;
      scheduled_restart: boolean;
      restart_backoff_ms?: number | null;
      error_message?: string | null;
    }) => {
      const finishedAt = input.finished_at ?? new Date().toISOString();
      const nextRestartStreak = resolveOperationWorkerServiceRestartStreak({
        scheduled_restart: input.scheduled_restart,
        runtime_ms: input.runtime_ms,
        success_window_ms: state.success_window_ms,
        current_restart_streak: state.restart_streak,
      });

      await persist({
        lifecycle_state: input.scheduled_restart ? "backing_off" : "running",
        heartbeat_at: finishedAt,
        restart_count: input.scheduled_restart ? state.restart_count + 1 : state.restart_count,
        restart_streak: nextRestartStreak,
        current_restart_backoff_ms: input.scheduled_restart ? input.restart_backoff_ms ?? null : null,
        last_loop_finished_at: finishedAt,
        last_loop_runtime_ms: input.runtime_ms,
        last_exit_code: input.exit_code,
        last_exit_signal: input.exit_signal ?? null,
        last_error_message: input.error_message ?? null,
        stopped_at: null,
      });
      await saveEvent({
        event_type: "loop_exit",
        occurred_at: finishedAt,
        scheduled_restart: input.scheduled_restart,
        loop_runtime_ms: input.runtime_ms,
        exit_code: input.exit_code,
        exit_signal: input.exit_signal ?? null,
        error_message: input.error_message ?? null,
        metadata:
          input.scheduled_restart && input.restart_backoff_ms !== undefined
            ? {
                restart_backoff_ms: input.restart_backoff_ms,
              }
            : {},
      });
    },
    stop: async (error_message: string | null = null) => {
      const stoppingAt = new Date().toISOString();
      await persist({
        lifecycle_state: "stopping",
        heartbeat_at: stoppingAt,
        current_restart_backoff_ms: null,
        last_error_message: error_message,
        stopped_at: null,
      });

      await heartbeatHandle?.stop();

      const stoppedAt = new Date().toISOString();
      await persist({
        lifecycle_state: "stopped",
        heartbeat_at: stoppedAt,
        current_restart_backoff_ms: null,
        last_error_message: error_message,
        stopped_at: stoppedAt,
      });
      await saveEvent({
        event_type: "stopped",
        occurred_at: stoppedAt,
        error_message,
      });
    },
    fail: async (error_message: string) => {
      await heartbeatHandle?.stop();
      const failedAt = new Date().toISOString();
      await persist({
        lifecycle_state: "failed",
        heartbeat_at: failedAt,
        current_restart_backoff_ms: null,
        last_error_message: error_message,
        stopped_at: failedAt,
      });
      await saveEvent({
        event_type: "failed",
        occurred_at: failedAt,
        error_message,
      });
    },
  };
};
