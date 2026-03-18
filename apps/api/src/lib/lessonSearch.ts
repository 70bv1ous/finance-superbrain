import { lessonSearchResponseSchema } from "@finance-superbrain/schemas";
import type { LessonSearchResponse } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";
import {
  buildLearningRecordSemanticText,
  buildSemanticVector,
  cosineSimilarity,
  semanticSimilarity,
  tokenize,
} from "./semanticRetrieval.js";

const round = (value: number) => Number(value.toFixed(2));

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const scoreMatch = (query: string, haystack: string, themes: string[]) => {
  const queryTokens = tokenize(query);
  const haystackTokens = new Set(tokenize(haystack));
  const queryPhrase = query.trim().toLowerCase();
  const normalizedThemes = themes.map((theme) => theme.toLowerCase());

  if (!queryTokens.length) {
    return 0;
  }

  const tokenHits = queryTokens.filter((token) => haystackTokens.has(token)).length;
  const tokenCoverage = tokenHits / queryTokens.length;
  const phraseBonus = haystack.toLowerCase().includes(queryPhrase) ? 0.25 : 0;
  const themeBonus = queryTokens.some((token) =>
    normalizedThemes.some((theme) => theme.includes(token)),
  )
    ? 0.15
    : 0;

  return round(clamp(tokenCoverage * 0.6 + phraseBonus + themeBonus, 0, 1));
};

export const searchLessons = async (
  repository: Repository,
  query: string,
  limit = 8,
): Promise<LessonSearchResponse> => {
  const learningRecords = await repository.listLearningRecords();
  const queryVector = buildSemanticVector(query);

  const results = learningRecords
    .filter((record) => record.lesson !== null)
    .map((record) => {
      const haystack = buildLearningRecordSemanticText(record);
      const lexicalScore = scoreMatch(query, haystack, record.event.themes);
      const semanticScore =
        record.lesson_embedding?.length
          ? cosineSimilarity(queryVector, record.lesson_embedding)
          : semanticSimilarity({
              queryText: query,
              targetText: haystack,
              queryTerms: record.event.themes.map((theme) => [theme, 0.2]),
              targetTerms: record.event.themes.map((theme) => [theme, 0.4]),
            });
      const score = round(clamp(semanticScore * 0.7 + lexicalScore * 0.3, 0, 1));

      return {
        record,
        score,
      };
    })
    .filter((item) => item.score > 0.08)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.record.prediction.created_at.localeCompare(left.record.prediction.created_at);
    })
    .slice(0, limit)
    .map(({ record, score }) => ({
      lesson_id: record.lesson!.id,
      prediction_id: record.prediction.id,
      event_id: record.event.id,
      score,
      lesson_type: record.lesson!.lesson_type,
      lesson_summary: record.lesson!.lesson_summary,
      event_summary: record.event.summary,
      themes: record.event.themes,
      horizon: record.prediction.horizon,
      verdict: record.postmortem?.verdict ?? null,
      total_score: record.outcome?.total_score ?? null,
      created_at: record.lesson!.created_at,
    }));

  return lessonSearchResponseSchema.parse({
    query,
    results,
  });
};
