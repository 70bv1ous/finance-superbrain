import type { FomcMemoryCase } from "../memory/fomcMemoryCaseBuilder.js";
import type { FomcMemoryCaseStore } from "../memory/fomcMemoryCaseStore.js";
import type { FomcThemeCluster, FomcThemeKey } from "./fomcThemeClustering.js";
import { clusterFomcMemoryCases } from "./fomcThemeClustering.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FomcVerdictDistribution = {
  correct: number;
  partially_correct: number;
  wrong: number;
  total: number;
  accuracy_rate: number;
};

export type FomcReliabilitySignal =
  | "reliable"
  | "mixed"
  | "unreliable"
  | "insufficient_data";

export type FomcThemeSummary = {
  cluster_id: string;
  pattern_label: string;
  key: FomcThemeKey;
  size: number;
  dominant_verdict: FomcMemoryCase["verdict"];
  verdict_distribution: FomcVerdictDistribution;
  reliability_signal: FomcReliabilitySignal;
  average_confidence: number;
  confidence_tendency: "high" | "moderate" | "low";
  common_lesson_patterns: string[];
  common_failure_modes: string[];
};

export type FomcThemeReport = {
  total_cases: number;
  total_clusters: number;
  clusters: FomcThemeCluster[];
  summaries: FomcThemeSummary[];
  reliable_patterns: FomcThemeSummary[];
  failure_patterns: FomcThemeSummary[];
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const round = (v: number) => Number(v.toFixed(2));

const buildPatternLabel = (key: FomcThemeKey): string => {
  const dir =
    key.surprise_direction === "hawkish"
      ? "Hawkish"
      : key.surprise_direction === "dovish"
        ? "Dovish"
        : "Inline";

  const dec =
    key.decision_type === "hike"
      ? "hike"
      : key.decision_type === "cut"
        ? "cut"
        : "hold";

  const tone =
    key.guidance_tone === "hawkish"
      ? "hawkish guidance"
      : key.guidance_tone === "dovish"
        ? "dovish guidance"
        : "neutral guidance";

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

  return `${dir} FOMC (${dec} + ${tone}) + ${macro} + ${vol}`;
};

const resolveReliability = (dist: FomcVerdictDistribution): FomcReliabilitySignal => {
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
  counts: Record<FomcMemoryCase["verdict"], number>,
): FomcMemoryCase["verdict"] => {
  if (counts.correct >= counts.partially_correct && counts.correct >= counts.wrong) {
    return "correct";
  }
  if (counts.wrong > counts.partially_correct) {
    return "wrong";
  }
  return "partially_correct";
};

const collectLessons = (
  cases: FomcMemoryCase[],
  forVerdicts: FomcMemoryCase["verdict"][],
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

export const summarizeFomcTheme = (cluster: FomcThemeCluster): FomcThemeSummary => {
  const { cases, key, cluster_id, size } = cluster;

  const counts: Record<FomcMemoryCase["verdict"], number> = {
    correct: 0,
    partially_correct: 0,
    wrong: 0,
  };

  for (const c of cases) {
    counts[c.verdict]++;
  }

  const accuracy_rate = round(counts.correct / size);

  const verdict_distribution: FomcVerdictDistribution = {
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

export const buildFomcThemeReport = async (
  store: FomcMemoryCaseStore,
): Promise<FomcThemeReport> => {
  const clusters = await clusterFomcMemoryCases(store);
  const allCases = clusters.flatMap((c) => c.cases);
  const summaries = clusters.map(summarizeFomcTheme);

  return {
    total_cases: allCases.length,
    total_clusters: clusters.length,
    clusters,
    summaries,
    reliable_patterns: summaries.filter((s) => s.reliability_signal === "reliable"),
    failure_patterns: summaries.filter((s) => s.reliability_signal === "unreliable"),
  };
};
