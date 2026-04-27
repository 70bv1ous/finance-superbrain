import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = process.cwd();

function buildShellCommand(args) {
  return `npm ${args.join(" ")}`;
}

function getDefaultPgliteDir() {
  if (process.env.PGLITE_DATA_DIR?.trim()) {
    return process.env.PGLITE_DATA_DIR.trim();
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;

    if (localAppData) {
      return path.join(localAppData, "finance-superbrain", "demo-proof");
    }
  }

  return path.join(os.homedir(), ".local", "share", "finance-superbrain", "demo-proof");
}

async function runNpm(args, env) {
  await new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", buildShellCommand(args)], {
            cwd: projectRoot,
            env,
            stdio: "inherit",
          })
        : spawn("npm", args, {
            cwd: projectRoot,
            env,
            stdio: "inherit",
          });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`Command failed with exit code ${code ?? "unknown"}: npm ${args.join(" ")}`));
    });
  });
}

async function main() {
  const pgliteDir = getDefaultPgliteDir();
  await mkdir(path.dirname(pgliteDir), { recursive: true });

  const env = {
    ...process.env,
    REPOSITORY_BACKEND: process.env.REPOSITORY_BACKEND || "pglite",
    PGLITE_DATA_DIR: pgliteDir,
    MARKET_DATA_BACKEND: process.env.MARKET_DATA_BACKEND || "mock",
    CHAT_MODEL_BACKEND: process.env.CHAT_MODEL_BACKEND || "mock",
    AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE || "false",
  };

  console.log(`Using PGlite data dir: ${pgliteDir}`);
  console.log(`Repository backend: ${env.REPOSITORY_BACKEND}`);
  console.log(`Market data backend: ${env.MARKET_DATA_BACKEND}`);
  console.log(`Chat model backend: ${env.CHAT_MODEL_BACKEND}`);

  await runNpm(["run", "seed:demo-proof"], env);

  console.log("");
  console.log("Deterministic demo workspace seeded successfully.");
  console.log("Next steps:");
  console.log("- Start the API with npm run dev:api");
  console.log("- Start the web app with npm run dev:web");
  console.log("- Sign in with lead.operator@finance-superbrain.local / workspace-admin-password");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
