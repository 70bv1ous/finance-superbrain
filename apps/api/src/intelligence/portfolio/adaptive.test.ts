/**
 * Phase 7C tests — Adaptive Intelligence Layer.
 *
 * Coverage:
 *  1.  signal_memory: key building, memory construction, lookup
 *  2.  signal_trust: sample gate, win-rate tiers, Sharpe tiers, clamping, NEUTRAL_TRUST
 *  3.  adaptive_decision: trust application, failure suppression, audit trail
 *  4.  failure_memory: failure-rate threshold, consecutive-loss threshold,
 *      minimum sample gate, combined suppression, lookup
 *  5.  Integration: attribution records → signal memory → trust → adaptive decision
 *  6.  Integration: attribution records → failure memory → suppression pipeline
 *  7.  Integration (execution): trust_score threads through sizePosition /
 *      generateTradeSignals / runPortfolioSimulation
 *  8.  Regression: trustScore = 1.0 and layer disabled → Phase 7A/7B unchanged
 */

import { describe, it, expect } from "vitest";

// ── signal_memory ─────────────────────────────────────────────────────────────
import {
  buildSignalMemoryKey,
  keyFromRecord,
  buildSignalMemoryFromRecords,
  lookupSignalMemory,
  type SignalPerformanceMemory,
} from "./signal_memory.js";

// ── signal_trust ──────────────────────────────────────────────────────────────
import {
  computeSignalTrust,
  NEUTRAL_TRUST,
  TRUST_MIN,
  TRUST_MAX,
  DEFAULT_TRUST_MIN_SAMPLE_SIZE,
  TRUST_WIN_RATE_STRONG_THRESHOLD,
  TRUST_WIN_RATE_POOR_THRESHOLD,
  TRUST_SHARPE_STRONG_THRESHOLD,
  TRUST_SHARPE_WEAK_THRESHOLD,
} from "./signal_trust.js";

// ── adaptive_decision ─────────────────────────────────────────────────────────
import {
  applyAdaptiveDecision,
  TRUST_SUPPRESS_THRESHOLD,
  TRUST_BOOST_THRESHOLD,
} from "./adaptive_decision.js";

// ── failure_memory ────────────────────────────────────────────────────────────
import {
  buildFailureMemory,
  lookupFailureSignal,
  DEFAULT_FAILURE_RATE_THRESHOLD,
  DEFAULT_CONSECUTIVE_LOSS_THRESHOLD,
  DEFAULT_FAILURE_MIN_SAMPLE_SIZE,
} from "./failure_memory.js";

// ── execution (integration) ───────────────────────────────────────────────────
import {
  sizePosition,
  generateTradeSignals,
  runPortfolioSimulation,
  type PortfolioSimulationInput,
} from "./execution.js";
import { createPortfolio } from "./portfolio.js";
import { createRiskConstraints } from "./risk.js";
import type { TradeAttributionRecord } from "./attribution_store.js";

// ─── Shared test helpers ──────────────────────────────────────────────────────

const makeRecord = (opts: {
  eventFamily: string;
  direction: "long" | "short";
  confidence: number;
  reliability: number;
  pnl: number;
  returnPct: number;
  isWin: boolean;
  timestamp?: string;
}): TradeAttributionRecord => ({
  tradeId: `t-${Math.random().toString(36).slice(2)}`,
  eventId: "e1",
  eventFamily: opts.eventFamily,
  instrument: "SPY",
  direction: opts.direction,
  confidence: opts.confidence,
  reliability: opts.reliability,
  confidenceBucket: "medium",
  reliabilityBucket: "medium",
  holdingPeriodMinutes: 60,
  entryPrice: 100,
  exitPrice: 101,
  slippageBps: 3,
  pnl: opts.pnl,
  returnPct: opts.returnPct,
  isWin: opts.isWin,
  timestamp: opts.timestamp ?? "2024-06-01T10:00:00Z",
});

/** Build n attribution records with specified win probability. */
const makeRecords = (
  n: number,
  winFrac: number,
  opts: { eventFamily?: string; direction?: "long" | "short"; confidence?: number; reliability?: number } = {},
): TradeAttributionRecord[] => {
  const wins = Math.round(n * winFrac);
  return Array.from({ length: n }, (_, i) => {
    const isWin = i < wins;
    return makeRecord({
      eventFamily: opts.eventFamily ?? "cpi",
      direction: opts.direction ?? "long",
      confidence: opts.confidence ?? 0.7,
      reliability: opts.reliability ?? 0.6,
      pnl: isWin ? 10 : -10,
      returnPct: isWin ? 0.1 : -0.1,
      isWin,
      timestamp: `2024-0${(i % 9) + 1}-01T00:00:00Z`,
    });
  });
};

/** Minimal memory object for trust tests. */
const makeMemory = (
  tradeCount: number,
  winRate: number,
  sharpeLike: number,
  key = "cpi|long|strong_conf|weak_rel",
): SignalPerformanceMemory => ({
  key,
  tradeCount,
  winRate,
  avgReturn: 0.1,
  sharpeLike,
  lastUpdated: "2024-06-01T00:00:00Z",
});

// ─── 1. signal_memory — key building ─────────────────────────────────────────

describe("buildSignalMemoryKey", () => {
  it("produces a pipe-delimited composite key", () => {
    const key = buildSignalMemoryKey("cpi", "long", "strong", "weak");
    expect(key).toBe("cpi|long|strong_conf|weak_rel");
  });

  it("encodes direction", () => {
    expect(buildSignalMemoryKey("fomc", "short", "weak", "strong")).toBe(
      "fomc|short|weak_conf|strong_rel",
    );
  });

  it("handles unknown event family", () => {
    const key = buildSignalMemoryKey("unknown_event", "long", "weak", "weak");
    expect(key).toContain("unknown_event");
  });

  it("max distinct keys is 24 for 3 families × 2 dir × 2 conf × 2 rel", () => {
    const families   = ["cpi", "fomc", "nfp"] as const;
    const directions = ["long", "short"] as const;
    const conf       = ["weak", "strong"] as const;
    const rel        = ["weak", "strong"] as const;
    const keys = new Set<string>();
    for (const f of families)
      for (const d of directions)
        for (const c of conf)
          for (const r of rel)
            keys.add(buildSignalMemoryKey(f, d, c, r));
    expect(keys.size).toBe(24);
  });
});

describe("keyFromRecord", () => {
  it("matches manual key construction", () => {
    // confidence=0.7 → strong (≥0.60), reliability=0.6 → strong (≥0.55)
    const record = makeRecord({
      eventFamily: "nfp", direction: "short",
      confidence: 0.7, reliability: 0.6,
      pnl: 5, returnPct: 0.05, isWin: true,
    });
    const expected = buildSignalMemoryKey("nfp", "short", "strong", "strong");
    expect(keyFromRecord(record)).toBe(expected);
  });

  it("maps confidence <0.60 to weak_conf", () => {
    const record = makeRecord({
      eventFamily: "cpi", direction: "long",
      confidence: 0.55, reliability: 0.6,
      pnl: 5, returnPct: 0.05, isWin: true,
    });
    expect(keyFromRecord(record)).toContain("weak_conf");
  });
});

// ─── 2. signal_memory — store construction ───────────────────────────────────

describe("buildSignalMemoryFromRecords", () => {
  it("returns empty store for empty input", () => {
    const store = buildSignalMemoryFromRecords([]);
    expect(store.entries).toHaveLength(0);
  });

  it("groups records by composite key", () => {
    const records = [
      ...makeRecords(5, 0.6, { eventFamily: "cpi", direction: "long" }),
      ...makeRecords(5, 0.4, { eventFamily: "cpi", direction: "short" }),
    ];
    const store = buildSignalMemoryFromRecords(records);
    // All records use confidence=0.7 (strong) and reliability=0.6 (strong)
    // → two distinct keys: cpi|long|strong_conf|strong_rel and cpi|short|...
    expect(store.entries.length).toBeGreaterThanOrEqual(2);
  });

  it("computes winRate correctly", () => {
    const records = makeRecords(10, 0.7, { eventFamily: "cpi", direction: "long" });
    const store = buildSignalMemoryFromRecords(records);
    const key = buildSignalMemoryKey("cpi", "long", "strong", "strong");
    const entry = lookupSignalMemory(store, key);
    expect(entry).toBeDefined();
    expect(entry!.tradeCount).toBe(10);
    expect(entry!.winRate).toBeCloseTo(0.7, 2);
  });

  it("computes avgReturn correctly", () => {
    // 5 wins (+0.1) and 5 losses (-0.1) → avgReturn = 0
    const records = makeRecords(10, 0.5, { eventFamily: "fomc", direction: "long" });
    const store = buildSignalMemoryFromRecords(records);
    const key = buildSignalMemoryKey("fomc", "long", "strong", "strong");
    const entry = lookupSignalMemory(store, key);
    expect(entry!.avgReturn).toBeCloseTo(0, 3);
  });

  it("sets sharpeLike to 0 when all returns are identical", () => {
    // All wins → stdDev = 0 → sharpeLike = 0
    const records = makeRecords(5, 1.0, { eventFamily: "nfp", direction: "long" });
    const store = buildSignalMemoryFromRecords(records);
    const key = buildSignalMemoryKey("nfp", "long", "strong", "strong");
    const entry = lookupSignalMemory(store, key);
    expect(entry!.sharpeLike).toBe(0);
  });

  it("sets lastUpdated to the most recent timestamp", () => {
    const records = [
      makeRecord({ eventFamily: "cpi", direction: "long", confidence: 0.7, reliability: 0.6,
        pnl: 5, returnPct: 0.05, isWin: true, timestamp: "2024-01-01T00:00:00Z" }),
      makeRecord({ eventFamily: "cpi", direction: "long", confidence: 0.7, reliability: 0.6,
        pnl: 5, returnPct: 0.05, isWin: true, timestamp: "2024-06-01T00:00:00Z" }),
    ];
    const store = buildSignalMemoryFromRecords(records);
    const key = buildSignalMemoryKey("cpi", "long", "strong", "strong");
    const entry = lookupSignalMemory(store, key)!;
    expect(entry.lastUpdated).toBe("2024-06-01T00:00:00Z");
  });
});

describe("lookupSignalMemory", () => {
  it("returns undefined for a missing key", () => {
    const store = buildSignalMemoryFromRecords([]);
    expect(lookupSignalMemory(store, "nonexistent")).toBeUndefined();
  });

  it("finds an existing entry", () => {
    const records = makeRecords(5, 0.6, { eventFamily: "cpi", direction: "long" });
    const store = buildSignalMemoryFromRecords(records);
    const key = buildSignalMemoryKey("cpi", "long", "strong", "strong");
    expect(lookupSignalMemory(store, key)).toBeDefined();
  });
});

// ─── 3. signal_trust — sample gate ───────────────────────────────────────────

describe("computeSignalTrust — sample gate", () => {
  it("returns score=1.0 when below DEFAULT_TRUST_MIN_SAMPLE_SIZE", () => {
    const trust = computeSignalTrust(makeMemory(29, 0.8, 3.0));
    expect(trust.score).toBe(1.0);
    expect(trust.reason[0]).toMatch(/insufficient_sample/);
  });

  it("fires adjustments when at exactly DEFAULT_TRUST_MIN_SAMPLE_SIZE", () => {
    const trust = computeSignalTrust(makeMemory(DEFAULT_TRUST_MIN_SAMPLE_SIZE, 0.65, 2.5));
    expect(trust.score).toBeGreaterThan(1.0);
  });

  it("DEFAULT_TRUST_MIN_SAMPLE_SIZE is 30", () => {
    expect(DEFAULT_TRUST_MIN_SAMPLE_SIZE).toBe(30);
  });
});

// ─── 4. signal_trust — win-rate tiers ────────────────────────────────────────

describe("computeSignalTrust — win-rate adjustments", () => {
  const N = 30;

  it("strong win rate (≥60%) raises score", () => {
    const trust = computeSignalTrust(makeMemory(N, TRUST_WIN_RATE_STRONG_THRESHOLD, 1.5));
    expect(trust.score).toBeGreaterThan(1.0);
    expect(trust.reason.join(" ")).toMatch(/win_rate_strong/);
  });

  it("above-average win rate raises score moderately", () => {
    const trust = computeSignalTrust(makeMemory(N, 0.55, 1.5));
    const strongTrust = computeSignalTrust(makeMemory(N, 0.65, 1.5));
    expect(trust.score).toBeGreaterThan(1.0);
    expect(trust.score).toBeLessThan(strongTrust.score);
    expect(trust.reason.join(" ")).toMatch(/win_rate_above_avg/);
  });

  it("poor win rate (≤35%) lowers score", () => {
    const trust = computeSignalTrust(makeMemory(N, TRUST_WIN_RATE_POOR_THRESHOLD, 0.3));
    expect(trust.score).toBeLessThan(1.0);
    expect(trust.reason.join(" ")).toMatch(/win_rate_poor/);
  });

  it("below-average win rate lowers score moderately", () => {
    const trust = computeSignalTrust(makeMemory(N, 0.40, 0.3));
    const poorTrust = computeSignalTrust(makeMemory(N, 0.30, 0.3));
    expect(trust.score).toBeLessThan(1.0);
    expect(trust.score).toBeGreaterThan(poorTrust.score);
    expect(trust.reason.join(" ")).toMatch(/win_rate_below_avg/);
  });

  it("neutral win rate leaves score at baseline", () => {
    const trust = computeSignalTrust(makeMemory(N, 0.50, 1.0));
    // 50% win rate is neutral — only Sharpe determines if score != 1.0
    expect(trust.reason.join(" ")).toMatch(/win_rate_neutral/);
  });
});

// ─── 5. signal_trust — Sharpe tiers ──────────────────────────────────────────

describe("computeSignalTrust — Sharpe adjustments", () => {
  const N = 30;

  it("strong Sharpe (≥2.0) raises score", () => {
    const trust = computeSignalTrust(makeMemory(N, 0.50, TRUST_SHARPE_STRONG_THRESHOLD));
    expect(trust.score).toBeGreaterThan(1.0);
    expect(trust.reason.join(" ")).toMatch(/sharpe_strong/);
  });

  it("adequate Sharpe (≥1.0) gives small upward nudge", () => {
    const trust = computeSignalTrust(makeMemory(N, 0.50, 1.5));
    expect(trust.score).toBeGreaterThan(1.0);
    expect(trust.reason.join(" ")).toMatch(/sharpe_adequate/);
  });

  it("negative Sharpe lowers score significantly", () => {
    const trust = computeSignalTrust(makeMemory(N, 0.50, -0.5));
    expect(trust.score).toBeLessThan(1.0);
    expect(trust.reason.join(" ")).toMatch(/sharpe_negative/);
  });

  it("weak Sharpe (<0.5) lowers score moderately", () => {
    const trust = computeSignalTrust(makeMemory(N, 0.50, TRUST_SHARPE_WEAK_THRESHOLD - 0.01));
    expect(trust.score).toBeLessThan(1.0);
    expect(trust.reason.join(" ")).toMatch(/sharpe_weak/);
  });

  it("neutral Sharpe [0.5, 2.0) gives no adjustment", () => {
    const trust = computeSignalTrust(makeMemory(N, 0.50, 1.0));
    expect(trust.reason.join(" ")).toMatch(/sharpe_adequate/);
  });
});

// ─── 6. signal_trust — clamping and bounds ───────────────────────────────────

describe("computeSignalTrust — clamping", () => {
  it("score is never below TRUST_MIN (0.75 — Phase 7C.1 hardening)", () => {
    // Worst case: winRate=0.10 (poor → -0.15) + sharpeLike=-5.0 (negative → -0.10)
    // raw = 1.0 - 0.15 - 0.10 = 0.75 — exactly hits TRUST_MIN (narrowed from 0.5 in 7C.1)
    const trust = computeSignalTrust(makeMemory(30, 0.10, -5.0));
    expect(trust.score).toBeGreaterThanOrEqual(TRUST_MIN);
    expect(trust.score).toBeCloseTo(0.75, 4);
  });

  it("score is never above TRUST_MAX (1.25 — Phase 7C.1 hardening)", () => {
    // Best case: winRate=1.0 (strong → +0.15) + sharpeLike=10.0 (strong → +0.10)
    // raw = 1.0 + 0.15 + 0.10 = 1.25 — exactly hits TRUST_MAX (narrowed from 1.5 in 7C.1)
    const trust = computeSignalTrust(makeMemory(30, 1.0, 10.0));
    expect(trust.score).toBeLessThanOrEqual(TRUST_MAX);
    expect(trust.score).toBeCloseTo(1.25, 4);
  });

  it("trust bounds [0.75, 1.25] are tighter than calibration bounds [0.5, 1.5]", () => {
    expect(TRUST_MIN).toBe(0.75);
    expect(TRUST_MAX).toBe(1.25);
  });

  it("NEUTRAL_TRUST has score=1.0", () => {
    expect(NEUTRAL_TRUST.score).toBe(1.0);
    expect(NEUTRAL_TRUST.reason).toHaveLength(1);
    expect(NEUTRAL_TRUST.reason[0]).toMatch(/no_memory/);
  });
});

// ─── 7. adaptive_decision — trust application ────────────────────────────────

describe("applyAdaptiveDecision", () => {
  const makeTrust = (score: number) => ({
    score,
    reason: [`test_trust: score=${score}`],
  });

  it("scales size by trust score", () => {
    const result = applyAdaptiveDecision(100, makeTrust(1.2));
    expect(result.adjustedSize).toBeCloseTo(120, 2);
    expect(result.isSuppressed).toBe(false);
    expect(result.trustScore).toBe(1.2);
  });

  it("reduces size when trust < TRUST_SUPPRESS_THRESHOLD", () => {
    const result = applyAdaptiveDecision(100, makeTrust(0.6));
    expect(result.adjustedSize).toBeCloseTo(60, 2);
    expect(result.isSuppressed).toBe(false);
    expect(result.reason.join(" ")).toMatch(/trust_below_threshold/);
  });

  it("labels boost when trust > TRUST_BOOST_THRESHOLD", () => {
    const result = applyAdaptiveDecision(100, makeTrust(1.3));
    expect(result.adjustedSize).toBeCloseTo(130, 2);
    expect(result.reason.join(" ")).toMatch(/trust_above_boost_threshold/);
  });

  it("neutral trust (1.0) leaves size unchanged", () => {
    const result = applyAdaptiveDecision(100, NEUTRAL_TRUST);
    expect(result.adjustedSize).toBe(100);
    expect(result.isSuppressed).toBe(false);
  });

  it("hard-blocks trade when failure signal is suppressed", () => {
    const failureSignal = {
      key: "cpi|long|strong_conf|weak_rel",
      failureRate: 0.80,
      consecutiveLosses: 6,
      isSuppressed: true,
      isRecovering: false,
      reason: "suppressed: failureRate=80%",
    };
    const result = applyAdaptiveDecision(100, makeTrust(1.0), failureSignal);
    expect(result.adjustedSize).toBe(0);
    expect(result.isSuppressed).toBe(true);
    expect(result.reason.join(" ")).toMatch(/failure_suppressed/);
  });

  it("does NOT suppress when failure signal is not suppressed", () => {
    const failureSignal = {
      key: "cpi|long|strong_conf|weak_rel",
      failureRate: 0.40,
      consecutiveLosses: 2,
      isSuppressed: false,
      isRecovering: false,
      reason: "no_suppression",
    };
    const result = applyAdaptiveDecision(100, makeTrust(1.0), failureSignal);
    expect(result.adjustedSize).toBe(100);
    expect(result.isSuppressed).toBe(false);
  });

  it("failure suppression takes priority over trust score", () => {
    // Even with a great trust score, failure suppression wins
    const failureSignal = {
      key: "nfp|short|weak_conf|weak_rel",
      failureRate: 0.85,
      consecutiveLosses: 7,
      isSuppressed: true,
      isRecovering: false,
      reason: "suppressed: failureRate=85%",
    };
    const result = applyAdaptiveDecision(100, makeTrust(1.4), failureSignal);
    expect(result.adjustedSize).toBe(0);
    expect(result.isSuppressed).toBe(true);
  });

  it("reason array includes trust reasons", () => {
    const trust = { score: 0.9, reason: ["trust_detail_reason"] };
    const result = applyAdaptiveDecision(50, trust);
    expect(result.reason).toContain("trust_detail_reason");
  });

  it("TRUST_SUPPRESS_THRESHOLD is 0.70 and TRUST_BOOST_THRESHOLD is 1.20", () => {
    expect(TRUST_SUPPRESS_THRESHOLD).toBe(0.70);
    expect(TRUST_BOOST_THRESHOLD).toBe(1.20);
  });
});

// ─── 8. failure_memory — store construction ──────────────────────────────────

describe("buildFailureMemory", () => {
  it("returns empty store for empty input", () => {
    const store = buildFailureMemory([]);
    expect(store.entries).toHaveLength(0);
  });

  it("does not suppress when below min sample size", () => {
    // Only 5 records (< DEFAULT_FAILURE_MIN_SAMPLE_SIZE=10), all losses
    const records = makeRecords(5, 0.0, { eventFamily: "cpi", direction: "long" });
    const store = buildFailureMemory(records);
    const key = buildSignalMemoryKey("cpi", "long", "strong", "strong");
    const entry = lookupFailureSignal(store, key);
    expect(entry).toBeDefined();
    expect(entry!.isSuppressed).toBe(false);
    expect(entry!.reason).toMatch(/minSample/);
  });

  it("suppresses when failureRate > DEFAULT_FAILURE_RATE_THRESHOLD", () => {
    // 10 records, 8 losses → failureRate = 0.80 > 0.70
    const records = makeRecords(10, 0.2, { eventFamily: "cpi", direction: "long" });
    const store = buildFailureMemory(records);
    const key = buildSignalMemoryKey("cpi", "long", "strong", "strong");
    const entry = lookupFailureSignal(store, key)!;
    expect(entry.isSuppressed).toBe(true);
    expect(entry.reason).toMatch(/suppressed/);
    expect(entry.failureRate).toBeCloseTo(0.8, 2);
  });

  it("does not suppress when failureRate is below threshold", () => {
    // 10 records, 4 losses → failureRate = 0.40 < 0.70
    const records = makeRecords(10, 0.6, { eventFamily: "fomc", direction: "short" });
    const store = buildFailureMemory(records);
    const key = buildSignalMemoryKey("fomc", "short", "strong", "strong");
    const entry = lookupFailureSignal(store, key)!;
    expect(entry.isSuppressed).toBe(false);
  });

  it("suppresses when consecutiveLosses ≥ DEFAULT_CONSECUTIVE_LOSS_THRESHOLD", () => {
    // 10 records: 5 wins first, then 5 consecutive losses
    // Use properly padded months to ensure lexicographic sort == chronological sort
    const pad = (n: number) => String(n).padStart(2, "0");
    const records = [
      ...makeRecords(5, 1.0, { eventFamily: "nfp", direction: "long" }).map((r, i) => ({
        ...r, timestamp: `2024-${pad(i + 1)}-01T00:00:00Z`,
      })),
      ...makeRecords(5, 0.0, { eventFamily: "nfp", direction: "long" }).map((r, i) => ({
        ...r, timestamp: `2024-${pad(i + 6)}-01T00:00:00Z`,
      })),
    ];
    const store = buildFailureMemory(records);
    const key = buildSignalMemoryKey("nfp", "long", "strong", "strong");
    const entry = lookupFailureSignal(store, key)!;
    expect(entry.consecutiveLosses).toBe(5);
    expect(entry.isSuppressed).toBe(true);
    expect(entry.reason).toMatch(/consecutiveLosses/);
  });

  it("does not suppress for fewer than DEFAULT_CONSECUTIVE_LOSS_THRESHOLD trailing losses", () => {
    // 10 records: 7 wins, then 3 consecutive losses (below threshold of 5)
    const pad = (n: number) => String(n).padStart(2, "0");
    const records = [
      ...makeRecords(7, 1.0, { eventFamily: "nfp", direction: "long" }).map((r, i) => ({
        ...r, timestamp: `2024-${pad(i + 1)}-01T00:00:00Z`,
      })),
      ...makeRecords(3, 0.0, { eventFamily: "nfp", direction: "long" }).map((r, i) => ({
        ...r, timestamp: `2024-${pad(i + 8)}-01T00:00:00Z`,
      })),
    ];
    const store = buildFailureMemory(records);
    const key = buildSignalMemoryKey("nfp", "long", "strong", "strong");
    const entry = lookupFailureSignal(store, key)!;
    expect(entry.consecutiveLosses).toBe(3);
    expect(entry.isSuppressed).toBe(false);
  });

  it("DEFAULT_FAILURE_RATE_THRESHOLD=0.70, DEFAULT_CONSECUTIVE_LOSS_THRESHOLD=5, DEFAULT_FAILURE_MIN_SAMPLE_SIZE=10", () => {
    expect(DEFAULT_FAILURE_RATE_THRESHOLD).toBe(0.70);
    expect(DEFAULT_CONSECUTIVE_LOSS_THRESHOLD).toBe(5);
    expect(DEFAULT_FAILURE_MIN_SAMPLE_SIZE).toBe(10);
  });
});

describe("lookupFailureSignal", () => {
  it("returns undefined for a missing key", () => {
    const store = buildFailureMemory([]);
    expect(lookupFailureSignal(store, "missing")).toBeUndefined();
  });

  it("finds an existing entry", () => {
    const records = makeRecords(10, 0.1, { eventFamily: "cpi", direction: "long" });
    const store = buildFailureMemory(records);
    const key = buildSignalMemoryKey("cpi", "long", "strong", "strong");
    expect(lookupFailureSignal(store, key)).toBeDefined();
  });
});

// ─── 9. Integration: records → memory → trust → adaptive decision ─────────────

describe("adaptive intelligence pipeline integration", () => {
  it("strong-performing signal type produces trust > 1.0 and larger size", () => {
    // 30 records with strong win rate and positive sharpeLike
    const records = Array.from({ length: 30 }, (_, i) => makeRecord({
      eventFamily: "cpi",
      direction: "long",
      confidence: 0.7,
      reliability: 0.6,
      pnl: 10,
      returnPct: 0.1,
      isWin: true,
      timestamp: `2024-0${(i % 9) + 1}-01T00:00:00Z`,
    }));

    const store = buildSignalMemoryFromRecords(records);
    const key   = buildSignalMemoryKey("cpi", "long", "strong", "strong");
    const mem   = lookupSignalMemory(store, key)!;

    expect(mem.tradeCount).toBe(30);
    expect(mem.winRate).toBe(1.0);

    const trust = computeSignalTrust(mem);
    expect(trust.score).toBeGreaterThan(1.0);

    const baseSize = 100;
    const result = applyAdaptiveDecision(baseSize, trust);
    expect(result.adjustedSize).toBeGreaterThan(baseSize);
    expect(result.isSuppressed).toBe(false);
  });

  it("consistently-losing signal type produces trust < 1.0 and smaller size", () => {
    // 30 records with poor win rate
    const records = Array.from({ length: 30 }, (_, i) => makeRecord({
      eventFamily: "fomc",
      direction: "short",
      confidence: 0.7,
      reliability: 0.6,
      pnl: -10,
      returnPct: -0.1,
      isWin: false,
      timestamp: `2024-0${(i % 9) + 1}-01T00:00:00Z`,
    }));

    const store = buildSignalMemoryFromRecords(records);
    const key   = buildSignalMemoryKey("fomc", "short", "strong", "strong");
    const mem   = lookupSignalMemory(store, key)!;

    expect(mem.winRate).toBe(0);

    const trust = computeSignalTrust(mem);
    expect(trust.score).toBeLessThan(1.0);

    const baseSize = 100;
    const result = applyAdaptiveDecision(baseSize, trust);
    expect(result.adjustedSize).toBeLessThan(baseSize);
  });

  it("failure memory suppression hard-blocks a known-bad signal", () => {
    // 10 records: all losses → failureRate=1.0 > 0.70
    const records = makeRecords(10, 0.0, { eventFamily: "nfp", direction: "long" });
    const fStore  = buildFailureMemory(records);
    const key     = buildSignalMemoryKey("nfp", "long", "strong", "strong");
    const failure = lookupFailureSignal(fStore, key)!;

    expect(failure.isSuppressed).toBe(true);

    // Adaptive decision: even with neutral trust, suppressed → size=0
    const result = applyAdaptiveDecision(100, NEUTRAL_TRUST, failure);
    expect(result.adjustedSize).toBe(0);
    expect(result.isSuppressed).toBe(true);
  });
});

// ─── 10. Execution integration: trust_score threads through ──────────────────

describe("sizePosition — Phase 7C trust_score parameter", () => {
  it("trust_score=1.0 (default) produces identical result to Phase 7B call", () => {
    const sizeDefault = sizePosition(0.8, 0.9, "normal", undefined, 1.0);
    const sizeExplicit = sizePosition(0.8, 0.9, "normal", undefined, 1.0, 1.0);
    expect(sizeDefault).toBe(sizeExplicit);
  });

  it("trust_score scales size multiplicatively after calibration", () => {
    const base  = sizePosition(0.8, 0.9, "normal", undefined, 1.0, 1.0);
    const boosted = sizePosition(0.8, 0.9, "normal", undefined, 1.0, 1.25);
    expect(boosted).toBeCloseTo(base * 1.25, 3);
  });

  it("trust_score=0.5 halves the size", () => {
    const base  = sizePosition(0.8, 0.9, "normal", undefined, 1.0, 1.0);
    const halved = sizePosition(0.8, 0.9, "normal", undefined, 1.0, 0.5);
    expect(halved).toBeCloseTo(base * 0.5, 3);
  });
});

describe("generateTradeSignals — trust_score parameter", () => {
  const predictions = [{
    confidence: 0.8,
    horizon: "medium",
    assets: [{ ticker: "SPY", expected_direction: "up" as const, expected_magnitude_bp: 50, conviction: 0.9 }],
  }];
  const constraints = createRiskConstraints();

  it("trust_score=1.0 (default) matches omitted value", () => {
    const sigDefault  = generateTradeSignals(predictions, constraints);
    const sigExplicit = generateTradeSignals(predictions, constraints, "normal", [], 1.0, 1.0);
    expect(sigDefault[0]!.target_size).toBeCloseTo(sigExplicit[0]!.target_size, 4);
  });

  it("trust_score < 1.0 reduces signal size", () => {
    const sigNeutral = generateTradeSignals(predictions, constraints, "normal", [], 1.0, 1.0);
    const sigWeak    = generateTradeSignals(predictions, constraints, "normal", [], 1.0, 0.7);
    expect(sigWeak[0]!.target_size).toBeLessThan(sigNeutral[0]!.target_size);
  });

  it("trust_score > 1.0 increases signal size", () => {
    const sigNeutral = generateTradeSignals(predictions, constraints, "normal", [], 1.0, 1.0);
    const sigStrong  = generateTradeSignals(predictions, constraints, "normal", [], 1.0, 1.3);
    expect(sigStrong[0]!.target_size).toBeGreaterThan(sigNeutral[0]!.target_size);
  });
});

describe("runPortfolioSimulation — trust_score integration", () => {
  const basePrediction = {
    predictions: [{
      confidence: 0.8,
      horizon: "medium",
      assets: [{ ticker: "SPY", expected_direction: "up" as const, expected_magnitude_bp: 50, conviction: 0.9 }],
    }],
  };

  const baseInput = (): PortfolioSimulationInput => ({
    prediction_result: basePrediction,
    event_family: "cpi",
    portfolio: createPortfolio(),
    constraints: createRiskConstraints(),
    simulated_at: "2024-06-01T10:00:00Z",
  });

  it("omitting trust_score is identical to trust_score=1.0", () => {
    const resultDefault  = runPortfolioSimulation(baseInput());
    const resultExplicit = runPortfolioSimulation({ ...baseInput(), trust_score: 1.0 });
    expect(resultDefault.trades_executed[0]!.executed_size).toBe(
      resultExplicit.trades_executed[0]!.executed_size,
    );
  });

  it("trust_score=0.5 produces smaller executed_size", () => {
    const neutral = runPortfolioSimulation({ ...baseInput(), trust_score: 1.0 });
    const half    = runPortfolioSimulation({ ...baseInput(), trust_score: 0.5 });
    expect(half.trades_executed[0]!.executed_size).toBeLessThan(
      neutral.trades_executed[0]!.executed_size,
    );
  });

  it("trust_score=1.3 produces larger executed_size", () => {
    const neutral = runPortfolioSimulation({ ...baseInput(), trust_score: 1.0 });
    const boosted = runPortfolioSimulation({ ...baseInput(), trust_score: 1.3 });
    expect(boosted.trades_executed[0]!.executed_size).toBeGreaterThan(
      neutral.trades_executed[0]!.executed_size,
    );
  });
});

// ─── 11. Regression: trust_score=1.0 leaves Phase 7A/7B results identical ────

describe("regression: Phase 7A/7B behaviour when trust_score=1.0", () => {
  it("sizePosition with default params matches Phase 7B signature", () => {
    // Phase 7B call (5 params)
    const phase7b = sizePosition(0.75, 0.85, "normal", undefined, 1.1);
    // Phase 7C call with trust=1.0 (6 params)
    const phase7c = sizePosition(0.75, 0.85, "normal", undefined, 1.1, 1.0);
    expect(phase7c).toBe(phase7b);
  });

  it("sizePosition with maxPositionNotional cap behaves identically", () => {
    const phase7b = sizePosition(0.9, 0.9, "elevated", 5000, 1.2);
    const phase7c = sizePosition(0.9, 0.9, "elevated", 5000, 1.2, 1.0);
    expect(phase7c).toBe(phase7b);
  });

  it("portfolio simulation produces identical output when trust_score absent vs 1.0", () => {
    const input: PortfolioSimulationInput = {
      prediction_result: {
        predictions: [{
          confidence: 0.7,
          horizon: "short",
          assets: [
            { ticker: "TLT", expected_direction: "up" as const, expected_magnitude_bp: 30, conviction: 0.8 },
            { ticker: "GLD", expected_direction: "down" as const, expected_magnitude_bp: 20, conviction: 0.6 },
          ],
        }],
      },
      event_family: "fomc",
      portfolio: createPortfolio(),
      constraints: createRiskConstraints(),
      simulated_at: "2024-07-15T14:00:00Z",
      calibration_multiplier: 1.1,
    };

    const withoutTrust = runPortfolioSimulation(input);
    const withTrust    = runPortfolioSimulation({ ...input, trust_score: 1.0 });

    // Identical number of trades
    expect(withTrust.trades_executed.length).toBe(withoutTrust.trades_executed.length);

    // Identical executed sizes
    for (let i = 0; i < withoutTrust.trades_executed.length; i++) {
      expect(withTrust.trades_executed[i]!.executed_size).toBe(
        withoutTrust.trades_executed[i]!.executed_size,
      );
    }

    // Identical P&L
    expect(withTrust.pnl_metrics.per_event).toBe(withoutTrust.pnl_metrics.per_event);
  });
});
