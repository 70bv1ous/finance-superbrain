import type { GeneratedPrediction } from "@finance-superbrain/schemas";

import { generatePredictionSet } from "../../lib/generatePrediction.js";
import type { PredictionStrategyProfile } from "../../lib/modelStrategyProfiles.js";
import type { MarketContextSnapshot } from "../context/marketContext.js";
import type { CpiEvent } from "../events/cpiEvent.js";

export type CpiPredictionHorizon = "1h" | "1d" | "5d";

export type CpiPredictionInput = {
  cpi_event: CpiEvent;
  context: MarketContextSnapshot;
  horizons: CpiPredictionHorizon[];
  model_version?: string;
};

export type CpiPredictionResult = {
  cpi_event: CpiEvent;
  context: MarketContextSnapshot;
  predictions: GeneratedPrediction[];
  model_version: string;
  generated_at: string;
};

const resolveStrategy = (
  cpiEvent: CpiEvent,
  context: MarketContextSnapshot,
): PredictionStrategyProfile => {
  const { surprise_direction } = cpiEvent;
  const { volatility_regime } = context;

  // Hotter or cooler CPI both call for macro-rate sensitivity
  if (surprise_direction === "hotter" || surprise_direction === "cooler") {
    return "macro_dovish_sensitive";
  }

  // Inline CPI in elevated vol: be cautious
  if (volatility_regime === "elevated" || volatility_regime === "high") {
    return "contrarian_regime_aware";
  }

  return "baseline";
};

export const generateCpiPrediction = (input: CpiPredictionInput): CpiPredictionResult => {
  const strategy = resolveStrategy(input.cpi_event, input.context);
  const model_version = input.model_version ?? "cpi-engine-v1";

  const predictions = generatePredictionSet(
    {
      event: input.cpi_event.parsed_event,
      horizons: input.horizons,
      model_version,
    },
    strategy,
  );

  return {
    cpi_event: input.cpi_event,
    context: input.context,
    predictions,
    model_version,
    generated_at: new Date().toISOString(),
  };
};
