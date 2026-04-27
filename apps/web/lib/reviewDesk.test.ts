import { describe, expect, it } from "vitest"

import type { PredictionRow } from "@/lib/chatApi"
import { filterReviewPredictions, getReviewState, sortPredictionsForReview } from "@/lib/reviewDesk"

function buildPrediction(overrides: Partial<PredictionRow>): PredictionRow {
  return {
    id: overrides.id ?? "prediction-1",
    session_id: overrides.session_id ?? "session-1",
    query: overrides.query ?? "What happens next?",
    event_type: overrides.event_type ?? "fomc",
    confidence_level: overrides.confidence_level ?? "medium",
    answer_summary: overrides.answer_summary ?? "Rates stay restrictive.",
    analogues_count: overrides.analogues_count ?? 2,
    outcome: overrides.outcome ?? null,
    outcome_notes: overrides.outcome_notes ?? null,
    created_at: overrides.created_at ?? "2026-03-30T12:00:00.000Z",
    resolved_at: overrides.resolved_at ?? null,
  }
}

describe("reviewDesk", () => {
  it("classifies review state based on outcome and notes", () => {
    expect(getReviewState(buildPrediction({ outcome: null }))).toBe("awaiting_verdict")
    expect(getReviewState(buildPrediction({ outcome: "correct", outcome_notes: null }))).toBe("scored")
    expect(getReviewState(buildPrediction({ outcome: "correct", outcome_notes: "Held through payroll print." }))).toBe(
      "reviewed",
    )
  })

  it("prioritizes awaiting verdict items before scored and reviewed entries", () => {
    const awaitingHigh = buildPrediction({
      id: "awaiting-high",
      confidence_level: "high",
      created_at: "2026-03-30T13:00:00.000Z",
    })
    const awaitingLow = buildPrediction({
      id: "awaiting-low",
      confidence_level: "low",
      created_at: "2026-03-30T14:00:00.000Z",
    })
    const scored = buildPrediction({
      id: "scored",
      outcome: "partial",
      resolved_at: "2026-03-31T10:00:00.000Z",
    })
    const reviewed = buildPrediction({
      id: "reviewed",
      outcome: "incorrect",
      outcome_notes: "Missed fiscal follow-through.",
      resolved_at: "2026-03-31T11:00:00.000Z",
    })

    expect(sortPredictionsForReview([reviewed, scored, awaitingLow, awaitingHigh]).map((item) => item.id)).toEqual([
      "awaiting-high",
      "awaiting-low",
      "scored",
      "reviewed",
    ])
  })

  it("filters the review queue by state and text query", () => {
    const predictions = [
      buildPrediction({ id: "awaiting", query: "Will payrolls cool Treasury yields?" }),
      buildPrediction({ id: "scored", outcome: "correct", answer_summary: "FX stabilized after CPI." }),
      buildPrediction({
        id: "reviewed",
        outcome: "incorrect",
        outcome_notes: "Wrong on credit spillover.",
        event_type: "credit",
      }),
    ]

    expect(filterReviewPredictions(predictions, { reviewFilter: "scored", search: "fx" }).map((item) => item.id)).toEqual([
      "scored",
    ])
    expect(
      filterReviewPredictions(predictions, { reviewFilter: "reviewed", search: "credit" }).map((item) => item.id),
    ).toEqual(["reviewed"])
  })
})
