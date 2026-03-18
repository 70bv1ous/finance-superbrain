import { randomUUID } from "node:crypto";

import { calibrationSnapshotSchema } from "@finance-superbrain/schemas";

import { buildCalibrationReport } from "./calibrationReport.js";
import type { Repository } from "./repository.types.js";

export const captureCalibrationSnapshot = async (
  repository: Repository,
  input: { as_of?: string } = {},
) => {
  const report = await buildCalibrationReport(repository);
  const now = new Date().toISOString();
  const snapshot = calibrationSnapshotSchema.parse({
    id: randomUUID(),
    as_of: input.as_of ?? now,
    sample_count: report.sample_count,
    average_total_score: report.average_total_score,
    report,
    created_at: now,
  });

  await repository.saveCalibrationSnapshot(snapshot);

  return snapshot;
};
