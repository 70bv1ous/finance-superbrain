import { walkForwardRegimeTrendReportSchema } from "@finance-superbrain/schemas";
import type {
  WalkForwardRegimeTrendReport,
  WalkForwardReplaySnapshot,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

const round = (value: number) => Number(value.toFixed(2));

const sortOldestFirst = (left: { as_of: string }, right: { as_of: string }) =>
  left.as_of.localeCompare(right.as_of);

const bestSlice = (
  slices: WalkForwardRegimeTrendReport["slices"],
  selector: (slice: WalkForwardRegimeTrendReport["slices"][number]) => number,
) => {
  if (!slices.length) {
    return null;
  }

  const selected = [...slices].sort((left, right) => {
    const delta = selector(right) - selector(left);

    if (delta !== 0) {
      return delta;
    }

    if (left.regime !== right.regime) {
      return left.regime.localeCompare(right.regime);
    }

    return left.family.localeCompare(right.family);
  })[0];

  return selected ? `${selected.family} @ ${selected.regime}` : null;
};

const emptyReport = (benchmarkPackId: string) =>
  walkForwardRegimeTrendReportSchema.parse({
    generated_at: new Date().toISOString(),
    benchmark_pack_id: benchmarkPackId,
    sample_count: 0,
    regime_count: 0,
    slices: [],
    leaders: {
      by_score_improvement: null,
      by_direction_improvement: null,
      by_wrong_rate_reduction: null,
      by_calibration_improvement: null,
    },
  });

const snapshotRegimes = (snapshot: WalkForwardReplaySnapshot) =>
  snapshot.report.regimes ?? [];

export const buildWalkForwardRegimeTrendReport = async (
  repository: Repository,
  options: {
    benchmark_pack_id?: string;
    limit?: number;
  } = {},
): Promise<WalkForwardRegimeTrendReport> => {
  const benchmarkPackId = options.benchmark_pack_id ?? "core_benchmark_v1";
  const snapshots = (
    await repository.listWalkForwardReplaySnapshots({
      limit: options.limit ?? 24,
      benchmark_pack_id: benchmarkPackId,
    })
  );

  return buildWalkForwardRegimeTrendReportFromSnapshots(benchmarkPackId, snapshots);
};

export const buildWalkForwardRegimeTrendReportFromSnapshots = (
  benchmarkPackId: string,
  snapshots: WalkForwardReplaySnapshot[],
): WalkForwardRegimeTrendReport => {
  const sortedSnapshots = [...snapshots].sort(sortOldestFirst);

  if (!sortedSnapshots.length) {
    return emptyReport(benchmarkPackId);
  }

  const regimeFamilyKeys = new Set<string>();
  const uniqueRegimes = new Set<string>();

  for (const snapshot of sortedSnapshots) {
    for (const regime of snapshotRegimes(snapshot)) {
      regimeFamilyKeys.add(`${regime.regime}::${regime.family}`);
      uniqueRegimes.add(regime.regime);
    }
  }

  const slices: WalkForwardRegimeTrendReport["slices"] = [];

  for (const key of regimeFamilyKeys) {
    const [regimeName, familyName] = key.split("::");

    if (!regimeName || !familyName) {
      continue;
    }

    const points: WalkForwardRegimeTrendReport["slices"][number]["snapshots"] = [];

    for (const snapshot of sortedSnapshots) {
      const regime = snapshotRegimes(snapshot).find(
        (item) => item.regime === regimeName && item.family === familyName,
      );

      if (!regime) {
        continue;
      }

      points.push({
        as_of: snapshot.as_of,
        model_version: regime.model_version,
        average_total_score: regime.average_total_score,
        direction_accuracy: regime.direction_accuracy,
        wrong_rate: regime.wrong_rate,
        calibration_gap: regime.calibration_gap,
        case_count: regime.case_count,
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
    const wrongRateDelta =
      prior === null ? null : round(latest.wrong_rate - prior.wrong_rate);
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

    slices.push({
      regime: regimeName,
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

  slices.sort((left, right) => {
    if (left.regime !== right.regime) {
      return left.regime.localeCompare(right.regime);
    }

    if ((right.current_average_total_score ?? 0) !== (left.current_average_total_score ?? 0)) {
      return (right.current_average_total_score ?? 0) - (left.current_average_total_score ?? 0);
    }

    return left.family.localeCompare(right.family);
  });

  return walkForwardRegimeTrendReportSchema.parse({
    generated_at: new Date().toISOString(),
    benchmark_pack_id: benchmarkPackId,
    sample_count: sortedSnapshots.length,
    regime_count: uniqueRegimes.size,
    slices,
    leaders: {
      by_score_improvement: bestSlice(
        slices,
        (slice) => slice.score_delta ?? Number.NEGATIVE_INFINITY,
      ),
      by_direction_improvement: bestSlice(
        slices,
        (slice) => slice.direction_accuracy_delta ?? Number.NEGATIVE_INFINITY,
      ),
      by_wrong_rate_reduction: bestSlice(
        slices,
        (slice) =>
          slice.wrong_rate_delta === null
            ? Number.NEGATIVE_INFINITY
            : slice.wrong_rate_delta * -1,
      ),
      by_calibration_improvement: bestSlice(
        slices,
        (slice) =>
          slice.calibration_gap_delta === null
            ? Number.NEGATIVE_INFINITY
            : Math.abs(slice.calibration_gap_delta) * -1,
      ),
    },
  });
};
