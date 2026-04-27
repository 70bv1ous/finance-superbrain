import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

import {
  obsidianImportConfigSchema,
  obsidianImportSummarySchema,
  type Lesson,
  type ObsidianImportCandidate,
  type ObsidianImportConfig,
  type ObsidianImportSummary,
} from "@finance-superbrain/schemas";

import type { AppServices } from "./services.js";

type ResolvedImportConfig = ObsidianImportConfig & {
  vault_path: string;
  inbox_path: string;
  absolute_inbox_path: string;
  app_url: string | null;
};

type ParsedFrontmatter = Record<string, string | string[] | boolean | null>;

type ParsedNote = {
  absolute_path: string;
  relative_path: string;
  raw: string;
  body: string;
  frontmatter: ParsedFrontmatter;
};

const GENERATED_MARKER = "managed_by: \"finance_superbrain\"";
const IMPORT_MODEL_VERSION = "obsidian-human-import-v1";

function ensureSafeChildPath(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  return relativePath !== "" && !relativePath.startsWith("..") && !relativePath.includes(":");
}

function normalizeImportText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function hashContent(value: string) {
  return createHash("sha256").update(normalizeImportText(value), "utf8").digest("hex");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function parseScalar(value: string): string | string[] | boolean | null {
  const trimmed = value.trim();

  if (trimmed === "" || trimmed === "null") {
    return null;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontmatterBlock(block: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = {};
  const lines = block.split("\n");
  let currentArrayKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (currentArrayKey && trimmed.startsWith("- ")) {
      const current = result[currentArrayKey];
      const nextItem = trimmed.slice(2).trim().replace(/^["']|["']$/g, "");
      result[currentArrayKey] = Array.isArray(current) ? [...current, nextItem].filter(Boolean) : [nextItem].filter(Boolean);
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      currentArrayKey = null;
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key) {
      currentArrayKey = null;
      continue;
    }

    if (!value) {
      result[key] = [];
      currentArrayKey = key;
      continue;
    }

    result[key] = parseScalar(value);
    currentArrayKey = null;
  }

  return result;
}

function parseMarkdownNote(absolutePath: string, vaultPath: string, raw: string): ParsedNote {
  const normalized = raw.replace(/^\uFEFF/u, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(normalized);
  const frontmatter = match ? parseFrontmatterBlock(match[1] ?? "") : {};
  const body = match ? match[2] ?? "" : normalized;

  return {
    absolute_path: absolutePath,
    relative_path: relative(vaultPath, absolutePath).replace(/\\/g, "/"),
    raw: normalized,
    body: body.trim(),
    frontmatter,
  };
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function firstHeading(body: string) {
  return /^#\s+(.+)$/mu.exec(body)?.[1]?.trim() ?? "";
}

function firstMeaningfulParagraph(body: string) {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("```"));

  const paragraph = lines.slice(0, 4).join(" ").replace(/\s+/g, " ").trim();

  return paragraph.slice(0, 900);
}

function buildCandidateFromNote(
  note: ParsedNote,
  existingImportedLessonsByHash: Map<string, Lesson>,
): ObsidianImportCandidate {
  const contentHash = hashContent(note.raw);
  const existingLesson = existingImportedLessonsByHash.get(contentHash);
  const explicitImport = note.frontmatter["fs_import"] === true || note.frontmatter["finance_superbrain_import"] === true;
  const managedBy = toStringValue(note.frontmatter["managed_by"]);
  const title =
    toStringValue(note.frontmatter["title"]) ||
    firstHeading(note.body) ||
    note.relative_path.split("/").at(-1)?.replace(/\.md$/i, "") ||
    "Untitled Obsidian note";
  const rawLessonType = toStringValue(note.frontmatter["lesson_type"]);
  const lessonType = rawLessonType === "mistake" ? "mistake" : "reinforcement";
  const summary = toStringValue(note.frontmatter["summary"]) || firstMeaningfulParagraph(note.body) || title;
  const rawLinkedPredictionId = toStringValue(note.frontmatter["prediction_id"]) || toStringValue(note.frontmatter["linked_prediction_id"]);
  const linkedPredictionId = isUuid(rawLinkedPredictionId) ? rawLinkedPredictionId : "";

  if (managedBy === "finance_superbrain" || note.raw.includes(GENERATED_MARKER)) {
    return {
      title,
      relative_path: note.relative_path,
      content_hash: contentHash,
      status: "skipped",
      reason: "Generated Finance Superbrain notes are export output and are never imported back.",
      lesson_type: lessonType,
      summary,
      themes: toStringArray(note.frontmatter["themes"]),
      assets: toStringArray(note.frontmatter["assets"]),
      tags: toStringArray(note.frontmatter["tags"]),
      linked_prediction_id: null,
      linked_decision_brief_id: null,
      linked_portfolio_candidate_id: null,
      imported_lesson_id: null,
      imported_prediction_id: null,
    };
  }

  if (!explicitImport) {
    return {
      title,
      relative_path: note.relative_path,
      content_hash: contentHash,
      status: "skipped",
      reason: "Note is missing fs_import: true frontmatter.",
      lesson_type: lessonType,
      summary,
      themes: toStringArray(note.frontmatter["themes"]),
      assets: toStringArray(note.frontmatter["assets"]),
      tags: toStringArray(note.frontmatter["tags"]),
      linked_prediction_id: null,
      linked_decision_brief_id: null,
      linked_portfolio_candidate_id: null,
      imported_lesson_id: null,
      imported_prediction_id: null,
    };
  }

  if (existingLesson) {
    return {
      title,
      relative_path: note.relative_path,
      content_hash: contentHash,
      status: "duplicate",
      reason: "A lesson with the same Obsidian content hash already exists.",
      lesson_type: lessonType,
      summary,
      themes: toStringArray(note.frontmatter["themes"]),
      assets: toStringArray(note.frontmatter["assets"]),
      tags: toStringArray(note.frontmatter["tags"]),
      linked_prediction_id: existingLesson.prediction_id,
      linked_decision_brief_id: toStringValue(note.frontmatter["decision_brief_id"]) || null,
      linked_portfolio_candidate_id: toStringValue(note.frontmatter["portfolio_candidate_id"]) || null,
      imported_lesson_id: existingLesson.id,
      imported_prediction_id: existingLesson.prediction_id,
    };
  }

  return {
    title,
    relative_path: note.relative_path,
    content_hash: contentHash,
    status: "importable",
    reason: null,
    lesson_type: lessonType,
    summary,
    themes: toStringArray(note.frontmatter["themes"]),
    assets: toStringArray(note.frontmatter["assets"]),
    tags: toStringArray(note.frontmatter["tags"]),
    linked_prediction_id: linkedPredictionId || null,
    linked_decision_brief_id: toStringValue(note.frontmatter["decision_brief_id"]) || null,
    linked_portfolio_candidate_id: toStringValue(note.frontmatter["portfolio_candidate_id"]) || null,
    imported_lesson_id: null,
    imported_prediction_id: null,
  };
}

async function resolveImportConfig(config: ObsidianImportConfig): Promise<ResolvedImportConfig> {
  const parsed = obsidianImportConfigSchema.parse(config);
  const vaultPath = resolve(parsed.vault_path);
  const vaultStats = await stat(vaultPath).catch(() => null);

  if (!vaultStats || !vaultStats.isDirectory()) {
    throw new Error(`OBSIDIAN_VAULT_PATH must point to an existing directory: ${vaultPath}`);
  }

  const absoluteInboxPath = resolve(vaultPath, parsed.inbox_path);
  if (!ensureSafeChildPath(vaultPath, absoluteInboxPath)) {
    throw new Error("OBSIDIAN_IMPORT_INBOX must stay inside the configured Obsidian vault.");
  }

  return {
    ...parsed,
    vault_path: vaultPath,
    inbox_path: parsed.inbox_path,
    absolute_inbox_path: absoluteInboxPath,
    app_url: parsed.app_url ?? null,
  };
}

async function listMarkdownFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function buildExistingImportedLessonsByHash(lessons: Lesson[]) {
  const result = new Map<string, Lesson>();

  for (const lesson of lessons) {
    const hash = lesson.metadata["obsidian_content_hash"];
    if (hash) {
      result.set(hash, lesson);
    }
  }

  return result;
}

function buildLessonMetadata(input: {
  candidate: ObsidianImportCandidate;
  config: ResolvedImportConfig;
}) {
  const metadata: Record<string, string> = {
    imported_from: "obsidian",
    import_mode: "selective_human_inbox",
    obsidian_content_hash: input.candidate.content_hash,
    obsidian_relative_path: input.candidate.relative_path,
    obsidian_title: input.candidate.title,
  };

  if (input.candidate.themes.length) {
    metadata.themes = input.candidate.themes.join(",");
  }

  if (input.candidate.assets.length) {
    metadata.assets = input.candidate.assets.join(",");
  }

  if (input.candidate.tags.length) {
    metadata.tags = input.candidate.tags.join(",");
  }

  if (input.candidate.linked_decision_brief_id) {
    metadata.decision_brief_id = input.candidate.linked_decision_brief_id;
  }

  if (input.candidate.linked_portfolio_candidate_id) {
    metadata.portfolio_candidate_id = input.candidate.linked_portfolio_candidate_id;
  }

  if (input.config.app_url) {
    metadata.app_url = input.config.app_url;
  }

  return metadata;
}

function buildSourceRawText(note: ParsedNote, candidate: ObsidianImportCandidate) {
  const text = normalizeImportText(note.body || candidate.summary);

  if (text.length >= 20) {
    return text.slice(0, 20_000);
  }

  return `${candidate.title}\n\n${candidate.summary}\n\nImported from Obsidian human inbox for retrieval memory.`.slice(0, 20_000);
}

async function importCandidateAsRetrievalMemory(
  services: AppServices,
  config: ResolvedImportConfig,
  note: ParsedNote,
  candidate: ObsidianImportCandidate,
): Promise<ObsidianImportCandidate> {
  let predictionId = candidate.linked_prediction_id;

  if (predictionId) {
    const linkedPrediction = await services.repository.getPrediction(predictionId);
    if (!linkedPrediction) {
      predictionId = null;
    }
  }

  if (!predictionId) {
    const source = await services.repository.createSource({
      source_type: "user_note",
      title: candidate.title,
      publisher: "Obsidian Human Inbox",
      raw_uri: `https://finance-superbrain.local/obsidian-import/${candidate.content_hash}`,
      raw_text: buildSourceRawText(note, candidate),
    });
    const event = await services.repository.createEvent(source.id, {
      event_class: "market_commentary",
      summary: candidate.summary,
      sentiment: "neutral",
      urgency_score: 0.2,
      novelty_score: 0.4,
      entities: candidate.themes.map((theme) => ({ type: "theme" as const, value: theme })),
      themes: candidate.themes,
      candidate_assets: candidate.assets,
      why_it_matters: [
        "This is curated human-authored memory imported from Obsidian for retrieval support.",
        "The note should inform future reasoning only after the operator explicitly marked it for import.",
      ],
    });
    const prediction = await services.repository.createPrediction(event.id, {
      horizon: "1d",
      thesis: `Imported human memory: ${candidate.summary}`,
      confidence: 0.5,
      assets: candidate.assets.map((ticker) => ({
        ticker,
        expected_direction: "mixed" as const,
        expected_magnitude_bp: 0,
        conviction: 0.35,
      })),
      evidence: [
        `Obsidian note: ${candidate.title}`,
        candidate.summary,
      ],
      invalidations: [
        "This is human-authored context, not a fresh market signal.",
        "Verify against current source data before using it as an active thesis.",
      ],
      assumptions: [
        "The operator intentionally marked this note with fs_import: true.",
        "The note is useful as retrieval memory, not as an automatic decision update.",
      ],
      model_version: IMPORT_MODEL_VERSION,
    });
    await services.repository.updatePredictionStatus(prediction.id, "reviewed");
    predictionId = prediction.id;
  }

  const lesson: Lesson = {
    id: randomUUID(),
    prediction_id: predictionId,
    lesson_type: candidate.lesson_type,
    lesson_summary: candidate.summary,
    metadata: buildLessonMetadata({ candidate, config }),
    created_at: new Date().toISOString(),
  };
  const embedding = await services.embeddingProvider.embedText(
    [candidate.title, candidate.summary, note.body].filter(Boolean).join("\n\n"),
  );
  const savedLesson = await services.repository.saveLesson(lesson, embedding);

  return {
    ...candidate,
    status: "imported",
    reason: null,
    imported_lesson_id: savedLesson.id,
    imported_prediction_id: predictionId,
    linked_prediction_id: predictionId,
  };
}

function countCandidates(candidates: ObsidianImportCandidate[]) {
  return {
    scanned: candidates.length,
    importable: candidates.filter((candidate) => candidate.status === "importable").length,
    imported: candidates.filter((candidate) => candidate.status === "imported").length,
    duplicate: candidates.filter((candidate) => candidate.status === "duplicate").length,
    skipped: candidates.filter((candidate) => candidate.status === "skipped").length,
    errors: candidates.filter((candidate) => candidate.status === "error").length,
  };
}

export async function importObsidianHumanInbox(
  services: AppServices,
  config: ObsidianImportConfig,
): Promise<ObsidianImportSummary> {
  const resolvedConfig = await resolveImportConfig(config);
  const workspace = await services.repository.getOrCreateDefaultWorkspace();
  const inboxStats = await stat(resolvedConfig.absolute_inbox_path).catch(() => null);
  const warnings: string[] = [];

  if (!inboxStats || !inboxStats.isDirectory()) {
    warnings.push(`Obsidian import inbox does not exist yet: ${resolvedConfig.absolute_inbox_path}`);
    return obsidianImportSummarySchema.parse({
      workspace_id: workspace.id,
      inbox_path: resolvedConfig.absolute_inbox_path,
      dry_run: resolvedConfig.dry_run,
      counts: countCandidates([]),
      candidates: [],
      warnings,
    });
  }

  const markdownFiles = (await listMarkdownFiles(resolvedConfig.absolute_inbox_path)).slice(0, resolvedConfig.max_notes);
  const existingImportedLessonsByHash = buildExistingImportedLessonsByHash(await services.repository.listLessons());
  const notes = await Promise.all(
    markdownFiles.map(async (filePath) => parseMarkdownNote(filePath, resolvedConfig.vault_path, await readFile(filePath, "utf8"))),
  );
  const candidates = notes.map((note) => buildCandidateFromNote(note, existingImportedLessonsByHash));
  const candidatesByHash = new Map(candidates.map((candidate) => [candidate.content_hash, candidate]));

  if (!resolvedConfig.dry_run) {
    for (const note of notes) {
      const candidate = candidatesByHash.get(hashContent(note.raw));
      if (!candidate || candidate.status !== "importable") {
        continue;
      }

      try {
        const imported = await importCandidateAsRetrievalMemory(services, resolvedConfig, note, candidate);
        candidatesByHash.set(imported.content_hash, imported);
      } catch (error) {
        candidatesByHash.set(candidate.content_hash, {
          ...candidate,
          status: "error",
          reason: error instanceof Error ? error.message : "Failed to import note.",
        });
      }
    }
  }

  const finalCandidates = candidates.map((candidate) => candidatesByHash.get(candidate.content_hash) ?? candidate);

  return obsidianImportSummarySchema.parse({
    workspace_id: workspace.id,
    inbox_path: resolvedConfig.absolute_inbox_path,
    dry_run: resolvedConfig.dry_run,
    counts: countCandidates(finalCandidates),
    candidates: finalCandidates,
    warnings,
  });
}

export function buildObsidianImportConfigFromEnv(
  env: NodeJS.ProcessEnv,
  options: {
    apply?: boolean;
  } = {},
): ObsidianImportConfig {
  const vaultPath = env.OBSIDIAN_VAULT_PATH?.trim();
  if (!vaultPath) {
    throw new Error("OBSIDIAN_VAULT_PATH is required for Obsidian import.");
  }

  const exportRoot = env.OBSIDIAN_EXPORT_ROOT?.trim() || "Finance Superbrain";

  return obsidianImportConfigSchema.parse({
    vault_path: vaultPath,
    inbox_path: env.OBSIDIAN_IMPORT_INBOX?.trim() || `${exportRoot}/Human Inbox`,
    app_url: env.FINANCE_SUPERBRAIN_APP_URL?.trim() || null,
    dry_run: !options.apply,
    max_notes: env.OBSIDIAN_IMPORT_MAX_NOTES ? Number(env.OBSIDIAN_IMPORT_MAX_NOTES) : 50,
  });
}
