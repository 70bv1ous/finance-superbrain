import { describe, expect, it } from "vitest";

import { replayPromotionRequestSchema } from "@finance-superbrain/schemas";

import { buildHistoricalReplayPack } from "../data/historicalBackfillCases.js";
import { evaluateReplayPromotion } from "./evaluateReplayPromotion.js";
import { InMemoryRepository } from "./InMemoryRepository.js";

describe("evaluateReplayPromotion", () => {
  it("uses replay calibration quality when deciding whether a tuned candidate passes", async () => {
    const repository = new InMemoryRepository();

    await repository.saveModelVersion({
      model_version: "impact-engine-v0",
      family: "impact-engine",
      label: "Impact Engine v0",
      status: "active",
      feature_flags: {
        strategy_profile: "baseline",
      },
    });
    await repository.saveModelVersion({
      model_version: "impact-engine-v1-replay-tuned",
      family: "impact-engine",
      label: "Impact Engine v1 replay tuned",
      status: "experimental",
      feature_flags: {
        strategy_profile: "contrarian_regime_aware",
        replay_tuned_from: "impact-engine-v0",
      },
    });

    const decision = await evaluateReplayPromotion(
      repository,
      "impact-engine-v1-replay-tuned",
      replayPromotionRequestSchema.parse({
        baseline_model_version: "impact-engine-v0",
        cases: buildHistoricalReplayPack(
          ["impact-engine-v0", "impact-engine-v1-replay-tuned"],
          "macro_plus_v1",
        ).cases,
        thresholds: {
          min_average_total_score_delta: -0.05,
          min_direction_accuracy_delta: -0.05,
          max_wrong_rate_delta: -0.2,
          min_calibration_alignment_delta: 0.05,
        },
      }),
    );

    expect(decision.passed).toBe(true);
    expect(decision.baseline.average_calibration_score).toBeDefined();
    expect(decision.candidate.average_calibration_score).toBeDefined();
    expect(decision.baseline.average_calibration_score ?? 0).toBeLessThan(
      decision.candidate.average_calibration_score ?? 0,
    );
    expect(decision.deltas.calibration_alignment).toBeGreaterThan(0.05);
  });
});
