import { describe, expect, it } from "vitest"

import { buildInvestigationDesk } from "@/lib/investigationDesk"

describe("investigationDesk", () => {
  it("prioritizes unresolved review work over drafts, runs, and chat threads", () => {
    const items = buildInvestigationDesk({
      latestSession: {
        id: "thread-1",
        sessionId: "session-1",
        title: "Rates thread",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T04:00:00.000Z",
        messages: [],
      },
      studioDraft: {
        form: {
          source_type: "headline",
          title: "CPI surprise",
          speaker: "",
          publisher: "",
          raw_uri: "",
          occurred_at: "",
          raw_text: "Inflation surprised to the upside.",
          model_version: "impact-engine-v0",
          horizons: ["1d"],
        },
        preview: null,
        updatedAt: "2026-04-01T03:00:00.000Z",
      },
      studioRuns: [
        {
          id: "event-1",
          title: "Powell press conference",
          sourceType: "speech",
          form: {
            source_type: "speech",
            title: "Powell press conference",
            speaker: "Powell",
            publisher: "FOMC",
            raw_uri: "",
            occurred_at: "",
            raw_text: "Long transcript",
            model_version: "impact-engine-v0",
            horizons: ["1d"],
          },
          preview: null,
          source: null,
          event: {
            id: "event-1",
            source_id: "source-1",
            event_class: "macro_commentary",
            summary: "Powell sounded more cautious.",
            entities: [],
            why_it_matters: [],
            themes: [],
            candidate_assets: [],
            sentiment: "neutral",
            urgency_score: 0.4,
            novelty_score: 0.4,
            created_at: "2026-04-01T01:00:00.000Z",
          },
          predictions: [],
          analogs: [],
          eventSummary: "Powell sounded more cautious.",
          eventId: "event-1",
          predictionIds: [],
          analogPredictionIds: [],
          updatedAt: "2026-04-01T02:00:00.000Z",
        },
      ],
      recentPredictions: [
        {
          id: "prediction-1",
          session_id: "session-1",
          query: "What happens after the CPI surprise?",
          event_type: "cpi",
          confidence_level: "high",
          answer_summary: "Yields up, equities weaker.",
          analogues_count: 3,
          outcome: null,
          outcome_notes: null,
          created_at: "2026-04-01T05:00:00.000Z",
          resolved_at: null,
        },
      ],
      recentItems: [],
    })

    expect(items[0]?.lane).toBe("needs_review")
    expect(items[1]?.lane).toBe("drafting")
  })

  it("keeps recent context as lower-priority background navigation", () => {
    const items = buildInvestigationDesk({
      latestSession: null,
      studioDraft: null,
      studioRuns: [],
      recentPredictions: [],
      recentItems: [
        {
          id: "prediction-1",
          kind: "prediction",
          href: "/accuracy?focus=prediction-1",
          title: "Latest review focus",
          description: "A scored prediction still needs a final postmortem note.",
          updatedAt: "2026-04-01T06:00:00.000Z",
        },
      ],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      lane: "recent_context",
      actionLabel: "Open context",
    })
  })
})
