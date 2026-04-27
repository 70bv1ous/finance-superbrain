import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

import {
  obsidianActivityFrontmatterSchema,
  obsidianDecisionBriefFrontmatterSchema,
  obsidianExportConfigSchema,
  obsidianExportSummarySchema,
  obsidianInvestigationFrontmatterSchema,
  obsidianLessonFrontmatterSchema,
  obsidianPortfolioCandidateFrontmatterSchema,
  type DecisionBrief,
  type DecisionCheckpoint,
  type Lesson,
  type ObsidianExportConfig,
  type ObsidianExportSummary,
  type ObsidianNoteFrontmatter,
  type ObsidianNoteType,
  type PortfolioCandidate,
  type PortfolioCheckpoint,
  type PortfolioRebalanceProposal,
  type PortfolioReviewSession,
  type PortfolioReviewSessionItem,
  type SharedInvestigation,
  type SharedStudioRun,
  type Workspace,
  type WorkspaceActivity,
  type WorkspaceRecentItem,
} from "@finance-superbrain/schemas";

import type { PredictionLearningRecord, Repository } from "./repository.types.js";

const EXPORT_FOLDERS = {
  investigations: "Investigations",
  decisions: "Decisions",
  portfolio: "Portfolio",
  lessons: "Lessons",
  activity: "Activity",
  indexes: "Indexes",
} as const;

const MANAGED_MARKER = "managed_by: \"finance_superbrain\"";
const HIGH_SIGNAL_ACTIVITY_KINDS = new Set<WorkspaceActivity["kind"]>([
  "user_created",
  "investigation_assigned",
  "investigation_reopened",
  "review_note_saved",
  "decision_brief_created",
  "decision_brief_assigned",
  "decision_brief_status_changed",
  "decision_checkpoint_saved",
  "decision_brief_closed",
  "portfolio_candidate_created",
  "portfolio_candidate_assigned",
  "portfolio_candidate_status_changed",
  "portfolio_candidate_posture_updated",
  "portfolio_checkpoint_saved",
  "portfolio_candidate_closed",
  "portfolio_review_session_created",
  "portfolio_review_session_updated",
  "portfolio_review_session_finalized",
  "portfolio_rebalance_proposal_saved",
  "portfolio_rebalance_proposal_decided",
  "login",
  "logout",
]);

type MemberEntry = Awaited<ReturnType<Repository["listWorkspaceMembers"]>>[number];

type NoteTarget = {
  type: ObsidianNoteType;
  title: string;
  relative_path: string;
  absolute_path: string;
  vault_link: string;
};

type RenderedNote = {
  type: ObsidianNoteType;
  absolute_path: string;
  relative_path: string;
  content: string;
};

type ExportGraph = {
  workspace: Workspace;
  members: MemberEntry[];
  studio_runs: SharedStudioRun[];
  investigations: SharedInvestigation[];
  decision_briefs: DecisionBrief[];
  decision_checkpoints_by_brief_id: Map<string, DecisionCheckpoint[]>;
  portfolio_candidates: PortfolioCandidate[];
  portfolio_checkpoints_by_candidate_id: Map<string, PortfolioCheckpoint[]>;
  portfolio_review_sessions: PortfolioReviewSession[];
  portfolio_review_items_by_session_id: Map<string, PortfolioReviewSessionItem[]>;
  portfolio_proposals_by_session_id: Map<string, PortfolioRebalanceProposal[]>;
  recent_items: WorkspaceRecentItem[];
  activity: WorkspaceActivity[];
  learning_records: PredictionLearningRecord[];
  lessons: Lesson[];
};

type ExportContext = {
  config: ResolvedExportConfig;
  graph: ExportGraph;
  member_name_by_id: Map<string, string>;
  investigation_note_by_id: Map<string, NoteTarget>;
  decision_note_by_id: Map<string, NoteTarget>;
  portfolio_note_by_id: Map<string, NoteTarget>;
  lesson_note_by_id: Map<string, NoteTarget>;
  index_notes: {
    workspace_overview: NoteTarget;
    investigations_index: NoteTarget;
    decision_briefs_index: NoteTarget;
    portfolio_index: NoteTarget;
    lessons_index: NoteTarget;
    recent_activity: NoteTarget;
  };
  activity_notes: {
    recent_log: NoteTarget;
    latest_summary: NoteTarget;
  };
};

type ResolvedExportConfig = ObsidianExportConfig & {
  vault_path: string;
  export_root: string;
  output_path: string;
  app_url: string | null;
};

type LatestReviewSessionContext = {
  session: PortfolioReviewSession;
  item: PortfolioReviewSessionItem;
  proposals: PortfolioRebalanceProposal[];
} | null;

function slugify(value: string, fallback: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return normalized || fallback;
}

function ensureSafeChildPath(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  return relativePath !== "" && !relativePath.startsWith("..") && !relativePath.includes(":");
}

function toYamlScalar(value: unknown, indent = 0): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    return value
      .map((item) => {
        if (Array.isArray(item) || (item && typeof item === "object")) {
          return `${" ".repeat(indent)}-\n${toYamlBlock(item, indent + 2)}`;
        }

        return `${" ".repeat(indent)}- ${toYamlScalar(item, indent + 2)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    return `\n${toYamlBlock(value as Record<string, unknown>, indent + 2)}`;
  }

  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(String(value));
}

function toYamlBlock(record: Record<string, unknown>, indent = 0): string {
  return Object.entries(record)
    .map(([key, value]) => {
      const prefix = `${" ".repeat(indent)}${key}:`;
      if (Array.isArray(value) && value.length > 0) {
        return `${prefix}\n${toYamlScalar(value, indent + 2)}`;
      }

      if (value && typeof value === "object" && !Array.isArray(value)) {
        return `${prefix}\n${toYamlBlock(value as Record<string, unknown>, indent + 2)}`;
      }

      return `${prefix} ${toYamlScalar(value, indent + 2)}`;
    })
    .join("\n");
}

function renderFrontmatter(frontmatter: ObsidianNoteFrontmatter) {
  return `---\n${toYamlBlock(frontmatter)}\n---`;
}

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

function toDisplayName(userId: string | null | undefined, memberNameById: Map<string, string>) {
  if (!userId) {
    return "Unassigned";
  }

  return memberNameById.get(userId) ?? userId;
}

function buildAppUrl(baseUrl: string | null, path: string) {
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function renderAppLink(label: string, href: string | null) {
  return href ? `[${label}](${href})` : label;
}

function sortByUpdatedAtDescending<T extends { updated_at: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
}

function sortByCreatedAtDescending<T extends { created_at: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const result = new Map<string, T[]>();

  for (const item of items) {
    const bucket = result.get(key(item));
    if (bucket) {
      bucket.push(item);
    } else {
      result.set(key(item), [item]);
    }
  }

  return result;
}

function pickLatestBy<T>(items: T[], key: (item: T) => string, getTimestamp: (item: T) => string) {
  const result = new Map<string, T>();

  for (const item of items) {
    const itemKey = key(item);
    const current = result.get(itemKey);
    if (!current || Date.parse(getTimestamp(item)) > Date.parse(getTimestamp(current))) {
      result.set(itemKey, item);
    }
  }

  return result;
}

function toVaultLinkPath(exportRoot: string, relativePath: string) {
  const withoutExtension = relativePath.replace(/\\/g, "/").replace(/\.md$/i, "");
  return `${exportRoot}/${withoutExtension}`;
}

function createNoteTarget(
  outputRoot: string,
  exportRoot: string,
  folder: string,
  fileName: string,
  type: ObsidianNoteType,
  title: string,
): NoteTarget {
  const relativePath = join(folder, fileName);
  return {
    type,
    title,
    relative_path: relativePath,
    absolute_path: join(outputRoot, relativePath),
    vault_link: toVaultLinkPath(exportRoot, relativePath),
  };
}

function wikiLink(target: NoteTarget | null | undefined, label?: string) {
  if (!target) {
    return label ?? "Not linked";
  }

  return `[[${target.vault_link}${label ? `|${label}` : ""}]]`;
}

function buildTargetMaps(graph: ExportGraph, config: ResolvedExportConfig) {
  const investigationNoteById = new Map<string, NoteTarget>();
  const decisionNoteById = new Map<string, NoteTarget>();
  const portfolioNoteById = new Map<string, NoteTarget>();
  const lessonNoteById = new Map<string, NoteTarget>();

  for (const investigation of graph.investigations) {
    investigationNoteById.set(
      investigation.id,
      createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.investigations,
        `${slugify(investigation.title, "investigation")}--${investigation.id}.md`,
        "investigation",
        investigation.title,
      ),
    );
  }

  for (const brief of graph.decision_briefs) {
    decisionNoteById.set(
      brief.id,
      createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.decisions,
        `${slugify(brief.title, "decision-brief")}--${brief.id}.md`,
        "decision_brief",
        brief.title,
      ),
    );
  }

  for (const candidate of graph.portfolio_candidates) {
    portfolioNoteById.set(
      candidate.id,
      createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.portfolio,
        `${slugify(candidate.title, "portfolio-candidate")}--${candidate.id}.md`,
        "portfolio_candidate",
        candidate.title,
      ),
    );
  }

  for (const lesson of graph.lessons) {
    lessonNoteById.set(
      lesson.id,
      createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.lessons,
        `${slugify(lesson.lesson_summary, "lesson")}--${lesson.id}.md`,
        "lesson",
        lesson.lesson_summary,
      ),
    );
  }

  return {
    investigationNoteById,
    decisionNoteById,
    portfolioNoteById,
    lessonNoteById,
    indexNotes: {
      workspace_overview: createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.indexes,
        "Workspace Overview.md",
        "index",
        "Workspace Overview",
      ),
      investigations_index: createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.indexes,
        "Investigations Index.md",
        "index",
        "Investigations Index",
      ),
      decision_briefs_index: createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.indexes,
        "Decision Briefs Index.md",
        "index",
        "Decision Briefs Index",
      ),
      portfolio_index: createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.indexes,
        "Portfolio Index.md",
        "index",
        "Portfolio Index",
      ),
      lessons_index: createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.indexes,
        "Lessons Index.md",
        "index",
        "Lessons Index",
      ),
      recent_activity: createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.indexes,
        "Recent Activity.md",
        "index",
        "Recent Activity",
      ),
    },
    activityNotes: {
      recent_log: createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.activity,
        "Recent Activity Log.md",
        "activity",
        "Recent Activity Log",
      ),
      latest_summary: createNoteTarget(
        config.output_path,
        config.export_root,
        EXPORT_FOLDERS.activity,
        "Latest Audit Summary.md",
        "activity",
        "Latest Audit Summary",
      ),
    },
  };
}

async function resolveExportConfig(config: ObsidianExportConfig): Promise<ResolvedExportConfig> {
  const parsed = obsidianExportConfigSchema.parse({
    ...config,
    export_root: config.export_root?.trim() || "Finance Superbrain",
    app_url: config.app_url?.trim() ? config.app_url.trim() : null,
  });

  const vaultPath = resolve(parsed.vault_path);
  const vaultStats = await stat(vaultPath).catch(() => null);

  if (!vaultStats || !vaultStats.isDirectory()) {
    throw new Error(`OBSIDIAN_VAULT_PATH must point to an existing directory: ${vaultPath}`);
  }

  const outputPath = resolve(vaultPath, parsed.export_root);
  if (outputPath === vaultPath || !ensureSafeChildPath(vaultPath, outputPath)) {
    throw new Error("OBSIDIAN_EXPORT_ROOT must stay inside the configured Obsidian vault.");
  }

  return {
    ...parsed,
    vault_path: vaultPath,
    export_root: parsed.export_root,
    output_path: outputPath,
    app_url: parsed.app_url ?? null,
  };
}

async function loadExportGraph(repository: Repository): Promise<ExportGraph> {
  const workspace = await repository.getOrCreateDefaultWorkspace();
  const [members, studioRuns, investigations, decisionBriefs, portfolioCandidates, reviewSessions, recentItems, activity, learningRecords] =
    await Promise.all([
      repository.listWorkspaceMembers(workspace.id),
      repository.listSharedStudioRuns({
        workspace_id: workspace.id,
        limit: 128,
      }),
      repository.listSharedInvestigations({
        workspace_id: workspace.id,
        limit: 512,
      }),
      repository.listDecisionBriefs({
        workspace_id: workspace.id,
        limit: 512,
      }),
      repository.listPortfolioCandidates({
        workspace_id: workspace.id,
        limit: 512,
      }),
      repository.listPortfolioReviewSessions({
        workspace_id: workspace.id,
        limit: 128,
      }),
      repository.listWorkspaceRecentItems({
        workspace_id: workspace.id,
        limit: 128,
      }),
      repository.listWorkspaceActivity({
        workspace_id: workspace.id,
        limit: 512,
      }),
      repository.listLearningRecords(),
    ]);

  const [decisionCheckpointEntries, portfolioCheckpointEntries, reviewItemEntries, reviewProposalEntries] = await Promise.all([
    Promise.all(
      decisionBriefs.map(async (brief) => [
        brief.id,
        await repository.listDecisionCheckpoints({
          decision_brief_id: brief.id,
          limit: 128,
        }),
      ] as const),
    ),
    Promise.all(
      portfolioCandidates.map(async (candidate) => [
        candidate.id,
        await repository.listPortfolioCheckpoints({
          portfolio_candidate_id: candidate.id,
          limit: 128,
        }),
      ] as const),
    ),
    Promise.all(
      reviewSessions.map(async (session) => [
        session.id,
        await repository.listPortfolioReviewSessionItems({
          review_session_id: session.id,
        }),
      ] as const),
    ),
    Promise.all(
      reviewSessions.map(async (session) => [
        session.id,
        await repository.listPortfolioRebalanceProposals({
          review_session_id: session.id,
        }),
      ] as const),
    ),
  ]);

  const decisionCheckpointsByBriefId = new Map<string, DecisionCheckpoint[]>(decisionCheckpointEntries);
  const portfolioCheckpointsByCandidateId = new Map<string, PortfolioCheckpoint[]>(portfolioCheckpointEntries);
  const portfolioReviewItemsBySessionId = new Map<string, PortfolioReviewSessionItem[]>(reviewItemEntries);
  const portfolioProposalsBySessionId = new Map<string, PortfolioRebalanceProposal[]>(reviewProposalEntries);
  const lessons = learningRecords
    .map((record) => record.lesson)
    .filter((lesson): lesson is Lesson => Boolean(lesson));

  return {
    workspace,
    members,
    studio_runs: sortByUpdatedAtDescending(studioRuns),
    investigations: sortByUpdatedAtDescending(investigations),
    decision_briefs: sortByUpdatedAtDescending(decisionBriefs),
    decision_checkpoints_by_brief_id: decisionCheckpointsByBriefId,
    portfolio_candidates: sortByUpdatedAtDescending(portfolioCandidates),
    portfolio_checkpoints_by_candidate_id: portfolioCheckpointsByCandidateId,
    portfolio_review_sessions: sortByUpdatedAtDescending(reviewSessions),
    portfolio_review_items_by_session_id: portfolioReviewItemsBySessionId,
    portfolio_proposals_by_session_id: portfolioProposalsBySessionId,
    recent_items: sortByUpdatedAtDescending(recentItems),
    activity: sortByCreatedAtDescending(activity),
    learning_records: sortByCreatedAtDescending(
      learningRecords.map((record) => ({
        ...record,
        created_at: record.lesson?.created_at ?? record.prediction.created_at,
      })),
    ).map(({ created_at: _createdAt, ...record }) => record),
    lessons: sortByCreatedAtDescending(lessons),
  };
}

function buildContext(config: ResolvedExportConfig, graph: ExportGraph): ExportContext {
  const memberNameById = new Map(graph.members.map((entry) => [entry.user.id, entry.user.display_name]));
  const targets = buildTargetMaps(graph, config);

  return {
    config,
    graph,
    member_name_by_id: memberNameById,
    investigation_note_by_id: targets.investigationNoteById,
    decision_note_by_id: targets.decisionNoteById,
    portfolio_note_by_id: targets.portfolioNoteById,
    lesson_note_by_id: targets.lessonNoteById,
    index_notes: targets.indexNotes,
    activity_notes: targets.activityNotes,
  };
}

function findLatestStep(investigation: SharedInvestigation) {
  return [...investigation.steps].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0] ?? null;
}

function buildLatestDecisionByInvestigationId(briefs: DecisionBrief[]) {
  return pickLatestBy(briefs, (brief) => brief.investigation_id, (brief) => brief.updated_at);
}

function buildLatestPortfolioByInvestigationId(candidates: PortfolioCandidate[]) {
  return pickLatestBy(candidates, (candidate) => candidate.investigation_id, (candidate) => candidate.updated_at);
}

function buildLatestPortfolioByDecisionBriefId(candidates: PortfolioCandidate[]) {
  return pickLatestBy(candidates, (candidate) => candidate.decision_brief_id, (candidate) => candidate.updated_at);
}

function buildLatestDecisionByPredictionId(briefs: DecisionBrief[]) {
  return pickLatestBy(briefs, (brief) => brief.lead_prediction_id, (brief) => brief.updated_at);
}

function buildLatestPortfolioByPredictionId(candidates: PortfolioCandidate[]) {
  return pickLatestBy(candidates, (candidate) => candidate.lead_prediction_id, (candidate) => candidate.updated_at);
}

function buildLatestReviewSessionByCandidateId(context: ExportContext) {
  const result = new Map<string, LatestReviewSessionContext>();

  for (const session of context.graph.portfolio_review_sessions) {
    const items = context.graph.portfolio_review_items_by_session_id.get(session.id) ?? [];
    const proposals = context.graph.portfolio_proposals_by_session_id.get(session.id) ?? [];

    for (const item of items) {
      const current = result.get(item.portfolio_candidate_id);
      if (!current || Date.parse(session.updated_at) > Date.parse(current.session.updated_at)) {
        result.set(item.portfolio_candidate_id, {
          session,
          item,
          proposals: proposals.filter((proposal) => proposal.portfolio_candidate_id === item.portfolio_candidate_id),
        });
      }
    }
  }

  return result;
}

function renderAppLinksSection(entries: Array<{ label: string; href: string | null }>) {
  const availableEntries = entries.filter((entry) => entry.href);
  return availableEntries.length
    ? renderBulletList(availableEntries.map((entry) => renderAppLink(entry.label, entry.href)))
    : "- App links are not configured for this export.";
}

function renderInvestigationNote(investigation: SharedInvestigation, context: ExportContext): RenderedNote {
  const latestDecisionByInvestigationId = buildLatestDecisionByInvestigationId(context.graph.decision_briefs);
  const latestPortfolioByInvestigationId = buildLatestPortfolioByInvestigationId(context.graph.portfolio_candidates);
  const latestStep = findLatestStep(investigation);
  const latestStudioStep =
    [...investigation.steps]
      .filter((step) => step.kind === "studio_run")
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0] ?? null;
  const linkedDecision = latestDecisionByInvestigationId.get(investigation.id) ?? null;
  const linkedPortfolio = latestPortfolioByInvestigationId.get(investigation.id) ?? null;
  const leadPredictionId = investigation.prediction_ids[0] ?? null;
  const target = context.investigation_note_by_id.get(investigation.id);

  if (!target) {
    throw new Error(`Missing note target for investigation ${investigation.id}`);
  }

  const frontmatter = obsidianInvestigationFrontmatterSchema.parse({
    managed_by: "finance_superbrain",
    type: "investigation",
    workspace_id: investigation.workspace_id,
    investigation_id: investigation.id,
    status: investigation.status,
    owner_user_id: investigation.owner_user_id,
    assignee_user_id: investigation.assignee_user_id,
    prediction_ids: investigation.prediction_ids,
    app_url: buildAppUrl(context.config.app_url, "/investigations"),
    created_at: investigation.created_at,
    updated_at: investigation.updated_at,
  });

  const sections = [
    renderSection(
      "Status Summary",
      [
        `- Status: ${investigation.status}`,
        `- Owner: ${toDisplayName(investigation.owner_user_id, context.member_name_by_id)}`,
        `- Assignee: ${toDisplayName(investigation.assignee_user_id, context.member_name_by_id)}`,
        `- Last actor: ${toDisplayName(investigation.last_actor_user_id, context.member_name_by_id)}`,
        `- Created: ${formatTimestamp(investigation.created_at)}`,
        `- Updated: ${formatTimestamp(investigation.updated_at)}`,
      ].join("\n"),
    ),
    renderSection(
      "Graph Links",
      renderBulletList([
        `Decision brief: ${wikiLink(linkedDecision ? context.decision_note_by_id.get(linkedDecision.id) ?? null : null, linkedDecision?.title ?? "Not linked")}`,
        `Portfolio candidate: ${wikiLink(linkedPortfolio ? context.portfolio_note_by_id.get(linkedPortfolio.id) ?? null : null, linkedPortfolio?.title ?? "Not linked")}`,
      ]),
    ),
    renderSection(
      "Prediction Context",
      renderBulletList(
        investigation.prediction_ids.map((predictionId) =>
          leadPredictionId === predictionId
            ? `${predictionId} (lead prediction; ${renderAppLink("open prediction", buildAppUrl(context.config.app_url, `/predictions/${predictionId}`))})`
            : `${predictionId} (${renderAppLink("open prediction", buildAppUrl(context.config.app_url, `/predictions/${predictionId}`))})`,
        ),
        "- No predictions are linked yet.",
      ),
    ),
    renderSection(
      "Latest Trail Step",
      latestStep
        ? [
            `- Step: ${latestStep.title}`,
            `- Kind: ${latestStep.kind}`,
            `- Status: ${latestStep.status}`,
            `- Detail: ${latestStep.detail}`,
            `- Updated: ${formatTimestamp(latestStep.updated_at)}`,
            `- Route: ${renderAppLink("open step", buildAppUrl(context.config.app_url, latestStep.href))}`,
          ].join("\n")
        : "- No trail steps are stored yet.",
    ),
    renderSection(
      "Trail History",
      renderBulletList(
        investigation.steps.map(
          (step) =>
            `${step.title} | ${step.kind} | ${step.status} | ${formatTimestamp(step.updated_at)} | ${step.detail}`,
        ),
        "- No trail history is available yet.",
      ),
    ),
    renderSection(
      "App Routes",
      renderAppLinksSection([
        { label: "Open investigations desk", href: buildAppUrl(context.config.app_url, "/investigations") },
        { label: "Resume Studio", href: latestStudioStep ? buildAppUrl(context.config.app_url, latestStudioStep.href) : buildAppUrl(context.config.app_url, "/studio") },
        { label: "Open accuracy focus", href: leadPredictionId ? buildAppUrl(context.config.app_url, `/accuracy?focus=${leadPredictionId}`) : null },
        { label: "Open Library", href: buildAppUrl(context.config.app_url, "/library") },
      ]),
    ),
  ];

  return {
    type: "investigation",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      `# ${investigation.title}`,
      "",
      `Generated investigation memory for workspace ${context.graph.workspace.name}.`,
      "",
      ...sections,
    ].join("\n\n"),
  };
}

function renderDecisionNote(brief: DecisionBrief, context: ExportContext): RenderedNote {
  const checkpoints = sortByCreatedAtDescending(context.graph.decision_checkpoints_by_brief_id.get(brief.id) ?? []);
  const latestPortfolioByDecisionBriefId = buildLatestPortfolioByDecisionBriefId(context.graph.portfolio_candidates);
  const linkedPortfolio = latestPortfolioByDecisionBriefId.get(brief.id) ?? null;
  const linkedInvestigation = context.graph.investigations.find((investigation) => investigation.id === brief.investigation_id) ?? null;
  const latestCheckpoint = checkpoints[0] ?? null;
  const target = context.decision_note_by_id.get(brief.id);

  if (!target) {
    throw new Error(`Missing note target for decision brief ${brief.id}`);
  }

  const frontmatter = obsidianDecisionBriefFrontmatterSchema.parse({
    managed_by: "finance_superbrain",
    type: "decision_brief",
    workspace_id: brief.workspace_id,
    decision_brief_id: brief.id,
    investigation_id: brief.investigation_id,
    lead_prediction_id: brief.lead_prediction_id,
    status: brief.status,
    confidence_label: brief.confidence_label,
    key_assets: brief.key_assets,
    app_url: buildAppUrl(context.config.app_url, `/decisions/${brief.id}`),
    created_at: brief.created_at,
    updated_at: brief.updated_at,
  });

  const sections = [
    renderSection("Summary", brief.summary),
    renderSection(
      "Decision Thesis",
      [
        `**Thesis**`,
        brief.thesis,
        "",
        `**Scenario**`,
        brief.scenario,
      ].join("\n"),
    ),
    renderSection(
      "Status Summary",
      [
        `- Status: ${brief.status}`,
        `- Confidence: ${brief.confidence_label}`,
        `- Owner: ${toDisplayName(brief.owner_user_id, context.member_name_by_id)}`,
        `- Assignee: ${toDisplayName(brief.assignee_user_id, context.member_name_by_id)}`,
        `- Next review due: ${formatTimestamp(brief.next_review_due_at)}`,
        `- Closed at: ${formatTimestamp(brief.closed_at)}`,
      ].join("\n"),
    ),
    renderSection(
      "Operating Inputs",
      [
        `**Key assets**`,
        renderBulletList(brief.key_assets, "- No key assets were captured."),
        "",
        `**Triggers**`,
        renderBulletList(brief.triggers, "- No explicit triggers were captured."),
        "",
        `**Invalidations**`,
        renderBulletList(brief.invalidations, "- No invalidations were captured."),
      ].join("\n"),
    ),
    renderSection(
      "Graph Links",
      renderBulletList([
        `Investigation: ${wikiLink(linkedInvestigation ? context.investigation_note_by_id.get(linkedInvestigation.id) ?? null : null, linkedInvestigation?.title ?? brief.investigation_id)}`,
        `Portfolio candidate: ${wikiLink(linkedPortfolio ? context.portfolio_note_by_id.get(linkedPortfolio.id) ?? null : null, linkedPortfolio?.title ?? "Not promoted yet")}`,
        `Lead prediction: ${renderAppLink(brief.lead_prediction_id, buildAppUrl(context.config.app_url, `/predictions/${brief.lead_prediction_id}`))}`,
      ]),
    ),
    renderSection(
      "Checkpoint History",
      checkpoints.length
        ? renderBulletList(
            checkpoints.map(
              (checkpoint) =>
                `${formatTimestamp(checkpoint.created_at)} | ${checkpoint.action} | thesis ${checkpoint.thesis_state} | ${checkpoint.summary}`,
            ),
          )
        : "- No checkpoints have been saved yet.",
    ),
    renderSection(
      "Latest Operating Checkpoint",
      latestCheckpoint
        ? [
            `- Saved: ${formatTimestamp(latestCheckpoint.created_at)}`,
            `- Action: ${latestCheckpoint.action}`,
            `- Thesis state: ${latestCheckpoint.thesis_state}`,
            `- Summary: ${latestCheckpoint.summary}`,
          ].join("\n")
        : "- No checkpoint summary is available yet.",
    ),
    renderSection(
      "App Routes",
      renderAppLinksSection([
        { label: "Open decision brief", href: buildAppUrl(context.config.app_url, `/decisions/${brief.id}`) },
        { label: "Open decision desk", href: buildAppUrl(context.config.app_url, "/decisions") },
        { label: "Open lead prediction", href: buildAppUrl(context.config.app_url, `/predictions/${brief.lead_prediction_id}`) },
        { label: "Open investigation desk", href: buildAppUrl(context.config.app_url, "/investigations") },
      ]),
    ),
  ];

  return {
    type: "decision_brief",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      `# ${brief.title}`,
      "",
      `Decision memory exported from the shared workspace.`,
      "",
      ...sections,
    ].join("\n\n"),
  };
}

function renderPortfolioNote(candidate: PortfolioCandidate, context: ExportContext): RenderedNote {
  const checkpoints = sortByCreatedAtDescending(context.graph.portfolio_checkpoints_by_candidate_id.get(candidate.id) ?? []);
  const latestCheckpoint = checkpoints[0] ?? null;
  const linkedDecision = context.graph.decision_briefs.find((brief) => brief.id === candidate.decision_brief_id) ?? null;
  const linkedInvestigation = context.graph.investigations.find((investigation) => investigation.id === candidate.investigation_id) ?? null;
  const latestReviewSessionByCandidateId = buildLatestReviewSessionByCandidateId(context);
  const latestReview = latestReviewSessionByCandidateId.get(candidate.id) ?? null;
  const target = context.portfolio_note_by_id.get(candidate.id);

  if (!target) {
    throw new Error(`Missing note target for portfolio candidate ${candidate.id}`);
  }

  const frontmatter = obsidianPortfolioCandidateFrontmatterSchema.parse({
    managed_by: "finance_superbrain",
    type: "portfolio_candidate",
    workspace_id: candidate.workspace_id,
    portfolio_candidate_id: candidate.id,
    decision_brief_id: candidate.decision_brief_id,
    investigation_id: candidate.investigation_id,
    status: candidate.status,
    priority: candidate.priority,
    conviction_label: candidate.conviction_label,
    primary_theme: candidate.primary_theme,
    related_assets: candidate.related_assets,
    app_url: buildAppUrl(context.config.app_url, `/portfolio/${candidate.id}`),
    created_at: candidate.created_at,
    updated_at: candidate.updated_at,
  });

  const followThroughHealth =
    candidate.status === "closed"
      ? "closed"
      : candidate.next_review_due_at && candidate.next_review_due_at <= new Date().toISOString()
        ? "due now"
        : candidate.next_review_due_at
          ? "on cadence"
          : "missing cadence";

  const sections = [
    renderSection("Summary", candidate.summary),
    renderSection(
      "Status Summary",
      [
        `- Status: ${candidate.status}`,
        `- Follow-through health: ${followThroughHealth}`,
        `- Owner: ${toDisplayName(candidate.owner_user_id, context.member_name_by_id)}`,
        `- Assignee: ${toDisplayName(candidate.assignee_user_id, context.member_name_by_id)}`,
        `- Next review due: ${formatTimestamp(candidate.next_review_due_at)}`,
        `- Closed at: ${formatTimestamp(candidate.closed_at)}`,
      ].join("\n"),
    ),
    renderSection(
      "Portfolio Posture",
      [
        `- Priority: ${candidate.priority}`,
        `- Sizing: ${candidate.sizing_label}`,
        `- Risk budget: ${candidate.risk_budget_label}`,
        `- Conviction: ${candidate.conviction_label}`,
        `- Primary theme: ${candidate.primary_theme}`,
        `- Secondary themes: ${candidate.secondary_themes.length ? candidate.secondary_themes.join(", ") : "None"}`,
        `- Related assets: ${candidate.related_assets.length ? candidate.related_assets.join(", ") : "None"}`,
      ].join("\n"),
    ),
    renderSection(
      "Graph Links",
      renderBulletList([
        `Decision brief: ${wikiLink(linkedDecision ? context.decision_note_by_id.get(linkedDecision.id) ?? null : null, linkedDecision?.title ?? candidate.decision_brief_id)}`,
        `Investigation: ${wikiLink(linkedInvestigation ? context.investigation_note_by_id.get(linkedInvestigation.id) ?? null : null, linkedInvestigation?.title ?? candidate.investigation_id)}`,
        `Lead prediction: ${renderAppLink(candidate.lead_prediction_id, buildAppUrl(context.config.app_url, `/predictions/${candidate.lead_prediction_id}`))}`,
      ]),
    ),
    renderSection(
      "Latest Checkpoint",
      latestCheckpoint
        ? [
            `- Saved: ${formatTimestamp(latestCheckpoint.created_at)}`,
            `- Action: ${latestCheckpoint.action}`,
            `- Thesis state: ${latestCheckpoint.thesis_state}`,
            `- Summary: ${latestCheckpoint.summary}`,
          ].join("\n")
        : "- No checkpoint has been saved yet.",
    ),
    renderSection(
      "Checkpoint History",
      checkpoints.length
        ? renderBulletList(
            checkpoints.map(
              (checkpoint) =>
                `${formatTimestamp(checkpoint.created_at)} | ${checkpoint.action} | thesis ${checkpoint.thesis_state} | ${checkpoint.summary}`,
            ),
          )
        : "- No checkpoint history is available yet.",
    ),
    renderSection(
      "Latest Review Session",
      latestReview
        ? [
            `- Session: ${latestReview.session.title} (${latestReview.session.status})`,
            `- Opened: ${formatTimestamp(latestReview.session.opened_at)}`,
            `- Summary: ${latestReview.session.summary}`,
            `- Snapshot status: ${latestReview.item.snapshot_status}`,
            `- Snapshot priority: ${latestReview.item.snapshot_priority}`,
            `- Snapshot theme: ${latestReview.item.snapshot_primary_theme}`,
            `- Snapshot assignee: ${toDisplayName(latestReview.item.snapshot_assignee_user_id, context.member_name_by_id)}`,
            `- Proposals:`,
            renderBulletList(
              latestReview.proposals.map(
                (proposal) =>
                  `${proposal.action} | ${proposal.status} | ${proposal.rationale}${
                    proposal.next_review_expectation ? ` | next review ${proposal.next_review_expectation}` : ""
                  }`,
              ),
              "  - No rebalance proposals were saved for this candidate in the latest review session.",
            ),
          ].join("\n")
        : "- No portfolio review session has captured this candidate yet.",
    ),
    renderSection(
      "App Routes",
      renderAppLinksSection([
        { label: "Open portfolio candidate", href: buildAppUrl(context.config.app_url, `/portfolio/${candidate.id}`) },
        { label: "Open portfolio desk", href: buildAppUrl(context.config.app_url, "/portfolio") },
        { label: "Open portfolio reviews", href: buildAppUrl(context.config.app_url, "/portfolio/reviews") },
        { label: "Open linked decision brief", href: linkedDecision ? buildAppUrl(context.config.app_url, `/decisions/${linkedDecision.id}`) : null },
      ]),
    ),
  ];

  return {
    type: "portfolio_candidate",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      `# ${candidate.title}`,
      "",
      `Portfolio operating memory exported from the shared workspace.`,
      "",
      ...sections,
    ].join("\n\n"),
  };
}

function renderLessonNote(record: PredictionLearningRecord, context: ExportContext): RenderedNote | null {
  const lesson = record.lesson;
  if (!lesson) {
    return null;
  }

  const target = context.lesson_note_by_id.get(lesson.id);
  if (!target) {
    throw new Error(`Missing note target for lesson ${lesson.id}`);
  }

  const latestDecisionByPredictionId = buildLatestDecisionByPredictionId(context.graph.decision_briefs);
  const latestPortfolioByPredictionId = buildLatestPortfolioByPredictionId(context.graph.portfolio_candidates);
  const linkedDecision = latestDecisionByPredictionId.get(lesson.prediction_id) ?? null;
  const linkedPortfolio = latestPortfolioByPredictionId.get(lesson.prediction_id) ?? null;

  const frontmatter = obsidianLessonFrontmatterSchema.parse({
    managed_by: "finance_superbrain",
    type: "lesson",
    workspace_id: context.graph.workspace.id,
    lesson_id: lesson.id,
    prediction_id: lesson.prediction_id,
    lesson_type: lesson.lesson_type,
    app_url: buildAppUrl(context.config.app_url, `/predictions/${lesson.prediction_id}`),
    created_at: lesson.created_at,
    updated_at: lesson.created_at,
  });

  const sections = [
    renderSection("Lesson Summary", lesson.lesson_summary),
    renderSection(
      "Retrieval Context",
      [
        `- Event summary: ${record.event.summary}`,
        `- Event themes: ${record.event.themes.join(", ") || "None"}`,
        `- Candidate assets: ${record.event.candidate_assets.join(", ") || "None"}`,
        `- Prediction thesis: ${record.prediction.thesis}`,
        `- Prediction horizon: ${record.prediction.horizon}`,
        `- Prediction confidence: ${Math.round(record.prediction.confidence * 100)}%`,
        `- Outcome score: ${
          record.outcome ? `${Math.round(record.outcome.total_score * 100)}% total` : "Not scored yet"
        }`,
        `- Postmortem: ${record.postmortem?.critique ?? "No postmortem captured."}`,
      ].join("\n"),
    ),
    renderSection(
      "Metadata",
      renderBulletList(
        Object.entries(lesson.metadata).map(([key, value]) => `${key}: ${value}`),
        "- No structured lesson metadata was captured.",
      ),
    ),
    renderSection(
      "Graph Links",
      renderBulletList([
        `Decision brief: ${wikiLink(linkedDecision ? context.decision_note_by_id.get(linkedDecision.id) ?? null : null, linkedDecision?.title ?? "Not linked")}`,
        `Portfolio candidate: ${wikiLink(linkedPortfolio ? context.portfolio_note_by_id.get(linkedPortfolio.id) ?? null : null, linkedPortfolio?.title ?? "Not linked")}`,
        `Prediction detail: ${renderAppLink(lesson.prediction_id, buildAppUrl(context.config.app_url, `/predictions/${lesson.prediction_id}`))}`,
      ]),
    ),
    renderSection(
      "App Routes",
      renderAppLinksSection([
        { label: "Open prediction detail", href: buildAppUrl(context.config.app_url, `/predictions/${lesson.prediction_id}`) },
        { label: "Open Library", href: buildAppUrl(context.config.app_url, "/library") },
        { label: "Open Evaluation", href: buildAppUrl(context.config.app_url, "/evaluation") },
      ]),
    ),
  ];

  return {
    type: "lesson",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      `# ${lesson.lesson_summary}`,
      "",
      `Learning memory generated from the canonical workspace record.`,
      "",
      ...sections,
    ].join("\n\n"),
  };
}

function renderActivityLogNote(context: ExportContext): RenderedNote {
  const target = context.activity_notes.recent_log;
  const latestDecisionByPredictionId = buildLatestDecisionByPredictionId(context.graph.decision_briefs);
  const latestPortfolioByPredictionId = buildLatestPortfolioByPredictionId(context.graph.portfolio_candidates);
  const latestInvestigationById = new Map(context.graph.investigations.map((investigation) => [investigation.id, investigation]));
  const filtered = context.graph.activity.filter((event) => HIGH_SIGNAL_ACTIVITY_KINDS.has(event.kind)).slice(0, 80);

  const frontmatter = obsidianActivityFrontmatterSchema.parse({
    managed_by: "finance_superbrain",
    type: "activity",
    workspace_id: context.graph.workspace.id,
    app_url: buildAppUrl(context.config.app_url, "/settings"),
    created_at: filtered[filtered.length - 1]?.created_at ?? null,
    updated_at: filtered[0]?.created_at ?? null,
  });

  const lines = filtered.map((event) => {
    const relatedInvestigation =
      event.investigation_id ? latestInvestigationById.get(event.investigation_id) ?? null : null;
    const relatedDecision =
      event.prediction_id ? latestDecisionByPredictionId.get(event.prediction_id) ?? null : null;
    const relatedPortfolio =
      event.prediction_id ? latestPortfolioByPredictionId.get(event.prediction_id) ?? null : null;
    const relatedLinks = [
      relatedInvestigation ? `investigation ${wikiLink(context.investigation_note_by_id.get(relatedInvestigation.id) ?? null, relatedInvestigation.title)}` : null,
      relatedDecision ? `decision ${wikiLink(context.decision_note_by_id.get(relatedDecision.id) ?? null, relatedDecision.title)}` : null,
      relatedPortfolio ? `portfolio ${wikiLink(context.portfolio_note_by_id.get(relatedPortfolio.id) ?? null, relatedPortfolio.title)}` : null,
    ].filter(Boolean);

    return `- ${formatTimestamp(event.created_at)} | ${event.kind} | ${toDisplayName(event.actor_user_id, context.member_name_by_id)} | ${event.detail}${relatedLinks.length ? ` | ${relatedLinks.join(" | ")}` : ""}`;
  });

  return {
    type: "activity",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      "# Recent Activity Log",
      "",
      "High-signal audit trail exported from the shared workspace.",
      "",
      renderSection("Events", renderBulletList(lines, "- No activity has been captured yet.")),
    ].join("\n\n"),
  };
}

function renderActivitySummaryNote(context: ExportContext): RenderedNote {
  const target = context.activity_notes.latest_summary;
  const filtered = context.graph.activity.filter((event) => HIGH_SIGNAL_ACTIVITY_KINDS.has(event.kind)).slice(0, 120);
  const countByKind = [...groupBy(filtered, (event) => event.kind).entries()]
    .map(([kind, items]) => ({ kind, count: items.length }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
  const latest = filtered[0] ?? null;

  const frontmatter = obsidianActivityFrontmatterSchema.parse({
    managed_by: "finance_superbrain",
    type: "activity",
    workspace_id: context.graph.workspace.id,
    app_url: buildAppUrl(context.config.app_url, "/settings"),
    created_at: filtered[filtered.length - 1]?.created_at ?? null,
    updated_at: latest?.created_at ?? null,
  });

  return {
    type: "activity",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      "# Latest Audit Summary",
      "",
      "Compact audit memory for the current exported workspace snapshot.",
      "",
      renderSection(
        "Summary",
        [
          `- Members: ${context.graph.members.length}`,
          `- Investigations: ${context.graph.investigations.length}`,
          `- Decision briefs: ${context.graph.decision_briefs.length}`,
          `- Portfolio candidates: ${context.graph.portfolio_candidates.length}`,
          `- Lessons: ${context.graph.lessons.length}`,
          `- High-signal events: ${filtered.length}`,
          `- Latest event: ${latest ? `${latest.kind} at ${formatTimestamp(latest.created_at)}` : "None yet"}`,
        ].join("\n"),
      ),
      renderSection(
        "High-Signal Event Mix",
        renderBulletList(
          countByKind.map((entry) => `${entry.kind}: ${entry.count}`),
          "- No high-signal activity has been captured yet.",
        ),
      ),
      renderSection(
        "Linked Activity Notes",
        renderBulletList([
          wikiLink(context.activity_notes.recent_log, "Recent Activity Log"),
          wikiLink(context.index_notes.recent_activity, "Recent Activity Index"),
        ]),
      ),
    ].join("\n\n"),
  };
}

function renderWorkspaceOverviewNote(context: ExportContext): RenderedNote {
  const target = context.index_notes.workspace_overview;
  const frontmatter = {
    managed_by: "finance_superbrain",
    type: "index",
    workspace_id: context.graph.workspace.id,
    app_url: buildAppUrl(context.config.app_url, "/workspace"),
    created_at: context.graph.workspace.created_at,
    updated_at: context.graph.activity[0]?.created_at ?? context.graph.workspace.updated_at,
  } satisfies ObsidianNoteFrontmatter;

  const investigationStatusCounts = [...groupBy(context.graph.investigations, (item) => item.status).entries()]
    .map(([status, items]) => `${status}: ${items.length}`);
  const decisionStatusCounts = [...groupBy(context.graph.decision_briefs, (item) => item.status).entries()]
    .map(([status, items]) => `${status}: ${items.length}`);
  const portfolioStatusCounts = [...groupBy(context.graph.portfolio_candidates, (item) => item.status).entries()]
    .map(([status, items]) => `${status}: ${items.length}`);

  return {
    type: "index",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      "# Workspace Overview",
      "",
      `Generated memory index for ${context.graph.workspace.name}.`,
      "",
      renderSection(
        "Workspace Snapshot",
        [
          `- Workspace id: ${context.graph.workspace.id}`,
          `- Members: ${context.graph.members.length}`,
          `- Studio runs: ${context.graph.studio_runs.length}`,
          `- Recent items: ${context.graph.recent_items.length}`,
          `- Activity events: ${context.graph.activity.length}`,
          `- App workspace: ${renderAppLink("Open workspace", buildAppUrl(context.config.app_url, "/workspace"))}`,
        ].join("\n"),
      ),
      renderSection("Investigation Statuses", renderBulletList(investigationStatusCounts, "- No investigations yet.")),
      renderSection("Decision Statuses", renderBulletList(decisionStatusCounts, "- No decision briefs yet.")),
      renderSection("Portfolio Statuses", renderBulletList(portfolioStatusCounts, "- No portfolio candidates yet.")),
      renderSection(
        "Core Indexes",
        renderBulletList([
          wikiLink(context.index_notes.investigations_index),
          wikiLink(context.index_notes.decision_briefs_index),
          wikiLink(context.index_notes.portfolio_index),
          wikiLink(context.index_notes.lessons_index),
          wikiLink(context.index_notes.recent_activity),
        ]),
      ),
      renderSection(
        "Recent Workspace Routes",
        renderBulletList(
          context.graph.recent_items.slice(0, 12).map(
            (item) =>
              `${item.kind}: ${item.title} | ${item.description} | ${renderAppLink("open", buildAppUrl(context.config.app_url, item.href))}`,
          ),
          "- No recent workspace links were captured.",
        ),
      ),
    ].join("\n\n"),
  };
}

function renderInvestigationsIndexNote(context: ExportContext): RenderedNote {
  const target = context.index_notes.investigations_index;
  const frontmatter = {
    managed_by: "finance_superbrain",
    type: "index",
    workspace_id: context.graph.workspace.id,
    app_url: buildAppUrl(context.config.app_url, "/investigations"),
    created_at: context.graph.workspace.created_at,
    updated_at: context.graph.investigations[0]?.updated_at ?? context.graph.workspace.updated_at,
  } satisfies ObsidianNoteFrontmatter;

  const openInvestigations = context.graph.investigations.filter((item) => item.status !== "reviewed");
  const reviewedInvestigations = context.graph.investigations.filter((item) => item.status === "reviewed");

  return {
    type: "index",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      "# Investigations Index",
      "",
      renderSection(
        "Open Investigations",
        renderBulletList(
          openInvestigations.map((item) => `${wikiLink(context.investigation_note_by_id.get(item.id) ?? null, item.title)} | ${item.status}`),
          "- No open investigations.",
        ),
      ),
      renderSection(
        "Reviewed Investigations",
        renderBulletList(
          reviewedInvestigations.map((item) => `${wikiLink(context.investigation_note_by_id.get(item.id) ?? null, item.title)} | reviewed`),
          "- No reviewed investigations yet.",
        ),
      ),
      renderSection(
        "Most Recently Updated",
        renderBulletList(
          context.graph.investigations.slice(0, 12).map(
            (item) =>
              `${wikiLink(context.investigation_note_by_id.get(item.id) ?? null, item.title)} | ${formatTimestamp(item.updated_at)}`,
          ),
          "- No investigation memory is available yet.",
        ),
      ),
    ].join("\n\n"),
  };
}

function renderDecisionIndexNote(context: ExportContext): RenderedNote {
  const target = context.index_notes.decision_briefs_index;
  const frontmatter = {
    managed_by: "finance_superbrain",
    type: "index",
    workspace_id: context.graph.workspace.id,
    app_url: buildAppUrl(context.config.app_url, "/decisions"),
    created_at: context.graph.workspace.created_at,
    updated_at: context.graph.decision_briefs[0]?.updated_at ?? context.graph.workspace.updated_at,
  } satisfies ObsidianNoteFrontmatter;

  const openBriefs = context.graph.decision_briefs.filter((item) => item.status !== "closed");
  const closedBriefs = context.graph.decision_briefs.filter((item) => item.status === "closed");

  return {
    type: "index",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      "# Decision Briefs Index",
      "",
      renderSection(
        "Open Briefs",
        renderBulletList(
          openBriefs.map((brief) => `${wikiLink(context.decision_note_by_id.get(brief.id) ?? null, brief.title)} | ${brief.status}`),
          "- No open briefs.",
        ),
      ),
      renderSection(
        "Closed Briefs",
        renderBulletList(
          closedBriefs.map((brief) => `${wikiLink(context.decision_note_by_id.get(brief.id) ?? null, brief.title)} | closed at ${formatTimestamp(brief.closed_at)}`),
          "- No closed briefs yet.",
        ),
      ),
      renderSection(
        "Due Review",
        renderBulletList(
          openBriefs
            .filter((brief) => brief.next_review_due_at)
            .sort((left, right) => (left.next_review_due_at ?? "").localeCompare(right.next_review_due_at ?? ""))
            .slice(0, 12)
            .map((brief) => `${wikiLink(context.decision_note_by_id.get(brief.id) ?? null, brief.title)} | due ${formatTimestamp(brief.next_review_due_at)}`),
          "- No decision review cadence is scheduled yet.",
        ),
      ),
    ].join("\n\n"),
  };
}

function renderPortfolioIndexNote(context: ExportContext): RenderedNote {
  const target = context.index_notes.portfolio_index;
  const frontmatter = {
    managed_by: "finance_superbrain",
    type: "index",
    workspace_id: context.graph.workspace.id,
    app_url: buildAppUrl(context.config.app_url, "/portfolio"),
    created_at: context.graph.workspace.created_at,
    updated_at: context.graph.portfolio_candidates[0]?.updated_at ?? context.graph.workspace.updated_at,
  } satisfies ObsidianNoteFrontmatter;

  const liveCandidates = context.graph.portfolio_candidates.filter((candidate) => candidate.status !== "closed");
  const closedCandidates = context.graph.portfolio_candidates.filter((candidate) => candidate.status === "closed");
  const themeCounts = [...groupBy(liveCandidates, (candidate) => candidate.primary_theme).entries()]
    .map(([theme, items]) => `${theme}: ${items.length}`)
    .sort((left, right) => left.localeCompare(right));

  return {
    type: "index",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      "# Portfolio Index",
      "",
      renderSection(
        "Live Candidates",
        renderBulletList(
          liveCandidates.map((candidate) => `${wikiLink(context.portfolio_note_by_id.get(candidate.id) ?? null, candidate.title)} | ${candidate.status} | ${candidate.primary_theme}`),
          "- No live portfolio candidates yet.",
        ),
      ),
      renderSection(
        "Closed Candidates",
        renderBulletList(
          closedCandidates.map((candidate) => `${wikiLink(context.portfolio_note_by_id.get(candidate.id) ?? null, candidate.title)} | closed at ${formatTimestamp(candidate.closed_at)}`),
          "- No closed portfolio candidates yet.",
        ),
      ),
      renderSection("Theme Exposure", renderBulletList(themeCounts, "- No theme exposure is available yet.")),
      renderSection(
        "Due Review",
        renderBulletList(
          liveCandidates
            .filter((candidate) => candidate.next_review_due_at)
            .sort((left, right) => (left.next_review_due_at ?? "").localeCompare(right.next_review_due_at ?? ""))
            .slice(0, 12)
            .map((candidate) => `${wikiLink(context.portfolio_note_by_id.get(candidate.id) ?? null, candidate.title)} | due ${formatTimestamp(candidate.next_review_due_at)}`),
          "- No portfolio cadence is scheduled yet.",
        ),
      ),
    ].join("\n\n"),
  };
}

function renderLessonsIndexNote(context: ExportContext): RenderedNote {
  const target = context.index_notes.lessons_index;
  const frontmatter = {
    managed_by: "finance_superbrain",
    type: "index",
    workspace_id: context.graph.workspace.id,
    app_url: buildAppUrl(context.config.app_url, "/library"),
    created_at: context.graph.workspace.created_at,
    updated_at: context.graph.lessons[0]?.created_at ?? context.graph.workspace.updated_at,
  } satisfies ObsidianNoteFrontmatter;

  const byLessonType = [...groupBy(context.graph.lessons, (lesson) => lesson.lesson_type).entries()]
    .map(([type, items]) => `${type}: ${items.length}`)
    .sort((left, right) => left.localeCompare(right));

  return {
    type: "index",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      "# Lessons Index",
      "",
      renderSection("Lesson Types", renderBulletList(byLessonType, "- No lessons have been stored yet.")),
      renderSection(
        "Most Recent Lessons",
        renderBulletList(
          context.graph.lessons.slice(0, 20).map((lesson) => `${wikiLink(context.lesson_note_by_id.get(lesson.id) ?? null, lesson.lesson_summary)} | ${lesson.lesson_type}`),
          "- No lesson notes are available yet.",
        ),
      ),
      renderSection(
        "Linked Routes",
        renderBulletList([
          renderAppLink("Open Library", buildAppUrl(context.config.app_url, "/library")),
          renderAppLink("Open Evaluation", buildAppUrl(context.config.app_url, "/evaluation")),
        ]),
      ),
    ].join("\n\n"),
  };
}

function renderRecentActivityIndexNote(context: ExportContext): RenderedNote {
  const target = context.index_notes.recent_activity;
  const frontmatter = {
    managed_by: "finance_superbrain",
    type: "index",
    workspace_id: context.graph.workspace.id,
    app_url: buildAppUrl(context.config.app_url, "/settings"),
    created_at: context.graph.workspace.created_at,
    updated_at: context.graph.activity[0]?.created_at ?? context.graph.workspace.updated_at,
  } satisfies ObsidianNoteFrontmatter;
  const highSignal = context.graph.activity.filter((event) => HIGH_SIGNAL_ACTIVITY_KINDS.has(event.kind)).slice(0, 20);

  return {
    type: "index",
    absolute_path: target.absolute_path,
    relative_path: target.relative_path,
    content: [
      renderFrontmatter(frontmatter),
      "# Recent Activity",
      "",
      renderSection(
        "Linked Activity Notes",
        renderBulletList([
          wikiLink(context.activity_notes.recent_log),
          wikiLink(context.activity_notes.latest_summary),
        ]),
      ),
      renderSection(
        "Latest High-Signal Events",
        renderBulletList(
          highSignal.map(
            (event) =>
              `${formatTimestamp(event.created_at)} | ${event.kind} | ${toDisplayName(event.actor_user_id, context.member_name_by_id)} | ${event.detail}`,
          ),
          "- No high-signal events are available yet.",
        ),
      ),
    ].join("\n\n"),
  };
}

function renderNotes(context: ExportContext): RenderedNote[] {
  const notes: RenderedNote[] = [];

  for (const investigation of context.graph.investigations) {
    notes.push(renderInvestigationNote(investigation, context));
  }

  for (const brief of context.graph.decision_briefs) {
    notes.push(renderDecisionNote(brief, context));
  }

  for (const candidate of context.graph.portfolio_candidates) {
    notes.push(renderPortfolioNote(candidate, context));
  }

  for (const record of context.graph.learning_records) {
    const note = renderLessonNote(record, context);
    if (note) {
      notes.push(note);
    }
  }

  notes.push(renderActivityLogNote(context));
  notes.push(renderActivitySummaryNote(context));
  notes.push(renderWorkspaceOverviewNote(context));
  notes.push(renderInvestigationsIndexNote(context));
  notes.push(renderDecisionIndexNote(context));
  notes.push(renderPortfolioIndexNote(context));
  notes.push(renderLessonsIndexNote(context));
  notes.push(renderRecentActivityIndexNote(context));

  return notes;
}

async function ensureDirectories(outputPath: string) {
  await mkdir(outputPath, { recursive: true });
  await Promise.all(
    Object.values(EXPORT_FOLDERS).map((folder) => mkdir(join(outputPath, folder), { recursive: true })),
  );
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

  return files;
}

async function cleanupManagedMarkdown(outputPath: string, desiredFiles: Set<string>) {
  const existingFiles = await listMarkdownFiles(outputPath).catch(() => []);

  for (const filePath of existingFiles) {
    if (desiredFiles.has(filePath)) {
      continue;
    }

    if (!ensureSafeChildPath(outputPath, filePath)) {
      continue;
    }

    const content = await readFile(filePath, "utf8").catch(() => "");
    if (!content.includes(MANAGED_MARKER)) {
      continue;
    }

    await unlink(filePath);
  }
}

function buildNoteCounts(notes: RenderedNote[]) {
  const counts = {
    investigations: notes.filter((note) => note.type === "investigation").length,
    decision_briefs: notes.filter((note) => note.type === "decision_brief").length,
    portfolio_candidates: notes.filter((note) => note.type === "portfolio_candidate").length,
    lessons: notes.filter((note) => note.type === "lesson").length,
    activity: notes.filter((note) => note.type === "activity").length,
    indexes: notes.filter((note) => note.type === "index").length,
    total: notes.length,
  };

  return counts;
}

export async function exportWorkspaceToObsidian(
  repository: Repository,
  config: ObsidianExportConfig,
): Promise<ObsidianExportSummary> {
  const resolvedConfig = await resolveExportConfig(config);
  const graph = await loadExportGraph(repository);
  const context = buildContext(resolvedConfig, graph);
  const notes = renderNotes(context);
  const noteCounts = buildNoteCounts(notes);
  const warnings: string[] = [];

  if (!resolvedConfig.app_url) {
    warnings.push("FINANCE_SUPERBRAIN_APP_URL is not set, so notes were exported without app links.");
  }

  if (!resolvedConfig.dry_run) {
    await ensureDirectories(resolvedConfig.output_path);
    const desiredFiles = new Set(notes.map((note) => note.absolute_path));
    await cleanupManagedMarkdown(resolvedConfig.output_path, desiredFiles);

    for (const note of notes) {
      if (!ensureSafeChildPath(resolvedConfig.output_path, note.absolute_path)) {
        throw new Error(`Refusing to write outside export subtree: ${note.absolute_path}`);
      }

      await mkdir(dirname(note.absolute_path), { recursive: true });
      await writeFile(note.absolute_path, note.content, "utf8");
    }
  }

  return obsidianExportSummarySchema.parse({
    workspace_id: graph.workspace.id,
    output_path: resolvedConfig.output_path,
    dry_run: resolvedConfig.dry_run,
    note_counts: noteCounts,
    warnings,
  });
}

export function buildObsidianExportConfigFromEnv(
  env: NodeJS.ProcessEnv,
  options: {
    dry_run?: boolean;
  } = {},
): ObsidianExportConfig {
  const vaultPath = env.OBSIDIAN_VAULT_PATH?.trim();
  if (!vaultPath) {
    throw new Error("OBSIDIAN_VAULT_PATH is required for Obsidian export.");
  }

  return obsidianExportConfigSchema.parse({
    vault_path: vaultPath,
    export_root: env.OBSIDIAN_EXPORT_ROOT?.trim() || "Finance Superbrain",
    app_url: env.FINANCE_SUPERBRAIN_APP_URL?.trim() || null,
    dry_run: options.dry_run ?? false,
  });
}
