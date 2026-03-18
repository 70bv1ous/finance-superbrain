import { describe, expect, it } from "vitest";

import {
  resolveOperationWorkerServiceRestartDelayMs,
  resolveOperationWorkerServiceRestartStreak,
} from "./operationWorkerServiceRestartPolicy.js";

describe("operation worker service restart policy", () => {
  it("resets the restart streak after a loop survives the success window", () => {
    expect(
      resolveOperationWorkerServiceRestartStreak({
        scheduled_restart: true,
        runtime_ms: 90_000,
        success_window_ms: 60_000,
        current_restart_streak: 4,
      }),
    ).toBe(1);
  });

  it("increments the restart streak for consecutive crash loops", () => {
    expect(
      resolveOperationWorkerServiceRestartStreak({
        scheduled_restart: true,
        runtime_ms: 5_000,
        success_window_ms: 60_000,
        current_restart_streak: 2,
      }),
    ).toBe(3);
  });

  it("doubles restart backoff but respects the configured cap", () => {
    expect(
      resolveOperationWorkerServiceRestartDelayMs({
        base_backoff_ms: 5_000,
        max_backoff_ms: 40_000,
        restart_streak: 1,
      }),
    ).toBe(5_000);
    expect(
      resolveOperationWorkerServiceRestartDelayMs({
        base_backoff_ms: 5_000,
        max_backoff_ms: 40_000,
        restart_streak: 4,
      }),
    ).toBe(40_000);
    expect(
      resolveOperationWorkerServiceRestartDelayMs({
        base_backoff_ms: 5_000,
        max_backoff_ms: 40_000,
        restart_streak: 6,
      }),
    ).toBe(40_000);
  });
});
