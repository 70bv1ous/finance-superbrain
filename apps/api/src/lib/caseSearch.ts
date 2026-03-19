/**
 * Semantic search over the historical_case_library.
 *
 * Phase 9A upgrade: accepts an optional EmbeddingProvider.
 *
 * When a real provider (e.g. VoyageEmbeddingProvider) is supplied:
 *   - All cases are batch-embedded once per cache window (5 min) using the
 *     finance-tuned voyage-finance-2 model.
 *   - The query is embedded at search time.
 *   - Cosine similarity is computed in-memory — no DB migration needed.
 *
 * When no provider is supplied (or the provider fails):
 *   - Falls back to the original 192-dim FNV-1a hash-vector approach.
 *
 * Scoring:
 *   Real embeddings:   100% cosine similarity (neural vectors capture meaning)
 *   Hash fallback:     70% semantic + 30% lexical
 */

import { buildSemanticVector, cosineSimilarity, tokenize } from "./semanticRetrieval.js";
import type { EmbeddingProvider } from "./embeddingProvider.types.js";
import type { Repository } from "./repository.types.js";

// ─── Text representation ──────────────────────────────────────────────────────

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

// ─── Lexical scorer (hash-vector fallback only) ───────────────────────────────

function lexicalScore(query: string, caseText: string): number {
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;
  const cTokens = new Set(tokenize(caseText));
  const hits = qTokens.filter((t) => cTokens.has(t)).length;
  return hits / qTokens.length;
}

// ─── In-process cache ─────────────────────────────────────────────────────────

let caseCache:       any[]                    | null = null;
let caseVectors:     Map<string, number[]>    | null = null; // case_id → embedding
let cacheTimestamp   = 0;
const CACHE_TTL_MS   = 5 * 60 * 1000; // 5 minutes

/** Invalidate cache (call after ingesting new cases). */
export function invalidateCaseCache(): void {
  caseCache    = null;
  caseVectors  = null;
  cacheTimestamp = 0;
}

// ─── Batch embed helper ───────────────────────────────────────────────────────

async function batchEmbed(
  provider: EmbeddingProvider,
  texts: string[],
): Promise<number[][]> {
  // VoyageEmbeddingProvider has embedBatch; fall back to serial embedText
  const p = provider as any;
  if (typeof p.embedBatch === "function") {
    // Voyage supports 128 inputs per call — chunk if needed
    const results: number[][] = [];
    const CHUNK = 128;
    for (let i = 0; i < texts.length; i += CHUNK) {
      const chunk = texts.slice(i, i + CHUNK);
      const vecs  = (await p.embedBatch(chunk)) as number[][];
      results.push(...vecs);
    }
    return results;
  }
  // Serial fallback
  return Promise.all(texts.map((t) => provider.embedText(t)));
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
 * Pass an EmbeddingProvider for neural embeddings (Phase 9A); omit for hash-vector fallback.
 */
export async function searchCases(
  repository: Repository,
  query: string,
  options: CaseSearchOptions = {},
  embeddingProvider?: EmbeddingProvider,
): Promise<any[]> {
  const { topK = 20, minScore = 0.04 } = options;

  // ── Warm or use cache ──────────────────────────────────────────────────────
  const now = Date.now();
  const cacheStale = !caseCache || now - cacheTimestamp > CACHE_TTL_MS;

  if (cacheStale) {
    try {
      const repo = repository as any;
      caseCache  = (await repo.listHistoricalCaseLibraryItems?.({ limit: 500 })) ?? [];
    } catch {
      caseCache = [];
    }
    caseVectors    = null; // invalidate vector cache when data changes
    cacheTimestamp = Date.now();
  }

  if (caseCache!.length === 0) return [];

  // ── Try neural embeddings ──────────────────────────────────────────────────
  if (embeddingProvider) {
    try {
      // Build case vectors if not yet cached
      if (!caseVectors) {
        const texts = caseCache!.map(buildCaseText);
        const vecs  = await batchEmbed(embeddingProvider, texts);
        caseVectors = new Map(
          caseCache!.map((item, i) => [item.case_id as string, vecs[i]!]),
        );
      }

      // Embed the query
      const queryVec = await embeddingProvider.embedText(query);

      // Score by cosine similarity
      const scored = caseCache!.map((item) => {
        const caseVec = caseVectors!.get(item.case_id as string);
        const score   = caseVec ? cosineSimilarity(queryVec, caseVec) : 0;
        return { item, score };
      });

      return scored
        .filter(({ score }) => score > minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(({ item }) => item);

    } catch (err) {
      // Provider failed — fall through to hash-vector approach
      console.warn("[caseSearch] Neural embedding failed, using hash fallback:", (err as Error).message);
      caseVectors = null; // reset so next call retries
    }
  }

  // ── Hash-vector fallback ───────────────────────────────────────────────────
  const queryVector = buildSemanticVector(query);

  const scored = caseCache!.map((item) => {
    const caseText = buildCaseText(item);
    const semantic  = cosineSimilarity(queryVector, buildSemanticVector(caseText));
    const lexical   = lexicalScore(query, caseText);
    const score     = semantic * 0.7 + lexical * 0.3;
    return { item, score };
  });

  return scored
    .filter(({ score }) => score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ item }) => item);
}
