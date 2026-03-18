import { randomUUID } from "node:crypto";

import { benchmarkReplaySnapshotSchema } from "@finance-superbrain/schemas";
import type {
  BenchmarkReplaySnapshot,
  BenchmarkReplaySnapshotRequest,
  StoredModelVersion,
} from "@finance-superbrain/schemas";

import { composeHistoricalBenchmarkPack } from "./benchmarkPackComposer.js";
import { runHistoricalReplayBenchmark } from "./historicalReplay.js";
import type { Repository } from "./repository.types.js";

const round = (value: number) => Number(value.toFixed(2));

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
  models: BenchmarkReplaySnapshot["report"]["models"],
): BenchmarkReplaySnapshot["report"]["families"] => {
  const grouped = new Map<string, BenchmarkReplaySnapshot["report"]["models"]>();

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

export const captureBenchmarkReplaySnapshot = async (
  repository: Repository,
  request: BenchmarkReplaySnapshotRequest,
): Promise<BenchmarkReplaySnapshot> => {
  const models = await repository.listModelVersions();
  const modelByVersion = new Map(models.map((model) => [model.model_version, model] as const));
  const modelVersions = unique(
    request.model_versions?.length ? request.model_versions : resolveDefaultModelVersions(models),
  );

  if (!modelVersions.length) {
    throw new Error("No active model families are available for benchmark snapshot capture.");
  }

  const composition = await composeHistoricalBenchmarkPack(repository, {
    model_versions: modelVersions,
    benchmark_pack_id: request.benchmark_pack_id,
    case_pack_filters: request.case_pack_filters,
    allowed_case_qualities: request.allowed_case_qualities,
    strict_quotas: request.strict_quotas,
  });

  if (request.strict_quotas && !composition.quotas_met) {
    throw new Error(
      `Benchmark pack ${composition.pack_id} is incomplete and cannot be captured.`,
    );
  }

  const replay = await runHistoricalReplayBenchmark(repository, composition.replay_request);
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
  const now = new Date().toISOString();

  const snapshot = benchmarkReplaySnapshotSchema.parse({
    id: randomUUID(),
    as_of: request.as_of ?? now,
    benchmark_pack_id: composition.pack_id,
    selected_case_count: composition.selected_case_count,
    family_count: snapshotFamilies.length,
    report: {
      pack_id: composition.pack_id,
      label: composition.label,
      description: composition.description,
      selected_case_count: composition.selected_case_count,
      quotas_met: composition.quotas_met,
      domain_counts: composition.domain_counts,
      selected_case_ids: composition.selected_case_ids,
      model_count: snapshotModels.length,
      family_count: snapshotFamilies.length,
      leaders: replay.leaders,
      models: snapshotModels,
      families: snapshotFamilies,
    },
    created_at: now,
  });

  await repository.saveBenchmarkReplaySnapshot(snapshot);
  return snapshot;
};

export const summarizeBenchmarkReplaySnapshot = (snapshot: BenchmarkReplaySnapshot) => ({
  benchmark_pack_id: snapshot.benchmark_pack_id,
  selected_case_count: snapshot.selected_case_count,
  family_count: snapshot.family_count,
  leaders: snapshot.report.leaders,
  top_families: snapshot.report.families.slice(0, 5).map((family) => ({
    family: family.family,
    model_version: family.model_version,
    average_total_score: round(family.average_total_score),
    direction_accuracy: round(family.direction_accuracy),
    wrong_rate: round(family.wrong_rate),
    calibration_gap: round(family.calibration_gap),
  })),
});
