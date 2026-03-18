import { FomcMemoryCaseStore } from "../memory/fomcMemoryCaseStore.js";
import type { FomcMemoryCase } from "../memory/fomcMemoryCaseBuilder.js";
import { findFomcAnalogs } from "../analogs/fomcAnalogRetrieval.js";
import { enrichFomcPredictionWithAnalogs } from "../analogs/fomcConfidenceEnrichment.js";
import { resolveThemeKeyForCase, buildFomcClusterId } from "../themes/fomcThemeClustering.js";
import { summarizeFomcTheme } from "../themes/fomcThemeSummary.js";
import type { FomcReliabilitySignal } from "../themes/fomcThemeSummary.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FomcReplayRecord = {
  case_id: string;
  period: string;
  horizon: string;
  verdict: FomcMemoryCase["verdict"];
  direction_score: number;

  baseline_confidence: number;
  baseline_calibration_error: number;

  prior_case_count: number;
  analog_count: number;
  analog_boost: number;
  enriched_confidence: number;
  enriched_calibration_error: number;
  calibration_improvement: number;

  cluster_id: string;
  cluster_reliability: FomcReliabilitySignal;
};

export type FomcReplayBenchmarkResult = {
  total_cases: number;
  cases_with_prior_analogs: number;
  records: FomcReplayRecord[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const round = (v: number) => Number(v.toFixed(4));

const resolvePriorClusterReliability = (
  priorCases: FomcMemoryCase[],
  cluster_id: string,
  themeKey: ReturnType<typeof resolveThemeKeyForCase>,
): FomcReliabilitySignal => {
  const matching = priorCases.filter(
    (c) => buildFomcClusterId(resolveThemeKeyForCase(c)) === cluster_id,
  );

  if (!matching.length) return "insufficient_data";

  return summarizeFomcTheme({
    cluster_id,
    key: themeKey,
    cases: matching,
    size: matching.length,
  }).reliability_signal;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Replay stored FOMC memory cases in strict chronological order and compare
 * baseline vs memory-enriched prediction quality.
 *
 * Temporal holdout: case i only sees cases 0…i-1 as analogs.
 * O(n²) — acceptable at FOMC meeting volumes (~8/year).
 */
export const runFomcReplayBenchmark = async (
  store: FomcMemoryCaseStore,
): Promise<FomcReplayBenchmarkResult> => {
  const allCases = await store.list();

  const sorted = [...allCases].sort((a, b) =>
    a.fomc_event.released_at.localeCompare(b.fomc_event.released_at),
  );

  const records: FomcReplayRecord[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    const priorCases = sorted.slice(0, i);

    const priorStore = new FomcMemoryCaseStore();
    for (const c of priorCases) {
      await priorStore.save(c);
    }

    const basePrediction = current.prediction_result.predictions[0];
    const baseOutcome = current.tracked_outcomes[0];
    if (!basePrediction || !baseOutcome) continue;

    const baseline_confidence = basePrediction.confidence;
    const direction_score = baseOutcome.outcome.direction_score;
    const baseline_calibration_error = round(Math.abs(baseline_confidence - direction_score));

    const analogs = await findFomcAnalogs(
      priorStore,
      current.fomc_event,
      current.context,
    );

    const enrichedResult = enrichFomcPredictionWithAnalogs(
      current.prediction_result,
      analogs,
    );

    const enrichedPrediction = enrichedResult.predictions[0]!;
    const enriched_confidence = enrichedPrediction.confidence;
    const enriched_calibration_error = round(Math.abs(enriched_confidence - direction_score));
    const calibration_improvement = round(
      baseline_calibration_error - enriched_calibration_error,
    );

    const themeKey = resolveThemeKeyForCase(current);
    const cluster_id = buildFomcClusterId(themeKey);
    const cluster_reliability = resolvePriorClusterReliability(
      priorCases,
      cluster_id,
      themeKey,
    );

    records.push({
      case_id: current.id,
      period: current.period,
      horizon: basePrediction.horizon,
      verdict: current.verdict,
      direction_score: round(direction_score),

      baseline_confidence: round(baseline_confidence),
      baseline_calibration_error,

      prior_case_count: priorCases.length,
      analog_count: analogs.length,
      analog_boost: round(enrichedPrediction.analog_boost),
      enriched_confidence: round(enriched_confidence),
      enriched_calibration_error,

      calibration_improvement,

      cluster_id,
      cluster_reliability,
    });
  }

  return {
    total_cases: records.length,
    cases_with_prior_analogs: records.filter((r) => r.analog_count > 0).length,
    records,
  };
};
