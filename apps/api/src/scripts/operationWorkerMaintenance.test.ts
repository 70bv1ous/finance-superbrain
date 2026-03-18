import { afterEach, describe, expect, it } from "vitest";

import { InMemoryRepository } from "../lib/InMemoryRepository.js";
import { MockMarketDataProvider } from "../lib/MockMarketDataProvider.js";
import { buildServices } from "../lib/services.js";
import { createOperationWorkerMaintenanceRunner } from "./operationWorkerMaintenance.js";

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

describe("operation worker maintenance", () => {
  const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
  const originalTranscriptProbeUrls = process.env.TRANSCRIPT_HEALTH_PROBE_URLS;

  afterEach(() => {
    restoreEnv("FEED_HEALTH_PROBE_URLS", originalFeedProbeUrls);
    restoreEnv("TRANSCRIPT_HEALTH_PROBE_URLS", originalTranscriptProbeUrls);
  });

  it("enqueues a background probe snapshot refresh when a configured snapshot is missing", async () => {
    const repository = new InMemoryRepository();
    const services = buildServices({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;

    const runner = createOperationWorkerMaintenanceRunner(services, {
      supported_operations: ["integration_probe_snapshot"],
      background_probe_refresh_interval_ms: 1_000,
      background_probe_refresh_enabled: true,
    });

    const result = await runner.runDueMaintenance("2026-03-15T10:00:00.000Z");

    expect(result.integration_probe_snapshot.checked).toBe(true);
    expect(result.integration_probe_snapshot.refresh_needed).toBe(true);
    expect(result.integration_probe_snapshot.enqueued).toBe(true);

    const jobs = await repository.listOperationJobs({
      operation_names: ["integration_probe_snapshot"],
      statuses: ["pending"],
      limit: 10,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload.integrations).toEqual(["feed"]);
  });

  it("skips background probe refresh when snapshots are already fresh", async () => {
    const repository = new InMemoryRepository();
    const services = buildServices({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });
    const now = new Date().toISOString();

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;

    await repository.saveSystemIntegrationProbeState({
      integration: "feed",
      timeout_ms: 1_000,
      configured_targets: 1,
      ready_targets: 1,
      degraded_targets: 0,
      unknown_targets: 0,
      highest_status: "ready",
      targets: [
        {
          integration: "feed",
          url: "https://example.com/feed-health.xml",
          status: "ready",
          latency_ms: 12,
          status_code: 200,
          content_type: "application/rss+xml",
          detail: null,
          checked_at: now,
        },
      ],
      checked_at: now,
      updated_at: now,
    });

    const runner = createOperationWorkerMaintenanceRunner(services, {
      supported_operations: ["integration_probe_snapshot"],
      background_probe_refresh_interval_ms: 1_000,
      background_probe_refresh_enabled: true,
    });

    const result = await runner.runDueMaintenance(now);

    expect(result.integration_probe_snapshot.checked).toBe(true);
    expect(result.integration_probe_snapshot.refresh_needed).toBe(false);
    expect(result.integration_probe_snapshot.enqueued).toBe(false);

    const jobs = await repository.listOperationJobs({
      operation_names: ["integration_probe_snapshot"],
      limit: 10,
    });

    expect(jobs).toHaveLength(0);
  });

  it("does not enqueue a duplicate probe refresh while one is already pending", async () => {
    const repository = new InMemoryRepository();
    const services = buildServices({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;

    await repository.enqueueOperationJob({
      operation_name: "integration_probe_snapshot",
      triggered_by: "internal",
      payload: {
        integrations: ["feed"],
        timeout_ms: 1_000,
      },
      idempotency_key: "existing-probe-refresh",
      max_attempts: 1,
      available_at: "2026-03-15T10:00:00.000Z",
    });

    const runner = createOperationWorkerMaintenanceRunner(services, {
      supported_operations: ["integration_probe_snapshot"],
      background_probe_refresh_interval_ms: 1_000,
      background_probe_refresh_enabled: true,
    });

    const result = await runner.runDueMaintenance("2026-03-15T10:00:05.000Z");

    expect(result.integration_probe_snapshot.checked).toBe(true);
    expect(result.integration_probe_snapshot.refresh_needed).toBe(true);
    expect(result.integration_probe_snapshot.enqueued).toBe(false);
    expect(result.integration_probe_snapshot.skipped_reason).toBe("active_job");

    const jobs = await repository.listOperationJobs({
      operation_names: ["integration_probe_snapshot"],
      statuses: ["pending"],
      limit: 10,
    });

    expect(jobs).toHaveLength(1);
  });

  it("enqueues a background governance refresh when governance state is missing but probe snapshots are fresh", async () => {
    const repository = new InMemoryRepository();
    const services = buildServices({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });
    const now = new Date().toISOString();

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;

    await repository.saveSystemIntegrationProbeState({
      integration: "feed",
      timeout_ms: 1_000,
      configured_targets: 1,
      ready_targets: 1,
      degraded_targets: 0,
      unknown_targets: 0,
      highest_status: "ready",
      targets: [
        {
          integration: "feed",
          url: "https://example.com/feed-health.xml",
          status: "ready",
          latency_ms: 12,
          status_code: 200,
          content_type: "application/rss+xml",
          detail: null,
          checked_at: now,
        },
      ],
      checked_at: now,
      updated_at: now,
    });
    await repository.saveSystemIntegrationGovernanceState({
      integration: "transcript",
      operation_name: "transcript_pull",
      action: "allow",
      highest_probe_status: "unknown",
      configured_targets: 0,
      ready_targets: 0,
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
      reason: "probe_targets_unconfigured",
      detail: "Transcript integration is intentionally unconfigured in this test.",
      checked_at: now,
      updated_at: now,
    });

    const runner = createOperationWorkerMaintenanceRunner(services, {
      supported_operations: ["integration_probe_snapshot", "integration_governance_refresh"],
      background_probe_refresh_interval_ms: 1_000,
      background_governance_refresh_interval_ms: 1_000,
      background_probe_refresh_enabled: true,
      background_governance_refresh_enabled: true,
    });

    const result = await runner.runDueMaintenance(now);

    expect(result.integration_probe_snapshot.refresh_needed).toBe(false);
    expect(result.integration_governance_refresh.checked).toBe(true);
    expect(result.integration_governance_refresh.refresh_needed).toBe(true);
    expect(result.integration_governance_refresh.enqueued).toBe(true);

    const jobs = await repository.listOperationJobs({
      operation_names: ["integration_governance_refresh"],
      statuses: ["pending"],
      limit: 10,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload.integrations).toEqual(["feed"]);
  });

  it("defers governance refresh when probe snapshots still need a background refresh", async () => {
    const repository = new InMemoryRepository();
    const services = buildServices({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });
    const now = new Date().toISOString();

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;

    await repository.saveSystemIntegrationGovernanceState({
      integration: "transcript",
      operation_name: "transcript_pull",
      action: "allow",
      highest_probe_status: "unknown",
      configured_targets: 0,
      ready_targets: 0,
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
      reason: "probe_targets_unconfigured",
      detail: "Transcript integration is intentionally unconfigured in this test.",
      checked_at: now,
      updated_at: now,
    });

    const runner = createOperationWorkerMaintenanceRunner(services, {
      supported_operations: ["integration_probe_snapshot", "integration_governance_refresh"],
      background_probe_refresh_interval_ms: 1_000,
      background_governance_refresh_interval_ms: 1_000,
      background_probe_refresh_enabled: true,
      background_governance_refresh_enabled: true,
    });

    const result = await runner.runDueMaintenance(now);

    expect(result.integration_probe_snapshot.enqueued).toBe(true);
    expect(result.integration_governance_refresh.checked).toBe(true);
    expect(result.integration_governance_refresh.enqueued).toBe(false);
    expect(result.integration_governance_refresh.skipped_reason).toBe("probe_snapshot_pending");
  });
});
