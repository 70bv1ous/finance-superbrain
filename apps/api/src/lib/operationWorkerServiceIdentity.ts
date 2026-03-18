import { randomUUID } from "node:crypto";
import { hostname as getHostname } from "node:os";

export const resolveOperationWorkerServiceId = (workerId: string) =>
  process.env.OPERATION_WORKER_SERVICE_ID?.trim() ||
  `worker-service-${workerId || randomUUID()}`;

export const resolveOperationWorkerServiceHost = () =>
  process.env.OPERATION_WORKER_SERVICE_HOST?.trim() ||
  process.env.HOSTNAME?.trim() ||
  process.env.COMPUTERNAME?.trim() ||
  getHostname();
