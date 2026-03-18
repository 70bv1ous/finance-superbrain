import { benchmarkTrustRefreshRequestSchema } from "@finance-superbrain/schemas";
import type { BenchmarkTrustRefreshResponse } from "@finance-superbrain/schemas";

import { refreshBenchmarkTrust } from "../lib/benchmarkTrustRefresh.js";
import { requestOpsApi, shouldUseOpsApi } from "./httpOps.js";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";

const parseList = (value?: string) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

try {
  const request = benchmarkTrustRefreshRequestSchema.parse({
    benchmark_pack_id: process.env.REPLAY_BENCHMARK_PACK_ID?.trim() || "core_benchmark_v1",
    reviewer: process.env.HIGH_CONFIDENCE_REVIEWER ?? "core-corpus-seed",
    case_pack_filters: parseList(process.env.HIGH_CONFIDENCE_CASE_PACKS),
    prioritize_gap_regimes:
      (process.env.HIGH_CONFIDENCE_PRIORITIZE_GAP_REGIMES ?? "true").toLowerCase() === "true",
    target_regimes: parseList(process.env.HIGH_CONFIDENCE_TARGET_REGIMES),
    seed_limit: process.env.HIGH_CONFIDENCE_LIMIT
      ? Number(process.env.HIGH_CONFIDENCE_LIMIT)
      : undefined,
    min_candidate_score: process.env.HIGH_CONFIDENCE_MIN_SCORE
      ? Number(process.env.HIGH_CONFIDENCE_MIN_SCORE)
      : undefined,
    dry_run: (process.env.HIGH_CONFIDENCE_DRY_RUN ?? "false").toLowerCase() === "true",
    ingest_reviewed_memory:
      (process.env.HIGH_CONFIDENCE_INGEST_REVIEWED_MEMORY ?? "false").toLowerCase() ===
      "true",
    model_version:
      process.env.HIGH_CONFIDENCE_MODEL_VERSION ??
      "historical-library-high-confidence-v1",
    strict_quotas: (process.env.REPLAY_BENCHMARK_STRICT ?? "false").toLowerCase() === "true",
    case_pack_filters_for_benchmark: parseList(
      process.env.REPLAY_BENCHMARK_CASE_PACK_FILTERS,
    ),
  });

  if (shouldUseOpsApi()) {
    const result = await requestOpsApi<BenchmarkTrustRefreshResponse>(
      "POST",
      "/v1/operations/benchmark-trust-refresh",
      request,
    );
    console.log(JSON.stringify(result, null, 2));
  } else {
    const result = await runTrackedScriptOperation<BenchmarkTrustRefreshResponse>(
      {
        operation_name: "benchmark_trust_refresh",
        metadata: {
          benchmark_pack_id: request.benchmark_pack_id,
          dry_run: request.dry_run,
        },
        summarize: (response) => ({
          benchmark_pack_id: response.benchmark_pack_id,
          promoted_count: response.seed.promoted_count,
          warning_delta: response.delta.warning_count,
          high_confidence_delta: response.delta.high_confidence_cases,
          selected_case_count:
            response.benchmark_snapshot?.selected_case_count ?? response.after.selected_case_count,
        }),
      },
      (services) => refreshBenchmarkTrust(services, request),
    );
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  throw error;
}
