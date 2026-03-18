import { historicalCaseLibraryIngestionModeSchema } from "@finance-superbrain/schemas";

import { buildHistoricalLibraryDrafts } from "../data/historicalBackfillCases.js";
import { ingestHistoricalCaseLibrary } from "../lib/historicalCaseLibrary.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();
const casePack = process.env.HISTORICAL_LIBRARY_CASE_PACK?.trim() || "macro_plus_v1";
const storeLibrary = (process.env.HISTORICAL_LIBRARY_STORE ?? "true").toLowerCase() !== "false";
const ingestReviewedMemory =
  (process.env.HISTORICAL_LIBRARY_INGEST_REVIEWED_MEMORY ?? "true").toLowerCase() !== "false";
const fallbackModelVersion =
  process.env.HISTORICAL_LIBRARY_FALLBACK_MODEL_VERSION?.trim() || "historical-library-v1";
const labelingMode = historicalCaseLibraryIngestionModeSchema.parse(
  process.env.HISTORICAL_LIBRARY_LABELING_MODE?.trim() || "merge",
);

try {
  const result = await ingestHistoricalCaseLibrary(services, {
    items: buildHistoricalLibraryDrafts(casePack),
    store_library: storeLibrary,
    ingest_reviewed_memory: ingestReviewedMemory,
    fallback_model_version: fallbackModelVersion,
    labeling_mode: labelingMode,
  });

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
