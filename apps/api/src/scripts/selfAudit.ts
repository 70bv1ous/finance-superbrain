import { runSelfAudit } from "../lib/runSelfAudit.js";
import type { SelfAuditResponse } from "@finance-superbrain/schemas";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";

const result = await runTrackedScriptOperation<SelfAuditResponse>(
  {
    operation_name: "self_audit",
    metadata: {
      as_of: process.env.SELF_AUDIT_AS_OF ?? null,
      create_postmortems: process.env.SELF_AUDIT_CREATE_POSTMORTEMS !== "false",
      capture_snapshot: process.env.SELF_AUDIT_CAPTURE_SNAPSHOT !== "false",
    },
    summarize: (response) => ({
      processed_predictions: response.auto_score.processed,
      auto_score_errors: response.auto_score.errors.length,
      snapshot_captured: response.calibration_snapshot !== null,
      model_count: response.model_comparison.versions.length,
    }),
    status_from_result: (response) =>
      response.auto_score.errors.length ? "partial" : "success",
  },
  (services) =>
    runSelfAudit(services, {
      as_of: process.env.SELF_AUDIT_AS_OF,
      create_postmortems: process.env.SELF_AUDIT_CREATE_POSTMORTEMS !== "false",
      capture_snapshot: process.env.SELF_AUDIT_CAPTURE_SNAPSHOT !== "false",
    }),
);

console.log(
  JSON.stringify(
    {
      processed: result.auto_score.processed,
      errors: result.auto_score.errors.length,
      snapshot_id: result.calibration_snapshot?.id ?? null,
      top_model: result.model_comparison.leaders.by_average_total_score,
    },
    null,
    2,
  ),
);
