/**
 * Portfolio intelligence summary (Phase 7C.3 — capstone).
 *
 * Aggregates all three replay modes into a single diagnostic report that
 * answers the core question of Phase 7C.2/7C.3:
 *   "Does calibration and adaptive intelligence actually help?"
 *
 * All computation is delegated to the existing replay engine and comparator —
 * no new intelligence is introduced here.
 *
 * Pure function.  Zero module-level mutable state.
 */

import { runReplay, ReplayMode, type ReplayResult } from "./replay_engine.js";
import { compareReplays, type ComparisonReport } from "./replay_comparator.js";
import type { TradeAttributionRecord } from "./attribution_store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * High-level verdict derived from the sharpeLike delta on the 7A → 7C comparison.
 *
 *   "improving"  — adaptive layer improves risk-adjusted returns vs baseline
 *   "mixed"      — no meaningful change (within the ±2 % dead band)
 *   "degrading"  — adaptive layer hurts risk-adjusted returns vs baseline
 */
export type OverallVerdict = "improving" | "mixed" | "degrading";

/**
 * Complete intelligence summary for a trade dataset.
 *
 * Contains the raw replay results for each mode, the three pairwise
 * comparison reports, a single overall verdict, and a human-readable
 * narrative suitable for logging or dashboard display.
 */
export type PortfolioIntelligenceSummary = {
  /** Raw replay result for the 7A baseline (all trades, no filtering). */
  baseline:    ReplayResult;
  /** Raw replay result for 7B calibration (high-confidence trades only). */
  calibration: ReplayResult;
  /** Raw replay result for 7C adaptive (high-confidence + high-reliability). */
  adaptive:    ReplayResult;

  /** Per-metric comparison: 7A → 7B. */
  calibrationVsBaseline:  ComparisonReport;
  /** Per-metric comparison: 7B → 7C. */
  adaptiveVsCalibration:  ComparisonReport;
  /** Per-metric comparison: 7A → 7C (primary verdict driver). */
  adaptiveVsBaseline:     ComparisonReport;

  /**
   * Verdict derived from sharpeLike in adaptiveVsBaseline.
   * This is the single answer to "did the intelligence layer help?"
   */
  overallVerdict: OverallVerdict;

  /**
   * Four-line human-readable narrative.
   * Index 0 — 7A baseline metrics
   * Index 1 — 7B vs 7A sharpeLike movement
   * Index 2 — 7C vs 7B sharpeLike movement
   * Index 3 — Overall 7A → 7C verdict
   */
  narrativeLines: string[];
};

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Build a complete PortfolioIntelligenceSummary for the given trade records.
 *
 * Steps:
 *  1. Run all three replay modes on the same `trades` array.
 *  2. Build the three pairwise comparison reports.
 *  3. Derive overallVerdict from sharpeLike in the 7A → 7C comparison.
 *  4. Build the four narrative lines.
 *
 * @param trades  Attribution records to analyse.
 * @returns       PortfolioIntelligenceSummary — fully self-contained diagnostic.
 */
export function buildPortfolioIntelligenceSummary(
  trades: TradeAttributionRecord[],
): PortfolioIntelligenceSummary {
  // ── Step 1: run all three modes ───────────────────────────────────────────
  const baseline    = runReplay(trades, ReplayMode.BASELINE_7A);
  const calibration = runReplay(trades, ReplayMode.CALIBRATION_7B);
  const adaptive    = runReplay(trades, ReplayMode.ADAPTIVE_7C);

  // ── Step 2: pairwise comparisons ─────────────────────────────────────────
  const calibrationVsBaseline = compareReplays(baseline,    calibration);
  const adaptiveVsCalibration = compareReplays(calibration, adaptive);
  const adaptiveVsBaseline    = compareReplays(baseline,    adaptive);

  // ── Step 3: overall verdict from sharpeLike in 7A → 7C ───────────────────
  const sharpeDeltaAvsC = adaptiveVsBaseline.deltas.find(
    (d) => d.metric === "sharpeLike",
  )!;

  let overallVerdict: OverallVerdict;
  switch (sharpeDeltaAvsC.verdict) {
    case "improved":  overallVerdict = "improving"; break;
    case "neutral":   overallVerdict = "mixed";     break;
    case "degraded":  overallVerdict = "degrading"; break;
  }

  // ── Step 4: narrative lines ───────────────────────────────────────────────
  const sharpeDeltaAvsB = calibrationVsBaseline.deltas.find(
    (d) => d.metric === "sharpeLike",
  )!;
  const sharpeDeltaBvsC = adaptiveVsCalibration.deltas.find(
    (d) => d.metric === "sharpeLike",
  )!;

  const narrativeLines: string[] = [
    `7A baseline: tradeCount=${baseline.tradeCount}, sharpeLike=${baseline.sharpeLike}`,
    `7B calibration vs 7A: sharpeLike ${sharpeDeltaAvsB.verdict} (delta=${sharpeDeltaAvsB.delta.toFixed(4)})`,
    `7C adaptive vs 7B: sharpeLike ${sharpeDeltaBvsC.verdict} (delta=${sharpeDeltaBvsC.delta.toFixed(4)})`,
    `Overall 7A→7C: ${overallVerdict} (sharpeLike delta=${sharpeDeltaAvsC.delta.toFixed(4)})`,
  ];

  return {
    baseline,
    calibration,
    adaptive,
    calibrationVsBaseline,
    adaptiveVsCalibration,
    adaptiveVsBaseline,
    overallVerdict,
    narrativeLines,
  };
}
