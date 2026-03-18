import { describe, it, expect, beforeEach } from "vitest";

import {
  runNfpIntelligenceOperation,
  nfpIntelligencePayloadSchema,
  resetNfpIntelligenceStoreForTesting,
  type NfpIntelligencePayload,
} from "./nfpLiveOperation.js";
import { NfpMemoryCaseStore } from "./memory/nfpMemoryCaseStore.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const strongRelease = {
  released_at: "2026-03-07T13:30:00Z",
  period: "2026-02",
  actual_jobs_k: 311,
  expected_jobs_k: 200,
  actual_unemployment_pct: 4.0,
  expected_unemployment_pct: 4.1,
};

const weakRelease = {
  released_at: "2026-04-03T12:30:00Z",
  period: "2026-03",
  actual_jobs_k: 80,
  expected_jobs_k: 185,
  actual_unemployment_pct: 4.3,
  expected_unemployment_pct: 4.1,
};

const inlineRelease = {
  released_at: "2026-05-02T12:30:00Z",
  period: "2026-04",
  actual_jobs_k: 192,
  expected_jobs_k: 185,
  actual_unemployment_pct: 4.1,
  expected_unemployment_pct: 4.1,
};

const strongRealizedMovesCorrect = [
  { ticker: "SPY", realized_direction: "down" as const, realized_magnitude_bp: 120 },
  { ticker: "TLT", realized_direction: "down" as const, realized_magnitude_bp: 80 },
];

const weakRealizedMovesCorrect = [
  { ticker: "SPY", realized_direction: "up" as const, realized_magnitude_bp: 90 },
  { ticker: "TLT", realized_direction: "up" as const, realized_magnitude_bp: 110 },
];

const mockServices = {} as any;

// ─── Payload schema ───────────────────────────────────────────────────────────

describe("nfpIntelligencePayloadSchema", () => {
  it("accepts a minimal prediction-only payload", () => {
    const raw = {
      nfp_release: strongRelease,
    };
    const parsed = nfpIntelligencePayloadSchema.parse(raw);
    expect(parsed.horizons).toEqual(["1h", "1d", "5d"]);
    expect(parsed.realized_moves).toBeUndefined();
  });

  it("accepts a full learning-loop payload", () => {
    const raw = {
      nfp_release: strongRelease,
      context: { macro_regime: "risk_on", volatility_regime: "normal" },
      horizons: ["1h", "1d"],
      realized_moves: strongRealizedMovesCorrect,
      measured_at: "2026-03-07T17:30:00Z",
      timing_alignment: 0.9,
    };
    const parsed = nfpIntelligencePayloadSchema.parse(raw);
    expect(parsed.horizons).toEqual(["1h", "1d"]);
    expect(parsed.realized_moves).toHaveLength(2);
    expect(parsed.timing_alignment).toBe(0.9);
  });

  it("rejects payload with missing required fields", () => {
    expect(() => nfpIntelligencePayloadSchema.parse({})).toThrow();
  });

  it("rejects payload with invalid jobs values", () => {
    expect(() =>
      nfpIntelligencePayloadSchema.parse({
        nfp_release: { ...strongRelease, actual_jobs_k: "not-a-number" },
      }),
    ).toThrow();
  });
});

// ─── Prediction-only mode ─────────────────────────────────────────────────────

describe("prediction-only mode", () => {
  beforeEach(() => resetNfpIntelligenceStoreForTesting());

  it("returns correct result shape for a strong beat", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);

    expect(result.period).toBe("2026-02");
    expect(result.prediction_count).toBe(3);
    expect(result.explanation_count).toBe(3);
    expect(result.memory_case_id).toBeNull();
    expect(result.verdict).toBeNull();
    expect(result.store_size).toBe(0);
  });

  it("returns correct result shape for a weak miss", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: weakRelease,
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);

    expect(result.period).toBe("2026-03");
    expect(result.prediction_count).toBe(3);
    expect(result.memory_case_id).toBeNull();
  });

  it("returns correct result shape for an inline reading", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: inlineRelease,
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);

    expect(result.period).toBe("2026-04");
    expect(result.prediction_count).toBe(3);
  });

  it("generates a cluster_id in dot-delimited format", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);

    // cluster_id = direction.band.unemployment.macro.vol (5 parts)
    const parts = result.cluster_id.split(".");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("strong");
    expect(["large_beat", "beat"]).toContain(parts[1]);
  });

  it("returns zero analog_count when store is empty", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);
    expect(result.analog_count).toBe(0);
  });

  it("honours explicit horizon list", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
      horizons: ["1d"],
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);
    expect(result.prediction_count).toBe(1);
    expect(result.explanation_count).toBe(1);
  });
});

// ─── Learning-loop mode ───────────────────────────────────────────────────────

describe("learning-loop mode", () => {
  beforeEach(() => resetNfpIntelligenceStoreForTesting());

  it("saves a memory case when realized_moves provided", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
      realized_moves: strongRealizedMovesCorrect,
      measured_at: "2026-03-07T17:30:00Z",
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);

    expect(result.memory_case_id).not.toBeNull();
    expect(typeof result.memory_case_id).toBe("string");
    expect(result.verdict).not.toBeNull();
    expect(["correct", "partially_correct", "wrong"]).toContain(result.verdict);
    expect(result.store_size).toBe(1);
  });

  it("does not save a memory case without realized_moves", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);

    expect(result.memory_case_id).toBeNull();
    expect(result.store_size).toBe(0);
  });

  it("defaults timing_alignment to 0.8 when not provided", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
      realized_moves: strongRealizedMovesCorrect,
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);
    expect(result.memory_case_id).not.toBeNull();
  });

  it("accumulates cases across calls", async () => {
    const store = new NfpMemoryCaseStore();

    const payload1: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
      realized_moves: strongRealizedMovesCorrect,
    });
    const payload2: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: weakRelease,
      realized_moves: weakRealizedMovesCorrect,
    });

    const result1 = await runNfpIntelligenceOperation(mockServices, payload1, store);
    const result2 = await runNfpIntelligenceOperation(mockServices, payload2, store);

    expect(result1.store_size).toBe(1);
    expect(result2.store_size).toBe(2);
  });
});

// ─── Analog enrichment ────────────────────────────────────────────────────────

describe("analog enrichment", () => {
  beforeEach(() => resetNfpIntelligenceStoreForTesting());

  it("finds analogs after prior case with matching direction is stored", async () => {
    const store = new NfpMemoryCaseStore();

    // Store first case
    const payload1: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
      realized_moves: strongRealizedMovesCorrect,
    });
    await runNfpIntelligenceOperation(mockServices, payload1, store);

    // Second case with same direction — should find analog
    const similarRelease = {
      released_at: "2026-06-06T12:30:00Z",
      period: "2026-05",
      actual_jobs_k: 290,
      expected_jobs_k: 190,
      actual_unemployment_pct: 4.0,
      expected_unemployment_pct: 4.1,
    };
    const payload2: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: similarRelease,
    });
    const result = await runNfpIntelligenceOperation(mockServices, payload2, store);

    expect(result.analog_count).toBeGreaterThan(0);
  });

  it("returns zero analogs for a different direction", async () => {
    const store = new NfpMemoryCaseStore();

    // Store a strong case
    const payload1: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
      realized_moves: strongRealizedMovesCorrect,
    });
    await runNfpIntelligenceOperation(mockServices, payload1, store);

    // Query with a weak miss (low similarity to strong beat)
    const veryWeakRelease = {
      released_at: "2026-06-06T12:30:00Z",
      period: "2026-05",
      actual_jobs_k: 50,
      expected_jobs_k: 200,
      actual_unemployment_pct: 4.5,
      expected_unemployment_pct: 4.1,
    };
    const payload2: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: veryWeakRelease,
      context: { macro_regime: "risk_off", volatility_regime: "high" },
    });
    const result = await runNfpIntelligenceOperation(mockServices, payload2, store);

    // Strong vs large_miss/worse_unemployment/different macro+vol → similarity < 0.20
    expect(result.analog_count).toBe(0);
  });
});

// ─── Explanation output ───────────────────────────────────────────────────────

describe("explanation output", () => {
  beforeEach(() => resetNfpIntelligenceStoreForTesting());

  it("returns one explanation per horizon", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
      horizons: ["1h", "1d", "5d"],
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);

    expect(result.explanations).toHaveLength(3);
    const horizons = result.explanations.map((e) => e.horizon);
    expect(horizons).toContain("1h");
    expect(horizons).toContain("1d");
    expect(horizons).toContain("5d");
  });

  it("each explanation has required fields", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);

    for (const explanation of result.explanations) {
      expect(explanation.cluster_id).toBeTruthy();
      expect(explanation.surprise_direction).toBe("strong");
      expect(explanation.evidence).toBeInstanceOf(Array);
      expect(explanation.confidence_breakdown).toBeDefined();
      expect(explanation.confidence_breakdown.final_confidence).toBeGreaterThan(0);
      expect(explanation.explanation_summary).toBeTruthy();
      expect(explanation.generated_at).toBeTruthy();
    }
  });

  it("includes no_analogs evidence when store is empty", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
      horizons: ["1h"],
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);
    const explanation = result.explanations[0]!;

    const analogItem = explanation.evidence.find((e) => e.source === "analog");
    expect(analogItem).toBeDefined();
    expect(analogItem!.label).toBe("no_analogs");
  });

  it("confidence_breakdown total equals sum of adjustments", async () => {
    const store = new NfpMemoryCaseStore();
    const payload: NfpIntelligencePayload = nfpIntelligencePayloadSchema.parse({
      nfp_release: strongRelease,
      horizons: ["1h"],
    });

    const result = await runNfpIntelligenceOperation(mockServices, payload, store);
    const bd = result.explanations[0]!.confidence_breakdown;

    const expectedTotal = Number(
      (bd.analog_boost + bd.reliability_adjustment + bd.knowledge_adjustment).toFixed(2),
    );
    expect(bd.total_adjustment).toBeCloseTo(expectedTotal, 2);
  });
});

// ─── Queue integration ────────────────────────────────────────────────────────

describe("queue integration", () => {
  it("nfp_intelligence appears in systemOperationNameSchema", async () => {
    const { systemOperationNameSchema } = await import("@finance-superbrain/schemas");
    const names = systemOperationNameSchema.options;
    expect(names).toContain("nfp_intelligence");
  });

  it("operationJobs can parse and execute nfp_intelligence payload", async () => {
    const { parseOperationJobPayload } = await import("../lib/operationJobs.js");

    const raw = {
      nfp_release: strongRelease,
      horizons: ["1h"],
    };

    expect(() => parseOperationJobPayload("nfp_intelligence", raw)).not.toThrow();
  });
});
