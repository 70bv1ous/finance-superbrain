import { describe, expect, it } from "vitest"

import type { PortfolioCandidate } from "@finance-superbrain/schemas"

import {
  buildPortfolioDeskSummaryFromCandidates,
  formatPortfolioRelativeReviewState,
  getPortfolioFollowThroughHealth,
  isLivePortfolioCandidate,
  isPortfolioReviewDueSoon,
} from "@/lib/portfolioDesk"

function buildCandidate(overrides: Partial<PortfolioCandidate> = {}): PortfolioCandidate {
  return {
    id: "candidate-1",
    workspace_id: "11111111-1111-1111-1111-111111111111",
    decision_brief_id: "brief-1",
    investigation_id: "trail-1",
    lead_prediction_id: "22222222-2222-2222-2222-222222222222",
    title: "Cyclical basket candidate",
    summary: "Cyclical breadth remains constructive.",
    status: "active",
    priority: "high",
    sizing_label: "starter",
    risk_budget_label: "medium",
    conviction_label: "high-conviction",
    primary_theme: "cyclical-reflation",
    secondary_themes: ["industrial-breadth"],
    related_assets: ["XLI", "CAT"],
    owner_user_id: "33333333-3333-3333-3333-333333333333",
    assignee_user_id: "44444444-4444-4444-4444-444444444444",
    last_actor_user_id: "33333333-3333-3333-3333-333333333333",
    next_review_due_at: "2026-04-10T09:00:00.000Z",
    closed_at: null,
    updated_at: "2026-04-05T10:00:00.000Z",
    created_at: "2026-04-05T08:00:00.000Z",
    ...overrides,
  }
}

describe("portfolioDesk helpers", () => {
  it("builds deterministic counts and concentration summaries from live candidates", () => {
    const candidates = [
      buildCandidate(),
      buildCandidate({
        id: "candidate-2",
        decision_brief_id: "brief-2",
        title: "Transport breadth candidate",
        status: "watching",
        assignee_user_id: null,
        next_review_due_at: null,
        related_assets: ["XLI", "UNP"],
        secondary_themes: ["industrial-breadth", "transport-linkage"],
      }),
      buildCandidate({
        id: "candidate-3",
        decision_brief_id: "brief-3",
        status: "closed",
        closed_at: "2026-04-05T12:00:00.000Z",
        next_review_due_at: null,
      }),
    ]

    expect(buildPortfolioDeskSummaryFromCandidates(candidates, "44444444-4444-4444-4444-444444444444", "2026-04-11T00:00:00.000Z")).toEqual({
      counts: {
        total: 3,
        candidate: 0,
        active: 1,
        watching: 1,
        trimmed: 0,
        closed: 1,
        due_review: 1,
        due_soon: 0,
        missing_cadence: 1,
        stale_watching: 0,
        trimmed_pending_followup: 0,
        assigned_to_me: 1,
        unassigned_live: 1,
      },
      exposure_by_theme: [
        { theme: "cyclical-reflation", count: 2 },
        { theme: "industrial-breadth", count: 2 },
        { theme: "transport-linkage", count: 1 },
      ],
      exposure_by_asset: [
        { asset: "XLI", count: 2 },
        { asset: "CAT", count: 1 },
        { asset: "UNP", count: 1 },
      ],
      conviction_by_label: [{ conviction_label: "high-conviction", count: 2 }],
    })
  })

  it("formats cadence state and due-soon logic for live candidates", () => {
    const candidate = buildCandidate({
      next_review_due_at: "2026-04-05T13:00:00.000Z",
    })

    expect(isLivePortfolioCandidate(candidate)).toBe(true)
    expect(formatPortfolioRelativeReviewState(candidate.next_review_due_at, Date.parse("2026-04-05T12:00:00.000Z"))).toBe(
      "Review due in 1h",
    )
    expect(isPortfolioReviewDueSoon(candidate, Date.parse("2026-04-05T12:00:00.000Z"))).toBe(true)
    expect(
      isPortfolioReviewDueSoon(
        buildCandidate({
          status: "candidate",
          next_review_due_at: "2026-04-05T13:00:00.000Z",
        }),
        Date.parse("2026-04-05T12:00:00.000Z"),
      ),
    ).toBe(false)
  })

  it("classifies stale watching and trimmed follow-through pressure", () => {
    const asOf = Date.parse("2026-04-12T12:00:00.000Z")

    expect(
      getPortfolioFollowThroughHealth(
        buildCandidate({
          status: "watching",
          next_review_due_at: "2026-04-20T12:00:00.000Z",
          updated_at: "2026-04-01T12:00:00.000Z",
        }),
        asOf,
      ),
    ).toBe("stale_watching")

    expect(
      getPortfolioFollowThroughHealth(
        buildCandidate({
          status: "trimmed",
          next_review_due_at: null,
          updated_at: "2026-04-10T12:00:00.000Z",
        }),
        asOf,
      ),
    ).toBe("trimmed_pending_followup")

    expect(
      getPortfolioFollowThroughHealth(
        buildCandidate({
          status: "active",
          next_review_due_at: "2026-04-13T12:00:00.000Z",
          updated_at: "2026-04-11T12:00:00.000Z",
        }),
        asOf,
      ),
    ).toBe("due_soon")
  })
})
