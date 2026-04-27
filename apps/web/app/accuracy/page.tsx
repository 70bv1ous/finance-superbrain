"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

import { AppShell } from "@/components/AppShell"
import { ConfidenceBadge } from "@/components/ConfidenceBadge"
import { DecisionStatusBadge } from "@/components/DecisionStatusBadge"
import { InvestigationStatusBadge } from "@/components/InvestigationStatusBadge"
import { InvestigationTrailActions, InvestigationTrailSteps, InvestigationTrailSummary } from "@/components/InvestigationTrailView"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import {
  getAccuracyStats,
  getRecentPredictions,
  markOutcome,
  type AccuracyStats,
  type PredictionRow,
} from "@/lib/chatApi"
import { getInvestigationStatusSummary, getTrailStatus } from "@/lib/investigationTrail"
import { getPredictionReviewNote, savePredictionReviewNote } from "@/lib/predictionApi"
import { filterReviewPredictions, getReviewState, normalizeConfidenceLevel, type ReviewState } from "@/lib/reviewDesk"

type OutcomeValue = "correct" | "incorrect" | "partial"

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function formatEventType(value: string) {
  return value.replace(/_/g, " ")
}

function formatRelativeDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function Panel({
  title,
  eyebrow,
  children,
}: {
  title: string
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
      {eyebrow ? <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">{eyebrow}</p> : null}
      <h2 className="mt-2 font-display text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function StatCard({
  label,
  value,
  detail,
  tone = "text-white",
}: {
  label: string
  value: string
  detail: string
  tone?: string
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
      <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">{label}</p>
      <p className={classNames("mt-3 text-4xl font-semibold", tone)}>{value}</p>
      <p className="mt-2 text-sm text-zinc-500">{detail}</p>
    </div>
  )
}

function ReviewStateBadge({ state }: { state: Exclude<ReviewState, "all"> }) {
  const config: Record<Exclude<ReviewState, "all">, string> = {
    awaiting_verdict: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    scored: "border-blue-500/30 bg-blue-500/10 text-blue-200",
    reviewed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  }

  return (
    <span className={classNames("rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.24em]", config[state])}>
      {state.replace(/_/g, " ")}
    </span>
  )
}

function OutcomeBadge({ outcome }: { outcome: OutcomeValue }) {
  const config: Record<OutcomeValue, string> = {
    correct: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    partial: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    incorrect: "border-red-500/30 bg-red-500/10 text-red-200",
  }

  return (
    <span className={classNames("rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.24em]", config[outcome])}>
      {outcome}
    </span>
  )
}

function PredictionListItem({
  prediction,
  decisionStatus,
  ownershipLabel,
  selected,
  onSelect,
}: {
  prediction: PredictionRow
  decisionStatus?: "draft" | "proposed" | "active" | "watching" | "closed" | null
  ownershipLabel?: string | null
  selected: boolean
  onSelect: () => void
}) {
  const reviewState = getReviewState(prediction)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={classNames(
        "w-full rounded-[24px] border p-4 text-left transition-colors",
        selected ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/5 hover:border-white/20",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ConfidenceBadge level={normalizeConfidenceLevel(prediction.confidence_level)} />
          <ReviewStateBadge state={reviewState} />
          {prediction.outcome ? <OutcomeBadge outcome={prediction.outcome} /> : null}
          {decisionStatus ? <DecisionStatusBadge status={decisionStatus} /> : null}
          {ownershipLabel ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
              {ownershipLabel}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-zinc-500">{formatRelativeDate(prediction.created_at)}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-white">{formatEventType(prediction.event_type)}</p>
      <p className="mt-2 line-clamp-2 text-sm text-zinc-300">{prediction.query}</p>
      <p className="mt-2 line-clamp-2 text-xs text-zinc-500">{prediction.answer_summary}</p>
    </button>
  )
}

function AccuracyWorkspacePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { assignInvestigation, decisionBriefs, investigationTrails, members, recordInvestigationStep, rememberRecentItem, user } = useWorkspace()
  const [stats, setStats] = useState<AccuracyStats | null>(null)
  const [predictions, setPredictions] = useState<PredictionRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewFilter, setReviewFilter] = useState<ReviewState>("awaiting_verdict")
  const [search, setSearch] = useState("")
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const [sharedReviewNotes, setSharedReviewNotes] = useState<Record<string, { note: string; ownerUserId: string } | null>>({})
  const [busyOutcome, setBusyOutcome] = useState<OutcomeValue | null>(null)
  const [reviewNotePending, setReviewNotePending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    Promise.all([getAccuracyStats(), getRecentPredictions(40)])
      .then(([statsResponse, predictionsResponse]) => {
        if (!active) {
          return
        }

        setStats(statsResponse)
        setPredictions(predictionsResponse)
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

  const filteredPredictions = useMemo(
    () => filterReviewPredictions(predictions, { reviewFilter, search }),
    [predictions, reviewFilter, search],
  )

  const unresolved = useMemo(() => predictions.filter((prediction) => !prediction.outcome), [predictions])
  const scored = useMemo(
    () => predictions.filter((prediction) => prediction.outcome && !prediction.outcome_notes?.trim()),
    [predictions],
  )
  const reviewed = useMemo(
    () => predictions.filter((prediction) => prediction.outcome && prediction.outcome_notes?.trim()),
    [predictions],
  )
  const nextAwaitingVerdict = useMemo(() => filterReviewPredictions(predictions, { reviewFilter: "awaiting_verdict", search: "" })[0] ?? null, [predictions])
  const nextScoredOnly = useMemo(() => filterReviewPredictions(predictions, { reviewFilter: "scored", search: "" })[0] ?? null, [predictions])
  const latestReviewed = useMemo(() => filterReviewPredictions(predictions, { reviewFilter: "reviewed", search: "" })[0] ?? null, [predictions])

  const focusedPredictionId = searchParams.get("focus")
  const effectiveSelectedId = filteredPredictions.some((prediction) => prediction.id === focusedPredictionId)
    ? focusedPredictionId
    : filteredPredictions.some((prediction) => prediction.id === selectedId)
      ? selectedId
      : filteredPredictions[0]?.id ?? null
  const selectedPrediction = filteredPredictions.find((prediction) => prediction.id === effectiveSelectedId) ?? null
  const matchingTrail = selectedPrediction
    ? investigationTrails.find((trail) => trail.predictionIds.includes(selectedPrediction.id)) ?? null
    : null
  const decisionBriefByPredictionId = useMemo(
    () => new Map(decisionBriefs.map((brief) => [brief.lead_prediction_id, brief])),
    [decisionBriefs],
  )
  const decisionBriefByInvestigationId = useMemo(
    () => new Map(decisionBriefs.map((brief) => [brief.investigation_id, brief])),
    [decisionBriefs],
  )
  const selectedDecisionBrief = selectedPrediction ? decisionBriefByPredictionId.get(selectedPrediction.id) ?? null : null
  const persistedSharedNote = selectedPrediction ? sharedReviewNotes[selectedPrediction.id]?.note?.trim() ?? "" : ""
  const persistedNoteText = persistedSharedNote || selectedPrediction?.outcome_notes?.trim() || ""
  const reviewNoteHydrating = selectedPrediction ? !(selectedPrediction.id in sharedReviewNotes) : false
  const notes = selectedPrediction
    ? draftNotes[selectedPrediction.id] ?? persistedNoteText
    : ""
  const trimmedNotes = notes.trim()
  const persistedNotes = persistedNoteText
  const notesDirty = selectedPrediction ? trimmedNotes !== persistedNotes : false

  useEffect(() => {
    if (!selectedPrediction) {
      return
    }

    const currentFocused = searchParams.get("focus")

    if (currentFocused === selectedPrediction.id) {
      return
    }

    router.replace(`/accuracy?focus=${selectedPrediction.id}`, { scroll: false })
  }, [router, searchParams, selectedPrediction])

  useEffect(() => {
    if (!selectedPrediction) {
      return
    }

    const reviewState = getReviewState(selectedPrediction)

    rememberRecentItem({
      id: `accuracy-review:${selectedPrediction.id}`,
      kind: "prediction",
      href: `/accuracy?focus=${selectedPrediction.id}`,
      title: selectedPrediction.query,
      description: `${formatEventType(selectedPrediction.event_type)} | ${reviewState.replace(/_/g, " ")}${
        selectedPrediction.outcome ? ` | ${selectedPrediction.outcome}` : ""
      }`,
      updatedAt: new Date().toISOString(),
    })
    recordInvestigationStep({
      title: matchingTrail?.title || selectedPrediction.query,
      predictionId: selectedPrediction.id,
      href: `/accuracy?focus=${selectedPrediction.id}`,
      detail: selectedPrediction.outcome
        ? selectedPrediction.outcome_notes?.trim()
          ? "Reviewed prediction reopened with notes already captured."
          : "Scored prediction reopened so the operator can finish review notes."
        : "Prediction entered the review desk and still needs its first verdict.",
      updatedAt: new Date().toISOString(),
      kind: "review_focus",
      status: selectedPrediction.outcome
        ? selectedPrediction.outcome_notes?.trim()
          ? "reviewed"
          : "under_review"
        : "ready_for_review",
    })
  }, [matchingTrail?.title, recordInvestigationStep, rememberRecentItem, selectedPrediction])

  useEffect(() => {
    let active = true

    if (!selectedPrediction) {
      return
    }

    void getPredictionReviewNote(selectedPrediction.id)
      .then((note) => {
        if (!active) {
          return
        }

        setSharedReviewNotes((current) => ({
          ...current,
          [selectedPrediction.id]: note
            ? {
                note: note.note,
                ownerUserId: note.owner_user_id,
              }
            : null,
        }))
      })

    return () => {
      active = false
    }
  }, [selectedPrediction])

  const selectedInvestigationStatus = matchingTrail
    ? getTrailStatus(matchingTrail)
    : selectedPrediction?.outcome
      ? selectedPrediction.outcome_notes?.trim()
        ? "reviewed"
        : "under_review"
      : "ready_for_review"
  const memberNameMap = useMemo(
    () => new Map(members.map((entry) => [entry.user.id, entry.user.display_name])),
    [members],
  )
  const trailByPredictionId = useMemo(() => {
    const next = new Map<string, (typeof investigationTrails)[number]>()

    for (const trail of investigationTrails) {
      for (const predictionId of trail.predictionIds) {
        if (!next.has(predictionId)) {
          next.set(predictionId, trail)
        }
      }
    }

    return next
  }, [investigationTrails])
  const selectedAssigneeName = matchingTrail?.assigneeUserId
    ? memberNameMap.get(matchingTrail.assigneeUserId) ?? "Unknown teammate"
    : "Unassigned"
  const selectedOwnerName = matchingTrail?.ownerUserId
    ? memberNameMap.get(matchingTrail.ownerUserId) ?? "Unknown teammate"
    : "Not set"
  const selectedReviewNoteOwnerName = selectedPrediction
    ? sharedReviewNotes[selectedPrediction.id]?.ownerUserId
      ? memberNameMap.get(sharedReviewNotes[selectedPrediction.id]?.ownerUserId ?? "") ?? "Unknown teammate"
      : null
    : null

  const domainLeaders = useMemo(() => {
    const entries = Object.entries(stats?.by_event_type ?? {})

    return entries
      .filter(([, value]) => value.total > 0)
      .sort((left, right) => right[1].pct - left[1].pct)
      .slice(0, 4)
  }, [stats])

  const confidenceSummary = useMemo(() => {
    const entries = Object.entries(stats?.by_confidence ?? {})

    return entries
      .filter(([, value]) => value.total > 0)
      .sort((left, right) => right[1].pct - left[1].pct)
  }, [stats])
  const sharedReviewTrails = useMemo(
    () =>
      investigationTrails.filter((trail) => {
        const status = getTrailStatus(trail)
        return status === "ready_for_review" || status === "under_review"
      }),
    [investigationTrails],
  )
  const assignedToMePredictions = useMemo(
    () =>
      predictions.filter((prediction) => {
        const trail = trailByPredictionId.get(prediction.id)
        const status = trail ? getTrailStatus(trail) : null
        return Boolean(
          user?.id &&
            trail &&
            trail.assigneeUserId === user.id &&
            (status === "ready_for_review" || status === "under_review"),
        )
      }),
    [predictions, trailByPredictionId, user],
  )
  const unassignedReviewPredictions = useMemo(
    () =>
      predictions.filter((prediction) => {
        const trail = trailByPredictionId.get(prediction.id)
        const status = trail ? getTrailStatus(trail) : null
        return Boolean(trail && !trail.assigneeUserId && (status === "ready_for_review" || status === "under_review"))
      }),
    [predictions, trailByPredictionId],
  )
  const assignedToTeammatePredictions = useMemo(
    () =>
      predictions.filter((prediction) => {
        const trail = trailByPredictionId.get(prediction.id)
        const status = trail ? getTrailStatus(trail) : null
        return Boolean(
          user?.id &&
            trail?.assigneeUserId &&
            trail.assigneeUserId !== user.id &&
            (status === "ready_for_review" || status === "under_review"),
        )
      }),
    [predictions, trailByPredictionId, user],
  )

  async function persistReview(
    outcome: OutcomeValue,
    successMessage: string,
    options: {
      syncSharedNote?: boolean
    } = {},
  ) {
    if (!selectedPrediction) {
      return
    }

    setBusyOutcome(outcome)
    setMessage(null)

    const success = await markOutcome(selectedPrediction.session_id, outcome, trimmedNotes)

    if (!success) {
      setBusyOutcome(null)
      setMessage("Could not save the outcome. Please retry.")
      return
    }

    if (options.syncSharedNote && trimmedNotes) {
      setReviewNotePending(true)

      try {
        const savedNote = await savePredictionReviewNote(selectedPrediction.id, trimmedNotes)
        setSharedReviewNotes((current) => ({
          ...current,
          [selectedPrediction.id]: {
            note: savedNote.note,
            ownerUserId: savedNote.owner_user_id,
          },
        }))
      } catch {
        setBusyOutcome(null)
        setReviewNotePending(false)
        setMessage("Outcome saved, but team review notes could not be synced yet.")
        return
      }

      setReviewNotePending(false)
    }

    const refreshedPredictions = await getRecentPredictions(40)
    const refreshedStats = await getAccuracyStats()

    setPredictions(refreshedPredictions)
    setStats(refreshedStats)
    setDraftNotes((current) => ({
      ...current,
      [selectedPrediction.id]: trimmedNotes,
    }))
    setBusyOutcome(null)
    setMessage(successMessage)

    const refreshedFiltered = filterReviewPredictions(refreshedPredictions, { reviewFilter, search })
    const nextSelection =
      refreshedFiltered.find((prediction) => !prediction.outcome)?.id ??
      refreshedFiltered.find((prediction) => prediction.id !== selectedPrediction.id)?.id ??
      refreshedFiltered[0]?.id ??
      null

    setSelectedId(nextSelection)

    if (nextSelection) {
      router.replace(`/accuracy?focus=${nextSelection}`, { scroll: false })
    } else {
      router.replace("/accuracy", { scroll: false })
    }
  }

  async function handleOutcome(outcome: OutcomeValue) {
    const successMessage =
      outcome === "correct" ? "Marked correct." : outcome === "partial" ? "Marked partial." : "Marked incorrect."

    await persistReview(outcome, successMessage, { syncSharedNote: trimmedNotes.length > 0 })
  }

  async function handleSaveReviewNotes() {
    if (!selectedPrediction?.outcome) {
      return
    }

    const successMessage = persistedNotes
      ? "Updated review notes."
      : "Saved review notes and moved this item into the reviewed lane."

    await persistReview(selectedPrediction.outcome, successMessage, { syncSharedNote: true })
  }

  return (
    <AppShell
      title="Accuracy"
      subtitle="Run the operator review desk: resolve outstanding predictions, capture notes, and monitor where the learning loop is strong or slipping."
      actions={
        <button
          type="button"
          onClick={() => {
            setReviewFilter("awaiting_verdict")
            setSearch("")
            setSelectedId(null)
            setMessage(null)
            router.replace("/accuracy", { scroll: false })
          }}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100"
        >
          Reset focus
        </button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Awaiting verdict"
          value={String(unresolved.length)}
          detail="Predictions that still need a first outcome call."
          tone={unresolved.length ? "text-amber-300" : "text-emerald-300"}
        />
        <StatCard
          label="Scored only"
          value={String(scored.length)}
          detail="Resolved predictions without deeper review notes yet."
          tone={scored.length ? "text-blue-200" : "text-zinc-500"}
        />
        <StatCard
          label="Reviewed"
          value={String(reviewed.length)}
          detail="Predictions already carrying notes or postmortem context."
          tone="text-emerald-300"
        />
        <StatCard
          label="Overall accuracy"
          value={formatPercent((stats?.overall_accuracy_pct ?? 0) * 100)}
          detail={`${stats?.total_resolved ?? 0} resolved of ${stats?.total_logged ?? 0} logged predictions.`}
          tone="text-white"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.9fr)]">
          <Panel title="Review desk" eyebrow="Action queue">
          <div className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-center">
            <div className="flex flex-wrap gap-2">
              {[
                { id: "awaiting_verdict", label: "Awaiting verdict" },
                { id: "scored", label: "Scored" },
                { id: "reviewed", label: "Reviewed" },
                { id: "all", label: "All recent" },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setReviewFilter(option.id as ReviewState)}
                  className={classNames(
                    "rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.24em] transition-colors",
                    reviewFilter === option.id
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-100",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search thesis, answer, or event type..."
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none lg:max-w-sm"
            />
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <RouteLoadingState
                title="Loading review desk"
                description="Recent prediction rows and the current review queue are being loaded."
              />
            ) : filteredPredictions.length ? (
              filteredPredictions.map((prediction) => (
                <PredictionListItem
                  key={prediction.id}
                  prediction={prediction}
                  decisionStatus={decisionBriefByPredictionId.get(prediction.id)?.status ?? null}
                  ownershipLabel={
                    (() => {
                      const trail = trailByPredictionId.get(prediction.id)

                      if (!trail) {
                        return null
                      }

                      if (trail.assigneeUserId === user?.id) {
                        return "assigned to me"
                      }

                      if (!trail.assigneeUserId) {
                        return "unassigned"
                      }

                      return `assigned to ${memberNameMap.get(trail.assigneeUserId) ?? "teammate"}`
                    })()
                  }
                  selected={prediction.id === effectiveSelectedId}
                  onSelect={() => {
                    setSelectedId(prediction.id)
                    setMessage(null)
                    router.replace(`/accuracy?focus=${prediction.id}`, { scroll: false })
                  }}
                />
              ))
            ) : (
              <RouteEmptyState
                title="No predictions match this review state"
                description="Try another queue filter or search term to widen the current review desk."
              />
            )}
          </div>
          </Panel>

        <div className="space-y-6">
          <Panel title="Shared review queue" eyebrow="Team-owned investigations">
            <div className="space-y-3">
              {sharedReviewTrails.length ? (
                sharedReviewTrails.slice(0, 6).map((trail) => {
                  const status = getTrailStatus(trail)
                  const assigneeLabel = trail.assigneeUserId
                    ? memberNameMap.get(trail.assigneeUserId) ?? "Unknown teammate"
                    : "Unassigned"
                  const linkedDecisionBrief = decisionBriefByInvestigationId.get(trail.id) ?? null

                  return (
                    <div key={trail.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{trail.title}</p>
                          <p className="mt-2 text-xs text-zinc-500">
                            {trail.predictionIds.length} prediction{trail.predictionIds.length === 1 ? "" : "s"} | assignee{" "}
                            <span className="text-zinc-300">{assigneeLabel}</span>
                          </p>
                        </div>
                        <InvestigationStatusBadge status={status} />
                      </div>
                      <p className="mt-3 text-sm text-zinc-400">{getInvestigationStatusSummary(status)}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {linkedDecisionBrief ? (
                          <>
                            <DecisionStatusBadge status={linkedDecisionBrief.status} />
                            <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                              Decision brief linked
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                            Research trail only
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <InvestigationTrailActions trail={trail} />
                        {linkedDecisionBrief ? (
                          <button
                            type="button"
                            onClick={() => {
                              router.push(`/decisions/${linkedDecisionBrief.id}`)
                            }}
                            className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-200/40 hover:text-white"
                          >
                            Open brief
                          </button>
                        ) : null}
                        {trail.assigneeUserId !== user?.id && user?.id ? (
                          <button
                            type="button"
                            onClick={() => {
                              void assignInvestigation(trail.id, user.id)
                            }}
                            className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50"
                          >
                            Assign to me
                          </button>
                        ) : trail.assigneeUserId ? (
                          <button
                            type="button"
                            onClick={() => {
                              void assignInvestigation(trail.id, null)
                            }}
                            className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                          >
                            Unassign
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              ) : (
                <RouteEmptyState
                  title="No shared review trails yet"
                  description="Studio runs that are ready for review will appear here even before the older session-based accuracy log catches up."
                />
              )}
            </div>
          </Panel>

          <Panel title="What needs action next" eyebrow="Operator guidance">
            <div className="space-y-3">
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Immediate queue</p>
                <p className="mt-2 text-2xl font-semibold text-white">{unresolved.length}</p>
                <p className="mt-2 text-sm text-zinc-500">Predictions waiting for their first verdict.</p>
                {nextAwaitingVerdict ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewFilter("awaiting_verdict")
                      setSearch("")
                      setSelectedId(nextAwaitingVerdict.id)
                      setMessage(null)
                      router.replace(`/accuracy?focus=${nextAwaitingVerdict.id}`, { scroll: false })
                    }}
                    className="mt-3 rounded-full border border-amber-300/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-100 transition-colors hover:border-amber-200/40"
                  >
                    Focus next verdict
                  </button>
                ) : null}
              </div>
              <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Follow-up desk</p>
                <p className="mt-2 text-2xl font-semibold text-white">{scored.length}</p>
                <p className="mt-2 text-sm text-zinc-500">Resolved predictions that still need review notes.</p>
                {nextScoredOnly ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewFilter("scored")
                      setSearch("")
                      setSelectedId(nextScoredOnly.id)
                      setMessage(null)
                      router.replace(`/accuracy?focus=${nextScoredOnly.id}`, { scroll: false })
                    }}
                    className="mt-3 rounded-full border border-blue-300/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-blue-100 transition-colors hover:border-blue-200/40"
                  >
                    Focus next review
                  </button>
                ) : null}
              </div>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Review cadence</p>
                <p className="mt-2 text-2xl font-semibold text-white">{reviewed.length}</p>
                <p className="mt-2 text-sm text-zinc-500">Recent predictions with notes captured for later lesson lookup.</p>
                {latestReviewed ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewFilter("reviewed")
                      setSearch("")
                      setSelectedId(latestReviewed.id)
                      setMessage(null)
                      router.replace(`/accuracy?focus=${latestReviewed.id}`, { scroll: false })
                    }}
                    className="mt-3 rounded-full border border-emerald-300/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-200/40"
                  >
                    Reopen latest reviewed
                  </button>
                ) : null}
              </div>
            </div>
          </Panel>

          <Panel title="Team queue" eyebrow="Assignment visibility">
            <div className="space-y-3">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Assigned to me</p>
                <p className="mt-2 text-2xl font-semibold text-white">{assignedToMePredictions.length}</p>
                <p className="mt-2 text-sm text-zinc-500">Review trails currently owned by this operator.</p>
                {assignedToMePredictions[0] ? (
                  <button
                    type="button"
                    onClick={() => {
                      const prediction = assignedToMePredictions[0]
                      setSelectedId(prediction.id)
                      setMessage(null)
                      router.replace(`/accuracy?focus=${prediction.id}`, { scroll: false })
                    }}
                    className="mt-3 rounded-full border border-emerald-300/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-200/40"
                  >
                    Open my next review
                  </button>
                ) : null}
              </div>
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Unassigned review</p>
                <p className="mt-2 text-2xl font-semibold text-white">{unassignedReviewPredictions.length}</p>
                <p className="mt-2 text-sm text-zinc-500">Ready-for-review work that still needs an owner.</p>
                {unassignedReviewPredictions[0] ? (
                  <button
                    type="button"
                    onClick={() => {
                      const prediction = unassignedReviewPredictions[0]
                      setSelectedId(prediction.id)
                      setMessage(null)
                      router.replace(`/accuracy?focus=${prediction.id}`, { scroll: false })
                    }}
                    className="mt-3 rounded-full border border-amber-300/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-100 transition-colors hover:border-amber-200/40"
                  >
                    Claim next review
                  </button>
                ) : null}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Assigned elsewhere</p>
                <p className="mt-2 text-2xl font-semibold text-white">{assignedToTeammatePredictions.length}</p>
                <p className="mt-2 text-sm text-zinc-500">Predictions already being worked by another teammate.</p>
              </div>
            </div>
          </Panel>

          <Panel title="Selected prediction" eyebrow="Fast outcome marking">
            {!selectedPrediction ? (
              <RouteEmptyState
                title="No prediction selected"
                description="Select a prediction from the review desk to inspect it and record an outcome."
              />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <ConfidenceBadge level={normalizeConfidenceLevel(selectedPrediction.confidence_level)} />
                  <ReviewStateBadge state={getReviewState(selectedPrediction)} />
                  {selectedPrediction.outcome ? <OutcomeBadge outcome={selectedPrediction.outcome} /> : null}
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Question</p>
                  <p className="mt-2 text-sm text-white">{selectedPrediction.query}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Answer summary</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">{selectedPrediction.answer_summary}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Event type</p>
                    <p className="mt-2 text-sm text-white">{formatEventType(selectedPrediction.event_type)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Analogs referenced</p>
                    <p className="mt-2 text-sm text-white">{selectedPrediction.analogues_count}</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.24em] text-zinc-500" htmlFor="review-notes">
                    Review notes
                  </label>
                  <textarea
                    id="review-notes"
                    value={notes}
                    onChange={(event) => {
                      if (!selectedPrediction) {
                        return
                      }

                      const nextValue = event.target.value

                      setDraftNotes((current) => ({
                        ...current,
                        [selectedPrediction.id]: nextValue,
                      }))
                    }}
                    rows={5}
                    placeholder="Capture what actually happened, why the thesis held or failed, and anything the next review should remember."
                    className="mt-2 w-full rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                  />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Review boundary</p>
                  <p className="mt-2 text-sm text-zinc-400">
                    Outcome scoring stays tied to the historical accuracy log, while review notes now sync into the shared team workspace so teammates see the same follow-up context.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Investigation status</p>
                    <InvestigationStatusBadge status={selectedInvestigationStatus} />
                  </div>
                  <p className="mt-3 text-sm text-zinc-300">{getInvestigationStatusSummary(selectedInvestigationStatus)}</p>
                  <div className="mt-3 grid gap-3 text-xs text-zinc-500 sm:grid-cols-2">
                    <p>
                      Owner <span className="text-zinc-300">{selectedOwnerName}</span>
                    </p>
                    <p>
                      Assignee <span className="text-zinc-300">{selectedAssigneeName}</span>
                    </p>
                  </div>
                  {matchingTrail ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {matchingTrail.assigneeUserId !== user?.id && user?.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            void assignInvestigation(matchingTrail.id, user.id)
                          }}
                          className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50"
                        >
                          Assign to me
                        </button>
                      ) : matchingTrail.assigneeUserId ? (
                        <button
                          type="button"
                          onClick={() => {
                            void assignInvestigation(matchingTrail.id, null)
                          }}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Unassign
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Decision brief</p>
                    {selectedDecisionBrief ? <DecisionStatusBadge status={selectedDecisionBrief.status} /> : null}
                  </div>
                  <p className="mt-2 text-sm text-zinc-400">
                    {selectedDecisionBrief
                      ? "This reviewed prediction already anchors a shared decision workflow, so any follow-through should continue in the brief rather than in isolated notes."
                      : "This prediction has not been promoted into a shared decision brief yet. Review can finish here first, then the thesis can move into the decision workflow when it is ready."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedDecisionBrief ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            router.push(`/decisions/${selectedDecisionBrief.id}`)
                          }}
                          className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-200/40 hover:text-white"
                        >
                          Open decision brief
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            router.push("/decisions")
                          }}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Open decision desk
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {selectedPrediction?.outcome ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Team review note</p>
                      {reviewNoteHydrating ? (
                        <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Syncing...</span>
                      ) : selectedReviewNoteOwnerName ? (
                        <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          by {selectedReviewNoteOwnerName}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-zinc-400">
                      Shared notes persist with the investigation so any teammate can reopen the same context later.
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {(["correct", "partial", "incorrect"] as OutcomeValue[]).map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      onClick={() => void handleOutcome(outcome)}
                      disabled={busyOutcome !== null}
                      className={classNames(
                        "rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        outcome === "correct" && "bg-emerald-500 text-black hover:bg-emerald-400",
                        outcome === "partial" && "bg-amber-400 text-black hover:bg-amber-300",
                        outcome === "incorrect" && "bg-red-500 text-white hover:bg-red-400",
                      )}
                    >
                      {busyOutcome === outcome ? "Saving..." : `Mark ${outcome}`}
                    </button>
                  ))}
                  {selectedPrediction?.outcome ? (
                    <button
                      type="button"
                      onClick={() => void handleSaveReviewNotes()}
                      disabled={busyOutcome !== null || reviewNotePending || !notesDirty}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-zinc-600"
                    >
                      {busyOutcome === selectedPrediction.outcome || reviewNotePending
                        ? "Saving..."
                        : persistedNotes
                          ? "Update review notes"
                          : "Save review notes"}
                    </button>
                  ) : null}
                </div>

                {selectedPrediction?.outcome ? (
                  <p className="text-xs text-zinc-500">
                    Outcome is already set to <span className="text-zinc-300">{selectedPrediction.outcome}</span>. Use review notes to capture the postmortem and move this item into the reviewed lane.
                  </p>
                ) : null}

                {message ? <p className="text-sm text-zinc-400">{message}</p> : null}
              </div>
            )}
          </Panel>

          <Panel title="Investigation trail" eyebrow="Cross-workspace continuity">
            {!matchingTrail ? (
              <RouteEmptyState
                title="No shared trail recorded yet"
                description="Open this prediction through Studio or prediction detail and the trail will accumulate here automatically."
              />
            ) : (
              <div className="space-y-3">
                <InvestigationTrailSummary
                  trail={matchingTrail}
                  label="Trail"
                  actions={<InvestigationTrailActions trail={matchingTrail} />}
                />
                <InvestigationTrailSteps
                  steps={matchingTrail.steps}
                  limit={4}
                  actionMode="button"
                  onOpenStep={(href) => router.push(href)}
                />
              </div>
            )}
          </Panel>

          <Panel title="Where the engine is strongest" eyebrow="Pattern read">
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">By event type</p>
                {domainLeaders.length ? (
                  <div className="mt-3 space-y-3">
                    {domainLeaders.map(([eventType, value]) => (
                      <div key={eventType}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-zinc-300">{formatEventType(eventType)}</span>
                          <span className="font-mono text-zinc-500">
                            {formatPercent(value.pct * 100)} | {value.correct}/{value.total}
                          </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5">
                          <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${Math.max(6, value.pct * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">Resolved event-type accuracy will appear as more verdicts accumulate.</p>
                )}
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">By confidence</p>
                {confidenceSummary.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {confidenceSummary.map(([confidence, value]) => (
                      <div key={confidence} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{confidence}</p>
                        <p className="mt-2 text-xl font-semibold text-white">{formatPercent(value.pct * 100)}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {value.correct}/{value.total} resolved
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">Confidence calibration will populate as verdict history grows.</p>
                )}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}

export default function AccuracyPage() {
  return (
    <Suspense
      fallback={
        <AppShell
          title="Accuracy"
          subtitle="Run the operator review desk: resolve outstanding predictions, capture notes, and monitor where the learning loop is strong or slipping."
        >
          <div className="animate-pulse text-sm text-zinc-500">Loading review desk...</div>
        </AppShell>
      }
    >
      <AccuracyWorkspacePage />
    </Suspense>
  )
}
