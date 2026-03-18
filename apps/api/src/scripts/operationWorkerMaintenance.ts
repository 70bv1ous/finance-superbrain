import { createHash } from "node:crypto";

import type {
  SystemIntegration,
  SystemOperationName,
} from "@finance-superbrain/schemas";

import { enqueueOperationJobRequest, parseOperationJobPayload } from "../lib/operationJobs.js";
import type { AppServices } from "../lib/services.js";
import { buildStoredSystemIntegrationGovernanceSnapshotPlan } from "../lib/systemIntegrationGovernanceReport.js";
import { buildStoredSystemIntegrationProbeSnapshotPlan } from "../lib/systemIntegrationProbeReport.js";
import { resolveBoundedRuntimeNumber } from "./runtimeConfig.js";

const integrationProbeSnapshotOperationName = "integration_probe_snapshot" as const;
const integrationGovernanceRefreshOperationName = "integration_governance_refresh" as const;
const defaultIntegrationProbeSnapshotRefreshIntervalMs = 60_000;
const defaultIntegrationGovernanceRefreshIntervalMs = 60_000;

const parseRuntimeBoolean = (value: string | undefined) => {
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

export const resolveIntegrationProbeBackgroundRefreshEnabled = (
  value: string | undefined,
) => parseRuntimeBoolean(value) ?? true;

export const resolveIntegrationProbeBackgroundRefreshIntervalMs = (
  value: string | number | undefined,
) =>
  resolveBoundedRuntimeNumber({
    value,
    fallback: defaultIntegrationProbeSnapshotRefreshIntervalMs,
    minimum: 1_000,
    maximum: 60 * 60 * 1000,
  });

export const resolveIntegrationGovernanceBackgroundRefreshEnabled = (
  value: string | undefined,
) => parseRuntimeBoolean(value) ?? true;

export const resolveIntegrationGovernanceBackgroundRefreshIntervalMs = (
  value: string | number | undefined,
) =>
  resolveBoundedRuntimeNumber({
    value,
    fallback: defaultIntegrationGovernanceRefreshIntervalMs,
    minimum: 1_000,
    maximum: 60 * 60 * 1000,
  });

const canManageOperation = (
  supportedOperations: SystemOperationName[] | undefined,
  operationName: SystemOperationName,
) => !supportedOperations?.length || supportedOperations.includes(operationName);

const hasMatchingIntegrationSet = (
  left: SystemIntegration[],
  right: SystemIntegration[],
) => left.length === right.length && left.every((integration, index) => integration === right[index]);

const buildRefreshIdempotencyKey = (input: {
  prefix: string;
  integrations: SystemIntegration[];
  refresh_state_token: string;
  interval_bucket: number;
}) =>
  `${input.prefix}:${createHash("sha1")
    .update(
      JSON.stringify({
        integrations: input.integrations,
        refresh_state_token: input.refresh_state_token,
        interval_bucket: input.interval_bucket,
      }),
    )
    .digest("hex")}`;

const pickRefreshableIntegrations = (
  integrations: SystemIntegration[],
  blockedIntegrations: SystemIntegration[],
) =>
  integrations.filter((integration) => !blockedIntegrations.includes(integration));

export const createOperationWorkerMaintenanceRunner = (
  services: AppServices,
  options: {
    supported_operations?: SystemOperationName[];
    background_probe_refresh_enabled?: boolean;
    background_probe_refresh_interval_ms?: number;
    background_governance_refresh_enabled?: boolean;
    background_governance_refresh_interval_ms?: number;
  } = {},
) => {
  const backgroundProbeRefreshEnabled =
    options.background_probe_refresh_enabled ??
    resolveIntegrationProbeBackgroundRefreshEnabled(
      process.env.INTEGRATION_PROBE_SNAPSHOT_BACKGROUND_ENABLED,
    );
  const backgroundProbeRefreshIntervalMs =
    options.background_probe_refresh_interval_ms ??
    resolveIntegrationProbeBackgroundRefreshIntervalMs(
      process.env.INTEGRATION_PROBE_SNAPSHOT_BACKGROUND_INTERVAL_MS,
    );
  const backgroundGovernanceRefreshEnabled =
    options.background_governance_refresh_enabled ??
    resolveIntegrationGovernanceBackgroundRefreshEnabled(
      process.env.INTEGRATION_GOVERNANCE_BACKGROUND_ENABLED,
    );
  const backgroundGovernanceRefreshIntervalMs =
    options.background_governance_refresh_interval_ms ??
    resolveIntegrationGovernanceBackgroundRefreshIntervalMs(
      process.env.INTEGRATION_GOVERNANCE_BACKGROUND_INTERVAL_MS,
    );
  let lastProbeSnapshotSweepAtMs = 0;
  let lastGovernanceSweepAtMs = 0;

  return {
    async runDueMaintenance(now = new Date().toISOString()) {
      const nowMs = new Date(now).getTime();
      const result = {
        integration_probe_snapshot: {
          checked: false,
          enqueued: false,
          refresh_needed: false,
          skipped_reason: null as string | null,
          job_id: null as string | null,
        },
        integration_governance_refresh: {
          checked: false,
          enqueued: false,
          refresh_needed: false,
          skipped_reason: null as string | null,
          job_id: null as string | null,
        },
      };

      let probePlan:
        | Awaited<ReturnType<typeof buildStoredSystemIntegrationProbeSnapshotPlan>>
        | null = null;

      if (!backgroundProbeRefreshEnabled) {
        result.integration_probe_snapshot.skipped_reason = "disabled";
      } else if (
        !canManageOperation(
          options.supported_operations,
          integrationProbeSnapshotOperationName,
        )
      ) {
        result.integration_probe_snapshot.skipped_reason = "unsupported";
      } else if (nowMs - lastProbeSnapshotSweepAtMs < backgroundProbeRefreshIntervalMs) {
        result.integration_probe_snapshot.skipped_reason = "interval";
      } else {
        lastProbeSnapshotSweepAtMs = nowMs;
        result.integration_probe_snapshot.checked = true;
        probePlan = await buildStoredSystemIntegrationProbeSnapshotPlan(services.repository);

        if (
          probePlan.refresh_integrations.length === 0 ||
          probePlan.refresh_state_token === null
        ) {
          result.integration_probe_snapshot.refresh_needed = false;
        } else {
          const currentProbePlan = probePlan;
          const currentProbeRefreshStateToken = currentProbePlan.refresh_state_token;
          result.integration_probe_snapshot.refresh_needed = true;
          const activeJobs = await services.repository.listOperationJobs({
            limit: 20,
            operation_names: [integrationProbeSnapshotOperationName],
            statuses: ["pending", "running"],
          });
          const hasActiveRefresh = activeJobs.some((job) => {
            const parsedPayload = parseOperationJobPayload(
              integrationProbeSnapshotOperationName,
              job.payload,
            ) as {
              integrations: SystemIntegration[];
            };

            return hasMatchingIntegrationSet(
              parsedPayload.integrations,
              currentProbePlan.refresh_integrations,
            );
          });

          if (hasActiveRefresh) {
            result.integration_probe_snapshot.skipped_reason = "active_job";
          } else {
            const job = await enqueueOperationJobRequest(
              services,
              {
                operation_name: integrationProbeSnapshotOperationName,
                payload: {
                  integrations: currentProbePlan.refresh_integrations,
                  timeout_ms: currentProbePlan.timeout_ms,
                },
                idempotency_key: buildRefreshIdempotencyKey({
                  prefix: "integration-probe-snapshot",
                  integrations: currentProbePlan.refresh_integrations,
                  refresh_state_token: currentProbeRefreshStateToken!,
                  interval_bucket: Math.floor(nowMs / backgroundProbeRefreshIntervalMs),
                }),
                max_attempts: 1,
                available_at: now,
              },
              "internal",
            );

            result.integration_probe_snapshot.enqueued = true;
            result.integration_probe_snapshot.job_id = job.id;
          }
        }
      }

      if (!backgroundGovernanceRefreshEnabled) {
        result.integration_governance_refresh.skipped_reason = "disabled";
        return result;
      }

      if (
        !canManageOperation(
          options.supported_operations,
          integrationGovernanceRefreshOperationName,
        )
      ) {
        result.integration_governance_refresh.skipped_reason = "unsupported";
        return result;
      }

      if (nowMs - lastGovernanceSweepAtMs < backgroundGovernanceRefreshIntervalMs) {
        result.integration_governance_refresh.skipped_reason = "interval";
        return result;
      }

      lastGovernanceSweepAtMs = nowMs;
      result.integration_governance_refresh.checked = true;
      const governancePlan =
        await buildStoredSystemIntegrationGovernanceSnapshotPlan(services.repository);

      if (
        governancePlan.refresh_integrations.length === 0 ||
        governancePlan.refresh_state_token === null
      ) {
        return result;
      }

      result.integration_governance_refresh.refresh_needed = true;
      const blockedProbeIntegrations =
        probePlan?.refresh_integrations ?? [];
      const refreshableIntegrations = pickRefreshableIntegrations(
        governancePlan.refresh_integrations,
        blockedProbeIntegrations,
      );

      if (refreshableIntegrations.length === 0) {
        result.integration_governance_refresh.skipped_reason =
          blockedProbeIntegrations.length > 0 ? "probe_snapshot_pending" : "active_job";
        return result;
      }

      const activeGovernanceJobs = await services.repository.listOperationJobs({
        limit: 20,
        operation_names: [integrationGovernanceRefreshOperationName],
        statuses: ["pending", "running"],
      });
      const hasActiveGovernanceRefresh = activeGovernanceJobs.some((job) => {
        const parsedPayload = parseOperationJobPayload(
          integrationGovernanceRefreshOperationName,
          job.payload,
        ) as {
          integrations: SystemIntegration[];
        };

        return hasMatchingIntegrationSet(parsedPayload.integrations, refreshableIntegrations);
      });

      if (hasActiveGovernanceRefresh) {
        result.integration_governance_refresh.skipped_reason = "active_job";
        return result;
      }

      const refreshStateToken = refreshableIntegrations
        .map(
          (integration) =>
            `${integration}:${governancePlan.refresh_state_tokens[integration] ?? "refresh"}`,
        )
        .join("|");
      const governanceJob = await enqueueOperationJobRequest(
        services,
        {
          operation_name: integrationGovernanceRefreshOperationName,
          payload: {
            integrations: refreshableIntegrations,
            freshness_ms: governancePlan.freshness_ms,
          },
          idempotency_key: buildRefreshIdempotencyKey({
            prefix: "integration-governance-refresh",
            integrations: refreshableIntegrations,
            refresh_state_token: refreshStateToken,
            interval_bucket: Math.floor(nowMs / backgroundGovernanceRefreshIntervalMs),
          }),
          max_attempts: 1,
          available_at: now,
        },
        "internal",
      );

      result.integration_governance_refresh.enqueued = true;
      result.integration_governance_refresh.job_id = governanceJob.id;

      return result;
    },
  };
};
