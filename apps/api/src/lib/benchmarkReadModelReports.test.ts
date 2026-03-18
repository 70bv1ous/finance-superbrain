import { randomUUID } from "node:crypto";

import type {
  BenchmarkReplaySnapshot,
  WalkForwardReplaySnapshot,
} from "@finance-superbrain/schemas";
import { describe, expect, it, vi } from "vitest";

import { buildDashboardBenchmark } from "./dashboardBenchmark.js";
import { InMemoryRepository } from "./InMemoryRepository.js";
import { buildBenchmarkStabilityReport } from "./benchmarkStabilityReport.js";
import { buildBenchmarkTrendReport } from "./benchmarkTrendReport.js";
import type { Repository } from "./repository.types.js";
import { buildWalkForwardRegimeTrendReport } from "./walkForwardRegimeTrendReport.js";
import { buildWalkForwardTrendReport } from "./walkForwardTrendReport.js";

const buildBenchmarkSnapshot = (
  benchmark_pack_id: string,
  as_of: string,
): BenchmarkReplaySnapshot => ({
  id: randomUUID(),
  as_of,
  benchmark_pack_id,
  selected_case_count: 4,
  family_count: 1,
  created_at: as_of,
  report: {
    pack_id: benchmark_pack_id,
    label: benchmark_pack_id,
    description: `${benchmark_pack_id} snapshot`,
    selected_case_count: 4,
    quotas_met: true,
    domain_counts: [],
    selected_case_ids: ["case-1", "case-2", "case-3", "case-4"],
    model_count: 1,
    family_count: 1,
    leaders: {
      by_average_total_score: "impact-engine",
      by_direction_accuracy: "impact-engine",
      by_calibration_alignment: "impact-engine",
    },
    models: [
      {
        model_version: "impact-engine-v1",
        family: "impact-engine",
        status: "active",
        case_count: 4,
        average_confidence: 0.71,
        average_total_score: 0.74,
        direction_accuracy: 0.75,
        average_calibration_score: 0.72,
        calibration_gap: 0.03,
        correct_rate: 0.5,
        partial_rate: 0.25,
        wrong_rate: 0.25,
        by_theme: [],
        by_source_type: [],
        by_horizon: [],
      },
    ],
    families: [
      {
        family: "impact-engine",
        model_version: "impact-engine-v1",
        status: "active",
        case_count: 4,
        average_confidence: 0.71,
        average_total_score: 0.74,
        direction_accuracy: 0.75,
        calibration_gap: 0.03,
        wrong_rate: 0.25,
      },
    ],
  },
});

const buildWalkForwardSnapshot = (
  benchmark_pack_id: string,
  as_of: string,
): WalkForwardReplaySnapshot => ({
  id: randomUUID(),
  as_of,
  benchmark_pack_id,
  eligible_case_count: 5,
  window_count: 2,
  family_count: 1,
  created_at: as_of,
  report: {
    benchmark_pack_id,
    training_mode: "expanding",
    min_train_cases: 3,
    test_window_size: 2,
    step_size: 2,
    eligible_case_count: 5,
    undated_case_count: 0,
    first_eligible_occurred_at: as_of,
    last_eligible_occurred_at: as_of,
    window_count: 2,
    model_count: 1,
    family_count: 1,
    leaders: {
      by_average_total_score: "impact-engine",
      by_direction_accuracy: "impact-engine",
      by_calibration_alignment: "impact-engine",
    },
    warnings: [],
    models: [
      {
        model_version: "impact-engine-v1",
        family: "impact-engine",
        status: "active",
        case_count: 5,
        average_confidence: 0.7,
        average_total_score: 0.76,
        direction_accuracy: 0.8,
        average_calibration_score: 0.77,
        calibration_gap: 0.02,
        correct_rate: 0.6,
        partial_rate: 0.2,
        wrong_rate: 0.2,
        by_theme: [],
        by_source_type: [],
        by_horizon: [],
      },
    ],
    families: [
      {
        family: "impact-engine",
        model_version: "impact-engine-v1",
        status: "active",
        case_count: 5,
        average_confidence: 0.7,
        average_total_score: 0.76,
        direction_accuracy: 0.8,
        calibration_gap: 0.02,
        wrong_rate: 0.2,
      },
    ],
    regimes: [
      {
        regime: "rate_hiking",
        family: "impact-engine",
        model_version: "impact-engine-v1",
        status: "active",
        case_count: 3,
        average_confidence: 0.72,
        average_total_score: 0.78,
        direction_accuracy: 0.81,
        wrong_rate: 0.19,
        calibration_gap: 0.02,
      },
    ],
  },
});

class BenchmarkDashboardReadCountRepository extends InMemoryRepository {
  benchmarkReplaySnapshotListCalls = 0;
  walkForwardReplaySnapshotListCalls = 0;

  override async listBenchmarkReplaySnapshots(
    options?: Parameters<InMemoryRepository["listBenchmarkReplaySnapshots"]>[0],
  ) {
    this.benchmarkReplaySnapshotListCalls += 1;
    return super.listBenchmarkReplaySnapshots(options);
  }

  override async listWalkForwardReplaySnapshots(
    options?: Parameters<InMemoryRepository["listWalkForwardReplaySnapshots"]>[0],
  ) {
    this.walkForwardReplaySnapshotListCalls += 1;
    return super.listWalkForwardReplaySnapshots(options);
  }
}

describe("benchmark read-model trend builders", () => {
  it("passes benchmark pack filters into replay trend and stability history queries", async () => {
    const replaySnapshots = [
      buildBenchmarkSnapshot("core_benchmark_v1", "2026-03-10T00:00:00.000Z"),
      buildBenchmarkSnapshot("core_benchmark_v1", "2026-03-12T00:00:00.000Z"),
    ];
    const listBenchmarkReplaySnapshots = vi
      .fn<Repository["listBenchmarkReplaySnapshots"]>()
      .mockResolvedValue(replaySnapshots);
    const repository = {
      listBenchmarkReplaySnapshots,
    } as unknown as Repository;

    const trend = await buildBenchmarkTrendReport(repository, {
      benchmark_pack_id: "core_benchmark_v1",
      limit: 7,
    });
    const stability = await buildBenchmarkStabilityReport(repository, {
      benchmark_pack_id: "core_benchmark_v1",
      limit: 9,
    });

    expect(listBenchmarkReplaySnapshots).toHaveBeenNthCalledWith(1, {
      limit: 7,
      benchmark_pack_id: "core_benchmark_v1",
    });
    expect(listBenchmarkReplaySnapshots).toHaveBeenNthCalledWith(2, {
      limit: 9,
      benchmark_pack_id: "core_benchmark_v1",
    });
    expect(trend.sample_count).toBe(2);
    expect(stability.sample_count).toBe(2);
  });

  it("passes benchmark pack filters into walk-forward trend queries", async () => {
    const walkForwardSnapshots = [
      buildWalkForwardSnapshot("core_benchmark_v1", "2026-03-10T00:00:00.000Z"),
      buildWalkForwardSnapshot("core_benchmark_v1", "2026-03-12T00:00:00.000Z"),
    ];
    const listWalkForwardReplaySnapshots = vi
      .fn<Repository["listWalkForwardReplaySnapshots"]>()
      .mockResolvedValue(walkForwardSnapshots);
    const repository = {
      listWalkForwardReplaySnapshots,
    } as unknown as Repository;

    const trend = await buildWalkForwardTrendReport(repository, {
      benchmark_pack_id: "core_benchmark_v1",
      limit: 11,
    });
    const regimeTrend = await buildWalkForwardRegimeTrendReport(repository, {
      benchmark_pack_id: "core_benchmark_v1",
      limit: 13,
    });

    expect(listWalkForwardReplaySnapshots).toHaveBeenNthCalledWith(1, {
      limit: 11,
      benchmark_pack_id: "core_benchmark_v1",
    });
    expect(listWalkForwardReplaySnapshots).toHaveBeenNthCalledWith(2, {
      limit: 13,
      benchmark_pack_id: "core_benchmark_v1",
    });
    expect(trend.sample_count).toBe(2);
    expect(regimeTrend.sample_count).toBe(2);
    expect(regimeTrend.regime_count).toBe(1);
  });

  it("reuses preloaded snapshot histories when building the benchmark dashboard", async () => {
    const repository = new BenchmarkDashboardReadCountRepository();

    await repository.saveBenchmarkReplaySnapshot(
      buildBenchmarkSnapshot("core_benchmark_v1", "2026-03-12T00:00:00.000Z"),
    );
    await repository.saveWalkForwardReplaySnapshot(
      buildWalkForwardSnapshot("core_benchmark_v1", "2026-03-12T00:00:00.000Z"),
    );

    const dashboard = await buildDashboardBenchmark(repository, {
      benchmark_pack_id: "core_benchmark_v1",
    });

    expect(repository.benchmarkReplaySnapshotListCalls).toBe(1);
    expect(repository.walkForwardReplaySnapshotListCalls).toBe(1);
    expect(dashboard.recent_snapshots).toHaveLength(1);
    expect(dashboard.recent_walk_forward_snapshots).toHaveLength(1);
  });
});
