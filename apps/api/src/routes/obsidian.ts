import type { FastifyInstance } from "fastify";

import {
  obsidianImportReviewRequestSchema,
  obsidianImportReviewResponseSchema,
  obsidianWorkspaceSyncRequestSchema,
  obsidianWorkspaceSyncResponseSchema,
} from "@finance-superbrain/schemas";

import { buildObsidianImportConfigFromEnv, importObsidianHumanInbox } from "../lib/obsidianImport.js";
import { appendObsidianImportReviewLog, getObsidianImportReviewLogPath } from "../lib/obsidianImportReviewLog.js";
import { syncObsidianWorkspace } from "../lib/obsidianWorkspaceSync.js";
import type { AppServices } from "../lib/services.js";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..", "..");

function resolveImportReviewLogPath() {
  return process.env.FINANCE_SUPERBRAIN_OBSIDIAN_IMPORT_REVIEW_LOG_PATH?.trim() || getObsidianImportReviewLogPath(repoRoot);
}

async function pathExists(candidate: string) {
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
    resolve(home, "OneDrive", "Documents", "XAUUSD-Brain"),
    resolve(home, "OneDrive", "Documents", "Finance Superbrain"),
    resolve(home, "OneDrive", "Documents", "gold-intelligence"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(resolve(candidate, ".obsidian"))) {
      return candidate;
    }
  }

  return null;
}

function toReviewResponse(summary: Awaited<ReturnType<typeof importObsidianHumanInbox>>) {
  const selectedContentHashes = summary.candidates
    .filter((candidate) => candidate.status === "importable")
    .map((candidate) => candidate.content_hash);

  return obsidianImportReviewResponseSchema.parse({
    ...summary,
    selected_content_hashes: selectedContentHashes,
    rejected_content_hashes: [],
  });
}

async function buildImportConfig(options: Parameters<typeof buildObsidianImportConfigFromEnv>[1] = {}) {
  const vaultRoot = await resolveDefaultVaultPath();

  return buildObsidianImportConfigFromEnv(
    {
      ...process.env,
      ...(vaultRoot ? { OBSIDIAN_VAULT_PATH: vaultRoot } : {}),
    },
    options,
  );
}

export const registerObsidianRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.post("/v1/obsidian/sync", async (request, reply) => {
    const parsed = obsidianWorkspaceSyncRequestSchema.parse(request.body ?? {});
    const vaultRoot = await resolveDefaultVaultPath();

    if (!vaultRoot) {
      return reply.status(400).send({
        error: "obsidian_vault_path_missing",
        message: "OBSIDIAN_VAULT_PATH is required for Obsidian sync.",
      });
    }

    const result = await syncObsidianWorkspace({
      repository: services.repository,
      repoRoot,
      vaultRoot,
      exportRoot: process.env.OBSIDIAN_EXPORT_ROOT?.trim() || "Finance Superbrain",
      syncStatePath: process.env.FINANCE_SUPERBRAIN_OBSIDIAN_SYNC_STATE_PATH?.trim() || undefined,
      importReviewLogPath: resolveImportReviewLogPath(),
      mode: parsed.mode,
    });

    return obsidianWorkspaceSyncResponseSchema.parse({
      workspace_id: result.workspace_id,
      target_path: result.target_path,
      captured_at: result.session.captured_at,
      mode: result.session.mode,
      dirty: result.session.dirty,
      changed_files: result.session.changed_files.length,
      branch: result.session.branch,
      head: result.session.head,
      changed_file_paths: result.session.changed_files,
      recent_sessions: result.state.sessions.slice(0, 5).map((session) => ({
        captured_at: session.captured_at,
        mode: session.mode,
        dirty: session.dirty,
        changed_files: session.changed_files.length,
      })),
      export_note_counts: result.export_note_counts,
      latest_import_review: result.latest_review
        ? {
            reviewed_at: result.latest_review.reviewed_at,
            selected: result.latest_review.selected_content_hashes.length,
            rejected: result.latest_review.rejected_content_hashes.length,
            imported: result.latest_review.counts.imported,
            skipped: result.latest_review.counts.skipped,
            duplicate: result.latest_review.counts.duplicate,
          }
        : null,
    });
  });

  server.get("/v1/obsidian/import-candidates", async () => {
    const config = await buildImportConfig();
    const summary = await importObsidianHumanInbox(services, config);
    return toReviewResponse(summary);
  });

  server.post("/v1/obsidian/import-candidates/apply", async (request) => {
    const parsed = obsidianImportReviewRequestSchema.parse(request.body ?? {});
    const config = await buildImportConfig({
      apply: true,
      selected_content_hashes: parsed.selected_content_hashes,
    });
    const summary = await importObsidianHumanInbox(services, config, {
      selected_content_hashes: parsed.selected_content_hashes,
    });
    const selectedSet = new Set(parsed.selected_content_hashes);
    const rejectedContentHashes = summary.candidates
      .filter((candidate) => candidate.status === "skipped")
      .filter((candidate) => candidate.reason === "Candidate was not selected in the import review queue.")
      .filter((candidate) => !selectedSet.has(candidate.content_hash))
      .map((candidate) => candidate.content_hash);
    const response = obsidianImportReviewResponseSchema.parse({
      ...summary,
      selected_content_hashes: parsed.selected_content_hashes,
      rejected_content_hashes: rejectedContentHashes,
    });
    await appendObsidianImportReviewLog(resolveImportReviewLogPath(), {
      workspace_id: response.workspace_id,
      dry_run: response.dry_run,
      selected_content_hashes: response.selected_content_hashes,
      rejected_content_hashes: response.rejected_content_hashes,
      counts: response.counts,
    });
    return response;
  });
};
