/**
 * Phase 7C.2 — Replay validation tests.
 *
 * Verifies that:
 *  1. Each replay mode is isolated (pure, no side-effects).
 *  2. The sharpeLike hierarchy holds on strongTrendScenario.
 *  3. Trade count decreases as filters tighten.
 *  4. The comparator correctly classifies deltas as improved/degraded/neutral.
 *  5. All new code has zero cross-mode state leakage.
 */

import { describe, it, expect } from "vitest";
import { runReplay, ReplayMode, type ReplayResult } from "./replay_engine.js";
import { compareReplays } from "./replay_comparator.js";
import {
  strongTrendScenario,
  noisyScenario,
  neutralScenario,
} from "./replay_fixtures.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deepEqual(a: ReplayResult, b: ReplayResult): boolean {
  return (
    a.mode        === b.mode        &&
    a.pnl         === b.pnl         &&
    a.winRate     === b.winRate     &&
    a.sharpeLike  === b.sharpeLike  &&
    a.maxDrawdown === b.maxDrawdown &&
    a.tradeCount  === b.tradeCount
  );
}

// ─── Mode isolation ───────────────────────────────────────────────────────────

describe("mode isolation", () => {
  it("BASELINE_7A result is identical before and after running ADAPTIVE_7C", () => {
    const before = runReplay([...strongTrendScenario], ReplayMode.BASELINE_7A);
    runReplay([...strongTrendScenario], ReplayMode.ADAPTIVE_7C);
    const after  = runReplay([...strongTrendScenario], ReplayMode.BASELINE_7A);
    expect(deepEqual(before, after)).toBe(true);
  });

  it("runReplay is deterministic — same input returns deeply equal output", () => {
    const r1 = runReplay([...strongTrendScenario], ReplayMode.CALIBRATION_7B);
    const r2 = runReplay([...strongTrendScenario], ReplayMode.CALIBRATION_7B);
    expect(deepEqual(r1, r2)).toBe(true);
  });

  it("each mode returns the correct .mode field", () => {
    expect(runReplay([...strongTrendScenario], ReplayMode.BASELINE_7A).mode)
      .toBe(ReplayMode.BASELINE_7A);
    expect(runReplay([...strongTrendScenario], ReplayMode.CALIBRATION_7B).mode)
      .toBe(ReplayMode.CALIBRATION_7B);
    expect(runReplay([...strongTrendScenario], ReplayMode.ADAPTIVE_7C).mode)
      .toBe(ReplayMode.ADAPTIVE_7C);
  });

  it("running on an empty dataset returns zero metrics for all modes", () => {
    for (const mode of [ReplayMode.BASELINE_7A, ReplayMode.CALIBRATION_7B, ReplayMode.ADAPTIVE_7C]) {
      const r = runReplay([], mode);
      expect(r.tradeCount).toBe(0);
      expect(r.pnl).toBe(0);
      expect(r.winRate).toBe(0);
      expect(r.sharpeLike).toBe(0);
    }
  });
});

// ─── sharpeLike hierarchy on strongTrendScenario ─────────────────────────────

describe("sharpeLike hierarchy on strongTrendScenario", () => {
  const baseline    = runReplay([...strongTrendScenario], ReplayMode.BASELINE_7A);
  const calibration = runReplay([...strongTrendScenario], ReplayMode.CALIBRATION_7B);
  const adaptive    = runReplay([...strongTrendScenario], ReplayMode.ADAPTIVE_7C);

  it("ADAPTIVE_7C sharpeLike ≥ CALIBRATION_7B sharpeLike", () => {
    expect(adaptive.sharpeLike).toBeGreaterThanOrEqual(calibration.sharpeLike);
  });

  it("CALIBRATION_7B sharpeLike ≥ BASELINE_7A sharpeLike", () => {
    expect(calibration.sharpeLike).toBeGreaterThanOrEqual(baseline.sharpeLike);
  });

  it("tradeCount: baseline > calibration > adaptive", () => {
    expect(baseline.tradeCount).toBeGreaterThan(calibration.tradeCount);
    expect(calibration.tradeCount).toBeGreaterThan(adaptive.tradeCount);
  });

  it("BASELINE_7A includes all 50 trades", () => {
    expect(baseline.tradeCount).toBe(50);
  });

  it("CALIBRATION_7B includes high-confidence trades only (Group A + B = 30)", () => {
    expect(calibration.tradeCount).toBe(30);
  });

  it("ADAPTIVE_7C includes high-confidence AND high-reliability trades only (Group A = 20)", () => {
    expect(adaptive.tradeCount).toBe(20);
  });

  it("BASELINE_7A win rate is < CALIBRATION_7B win rate (noisy trades removed)", () => {
    // Baseline includes 20 losing Group-C trades → lower win rate
    expect(baseline.winRate).toBeLessThan(calibration.winRate);
  });
});

// ─── Mode filtering correctness ───────────────────────────────────────────────

describe("mode filtering", () => {
  it("noisy scenario: BASELINE_7A includes all 30 trades", () => {
    const r = runReplay([...noisyScenario], ReplayMode.BASELINE_7A);
    expect(r.tradeCount).toBe(30);
  });

  it("noisy scenario: CALIBRATION_7B keeps only the 15 high-confidence wins", () => {
    const r = runReplay([...noisyScenario], ReplayMode.CALIBRATION_7B);
    expect(r.tradeCount).toBe(15);
    expect(r.winRate).toBe(1); // all 15 are wins
  });

  it("noisy scenario: ADAPTIVE_7C returns 0 trades (no high/high records)", () => {
    // noisy scenario has reliabilityBucket="medium" throughout
    const r = runReplay([...noisyScenario], ReplayMode.ADAPTIVE_7C);
    expect(r.tradeCount).toBe(0);
  });

  it("neutral scenario: CALIBRATION_7B and ADAPTIVE_7C return 0 trades (all medium)", () => {
    expect(runReplay([...neutralScenario], ReplayMode.CALIBRATION_7B).tradeCount).toBe(0);
    expect(runReplay([...neutralScenario], ReplayMode.ADAPTIVE_7C).tradeCount).toBe(0);
  });
});

// ─── Comparator ───────────────────────────────────────────────────────────────

describe("comparator", () => {
  it("differences under 2 % return verdict 'neutral' for all metrics", () => {
    const r1: ReplayResult = {
      mode: ReplayMode.BASELINE_7A,
      pnl: 100, winRate: 0.60, sharpeLike: 1.0, maxDrawdown: 10, tradeCount: 20,
    };
    const r2: ReplayResult = {
      mode: ReplayMode.CALIBRATION_7B,
      pnl: 101, winRate: 0.605, sharpeLike: 1.01, maxDrawdown: 9.9, tradeCount: 20,
    };
    const report = compareReplays(r1, r2);
    for (const d of report.deltas) {
      expect(d.verdict).toBe("neutral");
    }
  });

  it("clearly better comparison returns 'improved' for all metrics", () => {
    const r1: ReplayResult = {
      mode: ReplayMode.BASELINE_7A,
      pnl: 100, winRate: 0.50, sharpeLike: 1.0, maxDrawdown: 20, tradeCount: 20,
    };
    const r2: ReplayResult = {
      mode: ReplayMode.CALIBRATION_7B,
      pnl: 200, winRate: 0.80, sharpeLike: 5.0, maxDrawdown: 5, tradeCount: 20,
    };
    const report = compareReplays(r1, r2);

    const byMetric = Object.fromEntries(report.deltas.map((d) => [d.metric, d]));

    // Higher is better
    expect(byMetric["pnl"]!.verdict).toBe("improved");
    expect(byMetric["winRate"]!.verdict).toBe("improved");
    expect(byMetric["sharpeLike"]!.verdict).toBe("improved");
    // Lower is better for drawdown
    expect(byMetric["maxDrawdown"]!.verdict).toBe("improved");
    // tradeCount unchanged → neutral (0 % change)
    expect(byMetric["tradeCount"]!.verdict).toBe("neutral");
  });

  it("report.from and report.to reflect the input modes", () => {
    const r1: ReplayResult = {
      mode: ReplayMode.BASELINE_7A,
      pnl: 100, winRate: 0.5, sharpeLike: 1, maxDrawdown: 10, tradeCount: 10,
    };
    const r2: ReplayResult = {
      mode: ReplayMode.ADAPTIVE_7C,
      pnl: 200, winRate: 0.8, sharpeLike: 2, maxDrawdown: 5, tradeCount: 10,
    };
    const report = compareReplays(r1, r2);
    expect(report.from).toBe(ReplayMode.BASELINE_7A);
    expect(report.to).toBe(ReplayMode.ADAPTIVE_7C);
  });

  it("compares exactly 5 metrics", () => {
    const r: ReplayResult = {
      mode: ReplayMode.BASELINE_7A,
      pnl: 50, winRate: 0.6, sharpeLike: 1.2, maxDrawdown: 5, tradeCount: 10,
    };
    const report = compareReplays(r, r);
    expect(report.deltas).toHaveLength(5);
    const names = report.deltas.map((d) => d.metric);
    expect(names).toContain("pnl");
    expect(names).toContain("winRate");
    expect(names).toContain("sharpeLike");
    expect(names).toContain("maxDrawdown");
    expect(names).toContain("tradeCount");
  });

  it("identical inputs produce all-neutral verdicts with delta=0", () => {
    const r: ReplayResult = {
      mode: ReplayMode.CALIBRATION_7B,
      pnl: 150, winRate: 0.7, sharpeLike: 2.0, maxDrawdown: 8, tradeCount: 15,
    };
    const report = compareReplays(r, r);
    for (const d of report.deltas) {
      expect(d.delta).toBe(0);
      expect(d.verdict).toBe("neutral");
    }
  });

  it("pctChange is 0 when baseline metric is 0", () => {
    const r1: ReplayResult = {
      mode: ReplayMode.BASELINE_7A,
      pnl: 0, winRate: 0, sharpeLike: 0, maxDrawdown: 0, tradeCount: 0,
    };
    const r2: ReplayResult = {
      mode: ReplayMode.CALIBRATION_7B,
      pnl: 100, winRate: 0.5, sharpeLike: 1.0, maxDrawdown: 10, tradeCount: 5,
    };
    const report = compareReplays(r1, r2);
    for (const d of report.deltas) {
      expect(d.pctChange).toBe(0);
      expect(d.verdict).toBe("neutral");
    }
  });

  it("degradation: worse comparison correctly marked 'degraded'", () => {
    const r1: ReplayResult = {
      mode: ReplayMode.BASELINE_7A,
      pnl: 200, winRate: 0.80, sharpeLike: 5.0, maxDrawdown: 5, tradeCount: 20,
    };
    const r2: ReplayResult = {
      mode: ReplayMode.CALIBRATION_7B,
      pnl: 100, winRate: 0.50, sharpeLike: 1.0, maxDrawdown: 20, tradeCount: 20,
    };
    const report = compareReplays(r1, r2);
    const byMetric = Object.fromEntries(report.deltas.map((d) => [d.metric, d]));

    expect(byMetric["pnl"]!.verdict).toBe("degraded");
    expect(byMetric["winRate"]!.verdict).toBe("degraded");
    expect(byMetric["sharpeLike"]!.verdict).toBe("degraded");
    expect(byMetric["maxDrawdown"]!.verdict).toBe("degraded");
  });
});

// ─── End-to-end: three-mode comparison on strongTrendScenario ────────────────

describe("end-to-end: three-mode comparison on strongTrendScenario", () => {
  const baseline    = runReplay([...strongTrendScenario], ReplayMode.BASELINE_7A);
  const calibration = runReplay([...strongTrendScenario], ReplayMode.CALIBRATION_7B);
  const adaptive    = runReplay([...strongTrendScenario], ReplayMode.ADAPTIVE_7C);

  it("7B vs 7A: sharpeLike is 'improved'", () => {
    const report = compareReplays(baseline, calibration);
    const sharpe = report.deltas.find((d) => d.metric === "sharpeLike")!;
    expect(sharpe.verdict).toBe("improved");
  });

  it("7C vs 7A: sharpeLike is 'improved'", () => {
    const report = compareReplays(baseline, adaptive);
    const sharpe = report.deltas.find((d) => d.metric === "sharpeLike")!;
    expect(sharpe.verdict).toBe("improved");
  });

  it("7C vs 7B: sharpeLike is 'improved'", () => {
    const report = compareReplays(calibration, adaptive);
    const sharpe = report.deltas.find((d) => d.metric === "sharpeLike")!;
    expect(sharpe.verdict).toBe("improved");
  });
});
