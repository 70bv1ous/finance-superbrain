import { systemIntegrationProbeReportSchema } from "@finance-superbrain/schemas";
import type {
  SystemIntegrationAlert,
  SystemIntegration,
  SystemIntegrationProbeReport,
  SystemIntegrationProbeState,
  SystemIntegrationProbeStatus,
  SystemIntegrationProbeSummary,
  SystemIntegrationProbeTarget,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

type FetchLike = typeof fetch;

const defaultProbeTimeoutMs = 5_000;
const defaultProbeSnapshotFreshnessMs = 5 * 60 * 1000;

export const resolveIntegrationProbeTimeoutMs = (
  value: string | number | undefined,
  fallbackMs = defaultProbeTimeoutMs,
) => {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const normalized = Number.isFinite(numericValue) ? numericValue : fallbackMs;

  return Math.max(250, Math.min(30_000, Math.floor(normalized)));
};

export const resolveIntegrationProbeSnapshotFreshnessMs = (
  value: string | number | undefined,
  fallbackMs = defaultProbeSnapshotFreshnessMs,
) => {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const normalized = Number.isFinite(numericValue) ? numericValue : fallbackMs;

  return Math.max(1_000, Math.min(24 * 60 * 60 * 1000, Math.floor(normalized)));
};

const parseProbeTargets = (
  integration: SystemIntegration,
  value: string | undefined,
): Array<{ integration: SystemIntegration; url: string }> =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((url) => ({ integration, url }));

const resolveConfiguredProbeTargets = (options: {
  integrations: SystemIntegration[];
  feed_urls?: string;
  transcript_urls?: string;
}) => [
  ...(options.integrations.includes("feed")
    ? parseProbeTargets("feed", options.feed_urls ?? process.env.FEED_HEALTH_PROBE_URLS)
    : []),
  ...(options.integrations.includes("transcript")
    ? parseProbeTargets(
        "transcript",
        options.transcript_urls ?? process.env.TRANSCRIPT_HEALTH_PROBE_URLS,
      )
    : []),
];

const buildConfiguredProbeTargetCountByIntegration = (
  configuredTargets: Array<{ integration: SystemIntegration; url: string }>,
  integrations: SystemIntegration[],
) => {
  const counts = new Map<SystemIntegration, number>(
    integrations.map((integration) => [integration, 0]),
  );

  for (const target of configuredTargets) {
    counts.set(target.integration, (counts.get(target.integration) ?? 0) + 1);
  }

  return counts;
};

const buildUnknownTarget = (
  integration: SystemIntegration,
  url: string,
  checkedAt: string,
  detail: string,
): SystemIntegrationProbeTarget => ({
  integration,
  url,
  status: "unknown",
  latency_ms: null,
  status_code: null,
  content_type: null,
  detail,
  checked_at: checkedAt,
});

const buildDegradedTarget = (input: {
  integration: SystemIntegration;
  url: string;
  checked_at: string;
  latency_ms: number;
  detail: string;
  status_code?: number | null;
  content_type?: string | null;
}): SystemIntegrationProbeTarget => ({
  integration: input.integration,
  url: input.url,
  status: "degraded",
  latency_ms: input.latency_ms,
  status_code: input.status_code ?? null,
  content_type: input.content_type ?? null,
  detail: input.detail,
  checked_at: input.checked_at,
});

const buildReadyTarget = (input: {
  integration: SystemIntegration;
  url: string;
  checked_at: string;
  latency_ms: number;
  status_code?: number | null;
  content_type?: string | null;
  detail?: string | null;
}): SystemIntegrationProbeTarget => ({
  integration: input.integration,
  url: input.url,
  status: "ready",
  latency_ms: input.latency_ms,
  status_code: input.status_code ?? null,
  content_type: input.content_type ?? null,
  detail: input.detail ?? null,
  checked_at: input.checked_at,
});

const isFeedPayloadPlausible = (contentType: string, body: string) => {
  const normalizedBody = body.toLowerCase();
  return (
    contentType.includes("xml") ||
    normalizedBody.includes("<rss") ||
    normalizedBody.includes("<feed") ||
    normalizedBody.includes("<rdf:rdf") ||
    normalizedBody.includes("<item")
  );
};

const isTranscriptPayloadPlausible = (contentType: string, body: string) => {
  const trimmed = body.trim();
  const normalizedBody = trimmed.toLowerCase();

  if (trimmed.length < 20) {
    return false;
  }

  return (
    contentType.includes("html") ||
    contentType.includes("text/plain") ||
    normalizedBody.includes("<html") ||
    normalizedBody.includes("<body") ||
    normalizedBody.includes("<article") ||
    normalizedBody.includes("<main")
  );
};

const probeTarget = async (
  target: { integration: SystemIntegration; url: string },
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<SystemIntegrationProbeTarget> => {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetchImpl(target.url, {
      method: "GET",
      headers: {
        Accept:
          target.integration === "feed"
            ? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1"
            : "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8, */*;q=0.1",
      },
      signal: abortController.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

    if (!response.ok) {
      return buildDegradedTarget({
        integration: target.integration,
        url: target.url,
        checked_at: checkedAt,
        latency_ms: latencyMs,
        status_code: response.status,
        content_type: contentType || null,
        detail: `Probe returned ${response.status} ${response.statusText}.`,
      });
    }

    const body = await response.text();
    const plausible =
      target.integration === "feed"
        ? isFeedPayloadPlausible(contentType, body)
        : isTranscriptPayloadPlausible(contentType, body);

    if (!plausible) {
      return buildDegradedTarget({
        integration: target.integration,
        url: target.url,
        checked_at: checkedAt,
        latency_ms: latencyMs,
        status_code: response.status,
        content_type: contentType || null,
        detail:
          target.integration === "feed"
            ? "Probe succeeded but response did not look like an RSS or Atom feed."
            : "Probe succeeded but response did not look like a transcript or readable document.",
      });
    }

    return buildReadyTarget({
      integration: target.integration,
      url: target.url,
      checked_at: checkedAt,
      latency_ms: latencyMs,
      status_code: response.status,
      content_type: contentType || null,
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const detail =
      error instanceof Error && error.name === "AbortError"
        ? `Probe timed out after ${timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "Unknown probe failure.";

    return buildDegradedTarget({
      integration: target.integration,
      url: target.url,
      checked_at: checkedAt,
      latency_ms: latencyMs,
      detail,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const buildSummary = (
  integration: SystemIntegration,
  targets: SystemIntegrationProbeTarget[],
): SystemIntegrationProbeSummary => {
  const configuredTargets = targets.length;
  const readyTargets = targets.filter((target) => target.status === "ready").length;
  const degradedTargets = targets.filter((target) => target.status === "degraded").length;
  const unknownTargets = targets.filter((target) => target.status === "unknown").length;
  const highestStatus: SystemIntegrationProbeStatus =
    degradedTargets > 0
      ? "degraded"
      : readyTargets > 0
        ? "ready"
        : "unknown";

  return {
    integration,
    configured_targets: configuredTargets,
    ready_targets: readyTargets,
    degraded_targets: degradedTargets,
    unknown_targets: unknownTargets,
    highest_status: highestStatus,
  };
};

const buildAlert = (
  integration: SystemIntegration,
  severity: SystemIntegrationAlert["severity"],
  signal: string,
  title: string,
  detail: string,
  recommendation: string,
): SystemIntegrationAlert => ({
  integration,
  severity,
  signal,
  title,
  detail,
  recommendation,
});

const buildProbeAlerts = (
  summaries: SystemIntegrationProbeSummary[],
): SystemIntegrationAlert[] =>
  summaries.flatMap((summary) => {
    if (summary.configured_targets === 0) {
      return [];
    }

    if (summary.ready_targets === 0 && summary.degraded_targets > 0) {
      return [
        buildAlert(
          summary.integration,
          "critical",
          "probe_outage",
          "Active probes show the provider is unavailable",
          `${summary.degraded_targets}/${summary.configured_targets} ${summary.integration} probe target(s) are degraded and none are responding successfully.`,
          `Treat the ${summary.integration} provider as currently unavailable and pause reliance on queued pulls until upstream health recovers.`,
        ),
      ];
    }

    if (summary.degraded_targets > 0) {
      return [
        buildAlert(
          summary.integration,
          "degraded",
          "probe_partial_degradation",
          "Active probes show partial provider degradation",
          `${summary.ready_targets}/${summary.configured_targets} ${summary.integration} probe target(s) are healthy while ${summary.degraded_targets} are currently degraded.`,
          `Inspect the ${summary.integration} provider endpoints before probe degradation turns into queue retries or partial ingestion failures.`,
        ),
      ];
    }

    return [];
  });

const buildSnapshotAlert = (
  integration: SystemIntegration,
  severity: SystemIntegrationAlert["severity"],
  signal: string,
  detail: string,
  recommendation: string,
) =>
  buildAlert(
    integration,
    severity,
    signal,
    "Stored probe snapshot needs attention",
    detail,
    recommendation,
  );

const buildStoredPlaceholderState = (
  integration: SystemIntegration,
  generatedAt: string,
  timeoutMs: number,
  detail: string,
  configuredTargets: number,
  unknownTargets = 1,
): SystemIntegrationProbeState => ({
  integration,
  timeout_ms: timeoutMs,
  configured_targets: configuredTargets,
  ready_targets: 0,
  degraded_targets: 0,
  unknown_targets: unknownTargets,
  highest_status: "unknown",
  targets: [
    buildUnknownTarget(
      integration,
      "about:blank",
      generatedAt,
      detail,
    ),
  ],
  checked_at: generatedAt,
  updated_at: generatedAt,
});

const buildMissingStoredState = (
  integration: SystemIntegration,
  generatedAt: string,
  timeoutMs: number,
): SystemIntegrationProbeState => ({
  ...buildStoredPlaceholderState(
    integration,
    generatedAt,
    timeoutMs,
    integration === "feed"
      ? "No feed probe snapshot exists yet. Capture a live probe to persist provider health for dashboard reads."
      : "No transcript probe snapshot exists yet. Capture a live probe to persist provider health for dashboard reads.",
    0,
  ),
});

const buildUnconfiguredStoredState = (
  integration: SystemIntegration,
  generatedAt: string,
  timeoutMs: number,
): SystemIntegrationProbeState =>
  buildStoredPlaceholderState(
    integration,
    generatedAt,
    timeoutMs,
    integration === "feed"
      ? "No feed probe URLs are configured, so stored dashboard reads cannot capture provider health until FEED_HEALTH_PROBE_URLS is set."
      : "No transcript probe URLs are configured, so stored dashboard reads cannot capture provider health until TRANSCRIPT_HEALTH_PROBE_URLS is set.",
    0,
  );

const sortIntegrations = (integrations: SystemIntegration[]) =>
  [...integrations].sort((left, right) => left.localeCompare(right));

type StoredSystemIntegrationProbeSnapshotPlan = {
  report: SystemIntegrationProbeReport;
  refresh_integrations: SystemIntegration[];
  refresh_state_token: string | null;
  freshness_ms: number;
  timeout_ms: number;
};

const buildProbeReportFromStates = (
  states: SystemIntegrationProbeState[],
  generatedAt: string,
): SystemIntegrationProbeReport => {
  const sortedStates = sortIntegrations(states.map((state) => state.integration)).map(
    (integration) => states.find((state) => state.integration === integration)!,
  );
  const targets = sortedStates.flatMap((state) => state.targets);
  const realTargets = targets.filter((target) => target.url !== "about:blank");
  const summaries: SystemIntegrationProbeSummary[] = sortedStates.map((state) => ({
    integration: state.integration,
    configured_targets: state.configured_targets,
    ready_targets: state.ready_targets,
    degraded_targets: state.degraded_targets,
    unknown_targets: state.unknown_targets,
    highest_status: state.highest_status,
  }));

  return systemIntegrationProbeReportSchema.parse({
    generated_at: generatedAt,
    timeout_ms: sortedStates[0]?.timeout_ms ?? defaultProbeTimeoutMs,
    configured_target_count: summaries.reduce(
      (total, summary) => total + summary.configured_targets,
      0,
    ),
    ready_target_count: realTargets.filter((target) => target.status === "ready").length,
    degraded_target_count: realTargets.filter((target) => target.status === "degraded").length,
    unknown_target_count: targets.filter((target) => target.status === "unknown").length,
    summaries,
    alerts: buildProbeAlerts(summaries),
    targets,
  });
};

const toProbeState = (
  report: SystemIntegrationProbeReport,
  integration: SystemIntegration,
): SystemIntegrationProbeState => {
  const summary = report.summaries.find((item) => item.integration === integration) ?? {
    integration,
    configured_targets: 0,
    ready_targets: 0,
    degraded_targets: 0,
    unknown_targets: 1,
    highest_status: "unknown" as const,
  };

  return {
    integration,
    timeout_ms: report.timeout_ms,
    configured_targets: summary.configured_targets,
    ready_targets: summary.ready_targets,
    degraded_targets: summary.degraded_targets,
    unknown_targets: summary.unknown_targets,
    highest_status: summary.highest_status,
    targets: report.targets.filter((target) => target.integration === integration),
    checked_at: report.generated_at,
    updated_at: report.generated_at,
  };
};

export const buildSystemIntegrationProbeReport = async (
  options: {
    integrations?: SystemIntegration[];
    feed_urls?: string;
    transcript_urls?: string;
    timeout_ms?: number;
    fetch_impl?: FetchLike;
  } = {},
): Promise<SystemIntegrationProbeReport> => {
  const generatedAt = new Date().toISOString();
  const timeoutMs = resolveIntegrationProbeTimeoutMs(options.timeout_ms, defaultProbeTimeoutMs);
  const fetchImpl = options.fetch_impl ?? fetch;
  const integrations = options.integrations?.length
    ? options.integrations
    : (["feed", "transcript"] as const);
  const configuredTargets = resolveConfiguredProbeTargets({
    integrations: [...integrations],
    feed_urls: options.feed_urls,
    transcript_urls: options.transcript_urls,
  });

  const targets =
    configuredTargets.length === 0
      ? integrations.map((integration) =>
          buildUnknownTarget(
            integration,
            "about:blank",
            generatedAt,
            integration === "feed"
              ? "No feed probe URLs configured. Set FEED_HEALTH_PROBE_URLS to enable active provider probes."
              : "No transcript probe URLs configured. Set TRANSCRIPT_HEALTH_PROBE_URLS to enable active provider probes.",
          ),
        )
      : await Promise.all(
          configuredTargets.map((target) => probeTarget(target, timeoutMs, fetchImpl)),
        );

  const realTargets = targets.filter((target) => target.url !== "about:blank");
  const summaries: SystemIntegrationProbeSummary[] = integrations.map(
    (integration) =>
      buildSummary(
        integration,
        targets.filter((target) => target.integration === integration),
      ),
  );
  const alerts = buildProbeAlerts(summaries);

  return systemIntegrationProbeReportSchema.parse({
    generated_at: generatedAt,
    timeout_ms: timeoutMs,
    configured_target_count: configuredTargets.length,
    ready_target_count: realTargets.filter((target) => target.status === "ready").length,
    degraded_target_count: realTargets.filter((target) => target.status === "degraded").length,
    unknown_target_count: targets.filter((target) => target.status === "unknown").length,
    summaries,
    alerts,
    targets,
  });
};

export const captureSystemIntegrationProbeReport = async (
  repository: Repository,
  options: {
    integrations?: SystemIntegration[];
    feed_urls?: string;
    transcript_urls?: string;
    timeout_ms?: number;
    fetch_impl?: FetchLike;
  } = {},
) => {
  const report = await buildSystemIntegrationProbeReport(options);
  const integrations: SystemIntegration[] = options.integrations?.length
    ? [...options.integrations]
    : ["feed", "transcript"];

  await Promise.all(
    integrations.map((integration) =>
      repository.saveSystemIntegrationProbeState(toProbeState(report, integration)),
    ),
  );

  return report;
};

export const buildStoredSystemIntegrationProbeSnapshotPlan = async (
  repository: Repository,
  options: {
    integrations?: SystemIntegration[];
    freshness_ms?: number;
    timeout_ms?: number;
    feed_urls?: string;
    transcript_urls?: string;
  } = {},
) => {
  const generatedAt = new Date().toISOString();
  const integrations: SystemIntegration[] = options.integrations?.length
    ? [...options.integrations]
    : ["feed", "transcript"];
  const timeoutMs = resolveIntegrationProbeTimeoutMs(options.timeout_ms, defaultProbeTimeoutMs);
  const states = await repository.listSystemIntegrationProbeStates({
    integrations,
  });
  const stateByIntegration = new Map(
    states.map((state) => [state.integration, state] as const),
  );
  const freshnessMs = resolveIntegrationProbeSnapshotFreshnessMs(
    options.freshness_ms ?? process.env.INTEGRATION_PROBE_SNAPSHOT_FRESHNESS_MS,
  );
  const configuredTargets = resolveConfiguredProbeTargets({
    integrations,
    feed_urls: options.feed_urls,
    transcript_urls: options.transcript_urls,
  });
  const configuredTargetCountByIntegration = buildConfiguredProbeTargetCountByIntegration(
    configuredTargets,
    integrations,
  );
  const nowMs = new Date(generatedAt).getTime();
  const staleAlerts: SystemIntegrationAlert[] = [];
  const refreshTokensByIntegration = new Map<SystemIntegration, string>();

  const materializedStates = integrations.map((integration) => {
    const existing = stateByIntegration.get(integration);

    if (!existing) {
      const configuredTargetCount =
        configuredTargetCountByIntegration.get(integration) ?? 0;

      if (configuredTargetCount === 0) {
        return buildUnconfiguredStoredState(integration, generatedAt, timeoutMs);
      }

      staleAlerts.push(
        buildSnapshotAlert(
          integration,
          "degraded",
          "probe_snapshot_missing",
          `No stored ${integration} probe snapshot exists yet, so dashboard reads cannot show a real provider check until one is captured.`,
          `Run a live ${integration} probe capture through the integration probe endpoint before relying on dashboard-only provider health for this integration.`,
        ),
      );
      refreshTokensByIntegration.set(integration, "missing");
      return buildMissingStoredState(integration, generatedAt, timeoutMs);
    }

    const ageMs = Math.max(0, nowMs - new Date(existing.checked_at).getTime());

    if (ageMs > freshnessMs) {
      staleAlerts.push(
        buildSnapshotAlert(
          integration,
          "degraded",
          "probe_snapshot_stale",
          `The latest stored ${integration} probe snapshot is ${Math.floor(ageMs / 1000)}s old, which is older than the configured freshness window.`,
          `Refresh the ${integration} probe snapshot so dashboards and operator views stop relying on stale provider health data.`,
        ),
      );
      refreshTokensByIntegration.set(integration, `stale:${existing.checked_at}`);

      return {
        ...existing,
        targets: existing.targets.map((target) => ({
          ...target,
          detail:
            (target.detail
              ? `${target.detail} `
              : "") +
            `Stored probe snapshot is stale (${Math.floor(ageMs / 1000)}s old).`,
        })),
      };
    }

    return existing;
  });
  const report = buildProbeReportFromStates(materializedStates, generatedAt);

  const refreshIntegrations = sortIntegrations([...refreshTokensByIntegration.keys()]);

  return {
    report: systemIntegrationProbeReportSchema.parse({
      ...report,
      alerts: [...report.alerts, ...staleAlerts],
    }),
    refresh_integrations: refreshIntegrations,
    refresh_state_token:
      refreshIntegrations.length === 0
        ? null
        : refreshIntegrations
            .map((integration) => `${integration}:${refreshTokensByIntegration.get(integration)}`)
            .join("|"),
    freshness_ms: freshnessMs,
    timeout_ms: timeoutMs,
  } satisfies StoredSystemIntegrationProbeSnapshotPlan;
};

export const buildStoredSystemIntegrationProbeReport = async (
  repository: Repository,
  options: {
    integrations?: SystemIntegration[];
    timeout_ms?: number;
    freshness_ms?: number;
    feed_urls?: string;
    transcript_urls?: string;
  } = {},
) => {
  const plan = await buildStoredSystemIntegrationProbeSnapshotPlan(repository, options);
  return plan.report;
};
