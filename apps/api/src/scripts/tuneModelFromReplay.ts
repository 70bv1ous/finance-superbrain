import { applyReplayTuningRequestSchema } from "@finance-superbrain/schemas";

import { buildHistoricalReplayPack } from "../data/historicalBackfillCases.js";
import { applyHistoricalReplayTuning } from "../lib/applyHistoricalReplayTuning.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();
const sourceModelVersion = (process.env.REPLAY_TUNE_MODEL_VERSION ?? "impact-engine-v0").trim();
const casePack = process.env.REPLAY_CASE_PACK?.trim() || "macro_v1";

if (!sourceModelVersion) {
  throw new Error("Set REPLAY_TUNE_MODEL_VERSION to the model version you want to tune.");
}

const request = applyReplayTuningRequestSchema.parse({
  cases: buildHistoricalReplayPack([sourceModelVersion], casePack).cases,
  target_model_version: process.env.REPLAY_TUNE_TARGET_MODEL_VERSION?.trim() || undefined,
  label_suffix: process.env.REPLAY_TUNE_LABEL_SUFFIX?.trim() || "Replay tuned",
  status: process.env.REPLAY_TUNE_STATUS?.trim() || "experimental",
  use_pattern_priors: process.env.REPLAY_TUNE_USE_PATTERN_PRIORS?.trim() !== "false",
});

try {
  const result = await applyHistoricalReplayTuning(
    services.repository,
    sourceModelVersion,
    request,
  );

  console.log(
    JSON.stringify(
      {
        source_model_version: result.source_model_version,
        saved_model: result.saved_model,
        applied_pattern_priors: result.applied_pattern_priors,
        recommended_tuning: result.diagnostics.recommended_tuning,
        weakest_themes: result.diagnostics.weakest_themes.slice(0, 3),
        frequent_failure_tags: result.diagnostics.frequent_failure_tags,
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
