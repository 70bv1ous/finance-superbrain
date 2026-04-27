import { randomUUID } from "node:crypto";

import {
  GUIDED_DEMO_PROOF_IDS,
  type DecisionBrief,
  type DecisionCheckpoint,
  type Lesson,
  type PortfolioCandidate,
  type PortfolioCheckpoint,
  type PortfolioRebalanceProposal,
  type PortfolioReviewSession,
  type PortfolioReviewSessionItem,
  type SharedInvestigation,
  type SharedInvestigationStep,
  type SharedReviewNote,
  type SharedStudioRun,
  type WorkspaceActivity,
  type WorkspaceRecentItem,
} from "@finance-superbrain/schemas";

import { buildHistoricalLibraryDrafts } from "../data/historicalBackfillCases.js";
import { ingestHistoricalCaseLibrary } from "../lib/historicalCaseLibrary.js";
import { buildServices } from "../lib/services.js";
import { hashPassword } from "../lib/workspaceAuth.js";

const DEMO_ADMIN = {
  email: "lead.operator@finance-superbrain.local",
  password: "workspace-admin-password",
  display_name: "Lead Operator",
  role: "admin" as const,
};

const DEMO_ANALYST = {
  email: "macro.analyst@finance-superbrain.local",
  password: "workspace-analyst-password",
  display_name: "Macro Analyst",
  role: "member" as const,
};

const STUDIO_RUN_ID = GUIDED_DEMO_PROOF_IDS.studio_run_id;
const INVESTIGATION_ID = GUIDED_DEMO_PROOF_IDS.investigation_id;
const DECISION_BRIEF_ID = GUIDED_DEMO_PROOF_IDS.decision_brief_id;
const PORTFOLIO_CANDIDATE_ID = GUIDED_DEMO_PROOF_IDS.portfolio_candidate_id;
const PORTFOLIO_REVIEW_SESSION_ID = GUIDED_DEMO_PROOF_IDS.portfolio_review_session_id;

function isoFromNow(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

function createWorkspaceActivity(input: Omit<WorkspaceActivity, "id">): WorkspaceActivity {
  return {
    id: randomUUID(),
    ...input,
  };
}

function createInvestigationSteps(leadPredictionId: string): SharedInvestigationStep[] {
  return [
    {
      id: `${INVESTIGATION_ID}:studio`,
      kind: "studio_run",
      status: "reviewed",
      href: `/studio?run=${STUDIO_RUN_ID}`,
      title: "Studio run stored",
      detail: "The CPI surprise was parsed into a shared Studio run with durable event capture and prediction output.",
      updated_at: isoFromNow(-30),
    },
    {
      id: `${INVESTIGATION_ID}:prediction`,
      kind: "prediction_detail",
      status: "reviewed",
      href: `/predictions/${leadPredictionId}`,
      title: "Lead prediction reviewed",
      detail: "The lead rates-and-dollar view was scored, postmortemed, and saved as reusable operating memory.",
      updated_at: isoFromNow(-22),
    },
    {
      id: `${INVESTIGATION_ID}:review`,
      kind: "review_focus",
      status: "reviewed",
      href: `/accuracy?focus=${leadPredictionId}`,
      title: "Shared review note saved",
      detail: "The desk captured the review note so the retrieval layer keeps both the call and the operating takeaway.",
      updated_at: isoFromNow(-18),
    },
    {
      id: `${INVESTIGATION_ID}:library`,
      kind: "library_lookup",
      status: "reviewed",
      href: `/library?focus=${INVESTIGATION_ID}`,
      title: "Lesson memory ready",
      detail: "The completed investigation now appears inside retrieval and retrospective context rather than disappearing after review.",
      updated_at: isoFromNow(-10),
    },
    {
      id: `${INVESTIGATION_ID}:evaluation`,
      kind: "evaluation_context",
      status: "reviewed",
      href: "/evaluation",
      title: "Evaluation context linked",
      detail: "The finished investigation can be revisited as a scored outcome inside the evaluation and memory surfaces.",
      updated_at: isoFromNow(-4),
    },
  ];
}

async function main() {
  const originalVoyageApiKey = process.env.VOYAGE_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  let services: ReturnType<typeof buildServices> | null = null;

  try {
    services = buildServices();

    if (!services.repository.reset) {
      throw new Error(
        "The current repository backend does not support deterministic reset. Use REPOSITORY_BACKEND=pglite or REPOSITORY_BACKEND=memory for seed:demo-proof.",
      );
    }

    await services.repository.reset();

    const workspace = await services.repository.getOrCreateDefaultWorkspace();

    const admin = await services.repository.createWorkspaceUser({
      email: DEMO_ADMIN.email,
      display_name: DEMO_ADMIN.display_name,
      role: DEMO_ADMIN.role,
      password_hash: await hashPassword(DEMO_ADMIN.password),
      workspace_id: workspace.id,
      active: true,
    });
    const analyst = await services.repository.createWorkspaceUser({
      email: DEMO_ANALYST.email,
      display_name: DEMO_ANALYST.display_name,
      role: DEMO_ANALYST.role,
      password_hash: await hashPassword(DEMO_ANALYST.password),
      workspace_id: workspace.id,
      active: true,
    });

    await services.repository.saveWorkspaceActivity(
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "user_created",
        investigation_id: null,
        studio_run_id: null,
        prediction_id: null,
        detail: `${admin.display_name} was added to the workspace.`,
        metadata: {
          email: admin.email,
        },
        created_at: isoFromNow(-46),
      }),
    );
    await services.repository.saveWorkspaceActivity(
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "user_created",
        investigation_id: null,
        studio_run_id: null,
        prediction_id: null,
        detail: `${analyst.display_name} was added to the workspace.`,
        metadata: {
          email: analyst.email,
        },
        created_at: isoFromNow(-45.5),
      }),
    );

    const seededHistoricalLibrary = await ingestHistoricalCaseLibrary(services, {
      items: buildHistoricalLibraryDrafts("macro_v1").slice(0, 4),
      store_library: true,
      ingest_reviewed_memory: true,
      fallback_model_version: "demo-proof-seed-v1",
      labeling_mode: "merge",
    });

    const source = await services.repository.createSource({
      source_type: "headline",
      title: "Core CPI surprise pushes yields and the dollar higher",
      publisher: "Finance Superbrain Demo Feed",
      raw_uri: "https://finance-superbrain.local/demo/cpi-surprise",
      occurred_at: isoFromNow(-40),
      raw_text:
        "Core CPI surprised to the upside, pushing Treasury yields higher, strengthening the dollar, and forcing the desk to reassess reflation posture across cyclicals and duration.",
    });

    const event = await services.repository.createEvent(source.id, {
      event_class: "macro_commentary",
      summary: "Hot CPI surprise tightens financial conditions and shifts the desk toward a more disciplined reflation stance.",
      sentiment: "risk_off",
      urgency_score: 0.86,
      novelty_score: 0.62,
      entities: [
        { type: "theme", value: "inflation" },
        { type: "theme", value: "rates" },
        { type: "organization", value: "Federal Reserve" },
        { type: "country", value: "United States" },
      ],
      themes: ["inflation", "rates", "macro_repricing"],
      candidate_assets: ["TLT", "DXY", "XLI", "QQQ"],
      why_it_matters: [
        "A hotter CPI print pushes the market to reprice rate-cut timing and tightens conditions for long-duration assets.",
        "The immediate transmission path usually hits bonds first, then the dollar, then cyclicals and growth equities.",
      ],
    });

    const leadPrediction = await services.repository.createPrediction(event.id, {
      horizon: "1d",
      thesis:
        "The clean first-order path is lower duration, firmer dollar, and tighter tolerance for cyclicals until the market sees confirmation that the inflation surprise is not persistent.",
      confidence: 0.74,
      assets: [
        { ticker: "TLT", expected_direction: "down", expected_magnitude_bp: -52, conviction: 0.82 },
        { ticker: "DXY", expected_direction: "up", expected_magnitude_bp: 28, conviction: 0.77 },
        { ticker: "XLI", expected_direction: "down", expected_magnitude_bp: -24, conviction: 0.61 },
      ],
      evidence: [
        "Treasury pricing should react first when inflation timing and policy-cut expectations are repriced.",
        "The dollar typically strengthens when policy stays higher for longer relative to earlier expectations.",
        "Cyclicals can underperform until the desk confirms the growth read-through is not being overwhelmed by tighter conditions.",
      ],
      invalidations: [
        "A fast reversal in yields would weaken the entire higher-for-longer read-through.",
        "A softer follow-up macro print could blunt the duration and dollar move.",
      ],
      assumptions: [
        "The CPI surprise is strong enough to matter for near-term policy expectations.",
        "No larger competing catalyst arrives within the same session window.",
      ],
      model_version: "demo-proof-v1",
    });

    await services.repository.updatePredictionStatus(leadPrediction.id, "reviewed");

    await services.repository.saveOutcome({
      id: randomUUID(),
      prediction_id: leadPrediction.id,
      horizon: leadPrediction.horizon,
      measured_at: isoFromNow(-26),
      outcome_payload: {
        realized_moves: [
          {
            ticker: "TLT",
            realized_direction: "down",
            realized_magnitude_bp: -48,
          },
          {
            ticker: "DXY",
            realized_direction: "up",
            realized_magnitude_bp: 25,
          },
        ],
        timing_alignment: 0.87,
        dominant_catalyst: "core-cpi-surprise",
        predicted_asset_count: leadPrediction.assets.length,
        matched_asset_count: 2,
        coverage_ratio: 2 / leadPrediction.assets.length,
      },
      direction_score: 0.88,
      magnitude_score: 0.82,
      timing_score: 0.87,
      calibration_score: 0.79,
      total_score: 0.84,
      created_at: isoFromNow(-25.75),
    });

    await services.repository.savePostmortem({
      id: randomUUID(),
      prediction_id: leadPrediction.id,
      verdict: "correct",
      failure_tags: [],
      critique:
        "The call respected the bond-to-dollar transmission path and avoided overcommitting to equities until tighter conditions could be confirmed.",
      lesson_summary:
        "When hot inflation drives the move, start with bonds and the dollar, then let cyclical posture stay conditional on whether tighter conditions overpower growth momentum.",
      created_at: isoFromNow(-25.5),
    });

    const lesson: Lesson = {
      id: randomUUID(),
      prediction_id: leadPrediction.id,
      lesson_type: "reinforcement",
      lesson_summary:
        "Hot CPI cases are strongest when the desk makes the bond and dollar transmission explicit before taking a stronger cyclical view.",
      metadata: {
        theme: "inflation",
        pack: "demo-proof",
        operating_object: DECISION_BRIEF_ID,
      },
      created_at: isoFromNow(-25.25),
    };
    await services.repository.saveLesson(lesson);

    const preview = {
      event_class: event.event_class,
      summary: event.summary,
      sentiment: event.sentiment,
      urgency_score: event.urgency_score,
      novelty_score: event.novelty_score,
      entities: event.entities,
      themes: event.themes,
      candidate_assets: event.candidate_assets,
      why_it_matters: event.why_it_matters,
    };

    const studioRun: SharedStudioRun = {
      id: STUDIO_RUN_ID,
      workspace_id: workspace.id,
      owner_user_id: admin.id,
      last_actor_user_id: analyst.id,
      title: "Hot CPI cross-asset discipline run",
      source_type: source.source_type,
      stage: "ready_for_review",
      form: {
        source_type: source.source_type,
        title: source.title ?? "",
        speaker: source.speaker ?? "",
        publisher: source.publisher ?? "",
        raw_uri: source.raw_uri ?? "",
        occurred_at: source.occurred_at ?? "",
        raw_text: source.raw_text,
        model_version: "demo-proof-v1",
        horizons: ["1d"],
      },
      preview,
      source,
      event,
      predictions: [leadPrediction],
      analogs: [],
      event_summary: event.summary,
      event_id: event.id,
      prediction_ids: [leadPrediction.id],
      analog_prediction_ids: [],
      updated_at: isoFromNow(-31),
      created_at: isoFromNow(-39.5),
    };
    await services.repository.saveSharedStudioRun(studioRun);

    const investigationBase: Omit<SharedInvestigation, "steps"> = {
      id: INVESTIGATION_ID,
      workspace_id: workspace.id,
      title: "Hot CPI to reflation discipline",
      event_id: event.id,
      prediction_ids: [leadPrediction.id],
      status: "reviewed",
      owner_user_id: admin.id,
      assignee_user_id: analyst.id,
      last_actor_user_id: analyst.id,
      updated_at: isoFromNow(-4),
      created_at: isoFromNow(-38),
    };
    await services.repository.saveSharedInvestigation(investigationBase);
    await services.repository.replaceSharedInvestigationSteps({
      investigation_id: INVESTIGATION_ID,
      steps: createInvestigationSteps(leadPrediction.id),
    });

    const reviewNote: SharedReviewNote = {
      workspace_id: workspace.id,
      prediction_id: leadPrediction.id,
      note:
        "Review confirmed the rates and dollar path. The key operating lesson was to keep cyclical posture conditional until tighter conditions stopped widening.",
      owner_user_id: analyst.id,
      created_at: isoFromNow(-19),
      updated_at: isoFromNow(-18.5),
    };
    await services.repository.saveSharedReviewNote(reviewNote);

    const decisionBrief: DecisionBrief = {
      id: DECISION_BRIEF_ID,
      workspace_id: workspace.id,
      investigation_id: INVESTIGATION_ID,
      lead_prediction_id: leadPrediction.id,
      title: "Sticky CPI reflation discipline brief",
      summary:
        "Keep the reflation thesis live, but force it through explicit rates discipline until a softer follow-up print or cleaner breadth confirmation changes the balance.",
      thesis:
        "Higher-for-longer repricing should keep duration under pressure and support the dollar, so the desk should stay selective on reflation until tighter conditions stop broadening.",
      scenario:
        "If hotter inflation keeps yields elevated, cyclicals should stay more tactical than structural and the brief should remain active with explicit review cadence.",
      confidence_label: "medium_high",
      key_assets: ["TLT", "DXY", "XLI"],
      triggers: [
        "A follow-up inflation or payroll print confirms that yields remain biased higher.",
        "Breadth stops deteriorating despite tighter conditions.",
      ],
      invalidations: [
        "A fast yields reversal breaks the higher-for-longer framing.",
        "The dollar fails to hold the move despite the CPI surprise.",
      ],
      status: "active",
      owner_user_id: admin.id,
      assignee_user_id: analyst.id,
      last_actor_user_id: analyst.id,
      next_review_due_at: isoFromNow(-2),
      closed_at: null,
      updated_at: isoFromNow(-6),
      created_at: isoFromNow(-24),
    };
    await services.repository.saveDecisionBrief(decisionBrief);

    const decisionCheckpoint: DecisionCheckpoint = {
      id: `${DECISION_BRIEF_ID}:checkpoint:1`,
      decision_brief_id: DECISION_BRIEF_ID,
      workspace_id: workspace.id,
      actor_user_id: analyst.id,
      summary:
        "The thesis still holds, but the team should keep the reflation posture disciplined until either breadth improves or yields stop doing the tightening work.",
      thesis_state: "intact",
      action: "keep_active",
      created_at: isoFromNow(-5.5),
    };
    await services.repository.saveDecisionCheckpoint(decisionCheckpoint);

    const portfolioCandidate: PortfolioCandidate = {
      id: PORTFOLIO_CANDIDATE_ID,
      workspace_id: workspace.id,
      decision_brief_id: DECISION_BRIEF_ID,
      investigation_id: INVESTIGATION_ID,
      lead_prediction_id: leadPrediction.id,
      title: "Reflation posture under sticky CPI pressure",
      summary:
        "Treat the reflation theme as live but sized with discipline until the desk gets cleaner confirmation that tighter conditions are no longer broadening.",
      status: "active",
      priority: "high",
      sizing_label: "starter",
      risk_budget_label: "defined risk",
      conviction_label: "measured",
      primary_theme: "inflation discipline",
      secondary_themes: ["rates repricing", "cyclical breadth"],
      related_assets: ["TLT", "DXY", "XLI"],
      owner_user_id: admin.id,
      assignee_user_id: analyst.id,
      last_actor_user_id: analyst.id,
      next_review_due_at: isoFromNow(-1.5),
      closed_at: null,
      updated_at: isoFromNow(-3.5),
      created_at: isoFromNow(-20),
    };
    await services.repository.savePortfolioCandidate(portfolioCandidate);

    const portfolioCheckpoint: PortfolioCheckpoint = {
      id: `${PORTFOLIO_CANDIDATE_ID}:checkpoint:1`,
      portfolio_candidate_id: PORTFOLIO_CANDIDATE_ID,
      workspace_id: workspace.id,
      actor_user_id: analyst.id,
      summary:
        "Keep the candidate active, but treat any cyclical follow-through as conditional until the next inflation-sensitive data point confirms the move is not broadening.",
      thesis_state: "intact",
      action: "keep_active",
      created_at: isoFromNow(-2.75),
    };
    await services.repository.savePortfolioCheckpoint(portfolioCheckpoint);

    const reviewSession: PortfolioReviewSession = {
      id: PORTFOLIO_REVIEW_SESSION_ID,
      workspace_id: workspace.id,
      title: "Weekly macro rebalance review",
      summary: "Review live macro-sensitive candidates and decide whether posture should stay active, move to watching, or be trimmed.",
      status: "finalized",
      owner_user_id: admin.id,
      last_actor_user_id: analyst.id,
      opened_at: isoFromNow(-2.5),
      finalized_at: isoFromNow(-2),
      created_at: isoFromNow(-2.5),
      updated_at: isoFromNow(-2),
    };
    await services.repository.savePortfolioReviewSession(reviewSession);

    const reviewSessionItem: PortfolioReviewSessionItem = {
      id: `${PORTFOLIO_REVIEW_SESSION_ID}:item:1`,
      review_session_id: PORTFOLIO_REVIEW_SESSION_ID,
      portfolio_candidate_id: PORTFOLIO_CANDIDATE_ID,
      snapshot_status: portfolioCandidate.status,
      snapshot_priority: portfolioCandidate.priority,
      snapshot_primary_theme: portfolioCandidate.primary_theme,
      snapshot_assignee_user_id: portfolioCandidate.assignee_user_id,
      snapshot_next_review_due_at: portfolioCandidate.next_review_due_at,
      created_at: isoFromNow(-2.4),
    };
    await services.repository.savePortfolioReviewSessionItem(reviewSessionItem);

    const rebalanceProposal: PortfolioRebalanceProposal = {
      id: `${PORTFOLIO_REVIEW_SESSION_ID}:proposal:1`,
      review_session_id: PORTFOLIO_REVIEW_SESSION_ID,
      portfolio_candidate_id: PORTFOLIO_CANDIDATE_ID,
      actor_user_id: analyst.id,
      action: "keep_current",
      status: "approved",
      rationale:
        "The candidate still deserves active posture, but the desk should stay disciplined until the next macro data point confirms that tighter conditions are no longer spreading.",
      dependency_note: "Watch the next inflation-sensitive macro release before increasing exposure.",
      next_review_expectation: "Revisit after the next CPI or payroll shock path is clearer.",
      decided_at: isoFromNow(-2.1),
      created_at: isoFromNow(-2.3),
      updated_at: isoFromNow(-2.1),
    };
    await services.repository.savePortfolioRebalanceProposal(rebalanceProposal);

    const recentItems: WorkspaceRecentItem[] = [
      {
        id: `studio-run:${STUDIO_RUN_ID}`,
        kind: "studio_run",
        href: `/studio?run=${STUDIO_RUN_ID}`,
        title: studioRun.title,
        description: studioRun.event_summary,
        updated_at: studioRun.updated_at,
      },
      {
        id: `prediction:${leadPrediction.id}`,
        kind: "prediction",
        href: `/predictions/${leadPrediction.id}`,
        title: "Lead CPI prediction",
        description: "Reviewed CPI cross-asset prediction with shared note, lesson, and decision follow-through.",
        updated_at: isoFromNow(-18.25),
      },
    ];

    for (const item of recentItems) {
      await services.repository.saveWorkspaceRecentItem({
        ...item,
        workspace_id: workspace.id,
        actor_user_id: analyst.id,
      });
    }

    const activities: WorkspaceActivity[] = [
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "studio_run_saved",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: STUDIO_RUN_ID,
        prediction_id: leadPrediction.id,
        detail: `Studio run ${studioRun.title} was saved.`,
        metadata: {},
        created_at: isoFromNow(-31),
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: analyst.id,
        kind: "investigation_updated",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: STUDIO_RUN_ID,
        prediction_id: leadPrediction.id,
        detail: "Investigation moved into reviewed memory with a completed lesson trail.",
        metadata: {},
        created_at: isoFromNow(-18),
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "investigation_assigned",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: "Investigation Hot CPI to reflation discipline was assigned.",
        metadata: {
          assignee_user_id: analyst.id,
        },
        created_at: isoFromNow(-17.75),
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: analyst.id,
        kind: "review_note_saved",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: "A shared review note was saved for the lead CPI prediction.",
        metadata: {},
        created_at: isoFromNow(-18.5),
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "decision_brief_created",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: `Decision brief ${decisionBrief.title} was created.`,
        metadata: {
          decision_brief_id: DECISION_BRIEF_ID,
          status: decisionBrief.status,
        },
        created_at: isoFromNow(-24),
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "decision_brief_assigned",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: `Decision brief ${decisionBrief.title} was assigned.`,
        metadata: {
          decision_brief_id: DECISION_BRIEF_ID,
          assignee_user_id: analyst.id,
        },
        created_at: isoFromNow(-23.5),
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: analyst.id,
        kind: "decision_checkpoint_saved",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: `Checkpoint saved for decision brief ${decisionBrief.title}.`,
        metadata: {
          decision_brief_id: DECISION_BRIEF_ID,
          thesis_state: decisionCheckpoint.thesis_state,
          action: decisionCheckpoint.action,
          next_review_due_at: decisionBrief.next_review_due_at,
        },
        created_at: decisionCheckpoint.created_at,
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "portfolio_candidate_created",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: `Portfolio candidate ${portfolioCandidate.title} was created.`,
        metadata: {
          portfolio_candidate_id: PORTFOLIO_CANDIDATE_ID,
          decision_brief_id: DECISION_BRIEF_ID,
          status: portfolioCandidate.status,
        },
        created_at: isoFromNow(-20),
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "portfolio_candidate_assigned",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: `Portfolio candidate ${portfolioCandidate.title} was assigned.`,
        metadata: {
          portfolio_candidate_id: PORTFOLIO_CANDIDATE_ID,
          decision_brief_id: DECISION_BRIEF_ID,
          assignee_user_id: analyst.id,
        },
        created_at: isoFromNow(-19.75),
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: analyst.id,
        kind: "portfolio_checkpoint_saved",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: `Checkpoint saved for portfolio candidate ${portfolioCandidate.title}.`,
        metadata: {
          portfolio_candidate_id: PORTFOLIO_CANDIDATE_ID,
          decision_brief_id: DECISION_BRIEF_ID,
          thesis_state: portfolioCheckpoint.thesis_state,
          action: portfolioCheckpoint.action,
          next_review_due_at: portfolioCandidate.next_review_due_at,
        },
        created_at: portfolioCheckpoint.created_at,
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "portfolio_review_session_created",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: `Portfolio review session ${reviewSession.title} was created.`,
        metadata: {
          review_session_id: PORTFOLIO_REVIEW_SESSION_ID,
        },
        created_at: reviewSession.created_at,
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: analyst.id,
        kind: "portfolio_rebalance_proposal_saved",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: "A rebalance proposal was saved for the live CPI-linked portfolio candidate.",
        metadata: {
          review_session_id: PORTFOLIO_REVIEW_SESSION_ID,
          portfolio_candidate_id: PORTFOLIO_CANDIDATE_ID,
        },
        created_at: rebalanceProposal.created_at,
      }),
      createWorkspaceActivity({
        workspace_id: workspace.id,
        actor_user_id: admin.id,
        kind: "portfolio_review_session_finalized",
        investigation_id: INVESTIGATION_ID,
        studio_run_id: null,
        prediction_id: leadPrediction.id,
        detail: `Portfolio review session ${reviewSession.title} was finalized.`,
        metadata: {
          review_session_id: PORTFOLIO_REVIEW_SESSION_ID,
        },
        created_at: reviewSession.finalized_at ?? reviewSession.updated_at,
      }),
    ];

    for (const activity of activities) {
      await services.repository.saveWorkspaceActivity(activity);
    }

    console.log(
      JSON.stringify(
        {
          workspace: {
            id: workspace.id,
            slug: workspace.slug,
            name: workspace.name,
          },
          seeded_users: [
            {
              email: DEMO_ADMIN.email,
              password: DEMO_ADMIN.password,
              role: DEMO_ADMIN.role,
            },
            {
              email: DEMO_ANALYST.email,
              password: DEMO_ANALYST.password,
              role: DEMO_ANALYST.role,
            },
          ],
          demo_objects: {
            studio_run_id: STUDIO_RUN_ID,
            investigation_id: INVESTIGATION_ID,
            decision_brief_id: DECISION_BRIEF_ID,
            portfolio_candidate_id: PORTFOLIO_CANDIDATE_ID,
            portfolio_review_session_id: PORTFOLIO_REVIEW_SESSION_ID,
            lead_prediction_id: leadPrediction.id,
          },
          historical_memory: {
            ingested_cases: seededHistoricalLibrary.ingested_cases,
            stored_library_items: seededHistoricalLibrary.stored_library_items,
            reviewed_ingests: seededHistoricalLibrary.reviewed_ingests,
          },
          obsidian_export_hint: {
            app_url: process.env.FINANCE_SUPERBRAIN_APP_URL ?? "http://localhost:3000",
            export_root: process.env.OBSIDIAN_EXPORT_ROOT ?? "Finance Superbrain",
          },
        },
        null,
        2,
      ),
    );
  } finally {
    if (originalVoyageApiKey) {
      process.env.VOYAGE_API_KEY = originalVoyageApiKey;
    }
    await services?.marketDataProvider.close?.();
    await services?.embeddingProvider.close?.();
    await services?.repository.close?.();
  }
}

await main();
