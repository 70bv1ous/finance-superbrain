import { evolutionCycleResponseSchema } from "@finance-superbrain/schemas";
import type {
  EvolutionCycleRequest,
  MoltCycleRequest,
} from "@finance-superbrain/schemas";

import { captureBenchmarkReplaySnapshot } from "./benchmarkReplaySnapshot.js";
import { captureLineageSnapshot } from "./captureLineageSnapshot.js";
import { monitorGrowthPressure } from "./growthPressureManagement.js";
import { runMoltCycle } from "./runMoltCycle.js";
import { runSelfAudit } from "./runSelfAudit.js";
import { captureWalkForwardReplaySnapshot } from "./walkForwardReplaySnapshot.js";
import type { AppServices } from "./services.js";

const defaultMoltCycleRequest = (): MoltCycleRequest => ({
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

export const runEvolutionCycle = async (
  services: AppServices,
  request: Partial<EvolutionCycleRequest> = {},
) => {
  const benchmarkPackId = request.benchmark_pack_id ?? "core_benchmark_v1";
  const selfAudit = await runSelfAudit(services, {
    as_of: request.as_of,
    create_postmortems: request.create_postmortems,
    capture_snapshot: request.capture_calibration_snapshot,
  });
  const benchmarkSnapshot =
    request.capture_benchmark_snapshot === false
      ? null
      : await captureBenchmarkReplaySnapshot(services.repository, {
          as_of: request.as_of,
          benchmark_pack_id: benchmarkPackId,
          allowed_case_qualities: ["reviewed", "high_confidence"],
          strict_quotas: false,
        }).catch((error) => {
          if (
            error instanceof Error &&
            (error.message.includes("No active model families") ||
              error.message.includes("No historical library cases") ||
              error.message.includes("benchmark composer could not find"))
          ) {
            return null;
          }

          throw error;
        });
  const walkForwardSnapshot =
    request.capture_walk_forward_snapshot === false
      ? null
      : await captureWalkForwardReplaySnapshot(services.repository, {
          as_of: request.as_of,
          benchmark_pack_id: request.walk_forward_snapshot?.benchmark_pack_id ?? benchmarkPackId,
          case_pack_filters: request.walk_forward_snapshot?.case_pack_filters,
          allowed_case_qualities:
            request.walk_forward_snapshot?.allowed_case_qualities ?? [
              "reviewed",
              "high_confidence",
            ],
          training_mode: request.walk_forward_snapshot?.training_mode ?? "expanding",
          min_train_cases: request.walk_forward_snapshot?.min_train_cases ?? 10,
          test_window_size: request.walk_forward_snapshot?.test_window_size ?? 5,
          step_size: request.walk_forward_snapshot?.step_size,
          seed_training_memory:
            request.walk_forward_snapshot?.seed_training_memory ?? true,
          training_memory_model_version:
            request.walk_forward_snapshot?.training_memory_model_version ??
            "walk-forward-memory-v1",
          model_versions: request.walk_forward_snapshot?.model_versions,
        }).catch((error) => {
          if (
            error instanceof Error &&
            (error.message.includes("No active model families") ||
              error.message.includes("Insufficient dated cases") ||
              error.message.includes("Walk-forward validation could not form any windows") ||
              error.message.includes("No historical library cases"))
          ) {
            return null;
          }

          throw error;
        });
  const moltCycle =
    request.run_molt_cycle === false
      ? null
      : await runMoltCycle(services.repository, {
          ...defaultMoltCycleRequest(),
          ...(request.molt_cycle ?? {}),
          benchmark_pack_id: request.molt_cycle?.benchmark_pack_id ?? benchmarkPackId,
          thresholds: {
            ...defaultMoltCycleRequest().thresholds,
            ...(request.molt_cycle?.thresholds ?? {}),
          },
        });
  const lineageSnapshot =
    request.capture_lineage_snapshot === false
      ? null
      : await captureLineageSnapshot(services.repository, {
          as_of: request.as_of,
        });
  const growthPressure = await monitorGrowthPressure(services.repository, {
    as_of: request.as_of,
    benchmark_pack_id: benchmarkPackId,
  });

  return evolutionCycleResponseSchema.parse({
    self_audit: selfAudit,
    benchmark_snapshot: benchmarkSnapshot,
    walk_forward_snapshot: walkForwardSnapshot,
    molt_cycle: moltCycle,
    lineage_snapshot: lineageSnapshot,
    growth_pressure: growthPressure,
  });
};
