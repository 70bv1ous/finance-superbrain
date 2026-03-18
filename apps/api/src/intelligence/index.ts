export type { CpiEvent, CpiRelease, CpiSurpriseDirection } from "./events/cpiEvent.js";
export { buildCpiEvent } from "./events/cpiEvent.js";

export type {
  FedStance,
  LiquiditySensitivity,
  MacroRegime,
  MarketContextInput,
  MarketContextSnapshot,
  VolatilityRegime,
} from "./context/marketContext.js";
export { buildMarketContextSnapshot } from "./context/marketContext.js";

export type {
  CpiPredictionHorizon,
  CpiPredictionInput,
  CpiPredictionResult,
} from "./prediction/cpiPrediction.js";
export { generateCpiPrediction } from "./prediction/cpiPrediction.js";

export type {
  CpiOutcomeInput,
  CpiOutcomeResult,
  TrackedOutcome,
} from "./outcome/outcomeTracker.js";
export { trackCpiOutcome } from "./outcome/outcomeTracker.js";

export type {
  CpiMemoryCase,
  CpiMemoryCaseInput,
} from "./memory/memoryCaseBuilder.js";
export { buildCpiMemoryCase } from "./memory/memoryCaseBuilder.js";

export type { CpiMemoryCaseFilter } from "./memory/cpiMemoryCaseStore.js";
export { CpiMemoryCaseStore } from "./memory/cpiMemoryCaseStore.js";

export type {
  CpiAnalogMatch,
  CpiAnalogSignals,
  FindCpiAnalogsOptions,
  SurpriseBand,
} from "./analogs/cpiAnalogRetrieval.js";
export { findCpiAnalogs, resolveSurpriseBand } from "./analogs/cpiAnalogRetrieval.js";

export type {
  CpiEnrichedPrediction,
  CpiEnrichedPredictionResult,
} from "./analogs/cpiConfidenceEnrichment.js";
export { enrichCpiPredictionWithAnalogs } from "./analogs/cpiConfidenceEnrichment.js";

export type {
  CpiThemeCluster,
  CpiThemeKey,
} from "./themes/cpiThemeClustering.js";
export {
  clusterCpiMemoryCases,
  buildCpiClusterId,
  resolveThemeKeyForCase,
} from "./themes/cpiThemeClustering.js";

export type {
  CpiThemeReport,
  CpiThemeSummary,
  ReliabilitySignal,
  VerdictDistribution,
} from "./themes/cpiThemeSummary.js";
export { buildCpiThemeReport, summarizeCpiTheme } from "./themes/cpiThemeSummary.js";

export type {
  CpiReplayBenchmarkResult,
  CpiReplayRecord,
} from "./evaluation/cpiReplayBenchmark.js";
export { runCpiReplayBenchmark } from "./evaluation/cpiReplayBenchmark.js";

export type {
  CalibrationComparison,
  CautionPrecision,
  ClusterBenchmarkEntry,
  CpiCalibrationReport,
  ReinforcementPrecision,
} from "./evaluation/cpiCalibrationReport.js";
export { buildCpiCalibrationReport } from "./evaluation/cpiCalibrationReport.js";

// Phase 5E
export type {
  CpiAnalogStrength,
  ClusterReliabilityContext,
  CpiReliabilityFlags,
  CpiReliabilitySignals,
  CpiReliabilityEnrichedResult,
} from "./reliability/cpiReliabilitySignals.js";
export {
  resolveThemeKeyFromPrediction,
  resolveAnalogStrength,
  computeAverageSimilarity,
  computeReliabilityAdjustment,
  resolveReliabilityFlags,
  buildDisciplineNote,
  resolveCpiReliabilitySignals,
} from "./reliability/cpiReliabilitySignals.js";
export type { CpiReliabilityEnrichmentInput } from "./reliability/cpiReliabilityEnrichment.js";
export { enrichCpiPredictionWithReliability } from "./reliability/cpiReliabilityEnrichment.js";

export type {
  CpiKnowledgeFlags,
  CpiKnowledgeSignals,
  CpiKnowledgeEnrichedResult,
  CpiKnowledgeEnrichmentInput,
} from "./reliability/cpiKnowledgeEnrichment.js";
export { enrichCpiPredictionWithKnowledge } from "./reliability/cpiKnowledgeEnrichment.js";

// Phase 5F
export type {
  CpiRecurringLesson,
  CpiFailureTagFrequency,
  CpiConfidenceBias,
  CpiExtractedLessons,
} from "./knowledge/cpiLessonExtraction.js";
export { extractCpiLessons } from "./knowledge/cpiLessonExtraction.js";

export type {
  CpiKnowledgeType,
  CpiKnowledgeEntry,
  CpiKnowledgeBase,
} from "./knowledge/cpiKnowledgeSummary.js";
export { buildCpiKnowledgeBase } from "./knowledge/cpiKnowledgeSummary.js";

// Phase 5H
export type {
  CpiAdjustmentBreakdown,
  CpiEvidenceItem,
  CpiPredictionExplanation,
} from "./explanations/cpiPredictionExplanation.js";
export {
  buildCpiPredictionExplanation,
  buildCpiPredictionExplanations,
} from "./explanations/cpiPredictionExplanation.js";

// Phase 5I
export type {
  CpiIntelligencePayload,
  CpiIntelligenceResult,
} from "./cpiLiveOperation.js";
export {
  cpiIntelligencePayloadSchema,
  resetCpiIntelligenceStoreForTesting,
  runCpiIntelligenceOperation,
} from "./cpiLiveOperation.js";

// Phase 6A — FOMC vertical

export type {
  FomcDecision,
  FomcEvent,
  FomcSurpriseDirection,
} from "./events/fomcEvent.js";
export { buildFomcEvent } from "./events/fomcEvent.js";

export type {
  FomcPredictionInput,
  FomcPredictionResult,
} from "./prediction/fomcPrediction.js";
export { generateFomcPrediction } from "./prediction/fomcPrediction.js";

export type {
  FomcOutcomeInput,
  FomcOutcomeResult,
  FomcTrackedOutcome,
} from "./outcome/fomcOutcomeTracker.js";
export { trackFomcOutcome } from "./outcome/fomcOutcomeTracker.js";

export type { FomcMemoryCase } from "./memory/fomcMemoryCaseBuilder.js";
export { buildFomcMemoryCase } from "./memory/fomcMemoryCaseBuilder.js";

export type { FomcMemoryCaseFilter } from "./memory/fomcMemoryCaseStore.js";
export { FomcMemoryCaseStore } from "./memory/fomcMemoryCaseStore.js";

export type {
  FomcAnalogMatch,
  FomcAnalogSignals,
  FindFomcAnalogsOptions,
} from "./analogs/fomcAnalogRetrieval.js";
export { findFomcAnalogs } from "./analogs/fomcAnalogRetrieval.js";

export type {
  FomcEnrichedPrediction,
  FomcEnrichedPredictionResult,
} from "./analogs/fomcConfidenceEnrichment.js";
export { enrichFomcPredictionWithAnalogs } from "./analogs/fomcConfidenceEnrichment.js";

export type {
  FomcThemeCluster,
  FomcThemeKey,
} from "./themes/fomcThemeClustering.js";
export {
  clusterFomcMemoryCases,
  buildFomcClusterId,
  resolveThemeKeyForCase as resolveFomcThemeKeyForCase,
} from "./themes/fomcThemeClustering.js";

export type {
  FomcThemeReport,
  FomcThemeSummary,
  FomcReliabilitySignal,
  FomcVerdictDistribution,
} from "./themes/fomcThemeSummary.js";
export { buildFomcThemeReport, summarizeFomcTheme } from "./themes/fomcThemeSummary.js";

export type {
  FomcReplayBenchmarkResult,
  FomcReplayRecord,
} from "./evaluation/fomcReplayBenchmark.js";
export { runFomcReplayBenchmark } from "./evaluation/fomcReplayBenchmark.js";

export type {
  FomcCalibrationComparison,
  FomcCautionPrecision,
  FomcClusterBenchmarkEntry,
  FomcCalibrationReport,
  FomcReinforcementPrecision,
} from "./evaluation/fomcCalibrationReport.js";
export { buildFomcCalibrationReport } from "./evaluation/fomcCalibrationReport.js";

export type {
  FomcAnalogStrength,
  FomcClusterReliabilityContext,
  FomcReliabilityFlags,
  FomcReliabilitySignals,
  FomcReliabilityEnrichedResult,
} from "./reliability/fomcReliabilitySignals.js";
export {
  resolveThemeKeyFromPrediction as resolveFomcThemeKeyFromPrediction,
  resolveFomcReliabilitySignals,
} from "./reliability/fomcReliabilitySignals.js";

export type { FomcReliabilityEnrichmentInput } from "./reliability/fomcReliabilityEnrichment.js";
export { enrichFomcPredictionWithReliability } from "./reliability/fomcReliabilityEnrichment.js";

export type {
  FomcKnowledgeFlags,
  FomcKnowledgeSignals,
  FomcKnowledgeEnrichedResult,
  FomcKnowledgeEnrichmentInput,
} from "./reliability/fomcKnowledgeEnrichment.js";
export { enrichFomcPredictionWithKnowledge } from "./reliability/fomcKnowledgeEnrichment.js";

export type {
  FomcRecurringLesson,
  FomcFailureTagFrequency,
  FomcConfidenceBias,
  FomcExtractedLessons,
} from "./knowledge/fomcLessonExtraction.js";
export { extractFomcLessons } from "./knowledge/fomcLessonExtraction.js";

export type {
  FomcKnowledgeType,
  FomcKnowledgeEntry,
  FomcKnowledgeBase,
} from "./knowledge/fomcKnowledgeSummary.js";
export { buildFomcKnowledgeBase } from "./knowledge/fomcKnowledgeSummary.js";

export type {
  FomcAdjustmentBreakdown,
  FomcEvidenceItem,
  FomcPredictionExplanation,
} from "./explanations/fomcPredictionExplanation.js";
export {
  buildFomcPredictionExplanation,
  buildFomcPredictionExplanations,
} from "./explanations/fomcPredictionExplanation.js";

export type {
  FomcIntelligencePayload,
  FomcIntelligenceResult,
} from "./fomcLiveOperation.js";
export {
  fomcIntelligencePayloadSchema,
  resetFomcIntelligenceStoreForTesting,
  runFomcIntelligenceOperation,
} from "./fomcLiveOperation.js";

// Phase 6B — NFP vertical

export type {
  NfpRelease,
  NfpEvent,
  NfpSurpriseDirection,
  NfpJobsSurpriseBand,
  NfpUnemploymentDirection,
} from "./events/nfpEvent.js";
export { buildNfpEvent } from "./events/nfpEvent.js";

export type {
  NfpPredictionInput,
  NfpPredictionResult,
} from "./prediction/nfpPrediction.js";
export { generateNfpPrediction } from "./prediction/nfpPrediction.js";

export type {
  NfpOutcomeInput,
  NfpOutcomeResult,
  NfpTrackedOutcome,
} from "./outcome/nfpOutcomeTracker.js";
export { trackNfpOutcome } from "./outcome/nfpOutcomeTracker.js";

export type { NfpMemoryCase } from "./memory/nfpMemoryCaseBuilder.js";
export { buildNfpMemoryCase } from "./memory/nfpMemoryCaseBuilder.js";

export type { NfpMemoryCaseFilter } from "./memory/nfpMemoryCaseStore.js";
export { NfpMemoryCaseStore } from "./memory/nfpMemoryCaseStore.js";

export type {
  NfpAnalogMatch,
  NfpAnalogSignals,
  FindNfpAnalogsOptions,
} from "./analogs/nfpAnalogRetrieval.js";
export { findNfpAnalogs } from "./analogs/nfpAnalogRetrieval.js";

export type {
  NfpEnrichedPrediction,
  NfpEnrichedPredictionResult,
} from "./analogs/nfpConfidenceEnrichment.js";
export { enrichNfpPredictionWithAnalogs } from "./analogs/nfpConfidenceEnrichment.js";

export type {
  NfpThemeCluster,
  NfpThemeKey,
} from "./themes/nfpThemeClustering.js";
export {
  clusterNfpMemoryCases,
  buildNfpClusterId,
  resolveThemeKeyForCase as resolveNfpThemeKeyForCase,
} from "./themes/nfpThemeClustering.js";

export type {
  NfpThemeReport,
  NfpThemeSummary,
  NfpReliabilitySignal,
  NfpVerdictDistribution,
} from "./themes/nfpThemeSummary.js";
export { buildNfpThemeReport, summarizeNfpTheme } from "./themes/nfpThemeSummary.js";

export type {
  NfpReplayBenchmarkResult,
  NfpReplayRecord,
} from "./evaluation/nfpReplayBenchmark.js";
export { runNfpReplayBenchmark } from "./evaluation/nfpReplayBenchmark.js";

export type {
  NfpCalibrationComparison,
  NfpCautionPrecision,
  NfpClusterBenchmarkEntry,
  NfpCalibrationReport,
  NfpReinforcementPrecision,
} from "./evaluation/nfpCalibrationReport.js";
export { buildNfpCalibrationReport } from "./evaluation/nfpCalibrationReport.js";

export type {
  NfpAnalogStrength,
  NfpClusterReliabilityContext,
  NfpReliabilityFlags,
  NfpReliabilitySignals,
  NfpReliabilityEnrichedResult,
} from "./reliability/nfpReliabilitySignals.js";
export {
  resolveThemeKeyFromPrediction as resolveNfpThemeKeyFromPrediction,
  resolveNfpReliabilitySignals,
} from "./reliability/nfpReliabilitySignals.js";

export type { NfpReliabilityEnrichmentInput } from "./reliability/nfpReliabilityEnrichment.js";
export { enrichNfpPredictionWithReliability } from "./reliability/nfpReliabilityEnrichment.js";

export type {
  NfpKnowledgeFlags,
  NfpKnowledgeSignals,
  NfpKnowledgeEnrichedResult,
  NfpKnowledgeEnrichmentInput,
} from "./reliability/nfpKnowledgeEnrichment.js";
export { enrichNfpPredictionWithKnowledge } from "./reliability/nfpKnowledgeEnrichment.js";

export type {
  NfpRecurringLesson,
  NfpFailureTagFrequency,
  NfpConfidenceBias,
  NfpExtractedLessons,
} from "./knowledge/nfpLessonExtraction.js";
export { extractNfpLessons } from "./knowledge/nfpLessonExtraction.js";

export type {
  NfpKnowledgeType,
  NfpKnowledgeEntry,
  NfpKnowledgeBase,
} from "./knowledge/nfpKnowledgeSummary.js";
export { buildNfpKnowledgeBase } from "./knowledge/nfpKnowledgeSummary.js";

export type {
  NfpAdjustmentBreakdown,
  NfpEvidenceItem,
  NfpPredictionExplanation,
} from "./explanations/nfpPredictionExplanation.js";
export {
  buildNfpPredictionExplanation,
  buildNfpPredictionExplanations,
} from "./explanations/nfpPredictionExplanation.js";

export type {
  NfpIntelligencePayload,
  NfpIntelligenceResult,
} from "./nfpLiveOperation.js";
export {
  nfpIntelligencePayloadSchema,
  resetNfpIntelligenceStoreForTesting,
  runNfpIntelligenceOperation,
} from "./nfpLiveOperation.js";
