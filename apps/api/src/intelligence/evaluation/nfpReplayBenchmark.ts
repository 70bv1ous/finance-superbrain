import { NfpMemoryCaseStore } from "../memory/nfpMemoryCaseStore.js";
import type { NfpMemoryCase } from "../memory/nfpMemoryCaseBuilder.js";
import { findNfpAnalogs } from "../analogs/nfpAnalogRetrieval.js";
import { enrichNfpPredictionWithAnalogs } from "../analogs/nfpConfidenceEnrichment.js";
import { resolveThemeKeyForCase, buildNfpClusterId } from "../themes/nfpThemeClustering.js";
import { summarizeNfpTheme } from "../themes/nfpThemeSummary.js";
import type { NfpReliabilitySignal } from "../themes/nfpThemeSummary.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NfpReplayRecord = {
  case_id: string;
  period: string;
  horizon: string;
  verdict: NfpMemoryCase["verdict"];
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
  cluster_reliability: NfpReliabilitySignal;
};

export type NfpReplayBenchmarkResult = {
  total_cases: number;
  cases_with_prior_analogs: number;
  records: NfpReplayRecord[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const round = (v: number) => Number(v.toFixed(4));

const resolvePriorClusterReliability = (
  priorCases: NfpMemoryCase[],
  cluster_id: string,
  themeKey: ReturnType<typeof resolveThemeKeyForCase>,
): NfpReliabilitySignal => {
  const matching = priorCases.filter(
    (c) => buildNfpClusterId(resolveThemeKeyForCase(c)) === cluster_id,
  );

  if (!matching.length) return "insufficient_data";

  return summarizeNfpTheme({
    cluster_id,
    key: themeKey,
    cases: matching,
    size: matching.length,
  }).reliability_signal;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Replay stored NFP memory cases in strict chronological order and compare
 * baseline vs memory-enriched prediction quality.
 *
 * Temporal holdout: case i only sees cases 0…i-1 as analogs.
 * Sorted by `nfp_event.released_at` — the authoritative event timestamp.
 * O(n²) — acceptable at monthly NFP release volumes (~12/year).
 */
export const runNfpReplayBenchmark = async (
  store: NfpMemoryCaseStore,
): Promise<NfpReplayBenchmarkResult> => {
  const allCases = await store.list();

  const sorted = [...allCases].sort((a, b) =>
    a.nfp_event.released_at.localeCompare(b.nfp_event.released_at),
  );

  const records: NfpReplayRecord[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    const priorCases = sorted.slice(0, i);

    const priorStore = new NfpMemoryCaseStore();
    for (const c of priorCases) {
      await priorStore.save(c);
    }

    const basePrediction = current.prediction_result.predictions[0];
    const baseOutcome = current.tracked_outcomes[0];
    if (!basePrediction || !baseOutcome) continue;

    const baseline_confidence = basePrediction.confidence;
    const direction_score = baseOutcome.outcome.direction_score;
    const baseline_calibration_error = round(Math.abs(baseline_confidence - direction_score));

    const analogs = await findNfpAnalogs(
      priorStore,
      current.nfp_event,
      current.context,
    );

    const enrichedResult = enrichNfpPredictionWithAnalogs(
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
    const cluster_id = buildNfpClusterId(themeKey);
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
