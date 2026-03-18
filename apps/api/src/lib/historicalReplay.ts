import { historicalReplayResponseSchema } from "@finance-superbrain/schemas";
import type {
  HistoricalReplayRequest,
  HistoricalReplayResponse,
  ParsedEvent,
} from "@finance-superbrain/schemas";

import { generateCalibratedPredictionSet } from "./analogs.js";
import { createPostmortem } from "./createPostmortem.js";
import { parseFinanceEvent } from "./parseFinanceEvent.js";
import type { Repository } from "./repository.types.js";
import { scorePrediction } from "./scorePrediction.js";

type ReplayCaseResult = HistoricalReplayResponse["cases"][number];
type ReplayModelMetric = HistoricalReplayResponse["models"][number];

type MetricAccumulator = {
  count: number;
  totalScoreSum: number;
  directionSum: number;
};

type ModelAccumulator = {
  model_version: string;
  case_count: number;
  confidenceSum: number;
  totalScoreSum: number;
  directionSum: number;
  calibrationScoreSum: number;
  correct: number;
  partial: number;
  wrong: number;
  byTheme: Map<string, MetricAccumulator>;
  bySourceType: Map<string, MetricAccumulator>;
  byHorizon: Map<string, MetricAccumulator>;
};

const round = (value: number) => Number(value.toFixed(2));

const average = (sum: number, count: number) => (count ? sum / count : 0);

const calibrationAlignmentScore = (record: ReplayModelMetric) =>
  typeof record.average_calibration_score === "number"
    ? record.average_calibration_score
    : Math.abs(record.calibration_gap) * -1;

const bestVersion = (
  versions: ReplayModelMetric[],
  selector: (record: ReplayModelMetric) => number,
) =>
  versions.length
    ? [...versions]
        .sort((left, right) => {
          const delta = selector(right) - selector(left);

          if (delta !== 0) {
            return delta;
          }

          if (right.case_count !== left.case_count) {
            return right.case_count - left.case_count;
          }

          return left.model_version.localeCompare(right.model_version);
        })[0]?.model_version ?? null
    : null;

const ensureMetric = (map: Map<string, MetricAccumulator>, key: string) => {
  const existing = map.get(key);

  if (existing) {
    return existing;
  }

  const created: MetricAccumulator = {
    count: 0,
    totalScoreSum: 0,
    directionSum: 0,
  };

  map.set(key, created);
  return created;
};

const updateMetric = (metric: MetricAccumulator, result: ReplayCaseResult) => {
  metric.count += 1;
  metric.totalScoreSum += result.total_score;
  metric.directionSum += result.direction_score;
};

const toMetricRows = (map: Map<string, MetricAccumulator>) =>
  [...map.entries()]
    .map(([key, value]) => ({
      key,
      sample_count: value.count,
      average_total_score: round(average(value.totalScoreSum, value.count)),
      direction_accuracy: round(average(value.directionSum, value.count)),
    }))
    .sort((left, right) => {
      if (right.average_total_score !== left.average_total_score) {
        return right.average_total_score - left.average_total_score;
      }

      return right.sample_count - left.sample_count;
    });

const ensureModelAccumulator = (
  map: Map<string, ModelAccumulator>,
  modelVersion: string,
) => {
  const existing = map.get(modelVersion);

  if (existing) {
    return existing;
  }

  const created: ModelAccumulator = {
    model_version: modelVersion,
    case_count: 0,
    confidenceSum: 0,
    totalScoreSum: 0,
    directionSum: 0,
    calibrationScoreSum: 0,
    correct: 0,
    partial: 0,
    wrong: 0,
    byTheme: new Map(),
    bySourceType: new Map(),
    byHorizon: new Map(),
  };

  map.set(modelVersion, created);
  return created;
};

const buildParsedReplayEvent = (
  requestCase: HistoricalReplayRequest["cases"][number],
): ParsedEvent => parseFinanceEvent({
  ...requestCase.source,
  occurred_at: requestCase.source.occurred_at,
  raw_uri: requestCase.source.raw_uri,
});

const runReplayCase = async (
  repository: Repository,
  requestCase: HistoricalReplayRequest["cases"][number],
  modelVersion: string,
): Promise<ReplayCaseResult> => {
  const parsedEvent = buildParsedReplayEvent(requestCase);
  const generated = await generateCalibratedPredictionSet(repository, {
    event: parsedEvent,
    horizons: [requestCase.horizon],
    model_version: modelVersion,
  });
  const prediction = {
    ...generated.predictions[0],
    id: requestCase.case_id,
    event_id: requestCase.case_id,
    model_version: modelVersion,
    status: "reviewed" as const,
    created_at: new Date().toISOString(),
  };
  const outcome = scorePrediction(prediction, {
    measured_at: new Date().toISOString(),
    realized_moves: requestCase.realized_moves,
    timing_alignment: requestCase.timing_alignment,
    dominant_catalyst: requestCase.dominant_catalyst,
  });
  const review = createPostmortem(prediction, outcome);

  return {
    case_id: requestCase.case_id,
    case_pack: requestCase.case_pack,
    model_version: modelVersion,
    horizon: requestCase.horizon,
    source_type: requestCase.source.source_type,
    themes: parsedEvent.themes,
    tags: requestCase.tags,
    confidence: prediction.confidence,
    total_score: outcome.total_score,
    direction_score: outcome.direction_score,
    magnitude_score: outcome.magnitude_score,
    timing_score: outcome.timing_score,
    calibration_score: outcome.calibration_score,
    verdict: review.postmortem.verdict,
    failure_tags: review.postmortem.failure_tags,
  };
};

export const summarizeHistoricalReplayResults = (
  caseResults: ReplayCaseResult[],
  casePack: string,
  caseCount = caseResults.length,
): HistoricalReplayResponse => {
  const modelAccumulators = new Map<string, ModelAccumulator>();

  for (const result of caseResults) {
    const modelAccumulator = ensureModelAccumulator(modelAccumulators, result.model_version);
    modelAccumulator.case_count += 1;
    modelAccumulator.confidenceSum += result.confidence;
    modelAccumulator.totalScoreSum += result.total_score;
    modelAccumulator.directionSum += result.direction_score;
    modelAccumulator.calibrationScoreSum += result.calibration_score;

    if (result.verdict === "correct") {
      modelAccumulator.correct += 1;
    } else if (result.verdict === "partially_correct") {
      modelAccumulator.partial += 1;
    } else {
      modelAccumulator.wrong += 1;
    }

    for (const theme of result.themes) {
      updateMetric(ensureMetric(modelAccumulator.byTheme, theme), result);
    }

    for (const tag of result.tags) {
      updateMetric(ensureMetric(modelAccumulator.byTheme, `tag:${tag}`), result);
    }

    updateMetric(ensureMetric(modelAccumulator.bySourceType, result.source_type), result);
    updateMetric(ensureMetric(modelAccumulator.byHorizon, result.horizon), result);
  }

  const models = [...modelAccumulators.values()]
    .map((accumulator) => ({
      model_version: accumulator.model_version,
      case_count: accumulator.case_count,
      average_confidence: round(average(accumulator.confidenceSum, accumulator.case_count)),
      average_total_score: round(average(accumulator.totalScoreSum, accumulator.case_count)),
      direction_accuracy: round(average(accumulator.directionSum, accumulator.case_count)),
      average_calibration_score: round(
        average(accumulator.calibrationScoreSum, accumulator.case_count),
      ),
      calibration_gap: round(
        average(accumulator.confidenceSum, accumulator.case_count) -
          average(accumulator.directionSum, accumulator.case_count),
      ),
      correct_rate: round(average(accumulator.correct, accumulator.case_count)),
      partial_rate: round(average(accumulator.partial, accumulator.case_count)),
      wrong_rate: round(average(accumulator.wrong, accumulator.case_count)),
      by_theme: toMetricRows(accumulator.byTheme).slice(0, 12),
      by_source_type: toMetricRows(accumulator.bySourceType),
      by_horizon: toMetricRows(accumulator.byHorizon),
    }))
    .sort((left, right) => {
      if (right.average_total_score !== left.average_total_score) {
        return right.average_total_score - left.average_total_score;
      }

      return right.case_count - left.case_count;
    });

  return historicalReplayResponseSchema.parse({
    generated_at: new Date().toISOString(),
    case_pack: casePack,
    case_count: caseCount,
    models,
    leaders: {
      by_average_total_score: bestVersion(models, (record) => record.average_total_score),
      by_direction_accuracy: bestVersion(models, (record) => record.direction_accuracy),
      by_calibration_alignment: bestVersion(models, calibrationAlignmentScore),
    },
    cases: caseResults,
  });
};

export const runHistoricalReplayBenchmark = async (
  repository: Repository,
  request: HistoricalReplayRequest,
): Promise<HistoricalReplayResponse> => {
  const caseResults: ReplayCaseResult[] = [];

  for (const modelVersion of request.model_versions) {
    for (const requestCase of request.cases) {
      caseResults.push(await runReplayCase(repository, requestCase, modelVersion));
    }
  }

  return summarizeHistoricalReplayResults(
    caseResults,
    request.cases[0]?.case_pack ?? "default",
    request.cases.length,
  );
};
