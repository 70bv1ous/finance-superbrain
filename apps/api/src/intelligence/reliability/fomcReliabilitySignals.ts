import type { FomcEvent } from "../events/fomcEvent.js";
import type { MarketContextSnapshot } from "../context/marketContext.js";
import type { FomcAnalogMatch } from "../analogs/fomcAnalogRetrieval.js";
import type { FomcThemeKey } from "../themes/fomcThemeClustering.js";
import { buildFomcClusterId } from "../themes/fomcThemeClustering.js";
import type { FomcThemeReport, FomcReliabilitySignal } from "../themes/fomcThemeSummary.js";
import type { FomcCalibrationReport } from "../evaluation/fomcCalibrationReport.js";
import type { FomcEnrichedPredictionResult } from "../analogs/fomcConfidenceEnrichment.js";
import {
  resolveAnalogStrength,
  computeAverageSimilarity,
  computeReliabilityAdjustment,
  resolveReliabilityFlags,
  buildDisciplineNote,
} from "./reliabilitySignalHelpers.js";
import type { AnalogStrength, BaseClusterReliabilityContext, BaseReliabilityFlags } from "./reliabilitySignalHelpers.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FomcAnalogStrength = AnalogStrength;

export type FomcClusterReliabilityContext = BaseClusterReliabilityContext & {
  reliability_signal: FomcReliabilitySignal;
};

export type FomcReliabilityFlags = BaseReliabilityFlags;

export type FomcReliabilitySignals = {
  analog_strength: FomcAnalogStrength;
  analog_count: number;
  average_similarity: number;
  cluster_context: FomcClusterReliabilityContext;
  reliability_adjustment: number;
  discipline_note: string;
  flags: FomcReliabilityFlags;
};

export type FomcReliabilityEnrichedResult = FomcEnrichedPredictionResult & {
  reliability: FomcReliabilitySignals;
};

// ─── FOMC-specific helpers ────────────────────────────────────────────────────

/**
 * Derive the FomcThemeKey from the live prediction inputs.
 */
export const resolveThemeKeyFromPrediction = (
  event: FomcEvent,
  context: MarketContextSnapshot,
): FomcThemeKey => ({
  surprise_direction: event.surprise_direction,
  decision_type: event.decision_type,
  guidance_tone: event.guidance_tone,
  macro_regime: context.macro_regime,
  volatility_regime: context.volatility_regime,
});

export const resolveClusterReliabilityContext = (
  clusterId: string,
  themeReport?: FomcThemeReport,
  calibrationReport?: FomcCalibrationReport,
): FomcClusterReliabilityContext => {
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

export const resolveFomcReliabilitySignals = (
  enrichedResult: FomcEnrichedPredictionResult,
  themeReport?: FomcThemeReport,
  calibrationReport?: FomcCalibrationReport,
): FomcReliabilitySignals => {
  const { fomc_event, context, analogs } = enrichedResult;

  const themeKey = resolveThemeKeyFromPrediction(fomc_event, context);
  const clusterId = buildFomcClusterId(themeKey);

  const strength = resolveAnalogStrength(analogs);
  const avgSimilarity = computeAverageSimilarity(analogs);
  const clusterCtx = resolveClusterReliabilityContext(
    clusterId,
    themeReport,
    calibrationReport,
  );
  const adjustment = computeReliabilityAdjustment(strength, clusterCtx);
  const flags = resolveReliabilityFlags(strength, clusterCtx);
  const disciplineNote = buildDisciplineNote(strength, clusterCtx, adjustment, flags, "FOMC");

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
