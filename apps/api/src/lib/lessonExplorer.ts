import { lessonExplorerResponseSchema } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

export const buildLessonExplorer = async (repository: Repository, limit = 60) => {
  const learningRecords = await repository.listLearningRecords({ limit });

  return lessonExplorerResponseSchema.parse({
    items: learningRecords
      .filter((record) => record.lesson !== null)
      .map((record) => ({
        lesson_id: record.lesson!.id,
        prediction_id: record.prediction.id,
        event_id: record.event.id,
        lesson_type: record.lesson!.lesson_type,
        lesson_summary: record.lesson!.lesson_summary,
        event_summary: record.event.summary,
        themes: record.event.themes,
        horizon: record.prediction.horizon,
        verdict: record.postmortem?.verdict ?? null,
        total_score: record.outcome?.total_score ?? null,
        sentiment: record.event.sentiment,
        failure_tags: record.postmortem?.failure_tags ?? [],
        created_at: record.lesson!.created_at,
      })),
  });
};
