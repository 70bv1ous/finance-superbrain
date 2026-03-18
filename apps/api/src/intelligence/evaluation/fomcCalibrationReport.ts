import type { FomcReplayBenchmarkResult } from "./fomcReplayBenchmark.js";
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

// ─── Type aliases (backward-compatible exports) ───────────────────────────────

export type FomcCalibrationComparison = CalibrationComparison;
export type FomcCautionPrecision = CautionPrecision;
export type FomcReinforcementPrecision = ReinforcementPrecision;
export type FomcClusterBenchmarkEntry = ClusterBenchmarkEntry;

// ─── Top-level report ─────────────────────────────────────────────────────────

export type FomcCalibrationReport = {
  total_cases: number;
  cases_with_prior_analogs: number;
  calibration: CalibrationComparison;
  caution: CautionPrecision;
  reinforcement: ReinforcementPrecision;
  clusters: ClusterBenchmarkEntry[];
  memory_verdict: "improving" | "neutral" | "degrading";
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Produce a structured calibration report from the output of `runFomcReplayBenchmark`.
 * Delegates all computation to the shared calibration report helpers.
 */
export const buildFomcCalibrationReport = (
  benchmarkResult: FomcReplayBenchmarkResult,
): FomcCalibrationReport => {
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
