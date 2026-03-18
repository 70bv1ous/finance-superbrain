import { historicalIngestResponseSchema } from "@finance-superbrain/schemas";
import type { HistoricalIngestRequest } from "@finance-superbrain/schemas";

import { generateCalibratedPredictionSet } from "./analogs.js";
import { createPostmortem } from "./createPostmortem.js";
import { buildLessonMemoryText } from "./lessonMemory.js";
import { parseFinanceEvent } from "./parseFinanceEvent.js";
import { scorePrediction } from "./scorePrediction.js";
import type { AppServices } from "./services.js";

export const ingestHistoricalCases = async (
  services: AppServices,
  request: HistoricalIngestRequest,
) => {
  const results: Array<{
    source_id: string;
    event_id: string;
    prediction_id: string;
    verdict: "correct" | "partially_correct" | "wrong";
    total_score: number;
  }> = [];

  for (const item of request.items) {
    const source = await services.repository.createSource(item.source);
    const parsedEvent = parseFinanceEvent(source);
    const event = await services.repository.createEvent(source.id, parsedEvent);
    const generated = await generateCalibratedPredictionSet(services.repository, {
      event,
      horizons: [item.horizon],
      model_version: item.model_version,
    });
    const prediction = await services.repository.createPrediction(event.id, {
      ...generated.predictions[0],
      model_version: item.model_version,
    });
    const outcome = scorePrediction(prediction, {
      measured_at: new Date().toISOString(),
      realized_moves: item.realized_moves,
      timing_alignment: item.timing_alignment,
      dominant_catalyst: item.dominant_catalyst,
    });

    await services.repository.saveOutcome(outcome);
    await services.repository.updatePredictionStatus(prediction.id, "scored");

    const review = createPostmortem(prediction, outcome);
    const lessonEmbedding = await services.embeddingProvider.embedText(
      buildLessonMemoryText({
        prediction,
        postmortem: review.postmortem,
        lesson: review.lesson,
      }),
    );

    await services.repository.savePostmortem(review.postmortem);
    await services.repository.saveLesson(review.lesson, lessonEmbedding);
    await services.repository.updatePredictionStatus(prediction.id, "reviewed");

    results.push({
      source_id: source.id,
      event_id: event.id,
      prediction_id: prediction.id,
      verdict: review.postmortem.verdict,
      total_score: outcome.total_score,
    });
  }

  return historicalIngestResponseSchema.parse({
    ingested: results.length,
    results,
  });
};
