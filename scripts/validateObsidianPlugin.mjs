import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const pluginMain = resolve(repoRoot, "apps", "obsidian-plugin", "main.js");

async function main() {
  await access(pluginMain);
  console.log(`Validated Finance Superbrain Obsidian plugin at ${pluginMain}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
