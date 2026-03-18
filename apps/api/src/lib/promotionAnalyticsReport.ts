import { promotionAnalyticsResponseSchema } from "@finance-superbrain/schemas";
import type {
  PromotionAnalyticsResponse,
  StoredModelVersion,
  StoredPromotionEvaluation,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

const round = (value: number) => Number(value.toFixed(2));

const average = (sum: number, count: number) => (count ? sum / count : 0);

const inferFamily = (modelVersion: string) =>
  modelVersion.replace(/-?v\d[\w-]*$/i, "") || modelVersion;

const bestFamily = (
  families: PromotionAnalyticsResponse["families"],
  selector: (family: PromotionAnalyticsResponse["families"][number]) => number,
) => {
  if (!families.length) {
    return null;
  }

  return [...families]
    .sort((left, right) => {
      const delta = selector(right) - selector(left);

      if (delta !== 0) {
        return delta;
      }

      if (right.evaluated_count !== left.evaluated_count) {
        return right.evaluated_count - left.evaluated_count;
      }

      return left.family.localeCompare(right.family);
    })[0]?.family ?? null;
};

const sortNewestFirst = (
  left: { created_at: string },
  right: { created_at: string },
) => right.created_at.localeCompare(left.created_at);

const resolveFamily = (
  evaluation: StoredPromotionEvaluation,
  modelRegistry: Map<string, StoredModelVersion>,
) =>
  evaluation.saved_model?.family ??
  modelRegistry.get(evaluation.candidate_model_version)?.family ??
  modelRegistry.get(evaluation.baseline_model_version)?.family ??
  inferFamily(evaluation.candidate_model_version);

const buildTrend = (evaluations: StoredPromotionEvaluation[]) => {
  const sorted = [...evaluations].sort(sortNewestFirst);
  const recentWindowSize = Math.max(1, Math.min(3, Math.floor(sorted.length / 2) || 1));
  const recent = sorted.slice(0, recentWindowSize);
  const prior = sorted.slice(recentWindowSize, recentWindowSize * 2);
  const recentPassRate = round(average(recent.filter((item) => item.passed).length, recent.length));

  if (!prior.length) {
    return {
      recent_window_size: recentWindowSize,
      recent_pass_rate: recentPassRate,
      prior_pass_rate: null,
      trend_delta: null,
      trend_signal: "insufficient_data" as const,
    };
  }

  const priorPassRate = round(average(prior.filter((item) => item.passed).length, prior.length));
  const trendDelta = round(recentPassRate - priorPassRate);

  return {
    recent_window_size: recentWindowSize,
    recent_pass_rate: recentPassRate,
    prior_pass_rate: priorPassRate,
    trend_delta: trendDelta,
    trend_signal:
      trendDelta > 0.05
        ? ("improving" as const)
        : trendDelta < -0.05
          ? ("declining" as const)
          : ("flat" as const),
  };
};

export const buildPromotionAnalyticsReport = async (
  repository: Repository,
): Promise<PromotionAnalyticsResponse> => {
  const [evaluations, models] = await Promise.all([
    repository.listPromotionEvaluations(500),
    repository.listModelVersions(),
  ]);
  const modelRegistry = new Map(models.map((model) => [model.model_version, model] as const));
  const grouped = new Map<string, StoredPromotionEvaluation[]>();

  for (const evaluation of evaluations) {
    const family = resolveFamily(evaluation, modelRegistry);
    const existing = grouped.get(family) ?? [];
    existing.push(evaluation);
    grouped.set(family, existing);
  }

  const families = [...grouped.entries()]
    .map(([family, familyEvaluations]) => {
      const sorted = [...familyEvaluations].sort(sortNewestFirst);
      const passedCount = familyEvaluations.filter((item) => item.passed).length;
      const failedCount = familyEvaluations.length - passedCount;
      const trend = buildTrend(familyEvaluations);
      const activeModel = [...models]
        .filter((model) => model.family === family && model.status === "active")
        .sort(sortNewestFirst)[0] ?? null;

      return {
        family,
        active_model_version: activeModel?.model_version ?? null,
        latest_candidate_model_version: sorted[0]?.candidate_model_version ?? null,
        latest_decision_at: sorted[0]?.created_at ?? null,
        evaluated_count: familyEvaluations.length,
        passed_count: passedCount,
        failed_count: failedCount,
        pass_rate: round(average(passedCount, familyEvaluations.length)),
        recent_window_size: trend.recent_window_size,
        recent_pass_rate: trend.recent_pass_rate,
        prior_pass_rate: trend.prior_pass_rate,
        trend_delta: trend.trend_delta,
        trend_signal: trend.trend_signal,
        average_total_score_delta: round(
          average(
            familyEvaluations.reduce((sum, item) => sum + item.deltas.average_total_score, 0),
            familyEvaluations.length,
          ),
        ),
        average_direction_accuracy_delta: round(
          average(
            familyEvaluations.reduce((sum, item) => sum + item.deltas.direction_accuracy, 0),
            familyEvaluations.length,
          ),
        ),
        average_wrong_rate_delta: round(
          average(
            familyEvaluations.reduce((sum, item) => sum + item.deltas.wrong_rate, 0),
            familyEvaluations.length,
          ),
        ),
        average_calibration_alignment_delta: round(
          average(
            familyEvaluations.reduce(
              (sum, item) => sum + item.deltas.calibration_alignment,
              0,
            ),
            familyEvaluations.length,
          ),
        ),
      };
    })
    .sort((left, right) => {
      if (right.pass_rate !== left.pass_rate) {
        return right.pass_rate - left.pass_rate;
      }

      if (right.average_calibration_alignment_delta !== left.average_calibration_alignment_delta) {
        return right.average_calibration_alignment_delta - left.average_calibration_alignment_delta;
      }

      return right.evaluated_count - left.evaluated_count;
    });

  return promotionAnalyticsResponseSchema.parse({
    generated_at: new Date().toISOString(),
    sample_count: evaluations.length,
    families,
    leaders: {
      by_pass_rate: bestFamily(families, (family) => family.pass_rate),
      by_trend_improvement: bestFamily(
        families,
        (family) => family.trend_delta ?? Number.NEGATIVE_INFINITY,
      ),
      by_calibration_alignment: bestFamily(
        families,
        (family) => family.average_calibration_alignment_delta,
      ),
      by_wrong_rate_reduction: bestFamily(
        families,
        (family) => family.average_wrong_rate_delta * -1,
      ),
    },
  });
};
