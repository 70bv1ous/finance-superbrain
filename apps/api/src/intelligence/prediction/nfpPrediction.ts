import type { GeneratedPrediction } from "@finance-superbrain/schemas";

import { generatePredictionSet } from "../../lib/generatePrediction.js";
import type { PredictionStrategyProfile } from "../../lib/modelStrategyProfiles.js";
import type { MarketContextSnapshot } from "../context/marketContext.js";
import type { NfpEvent } from "../events/nfpEvent.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NfpPredictionHorizon = "1h" | "1d" | "5d";

export type NfpPredictionInput = {
  nfp_event: NfpEvent;
  context: MarketContextSnapshot;
  horizons: NfpPredictionHorizon[];
  model_version?: string;
};

export type NfpPredictionResult = {
  nfp_event: NfpEvent;
  context: MarketContextSnapshot;
  predictions: GeneratedPrediction[];
  model_version: string;
  generated_at: string;
};

// ─── Strategy selection ───────────────────────────────────────────────────────

/**
 * Resolve the prediction strategy profile for an NFP event.
 *
 * Strong or weak jobs surprises trigger the macro_dovish_sensitive profile
 * because employment data is the primary input to Federal Reserve rate policy.
 * A strong beat raises the bar for rate cuts (hawkish implication); a miss
 * lowers it (dovish implication). Both cases create directional rate-sensitive
 * moves in bonds and equity markets.
 *
 * Inline readings in elevated volatility use contrarian_regime_aware to
 * capture mean-reversion when consensus expectations are already priced with
 * high uncertainty.
 */
const resolveStrategy = (
  nfpEvent: NfpEvent,
  context: MarketContextSnapshot,
): PredictionStrategyProfile => {
  const { surprise_direction } = nfpEvent;
  const { volatility_regime } = context;

  if (surprise_direction === "strong" || surprise_direction === "weak") {
    return "macro_dovish_sensitive";
  }

  if (volatility_regime === "elevated" || volatility_regime === "high") {
    return "contrarian_regime_aware";
  }

  return "baseline";
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const generateNfpPrediction = (input: NfpPredictionInput): NfpPredictionResult => {
  const strategy = resolveStrategy(input.nfp_event, input.context);
  const model_version = input.model_version ?? "nfp-engine-v1";

  const predictions = generatePredictionSet(
    {
      event: input.nfp_event.parsed_event,
      horizons: input.horizons,
      model_version,
    },
    strategy,
  );

  return {
    nfp_event: input.nfp_event,
    context: input.context,
    predictions,
    model_version,
    generated_at: new Date().toISOString(),
  };
};
