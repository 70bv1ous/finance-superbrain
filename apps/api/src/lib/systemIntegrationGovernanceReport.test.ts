import { describe, expect, it } from "vitest";

import { InMemoryRepository } from "./InMemoryRepository.js";
import {
  buildStoredSystemIntegrationGovernanceReport,
  buildSystemIntegrationGovernanceReport,
  getSystemIntegrationGovernanceState,
} from "./systemIntegrationGovernanceReport.js";

describe("system integration governance report", () => {
  it("throttles partially degraded providers", async () => {
    const repository = new InMemoryRepository();

    const report = await buildSystemIntegrationGovernanceReport(repository, {
      refresh: true,
      integration_probe_report: {
        generated_at: new Date().toISOString(),
        timeout_ms: 1_000,
        configured_target_count: 1,
        ready_target_count: 1,
        degraded_target_count: 0,
        unknown_target_count: 0,
        summaries: [
          {
            integration: "feed",
            configured_targets: 1,
            ready_targets: 0,
            degraded_targets: 1,
            unknown_targets: 0,
            highest_status: "degraded",
          },
          {
            integration: "transcript",
            configured_targets: 0,
            ready_targets: 0,
            degraded_targets: 0,
            unknown_targets: 0,
            highest_status: "unknown",
          },
        ],
        alerts: [],
        targets: [],
      },
      integration_trend_report: {
        generated_at: new Date().toISOString(),
        window_hours: 24,
        bucket_hours: 4,
        slices: [
          {
            integration: "feed",
            operation_name: "feed_pull",
            counts: {
              completed: 0,
              failed: 0,
              retry_scheduled: 0,
              non_retryable_failures: 0,
              stale_recovered: 0,
            },
            trend_signal: "quiet",
            latest_incident_at: null,
            buckets: [],
          },
          {
            integration: "transcript",
            operation_name: "transcript_pull",
            counts: {
              completed: 0,
              failed: 0,
              retry_scheduled: 0,
              non_retryable_failures: 0,
              stale_recovered: 0,
            },
            trend_signal: "quiet",
            latest_incident_at: null,
            buckets: [],
          },
        ],
        alerts: [],
        recent_incidents: [],
      },
    });

    const feedState = report.states.find((state) => state.integration === "feed");

    expect(feedState?.action).toBe("throttle");
    expect(feedState?.retry_delay_seconds).toBeGreaterThan(0);
    expect(report.alerts.some((alert) => alert.signal === "governance_backpressure")).toBe(true);
  });

  it("suppresses providers that remain fully unavailable while retry pressure accumulates", async () => {
    const repository = new InMemoryRepository();

    const report = await buildSystemIntegrationGovernanceReport(repository, {
      refresh: true,
      integration_probe_report: {
        generated_at: new Date().toISOString(),
        timeout_ms: 1_000,
        configured_target_count: 2,
        ready_target_count: 0,
        degraded_target_count: 2,
        unknown_target_count: 0,
        summaries: [
          {
            integration: "feed",
            configured_targets: 1,
            ready_targets: 0,
            degraded_targets: 1,
            unknown_targets: 0,
            highest_status: "degraded",
          },
          {
            integration: "transcript",
            configured_targets: 1,
            ready_targets: 0,
            degraded_targets: 1,
            unknown_targets: 0,
            highest_status: "degraded",
          },
        ],
        alerts: [],
        targets: [],
      },
      integration_trend_report: {
        generated_at: new Date().toISOString(),
        window_hours: 24,
        bucket_hours: 4,
        slices: [
          {
            integration: "feed",
            operation_name: "feed_pull",
            counts: {
              completed: 0,
              failed: 0,
              retry_scheduled: 5,
              non_retryable_failures: 0,
              stale_recovered: 1,
            },
            trend_signal: "worsening",
            latest_incident_at: new Date().toISOString(),
            buckets: [],
          },
          {
            integration: "transcript",
            operation_name: "transcript_pull",
            counts: {
              completed: 0,
              failed: 0,
              retry_scheduled: 0,
              non_retryable_failures: 0,
              stale_recovered: 0,
            },
            trend_signal: "quiet",
            latest_incident_at: null,
            buckets: [],
          },
        ],
        alerts: [],
        recent_incidents: [],
      },
    });

    const feedState = report.states.find((state) => state.integration === "feed");

    expect(feedState?.action).toBe("suppress");
    expect(feedState?.reason).toBe("provider_outage_persistent");
    expect(report.alerts.some((alert) => alert.signal === "governance_suppression")).toBe(true);
  });

  it("reuses fresh persisted governance state without forcing new probes on queue hot paths", async () => {
    const repository = new InMemoryRepository();
    const now = new Date().toISOString();
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalFetch = globalThis.fetch;

    await repository.saveSystemIntegrationGovernanceState({
      integration: "feed",
      operation_name: "feed_pull",
      action: "throttle",
      highest_probe_status: "degraded",
      configured_targets: 2,
      ready_targets: 1,
      degraded_targets: 1,
      unknown_targets: 0,
      recent_retry_scheduled: 0,
      recent_non_retryable_failures: 0,
      recent_stale_recovered: 0,
      recent_trend_signal: "quiet",
      degraded_since: now,
      outage_since: now,
      hold_until: new Date(Date.now() + 60_000).toISOString(),
      retry_delay_seconds: 120,
      reason: "provider_outage",
      detail: "Cached governance state should be reused while it remains fresh.",
      checked_at: now,
      updated_at: now,
    });

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    globalThis.fetch = async () => {
      throw new Error("integration probe should not run for fresh cached governance state");
    };

    try {
      const state = await getSystemIntegrationGovernanceState(repository, "feed");

      expect(state.action).toBe("throttle");
      expect(state.reason).toBe("provider_outage");
      expect(state.checked_at).toBe(now);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalFeedProbeUrls === undefined) {
        delete process.env.FEED_HEALTH_PROBE_URLS;
      } else {
        process.env.FEED_HEALTH_PROBE_URLS = originalFeedProbeUrls;
      }
    }
  });

  it("refreshes cached governance once the active hold window has expired", async () => {
    const repository = new InMemoryRepository();
    const now = new Date().toISOString();
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalFetch = globalThis.fetch;
    let probeCount = 0;

    await repository.saveSystemIntegrationGovernanceState({
      integration: "feed",
      operation_name: "feed_pull",
      action: "throttle",
      highest_probe_status: "degraded",
      configured_targets: 1,
      ready_targets: 0,
      degraded_targets: 1,
      unknown_targets: 0,
      recent_retry_scheduled: 0,
      recent_non_retryable_failures: 0,
      recent_stale_recovered: 0,
      recent_trend_signal: "quiet",
      degraded_since: now,
      outage_since: null,
      hold_until: new Date(Date.now() - 1_000).toISOString(),
      retry_delay_seconds: 120,
      reason: "provider_partial_degradation",
      detail: "Expired hold window should force a refresh.",
      checked_at: now,
      updated_at: now,
    });

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    globalThis.fetch = async (input) => {
      probeCount += 1;
      expect(String(input)).toContain("feed-health");

      return new Response("<rss><channel><item>ok</item></channel></rss>", {
        status: 200,
        headers: {
          "content-type": "application/rss+xml",
        },
      });
    };

    try {
      const state = await getSystemIntegrationGovernanceState(repository, "feed");

      expect(probeCount).toBe(1);
      expect(state.action).toBe("allow");
      expect(state.hold_until).toBeNull();
      expect(state.reason).toBe("healthy");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalFeedProbeUrls === undefined) {
        delete process.env.FEED_HEALTH_PROBE_URLS;
      } else {
        process.env.FEED_HEALTH_PROBE_URLS = originalFeedProbeUrls;
      }
    }
  });

  it("refreshes only stale integrations instead of reprobeing fresh providers", async () => {
    const repository = new InMemoryRepository();
    const now = new Date().toISOString();
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalTranscriptProbeUrls = process.env.TRANSCRIPT_HEALTH_PROBE_URLS;
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];

    await repository.saveSystemIntegrationGovernanceState({
      integration: "feed",
      operation_name: "feed_pull",
      action: "allow",
      highest_probe_status: "ready",
      configured_targets: 1,
      ready_targets: 1,
      degraded_targets: 0,
      unknown_targets: 0,
      recent_retry_scheduled: 0,
      recent_non_retryable_failures: 0,
      recent_stale_recovered: 0,
      recent_trend_signal: "quiet",
      degraded_since: null,
      outage_since: null,
      hold_until: null,
      retry_delay_seconds: null,
      reason: "healthy",
      detail: "Feed state is still fresh and should be reused.",
      checked_at: now,
      updated_at: now,
    });

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    process.env.TRANSCRIPT_HEALTH_PROBE_URLS = "https://example.com/transcript-health";
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      return new Response("<html><body>ok</body></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      });
    };

    try {
      const report = await buildSystemIntegrationGovernanceReport(repository);
      const feedState = report.states.find((state) => state.integration === "feed");
      const transcriptState = report.states.find(
        (state) => state.integration === "transcript",
      );

      expect(requestedUrls).toEqual(["https://example.com/transcript-health"]);
      expect(feedState?.checked_at).toBe(now);
      expect(transcriptState?.reason).toBe("healthy");
      expect(transcriptState?.configured_targets).toBe(1);
      expect(transcriptState?.ready_targets).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;

      if (originalFeedProbeUrls === undefined) {
        delete process.env.FEED_HEALTH_PROBE_URLS;
      } else {
        process.env.FEED_HEALTH_PROBE_URLS = originalFeedProbeUrls;
      }

      if (originalTranscriptProbeUrls === undefined) {
        delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;
      } else {
        process.env.TRANSCRIPT_HEALTH_PROBE_URLS = originalTranscriptProbeUrls;
      }
    }
  });

  it("does not reuse a stored probe snapshot when governance refresh needs fresh provider data", async () => {
    const repository = new InMemoryRepository();
    const staleCheckedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalFetch = globalThis.fetch;
    let probeCount = 0;

    await repository.saveSystemIntegrationGovernanceState({
      integration: "feed",
      operation_name: "feed_pull",
      action: "throttle",
      highest_probe_status: "degraded",
      configured_targets: 1,
      ready_targets: 0,
      degraded_targets: 1,
      unknown_targets: 0,
      recent_retry_scheduled: 0,
      recent_non_retryable_failures: 0,
      recent_stale_recovered: 0,
      recent_trend_signal: "quiet",
      degraded_since: staleCheckedAt,
      outage_since: staleCheckedAt,
      hold_until: null,
      retry_delay_seconds: 120,
      reason: "provider_outage",
      detail: "This stale state should force a fresh probe refresh.",
      checked_at: staleCheckedAt,
      updated_at: staleCheckedAt,
    });

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    globalThis.fetch = async (input) => {
      probeCount += 1;
      expect(String(input)).toContain("feed-health");

      return new Response("<rss><channel><item>ok</item></channel></rss>", {
        status: 200,
        headers: {
          "content-type": "application/rss+xml",
        },
      });
    };

    try {
      const report = await buildSystemIntegrationGovernanceReport(repository, {
        integration_probe_report: {
          generated_at: new Date().toISOString(),
          timeout_ms: 1_000,
          configured_target_count: 1,
          ready_target_count: 0,
          degraded_target_count: 0,
          unknown_target_count: 1,
          summaries: [
            {
              integration: "feed",
              configured_targets: 1,
              ready_targets: 0,
              degraded_targets: 0,
              unknown_targets: 1,
              highest_status: "unknown",
            },
          ],
          alerts: [
            {
              integration: "feed",
              severity: "degraded",
              signal: "probe_snapshot_stale",
              title: "Stored probe snapshot needs attention",
              detail: "The stored probe snapshot is stale.",
              recommendation: "Refresh it.",
            },
          ],
          targets: [],
        },
      });

      expect(probeCount).toBe(1);
      expect(report.states.find((state) => state.integration === "feed")?.action).toBe("allow");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalFeedProbeUrls === undefined) {
        delete process.env.FEED_HEALTH_PROBE_URLS;
      } else {
        process.env.FEED_HEALTH_PROBE_URLS = originalFeedProbeUrls;
      }
    }
  });

  it("surfaces stale governance state through the passive read model without probing providers", async () => {
    const repository = new InMemoryRepository();
    const staleCheckedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalFetch = globalThis.fetch;

    await repository.saveSystemIntegrationGovernanceState({
      integration: "feed",
      operation_name: "feed_pull",
      action: "suppress",
      highest_probe_status: "degraded",
      configured_targets: 1,
      ready_targets: 0,
      degraded_targets: 1,
      unknown_targets: 0,
      recent_retry_scheduled: 3,
      recent_non_retryable_failures: 0,
      recent_stale_recovered: 0,
      recent_trend_signal: "worsening",
      degraded_since: staleCheckedAt,
      outage_since: staleCheckedAt,
      hold_until: new Date(Date.now() + 60_000).toISOString(),
      retry_delay_seconds: 300,
      reason: "provider_outage_persistent",
      detail: "Last known governance state before the passive read became stale.",
      checked_at: staleCheckedAt,
      updated_at: staleCheckedAt,
    });

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    globalThis.fetch = async () => {
      throw new Error("passive governance reads should not trigger live provider probes");
    };

    try {
      const report = await buildStoredSystemIntegrationGovernanceReport(repository);
      const feedState = report.states.find((state) => state.integration === "feed");

      expect(feedState?.action).toBe("allow");
      expect(feedState?.reason).toBe("governance_state_stale");
      expect(
        report.alerts.some(
          (alert) =>
            alert.integration === "feed" && alert.signal === "governance_state_stale",
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalFeedProbeUrls === undefined) {
        delete process.env.FEED_HEALTH_PROBE_URLS;
      } else {
        process.env.FEED_HEALTH_PROBE_URLS = originalFeedProbeUrls;
      }
    }
  });

  it("suppresses sustained outages even before retry pressure accumulates", async () => {
    const repository = new InMemoryRepository();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    await repository.saveSystemIntegrationGovernanceState({
      integration: "feed",
      operation_name: "feed_pull",
      action: "throttle",
      highest_probe_status: "degraded",
      configured_targets: 1,
      ready_targets: 0,
      degraded_targets: 1,
      unknown_targets: 0,
      recent_retry_scheduled: 0,
      recent_non_retryable_failures: 0,
      recent_stale_recovered: 0,
      recent_trend_signal: "quiet",
      degraded_since: tenMinutesAgo,
      outage_since: tenMinutesAgo,
      hold_until: null,
      retry_delay_seconds: 300,
      reason: "provider_outage",
      detail: "Seed prior outage history.",
      checked_at: tenMinutesAgo,
      updated_at: tenMinutesAgo,
    });

    const report = await buildSystemIntegrationGovernanceReport(repository, {
      refresh: true,
      integration_probe_report: {
        generated_at: new Date().toISOString(),
        timeout_ms: 1_000,
        configured_target_count: 2,
        ready_target_count: 0,
        degraded_target_count: 2,
        unknown_target_count: 0,
        summaries: [
          {
            integration: "feed",
            configured_targets: 1,
            ready_targets: 0,
            degraded_targets: 1,
            unknown_targets: 0,
            highest_status: "degraded",
          },
          {
            integration: "transcript",
            configured_targets: 1,
            ready_targets: 0,
            degraded_targets: 1,
            unknown_targets: 0,
            highest_status: "degraded",
          },
        ],
        alerts: [],
        targets: [],
      },
      integration_trend_report: {
        generated_at: new Date().toISOString(),
        window_hours: 24,
        bucket_hours: 4,
        slices: [
          {
            integration: "feed",
            operation_name: "feed_pull",
            counts: {
              completed: 0,
              failed: 0,
              retry_scheduled: 0,
              non_retryable_failures: 0,
              stale_recovered: 0,
            },
            trend_signal: "quiet",
            latest_incident_at: null,
            buckets: [],
          },
          {
            integration: "transcript",
            operation_name: "transcript_pull",
            counts: {
              completed: 0,
              failed: 0,
              retry_scheduled: 0,
              non_retryable_failures: 0,
              stale_recovered: 0,
            },
            trend_signal: "quiet",
            latest_incident_at: null,
            buckets: [],
          },
        ],
        alerts: [],
        recent_incidents: [],
      },
    });

    const feedState = report.states.find((state) => state.integration === "feed");

    expect(feedState?.action).toBe("suppress");
    expect(feedState?.reason).toBe("provider_outage_sustained");
    expect(feedState?.outage_since).toBe(tenMinutesAgo);
    expect(feedState?.hold_until).not.toBeNull();
    expect(
      new Date(feedState?.hold_until ?? 0).getTime() - new Date(feedState?.checked_at ?? 0).getTime(),
    ).toBeGreaterThanOrEqual(1_200_000);
  });

  it("extends throttle hold windows for long-running partial degradation", async () => {
    const repository = new InMemoryRepository();
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    await repository.saveSystemIntegrationGovernanceState({
      integration: "feed",
      operation_name: "feed_pull",
      action: "throttle",
      highest_probe_status: "degraded",
      configured_targets: 1,
      ready_targets: 0,
      degraded_targets: 1,
      unknown_targets: 0,
      recent_retry_scheduled: 0,
      recent_non_retryable_failures: 0,
      recent_stale_recovered: 0,
      recent_trend_signal: "quiet",
      degraded_since: twentyMinutesAgo,
      outage_since: null,
      hold_until: null,
      retry_delay_seconds: 120,
      reason: "provider_partial_degradation",
      detail: "Seed prior partial degradation history.",
      checked_at: twentyMinutesAgo,
      updated_at: twentyMinutesAgo,
    });

    const report = await buildSystemIntegrationGovernanceReport(repository, {
      refresh: true,
      integration_probe_report: {
        generated_at: new Date().toISOString(),
        timeout_ms: 1_000,
        configured_target_count: 2,
        ready_target_count: 1,
        degraded_target_count: 1,
        unknown_target_count: 0,
        summaries: [
          {
            integration: "feed",
            configured_targets: 2,
            ready_targets: 1,
            degraded_targets: 1,
            unknown_targets: 0,
            highest_status: "degraded",
          },
          {
            integration: "transcript",
            configured_targets: 0,
            ready_targets: 0,
            degraded_targets: 0,
            unknown_targets: 0,
            highest_status: "unknown",
          },
        ],
        alerts: [],
        targets: [],
      },
      integration_trend_report: {
        generated_at: new Date().toISOString(),
        window_hours: 24,
        bucket_hours: 4,
        slices: [
          {
            integration: "feed",
            operation_name: "feed_pull",
            counts: {
              completed: 0,
              failed: 0,
              retry_scheduled: 0,
              non_retryable_failures: 0,
              stale_recovered: 0,
            },
            trend_signal: "quiet",
            latest_incident_at: null,
            buckets: [],
          },
          {
            integration: "transcript",
            operation_name: "transcript_pull",
            counts: {
              completed: 0,
              failed: 0,
              retry_scheduled: 0,
              non_retryable_failures: 0,
              stale_recovered: 0,
            },
            trend_signal: "quiet",
            latest_incident_at: null,
            buckets: [],
          },
        ],
        alerts: [],
        recent_incidents: [],
      },
    });

    const feedState = report.states.find((state) => state.integration === "feed");

    expect(feedState?.action).toBe("throttle");
    expect(feedState?.degraded_since).toBe(twentyMinutesAgo);
    expect(feedState?.hold_until).not.toBeNull();
    expect(
      new Date(feedState?.hold_until ?? 0).getTime() - new Date(feedState?.checked_at ?? 0).getTime(),
    ).toBeGreaterThanOrEqual(540_000);
  });
});
