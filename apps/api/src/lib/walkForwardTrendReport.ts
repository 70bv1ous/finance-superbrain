import { walkForwardTrendReportSchema } from "@finance-superbrain/schemas";
import type { WalkForwardReplaySnapshot, WalkForwardTrendReport } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

const round = (value: number) => Number(value.toFixed(2));

const sortOldestFirst = (left: { as_of: string }, right: { as_of: string }) =>
  left.as_of.localeCompare(right.as_of);

const bestFamily = (
  families: WalkForwardTrendReport["families"],
  selector: (family: WalkForwardTrendReport["families"][number]) => number,
) => {
  if (!families.length) {
    return null;
  }

  return [...families]
    .sort((left, right) => {
      const delta = selector(right) - selector(left);

      if (delta !== 0) {
        return delta;
      }

      return left.family.localeCompare(right.family);
    })[0]?.family ?? null;
};

const emptyReport = (benchmarkPackId: string) =>
  walkForwardTrendReportSchema.parse({
    generated_at: new Date().toISOString(),
    benchmark_pack_id: benchmarkPackId,
    sample_count: 0,
    families: [],
    leaders: {
      by_score_improvement: null,
      by_direction_improvement: null,
      by_wrong_rate_reduction: null,
      by_calibration_improvement: null,
    },
  });

export const buildWalkForwardTrendReport = async (
  repository: Repository,
  options: {
    benchmark_pack_id?: string;
    limit?: number;
  } = {},
): Promise<WalkForwardTrendReport> => {
  const benchmarkPackId = options.benchmark_pack_id ?? "core_benchmark_v1";
  const snapshots = (
    await repository.listWalkForwardReplaySnapshots({
      limit: options.limit ?? 24,
      benchmark_pack_id: benchmarkPackId,
    })
  );

  return buildWalkForwardTrendReportFromSnapshots(benchmarkPackId, snapshots);
};

export const buildWalkForwardTrendReportFromSnapshots = (
  benchmarkPackId: string,
  snapshots: WalkForwardReplaySnapshot[],
): WalkForwardTrendReport => {
  const sortedSnapshots = [...snapshots].sort(sortOldestFirst);

  if (!sortedSnapshots.length) {
    return emptyReport(benchmarkPackId);
  }

  const familyNames = new Set<string>();

  for (const snapshot of sortedSnapshots) {
    for (const family of snapshot.report.families) {
      familyNames.add(family.family);
    }
  }

  const families: WalkForwardTrendReport["families"] = [];

  for (const familyName of familyNames) {
    const points: WalkForwardTrendReport["families"][number]["snapshots"] = [];

    for (const snapshot of sortedSnapshots) {
      const family = snapshot.report.families.find((item) => item.family === familyName);

      if (!family) {
        continue;
      }

      points.push({
        as_of: snapshot.as_of,
        model_version: family.model_version,
        average_total_score: family.average_total_score,
        direction_accuracy: family.direction_accuracy,
        wrong_rate: family.wrong_rate,
        calibration_gap: family.calibration_gap,
        case_count: family.case_count,
        window_count: snapshot.window_count,
      });
    }

    if (!points.length) {
      continue;
    }

    const latest = points[points.length - 1]!;
    const prior = points.length > 1 ? points[points.length - 2]! : null;
    const scoreDelta =
      prior === null ? null : round(latest.average_total_score - prior.average_total_score);
    const directionDelta =
      prior === null ? null : round(latest.direction_accuracy - prior.direction_accuracy);
    const wrongRateDelta = prior === null ? null : round(latest.wrong_rate - prior.wrong_rate);
    const calibrationGapDelta =
      prior === null ? null : round(latest.calibration_gap - prior.calibration_gap);
    const trendSignal =
      prior === null
        ? ("emerging" as const)
        : (scoreDelta !== null && scoreDelta <= -0.03) ||
            (directionDelta !== null && directionDelta <= -0.05) ||
            (wrongRateDelta !== null && wrongRateDelta >= 0.05) ||
            (calibrationGapDelta !== null && Math.abs(calibrationGapDelta) >= 0.05)
          ? ("regressing" as const)
          : (scoreDelta !== null && scoreDelta >= 0.03) ||
              (directionDelta !== null && directionDelta >= 0.05) ||
              (wrongRateDelta !== null && wrongRateDelta <= -0.05)
            ? ("improving" as const)
            : ("stable" as const);

    families.push({
      family: familyName,
      benchmark_pack_id: benchmarkPackId,
      latest_model_version: latest.model_version,
      sample_count: points.length,
      current_average_total_score: latest.average_total_score,
      score_delta: scoreDelta,
      current_direction_accuracy: latest.direction_accuracy,
      direction_accuracy_delta: directionDelta,
      current_wrong_rate: latest.wrong_rate,
      wrong_rate_delta: wrongRateDelta,
      current_calibration_gap: latest.calibration_gap,
      calibration_gap_delta: calibrationGapDelta,
      trend_signal: trendSignal,
      snapshots: points.slice(-6),
    });
  }

  families.sort((left, right) => {
    if ((right.current_average_total_score ?? 0) !== (left.current_average_total_score ?? 0)) {
      return (right.current_average_total_score ?? 0) - (left.current_average_total_score ?? 0);
    }

    return left.family.localeCompare(right.family);
  });

  return walkForwardTrendReportSchema.parse({
    generated_at: new Date().toISOString(),
    benchmark_pack_id: benchmarkPackId,
    sample_count: sortedSnapshots.length,
    families,
    leaders: {
      by_score_improvement: bestFamily(
        families,
        (family) => family.score_delta ?? Number.NEGATIVE_INFINITY,
      ),
      by_direction_improvement: bestFamily(
        families,
        (family) => family.direction_accuracy_delta ?? Number.NEGATIVE_INFINITY,
      ),
      by_wrong_rate_reduction: bestFamily(
        families,
        (family) =>
          family.wrong_rate_delta === null ? Number.NEGATIVE_INFINITY : family.wrong_rate_delta * -1,
      ),
      by_calibration_improvement: bestFamily(
        families,
        (family) =>
          family.calibration_gap_delta === null
            ? Number.NEGATIVE_INFINITY
            : Math.abs(family.calibration_gap_delta) * -1,
      ),
    },
  });
};

export const latestWalkForwardSnapshotForPack = (
  snapshots: WalkForwardReplaySnapshot[],
  benchmarkPackId: string,
) =>
  [...snapshots]
    .filter((snapshot) => snapshot.benchmark_pack_id === benchmarkPackId)
    .sort((left, right) => right.as_of.localeCompare(left.as_of))[0] ?? null;
