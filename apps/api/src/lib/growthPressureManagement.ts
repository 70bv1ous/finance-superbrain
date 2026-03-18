import { randomUUID } from "node:crypto";

import { buildHistoricalReplayPack } from "../data/historicalBackfillCases.js";

import { applyHistoricalReplayTuning } from "./applyHistoricalReplayTuning.js";
import {
  buildGrowthPressureRegressionSignals,
  evaluateGrowthPressureAlert,
  unresolvedGrowthPressureStatuses,
} from "./growthPressureAlerts.js";
import { buildEvolutionTrendReport } from "./evolutionTrendReport.js";
import { buildHistoricalReplayDiagnostics } from "./historicalReplayDiagnostics.js";
import { resolveGrowthPressurePolicy } from "./growthPressurePolicies.js";
import type { Repository } from "./repository.types.js";

import type {
  GrowthPressureActionPlan,
  GrowthPressureMonitoringResult,
  StoredGrowthPressureAlert,
} from "@finance-superbrain/schemas";

type FamilyTrend = Awaited<ReturnType<typeof buildEvolutionTrendReport>>["families"][number];

const activeAlertStatuses = unresolvedGrowthPressureStatuses;

const addHours = (isoTimestamp: string, hours: number) =>
  new Date(new Date(isoTimestamp).getTime() + hours * 60 * 60 * 1000).toISOString();

const truncate = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : value.slice(0, maxLength);

const syntheticFamilyTrendFromRegression = (
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

const benchmarkPersistenceBonus = (regressionStreak: number | null | undefined) => {
  if (!regressionStreak || regressionStreak <= 1) {
    return 0;
  }

  return Math.min(2, regressionStreak - 1);
};

const buildPressureCandidateModelVersion = async (
  repository: Repository,
  sourceModelVersion: string,
) => {
  const models = await repository.listModelVersions();
  const base = sourceModelVersion.replace(/-pressure-\d+$/i, "");
  const prefix = `${base}-pressure-`;
  const sequence =
    models
      .filter((model) => model.model_version.startsWith(prefix))
      .map((model) => Number(model.model_version.slice(prefix.length)))
      .filter((value) => Number.isInteger(value) && value > 0)
      .reduce((max, value) => Math.max(max, value), 0) + 1;

  return truncate(`${base}-pressure-${sequence}`, 80);
};

const latestPlanForAlert = (
  plans: GrowthPressureActionPlan[],
  actionType?: GrowthPressureActionPlan["action_type"],
) =>
  [...plans]
    .filter((plan) => (actionType ? plan.action_type === actionType : true))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null;

const hydrateAlertRecord = (
  nextAlert: Awaited<ReturnType<typeof evaluateGrowthPressureAlert>>,
  existing: StoredGrowthPressureAlert | null,
  now: string,
): StoredGrowthPressureAlert => ({
  id: existing?.id ?? randomUUID(),
  family: nextAlert!.family,
  policy_family: nextAlert!.policy_family,
  severity: nextAlert!.severity,
  status: nextAlert!.status,
  active_model_version: nextAlert!.active_model_version,
  generation_depth: nextAlert!.generation_depth,
  pass_rate: nextAlert!.pass_rate,
  average_total_score: nextAlert!.average_total_score,
  calibration_gap: nextAlert!.calibration_gap,
  trend_signal: nextAlert!.trend_signal,
  persistence_count:
    existing && (existing.last_triggered_at ?? "") < now
      ? existing.persistence_count + 1
      : existing?.persistence_count ?? 1,
  first_triggered_at: existing?.first_triggered_at ?? now,
  last_triggered_at: now,
  snoozed_until: nextAlert!.snoozed_until,
  acknowledged_at: nextAlert!.acknowledged_at,
  handled_at: nextAlert!.handled_at,
  resolved_at: null,
  planned_action: existing?.planned_action ?? null,
  plan_status: existing?.plan_status ?? null,
  signals: nextAlert!.signals,
  recommended_action: nextAlert!.recommended_action,
  created_at: existing?.created_at ?? now,
  updated_at: now,
});

const resolveInactiveAlerts = async (
  repository: Repository,
  activeFamilies: Set<string>,
  now: string,
) => {
  const resolvedAlertIds: string[] = [];
  const activeAlerts = await repository.listGrowthPressureAlerts({
    limit: 200,
    statuses: activeAlertStatuses,
  });

  for (const alert of activeAlerts) {
    if (activeFamilies.has(alert.family)) {
      continue;
    }

    await repository.saveGrowthPressureAlert({
      ...alert,
      status: "resolved",
      resolved_at: now,
      planned_action: alert.planned_action,
      plan_status: alert.plan_status,
      updated_at: now,
    });
    resolvedAlertIds.push(alert.id);
  }

  return resolvedAlertIds;
};

const saveActionPlan = async (
  repository: Repository,
  plan: GrowthPressureActionPlan,
) => repository.saveGrowthPressureActionPlan(plan);

const buildDiagnosticsResult = async (
  repository: Repository,
  modelVersion: string,
  casePack: string,
) => {
  const diagnostics = await buildHistoricalReplayDiagnostics(repository, buildHistoricalReplayPack([
    modelVersion,
  ], casePack));
  const model = diagnostics.models[0];

  return {
    case_pack: diagnostics.case_pack,
    case_count: diagnostics.case_count,
    weakest_themes: model?.weakest_themes.slice(0, 3) ?? [],
    weakest_tags: model?.weakest_tags.slice(0, 3) ?? [],
    frequent_failure_tags: model?.frequent_failure_tags.slice(0, 3) ?? [],
    recommended_patch: model?.recommended_tuning.feature_flags_patch ?? {},
  };
};

const executeActionPlan = async (
  repository: Repository,
  plan: GrowthPressureActionPlan,
) => {
  const now = new Date().toISOString();

  if (plan.action_type === "notify") {
    return saveActionPlan(repository, {
      ...plan,
      status: "executed",
      result: {
        notified: true,
      },
      executed_at: now,
      updated_at: now,
    });
  }

  if (plan.action_type === "schedule_molt_review") {
    return saveActionPlan(repository, {
      ...plan,
      status: "executed",
      result: {
        review_scheduled: true,
      },
      executed_at: now,
      updated_at: now,
    });
  }

  if (plan.action_type === "run_replay_diagnostics") {
    const sourceModelVersion =
      typeof plan.payload.source_model_version === "string"
        ? plan.payload.source_model_version
        : plan.active_model_version;

    if (!sourceModelVersion) {
      return saveActionPlan(repository, {
        ...plan,
        status: "skipped",
        result: {
          reason: "no_active_model_version",
        },
        updated_at: now,
      });
    }

    const casePack =
      typeof plan.payload.case_pack === "string" ? plan.payload.case_pack : "macro_plus_v1";

    return saveActionPlan(repository, {
      ...plan,
      status: "executed",
      result: await buildDiagnosticsResult(repository, sourceModelVersion, casePack),
      executed_at: now,
      updated_at: now,
    });
  }

  if (plan.action_type === "generate_candidate_shell") {
    const sourceModelVersion =
      typeof plan.payload.source_model_version === "string"
        ? plan.payload.source_model_version
        : plan.active_model_version;

    if (!sourceModelVersion) {
      return saveActionPlan(repository, {
        ...plan,
        status: "skipped",
        result: {
          reason: "no_active_model_version",
        },
        updated_at: now,
      });
    }

    const casePack =
      typeof plan.payload.case_pack === "string" ? plan.payload.case_pack : "macro_plus_v1";
    const targetModelVersion =
      plan.candidate_model_version ?? (await buildPressureCandidateModelVersion(repository, sourceModelVersion));
    const tuningResult = await applyHistoricalReplayTuning(repository, sourceModelVersion, {
      cases: buildHistoricalReplayPack([sourceModelVersion], casePack).cases,
      target_model_version: targetModelVersion,
      label_suffix: "Pressure shell",
      status: "experimental",
      use_pattern_priors: true,
    });

    return saveActionPlan(repository, {
      ...plan,
      status: "executed",
      candidate_model_version: tuningResult.saved_model.model_version,
      result: {
        generated_model_version: tuningResult.saved_model.model_version,
        status: tuningResult.saved_model.status,
        replay_case_pack: casePack,
      },
      executed_at: now,
      updated_at: now,
    });
  }

  return saveActionPlan(repository, {
    ...plan,
    status: "skipped",
    result: {
      reason: "unsupported_action_type",
    },
    updated_at: now,
  });
};

const maybeCreateActionPlan = async (
  repository: Repository,
  alert: StoredGrowthPressureAlert,
  trend: FamilyTrend,
  now: string,
  regressionStreak?: number,
) => {
  const policy = await resolveGrowthPressurePolicy(repository, alert.policy_family, now);
  const plans = await repository.listGrowthPressureActionPlans({
    family: alert.family,
    limit: 50,
  });
  const alertPlans = plans.filter((plan) => plan.alert_id === alert.id);
  const createdPlans: GrowthPressureActionPlan[] = [];
  const effectivePersistenceCount =
    alert.persistence_count + benchmarkPersistenceBonus(regressionStreak);

  if (alert.status === "snoozed" && alert.snoozed_until && alert.snoozed_until > now) {
    return createdPlans;
  }

  if (alert.status === "handled") {
    return createdPlans;
  }

  if (!latestPlanForAlert(alertPlans, "notify")) {
    createdPlans.push(
      await executeActionPlan(repository, {
        id: randomUUID(),
        alert_id: alert.id,
        family: alert.family,
        active_model_version: alert.active_model_version,
        action_type: "notify",
        status: "pending",
        requires_operator_approval: false,
        rationale: "A new growth-pressure episode was opened for this family.",
        payload: {
          severity: alert.severity,
        },
        result: null,
        candidate_model_version: null,
        operator_note: null,
        approved_at: null,
        blocked_at: null,
        executed_at: null,
        created_at: now,
        updated_at: now,
      }),
    );
  }

  if (
    effectivePersistenceCount >= policy.persistence.medium_persistent_cycles &&
    policy.actions.auto_queue_diagnostics &&
    !latestPlanForAlert(alertPlans, "run_replay_diagnostics")
  ) {
    createdPlans.push(
      await executeActionPlan(repository, {
        id: randomUUID(),
        alert_id: alert.id,
        family: alert.family,
        active_model_version: alert.active_model_version,
        action_type: "run_replay_diagnostics",
        status: "pending",
        requires_operator_approval: false,
        rationale:
          regressionStreak && regressionStreak >= 2
            ? `Growth pressure has persisted long enough to justify replay diagnostics, with a validation regression streak of ${regressionStreak}.`
            : "Growth pressure has persisted long enough to justify replay diagnostics.",
        payload: {
          source_model_version: alert.active_model_version ?? trend.active_model_version,
          case_pack: policy.actions.diagnostics_case_pack,
        },
        result: null,
        candidate_model_version: null,
        operator_note: null,
        approved_at: null,
        blocked_at: null,
        executed_at: null,
        created_at: now,
        updated_at: now,
      }),
    );
  }

  if (
    alert.severity === "high" &&
    effectivePersistenceCount >= policy.persistence.high_persistent_cycles &&
    policy.actions.auto_schedule_molt_review &&
    !latestPlanForAlert(alertPlans, "schedule_molt_review")
  ) {
    createdPlans.push(
      await executeActionPlan(repository, {
        id: randomUUID(),
        alert_id: alert.id,
        family: alert.family,
        active_model_version: alert.active_model_version,
        action_type: "schedule_molt_review",
        status: "pending",
        requires_operator_approval: false,
        rationale:
          regressionStreak && regressionStreak >= 2
            ? `High-severity persistent pressure merits a governed molt review, reinforced by a ${regressionStreak}-checkpoint validation regression streak.`
            : "High-severity persistent pressure merits a governed molt review.",
        payload: {
          severity: alert.severity,
        },
        result: null,
        candidate_model_version: null,
        operator_note: null,
        approved_at: null,
        blocked_at: null,
        executed_at: null,
        created_at: now,
        updated_at: now,
      }),
    );
  }

  const existingCandidatePlan = latestPlanForAlert(alertPlans, "generate_candidate_shell");
  if (
    alert.severity === "high" &&
    effectivePersistenceCount >= policy.persistence.candidate_generation_cycles &&
    !existingCandidatePlan
  ) {
    const candidateModelVersion = alert.active_model_version
      ? await buildPressureCandidateModelVersion(repository, alert.active_model_version)
      : null;
    const plan = await saveActionPlan(repository, {
      id: randomUUID(),
      alert_id: alert.id,
      family: alert.family,
      active_model_version: alert.active_model_version,
      action_type: "generate_candidate_shell",
      status: policy.actions.require_operator_approval_for_candidate_generation
        ? "pending"
        : "approved",
      requires_operator_approval: policy.actions.require_operator_approval_for_candidate_generation,
      rationale:
        regressionStreak && regressionStreak >= 2
          ? `High-severity pressure has persisted across enough cycles to justify preparing a new candidate shell, with validation regressing for ${regressionStreak} checkpoints.`
          : "High-severity pressure has persisted across enough cycles to justify preparing a new candidate shell.",
      payload: {
        source_model_version: alert.active_model_version ?? trend.active_model_version,
        case_pack: policy.actions.diagnostics_case_pack,
      },
      result: null,
      candidate_model_version: candidateModelVersion,
      operator_note: null,
      approved_at: null,
      blocked_at: null,
      executed_at: null,
      created_at: now,
      updated_at: now,
    });

    createdPlans.push(
      policy.actions.require_operator_approval_for_candidate_generation
        ? plan
        : await executeActionPlan(repository, {
            ...plan,
            approved_at: now,
          }),
    );
  }

  return createdPlans;
};

const syncAlertPlanningState = async (
  repository: Repository,
  alert: StoredGrowthPressureAlert,
  familyPlans: GrowthPressureActionPlan[],
  now: string,
) => {
  const latestPlan = latestPlanForAlert(familyPlans.filter((plan) => plan.alert_id === alert.id));

  return repository.saveGrowthPressureAlert({
    ...alert,
    planned_action: latestPlan?.action_type ?? null,
    plan_status: latestPlan?.status ?? null,
    updated_at: now,
  });
};

export const monitorGrowthPressure = async (
  repository: Repository,
  input: { as_of?: string; benchmark_pack_id?: string } = {},
): Promise<GrowthPressureMonitoringResult> => {
  const now = input.as_of ?? new Date().toISOString();
  const [trends, regressions] = await Promise.all([
    buildEvolutionTrendReport(repository),
    buildGrowthPressureRegressionSignals(repository, {
      benchmark_pack_id: input.benchmark_pack_id,
    }),
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
  const nextAlerts = (
    await Promise.all(
      [...familyNames].map((familyName) =>
        evaluateGrowthPressureAlert(
          repository,
          trendByFamily.get(familyName) ??
            syntheticFamilyTrendFromRegression(
              benchmarkRegressions.alerts.find((alert) => alert.family === familyName) ??
                walkForwardRegressions.alerts.find((alert) => alert.family === familyName) ??
                walkForwardRegimeRegressions.alerts.find((alert) => alert.family === familyName) ?? {
                  family: familyName,
                  model_version: null,
                },
            ),
          now,
          regressionByFamily.get(familyName) ?? null,
        ),
      ),
    )
  ).filter((item): item is NonNullable<Awaited<ReturnType<typeof evaluateGrowthPressureAlert>>> => item !== null);
  const activeFamilies = new Set(nextAlerts.map((alert) => alert.family));
  const resolvedAlertIds = await resolveInactiveAlerts(repository, activeFamilies, now);
  const persistedAlerts: StoredGrowthPressureAlert[] = [];
  const createdPlans: GrowthPressureActionPlan[] = [];

  for (const nextAlert of nextAlerts) {
    const existing = nextAlert.id ? await repository.getGrowthPressureAlert(nextAlert.id) : null;
    const persisted = await repository.saveGrowthPressureAlert(
      hydrateAlertRecord(nextAlert, existing, now),
    );
    persistedAlerts.push(persisted);

    const trend = trends.families.find((item) => item.family === persisted.family);
    const effectiveTrend =
      trend ??
      syntheticFamilyTrendFromRegression(
        benchmarkRegressions.alerts.find((alert) => alert.family === persisted.family) ??
          walkForwardRegressions.alerts.find((alert) => alert.family === persisted.family) ??
          walkForwardRegimeRegressions.alerts.find((alert) => alert.family === persisted.family) ?? {
            family: persisted.family,
            model_version: persisted.active_model_version,
          },
      );

    const regressionSignal = regressionByFamily.get(persisted.family);
    const plans = await maybeCreateActionPlan(
      repository,
      persisted,
      effectiveTrend,
      now,
      regressionSignal?.regression_streak,
    );
    createdPlans.push(...plans);
    const familyPlans = await repository.listGrowthPressureActionPlans({
      family: persisted.family,
      limit: 50,
    });
    const synced = await syncAlertPlanningState(repository, persisted, familyPlans, now);
    persistedAlerts[persistedAlerts.length - 1] = synced;
  }

  return {
    as_of: now,
    alerts: persistedAlerts.map((alert) => ({
      id: alert.id,
      family: alert.family,
      policy_family: alert.policy_family,
      severity: alert.severity,
      status: alert.status,
      active_model_version: alert.active_model_version,
      generation_depth: alert.generation_depth,
      pass_rate: alert.pass_rate,
      average_total_score: alert.average_total_score,
      calibration_gap: alert.calibration_gap,
      trend_signal: alert.trend_signal,
      persistence_count: alert.persistence_count,
      first_triggered_at: alert.first_triggered_at,
      last_triggered_at: alert.last_triggered_at,
      snoozed_until: alert.snoozed_until,
      acknowledged_at: alert.acknowledged_at,
      handled_at: alert.handled_at,
      resolved_at: alert.resolved_at,
      planned_action: alert.planned_action,
      plan_status: alert.plan_status,
      signals: alert.signals,
      recommended_action: alert.recommended_action,
    })),
    resolved_alert_ids: resolvedAlertIds,
    action_plans: createdPlans,
    counts: {
      open: persistedAlerts.filter((alert) => alert.status === "open").length,
      acknowledged: persistedAlerts.filter((alert) => alert.status === "acknowledged").length,
      snoozed: persistedAlerts.filter((alert) => alert.status === "snoozed").length,
      handled: persistedAlerts.filter((alert) => alert.status === "handled").length,
      resolved: resolvedAlertIds.length,
      plans_created: createdPlans.length,
      plans_pending: createdPlans.filter((plan) => plan.status === "pending").length,
      plans_executed: createdPlans.filter((plan) => plan.status === "executed").length,
      plans_blocked: createdPlans.filter((plan) => plan.status === "blocked").length,
      plans_skipped: createdPlans.filter((plan) => plan.status === "skipped").length,
    },
  };
};

export const acknowledgeGrowthPressureAlert = async (
  repository: Repository,
  alertId: string,
) => {
  const alert = await repository.getGrowthPressureAlert(alertId);

  if (!alert) {
    throw new Error("Growth-pressure alert not found.");
  }

  const now = new Date().toISOString();
  return repository.saveGrowthPressureAlert({
    ...alert,
    status: "acknowledged",
    acknowledged_at: now,
    updated_at: now,
  });
};

export const snoozeGrowthPressureAlert = async (
  repository: Repository,
  alertId: string,
  durationHours: number,
) => {
  const alert = await repository.getGrowthPressureAlert(alertId);

  if (!alert) {
    throw new Error("Growth-pressure alert not found.");
  }

  const now = new Date().toISOString();
  return repository.saveGrowthPressureAlert({
    ...alert,
    status: "snoozed",
    snoozed_until: addHours(now, durationHours),
    updated_at: now,
  });
};

export const handleGrowthPressureAlert = async (
  repository: Repository,
  alertId: string,
) => {
  const alert = await repository.getGrowthPressureAlert(alertId);

  if (!alert) {
    throw new Error("Growth-pressure alert not found.");
  }

  const now = new Date().toISOString();
  return repository.saveGrowthPressureAlert({
    ...alert,
    status: "handled",
    handled_at: now,
    updated_at: now,
  });
};

export const approveGrowthPressureActionPlan = async (
  repository: Repository,
  actionPlanId: string,
  operatorNote?: string,
) => {
  const plan = await repository.getGrowthPressureActionPlan(actionPlanId);

  if (!plan) {
    throw new Error("Growth-pressure action plan not found.");
  }

  const now = new Date().toISOString();
  const approved = await repository.saveGrowthPressureActionPlan({
    ...plan,
    status: "approved",
    operator_note: operatorNote ?? plan.operator_note,
    approved_at: now,
    updated_at: now,
  });

  const executed =
    approved.action_type === "generate_candidate_shell"
      ? await executeActionPlan(repository, approved)
      : await executeActionPlan(repository, {
          ...approved,
          approved_at: approved.approved_at ?? now,
        });

  const alert = await repository.getGrowthPressureAlert(executed.alert_id);
  if (alert) {
    await repository.saveGrowthPressureAlert({
      ...alert,
      planned_action: executed.action_type,
      plan_status: executed.status,
      updated_at: now,
    });
  }

  return executed;
};

export const blockGrowthPressureActionPlan = async (
  repository: Repository,
  actionPlanId: string,
  operatorNote?: string,
) => {
  const plan = await repository.getGrowthPressureActionPlan(actionPlanId);

  if (!plan) {
    throw new Error("Growth-pressure action plan not found.");
  }

  const now = new Date().toISOString();
  const blocked = await repository.saveGrowthPressureActionPlan({
    ...plan,
    status: "blocked",
    operator_note: operatorNote ?? plan.operator_note,
    blocked_at: now,
    updated_at: now,
  });

  const alert = await repository.getGrowthPressureAlert(blocked.alert_id);
  if (alert) {
    await repository.saveGrowthPressureAlert({
      ...alert,
      planned_action: blocked.action_type,
      plan_status: blocked.status,
      updated_at: now,
    });
  }

  return blocked;
};
