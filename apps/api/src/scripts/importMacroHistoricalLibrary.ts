import { macroHistoricalIngestionRequestSchema } from "@finance-superbrain/schemas";

import { MACRO_HISTORICAL_LOADER_CASES } from "../data/macroHistoricalLoaderCases.js";
import { ingestMacroHistoricalCases } from "../lib/macroHistoricalLoader.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();

const casePack = process.env.MACRO_LIBRARY_CASE_PACK?.trim() || "macro_calendar_v1";
const storeLibrary = (process.env.MACRO_LIBRARY_STORE ?? "true").toLowerCase() !== "false";
const ingestReviewedMemory =
  (process.env.MACRO_LIBRARY_INGEST_REVIEWED_MEMORY ?? "true").toLowerCase() !== "false";
const fallbackModelVersion =
  process.env.MACRO_LIBRARY_FALLBACK_MODEL_VERSION?.trim() || "macro-loader-v1";
const labelingMode =
  (process.env.MACRO_LIBRARY_LABELING_MODE?.trim() || "merge") as
    | "merge"
    | "manual_only"
    | "inferred_only";

try {
  const request = macroHistoricalIngestionRequestSchema.parse({
    items: MACRO_HISTORICAL_LOADER_CASES.filter((item) => item.case_pack === casePack),
    store_library: storeLibrary,
    ingest_reviewed_memory: ingestReviewedMemory,
    fallback_model_version: fallbackModelVersion,
    labeling_mode: labelingMode,
  });
  const result = await ingestMacroHistoricalCases(services, request);

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
