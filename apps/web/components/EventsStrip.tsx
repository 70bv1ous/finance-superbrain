"use client"

import { useEffect, useState } from "react"
import { getUpcomingEvents, type UpcomingEvent } from "@/lib/chatApi"

const importanceColor: Record<string, string> = {
  high:   "border-red-800 text-red-400 bg-red-950",
  medium: "border-amber-800 text-amber-400 bg-amber-950",
  low:    "border-zinc-700 text-zinc-400 bg-zinc-900",
}

const importanceDot: Record<string, string> = {
  high:   "bg-red-500",
  medium: "bg-amber-500",
  low:    "bg-zinc-500",
}

export function EventsStrip() {
  const [events, setEvents] = useState<UpcomingEvent[]>([])

  useEffect(() => {
    getUpcomingEvents().then(data => {
      // Show max 4 events, high importance first then by date
      const sorted = [...data]
        .sort((a, b) => {
          const imp = { high: 0, medium: 1, low: 2 }
          const impDiff = (imp[a.importance] ?? 1) - (imp[b.importance] ?? 1)
          if (impDiff !== 0) return impDiff
          return a.days_away - b.days_away
        })
        .slice(0, 4)
      setEvents(sorted)
    })
  }, [])

  if (events.length === 0) return null

  return (
    <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-2 flex items-center gap-2 overflow-x-auto scrollbar-none">
      <span className="text-zinc-600 text-xs font-medium shrink-0 tracking-widest mr-1">UPCOMING</span>
      {events.map((e, i) => {
        const colorClass = importanceColor[e.importance] ?? importanceColor.low
        const dotClass   = importanceDot[e.importance]  ?? importanceDot.low
        const when = e.days_away === 0
          ? "TODAY"
          : e.days_away === 1
          ? "TOMORROW"
          : `${e.days_away}d`

        return (
          <div
            key={i}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs shrink-0 ${colorClass}`}
            title={e.description}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
            <span className="font-medium">{e.name}</span>
            <span className="opacity-60 font-mono">{when}</span>
          </div>
        )
      })}
    </div>
  )
}
