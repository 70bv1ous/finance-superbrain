/**
 * Calibration engine — the self-correcting core of Phase 7B.
 *
 * Takes historical performance (PerformanceSummary) and produces a
 * CalibrationFactor: a bounded multiplier applied to future position
 * sizing.  Rules are simple, explicit, and fully deterministic.
 *
 * Algorithm (in order):
 *   1. Gate on minimum sample size  → multiplier = 1.0 if insufficient
 *   2. Win-rate adjustment          → ±0.25 or ±0.10
 *   3. Sharpe-like adjustment       → ±0.15 or ±0.05
 *   4. Max-drawdown safety haircut  → -0.15 if drawdown ≥ 15%
 *   5. [7B.1] Coherence guard       → suppress conflicting small signals
 *   6. Clamp to [CALIBRATION_MIN, CALIBRATION_MAX]
 *
 * Phase 7B.1 hardenings applied here:
 *  - DEFAULT_MIN_SAMPLE_SIZE raised from 20 → 30.  With only 20 trades
 *    the win rate estimate has a standard error of ~11pp — far too wide
 *    to act on reliably.  30 trades gives ~9pp SE, materially better.
 *  - All threshold constants are now exported so they are testable and
 *    can be overridden for different deployment contexts.
 *  - Coherence guard (optional, opt-in): when win-rate and Sharpe signals
 *    point in opposite directions AND both are at the "small" tier
 *    (magnitude ≤ 0.10), both are suppressed.  Mixed small signals are
 *    not reliable — they tend to cancel in expectation and just add noise.
 *    The guard only fires when `enableCoherenceGuard: true` is passed,
 *    so Phase 7B callers remain unaffected.
 *
 * Blending (recent vs long-term):
 *   blendCalibrationFactors(recent, longTerm, recentWeight = 0.70)
 *
 * Sizing integration:
 *   applyCalibrationToSize(baseSize, factor)
 *   → returns baseSize × factor.multiplier, rounded to 4 dp
 *
 * Design constraints enforced:
 *  - No ML, no stochastic methods, no external state.
 *  - Same input → same output (deterministic).
 *  - Multiplier always in [0.5, 1.5].
 *  - Every adjustment has a named reason string.
 */

import type { PerformanceSummary } from "./performance_summary.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum multiplier — never size below 50% of base. */
export const CALIBRATION_MIN = 0.5;
/** Maximum multiplier — never size above 150% of base. */
export const CALIBRATION_MAX = 1.5;

/**
 * Minimum trades required before calibration fires.
 *
 * Phase 7B.1 change: raised from 20 → 30.
 * Rationale: with n=20 the binomial standard error on win rate is
 * ~11 percentage points (SE = sqrt(0.5×0.5/20) ≈ 0.112).  At n=30
 * SE drops to ~9pp, which is materially more reliable for a ±10pp
 * threshold adjustment.
 */
export const DEFAULT_MIN_SAMPLE_SIZE = 30;

// ─── Exported threshold constants (Phase 7B.1) ────────────────────────────────
//
// Exporting thresholds makes them testable in isolation and allows
// context-specific overrides without touching the algorithm.

/** Win rate above which the "strong" upward adjustment fires. */
export const WIN_RATE_STRONG_THRESHOLD    = 0.60;
/** Win rate above which the "above average" upward adjustment fires. */
export const WIN_RATE_ABOVE_AVG_THRESHOLD = 0.52;
/** Win rate below which the "poor" downward adjustment fires. */
export const WIN_RATE_POOR_THRESHOLD      = 0.35;
/** Win rate below which the "below average" downward adjustment fires. */
export const WIN_RATE_BELOW_AVG_THRESHOLD = 0.44;

/** Sharpe-like above which the "strong" upward adjustment fires. */
export const SHARPE_STRONG_THRESHOLD   = 2.0;
/** Sharpe-like above which the "adequate" upward adjustment fires. */
export const SHARPE_ADEQUATE_THRESHOLD = 1.0;
/** Sharpe-like below which the "weak" downward adjustment fires. */
export const SHARPE_WEAK_THRESHOLD     = 0.5;
// (sharpe < 0 uses literal 0, which needs no named constant)

/**
 * Adjustment magnitudes considered "small" for coherence guard purposes.
 * When win-rate and Sharpe both produce adjustments ≤ this in absolute
 * value but in opposite directions, the coherence guard suppresses both.
 */
export const COHERENCE_GUARD_SMALL_ADJ = 0.10;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A sizing calibration factor produced from historical performance.
 *
 * `multiplier` is always in [CALIBRATION_MIN, CALIBRATION_MAX].
 * `reason` lists every adjustment that contributed to the final value,
 * in application order — this makes the output fully explainable.
 */
export type CalibrationFactor = {
  multiplier: number;
  reason: string[];
};

// ─── Options ──────────────────────────────────────────────────────────────────

/**
 * Optional behavioural flags for `computeCalibrationFactor`.
 * All fields default to the conservative (Phase 7B-compatible) value.
 */
export type CalibrationOptions = {
  /**
   * Enable the coherence guard (Phase 7B.1).
   *
   * When true: if win-rate and Sharpe adjustments are both "small"
   * (abs ≤ COHERENCE_GUARD_SMALL_ADJ) and point in opposite directions,
   * both are suppressed.  Mixed small signals do not constitute a reliable
   * edge — suppressing them reduces noise-driven sizing changes.
   *
   * Default: false (Phase 7B behaviour preserved).
   */
  enableCoherenceGuard?: boolean;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const round4 = (v: number): number => Number(v.toFixed(4));
const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/**
 * Coherence guard (Phase 7B.1).
 *
 * When win-rate and Sharpe adjustments conflict in direction AND are both
 * small (abs ≤ COHERENCE_GUARD_SMALL_ADJ), suppress both to 0.
 *
 * Rationale: a system with e.g. win_rate=+0.10 and sharpe=-0.10 is sending
 * contradictory signals.  Win rate above 50% but poor risk-adjusted return
 * implies small wins and large losses — a regime where sizing up would be
 * particularly dangerous.  The guard zeroes both rather than letting them
 * accidentally cancel to a neutral outcome, which would hide the conflict.
 *
 * Mutates `reasons` in-place (appends explanation if guard fires).
 * Returns the (possibly zeroed) pair of adjustments.
 */
const applyCoherenceGuard = (
  winRateAdj: number,
  sharpeAdj: number,
  reasons: string[],
): { winRateAdj: number; sharpeAdj: number } => {
  if (winRateAdj === 0 || sharpeAdj === 0) {
    return { winRateAdj, sharpeAdj };
  }

  const conflict = Math.sign(winRateAdj) !== Math.sign(sharpeAdj);
  const bothSmall =
    Math.abs(winRateAdj) <= COHERENCE_GUARD_SMALL_ADJ &&
    Math.abs(sharpeAdj)  <= COHERENCE_GUARD_SMALL_ADJ;

  if (conflict && bothSmall) {
    reasons.push(
      `coherence_guard_fired: win_rate_adj(${winRateAdj > 0 ? "+" : ""}${winRateAdj})` +
      ` conflicts with sharpe_adj(${sharpeAdj > 0 ? "+" : ""}${sharpeAdj})` +
      ` — both ≤ ${COHERENCE_GUARD_SMALL_ADJ} and in opposite directions` +
      ` → both suppressed to prevent noise-driven adjustment`,
    );
    return { winRateAdj: 0, sharpeAdj: 0 };
  }

  return { winRateAdj, sharpeAdj };
};

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * Compute a CalibrationFactor from a PerformanceSummary.
 *
 * Returns multiplier = 1.0 (no adjustment) when `summary.tradeCount`
 * is below `minSampleSize`.  This prevents calibration from firing on
 * noisy early samples.
 *
 * @param summary        Output of computePerformanceSummary().
 * @param minSampleSize  Minimum trades required. Default: DEFAULT_MIN_SAMPLE_SIZE (30).
 * @param options        Optional Phase 7B.1 hardening flags.
 */
export const computeCalibrationFactor = (
  summary: PerformanceSummary,
  minSampleSize = DEFAULT_MIN_SAMPLE_SIZE,
  options: CalibrationOptions = {},
): CalibrationFactor => {

  // ── 1. Sample size gate ────────────────────────────────────────────────────
  if (summary.tradeCount < minSampleSize) {
    return {
      multiplier: 1.0,
      reason: [
        `insufficient_sample: n=${summary.tradeCount} < required=${minSampleSize}`,
      ],
    };
  }

  const reasons: string[] = [];

  // ── 2. Win-rate component ──────────────────────────────────────────────────
  //
  // Thresholds are exported constants (see WIN_RATE_* exports above).
  // Phase 7B.1: thresholds unchanged but now explicitly named constants
  // so they can be tested and overridden in isolation.
  //
  //  ≥ WIN_RATE_STRONG_THRESHOLD    (60%)  strong edge  → +0.25
  //  ≥ WIN_RATE_ABOVE_AVG_THRESHOLD (52%)  slight edge  → +0.10
  //  ≤ WIN_RATE_POOR_THRESHOLD      (35%)  poor         → -0.25
  //  ≤ WIN_RATE_BELOW_AVG_THRESHOLD (44%)  below avg    → -0.10
  //  else                                  neutral      →  0

  let winRateAdj = 0;
  if (summary.winRate >= WIN_RATE_STRONG_THRESHOLD) {
    winRateAdj = 0.25;
    reasons.push(`win_rate_strong: ${(summary.winRate * 100).toFixed(1)}% ≥ ${WIN_RATE_STRONG_THRESHOLD * 100}% → +0.25`);
  } else if (summary.winRate >= WIN_RATE_ABOVE_AVG_THRESHOLD) {
    winRateAdj = 0.10;
    reasons.push(`win_rate_above_avg: ${(summary.winRate * 100).toFixed(1)}% ≥ ${WIN_RATE_ABOVE_AVG_THRESHOLD * 100}% → +0.10`);
  } else if (summary.winRate <= WIN_RATE_POOR_THRESHOLD) {
    winRateAdj = -0.25;
    reasons.push(`win_rate_poor: ${(summary.winRate * 100).toFixed(1)}% ≤ ${WIN_RATE_POOR_THRESHOLD * 100}% → -0.25`);
  } else if (summary.winRate <= WIN_RATE_BELOW_AVG_THRESHOLD) {
    winRateAdj = -0.10;
    reasons.push(`win_rate_below_avg: ${(summary.winRate * 100).toFixed(1)}% ≤ ${WIN_RATE_BELOW_AVG_THRESHOLD * 100}% → -0.10`);
  } else {
    reasons.push(`win_rate_neutral: ${(summary.winRate * 100).toFixed(1)}% → 0`);
  }

  // ── 3. Sharpe-like component ───────────────────────────────────────────────
  //
  //  ≥ SHARPE_STRONG_THRESHOLD   (2.0)  excellent → +0.15
  //  ≥ SHARPE_ADEQUATE_THRESHOLD (1.0)  adequate  → +0.05
  //  < 0                                negative  → -0.20
  //  < SHARPE_WEAK_THRESHOLD     (0.5)  weak      → -0.10
  //  else                               acceptable →  0

  let sharpeAdj = 0;
  if (summary.sharpeLike >= SHARPE_STRONG_THRESHOLD) {
    sharpeAdj = 0.15;
    reasons.push(`sharpe_strong: ${summary.sharpeLike.toFixed(2)} ≥ ${SHARPE_STRONG_THRESHOLD} → +0.15`);
  } else if (summary.sharpeLike >= SHARPE_ADEQUATE_THRESHOLD) {
    sharpeAdj = 0.05;
    reasons.push(`sharpe_adequate: ${summary.sharpeLike.toFixed(2)} ≥ ${SHARPE_ADEQUATE_THRESHOLD} → +0.05`);
  } else if (summary.sharpeLike < 0) {
    sharpeAdj = -0.20;
    reasons.push(`sharpe_negative: ${summary.sharpeLike.toFixed(2)} < 0 → -0.20`);
  } else if (summary.sharpeLike < SHARPE_WEAK_THRESHOLD) {
    sharpeAdj = -0.10;
    reasons.push(`sharpe_weak: ${summary.sharpeLike.toFixed(2)} < ${SHARPE_WEAK_THRESHOLD} → -0.10`);
  } else {
    reasons.push(`sharpe_neutral: ${summary.sharpeLike.toFixed(2)} → 0`);
  }

  // ── 4. Max-drawdown safety haircut ─────────────────────────────────────────
  //
  // If the strategy has shown a peak-to-trough drawdown of ≥ 15%,
  // apply an additional protective haircut regardless of win rate or Sharpe.
  // This catches strategies that win often but blow up occasionally.

  let drawdownAdj = 0;
  if (summary.maxDrawdown >= 0.15) {
    drawdownAdj = -0.15;
    reasons.push(
      `max_drawdown_high: ${(summary.maxDrawdown * 100).toFixed(1)}% ≥ 15% → -0.15`,
    );
  }

  // ── 5. Coherence guard (Phase 7B.1 — opt-in) ──────────────────────────────
  //
  // When enabled: suppress conflicting small win-rate and Sharpe signals.
  // The drawdown haircut is not subject to the coherence guard — it is an
  // independent safety mechanism that should always apply.

  const guarded = options.enableCoherenceGuard
    ? applyCoherenceGuard(winRateAdj, sharpeAdj, reasons)
    : { winRateAdj, sharpeAdj };

  // ── 6. Accumulate and clamp ────────────────────────────────────────────────

  const adjustment = guarded.winRateAdj + guarded.sharpeAdj + drawdownAdj;
  const raw = 1.0 + adjustment;
  const clamped = clamp(raw, CALIBRATION_MIN, CALIBRATION_MAX);

  if (clamped !== raw) {
    reasons.push(
      `clamped: raw ${raw.toFixed(4)} → ${clamped.toFixed(4)} (bounds [${CALIBRATION_MIN}, ${CALIBRATION_MAX}])`,
    );
  }

  return {
    multiplier: round4(clamped),
    reason: reasons,
  };
};

// ─── Blending ─────────────────────────────────────────────────────────────────

/**
 * Blend two CalibrationFactors into one.
 *
 * Used to blend a recent-window factor (e.g. last 30 trades) with a
 * long-term factor (e.g. all trades) to avoid over-reacting to a short
 * run of good or bad luck.
 *
 *   multiplier = recentWeight × recent + (1 − recentWeight) × longTerm
 *
 * The result is clamped to [CALIBRATION_MIN, CALIBRATION_MAX].
 *
 * @param recent       Factor from a recent window of trades.
 * @param longTerm     Factor from the full history.
 * @param recentWeight Weight on the recent factor (default 0.70).
 */
export const blendCalibrationFactors = (
  recent: CalibrationFactor,
  longTerm: CalibrationFactor,
  recentWeight = 0.70,
): CalibrationFactor => {
  const ltWeight = 1 - recentWeight;
  const raw = recentWeight * recent.multiplier + ltWeight * longTerm.multiplier;
  const clamped = clamp(raw, CALIBRATION_MIN, CALIBRATION_MAX);

  const reasons = [
    `blended: recent(${recent.multiplier}, w=${recentWeight}) + long_term(${longTerm.multiplier}, w=${ltWeight.toFixed(2)}) = ${raw.toFixed(4)}`,
    ...recent.reason.map((r) => `recent> ${r}`),
    ...longTerm.reason.map((r) => `long_term> ${r}`),
  ];

  if (clamped !== raw) {
    reasons.push(
      `clamped: ${raw.toFixed(4)} → ${clamped.toFixed(4)} (bounds [${CALIBRATION_MIN}, ${CALIBRATION_MAX}])`,
    );
  }

  return {
    multiplier: round4(clamped),
    reason: reasons,
  };
};

// ─── Sizing application ───────────────────────────────────────────────────────

/**
 * Apply a CalibrationFactor to a base position size.
 *
 * This is the integration point between the calibration layer (Phase 7B)
 * and the sizing function (Phase 7A).
 *
 *   calibratedSize = baseSize × factor.multiplier
 *
 * Result is rounded to 4 decimal places (same precision as sizePosition).
 * Returns 0 when baseSize ≤ 0.
 */
export const applyCalibrationToSize = (
  baseSize: number,
  factor: CalibrationFactor,
): number => {
  if (baseSize <= 0) return 0;
  return round4(baseSize * factor.multiplier);
};
