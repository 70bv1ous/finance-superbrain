import type { FomcThemeReport } from "../themes/fomcThemeSummary.js";
import type { FomcCalibrationReport } from "../evaluation/fomcCalibrationReport.js";
import type { FomcEnrichedPredictionResult } from "../analogs/fomcConfidenceEnrichment.js";
import type { FomcReliabilityEnrichedResult } from "./fomcReliabilitySignals.js";
import { resolveFomcReliabilitySignals } from "./fomcReliabilitySignals.js";
import { applyConfidenceAdjustment } from "./reliabilitySignalHelpers.js";

// ─── Input type ───────────────────────────────────────────────────────────────

export type FomcReliabilityEnrichmentInput = {
  enriched_result: FomcEnrichedPredictionResult;
  theme_report?: FomcThemeReport;
  calibration_report?: FomcCalibrationReport;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply reliability-aware enrichment on top of FOMC analog enrichment.
 *
 * Confidence adjustment bounded to [−0.08, +0.05].
 * Final confidence clamped to [0.30, 0.95].
 */
export const enrichFomcPredictionWithReliability = (
  input: FomcReliabilityEnrichmentInput,
): FomcReliabilityEnrichedResult => {
  const { enriched_result, theme_report, calibration_report } = input;

  const reliability = resolveFomcReliabilitySignals(
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
