"use client"

import type {
  AnalogMatch,
  AuthSessionResponse,
  DecisionBrief,
  ParsedEvent,
  PortfolioCandidate,
  ServerStudioDraft,
  SharedInvestigation,
  SharedStudioRun,
  StoredEvent,
  StoredPrediction,
  StoredSource,
  WorkspaceActivity,
  WorkspaceMembership,
  ListWorkspaceMembersResponse,
  WorkspaceRecentItem as ServerWorkspaceRecentItem,
  WorkspaceStateResponse,
  WorkspaceUser,
  Workspace,
  AuthSession,
} from "@finance-superbrain/schemas"

import { getTrailStatus, type InvestigationTrail } from "@/lib/investigationTrail"
import { resolveApiBaseUrl } from "@/lib/apiClient"

export type WorkspaceRecentItem = {
  id: string
  kind: "prediction" | "studio_run" | "studio_draft"
  href: string
  title: string
  description: string
  updatedAt: string
}

export type StudioDraftForm = {
  source_type: "headline" | "transcript" | "speech" | "earnings" | "filing" | "user_note"
  title: string
  speaker: string
  publisher: string
  raw_uri: string
  occurred_at: string
  raw_text: string
  model_version: string
  horizons: Array<"1h" | "1d" | "5d">
}

export type StudioDraftRecord = {
  form: StudioDraftForm
  preview: ParsedEvent | null
  updatedAt: string
}

export type SavedStudioRun = {
  id: string
  title: string
  sourceType: StudioDraftForm["source_type"]
  form: StudioDraftForm
  preview: ParsedEvent | null
  source: StoredSource | null
  event: StoredEvent | null
  predictions: StoredPrediction[]
  analogs: AnalogMatch[]
  eventSummary: string
  eventId: string | null
  predictionIds: string[]
  analogPredictionIds: string[]
  updatedAt: string
}

export type WorkspaceSnapshot = {
  authenticated: boolean
  user: WorkspaceUser | null
  workspace: Workspace | null
  membership: WorkspaceMembership | null
  session: AuthSession | null
  studioDraft: StudioDraftRecord | null
  studioRuns: SavedStudioRun[]
  decisionBriefs: DecisionBrief[]
  portfolioCandidates: PortfolioCandidate[]
  recentItems: WorkspaceRecentItem[]
  investigationTrails: InvestigationTrail[]
  activity: WorkspaceActivity[]
}

export type WorkspaceMemberEntry = {
  user: WorkspaceUser
  membership: WorkspaceMembership
}

type WorkspaceIdentity = {
  user: WorkspaceUser
  workspace: Workspace
}

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  return fetch(`${resolveApiBaseUrl()}${path}`, {
    credentials: "include",
    headers,
    ...init,
  })
}

function toClientRecentItem(item: ServerWorkspaceRecentItem): WorkspaceRecentItem {
  return {
    id: item.id,
    kind: item.kind,
    href: item.href,
    title: item.title,
    description: item.description,
    updatedAt: item.updated_at,
  }
}

function toServerRecentItem(item: WorkspaceRecentItem): ServerWorkspaceRecentItem {
  return {
    id: item.id,
    kind: item.kind,
    href: item.href,
    title: item.title,
    description: item.description,
    updated_at: item.updatedAt,
  }
}

function toClientDraft(draft: ServerStudioDraft | null): StudioDraftRecord | null {
  if (!draft) {
    return null
  }

  return {
    form: draft.form,
    preview: draft.preview,
    updatedAt: draft.updated_at,
  }
}

function getRunStage(run: SavedStudioRun): SharedStudioRun["stage"] {
  if (!run.preview) {
    return "draft"
  }

  if (!run.event) {
    return "parsed_preview"
  }

  if (!run.predictions.length) {
    return "stored_event"
  }

  return "ready_for_review"
}

function toClientRun(run: SharedStudioRun): SavedStudioRun {
  return {
    id: run.id,
    title: run.title,
    sourceType: run.source_type,
    form: run.form,
    preview: run.preview,
    source: run.source,
    event: run.event,
    predictions: run.predictions,
    analogs: run.analogs,
    eventSummary: run.event_summary,
    eventId: run.event_id,
    predictionIds: run.prediction_ids,
    analogPredictionIds: run.analog_prediction_ids,
    updatedAt: run.updated_at,
  }
}

function toServerRun(run: SavedStudioRun, identity: WorkspaceIdentity): SharedStudioRun {
  return {
    id: run.id,
    workspace_id: identity.workspace.id,
    owner_user_id: identity.user.id,
    last_actor_user_id: identity.user.id,
    title: run.title,
    source_type: run.sourceType,
    stage: getRunStage(run),
    form: run.form,
    preview: run.preview,
    source: run.source,
    event: run.event,
    predictions: run.predictions,
    analogs: run.analogs,
    event_summary: run.eventSummary,
    event_id: run.eventId,
    prediction_ids: run.predictionIds,
    analog_prediction_ids: run.analogPredictionIds,
    updated_at: run.updatedAt,
    created_at: run.updatedAt,
  }
}

function toClientTrail(trail: SharedInvestigation): InvestigationTrail {
  return {
    id: trail.id,
    title: trail.title,
    eventId: trail.event_id,
    predictionIds: trail.prediction_ids,
    status: trail.status,
    createdAt: trail.created_at,
    updatedAt: trail.updated_at,
    ownerUserId: trail.owner_user_id,
    assigneeUserId: trail.assignee_user_id,
    lastActorUserId: trail.last_actor_user_id,
    steps: trail.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      status: step.status,
      href: step.href,
      title: step.title,
      detail: step.detail,
      updatedAt: step.updated_at,
    })),
  }
}

function toServerTrail(trail: InvestigationTrail, identity: WorkspaceIdentity): SharedInvestigation {
  return {
    id: trail.id,
    workspace_id: identity.workspace.id,
    title: trail.title,
    event_id: trail.eventId,
    prediction_ids: trail.predictionIds,
    status: trail.status ?? getTrailStatus(trail),
    owner_user_id: trail.ownerUserId ?? identity.user.id,
    assignee_user_id: trail.assigneeUserId ?? null,
    last_actor_user_id: identity.user.id,
    updated_at: trail.updatedAt,
    created_at: trail.createdAt ?? trail.steps.at(-1)?.updatedAt ?? trail.updatedAt,
    steps: trail.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      status: step.status,
      href: step.href,
      title: step.title,
      detail: step.detail,
      updated_at: step.updatedAt,
    })),
  }
}

export async function fetchWorkspaceState(): Promise<WorkspaceSnapshot | null> {
  const response = await request("/v1/workspace/state")

  if (response.status === 401) {
    return null
  }

  if (!response.ok) {
    throw new Error("Failed to load workspace state.")
  }

  const data = (await response.json()) as WorkspaceStateResponse

  return {
    authenticated: data.session.authenticated,
    user: data.session.user,
    workspace: data.session.workspace,
    membership: data.session.membership,
    session: data.session.session,
    studioDraft: toClientDraft(data.draft),
    studioRuns: data.studio_runs.map(toClientRun),
    decisionBriefs: data.decision_briefs,
    portfolioCandidates: data.portfolio_candidates,
    recentItems: data.recent_items.map(toClientRecentItem),
    investigationTrails: data.investigations.map(toClientTrail),
    activity: data.activity,
  }
}

export async function fetchWorkspaceMembers(): Promise<WorkspaceMemberEntry[]> {
  const response = await request("/v1/workspace/members")

  if (response.status === 401) {
    return []
  }

  if (!response.ok) {
    throw new Error("Failed to load workspace members.")
  }

  const data = (await response.json()) as ListWorkspaceMembersResponse
  return data.members
}

export async function fetchWorkspaceActivity(): Promise<WorkspaceActivity[]> {
  const response = await request("/v1/workspace/activity")

  if (response.status === 401) {
    return []
  }

  if (!response.ok) {
    throw new Error("Failed to load workspace activity.")
  }

  const data = (await response.json()) as { events: WorkspaceActivity[] }
  return data.events
}

export async function loginWorkspace(email: string, password: string) {
  const response = await request("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? "Failed to sign in.")
  }

  return (await response.json()) as AuthSessionResponse
}

export async function getWorkspaceBootstrapState() {
  const response = await request("/v1/auth/bootstrap")

  if (!response.ok) {
    throw new Error("Failed to load workspace bootstrap state.")
  }

  return (await response.json()) as { bootstrap_required: boolean }
}

export async function createWorkspaceUser(input: {
  email: string
  password: string
  display_name: string
  role?: "admin" | "member"
}) {
  const response = await request("/v1/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? "Failed to create workspace user.")
  }

  return response.json()
}

export async function logoutWorkspace() {
  await request("/v1/auth/logout", {
    method: "POST",
  })
}

export async function saveWorkspaceDraft(
  draft: StudioDraftRecord,
  identity: { user: WorkspaceUser },
) {
  const payload: ServerStudioDraft = {
    id: `draft:${identity.user.id}`,
    owner_user_id: identity.user.id,
    form: draft.form,
    preview: draft.preview,
    updated_at: draft.updatedAt,
  }

  const response = await request("/v1/studio/draft", {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error("Failed to save Studio draft.")
  }

  return toClientDraft((await response.json()) as ServerStudioDraft)
}

export async function clearWorkspaceDraft() {
  await request("/v1/studio/draft", {
    method: "DELETE",
  })
}

export async function saveWorkspaceRun(
  run: SavedStudioRun,
  identity: WorkspaceIdentity,
) {
  const response = await request("/v1/studio/runs", {
    method: "POST",
    body: JSON.stringify(toServerRun(run, identity)),
  })

  if (!response.ok) {
    throw new Error("Failed to save Studio run.")
  }

  return toClientRun((await response.json()) as SharedStudioRun)
}

export async function syncWorkspaceTrail(
  trail: InvestigationTrail,
  identity: WorkspaceIdentity,
) {
  const response = await request("/v1/investigations/sync", {
    method: "POST",
    body: JSON.stringify(toServerTrail(trail, identity)),
  })

  if (!response.ok) {
    throw new Error("Failed to sync investigation.")
  }

  return toClientTrail((await response.json()) as SharedInvestigation)
}

export async function saveWorkspaceRecentItem(item: WorkspaceRecentItem) {
  const response = await request("/v1/workspace/recent-items", {
    method: "POST",
    body: JSON.stringify(toServerRecentItem(item)),
  })

  if (!response.ok) {
    throw new Error("Failed to save recent item.")
  }

  return toClientRecentItem((await response.json()) as ServerWorkspaceRecentItem)
}

export async function assignWorkspaceInvestigation(investigationId: string, assigneeUserId: string | null) {
  const response = await request(`/v1/investigations/${investigationId}/assign`, {
    method: "POST",
    body: JSON.stringify({
      assignee_user_id: assigneeUserId,
    }),
  })

  if (!response.ok) {
    throw new Error("Failed to assign investigation.")
  }

  return toClientTrail((await response.json()) as SharedInvestigation)
}

export async function reopenWorkspaceInvestigation(investigationId: string) {
  const response = await request(`/v1/investigations/${investigationId}/reopen`, {
    method: "POST",
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    throw new Error("Failed to reopen investigation.")
  }

  return toClientTrail((await response.json()) as SharedInvestigation)
}
