"use client"

import type {
  PortfolioCandidate,
  PortfolioCandidateStatus,
  PortfolioDeskSummary,
} from "@finance-superbrain/schemas"

const DUE_SOON_WINDOW_MS = 1000 * 60 * 60 * 48
const STALE_FOLLOW_THROUGH_MS = 1000 * 60 * 60 * 24 * 7

export type PortfolioFollowThroughHealth =
  | "candidate"
  | "closed"
  | "due_now"
  | "due_soon"
  | "missing_cadence"
  | "on_cadence"
  | "stale_watching"
  | "trimmed_pending_followup"

export function formatPortfolioDateTime(value: string | null) {
  if (!value) {
    return "No review date set"
  }

  return new Date(value).toLocaleString()
}

export function formatPortfolioRelativeReviewState(value: string | null, nowTimestamp = Date.now()) {
  if (!value) {
    return "Review cadence not set"
  }

  const dueAt = Date.parse(value)
  const diffMinutes = Math.round((dueAt - nowTimestamp) / 60000)

  if (diffMinutes <= 0) {
    return "Review due now"
  }

  if (diffMinutes < 60) {
    return `Review due in ${diffMinutes}m`
  }

  const diffHours = Math.round(diffMinutes / 60)

  if (diffHours < 24) {
    return `Review due in ${diffHours}h`
  }

  const diffDays = Math.round(diffHours / 24)
  return `Review due in ${diffDays}d`
}

export function isLivePortfolioCandidateStatus(status: PortfolioCandidateStatus) {
  return status === "active" || status === "watching" || status === "trimmed"
}

export function isLivePortfolioCandidate(candidate: PortfolioCandidate) {
  return isLivePortfolioCandidateStatus(candidate.status)
}

export function isPortfolioReviewDueNow(candidate: PortfolioCandidate, nowTimestamp: number) {
  return Boolean(candidate.next_review_due_at && Date.parse(candidate.next_review_due_at) <= nowTimestamp)
}

export function isPortfolioReviewDueSoon(candidate: PortfolioCandidate, nowTimestamp: number, horizonHours = 48) {
  if (!isLivePortfolioCandidate(candidate) || !candidate.next_review_due_at) {
    return false
  }

  const dueAt = Date.parse(candidate.next_review_due_at)
  const horizon = nowTimestamp + 1000 * 60 * 60 * horizonHours
  return dueAt > nowTimestamp && dueAt <= horizon
}

export function isPortfolioFollowThroughStale(
  candidate: PortfolioCandidate,
  nowTimestamp: number,
  latestCheckpointAt?: string | null,
) {
  const latestTouchpointAt = latestCheckpointAt ?? candidate.updated_at
  return Date.parse(latestTouchpointAt) <= nowTimestamp - STALE_FOLLOW_THROUGH_MS
}

export function getPortfolioFollowThroughHealth(
  candidate: PortfolioCandidate,
  nowTimestamp: number,
  latestCheckpointAt?: string | null,
): PortfolioFollowThroughHealth {
  if (candidate.status === "closed") {
    return "closed"
  }

  if (candidate.status === "candidate") {
    return "candidate"
  }

  if (isPortfolioReviewDueNow(candidate, nowTimestamp)) {
    return "due_now"
  }

  if (isPortfolioReviewDueSoon(candidate, nowTimestamp, DUE_SOON_WINDOW_MS / (1000 * 60 * 60))) {
    return "due_soon"
  }

  if (candidate.status === "watching" && isPortfolioFollowThroughStale(candidate, nowTimestamp, latestCheckpointAt)) {
    return "stale_watching"
  }

  if (
    candidate.status === "trimmed" &&
    (!candidate.next_review_due_at || isPortfolioFollowThroughStale(candidate, nowTimestamp, latestCheckpointAt))
  ) {
    return "trimmed_pending_followup"
  }

  if (!candidate.next_review_due_at) {
    return "missing_cadence"
  }

  return "on_cadence"
}

export function sortPortfolioCandidates(candidates: PortfolioCandidate[]) {
  return [...candidates].sort((left, right) => {
    const leftDue = left.next_review_due_at ? Date.parse(left.next_review_due_at) : Number.POSITIVE_INFINITY
    const rightDue = right.next_review_due_at ? Date.parse(right.next_review_due_at) : Number.POSITIVE_INFINITY

    if (leftDue !== rightDue) {
      return leftDue - rightDue
    }

    return Date.parse(right.updated_at) - Date.parse(left.updated_at)
  })
}

function sortCountEntries<T extends { count: number }>(entries: T[], getLabel: (entry: T) => string) {
  return entries.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count
    }

    return getLabel(left).localeCompare(getLabel(right))
  })
}

export function buildPortfolioDeskSummaryFromCandidates(
  candidates: PortfolioCandidate[],
  userId: string | null,
  asOf = new Date().toISOString(),
): PortfolioDeskSummary {
  const liveCandidates = candidates.filter(isLivePortfolioCandidate)
  const openCandidates = candidates.filter((candidate) => candidate.status !== "closed")
  const themeCounts = new Map<string, number>()
  const assetCounts = new Map<string, number>()
  const convictionCounts = new Map<string, number>()

  for (const candidate of liveCandidates) {
    const themes = new Set([candidate.primary_theme, ...candidate.secondary_themes].filter(Boolean))

    for (const theme of themes) {
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1)
    }

    for (const asset of new Set(candidate.related_assets)) {
      assetCounts.set(asset, (assetCounts.get(asset) ?? 0) + 1)
    }

    convictionCounts.set(candidate.conviction_label, (convictionCounts.get(candidate.conviction_label) ?? 0) + 1)
  }

  return {
    counts: {
      total: candidates.length,
      candidate: candidates.filter((candidate) => candidate.status === "candidate").length,
      active: candidates.filter((candidate) => candidate.status === "active").length,
      watching: candidates.filter((candidate) => candidate.status === "watching").length,
      trimmed: candidates.filter((candidate) => candidate.status === "trimmed").length,
      closed: candidates.filter((candidate) => candidate.status === "closed").length,
      due_review: liveCandidates.filter(
        (candidate) => candidate.next_review_due_at !== null && candidate.next_review_due_at <= asOf,
      ).length,
      due_soon: liveCandidates.filter((candidate) => isPortfolioReviewDueSoon(candidate, Date.parse(asOf))).length,
      missing_cadence: liveCandidates.filter((candidate) => candidate.next_review_due_at === null).length,
      stale_watching: liveCandidates.filter(
        (candidate) => getPortfolioFollowThroughHealth(candidate, Date.parse(asOf)) === "stale_watching",
      ).length,
      trimmed_pending_followup: liveCandidates.filter(
        (candidate) => getPortfolioFollowThroughHealth(candidate, Date.parse(asOf)) === "trimmed_pending_followup",
      ).length,
      assigned_to_me: userId ? openCandidates.filter((candidate) => candidate.assignee_user_id === userId).length : 0,
      unassigned_live: liveCandidates.filter((candidate) => candidate.assignee_user_id === null).length,
    },
    exposure_by_theme: sortCountEntries(
      Array.from(themeCounts.entries()).map(([theme, count]) => ({ theme, count })),
      (entry) => entry.theme,
    ),
    exposure_by_asset: sortCountEntries(
      Array.from(assetCounts.entries()).map(([asset, count]) => ({ asset, count })),
      (entry) => entry.asset,
    ),
    conviction_by_label: sortCountEntries(
      Array.from(convictionCounts.entries()).map(([conviction_label, count]) => ({ conviction_label, count })),
      (entry) => entry.conviction_label,
    ),
  }
}
