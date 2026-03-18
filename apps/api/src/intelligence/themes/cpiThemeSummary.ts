import type { CpiMemoryCase } from "../memory/memoryCaseBuilder.js";
import type { CpiMemoryCaseStore } from "../memory/cpiMemoryCaseStore.js";
import type { CpiThemeCluster, CpiThemeKey } from "./cpiThemeClustering.js";
import { clusterCpiMemoryCases } from "./cpiThemeClustering.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerdictDistribution = {
  correct: number;
  partially_correct: number;
  wrong: number;
  total: number;
  /** Fraction of cases with verdict = "correct" */
  accuracy_rate: number;
};

/**
 * How reliable this cluster pattern is as a prediction template.
 *
 *   reliable          accuracy ≥ 70 % and at least 3 cases
 *   mixed             accuracy 36–69 % and at least 3 cases
 *   unreliable        accuracy ≤ 35 % and at least 3 cases
 *   insufficient_data fewer than 3 cases — no statistical conclusion yet
 */
export type ReliabilitySignal =
  | "reliable"
  | "mixed"
  | "unreliable"
  | "insufficient_data";

export type CpiThemeSummary = {
  cluster_id: string;
  /**
   * Human-readable label describing the macro pattern.
   * Example: "Hot CPI (large surprise) + hawkish Fed + risk-off regime + elevated vol"
   */
  pattern_label: string;
  key: CpiThemeKey;
  size: number;
  dominant_verdict: CpiMemoryCase["verdict"];
  verdict_distribution: VerdictDistribution;
  reliability_signal: ReliabilitySignal;
  /** Mean prediction confidence across all predictions in this cluster */
  average_confidence: number;
  /** Coarse confidence tendency across the cluster */
  confidence_tendency: "high" | "moderate" | "low";
  /** Lesson summaries extracted from correct cases (up to 4) */
  common_lesson_patterns: string[];
  /** Lesson summaries from wrong / partially-correct cases (up to 4) */
  common_failure_modes: string[];
};

// ─── Full report from a store ─────────────────────────────────────────────────

export type CpiThemeReport = {
  total_cases: number;
  total_clusters: number;
  clusters: CpiThemeCluster[];
  summaries: CpiThemeSummary[];
  /** Clusters with reliability_signal = "reliable" */
  reliable_patterns: CpiThemeSummary[];
  /** Clusters with reliability_signal = "unreliable" */
  failure_patterns: CpiThemeSummary[];
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const round = (v: number) => Number(v.toFixed(2));

const buildPatternLabel = (key: CpiThemeKey): string => {
  const dir =
    key.surprise_direction === "hotter"
      ? "Hot"
      : key.surprise_direction === "cooler"
        ? "Cool"
        : "Inline";

  const band =
    key.surprise_band === "small"
      ? "small"
      : key.surprise_band === "medium"
        ? "mid"
        : "large";

  const fed =
    key.fed_policy_stance === "hawkish"
      ? "hawkish Fed"
      : key.fed_policy_stance === "dovish"
        ? "dovish Fed"
        : "neutral Fed";

  const macro =
    key.macro_regime === "risk_on"
      ? "risk-on"
      : key.macro_regime === "risk_off"
        ? "risk-off"
        : key.macro_regime === "transitional"
          ? "transitional"
          : "uncertain";

  const vol =
    key.volatility_regime === "low"
      ? "low vol"
      : key.volatility_regime === "normal"
        ? "normal vol"
        : key.volatility_regime === "elevated"
          ? "elevated vol"
          : "high vol";

  return `${dir} CPI (${band} surprise) + ${fed} + ${macro} + ${vol}`;
};

const resolveReliability = (dist: VerdictDistribution): ReliabilitySignal => {
  if (dist.total < 3) return "insufficient_data";
  if (dist.accuracy_rate >= 0.70) return "reliable";
  if (dist.accuracy_rate <= 0.35) return "unreliable";
  return "mixed";
};

const resolveConfidenceTendency = (avg: number): "high" | "moderate" | "low" => {
  if (avg >= 0.65) return "high";
  if (avg >= 0.50) return "moderate";
  return "low";
};

const resolveDominantVerdict = (
  counts: Record<CpiMemoryCase["verdict"], number>,
): CpiMemoryCase["verdict"] => {
  if (counts.correct >= counts.partially_correct && counts.correct >= counts.wrong) {
    return "correct";
  }
  if (counts.wrong > counts.partially_correct) {
    return "wrong";
  }
  return "partially_correct";
};

/** Collect distinct lesson summaries from cases matching the given verdicts. */
const collectLessons = (
  cases: CpiMemoryCase[],
  forVerdicts: CpiMemoryCase["verdict"][],
  maxCount = 4,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const c of cases) {
    if (!forVerdicts.includes(c.verdict)) continue;

    const lesson = c.lesson_summary.trim();
    if (lesson && !seen.has(lesson)) {
      seen.add(lesson);
      result.push(lesson);
      if (result.length >= maxCount) break;
    }
  }

  return result;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Produce a structured summary for a single CPI theme cluster.
 *
 * The summary captures:
 *  - verdict distribution and accuracy rate
 *  - reliability signal (requires ≥ 3 cases for a statistical conclusion)
 *  - average prediction confidence across all cases in the cluster
 *  - deduplicated lesson patterns from correct cases
 *  - deduplicated failure modes from wrong / partially-correct cases
 *  - a human-readable pattern label for logging and dashboards
 */
export const summarizeCpiTheme = (cluster: CpiThemeCluster): CpiThemeSummary => {
  const { cases, key, cluster_id, size } = cluster;

  const counts: Record<CpiMemoryCase["verdict"], number> = {
    correct: 0,
    partially_correct: 0,
    wrong: 0,
  };

  for (const c of cases) {
    counts[c.verdict]++;
  }

  const accuracy_rate = round(counts.correct / size);

  const verdict_distribution: VerdictDistribution = {
    correct: counts.correct,
    partially_correct: counts.partially_correct,
    wrong: counts.wrong,
    total: size,
    accuracy_rate,
  };

  const allConfidences = cases.flatMap((c) =>
    c.prediction_result.predictions.map((p) => p.confidence),
  );

  const average_confidence =
    allConfidences.length > 0
      ? round(allConfidences.reduce((s, v) => s + v, 0) / allConfidences.length)
      : 0;

  return {
    cluster_id,
    pattern_label: buildPatternLabel(key),
    key,
    size,
    dominant_verdict: resolveDominantVerdict(counts),
    verdict_distribution,
    reliability_signal: resolveReliability(verdict_distribution),
    average_confidence,
    confidence_tendency: resolveConfidenceTendency(average_confidence),
    common_lesson_patterns: collectLessons(cases, ["correct"]),
    common_failure_modes: collectLessons(cases, ["wrong", "partially_correct"]),
  };
};

/**
 * Cluster all stored CPI memory cases and summarize every cluster in one call.
 *
 * The returned `CpiThemeReport` is the primary intelligence artifact for the
 * theme layer. Downstream consumers can:
 *  - inspect `reliable_patterns` to find templates worth reinforcing
 *  - inspect `failure_patterns` to find setups the system should approach
 *    with caution or additional validation
 *  - use `summaries` sorted by size to see where the most evidence is
 */
export const buildCpiThemeReport = async (
  store: CpiMemoryCaseStore,
): Promise<CpiThemeReport> => {
  const clusters = await clusterCpiMemoryCases(store);
  const allCases = clusters.flatMap((c) => c.cases);

  const summaries = clusters.map(summarizeCpiTheme);

  return {
    total_cases: allCases.length,
    total_clusters: clusters.length,
    clusters,
    summaries,
    reliable_patterns: summaries.filter(
      (s) => s.reliability_signal === "reliable",
    ),
    failure_patterns: summaries.filter(
      (s) => s.reliability_signal === "unreliable",
    ),
  };
};
