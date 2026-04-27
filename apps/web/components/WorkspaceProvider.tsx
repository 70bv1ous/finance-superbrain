"use client"

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useState } from "react"

import { mergeInvestigationTrails, upsertInvestigationTrail, type InvestigationStepInput } from "@/lib/investigationTrail"
import {
  assignWorkspaceInvestigation,
  fetchWorkspaceMembers,
  clearWorkspaceDraft as clearWorkspaceDraftRequest,
  fetchWorkspaceState,
  loginWorkspace,
  logoutWorkspace as logoutWorkspaceRequest,
  reopenWorkspaceInvestigation,
  saveWorkspaceDraft as saveWorkspaceDraftRequest,
  saveWorkspaceRecentItem as saveWorkspaceRecentItemRequest,
  saveWorkspaceRun as saveWorkspaceRunRequest,
  syncWorkspaceTrail,
  type SavedStudioRun,
  type StudioDraftRecord,
  type WorkspaceMemberEntry,
  type WorkspaceRecentItem,
  type WorkspaceSnapshot,
} from "@/lib/workspaceApi"

export type { SavedStudioRun, StudioDraftForm, StudioDraftRecord, WorkspaceRecentItem } from "@/lib/workspaceApi"

type WorkspaceState = WorkspaceSnapshot & {
  hydrated: boolean
  members: WorkspaceMemberEntry[]
}

type WorkspaceContextValue = WorkspaceState & {
  refreshWorkspace: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  assignInvestigation: (investigationId: string, assigneeUserId: string | null) => Promise<void>
  reopenInvestigation: (investigationId: string) => Promise<void>
  saveStudioDraft: (draft: StudioDraftRecord) => void
  clearStudioDraft: () => void
  saveStudioRun: (run: SavedStudioRun) => void
  rememberRecentItem: (item: WorkspaceRecentItem) => void
  recordInvestigationStep: (input: InvestigationStepInput) => void
}

const EMPTY_WORKSPACE_STATE: WorkspaceState = {
  hydrated: false,
  authenticated: false,
  user: null,
  workspace: null,
  membership: null,
  session: null,
  studioDraft: null,
  studioRuns: [],
  decisionBriefs: [],
  portfolioCandidates: [],
  recentItems: [],
  investigationTrails: [],
  activity: [],
  members: [],
}

const LEGACY_WORKSPACE_STORAGE_KEY = "finance-superbrain.workspace.v1"
const LEGACY_IMPORT_FLAG_KEY = "finance-superbrain.workspace.imported.v1"

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(EMPTY_WORKSPACE_STATE)

  const refreshWorkspace = useCallback(async () => {
    try {
      const snapshot = await fetchWorkspaceState()

      const members = snapshot ? await fetchWorkspaceMembers() : []

      if (!snapshot) {
        setState({
          ...EMPTY_WORKSPACE_STATE,
          hydrated: true,
        })
        return
      }

      setState((current) => ({
        hydrated: true,
        ...snapshot,
        investigationTrails: mergeInvestigationTrails(snapshot.investigationTrails, current.investigationTrails),
        members,
      }))
    } catch {
      setState((current) => ({
        ...current,
        hydrated: true,
      }))
    }
  }, [])

  const handleInitialWorkspaceRefresh = useEffectEvent(() => {
    void refreshWorkspace()
  })

  useEffect(() => {
    handleInitialWorkspaceRefresh()
  }, [])

  useEffect(() => {
    if (
      !state.hydrated ||
      !state.authenticated ||
      !state.user ||
      !state.workspace ||
      state.studioDraft ||
      state.studioRuns.length > 0 ||
      state.investigationTrails.length > 0
    ) {
      return
    }

    if (typeof window === "undefined") {
      return
    }

    if (window.localStorage.getItem(LEGACY_IMPORT_FLAG_KEY) === "done") {
      return
    }

    const raw = window.localStorage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)

    if (!raw) {
      window.localStorage.setItem(LEGACY_IMPORT_FLAG_KEY, "done")
      return
    }

    let legacyState:
      | {
          studioDraft?: StudioDraftRecord | null
          studioRuns?: SavedStudioRun[]
          recentItems?: WorkspaceRecentItem[]
          investigationTrails?: Array<ReturnType<typeof upsertInvestigationTrail>[number]>
        }
      | null = null

    try {
      legacyState = JSON.parse(raw) as {
        studioDraft?: StudioDraftRecord | null
        studioRuns?: SavedStudioRun[]
        recentItems?: WorkspaceRecentItem[]
        investigationTrails?: Array<ReturnType<typeof upsertInvestigationTrail>[number]>
      }
    } catch {
      window.localStorage.setItem(LEGACY_IMPORT_FLAG_KEY, "done")
      return
    }

    window.localStorage.setItem(LEGACY_IMPORT_FLAG_KEY, "running")
    const currentUser = state.user
    const currentWorkspace = state.workspace

    void (async () => {
      try {
        if (legacyState?.studioDraft) {
          await saveWorkspaceDraftRequest(legacyState.studioDraft, {
            user: currentUser,
          })
        }

        for (const run of legacyState?.studioRuns ?? []) {
          await saveWorkspaceRunRequest(run, {
            user: currentUser,
            workspace: currentWorkspace,
          })
        }

        for (const item of legacyState?.recentItems ?? []) {
          await saveWorkspaceRecentItemRequest(item)
        }

        for (const trail of legacyState?.investigationTrails ?? []) {
          await syncWorkspaceTrail(trail, {
            user: currentUser,
            workspace: currentWorkspace,
          })
        }

        window.localStorage.setItem(LEGACY_IMPORT_FLAG_KEY, "done")
        await refreshWorkspace()
      } catch {
        window.localStorage.removeItem(LEGACY_IMPORT_FLAG_KEY)
      }
    })()
  }, [
    refreshWorkspace,
    state.authenticated,
    state.hydrated,
    state.investigationTrails.length,
    state.studioDraft,
    state.studioRuns.length,
    state.user,
    state.workspace,
  ])

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ...state,
      refreshWorkspace,
      login: async (email, password) => {
        const session = await loginWorkspace(email, password)
        setState((current) => ({
          ...current,
          hydrated: true,
          authenticated: session.authenticated,
          user: session.user,
          workspace: session.workspace,
          membership: session.membership,
          session: session.session,
        }))
        await refreshWorkspace()
      },
      logout: async () => {
        await logoutWorkspaceRequest()
        setState({
          ...EMPTY_WORKSPACE_STATE,
          hydrated: true,
        })
      },
      assignInvestigation: async (investigationId, assigneeUserId) => {
        const trail = await assignWorkspaceInvestigation(investigationId, assigneeUserId)
        setState((current) => ({
          ...current,
          investigationTrails: sortByUpdatedAt([
            trail,
            ...current.investigationTrails.filter((item) => item.id !== trail.id),
          ]).slice(0, 12),
        }))
      },
      reopenInvestigation: async (investigationId) => {
        const trail = await reopenWorkspaceInvestigation(investigationId)
        setState((current) => ({
          ...current,
          investigationTrails: sortByUpdatedAt([
            trail,
            ...current.investigationTrails.filter((item) => item.id !== trail.id),
          ]).slice(0, 12),
        }))
      },
      saveStudioDraft: (draft) => {
        setState((current) => ({
          ...current,
          studioDraft: draft,
        }))

        if (!state.user) {
          return
        }

        void saveWorkspaceDraftRequest(draft, {
          user: state.user,
        }).then((savedDraft) => {
          setState((current) => ({
            ...current,
            studioDraft: savedDraft,
          }))
        }).catch(() => undefined)
      },
      clearStudioDraft: () => {
        setState((current) => ({
          ...current,
          studioDraft: null,
        }))

        void clearWorkspaceDraftRequest().catch(() => undefined)
      },
      saveStudioRun: (run) => {
        const nextTrails = upsertInvestigationTrail(
          state.investigationTrails,
          {
            trailId: run.id,
            title: run.title,
            eventId: run.eventId,
            predictionId: run.predictionIds[0] ?? null,
            href: `/studio?run=${run.id}`,
            detail: run.predictions.length
              ? `${run.predictions.length} prediction${run.predictions.length === 1 ? "" : "s"} ready with ${run.analogs.length} analog${run.analogs.length === 1 ? "" : "s"}.`
              : "Stored event is ready for prediction generation.",
            updatedAt: run.updatedAt,
            kind: "studio_run",
            status: run.predictions.length ? "ready_for_review" : "drafting",
          },
          () => run.id,
        )

        setState((current) => ({
          ...current,
          studioRuns: sortByUpdatedAt([run, ...current.studioRuns.filter((item) => item.id !== run.id)]).slice(0, 12),
          recentItems: sortByUpdatedAt([
            {
              id: `studio-run:${run.id}`,
              kind: "studio_run" as const,
              href: `/studio?run=${run.id}`,
              title: run.title,
              description: run.eventSummary,
              updatedAt: run.updatedAt,
            },
            ...current.recentItems.filter((item) => item.id !== `studio-run:${run.id}`),
          ]).slice(0, 16),
          investigationTrails: nextTrails,
        }))

        if (!state.user || !state.workspace) {
          return
        }

        const nextTrail = nextTrails.find((trail) => trail.id === run.id)

        void saveWorkspaceRunRequest(run, {
          user: state.user,
          workspace: state.workspace,
        }).then((savedRun) => {
          setState((current) => ({
            ...current,
            studioRuns: sortByUpdatedAt([
              savedRun,
              ...current.studioRuns.filter((item) => item.id !== savedRun.id),
            ]).slice(0, 12),
          }))
        }).catch(() => undefined)

        if (nextTrail) {
          void syncWorkspaceTrail(nextTrail, {
            user: state.user,
            workspace: state.workspace,
          }).then((savedTrail) => {
            setState((current) => ({
              ...current,
              investigationTrails: sortByUpdatedAt([
                savedTrail,
                ...current.investigationTrails.filter((trail) => trail.id !== savedTrail.id),
              ]).slice(0, 12),
            }))
          }).catch(() => undefined)
        }

        void saveWorkspaceRecentItemRequest({
          id: `studio-run:${run.id}`,
          kind: "studio_run",
          href: `/studio?run=${run.id}`,
          title: run.title,
          description: run.eventSummary,
          updatedAt: run.updatedAt,
        }).catch(() => undefined)
      },
      rememberRecentItem: (item) => {
        setState((current) => ({
          ...current,
          recentItems: sortByUpdatedAt([item, ...current.recentItems.filter((entry) => entry.id !== item.id)]).slice(0, 16),
        }))

        void saveWorkspaceRecentItemRequest(item).catch(() => undefined)
      },
      recordInvestigationStep: (input) => {
        const nextTrails = upsertInvestigationTrail(state.investigationTrails, input, () => globalThis.crypto.randomUUID())

        setState((current) => ({
          ...current,
          investigationTrails: nextTrails,
        }))

        if (!state.user || !state.workspace) {
          return
        }

        const nextTrail =
          nextTrails.find((trail) => trail.id === input.trailId) ??
          nextTrails.find((trail) => Boolean(input.eventId && trail.eventId === input.eventId)) ??
          nextTrails.find((trail) => Boolean(input.predictionId && trail.predictionIds.includes(input.predictionId)))

        if (!nextTrail) {
          return
        }

        void syncWorkspaceTrail(nextTrail, {
          user: state.user,
          workspace: state.workspace,
        }).then((savedTrail) => {
          setState((current) => ({
            ...current,
              investigationTrails: sortByUpdatedAt([
                savedTrail,
                ...current.investigationTrails.filter((trail) => trail.id !== savedTrail.id),
              ]).slice(0, 12),
            }))
        }).catch(() => undefined)
      },
    }),
    [refreshWorkspace, state],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)

  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider")
  }

  return context
}
