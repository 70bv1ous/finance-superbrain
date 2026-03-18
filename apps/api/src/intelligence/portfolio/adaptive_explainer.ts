/**
 * Adaptive decision trace and explainer (Phase 7C.1).
 *
 * A pure, deterministic formatter that computes a single structured trace
 * summarising every layer that influenced the final position size.
 *
 * Designed for:
 *  - audit trails in test assertions
 *  - log lines in production runs
 *  - debugging why a position was sized up, down, or suppressed
 *
 * Usage pattern:
 *   const trace = buildAdaptiveDecisionTrace(key, calibration, trust, failure);
 *   // inspect trace.combinedMultiplierFinal, trace.clipped, trace.reasons
 *   // pass calibrationMultiplier + trust.score to applyAdaptiveDecision for
 *   // the actual sizing.
 *
 * Layer identifiers in reason strings:
 *   [calib_7B]   — calibration layer (Phase 7B)
 *   [trust_7C]   — signal trust layer (Phase 7C)
 *   [adaptive_7C.1] — combined guardrail / adaptive decision (Phase 7C.1)
 *   [failure_7C] — failure memory layer (Phase 7C)
 */

import type { SignalTrust } from "./signal_trust.js";
import type { FailureSignal } from "./failure_memory.js";
import {
  COMBINED_MULTIPLIER_MIN,
  COMBINED_MULTIPLIER_MAX,
} from "./adaptive_decision.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Full trace of one adaptive decision.
 *
 * Fields map directly to the three-layer architecture:
 *  - calibrationMultiplier   ← 7B
 *  - trustScore              ← 7C
 *  - combined guardrail      ← 7C.1
 *  - failure suppression     ← 7C
 */
export type AdaptiveDecisionTrace = {
  /**
   * The signal-type key this trace describes,
   * e.g. "cpi|long|strong_conf|weak_rel".
   */
  key: string;

  // ── Layer 1: Calibration (7B) ──────────────────────────────────────────────

  /**
   * The Phase 7B portfolio-wide calibration multiplier.
   * 1.0 when calibration has not been applied or is neutral.
   */
  calibrationMultiplier: number;

  // ── Layer 2: Trust (7C) ───────────────────────────────────────────────────

  /**
   * The Phase 7C per-signal-type trust score.
   * 1.0 when trust is neutral (no evidence or below sample gate).
   */
  trustScore: number;

  // ── Layer 3: Combined guardrail (7C.1) ────────────────────────────────────

  /**
   * calibrationMultiplier × trustScore before the guardrail is applied.
   * This is the "raw" combined effect of both multipliers.
   */
  combinedMultiplierPreClip: number;

  /**
   * Combined multiplier after clipping to
   * [COMBINED_MULTIPLIER_MIN, COMBINED_MULTIPLIER_MAX].
   */
  combinedMultiplierFinal: number;

  /**
   * True when the guardrail clipped the combined multiplier.
   * A clip means the two layers were amplifying in the same direction
   * more than the system allows.
   */
  clipped: boolean;

  // ── Layer 4: Failure memory ───────────────────────────────────────────────

  /**
   * True when the failure memory has hard-blocked this signal type.
   * When true, final position size is forced to 0 regardless of trust.
   */
  failureSuppressed: boolean;

  /**
   * True when the pattern was suppressed but recent evidence shows recovery.
   * failureSuppressed will be false when this is true.
   */
  isRecovering: boolean;

  // ── Summary ───────────────────────────────────────────────────────────────

  /**
   * Ordered explanation strings from all layers, each tagged with its
   * layer identifier ([calib_7B], [trust_7C], [adaptive_7C.1], [failure_7C]).
   */
  reasons: string[];
};

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build an AdaptiveDecisionTrace that summarises all layers for a given
 * signal decision.
 *
 * This is a REPORT function — it does not modify any state, does not call
 * applyAdaptiveDecision, and does not produce a final size.  Use it to
 * inspect and log the decision before (or after) calling applyAdaptiveDecision.
 *
 * @param key                   Signal-type composite key.
 * @param calibrationMultiplier Phase 7B multiplier (from CalibrationFactor).
 * @param trust                 Phase 7C trust (from computeSignalTrust or NEUTRAL_TRUST).
 * @param failureSignal         Optional failure record (from lookupFailureSignal).
 */
export const buildAdaptiveDecisionTrace = (
  key: string,
  calibrationMultiplier: number,
  trust: SignalTrust,
  failureSignal?: FailureSignal,
): AdaptiveDecisionTrace => {
  const reasons: string[] = [];

  // ── Calibration layer ──────────────────────────────────────────────────────
  reasons.push(
    `[calib_7B] calibrationMultiplier=${calibrationMultiplier}` +
    ` (portfolio-wide adjustment from Phase 7B)`,
  );

  // ── Trust layer ───────────────────────────────────────────────────────────
  reasons.push(...trust.reason);

  // ── Combined guardrail ────────────────────────────────────────────────────
  const combinedPreClip  = Number((calibrationMultiplier * trust.score).toFixed(4));
  const combinedClamped  = Math.max(
    COMBINED_MULTIPLIER_MIN,
    Math.min(COMBINED_MULTIPLIER_MAX, combinedPreClip),
  );
  const combinedFinal    = Number(combinedClamped.toFixed(4));
  const clipped          = combinedFinal !== combinedPreClip;

  if (clipped) {
    reasons.push(
      `[adaptive_7C.1] guardrail_clipped: ${calibrationMultiplier} × ${trust.score}` +
      ` = ${combinedPreClip}` +
      ` → clamped to ${combinedFinal}` +
      ` (bounds [${COMBINED_MULTIPLIER_MIN}, ${COMBINED_MULTIPLIER_MAX}])`,
    );
  } else {
    reasons.push(
      `[adaptive_7C.1] guardrail_ok: ${calibrationMultiplier} × ${trust.score}` +
      ` = ${combinedPreClip}` +
      ` within [${COMBINED_MULTIPLIER_MIN}, ${COMBINED_MULTIPLIER_MAX}]`,
    );
  }

  // ── Failure memory layer ──────────────────────────────────────────────────
  const failureSuppressed = failureSignal?.isSuppressed ?? false;
  const isRecovering      = failureSignal?.isRecovering ?? false;

  if (failureSuppressed) {
    reasons.push(
      `[failure_7C] suppressed: key="${failureSignal!.key}"` +
      `, failureRate=${(failureSignal!.failureRate * 100).toFixed(1)}%` +
      `, consecutiveLosses=${failureSignal!.consecutiveLosses}` +
      ` → final size forced to 0`,
    );
  } else if (isRecovering) {
    reasons.push(
      `[failure_7C] recovering: key="${failureSignal!.key}"` +
      ` — suppression was warranted but recent evidence positive` +
      ` → trades allowed, monitoring`,
    );
  } else if (failureSignal) {
    reasons.push(
      `[failure_7C] ok: key="${failureSignal.key}"` +
      ` failureRate=${(failureSignal.failureRate * 100).toFixed(1)}%` +
      ` — no suppression`,
    );
  } else {
    reasons.push(`[failure_7C] no_entry: key="${key}" — no failure record exists`);
  }

  return {
    key,
    calibrationMultiplier,
    trustScore: trust.score,
    combinedMultiplierPreClip: combinedPreClip,
    combinedMultiplierFinal: combinedFinal,
    clipped,
    failureSuppressed,
    isRecovering,
    reasons,
  };
};
