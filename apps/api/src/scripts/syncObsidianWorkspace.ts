import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRepositoryFromEnv } from "../lib/services.js";
import { getObsidianSyncStatePath } from "../lib/obsidianSyncState.js";
import { getObsidianImportReviewLogPath } from "../lib/obsidianImportReviewLog.js";
import { syncObsidianWorkspace } from "../lib/obsidianWorkspaceSync.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..", "..");
const defaultVaultRoot = process.env.OBSIDIAN_VAULT_PATH?.trim() || null;
const exportRoot = process.env.OBSIDIAN_EXPORT_ROOT?.trim() || "Finance Superbrain";
const syncStatePath = process.env.FINANCE_SUPERBRAIN_OBSIDIAN_SYNC_STATE_PATH?.trim() || getObsidianSyncStatePath(repoRoot);
const importReviewLogPath = getObsidianImportReviewLogPath(repoRoot);

function hasFlag(flag: string) {
  return process.argv.slice(2).includes(flag);
}

function shouldIgnoreWatchEvent(filename: string | null) {
  if (!filename) {
    return false;
  }

  const normalized = filename.replace(/\\/g, "/");
  return normalized.startsWith(".git/") || normalized.startsWith("node_modules/") || normalized.startsWith(".finance-superbrain/");
}

async function writeWorkSessionNote(mode: "manual" | "watch") {
  const vaultRoot = defaultVaultRoot;
  if (!vaultRoot) {
    throw new Error("OBSIDIAN_VAULT_PATH is required for obsidian sync.");
  }

  const repository = buildRepositoryFromEnv();
  try {
    return await syncObsidianWorkspace({
      repository,
      repoRoot,
      vaultRoot,
      exportRoot,
      syncStatePath,
      importReviewLogPath,
      mode,
    });
  } finally {
    try {
      await repository.close?.();
    } catch {
      // Best-effort cleanup.
    }
  }
}

async function syncOnce(mode: "manual" | "watch") {
  const result = await writeWorkSessionNote(mode);
  console.log(
    JSON.stringify(
      {
        mode,
        workspace_id: result.workspace_id,
        target_path: result.target_path,
        captured_at: result.session.captured_at,
        dirty: result.session.dirty,
        changed_files: result.session.changed_files.length,
        sync_state_path: syncStatePath,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const watchMode = hasFlag("--watch");

  await syncOnce(watchMode ? "watch" : "manual");

  if (!watchMode) {
    return;
  }

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let queued = false;

  const trigger = () => {
    if (running) {
      queued = true;
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(async () => {
      timer = null;
      running = true;
      try {
        await syncOnce("watch");
      } catch (error) {
        console.error(error);
      } finally {
        running = false;
        if (queued) {
          queued = false;
          trigger();
        }
      }
    }, 4000);
  };

  const fsWatcher = watch(repoRoot, { recursive: true }, (_eventType, filename) => {
    if (shouldIgnoreWatchEvent(filename ?? null)) {
      return;
    }

    trigger();
  });

  console.log(`Watching ${repoRoot} for Obsidian sync changes.`);
  process.on("SIGINT", () => {
    fsWatcher.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    fsWatcher.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
