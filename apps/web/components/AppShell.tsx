"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import { EventsStrip } from "@/components/EventsStrip"
import { MarketTickerBar } from "@/components/MarketTickerBar"
import { useWorkspace } from "@/components/WorkspaceProvider"
import { getTrailStatus } from "@/lib/investigationTrail"

const NAV_ITEMS = [
  { href: "/workspace", label: "Command center" },
  { href: "/decisions", label: "Decisions" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/investigations", label: "Investigations" },
  { href: "/studio", label: "Studio" },
  { href: "/accuracy", label: "Accuracy" },
  { href: "/evaluation", label: "Evaluation" },
  { href: "/library", label: "Library" },
  { href: "/settings", label: "Settings" },
]

const navClassName = (active: boolean) =>
  [
    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-100",
  ].join(" ")

type AppShellProps = {
  title: string
  subtitle: string
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
}

export function AppShell({
  title,
  subtitle,
  eyebrow = "Finance Superbrain",
  actions,
  children,
}: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { authenticated, decisionBriefs, hydrated, investigationTrails, logout, portfolioCandidates, studioDraft, user } = useWorkspace()
  const [logoutRedirectTarget, setLogoutRedirectTarget] = useState<string | null>(null)

  const navigateToLogin = useCallback((targetPath: string) => {
    if (targetPath === "/") {
      if (typeof window !== "undefined") {
        window.location.replace("/")
        return
      }

      router.replace("/")
      return
    }

    const next = encodeURIComponent(targetPath || "/")

    if (typeof window !== "undefined") {
      window.location.replace(`/login?next=${next}`)
      return
    }

    router.replace(`/login?next=${next}`)
  }, [router])

  useEffect(() => {
    if (hydrated && !authenticated) {
      navigateToLogin((logoutRedirectTarget ?? pathname) || "/")
    }
  }, [authenticated, hydrated, logoutRedirectTarget, navigateToLogin, pathname])
  const workspacePulse = useMemo(() => {
    if (!hydrated) {
      return []
    }

    const workspaceDecisionBriefs = decisionBriefs ?? []
    const workspacePortfolioCandidates = portfolioCandidates ?? []
    const activeCount = investigationTrails.filter((trail) => getTrailStatus(trail) === "drafting").length
    const awaitingReviewCount = investigationTrails.filter((trail) => {
      const status = getTrailStatus(trail)
      return status === "ready_for_review" || status === "under_review"
    }).length
    const reviewedCount = investigationTrails.filter((trail) => getTrailStatus(trail) === "reviewed").length
    const activeDecisionCount = workspaceDecisionBriefs.filter((brief) => brief.status === "active" || brief.status === "watching").length
    const proposedDecisionCount = workspaceDecisionBriefs.filter((brief) => brief.status === "draft" || brief.status === "proposed").length
    const activePortfolioCount = workspacePortfolioCandidates.filter((candidate) => candidate.status === "active" || candidate.status === "watching" || candidate.status === "trimmed").length
    const candidatePortfolioCount = workspacePortfolioCandidates.filter((candidate) => candidate.status === "candidate").length

    return [
      studioDraft
        ? {
            id: "studio-draft",
            href: "/studio",
            label: "Draft in progress",
            detail: studioDraft.form.title.trim() || "Studio draft saved locally",
          }
        : null,
      activeDecisionCount > 0
        ? {
            id: "active-decisions",
            href: "/decisions",
            label: `${activeDecisionCount} active decision${activeDecisionCount === 1 ? "" : "s"}`,
            detail: "Shared briefs are live and need follow-through",
          }
        : null,
      proposedDecisionCount > 0
        ? {
            id: "proposed-decisions",
            href: "/decisions",
            label: `${proposedDecisionCount} proposed decision${proposedDecisionCount === 1 ? "" : "s"}`,
            detail: "New briefs are waiting for assignment or activation",
          }
        : null,
      activePortfolioCount > 0
        ? {
            id: "active-portfolio",
            href: "/portfolio",
            label: `${activePortfolioCount} live portfolio candidate${activePortfolioCount === 1 ? "" : "s"}`,
            detail: "Portfolio-tracked theses need review, trim, or closure discipline",
          }
        : null,
      candidatePortfolioCount > 0
        ? {
            id: "candidate-portfolio",
            href: "/portfolio",
            label: `${candidatePortfolioCount} portfolio candidate${candidatePortfolioCount === 1 ? "" : "s"}`,
            detail: "Newly promoted briefs are waiting for portfolio posture",
          }
        : null,
      activeCount > 0
        ? {
            id: "active-investigations",
            href: "/investigations",
            label: `${activeCount} active investigation${activeCount === 1 ? "" : "s"}`,
            detail: "Continue the open operator workflow",
          }
        : null,
      awaitingReviewCount > 0
        ? {
            id: "awaiting-review",
            href: "/accuracy",
            label: `${awaitingReviewCount} awaiting review`,
            detail: "Verdicts or notes still need operator attention",
          }
        : null,
      reviewedCount > 0
        ? {
            id: "reviewed-investigations",
            href: "/library",
            label: `${reviewedCount} retrieval-ready`,
            detail: "Completed investigations are ready for lesson lookup",
          }
        : null,
    ].filter(Boolean) as Array<{ id: string; href: string; label: string; detail: string }>
  }, [decisionBriefs, hydrated, investigationTrails, portfolioCandidates, studioDraft])

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_28%),linear-gradient(180deg,_#09090b_0%,_#111827_100%)] text-zinc-100">
      <header className="border-b border-white/10 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/15 text-sm font-semibold tracking-[0.28em] text-emerald-200">
                FS
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-300/80">{eyebrow}</p>
                <h1 className="font-display text-xl font-semibold text-white">{title}</h1>
                <p className="max-w-2xl text-sm text-zinc-400">{subtitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 self-start lg:self-auto">
              {user ? (
                <span className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 md:inline-flex">
                  {user.display_name}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Platform live
              </span>
              {authenticated ? (
                <button
                  type="button"
                  onClick={() => {
                    setLogoutRedirectTarget("/")
                    void logout()
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Sign out
                </button>
              ) : null}
              {actions}
            </div>
          </div>
          <nav className="flex flex-wrap gap-2">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href

              return (
                <Link key={item.href} href={item.href} className={navClassName(active)}>
                  {item.label}
                </Link>
              )
            })}
          </nav>
          {workspacePulse.length ? (
            <div className="flex flex-wrap gap-2">
              {workspacePulse.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  <span className="block font-medium text-white">{item.label}</span>
                  <span className="mt-1 block text-[11px] text-zinc-500">{item.detail}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <MarketTickerBar />
      <EventsStrip />

      <main className="mx-auto max-w-7xl px-6 py-8">
        {hydrated && !authenticated ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-zinc-400">
            Redirecting to the team workspace sign-in screen...
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  )
}
