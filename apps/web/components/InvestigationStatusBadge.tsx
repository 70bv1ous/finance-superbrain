import type { InvestigationStatus } from "@/lib/investigationTrail"
import { formatInvestigationStatus, getInvestigationStatusTone } from "@/lib/investigationTrail"

export function InvestigationStatusBadge({ status }: { status: InvestigationStatus }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] ${getInvestigationStatusTone(status)}`}
    >
      {formatInvestigationStatus(status)}
    </span>
  )
}
