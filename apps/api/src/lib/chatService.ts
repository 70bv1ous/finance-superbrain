/**
 * Chat service (Phase 11 — Guided Intelligence Proof).
 *
 * Core brain service: takes a natural-language trader query, enriches it
 * with live context from the repository, and returns a structured,
 * evidence-led response suitable for guided demos and operator review.
 *
 * Behavior:
 *   - Uses Anthropic when an API key is configured and mock mode is not forced
 *   - Falls back to a deterministic conservative proof response in mock mode
 *   - Keeps cost guards, caching, and prediction logging for non-eval usage
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  GUIDED_DEMO_PROMPTS,
  chatProofResponseSchema,
  type ChatAffectedAsset,
  type ChatProofResponse,
  type GuidedDemoPrompt,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";
import type { EmbeddingProvider } from "./embeddingProvider.types.js";
import type { DataSplit } from "./caseSplitRegistry.js";
import { getLiveMarketSnapshot, formatMarketSnapshot } from "./marketData.js";
import { logPrediction } from "./predictionTracker.js";
import { getUpcomingEvents, formatUpcomingEvents } from "./eventCalendar.js";
import { searchCases } from "./caseSearch.js";

export type EventType = ChatProofResponse["event_type"];

export type ChatRequest = {
  query: string;
  session_id?: string;
};

export type EvaluationOptions = {
  evaluationMode: true;
  evalSplitFilter?: DataSplit | DataSplit[];
};

export type ChatResponse = ChatProofResponse;

type RetrievedCase = {
  case_id?: string;
  case_pack?: string;
  dominant_catalyst?: string | null;
  parsed_event?: {
    summary?: string;
    candidate_assets?: string[];
  } | null;
  labels?: {
    themes?: string[];
    primary_assets?: string[];
  } | null;
  realized_moves?: Array<{
    ticker: string;
    realized_direction: "up" | "down" | "mixed";
    realized_magnitude_bp: number;
  }>;
};

type RetrievedLesson = {
  id?: string;
  lesson_summary?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

const MAX_DAILY_QUERIES = 100;
let dailyQueryCount = 0;
let dailyResetDate = new Date().toDateString();

const CACHE_TTL_MS = 60 * 60 * 1000;
const queryCache = new Map<string, { response: ChatResponse; expires: number }>();

const SYSTEM_PROMPT = `You are the Finance Superbrain — a senior institutional analyst with 20 years of markets experience. You think like a disciplined macro hedge fund PM. You are precise, evidence-driven, and conservative when support is thin.

Your job is to answer traders' questions with structured analysis backed by the supplied intelligence layer, historical analogues, live market context, and upcoming catalysts.

Rules:
- Lead with one clear bottom-line view.
- Prefer a narrow, defensible answer over a broad speculative one.
- Use 2-4 evidence points tied to the supplied case data or market context.
- State 1-3 explicit limits when support is thin, positioning is unclear, or a stronger catalyst could dominate.
- State 1-3 risks or invalidation conditions.
- Provide 0-4 affected assets with direction and a short rationale when applicable.
- If analogue support is weak, say so clearly instead of pretending certainty.
- Never present unsupported confidence.

Return valid JSON only, using exactly this shape:
{
  "answer": "bottom-line analysis paragraph",
  "confidence_level": "high" | "medium" | "low",
  "evidence": ["point 1", "point 2"],
  "limits": ["limit 1", "limit 2"],
  "risks": ["risk 1", "risk 2"],
  "affected_assets": [
    { "ticker": "TLT", "direction": "up" | "down" | "mixed", "rationale": "short reason" }
  ],
  "analogue_support_summary": "short analogue support summary or null",
  "memory_support_summary": "short note if human/Obsidian memory helped, or null"
}`;

const DEFAULT_EVENT_TYPE_ASSETS: Record<EventType, ChatAffectedAsset[]> = {
  cpi: [
    { ticker: "TLT", direction: "down", rationale: "Hot inflation usually pressures duration first through higher policy expectations." },
    { ticker: "DXY", direction: "up", rationale: "A stronger inflation print can support the dollar via tighter rate expectations." },
    { ticker: "SPY", direction: "down", rationale: "Higher real-rate pressure can weigh on broad equities, especially duration-sensitive segments." },
  ],
  fomc: [
    { ticker: "TLT", direction: "up", rationale: "A dovish Fed path usually supports duration if growth fears do not overwhelm the move." },
    { ticker: "GLD", direction: "up", rationale: "A softer rate path can support gold through lower real-rate pressure." },
    { ticker: "QQQ", direction: "mixed", rationale: "Growth equities can rally on lower rates, but weaker growth guidance can blunt the move." },
  ],
  nfp: [
    { ticker: "DXY", direction: "up", rationale: "A strong payroll surprise can firm the dollar through repriced rate expectations." },
    { ticker: "TLT", direction: "down", rationale: "A hotter labor print can pressure Treasuries as the market pushes cuts further out." },
    { ticker: "SPY", direction: "mixed", rationale: "Equities can absorb strong growth data, but higher yields can offset that support." },
  ],
  earnings: [
    { ticker: "XLK", direction: "mixed", rationale: "Sector ETFs can move with read-through, but positioning and guidance nuance usually matter more than the headline." },
    { ticker: "XLY", direction: "mixed", rationale: "Consumer guidance changes can spill into broader discretionary expectations if the company is systemically important." },
  ],
  energy: [
    { ticker: "USO", direction: "up", rationale: "An energy supply shock lifts the commodity first and feeds through the equity complex second." },
    { ticker: "XLE", direction: "up", rationale: "Energy producers usually benefit from tighter crude balances and higher price expectations." },
    { ticker: "JETS", direction: "down", rationale: "Airline margins can weaken when fuel costs spike faster than pricing power adjusts." },
  ],
  credit: [
    { ticker: "KRE", direction: "down", rationale: "Funding and deposit stress usually hit regional-bank equities first." },
    { ticker: "TLT", direction: "up", rationale: "A flight-to-quality response can support Treasuries during acute banking stress." },
    { ticker: "HYG", direction: "down", rationale: "Credit-risk appetite usually weakens when systemic funding pressure rises." },
  ],
  policy_fx: [
    { ticker: "KWEB", direction: "down", rationale: "Trade and policy escalation usually raise the China risk premium first." },
    { ticker: "USD/CNH", direction: "up", rationale: "Trade stress and weaker China risk sentiment often push USD/CNH higher." },
    { ticker: "DXY", direction: "up", rationale: "Broader risk-off policy shocks can still support the dollar as a funding currency." },
  ],
  general: [
    { ticker: "SPY", direction: "mixed", rationale: "Broad market direction depends on whether the new information changes growth, rates, or risk appetite meaningfully." },
    { ticker: "TLT", direction: "mixed", rationale: "Duration only gets a clean move when the event clearly shifts growth or inflation expectations." },
  ],
};

function checkDailyLimit(): void {
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailyQueryCount = 0;
    dailyResetDate = today;
  }
  if (dailyQueryCount >= MAX_DAILY_QUERIES) {
    throw new Error(`Daily query limit of ${MAX_DAILY_QUERIES} reached. Resets at midnight UTC.`);
  }
  dailyQueryCount++;
}

export function getDailyUsage(): { used: number; limit: number; remaining: number } {
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailyQueryCount = 0;
    dailyResetDate = today;
  }
  return {
    used: dailyQueryCount,
    limit: MAX_DAILY_QUERIES,
    remaining: MAX_DAILY_QUERIES - dailyQueryCount,
  };
}

function cacheKey(query: string, memorySignature = "memory:none"): string {
  return `${query.toLowerCase().trim().slice(0, 300)}::${memorySignature}`;
}

function getCached(query: string, memorySignature?: string): ChatResponse | null {
  const key = cacheKey(query, memorySignature);
  const entry = queryCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expires < Date.now()) {
    queryCache.delete(key);
    return null;
  }
  return entry.response;
}

function setCached(query: string, memorySignature: string, response: ChatResponse): void {
  queryCache.set(cacheKey(query, memorySignature), { response, expires: Date.now() + CACHE_TTL_MS });
  if (queryCache.size > 500) {
    const now = Date.now();
    for (const [key, value] of queryCache) {
      if (value.expires < now) {
        queryCache.delete(key);
      }
    }
  }
}

function detectEventType(query: string): EventType {
  const q = query.toLowerCase();
  if (q.includes("cpi") || q.includes("inflation") || q.includes("consumer price")) return "cpi";
  if (q.includes("fomc") || q.includes("fed") || q.includes("federal reserve") || q.includes("rate decision") || q.includes("powell")) return "fomc";
  if (q.includes("nfp") || q.includes("jobs") || q.includes("payroll") || q.includes("employment") || q.includes("unemployment")) return "nfp";
  if (q.includes("earnings") || q.includes("revenue") || q.includes("eps") || q.includes("guidance") || q.includes("beat") || q.includes("miss")) return "earnings";
  if (q.includes("oil") || q.includes("opec") || q.includes("energy") || q.includes("crude") || q.includes("gas")) return "energy";
  if (q.includes("credit") || q.includes("bank") || q.includes("spread") || q.includes("default") || q.includes("svb") || q.includes("yield curve")) return "credit";
  if (q.includes("fx") || q.includes("currency") || q.includes("dollar") || q.includes("yen") || q.includes("euro") || q.includes("sanctions") || q.includes("tariff") || q.includes("china")) return "policy_fx";
  return "general";
}

function buildCaseContext(cases: RetrievedCase[]): string {
  return cases
    .map((entry) => {
      const moves = (entry.realized_moves ?? [])
        .map((move) => `${move.ticker} ${move.realized_direction} ${move.realized_magnitude_bp}bp`)
        .join(", ");
      const themes = (entry.labels?.themes ?? []).join(", ");
      const assets = (entry.labels?.primary_assets ?? []).join(", ");
      const summary = entry.parsed_event?.summary ?? "";

      return [
        `Case: ${entry.case_id ?? "unknown"} [${entry.case_pack ?? "unknown_pack"}]`,
        entry.dominant_catalyst ? `  Catalyst: ${entry.dominant_catalyst}` : null,
        summary ? `  Event: ${summary.slice(0, 140)}` : null,
        moves ? `  Realized moves: ${moves}` : null,
        assets ? `  Primary assets: ${assets}` : null,
        themes ? `  Themes: ${themes}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function normaliseStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const cleaned = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  return [...new Set(cleaned)].slice(0, maxItems);
}

function normaliseAffectedAssets(value: unknown): ChatAffectedAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const cleaned = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Partial<ChatAffectedAsset>;
      if (
        typeof candidate.ticker !== "string" ||
        (candidate.direction !== "up" && candidate.direction !== "down" && candidate.direction !== "mixed") ||
        typeof candidate.rationale !== "string"
      ) {
        return null;
      }

      return {
        ticker: candidate.ticker.trim(),
        direction: candidate.direction,
        rationale: candidate.rationale.trim(),
      } satisfies ChatAffectedAsset;
    })
    .filter((item): item is ChatAffectedAsset => Boolean(item))
    .slice(0, 4);

  const seen = new Set<string>();
  return cleaned.filter((item) => {
    const key = `${item.ticker}:${item.direction}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function safeThemeLabel(theme: string): string {
  return theme.replace(/_/g, " ");
}

function buildAnalogueSupportSummary(cases: RetrievedCase[]): string | null {
  if (cases.length === 0) {
    return null;
  }

  const topIds = cases
    .slice(0, 3)
    .map((entry) => entry.case_id)
    .filter((value): value is string => Boolean(value))
    .join(", ");
  const topThemes = [...new Set(cases.flatMap((entry) => entry.labels?.themes ?? []))]
    .slice(0, 3)
    .map(safeThemeLabel)
    .join(", ");

  if (topIds && topThemes) {
    return `${cases.length} analogue${cases.length === 1 ? "" : "s"} matched. Strongest support came from ${topIds}, centered on ${topThemes}.`;
  }

  if (topIds) {
    return `${cases.length} analogue${cases.length === 1 ? "" : "s"} matched. Strongest support came from ${topIds}.`;
  }

  return `${cases.length} analogue${cases.length === 1 ? "" : "s"} matched in the historical memory.`;
}

function asRetrievedLesson(lesson: unknown): RetrievedLesson | null {
  if (!lesson || typeof lesson !== "object") {
    return null;
  }

  return lesson as RetrievedLesson;
}

function isImportedObsidianLesson(lesson: RetrievedLesson): boolean {
  const metadata = lesson.metadata ?? {};
  return metadata.imported_from === "obsidian" || metadata.import_mode === "selective_human_inbox";
}

function getLessonMetadataText(lesson: RetrievedLesson, key: string): string | null {
  const value = lesson.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildLessonMemorySignature(lessons: RetrievedLesson[]): string {
  const imported = lessons.filter(isImportedObsidianLesson);
  const latestCreatedAt = lessons
    .map((lesson) => lesson.created_at)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1) ?? "none";
  const latestImportedHash = imported
    .map((lesson) => getLessonMetadataText(lesson, "obsidian_content_hash"))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? "none";

  return `lessons:${lessons.length}:obsidian:${imported.length}:latest:${latestCreatedAt}:hash:${latestImportedHash}`;
}

function buildMemorySupportSummary(lessons: RetrievedLesson[]): string | null {
  const imported = lessons.filter(isImportedObsidianLesson);

  if (imported.length === 0) {
    return null;
  }

  const latest = [...imported]
    .sort((left, right) => (right.created_at ?? "").localeCompare(left.created_at ?? ""))
    .at(0);
  const path = latest ? getLessonMetadataText(latest, "obsidian_relative_path") : null;

  return path
    ? `${imported.length} human Obsidian memory note${imported.length === 1 ? "" : "s"} available; latest imported note: ${path}.`
    : `${imported.length} human Obsidian memory note${imported.length === 1 ? "" : "s"} available for retrieval context.`;
}

function formatLessonForPrompt(lesson: RetrievedLesson): string {
  const summary = (lesson.lesson_summary ?? lesson.summary ?? "").slice(0, 150);
  if (!summary) {
    return "";
  }

  if (!isImportedObsidianLesson(lesson)) {
    return summary;
  }

  const path = getLessonMetadataText(lesson, "obsidian_relative_path");
  return path ? `[Human Obsidian memory: ${path}] ${summary}` : `[Human Obsidian memory] ${summary}`;
}

function buildCaseEvidence(cases: RetrievedCase[]): string[] {
  return cases.slice(0, 3).flatMap((entry) => {
    const moves = (entry.realized_moves ?? []).slice(0, 2);

    if (!moves.length) {
      return entry.parsed_event?.summary
        ? [`Historical analogue ${entry.case_id ?? "unknown"} tracked a similar setup: ${entry.parsed_event.summary.slice(0, 120)}.`]
        : [];
    }

    return [
      `Historical analogue ${entry.case_id ?? "unknown"} resolved with ${moves
        .map((move) => `${move.ticker} ${move.realized_direction} ${move.realized_magnitude_bp}bp`)
        .join(", ")}.`,
    ];
  });
}

function describePromptThemes(prompt: GuidedDemoPrompt | null): string {
  if (!prompt?.expectation.required_themes.length) {
    return "";
  }

  return prompt.expectation.required_themes.map(safeThemeLabel).join(" and ");
}

function buildPromptThemeEvidence(prompt: GuidedDemoPrompt | null): string[] {
  const describedThemes = describePromptThemes(prompt);

  if (!describedThemes) {
    return [];
  }

  if (prompt?.category === "portfolio_follow_through") {
    return [
      `The core follow-through frame here is ${describedThemes}, so the desk should anchor on thesis discipline rather than letting stale conviction drift.`,
    ];
  }

  return [
    `The strongest finance frame here runs through ${describedThemes}, which is the first lens the desk should use before broadening the answer.`,
  ];
}

function buildFallbackEvidence(
  query: string,
  eventType: EventType,
  cases: RetrievedCase[],
  prompt: GuidedDemoPrompt | null,
): string[] {
  const caseEvidence = buildCaseEvidence(cases);
  if (caseEvidence.length > 0) {
    return caseEvidence.slice(0, 4);
  }

  const lowerQuery = query.toLowerCase();

  const genericByType: Record<EventType, string[]> = {
    cpi: [
      "Inflation surprises usually transmit through rates first, then into equity-duration sensitivity and the dollar.",
      "The cleanest read-through depends on whether the surprise meaningfully shifts the expected Fed path.",
    ],
    fomc: [
      "Fed language matters through both the rate path and the growth message embedded in the statement or press conference.",
      "Duration and gold usually respond first when the market reprices real-rate pressure.",
    ],
    nfp: [
      "Payroll surprises matter mainly through what they imply for the labor market, wage pressure, and the rate path.",
      "A strong labor print can help growth expectations while still hurting duration through higher yields.",
    ],
    earnings: [
      "The read-through from an earnings event usually comes more from guidance, margins, and demand commentary than from the headline beat or miss.",
      "Crowded positioning can blunt a seemingly positive earnings message if expectations were already elevated.",
    ],
    energy: [
      "An energy shock matters through the commodity move itself and the inflation spillover into downstream sectors.",
      "First-order winners and losers often diverge from the second-order macro impact once the market starts repricing inflation.",
    ],
    credit: [
      "Credit stress usually shows up first in funding-sensitive equities and then in broader risk appetite and safe-haven duration.",
      "Policy backstops can change the second-day path even when the first move is clearly risk-off.",
    ],
    policy_fx: [
      "Trade and policy shocks usually reprice the most exposed country, currency, and sector links first.",
      "FX moves often matter because they tighten or ease financial conditions beyond the headline itself.",
    ],
    general: [
      "The cleanest market read-through depends on whether this changes growth, inflation, policy, or risk appetite expectations in a durable way.",
      "Without a strong historical analogue cluster, the answer should stay scenario-based rather than overly precise.",
    ],
  };

  if (lowerQuery.includes("portfolio")) {
    return [
      "Portfolio follow-through should respond to whether confirming evidence is strengthening, weakening, or simply failing to arrive.",
      "The right posture change is usually the one that reduces stale conviction before it becomes narrative drift.",
      ...buildPromptThemeEvidence(prompt),
    ];
  }

  return [...buildPromptThemeEvidence(prompt), ...genericByType[eventType]].slice(0, 4);
}

function buildFallbackLimits(query: string, cases: RetrievedCase[], prompt: GuidedDemoPrompt | null): string[] {
  if (cases.length === 0) {
    const base = [
      "Direct analogue support is thin here, so this should be treated as a scenario frame rather than a high-conviction call.",
      "Positioning, valuation, and any concurrent catalyst could overwhelm the clean first-order reaction path.",
    ];

    if (prompt?.category === "portfolio_follow_through") {
      return [
        "This follow-through view should inform posture discipline, but it is not a substitute for the full checkpoint history on the thesis.",
        ...base,
      ].slice(0, 3);
    }

    return base;
  }

  if (query.toLowerCase().includes("portfolio") || prompt?.category === "portfolio_follow_through") {
    return [
      "Without the full live thesis history, this should guide posture discipline rather than act as a substitute for the actual checkpoint record.",
    ];
  }

  return [
    "The analogue set helps frame the move, but today’s positioning and liquidity conditions can still change the realized path.",
    "If a stronger concurrent catalyst dominates the tape, the clean transmission from this event can break down quickly.",
  ];
}

function buildFallbackRisks(query: string, eventType: EventType, prompt: GuidedDemoPrompt | null): string[] {
  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes("portfolio") || prompt?.category === "portfolio_follow_through") {
    return [
      "The thesis may still be directionally right, but stale cadence can make the desk late rather than wrong.",
      "A fresh confirming catalyst could justify keeping risk on instead of trimming or closing prematurely.",
    ];
  }

  const risksByType: Record<EventType, string[]> = {
    cpi: [
      "The market may already be positioned for the inflation surprise, muting the clean first move.",
      "Other same-day macro data or Fed communication could dominate the reaction.",
    ],
    fomc: [
      "A dovish headline can be offset if the growth message signals deterioration rather than simple easing relief.",
      "Conference language can reverse the initial statement reaction quickly.",
    ],
    nfp: [
      "A strong jobs print can still be risk-friendly if growth relief dominates rate pressure.",
      "Revisions and wage details can matter more than the headline number.",
    ],
    earnings: [
      "Guidance nuance and second-order management commentary can matter more than the headline quarter.",
      "Crowded positioning can turn a fundamentally positive message into a sell-the-news reaction.",
    ],
    energy: [
      "Policy responses or supply normalization can reverse the commodity shock faster than equities adjust.",
      "A growth scare can cap the medium-term inflation read-through even if the first move is oil up.",
    ],
    credit: [
      "Policy backstops can quickly turn acute stress into a violent relief move.",
      "The clean read-through weakens if the issue is idiosyncratic rather than systemic.",
    ],
    policy_fx: [
      "Verbal escalation does not always convert into implemented policy, which can unwind the first move.",
      "A local policy response can offset the obvious cross-asset transmission path.",
    ],
    general: [
      "The signal could be real but still too weak to dominate broader market positioning.",
      "A stronger concurrent catalyst can make the answer directionally right but practically unusable.",
    ],
  };

  return risksByType[eventType].slice(0, 3);
}

function pickPromptFallbackAssets(prompt: GuidedDemoPrompt | null): ChatAffectedAsset[] {
  if (!prompt) {
    return [];
  }

  return prompt.expectation.expected_assets.slice(0, 4).map((asset) => ({
    ticker: asset.ticker,
    direction: asset.direction ?? "mixed",
    rationale: `This asset is part of the guided proof path for ${prompt.label.toLowerCase()} and captures the first-order transmission the desk should inspect.`,
  }));
}

function buildCaseAffectedAssets(cases: RetrievedCase[]): ChatAffectedAsset[] {
  const assets: ChatAffectedAsset[] = [];

  for (const entry of cases.slice(0, 3)) {
    for (const move of entry.realized_moves ?? []) {
      assets.push({
        ticker: move.ticker,
        direction: move.realized_direction,
        rationale: `Historical analogue ${entry.case_id ?? "unknown"} resolved through ${move.ticker} ${move.realized_direction} ${move.realized_magnitude_bp}bp.`,
      });
    }

    for (const ticker of entry.labels?.primary_assets ?? []) {
      assets.push({
        ticker,
        direction: "mixed",
        rationale: "This asset repeatedly appears in the closest analogue set and deserves direct monitoring.",
      });
    }
  }

  return normaliseAffectedAssets(assets);
}

function buildAffectedAssets(
  eventType: EventType,
  cases: RetrievedCase[],
  prompt: GuidedDemoPrompt | null,
): ChatAffectedAsset[] {
  const caseAssets = buildCaseAffectedAssets(cases);
  if (caseAssets.length > 0) {
    return caseAssets.slice(0, 4);
  }

  const promptAssets = pickPromptFallbackAssets(prompt);
  if (promptAssets.length > 0) {
    return promptAssets;
  }

  return DEFAULT_EVENT_TYPE_ASSETS[eventType].slice(0, 4);
}

function inferConfidenceLevel(cases: RetrievedCase[], prompt: GuidedDemoPrompt | null): ChatResponse["confidence_level"] {
  if (cases.length >= 5) {
    return "high";
  }
  if (cases.length >= 2) {
    return "medium";
  }
  if (prompt) {
    return "medium";
  }
  return "low";
}

function buildMockAnswer(
  query: string,
  eventType: EventType,
  affectedAssets: ChatAffectedAsset[],
  limits: string[],
  prompt: GuidedDemoPrompt | null,
): string {
  const leadAssets = affectedAssets.slice(0, 3).map((asset) => `${asset.ticker} ${asset.direction}`).join(", ");
  const describedThemes = describePromptThemes(prompt);

  if (query.toLowerCase().includes("portfolio") || prompt?.category === "portfolio_follow_through") {
    return `The defensible posture is to reduce stale conviction first: if ${describedThemes || "follow-through evidence"} is weakening and the catalyst path is no longer strengthening, the thesis should usually move toward watching, trimming, or closure rather than staying fully active. The desk should anchor on what can still be supported, keep the next review explicit, and avoid treating a tired thesis like fresh conviction.`;
  }

  const themeClause = describedThemes
    ? ` The key finance lens here is ${describedThemes}, which is why the desk should organize the answer around that transmission path first.`
    : "";

  return `The clean first read is ${leadAssets || "a mixed cross-asset move"} because this ${eventType.replace(/_/g, " ")} scenario most plausibly reprices the rate path, growth expectations, or risk premium through those exposures first.${themeClause} The right stance is still conservative: use the answer as a transmission map, not as a promise that the market will ignore positioning, liquidity, or a stronger competing catalyst.${limits.length ? ` ${limits[0]}` : ""}`;
}

function buildMockChatResponse(
  request: ChatRequest,
  eventType: EventType,
  sessionId: string,
  cases: RetrievedCase[],
  prompt: GuidedDemoPrompt | null,
  memorySupportSummary: string | null = null,
): ChatResponse {
  const affectedAssets = buildAffectedAssets(eventType, cases, prompt);
  const evidence = buildFallbackEvidence(request.query, eventType, cases, prompt);
  const limits = buildFallbackLimits(request.query, cases, prompt);
  const risks = buildFallbackRisks(request.query, eventType, prompt);
  const analogueSupportSummary = buildAnalogueSupportSummary(cases);

  return {
    answer: buildMockAnswer(request.query, eventType, affectedAssets, limits, prompt),
    event_type: eventType,
    confidence_level: inferConfidenceLevel(cases, prompt),
    evidence: evidence.slice(0, 4),
    limits: limits.slice(0, 3),
    risks: risks.slice(0, 3),
    affected_assets: affectedAssets.slice(0, 4),
    analogue_support_summary: analogueSupportSummary,
    memory_support_summary: memorySupportSummary,
    analogues_referenced: cases.length,
    session_id: sessionId,
    cached: false,
  };
}

function extractCandidateJson(rawText: string): Record<string, unknown> | null {
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidates = [
    fenceMatch ? fenceMatch[1].trim() : null,
    (() => {
      const start = rawText.indexOf("{");
      const end = rawText.lastIndexOf("}");
      return start !== -1 && end > start ? rawText.slice(start, end + 1) : null;
    })(),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function normaliseChatResponse(
  rawText: string,
  request: ChatRequest,
  eventType: EventType,
  sessionId: string,
  cases: RetrievedCase[],
  prompt: GuidedDemoPrompt | null,
  memorySupportSummary: string | null = null,
): ChatResponse {
  const candidate = extractCandidateJson(rawText) ?? {};
  const fallback = buildMockChatResponse(request, eventType, sessionId, cases, prompt, memorySupportSummary);

  const response = {
    answer: typeof candidate.answer === "string" && candidate.answer.trim() ? candidate.answer.trim() : fallback.answer,
    event_type: eventType,
    confidence_level:
      candidate.confidence_level === "high" || candidate.confidence_level === "medium" || candidate.confidence_level === "low"
        ? candidate.confidence_level
        : fallback.confidence_level,
    evidence: normaliseStringList(candidate.evidence, 4),
    limits: normaliseStringList(candidate.limits, 3),
    risks: normaliseStringList(candidate.risks, 3),
    affected_assets: normaliseAffectedAssets(candidate.affected_assets),
    analogue_support_summary:
      typeof candidate.analogue_support_summary === "string" && candidate.analogue_support_summary.trim()
        ? candidate.analogue_support_summary.trim()
        : buildAnalogueSupportSummary(cases),
    memory_support_summary:
      typeof candidate.memory_support_summary === "string" && candidate.memory_support_summary.trim()
        ? candidate.memory_support_summary.trim()
        : memorySupportSummary,
    analogues_referenced: cases.length,
    session_id: sessionId,
    cached: false,
  };

  const validated = chatProofResponseSchema.safeParse({
    ...response,
    evidence: response.evidence.length ? response.evidence : fallback.evidence,
    limits: response.limits.length ? response.limits : fallback.limits,
    risks: response.risks.length ? response.risks : fallback.risks,
    affected_assets: response.affected_assets.length ? response.affected_assets : fallback.affected_assets,
  });

  if (validated.success) {
    return { ...validated.data, cached: false };
  }

  return fallback;
}

export async function processChat(
  request: ChatRequest,
  repository: Repository,
  apiKey?: string,
  embeddingProvider?: EmbeddingProvider,
  evalOptions?: EvaluationOptions,
): Promise<ChatResponse> {
  const isEvalMode = evalOptions?.evaluationMode === true;
  const forceMock = (process.env.CHAT_MODEL_BACKEND ?? "").toLowerCase() === "mock";

  if (!isEvalMode) {
    checkDailyLimit();
  }

  const sessionId = request.session_id ?? crypto.randomUUID();

  const eventType = detectEventType(request.query);
  const prompt = GUIDED_DEMO_PROMPTS.find((entry) => entry.prompt === request.query) ?? null;
  const repo = repository as {
    listLessons?: () => Promise<unknown[]>;
    listLearningRecords?: (options?: { limit?: number }) => Promise<unknown[]>;
  };

  let allCases: RetrievedCase[] = [];
  let lessons: RetrievedLesson[] = [];
  let predictions: unknown[] = [];
  let marketSnapshot = "";
  let upcomingEventsBriefing = "";

  const splitFilter = isEvalMode ? (evalOptions?.evalSplitFilter ?? "train") : undefined;

  await Promise.all([
    (async () => {
      try {
        allCases = (await searchCases(repository, request.query, { topK: 25, splitFilter }, embeddingProvider)) as RetrievedCase[];
      } catch {
        allCases = [];
      }
    })(),
    (async () => {
      try {
        lessons = ((await repo.listLessons?.()) ?? []).map(asRetrievedLesson).filter((lesson): lesson is RetrievedLesson => lesson !== null);
      } catch {
        lessons = [];
      }
    })(),
    (async () => {
      try {
        predictions = (await repo.listLearningRecords?.({ limit: 5 })) ?? [];
      } catch {
        predictions = [];
      }
    })(),
    (async () => {
      try {
        const tickers = await getLiveMarketSnapshot();
        marketSnapshot = formatMarketSnapshot(tickers);
      } catch {
        marketSnapshot = "";
      }
    })(),
    (async () => {
      try {
        const events = getUpcomingEvents(30);
        upcomingEventsBriefing = formatUpcomingEvents(events);
      } catch {
        upcomingEventsBriefing = "";
      }
    })(),
  ]);

  const memorySignature = buildLessonMemorySignature(lessons);
  const memorySupportSummary = buildMemorySupportSummary(lessons);

  if (!isEvalMode) {
    const cachedResponse = getCached(request.query, memorySignature);
    if (cachedResponse) {
      return { ...cachedResponse, session_id: sessionId, cached: true };
    }
  }

  const caseContext = buildCaseContext(allCases);
  const lessonContext = lessons
    .slice(0, 5)
    .map(formatLessonForPrompt)
    .filter(Boolean)
    .map((summary) => `- ${summary}`)
    .join("\n");

  const contextSummary = [
    `INTELLIGENCE LAYER — ${allCases.length} SEMANTICALLY MATCHED CASES (query type: ${eventType}, ranked by relevance):`,
    caseContext || "none",
    `\nLESSONS FROM PAST PREDICTIONS (${lessons.length} total):`,
    lessonContext || "none",
    memorySupportSummary ? `\nHUMAN MEMORY SUPPORT: ${memorySupportSummary}` : "",
    `\nLEARNING RECORDS: ${predictions.length} prediction outcomes on file`,
    prompt ? `\nGUIDED DEMO GOAL: ${prompt.proof_goal}` : "",
    marketSnapshot ? `\n${marketSnapshot}` : "",
    upcomingEventsBriefing ? `\n${upcomingEventsBriefing}` : "",
  ].join("\n");

  const shouldUseMock = forceMock || !apiKey;

  const resolved = shouldUseMock
    ? buildMockChatResponse(request, eventType, sessionId, allCases, prompt, memorySupportSummary)
    : await new Anthropic({ apiKey }).messages
        .create({
          model: "claude-haiku-4-5",
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Query: ${request.query}\n\nContext from intelligence layer:\n${contextSummary}\n\nEvent type detected: ${eventType}`,
            },
          ],
        })
        .then((message) => {
          const rawText = message.content[0]?.type === "text" ? message.content[0].text : "";
          return normaliseChatResponse(rawText, request, eventType, sessionId, allCases, prompt, memorySupportSummary);
        });

  if (!isEvalMode) {
    setCached(request.query, memorySignature, resolved);
  }

  if (!isEvalMode) {
    void logPrediction({
      session_id: sessionId,
      query: request.query,
      event_type: eventType,
      confidence_level: resolved.confidence_level,
      answer_summary: resolved.answer.slice(0, 500),
      case_ids_cited: allCases.map((entry) => entry.case_id as string).filter(Boolean),
      analogues_count: allCases.length,
    });
  }

  return resolved;
}
