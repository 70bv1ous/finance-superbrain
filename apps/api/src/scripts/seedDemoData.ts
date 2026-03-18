import { buildHistoricalLibraryDrafts } from "../data/historicalBackfillCases.js";
import { ingestHistoricalCaseLibrary } from "../lib/historicalCaseLibrary.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();

try {
  const seeded = await ingestHistoricalCaseLibrary(services, {
    items: buildHistoricalLibraryDrafts("macro_v1").slice(0, 4),
    store_library: true,
    ingest_reviewed_memory: true,
    fallback_model_version: "demo-seed-v1",
    labeling_mode: "merge",
  });

  console.log(
    JSON.stringify(
      {
        ingested_cases: seeded.ingested_cases,
        stored_library_items: seeded.stored_library_items,
        reviewed_ingests: seeded.reviewed_ingests,
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
