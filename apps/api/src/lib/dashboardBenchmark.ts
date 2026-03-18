import { dashboardBenchmarkResponseSchema } from "@finance-superbrain/schemas";
import type {
  BenchmarkPackComposeRequest,
  DashboardBenchmarkResponse,
  StoredModelVersion,
} from "@finance-superbrain/schemas";

import { summarizeBenchmarkReplaySnapshot } from "./benchmarkReplaySnapshot.js";
import {
  listBenchmarkPackDefinitions,
  composeHistoricalBenchmarkPack,
} from "./benchmarkPackComposer.js";
import { buildBenchmarkRegressionReportFromTrend } from "./benchmarkRegressionReport.js";
import { buildBenchmarkStabilityReportFromSnapshots } from "./benchmarkStabilityReport.js";
import { buildBenchmarkTrendReportFromSnapshots } from "./benchmarkTrendReport.js";
import { buildGrowthPressureAlertReport } from "./growthPressureAlerts.js";
import { buildHistoricalLibraryCoverageReport } from "./historicalLibraryCoverageReport.js";
import { buildHistoricalLibraryGapReport } from "./historicalLibraryGapReport.js";
import type { Repository } from "./repository.types.js";
import { buildWalkForwardRegressionReportFromTrend } from "./walkForwardRegressionReport.js";
import { buildWalkForwardRegimeRegressionReportFromTrend } from "./walkForwardRegimeRegressionReport.js";
import { buildWalkForwardRegimeTrendReportFromSnapshots } from "./walkForwardRegimeTrendReport.js";
import {
  buildWalkForwardTrendReportFromSnapshots,
  latestWalkForwardSnapshotForPack,
} from "./walkForwardTrendReport.js";

const severityRank: Record<
  DashboardBenchmarkResponse["warnings"][number]["severity"],
  number
> = {
  high: 3,
  medium: 2,
  low: 1,
};

const sortNewestFirst = (left: { as_of: string }, right: { as_of: string }) =>
  right.as_of.localeCompare(left.as_of);

const sortNewestFirstByGeneratedAt = (
  left: { generated_at: string },
  right: { generated_at: string },
) => right.generated_at.localeCompare(left.generated_at);

const sortNewestFirstByCreatedAt = (
  left: { created_at: string },
  right: { created_at: string },
) => right.created_at.localeCompare(left.created_at);

const dedupeWarnings = (
  warnings: DashboardBenchmarkResponse["warnings"],
): DashboardBenchmarkResponse["warnings"] => {
  const seen = new Set<string>();

  return warnings.filter((warning) => {
    const key = `${warning.severity}:${warning.title}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const selectDefaultModelVersions = (models: StoredModelVersion[]) => {
  const sorted = [...models].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
  const activeByFamily = new Map<string, StoredModelVersion>();

  for (const model of sorted) {
    if (model.status === "active" && !activeByFamily.has(model.family)) {
      activeByFamily.set(model.family, model);
    }
  }

  if (activeByFamily.size) {
    return [...activeByFamily.values()].map((model) => model.model_version);
  }

  const latestByFamily = new Map<string, StoredModelVersion>();

  for (const model of sorted) {
    if (!latestByFamily.has(model.family)) {
      latestByFamily.set(model.family, model);
    }
  }

  return [...latestByFamily.values()]
    .slice(0, 10)
    .map((model) => model.model_version);
};

const toSnapshotPreview = (
  snapshot: Awaited<ReturnType<Repository["listBenchmarkReplaySnapshots"]>>[number],
) => {
  const summary = summarizeBenchmarkReplaySnapshot(snapshot);

  return {
    id: snapshot.id,
    as_of: snapshot.as_of,
    benchmark_pack_id: snapshot.benchmark_pack_id,
    selected_case_count: snapshot.selected_case_count,
    family_count: snapshot.family_count,
    leaders: summary.leaders,
    top_families: summary.top_families,
  };
};

const buildPackHealthFallback = (
  benchmarkPackId: string,
  message: string,
): DashboardBenchmarkResponse["pack_health"] => {
  const packDefinition =
    listBenchmarkPackDefinitions().packs.find((pack) => pack.pack_id === benchmarkPackId) ?? null;

  return {
    pack_id: benchmarkPackId,
    label: packDefinition?.label ?? benchmarkPackId,
    description: packDefinition?.description ?? message,
    target_case_count: packDefinition?.target_case_count ?? 1,
    selected_case_count: 0,
    quotas_met: false,
    allowed_case_qualities:
      packDefinition?.allowed_case_qualities ?? ["reviewed", "high_confidence"],
    domain_counts:
      packDefinition?.quotas.map((quota) => ({
        domain: quota.domain,
        minimum_cases: quota.minimum_cases,
        selected_cases: 0,
      })) ?? [],
    missing_domains:
      packDefinition?.quotas.map((quota) => ({
        domain: quota.domain,
        minimum_cases: quota.minimum_cases,
        selected_cases: 0,
      })) ?? [],
  };
};

const buildBenchmarkPackHealth = async (
  repository: Repository,
  benchmarkPackId: string,
): Promise<{
  packHealth: DashboardBenchmarkResponse["pack_health"];
  warnings: DashboardBenchmarkResponse["warnings"];
}> => {
  const models = await repository.listModelVersions();
  const modelVersions = selectDefaultModelVersions(models);

  if (!modelVersions.length) {
    return {
      packHealth: buildPackHealthFallback(
        benchmarkPackId,
        "No registered model versions are available yet for benchmark composition.",
      ),
      warnings: [
        {
          severity: "high",
          title: "No models are available for benchmark composition",
          detail:
            "The benchmark desk cannot compose a pack because no active or fallback model versions are registered yet.",
          recommendation:
            "Register at least one active model family before relying on benchmark history or regression signals.",
        },
      ],
    };
  }

  try {
    const composition = await composeHistoricalBenchmarkPack(repository, {
      benchmark_pack_id: benchmarkPackId,
      model_versions: modelVersions,
      allowed_case_qualities: ["reviewed", "high_confidence"],
      strict_quotas: false,
    } satisfies BenchmarkPackComposeRequest);

    const warnings: DashboardBenchmarkResponse["warnings"] = [];

    if (!composition.quotas_met) {
      warnings.push({
        severity: "high",
        title: "Core benchmark pack is missing required domains",
        detail: `Missing quota coverage in ${composition.missing_domains
          .map((item) => `${item.domain} (${item.selected_cases}/${item.minimum_cases})`)
          .join(", ")}.`,
        recommendation:
          "Fill the thin benchmark domains before treating mixed-pack replay and regression signals as fully trustworthy.",
      });
    } else if (composition.selected_case_count < composition.target_case_count) {
      warnings.push({
        severity: "medium",
        title: "Core benchmark pack is underfilled",
        detail: `The selected pack has ${composition.selected_case_count} case(s) against a target of ${composition.target_case_count}.`,
        recommendation:
          "Keep adding reviewed cases in covered domains so the mixed benchmark has more depth and less sampling fragility.",
      });
    }

    return {
      packHealth: {
        pack_id: composition.pack_id,
        label: composition.label,
        description: composition.description,
        target_case_count: composition.target_case_count,
        selected_case_count: composition.selected_case_count,
        quotas_met: composition.quotas_met,
        allowed_case_qualities: composition.allowed_case_qualities,
        domain_counts: composition.domain_counts,
        missing_domains: composition.missing_domains,
      },
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Benchmark composition failed.";

    return {
      packHealth: buildPackHealthFallback(benchmarkPackId, message),
      warnings: [
        {
          severity: "high",
          title: "Benchmark pack could not be composed",
          detail: message,
          recommendation:
            "Import more reviewed historical cases into the library or relax the pack filters before using this benchmark view for promotion decisions.",
        },
      ],
    };
  }
};

export const buildDashboardBenchmark = async (
  repository: Repository,
  options: {
    benchmark_pack_id?: string;
  } = {},
): Promise<DashboardBenchmarkResponse> => {
  const benchmarkPackId = options.benchmark_pack_id ?? "core_benchmark_v1";
  const [
    snapshots,
    walkForwardSnapshots,
    trustRefreshes,
    coverageReport,
    gapReport,
    promotionEvaluations,
    packHealthData,
  ] = await Promise.all([
    repository.listBenchmarkReplaySnapshots({
      limit: 12,
      benchmark_pack_id: benchmarkPackId,
    }),
    repository.listWalkForwardReplaySnapshots({
      limit: 12,
      benchmark_pack_id: benchmarkPackId,
    }),
    repository.listBenchmarkTrustRefreshes({
      limit: 12,
      benchmark_pack_id: benchmarkPackId,
    }),
    buildHistoricalLibraryCoverageReport(repository, { top: 6 }),
    buildHistoricalLibraryGapReport(repository),
    repository.listPromotionEvaluations({
      limit: 20,
      benchmark_pack_id: benchmarkPackId,
      has_walk_forward: true,
    }),
    buildBenchmarkPackHealth(repository, benchmarkPackId),
  ]);
  const trendReport = buildBenchmarkTrendReportFromSnapshots(benchmarkPackId, snapshots);
  const benchmarkStabilityReport = buildBenchmarkStabilityReportFromSnapshots(
    benchmarkPackId,
    snapshots,
  );
  const regressionReport = buildBenchmarkRegressionReportFromTrend(trendReport);
  const walkForwardTrendReport = buildWalkForwardTrendReportFromSnapshots(
    benchmarkPackId,
    walkForwardSnapshots,
  );
  const walkForwardRegressionReport =
    buildWalkForwardRegressionReportFromTrend(walkForwardTrendReport);
  const walkForwardRegimeTrendReport = buildWalkForwardRegimeTrendReportFromSnapshots(
    benchmarkPackId,
    walkForwardSnapshots,
  );
  const walkForwardRegimeRegressionReport =
    buildWalkForwardRegimeRegressionReportFromTrend(walkForwardRegimeTrendReport);
  const growthAlertReport = await buildGrowthPressureAlertReport(repository, {
    benchmark_pack_id: benchmarkPackId,
    benchmark_regression_report: regressionReport,
    walk_forward_regression_report: walkForwardRegressionReport,
    walk_forward_regime_regression_report: walkForwardRegimeRegressionReport,
  });

  const recentSnapshots = snapshots.sort(sortNewestFirst).slice(0, 6);
  const recentWalkForwardSnapshots = walkForwardSnapshots.sort(sortNewestFirst).slice(0, 6);
  const recentTrustRefreshes = trustRefreshes.sort(sortNewestFirstByGeneratedAt).slice(0, 6);
  const latestSnapshot = recentSnapshots[0] ?? null;
  const latestWalkForwardSnapshot =
    latestWalkForwardSnapshotForPack(walkForwardSnapshots, benchmarkPackId);
  const latestTrustRefresh = recentTrustRefreshes[0] ?? null;
  const recentWalkForwardPromotions = promotionEvaluations
    .sort(sortNewestFirstByCreatedAt)
    .slice(0, 6)
    .map((evaluation) => ({
      candidate_model_version: evaluation.candidate_model_version,
      baseline_model_version: evaluation.baseline_model_version,
      created_at: evaluation.created_at,
      promotion_passed: evaluation.passed,
      walk_forward_passed: evaluation.walk_forward!.passed,
      benchmark_pack_id: evaluation.walk_forward!.benchmark_pack_id,
      case_pack: evaluation.case_pack,
      window_count: evaluation.walk_forward!.window_count,
      eligible_case_count: evaluation.walk_forward!.eligible_case_count,
      eligible_regime_count: evaluation.walk_forward!.eligible_regime_count,
      eligible_high_confidence_case_count:
        evaluation.walk_forward!.eligible_high_confidence_case_count,
      depth_requirements_met: evaluation.walk_forward!.depth_requirements_met,
      deltas: evaluation.walk_forward!.deltas,
      reasons: evaluation.walk_forward!.reasons,
    }));
  const regressionByFamily = new Map(
    regressionReport.alerts.map((alert) => [alert.family, alert] as const),
  );
  const growthAlertByFamily = new Map(
    growthAlertReport.alerts.map((alert) => [alert.family, alert] as const),
  );

  const familyComparisons = trendReport.families
    .map((family) => {
      const regression = regressionByFamily.get(family.family) ?? null;
      const growthAlert = growthAlertByFamily.get(family.family) ?? null;

      return {
        family: family.family,
        latest_model_version: family.latest_model_version,
        current_average_total_score: family.current_average_total_score,
        score_delta: family.score_delta,
        current_direction_accuracy: family.current_direction_accuracy,
        direction_accuracy_delta: family.direction_accuracy_delta,
        current_wrong_rate: family.current_wrong_rate,
        wrong_rate_delta: family.wrong_rate_delta,
        current_calibration_gap: family.current_calibration_gap,
        calibration_gap_delta: family.calibration_gap_delta,
        trend_signal: family.trend_signal,
        regression_severity: regression?.severity ?? null,
        regression_streak: regression?.regression_streak ?? 0,
        baseline_score_delta: regression?.score_delta ?? null,
        baseline_direction_accuracy_delta: regression?.direction_accuracy_delta ?? null,
        baseline_wrong_rate_delta: regression?.wrong_rate_delta ?? null,
        baseline_calibration_gap_delta: regression?.calibration_gap_delta ?? null,
        growth_alert_severity: growthAlert?.severity ?? null,
        growth_alert_status: growthAlert?.status ?? null,
        alert_signals: [
          ...(regression?.signals ?? []),
          ...(growthAlert?.signals ?? []),
        ].slice(0, 4),
      };
    })
    .sort((left, right) => {
      const leftSeverity = left.regression_severity ?? left.growth_alert_severity;
      const rightSeverity = right.regression_severity ?? right.growth_alert_severity;
      const severityDelta =
        (rightSeverity ? severityRank[rightSeverity] : 0) -
        (leftSeverity ? severityRank[leftSeverity] : 0);

      if (severityDelta !== 0) {
        return severityDelta;
      }

      if ((right.current_average_total_score ?? 0) !== (left.current_average_total_score ?? 0)) {
        return (right.current_average_total_score ?? 0) - (left.current_average_total_score ?? 0);
      }

      return left.family.localeCompare(right.family);
    });

  const warnings: DashboardBenchmarkResponse["warnings"] = [
    ...packHealthData.warnings,
  ];

  if (!latestSnapshot) {
    warnings.push({
      severity: "medium",
      title: "No benchmark snapshots have been captured yet",
      detail:
        "The benchmark desk has pack composition data, but no saved replay checkpoints to compare over time.",
      recommendation:
        "Capture a benchmark snapshot or let the scheduled evolution cycle run so this desk can show trend lines and regressions.",
    });
  }

  if (!latestWalkForwardSnapshot && coverageReport.total_cases >= 12) {
    warnings.push({
      severity: "medium",
      title: "No timed walk-forward checkpoint has been captured yet",
      detail:
        "Static replay history exists, but there is no saved time-ordered validation checkpoint for this benchmark pack yet.",
      recommendation:
        "Capture a walk-forward snapshot or let scheduled evolution run so timed validation shapes the benchmark desk.",
    });
  }

  if (!latestTrustRefresh && coverageReport.total_cases >= 6) {
    warnings.push({
      severity: "medium",
      title: "No benchmark trust refresh has been recorded yet",
      detail:
        "The benchmark can replay cases, but no saved trust-refresh runs have shown whether stronger high-confidence memory is reducing warnings over time.",
      recommendation:
        "Run a benchmark trust refresh or let the scheduled evolution cycle execute one so the desk can track memory hardening over time.",
    });
  }

  if (!recentWalkForwardPromotions.length && coverageReport.total_cases >= 12) {
    warnings.push({
      severity: "medium",
      title: "No walk-forward promotion checks have been recorded yet",
      detail:
        "Static replay gates are available, but no timed promotion checks have shown whether candidates survive time-ordered validation on this benchmark pack.",
      recommendation:
        "Run promotion gates with walk-forward enabled so hardening decisions reflect both mixed replay and time-ordered validation.",
    });
  }

  if (coverageReport.high_confidence_cases === 0 && coverageReport.total_cases >= 6) {
    warnings.push({
      severity: "medium",
      title: "Benchmark trust is softer without high-confidence cases",
      detail:
        "The library has reviewed memory, but none of it is marked high confidence yet, which weakens the most trusted benchmark core.",
      recommendation:
        "Promote the cleanest reviewed cases to high confidence after adjudication so the mixed benchmark has a harder center.",
    });
  }

  if (regressionReport.counts.high > 0) {
    warnings.push({
      severity: "high",
      title: "High-severity benchmark regressions are active",
      detail: `${regressionReport.counts.high} family or families are trailing their strongest prior mixed-benchmark baseline.`,
      recommendation:
        "Treat these families as real growth pressure and review diagnostics before allowing the next shell to harden.",
    });
  } else if (regressionReport.counts.medium > 0) {
    warnings.push({
      severity: "medium",
      title: "Mixed benchmark is showing family slippage",
      detail: `${regressionReport.counts.medium} family or families are softening against their prior core-benchmark checkpoints.`,
      recommendation:
        "Keep these families under replay watch and let the next evolution cycle decide whether a new shell should be prepared.",
    });
  }

  if (walkForwardRegressionReport.counts.high > 0) {
    warnings.push({
      severity: "high",
      title: "High-severity walk-forward regressions are active",
      detail: `${walkForwardRegressionReport.counts.high} family or families are trailing their strongest prior timed-validation baseline.`,
      recommendation:
        "Treat these families as time-ordered growth pressure and review diagnostics before hardening another shell.",
    });
  } else if (walkForwardRegressionReport.counts.medium > 0) {
    warnings.push({
      severity: "medium",
      title: "Timed validation is showing family slippage",
      detail: `${walkForwardRegressionReport.counts.medium} family or families are softening across saved walk-forward checkpoints.`,
      recommendation:
        "Keep these families under timed-validation watch and use the next evolution cycle to decide whether a new shell is warranted.",
    });
  }

  if (walkForwardRegimeRegressionReport.counts.high > 0) {
    warnings.push({
      severity: "high",
      title: "High-severity regime-specific timed regressions are active",
      detail: `${walkForwardRegimeRegressionReport.counts.high} family-regime slice(s) are trailing their strongest prior timed baseline.`,
      recommendation:
        "Treat these weak regimes as targeted growth pressure and strengthen diagnostics or memory in those market states before trusting the next shell there.",
    });
  } else if (walkForwardRegimeRegressionReport.counts.medium > 0) {
    warnings.push({
      severity: "medium",
      title: "Timed validation is softening in specific regimes",
      detail: `${walkForwardRegimeRegressionReport.counts.medium} family-regime slice(s) are regressing even if the aggregate timed score still looks acceptable.`,
      recommendation:
        "Use regime-specific timed weakness to guide diagnostics, memory hardening, and shell review instead of relying only on aggregate family averages.",
    });
  }

  for (const alert of gapReport.alerts
    .filter((item) =>
      item.category === "pack_coverage" ||
      item.category === "high_confidence_gap" ||
      item.category === "review_backlog" ||
      item.category === "review_assignment",
    )
    .slice(0, 3)) {
    warnings.push({
      severity: alert.severity,
      title: alert.title,
      detail: alert.rationale,
      recommendation: alert.recommendation,
    });
  }

  const sortedWarnings = dedupeWarnings(warnings).sort((left, right) => {
    if (severityRank[right.severity] !== severityRank[left.severity]) {
      return severityRank[right.severity] - severityRank[left.severity];
    }

    return left.title.localeCompare(right.title);
  });

  return dashboardBenchmarkResponseSchema.parse({
    generated_at: new Date().toISOString(),
    benchmark_pack_id: benchmarkPackId,
    latest_snapshot: latestSnapshot ? toSnapshotPreview(latestSnapshot) : null,
    recent_snapshots: recentSnapshots.map(toSnapshotPreview),
    latest_walk_forward_snapshot: latestWalkForwardSnapshot,
    recent_walk_forward_snapshots: recentWalkForwardSnapshots,
    latest_trust_refresh: latestTrustRefresh,
    recent_trust_refreshes: recentTrustRefreshes,
    pack_health: packHealthData.packHealth,
    coverage_summary: {
      total_cases: coverageReport.total_cases,
      reviewed_cases: coverageReport.reviewed_cases,
      high_confidence_cases: coverageReport.high_confidence_cases,
      needs_review_count: coverageReport.needs_review_count,
    },
    family_comparisons: familyComparisons,
    walk_forward_regime_slices: walkForwardRegimeTrendReport.slices.slice(0, 12),
    recent_walk_forward_promotions: recentWalkForwardPromotions,
    regressions: regressionReport.alerts.slice(0, 8),
    walk_forward_regressions: walkForwardRegressionReport.alerts.slice(0, 8),
    walk_forward_regime_regressions: walkForwardRegimeRegressionReport.alerts.slice(0, 8),
    benchmark_stability: benchmarkStabilityReport,
    growth_alerts: growthAlertReport.alerts.slice(0, 8),
    warnings: sortedWarnings.slice(0, 8),
  });
};
