import type { CpiEvent } from "../events/cpiEvent.js";
import type { MarketContextSnapshot } from "../context/marketContext.js";
import type { CpiAnalogMatch } from "../analogs/cpiAnalogRetrieval.js";
import { resolveSurpriseBand } from "../analogs/cpiAnalogRetrieval.js";
import type { CpiThemeKey } from "../themes/cpiThemeClustering.js";
import { buildCpiClusterId } from "../themes/cpiThemeClustering.js";
import type { CpiThemeReport } from "../themes/cpiThemeSummary.js";
import type { ReliabilitySignal } from "../themes/cpiThemeSummary.js";
import type { CpiCalibrationReport } from "../evaluation/cpiCalibrationReport.js";
import type { CpiEnrichedPredictionResult } from "../analogs/cpiConfidenceEnrichment.js";
import {
  resolveAnalogStrength,
  computeAverageSimilarity,
  computeReliabilityAdjustment,
  resolveReliabilityFlags,
  buildDisciplineNote,
} from "./reliabilitySignalHelpers.js";
import type { AnalogStrength, BaseClusterReliabilityContext, BaseReliabilityFlags } from "./reliabilitySignalHelpers.js";

// ─── Re-export shared helpers (public API) ────────────────────────────────────

export {
  resolveAnalogStrength,
  computeAverageSimilarity,
  computeReliabilityAdjustment,
  resolveReliabilityFlags,
  buildDisciplineNote,
} from "./reliabilitySignalHelpers.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CpiAnalogStrength = AnalogStrength;

/**
 * Theme-cluster context derived from prior theme clustering and
 * benchmark evaluation results for the cluster matching the current
 * prediction's macro conditions.
 */
export type ClusterReliabilityContext = BaseClusterReliabilityContext & {
  reliability_signal: ReliabilitySignal;
};

export type CpiReliabilityFlags = BaseReliabilityFlags;

/**
 * Structured reliability signals produced by the Phase 5E enrichment layer.
 */
export type CpiReliabilitySignals = {
  analog_strength: CpiAnalogStrength;
  analog_count: number;
  average_similarity: number;
  cluster_context: ClusterReliabilityContext;
  reliability_adjustment: number;
  discipline_note: string;
  flags: CpiReliabilityFlags;
};

/**
 * The final enriched prediction result, combining Phase 5B analog signals
 * with Phase 5E reliability-layer signals.
 */
export type CpiReliabilityEnrichedResult = CpiEnrichedPredictionResult & {
  reliability: CpiReliabilitySignals;
};

// ─── CPI-specific helpers ─────────────────────────────────────────────────────

/**
 * Derive the CpiThemeKey directly from a prediction's event and context.
 */
export const resolveThemeKeyFromPrediction = (
  event: CpiEvent,
  context: MarketContextSnapshot,
): CpiThemeKey => ({
  surprise_direction: event.surprise_direction,
  surprise_band: resolveSurpriseBand(event.surprise_bp),
  fed_policy_stance: context.fed_policy_stance,
  macro_regime: context.macro_regime,
  volatility_regime: context.volatility_regime,
});

/**
 * Resolve the cluster-level reliability context by looking up the cluster
 * matching `clusterId` in the optional theme report and calibration report.
 */
export const resolveClusterReliabilityContext = (
  clusterId: string,
  themeReport?: CpiThemeReport,
  calibrationReport?: CpiCalibrationReport,
): ClusterReliabilityContext => {
  const summary = themeReport?.summaries.find((s) => s.cluster_id === clusterId);
  const benchEntry = calibrationReport?.clusters.find(
    (c) => c.cluster_id === clusterId,
  );

  return {
    cluster_id: clusterId,
    reliability_signal: summary?.reliability_signal ?? "insufficient_data",
    confidence_tendency: summary?.confidence_tendency ?? "moderate",
    benchmark_verdict: benchEntry?.verdict ?? "unknown",
    case_count: summary?.size ?? 0,
  };
};

/**
 * Derive all reliability signals from the current prediction inputs.
 */
export const resolveCpiReliabilitySignals = (
  enrichedResult: CpiEnrichedPredictionResult,
  themeReport?: CpiThemeReport,
  calibrationReport?: CpiCalibrationReport,
): CpiReliabilitySignals => {
  const { cpi_event, context, analogs } = enrichedResult;

  const themeKey = resolveThemeKeyFromPrediction(cpi_event, context);
  const clusterId = buildCpiClusterId(themeKey);

  const strength = resolveAnalogStrength(analogs);
  const avgSimilarity = computeAverageSimilarity(analogs);
  const clusterCtx = resolveClusterReliabilityContext(
    clusterId,
    themeReport,
    calibrationReport,
  );
  const adjustment = computeReliabilityAdjustment(strength, clusterCtx);
  const flags = resolveReliabilityFlags(strength, clusterCtx);
  const disciplineNote = buildDisciplineNote(strength, clusterCtx, adjustment, flags);

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
