import {
  evolutionScheduleRunResponseSchema,
  type EvolutionScheduleRunResponse,
} from "@finance-superbrain/schemas";

import { runScheduledEvolution } from "../lib/evolutionSchedule.js";
import { requestOpsApi, shouldUseOpsApi } from "./httpOps.js";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";

const printResult = (result: ReturnType<typeof evolutionScheduleRunResponseSchema.parse>) => {
  console.log(
    JSON.stringify(
      {
        ran: result.ran,
        due: result.due,
        reason: result.reason,
        next_self_audit_at: result.schedule.next_self_audit_at,
        next_benchmark_snapshot_at: result.schedule.next_benchmark_snapshot_at,
        next_benchmark_trust_refresh_at: result.schedule.next_benchmark_trust_refresh_at,
        next_molt_at: result.schedule.next_molt_at,
        next_lineage_snapshot_at: result.schedule.next_lineage_snapshot_at,
        last_result: result.schedule.last_result,
        trust_refresh: result.trust_refresh
          ? {
              generated_at: result.trust_refresh.generated_at,
              benchmark_pack_id: result.trust_refresh.benchmark_pack_id,
              promoted_count: result.trust_refresh.seed.promoted_count,
              warning_delta: result.trust_refresh.delta.warning_count,
            }
          : null,
      },
      null,
      2,
    ),
  );
};

if (shouldUseOpsApi()) {
  const result = evolutionScheduleRunResponseSchema.parse(
    await requestOpsApi("POST", "/v1/operations/evolution-schedule/run", {
      as_of: process.env.EVOLUTION_AS_OF,
    }),
  );
  printResult(result);
} else {
  const result = await runTrackedScriptOperation<EvolutionScheduleRunResponse>(
    {
      operation_name: "scheduled_evolution",
      metadata: {
        as_of: process.env.EVOLUTION_AS_OF ?? null,
      },
      summarize: (response) => ({
        ran: response.ran,
        due_self_audit: response.due.self_audit,
        due_benchmark_snapshot: response.due.benchmark_snapshot,
        due_walk_forward_snapshot: response.due.walk_forward_snapshot,
        due_trust_refresh: response.due.benchmark_trust_refresh,
        due_molt_cycle: response.due.molt_cycle,
        seeded_high_confidence_cases: response.trust_refresh?.seed.promoted_count ?? 0,
        trust_warning_delta: response.trust_refresh?.delta.warning_count ?? 0,
        walk_forward_window_count:
          response.result?.walk_forward_snapshot?.window_count ?? 0,
        hardened_shells: response.result?.molt_cycle?.hardened ?? 0,
      }),
    },
    (services) =>
      runScheduledEvolution(services, {
        as_of: process.env.EVOLUTION_AS_OF,
      }),
  );
  printResult(result);
}
