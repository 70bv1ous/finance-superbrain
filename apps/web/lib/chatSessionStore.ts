import type { ChatResponse } from "@/lib/chatApi"

const STORAGE_KEY = "finance-superbrain.chat-sessions.v1"
const MAX_SESSIONS = 24
export const CHAT_SESSIONS_UPDATED_EVENT = "finance-superbrain:chat-sessions-updated"
const EMPTY_SESSIONS: StoredChatSession[] = []
let cachedRawSessions: string | null = null
let cachedSessionsSnapshot: StoredChatSession[] = EMPTY_SESSIONS

export type StoredThreadMessage = {
  id: string
  role: "user" | "brain"
  content: string
  response?: ChatResponse
  question?: string
  timestamp: string
}

export type StoredChatSession = {
  id: string
  sessionId?: string
  title: string
  createdAt: string
  updatedAt: string
  messages: StoredThreadMessage[]
}

function isStoredThreadMessage(value: unknown): value is StoredThreadMessage {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<StoredThreadMessage>

  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "brain") &&
    typeof candidate.content === "string" &&
    typeof candidate.timestamp === "string"
  )
}

function isStoredChatSession(value: unknown): value is StoredChatSession {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<StoredChatSession>

  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isStoredThreadMessage)
  )
}

function sortSessions(sessions: StoredChatSession[]) {
  return [...sessions]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_SESSIONS)
}

export function loadStoredChatSessions(): StoredChatSession[] {
  if (typeof window === "undefined") {
    return cachedSessionsSnapshot
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      cachedRawSessions = null
      cachedSessionsSnapshot = EMPTY_SESSIONS
      return cachedSessionsSnapshot
    }

    if (raw === cachedRawSessions) {
      return cachedSessionsSnapshot
    }

    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      cachedRawSessions = raw
      cachedSessionsSnapshot = EMPTY_SESSIONS
      return cachedSessionsSnapshot
    }

    cachedRawSessions = raw
    cachedSessionsSnapshot = sortSessions(parsed.filter(isStoredChatSession))
    return cachedSessionsSnapshot
  } catch {
    cachedRawSessions = null
    cachedSessionsSnapshot = EMPTY_SESSIONS
    return cachedSessionsSnapshot
  }
}

export function getStoredChatSessionsSnapshot() {
  return loadStoredChatSessions()
}

export function getStoredChatSessionsServerSnapshot() {
  return cachedSessionsSnapshot
}

export function subscribeStoredChatSessions(onChange: () => void) {
  if (typeof window === "undefined") {
    return () => {}
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      onChange()
    }
  }

  const handleLocalUpdate = () => {
    onChange()
  }

  window.addEventListener("storage", handleStorage)
  window.addEventListener(CHAT_SESSIONS_UPDATED_EVENT, handleLocalUpdate)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(CHAT_SESSIONS_UPDATED_EVENT, handleLocalUpdate)
  }
}

export function saveStoredChatSessions(sessions: StoredChatSession[]) {
  if (typeof window === "undefined") {
    return
  }

  const nextSessions = sortSessions(sessions)
  const raw = JSON.stringify(nextSessions)

  cachedRawSessions = raw
  cachedSessionsSnapshot = nextSessions
  window.localStorage.setItem(STORAGE_KEY, raw)
  window.dispatchEvent(new Event(CHAT_SESSIONS_UPDATED_EVENT))
}
