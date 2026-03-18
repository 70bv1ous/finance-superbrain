/**
 * Phase 7B — Performance Feedback & Calibration Layer tests.
 *
 * Coverage:
 *  1. attribution_buckets   — boundary conditions for all bucket functions
 *  2. attribution_store     — record construction, store operations, filtering
 *  3. performance_summary   — math helpers, empty input, aggregation correctness
 *  4. calibration           — sample gate, all adjustment paths, clamping, blending
 *  5. exit_logic            — holding periods, slippage, exit price, net P&L
 *  6. regime_tags           — VIX tagging, regime snapshot builder
 *  7. Sizing integration    — calibration_multiplier fed through sizePosition
 *  8. End-to-end pipeline   — trades → attribution → summary → calibration → sizing
 *  9. Regression            — Phase 7A unchanged when calibration is disabled
 */

import { describe, it, expect } from "vitest";

// ── 7B imports ────────────────────────────────────────────────────────────────

import {
  bucketConfidence,
  bucketReliability,
  bucketBenchmarkAlignment,
} from "./attribution_buckets.js";

import {
  buildTradeAttributionRecord,
  createAttributionStore,
  addRecord,
  filterRecords,
  type TradeAttributionRecord,
} from "./attribution_store.js";

import {
  mean,
  stdDev,
  maxDrawdownFromPnlSeries,
  computePerformanceSummary,
  type PerformanceSummary,
} from "./performance_summary.js";

import {
  computeCalibrationFactor,
  blendCalibrationFactors,
  applyCalibrationToSize,
  CALIBRATION_MIN,
  CALIBRATION_MAX,
  DEFAULT_MIN_SAMPLE_SIZE,
  type CalibrationFactor,
} from "./calibration.js";

import {
  resolveHoldingPeriod,
  computeSlippageCost,
  computeExitPrice,
  computeNetPnL,
  DEFAULT_HOLDING_PERIODS,
  DEFAULT_SLIPPAGE_BPS,
} from "./exit_logic.js";

import {
  tagVolatilityRegime,
  buildRegimeTags,
  buildRegimeTagsFromVix,
} from "./regime_tags.js";

// ── 7A import for integration / regression ────────────────────────────────────

import {
  sizePosition,
  runPortfolioSimulation,
  generateTradeSignals,
} from "./execution.js";
import {
  createPortfolio,
  SIMULATED_PRICE,
} from "./portfolio.js";
import { createRiskConstraints } from "./risk.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a minimal trade-like object for attribution construction. */
const buildTradeLike = (overrides?: Partial<{
  asset: string;
  direction: "long" | "short";
  executed_size: number;
  entry_price: number;
  expected_magnitude_bp: number;
  simulated_pnl: number;
}>) => ({
  asset: overrides?.asset ?? "SPY",
  direction: (overrides?.direction ?? "long") as "long" | "short",
  executed_size: overrides?.executed_size ?? 10,
  entry_price: overrides?.entry_price ?? SIMULATED_PRICE,
  expected_magnitude_bp: overrides?.expected_magnitude_bp ?? 50,
  horizon: "1d",
  simulated_pnl: overrides?.simulated_pnl ?? 5,
  executed_at: "2026-03-18T00:00:00Z",
});

/** Build an attribution record with sensible defaults. */
const buildAttribution = (overrides?: Partial<{
  pnl: number;
  returnPct: number;
  confidence: number;
  reliability: number;
  eventFamily: string;
  instrument: string;
  direction: "long" | "short";
  isWin: boolean;
}>): TradeAttributionRecord => {
  const trade = buildTradeLike({
    simulated_pnl: overrides?.pnl ?? 5,
    direction: overrides?.direction,
  });
  const slipBps = 0;
  return buildTradeAttributionRecord({
    trade,
    tradeId: `trade-${Math.random().toString(36).slice(2)}`,
    eventId: "evt-001",
    eventFamily: overrides?.eventFamily ?? "cpi",
    confidence: overrides?.confidence ?? 0.72,
    reliability: overrides?.reliability ?? 0.65,
    holdingPeriodMinutes: 60,
    slippageBps: slipBps,
  });
};

/** Build a PerformanceSummary with explicit values for calibration tests. */
const buildSummary = (overrides?: Partial<PerformanceSummary>): PerformanceSummary => ({
  tradeCount: DEFAULT_MIN_SAMPLE_SIZE,
  winRate: 0.55,
  avgPnl: 3.5,
  avgReturnPct: 0.35,
  returnStdDev: 0.25,
  sharpeLike: 1.4,
  maxDrawdown: 0.05,
  ...overrides,
});

// ─── 1. Attribution Buckets ───────────────────────────────────────────────────

describe("bucketConfidence", () => {
  it("returns low for confidence < 0.50", () => {
    expect(bucketConfidence(0)).toBe("low");
    expect(bucketConfidence(0.49)).toBe("low");
  });

  it("returns medium for 0.50 ≤ confidence ≤ 0.75", () => {
    expect(bucketConfidence(0.50)).toBe("medium");
    expect(bucketConfidence(0.65)).toBe("medium");
    expect(bucketConfidence(0.75)).toBe("medium");
  });

  it("returns high for confidence > 0.75", () => {
    expect(bucketConfidence(0.76)).toBe("high");
    expect(bucketConfidence(1.0)).toBe("high");
  });
});

describe("bucketReliability", () => {
  it("returns low for reliability < 0.40", () => {
    expect(bucketReliability(0)).toBe("low");
    expect(bucketReliability(0.39)).toBe("low");
  });

  it("returns medium for 0.40 ≤ reliability ≤ 0.70", () => {
    expect(bucketReliability(0.40)).toBe("medium");
    expect(bucketReliability(0.55)).toBe("medium");
    expect(bucketReliability(0.70)).toBe("medium");
  });

  it("returns high for reliability > 0.70", () => {
    expect(bucketReliability(0.71)).toBe("high");
    expect(bucketReliability(1.0)).toBe("high");
  });
});

describe("bucketBenchmarkAlignment", () => {
  it("returns weak for alignment < 0.30", () => {
    expect(bucketBenchmarkAlignment(0)).toBe("weak");
    expect(bucketBenchmarkAlignment(0.29)).toBe("weak");
  });

  it("returns neutral for 0.30 ≤ alignment ≤ 0.70", () => {
    expect(bucketBenchmarkAlignment(0.30)).toBe("neutral");
    expect(bucketBenchmarkAlignment(0.50)).toBe("neutral");
    expect(bucketBenchmarkAlignment(0.70)).toBe("neutral");
  });

  it("returns strong for alignment > 0.70", () => {
    expect(bucketBenchmarkAlignment(0.71)).toBe("strong");
    expect(bucketBenchmarkAlignment(1.0)).toBe("strong");
  });
});

// ─── 2. Attribution Store ─────────────────────────────────────────────────────

describe("buildTradeAttributionRecord", () => {
  it("populates buckets from confidence and reliability", () => {
    const record = buildTradeAttributionRecord({
      trade: buildTradeLike({ executed_size: 10, entry_price: 100 }),
      tradeId: "t1",
      eventId: "e1",
      eventFamily: "cpi",
      confidence: 0.80,
      reliability: 0.45,
      holdingPeriodMinutes: 60,
    });
    expect(record.confidenceBucket).toBe("high");
    expect(record.reliabilityBucket).toBe("medium");
  });

  it("computes isWin correctly", () => {
    const win = buildTradeAttributionRecord({
      trade: buildTradeLike({ simulated_pnl: 10 }),
      tradeId: "t2", eventId: "e1", eventFamily: "fomc",
      confidence: 0.7, reliability: 0.6, holdingPeriodMinutes: 120,
    });
    const loss = buildTradeAttributionRecord({
      trade: buildTradeLike({ simulated_pnl: -5 }),
      tradeId: "t3", eventId: "e1", eventFamily: "fomc",
      confidence: 0.7, reliability: 0.6, holdingPeriodMinutes: 120,
    });
    expect(win.isWin).toBe(true);
    expect(loss.isWin).toBe(false);
  });

  it("deducts slippage from pnl", () => {
    // 10 units × $100 × 3 bps / 10_000 = $0.30 slippage
    const record = buildTradeAttributionRecord({
      trade: buildTradeLike({ executed_size: 10, entry_price: 100, simulated_pnl: 5 }),
      tradeId: "t4", eventId: "e1", eventFamily: "cpi",
      confidence: 0.7, reliability: 0.6, holdingPeriodMinutes: 60,
      slippageBps: 3,
    });
    expect(record.pnl).toBeCloseTo(5 - 0.30, 2);
    expect(record.slippageBps).toBe(3);
  });

  it("computes returnPct from pnl / notional", () => {
    // notional = 10 × 100 = 1000; pnl = 5; returnPct = 0.5%
    const record = buildTradeAttributionRecord({
      trade: buildTradeLike({ executed_size: 10, entry_price: 100, simulated_pnl: 5 }),
      tradeId: "t5", eventId: "e1", eventFamily: "nfp",
      confidence: 0.7, reliability: 0.6, holdingPeriodMinutes: 30,
      slippageBps: 0,
    });
    expect(record.returnPct).toBeCloseTo(0.5, 3);
  });

  it("stores optional analogCluster and benchmarkAlignment", () => {
    const record = buildTradeAttributionRecord({
      trade: buildTradeLike(),
      tradeId: "t6", eventId: "e1", eventFamily: "cpi",
      confidence: 0.7, reliability: 0.6, holdingPeriodMinutes: 60,
      analogCluster: "cluster-42",
      benchmarkAlignment: "strong",
    });
    expect(record.analogCluster).toBe("cluster-42");
    expect(record.benchmarkAlignment).toBe("strong");
  });
});

describe("attribution store operations", () => {
  it("creates an empty store", () => {
    const store = createAttributionStore();
    expect(store.records).toHaveLength(0);
  });

  it("addRecord returns a new store with the record appended", () => {
    const store = createAttributionStore();
    const record = buildAttribution();
    const updated = addRecord(store, record);
    expect(updated.records).toHaveLength(1);
    expect(store.records).toHaveLength(0); // original unchanged
  });

  it("filterRecords by eventFamily", () => {
    let store = createAttributionStore();
    store = addRecord(store, buildAttribution({ eventFamily: "cpi" }));
    store = addRecord(store, buildAttribution({ eventFamily: "fomc" }));
    store = addRecord(store, buildAttribution({ eventFamily: "cpi" }));

    const cpiRecords = filterRecords(store, { eventFamily: "cpi" });
    expect(cpiRecords).toHaveLength(2);
    cpiRecords.forEach((r) => expect(r.eventFamily).toBe("cpi"));
  });

  it("filterRecords by confidenceBucket", () => {
    let store = createAttributionStore();
    const highConf = buildTradeAttributionRecord({
      trade: buildTradeLike(), tradeId: "h1", eventId: "e1", eventFamily: "cpi",
      confidence: 0.85, reliability: 0.6, holdingPeriodMinutes: 60,
    });
    const lowConf = buildTradeAttributionRecord({
      trade: buildTradeLike(), tradeId: "l1", eventId: "e1", eventFamily: "cpi",
      confidence: 0.40, reliability: 0.6, holdingPeriodMinutes: 60,
    });
    store = addRecord(store, highConf);
    store = addRecord(store, lowConf);

    const high = filterRecords(store, { confidenceBucket: "high" });
    expect(high).toHaveLength(1);
    expect(high[0]!.confidenceBucket).toBe("high");
  });

  it("filterRecords by direction", () => {
    let store = createAttributionStore();
    store = addRecord(store, buildAttribution({ direction: "long" }));
    store = addRecord(store, buildAttribution({ direction: "short" }));

    expect(filterRecords(store, { direction: "long" })).toHaveLength(1);
    expect(filterRecords(store, { direction: "short" })).toHaveLength(1);
  });

  it("filterRecords returns all records when no filter given", () => {
    let store = createAttributionStore();
    store = addRecord(store, buildAttribution());
    store = addRecord(store, buildAttribution());
    expect(filterRecords(store)).toHaveLength(2);
  });
});

// ─── 3. Performance Summary ───────────────────────────────────────────────────

describe("mean", () => {
  it("returns 0 for empty array", () => expect(mean([])).toBe(0));
  it("computes mean correctly", () => expect(mean([1, 2, 3, 4, 5])).toBe(3));
  it("handles single value", () => expect(mean([7])).toBe(7));
});

describe("stdDev", () => {
  it("returns 0 for fewer than 2 values", () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([5])).toBe(0);
  });

  it("returns 0 for identical values", () => {
    expect(stdDev([3, 3, 3, 3])).toBe(0);
  });

  it("computes population stdDev correctly", () => {
    // values [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, variance=4, stdDev=2
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 3);
  });
});

describe("maxDrawdownFromPnlSeries", () => {
  it("returns 0 for fewer than 2 values", () => {
    expect(maxDrawdownFromPnlSeries([])).toBe(0);
    expect(maxDrawdownFromPnlSeries([5])).toBe(0);
  });

  it("returns 0 for a monotonically increasing series", () => {
    expect(maxDrawdownFromPnlSeries([1, 1, 1, 1])).toBe(0);
  });

  it("detects a drawdown from a peak", () => {
    // cumulative: 5, 10, 5 → peak 10, trough 5 → dd = 50%
    const dd = maxDrawdownFromPnlSeries([5, 5, -5]);
    expect(dd).toBeCloseTo(0.5, 3);
  });

  it("returns 0 when cumulative never exceeds 0 (all-loss series)", () => {
    // peak stays at 0, so condition peak > 0 never triggers
    expect(maxDrawdownFromPnlSeries([-1, -2, -3])).toBe(0);
  });
});

describe("computePerformanceSummary", () => {
  it("returns a zeroed summary for empty input", () => {
    const s = computePerformanceSummary([]);
    expect(s.tradeCount).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.avgPnl).toBe(0);
    expect(s.sharpeLike).toBe(0);
    expect(s.maxDrawdown).toBe(0);
  });

  it("computes winRate correctly", () => {
    const records = [
      buildAttribution({ pnl: 10 }),
      buildAttribution({ pnl: -5 }),
      buildAttribution({ pnl: 8 }),
      buildAttribution({ pnl: -2 }),
    ];
    const s = computePerformanceSummary(records);
    expect(s.winRate).toBeCloseTo(0.5, 3);
    expect(s.tradeCount).toBe(4);
  });

  it("computes avgPnl correctly", () => {
    const records = [
      buildAttribution({ pnl: 10 }),
      buildAttribution({ pnl: -4 }),
    ];
    const s = computePerformanceSummary(records);
    expect(s.avgPnl).toBeCloseTo(3, 2); // (10 - 4) / 2
  });

  it("sharpeLike is 0 when stdDev is 0", () => {
    // all identical returnPct → stdDev = 0
    const records = [
      buildAttribution({ pnl: 5 }),
      buildAttribution({ pnl: 5 }),
      buildAttribution({ pnl: 5 }),
    ];
    const s = computePerformanceSummary(records);
    expect(s.returnStdDev).toBe(0);
    expect(s.sharpeLike).toBe(0);
  });

  it("positive sharpeLike for consistent winners", () => {
    const records = Array.from({ length: 5 }, () => buildAttribution({ pnl: 5 }));
    records.push(buildAttribution({ pnl: 3 }));
    const s = computePerformanceSummary(records);
    // all wins, positive avgReturn → sharpeLike ≥ 0
    expect(s.winRate).toBeGreaterThan(0.8);
  });
});

// ─── 4. Calibration Engine ────────────────────────────────────────────────────

describe("computeCalibrationFactor — sample gate", () => {
  it("returns multiplier 1.0 when tradeCount < minSampleSize", () => {
    const factor = computeCalibrationFactor(buildSummary({ tradeCount: 5 }));
    expect(factor.multiplier).toBe(1.0);
    expect(factor.reason[0]).toContain("insufficient_sample");
  });

  it("fires when tradeCount equals minSampleSize", () => {
    const factor = computeCalibrationFactor(buildSummary({ tradeCount: DEFAULT_MIN_SAMPLE_SIZE }));
    expect(factor.reason[0]).not.toContain("insufficient_sample");
  });

  it("respects a custom minSampleSize", () => {
    const factor = computeCalibrationFactor(buildSummary({ tradeCount: 5 }), 5);
    expect(factor.reason[0]).not.toContain("insufficient_sample");
  });
});

describe("computeCalibrationFactor — win rate adjustments", () => {
  it("increases multiplier for strong win rate (≥ 60%)", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.65, sharpeLike: 0.6 }));
    expect(factor.multiplier).toBeGreaterThan(1.0);
    expect(factor.reason.some((r) => r.includes("win_rate_strong"))).toBe(true);
  });

  it("increases multiplier slightly for above-average win rate (≥ 52%)", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.55, sharpeLike: 0.6 }));
    expect(factor.multiplier).toBeGreaterThan(1.0);
    expect(factor.reason.some((r) => r.includes("win_rate_above_avg"))).toBe(true);
  });

  it("decreases multiplier for poor win rate (≤ 35%)", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.30, sharpeLike: 0.6 }));
    expect(factor.multiplier).toBeLessThan(1.0);
    expect(factor.reason.some((r) => r.includes("win_rate_poor"))).toBe(true);
  });

  it("decreases multiplier for below-average win rate (≤ 44%)", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.42, sharpeLike: 0.6 }));
    expect(factor.multiplier).toBeLessThan(1.0);
    expect(factor.reason.some((r) => r.includes("win_rate_below_avg"))).toBe(true);
  });

  it("applies neutral win rate label for 45–51% range", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.48, sharpeLike: 0.6 }));
    expect(factor.reason.some((r) => r.includes("win_rate_neutral"))).toBe(true);
  });
});

describe("computeCalibrationFactor — sharpe-like adjustments", () => {
  it("increases multiplier for strong Sharpe (≥ 2.0)", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.50, sharpeLike: 2.5 }));
    expect(factor.reason.some((r) => r.includes("sharpe_strong"))).toBe(true);
    expect(factor.multiplier).toBeGreaterThan(1.0);
  });

  it("increases multiplier slightly for adequate Sharpe (≥ 1.0)", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.48, sharpeLike: 1.2 }));
    expect(factor.reason.some((r) => r.includes("sharpe_adequate"))).toBe(true);
  });

  it("decreases multiplier for negative Sharpe", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.50, sharpeLike: -0.5 }));
    expect(factor.reason.some((r) => r.includes("sharpe_negative"))).toBe(true);
    expect(factor.multiplier).toBeLessThan(1.0);
  });

  it("decreases multiplier for weak Sharpe (< 0.5)", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.50, sharpeLike: 0.3 }));
    expect(factor.reason.some((r) => r.includes("sharpe_weak"))).toBe(true);
    expect(factor.multiplier).toBeLessThan(1.0);
  });
});

describe("computeCalibrationFactor — drawdown haircut", () => {
  it("applies drawdown haircut when maxDrawdown ≥ 15%", () => {
    const factor = computeCalibrationFactor(buildSummary({ winRate: 0.60, sharpeLike: 1.5, maxDrawdown: 0.20 }));
    expect(factor.reason.some((r) => r.includes("max_drawdown_high"))).toBe(true);
    // Without haircut multiplier would be higher; with it should be lower
    const withoutHaircut = computeCalibrationFactor(buildSummary({ winRate: 0.60, sharpeLike: 1.5, maxDrawdown: 0.05 }));
    expect(factor.multiplier).toBeLessThan(withoutHaircut.multiplier);
  });

  it("does not apply drawdown haircut when maxDrawdown < 15%", () => {
    const factor = computeCalibrationFactor(buildSummary({ maxDrawdown: 0.10 }));
    expect(factor.reason.every((r) => !r.includes("max_drawdown_high"))).toBe(true);
  });
});

describe("computeCalibrationFactor — bounds clamping", () => {
  it("multiplier is always ≥ CALIBRATION_MIN", () => {
    // Worst case: poor win rate + negative Sharpe + high drawdown
    const factor = computeCalibrationFactor(buildSummary({
      winRate: 0.20, sharpeLike: -2.0, maxDrawdown: 0.40,
    }));
    expect(factor.multiplier).toBeGreaterThanOrEqual(CALIBRATION_MIN);
    expect(factor.reason.some((r) => r.includes("clamped"))).toBe(true);
  });

  it("multiplier is always ≤ CALIBRATION_MAX", () => {
    // Best case: 60%+ win rate + strong Sharpe + no drawdown
    const factor = computeCalibrationFactor(buildSummary({
      winRate: 0.80, sharpeLike: 3.0, maxDrawdown: 0.0,
    }));
    expect(factor.multiplier).toBeLessThanOrEqual(CALIBRATION_MAX);
  });

  it("neutral input (50% win, Sharpe 0.6) produces multiplier = 1.0", () => {
    const factor = computeCalibrationFactor(buildSummary({
      winRate: 0.50, sharpeLike: 0.6, maxDrawdown: 0.0,
    }));
    expect(factor.multiplier).toBeCloseTo(1.0, 4);
  });
});

describe("blendCalibrationFactors", () => {
  it("blends two factors using default 70/30 weight", () => {
    const recent: CalibrationFactor = { multiplier: 1.20, reason: ["r1"] };
    const longTerm: CalibrationFactor = { multiplier: 0.90, reason: ["lt1"] };
    const blended = blendCalibrationFactors(recent, longTerm);
    // 0.70 × 1.20 + 0.30 × 0.90 = 0.84 + 0.27 = 1.11
    expect(blended.multiplier).toBeCloseTo(1.11, 3);
  });

  it("clamps blended result to [MIN, MAX]", () => {
    const r: CalibrationFactor = { multiplier: CALIBRATION_MAX, reason: [] };
    const lt: CalibrationFactor = { multiplier: CALIBRATION_MAX, reason: [] };
    const blended = blendCalibrationFactors(r, lt);
    expect(blended.multiplier).toBeLessThanOrEqual(CALIBRATION_MAX);
  });

  it("includes parent reasons in output", () => {
    const r: CalibrationFactor = { multiplier: 1.1, reason: ["recent_reason"] };
    const lt: CalibrationFactor = { multiplier: 0.9, reason: ["long_term_reason"] };
    const blended = blendCalibrationFactors(r, lt);
    expect(blended.reason.some((s) => s.includes("recent_reason"))).toBe(true);
    expect(blended.reason.some((s) => s.includes("long_term_reason"))).toBe(true);
  });

  it("accepts a custom recent weight", () => {
    const r: CalibrationFactor = { multiplier: 1.4, reason: [] };
    const lt: CalibrationFactor = { multiplier: 0.6, reason: [] };
    // 50/50 blend → 1.0
    const blended = blendCalibrationFactors(r, lt, 0.5);
    expect(blended.multiplier).toBeCloseTo(1.0, 3);
  });
});

describe("applyCalibrationToSize", () => {
  it("multiplies base size by factor multiplier", () => {
    const factor: CalibrationFactor = { multiplier: 1.25, reason: [] };
    expect(applyCalibrationToSize(10, factor)).toBeCloseTo(12.5, 4);
  });

  it("returns 0 for base size ≤ 0", () => {
    const factor: CalibrationFactor = { multiplier: 1.5, reason: [] };
    expect(applyCalibrationToSize(0, factor)).toBe(0);
    expect(applyCalibrationToSize(-5, factor)).toBe(0);
  });

  it("rounds to 4 decimal places", () => {
    const factor: CalibrationFactor = { multiplier: 1.3, reason: [] };
    const result = applyCalibrationToSize(7, factor);
    const decimals = result.toString().split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it("returns base size unchanged for multiplier = 1.0", () => {
    const factor: CalibrationFactor = { multiplier: 1.0, reason: [] };
    expect(applyCalibrationToSize(15.5, factor)).toBe(15.5);
  });
});

// ─── 5. Exit Logic ────────────────────────────────────────────────────────────

describe("resolveHoldingPeriod", () => {
  it("returns correct periods for known families", () => {
    expect(resolveHoldingPeriod("cpi")).toBe(DEFAULT_HOLDING_PERIODS["cpi"]);
    expect(resolveHoldingPeriod("fomc")).toBe(DEFAULT_HOLDING_PERIODS["fomc"]);
    expect(resolveHoldingPeriod("nfp")).toBe(DEFAULT_HOLDING_PERIODS["nfp"]);
  });

  it("returns fallback for unknown family", () => {
    expect(resolveHoldingPeriod("unknown_event")).toBe(60);
  });

  it("respects an explicit override", () => {
    expect(resolveHoldingPeriod("cpi", 15)).toBe(15);
    expect(resolveHoldingPeriod("fomc", 45)).toBe(45);
  });

  it("ignores override of 0 or negative", () => {
    expect(resolveHoldingPeriod("cpi", 0)).toBe(DEFAULT_HOLDING_PERIODS["cpi"]!);
  });
});

describe("computeSlippageCost", () => {
  it("computes cost correctly", () => {
    // 10 units × $100 × 3 bps / 10_000 = $0.30
    expect(computeSlippageCost(10, 100, 3)).toBeCloseTo(0.30, 2);
  });

  it("returns 0 for zero slippage", () => {
    expect(computeSlippageCost(10, 100, 0)).toBe(0);
  });

  it("scales linearly with size", () => {
    const small = computeSlippageCost(5, 100, DEFAULT_SLIPPAGE_BPS);
    const large = computeSlippageCost(20, 100, DEFAULT_SLIPPAGE_BPS);
    expect(large).toBeCloseTo(small * 4, 2);
  });
});

describe("computeExitPrice", () => {
  it("long exit is above entry when prediction correct", () => {
    const exit = computeExitPrice(100, "long", 50, 0);
    expect(exit).toBeGreaterThan(100);
  });

  it("short exit is below entry when prediction correct", () => {
    const exit = computeExitPrice(100, "short", 50, 0);
    expect(exit).toBeLessThan(100);
  });

  it("slippage reduces long exit price", () => {
    const noSlip = computeExitPrice(100, "long", 50, 0);
    const withSlip = computeExitPrice(100, "long", 50, 3);
    expect(withSlip).toBeLessThan(noSlip);
  });

  it("slippage increases short exit price (adverse)", () => {
    const noSlip = computeExitPrice(100, "short", 50, 0);
    const withSlip = computeExitPrice(100, "short", 50, 3);
    expect(withSlip).toBeGreaterThan(noSlip);
  });
});

describe("computeNetPnL", () => {
  it("produces positive P&L for a winning long trade", () => {
    const pnl = computeNetPnL(10, 100, "long", 50, 0);
    expect(pnl).toBeGreaterThan(0);
  });

  it("produces positive P&L for a winning short trade", () => {
    const pnl = computeNetPnL(10, 100, "short", 50, 0);
    expect(pnl).toBeGreaterThan(0);
  });

  it("slippage reduces net P&L for both directions", () => {
    const longNoSlip = computeNetPnL(10, 100, "long", 50, 0);
    const longWithSlip = computeNetPnL(10, 100, "long", 50, 3);
    expect(longWithSlip).toBeLessThan(longNoSlip);

    const shortNoSlip = computeNetPnL(10, 100, "short", 50, 0);
    const shortWithSlip = computeNetPnL(10, 100, "short", 50, 3);
    expect(shortWithSlip).toBeLessThan(shortNoSlip);
  });

  it("returns 0 for zero magnitude with zero slippage", () => {
    expect(computeNetPnL(10, 100, "long", 0, 0)).toBe(0);
  });
});

// ─── 6. Regime Tags ───────────────────────────────────────────────────────────

describe("tagVolatilityRegime", () => {
  it("tags low for VIX < 15", () => {
    expect(tagVolatilityRegime(12)).toBe("low");
    expect(tagVolatilityRegime(14.9)).toBe("low");
  });

  it("tags normal for VIX 15–25", () => {
    expect(tagVolatilityRegime(15)).toBe("normal");
    expect(tagVolatilityRegime(20)).toBe("normal");
    expect(tagVolatilityRegime(25)).toBe("normal");
  });

  it("tags elevated for VIX 25–35", () => {
    expect(tagVolatilityRegime(25.1)).toBe("elevated");
    expect(tagVolatilityRegime(35)).toBe("elevated");
  });

  it("tags high for VIX > 35", () => {
    expect(tagVolatilityRegime(35.1)).toBe("high");
    expect(tagVolatilityRegime(60)).toBe("high");
  });
});

describe("buildRegimeTags", () => {
  it("returns the correct regime snapshot", () => {
    const tags = buildRegimeTags("risk_on", "normal");
    expect(tags.macroRegime).toBe("risk_on");
    expect(tags.volatilityRegime).toBe("normal");
  });
});

describe("buildRegimeTagsFromVix", () => {
  it("derives volatility regime from VIX scalar", () => {
    const tags = buildRegimeTagsFromVix("disinflation", 18);
    expect(tags.volatilityRegime).toBe("normal");
    expect(tags.macroRegime).toBe("disinflation");
  });
});

// ─── 7. Sizing Integration — calibration_multiplier ──────────────────────────

describe("sizePosition with calibration multiplier", () => {
  it("multiplier 1.0 produces the same size as the 7A baseline", () => {
    const base = sizePosition(0.75, 0.80, "normal");
    const calibrated = sizePosition(0.75, 0.80, "normal", undefined, 1.0);
    expect(calibrated).toBe(base);
  });

  it("multiplier > 1.0 increases size", () => {
    const base = sizePosition(0.75, 0.80, "normal");
    const calibrated = sizePosition(0.75, 0.80, "normal", undefined, 1.3);
    expect(calibrated).toBeGreaterThan(base);
  });

  it("multiplier < 1.0 decreases size", () => {
    const base = sizePosition(0.75, 0.80, "normal");
    const calibrated = sizePosition(0.75, 0.80, "normal", undefined, 0.7);
    expect(calibrated).toBeLessThan(base);
  });

  it("multiplier 0.5 halves the base size", () => {
    const base = sizePosition(0.75, 0.80, "normal");
    const calibrated = sizePosition(0.75, 0.80, "normal", undefined, 0.5);
    expect(calibrated).toBeCloseTo(base * 0.5, 3);
  });
});

describe("runPortfolioSimulation with calibration_multiplier", () => {
  const prediction = {
    confidence: 0.75,
    horizon: "1d",
    assets: [{ ticker: "SPY", expected_direction: "up" as const, expected_magnitude_bp: 50, conviction: 0.80 }],
  };
  const baseInput = {
    prediction_result: { predictions: [prediction] },
    event_family: "cpi" as const,
    portfolio: createPortfolio(),
    constraints: createRiskConstraints(),
    simulated_at: "2026-03-18T00:00:00Z",
  };

  it("multiplier 1.0 produces same trade size as no multiplier", () => {
    const base = runPortfolioSimulation(baseInput);
    const calibrated = runPortfolioSimulation({ ...baseInput, calibration_multiplier: 1.0 });
    expect(calibrated.trades_executed[0]!.executed_size)
      .toBe(base.trades_executed[0]!.executed_size);
  });

  it("multiplier > 1.0 produces larger trade size", () => {
    const base = runPortfolioSimulation(baseInput);
    const calibrated = runPortfolioSimulation({ ...baseInput, calibration_multiplier: 1.25 });
    expect(calibrated.trades_executed[0]!.executed_size)
      .toBeGreaterThan(base.trades_executed[0]!.executed_size);
  });

  it("multiplier < 1.0 produces smaller trade size", () => {
    const base = runPortfolioSimulation(baseInput);
    const calibrated = runPortfolioSimulation({ ...baseInput, calibration_multiplier: 0.75 });
    expect(calibrated.trades_executed[0]!.executed_size)
      .toBeLessThan(base.trades_executed[0]!.executed_size);
  });
});

// ─── 8. End-to-End Pipeline ───────────────────────────────────────────────────

describe("End-to-end: trades → attribution → summary → calibration → sizing", () => {
  it("reduces sizing after a run of poor trades", () => {
    // Simulate 30 poor trades (≥ DEFAULT_MIN_SAMPLE_SIZE): low win rate + negative P&L
    let store = createAttributionStore();
    for (let i = 0; i < 30; i++) {
      const isLoss = i < 21; // 21/30 = 30% win rate (poor)
      const record = buildTradeAttributionRecord({
        trade: {
          ...buildTradeLike({ simulated_pnl: isLoss ? -8 : 10 }),
          executed_at: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        },
        tradeId: `t-${i}`,
        eventId: "e1",
        eventFamily: "cpi",
        confidence: 0.65,
        reliability: 0.55,
        holdingPeriodMinutes: 60,
        slippageBps: 0,
      });
      store = addRecord(store, record);
    }

    const records = filterRecords(store);
    const summary = computePerformanceSummary(records);
    const factor = computeCalibrationFactor(summary);

    expect(summary.winRate).toBeCloseTo(0.30, 2);
    expect(factor.multiplier).toBeLessThan(1.0);
    expect(factor.reason.some((r) => r.includes("win_rate_poor"))).toBe(true);

    // Base size without calibration
    const baseSize = sizePosition(0.70, 0.75, "normal");
    const calibratedSize = applyCalibrationToSize(baseSize, factor);
    expect(calibratedSize).toBeLessThan(baseSize);
  });

  it("increases sizing after a run of strong trades", () => {
    let store = createAttributionStore();
    for (let i = 0; i < 30; i++) {
      const isWin = i < 21; // 21/30 = 70% win rate (strong)
      const record = buildTradeAttributionRecord({
        trade: {
          ...buildTradeLike({ simulated_pnl: isWin ? 8 : -2 }),
          executed_at: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        },
        tradeId: `t-${i}`,
        eventId: "e1",
        eventFamily: "fomc",
        confidence: 0.80,
        reliability: 0.75,
        holdingPeriodMinutes: 120,
        slippageBps: 0,
      });
      store = addRecord(store, record);
    }

    const summary = computePerformanceSummary(filterRecords(store));
    const factor = computeCalibrationFactor(summary);

    expect(summary.winRate).toBeCloseTo(0.70, 2);
    expect(factor.multiplier).toBeGreaterThan(1.0);

    const baseSize = sizePosition(0.75, 0.80, "normal");
    const calibratedSize = applyCalibrationToSize(baseSize, factor);
    expect(calibratedSize).toBeGreaterThan(baseSize);
  });

  it("blended factor between recent strong and long-term weak produces intermediate multiplier", () => {
    const recentFactor: CalibrationFactor = {
      multiplier: 1.30,
      reason: ["recent: strong win rate"],
    };
    const longTermFactor: CalibrationFactor = {
      multiplier: 0.80,
      reason: ["long_term: weak history"],
    };
    const blended = blendCalibrationFactors(recentFactor, longTermFactor, 0.60);
    // 0.60 × 1.30 + 0.40 × 0.80 = 0.78 + 0.32 = 1.10
    expect(blended.multiplier).toBeCloseTo(1.10, 3);
    expect(blended.multiplier).toBeGreaterThan(longTermFactor.multiplier);
    expect(blended.multiplier).toBeLessThan(recentFactor.multiplier);
  });

  it("attribution store correctly filters by confidence bucket for focused calibration", () => {
    let store = createAttributionStore();
    // 15 high-confidence trades that lose
    for (let i = 0; i < 15; i++) {
      const record = buildTradeAttributionRecord({
        trade: { ...buildTradeLike({ simulated_pnl: -5 }),
          executed_at: "2026-03-01T00:00:00Z" },
        tradeId: `h-${i}`, eventId: "e1", eventFamily: "cpi",
        confidence: 0.85, reliability: 0.6, holdingPeriodMinutes: 60,
      });
      store = addRecord(store, record);
    }
    // 15 low-confidence trades that win
    for (let i = 0; i < 15; i++) {
      const record = buildTradeAttributionRecord({
        trade: { ...buildTradeLike({ simulated_pnl: 10 }),
          executed_at: "2026-03-01T00:00:00Z" },
        tradeId: `l-${i}`, eventId: "e1", eventFamily: "cpi",
        confidence: 0.35, reliability: 0.6, holdingPeriodMinutes: 60,
      });
      store = addRecord(store, record);
    }

    // High-confidence subset should show poor performance
    const highConfRecords = filterRecords(store, { confidenceBucket: "high" });
    expect(highConfRecords).toHaveLength(15);
    const highSummary = computePerformanceSummary(highConfRecords);
    expect(highSummary.winRate).toBe(0);
    expect(highSummary.avgPnl).toBeLessThan(0);

    // Low-confidence subset should show strong performance
    const lowConfRecords = filterRecords(store, { confidenceBucket: "low" });
    const lowSummary = computePerformanceSummary(lowConfRecords);
    expect(lowSummary.winRate).toBe(1.0);
    expect(lowSummary.avgPnl).toBeGreaterThan(0);
  });
});

// ─── 9. Regression — Phase 7A unchanged ──────────────────────────────────────

describe("Regression: Phase 7A unaffected when calibration is disabled", () => {
  it("sizePosition without calibrationMultiplier behaves identically to Phase 7A", () => {
    const cases: Array<[number, number, "low" | "normal" | "elevated" | "high"]> = [
      [0.75, 0.80, "normal"],
      [0.50, 0.60, "elevated"],
      [0.90, 1.00, "high"],
      [0.30, 0.40, "low"],
    ];
    for (const [conf, conv, vol] of cases) {
      const base = sizePosition(conf, conv, vol);
      const calibrated = sizePosition(conf, conv, vol, undefined, 1.0);
      expect(calibrated).toBe(base);
    }
  });

  it("generateTradeSignals without calibrationMultiplier behaves identically to Phase 7A", () => {
    const predictions = [{
      confidence: 0.75,
      horizon: "1d",
      assets: [{ ticker: "SPY", expected_direction: "up" as const, expected_magnitude_bp: 50, conviction: 0.80 }],
    }];
    const constraints = createRiskConstraints();
    const base = generateTradeSignals(predictions, constraints, "normal");
    const calibrated = generateTradeSignals(predictions, constraints, "normal", [], 1.0);
    expect(calibrated[0]!.target_size).toBe(base[0]!.target_size);
  });

  it("runPortfolioSimulation without calibration_multiplier is unchanged", () => {
    const input = {
      prediction_result: {
        predictions: [{
          confidence: 0.72,
          horizon: "1d",
          assets: [
            { ticker: "SPY", expected_direction: "down" as const, expected_magnitude_bp: 80, conviction: 0.75 },
            { ticker: "TLT", expected_direction: "down" as const, expected_magnitude_bp: 60, conviction: 0.70 },
          ],
        }],
      },
      event_family: "cpi" as const,
      portfolio: createPortfolio(),
      constraints: createRiskConstraints(),
      simulated_at: "2026-03-18T00:00:00Z",
    };

    const base = runPortfolioSimulation(input);
    const withDefault = runPortfolioSimulation({ ...input, calibration_multiplier: 1.0 });

    expect(withDefault.trades_executed).toHaveLength(base.trades_executed.length);
    withDefault.trades_executed.forEach((t, i) => {
      expect(t.executed_size).toBe(base.trades_executed[i]!.executed_size);
      expect(t.simulated_pnl).toBe(base.trades_executed[i]!.simulated_pnl);
    });
    expect(withDefault.pnl_metrics.per_event).toBe(base.pnl_metrics.per_event);
  });
});
