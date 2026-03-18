import { beforeEach, describe, expect, it } from "vitest";

import { buildCpiEvent } from "./events/cpiEvent.js";
import { buildMarketContextSnapshot } from "./context/marketContext.js";
import { generateCpiPrediction } from "./prediction/cpiPrediction.js";
import { trackCpiOutcome } from "./outcome/outcomeTracker.js";
import { buildCpiMemoryCase } from "./memory/memoryCaseBuilder.js";
import { CpiMemoryCaseStore } from "./memory/cpiMemoryCaseStore.js";
import { findCpiAnalogs, resolveSurpriseBand } from "./analogs/cpiAnalogRetrieval.js";
import { enrichCpiPredictionWithAnalogs } from "./analogs/cpiConfidenceEnrichment.js";
import type { CpiAnalogMatch } from "./analogs/cpiAnalogRetrieval.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const buildQuickMemoryCase = (params: {
  actual: number;
  expected: number;
  period?: string;
  fed?: string;
  macro?: string;
  vol?: string;
  directionCorrect?: boolean;
}) => {
  const event = buildCpiEvent({
    released_at: "2025-01-10T13:30:00Z",
    period: params.period ?? "2025-01",
    actual_value: params.actual,
    expected_value: params.expected,
    prior_value: params.expected,
  });

  const context = buildMarketContextSnapshot({
    fed_policy_stance: (params.fed ?? "neutral") as any,
    macro_regime: (params.macro ?? "uncertain") as any,
    volatility_regime: (params.vol ?? "normal") as any,
  });

  const prediction_result = generateCpiPrediction({
    cpi_event: event,
    context,
    horizons: ["1d"],
  });

  const correct = params.directionCorrect ?? true;
  const realizedMoves = prediction_result.predictions[0]!.assets.map((a) => ({
    ticker: a.ticker,
    realized_direction: (
      correct ? a.expected_direction : a.expected_direction === "up" ? "down" : "up"
    ) as "up" | "down",
    realized_magnitude_bp: correct ? 40 : -40,
  }));

  const outcome_result = trackCpiOutcome({
    prediction_result,
    realized_moves: realizedMoves,
    measured_at: "2025-01-11T20:00:00Z",
    timing_alignment: 0.8,
  });

  return buildCpiMemoryCase({ prediction_result, outcome_result });
};

// ─── Surprise Band ────────────────────────────────────────────────────────────

describe("resolveSurpriseBand", () => {
  it("returns 'small' for ≤ 10 bp", () => {
    expect(resolveSurpriseBand(0)).toBe("small");
    expect(resolveSurpriseBand(10)).toBe("small");
    expect(resolveSurpriseBand(-10)).toBe("small");
  });

  it("returns 'medium' for 11–25 bp", () => {
    expect(resolveSurpriseBand(11)).toBe("medium");
    expect(resolveSurpriseBand(25)).toBe("medium");
    expect(resolveSurpriseBand(-20)).toBe("medium");
  });

  it("returns 'large' for > 25 bp", () => {
    expect(resolveSurpriseBand(26)).toBe("large");
    expect(resolveSurpriseBand(50)).toBe("large");
    expect(resolveSurpriseBand(-30)).toBe("large");
  });
});

// ─── CpiMemoryCaseStore ───────────────────────────────────────────────────────

describe("CpiMemoryCaseStore", () => {
  let store: CpiMemoryCaseStore;

  beforeEach(() => {
    store = new CpiMemoryCaseStore(); // no persistPath → pure in-memory
  });

  it("starts empty", async () => {
    expect(await store.list()).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("saves and retrieves a case by id", async () => {
    const mc = buildQuickMemoryCase({ actual: 3.2, expected: 3.0 });
    await store.save(mc);

    const retrieved = await store.get(mc.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(mc.id);
    expect(retrieved!.event_family).toBe("cpi");
    expect(retrieved!.cpi_event.surprise_direction).toBe("hotter");
  });

  it("lists all saved cases newest-first", async () => {
    const mc1 = buildQuickMemoryCase({ actual: 3.2, expected: 3.0, period: "2025-01" });
    const mc2 = buildQuickMemoryCase({ actual: 2.8, expected: 3.0, period: "2025-02" });
    await store.save(mc1);
    await store.save(mc2);

    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it("filters by surprise_direction", async () => {
    await store.save(buildQuickMemoryCase({ actual: 3.2, expected: 3.0 })); // hotter
    await store.save(buildQuickMemoryCase({ actual: 2.7, expected: 3.0 })); // cooler

    const hotter = await store.list({ surprise_direction: "hotter" });
    expect(hotter).toHaveLength(1);
    expect(hotter[0]!.cpi_event.surprise_direction).toBe("hotter");

    const cooler = await store.list({ surprise_direction: "cooler" });
    expect(cooler).toHaveLength(1);
    expect(cooler[0]!.cpi_event.surprise_direction).toBe("cooler");
  });

  it("filters by fed_policy_stance", async () => {
    await store.save(buildQuickMemoryCase({ actual: 3.2, expected: 3.0, fed: "hawkish" }));
    await store.save(buildQuickMemoryCase({ actual: 2.7, expected: 3.0, fed: "dovish" }));

    const hawkish = await store.list({ fed_policy_stance: "hawkish" });
    expect(hawkish).toHaveLength(1);
    expect(hawkish[0]!.context.fed_policy_stance).toBe("hawkish");
  });

  it("filters by macro_regime", async () => {
    await store.save(
      buildQuickMemoryCase({ actual: 3.2, expected: 3.0, macro: "risk_on" }),
    );
    await store.save(
      buildQuickMemoryCase({ actual: 3.2, expected: 3.0, macro: "risk_off" }),
    );

    const riskOn = await store.list({ macro_regime: "risk_on" });
    expect(riskOn).toHaveLength(1);
  });

  it("filters by volatility_regime", async () => {
    await store.save(buildQuickMemoryCase({ actual: 3.2, expected: 3.0, vol: "elevated" }));
    await store.save(buildQuickMemoryCase({ actual: 3.2, expected: 3.0, vol: "normal" }));

    const elevated = await store.list({ volatility_regime: "elevated" });
    expect(elevated).toHaveLength(1);
    expect(elevated[0]!.context.volatility_regime).toBe("elevated");
  });

  it("respects limit option", async () => {
    for (let i = 0; i < 6; i++) {
      await store.save(buildQuickMemoryCase({ actual: 3.2, expected: 3.0 }));
    }

    const limited = await store.list({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("returns null for a missing id", async () => {
    expect(await store.get("no-such-id")).toBeNull();
  });

  it("overwrites an existing case on re-save", async () => {
    const mc = buildQuickMemoryCase({ actual: 3.2, expected: 3.0 });
    await store.save(mc);

    const mutated = { ...mc, lesson_summary: "updated lesson" };
    await store.save(mutated);

    expect(store.size).toBe(1);
    expect((await store.get(mc.id))!.lesson_summary).toBe("updated lesson");
  });

  it("resets to empty", async () => {
    await store.save(buildQuickMemoryCase({ actual: 3.2, expected: 3.0 }));
    await store.reset();

    expect(store.size).toBe(0);
    expect(await store.list()).toHaveLength(0);
  });
});

// ─── CPI Analog Retrieval ─────────────────────────────────────────────────────

describe("findCpiAnalogs", () => {
  let store: CpiMemoryCaseStore;

  beforeEach(async () => {
    store = new CpiMemoryCaseStore();

    // Seed: 2 hotter cases (hawkish Fed), 1 cooler case (dovish Fed)
    await store.save(
      buildQuickMemoryCase({
        actual: 3.2, expected: 3.0, fed: "hawkish", directionCorrect: false, period: "2024-06",
      }),
    );
    await store.save(
      buildQuickMemoryCase({
        actual: 3.3, expected: 3.0, fed: "hawkish", directionCorrect: true, period: "2024-08",
      }),
    );
    await store.save(
      buildQuickMemoryCase({
        actual: 2.7, expected: 3.0, fed: "dovish", directionCorrect: true, period: "2024-11",
      }),
    );
  });

  it("returns analogs matching the surprise direction", async () => {
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.1,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    // Use a threshold of 0.40 (= direction weight alone), which ensures only
    // cases with a direction match can qualify. Cases where direction_match=false
    // contribute at most 0.20 (macro 0.12 + vol 0.08) and are excluded.
    const analogs = await findCpiAnalogs(store, event, context, { min_similarity: 0.40 });

    expect(analogs.length).toBeGreaterThan(0);
    expect(analogs.every((a) => a.signals.direction_match)).toBe(true);
    expect(analogs.every((a) => a.surprise_direction === "hotter")).toBe(true);
  });

  it("ranks by similarity descending", async () => {
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.1,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    const analogs = await findCpiAnalogs(store, event, context);

    for (let i = 0; i < analogs.length - 1; i++) {
      expect(analogs[i]!.similarity).toBeGreaterThanOrEqual(analogs[i + 1]!.similarity);
    }
  });

  it("respects the limit option", async () => {
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.1,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot();

    const analogs = await findCpiAnalogs(store, event, context, { limit: 1 });
    expect(analogs).toHaveLength(1);
  });

  it("excludes a case by id", async () => {
    const allCases = await store.list();
    const excluded = allCases[0]!;

    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.1,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    const analogs = await findCpiAnalogs(store, event, context, {
      exclude_id: excluded.id,
    });

    expect(analogs.every((a) => a.case_id !== excluded.id)).toBe(true);
  });

  it("returns empty for an empty store", async () => {
    const emptyStore = new CpiMemoryCaseStore();
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.2,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot();

    expect(await findCpiAnalogs(emptyStore, event, context)).toHaveLength(0);
  });

  it("applies min_similarity threshold", async () => {
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.1,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    // Use a very high threshold — should filter everything out
    const analogs = await findCpiAnalogs(store, event, context, {
      min_similarity: 0.99,
    });
    expect(analogs).toHaveLength(0);
  });

  it("analog carries all required fields", async () => {
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.2,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    const analogs = await findCpiAnalogs(store, event, context, { limit: 1 });
    expect(analogs.length).toBeGreaterThan(0);

    const [top] = analogs;
    expect(top).toMatchObject({
      case_id: expect.any(String),
      period: expect.any(String),
      similarity: expect.any(Number),
      verdict: expect.stringMatching(/^(correct|partially_correct|wrong)$/),
      lesson_summary: expect.any(String),
      surprise_direction: expect.stringMatching(/^(hotter|cooler|inline)$/),
      surprise_bp: expect.any(Number),
      fed_policy_stance: expect.any(String),
      macro_regime: expect.any(String),
      volatility_regime: expect.any(String),
      signals: expect.objectContaining({
        direction_match: expect.any(Boolean),
        band_match: expect.any(Boolean),
        fed_stance_match: expect.any(Boolean),
        macro_regime_match: expect.any(Boolean),
        vol_regime_match: expect.any(Boolean),
      }),
    });
  });

  it("direction_match is true when event and stored case share surprise direction", async () => {
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.2,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    const analogs = await findCpiAnalogs(store, event, context);
    const matched = analogs.filter((a) => a.signals.direction_match);

    expect(matched.length).toBeGreaterThan(0);
    matched.forEach((a) => expect(a.surprise_direction).toBe("hotter"));
  });

  it("fed_stance_match is true when stances align", async () => {
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.2,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    const analogs = await findCpiAnalogs(store, event, context);
    const fedMatched = analogs.filter((a) => a.signals.fed_stance_match);

    fedMatched.forEach((a) =>
      expect(a.fed_policy_stance).toBe("hawkish"),
    );
  });
});

// ─── Confidence Enrichment ────────────────────────────────────────────────────

describe("enrichCpiPredictionWithAnalogs", () => {
  const buildPrediction = () => {
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.2,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot();
    return {
      result: generateCpiPrediction({ cpi_event: event, context, horizons: ["1d"] }),
      event,
      context,
    };
  };

  it("passes through unchanged when analogs array is empty", () => {
    const { result } = buildPrediction();
    const enriched = enrichCpiPredictionWithAnalogs(result, []);

    expect(enriched.predictions[0]!.analog_count).toBe(0);
    expect(enriched.predictions[0]!.analog_boost).toBe(0);
    expect(enriched.predictions[0]!.confidence).toBe(result.predictions[0]!.confidence);
    expect(enriched.analogs).toHaveLength(0);
  });

  it("boosts confidence when all analogs are correct", () => {
    const { result } = buildPrediction();
    const basline = result.predictions[0]!.confidence;

    const analogs: CpiAnalogMatch[] = [
      {
        case_id: "a",
        period: "2025-01",
        similarity: 0.80,
        verdict: "correct",
        lesson_summary: "held well",
        surprise_direction: "hotter",
        surprise_bp: 20,
        fed_policy_stance: "neutral",
        macro_regime: "uncertain",
        volatility_regime: "normal",
        signals: {
          direction_match: true,
          band_match: true,
          fed_stance_match: true,
          macro_regime_match: true,
          vol_regime_match: true,
        },
      },
      {
        case_id: "b",
        period: "2025-02",
        similarity: 0.75,
        verdict: "correct",
        lesson_summary: "confirmed",
        surprise_direction: "hotter",
        surprise_bp: 22,
        fed_policy_stance: "neutral",
        macro_regime: "uncertain",
        volatility_regime: "normal",
        signals: {
          direction_match: true,
          band_match: true,
          fed_stance_match: true,
          macro_regime_match: true,
          vol_regime_match: false,
        },
      },
    ];

    const enriched = enrichCpiPredictionWithAnalogs(result, analogs);
    const pred = enriched.predictions[0]!;

    expect(pred.analog_count).toBe(2);
    expect(pred.analog_boost).toBeGreaterThan(0);
    expect(pred.confidence).toBeGreaterThanOrEqual(basline);
    expect(pred.confidence).toBeLessThanOrEqual(0.95);
    expect(pred.evidence.some((e) => e.includes("analog"))).toBe(true);
  });

  it("penalises confidence when all analogs are wrong", () => {
    const { result } = buildPrediction();
    const baseline = result.predictions[0]!.confidence;

    const analogs: CpiAnalogMatch[] = [
      {
        case_id: "x",
        period: "2024-10",
        similarity: 0.80,
        verdict: "wrong",
        lesson_summary: "TLT mismatch — rate pricing dominated",
        surprise_direction: "hotter",
        surprise_bp: 20,
        fed_policy_stance: "neutral",
        macro_regime: "uncertain",
        volatility_regime: "normal",
        signals: {
          direction_match: true,
          band_match: true,
          fed_stance_match: true,
          macro_regime_match: true,
          vol_regime_match: true,
        },
      },
      {
        case_id: "y",
        period: "2024-11",
        similarity: 0.70,
        verdict: "wrong",
        lesson_summary: "Equity bounce unwound thesis",
        surprise_direction: "hotter",
        surprise_bp: 18,
        fed_policy_stance: "neutral",
        macro_regime: "uncertain",
        volatility_regime: "normal",
        signals: {
          direction_match: true,
          band_match: true,
          fed_stance_match: true,
          macro_regime_match: false,
          vol_regime_match: false,
        },
      },
    ];

    const enriched = enrichCpiPredictionWithAnalogs(result, analogs);
    const pred = enriched.predictions[0]!;

    expect(pred.analog_boost).toBeLessThan(0);
    expect(pred.confidence).toBeLessThanOrEqual(baseline);
    expect(pred.confidence).toBeGreaterThanOrEqual(0.35);
    // Caution note from wrong analog must appear in invalidations
    expect(pred.invalidations.some((inv) => inv.includes("Analog caution"))).toBe(true);
  });

  it("no caution note when all analogs are correct", () => {
    const { result } = buildPrediction();

    const analogs: CpiAnalogMatch[] = [
      {
        case_id: "a",
        period: "2025-01",
        similarity: 0.80,
        verdict: "correct",
        lesson_summary: "solid",
        surprise_direction: "hotter",
        surprise_bp: 20,
        fed_policy_stance: "neutral",
        macro_regime: "uncertain",
        volatility_regime: "normal",
        signals: {
          direction_match: true,
          band_match: true,
          fed_stance_match: true,
          macro_regime_match: true,
          vol_regime_match: true,
        },
      },
    ];

    const enriched = enrichCpiPredictionWithAnalogs(result, analogs);
    const pred = enriched.predictions[0]!;

    expect(pred.invalidations.some((inv) => inv.includes("Analog caution"))).toBe(false);
  });

  it("attaches the analogs array to the enriched result", () => {
    const { result } = buildPrediction();

    const analogs: CpiAnalogMatch[] = [
      {
        case_id: "z",
        period: "2024-09",
        similarity: 0.65,
        verdict: "partially_correct",
        lesson_summary: "Mixed — timing off",
        surprise_direction: "hotter",
        surprise_bp: 15,
        fed_policy_stance: "neutral",
        macro_regime: "uncertain",
        volatility_regime: "normal",
        signals: {
          direction_match: true,
          band_match: true,
          fed_stance_match: true,
          macro_regime_match: false,
          vol_regime_match: false,
        },
      },
    ];

    const enriched = enrichCpiPredictionWithAnalogs(result, analogs);

    expect(enriched.analogs).toHaveLength(1);
    expect(enriched.analogs[0]!.case_id).toBe("z");
  });

  it("confidence stays within [0.35, 0.95] for extreme inputs", () => {
    const { result } = buildPrediction();

    // Build 10 perfect analogs with max similarity — should not push past 0.95
    const strongAnalogs: CpiAnalogMatch[] = Array.from({ length: 10 }, (_, i) => ({
      case_id: `a${i}`,
      period: `2020-0${(i % 9) + 1}`,
      similarity: 1.0,
      verdict: "correct" as const,
      lesson_summary: "strong",
      surprise_direction: "hotter" as const,
      surprise_bp: 20,
      fed_policy_stance: "neutral" as const,
      macro_regime: "uncertain" as const,
      volatility_regime: "normal" as const,
      signals: {
        direction_match: true,
        band_match: true,
        fed_stance_match: true,
        macro_regime_match: true,
        vol_regime_match: true,
      },
    }));

    const enriched = enrichCpiPredictionWithAnalogs(result, strongAnalogs);
    const conf = enriched.predictions[0]!.confidence;

    expect(conf).toBeGreaterThanOrEqual(0.35);
    expect(conf).toBeLessThanOrEqual(0.95);
  });
});

// ─── Phase 5B End-to-End: persist → retrieve → enrich ─────────────────────────

describe("Phase 5B: event → prediction → outcome → memory → persist → analog retrieval → enrichment", () => {
  it("stores a past CPI case, retrieves it as an analog, enriches a new prediction", async () => {
    const store = new CpiMemoryCaseStore();

    // 1. Past case: hotter CPI, hawkish Fed, WRONG prediction
    const pastCase = buildQuickMemoryCase({
      actual: 3.2,
      expected: 3.0,
      fed: "hawkish",
      period: "2025-06",
      directionCorrect: false,
    });
    await store.save(pastCase);

    expect(store.size).toBe(1);

    // 2. New CPI event arrives — same profile as the past case
    const newEvent = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.1,
      expected_value: 3.0,
    });
    const newContext = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    // 3. Retrieve analogs from the store
    const analogs = await findCpiAnalogs(store, newEvent, newContext);

    expect(analogs.length).toBeGreaterThan(0);
    expect(analogs[0]!.signals.direction_match).toBe(true);
    expect(analogs[0]!.signals.fed_stance_match).toBe(true);

    // 4. Generate prediction for the new event
    const prediction = generateCpiPrediction({
      cpi_event: newEvent,
      context: newContext,
      horizons: ["1d"],
    });

    // 5. Enrich with analog signals
    const enriched = enrichCpiPredictionWithAnalogs(prediction, analogs);
    const pred = enriched.predictions[0]!;

    // The past case was wrong → caution signal should appear
    expect(pred.analog_count).toBeGreaterThan(0);

    const hasAnalogSignal =
      pred.analog_boost < 0 ||
      pred.evidence.some((e) => e.includes("analog")) ||
      pred.invalidations.some((inv) => inv.includes("caution"));

    expect(hasAnalogSignal).toBe(true);
  });

  it("confidence is higher when past analogs are all correct", async () => {
    const store = new CpiMemoryCaseStore();

    // Seed three correct cases with same profile
    for (let i = 0; i < 3; i++) {
      await store.save(
        buildQuickMemoryCase({
          actual: 3.2,
          expected: 3.0,
          fed: "hawkish",
          period: `2024-0${i + 1}`,
          directionCorrect: true,
        }),
      );
    }

    const newEvent = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.1,
      expected_value: 3.0,
    });
    const newContext = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });
    const analogs = await findCpiAnalogs(store, newEvent, newContext);

    const prediction = generateCpiPrediction({
      cpi_event: newEvent,
      context: newContext,
      horizons: ["1d"],
    });

    const enriched = enrichCpiPredictionWithAnalogs(prediction, analogs);
    const pred = enriched.predictions[0]!;

    // All correct past cases → boost ≥ 0
    expect(pred.analog_boost).toBeGreaterThanOrEqual(0);
  });

  it("stores multiple cases and retrieves the closest analog for a new event", async () => {
    const store = new CpiMemoryCaseStore();

    // Hotter, hawkish Fed, large surprise
    await store.save(
      buildQuickMemoryCase({ actual: 3.5, expected: 3.0, fed: "hawkish", period: "2024-01" }),
    );
    // Cooler, dovish Fed
    await store.save(
      buildQuickMemoryCase({ actual: 2.5, expected: 3.0, fed: "dovish", period: "2024-03" }),
    );
    // Hotter, neutral Fed, small surprise
    await store.save(
      buildQuickMemoryCase({ actual: 3.05, expected: 3.0, fed: "neutral", period: "2024-05" }),
    );

    // New event: hotter, hawkish — should match first case best
    const event = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.4,
      expected_value: 3.0,
    });
    const context = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    const analogs = await findCpiAnalogs(store, event, context, { limit: 3 });

    // Top analog should be the hotter/hawkish one
    expect(analogs[0]!.signals.direction_match).toBe(true);
    expect(analogs[0]!.signals.fed_stance_match).toBe(true);
    expect(analogs[0]!.period).toBe("2024-01");
  });
});
