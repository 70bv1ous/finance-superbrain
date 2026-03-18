import {
  moltCycleRequestSchema,
  type MoltCycleResponse,
} from "@finance-superbrain/schemas";

import { runMoltCycle } from "../lib/runMoltCycle.js";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";

const request = moltCycleRequestSchema.parse({
  case_pack: process.env.REPLAY_CASE_PACK?.trim() || "macro_plus_v1",
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
  max_families: Number(process.env.MOLT_MAX_FAMILIES ?? 10),
  min_family_pass_rate: Number(process.env.MOLT_MIN_FAMILY_PASS_RATE ?? 0.65),
  score_floor: Number(process.env.MOLT_SCORE_FLOOR ?? 0.68),
  max_abs_calibration_gap: Number(process.env.MOLT_MAX_ABS_CALIBRATION_GAP ?? 0.12),
  trigger_on_declining_trend: (process.env.MOLT_TRIGGER_ON_DECLINING_TREND ?? "true")
    .toLowerCase() !== "false",
  require_pattern_priors: (process.env.MOLT_REQUIRE_PATTERN_PRIORS ?? "true")
    .toLowerCase() !== "false",
  label_suffix: process.env.MOLT_LABEL_SUFFIX?.trim() || "Molted",
});

const result = await runTrackedScriptOperation<MoltCycleResponse>(
  {
    operation_name: "molt_cycle",
    metadata: {
      benchmark_pack_id: request.benchmark_pack_id ?? null,
      case_pack: request.case_pack,
    },
    summarize: (response) => ({
      generated: response.generated,
      hardened: response.hardened,
      held: response.held,
      skipped: response.skipped,
      item_count: response.items.length,
    }),
    status_from_result: (response) =>
      response.held > 0 && response.hardened > 0 ? "partial" : "success",
  },
  (services) => runMoltCycle(services.repository, request),
);

console.log(
  JSON.stringify(
    {
      case_pack: result.case_pack,
      considered: result.considered,
      triggered: result.triggered,
      generated: result.generated,
      hardened: result.hardened,
      held: result.held,
      skipped: result.skipped,
      items: result.items.map((item) => ({
        family: item.family,
        baseline_model_version: item.baseline_model_version,
        target_model_version: item.target_model_version,
        status: item.status,
        trigger_reasons: item.trigger_reasons,
        applied_pattern_priors:
          item.applied_pattern_priors?.selected_patterns.map((pattern) => pattern.pattern_key) ??
          [],
        promotion_passed: item.promotion_evaluation?.passed ?? null,
      })),
    },
    null,
    2,
  ),
);
