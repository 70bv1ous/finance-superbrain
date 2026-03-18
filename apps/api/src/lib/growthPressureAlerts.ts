import { growthPressureAlertReportSchema } from "@finance-superbrain/schemas";
import type {
  GrowthPressureAlertReport,
  GrowthPressurePolicy,
  StoredGrowthPressureAlert,
} from "@finance-superbrain/schemas";

import { buildBenchmarkRegressionReport } from "./benchmarkRegressionReport.js";
import { buildEvolutionTrendReport } from "./evolutionTrendReport.js";
import { resolveGrowthPressurePolicy } from "./growthPressurePolicies.js";
import type { Repository } from "./repository.types.js";
import { buildWalkForwardRegressionReport } from "./walkForwardRegressionReport.js";
import { buildWalkForwardRegimeRegressionReport } from "./walkForwardRegimeRegressionReport.js";

type FamilyTrend = Awaited<ReturnType<typeof buildEvolutionTrendReport>>["families"][number];
type BenchmarkRegression = Awaited<
  ReturnType<typeof buildBenchmarkRegressionReport>
>["alerts"][number];
type WalkForwardRegression = Awaited<
  ReturnType<typeof buildWalkForwardRegressionReport>
>["alerts"][number];
type WalkForwardRegimeRegression = Awaited<
  ReturnType<typeof buildWalkForwardRegimeRegressionReport>
>["alerts"][number];

const severityOrder: GrowthPressureAlertReport["alerts"][number]["severity"][] = [
  "low",
  "medium",
  "high",
];

const escalateSeverity = (
  severity: GrowthPressureAlertReport["alerts"][number]["severity"],
  steps: number,
) => severityOrder[Math.min(severityOrder.indexOf(severity) + steps, severityOrder.length - 1)]!;

export const unresolvedGrowthPressureStatuses: StoredGrowthPressureAlert["status"][] = [
  "open",
  "acknowledged",
  "snoozed",
  "handled",
];

const severityRank: Record<GrowthPressureAlertReport["alerts"][number]["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const nextAlertStatus = (
  existing: StoredGrowthPressureAlert | null,
  now: string,
): StoredGrowthPressureAlert["status"] => {
  if (!existing) {
    return "open";
  }

  if (existing.status === "snoozed" && existing.snoozed_until && existing.snoozed_until > now) {
    return "snoozed";
  }

  if (existing.status === "handled") {
    return "handled";
  }

  if (existing.status === "acknowledged") {
    return "acknowledged";
  }

  return "open";
};

type SignalCandidate = {
  severity: GrowthPressureAlertReport["alerts"][number]["severity"];
  text: string;
};

const buildSignalCandidates = (
  family: FamilyTrend,
  policy: GrowthPressurePolicy,
): SignalCandidate[] => {
  const signals: SignalCandidate[] = [];
  const thresholds = policy.thresholds;
  const passRate = family.recent_pass_rate;
  const averageScore = family.current_average_total_score;
  const absCalibrationGap =
    family.current_calibration_gap === null ? null : Math.abs(family.current_calibration_gap);

  if (passRate !== null) {
    if (passRate <= thresholds.high_pass_rate) {
      signals.push({
        severity: "high",
        text: `recent pass rate has slipped to ${passRate}`,
      });
    } else if (passRate <= thresholds.medium_pass_rate) {
      signals.push({
        severity: "medium",
        text: `recent pass rate has slipped to ${passRate}`,
      });
    } else if (passRate <= thresholds.low_pass_rate) {
      signals.push({
        severity: "low",
        text: `recent pass rate has slipped to ${passRate}`,
      });
    }
  }

  if (
    family.pass_rate_delta !== null &&
    family.pass_rate_delta <= thresholds.pass_rate_delta_decline
  ) {
    signals.push({
      severity: "medium",
      text: `promotion pass rate is deteriorating by ${family.pass_rate_delta}`,
    });
  }

  if (averageScore !== null) {
    if (averageScore <= thresholds.high_average_total_score) {
      signals.push({
        severity: "high",
        text: `active shell score is soft at ${averageScore}`,
      });
    } else if (averageScore <= thresholds.medium_average_total_score) {
      signals.push({
        severity: "medium",
        text: `active shell score is soft at ${averageScore}`,
      });
    } else if (averageScore <= thresholds.low_average_total_score) {
      signals.push({
        severity: "low",
        text: `active shell score is soft at ${averageScore}`,
      });
    }
  }

  if (absCalibrationGap !== null) {
    if (absCalibrationGap >= thresholds.high_abs_calibration_gap) {
      signals.push({
        severity: "high",
        text: `active shell calibration gap is stretched at ${family.current_calibration_gap}`,
      });
    } else if (absCalibrationGap >= thresholds.medium_abs_calibration_gap) {
      signals.push({
        severity: "medium",
        text: `active shell calibration gap is stretched at ${family.current_calibration_gap}`,
      });
    }
  }

  if (family.trend_signal === "pressured") {
    signals.push({
      severity: "medium",
      text: "lineage trend is currently pressured",
    });
  }

  if (family.generation_depth === 0 && family.recent_pass_rate !== null) {
    signals.push({
      severity: "low",
      text: "family still has no hardened descendant shells",
    });
  }

  return signals;
};

const recommendedActionForSeverity = (
  severity: GrowthPressureAlertReport["alerts"][number]["severity"],
  policy: GrowthPressurePolicy,
) =>
  severity === "high"
    ? `Prepare diagnostics on ${policy.actions.diagnostics_case_pack}, schedule a molt review, and require approval before generating a new shell.`
    : severity === "medium"
      ? `Queue replay diagnostics on ${policy.actions.diagnostics_case_pack} if pressure persists through the configured cycles.`
      : "Keep this family under observation; growth pressure is building but not urgent yet.";

const syntheticFamilyTrendFromRegressionSeed = (
  regression: {
    family: string;
    model_version: string | null;
  },
): FamilyTrend => ({
  family: regression.family,
  active_model_version: regression.model_version,
  generation_depth: 0,
  generation_depth_delta: 0,
  total_shells: 0,
  shell_delta: 0,
  hardened_shells: 0,
  hardened_delta: 0,
  current_average_total_score: null,
  score_delta: null,
  current_calibration_gap: null,
  calibration_gap_delta: null,
  recent_pass_rate: null,
  prior_pass_rate: null,
  pass_rate_delta: null,
  trend_signal: "stable",
  snapshots: [],
});

export type GrowthPressureRegressionSignal = {
  severity: GrowthPressureAlertReport["alerts"][number]["severity"];
  signals: string[];
  regression_streak: number;
  weak_regimes: string[];
};

const mergeRegressionSignal = (
  current: GrowthPressureRegressionSignal | undefined,
  next: BenchmarkRegression | WalkForwardRegression | WalkForwardRegimeRegression,
): GrowthPressureRegressionSignal => {
  const currentRank = current ? severityRank[current.severity] : 0;
  const nextRank = severityRank[next.severity];
  const nextWeakRegimes = "regime" in next ? [next.regime] : [];

  return {
    severity:
      currentRank >= nextRank
        ? (current?.severity ?? next.severity)
        : next.severity,
    signals: [...(current?.signals ?? []), ...next.signals],
    regression_streak: Math.max(current?.regression_streak ?? 0, next.regression_streak),
    weak_regimes: Array.from(new Set([...(current?.weak_regimes ?? []), ...nextWeakRegimes])),
  };
};

export const buildGrowthPressureRegressionSignals = async (
  repository: Repository,
  options: {
    benchmark_pack_id?: string;
    benchmark_regression_report?: Awaited<ReturnType<typeof buildBenchmarkRegressionReport>>;
    walk_forward_regression_report?: Awaited<
      ReturnType<typeof buildWalkForwardRegressionReport>
    >;
    walk_forward_regime_regression_report?: Awaited<
      ReturnType<typeof buildWalkForwardRegimeRegressionReport>
    >;
  } = {},
) => {
  const [benchmarkRegressions, walkForwardRegressions, walkForwardRegimeRegressions] =
    await Promise.all([
      options.benchmark_regression_report ??
        buildBenchmarkRegressionReport(repository, {
          benchmark_pack_id: options.benchmark_pack_id,
        }),
      options.walk_forward_regression_report ??
        buildWalkForwardRegressionReport(repository, {
          benchmark_pack_id: options.benchmark_pack_id,
        }),
      options.walk_forward_regime_regression_report ??
        buildWalkForwardRegimeRegressionReport(repository, {
          benchmark_pack_id: options.benchmark_pack_id,
        }),
    ]);
  const regressionByFamily = new Map<string, GrowthPressureRegressionSignal>();

  for (const alert of benchmarkRegressions.alerts) {
    regressionByFamily.set(
      alert.family,
      mergeRegressionSignal(regressionByFamily.get(alert.family), alert),
    );
  }

  for (const alert of walkForwardRegressions.alerts) {
    regressionByFamily.set(
      alert.family,
      mergeRegressionSignal(regressionByFamily.get(alert.family), alert),
    );
  }

  for (const alert of walkForwardRegimeRegressions.alerts) {
    regressionByFamily.set(
      alert.family,
      mergeRegressionSignal(regressionByFamily.get(alert.family), alert),
    );
  }

  return {
    benchmarkRegressions,
    walkForwardRegressions,
    walkForwardRegimeRegressions,
    regressionByFamily,
  };
};

export const evaluateGrowthPressureAlert = async (
  repository: Repository,
  family: FamilyTrend,
  now = new Date().toISOString(),
  regressionSignal?: GrowthPressureRegressionSignal | null,
): Promise<GrowthPressureAlertReport["alerts"][number] | null> => {
  const policy = await resolveGrowthPressurePolicy(repository, family.family, now);

  if (!policy.enabled) {
    return null;
  }

  const existing =
    (
      await repository.listGrowthPressureAlerts({
        family: family.family,
        statuses: unresolvedGrowthPressureStatuses,
        limit: 1,
      })
    )[0] ?? null;
  const signals = buildSignalCandidates(family, policy);

  if (regressionSignal) {
    signals.push(
      ...regressionSignal.signals.map((text) => ({
        severity: regressionSignal.severity,
        text,
      })),
    );
  }

  if (!signals.length) {
    return null;
  }

  let severity = [...signals].sort(
    (left, right) => severityRank[right.severity] - severityRank[left.severity],
  )[0]!.severity;

  const regressionStreak = regressionSignal?.regression_streak ?? 0;

  if (regressionStreak >= 3) {
    severity = escalateSeverity(severity, 2);
  } else if (regressionStreak >= 2) {
    severity = escalateSeverity(severity, 1);
  }

  return {
    id: existing?.id ?? null,
    family: family.family,
    policy_family: policy.family,
    severity,
    status: nextAlertStatus(existing, now),
    active_model_version: family.active_model_version,
    generation_depth: family.generation_depth,
    pass_rate: family.recent_pass_rate,
    average_total_score: family.current_average_total_score,
    calibration_gap: family.current_calibration_gap,
    trend_signal: family.trend_signal,
    persistence_count: existing?.persistence_count ?? 1,
    first_triggered_at: existing?.first_triggered_at ?? null,
    last_triggered_at: existing?.last_triggered_at ?? null,
    snoozed_until: existing?.snoozed_until ?? null,
    acknowledged_at: existing?.acknowledged_at ?? null,
    handled_at: existing?.handled_at ?? null,
    resolved_at: existing?.resolved_at ?? null,
    planned_action: existing?.planned_action ?? null,
    plan_status: existing?.plan_status ?? null,
    signals: signals.map((signal) => signal.text),
    recommended_action: recommendedActionForSeverity(severity, policy),
  };
};

export const buildGrowthPressureAlertReport = async (
  repository: Repository,
  options: {
    benchmark_pack_id?: string;
    benchmark_regression_report?: Awaited<ReturnType<typeof buildBenchmarkRegressionReport>>;
    walk_forward_regression_report?: Awaited<
      ReturnType<typeof buildWalkForwardRegressionReport>
    >;
    walk_forward_regime_regression_report?: Awaited<
      ReturnType<typeof buildWalkForwardRegimeRegressionReport>
    >;
  } = {},
): Promise<GrowthPressureAlertReport> => {
  const [trends, regressions] = await Promise.all([
    buildEvolutionTrendReport(repository),
    buildGrowthPressureRegressionSignals(repository, options),
  ]);
  const {
    benchmarkRegressions,
    walkForwardRegressions,
    walkForwardRegimeRegressions,
    regressionByFamily,
  } = regressions;

  const trendByFamily = new Map(trends.families.map((family) => [family.family, family] as const));
  const familyNames = new Set<string>([
    ...trends.families.map((family) => family.family),
    ...benchmarkRegressions.alerts.map((alert) => alert.family),
    ...walkForwardRegressions.alerts.map((alert) => alert.family),
    ...walkForwardRegimeRegressions.alerts.map((alert) => alert.family),
  ]);
  const alerts = (
    await Promise.all(
      [...familyNames].map((familyName) =>
        evaluateGrowthPressureAlert(
          repository,
          trendByFamily.get(familyName) ??
            syntheticFamilyTrendFromRegressionSeed(
              benchmarkRegressions.alerts.find((alert) => alert.family === familyName) ??
                walkForwardRegressions.alerts.find((alert) => alert.family === familyName) ?? {
                  family: familyName,
                  model_version: null,
                },
            ),
          undefined,
          regressionByFamily.get(familyName) ?? null,
        ),
      ),
    )
  )
    .filter((item): item is GrowthPressureAlertReport["alerts"][number] => item !== null)
    .sort((left, right) => {
      if (severityRank[right.severity] !== severityRank[left.severity]) {
        return severityRank[right.severity] - severityRank[left.severity];
      }

      if (right.persistence_count !== left.persistence_count) {
        return right.persistence_count - left.persistence_count;
      }

      return left.family.localeCompare(right.family);
    });

  return growthPressureAlertReportSchema.parse({
    generated_at: new Date().toISOString(),
    counts: {
      high: alerts.filter((alert) => alert.severity === "high").length,
      medium: alerts.filter((alert) => alert.severity === "medium").length,
      low: alerts.filter((alert) => alert.severity === "low").length,
    },
    alerts,
  });
};
