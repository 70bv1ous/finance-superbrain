import { operationQueueReportSchema } from "@finance-superbrain/schemas";
import type { OperationQueueReport } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

export const buildOperationQueueReport = async (
  repository: Repository,
  options: {
    limit?: number;
  } = {},
): Promise<OperationQueueReport> => {
  const asOf = new Date();
  const asOfIso = asOf.toISOString();
  const summary = await repository.getOperationQueueSummary({
    as_of: asOfIso,
  });
  const jobs = await repository.listOperationJobs({
    limit: options.limit ?? 20,
  });
  const leases = await repository.listOperationLeases({
    limit: options.limit ?? 20,
    as_of: asOfIso,
    active_only: true,
  });
  const oldestPendingAt = summary.oldest_pending_at;
  const longestRunningStartedAt = summary.longest_running_started_at;

  return operationQueueReportSchema.parse({
    generated_at: asOfIso,
    counts: summary.counts,
    oldest_pending_at: oldestPendingAt,
    oldest_pending_age_ms:
      oldestPendingAt === null ? null : Math.max(0, asOf.getTime() - new Date(oldestPendingAt).getTime()),
    longest_running_age_ms:
      longestRunningStartedAt === null
        ? null
        : Math.max(0, asOf.getTime() - new Date(longestRunningStartedAt).getTime()),
    active_leases: leases.length,
    latest_jobs: jobs,
    leases,
  });
};
