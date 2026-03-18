export type EventType = "cpi" | "fomc" | "nfp" | "general"
export type ConfidenceLevel = "high" | "medium" | "low"

export type ChatResponse = {
  answer: string
  event_type: EventType
  confidence_level: ConfidenceLevel
  evidence: string[]
  risks: string[]
  analogues_referenced: number
  session_id: string
}

export type ChatMessage = {
  id: string
  role: "user" | "brain"
  content: string
  response?: ChatResponse
  timestamp: Date
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
