import { describe, expect, it } from "vitest"

import {
  buildInvestigationCatalogCounts,
  filterInvestigationCatalog,
  getInvestigationCatalogFilter,
} from "@/lib/investigationCatalog"
import type { InvestigationTrail } from "@/lib/investigationTrail"

const trails: InvestigationTrail[] = [
  {
    id: "trail-1",
    title: "Fed draft",
    eventId: "event-1",
    predictionIds: [],
    updatedAt: "2026-04-01T01:00:00.000Z",
    steps: [
      {
        id: "studio_run:event-1",
        kind: "studio_run",
        status: "drafting",
        href: "/studio?run=event-1",
        title: "Draft saved",
        detail: "Event capture still needs storage.",
        updatedAt: "2026-04-01T01:00:00.000Z",
      },
    ],
  },
  {
    id: "trail-2",
    title: "CPI review",
    eventId: "event-2",
    predictionIds: ["prediction-2"],
    updatedAt: "2026-04-01T02:00:00.000Z",
    steps: [
      {
        id: "review_focus:prediction-2",
        kind: "review_focus",
        status: "under_review",
        href: "/accuracy?focus=prediction-2",
        title: "Review focus",
        detail: "Outcome notes still needed.",
        updatedAt: "2026-04-01T02:00:00.000Z",
      },
    ],
  },
  {
    id: "trail-3",
    title: "Bank lesson",
    eventId: "event-3",
    predictionIds: ["prediction-3"],
    updatedAt: "2026-04-01T03:00:00.000Z",
    steps: [
      {
        id: "library_lookup:prediction-3",
        kind: "library_lookup",
        status: "reviewed",
        href: "/library?trail=trail-3",
        title: "Library follow-up",
        detail: "Lesson retrieval is ready.",
        updatedAt: "2026-04-01T03:00:00.000Z",
      },
    ],
  },
]

describe("investigationCatalog", () => {
  it("maps trail statuses into catalog filters", () => {
    expect(getInvestigationCatalogFilter("drafting")).toBe("drafting")
    expect(getInvestigationCatalogFilter("ready_for_review")).toBe("awaiting_review")
    expect(getInvestigationCatalogFilter("under_review")).toBe("awaiting_review")
    expect(getInvestigationCatalogFilter("reviewed")).toBe("reviewed")
  })

  it("builds aggregate counts for the desk", () => {
    expect(buildInvestigationCatalogCounts(trails)).toEqual({
      total: 3,
      drafting: 1,
      awaitingReview: 1,
      reviewed: 1,
    })
  })

  it("filters trails by lane and free-text query", () => {
    expect(filterInvestigationCatalog(trails, { filter: "awaiting_review", query: "" })).toHaveLength(1)
    expect(filterInvestigationCatalog(trails, { filter: "all", query: "bank" })).toEqual([trails[2]])
    expect(filterInvestigationCatalog(trails, { filter: "all", query: "prediction-2" })).toEqual([trails[1]])
  })
})
