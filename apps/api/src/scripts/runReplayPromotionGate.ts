import { replayPromotionRequestSchema } from "@finance-superbrain/schemas";

import { buildHistoricalReplayPack } from "../data/historicalBackfillCases.js";
import { evaluateReplayPromotion } from "../lib/evaluateReplayPromotion.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();
const candidateModelVersion = (process.env.REPLAY_PROMOTION_CANDIDATE ?? "contrarian-regime-v1").trim();
const baselineModelVersion = (process.env.REPLAY_PROMOTION_BASELINE ?? "impact-engine-v0").trim();
const casePack = process.env.REPLAY_CASE_PACK?.trim() || "macro_plus_v1";

if (!candidateModelVersion || !baselineModelVersion) {
  throw new Error(
    "Set REPLAY_PROMOTION_CANDIDATE and REPLAY_PROMOTION_BASELINE before running the promotion gate.",
  );
}

const request = replayPromotionRequestSchema.parse({
  baseline_model_version: baselineModelVersion,
  cases: buildHistoricalReplayPack([baselineModelVersion, candidateModelVersion], casePack).cases,
  thresholds: {
    min_average_total_score_delta:
      Number(process.env.REPLAY_PROMOTION_MIN_SCORE_DELTA ?? 0.01),
    min_direction_accuracy_delta:
      Number(process.env.REPLAY_PROMOTION_MIN_DIRECTION_DELTA ?? 0),
    max_wrong_rate_delta: Number(process.env.REPLAY_PROMOTION_MAX_WRONG_RATE_DELTA ?? 0),
    min_calibration_alignment_delta:
      Number(process.env.REPLAY_PROMOTION_MIN_CALIBRATION_DELTA ?? 0),
  },
  promote_on_pass: (process.env.REPLAY_PROMOTION_APPLY ?? "true").toLowerCase() !== "false",
  promoted_status: (process.env.REPLAY_PROMOTION_STATUS ?? "active").trim() || "active",
});

try {
  const result = await evaluateReplayPromotion(
    services.repository,
    candidateModelVersion,
    request,
  );

  console.log(
    JSON.stringify(
      {
        candidate_model_version: result.candidate_model_version,
        baseline_model_version: result.baseline_model_version,
        case_pack: result.case_pack,
        case_count: result.case_count,
        passed: result.passed,
        reasons: result.reasons,
        deltas: result.deltas,
        thresholds: result.thresholds,
        saved_model: result.saved_model,
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
