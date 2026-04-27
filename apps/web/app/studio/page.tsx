"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"

import type { AnalogMatch, CreateSourceRequest, ParsedEvent, StoredEvent, StoredPrediction, StoredSource } from "@finance-superbrain/schemas"

import { AppShell } from "@/components/AppShell"
import { DecisionStatusBadge } from "@/components/DecisionStatusBadge"
import { InvestigationTrailActions, InvestigationTrailStatusSummary, InvestigationTrailSteps, InvestigationTrailSummary } from "@/components/InvestigationTrailView"
import { RouteEmptyState, RouteErrorState, RouteLoadingState, RouteNoticeState } from "@/components/RouteState"
import { useWorkspace, type SavedStudioRun, type StudioDraftForm } from "@/components/WorkspaceProvider"
import { createDecisionBrief } from "@/lib/decisionApi"
import { getInvestigationStatusSummary, getTrailStatus } from "@/lib/investigationTrail"
import {
  createSource,
  createStoredPredictions,
  getEventAnalogs,
  parseEventDraft,
  parseStoredSource,
} from "@/lib/studioApi"

const DEFAULT_FORM: StudioDraftForm = {
  source_type: "headline",
  title: "",
  speaker: "",
  publisher: "",
  raw_uri: "",
  occurred_at: "",
  raw_text: "",
  model_version: "impact-engine-v0",
  horizons: ["1d"],
}

const SOURCE_TYPE_LABELS: Record<StudioDraftForm["source_type"], string> = {
  headline: "Headline",
  transcript: "Transcript",
  speech: "Speech",
  earnings: "Earnings",
  filing: "Filing",
  user_note: "User note",
}

function hasDraftContent(form: StudioDraftForm) {
  return Boolean(
    form.title.trim() ||
      form.speaker.trim() ||
      form.publisher.trim() ||
      form.raw_uri.trim() ||
      form.occurred_at.trim() ||
      form.raw_text.trim(),
  )
}

function buildCreateSourceRequest(form: StudioDraftForm): CreateSourceRequest {
  return {
    source_type: form.source_type,
    title: form.title.trim() || undefined,
    speaker: form.speaker.trim() || undefined,
    publisher: form.publisher.trim() || undefined,
    raw_uri: form.raw_uri.trim() || undefined,
    occurred_at: form.occurred_at.trim() ? new Date(form.occurred_at).toISOString() : undefined,
    raw_text: form.raw_text.trim(),
  }
}

function formatRelativeTime(value: string) {
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatPercent(value: number | null) {
  if (value === null) return "Awaiting score"
  return `${Math.round(value * 100)}%`
}

function currentStage({
  preview,
  event,
  predictions,
}: {
  preview: ParsedEvent | null
  event: StoredEvent | null
  predictions: StoredPrediction[]
}) {
  if (predictions.length > 0) return "ready_for_review"
  if (event) return "stored_event"
  if (preview) return "parsed_preview"
  return "draft"
}

function StagePill({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={[
        "rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em]",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-white/10 bg-white/5 text-zinc-500",
      ].join(" ")}
    >
      {label}
    </div>
  )
}

function comparisonDirectionLabel(similarity: number) {
  if (similarity >= 0.85) return "High structural match"
  if (similarity >= 0.7) return "Useful analogue"
  return "Loose analogue"
}

function describeSavedRun(run: SavedStudioRun) {
  if (run.predictions.length > 0) {
    return {
      stageLabel: "ready for review",
      nextStep: "Resume the run, compare the analogs, then open the lead prediction or move into the review desk.",
    }
  }

  return {
    stageLabel: "stored event",
    nextStep: "Resume the run and generate predictions so the event enters the review loop.",
  }
}

function Section({
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

function StudioWorkspacePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    hydrated,
    investigationTrails,
    studioDraft,
    studioRuns,
    decisionBriefs,
    saveStudioDraft,
    clearStudioDraft,
    saveStudioRun,
    rememberRecentItem,
    refreshWorkspace,
  } = useWorkspace()
  const [form, setForm] = useState<StudioDraftForm>(DEFAULT_FORM)
  const [preview, setPreview] = useState<ParsedEvent | null>(null)
  const [source, setSource] = useState<StoredSource | null>(null)
  const [event, setEvent] = useState<StoredEvent | null>(null)
  const [predictions, setPredictions] = useState<StoredPrediction[]>([])
  const [analogs, setAnalogs] = useState<AnalogMatch[]>([])
  const [selectedAnalogId, setSelectedAnalogId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [parsingPreview, setParsingPreview] = useState(false)
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [generatingPredictions, setGeneratingPredictions] = useState(false)
  const [creatingDecisionBrief, setCreatingDecisionBrief] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const persistedDraftKeyRef = useRef<string | null>(null)
  const loadedRunIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!hydrated || draftHydrated) return

    if (studioDraft) {
      setForm(studioDraft.form)
      setPreview(studioDraft.preview)
      persistedDraftKeyRef.current = JSON.stringify({
        form: studioDraft.form,
        preview: studioDraft.preview,
      })
      setNotice("Restored your latest Studio draft from browser workspace storage.")
    }

    setDraftHydrated(true)
  }, [draftHydrated, hydrated, studioDraft])

  useEffect(() => {
    if (!hydrated || !draftHydrated) return

    const snapshot = JSON.stringify({ form, preview })

    if (!hasDraftContent(form) && !preview) {
      persistedDraftKeyRef.current = null
      if (studioDraft) clearStudioDraft()
      return
    }

    if (persistedDraftKeyRef.current === snapshot) return

    persistedDraftKeyRef.current = snapshot
    const updatedAt = new Date().toISOString()

    saveStudioDraft({ form, preview, updatedAt })
    rememberRecentItem({
      id: "studio-draft:active",
      kind: "studio_draft",
      href: "/studio",
      title: form.title.trim() || "Untitled studio draft",
      description: preview?.summary ?? (form.raw_text.trim().slice(0, 120) || "Draft event capture in progress"),
      updatedAt,
    })
  }, [clearStudioDraft, draftHydrated, form, hydrated, preview, rememberRecentItem, saveStudioDraft, studioDraft])

  useEffect(() => {
    if (!analogs.length) {
      setSelectedAnalogId(null)
      return
    }

    setSelectedAnalogId((current) => current ?? analogs[0]?.prediction_id ?? null)
  }, [analogs])

  useEffect(() => {
    if (!hydrated) {
      return
    }

    const runId = searchParams.get("run")

    if (!runId) {
      loadedRunIdRef.current = null
      return
    }

    if (loadedRunIdRef.current === runId) {
      return
    }

    const run = studioRuns.find((item) => item.id === runId)

    if (!run) {
      return
    }

    loadedRunIdRef.current = runId
    setForm(run.form)
    setPreview(run.preview)
    setSource(run.source)
    setEvent(run.event)
    setPredictions(run.predictions)
    setAnalogs(run.analogs)
    setSelectedAnalogId(run.analogs[0]?.prediction_id ?? null)
    setError(null)
    setNotice(`Resumed Studio run "${run.title}".`)
    persistedDraftKeyRef.current = JSON.stringify({
      form: run.form,
      preview: run.preview,
    })
  }, [hydrated, searchParams, studioRuns])

  const selectedAnalog = useMemo(
    () => analogs.find((analog) => analog.prediction_id === selectedAnalogId) ?? analogs[0] ?? null,
    [analogs, selectedAnalogId],
  )
  const activeTrail = useMemo(
    () =>
      event
        ? investigationTrails.find(
            (trail) => trail.id === event.id || trail.eventId === event.id || trail.predictionIds.some((id) => predictions.some((prediction) => prediction.id === id)),
          ) ?? null
        : null,
    [event, investigationTrails, predictions],
  )
  const activeTrailStatus = activeTrail ? getTrailStatus(activeTrail) : predictions.length ? "ready_for_review" : event ? "drafting" : "drafting"
  const leadPrediction = predictions[0] ?? null
  const linkedDecisionBrief = useMemo(
    () => (leadPrediction ? decisionBriefs.find((brief) => brief.lead_prediction_id === leadPrediction.id) ?? null : null),
    [decisionBriefs, leadPrediction],
  )

  const stage = currentStage({ preview, event, predictions })
  const canParsePreview = form.raw_text.trim().length >= 20

  function updateSourceField<K extends keyof StudioDraftForm>(key: K, value: StudioDraftForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setPreview(null)
    setSource(null)
    setEvent(null)
    setPredictions([])
    setAnalogs([])
    setSelectedAnalogId(null)
    setNotice(null)
    setError(null)
  }

  function updatePredictionConfig<K extends "model_version" | "horizons">(key: K, value: StudioDraftForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setPredictions([])
    setAnalogs([])
    setSelectedAnalogId(null)
    setNotice(null)
    setError(null)
  }

  function toggleHorizon(horizon: "1h" | "1d" | "5d") {
    const nextHorizons = form.horizons.includes(horizon)
      ? form.horizons.filter((item) => item !== horizon)
      : [...form.horizons, horizon]

    updatePredictionConfig(
      "horizons",
      nextHorizons.sort((left, right) => ["1h", "1d", "5d"].indexOf(left) - ["1h", "1d", "5d"].indexOf(right)),
    )
  }

  async function handleParsePreview() {
    setParsingPreview(true)
    setError(null)
    setNotice(null)

    try {
      const parsed = await parseEventDraft(buildCreateSourceRequest(form))
      setPreview(parsed)
      setNotice("Preview parsed successfully. Review the summary, then store the source when ready.")
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to parse draft preview.")
    } finally {
      setParsingPreview(false)
    }
  }

  async function handleCreateEvent() {
    setCreatingEvent(true)
    setError(null)
    setNotice(null)

    try {
      const storedSource = await createSource(buildCreateSourceRequest(form))
      const storedEvent = await parseStoredSource(storedSource.id)
      setSource(storedSource)
      setEvent(storedEvent)
      setPreview(storedEvent)
      setNotice("Source stored and event created. You can now generate predictions and inspect analogs.")
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create event from Studio draft.")
    } finally {
      setCreatingEvent(false)
    }
  }

  async function handleGeneratePredictions() {
    if (!event) return

    setGeneratingPredictions(true)
    setError(null)
    setNotice(null)

    try {
      const [nextPredictions, nextAnalogs] = await Promise.all([
        createStoredPredictions(event.id, {
          horizons: form.horizons,
          model_version: form.model_version.trim() || undefined,
        }),
        getEventAnalogs(event.id),
      ])

      setPredictions(nextPredictions)
      setAnalogs(nextAnalogs)

      const updatedAt = new Date().toISOString()
      const run: SavedStudioRun = {
        id: event.id,
        title: form.title.trim() || preview?.summary || "Untitled event",
        sourceType: form.source_type,
        form,
        preview,
        source,
        event,
        predictions: nextPredictions,
        analogs: nextAnalogs,
        eventSummary: event.summary,
        eventId: event.id,
        predictionIds: nextPredictions.map((prediction) => prediction.id),
        analogPredictionIds: nextAnalogs.map((analog) => analog.prediction_id),
        updatedAt,
      }

      saveStudioRun(run)
      clearStudioDraft()
      persistedDraftKeyRef.current = null
      setNotice("Predictions generated. The event is now ready for review and analog inspection.")
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to generate predictions from the stored event.")
    } finally {
      setGeneratingPredictions(false)
    }
  }

  async function handleCreateDecisionBrief() {
    if (!activeTrail || !event || !leadPrediction || linkedDecisionBrief) {
      return
    }

    setCreatingDecisionBrief(true)
    setError(null)
    setNotice(null)

    try {
      const created = await createDecisionBrief({
        investigation_id: activeTrail.id,
        lead_prediction_id: leadPrediction.id,
        title: `${leadPrediction.assets[0]?.ticker ?? "Lead"} decision brief`,
        summary: event.summary,
        thesis: leadPrediction.thesis,
        scenario: event.summary,
        confidence_label:
          leadPrediction.confidence >= 0.75
            ? "high-conviction"
            : leadPrediction.confidence >= 0.5
              ? "medium-conviction"
              : "low-conviction",
        key_assets: leadPrediction.assets.map((asset) => asset.ticker),
        triggers: leadPrediction.evidence.slice(0, 4),
        invalidations: leadPrediction.invalidations.slice(0, 4),
        status: "proposed",
        next_review_due_at: null,
      })

      void refreshWorkspace()
      setNotice("Promoted the lead prediction into a shared decision brief.")
      window.location.assign(`/decisions/${created.id}`)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create a decision brief from the lead prediction.")
    } finally {
      setCreatingDecisionBrief(false)
    }
  }

  return (
    <AppShell
      eyebrow="Operator workflow"
      title="Studio"
      subtitle="Turn raw market input into a parsed event, stored prediction set, and decision-ready workflow without leaving the shared product workspace."
      actions={
        <button
          type="button"
          onClick={() => {
            setForm(DEFAULT_FORM)
            setPreview(null)
            setSource(null)
            setEvent(null)
            setPredictions([])
            setAnalogs([])
            setSelectedAnalogId(null)
            setError(null)
            setNotice("Started a fresh Studio workflow.")
            persistedDraftKeyRef.current = null
            loadedRunIdRef.current = null
            clearStudioDraft()
            router.push("/studio")
          }}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100"
        >
          New workflow
        </button>
      }
    >
      <div className="flex flex-wrap gap-2">
        <StagePill label="Draft" active={stage === "draft"} />
        <StagePill label="Parsed preview" active={stage === "parsed_preview"} />
        <StagePill label="Stored event" active={stage === "stored_event"} />
        <StagePill label="Ready for review" active={stage === "ready_for_review"} />
      </div>

      {error ? <div className="mt-4"><RouteErrorState title="Studio workflow blocked" description={error} /></div> : null}

      {notice ? <div className="mt-4"><RouteNoticeState title="Studio updated" description={notice} /></div> : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
        <div className="space-y-6">
          <Section title="Capture the event" eyebrow="Draft intake">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Source type</span>
                <select
                  value={form.source_type}
                  onChange={(event) => updateSourceField("source_type", event.target.value as StudioDraftForm["source_type"])}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 focus:border-emerald-500/50 focus:outline-none"
                >
                  {Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value} className="bg-zinc-950 text-zinc-100">
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Occurred at</span>
                <input
                  type="datetime-local"
                  value={form.occurred_at}
                  onChange={(event) => updateSourceField("occurred_at", event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 focus:border-emerald-500/50 focus:outline-none"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Title</span>
                <input
                  value={form.title}
                  onChange={(event) => updateSourceField("title", event.target.value)}
                  placeholder="Fed Chair says inflation progress has slowed..."
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Speaker</span>
                <input
                  value={form.speaker}
                  onChange={(event) => updateSourceField("speaker", event.target.value)}
                  placeholder="Jerome Powell"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Publisher</span>
                <input
                  value={form.publisher}
                  onChange={(event) => updateSourceField("publisher", event.target.value)}
                  placeholder="FOMC press conference"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Source URI</span>
                <input
                  value={form.raw_uri}
                  onChange={(event) => updateSourceField("raw_uri", event.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Raw text</span>
                <textarea
                  value={form.raw_text}
                  onChange={(event) => updateSourceField("raw_text", event.target.value)}
                  rows={10}
                  placeholder="Paste the headline, transcript excerpt, filing passage, or operator note here..."
                  className="w-full rounded-[24px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!canParsePreview || parsingPreview}
                onClick={() => void handleParsePreview()}
                className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                {parsingPreview ? "Parsing preview..." : "Parse preview"}
              </button>
              <button
                type="button"
                disabled={!canParsePreview || creatingEvent}
                onClick={() => void handleCreateEvent()}
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-zinc-200 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-zinc-600"
              >
                {creatingEvent ? "Storing source..." : "Store source and event"}
              </button>
            </div>
          </Section>

          <Section title="Prediction generation" eyebrow="Stored event to review queue">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Model version</p>
                <input
                  value={form.model_version}
                  onChange={(event) => updatePredictionConfig("model_version", event.target.value)}
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-100 focus:border-emerald-500/50 focus:outline-none"
                />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Horizons</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["1h", "1d", "5d"] as const).map((horizon) => {
                    const active = form.horizons.includes(horizon)

                    return (
                      <button
                        key={horizon}
                        type="button"
                        onClick={() => toggleHorizon(horizon)}
                        className={[
                          "rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.24em] transition-colors",
                          active
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                            : "border-white/10 bg-zinc-950/80 text-zinc-500 hover:border-white/20 hover:text-zinc-200",
                        ].join(" ")}
                      >
                        {horizon}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!event || generatingPredictions || form.horizons.length === 0}
                onClick={() => void handleGeneratePredictions()}
                className="rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-medium text-black transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                {generatingPredictions ? "Generating..." : "Generate predictions and analogs"}
              </button>
              {event ? (
                <p className="self-center text-sm text-zinc-500">
                  Stored event <span className="font-mono text-zinc-400">{event.id}</span>
                </p>
              ) : (
                <p className="self-center text-sm text-zinc-500">Store the source first so the event is durable and replay-safe.</p>
              )}
            </div>
          </Section>

          {preview ? (
            <Section title="Parsed preview" eyebrow="Event interpretation">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div>
                  <p className="text-sm leading-7 text-zinc-200">{preview.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                      {preview.event_class.replace(/_/g, " ")}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                      {preview.sentiment.replace(/_/g, " ")}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                      Urgency {Math.round(preview.urgency_score * 100)}%
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                      Novelty {Math.round(preview.novelty_score * 100)}%
                    </span>
                  </div>
                </div>
                <div className="grid gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Why it matters</p>
                    <ul className="mt-3 space-y-2 text-sm text-zinc-300">
                      {preview.why_it_matters.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="text-zinc-500">-</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Themes and candidates</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[...preview.themes, ...preview.candidate_assets].slice(0, 10).map((item) => (
                        <span key={item} className="rounded-full border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-400">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Section>
          ) : null}

          {predictions.length ? (
            <Section title="Generated predictions" eyebrow="Review-ready outputs">
              <div className="mb-4">
                {activeTrail ? (
                  <InvestigationTrailSummary
                    trail={activeTrail}
                    label="Next operator move"
                    summary={
                      <div className="space-y-2">
                        <p>{getInvestigationStatusSummary(activeTrailStatus)}</p>
                        <p className="text-xs text-zinc-500">
                          Predictions and analogs are ready. Continue through the shared investigation flow instead of leaving this run in a one-off state.
                        </p>
                      </div>
                    }
                    actions={<InvestigationTrailActions trail={activeTrail} />}
                  />
                ) : null}
              </div>

              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Link
                  href={`/predictions/${leadPrediction?.id}`}
                  className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 transition-colors hover:border-emerald-400/40"
                >
                  <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/80">Lead prediction</p>
                  <p className="mt-2 text-sm font-medium text-white">Open the strongest stored thesis</p>
                  <p className="mt-2 text-xs text-emerald-50/80">Move straight into the canonical prediction detail page for the first generated call.</p>
                </Link>
                <Link
                  href="/accuracy"
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20"
                >
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Review desk</p>
                  <p className="mt-2 text-sm font-medium text-white">Check unresolved session outcomes</p>
                  <p className="mt-2 text-xs text-zinc-500">Use the operator review desk to keep the broader learning loop moving.</p>
                </Link>
                <Link
                  href="/library"
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20"
                >
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Library follow-up</p>
                  <p className="mt-2 text-sm font-medium text-white">Browse related lessons and memory</p>
                  <p className="mt-2 text-xs text-zinc-500">Return to the lesson explorer when you want broader analog context beyond this run.</p>
                </Link>
                {linkedDecisionBrief ? (
                  <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.24em] text-cyan-100/80">Decision brief</p>
                      <DecisionStatusBadge status={linkedDecisionBrief.status} />
                    </div>
                    <p className="mt-2 text-sm font-medium text-white">Shared decision follow-through is already live</p>
                    <p className="mt-2 text-xs text-cyan-50/80">
                      Keep the team aligned around the promoted thesis instead of recreating a separate action plan.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={`/decisions/${linkedDecisionBrief.id}`}
                        className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-200/50 hover:text-white"
                      >
                        Open brief
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
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-cyan-100/80">Phase 7 handoff</p>
                    <p className="mt-2 text-sm font-medium text-white">Promote the lead prediction into a shared decision brief</p>
                    <p className="mt-2 text-xs text-cyan-50/80">
                      Capture ownership, lifecycle, and next review timing while this thesis is still fresh.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!activeTrail || !event || !leadPrediction || creatingDecisionBrief}
                        onClick={() => void handleCreateDecisionBrief()}
                        className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-200/50 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-zinc-500"
                      >
                        {creatingDecisionBrief ? "Creating..." : "Create decision brief"}
                      </button>
                      {!activeTrail ? (
                        <span className="self-center text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          Waiting for shared investigation sync
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {predictions.map((prediction) => (
                  <div key={prediction.id} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                          {prediction.horizon}
                        </span>
                        <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                          {Math.round(prediction.confidence * 100)}% confidence
                        </span>
                      </div>
                      <Link
                        href={`/predictions/${prediction.id}`}
                        className="rounded-full border border-white/10 bg-zinc-950/80 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-300 transition-colors hover:border-white/20 hover:text-emerald-200"
                      >
                        Open detail
                      </Link>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-zinc-200">{prediction.thesis}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {prediction.assets.map((asset) => (
                        <span key={`${prediction.id}-${asset.ticker}`} className="rounded-full border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-400">
                          {asset.ticker} {asset.expected_direction} {asset.expected_magnitude_bp}bp
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
        </div>

        <div className="space-y-6">
          <Section title="Workspace status" eyebrow="Current context">
            <div className="space-y-4 text-sm text-zinc-300">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Current stage</p>
                <p className="mt-2 text-lg font-medium text-white">{stage.replace(/_/g, " ")}</p>
                <p className="mt-2 text-zinc-500">
                  {stage === "draft"
                    ? "Capture raw market context and parse a preview."
                    : stage === "parsed_preview"
                      ? "The event preview looks coherent. Store it to make the workflow durable."
                      : stage === "stored_event"
                        ? "Generate predictions and analogs from the stored event."
                        : "Open detail, score outcomes, and feed lessons back into the system."}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Decision handoff</p>
                <p className="mt-2 text-lg font-medium text-white">
                  {linkedDecisionBrief
                    ? "Decision-backed"
                    : leadPrediction
                      ? "Promotion-ready research"
                      : "Still upstream"}
                </p>
                <p className="mt-2 text-zinc-500">
                  {linkedDecisionBrief
                    ? "This workflow already feeds a shared decision brief. The next operating home is the decision desk and its cadence."
                    : leadPrediction
                      ? "A lead prediction exists. Promote it into a shared brief once the team is ready to manage it as live decision work."
                      : "Keep shaping the event, stored source, and prediction set before handing the investigation into the decision workflow."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {linkedDecisionBrief ? (
                    <Link
                      href={`/decisions/${linkedDecisionBrief.id}`}
                      className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
                    >
                      Open brief
                    </Link>
                  ) : leadPrediction ? (
                    <Link
                      href={`/predictions/${leadPrediction.id}`}
                      className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50"
                    >
                      Open lead prediction
                    </Link>
                  ) : (
                    <span className="rounded-full border border-white/10 bg-zinc-950/80 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                      Waiting for prediction signal
                    </span>
                  )}
                  <Link
                    href="/investigations"
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Open investigations
                  </Link>
                </div>
              </div>

              {studioDraft ? (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-amber-200/80">Saved draft</p>
                  <p className="mt-2 text-sm text-amber-50">{studioDraft.form.title.trim() || "Untitled studio draft"}</p>
                  <p className="mt-2 text-xs text-amber-100/80">Updated {formatRelativeTime(studioDraft.updatedAt)}</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-zinc-500">
                  No saved draft right now. New work is persisted automatically in the shared workspace.
                </div>
              )}

              {source ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Stored source</p>
                  <p className="mt-2 break-all font-mono text-xs text-zinc-400">{source.id}</p>
                </div>
              ) : null}
            </div>
          </Section>

          <Section title="Analog inspection" eyebrow="Side-by-side comparison">
            {!event ? (
              <RouteEmptyState
                title="Analog inspection will unlock after storage"
                description="Store an event first, then generate predictions so Studio can compare this setup against the historical memory library."
              />
            ) : !analogs.length ? (
              generatingPredictions ? (
                <RouteLoadingState
                  title="Generating analog comparison set"
                  description="Studio is assembling the stored predictions and historical analogs for side-by-side inspection."
                />
              ) : (
                <RouteEmptyState
                  title="No analog comparison set yet"
                  description="Generate predictions to load analog matches and compare verdicts, themes, and learned lessons."
                />
              )
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Comparison queue</p>
                    <p className="mt-2 text-sm text-zinc-400">
                      {selectedAnalog
                        ? `Showing ${analogs.findIndex((analog) => analog.prediction_id === selectedAnalog.prediction_id) + 1} of ${analogs.length}`
                        : `${analogs.length} analogs ready`}
                    </p>
                  </div>
                  {selectedAnalog ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const currentIndex = analogs.findIndex((analog) => analog.prediction_id === selectedAnalog.prediction_id)
                          const previousAnalog = analogs[(currentIndex - 1 + analogs.length) % analogs.length]
                          setSelectedAnalogId(previousAnalog?.prediction_id ?? null)
                        }}
                        className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const currentIndex = analogs.findIndex((analog) => analog.prediction_id === selectedAnalog.prediction_id)
                          const nextAnalog = analogs[(currentIndex + 1) % analogs.length]
                          setSelectedAnalogId(nextAnalog?.prediction_id ?? null)
                        }}
                        className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {analogs.slice(0, 8).map((analog) => {
                    const active = selectedAnalog?.prediction_id === analog.prediction_id

                    return (
                      <button
                        key={analog.prediction_id}
                        type="button"
                        onClick={() => setSelectedAnalogId(analog.prediction_id)}
                        className={[
                          "rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] transition-colors",
                          active
                            ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                            : "border-white/10 bg-white/5 text-zinc-500 hover:border-white/20 hover:text-zinc-200",
                        ].join(" ")}
                      >
                        {analog.horizon} | {Math.round(analog.similarity * 100)}%
                      </button>
                    )
                  })}
                </div>

                {selectedAnalog ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Similarity</p>
                        <p className="mt-2 text-2xl font-semibold text-white">{Math.round(selectedAnalog.similarity * 100)}%</p>
                        <p className="mt-2 text-xs text-zinc-500">{comparisonDirectionLabel(selectedAnalog.similarity)}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Verdict</p>
                        <p className="mt-2 text-2xl font-semibold text-white">
                          {selectedAnalog.verdict ? selectedAnalog.verdict.replace(/_/g, " ") : "Pending"}
                        </p>
                        <p className="mt-2 text-xs text-zinc-500">
                          {selectedAnalog.total_score !== null ? `Total score ${formatPercent(selectedAnalog.total_score)}` : "No stored score yet"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Lesson signal</p>
                        <p className="mt-2 text-2xl font-semibold text-white">
                          {selectedAnalog.lesson_type ? selectedAnalog.lesson_type.replace(/_/g, " ") : "Awaiting"}
                        </p>
                        <p className="mt-2 text-xs text-zinc-500">
                          {selectedAnalog.lesson_summary
                            ? "Stored lesson available for comparison"
                            : `Sentiment ${selectedAnalog.sentiment.replace(/_/g, " ")}`}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Current event</p>
                      <p className="mt-2 text-sm text-zinc-200">{event.summary}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {event.themes.slice(0, 5).map((theme) => (
                          <span key={theme} className="rounded-full border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-400">
                            {theme}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Selected analog</p>
                        <Link
                          href={`/predictions/${selectedAnalog.prediction_id}`}
                          className="text-xs text-emerald-300 transition-colors hover:text-emerald-200"
                        >
                          Open detail
                        </Link>
                      </div>
                      <p className="mt-2 text-sm text-zinc-200">{selectedAnalog.event_summary}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                          {selectedAnalog.sentiment.replace(/_/g, " ")}
                        </span>
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                          Verdict {selectedAnalog.verdict ? selectedAnalog.verdict.replace(/_/g, " ") : "pending"}
                        </span>
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                          Score {formatPercent(selectedAnalog.total_score)}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedAnalog.themes.slice(0, 5).map((theme) => (
                          <span key={theme} className="rounded-full border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-400">
                            {theme}
                          </span>
                        ))}
                      </div>
                      {selectedAnalog.lesson_summary ? (
                        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/80">
                            {selectedAnalog.lesson_type ?? "lesson"}
                          </p>
                          <p className="mt-2 text-sm text-emerald-50">{selectedAnalog.lesson_summary}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Section>

          <Section title="Recent Studio runs" eyebrow="Resume prior work">
            {studioRuns.length ? (
              <div className="space-y-3">
                {studioRuns.slice(0, 5).map((run) => (
                  <div key={run.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    {(() => {
                      const runState = describeSavedRun(run)
                      const runTrail =
                        investigationTrails.find(
                          (trail) =>
                            trail.id === run.id ||
                            trail.eventId === run.eventId ||
                            trail.predictionIds.some((id) => run.predictionIds.includes(id)),
                        ) ?? null

                      return (
                        <>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{run.title}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {SOURCE_TYPE_LABELS[run.sourceType]} | {formatRelativeTime(run.updatedAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                          {runState.stageLabel}
                        </span>
                        <Link
                          href={`/studio?run=${run.id}`}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100"
                        >
                          Resume
                        </Link>
                        {runTrail ? <InvestigationTrailActions trail={runTrail} /> : null}
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-zinc-400">{run.eventSummary}</p>
                    <p className="mt-3 text-xs text-zinc-500">{runState.nextStep}</p>
                    <p className="mt-3 text-xs text-zinc-500">
                      {run.predictionIds.length} prediction{run.predictionIds.length !== 1 ? "s" : ""} | {run.analogPredictionIds.length} analog link
                      {run.analogPredictionIds.length !== 1 ? "s" : ""}
                    </p>
                        </>
                      )
                    })()}
                  </div>
                ))}
              </div>
            ) : (
              <RouteEmptyState
                title="No saved Studio runs yet"
                description="Completed Studio runs will appear here so you can jump back into prior event workflows."
              />
            )}
          </Section>

          <Section title="Investigation trail" eyebrow="Operator continuity">
            {!activeTrail ? (
              <RouteEmptyState
                title="No investigation trail yet"
                description="Store an event or resume a saved run and Studio will start building the shared investigation trail automatically."
              />
            ) : (
              <div className="space-y-3">
                <InvestigationTrailStatusSummary
                  trail={activeTrail}
                  summary={getInvestigationStatusSummary(activeTrailStatus)}
                />
                <InvestigationTrailSteps steps={activeTrail.steps} limit={4} />
              </div>
            )}
          </Section>
        </div>
      </div>
    </AppShell>
  )
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <AppShell
          eyebrow="Operator workflow"
          title="Studio"
          subtitle="Turn raw market input into a parsed event, stored prediction set, and analog comparison workflow without leaving the product."
        >
          <RouteLoadingState
            title="Loading Studio workspace"
            description="Restoring the saved Studio context and route selection."
          />
        </AppShell>
      }
    >
      <StudioWorkspacePage />
    </Suspense>
  )
}
