"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import type { ListPortfolioReviewSessionsResponse } from "@finance-superbrain/schemas"

import { AppShell } from "@/components/AppShell"
import { RouteEmptyState, RouteLoadingState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import { createPortfolioReviewSession, listPortfolioReviewSessions } from "@/lib/portfolioApi"

function statusClasses(status: string) {
  switch (status) {
    case "finalized":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
    case "in_review":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-100"
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-100"
  }
}

export default function PortfolioReviewSessionsPage() {
  const router = useRouter()
  const { portfolioCandidates } = useWorkspace()
  const [data, setData] = useState<ListPortfolioReviewSessionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void listPortfolioReviewSessions()
      .then((nextData) => {
        if (active) {
          setData(nextData)
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
  }, [])

  const openCandidateCount = useMemo(
    () => portfolioCandidates.filter((candidate) => candidate.status !== "closed").length,
    [portfolioCandidates],
  )

  const handleCreate = async () => {
    setCreating(true)
    setMessage(null)

    try {
      const detail = await createPortfolioReviewSession({
        title: title.trim() || undefined,
        summary: summary.trim() || undefined,
      })
      router.push(`/portfolio/reviews/${detail.session.id}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create the review session.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <AppShell
      eyebrow="Phase 9 review layer"
      title="Portfolio reviews"
      subtitle="Run durable portfolio review sessions so the team can capture rebalance proposals, rationale, and final decisions across the live thesis set."
    >
      {loading ? (
        <RouteLoadingState
          title="Loading portfolio reviews"
          description="Restoring saved review sessions and proposal history from the shared workspace."
        />
      ) : (
        <div className="space-y-6">
          {message ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {message}
            </div>
          ) : null}

          <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
              <div>
                <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Review session launcher</p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-white">Start a fresh portfolio review</h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">
                  A review session snapshots the current open portfolio set, gives the team one place to save rebalance proposals,
                  and preserves why the portfolio changed.
                </p>
                <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-400">
                  <span>{openCandidateCount} open candidates available to review</span>
                  <span>|</span>
                  <Link href="/portfolio" className="text-cyan-200 transition-colors hover:text-white">
                    Back to portfolio desk
                  </Link>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                <label className="block space-y-2 text-sm text-zinc-300">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Title</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Optional custom review title"
                    className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40"
                  />
                </label>
                <label className="mt-4 block space-y-2 text-sm text-zinc-300">
                  <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Review summary</span>
                  <textarea
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    rows={5}
                    placeholder="Optional operator framing for this review cycle"
                    className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={creating || openCandidateCount === 0}
                  className="mt-4 w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-500/60"
                >
                  {creating ? "Starting review..." : "Start portfolio review"}
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Saved sessions</p>
            <h2 className="mt-2 font-display text-xl font-semibold text-white">Recent portfolio review history</h2>
            <div className="mt-4 space-y-4">
              {data?.sessions.length ? (
                data.sessions.map((entry) => (
                  <div key={entry.session.id} className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-white">{entry.session.title}</p>
                        <p className="mt-2 max-w-3xl text-sm text-zinc-400">{entry.session.summary}</p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${statusClasses(entry.session.status)}`}>
                        {entry.session.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-4 text-xs uppercase tracking-[0.24em] text-zinc-500">
                      <span>{entry.item_count} candidates</span>
                      <span>{entry.proposal_count} proposals</span>
                      <span>{entry.approved_count} approved</span>
                      <span>{entry.unresolved_count} unresolved</span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={`/portfolio/reviews/${entry.session.id}`}
                        className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100 transition-colors hover:border-cyan-400/40 hover:text-cyan-50"
                      >
                        Open review session
                      </Link>
                      <Link
                        href="/portfolio"
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                      >
                        Open portfolio desk
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <RouteEmptyState
                  title="No portfolio reviews yet"
                  description="The first review session will appear here once the team snapshots the current portfolio and starts saving proposals."
                />
              )}
            </div>
          </section>
        </div>
      )}
    </AppShell>
  )
}
