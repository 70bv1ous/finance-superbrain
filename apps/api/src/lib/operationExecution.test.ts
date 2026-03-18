import { afterEach, describe, expect, it } from "vitest";

import { InMemoryRepository } from "./InMemoryRepository.js";
import { LocalEmbeddingProvider } from "./LocalEmbeddingProvider.js";
import { MockMarketDataProvider } from "./MockMarketDataProvider.js";
import { drainOperationJobs, processNextOperationJob } from "./operationJobs.js";
import { runTrackedOperation } from "./operationRuns.js";
import { buildServices } from "./services.js";
import { createOperationWorkerReporter } from "../scripts/operationWorkerRuntime.js";
import {
  OperationWorkerServiceBackoffActiveError,
  createOperationWorkerServiceReporter,
  OperationWorkerServiceOwnershipError,
} from "../scripts/operationWorkerServiceRuntime.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const originalFetch = globalThis.fetch;

class HeartbeatTrackingRepository extends InMemoryRepository {
  leaseRenewalCount = 0;
  jobHeartbeatCount = 0;

  override async renewOperationLease(
    input: Parameters<InMemoryRepository["renewOperationLease"]>[0],
  ) {
    this.leaseRenewalCount += 1;
    return super.renewOperationLease(input);
  }

  override async heartbeatOperationJob(
    input: Parameters<InMemoryRepository["heartbeatOperationJob"]>[0],
  ) {
    this.jobHeartbeatCount += 1;
    return super.heartbeatOperationJob(input);
  }
}

class SlowAutoScoreRepository extends HeartbeatTrackingRepository {
  override async listPendingPredictionsReadyForScoring(asOf: string) {
    await sleep(90);
    return super.listPendingPredictionsReadyForScoring(asOf);
  }
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
});

describe("operation execution heartbeats", () => {
  it("renews tracked operation leases while long work is still running", async () => {
    const repository = new HeartbeatTrackingRepository();

    const result = await runTrackedOperation(
      {
        repository,
        operation_name: "auto_score",
        triggered_by: "internal",
        lease: {
          scope_key: "global",
          ttl_ms: 40,
          heartbeat_interval_ms: 10,
        },
      },
      async () => {
        await sleep(90);
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(repository.leaseRenewalCount).toBeGreaterThan(0);
    expect(
      await repository.listOperationLeases({
        active_only: false,
      }),
    ).toHaveLength(0);
  });

  it("heartbeats queued jobs so long-running work does not rely on a fixed lease TTL", async () => {
    const repository = new SlowAutoScoreRepository();

    const queued = await repository.enqueueOperationJob({
      operation_name: "auto_score",
      triggered_by: "script",
      payload: {
        create_postmortems: false,
      },
      max_attempts: 1,
      available_at: new Date().toISOString(),
    });

    const result = await processNextOperationJob(
      {
        repository,
        marketDataProvider: new MockMarketDataProvider(),
        embeddingProvider: new LocalEmbeddingProvider(),
      },
      {
        worker_id: "worker-test",
        lease_ttl_ms: 40,
        heartbeat_interval_ms: 10,
      },
    );

    expect(result).not.toBeNull();
    expect(result?.job.id).toBe(queued.id);
    expect(result?.job.status).toBe("completed");
    expect(repository.jobHeartbeatCount).toBeGreaterThan(0);
    expect(repository.leaseRenewalCount).toBeGreaterThan(0);
    expect((await repository.getOperationJob(queued.id))?.status).toBe("completed");
  });

  it("abandons stale queued jobs once their lease expires after the final attempt", async () => {
    const repository = new InMemoryRepository();
    const now = new Date();
    const nowIso = now.toISOString();
    const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();

    const queued = await repository.enqueueOperationJob({
      operation_name: "auto_score",
      triggered_by: "script",
      payload: {
        create_postmortems: false,
      },
      max_attempts: 1,
      available_at: nowIso,
    });

    const claimed = await repository.claimNextOperationJob({
      worker_id: "worker-stale",
      as_of: nowIso,
      lease_expires_at: oneMinuteAgo,
      supported_operations: ["auto_score"],
    });

    expect(claimed?.status).toBe("running");

    const drainResult = await drainOperationJobs(
      {
        repository,
        marketDataProvider: new MockMarketDataProvider(),
        embeddingProvider: new LocalEmbeddingProvider(),
      },
      {
        worker_id: "worker-recovery",
        max_jobs: 1,
        supported_operations: ["auto_score"],
      },
    );

    expect(drainResult.abandoned).toBe(1);
    expect(drainResult.processed).toBe(0);

    const stored = await repository.getOperationJob(queued.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.error_message).toContain("lease expired");
    expect(stored?.lease_owner).toBeNull();
    expect(stored?.lease_expires_at).toBeNull();
  });

  it("does not retry non-retryable feed integration failures", async () => {
    const repository = new InMemoryRepository();
    globalThis.fetch = async () =>
      new Response("missing", {
        status: 404,
        statusText: "Not Found",
      });

    const queued = await repository.enqueueOperationJob({
      operation_name: "feed_pull",
      triggered_by: "script",
      payload: {
        feeds: [
          {
            url: "https://example.com/missing-feed.xml",
            max_items: 1,
          },
        ],
        parse_events: true,
      },
      max_attempts: 3,
      available_at: new Date().toISOString(),
    });

    const result = await processNextOperationJob(
      {
        repository,
        marketDataProvider: new MockMarketDataProvider(),
        embeddingProvider: new LocalEmbeddingProvider(),
      },
      {
        worker_id: "worker-feed",
      },
    );

    expect(result).not.toBeNull();
    expect(result?.job.id).toBe(queued.id);
    expect(result?.retry_scheduled).toBe(false);

    const stored = await repository.getOperationJob(queued.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.result_summary.retryable).toBe(false);
    expect(stored?.result_summary.integration).toBe("feed");
    expect(stored?.result_summary.status_code).toBe(404);
  });

  it("retries retryable transcript integration failures", async () => {
    const repository = new InMemoryRepository();
    globalThis.fetch = async () =>
      new Response("busy", {
        status: 503,
        statusText: "Service Unavailable",
      });

    const queued = await repository.enqueueOperationJob({
      operation_name: "transcript_pull",
      triggered_by: "script",
      payload: {
        items: [
          {
            url: "https://example.com/transcript",
            max_chars: 2000,
          },
        ],
        parse_events: true,
      },
      max_attempts: 3,
      available_at: new Date().toISOString(),
    });

    const result = await processNextOperationJob(
      {
        repository,
        marketDataProvider: new MockMarketDataProvider(),
        embeddingProvider: new LocalEmbeddingProvider(),
      },
      {
        worker_id: "worker-transcript",
      },
    );

    expect(result).not.toBeNull();
    expect(result?.job.id).toBe(queued.id);
    expect(result?.retry_scheduled).toBe(true);

    const stored = await repository.getOperationJob(queued.id);
    expect(stored?.status).toBe("pending");
    expect(stored?.result_summary.retryable).toBe(true);
    expect(stored?.result_summary.integration).toBe("transcript");
    expect(stored?.result_summary.status_code).toBe(503);
    expect(stored?.available_at.localeCompare(queued.available_at)).toBeGreaterThanOrEqual(0);
  });

  it("uses Retry-After guidance when rescheduling retryable integration failures", async () => {
    const repository = new InMemoryRepository();
    globalThis.fetch = async () =>
      new Response("rate limited", {
        status: 429,
        statusText: "Too Many Requests",
        headers: {
          "retry-after": "120",
        },
      });

    const queued = await repository.enqueueOperationJob({
      operation_name: "feed_pull",
      triggered_by: "script",
      payload: {
        feeds: [
          {
            url: "https://example.com/rate-limited.xml",
            max_items: 1,
          },
        ],
        parse_events: true,
      },
      max_attempts: 3,
      available_at: new Date().toISOString(),
    });

    const startedAt = Date.now();
    const result = await processNextOperationJob(
      {
        repository,
        marketDataProvider: new MockMarketDataProvider(),
        embeddingProvider: new LocalEmbeddingProvider(),
      },
      {
        worker_id: "worker-rate-limit",
      },
    );

    expect(result?.retry_scheduled).toBe(true);

    const stored = await repository.getOperationJob(queued.id);
    expect(stored?.status).toBe("pending");
    expect(stored?.result_summary.retry_after_seconds).toBe(120);
    expect(stored?.result_summary.retry_delay_seconds).toBe(120);
    expect(new Date(stored?.available_at ?? 0).getTime() - startedAt).toBeGreaterThanOrEqual(119_000);
  });

  it("captures and persists integration probe snapshots through the queued operation worker", async () => {
    const repository = new InMemoryRepository();
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalTranscriptProbeUrls = process.env.TRANSCRIPT_HEALTH_PROBE_URLS;

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;
    globalThis.fetch = async (input) => {
      const url = String(input);

      if (url.includes("feed-health")) {
        return new Response("<rss><channel><item><title>ready</title></item></channel></rss>", {
          status: 200,
          headers: {
            "content-type": "application/rss+xml",
          },
        });
      }

      throw new Error(`Unexpected fetch in probe snapshot test: ${url}`);
    };

    try {
      const queued = await repository.enqueueOperationJob({
        operation_name: "integration_probe_snapshot",
        triggered_by: "internal",
        payload: {
          integrations: ["feed"],
          timeout_ms: 1_000,
        },
        max_attempts: 1,
        available_at: new Date().toISOString(),
      });

      const result = await processNextOperationJob(
        {
          repository,
          marketDataProvider: new MockMarketDataProvider(),
          embeddingProvider: new LocalEmbeddingProvider(),
        },
        {
          worker_id: "worker-probes",
          supported_operations: ["integration_probe_snapshot"],
        },
      );

      expect(result).not.toBeNull();
      expect(result?.job.id).toBe(queued.id);
      expect(result?.job.status).toBe("completed");
      expect(result?.retry_scheduled).toBe(false);

      const storedState = (
        await repository.listSystemIntegrationProbeStates({
          integrations: ["feed"],
        })
      )[0];

      expect(storedState).toBeDefined();
      expect(storedState?.configured_targets).toBe(1);
      expect(storedState?.ready_targets).toBe(1);
      expect(storedState?.degraded_targets).toBe(0);
      expect(storedState?.highest_status).toBe("ready");
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

  it("refreshes and persists integration governance through the queued operation worker", async () => {
    const repository = new InMemoryRepository();
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalTranscriptProbeUrls = process.env.TRANSCRIPT_HEALTH_PROBE_URLS;
    const now = new Date().toISOString();

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;

    await repository.saveSystemIntegrationProbeState({
      integration: "feed",
      timeout_ms: 1_000,
      configured_targets: 1,
      ready_targets: 0,
      degraded_targets: 1,
      unknown_targets: 0,
      highest_status: "degraded",
      targets: [
        {
          integration: "feed",
          url: "https://example.com/feed-health.xml",
          status: "degraded",
          latency_ms: 25,
          status_code: 503,
          content_type: "application/rss+xml",
          detail: "provider unavailable",
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

    try {
      const queued = await repository.enqueueOperationJob({
        operation_name: "integration_governance_refresh",
        triggered_by: "internal",
        payload: {
          integrations: ["feed"],
          freshness_ms: 300_000,
          timeout_ms: 1_000,
        },
        max_attempts: 1,
        available_at: now,
      });

      const result = await processNextOperationJob(
        {
          repository,
          marketDataProvider: new MockMarketDataProvider(),
          embeddingProvider: new LocalEmbeddingProvider(),
        },
        {
          worker_id: "worker-governance",
          supported_operations: ["integration_governance_refresh"],
        },
      );

      expect(result).not.toBeNull();
      expect(result?.job.id).toBe(queued.id);
      expect(result?.job.status).toBe("completed");
      expect(result?.retry_scheduled).toBe(false);

      const storedState = (
        await repository.listSystemIntegrationGovernanceStates({
          integrations: ["feed"],
        })
      )[0];

      expect(storedState).toBeDefined();
      expect(storedState?.action).toBe("throttle");
      expect(storedState?.reason).toBe("provider_outage");
      expect(storedState?.retry_delay_seconds).toBeGreaterThan(0);
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

  it("defers queued integration work when provider governance applies backpressure", async () => {
    const repository = new InMemoryRepository();
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalTranscriptProbeUrls = process.env.TRANSCRIPT_HEALTH_PROBE_URLS;
    const originalGovernanceEnabled = process.env.INTEGRATION_GOVERNANCE_ENABLED;
    const originalFetch = globalThis.fetch;

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    if (originalTranscriptProbeUrls === undefined) {
      delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;
    }
    process.env.INTEGRATION_GOVERNANCE_ENABLED = "true";
    globalThis.fetch = async (input) => {
      const url = String(input);

      if (url.includes("feed-health")) {
        return new Response("provider unavailable", {
          status: 503,
          statusText: "Service Unavailable",
          headers: {
            "content-type": "application/rss+xml",
          },
        });
      }

      throw new Error(`Unexpected fetch in governance deferral test: ${url}`);
    };

    try {
      const queued = await repository.enqueueOperationJob({
        operation_name: "feed_pull",
        triggered_by: "script",
        payload: {
          feeds: [
            {
              url: "https://example.com/feed.xml",
              max_items: 1,
            },
          ],
          parse_events: true,
        },
        max_attempts: 3,
        available_at: new Date().toISOString(),
      });

      const result = await processNextOperationJob(
        {
          repository,
          marketDataProvider: new MockMarketDataProvider(),
          embeddingProvider: new LocalEmbeddingProvider(),
        },
        {
          worker_id: "worker-governed-feed",
        },
      );

      expect(result).not.toBeNull();
      expect(result?.retry_scheduled).toBe(true);

      const stored = await repository.getOperationJob(queued.id);
      expect(stored?.status).toBe("pending");
      expect(stored?.attempt_count).toBe(0);
      expect(stored?.result_summary.governance_action).toBe("throttle");
      expect(stored?.result_summary.integration).toBe("feed");
      expect(new Date(stored?.available_at ?? 0).getTime()).toBeGreaterThan(Date.now());
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
      if (originalGovernanceEnabled === undefined) {
        delete process.env.INTEGRATION_GOVERNANCE_ENABLED;
      } else {
        process.env.INTEGRATION_GOVERNANCE_ENABLED = originalGovernanceEnabled;
      }
    }
  });

  it("persists durable worker lifecycle events for start, cycle completion, and stop", async () => {
    const repository = new InMemoryRepository();
    const services = buildServices({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
      embeddingProvider: new LocalEmbeddingProvider(),
    });
    const reporter = createOperationWorkerReporter(services, {
      worker_id: "worker-events",
      supported_operations: ["scheduled_evolution"],
      poll_interval_ms: 2_000,
      idle_backoff_ms: 5_000,
      heartbeat_interval_ms: 50,
    });

    await reporter.start();
    const cycleStartedAt = await reporter.markCycleStart();
    await reporter.recordCycle({
      started_at: cycleStartedAt,
      finished_at: new Date().toISOString(),
      processed: 3,
      completed: 2,
      failed: 1,
      retried: 1,
      abandoned: 0,
      error_message: null,
    });
    await reporter.stop("worker loop exited");

    const events = await repository.listOperationWorkerEvents({
      worker_id: "worker-events",
      limit: 10,
    });

    expect(events).toHaveLength(3);
    expect(events.map((event) => event.event_type).sort()).toEqual(["cycle", "started", "stopped"]);
    const cycleEvent = events.find((event) => event.event_type === "cycle");
    const stopEvent = events.find((event) => event.event_type === "stopped");
    expect(cycleEvent?.cycle_processed).toBe(3);
    expect(cycleEvent?.cycle_failed).toBe(1);
    expect(stopEvent?.error_message).toBe("worker loop exited");
  });

  it("persists durable worker service state across restart backoff and terminal failure", async () => {
    const repository = new InMemoryRepository();
    const reporter = createOperationWorkerServiceReporter(repository, {
      service_id: "worker-service-primary",
      worker_id: "worker-events",
      supported_operations: ["scheduled_evolution", "feed_pull"],
      supervisor_pid: 4242,
      supervisor_host: "host-alpha",
      supervisor_instance_id: "supervisor-instance-alpha",
      invocation_mode: "current_runtime",
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 50,
      max_restarts: 3,
    });

    await reporter.start();
    await reporter.markLoopStart();
    await reporter.recordLoopExit({
      runtime_ms: 500,
      exit_code: 1,
      exit_signal: null,
      scheduled_restart: true,
      restart_backoff_ms: 10_000,
      error_message: "worker loop exited with code 1",
    });

    const backoffState = await repository.getOperationWorkerService("worker-service-primary");
    expect(backoffState?.lifecycle_state).toBe("backing_off");
    expect(backoffState?.restart_count).toBe(1);
    expect(backoffState?.restart_streak).toBe(1);
    expect(backoffState?.current_restart_backoff_ms).toBe(10_000);

    await reporter.fail("worker restart limit exceeded");

    const services = await repository.listOperationWorkerServices({
      limit: 5,
    });

    expect(services).toHaveLength(1);
    expect(services[0].service_id).toBe("worker-service-primary");
    expect(services[0].worker_id).toBe("worker-events");
    expect(services[0].lifecycle_state).toBe("failed");
    expect(services[0].supervisor_pid).toBe(4242);
    expect(services[0].supervisor_host).toBe("host-alpha");
    expect(services[0].supervisor_instance_id).toBe("supervisor-instance-alpha");
    expect(services[0].invocation_mode).toBe("current_runtime");
    expect(services[0].restart_count).toBe(1);
    expect(services[0].restart_streak).toBe(1);
    expect(services[0].current_restart_backoff_ms).toBeNull();
    expect(services[0].last_exit_code).toBe(1);
    expect(services[0].last_loop_runtime_ms).toBe(500);
    expect(services[0].last_error_message).toBe("worker restart limit exceeded");
    expect(services[0].stopped_at).not.toBeNull();

    const events = await repository.listOperationWorkerServiceEvents({
      service_id: "worker-service-primary",
      limit: 10,
    });

    expect(events.map((event) => event.event_type).sort()).toEqual([
      "failed",
      "loop_exit",
      "started",
    ]);
    expect(events.find((event) => event.event_type === "loop_exit")?.scheduled_restart).toBe(true);
    expect(events.find((event) => event.event_type === "loop_exit")?.metadata.restart_backoff_ms).toBe(
      10_000,
    );
  });

  it("rejects duplicate fresh worker-service ownership from another supervisor", async () => {
    const repository = new InMemoryRepository();
    const primary = createOperationWorkerServiceReporter(repository, {
      service_id: "worker-service-primary",
      worker_id: "worker-a",
      supported_operations: ["scheduled_evolution"],
      supervisor_pid: 111,
      supervisor_host: "host-a",
      supervisor_instance_id: "instance-a",
      invocation_mode: "current_runtime",
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 50,
      max_restarts: 3,
    });
    const duplicate = createOperationWorkerServiceReporter(repository, {
      service_id: "worker-service-primary",
      worker_id: "worker-b",
      supported_operations: ["feed_pull"],
      supervisor_pid: 222,
      supervisor_host: "host-b",
      supervisor_instance_id: "instance-b",
      invocation_mode: "tsx_binary",
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 50,
      max_restarts: 3,
    });

    await primary.start();

    await expect(duplicate.start()).rejects.toBeInstanceOf(
      OperationWorkerServiceOwnershipError,
    );

    const services = await repository.listOperationWorkerServices({
      limit: 10,
    });

    expect(services).toHaveLength(1);
    expect(await repository.getOperationWorkerService("worker-service-primary")).not.toBeNull();
    expect(services[0].worker_id).toBe("worker-a");
    expect(services[0].supervisor_pid).toBe(111);
    expect(services[0].supervisor_host).toBe("host-a");
    expect(services[0].supervisor_instance_id).toBe("instance-a");

    const events = await repository.listOperationWorkerServiceEvents({
      service_id: "worker-service-primary",
      limit: 10,
    });

    expect(events.some((event) => event.event_type === "ownership_conflict")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event_type === "ownership_conflict" &&
          event.worker_id === "worker-b" &&
          event.metadata.conflicting_supervisor_host === "host-a" &&
          event.metadata.attempted_supervisor_instance_id === "instance-b" &&
          event.metadata.conflicting_supervisor_instance_id === "instance-a",
      ),
    ).toBe(true);

    await primary.stop(null);
  });

  it("forces a new supervisor to respect durable restart backoff before taking ownership", async () => {
    const repository = new InMemoryRepository();
    const now = new Date();
    const fiveSecondsAgo = new Date(now.getTime() - 5_000).toISOString();
    await repository.upsertOperationWorkerService({
      service_id: "worker-service-primary",
      worker_id: "worker-a",
      lifecycle_state: "backing_off",
      supported_operations: ["scheduled_evolution"],
      supervisor_pid: 111,
      supervisor_host: "host-a",
      supervisor_instance_id: "instance-a",
      invocation_mode: "current_runtime",
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 5_000,
      max_restarts: 3,
      restart_count: 2,
      restart_streak: 2,
      current_restart_backoff_ms: 30_000,
      heartbeat_at: fiveSecondsAgo,
      started_at: new Date(now.getTime() - 60_000).toISOString(),
      last_loop_finished_at: fiveSecondsAgo,
      last_error_message: "worker loop exited with code 1",
    });

    const replacement = createOperationWorkerServiceReporter(repository, {
      service_id: "worker-service-primary",
      worker_id: "worker-b",
      supported_operations: ["scheduled_evolution"],
      supervisor_pid: 222,
      supervisor_host: "host-b",
      supervisor_instance_id: "instance-b",
      invocation_mode: "current_runtime",
      supervisor_backoff_ms: 5_000,
      success_window_ms: 60_000,
      heartbeat_interval_ms: 50,
      max_restarts: 3,
    });

    await expect(replacement.start()).rejects.toBeInstanceOf(
      OperationWorkerServiceBackoffActiveError,
    );

    const stored = await repository.getOperationWorkerService("worker-service-primary");
    expect(stored?.worker_id).toBe("worker-a");
    expect(stored?.lifecycle_state).toBe("backing_off");
    expect(stored?.current_restart_backoff_ms).toBe(30_000);
  });
});
