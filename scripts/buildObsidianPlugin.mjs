import { build, context } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const pluginRoot = resolve(repoRoot, "apps", "obsidian-plugin");
const entryPoint = resolve(pluginRoot, "main.ts");
const outfile = resolve(pluginRoot, "main.js");
const watchMode = process.argv.slice(2).includes("--watch");

async function createBuildOptions() {
  const source = await readFile(entryPoint, "utf8");

  return {
  stdin: {
    contents: source,
    sourcefile: entryPoint,
    resolveDir: pluginRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  external: ["obsidian", "electron"],
  outfile,
  };
}

async function main() {
  if (watchMode) {
    const buildOptions = await createBuildOptions();
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log(`Watching Finance Superbrain Obsidian plugin sources in ${pluginRoot}`);

    const shutdown = async () => {
      await ctx.dispose().catch(() => undefined);
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const buildOptions = await createBuildOptions();
  await build(buildOptions);
  console.log(`Built Finance Superbrain Obsidian plugin to ${outfile}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
