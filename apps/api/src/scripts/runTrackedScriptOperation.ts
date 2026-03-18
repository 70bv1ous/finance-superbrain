import type {
  OperationRunStatus,
  SystemOperationName,
} from "@finance-superbrain/schemas";

import type { AppServices } from "../lib/services.js";
import { runTrackedOperation } from "../lib/operationRuns.js";
import { buildServices } from "../lib/services.js";

type ScriptRunSummary = Record<string, string | number | boolean | null>;

type RunTrackedScriptOperationOptions<Result> = {
  operation_name: SystemOperationName;
  metadata?: ScriptRunSummary;
  summarize?: (result: Result) => ScriptRunSummary;
  status_from_result?: (result: Result) => OperationRunStatus;
  summarize_error?: (error: unknown) => ScriptRunSummary;
};

const closeServices = async (services: AppServices) => {
  await services.marketDataProvider.close?.();
  await services.embeddingProvider.close?.();
  await services.repository.close?.();
};

export const runTrackedScriptOperation = async <Result>(
  options: RunTrackedScriptOperationOptions<Result>,
  operation: (services: AppServices) => Promise<Result>,
) => {
  const services = buildServices();

  try {
    return await runTrackedOperation(
      {
        repository: services.repository,
        triggered_by: "script",
        ...options,
      },
      () => operation(services),
    );
  } finally {
    await closeServices(services);
  }
};
