/**
 * Phase 7B.1 Hardening — test suite.
 *
 * Validates the three targeted improvements made in Phase 7B.1:
 *
 *   1. Multi-horizon exit logic
 *      - HorizonPnL computation per named horizon
 *      - BlendedExitResult weighted combination
 *      - Per-family holding period resolution
 *      - Magnitude scaling per horizon (slow = 0.85×)
 *      - Slippage variation per horizon
 *
 *   2. Calibration hardening
 *      - DEFAULT_MIN_SAMPLE_SIZE raised to 30
 *      - Threshold constants exported and correct
 *      - Coherence guard (opt-in) suppresses conflicting small signals
 *      - Coherence guard is silent when signals agree
 *      - Coherence guard does not suppress large signals
 *
 *   3. Blended exit integrated into attribution records
 *      - buildTradeAttributionRecord uses blendedPnl when provided
 *      - Single-horizon path unchanged when blendedExitResult absent
 *
 *   4. Regression — Phase 7B callers unaffected
 *      - DEFAULT_MIN_SAMPLE_SIZE = 30 used by existing tests (constant)
 *      - computeCalibrationFactor with no options behaves as before
 *      - attribution records without blendedExitResult unchanged
 */

import { describe, it, expect } from "vitest";

import {
  computeHorizonPnL,
  computeBlendedExit,
  computeNetPnL,
  resolveHorizonPeriods,
  MULTI_HORIZON_PERIODS,
  HORIZON_PARAMS,
  DEFAULT_BLEND_WEIGHTS,
  EOD_MINUTES,
} from "./exit_logic.js";

import {
  computeCalibrationFactor,
  DEFAULT_MIN_SAMPLE_SIZE,
  CALIBRATION_MIN,
  CALIBRATION_MAX,
  WIN_RATE_STRONG_THRESHOLD,
  WIN_RATE_ABOVE_AVG_THRESHOLD,
  WIN_RATE_POOR_THRESHOLD,
  WIN_RATE_BELOW_AVG_THRESHOLD,
  SHARPE_STRONG_THRESHOLD,
  SHARPE_ADEQUATE_THRESHOLD,
  SHARPE_WEAK_THRESHOLD,
  COHERENCE_GUARD_SMALL_ADJ,
} from "./calibration.js";

import {
  buildTradeAttributionRecord,
} from "./attribution_store.js";

import { SIMULATED_PRICE } from "./portfolio.js";
import type { PerformanceSummary } from "./performance_summary.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

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

const buildTradeLike = (overrides?: Partial<{
  executed_size: number;
  entry_price: number;
  expected_magnitude_bp: number;
  simulated_pnl: number;
  direction: "long" | "short";
}>) => ({
  asset: "SPY",
  direction: (overrides?.direction ?? "long") as "long" | "short",
  executed_size: overrides?.executed_size ?? 10,
  entry_price: overrides?.entry_price ?? SIMULATED_PRICE,
  expected_magnitude_bp: overrides?.expected_magnitude_bp ?? 50,
  horizon: "1d",
  simulated_pnl: overrides?.simulated_pnl ?? 5,
  executed_at: "2026-03-18T00:00:00Z",
});

// ─── 1. Multi-Horizon Exit: types and constants ───────────────────────────────

describe("Multi-horizon constants", () => {
  it("EOD_MINUTES is 480", () => {
    expect(EOD_MINUTES).toBe(480);
  });

  it("DEFAULT_BLEND_WEIGHTS sum to 1.0", () => {
    const sum = DEFAULT_BLEND_WEIGHTS.fast + DEFAULT_BLEND_WEIGHTS.medium + DEFAULT_BLEND_WEIGHTS.slow;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("fast weight = 0.30, medium = 0.40, slow = 0.30", () => {
    expect(DEFAULT_BLEND_WEIGHTS.fast).toBe(0.30);
    expect(DEFAULT_BLEND_WEIGHTS.medium).toBe(0.40);
    expect(DEFAULT_BLEND_WEIGHTS.slow).toBe(0.30);
  });

  it("HORIZON_PARAMS has correct magnitude scales", () => {
    expect(HORIZON_PARAMS.fast.magnitudeScale).toBe(1.00);
    expect(HORIZON_PARAMS.medium.magnitudeScale).toBe(1.00);
    expect(HORIZON_PARAMS.slow.magnitudeScale).toBe(0.85); // mean-reversion
  });

  it("HORIZON_PARAMS has descending slippage from fast to slow", () => {
    expect(HORIZON_PARAMS.fast.slippageBps).toBeGreaterThan(HORIZON_PARAMS.medium.slippageBps);
    expect(HORIZON_PARAMS.medium.slippageBps).toBeGreaterThan(HORIZON_PARAMS.slow.slippageBps);
  });
});

// ─── 2. Multi-Horizon Exit: period resolution ─────────────────────────────────

describe("resolveHorizonPeriods", () => {
  it("CPI fast=30, medium=120, slow=EOD", () => {
    const p = resolveHorizonPeriods("cpi");
    expect(p.fast).toBe(30);
    expect(p.medium).toBe(120);
    expect(p.slow).toBe(EOD_MINUTES);
  });

  it("FOMC fast=30, medium=240, slow=EOD", () => {
    const p = resolveHorizonPeriods("fomc");
    expect(p.fast).toBe(30);
    expect(p.medium).toBe(240);
    expect(p.slow).toBe(EOD_MINUTES);
  });

  it("NFP fast=30, medium=180, slow=EOD", () => {
    const p = resolveHorizonPeriods("nfp");
    expect(p.fast).toBe(30);
    expect(p.medium).toBe(180);
    expect(p.slow).toBe(EOD_MINUTES);
  });

  it("unknown family returns fallback with EOD slow", () => {
    const p = resolveHorizonPeriods("unknown_event");
    expect(p.slow).toBe(EOD_MINUTES);
    expect(p.fast).toBe(30);
  });

  it("MULTI_HORIZON_PERIODS has entries for all three families", () => {
    expect(MULTI_HORIZON_PERIODS["cpi"]).toBeDefined();
    expect(MULTI_HORIZON_PERIODS["fomc"]).toBeDefined();
    expect(MULTI_HORIZON_PERIODS["nfp"]).toBeDefined();
  });
});

// ─── 3. computeHorizonPnL ─────────────────────────────────────────────────────

describe("computeHorizonPnL", () => {
  it("returns positive pnl for a correct long prediction", () => {
    const h = computeHorizonPnL(10, 100, "long", 50, "medium", "cpi");
    expect(h.pnl).toBeGreaterThan(0);
    expect(h.horizonName).toBe("medium");
  });

  it("returns positive pnl for a correct short prediction", () => {
    const h = computeHorizonPnL(10, 100, "short", 50, "medium", "cpi");
    expect(h.pnl).toBeGreaterThan(0);
  });

  it("slow horizon produces less pnl than medium due to magnitude scale", () => {
    const medium = computeHorizonPnL(10, 100, "long", 100, "medium", "cpi");
    const slow   = computeHorizonPnL(10, 100, "long", 100, "slow",   "cpi");
    // slow uses 0.85× magnitude — captures less of the move
    expect(slow.pnl).toBeLessThan(medium.pnl);
  });

  it("fast horizon has lower pnl than medium due to higher slippage", () => {
    // Same magnitude scale (both 1.00), but fast has 4 bps vs 3 bps slippage
    const fast   = computeHorizonPnL(10, 100, "long", 100, "fast",   "cpi");
    const medium = computeHorizonPnL(10, 100, "long", 100, "medium", "cpi");
    expect(fast.pnl).toBeLessThan(medium.pnl);
  });

  it("holdingPeriodMinutes matches the family config", () => {
    const fast   = computeHorizonPnL(10, 100, "long", 50, "fast",   "fomc");
    const medium = computeHorizonPnL(10, 100, "long", 50, "medium", "fomc");
    const slow   = computeHorizonPnL(10, 100, "long", 50, "slow",   "fomc");
    expect(fast.holdingPeriodMinutes).toBe(30);
    expect(medium.holdingPeriodMinutes).toBe(240); // FOMC medium = 240
    expect(slow.holdingPeriodMinutes).toBe(EOD_MINUTES);
  });

  it("exitPrice is different for each horizon due to slippage and scale", () => {
    const fast   = computeHorizonPnL(10, 100, "long", 80, "fast",   "cpi");
    const medium = computeHorizonPnL(10, 100, "long", 80, "medium", "cpi");
    const slow   = computeHorizonPnL(10, 100, "long", 80, "slow",   "cpi");
    // fast and medium have same magnitude scale but different slippage
    // slow has different magnitude scale
    expect(fast.exitPrice).not.toBe(medium.exitPrice);
    expect(slow.exitPrice).not.toBe(medium.exitPrice);
  });

  it("returnPct is positive for a winning trade", () => {
    const h = computeHorizonPnL(10, 100, "long", 50, "medium", "nfp");
    expect(h.returnPct).toBeGreaterThan(0);
  });

  it("returnPct = 0 for zero executed size (no notional)", () => {
    const h = computeHorizonPnL(0, 100, "long", 50, "medium", "cpi");
    expect(h.returnPct).toBe(0);
    expect(h.pnl).toBe(0);
  });
});

// ─── 4. computeBlendedExit ────────────────────────────────────────────────────

describe("computeBlendedExit", () => {
  it("returns a result with all three horizons", () => {
    const result = computeBlendedExit(10, 100, "long", 50, "cpi");
    expect(result.horizons).toHaveLength(3);
    expect(result.horizons[0]!.horizonName).toBe("fast");
    expect(result.horizons[1]!.horizonName).toBe("medium");
    expect(result.horizons[2]!.horizonName).toBe("slow");
  });

  it("blendedPnl is a weighted combination of horizon pnls", () => {
    const result = computeBlendedExit(10, 100, "long", 80, "cpi");
    const [fast, medium, slow] = result.horizons;
    const expected = Number((
      DEFAULT_BLEND_WEIGHTS.fast   * fast!.pnl +
      DEFAULT_BLEND_WEIGHTS.medium * medium!.pnl +
      DEFAULT_BLEND_WEIGHTS.slow   * slow!.pnl
    ).toFixed(2));
    expect(result.blendedPnl).toBe(expected);
  });

  it("blendedPnl is positive for a correct directional prediction", () => {
    const result = computeBlendedExit(10, 100, "long", 80, "cpi");
    expect(result.blendedPnl).toBeGreaterThan(0);
  });

  it("blendedPnl for short direction is positive when prediction correct", () => {
    const result = computeBlendedExit(10, 100, "short", 80, "fomc");
    expect(result.blendedPnl).toBeGreaterThan(0);
  });

  it("blendedPnl is less than single medium-horizon pnl (slow horizon drag)", () => {
    const blended = computeBlendedExit(10, 100, "long", 100, "cpi");
    const mediumOnly = computeHorizonPnL(10, 100, "long", 100, "medium", "cpi");
    // Slow horizon has 0.85× magnitude → pulls blended below pure medium
    expect(blended.blendedPnl).toBeLessThan(mediumOnly.pnl);
  });

  it("weights in result match DEFAULT_BLEND_WEIGHTS", () => {
    const result = computeBlendedExit(10, 100, "long", 50, "nfp");
    expect(result.weights.fast).toBe(DEFAULT_BLEND_WEIGHTS.fast);
    expect(result.weights.medium).toBe(DEFAULT_BLEND_WEIGHTS.medium);
    expect(result.weights.slow).toBe(DEFAULT_BLEND_WEIGHTS.slow);
  });

  it("accepts custom blend weights", () => {
    const evenWeights = { fast: 1/3, medium: 1/3, slow: 1/3 };
    const result = computeBlendedExit(10, 100, "long", 80, "cpi", evenWeights);
    expect(result.weights.fast).toBeCloseTo(1/3, 5);
  });

  it("reason array contains blend equation and period info", () => {
    const result = computeBlendedExit(10, 100, "long", 50, "cpi");
    expect(result.reason.some((r) => r.includes("blended_exit"))).toBe(true);
    expect(result.reason.some((r) => r.includes("periods[cpi]"))).toBe(true);
    expect(result.reason.some((r) => r.includes("magnitude_scales"))).toBe(true);
  });

  it("different event families produce different medium holding periods", () => {
    const cpi  = computeBlendedExit(10, 100, "long", 50, "cpi");
    const fomc = computeBlendedExit(10, 100, "long", 50, "fomc");
    // FOMC medium = 240 min, CPI medium = 120 min → different exit prices
    expect(cpi.horizons[1]!.holdingPeriodMinutes)
      .not.toBe(fomc.horizons[1]!.holdingPeriodMinutes);
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    const a = computeBlendedExit(10, 100, "long", 80, "cpi");
    const b = computeBlendedExit(10, 100, "long", 80, "cpi");
    expect(a.blendedPnl).toBe(b.blendedPnl);
    expect(a.blendedReturnPct).toBe(b.blendedReturnPct);
  });
});

// ─── 5. Blended exit integrated into attribution records ──────────────────────

describe("buildTradeAttributionRecord with blendedExitResult", () => {
  it("uses blendedPnl as the canonical pnl when blendedExitResult provided", () => {
    const trade = buildTradeLike({ executed_size: 10, entry_price: 100, simulated_pnl: 5 });
    const blended = computeBlendedExit(10, 100, "long", 50, "cpi");

    const record = buildTradeAttributionRecord({
      trade,
      tradeId: "t1", eventId: "e1", eventFamily: "cpi",
      confidence: 0.72, reliability: 0.65, holdingPeriodMinutes: 120,
      blendedExitResult: blended,
    });

    expect(record.pnl).toBe(blended.blendedPnl);
    expect(record.returnPct).toBe(blended.blendedReturnPct);
  });

  it("uses medium-horizon exitPrice when blendedExitResult provided", () => {
    const trade = buildTradeLike();
    const blended = computeBlendedExit(10, 100, "long", 50, "cpi");
    const record = buildTradeAttributionRecord({
      trade, tradeId: "t2", eventId: "e1", eventFamily: "cpi",
      confidence: 0.72, reliability: 0.65, holdingPeriodMinutes: 120,
      blendedExitResult: blended,
    });
    expect(record.exitPrice).toBe(blended.horizons[1]!.exitPrice);
  });

  it("isWin reflects blendedPnl sign", () => {
    const trade = buildTradeLike({ simulated_pnl: 5 });
    const blended = computeBlendedExit(10, 100, "long", 50, "cpi");
    const record = buildTradeAttributionRecord({
      trade, tradeId: "t3", eventId: "e1", eventFamily: "cpi",
      confidence: 0.72, reliability: 0.65, holdingPeriodMinutes: 120,
      blendedExitResult: blended,
    });
    expect(record.isWin).toBe(blended.blendedPnl > 0);
  });

  it("single-horizon path unchanged when blendedExitResult is absent", () => {
    const trade = buildTradeLike({ executed_size: 10, entry_price: 100, simulated_pnl: 5 });
    const record = buildTradeAttributionRecord({
      trade, tradeId: "t4", eventId: "e1", eventFamily: "cpi",
      confidence: 0.72, reliability: 0.65, holdingPeriodMinutes: 60,
      slippageBps: 0,
    });
    // Without blended result, pnl = simulated_pnl - slippage = 5 - 0 = 5
    expect(record.pnl).toBe(5);
  });

  it("blended record has lower pnl than gross pnl due to slow-horizon drag", () => {
    // simulated_pnl is the "full" gross — blended pnl is slightly lower
    // because the slow horizon captures only 85% of the move
    const trade = buildTradeLike({ executed_size: 10, entry_price: 100, simulated_pnl: 5 });
    const blended = computeBlendedExit(10, 100, "long", 50, "cpi");
    const record = buildTradeAttributionRecord({
      trade, tradeId: "t5", eventId: "e1", eventFamily: "cpi",
      confidence: 0.72, reliability: 0.65, holdingPeriodMinutes: 120,
      blendedExitResult: blended,
    });
    // blendedPnl < simulated_pnl because slow horizon drags the average down
    expect(record.pnl).toBeLessThan(5);
    expect(record.pnl).toBeGreaterThan(0);
  });
});

// ─── 6. Calibration: raised sample floor ─────────────────────────────────────

describe("DEFAULT_MIN_SAMPLE_SIZE (7B.1 hardening)", () => {
  it("is 30", () => {
    expect(DEFAULT_MIN_SAMPLE_SIZE).toBe(30);
  });

  it("gates calibration at n=29 (just under threshold)", () => {
    const factor = computeCalibrationFactor(buildSummary({ tradeCount: 29 }));
    expect(factor.multiplier).toBe(1.0);
    expect(factor.reason[0]).toContain("insufficient_sample");
    expect(factor.reason[0]).toContain("required=30");
  });

  it("fires calibration at n=30 (exactly at threshold)", () => {
    const factor = computeCalibrationFactor(buildSummary({ tradeCount: 30 }));
    expect(factor.reason[0]).not.toContain("insufficient_sample");
  });

  it("n=20 is now below threshold (would have passed under old 7B)", () => {
    const factor = computeCalibrationFactor(buildSummary({ tradeCount: 20 }));
    expect(factor.multiplier).toBe(1.0);
    expect(factor.reason[0]).toContain("insufficient_sample");
  });
});

// ─── 7. Calibration: exported threshold constants ─────────────────────────────

describe("Calibration threshold constants", () => {
  it("win-rate thresholds have expected values", () => {
    expect(WIN_RATE_STRONG_THRESHOLD).toBe(0.60);
    expect(WIN_RATE_ABOVE_AVG_THRESHOLD).toBe(0.52);
    expect(WIN_RATE_POOR_THRESHOLD).toBe(0.35);
    expect(WIN_RATE_BELOW_AVG_THRESHOLD).toBe(0.44);
  });

  it("Sharpe thresholds have expected values", () => {
    expect(SHARPE_STRONG_THRESHOLD).toBe(2.0);
    expect(SHARPE_ADEQUATE_THRESHOLD).toBe(1.0);
    expect(SHARPE_WEAK_THRESHOLD).toBe(0.5);
  });

  it("COHERENCE_GUARD_SMALL_ADJ = 0.10", () => {
    expect(COHERENCE_GUARD_SMALL_ADJ).toBe(0.10);
  });

  it("win-rate thresholds are correctly ordered", () => {
    expect(WIN_RATE_POOR_THRESHOLD).toBeLessThan(WIN_RATE_BELOW_AVG_THRESHOLD);
    expect(WIN_RATE_BELOW_AVG_THRESHOLD).toBeLessThan(WIN_RATE_ABOVE_AVG_THRESHOLD);
    expect(WIN_RATE_ABOVE_AVG_THRESHOLD).toBeLessThan(WIN_RATE_STRONG_THRESHOLD);
  });

  it("strong win-rate fires +0.25 at exactly the threshold", () => {
    const factor = computeCalibrationFactor(buildSummary({
      winRate: WIN_RATE_STRONG_THRESHOLD,
      sharpeLike: 0.6, // neutral sharpe
    }));
    expect(factor.reason.some((r) => r.includes("win_rate_strong"))).toBe(true);
    expect(factor.multiplier).toBeCloseTo(1.25, 3);
  });

  it("above-avg win-rate fires +0.10 at exactly the threshold", () => {
    const factor = computeCalibrationFactor(buildSummary({
      winRate: WIN_RATE_ABOVE_AVG_THRESHOLD,
      sharpeLike: 0.6,
    }));
    expect(factor.reason.some((r) => r.includes("win_rate_above_avg"))).toBe(true);
    expect(factor.multiplier).toBeCloseTo(1.10, 3);
  });

  it("poor win-rate fires -0.25 at exactly the threshold", () => {
    const factor = computeCalibrationFactor(buildSummary({
      winRate: WIN_RATE_POOR_THRESHOLD,
      sharpeLike: 0.6,
    }));
    expect(factor.reason.some((r) => r.includes("win_rate_poor"))).toBe(true);
    expect(factor.multiplier).toBeCloseTo(0.75, 3);
  });
});

// ─── 8. Coherence guard ───────────────────────────────────────────────────────

describe("Coherence guard (enableCoherenceGuard: true)", () => {
  it("suppresses conflicting small adjustments (+0.10 win, -0.10 sharpe)", () => {
    // win_rate_above_avg → +0.10, sharpe_weak → -0.10 → conflict, both small
    const withGuard = computeCalibrationFactor(
      buildSummary({ winRate: 0.55, sharpeLike: 0.3 }),
      DEFAULT_MIN_SAMPLE_SIZE,
      { enableCoherenceGuard: true },
    );
    const withoutGuard = computeCalibrationFactor(
      buildSummary({ winRate: 0.55, sharpeLike: 0.3 }),
    );

    // Without guard: +0.10 - 0.10 = 0 → multiplier 1.0 anyway (they cancel)
    // With guard: suppressed before accumulation, adds reason
    expect(withGuard.reason.some((r) => r.includes("coherence_guard_fired"))).toBe(true);
    expect(withGuard.multiplier).toBe(1.0);
    expect(withoutGuard.reason.every((r) => !r.includes("coherence_guard_fired"))).toBe(true);
  });

  it("suppresses conflicting small adjustments (-0.10 win, +0.05 sharpe)", () => {
    // win_rate_below_avg → -0.10, sharpe_adequate → +0.05 → conflict, both ≤ 0.10
    const factor = computeCalibrationFactor(
      buildSummary({ winRate: 0.42, sharpeLike: 1.2 }),
      DEFAULT_MIN_SAMPLE_SIZE,
      { enableCoherenceGuard: true },
    );
    expect(factor.reason.some((r) => r.includes("coherence_guard_fired"))).toBe(true);
    expect(factor.multiplier).toBe(1.0);
  });

  it("does NOT suppress when both signals agree in direction", () => {
    // win_rate_above_avg → +0.10, sharpe_adequate → +0.05 → same direction
    const factor = computeCalibrationFactor(
      buildSummary({ winRate: 0.55, sharpeLike: 1.2 }),
      DEFAULT_MIN_SAMPLE_SIZE,
      { enableCoherenceGuard: true },
    );
    expect(factor.reason.every((r) => !r.includes("coherence_guard_fired"))).toBe(true);
    expect(factor.multiplier).toBeGreaterThan(1.0);
  });

  it("does NOT suppress when one adjustment is large (+0.25 vs -0.10)", () => {
    // win_rate_strong → +0.25, sharpe_weak → -0.10 → one is large, guard skips
    const factor = computeCalibrationFactor(
      buildSummary({ winRate: 0.65, sharpeLike: 0.3 }),
      DEFAULT_MIN_SAMPLE_SIZE,
      { enableCoherenceGuard: true },
    );
    expect(factor.reason.every((r) => !r.includes("coherence_guard_fired"))).toBe(true);
    // net = +0.25 - 0.10 = +0.15 → multiplier > 1.0
    expect(factor.multiplier).toBeGreaterThan(1.0);
  });

  it("does NOT fire when one of the adjustments is zero", () => {
    // win_rate_neutral → 0, sharpe_weak → -0.10 → guard needs both non-zero
    const factor = computeCalibrationFactor(
      buildSummary({ winRate: 0.50, sharpeLike: 0.3 }),
      DEFAULT_MIN_SAMPLE_SIZE,
      { enableCoherenceGuard: true },
    );
    expect(factor.reason.every((r) => !r.includes("coherence_guard_fired"))).toBe(true);
    expect(factor.multiplier).toBeLessThan(1.0);
  });

  it("drawdown haircut still applies even when guard fires", () => {
    // Guard fires on small conflicting signals, but drawdown > 15% should still reduce
    const factor = computeCalibrationFactor(
      buildSummary({ winRate: 0.55, sharpeLike: 0.3, maxDrawdown: 0.20 }),
      DEFAULT_MIN_SAMPLE_SIZE,
      { enableCoherenceGuard: true },
    );
    expect(factor.reason.some((r) => r.includes("coherence_guard_fired"))).toBe(true);
    expect(factor.reason.some((r) => r.includes("max_drawdown_high"))).toBe(true);
    // After guard: win/sharpe suppressed (net 0), but drawdown adds -0.15 → 0.85
    expect(factor.multiplier).toBeCloseTo(0.85, 3);
  });

  it("is disabled by default (Phase 7B behaviour preserved)", () => {
    const factor = computeCalibrationFactor(
      buildSummary({ winRate: 0.55, sharpeLike: 0.3 }),
    );
    // No guard → conflicting signals just cancel numerically
    expect(factor.reason.every((r) => !r.includes("coherence_guard_fired"))).toBe(true);
  });
});

// ─── 9. Regression — 7B tests still hold ─────────────────────────────────────

describe("Regression: Phase 7B callers unaffected by 7B.1", () => {
  it("computeCalibrationFactor with no options is backward-compatible", () => {
    // strong win rate + strong sharpe → expected uplift
    const factor = computeCalibrationFactor(
      buildSummary({ winRate: 0.70, sharpeLike: 2.5 }),
    );
    expect(factor.multiplier).toBeGreaterThan(1.0);
    expect(factor.multiplier).toBeLessThanOrEqual(CALIBRATION_MAX);
  });

  it("bounds [0.5, 1.5] still enforced", () => {
    const worst = computeCalibrationFactor(buildSummary({
      winRate: 0.10, sharpeLike: -3.0, maxDrawdown: 0.50,
    }));
    expect(worst.multiplier).toBeGreaterThanOrEqual(CALIBRATION_MIN);

    const best = computeCalibrationFactor(buildSummary({
      winRate: 0.90, sharpeLike: 3.0, maxDrawdown: 0.0,
    }));
    expect(best.multiplier).toBeLessThanOrEqual(CALIBRATION_MAX);
  });

  it("single-horizon attribution record unchanged without blendedExitResult", () => {
    const trade = buildTradeLike({ executed_size: 10, entry_price: 100, simulated_pnl: 7 });
    const record = buildTradeAttributionRecord({
      trade, tradeId: "r1", eventId: "e1", eventFamily: "cpi",
      confidence: 0.80, reliability: 0.70, holdingPeriodMinutes: 60,
      slippageBps: 0,
    });
    expect(record.pnl).toBe(7);
    expect(record.returnPct).toBeCloseTo(0.7, 3); // 7 / 1000 * 100
  });

  it("exit_logic single-horizon functions still work identically", () => {
    // Regression: original computeNetPnL unchanged by 7B.1 additions
    const pnl = computeNetPnL(10, 100, "long", 50, 3);
    expect(pnl).toBeGreaterThan(0);
  });
});
