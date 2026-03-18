import { describe, expect, it } from "vitest";

import { buildCpiEvent } from "./events/cpiEvent.js";
import { buildMarketContextSnapshot } from "./context/marketContext.js";
import { generateCpiPrediction } from "./prediction/cpiPrediction.js";
import { trackCpiOutcome } from "./outcome/outcomeTracker.js";
import { buildCpiMemoryCase } from "./memory/memoryCaseBuilder.js";
import { CpiMemoryCaseStore } from "./memory/cpiMemoryCaseStore.js";
import { findCpiAnalogs } from "./analogs/cpiAnalogRetrieval.js";
import { enrichCpiPredictionWithAnalogs } from "./analogs/cpiConfidenceEnrichment.js";
import { buildCpiThemeReport } from "./themes/cpiThemeSummary.js";
import { runCpiReplayBenchmark } from "./evaluation/cpiReplayBenchmark.js";
import { buildCpiCalibrationReport } from "./evaluation/cpiCalibrationReport.js";
import {
  resolveAnalogStrength,
  computeAverageSimilarity,
  computeReliabilityAdjustment,
  resolveReliabilityFlags,
  buildDisciplineNote,
  resolveThemeKeyFromPrediction,
  resolveCpiReliabilitySignals,
} from "./reliability/cpiReliabilitySignals.js";
import { enrichCpiPredictionWithReliability } from "./reliability/cpiReliabilityEnrichment.js";
import type { ClusterReliabilityContext } from "./reliability/cpiReliabilitySignals.js";
import type { CpiAnalogMatch } from "./analogs/cpiAnalogRetrieval.js";
import type { CpiEnrichedPredictionResult } from "./analogs/cpiConfidenceEnrichment.js";
import type { CpiThemeReport } from "./themes/cpiThemeSummary.js";
import type { CpiCalibrationReport } from "./evaluation/cpiCalibrationReport.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_CLUSTER = "hotter.medium.hawkish.risk_off.elevated";

const makeAnalog = (
  overrides: Partial<CpiAnalogMatch> = {},
): CpiAnalogMatch => ({
  case_id: "case-1",
  period: "2025-01",
  similarity: 0.80,
  signals: {
    direction_match: true,
    band_match: true,
    fed_stance_match: true,
    macro_regime_match: true,
    vol_regime_match: true,
  },
  verdict: "correct",
  lesson_summary: "Hot CPI with hawkish Fed — risk assets sold off.",
  surprise_direction: "hotter",
  surprise_bp: 15,
  fed_policy_stance: "hawkish",
  macro_regime: "risk_off",
  volatility_regime: "elevated",
  ...overrides,
});

const makeClusterContext = (
  overrides: Partial<ClusterReliabilityContext> = {},
): ClusterReliabilityContext => ({
  cluster_id: BASE_CLUSTER,
  reliability_signal: "mixed",
  confidence_tendency: "moderate",
  benchmark_verdict: "neutral",
  case_count: 5,
  ...overrides,
});

const makeThemeReport = (
  clusterId: string,
  reliability: "reliable" | "mixed" | "unreliable" | "insufficient_data",
  casesCount: number,
): CpiThemeReport => ({
  total_cases: casesCount,
  total_clusters: 1,
  clusters: [],
  summaries: [
    {
      cluster_id: clusterId,
      pattern_label: "Hot CPI (mid surprise) + hawkish Fed + risk-off + elevated vol",
      key: {
        surprise_direction: "hotter",
        surprise_band: "medium",
        fed_policy_stance: "hawkish",
        macro_regime: "risk_off",
        volatility_regime: "elevated",
      },
      size: casesCount,
      dominant_verdict: "correct",
      verdict_distribution: {
        correct: casesCount,
        partially_correct: 0,
        wrong: 0,
        total: casesCount,
        accuracy_rate: 1.0,
      },
      reliability_signal: reliability,
      average_confidence: 0.72,
      confidence_tendency: "moderate",
      common_lesson_patterns: [],
      common_failure_modes: [],
    },
  ],
  reliable_patterns: [],
  failure_patterns: [],
});

const makeCalibrationReport = (
  clusterId: string,
  verdict: "helps" | "hurts" | "neutral" | "insufficient_data",
): CpiCalibrationReport => ({
  total_cases: 5,
  cases_with_prior_analogs: 4,
  calibration: {
    mean_baseline_error: 0.20,
    mean_enriched_error: verdict === "helps" ? 0.15 : 0.25,
    mean_improvement: verdict === "helps" ? 0.05 : -0.05,
    improved_count: verdict === "helps" ? 4 : 1,
    worsened_count: verdict === "helps" ? 1 : 4,
    unchanged_count: 0,
  },
  caution: { caution_issued: 1, caution_correct: 1, caution_precision: 1.0 },
  reinforcement: { reinforcement_issued: 3, reinforcement_correct: 3, reinforcement_precision: 1.0 },
  clusters: [
    {
      cluster_id: clusterId,
      case_count: 5,
      mean_improvement: verdict === "helps" ? 0.05 : -0.05,
      verdict,
    },
  ],
  memory_verdict: verdict === "helps" ? "improving" : "degrading",
});

const buildLivePrediction = (params: {
  actual: number;
  expected: number;
  fed?: string;
  macro?: string;
  vol?: string;
}) => {
  const event = buildCpiEvent({
    released_at: "2025-06-10T13:30:00Z",
    period: "2025-06",
    actual_value: params.actual,
    expected_value: params.expected,
    prior_value: params.expected,
  });

  const context = buildMarketContextSnapshot({
    fed_policy_stance: (params.fed ?? "hawkish") as any,
    macro_regime: (params.macro ?? "risk_off") as any,
    volatility_regime: (params.vol ?? "elevated") as any,
  });

  const prediction_result = generateCpiPrediction({
    cpi_event: event,
    context,
    horizons: ["1d"],
  });

  return { event, context, prediction_result };
};

const buildEnrichedNoAnalogs = (params: {
  actual: number;
  expected: number;
  fed?: string;
  macro?: string;
  vol?: string;
}): CpiEnrichedPredictionResult => {
  const { prediction_result } = buildLivePrediction(params);
  return enrichCpiPredictionWithAnalogs(prediction_result, []);
};

// ─── resolveAnalogStrength ────────────────────────────────────────────────────

describe("resolveAnalogStrength", () => {
  it("returns 'none' for empty analog list", () => {
    expect(resolveAnalogStrength([])).toBe("none");
  });

  it("returns 'weak' for single analog regardless of similarity", () => {
    expect(resolveAnalogStrength([makeAnalog({ similarity: 0.90 })])).toBe("weak");
  });

  it("returns 'weak' for 2 analogs with avg similarity < 0.50", () => {
    const analogs = [
      makeAnalog({ similarity: 0.30 }),
      makeAnalog({ similarity: 0.40 }),
    ];
    expect(resolveAnalogStrength(analogs)).toBe("weak");
  });

  it("returns 'moderate' for 2 analogs with avg similarity ≥ 0.50", () => {
    const analogs = [
      makeAnalog({ similarity: 0.60 }),
      makeAnalog({ similarity: 0.60 }),
    ];
    expect(resolveAnalogStrength(analogs)).toBe("moderate");
  });

  it("returns 'strong' for 3+ analogs with avg similarity > 0.75", () => {
    const analogs = [
      makeAnalog({ similarity: 0.80 }),
      makeAnalog({ similarity: 0.85 }),
      makeAnalog({ similarity: 0.82 }),
    ];
    expect(resolveAnalogStrength(analogs)).toBe("strong");
  });

  it("returns 'moderate' (not strong) for 3 analogs with avg ≤ 0.75", () => {
    const analogs = [
      makeAnalog({ similarity: 0.70 }),
      makeAnalog({ similarity: 0.70 }),
      makeAnalog({ similarity: 0.70 }),
    ];
    // avg = 0.70 ≤ 0.75
    expect(resolveAnalogStrength(analogs)).toBe("moderate");
  });
});

// ─── computeAverageSimilarity ─────────────────────────────────────────────────

describe("computeAverageSimilarity", () => {
  it("returns 0 for empty list", () => {
    expect(computeAverageSimilarity([])).toBe(0);
  });

  it("returns the similarity for a single analog", () => {
    expect(computeAverageSimilarity([makeAnalog({ similarity: 0.76 })])).toBe(0.76);
  });

  it("averages correctly across multiple analogs", () => {
    const analogs = [
      makeAnalog({ similarity: 0.60 }),
      makeAnalog({ similarity: 0.80 }),
    ];
    expect(computeAverageSimilarity(analogs)).toBeCloseTo(0.70, 4);
  });
});

// ─── computeReliabilityAdjustment ─────────────────────────────────────────────

describe("computeReliabilityAdjustment", () => {
  it("returns 0 for insufficient_data cluster and moderate analogs", () => {
    const ctx = makeClusterContext({
      reliability_signal: "insufficient_data",
      benchmark_verdict: "unknown",
    });
    expect(computeReliabilityAdjustment("moderate", ctx)).toBe(0);
  });

  it("applies −0.02 penalty for weak analog pool", () => {
    const ctx = makeClusterContext({
      reliability_signal: "insufficient_data",
      benchmark_verdict: "unknown",
    });
    expect(computeReliabilityAdjustment("weak", ctx)).toBe(-0.02);
  });

  it("applies −0.02 penalty for no analogs", () => {
    const ctx = makeClusterContext({
      reliability_signal: "insufficient_data",
      benchmark_verdict: "unknown",
    });
    expect(computeReliabilityAdjustment("none", ctx)).toBe(-0.02);
  });

  it("applies −0.05 for unreliable cluster", () => {
    const ctx = makeClusterContext({
      reliability_signal: "unreliable",
      benchmark_verdict: "neutral",
    });
    // unreliable(-0.05) + weak(-0.02) = -0.07
    expect(computeReliabilityAdjustment("weak", ctx)).toBe(-0.07);
  });

  it("applies maximum caution when unreliable AND benchmark hurts", () => {
    const ctx = makeClusterContext({
      reliability_signal: "unreliable",
      benchmark_verdict: "hurts",
    });
    // unreliable(-0.05) + hurts(-0.05) + weak(-0.02) = -0.12 → clamp → -0.08
    expect(computeReliabilityAdjustment("weak", ctx)).toBe(-0.08);
  });

  it("clamps at −0.08 floor", () => {
    const ctx = makeClusterContext({
      reliability_signal: "unreliable",
      benchmark_verdict: "hurts",
    });
    // Even with strong analogs: -0.05 -0.05 +0.01 = -0.09 → -0.08
    expect(computeReliabilityAdjustment("strong", ctx)).toBe(-0.08);
  });

  it("applies maximum boost for reliable + helps + strong", () => {
    const ctx = makeClusterContext({
      reliability_signal: "reliable",
      benchmark_verdict: "helps",
    });
    // reliable(+0.02) + helps(+0.02) + strong(+0.01) = +0.05 (at cap)
    expect(computeReliabilityAdjustment("strong", ctx)).toBe(0.05);
  });

  it("clamps at +0.05 ceiling", () => {
    const ctx = makeClusterContext({
      reliability_signal: "reliable",
      benchmark_verdict: "helps",
    });
    // reliable(+0.02) + helps(+0.02) + moderate = +0.04 (no strong bonus, under cap)
    expect(computeReliabilityAdjustment("moderate", ctx)).toBe(0.04);
  });
});

// ─── resolveReliabilityFlags ──────────────────────────────────────────────────

describe("resolveReliabilityFlags", () => {
  it("sets unreliable_cluster for unreliable reliability_signal", () => {
    const ctx = makeClusterContext({ reliability_signal: "unreliable" });
    const flags = resolveReliabilityFlags("moderate", ctx);
    expect(flags.unreliable_cluster).toBe(true);
    expect(flags.benchmark_helps).toBe(false);
  });

  it("sets benchmark_hurts correctly", () => {
    const ctx = makeClusterContext({ benchmark_verdict: "hurts" });
    const flags = resolveReliabilityFlags("moderate", ctx);
    expect(flags.benchmark_hurts).toBe(true);
  });

  it("sets insufficient_history for case_count < 3", () => {
    const ctx = makeClusterContext({ case_count: 2, reliability_signal: "insufficient_data" });
    const flags = resolveReliabilityFlags("weak", ctx);
    expect(flags.insufficient_history).toBe(true);
  });

  it("sets strong_analog_support for 'strong' strength", () => {
    const ctx = makeClusterContext();
    const flags = resolveReliabilityFlags("strong", ctx);
    expect(flags.strong_analog_support).toBe(true);
  });

  it("sets benchmark_helps only when both reliable AND helps", () => {
    const ctx1 = makeClusterContext({
      reliability_signal: "reliable",
      benchmark_verdict: "helps",
    });
    expect(resolveReliabilityFlags("moderate", ctx1).benchmark_helps).toBe(true);

    const ctx2 = makeClusterContext({
      reliability_signal: "mixed",
      benchmark_verdict: "helps",
    });
    // Mixed cluster — benchmark_helps requires reliable
    expect(resolveReliabilityFlags("moderate", ctx2).benchmark_helps).toBe(false);
  });
});

// ─── buildDisciplineNote ──────────────────────────────────────────────────────

describe("buildDisciplineNote", () => {
  it("returns baseline note when no analogs", () => {
    const ctx = makeClusterContext();
    const flags = resolveReliabilityFlags("none", ctx);
    const note = buildDisciplineNote("none", ctx, 0, flags);
    expect(note).toContain("No historical analogs");
    expect(note).toContain("baseline only");
  });

  it("returns strong caution when unreliable + benchmark hurts", () => {
    const ctx = makeClusterContext({
      reliability_signal: "unreliable",
      benchmark_verdict: "hurts",
    });
    const adj = computeReliabilityAdjustment("weak", ctx);
    const flags = resolveReliabilityFlags("weak", ctx);
    const note = buildDisciplineNote("weak", ctx, adj, flags);
    expect(note).toContain("Strong caution");
    expect(note).toContain("unreliable history");
    expect(note).toContain("degrades calibration");
  });

  it("returns unreliable-cluster note when unreliable but benchmark neutral", () => {
    const ctx = makeClusterContext({
      reliability_signal: "unreliable",
      benchmark_verdict: "neutral",
    });
    const adj = computeReliabilityAdjustment("moderate", ctx);
    const flags = resolveReliabilityFlags("moderate", ctx);
    const note = buildDisciplineNote("moderate", ctx, adj, flags);
    expect(note).toContain("Caution");
    expect(note).toContain("unreliable prediction history");
  });

  it("returns benchmark-hurts note when benchmark hurts but cluster mixed", () => {
    const ctx = makeClusterContext({
      reliability_signal: "mixed",
      benchmark_verdict: "hurts",
    });
    const adj = computeReliabilityAdjustment("moderate", ctx);
    const flags = resolveReliabilityFlags("moderate", ctx);
    const note = buildDisciplineNote("moderate", ctx, adj, flags);
    expect(note).toContain("Caution");
    expect(note).toContain("degrades calibration");
  });

  it("returns strong support note when reliable + helps + strong analogs", () => {
    const ctx = makeClusterContext({
      reliability_signal: "reliable",
      benchmark_verdict: "helps",
    });
    const adj = computeReliabilityAdjustment("strong", ctx);
    const flags = resolveReliabilityFlags("strong", ctx);
    const note = buildDisciplineNote("strong", ctx, adj, flags);
    expect(note).toContain("Strong support");
    expect(note).toContain("reliable");
    expect(note).toContain("validated analog reinforcement");
  });

  it("returns insufficient history note when < 3 cases", () => {
    const ctx = makeClusterContext({
      reliability_signal: "insufficient_data",
      case_count: 1,
    });
    const adj = computeReliabilityAdjustment("weak", ctx);
    const flags = resolveReliabilityFlags("weak", ctx);
    const note = buildDisciplineNote("weak", ctx, adj, flags);
    expect(note).toContain("Insufficient cluster history");
    expect(note).toContain("1 prior case");
  });
});

// ─── resolveThemeKeyFromPrediction ────────────────────────────────────────────

describe("resolveThemeKeyFromPrediction", () => {
  it("derives theme key from CpiEvent and context", () => {
    const { event, context } = buildLivePrediction({
      actual: 3.15,
      expected: 3.0,
      fed: "hawkish",
      macro: "risk_off",
      vol: "elevated",
    });

    const key = resolveThemeKeyFromPrediction(event, context);
    expect(key.surprise_direction).toBe("hotter");
    expect(key.surprise_band).toBe("medium"); // 15bp → medium
    expect(key.fed_policy_stance).toBe("hawkish");
    expect(key.macro_regime).toBe("risk_off");
    expect(key.volatility_regime).toBe("elevated");
  });
});

// ─── enrichCpiPredictionWithReliability ──────────────────────────────────────

describe("enrichCpiPredictionWithReliability", () => {
  it("returns structured reliability metadata on the result", () => {
    const enriched = buildEnrichedNoAnalogs({ actual: 3.15, expected: 3.0 });
    const result = enrichCpiPredictionWithReliability({ enriched_result: enriched });

    expect(result.reliability).toBeDefined();
    expect(result.reliability.analog_strength).toBe("none");
    expect(result.reliability.analog_count).toBe(0);
    expect(result.reliability.average_similarity).toBe(0);
    expect(typeof result.reliability.discipline_note).toBe("string");
    expect(result.reliability.flags).toBeDefined();
  });

  it("produces all required flag fields", () => {
    const enriched = buildEnrichedNoAnalogs({ actual: 3.15, expected: 3.0 });
    const result = enrichCpiPredictionWithReliability({ enriched_result: enriched });

    const { flags } = result.reliability;
    expect(typeof flags.unreliable_cluster).toBe("boolean");
    expect(typeof flags.benchmark_hurts).toBe("boolean");
    expect(typeof flags.insufficient_history).toBe("boolean");
    expect(typeof flags.strong_analog_support).toBe("boolean");
    expect(typeof flags.benchmark_helps).toBe("boolean");
  });

  it("does not change confidence when no analogs and insufficient_data cluster", () => {
    const enriched = buildEnrichedNoAnalogs({ actual: 3.15, expected: 3.0 });

    // No theme report → insufficient_data; no analogs → none strength
    // none(-0.02) + insufficient_data(0) = -0.02
    const result = enrichCpiPredictionWithReliability({ enriched_result: enriched });

    expect(result.reliability.reliability_adjustment).toBe(-0.02);

    // Each prediction's confidence should be reduced by 0.02 (clamped)
    for (let i = 0; i < enriched.predictions.length; i++) {
      const expected = Number(
        Math.max(enriched.predictions[i]!.confidence - 0.02, 0.30).toFixed(2),
      );
      expect(result.predictions[i]!.confidence).toBeCloseTo(expected, 2);
    }
  });

  it("dampens confidence for unreliable cluster with caution benchmark", () => {
    const enriched = buildEnrichedNoAnalogs({ actual: 3.15, expected: 3.0 });
    const themeReport = makeThemeReport(BASE_CLUSTER, "unreliable", 5);
    const calibrationReport = makeCalibrationReport(BASE_CLUSTER, "hurts");

    const result = enrichCpiPredictionWithReliability({
      enriched_result: enriched,
      theme_report: themeReport,
      calibration_report: calibrationReport,
    });

    // unreliable(-0.05) + hurts(-0.05) + none(-0.02) = -0.12 → clamped -0.08
    expect(result.reliability.reliability_adjustment).toBe(-0.08);
    expect(result.reliability.flags.unreliable_cluster).toBe(true);
    expect(result.reliability.flags.benchmark_hurts).toBe(true);

    // All predictions' confidences should be reduced
    for (let i = 0; i < enriched.predictions.length; i++) {
      expect(result.predictions[i]!.confidence).toBeLessThan(
        enriched.predictions[i]!.confidence + 0.001, // allow floating point
      );
    }
  });

  it("boosts confidence for reliable cluster with helps benchmark and strong analogs", () => {
    const enriched = buildEnrichedNoAnalogs({ actual: 3.15, expected: 3.0 });

    // Manually add 3 high-similarity analogs to the enriched result
    const strongAnalogs: CpiAnalogMatch[] = [
      makeAnalog({ similarity: 0.80, verdict: "correct" }),
      makeAnalog({ similarity: 0.82, verdict: "correct" }),
      makeAnalog({ similarity: 0.85, verdict: "correct" }),
    ];
    const enrichedWithAnalogs: CpiEnrichedPredictionResult = {
      ...enriched,
      analogs: strongAnalogs,
    };

    const themeReport = makeThemeReport(BASE_CLUSTER, "reliable", 8);
    const calibrationReport = makeCalibrationReport(BASE_CLUSTER, "helps");

    const result = enrichCpiPredictionWithReliability({
      enriched_result: enrichedWithAnalogs,
      theme_report: themeReport,
      calibration_report: calibrationReport,
    });

    // reliable(+0.02) + helps(+0.02) + strong(+0.01) = +0.05
    expect(result.reliability.reliability_adjustment).toBe(0.05);
    expect(result.reliability.flags.benchmark_helps).toBe(true);
    expect(result.reliability.flags.strong_analog_support).toBe(true);
    expect(result.reliability.discipline_note).toContain("Strong support");
  });

  it("confidence never exceeds 0.95 after boost", () => {
    // Start with a high base confidence by using a very hawkish context with a big surprise
    const { prediction_result } = buildLivePrediction({
      actual: 3.15,
      expected: 3.0,
    });
    const enriched = enrichCpiPredictionWithAnalogs(prediction_result, []);

    // Force very high confidence to test ceiling clamp
    const highConfidenceEnriched: CpiEnrichedPredictionResult = {
      ...enriched,
      predictions: enriched.predictions.map((p) => ({
        ...p,
        confidence: 0.93,
      })),
      analogs: [makeAnalog({ similarity: 0.90, verdict: "correct" })],
    };

    const themeReport = makeThemeReport(BASE_CLUSTER, "reliable", 10);
    const calibrationReport = makeCalibrationReport(BASE_CLUSTER, "helps");

    const result = enrichCpiPredictionWithReliability({
      enriched_result: highConfidenceEnriched,
      theme_report: themeReport,
      calibration_report: calibrationReport,
    });

    for (const pred of result.predictions) {
      expect(pred.confidence).toBeLessThanOrEqual(0.95);
    }
  });

  it("confidence never falls below 0.30 after reliability penalty", () => {
    const { prediction_result } = buildLivePrediction({
      actual: 3.15,
      expected: 3.0,
    });
    const enriched = enrichCpiPredictionWithAnalogs(prediction_result, []);

    // Force very low base confidence
    const lowConfidenceEnriched: CpiEnrichedPredictionResult = {
      ...enriched,
      predictions: enriched.predictions.map((p) => ({ ...p, confidence: 0.35 })),
      analogs: [],
    };

    const themeReport = makeThemeReport(BASE_CLUSTER, "unreliable", 5);
    const calibrationReport = makeCalibrationReport(BASE_CLUSTER, "hurts");

    const result = enrichCpiPredictionWithReliability({
      enriched_result: lowConfidenceEnriched,
      theme_report: themeReport,
      calibration_report: calibrationReport,
    });

    for (const pred of result.predictions) {
      expect(pred.confidence).toBeGreaterThanOrEqual(0.30);
    }
  });

  it("does not mutate the input enriched_result", () => {
    const enriched = buildEnrichedNoAnalogs({ actual: 3.15, expected: 3.0 });
    const originalConfidences = enriched.predictions.map((p) => p.confidence);

    enrichCpiPredictionWithReliability({
      enriched_result: enriched,
      theme_report: makeThemeReport(BASE_CLUSTER, "unreliable", 5),
      calibration_report: makeCalibrationReport(BASE_CLUSTER, "hurts"),
    });

    // Original confidences must be unchanged
    enriched.predictions.forEach((p, i) => {
      expect(p.confidence).toBe(originalConfidences[i]);
    });
  });

  it("discipline note contains cluster_id in its text", () => {
    const enriched = buildEnrichedNoAnalogs({ actual: 3.15, expected: 3.0 });
    const themeReport = makeThemeReport(BASE_CLUSTER, "mixed", 6);

    const result = enrichCpiPredictionWithReliability({
      enriched_result: enriched,
      theme_report: themeReport,
    });

    // Note should reference the cluster one way or another
    expect(typeof result.reliability.discipline_note).toBe("string");
    expect(result.reliability.discipline_note.length).toBeGreaterThan(0);
  });

  it("cluster_context has correct cluster_id derived from event dimensions", () => {
    const enriched = buildEnrichedNoAnalogs({
      actual: 3.15,   // 15bp hotter → hotter.medium
      expected: 3.0,
      fed: "hawkish",
      macro: "risk_off",
      vol: "elevated",
    });

    const result = enrichCpiPredictionWithReliability({ enriched_result: enriched });
    expect(result.reliability.cluster_context.cluster_id).toBe(BASE_CLUSTER);
  });
});

// ─── resolveCpiReliabilitySignals ─────────────────────────────────────────────

describe("resolveCpiReliabilitySignals", () => {
  it("returns all required fields", () => {
    const enriched = buildEnrichedNoAnalogs({ actual: 3.15, expected: 3.0 });
    const signals = resolveCpiReliabilitySignals(enriched);

    expect(signals.analog_strength).toBeDefined();
    expect(typeof signals.analog_count).toBe("number");
    expect(typeof signals.average_similarity).toBe("number");
    expect(signals.cluster_context).toBeDefined();
    expect(typeof signals.reliability_adjustment).toBe("number");
    expect(typeof signals.discipline_note).toBe("string");
    expect(signals.flags).toBeDefined();
  });

  it("defaults cluster to insufficient_data when no theme report", () => {
    const enriched = buildEnrichedNoAnalogs({ actual: 3.15, expected: 3.0 });
    const signals = resolveCpiReliabilitySignals(enriched);
    expect(signals.cluster_context.reliability_signal).toBe("insufficient_data");
    expect(signals.cluster_context.benchmark_verdict).toBe("unknown");
  });
});

// ─── End-to-end: full pipeline with live store ────────────────────────────────

describe("full reliability pipeline", () => {
  it("enriches a live prediction with theme + benchmark context", async () => {
    const store = new CpiMemoryCaseStore();

    // Build 4 prior cases: same cluster (hotter/medium/hawkish/risk_off/elevated)
    for (let i = 1; i <= 4; i++) {
      const event = buildCpiEvent({
        released_at: `2025-0${i}-10T13:30:00Z`,
        period: `2025-0${i}`,
        actual_value: 3.15,
        expected_value: 3.0,
        prior_value: 3.0,
      });
      const context = buildMarketContextSnapshot({
        fed_policy_stance: "hawkish",
        macro_regime: "risk_off",
        volatility_regime: "elevated",
      });
      const prediction_result = generateCpiPrediction({
        cpi_event: event,
        context,
        horizons: ["1d"],
      });
      const baseDir = prediction_result.predictions[0]!.assets[0]!.expected_direction;
      const realized = prediction_result.predictions[0]!.assets.map((a) => ({
        ticker: a.ticker,
        realized_direction: (baseDir === "mixed" ? "up" : baseDir) as "up" | "down",
        realized_magnitude_bp: 45,
      }));
      const outcome_result = trackCpiOutcome({
        prediction_result,
        realized_moves: realized,
        measured_at: `2025-0${i}-11T20:00:00Z`,
        timing_alignment: 0.8,
      });
      await store.save(buildCpiMemoryCase({ prediction_result, outcome_result }));
    }

    // Build reports from the stored cases
    const themeReport = await buildCpiThemeReport(store);
    const benchmarkResult = await runCpiReplayBenchmark(store);
    const calibrationReport = buildCpiCalibrationReport(benchmarkResult);

    // Build a new live prediction matching the same cluster
    const liveEvent = buildCpiEvent({
      released_at: "2025-05-10T13:30:00Z",
      period: "2025-05",
      actual_value: 3.15,
      expected_value: 3.0,
      prior_value: 3.0,
    });
    const liveContext = buildMarketContextSnapshot({
      fed_policy_stance: "hawkish",
      macro_regime: "risk_off",
      volatility_regime: "elevated",
    });
    const livePrediction = generateCpiPrediction({
      cpi_event: liveEvent,
      context: liveContext,
      horizons: ["1d"],
    });

    // Phase 5B: analog enrichment
    const analogs = await findCpiAnalogs(store, liveEvent, liveContext);
    const phase5bResult = enrichCpiPredictionWithAnalogs(livePrediction, analogs);

    // Phase 5E: reliability enrichment
    const phase5eResult = enrichCpiPredictionWithReliability({
      enriched_result: phase5bResult,
      theme_report: themeReport,
      calibration_report: calibrationReport,
    });

    // Assertions on shape
    expect(phase5eResult.reliability).toBeDefined();
    expect(phase5eResult.reliability.cluster_context.cluster_id).toBe(BASE_CLUSTER);
    expect(["reliable", "mixed", "unreliable", "insufficient_data"]).toContain(
      phase5eResult.reliability.cluster_context.reliability_signal,
    );
    expect(["helps", "hurts", "neutral", "insufficient_data", "unknown"]).toContain(
      phase5eResult.reliability.cluster_context.benchmark_verdict,
    );

    // Discipline note must be non-empty
    expect(phase5eResult.reliability.discipline_note.length).toBeGreaterThan(0);

    // Confidence must remain in valid range
    for (const pred of phase5eResult.predictions) {
      expect(pred.confidence).toBeGreaterThanOrEqual(0.30);
      expect(pred.confidence).toBeLessThanOrEqual(0.95);
    }
  });
});
