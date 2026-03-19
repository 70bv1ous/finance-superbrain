"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  getAccuracyStats, getRecentPredictions, markOutcome,
  type AccuracyStats, type PredictionRow
} from "@/lib/chatApi"
import { EventTypeBadge } from "@/components/EventTypeBadge"
import { ConfidenceBadge } from "@/components/ConfidenceBadge"
import { MarketTickerBar } from "@/components/MarketTickerBar"
import { EventsStrip } from "@/components/EventsStrip"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function OutcomePill({ outcome }: { outcome: PredictionRow["outcome"] }) {
  if (!outcome) return <span className="text-zinc-600 text-xs">unscored</span>
  const cfg = {
    correct:   "bg-emerald-950 text-emerald-400 border border-emerald-800",
    incorrect: "bg-red-950 text-red-400 border border-red-800",
    partial:   "bg-amber-950 text-amber-400 border border-amber-800",
  }[outcome]
  const label = { correct: "✓ Correct", incorrect: "✗ Incorrect", partial: "~ Partial" }[outcome]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${cfg}`}>{label}</span>
}

function BarChart({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-zinc-300 w-8 text-right">{pct}%</span>
    </div>
  )
}

const EVENT_COLOR: Record<string, string> = {
  cpi: "bg-blue-500", fomc: "bg-purple-500", nfp: "bg-orange-500",
  earnings: "bg-cyan-500", energy: "bg-yellow-500", credit: "bg-rose-500",
  policy_fx: "bg-indigo-500", general: "bg-zinc-500",
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  if (m > 0) return `${m}m ago`
  return "just now"
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AccuracyPage() {
  const [stats, setStats]           = useState<AccuracyStats | null>(null)
  const [predictions, setPredictions] = useState<PredictionRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [marking, setMarking]       = useState<string | null>(null)

  const load = async () => {
    const [s, p] = await Promise.all([getAccuracyStats(), getRecentPredictions(30)])
    setStats(s)
    setPredictions(p)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleMark = async (sessionId: string, outcome: "correct" | "incorrect" | "partial") => {
    setMarking(sessionId)
    await markOutcome(sessionId, outcome)
    await load() // refresh
    setMarking(null)
  }

  const unscored  = predictions.filter(p => !p.outcome)
  const scored    = predictions.filter(p =>  p.outcome)

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-black text-sm font-bold">FS</div>
        <div>
          <h1 className="text-zinc-100 font-semibold text-sm">Finance Superbrain</h1>
          <p className="text-zinc-500 text-xs">Prediction Accuracy Dashboard</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">← Back to Chat</Link>
        </div>
      </header>

      <MarketTickerBar />
      <EventsStrip />

      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-5xl mx-auto w-full">

        {loading ? (
          <div className="text-zinc-600 text-sm animate-pulse">Loading accuracy data…</div>
        ) : (
          <>
            {/* ── Stat cards ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-zinc-500 text-xs tracking-widest mb-1">TOTAL PREDICTIONS</p>
                <p className="text-zinc-100 text-3xl font-bold">{stats?.total_logged ?? 0}</p>
                <p className="text-zinc-600 text-xs mt-1">{stats?.total_resolved ?? 0} scored</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-zinc-500 text-xs tracking-widest mb-1">OVERALL ACCURACY</p>
                <p className={`text-3xl font-bold ${(stats?.overall_accuracy_pct ?? 0) >= 60 ? "text-emerald-400" : (stats?.overall_accuracy_pct ?? 0) >= 40 ? "text-amber-400" : "text-red-400"}`}>
                  {stats?.total_resolved ? `${stats.overall_accuracy_pct}%` : "—"}
                </p>
                <p className="text-zinc-600 text-xs mt-1">on scored predictions</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-zinc-500 text-xs tracking-widest mb-1">AWAITING SCORING</p>
                <p className="text-amber-400 text-3xl font-bold">{unscored.length}</p>
                <p className="text-zinc-600 text-xs mt-1">mark below after events</p>
              </div>
            </div>

            {/* ── Breakdown tables ─────────────────────────────────────────── */}
            {stats && stats.total_resolved > 0 && (
              <div className="grid grid-cols-2 gap-4">
                {/* By event type */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <p className="text-zinc-500 text-xs tracking-widest mb-3">BY EVENT TYPE</p>
                  <div className="space-y-2.5">
                    {Object.entries(stats.by_event_type)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([type, v]) => (
                        <div key={type}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-zinc-400 text-xs uppercase tracking-wide">{type.replace("_", "/")}</span>
                            <span className="text-zinc-500 text-xs">{v.correct}/{v.total}</span>
                          </div>
                          <BarChart pct={v.pct} color={EVENT_COLOR[type] ?? "bg-zinc-500"} />
                        </div>
                      ))}
                  </div>
                </div>

                {/* By confidence */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <p className="text-zinc-500 text-xs tracking-widest mb-3">BY CONFIDENCE LEVEL</p>
                  <div className="space-y-2.5">
                    {Object.entries(stats.by_confidence)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([conf, v]) => (
                        <div key={conf}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-zinc-400 text-xs uppercase tracking-wide">{conf}</span>
                            <span className="text-zinc-500 text-xs">{v.correct}/{v.total}</span>
                          </div>
                          <BarChart pct={v.pct} color={conf === "high" ? "bg-emerald-500" : conf === "medium" ? "bg-amber-500" : "bg-red-500"} />
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Unscored predictions (needs marking) ────────────────────── */}
            {unscored.length > 0 && (
              <div>
                <p className="text-zinc-500 text-xs tracking-widest mb-3">AWAITING YOUR VERDICT — mark these after the event plays out</p>
                <div className="space-y-2">
                  {unscored.map(p => (
                    <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <EventTypeBadge type={p.event_type as any} />
                            <ConfidenceBadge level={p.confidence_level as any} />
                            <span className="text-zinc-600 text-xs">{timeAgo(p.created_at)}</span>
                          </div>
                          <p className="text-zinc-300 text-sm mb-1 truncate">{p.query}</p>
                          <p className="text-zinc-600 text-xs line-clamp-2">{p.answer_summary}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {marking === p.session_id ? (
                            <span className="text-zinc-600 text-xs animate-pulse">saving…</span>
                          ) : (
                            <>
                              <button onClick={() => handleMark(p.session_id, "correct")}
                                className="px-2.5 py-1 rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-400 text-xs hover:bg-emerald-900 transition-colors">
                                ✓ Correct
                              </button>
                              <button onClick={() => handleMark(p.session_id, "partial")}
                                className="px-2.5 py-1 rounded-lg bg-amber-950 border border-amber-800 text-amber-400 text-xs hover:bg-amber-900 transition-colors">
                                ~ Partial
                              </button>
                              <button onClick={() => handleMark(p.session_id, "incorrect")}
                                className="px-2.5 py-1 rounded-lg bg-red-950 border border-red-800 text-red-400 text-xs hover:bg-red-900 transition-colors">
                                ✗ Wrong
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Scored predictions history ───────────────────────────────── */}
            {scored.length > 0 && (
              <div>
                <p className="text-zinc-500 text-xs tracking-widest mb-3">SCORED HISTORY</p>
                <div className="space-y-2">
                  {scored.map(p => (
                    <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <EventTypeBadge type={p.event_type as any} />
                            <ConfidenceBadge level={p.confidence_level as any} />
                            <OutcomePill outcome={p.outcome} />
                            <span className="text-zinc-600 text-xs">{timeAgo(p.created_at)}</span>
                          </div>
                          <p className="text-zinc-300 text-sm mb-1 truncate">{p.query}</p>
                          <p className="text-zinc-600 text-xs line-clamp-2">{p.answer_summary}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {predictions.length === 0 && (
              <div className="text-center py-16 text-zinc-600">
                <p className="text-4xl mb-3">📊</p>
                <p className="text-sm">No predictions logged yet.</p>
                <p className="text-xs mt-1">Ask the brain a question to start tracking accuracy.</p>
                <Link href="/" className="mt-4 inline-block text-emerald-500 text-xs hover:text-emerald-400">Go ask something →</Link>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
