import { randomUUID } from "node:crypto";

import type {
  PredictionOutcome,
  ScorePredictionRequest,
  StoredPrediction,
} from "@finance-superbrain/schemas";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const round = (value: number) => Number(value.toFixed(2));

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const directionMatchScore = (expected: string, realized: string) => {
  if (expected === "mixed" || realized === "mixed") {
    return 0.5;
  }

  return expected === realized ? 1 : 0;
};

const magnitudeScore = (expectedMagnitudeBp: number, realizedMagnitudeBp: number) => {
  const expected = Math.max(Math.abs(expectedMagnitudeBp), 25);
  const realized = Math.abs(realizedMagnitudeBp);
  const errorRatio = Math.abs(expected - realized) / expected;
  return clamp(1 - errorRatio, 0, 1);
};

export const scorePrediction = (
  prediction: StoredPrediction,
  request: ScorePredictionRequest,
): PredictionOutcome => {
  const realizedMovesByTicker = new Map(
    request.realized_moves.map((move) => [move.ticker.toUpperCase(), move]),
  );

  const overlappingAssets = prediction.assets.filter((asset) =>
    realizedMovesByTicker.has(asset.ticker.toUpperCase()),
  );

  const directionScore = average(
    overlappingAssets.map((asset) =>
      directionMatchScore(
        asset.expected_direction,
        realizedMovesByTicker.get(asset.ticker.toUpperCase())!.realized_direction,
      ),
    ),
  );

  const magnitudeScoreValue = average(
    overlappingAssets.map((asset) =>
      magnitudeScore(
        asset.expected_magnitude_bp,
        realizedMovesByTicker.get(asset.ticker.toUpperCase())!.realized_magnitude_bp,
      ),
    ),
  );

  const timingScore = request.timing_alignment;
  const calibrationScore = clamp(1 - Math.abs(prediction.confidence - directionScore), 0, 1);
  const coveragePenalty = overlappingAssets.length ? 0 : 0.2;
  const totalScore = clamp(
    0.4 * directionScore +
      0.25 * magnitudeScoreValue +
      0.2 * timingScore +
      0.15 * calibrationScore -
      coveragePenalty,
    0,
    1,
  );

  return {
    id: randomUUID(),
    prediction_id: prediction.id,
    horizon: prediction.horizon,
    measured_at: request.measured_at ?? new Date().toISOString(),
    outcome_payload: {
      realized_moves: request.realized_moves,
      timing_alignment: request.timing_alignment,
      dominant_catalyst: request.dominant_catalyst,
      predicted_asset_count: prediction.assets.length,
      matched_asset_count: overlappingAssets.length,
      coverage_ratio: prediction.assets.length
        ? round(overlappingAssets.length / prediction.assets.length)
        : 0,
    },
    direction_score: round(directionScore),
    magnitude_score: round(magnitudeScoreValue),
    timing_score: round(timingScore),
    calibration_score: round(calibrationScore),
    total_score: round(totalScore),
    created_at: new Date().toISOString(),
  };
};
