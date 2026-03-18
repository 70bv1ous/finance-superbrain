/**
 * Replay comparator (Phase 7C.2 — validation only).
 *
 * Given two ReplayResults, produces a ComparisonReport showing per-metric
 * deltas and a verdict for each metric.
 *
 * Verdict rules:
 *   1. |pctChange| < 2 → "neutral"          (dead band — noise suppression)
 *   2. pnl / winRate / sharpeLike / tradeCount:
 *        delta > 0 → "improved", else "degraded"
 *   3. maxDrawdown:
 *        delta < 0 → "improved" (lower drawdown is better), else "degraded"
 *
 * All functions are pure.  Zero module-level mutable state.
 */

import type { ReplayResult } from "./replay_engine.js";
import { ReplayMode } from "./replay_engine.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Verdict = "improved" | "degraded" | "neutral";

export type MetricDelta = {
  /** Name of the metric being compared. */
  metric: string;
  /** Value in the baseline replay. */
  baseline: number;
  /** Value in the comparison replay. */
  comparison: number;
  /** comparison − baseline. */
  delta: number;
  /**
   * Percentage change relative to the absolute baseline value.
   * 0 when baseline === 0 to avoid division by zero.
   */
  pctChange: number;
  /** Whether the change represents an improvement, degradation, or is noise. */
  verdict: Verdict;
};

export type ComparisonReport = {
  from: ReplayMode;
  to:   ReplayMode;
  /** One MetricDelta entry for each of the 5 compared metrics. */
  deltas: MetricDelta[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Metrics where a lower value is better (e.g. drawdown). */
const LOWER_IS_BETTER = new Set<string>(["maxDrawdown"]);

function computeVerdict(
  metric: string,
  delta: number,
  pctChange: number,
): Verdict {
  if (Math.abs(pctChange) < 2) return "neutral";
  if (LOWER_IS_BETTER.has(metric)) {
    return delta < 0 ? "improved" : "degraded";
  }
  return delta > 0 ? "improved" : "degraded";
}

function buildDelta(
  metric: string,
  baselineVal: number,
  comparisonVal: number,
): MetricDelta {
  const delta     = comparisonVal - baselineVal;
  const pctChange = baselineVal === 0
    ? 0
    : (delta / Math.abs(baselineVal)) * 100;
  const verdict   = computeVerdict(metric, delta, pctChange);
  return { metric, baseline: baselineVal, comparison: comparisonVal, delta, pctChange, verdict };
}

// ─── Comparator ───────────────────────────────────────────────────────────────

/**
 * Compare two replay results and produce a per-metric report.
 *
 * Metrics compared: pnl, winRate, sharpeLike, maxDrawdown, tradeCount.
 *
 * @param baseline    The reference result (typically BASELINE_7A or 7B).
 * @param comparison  The result being evaluated against the baseline.
 * @returns           ComparisonReport with one MetricDelta per metric.
 */
export function compareReplays(
  baseline:   ReplayResult,
  comparison: ReplayResult,
): ComparisonReport {
  const deltas: MetricDelta[] = [
    buildDelta("pnl",        baseline.pnl,        comparison.pnl),
    buildDelta("winRate",    baseline.winRate,     comparison.winRate),
    buildDelta("sharpeLike", baseline.sharpeLike,  comparison.sharpeLike),
    buildDelta("maxDrawdown",baseline.maxDrawdown, comparison.maxDrawdown),
    buildDelta("tradeCount", baseline.tradeCount,  comparison.tradeCount),
  ];

  return {
    from:   baseline.mode,
    to:     comparison.mode,
    deltas,
  };
}
