import { systemIntegrationGovernanceReportSchema } from "@finance-superbrain/schemas";
import type {
  SystemIntegration,
  SystemIntegrationAlert,
  SystemIntegrationGovernanceReport,
  SystemIntegrationGovernanceState,
  SystemIntegrationProbeReport,
  SystemIntegrationProbeSummary,
  SystemIntegrationTrendReport,
  SystemIntegrationTrendSlice,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";
import {
  buildSystemIntegrationProbeReport,
  captureSystemIntegrationProbeReport,
  resolveIntegrationProbeTimeoutMs,
} from "./systemIntegrationProbeReport.js";
import { buildSystemIntegrationTrendReport } from "./systemIntegrationTrendReport.js";

const integrationOperations: Record<SystemIntegration, SystemIntegrationGovernanceState["operation_name"]> = {
  feed: "feed_pull",
  transcript: "transcript_pull",
};

const allIntegrations = Object.keys(integrationOperations) as SystemIntegration[];
const defaultGovernanceFreshnessMs = 5 * 60 * 1000;
const defaultDegradedDelaySeconds = 120;
const defaultOutageDelaySeconds = 300;
const defaultThrottleHoldSeconds = 180;
const defaultSuppressionHoldSeconds = 600;
const defaultPersistentOutageSeconds = 300;

const parseBooleanEnv = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
};

const resolveBoundedNumber = (
  value: string | number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(normalized)));
};

export const resolveIntegrationGovernanceFreshnessMs = (value: string | number | undefined) =>
  resolveBoundedNumber(value, defaultGovernanceFreshnessMs, 1_000, 60 * 60 * 1000);

export const resolveIntegrationGovernanceDelaySeconds = (
  value: string | number | undefined,
  fallback: number,
) => resolveBoundedNumber(value, fallback, 1, 60 * 60);

export const resolveIntegrationGovernanceHoldSeconds = (
  value: string | number | undefined,
  fallback: number,
) => resolveBoundedNumber(value, fallback, 1, 24 * 60 * 60);

export const resolveIntegrationGovernanceEnabled = (value: string | undefined) =>
  parseBooleanEnv(value) ?? true;

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

const buildFallbackState = (
  integration: SystemIntegration,
  generatedAt: string,
): SystemIntegrationGovernanceState => ({
  integration,
  operation_name: integrationOperations[integration],
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
  reason: "state_uninitialized",
  detail:
    "No persisted integration governance state exists yet. Run readiness checks, the operational dashboard, or a queued integration route to refresh provider governance.",
  checked_at: generatedAt,
  updated_at: generatedAt,
});

const buildStoredGovernanceAlert = (
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
    "Stored governance snapshot needs attention",
    detail,
    recommendation,
  );

const isOutageState = (state: Pick<SystemIntegrationGovernanceState, "ready_targets" | "degraded_targets">) =>
  state.ready_targets === 0 && state.degraded_targets > 0;

const isDegradedState = (
  state: Pick<SystemIntegrationGovernanceState, "degraded_targets">,
) => state.degraded_targets > 0;

const resolveConditionStartedAt = (input: {
  checked_at: string;
  previous_state: SystemIntegrationGovernanceState | null;
  previous_condition_active: boolean;
  previous_started_at: string | null;
  condition_active: boolean;
}) => {
  if (!input.condition_active) {
    return null;
  }

  if (
    input.previous_state &&
    input.previous_condition_active &&
    input.previous_started_at !== null
  ) {
    return input.previous_started_at;
  }

  return input.checked_at;
};

const resolveStateDurationSeconds = (startedAt: string | null, checkedAt: string) => {
  if (!startedAt) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor((new Date(checkedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );
};

const formatDurationSeconds = (seconds: number) => {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 60 * 60) {
    return `${Math.floor(seconds / 60)}m`;
  }

  return `${Math.floor(seconds / (60 * 60))}h`;
};

const resolveAdaptiveHoldSeconds = (input: {
  base_hold_seconds: number;
  duration_seconds: number;
  persistent_seconds: number;
  recent_retry_scheduled: number;
  recent_non_retryable_failures: number;
  recent_stale_recovered: number;
  recent_trend_signal: SystemIntegrationTrendSlice["trend_signal"];
  mode: "degraded" | "outage";
}) => {
  let multiplier = 1;

  if (input.duration_seconds >= input.persistent_seconds * (input.mode === "outage" ? 4 : 3)) {
    multiplier = Math.max(multiplier, 3);
  } else if (input.duration_seconds >= input.persistent_seconds * 2) {
    multiplier = Math.max(multiplier, 2);
  }

  if (
    input.recent_retry_scheduled >= 5 ||
    input.recent_non_retryable_failures > 0 ||
    input.recent_stale_recovered > 0 ||
    input.recent_trend_signal === "worsening"
  ) {
    multiplier = Math.max(multiplier, 2);
  }

  return input.base_hold_seconds * multiplier;
};

const resolveHoldUntil = (input: {
  checked_at: string;
  hold_seconds: number;
  previous_hold_until: string | null;
}) => {
  const checkedAtMs = new Date(input.checked_at).getTime();
  const previousHoldMs = input.previous_hold_until
    ? new Date(input.previous_hold_until).getTime()
    : Number.NaN;
  const nextHoldMs = checkedAtMs + input.hold_seconds * 1000;

  return new Date(
    Math.max(
      nextHoldMs,
      Number.isFinite(previousHoldMs) && previousHoldMs > checkedAtMs ? previousHoldMs : 0,
    ),
  ).toISOString();
};

const buildState = (input: {
  integration: SystemIntegration;
  summary: SystemIntegrationProbeSummary | null;
  trend: SystemIntegrationTrendSlice | null;
  previous_state: SystemIntegrationGovernanceState | null;
  checked_at: string;
  enabled: boolean;
  degraded_delay_seconds: number;
  outage_delay_seconds: number;
  throttle_hold_seconds: number;
  suppression_hold_seconds: number;
  persistent_outage_seconds: number;
}): SystemIntegrationGovernanceState => {
  const summary = input.summary;
  const trend = input.trend;
  const previousState = input.previous_state;
  const configuredTargets = summary?.configured_targets ?? 0;
  const readyTargets = summary?.ready_targets ?? 0;
  const degradedTargets = summary?.degraded_targets ?? 0;
  const unknownTargets = summary?.unknown_targets ?? 0;
  const recentRetryScheduled = trend?.counts.retry_scheduled ?? 0;
  const recentNonRetryableFailures = trend?.counts.non_retryable_failures ?? 0;
  const recentStaleRecovered = trend?.counts.stale_recovered ?? 0;
  const recentTrendSignal = trend?.trend_signal ?? "quiet";
  const degradedSince = resolveConditionStartedAt({
    checked_at: input.checked_at,
    previous_state: previousState,
    previous_condition_active: previousState ? isDegradedState(previousState) : false,
    previous_started_at: previousState?.degraded_since ?? null,
    condition_active: degradedTargets > 0,
  });
  const outageSince = resolveConditionStartedAt({
    checked_at: input.checked_at,
    previous_state: previousState,
    previous_condition_active: previousState ? isOutageState(previousState) : false,
    previous_started_at: previousState?.outage_since ?? null,
    condition_active: readyTargets === 0 && degradedTargets > 0,
  });
  const degradedDurationSeconds = resolveStateDurationSeconds(degradedSince, input.checked_at);
  const outageDurationSeconds = resolveStateDurationSeconds(outageSince, input.checked_at);
  const sustainedOutage =
    outageSince !== null && outageDurationSeconds >= input.persistent_outage_seconds;

  let action: SystemIntegrationGovernanceState["action"] = "allow";
  let retryDelaySeconds: number | null = null;
  let reason = "healthy";
  let detail = "Provider probes and queued job trends do not currently require queue backpressure.";
  let holdUntil: string | null = null;

  if (!input.enabled) {
    reason = "governance_disabled";
    detail =
      "Integration governance is disabled by configuration, so provider probe signals are currently visible but not enforced.";
  } else if (!summary || configuredTargets === 0) {
    reason = "probe_targets_unconfigured";
    detail =
      "No active probe targets are configured for this provider, so governance remains in allow mode until probe URLs are supplied.";
  } else if (readyTargets === 0 && degradedTargets > 0) {
    const persistentPressure =
      recentRetryScheduled >= 3 ||
      recentNonRetryableFailures > 0 ||
      recentStaleRecovered > 0 ||
      recentTrendSignal === "worsening";
    const heldSuppression =
      previousState?.action === "suppress" &&
      previousState.hold_until !== null &&
      new Date(previousState.hold_until).getTime() > new Date(input.checked_at).getTime();

    const adaptiveSuppressionHoldSeconds = resolveAdaptiveHoldSeconds({
      base_hold_seconds: input.suppression_hold_seconds,
      duration_seconds: outageDurationSeconds,
      persistent_seconds: input.persistent_outage_seconds,
      recent_retry_scheduled: recentRetryScheduled,
      recent_non_retryable_failures: recentNonRetryableFailures,
      recent_stale_recovered: recentStaleRecovered,
      recent_trend_signal: recentTrendSignal,
      mode: "outage",
    });
    const adaptiveThrottleHoldSeconds = resolveAdaptiveHoldSeconds({
      base_hold_seconds: input.throttle_hold_seconds,
      duration_seconds: outageDurationSeconds,
      persistent_seconds: input.persistent_outage_seconds,
      recent_retry_scheduled: recentRetryScheduled,
      recent_non_retryable_failures: recentNonRetryableFailures,
      recent_stale_recovered: recentStaleRecovered,
      recent_trend_signal: recentTrendSignal,
      mode: "outage",
    });
    action = persistentPressure || sustainedOutage || heldSuppression ? "suppress" : "throttle";
    retryDelaySeconds = input.outage_delay_seconds;
    holdUntil = resolveHoldUntil({
      checked_at: input.checked_at,
      hold_seconds:
        action === "suppress"
          ? Math.max(input.outage_delay_seconds, adaptiveSuppressionHoldSeconds)
          : Math.max(input.outage_delay_seconds, adaptiveThrottleHoldSeconds),
      previous_hold_until:
        action === previousState?.action ? previousState?.hold_until ?? null : null,
    });
    reason = sustainedOutage
      ? "provider_outage_sustained"
      : persistentPressure || heldSuppression
        ? "provider_outage_persistent"
        : "provider_outage";
    detail =
      action === "suppress"
        ? `Active probes show a full ${input.integration} outage that has remained degraded for ${formatDurationSeconds(outageDurationSeconds)} and/or accumulated queued pressure (${recentRetryScheduled} retry event(s), ${recentNonRetryableFailures} permanent failure(s), ${recentStaleRecovered} stale recovery event(s)), so queued pulls stay suppressed through ${holdUntil}.`
        : `Active probes show a full ${input.integration} outage that has remained degraded for ${formatDurationSeconds(outageDurationSeconds)}, so new queued pulls are being slowed until provider health recovers. Backpressure is held through ${holdUntil}.`;
  } else if (degradedTargets > 0) {
    const adaptiveThrottleHoldSeconds = resolveAdaptiveHoldSeconds({
      base_hold_seconds: input.throttle_hold_seconds,
      duration_seconds: degradedDurationSeconds,
      persistent_seconds: input.persistent_outage_seconds,
      recent_retry_scheduled: recentRetryScheduled,
      recent_non_retryable_failures: recentNonRetryableFailures,
      recent_stale_recovered: recentStaleRecovered,
      recent_trend_signal: recentTrendSignal,
      mode: "degraded",
    });
    action = "throttle";
    retryDelaySeconds = input.degraded_delay_seconds;
    holdUntil = resolveHoldUntil({
      checked_at: input.checked_at,
      hold_seconds: Math.max(input.degraded_delay_seconds, adaptiveThrottleHoldSeconds),
      previous_hold_until:
        previousState?.action === "throttle" ? previousState.hold_until ?? null : null,
    });
    reason = "provider_partial_degradation";
    detail = `Active probes show partial ${input.integration} degradation (${readyTargets}/${configuredTargets} target(s) healthy) that has persisted for ${formatDurationSeconds(degradedDurationSeconds)}, so new queued pulls are being rate-limited through ${holdUntil}.`;
  }

  return {
    integration: input.integration,
    operation_name: integrationOperations[input.integration],
    action,
    highest_probe_status: summary?.highest_status ?? "unknown",
    configured_targets: configuredTargets,
    ready_targets: readyTargets,
    degraded_targets: degradedTargets,
    unknown_targets: unknownTargets,
    recent_retry_scheduled: recentRetryScheduled,
    recent_non_retryable_failures: recentNonRetryableFailures,
    recent_stale_recovered: recentStaleRecovered,
    recent_trend_signal: recentTrendSignal,
    degraded_since: degradedSince,
    outage_since: outageSince,
    hold_until: holdUntil,
    retry_delay_seconds: retryDelaySeconds,
    reason,
    detail,
    checked_at: input.checked_at,
    updated_at: input.checked_at,
  };
};

const buildAlerts = (
  states: SystemIntegrationGovernanceState[],
): SystemIntegrationAlert[] =>
  states.flatMap((state) => {
    if (state.action === "suppress") {
      return [
        buildAlert(
          state.integration,
          "critical",
          "governance_suppression",
          "Provider governance is suppressing new queued pulls",
          state.detail,
          `Hold new ${state.integration} queue work until active probes recover and the current governance hold window (${state.hold_until ?? "pending refresh"}) expires, then let the next governance refresh clear suppression automatically.`,
        ),
      ];
    }

    if (state.action === "throttle") {
      return [
        buildAlert(
          state.integration,
          "degraded",
          "governance_backpressure",
          "Provider governance is throttling queued pulls",
          state.detail,
          `Allow queue backpressure to slow ${state.integration} pulls while you inspect provider health and retry buildup through the current hold window (${state.hold_until ?? "pending refresh"}).`,
        ),
      ];
    }

    return [];
  });

const isStateFresh = (
  state: SystemIntegrationGovernanceState,
  freshnessMs: number,
  generatedAt: Date,
) => {
  const ageMs = generatedAt.getTime() - new Date(state.checked_at).getTime();
  const holdExpired =
    state.action !== "allow" &&
    state.hold_until !== null &&
    new Date(state.hold_until).getTime() <= generatedAt.getTime();

  return ageMs <= freshnessMs && !holdExpired;
};

const canReuseIntegrationProbeReport = (
  report: SystemIntegrationProbeReport,
  integrations: SystemIntegration[],
) => {
  const integrationSet = new Set(integrations);
  const hasCoverage = integrations.every((integration) =>
    report.summaries.some((summary) => summary.integration === integration),
  );

  if (!hasCoverage) {
    return false;
  }

  return !report.alerts.some(
    (alert) =>
      integrationSet.has(alert.integration) &&
      (alert.signal === "probe_snapshot_missing" || alert.signal === "probe_snapshot_stale"),
  );
};

const sortStates = (states: SystemIntegrationGovernanceState[]) =>
  [...states].sort((left, right) => left.integration.localeCompare(right.integration));

const sortIntegrations = (integrations: SystemIntegration[]) =>
  [...integrations].sort((left, right) => left.localeCompare(right));

type StoredSystemIntegrationGovernanceSnapshotPlan = {
  report: SystemIntegrationGovernanceReport;
  refresh_integrations: SystemIntegration[];
  refresh_state_token: string | null;
  freshness_ms: number;
  refresh_state_tokens: Partial<Record<SystemIntegration, string>>;
};

const buildStoredGovernanceState = (input: {
  state: SystemIntegrationGovernanceState;
  reason: string;
  detail: string;
}) => ({
  ...input.state,
  action: "allow" as const,
  hold_until: null,
  retry_delay_seconds: null,
  reason: input.reason,
  detail: input.detail,
});

const persistStates = async (
  repository: Repository,
  states: SystemIntegrationGovernanceState[],
) =>
  Promise.all(
    states.map((state) => repository.saveSystemIntegrationGovernanceState(state)),
  );

export const buildStoredSystemIntegrationGovernanceSnapshotPlan = async (
  repository: Repository,
  options: {
    integrations?: SystemIntegration[];
    freshness_ms?: number;
  } = {},
): Promise<StoredSystemIntegrationGovernanceSnapshotPlan> => {
  const generatedAt = new Date();
  const generatedAtIso = generatedAt.toISOString();
  const freshnessMs = resolveIntegrationGovernanceFreshnessMs(
    options.freshness_ms ?? process.env.INTEGRATION_GOVERNANCE_FRESHNESS_MS,
  );
  const integrations = options.integrations?.length ? options.integrations : allIntegrations;
  const existingStates = await repository.listSystemIntegrationGovernanceStates({
    integrations,
  });
  const existingByIntegration = new Map(
    existingStates.map((state) => [state.integration, state] as const),
  );
  const refreshTokens: Partial<Record<SystemIntegration, string>> = {};
  const staleAlerts: SystemIntegrationAlert[] = [];

  const states = integrations.map((integration) => {
    const state = existingByIntegration.get(integration);

    if (!state) {
      refreshTokens[integration] = "missing";
      staleAlerts.push(
        buildStoredGovernanceAlert(
          integration,
          "degraded",
          "governance_state_missing",
          `No stored ${integration} governance snapshot exists yet, so dashboards and health checks cannot show authoritative provider queue policy until one is refreshed.`,
          `Refresh ${integration} governance in the background worker before relying on passive operational views for this integration.`,
        ),
      );
      return buildFallbackState(integration, generatedAtIso);
    }

    const stateAgeMs = Math.max(
      0,
      generatedAt.getTime() - new Date(state.checked_at).getTime(),
    );
    const holdExpired =
      state.action !== "allow" &&
      state.hold_until !== null &&
      new Date(state.hold_until).getTime() <= generatedAt.getTime();

    if (isStateFresh(state, freshnessMs, generatedAt) && !holdExpired) {
      return state;
    }

    const snapshotSeverity: SystemIntegrationAlert["severity"] =
      state.action === "suppress" ? "critical" : "degraded";

    if (holdExpired) {
      refreshTokens[integration] = `hold-expired:${state.checked_at}:${state.hold_until}`;
      staleAlerts.push(
        buildStoredGovernanceAlert(
          integration,
          snapshotSeverity,
          "governance_hold_expired",
          `The stored ${integration} governance hold expired at ${state.hold_until}, so the dashboard is showing the last known provider policy while a fresh governance refresh is still pending.`,
          `Refresh ${integration} governance now so passive monitoring reflects the current queue policy instead of an expired hold window.`,
        ),
      );
      return buildStoredGovernanceState({
        state,
        reason: "governance_hold_expired",
        detail: `The last known ${integration} governance action was ${state.action}, but its hold window expired at ${state.hold_until}. Passive monitoring is waiting for a fresh governance refresh before it reports an authoritative queue policy again.`,
      });
    }

    refreshTokens[integration] = `stale:${state.checked_at}`;
    staleAlerts.push(
      buildStoredGovernanceAlert(
        integration,
        snapshotSeverity,
        "governance_state_stale",
        `The stored ${integration} governance snapshot is ${Math.floor(stateAgeMs / 1000)}s old, which is older than the configured freshness window.`,
        `Refresh ${integration} governance so dashboards and health checks stop relying on stale queue policy state for this integration.`,
      ),
    );

    return buildStoredGovernanceState({
      state,
      reason: "governance_state_stale",
      detail: `The last known ${integration} governance action was ${state.action}, but the snapshot is now ${Math.floor(stateAgeMs / 1000)}s old. Passive monitoring is waiting for a fresh governance refresh before it reports an authoritative queue policy again.`,
    });
  });

  const refreshIntegrations = sortIntegrations(Object.keys(refreshTokens) as SystemIntegration[]);

  return {
    report: systemIntegrationGovernanceReportSchema.parse({
      generated_at: generatedAtIso,
      freshness_ms: freshnessMs,
      states: sortStates(states),
      alerts: [...buildAlerts(states), ...staleAlerts],
    }),
    refresh_integrations: refreshIntegrations,
    refresh_state_token:
      refreshIntegrations.length === 0
        ? null
        : refreshIntegrations
            .map((integration) => `${integration}:${refreshTokens[integration]}`)
            .join("|"),
    freshness_ms: freshnessMs,
    refresh_state_tokens: refreshTokens,
  };
};

export const buildStoredSystemIntegrationGovernanceReport = async (
  repository: Repository,
  options: {
    integrations?: SystemIntegration[];
    freshness_ms?: number;
  } = {},
) => {
  const plan = await buildStoredSystemIntegrationGovernanceSnapshotPlan(repository, options);
  return plan.report;
};

export const buildSystemIntegrationGovernanceReport = async (
  repository: Repository,
  options: {
    integrations?: SystemIntegration[];
    refresh?: boolean;
    freshness_ms?: number;
    timeout_ms?: number;
    integration_probe_report?: SystemIntegrationProbeReport;
    integration_trend_report?: SystemIntegrationTrendReport;
  } = {},
): Promise<SystemIntegrationGovernanceReport> => {
  const generatedAt = new Date();
  const freshnessMs = resolveIntegrationGovernanceFreshnessMs(
    options.freshness_ms ?? process.env.INTEGRATION_GOVERNANCE_FRESHNESS_MS,
  );
  const integrations = options.integrations?.length ? options.integrations : allIntegrations;
  const existingStates = await repository.listSystemIntegrationGovernanceStates({
    integrations,
  });
  const existingByIntegration = new Map(
    existingStates.map((state) => [state.integration, state] as const),
  );
  const staleOrMissing = integrations.filter((integration) => {
    const state = existingByIntegration.get(integration);
    return !state || !isStateFresh(state, freshnessMs, generatedAt);
  });

  let states =
    staleOrMissing.length === 0 && !options.refresh
      ? integrations.map(
          (integration) =>
            existingByIntegration.get(integration) ??
            buildFallbackState(integration, generatedAt.toISOString()),
        )
      : [];

  if (staleOrMissing.length > 0 || options.refresh) {
    const refreshIntegrations = options.refresh ? integrations : staleOrMissing;
    const reusableProbeReport =
      options.integration_probe_report &&
      canReuseIntegrationProbeReport(options.integration_probe_report, refreshIntegrations)
        ? options.integration_probe_report
        : undefined;
    const [probeReport, trendReport] = await Promise.all([
      reusableProbeReport ??
        captureSystemIntegrationProbeReport(repository, {
          integrations: refreshIntegrations,
          timeout_ms: resolveIntegrationProbeTimeoutMs(
            options.timeout_ms ?? process.env.INTEGRATION_PROBE_TIMEOUT_MS,
          ),
        }),
      options.integration_trend_report ??
        buildSystemIntegrationTrendReport(repository, {
          window_hours: 24,
          bucket_hours: 4,
          recent_limit: 12,
        }),
    ]);

    const probeSummaryByIntegration = new Map(
      probeReport.summaries.map((summary) => [summary.integration, summary] as const),
    );
    const trendByIntegration = new Map(
      trendReport.slices.map((slice) => [slice.integration, slice] as const),
    );

    const refreshedStates = await persistStates(
      repository,
      refreshIntegrations.map((integration) =>
        buildState({
          integration,
          summary: probeSummaryByIntegration.get(integration) ?? null,
          trend: trendByIntegration.get(integration) ?? null,
          previous_state: existingByIntegration.get(integration) ?? null,
          checked_at: generatedAt.toISOString(),
          enabled: resolveIntegrationGovernanceEnabled(
            process.env.INTEGRATION_GOVERNANCE_ENABLED,
          ),
          degraded_delay_seconds: resolveIntegrationGovernanceDelaySeconds(
            process.env.INTEGRATION_GOVERNANCE_DEGRADED_DELAY_SECONDS,
            defaultDegradedDelaySeconds,
          ),
          outage_delay_seconds: resolveIntegrationGovernanceDelaySeconds(
            process.env.INTEGRATION_GOVERNANCE_OUTAGE_DELAY_SECONDS,
            defaultOutageDelaySeconds,
          ),
          throttle_hold_seconds: resolveIntegrationGovernanceHoldSeconds(
            process.env.INTEGRATION_GOVERNANCE_THROTTLE_HOLD_SECONDS,
            defaultThrottleHoldSeconds,
          ),
          suppression_hold_seconds: resolveIntegrationGovernanceHoldSeconds(
            process.env.INTEGRATION_GOVERNANCE_SUPPRESSION_HOLD_SECONDS,
            defaultSuppressionHoldSeconds,
          ),
          persistent_outage_seconds: resolveIntegrationGovernanceHoldSeconds(
            process.env.INTEGRATION_GOVERNANCE_PERSISTENT_OUTAGE_SECONDS,
            defaultPersistentOutageSeconds,
          ),
        }),
      ),
    );
    const refreshedByIntegration = new Map(
      refreshedStates.map((state) => [state.integration, state] as const),
    );

    states = integrations.map(
      (integration) =>
        refreshedByIntegration.get(integration) ??
        existingByIntegration.get(integration) ??
        buildFallbackState(integration, generatedAt.toISOString()),
    );
  }

  return systemIntegrationGovernanceReportSchema.parse({
    generated_at: generatedAt.toISOString(),
    freshness_ms: freshnessMs,
    states: sortStates(states),
    alerts: buildAlerts(states),
  });
};

export const getSystemIntegrationGovernanceState = async (
  repository: Repository,
  integration: SystemIntegration,
  options: {
    refresh?: boolean;
    freshness_ms?: number;
    timeout_ms?: number;
  } = {},
) => {
  const report = await buildSystemIntegrationGovernanceReport(repository, {
    integrations: [integration],
    refresh: options.refresh,
    freshness_ms: options.freshness_ms,
    timeout_ms: options.timeout_ms,
  });

  return report.states[0] ?? buildFallbackState(integration, new Date().toISOString());
};

export class IntegrationGovernanceSuppressedError extends Error {
  readonly integration: SystemIntegration;
  readonly retry_delay_seconds: number | null;
  readonly state: SystemIntegrationGovernanceState;

  constructor(state: SystemIntegrationGovernanceState) {
    super(
      `Queued ${state.integration} pulls are currently suppressed by provider governance: ${state.detail}`,
    );
    this.name = "IntegrationGovernanceSuppressedError";
    this.integration = state.integration;
    this.retry_delay_seconds = state.retry_delay_seconds;
    this.state = state;
  }
}
