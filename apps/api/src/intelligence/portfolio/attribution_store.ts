/**
 * Trade attribution store.
 *
 * Records every executed trade with the enriched metadata needed to
 * evaluate *why* a trade made or lost money.  Structured around the
 * principle: bucket first, aggregate second, never over-slice.
 *
 * The store is purely in-memory and immutable-by-convention:
 * all mutation helpers return a new store object.
 *
 * Design:
 *  - TradeAttributionRecord  one per executed trade
 *  - AttributionStore        thin wrapper holding an array of records
 *  - buildTradeAttributionRecord   factory that computes derived fields
 *  - addRecord / filterRecords     store manipulation helpers
 */

import {
  bucketConfidence,
  bucketReliability,
  type ConfidenceBucket,
  type ReliabilityBucket,
} from "./attribution_buckets.js";
import type { BlendedExitResult } from "./exit_logic.js";

// ─── Core record type ─────────────────────────────────────────────────────────

/**
 * Full attribution record for a single executed trade.
 *
 * All numeric P&L fields are denominated in the same currency as the
 * originating portfolio (paper-trading: USD by convention).
 */
export type TradeAttributionRecord = {
  /** Unique ID for this attribution record. */
  tradeId: string;
  /** ID of the macro event that triggered this trade. */
  eventId: string;
  /** Macro event family: "cpi" | "fomc" | "nfp". */
  eventFamily: string;
  /** Asset ticker. */
  instrument: string;
  /** Trade direction. */
  direction: "long" | "short";

  // ── Signal quality at entry ────────────────────────────────────────────────

  /** Prediction confidence at the time of the trade (0–1). */
  confidence: number;
  /** Analog reliability score at the time of the trade (0–1). */
  reliability: number;
  /** Coarse confidence tier, used for bucketed performance aggregation. */
  confidenceBucket: ConfidenceBucket;
  /** Coarse reliability tier. */
  reliabilityBucket: ReliabilityBucket;

  // ── Optional enrichment context ────────────────────────────────────────────

  /** ID of the analog cluster that contributed to this prediction. */
  analogCluster?: string;
  /**
   * Benchmark alignment string (e.g. "weak" | "neutral" | "strong").
   * Populated from the benchmark discipline check, if available.
   */
  benchmarkAlignment?: string;

  // ── Holding period and execution ───────────────────────────────────────────

  /** Simulated holding period in minutes. */
  holdingPeriodMinutes: number;
  /** Simulated entry price. */
  entryPrice: number;
  /** Simulated exit price (includes expected move and slippage). */
  exitPrice: number;
  /**
   * Round-trip slippage in basis points (entry + exit combined).
   * Example: 1.5 bps per leg → 3.0 bps total.
   */
  slippageBps: number;

  // ── Outcome ────────────────────────────────────────────────────────────────

  /** Net P&L after slippage. */
  pnl: number;
  /**
   * Return as a percentage of notional (pnl / notional × 100).
   * Example: pnl = 5, notional = 1_000 → returnPct = 0.5.
   */
  returnPct: number;
  /** True when net P&L > 0. */
  isWin: boolean;

  /** ISO timestamp of the trade. */
  timestamp: string;
};

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * In-memory container for attribution records.
 * Treat as immutable — use `addRecord` to append.
 */
export type AttributionStore = {
  readonly records: readonly TradeAttributionRecord[];
};

/** Create an empty attribution store. */
export const createAttributionStore = (): AttributionStore => ({
  records: [],
});

/**
 * Return a new store with `record` appended.
 * Does not mutate the input store.
 */
export const addRecord = (
  store: AttributionStore,
  record: TradeAttributionRecord,
): AttributionStore => ({
  records: [...store.records, record],
});

// ─── Filter helpers ───────────────────────────────────────────────────────────

export type AttributionFilter = {
  eventFamily?: string;
  instrument?: string;
  direction?: "long" | "short";
  confidenceBucket?: ConfidenceBucket;
  reliabilityBucket?: ReliabilityBucket;
  analogCluster?: string;
  /** Only include records at or after this ISO timestamp. */
  since?: string;
};

/**
 * Filter records by any combination of dimensions.
 * Returns a new array — does not mutate the store.
 */
export const filterRecords = (
  store: AttributionStore,
  filter: AttributionFilter = {},
): TradeAttributionRecord[] =>
  store.records.filter((r) => {
    if (filter.eventFamily !== undefined && r.eventFamily !== filter.eventFamily) return false;
    if (filter.instrument !== undefined && r.instrument !== filter.instrument) return false;
    if (filter.direction !== undefined && r.direction !== filter.direction) return false;
    if (filter.confidenceBucket !== undefined && r.confidenceBucket !== filter.confidenceBucket) return false;
    if (filter.reliabilityBucket !== undefined && r.reliabilityBucket !== filter.reliabilityBucket) return false;
    if (filter.analogCluster !== undefined && r.analogCluster !== filter.analogCluster) return false;
    if (filter.since !== undefined && r.timestamp < filter.since) return false;
    return true;
  });

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Input to buildTradeAttributionRecord.
 *
 * Uses a TradeLike shape (subset of execution.ts Trade) rather than
 * importing Trade directly, to avoid a circular dependency between
 * the attribution layer and the execution layer.
 */
export type BuildAttributionParams = {
  /** Subset of Phase 7A Trade fields needed for attribution. */
  trade: {
    asset: string;
    direction: "long" | "short";
    executed_size: number;
    entry_price: number;
    expected_magnitude_bp: number;
    horizon: string;
    simulated_pnl: number;
    executed_at: string;
  };
  tradeId: string;
  eventId: string;
  eventFamily: string;
  /** Prediction confidence (0–1). */
  confidence: number;
  /** Analog reliability score (0–1). */
  reliability: number;
  /** Simulated holding period in minutes. */
  holdingPeriodMinutes: number;
  /**
   * Round-trip slippage in basis points.
   * Default: 0 (no slippage).
   */
  slippageBps?: number;
  analogCluster?: string;
  benchmarkAlignment?: string;
  /**
   * Phase 7B.1: optional multi-horizon blended exit result.
   *
   * When provided, `blendedPnl` and `blendedReturnPct` replace the
   * single-horizon pnl and returnPct in the attribution record.
   * `exitPrice` on the record is set to the medium-horizon exit price,
   * as the most representative single-horizon figure.
   * The single-horizon `slippageBps` parameter is still stored for
   * transparency, even though P&L is sourced from the blended result.
   *
   * When absent, Phase 7B single-horizon behaviour is preserved exactly.
   */
  blendedExitResult?: BlendedExitResult;
};

/**
 * Build a fully-populated TradeAttributionRecord from a completed trade.
 *
 * Single-horizon mode (Phase 7B, default when blendedExitResult is absent):
 *  - exitPrice   = entryPrice × (1 + |magnitudeBp| / 10_000)
 *  - slippageCost= executedSize × entryPrice × slippageBps / 10_000
 *  - pnl         = grossPnl − slippageCost
 *  - returnPct   = pnl / notional × 100
 *  - isWin       = pnl > 0
 *
 * Multi-horizon mode (Phase 7B.1, when blendedExitResult is provided):
 *  - pnl         = blendedExitResult.blendedPnl
 *  - returnPct   = blendedExitResult.blendedReturnPct
 *  - exitPrice   = medium-horizon exit price (most representative)
 *  - isWin       = blendedPnl > 0
 */
export const buildTradeAttributionRecord = (
  params: BuildAttributionParams,
): TradeAttributionRecord => {
  const {
    trade,
    tradeId,
    eventId,
    eventFamily,
    confidence,
    reliability,
    holdingPeriodMinutes,
    slippageBps = 0,
    analogCluster,
    benchmarkAlignment,
    blendedExitResult,
  } = params;

  const notional = trade.executed_size * trade.entry_price;

  let pnl: number;
  let returnPct: number;
  let exitPrice: number;

  if (blendedExitResult) {
    // ── Multi-horizon mode (Phase 7B.1) ──────────────────────────────────────
    // Use blended P&L as the canonical outcome.
    // Exit price comes from the medium horizon (index 1) as the representative.
    pnl       = blendedExitResult.blendedPnl;
    returnPct = blendedExitResult.blendedReturnPct;
    exitPrice = blendedExitResult.horizons[1].exitPrice;
  } else {
    // ── Single-horizon mode (Phase 7B, backward-compatible) ──────────────────
    exitPrice = Number(
      (trade.entry_price * (1 + Math.abs(trade.expected_magnitude_bp) / 10_000)).toFixed(4),
    );
    const slippageCost = Number(((notional * slippageBps) / 10_000).toFixed(2));
    pnl       = Number((trade.simulated_pnl - slippageCost).toFixed(2));
    returnPct = notional > 0 ? Number(((pnl / notional) * 100).toFixed(4)) : 0;
  }

  return {
    tradeId,
    eventId,
    eventFamily,
    instrument: trade.asset,
    direction: trade.direction,
    confidence,
    reliability,
    confidenceBucket: bucketConfidence(confidence),
    reliabilityBucket: bucketReliability(reliability),
    analogCluster,
    benchmarkAlignment,
    holdingPeriodMinutes,
    entryPrice: trade.entry_price,
    exitPrice,
    slippageBps,
    pnl,
    returnPct,
    isWin: pnl > 0,
    timestamp: trade.executed_at,
  };
};
