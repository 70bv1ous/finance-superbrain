import type { NfpMemoryCase } from "../memory/nfpMemoryCaseBuilder.js";
import type { NfpMemoryCaseStore } from "../memory/nfpMemoryCaseStore.js";
import type { NfpEvent, NfpSurpriseDirection, NfpJobsSurpriseBand, NfpUnemploymentDirection } from "../events/nfpEvent.js";
import type { MacroRegime, MarketContextSnapshot, VolatilityRegime } from "../context/marketContext.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NfpAnalogSignals = {
  direction_match: boolean;
  jobs_band_match: boolean;
  unemployment_direction_match: boolean;
  macro_regime_match: boolean;
  vol_regime_match: boolean;
};

export type NfpAnalogMatch = {
  case_id: string;
  period: string;
  similarity: number;
  signals: NfpAnalogSignals;
  verdict: NfpMemoryCase["verdict"];
  lesson_summary: string;
  surprise_direction: NfpSurpriseDirection;
  jobs_surprise_band: NfpJobsSurpriseBand;
  unemployment_direction: NfpUnemploymentDirection;
  macro_regime: MacroRegime;
  volatility_regime: VolatilityRegime;
};

// ─── Similarity scoring ───────────────────────────────────────────────────────

/**
 * Weighted structural similarity for NFP analog retrieval.
 *
 * Dimensions (sum = 1.00):
 *   surprise_direction       0.35  — strong / weak / inline sets market direction
 *   jobs_surprise_band       0.25  — magnitude of payrolls beat/miss drives reaction size
 *   unemployment_direction   0.20  — labour breadth beyond the headline number
 *   macro_regime             0.12  — market backdrop moderates the impact
 *   vol_regime               0.08  — convexity conditions affect tail reactions
 *
 * Note: `fed_policy_stance` is excluded because NFP data is itself the primary
 * input to the Fed's stance — including it would introduce feedback circularity.
 */
const WEIGHTS = {
  direction: 0.35,
  jobs_band: 0.25,
  unemployment_direction: 0.20,
  macro: 0.12,
  vol: 0.08,
} as const;

const scoreCase = (
  event: NfpEvent,
  context: MarketContextSnapshot,
  stored: NfpMemoryCase,
): { score: number; signals: NfpAnalogSignals } => {
  const direction_match =
    event.surprise_direction === stored.nfp_event.surprise_direction;

  const jobs_band_match =
    event.jobs_surprise_band === stored.nfp_event.jobs_surprise_band;

  const unemployment_direction_match =
    event.unemployment_direction === stored.nfp_event.unemployment_direction;

  const macro_regime_match =
    context.macro_regime === stored.context.macro_regime;

  const vol_regime_match =
    context.volatility_regime === stored.context.volatility_regime;

  const score = Number(
    (
      (direction_match ? WEIGHTS.direction : 0) +
      (jobs_band_match ? WEIGHTS.jobs_band : 0) +
      (unemployment_direction_match ? WEIGHTS.unemployment_direction : 0) +
      (macro_regime_match ? WEIGHTS.macro : 0) +
      (vol_regime_match ? WEIGHTS.vol : 0)
    ).toFixed(2),
  );

  return {
    score,
    signals: {
      direction_match,
      jobs_band_match,
      unemployment_direction_match,
      macro_regime_match,
      vol_regime_match,
    },
  };
};

// ─── Public API ───────────────────────────────────────────────────────────────

export type FindNfpAnalogsOptions = {
  limit?: number;
  min_similarity?: number;
  exclude_id?: string;
};

/**
 * Retrieve the top-N most structurally similar past NFP memory cases.
 *
 * Matching dimensions (weighted):
 *   1. Surprise direction (strong / weak / inline)                 — 35 %
 *   2. Jobs surprise band (large_beat / beat / inline / miss / …)  — 25 %
 *   3. Unemployment direction (better / worse / unchanged)          — 20 %
 *   4. Macro regime                                                  — 12 %
 *   5. Volatility regime                                             —  8 %
 */
export const findNfpAnalogs = async (
  store: NfpMemoryCaseStore,
  event: NfpEvent,
  context: MarketContextSnapshot,
  options?: FindNfpAnalogsOptions,
): Promise<NfpAnalogMatch[]> => {
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
      surprise_direction: c.nfp_event.surprise_direction,
      jobs_surprise_band: c.nfp_event.jobs_surprise_band,
      unemployment_direction: c.nfp_event.unemployment_direction,
      macro_regime: c.context.macro_regime,
      volatility_regime: c.context.volatility_regime,
    }));
};
