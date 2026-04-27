import { afterEach, describe, expect, it, vi } from "vitest"

import { getStoredChatSessionsServerSnapshot, getStoredChatSessionsSnapshot } from "@/lib/chatSessionStore"

const STORAGE_KEY = "finance-superbrain.chat-sessions.v1"

function installWindow(rawValue: string | null) {
  const store = new Map<string, string>()

  if (rawValue !== null) {
    store.set(STORAGE_KEY, rawValue)
  }

  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("chat session store snapshots", () => {
  it("returns the same empty reference when storage is missing", () => {
    installWindow(null)

    const first = getStoredChatSessionsSnapshot()
    const second = getStoredChatSessionsSnapshot()
    const serverSnapshot = getStoredChatSessionsServerSnapshot()

    expect(first).toBe(second)
    expect(first).toBe(serverSnapshot)
    expect(first).toHaveLength(0)
  })

  it("returns the same reference when storage has not changed", () => {
    installWindow(
      JSON.stringify([
        {
          id: "thread-1",
          title: "Rates desk",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:10:00.000Z",
          messages: [
            {
              id: "message-1",
              role: "user",
              content: "What changed?",
              timestamp: "2026-04-01T00:00:00.000Z",
            },
          ],
        },
      ]),
    )

    const first = getStoredChatSessionsSnapshot()
    const second = getStoredChatSessionsSnapshot()

    expect(first).toBe(second)
    expect(first).toHaveLength(1)
  })
})
