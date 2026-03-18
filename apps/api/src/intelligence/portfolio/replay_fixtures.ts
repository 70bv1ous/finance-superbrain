/**
 * Replay fixtures (Phase 7C.2 — validation only).
 *
 * Three synthetic TradeAttributionRecord datasets used to validate
 * the replay engine and comparator in isolation from live data.
 *
 * strongTrendScenario — designed so that progressive filtering improves
 *   the sharpeLike metric:
 *     ADAPTIVE_7C sharpeLike > CALIBRATION_7B sharpeLike > BASELINE_7A sharpeLike
 *
 *   Group A (20, high/high):  returnPct ∈ {0.14, 0.10}  — all wins
 *   Group B (10, high/medium): returnPct = 0.08          — all wins
 *   Group C (20, low/low):    returnPct = -0.08          — all losses
 *
 *   BASELINE_7A  = all 50 trades  → avg≈0.032,  stdDev≈0.0935  → sharpeLike≈0.34
 *   CALIBRATION_7B = A+B = 30    → avg≈0.1067, stdDev≈0.0249  → sharpeLike≈4.28
 *   ADAPTIVE_7C   = A only = 20  → avg=0.12,   stdDev=0.02    → sharpeLike=6.00
 *
 * noisyScenario    — mixed signals, ~50 % win rate.
 * neutralScenario  — balanced ±5 pnl, medium confidence throughout.
 *
 * All records are immutable and exported as readonly arrays.
 */

import type { TradeAttributionRecord } from "./attribution_store.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRecord(
  overrides: Partial<TradeAttributionRecord> & {
    tradeId:          string;
    timestamp:        string;
    confidenceBucket: "low" | "medium" | "high";
    reliabilityBucket:"low" | "medium" | "high";
    pnl:              number;
    returnPct:        number;
    isWin:            boolean;
    confidence:       number;
    reliability:      number;
  },
): TradeAttributionRecord {
  return {
    eventId:              overrides.tradeId,
    eventFamily:          "cpi",
    instrument:           "SPY",
    direction:            "long",
    holdingPeriodMinutes: 60,
    entryPrice:           100,
    exitPrice:            101,
    slippageBps:          3,
    ...overrides,
  };
}

// ─── Strong-trend scenario ────────────────────────────────────────────────────

/**
 * 50 records in three groups.
 * Progressive filtering removes noise; sharpeLike improves with each mode.
 *
 * Group A (indices 0–19):  confidenceBucket="high", reliabilityBucket="high"
 *   indices 0–9  : returnPct=0.14, pnl=14
 *   indices 10–19: returnPct=0.10, pnl=10
 *
 * Group B (indices 20–29): confidenceBucket="high", reliabilityBucket="medium"
 *   returnPct=0.08, pnl=8
 *
 * Group C (indices 30–49): confidenceBucket="low",  reliabilityBucket="low"
 *   returnPct=-0.08, pnl=-8, isWin=false
 */
export const strongTrendScenario: readonly TradeAttributionRecord[] = [
  // Group A — high/high, first half (returnPct=0.14)
  ...Array.from({ length: 10 }, (_, i) =>
    makeRecord({
      tradeId:           `st-${i}`,
      timestamp:         `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      confidence:        0.80,
      reliability:       0.75,
      confidenceBucket:  "high",
      reliabilityBucket: "high",
      returnPct:         0.14,
      pnl:               14,
      isWin:             true,
    }),
  ),
  // Group A — high/high, second half (returnPct=0.10)
  ...Array.from({ length: 10 }, (_, i) =>
    makeRecord({
      tradeId:           `st-${i + 10}`,
      timestamp:         `2024-02-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      confidence:        0.80,
      reliability:       0.75,
      confidenceBucket:  "high",
      reliabilityBucket: "high",
      returnPct:         0.10,
      pnl:               10,
      isWin:             true,
    }),
  ),
  // Group B — high/medium (returnPct=0.08)
  ...Array.from({ length: 10 }, (_, i) =>
    makeRecord({
      tradeId:           `st-${i + 20}`,
      timestamp:         `2024-03-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      confidence:        0.72,
      reliability:       0.50,
      confidenceBucket:  "high",
      reliabilityBucket: "medium",
      returnPct:         0.08,
      pnl:               8,
      isWin:             true,
    }),
  ),
  // Group C — low/low (returnPct=-0.08, isWin=false)
  ...Array.from({ length: 20 }, (_, i) =>
    makeRecord({
      tradeId:           `st-${i + 30}`,
      timestamp:         `2024-04-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      confidence:        0.30,
      reliability:       0.30,
      confidenceBucket:  "low",
      reliabilityBucket: "low",
      returnPct:         -0.08,
      pnl:               -8,
      isWin:             false,
    }),
  ),
];

// ─── Noisy scenario ───────────────────────────────────────────────────────────

/**
 * 30 records with ~50 % win rate, mixed confidenceBucket, reliabilityBucket="medium".
 * 15 wins (confidenceBucket="high") + 15 losses (confidenceBucket="low").
 */
export const noisyScenario: readonly TradeAttributionRecord[] = [
  ...Array.from({ length: 15 }, (_, i) =>
    makeRecord({
      tradeId:           `noisy-${i}`,
      timestamp:         `2024-05-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      confidence:        0.65,
      reliability:       0.50,
      confidenceBucket:  "high",
      reliabilityBucket: "medium",
      returnPct:         0.05,
      pnl:               5,
      isWin:             true,
    }),
  ),
  ...Array.from({ length: 15 }, (_, i) =>
    makeRecord({
      tradeId:           `noisy-${i + 15}`,
      timestamp:         `2024-06-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      confidence:        0.40,
      reliability:       0.45,
      confidenceBucket:  "low",
      reliabilityBucket: "medium",
      returnPct:         -0.05,
      pnl:               -5,
      isWin:             false,
    }),
  ),
];

// ─── Neutral scenario ─────────────────────────────────────────────────────────

/**
 * 20 records alternating win/loss with equal magnitude pnl (±5).
 * All confidenceBucket="medium" so CALIBRATION_7B and ADAPTIVE_7C
 * both return zero trades (nothing passes the "high" filter).
 */
export const neutralScenario: readonly TradeAttributionRecord[] = Array.from(
  { length: 20 },
  (_, i) =>
    makeRecord({
      tradeId:           `neutral-${i}`,
      timestamp:         `2024-07-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      confidence:        0.55,
      reliability:       0.50,
      confidenceBucket:  "medium",
      reliabilityBucket: "medium",
      returnPct:         i % 2 === 0 ?  0.05 : -0.05,
      pnl:               i % 2 === 0 ?  5    : -5,
      isWin:             i % 2 === 0,
    }),
);
