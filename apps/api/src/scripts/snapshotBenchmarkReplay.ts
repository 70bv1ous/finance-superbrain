import {
  benchmarkReplaySnapshotRequestSchema,
  type BenchmarkReplaySnapshot,
} from "@finance-superbrain/schemas";

import { captureBenchmarkReplaySnapshot, summarizeBenchmarkReplaySnapshot } from "../lib/benchmarkReplaySnapshot.js";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";
const modelVersions = (process.env.REPLAY_MODEL_VERSIONS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const casePackFilters = (process.env.REPLAY_BENCHMARK_CASE_PACK_FILTERS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const request = benchmarkReplaySnapshotRequestSchema.parse({
  as_of: process.env.BENCHMARK_SNAPSHOT_AS_OF,
  benchmark_pack_id: process.env.REPLAY_BENCHMARK_PACK_ID?.trim() || "core_benchmark_v1",
  model_versions: modelVersions.length ? modelVersions : undefined,
  case_pack_filters: casePackFilters.length ? casePackFilters : undefined,
  strict_quotas: (process.env.REPLAY_BENCHMARK_STRICT ?? "true").toLowerCase() !== "false",
});

const snapshot = await runTrackedScriptOperation<BenchmarkReplaySnapshot>(
  {
    operation_name: "benchmark_snapshot",
    metadata: {
      benchmark_pack_id: request.benchmark_pack_id,
      strict_quotas: request.strict_quotas,
    },
    summarize: (result) => ({
      benchmark_pack_id: result.benchmark_pack_id,
      selected_case_count: result.selected_case_count,
      family_count: result.family_count,
      model_count: result.report.model_count,
    }),
  },
  (services) => captureBenchmarkReplaySnapshot(services.repository, request),
);

console.log(JSON.stringify(summarizeBenchmarkReplaySnapshot(snapshot), null, 2));
