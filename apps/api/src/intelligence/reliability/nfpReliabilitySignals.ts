import type { NfpEvent } from "../events/nfpEvent.js";
import type { MarketContextSnapshot } from "../context/marketContext.js";
import type { NfpAnalogMatch } from "../analogs/nfpAnalogRetrieval.js";
import type { NfpThemeKey } from "../themes/nfpThemeClustering.js";
import { buildNfpClusterId } from "../themes/nfpThemeClustering.js";
import type { NfpThemeReport, NfpReliabilitySignal } from "../themes/nfpThemeSummary.js";
import type { NfpCalibrationReport } from "../evaluation/nfpCalibrationReport.js";
import type { NfpEnrichedPredictionResult } from "../analogs/nfpConfidenceEnrichment.js";
import {
  resolveAnalogStrength,
  computeAverageSimilarity,
  computeReliabilityAdjustment,
  resolveReliabilityFlags,
  buildDisciplineNote,
} from "./reliabilitySignalHelpers.js";
import type { AnalogStrength, BaseClusterReliabilityContext, BaseReliabilityFlags } from "./reliabilitySignalHelpers.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NfpAnalogStrength = AnalogStrength;

export type NfpClusterReliabilityContext = BaseClusterReliabilityContext & {
  reliability_signal: NfpReliabilitySignal;
};

export type NfpReliabilityFlags = BaseReliabilityFlags;

export type NfpReliabilitySignals = {
  analog_strength: NfpAnalogStrength;
  analog_count: number;
  average_similarity: number;
  cluster_context: NfpClusterReliabilityContext;
  reliability_adjustment: number;
  discipline_note: string;
  flags: NfpReliabilityFlags;
};

export type NfpReliabilityEnrichedResult = NfpEnrichedPredictionResult & {
  reliability: NfpReliabilitySignals;
};

// ─── NFP-specific helpers ─────────────────────────────────────────────────────

/**
 * Derive the NfpThemeKey from the live prediction inputs.
 */
export const resolveThemeKeyFromPrediction = (
  event: NfpEvent,
  context: MarketContextSnapshot,
): NfpThemeKey => ({
  surprise_direction: event.surprise_direction,
  jobs_surprise_band: event.jobs_surprise_band,
  unemployment_direction: event.unemployment_direction,
  macro_regime: context.macro_regime,
  volatility_regime: context.volatility_regime,
});

export const resolveClusterReliabilityContext = (
  clusterId: string,
  themeReport?: NfpThemeReport,
  calibrationReport?: NfpCalibrationReport,
): NfpClusterReliabilityContext => {
  const summary = themeReport?.summaries.find((s) => s.cluster_id === clusterId);
  const benchEntry = calibrationReport?.clusters.find((c) => c.cluster_id === clusterId);

  return {
    cluster_id: clusterId,
    reliability_signal: summary?.reliability_signal ?? "insufficient_data",
    confidence_tendency: summary?.confidence_tendency ?? "moderate",
    benchmark_verdict: benchEntry?.verdict ?? "unknown",
    case_count: summary?.size ?? 0,
  };
};

export const resolveNfpReliabilitySignals = (
  enrichedResult: NfpEnrichedPredictionResult,
  themeReport?: NfpThemeReport,
  calibrationReport?: NfpCalibrationReport,
): NfpReliabilitySignals => {
  const { nfp_event, context, analogs } = enrichedResult;

  const themeKey = resolveThemeKeyFromPrediction(nfp_event, context);
  const clusterId = buildNfpClusterId(themeKey);

  const strength = resolveAnalogStrength(analogs);
  const avgSimilarity = computeAverageSimilarity(analogs);
  const clusterCtx = resolveClusterReliabilityContext(
    clusterId,
    themeReport,
    calibrationReport,
  );
  const adjustment = computeReliabilityAdjustment(strength, clusterCtx);
  const flags = resolveReliabilityFlags(strength, clusterCtx);
  const disciplineNote = buildDisciplineNote(strength, clusterCtx, adjustment, flags, "NFP");

  return {
    analog_strength: strength,
    analog_count: analogs.length,
    average_similarity: avgSimilarity,
    cluster_context: clusterCtx,
    reliability_adjustment: adjustment,
    discipline_note: disciplineNote,
    flags,
  };
};
