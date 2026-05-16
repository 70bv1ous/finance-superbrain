import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { runPublicPilotHealthCheck } from "./checkPublicPilotHealth.mjs";

const DEFAULT_WEB_URL = "https://finance-superbrain-web.vercel.app";
const DEFAULT_API_URL = "https://sincere-smile-production-9c3f.up.railway.app";
const DEFAULT_REPORT_PATH = "test-results/public-pilot-monitor/latest.json";

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
    cycles: readIntegerArg("cycles", 3, { min: 0 }),
    intervalMs: readIntegerArg("interval-ms", 60_000, { min: 1_000 }),
    smokeAfterFailures: readIntegerArg("smoke-after-failures", 2, { min: 0 }),
    reportPath: readArg("report") || DEFAULT_REPORT_PATH,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runHostedSmoke(config) {
  const env = {
    ...process.env,
    PUBLIC_PILOT_WEB_URL: config.webUrl,
    PUBLIC_PILOT_API_URL: config.apiUrl,
  };
  const npmCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const forwardedArgs = [`--web-url=${config.webUrl}`, `--api-url=${config.apiUrl}`];
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm", "run", "demo:public-pilot:smoke", "--", ...forwardedArgs]
    : ["run", "demo:public-pilot:smoke", "--", ...forwardedArgs];

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(npmCommand, args, {
      cwd: process.cwd(),
      env,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        exit_code: null,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        stdout,
        stderr,
      });
    });

    child.on("exit", (code, signal) => {
      resolve({
        ok: code === 0,
        exit_code: code,
        signal,
        latency_ms: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

async function writeReport(reportPath, report) {
  const absolutePath = path.resolve(reportPath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return absolutePath;
}

function summarizeHealth(summary) {
  const failed = summary.results.filter((result) => !result.ok).map((result) => result.name);

  return failed.length > 0 ? `failed=${failed.join(",")}` : "all_checks=ok";
}

async function main() {
  const config = readConfig();
  const startedAt = new Date().toISOString();
  const cycles = [];
  let consecutiveFailures = 0;
  let escalatedSmoke = null;

  console.log("Public pilot monitor");
  console.log(`Web: ${config.webUrl}`);
  console.log(`API: ${config.apiUrl}`);
  console.log(`Cycles: ${config.cycles === 0 ? "continuous" : config.cycles}`);
  console.log(`Interval: ${config.intervalMs}ms`);
  console.log(`Smoke escalation: ${config.smokeAfterFailures === 0 ? "disabled" : `${config.smokeAfterFailures} consecutive failures`}`);

  for (let cycle = 1; config.cycles === 0 || cycle <= config.cycles; cycle += 1) {
    const health = await runPublicPilotHealthCheck({
      webUrl: config.webUrl,
      apiUrl: config.apiUrl,
    });

    consecutiveFailures = health.ok ? 0 : consecutiveFailures + 1;
    cycles.push({
      cycle,
      consecutive_failures: consecutiveFailures,
      health,
    });

    console.log(`[${health.checked_at}] cycle=${cycle} ok=${health.ok} ${summarizeHealth(health)}`);

    if (
      !health.ok
      && config.smokeAfterFailures > 0
      && consecutiveFailures >= config.smokeAfterFailures
      && escalatedSmoke === null
    ) {
      console.log(`Escalating to full hosted smoke after ${consecutiveFailures} consecutive health failures.`);
      escalatedSmoke = await runHostedSmoke(config);
      console.log(`Full hosted smoke ok=${escalatedSmoke.ok} exit_code=${escalatedSmoke.exit_code ?? "null"}`);
    }

    if (config.cycles !== 0 && cycle >= config.cycles) {
      break;
    }

    await sleep(config.intervalMs);
  }

  const ok = cycles.every((cycle) => cycle.health.ok) && (escalatedSmoke === null || escalatedSmoke.ok);
  const report = {
    ok,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    web_url: config.webUrl,
    api_url: config.apiUrl,
    cycles,
    escalated_smoke: escalatedSmoke,
  };
  const reportPath = await writeReport(config.reportPath, report);

  console.log(`Report: ${reportPath}`);

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
