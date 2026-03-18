import { storedPromotionEvaluationSchema } from "@finance-superbrain/schemas";
import type {
  CreateModelVersionRequest,
  ReplayPromotionRequest,
  StoredPromotionEvaluation,
} from "@finance-superbrain/schemas";

import { composeHistoricalBenchmarkPack } from "./benchmarkPackComposer.js";
import { runHistoricalReplayBenchmark } from "./historicalReplay.js";
import { inferPredictionStrategyProfile } from "./modelStrategyProfiles.js";
import type { Repository } from "./repository.types.js";
import { runWalkForwardReplay } from "./walkForwardReplay.js";

const round = (value: number) => Number(value.toFixed(2));

const truncate = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : value.slice(0, maxLength);

const inferModelFamily = (modelVersion: string) => {
  const strippedVersion = modelVersion.replace(/-?v\d[\w-]*$/i, "");
  return strippedVersion || modelVersion;
};

const buildPromotionDeltas = (
  baseline: Pick<
    StoredPromotionEvaluation["baseline"],
    | "average_total_score"
    | "direction_accuracy"
    | "wrong_rate"
    | "calibration_gap"
    | "average_calibration_score"
  >,
  candidate: Pick<
    StoredPromotionEvaluation["candidate"],
    | "average_total_score"
    | "direction_accuracy"
    | "wrong_rate"
    | "calibration_gap"
    | "average_calibration_score"
  >,
) => ({
  average_total_score: round(candidate.average_total_score - baseline.average_total_score),
  direction_accuracy: round(candidate.direction_accuracy - baseline.direction_accuracy),
  wrong_rate: round(candidate.wrong_rate - baseline.wrong_rate),
  calibration_alignment:
    typeof baseline.average_calibration_score === "number" &&
    typeof candidate.average_calibration_score === "number"
      ? round(candidate.average_calibration_score - baseline.average_calibration_score)
      : round(Math.abs(baseline.calibration_gap) - Math.abs(candidate.calibration_gap)),
});

const collectPromotionThresholdFailures = (
  deltas: ReturnType<typeof buildPromotionDeltas>,
  thresholds: ReplayPromotionRequest["thresholds"],
  prefix = "",
) => {
  const reasons: string[] = [];

  if (deltas.average_total_score < thresholds.min_average_total_score_delta) {
    reasons.push(
      `${prefix}average total score delta ${deltas.average_total_score} is below the required ${thresholds.min_average_total_score_delta}.`,
    );
  }

  if (deltas.direction_accuracy < thresholds.min_direction_accuracy_delta) {
    reasons.push(
      `${prefix}direction accuracy delta ${deltas.direction_accuracy} is below the required ${thresholds.min_direction_accuracy_delta}.`,
    );
  }

  if (deltas.wrong_rate > thresholds.max_wrong_rate_delta) {
    reasons.push(
      `${prefix}wrong-rate delta ${deltas.wrong_rate} is above the allowed ${thresholds.max_wrong_rate_delta}.`,
    );
  }

  if (deltas.calibration_alignment < thresholds.min_calibration_alignment_delta) {
    reasons.push(
      `${prefix}calibration alignment delta ${deltas.calibration_alignment} is below the required ${thresholds.min_calibration_alignment_delta}.`,
    );
  }

  return reasons;
};

const collectWalkForwardDepthFailures = (
  walkForwardReplay: Awaited<ReturnType<typeof runWalkForwardReplay>>,
  depthRequirements: NonNullable<ReplayPromotionRequest["walk_forward"]>["depth_requirements"],
) => {
  const reasons: string[] = [];

  if (walkForwardReplay.window_count < depthRequirements.min_window_count) {
    reasons.push(
      `Walk-forward window count ${walkForwardReplay.window_count} is below the required ${depthRequirements.min_window_count}.`,
    );
  }

  if (walkForwardReplay.eligible_case_count < depthRequirements.min_eligible_case_count) {
    reasons.push(
      `Walk-forward eligible-case count ${walkForwardReplay.eligible_case_count} is below the required ${depthRequirements.min_eligible_case_count}.`,
    );
  }

  if (walkForwardReplay.eligible_regime_count < depthRequirements.min_regime_count) {
    reasons.push(
      `Walk-forward regime count ${walkForwardReplay.eligible_regime_count} is below the required ${depthRequirements.min_regime_count}.`,
    );
  }

  if (
    walkForwardReplay.eligible_high_confidence_case_count <
    depthRequirements.min_high_confidence_case_count
  ) {
    reasons.push(
      `Walk-forward high-confidence case count ${walkForwardReplay.eligible_high_confidence_case_count} is below the required ${depthRequirements.min_high_confidence_case_count}.`,
    );
  }

  return reasons;
};

const buildPromotionFeatureFlags = (
  request: ReplayPromotionRequest,
  replay: {
    case_pack: string;
    case_count: number;
  },
  deltas: ReturnType<typeof buildPromotionDeltas>,
  walkForwardDecision: StoredPromotionEvaluation["walk_forward"],
) => ({
  promotion_baseline_model: request.baseline_model_version,
  promotion_case_pack: replay.case_pack,
  promotion_case_count: replay.case_count,
  promotion_average_total_score_delta: deltas.average_total_score,
  promotion_direction_accuracy_delta: deltas.direction_accuracy,
  promotion_wrong_rate_delta: deltas.wrong_rate,
  promotion_calibration_alignment_delta: deltas.calibration_alignment,
  promotion_walk_forward_enabled: Boolean(request.walk_forward?.enabled),
  ...(walkForwardDecision
    ? {
        promotion_walk_forward_benchmark_pack: walkForwardDecision.benchmark_pack_id,
        promotion_walk_forward_window_count: walkForwardDecision.window_count,
        promotion_walk_forward_eligible_case_count:
          walkForwardDecision.eligible_case_count,
        promotion_walk_forward_passed: walkForwardDecision.passed,
        promotion_walk_forward_average_total_score_delta:
          walkForwardDecision.deltas.average_total_score,
        promotion_walk_forward_direction_accuracy_delta:
          walkForwardDecision.deltas.direction_accuracy,
        promotion_walk_forward_wrong_rate_delta:
          walkForwardDecision.deltas.wrong_rate,
        promotion_walk_forward_calibration_alignment_delta:
          walkForwardDecision.deltas.calibration_alignment,
      }
    : {}),
});

export const evaluateReplayPromotion = async (
  repository: Repository,
  candidateModelVersion: string,
  request: ReplayPromotionRequest,
): Promise<StoredPromotionEvaluation> => {
  const replayCases =
    request.cases ??
    (await (async () => {
      const composition = await composeHistoricalBenchmarkPack(repository, {
        model_versions: [request.baseline_model_version, candidateModelVersion],
        benchmark_pack_id: request.benchmark_pack_id ?? "core_benchmark_v1",
        case_pack_filters: request.benchmark_case_pack_filters,
        allowed_case_qualities: request.benchmark_allowed_case_qualities,
        strict_quotas: request.benchmark_strict_quotas,
      });

      if (request.benchmark_strict_quotas && !composition.quotas_met) {
        throw new Error(
          `Benchmark pack ${composition.pack_id} is incomplete and cannot be used for promotion.`,
        );
      }

      return composition.replay_request.cases;
    })());

  const replay = await runHistoricalReplayBenchmark(repository, {
    model_versions: [request.baseline_model_version, candidateModelVersion],
    cases: replayCases,
  });
  const baseline = replay.models.find(
    (model) => model.model_version === request.baseline_model_version,
  );
  const candidate = replay.models.find((model) => model.model_version === candidateModelVersion);

  if (!baseline || !candidate) {
    throw new Error("Promotion replay did not produce both baseline and candidate metrics.");
  }

  const deltas = buildPromotionDeltas(baseline, candidate);
  const failureReasons = collectPromotionThresholdFailures(deltas, request.thresholds);
  let walkForwardDecision: StoredPromotionEvaluation["walk_forward"] = null;

  if (request.walk_forward?.enabled) {
    const walkForwardReplay = await runWalkForwardReplay(repository, {
      model_versions: [request.baseline_model_version, candidateModelVersion],
      benchmark_pack_id:
        request.walk_forward.benchmark_pack_id ??
        request.benchmark_pack_id ??
        "core_benchmark_v1",
      case_pack_filters: request.walk_forward.case_pack_filters,
      allowed_case_qualities: request.walk_forward.allowed_case_qualities,
      training_mode: "expanding",
      min_train_cases: request.walk_forward.min_train_cases,
      test_window_size: request.walk_forward.test_window_size,
      step_size: request.walk_forward.step_size,
      seed_training_memory: request.walk_forward.seed_training_memory,
      training_memory_model_version: request.walk_forward.training_memory_model_version,
    });
    const walkForwardBaseline = walkForwardReplay.models.find(
      (model) => model.model_version === request.baseline_model_version,
    );
    const walkForwardCandidate = walkForwardReplay.models.find(
      (model) => model.model_version === candidateModelVersion,
    );

    if (!walkForwardBaseline || !walkForwardCandidate) {
      throw new Error(
        "Walk-forward promotion replay did not produce both baseline and candidate metrics.",
      );
    }

    const walkForwardDeltas = buildPromotionDeltas(
      walkForwardBaseline,
      walkForwardCandidate,
    );
    const walkForwardDepthFailures = collectWalkForwardDepthFailures(
      walkForwardReplay,
      request.walk_forward.depth_requirements,
    );
    const walkForwardFailures = collectPromotionThresholdFailures(
      walkForwardDeltas,
      request.walk_forward.thresholds,
      "Walk-forward ",
    );
    const combinedWalkForwardFailures = [...walkForwardDepthFailures, ...walkForwardFailures];
    const walkForwardPassed = combinedWalkForwardFailures.length === 0;

    walkForwardDecision = {
      benchmark_pack_id: walkForwardReplay.benchmark_pack_id,
      window_count: walkForwardReplay.window_count,
      eligible_case_count: walkForwardReplay.eligible_case_count,
      eligible_regime_count: walkForwardReplay.eligible_regime_count,
      eligible_high_confidence_case_count:
        walkForwardReplay.eligible_high_confidence_case_count,
      depth_requirements_met: walkForwardDepthFailures.length === 0,
      passed: walkForwardPassed,
      reasons: walkForwardPassed
        ? [
            `Walk-forward promotion gate passed across ${walkForwardReplay.window_count} time-ordered window(s).`,
          ]
        : combinedWalkForwardFailures,
      deltas: walkForwardDeltas,
      depth_requirements: request.walk_forward.depth_requirements,
      thresholds: request.walk_forward.thresholds,
      baseline: walkForwardBaseline,
      candidate: walkForwardCandidate,
    };

    failureReasons.push(...combinedWalkForwardFailures);
  }

  const passed = failureReasons.length === 0;
  const reasons = [...failureReasons];
  let savedModel = null;

  if (passed && request.promote_on_pass) {
    const candidateRegistry = await repository.getModelVersion(candidateModelVersion);
    const baselineRegistry = await repository.getModelVersion(request.baseline_model_version);
    const sourceModel = candidateRegistry ?? baselineRegistry;
    const promotionTime = new Date().toISOString();
    const saveInput: CreateModelVersionRequest = {
      model_version: candidateModelVersion,
      family: sourceModel?.family ?? inferModelFamily(candidateModelVersion),
      label: truncate(
        candidateRegistry?.label ??
          baselineRegistry?.label ??
          `${candidateModelVersion} promoted`,
        120,
      ),
      description: truncate(
        [
          candidateRegistry?.description ?? baselineRegistry?.description,
          `Promoted from replay against ${request.baseline_model_version} on ${replay.case_pack} (${replay.case_count} cases).`,
        ]
          .filter(Boolean)
          .join(" "),
        1000,
      ),
      owner: candidateRegistry?.owner ?? baselineRegistry?.owner,
      prompt_profile:
        candidateRegistry?.prompt_profile ??
        baselineRegistry?.prompt_profile ??
        inferPredictionStrategyProfile(candidateModelVersion, candidateRegistry ?? baselineRegistry),
      status: request.promoted_status,
      feature_flags: {
        ...(candidateRegistry?.feature_flags ?? baselineRegistry?.feature_flags ?? {}),
        promotion_last_checked_at: promotionTime,
        promotion_last_decision: "passed",
        ...buildPromotionFeatureFlags(request, replay, deltas, walkForwardDecision),
      },
    };

    savedModel = await repository.saveModelVersion(saveInput);
    reasons.push(
      request.walk_forward?.enabled
        ? `Static replay and walk-forward promotion gates passed. ${candidateModelVersion} was saved with status ${request.promoted_status}.`
        : `Promotion passed. ${candidateModelVersion} was saved with status ${request.promoted_status}.`,
    );
  } else if (passed) {
    reasons.push(
      request.walk_forward?.enabled
        ? "Static replay and walk-forward promotion gates passed, but no registry update was requested."
        : "Promotion gate passed, but no registry update was requested.",
    );
  } else {
    const candidateRegistry = await repository.getModelVersion(candidateModelVersion);

    if (candidateRegistry) {
      savedModel = await repository.saveModelVersion({
        model_version: candidateRegistry.model_version,
        family: candidateRegistry.family,
        label: candidateRegistry.label,
        description: truncate(
          [
            candidateRegistry.description,
            `Replay promotion gate failed against ${request.baseline_model_version} on ${replay.case_pack}.`,
          ]
            .filter(Boolean)
            .join(" "),
          1000,
        ),
        owner: candidateRegistry.owner,
        prompt_profile: candidateRegistry.prompt_profile,
        status: candidateRegistry.status,
        feature_flags: {
          ...candidateRegistry.feature_flags,
          promotion_last_checked_at: new Date().toISOString(),
          promotion_last_decision: "failed",
          ...buildPromotionFeatureFlags(request, replay, deltas, walkForwardDecision),
        },
      });
    }
  }

  return storedPromotionEvaluationSchema.parse(
    await repository.savePromotionEvaluation({
      candidate_model_version: candidateModelVersion,
      baseline_model_version: request.baseline_model_version,
      case_pack: replay.case_pack,
      case_count: replay.case_count,
      passed,
      reasons,
      deltas,
      thresholds: request.thresholds,
      baseline,
      candidate,
      walk_forward: walkForwardDecision,
      saved_model: savedModel,
    }),
  );
};
