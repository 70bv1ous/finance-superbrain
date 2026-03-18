import { selfAuditResponseSchema } from "@finance-superbrain/schemas";
import type { AutoScoreRequest } from "@finance-superbrain/schemas";

import { autoScorePredictions } from "./autoScorePredictions.js";
import { captureCalibrationSnapshot } from "./captureCalibrationSnapshot.js";
import { buildModelComparisonReport } from "./modelComparisonReport.js";
import type { AppServices } from "./services.js";

export const runSelfAudit = async (
  services: AppServices,
  request: Partial<
    AutoScoreRequest & {
      capture_snapshot?: boolean;
    }
  > = {},
) => {
  const autoScore = await autoScorePredictions(services, request);
  const calibrationSnapshot =
    request.capture_snapshot === false
      ? null
      : await captureCalibrationSnapshot(services.repository, {
          as_of: request.as_of,
        });
  const modelComparison = await buildModelComparisonReport(services.repository);

  return selfAuditResponseSchema.parse({
    auto_score: autoScore,
    calibration_snapshot: calibrationSnapshot,
    model_comparison: modelComparison,
  });
};
