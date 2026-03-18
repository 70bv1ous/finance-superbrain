/**
 * Signal performance memory (Phase 7C).
 *
 * Tracks how each coarse signal-type category has actually performed in
 * portfolio terms, giving the adaptive layer a factual basis for adjusting
 * trust rather than relying solely on global calibration.
 *
 * Key design:
 *  - The composite key "{eventFamily}|{direction}|{conf2}|{rel2}" uses the
 *    two-level buckets from Phase 7B.2 to avoid sample-size fragmentation.
 *    Max distinct keys = 3 families × 2 directions × 2 conf × 2 rel = 24.
 *  - The store is read-only.  Rebuild it from records after each update.
 *  - Statistics computed here mirror those in performance_summary.ts so
 *    that signal_trust.ts can apply the same threshold logic consistently.
 */

import type { TradeAttributionRecord } from "./attribution_store.js";
import {
  bucketConfidence2Level,
  bucketReliability2Level,
} from "./attribution_buckets.js";

// ─── Key ─────────────────────────────────────────────────────────────────────

/**
 * Composite key identifying a coarse signal-type category.
 *
 * Format: "{eventFamily}|{direction}|{conf2Level}_conf|{rel2Level}_rel"
 * Example: "cpi|long|strong_conf|weak_rel"
 */
export type SignalMemoryKey = string;

/**
 * Build the memory key from its component dimensions.
 *
 * Uses two-level bucket labels to keep key cardinality low.
 * Unknown event families are stored as-is (key remains unique).
 */
export const buildSignalMemoryKey = (
  eventFamily: string,
  direction: "long" | "short",
  confidenceBucket2Level: "weak" | "strong",
  reliabilityBucket2Level: "weak" | "strong",
): SignalMemoryKey =>
  `${eventFamily}|${direction}|${confidenceBucket2Level}_conf|${reliabilityBucket2Level}_rel`;

/**
 * Derive the memory key directly from a TradeAttributionRecord.
 * Convenience wrapper used by both signal_memory and failure_memory.
 */
export const keyFromRecord = (record: TradeAttributionRecord): SignalMemoryKey =>
  buildSignalMemoryKey(
    record.eventFamily,
    record.direction,
    bucketConfidence2Level(record.confidence),
    bucketReliability2Level(record.reliability),
  );

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Aggregated performance statistics for a single signal-type category.
 *
 * `avgReturn` is the mean return percentage (same scale as returnPct in
 * TradeAttributionRecord — percent of notional per trade).
 *
 * `sharpeLike` = avgReturn / returnStdDev, computed on this key's records.
 * Returns 0 when stdDev is 0 (all trades identical — neutral signal).
 */
export type SignalPerformanceMemory = {
  /** Composite key, e.g. "cpi|long|strong_conf|weak_rel". */
  key: SignalMemoryKey;
  /** Number of attribution records contributing to this entry. */
  tradeCount: number;
  /** Fraction of trades with pnl > 0 (0–1). */
  winRate: number;
  /** Mean return percentage per trade. */
  avgReturn: number;
  /** Sharpe-like ratio: avgReturn / returnStdDev (0 when stdDev = 0). */
  sharpeLike: number;
  /**
   * ISO timestamp of the most recent attribution record in this group.
   * Used by callers to assess staleness.
   */
  lastUpdated: string;
};

/** Immutable collection of per-key performance memory entries. */
export type SignalMemoryStore = {
  readonly entries: readonly SignalPerformanceMemory[];
};

// ─── Math helpers (intentionally private — avoids re-exporting from performance_summary) ──

const _mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
};

const _populationStdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const avg = _mean(values);
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

// ─── Store construction ───────────────────────────────────────────────────────

/**
 * Build a SignalMemoryStore by grouping attribution records into coarse
 * signal-type categories and computing per-group statistics.
 *
 * Records with identical keys are aggregated into a single
 * SignalPerformanceMemory entry.  Returns an empty store for empty input.
 *
 * Order of output entries is not guaranteed — use `lookupSignalMemory` to
 * retrieve a specific entry.
 */
export const buildSignalMemoryFromRecords = (
  records: readonly TradeAttributionRecord[],
): SignalMemoryStore => {
  if (records.length === 0) return { entries: [] };

  // Group records by composite key
  const groups = new Map<SignalMemoryKey, TradeAttributionRecord[]>();

  for (const record of records) {
    const key = keyFromRecord(record);
    const existing = groups.get(key);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const entries: SignalPerformanceMemory[] = [];

  for (const [key, recs] of groups) {
    const tradeCount = recs.length;

    const wins = recs.filter((r) => r.isWin).length;
    const winRate = Number((wins / tradeCount).toFixed(4));

    const returnValues = recs.map((r) => r.returnPct);
    const avgReturn    = Number(_mean(returnValues).toFixed(4));
    const returnStdDev = _populationStdDev(returnValues);
    const sharpeLike   = returnStdDev > 0
      ? Number((avgReturn / returnStdDev).toFixed(4))
      : 0;

    // Most-recent timestamp as the staleness marker
    let latestTs = "";
    for (const r of recs) {
      if (r.timestamp > latestTs) latestTs = r.timestamp;
    }

    entries.push({
      key,
      tradeCount,
      winRate,
      avgReturn,
      sharpeLike,
      lastUpdated: latestTs,
    });
  }

  return { entries };
};

// ─── Lookup ───────────────────────────────────────────────────────────────────

/**
 * Find the memory entry for a given key.
 * Returns `undefined` when no records exist for that key.
 */
export const lookupSignalMemory = (
  store: SignalMemoryStore,
  key: SignalMemoryKey,
): SignalPerformanceMemory | undefined =>
  store.entries.find((e) => e.key === key);
