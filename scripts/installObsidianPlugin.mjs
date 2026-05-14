import { access, copyFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const pluginRoot = path.join(projectRoot, "apps", "obsidian-plugin");
const pluginId = "finance-superbrain";

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveVaultPath() {
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
  const vaultPath = await resolveVaultPath();
  if (!vaultPath) {
    throw new Error("Unable to determine OBSIDIAN_VAULT_PATH.");
  }

  const sourceFiles = ["main.js", "manifest.json", "styles.css"];
  const pluginDir = path.join(vaultPath, ".obsidian", "plugins", pluginId);
  await mkdir(pluginDir, { recursive: true });

  for (const fileName of sourceFiles) {
    await copyFile(path.join(pluginRoot, fileName), path.join(pluginDir, fileName));
  }

  console.log(`Installed Finance Superbrain Obsidian plugin into ${pluginDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
