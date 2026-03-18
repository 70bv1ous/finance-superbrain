import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FomcMemoryCaseStore } from "./memory/fomcMemoryCaseStore.js";
import {
  fomcIntelligencePayloadSchema,
  resetFomcIntelligenceStoreForTesting,
  runFomcIntelligenceOperation,
  type FomcIntelligencePayload,
} from "./fomcLiveOperation.js";
import { InMemoryRepository } from "../lib/InMemoryRepository.js";
import { drainOperationJobs, enqueueOperationJobRequest } from "../lib/operationJobs.js";
import { LocalEmbeddingProvider } from "../lib/LocalEmbeddingProvider.js";
import { MockMarketDataProvider } from "../lib/MockMarketDataProvider.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const hawkishDecision = {
  released_at: "2026-03-19T18:00:00Z",
  period: "2026-03",
  actual_rate: 4.75,
  expected_rate: 4.50,
  prior_rate: 4.50,
  decision_type: "hike" as const,
  guidance_tone: "hawkish" as const,
};

const dovishDecision = {
  released_at: "2026-03-19T18:00:00Z",
  period: "2026-03",
  actual_rate: 4.25,
  expected_rate: 4.50,
  prior_rate: 4.50,
  decision_type: "cut" as const,
  guidance_tone: "dovish" as const,
};

const hawkishRealizedMovesCorrect = [
  { ticker: "TLT", realized_direction: "down" as const, realized_magnitude_bp: -60 },
  { ticker: "QQQ", realized_direction: "down" as const, realized_magnitude_bp: -90 },
  { ticker: "DXY", realized_direction: "up" as const, realized_magnitude_bp: 40 },
];

const mockServices = {
  repository: new InMemoryRepository() as any,
  marketDataProvider: new MockMarketDataProvider() as any,
  embeddingProvider: new LocalEmbeddingProvider() as any,
};

const predictionOnlyPayload: FomcIntelligencePayload = {
  fomc_decision: hawkishDecision,
  context: undefined,
  horizons: ["1d"],
  realized_moves: undefined,
  measured_at: undefined,
  timing_alignment: undefined,
};

const learningLoopPayload: FomcIntelligencePayload = {
  fomc_decision: hawkishDecision,
  context: { macro_regime: "risk_off", volatility_regime: "elevated" },
  horizons: ["1h", "1d"],
  realized_moves: hawkishRealizedMovesCorrect,
  measured_at: "2026-03-20T20:00:00Z",
  timing_alignment: 0.85,
};

// ─── Payload schema ────────────────────────────────────────────────────────────

describe("fomcIntelligencePayloadSchema", () => {
  it("parses a minimal prediction-only payload", () => {
    const result = fomcIntelligencePayloadSchema.safeParse({
      fomc_decision: hawkishDecision,
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.horizons).toEqual(["1h", "1d", "5d"]);
      expect(result.data.realized_moves).toBeUndefined();
    }
  });

  it("parses a full learning-loop payload", () => {
    const result = fomcIntelligencePayloadSchema.safeParse({
      fomc_decision: hawkishDecision,
      context: { macro_regime: "risk_off" },
      horizons: ["1d"],
      realized_moves: hawkishRealizedMovesCorrect,
      measured_at: "2026-03-20T20:00:00Z",
      timing_alignment: 0.8,
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.realized_moves).toHaveLength(3);
      expect(result.data.timing_alignment).toBe(0.8);
    }
  });

  it("rejects timing_alignment outside [0, 1]", () => {
    const result = fomcIntelligencePayloadSchema.safeParse({
      fomc_decision: hawkishDecision,
      timing_alignment: 1.5,
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing fomc_decision", () => {
    const result = fomcIntelligencePayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid decision_type", () => {
    const result = fomcIntelligencePayloadSchema.safeParse({
      fomc_decision: { ...hawkishDecision, decision_type: "pause" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional prior_rate", () => {
    const result = fomcIntelligencePayloadSchema.safeParse({
      fomc_decision: {
        released_at: "2026-03-19T18:00:00Z",
        period: "2026-03",
        actual_rate: 4.75,
        expected_rate: 4.50,
        decision_type: "hike",
        guidance_tone: "hawkish",
        // no prior_rate
      },
    });

    expect(result.success).toBe(true);
  });
});

// ─── Prediction-only mode ─────────────────────────────────────────────────────

describe("runFomcIntelligenceOperation — prediction-only", () => {
  let store: FomcMemoryCaseStore;

  beforeEach(() => {
    resetFomcIntelligenceStoreForTesting();
    store = new FomcMemoryCaseStore();
  });

  afterEach(() => {
    resetFomcIntelligenceStoreForTesting();
  });

  it("returns the expected result shape", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    expect(result.period).toBe("2026-03");
    expect(typeof result.cluster_id).toBe("string");
    expect(result.cluster_id.length).toBeGreaterThan(0);
    expect(result.analog_count).toBe(0); // empty store
    expect(result.prediction_count).toBe(1);
    expect(result.explanation_count).toBe(1);
    expect(result.memory_case_id).toBeNull();
    expect(result.verdict).toBeNull();
    expect(result.store_size).toBe(0);
    expect(Array.isArray(result.explanations)).toBe(true);
    expect(result.explanations).toHaveLength(1);
  });

  it("generates explanations for each horizon", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      { ...predictionOnlyPayload, horizons: ["1h", "1d", "5d"] },
      store,
    );

    expect(result.prediction_count).toBe(3);
    expect(result.explanation_count).toBe(3);
    expect(result.explanations.map((e) => e.horizon)).toEqual(["1h", "1d", "5d"]);
  });

  it("cluster_id encodes decision_type and guidance_tone", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    // Format: <direction>.<decision_type>.<guidance_tone>.<macro>.<vol>
    expect(result.cluster_id).toMatch(/^(hawkish|dovish|inline)\./);
    expect(result.cluster_id).toContain("hike");
    expect(result.cluster_id).toContain("hawkish");
  });

  it("cluster_id reflects context overrides", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      {
        ...predictionOnlyPayload,
        context: { macro_regime: "risk_off", volatility_regime: "elevated" },
      },
      store,
    );

    expect(result.cluster_id).toContain("risk_off");
    expect(result.cluster_id).toContain("elevated");
  });

  it("explanation contains all adjustment breakdown fields", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    const [explanation] = result.explanations;
    expect(explanation).toBeDefined();
    expect(typeof explanation!.confidence_breakdown.final_confidence).toBe("number");
    expect(typeof explanation!.confidence_breakdown.analog_boost).toBe("number");
    expect(typeof explanation!.confidence_breakdown.reliability_adjustment).toBe("number");
    expect(typeof explanation!.confidence_breakdown.knowledge_adjustment).toBe("number");
    expect(explanation!.explanation_summary.length).toBeGreaterThan(5);
  });

  it("does not mutate the store on prediction-only runs", async () => {
    await runFomcIntelligenceOperation(mockServices, predictionOnlyPayload, store);
    expect(store.size).toBe(0);
  });

  it("handles dovish FOMC decision correctly", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      {
        ...predictionOnlyPayload,
        fomc_decision: dovishDecision,
      },
      store,
    );

    expect(result.period).toBe("2026-03");
    expect(result.cluster_id).toContain("dovish");
    expect(result.memory_case_id).toBeNull();
  });
});

// ─── Learning loop mode ───────────────────────────────────────────────────────

describe("runFomcIntelligenceOperation — learning loop", () => {
  let store: FomcMemoryCaseStore;

  beforeEach(() => {
    resetFomcIntelligenceStoreForTesting();
    store = new FomcMemoryCaseStore();
  });

  afterEach(() => {
    resetFomcIntelligenceStoreForTesting();
  });

  it("creates and stores a memory case when realized_moves provided", async () => {
    expect(store.size).toBe(0);

    const result = await runFomcIntelligenceOperation(
      mockServices,
      learningLoopPayload,
      store,
    );

    expect(result.memory_case_id).not.toBeNull();
    expect(typeof result.memory_case_id).toBe("string");
    expect(result.verdict).toBeTruthy();
    expect(result.store_size).toBe(1);
  });

  it("persisted memory case is retrievable from the store", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      learningLoopPayload,
      store,
    );

    const storedCase = await store.get(result.memory_case_id!);
    expect(storedCase).not.toBeNull();
    expect(storedCase!.period).toBe("2026-03");
    expect(storedCase!.fomc_event.surprise_direction).toBe("hawkish");
    expect(storedCase!.event_family).toBe("fomc");
  });

  it("verdict is one of the valid outcome values", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      learningLoopPayload,
      store,
    );

    expect(["correct", "partially_correct", "wrong"]).toContain(result.verdict);
  });

  it("accumulates cases across successive runs with the same store", async () => {
    await runFomcIntelligenceOperation(mockServices, learningLoopPayload, store);
    await runFomcIntelligenceOperation(mockServices, {
      ...learningLoopPayload,
      fomc_decision: { ...hawkishDecision, period: "2026-04" },
    }, store);

    expect(store.size).toBe(2);
  });

  it("defaults timing_alignment to 0.8 when not provided", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      { ...learningLoopPayload, timing_alignment: undefined },
      store,
    );

    expect(result.verdict).toBeTruthy();
  });

  it("defaults measured_at to now when not provided", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      { ...learningLoopPayload, measured_at: undefined },
      store,
    );

    expect(result.memory_case_id).not.toBeNull();
  });
});

// ─── Analog enrichment grows with store ───────────────────────────────────────

describe("runFomcIntelligenceOperation — analog enrichment", () => {
  let store: FomcMemoryCaseStore;

  beforeEach(() => {
    resetFomcIntelligenceStoreForTesting();
    store = new FomcMemoryCaseStore();
  });

  afterEach(() => {
    resetFomcIntelligenceStoreForTesting();
  });

  it("analog_count is 0 for an empty store", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    expect(result.analog_count).toBe(0);
  });

  it("analog_count grows as the store is populated", async () => {
    for (let i = 0; i < 3; i++) {
      await runFomcIntelligenceOperation(mockServices, {
        ...learningLoopPayload,
        fomc_decision: { ...hawkishDecision, period: `2025-${String(i + 1).padStart(2, "0")}` },
      }, store);
    }

    const result = await runFomcIntelligenceOperation(
      mockServices,
      {
        ...predictionOnlyPayload,
        context: learningLoopPayload.context,
      },
      store,
    );

    expect(result.analog_count).toBeGreaterThan(0);
  });

  it("second run benefits from analogs built from first run", async () => {
    await runFomcIntelligenceOperation(mockServices, learningLoopPayload, store);

    const result = await runFomcIntelligenceOperation(
      mockServices,
      {
        ...predictionOnlyPayload,
        fomc_decision: { ...hawkishDecision, period: "2026-04" },
        context: learningLoopPayload.context,
      },
      store,
    );

    expect(result.analog_count).toBeGreaterThan(0);
  });
});

// ─── Explanation output ───────────────────────────────────────────────────────

describe("runFomcIntelligenceOperation — explanation output", () => {
  let store: FomcMemoryCaseStore;

  beforeEach(() => {
    resetFomcIntelligenceStoreForTesting();
    store = new FomcMemoryCaseStore();
  });

  afterEach(() => {
    resetFomcIntelligenceStoreForTesting();
  });

  it("explanation has correct horizon field", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      { ...predictionOnlyPayload, horizons: ["1h", "5d"] },
      store,
    );

    expect(result.explanations[0]!.horizon).toBe("1h");
    expect(result.explanations[1]!.horizon).toBe("5d");
  });

  it("explanation surprise_direction matches event", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    expect(result.explanations[0]!.surprise_direction).toBe("hawkish");
  });

  it("explanation cluster_id contains decision_type and guidance_tone", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    const clusterId = result.explanations[0]!.cluster_id;
    expect(clusterId).toContain("hike");
    expect(clusterId).toContain("hawkish");
  });

  it("explanation has non-empty evidence array", async () => {
    const result = await runFomcIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    expect(result.explanations[0]!.evidence.length).toBeGreaterThan(0);
  });
});

// ─── Queue integration ────────────────────────────────────────────────────────

describe("fomc_intelligence — queue integration", () => {
  let repository: InMemoryRepository;

  beforeEach(() => {
    resetFomcIntelligenceStoreForTesting();
    repository = new InMemoryRepository();
  });

  afterEach(() => {
    resetFomcIntelligenceStoreForTesting();
  });

  it("enqueues and drains a prediction-only fomc_intelligence job", async () => {
    const services = {
      repository,
      marketDataProvider: new MockMarketDataProvider(),
      embeddingProvider: new LocalEmbeddingProvider(),
    };

    await enqueueOperationJobRequest(
      services,
      {
        operation_name: "fomc_intelligence",
        payload: {
          fomc_decision: hawkishDecision,
          horizons: ["1d"],
        },
      },
      "api",
    );

    const drainResult = await drainOperationJobs(services, {
      worker_id: "test-worker",
      max_jobs: 1,
      supported_operations: ["fomc_intelligence"],
    });

    expect(drainResult.processed).toBe(1);
    expect(drainResult.completed).toBe(1);
    expect(drainResult.retried).toBe(0);
  });

  it("operation run record is saved with correct operation_name", async () => {
    const services = {
      repository,
      marketDataProvider: new MockMarketDataProvider(),
      embeddingProvider: new LocalEmbeddingProvider(),
    };

    await enqueueOperationJobRequest(
      services,
      {
        operation_name: "fomc_intelligence",
        payload: {
          fomc_decision: hawkishDecision,
          horizons: ["1h", "1d", "5d"],
        },
      },
      "api",
    );

    await drainOperationJobs(services, {
      worker_id: "test-worker",
      max_jobs: 1,
      supported_operations: ["fomc_intelligence"],
    });

    const jobs = await repository.listOperationRuns({ limit: 10 });
    const fomcJob = jobs.find((j: Record<string, unknown>) => j["operation_name"] === "fomc_intelligence");

    expect(fomcJob).toBeDefined();
    expect(fomcJob!["status"]).toBe("success");
  });

  it("idempotency key deduplicates fomc_intelligence jobs for the same period", async () => {
    const services = {
      repository,
      marketDataProvider: new MockMarketDataProvider(),
      embeddingProvider: new LocalEmbeddingProvider(),
    };

    const idempotencyKey = `fomc_intelligence:${hawkishDecision.period}`;

    await enqueueOperationJobRequest(
      services,
      {
        operation_name: "fomc_intelligence",
        payload: { fomc_decision: hawkishDecision },
        idempotency_key: idempotencyKey,
      },
      "api",
    );

    await enqueueOperationJobRequest(
      services,
      {
        operation_name: "fomc_intelligence",
        payload: { fomc_decision: hawkishDecision },
        idempotency_key: idempotencyKey,
      },
      "api",
    );

    const drainResult = await drainOperationJobs(services, {
      worker_id: "test-worker",
      max_jobs: 5,
      supported_operations: ["fomc_intelligence"],
    });

    expect(drainResult.processed).toBe(1);
  });

  it("enqueues a learning-loop job and drains it successfully", async () => {
    const services = {
      repository,
      marketDataProvider: new MockMarketDataProvider(),
      embeddingProvider: new LocalEmbeddingProvider(),
    };

    await enqueueOperationJobRequest(
      services,
      {
        operation_name: "fomc_intelligence",
        payload: {
          fomc_decision: hawkishDecision,
          horizons: ["1d"],
          realized_moves: hawkishRealizedMovesCorrect,
          measured_at: "2026-03-20T20:00:00Z",
          timing_alignment: 0.8,
        },
      },
      "api",
    );

    const drainResult = await drainOperationJobs(services, {
      worker_id: "test-worker",
      max_jobs: 1,
      supported_operations: ["fomc_intelligence"],
    });

    expect(drainResult.completed).toBe(1);
  });
});
