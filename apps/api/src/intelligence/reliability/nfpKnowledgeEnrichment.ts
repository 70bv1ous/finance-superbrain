import type { NfpKnowledgeBase, NfpKnowledgeEntry } from "../knowledge/nfpKnowledgeSummary.js";
import { buildNfpClusterId } from "../themes/nfpThemeClustering.js";
import type { NfpReliabilityEnrichedResult } from "./nfpReliabilitySignals.js";
import { resolveThemeKeyFromPrediction } from "./nfpReliabilitySignals.js";
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

export type NfpKnowledgeFlags = {
  has_active_failure_modes: boolean;
  overconfidence_bias: boolean;
  underconfidence_bias: boolean;
  insufficient_knowledge: boolean;
};

export type NfpKnowledgeSignals = {
  active_failure_modes: NfpKnowledgeEntry[];
  confidence_bias_entry: NfpKnowledgeEntry | null;
  knowledge_adjustment: number;
  caution_notes: string[];
  flags: NfpKnowledgeFlags;
};

export type NfpKnowledgeEnrichedResult = NfpReliabilityEnrichedResult & {
  knowledge: NfpKnowledgeSignals;
};

export type NfpKnowledgeEnrichmentInput = {
  reliability_enriched_result: NfpReliabilityEnrichedResult;
  knowledge_base?: NfpKnowledgeBase;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply Phase 5G–equivalent knowledge-layer enrichment for NFP predictions.
 * Knowledge adjustment bounded to [−0.06, +0.02].
 * Final confidence clamped to [0.25, 0.95].
 */
export const enrichNfpPredictionWithKnowledge = (
  input: NfpKnowledgeEnrichmentInput,
): NfpKnowledgeEnrichedResult => {
  const { reliability_enriched_result, knowledge_base } = input;

  const emptySignals: NfpKnowledgeSignals = {
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

  const { nfp_event, context } = reliability_enriched_result;
  const themeKey = resolveThemeKeyFromPrediction(nfp_event, context);
  const clusterId = buildNfpClusterId(themeKey);

  const activeFailureModes = filterActiveFailureModes(knowledge_base.entries, clusterId);
  const biasEntry = findConfidenceBiasEntry(knowledge_base.entries);
  const knowledgeAdjustment = computeKnowledgeAdjustment(activeFailureModes, biasEntry);
  const cautionNotes = buildKnowledgeCautionNotes(activeFailureModes, biasEntry);

  const flags: NfpKnowledgeFlags = {
    has_active_failure_modes: activeFailureModes.length > 0,
    overconfidence_bias: biasEntry !== null && isOverconfidenceBias(biasEntry),
    underconfidence_bias: biasEntry !== null && isUnderconfidenceBias(biasEntry),
    insufficient_knowledge: false,
  };

  const knowledge: NfpKnowledgeSignals = {
    active_failure_modes: activeFailureModes,
    confidence_bias_entry: biasEntry,
    knowledge_adjustment: knowledgeAdjustment,
    caution_notes: cautionNotes,
    flags,
  };

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
