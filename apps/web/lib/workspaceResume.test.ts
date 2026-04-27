import { describe, expect, it } from "vitest"

import type { PredictionRow } from "@/lib/chatApi"
import type { StoredChatSession } from "@/lib/chatSessionStore"
import type { SavedStudioRun, StudioDraftRecord, WorkspaceRecentItem } from "@/components/WorkspaceProvider"
import type { InvestigationTrail } from "@/lib/investigationTrail"
import { buildWorkspaceResumeActions, getRecentContextItems } from "@/lib/workspaceResume"

function buildPrediction(overrides: Partial<PredictionRow>): PredictionRow {
  return {
    id: overrides.id ?? "prediction-1",
    session_id: overrides.session_id ?? "session-1",
    query: overrides.query ?? "Will inflation surprise to the upside?",
    event_type: overrides.event_type ?? "cpi",
    confidence_level: overrides.confidence_level ?? "high",
    answer_summary: overrides.answer_summary ?? "Rates volatility rises.",
    analogues_count: overrides.analogues_count ?? 3,
    outcome: overrides.outcome ?? null,
    outcome_notes: overrides.outcome_notes ?? null,
    created_at: overrides.created_at ?? "2026-03-30T12:00:00.000Z",
    resolved_at: overrides.resolved_at ?? null,
  }
}

function buildDraft(overrides: Partial<StudioDraftRecord> = {}): StudioDraftRecord {
  return {
    form: {
      source_type: "headline",
      title: "Powell says progress is uneven",
      speaker: "",
      publisher: "",
      raw_uri: "",
      occurred_at: "",
      raw_text: "Powell says progress is uneven and markets should expect longer restrictive policy.",
      model_version: "impact-engine-v0",
      horizons: ["1d"],
    },
    preview: null,
    updatedAt: overrides.updatedAt ?? "2026-03-31T09:00:00.000Z",
    ...overrides,
  }
}

function buildRun(overrides: Partial<SavedStudioRun> = {}): SavedStudioRun {
  return {
    id: overrides.id ?? "event-1",
    title: overrides.title ?? "Powell uneven progress",
    sourceType: overrides.sourceType ?? "headline",
    form: overrides.form ?? buildDraft().form,
    preview: overrides.preview ?? null,
    source: overrides.source ?? null,
    event:
      overrides.event ??
      ({
        id: "11111111-1111-4111-8111-111111111111",
        source_id: "22222222-2222-4222-8222-222222222222",
        source_type: "headline",
        summary: "Fed language stays restrictive.",
        event_class: "policy_speech",
        sentiment: "risk_off",
        urgency_score: 0.8,
        novelty_score: 0.6,
        entities: [
          {
            type: "person",
            value: "Powell",
          },
        ],
        why_it_matters: ["Rates stay tighter for longer."],
        themes: ["rates", "usd"],
        candidate_assets: ["2Y", "DXY"],
        occurred_at: "2026-03-31T08:00:00.000Z",
        created_at: "2026-03-31T08:05:00.000Z",
      } as SavedStudioRun["event"]),
    predictions: overrides.predictions ?? [],
    analogs: overrides.analogs ?? [],
    eventSummary: overrides.eventSummary ?? "Fed language stays restrictive.",
    eventId: overrides.eventId ?? "event-1",
    predictionIds: overrides.predictionIds ?? ["prediction-1"],
    analogPredictionIds: overrides.analogPredictionIds ?? ["analog-1"],
    updatedAt: overrides.updatedAt ?? "2026-03-31T10:00:00.000Z",
  }
}

function buildSession(overrides: Partial<StoredChatSession> = {}): StoredChatSession {
  return {
    id: overrides.id ?? "thread-1",
    sessionId: overrides.sessionId,
    title: overrides.title ?? "Fed restrictive path",
    createdAt: overrides.createdAt ?? "2026-03-31T07:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-31T11:00:00.000Z",
    messages:
      overrides.messages ??
      [
        {
          id: "message-1",
          role: "user",
          content: "What does this mean for rates?",
          timestamp: "2026-03-31T11:00:00.000Z",
        },
      ],
  }
}

function buildTrail(overrides: Partial<InvestigationTrail> = {}): InvestigationTrail {
  return {
    id: overrides.id ?? "trail-1",
    title: overrides.title ?? "Powell uneven progress",
    eventId: overrides.eventId ?? "event-1",
    predictionIds: overrides.predictionIds ?? ["prediction-1"],
    updatedAt: overrides.updatedAt ?? "2026-03-31T10:30:00.000Z",
    steps:
      overrides.steps ??
      [
        {
          id: "review-focus:prediction-1",
          kind: "review_focus",
          status: "under_review",
          href: "/accuracy?focus=prediction-1",
          title: "Powell uneven progress",
          detail: "Review is still in progress.",
          updatedAt: "2026-03-31T10:30:00.000Z",
        },
      ],
  }
}

describe("workspaceResume", () => {
  it("builds prioritized resume actions for review, studio, and chat continuity", () => {
    const actions = buildWorkspaceResumeActions({
      latestSession: buildSession(),
      studioDraft: buildDraft(),
      latestStudioRun: buildRun(),
      recentPredictions: [buildPrediction({ id: "prediction-review", event_type: "policy_fx" })],
      investigationTrails: [buildTrail()],
    })

    expect(actions.map((action) => action.kind)).toEqual(["investigation_trail", "review", "studio_draft", "studio_run", "chat_thread"])
    expect(actions[0]).toMatchObject({
      href: "/accuracy?focus=prediction-1",
      label: "Continue trail",
    })
    expect(actions[0]).toMatchObject({
      href: "/accuracy?focus=prediction-1",
    })
    expect(actions[1]).toMatchObject({
      href: "/accuracy?focus=prediction-review",
      label: "Review now",
      tone: "amber",
    })
    expect(actions[3]).toMatchObject({
      href: "/studio?run=event-1",
      label: "Resume run",
    })
    expect(actions[4]).toMatchObject({
      href: "/workspace?thread=thread-1",
      label: "Resume thread",
    })
  })

  it("deduplicates resume actions when the trail already points at the same next route", () => {
    const actions = buildWorkspaceResumeActions({
      latestSession: null,
      studioDraft: null,
      latestStudioRun: null,
      recentPredictions: [buildPrediction({ id: "prediction-1" })],
      investigationTrails: [buildTrail()],
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]?.kind).toBe("investigation_trail")
  })

  it("limits recent context items without reordering them", () => {
    const items: WorkspaceRecentItem[] = [
      {
        id: "one",
        kind: "studio_run",
        href: "/studio?run=one",
        title: "One",
        description: "First",
        updatedAt: "2026-03-31T10:00:00.000Z",
      },
      {
        id: "two",
        kind: "prediction",
        href: "/predictions/two",
        title: "Two",
        description: "Second",
        updatedAt: "2026-03-31T09:00:00.000Z",
      },
      {
        id: "three",
        kind: "studio_draft",
        href: "/studio",
        title: "Three",
        description: "Third",
        updatedAt: "2026-03-31T08:00:00.000Z",
      },
    ]

    expect(getRecentContextItems(items, 2).map((item) => item.id)).toEqual(["one", "two"])
  })
})
