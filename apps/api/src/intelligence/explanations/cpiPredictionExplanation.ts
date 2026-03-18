import { buildCpiClusterId } from "../themes/cpiThemeClustering.js";
import { resolveThemeKeyFromPrediction } from "../reliability/cpiReliabilitySignals.js";
import type { CpiKnowledgeEnrichedResult } from "../reliability/cpiKnowledgeEnrichment.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The layered confidence breakdown showing exactly how the final confidence
 * was derived from the base prediction.
 *
 * Note: `base_confidence` is reconstructed by subtracting all layer deltas
 * from `final_confidence`.  It is approximate when intermediate clamping
 * occurred — the sum of deltas will still faithfully show what each layer
 * intended, even if clamping absorbed some of the impact.
 */
export type CpiAdjustmentBreakdown = {
  /** Approximate base confidence before any enrichment layer */
  base_confidence: number;
  /** Phase 5B: analog-evidence confidence delta (±0.10) */
  analog_boost: number;
  /** Phase 5E: cluster/benchmark reliability confidence delta ([−0.08, +0.05]) */
  reliability_adjustment: number;
  /** Phase 5G: knowledge-base confidence delta ([−0.06, +0.02]) */
  knowledge_adjustment: number;
  /** Sum of all three deltas */
  total_adjustment: number;
  /** Final confidence after all adjustments and clamping */
  final_confidence: number;
};

/**
 * A single evidence item that contributed to the enriched prediction.
 *
 * Evidence items are emitted by individual layers and rolled up into the
 * explanation's `evidence`, `cautions`, and `supports` arrays.
 */
export type CpiEvidenceItem = {
  /**
   * Which enrichment layer produced this item.
   *   analog      — from Phase 5B analog retrieval
   *   reliability — from Phase 5E cluster/benchmark signals
   *   knowledge   — from Phase 5G knowledge-base signals
   */
  source: "analog" | "reliability" | "knowledge";
  /** Whether this item reinforces, warns against, or neutrally notes the prediction */
  signal: "support" | "caution" | "neutral";
  /** Short machine-readable label suitable for filtering and dashboards */
  label: string;
  /** Human-readable one-line description of what this item represents */
  description: string;
};

/**
 * A canonical structured explanation for a single CPI prediction horizon.
 *
 * This is the Phase 5H synthesis artifact — it combines the full decision
 * trail from Phase 5B (analog boost), Phase 5E (reliability adjustment), and
 * Phase 5G (knowledge adjustment) into one object suitable for:
 *   - Dashboard display
 *   - Audit logs
 *   - Future model-context injection ("explain why confidence is X")
 *   - Human review of the enrichment decision trail
 */
export type CpiPredictionExplanation = {
  /** Prediction horizon this explanation covers (e.g. "1d", "5d") */
  horizon: string;
  /** Dot-delimited macro-theme cluster for this prediction's conditions */
  cluster_id: string;
  /** CPI surprise direction that triggered the prediction */
  surprise_direction: string;
  /** Number of historical analog cases that were retrieved */
  analog_count: number;
  /** Layered confidence breakdown */
  confidence_breakdown: CpiAdjustmentBreakdown;
  /**
   * All evidence items from all layers, ordered: analog → reliability →
   * knowledge.  Neutral items appear last within each source group.
   */
  evidence: CpiEvidenceItem[];
  /** Subset of `evidence` where `signal === "caution"` */
  cautions: CpiEvidenceItem[];
  /** Subset of `evidence` where `signal === "support"` */
  supports: CpiEvidenceItem[];
  /**
   * One-to-two sentence synthesis of the dominant signals.
   *
   * Priority ordering: active failure modes > unreliable cluster > benchmark
   * caution > strong support > moderate support > baseline.
   *
   * This field is primarily for display and logging — the structured
   * `evidence`, `cautions`, and `supports` arrays carry the machine-readable
   * payload.
   */
  explanation_summary: string;
  /** ISO timestamp when this explanation was generated */
  generated_at: string;
};

// ─── Evidence builders ────────────────────────────────────────────────────────

const round2 = (v: number) => Number(v.toFixed(2));
const round4 = (v: number) => Number(v.toFixed(4));

/** Build evidence items for the Phase 5B analog layer. */
const buildAnalogEvidenceItems = (
  result: CpiKnowledgeEnrichedResult,
  analogBoost: number,
): CpiEvidenceItem[] => {
  const count = result.analogs.length;

  if (count === 0) {
    return [
      {
        source: "analog",
        signal: "neutral",
        label: "no_analogs",
        description: "No historical analog cases found for this macro setup.",
      },
    ];
  }

  const avgSim = round4(
    result.analogs.reduce((s, a) => s + a.similarity, 0) / count,
  );
  const correct = result.analogs.filter((a) => a.verdict === "correct").length;
  const wrong = result.analogs.filter((a) => a.verdict === "wrong").length;

  const items: CpiEvidenceItem[] = [];

  if (analogBoost > 0) {
    items.push({
      source: "analog",
      signal: "support",
      label: "analog_reinforcement",
      description:
        `${count} analog(s) (avg similarity ${avgSim}) reinforce this setup: ` +
        `${correct} correct, ${wrong} wrong. Confidence boosted by +${analogBoost.toFixed(2)}.`,
    });
  } else if (analogBoost < 0) {
    items.push({
      source: "analog",
      signal: "caution",
      label: "analog_caution",
      description:
        `${count} analog(s) (avg similarity ${avgSim}) warn against this setup: ` +
        `${wrong} wrong, ${correct} correct. Confidence dampened by ${analogBoost.toFixed(2)}.`,
    });
  } else {
    // boost === 0 with analogs present → mixed or equal signal
    items.push({
      source: "analog",
      signal: "neutral",
      label: "mixed_analogs",
      description:
        `${count} analog(s) found (avg similarity ${avgSim}) with mixed verdicts — ` +
        `no net confidence adjustment.`,
    });
  }

  return items;
};

/** Build evidence items for the Phase 5E reliability layer. */
const buildReliabilityEvidenceItems = (
  result: CpiKnowledgeEnrichedResult,
): CpiEvidenceItem[] => {
  const { flags, cluster_context, reliability_adjustment } = result.reliability;
  const items: CpiEvidenceItem[] = [];

  if (flags.unreliable_cluster) {
    items.push({
      source: "reliability",
      signal: "caution",
      label: "unreliable_cluster",
      description:
        `Cluster "${cluster_context.cluster_id}" has unreliable prediction history ` +
        `(${cluster_context.case_count} prior cases). Confidence dampened.`,
    });
  }

  if (flags.benchmark_hurts) {
    items.push({
      source: "reliability",
      signal: "caution",
      label: "benchmark_hurts",
      description:
        `Benchmark replay shows analog enrichment historically degrades calibration ` +
        `in cluster "${cluster_context.cluster_id}". Confidence dampened.`,
    });
  }

  if (flags.benchmark_helps) {
    items.push({
      source: "reliability",
      signal: "support",
      label: "benchmark_helps",
      description:
        `Cluster "${cluster_context.cluster_id}" is reliable and benchmark confirms ` +
        `analog enrichment improves calibration here. Confidence lifted.`,
    });
  }

  if (flags.insufficient_history) {
    items.push({
      source: "reliability",
      signal: "neutral",
      label: "insufficient_history",
      description:
        `Only ${cluster_context.case_count} prior case(s) in cluster ` +
        `"${cluster_context.cluster_id}" — insufficient reliability evidence.`,
    });
  }

  // Reliability adjustment with no specific flag → mixed/neutral cluster
  if (items.length === 0 && reliability_adjustment !== 0) {
    items.push({
      source: "reliability",
      signal: "neutral",
      label: "reliability_neutral",
      description:
        `Cluster "${cluster_context.cluster_id}" has mixed signals. ` +
        `Small reliability adjustment applied (${reliability_adjustment >= 0 ? "+" : ""}${reliability_adjustment.toFixed(2)}).`,
    });
  }

  if (items.length === 0) {
    items.push({
      source: "reliability",
      signal: "neutral",
      label: "no_reliability_signal",
      description:
        `No cluster or benchmark reliability signal available for this prediction.`,
    });
  }

  return items;
};

/** Build evidence items for the Phase 5G knowledge layer. */
const buildKnowledgeEvidenceItems = (
  result: CpiKnowledgeEnrichedResult,
): CpiEvidenceItem[] => {
  const { flags, active_failure_modes, confidence_bias_entry } = result.knowledge;
  const items: CpiEvidenceItem[] = [];

  if (flags.insufficient_knowledge) {
    items.push({
      source: "knowledge",
      signal: "neutral",
      label: "no_knowledge",
      description: "No promoted knowledge entries available for this prediction.",
    });
    return items;
  }

  // One item per active failure mode (cap at 3 for display)
  for (const entry of active_failure_modes.slice(0, 3)) {
    items.push({
      source: "knowledge",
      signal: "caution",
      label: "active_failure_mode",
      description: `Knowledge: ${entry.summary}`,
    });
  }

  if (flags.overconfidence_bias && confidence_bias_entry) {
    items.push({
      source: "knowledge",
      signal: "caution",
      label: "overconfidence_bias",
      description:
        `Knowledge bias: ${confidence_bias_entry.summary}`,
    });
  }

  if (flags.underconfidence_bias && confidence_bias_entry) {
    items.push({
      source: "knowledge",
      signal: "support",
      label: "underconfidence_bias",
      description:
        `Knowledge bias: ${confidence_bias_entry.summary}`,
    });
  }

  if (items.length === 0) {
    items.push({
      source: "knowledge",
      signal: "neutral",
      label: "knowledge_neutral",
      description: "Knowledge base has entries but none apply to this prediction.",
    });
  }

  return items;
};

// ─── Summary builder ──────────────────────────────────────────────────────────

const buildExplanationSummary = (
  clusterId: string,
  analogCount: number,
  avgSimilarity: number,
  totalAdjustment: number,
  evidenceItems: CpiEvidenceItem[],
): string => {
  const cautions = evidenceItems.filter((e) => e.signal === "caution");
  const supports = evidenceItems.filter((e) => e.signal === "support");

  const failureModeCount = cautions.filter(
    (e) => e.source === "knowledge" && e.label === "active_failure_mode",
  ).length;
  const hasUnreliableCluster = cautions.some((e) => e.label === "unreliable_cluster");
  const hasBenchmarkHurts = cautions.some((e) => e.label === "benchmark_hurts");
  const hasOverconfidenceBias = cautions.some((e) => e.label === "overconfidence_bias");
  const hasBenchmarkHelps = supports.some((e) => e.label === "benchmark_helps");
  const hasAnalogSupport = supports.some((e) => e.label === "analog_reinforcement");
  const adj = totalAdjustment >= 0
    ? `+${totalAdjustment.toFixed(2)}`
    : totalAdjustment.toFixed(2);

  // Worst: failure modes + unreliable cluster
  if (failureModeCount >= 1 && hasUnreliableCluster) {
    return (
      `Strong caution: ${failureModeCount} recurring failure pattern(s) active and cluster ` +
      `"${clusterId}" has unreliable prediction history. Total confidence adjustment: ${adj}.`
    );
  }

  // Failure modes only
  if (failureModeCount >= 1) {
    return (
      `Caution: ${failureModeCount} recurring failure pattern(s) active for cluster ` +
      `"${clusterId}". Total confidence adjustment: ${adj}.`
    );
  }

  // Unreliable cluster (possibly + benchmark hurts)
  if (hasUnreliableCluster) {
    const extra = hasBenchmarkHurts ? " Benchmark also shows degraded calibration here." : "";
    return (
      `Caution: cluster "${clusterId}" has unreliable prediction history.${extra} ` +
      `Total confidence adjustment: ${adj}.`
    );
  }

  // Benchmark hurts (no unreliable cluster)
  if (hasBenchmarkHurts) {
    return (
      `Caution: analog enrichment historically degrades calibration in cluster ` +
      `"${clusterId}". Total confidence adjustment: ${adj}.`
    );
  }

  // Overconfidence bias only
  if (hasOverconfidenceBias) {
    return (
      `Caution: systematic overconfidence detected across prior cases. ` +
      `Total confidence adjustment: ${adj}.`
    );
  }

  // Best: benchmark helps + analogs + support
  if (hasBenchmarkHelps && hasAnalogSupport && analogCount >= 3) {
    return (
      `Strong support: ${analogCount} analog(s) (avg similarity ${avgSimilarity.toFixed(2)}), ` +
      `reliable cluster, and positive benchmark history. Total confidence adjustment: ${adj}.`
    );
  }

  // Benchmark helps (moderate)
  if (hasBenchmarkHelps) {
    return (
      `Supported: cluster "${clusterId}" is reliable with positive benchmark history. ` +
      `Total confidence adjustment: ${adj}.`
    );
  }

  // Analog support without cluster signals
  if (hasAnalogSupport && analogCount > 0) {
    return (
      `Moderate support: ${analogCount} analog(s) reinforce this setup (avg similarity ` +
      `${avgSimilarity.toFixed(2)}). Cluster reliability is neutral or unknown. Total adjustment: ${adj}.`
    );
  }

  // No analogs, no strong signals
  if (analogCount === 0) {
    return (
      `Baseline prediction — no historical analogs or promoted knowledge entries ` +
      `for cluster "${clusterId}". No adjustment applied.`
    );
  }

  return (
    `Mixed signals: ${analogCount} analog(s) found but no strong reliability or knowledge ` +
    `signals. Total confidence adjustment: ${adj}.`
  );
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a structured explanation for a single prediction horizon from a
 * Phase 5G knowledge-enriched result.
 *
 * The explanation synthesises signals from all three enrichment layers:
 *   - Phase 5B  analog evidence  (analog_boost)
 *   - Phase 5E  cluster/benchmark reliability  (reliability_adjustment)
 *   - Phase 5G  knowledge-base patterns  (knowledge_adjustment)
 *
 * The resulting `CpiPredictionExplanation` is self-contained and suitable
 * for audit logging, dashboard display, or injection into a future model
 * context prompt.
 *
 * @throws {Error} if no prediction exists for the requested horizon.
 */
export const buildCpiPredictionExplanation = (
  result: CpiKnowledgeEnrichedResult,
  horizon: string,
): CpiPredictionExplanation => {
  const pred = result.predictions.find((p) => p.horizon === horizon);
  if (!pred) {
    throw new Error(
      `buildCpiPredictionExplanation: no prediction found for horizon "${horizon}". ` +
        `Available: ${result.predictions.map((p) => p.horizon).join(", ")}.`,
    );
  }

  // Resolve cluster
  const themeKey = resolveThemeKeyFromPrediction(result.cpi_event, result.context);
  const clusterId = buildCpiClusterId(themeKey);

  // Per-prediction deltas
  const analogBoost = pred.analog_boost;
  const reliabilityAdj = result.reliability.reliability_adjustment;
  const knowledgeAdj = result.knowledge.knowledge_adjustment;

  // Reconstruct approximate base confidence
  const totalAdjustment = round2(analogBoost + reliabilityAdj + knowledgeAdj);
  const baseConfidence = round2(pred.confidence - totalAdjustment);

  const confidenceBreakdown: CpiAdjustmentBreakdown = {
    base_confidence: baseConfidence,
    analog_boost: analogBoost,
    reliability_adjustment: reliabilityAdj,
    knowledge_adjustment: knowledgeAdj,
    total_adjustment: totalAdjustment,
    final_confidence: pred.confidence,
  };

  // Build evidence items per layer
  const analogItems = buildAnalogEvidenceItems(result, analogBoost);
  const reliabilityItems = buildReliabilityEvidenceItems(result);
  const knowledgeItems = buildKnowledgeEvidenceItems(result);

  const allEvidence = [...analogItems, ...reliabilityItems, ...knowledgeItems];

  const cautions = allEvidence.filter((e) => e.signal === "caution");
  const supports = allEvidence.filter((e) => e.signal === "support");

  const avgSimilarity =
    result.analogs.length > 0
      ? round4(result.analogs.reduce((s, a) => s + a.similarity, 0) / result.analogs.length)
      : 0;

  const explanationSummary = buildExplanationSummary(
    clusterId,
    result.analogs.length,
    avgSimilarity,
    totalAdjustment,
    allEvidence,
  );

  return {
    horizon,
    cluster_id: clusterId,
    surprise_direction: result.cpi_event.surprise_direction,
    analog_count: result.analogs.length,
    confidence_breakdown: confidenceBreakdown,
    evidence: allEvidence,
    cautions,
    supports,
    explanation_summary: explanationSummary,
    generated_at: new Date().toISOString(),
  };
};

/**
 * Build one `CpiPredictionExplanation` per prediction horizon in the result.
 *
 * Returns explanations in the same order as `result.predictions`.
 * Use this when you want explanations for all horizons in one call.
 */
export const buildCpiPredictionExplanations = (
  result: CpiKnowledgeEnrichedResult,
): CpiPredictionExplanation[] =>
  result.predictions.map((pred) =>
    buildCpiPredictionExplanation(result, pred.horizon),
  );
