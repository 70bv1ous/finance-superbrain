import { buildRepositoryFromEnv } from "../lib/services.js";
import {
  evaluateWorkerServiceSupervisorStatus,
  type WorkerServiceSupervisorCheckMode,
} from "../lib/operationWorkerServiceSupervisorStatus.js";
import { buildSystemWorkerServiceReport } from "../lib/systemWorkerServiceReport.js";

const parseArgs = () => {
  let mode: WorkerServiceSupervisorCheckMode =
    process.env.OPERATION_WORKER_SERVICE_STATUS_MODE === "readiness"
      ? "readiness"
      : "liveness";
  let serviceId = process.env.OPERATION_WORKER_SERVICE_ID?.trim() || undefined;
  let workerId = process.env.OPERATION_WORKER_ID?.trim() || undefined;
  let json = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length).trim();
      if (value === "liveness" || value === "readiness") {
        mode = value;
      }
      continue;
    }

    if (arg.startsWith("--service-id=")) {
      serviceId = arg.slice("--service-id=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--worker-id=")) {
      workerId = arg.slice("--worker-id=".length).trim() || undefined;
    }
  }

  return { mode, service_id: serviceId, worker_id: workerId, json };
};

const main = async () => {
  const options = parseArgs();
  const repository = buildRepositoryFromEnv();

  try {
    const report = await buildSystemWorkerServiceReport(repository, { limit: 50 });
    const status = evaluateWorkerServiceSupervisorStatus(report, {
      mode: options.mode,
      service_id: options.service_id,
      worker_id: options.worker_id,
    });

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(
        `${status.ok ? "ok" : "fail"} mode=${status.mode} service=${status.service_id ?? "-"} status=${status.status ?? "-"} reason=${status.reason} detail=${status.detail}`,
      );
    }

    process.exitCode = status.ok ? 0 : 1;
  } finally {
    await repository.close?.();
  }
};

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        service: "operation-worker",
        event: "worker_service_status_check_failed",
        message: error instanceof Error ? error.message : "Unknown worker service status failure.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
