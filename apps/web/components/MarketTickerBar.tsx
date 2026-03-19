"use client"

import { useEffect, useState } from "react"
import { getMarketSnapshot, type MarketTicker } from "@/lib/chatApi"

// Key tickers to show in the bar (in display order)
const DISPLAY_ORDER = ["SPY", "QQQ", "^VIX", "TLT", "GLD", "CL=F", "^TNX", "EURUSD=X", "DX-Y.NYB"]

export function MarketTickerBar() {
  const [tickers, setTickers] = useState<MarketTicker[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const data = await getMarketSnapshot()
    if (data.length > 0) {
      // Sort by display order
      const sorted = DISPLAY_ORDER
        .map(sym => data.find(t => t.symbol === sym))
        .filter(Boolean) as MarketTicker[]
      setTickers(sorted)
      setLastUpdated(new Date())
    }
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 60_000) // refresh every 60s
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="border-b border-zinc-800 bg-zinc-950 px-6 py-2 flex items-center gap-2">
        <span className="text-zinc-600 text-xs animate-pulse">Loading market data…</span>
      </div>
    )
  }

  if (tickers.length === 0) return null

  return (
    <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-1.5 flex items-center gap-0 overflow-x-auto scrollbar-none">
      <span className="text-zinc-600 text-xs font-medium shrink-0 mr-3 tracking-widest">LIVE</span>
      <div className="flex items-center gap-4 overflow-x-auto">
        {tickers.map(t => {
          const isUp    = t.change_pct >= 0
          const color   = isUp ? "text-emerald-400" : "text-red-400"
          const arrow   = isUp ? "▲" : "▼"
          const changeFmt = `${arrow} ${Math.abs(t.change_pct).toFixed(2)}%`
          // Format price based on magnitude
          const priceFmt = t.price < 10
            ? t.price.toFixed(4)
            : t.price.toFixed(2)

          return (
            <div key={t.symbol} className="flex items-center gap-1.5 shrink-0">
              <span className="text-zinc-500 text-xs font-medium">{t.label}</span>
              <span className="text-zinc-200 text-xs font-mono">{priceFmt}</span>
              <span className={`text-xs font-mono ${color}`}>{changeFmt}</span>
            </div>
          )
        })}
      </div>
      {lastUpdated && (
        <span className="text-zinc-700 text-xs shrink-0 ml-3">
          {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  )
}
