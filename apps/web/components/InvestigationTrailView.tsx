import Link from "next/link"

import { InvestigationStatusBadge } from "@/components/InvestigationStatusBadge"
import {
  getTrailPrimaryAction,
  getTrailRelatedActions,
  type InvestigationTrail,
  type InvestigationTrailAction,
  type InvestigationTrailStep,
} from "@/lib/investigationTrail"

function formatRelativeTime(value: string) {
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function InvestigationTrailSummary({
  trail,
  status,
  summary,
  actions,
  primaryAction,
  label = "Current trail",
}: {
  trail: InvestigationTrail
  status?: React.ReactNode
  summary?: React.ReactNode
  actions?: React.ReactNode
  primaryAction?: InvestigationTrailAction | null
  label?: string
}) {
  const resolvedPrimaryAction = primaryAction ?? getTrailPrimaryAction(trail)
  const steps = trail.steps ?? []

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{label}</p>
        {status}
      </div>
      <p className="mt-2 text-sm font-medium text-white">{trail.title}</p>
      <p className="mt-2 text-xs text-zinc-500">
        {steps.length} recorded step{steps.length === 1 ? "" : "s"} | {formatRelativeTime(trail.updatedAt)}
      </p>
      {summary ? <div className="mt-3 text-sm text-zinc-300">{summary}</div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={resolvedPrimaryAction.href}
          className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:text-emerald-50"
        >
          {resolvedPrimaryAction.label}
        </Link>
        {actions}
      </div>
    </div>
  )
}

export function InvestigationTrailSteps({
  steps,
  limit = 4,
  actionLabel = "Open",
  actionMode = "link",
  onOpenStep,
}: {
  steps: InvestigationTrailStep[]
  limit?: number
  actionLabel?: string
  actionMode?: "link" | "button"
  onOpenStep?: (href: string) => void
}) {
  const visibleSteps = (steps ?? []).slice(0, limit)

  return (
    <div className="space-y-3">
      {visibleSteps.map((step) => {
        const action =
          actionMode === "button" ? (
            <button
              type="button"
              onClick={() => onOpenStep?.(step.href)}
              className="text-[11px] uppercase tracking-[0.24em] text-emerald-300 transition-colors hover:text-emerald-200"
            >
              {actionLabel}
            </button>
          ) : (
            <Link
              href={step.href}
              className="text-[11px] uppercase tracking-[0.24em] text-emerald-300 transition-colors hover:text-emerald-200"
            >
              {actionLabel}
            </Link>
          )

        return (
          <div key={step.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                {step.kind.replace(/_/g, " ")}
              </p>
              {action}
            </div>
            <p className="mt-2 text-sm text-white">{step.title}</p>
            <p className="mt-2 text-xs text-zinc-500">{step.detail}</p>
          </div>
        )
      })}
    </div>
  )
}

export function InvestigationTrailActions({
  trail,
  includePrimary = false,
}: {
  trail: InvestigationTrail
  includePrimary?: boolean
}) {
  const actions = includePrimary ? getTrailRelatedActions(trail) : getTrailRelatedActions(trail).slice(1)

  return (
    <>
      {actions.map((action) => (
        <Link
          key={`${action.href}:${action.label}`}
          href={action.href}
          title={action.description}
          className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
        >
          {action.label}
        </Link>
      ))}
    </>
  )
}

export function InvestigationTrailStatusSummary({
  trail,
  summary,
}: {
  trail: InvestigationTrail
  summary: string
}) {
  return (
    <InvestigationTrailSummary
      trail={trail}
      status={<InvestigationStatusBadge status={trail.steps?.[0]?.status ?? "drafting"} />}
      summary={summary}
    />
  )
}
