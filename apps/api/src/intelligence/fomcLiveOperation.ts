import { z } from "zod";

import type { AppServices } from "../lib/services.js";
import { buildFomcEvent } from "./events/fomcEvent.js";
import { buildMarketContextSnapshot } from "./context/marketContext.js";
import { generateFomcPrediction } from "./prediction/fomcPrediction.js";
import { findFomcAnalogs } from "./analogs/fomcAnalogRetrieval.js";
import { enrichFomcPredictionWithAnalogs } from "./analogs/fomcConfidenceEnrichment.js";
import { buildFomcThemeReport } from "./themes/fomcThemeSummary.js";
import { runFomcReplayBenchmark } from "./evaluation/fomcReplayBenchmark.js";
import { buildFomcCalibrationReport } from "./evaluation/fomcCalibrationReport.js";
import { enrichFomcPredictionWithReliability } from "./reliability/fomcReliabilityEnrichment.js";
import { buildFomcKnowledgeBase } from "./knowledge/fomcKnowledgeSummary.js";
import { enrichFomcPredictionWithKnowledge } from "./reliability/fomcKnowledgeEnrichment.js";
import {
  buildFomcPredictionExplanations,
  type FomcPredictionExplanation,
} from "./explanations/fomcPredictionExplanation.js";
import { trackFomcOutcome } from "./outcome/fomcOutcomeTracker.js";
import { buildFomcMemoryCase } from "./memory/fomcMemoryCaseBuilder.js";
import { FomcMemoryCaseStore } from "./memory/fomcMemoryCaseStore.js";
import { resolveThemeKeyFromPrediction } from "./reliability/fomcReliabilitySignals.js";
import { buildFomcClusterId } from "./themes/fomcThemeClustering.js";

// ─── Payload schema ────────────────────────────────────────────────────────────

const fomcDecisionSchema = z.object({
  released_at: z.string(),
  period: z.string(),
  actual_rate: z.number(),
  expected_rate: z.number(),
  prior_rate: z.number().optional(),
  decision_type: z.enum(["hike", "cut", "hold"]),
  guidance_tone: z.enum(["hawkish", "dovish", "neutral"]),
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

export const fomcIntelligencePayloadSchema = z.object({
  /** The raw FOMC decision data. */
  fomc_decision: fomcDecisionSchema,
  /**
   * Optional market context at time of decision.
   * When absent, defaults are used (neutral Fed, uncertain macro, normal vol).
   */
  context: marketContextInputSchema,
  /**
   * Prediction horizons to generate.
   * Defaults to ["1h", "1d", "5d"] when omitted.
   */
  horizons: z.array(z.enum(["1h", "1d", "5d"])).default(["1h", "1d", "5d"]),
  /**
   * Optional realized market moves measured after the decision.
   * When provided, the full learning loop runs.
   * When absent, the operation is prediction-only.
   */
  realized_moves: z.array(realizedMoveSchema).optional(),
  /** ISO datetime when the realized moves were measured. */
  measured_at: z.string().optional(),
  /** Timing alignment score [0–1]. Defaults to 0.8 when realized_moves provided. */
  timing_alignment: z.number().min(0).max(1).optional(),
});

export type FomcIntelligencePayload = z.infer<typeof fomcIntelligencePayloadSchema>;

// ─── Result type ───────────────────────────────────────────────────────────────

export type FomcIntelligenceResult = {
  /** FOMC meeting period (e.g. "2026-03") */
  period: string;
  /** Dot-delimited macro-theme cluster ID for this decision + context */
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
   * Overall prediction verdict.
   * Null for prediction-only runs.
   */
  verdict: string | null;
  /** Total cases in the store after this operation */
  store_size: number;
  /** Structured per-horizon explanation artifacts */
  explanations: FomcPredictionExplanation[];
};

// ─── Module-level store singleton ─────────────────────────────────────────────

let defaultStore: FomcMemoryCaseStore | null = null;

const getDefaultStore = (): FomcMemoryCaseStore => {
  if (!defaultStore) {
    defaultStore = new FomcMemoryCaseStore(
      process.env["FOMC_MEMORY_STORE_PATH"] ?? null,
    );
  }
  return defaultStore;
};

export const resetFomcIntelligenceStoreForTesting = (): void => {
  defaultStore = null;
};

// ─── Pipeline threshold ────────────────────────────────────────────────────────

const MIN_CASES_FOR_BENCHMARK = 3;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the full FOMC intelligence pipeline as a Phase 4 operation.
 *
 * Pipeline stages (mirror of `runCpiIntelligenceOperation`):
 *
 *   1.  Event parsing          `buildFomcEvent`
 *   2.  Market context         `buildMarketContextSnapshot`
 *   3.  Prediction generation  `generateFomcPrediction`
 *   4.  Analog retrieval       `findFomcAnalogs`
 *   5.  Analog enrichment      `enrichFomcPredictionWithAnalogs`
 *   6.  Theme report           `buildFomcThemeReport`
 *   7.  Calibration report     (only when store ≥ 3 cases)
 *   8.  Reliability enrichment `enrichFomcPredictionWithReliability`
 *   9.  Knowledge base         `buildFomcKnowledgeBase`
 *   10. Knowledge enrichment   `enrichFomcPredictionWithKnowledge`
 *   11. Explanation synthesis  `buildFomcPredictionExplanations`
 *
 * Optional learning loop (when `realized_moves` provided):
 *   12. Outcome tracking       `trackFomcOutcome`
 *   13. Memory case creation   `buildFomcMemoryCase`
 *   14. Store persistence      `store.save()`
 */
export const runFomcIntelligenceOperation = async (
  _services: AppServices,
  payload: FomcIntelligencePayload,
  storeOverride?: FomcMemoryCaseStore,
): Promise<FomcIntelligenceResult> => {
  const store = storeOverride ?? getDefaultStore();

  // Hydrate from disk when using the file-backed default store.
  await store.load();

  // ── 1–2. Event + context ────────────────────────────────────────────────────

  const fomc_event = buildFomcEvent(payload.fomc_decision);
  const context = buildMarketContextSnapshot(payload.context ?? {});

  // ── 3. Prediction generation ────────────────────────────────────────────────

  const prediction_result = generateFomcPrediction({
    fomc_event,
    context,
    horizons: payload.horizons,
  });

  // ── 4–5. Analog retrieval + enrichment ──────────────────────────────────────

  const analogs = await findFomcAnalogs(store, fomc_event, context);
  const enriched_result = enrichFomcPredictionWithAnalogs(prediction_result, analogs);

  // ── 6. Theme report ──────────────────────────────────────────────────────────

  const theme_report = await buildFomcThemeReport(store);

  // ── 7. Calibration report (only when store ≥ 3 cases) ─────────────────────

  let calibration_report = undefined;

  if (store.size >= MIN_CASES_FOR_BENCHMARK) {
    const benchmark_result = await runFomcReplayBenchmark(store);
    calibration_report = buildFomcCalibrationReport(benchmark_result);
  }

  // ── 8. Reliability enrichment ───────────────────────────────────────────────

  const reliability_enriched_result = enrichFomcPredictionWithReliability({
    enriched_result,
    theme_report,
    calibration_report,
  });

  // ── 9–10. Knowledge base + enrichment ──────────────────────────────────────

  const knowledge_base = await buildFomcKnowledgeBase(store);
  const knowledge_enriched_result = enrichFomcPredictionWithKnowledge({
    reliability_enriched_result,
    knowledge_base,
  });

  // ── 11. Explanation synthesis ───────────────────────────────────────────────

  const explanations = buildFomcPredictionExplanations(knowledge_enriched_result);

  // ── 12–14. Learning loop (optional) ────────────────────────────────────────

  let memory_case_id: string | null = null;
  let verdict: string | null = null;

  if (payload.realized_moves && payload.realized_moves.length > 0) {
    const outcome_result = trackFomcOutcome({
      prediction_result,
      realized_moves: payload.realized_moves.map((m) => ({
        ticker: m.ticker,
        realized_direction: m.realized_direction,
        realized_magnitude_bp: m.realized_magnitude_bp,
      })),
      measured_at: payload.measured_at ?? new Date().toISOString(),
      timing_alignment: payload.timing_alignment ?? 0.8,
    });

    const memory_case = buildFomcMemoryCase({ prediction_result, outcome_result });
    await store.save(memory_case);

    memory_case_id = memory_case.id;
    verdict = memory_case.verdict;
  }

  // ── Cluster ID for result metadata ─────────────────────────────────────────

  const themeKey = resolveThemeKeyFromPrediction(fomc_event, context);
  const cluster_id = buildFomcClusterId(themeKey);

  return {
    period: fomc_event.period,
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
