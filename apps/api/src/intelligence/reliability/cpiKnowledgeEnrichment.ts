import type { CpiKnowledgeBase, CpiKnowledgeEntry } from "../knowledge/cpiKnowledgeSummary.js";
import { buildCpiClusterId } from "../themes/cpiThemeClustering.js";
import type { CpiReliabilityEnrichedResult } from "./cpiReliabilitySignals.js";
import { resolveThemeKeyFromPrediction } from "./cpiReliabilitySignals.js";
import {
  filterActiveFailureModes,
  findConfidenceBiasEntry,
  isOverconfidenceBias,
  isUnderconfidenceBias,
  computeKnowledgeAdjustment,
  buildKnowledgeCautionNotes,
} from "./knowledgeEnrichmentHelpers.js";
import { round2, clamp } from "./reliabilitySignalHelpers.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Boolean flags exposing which knowledge-base conditions influenced the
 * adjustment.  All flags are false when no knowledge base is available.
 */
export type CpiKnowledgeFlags = {
  /** At least one failure_mode entry is active for this cluster */
  has_active_failure_modes: boolean;
  /** Knowledge base carries a systematic overconfidence bias signal */
  overconfidence_bias: boolean;
  /** Knowledge base carries a systematic underconfidence bias signal */
  underconfidence_bias: boolean;
  /**
   * Knowledge base is absent, empty, or has no entries relevant to this
   * prediction — no knowledge adjustment was possible.
   */
  insufficient_knowledge: boolean;
};

/**
 * Structured knowledge-layer signals for a live prediction.
 */
export type CpiKnowledgeSignals = {
  active_failure_modes: CpiKnowledgeEntry[];
  confidence_bias_entry: CpiKnowledgeEntry | null;
  knowledge_adjustment: number;
  caution_notes: string[];
  flags: CpiKnowledgeFlags;
};

/**
 * The final live prediction result after the full Phase 5B/5E/5G stack.
 */
export type CpiKnowledgeEnrichedResult = CpiReliabilityEnrichedResult & {
  knowledge: CpiKnowledgeSignals;
};

// ─── Input type ───────────────────────────────────────────────────────────────

export type CpiKnowledgeEnrichmentInput = {
  reliability_enriched_result: CpiReliabilityEnrichedResult;
  knowledge_base?: CpiKnowledgeBase;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply Phase 5G knowledge-layer enrichment to a Phase 5E reliability-enriched
 * prediction result.
 *
 * Knowledge adjustment bounded to [−0.06, +0.02].
 * Final confidence clamped to [0.25, 0.95].
 *
 * The input `reliability_enriched_result` is never mutated.
 */
export const enrichCpiPredictionWithKnowledge = (
  input: CpiKnowledgeEnrichmentInput,
): CpiKnowledgeEnrichedResult => {
  const { reliability_enriched_result, knowledge_base } = input;

  // ── No-op path when knowledge base is absent or empty ─────────────────────

  const emptySignals: CpiKnowledgeSignals = {
    active_failure_modes: [],
    confidence_bias_entry: null,
    knowledge_adjustment: 0,
    caution_notes: [],
    flags: {
      has_active_failure_modes: false,
      overconfidence_bias: false,
      underconfidence_bias: false,
      insufficient_knowledge: true,
    },
  };

  if (!knowledge_base || knowledge_base.entries.length === 0) {
    return { ...reliability_enriched_result, knowledge: emptySignals };
  }

  // ── Resolve current cluster ────────────────────────────────────────────────

  const { cpi_event, context } = reliability_enriched_result;
  const themeKey = resolveThemeKeyFromPrediction(cpi_event, context);
  const clusterId = buildCpiClusterId(themeKey);

  // ── Resolve signals ────────────────────────────────────────────────────────

  const activeFailureModes = filterActiveFailureModes(knowledge_base.entries, clusterId);
  const biasEntry = findConfidenceBiasEntry(knowledge_base.entries);
  const knowledgeAdjustment = computeKnowledgeAdjustment(activeFailureModes, biasEntry);
  const cautionNotes = buildKnowledgeCautionNotes(activeFailureModes, biasEntry);

  const flags: CpiKnowledgeFlags = {
    has_active_failure_modes: activeFailureModes.length > 0,
    overconfidence_bias: biasEntry !== null && isOverconfidenceBias(biasEntry),
    underconfidence_bias: biasEntry !== null && isUnderconfidenceBias(biasEntry),
    insufficient_knowledge: false,
  };

  const knowledge: CpiKnowledgeSignals = {
    active_failure_modes: activeFailureModes,
    confidence_bias_entry: biasEntry,
    knowledge_adjustment: knowledgeAdjustment,
    caution_notes: cautionNotes,
    flags,
  };

  // ── Apply adjustment and inject caution notes ──────────────────────────────

  const adjustedPredictions = reliability_enriched_result.predictions.map((pred) => {
    const newConfidence = round2(clamp(pred.confidence + knowledgeAdjustment, 0.25, 0.95));

    const newInvalidations = [...pred.invalidations];
    for (const note of cautionNotes) {
      if (newInvalidations.length < 6 && !newInvalidations.includes(note)) {
        newInvalidations.push(note);
      }
    }

    return { ...pred, confidence: newConfidence, invalidations: newInvalidations };
  });

  return {
    ...reliability_enriched_result,
    predictions: adjustedPredictions,
    knowledge,
  };
};
