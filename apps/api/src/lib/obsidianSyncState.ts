import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  obsidianSyncSessionSchema,
  obsidianSyncStateSchema,
  type ObsidianSyncSession,
  type ObsidianSyncState,
} from "@finance-superbrain/schemas";

export const OBSIDIAN_SYNC_STATE_RELATIVE_PATH = ".finance-superbrain/obsidian-sync-state.json";
export const OBSIDIAN_SYNC_HISTORY_LIMIT = 25;

export type ObsidianGitSnapshot = {
  branch: string | null;
  head: string | null;
  status_lines: string[];
  changed_files: string[];
  dirty: boolean;
};

export function getObsidianSyncStatePath(repoRoot: string) {
  return join(repoRoot, OBSIDIAN_SYNC_STATE_RELATIVE_PATH);
}

export function createObsidianSyncSession(
  snapshot: ObsidianGitSnapshot,
  mode: ObsidianSyncSession["mode"],
): ObsidianSyncSession {
  return obsidianSyncSessionSchema.parse({
    session_id: randomUUID(),
    captured_at: new Date().toISOString(),
    mode,
    branch: snapshot.branch,
    head: snapshot.head,
    dirty: snapshot.dirty,
    status_lines: snapshot.status_lines,
    changed_files: snapshot.changed_files,
  });
}

export function upsertObsidianSyncState(
  existing: ObsidianSyncState | null,
  session: ObsidianSyncSession,
  workspaceId?: string | null,
): ObsidianSyncState {
  const sessions = [session, ...(existing?.sessions ?? [])].slice(0, OBSIDIAN_SYNC_HISTORY_LIMIT);

  return obsidianSyncStateSchema.parse({
    version: 1,
    updated_at: session.captured_at,
    workspace_id: workspaceId ?? existing?.workspace_id ?? null,
    sessions,
  });
}

export async function readObsidianSyncState(syncStatePath: string): Promise<ObsidianSyncState | null> {
  const content = await readFile(syncStatePath, "utf8").catch(() => null);
  if (!content) {
    return null;
  }

  try {
    return obsidianSyncStateSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function writeObsidianSyncState(syncStatePath: string, state: ObsidianSyncState) {
  await mkdir(dirname(syncStatePath), { recursive: true });
  await writeFile(syncStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
