import { randomUUID } from "node:crypto";

import { lineageSnapshotSchema } from "@finance-superbrain/schemas";

import { buildModelLineageReport } from "./modelLineageReport.js";
import type { Repository } from "./repository.types.js";

export const captureLineageSnapshot = async (
  repository: Repository,
  input: { as_of?: string } = {},
) => {
  const report = await buildModelLineageReport(repository);
  const now = new Date().toISOString();
  const families = report.families;
  const snapshot = lineageSnapshotSchema.parse({
    id: randomUUID(),
    as_of: input.as_of ?? now,
    family_count: families.length,
    total_shells: families.reduce((sum, family) => sum + family.total_shells, 0),
    hardened_shells: families.reduce((sum, family) => sum + family.hardened_shells, 0),
    report,
    created_at: now,
  });

  await repository.saveLineageSnapshot(snapshot);

  return snapshot;
};
