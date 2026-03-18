import { z } from "zod";

import type { AppServices } from "../lib/services.js";
import { buildNfpEvent } from "./events/nfpEvent.js";
import { buildMarketContextSnapshot } from "./context/marketContext.js";
import { generateNfpPrediction } from "./prediction/nfpPrediction.js";
import { findNfpAnalogs } from "./analogs/nfpAnalogRetrieval.js";
import { enrichNfpPredictionWithAnalogs } from "./analogs/nfpConfidenceEnrichment.js";
import { buildNfpThemeReport } from "./themes/nfpThemeSummary.js";
import { runNfpReplayBenchmark } from "./evaluation/nfpReplayBenchmark.js";
import { buildNfpCalibrationReport } from "./evaluation/nfpCalibrationReport.js";
import { enrichNfpPredictionWithReliability } from "./reliability/nfpReliabilityEnrichment.js";
import { buildNfpKnowledgeBase } from "./knowledge/nfpKnowledgeSummary.js";
import { enrichNfpPredictionWithKnowledge } from "./reliability/nfpKnowledgeEnrichment.js";
import {
  buildNfpPredictionExplanations,
  type NfpPredictionExplanation,
} from "./explanations/nfpPredictionExplanation.js";
import { trackNfpOutcome } from "./outcome/nfpOutcomeTracker.js";
import { buildNfpMemoryCase } from "./memory/nfpMemoryCaseBuilder.js";
import { NfpMemoryCaseStore } from "./memory/nfpMemoryCaseStore.js";
import { resolveThemeKeyFromPrediction } from "./reliability/nfpReliabilitySignals.js";
import { buildNfpClusterId } from "./themes/nfpThemeClustering.js";

// ─── Payload schema ────────────────────────────────────────────────────────────

const nfpReleaseSchema = z.object({
  released_at: z.string(),
  period: z.string(),
  actual_jobs_k: z.number(),
  expected_jobs_k: z.number(),
  prior_jobs_k: z.number().optional(),
  actual_unemployment_pct: z.number(),
  expected_unemployment_pct: z.number(),
  actual_avg_hourly_earnings_pct: z.number().optional(),
  expected_avg_hourly_earnings_pct: z.number().optional(),
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

export const nfpIntelligencePayloadSchema = z.object({
  /** The raw NFP release data. */
  nfp_release: nfpReleaseSchema,
  /**
   * Optional market context at time of release.
   * When absent, defaults are used (neutral Fed, uncertain macro, normal vol).
   */
  context: marketContextInputSchema,
  /**
   * Prediction horizons to generate.
   * Defaults to [\"1h\", \"1d\", \"5d\"] when omitted.
   */
  horizons: z.array(z.enum(["1h", "1d", "5d"])).default(["1h", "1d", "5d"]),
  /**
   * Optional realized market moves measured after the release.
   * When provided, the full learning loop runs.
   * When absent, the operation is prediction-only.
   */
  realized_moves: z.array(realizedMoveSchema).optional(),
  /** ISO datetime when the realized moves were measured. */
  measured_at: z.string().optional(),
  /** Timing alignment score [0–1]. Defaults to 0.8 when realized_moves provided. */
  timing_alignment: z.number().min(0).max(1).optional(),
});

export type NfpIntelligencePayload = z.infer<typeof nfpIntelligencePayloadSchema>;

// ─── Result type ───────────────────────────────────────────────────────────────

export type NfpIntelligenceResult = {
  /** NFP report period (e.g. "2026-02") */
  period: string;
  /** Dot-delimited macro-theme cluster ID for this release + context */
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
  explanations: NfpPredictionExplanation[];
};

// ─── Module-level store singleton ─────────────────────────────────────────────

let defaultStore: NfpMemoryCaseStore | null = null;

const getDefaultStore = (): NfpMemoryCaseStore => {
  if (!defaultStore) {
    defaultStore = new NfpMemoryCaseStore(
      process.env["NFP_MEMORY_STORE_PATH"] ?? null,
    );
  }
  return defaultStore;
};

export const resetNfpIntelligenceStoreForTesting = (): void => {
  defaultStore = null;
};

// ─── Pipeline threshold ────────────────────────────────────────────────────────

const MIN_CASES_FOR_BENCHMARK = 3;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the full NFP intelligence pipeline as a Phase 4 operation.
 *
 * Pipeline stages (mirror of `runFomcIntelligenceOperation`):
 *
 *   1.  Event parsing          `buildNfpEvent`
 *   2.  Market context         `buildMarketContextSnapshot`
 *   3.  Prediction generation  `generateNfpPrediction`
 *   4.  Analog retrieval       `findNfpAnalogs`
 *   5.  Analog enrichment      `enrichNfpPredictionWithAnalogs`
 *   6.  Theme report           `buildNfpThemeReport`
 *   7.  Calibration report     (only when store ≥ 3 cases)
 *   8.  Reliability enrichment `enrichNfpPredictionWithReliability`
 *   9.  Knowledge base         `buildNfpKnowledgeBase`
 *   10. Knowledge enrichment   `enrichNfpPredictionWithKnowledge`
 *   11. Explanation synthesis  `buildNfpPredictionExplanations`
 *
 * Optional learning loop (when `realized_moves` provided):
 *   12. Outcome tracking       `trackNfpOutcome`
 *   13. Memory case creation   `buildNfpMemoryCase`
 *   14. Store persistence      `store.save()`
 */
export const runNfpIntelligenceOperation = async (
  _services: AppServices,
  payload: NfpIntelligencePayload,
  storeOverride?: NfpMemoryCaseStore,
): Promise<NfpIntelligenceResult> => {
  const store = storeOverride ?? getDefaultStore();

  // Hydrate from disk when using the file-backed default store.
  await store.load();

  // ── 1–2. Event + context ────────────────────────────────────────────────────

  const nfp_event = buildNfpEvent(payload.nfp_release);
  const context = buildMarketContextSnapshot(payload.context ?? {});

  // ── 3. Prediction generation ────────────────────────────────────────────────

  const prediction_result = generateNfpPrediction({
    nfp_event,
    context,
    horizons: payload.horizons,
  });

  // ── 4–5. Analog retrieval + enrichment ──────────────────────────────────────

  const analogs = await findNfpAnalogs(store, nfp_event, context);
  const enriched_result = enrichNfpPredictionWithAnalogs(prediction_result, analogs);

  // ── 6. Theme report ──────────────────────────────────────────────────────────

  const theme_report = await buildNfpThemeReport(store);

  // ── 7. Calibration report (only when store ≥ 3 cases) ─────────────────────

  let calibration_report = undefined;

  if (store.size >= MIN_CASES_FOR_BENCHMARK) {
    const benchmark_result = await runNfpReplayBenchmark(store);
    calibration_report = buildNfpCalibrationReport(benchmark_result);
  }

  // ── 8. Reliability enrichment ───────────────────────────────────────────────

  const reliability_enriched_result = enrichNfpPredictionWithReliability({
    enriched_result,
    theme_report,
    calibration_report,
  });

  // ── 9–10. Knowledge base + enrichment ──────────────────────────────────────

  const knowledge_base = await buildNfpKnowledgeBase(store);
  const knowledge_enriched_result = enrichNfpPredictionWithKnowledge({
    reliability_enriched_result,
    knowledge_base,
  });

  // ── 11. Explanation synthesis ───────────────────────────────────────────────

  const explanations = buildNfpPredictionExplanations(knowledge_enriched_result);

  // ── 12–14. Learning loop (optional) ────────────────────────────────────────

  let memory_case_id: string | null = null;
  let verdict: string | null = null;

  if (payload.realized_moves && payload.realized_moves.length > 0) {
    const outcome_result = trackNfpOutcome({
      prediction_result,
      realized_moves: payload.realized_moves.map((m) => ({
        ticker: m.ticker,
        realized_direction: m.realized_direction,
        realized_magnitude_bp: m.realized_magnitude_bp,
      })),
      measured_at: payload.measured_at ?? new Date().toISOString(),
      timing_alignment: payload.timing_alignment ?? 0.8,
    });

    const memory_case = buildNfpMemoryCase({ prediction_result, outcome_result });
    await store.save(memory_case);

    memory_case_id = memory_case.id;
    verdict = memory_case.verdict;
  }

  // ── Cluster ID for result metadata ─────────────────────────────────────────

  const themeKey = resolveThemeKeyFromPrediction(nfp_event, context);
  const cluster_id = buildNfpClusterId(themeKey);

  return {
    period: nfp_event.period,
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
