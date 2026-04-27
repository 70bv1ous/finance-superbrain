import { describe, expect, it } from "vitest"

import type { PortfolioCandidate, PortfolioCheckpoint, WorkspaceActivity } from "@finance-superbrain/schemas"

import {
  buildLatestPortfolioCandidateByDecisionBriefId,
  getPortfolioClosureSummary,
  getPortfolioPostureSummary,
} from "@/lib/portfolioRetrospective"

function buildCandidate(overrides: Partial<PortfolioCandidate> = {}): PortfolioCandidate {
  return {
    id: "candidate-1",
    workspace_id: "workspace-1",
    decision_brief_id: "brief-1",
    investigation_id: "investigation-1",
    lead_prediction_id: "prediction-1",
    title: "Energy shock portfolio candidate",
    summary: "Track the energy shock as a live portfolio posture.",
    status: "closed",
    priority: "high",
    sizing_label: "starter",
    risk_budget_label: "moderate",
    conviction_label: "high",
    primary_theme: "energy_shock",
    secondary_themes: ["inflation"],
    related_assets: ["XLE", "CL=F"],
    owner_user_id: "user-1",
    assignee_user_id: "user-1",
    last_actor_user_id: "user-1",
    next_review_due_at: null,
    closed_at: "2026-04-04T02:00:00.000Z",
    created_at: "2026-04-03T02:00:00.000Z",
    updated_at: "2026-04-04T02:00:00.000Z",
    ...overrides,
  }
}

function buildCheckpoint(overrides: Partial<PortfolioCheckpoint> = {}): PortfolioCheckpoint {
  return {
    id: "checkpoint-1",
    portfolio_candidate_id: "candidate-1",
    workspace_id: "workspace-1",
    actor_user_id: "user-1",
    summary: "The thesis resolved after the supply shock repriced as expected, so the candidate can close.",
    thesis_state: "resolved",
    action: "close",
    created_at: "2026-04-04T02:00:00.000Z",
    ...overrides,
  }
}

function buildActivity(overrides: Partial<WorkspaceActivity> = {}): WorkspaceActivity {
  return {
    id: "activity-1",
    workspace_id: "workspace-1",
    actor_user_id: "user-1",
    kind: "portfolio_checkpoint_saved",
    investigation_id: "investigation-1",
    studio_run_id: null,
    prediction_id: "prediction-1",
    detail: "Checkpoint saved for portfolio candidate Energy shock portfolio candidate.",
    metadata: {
      portfolio_candidate_id: "candidate-1",
      thesis_state: "invalidated",
    },
    created_at: "2026-04-04T02:00:00.000Z",
    ...overrides,
  }
}

describe("portfolioRetrospective helpers", () => {
  it("prefers the newest candidate for each decision brief", () => {
    const latest = buildCandidate({ id: "candidate-2", status: "active", updated_at: "2026-04-05T02:00:00.000Z" })
    const map = buildLatestPortfolioCandidateByDecisionBriefId([
      buildCandidate({ updated_at: "2026-04-03T02:00:00.000Z" }),
      latest,
    ])

    expect(map.get("brief-1")?.id).toBe("candidate-2")
  })

  it("builds a closure summary from checkpoints and falls back to activity metadata", () => {
    expect(
      getPortfolioClosureSummary({
        candidate: buildCandidate(),
        checkpoints: [buildCheckpoint()],
        activity: [
          buildActivity({
            id: "activity-close",
            kind: "portfolio_candidate_closed",
            metadata: {
              portfolio_candidate_id: "candidate-1",
              previous_status: "trimmed",
            },
          }),
        ],
      }),
    ).toEqual({
      label: "Closed as resolved",
      detail: "The thesis resolved after the supply shock repriced as expected, so the candidate can close.",
      closedAt: "2026-04-04T02:00:00.000Z",
      closedFrom: "Closed from trimmed",
    })

    expect(
      getPortfolioClosureSummary({
        candidate: buildCandidate(),
        checkpoints: [],
        activity: [buildActivity()],
      }),
    ).toEqual({
      label: "Closed as invalidated",
      detail: "Checkpoint saved for portfolio candidate Energy shock portfolio candidate.",
      closedAt: "2026-04-04T02:00:00.000Z",
      closedFrom: null,
    })
  })

  it("returns the compact posture summary for closed portfolio outcomes", () => {
    expect(getPortfolioPostureSummary(buildCandidate())).toEqual({
      priority: "high",
      sizing: "starter",
      conviction: "high",
      primaryTheme: "energy_shock",
    })
  })
})
