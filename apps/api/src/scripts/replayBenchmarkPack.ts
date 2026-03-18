import { benchmarkPackComposeRequestSchema } from "@finance-superbrain/schemas";

import { composeHistoricalBenchmarkPack } from "../lib/benchmarkPackComposer.js";
import { runHistoricalReplayBenchmark } from "../lib/historicalReplay.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();
const modelVersions = (process.env.REPLAY_MODEL_VERSIONS ?? "impact-engine-v0")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const casePackFilters = (process.env.REPLAY_BENCHMARK_CASE_PACK_FILTERS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!modelVersions.length) {
  throw new Error("Set REPLAY_MODEL_VERSIONS to one or more comma-separated model versions.");
}

try {
  const request = benchmarkPackComposeRequestSchema.parse({
    model_versions: modelVersions,
    benchmark_pack_id: process.env.REPLAY_BENCHMARK_PACK_ID?.trim() || "core_benchmark_v1",
    case_pack_filters: casePackFilters.length ? casePackFilters : undefined,
    strict_quotas: (process.env.REPLAY_BENCHMARK_STRICT ?? "true").toLowerCase() !== "false",
  });
  const composition = await composeHistoricalBenchmarkPack(services.repository, request);

  if (request.strict_quotas && !composition.quotas_met) {
    throw new Error(
      `Benchmark pack ${composition.pack_id} is incomplete: ${composition.missing_domains
        .map((item) => `${item.domain} (${item.selected_cases}/${item.minimum_cases})`)
        .join(", ")}`,
    );
  }

  const result = await runHistoricalReplayBenchmark(
    services.repository,
    composition.replay_request,
  );

  console.log(
    JSON.stringify(
      {
        pack_id: composition.pack_id,
        selected_case_count: composition.selected_case_count,
        quotas_met: composition.quotas_met,
        domain_counts: composition.domain_counts,
        leaders: result.leaders,
        models: result.models.map((model) => ({
          model_version: model.model_version,
          average_total_score: model.average_total_score,
          direction_accuracy: model.direction_accuracy,
          calibration_gap: model.calibration_gap,
          wrong_rate: model.wrong_rate,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await services.marketDataProvider.close?.();
  await services.embeddingProvider.close?.();
  await services.repository.close?.();
}
