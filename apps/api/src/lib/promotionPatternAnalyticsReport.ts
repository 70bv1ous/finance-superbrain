import { promotionPatternAnalyticsResponseSchema } from "@finance-superbrain/schemas";
import type {
  PromotionPatternAnalyticsResponse,
  StoredModelVersion,
  StoredPromotionEvaluation,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

type PatternToken = {
  pattern_key: string;
  category: string;
  label: string;
};

const PATTERN_CATEGORY_PRIORITY: Record<string, number> = {
  strategy_profile: 8,
  confidence_bias: 7,
  conviction_bias: 6,
  confidence_cap: 5,
  magnitude_multiplier: 4,
  focus_theme: 3,
  caution_theme: 2,
  preferred_asset: 1,
};

const round = (value: number) => Number(value.toFixed(2));

const average = (sum: number, count: number) => (count ? sum / count : 0);

const sortNewestFirst = (
  left: { created_at: string },
  right: { created_at: string },
) => right.created_at.localeCompare(left.created_at);

const bestPattern = (
  patterns: PromotionPatternAnalyticsResponse["patterns"],
  selector: (pattern: PromotionPatternAnalyticsResponse["patterns"][number]) => number,
) => {
  if (!patterns.length) {
    return null;
  }

  return [...patterns]
    .sort((left, right) => {
      const delta = selector(right) - selector(left);

      if (delta !== 0) {
        return delta;
      }

      if (right.sample_count !== left.sample_count) {
        return right.sample_count - left.sample_count;
      }

      const priorityDelta =
        (PATTERN_CATEGORY_PRIORITY[right.category] ?? 0) -
        (PATTERN_CATEGORY_PRIORITY[left.category] ?? 0);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.pattern_key.localeCompare(right.pattern_key);
    })[0]?.pattern_key ?? null;
};

const parseCsv = (value: unknown) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

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

const toLabel = (value: string) => value.replaceAll("_", " ");

const inferFamily = (modelVersion: string) =>
  modelVersion.replace(/-?v\d[\w-]*$/i, "") || modelVersion;

const resolveFamily = (
  evaluation: StoredPromotionEvaluation,
  modelRegistry: Map<string, StoredModelVersion>,
) =>
  evaluation.saved_model?.family ??
  modelRegistry.get(evaluation.candidate_model_version)?.family ??
  modelRegistry.get(evaluation.baseline_model_version)?.family ??
  inferFamily(evaluation.candidate_model_version);

const classifySignedBias = (value: number | null) => {
  if (value === null) {
    return null;
  }

  if (value > 0.02) {
    return "positive";
  }

  if (value < -0.02) {
    return "negative";
  }

  return "neutral";
};

const classifyConfidenceCap = (value: number | null) => {
  if (value === null) {
    return "open";
  }

  if (value <= 0.84) {
    return "tight";
  }

  if (value <= 0.9) {
    return "moderate";
  }

  return "open";
};

const classifyMagnitude = (value: number | null) => {
  if (value === null) {
    return null;
  }

  if (value > 1.05) {
    return "upscaled";
  }

  if (value < 0.95) {
    return "downscaled";
  }

  return "neutral";
};

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

const extractPatternTokens = (
  evaluation: StoredPromotionEvaluation,
  modelRegistry: Map<string, StoredModelVersion>,
) => {
  const model = evaluation.saved_model ?? modelRegistry.get(evaluation.candidate_model_version) ?? null;

  if (!model) {
    return [];
  }

  const flags = model.feature_flags ?? {};
  const profile =
    (typeof flags.strategy_profile === "string" && flags.strategy_profile) ||
    (typeof flags.replay_profile === "string" && flags.replay_profile) ||
    model.prompt_profile ||
    null;
  const confidenceBias = classifySignedBias(parseNumber(flags.confidence_bias));
  const convictionBias = classifySignedBias(parseNumber(flags.conviction_bias));
  const confidenceCap = classifyConfidenceCap(parseNumber(flags.confidence_cap));
  const magnitude = classifyMagnitude(parseNumber(flags.magnitude_multiplier));
  const focusThemes = parseCsv(flags.focus_themes);
  const cautionThemes = parseCsv(flags.caution_themes);
  const preferredAssets = parseCsv(flags.preferred_assets).slice(0, 4);
  const tokens: PatternToken[] = [];

  if (profile) {
    tokens.push({
      pattern_key: `profile:${profile}`,
      category: "strategy_profile",
      label: `profile ${toLabel(profile)}`,
    });
  }

  if (confidenceBias) {
    tokens.push({
      pattern_key: `confidence_bias:${confidenceBias}`,
      category: "confidence_bias",
      label: `confidence bias ${confidenceBias}`,
    });
  }

  if (convictionBias) {
    tokens.push({
      pattern_key: `conviction_bias:${convictionBias}`,
      category: "conviction_bias",
      label: `conviction bias ${convictionBias}`,
    });
  }

  tokens.push({
    pattern_key: `confidence_cap:${confidenceCap}`,
    category: "confidence_cap",
    label: `confidence cap ${confidenceCap}`,
  });

  if (magnitude) {
    tokens.push({
      pattern_key: `magnitude_multiplier:${magnitude}`,
      category: "magnitude_multiplier",
      label: `magnitude ${magnitude}`,
    });
  }

  for (const theme of focusThemes) {
    tokens.push({
      pattern_key: `focus_theme:${theme}`,
      category: "focus_theme",
      label: `focus ${toLabel(theme)}`,
    });
  }

  for (const theme of cautionThemes) {
    tokens.push({
      pattern_key: `caution_theme:${theme}`,
      category: "caution_theme",
      label: `caution ${toLabel(theme)}`,
    });
  }

  for (const ticker of preferredAssets) {
    tokens.push({
      pattern_key: `preferred_asset:${ticker}`,
      category: "preferred_asset",
      label: `preferred asset ${ticker}`,
    });
  }

  return [...new Map(tokens.map((token) => [token.pattern_key, token])).values()];
};

export const buildPromotionPatternAnalyticsReport = async (
  repository: Repository,
): Promise<PromotionPatternAnalyticsResponse> => {
  const [evaluations, models] = await Promise.all([
    repository.listPromotionEvaluations(500),
    repository.listModelVersions(),
  ]);
  const modelRegistry = new Map(models.map((model) => [model.model_version, model] as const));
  const grouped = new Map<
    string,
    {
      token: PatternToken;
      evaluations: StoredPromotionEvaluation[];
      families: Set<string>;
    }
  >();

  for (const evaluation of evaluations) {
    const family = resolveFamily(evaluation, modelRegistry);

    for (const token of extractPatternTokens(evaluation, modelRegistry)) {
      const entry = grouped.get(token.pattern_key) ?? {
        token,
        evaluations: [],
        families: new Set<string>(),
      };

      entry.evaluations.push(evaluation);
      entry.families.add(family);
      grouped.set(token.pattern_key, entry);
    }
  }

  const patterns = [...grouped.values()]
    .map((entry) => {
      const passedCount = entry.evaluations.filter((item) => item.passed).length;
      const failedCount = entry.evaluations.length - passedCount;
      const trend = buildTrend(entry.evaluations);

      return {
        pattern_key: entry.token.pattern_key,
        category: entry.token.category,
        label: entry.token.label,
        sample_count: entry.evaluations.length,
        passed_count: passedCount,
        failed_count: failedCount,
        pass_rate: round(average(passedCount, entry.evaluations.length)),
        recent_window_size: trend.recent_window_size,
        recent_pass_rate: trend.recent_pass_rate,
        prior_pass_rate: trend.prior_pass_rate,
        trend_delta: trend.trend_delta,
        trend_signal: trend.trend_signal,
        average_total_score_delta: round(
          average(
            entry.evaluations.reduce((sum, item) => sum + item.deltas.average_total_score, 0),
            entry.evaluations.length,
          ),
        ),
        average_direction_accuracy_delta: round(
          average(
            entry.evaluations.reduce((sum, item) => sum + item.deltas.direction_accuracy, 0),
            entry.evaluations.length,
          ),
        ),
        average_wrong_rate_delta: round(
          average(
            entry.evaluations.reduce((sum, item) => sum + item.deltas.wrong_rate, 0),
            entry.evaluations.length,
          ),
        ),
        average_calibration_alignment_delta: round(
          average(
            entry.evaluations.reduce(
              (sum, item) => sum + item.deltas.calibration_alignment,
              0,
            ),
            entry.evaluations.length,
          ),
        ),
        families: [...entry.families].sort(),
      };
    })
    .sort((left, right) => {
      if (right.pass_rate !== left.pass_rate) {
        return right.pass_rate - left.pass_rate;
      }

      if (right.sample_count !== left.sample_count) {
        return right.sample_count - left.sample_count;
      }

      const priorityDelta =
        (PATTERN_CATEGORY_PRIORITY[right.category] ?? 0) -
        (PATTERN_CATEGORY_PRIORITY[left.category] ?? 0);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      if (right.average_calibration_alignment_delta !== left.average_calibration_alignment_delta) {
        return right.average_calibration_alignment_delta - left.average_calibration_alignment_delta;
      }

      return left.pattern_key.localeCompare(right.pattern_key);
    });

  return promotionPatternAnalyticsResponseSchema.parse({
    generated_at: new Date().toISOString(),
    sample_count: evaluations.length,
    patterns,
    leaders: {
      by_pass_rate: bestPattern(patterns, (pattern) => pattern.pass_rate),
      by_trend_improvement: bestPattern(
        patterns,
        (pattern) => pattern.trend_delta ?? Number.NEGATIVE_INFINITY,
      ),
      by_calibration_alignment: bestPattern(
        patterns,
        (pattern) => pattern.average_calibration_alignment_delta,
      ),
      by_wrong_rate_reduction: bestPattern(
        patterns,
        (pattern) => pattern.average_wrong_rate_delta * -1,
      ),
    },
  });
};
