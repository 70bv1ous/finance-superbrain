import type { OperationRunTrigger } from "@finance-superbrain/schemas";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const shouldUseOpsApi = () =>
  (process.env.OPS_USE_API ?? "false").toLowerCase() === "true";

export const resolveOpsApiBaseUrl = () => {
  const value = process.env.API_BASE_URL?.trim();

  if (!value) {
    throw new Error("API_BASE_URL is required when OPS_USE_API=true.");
  }

  return trimTrailingSlash(value);
};

export const requestOpsApi = async <T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  trigger: OperationRunTrigger = "script",
): Promise<T> => {
  const response = await fetch(`${resolveOpsApiBaseUrl()}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-operation-trigger": trigger,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Ops API request failed (${response.status} ${response.statusText}): ${text}`,
    );
  }

  return (await response.json()) as T;
};
