import { autoScoreResponseSchema } from "@finance-superbrain/schemas";
import type { AutoScoreRequest } from "@finance-superbrain/schemas";

import { createPostmortem } from "./createPostmortem.js";
import { buildLessonMemoryText } from "./lessonMemory.js";
import type { AppServices } from "./services.js";
import { scorePrediction } from "./scorePrediction.js";

export const autoScorePredictions = async (
  services: AppServices,
  request: Partial<AutoScoreRequest> = {},
) => {
  const asOf = request.as_of ?? new Date().toISOString();
  const readyPredictions = await services.repository.listPendingPredictionsReadyForScoring(asOf);
  const items: Array<{
    prediction_id: string;
    outcome: Awaited<ReturnType<typeof services.repository.saveOutcome>>;
    postmortem: ReturnType<typeof createPostmortem>["postmortem"] | null;
    lesson: ReturnType<typeof createPostmortem>["lesson"] | null;
  }> = [];
  const errors: Array<{ prediction_id: string; message: string }> = [];

  for (const record of readyPredictions) {
    try {
      const marketOutcome = await services.marketDataProvider.getRealizedOutcome({
        prediction: record.prediction,
        event: record.event,
        asOf,
      });

      const outcome = scorePrediction(record.prediction, {
        measured_at: asOf,
        ...marketOutcome,
      });

      await services.repository.saveOutcome(outcome);

      let postmortem = null;
      let lesson = null;

      if (request.create_postmortems ?? true) {
        const review = createPostmortem(record.prediction, outcome);
        const lessonEmbedding = await services.embeddingProvider.embedText(
          buildLessonMemoryText({
            prediction: record.prediction,
            postmortem: review.postmortem,
            lesson: review.lesson,
          }),
        );
        postmortem = await services.repository.savePostmortem(review.postmortem);
        lesson = await services.repository.saveLesson(review.lesson, lessonEmbedding);
        await services.repository.updatePredictionStatus(record.prediction.id, "reviewed");
      } else {
        await services.repository.updatePredictionStatus(record.prediction.id, "scored");
      }

      items.push({
        prediction_id: record.prediction.id,
        outcome,
        postmortem,
        lesson,
      });
    } catch (error) {
      errors.push({
        prediction_id: record.prediction.id,
        message: error instanceof Error ? error.message : "Unknown auto-score failure.",
      });
    }
  }

  return autoScoreResponseSchema.parse({
    processed: items.length,
    items,
    errors,
  });
};
