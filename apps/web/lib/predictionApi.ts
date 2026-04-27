import type { Postmortem, PredictionOutcome, SharedReviewNote, StoredEvent, StoredPrediction, StoredSource } from "@finance-superbrain/schemas"

import { getJson, postJsonOrThrow } from "@/lib/apiClient"

export type PredictionDetail = {
  prediction: StoredPrediction
  outcome: PredictionOutcome | null
  postmortem: Postmortem | null
  event: StoredEvent
  source: StoredSource
}

export async function getPredictionDetail(predictionId: string): Promise<PredictionDetail | null> {
  return getJson<PredictionDetail>(`/v1/predictions/${predictionId}`)
}

export async function getPredictionReviewNote(predictionId: string): Promise<SharedReviewNote | null> {
  return getJson<SharedReviewNote | null>(`/v1/predictions/${predictionId}/review-notes`)
}

export async function savePredictionReviewNote(predictionId: string, note: string) {
  return postJsonOrThrow<SharedReviewNote>(`/v1/predictions/${predictionId}/review-notes`, { note })
}
