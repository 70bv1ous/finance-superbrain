"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

import { AppShell } from "@/components/AppShell"
import { DecisionStatusBadge } from "@/components/DecisionStatusBadge"
import { InvestigationStatusBadge } from "@/components/InvestigationStatusBadge"
import { InvestigationTrailActions, InvestigationTrailSteps, InvestigationTrailSummary } from "@/components/InvestigationTrailView"
import { PortfolioStatusBadge } from "@/components/PortfolioStatusBadge"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import {
  getContaminationAudit,
  getEvalReport,
  getEvalSplitStats,
  type ContaminationAudit,
  type DomainReport,
  type EvalReport,
  type SplitStats,
} from "@/lib/chatApi"
import { getDecisionClosureSummary } from "@/lib/decisionRetrospective"
import { getTrailNextStep, getTrailStatus } from "@/lib/investigationTrail"
import {
  buildLatestPortfolioCandidateByDecisionBriefId,
  getPortfolioCandidateContextCopy,
  getPortfolioClosureSummary,
  getPortfolioPostureSummary,
} from "@/lib/portfolioRetrospective"

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function AccuracyBadge({ value, powered }: { value: number | null; powered?: boolean }) {
  if (value === null) {
    return <span className="text-sm text-zinc-600">N/A</span>
  }

  const color =
    value >= 0.65 ? "text-emerald-400" :
    value >= 0.5 ? "text-amber-400" :
    "text-red-400"

  return (
    <span className={`font-mono font-bold ${color}`}>
      {pct(value)}
      {powered === false ? <span className="ml-1 text-xs text-zinc-600">(low n)</span> : null}
    </span>
  )
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === "warning" ? "bg-amber-400" :
    severity === "error" ? "bg-red-400" :
    "bg-zinc-500"

  return <span className={`mr-2 inline-block h-2 w-2 rounded-full ${color}`} />
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
      <p className="text-xs uppercase tracking-widest text-zinc-500">{label}</p>
      <p className={`mt-3 text-3xl font-semibold ${color ?? "text-white"}`}>{value}</p>
      {sub ? <p className="mt-2 text-xs text-zinc-600">{sub}</p> : null}
    </div>
  )
}

const DOMAIN_COLORS: Record<string, string> = {
  macro: "bg-blue-500",
  earnings: "bg-cyan-500",
  policy_fx: "bg-indigo-500",
  energy: "bg-yellow-500",
  credit: "bg-rose-500",
  crypto: "bg-orange-500",
  china_macro: "bg-red-500",
  commodities: "bg-lime-500",
  geopolitical: "bg-purple-500",
  volatility: "bg-pink-500",
  real_estate_housing: "bg-teal-500",
  sovereign_debt: "bg-violet-500",
}

function SplitBar({
  train,
  validation,
  test,
}: {
  train: number
  validation: number
  test: number
}) {
  const total = train + validation + test

  if (total === 0) {
    return null
  }

  const trainPct = Math.round((train / total) * 100)
  const validationPct = Math.round((validation / total) * 100)
  const testPct = 100 - trainPct - validationPct

  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full">
      <div className="bg-blue-600" style={{ width: `${trainPct}%` }} title={`Train: ${train}`} />
      <div className="bg-amber-500" style={{ width: `${validationPct}%` }} title={`Validation: ${validation}`} />
      <div className="bg-emerald-500" style={{ width: `${testPct}%` }} title={`Test: ${test}`} />
    </div>
  )
}

function DecisionContextRow({
  briefId,
  briefStatus,
  emptyLabel = "No decision brief linked yet",
}: {
  briefId?: string | null
  briefStatus?: "draft" | "proposed" | "active" | "watching" | "closed" | null
  emptyLabel?: string
}) {
  if (!briefId || !briefStatus) {
    return <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{emptyLabel}</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DecisionStatusBadge status={briefStatus} />
      <Link
        href={`/decisions/${briefId}`}
        className="text-[11px] uppercase tracking-[0.24em] text-cyan-200 transition-colors hover:text-white"
      >
        Open brief
      </Link>
    </div>
  )
}

function PortfolioContextRow({
  candidateId,
  candidateStatus,
  emptyLabel = "No portfolio candidate linked yet",
}: {
  candidateId?: string | null
  candidateStatus?: "candidate" | "active" | "watching" | "trimmed" | "closed" | null
  emptyLabel?: string
}) {
  if (!candidateId || !candidateStatus) {
    return <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{emptyLabel}</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PortfolioStatusBadge status={candidateStatus} />
      <Link
        href={`/portfolio/${candidateId}`}
        className="text-[11px] uppercase tracking-[0.24em] text-cyan-200 transition-colors hover:text-white"
      >
        Open candidate
      </Link>
    </div>
  )
}

function decisionFollowThroughCopy(status: "draft" | "proposed" | "active" | "watching" | "closed" | null | undefined) {
  switch (status) {
    case "closed":
      return "This decision is already closed, so evaluation context should be treated as retrospective closure evidence."
    case "watching":
      return "This decision is in watching mode, so evaluation should guide whether it stays on watch or needs reactivation."
    case "active":
      return "This decision is active, so evaluation and benchmark context should directly shape the live operating thesis."
    case "proposed":
    case "draft":
      return "This decision is not fully live yet, so evaluation can help determine whether it deserves promotion."
    default:
      return "This investigation is still research-only. Evaluation can strengthen the statistical case before promotion."
  }
}

function ClosedDecisionOutcomeSummary({
  detail,
}: {
  detail: ReturnType<typeof getDecisionClosureSummary>
}) {
  if (!detail) {
    return null
  }

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{detail.label}</p>
      <p className="mt-2 text-sm text-zinc-300">{detail.detail}</p>
    </div>
  )
}

function ClosedPortfolioOutcomeSummary({
  candidate,
  detail,
}: {
  candidate: Parameters<typeof getPortfolioPostureSummary>[0]
  detail: ReturnType<typeof getPortfolioClosureSummary>
}) {
  if (!detail) {
    return null
  }

  const posture = getPortfolioPostureSummary(candidate)

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{detail.label}</p>
      <p className="mt-2 text-sm text-zinc-300">{detail.detail}</p>
      <p className="mt-3 text-xs uppercase tracking-[0.24em] text-zinc-500">
        {posture.priority} priority | {posture.sizing} sizing | {posture.conviction} conviction | {posture.primaryTheme}
      </p>
      {detail.closedFrom ? <p className="mt-2 text-xs text-zinc-500">{detail.closedFrom}</p> : null}
    </div>
  )
}

function EvaluationWorkspacePage() {
  const searchParams = useSearchParams()
  const { activity, decisionBriefs, investigationTrails, portfolioCandidates, recordInvestigationStep, rememberRecentItem } = useWorkspace()
  const [splitStats, setSplitStats] = useState<SplitStats | null>(null)
  const [contamination, setContamination] = useState<ContaminationAudit | null>(null)
  const [report, setReport] = useState<EvalReport | null>(null)
  const [activeSplit, setActiveSplit] = useState<"validation" | "test">("test")
  const [loading, setLoading] = useState(true)
  const [reportLoading, setReportLoading] = useState(false)

  useEffect(() => {
    let active = true

    const loadOverview = async () => {
      const [nextSplitStats, nextContamination] = await Promise.all([
        getEvalSplitStats(),
        getContaminationAudit(),
      ])

      if (!active) {
        return
      }

      setSplitStats(nextSplitStats)
      setContamination(nextContamination)
      setLoading(false)
    }

    void loadOverview()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadReport = async () => {
      setReportLoading(true)
      const nextReport = await getEvalReport(activeSplit)

      if (!active) {
        return
      }

      setReport(nextReport)
      setReportLoading(false)
    }

    void loadReport()

    return () => {
      active = false
    }
  }, [activeSplit])

  const totals = splitStats?.totals
  const grandTotal = (totals?.train ?? 0) + (totals?.validation ?? 0) + (totals?.test ?? 0)
  const splitDomains = splitStats?.by_domain ?? []
  const focusedTrailId = searchParams.get("trail")
  const focusedTrail = focusedTrailId
    ? investigationTrails.find((trail) => trail.id === focusedTrailId) ?? null
    : null
  const decisionBriefByInvestigationId = useMemo(
    () => new Map(decisionBriefs.map((brief) => [brief.investigation_id, brief])),
    [decisionBriefs],
  )
  const portfolioCandidateByDecisionBriefId = useMemo(
    () => buildLatestPortfolioCandidateByDecisionBriefId(portfolioCandidates),
    [portfolioCandidates],
  )
  const portfolioCandidateByInvestigationId = useMemo(
    () =>
      new Map(
        decisionBriefs.flatMap((brief) => {
          const candidate = portfolioCandidateByDecisionBriefId.get(brief.id)
          return candidate ? [[brief.investigation_id, candidate] as const] : []
        }),
      ),
    [decisionBriefs, portfolioCandidateByDecisionBriefId],
  )
  const focusedDecisionBrief = focusedTrail ? decisionBriefByInvestigationId.get(focusedTrail.id) ?? null : null
  const focusedPortfolioCandidate = focusedDecisionBrief
    ? portfolioCandidateByDecisionBriefId.get(focusedDecisionBrief.id) ?? null
    : null
  const benchmarkTrails = investigationTrails.filter((trail) => {
    const status = getTrailStatus(trail)
    return (
      (status === "ready_for_review" || status === "under_review") &&
      decisionBriefByInvestigationId.get(trail.id)?.status !== "closed"
    )
  }).slice(0, 3)
  const closedPortfolioCandidates = useMemo(
    () => portfolioCandidates.filter((candidate) => candidate.status === "closed").slice(0, 3),
    [portfolioCandidates],
  )
  const calibrationCurve = report?.calibration_curve ?? []
  const domainBreakdown = report?.domain_breakdown ?? []
  const contaminationEntries = contamination?.entries ?? []

  useEffect(() => {
    if (!focusedTrail) {
      return
    }

    recordInvestigationStep({
      trailId: focusedTrail.id,
      title: focusedTrail.title,
      eventId: focusedTrail.eventId,
      predictionId: focusedTrail.predictionIds[0] ?? null,
      href: `/evaluation?trail=${focusedTrail.id}`,
      detail: "Evaluation context opened to inspect benchmark, calibration, and statistical guidance for the active investigation.",
      updatedAt: new Date().toISOString(),
      kind: "evaluation_context",
      status: getTrailStatus(focusedTrail),
    })
    rememberRecentItem({
      id: `evaluation-trail:${focusedTrail.id}`,
      kind: "prediction",
      href: `/evaluation?trail=${focusedTrail.id}`,
      title: focusedTrail.title,
      description: "Evaluation context reopened for an active investigation.",
      updatedAt: new Date().toISOString(),
    })
  }, [focusedTrail, recordInvestigationStep, rememberRecentItem])

  return (
    <AppShell
      title="Evaluation"
      subtitle="Use the evaluation desk to inspect live benchmark context, retrospective closed outcomes, and the statistical trustworthiness of the intelligence engine."
    >
      {loading ? (
        <RouteLoadingState
          title="Loading evaluation desk"
          description="Split stats, contamination controls, and statistical reports are being loaded."
        />
      ) : (
        <div className="space-y-6">
          <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
            {!focusedTrail ? (
              <RouteEmptyState
                title="No focused investigation trail"
                description="Open Evaluation from prediction detail or a command-center trail to anchor the benchmark view to a specific investigation."
              />
            ) : (
              <div className="space-y-4">
                <InvestigationTrailSummary
                  trail={focusedTrail}
                  label="Focused investigation"
                  status={<InvestigationStatusBadge status={getTrailStatus(focusedTrail)} />}
                  actions={<InvestigationTrailActions trail={focusedTrail} />}
                  summary={<p>{getTrailNextStep(focusedTrail)}</p>}
                />
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Decision follow-through</p>
                  <p className="mt-2 text-sm text-zinc-400">
                    {decisionFollowThroughCopy(focusedDecisionBrief?.status ?? null)}
                  </p>
                  <div className="mt-3">
                    <DecisionContextRow
                      briefId={focusedDecisionBrief?.id ?? null}
                      briefStatus={focusedDecisionBrief?.status ?? null}
                    />
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Portfolio follow-through</p>
                  <p className="mt-2 text-sm text-zinc-400">
                    {getPortfolioCandidateContextCopy(focusedPortfolioCandidate?.status ?? null)}
                  </p>
                  <div className="mt-3">
                    <PortfolioContextRow
                      candidateId={focusedPortfolioCandidate?.id ?? null}
                      candidateStatus={focusedPortfolioCandidate?.status ?? null}
                    />
                  </div>
                </div>
                <InvestigationTrailSteps steps={focusedTrail.steps} limit={3} />
              </div>
            )}
          </section>

          <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">Benchmark follow-up</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  These active investigations still benefit from benchmark, calibration, or evaluation context before the operator closes the loop.
                </p>
              </div>
              <Link
                href="/accuracy"
                className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Open accuracy
              </Link>
            </div>
              <div className="mt-4 space-y-3">
                {benchmarkTrails.length ? (
                  benchmarkTrails.map((trail) => (
                    <div key={trail.id} className="space-y-3">
                      <InvestigationTrailSummary
                        trail={trail}
                        label="Benchmark follow-up"
                        status={<InvestigationStatusBadge status={getTrailStatus(trail)} />}
                        actions={<InvestigationTrailActions trail={trail} />}
                        summary={<p className="text-xs text-zinc-500">{getTrailNextStep(trail)}</p>}
                      />
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Decision context</p>
                        <div className="mt-3">
                          <DecisionContextRow
                            briefId={decisionBriefByInvestigationId.get(trail.id)?.id ?? null}
                            briefStatus={decisionBriefByInvestigationId.get(trail.id)?.status ?? null}
                            emptyLabel="Awaiting decision promotion"
                          />
                        </div>
                        <div className="mt-3">
                          <PortfolioContextRow
                            candidateId={portfolioCandidateByInvestigationId.get(trail.id)?.id ?? null}
                            candidateStatus={portfolioCandidateByInvestigationId.get(trail.id)?.status ?? null}
                            emptyLabel="Awaiting portfolio promotion"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                <RouteEmptyState
                  title="No active investigations need benchmark context"
                  description="Ready-for-review and under-review trails will appear here when they could benefit from evaluation and calibration context."
                />
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">Closed operating outcomes</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  These finished briefs should use evaluation as retrospective evidence, not as live benchmark follow-up.
                </p>
              </div>
              <Link
                href="/library"
                className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Open library
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {closedPortfolioCandidates.length ? (
                closedPortfolioCandidates.map((candidate) => {
                  const brief = decisionBriefs.find((entry) => entry.id === candidate.decision_brief_id) ?? null
                  const trail = investigationTrails.find((entry) => entry.id === candidate.investigation_id) ?? null
                  const closureSummary =
                    brief
                      ? getDecisionClosureSummary({
                          brief,
                          activity,
                        })
                      : null
                  const portfolioClosureSummary = getPortfolioClosureSummary({
                    candidate,
                    activity,
                  })

                  return (
                    <div key={candidate.id} className="space-y-3">
                      {trail ? (
                        <InvestigationTrailSummary
                          trail={trail}
                          label="Closed outcome"
                          status={<InvestigationStatusBadge status={getTrailStatus(trail)} />}
                          actions={<InvestigationTrailActions trail={trail} />}
                          summary={<p className="text-xs text-zinc-500">{getTrailNextStep(trail)}</p>}
                        />
                      ) : null}
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <p className="text-sm text-zinc-400">{getPortfolioCandidateContextCopy(candidate.status)}</p>
                          <ClosedPortfolioOutcomeSummary candidate={candidate} detail={portfolioClosureSummary} />
                          <div className="mt-3">
                            <PortfolioContextRow candidateId={candidate.id} candidateStatus={candidate.status} />
                          </div>
                        <ClosedDecisionOutcomeSummary detail={closureSummary} />
                        <div className="mt-3">
                          <DecisionContextRow
                            briefId={brief?.id ?? null}
                            briefStatus={brief?.status ?? null}
                            emptyLabel="No closed decision brief linked"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <RouteEmptyState
                  title="No closed operating outcomes yet"
                  description="Closed portfolio candidates will appear here as the team completes the portfolio loop and uses evaluation for retrospective context."
                />
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">Data splits</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Split version <span className="font-mono text-zinc-300">{splitStats?.split_version ?? "v1"}</span>
                {" | "}Frozen{" "}
                {splitStats?.freeze_date ? new Date(splitStats.freeze_date).toLocaleDateString() : "2026-03-20"}
              </p>
            </div>

            {totals ? (
              <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                <div className="mb-4 grid gap-4 md:grid-cols-4">
                  <div className="text-center">
                    <p className="text-xs text-zinc-500">TRAINING</p>
                    <p className="mt-2 text-2xl font-semibold text-blue-400">{totals.train}</p>
                    <p className="mt-1 text-xs text-zinc-600">Before Oct 2023</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-zinc-500">VALIDATION</p>
                    <p className="mt-2 text-2xl font-semibold text-amber-400">{totals.validation}</p>
                    <p className="mt-1 text-xs text-zinc-600">Oct 2023 to Apr 2024</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-zinc-500">TEST</p>
                    <p className="mt-2 text-2xl font-semibold text-emerald-400">{totals.test}</p>
                    <p className="mt-1 text-xs text-zinc-600">After Apr 2024</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-zinc-500">TOTAL</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{grandTotal}</p>
                    <p className="mt-1 text-xs text-zinc-600">Across all tracked domains</p>
                  </div>
                </div>
                <SplitBar train={totals.train} validation={totals.validation} test={totals.test} />
              </div>
            ) : null}

            {splitDomains.length ? (
              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-zinc-900/75">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Domain</th>
                      <th className="px-3 py-3 text-right font-medium text-blue-400">Train</th>
                      <th className="px-3 py-3 text-right font-medium text-amber-400">Validation</th>
                      <th className="px-3 py-3 text-right font-medium text-emerald-400">Test</th>
                      <th className="px-4 py-3 text-center font-medium text-zinc-500">Split</th>
                    </tr>
                  </thead>
                  <tbody>
                    {splitDomains
                      .sort((left, right) => right.total - left.total)
                      .map((row) => (
                        <tr key={row.domain} className="border-b border-zinc-800/40">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${DOMAIN_COLORS[row.domain] ?? "bg-zinc-500"}`} />
                              <span className="text-zinc-300">{row.domain.replace(/_/g, " ")}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-blue-300">{row.train}</td>
                          <td className="px-3 py-3 text-right font-mono text-amber-300">{row.validation}</td>
                          <td className="px-3 py-3 text-right font-mono text-emerald-300">{row.test}</td>
                          <td className="w-32 px-4 py-3">
                            <SplitBar train={row.train} validation={row.validation} test={row.test} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {splitStats?.power_assessment ? (
              <p className="text-xs text-zinc-600">{splitStats.power_assessment}</p>
            ) : null}
          </section>

          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">Statistical report</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Bonferroni corrected. The aggregate test checks whether accuracy is materially above chance.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveSplit("validation")}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                    activeSplit === "validation"
                      ? "bg-amber-500 text-black"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  Validation
                </button>
                <button
                  onClick={() => setActiveSplit("test")}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                    activeSplit === "test"
                      ? "bg-emerald-500 text-black"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  Test
                </button>
              </div>
            </div>

            {reportLoading ? (
              <div className="text-sm text-zinc-600 animate-pulse">Loading report...</div>
            ) : report && report.n_scored > 0 ? (
              <>
                <div className="grid gap-4 md:grid-cols-4">
                  <StatCard
                    label="Overall accuracy"
                    value={pct(report.overall_accuracy)}
                    sub={`${report.n_independent_events} independent events`}
                    color={
                      report.overall_accuracy >= 0.65
                        ? "text-emerald-400"
                        : report.overall_accuracy >= 0.5
                          ? "text-amber-400"
                          : "text-red-400"
                    }
                  />
                  <StatCard
                    label="Brier score"
                    value={report.brier_score.toFixed(3)}
                    sub="Lower is better"
                    color={
                      report.brier_score < 0.2
                        ? "text-emerald-400"
                        : report.brier_score < 0.25
                          ? "text-amber-400"
                          : "text-red-400"
                    }
                  />
                  <StatCard
                    label="p-value"
                    value={report.aggregate_p_value < 0.001 ? "<0.001" : report.aggregate_p_value.toFixed(4)}
                    sub={`Threshold ${report.bonferroni_threshold.toFixed(4)}`}
                    color={report.is_statistically_significant ? "text-emerald-400" : "text-zinc-400"}
                  />
                  <StatCard
                    label="Significance"
                    value={report.is_statistically_significant ? "Significant" : "Not yet"}
                    sub={report.aggregate_powered ? "Adequately powered" : "More predictions needed"}
                    color={report.is_statistically_significant ? "text-emerald-400" : "text-zinc-500"}
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                    <p className="mb-3 text-xs tracking-widest text-zinc-500">BY CONFIDENCE LEVEL</p>
                    <div className="space-y-3">
                      {[
                        { label: "High confidence", value: report.high_conf_accuracy, color: "bg-emerald-500" },
                        { label: "Medium confidence", value: report.medium_conf_accuracy, color: "bg-amber-500" },
                        { label: "Low confidence", value: report.low_conf_accuracy, color: "bg-zinc-500" },
                      ].map((item) => (
                        <div key={item.label}>
                          <div className="mb-1 flex justify-between">
                            <span className="text-xs text-zinc-400">{item.label}</span>
                            <AccuracyBadge value={item.value} />
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className={`h-full rounded-full ${item.color}`}
                              style={{ width: item.value !== null ? `${(item.value * 100).toFixed(1)}%` : "0%" }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                    <p className="mb-3 text-xs tracking-widest text-zinc-500">CALIBRATION CURVE</p>
                    <div className="space-y-3">
                      {calibrationCurve.length ? (
                        calibrationCurve.map((bin) => (
                          <div key={bin.bin}>
                            <div className="mb-1 flex justify-between">
                              <span className="text-xs text-zinc-400">
                                {bin.bin} (n={bin.n})
                              </span>
                              <AccuracyBadge value={bin.accuracy} />
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-blue-500"
                                style={{ width: `${(bin.accuracy * 100).toFixed(1)}%` }}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <RouteEmptyState
                          title="No calibration curve yet"
                          description="Calibration bins will appear once enough scored predictions have accumulated for this split."
                        />
                      )}
                    </div>
                  </div>
                </div>

                {domainBreakdown.length ? (
                  <div className="overflow-hidden rounded-[24px] border border-white/10 bg-zinc-900/75">
                    <div className="border-b border-zinc-800 px-4 py-3">
                      <p className="text-xs tracking-widest text-zinc-500">DOMAIN BREAKDOWN</p>
                      <p className="mt-1 text-xs text-zinc-600">
                        Domain tests with n below 10 are directional only and still underpowered.
                      </p>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800/50">
                          <th className="px-4 py-2 text-left font-medium text-zinc-500">Domain</th>
                          <th className="px-3 py-2 text-right font-medium text-zinc-500">n</th>
                          <th className="px-3 py-2 text-right font-medium text-zinc-500">Correct</th>
                          <th className="px-4 py-2 text-right font-medium text-zinc-500">Accuracy</th>
                          <th className="px-4 py-2 text-right font-medium text-zinc-500">p-value</th>
                          <th className="px-4 py-2 text-center font-medium text-zinc-500">Sig.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(domainBreakdown as DomainReport[])
                          .sort((left, right) => right.n - left.n)
                          .map((domain) => (
                            <tr key={domain.domain} className="border-b border-zinc-800/30">
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${DOMAIN_COLORS[domain.domain] ?? "bg-zinc-500"}`} />
                                  <span className="text-zinc-300">{domain.domain.replace(/_/g, " ")}</span>
                                  {!domain.is_powered ? <span className="text-xs text-zinc-600">(low n)</span> : null}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-400">{domain.n}</td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-400">{domain.n_correct}</td>
                              <td className="px-4 py-2 text-right">
                                <AccuracyBadge value={domain.accuracy} powered={domain.is_powered} />
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-zinc-500">
                                {domain.p_value < 0.001 ? "<0.001" : domain.p_value.toFixed(4)}
                              </td>
                              <td className="px-4 py-2 text-center">
                                {domain.is_significant ? (
                                  <span className="font-bold text-emerald-400">Yes</span>
                                ) : (
                                  <span className="text-zinc-600">No</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : (
              <RouteEmptyState
                title={`No scored predictions yet for the ${activeSplit} split`}
                description="Once the evaluation flow starts storing scored oracle outcomes, the report will populate here automatically."
              />
            )}
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">Contamination audit</h2>
              <p className="mt-1 text-xs text-zinc-500">
                A transparent record of known data-quality issues across train, validation, and test boundaries.
              </p>
            </div>

            {contamination ? (
              <>
                <div className="grid gap-4 md:grid-cols-4">
                  <StatCard label="Total entries" value={contamination.total} sub="Documented risks" />
                  <StatCard label="Warnings" value={contamination.warnings} sub="Require attention" color="text-amber-400" />
                  <StatCard label="Info" value={contamination.infos} sub="No action needed" color="text-blue-400" />
                  <StatCard
                    label="Invalidating"
                    value={contamination.invalidating}
                    sub="Would break results"
                    color={contamination.invalidating > 0 ? "text-red-400" : "text-emerald-400"}
                  />
                </div>

                <div className="space-y-2">
                  {contaminationEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded-[24px] border p-4 ${
                        entry.severity === "warning"
                          ? "border-amber-900/50 bg-zinc-900/75"
                          : entry.severity === "error"
                            ? "border-red-900/50 bg-zinc-900/75"
                            : "border-white/10 bg-zinc-900/75"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          <SeverityDot severity={entry.severity} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-zinc-300">{entry.id}</span>
                            <span className="text-xs uppercase tracking-wide text-zinc-600">
                              {entry.type.replace(/_/g, " ")}
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {entry.splits_involved.map((split) => (
                                <span
                                  key={split}
                                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                    split === "test"
                                      ? "border border-emerald-800 bg-emerald-950 text-emerald-400"
                                      : split === "validation"
                                        ? "border border-amber-800 bg-amber-950 text-amber-400"
                                        : "bg-zinc-800 text-zinc-400"
                                  }`}
                                >
                                  {split}
                                </span>
                              ))}
                            </div>
                            {entry.invalidates_results ? (
                              <span className="rounded border border-red-800 bg-red-950 px-1.5 py-0.5 text-xs text-red-400">
                                invalidating
                              </span>
                            ) : null}
                          </div>
                          <p className="text-sm text-zinc-300">{entry.description}</p>
                          <p className="mt-1 text-xs text-zinc-600">
                            <span className="text-zinc-500">Mitigation: </span>
                            {entry.mitigation}
                          </p>
                          {(entry.case_ids ?? []).length ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {(entry.case_ids ?? []).map((id) => (
                                <span key={id} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-600">
                                  {id}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <RouteEmptyState
                title="No contamination audit data yet"
                description="A contamination audit will appear here once the evaluation desk has stored contamination controls."
              />
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}

export default function EvaluationPage() {
  return (
    <Suspense
      fallback={
        <AppShell
          title="Evaluation"
          subtitle="Inspect data splits, statistical validity, calibration, and contamination controls for the replayed intelligence engine."
        >
          <RouteLoadingState
            title="Loading evaluation desk"
            description="Restoring benchmark, calibration, and focused investigation context."
          />
        </AppShell>
      }
    >
      <EvaluationWorkspacePage />
    </Suspense>
  )
}
