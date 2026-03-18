import {
  systemOperationNameSchema,
  systemOperationReportSchema,
} from "@finance-superbrain/schemas";

import type {
  OperationRunRecord,
  SystemOperationReport,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

const allOperationNames = systemOperationNameSchema.options;

const averageDuration = (runs: OperationRunRecord[]) => {
  if (!runs.length) {
    return null;
  }

  return Math.round(
    runs.reduce((total, run) => total + run.duration_ms, 0) / runs.length,
  );
};

export const buildSystemOperationReport = async (
  repository: Repository,
  options: {
    limit?: number;
    operation_names?: OperationRunRecord["operation_name"][];
    statuses?: OperationRunRecord["status"][];
    triggered_by?: OperationRunRecord["triggered_by"][];
  } = {},
): Promise<SystemOperationReport> => {
  const runs = await repository.listOperationRuns({
    limit: options.limit ?? 60,
    operation_names: options.operation_names,
    statuses: options.statuses,
    triggered_by: options.triggered_by,
  });
  const generated_at = new Date().toISOString();
  const latest_failure = runs.find((run) => run.status === "failed") ?? null;

  const operations = allOperationNames.map((operation_name) => {
    const operationRuns = runs.filter((run) => run.operation_name === operation_name);
    const latest = operationRuns[0] ?? null;

    return {
      operation_name,
      total_runs: operationRuns.length,
      success_count: operationRuns.filter((run) => run.status === "success").length,
      failed_count: operationRuns.filter((run) => run.status === "failed").length,
      partial_count: operationRuns.filter((run) => run.status === "partial").length,
      latest_status: latest?.status ?? null,
      latest_triggered_by: latest?.triggered_by ?? null,
      latest_started_at: latest?.started_at ?? null,
      latest_finished_at: latest?.finished_at ?? null,
      average_duration_ms: averageDuration(operationRuns),
      latest_error_message: latest?.status === "failed" ? latest.error_message : null,
    };
  });

  return systemOperationReportSchema.parse({
    generated_at,
    counts: {
      total: runs.length,
      success: runs.filter((run) => run.status === "success").length,
      failed: runs.filter((run) => run.status === "failed").length,
      partial: runs.filter((run) => run.status === "partial").length,
    },
    latest_failure,
    latest_runs: runs.slice(0, 12),
    operations,
  });
};
