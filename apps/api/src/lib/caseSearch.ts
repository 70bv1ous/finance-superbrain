/**
 * Semantic search over the historical_case_library.
 *
 * Uses the same hash-based vector encoding + cosine similarity already used
 * in lessonSearch.ts — no new dependencies, no external API, no DB migration.
 *
 * Scoring:
 *   70% semantic (192-dim FNV-1a hash vectors with bigrams)
 *   30% lexical  (token overlap ratio)
 *
 * Results are cached in-memory for 5 minutes to avoid a full-table fetch on
 * every chat request.
 */

import { buildSemanticVector, cosineSimilarity, tokenize } from "./semanticRetrieval.js";
import type { Repository } from "./repository.types.js";

// ─── Text representation ──────────────────────────────────────────────────────

/**
 * Build a rich text blob for a case that captures every signal the query
 * might match against:
 *   - case_id tokens  (e.g. "macro-cpi-hot-jun-2022" → "macro cpi hot jun 2022")
 *   - dominant_catalyst
 *   - parsed_event.summary
 *   - labels.themes
 *   - labels.primary_assets
 *   - case_pack name
 *   - realized move tickers + direction (e.g. "SPY down TLT up")
 */
function buildCaseText(item: any): string {
  const moves = (item.realized_moves ?? [])
    .map((m: any) => [m.ticker, m.realized_direction].filter(Boolean).join(" "))
    .join(" ");

  return [
    item.case_id?.replace(/[-_]/g, " ") ?? "",
    item.dominant_catalyst ?? "",
    item.parsed_event?.summary ?? "",
    (item.labels?.themes ?? []).join(" "),
    (item.labels?.primary_assets ?? []).join(" "),
    item.case_pack?.replace(/[-_]/g, " ") ?? "",
    moves,
  ]
    .filter(Boolean)
    .join(" ");
}

// ─── Lexical scorer ───────────────────────────────────────────────────────────

function lexicalScore(query: string, caseText: string): number {
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;
  const cTokens = new Set(tokenize(caseText));
  const hits = qTokens.filter((t) => cTokens.has(t)).length;
  return hits / qTokens.length;
}

// ─── In-process cache ─────────────────────────────────────────────────────────

let caseCache: any[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Invalidate cache (call after ingesting new cases). */
export function invalidateCaseCache(): void {
  caseCache = null;
  cacheTimestamp = 0;
}

// ─── Main search function ─────────────────────────────────────────────────────

export type CaseSearchOptions = {
  /** Maximum number of results to return. Default: 20 */
  topK?: number;
  /** Minimum combined score threshold (0–1). Default: 0.04 */
  minScore?: number;
};

/**
 * Semantic search across ALL historical cases.
 * Returns the topK most relevant cases for the given query.
 */
export async function searchCases(
  repository: Repository,
  query: string,
  options: CaseSearchOptions = {},
): Promise<any[]> {
  const { topK = 20, minScore = 0.04 } = options;

  // ── Warm or use cache ──────────────────────────────────────────────────────
  const now = Date.now();
  if (!caseCache || now - cacheTimestamp > CACHE_TTL_MS) {
    try {
      const repo = repository as any;
      caseCache = (await repo.listHistoricalCaseLibraryItems?.({ limit: 500 })) ?? [];
    } catch {
      caseCache = [];
    }
    cacheTimestamp = Date.now();
  }

  if (caseCache.length === 0) return [];

  // ── Score every case ───────────────────────────────────────────────────────
  const queryVector = buildSemanticVector(query);

  const scored = caseCache.map((item) => {
    const caseText = buildCaseText(item);
    const semantic  = cosineSimilarity(queryVector, buildSemanticVector(caseText));
    const lexical   = lexicalScore(query, caseText);
    const score     = semantic * 0.7 + lexical * 0.3;
    return { item, score };
  });

  // ── Sort, filter, return ───────────────────────────────────────────────────
  return scored
    .filter(({ score }) => score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ item }) => item);
}
