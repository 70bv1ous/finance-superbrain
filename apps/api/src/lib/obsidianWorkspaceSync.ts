import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ObsidianSyncState } from "@finance-superbrain/schemas";

import { getObsidianImportReviewLogPath, readLatestObsidianImportReviewLog } from "./obsidianImportReviewLog.js";
import { buildObsidianWorkSessionMarkdown } from "./obsidianWorkSession.js";
import { exportWorkspaceToObsidian } from "./obsidianExport.js";
import {
  createObsidianSyncSession,
  getObsidianSyncStatePath,
  readObsidianSyncState,
  upsertObsidianSyncState,
  writeObsidianSyncState,
} from "./obsidianSyncState.js";
import type { Repository } from "./repository.types.js";

export type ObsidianWorkspaceSyncMode = "manual" | "watch";

export type ObsidianWorkspaceSyncResult = {
  workspace_id: string;
  target_path: string;
  session: ReturnType<typeof createObsidianSyncSession>;
  state: ObsidianSyncState;
  latest_review: Awaited<ReturnType<typeof readLatestObsidianImportReviewLog>>;
  export_note_counts: Awaited<ReturnType<typeof exportWorkspaceToObsidian>>["note_counts"] | null;
};

export type ObsidianWorkspaceSyncInput = {
  repository: Repository;
  repoRoot: string;
  vaultRoot: string;
  exportRoot?: string | null;
  syncStatePath?: string;
  importReviewLogPath?: string;
  mode: ObsidianWorkspaceSyncMode;
};

function runGit(repoRoot: string, args: string[]) {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function captureGitSnapshot(repoRoot: string) {
  const branch = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
  const head = runGit(repoRoot, ["rev-parse", "--short", "HEAD"]) || null;
  const statusLines = runGit(repoRoot, ["status", "--short"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const changedFiles = statusLines
    .map((line) => line.replace(/^[A-Z? ]+\s+/, "").trim())
    .filter(Boolean);

  return {
    branch,
    head,
    status_lines: statusLines,
    changed_files: changedFiles,
    dirty: statusLines.length > 0,
  };
}

export async function syncObsidianWorkspace(input: ObsidianWorkspaceSyncInput): Promise<ObsidianWorkspaceSyncResult> {
  const exportRoot = input.exportRoot?.trim() || "Finance Superbrain";
  const syncStatePath = input.syncStatePath ?? getObsidianSyncStatePath(input.repoRoot);
  const importReviewLogPath = input.importReviewLogPath ?? getObsidianImportReviewLogPath(input.repoRoot);
  const workspace = await input.repository.getOrCreateDefaultWorkspace();
  const gitSnapshot = captureGitSnapshot(input.repoRoot);
  const now = new Date().toISOString();
  const session = createObsidianSyncSession(gitSnapshot, input.mode);
  const existingState = await readObsidianSyncState(syncStatePath);
  const workspaceId = existingState?.workspace_id ?? workspace.id;
  const nextState = upsertObsidianSyncState(existingState, session, workspaceId);
  const latestReview = await readLatestObsidianImportReviewLog(importReviewLogPath);
  const exportSummary = await exportWorkspaceToObsidian(
    input.repository,
    {
      vault_path: input.vaultRoot,
      export_root: exportRoot,
      app_url: process.env.FINANCE_SUPERBRAIN_APP_URL?.trim() || null,
      dry_run: false,
    },
  );

  await writeObsidianSyncState(syncStatePath, nextState);

  const targetPath = resolve(input.vaultRoot, exportRoot, "Project", "Work Session.md");
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    buildObsidianWorkSessionMarkdown({
      workspace_id: workspaceId,
      created_at: workspace.created_at ?? now,
      updated_at: session.captured_at,
      app_url: process.env.FINANCE_SUPERBRAIN_APP_URL?.trim() || null,
      sync_state: nextState,
      latest_review: latestReview,
      export_note_counts: exportSummary.note_counts,
      plugin_status_note_path: `${exportRoot}/Project/Obsidian Plugin Sync.md`,
    }),
    "utf8",
  );

  return {
    workspace_id: workspaceId,
    target_path: targetPath,
    session,
    state: nextState,
    latest_review: latestReview,
    export_note_counts: exportSummary.note_counts,
  };
}
