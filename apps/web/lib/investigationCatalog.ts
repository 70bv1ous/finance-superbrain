import { getTrailStatus, type InvestigationStatus, type InvestigationTrail } from "@/lib/investigationTrail"

export type InvestigationCatalogFilter = "all" | "drafting" | "awaiting_review" | "reviewed"

export type InvestigationCatalogCounts = {
  total: number
  drafting: number
  awaitingReview: number
  reviewed: number
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function toSearchableText(trail: InvestigationTrail) {
  return [
    trail.title,
    trail.eventId ?? "",
    ...trail.predictionIds,
    ...trail.steps.flatMap((step) => [step.title, step.detail, step.kind.replace(/_/g, " "), step.status.replace(/_/g, " ")]),
  ]
    .join(" ")
    .toLowerCase()
}

export function getInvestigationCatalogFilter(status: InvestigationStatus): InvestigationCatalogFilter {
  switch (status) {
    case "drafting":
      return "drafting"
    case "reviewed":
      return "reviewed"
    default:
      return "awaiting_review"
  }
}

export function buildInvestigationCatalogCounts(trails: InvestigationTrail[]): InvestigationCatalogCounts {
  return trails.reduce<InvestigationCatalogCounts>(
    (counts, trail) => {
      const filter = getInvestigationCatalogFilter(getTrailStatus(trail))
      counts.total += 1

      if (filter === "drafting") counts.drafting += 1
      if (filter === "awaiting_review") counts.awaitingReview += 1
      if (filter === "reviewed") counts.reviewed += 1

      return counts
    },
    {
      total: 0,
      drafting: 0,
      awaitingReview: 0,
      reviewed: 0,
    },
  )
}

export function filterInvestigationCatalog(
  trails: InvestigationTrail[],
  { filter, query }: { filter: InvestigationCatalogFilter; query: string },
) {
  const normalizedQuery = normalize(query)

  return trails.filter((trail) => {
    const statusFilter = getInvestigationCatalogFilter(getTrailStatus(trail))

    if (filter !== "all" && statusFilter !== filter) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    return toSearchableText(trail).includes(normalizedQuery)
  })
}
