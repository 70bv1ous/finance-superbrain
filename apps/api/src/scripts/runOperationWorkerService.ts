import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import type { SystemOperationName } from "@finance-superbrain/schemas";

import {
  resolveOperationWorkerServiceRestartDelayMs,
  resolveOperationWorkerServiceRestartStreak,
} from "../lib/operationWorkerServiceRestartPolicy.js";
import {
  resolveOperationWorkerServiceHost,
  resolveOperationWorkerServiceId,
} from "../lib/operationWorkerServiceIdentity.js";
import { buildRepositoryFromEnv } from "../lib/services.js";
import { waitForDelay } from "./interruptibleDelay.js";
import {
  OperationWorkerServiceBackoffActiveError,
  createOperationWorkerServiceReporter,
  OperationWorkerServiceOwnershipError,
} from "./operationWorkerServiceRuntime.js";
import { resolveOperationWorkerLoopInvocation } from "./operationWorkerLoopInvocation.js";
import { resolveBoundedRuntimeNumber, resolveOptionalRuntimeNumber } from "./runtimeConfig.js";

const backoffMs = resolveBoundedRuntimeNumber({
  value: process.env.OPERATION_WORKER_SERVICE_BACKOFF_MS,
  fallback: 5_000,
  minimum: 1_000,
});
const maxBackoffMs = resolveBoundedRuntimeNumber({
  value: process.env.OPERATION_WORKER_SERVICE_MAX_BACKOFF_MS,
  fallback: Math.max(60_000, backoffMs * 8),
  minimum: backoffMs,
  maximum: 24 * 60 * 60 * 1000,
});
const successWindowMs = resolveBoundedRuntimeNumber({
  value: process.env.OPERATION_WORKER_SERVICE_SUCCESS_WINDOW_MS,
  fallback: 60_000,
  minimum: 5_000,
});
const maxRestarts = resolveBoundedRuntimeNumber({
  value: process.env.OPERATION_WORKER_SERVICE_MAX_RESTARTS,
  fallback: 10,
  minimum: 1,
  maximum: 1_000,
});
const stableWorkerId = process.env.OPERATION_WORKER_ID?.trim() || `worker-${randomUUID()}`;
const serviceId = resolveOperationWorkerServiceId(stableWorkerId);
const supervisorHost = resolveOperationWorkerServiceHost();
const supervisorInstanceId = randomUUID();
const heartbeatIntervalMs = resolveOptionalRuntimeNumber({
  value: process.env.OPERATION_WORKER_SERVICE_HEARTBEAT_INTERVAL_MS,
  minimum: 1_000,
});
const supportedOperations = process.env.OPERATION_WORKER_OPERATIONS?.trim()
  ? process.env.OPERATION_WORKER_OPERATIONS.split(",").map((value) => value.trim()).filter(Boolean)
  : undefined;

let stopping = false;
let child: ReturnType<typeof spawn> | null = null;
const stopController = new AbortController();

const handleSignal = (signal: NodeJS.Signals) => {
  stopping = true;
  stopController.abort();
  child?.kill(signal);
};

process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);

const repository = buildRepositoryFromEnv();
const workerLoopInvocation = resolveOperationWorkerLoopInvocation();
const serviceReporter = createOperationWorkerServiceReporter(repository, {
  service_id: serviceId,
  worker_id: stableWorkerId,
  supported_operations: supportedOperations as SystemOperationName[] | undefined,
  supervisor_pid: process.pid,
  supervisor_host: supervisorHost,
  supervisor_instance_id: supervisorInstanceId,
  invocation_mode: workerLoopInvocation.mode,
  supervisor_backoff_ms: backoffMs,
  success_window_ms: successWindowMs,
  heartbeat_interval_ms: heartbeatIntervalMs,
  max_restarts: maxRestarts,
});

const runWorkerLoop = async () =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child = spawn(workerLoopInvocation.command, workerLoopInvocation.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPERATION_WORKER_ID: stableWorkerId,
      },
      stdio: "inherit",
    });

    child.once("exit", (code, signal) => {
      child = null;
      resolve({ code, signal });
    });
  });

let restarts = 0;
let serviceFailedHard = false;
let serviceStarted = false;

try {
  while (!stopping && !serviceStarted) {
    try {
      await serviceReporter.start();
      serviceStarted = true;
    } catch (error) {
      if (error instanceof OperationWorkerServiceBackoffActiveError) {
        console.error(
          JSON.stringify(
            {
              worker_id: stableWorkerId,
              service_id: serviceId,
              service: "operation-worker",
              event: "worker_service_backoff_respected",
              invocation_mode: workerLoopInvocation.mode,
              backoff_until: error.backoff_until,
              remaining_backoff_ms: error.remaining_backoff_ms,
              conflicting_host: error.existing_service.supervisor_host,
              conflicting_pid: error.existing_service.supervisor_pid,
              conflicting_instance_id: error.existing_service.supervisor_instance_id,
              conflicting_worker_id: error.existing_service.worker_id,
            },
            null,
            2,
          ),
        );
        await waitForDelay(error.remaining_backoff_ms, stopController.signal);
        continue;
      }

      throw error;
    }
  }

  while (!stopping) {
    await serviceReporter.markLoopStart();
    const startedAt = Date.now();
    const result = await runWorkerLoop();
    const runtimeMs = Date.now() - startedAt;
    const scheduledRestart = !stopping && result.code !== 0;
    const nextRestartStreak = resolveOperationWorkerServiceRestartStreak({
      scheduled_restart: scheduledRestart,
      runtime_ms: runtimeMs,
      success_window_ms: successWindowMs,
      current_restart_streak: restarts,
    });
    const restartBackoffMs = scheduledRestart
      ? resolveOperationWorkerServiceRestartDelayMs({
          base_backoff_ms: backoffMs,
          max_backoff_ms: maxBackoffMs,
          restart_streak: nextRestartStreak,
        })
      : null;

    await serviceReporter.recordLoopExit({
      runtime_ms: runtimeMs,
      exit_code: result.code,
      exit_signal: result.signal,
      scheduled_restart: scheduledRestart,
      restart_backoff_ms: restartBackoffMs,
      error_message:
        result.code === 0
          ? null
          : `worker loop exited with code ${result.code ?? "null"}${result.signal ? ` signal ${result.signal}` : ""}`,
    });

    if (stopping || result.code === 0) {
      process.exitCode = result.code ?? 0;
      break;
    }

    restarts = nextRestartStreak;

    console.error(
      JSON.stringify(
        {
          worker_id: stableWorkerId,
          service_id: serviceId,
          service: "operation-worker",
          event: "worker_restart_scheduled",
          invocation_mode: workerLoopInvocation.mode,
          code: result.code,
          signal: result.signal,
          runtime_ms: runtimeMs,
          restart_count: restarts,
          backoff_ms: restartBackoffMs,
          base_backoff_ms: backoffMs,
          max_backoff_ms: maxBackoffMs,
        },
        null,
        2,
      ),
    );

    if (restarts > maxRestarts) {
      const errorMessage = `worker restart limit exceeded after ${restarts} consecutive restart(s)`;
      console.error(
        JSON.stringify(
          {
            worker_id: stableWorkerId,
            service_id: serviceId,
            service: "operation-worker",
            event: "worker_restart_limit_exceeded",
            invocation_mode: workerLoopInvocation.mode,
            max_restarts: maxRestarts,
            restart_count: restarts,
            last_backoff_ms: restartBackoffMs,
          },
          null,
          2,
        ),
      );
      await serviceReporter.fail(errorMessage);
      serviceFailedHard = true;
      process.exitCode = 1;
      break;
    }

    await waitForDelay(restartBackoffMs ?? backoffMs, stopController.signal);
  }
} catch (error) {
  if (error instanceof OperationWorkerServiceOwnershipError) {
    console.error(
      JSON.stringify(
        {
          worker_id: stableWorkerId,
          service_id: serviceId,
          service: "operation-worker",
          event: "worker_service_ownership_conflict",
          supervisor_host: supervisorHost,
          supervisor_pid: process.pid,
          supervisor_instance_id: supervisorInstanceId,
          invocation_mode: workerLoopInvocation.mode,
          conflicting_host: error.conflicting_service.supervisor_host,
          conflicting_pid: error.conflicting_service.supervisor_pid,
          conflicting_instance_id: error.conflicting_service.supervisor_instance_id,
          conflicting_worker_id: error.conflicting_service.worker_id,
          conflicting_last_heartbeat_at: error.conflicting_service.last_heartbeat_at,
        },
        null,
        2,
      ),
    );
  }

  throw error;
} finally {
  if (serviceFailedHard) {
    await repository.close?.();
  } else if (serviceStarted) {
    await serviceReporter.stop(stopping ? "worker service stopped by signal" : null);
    await repository.close?.();
  } else {
    await repository.close?.();
  }
}
