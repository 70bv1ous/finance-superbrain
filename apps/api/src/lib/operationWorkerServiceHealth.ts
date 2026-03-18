import type { OperationWorkerServiceRecord } from "@finance-superbrain/schemas";

const defaultStaleAfterMs = 30_000;

export const resolveOperationWorkerServiceStaleAfterMs = (service: Pick<
  OperationWorkerServiceRecord,
  "heartbeat_interval_ms" | "supervisor_backoff_ms"
>) =>
  Math.max(
    defaultStaleAfterMs,
    service.heartbeat_interval_ms * 3,
    service.supervisor_backoff_ms * 3,
  );

export const resolveOperationWorkerServiceRestartDueAt = (service: Pick<
  OperationWorkerServiceRecord,
  "current_restart_backoff_ms" | "last_loop_finished_at" | "last_heartbeat_at"
>) => {
  if (service.current_restart_backoff_ms === null) {
    return null;
  }

  const anchor = service.last_loop_finished_at ?? service.last_heartbeat_at;
  return new Date(new Date(anchor).getTime() + service.current_restart_backoff_ms).toISOString();
};

export const resolveOperationWorkerServiceRemainingBackoffMs = (
  service: Pick<
    OperationWorkerServiceRecord,
    "current_restart_backoff_ms" | "last_loop_finished_at" | "last_heartbeat_at"
  >,
  asOf = new Date(),
) => {
  const dueAt = resolveOperationWorkerServiceRestartDueAt(service);

  if (dueAt === null) {
    return 0;
  }

  return Math.max(0, new Date(dueAt).getTime() - asOf.getTime());
};
