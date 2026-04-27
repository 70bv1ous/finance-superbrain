"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { FormEvent, Suspense, useEffect, useState } from "react"

import { useWorkspace } from "@/components/WorkspaceProvider"
import { getDemoAccessAccounts, isDemoModeEnabled } from "@/lib/demoConfig"
import { createWorkspaceUser, getWorkspaceBootstrapState } from "@/lib/workspaceApi"

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/workspace"
  const { authenticated, hydrated, login } = useWorkspace()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [bootstrapRequired, setBootstrapRequired] = useState(false)
  const [bootstrapResolved, setBootstrapResolved] = useState(false)
  const [bootstrapUnavailable, setBootstrapUnavailable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const demoModeEnabled = isDemoModeEnabled()
  const demoAccounts = getDemoAccessAccounts()

  useEffect(() => {
    if (hydrated && authenticated) {
      router.replace(next)
    }
  }, [authenticated, hydrated, next, router])

  useEffect(() => {
    let active = true

    void getWorkspaceBootstrapState()
      .then((state) => {
        if (!active) {
          return
        }

        setBootstrapRequired(state.bootstrap_required)
        setBootstrapUnavailable(false)
        setBootstrapResolved(true)
      })
      .catch(() => {
        if (!active) {
          return
        }

        setBootstrapUnavailable(true)
        setBootstrapResolved(true)
        setError(
          "Workspace sign-in is temporarily unavailable while the hosted API is being reconnected. The public product shell is live, but team access is not online yet.",
        )
      })

    return () => {
      active = false
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!bootstrapResolved) {
      setError("Workspace bootstrap is still loading. Please wait a moment and try again.")
      return
    }

    if (bootstrapUnavailable) {
      setError(
        "Workspace sign-in is temporarily unavailable while the hosted API is being reconnected. Please use the public shell for now and try team access again once the backend is back online.",
      )
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      if (bootstrapRequired) {
        await createWorkspaceUser({
          email,
          password,
          display_name: displayName,
          role: "admin",
        })
      }
      await login(email, password)
      router.replace(next)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Failed to sign in.")
    } finally {
      setSubmitting(false)
    }
  }

  const fillDemoAccount = (account: { email: string; password: string }) => {
    setEmail(account.email)
    setPassword(account.password)
    setError(null)
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_28%),linear-gradient(180deg,_#09090b_0%,_#111827_100%)] px-6 py-12 text-zinc-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 lg:flex-row lg:items-center">
        <section className="max-w-xl">
          <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-300/80">Finance Superbrain</p>
          <h1 className="mt-4 font-display text-4xl font-semibold text-white">Team workspace alpha</h1>
          <p className="mt-4 text-base text-zinc-400">
            Sign in to the internal research workspace to continue Studio runs, shared investigations, and the
            review loop.
          </p>
          <p className="mt-4 text-sm text-zinc-500">
            {next === "/workspace"
              ? "Successful sign-in opens the workspace command center by default."
              : `Successful sign-in returns you to ${next}.`}
          </p>
        </section>

        <section className="w-full max-w-md rounded-[2rem] border border-white/10 bg-zinc-950/80 p-8 shadow-2xl shadow-black/30">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {bootstrapRequired ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                No workspace users exist yet. This form will create the initial admin account first.
              </div>
            ) : null}
            {!bootstrapResolved ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-400">
                Checking workspace bootstrap state...
              </div>
            ) : null}
            {bootstrapUnavailable ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Public browsing is available now. Hosted workspace sign-in will resume once the backend deployment is restored.
              </div>
            ) : null}
            {bootstrapRequired ? (
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-zinc-500" htmlFor="display-name">
                  Display name
                </label>
                <input
                  id="display-name"
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40 focus:bg-white/7"
                  placeholder="Lead operator"
                  required={bootstrapRequired}
                />
              </div>
            ) : null}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-zinc-500" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40 focus:bg-white/7"
                placeholder="operator@superbrain.internal"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-zinc-500" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40 focus:bg-white/7"
                placeholder="Enter password"
                required
              />
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            ) : null}

            {demoModeEnabled && bootstrapResolved ? (
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-4 text-sm text-cyan-50">
                <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/80">Demo access</p>
                <p className="mt-2 leading-6 text-cyan-50/90">
                  This preview is running in guided-demo mode with deterministic seeded accounts, so the walkthrough can start without manual user creation.
                </p>
                {bootstrapRequired ? (
                  <p className="mt-3 text-cyan-100/80">
                    Seed the demo workspace first, then the quick-fill accounts below will become usable.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {demoAccounts.map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        onClick={() => fillDemoAccount(account)}
                        className="w-full rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-left transition-colors hover:border-cyan-300/30 hover:bg-cyan-400/10"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-white">{account.label}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.24em] text-cyan-100/70">{account.role}</p>
                          </div>
                          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-50">
                            Fill
                          </span>
                        </div>
                        <p className="mt-3 text-sm text-cyan-50/85">{account.email}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting || !bootstrapResolved || bootstrapUnavailable}
              className="w-full rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-500/60"
            >
              {bootstrapUnavailable ? "Workspace offline" : submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-300">Loading sign-in...</main>}>
      <LoginPageInner />
    </Suspense>
  )
}
