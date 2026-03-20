"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { getLibraryPacks, type LibraryPackStat } from "@/lib/chatApi"
import { MarketTickerBar } from "@/components/MarketTickerBar"
import { EventsStrip } from "@/components/EventsStrip"

// ─── Static pack metadata ─────────────────────────────────────────────────────
// Descriptions, icons, and display names for all 12 domain packs.
// These are static — the live case counts come from the API.

type PackMeta = {
  pack_id:     string
  domain:      string
  label:       string
  icon:        string
  color:       string       // Tailwind text-color class
  border:      string       // Tailwind border-color class
  bg:          string       // Tailwind bg-color class
  description: string
}

const PACK_META: PackMeta[] = [
  {
    pack_id:     "macro_calendar_v1",
    domain:      "macro",
    label:       "Macro Calendar",
    icon:        "📈",
    color:       "text-blue-400",
    border:      "border-blue-800",
    bg:          "bg-blue-950/40",
    description: "CPI prints, PCE releases, GDP revisions, and macro surprise events. The core inflation and growth regime cases.",
  },
  {
    pack_id:     "earnings_v1",
    domain:      "earnings",
    label:       "Earnings",
    icon:        "💹",
    color:       "text-cyan-400",
    border:      "border-cyan-800",
    bg:          "bg-cyan-950/40",
    description: "Mega-cap earnings beats and misses, guidance cuts, and sector read-throughs. AAPL, MSFT, NVDA, META, AMZN and more.",
  },
  {
    pack_id:     "policy_fx_v1",
    domain:      "policy_fx",
    label:       "Policy & FX",
    icon:        "🏦",
    color:       "text-indigo-400",
    border:      "border-indigo-800",
    bg:          "bg-indigo-950/40",
    description: "Central bank pivots, FOMC decisions, BOJ intervention, dollar regime shifts, yen carry trades, and sanctions shocks.",
  },
  {
    pack_id:     "energy_v1",
    domain:      "energy",
    label:       "Energy",
    icon:        "⚡",
    color:       "text-yellow-400",
    border:      "border-yellow-800",
    bg:          "bg-yellow-950/40",
    description: "OPEC+ supply cuts, oil shocks, energy demand collapses, and natural gas crises. Crude, WTI, and XLE trade setups.",
  },
  {
    pack_id:     "credit_banking_v1",
    domain:      "credit",
    label:       "Credit & Banking",
    icon:        "🏛️",
    color:       "text-rose-400",
    border:      "border-rose-800",
    bg:          "bg-rose-950/40",
    description: "Bank failures, credit spread blowouts, SVB contagion, regional bank stress, and HY/IG spread regime shifts.",
  },
  {
    pack_id:     "crypto_v1",
    domain:      "crypto",
    label:       "Crypto",
    icon:        "₿",
    color:       "text-orange-400",
    border:      "border-orange-800",
    bg:          "bg-orange-950/40",
    description: "Exchange collapses (FTX), Bitcoin halving cycles, ETF approvals, on-chain liquidation cascades, and stablecoin depegs.",
  },
  {
    pack_id:     "china_macro_v1",
    domain:      "china",
    label:       "China Macro",
    icon:        "🐉",
    color:       "text-red-400",
    border:      "border-red-800",
    bg:          "bg-red-950/40",
    description: "PBOC stimulus, property developer defaults (Evergrande), zero-COVID reopening, tech crackdowns, and Taiwan risk events.",
  },
  {
    pack_id:     "commodities_v1",
    domain:      "commodities",
    label:       "Commodities",
    icon:        "🌾",
    color:       "text-amber-400",
    border:      "border-amber-800",
    bg:          "bg-amber-950/40",
    description: "Gold safe-haven demand, copper China proxy trades, wheat supply shocks, and commodity supercycle regime shifts.",
  },
  {
    pack_id:     "geopolitical_v1",
    domain:      "geopolitical",
    label:       "Geopolitical",
    icon:        "🌍",
    color:       "text-purple-400",
    border:      "border-purple-800",
    bg:          "bg-purple-950/40",
    description: "Russia-Ukraine invasion, Middle East escalations, Taiwan Strait tensions, tariff wars, and risk-off contagion events.",
  },
  {
    pack_id:     "volatility_v1",
    domain:      "volatility",
    label:       "Volatility",
    icon:        "⚡",
    color:       "text-violet-400",
    border:      "border-violet-800",
    bg:          "bg-violet-950/40",
    description: "VIX spikes, short-vol blowups (Volmageddon), gamma squeezes, vol regime shifts, and VIX term structure inversions.",
  },
  {
    pack_id:     "real_estate_housing_v1",
    domain:      "real_estate_housing",
    label:       "Real Estate",
    icon:        "🏠",
    color:       "text-teal-400",
    border:      "border-teal-800",
    bg:          "bg-teal-950/40",
    description: "Mortgage rate shocks, REIT selloffs, housing starts misses, Case-Shiller declines, and MBS spread dislocations.",
  },
  {
    pack_id:     "sovereign_debt_v1",
    domain:      "sovereign_debt",
    label:       "Sovereign Debt",
    icon:        "📜",
    color:       "text-emerald-400",
    border:      "border-emerald-800",
    bg:          "bg-emerald-950/40",
    description: "UK gilt crisis (LDI), US debt ceiling standoffs, Fitch downgrade, BTP-Bund blowouts, EM sovereign defaults, and safe-haven flows.",
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  if (d < 30) return `${d}d ago`
  const m = Math.floor(d / 30)
  if (m < 12) return `${m}mo ago`
  return `${Math.floor(m / 12)}yr ago`
}

// ─── Pack Card ────────────────────────────────────────────────────────────────

function PackCard({
  meta,
  stat,
}: {
  meta: PackMeta
  stat: LibraryPackStat | undefined
}) {
  const count    = stat?.case_count     ?? 0
  const reviewed = stat?.reviewed_count ?? 0
  const latest   = stat?.latest_case_at ?? null
  const seeded   = count > 0

  return (
    <div
      className={`
        relative rounded-xl border p-4 flex flex-col gap-3 transition-all
        ${seeded
          ? `${meta.border} ${meta.bg} hover:brightness-110`
          : "border-zinc-800 bg-zinc-900/50 opacity-60"}
      `}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{meta.icon}</span>
          <div>
            <p className={`text-sm font-semibold ${seeded ? meta.color : "text-zinc-500"}`}>
              {meta.label}
            </p>
            <p className="text-zinc-600 text-xs font-mono">{meta.pack_id}</p>
          </div>
        </div>
        {/* Case count badge */}
        <div className="shrink-0 text-right">
          <p className={`text-2xl font-bold tabular-nums ${seeded ? meta.color : "text-zinc-700"}`}>
            {count}
          </p>
          <p className="text-zinc-600 text-xs">cases</p>
        </div>
      </div>

      {/* Description */}
      <p className="text-zinc-400 text-xs leading-relaxed">{meta.description}</p>

      {/* Footer stats */}
      <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
        {seeded ? (
          <>
            <div className="flex items-center gap-3">
              <span className="text-zinc-500 text-xs">
                <span className="text-emerald-400 font-medium">{reviewed}</span> reviewed
              </span>
              {stat && stat.draft_count > 0 && (
                <span className="text-zinc-500 text-xs">
                  <span className="text-amber-400 font-medium">{stat.draft_count}</span> draft
                </span>
              )}
            </div>
            {latest && (
              <span className="text-zinc-600 text-xs">{timeAgo(latest)}</span>
            )}
          </>
        ) : (
          <span className="text-zinc-700 text-xs italic">not yet seeded</span>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const [packsResponse, setPacksResponse] = useState<{
    packs:       LibraryPackStat[]
    total_cases: number
    pack_count:  number
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getLibraryPacks().then(data => {
      setPacksResponse(data)
      setLoading(false)
    })
  }, [])

  // Index stats by pack_id for O(1) lookup
  const statsByPack = Object.fromEntries(
    (packsResponse?.packs ?? []).map(p => [p.case_pack, p])
  )

  const totalCases  = packsResponse?.total_cases  ?? 0
  const seededPacks = (packsResponse?.packs ?? []).filter(p => p.case_count > 0).length

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-black text-sm font-bold">FS</div>
        <div>
          <h1 className="text-zinc-100 font-semibold text-sm">Finance Superbrain</h1>
          <p className="text-zinc-500 text-xs">Intelligence Library</p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <Link href="/"         className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">💬 Chat</Link>
          <Link href="/accuracy" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">📊 Accuracy</Link>
        </div>
      </header>

      <MarketTickerBar />
      <EventsStrip />

      <main className="flex-1 overflow-y-auto px-6 py-6 max-w-6xl mx-auto w-full">

        {/* ── Headline stats ───────────────────────────────────────────────── */}
        <div className="mb-6">
          <h2 className="text-zinc-100 text-lg font-semibold mb-1">Historical Case Library</h2>
          <p className="text-zinc-500 text-sm max-w-2xl">
            Every query the brain answers is grounded in this library of institutional-grade
            historical cases — real market events with documented outcomes, retrieved semantically
            at query time.
          </p>
        </div>

        {loading ? (
          <div className="text-zinc-600 text-sm animate-pulse">Loading library data…</div>
        ) : (
          <>
            {/* Stat strip */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-zinc-500 text-xs tracking-widest mb-1">TOTAL CASES</p>
                <p className="text-zinc-100 text-3xl font-bold">{totalCases}</p>
                <p className="text-zinc-600 text-xs mt-1">across all domain packs</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-zinc-500 text-xs tracking-widest mb-1">DOMAIN PACKS</p>
                <p className="text-emerald-400 text-3xl font-bold">{PACK_META.length}</p>
                <p className="text-zinc-600 text-xs mt-1">{seededPacks} seeded · {PACK_META.length - seededPacks} pending</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-zinc-500 text-xs tracking-widest mb-1">RETRIEVAL</p>
                <p className="text-zinc-100 text-3xl font-bold">25</p>
                <p className="text-zinc-600 text-xs mt-1">top analogues per query · semantic search</p>
              </div>
            </div>

            {/* Pack grid */}
            <p className="text-zinc-500 text-xs tracking-widest mb-4">ALL DOMAIN PACKS</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PACK_META.map(meta => (
                <PackCard
                  key={meta.pack_id}
                  meta={meta}
                  stat={statsByPack[meta.pack_id]}
                />
              ))}
            </div>

            {/* How it works note */}
            <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <p className="text-zinc-400 text-xs tracking-widest mb-3 font-medium">HOW RETRIEVAL WORKS</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-zinc-500">
                <div>
                  <p className="text-zinc-300 font-medium mb-1">1 · Semantic Embedding</p>
                  <p>Every case is embedded with Voyage AI finance-2 and stored in Supabase pgvector. At query time your question is embedded the same way.</p>
                </div>
                <div>
                  <p className="text-zinc-300 font-medium mb-1">2 · Cosine Similarity Search</p>
                  <p>The 25 closest cases across all 12 packs are retrieved by cosine distance — regardless of which domain they live in.</p>
                </div>
                <div>
                  <p className="text-zinc-300 font-medium mb-1">3 · Grounded Analysis</p>
                  <p>The brain cites specific case IDs, their realized ticker moves in basis points, and the dominant catalyst when building its answer.</p>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
