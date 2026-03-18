import type { NfpThemeReport } from "../themes/nfpThemeSummary.js";
import type { NfpCalibrationReport } from "../evaluation/nfpCalibrationReport.js";
import type { NfpEnrichedPredictionResult } from "../analogs/nfpConfidenceEnrichment.js";
import type { NfpReliabilityEnrichedResult } from "./nfpReliabilitySignals.js";
import { resolveNfpReliabilitySignals } from "./nfpReliabilitySignals.js";
import { applyConfidenceAdjustment } from "./reliabilitySignalHelpers.js";

// ─── Input type ───────────────────────────────────────────────────────────────

export type NfpReliabilityEnrichmentInput = {
  enriched_result: NfpEnrichedPredictionResult;
  theme_report?: NfpThemeReport;
  calibration_report?: NfpCalibrationReport;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply reliability-aware enrichment on top of NFP analog enrichment.
 *
 * Confidence adjustment bounded to [−0.08, +0.05].
 * Final confidence clamped to [0.30, 0.95].
 */
export const enrichNfpPredictionWithReliability = (
  input: NfpReliabilityEnrichmentInput,
): NfpReliabilityEnrichedResult => {
  const { enriched_result, theme_report, calibration_report } = input;

  const reliability = resolveNfpReliabilitySignals(
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
