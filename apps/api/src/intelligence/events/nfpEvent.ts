import { randomUUID } from "node:crypto";

import type { ParsedEvent } from "@finance-superbrain/schemas";

import { parseFinanceEvent } from "../../lib/parseFinanceEvent.js";

// ─── Input type ───────────────────────────────────────────────────────────────

export type NfpRelease = {
  released_at: string;
  /** Report period, e.g. "2026-02" (month the data covers, not the release date) */
  period: string;
  /** Actual non-farm payrolls added, in thousands */
  actual_jobs_k: number;
  /** Market consensus expectation for jobs added, in thousands */
  expected_jobs_k: number;
  /** Prior month's jobs figure (unrevised), in thousands */
  prior_jobs_k?: number;
  /** Actual unemployment rate (%) */
  actual_unemployment_pct: number;
  /** Expected unemployment rate (%) */
  expected_unemployment_pct: number;
  /** Actual average hourly earnings, month-over-month % change */
  actual_avg_hourly_earnings_pct?: number;
  /** Expected average hourly earnings, month-over-month % change */
  expected_avg_hourly_earnings_pct?: number;
};

// ─── Event types ──────────────────────────────────────────────────────────────

/**
 * Primary jobs surprise direction.
 *
 *   strong  — payrolls beat consensus by more than INLINE_THRESHOLD_K.
 *   weak    — payrolls missed consensus by more than INLINE_THRESHOLD_K.
 *   inline  — payrolls within ±INLINE_THRESHOLD_K of consensus.
 */
export type NfpSurpriseDirection = "strong" | "weak" | "inline";

/**
 * Magnitude band for the payrolls surprise.
 *
 *   large_beat   > +75k
 *   beat         +25k to +75k
 *   inline       −25k to +25k
 *   miss         −75k to −25k
 *   large_miss   < −75k
 */
export type NfpJobsSurpriseBand =
  | "large_beat"
  | "beat"
  | "inline"
  | "miss"
  | "large_miss";

/**
 * Direction of the unemployment rate surprise relative to consensus.
 *
 *   better     actual < expected (lower unemployment)
 *   worse      actual > expected (higher unemployment)
 *   unchanged  actual == expected
 */
export type NfpUnemploymentDirection = "better" | "worse" | "unchanged";

export type NfpEvent = {
  id: string;
  released_at: string;
  period: string;
  actual_jobs_k: number;
  expected_jobs_k: number;
  prior_jobs_k: number | null;
  actual_unemployment_pct: number;
  expected_unemployment_pct: number;
  actual_avg_hourly_earnings_pct: number | null;
  expected_avg_hourly_earnings_pct: number | null;
  /** Payrolls surprise: actual − expected (thousands) */
  jobs_surprise_k: number;
  surprise_direction: NfpSurpriseDirection;
  jobs_surprise_band: NfpJobsSurpriseBand;
  unemployment_direction: NfpUnemploymentDirection;
  /** Unemployment surprise in percentage points: actual − expected */
  unemployment_surprise_ppt: number;
  parsed_event: ParsedEvent;
};

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Jobs surprise ≤ this (absolute, thousands) is treated as inline */
const INLINE_THRESHOLD_K = 25;
/** Jobs surprise > this (absolute, thousands) is a large beat/miss */
const LARGE_THRESHOLD_K = 75;

// ─── Internal helpers ─────────────────────────────────────────────────────────

const resolveSurpriseDirection = (surpriseK: number): NfpSurpriseDirection => {
  if (surpriseK > INLINE_THRESHOLD_K) return "strong";
  if (surpriseK < -INLINE_THRESHOLD_K) return "weak";
  return "inline";
};

const resolveJobsSurpriseBand = (surpriseK: number): NfpJobsSurpriseBand => {
  if (surpriseK > LARGE_THRESHOLD_K) return "large_beat";
  if (surpriseK > INLINE_THRESHOLD_K) return "beat";
  if (surpriseK < -LARGE_THRESHOLD_K) return "large_miss";
  if (surpriseK < -INLINE_THRESHOLD_K) return "miss";
  return "inline";
};

const resolveUnemploymentDirection = (
  actual: number,
  expected: number,
): NfpUnemploymentDirection => {
  const diff = Number((actual - expected).toFixed(2));
  if (diff < 0) return "better";
  if (diff > 0) return "worse";
  return "unchanged";
};

/**
 * Build the raw text that the prediction engine will parse.
 *
 * Strong: uses employment strength language to anchor growth / rate-persistence
 * sentiment (hawkish Fed implication).
 * Weak: uses labour weakness language to anchor rate-cut expectations (dovish implication).
 * Inline: neutral framing — no policy signal dominant.
 */
const buildNfpRawText = (release: NfpRelease, direction: NfpSurpriseDirection): string => {
  const jobsDiff = Math.abs(Math.round(release.actual_jobs_k - release.expected_jobs_k));
  const uDiff = Math.abs(
    Number((release.actual_unemployment_pct - release.expected_unemployment_pct).toFixed(2)),
  );

  if (direction === "strong") {
    return (
      `NFP report for ${release.period}. Non-farm payrolls came in at ${release.actual_jobs_k}k, ` +
      `beating consensus of ${release.expected_jobs_k}k by ${jobsDiff}k. ` +
      `Unemployment rate at ${release.actual_unemployment_pct}%. ` +
      `Strong labour market may restrict Federal Reserve rate cuts, pressuring rate-sensitive assets. ` +
      `Elevated employment data may increase inflationary pressure and support a hawkish Fed path.`
    );
  }

  if (direction === "weak") {
    return (
      `NFP report for ${release.period}. Non-farm payrolls came in at ${release.actual_jobs_k}k, ` +
      `missing consensus of ${release.expected_jobs_k}k by ${jobsDiff}k. ` +
      `Unemployment rate at ${release.actual_unemployment_pct}%. ` +
      `Weak labour market boosts Federal Reserve rate cut expectations and stimulus outlook. ` +
      `Labour weakness may support bonds and boost risk-on sentiment as rate cuts become more likely.`
    );
  }

  return (
    `NFP report for ${release.period}. Non-farm payrolls came in at ${release.actual_jobs_k}k, ` +
    `broadly in line with the ${release.expected_jobs_k}k consensus (${jobsDiff}k deviation). ` +
    `Unemployment rate at ${release.actual_unemployment_pct}%, ` +
    `versus expected ${release.expected_unemployment_pct}% (${uDiff}ppt deviation). ` +
    `No major labour market surprise — Federal Reserve policy outlook unchanged.`
  );
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const buildNfpEvent = (release: NfpRelease): NfpEvent => {
  const jobs_surprise_k = Number(
    (release.actual_jobs_k - release.expected_jobs_k).toFixed(1),
  );
  const unemployment_surprise_ppt = Number(
    (release.actual_unemployment_pct - release.expected_unemployment_pct).toFixed(2),
  );

  const surprise_direction = resolveSurpriseDirection(jobs_surprise_k);
  const jobs_surprise_band = resolveJobsSurpriseBand(jobs_surprise_k);
  const unemployment_direction = resolveUnemploymentDirection(
    release.actual_unemployment_pct,
    release.expected_unemployment_pct,
  );

  const rawText = buildNfpRawText(release, surprise_direction);

  const parsed_event = parseFinanceEvent({
    source_type: "headline",
    title: `NFP Report ${release.period}`,
    raw_text: rawText,
  });

  return {
    id: randomUUID(),
    released_at: release.released_at,
    period: release.period,
    actual_jobs_k: release.actual_jobs_k,
    expected_jobs_k: release.expected_jobs_k,
    prior_jobs_k: release.prior_jobs_k ?? null,
    actual_unemployment_pct: release.actual_unemployment_pct,
    expected_unemployment_pct: release.expected_unemployment_pct,
    actual_avg_hourly_earnings_pct: release.actual_avg_hourly_earnings_pct ?? null,
    expected_avg_hourly_earnings_pct: release.expected_avg_hourly_earnings_pct ?? null,
    jobs_surprise_k,
    surprise_direction,
    jobs_surprise_band,
    unemployment_direction,
    unemployment_surprise_ppt,
    parsed_event,
  };
};
