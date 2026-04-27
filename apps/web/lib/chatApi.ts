import type { ChatProofResponse } from "@finance-superbrain/schemas"

import { resolveApiBaseUrl } from "@/lib/apiClient"

export type EventType = ChatProofResponse["event_type"]
export type ConfidenceLevel = ChatProofResponse["confidence_level"]
export type ChatResponse = ChatProofResponse

export type ChatMessage = {
  id: string
  role: "user" | "brain"
  content: string
  response?: ChatResponse
  timestamp: Date
}

export type MarketTicker = {
  symbol: string
  label: string
  price: number
  change_pct: number
}

export type UpcomingEvent = {
  name: string
  event_type: EventType
  date: string
  days_away: number
  description: string
  importance: "high" | "medium" | "low"
}

export async function sendChatMessage(
  query: string,
  sessionId?: string
): Promise<ChatResponse> {
  const res = await fetch(`${resolveApiBaseUrl()}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, session_id: sessionId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    const message =
      err &&
      typeof err === "object" &&
      "message" in err &&
      typeof err.message === "string"
        ? err.message
        : "Request failed"
    throw new Error(message)
  }
  return res.json() as Promise<ChatResponse>
}

export async function getMarketSnapshot(): Promise<MarketTicker[]> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/market`, { next: { revalidate: 0 } })
    if (!res.ok) return []
    const d = await res.json()
    return (d.raw ?? []) as MarketTicker[]
  } catch {
    return []
  }
}

export async function getUpcomingEvents(): Promise<UpcomingEvent[]> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/briefing`, { next: { revalidate: 0 } })
    if (!res.ok) return []
    const d = await res.json()
    return (d.upcoming_events ?? []) as UpcomingEvent[]
  } catch {
    return []
  }
}

// Accuracy / Prediction Log

export type AccuracyStats = {
  total_logged:         number
  total_resolved:       number
  overall_accuracy_pct: number
  by_event_type: Record<string, { correct: number; total: number; pct: number }>
  by_confidence: Record<string, { correct: number; total: number; pct: number }>
}

export type PredictionRow = {
  id:               string
  session_id:       string
  query:            string
  event_type:       string
  confidence_level: string
  answer_summary:   string
  analogues_count:  number
  outcome:          "correct" | "incorrect" | "partial" | null
  outcome_notes:    string | null
  created_at:       string
  resolved_at:      string | null
}

export async function getAccuracyStats(): Promise<AccuracyStats | null> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/accuracy`, { next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json() as Promise<AccuracyStats>
  } catch { return null }
}

export async function getRecentPredictions(limit = 20): Promise<PredictionRow[]> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/accuracy/recent?limit=${limit}`, { next: { revalidate: 0 } })
    if (!res.ok) return []
    const d = await res.json()
    return (d.predictions ?? []) as PredictionRow[]
  } catch { return [] }
}

// Feedback Correction

export type CorrectionMove = {
  ticker: string
  direction: "up" | "down" | "flat"
  magnitude_bp: number
}

export type CorrectionRequest = {
  session_id?: string
  question: string
  brain_answer: string
  actual_moves: CorrectionMove[]
  occurred_at: string
  notes: string
}

export type CorrectionResult = {
  case_id: string
  case_pack: string
  status: string
  message: string
}

export async function submitCorrection(req: CorrectionRequest): Promise<CorrectionResult> {
  const res = await fetch(`${resolveApiBaseUrl()}/v1/feedback/correction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message ?? "Failed to submit correction")
  }
  return res.json() as Promise<CorrectionResult>
}

export async function markOutcome(
  sessionId: string,
  outcome: "correct" | "incorrect" | "partial",
  notes = ""
): Promise<boolean> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, outcome, notes }),
    })
    return res.ok
  } catch { return false }
}

// Library / Domain Pack Browser

export type LibraryPackStat = {
  case_pack:      string
  case_count:     number
  draft_count:    number
  reviewed_count: number
  latest_case_at: string | null
}

export type LibraryPacksResponse = {
  packs:       LibraryPackStat[]
  total_cases: number
  pack_count:  number
}

export type Lesson = {
  id: string
  prediction_id: string
  lesson_type: "mistake" | "reinforcement"
  lesson_summary: string
  metadata: Record<string, string>
  created_at: string
}

export type LessonSearchResult = {
  lesson_id: string
  prediction_id: string
  event_id: string
  score: number
  lesson_type: "mistake" | "reinforcement"
  lesson_summary: string
  event_summary: string
  themes: string[]
  horizon: "1h" | "1d" | "5d"
  verdict: "correct" | "partially_correct" | "wrong" | null
  total_score: number | null
  created_at: string
}

export type LessonExplorerItem = {
  lesson_id: string
  prediction_id: string
  event_id: string
  lesson_type: "mistake" | "reinforcement"
  lesson_summary: string
  event_summary: string
  themes: string[]
  horizon: "1h" | "1d" | "5d"
  verdict: "correct" | "partially_correct" | "wrong" | null
  total_score: number | null
  sentiment: "risk_on" | "risk_off" | "neutral"
  failure_tags: string[]
  created_at: string
}

export async function getLibraryPacks(): Promise<LibraryPacksResponse | null> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/library/packs`, { next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json() as Promise<LibraryPacksResponse>
  } catch { return null }
}

export async function getLessons(): Promise<Lesson[]> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/lessons`, { next: { revalidate: 0 } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.lessons ?? []) as Lesson[]
  } catch { return [] }
}

export async function searchLessons(query: string): Promise<LessonSearchResult[]> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/lessons/search?q=${encodeURIComponent(query)}`, { next: { revalidate: 0 } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.results ?? []) as LessonSearchResult[]
  } catch { return [] }
}

export async function getLessonExplorer(limit = 60): Promise<LessonExplorerItem[]> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/lessons/explorer?limit=${limit}`, { next: { revalidate: 0 } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.items ?? []) as LessonExplorerItem[]
  } catch { return [] }
}

// ─── Evaluation Framework ─────────────────────────────────────────────────────

export type SplitDomainStat = {
  domain:     string
  train:      number
  validation: number
  test:       number
  total:      number
}

export type SplitStats = {
  split_version:    string
  freeze_date:      string
  train_end:        string
  val_end:          string
  totals:           { train: number; validation: number; test: number; live: number; untagged: number; total: number }
  by_domain:        SplitDomainStat[]
  power_assessment: string
}

export type ContaminationEntry = {
  id:                 string
  type:               string
  severity:           string
  description:        string
  case_ids:           string[]
  splits_involved:    string[]
  invalidates_results: boolean
  mitigation:         string
}

export type ContaminationAudit = {
  total:            number
  warnings:         number
  infos:            number
  invalidating:     number
  entries:          ContaminationEntry[]
}

export type DomainReport = {
  domain:         string
  n:              number
  n_correct:      number
  accuracy:       number
  p_value:        number
  is_significant: boolean
  is_powered:     boolean
}

export type CalibrationBin = {
  bin:      string
  n:        number
  accuracy: number
}

export type EvalReport = {
  eval_split:                   string
  split_version:                string
  n_predictions:                number
  n_scored:                     number
  n_independent_events:         number
  n_contaminated:               number
  overall_accuracy:             number
  high_conf_accuracy:           number | null
  medium_conf_accuracy:         number | null
  low_conf_accuracy:            number | null
  brier_score:                  number
  aggregate_p_value:            number
  bonferroni_threshold:         number
  is_statistically_significant: boolean
  aggregate_powered:            boolean
  domain_breakdown:             DomainReport[]
  calibration_curve:            CalibrationBin[]
  created_at:                   string
}

export async function getEvalSplitStats(): Promise<SplitStats | null> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/evaluation/split-stats`, { next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json() as Promise<SplitStats>
  } catch { return null }
}

export async function getContaminationAudit(): Promise<ContaminationAudit | null> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/evaluation/contamination-audit`, { next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json() as Promise<ContaminationAudit>
  } catch { return null }
}

export async function getEvalReport(split: "validation" | "test" = "test"): Promise<EvalReport | null> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/v1/evaluation/report?eval_split=${split}`, { next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json() as Promise<EvalReport>
  } catch { return null }
}
