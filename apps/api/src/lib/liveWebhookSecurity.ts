import type { IncomingHttpHeaders } from "node:http";

import type { LiveTranscriptProvider } from "@finance-superbrain/schemas";

type VerificationResult =
  | { ok: true }
  | { ok: false; status_code: 401 | 500; message: string };

const getHeaderValue = (headers: IncomingHttpHeaders, name: string) => {
  const value = headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const parseCsv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const verifySharedSecret = (headers: IncomingHttpHeaders): VerificationResult => {
  const expected = process.env.LIVE_INGEST_WEBHOOK_SECRET;

  if (!expected) {
    return { ok: true };
  }

  return getHeaderValue(headers, "x-finance-superbrain-secret") === expected
    ? { ok: true }
    : {
        ok: false,
        status_code: 401,
        message: "Missing or invalid live ingest webhook secret.",
      };
};

const verifyDeepgramRequest = (headers: IncomingHttpHeaders): VerificationResult => {
  const allowedTokens = parseCsv(process.env.DEEPGRAM_CALLBACK_TOKENS);

  if (!allowedTokens.length) {
    return verifySharedSecret(headers);
  }

  const receivedToken = getHeaderValue(headers, "dg-token");

  return receivedToken && allowedTokens.includes(receivedToken)
    ? { ok: true }
    : {
        ok: false,
        status_code: 401,
        message: "Missing or invalid Deepgram dg-token header.",
      };
};

const verifyAssemblyAiRequest = (headers: IncomingHttpHeaders): VerificationResult => {
  const headerName = process.env.ASSEMBLYAI_WEBHOOK_HEADER_NAME;
  const expectedValue = process.env.ASSEMBLYAI_WEBHOOK_HEADER_VALUE;

  if (!headerName && !expectedValue) {
    return verifySharedSecret(headers);
  }

  if (!headerName || !expectedValue) {
    return {
      ok: false,
      status_code: 500,
      message:
        "AssemblyAI webhook verification is misconfigured. Set both ASSEMBLYAI_WEBHOOK_HEADER_NAME and ASSEMBLYAI_WEBHOOK_HEADER_VALUE.",
    };
  }

  return getHeaderValue(headers, headerName) === expectedValue
    ? { ok: true }
    : {
        ok: false,
        status_code: 401,
        message: `Missing or invalid AssemblyAI webhook header ${headerName}.`,
      };
};

export const verifyLiveWebhookRequest = (
  provider: LiveTranscriptProvider,
  headers: IncomingHttpHeaders,
): VerificationResult => {
  if (provider === "deepgram") {
    return verifyDeepgramRequest(headers);
  }

  if (provider === "assemblyai") {
    return verifyAssemblyAiRequest(headers);
  }

  return verifySharedSecret(headers);
};
