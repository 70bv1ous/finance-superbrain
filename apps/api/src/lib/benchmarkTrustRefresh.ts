import { randomUUID } from "node:crypto";

import {
  benchmarkTrustRefreshRecordSchema,
  benchmarkTrustRefreshResponseSchema,
} from "@finance-superbrain/schemas";
import type {
  BenchmarkTrustRefreshRecord,
  BenchmarkTrustRefreshRequest,
  BenchmarkTrustRefreshResponse,
  BenchmarkTrustRefreshSummary,
  DashboardBenchmarkResponse,
} from "@finance-superbrain/schemas";

import { captureBenchmarkReplaySnapshot } from "./benchmarkReplaySnapshot.js";
import { runCoreHighConfidenceSeed } from "./coreHighConfidenceSeed.js";
import { buildDashboardBenchmark } from "./dashboardBenchmark.js";
import type { AppServices } from "./services.js";

const toSummary = (
  benchmark: DashboardBenchmarkResponse,
): BenchmarkTrustRefreshSummary => ({
  high_confidence_cases: benchmark.coverage_summary.high_confidence_cases,
  reviewed_cases: benchmark.coverage_summary.reviewed_cases,
  needs_review_count: benchmark.coverage_summary.needs_review_count,
  selected_case_count: benchmark.pack_health.selected_case_count,
  quotas_met: benchmark.pack_health.quotas_met,
  warning_count: benchmark.warnings.length,
  high_warning_count: benchmark.warnings.filter((warning) => warning.severity === "high").length,
});

export const refreshBenchmarkTrust = async (
  services: AppServices,
  request: BenchmarkTrustRefreshRequest,
): Promise<BenchmarkTrustRefreshResponse> => {
  const beforeBenchmark = await buildDashboardBenchmark(services.repository, {
    benchmark_pack_id: request.benchmark_pack_id,
  });
  const seed = await runCoreHighConfidenceSeed(services, {
    benchmark_pack_id: request.benchmark_pack_id,
    reviewer: request.reviewer,
    case_pack_filters: request.case_pack_filters,
    prioritize_gap_regimes: request.prioritize_gap_regimes,
    prioritize_walk_forward_regimes: request.prioritize_walk_forward_regimes,
    target_regimes: request.target_regimes,
    limit: request.seed_limit,
    min_candidate_score: request.min_candidate_score,
    dry_run: request.dry_run,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    model_version: request.model_version,
  });
  const benchmarkSnapshot =
    request.dry_run
      ? null
      : await captureBenchmarkReplaySnapshot(services.repository, {
          benchmark_pack_id: request.benchmark_pack_id,
          case_pack_filters: request.case_pack_filters_for_benchmark,
          strict_quotas: request.strict_quotas,
          allowed_case_qualities: ["reviewed", "high_confidence"],
        }).catch((error) => {
          if (
            error instanceof Error &&
            (error.message.includes("Benchmark pack") ||
              error.message.includes("No active model families") ||
              error.message.includes("No historical library cases") ||
              error.message.includes("benchmark composer could not find"))
          ) {
            return null;
          }

          throw error;
        });
  const afterBenchmark = await buildDashboardBenchmark(services.repository, {
    benchmark_pack_id: request.benchmark_pack_id,
  });
  const before = toSummary(beforeBenchmark);
  const after = toSummary(afterBenchmark);

  const response = benchmarkTrustRefreshResponseSchema.parse({
    generated_at: new Date().toISOString(),
    benchmark_pack_id: request.benchmark_pack_id,
    seed,
    before,
    after,
    delta: {
      high_confidence_cases: after.high_confidence_cases - before.high_confidence_cases,
      warning_count: after.warning_count - before.warning_count,
      high_warning_count: after.high_warning_count - before.high_warning_count,
      selected_case_count: after.selected_case_count - before.selected_case_count,
    },
    benchmark_snapshot: benchmarkSnapshot,
  });

  const record: BenchmarkTrustRefreshRecord = benchmarkTrustRefreshRecordSchema.parse({
    id: randomUUID(),
    generated_at: response.generated_at,
    benchmark_pack_id: response.benchmark_pack_id,
    seed: response.seed,
    before: response.before,
    after: response.after,
    delta: response.delta,
    benchmark_snapshot_id: response.benchmark_snapshot?.id ?? null,
    benchmark_snapshot_case_count: response.benchmark_snapshot?.selected_case_count ?? null,
    benchmark_snapshot_family_count: response.benchmark_snapshot?.family_count ?? null,
    created_at: response.generated_at,
  });
  await services.repository.saveBenchmarkTrustRefresh(record);

  return response;
};
