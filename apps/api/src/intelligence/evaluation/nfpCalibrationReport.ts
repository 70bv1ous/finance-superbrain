import type { NfpReplayBenchmarkResult } from "./nfpReplayBenchmark.js";
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

export type NfpCalibrationComparison = CalibrationComparison;
export type NfpCautionPrecision = CautionPrecision;
export type NfpReinforcementPrecision = ReinforcementPrecision;
export type NfpClusterBenchmarkEntry = ClusterBenchmarkEntry;

// ─── Top-level report ─────────────────────────────────────────────────────────

export type NfpCalibrationReport = {
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
 * Produce a structured calibration report from the output of `runNfpReplayBenchmark`.
 * Delegates all computation to the shared calibration report helpers.
 */
export const buildNfpCalibrationReport = (
  benchmarkResult: NfpReplayBenchmarkResult,
): NfpCalibrationReport => {
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
