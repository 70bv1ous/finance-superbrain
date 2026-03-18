import { promotionCycleResponseSchema } from "@finance-superbrain/schemas";
import type {
  PromotionCycleRequest,
  PromotionCycleResponse,
  StoredModelVersion,
} from "@finance-superbrain/schemas";

import { buildHistoricalReplayPack } from "../data/historicalBackfillCases.js";

import { composeHistoricalBenchmarkPack } from "./benchmarkPackComposer.js";
import { evaluateReplayPromotion } from "./evaluateReplayPromotion.js";
import type { Repository } from "./repository.types.js";

type PromotionCandidate = PromotionCycleResponse["candidates"][number];

const sortNewestFirst = (left: { created_at: string }, right: { created_at: string }) =>
  right.created_at.localeCompare(left.created_at);

const discoverPromotionCandidates = (
  models: StoredModelVersion[],
  maxCandidates: number,
): PromotionCandidate[] => {
  const activeByFamily = new Map<string, StoredModelVersion>();
  const byVersion = new Map(models.map((model) => [model.model_version, model] as const));

  for (const model of [...models].sort(sortNewestFirst)) {
    if (model.status === "active" && !activeByFamily.has(model.family)) {
      activeByFamily.set(model.family, model);
    }
  }

  return [...models]
    .filter((model) => model.status === "experimental")
    .sort(sortNewestFirst)
    .flatMap((model) => {
      const preferredBaselineVersion =
        typeof model.feature_flags.replay_tuned_from === "string"
          ? model.feature_flags.replay_tuned_from
          : null;
      const explicitBaseline =
        preferredBaselineVersion && preferredBaselineVersion !== model.model_version
          ? byVersion.get(preferredBaselineVersion) ?? null
          : null;
      const baseline = explicitBaseline ?? activeByFamily.get(model.family) ?? null;

      if (!baseline || baseline.model_version === model.model_version) {
        return [];
      }

      return [
        {
          candidate_model_version: model.model_version,
          baseline_model_version: baseline.model_version,
          family: model.family,
          status: model.status,
          created_at: model.created_at,
        },
      ];
    })
    .slice(0, maxCandidates);
};

export const runPromotionCycle = async (
  repository: Repository,
  request: PromotionCycleRequest,
): Promise<PromotionCycleResponse> => {
  const models = await repository.listModelVersions();
  const candidates = discoverPromotionCandidates(models, request.max_candidates);
  const evaluations = [];

  for (const candidate of candidates) {
    const replayCases = request.benchmark_pack_id
      ? await (async () => {
          const composition = await composeHistoricalBenchmarkPack(repository, {
            model_versions: [
              candidate.baseline_model_version,
              candidate.candidate_model_version,
            ],
            benchmark_pack_id: request.benchmark_pack_id!,
            case_pack_filters: request.benchmark_case_pack_filters,
            allowed_case_qualities: request.benchmark_allowed_case_qualities,
            strict_quotas: request.benchmark_strict_quotas,
          });

          if (request.benchmark_strict_quotas && !composition.quotas_met) {
            throw new Error(
              `Benchmark pack ${composition.pack_id} is incomplete and cannot run the promotion cycle.`,
            );
          }

          return composition.replay_request.cases;
        })()
      : buildHistoricalReplayPack(
          [candidate.baseline_model_version, candidate.candidate_model_version],
          request.case_pack,
        ).cases;

    evaluations.push(
      await evaluateReplayPromotion(repository, candidate.candidate_model_version, {
        baseline_model_version: candidate.baseline_model_version,
        cases: replayCases,
        benchmark_allowed_case_qualities: request.benchmark_allowed_case_qualities,
        benchmark_strict_quotas: request.benchmark_strict_quotas,
        thresholds: request.thresholds,
        walk_forward: request.walk_forward,
        promote_on_pass: request.promote_on_pass,
        promoted_status: request.promoted_status,
      }),
    );
  }

  return promotionCycleResponseSchema.parse({
    case_pack: request.benchmark_pack_id ?? request.case_pack,
    benchmark_pack_id: request.benchmark_pack_id ?? null,
    processed: evaluations.length,
    passed: evaluations.filter((item) => item.passed).length,
    failed: evaluations.filter((item) => !item.passed).length,
    candidates,
    evaluations,
  });
};
