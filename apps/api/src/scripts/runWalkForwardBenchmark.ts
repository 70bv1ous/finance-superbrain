import {
  walkForwardReplayRequestSchema,
  walkForwardReplayResponseSchema,
} from "@finance-superbrain/schemas";

import { runWalkForwardReplay } from "../lib/walkForwardReplay.js";
import { buildServices } from "../lib/services.js";
import { requestOpsApi, shouldUseOpsApi } from "./httpOps.js";

const splitList = (value?: string) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const request = walkForwardReplayRequestSchema.parse({
  model_versions: splitList(process.env.WALK_FORWARD_MODEL_VERSIONS) ?? ["impact-engine-v0"],
  benchmark_pack_id: process.env.WALK_FORWARD_BENCHMARK_PACK_ID?.trim() || "core_benchmark_v1",
  case_pack_filters: splitList(process.env.WALK_FORWARD_CASE_PACK_FILTERS),
  allowed_case_qualities: splitList(process.env.WALK_FORWARD_ALLOWED_CASE_QUALITIES),
  min_train_cases: Number(process.env.WALK_FORWARD_MIN_TRAIN_CASES ?? 10),
  test_window_size: Number(process.env.WALK_FORWARD_TEST_WINDOW_SIZE ?? 5),
  step_size: process.env.WALK_FORWARD_STEP_SIZE
    ? Number(process.env.WALK_FORWARD_STEP_SIZE)
    : undefined,
  training_mode: "expanding",
  seed_training_memory:
    (process.env.WALK_FORWARD_SEED_TRAINING_MEMORY ?? "true").toLowerCase() !== "false",
  training_memory_model_version:
    process.env.WALK_FORWARD_MEMORY_MODEL_VERSION?.trim() || "walk-forward-memory-v1",
});

const printResult = (
  result: ReturnType<typeof walkForwardReplayResponseSchema.parse>,
) => {
  console.log(
    JSON.stringify(
      {
        benchmark_pack_id: result.benchmark_pack_id,
        eligible_case_count: result.eligible_case_count,
        undated_case_count: result.undated_case_count,
        window_count: result.window_count,
        leaders: result.leaders,
        models: result.models.map((model) => ({
          model_version: model.model_version,
          case_count: model.case_count,
          average_total_score: model.average_total_score,
          direction_accuracy: model.direction_accuracy,
          calibration_gap: model.calibration_gap,
          wrong_rate: model.wrong_rate,
        })),
        windows: result.windows.map((window) => ({
          window_index: window.window_index,
          train_case_count: window.train_case_count,
          test_case_count: window.test_case_count,
          train_range: [window.train_start_at, window.train_end_at],
          test_range: [window.test_start_at, window.test_end_at],
        })),
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
};

if (shouldUseOpsApi()) {
  const result = walkForwardReplayResponseSchema.parse(
    await requestOpsApi("POST", "/v1/metrics/replay/walk-forward", request),
  );
  printResult(result);
} else {
  const services = buildServices();

  try {
    const result = await runWalkForwardReplay(services.repository, request);
    printResult(result);
  } finally {
    await services.marketDataProvider.close?.();
    await services.embeddingProvider.close?.();
    await services.repository.close?.();
  }
}
