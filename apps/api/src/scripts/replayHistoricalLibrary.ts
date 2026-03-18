import { historicalCaseLibraryReplayRequestSchema } from "@finance-superbrain/schemas";

import { buildHistoricalReplayRequestFromLibrary } from "../lib/historicalCaseLibrary.js";
import { runHistoricalReplayBenchmark } from "../lib/historicalReplay.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();
const modelVersions = (process.env.REPLAY_MODEL_VERSIONS ?? "impact-engine-v0")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const caseIds = (process.env.REPLAY_LIBRARY_CASE_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!modelVersions.length) {
  throw new Error("Set REPLAY_MODEL_VERSIONS to one or more comma-separated model versions.");
}

try {
  const request = historicalCaseLibraryReplayRequestSchema.parse({
    model_versions: modelVersions,
    case_pack: process.env.REPLAY_LIBRARY_CASE_PACK?.trim() || process.env.REPLAY_CASE_PACK?.trim(),
    case_ids: caseIds.length ? caseIds : undefined,
    limit: Number(process.env.REPLAY_LIBRARY_LIMIT ?? 200),
  });
  const replayRequest = await buildHistoricalReplayRequestFromLibrary(
    services.repository,
    request,
  );
  const result = await runHistoricalReplayBenchmark(services.repository, replayRequest);

  console.log(
    JSON.stringify(
      {
        case_pack: result.case_pack,
        case_count: result.case_count,
        leaders: result.leaders,
        models: result.models.map((model) => ({
          model_version: model.model_version,
          average_total_score: model.average_total_score,
          direction_accuracy: model.direction_accuracy,
          calibration_gap: model.calibration_gap,
          wrong_rate: model.wrong_rate,
        })),
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
