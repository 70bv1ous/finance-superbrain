/**
 * Shared reliability signal computation helpers.
 *
 * All three event families (CPI, FOMC, NFP) use identical logic to:
 *   - classify analog pool strength
 *   - compute average similarity
 *   - compute the reliability confidence adjustment
 *   - resolve reliability flags
 *   - build the discipline note
 *   - apply a confidence adjustment to a predictions array
 *
 * Family-specific files import from here and add their own typed wrappers.
 * No event-family fields or theme dimensions are referenced here.
 */

// ─── Shared types ─────────────────────────────────────────────────────────────

/** How well the analog pool supports the current prediction. */
export type AnalogStrength = "strong" | "moderate" | "weak" | "none";

/**
 * Minimal cluster context shape consumed by the shared computation functions.
 * All three family-specific ClusterReliabilityContext types satisfy this.
 */
export type BaseClusterReliabilityContext = {
  cluster_id: string;
  /** "reliable" | "unreliable" | "insufficient_data" | "mixed" */
  reliability_signal: string;
  confidence_tendency: "high" | "moderate" | "low";
  /** "helps" | "hurts" | "neutral" | "insufficient_data" | "unknown" */
  benchmark_verdict: string;
  case_count: number;
};

/**
 * Minimal reliability flags shape consumed by `buildDisciplineNote`.
 * All three family-specific *ReliabilityFlags types satisfy this.
 */
export type BaseReliabilityFlags = {
  unreliable_cluster: boolean;
  benchmark_hurts: boolean;
  insufficient_history: boolean;
  strong_analog_support: boolean;
  benchmark_helps: boolean;
};

// ─── Internal math helpers ────────────────────────────────────────────────────

export const round2 = (v: number): number => Number(v.toFixed(2));
export const round4 = (v: number): number => Number(v.toFixed(4));
export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

// ─── Shared computation functions ─────────────────────────────────────────────

/**
 * Classify analog pool strength from count and average similarity.
 *
 *   strong    ≥ 3 analogs, avg similarity > 0.75
 *   moderate  ≥ 2 analogs, avg similarity ≥ 0.50
 *   weak      anything with at least one analog
 *   none      empty analog list
 */
export const resolveAnalogStrength = (
  analogs: { similarity: number }[],
): AnalogStrength => {
  if (analogs.length === 0) return "none";

  const avgSimilarity =
    analogs.reduce((sum, a) => sum + a.similarity, 0) / analogs.length;

  if (analogs.length >= 3 && avgSimilarity > 0.75) return "strong";
  if (analogs.length >= 2 && avgSimilarity >= 0.50) return "moderate";
  return "weak";
};

/** Average similarity across an analog list, rounded to 4 decimal places. */
export const computeAverageSimilarity = (
  analogs: { similarity: number }[],
): number => {
  if (analogs.length === 0) return 0;
  return round4(analogs.reduce((s, a) => s + a.similarity, 0) / analogs.length);
};

/**
 * Compute the bounded reliability adjustment for a prediction.
 *
 * Rules (additive, then clamped to [−0.08, +0.05]):
 *
 *   unreliable cluster           −0.05
 *   benchmark hurts              −0.05
 *   weak or no analogs           −0.02
 *   reliable cluster             +0.02
 *   benchmark helps              +0.02
 *   strong analog support        +0.01
 *   insufficient_data cluster     0.00
 */
export const computeReliabilityAdjustment = (
  strength: AnalogStrength,
  ctx: BaseClusterReliabilityContext,
): number => {
  let delta = 0;

  if (ctx.reliability_signal === "unreliable") delta -= 0.05;
  if (ctx.benchmark_verdict === "hurts") delta -= 0.05;
  if (ctx.reliability_signal === "reliable") delta += 0.02;
  if (ctx.benchmark_verdict === "helps") delta += 0.02;
  if (strength === "strong") delta += 0.01;
  if (strength === "weak" || strength === "none") delta -= 0.02;

  return round2(clamp(delta, -0.08, 0.05));
};

/**
 * Resolve the granular boolean flags describing which reliability conditions
 * were active for a given signal set.
 */
export const resolveReliabilityFlags = (
  strength: AnalogStrength,
  ctx: BaseClusterReliabilityContext,
): BaseReliabilityFlags => ({
  unreliable_cluster: ctx.reliability_signal === "unreliable",
  benchmark_hurts: ctx.benchmark_verdict === "hurts",
  insufficient_history:
    ctx.reliability_signal === "insufficient_data" || ctx.case_count < 3,
  strong_analog_support: strength === "strong",
  benchmark_helps:
    ctx.reliability_signal === "reliable" && ctx.benchmark_verdict === "helps",
});

/**
 * Build a one-line discipline note summarising the dominant reliability signal.
 * Highest-severity condition wins.
 *
 * @param familyLabel  Optional label inserted into the "no analogs" fallback
 *                     message (e.g. "FOMC", "NFP"). Omit for CPI/generic.
 */
export const buildDisciplineNote = (
  strength: AnalogStrength,
  ctx: BaseClusterReliabilityContext,
  adjustment: number,
  flags: BaseReliabilityFlags,
  familyLabel?: string,
): string => {
  if (strength === "none") {
    const prefix = familyLabel ? `${familyLabel} ` : "";
    return `No historical ${prefix}analogs available — prediction is baseline only.`;
  }

  if (flags.unreliable_cluster && flags.benchmark_hurts) {
    return (
      `Strong caution: cluster "${ctx.cluster_id}" has unreliable history` +
      ` and analog enrichment degrades calibration in this regime.` +
      ` Confidence dampened by ${Math.abs(adjustment).toFixed(2)}.`
    );
  }

  if (flags.unreliable_cluster) {
    return (
      `Caution: cluster "${ctx.cluster_id}" has unreliable prediction history.` +
      ` Confidence dampened by ${Math.abs(adjustment).toFixed(2)}.`
    );
  }

  if (flags.benchmark_hurts) {
    return (
      `Caution: analog enrichment historically degrades calibration` +
      ` in cluster "${ctx.cluster_id}". Confidence dampened by ${Math.abs(adjustment).toFixed(2)}.`
    );
  }

  if (flags.benchmark_helps && flags.strong_analog_support) {
    return (
      `Strong support: cluster "${ctx.cluster_id}" is reliable with` +
      ` validated analog reinforcement and strong similarity backing.`
    );
  }

  if (flags.benchmark_helps) {
    return `Supported: cluster "${ctx.cluster_id}" is reliable with positive benchmark history.`;
  }

  if (flags.insufficient_history) {
    return (
      `Insufficient cluster history for "${ctx.cluster_id}"` +
      ` (${ctx.case_count} prior case${ctx.case_count === 1 ? "" : "s"})` +
      ` — no reliability adjustment applied.`
    );
  }

  if (strength === "weak") {
    return (
      `Weak analog evidence (${ctx.case_count} cluster cases)` +
      ` — mild confidence penalty applied.`
    );
  }

  return `Moderate analog support — reliability-neutral cluster "${ctx.cluster_id}".`;
};

/**
 * Apply a confidence adjustment to every prediction in the array.
 * The new confidence is clamped to [lo, hi] and rounded to 2 decimal places.
 * The input array is not mutated.
 */
export const applyConfidenceAdjustment = <T extends { confidence: number }>(
  predictions: T[],
  adjustment: number,
  lo: number,
  hi: number,
): T[] =>
  predictions.map((pred) => ({
    ...pred,
    confidence: round2(clamp(pred.confidence + adjustment, lo, hi)),
  }));
