"use client"

import Link from "next/link"
import { FormEvent, useEffect, useMemo, useState } from "react"

import { AppShell } from "@/components/AppShell"
import { RouteEmptyState } from "@/components/RouteState"
import { useWorkspace } from "@/components/WorkspaceProvider"
import { formatWorkspaceActivityKind, getWorkspaceActivityReferences } from "@/lib/workspaceActivity"
import { createWorkspaceUser, fetchWorkspaceActivity } from "@/lib/workspaceApi"

function formatRelativeDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

const PRIORITY_ACTIVITY_KINDS = new Set([
  "login",
  "logout",
  "user_created",
  "studio_run_saved",
  "investigation_assigned",
  "investigation_reopened",
  "review_note_saved",
  "decision_brief_created",
  "decision_brief_assigned",
  "decision_brief_status_changed",
  "decision_checkpoint_saved",
  "decision_brief_closed",
  "portfolio_candidate_created",
  "portfolio_candidate_assigned",
  "portfolio_candidate_status_changed",
  "portfolio_candidate_posture_updated",
  "portfolio_checkpoint_saved",
  "portfolio_candidate_closed",
  "portfolio_review_session_created",
  "portfolio_review_session_updated",
  "portfolio_review_session_finalized",
  "portfolio_rebalance_proposal_saved",
  "portfolio_rebalance_proposal_decided",
])

export default function SettingsPage() {
  const { activity, members, membership, refreshWorkspace, workspace } = useWorkspace()
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"admin" | "member">("member")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activityFeed, setActivityFeed] = useState(activity)

  const sortedMembers = useMemo(
    () =>
      [...members].sort((left, right) => {
        if (left.membership.role !== right.membership.role) {
          return left.membership.role === "admin" ? -1 : 1
        }

        return left.user.display_name.localeCompare(right.user.display_name)
      }),
    [members],
  )
  const memberNameMap = useMemo(
    () => new Map(members.map((entry) => [entry.user.id, entry.user.display_name])),
    [members],
  )
  const prioritizedActivity = useMemo(() => {
    const highSignal = activityFeed.filter((event) => PRIORITY_ACTIVITY_KINDS.has(event.kind))
    const supporting = activityFeed.filter((event) => !PRIORITY_ACTIVITY_KINDS.has(event.kind))
    return [...highSignal, ...supporting].slice(0, 16)
  }, [activityFeed])

  useEffect(() => {
    void refreshWorkspace()
  }, [refreshWorkspace])

  useEffect(() => {
    let active = true

    void fetchWorkspaceActivity()
      .then((events) => {
        if (active) {
          setActivityFeed(events)
        }
      })
      .catch(() => {
        if (active) {
          setActivityFeed(activity)
        }
      })

    return () => {
      active = false
    }
  }, [activity])

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      await createWorkspaceUser({
        email,
        password,
        display_name: displayName,
        role,
      })
      setDisplayName("")
      setEmail("")
      setPassword("")
      setRole("member")
      setSuccess("Workspace member created.")
      await refreshWorkspace()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Failed to create workspace member.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell title="Settings" subtitle="Internal team controls for the single-tenant alpha workspace.">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.9fr)]">
        <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
          <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Workspace members</p>
          <h2 className="mt-2 font-display text-lg font-semibold text-white">
            {workspace?.name ?? "Internal Alpha"}
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            Team visibility, role awareness, and shared ownership all anchor to this member list.
          </p>

          <div className="mt-4 space-y-3">
            {sortedMembers.length ? (
              sortedMembers.map((entry) => (
                <div key={entry.user.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{entry.user.display_name}</p>
                      <p className="mt-1 text-xs text-zinc-500">{entry.user.email}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300">
                      {entry.membership.role}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <RouteEmptyState
                title="No workspace members yet"
                description="Create the first member in this workspace to begin team collaboration."
              />
            )}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
          <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Admin controls</p>
          <h2 className="mt-2 font-display text-lg font-semibold text-white">Invite a teammate</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Only admins can create new internal users for this alpha workspace.
          </p>

          {membership?.role !== "admin" ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-400">
              You can view the team list here, but only workspace admins can add new members.
            </div>
          ) : (
            <form className="mt-4 space-y-4" onSubmit={handleCreateUser}>
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-zinc-500" htmlFor="settings-display-name">
                  Display name
                </label>
                <input
                  id="settings-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-zinc-500" htmlFor="settings-email">
                  Email
                </label>
                <input
                  id="settings-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-zinc-500" htmlFor="settings-temporary-password">
                  Temporary password
                </label>
                <input
                  id="settings-temporary-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-zinc-500" htmlFor="settings-role">
                  Role
                </label>
                <select
                  id="settings-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as "admin" | "member")}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {error ? (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              ) : null}
              {success ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  {success}
                </div>
              ) : null}
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-400">
                Temporary passwords are intended for internal alpha onboarding. Rotate them after first sign-in in the next auth hardening pass.
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-500/60"
              >
                {submitting ? "Creating member..." : "Create member"}
              </button>
            </form>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-[28px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur">
        <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Workspace activity</p>
        <h2 className="mt-2 font-display text-lg font-semibold text-white">Audit trail</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Recent team activity across sign-ins, investigation assignment, Studio persistence, and shared review notes.
        </p>

        <div className="mt-4 space-y-3">
          {prioritizedActivity.length ? (
            prioritizedActivity.map((event) => {
              const references = getWorkspaceActivityReferences(event)

              return (
                <div key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{event.detail}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {memberNameMap.get(event.actor_user_id) ?? "Unknown teammate"} | {formatWorkspaceActivityKind(event.kind)}
                      </p>
                    </div>
                    <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                      {formatRelativeDate(event.created_at)}
                    </span>
                  </div>
                  {references.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {references.map((reference) => (
                        <Link
                          key={`${event.id}:${reference.label}:${reference.href}`}
                          href={reference.href}
                          className="rounded-full border border-white/10 bg-zinc-950/60 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
                        >
                          {reference.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })
          ) : (
            <RouteEmptyState
              title="No activity recorded yet"
              description="Sign-ins, Studio persistence, investigation changes, and shared review notes will populate this audit feed."
            />
          )}
        </div>
      </section>
    </AppShell>
  )
}
