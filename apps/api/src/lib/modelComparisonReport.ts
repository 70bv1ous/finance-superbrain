import { modelComparisonReportSchema } from "@finance-superbrain/schemas";
import type {
  ModelComparisonReport,
  Postmortem,
  PredictionOutcome,
  StoredPrediction,
} from "@finance-superbrain/schemas";

import type { PredictionLearningRecord, Repository } from "./repository.types.js";

type HorizonMetricAccumulator = {
  horizon: StoredPrediction["horizon"];
  predictions: number;
  totalConfidence: number;
  totalScoreSum: number;
  totalScoreCount: number;
  directionSum: number;
  directionCount: number;
};

type VersionAccumulator = {
  modelVersion: string;
  predictions: number;
  reviewedCount: number;
  totalConfidence: number;
  totalScoreSum: number;
  totalScoreCount: number;
  directionSum: number;
  directionCount: number;
  correct: number;
  partial: number;
  wrong: number;
  latestPredictionAt: string | null;
  horizons: Map<StoredPrediction["horizon"], HorizonMetricAccumulator>;
};

const round = (value: number) => Number(value.toFixed(2));

const average = (sum: number, count: number) => (count ? sum / count : 0);

const updateVerdictCounters = (accumulator: VersionAccumulator, postmortem: Postmortem | null) => {
  if (!postmortem) {
    return;
  }

  if (postmortem.verdict === "correct") {
    accumulator.correct += 1;
  } else if (postmortem.verdict === "partially_correct") {
    accumulator.partial += 1;
  } else {
    accumulator.wrong += 1;
  }
};

const updateOutcomeMetrics = (
  accumulator: VersionAccumulator,
  horizonAccumulator: HorizonMetricAccumulator,
  outcome: PredictionOutcome | null,
) => {
  if (!outcome) {
    return;
  }

  accumulator.totalScoreSum += outcome.total_score;
  accumulator.totalScoreCount += 1;
  accumulator.directionSum += outcome.direction_score;
  accumulator.directionCount += 1;

  horizonAccumulator.totalScoreSum += outcome.total_score;
  horizonAccumulator.totalScoreCount += 1;
  horizonAccumulator.directionSum += outcome.direction_score;
  horizonAccumulator.directionCount += 1;
};

const buildHorizonAccumulator = (
  horizon: StoredPrediction["horizon"],
): HorizonMetricAccumulator => ({
  horizon,
  predictions: 0,
  totalConfidence: 0,
  totalScoreSum: 0,
  totalScoreCount: 0,
  directionSum: 0,
  directionCount: 0,
});

const ensureVersionAccumulator = (
  map: Map<string, VersionAccumulator>,
  modelVersion: string,
) => {
  const existing = map.get(modelVersion);
  if (existing) {
    return existing;
  }

  const created: VersionAccumulator = {
    modelVersion,
    predictions: 0,
    reviewedCount: 0,
    totalConfidence: 0,
    totalScoreSum: 0,
    totalScoreCount: 0,
    directionSum: 0,
    directionCount: 0,
    correct: 0,
    partial: 0,
    wrong: 0,
    latestPredictionAt: null,
    horizons: new Map(),
  };

  map.set(modelVersion, created);
  return created;
};

const ensureHorizonAccumulator = (
  accumulator: VersionAccumulator,
  horizon: StoredPrediction["horizon"],
) => {
  const existing = accumulator.horizons.get(horizon);
  if (existing) {
    return existing;
  }

  const created = buildHorizonAccumulator(horizon);
  accumulator.horizons.set(horizon, created);
  return created;
};

const sortVersions = (records: ModelComparisonReport["versions"]) =>
  [...records].sort((left, right) => {
    if (right.average_total_score !== left.average_total_score) {
      return right.average_total_score - left.average_total_score;
    }

    if (right.sample_count !== left.sample_count) {
      return right.sample_count - left.sample_count;
    }

    return left.model_version.localeCompare(right.model_version);
  });

const bestVersion = (
  versions: ModelComparisonReport["versions"],
  selector: (record: ModelComparisonReport["versions"][number]) => number,
) => {
  if (!versions.length) {
    return null;
  }

  return [...versions]
    .sort((left, right) => {
      const delta = selector(right) - selector(left);

      if (delta !== 0) {
        return delta;
      }

      if (right.sample_count !== left.sample_count) {
        return right.sample_count - left.sample_count;
      }

      return left.model_version.localeCompare(right.model_version);
    })[0]?.model_version ?? null;
};

const calibrationAlignmentScore = (record: ModelComparisonReport["versions"][number]) =>
  Math.abs(record.calibration_gap) * -1;

export const buildModelComparisonReport = async (
  repository: Repository,
): Promise<ModelComparisonReport> => {
  const [learningRecords, registeredModels] = await Promise.all([
    repository.listLearningRecords(),
    repository.listModelVersions(),
  ]);
  const accumulators = new Map<string, VersionAccumulator>();
  const modelRegistry = new Map(
    registeredModels.map((model) => [model.model_version, model] as const),
  );

  for (const record of learningRecords) {
    accumulateVersionRecord(accumulators, record);
  }

  const versions = sortVersions(
    [...accumulators.values()].map((accumulator) => {
      const reviewedCount = accumulator.reviewedCount;
      const denominator = reviewedCount || accumulator.predictions;

      return {
        model_version: accumulator.modelVersion,
        registry: modelRegistry.get(accumulator.modelVersion) ?? null,
        sample_count: accumulator.totalScoreCount,
        reviewed_count: reviewedCount,
        average_confidence: round(average(accumulator.totalConfidence, accumulator.predictions)),
        average_total_score: round(
          average(accumulator.totalScoreSum, accumulator.totalScoreCount),
        ),
        direction_accuracy: round(average(accumulator.directionSum, accumulator.directionCount)),
        correct_rate: round(average(accumulator.correct, denominator)),
        partial_rate: round(average(accumulator.partial, denominator)),
        wrong_rate: round(average(accumulator.wrong, denominator)),
        calibration_gap: round(
          average(accumulator.totalConfidence, accumulator.predictions) -
            average(accumulator.directionSum, accumulator.directionCount),
        ),
        latest_prediction_at: accumulator.latestPredictionAt,
        horizons: (["1h", "1d", "5d"] as const)
          .map((horizon) => accumulator.horizons.get(horizon))
          .filter((item): item is HorizonMetricAccumulator => item !== undefined)
          .map((horizonAccumulator) => ({
            horizon: horizonAccumulator.horizon,
            sample_count: horizonAccumulator.totalScoreCount,
            average_total_score: round(
              average(horizonAccumulator.totalScoreSum, horizonAccumulator.totalScoreCount),
            ),
            direction_accuracy: round(
              average(horizonAccumulator.directionSum, horizonAccumulator.directionCount),
            ),
            calibration_gap: round(
              average(horizonAccumulator.totalConfidence, horizonAccumulator.predictions) -
                average(horizonAccumulator.directionSum, horizonAccumulator.directionCount),
            ),
          })),
      };
    }),
  );

  return modelComparisonReportSchema.parse({
    generated_at: new Date().toISOString(),
    versions,
    leaders: {
      by_average_total_score: bestVersion(versions, (record) => record.average_total_score),
      by_direction_accuracy: bestVersion(versions, (record) => record.direction_accuracy),
      by_calibration_alignment: bestVersion(versions, calibrationAlignmentScore),
    },
  });
};

const accumulateVersionRecord = (
  accumulators: Map<string, VersionAccumulator>,
  record: PredictionLearningRecord,
) => {
  const accumulator = ensureVersionAccumulator(
    accumulators,
    record.prediction.model_version,
  );
  const horizonAccumulator = ensureHorizonAccumulator(
    accumulator,
    record.prediction.horizon,
  );

  accumulator.predictions += 1;
  accumulator.totalConfidence += record.prediction.confidence;
  accumulator.latestPredictionAt =
    accumulator.latestPredictionAt === null ||
    record.prediction.created_at > accumulator.latestPredictionAt
      ? record.prediction.created_at
      : accumulator.latestPredictionAt;

  horizonAccumulator.predictions += 1;
  horizonAccumulator.totalConfidence += record.prediction.confidence;

  if (record.prediction.status === "reviewed") {
    accumulator.reviewedCount += 1;
  }

  updateVerdictCounters(accumulator, record.postmortem);
  updateOutcomeMetrics(accumulator, horizonAccumulator, record.outcome);
};
