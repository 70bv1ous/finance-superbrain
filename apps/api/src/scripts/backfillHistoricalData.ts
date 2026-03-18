import { buildHistoricalLibraryDrafts } from "../data/historicalBackfillCases.js";
import { ingestHistoricalCaseLibrary } from "../lib/historicalCaseLibrary.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();

try {
  const result = await ingestHistoricalCaseLibrary(services, {
    items: buildHistoricalLibraryDrafts("macro_plus_v1"),
    store_library: true,
    ingest_reviewed_memory: true,
    fallback_model_version: "historical-backfill-v1",
    labeling_mode: "merge",
  });

  console.log(
    JSON.stringify(
      {
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
