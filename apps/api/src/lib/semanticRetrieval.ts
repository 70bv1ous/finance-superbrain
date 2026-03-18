import type {
  ParsedEvent,
  StoredPrediction,
} from "@finance-superbrain/schemas";

import type { PredictionLearningRecord } from "./repository.types.js";

const VECTOR_SIZE = 192;

const hashToken = (token: string) => {
  let hash = 2166136261;

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash) % VECTOR_SIZE;
};

export const tokenize = (input: string) =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);

const buildBigrams = (tokens: string[]) =>
  tokens.slice(0, -1).map((token, index) => `${token}_${tokens[index + 1]}`);

export const buildSemanticVector = (text: string, weightedTerms: Array<[string, number]> = []) => {
  const tokens = tokenize(text);
  const vector = new Array<number>(VECTOR_SIZE).fill(0);

  for (const token of [...tokens, ...buildBigrams(tokens)]) {
    vector[hashToken(token)] += token.includes("_") ? 1.2 : 1;
  }

  for (const [term, weight] of weightedTerms) {
    const normalized = term.trim().toLowerCase();

    if (!normalized) {
      continue;
    }

    vector[hashToken(normalized)] += weight;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  return magnitude
    ? vector.map((value) => value / magnitude)
    : vector;
};

export const cosineSimilarity = (left: number[], right: number[]) =>
  left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);

export const buildEventSemanticText = (event: ParsedEvent) =>
  [
    event.summary,
    event.themes.join(" "),
    event.entities.map((entity) => entity.value).join(" "),
    event.candidate_assets.join(" "),
    event.why_it_matters.join(" "),
  ].join(" ");

export const buildLearningRecordSemanticText = (record: PredictionLearningRecord) =>
  [
    record.lesson?.lesson_summary ?? "",
    record.postmortem?.critique ?? "",
    record.event.summary,
    record.event.themes.join(" "),
    record.prediction.thesis,
    record.prediction.evidence.join(" "),
    record.prediction.invalidations.join(" "),
    buildPredictionAssetText(record.prediction),
  ].join(" ");

const buildPredictionAssetText = (prediction: StoredPrediction) =>
  prediction.assets
    .map((asset) => `${asset.ticker} ${asset.expected_direction} ${asset.expected_magnitude_bp}`)
    .join(" ");

export const semanticSimilarity = (input: {
  queryText: string;
  targetText: string;
  queryTerms?: Array<[string, number]>;
  targetTerms?: Array<[string, number]>;
}) =>
  cosineSimilarity(
    buildSemanticVector(input.queryText, input.queryTerms),
    buildSemanticVector(input.targetText, input.targetTerms),
  );
