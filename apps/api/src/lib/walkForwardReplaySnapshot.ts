import { randomUUID } from "node:crypto";

import { walkForwardReplaySnapshotSchema } from "@finance-superbrain/schemas";
import type {
  StoredModelVersion,
  WalkForwardReplaySnapshot,
  WalkForwardReplaySnapshotRequest,
} from "@finance-superbrain/schemas";

import { runWalkForwardReplay } from "./walkForwardReplay.js";
import type { Repository } from "./repository.types.js";

const sortNewestFirst = (left: { created_at: string }, right: { created_at: string }) =>
  right.created_at.localeCompare(left.created_at);

const inferFamily = (modelVersion: string) =>
  modelVersion.replace(/-?v\d[\w-]*$/i, "") || modelVersion;

const unique = (values: string[]) => Array.from(new Set(values));

const resolveDefaultModelVersions = (models: StoredModelVersion[]) => {
  const activeByFamily = new Map<string, StoredModelVersion>();

  for (const model of [...models].sort(sortNewestFirst)) {
    if (model.status === "active" && !activeByFamily.has(model.family)) {
      activeByFamily.set(model.family, model);
    }
  }

  return [...activeByFamily.values()].map((model) => model.model_version);
};

const buildSnapshotFamilyRows = (
  models: WalkForwardReplaySnapshot["report"]["models"],
): WalkForwardReplaySnapshot["report"]["families"] => {
  const grouped = new Map<string, WalkForwardReplaySnapshot["report"]["models"]>();

  for (const model of models) {
    const bucket = grouped.get(model.family) ?? [];
    bucket.push(model);
    grouped.set(model.family, bucket);
  }

  return [...grouped.entries()]
    .map(([family, entries]) => {
      const selected = [...entries].sort((left, right) => {
        if (left.status === "active" && right.status !== "active") {
          return -1;
        }

        if (right.status === "active" && left.status !== "active") {
          return 1;
        }

        if (right.average_total_score !== left.average_total_score) {
          return right.average_total_score - left.average_total_score;
        }

        return left.model_version.localeCompare(right.model_version);
      })[0]!;

      return {
        family,
        model_version: selected.model_version,
        status: selected.status,
        case_count: selected.case_count,
        average_confidence: selected.average_confidence,
        average_total_score: selected.average_total_score,
        direction_accuracy: selected.direction_accuracy,
        calibration_gap: selected.calibration_gap,
        wrong_rate: selected.wrong_rate,
      };
    })
    .sort((left, right) => {
      if (right.average_total_score !== left.average_total_score) {
        return right.average_total_score - left.average_total_score;
      }

      return left.family.localeCompare(right.family);
    });
};

const buildSnapshotRegimeRows = (
  regimes: WalkForwardReplaySnapshot["report"]["regimes"],
) => {
  const grouped = new Map<string, WalkForwardReplaySnapshot["report"]["regimes"]>();

  for (const regime of regimes) {
    const key = `${regime.regime}::${regime.family}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(regime);
    grouped.set(key, bucket);
  }

  return [...grouped.values()]
    .map((entries) => {
      const selected = [...entries].sort((left, right) => {
        if (left.status === "active" && right.status !== "active") {
          return -1;
        }

        if (right.status === "active" && left.status !== "active") {
          return 1;
        }

        if (right.average_total_score !== left.average_total_score) {
          return right.average_total_score - left.average_total_score;
        }

        return left.model_version.localeCompare(right.model_version);
      })[0]!;

      return selected;
    })
    .sort((left, right) => {
      if (left.regime !== right.regime) {
        return left.regime.localeCompare(right.regime);
      }

      if (right.average_total_score !== left.average_total_score) {
        return right.average_total_score - left.average_total_score;
      }

      return left.family.localeCompare(right.family);
    });
};

export const captureWalkForwardReplaySnapshot = async (
  repository: Repository,
  request: WalkForwardReplaySnapshotRequest,
): Promise<WalkForwardReplaySnapshot> => {
  const models = await repository.listModelVersions();
  const modelByVersion = new Map(models.map((model) => [model.model_version, model] as const));
  const modelVersions = unique(
    request.model_versions?.length ? request.model_versions : resolveDefaultModelVersions(models),
  );

  if (!modelVersions.length) {
    throw new Error("No active model families are available for walk-forward snapshot capture.");
  }

  const replay = await runWalkForwardReplay(repository, {
    model_versions: modelVersions,
    benchmark_pack_id: request.benchmark_pack_id,
    case_pack_filters: request.case_pack_filters,
    allowed_case_qualities: request.allowed_case_qualities,
    training_mode: request.training_mode,
    min_train_cases: request.min_train_cases,
    test_window_size: request.test_window_size,
    step_size: request.step_size,
    seed_training_memory: request.seed_training_memory,
    training_memory_model_version: request.training_memory_model_version,
  });
  const snapshotModels = replay.models
    .map((model) => {
      const registryModel = modelByVersion.get(model.model_version);

      return {
        ...model,
        family: registryModel?.family ?? inferFamily(model.model_version),
        status: registryModel?.status ?? null,
      };
    })
    .sort((left, right) => {
      if (right.average_total_score !== left.average_total_score) {
        return right.average_total_score - left.average_total_score;
      }

      return left.model_version.localeCompare(right.model_version);
    });
  const snapshotFamilies = buildSnapshotFamilyRows(snapshotModels);
  const snapshotRegimes = buildSnapshotRegimeRows(
    replay.regimes
      .map((regime) => {
        const registryModel = modelByVersion.get(regime.model_version);

        return {
          ...regime,
          family: registryModel?.family ?? inferFamily(regime.model_version),
          status: registryModel?.status ?? null,
        };
      })
      .sort((left, right) => {
        if (left.regime !== right.regime) {
          return left.regime.localeCompare(right.regime);
        }

        if (right.average_total_score !== left.average_total_score) {
          return right.average_total_score - left.average_total_score;
        }

        return left.model_version.localeCompare(right.model_version);
      }),
  );
  const now = new Date().toISOString();

  const snapshot = walkForwardReplaySnapshotSchema.parse({
    id: randomUUID(),
    as_of: request.as_of ?? now,
    benchmark_pack_id: replay.benchmark_pack_id,
    eligible_case_count: replay.eligible_case_count,
    window_count: replay.window_count,
    family_count: snapshotFamilies.length,
    report: {
      benchmark_pack_id: replay.benchmark_pack_id,
      training_mode: replay.training_mode,
      min_train_cases: replay.min_train_cases,
      test_window_size: replay.test_window_size,
      step_size: replay.step_size,
      eligible_case_count: replay.eligible_case_count,
      undated_case_count: replay.undated_case_count,
      first_eligible_occurred_at: replay.first_eligible_occurred_at,
      last_eligible_occurred_at: replay.last_eligible_occurred_at,
      window_count: replay.window_count,
      model_count: snapshotModels.length,
      family_count: snapshotFamilies.length,
      leaders: replay.leaders,
      warnings: replay.warnings,
      models: snapshotModels,
      families: snapshotFamilies,
      regimes: snapshotRegimes,
    },
    created_at: now,
  });

  await repository.saveWalkForwardReplaySnapshot(snapshot);
  return snapshot;
};
