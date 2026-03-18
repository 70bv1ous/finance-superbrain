import { benchmarkStabilityReportSchema } from "@finance-superbrain/schemas";
import type { BenchmarkReplaySnapshot, BenchmarkStabilityReport } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

const round = (value: number) => Number(value.toFixed(2));

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const stddev = (values: number[]) => {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
};

const sortOldestFirst = (left: { as_of: string }, right: { as_of: string }) =>
  left.as_of.localeCompare(right.as_of);

const startOfIsoWeek = (isoTimestamp: string) => {
  const date = new Date(isoTimestamp);
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
};

const isoWeekKey = (weekStart: Date) => weekStart.toISOString().slice(0, 10);

const summarizeWeekSignal = (
  latestScore: number,
  latestDirection: number,
  latestWrongRate: number,
  latestCalibrationGap: number,
  prior:
    | {
        average_total_score: number;
        direction_accuracy: number;
        wrong_rate: number;
        calibration_gap: number;
      }
    | null,
): BenchmarkStabilityReport["families"][number]["weekly_rollups"][number]["week_signal"] => {
  if (!prior) {
    return "emerging";
  }

  const scoreDelta = latestScore - prior.average_total_score;
  const directionDelta = latestDirection - prior.direction_accuracy;
  const wrongRateDelta = latestWrongRate - prior.wrong_rate;
  const calibrationDelta = Math.abs(latestCalibrationGap) - Math.abs(prior.calibration_gap);

  if (
    scoreDelta <= -0.03 ||
    directionDelta <= -0.05 ||
    wrongRateDelta >= 0.05 ||
    calibrationDelta >= 0.05
  ) {
    return "regressing";
  }

  if (scoreDelta >= 0.03 || directionDelta >= 0.05 || wrongRateDelta <= -0.05) {
    return "improving";
  }

  return "stable";
};

const bestFamily = (
  families: BenchmarkStabilityReport["families"],
  selector: (family: BenchmarkStabilityReport["families"][number]) => number,
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

export const buildBenchmarkStabilityReport = async (
  repository: Repository,
  options: {
    benchmark_pack_id?: string;
    limit?: number;
  } = {},
): Promise<BenchmarkStabilityReport> => {
  const benchmarkPackId = options.benchmark_pack_id ?? "core_benchmark_v1";
  const snapshots = (
    await repository.listBenchmarkReplaySnapshots({
      limit: options.limit ?? 48,
      benchmark_pack_id: benchmarkPackId,
    })
  ).sort(sortOldestFirst);

  return buildBenchmarkStabilityReportFromSnapshots(benchmarkPackId, snapshots);
};

export const buildBenchmarkStabilityReportFromSnapshots = (
  benchmarkPackId: string,
  snapshots: BenchmarkReplaySnapshot[],
): BenchmarkStabilityReport => {
  const sortedSnapshots = [...snapshots].sort(sortOldestFirst);

  if (!sortedSnapshots.length) {
    return benchmarkStabilityReportSchema.parse({
      generated_at: new Date().toISOString(),
      benchmark_pack_id: benchmarkPackId,
      sample_count: 0,
      week_count: 0,
      families: [],
      leaders: {
        by_stability_score: null,
        by_resilience: null,
        by_lowest_volatility: null,
      },
    });
  }

  const familyNames = new Set<string>();
  const weekKeys = new Set<string>();

  for (const snapshot of sortedSnapshots) {
    for (const family of snapshot.report.families) {
      familyNames.add(family.family);
      weekKeys.add(isoWeekKey(startOfIsoWeek(snapshot.as_of)));
    }
  }

  const families: BenchmarkStabilityReport["families"] = [];

  for (const familyName of familyNames) {
    const weekBuckets = new Map<
      string,
      Array<{
        as_of: string;
        model_version: string;
        average_total_score: number;
        direction_accuracy: number;
        wrong_rate: number;
        calibration_gap: number;
      }>
    >();

    for (const snapshot of sortedSnapshots) {
      const family = snapshot.report.families.find((item) => item.family === familyName);

      if (!family) {
        continue;
      }

      const weekStart = startOfIsoWeek(snapshot.as_of);
      const bucket = weekBuckets.get(isoWeekKey(weekStart)) ?? [];
      bucket.push({
        as_of: snapshot.as_of,
        model_version: family.model_version,
        average_total_score: family.average_total_score,
        direction_accuracy: family.direction_accuracy,
        wrong_rate: family.wrong_rate,
        calibration_gap: family.calibration_gap,
      });
      weekBuckets.set(isoWeekKey(weekStart), bucket);
    }

    const weeklyRollups: BenchmarkStabilityReport["families"][number]["weekly_rollups"] = [];
    let priorRollup:
      | BenchmarkStabilityReport["families"][number]["weekly_rollups"][number]
      | null = null;

    for (const [weekKey, entries] of [...weekBuckets.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      const latestEntry = [...entries].sort((left, right) => right.as_of.localeCompare(left.as_of))[0]!;
      const weekStartAt = `${weekKey}T00:00:00.000Z`;
      const weekEnd = new Date(weekStartAt);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      weekEnd.setUTCHours(23, 59, 59, 999);

      const averageTotalScore = round(average(entries.map((entry) => entry.average_total_score)));
      const directionAccuracy = round(average(entries.map((entry) => entry.direction_accuracy)));
      const wrongRate = round(average(entries.map((entry) => entry.wrong_rate)));
      const calibrationGap = round(average(entries.map((entry) => entry.calibration_gap)));
      const weekSignal = summarizeWeekSignal(
        averageTotalScore,
        directionAccuracy,
        wrongRate,
        calibrationGap,
        priorRollup
          ? {
              average_total_score: priorRollup.average_total_score,
              direction_accuracy: priorRollup.direction_accuracy,
              wrong_rate: priorRollup.wrong_rate,
              calibration_gap: priorRollup.calibration_gap,
            }
          : null,
      );

      const rollup = {
        week_key: weekKey,
        week_start_at: weekStartAt,
        week_end_at: weekEnd.toISOString(),
        latest_model_version: latestEntry.model_version,
        snapshot_count: entries.length,
        average_total_score: averageTotalScore,
        direction_accuracy: directionAccuracy,
        wrong_rate: wrongRate,
        calibration_gap: calibrationGap,
        week_signal: weekSignal,
      };

      weeklyRollups.push(rollup);
      priorRollup = rollup;
    }

    if (!weeklyRollups.length) {
      continue;
    }

    const scoreSeries = weeklyRollups.map((week) => week.average_total_score);
    const directionSeries = weeklyRollups.map((week) => week.direction_accuracy);
    const wrongRateSeries = weeklyRollups.map((week) => week.wrong_rate);
    const calibrationSeries = weeklyRollups.map((week) => Math.abs(week.calibration_gap));

    const averageWeeklyTotalScore = round(average(scoreSeries));
    const averageWeeklyDirectionAccuracy = round(average(directionSeries));
    const averageWeeklyWrongRate = round(average(wrongRateSeries));
    const averageAbsCalibrationGap = round(average(calibrationSeries));
    const scoreVolatility = round(stddev(scoreSeries));
    const directionVolatility = round(stddev(directionSeries));
    const wrongRateVolatility = round(stddev(wrongRateSeries));
    const calibrationVolatility = round(stddev(calibrationSeries));
    const regressionWeeks = weeklyRollups.filter((week) => week.week_signal === "regressing").length;
    const stableWeeks = weeklyRollups.filter((week) => week.week_signal === "stable").length;
    const improvingWeeks = weeklyRollups.filter((week) => week.week_signal === "improving").length;
    const consistencyScore = clamp(
      1 -
        average([
          clamp(scoreVolatility / 0.08),
          clamp(directionVolatility / 0.1),
          clamp(wrongRateVolatility / 0.1),
          clamp(calibrationVolatility / 0.08),
          clamp(regressionWeeks / Math.max(1, weeklyRollups.length)),
        ]),
    );
    const resilienceScore = round(
      clamp(
        average([
          1 - averageWeeklyWrongRate,
          1 - averageAbsCalibrationGap,
          clamp((stableWeeks + improvingWeeks) / weeklyRollups.length),
        ]),
      ),
    );
    const stabilityScore = round(
      clamp(
        averageWeeklyTotalScore * 0.3 +
          averageWeeklyDirectionAccuracy * 0.25 +
          (1 - averageWeeklyWrongRate) * 0.2 +
          (1 - averageAbsCalibrationGap) * 0.1 +
          consistencyScore * 0.15,
      ),
    );
    const latestRollup = weeklyRollups[weeklyRollups.length - 1]!;
    const currentSignal =
      weeklyRollups.length === 1
        ? ("emerging" as const)
        : stabilityScore >= 0.72 && regressionWeeks === 0 && latestRollup.week_signal !== "regressing"
          ? ("durable" as const)
          : stabilityScore >= 0.58 && regressionWeeks <= Math.max(1, Math.floor(weeklyRollups.length / 3))
            ? ("watch" as const)
            : ("fragile" as const);

    families.push({
      family: familyName,
      benchmark_pack_id: benchmarkPackId,
      latest_model_version: latestRollup.latest_model_version,
      week_count: weeklyRollups.length,
      stability_score: stabilityScore,
      resilience_score: resilienceScore,
      average_weekly_total_score: averageWeeklyTotalScore,
      average_weekly_direction_accuracy: averageWeeklyDirectionAccuracy,
      average_weekly_wrong_rate: averageWeeklyWrongRate,
      average_abs_calibration_gap: averageAbsCalibrationGap,
      score_volatility: scoreVolatility,
      direction_volatility: directionVolatility,
      wrong_rate_volatility: wrongRateVolatility,
      calibration_volatility: calibrationVolatility,
      regression_weeks: regressionWeeks,
      stable_weeks: stableWeeks,
      improving_weeks: improvingWeeks,
      current_signal: currentSignal,
      weekly_rollups: weeklyRollups,
    });
  }

  families.sort((left, right) => {
    if (right.stability_score !== left.stability_score) {
      return right.stability_score - left.stability_score;
    }

    return left.family.localeCompare(right.family);
  });

  return benchmarkStabilityReportSchema.parse({
    generated_at: new Date().toISOString(),
    benchmark_pack_id: benchmarkPackId,
    sample_count: sortedSnapshots.length,
    week_count: weekKeys.size,
    families,
    leaders: {
      by_stability_score: bestFamily(families, (family) => family.stability_score),
      by_resilience: bestFamily(families, (family) => family.resilience_score),
      by_lowest_volatility: bestFamily(
        families,
        (family) =>
          family.score_volatility === null ||
          family.direction_volatility === null ||
          family.wrong_rate_volatility === null ||
          family.calibration_volatility === null
            ? Number.NEGATIVE_INFINITY
            : -(
                family.score_volatility +
                family.direction_volatility +
                family.wrong_rate_volatility +
                family.calibration_volatility
              ),
      ),
    },
  });
};
