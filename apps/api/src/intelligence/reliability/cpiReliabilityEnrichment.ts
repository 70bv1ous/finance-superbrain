import type { CpiThemeReport } from "../themes/cpiThemeSummary.js";
import type { CpiCalibrationReport } from "../evaluation/cpiCalibrationReport.js";
import type { CpiEnrichedPredictionResult } from "../analogs/cpiConfidenceEnrichment.js";
import type { CpiReliabilityEnrichedResult } from "./cpiReliabilitySignals.js";
import { resolveCpiReliabilitySignals } from "./cpiReliabilitySignals.js";
import { applyConfidenceAdjustment } from "./reliabilitySignalHelpers.js";

// ─── Input type ───────────────────────────────────────────────────────────────

export type CpiReliabilityEnrichmentInput = {
  /**
   * The Phase 5B analog-enriched prediction result.
   * Confidence values already reflect the analog boost; the reliability layer
   * applies an additive adjustment on top.
   */
  enriched_result: CpiEnrichedPredictionResult;
  /**
   * Optional theme report from `buildCpiThemeReport`.
   * Used to look up cluster-level reliability history.
   * When absent, cluster context defaults to "insufficient_data".
   */
  theme_report?: CpiThemeReport;
  /**
   * Optional calibration report from `buildCpiCalibrationReport`.
   * Used to look up whether analog enrichment helps or hurts in this cluster.
   * When absent, benchmark verdict defaults to "unknown".
   */
  calibration_report?: CpiCalibrationReport;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply a reliability-aware enrichment layer on top of a Phase 5B
 * analog-enriched prediction result.
 *
 * Confidence adjustment bounds: [−0.08, +0.05].
 * Final confidence clamped to [0.30, 0.95].
 *
 * The input `enriched_result` is never mutated.
 */
export const enrichCpiPredictionWithReliability = (
  input: CpiReliabilityEnrichmentInput,
): CpiReliabilityEnrichedResult => {
  const { enriched_result, theme_report, calibration_report } = input;

  const reliability = resolveCpiReliabilitySignals(
    enriched_result,
    theme_report,
    calibration_report,
  );

  const adjustedPredictions = applyConfidenceAdjustment(
    enriched_result.predictions,
    reliability.reliability_adjustment,
    0.30,
    0.95,
  );

  return {
    ...enriched_result,
    predictions: adjustedPredictions,
    reliability,
  };
};
