import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();

const npmCommand = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";

function spawnService(label, args, env = {}) {
  const spawnArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...args] : args;
  const child = spawn(npmCommand, spawnArgs, {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[${label}] ${error instanceof Error ? error.message : String(error)}`);
  });

  return child;
}

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveDefaultVaultPath() {
  if (process.env.OBSIDIAN_VAULT_PATH?.trim()) {
    return process.env.OBSIDIAN_VAULT_PATH.trim();
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, "OneDrive", "Documents", "XAUUSD-Brain"),
    path.join(home, "OneDrive", "Documents", "Finance Superbrain"),
    path.join(home, "OneDrive", "Documents", "gold-intelligence"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, ".obsidian"))) {
      return candidate;
    }
  }

  return null;
}

async function main() {
  const vaultPath = await resolveDefaultVaultPath();
  const services = [
    {
      label: "api",
      args: ["run", "dev:api"],
      env: {
        PORT: "3001",
        REPOSITORY_BACKEND: "memory",
        MARKET_DATA_BACKEND: "mock",
        VOYAGE_API_KEY: "",
        DATABASE_URL: "",
        FEED_HEALTH_PROBE_URLS: "",
        TRANSCRIPT_HEALTH_PROBE_URLS: "",
        FINANCE_SUPERBRAIN_APP_URL: process.env.FINANCE_SUPERBRAIN_APP_URL?.trim() || "http://localhost:3000",
        ...(vaultPath
          ? {
              OBSIDIAN_VAULT_PATH: vaultPath,
            }
          : {}),
      },
    },
    {
      label: "web",
      args: ["run", "dev:web"],
      env: {
        API_URL: "http://localhost:3001",
        NEXT_PUBLIC_API_URL: "http://localhost:3001",
      },
    },
  ];

  if (vaultPath) {
    services.push({
      label: "obsidian",
      args: ["run", "ops:obsidian-watch"],
      env: {
        OBSIDIAN_VAULT_PATH: vaultPath,
        FINANCE_SUPERBRAIN_APP_URL: process.env.FINANCE_SUPERBRAIN_APP_URL?.trim() || "http://localhost:3000",
      },
    });
    console.log(`Obsidian auto-sync enabled for ${vaultPath}`);
  } else {
    console.log("Obsidian auto-sync skipped because no vault path was detected.");
    console.log("Set OBSIDIAN_VAULT_PATH to enable the watcher in the dev workspace.");
  }

  const children = services.map((service) => ({
    ...service,
    child: spawnService(service.label, service.args, service.env),
  }));

  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const service of children) {
      service.child.kill(signal);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await Promise.all(
    children.map(
      (service) =>
        new Promise((resolve) => {
          service.child.on("exit", (code, signal) => {
            if (!shuttingDown && code !== 0) {
              console.error(`[${service.label}] exited with code ${code ?? "null"} signal ${signal ?? "-"}`);
              shutdown("SIGTERM");
            }
            resolve(undefined);
          });
        }),
    ),
  );

  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
