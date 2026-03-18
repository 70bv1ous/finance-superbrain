import type { ConfidenceLevel } from "@/lib/chatApi"

const config: Record<ConfidenceLevel, { label: string; className: string }> = {
  high:   { label: "HIGH CONFIDENCE",   className: "bg-emerald-950 text-emerald-400 border border-emerald-800" },
  medium: { label: "MEDIUM CONFIDENCE", className: "bg-amber-950 text-amber-400 border border-amber-800" },
  low:    { label: "LOW CONFIDENCE",    className: "bg-red-950 text-red-400 border border-red-800" },
}

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const { label, className } = config[level]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-widest ${className}`}>
      {label}
    </span>
  )
}
