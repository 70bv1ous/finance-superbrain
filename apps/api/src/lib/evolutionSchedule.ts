import { evolutionScheduleConfigSchema, evolutionScheduleRunResponseSchema } from "@finance-superbrain/schemas";
import type {
  EvolutionCycleRequest,
  EvolutionScheduleConfig,
  EvolutionScheduleRunResponse,
  EvolutionScheduleUpdateRequest,
} from "@finance-superbrain/schemas";

import { refreshBenchmarkTrust } from "./benchmarkTrustRefresh.js";
import { runEvolutionCycle } from "./runEvolutionCycle.js";
import type { Repository } from "./repository.types.js";
import type { AppServices } from "./services.js";

const addHours = (isoTimestamp: string, hours: number) =>
  new Date(new Date(isoTimestamp).getTime() + hours * 60 * 60 * 1000).toISOString();

const defaultMoltCycleDefaults = (): EvolutionScheduleConfig["molt_cycle_defaults"] => ({
  case_pack: "macro_plus_v1",
  benchmark_pack_id: "core_benchmark_v1",
  apply_stability_bias: true,
  thresholds: {
    min_average_total_score_delta: 0.01,
    min_direction_accuracy_delta: 0,
    max_wrong_rate_delta: 0,
    min_calibration_alignment_delta: 0,
  },
  promote_on_pass: true,
  promoted_status: "active",
  max_families: 10,
  min_family_pass_rate: 0.65,
  score_floor: 0.68,
  max_abs_calibration_gap: 0.12,
  trigger_on_declining_trend: true,
  require_pattern_priors: true,
  label_suffix: "Molted",
});

const defaultWalkForwardDefaults = (): EvolutionScheduleConfig["walk_forward_defaults"] => ({
  benchmark_pack_id: "core_benchmark_v1",
  allowed_case_qualities: ["reviewed", "high_confidence"],
  training_mode: "expanding",
  min_train_cases: 10,
  test_window_size: 5,
  seed_training_memory: true,
  training_memory_model_version: "walk-forward-memory-v1",
});

const defaultTrustRefreshDefaults = (): EvolutionScheduleConfig["trust_refresh_defaults"] => ({
  benchmark_pack_id: "core_benchmark_v1",
  reviewer: "core-corpus-seed",
  prioritize_gap_regimes: true,
  prioritize_walk_forward_regimes: true,
  seed_limit: 10,
  min_candidate_score: 0.8,
  dry_run: false,
  ingest_reviewed_memory: false,
  model_version: "historical-library-high-confidence-v1",
  strict_quotas: false,
});

export const buildDefaultEvolutionScheduleConfig = (
  now = new Date().toISOString(),
): EvolutionScheduleConfig =>
  evolutionScheduleConfigSchema.parse({
    id: "default",
    enabled: true,
    create_postmortems: true,
    capture_calibration_snapshot: true,
    capture_benchmark_snapshot: true,
    capture_walk_forward_snapshot: true,
    benchmark_pack_id: "core_benchmark_v1",
    run_benchmark_trust_refresh: true,
    run_molt_cycle: true,
    capture_lineage_snapshot: true,
    self_audit_interval_hours: 24,
    benchmark_snapshot_interval_hours: 24,
    walk_forward_snapshot_interval_hours: 24 * 7,
    benchmark_trust_refresh_interval_hours: 24 * 7,
    molt_interval_hours: 24 * 7,
    lineage_snapshot_interval_hours: 24,
    walk_forward_defaults: defaultWalkForwardDefaults(),
    trust_refresh_defaults: defaultTrustRefreshDefaults(),
    molt_cycle_defaults: defaultMoltCycleDefaults(),
    next_self_audit_at: now,
    next_benchmark_snapshot_at: now,
    next_walk_forward_snapshot_at: now,
    next_benchmark_trust_refresh_at: now,
    next_molt_at: now,
    next_lineage_snapshot_at: now,
    last_run_at: null,
    last_result: null,
    created_at: now,
    updated_at: now,
  });

export const resolveEvolutionScheduleConfig = async (
  repository: Repository,
  now = new Date().toISOString(),
) => (await repository.getEvolutionScheduleConfig()) ?? buildDefaultEvolutionScheduleConfig(now);

export const saveEvolutionScheduleConfig = async (
  repository: Repository,
  request: EvolutionScheduleUpdateRequest,
  now = new Date().toISOString(),
) => {
  const existing = await repository.getEvolutionScheduleConfig(request.id);
  const baseline = existing ?? buildDefaultEvolutionScheduleConfig(now);
  const inheritedBenchmarkPackId = request.benchmark_pack_id ?? baseline.benchmark_pack_id;
  const walkForwardDefaults = {
    ...(existing?.walk_forward_defaults ?? baseline.walk_forward_defaults),
    ...request.walk_forward_defaults,
    benchmark_pack_id:
      request.benchmark_pack_id &&
      request.walk_forward_defaults?.benchmark_pack_id === baseline.walk_forward_defaults.benchmark_pack_id
        ? inheritedBenchmarkPackId
        : request.walk_forward_defaults?.benchmark_pack_id ?? inheritedBenchmarkPackId,
  };
  const trustRefreshDefaults = {
    ...(existing?.trust_refresh_defaults ?? baseline.trust_refresh_defaults),
    ...request.trust_refresh_defaults,
    benchmark_pack_id:
      request.benchmark_pack_id &&
      request.trust_refresh_defaults?.benchmark_pack_id === baseline.trust_refresh_defaults.benchmark_pack_id
        ? inheritedBenchmarkPackId
        : request.trust_refresh_defaults?.benchmark_pack_id ??
          inheritedBenchmarkPackId,
  };
  const moltCycleDefaults = {
    ...(existing?.molt_cycle_defaults ?? baseline.molt_cycle_defaults),
    ...request.molt_cycle_defaults,
    benchmark_pack_id:
      request.benchmark_pack_id &&
      request.molt_cycle_defaults?.benchmark_pack_id === baseline.molt_cycle_defaults.benchmark_pack_id
        ? inheritedBenchmarkPackId
        : request.molt_cycle_defaults?.benchmark_pack_id ??
          inheritedBenchmarkPackId,
    thresholds: {
      ...(existing?.molt_cycle_defaults.thresholds ??
        baseline.molt_cycle_defaults.thresholds),
      ...(request.molt_cycle_defaults?.thresholds ?? {}),
    },
  };
  const savedConfig = evolutionScheduleConfigSchema.parse({
    ...baseline,
    ...request,
    walk_forward_defaults: walkForwardDefaults,
    trust_refresh_defaults: trustRefreshDefaults,
    molt_cycle_defaults: moltCycleDefaults,
    next_self_audit_at:
      existing?.next_self_audit_at ??
      addHours(now, request.self_audit_interval_hours),
    next_benchmark_snapshot_at:
      existing?.next_benchmark_snapshot_at ??
      addHours(now, request.benchmark_snapshot_interval_hours),
    next_walk_forward_snapshot_at:
      existing?.next_walk_forward_snapshot_at ??
      addHours(now, request.walk_forward_snapshot_interval_hours),
    next_benchmark_trust_refresh_at:
      existing?.next_benchmark_trust_refresh_at ??
      addHours(now, request.benchmark_trust_refresh_interval_hours),
    next_molt_at:
      existing?.next_molt_at ??
      addHours(now, request.molt_interval_hours),
    next_lineage_snapshot_at:
      existing?.next_lineage_snapshot_at ??
      addHours(now, request.lineage_snapshot_interval_hours),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });

  return repository.saveEvolutionScheduleConfig(savedConfig);
};

export const runScheduledEvolution = async (
  services: AppServices,
  input: { as_of?: string } = {},
): Promise<EvolutionScheduleRunResponse> => {
  const now = input.as_of ?? new Date().toISOString();
  const schedule = await resolveEvolutionScheduleConfig(services.repository, now);

  if (!schedule.enabled) {
    return evolutionScheduleRunResponseSchema.parse({
      ran: false,
      due: {
        self_audit: false,
        benchmark_snapshot: false,
        walk_forward_snapshot: false,
        benchmark_trust_refresh: false,
        molt_cycle: false,
        lineage_snapshot: false,
      },
      reason: "schedule_disabled",
      schedule,
      trust_refresh: null,
      result: null,
    });
  }

  const due = {
    self_audit:
      schedule.next_self_audit_at === null || schedule.next_self_audit_at <= now,
    benchmark_snapshot:
      schedule.capture_benchmark_snapshot &&
      (schedule.next_benchmark_snapshot_at === null ||
        schedule.next_benchmark_snapshot_at <= now),
    walk_forward_snapshot:
      schedule.capture_walk_forward_snapshot &&
      (schedule.next_walk_forward_snapshot_at === null ||
        schedule.next_walk_forward_snapshot_at <= now),
    benchmark_trust_refresh:
      schedule.run_benchmark_trust_refresh &&
      (schedule.next_benchmark_trust_refresh_at === null ||
        schedule.next_benchmark_trust_refresh_at <= now),
    molt_cycle:
      schedule.run_molt_cycle &&
      (schedule.next_molt_at === null || schedule.next_molt_at <= now),
    lineage_snapshot:
      schedule.capture_lineage_snapshot &&
      (schedule.next_lineage_snapshot_at === null || schedule.next_lineage_snapshot_at <= now),
  };

  if (
    !due.self_audit &&
    !due.benchmark_snapshot &&
    !due.walk_forward_snapshot &&
    !due.benchmark_trust_refresh &&
    !due.molt_cycle &&
    !due.lineage_snapshot
  ) {
    return evolutionScheduleRunResponseSchema.parse({
      ran: false,
      due,
      reason: "nothing_due",
      schedule,
      trust_refresh: null,
      result: null,
    });
  }

  const trustRefresh = due.benchmark_trust_refresh
    ? await refreshBenchmarkTrust(services, {
        ...schedule.trust_refresh_defaults,
        benchmark_pack_id: schedule.trust_refresh_defaults.benchmark_pack_id ?? schedule.benchmark_pack_id,
      })
    : null;

  const result = await runEvolutionCycle(services, {
    as_of: now,
    create_postmortems: schedule.create_postmortems,
    capture_calibration_snapshot: due.self_audit && schedule.capture_calibration_snapshot,
    capture_benchmark_snapshot:
      due.benchmark_snapshot &&
      schedule.capture_benchmark_snapshot &&
      !due.benchmark_trust_refresh,
    capture_walk_forward_snapshot:
      due.walk_forward_snapshot && schedule.capture_walk_forward_snapshot,
    benchmark_pack_id: schedule.benchmark_pack_id,
    walk_forward_snapshot: {
      ...schedule.walk_forward_defaults,
      benchmark_pack_id:
        schedule.walk_forward_defaults.benchmark_pack_id ?? schedule.benchmark_pack_id,
    },
    run_molt_cycle: due.molt_cycle && schedule.run_molt_cycle,
    capture_lineage_snapshot: due.lineage_snapshot && schedule.capture_lineage_snapshot,
    molt_cycle: schedule.molt_cycle_defaults,
  } satisfies Partial<EvolutionCycleRequest>);

  const summary = {
    ran_self_audit: true,
    ran_benchmark_trust_refresh: Boolean(trustRefresh),
    captured_benchmark_snapshot: Boolean(
      trustRefresh?.benchmark_snapshot ?? result.benchmark_snapshot,
    ),
    captured_walk_forward_snapshot: Boolean(result.walk_forward_snapshot),
    ran_molt_cycle: due.molt_cycle && schedule.run_molt_cycle,
    captured_lineage_snapshot: Boolean(result.lineage_snapshot),
    processed_predictions: result.self_audit.auto_score.processed,
    seeded_high_confidence_cases: trustRefresh?.seed.promoted_count ?? 0,
    benchmark_trust_warning_delta: trustRefresh?.delta.warning_count ?? 0,
    benchmark_snapshot_case_count:
      trustRefresh?.benchmark_snapshot?.selected_case_count ??
      result.benchmark_snapshot?.selected_case_count ??
      0,
    benchmark_snapshot_family_count:
      trustRefresh?.benchmark_snapshot?.family_count ??
      result.benchmark_snapshot?.family_count ??
      0,
    walk_forward_window_count: result.walk_forward_snapshot?.window_count ?? 0,
    walk_forward_snapshot_family_count: result.walk_forward_snapshot?.family_count ?? 0,
    hardened_shells: result.molt_cycle?.hardened ?? 0,
    held_shells: result.molt_cycle?.held ?? 0,
    lineage_family_count: result.lineage_snapshot?.family_count ?? 0,
    open_growth_alerts: result.growth_pressure.counts.open,
    planned_growth_actions: result.growth_pressure.counts.plans_created,
    executed_growth_actions: result.growth_pressure.counts.plans_executed,
  };
  const updatedSchedule = await services.repository.saveEvolutionScheduleConfig(
    evolutionScheduleConfigSchema.parse({
      ...schedule,
      next_self_audit_at: addHours(now, schedule.self_audit_interval_hours),
      next_benchmark_snapshot_at: due.benchmark_snapshot
        ? addHours(now, schedule.benchmark_snapshot_interval_hours)
        : schedule.next_benchmark_snapshot_at,
      next_walk_forward_snapshot_at: due.walk_forward_snapshot
        ? addHours(now, schedule.walk_forward_snapshot_interval_hours)
        : schedule.next_walk_forward_snapshot_at,
      next_benchmark_trust_refresh_at: due.benchmark_trust_refresh
        ? addHours(now, schedule.benchmark_trust_refresh_interval_hours)
        : schedule.next_benchmark_trust_refresh_at,
      next_molt_at: due.molt_cycle ? addHours(now, schedule.molt_interval_hours) : schedule.next_molt_at,
      next_lineage_snapshot_at: due.lineage_snapshot
        ? addHours(now, schedule.lineage_snapshot_interval_hours)
        : schedule.next_lineage_snapshot_at,
      last_run_at: now,
      last_result: summary,
      updated_at: now,
    }),
  );

  return evolutionScheduleRunResponseSchema.parse({
    ran: true,
    due,
    reason: null,
    schedule: updatedSchedule,
    trust_refresh: trustRefresh,
    result,
  });
};
