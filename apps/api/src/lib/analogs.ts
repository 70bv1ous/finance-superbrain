import type {
  AnalogMatch,
  GeneratePredictionRequest,
  GeneratedPrediction,
  ParsedEvent,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";
import { generatePredictionSet } from "./generatePrediction.js";
import { applyLearnedDecisionLayer } from "./learnedDecisionLayer.js";
import { resolvePredictionStrategyProfile, type PredictionStrategyProfile } from "./modelStrategyProfiles.js";
import { buildEventSemanticText, semanticSimilarity } from "./semanticRetrieval.js";

const round = (value: number) => Number(value.toFixed(2));

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const hasReviewedEvidence = (analog: AnalogMatch) =>
  analog.total_score !== null || analog.verdict !== null || analog.lesson_type !== null;

const appendBoundedLine = (
  lines: string[],
  line: string,
  maxSize: number,
) => {
  if (lines.includes(line)) {
    return lines.slice(0, maxSize);
  }

  if (lines.length < maxSize) {
    return [...lines, line];
  }

  return [...lines.slice(0, maxSize - 1), line];
};

const jaccard = (left: string[], right: string[]) => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
};

const normalizeEntityValues = (event: ParsedEvent) =>
  event.entities.map((entity) => `${entity.type}:${entity.value.toLowerCase()}`);

const similarityScore = (source: ParsedEvent, target: ParsedEvent) => {
  const themeScore = jaccard(source.themes, target.themes);
  const entityScore = jaccard(normalizeEntityValues(source), normalizeEntityValues(target));
  const sentimentScore = source.sentiment === target.sentiment ? 1 : 0;
  const classScore = source.event_class === target.event_class ? 1 : 0;
  const semanticScore = semanticSimilarity({
    queryText: buildEventSemanticText(source),
    targetText: buildEventSemanticText(target),
    queryTerms: source.themes.map((theme) => [theme, 0.35]),
    targetTerms: target.themes.map((theme) => [theme, 0.35]),
  });

  return round(
    semanticScore * 0.5 +
      themeScore * 0.22 +
      entityScore * 0.14 +
      sentimentScore * 0.08 +
      classScore * 0.06,
  );
};

export const findEventAnalogs = async (
  repository: Repository,
  event: ParsedEvent & { id?: string },
  limit = 5,
): Promise<AnalogMatch[]> => {
  const learningRecords = await repository.listLearningRecords();

  return learningRecords
    .filter((record) => record.event.id !== event.id)
    .map((record) => ({
      record,
      similarity: similarityScore(event, record.event),
    }))
    .filter((item) => item.similarity >= 0.15)
    .sort((left, right) => {
      const leftReviewed = Number(Boolean(left.record.outcome || left.record.lesson || left.record.postmortem));
      const rightReviewed = Number(Boolean(right.record.outcome || right.record.lesson || right.record.postmortem));

      if (rightReviewed !== leftReviewed) {
        return rightReviewed - leftReviewed;
      }

      return right.similarity - left.similarity;
    })
    .slice(0, limit)
    .map(({ record, similarity }) => ({
      event_id: record.event.id,
      prediction_id: record.prediction.id,
      similarity,
      horizon: record.prediction.horizon,
      event_summary: record.event.summary,
      sentiment: record.event.sentiment,
      themes: record.event.themes,
      total_score: record.outcome?.total_score ?? null,
      verdict: record.postmortem?.verdict ?? null,
      lesson_summary: record.lesson?.lesson_summary ?? null,
      lesson_type: record.lesson?.lesson_type ?? null,
    }));
};

const applyAnalogCalibration = (
  prediction: GeneratedPrediction,
  analogs: AnalogMatch[],
  profile: PredictionStrategyProfile,
): GeneratedPrediction => {
  const relevantAnalogs = analogs.filter((analog) => analog.horizon === prediction.horizon);
  const activeAnalogs = relevantAnalogs.length ? relevantAnalogs : analogs;
  const reviewedAnalogs = activeAnalogs.filter(hasReviewedEvidence);
  const scoredAnalogs = reviewedAnalogs.filter((analog) => analog.total_score !== null);

  if (!activeAnalogs.length) {
    return prediction;
  }

  if (!reviewedAnalogs.length) {
    return {
      ...prediction,
      evidence: appendBoundedLine(
        prediction.evidence,
        "Historical analogs exist, but none are reviewed enough yet to recalibrate confidence.",
        5,
      ),
    };
  }

  if (!scoredAnalogs.length) {
    return {
      ...prediction,
      evidence: appendBoundedLine(
        prediction.evidence,
        `Historical analogs found (${reviewedAnalogs.length}), but realized outcome scoring is still pending.`,
        5,
      ),
    };
  }

  const weightedScores = scoredAnalogs
    .map((analog) => analog.similarity * Number(analog.total_score));

  const similarityWeights = scoredAnalogs
    .map((analog) => analog.similarity);

  const weightedMean =
    similarityWeights.length && similarityWeights.reduce((sum, value) => sum + value, 0) > 0
      ? weightedScores.reduce((sum, value) => sum + value, 0) /
        similarityWeights.reduce((sum, value) => sum + value, 0)
      : null;

  const reinforcementCount = reviewedAnalogs.filter((analog) => analog.lesson_type === "reinforcement").length;
  const mistakeCount = reviewedAnalogs.filter((analog) => analog.lesson_type === "mistake").length;
  const averageScore = average(
    scoredAnalogs
      .map((analog) => analog.total_score)
      .filter((score): score is number => score !== null),
  );
  const evidenceStrength = clamp(
    similarityWeights.reduce((sum, value) => sum + value, 0) / 2,
    0.35,
    1,
  );

  const confidenceModifier =
    ((weightedMean !== null ? (weightedMean - 0.5) * 0.18 : 0) +
      (reinforcementCount - mistakeCount) * 0.02) *
    evidenceStrength;
  const contrarianModifier =
    profile === "contrarian_regime_aware" && weightedMean !== null && weightedMean < 0.58
      ? -0.05
      : 0;

  const confidence = round(clamp(prediction.confidence + confidenceModifier + contrarianModifier, 0.35, 0.95));
  let evidence = [...prediction.evidence];
  let invalidations = [...prediction.invalidations];

  evidence = appendBoundedLine(
    evidence,
    `Analog calibration: ${scoredAnalogs.length} scored analog(s) and ${reviewedAnalogs.length} reviewed analog(s) with average realized score ${round(averageScore)}.`,
    5,
  );

  const cautionaryLessons = reviewedAnalogs
    .filter((analog) => analog.lesson_type === "mistake" && analog.lesson_summary)
    .map((analog) => analog.lesson_summary as string)
    .slice(0, 2);

  if (cautionaryLessons.length) {
    invalidations = appendBoundedLine(
      invalidations,
      `Historical caution: ${cautionaryLessons[0]}`,
      4,
    );
  }

  return {
    ...prediction,
    confidence,
    evidence: evidence.slice(0, 5),
    invalidations: invalidations.slice(0, 4),
  };
};

export const generateCalibratedPredictionSet = async (
  repository: Repository,
  request: GeneratePredictionRequest,
) => {
  const analogs = await findEventAnalogs(repository, request.event);
  const strategy = await resolvePredictionStrategyProfile(repository, request.model_version);
  const predictions = generatePredictionSet(request, strategy).map((prediction) =>
    applyAnalogCalibration(prediction, analogs, strategy.profile),
  );
  const learnedPredictions = await applyLearnedDecisionLayer(
    repository,
    request.event,
    predictions,
    strategy,
  );

  return {
    predictions: learnedPredictions,
    analogs,
  };
};
