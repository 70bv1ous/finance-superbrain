"use client"

import type { DecisionBriefStatus } from "@finance-superbrain/schemas"

const STATUS_STYLES: Record<DecisionBriefStatus, string> = {
  draft: "border-white/10 bg-white/5 text-zinc-300",
  proposed: "border-cyan-500/25 bg-cyan-500/10 text-cyan-100",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  watching: "border-amber-500/25 bg-amber-500/10 text-amber-100",
  closed: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
}

function formatDecisionStatus(status: DecisionBriefStatus) {
  return status.replace(/_/g, " ")
}

export function DecisionStatusBadge({ status }: { status: DecisionBriefStatus }) {
  return (
    <span
      className={[
        "rounded-full border px-3 py-1 text-xs uppercase tracking-[0.24em]",
        STATUS_STYLES[status],
      ].join(" ")}
    >
      {formatDecisionStatus(status)}
    </span>
  )
}
