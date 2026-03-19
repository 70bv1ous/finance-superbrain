/**
 * Chat service (Phase 8A — Intelligence Chat API).
 *
 * Core brain service: takes a natural-language trader query, enriches it
 * with live context from the repository, and asks the LLM to produce a
 * structured, senior-analyst-quality response grounded in real case data.
 *
 * Additions:
 *   #2 — Cost guards: daily query cap (100/day) + 1-hour response cache
 *   #5 — Live market data injected into every prompt
 *   #6 — Every response logged to prediction_log for accuracy tracking
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Repository } from "./repository.types.js";
import { getLiveMarketSnapshot, formatMarketSnapshot } from "./marketData.js";
import { logPrediction } from "./predictionTracker.js";
import { getUpcomingEvents, formatUpcomingEvents } from "./eventCalendar.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventType = "cpi" | "fomc" | "nfp" | "earnings" | "energy" | "credit" | "policy_fx" | "general";

export type ChatRequest = {
  query: string;
  session_id?: string;
};

export type ChatResponse = {
  answer: string;
  event_type: EventType;
  confidence_level: "high" | "medium" | "low";
  /** 2-4 key evidence points the brain used. */
  evidence: string[];
  /** 1-3 risk factors or invalidation conditions. */
  risks: string[];
  /** How many historical analogues were found. */
  analogues_referenced: number;
  session_id: string;
  /** Whether this response was served from cache. */
  cached?: boolean;
};

// ─── #2 Cost Guards: Daily cap ────────────────────────────────────────────────

const MAX_DAILY_QUERIES = 100; // ~$0.15/day at haiku-4-5 pricing
let dailyQueryCount  = 0;
let dailyResetDate   = new Date().toDateString();

function checkDailyLimit(): void {
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailyQueryCount = 0;
    dailyResetDate  = today;
  }
  if (dailyQueryCount >= MAX_DAILY_QUERIES) {
    throw new Error(`Daily query limit of ${MAX_DAILY_QUERIES} reached. Resets at midnight UTC.`);
  }
  dailyQueryCount++;
}

export function getDailyUsage(): { used: number; limit: number; remaining: number } {
  const today = new Date().toDateString();
  if (today !== dailyResetDate) { dailyQueryCount = 0; dailyResetDate = today; }
  return { used: dailyQueryCount, limit: MAX_DAILY_QUERIES, remaining: MAX_DAILY_QUERIES - dailyQueryCount };
}

// ─── #2 Cost Guards: Response cache ──────────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const queryCache   = new Map<string, { response: ChatResponse; expires: number }>();

function cacheKey(query: string): string {
  return query.toLowerCase().trim().slice(0, 300);
}

function getCached(query: string): ChatResponse | null {
  const entry = queryCache.get(cacheKey(query));
  if (!entry) return null;
  if (entry.expires < Date.now()) { queryCache.delete(cacheKey(query)); return null; }
  return entry.response;
}

function setCached(query: string, response: ChatResponse): void {
  queryCache.set(cacheKey(query), { response, expires: Date.now() + CACHE_TTL_MS });
  // Evict old entries if cache gets large
  if (queryCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of queryCache) {
      if (v.expires < now) queryCache.delete(k);
    }
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Finance Superbrain — a senior institutional analyst with 20 years of markets experience. You think like a macro hedge fund PM. You are precise, evidence-driven, and never speculate without flagging uncertainty.

Your role is to answer traders' questions with deep, structured analysis backed by a proprietary intelligence layer of historical case studies with real market outcomes (ticker moves in basis points).

When answering:
- Lead with the thesis in one clear sentence
- Back it with 2-4 specific evidence points referencing the actual case data provided
- Cite specific case IDs and their realized market moves when relevant
- State your confidence level: high / medium / low
- List 1-3 risks or invalidation conditions
- Reference the LIVE MARKET SNAPSHOT to anchor your analysis to today's prices and moves
- Reference UPCOMING MACRO EVENTS to flag near-term catalysts that could change the picture
- Never give generic advice — be specific to the cases and data provided

Format your response as valid JSON matching exactly:
{
  "answer": "full analysis paragraph",
  "confidence_level": "high" | "medium" | "low",
  "evidence": ["point 1", "point 2"],
  "risks": ["risk 1", "risk 2"]
}`;

// ─── Event type detection ─────────────────────────────────────────────────────

function detectEventType(query: string): EventType {
  const q = query.toLowerCase();
  if (q.includes("cpi") || q.includes("inflation") || q.includes("consumer price")) return "cpi";
  if (q.includes("fomc") || q.includes("fed") || q.includes("federal reserve") || q.includes("rate decision") || q.includes("powell")) return "fomc";
  if (q.includes("nfp") || q.includes("jobs") || q.includes("payroll") || q.includes("employment") || q.includes("unemployment")) return "nfp";
  if (q.includes("earnings") || q.includes("revenue") || q.includes("eps") || q.includes("guidance") || q.includes("beat") || q.includes("miss")) return "earnings";
  if (q.includes("oil") || q.includes("opec") || q.includes("energy") || q.includes("crude") || q.includes("gas")) return "energy";
  if (q.includes("credit") || q.includes("bank") || q.includes("spread") || q.includes("default") || q.includes("svb") || q.includes("yield curve")) return "credit";
  if (q.includes("fx") || q.includes("currency") || q.includes("dollar") || q.includes("yen") || q.includes("euro") || q.includes("sanctions") || q.includes("tariff")) return "policy_fx";
  return "general";
}

// ─── Case pack routing ────────────────────────────────────────────────────────

function getCasePacks(eventType: EventType): [string, string] {
  switch (eventType) {
    case "cpi":
    case "fomc":
    case "nfp":     return ["macro_calendar_v1", "macro_plus_v1"];
    case "earnings": return ["earnings_v1",        "macro_plus_v1"];
    case "energy":   return ["energy_v1",           "macro_plus_v1"];
    case "credit":   return ["credit_v1",           "macro_plus_v1"];
    case "policy_fx": return ["policy_fx_v1",       "macro_plus_v1"];
    default:         return ["macro_plus_v1",       "macro_calendar_v1"];
  }
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildCaseContext(cases: any[]): string {
  return cases.map((e: any) => {
    const moves = (e.realized_moves ?? [])
      .map((m: any) => `${m.ticker} ${m.realized_direction} ${m.realized_magnitude_bp}bp`)
      .join(", ");
    const themes = (e.labels?.themes ?? []).join(", ");
    const assets = (e.labels?.primary_assets ?? []).join(", ");
    const summary = e.parsed_event?.summary ?? "";
    return [
      `Case: ${e.case_id} [${e.case_pack}]`,
      e.dominant_catalyst ? `  Catalyst: ${e.dominant_catalyst}` : null,
      summary         ? `  Event: ${summary.slice(0, 140)}`         : null,
      moves           ? `  Realized moves: ${moves}`                : null,
      assets          ? `  Primary assets: ${assets}`               : null,
      themes          ? `  Themes: ${themes}`                       : null,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

// ─── Core function ────────────────────────────────────────────────────────────

export async function processChat(
  request: ChatRequest,
  repository: Repository,
  apiKey: string,
): Promise<ChatResponse> {
  // #2 — Daily cap check
  checkDailyLimit();

  const sessionId = request.session_id ?? crypto.randomUUID();

  // #2 — Cache check (return early if identical query seen in last hour)
  const cachedResponse = getCached(request.query);
  if (cachedResponse) {
    return { ...cachedResponse, session_id: sessionId, cached: true };
  }

  const eventType = detectEventType(request.query);
  const [primaryPack, fallbackPack] = getCasePacks(eventType);

  const repo = repository as any;

  let primaryCases: any[] = [];
  let fallbackCases: any[] = [];
  let lessons: any[] = [];
  let predictions: any[] = [];

  // #5 — Fetch live market data and upcoming events in parallel with DB calls
  let marketSnapshot = "";
  let upcomingEventsBriefing = "";

  await Promise.all([
    // DB: primary case pack
    (async () => {
      try {
        primaryCases = (await repo.listHistoricalCaseLibraryItems?.({
          case_pack: primaryPack,
          limit: 30,
        })) ?? [];
      } catch { primaryCases = []; }
    })(),
    // DB: fallback case pack
    (async () => {
      try {
        fallbackCases = (await repo.listHistoricalCaseLibraryItems?.({
          case_pack: fallbackPack,
          limit: 15,
        })) ?? [];
      } catch { fallbackCases = []; }
    })(),
    // DB: lessons
    (async () => {
      try { lessons = (await repo.listLessons?.()) ?? []; }
      catch { lessons = []; }
    })(),
    // DB: learning records
    (async () => {
      try { predictions = (await repo.listLearningRecords?.({ limit: 5 })) ?? []; }
      catch { predictions = []; }
    })(),
    // #5 — Live market snapshot
    (async () => {
      try {
        const tickers = await getLiveMarketSnapshot();
        marketSnapshot = formatMarketSnapshot(tickers);
      } catch { marketSnapshot = ""; }
    })(),
    // #4 — Upcoming events
    (async () => {
      try {
        const events = getUpcomingEvents(14);
        upcomingEventsBriefing = formatUpcomingEvents(events);
      } catch { upcomingEventsBriefing = ""; }
    })(),
  ]);

  // Deduplicate — primary pack takes priority
  const primaryIds    = new Set(primaryCases.map((e: any) => e.case_id));
  const uniqueFallback = fallbackCases.filter((e: any) => !primaryIds.has(e.case_id));
  const allCases      = [...primaryCases, ...uniqueFallback];

  // Build context summary
  const caseContext   = buildCaseContext(allCases);
  const lessonContext = lessons.slice(0, 5)
    .map((l: any) => (l.lesson_summary ?? l.summary ?? "").slice(0, 150))
    .filter(Boolean)
    .map((s: string) => `- ${s}`)
    .join("\n");

  const contextSummary = [
    `INTELLIGENCE LAYER — ${allCases.length} HISTORICAL CASES (query type: ${eventType}, primary pack: ${primaryPack}):`,
    caseContext || "none",
    `\nLESSONS FROM PAST PREDICTIONS (${lessons.length} total):`,
    lessonContext || "none",
    `\nLEARNING RECORDS: ${predictions.length} prediction outcomes on file`,
    marketSnapshot           ? `\n${marketSnapshot}`           : "",
    upcomingEventsBriefing   ? `\n${upcomingEventsBriefing}`   : "",
  ].join("\n");

  // Call Claude
  const client      = new Anthropic({ apiKey });
  const userMessage = `Query: ${request.query}\n\nContext from intelligence layer:\n${contextSummary}\n\nEvent type detected: ${eventType}`;

  const message = await client.messages.create({
    model:      "claude-haiku-4-5",
    max_tokens: 1500,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: userMessage }],
  });

  const rawText = message.content[0]?.type === "text" ? message.content[0].text : "";

  // Parse structured response
  let parsed: {
    answer: string;
    confidence_level: "high" | "medium" | "low";
    evidence: string[];
    risks: string[];
  };

  try {
    // Strip markdown code fences if present
    const clean = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    parsed = JSON.parse(clean) as typeof parsed;
  } catch {
    parsed = {
      answer:           rawText,
      confidence_level: "medium",
      evidence:         [],
      risks:            [],
    };
  }

  const result: ChatResponse = {
    answer:               parsed.answer,
    event_type:           eventType,
    confidence_level:     parsed.confidence_level,
    evidence:             parsed.evidence,
    risks:                parsed.risks,
    analogues_referenced: allCases.length,
    session_id:           sessionId,
    cached:               false,
  };

  // #2 — Cache for 1 hour
  setCached(request.query, result);

  // #6 — Log prediction for accuracy tracking (fire-and-forget)
  void logPrediction({
    session_id:       sessionId,
    query:            request.query,
    event_type:       eventType,
    confidence_level: parsed.confidence_level,
    answer_summary:   parsed.answer.slice(0, 500),
    case_ids_cited:   allCases.map((c: any) => c.case_id as string),
    analogues_count:  allCases.length,
  });

  return result;
}
