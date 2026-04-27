"use client"

import type {
  AssignDecisionBriefRequest,
  CreateDecisionBriefRequest,
  CreateDecisionCheckpointRequest,
  DecisionBrief,
  DecisionBriefDetailResponse,
  ListDecisionBriefsResponse,
  UpdateDecisionBriefStatusRequest,
  WorkspaceDecisionDeskResponse,
} from "@finance-superbrain/schemas"

import { resolveApiBaseUrl } from "@/lib/apiClient"

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

async function parseError(response: Response, fallback: string): Promise<never> {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null
  throw new Error(payload?.message ?? fallback)
}

export async function listDecisionBriefs() {
  const response = await request("/v1/decision-briefs")

  if (!response.ok) {
    return parseError(response, "Failed to load decision briefs.")
  }

  return (await response.json()) as ListDecisionBriefsResponse
}

export async function getDecisionDesk() {
  const response = await request("/v1/workspace/decision-desk")

  if (!response.ok) {
    return parseError(response, "Failed to load the decision desk.")
  }

  return (await response.json()) as WorkspaceDecisionDeskResponse
}

export async function getDecisionBriefDetail(decisionBriefId: string) {
  const response = await request(`/v1/decision-briefs/${decisionBriefId}`)

  if (!response.ok) {
    return parseError(response, "Failed to load the decision brief.")
  }

  return (await response.json()) as DecisionBriefDetailResponse
}

export async function createDecisionBrief(payload: CreateDecisionBriefRequest) {
  const response = await request("/v1/decision-briefs", {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to create the decision brief.")
  }

  return (await response.json()) as DecisionBrief
}

export async function assignDecisionBrief(decisionBriefId: string, payload: AssignDecisionBriefRequest) {
  const response = await request(`/v1/decision-briefs/${decisionBriefId}/assign`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to update decision ownership.")
  }

  return (await response.json()) as DecisionBrief
}

export async function updateDecisionBriefStatus(decisionBriefId: string, payload: UpdateDecisionBriefStatusRequest) {
  const response = await request(`/v1/decision-briefs/${decisionBriefId}/status`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to update the decision status.")
  }

  return (await response.json()) as DecisionBrief
}

export async function saveDecisionCheckpoint(decisionBriefId: string, payload: CreateDecisionCheckpointRequest) {
  const response = await request(`/v1/decision-briefs/${decisionBriefId}/checkpoints`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to save the decision checkpoint.")
  }

  return (await response.json()) as DecisionBriefDetailResponse
}
