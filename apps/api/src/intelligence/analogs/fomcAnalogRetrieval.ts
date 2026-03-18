import type { FomcMemoryCase } from "../memory/fomcMemoryCaseBuilder.js";
import type { FomcMemoryCaseStore } from "../memory/fomcMemoryCaseStore.js";
import type { FomcEvent, FomcSurpriseDirection } from "../events/fomcEvent.js";
import type { MacroRegime, MarketContextSnapshot, VolatilityRegime } from "../context/marketContext.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FomcAnalogSignals = {
  direction_match: boolean;
  decision_type_match: boolean;
  guidance_tone_match: boolean;
  macro_regime_match: boolean;
  vol_regime_match: boolean;
};

export type FomcAnalogMatch = {
  case_id: string;
  period: string;
  similarity: number;
  signals: FomcAnalogSignals;
  verdict: FomcMemoryCase["verdict"];
  lesson_summary: string;
  surprise_direction: FomcSurpriseDirection;
  decision_type: "hike" | "cut" | "hold";
  guidance_tone: "hawkish" | "dovish" | "neutral";
  macro_regime: MacroRegime;
  volatility_regime: VolatilityRegime;
};

// ─── Similarity scoring ───────────────────────────────────────────────────────

/**
 * Weighted structural similarity for FOMC analog retrieval.
 *
 * Dimensions (sum = 1.00):
 *   surprise_direction  0.35  — hawkish / dovish / inline sets market direction
 *   decision_type       0.25  — hike / cut / hold encodes rate-path information
 *   guidance_tone       0.20  — qualitative signal beyond the number
 *   macro_regime        0.12  — market backdrop moderates the impact
 *   vol_regime          0.08  — convexity conditions affect tail reactions
 *
 * Note: `fed_policy_stance` is excluded because the FOMC decision itself IS
 * the Fed's stance.  Using it would double-count information already captured
 * in `surprise_direction` and `decision_type`.
 */
const WEIGHTS = {
  direction: 0.35,
  decision_type: 0.25,
  guidance_tone: 0.20,
  macro: 0.12,
  vol: 0.08,
} as const;

const scoreCase = (
  event: FomcEvent,
  context: MarketContextSnapshot,
  stored: FomcMemoryCase,
): { score: number; signals: FomcAnalogSignals } => {
  const direction_match =
    event.surprise_direction === stored.fomc_event.surprise_direction;

  const decision_type_match =
    event.decision_type === stored.fomc_event.decision_type;

  const guidance_tone_match =
    event.guidance_tone === stored.fomc_event.guidance_tone;

  const macro_regime_match =
    context.macro_regime === stored.context.macro_regime;

  const vol_regime_match =
    context.volatility_regime === stored.context.volatility_regime;

  const score = Number(
    (
      (direction_match ? WEIGHTS.direction : 0) +
      (decision_type_match ? WEIGHTS.decision_type : 0) +
      (guidance_tone_match ? WEIGHTS.guidance_tone : 0) +
      (macro_regime_match ? WEIGHTS.macro : 0) +
      (vol_regime_match ? WEIGHTS.vol : 0)
    ).toFixed(2),
  );

  return {
    score,
    signals: {
      direction_match,
      decision_type_match,
      guidance_tone_match,
      macro_regime_match,
      vol_regime_match,
    },
  };
};

// ─── Public API ───────────────────────────────────────────────────────────────

export type FindFomcAnalogsOptions = {
  limit?: number;
  min_similarity?: number;
  exclude_id?: string;
};

/**
 * Retrieve the top-N most structurally similar past FOMC memory cases.
 *
 * Matching dimensions (weighted):
 *   1. Surprise direction (hawkish / dovish / inline) — 35 %
 *   2. Decision type (hike / cut / hold)              — 25 %
 *   3. Guidance tone                                   — 20 %
 *   4. Macro regime                                    — 12 %
 *   5. Volatility regime                               —  8 %
 */
export const findFomcAnalogs = async (
  store: FomcMemoryCaseStore,
  event: FomcEvent,
  context: MarketContextSnapshot,
  options?: FindFomcAnalogsOptions,
): Promise<FomcAnalogMatch[]> => {
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
      surprise_direction: c.fomc_event.surprise_direction,
      decision_type: c.fomc_event.decision_type,
      guidance_tone: c.fomc_event.guidance_tone,
      macro_regime: c.context.macro_regime,
      volatility_regime: c.context.volatility_regime,
    }));
};
