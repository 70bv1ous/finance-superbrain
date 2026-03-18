/**
 * Performance summary engine.
 *
 * Aggregates a set of TradeAttributionRecords into a PerformanceSummary
 * that describes the statistical quality of those trades.
 *
 * All calculations are deterministic and produce the same output for
 * identical input regardless of order (records are sorted internally
 * for max-drawdown calculations).
 *
 * Design choices:
 *  - Sharpe-like = avgReturnPct / returnStdDev (no annualisation — this
 *    is a dimensionless quality signal, not a proper Sharpe ratio).
 *  - maxDrawdown is calculated on cumulative P&L, not on equity curve,
 *    because the attribution records do not encode portfolio starting cash.
 *  - An empty record set returns a zeroed summary (no division by zero).
 *
 * Phase 7B.2 adds `computeWeightedPerformanceSummary`, which applies
 * exponential time-decay to downweight stale trades.  The unweighted
 * `computePerformanceSummary` is preserved unchanged for backward compat.
 */

import type { TradeAttributionRecord } from "./attribution_store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PerformanceSummary = {
  /** Number of trades in this summary. */
  tradeCount: number;
  /** Fraction of trades with pnl > 0. */
  winRate: number;
  /** Mean P&L per trade. */
  avgPnl: number;
  /** Mean return percentage per trade. */
  avgReturnPct: number;
  /** Standard deviation of per-trade return percentages. */
  returnStdDev: number;
  /**
   * Sharpe-like ratio: avgReturnPct / returnStdDev.
   * Returns 0 when returnStdDev is 0 (all trades identical — treated
   * as a neutral signal, not infinity).
   */
  sharpeLike: number;
  /**
   * Maximum peak-to-trough drawdown on the cumulative P&L series.
   * Expressed as a positive fraction of the running peak
   * (e.g. 0.15 = 15% drawdown from the best cumulative P&L seen).
   * Returns 0 when tradeCount < 2.
   */
  maxDrawdown: number;
};

// ─── Math helpers (exported for testing) ─────────────────────────────────────

/** Arithmetic mean of an array. Returns 0 for empty input. */
export const mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
};

/** Population standard deviation. Returns 0 for fewer than 2 values. */
export const stdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

/**
 * Maximum peak-to-trough drawdown on a series of incremental P&L values.
 *
 * Walks forward through cumulative P&L, tracking the running peak.
 * When the current value is below the peak, the drawdown fraction is
 * (peak - current) / peak.  Returns the maximum such fraction seen.
 *
 * Returns 0 when the series has fewer than 2 values or the peak is ≤ 0.
 */
export const maxDrawdownFromPnlSeries = (pnlValues: number[]): number => {
  if (pnlValues.length < 2) return 0;

  let peak = 0;
  let cumulative = 0;
  let maxDd = 0;

  for (const pnl of pnlValues) {
    cumulative += pnl;
    if (cumulative > peak) {
      peak = cumulative;
    } else if (peak > 0) {
      const dd = (peak - cumulative) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }

  return Number(maxDd.toFixed(4));
};

// ─── Weighted summary types (Phase 7B.2) ─────────────────────────────────────

/**
 * Metadata about the decay applied in a weighted performance summary.
 */
export type DecayInfo = {
  /** Half-life parameter used: weight = exp(-age_days / decayConstantDays). */
  decayConstantDays: number;
  /** The weighting scheme applied. */
  method: "exponential";
};

/**
 * A PerformanceSummary enriched with exponential time-decay weighting.
 *
 * `winRate`, `avgPnl`, `avgReturnPct`, `returnStdDev`, and `sharpeLike`
 * are all computed on the weighted distribution.  Newer trades (relative
 * to `asOf`) receive higher weight; trades older than ~3× decayConstantDays
 * are effectively negligible.
 *
 * `maxDrawdown` is path-dependent and is computed on the unweighted
 * P&L series in chronological order — weighting a path statistic would
 * distort its meaning.
 *
 * `tradeCount` reflects the true number of records; `effectiveSampleSize`
 * is the standard Kish approximation: (Σw)² / Σw².
 */
export type WeightedPerformanceSummary = PerformanceSummary & {
  /** Kish effective sample size: (Σw)² / Σw². */
  effectiveSampleSize: number;
  /** Decay metadata. */
  decayInfo: DecayInfo;
};

// ─── Weighted math helpers ────────────────────────────────────────────────────

/** Weighted mean. Returns 0 if sum of weights is 0. */
export const weightedMean = (values: number[], weights: number[]): number => {
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW === 0) return 0;
  const sumWV = values.reduce((s, v, i) => s + (weights[i] ?? 0) * v, 0);
  return sumWV / sumW;
};

/** Weighted population standard deviation. Returns 0 if fewer than 2 values. */
export const weightedStdDev = (values: number[], weights: number[]): number => {
  if (values.length < 2) return 0;
  const avg = weightedMean(values, weights);
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW === 0) return 0;
  const variance = values.reduce(
    (s, v, i) => s + (weights[i] ?? 0) * (v - avg) ** 2,
    0,
  ) / sumW;
  return Math.sqrt(variance);
};

/**
 * Kish effective sample size: (Σw)² / Σw².
 * Measures how many equally-weighted observations the weighted sample
 * is equivalent to.  Always ≤ n (equals n when all weights are equal).
 */
export const kishEffectiveSampleSize = (weights: number[]): number => {
  if (weights.length === 0) return 0;
  const sumW  = weights.reduce((s, w) => s + w, 0);
  const sumW2 = weights.reduce((s, w) => s + w * w, 0);
  if (sumW2 === 0) return 0;
  return Number(((sumW * sumW) / sumW2).toFixed(2));
};

// ─── Summary computation ──────────────────────────────────────────────────────

/**
 * Compute a PerformanceSummary from a set of attribution records.
 *
 * Returns a zeroed summary when `records` is empty.
 * Records are processed in the order provided — ensure consistent
 * ordering (e.g. by timestamp) before calling if maxDrawdown matters.
 */
export const computePerformanceSummary = (
  records: readonly TradeAttributionRecord[],
): PerformanceSummary => {
  const tradeCount = records.length;

  if (tradeCount === 0) {
    return {
      tradeCount: 0,
      winRate: 0,
      avgPnl: 0,
      avgReturnPct: 0,
      returnStdDev: 0,
      sharpeLike: 0,
      maxDrawdown: 0,
    };
  }

  const wins = records.filter((r) => r.isWin).length;
  const winRate = Number((wins / tradeCount).toFixed(4));

  const pnlValues = records.map((r) => r.pnl);
  const returnValues = records.map((r) => r.returnPct);

  const avgPnl = Number(mean(pnlValues).toFixed(2));
  const avgReturnPct = Number(mean(returnValues).toFixed(4));
  const returnStdDev = Number(stdDev(returnValues).toFixed(4));

  const sharpeLike = returnStdDev > 0
    ? Number((avgReturnPct / returnStdDev).toFixed(4))
    : 0;

  const maxDrawdown = maxDrawdownFromPnlSeries(pnlValues);

  return {
    tradeCount,
    winRate,
    avgPnl,
    avgReturnPct,
    returnStdDev,
    sharpeLike,
    maxDrawdown,
  };
};

// ─── Weighted summary computation (Phase 7B.2) ───────────────────────────────

/**
 * Compute a time-decay-weighted PerformanceSummary.
 *
 * Each record is assigned a weight:
 *   weight = exp(-age_days / decayConstantDays)
 *
 * where age_days is the number of days between the record's timestamp
 * and `asOf` (defaults to the current UTC time).
 *
 * Key properties:
 *  - A record from today has weight 1.0.
 *  - A record `decayConstantDays` days old has weight ≈ 0.368 (1/e).
 *  - At 3× decayConstantDays the weight falls to ≈ 0.050.
 *
 * `maxDrawdown` uses the unweighted chronological P&L series — weighting
 * a path statistic would distort peak-to-trough semantics.
 *
 * Returns a zeroed `WeightedPerformanceSummary` for empty input.
 *
 * @param records             Attribution records to summarise.
 * @param asOf                Reference date for age calculation (ISO string
 *                            or Date). Defaults to `new Date()`.
 * @param decayConstantDays   Half-life parameter (default 180 days).
 */
export const computeWeightedPerformanceSummary = (
  records: readonly TradeAttributionRecord[],
  asOf: Date | string = new Date(),
  decayConstantDays = 180,
): WeightedPerformanceSummary => {
  const decayInfo: DecayInfo = { decayConstantDays, method: "exponential" };
  const zeroBase: PerformanceSummary = {
    tradeCount: 0,
    winRate: 0,
    avgPnl: 0,
    avgReturnPct: 0,
    returnStdDev: 0,
    sharpeLike: 0,
    maxDrawdown: 0,
  };

  if (records.length === 0) {
    return { ...zeroBase, effectiveSampleSize: 0, decayInfo };
  }

  const asOfMs = (asOf instanceof Date ? asOf : new Date(asOf)).getTime();
  const MS_PER_DAY = 86_400_000;

  // Compute per-record weights
  const weights = records.map((r) => {
    const ageDays = Math.max(0, (asOfMs - new Date(r.timestamp).getTime()) / MS_PER_DAY);
    return Math.exp(-ageDays / decayConstantDays);
  });

  const tradeCount = records.length;

  // Weighted win rate: Σ(w_i × isWin_i) / Σw_i
  const winFlags  = records.map((r) => (r.isWin ? 1 : 0));
  const winRate   = Number(weightedMean(winFlags, weights).toFixed(4));

  const pnlValues    = records.map((r) => r.pnl);
  const returnValues = records.map((r) => r.returnPct);

  const avgPnl        = Number(weightedMean(pnlValues, weights).toFixed(2));
  const avgReturnPct  = Number(weightedMean(returnValues, weights).toFixed(4));
  const returnStdDev  = Number(weightedStdDev(returnValues, weights).toFixed(4));

  const sharpeLike = returnStdDev > 0
    ? Number((avgReturnPct / returnStdDev).toFixed(4))
    : 0;

  // maxDrawdown is path-dependent — keep unweighted on chronological series
  const maxDrawdown = maxDrawdownFromPnlSeries(pnlValues);

  const effectiveSampleSize = kishEffectiveSampleSize(weights);

  return {
    tradeCount,
    winRate,
    avgPnl,
    avgReturnPct,
    returnStdDev,
    sharpeLike,
    maxDrawdown,
    effectiveSampleSize,
    decayInfo,
  };
};
