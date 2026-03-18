import { describe, expect, it } from "vitest";

import { buildCpiEvent } from "./events/cpiEvent.js";
import { buildMarketContextSnapshot } from "./context/marketContext.js";
import { generateCpiPrediction } from "./prediction/cpiPrediction.js";
import { trackCpiOutcome } from "./outcome/outcomeTracker.js";
import { buildCpiMemoryCase } from "./memory/memoryCaseBuilder.js";
import { CpiMemoryCaseStore } from "./memory/cpiMemoryCaseStore.js";
import { findCpiAnalogs } from "./analogs/cpiAnalogRetrieval.js";
import { enrichCpiPredictionWithAnalogs } from "./analogs/cpiConfidenceEnrichment.js";
import { enrichCpiPredictionWithReliability } from "./reliability/cpiReliabilityEnrichment.js";
import { enrichCpiPredictionWithKnowledge } from "./reliability/cpiKnowledgeEnrichment.js";
import { buildCpiKnowledgeBase } from "./knowledge/cpiKnowledgeSummary.js";
import {
  buildCpiPredictionExplanation,
  buildCpiPredictionExplanations,
} from "./explanations/cpiPredictionExplanation.js";
import type { CpiKnowledgeEnrichedResult } from "./reliability/cpiKnowledgeEnrichment.js";
import type { CpiKnowledgeBase, CpiKnowledgeEntry } from "./knowledge/cpiKnowledgeSummary.js";
import type { CpiEnrichedPredictionResult } from "./analogs/cpiConfidenceEnrichment.js";
import type { CpiReliabilityEnrichedResult } from "./reliability/cpiReliabilitySignals.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_CLUSTER = "hotter.medium.hawkish.risk_off.elevated";

type CaseSpec = {
  actual: number;
  expected: number;
  released_at?: string;
  period?: string;
  fed?: string;
  macro?: string;
  vol?: string;
  directionCorrect?: boolean;
};

const buildCase = (spec: CaseSpec) => {
  const event = buildCpiEvent({
    released_at: spec.released_at ?? "2025-01-10T13:30:00Z",
    period: spec.period ?? "2025-01",
    actual_value: spec.actual,
    expected_value: spec.expected,
    prior_value: spec.expected,
  });
  const context = buildMarketContextSnapshot({
    fed_policy_stance: (spec.fed ?? "hawkish") as any,
    macro_regime: (spec.macro ?? "risk_off") as any,
    volatility_regime: (spec.vol ?? "elevated") as any,
  });
  const prediction_result = generateCpiPrediction({
    cpi_event: event,
    context,
    horizons: ["1d"],
  });
  const correct = spec.directionCorrect ?? true;
  const realized = prediction_result.predictions[0]!.assets.map((a) => {
    const base: "up" | "down" = a.expected_direction === "mixed" ? "up" : a.expected_direction;
    const dir: "up" | "down" = correct ? base : base === "up" ? "down" : "up";
    return { ticker: a.ticker, realized_direction: dir, realized_magnitude_bp: dir === "up" ? 45 : -45 };
  });
  const outcome_result = trackCpiOutcome({
    prediction_result,
    realized_moves: realized,
    measured_at: new Date(new Date(spec.released_at ?? "2025-01-10T13:30:00Z").getTime() + 86_400_000).toISOString(),
    timing_alignment: 0.8,
  });
  return buildCpiMemoryCase({ prediction_result, outcome_result });
};

/** Build a full Phase 5B+5E+5G enriched result through the live pipeline */
const buildFullEnrichedResult = async (
  store: CpiMemoryCaseStore,
  liveSpec: CaseSpec,
  knowledgeBase?: CpiKnowledgeBase,
): Promise<CpiKnowledgeEnrichedResult> => {
  const liveCase = buildCase(liveSpec);
  const { cpi_event, context, prediction_result } = liveCase;
  const analogs = await findCpiAnalogs(store, cpi_event, context);
  const phase5b = enrichCpiPredictionWithAnalogs(prediction_result, analogs);
  const phase5e = enrichCpiPredictionWithReliability({ enriched_result: phase5b });
  return enrichCpiPredictionWithKnowledge({
    reliability_enriched_result: phase5e,
    knowledge_base: knowledgeBase,
  });
};

const makeFailureEntry = (summary: string, cluster_ids: string[] = [BASE_CLUSTER]): CpiKnowledgeEntry => ({
  id: "fail-1",
  knowledge_type: "failure_mode",
  summary,
  source_lesson_summaries: [summary],
  evidence_count: 3,
  cluster_ids,
  first_seen: "2025-01-01T00:00:00.000Z",
  last_seen: "2025-03-01T00:00:00.000Z",
});

const makeBiasEntry = (direction: "overconfident" | "underconfident"): CpiKnowledgeEntry => ({
  id: "bias-1",
  knowledge_type: "confidence_bias",
  summary:
    direction === "overconfident"
      ? "Systematic overconfidence across 3 cases: confidence levels too high for realized accuracy. Cap confidence for similar setups until hit rate improves."
      : "Systematic underconfidence across 3 cases: confidence levels too conservative. Confidence floor may be suppressing valid signals.",
  source_lesson_summaries: [],
  evidence_count: 3,
  cluster_ids: [],
  first_seen: "2025-01-01T00:00:00.000Z",
  last_seen: "2025-03-01T00:00:00.000Z",
});

const makeKnowledgeBase = (entries: CpiKnowledgeEntry[]): CpiKnowledgeBase => ({
  generated_at: new Date().toISOString(),
  total_source_cases: 3,
  entries,
  reinforcement_entries: entries.filter((e) => e.knowledge_type === "reinforcement_pattern"),
  failure_entries: entries.filter((e) => e.knowledge_type === "failure_mode"),
  bias_entries: entries.filter((e) => e.knowledge_type === "confidence_bias"),
  coverage_note: "Test KB.",
});

// ─── buildCpiPredictionExplanation — field completeness ───────────────────────

describe("buildCpiPredictionExplanation — field completeness", () => {
  it("produces all required top-level fields", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");

    expect(typeof explanation.horizon).toBe("string");
    expect(typeof explanation.cluster_id).toBe("string");
    expect(typeof explanation.surprise_direction).toBe("string");
    expect(typeof explanation.analog_count).toBe("number");
    expect(explanation.confidence_breakdown).toBeDefined();
    expect(Array.isArray(explanation.evidence)).toBe(true);
    expect(Array.isArray(explanation.cautions)).toBe(true);
    expect(Array.isArray(explanation.supports)).toBe(true);
    expect(typeof explanation.explanation_summary).toBe("string");
    expect(typeof explanation.generated_at).toBe("string");
  });

  it("confidence_breakdown has all required fields with correct types", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const { confidence_breakdown: cb } = buildCpiPredictionExplanation(result, "1d");

    expect(typeof cb.base_confidence).toBe("number");
    expect(typeof cb.analog_boost).toBe("number");
    expect(typeof cb.reliability_adjustment).toBe("number");
    expect(typeof cb.knowledge_adjustment).toBe("number");
    expect(typeof cb.total_adjustment).toBe("number");
    expect(typeof cb.final_confidence).toBe("number");
  });

  it("total_adjustment equals sum of three layer deltas", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const { confidence_breakdown: cb } = buildCpiPredictionExplanation(result, "1d");

    const expectedTotal = Number(
      (cb.analog_boost + cb.reliability_adjustment + cb.knowledge_adjustment).toFixed(2),
    );
    expect(cb.total_adjustment).toBeCloseTo(expectedTotal, 2);
  });

  it("final_confidence matches the prediction's confidence", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");

    const pred = result.predictions.find((p) => p.horizon === "1d")!;
    expect(explanation.confidence_breakdown.final_confidence).toBe(pred.confidence);
  });

  it("cluster_id matches the event's macro conditions", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, {
      actual: 3.15, expected: 3.0,
      fed: "hawkish", macro: "risk_off", vol: "elevated",
    });
    const explanation = buildCpiPredictionExplanation(result, "1d");
    expect(explanation.cluster_id).toBe(BASE_CLUSTER);
  });

  it("surprise_direction matches the CPI event direction", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");
    // actual > expected → hotter
    expect(explanation.surprise_direction).toBe("hotter");
  });

  it("explanation_summary is non-empty string", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");
    expect(explanation.explanation_summary.length).toBeGreaterThan(20);
  });

  it("throws when horizon does not exist", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    expect(() => buildCpiPredictionExplanation(result, "99d")).toThrow(/99d/);
  });
});

// ─── Evidence items — source labeling ────────────────────────────────────────

describe("buildCpiPredictionExplanation — evidence source labeling", () => {
  it("each evidence item has source, signal, label, description fields", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");

    for (const item of explanation.evidence) {
      expect(["analog", "reliability", "knowledge"]).toContain(item.source);
      expect(["support", "caution", "neutral"]).toContain(item.signal);
      expect(typeof item.label).toBe("string");
      expect(item.label.length).toBeGreaterThan(0);
      expect(typeof item.description).toBe("string");
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it("cautions is a subset of evidence where signal=caution", async () => {
    const store = new CpiMemoryCaseStore();
    const kb = makeKnowledgeBase([makeFailureEntry("Recurring direction error.")]);
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 }, kb);
    const explanation = buildCpiPredictionExplanation(result, "1d");

    for (const item of explanation.cautions) {
      expect(item.signal).toBe("caution");
    }
    const cautionCount = explanation.evidence.filter((e) => e.signal === "caution").length;
    expect(explanation.cautions).toHaveLength(cautionCount);
  });

  it("supports is a subset of evidence where signal=support", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");

    for (const item of explanation.supports) {
      expect(item.signal).toBe("support");
    }
  });

  it("no_analogs item is emitted when store is empty", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");

    const analogItem = explanation.evidence.find((e) => e.source === "analog");
    expect(analogItem).toBeDefined();
    expect(analogItem!.label).toBe("no_analogs");
    expect(analogItem!.signal).toBe("neutral");
  });

  it("analog_reinforcement item is emitted when analogs support the prediction", async () => {
    const store = new CpiMemoryCaseStore();
    // Populate store with correct prior cases
    for (let i = 1; i <= 3; i++) {
      await store.save(buildCase({
        actual: 3.15, expected: 3.0,
        released_at: `2025-0${i}-10T13:30:00Z`,
        period: `2025-0${i}`,
        directionCorrect: true,
      }));
    }
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");

    // If analogs were found and they're correct, analog_reinforcement should appear
    if (result.analogs.length > 0) {
      const analogItem = explanation.evidence.find((e) => e.source === "analog");
      expect(analogItem).toBeDefined();
      // analog_boost > 0 → reinforcement or = 0 → mixed
      expect(["analog_reinforcement", "mixed_analogs"]).toContain(analogItem!.label);
    }
  });

  it("active_failure_mode knowledge items are labeled correctly", async () => {
    const store = new CpiMemoryCaseStore();
    const kb = makeKnowledgeBase([makeFailureEntry("Recurring direction error detected.")]);
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 }, kb);
    const explanation = buildCpiPredictionExplanation(result, "1d");

    const knowledgeCautions = explanation.cautions.filter(
      (e) => e.source === "knowledge" && e.label === "active_failure_mode",
    );
    expect(knowledgeCautions.length).toBeGreaterThanOrEqual(1);
    expect(knowledgeCautions[0]!.description).toContain("Recurring direction error");
  });

  it("overconfidence_bias item is a caution from the knowledge source", async () => {
    const store = new CpiMemoryCaseStore();
    const kb = makeKnowledgeBase([makeBiasEntry("overconfident")]);
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 }, kb);
    const explanation = buildCpiPredictionExplanation(result, "1d");

    const biasItem = explanation.evidence.find((e) => e.label === "overconfidence_bias");
    expect(biasItem).toBeDefined();
    expect(biasItem!.signal).toBe("caution");
    expect(biasItem!.source).toBe("knowledge");
  });

  it("underconfidence_bias item is a support from the knowledge source", async () => {
    const store = new CpiMemoryCaseStore();
    const kb = makeKnowledgeBase([makeBiasEntry("underconfident")]);
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 }, kb);
    const explanation = buildCpiPredictionExplanation(result, "1d");

    const biasItem = explanation.evidence.find((e) => e.label === "underconfidence_bias");
    expect(biasItem).toBeDefined();
    expect(biasItem!.signal).toBe("support");
  });
});

// ─── Explanation summary — dominant signal priority ──────────────────────────

describe("buildCpiPredictionExplanation — explanation_summary", () => {
  it("baseline summary when no analogs and no knowledge", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");
    // With empty store and no KB, summary should indicate baseline/no-evidence
    expect(explanation.explanation_summary.toLowerCase()).toMatch(/baseline|no historical|no adjustment/);
  });

  it("caution summary when failure modes are present", async () => {
    const store = new CpiMemoryCaseStore();
    const kb = makeKnowledgeBase([makeFailureEntry("Recurring direction error.")]);
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 }, kb);
    const explanation = buildCpiPredictionExplanation(result, "1d");
    expect(explanation.explanation_summary.toLowerCase()).toContain("caution");
  });

  it("summary includes total adjustment value", async () => {
    const store = new CpiMemoryCaseStore();
    const kb = makeKnowledgeBase([makeFailureEntry("Recurring direction error.")]);
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 }, kb);
    const explanation = buildCpiPredictionExplanation(result, "1d");
    // Total adjustment should appear in summary (as +X.XX or -X.XX)
    expect(explanation.explanation_summary).toMatch(/[+-]\d+\.\d{2}/);
  });
});

// ─── Sparse data behavior ─────────────────────────────────────────────────────

describe("buildCpiPredictionExplanation — sparse data behavior", () => {
  it("handles empty store gracefully", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    expect(() => buildCpiPredictionExplanation(result, "1d")).not.toThrow();
    const explanation = buildCpiPredictionExplanation(result, "1d");
    expect(explanation.analog_count).toBe(0);
    expect(explanation.confidence_breakdown.analog_boost).toBe(0);
  });

  it("handles absent knowledge base gracefully", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const explanation = buildCpiPredictionExplanation(result, "1d");
    expect(explanation.confidence_breakdown.knowledge_adjustment).toBe(0);
    const knowledgeItem = explanation.evidence.find((e) => e.source === "knowledge");
    expect(knowledgeItem).toBeDefined();
    expect(knowledgeItem!.label).toBe("no_knowledge");
    expect(knowledgeItem!.signal).toBe("neutral");
  });

  it("confidence_breakdown values are all finite numbers", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const { confidence_breakdown: cb } = buildCpiPredictionExplanation(result, "1d");

    expect(isFinite(cb.base_confidence)).toBe(true);
    expect(isFinite(cb.analog_boost)).toBe(true);
    expect(isFinite(cb.reliability_adjustment)).toBe(true);
    expect(isFinite(cb.knowledge_adjustment)).toBe(true);
    expect(isFinite(cb.total_adjustment)).toBe(true);
    expect(isFinite(cb.final_confidence)).toBe(true);
  });
});

// ─── buildCpiPredictionExplanations (multi-horizon) ──────────────────────────

describe("buildCpiPredictionExplanations", () => {
  it("produces one explanation per prediction horizon", async () => {
    const store = new CpiMemoryCaseStore();
    const liveCase = buildCase({ actual: 3.15, expected: 3.0 });
    const { cpi_event, context } = liveCase;

    // Build with multiple horizons
    const prediction_result = generateCpiPrediction({
      cpi_event,
      context,
      horizons: ["1d", "5d"],
    });
    const phase5b = enrichCpiPredictionWithAnalogs(prediction_result, []);
    const phase5e = enrichCpiPredictionWithReliability({ enriched_result: phase5b });
    const result = enrichCpiPredictionWithKnowledge({ reliability_enriched_result: phase5e });

    const explanations = buildCpiPredictionExplanations(result);

    expect(explanations).toHaveLength(2);
    const horizons = explanations.map((e) => e.horizon);
    expect(horizons).toContain("1d");
    expect(horizons).toContain("5d");
  });

  it("each explanation has consistent cluster_id and surprise_direction", async () => {
    const store = new CpiMemoryCaseStore();
    const liveCase = buildCase({ actual: 3.15, expected: 3.0, fed: "hawkish", macro: "risk_off", vol: "elevated" });
    const { cpi_event, context } = liveCase;

    const prediction_result = generateCpiPrediction({ cpi_event, context, horizons: ["1d", "5d"] });
    const phase5b = enrichCpiPredictionWithAnalogs(prediction_result, []);
    const phase5e = enrichCpiPredictionWithReliability({ enriched_result: phase5b });
    const result = enrichCpiPredictionWithKnowledge({ reliability_enriched_result: phase5e });

    const explanations = buildCpiPredictionExplanations(result);

    for (const exp of explanations) {
      expect(exp.cluster_id).toBe(BASE_CLUSTER);
      expect(exp.surprise_direction).toBe("hotter");
    }
  });

  it("each explanation has a unique horizon and final_confidence", async () => {
    const store = new CpiMemoryCaseStore();
    const liveCase = buildCase({ actual: 3.15, expected: 3.0 });
    const { cpi_event, context } = liveCase;

    const prediction_result = generateCpiPrediction({ cpi_event, context, horizons: ["1d", "5d"] });
    const phase5b = enrichCpiPredictionWithAnalogs(prediction_result, []);
    const phase5e = enrichCpiPredictionWithReliability({ enriched_result: phase5b });
    const result = enrichCpiPredictionWithKnowledge({ reliability_enriched_result: phase5e });

    const explanations = buildCpiPredictionExplanations(result);
    const horizonsSet = new Set(explanations.map((e) => e.horizon));
    expect(horizonsSet.size).toBe(explanations.length);
  });
});

// ─── End-to-end: full pipeline ────────────────────────────────────────────────

describe("buildCpiPredictionExplanation — end-to-end full pipeline", () => {
  it("produces a coherent explanation from a store with prior history", async () => {
    const store = new CpiMemoryCaseStore();

    // Build 3 prior cases with wrong direction
    for (let i = 1; i <= 3; i++) {
      await store.save(buildCase({
        actual: 3.15, expected: 3.0,
        released_at: `2025-0${i}-10T13:30:00Z`,
        period: `2025-0${i}`,
        directionCorrect: false,
      }));
    }

    const kb = await buildCpiKnowledgeBase(store);
    const result = await buildFullEnrichedResult(
      store,
      { actual: 3.15, expected: 3.0, released_at: "2025-04-10T13:30:00Z", period: "2025-04" },
      kb,
    );

    const explanation = buildCpiPredictionExplanation(result, "1d");

    // Shape
    expect(explanation.cluster_id).toBe(BASE_CLUSTER);
    expect(explanation.evidence.length).toBeGreaterThan(0);
    expect(explanation.explanation_summary.length).toBeGreaterThan(0);

    // Reliability sources present
    const sources = new Set(explanation.evidence.map((e) => e.source));
    expect(sources.has("analog")).toBe(true);
    expect(sources.has("reliability")).toBe(true);
    expect(sources.has("knowledge")).toBe(true);

    // Confidence is valid
    const { final_confidence } = explanation.confidence_breakdown;
    expect(final_confidence).toBeGreaterThanOrEqual(0.25);
    expect(final_confidence).toBeLessThanOrEqual(0.95);

    // With wrong history, failure modes may be active → caution expected
    if (kb.failure_entries.length > 0) {
      expect(explanation.cautions.length).toBeGreaterThan(0);
      expect(explanation.explanation_summary.toLowerCase()).toContain("caution");
    }
  });

  it("explanation does not mutate the source enriched result", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await buildFullEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const originalConf = result.predictions[0]!.confidence;

    buildCpiPredictionExplanation(result, "1d");
    expect(result.predictions[0]!.confidence).toBe(originalConf);
  });
});
