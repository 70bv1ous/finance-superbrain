import type { GeneratedPrediction } from "@finance-superbrain/schemas";

import { generatePredictionSet } from "../../lib/generatePrediction.js";
import type { PredictionStrategyProfile } from "../../lib/modelStrategyProfiles.js";
import type { MarketContextSnapshot } from "../context/marketContext.js";
import type { FomcEvent } from "../events/fomcEvent.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FomcPredictionHorizon = "1h" | "1d" | "5d";

export type FomcPredictionInput = {
  fomc_event: FomcEvent;
  context: MarketContextSnapshot;
  horizons: FomcPredictionHorizon[];
  model_version?: string;
};

export type FomcPredictionResult = {
  fomc_event: FomcEvent;
  context: MarketContextSnapshot;
  predictions: GeneratedPrediction[];
  model_version: string;
  generated_at: string;
};

// ─── Strategy selection ───────────────────────────────────────────────────────

/**
 * Resolve the prediction strategy profile for an FOMC event.
 *
 * Hawkish or dovish surprises call for macro-rate sensitivity — the core
 * transmission channel for FOMC surprises into equity and bond markets.
 *
 * Inline decisions in elevated volatility use the contrarian-regime-aware
 * profile to capture mean-reversion dynamics when uncertainty is elevated.
 */
const resolveStrategy = (
  fomcEvent: FomcEvent,
  context: MarketContextSnapshot,
): PredictionStrategyProfile => {
  const { surprise_direction } = fomcEvent;
  const { volatility_regime } = context;

  if (surprise_direction === "hawkish" || surprise_direction === "dovish") {
    return "macro_dovish_sensitive";
  }

  if (volatility_regime === "elevated" || volatility_regime === "high") {
    return "contrarian_regime_aware";
  }

  return "baseline";
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const generateFomcPrediction = (input: FomcPredictionInput): FomcPredictionResult => {
  const strategy = resolveStrategy(input.fomc_event, input.context);
  const model_version = input.model_version ?? "fomc-engine-v1";

  const predictions = generatePredictionSet(
    {
      event: input.fomc_event.parsed_event,
      horizons: input.horizons,
      model_version,
    },
    strategy,
  );

  return {
    fomc_event: input.fomc_event,
    context: input.context,
    predictions,
    model_version,
    generated_at: new Date().toISOString(),
  };
};
