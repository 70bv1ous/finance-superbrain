import { describe, expect, it } from "vitest"

import type { WorkspaceActivity } from "@finance-superbrain/schemas"

import {
  formatWorkspaceActivityKind,
  getWorkspaceActivityDecisionBriefId,
  getWorkspaceActivityPortfolioCandidateId,
  getWorkspaceActivityReviewSessionId,
  getWorkspaceActivityReferences,
  isDecisionActivity,
  isPortfolioActivity,
} from "@/lib/workspaceActivity"

function buildActivity(overrides: Partial<WorkspaceActivity> = {}): WorkspaceActivity {
  return {
    id: "activity-1",
    workspace_id: "workspace-1",
    actor_user_id: "user-1",
    kind: "decision_brief_status_changed",
    detail: "Decision brief moved to active.",
    created_at: "2026-04-03T10:00:00.000Z",
    metadata: {
      decision_brief_id: "brief-1",
      portfolio_candidate_id: "candidate-1",
      review_session_id: "review-1",
    },
    investigation_id: "investigation-1",
    prediction_id: "prediction-1",
    studio_run_id: "run-1",
    ...overrides,
  }
}

describe("workspaceActivity helpers", () => {
  it("identifies decision activity and extracts references", () => {
    const activity = buildActivity()

    expect(isDecisionActivity(activity)).toBe(true)
    expect(isPortfolioActivity(activity)).toBe(false)
    expect(getWorkspaceActivityDecisionBriefId(activity)).toBe("brief-1")
    expect(getWorkspaceActivityPortfolioCandidateId(activity)).toBe("candidate-1")
    expect(getWorkspaceActivityReviewSessionId(activity)).toBe("review-1")
    expect(getWorkspaceActivityReferences(activity)).toEqual([
      { label: "Investigation", href: "/investigations" },
      { label: "Prediction", href: "/predictions/prediction-1" },
      { label: "Decision brief", href: "/decisions/brief-1" },
      { label: "Portfolio candidate", href: "/portfolio/candidate-1" },
      { label: "Portfolio review", href: "/portfolio/reviews/review-1" },
      { label: "Studio run", href: "/studio?run=run-1" },
    ])
  })

  it("formats activity kinds and ignores non-decision metadata when absent", () => {
    const activity = buildActivity({
      kind: "portfolio_candidate_status_changed",
      metadata: {
        portfolio_candidate_id: "candidate-9",
      },
      investigation_id: null,
      prediction_id: null,
      studio_run_id: null,
    })

    expect(isDecisionActivity(activity)).toBe(false)
    expect(isPortfolioActivity(activity)).toBe(true)
    expect(formatWorkspaceActivityKind(activity.kind)).toBe("portfolio candidate status changed")
    expect(getWorkspaceActivityDecisionBriefId(activity)).toBeNull()
    expect(getWorkspaceActivityPortfolioCandidateId(activity)).toBe("candidate-9")
    expect(getWorkspaceActivityReviewSessionId(activity)).toBeNull()
    expect(getWorkspaceActivityReferences(activity)).toEqual([
      { label: "Portfolio candidate", href: "/portfolio/candidate-9" },
    ])
  })
})
