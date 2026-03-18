import { systemWorkerReportSchema } from "@finance-superbrain/schemas";
import type { SystemWorkerHealth, SystemWorkerReport } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

const defaultStaleAfterMs = 30_000;

const resolveWorkerStaleAfterMs = (worker: {
  poll_interval_ms: number | null;
  idle_backoff_ms: number | null;
}) => {
  const derived = Math.max(
    worker.idle_backoff_ms ?? 0,
    worker.poll_interval_ms ?? 0,
    5_000,
  ) * 3;

  return Math.max(defaultStaleAfterMs, derived);
};

export const buildSystemWorkerReport = async (
  repository: Repository,
  options: {
    limit?: number;
    as_of?: string;
  } = {},
): Promise<SystemWorkerReport> => {
  const asOf = options.as_of ? new Date(options.as_of) : new Date();
  const generated_at = asOf.toISOString();
  const workers = await repository.listOperationWorkers({
    limit: options.limit ?? 20,
  });

  const healthWorkers: SystemWorkerHealth[] = workers.map((worker) => {
    const stale_after_ms = resolveWorkerStaleAfterMs(worker);
    const heartbeat_age_ms = Math.max(
      0,
      asOf.getTime() - new Date(worker.last_heartbeat_at).getTime(),
    );

    const status: SystemWorkerHealth["status"] =
      worker.lifecycle_state === "stopped"
        ? "stopped"
        : heartbeat_age_ms > stale_after_ms
          ? "stale"
          : "active";

    return {
      ...worker,
      status,
      stale_after_ms,
      heartbeat_age_ms,
    };
  });

  return systemWorkerReportSchema.parse({
    generated_at,
    counts: {
      total: healthWorkers.length,
      active: healthWorkers.filter((worker) => worker.status === "active").length,
      stale: healthWorkers.filter((worker) => worker.status === "stale").length,
      stopped: healthWorkers.filter((worker) => worker.status === "stopped").length,
    },
    workers: healthWorkers,
  });
};
