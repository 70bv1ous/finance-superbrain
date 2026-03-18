import { historicalReplayDiagnosticsResponseSchema } from "@finance-superbrain/schemas";
import type {
  HistoricalReplayDiagnosticsResponse,
  ReplayPatternPriorSet,
  HistoricalReplayRequest,
  HistoricalReplayResponse,
} from "@finance-superbrain/schemas";

import { resolvePredictionStrategyProfile } from "./modelStrategyProfiles.js";
import type { Repository } from "./repository.types.js";
import { runHistoricalReplayBenchmark } from "./historicalReplay.js";

type ReplayCaseResult = HistoricalReplayResponse["cases"][number];
type ReplayModelMetric = HistoricalReplayResponse["models"][number];
type SliceDiagnostic = HistoricalReplayDiagnosticsResponse["models"][number]["weakest_themes"][number];
type ReplayStrategyProfile = HistoricalReplayDiagnosticsResponse["models"][number]["profile"];

type SliceAccumulator = {
  count: number;
  totalScoreSum: number;
  directionSum: number;
  confidenceSum: number;
  wrongCount: number;
  failureCounts: Map<ReplayCaseResult["failure_tags"][number], number>;
};

const round = (value: number) => Number(value.toFixed(2));

const average = (sum: number, count: number) => (count ? sum / count : 0);

const parseNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const parseCsv = (value: unknown) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const VALID_REPLAY_PROFILES = new Set<ReplayStrategyProfile>([
  "baseline",
  "macro_dovish_sensitive",
  "policy_shock_sensitive",
  "contrarian_regime_aware",
]);

const parseReplayProfile = (value: unknown): ReplayStrategyProfile | null =>
  typeof value === "string" && VALID_REPLAY_PROFILES.has(value as ReplayStrategyProfile)
    ? (value as ReplayStrategyProfile)
    : null;

const defaultConfidenceCap = (
  profile: HistoricalReplayDiagnosticsResponse["models"][number]["profile"],
) => (profile === "contrarian_regime_aware" ? 0.82 : 0.92);

const ensureSliceAccumulator = (
  map: Map<string, SliceAccumulator>,
  key: string,
) => {
  const existing = map.get(key);

  if (existing) {
    return existing;
  }

  const created: SliceAccumulator = {
    count: 0,
    totalScoreSum: 0,
    directionSum: 0,
    confidenceSum: 0,
    wrongCount: 0,
    failureCounts: new Map(),
  };

  map.set(key, created);
  return created;
};

const updateSliceAccumulator = (
  accumulator: SliceAccumulator,
  result: ReplayCaseResult,
) => {
  accumulator.count += 1;
  accumulator.totalScoreSum += result.total_score;
  accumulator.directionSum += result.direction_score;
  accumulator.confidenceSum += result.confidence;

  if (result.verdict === "wrong") {
    accumulator.wrongCount += 1;
  }

  for (const failureTag of result.failure_tags) {
    accumulator.failureCounts.set(failureTag, (accumulator.failureCounts.get(failureTag) ?? 0) + 1);
  }
};

const toSliceDiagnostics = (map: Map<string, SliceAccumulator>, limit = 5): SliceDiagnostic[] =>
  [...map.entries()]
    .map(([key, value]) => ({
      key,
      sample_count: value.count,
      average_total_score: round(average(value.totalScoreSum, value.count)),
      direction_accuracy: round(average(value.directionSum, value.count)),
      average_confidence: round(average(value.confidenceSum, value.count)),
      wrong_rate: round(average(value.wrongCount, value.count)),
      dominant_failure_tags: [...value.failureCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([tag]) => tag),
    }))
    .sort((left, right) => {
      if (left.average_total_score !== right.average_total_score) {
        return left.average_total_score - right.average_total_score;
      }

      if (right.wrong_rate !== left.wrong_rate) {
        return right.wrong_rate - left.wrong_rate;
      }

      return right.sample_count - left.sample_count;
    })
    .slice(0, limit);

const buildFailureTagStats = (results: ReplayCaseResult[]) => {
  const counts = new Map<ReplayCaseResult["failure_tags"][number], number>();

  for (const result of results) {
    for (const tag of result.failure_tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({
      tag,
      count,
      rate: round(average(count, results.length || 1)),
    }))
    .sort((left, right) => right.count - left.count);
};

const PREFERRED_ASSET_HINTS: Record<string, string[]> = {
  rates: ["TLT", "QQQ", "DXY"],
  central_bank: ["TLT", "QQQ", "DXY"],
  inflation: ["TLT", "QQQ", "GLD"],
  trade_policy: ["KWEB", "BABA", "USD/CNH"],
  china_risk: ["KWEB", "BABA", "USD/CNH"],
  stimulus: ["SPY", "QQQ", "KWEB"],
  energy: ["XLE", "USO", "XOM"],
  defense: ["ITA", "LMT", "RTX"],
  ai_and_semis: ["NVDA", "SOXX", "SMH"],
};

type ReplayDiagnosticsOptions = {
  patternPriors?: ReplayPatternPriorSet | null;
};

const buildRecommendedTuning = async (
  repository: Repository,
  modelVersion: string,
  metric: ReplayModelMetric,
  modelCases: ReplayCaseResult[],
  weakestThemes: SliceDiagnostic[],
  frequentFailureTags: HistoricalReplayDiagnosticsResponse["models"][number]["frequent_failure_tags"],
  patternPriors?: ReplayPatternPriorSet | null,
) => {
  const strategy = await resolvePredictionStrategyProfile(repository, modelVersion);
  const priorPatch = patternPriors?.feature_flags_patch ?? {};
  const effectiveProfile = parseReplayProfile(priorPatch.strategy_profile) ?? strategy.profile;
  const overconfidenceRate =
    frequentFailureTags.find((item) => item.tag === "overconfidence")?.rate ?? 0;
  const underconfidenceRate =
    frequentFailureTags.find((item) => item.tag === "underconfidence")?.rate ?? 0;
  const wrongDirectionRate =
    frequentFailureTags.find((item) => item.tag === "wrong_direction")?.rate ?? 0;
  const avgMagnitudeScore = average(
    modelCases.reduce((sum, item) => sum + item.magnitude_score, 0),
    modelCases.length,
  );
  const priorFocusThemes = parseCsv(priorPatch.focus_themes);
  const priorCautionThemes = parseCsv(priorPatch.caution_themes);
  const priorPreferredAssets = parseCsv(priorPatch.preferred_assets);
  const focusThemes = Array.from(
    new Set(
      [
        ...strategy.tuning.focus_themes,
        ...priorFocusThemes,
        ...metric.by_theme
          .filter((item) => !item.key.startsWith("tag:"))
          .filter((item) => item.sample_count >= 2 && item.average_total_score >= metric.average_total_score)
          .slice(0, 3)
          .map((item) => item.key),
      ].filter(Boolean),
    ),
  ).slice(0, 5);
  const cautionThemes = Array.from(
    new Set(
      [
        ...strategy.tuning.caution_themes,
        ...priorCautionThemes,
        ...weakestThemes
          .filter((item) => item.average_total_score <= 0.58 || item.wrong_rate >= 0.45)
          .map((item) => item.key),
      ].filter(Boolean),
    ),
  ).slice(0, 5);
  const preferredAssets = Array.from(
    new Set(
      [
        ...strategy.tuning.preferred_assets,
        ...priorPreferredAssets,
        ...focusThemes.flatMap((theme) => PREFERRED_ASSET_HINTS[theme] ?? []),
      ].filter(Boolean),
    ),
  ).slice(0, 6);

  let confidenceBias = parseNumber(priorPatch.confidence_bias) ?? strategy.tuning.confidence_bias;
  let confidenceCap =
    parseNumber(priorPatch.confidence_cap) ??
    strategy.tuning.confidence_cap ??
    defaultConfidenceCap(effectiveProfile);
  let magnitudeMultiplier =
    parseNumber(priorPatch.magnitude_multiplier) ?? strategy.tuning.magnitude_multiplier;
  let convictionBias = parseNumber(priorPatch.conviction_bias) ?? strategy.tuning.conviction_bias;
  const rationale: string[] = [...(patternPriors?.rationale ?? [])];

  if (patternPriors?.selected_patterns.length) {
    rationale.push(
      `Start from successful replay priors before case-specific tuning: ${patternPriors.selected_patterns
        .slice(0, 4)
        .map((pattern) => pattern.pattern_key)
        .join(", ")}.`,
    );
  }

  if (metric.calibration_gap > 0.08 || overconfidenceRate >= 0.18) {
    confidenceBias = round(Math.max(-0.2, confidenceBias - 0.05));
    confidenceCap = round(Math.min(confidenceCap, 0.84));
    rationale.push("Reduce confidence because replay shows persistent overconfidence versus realized direction accuracy.");
  } else if (metric.calibration_gap < -0.08 || underconfidenceRate >= 0.18) {
    confidenceBias = round(Math.min(0.2, confidenceBias + 0.04));
    rationale.push("Raise confidence slightly because replay shows the model is too cautious relative to realized outcomes.");
  }

  if (avgMagnitudeScore < 0.48) {
    magnitudeMultiplier = round(Math.max(0.5, magnitudeMultiplier - 0.08));
    rationale.push("Trim magnitude sizing because realized move sizing is too noisy in replay.");
  } else if (avgMagnitudeScore > 0.72 && metric.wrong_rate < 0.2) {
    magnitudeMultiplier = round(Math.min(1.5, magnitudeMultiplier + 0.04));
    rationale.push("Allow slightly larger magnitude sizing because replay magnitude alignment is strong.");
  }

  if (metric.wrong_rate > 0.35 || wrongDirectionRate > 0.28) {
    convictionBias = round(Math.max(-0.2, convictionBias - 0.04));
    rationale.push("Lower conviction because wrong-direction misses remain too frequent in replay.");
  } else if (metric.correct_rate > 0.5 && metric.calibration_gap <= 0.03) {
    convictionBias = round(Math.min(0.2, convictionBias + 0.02));
    rationale.push("Slightly raise conviction because the profile is holding together with acceptable calibration.");
  }

  if (cautionThemes.length) {
    rationale.push(`Add caution for weak replay slices: ${cautionThemes.join(", ")}.`);
  }

  if (focusThemes.length) {
    rationale.push(`Lean into stronger replay slices: ${focusThemes.join(", ")}.`);
  }

  const featureFlagsPatch: Record<string, string | number | boolean> = {
    strategy_profile: effectiveProfile,
    confidence_bias: confidenceBias,
    confidence_cap: confidenceCap,
    magnitude_multiplier: magnitudeMultiplier,
    conviction_bias: convictionBias,
  };

  if (focusThemes.length) {
    featureFlagsPatch.focus_themes = focusThemes.join(",");
  }

  if (cautionThemes.length) {
    featureFlagsPatch.caution_themes = cautionThemes.join(",");
  }

  if (preferredAssets.length) {
    featureFlagsPatch.preferred_assets = preferredAssets.join(",");
  }

  if (!rationale.length) {
    rationale.push("Current replay does not show a strong need for profile retuning yet.");
  }

  return {
    confidence_bias: confidenceBias,
    confidence_cap: confidenceCap,
    magnitude_multiplier: magnitudeMultiplier,
    conviction_bias: convictionBias,
    focus_themes: focusThemes,
    preferred_assets: preferredAssets,
    caution_themes: cautionThemes,
    rationale,
    feature_flags_patch: featureFlagsPatch,
  };
};

export const buildHistoricalReplayDiagnostics = async (
  repository: Repository,
  request: HistoricalReplayRequest,
  options: ReplayDiagnosticsOptions = {},
): Promise<HistoricalReplayDiagnosticsResponse> => {
  const replay = await runHistoricalReplayBenchmark(repository, request);
  const models = await Promise.all(
    replay.models.map(async (metric) => {
      const modelCases = replay.cases.filter((item) => item.model_version === metric.model_version);
      const themeSlices = new Map<string, SliceAccumulator>();
      const tagSlices = new Map<string, SliceAccumulator>();
      const sourceTypeSlices = new Map<string, SliceAccumulator>();
      const horizonSlices = new Map<string, SliceAccumulator>();

      for (const result of modelCases) {
        for (const theme of result.themes) {
          updateSliceAccumulator(ensureSliceAccumulator(themeSlices, theme), result);
        }

        for (const tag of result.tags) {
          updateSliceAccumulator(ensureSliceAccumulator(tagSlices, tag), result);
        }

        updateSliceAccumulator(ensureSliceAccumulator(sourceTypeSlices, result.source_type), result);
        updateSliceAccumulator(ensureSliceAccumulator(horizonSlices, result.horizon), result);
      }

      const weakestThemes = toSliceDiagnostics(themeSlices);
      const weakestTags = toSliceDiagnostics(tagSlices);
      const weakestSourceTypes = toSliceDiagnostics(sourceTypeSlices, 3);
      const weakestHorizons = toSliceDiagnostics(horizonSlices, 3);
      const frequentFailureTags = buildFailureTagStats(modelCases).slice(0, 5);
      const highConfidenceMisses = modelCases
        .filter((item) => item.verdict === "wrong" && item.confidence >= 0.65)
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, 5)
        .map((item) => ({
          case_id: item.case_id,
          confidence: item.confidence,
          total_score: item.total_score,
          themes: item.themes,
          tags: item.tags,
          failure_tags: item.failure_tags,
        }));
      const strategy = await resolvePredictionStrategyProfile(repository, metric.model_version);
      const recommendedTuning = await buildRecommendedTuning(
        repository,
        metric.model_version,
        metric,
        modelCases,
        weakestThemes,
        frequentFailureTags,
        options.patternPriors,
      );

      return {
        model_version: metric.model_version,
        profile: strategy.profile,
        average_total_score: metric.average_total_score,
        direction_accuracy: metric.direction_accuracy,
        calibration_gap: metric.calibration_gap,
        wrong_rate: metric.wrong_rate,
        weakest_themes: weakestThemes,
        weakest_tags: weakestTags,
        weakest_source_types: weakestSourceTypes,
        weakest_horizons: weakestHorizons,
        frequent_failure_tags: frequentFailureTags,
        high_confidence_misses: highConfidenceMisses,
        recommended_tuning: recommendedTuning,
      };
    }),
  );

  return historicalReplayDiagnosticsResponseSchema.parse({
    generated_at: replay.generated_at,
    case_pack: replay.case_pack,
    case_count: replay.case_count,
    leaders: replay.leaders,
    models,
  });
};
