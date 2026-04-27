import type {
  AnalogMatch,
  CreateSourceRequest,
  ParsedEvent,
  StoredEvent,
  StoredPrediction,
  StoredSource,
} from "@finance-superbrain/schemas"

import { getJsonOrThrow, postJsonOrThrow } from "@/lib/apiClient"

export function parseEventDraft(input: CreateSourceRequest) {
  return postJsonOrThrow<ParsedEvent>("/v1/events/parse", input)
}

export function createSource(input: CreateSourceRequest) {
  return postJsonOrThrow<StoredSource>("/v1/sources", input)
}

export function parseStoredSource(sourceId: string) {
  return postJsonOrThrow<StoredEvent>(`/v1/sources/${sourceId}/parse`, {})
}

export function createStoredPredictions(
  eventId: string,
  payload: { horizons: Array<"1h" | "1d" | "5d">; model_version?: string },
) {
  return postJsonOrThrow<{ predictions: StoredPrediction[] }>(`/v1/events/${eventId}/predictions`, payload).then(
    (response) => response.predictions,
  )
}

export function getEventAnalogs(eventId: string) {
  return getJsonOrThrow<{ event_id: string; analogs: AnalogMatch[] }>(`/v1/events/${eventId}/analogs`).then(
    (response) => response.analogs,
  )
}
