"use client"

import type {
  AssignPortfolioCandidateRequest,
  CreatePortfolioCandidateRequest,
  CreatePortfolioCheckpointRequest,
  ListPortfolioCandidatesResponse,
  PortfolioCandidate,
  PortfolioCandidateDetailResponse,
  PortfolioCandidatePostureUpdateRequest,
  CreatePortfolioReviewSessionRequest,
  ListPortfolioReviewSessionsResponse,
  PortfolioReviewSession,
  PortfolioReviewSessionDetailResponse,
  SavePortfolioRebalanceProposalRequest,
  UpdatePortfolioReviewSessionRequest,
  UpdatePortfolioReviewSessionStatusRequest,
  UpdatePortfolioCandidateStatusRequest,
  WorkspacePortfolioDeskResponse,
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

export async function listPortfolioCandidates() {
  const response = await request("/v1/portfolio")

  if (!response.ok) {
    return parseError(response, "Failed to load portfolio candidates.")
  }

  return (await response.json()) as ListPortfolioCandidatesResponse
}

export async function getPortfolioDesk() {
  const response = await request("/v1/workspace/portfolio-desk")

  if (!response.ok) {
    return parseError(response, "Failed to load the portfolio desk.")
  }

  return (await response.json()) as WorkspacePortfolioDeskResponse
}

export async function getPortfolioCandidateDetail(portfolioCandidateId: string) {
  const response = await request(`/v1/portfolio/${portfolioCandidateId}`)

  if (!response.ok) {
    return parseError(response, "Failed to load the portfolio candidate.")
  }

  return (await response.json()) as PortfolioCandidateDetailResponse
}

export async function createPortfolioCandidate(payload: CreatePortfolioCandidateRequest) {
  const response = await request("/v1/portfolio", {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to create the portfolio candidate.")
  }

  return (await response.json()) as PortfolioCandidate
}

export async function assignPortfolioCandidate(
  portfolioCandidateId: string,
  payload: AssignPortfolioCandidateRequest,
) {
  const response = await request(`/v1/portfolio/${portfolioCandidateId}/assign`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to update portfolio ownership.")
  }

  return (await response.json()) as PortfolioCandidate
}

export async function updatePortfolioCandidateStatus(
  portfolioCandidateId: string,
  payload: UpdatePortfolioCandidateStatusRequest,
) {
  const response = await request(`/v1/portfolio/${portfolioCandidateId}/status`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to update the portfolio candidate status.")
  }

  return (await response.json()) as PortfolioCandidate
}

export async function updatePortfolioCandidatePosture(
  portfolioCandidateId: string,
  payload: PortfolioCandidatePostureUpdateRequest,
) {
  const response = await request(`/v1/portfolio/${portfolioCandidateId}/posture`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to update the portfolio posture.")
  }

  return (await response.json()) as PortfolioCandidate
}

export async function savePortfolioCheckpoint(
  portfolioCandidateId: string,
  payload: CreatePortfolioCheckpointRequest,
) {
  const response = await request(`/v1/portfolio/${portfolioCandidateId}/checkpoints`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to save the portfolio checkpoint.")
  }

  return (await response.json()) as PortfolioCandidateDetailResponse
}

export async function listPortfolioReviewSessions() {
  const response = await request("/v1/portfolio/reviews")

  if (!response.ok) {
    return parseError(response, "Failed to load portfolio review sessions.")
  }

  return (await response.json()) as ListPortfolioReviewSessionsResponse
}

export async function createPortfolioReviewSession(payload: CreatePortfolioReviewSessionRequest) {
  const response = await request("/v1/portfolio/reviews", {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to create the portfolio review session.")
  }

  return (await response.json()) as PortfolioReviewSessionDetailResponse
}

export async function getPortfolioReviewSessionDetail(reviewSessionId: string) {
  const response = await request(`/v1/portfolio/reviews/${reviewSessionId}`)

  if (!response.ok) {
    return parseError(response, "Failed to load the portfolio review session.")
  }

  return (await response.json()) as PortfolioReviewSessionDetailResponse
}

export async function updatePortfolioReviewSession(
  reviewSessionId: string,
  payload: UpdatePortfolioReviewSessionRequest,
) {
  const response = await request(`/v1/portfolio/reviews/${reviewSessionId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to update the portfolio review session.")
  }

  return (await response.json()) as PortfolioReviewSession
}

export async function updatePortfolioReviewSessionStatus(
  reviewSessionId: string,
  payload: UpdatePortfolioReviewSessionStatusRequest,
) {
  const response = await request(`/v1/portfolio/reviews/${reviewSessionId}/status`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to update the portfolio review session status.")
  }

  return (await response.json()) as PortfolioReviewSession
}

export async function savePortfolioRebalanceProposal(
  reviewSessionId: string,
  payload: SavePortfolioRebalanceProposalRequest,
) {
  const response = await request(`/v1/portfolio/reviews/${reviewSessionId}/proposals`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseError(response, "Failed to save the portfolio rebalance proposal.")
  }

  return response.json()
}
