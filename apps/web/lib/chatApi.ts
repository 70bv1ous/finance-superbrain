export type EventType = "cpi" | "fomc" | "nfp" | "earnings" | "energy" | "credit" | "policy_fx" | "general"
export type ConfidenceLevel = "high" | "medium" | "low"

export type ChatResponse = {
  answer: string
  event_type: EventType
  confidence_level: ConfidenceLevel
  evidence: string[]
  risks: string[]
  analogues_referenced: number
  session_id: string
  cached?: boolean
}

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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3099"

export async function sendChatMessage(
  query: string,
  sessionId?: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, session_id: sessionId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).message ?? "Request failed")
  }
  return res.json() as Promise<ChatResponse>
}

export async function getMarketSnapshot(): Promise<MarketTicker[]> {
  try {
    const res = await fetch(`${API_URL}/v1/market`, { next: { revalidate: 0 } })
    if (!res.ok) return []
    const d = await res.json()
    return (d.raw ?? []) as MarketTicker[]
  } catch {
    return []
  }
}

export async function getUpcomingEvents(): Promise<UpcomingEvent[]> {
  try {
    const res = await fetch(`${API_URL}/v1/briefing`, { next: { revalidate: 0 } })
    if (!res.ok) return []
    const d = await res.json()
    return (d.upcoming_events ?? []) as UpcomingEvent[]
  } catch {
    return []
  }
}
