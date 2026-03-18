import type { SystemWorkerServiceHealth, SystemWorkerServiceReport } from "@finance-superbrain/schemas";

import { resolveOperationWorkerServiceId } from "./operationWorkerServiceIdentity.js";

export type WorkerServiceSupervisorCheckMode = "liveness" | "readiness";

export type WorkerServiceSupervisorStatus = {
  ok: boolean;
  mode: WorkerServiceSupervisorCheckMode;
  service_id: string | null;
  worker_id: string | null;
  status: SystemWorkerServiceHealth["status"] | null;
  reason:
    | "healthy"
    | "backing_off"
    | "failed"
    | "stale"
    | "stopped"
    | "missing"
    | "ambiguous";
  detail: string;
  restart_due_at: string | null;
  remaining_restart_backoff_ms: number | null;
};

const findTargetService = (
  report: SystemWorkerServiceReport,
  options: {
    service_id?: string;
    worker_id?: string;
  } = {},
) => {
  if (options.service_id) {
    return report.services.find((service) => service.service_id === options.service_id) ?? null;
  }

  if (options.worker_id) {
    const derivedServiceId = resolveOperationWorkerServiceId(options.worker_id);
    return report.services.find((service) => service.service_id === derivedServiceId) ?? null;
  }

  if (report.services.length === 1) {
    return report.services[0] ?? null;
  }

  return null;
};

export const evaluateWorkerServiceSupervisorStatus = (
  report: SystemWorkerServiceReport,
  options: {
    mode: WorkerServiceSupervisorCheckMode;
    service_id?: string;
    worker_id?: string;
  },
): WorkerServiceSupervisorStatus => {
  const service = findTargetService(report, options);

  if (service === null) {
    const ambiguous = report.services.length > 1 && !options.service_id && !options.worker_id;
    return {
      ok: false,
      mode: options.mode,
      service_id: options.service_id ?? null,
      worker_id: options.worker_id ?? null,
      status: null,
      reason: ambiguous ? "ambiguous" : "missing",
      detail: ambiguous
        ? "Multiple worker services are registered. Provide OPERATION_WORKER_SERVICE_ID or OPERATION_WORKER_ID so the supervisor health check can target one boundary deterministically."
        : "The targeted worker service is not registered in the repository yet.",
      restart_due_at: null,
      remaining_restart_backoff_ms: null,
    };
  }

  if (service.status === "active") {
    return {
      ok: true,
      mode: options.mode,
      service_id: service.service_id,
      worker_id: service.worker_id,
      status: service.status,
      reason: "healthy",
      detail: "The worker service is active and heartbeating normally.",
      restart_due_at: service.restart_due_at,
      remaining_restart_backoff_ms: service.remaining_restart_backoff_ms,
    };
  }

  if (service.status === "backing_off") {
    return {
      ok: options.mode === "liveness",
      mode: options.mode,
      service_id: service.service_id,
      worker_id: service.worker_id,
      status: service.status,
      reason: "backing_off",
      detail:
        options.mode === "liveness"
          ? "The worker service supervisor is alive but currently inside restart backoff."
          : "The worker service is inside restart backoff and is not ready to drain queued work yet.",
      restart_due_at: service.restart_due_at,
      remaining_restart_backoff_ms: service.remaining_restart_backoff_ms,
    };
  }

  const reason =
    service.status === "failed"
      ? "failed"
      : service.status === "stale"
        ? "stale"
        : "stopped";
  const detail =
    service.status === "failed"
      ? "The worker service is marked failed."
      : service.status === "stale"
        ? "The worker service heartbeat is stale."
        : "The worker service is stopped.";

  return {
    ok: false,
    mode: options.mode,
    service_id: service.service_id,
    worker_id: service.worker_id,
    status: service.status,
    reason,
    detail,
    restart_due_at: service.restart_due_at,
    remaining_restart_backoff_ms: service.remaining_restart_backoff_ms,
  };
};
