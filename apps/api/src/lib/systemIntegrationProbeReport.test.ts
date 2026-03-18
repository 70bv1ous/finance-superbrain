import { describe, expect, it } from "vitest";

import {
  buildSystemIntegrationProbeReport,
  buildStoredSystemIntegrationProbeReport,
  captureSystemIntegrationProbeReport,
  resolveIntegrationProbeTimeoutMs,
} from "./systemIntegrationProbeReport.js";
import { InMemoryRepository } from "./InMemoryRepository.js";

describe("system integration probe report", () => {
  it("probes configured feed and transcript targets and classifies provider health", async () => {
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("feed")) {
        return new Response("<rss><channel><title>Finance Feed</title></channel></rss>", {
          status: 200,
          headers: {
            "content-type": "application/rss+xml",
          },
        });
      }

      return new Response("upstream failure", {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "content-type": "text/html",
        },
      });
    };

    const report = await buildSystemIntegrationProbeReport({
      feed_urls: "https://example.com/feed.xml",
      transcript_urls: "https://example.com/transcript.html",
      timeout_ms: 1_000,
      fetch_impl: fetchMock,
    });

    expect(report.configured_target_count).toBe(2);
    expect(report.ready_target_count).toBe(1);
    expect(report.degraded_target_count).toBe(1);
    expect(report.summaries.find((summary) => summary.integration === "feed")?.highest_status).toBe(
      "ready",
    );
    expect(
      report.summaries.find((summary) => summary.integration === "transcript")?.highest_status,
    ).toBe("degraded");
    expect(
      report.targets.find((target) => target.integration === "transcript")?.status_code,
    ).toBe(503);
    expect(
      report.alerts.some(
        (alert) =>
          alert.integration === "transcript" &&
          alert.signal === "probe_outage" &&
          alert.severity === "critical",
      ),
    ).toBe(true);
  });

  it("normalizes invalid timeout inputs to a safe bounded probe timeout", () => {
    expect(resolveIntegrationProbeTimeoutMs("undefined")).toBe(5_000);
    expect(resolveIntegrationProbeTimeoutMs("-25")).toBe(250);
    expect(resolveIntegrationProbeTimeoutMs("60000")).toBe(30_000);
  });

  it("persists probe snapshots and lets dashboard-style reads reuse them without reprobeing", async () => {
    const repository = new InMemoryRepository();
    let fetchCount = 0;
    const fetchMock: typeof fetch = async (input) => {
      fetchCount += 1;
      const url = String(input);

      if (url.includes("feed")) {
        return new Response("<rss><channel><item>ok</item></channel></rss>", {
          status: 200,
          headers: {
            "content-type": "application/rss+xml",
          },
        });
      }

      return new Response("<html><body>ok</body></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      });
    };

    const captured = await captureSystemIntegrationProbeReport(repository, {
      feed_urls: "https://example.com/feed.xml",
      transcript_urls: "https://example.com/transcript.html",
      timeout_ms: 1_000,
      fetch_impl: fetchMock,
    });

    const stored = await buildStoredSystemIntegrationProbeReport(repository, {
      timeout_ms: 1_000,
    });

    expect(fetchCount).toBe(2);
    expect(captured.ready_target_count).toBe(2);
    expect(stored.ready_target_count).toBe(2);
    expect(
      stored.summaries.find((summary) => summary.integration === "feed")?.highest_status,
    ).toBe("ready");
    expect(
      stored.summaries.find((summary) => summary.integration === "transcript")?.highest_status,
    ).toBe("ready");
  });

  it("does not emit missing snapshot alerts when probe URLs are not configured", async () => {
    const repository = new InMemoryRepository();

    const stored = await buildStoredSystemIntegrationProbeReport(repository, {
      feed_urls: "",
      transcript_urls: "",
      timeout_ms: 1_000,
    });

    expect(
      stored.alerts.some((alert) => alert.signal === "probe_snapshot_missing"),
    ).toBe(false);
    expect(stored.unknown_target_count).toBe(2);
  });

  it("emits missing snapshot alerts when probe URLs are configured but no snapshot exists", async () => {
    const repository = new InMemoryRepository();

    const stored = await buildStoredSystemIntegrationProbeReport(repository, {
      feed_urls: "https://example.com/feed.xml",
      transcript_urls: "https://example.com/transcript.html",
      timeout_ms: 1_000,
    });

    expect(
      stored.alerts.filter((alert) => alert.signal === "probe_snapshot_missing"),
    ).toHaveLength(2);
  });
});
