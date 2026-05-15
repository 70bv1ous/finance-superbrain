import { z } from "zod";

export const obsidianNoteTypeSchema = z.enum([
  "index",
  "investigation",
  "decision_brief",
  "portfolio_candidate",
  "lesson",
  "activity",
  "connection",
  "project",
]);

export const obsidianExportConfigSchema = z.object({
  vault_path: z.string().min(1),
  export_root: z.string().min(1).default("Finance Superbrain"),
  app_url: z.url().nullable().optional(),
  dry_run: z.boolean().default(false),
});

export const obsidianExportNoteCountsSchema = z.object({
  investigations: z.number().int().min(0),
  decision_briefs: z.number().int().min(0),
  portfolio_candidates: z.number().int().min(0),
  lessons: z.number().int().min(0),
  activity: z.number().int().min(0),
  connections: z.number().int().min(0),
  project: z.number().int().min(0),
  indexes: z.number().int().min(0),
  total: z.number().int().min(0),
});

export const obsidianExportSummarySchema = z.object({
  workspace_id: z.string().uuid(),
  output_path: z.string().min(1),
  dry_run: z.boolean(),
  note_counts: obsidianExportNoteCountsSchema,
  warnings: z.array(z.string()),
});

export const obsidianImportConfigSchema = z.object({
  vault_path: z.string().min(1),
  inbox_path: z.string().min(1).default("Finance Superbrain/Human Inbox"),
  app_url: z.url().nullable().optional(),
  dry_run: z.boolean().default(true),
  max_notes: z.number().int().min(1).max(200).default(50),
});

export const obsidianImportCandidateStatusSchema = z.enum([
  "importable",
  "duplicate",
  "skipped",
  "imported",
  "error",
]);

export const obsidianImportCandidateSchema = z.object({
  title: z.string().min(1),
  relative_path: z.string().min(1),
  content_hash: z.string().min(16),
  status: obsidianImportCandidateStatusSchema,
  reason: z.string().min(1).nullable(),
  lesson_type: z.enum(["mistake", "reinforcement"]),
  summary: z.string().min(1),
  themes: z.array(z.string().min(1)),
  assets: z.array(z.string().min(1)),
  tags: z.array(z.string().min(1)),
  linked_prediction_id: z.string().uuid().nullable(),
  linked_investigation_id: z.string().min(1).nullable(),
  linked_decision_brief_id: z.string().min(1).nullable(),
  linked_portfolio_candidate_id: z.string().min(1).nullable(),
  imported_lesson_id: z.string().uuid().nullable(),
  imported_prediction_id: z.string().uuid().nullable(),
});

export const obsidianImportReviewRequestSchema = z.object({
  selected_content_hashes: z.array(z.string().min(1)).default([]),
});

export const obsidianImportSummarySchema = z.object({
  workspace_id: z.string().uuid(),
  inbox_path: z.string().min(1),
  dry_run: z.boolean(),
  counts: z.object({
    scanned: z.number().int().min(0),
    importable: z.number().int().min(0),
    imported: z.number().int().min(0),
    duplicate: z.number().int().min(0),
    skipped: z.number().int().min(0),
    errors: z.number().int().min(0),
  }),
  candidates: z.array(obsidianImportCandidateSchema),
  warnings: z.array(z.string()),
});

export const obsidianImportReviewResponseSchema = z.object({
  workspace_id: z.string().uuid(),
  inbox_path: z.string().min(1),
  dry_run: z.boolean(),
  counts: z.object({
    scanned: z.number().int().min(0),
    importable: z.number().int().min(0),
    imported: z.number().int().min(0),
    duplicate: z.number().int().min(0),
    skipped: z.number().int().min(0),
    errors: z.number().int().min(0),
  }),
  candidates: z.array(obsidianImportCandidateSchema),
  warnings: z.array(z.string()),
  selected_content_hashes: z.array(z.string().min(1)),
  rejected_content_hashes: z.array(z.string().min(1)),
});

export const obsidianWorkspaceSyncRequestSchema = z.object({
  mode: z.enum(["manual", "watch"]).default("manual"),
});

export const obsidianWorkspaceSyncSessionSummarySchema = z.object({
  captured_at: z.string().min(1),
  mode: z.enum(["manual", "watch"]),
  dirty: z.boolean(),
  changed_files: z.number().int().min(0),
});

export const obsidianWorkspaceSyncResponseSchema = z.object({
  workspace_id: z.string().uuid(),
  target_path: z.string().min(1),
  captured_at: z.string().min(1),
  mode: z.enum(["manual", "watch"]),
  dirty: z.boolean(),
  changed_files: z.number().int().min(0),
  branch: z.string().min(1).nullable(),
  head: z.string().min(1).nullable(),
  changed_file_paths: z.array(z.string()),
  recent_sessions: z.array(obsidianWorkspaceSyncSessionSummarySchema),
  export_note_counts: obsidianExportNoteCountsSchema.nullable(),
  latest_import_review: z
    .object({
      reviewed_at: z.string().min(1),
      selected: z.number().int().min(0),
      rejected: z.number().int().min(0),
      imported: z.number().int().min(0),
      skipped: z.number().int().min(0),
      duplicate: z.number().int().min(0),
    })
    .nullable(),
});

export const obsidianNoteFrontmatterBaseSchema = z.object({
  managed_by: z.literal("finance_superbrain"),
  type: obsidianNoteTypeSchema,
  workspace_id: z.string().uuid(),
  app_url: z.string().min(1).nullable().optional(),
  created_at: z.string().min(1).nullable().optional(),
  updated_at: z.string().min(1).nullable().optional(),
});

export const obsidianInvestigationFrontmatterSchema = obsidianNoteFrontmatterBaseSchema.extend({
  type: z.literal("investigation"),
  investigation_id: z.string().min(1),
  status: z.string().min(1),
  owner_user_id: z.string().uuid(),
  assignee_user_id: z.string().uuid().nullable(),
  prediction_ids: z.array(z.string().min(1)),
});

export const obsidianDecisionBriefFrontmatterSchema = obsidianNoteFrontmatterBaseSchema.extend({
  type: z.literal("decision_brief"),
  decision_brief_id: z.string().min(1),
  investigation_id: z.string().min(1),
  lead_prediction_id: z.string().min(1),
  status: z.string().min(1),
  confidence_label: z.string().min(1),
  key_assets: z.array(z.string().min(1)),
});

export const obsidianPortfolioCandidateFrontmatterSchema = obsidianNoteFrontmatterBaseSchema.extend({
  type: z.literal("portfolio_candidate"),
  portfolio_candidate_id: z.string().min(1),
  decision_brief_id: z.string().min(1),
  investigation_id: z.string().min(1),
  status: z.string().min(1),
  priority: z.string().min(1),
  conviction_label: z.string().min(1),
  primary_theme: z.string().min(1),
  related_assets: z.array(z.string().min(1)),
});

export const obsidianLessonFrontmatterSchema = obsidianNoteFrontmatterBaseSchema.extend({
  type: z.literal("lesson"),
  lesson_id: z.string().uuid(),
  prediction_id: z.string().uuid(),
  lesson_type: z.string().min(1),
  linked_investigation_id: z.string().min(1).nullable().optional(),
  linked_decision_brief_id: z.string().min(1).nullable().optional(),
  linked_portfolio_candidate_id: z.string().min(1).nullable().optional(),
});

export const obsidianActivityFrontmatterSchema = obsidianNoteFrontmatterBaseSchema.extend({
  type: z.literal("activity"),
});

export const obsidianConnectionFrontmatterSchema = obsidianNoteFrontmatterBaseSchema.extend({
  type: z.literal("connection"),
  connection_key: z.string().min(1),
  signal: z.string().min(1),
  reason_codes: z.array(z.string().min(1)),
  linked_note_count: z.number().int().min(0),
});

export const obsidianSyncSessionSchema = z.object({
  session_id: z.string().min(1),
  captured_at: z.string().min(1),
  mode: z.enum(["manual", "watch"]),
  branch: z.string().min(1).nullable(),
  head: z.string().min(1).nullable(),
  dirty: z.boolean(),
  status_lines: z.array(z.string()),
  changed_files: z.array(z.string()),
});

export const obsidianSyncStateSchema = z.object({
  version: z.literal(1),
  updated_at: z.string().min(1),
  workspace_id: z.string().uuid().nullable().optional(),
  sessions: z.array(obsidianSyncSessionSchema),
});

export type ObsidianNoteType = z.infer<typeof obsidianNoteTypeSchema>;
export type ObsidianExportConfig = z.infer<typeof obsidianExportConfigSchema>;
export type ObsidianExportNoteCounts = z.infer<typeof obsidianExportNoteCountsSchema>;
export type ObsidianExportSummary = z.infer<typeof obsidianExportSummarySchema>;
export type ObsidianImportConfig = z.infer<typeof obsidianImportConfigSchema>;
export type ObsidianImportCandidateStatus = z.infer<typeof obsidianImportCandidateStatusSchema>;
export type ObsidianImportCandidate = z.infer<typeof obsidianImportCandidateSchema>;
export type ObsidianImportReviewRequest = z.infer<typeof obsidianImportReviewRequestSchema>;
export type ObsidianImportReviewResponse = z.infer<typeof obsidianImportReviewResponseSchema>;
export type ObsidianWorkspaceSyncRequest = z.infer<typeof obsidianWorkspaceSyncRequestSchema>;
export type ObsidianWorkspaceSyncResponse = z.infer<typeof obsidianWorkspaceSyncResponseSchema>;
export type ObsidianImportSummary = z.infer<typeof obsidianImportSummarySchema>;
export type ObsidianNoteFrontmatter = z.infer<typeof obsidianNoteFrontmatterBaseSchema>;
export type ObsidianInvestigationFrontmatter = z.infer<typeof obsidianInvestigationFrontmatterSchema>;
export type ObsidianDecisionBriefFrontmatter = z.infer<typeof obsidianDecisionBriefFrontmatterSchema>;
export type ObsidianPortfolioCandidateFrontmatter = z.infer<typeof obsidianPortfolioCandidateFrontmatterSchema>;
export type ObsidianLessonFrontmatter = z.infer<typeof obsidianLessonFrontmatterSchema>;
export type ObsidianActivityFrontmatter = z.infer<typeof obsidianActivityFrontmatterSchema>;
export type ObsidianConnectionFrontmatter = z.infer<typeof obsidianConnectionFrontmatterSchema>;
export type ObsidianSyncSession = z.infer<typeof obsidianSyncSessionSchema>;
export type ObsidianSyncState = z.infer<typeof obsidianSyncStateSchema>;
