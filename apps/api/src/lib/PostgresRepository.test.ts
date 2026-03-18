import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { PostgresRepository } from "./PostgresRepository.js";

describe("PostgresRepository", () => {
  it("casts last_cycle_finished_at in worker upserts so null cycle timestamps are type-safe", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          worker_id: "worker-test",
          lifecycle_state: "starting",
          supported_operations: [],
          poll_interval_ms: 2_000,
          idle_backoff_ms: 5_000,
          started_at: "2026-03-16T00:00:00.000Z",
          last_heartbeat_at: "2026-03-16T00:00:00.000Z",
          last_cycle_started_at: null,
          last_cycle_finished_at: null,
          last_cycle_processed: null,
          last_cycle_completed: null,
          last_cycle_failed: null,
          last_cycle_retried: null,
          last_cycle_abandoned: null,
          total_cycles: 0,
          total_processed: 0,
          total_completed: 0,
          total_failed: 0,
          total_retried: 0,
          total_abandoned: 0,
          last_error_message: null,
          stopped_at: null,
          updated_at: "2026-03-16T00:00:00.000Z",
        },
      ],
      rowCount: 1,
    });
    const repository = new PostgresRepository({
      query,
    } as unknown as Pool);

    await repository.upsertOperationWorker({
      worker_id: "worker-test",
      lifecycle_state: "starting",
      supported_operations: [],
      poll_interval_ms: 2_000,
      idle_backoff_ms: 5_000,
      heartbeat_at: "2026-03-16T00:00:00.000Z",
      last_cycle_finished_at: null,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("case when $9::timestamptz is null then 0 else 1 end");
  });
});
