import { describe, expect, it } from "vitest"

import type { DecisionBrief, DecisionCheckpoint, WorkspaceActivity } from "@finance-superbrain/schemas"

import { getDecisionClosureSummary } from "@/lib/decisionRetrospective"

function buildBrief(overrides: Partial<DecisionBrief> = {}): DecisionBrief {
  return {
    id: "brief-1",
    workspace_id: "workspace-1",
    investigation_id: "investigation-1",
    lead_prediction_id: "prediction-1",
    title: "CPI surprise brief",
    summary: "Track the CPI surprise thesis through closure.",
    thesis: "Inflation surprise should keep front-end yields bid.",
    scenario: "Hot CPI and hawkish repricing.",
    confidence_label: "high",
    key_assets: ["SPY", "US2Y"],
    triggers: ["Hot CPI print"],
    invalidations: ["Soft CPI surprise"],
    status: "closed",
    owner_user_id: "user-1",
    assignee_user_id: "user-1",
    last_actor_user_id: "user-1",
    next_review_due_at: null,
    closed_at: "2026-04-03T01:00:00.000Z",
    created_at: "2026-04-02T01:00:00.000Z",
    updated_at: "2026-04-03T01:00:00.000Z",
    ...overrides,
  }
}

function buildCheckpoint(overrides: Partial<DecisionCheckpoint> = {}): DecisionCheckpoint {
  return {
    id: "checkpoint-1",
    decision_brief_id: "brief-1",
    workspace_id: "workspace-1",
    actor_user_id: "user-1",
    summary: "The inflation thesis resolved cleanly after the market repriced as expected.",
    thesis_state: "resolved",
    action: "close",
    created_at: "2026-04-03T01:00:00.000Z",
    ...overrides,
  }
}

function buildActivity(overrides: Partial<WorkspaceActivity> = {}): WorkspaceActivity {
  return {
    id: "activity-1",
    workspace_id: "workspace-1",
    actor_user_id: "user-1",
    kind: "decision_checkpoint_saved",
    investigation_id: "investigation-1",
    studio_run_id: null,
    prediction_id: "prediction-1",
    detail: "Checkpoint saved for decision brief CPI surprise brief.",
    metadata: {
      decision_brief_id: "brief-1",
      thesis_state: "invalidated",
    },
    created_at: "2026-04-03T01:00:00.000Z",
    ...overrides,
  }
}

describe("getDecisionClosureSummary", () => {
  it("prefers the latest checkpoint summary for closed briefs", () => {
    const summary = getDecisionClosureSummary({
      brief: buildBrief(),
      checkpoints: [buildCheckpoint()],
      activity: [],
    })

    expect(summary).toEqual({
      label: "Closed as resolved",
      detail: "The inflation thesis resolved cleanly after the market repriced as expected.",
      closedAt: "2026-04-03T01:00:00.000Z",
    })
  })

  it("falls back to activity metadata when checkpoint records are unavailable", () => {
    const summary = getDecisionClosureSummary({
      brief: buildBrief(),
      checkpoints: [],
      activity: [buildActivity()],
    })

    expect(summary).toEqual({
      label: "Closed as invalidated",
      detail: "Checkpoint saved for decision brief CPI surprise brief.",
      closedAt: "2026-04-03T01:00:00.000Z",
    })
  })
})
