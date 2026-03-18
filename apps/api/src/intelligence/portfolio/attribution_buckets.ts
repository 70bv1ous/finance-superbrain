/**
 * Attribution bucketing helpers.
 *
 * Converts continuous numeric signals into coarse categorical buckets.
 * Bucketing is intentional: fine-grained slicing (e.g. per 0.01 confidence)
 * would overfit on small sample sizes. Three-way buckets give enough
 * resolution to detect systematic bias without curve-fitting noise.
 *
 * All bucket thresholds are documented in-line and must not be changed
 * without updating tests — they form part of the calibration contract.
 *
 * Phase 7B.2 adds two-level bucket variants (`*2Level`) for use by the
 * calibration layer, where the three-level buckets produce sample-size
 * fragmentation.  The original three-level functions are preserved unchanged.
 */

// ─── Confidence bucket ────────────────────────────────────────────────────────

export type ConfidenceBucket = "low" | "medium" | "high";

/**
 * Bucket a prediction confidence score (0–1) into three tiers.
 *
 *  low    : confidence < 0.50  → model is uncertain
 *  medium : 0.50 ≤ confidence ≤ 0.75
 *  high   : confidence > 0.75  → model is strongly committed
 */
export const bucketConfidence = (confidence: number): ConfidenceBucket => {
  if (confidence < 0.50) return "low";
  if (confidence <= 0.75) return "medium";
  return "high";
};

// ─── Reliability bucket ───────────────────────────────────────────────────────

export type ReliabilityBucket = "low" | "medium" | "high";

/**
 * Bucket an analog-reliability score (0–1) into three tiers.
 *
 *  low    : reliability < 0.40  → thin or poor analog support
 *  medium : 0.40 ≤ reliability ≤ 0.70
 *  high   : reliability > 0.70  → strong analog cluster
 */
export const bucketReliability = (reliability: number): ReliabilityBucket => {
  if (reliability < 0.40) return "low";
  if (reliability <= 0.70) return "medium";
  return "high";
};

// ─── Benchmark alignment bucket ───────────────────────────────────────────────

export type BenchmarkAlignmentBucket = "weak" | "neutral" | "strong";

/**
 * Bucket a benchmark-alignment score (0–1) into three tiers.
 *
 *  weak    : alignment < 0.30  → prediction goes against historical norms
 *  neutral : 0.30 ≤ alignment ≤ 0.70
 *  strong  : alignment > 0.70  → prediction aligns with historical base rate
 */
export const bucketBenchmarkAlignment = (
  alignment: number,
): BenchmarkAlignmentBucket => {
  if (alignment < 0.30) return "weak";
  if (alignment <= 0.70) return "neutral";
  return "strong";
};

// ─── Two-level bucket variants (Phase 7B.2) ───────────────────────────────────
//
// The three-level buckets above give fine-grained attribution labels but can
// fragment small calibration samples.  The two-level variants collapse to a
// single threshold, halving the bucket count and roughly doubling per-bucket
// sample sizes.  These are used by the calibration layer; the three-level
// variants remain for attribution labelling.

export type ConfidenceBucket2Level = "weak" | "strong";

/**
 * Bucket a confidence score into two tiers.
 *
 *  weak   : confidence < 0.60  → below the reliable-signal threshold
 *  strong : confidence ≥ 0.60  → model is meaningfully committed
 *
 * Threshold rationale: 0.60 sits above the coin-flip zone and below the
 * high-confidence tier from the three-level scheme, giving a clean split.
 */
export const bucketConfidence2Level = (
  confidence: number,
): ConfidenceBucket2Level =>
  confidence < 0.60 ? "weak" : "strong";

export type ReliabilityBucket2Level = "weak" | "strong";

/**
 * Bucket an analog-reliability score into two tiers.
 *
 *  weak   : reliability < 0.55  → thin or marginal analog support
 *  strong : reliability ≥ 0.55  → adequate analog cluster
 *
 * Threshold rationale: midpoint between the three-level thresholds (0.40
 * and 0.70), giving a balanced split.
 */
export const bucketReliability2Level = (
  reliability: number,
): ReliabilityBucket2Level =>
  reliability < 0.55 ? "weak" : "strong";

export type BenchmarkAlignmentBucket2Level = "weak" | "strong";

/**
 * Bucket a benchmark-alignment score into two tiers.
 *
 *  weak   : alignment < 0.50  → below neutral base rate
 *  strong : alignment ≥ 0.50  → at or above neutral base rate
 *
 * Threshold rationale: 0.50 is the natural midpoint — values above it
 * indicate the prediction directionally agrees with historical precedent.
 */
export const bucketBenchmark2Level = (
  alignment: number,
): BenchmarkAlignmentBucket2Level =>
  alignment < 0.50 ? "weak" : "strong";
