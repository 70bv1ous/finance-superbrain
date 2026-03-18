import { modelLineageReportSchema } from "@finance-superbrain/schemas";
import type {
  ModelLineageReport,
  StoredModelVersion,
  StoredPromotionEvaluation,
} from "@finance-superbrain/schemas";

import { buildModelComparisonReport } from "./modelComparisonReport.js";
import type { Repository } from "./repository.types.js";

type LineageNode = ModelLineageReport["families"][number]["lineage"][number];
type LineageFamily = ModelLineageReport["families"][number];

const parseCsv = (value: unknown) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const parseDelimited = (value: unknown, delimiter: string) =>
  typeof value === "string"
    ? value
        .split(delimiter)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const latestEvaluationForCandidate = (
  evaluations: StoredPromotionEvaluation[],
  modelVersion: string,
) =>
  evaluations
    .filter((evaluation) => evaluation.candidate_model_version === modelVersion)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;

const inferParent = (model: StoredModelVersion) => {
  const flags = model.feature_flags ?? {};

  if (
    typeof flags.molt_from === "string" &&
    flags.molt_from.trim() &&
    flags.molt_from !== model.model_version
  ) {
    return {
      origin_type: "molted" as const,
      parent_model_version: flags.molt_from.trim(),
    };
  }

  if (
    typeof flags.replay_tuned_from === "string" &&
    flags.replay_tuned_from.trim() &&
    flags.replay_tuned_from !== model.model_version
  ) {
    return {
      origin_type: "replay_tuned" as const,
      parent_model_version: flags.replay_tuned_from.trim(),
    };
  }

  return {
    origin_type: "root" as const,
    parent_model_version: null,
  };
};

const sortNewestFirst = (left: { created_at: string }, right: { created_at: string }) =>
  right.created_at.localeCompare(left.created_at);

const sortLineage = (left: LineageNode, right: LineageNode) => {
  if (left.generation !== right.generation) {
    return left.generation - right.generation;
  }

  return left.created_at.localeCompare(right.created_at);
};

const inferShellState = (
  model: StoredModelVersion,
  originType: LineageNode["origin_type"],
  latestPromotion: StoredPromotionEvaluation | null,
): LineageNode["shell_state"] => {
  const flags = model.feature_flags ?? {};
  const moltDecision =
    typeof flags.molt_last_decision === "string" ? flags.molt_last_decision : null;
  const moltCycleStatus =
    typeof flags.molt_cycle_status === "string" ? flags.molt_cycle_status : null;
  const promotionDecision =
    typeof flags.promotion_last_decision === "string" ? flags.promotion_last_decision : null;

  if (originType === "root") {
    return "root";
  }

  if (
    model.status === "active" &&
    (moltDecision === "hardened" ||
      promotionDecision === "passed" ||
      latestPromotion?.passed === true)
  ) {
    return "active";
  }

  if (moltDecision === "hardened") {
    return "hardened";
  }

  if (
    moltDecision === "held" ||
    promotionDecision === "failed" ||
    latestPromotion?.passed === false
  ) {
    return "held";
  }

  if (moltCycleStatus === "generated" || model.status === "experimental") {
    return "soft";
  }

  return model.status === "active" ? "active" : "hardened";
};

const buildGenerationResolver = (modelsByVersion: Map<string, StoredModelVersion>) => {
  const cache = new Map<string, number>();

  const resolveGeneration = (modelVersion: string, visited = new Set<string>()): number => {
    if (cache.has(modelVersion)) {
      return cache.get(modelVersion)!;
    }

    if (visited.has(modelVersion)) {
      return 0;
    }

    const model = modelsByVersion.get(modelVersion);

    if (!model) {
      return 0;
    }

    const { parent_model_version: parent } = inferParent(model);

    if (!parent || !modelsByVersion.has(parent)) {
      cache.set(modelVersion, 0);
      return 0;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(modelVersion);
    const generation = resolveGeneration(parent, nextVisited) + 1;
    cache.set(modelVersion, generation);
    return generation;
  };

  return resolveGeneration;
};

export const buildModelLineageReport = async (
  repository: Repository,
): Promise<ModelLineageReport> => {
  const [models, promotions, comparisonReport] = await Promise.all([
    repository.listModelVersions(),
    repository.listPromotionEvaluations(500),
    buildModelComparisonReport(repository),
  ]);
  const modelsByVersion = new Map(models.map((model) => [model.model_version, model] as const));
  const metricsByVersion = new Map(
    comparisonReport.versions.map((version) => [version.model_version, version] as const),
  );
  const resolveGeneration = buildGenerationResolver(modelsByVersion);
  const nodesByFamily = new Map<string, LineageNode[]>();

  for (const model of models) {
    const latestPromotion = latestEvaluationForCandidate(promotions, model.model_version);
    const ancestry = inferParent(model);
    const metrics = metricsByVersion.get(model.model_version);
    const flags = model.feature_flags ?? {};
    const node: LineageNode = {
      family: model.family,
      model_version: model.model_version,
      label: model.label ?? null,
      parent_model_version: ancestry.parent_model_version,
      generation: resolveGeneration(model.model_version),
      origin_type: ancestry.origin_type,
      shell_state: inferShellState(model, ancestry.origin_type, latestPromotion),
      registry_status: model.status,
      created_at: model.created_at,
      reviewed_count: metrics?.reviewed_count ?? 0,
      average_total_score: metrics?.sample_count ? metrics.average_total_score : null,
      direction_accuracy: metrics?.sample_count ? metrics.direction_accuracy : null,
      calibration_gap: metrics?.sample_count ? metrics.calibration_gap : null,
      trigger_reasons: parseDelimited(flags.molt_trigger_reasons, "|"),
      prior_patterns: parseCsv(flags.replay_prior_patterns),
      promotion_passed: latestPromotion?.passed ?? null,
      promotion_reasons: latestPromotion?.reasons ?? [],
      promotion_case_pack: latestPromotion?.case_pack ?? null,
    };
    const familyNodes = nodesByFamily.get(model.family) ?? [];
    familyNodes.push(node);
    nodesByFamily.set(model.family, familyNodes);
  }

  const families: LineageFamily[] = [...nodesByFamily.entries()]
    .map(([family, lineage]) => {
      const sortedLineage = [...lineage].sort(sortLineage);
      const roots = sortedLineage.filter((node) => node.parent_model_version === null);
      const latestModel = [...sortedLineage].sort(sortNewestFirst)[0] ?? null;
      const activeModel =
        [...sortedLineage]
          .filter((node) => modelsByVersion.get(node.model_version)?.status === "active")
          .sort(sortNewestFirst)[0] ?? null;

      return {
        family,
        root_model_version: roots[0]?.model_version ?? null,
        active_model_version: activeModel?.model_version ?? null,
        latest_model_version: latestModel?.model_version ?? null,
        generation_depth: sortedLineage.reduce(
          (max, node) => Math.max(max, node.generation),
          0,
        ),
        total_shells: sortedLineage.length,
        hardened_shells: sortedLineage.filter((node) =>
          node.shell_state === "active" || node.shell_state === "hardened",
        ).length,
        lineage: sortedLineage,
      };
    })
    .sort((left, right) => {
      if (right.generation_depth !== left.generation_depth) {
        return right.generation_depth - left.generation_depth;
      }

      if (right.total_shells !== left.total_shells) {
        return right.total_shells - left.total_shells;
      }

      return left.family.localeCompare(right.family);
    });

  const recentMoltNodes = families
    .flatMap((family) => family.lineage)
    .filter((node) => node.origin_type === "molted")
    .sort(sortNewestFirst)
    .slice(0, 12);

  return modelLineageReportSchema.parse({
    generated_at: new Date().toISOString(),
    families,
    recent_molts: recentMoltNodes,
  });
};
