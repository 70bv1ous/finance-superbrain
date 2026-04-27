import type { PredictionRow } from "@/lib/chatApi"

export type ReviewState = "all" | "awaiting_verdict" | "scored" | "reviewed"

export function normalizeConfidenceLevel(level: string): "high" | "medium" | "low" {
  if (level === "high" || level === "medium" || level === "low") {
    return level
  }

  return "medium"
}

export function getReviewState(prediction: PredictionRow): Exclude<ReviewState, "all"> {
  if (!prediction.outcome) {
    return "awaiting_verdict"
  }

  return prediction.outcome_notes?.trim() ? "reviewed" : "scored"
}

function confidenceWeight(level: string) {
  switch (normalizeConfidenceLevel(level)) {
    case "high":
      return 3
    case "medium":
      return 2
    default:
      return 1
  }
}

function timeValue(value: string | null) {
  if (!value) {
    return 0
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function sortPredictionsForReview(predictions: PredictionRow[]) {
  return [...predictions].sort((left, right) => {
    const leftState = getReviewState(left)
    const rightState = getReviewState(right)
    const stateWeight = {
      awaiting_verdict: 3,
      scored: 2,
      reviewed: 1,
    } as const

    if (stateWeight[leftState] !== stateWeight[rightState]) {
      return stateWeight[rightState] - stateWeight[leftState]
    }

    if (leftState === "awaiting_verdict") {
      const confidenceDelta = confidenceWeight(right.confidence_level) - confidenceWeight(left.confidence_level)

      if (confidenceDelta !== 0) {
        return confidenceDelta
      }
    }

    const rightTime = timeValue(right.resolved_at ?? right.created_at)
    const leftTime = timeValue(left.resolved_at ?? left.created_at)

    if (rightTime !== leftTime) {
      return rightTime - leftTime
    }

    return timeValue(right.created_at) - timeValue(left.created_at)
  })
}

export function filterReviewPredictions(
  predictions: PredictionRow[],
  input: { reviewFilter: ReviewState; search: string },
) {
  const trimmed = input.search.trim().toLowerCase()

  return sortPredictionsForReview(predictions).filter((prediction) => {
    const reviewState = getReviewState(prediction)
    const matchesFilter = input.reviewFilter === "all" ? true : reviewState === input.reviewFilter
    const haystack = `${prediction.query} ${prediction.answer_summary} ${prediction.event_type}`.toLowerCase()
    const matchesSearch = trimmed.length === 0 ? true : haystack.includes(trimmed)

    return matchesFilter && matchesSearch
  })
}
