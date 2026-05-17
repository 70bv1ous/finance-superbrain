import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PortfolioCandidate, SharedInvestigation } from "@finance-superbrain/schemas";

import { InMemoryRepository } from "./InMemoryRepository.js";
import { buildObsidianExportConfigFromEnv, exportWorkspaceToObsidian } from "./obsidianExport.js";

async function listMarkdownFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function seedRepository() {
  const repository = new InMemoryRepository();
  const workspace = await repository.getOrCreateDefaultWorkspace();
  const owner = await repository.createWorkspaceUser({
    email: "owner@example.com",
    password_hash: "hash-owner",
    display_name: "Owner Operator",
    role: "admin",
  });
  const teammate = await repository.createWorkspaceUser({
    email: "teammate@example.com",
    password_hash: "hash-teammate",
    display_name: "Teammate Analyst",
    role: "member",
  });

  const source = await repository.createSource({
    source_type: "headline",
    title: "CPI surprise",
    raw_text: "CPI ran hotter than expected and shifted the rates path.",
  });
  const event = await repository.createEvent(source.id, {
    event_class: "macro_commentary",
    summary: "Hot CPI forced a hawkish rate repricing.",
    sentiment: "risk_off",
    urgency_score: 0.84,
    novelty_score: 0.61,
    entities: [],
    themes: ["inflation", "rates"],
    candidate_assets: ["TLT", "DXY", "QQQ"],
    why_it_matters: ["Rates repricing can pressure duration and growth while supporting the dollar."],
  });
  const prediction = await repository.createPrediction(event.id, {
    horizon: "1d",
    thesis: "Higher yields and a firmer dollar should pressure duration and growth equities first.",
    confidence: 0.72,
    assets: [
      {
        ticker: "TLT",
        expected_direction: "down",
        expected_magnitude_bp: -55,
        conviction: 0.72,
      },
      {
        ticker: "DXY",
        expected_direction: "up",
        expected_magnitude_bp: 24,
        conviction: 0.68,
      },
    ],
    evidence: ["Inflation surprise pushes yields higher.", "Dollar tends to firm when the rate path reprices tighter."],
    invalidations: ["Positioning was already extremely hawkish."],
    assumptions: ["No offsetting same-day growth shock dominates the tape."],
    model_version: "obsidian-export-test-v1",
  });

  const investigation: SharedInvestigation = {
    id: "investigation-cpi-hawkish",
    workspace_id: workspace.id,
    title: "Hot CPI hawkish repricing",
    event_id: event.id,
    prediction_ids: [prediction.id],
    status: "reviewed",
    owner_user_id: owner.id,
    assignee_user_id: teammate.id,
    last_actor_user_id: teammate.id,
    updated_at: "2026-04-22T10:30:00.000Z",
    created_at: "2026-04-22T09:00:00.000Z",
    steps: [
      {
        id: "studio_run:studio-run-cpi",
        kind: "studio_run",
        status: "ready_for_review",
        href: "/studio?run=studio-run-cpi",
        title: "Studio run captured the CPI surprise",
        detail: "The event was parsed, prediction created, and handed to the review loop.",
        updated_at: "2026-04-22T09:45:00.000Z",
      },
      {
        id: "prediction_detail:cpi-prediction",
        kind: "prediction_detail",
        status: "under_review",
        href: `/predictions/${prediction.id}`,
        title: "Lead prediction promoted for shared decisioning",
        detail: "The desk focused on rates, dollar, and growth-equity sensitivity.",
        updated_at: "2026-04-22T10:10:00.000Z",
      },
      {
        id: "review_focus:cpi-review",
        kind: "review_focus",
        status: "reviewed",
        href: `/accuracy?focus=${prediction.id}`,
        title: "Review completed and retrieval memory stored",
        detail: "The call was reviewed, notes were saved, and retrieval memory is now ready.",
        updated_at: "2026-04-22T10:30:00.000Z",
      },
    ],
  };
  const { steps, ...investigationInput } = investigation;
  await repository.saveSharedInvestigation(investigationInput);
  await repository.replaceSharedInvestigationSteps({
    investigation_id: investigation.id,
    steps,
  });

  const decisionBrief = await repository.saveDecisionBrief({
    id: randomUUID(),
    workspace_id: workspace.id,
    investigation_id: investigation.id,
    lead_prediction_id: prediction.id,
    title: "Rates shock response brief",
    summary: "Turn the CPI surprise into an explicit short-duration, long-dollar operating brief.",
    thesis: "The first-order response is higher yields, firmer USD, and pressure on growth multiples.",
    scenario: "Macro surprise with no offsetting growth collapse.",
    confidence_label: "high",
    key_assets: ["TLT", "DXY", "QQQ"],
    triggers: ["2Y yield extending higher", "Dollar breadth confirming"],
    invalidations: ["Bond market squeezes lower despite the inflation surprise"],
    status: "closed",
    owner_user_id: owner.id,
    assignee_user_id: teammate.id,
    last_actor_user_id: teammate.id,
    next_review_due_at: null,
    closed_at: "2026-04-22T12:00:00.000Z",
    updated_at: "2026-04-22T12:00:00.000Z",
    created_at: "2026-04-22T10:20:00.000Z",
  });
  await repository.saveDecisionCheckpoint({
    id: randomUUID(),
    decision_brief_id: decisionBrief.id,
    workspace_id: workspace.id,
    actor_user_id: teammate.id,
    summary: "The trade worked quickly after the print, so the thesis can be closed and stored as retrieval memory.",
    thesis_state: "resolved",
    action: "close",
    created_at: "2026-04-22T12:00:00.000Z",
  });

  const portfolioCandidate: PortfolioCandidate = await repository.savePortfolioCandidate({
    id: randomUUID(),
    workspace_id: workspace.id,
    decision_brief_id: decisionBrief.id,
    investigation_id: investigation.id,
    lead_prediction_id: prediction.id,
    title: "Duration short posture",
    summary: "Manual-first posture for the CPI rates shock with explicit review cadence.",
    status: "closed",
    priority: "high",
    sizing_label: "starter",
    risk_budget_label: "contained",
    conviction_label: "high",
    primary_theme: "rates repricing",
    secondary_themes: ["inflation surprise", "usd strength"],
    related_assets: ["TLT", "DXY", "QQQ"],
    owner_user_id: owner.id,
    assignee_user_id: teammate.id,
    last_actor_user_id: teammate.id,
    next_review_due_at: null,
    closed_at: "2026-04-22T13:30:00.000Z",
    updated_at: "2026-04-22T13:30:00.000Z",
    created_at: "2026-04-22T10:40:00.000Z",
  });
  await repository.savePortfolioCheckpoint({
    id: randomUUID(),
    portfolio_candidate_id: portfolioCandidate.id,
    workspace_id: workspace.id,
    actor_user_id: teammate.id,
    summary: "The move landed and the candidate can be closed as a completed follow-through case.",
    thesis_state: "resolved",
    action: "close",
    created_at: "2026-04-22T13:30:00.000Z",
  });

  const reviewSession = await repository.savePortfolioReviewSession({
    id: randomUUID(),
    workspace_id: workspace.id,
    title: "Portfolio review 2026-04-22",
    summary: "Review the rates shock posture and decide whether it should stay active or be closed.",
    status: "finalized",
    owner_user_id: owner.id,
    last_actor_user_id: teammate.id,
    opened_at: "2026-04-22T13:00:00.000Z",
    finalized_at: "2026-04-22T13:35:00.000Z",
    created_at: "2026-04-22T13:00:00.000Z",
    updated_at: "2026-04-22T13:35:00.000Z",
  });
  await repository.savePortfolioReviewSessionItem({
    id: randomUUID(),
    review_session_id: reviewSession.id,
    portfolio_candidate_id: portfolioCandidate.id,
    snapshot_status: "trimmed",
    snapshot_priority: portfolioCandidate.priority,
    snapshot_primary_theme: portfolioCandidate.primary_theme,
    snapshot_assignee_user_id: portfolioCandidate.assignee_user_id,
    snapshot_next_review_due_at: null,
    created_at: "2026-04-22T13:02:00.000Z",
  });
  await repository.savePortfolioRebalanceProposal({
    id: randomUUID(),
    review_session_id: reviewSession.id,
    portfolio_candidate_id: portfolioCandidate.id,
    actor_user_id: teammate.id,
    action: "close",
    status: "approved",
    rationale: "The shock move played out and there is no edge in pretending the thesis is still live.",
    dependency_note: null,
    next_review_expectation: "Store as closed portfolio outcome.",
    decided_at: "2026-04-22T13:35:00.000Z",
    created_at: "2026-04-22T13:15:00.000Z",
    updated_at: "2026-04-22T13:35:00.000Z",
  });

  await repository.saveWorkspaceRecentItem({
    workspace_id: workspace.id,
    actor_user_id: owner.id,
    id: "recent-portfolio-candidate",
    kind: "prediction",
    href: `/portfolio/${portfolioCandidate.id}`,
    title: portfolioCandidate.title,
    description: "Closed rates-shock candidate ready for retrospective memory.",
    updated_at: "2026-04-22T13:35:00.000Z",
  });

  await repository.saveWorkspaceActivity({
    id: randomUUID(),
    workspace_id: workspace.id,
    actor_user_id: owner.id,
    kind: "portfolio_candidate_posture_updated",
    investigation_id: investigation.id,
    studio_run_id: null,
    prediction_id: prediction.id,
    detail: `Portfolio posture updated for ${portfolioCandidate.title}.`,
    metadata: {
      portfolio_candidate_id: portfolioCandidate.id,
      conviction_label: portfolioCandidate.conviction_label,
    },
    created_at: "2026-04-22T11:00:00.000Z",
  });
  await repository.saveWorkspaceActivity({
    id: randomUUID(),
    workspace_id: workspace.id,
    actor_user_id: teammate.id,
    kind: "review_note_saved",
    investigation_id: investigation.id,
    studio_run_id: null,
    prediction_id: prediction.id,
    detail: "Shared review note saved for the lead prediction.",
    metadata: {
      prediction_id: prediction.id,
    },
    created_at: "2026-04-22T10:25:00.000Z",
  });

  await repository.saveLesson(
    {
      id: randomUUID(),
      prediction_id: prediction.id,
      lesson_type: "reinforcement",
      lesson_summary: "Hot CPI can still deliver a clean duration-down, dollar-up reaction when the surprise is clear enough.",
      metadata: {
        verdict: "correct",
        catalyst: "inflation surprise",
        imported_from: "obsidian",
        import_mode: "selective_human_inbox",
        obsidian_relative_path: "Finance Superbrain/Human Inbox/rates-shock.md",
        investigation_id: investigation.id,
        decision_brief_id: decisionBrief.id,
        portfolio_candidate_id: portfolioCandidate.id,
      },
      created_at: "2026-04-22T12:10:00.000Z",
    },
    [0.1, 0.2, 0.3],
  );

  return { repository, workspace, portfolioCandidate };
}

describe("obsidian export", () => {
  it("supports dry-run without writing files", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "finance-superbrain-obsidian-"));
    const { repository, workspace } = await seedRepository();

    const summary = await exportWorkspaceToObsidian(repository, {
      vault_path: vaultPath,
      export_root: "Finance Superbrain",
      app_url: "http://localhost:3000",
      dry_run: true,
    });

    expect(summary.workspace_id).toBe(workspace.id);
    expect(summary.dry_run).toBe(true);
    expect(summary.note_counts.investigations).toBe(1);
    expect(summary.note_counts.decision_briefs).toBe(1);
    expect(summary.note_counts.portfolio_candidates).toBe(1);
    expect(summary.note_counts.lessons).toBe(1);
    expect(summary.note_counts.activity).toBe(2);
    expect(summary.note_counts.connections).toBe(3);
    expect(summary.note_counts.project).toBe(11);
    expect(summary.note_counts.indexes).toBe(7);

    await expect(stat(join(vaultPath, "Finance Superbrain"))).rejects.toThrow();
  });

  it("writes the generated knowledge graph into the managed subtree", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "finance-superbrain-obsidian-"));
    const { repository, portfolioCandidate } = await seedRepository();

    const summary = await exportWorkspaceToObsidian(repository, {
      vault_path: vaultPath,
      export_root: "Finance Superbrain",
      app_url: "http://localhost:3000",
      dry_run: false,
    });

    expect(summary.dry_run).toBe(false);
    const outputRoot = join(vaultPath, "Finance Superbrain");
    const allFiles = await listMarkdownFiles(outputRoot);

    expect(allFiles).toHaveLength(summary.note_counts.total);
    expect(allFiles.every((filePath) => filePath.startsWith(outputRoot))).toBe(true);

    const decisionFile = (await readdir(join(outputRoot, "Decisions")))[0]!;
    const decisionMarkdown = await readFile(join(outputRoot, "Decisions", decisionFile), "utf8");
    expect(decisionMarkdown).toContain("# Rates shock response brief");
    expect(decisionMarkdown).toContain("## Checkpoint History");
    expect(decisionMarkdown).toContain("[[Finance Superbrain/Portfolio/");
    expect(decisionMarkdown).toContain("## Linked Lessons");
    expect(decisionMarkdown).toContain("Hot CPI can still deliver a clean duration-down");

    const portfolioFile = (await readdir(join(outputRoot, "Portfolio")))[0]!;
    const portfolioMarkdown = await readFile(join(outputRoot, "Portfolio", portfolioFile), "utf8");
    expect(portfolioMarkdown).toContain("# Duration short posture");
    expect(portfolioMarkdown).toContain("## Portfolio Posture");
    expect(portfolioMarkdown).toContain("## Latest Review Session");
    expect(portfolioMarkdown).toContain(portfolioCandidate.id);
    expect(portfolioMarkdown).toContain("## Linked Lessons");
    expect(portfolioMarkdown).toContain("Hot CPI can still deliver a clean duration-down");

    const lessonFile = (await readdir(join(outputRoot, "Lessons")))[0]!;
    const lessonMarkdown = await readFile(join(outputRoot, "Lessons", lessonFile), "utf8");
    expect(lessonMarkdown).toContain("## Retrieval Context");
    expect(lessonMarkdown).toContain("Hot CPI forced a hawkish rate repricing.");
    expect(lessonMarkdown).toContain("linked_decision_brief_id:");
    expect(lessonMarkdown).toContain("linked_portfolio_candidate_id:");
    expect(lessonMarkdown).toContain("[[Finance Superbrain/Decisions/");
    expect(lessonMarkdown).toContain("[[Finance Superbrain/Portfolio/");
    expect(lessonMarkdown).toContain("Open linked decision brief");

    const overviewMarkdown = await readFile(join(outputRoot, "Indexes", "Workspace Overview.md"), "utf8");
    expect(overviewMarkdown).toContain("[[Finance Superbrain/Indexes/Investigations Index]]");
    expect(overviewMarkdown).toContain("Open workspace");

    const activityMarkdown = await readFile(join(outputRoot, "Activity", "Recent Activity Log.md"), "utf8");
    expect(activityMarkdown).toContain("portfolio_candidate_posture_updated");
    expect(activityMarkdown).toContain("review_note_saved");

    const connectionFiles = await readdir(join(outputRoot, "Connections"));
    expect(connectionFiles.length).toBe(3);
    const connectionMarkdown = await readFile(join(outputRoot, "Connections", connectionFiles[0]!), "utf8");
    expect(connectionMarkdown).toContain("Generated connection memory");
    expect(connectionMarkdown).toContain("## Linked Memory");
    expect(connectionMarkdown).toContain("decision_key_asset");

    const connectionsIndexMarkdown = await readFile(join(outputRoot, "Indexes", "Connections Index.md"), "utf8");
    expect(connectionsIndexMarkdown).toContain("# Connections Index");
    expect(connectionsIndexMarkdown).toContain("[[Finance Superbrain/Connections/");

    const projectFiles = await readdir(join(outputRoot, "Project"));
    expect(projectFiles).toEqual(
      expect.arrayContaining([
        "Project Overview.md",
        "Work Session.md",
        "Phase Ledger.md",
        "Build Log.md",
        "Risk Register.md",
        "Validation History.md",
        "Data Inventory.md",
        "Decision Record - postgresql-remains-source-of-truth-while-obsidian-is-local-memory.md",
        "Decision Record - obsidian-human-inbox-import-is-review-gated.md",
        "Decision Record - next-js-remains-the-primary-desk-workflow.md",
        "Decision Record - hosted-health-separates-liveness-from-readiness.md",
      ]),
    );
    const workSessionMarkdown = await readFile(join(outputRoot, "Project", "Work Session.md"), "utf8");
    expect(workSessionMarkdown).toContain("# Work Session");
    expect(workSessionMarkdown).toContain("automatic workspace syncing");
    expect(workSessionMarkdown).toContain("Companion plugin status note");
    expect(workSessionMarkdown).toContain("[[Finance Superbrain/Project/Obsidian Plugin Sync|Obsidian Plugin Sync]]");
    const dataInventoryMarkdown = await readFile(join(outputRoot, "Project", "Data Inventory.md"), "utf8");
    expect(dataInventoryMarkdown).toContain("## Workspace Data Counts");
    expect(dataInventoryMarkdown).toContain("Connection reports: 3");
    expect(dataInventoryMarkdown).toContain("Local sync sessions:");
    expect(dataInventoryMarkdown).toContain("## Export Readiness");
    expect(dataInventoryMarkdown).toContain("Useful local memory export");
    const phaseLedgerMarkdown = await readFile(join(outputRoot, "Project", "Phase Ledger.md"), "utf8");
    expect(phaseLedgerMarkdown).toContain("# Phase Ledger");
    expect(phaseLedgerMarkdown).toContain("## Phase 14: Public Pilot Deployment");
    expect(phaseLedgerMarkdown).toContain("Generated Export Context");
    expect(phaseLedgerMarkdown).toContain("## Explicit Phase Evidence Links");
    expect(phaseLedgerMarkdown).toContain("Phase 12: Obsidian Memory Bridge");
    expect(phaseLedgerMarkdown).toContain("`apps/api/sql/001_phase1_intelligence_core.sql`");
    expect(phaseLedgerMarkdown).toContain("Commands: `npm run demo:public-pilot:smoke:hosted`");
    expect(phaseLedgerMarkdown).toContain(
      "Deployment status: hosted public pilot smoke, scheduled monitor workflow, and hosted operations health check passed on 2026-05-17.",
    );
    const architectureDecisionMarkdown = await readFile(
      join(outputRoot, "Project", "Decision Record - postgresql-remains-source-of-truth-while-obsidian-is-local-memory.md"),
      "utf8",
    );
    expect(architectureDecisionMarkdown).toContain("# PostgreSQL remains source of truth while Obsidian is local memory");
    expect(architectureDecisionMarkdown).toContain("## Decision");
    expect(architectureDecisionMarkdown).toContain("Related phases: Phase 4, Phase 12, Phase 14");
    expect(architectureDecisionMarkdown).toContain("[[Finance Superbrain/Project/Phase Ledger]]");
  });

  it("includes automatic work-session history when sync state exists", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "finance-superbrain-obsidian-"));
    const syncStatePath = join(vaultPath, "sync-state.json");
    const previousSyncStatePath = process.env.FINANCE_SUPERBRAIN_OBSIDIAN_SYNC_STATE_PATH;
    process.env.FINANCE_SUPERBRAIN_OBSIDIAN_SYNC_STATE_PATH = syncStatePath;

    await writeFile(
      syncStatePath,
      JSON.stringify(
        {
          version: 1,
          updated_at: "2026-05-13T10:15:00.000Z",
          sessions: [
            {
              session_id: "sync-session-1",
              captured_at: "2026-05-13T10:15:00.000Z",
              mode: "watch",
              branch: "main",
              head: "abc1234",
              dirty: true,
              status_lines: ["M apps/api/src/lib/obsidianExport.ts"],
              changed_files: ["apps/api/src/lib/obsidianExport.ts"],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      const { repository } = await seedRepository();

      const summary = await exportWorkspaceToObsidian(repository, {
        vault_path: vaultPath,
        export_root: "Finance Superbrain",
        app_url: "http://localhost:3000",
        dry_run: false,
      });

      expect(summary.note_counts.project).toBe(11);
      const workSessionMarkdown = await readFile(join(vaultPath, "Finance Superbrain", "Project", "Work Session.md"), "utf8");
      expect(workSessionMarkdown).toContain("watch");
      expect(workSessionMarkdown).toContain("apps/api/src/lib/obsidianExport.ts");
      expect(workSessionMarkdown).toContain("Changed files: 1");
      expect(workSessionMarkdown).toContain("same sync/review state");
    } finally {
      if (previousSyncStatePath === undefined) {
        delete process.env.FINANCE_SUPERBRAIN_OBSIDIAN_SYNC_STATE_PATH;
      } else {
        process.env.FINANCE_SUPERBRAIN_OBSIDIAN_SYNC_STATE_PATH = previousSyncStatePath;
      }
    }
  });

  it("rejects export roots that try to escape the vault", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "finance-superbrain-obsidian-"));
    const { repository } = await seedRepository();

    await expect(
      exportWorkspaceToObsidian(repository, {
        vault_path: vaultPath,
        export_root: "..\\outside",
        app_url: null,
        dry_run: true,
      }),
    ).rejects.toThrow("OBSIDIAN_EXPORT_ROOT");
  });

  it("removes stale managed files but keeps user-authored notes inside the vault", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "finance-superbrain-obsidian-"));
    const { repository } = await seedRepository();
    const outputRoot = join(vaultPath, "Finance Superbrain");
    const investigationDir = join(outputRoot, "Investigations");

    await mkdir(investigationDir, { recursive: true });
    await writeFile(
      join(investigationDir, "stale-managed.md"),
      "---\nmanaged_by: \"finance_superbrain\"\ntype: \"investigation\"\nworkspace_id: \"00000000-0000-4000-8000-000000000001\"\n---\n# stale",
      "utf8",
    );
    await writeFile(join(investigationDir, "user-note.md"), "# User note", "utf8");

    await exportWorkspaceToObsidian(repository, {
      vault_path: vaultPath,
      export_root: "Finance Superbrain",
      app_url: "http://localhost:3000",
      dry_run: false,
    });

    await expect(stat(join(investigationDir, "stale-managed.md"))).rejects.toThrow();
    const userNote = await readFile(join(investigationDir, "user-note.md"), "utf8");
    expect(userNote).toBe("# User note");
  }, 20_000);

  it("builds config from environment and warns when app url is absent", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "finance-superbrain-obsidian-"));
    const config = buildObsidianExportConfigFromEnv(
      {
        OBSIDIAN_VAULT_PATH: vaultPath,
      },
      { dry_run: true },
    );

    expect(config.vault_path).toBe(vaultPath);
    expect(config.export_root).toBe("Finance Superbrain");
    expect(config.app_url).toBeNull();
    expect(config.dry_run).toBe(true);
  });
});
