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
import type { CpiKnowledgeBase, CpiKnowledgeEntry } from "./knowledge/cpiKnowledgeSummary.js";
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
  const prediction_result = generateCpiPrediction({ cpi_event: event, context, horizons: ["1d"] });
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

/** Build the Phase 5B+5E enriched result for a live prediction */
const buildReliabilityEnrichedResult = async (
  store: CpiMemoryCaseStore,
  liveSpec: CaseSpec,
): Promise<CpiReliabilityEnrichedResult> => {
  const liveCase = buildCase(liveSpec);
  const { cpi_event, context, prediction_result } = liveCase;

  const analogs = await findCpiAnalogs(store, cpi_event, context);
  const phase5b = enrichCpiPredictionWithAnalogs(prediction_result, analogs);
  return enrichCpiPredictionWithReliability({ enriched_result: phase5b });
};

/** Helper to make a failure_mode knowledge entry */
const makeFailureEntry = (
  summary: string,
  cluster_ids: string[] = [BASE_CLUSTER],
  evidence_count = 3,
): CpiKnowledgeEntry => ({
  id: `fail-${Math.random()}`,
  knowledge_type: "failure_mode",
  summary,
  source_lesson_summaries: [summary],
  evidence_count,
  cluster_ids,
  first_seen: "2025-01-01T00:00:00.000Z",
  last_seen: "2025-03-01T00:00:00.000Z",
});

/** Helper to make a confidence_bias knowledge entry */
const makeBiasEntry = (direction: "overconfident" | "underconfident" | "mixed"): CpiKnowledgeEntry => {
  const summary =
    direction === "overconfident"
      ? "Systematic overconfidence across 3 cases: confidence levels too high for realized accuracy. Cap confidence for similar setups until hit rate improves."
      : direction === "underconfident"
        ? "Systematic underconfidence across 3 cases: confidence levels too conservative. Confidence floor may be suppressing valid signals."
        : "Mixed confidence calibration: 2 overconfident cases, 2 underconfident cases. Review calibration across both directions.";

  return {
    id: `bias-${Math.random()}`,
    knowledge_type: "confidence_bias",
    summary,
    source_lesson_summaries: [],
    evidence_count: 3,
    cluster_ids: [],
    first_seen: "2025-01-01T00:00:00.000Z",
    last_seen: "2025-03-01T00:00:00.000Z",
  };
};

/** Make a minimal CpiKnowledgeBase with given entries */
const makeKnowledgeBase = (entries: CpiKnowledgeEntry[]): CpiKnowledgeBase => ({
  generated_at: new Date().toISOString(),
  total_source_cases: 5,
  entries,
  reinforcement_entries: entries.filter((e) => e.knowledge_type === "reinforcement_pattern"),
  failure_entries: entries.filter((e) => e.knowledge_type === "failure_mode"),
  bias_entries: entries.filter((e) => e.knowledge_type === "confidence_bias"),
  coverage_note: "Test knowledge base.",
});

// ─── No-op path ───────────────────────────────────────────────────────────────

describe("enrichCpiPredictionWithKnowledge — no-op path", () => {
  it("passes through unchanged when knowledge_base is absent", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const originalConfidences = phase5e.predictions.map((p) => p.confidence);

    const result = enrichCpiPredictionWithKnowledge({ reliability_enriched_result: phase5e });

    result.predictions.forEach((p, i) => {
      expect(p.confidence).toBe(originalConfidences[i]);
    });
    expect(result.knowledge.knowledge_adjustment).toBe(0);
    expect(result.knowledge.flags.insufficient_knowledge).toBe(true);
    expect(result.knowledge.active_failure_modes).toHaveLength(0);
    expect(result.knowledge.confidence_bias_entry).toBeNull();
  });

  it("passes through unchanged when knowledge_base has no entries", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    expect(result.knowledge.knowledge_adjustment).toBe(0);
    expect(result.knowledge.flags.insufficient_knowledge).toBe(true);
  });
});

// ─── Failure mode signals ─────────────────────────────────────────────────────

describe("enrichCpiPredictionWithKnowledge — failure mode signals", () => {
  it("applies −0.02 for a single active failure mode", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeFailureEntry("Recurring direction error detected.")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    expect(result.knowledge.knowledge_adjustment).toBe(-0.02);
    expect(result.knowledge.flags.has_active_failure_modes).toBe(true);
    expect(result.knowledge.active_failure_modes).toHaveLength(1);
  });

  it("applies −0.04 for two or more active failure modes", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([
      makeFailureEntry("Recurring direction error detected."),
      makeFailureEntry("Recurring magnitude error detected."),
    ]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    expect(result.knowledge.knowledge_adjustment).toBe(-0.04);
    expect(result.knowledge.active_failure_modes).toHaveLength(2);
  });

  it("reduces prediction confidence by the knowledge_adjustment", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const originalConfidences = phase5e.predictions.map((p) => p.confidence);
    const kb = makeKnowledgeBase([makeFailureEntry("Recurring direction error detected.")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    result.predictions.forEach((p, i) => {
      const expected = Number(Math.max(originalConfidences[i]! - 0.02, 0.25).toFixed(2));
      expect(p.confidence).toBeCloseTo(expected, 2);
    });
  });

  it("injects caution note into prediction.invalidations[]", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeFailureEntry("Recurring direction error detected.")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    for (const pred of result.predictions) {
      const knowledgeNote = pred.invalidations.find((n) => n.startsWith("Knowledge caution:"));
      expect(knowledgeNote).toBeDefined();
    }
  });

  it("ignores failure modes from a different cluster", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    // Failure mode belongs to a DIFFERENT cluster
    const kb = makeKnowledgeBase([
      makeFailureEntry("Recurring error.", ["cooler.small.dovish.risk_on.low"]),
    ]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    expect(result.knowledge.knowledge_adjustment).toBe(0);
    expect(result.knowledge.active_failure_modes).toHaveLength(0);
    expect(result.knowledge.flags.has_active_failure_modes).toBe(false);
  });

  it("applies cross-cluster failure modes (empty cluster_ids)", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    // Cross-cluster entry: no cluster_ids restriction
    const kb = makeKnowledgeBase([makeFailureEntry("Global recurring error.", [])]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    expect(result.knowledge.active_failure_modes).toHaveLength(1);
    expect(result.knowledge.knowledge_adjustment).toBe(-0.02);
  });
});

// ─── Confidence bias signals ──────────────────────────────────────────────────

describe("enrichCpiPredictionWithKnowledge — confidence bias signals", () => {
  it("applies −0.03 for overconfidence bias entry", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeBiasEntry("overconfident")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    expect(result.knowledge.knowledge_adjustment).toBe(-0.03);
    expect(result.knowledge.flags.overconfidence_bias).toBe(true);
    expect(result.knowledge.flags.underconfidence_bias).toBe(false);
    expect(result.knowledge.confidence_bias_entry).not.toBeNull();
  });

  it("applies +0.02 for underconfidence bias entry", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeBiasEntry("underconfident")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    expect(result.knowledge.knowledge_adjustment).toBe(0.02);
    expect(result.knowledge.flags.underconfidence_bias).toBe(true);
    expect(result.knowledge.flags.overconfidence_bias).toBe(false);
  });

  it("applies no confidence adjustment for mixed bias entry", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeBiasEntry("mixed")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    // Mixed bias: no directional adjustment
    expect(result.knowledge.knowledge_adjustment).toBe(0);
    expect(result.knowledge.flags.overconfidence_bias).toBe(false);
    expect(result.knowledge.flags.underconfidence_bias).toBe(false);
  });

  it("injects bias caution note into invalidations for overconfidence", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeBiasEntry("overconfident")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    for (const pred of result.predictions) {
      const biasNote = pred.invalidations.find((n) => n.startsWith("Knowledge bias:"));
      expect(biasNote).toBeDefined();
      expect(biasNote).toContain("overconfidence");
    }
  });

  it("injects no bias note for mixed bias entry", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeBiasEntry("mixed")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    for (const pred of result.predictions) {
      const biasNote = pred.invalidations.find((n) => n.startsWith("Knowledge bias:"));
      expect(biasNote).toBeUndefined();
    }
  });
});

// ─── Combined signals ─────────────────────────────────────────────────────────

describe("enrichCpiPredictionWithKnowledge — combined signals", () => {
  it("combines failure mode and overconfidence bias for maximum caution", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([
      makeFailureEntry("Recurring direction error."),
      makeFailureEntry("Recurring magnitude error."),
      makeBiasEntry("overconfident"),
    ]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    // 2 failure modes (−0.04) + overconfidence (−0.03) = −0.07 → clamp → −0.06
    expect(result.knowledge.knowledge_adjustment).toBe(-0.06);
    expect(result.knowledge.flags.has_active_failure_modes).toBe(true);
    expect(result.knowledge.flags.overconfidence_bias).toBe(true);
    // Both note types should be present
    const knowledgeNotes = result.predictions[0]!.invalidations.filter((n) =>
      n.startsWith("Knowledge"),
    );
    expect(knowledgeNotes.length).toBeGreaterThanOrEqual(2);
  });

  it("underconfidence bias partially offsets failure mode penalty", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([
      makeFailureEntry("Recurring timing error."),
      makeBiasEntry("underconfident"),
    ]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    // 1 failure mode (−0.02) + underconfidence (+0.02) = 0
    expect(result.knowledge.knowledge_adjustment).toBe(0);
  });
});

// ─── Confidence clamping ──────────────────────────────────────────────────────

describe("enrichCpiPredictionWithKnowledge — confidence bounds", () => {
  it("clamps confidence to 0.25 floor after knowledge penalty", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([
      makeFailureEntry("Recurring error 1."),
      makeFailureEntry("Recurring error 2."),
      makeBiasEntry("overconfident"),
    ]);

    // Force a very low starting confidence to test the floor clamp
    const lowConfidencePhase5e: CpiReliabilityEnrichedResult = {
      ...phase5e,
      predictions: phase5e.predictions.map((p) => ({ ...p, confidence: 0.28 })),
    };

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: lowConfidencePhase5e,
      knowledge_base: kb,
    });

    for (const pred of result.predictions) {
      expect(pred.confidence).toBeGreaterThanOrEqual(0.25);
    }
  });

  it("clamps confidence to 0.95 ceiling after underconfidence lift", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeBiasEntry("underconfident")]);

    const highConfidencePhase5e: CpiReliabilityEnrichedResult = {
      ...phase5e,
      predictions: phase5e.predictions.map((p) => ({ ...p, confidence: 0.94 })),
    };

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: highConfidencePhase5e,
      knowledge_base: kb,
    });

    for (const pred of result.predictions) {
      expect(pred.confidence).toBeLessThanOrEqual(0.95);
    }
  });

  it("does not mutate the input reliability_enriched_result", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const originalConf = phase5e.predictions.map((p) => p.confidence);
    const kb = makeKnowledgeBase([makeFailureEntry("Error."), makeBiasEntry("overconfident")]);

    enrichCpiPredictionWithKnowledge({ reliability_enriched_result: phase5e, knowledge_base: kb });

    phase5e.predictions.forEach((p, i) => {
      expect(p.confidence).toBe(originalConf[i]);
    });
  });
});

// ─── Caution note deduplication ───────────────────────────────────────────────

describe("enrichCpiPredictionWithKnowledge — caution note deduplication", () => {
  it("does not add duplicate notes if called twice", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeFailureEntry("Recurring direction error.")]);

    const once = enrichCpiPredictionWithKnowledge({ reliability_enriched_result: phase5e, knowledge_base: kb });
    // Apply again on the already-enriched result (simulate double enrichment)
    const twice = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: once,
      knowledge_base: kb,
    });

    for (const pred of twice.predictions) {
      const knowledgeNotes = pred.invalidations.filter((n) => n.startsWith("Knowledge caution:"));
      // Should appear at most once
      expect(knowledgeNotes.length).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Structured metadata ──────────────────────────────────────────────────────

describe("enrichCpiPredictionWithKnowledge — metadata shape", () => {
  it("result has all required knowledge fields", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeFailureEntry("Error.")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    expect(Array.isArray(result.knowledge.active_failure_modes)).toBe(true);
    expect(typeof result.knowledge.knowledge_adjustment).toBe("number");
    expect(Array.isArray(result.knowledge.caution_notes)).toBe(true);
    expect(typeof result.knowledge.flags.has_active_failure_modes).toBe("boolean");
    expect(typeof result.knowledge.flags.overconfidence_bias).toBe("boolean");
    expect(typeof result.knowledge.flags.underconfidence_bias).toBe("boolean");
    expect(typeof result.knowledge.flags.insufficient_knowledge).toBe("boolean");
  });

  it("preserves reliability field from Phase 5E", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeFailureEntry("Error.")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    // Phase 5E reliability signals must be preserved verbatim
    expect(result.reliability).toBeDefined();
    expect(result.reliability.reliability_adjustment).toBe(phase5e.reliability.reliability_adjustment);
    expect(result.reliability.cluster_context).toEqual(phase5e.reliability.cluster_context);
  });

  it("preserves Phase 5B analog metadata", async () => {
    const store = new CpiMemoryCaseStore();
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const kb = makeKnowledgeBase([makeFailureEntry("Error.")]);

    const result = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    // Analog metadata (analog_boost, analog_count) must be preserved
    result.predictions.forEach((p, i) => {
      expect(p.analog_boost).toBe(phase5e.predictions[i]!.analog_boost);
      expect(p.analog_count).toBe(phase5e.predictions[i]!.analog_count);
    });
  });
});

// ─── End-to-end: full Phase 5B → 5E → 5G pipeline ────────────────────────────

describe("full Phase 5B → 5E → 5G pipeline", () => {
  it("produces a valid CpiKnowledgeEnrichedResult from a live store", async () => {
    const store = new CpiMemoryCaseStore();

    // Build 3 wrong cases → will produce recurring failure lessons
    for (let i = 1; i <= 3; i++) {
      await store.save(buildCase({
        actual: 3.15, expected: 3.0,
        released_at: `2025-0${i}-10T13:30:00Z`,
        period: `2025-0${i}`,
        fed: "hawkish", macro: "risk_off", vol: "elevated",
        directionCorrect: false,
      }));
    }

    // Build knowledge base from stored cases
    const kb = await buildCpiKnowledgeBase(store);

    // Build live prediction for the same cluster
    const liveEvent = buildCpiEvent({
      released_at: "2025-04-10T13:30:00Z",
      period: "2025-04",
      actual_value: 3.15, expected_value: 3.0, prior_value: 3.0,
    });
    const liveContext = buildMarketContextSnapshot({
      fed_policy_stance: "hawkish",
      macro_regime: "risk_off",
      volatility_regime: "elevated",
    });
    const livePrediction = generateCpiPrediction({ cpi_event: liveEvent, context: liveContext, horizons: ["1d"] });

    const analogs = await findCpiAnalogs(store, liveEvent, liveContext);
    const phase5b = enrichCpiPredictionWithAnalogs(livePrediction, analogs);
    const phase5e = enrichCpiPredictionWithReliability({ enriched_result: phase5b });
    const phase5g = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    // Shape assertions
    expect(phase5g.knowledge).toBeDefined();
    expect(phase5g.reliability).toBeDefined();
    expect(phase5g.analogs).toBeDefined();

    // Confidence must remain in valid range after all three layers
    for (const pred of phase5g.predictions) {
      expect(pred.confidence).toBeGreaterThanOrEqual(0.25);
      expect(pred.confidence).toBeLessThanOrEqual(0.95);
    }

    // Knowledge base built from wrong cases should have failure entries
    // that reduce confidence relative to Phase 5E
    if (kb.failure_entries.length > 0 && phase5g.knowledge.active_failure_modes.length > 0) {
      expect(phase5g.knowledge.knowledge_adjustment).toBeLessThan(0);
    }
  });

  it("produces correct caution notes in the full pipeline with failure modes", async () => {
    const store = new CpiMemoryCaseStore();

    for (let i = 1; i <= 2; i++) {
      await store.save(buildCase({
        actual: 3.15, expected: 3.0,
        released_at: `2025-0${i}-10T13:30:00Z`,
        period: `2025-0${i}`,
        directionCorrect: false,
      }));
    }

    const kb = await buildCpiKnowledgeBase(store);
    const phase5e = await buildReliabilityEnrichedResult(store, { actual: 3.15, expected: 3.0 });
    const phase5g = enrichCpiPredictionWithKnowledge({
      reliability_enriched_result: phase5e,
      knowledge_base: kb,
    });

    // caution_notes should be strings
    for (const note of phase5g.knowledge.caution_notes) {
      expect(typeof note).toBe("string");
      expect(note.length).toBeGreaterThan(0);
    }
  });
});
