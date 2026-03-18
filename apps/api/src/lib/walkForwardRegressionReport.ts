import { walkForwardRegressionReportSchema } from "@finance-superbrain/schemas";
import type { WalkForwardRegressionReport, WalkForwardTrendReport } from "@finance-superbrain/schemas";

import { buildWalkForwardTrendReport } from "./walkForwardTrendReport.js";
import type { Repository } from "./repository.types.js";

type Severity = WalkForwardRegressionReport["alerts"][number]["severity"];

const severityRank: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const round = (value: number) => Number(value.toFixed(2));

const buildSeverity = (
  scoreDelta: number | null,
  directionDelta: number | null,
  wrongRateDelta: number | null,
  calibrationGapDelta: number | null,
): Severity | null => {
  if (
    (scoreDelta !== null && scoreDelta <= -0.08) ||
    (directionDelta !== null && directionDelta <= -0.1) ||
    (wrongRateDelta !== null && wrongRateDelta >= 0.12) ||
    (calibrationGapDelta !== null && calibrationGapDelta >= 0.08)
  ) {
    return "high";
  }

  if (
    (scoreDelta !== null && scoreDelta <= -0.05) ||
    (directionDelta !== null && directionDelta <= -0.07) ||
    (wrongRateDelta !== null && wrongRateDelta >= 0.08) ||
    (calibrationGapDelta !== null && calibrationGapDelta >= 0.06)
  ) {
    return "medium";
  }

  if (
    (scoreDelta !== null && scoreDelta <= -0.03) ||
    (directionDelta !== null && directionDelta <= -0.05) ||
    (wrongRateDelta !== null && wrongRateDelta >= 0.05) ||
    (calibrationGapDelta !== null && calibrationGapDelta >= 0.05)
  ) {
    return "low";
  }

  return null;
};

const calculateRegressionStreak = (snapshots: WalkForwardTrendReport["families"][number]["snapshots"]) => {
  if (snapshots.length < 2) {
    return 0;
  }

  let streak = 0;

  for (let index = snapshots.length - 1; index >= 1; index -= 1) {
    const latest = snapshots[index]!;
    const previousSnapshots = snapshots.slice(0, index);
    const strongestPriorScore = previousSnapshots.reduce(
      (max, snapshot) => Math.max(max, snapshot.average_total_score),
      previousSnapshots[0]!.average_total_score,
    );
    const strongestPriorDirection = previousSnapshots.reduce(
      (max, snapshot) => Math.max(max, snapshot.direction_accuracy),
      previousSnapshots[0]!.direction_accuracy,
    );
    const lowestPriorWrongRate = previousSnapshots.reduce(
      (min, snapshot) => Math.min(min, snapshot.wrong_rate),
      previousSnapshots[0]!.wrong_rate,
    );
    const tightestPriorCalibrationGap = previousSnapshots.reduce(
      (min, snapshot) => Math.min(min, Math.abs(snapshot.calibration_gap)),
      Math.abs(previousSnapshots[0]!.calibration_gap),
    );
    const severity = buildSeverity(
      round(latest.average_total_score - strongestPriorScore),
      round(latest.direction_accuracy - strongestPriorDirection),
      round(latest.wrong_rate - lowestPriorWrongRate),
      round(Math.abs(latest.calibration_gap) - tightestPriorCalibrationGap),
    );

    if (!severity) {
      break;
    }

    streak += 1;
  }

  return streak;
};

export const buildWalkForwardRegressionReport = async (
  repository: Repository,
  options: {
    benchmark_pack_id?: string;
    limit?: number;
  } = {},
): Promise<WalkForwardRegressionReport> => {
  const trend = await buildWalkForwardTrendReport(repository, options);
  return buildWalkForwardRegressionReportFromTrend(trend);
};

export const buildWalkForwardRegressionReportFromTrend = (
  trend: WalkForwardTrendReport,
): WalkForwardRegressionReport => {
  const alerts = trend.families
    .map((family) => {
      const previousSnapshots = family.snapshots.slice(0, -1);

      if (!previousSnapshots.length) {
        return null;
      }

      const latest = family.snapshots[family.snapshots.length - 1]!;
      const strongestPriorScore = previousSnapshots.reduce(
        (max, snapshot) => Math.max(max, snapshot.average_total_score),
        previousSnapshots[0]!.average_total_score,
      );
      const strongestPriorDirection = previousSnapshots.reduce(
        (max, snapshot) => Math.max(max, snapshot.direction_accuracy),
        previousSnapshots[0]!.direction_accuracy,
      );
      const lowestPriorWrongRate = previousSnapshots.reduce(
        (min, snapshot) => Math.min(min, snapshot.wrong_rate),
        previousSnapshots[0]!.wrong_rate,
      );
      const tightestPriorCalibrationGap = previousSnapshots.reduce(
        (min, snapshot) => Math.min(min, Math.abs(snapshot.calibration_gap)),
        Math.abs(previousSnapshots[0]!.calibration_gap),
      );
      const scoreDelta = round(latest.average_total_score - strongestPriorScore);
      const directionDelta = round(latest.direction_accuracy - strongestPriorDirection);
      const wrongRateDelta = round(latest.wrong_rate - lowestPriorWrongRate);
      const calibrationGapDelta = round(
        Math.abs(latest.calibration_gap) - tightestPriorCalibrationGap,
      );
      const severity = buildSeverity(
        scoreDelta,
        directionDelta,
        wrongRateDelta,
        calibrationGapDelta,
      );

      if (!severity) {
        return null;
      }

      const regressionStreak = calculateRegressionStreak(family.snapshots);
      const signals: string[] = [];

      if (scoreDelta <= -0.03) {
        signals.push(`walk-forward score trails the family baseline by ${scoreDelta}`);
      }

      if (directionDelta <= -0.05) {
        signals.push(
          `walk-forward direction accuracy trails the family baseline by ${directionDelta}`,
        );
      }

      if (wrongRateDelta >= 0.05) {
        signals.push(`walk-forward wrong rate exceeds the family baseline by ${wrongRateDelta}`);
      }

      if (calibrationGapDelta >= 0.05) {
        signals.push(
          `walk-forward calibration gap is wider than the family baseline by ${calibrationGapDelta}`,
        );
      }

      if (regressionStreak >= 2) {
        signals.push(
          `walk-forward regression has persisted for ${regressionStreak} consecutive checkpoints`,
        );
      }

      return {
        family: family.family,
        benchmark_pack_id: trend.benchmark_pack_id,
        model_version: family.latest_model_version,
        severity,
        regression_streak: Math.max(1, regressionStreak),
        latest_snapshot_at: latest.as_of,
        score_delta: scoreDelta,
        direction_accuracy_delta: directionDelta,
        wrong_rate_delta: wrongRateDelta,
        calibration_gap_delta: calibrationGapDelta,
        signals,
        recommended_action:
          severity === "high"
            ? `Treat ${family.family} as time-ordered growth pressure and queue diagnostics before hardening the next shell.`
            : severity === "medium"
              ? `Keep ${family.family} under walk-forward watch and rerun timed diagnostics soon.`
              : `Monitor ${family.family}; timed validation is softening but not yet critical.`,
      };
    })
    .filter((item): item is WalkForwardRegressionReport["alerts"][number] => item !== null)
    .sort((left, right) => {
      if (severityRank[right.severity] !== severityRank[left.severity]) {
        return severityRank[right.severity] - severityRank[left.severity];
      }

      return left.family.localeCompare(right.family);
    });

  return walkForwardRegressionReportSchema.parse({
    generated_at: new Date().toISOString(),
    benchmark_pack_id: trend.benchmark_pack_id,
    counts: {
      high: alerts.filter((alert) => alert.severity === "high").length,
      medium: alerts.filter((alert) => alert.severity === "medium").length,
      low: alerts.filter((alert) => alert.severity === "low").length,
    },
    alerts,
  });
};
