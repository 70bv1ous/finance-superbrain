import { volatilityHistoricalIngestionRequestSchema } from "@finance-superbrain/schemas";
import type { VolatilityHistoricalCaseInput } from "@finance-superbrain/schemas";

import { VOLATILITY_HISTORICAL_LOADER_CASES } from "../data/volatilityHistoricalLoaderCases.js";
import { ingestVolatilityHistoricalCases } from "../lib/volatilityHistoricalLoader.js";
import { buildServices } from "../lib/services.js";

/** Truncate a string to maxLen chars at the nearest word boundary. */
function truncateHint(s: string, maxLen = 238): string {
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function fixHints(cases: VolatilityHistoricalCaseInput[]) {
  return cases.map((c) => ({
    ...c,
    review_hints: (c.review_hints ?? []).map((h) => truncateHint(h)),
  }));
}

const services = buildServices();

const casePack             = process.env.VOLATILITY_LIBRARY_CASE_PACK?.trim() || "volatility_v1";
const storeLibrary         = (process.env.VOLATILITY_LIBRARY_STORE ?? "true").toLowerCase() !== "false";
const ingestReviewedMemory = (process.env.VOLATILITY_LIBRARY_INGEST_REVIEWED_MEMORY ?? "true").toLowerCase() !== "false";
const fallbackModelVersion = process.env.VOLATILITY_LIBRARY_FALLBACK_MODEL_VERSION?.trim() || "volatility-loader-v1";
const labelingMode         = (process.env.VOLATILITY_LIBRARY_LABELING_MODE?.trim() || "merge") as "merge" | "manual_only" | "inferred_only";

try {
  const rawItems = VOLATILITY_HISTORICAL_LOADER_CASES.filter((item) => item.case_pack === casePack);
  const request = volatilityHistoricalIngestionRequestSchema.parse({
    items:                  fixHints(rawItems),
    store_library:          storeLibrary,
    ingest_reviewed_memory: ingestReviewedMemory,
    fallback_model_version: fallbackModelVersion,
    labeling_mode:          labelingMode,
  });
  const result = await ingestVolatilityHistoricalCases(services, request);

  console.log(JSON.stringify({
    case_pack:             casePack,
    ingested_cases:        result.ingested_cases,
    stored_library_items:  result.stored_library_items,
    reviewed_ingests:      result.reviewed_ingests,
  }, null, 2));
} finally {
  await services.marketDataProvider.close?.();
  await services.embeddingProvider.close?.();
  await services.repository.close?.();
}
