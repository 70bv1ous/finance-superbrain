import { evolutionScheduleConfigSchema, evolutionScheduleUpdateRequestSchema } from "@finance-superbrain/schemas";
import type { EvolutionScheduleConfig } from "@finance-superbrain/schemas";

import { saveEvolutionScheduleConfig } from "../lib/evolutionSchedule.js";
import { buildServices } from "../lib/services.js";
import { requestOpsApi, shouldUseOpsApi } from "./httpOps.js";

const request = evolutionScheduleUpdateRequestSchema.parse({
  id: process.env.EVOLUTION_SCHEDULE_ID?.trim() || "default",
  enabled: (process.env.EVOLUTION_SCHEDULE_ENABLED ?? "true").toLowerCase() !== "false",
  create_postmortems:
    (process.env.SELF_AUDIT_CREATE_POSTMORTEMS ?? "true").toLowerCase() !== "false",
  capture_calibration_snapshot:
    (process.env.EVOLUTION_CAPTURE_CALIBRATION_SNAPSHOT ?? "true").toLowerCase() !== "false",
  capture_benchmark_snapshot:
    (process.env.EVOLUTION_CAPTURE_BENCHMARK_SNAPSHOT ?? "true").toLowerCase() !== "false",
  benchmark_pack_id: process.env.EVOLUTION_BENCHMARK_PACK_ID?.trim() || "core_benchmark_v1",
  run_benchmark_trust_refresh:
    (process.env.EVOLUTION_RUN_BENCHMARK_TRUST_REFRESH ?? "true").toLowerCase() !== "false",
  run_molt_cycle: (process.env.EVOLUTION_RUN_MOLT_CYCLE ?? "true").toLowerCase() !== "false",
  capture_lineage_snapshot:
    (process.env.EVOLUTION_CAPTURE_LINEAGE_SNAPSHOT ?? "true").toLowerCase() !== "false",
  self_audit_interval_hours: Number(process.env.EVOLUTION_SELF_AUDIT_INTERVAL_HOURS ?? 24),
  benchmark_snapshot_interval_hours: Number(
    process.env.EVOLUTION_BENCHMARK_INTERVAL_HOURS ?? 24,
  ),
  benchmark_trust_refresh_interval_hours: Number(
    process.env.EVOLUTION_BENCHMARK_TRUST_REFRESH_INTERVAL_HOURS ?? 24 * 7,
  ),
  molt_interval_hours: Number(process.env.EVOLUTION_MOLT_INTERVAL_HOURS ?? 24 * 7),
  lineage_snapshot_interval_hours: Number(
    process.env.EVOLUTION_LINEAGE_INTERVAL_HOURS ?? 24,
  ),
  trust_refresh_defaults: {
    benchmark_pack_id:
      process.env.EVOLUTION_TRUST_REFRESH_BENCHMARK_PACK_ID?.trim() ||
      process.env.EVOLUTION_BENCHMARK_PACK_ID?.trim() ||
      "core_benchmark_v1",
    reviewer: process.env.EVOLUTION_TRUST_REFRESH_REVIEWER?.trim() || "core-corpus-seed",
    seed_limit: Number(process.env.EVOLUTION_TRUST_REFRESH_SEED_LIMIT ?? 8),
    min_candidate_score: Number(process.env.EVOLUTION_TRUST_REFRESH_MIN_SCORE ?? 0.8),
    dry_run:
      (process.env.EVOLUTION_TRUST_REFRESH_DRY_RUN ?? "false").toLowerCase() === "true",
    ingest_reviewed_memory:
      (process.env.EVOLUTION_TRUST_REFRESH_INGEST_REVIEWED_MEMORY ?? "false").toLowerCase() ===
      "true",
    model_version:
      process.env.EVOLUTION_TRUST_REFRESH_MODEL_VERSION?.trim() ||
      "historical-library-high-confidence-v1",
    strict_quotas:
      (process.env.EVOLUTION_TRUST_REFRESH_STRICT_QUOTAS ?? "false").toLowerCase() === "true",
  },
  molt_cycle_defaults: {
    case_pack: process.env.REPLAY_CASE_PACK?.trim() || "macro_plus_v1",
    benchmark_pack_id:
      process.env.MOLT_BENCHMARK_PACK_ID?.trim() ||
      process.env.EVOLUTION_BENCHMARK_PACK_ID?.trim() ||
      "core_benchmark_v1",
    thresholds: {
      min_average_total_score_delta: Number(process.env.REPLAY_PROMOTION_MIN_SCORE_DELTA ?? 0.01),
      min_direction_accuracy_delta:
        Number(process.env.REPLAY_PROMOTION_MIN_DIRECTION_DELTA ?? 0),
      max_wrong_rate_delta: Number(process.env.REPLAY_PROMOTION_MAX_WRONG_RATE_DELTA ?? 0),
      min_calibration_alignment_delta:
        Number(process.env.REPLAY_PROMOTION_MIN_CALIBRATION_DELTA ?? 0),
    },
    promote_on_pass: (process.env.REPLAY_PROMOTION_APPLY ?? "true").toLowerCase() !== "false",
    promoted_status: (process.env.REPLAY_PROMOTION_STATUS ?? "active").trim() || "active",
    max_families: Number(process.env.MOLT_MAX_FAMILIES ?? 10),
    min_family_pass_rate: Number(process.env.MOLT_MIN_FAMILY_PASS_RATE ?? 0.65),
    score_floor: Number(process.env.MOLT_SCORE_FLOOR ?? 0.68),
    max_abs_calibration_gap: Number(process.env.MOLT_MAX_ABS_CALIBRATION_GAP ?? 0.12),
    trigger_on_declining_trend: (process.env.MOLT_TRIGGER_ON_DECLINING_TREND ?? "true")
      .toLowerCase() !== "false",
    require_pattern_priors: (process.env.MOLT_REQUIRE_PATTERN_PRIORS ?? "true")
      .toLowerCase() !== "false",
    label_suffix: process.env.MOLT_LABEL_SUFFIX?.trim() || "Molted",
  },
});

const printSchedule = (schedule: EvolutionScheduleConfig) => {
  console.log(
    JSON.stringify(
      {
        id: schedule.id,
        enabled: schedule.enabled,
        self_audit_interval_hours: schedule.self_audit_interval_hours,
        benchmark_pack_id: schedule.benchmark_pack_id,
        benchmark_snapshot_interval_hours: schedule.benchmark_snapshot_interval_hours,
        run_benchmark_trust_refresh: schedule.run_benchmark_trust_refresh,
        benchmark_trust_refresh_interval_hours:
          schedule.benchmark_trust_refresh_interval_hours,
        molt_interval_hours: schedule.molt_interval_hours,
        lineage_snapshot_interval_hours: schedule.lineage_snapshot_interval_hours,
        next_self_audit_at: schedule.next_self_audit_at,
        next_benchmark_snapshot_at: schedule.next_benchmark_snapshot_at,
        next_benchmark_trust_refresh_at: schedule.next_benchmark_trust_refresh_at,
        next_molt_at: schedule.next_molt_at,
        next_lineage_snapshot_at: schedule.next_lineage_snapshot_at,
      },
      null,
      2,
    ),
  );
};

if (shouldUseOpsApi()) {
  const schedule = evolutionScheduleConfigSchema.parse(
    await requestOpsApi("POST", "/v1/operations/evolution-schedule", request),
  );
  printSchedule(schedule);
} else {
  const services = buildServices();

  try {
    const schedule = await saveEvolutionScheduleConfig(services.repository, request);
    printSchedule(schedule);
  } finally {
    await services.marketDataProvider.close?.();
    await services.embeddingProvider.close?.();
    await services.repository.close?.();
  }
}
