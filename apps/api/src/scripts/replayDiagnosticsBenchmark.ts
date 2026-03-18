import { buildHistoricalReplayPack } from "../data/historicalBackfillCases.js";
import { buildHistoricalReplayDiagnostics } from "../lib/historicalReplayDiagnostics.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();
const modelVersions = (process.env.REPLAY_MODEL_VERSIONS ?? "impact-engine-v0")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const casePack = process.env.REPLAY_CASE_PACK?.trim() || "macro_v1";

if (!modelVersions.length) {
  throw new Error("Set REPLAY_MODEL_VERSIONS to one or more comma-separated model versions.");
}

try {
  const result = await buildHistoricalReplayDiagnostics(
    services.repository,
    buildHistoricalReplayPack(modelVersions, casePack),
  );

  console.log(
    JSON.stringify(
      {
        case_pack: result.case_pack,
        case_count: result.case_count,
        leaders: result.leaders,
        models: result.models.map((model) => ({
          model_version: model.model_version,
          profile: model.profile,
          average_total_score: model.average_total_score,
          direction_accuracy: model.direction_accuracy,
          calibration_gap: model.calibration_gap,
          wrong_rate: model.wrong_rate,
          weakest_themes: model.weakest_themes.slice(0, 3),
          frequent_failure_tags: model.frequent_failure_tags,
          recommended_tuning: model.recommended_tuning,
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
