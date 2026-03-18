import { describe, expect, it } from "vitest";

import { resolveBoundedRuntimeNumber, resolveOptionalRuntimeNumber } from "./runtimeConfig.js";

describe("runtime config parsing", () => {
  it("falls back cleanly when numeric env values are polluted", () => {
    expect(
      resolveBoundedRuntimeNumber({
        value: "undefined",
        fallback: 5_000,
        minimum: 1_000,
      }),
    ).toBe(5_000);
  });

  it("returns undefined for optional runtime values that are invalid or non-positive", () => {
    expect(
      resolveOptionalRuntimeNumber({
        value: "undefined",
        minimum: 1_000,
      }),
    ).toBeUndefined();
    expect(
      resolveOptionalRuntimeNumber({
        value: "0",
        minimum: 1_000,
      }),
    ).toBeUndefined();
  });
});
