import { pathToFileURL } from "node:url";

const DEFAULT_WEB_URL = "https://finance-superbrain-web.vercel.app";
const DEFAULT_API_URL = "https://sincere-smile-production-9c3f.up.railway.app";

function readArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
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
    webUrl: normalizeBaseUrl(
      readArg("web-url") || process.env.PUBLIC_PILOT_WEB_URL || DEFAULT_WEB_URL,
      "PUBLIC_PILOT_WEB_URL",
    ),
    apiUrl: normalizeBaseUrl(
      readArg("api-url") || process.env.PUBLIC_PILOT_API_URL || process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL,
      "PUBLIC_PILOT_API_URL",
    ),
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchText(url, init) {
  const startedAt = Date.now();
  const response = await fetch(url, init);
  const text = await response.text();

  return {
    response,
    text,
    latencyMs: Date.now() - startedAt,
  };
}

async function fetchJson(url, init) {
  const result = await fetchText(url, init);
  let payload = null;

  try {
    payload = result.text ? JSON.parse(result.text) : null;
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${result.text.slice(0, 160)}`);
  }

  return { ...result, payload };
}

async function check(name, probe, options = {}) {
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 2_000;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const detail = await probe();
      return { name, ok: true, attempts: attempt, ...detail };
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await sleep(retryDelayMs);
      }
    }
  }

  return {
    name,
    ok: false,
    attempts,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
}

export async function runPublicPilotHealthCheck(config = readConfig()) {
  const results = [];

  results.push(await check("public_shell", async () => {
    const { response, text, latencyMs } = await fetchText(config.webUrl);

    if (!response.ok || !text.includes("Finance Superbrain")) {
      throw new Error(`Expected public shell to return Finance Superbrain, got HTTP ${response.status}.`);
    }

    return { status: response.status, latency_ms: latencyMs };
  }));

  results.push(await check("login_page", async () => {
    const { response, text, latencyMs } = await fetchText(`${config.webUrl}/login`);

    if (!response.ok || !text.includes("finance-superbrain-api-url")) {
      throw new Error(`Expected login page API metadata, got HTTP ${response.status}.`);
    }

    return { status: response.status, latency_ms: latencyMs };
  }));

  results.push(await check("api_health", async () => {
    const { response, payload, latencyMs } = await fetchJson(`${config.apiUrl}/health`);

    if (!response.ok || payload?.ok === false) {
      throw new Error(`Expected healthy API liveness, got HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }

    return { status: response.status, latency_ms: latencyMs, mode: payload?.mode ?? null };
  }));

  results.push(await check("api_readiness", async () => {
    const { response, payload, latencyMs } = await fetchJson(`${config.apiUrl}/ready`);

    if (!response.ok || payload?.ok === false) {
      throw new Error(`Expected ready API dependencies, got HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }

    return {
      status: response.status,
      latency_ms: latencyMs,
      dependencies: Array.isArray(payload?.dependencies) ? payload.dependencies.length : 0,
    };
  }));

  results.push(await check("workspace_bootstrap_cors", async () => {
    const { response, payload, latencyMs } = await fetchJson(`${config.apiUrl}/v1/auth/bootstrap`, {
      headers: {
        Origin: config.webUrl,
      },
    });

    if (!response.ok || typeof payload?.bootstrap_required !== "boolean") {
      throw new Error(`Expected bootstrap state, got HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }

    return {
      status: response.status,
      latency_ms: latencyMs,
      bootstrap_required: payload.bootstrap_required,
    };
  }));

  const ok = results.every((result) => result.ok);

  return {
    ok,
    checked_at: new Date().toISOString(),
    web_url: config.webUrl,
    api_url: config.apiUrl,
    results,
  };
}

async function main() {
  const config = readConfig();
  const summary = await runPublicPilotHealthCheck(config);

  console.log(JSON.stringify(summary, null, 2));

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
