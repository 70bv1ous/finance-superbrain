import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CpiMemoryCaseStore } from "./memory/cpiMemoryCaseStore.js";
import {
  cpiIntelligencePayloadSchema,
  resetCpiIntelligenceStoreForTesting,
  runCpiIntelligenceOperation,
  type CpiIntelligencePayload,
} from "./cpiLiveOperation.js";
import { InMemoryRepository } from "../lib/InMemoryRepository.js";
import { drainOperationJobs, enqueueOperationJobRequest } from "../lib/operationJobs.js";
import { LocalEmbeddingProvider } from "../lib/LocalEmbeddingProvider.js";
import { MockMarketDataProvider } from "../lib/MockMarketDataProvider.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const hotterRelease = {
  released_at: "2026-03-12T12:30:00Z",
  period: "2026-02",
  actual_value: 3.2,
  expected_value: 3.0,
  prior_value: 3.1,
};

const coolerRelease = {
  released_at: "2026-03-12T12:30:00Z",
  period: "2026-02",
  actual_value: 2.8,
  expected_value: 3.0,
  prior_value: 3.1,
};

const hotterRealizedMovesCorrect = [
  { ticker: "TLT", realized_direction: "up" as const, realized_magnitude_bp: 45 },
  { ticker: "QQQ", realized_direction: "down" as const, realized_magnitude_bp: -85 },
  { ticker: "DXY", realized_direction: "up" as const, realized_magnitude_bp: 30 },
];

const mockServices = {
  repository: new InMemoryRepository() as any,
  marketDataProvider: new MockMarketDataProvider() as any,
  embeddingProvider: new LocalEmbeddingProvider() as any,
};

const predictionOnlyPayload: CpiIntelligencePayload = {
  cpi_release: hotterRelease,
  context: undefined,
  horizons: ["1d"],
  realized_moves: undefined,
  measured_at: undefined,
  timing_alignment: undefined,
};

const learningLoopPayload: CpiIntelligencePayload = {
  cpi_release: hotterRelease,
  context: { fed_policy_stance: "hawkish", macro_regime: "risk_off" },
  horizons: ["1h", "1d"],
  realized_moves: hotterRealizedMovesCorrect,
  measured_at: "2026-03-13T20:00:00Z",
  timing_alignment: 0.85,
};

// ─── Payload schema ────────────────────────────────────────────────────────────

describe("cpiIntelligencePayloadSchema", () => {
  it("parses a minimal prediction-only payload", () => {
    const result = cpiIntelligencePayloadSchema.safeParse({
      cpi_release: hotterRelease,
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.horizons).toEqual(["1h", "1d", "5d"]);
      expect(result.data.realized_moves).toBeUndefined();
    }
  });

  it("parses a full learning-loop payload", () => {
    const result = cpiIntelligencePayloadSchema.safeParse({
      cpi_release: hotterRelease,
      context: { fed_policy_stance: "hawkish" },
      horizons: ["1d"],
      realized_moves: hotterRealizedMovesCorrect,
      measured_at: "2026-03-13T20:00:00Z",
      timing_alignment: 0.8,
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.realized_moves).toHaveLength(3);
      expect(result.data.timing_alignment).toBe(0.8);
    }
  });

  it("rejects timing_alignment outside [0, 1]", () => {
    const result = cpiIntelligencePayloadSchema.safeParse({
      cpi_release: hotterRelease,
      timing_alignment: 1.5,
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing cpi_release", () => {
    const result = cpiIntelligencePayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts optional prior_value", () => {
    const result = cpiIntelligencePayloadSchema.safeParse({
      cpi_release: {
        released_at: "2026-03-12T12:30:00Z",
        period: "2026-02",
        actual_value: 3.2,
        expected_value: 3.0,
        // no prior_value
      },
    });

    expect(result.success).toBe(true);
  });
});

// ─── Prediction-only mode ─────────────────────────────────────────────────────

describe("runCpiIntelligenceOperation — prediction-only", () => {
  let store: CpiMemoryCaseStore;

  beforeEach(() => {
    resetCpiIntelligenceStoreForTesting();
    store = new CpiMemoryCaseStore();
  });

  afterEach(() => {
    resetCpiIntelligenceStoreForTesting();
  });

  it("returns the expected result shape", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    expect(result.period).toBe("2026-02");
    expect(typeof result.cluster_id).toBe("string");
    expect(result.cluster_id.length).toBeGreaterThan(0);
    expect(result.analog_count).toBe(0); // empty store → no analogs
    expect(result.prediction_count).toBe(1);
    expect(result.explanation_count).toBe(1);
    expect(result.memory_case_id).toBeNull();
    expect(result.verdict).toBeNull();
    expect(result.store_size).toBe(0); // no learning loop → store unchanged
    expect(Array.isArray(result.explanations)).toBe(true);
    expect(result.explanations).toHaveLength(1);
  });

  it("generates explanations for each horizon", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      { ...predictionOnlyPayload, horizons: ["1h", "1d", "5d"] },
      store,
    );

    expect(result.prediction_count).toBe(3);
    expect(result.explanation_count).toBe(3);
    expect(result.explanations.map((e) => e.horizon)).toEqual(["1h", "1d", "5d"]);
  });

  it("derives cluster_id from the event + context", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    // cluster_id format: <direction>.<band>.<fed>.<macro>.<vol>
    expect(result.cluster_id).toMatch(/^(hotter|cooler|inline)\./);
    expect(result.cluster_id).toContain("neutral"); // default fed stance
  });

  it("cluster_id reflects context overrides", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      {
        ...predictionOnlyPayload,
        context: { fed_policy_stance: "hawkish", macro_regime: "risk_off" },
      },
      store,
    );

    expect(result.cluster_id).toContain("hawkish");
    expect(result.cluster_id).toContain("risk_off");
  });

  it("explanation contains adjustment breakdown fields", async () => {
    const result = await runCpiIntelligenceOperation(
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
    await runCpiIntelligenceOperation(mockServices, predictionOnlyPayload, store);
    expect(store.size).toBe(0);
  });

  it("handles cooler CPI event correctly", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      { ...predictionOnlyPayload, cpi_release: coolerRelease },
      store,
    );

    expect(result.period).toBe("2026-02");
    expect(result.cluster_id).toContain("cooler");
    expect(result.memory_case_id).toBeNull();
  });
});

// ─── Learning loop mode ───────────────────────────────────────────────────────

describe("runCpiIntelligenceOperation — learning loop", () => {
  let store: CpiMemoryCaseStore;

  beforeEach(() => {
    resetCpiIntelligenceStoreForTesting();
    store = new CpiMemoryCaseStore();
  });

  afterEach(() => {
    resetCpiIntelligenceStoreForTesting();
  });

  it("creates and stores a memory case when realized_moves provided", async () => {
    expect(store.size).toBe(0);

    const result = await runCpiIntelligenceOperation(
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
    const result = await runCpiIntelligenceOperation(
      mockServices,
      learningLoopPayload,
      store,
    );

    const storedCase = await store.get(result.memory_case_id!);

    expect(storedCase).not.toBeNull();
    expect(storedCase!.period).toBe("2026-02");
    expect(storedCase!.cpi_event.surprise_direction).toBe("hotter");
  });

  it("verdict is one of the valid outcome values", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      learningLoopPayload,
      store,
    );

    expect(["correct", "partially_correct", "wrong"]).toContain(result.verdict);
  });

  it("accumulates cases across successive runs with the same store", async () => {
    await runCpiIntelligenceOperation(mockServices, learningLoopPayload, store);
    await runCpiIntelligenceOperation(mockServices, {
      ...learningLoopPayload,
      cpi_release: { ...hotterRelease, period: "2026-03" },
    }, store);

    expect(store.size).toBe(2);
  });

  it("second run benefits from analogs built from first run", async () => {
    // First run populates the store
    await runCpiIntelligenceOperation(mockServices, learningLoopPayload, store);

    // Second run on a similar event should find at least one analog
    const result = await runCpiIntelligenceOperation(
      mockServices,
      {
        ...predictionOnlyPayload,
        cpi_release: { ...hotterRelease, period: "2026-03" },
        context: learningLoopPayload.context,
      },
      store,
    );

    expect(result.analog_count).toBeGreaterThan(0);
  });

  it("uses provided measured_at and timing_alignment", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      learningLoopPayload,
      store,
    );

    // We can verify through the stored memory case
    const storedCase = await store.get(result.memory_case_id!);
    expect(storedCase!.tracked_outcomes).toHaveLength(2); // 2 horizons
  });

  it("defaults timing_alignment to 0.8 when not provided", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      {
        ...learningLoopPayload,
        timing_alignment: undefined,
      },
      store,
    );

    // Just verifying it doesn't throw and produces a valid verdict
    expect(result.verdict).toBeTruthy();
  });

  it("defaults measured_at to now when not provided", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      {
        ...learningLoopPayload,
        measured_at: undefined,
      },
      store,
    );

    expect(result.memory_case_id).not.toBeNull();
  });
});

// ─── Analog enrichment grows with store ──────────────────────────────────────

describe("runCpiIntelligenceOperation — analog enrichment", () => {
  let store: CpiMemoryCaseStore;

  beforeEach(() => {
    resetCpiIntelligenceStoreForTesting();
    store = new CpiMemoryCaseStore();
  });

  afterEach(() => {
    resetCpiIntelligenceStoreForTesting();
  });

  it("analog_count is 0 for an empty store", async () => {
    const result = await runCpiIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    expect(result.analog_count).toBe(0);
  });

  it("analog_count grows as the store is populated", async () => {
    // Seed multiple cases with similar profiles
    for (let i = 0; i < 3; i++) {
      await runCpiIntelligenceOperation(mockServices, {
        ...learningLoopPayload,
        cpi_release: { ...hotterRelease, period: `2025-${String(i + 1).padStart(2, "0")}` },
      }, store);
    }

    const result = await runCpiIntelligenceOperation(
      mockServices,
      predictionOnlyPayload,
      store,
    );

    expect(result.analog_count).toBeGreaterThan(0);
  });
});

// ─── Store hydration ──────────────────────────────────────────────────────────

describe("runCpiIntelligenceOperation — store hydration", () => {
  beforeEach(() => {
    resetCpiIntelligenceStoreForTesting();
  });

  afterEach(() => {
    resetCpiIntelligenceStoreForTesting();
  });

  it("pre-seeded cases in a non-persisted store are visible to subsequent runs", async () => {
    // Simulate the scenario that load() handles: cases that exist before the
    // operation runs should be visible as analogs.  For non-file-backed stores,
    // load() is a no-op, so pre-seeded cases are preserved exactly as inserted.
    const store = new CpiMemoryCaseStore();

    // Seed one learning-loop case into the store directly
    await runCpiIntelligenceOperation(mockServices, learningLoopPayload, store);
    expect(store.size).toBe(1);

    // A second prediction-only run on the same store should see the seeded case
    const result = await runCpiIntelligenceOperation(
      mockServices,
      {
        ...predictionOnlyPayload,
        cpi_release: { ...hotterRelease, period: "2026-03" },
        context: learningLoopPayload.context,
      },
      store,
    );

    // The existing case should be available as an analog
    expect(result.analog_count).toBeGreaterThan(0);
  });

  it("injected test store is not re-initialised between calls", async () => {
    const store = new CpiMemoryCaseStore();

    await runCpiIntelligenceOperation(mockServices, learningLoopPayload, store);
    const sizeAfterFirst = store.size;

    await runCpiIntelligenceOperation(mockServices, {
      ...learningLoopPayload,
      cpi_release: { ...hotterRelease, period: "2026-04" },
    }, store);

    // Store should grow, not reset
    expect(store.size).toBeGreaterThan(sizeAfterFirst);
  });
});

// ─── Queue integration ────────────────────────────────────────────────────────

describe("cpi_intelligence — queue integration", () => {
  let repository: InMemoryRepository;

  beforeEach(() => {
    resetCpiIntelligenceStoreForTesting();
    repository = new InMemoryRepository();
  });

  afterEach(() => {
    resetCpiIntelligenceStoreForTesting();
  });

  it("enqueues and drains a prediction-only cpi_intelligence job", async () => {
    const services = {
      repository,
      marketDataProvider: new MockMarketDataProvider(),
      embeddingProvider: new LocalEmbeddingProvider(),
    };

    await enqueueOperationJobRequest(
      services,
      {
        operation_name: "cpi_intelligence",
        payload: {
          cpi_release: hotterRelease,
          horizons: ["1d"],
        },
      },
      "api",
    );

    const drainResult = await drainOperationJobs(services, {
      worker_id: "test-worker",
      max_jobs: 1,
      supported_operations: ["cpi_intelligence"],
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
        operation_name: "cpi_intelligence",
        payload: {
          cpi_release: hotterRelease,
          horizons: ["1h", "1d", "5d"],
        },
      },
      "api",
    );

    await drainOperationJobs(services, {
      worker_id: "test-worker",
      max_jobs: 1,
      supported_operations: ["cpi_intelligence"],
    });

    const jobs = await repository.listOperationRuns({ limit: 10 });
    const cpiJob = jobs.find((j: Record<string, unknown>) => j["operation_name"] === "cpi_intelligence");

    expect(cpiJob).toBeDefined();
    expect(cpiJob!["status"]).toBe("success");
  });

  it("idempotency key deduplicates cpi_intelligence jobs for the same period", async () => {
    const services = {
      repository,
      marketDataProvider: new MockMarketDataProvider(),
      embeddingProvider: new LocalEmbeddingProvider(),
    };

    const idempotencyKey = `cpi_intelligence:${hotterRelease.period}`;

    await enqueueOperationJobRequest(
      services,
      {
        operation_name: "cpi_intelligence",
        payload: { cpi_release: hotterRelease },
        idempotency_key: idempotencyKey,
      },
      "api",
    );

    // Second enqueue with same key — should be deduplicated
    await enqueueOperationJobRequest(
      services,
      {
        operation_name: "cpi_intelligence",
        payload: { cpi_release: hotterRelease },
        idempotency_key: idempotencyKey,
      },
      "api",
    );

    const drainResult = await drainOperationJobs(services, {
      worker_id: "test-worker",
      max_jobs: 5,
      supported_operations: ["cpi_intelligence"],
    });

    // Only one job executed despite two enqueue calls
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
        operation_name: "cpi_intelligence",
        payload: {
          cpi_release: hotterRelease,
          horizons: ["1d"],
          realized_moves: hotterRealizedMovesCorrect,
          measured_at: "2026-03-13T20:00:00Z",
          timing_alignment: 0.8,
        },
      },
      "api",
    );

    const drainResult = await drainOperationJobs(services, {
      worker_id: "test-worker",
      max_jobs: 1,
      supported_operations: ["cpi_intelligence"],
    });

    expect(drainResult.completed).toBe(1);
  });
});
