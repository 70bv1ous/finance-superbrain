"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"

import { AppShell } from "@/components/AppShell"
import { DecisionStatusBadge } from "@/components/DecisionStatusBadge"
import { InvestigationStatusBadge } from "@/components/InvestigationStatusBadge"
import { InvestigationTrailActions, InvestigationTrailSteps, InvestigationTrailSummary } from "@/components/InvestigationTrailView"
import { PortfolioStatusBadge } from "@/components/PortfolioStatusBadge"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import {
  getLessonExplorer,
  getObsidianImportCandidates,
  getLessons,
  getLibraryPacks,
  getMemoryConnections,
  searchLessons,
  applyObsidianImportCandidates,
  type Lesson,
  type LessonExplorerItem,
  type LessonSearchResult,
  type LibraryPackStat,
  type MemoryConnection,
  type ObsidianImportReviewResponse,
} from "@/lib/chatApi"
import { getDecisionClosureSummary } from "@/lib/decisionRetrospective"
import { getInvestigationStatusSummary, getTrailNextStep, getTrailStatus } from "@/lib/investigationTrail"
import {
  buildLatestPortfolioCandidateByDecisionBriefId,
  getPortfolioCandidateContextCopy,
  getPortfolioClosureSummary,
  getPortfolioPostureSummary,
} from "@/lib/portfolioRetrospective"

type PackMeta = {
  pack_id: string
  domain: string
  label: string
  icon: string
  color: string
  border: string
  bg: string
  description: string
}

const PACK_META: PackMeta[] = [
  {
    pack_id: "macro_calendar_v1",
    domain: "macro",
    label: "Macro Calendar",
    icon: "MC",
    color: "text-blue-400",
    border: "border-blue-800",
    bg: "bg-blue-950/40",
    description: "CPI prints, PCE releases, GDP revisions, and macro surprise events.",
  },
  {
    pack_id: "earnings_v1",
    domain: "earnings",
    label: "Earnings",
    icon: "ER",
    color: "text-cyan-400",
    border: "border-cyan-800",
    bg: "bg-cyan-950/40",
    description: "Mega-cap earnings beats and misses, guidance cuts, and sector read-throughs.",
  },
  {
    pack_id: "policy_fx_v1",
    domain: "policy_fx",
    label: "Policy and FX",
    icon: "FX",
    color: "text-indigo-400",
    border: "border-indigo-800",
    bg: "bg-indigo-950/40",
    description: "Central-bank pivots, intervention risk, sanctions shocks, and currency regime changes.",
  },
  {
    pack_id: "energy_v1",
    domain: "energy",
    label: "Energy",
    icon: "EN",
    color: "text-yellow-400",
    border: "border-yellow-800",
    bg: "bg-yellow-950/40",
    description: "OPEC+ supply cuts, oil shocks, demand collapses, and natural-gas stress events.",
  },
  {
    pack_id: "credit_banking_v1",
    domain: "credit",
    label: "Credit and Banking",
    icon: "CR",
    color: "text-rose-400",
    border: "border-rose-800",
    bg: "bg-rose-950/40",
    description: "Bank failures, spread blowouts, funding stress, and credit contagion events.",
  },
  {
    pack_id: "crypto_v1",
    domain: "crypto",
    label: "Crypto",
    icon: "CC",
    color: "text-orange-400",
    border: "border-orange-800",
    bg: "bg-orange-950/40",
    description: "Exchange collapses, ETF approvals, liquidation cascades, and stablecoin breaks.",
  },
  {
    pack_id: "china_macro_v1",
    domain: "china",
    label: "China Macro",
    icon: "CN",
    color: "text-red-400",
    border: "border-red-800",
    bg: "bg-red-950/40",
    description: "PBOC stimulus, property stress, reopening pivots, crackdowns, and Taiwan risk.",
  },
  {
    pack_id: "commodities_v1",
    domain: "commodities",
    label: "Commodities",
    icon: "CM",
    color: "text-amber-400",
    border: "border-amber-800",
    bg: "bg-amber-950/40",
    description: "Gold, copper, wheat, and broader commodity regime shifts and supply shocks.",
  },
  {
    pack_id: "geopolitical_v1",
    domain: "geopolitical",
    label: "Geopolitical",
    icon: "GP",
    color: "text-purple-400",
    border: "border-purple-800",
    bg: "bg-purple-950/40",
    description: "War, sanctions, tariff escalation, and macro risk-off contagion events.",
  },
  {
    pack_id: "volatility_v1",
    domain: "volatility",
    label: "Volatility",
    icon: "VX",
    color: "text-violet-400",
    border: "border-violet-800",
    bg: "bg-violet-950/40",
    description: "VIX spikes, gamma squeezes, vol regime changes, and short-vol unwind episodes.",
  },
  {
    pack_id: "real_estate_housing_v1",
    domain: "real_estate_housing",
    label: "Real Estate",
    icon: "RE",
    color: "text-teal-400",
    border: "border-teal-800",
    bg: "bg-teal-950/40",
    description: "Mortgage shocks, REIT selloffs, housing starts misses, and MBS dislocations.",
  },
  {
    pack_id: "sovereign_debt_v1",
    domain: "sovereign_debt",
    label: "Sovereign Debt",
    icon: "SD",
    color: "text-emerald-400",
    border: "border-emerald-800",
    bg: "bg-emerald-950/40",
    description: "Debt-ceiling stress, downgrade risk, LDI-style crises, and sovereign spread blowouts.",
  },
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}yr ago`
}

function PackCard({
  meta,
  stat,
}: {
  meta: PackMeta
  stat: LibraryPackStat | undefined
}) {
  const count = stat?.case_count ?? 0
  const reviewed = stat?.reviewed_count ?? 0
  const latest = stat?.latest_case_at ?? null
  const seeded = count > 0

  return (
    <div
      className={`relative flex flex-col gap-3 rounded-[24px] border p-4 transition-all ${
        seeded ? `${meta.border} ${meta.bg} hover:brightness-110` : "border-zinc-800 bg-zinc-900/50 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold tracking-[0.18em] text-zinc-200">
            {meta.icon}
          </span>
          <div>
            <p className={`text-sm font-semibold ${seeded ? meta.color : "text-zinc-500"}`}>{meta.label}</p>
            <p className="font-mono text-xs text-zinc-600">{meta.pack_id}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-2xl font-semibold tabular-nums ${seeded ? meta.color : "text-zinc-700"}`}>{count}</p>
          <p className="text-xs text-zinc-600">cases</p>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-zinc-400">{meta.description}</p>

      <div className="flex items-center justify-between border-t border-zinc-800/60 pt-1">
        {seeded ? (
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">
                <span className="font-medium text-emerald-400">{reviewed}</span> reviewed
              </span>
              {stat && stat.draft_count > 0 ? (
                <span className="text-xs text-zinc-500">
                  <span className="font-medium text-amber-400">{stat.draft_count}</span> draft
                </span>
              ) : null}
            </div>
            {latest ? <span className="text-xs text-zinc-600">{timeAgo(latest)}</span> : null}
          </>
        ) : (
          <span className="text-xs italic text-zinc-700">Not yet seeded</span>
        )}
      </div>
    </div>
  )
}

function DecisionContextRow({
  briefId,
  briefStatus,
  emptyLabel = "Research-only memory",
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
  emptyLabel = "Not promoted into portfolio",
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

function decisionOutcomeCopy(status: "draft" | "proposed" | "active" | "watching" | "closed" | null | undefined) {
  switch (status) {
    case "closed":
      return "This lesson belongs to a closed decision outcome and should be read as closure evidence, not open operating work."
    case "watching":
      return "This lesson feeds a watching brief and can help decide whether the thesis should stay on the watchlist or return to active monitoring."
    case "active":
      return "This lesson is still attached to an active brief and should reinforce the live operating thesis."
    case "proposed":
    case "draft":
      return "This lesson is linked to a brief that has not fully entered the live monitoring loop yet."
    default:
      return "This memory is still research-only and not linked to a shared decision brief."
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

function isObsidianImportedLesson(lesson: Lesson) {
  return lesson.metadata.imported_from === "obsidian" || lesson.metadata.import_mode === "selective_human_inbox"
}

function getMetadataList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function LinkedObjectChips({
  investigationId,
  decisionBriefId,
  portfolioCandidateId,
  interactive = true,
}: {
  investigationId?: string | null
  decisionBriefId?: string | null
  portfolioCandidateId?: string | null
  interactive?: boolean
}) {
  const links = [
    investigationId
      ? {
          key: "investigation",
          label: "Investigation",
          value: investigationId,
          href: "/investigations",
        }
      : null,
    decisionBriefId
      ? {
          key: "decision",
          label: "Decision",
          value: decisionBriefId,
          href: `/decisions/${decisionBriefId}`,
        }
      : null,
    portfolioCandidateId
      ? {
          key: "portfolio",
          label: "Portfolio",
          value: portfolioCandidateId,
          href: `/portfolio/${portfolioCandidateId}`,
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; href: string }>

  if (!links.length) {
    return null
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {links.map((link) =>
        interactive ? (
          <Link
            key={`${link.key}:${link.value}`}
            href={link.href}
            className="rounded-full border border-emerald-300/20 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-emerald-50/85 transition-colors hover:border-emerald-200/50 hover:text-white"
            title={link.value}
          >
            {link.label} link
          </Link>
        ) : (
          <span
            key={`${link.key}:${link.value}`}
            className="rounded-full border border-violet-300/15 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-violet-100/70"
            title={link.value}
          >
            {link.label}: {link.value.slice(0, 12)}
          </span>
        ),
      )}
    </div>
  )
}

function ImportedHumanMemoryCard({ lessons }: { lessons: Lesson[] }) {
  const importedLessons = lessons.filter(isObsidianImportedLesson)

  if (!importedLessons.length) {
    return (
      <section className="rounded-[24px] border border-dashed border-white/10 bg-zinc-950/50 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Obsidian human memory</p>
        <p className="mt-2 text-sm text-zinc-400">
          No selective human notes have been imported yet. Add a tagged note to the Obsidian Human Inbox, then run the
          dry-run/apply import flow to make the second brain visible here.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">npm run ops:obsidian-import -- --dry-run</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">npm run ops:obsidian-import -- --apply</span>
        </div>
      </section>
    )
  }

  const latest = importedLessons
    .slice()
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
  const latestPath = latest.metadata.obsidian_relative_path ?? "Human Inbox note"
  const themes = [...new Set(importedLessons.flatMap((lesson) => getMetadataList(lesson.metadata.themes)))].slice(0, 5)
  const assets = [...new Set(importedLessons.flatMap((lesson) => getMetadataList(lesson.metadata.assets)))].slice(0, 5)
  const linkedCount = importedLessons.filter(
    (lesson) => lesson.metadata.investigation_id || lesson.metadata.decision_brief_id || lesson.metadata.portfolio_candidate_id,
  ).length

  return (
    <section className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-emerald-200">Obsidian human memory</p>
          <h3 className="mt-2 font-display text-lg font-semibold text-white">
            {importedLessons.length} imported note{importedLessons.length === 1 ? "" : "s"} now feeding the lesson base
          </h3>
          <p className="mt-2 text-sm text-emerald-50/80">
            Latest import: {latestPath}. These notes remain retrieval-only lessons, so Obsidian helps the brain remember
            without changing investigations, decisions, or portfolio state.
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.24em] text-emerald-100/70">
            {linkedCount} linked to app objects
          </p>
        </div>
        <Link
          href={`/predictions/${latest.prediction_id}`}
          className="rounded-full border border-emerald-300/30 bg-black/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-200/60 hover:text-white"
        >
          Open latest memory
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {themes.map((theme) => (
          <span key={`theme:${theme}`} className="rounded-full border border-emerald-300/20 bg-black/15 px-2.5 py-1 text-[11px] text-emerald-50/85">
            theme: {theme}
          </span>
        ))}
        {assets.map((asset) => (
          <span key={`asset:${asset}`} className="rounded-full border border-emerald-300/20 bg-black/15 px-2.5 py-1 text-[11px] text-emerald-50/85">
            asset: {asset}
          </span>
        ))}
      </div>
      <LinkedObjectChips
        investigationId={latest.metadata.investigation_id}
        decisionBriefId={latest.metadata.decision_brief_id}
        portfolioCandidateId={latest.metadata.portfolio_candidate_id}
      />
    </section>
  )
}

function ObsidianImportReviewQueue({
  review,
  onRefresh,
}: {
  review: ObsidianImportReviewResponse | null
  onRefresh: () => Promise<void>
}) {
  const [selectedHashes, setSelectedHashes] = useState<string[]>([])
  const [applying, setApplying] = useState(false)
  const importableCandidates = useMemo(
    () => review?.candidates.filter((candidate) => candidate.status === "importable") ?? [],
    [review],
  )
  const reviewSignature = useMemo(
    () => review?.candidates.map((candidate) => `${candidate.content_hash}:${candidate.status}`).join("|") ?? "none",
    [review],
  )

  useEffect(() => {
    setSelectedHashes(importableCandidates.map((candidate) => candidate.content_hash))
  }, [importableCandidates, reviewSignature])

  if (!review) {
    return (
      <section className="rounded-[24px] border border-dashed border-white/10 bg-zinc-950/50 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Import review queue</p>
        <h3 className="mt-2 font-display text-lg font-semibold text-white">No review data loaded</h3>
        <p className="mt-2 text-sm text-zinc-400">
          The Obsidian review queue is unavailable until the API can read your vault and produce import candidates.
        </p>
      </section>
    )
  }

  const selectedSet = new Set(selectedHashes)
  const toggleHash = (hash: string) => {
    setSelectedHashes((current) =>
      current.includes(hash) ? current.filter((value) => value !== hash) : [...current, hash],
    )
  }

  const applySelected = async () => {
    setApplying(true)
    try {
      const result = await applyObsidianImportCandidates(selectedHashes)
      if (result) {
        await onRefresh()
      }
    } finally {
      setApplying(false)
    }
  }

  const selectedImportables = importableCandidates.filter((candidate) => selectedSet.has(candidate.content_hash))
  const canSaveReview = importableCandidates.length > 0

  return (
    <section className="rounded-[24px] border border-violet-500/20 bg-violet-500/10 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-violet-200">Import review queue</p>
          <h3 className="mt-2 font-display text-lg font-semibold text-white">
            {importableCandidates.length} importable note{importableCandidates.length === 1 ? "" : "s"} awaiting review
          </h3>
          <p className="mt-2 max-w-3xl text-sm text-violet-50/80">
            Review the Human Inbox candidates before they become retrieval memory. Only selected notes are imported.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <div className="text-[11px] uppercase tracking-[0.24em] text-violet-100/80">
            Selected {selectedImportables.length}/{importableCandidates.length}
          </div>
          <button
            type="button"
            onClick={applySelected}
            disabled={applying || !canSaveReview}
            className="rounded-full border border-violet-300/30 bg-black/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-violet-100 transition-colors hover:border-violet-200/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {applying ? "Saving..." : selectedImportables.length > 0 ? "Apply selected" : "Reject all"}
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {review.candidates.map((candidate) => {
          const selected = selectedSet.has(candidate.content_hash)
          const importable = candidate.status === "importable"
          const statusLabel =
            candidate.status === "importable"
              ? "ready"
              : candidate.status === "duplicate"
                ? "duplicate"
                : candidate.status === "imported"
                  ? "imported"
                  : candidate.status

          return (
            <label
              key={candidate.content_hash}
              className={`block rounded-2xl border p-4 transition-colors ${
                selected && importable ? "border-violet-300/30 bg-black/15" : "border-white/10 bg-black/10"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!importable}
                  onChange={() => toggleHash(candidate.content_hash)}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-black/40 text-violet-400"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{candidate.title}</p>
                      <p className="mt-1 text-xs text-violet-50/70">{candidate.relative_path}</p>
                    </div>
                    <span className="rounded-full border border-violet-300/20 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-violet-100/85">
                      {statusLabel}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-violet-50/80">{candidate.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {candidate.themes.slice(0, 4).map((theme) => (
                      <span key={`theme:${candidate.content_hash}:${theme}`} className="rounded-full border border-violet-300/15 bg-white/5 px-2 py-1 text-[11px] text-violet-50/75">
                        theme: {theme}
                      </span>
                    ))}
                    {candidate.assets.slice(0, 4).map((asset) => (
                      <span key={`asset:${candidate.content_hash}:${asset}`} className="rounded-full border border-violet-300/15 bg-white/5 px-2 py-1 text-[11px] text-violet-50/75">
                        asset: {asset}
                      </span>
                    ))}
                  </div>
                  {candidate.reason ? <p className="mt-3 text-xs text-violet-100/70">{candidate.reason}</p> : null}
                  <LinkedObjectChips
                    investigationId={candidate.linked_investigation_id}
                    decisionBriefId={candidate.linked_decision_brief_id}
                    portfolioCandidateId={candidate.linked_portfolio_candidate_id}
                    interactive={false}
                  />
                  {candidate.linked_prediction_id ? (
                    <span className="mt-3 inline-flex rounded-full border border-violet-300/15 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-violet-100/70">
                      Prediction: {candidate.linked_prediction_id.slice(0, 12)}
                    </span>
                  ) : null}
                </div>
              </div>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function connectionKindLabel(kind: MemoryConnection["nodes"][number]["kind"]) {
  switch (kind) {
    case "decision_brief":
      return "Decision"
    case "portfolio_candidate":
      return "Portfolio"
    case "lesson":
      return "Lesson"
  }
}

function ConnectionReviewPanel({ connections }: { connections: MemoryConnection[] }) {
  if (!connections.length) {
    return (
      <section className="rounded-[24px] border border-dashed border-white/10 bg-zinc-950/50 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Connection review</p>
        <h3 className="mt-2 font-display text-lg font-semibold text-white">No repeated memory signals yet</h3>
        <p className="mt-2 text-sm text-zinc-400">
          Connections appear when decisions, portfolio candidates, lessons, or imported Obsidian notes share assets or themes.
        </p>
      </section>
    )
  }

  const assetCount = connections.filter((connection) => connection.signal === "asset").length
  const themeCount = connections.filter((connection) => connection.signal === "theme").length

  return (
    <section className="rounded-[24px] border border-cyan-500/20 bg-cyan-500/10 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">Connection review</p>
          <h3 className="mt-2 font-display text-lg font-semibold text-white">Explainable relationship leads</h3>
          <p className="mt-2 max-w-3xl text-sm text-cyan-50/80">
            These are generated from repeated assets and themes across the memory base. Review them as leads before they influence a decision,
            portfolio candidate, or any money-adjacent workflow.
          </p>
        </div>
        <div className="flex shrink-0 gap-2 text-[11px] uppercase tracking-[0.24em] text-cyan-100">
          <span className="rounded-full border border-cyan-300/20 bg-black/15 px-2.5 py-1">{assetCount} asset</span>
          <span className="rounded-full border border-cyan-300/20 bg-black/15 px-2.5 py-1">{themeCount} theme</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        {connections.slice(0, 6).map((connection) => (
          <div key={connection.key} className="rounded-2xl border border-cyan-300/15 bg-black/15 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">{connection.signal}</p>
                <p className="mt-1 text-sm font-semibold text-white">{connection.label}</p>
              </div>
              <span className="rounded-full border border-cyan-300/20 bg-white/5 px-2.5 py-1 text-[11px] text-cyan-50/85">
                {connection.nodes.length} links
              </span>
            </div>
            <p className="mt-3 text-sm text-cyan-50/80">{connection.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {connection.reason_codes.slice(0, 4).map((reason) => (
                <span key={reason} className="rounded-full border border-cyan-300/15 bg-white/5 px-2 py-1 text-[11px] text-cyan-50/75">
                  {reason.replace(/_/g, " ")}
                </span>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {connection.nodes.slice(0, 3).map((node) => (
                <div key={`${connection.key}:${node.kind}:${node.id}`} className="flex items-start justify-between gap-3 border-t border-cyan-300/10 pt-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/80">{connectionKindLabel(node.kind)}</p>
                    <p className="mt-1 text-xs font-medium text-white">{node.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-cyan-50/65">{node.summary}</p>
                  </div>
                  <Link href={node.href} className="shrink-0 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:text-white">
                    Open
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function LessonCard({
  lesson,
  decisionBriefId,
  decisionStatus,
  portfolioCandidateId,
  portfolioStatus,
}: {
  lesson: Lesson
  decisionBriefId?: string | null
  decisionStatus?: "draft" | "proposed" | "active" | "watching" | "closed" | null
  portfolioCandidateId?: string | null
  portfolioStatus?: "candidate" | "active" | "watching" | "trimmed" | "closed" | null
}) {
  const importedFromObsidian = isObsidianImportedLesson(lesson)
  const importPath = lesson.metadata.obsidian_relative_path
  const importTags = getMetadataList(lesson.metadata.tags)
  const importThemes = getMetadataList(lesson.metadata.themes)
  const importAssets = getMetadataList(lesson.metadata.assets)
  const metadataEntries = Object.entries(lesson.metadata)
    .filter(([key]) => !["imported_from", "import_mode", "obsidian_relative_path", "obsidian_content_hash", "tags", "themes", "assets", "investigation_id", "decision_brief_id", "portfolio_candidate_id"].includes(key))
    .slice(0, 2)

  return (
    <div className={`rounded-[24px] border p-4 ${importedFromObsidian ? "border-emerald-500/20 bg-emerald-500/10" : "border-white/10 bg-zinc-900/75"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] ${
              lesson.lesson_type === "reinforcement"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-amber-500/30 bg-amber-500/10 text-amber-200"
            }`}
          >
            {lesson.lesson_type}
          </span>
          {importedFromObsidian ? (
            <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100">
              Obsidian human memory
            </span>
          ) : null}
        </div>
        <span className="text-xs text-zinc-500">{timeAgo(lesson.created_at)}</span>
      </div>
      <p className="mt-3 text-sm text-zinc-200">{lesson.lesson_summary}</p>
      {importedFromObsidian ? (
        <div className="mt-3 rounded-2xl border border-emerald-300/20 bg-black/15 p-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-200">Imported source</p>
          <p className="mt-2 text-xs text-emerald-50/80">{importPath ?? "Obsidian Human Inbox note"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...importTags.map((value) => `tag: ${value}`), ...importThemes.map((value) => `theme: ${value}`), ...importAssets.map((value) => `asset: ${value}`)]
              .slice(0, 6)
              .map((label) => (
                <span key={label} className="rounded-full border border-emerald-300/20 bg-white/5 px-2 py-1 text-[11px] text-emerald-50/80">
                  {label}
                </span>
              ))}
          </div>
          <LinkedObjectChips
            investigationId={lesson.metadata.investigation_id}
            decisionBriefId={lesson.metadata.decision_brief_id}
            portfolioCandidateId={lesson.metadata.portfolio_candidate_id}
          />
        </div>
      ) : null}
      {metadataEntries.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {metadataEntries.map(([key, value]) => (
            <span key={key} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-400">
              {key}: {value}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/predictions/${lesson.prediction_id}`}
          className="text-xs text-emerald-300 transition-colors hover:text-emerald-200"
        >
          Open prediction detail
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <DecisionContextRow briefId={decisionBriefId} briefStatus={decisionStatus} />
          <PortfolioContextRow candidateId={portfolioCandidateId} candidateStatus={portfolioStatus} />
        </div>
      </div>
    </div>
  )
}

function SearchResultCard({
  result,
  decisionBriefId,
  decisionStatus,
  portfolioCandidateId,
  portfolioStatus,
}: {
  result: LessonSearchResult
  decisionBriefId?: string | null
  decisionStatus?: "draft" | "proposed" | "active" | "watching" | "closed" | null
  portfolioCandidateId?: string | null
  portfolioStatus?: "candidate" | "active" | "watching" | "trimmed" | "closed" | null
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] ${
              result.lesson_type === "reinforcement"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-amber-500/30 bg-amber-500/10 text-amber-200"
            }`}
          >
            {result.lesson_type}
          </span>
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
            {result.horizon}
          </span>
        </div>
        <span className="text-xs text-zinc-500">match {Math.round(result.score * 100)}%</span>
      </div>
      <p className="mt-3 text-sm font-medium text-white">{result.lesson_summary}</p>
      <p className="mt-2 text-sm text-zinc-400">{result.event_summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {result.themes.slice(0, 4).map((theme) => (
          <span key={theme} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-400">
            {theme}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
        <span>{result.verdict ? `Verdict ${result.verdict.replace(/_/g, " ")}` : "No verdict yet"}</span>
        <div className="flex flex-wrap items-center gap-3">
          <DecisionContextRow briefId={decisionBriefId} briefStatus={decisionStatus} />
          <PortfolioContextRow candidateId={portfolioCandidateId} candidateStatus={portfolioStatus} />
          <Link
            href={`/predictions/${result.prediction_id}`}
            className="text-emerald-300 transition-colors hover:text-emerald-200"
          >
            Open prediction detail
          </Link>
        </div>
      </div>
    </div>
  )
}

function ExplorerFilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] transition-colors ${
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-100"
      }`}
    >
      {label}
    </button>
  )
}

function ExplorerResultCard({
  item,
  decisionBriefId,
  decisionStatus,
  portfolioCandidateId,
  portfolioStatus,
}: {
  item: LessonExplorerItem
  decisionBriefId?: string | null
  decisionStatus?: "draft" | "proposed" | "active" | "watching" | "closed" | null
  portfolioCandidateId?: string | null
  portfolioStatus?: "candidate" | "active" | "watching" | "trimmed" | "closed" | null
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] ${
              item.lesson_type === "reinforcement"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-amber-500/30 bg-amber-500/10 text-amber-200"
            }`}
          >
            {item.lesson_type}
          </span>
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
            {item.horizon}
          </span>
          {item.verdict ? (
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
              {item.verdict.replace(/_/g, " ")}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-zinc-500">{timeAgo(item.created_at)}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-white">{item.lesson_summary}</p>
      <p className="mt-2 text-sm text-zinc-400">{item.event_summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {item.themes.slice(0, 4).map((theme) => (
          <span key={theme} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-400">
            {theme}
          </span>
        ))}
        {item.failure_tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200/80"
          >
            {tag.replace(/_/g, " ")}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
        <span>
          {item.total_score !== null ? `Total score ${Math.round(item.total_score * 100)}%` : `Sentiment ${item.sentiment.replace(/_/g, " ")}`}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <DecisionContextRow briefId={decisionBriefId} briefStatus={decisionStatus} />
          <PortfolioContextRow candidateId={portfolioCandidateId} candidateStatus={portfolioStatus} />
          <Link
            href={`/predictions/${item.prediction_id}`}
            className="text-emerald-300 transition-colors hover:text-emerald-200"
          >
            Open prediction detail
          </Link>
        </div>
      </div>
    </div>
  )
}

function LibraryWorkspacePage() {
  const searchParams = useSearchParams()
  const { activity, decisionBriefs, investigationTrails, portfolioCandidates, recordInvestigationStep, rememberRecentItem } = useWorkspace()
  const [packsResponse, setPacksResponse] = useState<{
    packs: LibraryPackStat[]
    total_cases: number
    pack_count: number
  } | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [explorerItems, setExplorerItems] = useState<LessonExplorerItem[]>([])
  const [memoryConnections, setMemoryConnections] = useState<MemoryConnection[]>([])
  const [importReview, setImportReview] = useState<ObsidianImportReviewResponse | null>(null)
  const [searchResults, setSearchResults] = useState<LessonSearchResult[]>([])
  const [query, setQuery] = useState("")
  const [explorerQuery, setExplorerQuery] = useState("")
  const [lessonTypeFilter, setLessonTypeFilter] = useState<"all" | "mistake" | "reinforcement">("all")
  const [horizonFilter, setHorizonFilter] = useState<"all" | "1h" | "1d" | "5d">("all")
  const [verdictFilter, setVerdictFilter] = useState<"all" | "correct" | "partially_correct" | "wrong">("all")
  const [themeFilter, setThemeFilter] = useState<string>("all")
  const [failureTagFilter, setFailureTagFilter] = useState<string>("all")
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadLibrary = useCallback(async () => {
    const [packsData, lessonsData, explorerData, connectionData, reviewData] = await Promise.all([
      getLibraryPacks(),
      getLessons(),
      getLessonExplorer(80),
      getMemoryConnections(12),
      getObsidianImportCandidates(),
    ])

    setPacksResponse(packsData)
    setLessons(lessonsData.slice(0, 6))
    setExplorerItems(explorerData)
    setMemoryConnections(connectionData)
    setImportReview(reviewData)
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true

    async function loadInitialLibrary() {
      const [packsData, lessonsData, explorerData, connectionData, reviewData] = await Promise.all([
        getLibraryPacks(),
        getLessons(),
        getLessonExplorer(80),
        getMemoryConnections(12),
        getObsidianImportCandidates(),
      ])

      if (!active) return

      setPacksResponse(packsData)
      setLessons(lessonsData.slice(0, 6))
      setExplorerItems(explorerData)
      setMemoryConnections(connectionData)
      setImportReview(reviewData)
      setLoading(false)
    }

    void loadInitialLibrary()

    return () => {
      active = false
    }
  }, [])

  const statsByPack = Object.fromEntries((packsResponse?.packs ?? []).map((pack) => [pack.case_pack, pack]))
  const totalCases = packsResponse?.total_cases ?? 0
  const seededPacks = (packsResponse?.packs ?? []).filter((pack) => pack.case_count > 0).length
  const topThemes = useMemo(
    () =>
      [...new Set(explorerItems.flatMap((item) => item.themes))]
        .sort((left, right) => left.localeCompare(right))
        .slice(0, 10),
    [explorerItems],
  )
  const topFailureTags = useMemo(
    () =>
      [...new Set(explorerItems.flatMap((item) => item.failure_tags))]
        .sort((left, right) => left.localeCompare(right))
        .slice(0, 8),
    [explorerItems],
  )
  const filteredExplorerItems = useMemo(() => {
    const trimmed = explorerQuery.trim().toLowerCase()

    return explorerItems.filter((item) => {
      const matchesQuery =
        trimmed.length === 0
          ? true
          : `${item.lesson_summary} ${item.event_summary} ${item.themes.join(" ")} ${item.failure_tags.join(" ")}`.toLowerCase().includes(trimmed)
      const matchesLessonType = lessonTypeFilter === "all" ? true : item.lesson_type === lessonTypeFilter
      const matchesHorizon = horizonFilter === "all" ? true : item.horizon === horizonFilter
      const matchesVerdict = verdictFilter === "all" ? true : item.verdict === verdictFilter
      const matchesTheme = themeFilter === "all" ? true : item.themes.includes(themeFilter)
      const matchesFailureTag = failureTagFilter === "all" ? true : item.failure_tags.includes(failureTagFilter)

      return matchesQuery && matchesLessonType && matchesHorizon && matchesVerdict && matchesTheme && matchesFailureTag
    })
  }, [explorerItems, explorerQuery, failureTagFilter, horizonFilter, lessonTypeFilter, themeFilter, verdictFilter])
  const completedTrails = useMemo(
    () => investigationTrails.filter((trail) => getTrailStatus(trail) === "reviewed").slice(0, 3),
    [investigationTrails],
  )
  const decisionBriefByPredictionId = useMemo(
    () => new Map(decisionBriefs.map((brief) => [brief.lead_prediction_id, brief])),
    [decisionBriefs],
  )
  const decisionBriefByInvestigationId = useMemo(
    () => new Map(decisionBriefs.map((brief) => [brief.investigation_id, brief])),
    [decisionBriefs],
  )
  const portfolioCandidateByDecisionBriefId = useMemo(
    () => buildLatestPortfolioCandidateByDecisionBriefId(portfolioCandidates),
    [portfolioCandidates],
  )
  const portfolioCandidateByPredictionId = useMemo(
    () =>
      new Map(
        decisionBriefs.flatMap((brief) => {
          const candidate = portfolioCandidateByDecisionBriefId.get(brief.id)
          return candidate ? [[brief.lead_prediction_id, candidate] as const] : []
        }),
      ),
    [decisionBriefs, portfolioCandidateByDecisionBriefId],
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
  const focusedTrailId = searchParams.get("trail")
  const focusedTrail = focusedTrailId
    ? investigationTrails.find((trail) => trail.id === focusedTrailId) ?? null
    : null
  const focusedDecisionBrief = focusedTrail ? decisionBriefByInvestigationId.get(focusedTrail.id) ?? null : null
  const focusedPortfolioCandidate = focusedDecisionBrief
    ? portfolioCandidateByDecisionBriefId.get(focusedDecisionBrief.id) ?? null
    : null
  const closedPortfolioCandidates = useMemo(
    () => portfolioCandidates.filter((candidate) => candidate.status === "closed").slice(0, 3),
    [portfolioCandidates],
  )

  useEffect(() => {
    if (!focusedTrail) {
      return
    }

    recordInvestigationStep({
      trailId: focusedTrail.id,
      title: focusedTrail.title,
      eventId: focusedTrail.eventId,
      predictionId: focusedTrail.predictionIds[0] ?? null,
      href: `/library?trail=${focusedTrail.id}`,
      detail: "Library retrieval opened to compare the reviewed investigation against stored lessons and analog memory.",
      updatedAt: new Date().toISOString(),
      kind: "library_lookup",
      status: getTrailStatus(focusedTrail),
    })
    rememberRecentItem({
      id: `library-trail:${focusedTrail.id}`,
      kind: "prediction",
      href: `/library?trail=${focusedTrail.id}`,
      title: focusedTrail.title,
      description: "Library retrieval reopened for a focused reviewed investigation.",
      updatedAt: new Date().toISOString(),
    })
  }, [focusedTrail, recordInvestigationStep, rememberRecentItem])

  const runSearch = async () => {
    const trimmed = query.trim()

    if (!trimmed) {
      setSearchResults([])
      return
    }

    setSearching(true)
    const results = await searchLessons(trimmed)
    setSearchResults(results)
    setSearching(false)
  }

  return (
    <AppShell
      title="Library"
      subtitle="Use the retrieval desk to inspect historical case memory, closed operating outcomes, and the lesson base that grounds future decisions."
    >
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">Historical retrieval memory</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Every prediction is grounded in this shared case memory: real events, reviewed outcomes, closed operating loops, and the pack structure
            used by retrieval, replay, and benchmark context.
          </p>
        </div>

        {loading ? (
          <RouteLoadingState
            title="Loading library explorer"
            description="Passive lesson, pack, and retrieval summaries are being loaded."
          />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                <p className="text-xs tracking-widest text-zinc-500">TOTAL CASES</p>
                <p className="mt-3 text-3xl font-semibold text-white">{totalCases}</p>
                <p className="mt-2 text-xs text-zinc-600">Across all domain packs</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                <p className="text-xs tracking-widest text-zinc-500">DOMAIN PACKS</p>
                <p className="mt-3 text-3xl font-semibold text-emerald-400">{PACK_META.length}</p>
                <p className="mt-2 text-xs text-zinc-600">
                  {seededPacks} seeded | {PACK_META.length - seededPacks} pending
                </p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                <p className="text-xs tracking-widest text-zinc-500">CONNECTION LEADS</p>
                <p className="mt-3 text-3xl font-semibold text-cyan-300">{memoryConnections.length}</p>
                <p className="mt-2 text-xs text-zinc-600">Repeated assets and themes ready for human review</p>
              </div>
            </div>

            <ImportedHumanMemoryCard lessons={lessons} />
            <ObsidianImportReviewQueue review={importReview} onRefresh={loadLibrary} />
            <ConnectionReviewPanel connections={memoryConnections} />

            <div>
              <p className="mb-4 text-xs tracking-widest text-zinc-500">ALL DOMAIN PACKS</p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {PACK_META.map((meta) => (
                  <PackCard key={meta.pack_id} meta={meta} stat={statsByPack[meta.pack_id]} />
                ))}
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5 xl:col-span-2">
                {!focusedTrail ? (
                  <RouteEmptyState
                    title="No focused investigation trail"
                    description="Open Library from a reviewed prediction or a command-center trail to keep retrieval tied to a specific investigation."
                  />
                ) : (
                  <div className="space-y-4">
                    <InvestigationTrailSummary
                      trail={focusedTrail}
                      label="Focused investigation"
                      status={<InvestigationStatusBadge status={getTrailStatus(focusedTrail)} />}
                      actions={<InvestigationTrailActions trail={focusedTrail} />}
                      summary={
                        <div className="space-y-2">
                          <p>{getInvestigationStatusSummary(getTrailStatus(focusedTrail))}</p>
                          <p className="text-xs text-zinc-500">{getTrailNextStep(focusedTrail)}</p>
                        </div>
                      }
                    />
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Decision follow-through</p>
                      <p className="mt-2 text-sm text-zinc-400">
                        {focusedDecisionBrief ? decisionOutcomeCopy(focusedDecisionBrief.status) : "This investigation is still research-only. Retrieval can stay focused on lessons and analog memory until the team promotes it into a shared decision brief."}
                      </p>
                      <div className="mt-3">
                        <DecisionContextRow
                          briefId={focusedDecisionBrief?.id ?? null}
                          briefStatus={focusedDecisionBrief?.status ?? null}
                          emptyLabel="No decision brief linked yet"
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
                          emptyLabel="No portfolio candidate linked yet"
                        />
                      </div>
                    </div>
                    <InvestigationTrailSteps steps={focusedTrail.steps} limit={3} />
                  </div>
                )}
              </section>

              <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5 xl:col-span-2">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs tracking-widest text-zinc-500">LESSON EXPLORER</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Browse recent lessons by theme, verdict, horizon, and failure pattern without needing a specific search phrase.
                    </p>
                  </div>
                  <input
                    value={explorerQuery}
                    onChange={(event) => setExplorerQuery(event.target.value)}
                    placeholder="Filter by lesson, event summary, theme, or failure pattern..."
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none lg:max-w-md"
                  />
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-zinc-500">Lesson type</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: "all", label: "All" },
                        { id: "mistake", label: "Mistakes" },
                        { id: "reinforcement", label: "Reinforcements" },
                      ].map((option) => (
                        <ExplorerFilterChip
                          key={option.id}
                          active={lessonTypeFilter === option.id}
                          label={option.label}
                          onClick={() => setLessonTypeFilter(option.id as typeof lessonTypeFilter)}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-zinc-500">Horizon and verdict</p>
                    <div className="flex flex-wrap gap-2">
                      {["all", "1h", "1d", "5d"].map((option) => (
                        <ExplorerFilterChip
                          key={option}
                          active={horizonFilter === option}
                          label={option === "all" ? "All horizons" : option}
                          onClick={() => setHorizonFilter(option as typeof horizonFilter)}
                        />
                      ))}
                      {["all", "correct", "partially_correct", "wrong"].map((option) => (
                        <ExplorerFilterChip
                          key={option}
                          active={verdictFilter === option}
                          label={option === "all" ? "All verdicts" : option.replace(/_/g, " ")}
                          onClick={() => setVerdictFilter(option as typeof verdictFilter)}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-zinc-500">Themes</p>
                    <div className="flex flex-wrap gap-2">
                      <ExplorerFilterChip active={themeFilter === "all"} label="All themes" onClick={() => setThemeFilter("all")} />
                      {topThemes.map((theme) => (
                        <ExplorerFilterChip
                          key={theme}
                          active={themeFilter === theme}
                          label={theme}
                          onClick={() => setThemeFilter(theme)}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-zinc-500">Failure patterns</p>
                    <div className="flex flex-wrap gap-2">
                      <ExplorerFilterChip
                        active={failureTagFilter === "all"}
                        label="All patterns"
                        onClick={() => setFailureTagFilter("all")}
                      />
                      {topFailureTags.map((tag) => (
                        <ExplorerFilterChip
                          key={tag}
                          active={failureTagFilter === tag}
                          label={tag.replace(/_/g, " ")}
                          onClick={() => setFailureTagFilter(tag)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {filteredExplorerItems.length ? (
                    filteredExplorerItems.slice(0, 10).map((item) => (
                      <ExplorerResultCard
                        key={item.lesson_id}
                        item={item}
                        decisionBriefId={decisionBriefByPredictionId.get(item.prediction_id)?.id ?? null}
                        decisionStatus={decisionBriefByPredictionId.get(item.prediction_id)?.status ?? null}
                        portfolioCandidateId={portfolioCandidateByPredictionId.get(item.prediction_id)?.id ?? null}
                        portfolioStatus={portfolioCandidateByPredictionId.get(item.prediction_id)?.status ?? null}
                      />
                    ))
                  ) : (
                    <RouteEmptyState
                      title="No lessons match these filters"
                      description="Adjust the current explorer query, theme, verdict, or failure-pattern filters to widen the retrieval desk."
                    />
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs tracking-widest text-zinc-500">COMPLETED INVESTIGATIONS</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Reviewed trails are the best starting point for memory retrieval, analog lookup, and lesson comparison.
                    </p>
                  </div>
                  <Link
                    href="/workspace"
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Open command center
                  </Link>
                </div>
                <div className="mt-4 space-y-3">
                  {completedTrails.length ? (
                    completedTrails.map((trail) => (
                      <div key={trail.id} className="space-y-3">
                        <InvestigationTrailSummary
                          trail={trail}
                          label="Completed investigation"
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
                              emptyLabel="Completed research without a linked brief"
                            />
                          </div>
                          <div className="mt-3">
                            <PortfolioContextRow
                              candidateId={portfolioCandidateByInvestigationId.get(trail.id)?.id ?? null}
                              candidateStatus={portfolioCandidateByInvestigationId.get(trail.id)?.status ?? null}
                              emptyLabel="No portfolio candidate linked yet"
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <RouteEmptyState
                      title="No reviewed investigations yet"
                      description="Once predictions complete the full review loop, their trails will appear here as the best retrieval candidates."
                    />
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs tracking-widest text-zinc-500">CLOSED OPERATING OUTCOMES</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Retrieval can use these completed operating outcomes as closure memory rather than treating them like still-live theses.
                    </p>
                  </div>
                  <Link
                    href="/decisions"
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Open decision desk
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
                        <div key={candidate.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">{candidate.title}</p>
                              <p className="mt-2 text-xs text-zinc-500">
                                {trail ? getTrailNextStep(trail) : "Closed directly from the portfolio layer and ready for retrospective retrieval."}
                              </p>
                            </div>
                            <PortfolioContextRow candidateId={candidate.id} candidateStatus={candidate.status} />
                          </div>
                          <p className="mt-3 text-sm text-zinc-400">
                            {getPortfolioCandidateContextCopy(candidate.status)}
                          </p>
                          <ClosedPortfolioOutcomeSummary candidate={candidate} detail={portfolioClosureSummary} />
                          <div className="mt-3">
                            <DecisionContextRow
                              briefId={brief?.id ?? null}
                              briefStatus={brief?.status ?? null}
                              emptyLabel="No decision brief linked"
                            />
                          </div>
                          <ClosedDecisionOutcomeSummary detail={closureSummary} />
                        </div>
                      )
                    })
                  ) : (
                    <RouteEmptyState
                      title="No closed portfolio outcomes yet"
                      description="Closed portfolio candidates will appear here once the team starts finishing the operating loop through to closure."
                    />
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs tracking-widest text-zinc-500">RECENT LESSONS</p>
                    <p className="mt-1 text-sm text-zinc-500">What the system has recently reinforced or corrected.</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {lessons.length ? (
                    lessons.map((lesson) => (
                      <div key={lesson.id} className="space-y-2">
                        <LessonCard
                          lesson={lesson}
                          decisionBriefId={decisionBriefByPredictionId.get(lesson.prediction_id)?.id ?? null}
                          decisionStatus={decisionBriefByPredictionId.get(lesson.prediction_id)?.status ?? null}
                          portfolioCandidateId={portfolioCandidateByPredictionId.get(lesson.prediction_id)?.id ?? null}
                          portfolioStatus={portfolioCandidateByPredictionId.get(lesson.prediction_id)?.status ?? null}
                        />
                        <p className="text-xs text-zinc-500">
                          {getPortfolioCandidateContextCopy(portfolioCandidateByPredictionId.get(lesson.prediction_id)?.status ?? null)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <RouteEmptyState
                      title="No recent lessons yet"
                      description="Lessons will appear here as predictions are scored and reviewed."
                    />
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                <div>
                  <p className="text-xs tracking-widest text-zinc-500">LESSON SEARCH</p>
                  <p className="mt-1 text-sm text-zinc-500">Search prior lessons by theme, event pattern, or failure mode.</p>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by CPI, bank stress, overconfidence, oil shock..."
                    className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void runSearch()}
                    disabled={searching}
                    className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
                  >
                    {searching ? "Searching..." : "Search"}
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {query.trim().length === 0 ? (
                    <RouteEmptyState
                      title="Search the lesson memory"
                      description="Run a search to surface the most relevant lessons and linked prediction details."
                    />
                  ) : searchResults.length ? (
                    searchResults.map((result) => (
                      <SearchResultCard
                        key={result.lesson_id}
                        result={result}
                        decisionBriefId={decisionBriefByPredictionId.get(result.prediction_id)?.id ?? null}
                        decisionStatus={decisionBriefByPredictionId.get(result.prediction_id)?.status ?? null}
                        portfolioCandidateId={portfolioCandidateByPredictionId.get(result.prediction_id)?.id ?? null}
                        portfolioStatus={portfolioCandidateByPredictionId.get(result.prediction_id)?.status ?? null}
                      />
                    ))
                  ) : (
                    <RouteEmptyState
                      title="No lessons matched that query"
                      description="Try a broader theme, catalyst, failure mode, or event phrase."
                    />
                  )}
                </div>
              </section>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
              <p className="mb-3 text-xs tracking-widest text-zinc-500">HOW RETRIEVAL WORKS</p>
              <div className="grid gap-4 text-xs text-zinc-500 md:grid-cols-3">
                <div>
                  <p className="mb-1 font-medium text-zinc-300">1. Semantic embedding</p>
                  <p>Every reviewed case is embedded and indexed so the engine can search by meaning rather than only by tags.</p>
                </div>
                <div>
                  <p className="mb-1 font-medium text-zinc-300">2. Cross-pack similarity</p>
                  <p>The best analogues can come from any pack when the market structure matches the current event.</p>
                </div>
                <div>
                  <p className="mb-1 font-medium text-zinc-300">3. Grounded analysis</p>
                  <p>The brain cites realized outcomes, dominant catalysts, and learned lessons when building its answer.</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <AppShell
          title="Library"
          subtitle="Browse the historical memory packs that ground retrieval, replay, and cross-asset analog reasoning."
        >
          <RouteLoadingState
            title="Loading library desk"
            description="Restoring lesson retrieval, pack coverage, and focused investigation context."
          />
        </AppShell>
      }
    >
      <LibraryWorkspacePage />
    </Suspense>
  )
}
