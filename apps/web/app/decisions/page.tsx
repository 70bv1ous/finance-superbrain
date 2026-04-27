"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import type { DecisionBrief, PortfolioCandidate, WorkspaceDecisionDeskResponse } from "@finance-superbrain/schemas"

import { AppShell } from "@/components/AppShell"
import { DecisionStatusBadge } from "@/components/DecisionStatusBadge"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import { assignDecisionBrief, getDecisionDesk, updateDecisionBriefStatus } from "@/lib/decisionApi"

function formatDateTime(value: string | null) {
  if (!value) {
    return "No review date set"
  }

  return new Date(value).toLocaleString()
}

function formatRelativeReviewState(value: string | null) {
  if (!value) {
    return "Review cadence not set"
  }

  const dueAt = Date.parse(value)
  const diffMinutes = Math.round((dueAt - Date.now()) / 60000)

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

function isLiveBrief(brief: DecisionBrief) {
  return brief.status === "active" || brief.status === "watching"
}

function isDueSoon(brief: DecisionBrief, nowTimestamp: number) {
  if (!isLiveBrief(brief) || !brief.next_review_due_at) {
    return false
  }

  const dueAt = Date.parse(brief.next_review_due_at)
  const horizon = nowTimestamp + 1000 * 60 * 60 * 48

  return dueAt > nowTimestamp && dueAt <= horizon
}

function isReviewDueNow(brief: DecisionBrief, nowTimestamp: number) {
  return Boolean(brief.next_review_due_at && Date.parse(brief.next_review_due_at) <= nowTimestamp)
}

function isStaleLiveBrief(brief: DecisionBrief, nowTimestamp: number) {
  if (!isLiveBrief(brief) || isReviewDueNow(brief, nowTimestamp)) {
    return false
  }

  const staleHours = brief.status === "active" ? 72 : 120
  return Date.parse(brief.updated_at) <= nowTimestamp - staleHours * 60 * 60 * 1000
}

function describeUpdatedAgo(value: string, nowTimestamp: number) {
  const diffMinutes = Math.max(1, Math.round((nowTimestamp - Date.parse(value)) / 60000))

  if (diffMinutes < 60) {
    return `Updated ${diffMinutes}m ago`
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`
  }

  const diffDays = Math.round(diffHours / 24)
  return `Updated ${diffDays}d ago`
}

function sortBriefs(briefs: DecisionBrief[]) {
  return [...briefs].sort((left, right) => {
    const leftDue = left.next_review_due_at ? Date.parse(left.next_review_due_at) : Number.POSITIVE_INFINITY
    const rightDue = right.next_review_due_at ? Date.parse(right.next_review_due_at) : Number.POSITIVE_INFINITY

    if (leftDue !== rightDue) {
      return leftDue - rightDue
    }

    return Date.parse(right.updated_at) - Date.parse(left.updated_at)
  })
}

function uniqueBriefs(briefs: DecisionBrief[]) {
  return Array.from(new Map(briefs.map((brief) => [brief.id, brief])).values())
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

function BriefCard({
  brief,
  linkedPortfolioCandidate,
  memberNameMap,
  userId,
  nowTimestamp,
  onAssignToMe,
  onUnassign,
  onActivate,
}: {
  brief: DecisionBrief
  linkedPortfolioCandidate: PortfolioCandidate | null
  memberNameMap: Map<string, string>
  userId: string | null
  nowTimestamp: number
  onAssignToMe: (brief: DecisionBrief) => void
  onUnassign: (brief: DecisionBrief) => void
  onActivate: (brief: DecisionBrief) => void
}) {
  const assigneeLabel = brief.assignee_user_id ? memberNameMap.get(brief.assignee_user_id) ?? "Unknown teammate" : "Unassigned"
  const ownerLabel = memberNameMap.get(brief.owner_user_id) ?? "Unknown teammate"
  const reviewDueNow =
    typeof brief.next_review_due_at === "string" && Date.parse(brief.next_review_due_at) <= nowTimestamp
  const cadenceGap = isLiveBrief(brief) && !brief.next_review_due_at
  const dueSoon = isDueSoon(brief, nowTimestamp)

  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Decision brief</p>
          <h3 className="mt-2 font-display text-lg font-semibold text-white">{brief.title}</h3>
        </div>
        <DecisionStatusBadge status={brief.status} />
      </div>

      <p className="mt-4 text-sm leading-7 text-zinc-300">{brief.summary}</p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Ownership</p>
          <p className="mt-2 text-sm text-zinc-300">Owner {ownerLabel}</p>
          <p className="mt-1 text-sm text-zinc-300">Assignee {assigneeLabel}</p>
          {linkedPortfolioCandidate ? (
            <p className="mt-2 text-xs text-zinc-500">
              Portfolio tracked | {linkedPortfolioCandidate.status} | {linkedPortfolioCandidate.priority} priority
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Next review</p>
          <p className={`mt-2 text-sm ${reviewDueNow ? "text-amber-200" : "text-zinc-300"}`}>
            {formatDateTime(brief.next_review_due_at)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{formatRelativeReviewState(brief.next_review_due_at)}</p>
          {cadenceGap ? (
            <p className="mt-2 text-xs text-amber-200">Live briefs should always carry a review date so the watchlist does not drift.</p>
          ) : null}
          {dueSoon ? (
            <p className="mt-2 text-xs text-cyan-200">This brief is coming due soon. Treat it like the next follow-through item after already-due work.</p>
          ) : null}
          <p className="mt-2 text-xs text-zinc-500">{brief.key_assets.join(", ") || "No key assets recorded"}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/decisions/${brief.id}`}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
        >
          Open brief
        </Link>
        <Link
          href={`/predictions/${brief.lead_prediction_id}`}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
        >
          Lead prediction
        </Link>
        <Link
          href="/investigations"
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
        >
          Open investigations
        </Link>
        {linkedPortfolioCandidate ? (
          <Link
            href={`/portfolio?focus=${linkedPortfolioCandidate.id}`}
            className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
          >
            Open portfolio
          </Link>
        ) : null}
        {brief.assignee_user_id !== userId ? (
          <button
            type="button"
            onClick={() => onAssignToMe(brief)}
            className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50"
          >
            Assign to me
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onUnassign(brief)}
            className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
          >
            Unassign
          </button>
        )}
        {(brief.status === "draft" || brief.status === "proposed") ? (
          <button
            type="button"
            onClick={() => onActivate(brief)}
            className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
          >
            Mark active
          </button>
        ) : null}
      </div>
    </div>
  )
}

function BriefSection({
  title,
  eyebrow,
  briefs,
  portfolioCandidateByBriefId,
  memberNameMap,
  userId,
  nowTimestamp,
  onAssignToMe,
  onUnassign,
  onActivate,
}: {
  title: string
  eyebrow: string
  briefs: DecisionBrief[]
  portfolioCandidateByBriefId: Map<string, PortfolioCandidate>
  memberNameMap: Map<string, string>
  userId: string | null
  nowTimestamp: number
  onAssignToMe: (brief: DecisionBrief) => void
  onUnassign: (brief: DecisionBrief) => void
  onActivate: (brief: DecisionBrief) => void
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
      <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">{eyebrow}</p>
      <h2 className="mt-2 font-display text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4 space-y-4">
        {briefs.length ? (
          briefs.map((brief) => (
            <BriefCard
              key={brief.id}
              brief={brief}
              linkedPortfolioCandidate={portfolioCandidateByBriefId.get(brief.id) ?? null}
              memberNameMap={memberNameMap}
              userId={userId}
              nowTimestamp={nowTimestamp}
              onAssignToMe={onAssignToMe}
              onUnassign={onUnassign}
              onActivate={onActivate}
            />
          ))
        ) : (
          <RouteEmptyState
            title={`No ${title.toLowerCase()} yet`}
            description="This lane will populate as investigations are promoted into shared decision briefs."
          />
        )}
      </div>
    </section>
  )
}

type DeskPriorityAction = {
  brief: DecisionBrief
  tone: "amber" | "cyan" | "emerald" | "blue"
  label: string
  title: string
  description: string
}

function buildPriorityAction(
  brief: DecisionBrief,
  nowTimestamp: number,
): DeskPriorityAction {
  if (isReviewDueNow(brief, nowTimestamp)) {
    return {
      brief,
      tone: "amber",
      label: "Run due review",
      title: "Due follow-through",
      description: "This live brief is already due and should be revisited before the team expands new work around it.",
    }
  }

  if (isLiveBrief(brief) && !brief.next_review_due_at) {
    return {
      brief,
      tone: "amber",
      label: "Set cadence",
      title: "Missing review cadence",
      description: "This live brief has no explicit next review date, so it can silently drift off the operating desk.",
    }
  }

  if (isLiveBrief(brief) && !brief.assignee_user_id) {
    return {
      brief,
      tone: "emerald",
      label: "Take ownership",
      title: "Needs ownership",
      description: "This live brief still has no assignee. Assign it before promoting additional speculative work.",
    }
  }

  if (isDueSoon(brief, nowTimestamp)) {
    return {
      brief,
      tone: "cyan",
      label: "Prepare review",
      title: "Due soon",
      description: "This brief is approaching its follow-through window and should be checked before it becomes overdue.",
    }
  }

  if (brief.status === "draft" || brief.status === "proposed") {
    return {
      brief,
      tone: "cyan",
      label: "Advance brief",
      title: "Promotion waiting",
      description: "This brief is still upstream of the live operating loop and needs activation or clearer ownership.",
    }
  }

  if (isStaleLiveBrief(brief, nowTimestamp)) {
    return {
      brief,
      tone: "blue",
      label: "Re-anchor brief",
      title: "Stale live work",
      description: "This live brief has been quiet for too long and should be re-anchored with a checkpoint or cadence update.",
    }
  }

  return {
    brief,
    tone: "blue",
    label: "Open brief",
    title: "Live follow-through",
    description: "This brief is live and already has ownership and cadence, so it should stay visible in the operating loop.",
  }
}

export default function DecisionsPage() {
  const { activity, decisionBriefs, members, portfolioCandidates, refreshWorkspace, user } = useWorkspace()
  const [desk, setDesk] = useState<WorkspaceDecisionDeskResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [nowTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let active = true

    void getDecisionDesk()
      .then((nextDesk) => {
        if (active) {
          setDesk(nextDesk)
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
  const portfolioCandidateByBriefId = useMemo(
    () => new Map(portfolioCandidates.map((candidate) => [candidate.decision_brief_id, candidate])),
    [portfolioCandidates],
  )
  const latestCheckpointByBriefId = useMemo(
    () =>
      activity.reduce<Map<string, (typeof activity)[number]>>((map, event) => {
        if (event.kind !== "decision_checkpoint_saved") {
          return map
        }

        const decisionBriefId = typeof event.metadata.decision_brief_id === "string" ? event.metadata.decision_brief_id : null
        if (!decisionBriefId || map.has(decisionBriefId)) {
          return map
        }

        map.set(decisionBriefId, event)
        return map
      }, new Map()),
    [activity],
  )

  const grouped = useMemo<WorkspaceDecisionDeskResponse>(() => {
    if (desk) {
      return desk
    }

    const activeBriefs = decisionBriefs.filter((brief) => brief.status === "active" || brief.status === "watching")
    const proposedBriefs = decisionBriefs.filter((brief) => brief.status === "draft" || brief.status === "proposed")
    const dueBriefs = activeBriefs.filter((brief) => brief.next_review_due_at && brief.next_review_due_at <= new Date().toISOString())
    const recentlyClosedBriefs = decisionBriefs.filter((brief) => brief.status === "closed").slice(0, 12)

    return {
      active_briefs: activeBriefs.slice(0, 12),
      proposed_briefs: proposedBriefs.slice(0, 12),
      due_briefs: dueBriefs.slice(0, 12),
      recently_closed_briefs: recentlyClosedBriefs,
    }
  }, [decisionBriefs, desk])

  const allBriefs = useMemo(
    () =>
      sortBriefs(
        uniqueBriefs([
          ...grouped.proposed_briefs,
          ...grouped.active_briefs,
          ...grouped.recently_closed_briefs,
        ]),
      ),
    [grouped],
  )

  const assignedToMeBriefs = useMemo(
    () =>
      sortBriefs(
        allBriefs.filter((brief) => brief.assignee_user_id === user?.id && brief.status !== "closed"),
      ).slice(0, 12),
    [allBriefs, user?.id],
  )
  const unassignedLiveBriefs = useMemo(
    () =>
      sortBriefs(
        allBriefs.filter(
          (brief) =>
            !brief.assignee_user_id &&
            isLiveBrief(brief),
        ),
      ).slice(0, 12),
    [allBriefs],
  )
  const watchingBriefs = useMemo(
    () => sortBriefs(allBriefs.filter((brief) => brief.status === "watching")).slice(0, 12),
    [allBriefs],
  )
  const missingCadenceBriefs = useMemo(
    () =>
      sortBriefs(
        allBriefs.filter(
          (brief) => isLiveBrief(brief) && !brief.next_review_due_at,
        ),
      ).slice(0, 12),
    [allBriefs],
  )
  const dueSoonBriefs = useMemo(
    () => sortBriefs(allBriefs.filter((brief) => isDueSoon(brief, nowTimestamp))).slice(0, 12),
    [allBriefs, nowTimestamp],
  )
  const staleCheckpointBriefs = useMemo(
    () =>
      sortBriefs(
        allBriefs.filter((brief) => {
          if (!isLiveBrief(brief) || isReviewDueNow(brief, nowTimestamp)) {
            return false
          }

          const latestCheckpoint = latestCheckpointByBriefId.get(brief.id)
          if (!latestCheckpoint) {
            return true
          }

          const staleHours = brief.status === "active" ? 72 : 120
          return Date.parse(latestCheckpoint.created_at) <= nowTimestamp - staleHours * 60 * 60 * 1000
        }),
      ).slice(0, 12),
    [allBriefs, latestCheckpointByBriefId, nowTimestamp],
  )
  const dueBriefs = useMemo(() => sortBriefs(grouped.due_briefs), [grouped.due_briefs])
  const proposedBriefs = useMemo(() => sortBriefs(grouped.proposed_briefs), [grouped.proposed_briefs])
  const activeBriefs = useMemo(
    () => sortBriefs(grouped.active_briefs.filter((brief) => brief.status === "active")),
    [grouped.active_briefs],
  )
  const recentlyClosedBriefs = useMemo(
    () => sortBriefs(grouped.recently_closed_briefs),
    [grouped.recently_closed_briefs],
  )
  const deskPriorityActions = useMemo(
    () =>
      sortBriefs(
        uniqueBriefs([
          ...dueBriefs,
          ...missingCadenceBriefs,
          ...unassignedLiveBriefs,
          ...dueSoonBriefs,
          ...proposedBriefs,
          ...staleCheckpointBriefs,
          ...watchingBriefs,
          ...activeBriefs,
        ]),
      )
        .map((brief) => buildPriorityAction(brief, nowTimestamp))
        .slice(0, 5),
    [
      activeBriefs,
      dueBriefs,
      dueSoonBriefs,
      missingCadenceBriefs,
      nowTimestamp,
      proposedBriefs,
      staleCheckpointBriefs,
      unassignedLiveBriefs,
      watchingBriefs,
    ],
  )
  const primaryDeskAction = deskPriorityActions[0] ?? null
  const secondaryDeskActions = deskPriorityActions.slice(1)

  const handleRefresh = async () => {
    const [nextDesk] = await Promise.all([getDecisionDesk(), refreshWorkspace()])
    setDesk(nextDesk)
  }

  const handleAssignToMe = async (brief: DecisionBrief) => {
    if (!user) {
      return
    }

    await assignDecisionBrief(brief.id, { assignee_user_id: user.id })
    await handleRefresh()
  }

  const handleUnassign = async (brief: DecisionBrief) => {
    await assignDecisionBrief(brief.id, { assignee_user_id: null })
    await handleRefresh()
  }

  const handleActivate = async (brief: DecisionBrief) => {
    await updateDecisionBriefStatus(brief.id, {
      status: "active",
      next_review_due_at: brief.next_review_due_at,
    })
    await handleRefresh()
  }

  return (
    <AppShell
      eyebrow="Phase 7 foundation"
      title="Decision desk"
      subtitle="Run the shared decision loop with clear ownership, cadence, follow-through, and closure across the team workspace."
    >
      {loading ? (
        <RouteLoadingState
          title="Loading decision desk"
          description="Restoring proposed, active, due, and closed decision briefs from the shared workspace."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <SummaryCard
              label="All briefs"
              value={String(decisionBriefs.length)}
              detail="Shared decision objects connected to investigations and lead predictions."
            />
            <SummaryCard
              label="Assigned to me"
              value={String(assignedToMeBriefs.length)}
              detail="Open briefs currently owned by this operator."
            />
            <SummaryCard
              label="Watching"
              value={String(watchingBriefs.length)}
              detail="Live briefs currently in watchlist mode instead of active operation."
            />
            <SummaryCard
              label="Due follow-up"
              value={String(dueBriefs.length)}
              detail="Decision briefs whose next review date is already due."
            />
            <SummaryCard
              label="Cadence gaps"
              value={String(missingCadenceBriefs.length)}
              detail="Live briefs missing review dates and at risk of drifting off the desk."
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Desk command</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">What needs action now</h2>
              <div className="mt-4 space-y-4">
                {primaryDeskAction ? (
                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{primaryDeskAction.title}</p>
                        <h3 className="mt-2 font-display text-lg font-semibold text-white">{primaryDeskAction.brief.title}</h3>
                      </div>
                      <DecisionStatusBadge status={primaryDeskAction.brief.status} />
                    </div>
                    <p className="mt-4 text-sm leading-7 text-zinc-300">{primaryDeskAction.description}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      <span>{primaryDeskAction.brief.assignee_user_id ? memberNameMap.get(primaryDeskAction.brief.assignee_user_id) ?? "Unknown teammate" : "Unassigned"}</span>
                      <span>|</span>
                      <span>{primaryDeskAction.brief.next_review_due_at ? formatRelativeReviewState(primaryDeskAction.brief.next_review_due_at) : "Review cadence not set"}</span>
                      <span>|</span>
                      <span>{describeUpdatedAgo(primaryDeskAction.brief.updated_at, nowTimestamp)}</span>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Link
                        href={`/decisions/${primaryDeskAction.brief.id}`}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                      >
                        {primaryDeskAction.label}
                      </Link>
                      <Link
                        href={`/predictions/${primaryDeskAction.brief.lead_prediction_id}`}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                      >
                        Lead prediction
                      </Link>
                    </div>
                  </div>
                ) : (
                  <RouteEmptyState
                    title="No urgent decision brief"
                    description="The desk will surface the highest-priority live brief here once follow-through, ownership, or cadence pressure appears."
                  />
                )}

                {secondaryDeskActions.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {secondaryDeskActions.map((action) => (
                      <div key={action.brief.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{action.title}</p>
                            <p className="mt-2 text-sm font-medium text-white">{action.brief.title}</p>
                          </div>
                          <DecisionStatusBadge status={action.brief.status} />
                        </div>
                        <p className="mt-3 text-xs leading-6 text-zinc-400">{action.description}</p>
                        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          <span>{action.label}</span>
                          <Link
                            href={`/decisions/${action.brief.id}`}
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
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Drift watch</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">Follow-through gaps</h2>
              <div className="mt-4 space-y-3">
                {staleCheckpointBriefs.length ? (
                  staleCheckpointBriefs.map((brief) => {
                    const latestCheckpoint = latestCheckpointByBriefId.get(brief.id)

                    return (
                    <div key={brief.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{brief.title}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {brief.status} |{" "}
                            {latestCheckpoint
                              ? `Last checkpoint ${describeUpdatedAgo(latestCheckpoint.created_at, nowTimestamp)}`
                              : "No checkpoint recorded yet"}
                          </p>
                        </div>
                        <DecisionStatusBadge status={brief.status} />
                      </div>
                      <p className="mt-3 text-sm text-zinc-300">
                        {latestCheckpoint
                          ? "This live brief has not had a checkpoint recently enough and should be re-anchored before the team loses the thread."
                          : "This live brief is carrying ownership or cadence, but it still has no follow-through checkpoint to prove active stewardship."}
                      </p>
                      <div className="mt-3 flex justify-end">
                        <Link
                          href={`/decisions/${brief.id}`}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Save checkpoint
                        </Link>
                      </div>
                    </div>
                  )})
                ) : (
                  <RouteEmptyState
                    title="No follow-through gaps"
                    description="Live briefs either have recent checkpoints or are already surfaced through due-review cadence."
                  />
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <BriefSection
              title="Assigned to me"
              eyebrow="My live lane"
              briefs={assignedToMeBriefs}
              portfolioCandidateByBriefId={portfolioCandidateByBriefId}
              memberNameMap={memberNameMap}
              userId={user?.id ?? null}
              nowTimestamp={nowTimestamp}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onActivate={handleActivate}
            />
            <BriefSection
              title="Unassigned live briefs"
              eyebrow="Needs ownership"
              briefs={unassignedLiveBriefs}
              portfolioCandidateByBriefId={portfolioCandidateByBriefId}
              memberNameMap={memberNameMap}
              userId={user?.id ?? null}
              nowTimestamp={nowTimestamp}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onActivate={handleActivate}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <BriefSection
              title="Proposed briefs"
              eyebrow="Newly promoted"
              briefs={proposedBriefs}
              portfolioCandidateByBriefId={portfolioCandidateByBriefId}
              memberNameMap={memberNameMap}
              userId={user?.id ?? null}
              nowTimestamp={nowTimestamp}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onActivate={handleActivate}
            />
            <BriefSection
              title="Due follow-up"
              eyebrow="Needs attention"
              briefs={dueBriefs}
              portfolioCandidateByBriefId={portfolioCandidateByBriefId}
              memberNameMap={memberNameMap}
              userId={user?.id ?? null}
              nowTimestamp={nowTimestamp}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onActivate={handleActivate}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <BriefSection
              title="Watching briefs"
              eyebrow="Watchlist"
              briefs={watchingBriefs}
              portfolioCandidateByBriefId={portfolioCandidateByBriefId}
              memberNameMap={memberNameMap}
              userId={user?.id ?? null}
              nowTimestamp={nowTimestamp}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onActivate={handleActivate}
            />
            <BriefSection
              title="Active briefs"
              eyebrow="Live theses"
              briefs={activeBriefs}
              portfolioCandidateByBriefId={portfolioCandidateByBriefId}
              memberNameMap={memberNameMap}
              userId={user?.id ?? null}
              nowTimestamp={nowTimestamp}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onActivate={handleActivate}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <BriefSection
              title="Recently closed"
              eyebrow="Closure history"
              briefs={recentlyClosedBriefs}
              portfolioCandidateByBriefId={portfolioCandidateByBriefId}
              memberNameMap={memberNameMap}
              userId={user?.id ?? null}
              nowTimestamp={nowTimestamp}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onActivate={handleActivate}
            />

            <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Cadence hygiene</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">Watchlist pressure</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Due within 48 hours</p>
                  <div className="mt-3 space-y-3">
                    {dueSoonBriefs.length ? (
                      dueSoonBriefs.map((brief) => (
                        <div key={brief.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">{brief.title}</p>
                              <p className="mt-1 text-xs text-zinc-500">{formatRelativeReviewState(brief.next_review_due_at)}</p>
                            </div>
                            <Link
                              href={`/decisions/${brief.id}`}
                              className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                            >
                              Review soon
                            </Link>
                          </div>
                        </div>
                      ))
                    ) : (
                      <RouteEmptyState
                        title="No near-term cadence pressure"
                        description="Live briefs are either already due or comfortably scheduled beyond the next two days."
                      />
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Missing review dates</p>
                  <div className="mt-3 space-y-3">
                    {missingCadenceBriefs.length ? (
                      missingCadenceBriefs.map((brief) => (
                        <div key={brief.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">{brief.title}</p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {brief.status} |{" "}
                                {brief.assignee_user_id ? memberNameMap.get(brief.assignee_user_id) ?? "Unknown teammate" : "Unassigned"}
                              </p>
                            </div>
                            <Link
                              href={`/decisions/${brief.id}`}
                              className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                            >
                              Set cadence
                            </Link>
                          </div>
                        </div>
                      ))
                    ) : (
                      <RouteEmptyState
                        title="All live briefs have review dates"
                        description="Active and watching briefs already carry explicit follow-up cadence."
                      />
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Decision workflow</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">Desk priorities</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">1. Due reviews</p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Reopen due briefs first so active theses do not drift without follow-through.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">2. Ownership</p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Pull unassigned live work into clear ownership before promoting more speculative ideas.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">3. Activation</p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Move proposed or watching briefs forward only when cadence and ownership are explicit.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Cadence hygiene</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">Desk warnings</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Already due</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{dueBriefs.length}</p>
                  <p className="mt-2 text-sm text-zinc-400">These briefs need follow-through immediately.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Due soon</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{dueSoonBriefs.length}</p>
                  <p className="mt-2 text-sm text-zinc-400">These watchlist items will require attention in the next two days.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Missing cadence</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{missingCadenceBriefs.length}</p>
                  <p className="mt-2 text-sm text-zinc-400">Live briefs without review dates are the first source of silent drift.</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </AppShell>
  )
}
