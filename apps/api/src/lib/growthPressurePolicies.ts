import { growthPressurePolicySchema } from "@finance-superbrain/schemas";
import type {
  GrowthPressurePolicy,
  GrowthPressurePolicyUpsertRequest,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

const defaultThresholds = (): GrowthPressurePolicy["thresholds"] => ({
  low_pass_rate: 0.6,
  medium_pass_rate: 0.52,
  high_pass_rate: 0.45,
  low_average_total_score: 0.65,
  medium_average_total_score: 0.6,
  high_average_total_score: 0.55,
  medium_abs_calibration_gap: 0.1,
  high_abs_calibration_gap: 0.14,
  pass_rate_delta_decline: -0.15,
});

const defaultPersistence = (): GrowthPressurePolicy["persistence"] => ({
  medium_persistent_cycles: 2,
  high_persistent_cycles: 2,
  candidate_generation_cycles: 3,
});

const defaultActions = (): GrowthPressurePolicy["actions"] => ({
  diagnostics_case_pack: "macro_plus_v1",
  auto_queue_diagnostics: true,
  auto_schedule_molt_review: true,
  require_operator_approval_for_candidate_generation: true,
});

export const buildDefaultGrowthPressurePolicy = (
  family: string,
  now = new Date().toISOString(),
): GrowthPressurePolicy =>
  growthPressurePolicySchema.parse({
    family,
    enabled: true,
    thresholds: defaultThresholds(),
    persistence: defaultPersistence(),
    actions: defaultActions(),
    created_at: now,
    updated_at: now,
  });

export const resolveGrowthPressurePolicy = async (
  repository: Repository,
  family: string,
  now = new Date().toISOString(),
) => (await repository.getGrowthPressurePolicy(family)) ?? buildDefaultGrowthPressurePolicy(family, now);

export const saveGrowthPressurePolicy = async (
  repository: Repository,
  request: GrowthPressurePolicyUpsertRequest,
  now = new Date().toISOString(),
) => {
  const existing = await repository.getGrowthPressurePolicy(request.family);
  const baseline = existing ?? buildDefaultGrowthPressurePolicy(request.family, now);
  const policy = growthPressurePolicySchema.parse({
    ...baseline,
    ...request,
    thresholds: {
      ...baseline.thresholds,
      ...(request.thresholds ?? {}),
    },
    persistence: {
      ...baseline.persistence,
      ...(request.persistence ?? {}),
    },
    actions: {
      ...baseline.actions,
      ...(request.actions ?? {}),
    },
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });

  return repository.saveGrowthPressurePolicy(policy);
};
