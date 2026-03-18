import { CpiMemoryCaseStore } from "../memory/cpiMemoryCaseStore.js";
import type { CpiMemoryCase } from "../memory/memoryCaseBuilder.js";
import { findCpiAnalogs } from "../analogs/cpiAnalogRetrieval.js";
import { enrichCpiPredictionWithAnalogs } from "../analogs/cpiConfidenceEnrichment.js";
import { resolveThemeKeyForCase, buildCpiClusterId } from "../themes/cpiThemeClustering.js";
import { summarizeCpiTheme } from "../themes/cpiThemeSummary.js";
import type { ReliabilitySignal } from "../themes/cpiThemeSummary.js";

// ─── Per-case replay record ───────────────────────────────────────────────────

export type CpiReplayRecord = {
  case_id: string;
  period: string;
  horizon: string;
  verdict: CpiMemoryCase["verdict"];
  /**
   * Realized direction score [0, 1] from the stored outcome.
   * 1.0 = all predicted asset directions matched.
   */
  direction_score: number;

  /** Confidence the base engine originally assigned — no memory. */
  baseline_confidence: number;
  /** |baseline_confidence − direction_score| */
  baseline_calibration_error: number;

  /** How many prior cases existed at replay time. */
  prior_case_count: number;
  /** How many of those prior cases were retrieved as analogs. */
  analog_count: number;
  /**
   * Net confidence delta applied by analog enrichment.
   * > 0 → analogs reinforced confidence.
   * < 0 → analogs issued caution.
   * = 0 → no analogs or zero net signal.
   */
  analog_boost: number;
  /** Enriched confidence after analog calibration. */
  enriched_confidence: number;
  /** |enriched_confidence − direction_score| */
  enriched_calibration_error: number;

  /**
   * baseline_calibration_error − enriched_calibration_error.
   * Positive  → enrichment reduced calibration error (helped).
   * Negative  → enrichment increased calibration error (hurt).
   * Zero      → no change.
   */
  calibration_improvement: number;

  /** Deterministic cluster key for this case's five-dimension theme. */
  cluster_id: string;
  /**
   * Reliability signal of this case's cluster as seen from prior cases only.
   * "insufficient_data" when < 3 prior cases share the cluster.
   */
  cluster_reliability: ReliabilitySignal;
};

// ─── Aggregate benchmark result ───────────────────────────────────────────────

export type CpiReplayBenchmarkResult = {
  total_cases: number;
  /** Cases where at least one prior analog existed at replay time. */
  cases_with_prior_analogs: number;
  records: CpiReplayRecord[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const round = (v: number) => Number(v.toFixed(4));

/** Resolve cluster reliability from the set of prior cases with the same key. */
const resolvePriorClusterReliability = (
  priorCases: CpiMemoryCase[],
  cluster_id: string,
  themeKey: ReturnType<typeof resolveThemeKeyForCase>,
): ReliabilitySignal => {
  const matching = priorCases.filter(
    (c) => buildCpiClusterId(resolveThemeKeyForCase(c)) === cluster_id,
  );

  if (!matching.length) return "insufficient_data";

  const clusterObj = {
    cluster_id,
    key: themeKey,
    cases: matching,
    size: matching.length,
  };

  return summarizeCpiTheme(clusterObj).reliability_signal;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Replay stored CPI memory cases in strict chronological order and compare
 * baseline vs memory-enriched prediction quality for each case.
 *
 * Temporal holdout rule: when evaluating case i, only cases 0…i-1 are
 * visible as analogs. The case being evaluated is never included in its
 * own retrieval pool.
 *
 * What is measured:
 *  1. Confidence calibration error (|confidence − realized_direction_score|)
 *     for both baseline and enriched predictions.
 *  2. Net calibration improvement (positive = memory helped).
 *  3. Analog boost sign vs eventual verdict (caution/reinforcement signal quality).
 *  4. Per-cluster reliability as seen from past cases only.
 *
 * The replay is O(n²) in store size — fine for the CPI event volumes expected
 * (tens to hundreds of cases). Do not use on stores with thousands of cases
 * without adding pagination.
 */
export const runCpiReplayBenchmark = async (
  store: CpiMemoryCaseStore,
): Promise<CpiReplayBenchmarkResult> => {
  const allCases = await store.list();

  // Strict chronological order by CPI event release date.
  // cpi_event.released_at is the authoritative timestamp for when the macro
  // event occurred — independent of when the memory case was persisted.
  const sorted = [...allCases].sort((a, b) =>
    a.cpi_event.released_at.localeCompare(b.cpi_event.released_at),
  );

  const records: CpiReplayRecord[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    const priorCases = sorted.slice(0, i);

    // Build a prior-only in-memory store for temporal holdout
    const priorStore = new CpiMemoryCaseStore();
    for (const c of priorCases) {
      await priorStore.save(c);
    }

    // Use the first horizon's prediction/outcome for comparison
    const basePrediction = current.prediction_result.predictions[0];
    const baseOutcome = current.tracked_outcomes[0];
    if (!basePrediction || !baseOutcome) continue;

    const baseline_confidence = basePrediction.confidence;
    const direction_score = baseOutcome.outcome.direction_score;
    const baseline_calibration_error = round(Math.abs(baseline_confidence - direction_score));

    // Retrieve analogs and enrich
    const analogs = await findCpiAnalogs(
      priorStore,
      current.cpi_event,
      current.context,
    );

    const enrichedResult = enrichCpiPredictionWithAnalogs(
      current.prediction_result,
      analogs,
    );

    const enrichedPrediction = enrichedResult.predictions[0]!;
    const enriched_confidence = enrichedPrediction.confidence;
    const enriched_calibration_error = round(Math.abs(enriched_confidence - direction_score));
    const calibration_improvement = round(
      baseline_calibration_error - enriched_calibration_error,
    );

    // Cluster context from the prior-cases perspective
    const themeKey = resolveThemeKeyForCase(current);
    const cluster_id = buildCpiClusterId(themeKey);
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
