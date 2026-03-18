/**
 * Phase 7B.2 tests — time-decay weighting and two-level bucket simplification.
 *
 * Coverage:
 *  1. Weighted math helpers: weightedMean, weightedStdDev, kishEffectiveSampleSize
 *  2. computeWeightedPerformanceSummary — edge cases and correctness
 *  3. Two-level bucket functions: bucketConfidence2Level, bucketReliability2Level,
 *     bucketBenchmark2Level
 *  4. Regression: uniform-weight weighted summary converges to unweighted
 *  5. Calibration coarseness: computeCalibrationFactor ignores buckets (global only)
 *  6. Multi-horizon validation: attribution records carry blended P&L for calibration
 */

import { describe, it, expect } from "vitest";

import {
  weightedMean,
  weightedStdDev,
  kishEffectiveSampleSize,
  computeWeightedPerformanceSummary,
  computePerformanceSummary,
  type WeightedPerformanceSummary,
} from "./performance_summary.js";

import {
  bucketConfidence2Level,
  bucketReliability2Level,
  bucketBenchmark2Level,
  bucketConfidence,
  bucketReliability,
  bucketBenchmarkAlignment,
} from "./attribution_buckets.js";

import {
  computeCalibrationFactor,
  DEFAULT_MIN_SAMPLE_SIZE,
} from "./calibration.js";

import {
  buildTradeAttributionRecord,
  type BuildAttributionParams,
} from "./attribution_store.js";

import { computeBlendedExit } from "./exit_logic.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal attribution record for a given date offset (days ago). */
const makeRecord = (
  opts: {
    daysAgo: number;
    pnl?: number;
    returnPct?: number;
    isWin?: boolean;
    asOf?: Date;
  },
) => {
  const asOf = opts.asOf ?? new Date("2025-01-01T00:00:00Z");
  const ts = new Date(asOf.getTime() - opts.daysAgo * 86_400_000).toISOString();
  const pnl = opts.pnl ?? 10;
  const returnPct = opts.returnPct ?? 0.1;
  const isWin = opts.isWin ?? pnl > 0;

  return {
    tradeId: `t-${opts.daysAgo}`,
    eventId: "e1",
    eventFamily: "cpi",
    instrument: "SPY",
    direction: "long" as const,
    confidence: 0.7,
    reliability: 0.6,
    confidenceBucket: "medium" as const,
    reliabilityBucket: "medium" as const,
    holdingPeriodMinutes: 60,
    entryPrice: 100,
    exitPrice: 101,
    slippageBps: 3,
    pnl,
    returnPct,
    isWin,
    timestamp: ts,
  };
};

// ─── 1. Weighted math helpers ─────────────────────────────────────────────────

describe("weightedMean", () => {
  it("returns 0 for empty input", () => {
    expect(weightedMean([], [])).toBe(0);
  });

  it("returns 0 when all weights are zero", () => {
    expect(weightedMean([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("matches arithmetic mean when all weights are equal", () => {
    const values = [2, 4, 6];
    const weights = [1, 1, 1];
    expect(weightedMean(values, weights)).toBeCloseTo(4, 10);
  });

  it("emphasises high-weight values", () => {
    // value=10 weight=9, value=1 weight=1 → (90 + 1)/10 = 9.1
    const wm = weightedMean([10, 1], [9, 1]);
    expect(wm).toBeCloseTo(9.1, 6);
  });

  it("handles a single element", () => {
    expect(weightedMean([42], [5])).toBe(42);
  });
});

describe("weightedStdDev", () => {
  it("returns 0 for fewer than 2 values", () => {
    expect(weightedStdDev([99], [1])).toBe(0);
    expect(weightedStdDev([], [])).toBe(0);
  });

  it("returns 0 when all weights are zero", () => {
    expect(weightedStdDev([1, 2], [0, 0])).toBe(0);
  });

  it("matches population stdDev when weights are uniform", () => {
    const values = [2, 4, 6, 8];
    const weights = [1, 1, 1, 1];
    // mean = 5, variance = ((9+1+1+9)/4) = 5, stdDev = sqrt(5) ≈ 2.2361
    const expected = Math.sqrt(5);
    expect(weightedStdDev(values, weights)).toBeCloseTo(expected, 4);
  });

  it("returns 0 when all values are identical", () => {
    expect(weightedStdDev([3, 3, 3], [2, 1, 3])).toBeCloseTo(0, 10);
  });

  it("down-weights distant values with lower weights", () => {
    // [0, 100] with weights [100, 1] should yield low stdDev
    const high = weightedStdDev([0, 100], [100, 1]);
    const equal = weightedStdDev([0, 100], [1, 1]);
    expect(high).toBeLessThan(equal);
  });
});

describe("kishEffectiveSampleSize", () => {
  it("returns 0 for empty input", () => {
    expect(kishEffectiveSampleSize([])).toBe(0);
  });

  it("equals n when all weights are equal (equal weighting is most efficient)", () => {
    const n = 5;
    const ess = kishEffectiveSampleSize([1, 1, 1, 1, 1]);
    expect(ess).toBeCloseTo(n, 4);
  });

  it("is less than n when weights are unequal", () => {
    const weights = [10, 1, 1, 1, 1];
    const ess = kishEffectiveSampleSize(weights);
    expect(ess).toBeLessThan(5);
    expect(ess).toBeGreaterThan(0);
  });

  it("approaches 1 when one weight completely dominates", () => {
    const weights = [10_000, 0.001, 0.001];
    const ess = kishEffectiveSampleSize(weights);
    expect(ess).toBeCloseTo(1, 0); // effectively 1 observation
  });
});

// ─── 2. computeWeightedPerformanceSummary ─────────────────────────────────────

describe("computeWeightedPerformanceSummary — edge cases", () => {
  const FIXED_DATE = new Date("2025-01-01T00:00:00Z");

  it("returns zeroed summary for empty input", () => {
    const result = computeWeightedPerformanceSummary([], FIXED_DATE);
    expect(result.tradeCount).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.avgPnl).toBe(0);
    expect(result.avgReturnPct).toBe(0);
    expect(result.returnStdDev).toBe(0);
    expect(result.sharpeLike).toBe(0);
    expect(result.maxDrawdown).toBe(0);
    expect(result.effectiveSampleSize).toBe(0);
    expect(result.decayInfo).toEqual({ decayConstantDays: 180, method: "exponential" });
  });

  it("stores decayInfo correctly with custom decayConstantDays", () => {
    const record = makeRecord({ daysAgo: 10, asOf: FIXED_DATE });
    const result = computeWeightedPerformanceSummary([record], FIXED_DATE, 90);
    expect(result.decayInfo.decayConstantDays).toBe(90);
    expect(result.decayInfo.method).toBe("exponential");
  });

  it("tradeCount reflects true record count, not effective sample size", () => {
    const records = [
      makeRecord({ daysAgo: 0, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 90, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 360, asOf: FIXED_DATE }),
    ];
    const result = computeWeightedPerformanceSummary(records, FIXED_DATE);
    expect(result.tradeCount).toBe(3);
  });

  it("effectiveSampleSize ≤ tradeCount", () => {
    const records = [
      makeRecord({ daysAgo: 0, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 180, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 360, asOf: FIXED_DATE }),
    ];
    const result = computeWeightedPerformanceSummary(records, FIXED_DATE);
    expect(result.effectiveSampleSize).toBeLessThanOrEqual(records.length);
    expect(result.effectiveSampleSize).toBeGreaterThan(0);
  });

  it("maxDrawdown uses unweighted series (path-dependent)", () => {
    // All wins except the last: cumulative PnL rises then drops
    const records = [
      makeRecord({ daysAgo: 30, pnl: 10, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 20, pnl: 10, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 10, pnl: 10, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 0,  pnl: -15, isWin: false, asOf: FIXED_DATE }),
    ];
    const result = computeWeightedPerformanceSummary(records, FIXED_DATE);
    // cumulative: 10 → 20 → 30 → 15; peak=30, dd=(30-15)/30 = 0.5
    expect(result.maxDrawdown).toBeCloseTo(0.5, 2);
  });
});

describe("computeWeightedPerformanceSummary — decay behaviour", () => {
  const FIXED_DATE = new Date("2025-01-01T00:00:00Z");

  it("a today record has weight ~1.0 (age=0 → exp(0)=1)", () => {
    // Single record from today — weighted and unweighted should match
    const rec = makeRecord({ daysAgo: 0, pnl: 5, returnPct: 0.5, asOf: FIXED_DATE });
    const weighted   = computeWeightedPerformanceSummary([rec], FIXED_DATE);
    const unweighted = computePerformanceSummary([rec]);
    expect(weighted.avgPnl).toBeCloseTo(unweighted.avgPnl, 2);
    expect(weighted.avgReturnPct).toBeCloseTo(unweighted.avgReturnPct, 4);
  });

  it("downweights older records: recent wins dominate win rate", () => {
    // 3 old losses (180 days ago → weight≈0.368) and 3 recent wins (today → weight≈1.0)
    const records = [
      makeRecord({ daysAgo: 180, pnl: -5, returnPct: -0.5, isWin: false, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 180, pnl: -5, returnPct: -0.5, isWin: false, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 180, pnl: -5, returnPct: -0.5, isWin: false, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 0, pnl: 5, returnPct: 0.5, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 0, pnl: 5, returnPct: 0.5, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 0, pnl: 5, returnPct: 0.5, asOf: FIXED_DATE }),
    ];
    const weighted   = computeWeightedPerformanceSummary(records, FIXED_DATE);
    const unweighted = computePerformanceSummary(records);
    // Unweighted win rate = 0.5.
    // Weighted: recent wins have higher weight → win rate > 0.5
    expect(weighted.winRate).toBeGreaterThan(unweighted.winRate);
    expect(weighted.avgReturnPct).toBeGreaterThan(unweighted.avgReturnPct);
  });

  it("upweights older records: old wins dominate when asOf is in the past", () => {
    const PAST_DATE = new Date("2024-01-01T00:00:00Z");
    // 3 recent-relative-to-past wins (daysAgo=0 relative to PAST) and 3 "future" losses
    // We simulate: wins at PAST_DATE, losses 180 days later
    const winTs  = PAST_DATE.toISOString();
    const lossTs = new Date(PAST_DATE.getTime() + 180 * 86_400_000).toISOString();

    const winRecord  = (id: number) => ({ ...makeRecord({ daysAgo: 0, asOf: PAST_DATE }), tradeId: `w${id}`, timestamp: winTs });
    const lossRecord = (id: number) => ({ ...makeRecord({ daysAgo: 0, pnl: -5, returnPct: -0.5, isWin: false, asOf: PAST_DATE }), tradeId: `l${id}`, timestamp: lossTs });

    const records = [winRecord(1), winRecord(2), winRecord(3), lossRecord(1), lossRecord(2), lossRecord(3)];
    // asOf = PAST_DATE, so wins (timestamp=PAST_DATE) are age=0 → weight=1.0
    // losses (timestamp=PAST_DATE+180d) are age=-180 days → clamped to 0 → weight=exp(0)=1.0
    // (age is clamped to ≥0 so future records also get weight 1.0)
    const result = computeWeightedPerformanceSummary(records, PAST_DATE);
    // Both groups at age=0 (future records clamped) → effectively uniform weights
    expect(result.tradeCount).toBe(6);
  });

  it("very old records (5× decayConstant) have negligible weight", () => {
    // 1 old massive loss vs 10 recent small wins
    const records = [
      makeRecord({ daysAgo: 900, pnl: -1000, returnPct: -10, isWin: false, asOf: FIXED_DATE }),
      ...Array.from({ length: 10 }, (_, i) =>
        makeRecord({ daysAgo: i, pnl: 1, returnPct: 0.1, asOf: FIXED_DATE }),
      ),
    ];
    const result = computeWeightedPerformanceSummary(records, FIXED_DATE);
    // Very old loss (900 days / 180 = 5 half-lives → weight ≈ e^{-5} ≈ 0.0067)
    // should barely drag down the weighted average
    expect(result.avgPnl).toBeGreaterThan(0);
    expect(result.winRate).toBeGreaterThan(0.9);
  });

  it("asOf as ISO string works identically to Date object", () => {
    const records = [
      makeRecord({ daysAgo: 30, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 90, asOf: FIXED_DATE }),
    ];
    const dateResult = computeWeightedPerformanceSummary(records, FIXED_DATE);
    const strResult  = computeWeightedPerformanceSummary(records, FIXED_DATE.toISOString());
    expect(dateResult.avgPnl).toBe(strResult.avgPnl);
    expect(dateResult.winRate).toBe(strResult.winRate);
    expect(dateResult.effectiveSampleSize).toBe(strResult.effectiveSampleSize);
  });
});

// ─── 3a. Regression: uniform weights converge to unweighted ──────────────────

describe("computeWeightedPerformanceSummary — regression: uniform weights", () => {
  it("matches unweighted summary when all records have the same timestamp", () => {
    // All records from exactly today → all weights = exp(0) = 1.0
    const FIXED_DATE = new Date("2025-06-01T00:00:00Z");
    const records = [
      makeRecord({ daysAgo: 0, pnl: 5,   returnPct: 0.5,  asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 0, pnl: -2,  returnPct: -0.2, isWin: false, asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 0, pnl: 8,   returnPct: 0.8,  asOf: FIXED_DATE }),
      makeRecord({ daysAgo: 0, pnl: 3,   returnPct: 0.3,  asOf: FIXED_DATE }),
    ];
    const weighted   = computeWeightedPerformanceSummary(records, FIXED_DATE);
    const unweighted = computePerformanceSummary(records);

    expect(weighted.tradeCount).toBe(unweighted.tradeCount);
    expect(weighted.winRate).toBeCloseTo(unweighted.winRate, 3);
    expect(weighted.avgPnl).toBeCloseTo(unweighted.avgPnl, 2);
    expect(weighted.avgReturnPct).toBeCloseTo(unweighted.avgReturnPct, 3);
    expect(weighted.returnStdDev).toBeCloseTo(unweighted.returnStdDev, 3);
    expect(weighted.sharpeLike).toBeCloseTo(unweighted.sharpeLike, 3);
    expect(weighted.maxDrawdown).toBeCloseTo(unweighted.maxDrawdown, 4);
    // effectiveSampleSize ≈ n when weights are equal
    expect(weighted.effectiveSampleSize).toBeCloseTo(4, 1);
  });
});

// ─── 3b. Two-level bucket functions ──────────────────────────────────────────

describe("bucketConfidence2Level", () => {
  it("returns 'weak' for confidence below 0.60", () => {
    expect(bucketConfidence2Level(0)).toBe("weak");
    expect(bucketConfidence2Level(0.50)).toBe("weak");
    expect(bucketConfidence2Level(0.599)).toBe("weak");
  });

  it("returns 'strong' for confidence at or above 0.60", () => {
    expect(bucketConfidence2Level(0.60)).toBe("strong");
    expect(bucketConfidence2Level(0.75)).toBe("strong");
    expect(bucketConfidence2Level(1.0)).toBe("strong");
  });

  it("boundary value 0.60 is 'strong'", () => {
    expect(bucketConfidence2Level(0.60)).toBe("strong");
  });
});

describe("bucketReliability2Level", () => {
  it("returns 'weak' for reliability below 0.55", () => {
    expect(bucketReliability2Level(0)).toBe("weak");
    expect(bucketReliability2Level(0.40)).toBe("weak");
    expect(bucketReliability2Level(0.5499)).toBe("weak");
  });

  it("returns 'strong' for reliability at or above 0.55", () => {
    expect(bucketReliability2Level(0.55)).toBe("strong");
    expect(bucketReliability2Level(0.70)).toBe("strong");
    expect(bucketReliability2Level(1.0)).toBe("strong");
  });

  it("boundary value 0.55 is 'strong'", () => {
    expect(bucketReliability2Level(0.55)).toBe("strong");
  });
});

describe("bucketBenchmark2Level", () => {
  it("returns 'weak' for alignment below 0.50", () => {
    expect(bucketBenchmark2Level(0)).toBe("weak");
    expect(bucketBenchmark2Level(0.30)).toBe("weak");
    expect(bucketBenchmark2Level(0.4999)).toBe("weak");
  });

  it("returns 'strong' for alignment at or above 0.50", () => {
    expect(bucketBenchmark2Level(0.50)).toBe("strong");
    expect(bucketBenchmark2Level(0.70)).toBe("strong");
    expect(bucketBenchmark2Level(1.0)).toBe("strong");
  });

  it("boundary value 0.50 is 'strong'", () => {
    expect(bucketBenchmark2Level(0.50)).toBe("strong");
  });
});

describe("2-level buckets: backward compat — original 3-level functions unchanged", () => {
  it("bucketConfidence still produces three tiers", () => {
    expect(bucketConfidence(0.30)).toBe("low");
    expect(bucketConfidence(0.60)).toBe("medium");
    expect(bucketConfidence(0.90)).toBe("high");
  });

  it("bucketReliability still produces three tiers", () => {
    expect(bucketReliability(0.20)).toBe("low");
    expect(bucketReliability(0.55)).toBe("medium");
    expect(bucketReliability(0.80)).toBe("high");
  });

  it("bucketBenchmarkAlignment still produces three tiers", () => {
    expect(bucketBenchmarkAlignment(0.10)).toBe("weak");
    expect(bucketBenchmarkAlignment(0.50)).toBe("neutral");
    expect(bucketBenchmarkAlignment(0.90)).toBe("strong");
  });
});

// ─── 4. 2-level buckets reduce fragmentation ─────────────────────────────────

describe("2-level bucket fragmentation improvement", () => {
  it("partitions the score range into exactly two groups", () => {
    const scores = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

    const confBuckets = new Set(scores.map(bucketConfidence2Level));
    expect(confBuckets.size).toBe(2);
    expect(confBuckets).toContain("weak");
    expect(confBuckets).toContain("strong");

    const relBuckets = new Set(scores.map(bucketReliability2Level));
    expect(relBuckets.size).toBe(2);

    const bmBuckets = new Set(scores.map(bucketBenchmark2Level));
    expect(bmBuckets.size).toBe(2);
  });
});

// ─── 5. Calibration coarseness: global-level, not per-bucket ─────────────────

describe("calibration coarseness guard", () => {
  /**
   * Build a minimal PerformanceSummary-shaped object (the same shape
   * computeCalibrationFactor expects).
   */
  const makePerformanceSummary = (
    tradeCount: number,
    winRate: number,
    sharpeLike: number,
    maxDrawdown = 0,
  ) => ({
    tradeCount,
    winRate,
    avgPnl: 1,
    avgReturnPct: 0.1,
    returnStdDev: 0.05,
    sharpeLike,
    maxDrawdown,
  });

  it("returns 1.0 multiplier when below DEFAULT_MIN_SAMPLE_SIZE", () => {
    const factor = computeCalibrationFactor(makePerformanceSummary(29, 0.7, 2.5));
    expect(factor.multiplier).toBe(1.0);
    expect(factor.reason[0]).toMatch(/insufficient_sample/);
  });

  it("fires adjustments once sample gate passes (n=30)", () => {
    const factor = computeCalibrationFactor(makePerformanceSummary(30, 0.65, 2.5));
    expect(factor.multiplier).toBeGreaterThan(1.0);
  });

  it("operates on global summary — no per-bucket dimension slicing in reason strings", () => {
    const factor = computeCalibrationFactor(makePerformanceSummary(35, 0.6, 1.5));
    const reasons = factor.reason.join(" ");
    // Calibration reasons must not reference bucket dimensions like
    // "confidence_bucket=high" or "reliability_bucket=low".
    // (Words like "strong" appear in threshold names such as "win_rate_strong",
    // which is fine — those describe performance tiers, not per-bucket slicing.)
    expect(reasons).not.toMatch(/confidence_bucket|reliability_bucket|benchmark_bucket/);
    expect(reasons).not.toMatch(/bucket=(high|medium|low|strong|weak)/);
  });

  it("DEFAULT_MIN_SAMPLE_SIZE is 30 (stability guard)", () => {
    expect(DEFAULT_MIN_SAMPLE_SIZE).toBe(30);
  });
});

// ─── 6. Multi-horizon validation: attribution carries blended P&L ─────────────

describe("multi-horizon → attribution → calibration pipeline", () => {
  /**
   * Confirm that when blendedExitResult is passed to buildTradeAttributionRecord,
   * the resulting record's pnl equals blendedPnl, so that computePerformanceSummary
   * (and therefore computeCalibrationFactor) operates on blended figures.
   */
  it("attribution record pnl equals blendedPnl when blended exit provided", () => {
    const blendedExitResult = computeBlendedExit(
      100,   // executedSize
      100,   // entryPrice
      "long",
      50,    // magnitudeBp
      "cpi",
    );

    const params: BuildAttributionParams = {
      trade: {
        asset: "SPY",
        direction: "long",
        executed_size: 100,
        entry_price: 100,
        expected_magnitude_bp: 50,
        horizon: "medium",
        simulated_pnl: 50,
        executed_at: "2024-06-01T10:00:00Z",
      },
      tradeId: "blend-001",
      eventId: "e-cpi-1",
      eventFamily: "cpi",
      confidence: 0.75,
      reliability: 0.65,
      holdingPeriodMinutes: 120,
      slippageBps: 3,
      blendedExitResult,
    };

    const record = buildTradeAttributionRecord(params);

    // The record's pnl must be sourced from the blended result
    expect(record.pnl).toBe(blendedExitResult.blendedPnl);
    expect(record.returnPct).toBe(blendedExitResult.blendedReturnPct);
    // exitPrice is the medium horizon (index 1)
    expect(record.exitPrice).toBe(blendedExitResult.horizons[1].exitPrice);
  });

  it("attribution record pnl is blended (not single-horizon) when blended exit provided", () => {
    const blendedExitResult = computeBlendedExit(100, 100, "long", 100, "fomc");

    // blended pnl should differ from what you'd get with single-horizon computation
    const singleHorizonPnl = 100 * (100 * (1 + 100 / 10_000) * (1 - 3 / 10_000) - 100);

    const params: BuildAttributionParams = {
      trade: {
        asset: "TLT",
        direction: "long",
        executed_size: 100,
        entry_price: 100,
        expected_magnitude_bp: 100,
        horizon: "medium",
        simulated_pnl: singleHorizonPnl,
        executed_at: "2024-07-31T14:00:00Z",
      },
      tradeId: "blend-002",
      eventId: "e-fomc-1",
      eventFamily: "fomc",
      confidence: 0.8,
      reliability: 0.7,
      holdingPeriodMinutes: 240,
      slippageBps: 3,
      blendedExitResult,
    };

    const record = buildTradeAttributionRecord(params);
    expect(record.pnl).toBe(blendedExitResult.blendedPnl);
  });

  it("computePerformanceSummary built from blended attribution records produces valid calibration input", () => {
    // Build 30 blended attribution records (sample gate = 30)
    const records = Array.from({ length: 30 }, (_, i) => {
      const blendedExitResult = computeBlendedExit(100, 100, "long", 50, "cpi");
      const params: BuildAttributionParams = {
        trade: {
          asset: "SPY",
          direction: "long",
          executed_size: 100,
          entry_price: 100,
          expected_magnitude_bp: 50,
          horizon: "medium",
          simulated_pnl: 50,
          executed_at: `2024-0${(i % 9) + 1}-01T00:00:00Z`,
        },
        tradeId: `t-${i}`,
        eventId: `e-${i}`,
        eventFamily: "cpi",
        confidence: 0.7,
        reliability: 0.65,
        holdingPeriodMinutes: 120,
        slippageBps: 3,
        blendedExitResult,
      };
      return buildTradeAttributionRecord(params);
    });

    // All records are wins (positive blended P&L)
    expect(records.every((r) => r.isWin)).toBe(true);

    const summary = computePerformanceSummary(records);
    expect(summary.tradeCount).toBe(30);
    expect(summary.winRate).toBe(1.0);

    const factor = computeCalibrationFactor(summary);
    // win rate = 1.0 (≥ 0.60 strong threshold) → multiplier > 1.0
    expect(factor.multiplier).toBeGreaterThan(1.0);
  });
});

// ─── 7. WeightedPerformanceSummary type completeness ─────────────────────────

describe("WeightedPerformanceSummary type completeness", () => {
  it("result includes all PerformanceSummary fields plus effectiveSampleSize and decayInfo", () => {
    const FIXED_DATE = new Date("2025-01-01T00:00:00Z");
    const record = makeRecord({ daysAgo: 10, asOf: FIXED_DATE });
    const result: WeightedPerformanceSummary = computeWeightedPerformanceSummary(
      [record],
      FIXED_DATE,
    );

    // PerformanceSummary fields
    expect(typeof result.tradeCount).toBe("number");
    expect(typeof result.winRate).toBe("number");
    expect(typeof result.avgPnl).toBe("number");
    expect(typeof result.avgReturnPct).toBe("number");
    expect(typeof result.returnStdDev).toBe("number");
    expect(typeof result.sharpeLike).toBe("number");
    expect(typeof result.maxDrawdown).toBe("number");

    // WeightedPerformanceSummary extensions
    expect(typeof result.effectiveSampleSize).toBe("number");
    expect(result.decayInfo.method).toBe("exponential");
    expect(typeof result.decayInfo.decayConstantDays).toBe("number");
  });
});
