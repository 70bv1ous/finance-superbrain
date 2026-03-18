export type RouteExecutionMode = "auto" | "inline" | "queued";

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

const hasDurableBackendConfigured = () => {
  const backend = process.env.REPOSITORY_BACKEND?.trim().toLowerCase();

  if (backend) {
    return backend !== "memory";
  }

  return Boolean(process.env.DATABASE_URL || process.env.PGLITE_DATA_DIR);
};

export const resolveRouteExecutionMode = (value: unknown): RouteExecutionMode => {
  if (value === "queued" || value === "inline") {
    return value;
  }

  return "auto";
};

export const shouldQueueRouteExecution = (options: {
  requested_mode: RouteExecutionMode;
  durable_by_default?: boolean;
  env_flag?: string;
}) => {
  if (options.requested_mode === "queued") {
    return true;
  }

  if (options.requested_mode === "inline") {
    return false;
  }

  const envPreference = parseBooleanEnv(options.env_flag);

  if (envPreference !== null) {
    return envPreference;
  }

  return Boolean(options.durable_by_default) && hasDurableBackendConfigured();
};

export const resolveOperationTrigger = (request: { headers: Record<string, unknown> }) => {
  const raw = request.headers["x-operation-trigger"];

  return raw === "script" ? "script" : "api";
};

export const resolveRequestIdempotencyKey = (headers: Record<string, unknown>) => {
  const raw = headers["idempotency-key"] ?? headers["x-idempotency-key"];

  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
};
