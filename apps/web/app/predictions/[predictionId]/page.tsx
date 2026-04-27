"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import type { Postmortem, PredictionOutcome, StoredEvent, StoredPrediction, StoredSource } from "@finance-superbrain/schemas"

import { AppShell } from "@/components/AppShell"
import { ConfidenceBadge } from "@/components/ConfidenceBadge"
import { DecisionStatusBadge } from "@/components/DecisionStatusBadge"
import { InvestigationStatusBadge } from "@/components/InvestigationStatusBadge"
import { InvestigationTrailActions, InvestigationTrailSteps, InvestigationTrailSummary } from "@/components/InvestigationTrailView"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import { createDecisionBrief } from "@/lib/decisionApi"
import { getInvestigationStatusSummary, getTrailStatus, type InvestigationTrail } from "@/lib/investigationTrail"
import {
  getPredictionDetail,
  getPredictionReviewNote,
  savePredictionReviewNote,
  type PredictionDetail,
} from "@/lib/predictionApi"

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

function formatSourceType(value: string) {
  return value.replace(/_/g, " ")
}

function OutcomeBadge({ outcome }: { outcome: PredictionOutcome | null }) {
  if (!outcome) {
    return (
      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-500">
        Awaiting scoring
      </span>
    )
  }

  return (
    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-emerald-200">
      Scored
    </span>
  )
}

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

function ScoreCard({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{formatPercent(value)}</p>
    </div>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2 text-sm text-zinc-300">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="text-zinc-500">-</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function PredictionSummary({ prediction }: { prediction: StoredPrediction }) {
  return (
    <Section title="Prediction summary">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge
          level={prediction.confidence >= 0.75 ? "high" : prediction.confidence >= 0.5 ? "medium" : "low"}
        />
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-400">
          {prediction.horizon}
        </span>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-400">
          {prediction.status}
        </span>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-400">
          {prediction.model_version}
        </span>
      </div>

      <p className="mt-4 text-sm leading-7 text-zinc-200">{prediction.thesis}</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Assets</p>
          <div className="mt-3 space-y-2">
            {prediction.assets.map((asset) => (
              <div key={`${prediction.id}-${asset.ticker}`} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-zinc-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-white">{asset.ticker}</span>
                  <span className="text-zinc-500">{formatPercent(asset.conviction)}</span>
                </div>
                <p className="mt-1 text-zinc-400">
                  {asset.expected_direction} | {asset.expected_magnitude_bp}bp
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Evidence</p>
            <BulletList items={prediction.evidence} />
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Invalidations</p>
            <BulletList items={prediction.invalidations} />
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Assumptions</p>
            <BulletList items={prediction.assumptions} />
          </div>
        </div>
      </div>
    </Section>
  )
}

function EventContextSection({ event, source }: { event: StoredEvent; source: StoredSource }) {
  const sourceMeta = [
    source.title?.trim() ? { label: "Title", value: source.title } : null,
    source.speaker?.trim() ? { label: "Speaker", value: source.speaker } : null,
    source.publisher?.trim() ? { label: "Publisher", value: source.publisher } : null,
    source.occurred_at ? { label: "Occurred at", value: formatDateTime(source.occurred_at) } : null,
    source.raw_uri?.trim() ? { label: "Source URI", value: source.raw_uri } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>

  return (
    <Section title="Event context">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div>
          <p className="text-sm leading-7 text-zinc-200">{event.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
              {event.event_class.replace(/_/g, " ")}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
              {event.sentiment.replace(/_/g, " ")}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
              Source {formatSourceType(source.source_type)}
            </span>
          </div>
          {event.why_it_matters.length ? (
            <div className="mt-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Why it mattered</p>
              <BulletList items={event.why_it_matters} />
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Themes and candidate assets</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[...event.themes, ...event.candidate_assets].slice(0, 10).map((item) => (
                <span key={item} className="rounded-full border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-400">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Source metadata</p>
            <div className="mt-3 space-y-3 text-sm text-zinc-300">
              {sourceMeta.length ? (
                sourceMeta.map((item) => (
                  <div key={item.label}>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{item.label}</p>
                    <p className="mt-1 break-words text-zinc-300">{item.value}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No additional source metadata was stored for this event.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Raw source excerpt</p>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              {source.raw_text.length > 360 ? `${source.raw_text.slice(0, 357)}...` : source.raw_text}
            </p>
          </div>
        </div>
      </div>
    </Section>
  )
}

function OutcomeSection({
  outcome,
  postmortem,
}: {
  outcome: PredictionOutcome | null
  postmortem: Postmortem | null
}) {
  if (!outcome) {
    return (
      <Section title="Outcome and review">
        <p className="text-sm text-zinc-500">
          This prediction has not been scored yet. Once the real market outcome is known, it can move into scoring and postmortem review.
        </p>
      </Section>
    )
  }

  return (
    <Section title="Outcome and review">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <ScoreCard label="Direction" value={outcome.direction_score} />
        <ScoreCard label="Magnitude" value={outcome.magnitude_score} />
        <ScoreCard label="Timing" value={outcome.timing_score} />
        <ScoreCard label="Calibration" value={outcome.calibration_score} />
        <ScoreCard label="Total" value={outcome.total_score} />
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Measured at</p>
        <p className="mt-2">{new Date(outcome.measured_at).toLocaleString()}</p>
        {outcome.outcome_payload.dominant_catalyst ? (
          <>
            <p className="mt-4 text-xs uppercase tracking-[0.24em] text-zinc-500">Dominant catalyst</p>
            <p className="mt-2">{outcome.outcome_payload.dominant_catalyst}</p>
          </>
        ) : null}
      </div>

      {postmortem ? (
        <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/80">Postmortem</p>
          <p className="mt-3 text-sm text-emerald-50">{postmortem.critique}</p>
          <p className="mt-3 text-sm font-medium text-emerald-100">Lesson: {postmortem.lesson_summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {postmortem.failure_tags.map((tag) => (
              <span key={tag} className="rounded-full border border-emerald-300/20 bg-black/20 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100/80">
                {tag.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Section>
  )
}

function ReviewNoteSection({
  note,
  saving,
  onChange,
  onSave,
}: {
  note: string
  saving: boolean
  onChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <Section title="Shared review notes">
      <p className="text-sm text-zinc-500">
        Team notes persist with this prediction so review context survives across operator sessions.
      </p>
      <textarea
        value={note}
        onChange={(event) => onChange(event.target.value)}
        className="mt-4 min-h-36 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/40"
        placeholder="Capture verdict context, reviewer judgment, follow-up questions, or handoff notes..."
      />
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !note.trim()}
          className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-500/60"
        >
          {saving ? "Saving note..." : "Save note"}
        </button>
      </div>
    </Section>
  )
}

function DecisionBriefSection({
  briefId,
  briefStatus,
  canCreate,
  onCreate,
  creating,
}: {
  briefId: string | null
  briefStatus: "draft" | "proposed" | "active" | "watching" | "closed" | null
  canCreate: boolean
  onCreate: () => void
  creating: boolean
}) {
  return (
    <Section title="Decision brief handoff">
      {briefId && briefStatus ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Shared decision brief</p>
              <p className="mt-2 text-sm text-zinc-300">
                This prediction already anchors a durable team decision brief for follow-through and closure.
              </p>
            </div>
            <DecisionStatusBadge status={briefStatus} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/decisions/${briefId}`}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Open decision brief
            </Link>
            <Link
              href="/decisions"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Decision desk
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-zinc-300">
            Promote this stored prediction into a shared decision brief when the team wants an explicit thesis owner, follow-up cadence, and closure path.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onCreate}
              disabled={creating || !canCreate}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-500/60"
            >
              {creating ? "Creating brief..." : "Create decision brief"}
            </button>
            <p className="text-xs text-zinc-500">
              {canCreate
                ? "Uses this prediction's thesis, assets, evidence, and invalidations as the starting brief."
                : "Waiting for the shared investigation to finish syncing before promotion is available here."}
            </p>
          </div>
        </div>
      )}
    </Section>
  )
}

function OperatorHandoffSection({
  trail,
  investigationStatus,
}: {
  trail: InvestigationTrail | null
  investigationStatus: "drafting" | "ready_for_review" | "under_review" | "reviewed"
}) {
  if (trail) {
    return (
      <Section title="Operator handoff">
        <div className="space-y-4">
          <InvestigationTrailSummary
            trail={trail}
            label="Shared investigation"
            status={<InvestigationStatusBadge status={investigationStatus} />}
            actions={<InvestigationTrailActions trail={trail} />}
            summary={<p>{getInvestigationStatusSummary(investigationStatus)}</p>}
          />
          <InvestigationTrailSteps steps={trail.steps} limit={3} />
        </div>
      </Section>
    )
  }

  return (
    <Section title="Operator handoff">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Investigation status</p>
          <InvestigationStatusBadge status={investigationStatus} />
        </div>
        <p className="mt-3 text-sm text-zinc-300">{getInvestigationStatusSummary(investigationStatus)}</p>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Link
          href="/studio"
          className="rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20"
        >
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Open Studio</p>
          <p className="mt-2 text-sm font-medium text-white">Reopen the originating event workflow</p>
          <p className="mt-2 text-xs text-zinc-500">Return to Studio and continue building the event workflow from the operator workspace.</p>
        </Link>

        <Link
          href="/accuracy"
          className="rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20"
        >
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Open accuracy</p>
          <p className="mt-2 text-sm font-medium text-white">Check unresolved and scored items</p>
          <p className="mt-2 text-xs text-zinc-500">Use the operator review desk to work through verdicts and capture deeper review notes.</p>
        </Link>

        <Link
          href={investigationStatus === "reviewed" ? "/library" : "/evaluation"}
          className="rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20"
        >
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{investigationStatus === "reviewed" ? "Open library" : "Open evaluation"}</p>
          <p className="mt-2 text-sm font-medium text-white">
            {investigationStatus === "reviewed" ? "Inspect the lesson retrieval desk" : "Review calibration and benchmark context"}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            {investigationStatus === "reviewed"
              ? "Move into the lesson explorer to compare this reviewed prediction against the broader memory library."
              : "Use evaluation views to understand how this kind of prediction should be judged over time."}
          </p>
        </Link>
      </div>
    </Section>
  )
}

export default function PredictionDetailPage() {
  const { decisionBriefs, investigationTrails, recordInvestigationStep, refreshWorkspace, rememberRecentItem } = useWorkspace()
  const params = useParams<{ predictionId: string }>()
  const predictionId = params?.predictionId
  const [detail, setDetail] = useState<PredictionDetail | null>(null)
  const [loadedPredictionId, setLoadedPredictionId] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState("")
  const [savingReviewNote, setSavingReviewNote] = useState(false)
  const [creatingDecisionBrief, setCreatingDecisionBrief] = useState(false)
  const matchingTrail =
    detail?.prediction && detail.event
      ? investigationTrails.find(
          (trail) => trail.id === detail.event.id || trail.eventId === detail.event.id || trail.predictionIds.includes(detail.prediction.id),
        ) ?? null
      : null
  const linkedDecisionBrief =
    detail?.prediction
      ? decisionBriefs.find((brief) => brief.lead_prediction_id === detail.prediction.id) ?? null
      : null

  useEffect(() => {
    let active = true

    if (!predictionId) {
      return
    }

    void getPredictionDetail(predictionId).then((nextDetail) => {
      if (!active) {
        return
      }

      setDetail(nextDetail)
      setLoadedPredictionId(predictionId)
    })

    return () => {
      active = false
    }
  }, [predictionId])

  useEffect(() => {
    let active = true

    if (!predictionId) {
      return
    }

    void getPredictionReviewNote(predictionId).then((note) => {
      if (!active) {
        return
      }

      setReviewNote(note?.note ?? "")
    })

    return () => {
      active = false
    }
  }, [predictionId])

  useEffect(() => {
    if (!detail?.prediction) {
      return
    }

    const prediction = detail.prediction

    rememberRecentItem({
      id: `prediction:${prediction.id}`,
      kind: "prediction",
      href: `/predictions/${prediction.id}`,
      title: prediction.thesis.length > 72 ? `${prediction.thesis.slice(0, 69)}...` : prediction.thesis,
      description: detail.postmortem?.lesson_summary ?? `${prediction.horizon} | ${prediction.status}`,
      updatedAt: new Date().toISOString(),
    })
    recordInvestigationStep({
      trailId: detail.event.id,
      title: matchingTrail?.title || detail.source.title?.trim() || detail.event.summary,
      eventId: detail.event.id,
      predictionId: prediction.id,
      href: `/predictions/${prediction.id}`,
      detail: detail.outcome
        ? detail.postmortem
          ? "Prediction detail reopened after scoring and postmortem completion."
          : "Prediction detail reopened after scoring; the review loop still needs notes."
        : "Prediction detail opened before the eventual outcome has been scored.",
      updatedAt: new Date().toISOString(),
      kind: "prediction_detail",
      status: detail.outcome ? (detail.postmortem ? "reviewed" : "under_review") : "ready_for_review",
    })
  }, [detail, matchingTrail?.title, recordInvestigationStep, rememberRecentItem])

  const loading = Boolean(predictionId) && loadedPredictionId !== predictionId
  const prediction = detail?.prediction ?? null
  const outcome = detail?.outcome ?? null
  const postmortem = detail?.postmortem ?? null
  const event = detail?.event ?? null
  const source = detail?.source ?? null
  const investigationStatus = matchingTrail ? getTrailStatus(matchingTrail) : outcome ? (postmortem ? "reviewed" : "under_review") : "ready_for_review"
  const reviewHeadline = useMemo(() => {
    if (!prediction) {
      return "Inspect the stored thesis, score breakdown, and review state for a single market call."
    }

    if (!outcome) {
      return "This stored call is ready for eventual outcome scoring once the realized market path is known."
    }

    if (!postmortem) {
      return "The prediction is scored, and the next step is to capture the postmortem and lesson context."
    }

    return "This prediction has completed the full loop from thesis to scorecard to learned lesson."
  }, [outcome, postmortem, prediction])

  const handleSaveReviewNote = async () => {
    if (!prediction || !reviewNote.trim()) {
      return
    }

    setSavingReviewNote(true)

    try {
      const saved = await savePredictionReviewNote(prediction.id, reviewNote.trim())
      setReviewNote(saved.note)
    } finally {
      setSavingReviewNote(false)
    }
  }

  const handleCreateDecisionBrief = async () => {
    if (!prediction || !event || !matchingTrail) {
      return
    }

    setCreatingDecisionBrief(true)

    try {
      const created = await createDecisionBrief({
        investigation_id: matchingTrail.id,
        lead_prediction_id: prediction.id,
        title: `${prediction.assets[0]?.ticker ?? "Lead"} decision brief`,
        summary: event.summary,
        thesis: prediction.thesis,
        scenario: event.summary,
        confidence_label:
          prediction.confidence >= 0.75 ? "high-conviction" : prediction.confidence >= 0.5 ? "medium-conviction" : "low-conviction",
        key_assets: prediction.assets.map((asset) => asset.ticker),
        triggers: prediction.evidence.slice(0, 4),
        invalidations: prediction.invalidations.slice(0, 4),
        status: "proposed",
        next_review_due_at: null,
      })
      void refreshWorkspace()
      window.location.assign(`/decisions/${created.id}`)
    } finally {
      setCreatingDecisionBrief(false)
    }
  }

  return (
    <AppShell
      title="Prediction detail"
      subtitle={reviewHeadline}
      actions={
        <Link
          href="/accuracy"
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100"
        >
          Back to accuracy
        </Link>
      }
    >
      {loading ? (
        <RouteLoadingState
          title="Loading prediction detail"
          description="Restoring the stored thesis, scorecard, and postmortem context for this prediction."
        />
      ) : !prediction ? (
        <Section title="Prediction not found">
          <RouteEmptyState
            title="Prediction detail is unavailable"
            description="The requested prediction could not be loaded from the platform API."
            actionHref="/accuracy"
            actionLabel="Back to accuracy"
          />
        </Section>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <OutcomeBadge outcome={outcome} />
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-500">
              Created {new Date(prediction.created_at).toLocaleString()}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-mono text-zinc-500">
              {prediction.id}
            </span>
          </div>

          {event && source ? <EventContextSection event={event} source={source} /> : null}
          <PredictionSummary prediction={prediction} />
          <OutcomeSection outcome={outcome} postmortem={postmortem} />
          <ReviewNoteSection
            note={reviewNote}
            saving={savingReviewNote}
            onChange={setReviewNote}
            onSave={handleSaveReviewNote}
          />
          <DecisionBriefSection
            briefId={linkedDecisionBrief?.id ?? null}
            briefStatus={linkedDecisionBrief?.status ?? null}
            canCreate={Boolean(matchingTrail && event)}
            onCreate={handleCreateDecisionBrief}
            creating={creatingDecisionBrief}
          />
          <OperatorHandoffSection
            trail={matchingTrail}
            investigationStatus={investigationStatus}
          />
        </div>
      )}
    </AppShell>
  )
}
