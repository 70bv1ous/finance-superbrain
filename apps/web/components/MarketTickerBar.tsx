"use client"

import { useEffect, useState } from "react"

import { getMarketSnapshot, type MarketTicker } from "@/lib/chatApi"

const DISPLAY_ORDER = [
  "SPY",
  "QQQ",
  "^VIX",
  "TLT",
  "GLD",
  "CL=F",
  "^TNX",
  "EURUSD=X",
  "DX-Y.NYB",
  "XLF",
  "XLE",
  "XLK",
  "XLV",
  "IWM",
  "EEM",
  "BTC-USD",
]

export function MarketTickerBar() {
  const [tickers, setTickers] = useState<MarketTicker[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const refresh = async () => {
      const data = await getMarketSnapshot()

      if (!active) {
        return
      }

      if (data.length > 0) {
        const sorted = DISPLAY_ORDER
          .map((symbol) => data.find((ticker) => ticker.symbol === symbol))
          .filter(Boolean) as MarketTicker[]

        setTickers(sorted)
        setLastUpdated(new Date())
      }

      setLoading(false)
    }

    void refresh()
    const interval = setInterval(() => {
      void refresh()
    }, 60_000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-6 py-2">
        <span className="animate-pulse text-xs text-zinc-600">Loading market data...</span>
      </div>
    )
  }

  if (tickers.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-0 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-4 py-1.5 scrollbar-none">
      <span className="mr-3 shrink-0 text-xs font-medium tracking-widest text-zinc-600">LIVE</span>
      <div className="flex items-center gap-4 overflow-x-auto">
        {tickers.map((ticker) => {
          const isUp = ticker.change_pct >= 0
          const color = isUp ? "text-emerald-400" : "text-red-400"
          const changePrefix = isUp ? "+" : "-"
          const changeText = `${changePrefix} ${Math.abs(ticker.change_pct).toFixed(2)}%`
          const priceText = ticker.price < 10 ? ticker.price.toFixed(4) : ticker.price.toFixed(2)

          return (
            <div key={ticker.symbol} className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs font-medium text-zinc-500">{ticker.label}</span>
              <span className="text-xs font-mono text-zinc-200">{priceText}</span>
              <span className={`text-xs font-mono ${color}`}>{changeText}</span>
            </div>
          )
        })}
      </div>
      {lastUpdated ? (
        <span className="ml-3 shrink-0 text-xs text-zinc-700">
          {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      ) : null}
    </div>
  )
}
