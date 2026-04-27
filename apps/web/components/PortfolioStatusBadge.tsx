"use client"

import type { PortfolioCandidateStatus } from "@finance-superbrain/schemas"

const STATUS_STYLES: Record<PortfolioCandidateStatus, string> = {
  candidate: "border-cyan-500/25 bg-cyan-500/10 text-cyan-100",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  watching: "border-amber-500/25 bg-amber-500/10 text-amber-100",
  trimmed: "border-blue-500/25 bg-blue-500/10 text-blue-100",
  closed: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
}

function formatPortfolioStatus(status: PortfolioCandidateStatus) {
  return status.replace(/_/g, " ")
}

export function PortfolioStatusBadge({ status }: { status: PortfolioCandidateStatus }) {
  return (
    <span
      className={[
        "rounded-full border px-3 py-1 text-xs uppercase tracking-[0.24em]",
        STATUS_STYLES[status],
      ].join(" ")}
    >
      {formatPortfolioStatus(status)}
    </span>
  )
}
