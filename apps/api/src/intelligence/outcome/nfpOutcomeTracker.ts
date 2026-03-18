import { randomUUID } from "node:crypto";

import type {
  GeneratedPrediction,
  PredictionOutcome,
  RealizedMove,
  StoredPrediction,
} from "@finance-superbrain/schemas";

import { scorePrediction } from "../../lib/scorePrediction.js";
import type { NfpPredictionResult } from "../prediction/nfpPrediction.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NfpOutcomeInput = {
  prediction_result: NfpPredictionResult;
  realized_moves: RealizedMove[];
  measured_at: string;
  timing_alignment: number;
  dominant_catalyst?: string;
};

export type NfpTrackedOutcome = {
  horizon: GeneratedPrediction["horizon"];
  prediction: GeneratedPrediction;
  outcome: PredictionOutcome;
  direction_correct: boolean;
  asset_hit_count: number;
  asset_total: number;
};

export type NfpOutcomeResult = {
  tracked: NfpTrackedOutcome[];
  overall_correct: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toStoredPrediction = (
  prediction: GeneratedPrediction,
  model_version: string,
): StoredPrediction => ({
  ...prediction,
  id: randomUUID(),
  event_id: randomUUID(),
  model_version,
  status: "pending",
  created_at: new Date().toISOString(),
});

const countDirectionHits = (
  prediction: GeneratedPrediction,
  realizedMoves: RealizedMove[],
): number => {
  const realizedByTicker = new Map(
    realizedMoves.map((move) => [move.ticker.toUpperCase(), move]),
  );

  return prediction.assets.filter((asset) => {
    const realized = realizedByTicker.get(asset.ticker.toUpperCase());
    if (!realized) return false;
    if (asset.expected_direction === "mixed") return false;
    return asset.expected_direction === realized.realized_direction;
  }).length;
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const trackNfpOutcome = (input: NfpOutcomeInput): NfpOutcomeResult => {
  const { prediction_result, realized_moves, measured_at, timing_alignment, dominant_catalyst } =
    input;

  const tracked: NfpTrackedOutcome[] = prediction_result.predictions.map((prediction) => {
    const stored = toStoredPrediction(prediction, prediction_result.model_version);

    const outcome = scorePrediction(stored, {
      realized_moves,
      measured_at,
      timing_alignment,
      dominant_catalyst,
    });

    const asset_hit_count = countDirectionHits(prediction, realized_moves);

    return {
      horizon: prediction.horizon,
      prediction,
      outcome,
      direction_correct: outcome.direction_score >= 0.5,
      asset_hit_count,
      asset_total: prediction.assets.length,
    };
  });

  const overall_correct = tracked.every((t) => t.direction_correct);

  return { tracked, overall_correct };
};
