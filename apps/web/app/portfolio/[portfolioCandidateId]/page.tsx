"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import type {
  PortfolioCandidate,
  PortfolioCandidateDetailResponse,
  PortfolioCheckpointAction,
  DecisionCheckpointThesisState,
} from "@finance-superbrain/schemas"

import { AppShell } from "@/components/AppShell"
import { LinkedObsidianMemoryPanel } from "@/components/LinkedObsidianMemoryPanel"
import { PortfolioStatusBadge } from "@/components/PortfolioStatusBadge"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import { getLessons, type Lesson } from "@/lib/chatApi"
import { getLinkedObsidianLessons } from "@/lib/obsidianLinkedMemory"
import {
  assignPortfolioCandidate,
  getPortfolioCandidateDetail,
  savePortfolioCheckpoint,
  updatePortfolioCandidatePosture,
  updatePortfolioCandidateStatus,
} from "@/lib/portfolioApi"
import {
  formatPortfolioDateTime,
  formatPortfolioRelativeReviewState,
  getPortfolioFollowThroughHealth,
} from "@/lib/portfolioDesk"
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

function buildReviewPreset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(9, 0, 0, 0)
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
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

function toCommaSeparatedValue(values: string[]) {
  return values.join(", ")
}

function fromCommaSeparatedValue(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
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

function getCandidateGuidance(candidate: PortfolioCandidate, reviewIsDue: boolean) {
  if (candidate.status === "closed") {
    return "This portfolio candidate is closed. Treat it as a portfolio outcome and use the board for broader coordination."
  }

  if (candidate.status === "candidate") {
    return "This candidate is promoted but not yet fully live. Set ownership, posture, and cadence before it absorbs more portfolio attention."
  }

  if (candidate.status === "active") {
    return reviewIsDue
      ? "This active portfolio candidate is due now and should be reviewed before new candidates are promoted into the same exposure set."
      : "This candidate is active and should keep explicit cadence, ownership, and checkpoint follow-through."
  }

  if (candidate.status === "watching") {
    return reviewIsDue
      ? "This watching candidate is due now and should be revisited before it quietly drifts out of the portfolio loop."
      : "This candidate is in watching mode. Keep the cadence disciplined and only move it back to active when the thesis needs tighter posture."
  }

  return reviewIsDue
    ? "This trimmed candidate is due now and should be checked before more posture changes are made."
    : "This candidate is trimmed but still live. Keep the follow-through loop intact until it is either closed or reactivated."
}

function getCheckpointActionGuidance(action: PortfolioCheckpointAction) {
  switch (action) {
    case "move_to_watching":
      return "Use this when the thesis still matters but deserves lighter monitoring than a fully active candidate."
    case "trim":
      return "Use this when the thesis still matters but the current posture should be scaled back."
    case "close":
      return "Use this when the candidate should leave the live portfolio set and become a closed outcome."
    default:
      return "Use this when the candidate should remain active with a clear next review date."
  }
}

function getFollowThroughHealthCopy(health: ReturnType<typeof getPortfolioFollowThroughHealth>) {
  switch (health) {
    case "candidate":
      return {
        label: "Candidate",
        detail: "This candidate is promoted but not live yet. Confirm ownership, posture, and cadence before it carries more portfolio weight.",
      }
    case "closed":
      return {
        label: "Closed",
        detail: "This candidate is already closed and should now be treated as portfolio outcome memory rather than a live rebalance object.",
      }
    case "due_now":
      return {
        label: "Due now",
        detail: "The next review date is already due. This candidate should be revisited before more exposure is promoted into the same theme cluster.",
      }
    case "due_soon":
      return {
        label: "Due soon",
        detail: "The next review window lands within 48 hours, so this candidate should be reviewed before it quietly becomes overdue.",
      }
    case "stale_watching":
      return {
        label: "Stale watching",
        detail: "This candidate is still on watch, but the follow-through trail has gone quiet long enough to risk silent drift.",
      }
    case "trimmed_pending_followup":
      return {
        label: "Trimmed pending follow-up",
        detail: "This trimmed candidate still needs explicit next-step follow-through, either to stabilize, stay trimmed, or close cleanly.",
      }
    case "missing_cadence":
      return {
        label: "Missing cadence",
        detail: "This live candidate still has no explicit next review date, which makes manual portfolio follow-through too easy to lose.",
      }
    default:
      return {
        label: "On cadence",
        detail: "This candidate has clear posture, a defined next review, and no immediate rebalance pressure right now.",
      }
  }
}

export default function PortfolioCandidateDetailPage() {
  const { activity, members, refreshWorkspace, user } = useWorkspace()
  const params = useParams<{ portfolioCandidateId: string }>()
  const portfolioCandidateId = params?.portfolioCandidateId
  const [detail, setDetail] = useState<PortfolioCandidateDetailResponse | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [savingAssignment, setSavingAssignment] = useState(false)
  const [savingPosture, setSavingPosture] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [savingCheckpoint, setSavingCheckpoint] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [posturePriority, setPosturePriority] = useState("high")
  const [postureSizing, setPostureSizing] = useState("starter")
  const [postureRiskBudget, setPostureRiskBudget] = useState("defined risk")
  const [postureConviction, setPostureConviction] = useState("")
  const [posturePrimaryTheme, setPosturePrimaryTheme] = useState("")
  const [postureSecondaryThemes, setPostureSecondaryThemes] = useState("")
  const [postureRelatedAssets, setPostureRelatedAssets] = useState("")
  const [checkpointSummary, setCheckpointSummary] = useState("")
  const [thesisState, setThesisState] = useState<DecisionCheckpointThesisState>("intact")
  const [checkpointAction, setCheckpointAction] = useState<PortfolioCheckpointAction>("keep_active")
  const [reviewDueInput, setReviewDueInput] = useState("")
  const [nowTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let active = true

    if (!portfolioCandidateId) {
      return
    }

    void Promise.all([getPortfolioCandidateDetail(portfolioCandidateId), getLessons()])
      .then(([nextDetail, nextLessons]) => {
        if (active) {
          setDetail(nextDetail)
          setLessons(nextLessons)
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
  }, [portfolioCandidateId])

  const candidate = detail?.candidate ?? null
  const checkpoints = useMemo(() => detail?.checkpoints ?? [], [detail?.checkpoints])
  const memberNameMap = useMemo(
    () => new Map(members.map((entry) => [entry.user.id, entry.user.display_name])),
    [members],
  )
  const latestCheckpoint = useMemo(
    () =>
      checkpoints.reduce<(typeof checkpoints)[number] | null>((latest, checkpoint) => {
        if (!latest) {
          return checkpoint
        }

        return Date.parse(checkpoint.created_at) > Date.parse(latest.created_at) ? checkpoint : latest
      }, null),
    [checkpoints],
  )
  const reviewIsDue = Boolean(candidate?.next_review_due_at && Date.parse(candidate.next_review_due_at) <= nowTimestamp)
  const candidateActivity = useMemo(
    () => (candidate ? activity.filter((event) => event.metadata.portfolio_candidate_id === candidate.id).slice(0, 8) : []),
    [activity, candidate],
  )
  const linkedObsidianLessons = useMemo(
    () =>
      candidate
        ? getLinkedObsidianLessons(lessons, {
            decisionBriefId: candidate.decision_brief_id,
            portfolioCandidateId: candidate.id,
          })
        : [],
    [candidate, lessons],
  )

  useEffect(() => {
    setReviewDueInput(toDateTimeLocalValue(candidate?.next_review_due_at ?? null))
  }, [candidate?.id, candidate?.next_review_due_at])

  useEffect(() => {
    if (!candidate) {
      return
    }

    setPosturePriority(candidate.priority)
    setPostureSizing(candidate.sizing_label)
    setPostureRiskBudget(candidate.risk_budget_label)
    setPostureConviction(candidate.conviction_label)
    setPosturePrimaryTheme(candidate.primary_theme)
    setPostureSecondaryThemes(toCommaSeparatedValue(candidate.secondary_themes))
    setPostureRelatedAssets(toCommaSeparatedValue(candidate.related_assets))
  }, [candidate])

  const refreshDetail = async (candidateId: string) => {
    const [nextDetail] = await Promise.all([getPortfolioCandidateDetail(candidateId), refreshWorkspace()])
    setDetail(nextDetail)
  }

  const handleAssignToMe = async () => {
    if (!candidate || !user) {
      return
    }

    setSavingAssignment(true)
    setMessage(null)

    try {
      await assignPortfolioCandidate(candidate.id, { assignee_user_id: user.id })
      await refreshDetail(candidate.id)
      setMessage("Portfolio ownership updated.")
    } finally {
      setSavingAssignment(false)
    }
  }

  const handleUnassign = async () => {
    if (!candidate) {
      return
    }

    setSavingAssignment(true)
    setMessage(null)

    try {
      await assignPortfolioCandidate(candidate.id, { assignee_user_id: null })
      await refreshDetail(candidate.id)
      setMessage("Portfolio ownership updated.")
    } finally {
      setSavingAssignment(false)
    }
  }

  const handleStatusChange = async (status: PortfolioCandidate["status"]) => {
    if (!candidate) {
      return
    }

    setSavingStatus(true)
    setMessage(null)

    try {
      await updatePortfolioCandidateStatus(candidate.id, {
        status,
        next_review_due_at: status === "closed" ? null : toIsoDateTime(reviewDueInput),
      })
      await refreshDetail(candidate.id)
      setMessage("Portfolio status updated.")
    } finally {
      setSavingStatus(false)
    }
  }

  const handleSavePosture = async () => {
    if (!candidate) {
      return
    }

    setSavingPosture(true)
    setMessage(null)

    try {
      await updatePortfolioCandidatePosture(candidate.id, {
        priority: posturePriority.trim(),
        sizing_label: postureSizing.trim(),
        risk_budget_label: postureRiskBudget.trim(),
        conviction_label: postureConviction.trim(),
        primary_theme: posturePrimaryTheme.trim(),
        secondary_themes: fromCommaSeparatedValue(postureSecondaryThemes).slice(0, 16),
        related_assets: fromCommaSeparatedValue(postureRelatedAssets).slice(0, 24),
        next_review_due_at: toIsoDateTime(reviewDueInput),
      })
      await refreshDetail(candidate.id)
      setMessage("Portfolio posture updated.")
    } finally {
      setSavingPosture(false)
    }
  }

  const handleSaveCheckpoint = async () => {
    if (!candidate || !checkpointSummary.trim()) {
      return
    }

    setSavingCheckpoint(true)
    setMessage(null)

    try {
      const nextDetail = await savePortfolioCheckpoint(candidate.id, {
        summary: checkpointSummary.trim(),
        thesis_state: thesisState,
        action: checkpointAction,
        next_review_due_at: checkpointAction === "close" ? null : toIsoDateTime(reviewDueInput),
      })
      setDetail(nextDetail)
      await refreshWorkspace()
      setCheckpointSummary("")
      setMessage("Portfolio checkpoint saved.")
    } finally {
      setSavingCheckpoint(false)
    }
  }

  const latestCheckpointCreatedAt = latestCheckpoint?.created_at ?? null
  const followThroughHealth = candidate
    ? getPortfolioFollowThroughHealth(candidate, nowTimestamp, latestCheckpointCreatedAt)
    : "candidate"
  const followThroughCopy = getFollowThroughHealthCopy(followThroughHealth)

  return (
    <AppShell
      eyebrow="Phase 8 follow-through"
      title="Portfolio candidate"
      subtitle="Operate one portfolio candidate directly, so assignment, posture, and checkpoints stay anchored to a single live exposure."
    >
      {loading ? (
        <RouteLoadingState
          title="Loading portfolio candidate"
          description="Restoring the candidate detail, posture, and checkpoint trail from the shared portfolio workspace."
        />
      ) : !candidate ? (
        <RouteEmptyState
          title="Portfolio candidate not found"
          description="This candidate could not be restored from the shared portfolio workspace."
        />
      ) : (
        <div className="space-y-6">
          {message ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {message}
            </div>
          ) : null}

          <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Single-candidate workflow</p>
                <h1 className="mt-2 font-display text-3xl font-semibold text-white">{candidate.title}</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-300">{candidate.summary}</p>
              </div>
              <PortfolioStatusBadge status={candidate.status} />
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/portfolio"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Open portfolio desk
              </Link>
              <Link
                href="/portfolio/reviews"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Portfolio reviews
              </Link>
              <Link
                href={`/decisions/${candidate.decision_brief_id}`}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Open decision brief
              </Link>
              <Link
                href={`/predictions/${candidate.lead_prediction_id}`}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Lead prediction
              </Link>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
            <Section title="Current posture">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Sizing and risk</p>
                  <p className="mt-2 text-sm text-zinc-300">{candidate.priority} priority</p>
                  <p className="mt-1 text-sm text-zinc-300">{candidate.sizing_label} sizing</p>
                  <p className="mt-1 text-sm text-zinc-300">{candidate.risk_budget_label} risk budget</p>
                  <p className="mt-1 text-sm text-zinc-300">{candidate.conviction_label} conviction</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Ownership and cadence</p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Owner {memberNameMap.get(candidate.owner_user_id) ?? "Unknown teammate"}
                  </p>
                  <p className="mt-1 text-sm text-zinc-300">
                    Assignee {candidate.assignee_user_id ? memberNameMap.get(candidate.assignee_user_id) ?? "Unknown teammate" : "Unassigned"}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">{formatPortfolioDateTime(candidate.next_review_due_at)}</p>
                  <p className="mt-1 text-xs text-zinc-500">{formatPortfolioRelativeReviewState(candidate.next_review_due_at, nowTimestamp)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Theme exposure</p>
                  <p className="mt-2 text-sm text-zinc-300">Primary {candidate.primary_theme}</p>
                  <p className="mt-1 text-sm text-zinc-300">
                    Secondary {candidate.secondary_themes.length ? candidate.secondary_themes.join(", ") : "None"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Related assets</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {candidate.related_assets.map((asset) => (
                      <span
                        key={`${candidate.id}:${asset}`}
                        className="rounded-full border border-white/10 bg-zinc-950/70 px-2.5 py-1 text-[11px] text-zinc-400"
                      >
                        {asset}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Portfolio posture</p>
                    <p className="mt-2 text-sm text-zinc-300">
                      Update the qualitative posture directly here without changing the candidate status.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSavePosture()}
                    disabled={
                      savingPosture ||
                      !posturePriority.trim() ||
                      !postureSizing.trim() ||
                      !postureRiskBudget.trim() ||
                      !postureConviction.trim() ||
                      !posturePrimaryTheme.trim()
                    }
                    className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-500/60"
                  >
                    {savingPosture ? "Saving posture..." : "Save posture"}
                  </button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Priority</span>
                    <select
                      value={posturePriority}
                      onChange={(event) => setPosturePriority(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/40"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="watch">Watch</option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Sizing</span>
                    <select
                      value={postureSizing}
                      onChange={(event) => setPostureSizing(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/40"
                    >
                      <option value="starter">Starter</option>
                      <option value="core">Core</option>
                      <option value="tactical">Tactical</option>
                      <option value="watchlist">Watchlist</option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Risk budget</span>
                    <input
                      value={postureRiskBudget}
                      onChange={(event) => setPostureRiskBudget(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/40"
                    />
                  </label>

                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Conviction label</span>
                    <input
                      value={postureConviction}
                      onChange={(event) => setPostureConviction(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/40"
                    />
                  </label>

                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Primary theme</span>
                    <input
                      value={posturePrimaryTheme}
                      onChange={(event) => setPosturePrimaryTheme(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/40"
                    />
                  </label>

                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Next review due</span>
                    <input
                      type="datetime-local"
                      value={reviewDueInput}
                      onChange={(event) => setReviewDueInput(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/40"
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Secondary themes</span>
                    <input
                      value={postureSecondaryThemes}
                      onChange={(event) => setPostureSecondaryThemes(event.target.value)}
                      placeholder="Comma-separated optional themes"
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/40"
                    />
                  </label>

                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Related assets</span>
                    <input
                      value={postureRelatedAssets}
                      onChange={(event) => setPostureRelatedAssets(event.target.value)}
                      placeholder="Comma-separated tickers"
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/40"
                    />
                  </label>
                </div>
              </div>
            </Section>

            <Section title="Operating guidance">
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Current posture</p>
                  <p className="mt-2 text-sm leading-7 text-zinc-300">{getCandidateGuidance(candidate, reviewIsDue)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Follow-through health</p>
                  <p className="mt-2 text-sm font-medium text-white">{followThroughCopy.label}</p>
                  <p className="mt-2 text-sm leading-7 text-zinc-300">{followThroughCopy.detail}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Latest checkpoint</p>
                  {latestCheckpoint ? (
                    <>
                      <p className="mt-2 text-sm text-zinc-300">{latestCheckpoint.summary}</p>
                      <p className="mt-2 text-xs text-zinc-500">
                        {latestCheckpoint.action.replace(/_/g, " ")} | {latestCheckpoint.thesis_state} |{" "}
                        {formatRelativeUpdate(latestCheckpoint.created_at, nowTimestamp)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-300">
                      No portfolio checkpoint has been saved yet. This candidate still needs its first follow-through entry.
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Status actions</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {candidate.assignee_user_id !== user?.id ? (
                      <button
                        type="button"
                        onClick={() => void handleAssignToMe()}
                        disabled={savingAssignment || !user}
                        className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Assign to me
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleUnassign()}
                        disabled={savingAssignment}
                        className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Unassign
                      </button>
                    )}
                    {candidate.status !== "closed" && candidate.status !== "active" ? (
                      <button
                        type="button"
                        onClick={() => void handleStatusChange("active")}
                        disabled={savingStatus}
                        className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Mark active
                      </button>
                    ) : null}
                    {candidate.status !== "closed" && candidate.status !== "watching" ? (
                      <button
                        type="button"
                        onClick={() => void handleStatusChange("watching")}
                        disabled={savingStatus}
                        className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-100 transition-colors hover:border-amber-400/40 hover:text-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Move to watching
                      </button>
                    ) : null}
                    {candidate.status !== "closed" && candidate.status !== "trimmed" ? (
                      <button
                        type="button"
                        onClick={() => void handleStatusChange("trimmed")}
                        disabled={savingStatus}
                        className="rounded-full border border-blue-500/25 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-blue-100 transition-colors hover:border-blue-400/40 hover:text-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Mark trimmed
                      </button>
                    ) : null}
                    {candidate.status !== "closed" ? (
                      <button
                        type="button"
                        onClick={() => void handleStatusChange("closed")}
                        disabled={savingStatus}
                        className="rounded-full border border-zinc-500/25 bg-zinc-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-200 transition-colors hover:border-zinc-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Close
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </Section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
            <Section title="Checkpoint follow-through">
              {candidate.status === "closed" ? (
                <RouteEmptyState
                  title="Checkpoint workflow closed"
                  description="Closed portfolio candidates do not accept new checkpoints. Use the board or linked decision brief for retrospective review."
                />
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs uppercase tracking-[0.24em] text-zinc-500" htmlFor="checkpoint-summary">
                      Checkpoint summary
                    </label>
                    <textarea
                      id="checkpoint-summary"
                      value={checkpointSummary}
                      onChange={(event) => setCheckpointSummary(event.target.value)}
                      rows={5}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40"
                      placeholder="What changed, what still matters, and what should happen next?"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-xs uppercase tracking-[0.24em] text-zinc-500" htmlFor="thesis-state">
                        Thesis state
                      </label>
                      <select
                        id="thesis-state"
                        value={thesisState}
                        onChange={(event) => setThesisState(event.target.value as DecisionCheckpointThesisState)}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40"
                      >
                        <option value="intact">Intact</option>
                        <option value="weakened">Weakened</option>
                        <option value="invalidated">Invalidated</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.24em] text-zinc-500" htmlFor="checkpoint-action">
                        Follow-through action
                      </label>
                      <select
                        id="checkpoint-action"
                        value={checkpointAction}
                        onChange={(event) => setCheckpointAction(event.target.value as PortfolioCheckpointAction)}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40"
                      >
                        <option value="keep_active">Keep active</option>
                        <option value="move_to_watching">Move to watching</option>
                        <option value="trim">Trim</option>
                        <option value="close">Close</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Quick presets</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {([
                        { label: "Keep active", action: "keep_active" },
                        { label: "Move to watching", action: "move_to_watching" },
                        { label: "Trim", action: "trim" },
                        { label: "Close", action: "close" },
                      ] as const).map((preset) => (
                        <button
                          key={preset.action}
                          type="button"
                          onClick={() => setCheckpointAction(preset.action)}
                          className={[
                            "rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] transition-colors",
                            checkpointAction === preset.action
                              ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100"
                              : "border-white/10 text-zinc-300 hover:border-white/20 hover:text-white",
                          ].join(" ")}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Action guidance</p>
                    <p className="mt-2 text-sm leading-7 text-zinc-300">{getCheckpointActionGuidance(checkpointAction)}</p>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="text-xs uppercase tracking-[0.24em] text-zinc-500" htmlFor="review-due">
                        Next review due
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[3, 7, 14].map((days) => (
                          <button
                            key={days}
                            type="button"
                            onClick={() => setReviewDueInput(buildReviewPreset(days))}
                            className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition hover:border-white/20 hover:text-white"
                          >
                            +{days}d
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      id="review-due"
                      type="datetime-local"
                      value={reviewDueInput}
                      onChange={(event) => setReviewDueInput(event.target.value)}
                      disabled={checkpointAction === "close"}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleSaveCheckpoint()}
                    disabled={savingCheckpoint || !checkpointSummary.trim()}
                    className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-500/60"
                  >
                    {savingCheckpoint ? "Saving checkpoint..." : "Save portfolio checkpoint"}
                  </button>
                </div>
              )}
            </Section>

            <Section title="Checkpoint history">
              {checkpoints.length ? (
                <div className="space-y-3">
                  {checkpoints.map((checkpoint) => (
                    <div key={checkpoint.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">{checkpoint.summary}</p>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          {formatRelativeUpdate(checkpoint.created_at, nowTimestamp)}
                        </p>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">
                        {checkpoint.action.replace(/_/g, " ")} | {checkpoint.thesis_state}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <RouteEmptyState
                  title="No checkpoints yet"
                  description="The first portfolio checkpoint will appear here once this candidate begins its follow-through loop."
                />
              )}
            </Section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
            <Section title="Recent portfolio history">
              {candidateActivity.length ? (
                <div className="space-y-3">
                  {candidateActivity.map((event) => (
                    <div key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{formatWorkspaceActivityKind(event.kind)}</p>
                          <p className="mt-2 text-sm text-zinc-300">{event.detail}</p>
                        </div>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          {formatRelativeUpdate(event.created_at, nowTimestamp)}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {getWorkspaceActivityReferences(event).map((reference) => (
                          <Link
                            key={`${event.id}:${reference.href}`}
                            href={reference.href}
                            className="rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400 transition hover:border-white/20 hover:text-white"
                          >
                            {reference.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <RouteEmptyState
                  title="No portfolio history yet"
                  description="Portfolio activity will appear here once this candidate is assigned, moved, or checkpointed."
                />
              )}
            </Section>

            <Section title="Linked Obsidian memory">
              <LinkedObsidianMemoryPanel
                lessons={linkedObsidianLessons}
                emptyDescription="No reviewed Human Inbox note is linked to this portfolio candidate yet. Linked imported notes will appear here as retrieval-only memory for the live exposure."
              />
            </Section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
            <Section title="Linked operating objects">
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Decision brief</p>
                  <p className="mt-2 text-sm text-zinc-300">The shared brief remains the research and decision anchor behind this candidate.</p>
                  <Link
                    href={`/decisions/${candidate.decision_brief_id}`}
                    className="mt-3 inline-flex rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition hover:border-white/20 hover:text-white"
                  >
                    Open decision brief
                  </Link>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Lead prediction</p>
                  <p className="mt-2 text-sm text-zinc-300">The lead prediction remains the core directional evidence behind this portfolio candidate.</p>
                  <Link
                    href={`/predictions/${candidate.lead_prediction_id}`}
                    className="mt-3 inline-flex rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition hover:border-white/20 hover:text-white"
                  >
                    Open prediction
                  </Link>
                </div>
              </div>
            </Section>
          </div>
        </div>
      )}
    </AppShell>
  )
}
