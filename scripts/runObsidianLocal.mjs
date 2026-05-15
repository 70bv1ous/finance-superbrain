import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const npmCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";

const command = process.argv[2] ?? "export";
const forwardedArgs = process.argv.slice(3);

const COMMAND_TO_SCRIPT = {
  export: "ops:obsidian-export",
  import: "ops:obsidian-import",
  sync: "ops:obsidian-sync",
  watch: "ops:obsidian-watch",
};

function spawnNpm(args, env) {
  const spawnArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, spawnArgs, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`npm ${args.join(" ")} exited with code ${code ?? "null"} signal ${signal ?? "-"}`));
    });
  });
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

function resolveLocalPgliteDir() {
  if (process.env.PGLITE_DATA_DIR?.trim()) {
    return process.env.PGLITE_DATA_DIR.trim();
  }

  return path.join(os.tmpdir(), "finance-superbrain-obsidian-local");
}

async function main() {
  const npmScript = COMMAND_TO_SCRIPT[command];
  if (!npmScript) {
    throw new Error(`Unknown Obsidian local command "${command}". Use one of: ${Object.keys(COMMAND_TO_SCRIPT).join(", ")}.`);
  }

  const vaultPath = await resolveDefaultVaultPath();
  if (!vaultPath) {
    throw new Error("OBSIDIAN_VAULT_PATH is required, and no default Obsidian vault was detected.");
  }

  const env = {
    ...process.env,
    OBSIDIAN_VAULT_PATH: vaultPath,
    FINANCE_SUPERBRAIN_APP_URL: process.env.FINANCE_SUPERBRAIN_APP_URL?.trim() || "http://localhost:3000",
    REPOSITORY_BACKEND: process.env.REPOSITORY_BACKEND?.trim() || "pglite",
    PGLITE_DATA_DIR: resolveLocalPgliteDir(),
  };

  console.log(`Obsidian vault: ${env.OBSIDIAN_VAULT_PATH}`);
  console.log(`App URL: ${env.FINANCE_SUPERBRAIN_APP_URL}`);
  console.log(`Repository backend: ${env.REPOSITORY_BACKEND}`);
  console.log(`PGlite data dir: ${env.PGLITE_DATA_DIR}`);

  if (env.REPOSITORY_BACKEND === "pglite") {
    await spawnNpm(["--workspace", "@finance-superbrain/api", "run", "db:migrate"], env);
  }

  await spawnNpm(["run", npmScript, "--", ...forwardedArgs], env);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
