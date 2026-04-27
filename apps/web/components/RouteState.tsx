"use client"

import Link from "next/link"
import type { ReactNode } from "react"

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

type RouteStateCardProps = {
  title: string
  description: string
  variant?: "loading" | "empty" | "error" | "notice"
  actionHref?: string
  actionLabel?: string
  children?: ReactNode
}

export function RouteStateCard({
  title,
  description,
  variant = "empty",
  actionHref,
  actionLabel,
  children,
}: RouteStateCardProps) {
  const toneClass =
    variant === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-50"
      : variant === "notice"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-50"
        : "border-white/10 bg-white/5 text-zinc-100"

  const eyebrowClass =
    variant === "error"
      ? "text-red-200/70"
      : variant === "notice"
        ? "text-emerald-200/70"
        : "text-zinc-500"

  return (
    <div className={classNames("rounded-[24px] border p-4", toneClass, variant === "loading" && "animate-pulse")}>
      <p className={classNames("text-[11px] uppercase tracking-[0.24em]", eyebrowClass)}>{variant}</p>
      <p className="mt-2 text-sm font-medium text-white">{title}</p>
      <p className="mt-2 text-sm text-current/80">{description}</p>
      {children ? <div className="mt-3">{children}</div> : null}
      {actionHref && actionLabel ? (
        <div className="mt-4">
          <Link
            href={actionHref}
            className="rounded-full border border-current/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-current transition-colors hover:border-current/40"
          >
            {actionLabel}
          </Link>
        </div>
      ) : null}
    </div>
  )
}

export function RouteLoadingState({ title, description }: { title: string; description: string }) {
  return <RouteStateCard title={title} description={description} variant="loading" />
}

export function RouteEmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string
  description: string
  actionHref?: string
  actionLabel?: string
}) {
  return <RouteStateCard title={title} description={description} variant="empty" actionHref={actionHref} actionLabel={actionLabel} />
}

export function RouteErrorState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string
  description: string
  actionHref?: string
  actionLabel?: string
}) {
  return <RouteStateCard title={title} description={description} variant="error" actionHref={actionHref} actionLabel={actionLabel} />
}

export function RouteNoticeState({ title, description }: { title: string; description: string }) {
  return <RouteStateCard title={title} description={description} variant="notice" />
}
