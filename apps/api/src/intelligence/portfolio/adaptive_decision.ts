/**
 * Adaptive decision adjustment (Phase 7C — hardened in Phase 7C.1).
 *
 * ROLE SEPARATION (Phase 7C.1):
 *
 *   Calibration (7B) — PRIMARY layer.
 *     Global portfolio-level multiplier based on overall strategy performance.
 *     Range: [0.5, 1.5].  Includes drawdown haircut.  Driven by win rate,
 *     Sharpe, and peak-to-trough drawdown.
 *
 *   Trust (7C) — SECONDARY layer.
 *     Per-signal-type quality multiplier based on that bucket's own history.
 *     Range: [0.75, 1.25].  Lighter-touch: max ±25 % vs calibration's ±50 %.
 *     No drawdown haircut (portfolio-level concern handled by calibration).
 *
 *   Failure memory — PROTECTION layer.
 *     Hard blocks trades where a signal type is chronically harmful.
 *     Overrides trust and calibration.  Clears automatically when evidence
 *     of recovery is present (see failure_memory.ts).
 *
 * Final sizing chain:
 *   base_size
 *     × calibrationMultiplier  (7B — portfolio-wide)
 *     × effectiveTrustScore    (7C — per-signal-type, after combined guardrail)
 *   = final_size
 *
 * COMBINED MULTIPLIER GUARDRAIL (Phase 7C.1):
 *   combined = calibrationMultiplier × trust.score
 *   combined is clipped to [COMBINED_MULTIPLIER_MIN, COMBINED_MULTIPLIER_MAX]
 *
 *   Without the clip, worst cases are:
 *     max: 1.5 × 1.25 = 1.875  →  clipped to 1.60
 *     min: 0.5 × 0.75 = 0.375  →  clipped to 0.40
 *
 *   The clip fires only when calibration and trust are both near their extremes
 *   in the same direction.  In normal conditions (moderate calibration ≈ 1.0–1.2
 *   and trust within [0.9–1.1]) the guardrail never fires.
 *
 * All functions are pure and deterministic.
 */

import type { SignalTrust } from "./signal_trust.js";
import type { FailureSignal } from "./failure_memory.js";

// ─── Combined multiplier guardrail (Phase 7C.1) ───────────────────────────────

/**
 * Lower bound on `calibrationMultiplier × trustScore`.
 * Prevents double-penalisation from both layers being near their minimums.
 */
export const COMBINED_MULTIPLIER_MIN = 0.40;

/**
 * Upper bound on `calibrationMultiplier × trustScore`.
 * Prevents double-amplification from both layers being near their maximums.
 */
export const COMBINED_MULTIPLIER_MAX = 1.60;

// ─── Advisory thresholds ──────────────────────────────────────────────────────

/**
 * Trust score below which an advisory reason is added to the trace.
 * The trade is NOT hard-blocked — it is scaled down by the trust score.
 */
export const TRUST_SUPPRESS_THRESHOLD = 0.70;

/**
 * Trust score above which a boost advisory is added to the trace.
 */
export const TRUST_BOOST_THRESHOLD = 1.20;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Result of the adaptive decision layer for a single position.
 *
 * `adjustedSize` is the size after applying the effective trust multiplier
 * (which respects the combined guardrail) or 0 when suppressed by failure memory.
 *
 * `combinedMultiplierPreClip` and `combinedMultiplierFinal` are included for
 * full traceability of the combined guardrail.  When `wasClipped` is true,
 * the reason array will contain a `[adaptive_7C.1] guardrail_clipped` entry.
 */
export type AdaptiveDecisionResult = {
  /** Final size after adaptive layer (0 if suppressed). */
  adjustedSize: number;
  /** True when failure memory has hard-blocked this signal type. */
  isSuppressed: boolean;
  /** The trust score from computeSignalTrust() that was applied. */
  trustScore: number;
  /** calibrationMultiplier × trust.score, before guardrail clipping. */
  combinedMultiplierPreClip: number;
  /** Combined multiplier after guardrail clipping to [MIN, MAX]. */
  combinedMultiplierFinal: number;
  /** True when the combined guardrail fired and changed the multiplier. */
  wasClipped: boolean;
  /** Ordered reasons explaining every adjustment made. */
  reason: string[];
};

// ─── Combined multiplier utility ──────────────────────────────────────────────

/**
 * Compute the effective combined multiplier (calibration × trust) after
 * applying the guardrail, and derive the effective trust score to apply
 * to a post-calibration base size.
 *
 * Formula:
 *   combined         = calibration × trust
 *   combinedCapped   = clamp(combined, MIN, MAX)
 *   effectiveTrust   = combinedCapped / calibration
 *
 * When calibration = 1.0 (default) this reduces to:
 *   effectiveTrust   = clamp(trust, MIN, MAX)
 *
 * @internal Used by applyAdaptiveDecision.
 */
const computeEffectiveTrust = (
  calibrationMultiplier: number,
  trustScore: number,
): {
  combinedPreClip: number;
  combinedFinal: number;
  wasClipped: boolean;
  effectiveTrustScore: number;
} => {
  const combined     = calibrationMultiplier * trustScore;
  const clampedLo    = Math.max(combined, COMBINED_MULTIPLIER_MIN);
  const combinedFinal = Math.min(clampedLo, COMBINED_MULTIPLIER_MAX);
  const wasClipped   = combinedFinal !== combined;
  // Derive what trust score to apply to the post-calibration base
  const effectiveTrustScore = calibrationMultiplier > 0
    ? combinedFinal / calibrationMultiplier
    : trustScore;
  return {
    combinedPreClip: Number(combined.toFixed(4)),
    combinedFinal: Number(combinedFinal.toFixed(4)),
    wasClipped,
    effectiveTrustScore: Number(effectiveTrustScore.toFixed(4)),
  };
};

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Apply the adaptive decision layer to a pre-sized, post-calibration position.
 *
 * @param baseSize              Size from sizePosition() — already includes
 *                              calibration multiplier.
 * @param trust                 From computeSignalTrust() or NEUTRAL_TRUST.
 * @param failureSignal         From lookupFailureSignal(), optional.
 *                              When present and isSuppressed=true → hard block.
 * @param calibrationMultiplier The Phase 7B multiplier that was already applied
 *                              to baseSize.  Required for the combined guardrail.
 *                              Default: 1.0 (backwards-compatible, no guardrail effect).
 */
export const applyAdaptiveDecision = (
  baseSize: number,
  trust: SignalTrust,
  failureSignal?: FailureSignal,
  /** Phase 7B calibration multiplier — needed for the combined guardrail. */
  calibrationMultiplier = 1.0,
): AdaptiveDecisionResult => {
  const TAG    = "[adaptive_7C.1]";
  const reason: string[] = [];

  // ── 1. Failure memory suppression (highest priority) ──────────────────────
  //
  // isSuppressed is already false when failure_memory detected recovery,
  // so we do not need to inspect isRecovering here.
  if (failureSignal?.isSuppressed) {
    reason.push(
      `${TAG} failure_suppressed: key="${failureSignal.key}"` +
      `, failureRate=${(failureSignal.failureRate * 100).toFixed(1)}%` +
      `, consecutiveLosses=${failureSignal.consecutiveLosses}` +
      ` → trade hard-blocked (size=0)`,
    );
    reason.push(`${TAG} failure_reason: ${failureSignal.reason}`);
    return {
      adjustedSize: 0,
      isSuppressed: true,
      trustScore: trust.score,
      combinedMultiplierPreClip: Number((calibrationMultiplier * trust.score).toFixed(4)),
      combinedMultiplierFinal: 0,
      wasClipped: false,
      reason,
    };
  }

  // Note if this signal was recently recovering (informational only)
  if (failureSignal?.isRecovering) {
    reason.push(
      `${TAG} failure_memory_recovering: key="${failureSignal.key}"` +
      ` — suppression lifted, monitoring recovery`,
    );
  }

  // ── 2. Combined multiplier guardrail ──────────────────────────────────────
  const { combinedPreClip, combinedFinal, wasClipped, effectiveTrustScore } =
    computeEffectiveTrust(calibrationMultiplier, trust.score);

  if (wasClipped) {
    reason.push(
      `${TAG} guardrail_clipped: calibration(${calibrationMultiplier})` +
      ` × trust(${trust.score}) = ${combinedPreClip}` +
      ` → clipped to ${combinedFinal}` +
      ` (bounds [${COMBINED_MULTIPLIER_MIN}, ${COMBINED_MULTIPLIER_MAX}])` +
      ` → effectiveTrustScore=${effectiveTrustScore}`,
    );
  }

  // ── 3. Apply effective trust score ────────────────────────────────────────
  const adjustedSize = Number((baseSize * effectiveTrustScore).toFixed(4));

  if (effectiveTrustScore < TRUST_SUPPRESS_THRESHOLD) {
    reason.push(
      `${TAG} trust_below_threshold: effectiveTrust=${effectiveTrustScore}` +
      ` < ${TRUST_SUPPRESS_THRESHOLD}` +
      ` → size reduced: ${baseSize} × ${effectiveTrustScore} = ${adjustedSize}`,
    );
  } else if (effectiveTrustScore > TRUST_BOOST_THRESHOLD) {
    reason.push(
      `${TAG} trust_above_boost_threshold: effectiveTrust=${effectiveTrustScore}` +
      ` > ${TRUST_BOOST_THRESHOLD}` +
      ` → size boosted: ${baseSize} × ${effectiveTrustScore} = ${adjustedSize}`,
    );
  } else {
    reason.push(
      `${TAG} trust_applied: effectiveTrust=${effectiveTrustScore}` +
      ` → size: ${baseSize} × ${effectiveTrustScore} = ${adjustedSize}`,
    );
  }

  // Append trust score's own reasoning (prefixed [trust_7C]) for full audit trail
  reason.push(...trust.reason);

  return {
    adjustedSize,
    isSuppressed: false,
    trustScore: trust.score,
    combinedMultiplierPreClip: combinedPreClip,
    combinedMultiplierFinal: combinedFinal,
    wasClipped,
    reason,
  };
};
