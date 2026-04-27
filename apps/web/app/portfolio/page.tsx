"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"

import type {
  ListPortfolioReviewSessionsResponse,
  PortfolioCandidate,
  WorkspacePortfolioDeskResponse,
} from "@finance-superbrain/schemas"

import { AppShell } from "@/components/AppShell"
import { PortfolioStatusBadge } from "@/components/PortfolioStatusBadge"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import {
  assignPortfolioCandidate,
  listPortfolioReviewSessions,
  getPortfolioDesk,
  updatePortfolioCandidateStatus,
} from "@/lib/portfolioApi"
import {
  buildPortfolioDeskSummaryFromCandidates,
  formatPortfolioDateTime,
  formatPortfolioRelativeReviewState,
  getPortfolioFollowThroughHealth,
  isLivePortfolioCandidate,
  isPortfolioReviewDueNow,
  isPortfolioReviewDueSoon,
  sortPortfolioCandidates,
} from "@/lib/portfolioDesk"

type CandidatePriorityAction = {
  candidate: PortfolioCandidate
  title: string
  description: string
  label: string
  tone: "amber" | "cyan" | "emerald" | "blue"
}

function actionToneClasses(tone: CandidatePriorityAction["tone"]) {
  switch (tone) {
    case "amber":
      return "border-amber-500/25 bg-amber-500/10 text-amber-100"
    case "cyan":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-100"
    case "emerald":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
    default:
      return "border-blue-500/25 bg-blue-500/10 text-blue-100"
  }
}

function buildCandidatePriorityAction(candidate: PortfolioCandidate, nowTimestamp: number): CandidatePriorityAction {
  const health = getPortfolioFollowThroughHealth(candidate, nowTimestamp)

  if (isPortfolioReviewDueNow(candidate, nowTimestamp)) {
    return {
      candidate,
      title: "Due portfolio review",
      description: "This portfolio candidate is already due for follow-through and should be revisited before more exposure is promoted.",
      label: "Run due review",
      tone: "amber",
    }
  }

  if (isLivePortfolioCandidate(candidate) && !candidate.next_review_due_at) {
    return {
      candidate,
      title: "Missing review cadence",
      description: "A live portfolio candidate still has no next review date, which creates silent portfolio drift.",
      label: "Set cadence",
      tone: "amber",
    }
  }

  if (health === "stale_watching") {
    return {
      candidate,
      title: "Stale watching",
      description: "This watching candidate has gone too long without a checkpoint and needs an explicit rebalance decision.",
      label: "Refresh watch thesis",
      tone: "amber",
    }
  }

  if (health === "trimmed_pending_followup") {
    return {
      candidate,
      title: "Trimmed pending follow-up",
      description: "This trimmed candidate still needs closure or a new cadence so it does not linger as unresolved portfolio drag.",
      label: "Resolve trimmed posture",
      tone: "amber",
    }
  }

  if (isLivePortfolioCandidate(candidate) && !candidate.assignee_user_id) {
    return {
      candidate,
      title: "Needs portfolio owner",
      description: "This live candidate should be claimed before the desk absorbs more portfolio work.",
      label: "Take ownership",
      tone: "emerald",
    }
  }

  if (candidate.status === "candidate") {
    return {
      candidate,
      title: "Candidate waiting",
      description: "A promoted decision brief is waiting for activation, ownership, and explicit portfolio posture.",
      label: "Activate candidate",
      tone: "cyan",
    }
  }

  if (isPortfolioReviewDueSoon(candidate, nowTimestamp)) {
    return {
      candidate,
      title: "Due soon",
      description: "This live candidate is approaching its next review window and should be checked before it becomes overdue.",
      label: "Prepare review",
      tone: "cyan",
    }
  }

  return {
    candidate,
    title: "Live portfolio exposure",
    description: "This candidate is already live and should remain visible as part of the portfolio operating loop.",
    label: "Open candidate",
    tone: "blue",
  }
}

function getCandidateHealthLabel(candidate: PortfolioCandidate, nowTimestamp: number) {
  const health = getPortfolioFollowThroughHealth(candidate, nowTimestamp)

  switch (health) {
    case "due_now":
      return "Due now"
    case "due_soon":
      return "Due soon"
    case "stale_watching":
      return "Stale watching"
    case "trimmed_pending_followup":
      return "Trimmed pending follow-up"
    case "missing_cadence":
      return "Missing cadence"
    case "on_cadence":
      return "On cadence"
    case "candidate":
      return "Candidate"
    default:
      return "Closed"
  }
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
      <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">{label}</p>
      <p className="mt-3 text-4xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-zinc-500">{detail}</p>
    </div>
  )
}

function ExposureList<T extends { count: number }>({
  title,
  emptyTitle,
  emptyDescription,
  items,
  getLabel,
}: {
  title: string
  emptyTitle: string
  emptyDescription: string
  items: T[]
  getLabel: (item: T) => string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{title}</p>
      {items.length ? (
        <div className="mt-3 space-y-3">
          {items.slice(0, 4).map((item) => (
            <div key={`${title}:${getLabel(item)}`} className="flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-300">{getLabel(item)}</p>
              <span className="rounded-full border border-white/10 bg-zinc-950/70 px-2.5 py-1 text-[11px] text-zinc-400">
                {item.count}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <RouteEmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      )}
    </div>
  )
}

function CandidateCard({
  candidate,
  focused,
  latestCheckpointSummary,
  memberNameMap,
  nowTimestamp,
  userId,
  onAssignToMe,
  onUnassign,
  onStatusChange,
}: {
  candidate: PortfolioCandidate
  focused: boolean
  latestCheckpointSummary?: string | null
  memberNameMap: Map<string, string>
  nowTimestamp: number
  userId: string | null
  onAssignToMe: (candidate: PortfolioCandidate) => void
  onUnassign: (candidate: PortfolioCandidate) => void
  onStatusChange: (candidate: PortfolioCandidate, status: PortfolioCandidate["status"]) => void
}) {
  return (
    <div
      className={[
        "rounded-[24px] border bg-white/5 p-5 transition-colors",
        focused ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Portfolio candidate</p>
          <h3 className="mt-2 font-display text-lg font-semibold text-white">{candidate.title}</h3>
        </div>
        <PortfolioStatusBadge status={candidate.status} />
      </div>

      <p className="mt-4 text-sm leading-7 text-zinc-300">{candidate.summary}</p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Portfolio posture</p>
          <p className="mt-2 text-sm text-zinc-300">
            {candidate.priority} priority | {candidate.sizing_label} sizing
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            {candidate.risk_budget_label} risk | {candidate.conviction_label} conviction
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Primary theme {candidate.primary_theme}
            {candidate.secondary_themes.length ? ` | Secondary ${candidate.secondary_themes.join(", ")}` : ""}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Ownership and cadence</p>
          <p className="mt-2 text-sm text-zinc-300">
            Owner {memberNameMap.get(candidate.owner_user_id) ?? "Unknown teammate"}
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            Assignee {candidate.assignee_user_id ? memberNameMap.get(candidate.assignee_user_id) ?? "Unknown teammate" : "Unassigned"}
          </p>
          <p className="mt-2 text-xs text-zinc-500">{formatPortfolioDateTime(candidate.next_review_due_at)}</p>
          <p className="mt-1 text-xs text-zinc-500">{formatPortfolioRelativeReviewState(candidate.next_review_due_at)}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.24em] text-zinc-500">
            {getCandidateHealthLabel(candidate, nowTimestamp)}
          </p>
          {latestCheckpointSummary ? <p className="mt-2 text-xs text-zinc-500">{latestCheckpointSummary}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/portfolio/${candidate.id}`}
          className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
        >
          Open candidate
        </Link>
        <Link
          href={`/decisions/${candidate.decision_brief_id}`}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
        >
          Open brief
        </Link>
        <Link
          href={`/predictions/${candidate.lead_prediction_id}`}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
        >
          Lead prediction
        </Link>
        {candidate.assignee_user_id !== userId ? (
          <button
            type="button"
            onClick={() => onAssignToMe(candidate)}
            className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50"
          >
            Assign to me
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onUnassign(candidate)}
            className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
          >
            Unassign
          </button>
        )}
        {candidate.status === "candidate" ? (
          <button
            type="button"
            onClick={() => onStatusChange(candidate, "active")}
            className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
          >
            Mark active
          </button>
        ) : null}
        {candidate.status === "active" ? (
          <button
            type="button"
            onClick={() => onStatusChange(candidate, "watching")}
            className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-100 transition-colors hover:border-amber-400/40 hover:text-amber-50"
          >
            Move to watching
          </button>
        ) : null}
        {(candidate.status === "active" || candidate.status === "watching") ? (
          <button
            type="button"
            onClick={() => onStatusChange(candidate, "trimmed")}
            className="rounded-full border border-blue-500/25 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-blue-100 transition-colors hover:border-blue-400/40 hover:text-blue-50"
          >
            Mark trimmed
          </button>
        ) : null}
        {candidate.status !== "closed" ? (
          <button
            type="button"
            onClick={() => onStatusChange(candidate, "closed")}
            className="rounded-full border border-zinc-500/25 bg-zinc-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-200 transition-colors hover:border-zinc-400/40 hover:text-white"
          >
            Close
          </button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {candidate.related_assets.map((asset) => (
          <span key={`${candidate.id}:${asset}`} className="rounded-full border border-white/10 bg-zinc-950/70 px-2.5 py-1 text-[11px] text-zinc-400">
            {asset}
          </span>
        ))}
      </div>
    </div>
  )
}

function CandidateSection({
  title,
  eyebrow,
  candidates,
  focusedCandidateId,
  latestCheckpointSummaryByCandidateId,
  memberNameMap,
  nowTimestamp,
  userId,
  onAssignToMe,
  onUnassign,
  onStatusChange,
}: {
  title: string
  eyebrow: string
  candidates: PortfolioCandidate[]
  focusedCandidateId: string | null
  latestCheckpointSummaryByCandidateId: Map<string, string>
  memberNameMap: Map<string, string>
  nowTimestamp: number
  userId: string | null
  onAssignToMe: (candidate: PortfolioCandidate) => void
  onUnassign: (candidate: PortfolioCandidate) => void
  onStatusChange: (candidate: PortfolioCandidate, status: PortfolioCandidate["status"]) => void
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
      <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">{eyebrow}</p>
      <h2 className="mt-2 font-display text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4 space-y-4">
        {candidates.length ? (
          candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              focused={focusedCandidateId === candidate.id}
              latestCheckpointSummary={latestCheckpointSummaryByCandidateId.get(candidate.id) ?? null}
              memberNameMap={memberNameMap}
              nowTimestamp={nowTimestamp}
              userId={userId}
              onAssignToMe={onAssignToMe}
              onUnassign={onUnassign}
              onStatusChange={onStatusChange}
            />
          ))
        ) : (
          <RouteEmptyState
            title={`No ${title.toLowerCase()} yet`}
            description="This lane will populate as decision briefs are promoted into the portfolio layer."
          />
        )}
      </div>
    </section>
  )
}

function PortfolioPageContent() {
  const searchParams = useSearchParams()
  const focusedCandidateId = searchParams.get("focus")
  const { activity, members, portfolioCandidates, refreshWorkspace, user } = useWorkspace()
  const [desk, setDesk] = useState<WorkspacePortfolioDeskResponse | null>(null)
  const [reviewSessions, setReviewSessions] = useState<ListPortfolioReviewSessionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [nowTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let active = true

    void Promise.all([getPortfolioDesk(), listPortfolioReviewSessions()])
      .then(([nextDesk, nextReviewSessions]) => {
        if (active) {
          setDesk(nextDesk)
          setReviewSessions(nextReviewSessions)
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const memberNameMap = useMemo(
    () => new Map(members.map((entry) => [entry.user.id, entry.user.display_name])),
    [members],
  )
  const latestCheckpointSummaryByCandidateId = useMemo(
    () => {
      const latestByCandidateId = new Map<string, { createdAt: string; detail: string }>()

      for (const event of activity) {
        if (event.kind !== "portfolio_checkpoint_saved") {
          continue
        }

        const candidateId = typeof event.metadata.portfolio_candidate_id === "string" ? event.metadata.portfolio_candidate_id : null

        if (!candidateId) {
          continue
        }

        const current = latestByCandidateId.get(candidateId)

        if (!current || Date.parse(event.created_at) > Date.parse(current.createdAt)) {
          latestByCandidateId.set(candidateId, { createdAt: event.created_at, detail: event.detail })
        }
      }

      return new Map(Array.from(latestByCandidateId.entries()).map(([candidateId, value]) => [candidateId, value.detail]))
    },
    [activity],
  )

  const grouped = useMemo<WorkspacePortfolioDeskResponse>(() => {
    if (desk) {
      return desk
    }

    return {
      candidate_briefs: portfolioCandidates.filter((candidate) => candidate.status === "candidate").slice(0, 12),
      active_candidates: portfolioCandidates.filter((candidate) => isLivePortfolioCandidate(candidate)).slice(0, 12),
      due_review_candidates: portfolioCandidates.filter((candidate) => isPortfolioReviewDueNow(candidate, nowTimestamp)).slice(0, 12),
      recently_closed_candidates: portfolioCandidates.filter((candidate) => candidate.status === "closed").slice(0, 12),
      summary: buildPortfolioDeskSummaryFromCandidates(portfolioCandidates, user?.id ?? null, new Date(nowTimestamp).toISOString()),
    }
  }, [desk, nowTimestamp, portfolioCandidates, user?.id])

  const summary = grouped.summary
  const candidateBriefs = useMemo(() => sortPortfolioCandidates(grouped.candidate_briefs), [grouped.candidate_briefs])
  const activeCandidates = useMemo(
    () => sortPortfolioCandidates(grouped.active_candidates.filter((candidate) => candidate.status === "active")),
    [grouped.active_candidates],
  )
  const watchingCandidates = useMemo(
    () => sortPortfolioCandidates(grouped.active_candidates.filter((candidate) => candidate.status === "watching" || candidate.status === "trimmed")),
    [grouped.active_candidates],
  )
  const dueReviewCandidates = useMemo(() => sortPortfolioCandidates(grouped.due_review_candidates), [grouped.due_review_candidates])
  const closedCandidates = useMemo(() => sortPortfolioCandidates(grouped.recently_closed_candidates), [grouped.recently_closed_candidates])
  const unassignedLiveCandidates = useMemo(
    () => sortPortfolioCandidates(portfolioCandidates.filter((candidate) => isLivePortfolioCandidate(candidate) && !candidate.assignee_user_id)).slice(0, 12),
    [portfolioCandidates],
  )
  const missingCadenceCandidates = useMemo(
    () => sortPortfolioCandidates(portfolioCandidates.filter((candidate) => isLivePortfolioCandidate(candidate) && !candidate.next_review_due_at)).slice(0, 12),
    [portfolioCandidates],
  )
  const dueSoonCandidates = useMemo(
    () => sortPortfolioCandidates(portfolioCandidates.filter((candidate) => isPortfolioReviewDueSoon(candidate, nowTimestamp))).slice(0, 12),
    [nowTimestamp, portfolioCandidates],
  )
  const staleWatchingCandidates = useMemo(
    () =>
      sortPortfolioCandidates(
        portfolioCandidates.filter((candidate) => getPortfolioFollowThroughHealth(candidate, nowTimestamp) === "stale_watching"),
      ).slice(0, 12),
    [nowTimestamp, portfolioCandidates],
  )
  const trimmedPendingCandidates = useMemo(
    () =>
      sortPortfolioCandidates(
        portfolioCandidates.filter(
          (candidate) => getPortfolioFollowThroughHealth(candidate, nowTimestamp) === "trimmed_pending_followup",
        ),
      ).slice(0, 12),
    [nowTimestamp, portfolioCandidates],
  )
  const portfolioPriorityActions = useMemo(
    () =>
      sortPortfolioCandidates(
        Array.from(
          new Map(
            [
              ...dueReviewCandidates,
              ...missingCadenceCandidates,
              ...staleWatchingCandidates,
              ...trimmedPendingCandidates,
              ...unassignedLiveCandidates,
              ...candidateBriefs,
              ...dueSoonCandidates,
              ...activeCandidates,
              ...watchingCandidates,
            ].map((candidate) => [candidate.id, candidate]),
          ).values(),
        ),
      )
        .map((candidate) => buildCandidatePriorityAction(candidate, nowTimestamp))
        .slice(0, 5),
    [
      activeCandidates,
      candidateBriefs,
      dueReviewCandidates,
      dueSoonCandidates,
      missingCadenceCandidates,
      nowTimestamp,
      staleWatchingCandidates,
      trimmedPendingCandidates,
      unassignedLiveCandidates,
      watchingCandidates,
    ],
  )
  const primaryDeskAction = portfolioPriorityActions[0] ?? null
  const secondaryDeskActions = portfolioPriorityActions.slice(1)

  const handleRefresh = async () => {
    const [nextDesk, nextReviewSessions] = await Promise.all([getPortfolioDesk(), listPortfolioReviewSessions(), refreshWorkspace()])
    setDesk(nextDesk)
    setReviewSessions(nextReviewSessions)
  }

  const handleAssignToMe = async (candidate: PortfolioCandidate) => {
    if (!user) {
      return
    }

    await assignPortfolioCandidate(candidate.id, { assignee_user_id: user.id })
    await handleRefresh()
  }

  const handleUnassign = async (candidate: PortfolioCandidate) => {
    await assignPortfolioCandidate(candidate.id, { assignee_user_id: null })
    await handleRefresh()
  }

  const handleStatusChange = async (candidate: PortfolioCandidate, status: PortfolioCandidate["status"]) => {
    await updatePortfolioCandidateStatus(candidate.id, {
      status,
      next_review_due_at: status === "closed" ? null : candidate.next_review_due_at,
    })
    await handleRefresh()
  }

  return (
    <AppShell
      eyebrow="Phase 8 foundation"
      title="Portfolio desk"
      subtitle="Coordinate multiple live theses together so promoted decision briefs become a shared portfolio operating surface."
    >
      {loading ? (
        <RouteLoadingState
          title="Loading portfolio desk"
          description="Restoring promoted portfolio candidates, live exposure posture, and due reviews from the shared workspace."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <SummaryCard
              label="All candidates"
              value={String(summary.counts.total)}
              detail="Decision briefs already promoted into the portfolio layer."
            />
            <SummaryCard
              label="New candidates"
              value={String(summary.counts.candidate)}
              detail="Recently promoted briefs still waiting for live portfolio posture."
            />
            <SummaryCard
              label="Active"
              value={String(summary.counts.active)}
              detail="Candidates actively carrying portfolio attention and review discipline."
            />
            <SummaryCard
              label="Watching or trimmed"
              value={String(summary.counts.watching + summary.counts.trimmed)}
              detail="Candidates being monitored more cautiously after activation."
            />
            <SummaryCard
              label="Due review"
              value={String(summary.counts.due_review)}
              detail="Portfolio candidates whose next review date is already due."
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Desk command</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">What needs portfolio action now</h2>
              <div className="mt-4 space-y-4">
                {primaryDeskAction ? (
                  <div className={`rounded-[24px] border p-5 ${actionToneClasses(primaryDeskAction.tone)}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-current/70">{primaryDeskAction.title}</p>
                        <h3 className="mt-2 font-display text-lg font-semibold text-white">{primaryDeskAction.candidate.title}</h3>
                      </div>
                      <PortfolioStatusBadge status={primaryDeskAction.candidate.status} />
                    </div>
                    <p className="mt-4 text-sm leading-7 text-current/80">{primaryDeskAction.description}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.24em] text-current/70">
                      <span>{primaryDeskAction.candidate.assignee_user_id ? memberNameMap.get(primaryDeskAction.candidate.assignee_user_id) ?? "Unknown teammate" : "Unassigned"}</span>
                      <span>|</span>
                      <span>{formatPortfolioRelativeReviewState(primaryDeskAction.candidate.next_review_due_at, nowTimestamp)}</span>
                      <span>|</span>
                      <span>{primaryDeskAction.candidate.priority} priority</span>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Link
                        href={`/portfolio/${primaryDeskAction.candidate.id}`}
                        className="rounded-full border border-current/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-current transition-colors hover:border-current/40"
                      >
                        {primaryDeskAction.label}
                      </Link>
                      <Link
                        href={`/decisions/${primaryDeskAction.candidate.decision_brief_id}`}
                        className="rounded-full border border-current/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-current transition-colors hover:border-current/40"
                      >
                        Open brief
                      </Link>
                    </div>
                  </div>
                ) : (
                  <RouteEmptyState
                    title="No urgent portfolio action"
                    description="Portfolio command will surface the highest-priority candidate here once live exposure pressure appears."
                  />
                )}

                {secondaryDeskActions.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {secondaryDeskActions.map((action) => (
                      <div key={action.candidate.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{action.title}</p>
                            <p className="mt-2 text-sm font-medium text-white">{action.candidate.title}</p>
                          </div>
                          <PortfolioStatusBadge status={action.candidate.status} />
                        </div>
                        <p className="mt-3 text-xs leading-6 text-zinc-400">{action.description}</p>
                        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          <span>{action.label}</span>
                          <Link
                            href={`/portfolio/${action.candidate.id}`}
                            className="text-zinc-300 transition-colors hover:text-white"
                          >
                            Open
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Portfolio pressure</p>
                  <h2 className="mt-2 font-display text-lg font-semibold text-white">Exposure hygiene</h2>
                </div>
                <Link
                  href="/portfolio/reviews"
                  className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
                >
                  Portfolio reviews
                </Link>
              </div>
              <div className="mt-4 grid gap-3">
                <ExposureList
                  title="Theme concentration"
                  emptyTitle="No live theme overlap"
                  emptyDescription="Theme concentration will appear once live candidates share overlapping macro posture."
                  items={summary.exposure_by_theme}
                  getLabel={(item) => item.theme}
                />
                <ExposureList
                  title="Asset concentration"
                  emptyTitle="No live asset overlap"
                  emptyDescription="Asset overlap will appear once live candidates cluster around the same instruments."
                  items={summary.exposure_by_asset}
                  getLabel={(item) => item.asset}
                />
                <ExposureList
                  title="Conviction distribution"
                  emptyTitle="No live conviction posture"
                  emptyDescription="Conviction labels will populate once live candidates are actively carrying portfolio posture."
                  items={summary.conviction_by_label}
                  getLabel={(item) => item.conviction_label}
                />
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Cadence hygiene</p>
                  <div className="mt-3 space-y-3 text-sm text-zinc-300">
                    <p>
                      {summary.counts.assigned_to_me
                        ? `${summary.counts.assigned_to_me} open portfolio candidate${summary.counts.assigned_to_me === 1 ? "" : "s"} currently sit in your lane.`
                        : "No open portfolio candidates are directly assigned to you right now."}
                    </p>
                    <p>
                      {summary.counts.unassigned_live
                        ? `${summary.counts.unassigned_live} live candidate${summary.counts.unassigned_live === 1 ? "" : "s"} still need an assignee.`
                        : "All live candidates currently have explicit ownership."}
                    </p>
                    <p>
                      {summary.counts.missing_cadence
                        ? `${summary.counts.missing_cadence} live candidate${summary.counts.missing_cadence === 1 ? "" : "s"} still have no next review date.`
                        : "All live candidates already carry explicit follow-through cadence."}
                    </p>
                    <p>
                      {dueSoonCandidates.length
                        ? `${dueSoonCandidates.length} live candidate${dueSoonCandidates.length === 1 ? "" : "s"} are approaching review pressure within 48 hours.`
                        : "No live candidates are approaching review pressure in the next two days."}
                    </p>
                    <p>
                      {summary.counts.stale_watching
                        ? `${summary.counts.stale_watching} watching candidate${summary.counts.stale_watching === 1 ? "" : "s"} have gone stale without checkpoint follow-through.`
                        : "Watching candidates still have recent enough follow-through right now."}
                    </p>
                    <p>
                      {summary.counts.trimmed_pending_followup
                        ? `${summary.counts.trimmed_pending_followup} trimmed candidate${summary.counts.trimmed_pending_followup === 1 ? "" : "s"} still need closure or a clearer next step.`
                        : "Trimmed candidates are either closed cleanly or still carrying explicit follow-up."}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Review sessions</p>
                <h2 className="mt-2 font-display text-lg font-semibold text-white">Portfolio-wide judgment history</h2>
              </div>
              <Link
                href="/portfolio/reviews"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Open review workspace
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {reviewSessions?.sessions.length ? (
                reviewSessions.sessions.slice(0, 3).map((entry) => (
                  <div key={entry.session.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{entry.session.title}</p>
                        <p className="mt-2 text-sm text-zinc-400">{entry.session.summary}</p>
                      </div>
                      <Link
                        href={`/portfolio/reviews/${entry.session.id}`}
                        className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
                      >
                        Open review
                      </Link>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                      <span>{entry.session.status.replace(/_/g, " ")}</span>
                      <span>{entry.item_count} candidates</span>
                      <span>{entry.proposal_count} proposals</span>
                      <span>{entry.unresolved_count} unresolved</span>
                    </div>
                  </div>
                ))
              ) : (
                <RouteEmptyState
                  title="No review sessions yet"
                  description="Portfolio reviews will appear here once the team snapshots the portfolio and starts saving rebalance proposals."
                />
              )}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <CandidateSection
              title="Due review"
              eyebrow="Portfolio cadence"
              candidates={dueReviewCandidates}
              focusedCandidateId={focusedCandidateId}
              latestCheckpointSummaryByCandidateId={latestCheckpointSummaryByCandidateId}
              memberNameMap={memberNameMap}
              nowTimestamp={nowTimestamp}
              userId={user?.id ?? null}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onStatusChange={handleStatusChange}
            />

            <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Portfolio workflow</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">Operating posture</h2>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Candidate</p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Newly promoted briefs should get ownership, sizing posture, and risk framing before they are treated as active portfolio work.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Active</p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Active candidates should carry explicit cadence so the team can monitor overlap, concentration, and review pressure.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Watching or trimmed</p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Watching candidates should either be refreshed or reactivated, while trimmed candidates should be stabilized, kept trimmed with cadence, or closed cleanly.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Closed</p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Closed candidates become portfolio outcomes and should feed later retrospective learning rather than stay in the live exposure set.
                  </p>
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <CandidateSection
              title="Candidate briefs"
              eyebrow="New promotions"
              candidates={candidateBriefs}
              focusedCandidateId={focusedCandidateId}
              latestCheckpointSummaryByCandidateId={latestCheckpointSummaryByCandidateId}
              memberNameMap={memberNameMap}
              nowTimestamp={nowTimestamp}
              userId={user?.id ?? null}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onStatusChange={handleStatusChange}
            />
            <CandidateSection
              title="Active candidates"
              eyebrow="Live exposure"
              candidates={activeCandidates}
              focusedCandidateId={focusedCandidateId}
              latestCheckpointSummaryByCandidateId={latestCheckpointSummaryByCandidateId}
              memberNameMap={memberNameMap}
              nowTimestamp={nowTimestamp}
              userId={user?.id ?? null}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onStatusChange={handleStatusChange}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <CandidateSection
              title="Due soon"
              eyebrow="Rebalance window"
              candidates={dueSoonCandidates}
              focusedCandidateId={focusedCandidateId}
              latestCheckpointSummaryByCandidateId={latestCheckpointSummaryByCandidateId}
              memberNameMap={memberNameMap}
              nowTimestamp={nowTimestamp}
              userId={user?.id ?? null}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onStatusChange={handleStatusChange}
            />
            <CandidateSection
              title="Stale watching"
              eyebrow="Watchlist drift"
              candidates={staleWatchingCandidates}
              focusedCandidateId={focusedCandidateId}
              latestCheckpointSummaryByCandidateId={latestCheckpointSummaryByCandidateId}
              memberNameMap={memberNameMap}
              nowTimestamp={nowTimestamp}
              userId={user?.id ?? null}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onStatusChange={handleStatusChange}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <CandidateSection
              title="Trimmed pending follow-up"
              eyebrow="Rebalance cleanup"
              candidates={trimmedPendingCandidates}
              focusedCandidateId={focusedCandidateId}
              latestCheckpointSummaryByCandidateId={latestCheckpointSummaryByCandidateId}
              memberNameMap={memberNameMap}
              nowTimestamp={nowTimestamp}
              userId={user?.id ?? null}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onStatusChange={handleStatusChange}
            />
            <CandidateSection
              title="Recently closed"
              eyebrow="Portfolio outcomes"
              candidates={closedCandidates}
              focusedCandidateId={focusedCandidateId}
              latestCheckpointSummaryByCandidateId={latestCheckpointSummaryByCandidateId}
              memberNameMap={memberNameMap}
              nowTimestamp={nowTimestamp}
              userId={user?.id ?? null}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onStatusChange={handleStatusChange}
            />
          </div>
        </div>
      )}
    </AppShell>
  )
}

export default function PortfolioPage() {
  return (
    <Suspense
      fallback={
        <AppShell
          eyebrow="Phase 8 foundation"
          title="Portfolio desk"
          subtitle="Coordinate multiple live theses together so promoted decision briefs become a shared portfolio operating surface."
        >
          <RouteLoadingState
            title="Loading portfolio desk"
            description="Restoring promoted portfolio candidates, live exposure posture, and due reviews from the shared workspace."
          />
        </AppShell>
      }
    >
      <PortfolioPageContent />
    </Suspense>
  )
}
