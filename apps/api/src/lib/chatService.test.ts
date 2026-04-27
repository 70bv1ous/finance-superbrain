/**
 * Phase 11 — chatService unit tests.
 *
 * The Anthropic SDK and repository are fully mocked so tests run offline
 * and never hit external APIs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { GUIDED_DEMO_PROMPTS } from "@finance-superbrain/schemas";

import { processChat } from "./chatService.js";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              answer:
                "CPI came in hot at 0.4% versus 0.3% expected, so the clean first move is higher yields, a firmer dollar, and pressure on rate-sensitive equities.",
              confidence_level: "high",
              evidence: [
                "Historical CPI analogues saw duration sell off first when the surprise moved the implied Fed path higher.",
                "A hotter inflation print tends to support the dollar when policy expectations reprice tighter.",
              ],
              limits: [
                "Positioning can mute the first move if the market was already leaning hawkish.",
              ],
              risks: [
                "A simultaneous growth scare could complicate the equity read-through.",
                "Other same-day macro releases can dominate the tape.",
              ],
              affected_assets: [
                {
                  ticker: "TLT",
                  direction: "down",
                  rationale: "Higher inflation pressure usually weighs on duration through the rate path.",
                },
                {
                  ticker: "DXY",
                  direction: "up",
                  rationale: "A tighter policy path can support the dollar.",
                },
              ],
              analogue_support_summary:
                "4 analogue cases matched, centered on inflation and rate repricing.",
            }),
          },
        ],
      }),
    },
  })),
}));

vi.mock("./marketData.js", () => ({
  getLiveMarketSnapshot: vi.fn().mockResolvedValue([]),
  formatMarketSnapshot: vi.fn().mockReturnValue(""),
}));

vi.mock("./eventCalendar.js", () => ({
  getUpcomingEvents: vi.fn().mockReturnValue([]),
  formatUpcomingEvents: vi.fn().mockReturnValue(""),
}));

vi.mock("./caseSearch.js", () => ({
  searchCases: vi.fn().mockResolvedValue([]),
}));

vi.mock("./predictionTracker.js", () => ({
  logPrediction: vi.fn(),
}));

const mockRepository = {
  listLessons: vi.fn().mockResolvedValue([]),
  listLearningRecords: vi.fn().mockResolvedValue([]),
};

const API_KEY = "test-api-key";

async function chat(query: string, session_id?: string, apiKey: string | undefined = API_KEY) {
  return processChat({ query, session_id }, mockRepository as any, apiKey);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CHAT_MODEL_BACKEND;
  mockRepository.listLessons.mockResolvedValue([]);
  mockRepository.listLearningRecords.mockResolvedValue([]);
});

describe("event type detection", () => {
  it("'What happens to SPY if CPI comes in hot?' -> event_type === 'cpi'", async () => {
    const response = await chat("What happens to SPY if CPI comes in hot?");
    expect(response.event_type).toBe("cpi");
  });

  it("'How will markets react to the Fed rate decision?' -> event_type === 'fomc'", async () => {
    const response = await chat("How will markets react to the Fed rate decision?");
    expect(response.event_type).toBe("fomc");
  });

  it("'NFP beats expectations by 100k jobs, what moves?' -> event_type === 'nfp'", async () => {
    const response = await chat("NFP beats expectations by 100k jobs, what moves?");
    expect(response.event_type).toBe("nfp");
  });
});

describe("response shape", () => {
  it("response has all required proof fields", async () => {
    const response = await chat("CPI just printed hot, what happens next?");
    expect(response).toHaveProperty("answer");
    expect(response).toHaveProperty("event_type");
    expect(response).toHaveProperty("confidence_level");
    expect(response).toHaveProperty("evidence");
    expect(response).toHaveProperty("limits");
    expect(response).toHaveProperty("risks");
    expect(response).toHaveProperty("affected_assets");
    expect(response).toHaveProperty("memory_support_summary");
    expect(response).toHaveProperty("analogues_referenced");
    expect(response).toHaveProperty("session_id");
  });

  it("uses model-supplied limits and affected assets when present", async () => {
    const response = await chat("CPI came in hot");
    expect(response.limits.length).toBeGreaterThan(0);
    expect(response.affected_assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticker: "TLT", direction: "down" }),
        expect.objectContaining({ ticker: "DXY", direction: "up" }),
      ]),
    );
  });
});

describe("session_id handling", () => {
  it("returns the provided session_id", async () => {
    const response = await chat("fomc meeting today", "my-session-123");
    expect(response.session_id).toBe("my-session-123");
  });

  it("generates a session_id when none is provided", async () => {
    const response = await chat("nfp beat consensus");
    expect(typeof response.session_id).toBe("string");
    expect(response.session_id.length).toBeGreaterThan(0);
  });
});

describe("mock mode", () => {
  it("falls back to deterministic proof responses when no API key is configured", async () => {
    const prompt = GUIDED_DEMO_PROMPTS.find((entry) => entry.id === "macro-hot-cpi");
    expect(prompt).toBeTruthy();

    const response = await chat(prompt!.prompt, undefined, undefined);

    expect(response.answer.length).toBeGreaterThan(40);
    expect(response.evidence.length).toBeGreaterThan(0);
    expect(response.limits.length).toBeGreaterThan(0);
    expect(response.risks.length).toBeGreaterThan(0);
    expect(response.affected_assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticker: "TLT", direction: "down" }),
        expect.objectContaining({ ticker: "DXY", direction: "up" }),
      ]),
    );
  });

  it("honors forced mock mode even when an API key exists", async () => {
    process.env.CHAT_MODEL_BACKEND = "mock";

    const response = await chat("Tariff rhetoric on China just escalated again. What is the most defensible market read-through?");

    expect(response.limits.length).toBeGreaterThan(0);
    expect(response.risks.length).toBeGreaterThan(0);
    expect(response.affected_assets.length).toBeGreaterThan(0);
  });

  it("surfaces imported Obsidian memory and avoids stale query-only cache hits", async () => {
    process.env.CHAT_MODEL_BACKEND = "mock";
    const query = "How should the desk use my Obsidian CPI memory note?";

    mockRepository.listLessons.mockResolvedValueOnce([]);
    const first = await chat(query, "session-before-import");
    expect(first.memory_support_summary ?? null).toBeNull();

    mockRepository.listLessons.mockResolvedValueOnce([
      {
        id: "lesson-imported",
        lesson_summary: "Human note: hot CPI usually matters most when the desk is underhedged on duration.",
        metadata: {
          imported_from: "obsidian",
          import_mode: "selective_human_inbox",
          obsidian_relative_path: "Finance Superbrain/Human Inbox/CPI desk note.md",
          obsidian_content_hash: "hash-cpi-note",
        },
        created_at: "2026-04-20T10:00:00.000Z",
      },
    ]);
    const second = await chat(query, "session-after-import");

    expect(second.cached).not.toBe(true);
    expect(second.memory_support_summary).toContain("human Obsidian memory");
    expect(second.memory_support_summary).toContain("CPI desk note.md");
  });
});
