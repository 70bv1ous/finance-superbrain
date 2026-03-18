/**
 * Replay engine (Phase 7C.2 — validation only).
 *
 * Runs the same TradeAttributionRecord dataset through three modes that
 * mirror the progressive layers of the system:
 *
 *   BASELINE_7A      — all trades, no calibration or trust filtering
 *   CALIBRATION_7B   — only high-confidence trades (simulates 7B gate)
 *   ADAPTIVE_7C      — only high-confidence AND high-reliability trades
 *                      (simulates full adaptive layer gate)
 *
 * No new intelligence is added here.  Filtering is a proxy for what each
 * layer would suppress in a live run — it lets us measure whether the
 * additional complexity improves outcomes on a fixed historical dataset.
 *
 * All functions are pure.  Zero module-level mutable state.
 */

import { computePerformanceSummary } from "./performance_summary.js";
import type { TradeAttributionRecord } from "./attribution_store.js";

// ─── Replay mode ──────────────────────────────────────────────────────────────

export enum ReplayMode {
  BASELINE_7A      = "BASELINE_7A",
  CALIBRATION_7B   = "CALIBRATION_7B",
  ADAPTIVE_7C      = "ADAPTIVE_7C",
}

// ─── Result type ──────────────────────────────────────────────────────────────

export type ReplayResult = {
  /** Which mode produced this result. */
  mode: ReplayMode;
  /** Sum of pnl across all trades in the filtered set. */
  pnl: number;
  /** Win rate (0–1) of the filtered trade set. */
  winRate: number;
  /**
   * Sharpe-like ratio: avgReturnPct / returnStdDev.
   * Named sharpeLike to match the existing codebase convention.
   */
  sharpeLike: number;
  /** Maximum peak-to-trough drawdown of the filtered pnl series. */
  maxDrawdown: number;
  /** Number of trades included in this replay. */
  tradeCount: number;
};

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Run a replay of `trades` under the given `mode`.
 *
 * Filtering logic (applied before metrics are computed):
 *   BASELINE_7A    — all trades pass through
 *   CALIBRATION_7B — keep only trades where confidenceBucket === "high"
 *   ADAPTIVE_7C    — keep only trades where confidenceBucket === "high"
 *                    AND reliabilityBucket === "high"
 *
 * @param trades  Attribution records to replay.
 * @param mode    Which layer-simulation mode to use.
 * @returns       ReplayResult with aggregate performance metrics.
 */
export function runReplay(
  trades: TradeAttributionRecord[],
  mode: ReplayMode,
): ReplayResult {
  let filtered: TradeAttributionRecord[];

  switch (mode) {
    case ReplayMode.BASELINE_7A:
      filtered = trades;
      break;

    case ReplayMode.CALIBRATION_7B:
      filtered = trades.filter((r) => r.confidenceBucket === "high");
      break;

    case ReplayMode.ADAPTIVE_7C:
      filtered = trades.filter(
        (r) => r.confidenceBucket === "high" && r.reliabilityBucket === "high",
      );
      break;

    default: {
      // Exhaustiveness guard — TypeScript should never reach here.
      const _exhaustive: never = mode;
      throw new Error(`Unknown ReplayMode: ${String(_exhaustive)}`);
    }
  }

  const pnl = filtered.reduce((sum, r) => sum + r.pnl, 0);
  const summary = computePerformanceSummary(filtered);

  return {
    mode,
    pnl,
    winRate:     summary.winRate,
    sharpeLike:  summary.sharpeLike,
    maxDrawdown: summary.maxDrawdown,
    tradeCount:  summary.tradeCount,
  };
}
