import { describe, expect, it } from "vitest"

import { resolveApiBaseUrl } from "@/lib/apiClient"

describe("resolveApiBaseUrl", () => {
  it("uses runtime api url when provided in the page shell", () => {
    expect(
      resolveApiBaseUrl({
        browserOrigin: "http://localhost:3000",
        runtimeApiUrl: "http://localhost:3099",
      }),
    ).toBe("http://localhost:3099")
  })

  it("falls back to the browser host on port 3001 when no runtime api url is available", () => {
    expect(
      resolveApiBaseUrl({
        browserOrigin: "http://localhost:3000",
        env: {
          NEXT_PUBLIC_API_URL: "http://localhost:3099",
        },
        runtimeApiUrl: null,
      }),
    ).toBe("http://localhost:3001")
  })

  it("uses server env when browser origin is not provided", () => {
    expect(
      resolveApiBaseUrl({
        env: {
          API_URL: "http://api.internal:4100",
        },
      }),
    ).toBe("http://api.internal:4100")
  })
})
