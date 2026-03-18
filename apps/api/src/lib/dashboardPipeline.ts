import { dashboardPipelineResponseSchema } from "@finance-superbrain/schemas";

import { findEventAnalogs } from "./analogs.js";
import type { Repository } from "./repository.types.js";

const calibrationBucket = (confidence: number) => {
  if (confidence >= 0.85) return "0.85-1.00";
  if (confidence >= 0.7) return "0.70-0.84";
  if (confidence >= 0.55) return "0.55-0.69";
  return "0.40-0.54";
};

const calibrationSignal = (gap: number | null) => {
  if (gap === null) {
    return "insufficient_data" as const;
  }

  if (gap > 0.12) {
    return "overconfident" as const;
  }

  if (gap < -0.12) {
    return "underconfident" as const;
  }

  return "aligned" as const;
};

const summarizeSourceTitle = (source: Awaited<ReturnType<Repository["getSource"]>>) =>
  source?.title ?? source?.speaker ?? "Untitled source";

const excerpt = (text: string, maxLength = 190) =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;

export const buildDashboardPipeline = async (repository: Repository, limit = 6) => {
  const sorted = await repository.listLearningRecords({ limit });
  const sourceCache = new Map<string, ReturnType<Repository["getSource"]>>();

  const getSourceCached = (sourceId: string) => {
    const existing = sourceCache.get(sourceId);

    if (existing) {
      return existing;
    }

    const sourcePromise = repository.getSource(sourceId);
    sourceCache.set(sourceId, sourcePromise);
    return sourcePromise;
  };

  const items = await Promise.all(
    sorted.map(async (record) => {
      const source = await getSourceCached(record.event.source_id);
      const analogs = await findEventAnalogs(repository, record.event, 3);
      const realizedAccuracy = record.outcome?.direction_score ?? null;
      const calibrationGap =
        realizedAccuracy === null ? null : Number((record.prediction.confidence - realizedAccuracy).toFixed(2));

      return {
        source: {
          id: record.event.source_id,
          source_type: source?.source_type ?? "headline",
          title: summarizeSourceTitle(source),
          speaker: source?.speaker ?? null,
          occurred_at: source?.occurred_at ?? null,
          raw_text_excerpt: excerpt(source?.raw_text ?? record.event.summary),
        },
        event: {
          id: record.event.id,
          summary: record.event.summary,
          themes: record.event.themes,
          sentiment: record.event.sentiment,
          urgency_score: record.event.urgency_score,
          novelty_score: record.event.novelty_score,
        },
        analogs,
        prediction: {
          id: record.prediction.id,
          horizon: record.prediction.horizon,
          status: record.prediction.status,
          confidence: record.prediction.confidence,
          thesis: record.prediction.thesis,
          assets: record.prediction.assets,
          evidence: record.prediction.evidence,
          invalidations: record.prediction.invalidations,
          created_at: record.prediction.created_at,
        },
        outcome: record.outcome
          ? {
              measured_at: record.outcome.measured_at,
              total_score: record.outcome.total_score,
              direction_score: record.outcome.direction_score,
              magnitude_score: record.outcome.magnitude_score,
              timing_score: record.outcome.timing_score,
              calibration_score: record.outcome.calibration_score,
            }
          : null,
        lesson: record.lesson
          ? {
              lesson_type: record.lesson.lesson_type,
              verdict: record.postmortem?.verdict ?? null,
              lesson_summary: record.lesson.lesson_summary,
              critique: record.postmortem?.critique ?? null,
            }
          : null,
        calibration: {
          confidence_bucket: calibrationBucket(record.prediction.confidence),
          confidence: record.prediction.confidence,
          realized_accuracy: realizedAccuracy,
          calibration_gap: calibrationGap,
          signal: calibrationSignal(calibrationGap),
        },
      };
    }),
  );

  return dashboardPipelineResponseSchema.parse({
    items,
  });
};
