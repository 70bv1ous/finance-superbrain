import type { CpiReplayBenchmarkResult } from "./cpiReplayBenchmark.js";
import type {
  CalibrationComparison,
  CautionPrecision,
  ReinforcementPrecision,
  ClusterBenchmarkEntry,
} from "./calibrationReportHelpers.js";
import {
  buildCalibrationComparison,
  buildCautionPrecision,
  buildReinforcementPrecision,
  buildClusterEntries,
  resolveMemoryVerdict,
} from "./calibrationReportHelpers.js";

// ─── Re-export shared sub-report types ────────────────────────────────────────

export type {
  CalibrationComparison,
  CautionPrecision,
  ReinforcementPrecision,
  ClusterBenchmarkEntry,
} from "./calibrationReportHelpers.js";

// ─── Top-level report ─────────────────────────────────────────────────────────

export type CpiCalibrationReport = {
  /** Snapshot of the source benchmark result */
  total_cases: number;
  cases_with_prior_analogs: number;

  calibration: CalibrationComparison;
  caution: CautionPrecision;
  reinforcement: ReinforcementPrecision;
  clusters: ClusterBenchmarkEntry[];

  /**
   * Overall verdict on whether memory enrichment is improving prediction quality.
   *
   *   improving   mean_improvement > 0.02 and improved_count > worsened_count
   *   degrading   mean_improvement < -0.02 or worsened_count > improved_count
   *   neutral     everything else
   */
  memory_verdict: "improving" | "neutral" | "degrading";
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Produce a structured calibration report from the output of `runCpiReplayBenchmark`.
 *
 * The report answers four questions:
 *  1. Is analog enrichment reducing calibration error on average?
 *     → `calibration.mean_improvement`
 *  2. When analogs issued caution (boost < 0), were they right to do so?
 *     → `caution.caution_precision`
 *  3. When analogs reinforced confidence (boost > 0), was the prediction correct?
 *     → `reinforcement.reinforcement_precision`
 *  4. Which macro-theme clusters benefit most / least from memory?
 *     → `clusters[]`
 *
 * The top-level `memory_verdict` summarises all four into a single signal
 * suitable for dashboards and logging.
 */
export const buildCpiCalibrationReport = (
  benchmarkResult: CpiReplayBenchmarkResult,
): CpiCalibrationReport => {
  const { records, total_cases, cases_with_prior_analogs } = benchmarkResult;

  const calibration = buildCalibrationComparison(records);
  const caution = buildCautionPrecision(records);
  const reinforcement = buildReinforcementPrecision(records);
  const clusters = buildClusterEntries(records);
  const memory_verdict = resolveMemoryVerdict(calibration);

  return {
    total_cases,
    cases_with_prior_analogs,
    calibration,
    caution,
    reinforcement,
    clusters,
    memory_verdict,
  };
};
