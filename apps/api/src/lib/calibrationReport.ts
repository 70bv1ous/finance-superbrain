import { calibrationReportSchema } from "@finance-superbrain/schemas";
import type { CalibrationReport, StoredPrediction } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

type BucketDefinition = {
  label: string;
  min: number;
  max: number;
};

const BUCKETS: BucketDefinition[] = [
  { label: "0.40-0.54", min: 0.4, max: 0.54 },
  { label: "0.55-0.69", min: 0.55, max: 0.69 },
  { label: "0.70-0.84", min: 0.7, max: 0.84 },
  { label: "0.85-1.00", min: 0.85, max: 1.0 },
];

const round = (value: number) => Number(value.toFixed(2));

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const bucketForConfidence = (confidence: number) =>
  BUCKETS.find((bucket) => confidence >= bucket.min && confidence <= bucket.max) ?? BUCKETS[0];

export const buildCalibrationReport = async (
  repository: Repository,
): Promise<CalibrationReport> => {
  const learningRecords = await repository.listLearningRecords();
  const scoredRecords = learningRecords.filter((record) => record.outcome !== null);
  const horizons: StoredPrediction["horizon"][] = ["1h", "1d", "5d"];

  const report = {
    sample_count: scoredRecords.length,
    average_total_score: round(
      average(
        scoredRecords
          .map((record) => record.outcome?.total_score)
          .filter((score): score is number => score !== null && score !== undefined),
      ),
    ),
    horizons: horizons.map((horizon) => {
      const horizonRecords = scoredRecords.filter((record) => record.prediction.horizon === horizon);

      return {
        horizon,
        sample_count: horizonRecords.length,
        buckets: BUCKETS.map((bucket) => {
          const bucketRecords = horizonRecords.filter((record) => {
            const selectedBucket = bucketForConfidence(record.prediction.confidence);
            return selectedBucket.label === bucket.label;
          });

          const averageConfidence = round(
            average(bucketRecords.map((record) => record.prediction.confidence)),
          );
          const realizedAccuracy = round(
            average(
              bucketRecords
                .map((record) => record.outcome?.direction_score)
                .filter((score): score is number => score !== null && score !== undefined),
            ),
          );
          const averageTotalScore = round(
            average(
              bucketRecords
                .map((record) => record.outcome?.total_score)
                .filter((score): score is number => score !== null && score !== undefined),
            ),
          );

          return {
            bucket: bucket.label,
            count: bucketRecords.length,
            average_confidence: averageConfidence,
            realized_accuracy: realizedAccuracy,
            average_total_score: averageTotalScore,
            calibration_gap: round(averageConfidence - realizedAccuracy),
          };
        }),
      };
    }),
  };

  return calibrationReportSchema.parse(report);
};
