import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { type ObsidianImportReviewResponse } from "@finance-superbrain/schemas";

const REVIEW_LOG_RELATIVE_PATH = ".finance-superbrain/obsidian-import-review-log.jsonl";

export type ObsidianImportReviewLogEntry = {
  review_id: string;
  reviewed_at: string;
  workspace_id: string;
  dry_run: boolean;
  selected_content_hashes: string[];
  rejected_content_hashes: string[];
  counts: ObsidianImportReviewResponse["counts"];
};

export function getObsidianImportReviewLogPath(repoRoot: string) {
  return join(repoRoot, REVIEW_LOG_RELATIVE_PATH);
}

export async function appendObsidianImportReviewLog(
  logPath: string,
  entry: Omit<ObsidianImportReviewLogEntry, "review_id" | "reviewed_at">,
) {
  const stored: ObsidianImportReviewLogEntry = {
    review_id: randomUUID(),
    reviewed_at: new Date().toISOString(),
    ...entry,
  };

  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(stored)}\n`, "utf8");
  return stored;
}

export async function readLatestObsidianImportReviewLog(logPath: string): Promise<ObsidianImportReviewLogEntry | null> {
  const content = await readFile(logPath, "utf8").catch(() => null);
  if (!content) {
    return null;
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]!) as ObsidianImportReviewLogEntry;
    } catch {
      continue;
    }
  }

  return null;
}
