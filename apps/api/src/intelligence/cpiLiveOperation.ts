import { z } from "zod";

import type { AppServices } from "../lib/services.js";
import { buildCpiEvent } from "./events/cpiEvent.js";
import { buildMarketContextSnapshot } from "./context/marketContext.js";
import { generateCpiPrediction } from "./prediction/cpiPrediction.js";
import { findCpiAnalogs } from "./analogs/cpiAnalogRetrieval.js";
import { enrichCpiPredictionWithAnalogs } from "./analogs/cpiConfidenceEnrichment.js";
import { buildCpiThemeReport } from "./themes/cpiThemeSummary.js";
import { runCpiReplayBenchmark } from "./evaluation/cpiReplayBenchmark.js";
import { buildCpiCalibrationReport } from "./evaluation/cpiCalibrationReport.js";
import { enrichCpiPredictionWithReliability } from "./reliability/cpiReliabilityEnrichment.js";
import { buildCpiKnowledgeBase } from "./knowledge/cpiKnowledgeSummary.js";
import { enrichCpiPredictionWithKnowledge } from "./reliability/cpiKnowledgeEnrichment.js";
import {
  buildCpiPredictionExplanations,
  type CpiPredictionExplanation,
} from "./explanations/cpiPredictionExplanation.js";
import { trackCpiOutcome } from "./outcome/outcomeTracker.js";
import { buildCpiMemoryCase } from "./memory/memoryCaseBuilder.js";
import { CpiMemoryCaseStore } from "./memory/cpiMemoryCaseStore.js";
import { resolveThemeKeyFromPrediction } from "./reliability/cpiReliabilitySignals.js";
import { buildCpiClusterId } from "./themes/cpiThemeClustering.js";

// ─── Payload schema ────────────────────────────────────────────────────────────

const cpiReleaseSchema = z.object({
  released_at: z.string(),
  period: z.string(),
  actual_value: z.number(),
  expected_value: z.number(),
  prior_value: z.number().optional(),
});

const marketContextInputSchema = z
  .object({
    fed_policy_stance: z.enum(["dovish", "neutral", "hawkish"]).optional(),
    macro_regime: z.enum(["risk_on", "risk_off", "transitional", "uncertain"]).optional(),
    volatility_regime: z.enum(["low", "normal", "elevated", "high"]).optional(),
    liquidity_sensitivity: z.enum(["low", "normal", "high"]).optional(),
    notes: z.array(z.string()).optional(),
    captured_at: z.string().optional(),
  })
  .optional();

const realizedMoveSchema = z.object({
  ticker: z.string(),
  realized_direction: z.enum(["up", "down", "mixed"]),
  realized_magnitude_bp: z.number(),
});

export const cpiIntelligencePayloadSchema = z.object({
  /** The raw CPI release data. */
  cpi_release: cpiReleaseSchema,
  /**
   * Optional market context at time of release.
   * When absent, defaults are used (neutral Fed, uncertain macro, normal vol).
   */
  context: marketContextInputSchema,
  /**
   * Prediction horizons to generate.
   * Defaults to ["1h", "1d", "5d"] when omitted.
   */
  horizons: z.array(z.enum(["1h", "1d", "5d"])).default(["1h", "1d", "5d"]),
  /**
   * Optional realized market moves measured after the event.
   * When provided, the full learning loop runs: outcome tracking → memory case
   * creation → store persistence. When absent, the operation is prediction-only.
   */
  realized_moves: z.array(realizedMoveSchema).optional(),

  /**
   * ISO datetime when the realized moves were measured.
   * Required when realized_moves is provided (defaults to now if omitted).
   */
  measured_at: z.string().optional(),
  /**
   * Timing alignment score for the realized moves (0–1).
   * Reflects how well the measured window aligns with the prediction horizon.
   * Defaults to 0.8 when realized_moves are provided without an explicit value.
   */
  timing_alignment: z.number().min(0).max(1).optional(),
});

export type CpiIntelligencePayload = z.infer<typeof cpiIntelligencePayloadSchema>;

// ─── Result type ───────────────────────────────────────────────────────────────

export type CpiIntelligenceResult = {
  /** CPI release period (e.g. "2026-02") */
  period: string;
  /** Dot-delimited macro-theme cluster ID for this event + context */
  cluster_id: string;
  /** Number of historical analogs used for enrichment */
  analog_count: number;
  /** Number of prediction horizons generated */
  prediction_count: number;
  /** Number of explanation artifacts produced */
  explanation_count: number;
  /**
   * Memory case ID if one was created (realized_moves provided).
   * Null for prediction-only runs.
   */
  memory_case_id: string | null;
  /**
   * Overall prediction verdict from the outcome tracker.
   * Null for prediction-only runs.
   */
  verdict: string | null;
  /** Total cases in the store after this operation */
  store_size: number;
  /** Structured per-horizon explanation artifacts */
  explanations: CpiPredictionExplanation[];
};

// ─── Module-level store singleton ─────────────────────────────────────────────

/**
 * Module-level CpiMemoryCaseStore singleton.
 *
 * Persists to `CPI_MEMORY_STORE_PATH` when the env var is set, otherwise
 * operates as an ephemeral in-memory store.  This avoids any Phase 4
 * infrastructure dependency while still supporting persistence in production.
 */
let defaultStore: CpiMemoryCaseStore | null = null;

const getDefaultStore = (): CpiMemoryCaseStore => {
  if (!defaultStore) {
    defaultStore = new CpiMemoryCaseStore(
      process.env["CPI_MEMORY_STORE_PATH"] ?? null,
    );
  }

  return defaultStore;
};

/**
 * Reset the module-level store singleton.
 *
 * Intended for test isolation only.  Each test that requires a clean store
 * should call this in a `beforeEach` / `afterEach` hook.
 */
export const resetCpiIntelligenceStoreForTesting = (): void => {
  defaultStore = null;
};

// ─── Pipeline threshold ────────────────────────────────────────────────────────

/**
 * Minimum store size required to run the replay benchmark and build a
 * calibration report.  The benchmark is O(n²) and produces no useful
 * signal when fewer than 3 prior cases exist.
 */
const MIN_CASES_FOR_BENCHMARK = 3;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the full CPI intelligence pipeline as a Phase 4 operation.
 *
 * Pipeline stages:
 *
 *   1. Event parsing         `buildCpiEvent`
 *   2. Market context        `buildMarketContextSnapshot`
 *   3. Prediction generation `generateCpiPrediction`
 *   4. Analog retrieval      `findCpiAnalogs`  (Phase 5A)
 *   5. Analog enrichment     `enrichCpiPredictionWithAnalogs`  (Phase 5B)
 *   6. Theme report          `buildCpiThemeReport`  (Phase 5C)
 *   7. Calibration report    `runCpiReplayBenchmark` + `buildCpiCalibrationReport`
 *                            (Phase 5D, only when store ≥ 3 cases)
 *   8. Reliability enrichment `enrichCpiPredictionWithReliability`  (Phase 5E)
 *   9. Knowledge base        `buildCpiKnowledgeBase`  (Phase 5F)
 *  10. Knowledge enrichment  `enrichCpiPredictionWithKnowledge`  (Phase 5G)
 *  11. Explanation synthesis `buildCpiPredictionExplanations`  (Phase 5H)
 *
 * Optional learning loop (only when `realized_moves` is provided):
 *  12. Outcome tracking      `trackCpiOutcome`
 *  13. Memory case creation  `buildCpiMemoryCase`
 *  14. Store persistence     `store.save()`
 *
 * @param _services  Phase 4 app services (reserved for future use — the CPI
 *   pipeline is currently self-contained and does not use the repository,
 *   market data provider, or embedding provider).
 * @param payload   Parsed and validated `CpiIntelligencePayload`.
 * @param storeOverride  Inject an alternative store for testing.
 */
export const runCpiIntelligenceOperation = async (
  _services: AppServices,
  payload: CpiIntelligencePayload,
  storeOverride?: CpiMemoryCaseStore,
): Promise<CpiIntelligenceResult> => {
  const store = storeOverride ?? getDefaultStore();

  // Hydrate from disk when using the file-backed default store.
  // No-op when persistPath is null (pure in-memory or test-injected override).
  await store.load();

  // ── 1–2. Event + context ────────────────────────────────────────────────────

  const cpi_event = buildCpiEvent(payload.cpi_release);
  const context = buildMarketContextSnapshot(payload.context ?? {});

  // ── 3. Prediction generation ────────────────────────────────────────────────

  const prediction_result = generateCpiPrediction({
    cpi_event,
    context,
    horizons: payload.horizons,
  });

  // ── 4–5. Analog retrieval + enrichment (Phase 5A/5B) ───────────────────────

  const analogs = await findCpiAnalogs(store, cpi_event, context);
  const enriched_result = enrichCpiPredictionWithAnalogs(prediction_result, analogs);

  // ── 6. Theme report (Phase 5C) ──────────────────────────────────────────────

  const theme_report = await buildCpiThemeReport(store);

  // ── 7. Calibration report (Phase 5D) ───────────────────────────────────────
  //    Run only when the store has enough prior cases to produce a useful signal.

  let calibration_report = undefined;

  if (store.size >= MIN_CASES_FOR_BENCHMARK) {
    const benchmark_result = await runCpiReplayBenchmark(store);
    calibration_report = buildCpiCalibrationReport(benchmark_result);
  }

  // ── 8. Reliability enrichment (Phase 5E) ───────────────────────────────────

  const reliability_enriched_result = enrichCpiPredictionWithReliability({
    enriched_result,
    theme_report,
    calibration_report,
  });

  // ── 9–10. Knowledge base + enrichment (Phase 5F/5G) ────────────────────────

  const knowledge_base = await buildCpiKnowledgeBase(store);
  const knowledge_enriched_result = enrichCpiPredictionWithKnowledge({
    reliability_enriched_result,
    knowledge_base,
  });

  // ── 11. Explanation synthesis (Phase 5H) ───────────────────────────────────

  const explanations = buildCpiPredictionExplanations(knowledge_enriched_result);

  // ── 12–14. Learning loop (optional) ────────────────────────────────────────

  let memory_case_id: string | null = null;
  let verdict: string | null = null;

  if (payload.realized_moves && payload.realized_moves.length > 0) {
    const outcome_result = trackCpiOutcome({
      prediction_result,
      realized_moves: payload.realized_moves.map((m) => ({
        ticker: m.ticker,
        realized_direction: m.realized_direction,
        realized_magnitude_bp: m.realized_magnitude_bp,
      })),
      measured_at: payload.measured_at ?? new Date().toISOString(),
      timing_alignment: payload.timing_alignment ?? 0.8,
    });

    const memory_case = buildCpiMemoryCase({ prediction_result, outcome_result });
    await store.save(memory_case);

    memory_case_id = memory_case.id;
    verdict = memory_case.verdict;
  }

  // ── Cluster ID for result metadata ─────────────────────────────────────────

  const themeKey = resolveThemeKeyFromPrediction(cpi_event, context);
  const cluster_id = buildCpiClusterId(themeKey);

  return {
    period: cpi_event.period,
    cluster_id,
    analog_count: analogs.length,
    prediction_count: prediction_result.predictions.length,
    explanation_count: explanations.length,
    memory_case_id,
    verdict,
    store_size: store.size,
    explanations,
  };
};
