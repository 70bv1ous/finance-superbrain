import {
  promotionCycleRequestSchema,
  type PromotionCycleResponse,
} from "@finance-superbrain/schemas";

import { runPromotionCycle } from "../lib/runPromotionCycle.js";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";
const benchmarkCasePackFilters = (process.env.REPLAY_BENCHMARK_CASE_PACK_FILTERS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const request = promotionCycleRequestSchema.parse({
  case_pack: process.env.REPLAY_CASE_PACK?.trim() || "macro_plus_v1",
  benchmark_pack_id: process.env.REPLAY_BENCHMARK_PACK_ID?.trim() || undefined,
  benchmark_case_pack_filters: benchmarkCasePackFilters.length
    ? benchmarkCasePackFilters
    : undefined,
  benchmark_strict_quotas:
    (process.env.REPLAY_BENCHMARK_STRICT ?? "true").toLowerCase() !== "false",
  thresholds: {
    min_average_total_score_delta: Number(process.env.REPLAY_PROMOTION_MIN_SCORE_DELTA ?? 0.01),
    min_direction_accuracy_delta:
      Number(process.env.REPLAY_PROMOTION_MIN_DIRECTION_DELTA ?? 0),
    max_wrong_rate_delta: Number(process.env.REPLAY_PROMOTION_MAX_WRONG_RATE_DELTA ?? 0),
    min_calibration_alignment_delta:
      Number(process.env.REPLAY_PROMOTION_MIN_CALIBRATION_DELTA ?? 0),
  },
  promote_on_pass: (process.env.REPLAY_PROMOTION_APPLY ?? "true").toLowerCase() !== "false",
  promoted_status: (process.env.REPLAY_PROMOTION_STATUS ?? "active").trim() || "active",
  max_candidates: Number(process.env.REPLAY_PROMOTION_MAX_CANDIDATES ?? 10),
});

const result = await runTrackedScriptOperation<PromotionCycleResponse>(
  {
    operation_name: "promotion_cycle",
    metadata: {
      benchmark_pack_id: request.benchmark_pack_id ?? null,
      case_pack: request.case_pack,
      promote_on_pass: request.promote_on_pass,
    },
    summarize: (response) => ({
      processed: response.processed,
      passed: response.passed,
      failed: response.failed,
      candidate_count: response.candidates.length,
    }),
    status_from_result: (response) =>
      response.failed > 0 && response.passed > 0 ? "partial" : "success",
  },
  (services) => runPromotionCycle(services.repository, request),
);

console.log(
  JSON.stringify(
    {
      case_pack: result.case_pack,
      benchmark_pack_id: result.benchmark_pack_id,
      processed: result.processed,
      passed: result.passed,
      failed: result.failed,
      candidates: result.candidates,
      evaluations: result.evaluations.map((item) => ({
        candidate_model_version: item.candidate_model_version,
        baseline_model_version: item.baseline_model_version,
        passed: item.passed,
        deltas: item.deltas,
        saved_model: item.saved_model,
      })),
    },
    null,
    2,
  ),
);
