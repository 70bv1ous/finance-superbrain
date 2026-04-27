"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import type {
  CreateDecisionCheckpointRequest,
  DecisionBrief,
  DecisionBriefDetailResponse,
  DecisionCheckpointAction,
  DecisionCheckpointThesisState,
} from "@finance-superbrain/schemas"

import { AppShell } from "@/components/AppShell"
import { DecisionStatusBadge } from "@/components/DecisionStatusBadge"
import { PortfolioStatusBadge } from "@/components/PortfolioStatusBadge"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import { assignDecisionBrief, getDecisionBriefDetail, saveDecisionCheckpoint, updateDecisionBriefStatus } from "@/lib/decisionApi"
import { getDecisionClosureSummary } from "@/lib/decisionRetrospective"
import { createPortfolioCandidate } from "@/lib/portfolioApi"
import { formatWorkspaceActivityKind, getWorkspaceActivityReferences } from "@/lib/workspaceActivity"

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
      <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm text-zinc-300">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="text-zinc-500">-</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not scheduled"
  }

  return new Date(value).toLocaleString()
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)

  return local.toISOString().slice(0, 16)
}

function toIsoDateTime(value: string) {
  return value ? new Date(value).toISOString() : null
}

function buildReviewPreset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(9, 0, 0, 0)

  return toDateTimeLocalValue(date.toISOString())
}

function derivePrimaryTheme(brief: DecisionBrief) {
  return brief.title
}

function toCommaSeparatedValue(values: string[]) {
  return values.join(", ")
}

function fromCommaSeparatedValue(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
}

function getBriefGuidance(brief: DecisionBrief, reviewIsDue: boolean) {
  if (brief.status === "closed") {
    return "This brief is closed. The next step is retrieval and closure analysis unless the team decides to reopen it."
  }

  if (brief.status === "watching") {
    return reviewIsDue
      ? "This brief is in watching mode and already due for a follow-through check."
      : "This brief is in watching mode. Keep the cadence current and only reactivate it when the thesis needs tighter monitoring."
  }

  if (brief.status === "active") {
    return reviewIsDue
      ? "This active brief is due now and should be revisited before new work expands around it."
      : "This brief is active and should stay anchored to explicit cadence and checkpoints."
  }

  return "This brief is still upstream of the live monitoring loop. Assign ownership and activate it once the team is ready to operate against it."
}

function formatRelativeUpdate(value: string, nowTimestamp: number) {
  const diffMinutes = Math.max(1, Math.round((nowTimestamp - Date.parse(value)) / 60000))

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}h ago`
  }

  const diffDays = Math.round(diffHours / 24)
  return `${diffDays}d ago`
}

function getCheckpointActionGuidance(action: DecisionCheckpointAction) {
  switch (action) {
    case "move_to_watching":
      return "Use this when the thesis is still alive, but the team should reduce intensity and monitor it from the watchlist."
    case "close":
      return "Use this when the thesis is resolved, invalidated, or otherwise complete enough to move into retrospective retrieval."
    default:
      return "Use this when the thesis is still live and should remain active with a clear next review date."
  }
}

export default function DecisionBriefDetailPage() {
  const { activity, decisionBriefs, members, portfolioCandidates, refreshWorkspace, user } = useWorkspace()
  const params = useParams<{ decisionBriefId: string }>()
  const decisionBriefId = params?.decisionBriefId
  const [detail, setDetail] = useState<DecisionBriefDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkpointSummary, setCheckpointSummary] = useState("")
  const [thesisState, setThesisState] = useState<DecisionCheckpointThesisState>("intact")
  const [checkpointAction, setCheckpointAction] = useState<DecisionCheckpointAction>("keep_active")
  const [savingCheckpoint, setSavingCheckpoint] = useState(false)
  const [reviewDueInput, setReviewDueInput] = useState("")
  const [savingCadence, setSavingCadence] = useState(false)
  const [savingPortfolioPromotion, setSavingPortfolioPromotion] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [nowTimestamp] = useState(() => Date.now())
  const [portfolioPriority, setPortfolioPriority] = useState("high")
  const [portfolioSizing, setPortfolioSizing] = useState("starter")
  const [portfolioRiskBudget, setPortfolioRiskBudget] = useState("defined risk")
  const [portfolioConviction, setPortfolioConviction] = useState("")
  const [portfolioPrimaryTheme, setPortfolioPrimaryTheme] = useState("")
  const [portfolioSecondaryThemes, setPortfolioSecondaryThemes] = useState("")
  const [portfolioRelatedAssets, setPortfolioRelatedAssets] = useState("")
  const [portfolioReviewDueInput, setPortfolioReviewDueInput] = useState("")

  useEffect(() => {
    let active = true

    if (!decisionBriefId) {
      return
    }

    void getDecisionBriefDetail(decisionBriefId)
      .then((nextDetail) => {
        if (active) {
          setDetail(nextDetail)
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
  }, [decisionBriefId])

  const brief = detail?.brief ?? null
  const memberNameMap = useMemo(
    () => new Map(members.map((entry) => [entry.user.id, entry.user.display_name])),
    [members],
  )
  const linkedWorkspaceBrief = useMemo(
    () => decisionBriefs.find((entry) => entry.id === brief?.id) ?? brief,
    [brief, decisionBriefs],
  )
  const linkedPortfolioCandidate = useMemo(
    () =>
      linkedWorkspaceBrief
        ? portfolioCandidates.find((candidate) => candidate.decision_brief_id === linkedWorkspaceBrief.id) ?? null
        : null,
    [linkedWorkspaceBrief, portfolioCandidates],
  )
  const decisionActivity = useMemo(
    () =>
      linkedWorkspaceBrief
        ? activity.filter((event) => event.metadata.decision_brief_id === linkedWorkspaceBrief.id).slice(0, 6)
        : [],
    [activity, linkedWorkspaceBrief],
  )
  const latestCheckpoint = useMemo(
    () =>
      detail?.checkpoints.reduce<(typeof detail.checkpoints)[number] | null>((latest, checkpoint) => {
        if (!latest) {
          return checkpoint
        }

        return Date.parse(checkpoint.created_at) > Date.parse(latest.created_at) ? checkpoint : latest
      }, null) ?? null,
    [detail],
  )
  const reviewIsDue = Boolean(
    linkedWorkspaceBrief?.next_review_due_at &&
      linkedWorkspaceBrief.next_review_due_at <= new Date().toISOString() &&
      linkedWorkspaceBrief.status !== "closed",
  )
  const followThroughGap = Boolean(
    linkedWorkspaceBrief &&
      linkedWorkspaceBrief.status !== "closed" &&
      (!latestCheckpoint ||
        Date.parse(latestCheckpoint.created_at) <=
          nowTimestamp - (linkedWorkspaceBrief.status === "active" ? 72 : 120) * 60 * 60 * 1000),
  )
  const closureSummary = useMemo(
    () => {
      if (!linkedWorkspaceBrief) {
        return null
      }

      return getDecisionClosureSummary({
        brief: linkedWorkspaceBrief,
        checkpoints: detail?.checkpoints,
        activity,
      })
    },
    [activity, detail?.checkpoints, linkedWorkspaceBrief],
  )

  useEffect(() => {
    setReviewDueInput(toDateTimeLocalValue(linkedWorkspaceBrief?.next_review_due_at ?? null))
  }, [linkedWorkspaceBrief?.id, linkedWorkspaceBrief?.next_review_due_at])

  useEffect(() => {
    if (!linkedWorkspaceBrief || linkedPortfolioCandidate) {
      return
    }

    setPortfolioConviction(linkedWorkspaceBrief.confidence_label)
    setPortfolioPrimaryTheme(derivePrimaryTheme(linkedWorkspaceBrief))
    setPortfolioSecondaryThemes("")
    setPortfolioRelatedAssets(toCommaSeparatedValue(linkedWorkspaceBrief.key_assets))
    setPortfolioReviewDueInput(buildReviewPreset(7))
  }, [linkedPortfolioCandidate, linkedWorkspaceBrief])

  const refreshDetail = async (briefId: string) => {
    const [nextDetail] = await Promise.all([getDecisionBriefDetail(briefId), refreshWorkspace()])
    setDetail(nextDetail)
  }

  const handleAssignToMe = async (currentBrief: DecisionBrief) => {
    if (!user) {
      return
    }

    await assignDecisionBrief(currentBrief.id, { assignee_user_id: user.id })
    await refreshDetail(currentBrief.id)
  }

  const handleUnassign = async (currentBrief: DecisionBrief) => {
    await assignDecisionBrief(currentBrief.id, { assignee_user_id: null })
    await refreshDetail(currentBrief.id)
  }

  const handleStatusUpdate = async (currentBrief: DecisionBrief, status: DecisionBrief["status"]) => {
    setSavingCadence(true)
    setMessage(null)

    try {
      await updateDecisionBriefStatus(currentBrief.id, {
        status,
        next_review_due_at: status === "closed" ? null : toIsoDateTime(reviewDueInput),
      })
      await refreshDetail(currentBrief.id)
      setMessage(
        status === "closed"
          ? "Decision brief closed."
          : status === "watching"
            ? "Decision brief moved to watching."
            : "Decision brief marked active.",
      )
    } finally {
      setSavingCadence(false)
    }
  }

  const handleSaveCadence = async (currentBrief: DecisionBrief) => {
    setSavingCadence(true)
    setMessage(null)

    try {
      await updateDecisionBriefStatus(currentBrief.id, {
        status: currentBrief.status,
        next_review_due_at: toIsoDateTime(reviewDueInput),
      })
      await refreshDetail(currentBrief.id)
      setMessage(reviewDueInput ? "Next review cadence saved." : "Next review cadence cleared.")
    } finally {
      setSavingCadence(false)
    }
  }

  const handleSaveCheckpoint = async (currentBrief: DecisionBrief) => {
    if (!checkpointSummary.trim()) {
      return
    }

    setSavingCheckpoint(true)
    setMessage(null)

    try {
      await saveDecisionCheckpoint(currentBrief.id, {
        summary: checkpointSummary.trim(),
        thesis_state: thesisState,
        action: checkpointAction,
        next_review_due_at: checkpointAction === "close" ? null : toIsoDateTime(reviewDueInput),
      })
      setCheckpointSummary("")
      await refreshDetail(currentBrief.id)
      setMessage("Checkpoint saved.")
    } finally {
      setSavingCheckpoint(false)
    }
  }

  const handleCreatePortfolioCandidate = async (currentBrief: DecisionBrief) => {
    setSavingPortfolioPromotion(true)
    setMessage(null)

    try {
      await createPortfolioCandidate({
        decision_brief_id: currentBrief.id,
        priority: portfolioPriority,
        sizing_label: portfolioSizing,
        risk_budget_label: portfolioRiskBudget,
        conviction_label: portfolioConviction.trim() || currentBrief.confidence_label,
        primary_theme: portfolioPrimaryTheme.trim() || derivePrimaryTheme(currentBrief),
        secondary_themes: fromCommaSeparatedValue(portfolioSecondaryThemes),
        related_assets: fromCommaSeparatedValue(portfolioRelatedAssets).slice(0, 24),
        status: "candidate",
        assignee_user_id: currentBrief.assignee_user_id,
        next_review_due_at: toIsoDateTime(portfolioReviewDueInput),
      })
      await refreshDetail(currentBrief.id)
      setMessage("Portfolio candidate created.")
    } finally {
      setSavingPortfolioPromotion(false)
    }
  }

  return (
    <AppShell
      eyebrow="Phase 7 foundation"
      title="Decision brief"
      subtitle="Track the current thesis, ownership, checkpoints, and closure path for one shared decision object."
      actions={
        <Link
          href="/decisions"
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100"
        >
          Back to decisions
        </Link>
      }
    >
      {loading ? (
        <RouteLoadingState
          title="Loading decision brief"
          description="Restoring the shared thesis, ownership, and checkpoint history for this brief."
        />
      ) : !linkedWorkspaceBrief ? (
        <RouteEmptyState
          title="Decision brief unavailable"
          description="The requested decision brief could not be loaded from the shared workspace."
          actionHref="/decisions"
          actionLabel="Back to decisions"
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <DecisionStatusBadge status={linkedWorkspaceBrief.status} />
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-500">
              Owner {memberNameMap.get(linkedWorkspaceBrief.owner_user_id) ?? "Unknown"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-500">
              Assignee {linkedWorkspaceBrief.assignee_user_id ? memberNameMap.get(linkedWorkspaceBrief.assignee_user_id) ?? "Unknown" : "Unassigned"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-500">
              Review {formatDateTime(linkedWorkspaceBrief.next_review_due_at)}
            </span>
            {reviewIsDue ? (
              <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-amber-100">
                Review due now
              </span>
            ) : null}
          </div>

          <Section title="Brief overview">
            <p className="text-sm leading-7 text-zinc-200">{linkedWorkspaceBrief.summary}</p>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Thesis</p>
                <p className="mt-3 text-sm leading-7 text-zinc-300">{linkedWorkspaceBrief.thesis}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Scenario</p>
                <p className="mt-3 text-sm leading-7 text-zinc-300">{linkedWorkspaceBrief.scenario}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Operating posture</p>
                <p className="mt-3 text-sm leading-7 text-zinc-300">{getBriefGuidance(linkedWorkspaceBrief, reviewIsDue)}</p>
                {linkedWorkspaceBrief.closed_at ? (
                  <p className="mt-3 text-xs text-zinc-500">Closed at {formatDateTime(linkedWorkspaceBrief.closed_at)}</p>
                ) : null}
              </div>
            </div>
          </Section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <Section title="Triggers and invalidations">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Triggers</p>
                  <div className="mt-3">
                    <BulletList items={linkedWorkspaceBrief.triggers} />
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Invalidations</p>
                  <div className="mt-3">
                    <BulletList items={linkedWorkspaceBrief.invalidations} />
                  </div>
                </div>
              </div>
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Key assets</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {linkedWorkspaceBrief.key_assets.map((asset) => (
                    <span key={asset} className="rounded-full border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-400">
                      {asset}
                    </span>
                  ))}
                </div>
              </div>
            </Section>

          <Section title="Operator controls">
              <div className="space-y-3">
                <Link
                  href={`/predictions/${linkedWorkspaceBrief.lead_prediction_id}`}
                  className="block rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Open lead prediction
                </Link>
                <Link
                  href="/investigations"
                  className="block rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Open investigations desk
                </Link>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Review cadence</p>
                    <p className="mt-2 text-sm text-zinc-300">
                      {linkedWorkspaceBrief.next_review_due_at
                        ? reviewIsDue
                          ? "This brief is due for a follow-through check now."
                          : `Next review is scheduled for ${formatDateTime(linkedWorkspaceBrief.next_review_due_at)}.`
                        : "No next review is scheduled yet. Set one so the brief stays in the decision cadence."}
                    </p>
                  </div>
                  {linkedWorkspaceBrief.next_review_due_at ? <DecisionStatusBadge status={linkedWorkspaceBrief.status} /> : null}
                </div>

                <label className="mt-4 block space-y-2 text-sm text-zinc-300">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Next review due</span>
                  <input
                    type="datetime-local"
                    value={reviewDueInput}
                    onChange={(event) => setReviewDueInput(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/40"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-2">
                  {[1, 3, 7].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setReviewDueInput(buildReviewPreset(days))}
                      className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                    >
                      Review in {days}d
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setReviewDueInput("")}
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Clear date
                  </button>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleSaveCadence(linkedWorkspaceBrief)}
                    disabled={savingCadence}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-zinc-600"
                  >
                    {savingCadence ? "Saving cadence..." : "Save review cadence"}
                  </button>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {linkedWorkspaceBrief.assignee_user_id !== user?.id ? (
                  <button
                    type="button"
                    onClick={() => void handleAssignToMe(linkedWorkspaceBrief)}
                    className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50"
                  >
                    Assign to me
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleUnassign(linkedWorkspaceBrief)}
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Unassign
                  </button>
                )}
                {linkedWorkspaceBrief.status !== "active" ? (
                  <button
                    type="button"
                    onClick={() => void handleStatusUpdate(linkedWorkspaceBrief, "active")}
                    disabled={savingCadence}
                    className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
                  >
                    Mark active
                  </button>
                ) : null}
                {linkedWorkspaceBrief.status === "closed" ? (
                  <button
                    type="button"
                    onClick={() => void handleStatusUpdate(linkedWorkspaceBrief, "watching")}
                    disabled={savingCadence}
                    className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
                  >
                    Reopen as watching
                  </button>
                ) : null}
                {linkedWorkspaceBrief.status !== "watching" && linkedWorkspaceBrief.status !== "closed" ? (
                  <button
                    type="button"
                    onClick={() => void handleStatusUpdate(linkedWorkspaceBrief, "watching")}
                    disabled={savingCadence}
                    className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-100 transition-colors hover:border-amber-400/40 hover:text-amber-50"
                  >
                    Move to watching
                  </button>
                ) : null}
                {linkedWorkspaceBrief.status !== "closed" ? (
                  <button
                    type="button"
                    onClick={() => void handleStatusUpdate(linkedWorkspaceBrief, "closed")}
                    disabled={savingCadence}
                    className="rounded-full border border-zinc-500/25 bg-zinc-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-200 transition-colors hover:border-zinc-400/40 hover:text-white"
                  >
                    Close brief
                  </button>
                ) : null}
                {linkedWorkspaceBrief.status === "closed" ? (
                  <Link
                    href="/library"
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Open retrieval desk
                  </Link>
                ) : null}
              </div>
              {message ? <p className="mt-3 text-sm text-zinc-400">{message}</p> : null}
            </Section>
          </div>

          <Section title="Portfolio promotion">
            {linkedPortfolioCandidate ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Already portfolio-tracked</p>
                      <p className="mt-2 text-sm font-medium text-white">{linkedPortfolioCandidate.title}</p>
                    </div>
                    <PortfolioStatusBadge status={linkedPortfolioCandidate.status} />
                  </div>
                  <p className="mt-3 text-sm text-zinc-300">
                    This decision brief already has a portfolio candidate, so the next home for portfolio posture and review is the portfolio desk.
                  </p>
                  <p className="mt-3 text-xs text-zinc-500">
                    {linkedPortfolioCandidate.priority} priority | {linkedPortfolioCandidate.sizing_label} sizing | {linkedPortfolioCandidate.risk_budget_label}
                  </p>
                </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Portfolio next step</p>
                    <p className="mt-3 text-sm text-zinc-300">
                      Open the portfolio candidate to manage assignment, posture, and follow-through directly, then return to the desk when you need broader coordination.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={`/portfolio/${linkedPortfolioCandidate.id}`}
                        className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
                      >
                        Open portfolio candidate
                      </Link>
                      <Link
                        href={`/portfolio?focus=${linkedPortfolioCandidate.id}`}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                      >
                        Open portfolio desk
                      </Link>
                      <Link
                        href={`/predictions/${linkedPortfolioCandidate.lead_prediction_id}`}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                    >
                      Lead prediction
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Promote into portfolio</p>
                <p className="mt-3 text-sm text-zinc-300">
                  Use this when the brief is no longer just a decision object, but something the team wants to coordinate alongside other live exposures.
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Priority</span>
                    <select
                      value={portfolioPriority}
                      onChange={(event) => setPortfolioPriority(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="watch">Watch</option>
                    </select>
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Sizing</span>
                    <select
                      value={portfolioSizing}
                      onChange={(event) => setPortfolioSizing(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                    >
                      <option value="starter">Starter</option>
                      <option value="core">Core</option>
                      <option value="tactical">Tactical</option>
                    </select>
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Risk budget</span>
                    <input
                      value={portfolioRiskBudget}
                      onChange={(event) => setPortfolioRiskBudget(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                    />
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Conviction label</span>
                    <input
                      value={portfolioConviction}
                      onChange={(event) => setPortfolioConviction(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                    />
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Primary theme</span>
                    <input
                      value={portfolioPrimaryTheme}
                      onChange={(event) => setPortfolioPrimaryTheme(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                    />
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Next review due</span>
                    <input
                      type="datetime-local"
                      value={portfolioReviewDueInput}
                      onChange={(event) => setPortfolioReviewDueInput(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                    />
                  </label>
                </div>

                <label className="mt-4 block space-y-2 text-sm text-zinc-300">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Secondary themes</span>
                  <input
                    value={portfolioSecondaryThemes}
                    onChange={(event) => setPortfolioSecondaryThemes(event.target.value)}
                    placeholder="Comma-separated optional themes"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                  />
                </label>

                <label className="mt-4 block space-y-2 text-sm text-zinc-300">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Related assets</span>
                  <input
                    value={portfolioRelatedAssets}
                    onChange={(event) => setPortfolioRelatedAssets(event.target.value)}
                    placeholder="Comma-separated tickers"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                  />
                </label>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleCreatePortfolioCandidate(linkedWorkspaceBrief)}
                    disabled={savingPortfolioPromotion || !portfolioPrimaryTheme.trim()}
                    className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-500/60"
                  >
                    {savingPortfolioPromotion ? "Creating candidate..." : "Create portfolio candidate"}
                  </button>
                </div>
              </div>
            )}
          </Section>

          <Section title="Follow-through health">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Latest checkpoint</p>
                {latestCheckpoint ? (
                  <>
                    <p className="mt-3 text-sm font-medium text-white">{latestCheckpoint.summary}</p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {latestCheckpoint.action.replace(/_/g, " ")} | {latestCheckpoint.thesis_state.replace(/_/g, " ")} | {formatRelativeUpdate(latestCheckpoint.created_at, nowTimestamp)}
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-zinc-300">
                    No checkpoint has been recorded yet. Live briefs should quickly accumulate follow-through evidence so the team can trust their operating posture.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Desk guidance</p>
                <p className="mt-3 text-sm text-zinc-300">
                  {followThroughGap
                    ? "This brief needs a fresh checkpoint. The desk will treat it as follow-through drift until a teammate records what changed and what happens next."
                    : "Checkpoint coverage is currently fresh enough that cadence and ownership, not missing follow-through, should drive the next action."}
                </p>
                <p className="mt-3 text-xs text-zinc-500">
                  {linkedWorkspaceBrief.status === "closed"
                    ? "Closed briefs no longer need checkpoints unless the team decides to reopen them."
                    : linkedWorkspaceBrief.status === "watching"
                      ? "Watching briefs can go longer between checkpoints, but they still need explicit follow-through."
                      : "Active briefs should keep checkpoints fresh so the command center can trust their current posture."}
                </p>
              </div>
            </div>
          </Section>

          {closureSummary ? (
            <Section title="Closure outcome">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Outcome posture</p>
                  <p className="mt-3 text-sm font-medium text-white">{closureSummary.label}</p>
                  <p className="mt-3 text-sm leading-7 text-zinc-300">{closureSummary.detail}</p>
                  {closureSummary.closedAt ? (
                    <p className="mt-3 text-xs text-zinc-500">Closed at {formatDateTime(closureSummary.closedAt)}</p>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Retrospective next step</p>
                  <p className="mt-3 text-sm text-zinc-300">
                    Closed briefs should now feed retrieval and evaluation as finished operating outcomes. Reopen only if the team is deliberately reviving the thesis.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href="/library"
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                    >
                      Open library
                    </Link>
                    <Link
                      href="/evaluation"
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                    >
                      Open evaluation
                    </Link>
                  </div>
                </div>
              </div>
            </Section>
          ) : null}

          <Section title="Checkpoint history">
            <div className="space-y-4">
              {detail?.checkpoints.length ? (
                detail.checkpoints.map((checkpoint) => (
                  <div key={checkpoint.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{checkpoint.action.replace(/_/g, " ")}</p>
                        <p className="mt-2 text-sm font-medium text-white">{checkpoint.summary}</p>
                      </div>
                      <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                        {checkpoint.thesis_state.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-3 text-xs text-zinc-500">
                      {memberNameMap.get(checkpoint.actor_user_id) ?? "Unknown teammate"} | {formatDateTime(checkpoint.created_at)}
                    </p>
                  </div>
                ))
              ) : (
                <RouteEmptyState
                  title="No checkpoints yet"
                  description="The team can add follow-through checkpoints here once the brief is active and being monitored."
                />
              )}
            </div>

            {linkedWorkspaceBrief.status !== "closed" ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Add checkpoint</p>
                <textarea
                  value={checkpointSummary}
                  onChange={(event) => setCheckpointSummary(event.target.value)}
                  className="mt-3 min-h-28 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/40"
                  placeholder="Summarize what changed, whether the thesis still holds, and what the team should do next."
                />
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Thesis state</span>
                    <select
                      value={thesisState}
                      onChange={(event) => setThesisState(event.target.value as DecisionCheckpointThesisState)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                    >
                      <option value="intact">Intact</option>
                      <option value="weakened">Weakened</option>
                      <option value="invalidated">Invalidated</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Action</span>
                    <select
                      value={checkpointAction}
                      onChange={(event) => setCheckpointAction(event.target.value as CreateDecisionCheckpointRequest["action"])}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                    >
                      <option value="keep_active">Keep active</option>
                      <option value="move_to_watching">Move to watching</option>
                      <option value="close">Close</option>
                    </select>
                  </label>
                </div>
                <label className="mt-4 block space-y-2 text-sm text-zinc-300">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Next review due</span>
                  <input
                    type="datetime-local"
                    value={reviewDueInput}
                    onChange={(event) => setReviewDueInput(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                  />
                </label>
                <p className="mt-3 text-xs text-zinc-500">
                  Save the next follow-up date together with the checkpoint so the command center can keep the team decision cadence on track.
                </p>
                <p className="mt-2 text-xs text-zinc-500">{getCheckpointActionGuidance(checkpointAction)}</p>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleSaveCheckpoint(linkedWorkspaceBrief)}
                    disabled={savingCheckpoint || !checkpointSummary.trim()}
                    className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-500/60"
                  >
                    {savingCheckpoint ? "Saving checkpoint..." : "Save checkpoint"}
                  </button>
                </div>
              </div>
            ) : null}
          </Section>

          <Section title="Recent decision history">
            {decisionActivity.length ? (
              <div className="space-y-3">
                {decisionActivity.map((event) => (
                  <div key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{event.detail}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {memberNameMap.get(event.actor_user_id) ?? "Unknown teammate"} | {formatWorkspaceActivityKind(event.kind)}
                        </p>
                      </div>
                      <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                        {formatDateTime(event.created_at)}
                      </span>
                    </div>
                    {getWorkspaceActivityReferences(event).length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {getWorkspaceActivityReferences(event).map((reference) => (
                          <Link
                            key={`${event.id}:${reference.label}:${reference.href}`}
                            href={reference.href}
                            className="rounded-full border border-white/10 bg-zinc-950/60 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
                          >
                            {reference.label}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <RouteEmptyState
                title="No decision history yet"
                description="Creation, assignment, status changes, and checkpoints will build the brief's operating history here."
              />
            )}
          </Section>
        </div>
      )}
    </AppShell>
  )
}
