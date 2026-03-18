import {
  historicalHighConfidenceSeedRequestSchema,
  type HistoricalHighConfidenceSeedResponse,
} from "@finance-superbrain/schemas";

import { runCoreHighConfidenceSeed } from "../lib/coreHighConfidenceSeed.js";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";

const parseCasePackFilters = () =>
  process.env.HIGH_CONFIDENCE_CASE_PACKS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const parseTargetRegimes = () =>
  process.env.HIGH_CONFIDENCE_TARGET_REGIMES
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const run = async () => {
  const request = historicalHighConfidenceSeedRequestSchema.parse({
    reviewer: process.env.HIGH_CONFIDENCE_REVIEWER ?? "core-corpus-seed",
    case_pack_filters: parseCasePackFilters(),
    prioritize_gap_regimes:
      (process.env.HIGH_CONFIDENCE_PRIORITIZE_GAP_REGIMES ?? "true").toLowerCase() === "true",
    target_regimes: parseTargetRegimes(),
    limit: Number(process.env.HIGH_CONFIDENCE_LIMIT ?? 12),
    min_candidate_score: Number(process.env.HIGH_CONFIDENCE_MIN_SCORE ?? 0.8),
    dry_run: (process.env.HIGH_CONFIDENCE_DRY_RUN ?? "false").toLowerCase() === "true",
    ingest_reviewed_memory:
      (process.env.HIGH_CONFIDENCE_INGEST_REVIEWED_MEMORY ?? "false").toLowerCase() ===
      "true",
    model_version:
      process.env.HIGH_CONFIDENCE_MODEL_VERSION ??
      "historical-library-high-confidence-v1",
  });
  const result = await runTrackedScriptOperation<HistoricalHighConfidenceSeedResponse>(
    {
      operation_name: "high_confidence_seed",
      metadata: {
        benchmark_pack_id: request.benchmark_pack_id ?? null,
        dry_run: request.dry_run,
        limit: request.limit,
      },
      summarize: (response) => ({
        scanned_reviewed_cases: response.scanned_reviewed_cases,
        candidate_count: response.candidate_count,
        promoted_count: response.promoted_count,
        skipped_count: response.skipped_count,
        prioritized_regime_count: response.prioritized_regimes.length,
      }),
    },
    (services) => runCoreHighConfidenceSeed(services, request),
  );

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

run().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
