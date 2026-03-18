/**
 * Shared knowledge enrichment helper functions.
 *
 * All three event families (CPI, FOMC, NFP) use identical logic to select
 * and apply knowledge-base signals to live predictions. The helper functions
 * here operate on a minimal `KnowledgeEntryLike` interface that all three
 * family-specific KnowledgeEntry types satisfy.
 *
 * Nothing here is domain-specific — no event fields, no theme dimensions,
 * no family-specific cluster builders.
 */

// ─── Minimal knowledge entry interface ───────────────────────────────────────

/**
 * The fields from a family-specific KnowledgeEntry that the shared helpers
 * need. All three family types (CpiKnowledgeEntry, FomcKnowledgeEntry,
 * NfpKnowledgeEntry) satisfy this interface.
 */
export type KnowledgeEntryLike = {
  knowledge_type: string;
  cluster_ids: string[];
  summary: string;
  evidence_count: number;
};

// ─── Entry selection helpers ──────────────────────────────────────────────────

/**
 * True when a knowledge entry applies to the given cluster.
 * An entry is relevant if its `cluster_ids` is empty (cross-cluster pattern)
 * or includes the current prediction's cluster_id.
 */
export const isRelevantToCluster = (
  entry: KnowledgeEntryLike,
  clusterId: string,
): boolean =>
  entry.cluster_ids.length === 0 || entry.cluster_ids.includes(clusterId);

/** Select failure_mode entries relevant to the current prediction's cluster. */
export const filterActiveFailureModes = <T extends KnowledgeEntryLike>(
  entries: T[],
  clusterId: string,
): T[] =>
  entries
    .filter((e) => e.knowledge_type === "failure_mode")
    .filter((e) => isRelevantToCluster(e, clusterId));

/**
 * Find the first confidence_bias entry in the knowledge base.
 * Bias entries are global calibration signals (cluster_ids is typically empty).
 */
export const findConfidenceBiasEntry = <T extends KnowledgeEntryLike>(
  entries: T[],
): T | null =>
  entries.find((e) => e.knowledge_type === "confidence_bias") ?? null;

/** True when the entry represents systematic overconfidence. */
export const isOverconfidenceBias = (entry: KnowledgeEntryLike): boolean =>
  entry.summary.startsWith("Systematic overconfidence");

/** True when the entry represents systematic underconfidence. */
export const isUnderconfidenceBias = (entry: KnowledgeEntryLike): boolean =>
  entry.summary.startsWith("Systematic underconfidence");

// ─── Adjustment computation ───────────────────────────────────────────────────

/**
 * Compute the bounded knowledge adjustment.
 *
 * Rules (additive, then clamped to [−0.06, +0.02]):
 *
 *   1 active failure mode     −0.02
 *   2+ active failure modes   −0.04  (capped — further modes don't compound)
 *   overconfidence bias       −0.03
 *   underconfidence bias      +0.02
 *
 * Maximum caution  = −0.04 + −0.03 = −0.07 → clamped to −0.06
 * Maximum boost    = +0.02 (underconfidence lift only)
 */
export const computeKnowledgeAdjustment = (
  activeFailureModes: KnowledgeEntryLike[],
  biasEntry: KnowledgeEntryLike | null,
): number => {
  let delta = 0;

  if (activeFailureModes.length === 1) delta -= 0.02;
  else if (activeFailureModes.length >= 2) delta -= 0.04;

  if (biasEntry !== null) {
    if (isOverconfidenceBias(biasEntry)) delta -= 0.03;
    else if (isUnderconfidenceBias(biasEntry)) delta += 0.02;
  }

  // Clamp inline — avoids importing round2/clamp here
  const clamped = Math.min(Math.max(delta, -0.06), 0.02);
  return Number(clamped.toFixed(2));
};

// ─── Caution note builder ─────────────────────────────────────────────────────

/**
 * Build short caution notes to inject into prediction invalidations.
 *
 * At most 2 notes are produced (1 from failure modes, 1 from bias) to avoid
 * flooding the invalidations array.
 */
export const buildKnowledgeCautionNotes = (
  activeFailureModes: KnowledgeEntryLike[],
  biasEntry: KnowledgeEntryLike | null,
): string[] => {
  const notes: string[] = [];

  if (activeFailureModes.length > 0) {
    const topMode = activeFailureModes[0]!;
    const count = activeFailureModes.length;
    notes.push(
      count === 1
        ? `Knowledge caution: ${topMode.summary}`
        : `Knowledge caution: ${count} recurring failure patterns active — ${topMode.summary}`,
    );
  }

  if (biasEntry !== null) {
    if (isOverconfidenceBias(biasEntry)) {
      notes.push(
        `Knowledge bias: systematic overconfidence detected across ${biasEntry.evidence_count} prior cases — confidence dampened.`,
      );
    } else if (isUnderconfidenceBias(biasEntry)) {
      notes.push(
        `Knowledge bias: systematic underconfidence detected across ${biasEntry.evidence_count} prior cases — confidence lifted.`,
      );
    }
  }

  return notes;
};
