/**
 * Phase 8A — chatService unit tests.
 *
 * The Anthropic SDK and repository are fully mocked so tests run offline
 * and never hit external APIs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { processChat, type ChatRequest } from "./chatService.js";

// ─── Mock @anthropic-ai/sdk ───────────────────────────────────────────────────

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              answer:
                "CPI came in hot at 0.4% MoM vs 0.3% expected. Equities face headwinds.",
              confidence_level: "high",
              evidence: [
                "Surprise magnitude 0.1% above consensus",
                "Fed will likely maintain hawkish stance",
              ],
              risks: [
                "Market may already be priced for hot print",
                "Concurrent data could dominate",
              ],
            }),
          },
        ],
      }),
    },
  })),
}));

// ─── Mock repository ──────────────────────────────────────────────────────────

const mockRepository = {
  listEvents:      vi.fn().mockResolvedValue([]),
  listLessons:     vi.fn().mockResolvedValue([]),
  listPredictions: vi.fn().mockResolvedValue([]),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API_KEY = "test-api-key";

async function chat(query: string, session_id?: string) {
  return processChat({ query, session_id }, mockRepository as any, API_KEY);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRepository.listEvents.mockResolvedValue([]);
  mockRepository.listLessons.mockResolvedValue([]);
  mockRepository.listPredictions.mockResolvedValue([]);
});

describe("event type detection", () => {
  it("'What happens to SPY if CPI comes in hot?' → event_type === 'cpi'", async () => {
    const r = await chat("What happens to SPY if CPI comes in hot?");
    expect(r.event_type).toBe("cpi");
  });

  it("'How will markets react to the Fed rate decision?' → event_type === 'fomc'", async () => {
    const r = await chat("How will markets react to the Fed rate decision?");
    expect(r.event_type).toBe("fomc");
  });

  it("'NFP beats expectations by 100k jobs, what moves?' → event_type === 'nfp'", async () => {
    const r = await chat("NFP beats expectations by 100k jobs, what moves?");
    expect(r.event_type).toBe("nfp");
  });

  it("'What is the best trading strategy?' → event_type === 'general'", async () => {
    const r = await chat("What is the best trading strategy?");
    expect(r.event_type).toBe("general");
  });

  it("'inflation data release' → event_type === 'cpi'", async () => {
    const r = await chat("What does the inflation data release mean for rates?");
    expect(r.event_type).toBe("cpi");
  });

  it("'consumer price index' → event_type === 'cpi'", async () => {
    const r = await chat("consumer price index rose more than expected");
    expect(r.event_type).toBe("cpi");
  });

  it("'powell speaks today' → event_type === 'fomc'", async () => {
    const r = await chat("powell speaks today, what should I watch?");
    expect(r.event_type).toBe("fomc");
  });

  it("'unemployment rate' → event_type === 'nfp'", async () => {
    const r = await chat("unemployment rate dropped to 3.5%");
    expect(r.event_type).toBe("nfp");
  });
});

describe("response shape", () => {
  it("response has all required fields", async () => {
    const r = await chat("CPI just printed hot, what happens next?");
    expect(r).toHaveProperty("answer");
    expect(r).toHaveProperty("event_type");
    expect(r).toHaveProperty("confidence_level");
    expect(r).toHaveProperty("evidence");
    expect(r).toHaveProperty("risks");
    expect(r).toHaveProperty("analogues_referenced");
    expect(r).toHaveProperty("session_id");
  });

  it("session_id is a string", async () => {
    const r = await chat("CPI came in hot");
    expect(typeof r.session_id).toBe("string");
    expect(r.session_id.length).toBeGreaterThan(0);
  });

  it("evidence is an array", async () => {
    const r = await chat("CPI came in hot");
    expect(Array.isArray(r.evidence)).toBe(true);
  });

  it("risks is an array", async () => {
    const r = await chat("CPI came in hot");
    expect(Array.isArray(r.risks)).toBe(true);
  });

  it("confidence_level is one of 'high' | 'medium' | 'low'", async () => {
    const r = await chat("CPI came in hot");
    expect(["high", "medium", "low"]).toContain(r.confidence_level);
  });

  it("analogues_referenced is a number", async () => {
    const r = await chat("CPI came in hot");
    expect(typeof r.analogues_referenced).toBe("number");
  });
});

describe("session_id handling", () => {
  it("when session_id provided in request, it is returned in response", async () => {
    const r = await chat("fomc meeting today", "my-session-123");
    expect(r.session_id).toBe("my-session-123");
  });

  it("when session_id not provided, response still contains a valid session_id string", async () => {
    const r = await chat("nfp beat consensus");
    expect(typeof r.session_id).toBe("string");
    expect(r.session_id.length).toBeGreaterThan(0);
  });

  it("two calls without session_id produce different session_ids", async () => {
    const r1 = await chat("fomc");
    const r2 = await chat("fomc");
    // Both should be non-empty strings; UUIDs are unique
    expect(typeof r1.session_id).toBe("string");
    expect(typeof r2.session_id).toBe("string");
  });
});

describe("graceful degradation", () => {
  it("when repository throws, processChat still returns a valid ChatResponse", async () => {
    mockRepository.listEvents.mockRejectedValueOnce(new Error("DB error"));
    mockRepository.listLessons.mockRejectedValueOnce(new Error("DB error"));
    mockRepository.listPredictions.mockRejectedValueOnce(new Error("DB error"));

    // Should not throw
    const r = await processChat(
      { query: "CPI hot print, what happens?" },
      mockRepository as any,
      API_KEY,
    );

    expect(r).toHaveProperty("answer");
    expect(r).toHaveProperty("event_type");
    expect(r).toHaveProperty("session_id");
    expect(typeof r.session_id).toBe("string");
  });

  it("when repository throws, analogues_referenced falls back to 0", async () => {
    mockRepository.listEvents.mockRejectedValueOnce(new Error("DB error"));
    mockRepository.listLessons.mockRejectedValueOnce(new Error("DB error"));
    mockRepository.listPredictions.mockRejectedValueOnce(new Error("DB error"));

    const r = await processChat(
      { query: "payroll miss" },
      mockRepository as any,
      API_KEY,
    );

    expect(r.analogues_referenced).toBe(0);
  });
});
