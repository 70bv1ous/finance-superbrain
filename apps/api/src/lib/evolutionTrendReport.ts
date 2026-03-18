import { evolutionTrendReportSchema } from "@finance-superbrain/schemas";
import type {
  EvolutionTrendReport,
  LineageSnapshot,
  ModelLineageReport,
  StoredPromotionEvaluation,
} from "@finance-superbrain/schemas";

import { buildModelLineageReport } from "./modelLineageReport.js";
import type { Repository } from "./repository.types.js";

type FamilyPoint = EvolutionTrendReport["families"][number]["snapshots"][number];
type FamilyTrend = EvolutionTrendReport["families"][number];

const round = (value: number) => Number(value.toFixed(2));

const average = (sum: number, count: number) => (count ? sum / count : 0);

const sortOldestFirst = (left: { as_of: string }, right: { as_of: string }) =>
  left.as_of.localeCompare(right.as_of);

const sortNewestFirst = (left: { created_at: string }, right: { created_at: string }) =>
  right.created_at.localeCompare(left.created_at);

const bestFamily = (
  families: FamilyTrend[],
  selector: (family: FamilyTrend) => number,
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

      if (right.generation_depth !== left.generation_depth) {
        return right.generation_depth - left.generation_depth;
      }

      return left.family.localeCompare(right.family);
    })[0]?.family ?? null;
};

const activeNodeForFamily = (
  family: ModelLineageReport["families"][number],
) => {
  const activeModelVersion = family.active_model_version;

  if (!activeModelVersion) {
    return family.lineage[family.lineage.length - 1] ?? null;
  }

  return family.lineage.find((node) => node.model_version === activeModelVersion) ?? null;
};

const toPoint = (snapshot: LineageSnapshot, family: ModelLineageReport["families"][number]): FamilyPoint => {
  const activeNode = activeNodeForFamily(family);

  return {
    as_of: snapshot.as_of,
    generation_depth: family.generation_depth,
    total_shells: family.total_shells,
    hardened_shells: family.hardened_shells,
    active_model_version: family.active_model_version,
    average_total_score: activeNode?.average_total_score ?? null,
    calibration_gap: activeNode?.calibration_gap ?? null,
  };
};

const recentAndPriorPassRates = (
  evaluations: StoredPromotionEvaluation[],
  family: string,
) => {
  const relevant = evaluations
    .filter((evaluation) => {
      const savedFamily = evaluation.saved_model?.family;
      const inferredFamily =
        savedFamily ??
        evaluation.candidate_model_version.replace(/-?v\d[\w-]*$/i, "") ??
        evaluation.candidate_model_version;
      return inferredFamily === family;
    })
    .sort(sortNewestFirst);

  if (!relevant.length) {
    return {
      recent: null,
      prior: null,
    };
  }

  const windowSize = Math.max(1, Math.min(3, Math.floor(relevant.length / 2) || 1));
  const recent = relevant.slice(0, windowSize);
  const prior = relevant.slice(windowSize, windowSize * 2);

  return {
    recent: round(average(recent.filter((item) => item.passed).length, recent.length)),
    prior: prior.length
      ? round(average(prior.filter((item) => item.passed).length, prior.length))
      : null,
  };
};

const toSyntheticSnapshot = (report: ModelLineageReport): LineageSnapshot => {
  const asOf = report.generated_at;
  return {
    id: `synthetic-${asOf}`,
    as_of: asOf,
    family_count: report.families.length,
    total_shells: report.families.reduce((sum, family) => sum + family.total_shells, 0),
    hardened_shells: report.families.reduce((sum, family) => sum + family.hardened_shells, 0),
    report,
    created_at: asOf,
  };
};

export const buildEvolutionTrendReport = async (
  repository: Repository,
): Promise<EvolutionTrendReport> => {
  const [storedSnapshots, currentReport, promotions] = await Promise.all([
    repository.listLineageSnapshots(24),
    buildModelLineageReport(repository),
    repository.listPromotionEvaluations(500),
  ]);
  const snapshots =
    storedSnapshots.length > 0
      ? [...storedSnapshots].sort(sortOldestFirst)
      : currentReport.families.length
        ? [toSyntheticSnapshot(currentReport)]
        : [];

  if (!snapshots.length) {
    return evolutionTrendReportSchema.parse({
      generated_at: new Date().toISOString(),
      sample_count: 0,
      families: [],
      leaders: {
        by_generation_growth: null,
        by_hardening_growth: null,
        by_score_improvement: null,
      },
    });
  }

  const familyNames = new Set<string>();
  for (const snapshot of snapshots) {
    for (const family of snapshot.report.families) {
      familyNames.add(family.family);
    }
  }

  const families = [...familyNames]
    .map((familyName) => {
      const points = snapshots
        .map((snapshot) => {
          const family = snapshot.report.families.find((item) => item.family === familyName);
          return family ? toPoint(snapshot, family) : null;
        })
        .filter((item): item is FamilyPoint => item !== null);

      if (!points.length) {
        return null;
      }

      const latest = points[points.length - 1]!;
      const prior = points.length > 1 ? points[points.length - 2]! : null;
      const latestFamily = snapshots[snapshots.length - 1]!.report.families.find(
        (item) => item.family === familyName,
      )!;
      const passRates = recentAndPriorPassRates(promotions, familyName);
      const generationDepthDelta = latest.generation_depth - (prior?.generation_depth ?? latest.generation_depth);
      const shellDelta = latest.total_shells - (prior?.total_shells ?? latest.total_shells);
      const hardenedDelta =
        latest.hardened_shells - (prior?.hardened_shells ?? latest.hardened_shells);
      const priorAverageScore = prior?.average_total_score ?? null;
      const priorCalibrationGap = prior?.calibration_gap ?? null;
      const scoreDelta =
        latest.average_total_score !== null && priorAverageScore !== null
          ? round(latest.average_total_score - priorAverageScore)
          : null;
      const calibrationGapDelta =
        latest.calibration_gap !== null && priorCalibrationGap !== null
          ? round(latest.calibration_gap - priorCalibrationGap)
          : null;
      const passRateDelta =
        passRates.recent !== null && passRates.prior !== null
          ? round(passRates.recent - passRates.prior)
          : null;
      const trendSignal =
        points.length === 1
          ? ("emerging" as const)
          : generationDepthDelta > 0 ||
              hardenedDelta > 0 ||
              (scoreDelta !== null && scoreDelta > 0.03)
            ? ("improving" as const)
            : (passRates.recent !== null && passRates.recent < 0.6) ||
                (latest.average_total_score !== null && latest.average_total_score < 0.65) ||
                (latest.calibration_gap !== null && Math.abs(latest.calibration_gap) > 0.1)
              ? ("pressured" as const)
              : ("stable" as const);

      return {
        family: familyName,
        active_model_version: latestFamily.active_model_version,
        generation_depth: latest.generation_depth,
        generation_depth_delta: generationDepthDelta,
        total_shells: latest.total_shells,
        shell_delta: shellDelta,
        hardened_shells: latest.hardened_shells,
        hardened_delta: hardenedDelta,
        current_average_total_score: latest.average_total_score,
        score_delta: scoreDelta,
        current_calibration_gap: latest.calibration_gap,
        calibration_gap_delta: calibrationGapDelta,
        recent_pass_rate: passRates.recent,
        prior_pass_rate: passRates.prior,
        pass_rate_delta: passRateDelta,
        trend_signal: trendSignal,
        snapshots: points.slice(-6),
      };
    })
    .filter((item): item is EvolutionTrendReport["families"][number] => item !== null)
    .sort((left, right) => {
      if (right.generation_depth !== left.generation_depth) {
        return right.generation_depth - left.generation_depth;
      }

      if (right.hardened_shells !== left.hardened_shells) {
        return right.hardened_shells - left.hardened_shells;
      }

      return left.family.localeCompare(right.family);
    });

  return evolutionTrendReportSchema.parse({
    generated_at: new Date().toISOString(),
    sample_count: snapshots.length,
    families,
    leaders: {
      by_generation_growth: bestFamily(families, (family) => family.generation_depth_delta),
      by_hardening_growth: bestFamily(families, (family) => family.hardened_delta),
      by_score_improvement: bestFamily(
        families,
        (family) => family.score_delta ?? Number.NEGATIVE_INFINITY,
      ),
    },
  });
};
