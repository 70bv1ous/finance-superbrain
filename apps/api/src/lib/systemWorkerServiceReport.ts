import { systemWorkerServiceReportSchema } from "@finance-superbrain/schemas";
import type { SystemWorkerServiceHealth, SystemWorkerServiceReport } from "@finance-superbrain/schemas";

import {
  resolveOperationWorkerServiceRemainingBackoffMs,
  resolveOperationWorkerServiceRestartDueAt,
  resolveOperationWorkerServiceStaleAfterMs,
} from "./operationWorkerServiceHealth.js";
import type { Repository } from "./repository.types.js";

export const buildSystemWorkerServiceReport = async (
  repository: Repository,
  options: {
    limit?: number;
    as_of?: string;
  } = {},
): Promise<SystemWorkerServiceReport> => {
  const asOf = options.as_of ? new Date(options.as_of) : new Date();
  const generated_at = asOf.toISOString();
  const services = await repository.listOperationWorkerServices({
    limit: options.limit ?? 20,
  });

  const healthServices: SystemWorkerServiceHealth[] = services.map((service) => {
    const stale_after_ms = resolveOperationWorkerServiceStaleAfterMs(service);
    const heartbeat_age_ms = Math.max(
      0,
      asOf.getTime() - new Date(service.last_heartbeat_at).getTime(),
    );
    const restart_due_at = resolveOperationWorkerServiceRestartDueAt(service);
    const remaining_restart_backoff_ms =
      restart_due_at === null
        ? null
        : resolveOperationWorkerServiceRemainingBackoffMs(service, asOf);

    const status: SystemWorkerServiceHealth["status"] =
      service.lifecycle_state === "failed"
        ? "failed"
        : service.lifecycle_state === "stopped"
          ? "stopped"
          : heartbeat_age_ms > stale_after_ms
            ? "stale"
            : service.lifecycle_state === "backing_off"
              ? "backing_off"
              : "active";

    return {
      ...service,
      status,
      stale_after_ms,
      heartbeat_age_ms,
      restart_due_at,
      remaining_restart_backoff_ms,
    };
  });

  return systemWorkerServiceReportSchema.parse({
    generated_at,
    counts: {
      total: healthServices.length,
      active: healthServices.filter((service) => service.status === "active").length,
      backing_off: healthServices.filter((service) => service.status === "backing_off").length,
      stale: healthServices.filter((service) => service.status === "stale").length,
      stopped: healthServices.filter((service) => service.status === "stopped").length,
      failed: healthServices.filter((service) => service.status === "failed").length,
    },
    services: healthServices,
  });
};
