/**
 * Signal trust score (Phase 7C — hardened in Phase 7C.1).
 *
 * PURPOSE (role separation — Phase 7C.1):
 *   Calibration (7B) = portfolio-wide performance adjustment.
 *     Operates on the global PerformanceSummary.  Can move the multiplier
 *     by up to ±0.40 (full range [0.5, 1.5]).  Drawdown haircut is included.
 *
 *   Trust (7C) = per-signal-type quality adjustment.
 *     Operates on a single coarse bucket (e.g. "cpi|long|strong_conf|weak_rel").
 *     Intentionally lighter-touch: adjustments are roughly HALF the calibration
 *     magnitudes, bounds are [TRUST_MIN=0.75, TRUST_MAX=1.25].  No drawdown
 *     haircut — that is a portfolio-level concern handled by calibration.
 *
 * WHY LIGHTER-TOUCH (Phase 7C.1 hardening):
 *   Both calibration and trust can be active simultaneously.  If trust used
 *   the same magnitude as calibration, the combined multiplier could reach
 *   1.5 × 1.5 = 2.25 (unacceptable amplification) or 0.5 × 0.5 = 0.25
 *   (excessive suppression).  Narrower trust bounds and halved adjustments
 *   ensure trust is a refinement layer, not a second calibration.  The
 *   combined-multiplier guardrail in adaptive_decision.ts is the final safety.
 *
 * Algorithm:
 *   1. Gate: tradeCount < minSampleSize → score = 1.0 (neutral — no evidence)
 *   2. Win-rate adjustment: ±0.15 (strong edge) or ±0.05 (mild edge)
 *   3. Sharpe-like adjustment: ±0.10 or ±0.03/-0.05
 *   4. Clamp to [TRUST_MIN, TRUST_MAX]
 *
 * Reason strings are prefixed with "[trust_7C]" so audit traces can
 * immediately distinguish trust adjustments from calibration adjustments.
 *
 * All functions are pure and deterministic.
 */

import type { SignalPerformanceMemory } from "./signal_memory.js";

// ─── Bounds ───────────────────────────────────────────────────────────────────

/**
 * Minimum trust score (Phase 7C.1 hardening: raised from 0.5 → 0.75).
 *
 * With max downward adjustments (win_rate_poor -0.15 + sharpe_negative -0.10 = -0.25),
 * raw minimum = 0.75, which exactly meets this bound.  The bound is a tight
 * safety net, not an artificial clamp.
 */
export const TRUST_MIN = 0.75;

/**
 * Maximum trust score (Phase 7C.1 hardening: lowered from 1.5 → 1.25).
 *
 * With max upward adjustments (win_rate_strong +0.15 + sharpe_strong +0.10 = +0.25),
 * raw maximum = 1.25, which exactly meets this bound.  Trust can boost
 * sizing by at most 25 % before the combined guardrail further limits it.
 */
export const TRUST_MAX = 1.25;

// ─── Sample gate ─────────────────────────────────────────────────────────────

/**
 * Minimum trades per bucket before trust diverges from 1.0.
 *
 * Equal to the calibration gate (DEFAULT_MIN_SAMPLE_SIZE = 30) so that
 * both layers require the same evidence standard before adjusting behaviour.
 */
export const DEFAULT_TRUST_MIN_SAMPLE_SIZE = 30;

// ─── Threshold constants ──────────────────────────────────────────────────────
//
// Thresholds mirror calibration.ts for consistent interpretation of signal
// quality.  The ADJUSTMENT MAGNITUDES (below) are halved relative to
// calibration, enforcing the lighter-touch role.

/** Win rate above which the "strong" upward trust adjustment fires. */
export const TRUST_WIN_RATE_STRONG_THRESHOLD    = 0.60;
/** Win rate above which the "above average" upward trust adjustment fires. */
export const TRUST_WIN_RATE_ABOVE_AVG_THRESHOLD = 0.52;
/** Win rate below which the "poor" downward trust adjustment fires. */
export const TRUST_WIN_RATE_POOR_THRESHOLD      = 0.35;
/** Win rate below which the "below average" downward trust adjustment fires. */
export const TRUST_WIN_RATE_BELOW_AVG_THRESHOLD = 0.44;

/** Sharpe-like above which the "strong" upward trust adjustment fires. */
export const TRUST_SHARPE_STRONG_THRESHOLD   = 2.0;
/** Sharpe-like above which the "adequate" upward trust adjustment fires. */
export const TRUST_SHARPE_ADEQUATE_THRESHOLD = 1.0;
/** Sharpe-like below which the "weak" downward trust adjustment fires. */
export const TRUST_SHARPE_WEAK_THRESHOLD     = 0.5;

// ─── Adjustment magnitudes (Phase 7C.1 hardening) ────────────────────────────
//
// These are roughly half the calibration magnitudes:
//
//   Calibration  Win rate: ±0.25 / ±0.10    Sharpe: ±0.15 / ±0.05 / -0.20 / -0.10
//   Trust        Win rate: ±0.15 / ±0.05    Sharpe: +0.10 / +0.03 / -0.10 / -0.05
//
// Net effect:  trust can shift score by at most ±0.25 (from 1.25 down to 0.75),
// versus calibration which can shift by ±0.40.

/** Win-rate strong adjustment (+). */
const ADJ_WIN_STRONG     =  0.15;
/** Win-rate above-average adjustment (+). */
const ADJ_WIN_ABOVE_AVG  =  0.05;
/** Win-rate poor adjustment (−). */
const ADJ_WIN_POOR       = -0.15;
/** Win-rate below-average adjustment (−). */
const ADJ_WIN_BELOW_AVG  = -0.05;

/** Sharpe strong adjustment (+). */
const ADJ_SHARPE_STRONG    =  0.10;
/** Sharpe adequate adjustment (+). */
const ADJ_SHARPE_ADEQUATE  =  0.03;
/** Sharpe negative adjustment (−). */
const ADJ_SHARPE_NEGATIVE  = -0.10;
/** Sharpe weak adjustment (−). */
const ADJ_SHARPE_WEAK      = -0.05;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Trust score for a coarse signal-type category.
 *
 * `score` is always in [TRUST_MIN=0.75, TRUST_MAX=1.25].
 * All reason strings are prefixed with "[trust_7C]" to distinguish them
 * from calibration reason strings in combined audit traces.
 *
 *  score > 1.0 → signal type performing above average → larger position
 *  score < 1.0 → signal type underperforming → smaller position
 *  score = 1.0 → neutral (below sample gate, or no clear edge detected)
 */
export type SignalTrust = {
  /** Bounded trust multiplier in [TRUST_MIN, TRUST_MAX]. */
  score: number;
  /** Ordered list of adjustments and reasons contributing to the score. */
  reason: string[];
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const round4 = (v: number): number => Number(v.toFixed(4));

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * Compute a SignalTrust from a SignalPerformanceMemory entry.
 *
 * Returns score = 1.0 when `memory.tradeCount` is below `minSampleSize`
 * — prevents trust from diverging on noisy early samples.
 *
 * All reason strings are prefixed "[trust_7C]" so they can be distinguished
 * from calibration reason strings when inspecting a combined trace.
 *
 * @param memory         From lookupSignalMemory().
 * @param minSampleSize  Minimum trades required. Default: DEFAULT_TRUST_MIN_SAMPLE_SIZE.
 */
export const computeSignalTrust = (
  memory: SignalPerformanceMemory,
  minSampleSize = DEFAULT_TRUST_MIN_SAMPLE_SIZE,
): SignalTrust => {
  const TAG = "[trust_7C]";

  // ── 1. Sample size gate ────────────────────────────────────────────────────
  if (memory.tradeCount < minSampleSize) {
    return {
      score: 1.0,
      reason: [
        `${TAG} insufficient_sample: n=${memory.tradeCount} < required=${minSampleSize}` +
        `, key="${memory.key}" → trust=1.0 (neutral, no evidence yet)`,
      ],
    };
  }

  const reasons: string[] = [
    `${TAG} key="${memory.key}" n=${memory.tradeCount}` +
    ` (lighter-touch than calibration: adjustments ≤ ±0.25, bounds [${TRUST_MIN}, ${TRUST_MAX}])`,
  ];

  // ── 2. Win-rate component ──────────────────────────────────────────────────
  let winRateAdj = 0;
  if (memory.winRate >= TRUST_WIN_RATE_STRONG_THRESHOLD) {
    winRateAdj = ADJ_WIN_STRONG;
    reasons.push(
      `${TAG} win_rate_strong: ${(memory.winRate * 100).toFixed(1)}%` +
      ` ≥ ${TRUST_WIN_RATE_STRONG_THRESHOLD * 100}% → +${ADJ_WIN_STRONG}`,
    );
  } else if (memory.winRate >= TRUST_WIN_RATE_ABOVE_AVG_THRESHOLD) {
    winRateAdj = ADJ_WIN_ABOVE_AVG;
    reasons.push(
      `${TAG} win_rate_above_avg: ${(memory.winRate * 100).toFixed(1)}%` +
      ` ≥ ${TRUST_WIN_RATE_ABOVE_AVG_THRESHOLD * 100}% → +${ADJ_WIN_ABOVE_AVG}`,
    );
  } else if (memory.winRate <= TRUST_WIN_RATE_POOR_THRESHOLD) {
    winRateAdj = ADJ_WIN_POOR;
    reasons.push(
      `${TAG} win_rate_poor: ${(memory.winRate * 100).toFixed(1)}%` +
      ` ≤ ${TRUST_WIN_RATE_POOR_THRESHOLD * 100}% → ${ADJ_WIN_POOR}`,
    );
  } else if (memory.winRate <= TRUST_WIN_RATE_BELOW_AVG_THRESHOLD) {
    winRateAdj = ADJ_WIN_BELOW_AVG;
    reasons.push(
      `${TAG} win_rate_below_avg: ${(memory.winRate * 100).toFixed(1)}%` +
      ` ≤ ${TRUST_WIN_RATE_BELOW_AVG_THRESHOLD * 100}% → ${ADJ_WIN_BELOW_AVG}`,
    );
  } else {
    reasons.push(`${TAG} win_rate_neutral: ${(memory.winRate * 100).toFixed(1)}% → 0`);
  }

  // ── 3. Sharpe-like component ───────────────────────────────────────────────
  let sharpeAdj = 0;
  if (memory.sharpeLike >= TRUST_SHARPE_STRONG_THRESHOLD) {
    sharpeAdj = ADJ_SHARPE_STRONG;
    reasons.push(
      `${TAG} sharpe_strong: ${memory.sharpeLike.toFixed(2)}` +
      ` ≥ ${TRUST_SHARPE_STRONG_THRESHOLD} → +${ADJ_SHARPE_STRONG}`,
    );
  } else if (memory.sharpeLike >= TRUST_SHARPE_ADEQUATE_THRESHOLD) {
    sharpeAdj = ADJ_SHARPE_ADEQUATE;
    reasons.push(
      `${TAG} sharpe_adequate: ${memory.sharpeLike.toFixed(2)}` +
      ` ≥ ${TRUST_SHARPE_ADEQUATE_THRESHOLD} → +${ADJ_SHARPE_ADEQUATE}`,
    );
  } else if (memory.sharpeLike < 0) {
    sharpeAdj = ADJ_SHARPE_NEGATIVE;
    reasons.push(
      `${TAG} sharpe_negative: ${memory.sharpeLike.toFixed(2)} < 0 → ${ADJ_SHARPE_NEGATIVE}`,
    );
  } else if (memory.sharpeLike < TRUST_SHARPE_WEAK_THRESHOLD) {
    sharpeAdj = ADJ_SHARPE_WEAK;
    reasons.push(
      `${TAG} sharpe_weak: ${memory.sharpeLike.toFixed(2)}` +
      ` < ${TRUST_SHARPE_WEAK_THRESHOLD} → ${ADJ_SHARPE_WEAK}`,
    );
  } else {
    reasons.push(`${TAG} sharpe_neutral: ${memory.sharpeLike.toFixed(2)} → 0`);
  }

  // ── 4. Accumulate and clamp ────────────────────────────────────────────────
  const raw     = 1.0 + winRateAdj + sharpeAdj;
  const clamped = clamp(raw, TRUST_MIN, TRUST_MAX);

  if (clamped !== raw) {
    reasons.push(
      `${TAG} clamped: raw ${raw.toFixed(4)} → ${clamped.toFixed(4)}` +
      ` (bounds [${TRUST_MIN}, ${TRUST_MAX}])`,
    );
  }

  return {
    score: round4(clamped),
    reason: reasons,
  };
};

/**
 * Neutral trust — used when no memory exists for a signal key.
 * Calling code should prefer returning this over throwing.
 */
export const NEUTRAL_TRUST: SignalTrust = {
  score: 1.0,
  reason: ["[trust_7C] no_memory: no prior trades found for this signal key → trust=1.0 (neutral)"],
};
