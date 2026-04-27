"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import type {
  PortfolioRebalanceAction,
  PortfolioRebalanceProposalStatus,
  PortfolioReviewSessionDetailResponse,
  PortfolioReviewSessionStatus,
} from "@finance-superbrain/schemas"

import { AppShell } from "@/components/AppShell"
import { PortfolioStatusBadge } from "@/components/PortfolioStatusBadge"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import {
  getPortfolioReviewSessionDetail,
  savePortfolioRebalanceProposal,
  updatePortfolioReviewSession,
  updatePortfolioReviewSessionStatus,
} from "@/lib/portfolioApi"
import { formatPortfolioDateTime, formatPortfolioRelativeReviewState } from "@/lib/portfolioDesk"

type ProposalDraft = {
  proposal_id?: string
  action: PortfolioRebalanceAction
  status: PortfolioRebalanceProposalStatus
  rationale: string
  dependency_note: string
  next_review_expectation: string
}

function sessionStatusClasses(status: PortfolioReviewSessionStatus) {
  switch (status) {
    case "finalized":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
    case "in_review":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-100"
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-100"
  }
}

function buildDraft(existing?: {
  id: string
  action: PortfolioRebalanceAction
  status: PortfolioRebalanceProposalStatus
  rationale: string
  dependency_note: string | null
  next_review_expectation: string | null
}): ProposalDraft {
  return {
    proposal_id: existing?.id,
    action: existing?.action ?? "keep_current",
    status: existing?.status ?? "proposed",
    rationale: existing?.rationale ?? "",
    dependency_note: existing?.dependency_note ?? "",
    next_review_expectation: existing?.next_review_expectation ?? "",
  }
}

export default function PortfolioReviewSessionDetailPage() {
  const params = useParams<{ reviewSessionId: string }>()
  const reviewSessionId = params?.reviewSessionId
  const { members, portfolioCandidates } = useWorkspace()
  const [detail, setDetail] = useState<PortfolioReviewSessionDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingSession, setSavingSession] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [proposalDrafts, setProposalDrafts] = useState<Record<string, ProposalDraft>>({})
  const [savingProposalForCandidateId, setSavingProposalForCandidateId] = useState<string | null>(null)
  const [nowTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let active = true

    if (!reviewSessionId) {
      return
    }

    void getPortfolioReviewSessionDetail(reviewSessionId)
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
  }, [reviewSessionId])

  useEffect(() => {
    if (!detail) {
      return
    }

    setTitle(detail.session.title)
    setSummary(detail.session.summary)

    const latestByCandidateId = new Map<string, (typeof detail.proposals)[number]>()

    for (const proposal of detail.proposals) {
      const current = latestByCandidateId.get(proposal.portfolio_candidate_id)

      if (!current || Date.parse(proposal.updated_at) > Date.parse(current.updated_at)) {
        latestByCandidateId.set(proposal.portfolio_candidate_id, proposal)
      }
    }

    setProposalDrafts(
      detail.items.reduce<Record<string, ProposalDraft>>((map, item) => {
        map[item.portfolio_candidate_id] = buildDraft(latestByCandidateId.get(item.portfolio_candidate_id))
        return map
      }, {}),
    )
  }, [detail])

  const memberNameMap = useMemo(
    () => new Map(members.map((entry) => [entry.user.id, entry.user.display_name])),
    [members],
  )
  const currentCandidateById = useMemo(
    () => new Map(portfolioCandidates.map((candidate) => [candidate.id, candidate])),
    [portfolioCandidates],
  )
  const proposalByCandidateId = useMemo(() => {
    type ProposalEntry = NonNullable<PortfolioReviewSessionDetailResponse>["proposals"][number]
    const map = new Map<string, ProposalEntry>()

    for (const proposal of detail?.proposals ?? []) {
      const current = map.get(proposal.portfolio_candidate_id)

      if (!current || Date.parse(proposal.updated_at) > Date.parse(current.updated_at)) {
        map.set(proposal.portfolio_candidate_id, proposal)
      }
    }

    return map
  }, [detail?.proposals])

  const refreshDetail = async (id: string) => {
    const nextDetail = await getPortfolioReviewSessionDetail(id)
    setDetail(nextDetail)
  }

  const handleSaveSession = async () => {
    if (!detail) {
      return
    }

    setSavingSession(true)
    setMessage(null)

    try {
      await updatePortfolioReviewSession(detail.session.id, {
        title: title.trim() || undefined,
        summary: summary.trim() || undefined,
      })
      await refreshDetail(detail.session.id)
      setMessage("Portfolio review session updated.")
    } finally {
      setSavingSession(false)
    }
  }

  const handleSessionStatus = async (status: PortfolioReviewSessionStatus) => {
    if (!detail) {
      return
    }

    setSavingSession(true)
    setMessage(null)

    try {
      await updatePortfolioReviewSessionStatus(detail.session.id, {
        status,
        summary: summary.trim() || undefined,
      })
      await refreshDetail(detail.session.id)
      setMessage(status === "finalized" ? "Portfolio review session finalized." : "Portfolio review session updated.")
    } finally {
      setSavingSession(false)
    }
  }

  const handleDraftChange = (candidateId: string, patch: Partial<ProposalDraft>) => {
    setProposalDrafts((current) => ({
      ...current,
      [candidateId]: {
        ...current[candidateId],
        ...patch,
      },
    }))
  }

  const handleSaveProposal = async (candidateId: string) => {
    if (!detail) {
      return
    }

    const draft = proposalDrafts[candidateId]

    if (!draft?.rationale.trim()) {
      return
    }

    setSavingProposalForCandidateId(candidateId)
    setMessage(null)

    try {
      await savePortfolioRebalanceProposal(detail.session.id, {
        proposal_id: draft.proposal_id,
        portfolio_candidate_id: candidateId,
        action: draft.action,
        status: draft.status,
        rationale: draft.rationale.trim(),
        dependency_note: draft.dependency_note.trim() || null,
        next_review_expectation: draft.next_review_expectation.trim() || null,
      })
      await refreshDetail(detail.session.id)
      setMessage("Portfolio rebalance proposal saved.")
    } finally {
      setSavingProposalForCandidateId(null)
    }
  }

  return (
    <AppShell
      eyebrow="Phase 9 review layer"
      title="Portfolio review session"
      subtitle="Capture portfolio-wide judgment in one durable workspace so proposals, approvals, and final review rationale survive beyond a single desk visit."
    >
      {loading ? (
        <RouteLoadingState
          title="Loading portfolio review session"
          description="Restoring the review snapshot, proposal drafts, and finalized decisions from the shared workspace."
        />
      ) : !detail ? (
        <RouteEmptyState
          title="Portfolio review session not found"
          description="This review session could not be restored from the shared workspace."
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
                <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Review session</p>
                <h1 className="mt-2 font-display text-3xl font-semibold text-white">{detail.session.title}</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-300">{detail.session.summary}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${sessionStatusClasses(detail.session.status)}`}>
                {detail.session.status.replace(/_/g, " ")}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/portfolio/reviews"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Review index
              </Link>
              <Link
                href="/portfolio"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Portfolio desk
              </Link>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Session controls</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">Review framing</h2>
              <label className="mt-4 block space-y-2 text-sm text-zinc-300">
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={detail.session.status === "finalized"}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <label className="mt-4 block space-y-2 text-sm text-zinc-300">
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Summary</span>
                <textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  rows={5}
                  disabled={detail.session.status === "finalized"}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveSession()}
                  disabled={savingSession || detail.session.status === "finalized"}
                  className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-500/60"
                >
                  Save review framing
                </button>
                {detail.session.status !== "in_review" && detail.session.status !== "finalized" ? (
                  <button
                    type="button"
                    onClick={() => void handleSessionStatus("in_review")}
                    disabled={savingSession}
                    className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/40"
                  >
                    Move to in review
                  </button>
                ) : null}
                {detail.session.status !== "finalized" ? (
                  <button
                    type="button"
                    onClick={() => void handleSessionStatus("finalized")}
                    disabled={savingSession}
                    className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-400/40"
                  >
                    Finalize review
                  </button>
                ) : null}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Review pressure</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">Snapshot summary</h2>
              <div className="mt-4 space-y-3 text-sm text-zinc-300">
                <p>{detail.items.length} candidates were pulled into this review snapshot.</p>
                <p>{detail.proposals.length} rebalance proposals have been saved so far.</p>
                <p>
                  {detail.proposals.filter((proposal) => proposal.status === "approved").length} proposals are approved and{" "}
                  {detail.proposals.filter((proposal) => proposal.status === "proposed").length} are still unresolved.
                </p>
                <p>
                  Opened {new Date(detail.session.opened_at).toLocaleString()}
                  {detail.session.finalized_at ? ` | Finalized ${new Date(detail.session.finalized_at).toLocaleString()}` : ""}
                </p>
              </div>
            </section>
          </div>

          <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Review candidates</p>
            <h2 className="mt-2 font-display text-lg font-semibold text-white">Portfolio-wide proposal workspace</h2>

            <div className="mt-4 space-y-4">
              {detail.items.length ? (
                detail.items.map((item) => {
                  const currentCandidate = currentCandidateById.get(item.portfolio_candidate_id) ?? null
                  const latestProposal = proposalByCandidateId.get(item.portfolio_candidate_id) ?? null
                  const draft = proposalDrafts[item.portfolio_candidate_id] ?? buildDraft(undefined)

                  return (
                    <div key={item.id} className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-white">{currentCandidate?.title ?? item.portfolio_candidate_id}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.24em] text-zinc-500">
                            Snapshot {item.snapshot_status} | {item.snapshot_priority} priority | {item.snapshot_primary_theme}
                          </p>
                          <p className="mt-2 text-sm text-zinc-400">
                            Assignee {item.snapshot_assignee_user_id ? memberNameMap.get(item.snapshot_assignee_user_id) ?? "Unknown teammate" : "Unassigned"}
                          </p>
                          <p className="mt-1 text-sm text-zinc-400">
                            {item.snapshot_next_review_due_at
                              ? formatPortfolioRelativeReviewState(item.snapshot_next_review_due_at, nowTimestamp)
                              : "No review cadence in the snapshot"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {currentCandidate ? <PortfolioStatusBadge status={currentCandidate.status} /> : null}
                          {currentCandidate ? (
                            <Link
                              href={`/portfolio/${currentCandidate.id}`}
                              className="rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                            >
                              Open candidate
                            </Link>
                          ) : null}
                        </div>
                      </div>

                      {latestProposal ? (
                        <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Latest saved proposal</p>
                          <p className="mt-2 text-sm text-zinc-300">
                            {latestProposal.action.replace(/_/g, " ")} | {latestProposal.status}
                          </p>
                          <p className="mt-2 text-sm text-zinc-400">{latestProposal.rationale}</p>
                          <p className="mt-2 text-xs text-zinc-500">
                            Updated {new Date(latestProposal.updated_at).toLocaleString()}
                            {latestProposal.decided_at ? ` | Decided ${new Date(latestProposal.decided_at).toLocaleString()}` : ""}
                          </p>
                        </div>
                      ) : null}

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="space-y-2 text-sm text-zinc-300">
                          <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Proposed action</span>
                          <select
                            value={draft.action}
                            onChange={(event) =>
                              handleDraftChange(item.portfolio_candidate_id, {
                                action: event.target.value as PortfolioRebalanceAction,
                              })
                            }
                            disabled={detail.session.status === "finalized"}
                            className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="keep_current">Keep current posture</option>
                            <option value="increase_attention">Increase attention</option>
                            <option value="move_to_watching">Move to watching</option>
                            <option value="trim">Trim</option>
                            <option value="close">Close</option>
                            <option value="defer">Defer for later</option>
                          </select>
                        </label>

                        <label className="space-y-2 text-sm text-zinc-300">
                          <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Proposal status</span>
                          <select
                            value={draft.status}
                            onChange={(event) =>
                              handleDraftChange(item.portfolio_candidate_id, {
                                status: event.target.value as PortfolioRebalanceProposalStatus,
                              })
                            }
                            disabled={detail.session.status === "finalized"}
                            className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="proposed">Proposed</option>
                            <option value="approved">Approved</option>
                            <option value="deferred">Deferred</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </label>
                      </div>

                      <label className="mt-4 block space-y-2 text-sm text-zinc-300">
                        <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Rationale</span>
                        <textarea
                          value={draft.rationale}
                          onChange={(event) =>
                            handleDraftChange(item.portfolio_candidate_id, {
                              rationale: event.target.value,
                            })
                          }
                          rows={4}
                          disabled={detail.session.status === "finalized"}
                          className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder="Why should this thesis change, stay put, or be deferred in this review cycle?"
                        />
                      </label>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="space-y-2 text-sm text-zinc-300">
                          <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Dependency note</span>
                          <input
                            value={draft.dependency_note}
                            onChange={(event) =>
                              handleDraftChange(item.portfolio_candidate_id, {
                                dependency_note: event.target.value,
                              })
                            }
                            disabled={detail.session.status === "finalized"}
                            className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                            placeholder="Optional blocker or dependency"
                          />
                        </label>

                        <label className="space-y-2 text-sm text-zinc-300">
                          <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Next review expectation</span>
                          <input
                            value={draft.next_review_expectation}
                            onChange={(event) =>
                              handleDraftChange(item.portfolio_candidate_id, {
                                next_review_expectation: event.target.value,
                              })
                            }
                            disabled={detail.session.status === "finalized"}
                            className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                            placeholder="Optional next review expectation"
                          />
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-zinc-500">
                          Snapshot review date {formatPortfolioDateTime(item.snapshot_next_review_due_at)}
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleSaveProposal(item.portfolio_candidate_id)}
                          disabled={detail.session.status === "finalized" || savingProposalForCandidateId === item.portfolio_candidate_id || !draft.rationale.trim()}
                          className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-500/60"
                        >
                          {savingProposalForCandidateId === item.portfolio_candidate_id ? "Saving proposal..." : "Save proposal"}
                        </button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <RouteEmptyState
                  title="No candidates in this review snapshot"
                  description="The session did not capture any portfolio candidates."
                />
              )}
            </div>
          </section>
        </div>
      )}
    </AppShell>
  )
}
