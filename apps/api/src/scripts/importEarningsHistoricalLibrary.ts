import { earningsHistoricalIngestionRequestSchema } from "@finance-superbrain/schemas";

import { EARNINGS_HISTORICAL_LOADER_CASES } from "../data/earningsHistoricalLoaderCases.js";
import { ingestEarningsHistoricalCases } from "../lib/earningsHistoricalLoader.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();

const casePack = process.env.EARNINGS_LIBRARY_CASE_PACK?.trim() || "earnings_v1";
const storeLibrary = (process.env.EARNINGS_LIBRARY_STORE ?? "true").toLowerCase() !== "false";
const ingestReviewedMemory =
  (process.env.EARNINGS_LIBRARY_INGEST_REVIEWED_MEMORY ?? "true").toLowerCase() !== "false";
const fallbackModelVersion =
  process.env.EARNINGS_LIBRARY_FALLBACK_MODEL_VERSION?.trim() || "earnings-loader-v1";
const labelingMode =
  (process.env.EARNINGS_LIBRARY_LABELING_MODE?.trim() || "merge") as
    | "merge"
    | "manual_only"
    | "inferred_only";

try {
  const request = earningsHistoricalIngestionRequestSchema.parse({
    items: EARNINGS_HISTORICAL_LOADER_CASES.filter((item) => item.case_pack === casePack),
    store_library: storeLibrary,
    ingest_reviewed_memory: ingestReviewedMemory,
    fallback_model_version: fallbackModelVersion,
    labeling_mode: labelingMode,
  });
  const result = await ingestEarningsHistoricalCases(services, request);

  console.log(
    JSON.stringify(
      {
        case_pack: casePack,
        ingested_cases: result.ingested_cases,
        stored_library_items: result.stored_library_items,
        reviewed_ingests: result.reviewed_ingests,
      },
      null,
      2,
    ),
  );
} finally {
  await services.marketDataProvider.close?.();
  await services.embeddingProvider.close?.();
  await services.repository.close?.();
}
