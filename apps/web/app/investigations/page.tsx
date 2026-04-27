"use client"

import Link from "next/link"
import { useMemo, useState, useSyncExternalStore } from "react"

import type { DecisionBrief } from "@finance-superbrain/schemas"

import { AppShell } from "@/components/AppShell"
import { InvestigationStatusBadge } from "@/components/InvestigationStatusBadge"
import { InvestigationTrailActions, InvestigationTrailSteps, InvestigationTrailSummary } from "@/components/InvestigationTrailView"
import { RouteEmptyState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import {
  getStoredChatSessionsServerSnapshot,
  getStoredChatSessionsSnapshot,
  subscribeStoredChatSessions,
} from "@/lib/chatSessionStore"
import { buildInvestigationCatalogCounts, filterInvestigationCatalog, type InvestigationCatalogFilter } from "@/lib/investigationCatalog"
import { buildInvestigationDesk } from "@/lib/investigationDesk"
import { formatInvestigationStatus, getTrailNextStep, getTrailStatus, type InvestigationTrail } from "@/lib/investigationTrail"

function chipClass(active: boolean) {
  return [
    "rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.24em] transition-colors",
    active
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-100",
  ].join(" ")
}

function summaryTone(value: number, warning = false) {
  if (warning) {
    return value > 0 ? "text-amber-300" : "text-emerald-300"
  }

  return value > 0 ? "text-white" : "text-zinc-500"
}

function sortTrailsByUpdatedAt<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

function SummaryCard({
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
      <p className={`mt-3 text-4xl font-semibold ${tone}`}>{value}</p>
      <p className="mt-2 text-sm text-zinc-500">{detail}</p>
    </div>
  )
}

function InvestigationWorkflowCard({
  title,
  eyebrow,
  trails,
  emptyDescription,
  memberNameMap,
  userId,
  decisionBriefByInvestigation,
  assignInvestigation,
  reopenInvestigation,
}: {
  title: string
  eyebrow: string
  trails: InvestigationTrail[]
  emptyDescription: string
  memberNameMap: Map<string, string>
  userId: string | null
  decisionBriefByInvestigation: Map<string, DecisionBrief>
  assignInvestigation: (investigationId: string, assigneeUserId: string | null) => Promise<void>
  reopenInvestigation: (investigationId: string) => Promise<void>
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
      <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">{eyebrow}</p>
      <h2 className="mt-2 font-display text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4 space-y-5">
        {trails.length ? (
          trails.map((trail) => {
            const status = getTrailStatus(trail)
            const linkedDecisionBrief = decisionBriefByInvestigation.get(trail.id)
            const leadPredictionId = trail.predictionIds[0] ?? null
            const primaryAction = linkedDecisionBrief
              ? {
                  href: `/decisions/${linkedDecisionBrief.id}`,
                  label: "Open brief",
                  tone: "border-cyan-500/25 bg-cyan-500/10 text-cyan-100 hover:border-cyan-400/40 hover:text-cyan-50",
                }
              : leadPredictionId
                ? {
                    href: `/predictions/${leadPredictionId}`,
                    label: "Promote from prediction",
                    tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100 hover:border-emerald-400/40 hover:text-emerald-50",
                  }
                : {
                    href: `/studio?run=${trail.id}`,
                    label: "Resume Studio",
                    tone: "border-blue-500/25 bg-blue-500/10 text-blue-100 hover:border-blue-400/40 hover:text-blue-50",
                  }

            return (
              <div key={trail.id} className="space-y-3">
                <InvestigationTrailSummary
                  trail={trail}
                  label={`Investigation | ${formatInvestigationStatus(status)}`}
                  status={<InvestigationStatusBadge status={status} />}
                  actions={<InvestigationTrailActions trail={trail} />}
                  summary={
                    <div className="space-y-2">
                      <p>{getTrailNextStep(trail)}</p>
                      <p className="text-xs text-zinc-500">
                        {trail.predictionIds.length} prediction{trail.predictionIds.length === 1 ? "" : "s"} linked | event{" "}
                        {trail.eventId ?? "not recorded"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Owner {trail.ownerUserId ? memberNameMap.get(trail.ownerUserId) ?? "unknown" : "not set"} | assignee{" "}
                        {trail.assigneeUserId ? memberNameMap.get(trail.assigneeUserId) ?? "unknown" : "unassigned"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {linkedDecisionBrief
                          ? `Decision brief: ${linkedDecisionBrief.title} | ${linkedDecisionBrief.status}`
                          : leadPredictionId
                            ? "Promotion-ready research. A lead prediction exists and this investigation can now be promoted into a shared brief."
                            : "Still upstream of prediction-driven decision work."}
                      </p>
                    </div>
                  }
                />
                <div className="flex flex-wrap gap-2">
                  {trail.assigneeUserId !== userId ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (userId) {
                          void assignInvestigation(trail.id, userId)
                        }
                      }}
                      className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50"
                    >
                      Assign to me
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        void assignInvestigation(trail.id, null)
                      }}
                      className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                    >
                      Unassign
                    </button>
                  )}
                  <Link
                    href={primaryAction.href}
                    className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] transition-colors ${primaryAction.tone}`}
                  >
                    {primaryAction.label}
                  </Link>
                  {leadPredictionId ? (
                    <Link
                      href={`/predictions/${leadPredictionId}`}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                    >
                      Lead prediction
                    </Link>
                  ) : null}
                  {status === "reviewed" ? (
                    <button
                      type="button"
                      onClick={() => {
                        void reopenInvestigation(trail.id)
                      }}
                      className="rounded-full border border-blue-500/25 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-blue-100 transition-colors hover:border-blue-400/40 hover:text-blue-50"
                    >
                      Reopen
                    </button>
                  ) : null}
                </div>
                <InvestigationTrailSteps steps={trail.steps} limit={5} />
              </div>
            )
          })
        ) : (
          <RouteEmptyState
            title={`No ${title.toLowerCase()} right now`}
            description={emptyDescription}
          />
        )}
      </div>
    </section>
  )
}

export default function InvestigationsPage() {
  const {
    assignInvestigation,
    decisionBriefs,
    hydrated,
    investigationTrails,
    members,
    recentItems,
    reopenInvestigation,
    studioDraft,
    studioRuns,
    user,
  } = useWorkspace()
  const [filter, setFilter] = useState<InvestigationCatalogFilter>("all")
  const [query, setQuery] = useState("")
  const storedSessions = useSyncExternalStore(
    subscribeStoredChatSessions,
    getStoredChatSessionsSnapshot,
    getStoredChatSessionsServerSnapshot,
  )

  const counts = useMemo(() => buildInvestigationCatalogCounts(investigationTrails), [investigationTrails])
  const assignedToMeCount = useMemo(
    () => investigationTrails.filter((trail) => trail.assigneeUserId && trail.assigneeUserId === user?.id).length,
    [investigationTrails, user?.id],
  )
  const unassignedReviewCount = useMemo(
    () =>
      investigationTrails.filter((trail) => {
        const status = getTrailStatus(trail)
        return !trail.assigneeUserId && (status === "ready_for_review" || status === "under_review")
      }).length,
    [investigationTrails],
  )
  const filteredTrails = useMemo(
    () => filterInvestigationCatalog(investigationTrails, { filter, query }),
    [filter, investigationTrails, query],
  )
  const memberNameMap = useMemo(
    () => new Map(members.map((entry) => [entry.user.id, entry.user.display_name])),
    [members],
  )
  const decisionBriefByInvestigation = useMemo(
    () => new Map(decisionBriefs.map((brief) => [brief.investigation_id, brief])),
    [decisionBriefs],
  )
  const researchOnlyTrails = useMemo(
    () => sortTrailsByUpdatedAt(filteredTrails.filter((trail) => !decisionBriefByInvestigation.has(trail.id))),
    [decisionBriefByInvestigation, filteredTrails],
  )
  const promotionReadyTrails = useMemo(
    () =>
      sortTrailsByUpdatedAt(
        researchOnlyTrails.filter((trail) => trail.predictionIds.length > 0 && getTrailStatus(trail) !== "drafting"),
      ),
    [researchOnlyTrails],
  )
  const upstreamResearchTrails = useMemo(
    () =>
      sortTrailsByUpdatedAt(
        researchOnlyTrails.filter((trail) => !promotionReadyTrails.some((candidate) => candidate.id === trail.id)),
      ),
    [promotionReadyTrails, researchOnlyTrails],
  )
  const decisionBackedTrails = useMemo(
    () => sortTrailsByUpdatedAt(filteredTrails.filter((trail) => decisionBriefByInvestigation.has(trail.id))),
    [decisionBriefByInvestigation, filteredTrails],
  )
  const latestSession = hydrated ? storedSessions[0] ?? null : null
  const deskItems = useMemo(
    () =>
      hydrated
        ? buildInvestigationDesk({
            latestSession,
            studioDraft,
            studioRuns,
            recentPredictions: [],
            recentItems,
          }).slice(0, 6)
        : [],
    [hydrated, latestSession, recentItems, studioDraft, studioRuns],
  )

  return (
    <AppShell
      title="Investigations"
      subtitle="Separate upstream research, promotion-ready work, and decision-backed investigations so the handoff into the shared decision loop stays explicit."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          label="Shared trails"
          value={String(counts.total)}
          detail="Server-backed investigations tying Studio, review, evaluation, and retrieval into one team lifecycle."
          tone={summaryTone(counts.total)}
        />
        <SummaryCard
          label="Assigned to me"
          value={String(assignedToMeCount)}
          detail="Investigations currently owned by this operator in the shared team workspace."
          tone={summaryTone(assignedToMeCount, true)}
        />
        <SummaryCard
          label="Unassigned review"
          value={String(unassignedReviewCount)}
          detail="Review-ready investigations that still need someone to take ownership."
          tone={summaryTone(unassignedReviewCount, true)}
        />
        <SummaryCard
          label="Reviewed"
          value={String(counts.reviewed)}
          detail="Completed investigations ready for retrieval and comparison."
          tone="text-emerald-300"
        />
        <SummaryCard
          label="Upstream research"
          value={String(upstreamResearchTrails.length)}
          detail="Investigations still being shaped before a lead prediction is strong enough for shared decision handling."
          tone={summaryTone(upstreamResearchTrails.length)}
        />
        <SummaryCard
          label="Promotion-ready"
          value={String(promotionReadyTrails.length)}
          detail="Research-only investigations that already have a lead prediction and can be promoted into a shared brief."
          tone={summaryTone(promotionReadyTrails.length, true)}
        />
        <SummaryCard
          label="Decision-backed"
          value={String(decisionBackedTrails.length)}
          detail="Investigations already feeding the decision workflow and its operating cadence."
          tone={summaryTone(decisionBackedTrails.length)}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.85fr)]">
        <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Investigation catalog</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">Research and decision lanes</h2>
              <p className="mt-2 text-sm text-zinc-500">
                Search by title, event, prediction, or trail step. The catalog below now separates upstream research from work already feeding the decision desk.
              </p>
            </div>
            <div className="w-full lg:max-w-sm">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by title, step, event, or prediction id..."
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {([
              { id: "all", label: "All" },
              { id: "drafting", label: "Drafting" },
              { id: "awaiting_review", label: "Awaiting review" },
              { id: "reviewed", label: "Reviewed" },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={chipClass(filter === option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-6">
            {!hydrated ? (
              <RouteEmptyState
                title="Workspace is still hydrating"
                description="Shared investigation history is still being restored from the server workspace."
              />
            ) : filteredTrails.length === 0 ? (
              <RouteEmptyState
                title="No investigations match"
                description={
                  query.trim()
                    ? "Adjust the search phrase or filter to widen the catalog."
                    : "New Studio runs and review work will appear here automatically as the operator uses the product."
                }
              />
            ) : (
              <>
                <InvestigationWorkflowCard
                  title="Upstream research"
                  eyebrow="Still in research mode"
                  trails={upstreamResearchTrails}
                  emptyDescription="This lane will populate when Studio work exists but is still upstream of prediction-backed promotion into the decision desk."
                  memberNameMap={memberNameMap}
                  userId={user?.id ?? null}
                  decisionBriefByInvestigation={decisionBriefByInvestigation}
                  assignInvestigation={assignInvestigation}
                  reopenInvestigation={reopenInvestigation}
                />
                <InvestigationWorkflowCard
                  title="Promotion-ready research"
                  eyebrow="Ready to become a brief"
                  trails={promotionReadyTrails}
                  emptyDescription="Prediction-backed investigations that are ready for shared decision promotion will appear here."
                  memberNameMap={memberNameMap}
                  userId={user?.id ?? null}
                  decisionBriefByInvestigation={decisionBriefByInvestigation}
                  assignInvestigation={assignInvestigation}
                  reopenInvestigation={reopenInvestigation}
                />
                <InvestigationWorkflowCard
                  title="Decision-backed investigations"
                  eyebrow="Connected to briefs"
                  trails={decisionBackedTrails}
                  emptyDescription="This lane will populate when investigations are promoted into shared decision briefs."
                  memberNameMap={memberNameMap}
                  userId={user?.id ?? null}
                  decisionBriefByInvestigation={decisionBriefByInvestigation}
                  assignInvestigation={assignInvestigation}
                  reopenInvestigation={reopenInvestigation}
                />
              </>
            )}
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Workflow split</p>
            <h2 className="mt-2 font-display text-lg font-semibold text-white">Research vs decision handoff</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Upstream research</p>
                <p className="mt-2 text-sm text-zinc-300">
                  Keep working in Studio until the event and lead prediction are coherent enough to justify team decision ownership.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Promotion-ready research</p>
                <p className="mt-2 text-sm text-zinc-300">
                  Open lead prediction detail and promote the investigation into a shared brief once the team is ready to manage it as live decision work.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Decision-backed</p>
                <p className="mt-2 text-sm text-zinc-300">
                  Once a brief exists, the next home is the decision desk and its cadence, not just more passive research context.
                </p>
              </div>
              <p className="text-xs text-zinc-500">
                {promotionReadyTrails.length
                  ? `${promotionReadyTrails.length} investigation${promotionReadyTrails.length === 1 ? "" : "s"} are already promotion-ready and should move into the decision desk rather than stay parked in research mode.`
                  : "No investigation is immediately promotion-ready right now."}
              </p>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Navigation support</p>
            <h2 className="mt-2 font-display text-lg font-semibold text-white">Operator desk context</h2>
            <p className="mt-2 text-sm text-zinc-500">
              These supporting items still matter, but the investigation catalog above is now the main place to reopen structured work.
            </p>

            <div className="mt-4 space-y-3">
              {deskItems.length ? (
                deskItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{item.lane.replace(/_/g, " ")}</p>
                        <p className="mt-2 text-sm font-medium text-white">{item.title}</p>
                      </div>
                      <Link
                        href={item.href}
                        className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                      >
                        {item.actionLabel}
                      </Link>
                    </div>
                    <p className="mt-2 text-xs text-zinc-400">{item.summary}</p>
                    <p className="mt-3 text-xs text-zinc-500">{item.nextStep}</p>
                  </div>
                ))
              ) : (
                <RouteEmptyState
                  title="No extra desk items yet"
                  description="This panel will surface draft and context-only items that do not yet belong to a richer investigation trail."
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  )
}
