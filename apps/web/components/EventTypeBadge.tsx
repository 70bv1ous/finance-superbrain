import type { EventType } from "@/lib/chatApi"

const config: Record<EventType, { label: string; className: string }> = {
  cpi:       { label: "CPI",       className: "bg-blue-950 text-blue-400 border border-blue-800" },
  fomc:      { label: "FOMC",      className: "bg-purple-950 text-purple-400 border border-purple-800" },
  nfp:       { label: "NFP",       className: "bg-orange-950 text-orange-400 border border-orange-800" },
  earnings:  { label: "EARNINGS",  className: "bg-cyan-950 text-cyan-400 border border-cyan-800" },
  energy:    { label: "ENERGY",    className: "bg-yellow-950 text-yellow-400 border border-yellow-800" },
  credit:    { label: "CREDIT",    className: "bg-rose-950 text-rose-400 border border-rose-800" },
  policy_fx: { label: "POLICY/FX", className: "bg-indigo-950 text-indigo-400 border border-indigo-800" },
  general:   { label: "GENERAL",   className: "bg-zinc-800 text-zinc-400 border border-zinc-700" },
}

export function EventTypeBadge({ type }: { type: EventType }) {
  const { label, className } = config[type]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-widest ${className}`}>
      {label}
    </span>
  )
}
