import type { NfpMemoryCase } from "../memory/nfpMemoryCaseBuilder.js";
import type { NfpMemoryCaseStore } from "../memory/nfpMemoryCaseStore.js";
import type { NfpThemeCluster, NfpThemeKey } from "./nfpThemeClustering.js";
import { clusterNfpMemoryCases } from "./nfpThemeClustering.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NfpVerdictDistribution = {
  correct: number;
  partially_correct: number;
  wrong: number;
  total: number;
  accuracy_rate: number;
};

export type NfpReliabilitySignal =
  | "reliable"
  | "mixed"
  | "unreliable"
  | "insufficient_data";

export type NfpThemeSummary = {
  cluster_id: string;
  pattern_label: string;
  key: NfpThemeKey;
  size: number;
  dominant_verdict: NfpMemoryCase["verdict"];
  verdict_distribution: NfpVerdictDistribution;
  reliability_signal: NfpReliabilitySignal;
  average_confidence: number;
  confidence_tendency: "high" | "moderate" | "low";
  common_lesson_patterns: string[];
  common_failure_modes: string[];
};

export type NfpThemeReport = {
  total_cases: number;
  total_clusters: number;
  clusters: NfpThemeCluster[];
  summaries: NfpThemeSummary[];
  reliable_patterns: NfpThemeSummary[];
  failure_patterns: NfpThemeSummary[];
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const round = (v: number) => Number(v.toFixed(2));

const buildPatternLabel = (key: NfpThemeKey): string => {
  const dir =
    key.surprise_direction === "strong"
      ? "Strong beat"
      : key.surprise_direction === "weak"
        ? "Weak miss"
        : "Inline";

  const band =
    key.jobs_surprise_band === "large_beat"
      ? "large beat"
      : key.jobs_surprise_band === "beat"
        ? "beat"
        : key.jobs_surprise_band === "large_miss"
          ? "large miss"
          : key.jobs_surprise_band === "miss"
            ? "miss"
            : "inline";

  const unemp =
    key.unemployment_direction === "better"
      ? "UR better"
      : key.unemployment_direction === "worse"
        ? "UR worse"
        : "UR unchanged";

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

  return `NFP ${dir} (${band} + ${unemp}) + ${macro} + ${vol}`;
};

const resolveReliability = (dist: NfpVerdictDistribution): NfpReliabilitySignal => {
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
  counts: Record<NfpMemoryCase["verdict"], number>,
): NfpMemoryCase["verdict"] => {
  if (counts.correct >= counts.partially_correct && counts.correct >= counts.wrong) {
    return "correct";
  }
  if (counts.wrong > counts.partially_correct) {
    return "wrong";
  }
  return "partially_correct";
};

const collectLessons = (
  cases: NfpMemoryCase[],
  forVerdicts: NfpMemoryCase["verdict"][],
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

export const summarizeNfpTheme = (cluster: NfpThemeCluster): NfpThemeSummary => {
  const { cases, key, cluster_id, size } = cluster;

  const counts: Record<NfpMemoryCase["verdict"], number> = {
    correct: 0,
    partially_correct: 0,
    wrong: 0,
  };

  for (const c of cases) {
    counts[c.verdict]++;
  }

  const accuracy_rate = round(counts.correct / size);

  const verdict_distribution: NfpVerdictDistribution = {
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

export const buildNfpThemeReport = async (
  store: NfpMemoryCaseStore,
): Promise<NfpThemeReport> => {
  const clusters = await clusterNfpMemoryCases(store);
  const allCases = clusters.flatMap((c) => c.cases);
  const summaries = clusters.map(summarizeNfpTheme);

  return {
    total_cases: allCases.length,
    total_clusters: clusters.length,
    clusters,
    summaries,
    reliable_patterns: summaries.filter((s) => s.reliability_signal === "reliable"),
    failure_patterns: summaries.filter((s) => s.reliability_signal === "unreliable"),
  };
};
