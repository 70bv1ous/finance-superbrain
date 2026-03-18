/**
 * Failure memory (Phase 7C — hardened in Phase 7C.1).
 *
 * Tracks signal-type categories where trades consistently lose money.
 * When a pattern crosses a suppression threshold it is marked `isSuppressed`.
 *
 * SUPPRESSION CRITERIA (either triggers suppression, minimum sample required):
 *   1. failureRate > DEFAULT_FAILURE_RATE_THRESHOLD (70 %)
 *      — catches statistically poor signal types over the long run.
 *   2. consecutiveLosses ≥ DEFAULT_CONSECUTIVE_LOSS_THRESHOLD (5 in a row)
 *      — catches sudden regime shifts before enough data for the win-rate test.
 *
 * RECOVERY (Phase 7C.1 addition):
 *   Suppression is never permanent.  After suppression criteria fire, the
 *   most-recent RECOVERY_MIN_SAMPLE (5) trades are inspected:
 *     - if recent win rate ≥ RECOVERY_WIN_RATE_THRESHOLD (60 %) → recovering
 *     - OR if the most recent RECOVERY_CLEAN_STREAK (3) are all wins → recovering
 *   When recovering: isSuppressed is set to false and isRecovering = true.
 *   The recovery note appears in `reason`.
 *
 *   This prevents permanent suppression when a market regime normalises,
 *   while still requiring positive recent evidence — not just passage of time.
 *
 * All functions are pure and deterministic.
 */

import type { TradeAttributionRecord } from "./attribution_store.js";
import { keyFromRecord } from "./signal_memory.js";

// ─── Suppression thresholds ───────────────────────────────────────────────────

/**
 * Minimum sample size before failure suppression can fire.
 * Below this, patterns are tracked but never suppressed.
 */
export const DEFAULT_FAILURE_MIN_SAMPLE_SIZE = 10;

/** Failure rate above which the category is suppressed. */
export const DEFAULT_FAILURE_RATE_THRESHOLD = 0.70;

/** Number of consecutive trailing losses that triggers suppression. */
export const DEFAULT_CONSECUTIVE_LOSS_THRESHOLD = 5;

// ─── Recovery thresholds (Phase 7C.1) ────────────────────────────────────────

/**
 * Minimum recent trades required before recovery can be evaluated.
 * Must be less than DEFAULT_FAILURE_MIN_SAMPLE_SIZE.
 */
export const RECOVERY_MIN_SAMPLE = 5;

/**
 * Recent win rate at or above which the pattern is considered recovering.
 * Deliberately higher than the 52 % "above average" threshold — recovery
 * requires a clear positive signal, not marginal improvement.
 */
export const RECOVERY_WIN_RATE_THRESHOLD = 0.60;

/**
 * Number of consecutive wins at the tail required for recovery via clean streak.
 * Provides a fast-path to recovery when the very last trades are all positive.
 */
export const RECOVERY_CLEAN_STREAK = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Failure record for a single signal-type category.
 *
 * `isSuppressed = true` → adaptive decision layer will hard-block this signal.
 * `isSuppressed = false, isRecovering = true` → was suppressed but recent
 *   evidence is positive; trades are allowed but noted as "monitoring recovery".
 */
export type FailureSignal = {
  /** Composite key, e.g. "nfp|short|weak_conf|weak_rel". */
  key: string;
  /** Fraction of all trades that were losses (1 − winRate). */
  failureRate: number;
  /** Number of consecutive losses at the tail of the chronological series. */
  consecutiveLosses: number;
  /**
   * True when either suppression criterion is met AND recovery is not detected.
   * The adaptive decision layer hard-blocks trades when this is true.
   */
  isSuppressed: boolean;
  /**
   * True when suppression criteria would have fired but recent trades show
   * clear improvement.  The pattern is still on watch — trust is earned back
   * incrementally.  isSuppressed = false when isRecovering = true.
   */
  isRecovering: boolean;
  /** Human-readable explanation of the suppression/recovery decision. */
  reason: string;
};

/** Immutable collection of failure signals. */
export type FailureMemoryStore = {
  readonly entries: readonly FailureSignal[];
};

// ─── Store construction ───────────────────────────────────────────────────────

/**
 * Build a FailureMemoryStore from attribution records.
 *
 * Records are grouped by the composite signal-memory key.  For each group:
 *   1. Compute overall failure rate and consecutive trailing losses.
 *   2. Determine suppression (requires minimum sample + at least one criterion).
 *   3. If suppressed, check recent trades for recovery evidence.
 *
 * @param records                  Attribution records to analyse.
 * @param failureRateThreshold     Failure rate above which suppression fires.
 * @param consecutiveLossThreshold Trailing losses needed to trigger suppression.
 * @param minSampleSize            Minimum records before suppression applies.
 */
export const buildFailureMemory = (
  records: readonly TradeAttributionRecord[],
  failureRateThreshold     = DEFAULT_FAILURE_RATE_THRESHOLD,
  consecutiveLossThreshold = DEFAULT_CONSECUTIVE_LOSS_THRESHOLD,
  minSampleSize            = DEFAULT_FAILURE_MIN_SAMPLE_SIZE,
): FailureMemoryStore => {
  if (records.length === 0) return { entries: [] };

  // Group by composite key
  const groups = new Map<string, TradeAttributionRecord[]>();
  for (const record of records) {
    const key = keyFromRecord(record);
    const existing = groups.get(key);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const entries: FailureSignal[] = [];

  for (const [key, recs] of groups) {
    const tradeCount = recs.length;

    const losses      = recs.filter((r) => !r.isWin).length;
    const failureRate = Number((losses / tradeCount).toFixed(4));

    // Chronological sort — needed for both consecutive-loss and recovery checks
    const sorted = [...recs].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

    // Consecutive trailing losses from the end of the chronological series
    let consecutiveLosses = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (!sorted[i]!.isWin) {
        consecutiveLosses++;
      } else {
        break;
      }
    }

    // ── Suppression check ────────────────────────────────────────────────────
    const hasMinSample            = tradeCount >= minSampleSize;
    const suppressedByFailureRate = hasMinSample && failureRate > failureRateThreshold;
    const suppressedByConsecutive = hasMinSample && consecutiveLosses >= consecutiveLossThreshold;
    let isSuppressed              = suppressedByFailureRate || suppressedByConsecutive;

    // ── Recovery check (Phase 7C.1) ───────────────────────────────────────────
    //
    // Only evaluated when suppression would have fired.
    // Looks at the most-recent RECOVERY_MIN_SAMPLE trades for positive evidence.
    let isRecovering = false;

    if (isSuppressed) {
      const recentRecs = sorted.slice(-RECOVERY_MIN_SAMPLE);
      if (recentRecs.length >= RECOVERY_MIN_SAMPLE) {
        const recentWins    = recentRecs.filter((r) => r.isWin).length;
        const recentWinRate = recentWins / recentRecs.length;

        // Clean streak: last RECOVERY_CLEAN_STREAK records are all wins
        const cleanStreakRecs = sorted.slice(-RECOVERY_CLEAN_STREAK);
        const hasCleanStreak =
          cleanStreakRecs.length >= RECOVERY_CLEAN_STREAK &&
          cleanStreakRecs.every((r) => r.isWin);

        isRecovering = recentWinRate >= RECOVERY_WIN_RATE_THRESHOLD || hasCleanStreak;

        if (isRecovering) {
          // Lift suppression — positive evidence overrides the historical failure
          isSuppressed = false;
        }
      }
    }

    // ── Build reason string ────────────────────────────────────────────────────
    let reason: string;

    if (!isSuppressed && !isRecovering) {
      if (!hasMinSample) {
        reason =
          `no_suppression: n=${tradeCount} < minSample=${minSampleSize}` +
          ` (failureRate=${(failureRate * 100).toFixed(1)}%,` +
          ` consecutiveLosses=${consecutiveLosses})`;
      } else {
        reason =
          `no_suppression: failureRate=${(failureRate * 100).toFixed(1)}%` +
          ` ≤ ${(failureRateThreshold * 100).toFixed(0)}%,` +
          ` consecutiveLosses=${consecutiveLosses} < ${consecutiveLossThreshold}`;
      }
    } else if (isRecovering) {
      // Build the original suppression reason, then append recovery override
      const suppressionBase =
        suppressedByFailureRate
          ? `failureRate=${(failureRate * 100).toFixed(1)}% > ${(failureRateThreshold * 100).toFixed(0)}%`
          : `consecutiveLosses=${consecutiveLosses} ≥ ${consecutiveLossThreshold}`;
      reason =
        `recovering: criteria_met(${suppressionBase}) BUT` +
        ` recent_${RECOVERY_MIN_SAMPLE}_trades show improvement` +
        ` → suppression lifted, monitoring recovery`;
    } else if (suppressedByFailureRate && suppressedByConsecutive) {
      reason =
        `suppressed: failureRate=${(failureRate * 100).toFixed(1)}%` +
        ` > ${(failureRateThreshold * 100).toFixed(0)}%` +
        ` AND consecutiveLosses=${consecutiveLosses} ≥ ${consecutiveLossThreshold}`;
    } else if (suppressedByFailureRate) {
      reason =
        `suppressed: failureRate=${(failureRate * 100).toFixed(1)}%` +
        ` > ${(failureRateThreshold * 100).toFixed(0)}%`;
    } else {
      reason =
        `suppressed: consecutiveLosses=${consecutiveLosses} ≥ ${consecutiveLossThreshold}`;
    }

    entries.push({
      key,
      failureRate,
      consecutiveLosses,
      isSuppressed,
      isRecovering,
      reason,
    });
  }

  return { entries };
};

// ─── Lookup ───────────────────────────────────────────────────────────────────

/**
 * Find the failure record for a given key.
 * Returns `undefined` when no records exist for that key.
 */
export const lookupFailureSignal = (
  store: FailureMemoryStore,
  key: string,
): FailureSignal | undefined =>
  store.entries.find((e) => e.key === key);
