import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_URL = "https://sincere-smile-production-9c3f.up.railway.app";
const DEFAULT_REPORT_PATH = "test-results/hosted-operations/latest.json";

function readArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

function readIntegerArg(name, fallback, { min = 0 } = {}) {
  const raw = readArg(name);

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`--${name} must be an integer >= ${min}.`);
  }

  return parsed;
}

function readBooleanArg(name, fallback) {
  const raw = readArg(name);

  if (!raw) {
    return fallback;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  throw new Error(`--${name} must be true or false.`);
}

function normalizeBaseUrl(value, label) {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function readConfig() {
  return {
    apiUrl: normalizeBaseUrl(
      readArg("api-url") || process.env.PUBLIC_PILOT_API_URL || process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL,
      "PUBLIC_PILOT_API_URL",
    ),
    reportPath: readArg("report") || DEFAULT_REPORT_PATH,
    attempts: readIntegerArg("attempts", 3, { min: 1 }),
    retryDelayMs: readIntegerArg("retry-delay-ms", 2_000, { min: 0 }),
    requireWorkerService:
      readBooleanArg("require-worker-service", process.env.HOSTED_OPS_REQUIRE_WORKER_SERVICE === "true"),
    maxPendingJobs: readIntegerArg("max-pending-jobs", 0),
    maxRunningJobs: readIntegerArg("max-running-jobs", 5),
    maxRetryScheduledJobs: readIntegerArg("max-retry-scheduled-jobs", 0),
    maxRecentWorkerServiceFailures: readIntegerArg("max-recent-worker-service-failures", 0),
    maxRecentOwnershipConflicts: readIntegerArg("max-recent-ownership-conflicts", 0),
    maxIntegrationDegraded: readIntegerArg("max-integration-degraded", 0),
    maxOpenMediumIncidents: readIntegerArg("max-open-medium-incidents", 5),
    maxOpenLowIncidents: readIntegerArg("max-open-low-incidents", 10),
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchJson(url) {
  const startedAt = Date.now();
  const response = await fetch(url);
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 160)}`);
  }

  return {
    response,
    payload,
    latencyMs: Date.now() - startedAt,
  };
}

async function fetchOperationsHealth(config) {
  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    try {
      const result = await fetchJson(`${config.apiUrl}/health?detail=operations`);
      lastResult = { attempt, ...result };

      if (result.response.ok) {
        return lastResult;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < config.attempts) {
      await sleep(config.retryDelayMs);
    }
  }

  if (lastResult !== null) {
    return lastResult;
  }

  throw lastError ?? new Error("Hosted operations health fetch failed.");
}

function addFailure(failures, signal, detail, severity = "high") {
  failures.push({ signal, severity, detail });
}

function evaluateOperations(payload, config) {
  const failures = [];
  const queue = payload?.queue_monitoring ?? {};
  const worker = payload?.worker_monitoring ?? {};
  const workerService = payload?.worker_service_monitoring ?? {};
  const integration = payload?.integration_monitoring ?? {};
  const governance = payload?.integration_governance_monitoring ?? {};
  const probe = payload?.integration_probe_monitoring ?? {};
  const incidents = payload?.incident_monitoring ?? {};

  if (payload?.ok === false) {
    addFailure(failures, "operations_health_not_ok", "Hosted operational health reported ok=false.");
  }

  if ((queue.stale_running_jobs ?? 0) > 0) {
    addFailure(failures, "stale_running_jobs", `${queue.stale_running_jobs} stale running job(s) detected.`);
  }

  if ((queue.pending_jobs ?? 0) > config.maxPendingJobs) {
    addFailure(
      failures,
      "pending_jobs_above_threshold",
      `${queue.pending_jobs} pending job(s) exceed threshold ${config.maxPendingJobs}.`,
      "medium",
    );
  }

  if ((queue.running_jobs ?? 0) > config.maxRunningJobs) {
    addFailure(
      failures,
      "running_jobs_above_threshold",
      `${queue.running_jobs} running job(s) exceed threshold ${config.maxRunningJobs}.`,
      "medium",
    );
  }

  if ((queue.retry_scheduled_jobs ?? 0) > config.maxRetryScheduledJobs) {
    addFailure(
      failures,
      "retry_scheduled_jobs_above_threshold",
      `${queue.retry_scheduled_jobs} retry-scheduled job(s) exceed threshold ${config.maxRetryScheduledJobs}.`,
      "medium",
    );
  }

  if (queue.backlog_blocked === true || worker.backlog_blocked === true || workerService.backlog_blocked === true) {
    addFailure(failures, "backlog_blocked", "Queued work is blocked by missing or unhealthy worker capacity.");
  }

  if ((worker.stale_workers ?? 0) > 0) {
    addFailure(failures, "stale_workers", `${worker.stale_workers} stale worker(s) detected.`);
  }

  if (config.requireWorkerService && (workerService.registered_services ?? 0) === 0) {
    addFailure(failures, "worker_service_missing", "No hosted worker service is registered.");
  }

  if ((workerService.failed_services ?? 0) > 0) {
    addFailure(failures, "worker_service_failed", `${workerService.failed_services} worker service(s) failed.`);
  }

  if ((workerService.stale_services ?? 0) > 0) {
    addFailure(failures, "worker_service_stale", `${workerService.stale_services} worker service(s) stale.`);
  }

  if ((workerService.recent_failures ?? 0) > config.maxRecentWorkerServiceFailures) {
    addFailure(
      failures,
      "worker_service_recent_failures",
      `${workerService.recent_failures} recent worker-service failure event(s) exceed threshold ${config.maxRecentWorkerServiceFailures}.`,
      "medium",
    );
  }

  if ((workerService.recent_ownership_conflicts ?? 0) > config.maxRecentOwnershipConflicts) {
    addFailure(
      failures,
      "worker_service_ownership_conflicts",
      `${workerService.recent_ownership_conflicts} recent ownership conflict(s) exceed threshold ${config.maxRecentOwnershipConflicts}.`,
      "medium",
    );
  }

  if ((integration.critical_integrations ?? 0) > 0) {
    addFailure(failures, "critical_integrations", `${integration.critical_integrations} critical integration(s) detected.`);
  }

  if ((integration.degraded_integrations ?? 0) > config.maxIntegrationDegraded) {
    addFailure(
      failures,
      "degraded_integrations_above_threshold",
      `${integration.degraded_integrations} degraded integration(s) exceed threshold ${config.maxIntegrationDegraded}.`,
      "medium",
    );
  }

  if (governance.highest_action === "suppress") {
    addFailure(failures, "integration_governance_suppressed", "One or more integrations are suppressed.");
  }

  if ((probe.missing_snapshots ?? 0) > 0) {
    addFailure(failures, "missing_integration_probe_snapshots", `${probe.missing_snapshots} integration probe snapshot(s) missing.`);
  }

  if ((incidents.high ?? 0) > 0) {
    addFailure(failures, "high_operational_incidents", `${incidents.high} high-severity operational incident(s) open.`);
  }

  if ((incidents.medium ?? 0) > config.maxOpenMediumIncidents) {
    addFailure(
      failures,
      "medium_operational_incidents_above_threshold",
      `${incidents.medium} medium-severity incident(s) exceed threshold ${config.maxOpenMediumIncidents}.`,
      "medium",
    );
  }

  if ((incidents.low ?? 0) > config.maxOpenLowIncidents) {
    addFailure(
      failures,
      "low_operational_incidents_above_threshold",
      `${incidents.low} low-severity incident(s) exceed threshold ${config.maxOpenLowIncidents}.`,
      "low",
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      queue,
      worker,
      worker_service: workerService,
      integration,
      integration_governance: governance,
      integration_probe: probe,
      incidents,
    },
  };
}

async function writeReport(reportPath, report) {
  const absolutePath = path.resolve(reportPath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return absolutePath;
}

async function main() {
  const config = readConfig();
  const checkedAt = new Date().toISOString();
  const { attempt, response, payload, latencyMs } = await fetchOperationsHealth(config);
  const fetchFailure = !response.ok
    ? [{
        signal: "hosted_operations_http_failure",
        severity: "high",
        detail: `Expected hosted operations health to return 2xx, got HTTP ${response.status}: ${JSON.stringify(payload)}`,
      }]
    : [];
  const evaluation = response.ok
    ? evaluateOperations(payload, config)
    : {
        ok: false,
        failures: fetchFailure,
        summary: {},
      };
  const report = {
    ok: evaluation.ok,
    checked_at: checkedAt,
    api_url: config.apiUrl,
    attempts: attempt,
    latency_ms: latencyMs,
    thresholds: {
      attempts: config.attempts,
      retry_delay_ms: config.retryDelayMs,
      require_worker_service: config.requireWorkerService,
      max_pending_jobs: config.maxPendingJobs,
      max_running_jobs: config.maxRunningJobs,
      max_retry_scheduled_jobs: config.maxRetryScheduledJobs,
      max_recent_worker_service_failures: config.maxRecentWorkerServiceFailures,
      max_recent_ownership_conflicts: config.maxRecentOwnershipConflicts,
      max_integration_degraded: config.maxIntegrationDegraded,
      max_open_medium_incidents: config.maxOpenMediumIncidents,
      max_open_low_incidents: config.maxOpenLowIncidents,
    },
    failures: evaluation.failures,
    summary: evaluation.summary,
  };
  const reportPath = await writeReport(config.reportPath, report);

  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
