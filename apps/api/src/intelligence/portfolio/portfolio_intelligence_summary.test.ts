/**
 * Phase 7C.3 — portfolio intelligence summary tests.
 *
 * Validates structure, verdicts, narrative format, determinism, and
 * edge-case behaviour (empty input, zero-filtered scenarios).
 */

import { describe, it, expect } from "vitest";
import {
  buildPortfolioIntelligenceSummary,
  type PortfolioIntelligenceSummary,
} from "./portfolio_intelligence_summary.js";
import {
  strongTrendScenario,
  noisyScenario,
  neutralScenario,
} from "./replay_fixtures.js";
import { ReplayMode } from "./replay_engine.js";

// ─── Structure ────────────────────────────────────────────────────────────────

describe("structure", () => {
  const result = buildPortfolioIntelligenceSummary([...strongTrendScenario]);

  it("result has all required keys", () => {
    const keys: (keyof PortfolioIntelligenceSummary)[] = [
      "baseline",
      "calibration",
      "adaptive",
      "calibrationVsBaseline",
      "adaptiveVsCalibration",
      "adaptiveVsBaseline",
      "overallVerdict",
      "narrativeLines",
    ];
    for (const key of keys) {
      expect(result).toHaveProperty(key);
    }
  });

  it("narrativeLines has exactly 4 entries", () => {
    expect(result.narrativeLines).toHaveLength(4);
  });

  it("baseline.mode === BASELINE_7A", () => {
    expect(result.baseline.mode).toBe(ReplayMode.BASELINE_7A);
  });

  it("calibration.mode === CALIBRATION_7B", () => {
    expect(result.calibration.mode).toBe(ReplayMode.CALIBRATION_7B);
  });

  it("adaptive.mode === ADAPTIVE_7C", () => {
    expect(result.adaptive.mode).toBe(ReplayMode.ADAPTIVE_7C);
  });

  it("calibrationVsBaseline.from === BASELINE_7A", () => {
    expect(result.calibrationVsBaseline.from).toBe(ReplayMode.BASELINE_7A);
  });

  it("calibrationVsBaseline.to === CALIBRATION_7B", () => {
    expect(result.calibrationVsBaseline.to).toBe(ReplayMode.CALIBRATION_7B);
  });

  it("adaptiveVsCalibration.from === CALIBRATION_7B", () => {
    expect(result.adaptiveVsCalibration.from).toBe(ReplayMode.CALIBRATION_7B);
  });

  it("adaptiveVsCalibration.to === ADAPTIVE_7C", () => {
    expect(result.adaptiveVsCalibration.to).toBe(ReplayMode.ADAPTIVE_7C);
  });

  it("adaptiveVsBaseline.from === BASELINE_7A", () => {
    expect(result.adaptiveVsBaseline.from).toBe(ReplayMode.BASELINE_7A);
  });

  it("adaptiveVsBaseline.to === ADAPTIVE_7C", () => {
    expect(result.adaptiveVsBaseline.to).toBe(ReplayMode.ADAPTIVE_7C);
  });
});

// ─── strongTrendScenario verdicts ─────────────────────────────────────────────

describe("strongTrendScenario verdicts", () => {
  const result = buildPortfolioIntelligenceSummary([...strongTrendScenario]);

  it("overallVerdict === 'improving'", () => {
    expect(result.overallVerdict).toBe("improving");
  });

  it("baseline.tradeCount === 50", () => {
    expect(result.baseline.tradeCount).toBe(50);
  });

  it("calibration.tradeCount === 30", () => {
    expect(result.calibration.tradeCount).toBe(30);
  });

  it("adaptive.tradeCount === 20", () => {
    expect(result.adaptive.tradeCount).toBe(20);
  });

  it("narrativeLines[0] contains '7A baseline'", () => {
    expect(result.narrativeLines[0]).toContain("7A baseline");
  });

  it("narrativeLines[0] contains tradeCount and sharpeLike", () => {
    expect(result.narrativeLines[0]).toContain("tradeCount=50");
    expect(result.narrativeLines[0]).toContain("sharpeLike=");
  });

  it("narrativeLines[3] contains 'improving'", () => {
    expect(result.narrativeLines[3]).toContain("improving");
  });

  it("narrativeLines[3] contains 'Overall 7A→7C'", () => {
    expect(result.narrativeLines[3]).toContain("Overall 7A→7C");
  });

  it("narrativeLines[1] contains '7B calibration vs 7A'", () => {
    expect(result.narrativeLines[1]).toContain("7B calibration vs 7A");
  });

  it("narrativeLines[2] contains '7C adaptive vs 7B'", () => {
    expect(result.narrativeLines[2]).toContain("7C adaptive vs 7B");
  });
});

// ─── neutralScenario verdicts ─────────────────────────────────────────────────

describe("neutralScenario verdicts", () => {
  const result = buildPortfolioIntelligenceSummary([...neutralScenario]);

  it("adaptive.tradeCount === 0 (all records are confidenceBucket='medium')", () => {
    expect(result.adaptive.tradeCount).toBe(0);
  });

  it("overallVerdict is 'mixed' or 'degrading' (ADAPTIVE_7C sharpeLike = 0)", () => {
    expect(["mixed", "degrading"]).toContain(result.overallVerdict);
  });

  it("narrativeLines[3] reflects the actual verdict", () => {
    expect(result.narrativeLines[3]).toContain(result.overallVerdict);
  });
});

// ─── noisyScenario: basic sanity ─────────────────────────────────────────────

describe("noisyScenario sanity", () => {
  const result = buildPortfolioIntelligenceSummary([...noisyScenario]);

  it("baseline.tradeCount === 30", () => {
    expect(result.baseline.tradeCount).toBe(30);
  });

  it("overallVerdict is a valid value", () => {
    expect(["improving", "mixed", "degrading"]).toContain(result.overallVerdict);
  });
});

// ─── Determinism and purity ───────────────────────────────────────────────────

describe("determinism and purity", () => {
  it("calling twice on the same input returns identical overallVerdict and tradeCount values", () => {
    const r1 = buildPortfolioIntelligenceSummary([...strongTrendScenario]);
    const r2 = buildPortfolioIntelligenceSummary([...strongTrendScenario]);

    expect(r1.overallVerdict).toBe(r2.overallVerdict);
    expect(r1.baseline.tradeCount).toBe(r2.baseline.tradeCount);
    expect(r1.calibration.tradeCount).toBe(r2.calibration.tradeCount);
    expect(r1.adaptive.tradeCount).toBe(r2.adaptive.tradeCount);
  });

  it("running strongTrendScenario does not mutate or affect a subsequent neutralScenario run", () => {
    buildPortfolioIntelligenceSummary([...strongTrendScenario]);
    const r = buildPortfolioIntelligenceSummary([...neutralScenario]);
    expect(r.baseline.tradeCount).toBe(20);
    expect(r.adaptive.tradeCount).toBe(0);
  });

  it("empty trades array returns overallVerdict 'mixed' (all sharpeLike=0 → delta=0 → neutral)", () => {
    const r = buildPortfolioIntelligenceSummary([]);
    expect(r.overallVerdict).toBe("mixed");
    expect(r.baseline.tradeCount).toBe(0);
    expect(r.calibration.tradeCount).toBe(0);
    expect(r.adaptive.tradeCount).toBe(0);
  });
});

// ─── Each comparison report has 5 deltas ─────────────────────────────────────

describe("each comparison report has 5 deltas", () => {
  const result = buildPortfolioIntelligenceSummary([...strongTrendScenario]);

  it("calibrationVsBaseline.deltas has length 5", () => {
    expect(result.calibrationVsBaseline.deltas).toHaveLength(5);
  });

  it("adaptiveVsCalibration.deltas has length 5", () => {
    expect(result.adaptiveVsCalibration.deltas).toHaveLength(5);
  });

  it("adaptiveVsBaseline.deltas has length 5", () => {
    expect(result.adaptiveVsBaseline.deltas).toHaveLength(5);
  });

  it("all three reports contain the sharpeLike metric", () => {
    for (const report of [
      result.calibrationVsBaseline,
      result.adaptiveVsCalibration,
      result.adaptiveVsBaseline,
    ]) {
      expect(report.deltas.some((d) => d.metric === "sharpeLike")).toBe(true);
    }
  });
});
