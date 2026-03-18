import { drainOperationJobs } from "../lib/operationJobs.js";
import { buildServices } from "../lib/services.js";
import {
  closeServices,
  createOperationWorkerReporter,
  parseSupportedWorkerOperations,
  resolveOperationWorkerId,
} from "./operationWorkerRuntime.js";
import { createOperationWorkerMaintenanceRunner } from "./operationWorkerMaintenance.js";
import { waitForDelay } from "./interruptibleDelay.js";
import { resolveBoundedRuntimeNumber, resolveOptionalRuntimeNumber } from "./runtimeConfig.js";

const services = buildServices();
const workerId = resolveOperationWorkerId();
const maxJobs = resolveBoundedRuntimeNumber({
  value: process.env.MAX_OPERATION_JOBS,
  fallback: 25,
  minimum: 1,
  maximum: 1_000,
});
const retryDelaySeconds = resolveBoundedRuntimeNumber({
  value: process.env.OPERATION_RETRY_DELAY_SECONDS,
  fallback: 60,
  minimum: 1,
  maximum: 24 * 60 * 60,
});
const heartbeatIntervalMs = resolveOptionalRuntimeNumber({
  value: process.env.OPERATION_HEARTBEAT_INTERVAL_MS,
  minimum: 1_000,
});
const supportedOperations = parseSupportedWorkerOperations();
const pollIntervalMs = resolveBoundedRuntimeNumber({
  value: process.env.OPERATION_WORKER_POLL_INTERVAL_MS,
  fallback: 2_000,
  minimum: 250,
});
const idleBackoffMs = resolveBoundedRuntimeNumber({
  value: process.env.OPERATION_WORKER_IDLE_BACKOFF_MS,
  fallback: 5_000,
  minimum: pollIntervalMs,
});

let stopping = false;
let cycleCount = 0;
let processedCount = 0;
let stopErrorMessage: string | null = null;
const stopController = new AbortController();

const handleSignal = () => {
  stopping = true;
  stopController.abort();
};

process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);

const workerReporter = createOperationWorkerReporter(services, {
  worker_id: workerId,
  supported_operations: supportedOperations,
  poll_interval_ms: pollIntervalMs,
  idle_backoff_ms: idleBackoffMs,
  heartbeat_interval_ms: heartbeatIntervalMs,
});
const maintenanceRunner = createOperationWorkerMaintenanceRunner(services, {
  supported_operations: supportedOperations,
});
let workerStarted = false;

try {
  await workerReporter.start();
  workerStarted = true;

  while (!stopping) {
    const cycleStartedAt = await workerReporter.markCycleStart();
    let maintenanceErrorMessage: string | null = null;
    const maintenance = await maintenanceRunner
      .runDueMaintenance(cycleStartedAt)
      .catch((error) => {
        maintenanceErrorMessage =
          error instanceof Error
            ? error.message
            : "Unknown operation worker maintenance failure.";

        return {
          integration_probe_snapshot: {
            checked: false,
            enqueued: false,
            refresh_needed: false,
            skipped_reason: "error",
            job_id: null as string | null,
          },
        };
      });
    const result = await drainOperationJobs(services, {
      worker_id: workerId,
      max_jobs: maxJobs,
      heartbeat_interval_ms: workerReporter.heartbeat_interval_ms,
      supported_operations: supportedOperations,
      retry_delay_seconds: retryDelaySeconds,
    });

    cycleCount += 1;
    processedCount += result.processed;

    await workerReporter.recordCycle({
      started_at: cycleStartedAt,
      finished_at: new Date().toISOString(),
      processed: result.processed,
      completed: result.completed,
      failed: result.failed,
      retried: result.retried,
      abandoned: result.abandoned,
      error_message: maintenanceErrorMessage,
    });

    console.log(
      JSON.stringify(
        {
          worker_id: workerId,
          cycle: cycleCount,
          abandoned: result.abandoned,
          processed: result.processed,
          completed: result.completed,
          failed: result.failed,
          retried: result.retried,
          maintenance,
          sleeping_ms: result.processed > 0 ? pollIntervalMs : idleBackoffMs,
        },
        null,
        2,
      ),
    );

    if (!stopping) {
      await waitForDelay(
        result.processed > 0 ? pollIntervalMs : idleBackoffMs,
        stopController.signal,
      );
    }
  }
} catch (error) {
  stopErrorMessage = error instanceof Error ? error.message : "Unknown worker loop failure.";
  throw error;
} finally {
  if (workerStarted) {
    await workerReporter.stop(stopErrorMessage);
  }
  console.log(
    JSON.stringify(
      {
        worker_id: workerId,
        stopped: true,
        cycles: cycleCount,
        total_processed: processedCount,
      },
      null,
      2,
    ),
  );
  await closeServices(services);
}
