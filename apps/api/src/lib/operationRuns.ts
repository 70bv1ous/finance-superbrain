import { randomUUID } from "node:crypto";

import type {
  OperationRunRecord,
  OperationRunStatus,
  OperationRunTrigger,
  SystemOperationName,
} from "@finance-superbrain/schemas";

import { resolveHeartbeatIntervalMs, startAsyncHeartbeat } from "./asyncHeartbeat.js";
import type { Repository } from "./repository.types.js";

type OperationRunValue = string | number | boolean | null;
export type OperationRunSummary = Record<string, OperationRunValue>;

type TrackedOperationOptions<Result> = {
  repository: Repository;
  operation_name: SystemOperationName;
  triggered_by: OperationRunTrigger;
  metadata?: OperationRunSummary;
  summarize?: (result: Result) => OperationRunSummary;
  status_from_result?: (result: Result) => OperationRunStatus;
  summarize_error?: (error: unknown) => OperationRunSummary;
  lease?: {
    scope_key: string;
    ttl_ms?: number;
    owner?: string;
    heartbeat_interval_ms?: number;
  };
};

const defaultErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error";

const defaultLeaseTtlMs = 30 * 60 * 1000;

export class OperationLeaseConflictError extends Error {
  constructor(
    readonly operation_name: SystemOperationName,
    readonly scope_key: string,
  ) {
    super(`Operation ${operation_name} is already running for scope ${scope_key}.`);
    this.name = "OperationLeaseConflictError";
  }
}

const persistOperationRun = async (
  repository: Repository,
  run: Omit<OperationRunRecord, "id" | "created_at">,
) => {
  try {
    await repository.saveOperationRun(run);
  } catch (error) {
    console.error("Failed to persist operation run", error);
  }
};

export const runTrackedOperation = async <Result>(
  options: TrackedOperationOptions<Result>,
  operation: () => Promise<Result>,
): Promise<Result> => {
  const leaseTtlMs = options.lease?.ttl_ms ?? defaultLeaseTtlMs;
  const leaseContext = options.lease
    ? (() => {
        const owner = options.lease?.owner ?? randomUUID();
        const acquiredAt = new Date().toISOString();

        return {
          owner,
          acquired_at: acquiredAt,
          expires_at: new Date(new Date(acquiredAt).getTime() + leaseTtlMs).toISOString(),
          scope_key: options.lease.scope_key,
        };
      })()
    : null;

  if (leaseContext) {
    const acquired = await options.repository.acquireOperationLease({
      operation_name: options.operation_name,
      scope_key: leaseContext.scope_key,
      owner: leaseContext.owner,
      acquired_at: leaseContext.acquired_at,
      expires_at: leaseContext.expires_at,
    });

    if (!acquired) {
      throw new OperationLeaseConflictError(options.operation_name, leaseContext.scope_key);
    }
  }

  const started_at = new Date().toISOString();
  const startedMs = Date.now();
  const leaseHeartbeat =
    leaseContext !== null
      ? startAsyncHeartbeat({
          interval_ms: resolveHeartbeatIntervalMs(
            leaseTtlMs,
            options.lease?.heartbeat_interval_ms,
          ),
          label: `${options.operation_name}:${leaseContext.scope_key}`,
          on_heartbeat: async () => {
            const renewedAt = new Date().toISOString();
            const renewedLease = await options.repository.renewOperationLease({
              operation_name: options.operation_name,
              scope_key: leaseContext.scope_key,
              owner: leaseContext.owner,
              renewed_at: renewedAt,
              expires_at: new Date(new Date(renewedAt).getTime() + leaseTtlMs).toISOString(),
            });

            if (!renewedLease) {
              console.warn(
                `Lost lease heartbeat for ${options.operation_name}:${leaseContext.scope_key}`,
              );
            }
          },
        })
      : null;

  try {
    const result = await operation();
    const finished_at = new Date().toISOString();
    await persistOperationRun(options.repository, {
      operation_name: options.operation_name,
      status: options.status_from_result?.(result) ?? "success",
      triggered_by: options.triggered_by,
      started_at,
      finished_at,
      duration_ms: Math.max(0, Date.now() - startedMs),
      metadata: options.metadata ?? {},
      summary: options.summarize?.(result) ?? {},
      error_message: null,
    });

    return result;
  } catch (error) {
    const finished_at = new Date().toISOString();
    await persistOperationRun(options.repository, {
      operation_name: options.operation_name,
      status: "failed",
      triggered_by: options.triggered_by,
      started_at,
      finished_at,
      duration_ms: Math.max(0, Date.now() - startedMs),
      metadata: options.metadata ?? {},
      summary: options.summarize_error?.(error) ?? {},
      error_message: defaultErrorMessage(error),
    });
    throw error;
  } finally {
    await leaseHeartbeat?.stop();

    if (leaseContext) {
      try {
        await options.repository.releaseOperationLease({
          operation_name: options.operation_name,
          scope_key: leaseContext.scope_key,
          owner: leaseContext.owner,
        });
      } catch (error) {
        console.error("Failed to release operation lease", error);
      }
    }
  }
};
