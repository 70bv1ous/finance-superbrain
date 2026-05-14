import { randomUUID } from "node:crypto";

import { type PortfolioCandidate, type SharedInvestigation } from "@finance-superbrain/schemas";

import { InMemoryRepository } from "../lib/InMemoryRepository.js";
import { buildObsidianExportConfigFromEnv, exportWorkspaceToObsidian } from "../lib/obsidianExport.js";

function hasFlag(flag: string) {
  return process.argv.slice(2).includes(flag);
}

async function seedObsidianProofRepository() {
  const repository = new InMemoryRepository();
  const workspace = await repository.getOrCreateDefaultWorkspace();
  const owner = await repository.createWorkspaceUser({
    email: "lead.operator@finance-superbrain.local",
    password_hash: "demo-proof-hash",
    display_name: "Lead Operator",
    role: "admin",
  });
  const analyst = await repository.createWorkspaceUser({
    email: "macro.analyst@finance-superbrain.local",
    password_hash: "demo-proof-hash",
    display_name: "Macro Analyst",
    role: "member",
  });

  const source = await repository.createSource({
    source_type: "headline",
    title: "Hot CPI surprise",
    raw_text: "CPI ran hotter than expected, pushing yields higher and forcing a disciplined cross-asset review.",
  });
  const event = await repository.createEvent(source.id, {
    event_class: "macro_commentary",
    summary: "Hot CPI forced a hawkish rates repricing.",
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
    model_version: "obsidian-proof-v1",
  });

  const investigation: SharedInvestigation = {
    id: "demo-investigation-cpi-discipline",
    workspace_id: workspace.id,
    title: "Hot CPI hawkish repricing",
    event_id: event.id,
    prediction_ids: [prediction.id],
    status: "reviewed",
    owner_user_id: owner.id,
    assignee_user_id: analyst.id,
    last_actor_user_id: analyst.id,
    updated_at: "2026-04-22T10:30:00.000Z",
    created_at: "2026-04-22T09:00:00.000Z",
    steps: [
      {
        id: "demo-investigation-cpi-discipline:studio",
        kind: "studio_run",
        status: "reviewed",
        href: "/studio?run=demo-studio-run-cpi-discipline",
        title: "Studio run stored",
        detail: "The CPI surprise was parsed into a shared Studio run with durable event capture and prediction output.",
        updated_at: "2026-04-22T09:45:00.000Z",
      },
      {
        id: "demo-investigation-cpi-discipline:library",
        kind: "library_lookup",
        status: "reviewed",
        href: "/library?trail=demo-investigation-cpi-discipline",
        title: "Lesson memory ready",
        detail: "The completed investigation now appears inside retrieval and retrospective context.",
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
    id: "demo-decision-cpi-discipline",
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
    assignee_user_id: analyst.id,
    last_actor_user_id: analyst.id,
    next_review_due_at: null,
    closed_at: "2026-04-22T12:00:00.000Z",
    updated_at: "2026-04-22T12:00:00.000Z",
    created_at: "2026-04-22T10:20:00.000Z",
  });
  await repository.saveDecisionCheckpoint({
    id: randomUUID(),
    decision_brief_id: decisionBrief.id,
    workspace_id: workspace.id,
    actor_user_id: analyst.id,
    summary: "The trade worked quickly after the print, so the thesis can be closed and stored as retrieval memory.",
    thesis_state: "resolved",
    action: "close",
    created_at: "2026-04-22T12:00:00.000Z",
  });

  const portfolioCandidate: PortfolioCandidate = await repository.savePortfolioCandidate({
    id: "demo-portfolio-cpi-discipline",
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
    assignee_user_id: analyst.id,
    last_actor_user_id: analyst.id,
    next_review_due_at: null,
    closed_at: "2026-04-22T13:30:00.000Z",
    updated_at: "2026-04-22T13:30:00.000Z",
    created_at: "2026-04-22T10:40:00.000Z",
  });
  await repository.savePortfolioCheckpoint({
    id: randomUUID(),
    portfolio_candidate_id: portfolioCandidate.id,
    workspace_id: workspace.id,
    actor_user_id: analyst.id,
    summary: "The move landed and the candidate can be closed as a completed follow-through case.",
    thesis_state: "resolved",
    action: "close",
    created_at: "2026-04-22T13:30:00.000Z",
  });

  await repository.saveLesson(
    {
      id: randomUUID(),
      prediction_id: prediction.id,
      lesson_type: "reinforcement",
      lesson_summary: "Hot CPI can still deliver a clean duration-down, dollar-up reaction when the surprise is clear enough.",
      metadata: {
        imported_from: "obsidian",
        import_mode: "selective_human_inbox",
        obsidian_relative_path: "Finance Superbrain/Human Inbox/CPI discipline reminder.md",
        obsidian_content_hash: "demo-proof-cpi-discipline",
        themes: "inflation,rates",
        assets: "TLT,DXY,QQQ",
        tags: "human-memory,cross-asset",
      },
      created_at: "2026-04-22T12:10:00.000Z",
    },
    [0.1, 0.2, 0.3],
  );

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

  return repository;
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const repository = await seedObsidianProofRepository();

  const config = buildObsidianExportConfigFromEnv(process.env, { dry_run: dryRun });
  const summary = await exportWorkspaceToObsidian(repository, config);

  console.log(`Obsidian demo-proof export ${summary.dry_run ? "dry-run" : "complete"}`);
  console.log(`Workspace: ${summary.workspace_id}`);
  console.log(`Output: ${summary.output_path}`);
  console.log(
    `Notes: investigations=${summary.note_counts.investigations}, decisions=${summary.note_counts.decision_briefs}, portfolio=${summary.note_counts.portfolio_candidates}, lessons=${summary.note_counts.lessons}, activity=${summary.note_counts.activity}, connections=${summary.note_counts.connections}, project=${summary.note_counts.project}, indexes=${summary.note_counts.indexes}, total=${summary.note_counts.total}`,
  );

  if (summary.warnings.length) {
    console.log("Warnings:");
    for (const warning of summary.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
