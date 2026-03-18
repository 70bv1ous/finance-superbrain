import { captureCalibrationSnapshot } from "../lib/captureCalibrationSnapshot.js";
import type { CalibrationSnapshot } from "@finance-superbrain/schemas";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";

const snapshot = await runTrackedScriptOperation<CalibrationSnapshot>(
  {
    operation_name: "calibration_snapshot",
    summarize: (result) => ({
      sample_count: result.sample_count,
      average_total_score: result.average_total_score,
      horizon_count: result.report.horizons.length,
    }),
  },
  (services) => captureCalibrationSnapshot(services.repository),
);

console.log(
  JSON.stringify(
    {
      snapshot_id: snapshot.id,
      as_of: snapshot.as_of,
      sample_count: snapshot.sample_count,
      average_total_score: snapshot.average_total_score,
    },
    null,
    2,
  ),
);
