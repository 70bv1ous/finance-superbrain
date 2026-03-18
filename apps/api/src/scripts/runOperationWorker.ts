import { drainOperationJobs } from "../lib/operationJobs.js";
import { buildServices } from "../lib/services.js";
import {
  closeServices,
  createOperationWorkerReporter,
  parseSupportedWorkerOperations,
  resolveOperationWorkerId,
} from "./operationWorkerRuntime.js";
import { resolveBoundedRuntimeNumber, resolveOptionalRuntimeNumber } from "./runtimeConfig.js";

const services = buildServices();
const workerId = resolveOperationWorkerId();
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
const workerReporter = createOperationWorkerReporter(services, {
  worker_id: workerId,
  supported_operations: supportedOperations,
  poll_interval_ms: pollIntervalMs,
  idle_backoff_ms: idleBackoffMs,
  heartbeat_interval_ms: heartbeatIntervalMs,
});
let stopErrorMessage: string | null = null;
let workerStarted = false;

try {
  await workerReporter.start();
  workerStarted = true;
  const cycleStartedAt = await workerReporter.markCycleStart();
  const result = await drainOperationJobs(services, {
    worker_id: workerId,
    max_jobs: resolveBoundedRuntimeNumber({
      value: process.env.MAX_OPERATION_JOBS,
      fallback: 25,
      minimum: 1,
      maximum: 1_000,
    }),
    heartbeat_interval_ms: workerReporter.heartbeat_interval_ms,
    supported_operations: supportedOperations,
    retry_delay_seconds: resolveBoundedRuntimeNumber({
      value: process.env.OPERATION_RETRY_DELAY_SECONDS,
      fallback: 60,
      minimum: 1,
      maximum: 24 * 60 * 60,
    }),
  });

  await workerReporter.recordCycle({
    started_at: cycleStartedAt,
    finished_at: new Date().toISOString(),
    processed: result.processed,
    completed: result.completed,
    failed: result.failed,
    retried: result.retried,
    abandoned: result.abandoned,
    error_message: null,
  });

  console.log(
    JSON.stringify(
      {
        abandoned: result.abandoned,
        processed: result.processed,
        completed: result.completed,
        failed: result.failed,
        retried: result.retried,
        jobs: result.results.map((item) => ({
          id: item.job.id,
          operation_name: item.job.operation_name,
          status: item.job.status,
          attempt_count: item.job.attempt_count,
          retry_scheduled: item.retry_scheduled,
          error_message: item.job.error_message,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  stopErrorMessage = error instanceof Error ? error.message : "Unknown worker drain failure.";
  throw error;
} finally {
  if (workerStarted) {
    await workerReporter.stop(stopErrorMessage);
  }
  await closeServices(services);
}
