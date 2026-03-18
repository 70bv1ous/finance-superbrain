export class ExternalIntegrationError extends Error {
  readonly retryable: boolean;
  readonly integration: "feed" | "transcript";
  readonly url: string;
  readonly status_code: number | null;
  readonly retry_after_seconds: number | null;

  constructor(input: {
    message: string;
    integration: "feed" | "transcript";
    url: string;
    retryable: boolean;
    status_code?: number | null;
    retry_after_seconds?: number | null;
  }) {
    super(input.message);
    this.name = "ExternalIntegrationError";
    this.integration = input.integration;
    this.url = input.url;
    this.retryable = input.retryable;
    this.status_code = input.status_code ?? null;
    this.retry_after_seconds = input.retry_after_seconds ?? null;
  }
}

export const isExternalIntegrationError = (
  value: unknown,
): value is ExternalIntegrationError => value instanceof ExternalIntegrationError;

export const isRetryableHttpStatus = (status: number) =>
  status >= 500 || [408, 425, 429].includes(status);

export const parseRetryAfterSeconds = (
  retryAfter: string | null,
  now = new Date(),
) => {
  if (!retryAfter) {
    return null;
  }

  const numeric = Number(retryAfter);

  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.max(1, Math.floor(numeric));
  }

  const parsedDate = new Date(retryAfter);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return Math.max(1, Math.ceil((parsedDate.getTime() - now.getTime()) / 1000));
};
