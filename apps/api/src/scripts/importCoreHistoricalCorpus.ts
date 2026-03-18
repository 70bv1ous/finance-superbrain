import { coreHistoricalCorpusIngestionRequestSchema } from "@finance-superbrain/schemas";
import type { CoreHistoricalCorpusIngestionResponse } from "@finance-superbrain/schemas";

import { ingestCoreHistoricalCorpus } from "../lib/coreHistoricalCorpus.js";
import { buildServices } from "../lib/services.js";
import { requestOpsApi, shouldUseOpsApi } from "./httpOps.js";

const request = coreHistoricalCorpusIngestionRequestSchema.parse({
  include_backfill: (process.env.CORE_CORPUS_INCLUDE_BACKFILL ?? "true").toLowerCase() !== "false",
  backfill_case_pack: process.env.CORE_CORPUS_BACKFILL_CASE_PACK?.trim() || "macro_plus_v1",
  include_macro: (process.env.CORE_CORPUS_INCLUDE_MACRO ?? "true").toLowerCase() !== "false",
  macro_case_pack: process.env.CORE_CORPUS_MACRO_CASE_PACK?.trim() || "macro_calendar_v1",
  include_earnings: (process.env.CORE_CORPUS_INCLUDE_EARNINGS ?? "true").toLowerCase() !== "false",
  earnings_case_pack: process.env.CORE_CORPUS_EARNINGS_CASE_PACK?.trim() || "earnings_v1",
  include_policy_fx:
    (process.env.CORE_CORPUS_INCLUDE_POLICY_FX ?? "true").toLowerCase() !== "false",
  policy_case_pack: process.env.CORE_CORPUS_POLICY_CASE_PACK?.trim() || "policy_fx_v1",
  include_energy: (process.env.CORE_CORPUS_INCLUDE_ENERGY ?? "true").toLowerCase() !== "false",
  energy_case_pack: process.env.CORE_CORPUS_ENERGY_CASE_PACK?.trim() || "energy_v1",
  include_credit_banking:
    (process.env.CORE_CORPUS_INCLUDE_CREDIT ?? "true").toLowerCase() !== "false",
  credit_case_pack: process.env.CORE_CORPUS_CREDIT_CASE_PACK?.trim() || "credit_v1",
  store_library: (process.env.CORE_CORPUS_STORE ?? "true").toLowerCase() !== "false",
  ingest_reviewed_memory:
    (process.env.CORE_CORPUS_INGEST_REVIEWED_MEMORY ?? "true").toLowerCase() !== "false",
  fallback_model_version:
    process.env.CORE_CORPUS_FALLBACK_MODEL_VERSION?.trim() || "core-corpus-loader-v1",
  labeling_mode:
    (process.env.CORE_CORPUS_LABELING_MODE?.trim() || "merge") as
      | "merge"
      | "manual_only"
      | "inferred_only",
});

if (shouldUseOpsApi()) {
  const result = await requestOpsApi<CoreHistoricalCorpusIngestionResponse>(
    "POST",
    "/v1/ingestion/historical/core-corpus",
    request,
  );

  console.log(
    JSON.stringify(
      {
        ingested_cases: result.ingested_cases,
        stored_library_items: result.stored_library_items,
        reviewed_ingests: result.reviewed_ingests,
        domain_breakdown: result.domain_breakdown,
      },
      null,
      2,
    ),
  );
} else {
  const services = buildServices();

  try {
    const result = await ingestCoreHistoricalCorpus(services, request);

    console.log(
      JSON.stringify(
        {
          ingested_cases: result.ingested_cases,
          stored_library_items: result.stored_library_items,
          reviewed_ingests: result.reviewed_ingests,
          domain_breakdown: result.domain_breakdown,
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
}
