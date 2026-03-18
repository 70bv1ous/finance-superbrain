import { describe, expect, it } from "vitest";

import { InMemoryRepository } from "./InMemoryRepository.js";
import { buildSystemIntegrationProbeReport } from "./systemIntegrationProbeReport.js";
import { buildSystemOperationalIncidentReport } from "./systemOperationalIncidentReport.js";

describe("systemOperationalIncidentReport", () => {
  it("consolidates queue, worker, supervisor, and integration incidents", async () => {
    const repository = new InMemoryRepository();
    const now = new Date();
    const nowIso = now.toISOString();
    const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();
    const twoMinutesLater = new Date(now.getTime() + 120_000).toISOString();

    await repository.enqueueOperationJob({
      operation_name: "scheduled_evolution",
      triggered_by: "schedule",
      payload: {},
      max_attempts: 1,
      available_at: nowIso,
    });

    await repository.saveOperationWorkerEvent({
      worker_id: "worker-trend",
      event_type: "stopped",
      occurred_at: oneMinuteAgo,
      lifecycle_state: "stopped",
      cycle_processed: null,
      cycle_completed: null,
      cycle_failed: null,
      cycle_retried: null,
      cycle_abandoned: null,
      error_message: "worker loop crashed",
      metadata: {
        had_error: true,
      },
    });

    await repository.upsertOperationWorkerService({
      service_id: "worker-service-primary",
      worker_id: "worker-trend",
      lifecycle_state: "failed",
      supported_operations: ["scheduled_evolution"],
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 5_000,
      max_restarts: 4,
      restart_count: 4,
      restart_streak: 4,
      heartbeat_at: oneMinuteAgo,
      started_at: oneMinuteAgo,
      last_error_message: "restart limit exceeded",
      stopped_at: nowIso,
    });
    await repository.saveOperationWorkerServiceEvent({
      service_id: "worker-service-primary",
      worker_id: "worker-contender",
      event_type: "ownership_conflict",
      occurred_at: oneMinuteAgo,
      lifecycle_state: "starting",
      scheduled_restart: null,
      restart_count: 0,
      restart_streak: 0,
      loop_runtime_ms: null,
      exit_code: null,
      exit_signal: null,
      error_message: "worker service worker-service-primary is already owned by host-a pid 111",
      metadata: {
        attempted_supervisor_host: "host-b",
        conflicting_supervisor_host: "host-a",
      },
    });

    const integrationJob = await repository.enqueueOperationJob({
      operation_name: "transcript_pull",
      triggered_by: "script",
      payload: {},
      max_attempts: 1,
      available_at: nowIso,
    });

    await repository.claimNextOperationJob({
      worker_id: "worker-transcript",
      as_of: nowIso,
      lease_expires_at: twoMinutesLater,
      supported_operations: ["transcript_pull"],
    });

    await repository.failOperationJob({
      id: integrationJob.id,
      worker_id: "worker-transcript",
      finished_at: nowIso,
      error_message: "transcript provider returned 404",
      result_summary: {
        integration: "transcript",
        retryable: false,
        status_code: 404,
      },
    });

    const probeReport = await buildSystemIntegrationProbeReport({
      feed_urls: "https://example.com/feed.xml",
      transcript_urls: "https://example.com/transcript.html",
      timeout_ms: 1_000,
      fetch_impl: async (input) => {
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
      },
    });

    const report = await buildSystemOperationalIncidentReport(repository, {
      limit: 20,
      integration_probe_report: probeReport,
    });

    expect(report.counts.high).toBeGreaterThan(0);
    expect(report.incidents.some((incident) => incident.source === "queue")).toBe(true);
    expect(report.incidents.some((incident) => incident.source === "worker")).toBe(true);
    expect(report.incidents.some((incident) => incident.source === "worker_service")).toBe(true);
    expect(report.incidents.some((incident) => incident.source === "integration")).toBe(true);
    expect(report.incidents.some((incident) => incident.signal.includes("probe_outage"))).toBe(true);
    expect(
      report.incidents.some((incident) => incident.signal === "ownership_conflicts"),
    ).toBe(true);
  });

  it("includes stored probe snapshot incidents by default only when snapshots are expected", async () => {
    const repository = new InMemoryRepository();
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalTranscriptProbeUrls = process.env.TRANSCRIPT_HEALTH_PROBE_URLS;

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed.xml";
    process.env.TRANSCRIPT_HEALTH_PROBE_URLS = "";

    try {
      const report = await buildSystemOperationalIncidentReport(repository, {
        limit: 20,
      });

      expect(
        report.incidents.some((incident) => incident.signal === "feed_probe_snapshot_missing"),
      ).toBe(true);
      expect(
        report.incidents.some((incident) => incident.signal === "transcript_probe_snapshot_missing"),
      ).toBe(false);
    } finally {
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
});
