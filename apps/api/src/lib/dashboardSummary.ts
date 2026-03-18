import { dashboardSummarySchema } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

export const buildDashboardSummary = async (repository: Repository) => {
  const learningRecords = await repository.listLearningRecords();
  const streamBindings = await repository.listTranscriptStreamBindings(50);
  const topThemeCounts = new Map<string, number>();
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

  for (const record of learningRecords) {
    for (const theme of record.event.themes) {
      topThemeCounts.set(theme, (topThemeCounts.get(theme) ?? 0) + 1);
    }
  }

  const recentActivity = await Promise.all(
    [...learningRecords]
      .sort((left, right) => right.prediction.created_at.localeCompare(left.prediction.created_at))
      .slice(0, 10)
      .map(async (record) => {
        const source = await getSourceCached(record.event.source_id);

        return {
          prediction_id: record.prediction.id,
          event_id: record.event.id,
          source_id: record.event.source_id,
          source_title: source?.title ?? source?.speaker ?? "Untitled source",
          event_summary: record.event.summary,
          themes: record.event.themes,
          sentiment: record.event.sentiment,
          horizon: record.prediction.horizon,
          status: record.prediction.status,
          confidence: record.prediction.confidence,
          total_score: record.outcome?.total_score ?? null,
          verdict: record.postmortem?.verdict ?? null,
          lesson_summary: record.lesson?.lesson_summary ?? null,
          created_at: record.prediction.created_at,
        };
      }),
  );

  const liveBindings = (
    await Promise.all(
    streamBindings.map(async (binding) => {
      const session = await repository.getTranscriptSession(binding.session_id);
      const chunks = await repository.listTranscriptSessionChunks(binding.session_id);
      const latestAnalysis = await repository.getLatestTranscriptSessionAnalysis(binding.session_id);
      const buffer = await repository.getTranscriptStreamBuffer(
        binding.provider,
        binding.external_stream_key,
      );

      return session
        ? {
            provider: binding.provider,
            external_stream_key: binding.external_stream_key,
            session_id: binding.session_id,
            title: session.title ?? session.speaker ?? "Untitled live stream",
            speaker: session.speaker ?? null,
            session_status: session.status,
            updated_at: binding.updated_at,
            chunk_count: chunks.length,
            last_theme: latestAnalysis?.parsed_event.themes[0] ?? null,
            buffered_chars: buffer?.pending_text.length ?? 0,
            buffered_fragments: buffer?.fragment_count ?? 0,
          }
        : null;
    }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== null);

  return dashboardSummarySchema.parse({
    totals: {
      predictions: learningRecords.length,
      pending: learningRecords.filter((record) => record.prediction.status === "pending").length,
      scored: learningRecords.filter((record) => record.prediction.status === "scored").length,
      reviewed: learningRecords.filter((record) => record.prediction.status === "reviewed").length,
      lessons: learningRecords.filter((record) => record.lesson !== null).length,
    },
    live_streams: {
      active_bindings: liveBindings.filter((item) => item.session_status === "active").length,
      recent_bindings: liveBindings.slice(0, 6),
    },
    top_themes: [...topThemeCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([theme, count]) => ({
        theme,
        count,
      })),
    recent_activity: recentActivity,
  });
};
