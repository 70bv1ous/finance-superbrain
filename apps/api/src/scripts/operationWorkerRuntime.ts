import { randomUUID } from "node:crypto";

import type { SystemOperationName } from "@finance-superbrain/schemas";

import { resolveHeartbeatIntervalMs, startAsyncHeartbeat } from "../lib/asyncHeartbeat.js";
import type { AppServices } from "../lib/services.js";

const minimumWorkerHeartbeatIntervalMs = 1_000;
const defaultWorkerHeartbeatBasisMs = 15_000;

type WorkerReporterOptions = {
  worker_id: string;
  supported_operations?: SystemOperationName[];
  poll_interval_ms?: number;
  idle_backoff_ms?: number;
  heartbeat_interval_ms?: number;
};

type WorkerCycleMetrics = {
  started_at?: string | null;
  finished_at?: string | null;
  processed: number;
  completed: number;
  failed: number;
  retried: number;
  abandoned: number;
  error_message?: string | null;
};

type WorkerState = {
  worker_id: string;
  lifecycle_state: "starting" | "running" | "stopping" | "stopped";
  supported_operations?: SystemOperationName[];
  poll_interval_ms?: number | null;
  idle_backoff_ms?: number | null;
  started_at?: string;
  heartbeat_at: string;
  last_cycle_started_at?: string | null;
  last_cycle_finished_at?: string | null;
  last_cycle_processed?: number | null;
  last_cycle_completed?: number | null;
  last_cycle_failed?: number | null;
  last_cycle_retried?: number | null;
  last_cycle_abandoned?: number | null;
  last_error_message?: string | null;
  stopped_at?: string | null;
};

const resolveWorkerHeartbeatIntervalMs = (
  pollIntervalMs?: number,
  idleBackoffMs?: number,
  requestedIntervalMs?: number,
) => {
  if (requestedIntervalMs !== undefined) {
    return Math.max(minimumWorkerHeartbeatIntervalMs, Math.floor(requestedIntervalMs));
  }

  const basisMs = [pollIntervalMs, idleBackoffMs]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .reduce((max, value) => Math.max(max, value), defaultWorkerHeartbeatBasisMs);

  return Math.max(
    minimumWorkerHeartbeatIntervalMs,
    resolveHeartbeatIntervalMs(basisMs, Math.floor(basisMs / 2)),
  );
};

export const resolveOperationWorkerId = () =>
  process.env.OPERATION_WORKER_ID?.trim() || `worker-${randomUUID()}`;

export const parseSupportedWorkerOperations = () => {
  const raw = process.env.OPERATION_WORKER_OPERATIONS?.trim();

  if (!raw) {
    return undefined;
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as SystemOperationName[];
};

export const closeServices = async (services: AppServices) => {
  await services.marketDataProvider.close?.();
  await services.embeddingProvider.close?.();
  await services.repository.close?.();
};

export const createOperationWorkerReporter = (
  services: AppServices,
  options: WorkerReporterOptions,
) => {
  const startedAt = new Date().toISOString();
  const heartbeatIntervalMs = resolveWorkerHeartbeatIntervalMs(
    options.poll_interval_ms,
    options.idle_backoff_ms,
    options.heartbeat_interval_ms,
  );

  let state: WorkerState = {
    worker_id: options.worker_id,
    lifecycle_state: "starting",
    supported_operations: options.supported_operations,
    poll_interval_ms: options.poll_interval_ms ?? null,
    idle_backoff_ms: options.idle_backoff_ms ?? null,
    started_at: startedAt,
    heartbeat_at: startedAt,
    last_cycle_started_at: null,
    last_cycle_finished_at: null,
    last_cycle_processed: null,
    last_cycle_completed: null,
    last_cycle_failed: null,
    last_cycle_retried: null,
    last_cycle_abandoned: null,
    last_error_message: null,
    stopped_at: null,
  };

  let heartbeatHandle: ReturnType<typeof startAsyncHeartbeat> | null = null;

  const persist = async (patch: Partial<WorkerState> = {}) => {
    state = {
      ...state,
      ...patch,
      heartbeat_at: patch.heartbeat_at ?? state.heartbeat_at,
    };

    await services.repository.upsertOperationWorker({
      worker_id: state.worker_id,
      lifecycle_state: state.lifecycle_state,
      supported_operations: state.supported_operations,
      poll_interval_ms: state.poll_interval_ms,
      idle_backoff_ms: state.idle_backoff_ms,
      started_at: state.started_at,
      heartbeat_at: state.heartbeat_at,
      last_cycle_started_at: state.last_cycle_started_at,
      last_cycle_finished_at: state.last_cycle_finished_at,
      last_cycle_processed: state.last_cycle_processed,
      last_cycle_completed: state.last_cycle_completed,
      last_cycle_failed: state.last_cycle_failed,
      last_cycle_retried: state.last_cycle_retried,
      last_cycle_abandoned: state.last_cycle_abandoned,
      last_error_message: state.last_error_message,
      stopped_at: state.stopped_at,
    });
  };

  const persistEvent = async (input: {
    event_type: "started" | "cycle" | "stopped";
    occurred_at: string;
    lifecycle_state?: WorkerState["lifecycle_state"] | null;
    cycle_processed?: number | null;
    cycle_completed?: number | null;
    cycle_failed?: number | null;
    cycle_retried?: number | null;
    cycle_abandoned?: number | null;
    error_message?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  }) =>
    services.repository.saveOperationWorkerEvent({
      worker_id: state.worker_id,
      event_type: input.event_type,
      occurred_at: input.occurred_at,
      lifecycle_state: input.lifecycle_state ?? null,
      cycle_processed: input.cycle_processed ?? null,
      cycle_completed: input.cycle_completed ?? null,
      cycle_failed: input.cycle_failed ?? null,
      cycle_retried: input.cycle_retried ?? null,
      cycle_abandoned: input.cycle_abandoned ?? null,
      error_message: input.error_message ?? null,
      metadata: input.metadata ?? {},
    });

  return {
    worker_id: options.worker_id,
    heartbeat_interval_ms: heartbeatIntervalMs,
    start: async () => {
      const heartbeatAt = new Date().toISOString();
      await persist({
        lifecycle_state: "starting",
        heartbeat_at: heartbeatAt,
        stopped_at: null,
      });

      heartbeatHandle = startAsyncHeartbeat({
        interval_ms: heartbeatIntervalMs,
        label: `operation-worker:${options.worker_id}`,
        on_heartbeat: async () => {
          await persist({
            heartbeat_at: new Date().toISOString(),
          });
        },
      });

      await persist({
        lifecycle_state: "running",
        heartbeat_at: new Date().toISOString(),
        stopped_at: null,
      });

      await persistEvent({
        event_type: "started",
        occurred_at: new Date().toISOString(),
        lifecycle_state: "running",
        metadata: {
          poll_interval_ms: options.poll_interval_ms ?? null,
          idle_backoff_ms: options.idle_backoff_ms ?? null,
          heartbeat_interval_ms: heartbeatIntervalMs,
          supported_operation_count: options.supported_operations?.length ?? 0,
        },
      });
    },
    markCycleStart: async () => {
      const started_at = new Date().toISOString();
      await persist({
        lifecycle_state: "running",
        heartbeat_at: started_at,
        last_cycle_started_at: started_at,
        stopped_at: null,
      });

      return started_at;
    },
    recordCycle: async (metrics: WorkerCycleMetrics) => {
      const finishedAt = metrics.finished_at ?? new Date().toISOString();
      await persist({
        lifecycle_state: "running",
        heartbeat_at: finishedAt,
        last_cycle_started_at: metrics.started_at ?? state.last_cycle_started_at ?? null,
        last_cycle_finished_at: finishedAt,
        last_cycle_processed: metrics.processed,
        last_cycle_completed: metrics.completed,
        last_cycle_failed: metrics.failed,
        last_cycle_retried: metrics.retried,
        last_cycle_abandoned: metrics.abandoned,
        last_error_message: metrics.error_message ?? null,
        stopped_at: null,
      });

      await persistEvent({
        event_type: "cycle",
        occurred_at: finishedAt,
        lifecycle_state: "running",
        cycle_processed: metrics.processed,
        cycle_completed: metrics.completed,
        cycle_failed: metrics.failed,
        cycle_retried: metrics.retried,
        cycle_abandoned: metrics.abandoned,
        error_message: metrics.error_message ?? null,
        metadata: {
          started_at: metrics.started_at ?? null,
          finished_at: finishedAt,
        },
      });
    },
    stop: async (error_message: string | null = null) => {
      const stoppingAt = new Date().toISOString();
      await persist({
        lifecycle_state: "stopping",
        heartbeat_at: stoppingAt,
        last_error_message: error_message,
        stopped_at: null,
      });

      await heartbeatHandle?.stop();

      const stoppedAt = new Date().toISOString();
      await persist({
        lifecycle_state: "stopped",
        heartbeat_at: stoppedAt,
        last_error_message: error_message,
        stopped_at: stoppedAt,
      });

      await persistEvent({
        event_type: "stopped",
        occurred_at: stoppedAt,
        lifecycle_state: "stopped",
        error_message,
        metadata: {
          had_error: Boolean(error_message),
        },
      });
    },
  };
};
