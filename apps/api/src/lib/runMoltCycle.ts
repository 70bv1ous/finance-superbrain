import { moltCycleResponseSchema } from "@finance-superbrain/schemas";
import type {
  CreateModelVersionRequest,
  MoltCycleRequest,
  MoltCycleResponse,
  StoredModelVersion,
} from "@finance-superbrain/schemas";

import { buildHistoricalReplayPack } from "../data/historicalBackfillCases.js";

import { applyHistoricalReplayTuning } from "./applyHistoricalReplayTuning.js";
import { evaluateReplayPromotion } from "./evaluateReplayPromotion.js";
import { buildModelComparisonReport } from "./modelComparisonReport.js";
import {
  buildMoltStabilityAdjustmentMap,
  resolveMoltStabilityAdjustment,
} from "./moltStabilityAdjustments.js";
import { buildPromotionAnalyticsReport } from "./promotionAnalyticsReport.js";
import { buildReplayPatternPriorSet } from "./replayPatternPriors.js";
import type { Repository } from "./repository.types.js";

const truncate = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : value.slice(0, maxLength);

const sortNewestFirst = (left: { created_at: string }, right: { created_at: string }) =>
  right.created_at.localeCompare(left.created_at);

const discoverActiveBaselines = (models: StoredModelVersion[], maxFamilies: number) => {
  const activeByFamily = new Map<string, StoredModelVersion>();

  for (const model of [...models].sort(sortNewestFirst)) {
    if (model.status === "active" && !activeByFamily.has(model.family)) {
      activeByFamily.set(model.family, model);
    }
  }

  return [...activeByFamily.values()].slice(0, maxFamilies);
};

const buildTriggerReasons = (
  familyMetric:
    | Awaited<ReturnType<typeof buildPromotionAnalyticsReport>>["families"][number]
    | undefined,
  modelMetric: Awaited<ReturnType<typeof buildModelComparisonReport>>["versions"][number] | undefined,
  thresholds: {
    min_family_pass_rate: number;
    score_floor: number;
    max_abs_calibration_gap: number;
    trigger_on_declining_trend: boolean;
  },
) => {
  const reasons: string[] = [];

  if (
    familyMetric &&
    familyMetric.evaluated_count > 0 &&
    familyMetric.pass_rate < thresholds.min_family_pass_rate
  ) {
    reasons.push(
      `family pass rate ${familyMetric.pass_rate} is below the molt threshold ${thresholds.min_family_pass_rate}`,
    );
  }

  if (
    thresholds.trigger_on_declining_trend &&
    familyMetric &&
    familyMetric.evaluated_count > 1 &&
    familyMetric.trend_signal === "declining"
  ) {
    reasons.push("family promotion trend is declining");
  }

  if (
    modelMetric &&
    modelMetric.sample_count > 0 &&
    modelMetric.average_total_score < thresholds.score_floor
  ) {
    reasons.push(
      `average total score ${modelMetric.average_total_score} is below the shell-growth floor ${thresholds.score_floor}`,
    );
  }

  if (
    modelMetric &&
    modelMetric.sample_count > 0 &&
    Math.abs(modelMetric.calibration_gap) > thresholds.max_abs_calibration_gap
  ) {
    reasons.push(
      `absolute calibration gap ${Math.abs(modelMetric.calibration_gap).toFixed(2)} exceeds the molt threshold ${thresholds.max_abs_calibration_gap}`,
    );
  }

  return reasons;
};

const buildTargetModelVersion = (
  baselineModelVersion: string,
  existingModels: StoredModelVersion[],
) => {
  const base = baselineModelVersion.replace(/-molt-\d+$/i, "");
  const prefix = `${base}-molt-`;
  const sequence =
    existingModels
      .filter((model) => model.model_version.startsWith(prefix))
      .map((model) => Number(model.model_version.slice(prefix.length)))
      .filter((value) => Number.isInteger(value) && value > 0)
      .reduce((max, value) => Math.max(max, value), 0) + 1;

  return truncate(`${base}-molt-${sequence}`, 80);
};

const withMoltMetadata = (
  model: StoredModelVersion,
  triggerReasons: string[],
  casePack: string,
  priorCount: number,
  stabilityAdjustment: NonNullable<MoltCycleResponse["items"][number]["stability_adjustment"]>,
): CreateModelVersionRequest => {
  const notedDescription = truncate(
    [
      model.description,
      `Molted from ${model.feature_flags.replay_tuned_from ?? model.model_version} on ${casePack}.`,
    ]
      .filter(Boolean)
      .join(" "),
    1000,
  );

  return {
    model_version: model.model_version,
    family: model.family,
    label: model.label,
    description: notedDescription || undefined,
    owner: model.owner,
    prompt_profile: model.prompt_profile,
    status: model.status,
    feature_flags: {
      ...model.feature_flags,
      molt_from:
        typeof model.feature_flags.replay_tuned_from === "string"
          ? model.feature_flags.replay_tuned_from
          : model.model_version,
      molt_triggered_at: new Date().toISOString(),
      molt_case_pack: casePack,
      molt_trigger_reasons: triggerReasons.join(" | "),
      molt_prior_pattern_count: priorCount,
      molt_cycle_status: "generated",
      molt_benchmark_pack: stabilityAdjustment.benchmark_pack_id,
      molt_stability_signal: stabilityAdjustment.signal ?? "unknown",
      molt_stability_score:
        stabilityAdjustment.stability_score === null
          ? "unknown"
          : stabilityAdjustment.stability_score,
      molt_trigger_bias: stabilityAdjustment.trigger_bias,
      molt_promotion_bias: stabilityAdjustment.promotion_bias,
    },
  };
};

const annotateMoltDecision = (
  model: StoredModelVersion,
  decision: "hardened" | "held",
): CreateModelVersionRequest => ({
  model_version: model.model_version,
  family: model.family,
  label: model.label,
  description: model.description,
  owner: model.owner,
  prompt_profile: model.prompt_profile,
  status: model.status,
  feature_flags: {
    ...model.feature_flags,
    molt_last_decision: decision,
    molt_evaluated_at: new Date().toISOString(),
    molt_cycle_status: decision,
  },
});

export const runMoltCycle = async (
  repository: Repository,
  request: MoltCycleRequest,
): Promise<MoltCycleResponse> => {
  const [models, promotionAnalytics, comparisonReport, stabilityAdjustments] = await Promise.all([
    repository.listModelVersions(),
    buildPromotionAnalyticsReport(repository),
    buildModelComparisonReport(repository),
    buildMoltStabilityAdjustmentMap(repository, request),
  ]);
  const familyAnalytics = new Map(
    promotionAnalytics.families.map((family) => [family.family, family] as const),
  );
  const versionMetrics = new Map(
    comparisonReport.versions.map((version) => [version.model_version, version] as const),
  );
  const baselines = discoverActiveBaselines(models, request.max_families);
  const items: MoltCycleResponse["items"] = [];

  for (const baseline of baselines) {
    const familyMetric = familyAnalytics.get(baseline.family);
    const modelMetric = versionMetrics.get(baseline.model_version);
    const stabilityAdjustment = resolveMoltStabilityAdjustment(
      request,
      stabilityAdjustments,
      baseline.family,
    );
    const triggerReasons = buildTriggerReasons(
      familyMetric,
      modelMetric,
      stabilityAdjustment.effective_trigger_thresholds,
    );

    if (!triggerReasons.length) {
      items.push({
        family: baseline.family,
        baseline_model_version: baseline.model_version,
        target_model_version: null,
        trigger_reasons: [],
        status: "skipped",
        skip_reason: "growth thresholds were not met",
        stability_adjustment: stabilityAdjustment,
        applied_pattern_priors: null,
        saved_model: null,
        promotion_evaluation: null,
      });
      continue;
    }

    const patternPriors = await buildReplayPatternPriorSet(repository, baseline.model_version);

    if (request.require_pattern_priors && !patternPriors) {
      items.push({
        family: baseline.family,
        baseline_model_version: baseline.model_version,
        target_model_version: null,
        trigger_reasons: triggerReasons,
        status: "skipped",
        skip_reason: "pattern priors are required for molting but none are available yet",
        stability_adjustment: stabilityAdjustment,
        applied_pattern_priors: null,
        saved_model: null,
        promotion_evaluation: null,
      });
      continue;
    }

    const targetModelVersion = buildTargetModelVersion(baseline.model_version, models);
    const tuningResult = await applyHistoricalReplayTuning(repository, baseline.model_version, {
      cases: buildHistoricalReplayPack([baseline.model_version], request.case_pack).cases,
      target_model_version: targetModelVersion,
      label_suffix: request.label_suffix,
      status: "experimental",
      use_pattern_priors: request.require_pattern_priors || Boolean(patternPriors),
    });
    const generatedModel = await repository.saveModelVersion(
      withMoltMetadata(
        tuningResult.saved_model,
        triggerReasons,
        request.case_pack,
        tuningResult.applied_pattern_priors?.selected_patterns.length ?? 0,
        stabilityAdjustment,
      ),
    );
    const promotionEvaluation = await evaluateReplayPromotion(repository, targetModelVersion, {
      baseline_model_version: baseline.model_version,
      cases: buildHistoricalReplayPack(
        [baseline.model_version, targetModelVersion],
        request.case_pack,
      ).cases,
      benchmark_allowed_case_qualities: ["reviewed", "high_confidence"],
      benchmark_strict_quotas: false,
      thresholds: stabilityAdjustment.effective_promotion_thresholds,
      walk_forward: request.walk_forward,
      promote_on_pass: request.promote_on_pass,
      promoted_status: request.promoted_status,
    });
    const decision = promotionEvaluation.passed && request.promote_on_pass ? "hardened" : "held";
    const registryModel =
      promotionEvaluation.saved_model ??
      (await repository.getModelVersion(targetModelVersion)) ??
      generatedModel;
    const finalizedModel = await repository.saveModelVersion(
      annotateMoltDecision(registryModel, decision),
    );

    items.push({
      family: baseline.family,
      baseline_model_version: baseline.model_version,
      target_model_version: targetModelVersion,
      trigger_reasons: triggerReasons,
      status: decision,
      skip_reason: null,
      stability_adjustment: stabilityAdjustment,
      applied_pattern_priors: tuningResult.applied_pattern_priors,
      saved_model: finalizedModel,
      promotion_evaluation: promotionEvaluation,
    });
  }

  return moltCycleResponseSchema.parse({
    case_pack: request.case_pack,
    benchmark_pack_id: request.apply_stability_bias ? request.benchmark_pack_id : null,
    stability_applied: request.apply_stability_bias,
    considered: baselines.length,
    triggered: items.filter((item) => item.trigger_reasons.length > 0).length,
    generated: items.filter((item) => item.target_model_version !== null).length,
    hardened: items.filter((item) => item.status === "hardened").length,
    held: items.filter((item) => item.status === "held").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    items,
  });
};
