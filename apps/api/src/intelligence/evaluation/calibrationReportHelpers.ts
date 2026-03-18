/**
 * Shared calibration report types and builder helpers.
 *
 * All three event families (CPI, FOMC, NFP) produce structurally identical
 * calibration reports. The types and helper functions here are the single
 * source of truth. Family-specific files import from this module and add
 * their own type aliases and public builder function.
 *
 * Nothing in this file is domain-specific — no event fields, no family
 * logic, no similarity weights.
 */

// ─── Shared sub-report types ──────────────────────────────────────────────────

export type CalibrationComparison = {
  /** Mean |baseline_confidence − direction_score| across all replayed cases */
  mean_baseline_error: number;
  /** Mean |enriched_confidence − direction_score| across all replayed cases */
  mean_enriched_error: number;
  /**
   * mean_baseline_error − mean_enriched_error.
   * Positive → memory reduced calibration error overall.
   */
  mean_improvement: number;
  /** Cases where calibration_improvement > 0 */
  improved_count: number;
  /** Cases where calibration_improvement < 0 */
  worsened_count: number;
  /** Cases where calibration_improvement === 0 */
  unchanged_count: number;
};

/** Measures how precise the analog caution signal is. */
export type CautionPrecision = {
  /** Number of cases where analog_boost < 0 */
  caution_issued: number;
  /** Of those, how many had verdict "wrong" or "partially_correct" */
  caution_correct: number;
  /**
   * caution_correct / caution_issued, or null when caution_issued === 0.
   * Higher is better — the caution signal was justified.
   */
  caution_precision: number | null;
};

/** Measures how precise the analog reinforcement signal is. */
export type ReinforcementPrecision = {
  /** Number of cases where analog_boost > 0 */
  reinforcement_issued: number;
  /** Of those, how many had verdict "correct" */
  reinforcement_correct: number;
  /**
   * reinforcement_correct / reinforcement_issued, or null when reinforcement_issued === 0.
   * Higher is better — reinforcement aligned with actual success.
   */
  reinforcement_precision: number | null;
};

/**
 * Per-cluster breakdown showing whether memory enrichment helps or hurts
 * predictions within each macro-theme bucket.
 */
export type ClusterBenchmarkEntry = {
  cluster_id: string;
  /** Number of cases replayed under this cluster */
  case_count: number;
  /** Mean calibration_improvement across cases in this cluster */
  mean_improvement: number;
  /**
   * Summary of whether analogs in this cluster are net beneficial.
   *
   *   helps              mean_improvement > 0.02
   *   hurts              mean_improvement < -0.02
   *   neutral            |mean_improvement| ≤ 0.02
   *   insufficient_data  fewer than 3 cases in this cluster (during replay)
   */
  verdict: "helps" | "hurts" | "neutral" | "insufficient_data";
};

export type MemoryVerdict = "improving" | "neutral" | "degrading";

// ─── Minimal replay record interface ─────────────────────────────────────────

/**
 * The fields from a replay record that the calibration report builders need.
 * All three family-specific replay record types satisfy this interface.
 */
export type BaseReplayRecord = {
  baseline_calibration_error: number;
  enriched_calibration_error: number;
  calibration_improvement: number;
  analog_boost: number;
  verdict: "correct" | "wrong" | "partially_correct";
  cluster_id: string;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const round = (v: number) => Number(v.toFixed(4));

const avg = (values: number[]): number =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

// ─── Shared builder functions ─────────────────────────────────────────────────

export const buildCalibrationComparison = (
  records: BaseReplayRecord[],
): CalibrationComparison => {
  const mean_baseline_error = round(avg(records.map((r) => r.baseline_calibration_error)));
  const mean_enriched_error = round(avg(records.map((r) => r.enriched_calibration_error)));
  const mean_improvement = round(mean_baseline_error - mean_enriched_error);

  return {
    mean_baseline_error,
    mean_enriched_error,
    mean_improvement,
    improved_count: records.filter((r) => r.calibration_improvement > 0).length,
    worsened_count: records.filter((r) => r.calibration_improvement < 0).length,
    unchanged_count: records.filter((r) => r.calibration_improvement === 0).length,
  };
};

export const buildCautionPrecision = (records: BaseReplayRecord[]): CautionPrecision => {
  const cautionCases = records.filter((r) => r.analog_boost < 0);
  const caution_issued = cautionCases.length;
  const caution_correct = cautionCases.filter(
    (r) => r.verdict === "wrong" || r.verdict === "partially_correct",
  ).length;

  return {
    caution_issued,
    caution_correct,
    caution_precision:
      caution_issued > 0 ? round(caution_correct / caution_issued) : null,
  };
};

export const buildReinforcementPrecision = (
  records: BaseReplayRecord[],
): ReinforcementPrecision => {
  const reinforcementCases = records.filter((r) => r.analog_boost > 0);
  const reinforcement_issued = reinforcementCases.length;
  const reinforcement_correct = reinforcementCases.filter(
    (r) => r.verdict === "correct",
  ).length;

  return {
    reinforcement_issued,
    reinforcement_correct,
    reinforcement_precision:
      reinforcement_issued > 0
        ? round(reinforcement_correct / reinforcement_issued)
        : null,
  };
};

export const buildClusterEntries = (
  records: BaseReplayRecord[],
): ClusterBenchmarkEntry[] => {
  const byCluster = new Map<string, BaseReplayRecord[]>();

  for (const r of records) {
    const bucket = byCluster.get(r.cluster_id) ?? [];
    bucket.push(r);
    byCluster.set(r.cluster_id, bucket);
  }

  const entries: ClusterBenchmarkEntry[] = [];

  for (const [cluster_id, clusterRecords] of byCluster) {
    const case_count = clusterRecords.length;
    const mean_improvement = round(
      avg(clusterRecords.map((r) => r.calibration_improvement)),
    );

    let verdict: ClusterBenchmarkEntry["verdict"];
    if (case_count < 3) {
      verdict = "insufficient_data";
    } else if (mean_improvement > 0.02) {
      verdict = "helps";
    } else if (mean_improvement < -0.02) {
      verdict = "hurts";
    } else {
      verdict = "neutral";
    }

    entries.push({ cluster_id, case_count, mean_improvement, verdict });
  }

  // Sort deterministically: by case_count descending, then cluster_id ascending
  entries.sort(
    (a, b) => b.case_count - a.case_count || a.cluster_id.localeCompare(b.cluster_id),
  );

  return entries;
};

export const resolveMemoryVerdict = (cal: CalibrationComparison): MemoryVerdict => {
  if (cal.mean_improvement > 0.02 && cal.improved_count > cal.worsened_count) {
    return "improving";
  }
  if (cal.mean_improvement < -0.02 || cal.worsened_count > cal.improved_count) {
    return "degrading";
  }
  return "neutral";
};
