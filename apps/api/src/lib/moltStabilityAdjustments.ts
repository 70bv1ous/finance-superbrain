import type {
  BenchmarkStabilityReport,
  MoltCycleRequest,
  MoltCycleResponse,
} from "@finance-superbrain/schemas";

import { buildBenchmarkStabilityReport } from "./benchmarkStabilityReport.js";
import type { Repository } from "./repository.types.js";

const round = (value: number) => Number(value.toFixed(2));

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

type MoltStabilityAdjustment = NonNullable<
  MoltCycleResponse["items"][number]["stability_adjustment"]
>;

const withDefaultRationale = (
  family: BenchmarkStabilityReport["families"][number] | undefined,
) => {
  if (!family) {
    return ["No benchmark stability history exists for this family yet, so neutral molt thresholds stayed in place."];
  }

  return [
    `Weekly benchmark stability marks this family as ${family.current_signal}.`,
    `Stability score ${family.stability_score} and resilience ${family.resilience_score} were used to shape shell-growth bias.`,
  ];
};

const buildNeutralAdjustment = (
  request: MoltCycleRequest,
  family?: BenchmarkStabilityReport["families"][number],
): MoltStabilityAdjustment => ({
  benchmark_pack_id: request.benchmark_pack_id,
  signal: family?.current_signal ?? null,
  stability_score: family?.stability_score ?? null,
  resilience_score: family?.resilience_score ?? null,
  trigger_bias: "neutral",
  promotion_bias: "neutral",
  effective_trigger_thresholds: {
    min_family_pass_rate: request.min_family_pass_rate,
    score_floor: request.score_floor,
    max_abs_calibration_gap: request.max_abs_calibration_gap,
    trigger_on_declining_trend: request.trigger_on_declining_trend,
  },
  effective_promotion_thresholds: {
    ...request.thresholds,
  },
  rationale: withDefaultRationale(family),
});

const buildFragileAdjustment = (
  request: MoltCycleRequest,
  family: BenchmarkStabilityReport["families"][number],
): MoltStabilityAdjustment => {
  const fragilityBoost = family.stability_score <= 0.45 ? 0.02 : 0;

  return {
    benchmark_pack_id: request.benchmark_pack_id,
    signal: family.current_signal,
    stability_score: family.stability_score,
    resilience_score: family.resilience_score,
    trigger_bias: "accelerated",
    promotion_bias: "neutral",
    effective_trigger_thresholds: {
      min_family_pass_rate: round(clamp(request.min_family_pass_rate + 0.05 + fragilityBoost)),
      score_floor: round(clamp(request.score_floor + 0.03 + fragilityBoost)),
      max_abs_calibration_gap: round(
        clamp(request.max_abs_calibration_gap - 0.02 - fragilityBoost, 0.02, 1),
      ),
      trigger_on_declining_trend: true,
    },
    effective_promotion_thresholds: {
      ...request.thresholds,
    },
    rationale: [
      ...withDefaultRationale(family),
      "Fragile families are allowed to feel growth pressure earlier so shell reviews start before weakness compounds.",
    ],
  };
};

const buildDurableAdjustment = (
  request: MoltCycleRequest,
  family: BenchmarkStabilityReport["families"][number],
): MoltStabilityAdjustment => {
  const durabilityBoost = family.stability_score >= 0.82 ? 0.01 : 0;

  return {
    benchmark_pack_id: request.benchmark_pack_id,
    signal: family.current_signal,
    stability_score: family.stability_score,
    resilience_score: family.resilience_score,
    trigger_bias: "guarded",
    promotion_bias: "stricter",
    effective_trigger_thresholds: {
      min_family_pass_rate: round(clamp(request.min_family_pass_rate - 0.04)),
      score_floor: round(clamp(request.score_floor - 0.03)),
      max_abs_calibration_gap: round(clamp(request.max_abs_calibration_gap + 0.02)),
      trigger_on_declining_trend: request.trigger_on_declining_trend,
    },
    effective_promotion_thresholds: {
      min_average_total_score_delta: round(
        request.thresholds.min_average_total_score_delta + 0.02 + durabilityBoost,
      ),
      min_direction_accuracy_delta: round(
        request.thresholds.min_direction_accuracy_delta + 0.02,
      ),
      max_wrong_rate_delta: round(request.thresholds.max_wrong_rate_delta - 0.02),
      min_calibration_alignment_delta: round(
        request.thresholds.min_calibration_alignment_delta + 0.02 + durabilityBoost,
      ),
    },
    rationale: [
      ...withDefaultRationale(family),
      "Durable families keep more trust in the current shell, so new shells need clearer replay improvement before they harden.",
    ],
  };
};

export const buildMoltStabilityAdjustmentMap = async (
  repository: Repository,
  request: MoltCycleRequest,
) => {
  if (!request.apply_stability_bias) {
    return new Map<string, MoltStabilityAdjustment>();
  }

  const report = await buildBenchmarkStabilityReport(repository, {
    benchmark_pack_id: request.benchmark_pack_id,
    limit: 24,
  });

  return new Map(
    report.families.map((family) => {
      const adjustment =
        family.current_signal === "fragile"
          ? buildFragileAdjustment(request, family)
          : family.current_signal === "durable"
            ? buildDurableAdjustment(request, family)
            : buildNeutralAdjustment(request, family);

      return [family.family, adjustment] as const;
    }),
  );
};

export const resolveMoltStabilityAdjustment = (
  request: MoltCycleRequest,
  adjustments: Map<string, MoltStabilityAdjustment>,
  family: string,
): MoltStabilityAdjustment => adjustments.get(family) ?? buildNeutralAdjustment(request);
