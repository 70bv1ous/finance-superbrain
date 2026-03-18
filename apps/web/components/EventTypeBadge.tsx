import type { EventType } from "@/lib/chatApi"

const config: Record<EventType, { label: string; className: string }> = {
  cpi:     { label: "CPI",     className: "bg-blue-950 text-blue-400 border border-blue-800" },
  fomc:    { label: "FOMC",    className: "bg-purple-950 text-purple-400 border border-purple-800" },
  nfp:     { label: "NFP",     className: "bg-orange-950 text-orange-400 border border-orange-800" },
  general: { label: "GENERAL", className: "bg-zinc-800 text-zinc-400 border border-zinc-700" },
}

export function EventTypeBadge({ type }: { type: EventType }) {
  const { label, className } = config[type]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-widest ${className}`}>
      {label}
    </span>
  )
}
