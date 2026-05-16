import { type ObsidianNoteFrontmatter, type ObsidianSyncState } from "@finance-superbrain/schemas";
import type { ObsidianImportReviewLogEntry } from "./obsidianImportReviewLog.js";

function renderSection(title: string, body: string) {
  return `## ${title}\n${body.trim()}`;
}

function renderBulletList(items: string[], empty = "- None yet.") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return value.replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC");
}

export function buildObsidianWorkSessionMarkdown(input: {
  workspace_id: string;
  created_at: string;
  updated_at: string;
  app_url: string | null;
  sync_state: ObsidianSyncState | null;
  latest_review: ObsidianImportReviewLogEntry | null;
  export_note_counts?: {
    investigations: number;
    decision_briefs: number;
    portfolio_candidates: number;
    lessons: number;
    activity: number;
    connections: number;
    project: number;
    indexes: number;
    total: number;
  } | null;
  plugin_status_note_path?: string | null;
}) {
  const frontmatter = {
    managed_by: "finance_superbrain",
    type: "project",
    workspace_id: input.workspace_id,
    app_url: input.app_url,
    created_at: input.created_at,
    updated_at: input.updated_at,
  } satisfies ObsidianNoteFrontmatter;

  const latestSession = input.sync_state?.sessions[0] ?? null;
  const recentSessions = input.sync_state?.sessions.slice(0, 5) ?? [];
  const pluginStatusNotePath = input.plugin_status_note_path?.trim() || null;
  const pluginStatusNoteLink = pluginStatusNotePath
    ? `[[${pluginStatusNotePath.replace(/\\/g, "/").replace(/\.md$/i, "")}|Obsidian Plugin Sync]]`
    : null;

  return [
    `---\n${Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? JSON.stringify(value) : value === null ? "null" : JSON.stringify(value)}`)
      .join("\n")}\n---`,
    "# Work Session",
    "",
    "Generated project memory for automatic workspace syncing.",
    "",
    renderSection(
      "Current Snapshot",
      latestSession
        ? [
            `- Captured: ${formatTimestamp(latestSession.captured_at)}`,
            `- Mode: ${latestSession.mode}`,
            `- Branch: ${latestSession.branch ?? "Not available"}`,
            `- Head: ${latestSession.head ?? "Not available"}`,
            `- Dirty tree: ${latestSession.dirty ? "yes" : "no"}`,
            `- Changed files: ${latestSession.changed_files.length}`,
          ].join("\n")
        : "- No automatic sync snapshot has been captured yet.",
    ),
    renderSection(
      "Recent Changes",
      latestSession
        ? renderBulletList(
            latestSession.changed_files.slice(0, 20).map((file) => file.replace(/\\/g, "/")),
            "- No file changes were captured.",
          )
        : [
            "- Run `npm run ops:obsidian-sync -- --watch` to keep this note current while you work.",
            "- Run `npm run ops:obsidian-sync` for a one-time snapshot.",
          ].join("\n"),
    ),
    renderSection(
      "Recent Sessions",
      recentSessions.length
        ? renderBulletList(
            recentSessions.map((session) => {
              const cleanliness = session.dirty ? "dirty" : "clean";
              return `${formatTimestamp(session.captured_at)} | ${session.mode} | ${cleanliness} | ${session.changed_files.length} files`;
            }),
          )
        : "- No session history yet.",
    ),
    renderSection(
      "Automation",
      [
        "- The auto-sync command records git state into `.finance-superbrain/obsidian-sync-state.json`.",
        input.export_note_counts
          ? `- The last full workspace export wrote ${input.export_note_counts.total} managed notes into Obsidian.`
          : "- The last full workspace export count is not available yet.",
        pluginStatusNoteLink
          ? `- Companion plugin status note: ${pluginStatusNoteLink}.`
          : "- Companion plugin status note is not configured.",
        "- The app-generated work-session note and plugin-generated status note read the same sync/review state.",
        "- Product memory export stays separate so raw workspace changes do not overwrite reviewed decision memory.",
      ].join("\n"),
    ),
    renderSection(
      "Latest Import Review",
      input.latest_review
        ? [
            `- Reviewed: ${formatTimestamp(input.latest_review.reviewed_at)}`,
            `- Selected: ${input.latest_review.selected_content_hashes.length}`,
            `- Rejected: ${input.latest_review.rejected_content_hashes.length}`,
            `- Imported: ${input.latest_review.counts.imported}`,
            `- Skipped: ${input.latest_review.counts.skipped}`,
            `- Duplicate: ${input.latest_review.counts.duplicate}`,
          ].join("\n")
        : "- No applied import review has been recorded yet.",
    ),
  ].join("\n\n");
}
