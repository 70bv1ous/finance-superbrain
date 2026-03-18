import { describe, expect, it } from "vitest";

import { buildCpiEvent } from "./events/cpiEvent.js";
import { buildMarketContextSnapshot } from "./context/marketContext.js";
import { generateCpiPrediction } from "./prediction/cpiPrediction.js";
import { trackCpiOutcome } from "./outcome/outcomeTracker.js";
import { buildCpiMemoryCase } from "./memory/memoryCaseBuilder.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const hotterCpiRelease = {
  released_at: "2026-03-12T12:30:00Z",
  period: "2026-02",
  actual_value: 3.2,
  expected_value: 3.0,
  prior_value: 3.1,
};

const coolerCpiRelease = {
  released_at: "2026-03-12T12:30:00Z",
  period: "2026-02",
  actual_value: 2.8,
  expected_value: 3.0,
  prior_value: 3.1,
};

const inlineCpiRelease = {
  released_at: "2026-03-12T12:30:00Z",
  period: "2026-02",
  actual_value: 3.0,
  expected_value: 3.0,
  prior_value: 3.0,
};

// ─── CPI Event Abstraction ────────────────────────────────────────────────────

describe("buildCpiEvent", () => {
  it("classifies a hotter-than-expected CPI correctly", () => {
    const event = buildCpiEvent(hotterCpiRelease);

    expect(event.surprise_direction).toBe("hotter");
    expect(event.surprise_magnitude).toBeCloseTo(0.2, 4);
    expect(event.surprise_bp).toBe(20);
    expect(event.parsed_event.themes).toContain("inflation");
    expect(event.parsed_event.sentiment).toBe("risk_off");
  });

  it("classifies a cooler-than-expected CPI correctly", () => {
    const event = buildCpiEvent(coolerCpiRelease);

    expect(event.surprise_direction).toBe("cooler");
    expect(event.surprise_magnitude).toBeCloseTo(-0.2, 4);
    expect(event.surprise_bp).toBe(-20);
    expect(event.parsed_event.themes).toContain("inflation");
    expect(event.parsed_event.sentiment).toBe("risk_on");
  });

  it("classifies an inline CPI correctly", () => {
    const event = buildCpiEvent(inlineCpiRelease);

    expect(event.surprise_direction).toBe("inline");
    expect(event.surprise_magnitude).toBe(0);
    expect(event.surprise_bp).toBe(0);
  });

  it("includes all required fields", () => {
    const event = buildCpiEvent(hotterCpiRelease);

    expect(event.id).toBeTruthy();
    expect(event.released_at).toBe(hotterCpiRelease.released_at);
    expect(event.period).toBe("2026-02");
    expect(event.actual_value).toBe(3.2);
    expect(event.expected_value).toBe(3.0);
    expect(event.prior_value).toBe(3.1);
    expect(event.parsed_event).toBeDefined();
  });
});

// ─── Market Context Snapshot ──────────────────────────────────────────────────

describe("buildMarketContextSnapshot", () => {
  it("builds a snapshot with defaults", () => {
    const ctx = buildMarketContextSnapshot();

    expect(ctx.volatility_regime).toBe("normal");
    expect(ctx.macro_regime).toBe("uncertain");
    expect(ctx.liquidity_sensitivity).toBe("normal");
    expect(ctx.fed_policy_stance).toBe("neutral");
    expect(ctx.notes).toEqual([]);
    expect(ctx.captured_at).toBeTruthy();
  });

  it("accepts partial overrides", () => {
    const ctx = buildMarketContextSnapshot({
      volatility_regime: "elevated",
      fed_policy_stance: "hawkish",
      notes: ["pre-FOMC positioning"],
    });

    expect(ctx.volatility_regime).toBe("elevated");
    expect(ctx.fed_policy_stance).toBe("hawkish");
    expect(ctx.macro_regime).toBe("uncertain");
    expect(ctx.notes).toContain("pre-FOMC positioning");
  });
});

// ─── CPI Prediction Generator ─────────────────────────────────────────────────

describe("generateCpiPrediction", () => {
  it("generates a structured prediction for a hotter CPI", () => {
    const event = buildCpiEvent(hotterCpiRelease);
    const context = buildMarketContextSnapshot({ fed_policy_stance: "neutral" });

    const result = generateCpiPrediction({
      cpi_event: event,
      context,
      horizons: ["1d"],
    });

    expect(result.predictions).toHaveLength(1);
    const [pred] = result.predictions;
    expect(pred.horizon).toBe("1d");
    expect(pred.confidence).toBeGreaterThan(0);
    expect(pred.assets.length).toBeGreaterThan(0);
    expect(pred.thesis).toBeTruthy();
    expect(result.model_version).toBe("cpi-engine-v1");
  });

  it("generates predictions for multiple horizons", () => {
    const event = buildCpiEvent(hotterCpiRelease);
    const context = buildMarketContextSnapshot();

    const result = generateCpiPrediction({
      cpi_event: event,
      context,
      horizons: ["1h", "1d", "5d"],
    });

    expect(result.predictions).toHaveLength(3);
    expect(result.predictions.map((p) => p.horizon)).toEqual(["1h", "1d", "5d"]);
  });

  it("hotter CPI prediction includes QQQ as a downward asset", () => {
    // The inflation theme predicts TLT down, but the existing engine's risk_off
    // sentiment override flips TLT to "up" (flight-to-safety). QQQ is reliably
    // predicted "down" under both the inflation rule and the risk_off path.
    // This divergence (engine says TLT up, market sends TLT down) is the kind of
    // calibration mistake the memory case captures as a lesson.
    const event = buildCpiEvent(hotterCpiRelease);
    const context = buildMarketContextSnapshot();

    const result = generateCpiPrediction({
      cpi_event: event,
      context,
      horizons: ["1d"],
    });

    const [pred] = result.predictions;
    const qqq = pred.assets.find((a) => a.ticker === "QQQ");

    expect(qqq).toBeDefined();
    expect(qqq!.expected_direction).toBe("down");
  });
});

// ─── Outcome Tracker ──────────────────────────────────────────────────────────

describe("trackCpiOutcome", () => {
  it("correctly scores a prediction where engine calls matched market moves", () => {
    // For hotter CPI with risk_off, the engine predicts:
    //   TLT → up (risk_off flight-to-safety override), QQQ → down, DXY → up
    // We give realized moves that match those predictions.
    const event = buildCpiEvent(hotterCpiRelease);
    const context = buildMarketContextSnapshot();

    const prediction_result = generateCpiPrediction({
      cpi_event: event,
      context,
      horizons: ["1d"],
    });

    const outcome_result = trackCpiOutcome({
      prediction_result,
      realized_moves: [
        { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 45 },
        { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -85 },
        { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 30 },
      ],
      measured_at: "2026-03-13T20:00:00Z",
      timing_alignment: 0.8,
    });

    expect(outcome_result.tracked).toHaveLength(1);
    const [tracked] = outcome_result.tracked;
    expect(tracked.horizon).toBe("1d");
    expect(tracked.direction_correct).toBe(true);
    expect(tracked.outcome.direction_score).toBeGreaterThan(0.5);
    expect(outcome_result.overall_correct).toBe(true);
  });

  it("marks outcome as incorrect when realized moves oppose engine predictions", () => {
    // Realized moves that are opposite to engine predictions → direction_correct = false.
    // This is the realistic CPI case where the engine's TLT-up call is wrong
    // (hot CPI actually sends TLT down via higher rate pricing).
    const event = buildCpiEvent(hotterCpiRelease);
    const context = buildMarketContextSnapshot();

    const prediction_result = generateCpiPrediction({
      cpi_event: event,
      context,
      horizons: ["1d"],
    });

    const outcome_result = trackCpiOutcome({
      prediction_result,
      realized_moves: [
        { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -55 },
        { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 40 },
        { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -25 },
      ],
      measured_at: "2026-03-13T20:00:00Z",
      timing_alignment: 0.5,
    });

    const [tracked] = outcome_result.tracked;
    expect(tracked.direction_correct).toBe(false);
  });
});

// ─── Memory Case Builder ──────────────────────────────────────────────────────

describe("buildCpiMemoryCase", () => {
  it("builds a complete memory case combining all loop stages", () => {
    const event = buildCpiEvent(hotterCpiRelease);
    const context = buildMarketContextSnapshot({
      fed_policy_stance: "neutral",
      macro_regime: "risk_off",
    });

    const prediction_result = generateCpiPrediction({
      cpi_event: event,
      context,
      horizons: ["1d"],
    });

    const outcome_result = trackCpiOutcome({
      prediction_result,
      realized_moves: [
        { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 45 },
        { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -90 },
        { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 35 },
      ],
      measured_at: "2026-03-13T20:00:00Z",
      timing_alignment: 0.85,
    });

    const memoryCase = buildCpiMemoryCase({ prediction_result, outcome_result });

    // Structural completeness
    expect(memoryCase.id).toBeTruthy();
    expect(memoryCase.event_family).toBe("cpi");
    expect(memoryCase.period).toBe("2026-02");
    expect(memoryCase.cpi_event.surprise_direction).toBe("hotter");
    expect(memoryCase.context.fed_policy_stance).toBe("neutral");
    expect(memoryCase.prediction_result.predictions).toHaveLength(1);
    expect(memoryCase.tracked_outcomes).toHaveLength(1);

    // Postmortem and lesson generated
    expect(memoryCase.postmortems).toHaveLength(1);
    expect(memoryCase.lessons).toHaveLength(1);
    expect(memoryCase.postmortems[0]!.verdict).toBeTruthy();
    expect(memoryCase.lessons[0]!.lesson_summary).toBeTruthy();

    // Overall verdict and lesson
    expect(["correct", "partially_correct", "wrong"]).toContain(memoryCase.verdict);
    expect(memoryCase.lesson_summary).toBeTruthy();
    expect(memoryCase.created_at).toBeTruthy();
  });

  it("builds a memory case for a cooler CPI event with the full loop", () => {
    const event = buildCpiEvent(coolerCpiRelease);
    const context = buildMarketContextSnapshot({ fed_policy_stance: "hawkish" });

    const prediction_result = generateCpiPrediction({
      cpi_event: event,
      context,
      horizons: ["1d", "5d"],
    });

    const outcome_result = trackCpiOutcome({
      prediction_result,
      realized_moves: [
        { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 50 },
        { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 80 },
        { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -30 },
        { ticker: "GLD", realized_direction: "up", realized_magnitude_bp: 20 },
      ],
      measured_at: "2026-03-13T20:00:00Z",
      timing_alignment: 0.9,
    });

    const memoryCase = buildCpiMemoryCase({ prediction_result, outcome_result });

    expect(memoryCase.prediction_result.predictions).toHaveLength(2);
    expect(memoryCase.postmortems).toHaveLength(2);
    expect(memoryCase.lessons).toHaveLength(2);
    expect(memoryCase.tracked_outcomes).toHaveLength(2);
  });
});

// ─── End-to-end CPI Intelligence Loop ─────────────────────────────────────────

describe("CPI intelligence loop (end-to-end)", () => {
  it("runs the complete loop: event → prediction → outcome → memory case", () => {
    // Step 1: CPI event enters the system
    const cpiEvent = buildCpiEvent({
      released_at: "2026-03-12T12:30:00Z",
      period: "2026-02",
      actual_value: 3.3,
      expected_value: 3.0,
      prior_value: 3.1,
    });

    expect(cpiEvent.surprise_direction).toBe("hotter");
    expect(cpiEvent.surprise_bp).toBe(30);

    // Step 2: Market context at time of release
    const context = buildMarketContextSnapshot({
      volatility_regime: "normal",
      macro_regime: "uncertain",
      fed_policy_stance: "neutral",
      notes: ["FOMC meeting in 2 weeks"],
    });

    // Step 3: Structured prediction produced
    const prediction_result = generateCpiPrediction({
      cpi_event: cpiEvent,
      context,
      horizons: ["1d"],
    });

    expect(prediction_result.predictions[0]!.assets.length).toBeGreaterThan(0);

    // Step 4: Outcome measured after 1 day
    const outcome_result = trackCpiOutcome({
      prediction_result,
      realized_moves: [
        { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -65 },
        { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -95 },
        { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 38 },
        { ticker: "GLD", realized_direction: "up", realized_magnitude_bp: 15 },
      ],
      measured_at: "2026-03-13T20:00:00Z",
      timing_alignment: 0.85,
    });

    // Step 5: Memory case stored
    const memoryCase = buildCpiMemoryCase({ prediction_result, outcome_result });

    // Validate the complete memory case
    expect(memoryCase.event_family).toBe("cpi");
    expect(memoryCase.cpi_event.period).toBe("2026-02");
    expect(memoryCase.cpi_event.surprise_direction).toBe("hotter");
    expect(memoryCase.context.fed_policy_stance).toBe("neutral");
    expect(memoryCase.postmortems[0]).toBeDefined();
    expect(memoryCase.lessons[0]).toBeDefined();
    expect(memoryCase.lesson_summary.length).toBeGreaterThan(10);

    // This is the system's first learning example
    const lesson = memoryCase.lessons[0]!;
    expect(["mistake", "reinforcement"]).toContain(lesson.lesson_type);
    expect(lesson.metadata["verdict"]).toBeTruthy();
  });
});
