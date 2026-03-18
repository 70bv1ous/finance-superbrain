import { replayPatternPriorSetSchema } from "@finance-superbrain/schemas";
import type {
  PromotionPatternAnalyticsResponse,
  ReplayPatternPriorSet,
} from "@finance-superbrain/schemas";

import { buildPromotionPatternAnalyticsReport } from "./promotionPatternAnalyticsReport.js";
import type { Repository } from "./repository.types.js";

const CATEGORY_LIMITS: Record<string, number> = {
  strategy_profile: 1,
  confidence_bias: 1,
  conviction_bias: 1,
  confidence_cap: 1,
  magnitude_multiplier: 1,
  focus_theme: 2,
  caution_theme: 2,
  preferred_asset: 3,
};

const round = (value: number) => Number(value.toFixed(4));

const inferModelFamily = (modelVersion: string) =>
  modelVersion.replace(/-replay-tuned(?:-[\w-]+)?$/i, "").replace(/-?v\d[\w-]*$/i, "") ||
  modelVersion;

const splitPatternKey = (patternKey: string) => {
  const [category, ...rest] = patternKey.split(":");
  return {
    category,
    value: rest.join(":").trim(),
  };
};

const mapConfidenceBias = (value: string) => {
  if (value === "negative") {
    return -0.05;
  }

  if (value === "positive") {
    return 0.04;
  }

  return 0;
};

const mapConvictionBias = (value: string) => {
  if (value === "negative") {
    return -0.04;
  }

  if (value === "positive") {
    return 0.02;
  }

  return 0;
};

const mapConfidenceCap = (value: string) => {
  if (value === "tight") {
    return 0.84;
  }

  if (value === "moderate") {
    return 0.9;
  }

  return 0.92;
};

const mapMagnitudeMultiplier = (value: string) => {
  if (value === "downscaled") {
    return 0.92;
  }

  if (value === "upscaled") {
    return 1.08;
  }

  return 1;
};

const isEligiblePattern = (
  pattern: PromotionPatternAnalyticsResponse["patterns"][number],
) => {
  if (pattern.pass_rate < 0.6) {
    return false;
  }

  if (pattern.sample_count >= 2 && pattern.trend_signal === "declining") {
    return false;
  }

  return (
    pattern.average_total_score_delta > 0 ||
    pattern.average_direction_accuracy_delta > 0 ||
    pattern.average_calibration_alignment_delta > 0 ||
    pattern.average_wrong_rate_delta < 0
  );
};

const scorePattern = (
  pattern: PromotionPatternAnalyticsResponse["patterns"][number],
  scope: "family" | "global",
) =>
  round(
    pattern.pass_rate * 0.52 +
      Math.min(pattern.sample_count, 5) / 5 * 0.14 +
      Math.max(pattern.average_calibration_alignment_delta, 0) * 0.14 +
      Math.max(pattern.average_direction_accuracy_delta, 0) * 0.08 +
      Math.max(pattern.average_total_score_delta, 0) * 0.06 +
      Math.max(pattern.average_wrong_rate_delta * -1, 0) * 0.16 +
      Math.max(pattern.trend_delta ?? 0, 0) * 0.04 +
      (scope === "family" ? 0.05 : 0),
  );

const uniqueValues = (values: string[]) =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

export const buildReplayPatternPriorSet = async (
  repository: Repository,
  sourceModelVersion: string,
): Promise<ReplayPatternPriorSet | null> => {
  const sourceModel = await repository.getModelVersion(sourceModelVersion);
  const sourceFamily = sourceModel?.family ?? inferModelFamily(sourceModelVersion);
  const report = await buildPromotionPatternAnalyticsReport(repository);

  if (!report.sample_count) {
    return null;
  }

  const eligible = report.patterns.filter(isEligiblePattern);

  if (!eligible.length) {
    return null;
  }

  const selectedPatterns: ReplayPatternPriorSet["selected_patterns"] = [];

  for (const [category, limit] of Object.entries(CATEGORY_LIMITS)) {
    const familyPatterns = eligible
      .filter((pattern) => pattern.category === category && pattern.families.includes(sourceFamily))
      .sort((left, right) => scorePattern(right, "family") - scorePattern(left, "family"));
    const globalPatterns = eligible
      .filter((pattern) => pattern.category === category)
      .sort((left, right) => scorePattern(right, "global") - scorePattern(left, "global"));
    const pool = familyPatterns.length ? familyPatterns : globalPatterns;
    const scope: "family" | "global" = familyPatterns.length ? "family" : "global";

    for (const pattern of pool.slice(0, limit)) {
      selectedPatterns.push({
        pattern_key: pattern.pattern_key,
        category: pattern.category,
        label: pattern.label,
        scope,
        sample_count: pattern.sample_count,
        pass_rate: pattern.pass_rate,
        trend_signal: pattern.trend_signal,
        average_total_score_delta: pattern.average_total_score_delta,
        average_direction_accuracy_delta: pattern.average_direction_accuracy_delta,
        average_wrong_rate_delta: pattern.average_wrong_rate_delta,
        average_calibration_alignment_delta: pattern.average_calibration_alignment_delta,
      });
    }
  }

  const dedupedPatterns = [
    ...new Map(selectedPatterns.map((pattern) => [pattern.pattern_key, pattern])).values(),
  ];

  if (!dedupedPatterns.length) {
    return null;
  }

  const featureFlagsPatch: Record<string, string | number | boolean> = {};
  const focusThemes: string[] = [];
  const cautionThemes: string[] = [];
  const preferredAssets: string[] = [];

  for (const pattern of dedupedPatterns) {
    const { value } = splitPatternKey(pattern.pattern_key);

    if (!value) {
      continue;
    }

    switch (pattern.category) {
      case "strategy_profile":
        featureFlagsPatch.strategy_profile = value;
        break;
      case "confidence_bias":
        featureFlagsPatch.confidence_bias = mapConfidenceBias(value);
        break;
      case "conviction_bias":
        featureFlagsPatch.conviction_bias = mapConvictionBias(value);
        break;
      case "confidence_cap":
        featureFlagsPatch.confidence_cap = mapConfidenceCap(value);
        break;
      case "magnitude_multiplier":
        featureFlagsPatch.magnitude_multiplier = mapMagnitudeMultiplier(value);
        break;
      case "focus_theme":
        focusThemes.push(value);
        break;
      case "caution_theme":
        cautionThemes.push(value);
        break;
      case "preferred_asset":
        preferredAssets.push(value);
        break;
      default:
        break;
    }
  }

  if (focusThemes.length) {
    featureFlagsPatch.focus_themes = uniqueValues(focusThemes).join(",");
  }

  if (cautionThemes.length) {
    featureFlagsPatch.caution_themes = uniqueValues(cautionThemes).join(",");
  }

  if (preferredAssets.length) {
    featureFlagsPatch.preferred_assets = uniqueValues(preferredAssets).join(",");
  }

  const scopes = new Set(dedupedPatterns.map((pattern) => pattern.scope));
  const sourceScope =
    scopes.size === 1
      ? dedupedPatterns[0]!.scope
      : ("mixed" as const);
  const topPatterns = dedupedPatterns.slice(0, 4).map((pattern) => pattern.pattern_key);
  const rationale = [
    `Reuse ${dedupedPatterns.length} successful promotion patterns as priors for ${sourceFamily}.`,
    `Source scope: ${sourceScope} promotion history across ${report.sample_count} evaluations.`,
    `Top prior patterns: ${topPatterns.join(", ")}.`,
  ];

  return replayPatternPriorSetSchema.parse({
    family: sourceFamily,
    source_scope: sourceScope,
    promotion_sample_count: report.sample_count,
    selected_patterns: dedupedPatterns,
    feature_flags_patch: featureFlagsPatch,
    rationale,
  });
};
