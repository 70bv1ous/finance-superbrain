import type { CpiMemoryCase } from "../memory/memoryCaseBuilder.js";
import type { CpiMemoryCaseStore } from "../memory/cpiMemoryCaseStore.js";
import type { CpiEvent, CpiSurpriseDirection } from "../events/cpiEvent.js";
import type { FedStance, MacroRegime, MarketContextSnapshot, VolatilityRegime } from "../context/marketContext.js";

// ─── Surprise magnitude band ──────────────────────────────────────────────────

export type SurpriseBand = "small" | "medium" | "large";

/**
 * Bucket absolute surprise in basis-points into three bands:
 *   small:  ≤ 10 bp   (noise range, essentially inline)
 *   medium: 11–25 bp  (clear miss, single standard deviation)
 *   large:  > 25 bp   (significant beat/miss)
 */
export const resolveSurpriseBand = (surpriseBp: number): SurpriseBand => {
  const abs = Math.abs(surpriseBp);
  if (abs <= 10) return "small";
  if (abs <= 25) return "medium";
  return "large";
};

// ─── Analog signal breakdown ──────────────────────────────────────────────────

export type CpiAnalogSignals = {
  direction_match: boolean;
  band_match: boolean;
  fed_stance_match: boolean;
  macro_regime_match: boolean;
  vol_regime_match: boolean;
};

// ─── Analog match record ──────────────────────────────────────────────────────

export type CpiAnalogMatch = {
  case_id: string;
  period: string;
  similarity: number;
  signals: CpiAnalogSignals;
  verdict: CpiMemoryCase["verdict"];
  lesson_summary: string;
  surprise_direction: CpiSurpriseDirection;
  surprise_bp: number;
  fed_policy_stance: FedStance;
  macro_regime: MacroRegime;
  volatility_regime: VolatilityRegime;
};

// ─── Similarity scoring ───────────────────────────────────────────────────────

/**
 * Weighted structural similarity between a live CPI event + context and a
 * stored CpiMemoryCase.
 *
 * Weights reflect the empirical importance of each dimension for CPI-driven
 * market moves. Direction dominates because it sets the directional bias.
 * Fed stance is next — whether the Fed has room to respond matters.
 */
const WEIGHTS = {
  direction: 0.40,
  band: 0.20,
  fed: 0.20,
  macro: 0.12,
  vol: 0.08,
} as const;

const scoreCase = (
  event: CpiEvent,
  context: MarketContextSnapshot,
  stored: CpiMemoryCase,
): { score: number; signals: CpiAnalogSignals } => {
  const direction_match =
    event.surprise_direction === stored.cpi_event.surprise_direction;

  const band_match =
    resolveSurpriseBand(event.surprise_bp) ===
    resolveSurpriseBand(stored.cpi_event.surprise_bp);

  const fed_stance_match =
    context.fed_policy_stance === stored.context.fed_policy_stance;

  const macro_regime_match =
    context.macro_regime === stored.context.macro_regime;

  const vol_regime_match =
    context.volatility_regime === stored.context.volatility_regime;

  const score = Number(
    (
      (direction_match ? WEIGHTS.direction : 0) +
      (band_match ? WEIGHTS.band : 0) +
      (fed_stance_match ? WEIGHTS.fed : 0) +
      (macro_regime_match ? WEIGHTS.macro : 0) +
      (vol_regime_match ? WEIGHTS.vol : 0)
    ).toFixed(2),
  );

  return {
    score,
    signals: {
      direction_match,
      band_match,
      fed_stance_match,
      macro_regime_match,
      vol_regime_match,
    },
  };
};

// ─── Public API ───────────────────────────────────────────────────────────────

export type FindCpiAnalogsOptions = {
  /** Maximum number of analogs to return (default: 5) */
  limit?: number;
  /** Minimum similarity threshold to include a case (default: 0.20) */
  min_similarity?: number;
  /** Exclude a specific case ID — e.g. exclude the case being formed right now */
  exclude_id?: string;
};

/**
 * Retrieve the top-N most structurally similar past CPI memory cases.
 *
 * Matching dimensions (weighted):
 *   1. Surprise direction (hotter / cooler / inline) — 40 %
 *   2. Surprise magnitude band (small / medium / large) — 20 %
 *   3. Fed policy stance — 20 %
 *   4. Macro regime — 12 %
 *   5. Volatility regime — 8 %
 *
 * Returns records sorted by similarity descending, each carrying the
 * verdict, lesson summary, and per-dimension signal breakdown so the
 * confidence enrichment layer can reason about them.
 */
export const findCpiAnalogs = async (
  store: CpiMemoryCaseStore,
  event: CpiEvent,
  context: MarketContextSnapshot,
  options?: FindCpiAnalogsOptions,
): Promise<CpiAnalogMatch[]> => {
  const { limit = 5, min_similarity = 0.20, exclude_id } = options ?? {};

  const allCases = await store.list();

  return allCases
    .filter((c) => c.id !== exclude_id)
    .map((c) => {
      const { score, signals } = scoreCase(event, context, c);
      return { stored: c, score, signals };
    })
    .filter(({ score }) => score >= min_similarity)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ stored: c, score, signals }) => ({
      case_id: c.id,
      period: c.period,
      similarity: score,
      signals,
      verdict: c.verdict,
      lesson_summary: c.lesson_summary,
      surprise_direction: c.cpi_event.surprise_direction,
      surprise_bp: c.cpi_event.surprise_bp,
      fed_policy_stance: c.context.fed_policy_stance,
      macro_regime: c.context.macro_regime,
      volatility_regime: c.context.volatility_regime,
    }));
};
