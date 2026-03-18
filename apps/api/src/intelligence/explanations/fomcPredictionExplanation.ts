import { buildFomcClusterId } from "../themes/fomcThemeClustering.js";
import { resolveThemeKeyFromPrediction } from "../reliability/fomcReliabilitySignals.js";
import type { FomcKnowledgeEnrichedResult } from "../reliability/fomcKnowledgeEnrichment.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FomcAdjustmentBreakdown = {
  /** Approximate base confidence before any enrichment layer */
  base_confidence: number;
  /** Analog-evidence confidence delta (±0.10) */
  analog_boost: number;
  /** Cluster/benchmark reliability delta ([−0.08, +0.05]) */
  reliability_adjustment: number;
  /** Knowledge-base delta ([−0.06, +0.02]) */
  knowledge_adjustment: number;
  /** Sum of all three deltas */
  total_adjustment: number;
  /** Final confidence after all adjustments and clamping */
  final_confidence: number;
};

export type FomcEvidenceItem = {
  source: "analog" | "reliability" | "knowledge";
  signal: "support" | "caution" | "neutral";
  label: string;
  description: string;
};

export type FomcPredictionExplanation = {
  horizon: string;
  cluster_id: string;
  surprise_direction: string;
  analog_count: number;
  confidence_breakdown: FomcAdjustmentBreakdown;
  evidence: FomcEvidenceItem[];
  cautions: FomcEvidenceItem[];
  supports: FomcEvidenceItem[];
  explanation_summary: string;
  generated_at: string;
};

// ─── Evidence builders ────────────────────────────────────────────────────────

const round2 = (v: number) => Number(v.toFixed(2));
const round4 = (v: number) => Number(v.toFixed(4));

const buildAnalogEvidenceItems = (
  result: FomcKnowledgeEnrichedResult,
  analogBoost: number,
): FomcEvidenceItem[] => {
  const count = result.analogs.length;

  if (count === 0) {
    return [
      {
        source: "analog",
        signal: "neutral",
        label: "no_analogs",
        description: "No historical FOMC analog cases found for this macro setup.",
      },
    ];
  }

  const avgSim = round4(
    result.analogs.reduce((s, a) => s + a.similarity, 0) / count,
  );
  const correct = result.analogs.filter((a) => a.verdict === "correct").length;
  const wrong = result.analogs.filter((a) => a.verdict === "wrong").length;

  const items: FomcEvidenceItem[] = [];

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

const buildReliabilityEvidenceItems = (
  result: FomcKnowledgeEnrichedResult,
): FomcEvidenceItem[] => {
  const { flags, cluster_context, reliability_adjustment } = result.reliability;
  const items: FomcEvidenceItem[] = [];

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
      description: `No cluster or benchmark reliability signal available for this prediction.`,
    });
  }

  return items;
};

const buildKnowledgeEvidenceItems = (
  result: FomcKnowledgeEnrichedResult,
): FomcEvidenceItem[] => {
  const { flags, active_failure_modes, confidence_bias_entry } = result.knowledge;
  const items: FomcEvidenceItem[] = [];

  if (flags.insufficient_knowledge) {
    items.push({
      source: "knowledge",
      signal: "neutral",
      label: "no_knowledge",
      description: "No promoted knowledge entries available for this prediction.",
    });
    return items;
  }

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
      description: `Knowledge bias: ${confidence_bias_entry.summary}`,
    });
  }

  if (flags.underconfidence_bias && confidence_bias_entry) {
    items.push({
      source: "knowledge",
      signal: "support",
      label: "underconfidence_bias",
      description: `Knowledge bias: ${confidence_bias_entry.summary}`,
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
  evidenceItems: FomcEvidenceItem[],
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

  if (failureModeCount >= 1 && hasUnreliableCluster) {
    return (
      `Strong caution: ${failureModeCount} recurring failure pattern(s) active and cluster ` +
      `"${clusterId}" has unreliable prediction history. Total confidence adjustment: ${adj}.`
    );
  }

  if (failureModeCount >= 1) {
    return (
      `Caution: ${failureModeCount} recurring failure pattern(s) active for cluster ` +
      `"${clusterId}". Total confidence adjustment: ${adj}.`
    );
  }

  if (hasUnreliableCluster) {
    const extra = hasBenchmarkHurts ? " Benchmark also shows degraded calibration here." : "";
    return (
      `Caution: cluster "${clusterId}" has unreliable prediction history.${extra} ` +
      `Total confidence adjustment: ${adj}.`
    );
  }

  if (hasBenchmarkHurts) {
    return (
      `Caution: analog enrichment historically degrades calibration in cluster ` +
      `"${clusterId}". Total confidence adjustment: ${adj}.`
    );
  }

  if (hasOverconfidenceBias) {
    return (
      `Caution: systematic overconfidence detected across prior cases. ` +
      `Total confidence adjustment: ${adj}.`
    );
  }

  if (hasBenchmarkHelps && hasAnalogSupport && analogCount >= 3) {
    return (
      `Strong support: ${analogCount} analog(s) (avg similarity ${avgSimilarity.toFixed(2)}), ` +
      `reliable cluster, and positive benchmark history. Total confidence adjustment: ${adj}.`
    );
  }

  if (hasBenchmarkHelps) {
    return (
      `Supported: cluster "${clusterId}" is reliable with positive benchmark history. ` +
      `Total confidence adjustment: ${adj}.`
    );
  }

  if (hasAnalogSupport && analogCount > 0) {
    return (
      `Moderate support: ${analogCount} analog(s) reinforce this setup (avg similarity ` +
      `${avgSimilarity.toFixed(2)}). Cluster reliability is neutral or unknown. Total adjustment: ${adj}.`
    );
  }

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

export const buildFomcPredictionExplanation = (
  result: FomcKnowledgeEnrichedResult,
  horizon: string,
): FomcPredictionExplanation => {
  const pred = result.predictions.find((p) => p.horizon === horizon);
  if (!pred) {
    throw new Error(
      `buildFomcPredictionExplanation: no prediction found for horizon "${horizon}". ` +
        `Available: ${result.predictions.map((p) => p.horizon).join(", ")}.`,
    );
  }

  const themeKey = resolveThemeKeyFromPrediction(result.fomc_event, result.context);
  const clusterId = buildFomcClusterId(themeKey);

  const analogBoost = pred.analog_boost;
  const reliabilityAdj = result.reliability.reliability_adjustment;
  const knowledgeAdj = result.knowledge.knowledge_adjustment;

  const totalAdjustment = round2(analogBoost + reliabilityAdj + knowledgeAdj);
  const baseConfidence = round2(pred.confidence - totalAdjustment);

  const confidenceBreakdown: FomcAdjustmentBreakdown = {
    base_confidence: baseConfidence,
    analog_boost: analogBoost,
    reliability_adjustment: reliabilityAdj,
    knowledge_adjustment: knowledgeAdj,
    total_adjustment: totalAdjustment,
    final_confidence: pred.confidence,
  };

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
    surprise_direction: result.fomc_event.surprise_direction,
    analog_count: result.analogs.length,
    confidence_breakdown: confidenceBreakdown,
    evidence: allEvidence,
    cautions,
    supports,
    explanation_summary: explanationSummary,
    generated_at: new Date().toISOString(),
  };
};

export const buildFomcPredictionExplanations = (
  result: FomcKnowledgeEnrichedResult,
): FomcPredictionExplanation[] =>
  result.predictions.map((pred) =>
    buildFomcPredictionExplanation(result, pred.horizon),
  );
