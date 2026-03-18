import type {
  GeneratedPrediction,
  WalkForwardReplaySnapshot,
  ParsedEvent,
} from "@finance-superbrain/schemas";

import type { PredictionStrategyContext } from "./modelStrategyProfiles.js";
import type { PredictionLearningRecord, Repository } from "./repository.types.js";
import { buildEventSemanticText, semanticSimilarity } from "./semanticRetrieval.js";

type SimilarReviewedRecord = {
  record: PredictionLearningRecord;
  similarity: number;
  support_weight: number;
};

type AssetLearningSignal = {
  ticker: string;
  sample_count: number;
  direction_bias: number;
  average_magnitude_bp: number;
  average_total_score: number;
  average_confidence_gap: number;
  supporting_themes: string[];
};

type ModelReliabilitySignal = {
  confidence_delta: number;
  evidence_line: string | null;
  invalidation_line: string | null;
};

const MAX_REVIEWED_RECORDS = 500;
const MAX_SIMILAR_RECORDS = 40;
const MIN_SIMILARITY = 0.15;
const MIN_SIGNAL_SAMPLES = 1;
const MIN_CONFLICT_SAMPLES = 2;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const round = (value: number) => Number(value.toFixed(2));

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const jaccard = (left: string[], right: string[]) => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
};

const buildEntityKeys = (event: ParsedEvent) =>
  event.entities.map((entity) => `${entity.type}:${entity.value.toLowerCase()}`);

const directionToSign = (direction: "up" | "down" | "mixed") => {
  if (direction === "up") {
    return 1;
  }

  if (direction === "down") {
    return -1;
  }

  return 0;
};

const signToDirection = (value: number): "up" | "down" | "mixed" => {
  if (value >= 0.22) {
    return "up";
  }

  if (value <= -0.22) {
    return "down";
  }

  return "mixed";
};

const blend = (base: number, learned: number, learnedWeight: number) =>
  base * (1 - learnedWeight) + learned * learnedWeight;

const appendBoundedLine = (
  lines: string[],
  line: string | null,
  maxSize: number,
) => {
  if (!line || lines.includes(line)) {
    return lines.slice(0, maxSize);
  }

  if (lines.length < maxSize) {
    return [...lines, line];
  }

  return [...lines.slice(0, maxSize - 1), line];
};

const eventSimilarity = (source: ParsedEvent, target: ParsedEvent) => {
  const themeScore = jaccard(source.themes, target.themes);
  const entityScore = jaccard(buildEntityKeys(source), buildEntityKeys(target));
  const sentimentScore = source.sentiment === target.sentiment ? 1 : 0;
  const classScore = source.event_class === target.event_class ? 1 : 0;
  const candidateAssetScore = jaccard(source.candidate_assets, target.candidate_assets);
  const semanticScore = semanticSimilarity({
    queryText: buildEventSemanticText(source),
    targetText: buildEventSemanticText(target),
    queryTerms: source.themes.map((theme) => [theme, 0.25]),
    targetTerms: target.themes.map((theme) => [theme, 0.25]),
  });

  return round(
    semanticScore * 0.32 +
      themeScore * 0.3 +
      candidateAssetScore * 0.16 +
      entityScore * 0.12 +
      sentimentScore * 0.06 +
      classScore * 0.04,
  );
};

const learningQualityWeight = (record: PredictionLearningRecord) => {
  const totalScore = record.outcome?.total_score ?? 0.5;
  const calibrationScore = record.outcome?.calibration_score ?? 0.5;
  let weight = 0.45 + totalScore * 0.55 + (calibrationScore - 0.5) * 0.15;

  if (record.lesson?.lesson_type === "reinforcement") {
    weight += 0.06;
  } else if (record.lesson?.lesson_type === "mistake") {
    weight -= 0.03;
  }

  return clamp(weight, 0.35, 1.25);
};

const listRelevantReviewedRecords = async (
  repository: Repository,
  event: ParsedEvent,
  horizon: GeneratedPrediction["horizon"],
) => {
  const records = (await repository.listLearningRecords())
    .filter(
      (record) =>
        record.prediction.horizon === horizon &&
        record.prediction.status === "reviewed" &&
        record.outcome !== null &&
        record.postmortem !== null &&
        record.lesson !== null,
    )
    .sort((left, right) => right.prediction.created_at.localeCompare(left.prediction.created_at))
    .slice(0, MAX_REVIEWED_RECORDS);

  return records
    .map((record) => {
      const similarity = eventSimilarity(event, record.event);

      return {
        record,
        similarity,
        support_weight: round(similarity * learningQualityWeight(record)),
      };
    })
    .filter((record) => record.similarity >= MIN_SIMILARITY)
    .sort((left, right) => right.support_weight - left.support_weight)
    .slice(0, MAX_SIMILAR_RECORDS);
};

const buildAssetSignals = (
  similarRecords: SimilarReviewedRecord[],
  event: ParsedEvent,
  tickers: string[],
) => {
  const targetTickers = new Set(tickers.map((ticker) => ticker.toUpperCase()));
  const accumulators = new Map<
    string,
    {
      sample_count: number;
      weight_sum: number;
      direction_sum: number;
      magnitude_sum: number;
      total_score_sum: number;
      confidence_gap_sum: number;
      supporting_themes: Map<string, number>;
    }
  >();

  for (const similarRecord of similarRecords) {
    const overlappingThemes = event.themes.filter((theme) =>
      similarRecord.record.event.themes.includes(theme),
    );
    const overlapBonus = overlappingThemes.length ? 1 + Math.min(overlappingThemes.length, 3) * 0.08 : 1;

    for (const move of similarRecord.record.outcome!.outcome_payload.realized_moves) {
      const ticker = move.ticker.toUpperCase();

      if (!targetTickers.has(ticker)) {
        continue;
      }

      const accumulator = accumulators.get(ticker) ?? {
        sample_count: 0,
        weight_sum: 0,
        direction_sum: 0,
        magnitude_sum: 0,
        total_score_sum: 0,
        confidence_gap_sum: 0,
        supporting_themes: new Map(),
      };
      const effectiveWeight = similarRecord.support_weight * overlapBonus;

      accumulator.sample_count += 1;
      accumulator.weight_sum += effectiveWeight;
      accumulator.direction_sum += directionToSign(move.realized_direction) * effectiveWeight;
      accumulator.magnitude_sum += Math.abs(move.realized_magnitude_bp) * effectiveWeight;
      accumulator.total_score_sum += similarRecord.record.outcome!.total_score * effectiveWeight;
      accumulator.confidence_gap_sum +=
        (similarRecord.record.outcome!.direction_score - similarRecord.record.prediction.confidence) *
        effectiveWeight;

      for (const theme of overlappingThemes) {
        accumulator.supporting_themes.set(
          theme,
          (accumulator.supporting_themes.get(theme) ?? 0) + effectiveWeight,
        );
      }

      accumulators.set(ticker, accumulator);
    }
  }

  return [...accumulators.entries()]
    .map(([ticker, accumulator]): AssetLearningSignal => ({
      ticker,
      sample_count: accumulator.sample_count,
      direction_bias: accumulator.weight_sum
        ? round(accumulator.direction_sum / accumulator.weight_sum)
        : 0,
      average_magnitude_bp: accumulator.weight_sum
        ? round(accumulator.magnitude_sum / accumulator.weight_sum)
        : 0,
      average_total_score: accumulator.weight_sum
        ? round(accumulator.total_score_sum / accumulator.weight_sum)
        : 0,
      average_confidence_gap: accumulator.weight_sum
        ? round(accumulator.confidence_gap_sum / accumulator.weight_sum)
        : 0,
      supporting_themes: [...accumulator.supporting_themes.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([theme]) => theme),
    }))
    .sort((left, right) => {
      if (right.average_total_score !== left.average_total_score) {
        return right.average_total_score - left.average_total_score;
      }

      return right.sample_count - left.sample_count;
    });
};

const buildModelReliabilitySignal = async (
  repository: Repository,
  strategy: PredictionStrategyContext,
): Promise<ModelReliabilitySignal> => {
  if (!strategy.model_version) {
    return {
      confidence_delta: 0,
      evidence_line: null,
      invalidation_line: null,
    };
  }

  const snapshots = await repository.listWalkForwardReplaySnapshots(8);
  const snapshotMetrics = snapshots.flatMap((snapshot) =>
    snapshot.report.models.filter((model) => model.model_version === strategy.model_version),
  );
  const familyMetrics =
    !snapshotMetrics.length && strategy.registry
      ? snapshots.flatMap((snapshot) =>
          snapshot.report.families.filter((family) => family.family === strategy.registry!.family),
        )
      : [];
  const metrics = snapshotMetrics.length ? snapshotMetrics : familyMetrics;
  const relevantEvaluations = (await repository.listPromotionEvaluations(20)).filter(
    (evaluation) =>
      evaluation.candidate_model_version === strategy.model_version ||
      evaluation.baseline_model_version === strategy.model_version,
  );

  if (!metrics.length && !relevantEvaluations.length) {
    return {
      confidence_delta: 0,
      evidence_line: null,
      invalidation_line: null,
    };
  }

  const avgTotalScore = metrics.length
    ? average(metrics.map((metric) => metric.average_total_score))
    : 0.62;
  const avgDirectionAccuracy = metrics.length
    ? average(metrics.map((metric) => metric.direction_accuracy))
    : 0.58;
  const avgWrongRate = metrics.length ? average(metrics.map((metric) => metric.wrong_rate)) : 0.22;
  const avgCalibrationGap = metrics.length
    ? average(metrics.map((metric) => Math.abs(metric.calibration_gap)))
    : 0.06;
  const promotionFailures = relevantEvaluations.filter(
    (evaluation) =>
      evaluation.candidate_model_version === strategy.model_version && !evaluation.passed,
  ).length;
  const promotionPasses = relevantEvaluations.filter(
    (evaluation) =>
      evaluation.candidate_model_version === strategy.model_version && evaluation.passed,
  ).length;

  let confidenceDelta = clamp(
    (avgTotalScore - 0.62) * 0.16 +
      (avgDirectionAccuracy - 0.58) * 0.12 -
      Math.max(avgWrongRate - 0.22, 0) * 0.18 -
      Math.max(avgCalibrationGap - 0.05, 0) * 0.4,
    -0.08,
    0.05,
  );

  if (promotionFailures > promotionPasses) {
    confidenceDelta -= 0.02;
  } else if (promotionPasses > 0 && promotionFailures === 0) {
    confidenceDelta += 0.01;
  }

  const evidenceLine = metrics.length
    ? `Timed validation: ${metrics.length} walk-forward checkpoint(s) imply ${round(avgDirectionAccuracy)} direction accuracy with ${round(avgCalibrationGap)} calibration gap for this model context.`
    : null;
  const invalidationLine =
    avgWrongRate >= 0.3 || avgCalibrationGap >= 0.09
      ? "Timed validation still shows elevated wrong-rate or calibration slippage for this model context."
      : null;

  return {
    confidence_delta: round(confidenceDelta),
    evidence_line: evidenceLine,
    invalidation_line: invalidationLine,
  };
};

const applyAssetLearningSignal = (
  prediction: GeneratedPrediction,
  signal: AssetLearningSignal,
) => {
  return prediction.assets.map((asset) => {
    if (asset.ticker.toUpperCase() !== signal.ticker || signal.sample_count < MIN_SIGNAL_SAMPLES) {
      return asset;
    }

    const learnedDirection = signToDirection(signal.direction_bias);
    const learnedStrength = Math.abs(signal.direction_bias);
    const learnedWeight = clamp(
      signal.sample_count / 8 + (signal.average_total_score - 0.5) * 0.4,
      0.12,
      0.65,
    );
    let expectedDirection = asset.expected_direction;

    if (learnedDirection !== "mixed") {
      if (asset.expected_direction === "mixed") {
        expectedDirection = learnedDirection;
      } else if (asset.expected_direction !== learnedDirection) {
        expectedDirection =
          learnedStrength >= 0.7 && signal.sample_count >= 4 && signal.average_total_score >= 0.64
            ? learnedDirection
            : "mixed";
      }
    }

    const blendedMagnitude = round(
      blend(
        Math.abs(asset.expected_magnitude_bp),
        signal.average_magnitude_bp,
        learnedWeight,
      ),
    );
    const expectedMagnitudeBp =
      expectedDirection === "down"
        ? -Math.trunc(blendedMagnitude)
        : expectedDirection === "up"
          ? Math.trunc(blendedMagnitude)
          : Math.trunc(blendedMagnitude * 0.55);
    const convictionDelta = clamp(
      (signal.average_total_score - 0.58) * 0.18 +
        signal.average_confidence_gap * 0.12 +
        (learnedStrength - 0.35) * 0.08,
      -0.08,
      0.08,
    );

    return {
      ...asset,
      expected_direction: expectedDirection,
      expected_magnitude_bp: expectedMagnitudeBp,
      conviction: round(clamp(asset.conviction + convictionDelta, 0.35, 0.95)),
    };
  });
};

const buildLearnedEvidenceLines = (
  assetSignals: AssetLearningSignal[],
  predictions: GeneratedPrediction[],
) => {
  const targetedTickers = new Set(
    predictions.flatMap((prediction) => prediction.assets.map((asset) => asset.ticker.toUpperCase())),
  );

  return assetSignals
    .filter((signal) => targetedTickers.has(signal.ticker))
    .filter((signal) => signal.sample_count >= MIN_SIGNAL_SAMPLES)
    .slice(0, 2)
    .map(
      (signal) =>
        `Learned signal: ${signal.ticker} has ${signal.sample_count} reviewed match(es) with ${round(Math.abs(signal.direction_bias))} directional strength across ${signal.supporting_themes.join(", ") || "similar"} themes.`,
    );
};

const buildLearnedInvalidationLine = (
  assetSignals: AssetLearningSignal[],
  predictions: GeneratedPrediction[],
) => {
  const signalsByTicker = new Map(assetSignals.map((signal) => [signal.ticker, signal] as const));
  const conflictingTickers = predictions[0]?.assets
    .filter((asset) => {
      const signal = signalsByTicker.get(asset.ticker.toUpperCase());

      if (!signal || signal.sample_count < MIN_CONFLICT_SAMPLES) {
        return false;
      }

      const learnedDirection = signToDirection(signal.direction_bias);
      return (
        learnedDirection !== "mixed" &&
        asset.expected_direction !== "mixed" &&
        learnedDirection !== asset.expected_direction
      );
    })
    .map((asset) => asset.ticker);

  return conflictingTickers?.length
    ? `Learned history still disagrees on ${conflictingTickers.slice(0, 3).join(", ")}, so one-way follow-through could be fragile.`
    : null;
};

export const applyLearnedDecisionLayer = async (
  repository: Repository,
  event: ParsedEvent,
  predictions: GeneratedPrediction[],
  strategy: PredictionStrategyContext,
) => {
  const reliabilitySignal = await buildModelReliabilitySignal(repository, strategy);
  const updatedPredictions: GeneratedPrediction[] = [];

  for (const prediction of predictions) {
    const targetTickers = prediction.assets.map((asset) => asset.ticker.toUpperCase());
    const similarRecords = await listRelevantReviewedRecords(repository, event, prediction.horizon);
    const assetSignals = buildAssetSignals(similarRecords, event, targetTickers);
    const updatedAssets = assetSignals.reduce(
      (assets, signal) => applyAssetLearningSignal({ ...prediction, assets }, signal),
      prediction.assets,
    );
    const learnedEventScore = similarRecords.length
      ? average(similarRecords.map((record) => record.record.outcome!.total_score))
      : 0.58;
    const learnedConfidenceDelta = similarRecords.length
      ? clamp((learnedEventScore - 0.58) * 0.16, -0.05, 0.05)
      : 0;
    const confidence = round(
      clamp(
        prediction.confidence + learnedConfidenceDelta + reliabilitySignal.confidence_delta,
        0.35,
        strategy.tuning.confidence_cap ?? 0.95,
      ),
    );
    let evidence = [...prediction.evidence];
    let invalidations = [...prediction.invalidations];

    for (const line of buildLearnedEvidenceLines(assetSignals, [{ ...prediction, assets: updatedAssets }])) {
      evidence = appendBoundedLine(evidence, line, 6);
    }

    evidence = appendBoundedLine(evidence, reliabilitySignal.evidence_line, 6);
    invalidations = appendBoundedLine(
      invalidations,
      buildLearnedInvalidationLine(assetSignals, [{ ...prediction, assets: prediction.assets }]),
      5,
    );
    invalidations = appendBoundedLine(invalidations, reliabilitySignal.invalidation_line, 5);

    updatedPredictions.push({
      ...prediction,
      confidence,
      assets: updatedAssets,
      evidence: evidence.slice(0, 6),
      invalidations: invalidations.slice(0, 5),
    });
  }

  return updatedPredictions;
};
