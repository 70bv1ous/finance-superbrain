import { describe, expect, it } from "vitest";

import { waitForDelay } from "./interruptibleDelay.js";

describe("interruptible delay", () => {
  it("waits for the requested delay when no abort signal fires", async () => {
    const startedAt = Date.now();
    await waitForDelay(20);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

  it("returns early when the abort signal fires", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    setTimeout(() => controller.abort(), 10);

    await waitForDelay(5_000, controller.signal);

    expect(Date.now() - startedAt).toBeLessThan(250);
  });
});
