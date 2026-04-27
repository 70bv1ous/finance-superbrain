"use client"

import { GUIDED_DEMO_MANIFEST, GUIDED_DEMO_PROMPTS, GUIDED_DEMO_PROMPT_CATEGORIES } from "@finance-superbrain/schemas"
import Link from "next/link"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { AppShell } from "@/components/AppShell"
import { ChatWorkspace } from "@/components/ChatWorkspace"
import { DecisionStatusBadge } from "@/components/DecisionStatusBadge"
import { InvestigationStatusBadge } from "@/components/InvestigationStatusBadge"
import { InvestigationTrailActions, InvestigationTrailSummary } from "@/components/InvestigationTrailView"
import { PortfolioStatusBadge } from "@/components/PortfolioStatusBadge"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import { getRecentPredictions, type PredictionRow } from "@/lib/chatApi"
import {
  getStoredChatSessionsServerSnapshot,
  getStoredChatSessionsSnapshot,
  subscribeStoredChatSessions,
} from "@/lib/chatSessionStore"
import { buildInvestigationDesk } from "@/lib/investigationDesk"
import { getTrailNextStep, getTrailStatus } from "@/lib/investigationTrail"
import { buildPortfolioDeskSummaryFromCandidates, getPortfolioFollowThroughHealth } from "@/lib/portfolioDesk"
import { sortPredictionsForReview } from "@/lib/reviewDesk"
import { formatWorkspaceActivityKind, getWorkspaceActivityReferences } from "@/lib/workspaceActivity"
import { buildWorkspaceResumeActions, getRecentContextItems } from "@/lib/workspaceResume"

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

function actionToneClasses(tone: "amber" | "emerald" | "cyan" | "blue") {
  switch (tone) {
    case "amber":
      return "border-amber-500/25 bg-amber-500/10 text-amber-100"
    case "emerald":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
    case "cyan":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-100"
    default:
      return "border-blue-500/25 bg-blue-500/10 text-blue-100"
  }
}

export default function CommandCenterPage() {
  const { activity, decisionBriefs, hydrated, investigationTrails, portfolioCandidates, recentItems, studioDraft, studioRuns, user } = useWorkspace()
  const [recentPredictions, setRecentPredictions] = useState<PredictionRow[]>([])
  const [loadingPredictions, setLoadingPredictions] = useState(true)
  const storedSessions = useSyncExternalStore(
    subscribeStoredChatSessions,
    getStoredChatSessionsSnapshot,
    getStoredChatSessionsServerSnapshot,
  )
  const [nowTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false

    void getRecentPredictions(10)
      .then((items) => {
        if (!cancelled) {
          setRecentPredictions(items)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPredictions(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const latestSession = hydrated ? storedSessions[0] ?? null : null
  const latestStudioRun = studioRuns[0] ?? null
  const resumeActions = useMemo(
    () =>
      hydrated
        ? buildWorkspaceResumeActions({
            latestSession,
            studioDraft,
            latestStudioRun,
            recentPredictions,
            investigationTrails,
          })
        : [],
    [hydrated, latestSession, latestStudioRun, recentPredictions, studioDraft, investigationTrails],
  )
  const investigationDesk = useMemo(
    () =>
      hydrated
        ? buildInvestigationDesk({
            latestSession,
            studioDraft,
            studioRuns,
            recentPredictions,
            recentItems,
          }).slice(0, 5)
        : [],
    [hydrated, latestSession, recentItems, recentPredictions, studioDraft, studioRuns],
  )
  const reviewQueue = useMemo(
    () => sortPredictionsForReview(recentPredictions).filter((prediction) => !prediction.outcome).slice(0, 4),
    [recentPredictions],
  )
  const portfolioSummary = useMemo(
    () =>
      buildPortfolioDeskSummaryFromCandidates(portfolioCandidates, user?.id ?? null, new Date(nowTimestamp).toISOString()),
    [nowTimestamp, portfolioCandidates, user?.id],
  )
  const dueDecisionBriefs = useMemo(
    () =>
      decisionBriefs
        .filter((brief) => {
          if (!(brief.status === "active" || brief.status === "watching") || !brief.next_review_due_at) {
            return false
          }

          return Date.parse(brief.next_review_due_at) <= nowTimestamp
        })
        .slice(0, 3),
    [decisionBriefs, nowTimestamp],
  )
  const closedDecisionBriefs = useMemo(
    () => decisionBriefs.filter((brief) => brief.status === "closed").slice(0, 3),
    [decisionBriefs],
  )
  const liveDecisionBriefs = useMemo(
    () => decisionBriefs.filter((brief) => brief.status === "active" || brief.status === "watching").slice(0, 3),
    [decisionBriefs],
  )
  const recentClosedPortfolioCandidates = useMemo(
    () => portfolioCandidates.filter((candidate) => candidate.status === "closed").slice(0, 3),
    [portfolioCandidates],
  )
  const recentTrails = useMemo(() => investigationTrails.slice(0, 3), [investigationTrails])
  const recentActivity = useMemo(() => activity.slice(0, 4), [activity])
  const recentContextItems = useMemo(() => getRecentContextItems(recentItems, 4), [recentItems])
  const portfolioPriorityCandidates = useMemo(
    () =>
      portfolioCandidates
        .filter((candidate) => getPortfolioFollowThroughHealth(candidate, nowTimestamp) !== "closed")
        .slice()
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
        .slice(0, 3),
    [nowTimestamp, portfolioCandidates],
  )
  const guidedPromptCategoryCards = useMemo(
    () =>
      Object.entries(GUIDED_DEMO_PROMPT_CATEGORIES).map(([category, meta]) => ({
        category,
        label: meta.label,
        description: meta.description,
        count: GUIDED_DEMO_PROMPTS.filter((prompt) => prompt.category === category).length,
      })),
    [],
  )
  const featuredGuidedPrompts = useMemo(() => GUIDED_DEMO_PROMPTS.slice(0, 4), [])
  const guidedWalkthrough = useMemo(
    () =>
      GUIDED_DEMO_MANIFEST.map((step, index) => ({
        ...step,
        number: index + 1,
      })).slice(0, 6),
    [],
  )

  return (
    <AppShell
      title="Command center"
      subtitle="Shared operating overview for investigations, decisions, portfolio follow-through, and reusable market memory."
    >
      {!hydrated ? (
        <RouteLoadingState
          title="Loading workspace command center"
          description="Restoring shared workspace continuity, team activity, and recent operating context."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Shared investigations</p>
              <p className="mt-3 text-4xl font-semibold text-white">{investigationTrails.length}</p>
              <p className="mt-2 text-sm text-zinc-500">Durable trails across Studio, review, and retrieval.</p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Live decision briefs</p>
              <p className="mt-3 text-4xl font-semibold text-white">{liveDecisionBriefs.length}</p>
              <p className="mt-2 text-sm text-zinc-500">Shared briefs still inside the active monitoring loop.</p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Portfolio pressure</p>
              <p className="mt-3 text-4xl font-semibold text-white">{portfolioSummary.counts.due_review}</p>
              <p className="mt-2 text-sm text-zinc-500">Live portfolio candidates already due for follow-through.</p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Recent activity</p>
              <p className="mt-3 text-4xl font-semibold text-white">{activity.length}</p>
              <p className="mt-2 text-sm text-zinc-500">Audit-grade workspace events visible to the whole team.</p>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel title="Guided intelligence proof" eyebrow="Demo readiness">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
                <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/80">Evidence desk standard</p>
                  <h3 className="mt-3 font-display text-2xl font-semibold text-white">Make grounded market reasoning visible.</h3>
                  <p className="mt-3 text-sm leading-7 text-emerald-50/90">
                    The guided prompt bank is the repeatable proof path for walkthroughs. Strong answers should show a
                    bottom line, affected assets, evidence basis, explicit limits, and risk factors instead of relying
                    on polished but unsupported prose.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      href="#intelligence-proof"
                      className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-300"
                    >
                      Jump to evidence desk
                    </Link>
                    <Link
                      href="/workspace#intelligence-proof"
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-white/20 hover:text-white"
                    >
                      Open guided prompts
                    </Link>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  {guidedPromptCategoryCards.map((item) => (
                    <div key={item.category} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          {item.count}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-zinc-400">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {featuredGuidedPrompts.map((prompt) => (
                  <div key={prompt.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-semibold text-white">{prompt.label}</p>
                    <p className="mt-2 text-sm text-zinc-400">{prompt.proof_goal}</p>
                    <div className="mt-4">
                      <Link
                        href="/workspace#intelligence-proof"
                        className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                      >
                        Run in workspace
                      </Link>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-[24px] border border-white/10 bg-zinc-950/55 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Walkthrough order</p>
                    <p className="mt-2 text-sm text-zinc-400">
                      This is the canonical local demo sequence, so the operator can move from public story to answer proof to operating continuity without improvising the route order.
                    </p>
                  </div>
                  <Link
                    href="/workspace#intelligence-proof"
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Open walkthrough
                  </Link>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  {guidedWalkthrough.map((step) => (
                    <div key={step.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {step.number}. {step.title}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-zinc-400">{step.proof_purpose}</p>
                        </div>
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          {step.kind}
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={step.route.href}
                          className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/30 hover:text-emerald-50"
                        >
                          {step.route.label}
                        </Link>
                        {step.handoff ? (
                          <Link
                            href={step.handoff.href}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                          >
                            {step.handoff.label}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel title="Resume work" eyebrow="Shared continuity">
              {resumeActions.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {resumeActions.map((action) => (
                    <Link
                      key={action.id}
                      href={action.href}
                      className={`rounded-[24px] border p-4 transition-colors hover:brightness-110 ${actionToneClasses(action.tone)}`}
                    >
                      <p className="text-[11px] uppercase tracking-[0.24em]">{action.kind.replace(/_/g, " ")}</p>
                      <p className="mt-3 text-sm font-semibold text-white">{action.title}</p>
                      <p className="mt-2 text-sm text-current/85">{action.description}</p>
                      <p className="mt-4 text-[11px] uppercase tracking-[0.24em]">{action.label}</p>
                    </Link>
                  ))}
                </div>
              ) : (
                <RouteEmptyState
                  title="No active continuity yet"
                  description="Once investigations, drafts, or shared reviews exist, the fastest resume paths will surface here."
                />
              )}
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel title="Portfolio pulse" eyebrow="Follow-through">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Due now</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{portfolioSummary.counts.due_review}</p>
                  <p className="mt-2 text-sm text-zinc-500">Live candidates already past their review cadence.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Missing cadence</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{portfolioSummary.counts.missing_cadence}</p>
                  <p className="mt-2 text-sm text-zinc-500">Portfolio theses that still need an explicit next review date.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Stale watching</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{portfolioSummary.counts.stale_watching}</p>
                  <p className="mt-2 text-sm text-zinc-500">Watching candidates with weak follow-through discipline.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Trimmed pending</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{portfolioSummary.counts.trimmed_pending_followup}</p>
                  <p className="mt-2 text-sm text-zinc-500">Trimmed theses that still need closure or fresh cadence.</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {portfolioPriorityCandidates.length ? (
                  portfolioPriorityCandidates.map((candidate) => (
                    <div key={candidate.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{candidate.title}</p>
                          <p className="mt-2 text-xs text-zinc-500">
                            {candidate.primary_theme} | {candidate.conviction_label} conviction
                          </p>
                        </div>
                        <PortfolioStatusBadge status={candidate.status} />
                      </div>
                      <p className="mt-3 text-sm text-zinc-400">
                        {getPortfolioFollowThroughHealth(candidate, nowTimestamp).replace(/_/g, " ")}
                      </p>
                      <div className="mt-4">
                        <Link
                          href={`/portfolio/${candidate.id}`}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Open candidate
                        </Link>
                      </div>
                    </div>
                  ))
                ) : (
                  <RouteEmptyState
                    title="No live portfolio pressure"
                    description="Portfolio candidates will surface here once the team promotes decision work into live follow-through."
                  />
                )}
              </div>
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel title="Investigation flow" eyebrow="Research desk">
              {investigationDesk.length ? (
                <div className="space-y-3">
                  {investigationDesk.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{item.lane.replace(/_/g, " ")}</p>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{formatRelativeTime(item.updatedAt)}</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-white">{item.title}</p>
                      <p className="mt-2 text-sm text-zinc-400">{item.summary}</p>
                      <p className="mt-3 text-xs text-zinc-500">{item.nextStep}</p>
                      <div className="mt-4">
                        <Link
                          href={item.href}
                          className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50"
                        >
                          {item.actionLabel}
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <RouteEmptyState
                  title="No active investigation flow"
                  description="Once Studio, review, or recent context exists, the operating queue will appear here."
                />
              )}
            </Panel>

            <Panel title={dueDecisionBriefs.length ? "Due follow-up" : "Decision pressure"} eyebrow="Operating briefs">
              <div className="space-y-3">
                {dueDecisionBriefs.length ? (
                  dueDecisionBriefs.map((brief) => (
                    <div key={brief.id} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{brief.title}</p>
                          <p className="mt-2 text-sm text-amber-100/85">{brief.summary}</p>
                        </div>
                        <DecisionStatusBadge status={brief.status} />
                      </div>
                      <div className="mt-4">
                        <Link
                          href={`/decisions/${brief.id}`}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-100 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Run due review
                        </Link>
                      </div>
                    </div>
                  ))
                ) : liveDecisionBriefs.length ? (
                  liveDecisionBriefs.map((brief) => (
                    <div key={brief.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{brief.title}</p>
                          <p className="mt-2 text-sm text-zinc-400">{brief.summary}</p>
                        </div>
                        <DecisionStatusBadge status={brief.status} />
                      </div>
                      <p className="mt-3 text-xs text-zinc-500">
                        {brief.next_review_due_at
                          ? `Next review ${formatRelativeTime(brief.next_review_due_at)}`
                          : "No review cadence set yet"}
                      </p>
                    </div>
                  ))
                ) : (
                  <RouteEmptyState
                    title="No live decision pressure"
                    description="Promoted investigations will appear here once they enter the shared decision loop."
                  />
                )}
              </div>
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel title="Recent investigations" eyebrow="Trail continuity">
              {recentTrails.length ? (
                <div className="space-y-3">
                  {recentTrails.map((trail) => (
                    <InvestigationTrailSummary
                      key={trail.id}
                      trail={trail}
                      label="Current trail"
                      status={<InvestigationStatusBadge status={getTrailStatus(trail)} />}
                      summary={<p>{getTrailNextStep(trail)}</p>}
                      actions={<InvestigationTrailActions trail={trail} />}
                    />
                  ))}
                </div>
              ) : (
                <RouteEmptyState
                  title="No shared trails yet"
                  description="Investigations will appear here after the first Studio run is stored and synced."
                />
              )}
            </Panel>

            <Panel title="Review queue" eyebrow="Accuracy loop">
              {loadingPredictions ? (
                <RouteLoadingState
                  title="Loading review queue"
                  description="Checking which predictions still need a verdict or postmortem follow-through."
                />
              ) : reviewQueue.length ? (
                <div className="space-y-3">
                  {reviewQueue.map((prediction) => (
                    <div key={prediction.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{prediction.query}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.24em] text-zinc-500">
                            {prediction.event_type.replace(/_/g, " ")} | {prediction.confidence_level} confidence
                          </p>
                        </div>
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-100">
                          Awaiting verdict
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-zinc-400">{prediction.answer_summary}</p>
                      <div className="mt-4">
                        <Link
                          href={`/accuracy?focus=${prediction.id}`}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Review now
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <RouteEmptyState
                  title="No unresolved review items"
                  description="The current shared review queue is clear."
                />
              )}
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel title="Audit activity" eyebrow="Team visibility">
              {recentActivity.length ? (
                <div className="space-y-3">
                  {recentActivity.map((event) => {
                    const references = getWorkspaceActivityReferences(event)

                    return (
                      <div key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm text-white">{event.detail}</p>
                          <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                            {formatRelativeTime(event.created_at)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs uppercase tracking-[0.24em] text-zinc-500">
                          {formatWorkspaceActivityKind(event.kind)}
                        </p>
                        {references.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {references.map((reference) => (
                              <Link
                                key={`${event.id}:${reference.href}`}
                                href={reference.href}
                                className="rounded-full border border-white/10 bg-zinc-950/60 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                              >
                                {reference.label}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <RouteEmptyState
                  title="No recent workspace activity"
                  description="Auth events, assignments, notes, and follow-through will populate here once the team begins working."
                />
              )}
            </Panel>

            <Panel title="Recent context" eyebrow="Convenience cache">
              {recentContextItems.length ? (
                <div className="space-y-3">
                  {recentContextItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <p className="mt-2 text-sm text-zinc-400">{item.description}</p>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                          {item.kind.replace(/_/g, " ")}
                        </span>
                        <Link
                          href={item.href}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Open context
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <RouteEmptyState
                  title="No recent context yet"
                  description="As the team moves between desks, recent context links will accumulate here."
                />
              )}
            </Panel>
          </div>

          <Panel title="Closed operating outcomes" eyebrow="Retrospective continuity">
            {closedDecisionBriefs.length || recentClosedPortfolioCandidates.length ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {closedDecisionBriefs.map((brief) => {
                  const linkedTrail = investigationTrails.find((trail) => trail.id === brief.investigation_id) ?? null

                  return (
                    <div key={brief.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{linkedTrail?.title ?? brief.title}</p>
                          <p className="mt-2 text-sm text-zinc-400">{brief.summary}</p>
                        </div>
                        <DecisionStatusBadge status={brief.status} />
                      </div>
                      <p className="mt-3 text-xs uppercase tracking-[0.24em] text-zinc-500">Closed decision brief</p>
                      <div className="mt-4">
                        <Link
                          href={`/decisions/${brief.id}`}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Open brief
                        </Link>
                      </div>
                    </div>
                  )
                })}

                {recentClosedPortfolioCandidates.map((candidate) => {
                  const linkedTrail =
                    investigationTrails.find((trail) => trail.id === candidate.investigation_id) ?? null

                  return (
                    <div key={candidate.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{linkedTrail?.title ?? candidate.title}</p>
                          <p className="mt-2 text-sm text-zinc-400">{candidate.summary}</p>
                        </div>
                        <PortfolioStatusBadge status={candidate.status} />
                      </div>
                      <p className="mt-3 text-xs uppercase tracking-[0.24em] text-zinc-500">Closed portfolio candidate</p>
                      <div className="mt-4">
                        <Link
                          href={`/portfolio/${candidate.id}`}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Open candidate
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <RouteEmptyState
                title="No closed outcomes yet"
                description="Once briefs or portfolio theses reach closure, their finished context will stay visible here for retrospective follow-through."
              />
            )}
          </Panel>

          <ChatWorkspace />
        </div>
      )}
    </AppShell>
  )
}
