import {
  evolutionCycleRequestSchema,
  type EvolutionCycleResponse,
} from "@finance-superbrain/schemas";

import { runEvolutionCycle } from "../lib/runEvolutionCycle.js";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";

const request = evolutionCycleRequestSchema.parse({
  as_of: process.env.EVOLUTION_AS_OF,
  create_postmortems: process.env.SELF_AUDIT_CREATE_POSTMORTEMS !== "false",
  capture_calibration_snapshot: process.env.EVOLUTION_CAPTURE_CALIBRATION_SNAPSHOT !== "false",
  run_molt_cycle: process.env.EVOLUTION_RUN_MOLT_CYCLE !== "false",
  capture_lineage_snapshot: process.env.EVOLUTION_CAPTURE_LINEAGE_SNAPSHOT !== "false",
  molt_cycle: {
    case_pack: process.env.REPLAY_CASE_PACK?.trim() || "macro_plus_v1",
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

const result = await runTrackedScriptOperation<EvolutionCycleResponse>(
  {
    operation_name: "evolution_cycle",
    metadata: {
      benchmark_pack_id: request.benchmark_pack_id ?? null,
      run_molt_cycle: request.run_molt_cycle ?? true,
    },
    summarize: (response) => ({
      processed_predictions: response.self_audit.auto_score.processed,
      benchmark_case_count: response.benchmark_snapshot?.selected_case_count ?? 0,
      walk_forward_window_count: response.walk_forward_snapshot?.window_count ?? 0,
      hardened_shells: response.molt_cycle?.hardened ?? 0,
      held_shells: response.molt_cycle?.held ?? 0,
      open_growth_alerts: response.growth_pressure.counts.open,
    }),
    status_from_result: (response) =>
      response.self_audit.auto_score.errors.length ? "partial" : "success",
  },
  (services) => runEvolutionCycle(services, request),
);

console.log(
  JSON.stringify(
    {
      self_audit: {
        processed: result.self_audit.auto_score.processed,
        snapshot_id: result.self_audit.calibration_snapshot?.id ?? null,
        top_model: result.self_audit.model_comparison.leaders.by_average_total_score,
      },
      molt_cycle: result.molt_cycle
        ? {
            considered: result.molt_cycle.considered,
            triggered: result.molt_cycle.triggered,
            hardened: result.molt_cycle.hardened,
            held: result.molt_cycle.held,
          }
        : null,
      lineage_snapshot: result.lineage_snapshot
        ? {
            snapshot_id: result.lineage_snapshot.id,
            family_count: result.lineage_snapshot.family_count,
            total_shells: result.lineage_snapshot.total_shells,
          }
        : null,
    },
    null,
    2,
  ),
);
